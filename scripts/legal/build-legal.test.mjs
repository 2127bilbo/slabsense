/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { mdToHtml } from './build-legal.mjs';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };

ok('a markdown table becomes an HTML table, not a paragraph of pipes', () => {
  const html = mdToHtml('Intro:\n\n| Provider | Why |\n|---|---|\n| Supabase | **storage** |\n| Stripe | payments |\n\nAfter.');
  assert.match(html, /<table>/); assert.match(html, /<th>Provider<\/th>/);
  assert.match(html, /<td><strong>storage<\/strong><\/td>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.doesNotMatch(html, /\|/);
  assert.match(html, /<p>After\.<\/p>/);
});
ok('paragraphs, lists and headings still render', () => {
  const html = mdToHtml('# Title\n\nText **bold**.\n\n- one\n- two');
  assert.match(html, /<h1>Title<\/h1>/); assert.match(html, /<li>two<\/li>/); assert.match(html, /<strong>bold<\/strong>/);
});
console.log(`${passed} passed, 0 failed`);
