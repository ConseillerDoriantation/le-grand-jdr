import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const media = readFileSync(new URL('../assets/js/shared/character-media.js', import.meta.url), 'utf8');
const photo = readFileSync(new URL('../assets/js/features/character-photo.js', import.meta.url), 'utf8');
const characters = readFileSync(new URL('../assets/js/features/characters.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../docs/firestore-rules.md', import.meta.url), 'utf8');

test('l image originale est stockée hors du document personnage et par build', () => {
  assert.match(media, /saveDoc\('characterMedia', id, data\)/);
  assert.match(media, /characterMediaId\(character\.id, character\.activeBuildId \|\| 'main'\)/);
  assert.match(photo, /saveCharacterOriginalPhoto\(charId, activeBuildId, photoOriginal\)/);
  assert.match(photo, /saveBuildPatch\(charId, c, \{ photo: dataUrl, photoOriginal: null/);
});

test('la visionneuse charge l original à la demande avec repli sur le portrait', () => {
  assert.match(characters, /await characterOriginalPhotoFor\(c\)/);
  assert.match(media, /if \(character\.photoOriginal\) return character\.photoOriginal/);
  assert.match(media, /return data\?\.photoOriginal \|\| character\.photo \|\| ''/);
});

test('les règles autorisent le média uniquement au contrôleur du personnage', () => {
  assert.match(rules, /match \/characterMedia\/\{mediaId\}/);
  assert.match(rules, /canControlAdventureCharacter\(adventureId, request\.resource\.data\.charId\)/);
  assert.match(rules, /canControlAdventureCharacter\(adventureId, resource\.data\.charId\)/);
});
