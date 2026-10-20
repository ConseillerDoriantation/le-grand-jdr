import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readNpcs = () => readFile(new URL('../assets/js/features/npcs.js', import.meta.url), 'utf8');

test('les personnages à lier viennent du cache de page même si STATE.characters est vide', async () => {
  const source = await readNpcs();
  assert.match(source, /function _npcLinkableCharacters\(\)[\s\S]*_relationCharacters[\s\S]*STATE\.characters[\s\S]*sortCharactersForDisplay/);
  assert.match(source, /const chars = _npcLinkableCharacters\(\)\.filter\(c => !linked\.has\(c\.id\)\)/);
  assert.match(source, /const char = _npcLinkCharacter\(charId\)/);
});

test('un type Relation intégré permet le lien sans catalogue personnalisé', async () => {
  const source = await readNpcs();
  assert.match(source, /const DEFAULT_AFFINITE_TYPE = \{[\s\S]*id: '__relation__'/);
  assert.match(source, /typeId: hasCustomTypes \? null : DEFAULT_AFFINITE_TYPE\.id/);
  assert.match(source, /const chips = _affiniteTypeChoices\(\)\.map/);
});

test('la création du lien reste centralisée dans la couche Firestore existante', async () => {
  const source = await readNpcs();
  assert.match(source, /async function _npcCreateLink[\s\S]*addToCol\('npc_affinites', data\)/);
});

test('les portraits tolèrent un personnage ou un profil absent', async () => {
  const source = await readNpcs();
  assert.match(source, /const _profilePortraitSrc[\s\S]*p\?\.portraitUrl/);
  assert.match(source, /const _charPortraitSrc[\s\S]*c\?\.photo[\s\S]*_profilePortraitSrc\(profile\)/);
  assert.match(source, /const _profileCroppedAvatar[\s\S]*profile\?\.imageUrl/);
});
