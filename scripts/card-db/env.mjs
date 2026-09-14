/** Loads .env.local from the repo root into process.env (values already set win). */
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(file = path.join(process.cwd(), '.env.local')) {
  if (!fs.existsSync(file)) return;
  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
