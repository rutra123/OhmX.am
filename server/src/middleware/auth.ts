import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const TOKEN_TTL_SECONDS = Number(process.env.ADMIN_TOKEN_TTL_SECONDS || 60 * 60 * 12);
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminTokenSecret = process.env.ADMIN_TOKEN_SECRET || '';

if (!adminPassword) {
  console.error('ADMIN_PASSWORD is not set; admin login is disabled.');
}
if (!adminTokenSecret) {
  console.error('ADMIN_TOKEN_SECRET is not set; admin login is disabled.');
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string) {
  return crypto.createHmac('sha256', adminTokenSecret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isAdminAuthConfigured() {
  return Boolean(adminPassword && adminTokenSecret);
}

export function verifyAdminPassword(password: unknown) {
  if (!isAdminAuthConfigured() || typeof password !== 'string') return false;
  return safeEqual(password, adminPassword);
}

export function createAdminToken() {
  if (!isAdminAuthConfigured()) throw new Error('Admin auth is not configured');
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(JSON.stringify({ sub: 'admin', iat: now, exp: now + TOKEN_TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string) {
  if (!isAdminAuthConfigured() || !token) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    return claims.sub === 'admin' && typeof claims.exp === 'number' && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export { adminPassword };
