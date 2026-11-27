import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChronicle, chronicleDay, interpolateChronicle } from '../assets/js/features/achievements-chronicle-model.js';
import { chronicleHighlight, chroniclePreset, renderChronicle } from '../assets/js/features/achievements-chronicle.js';

const missions = [
  { id: 'm1', titre: 'Les Ruines', acte: 'Acte I' },
  { id: 'm2', titre: 'Les Neiges', acte: 'Acte II', type: 'event' },
];
const item = (id, date, missionId = 'm1', extras = {}) => ({ id, date, missionId, titre: id, categorie: 'c', ...extras });
const entries = [
  item('A', '2025-11-29', 'm1', { contributeurs: ['ol', 'jd'] }),
  item('B', '2025-12-13'),
  item('C', '2026-01-10', 'deleted'),
  item('D', '2026-01-24'),
  item('SECRET', '2026-01-30', 'm2', { secret: true, contributeurs: ['ze'] }),
  item('E', '2026-02-07', 'm2', { contributeurs: ['ze', 'jd'], imageUrl: '/portrait.jpg', aspectRatio: .55, featured: true }),
  item('F', '2026-02-07', 'm2', { titre: 'La poule sacrée', description: 'Une POULE. Épée !' }),
  item('G', '2026-02-07', 'm1'),
  item('Sans date', '', ''),
];
const category = { id: 'c', label: 'Souvenir', color: '#4f8cff' };
const render = (model, overrides = {}) => renderChronicle(model, {
  categories: [category], categoryFor: () => category, isNew: item => item.id === 'E',
  characters: [{ id: 'jd', nom: 'Jader' }, { id: 'ze', nom: 'Zephyr' }],
  isAdmin: false, bulk: false, selected: new Set(), search: '', hasFilters: false, desc: false, mode: 'recit',
  news: '', bulkBar: '', animate: false, ...overrides,
});

test('regroupe les dates, choisit la mission majoritaire et sépare actes, interludes et suites', () => {
  const m = buildChronicle(entries, missions);
  assert.equal(m.sessions.length, 6);
  assert.equal(m.dated.at(-1).entries.length, 3);
  assert.equal(m.dated.at(-1).mission.id, 'm2');
  assert.deepEqual(m.chapters.map(c => [c.mission?.id, c.suite]), [['m1', false], [undefined, false], ['m1', true], ['m2', false], [undefined, false]]);
  assert.deepEqual(m.acts.map(a => a.label), ['Acte I', 'Acte II']);
  assert.equal(m.cadence, 14);
  assert.deepEqual(m.pauses.map(p => [p.label, p.duration]), [['Trêve des fêtes', '4 semaines']]);
  assert.equal(m.sessions.at(-1).key, 'sans-date');
});

test('garde la vraie cadence et les débuts côté joueur malgré le filtre, sans exposer de secret', () => {
  const m = buildChronicle(entries, missions, { filteredIds: new Set(['A', 'E', 'SECRET']) });
  assert.deepEqual(m.visible.map(s => s.key), ['2025-11-29', '2026-02-07']);
  assert.deepEqual(m.dated.at(-1).debut, ['ze']);
  assert.equal(m.dated.at(-1).entries.length, 3);
  assert.equal(m.rows.find(r => r.type === 'gap').label, '3 séances masquées');
  assert.equal(m.pauses[0].label, 'Trêve des fêtes');
  const { html } = render(m, { hasFilters: true });
  assert.match(html, /2 hauts-faits dans 2 séances sur 6/);
  assert.match(html, /class="off"/);
  assert.doesNotMatch(html, /SECRET|2026-01-30|_achChronicleAdd/);
  const picker = html.match(/<select class="cr-session-select"[\s\S]+?<\/select>/)[0];
  assert.match(picker, /value="2026-02-07"/);
  assert.doesNotMatch(picker, /2026-01-10|2026-01-30/);
  const gm = buildChronicle(entries, missions, { isAdmin: true });
  assert.deepEqual(gm.dated.find(s => s.date === '2026-01-30').debut, ['ze']);
  assert.deepEqual(gm.dated.at(-1).debut, []);
});

