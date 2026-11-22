import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// On Windows a lowercase drive letter (d:\ vs D:\) makes vitest load itself twice and every
// suite dies with "Cannot read properties of undefined (reading 'config')".
const upperDrive = (p) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());
const cwd = upperDrive(process.cwd());
const bin = upperDrive(
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
);
const res = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(res.status ?? 1);
