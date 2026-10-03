import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/aventures.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../assets/js/core/adventure.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/adventure-hub.css', import.meta.url), 'utf8');

test('le hub Aventures reprend filtres, recherche, liste dense et détail collant', () => {
  assert.match(source, /class="av-page"/);
  assert.match(source, /data-action="_advFilter"/);
  assert.match(source, /data-input="_advSearch"/);
  assert.match(source, /data-change="_advSort"/);
  assert.match(source, /class="av-row/);
  assert.match(source, /class="av-detail"/);
  assert.match(css, /\.av-split\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+340px/);
  assert.match(css, /\.av-detail\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /@container avhub \(max-width:\s*980px\)/);
});

test('les deux actions d en-tête gardent le format compact de la maquette', () => {
  assert.match(css, /\.av-header-actions \.av-btn\s*\{[\s\S]*min-height:\s*0[\s\S]*padding:\s*7px 14px[\s\S]*border-radius:\s*var\(--r-full\)[\s\S]*font:\s*600 \.76rem\/1\.2 var\(--font-body\)/);
  assert.match(css, /\.av-header-actions \.av-btn\.is-quiet\s*\{[\s\S]*background:\s*var\(--surface-3\)/);
  assert.match(css, /\.av-header-actions \.av-btn\.is-primary\s*\{[\s\S]*background:\s*var\(--gold\)/);
});

test('les comptes et le personnage favori utilisent leurs portraits dans le hub', () => {
  assert.match(source, /avatarSrcOf\(profile\)/);
  assert.match(source, /getDefaultCharForUser\(cachedCharacters, uid\)/);
  assert.match(source, /characterAvatarHtml/);
  assert.match(source, /class="av-row-role' \+ \(role === 'Joueur' && char \? ' has-character'/);
  assert.match(css, /\.av-row-role\.has-character\s*\{[\s\S]*display:\s*flex/);
});

test('le pied du détail reprend les boutons compacts en pilule', () => {
  assert.match(source, /class="av-btn-icon"/);
  assert.match(source, /class="av-btn is-secondary"[^>]*>Gérer/);
  assert.match(css, /\.av-detail-actions > \.av-btn\s*\{[\s\S]*flex:\s*1 1 0[\s\S]*padding:\s*8px 14px[\s\S]*border-radius:\s*var\(--r-full\)/);
  assert.match(css, /\.av-detail-actions > \.av-btn\.is-primary\s*\{[\s\S]*background:\s*var\(--blue\)/);
});

test('une aventure sans prochaine séance reste affichable', () => {
  assert.match(source, /const source = raw && typeof raw === 'object' \? raw : \{\}/);
  assert.match(source, /if \(!value\) return null/);
});

test('la prochaine séance vient du document Agenda partagé et respecte la visibilité', () => {
  assert.match(source, /watchPageDoc\('adventures-agenda-session', 'agenda_session', 'next', 'aventures'/);
  assert.match(source, /agendaSessionsFromDoc\(_hub\.agendaSession\)/);
  assert.match(source, /isAgendaSessionUpcoming\(session, _todayIso\(\)\)/);
  assert.match(source, /session\.participantUids\.includes\(uid\)/);
  assert.match(source, /session\.slotLabel \? ' · ' \+ session\.slotLabel/);
});

test('les actions de gestion reprennent les boutons compacts de la maquette', () => {
  assert.match(css, /\.adv-manage-v3 \.av-btn\s*\{[\s\S]*padding:\s*7px 14px[\s\S]*border-radius:\s*var\(--r-full\)[\s\S]*font:\s*600 \.76rem\/1\.2 var\(--font-body\)/);
  assert.match(css, /\.adv-manage-v3 \.av-btn\.is-primary\s*\{[\s\S]*background:\s*var\(--gold\)/);
  assert.match(css, /\.adv-manage-v3 \.av-btn\.is-danger\s*\{[\s\S]*background:\s*var\(--crimson\)/);
  assert.doesNotMatch(source, /Exporter la campagne[\s\S]{0,240}av-btn is-quiet/);
  assert.doesNotMatch(source, /Archiver l’aventure[\s\S]{0,360}av-btn is-quiet/);
});

test('les modales Aventures utilisent aperçu vivant, couleurs et onglets latéraux', () => {
  assert.match(source, /_advCreatePreview/);
  assert.match(source, /_advPickColor/);
  for (const tab of ['presentation', 'members', 'pages', 'backup', 'danger']) {
    assert.match(source, new RegExp("\\['" + tab + "'"));
  }
  assert.match(css, /\.av-manage-layout\s*\{[\s\S]*grid-template-columns:\s*180px/);
});

test('le rendu n ajoute aucune lecture par aventure ou par membre', () => {
  assert.doesNotMatch(source, /from ['"]\.\.\/config\/firebase\.js['"]/);
  assert.doesNotMatch(source, /\bloadCollection\b|\bgetDocData\b|\bsubscribeCollection\b/);
  assert.match(source, /memberProfiles/);
  assert.match(source, /invitationsPromise/);
});

test('couleur et archivage passent par la couche métier existante', () => {
  assert.match(core, /createAdventure\(\{\s*nom,\s*emoji[^}]*color/);
  assert.match(core, /updateAdventureMeta\(adventureId,\s*\{[^}]*color,\s*status/);
  assert.match(core, /\['active',\s*'archived'\]\.includes\(status\)/);
  assert.match(source, /updateAdventureMeta\(advId,\s*\{\s*status:/);
});

test('la nouvelle page ne réintroduit aucun emblème emoji', () => {
  assert.doesNotMatch(source, /\p{Extended_Pictographic}/u);
  assert.match(source, /_monogram/);
});
