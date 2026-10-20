// Copies the single-file build to the project root so it can be opened with a double-click.
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist', 'index.html');
const dest = join(root, 'Gridfinity Planner.html');

if (!existsSync(src)) {
  console.error('dist/index.html not found - did the build fail?');
  process.exit(1);
}
copyFileSync(src, dest);
const mb = (statSync(dest).size / 1024 / 1024).toFixed(2);
console.log(`\nReady: "${dest}" (${mb} MB). Double-click it to open the planner.`);
