/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { sameOriginUrl, allowedOrigins, clampQuantity } from './urlGuard.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const origins = allowedOrigins({ VITE_APP_URL: 'https://www.slabsenseai.com', NODE_ENV: 'production' });

ok('own origin passes, path and query kept', () => {
  assert.equal(sameOriginUrl('https://www.slabsenseai.com/billing?success=true', origins), 'https://www.slabsenseai.com/billing?success=true');
});
ok('foreign origin, javascript:, data:, garbage and non-strings are rejected', () => {
  for (const bad of ['https://evil.example/phish', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', 42, null, undefined, 'https://www.slabsenseai.com.evil.example/']) {
    assert.equal(sameOriginUrl(bad, origins), null, String(bad));
  }
});
ok('VITE_APP_URL adds its origin; preview adds VERCEL_URL; localhost only outside production', () => {
  const dev = allowedOrigins({ VITE_APP_URL: 'https://staging.example.com', VERCEL_ENV: 'preview', VERCEL_URL: 'app-abc.vercel.app', NODE_ENV: 'development' });
  assert.ok(dev.has('https://staging.example.com')); assert.ok(dev.has('https://app-abc.vercel.app')); assert.ok(dev.has('http://localhost:5173'));
  assert.ok(!origins.has('http://localhost:5173'));
});
ok('quantity is an integer in [1, 50]', () => {
  assert.equal(clampQuantity(undefined), 1); assert.equal(clampQuantity('abc'), 1); assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(7.9), 7); assert.equal(clampQuantity(1e9), 50); assert.equal(clampQuantity(-3), 1);
});
console.log(`${passed} passed, 0 failed`);
