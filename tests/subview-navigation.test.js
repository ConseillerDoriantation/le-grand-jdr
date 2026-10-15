import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retour et Avance délèguent une sous-route à la page courante sans la recharger', async () => {
  const navigation = await read('assets/js/core/navigation.js');
  assert.match(navigation, /page === STATE\.currentPage[\s\S]*app:route-sub-changed/);
  assert.match(navigation, /cancelable:\s*true/);
  assert.match(navigation, /if \(handled\) return;[\s\S]*navigate\(page, \{ historyMode: 'none' \}\)/);
});

test('les sous-routes savent créer ou remplacer une étape d’historique', async () => {
  const route = await read('assets/js/shared/route.js');
  assert.match(route, /setRouteSub\(page, sub = '', \{ replace = false \} = \{\}\)/);
  assert.match(route, /history\[replace \? 'replaceState' : 'pushState'\]/);
});

test('setRouteSub pousse un onglet puis remplace un déplacement continu', async () => {
  const previousLocation = globalThis.location;
  const previousHistory = globalThis.history;
  const calls = [];
  globalThis.location = { hash: '#players/register/p1/presentation', pathname: '/index.html', search: '' };
  const applyUrl = (method, url) => {
    calls.push([method, url]);
    globalThis.location.hash = url.slice(url.indexOf('#'));
  };
  globalThis.history = {
    pushState: (_state, _title, url) => applyUrl('push', url),
    replaceState: (_state, _title, url) => applyUrl('replace', url),
  };
  try {
    const { getRouteSub, setRouteSub } = await import(`../assets/js/shared/route.js?test=${Date.now()}`);
    setRouteSub('players', 'gallery');
    setRouteSub('players', 'relations/ego/p2', { replace: true });
    assert.deepEqual(calls.map(([method]) => method), ['push', 'replace']);
    assert.equal(getRouteSub('players'), 'relations/ego/p2');
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousHistory === undefined) delete globalThis.history;
    else globalThis.history = previousHistory;
  }
});

test('les principales pages à onglets publient et restaurent leur sous-vue', async () => {
  const files = await Promise.all([
    'players.js', 'shop.js', 'agenda.js', 'recipes.js', 'story.js', 'bastion.js',
    'account.js', 'world.js', 'aventures.js',
  ].map(name => read(`assets/js/features/${name}`)));
  for (const source of files) {
    assert.match(source, /getRouteSub\(/);
    assert.match(source, /setRouteSub\(/);
    assert.match(source, /app:route-sub-changed/);
    assert.match(source, /data-nav-sub=/);
  }
});

test('les onglets Console MJ et Statistiques restent dans la page au Retour', async () => {
  const pages = await read('assets/js/features/pages.js');
  assert.match(pages, /setRouteSub\('admin', id\)/);
  assert.match(pages, /setRouteSub\('statistiques', tab\)/);
  assert.match(pages, /page === 'admin'[\s\S]*_cmjSetTab\(sub, \{ syncRoute: false \}\)/);
  assert.match(pages, /page === 'statistiques'[\s\S]*_statsRender\(_statsScope\)/);
  assert.match(pages, /data-nav-page="admin" data-nav-sub=/);
  assert.match(pages, /data-nav-page="statistiques" data-nav-sub=/);
});

test('les vues maître-détail rétablissent leur sélection sans nouvelle lecture', async () => {
  const [world, aventures, account, achievements, pages] = await Promise.all([
    read('assets/js/features/world.js'),
    read('assets/js/features/aventures.js'),
    read('assets/js/features/account.js'),
    read('assets/js/features/achievements.js'),
    read('assets/js/features/pages.js'),
  ]);
  assert.match(world, /selectWorldSection\(sub, \{ syncRoute: false \}\)/);
  assert.match(aventures, /page !== 'aventures'[\s\S]*_hub\.selectedId = sub/);
  assert.match(aventures, /if \(_hub\.agendaWatchMounted\) return;/);
  assert.match(account, /goAccountSection\(sub, \{ syncRoute: false, behavior: 'auto' \}\)/);
  assert.match(achievements, /_achSetView\(sub, \{ syncRoute: false \}\)/);
  assert.match(pages, /data-nav-page="achievements" data-nav-sub=/);
});

test('la Trame encode aussi l’acte actif dans sa sous-route', async () => {
  const story = await read('assets/js/features/story.js');
  assert.match(story, /act:\$\{_storyActRouteKey\(acte\)\}\/\$\{safeView\}/);
  assert.match(story, /setRouteSub\('story', _storyRouteSub\(getStoryPrefs\(\)\.view, STORE\.storyActe\)\)/);
  assert.match(story, /data-acte="\$\{_esc\(acte\)\}"[\s\S]*data-nav-sub=/);
});

test('PNJ restaure la fiche, son panneau et son onglet sans recréer les abonnements', async () => {
  const npcs = await read('assets/js/features/npcs.js');
  assert.match(npcs, /_npcRouteSub\(id = _activeId, panel = _npcPanel, sheetTab = _npcSheetTab\)/);
  assert.match(npcs, /_applyNpcRoute\(event\.detail\.sub\)[\s\S]*event\.preventDefault\(\)[\s\S]*_refreshActivePanel\(\)/);
  assert.match(npcs, /data-nav-page="npcs" data-nav-sub=/);
  assert.match(npcs, /selectNpc\(id, \{ syncRoute = true, replace = false \} = \{\}\)/);
});

test('Bestiaire pousse les ouvertures mais remplace la navigation continue au clavier', async () => {
  const bestiary = await read('assets/js/features/bestiary.js');
  assert.match(bestiary, /data-nav-page="bestiaire" data-nav-sub=/);
  assert.match(bestiary, /_bstSyncRoute\(\{ replace: true \}\);[\s\S]*_syncActivePanel\(\)/);
  assert.match(bestiary, /page !== 'bestiaire'[\s\S]*event\.preventDefault\(\)[\s\S]*_syncActivePanel\(\)/);
});

test('Grimoire et Deck sont des sous-vues partageables de la fiche personnage', async () => {
  const [characters, spells] = await Promise.all([
    read('assets/js/features/characters.js'),
    read('assets/js/features/characters/spells.js'),
  ]);
  assert.match(characters, /_characterRouteSub\(charId, tab\)/);
  assert.match(characters, /showCharTab\(tab, null, \{ syncRoute: false \}\)/);
  assert.match(spells, /setRouteSub\('characters', `\$\{c\.id\}\/sorts\/\$\{mode\}`\)/);
  assert.match(spells, /data-nav-sub="\$\{_esc\(`\$\{c\.id\}\/sorts\/grimoire`\)\}"/);
});

test('le registre des joueurs mémorise aussi le personnage et l’onglet de détail', async () => {
  const players = await read('assets/js/features/players.js');
  assert.match(players, /register\/\$\{STORE\.activeId\}\/\$\{STORE\.detailTab\}/);
  assert.match(players, /STORE\.relMode = first === 'matrix' \? 'matrix' : 'ego'/);
  assert.match(players, /_syncPlayersRoute\(\{ replace: true \}\)/);
});

test('la fiche personnage restaure un onglet sans démonter la fiche active', async () => {
  const characters = await read('assets/js/features/characters.js');
  assert.match(characters, /app:route-sub-changed[\s\S]*charId !== charSession\.getCurrentChar\(\)\?\.id/);
  assert.match(characters, /event\.preventDefault\(\);[\s\S]*showCharTab\(tab, null, \{ syncRoute: false \}\)/);
});
