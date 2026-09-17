import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSheetLines } from '../assets/js/shared/spell-sheet-lines.js';

const ids = (state) => computeSheetLines(state).map((l) => l.id);
const line = (state, id) => computeSheetLines(state).find((l) => l.id === id);

test('offensif pur (Puissance) → Dégâts + Toucher (2 lignes), maîtrise sur les dégâts', () => {
  const s = { types: ['offensif'], counts: { Puissance: 2 } };
  assert.deepEqual(ids(s), ['dmg', 'hit']);
  assert.equal(line(s, 'dmg').mastery, 'damage');
  assert.equal(line(s, 'dmg').override.fieldId, 's-degats');
  assert.equal(line(s, 'hit').override.toucherId, 's-toucher-stat');
  assert.equal(line(s, 'hit').override.statOnly, true);
});

test('ordre stable : ajouter Protection ne décale pas les Dégâts', () => {
  const base = { types: ['offensif'], counts: { Puissance: 1 } };
  const plus = { types: ['offensif'], counts: { Puissance: 1, Protection: 1 }, protMode: 'ca' };
  assert.deepEqual(ids(base), ['dmg', 'hit']);
  // offensif + Protection = Drain : la ligne prot vient APRÈS, dmg/hit inchangés en tête.
  assert.deepEqual(ids(plus), ['dmg', 'hit', 'prot']);
  assert.equal(line(plus, 'prot').drain, true);            // vol de vie %
  assert.equal(line(plus, 'prot').segment, undefined);     // CA/Soin masqués en Drain
});

test('Protection soin (soutien) : ligne unique avec segment + maîtrise de soin', () => {
  const s = { types: ['defensif'], counts: { Protection: 2 }, protMode: 'soin' };
  assert.deepEqual(ids(s), ['prot']);
  const l = line(s, 'prot');
  assert.equal(l.override.fieldId, 's-soin');
  assert.equal(l.mastery, 'heal');
  assert.equal(l.segment.hiddenId, 's-prot-mode');
});

test('Protection CA + Réaction = Bouclier réactif : pas d’override', () => {
  const s = { types: ['defensif'], counts: { Protection: 1, Déclenchement: 1 }, protMode: 'ca', actionMode: 'reaction' };
  const l = line(s, 'prot');
  assert.equal(l.reactiveShield, true);
  assert.equal(l.override, undefined);
  assert.deepEqual(ids(s), ['prot', 'trig']);
});

test('Régénération (Protection + Affliction) remplace Protection ET Affliction', () => {
  const s = { types: ['defensif'], counts: { Protection: 1, Affliction: 1 }, afflMode: 'dot' };
  assert.deepEqual(ids(s), ['regen']);
  assert.equal(line(s, 'regen').override.fieldId, 's-regeneration-formula');
  assert.equal(line(s, 'prot'), undefined);
  assert.equal(line(s, 'affl'), undefined);
});

test('Affliction DoT (offensif) : supprime les dégâts d’impact, segment + override DoT', () => {
  const s = { types: ['offensif'], counts: { Puissance: 1, Affliction: 1 }, afflMode: 'dot' };
  assert.deepEqual(ids(s), ['affl']);                       // pas de hit/dmg (debuff)
  const l = line(s, 'affl');
  assert.equal(l.override.fieldId, 's-affliction-dot-formula');
  assert.equal(l.segment.hiddenId, 's-affliction-mode');
});

test('Affliction mode État : sélecteur d’état + save stat, pas d’override formule', () => {
  const s = { types: ['offensif'], counts: { Affliction: 1 }, afflMode: 'etat' };
  const l = line(s, 'affl');
  assert.equal(l.select.hiddenId, 's-affliction-etat');
  assert.equal(l.select.saveStatId, 's-affliction-save-stat');
  assert.equal(l.override, undefined);
});

