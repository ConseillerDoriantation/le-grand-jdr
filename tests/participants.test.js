import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  questParticipantFromChar, toggleQuestParticipant, dedupeQuestParticipants,
} from '../assets/js/shared/participants.js';

test('questParticipantFromChar : construit un participant {uid, charId, nom}', () => {
  const p = questParticipantFromChar({ id: 'c1', nom: 'Bob', uid: 'u1' });
  assert.equal(p.uid, 'u1');
  assert.equal(p.charId, 'c1');
  assert.equal(p.nom, 'Bob');
});

test('toggleQuestParticipant : rejoindre avec un perso', () => {
  const r = toggleQuestParticipant([], { uid: 'u1', char: { id: 'c1', nom: 'Bob' } });
  assert.equal(r.joined, true);
  assert.equal(r.leaving, false);
  assert.equal(r.participants.length, 1);
  assert.equal(r.participants[0].charId, 'c1');
});

test('toggleQuestParticipant : quitter (uid déjà présent, sans char)', () => {
  const before = [{ uid: 'u1', charId: 'c1', nom: 'Bob' }];
  const r = toggleQuestParticipant(before, { uid: 'u1' });
  assert.equal(r.leaving, true);
  assert.equal(r.participants.length, 0);
});

test('toggleQuestParticipant : un seul participant par uid (remplace le perso)', () => {
  const before = [{ uid: 'u1', charId: 'c1', nom: 'Bob' }];
  const r = toggleQuestParticipant(before, { uid: 'u1', char: { id: 'c2', nom: 'Alice' } });
  assert.equal(r.participants.length, 1);
  assert.equal(r.participants[0].charId, 'c2');
});

test('dedupeQuestParticipants : dédoublonne par personnage', () => {
  const parts = [
    { uid: 'u1', charId: 'c1', nom: 'Bob' },
    { uid: 'u1', charId: 'c1', nom: 'Bob' },
    { uid: 'u2', charId: 'c2', nom: 'Alice' },
  ];
  const out = dedupeQuestParticipants(parts);
  assert.equal(out.length, 2);
});

test('dedupeQuestParticipants : entrées invalides ignorées', () => {
  const out = dedupeQuestParticipants([null, { uid: 'u1', charId: 'c1' }, undefined]);
  assert.equal(out.length, 1);
});
