import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _esc } from '../assets/js/shared/html.js';
import {
  linkify, applyEmotes, applyMentions, mentionsToTokens, dayLabel, rollDice, rollCardHtml,
} from '../assets/js/features/chat/chat-format.js';

const EMOTES = [{ name: 'rire', url: 'https://cdn.example.com/rire.png' }];
const NAMES = { u1: 'Lucie', u2: 'Quentin' };
const nameOf = (u) => NAMES[u] || u;

// ── linkify ───────────────────────────────────────────────────────────────────
test('linkify : transforme une URL en lien, laisse le texte simple intact', () => {
  assert.match(linkify('voir https://a.test/x'), /<a href="https:\/\/a\.test\/x"[^>]*>https:\/\/a\.test\/x<\/a>/);
  assert.equal(linkify('pas de lien ici'), 'pas de lien ici');
});

test('linkify : la ponctuation finale reste hors du lien', () => {
  const out = linkify('va sur https://a.test/x.');
  assert.match(out, /<\/a>\.$/);              // le point est après la balise
  assert.match(out, /href="https:\/\/a\.test\/x"/); // et pas dans l'URL
});

// ── applyEmotes ───────────────────────────────────────────────────────────────
test('applyEmotes : :nom: → <img>, inconnu laissé tel quel, liste vide sans effet', () => {
  assert.match(applyEmotes('salut :rire:', EMOTES), /<img class="chat-emote-inline"[^>]*src="https:\/\/cdn\.example\.com\/rire\.png"/);
  assert.equal(applyEmotes('salut :inconnu:', EMOTES), 'salut :inconnu:');
  assert.equal(applyEmotes('salut :rire:', []), 'salut :rire:');
});

// ── RÉGRESSION : ordre d'application ──────────────────────────────────────────
// Bug réel : linkify appliqué APRÈS applyEmotes capturait l'URL du src de l'<img>
// et la remplaçait par « <a href=… » → src cassé → 404 sur /%3Ca%20href=.
test("régression : le pipeline esc→linkify→emotes ne casse PAS le src de l'émote", () => {
  const out = applyMentions(applyEmotes(linkify(_esc('coucou :rire:')), EMOTES), 'me', nameOf);
  assert.match(out, /src="https:\/\/cdn\.example\.com\/rire\.png"/);
  assert.ok(!out.includes('src="<a'), 'le src ne doit jamais contenir une balise <a');
});

test("régression : l'ordre inverse (linkify en dernier) casserait bien le src", () => {
  const bad = linkify(applyEmotes(_esc('coucou :rire:'), EMOTES));
  assert.ok(bad.includes('src="<a'), 'ce test documente pourquoi linkify passe en premier');
});

test('linkify + emotes : une vraie URL du message reste cliquable', () => {
  const out = applyEmotes(linkify(_esc('doc https://a.test/g :rire:')), EMOTES);
  assert.match(out, /<a href="https:\/\/a\.test\/g"/);
  assert.match(out, /<img class="chat-emote-inline"/);
});

// ── mentions ──────────────────────────────────────────────────────────────────
test('applyMentions : @[uid] → @pseudo ; la mienne est mise en évidence', () => {
  const out = applyMentions('salut @[u1] et @[u2]', 'u2', nameOf);
  assert.match(out, /<span class="chat-mention">@Lucie<\/span>/);
  assert.match(out, /<span class="chat-mention chat-mention--me">@Quentin<\/span>/);
});

test('applyMentions : uid inconnu retombe sur l’uid brut, sans casser le rendu', () => {
  assert.match(applyMentions('@[zz9]', 'me', nameOf), /<span class="chat-mention">@zz9<\/span>/);
});

test('mentionsToTokens : produit un jeton porteur de data-uid (ré-sérialisable)', () => {
  const out = mentionsToTokens('salut @[u1]', nameOf);
  assert.match(out, /data-uid="u1"/);
  assert.match(out, /contenteditable="false"/);
  assert.match(out, />@Lucie</);
});

// ── dayLabel ──────────────────────────────────────────────────────────────────
test('dayLabel : Aujourd’hui / Hier / date complète', () => {
  const now = new Date(2026, 6, 15, 12, 0).getTime();
  assert.equal(dayLabel(new Date(2026, 6, 15, 8, 0).getTime(), now), "Aujourd'hui");
  assert.equal(dayLabel(new Date(2026, 6, 14, 23, 0).getTime(), now), 'Hier');
  const old = dayLabel(new Date(2026, 6, 1).getTime(), now);
  assert.ok(!['Aujourd\'hui', 'Hier'].includes(old));
  assert.match(old, /juillet/);
});

// ── rollDice (hasard injecté → déterministe) ─────────────────────────────────
const rngMid = () => 0.5;   // d20 → 1 + floor(.5*20) = 11 ; d6 → 4 ; d4 → 3

test('rollDice : dés + modificateur', () => {
  const r = rollDice('1d20+3', rngMid);
  assert.equal(r.total, 14);            // 11 + 3
  assert.equal(r.expr, '1d20+3');
  assert.deepEqual(r.parts[0].rolls, [11]);
});

test('rollDice : « d20 » vaut « 1d20 »', () => {
  assert.equal(rollDice('d20', rngMid).total, 11);
});

test('rollDice : plusieurs groupes et terme négatif', () => {
  const r = rollDice('2d6+1d4-1', rngMid);   // (4+4) + 3 - 1
  assert.equal(r.total, 10);
  assert.equal(r.parts.length, 3);
  assert.equal(r.parts[2].sign, -1);
});

test('rollDice : normalise espaces et casse', () => {
  assert.equal(rollDice('  2D6 + 1 ', rngMid).total, 9);   // 4+4+1
});

test('rollDice : expressions invalides → null', () => {
  for (const bad of ['abc', '', '1d', 'd', '1d20+', null, undefined, '2x6']) {
    assert.equal(rollDice(bad, rngMid), null, `devrait être null : ${bad}`);
  }
});

test('rollDice : bornes de sécurité (trop de dés / trop de faces)', () => {
  assert.equal(rollDice('101d6', rngMid), null);
  assert.equal(rollDice('1d1001', rngMid), null);
  assert.ok(rollDice('100d6', rngMid));      // limite haute acceptée
});

// ── rollCardHtml ──────────────────────────────────────────────────────────────
test('rollCardHtml : affiche le total et le détail des dés', () => {
  const out = rollCardHtml(rollDice('1d20+3', rngMid));
  assert.match(out, /chat-roll-total">🎲 14</);
  assert.match(out, /1d20 \[11\]/);
  assert.match(out, /\+3/);
});
