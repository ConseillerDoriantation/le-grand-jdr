import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activeMissionDetails, buildDashboardSummary, compactStoryItems, isUsableSummary,
  pickActiveMission, sameSummary, storyItemsFromSummary, summarizeAchievements, summarizeCollection,
} from '../assets/js/shared/dashboard-summary.js';

// ── Jeu de données représentatif (base64, ex-æquo de dates, champs absents) ──
const BIG_IMAGE = `data:image/png;base64,${'A'.repeat(20_000)}`;
const STORY = [
  { id: 's1', type: 'mission', titre: 'La crypte', statut: 'Terminée', ordre: 1, imageUrl: BIG_IMAGE, description: 'x'.repeat(5000) },
  { id: 's2', type: 'mission', titre: 'Le pont', statut: 'En cours', ordre: 2, acte: 'Acte I', lieu: 'Valombre', description: 'Traverser.', imageUrl: BIG_IMAGE },
  { id: 's3', type: 'mission', titre: 'La tour', statut: 'En cours', ordre: 5, acte: 'Acte II', description: 'Grimper.', imageUrl: 'https://res.cloudinary.com/demo/tour.jpg' },
  { id: 's4', type: 'event', titre: 'Fête', statut: 'Échouée', ordre: 9 },
  { id: 's5', type: 'mission', nom: 'Sans titre', statut: 'Échouée' },
  { id: 's6', type: 'acte', titre: 'Acte I' },
];
const ACHIEVEMENTS = [
  { id: 'a1', titre: 'Premier sang', date: '03/02/2026', xp: 50, icone: '🩸', description: 'd1', imageUrl: BIG_IMAGE },
  { id: 'a2', titre: 'Secret', date: '01/12/2026', secret: true },
  { id: 'a3', nom: 'Ancien', date: '1/1/2025' },
  { id: 'a4', titre: 'Sans date' },
  { id: 'a5', titre: 'Égalité A', date: '03/02/2026' },
  { id: 'a6', titre: 'Récent', date: '15/09/2026', xp: 10 },
  { id: 'a7', titre: 'Égalité B', date: '03/02/2026' },
  { id: 'a8', titre: 'Date cassée', date: '2026-09-15' },
];
const COLLECTION = [
  { id: 'c1', unlocked: true, imageUrl: BIG_IMAGE },
  { id: 'c2', unlocked: false },
  { id: 'c3' },
  { id: 'c4', unlocked: true },
];

// Ancien code du dashboard, recopié tel quel : la référence à respecter.
function legacyTopAchievements(list, isAdmin) {
  const achievements = isAdmin ? list : list.filter(a => !a.secret);
  return { count: achievements.length, top: achievements.slice(0, 5).length > 0 ? [...achievements].sort((a,b) => { const p = d => { const [j,m,y] = (d||'').split('/'); return y&&m&&j?`${y}${m.padStart(2,'0')}${j.padStart(2,'0')}`:''; }; return p(b.date) > p(a.date) ? 1 : -1; }).slice(0, 5) : [] };
}
function legacyMission(storyItems) {
  return storyItems
    .filter(i => i.type === 'mission' && i.statut === 'En cours')
    .sort((a,b) => (b.ordre||0) - (a.ordre||0))[0] || null;
}
function storyView(items) {
  const mission = legacyMission(items);
  return {
    mission: mission && {
      id: mission.id, titre: mission.titre, nom: mission.nom, acte: mission.acte,
      lieu: mission.lieu, description: mission.description, imageUrl: mission.imageUrl,
    },
    totalMissions: items.filter(i => i.type === 'mission').length,
    doneMissions: items.filter(i => i.type === 'mission' && i.statut === 'Terminée').length,
    activeMissionCount: items.filter(i => i.type === 'mission' && i.statut === 'En cours').length,
    doneIds: items.filter(i => i.statut === 'Terminée' || i.statut === 'Échouée').map(i => i.id),
    titles: items.map(i => [i.id, i.titre || 'Mission']),
    sessionCenter: items.filter(m => m?.id).map(m => [m.id, m.titre, m.nom, m.statut]),
  };
}

