#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Ownership header on every source file (App Store readiness fix group 3e; audit H-01).
 *
 *   node scripts/legal/add-headers.mjs            add the header where it is missing
 *   node scripts/legal/add-headers.mjs --check    exit 1 and list files without one (CI / npm run check)
 *   node scripts/legal/add-headers.mjs --retag "New Holder Name"
 *                                                 rewrite the copyright line everywhere (new legal entity)
 *
 * Rules: tracked files only (git ls-files), never a file with unstaged changes (someone is editing
 * it), never vendored / generated / scratch paths. The header goes after a shebang or a Python
 * encoding line and before whatever docblock the file already has; existing descriptions stay.
 * Idempotent: a file whose first lines already carry the copyright line is left alone.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HOLDER = 'SlabSense';
const YEAR = '2026';
const LINES = [
  'SlabSense — https://www.slabsenseai.com',
  `Copyright (c) ${YEAR} ${HOLDER}. All rights reserved.`,
  'Proprietary and confidential; see LICENSE at the repository root.',
];
const MARK = /Copyright \(c\) \d{4}(?:[–-]\d{4})? .+? All rights reserved\./;
const SKIP = [
  /^public\/slab\/vendor\//, /^scripts\/unused\//, /^training\/weights\//, /^node_modules\//, /^dist\//,
  /^backup-api\//, /^staging\//, /\.min\.js$/, /\.d\.ts$/, /^public\/.*\.html$/, /^scripts\/studio-app\.extracted\.js$/,
  /^supabase\/migrations\//,   // SQL already carries dated banners; Supabase runs them verbatim — leave untouched
];
const EXT = { '.js': 'c', '.jsx': 'c', '.mjs': 'c', '.cjs': 'c', '.ts': 'c', '.tsx': 'c', '.py': 'hash', '.sql': 'dash', '.ps1': 'hash', '.sh': 'hash' };

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const RETAG = args.includes('--retag') ? args[args.indexOf('--retag') + 1] : null;

const tracked = execSync('git ls-files -z', { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean);
const dirty = new Set(execSync('git ls-files -m -z', { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean));
const files = tracked.filter((f) => EXT[path.extname(f)] && !SKIP.some((re) => re.test(f)));

function render(kind) {
  if (kind === 'c') return ['/*', ...LINES.map((l) => ` * ${l}`), ' */'].join('\n') + '\n';
  if (kind === 'hash') return LINES.map((l) => `# ${l}`).join('\n') + '\n';
  return LINES.map((l) => `-- ${l}`).join('\n') + '\n';
}
function hasHeader(text) { return MARK.test(text.split('\n').slice(0, 12).join('\n')); }
function insertAt(text, kind) {
  const lines = text.split('\n');
  let i = 0;
  if (lines[0]?.startsWith('#!')) i = 1;
  if (kind === 'hash' && /^#.*coding[:=]/.test(lines[i] || '')) i += 1;
  const head = lines.slice(0, i).join('\n');
  const rest = lines.slice(i).join('\n');
  return (head ? head + '\n' : '') + render(kind) + rest;
}

let missing = [], added = [], retagged = [], skippedDirty = [];
for (const f of files) {
  const p = path.join(ROOT, f);
  let text = fs.readFileSync(p, 'utf8');
  const crlf = text.includes('\r\n');
  const norm = crlf ? text.replace(/\r\n/g, '\n') : text;
  const kind = EXT[path.extname(f)];
  if (RETAG) {
    if (!hasHeader(norm)) { missing.push(f); continue; }
    const out = norm.replace(MARK, `Copyright (c) ${YEAR} ${RETAG}. All rights reserved.`);
    if (out !== norm) { fs.writeFileSync(p, crlf ? out.replace(/\n/g, '\r\n') : out); retagged.push(f); }
    continue;
  }
  if (hasHeader(norm)) continue;
  if (dirty.has(f)) { skippedDirty.push(f); continue; }   // someone is editing it; the next run picks it up
  if (CHECK) { missing.push(f); continue; }
  const out = insertAt(norm, kind);
  fs.writeFileSync(p, crlf ? out.replace(/\n/g, '\r\n') : out);
  added.push(f);
}

if (CHECK) {
  if (missing.length) { console.error(`${missing.length} source file(s) without the ownership header:\n  ` + missing.join('\n  ')); process.exit(1); }
  console.log(`headers: ${files.length - skippedDirty.length} files OK` + (skippedDirty.length ? `; ${skippedDirty.length} with unstaged edits not checked: ` + skippedDirty.join(', ') : ''));
} else if (RETAG) {
  console.log(`retagged ${retagged.length} file(s) to "${RETAG}"${missing.length ? `; ${missing.length} without a header` : ''}`);
} else {
  console.log(`headers: added ${added.length}, already present ${files.length - added.length - skippedDirty.length}` + (skippedDirty.length ? `, skipped ${skippedDirty.length} with unstaged edits:\n  ` + skippedDirty.join('\n  ') : ''));
}