test('Affliction Lacération : dégâts d’impact reviennent (frappe de base), pas d’override', () => {
  const s = { types: ['utilitaire'], counts: { Affliction: 1 }, afflMode: 'laceration' };
  // isLaceration → attack visible même sans « offensif »
  assert.deepEqual(ids(s), ['dmg', 'hit', 'affl']);
  assert.equal(line(s, 'affl').override, undefined);       // valeur calculée (CA −n)
});

test('Sentinelle (Affliction + Invocation) : affliction portée, pas d’invocation générique', () => {
  const s = { types: ['utilitaire'], counts: { Affliction: 1, Invocation: 1 }, afflMode: 'dot' };
  const l = line(s, 'affl');
  assert.equal(l.sentinelle, true);
  assert.equal(l.segment, undefined);
  assert.equal(line(s, 'inv'), undefined);                 // invocation générique masquée
});

test('Amplification ≥2 + Dispersion : ligne zone + sous-ligne forme + poses', () => {
  const s = { types: ['utilitaire'], counts: { Amplification: 2, Dispersion: 1 }, ampMode: 'zone', zoneShape: 'rect' };
  // v2 : forme débloquée à ≥2 Amp, et Dispersion ajoute la ligne « poses ».
  assert.deepEqual(ids(s), ['amp', 'shape', 'disp']);
  assert.equal(line(s, 'shape').sub, true);
  assert.equal(line(s, 'shape').segment.hiddenId, 's-zone-shape');
  assert.equal(line(s, 'shape').segment.opts.length, 5);   // rect / cross / cone / ring / line
  assert.ok(line(s, 'shape').segment.opts.some(o => o[0] === 'line'));
});

test('1 Amplification : PAS de sélecteur de forme (toujours une ligne 1×3)', () => {
  const s = { types: ['utilitaire'], counts: { Amplification: 1, Dispersion: 1 }, ampMode: 'zone', zoneShape: 'cone' };
  assert.deepEqual(ids(s), ['amp', 'disp']);   // pas de ligne 'shape'
  assert.equal(line(s, 'shape'), undefined);
});

test('Amplification ≥2 SANS Dispersion : la forme est réglable (v2)', () => {
  const s = { types: ['utilitaire'], counts: { Amplification: 2 }, ampMode: 'zone', zoneShape: 'cone' };
  assert.deepEqual(ids(s), ['amp', 'shape']);   // pas de ligne poses sans Dispersion
  assert.equal(line(s, 'shape').segment.cur, 'cone');
});

test('Amplification déplacement : segment zone/dépl, pas de dégâts', () => {
  const s = { types: ['offensif'], counts: { Amplification: 1 }, ampMode: 'deplacement' };
  assert.deepEqual(ids(s), ['amp']);
  assert.equal(line(s, 'amp').segment.hiddenId, 's-amp-mode');
});

test('Enchantement masque la ligne Amplification (Amp booste l’état)', () => {
  // Offensif → pas de soin d'amplification, on isole bien l'absence de ligne « amp ».
  const s = { types: ['offensif'], counts: { Enchantement: 1, Amplification: 1 } };
  assert.equal(line(s, 'amp'), undefined);                 // Amp masquée (booste l'état)
  assert.equal(line(s, 'ench').select.hiddenId, 's-enchant-etat');
});

test('Dispersion seule : ligne cibles sans override', () => {
  const s = { types: ['offensif'], counts: { Puissance: 1, Dispersion: 1 } };
  // Dispersion seule n'empêche pas les dégâts : dmg + hit puis cibles
  assert.deepEqual(ids(s), ['dmg', 'hit', 'disp']);
  assert.equal(line(s, 'disp').override, undefined);
});

test('Coup de chance (Chance + Déclenchement réaction) supprime les dégâts', () => {
  const s = { types: ['offensif'], counts: { Puissance: 1, Chance: 1, Déclenchement: 1 }, actionMode: 'reaction' };
  assert.equal(line(s, 'dmg'), undefined);                 // isCoupChance masque l'impact
  assert.deepEqual(ids(s), ['trig', 'mods']);
  assert.deepEqual(line(s, 'mods').chips, ['Chance']);
});

