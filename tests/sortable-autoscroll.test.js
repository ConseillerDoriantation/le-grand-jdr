import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helper = readFileSync(new URL('../assets/js/shared/sortable-helper.js', import.meta.url), 'utf8');
const vendor = readFileSync(new URL('../assets/js/vendor/sortable.esm.js', import.meta.url), 'utf8');

test('le tri partagé fait suivre la page près des bords', () => {
  assert.match(helper, /scroll:\s*true/);
  assert.match(helper, /forceAutoScrollFallback:\s*true/);
  assert.match(helper, /scrollSensitivity:\s*96/);
  assert.match(helper, /scrollSpeed:\s*18/);
  assert.match(helper, /bubbleScroll:\s*true/);
});

test('les Sortable directs héritent du même auto-scroll fluide', () => {
  const defaults = vendor.match(/function AutoScroll\(\)[\s\S]*?this\.defaults\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1] || '';
  assert.match(defaults, /forceAutoScrollFallback:\s*true/);
  assert.match(defaults, /scrollSensitivity:\s*96/);
  assert.match(defaults, /scrollSpeed:\s*18/);
  assert.match(defaults, /bubbleScroll:\s*true/);
});