function hasUndefinedDeep(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefinedDeep);
  if (value && typeof value === 'object') return Object.values(value).some(hasUndefinedDeep);
  return false;
}

test('résumé : la vue joueur de la Trame est identique à celle des données complètes', () => {
  const summary = buildDashboardSummary({ story: STORY, achievements: ACHIEVEMENTS, collection: COLLECTION });
  // La mission active a une image Cloudinary (URL) → embarquée telle quelle.
  assert.deepEqual(storyView(storyItemsFromSummary(summary)), storyView(STORY));
});

test('résumé : une image base64 de mission active reste hors du résumé (carte non rendue)', () => {
  const story = STORY.map(i => (i.id === 's3' ? { ...i, imageUrl: BIG_IMAGE } : i));
  const summary = buildDashboardSummary({ story });
  assert.equal(summary.story.active.id, 's3');
  assert.equal(summary.story.active.hasImage, true);
  assert.equal(summary.story.active.imageUrl, undefined);
  // Tout le reste de la vue Trame est identique ; seule l'image base64 manque.
  const { mission: viaSummary, ...restSummary } = storyView(storyItemsFromSummary(summary));
  const { mission: viaFull, ...restFull } = storyView(story);
  assert.deepEqual(restSummary, restFull);
  assert.deepEqual({ ...viaSummary, imageUrl: BIG_IMAGE }, viaFull);
  // Garde : la carte « Mission active » n'est toujours pas rendue au dashboard.
  const pages = readFileSync(new URL('../assets/js/features/pages.js', import.meta.url), 'utf8');
  assert.equal((pages.match(/_missionCardV2\(\)/g) || []).length, 1, 'si la carte est réactivée, relire son image base64');
});

test('résumé : hauts-faits identiques à l’ancien tri (ex-æquo, dates cassées, secrets)', () => {
  for (const isAdmin of [false, true]) {
    const legacy = legacyTopAchievements(ACHIEVEMENTS, isAdmin);
    const current = summarizeAchievements(ACHIEVEMENTS, { isAdmin });
    assert.equal(current.count, legacy.count);
    assert.deepEqual(current.top.map(a => a.id), legacy.top.map(a => a.id));
    for (const [i, a] of current.top.entries()) {
      for (const key of ['titre', 'nom', 'description', 'icone', 'xp']) assert.equal(a[key], legacy.top[i][key]);
    }
  }
  // Les joueurs ne voient jamais un haut-fait secret, même via le résumé.
  const summary = buildDashboardSummary({ achievements: ACHIEVEMENTS });
  assert.equal(summary.achievements.count, 7);
  assert.ok(!summary.achievements.top.some(a => a.id === 'a2'));
  assert.deepEqual(summarizeAchievements([]), { count: 0, top: [] });
});

test('résumé : compteurs de collection identiques', () => {
  assert.deepEqual(summarizeCollection(COLLECTION), { total: 4, unlocked: 2 });
  assert.deepEqual(summarizeCollection([]), { total: 0, unlocked: 0 });
});

test('résumé : document Firestore-compatible, compact et sans base64', () => {
  const summary = buildDashboardSummary({ story: STORY, achievements: ACHIEVEMENTS, collection: COLLECTION });
  assert.equal(hasUndefinedDeep(summary), false, 'Firestore refuse undefined');
  const json = JSON.stringify(summary);
  assert.doesNotMatch(json, /data:image/);
  assert.ok(json.length < 3000, `résumé trop gros : ${json.length} octets`);
  assert.deepEqual(Object.keys(compactStoryItems([{ id: 'x', type: 'mission', imageUrl: BIG_IMAGE, description: 'long' }])[0]), ['id', 'type']);
  assert.equal(activeMissionDetails([]), null);
});

test('résumé : une source non chargée garde la partie déjà stockée', () => {
  const stored = buildDashboardSummary({ story: STORY, achievements: ACHIEVEMENTS, collection: COLLECTION });
  const next = buildDashboardSummary({ story: STORY.slice(0, 2) }, stored);
  assert.deepEqual(next.achievements, stored.achievements);
  assert.deepEqual(next.collection, stored.collection);
  assert.equal(next.story.items.length, 2);
  assert.equal(buildDashboardSummary({}, null).story, undefined);
});