test('Modificateurs : Chance + Concentration → chips read-only en dernier', () => {
  const s = { types: ['utilitaire'], counts: { Chance: 1, Concentration: 1 } };
  const l = line(s, 'mods');
  assert.deepEqual(l.chips, ['Chance', 'Concentration']);
});

test('Déclenchement : segment Réac/Bonus', () => {
  const s = { types: ['offensif'], counts: { Déclenchement: 1 }, actionMode: 'action_bonus' };
  assert.equal(line(s, 'trig').segment.opts.length, 2);
});

test('aucun effet (sort vide) → aucune ligne', () => {
  assert.deepEqual(ids({ types: ['utilitaire'], counts: {} }), []);
});

test('ordre canonique complet préservé sur un sort chargé', () => {
  // Soutien avec Protection(CA)+Enchantement+Déclenchement+Chance+Concentration.
  const s = { types: ['defensif'], counts: { Protection: 1, Enchantement: 1, Déclenchement: 1, Chance: 1, Concentration: 1 }, protMode: 'ca', actionMode: 'action_bonus' };
  // action_bonus → pas de Bouclier réactif ni Coup de chance
  assert.deepEqual(ids(s), ['prot', 'ench', 'trig', 'mods']);
  assert.equal(line(s, 'prot').override.fieldId, 's-ca');  // CA réglable (pas réactif)
});

test('Soin via Amplification (soutien + Amp, sans Protection) : ligne soin autonome', () => {
  const s = { types: ['defensif'], counts: { Amplification: 1 }, ampMode: 'zone' };
  // amp line (zone) + soin autonome ? soinBearing = isAmpSupportHeal → ligne 'soin' slot prot
  const list = ids(s);
  assert.ok(list.includes('soin'));
  assert.ok(list.includes('amp'));
  // ordre : soin (slot prot) avant amp (slot zone)
  assert.ok(list.indexOf('soin') < list.indexOf('amp'));
  assert.equal(line(s, 'soin').mastery, 'heal');
});

// ── renderSheetLines : le HTML préserve les ids/actions du contrat DOM ──
import { renderSheetLines } from '../assets/js/shared/spell-sheet-lines.js';

test('renderSheetLines : état vide → bloc « choisis un élément »', () => {
  assert.match(renderSheetLines([], {}, new Set()), /ln-none/);
});

test('renderSheetLines : override de dégâts (tuned) écrit via proxy data-ovr / data-statproxy', () => {
  const lines = computeSheetLines({ types: ['offensif'], counts: { Puissance: 1 } });
  const html = renderSheetLines(lines, { dmg: { value: '2d8', statHtml: '<option>Force</option>' } }, new Set(['dmg']));
  assert.match(html, /data-action="_toggleLineTune" data-line="dmg"/);
  assert.match(html, /data-ovr="s-degats"/);
  assert.match(html, /data-statproxy="s-degats-stat"/);
  assert.match(html, /data-action="_lineTuneAuto"/);
});

test('renderSheetLines : ligne Toucher (statOnly) expose le proxy s-toucher-stat', () => {
  const lines = computeSheetLines({ types: ['offensif'], counts: { Puissance: 1 } });
  const html = renderSheetLines(lines, { hit: { value: '1d20', toucherHtml: '<option>Int</option>' } }, new Set(['hit']));
  assert.match(html, /data-statproxy="s-toucher-stat"/);
});

test('renderSheetLines : segment Protection écrit via _selectProtMode + hidden préservé', () => {
  const lines = computeSheetLines({ types: ['defensif'], counts: { Protection: 1 }, protMode: 'soin' });
  const html = renderSheetLines(lines, { prot: { value: '1d4' } }, new Set());
  assert.match(html, /data-action="_selectProtMode" data-val="ca"/);
  assert.match(html, /class="sg on" style="[^"]*" data-action="_selectProtMode" data-val="soin"/);
});
