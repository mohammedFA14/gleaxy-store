import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const children = [
  spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;
const stop = code => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = code;
};
for (const child of children) child.on('exit', code => { if (!stopping) stop(code || 0); });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
