import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const pkgPath = join(process.cwd(), 'node_modules', '@gorules', 'zen-engine-wasm', 'package.json');
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (Array.isArray(pkg.sideEffects)) {
    pkg.sideEffects = pkg.sideEffects.filter((e) => e !== './dist/snippets/*');
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
} catch (err) {
  console.error('Failed to patch zen-engine-wasm', err);
  process.exit(1);
}
