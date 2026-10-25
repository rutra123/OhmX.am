import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(modulePath);

export const serverRoot = path.dirname(moduleDir);
export const projectRoot = path.dirname(serverRoot);
export const serverSrcRoot = path.join(serverRoot, 'src');
export const envPath = path.join(projectRoot, '.env');
export const storageRoot = path.join(projectRoot, 'storage');
export const dataRoot = path.join(projectRoot, 'data');
export const clientDistRoot = path.join(projectRoot, 'client', 'dist');
export const clientIndexPath = path.join(clientDistRoot, 'index.html');
export const schemaPath = path.join(serverSrcRoot, 'schema.sql');

export function resolveProjectPath(configuredPath: string) {
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(projectRoot, configuredPath);
}
