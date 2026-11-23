import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DASHBOARD_SUMMARY_VERSION,
  activeGroupsFromSources,
  buildDashboardSummary,
  compactDashboardSessions,
  isUsableSummary,
  sameSummary,
} from '../assets/js/shared/dashboard-summary.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const STORY = [
  { id: 'm1', type: 'mission', titre: 'La Forge', statut: 'En cours', acte: 'Acte II', lieu: 'Kharn', imageUrl: `data:image/png;base64,${'A'.repeat(10_000)}` },
  { id: 'm2', type: 'mission', titre: 'Le Pont', statut: 'Terminée' },
];
const QUESTS = [
  { id: 'g1', missionId: 'm1', titre: 'Les Braises', statut: 'active', participants: [{ uid: 'u1', charId: 'c1', nom: 'Ysolde', photo: 'data:image/png;base64,xxx' }] },
  { id: 'g2', missionId: 'm2', titre: 'Les Anciens', statut: 'active', participants: [] },
  { id: 'g3', missionId: 'm1', titre: 'Fermé', statut: 'done', participants: [] },
];
const AGENDA = { sessions: [
  { questId: 'g1', date: '2026-10-09', slot: 's', participantUids: ['u1'] },
  { questId: 'g1', date: '2026-10-17', slot: 'a' },
] };

test('résumé v2 : le statut du groupe prime sur celui de la mission', () => {
  const groups = activeGroupsFromSources(STORY, QUESTS);
  assert.deepEqual(groups.find(group => group.id === 'g1'), {
    id: 'g1', title: 'Les Braises', missionId: 'm1', missionTitle: 'La Forge',
    act: 'Acte II', location: 'Kharn', participants: [{ uid: 'u1', charId: 'c1', nom: 'Ysolde' }],
  });
  assert.deepEqual(groups.find(group => group.id === 'g2'), {
    id: 'g2', title: 'Les Anciens', missionId: 'm2', missionTitle: 'Le Pont',
    act: '', location: '', participants: [],
  });
  assert.equal(groups.some(group => group.id === 'g3'), false);
  assert.doesNotMatch(JSON.stringify(groups), /data:image/);
});

test('résumé v2 : la vignette de mission est optionnelle et jamais remplacée par imageUrl', () => {
  const thumb = 'data:image/jpeg;base64,dGVzdA==';
  const groups = activeGroupsFromSources(STORY, QUESTS, new Map([['m1', thumb]]));
  const group = groups.find(item => item.id === 'g1');
  assert.equal(group.missionThumb, thumb);
  assert.equal(group.imageUrl, undefined);
  const withoutThumb = buildDashboardSummary({ story: STORY, quests: QUESTS, agenda: AGENDA });
  assert.equal(isUsableSummary(withoutThumb), true);
  assert.equal(withoutThumb.groups.find(item => item.id === 'g1').missionThumb, undefined);
});

test('résumé v2 : les séances sont compactes et récupèrent les participants du groupe', () => {
  assert.deepEqual(compactDashboardSessions(AGENDA, QUESTS), [
    { key: 'g1|2026-10-09|s|0', date: '2026-10-09', slot: 's', questId: 'g1', participantUids: ['u1'] },
    { key: 'g1|2026-10-17|a|1', date: '2026-10-17', slot: 'a', questId: 'g1', participantUids: ['u1'] },
  ]);
});

test('résumé v2 : document complet, compact et Firestore-compatible', () => {
  const summary = buildDashboardSummary({ story: STORY, quests: QUESTS, agenda: AGENDA });
  assert.equal(summary.v, DASHBOARD_SUMMARY_VERSION);
  assert.equal(isUsableSummary(summary), true);
  assert.equal(isUsableSummary({ ...summary, v: 1 }), false);
  assert.equal(isUsableSummary({ v: 2, groups: [] }), false);
  assert.doesNotMatch(JSON.stringify(summary), /data:image|achievements|collection/);
  assert.ok(JSON.stringify(summary).length < 2000);
});

test('résumé v2 : une source arrivée plus tard conserve la partie déjà stockée', () => {
  const stored = buildDashboardSummary({ story: STORY, quests: QUESTS, agenda: AGENDA });
  const agendaOnly = buildDashboardSummary({ agenda: { sessions: [] } }, stored);
  assert.deepEqual(agendaOnly.groups, stored.groups);
  assert.deepEqual(agendaOnly.sessions, []);
  const groupsOnly = buildDashboardSummary({ story: STORY, quests: QUESTS }, stored);
  assert.deepEqual(groupsOnly.sessions, stored.sessions);
});

