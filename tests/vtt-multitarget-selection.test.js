import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');

test('le ciblage multicible intercepte aussi le token du lanceur', () => {
  const branch = source.match(
    /\/\/ Mode ciblage multi-cibles actif[\s\S]*?if \(_mtCtx\) \{[\s\S]*?_mtToggleTarget\(t\.id\);[\s\S]*?return;[\s\S]*?\}/,
  )?.[0] || '';

  assert.ok(branch, 'la branche de ciblage multicible doit rester prioritaire');
  assert.doesNotMatch(branch, /t\.id\s*!==\s*_mtCtx\.srcId/);
});
