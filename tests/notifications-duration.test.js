import test from 'node:test';
import assert from 'node:assert/strict';
import { toastDuration } from '../assets/js/shared/notifications.js';

test('les erreurs et avertissements restent plus longtemps que les toasts normaux', () => {
  assert.equal(toastDuration('error'), 6000);
  assert.equal(toastDuration('warning'), 6000);
  assert.equal(toastDuration('success'), 3000);
  assert.equal(toastDuration('info'), 3000);
  assert.equal(toastDuration(), 3000);
});

test('une durée explicite a toujours priorité, quel que soit le type', () => {
  assert.equal(toastDuration('error', 2000), 2000);
  assert.equal(toastDuration('success', 10000), 10000);
  // 0 / absence → on retombe sur le défaut par type (comportement historique `|| `).
  assert.equal(toastDuration('error', 0), 6000);
});