test('résumé v2 : comparaison stable sans réécriture pour le timestamp', () => {
  const summary = buildDashboardSummary({ story: STORY, quests: QUESTS, agenda: AGENDA });
  assert.equal(sameSummary(summary, { id: 'dashboardSummary', updatedAt: 42, ...summary }), true);
  assert.equal(sameSummary(summary, { ...summary, groups: [] }), false);
});

test('dashboard v4 : bannière, compagnie MJ et ordre joueur conformes au handoff', () => {
  const pages = read('assets/js/features/pages.js');
  const css = read('assets/css/dashboard.css');
  const dashboard = pages.match(/async dashboard\(\) \{([\s\S]*?)\n  \},\n\n  \/\/ ─── CHARACTERS/)?.[1] || '';
  for (const label of ['Prochaine séance', 'La compagnie', 'Groupes ouverts', 'Mur du Bastion']) assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /const sessionBanner = sessionSection\(sessionList, groupList\)/);
  assert.match(dashboard, /hasJoinedGroup \? \[characterSection, groupSection\] : \[groupSection, characterSection\]/);
  assert.match(dashboard, /\$\{top\}\$\{sessionBanner\}\$\{gmRosterSection\(groupList\)\}/);
  assert.match(dashboard, /dash-roster-view/);
  assert.match(dashboard, /id="db-roster-body"/);
  assert.match(dashboard, /members\.slice\(0, 6\)/);
  assert.match(dashboard, /_dashRosterFreeToggle/);
  assert.match(dashboard, /characterPortraitContent\(char/);
  assert.match(dashboard, /calcPalier\(level\)/);
  assert.match(dashboard, /groupJoined\(group\)/);
  assert.match(dashboard, /anciens résumés peuvent ne pas contenir participantUids/);
  assert.match(css, /grid-template-columns:minmax\(0,1\.65fr\) minmax\(300px,1fr\)/);
  assert.match(css, /\.db-roster-grid\{[^}]*repeat\(auto-fill,minmax\(236px,1fr\)\)/);
  assert.match(css, /\.db-hero\{[^}]*background:#0a0f18/);
  assert.match(css, /@container \(max-width:900px\)/);
  assert.match(css, /\.db :where\(button\)\{[^}]*background:none;border:0[^}]*text-align:left/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('dashboard v4 : aucune lecture lourde ni repli complet côté joueur', () => {
  const pages = read('assets/js/features/pages.js');
  const dashboard = pages.match(/async dashboard\(\) \{([\s\S]*?)\n  \},\n\n  \/\/ ─── CHARACTERS/)?.[1] || '';
  assert.doesNotMatch(dashboard, /loadStats|availabilities|bastion['"],\s*['"]main|achievements|collection|dash-bastion-wall-legacy|session-center/);
  assert.match(dashboard, /watchDoc\('dash-summary', 'settings', 'dashboardSummary'/);
  assert.match(dashboard, /if \(STATE\.isAdmin\) \{[\s\S]*watch\('dash-story'[\s\S]*watch\('dash-quests'[\s\S]*watchDoc\('dash-agenda'/);
});

test('mainteneur v2 : story et quests restent passifs, agenda est un document compact', () => {
  const maintainer = read('assets/js/features/dashboard-summary-maintainer.js');
  assert.match(maintainer, /const SOURCES = \['story', 'quests'\]/);
  assert.match(maintainer, /getCachedCollection\(col\) !== null\) _observe\(col\)/);
  assert.doesNotMatch(maintainer, /loadCollection\(/);
  assert.match(maintainer, /subscribeDoc\('agenda_session', 'next'/);
  assert.match(maintainer, /Array\.isArray\(next\.groups\)[\s\S]*Array\.isArray\(next\.sessions\)/);
  assert.match(maintainer, /canvas\.width = 48[\s\S]*canvas\.height = 36/);
  assert.match(maintainer, /toDataURL\('image\/jpeg', \.6\)/);
  assert.match(maintainer, /_imageFingerprint/);
  assert.match(maintainer, /quest\.statut \|\| 'active'/);
  assert.match(maintainer, /generation !== _thumbGeneration/);
  assert.match(maintainer, /setTimeout\(\(\) => finish\(''\), 5000\)/);
});
