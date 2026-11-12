// Lets Node run the app's TypeScript outside Metro (scripts/evaluate-spelling.ts):
// resolves the "@/" alias and extensionless relative imports (in src/ and scripts/)
// to .ts files, and loads JSON imports as modules. Node strips the types itself
// (Node >= 22.18).
import { readFile } from 'node:fs/promises';

const src = new URL('../src/', import.meta.url);
const scripts = new URL('./', import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    return next(new URL(specifier.slice(2) + '.ts', src).href, context);
  }
  if (
    specifier.startsWith('.') &&
    !/\.\w+$/.test(specifier) &&
    (context.parentURL?.startsWith(src.href) || context.parentURL?.startsWith(scripts.href))
  ) {
    return next(new URL(specifier + '.ts', context.parentURL).href, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.json')) {
    const text = await readFile(new URL(url), 'utf8');
    return { format: 'module', source: `export default ${text}`, shortCircuit: true };
  }
  return next(url, context);
}
