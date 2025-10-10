import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const distRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function resolveFromDist(modulePath: string) {
  const distPath = path.join(distRoot, modulePath);
  if (!fs.existsSync(distPath)) {
    throw new Error(`Module ${modulePath} not found in dist/. Did you run npm run build?`);
  }
  return pathToFileURL(distPath).href;
}
