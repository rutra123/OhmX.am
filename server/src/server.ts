import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath } from './db.js';
import { clientDistRoot, clientIndexPath, envPath, projectRoot, storageRoot } from './paths.js';
import categories from './routes/categories.js';
import catalog from './routes/catalog.js';
import brands from './routes/brands.js';
import series from './routes/series.js';
import products from './routes/products.js';
import search from './routes/search.js';
import documents from './routes/documents.js';
import orders from './routes/orders.js';
import tools from './routes/tools.js';
import warmFloorProject from './routes/warmFloorProject.js';
import buildingProject from './routes/buildingProject.js';
import catalogMatcher, { catalogMatcherTransportErrorHandler } from './routes/catalogMatcher.js';
import aiEngineering from './routes/aiEngineering.js';
import warehouses from './routes/warehouses.js';
import admin from './routes/admin.js';
import uploads from './routes/uploads.js';
import navigation from './routes/navigation.js';
import { canonicalCatalogRedirect } from './utils/categoryAliases.js';

dotenv.config({ path: envPath });
const app = express();
const port = Number(process.env.PORT || 8081);
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const hasBuiltClient = fs.existsSync(clientIndexPath);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin === clientUrl || /^https?:\/\/(127\.0\.0\.1|localhost):517\d$/.test(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(catalogMatcherTransportErrorHandler);
const storageStaticOptions = {
  index: false,
  fallthrough: true,
  // Product photos/thumbnails and uploads use unique file names; let browsers reuse them for a week.
  maxAge: '7d',
  setHeaders: (res: express.Response) => res.setHeader('X-Content-Type-Options', 'nosniff'),
};
app.use('/storage/images', express.static(path.join(storageRoot, 'images'), storageStaticOptions));

app.get('/storage/docs/:filename', (req, res) => {
  const filename = req.params.filename;

  // Prevent path traversal (checking for double-dot '..' to allow normal single dots in extensions)
  const safeFilename = path.basename(filename);
  if (safeFilename !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(404).end();
  }

  // Check database for matching file_url and is_public/is_active status
  const fileUrl = `/storage/docs/${filename}`;
  const docs = db.prepare('SELECT is_public, COALESCE(is_active, 1) AS active FROM product_documents WHERE file_url = ?').all(fileUrl) as any[];
  const hasPublicActiveDoc = docs.some((d) => d.is_public === 1 && d.active === 1);

  if (!hasPublicActiveDoc) {
    return res.status(404).end();
  }

  const absolutePath = path.join(storageRoot, 'docs', filename);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).end();
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(absolutePath);
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ohmx-am-server' }));
app.use('/api/navigation', navigation);
app.use('/api/categories', categories);
app.use('/api/catalog', catalog);
app.use('/api/brands', brands);
app.use('/api/series', series);
app.use('/api/products', products);
app.use('/api/search', search);
app.use('/api/documents', documents);
app.use('/api/orders', orders);
app.use('/api/tools', tools);
app.use('/api/tools/warm-floor', warmFloorProject);
app.use('/api/tools/building-project', buildingProject);
app.use('/api/catalog-matcher', catalogMatcher);
app.use('/api/ai-engineering', aiEngineering);
app.use('/api/warehouses', warehouses);
app.use('/api/admin', admin);
app.use('/api/admin', uploads);

// Merged categories keep their old URLs alive with a real 301 (query string preserved), before the SPA fallback.
app.get(['/catalog/*', '/category/*'], (req, res, next) => {
  const target = canonicalCatalogRedirect(req.path);
  if (!target) return next();
  const query = req.originalUrl.indexOf('?');
  return res.redirect(301, query === -1 ? target : `${target}${req.originalUrl.slice(query)}`);
});

if (hasBuiltClient) {
  app.use(express.static(clientDistRoot, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/storage/')) return next();
    return res.sendFile(clientIndexPath);
  });
}

const currentRows = Number((db.prepare('SELECT (SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM brands) + (SELECT COUNT(*) FROM products) AS total').get() as any)?.total || 0);
if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size < 1024 || currentRows === 0) {
  const { spawnSync } = await import('node:child_process');
  spawnSync('npm', ['run', 'seed'], { cwd: projectRoot, stdio: 'inherit' });
}
app.listen(port, '127.0.0.1', () => console.log(`OhmX.am on http://localhost:${port} (api: /api/health, built client: ${hasBuiltClient ? 'yes' : 'no'})`));
