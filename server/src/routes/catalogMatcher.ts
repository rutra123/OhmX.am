/**
 * CM6 thin read-only HTTP boundary for Catalog Matcher.
 * Transport only. Engineering decisions stay in CM5/CM3.
 * Does not import the writable application db helper.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { resolveProjectPath } from '../paths.js';
import { matchCatalogProducts, type CatalogMatcherResult } from '../utils/catalogMatcher/service.js';
import type { CatalogMatchRequest } from '../utils/catalogMatcher/types.js';

export type CatalogMatcherMatchFn = (request: CatalogMatchRequest) => CatalogMatcherResult;

export interface CatalogMatcherRouterOptions {
  match?: CatalogMatcherMatchFn;
  databasePath?: string;
}

export function resolveCatalogMatcherDatabasePath(): string {
  const configured = String(process.env.DB_PATH || './data/electro.db').trim() || './data/electro.db';
  return resolveProjectPath(configured);
}

function defaultMatch(request: CatalogMatchRequest, databasePath?: string): CatalogMatcherResult {
  return matchCatalogProducts(request, {
    databasePath: databasePath ?? resolveCatalogMatcherDatabasePath(),
  });
}

export function catalogMatcherTransportErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const url = String(req.originalUrl || req.url || '');
  if (!url.includes('/api/catalog-matcher')) {
    next(err);
    return;
  }
  const typed = err as { type?: string; status?: number };
  if (typed?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large', code: 'INVALID_REQUEST' });
    return;
  }
  if (err instanceof SyntaxError || typed?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body', code: 'INVALID_REQUEST' });
    return;
  }
  next(err);
}

function sendRequestError(res: Response, result: Extract<CatalogMatcherResult, { ok: false; kind: 'REQUEST_ERROR' }>): void {
  res.status(400).json({
    error: result.error.message,
    code: result.error.errorCode,
    field: result.error.field,
    details: result.error.details,
  });
}

export function createCatalogMatcherRouter(options: CatalogMatcherRouterOptions = {}): Router {
  const router = Router();
  const matchFn: CatalogMatcherMatchFn =
    options.match ?? ((request) => defaultMatch(request, options.databasePath));

  router.post('/match', (req, res) => {
    if (req.body == null || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({
        error: 'Request body must be a JSON object',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    let result: CatalogMatcherResult;
    try {
      result = matchFn(req.body as CatalogMatchRequest);
    } catch {
      res.status(500).json({
        error: 'Catalog matcher internal error',
        code: 'MATCHER_INTERNAL_ERROR',
      });
      return;
    }

    if (result.ok) {
      res.status(200).json(result.response);
      return;
    }
    if (result.kind === 'REQUEST_ERROR') {
      sendRequestError(res, result);
      return;
    }
    if (result.kind === 'DATABASE_READ_ERROR') {
      res.status(503).json({
        error: 'Catalog matcher could not read catalog data',
        code: 'DATABASE_READ_ERROR',
      });
      return;
    }
    res.status(500).json({
      error: 'Catalog matcher internal error',
      code: 'MATCHER_INTERNAL_ERROR',
    });
  });

  return router;
}

const router = createCatalogMatcherRouter();
export default router;
