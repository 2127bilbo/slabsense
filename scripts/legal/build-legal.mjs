#!/usr/bin/env node
/**
 * Renders docs/legal/*.md into public/<name>.html so the privacy policy, terms and
 * disclaimers are served at /privacy, /terms and /disclaimers (Vercel serves public/ files
 * before the SPA rewrite). The markdown is the source of truth; run after editing it:
 *
 *   node scripts/legal/build-legal.mjs
 *
 * Deliberately tiny: headings, paragraphs, bold, links, bullet lists, horizontal rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SRC = path.join(ROOT, 'docs', 'legal');
const OUT = path.join(ROOT, 'public');
const PAGES = { 'privacy': 'PRIVACY_POLICY.md', 'terms': 'TERMS_OF_SERVICE.md', 'disclaimers': 'DISCLAIMERS.md', 'support': 'SUPPORT.md' };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/\[(.+?)\]\((https?:\/\/[^)]+|\/[^)]*|mailto:[^)]+)\)/g, '<a href="$2">$1</a>');

export function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^---+$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { flushPara(); if (!list) { list = 'ul'; out.push('<ul>'); } out.push(`<li>${inline(li[1])}</li>`); continue; }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) { flushPara(); if (list !== 'ol') { flushList(); list = 'ol'; out.push('<ol>'); } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

const shell = (title, body, updated) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="index,follow">
<title>${esc(title)} — SlabSense</title>
<style>
  :root{--bg:#0b0c10;--fg:#e9ecf1;--muted:#98a0ae;--line:#262b34;--accent:#7ea5ff}
  *{box-sizing:border-box}html,body{margin:0}
  body{background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.6;padding:0 16px 64px;padding-left:max(16px,env(safe-area-inset-left));padding-right:max(16px,env(safe-area-inset-right))}
  .wrap{max-width:760px;margin:0 auto}
  header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--line)}
  header a{color:var(--fg);text-decoration:none;font-weight:700}
  nav a{color:var(--muted);text-decoration:none;margin-left:14px;font-size:14px}
  h1{font-size:28px;margin:28px 0 4px}h2{font-size:20px;margin:28px 0 8px}h3{font-size:16px;margin:20px 0 6px;color:var(--muted)}
  p,li{color:#d7dbe3}a{color:var(--accent)}hr{border:0;border-top:1px solid var(--line);margin:24px 0}
  code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;background:#14161c;padding:1px 5px;border-radius:4px}
  .updated{color:var(--muted);font-size:14px}
  footer{margin-top:40px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
</style>
</head>
<body><div class="wrap">
<header><a href="/">SlabSense</a><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/disclaimers">Disclaimers</a></nav></header>
<main>
${body}
</main>
<footer>SlabSense is an independent card condition tool. Grades shown are estimates. Not affiliated with, endorsed by or connected to PSA, BGS, CGC, SGC, TAG, Nintendo, The Pokémon Company or any card game publisher.${updated ? ` · ${esc(updated)}` : ''}</footer>
</div></body></html>
`;

for (const [name, file] of Object.entries(PAGES)) {
  const md = fs.readFileSync(path.join(SRC, file), 'utf8');
  const title = (/^#\s+(.*)$/m.exec(md) || [null, name])[1].replace(/^SlabSense\s*[-—]\s*/, '');
  const updated = (/\*(Effective|Last updated)[^*]*\*/i.exec(md) || [''])[0].replace(/\*/g, '');
  const html = shell(title, mdToHtml(md), updated);
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  console.log(`wrote public/${name}.html (${html.length} bytes)`);
}
