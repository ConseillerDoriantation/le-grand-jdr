import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEmoteName, uniqueEmoteName, emoteCatalogIssues, finalizeEmoteDraft,
  createEmoteLookup, normalizeEmoteCatalog, resolveEmoteImageUrl, resolveEmoteNames, dedupeEmoteImports,
} from '../assets/js/shared/emote-admin.js';

test('les noms d émotes retirent accents espaces et caractères interdits', () => {
  assert.equal(sanitizeEmoteName('  Très-drôle.png  '), 'tres_drole_png');
  assert.equal(sanitizeEmoteName('É'.repeat(40)), 'e'.repeat(32));
});

test('un nom importé devient unique face aux noms et alias existants', () => {
  const list = [{ id: 'a', name: 'rire', aliases: ['lol'] }];
  assert.equal(uniqueEmoteName('rire', list), 'rire_2');
  assert.equal(uniqueEmoteName('lol', list), 'lol_2');
});

test('les collisions entre nom et alias sont bloquantes', () => {
  const issues = emoteCatalogIssues([
    { id: 'a', name: 'rire', aliases: ['lol'] },
    { id: 'b', name: 'lol', aliases: [] },
  ]);
  assert.equal(issues.size, 2);
  assert.match(issues.get('a'), /alias/i);
  assert.match(issues.get('b'), /nom/i);
});

test('un renommage garde l ancien nom en alias par défaut', () => {
  const saved = [{ id: 'a', name: 'rire', url: '/rire.png' }];
  assert.deepEqual(finalizeEmoteDraft([{ id: 'a', name: 'joie', url: '/rire.png' }], saved), [
    { id: 'a', name: 'joie', url: '/rire.png', aliases: ['rire'] },
  ]);
  assert.deepEqual(finalizeEmoteDraft([{ id: 'a', name: 'joie', url: '/rire.png', keepOldName: false }], saved), [
    { id: 'a', name: 'joie', url: '/rire.png' },
  ]);
});

test('le lookup et les favoris historiques résolvent les alias', () => {
  const emotes = [{ id: 'a', name: 'joie', aliases: ['rire'], url: '/rire.png' }];
  assert.equal(createEmoteLookup(emotes).get('rire')?.name, 'joie');
  assert.deepEqual(resolveEmoteNames(['rire', 'joie', 'inconnue'], emotes), ['joie']);
});

test('l import GitHub déduplique le fichier le nom et les alias', () => {
  const files = [
    { name: 'rire.png', url: '/new/rire.png' },
    { name: 'lol.png', url: '/new/lol.png' },
    { name: 'joie.png', url: '/old/same.png' },
    { name: 'wow.png', url: '/new/wow.png' },
  ];
  const result = dedupeEmoteImports(files, [{ name: 'rire', aliases: ['lol'], url: '/old/same.png' }]);
  assert.deepEqual(result.added, [{ name: 'wow', url: '/new/wow.png' }]);
  assert.equal(result.skipped, 3);
});

test('les chemins d émotes GitHub historiques utilisent une URL publique même en local', () => {
  assert.equal(
    resolveEmoteImageUrl('images/emotes/Eleanor photosynthèse.png'),
    'https://conseillerdoriantation.github.io/le-grand-jdr/images/emotes/Eleanor%20photosynth%C3%A8se.png',
  );
  assert.equal(resolveEmoteImageUrl('/rire.png'), '/rire.png');
  assert.equal(resolveEmoteImageUrl('https://cdn.example.com/rire.png'), 'https://cdn.example.com/rire.png');
  assert.equal(normalizeEmoteCatalog([{ id: 'a', name: 'Rire', url: 'images/emotes/rire.png' }])[0].url,
    'https://conseillerdoriantation.github.io/le-grand-jdr/images/emotes/rire.png');
});
