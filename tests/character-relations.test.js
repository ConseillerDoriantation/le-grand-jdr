import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cleanRelationLabel,
  pendingRelations,
  relationKind,
  relationNameMatch,
  sortRelations,
} from '../assets/js/features/characters/relations-utils.js';

test('le tri proximité va de Allié à Hostile puis place Pas d’avis en dernier', () => {
  const source = [
    { nom: 'Sans avis', sent: '' },
    { nom: 'Hostile', sent: 'ennemi' },
    { nom: 'Allié', sent: 'lien' },
    { nom: 'Amical', sent: 'allie' },
  ];
  assert.deepEqual(sortRelations(source).map(item => item.nom), ['Allié', 'Amical', 'Hostile', 'Sans avis']);
});

test('un libellé qui répète le palier est masqué', () => {
  assert.equal(cleanRelationLabel('Hostile', 'ennemi'), '');
  assert.equal(cleanRelationLabel('  méfiant ', 'mefiance'), '');
  assert.equal(cleanRelationLabel('Rival juré', 'ennemi'), 'Rival juré');
});

test('un charId obsolète reste dans les Autres liens', () => {
  assert.equal(relationKind({ charId: 'disparu', nom: 'Ancien compagnon' }, () => null), 'free');
  assert.equal(relationKind({ charId: 'présent' }, id => id === 'présent' ? { id } : null), 'pc');
});

test('les liens sans réponse excluent soi-même et les cibles déjà notées', () => {
  const current = { id: 'me', relations: [{ charId: 'known' }] };
  const chars = [
    current,
    { id: 'known', relations: [{ charId: 'me' }] },
    { id: 'pending', relations: [{ charId: 'me', sent: 'allie' }] },
    { id: 'unrelated', relations: [] },
  ];
  assert.deepEqual(pendingRelations(current, chars).map(char => char.id), ['pending']);
});

test('la correspondance de nom ignore les accents mais respecte les mots entiers', () => {
  const candidates = [{ id: '1', nom: 'Maître Voren' }, { id: '2', nom: 'Vorenna' }, { id: '3', nom: 'Jean-Pierre' }];
  assert.equal(relationNameMatch({ nom: 'Maitre Voren' }, candidates)?.id, '1');
  assert.equal(relationNameMatch({ nom: 'Voren' }, candidates)?.id, '1');
  assert.equal(relationNameMatch({ nom: 'Pierre' }, candidates)?.id, '3');
  assert.equal(relationNameMatch({ nom: 'Ore' }, candidates), null);
});

test('le rendu Relations reste inline et ne lit les PNJ qu’à la demande', () => {
  const source = readFileSync(new URL('../assets/js/features/characters/relations.js', import.meta.url), 'utf8');
  const renderStart = source.indexOf('export function renderCharRelations');
  const renderEnd = source.indexOf('export function relationPendingCount', renderStart);
  assert.match(source.slice(renderStart, renderEnd), /class=\"rl\"/);
  assert.doesNotMatch(source.slice(renderStart, renderEnd), /loadCollection\(/);
  assert.match(source, /getCachedCollection\('npcs'\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*600/);
  assert.doesNotMatch(source, /onclick=/);
});

test('le CSS reprend les trois colonnes et les adaptations du handoff', () => {
  const css = readFileSync(new URL('../assets/css/characters.css', import.meta.url), 'utf8');
  assert.match(css, /\.rl\s*\{[^}]*width:100%; max-width:none/);
  assert.match(css, /\.journal-shell\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
  assert.match(css, /\.rl-hd,\.rl-row\s*\{[^}]*grid-template-columns:minmax\(180px,\.95fr\) minmax\(0,1\.35fr\) minmax\(0,1fr\) 16px/);
  assert.match(css, /\.rl-sec\.solo \.rl-hd,\.rl-sec\.solo \.rl-row\s*\{[^}]*minmax\(0,2\.35fr\)/);
  assert.match(css, /@container \(max-width:860px\)/);
  assert.match(css, /@container \(max-width:680px\)/);
});

test('le lien Réseau ouvre les liens déclarés et garde une route partageable sans sélection', () => {
  const relations = readFileSync(new URL('../assets/js/features/characters/relations.js', import.meta.url), 'utf8');
  const players = readFileSync(new URL('../assets/js/features/players.js', import.meta.url), 'utf8');
  assert.match(relations, /data-nav-sub=\"relations\/characters\/\$\{encodeURIComponent\(c\.id\)\}\/declared\"/);
  assert.match(players, /selected \|\| '\/_'[^\n]*\/declared/);
  assert.match(players, /second !== '_'/);
});