test('inverse le récit, pas la frise, et laisse les dates manquantes à la fin', () => {
  const m = buildChronicle(entries, missions, { desc: true });
  assert.deepEqual(m.visible.map(s => s.key), ['2026-02-07', '2026-01-24', '2026-01-10', '2025-12-13', '2025-11-29', 'sans-date']);
  const { html, compact } = render(m, { mode: 'sommaire', desc: true, isAdmin: true, search: 'poule' });
  assert.match(html, /cr is-sm/);
  assert.ok(html.indexOf('data-key="next"') < html.lastIndexOf('data-key="2026-02-07"'));
  assert.match(html, /La <mark>poule<\/mark> sacrée/);
  assert.match(html, /Tout a commencé ici/);
  assert.ok(compact.indexOf('data-key="2025-11-29"') < compact.indexOf('data-key="2026-02-07"'));
});

test('ajoute au bon chapitre avec les suggestions de la séance et respecte les interludes', () => {
  const m = buildChronicle(entries, missions);
  const p = chroniclePreset(m, '2026-02-07', '2026-11-26');
  assert.deepEqual(p.suggestedContributors, ['ze', 'jd']);
  assert.equal(p.missionId, 'm2');
  assert.equal(p.date, '2026-02-07');
  assert.match(p.context, /Séance du 7 févr\. 2026/);
  assert.equal(chroniclePreset(m, '2026-01-10', '2026-11-26').missionId, '');
  assert.equal(chroniclePreset(m, 'next', '2026-11-26').date, '2026-11-26');
  assert.equal(chroniclePreset(m, 'inconnue', '2026-11-26'), null);
});

test('gère les dates invalides, la médiane paire, et la pause estivale', () => {
  assert.ok(Number.isNaN(chronicleDay('2026-02-30')));
  const dates = ['2026-06-26', '2026-07-10', '2026-07-17', '2026-09-18', '2026-09-25', '2026-02-30'];
  const m = buildChronicle(dates.map((date, i) => item(String(i), date)), missions);
  assert.equal(m.cadence, 10.5);
  assert.equal(m.pauses[0].label, 'Pause estivale');
  assert.equal(m.pauses[0].duration, '9 semaines');
  assert.equal(m.sessions.at(-1).date, '');
});

test('surligne sans accent et sans interpréter le récit comme HTML', () => {
  assert.equal(chronicleHighlight('<ÉPE\u0301E> & épée.', 'epee'), '&lt;<mark>ÉPE\u0301E</mark>&gt; &amp; <mark>épée</mark>.');
  const { html } = render(buildChronicle(entries, missions), { search: 'poule' });
  assert.match(html, /Une <mark>POULE<\/mark>/);
  assert.match(html, /class="cr-e feat is-new"/);
  assert.match(html, /loading="lazy" decoding="async"/);
});

test('interpole dans les deux sens et borne les extrémités, y compris en ordre inverse', () => {
  const points = [{ t: 20, y: 120 }, { t: 10, y: 420 }, { t: 0, y: 520 }];
  assert.equal(interpolateChronicle(points, 15, 't', 'y'), 270);
  assert.equal(interpolateChronicle(points, 470, 'y', 't'), 5);
  assert.equal(interpolateChronicle(points, -3, 't', 'y'), 520);
  assert.equal(interpolateChronicle(points, 10, 'y', 't'), 20);
  assert.equal(interpolateChronicle([], 5, 't', 'y'), null);
});

test('garde une chronique utilisable sans date ni résultat de filtre', () => {
  const undated = buildChronicle([item('Sans date', '', '')], missions);
  const { html, compact } = render(undated);
  assert.match(html, /Sans date/);
  assert.match(html, /<option value="sans-date">Sans date<\/option>/);
  assert.doesNotMatch(html, /role="slider"/);
  assert.equal(compact, '');
  assert.equal(chroniclePreset(undated, 'sans-date', '2026-11-26').date, '');
  const filtered = buildChronicle(entries, missions, { filteredIds: new Set() });
  assert.match(render(filtered, { hasFilters: true }).html, /Aucun résultat dans la chronique/);
  assert.equal(filtered.dated.length, 5);
});
