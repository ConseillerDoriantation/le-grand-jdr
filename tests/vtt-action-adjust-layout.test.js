import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('le bouton Réinitialiser ne déplace pas les steppers pendant les ajustements', () => {
  assert.match(vtt, /class="vtt-atk-reset"[^>]*aria-hidden="true"[^>]*tabindex="-1"/);
  assert.doesNotMatch(vtt, /class="vtt-atk-reset"[^>]*\shidden/);
  assert.match(vtt, /reset\.classList\.toggle\('is-visible', active\)/);
  assert.match(vtt, /reset\.tabIndex = active \? 0 : -1/);
  assert.match(css, /\.vtt-atk-reset\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.vtt-atk-reset\.is-visible\s*\{[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto/s);
});