test('résumé : utilisable seulement complet ; parties premium facultatives si non accessibles', () => {
  const full = buildDashboardSummary({ story: STORY, achievements: ACHIEVEMENTS, collection: COLLECTION });
  assert.equal(isUsableSummary(full), true);
  assert.equal(isUsableSummary(null), false);
  assert.equal(isUsableSummary({ ...full, v: 2 }), false);
  const storyOnly = buildDashboardSummary({ story: STORY });
  assert.equal(isUsableSummary(storyOnly), false, 'Collection / Hauts-faits exigés par défaut');
  assert.equal(isUsableSummary(storyOnly, { achievements: false, collection: false }), true);
  assert.equal(isUsableSummary({ ...full, collection: { total: 'x' } }, { collection: false }), false, 'partie présente mais invalide');
  assert.equal(isUsableSummary({ v: 1, achievements: full.achievements, collection: full.collection }), false, 'Trame obligatoire');
});

test('résumé : la comparaison ignore horodatage, id et ordre des clés (aucune réécriture inutile)', () => {
  const a = buildDashboardSummary({ story: STORY, achievements: ACHIEVEMENTS, collection: COLLECTION });
  const stored = { id: 'dashboardSummary', updatedAt: 123, ...JSON.parse(JSON.stringify(a)) };
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(sameSummary(reordered, stored), true);
  assert.equal(sameSummary(a, null), false);
  const changed = buildDashboardSummary({ story: STORY, achievements: ACHIEVEMENTS, collection: [...COLLECTION, { id: 'c5' }] });
  assert.equal(sameSummary(changed, stored), false);
});

test('résumé : câblage — MJ inchangé, joueur avec repli, mainteneur passif', () => {
  const read = rel => readFileSync(new URL(`../assets/js/${rel}`, import.meta.url), 'utf8');
  const pages = read('features/pages.js');
  const firestore = read('data/firestore.js');
  const maintainer = read('features/dashboard-summary-maintainer.js');
  const adventure = read('core/adventure.js');
  const lazyDocs = firestore.match(/_LAZY_SESSION_DOCS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.match(lazyDocs, /'settings\/dashboardSummary'/);
  // MJ : lecture complète, comme avant. Joueur : résumé, repli si inutilisable.
  assert.match(pages, /if \(STATE\.isAdmin\) \{\s*watchFullSources\(\);\s*\} else \{/);
  assert.match(pages, /if \(!usable\) \{[\s\S]{0,200}watchFullSources\(\);/);
  // Plus aucun calcul local dupliqué des compteurs : un seul helper partagé.
  assert.doesNotMatch(pages, /collectionItems\.filter\(c => c\.unlocked\)/);
  assert.doesNotMatch(pages, /p\(b\.date\) > p\(a\.date\)/);
  // Le mainteneur ne s'accroche qu'aux collections déjà chargées (jamais d'amorçage).
  assert.match(maintainer, /if \(!_observed\.has\(col\) && getCachedCollection\(col\) !== null\) _observe\(col\);/);
  assert.doesNotMatch(maintainer, /loadCollection\(/);
  // Exception : une source MODIFIÉE par le MJ sans être chargée est amorcée,
  // seulement pour l'aventure courante (les écritures cross-aventures passent aussi ici).
  assert.match(maintainer, /document\.addEventListener\('app:data-written', _onDataWritten\)/);
  assert.match(maintainer, /event\.detail\.path !== `adventures\/\$\{_adventureId\}\/\$\{col\}`/);
  // Chaque écriture réussie de la couche data passe par _afterWrite.
  for (const fn of ['_cachePatchAdd', '_cachePatchUpdate', '_cachePatchSave', '_cachePatchReplace', '_cachePatchDelete']) {
    assert.match(firestore, new RegExp(`function ${fn}\\([^)]*\\) \\{\\n  _afterWrite\\(path\\);`), fn);
  }
  assert.match(maintainer, /if \(!next\.story \|\| sameSummary\(next, _stored\)\) return;/);
  assert.match(adventure, /if \(STATE\.isAdmin\) \{\s*import\('\.\.\/features\/dashboard-summary-maintainer\.js'\)/);
});
