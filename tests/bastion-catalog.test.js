import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRestoreLegacyBastionCatalog } from '../assets/js/shared/bastion-catalog.js';

const legacySlugs = ['forge', 'taverne', 'entrepot'];

test('Bastion historique : un roomCatalog vide restaure les salles', () => {
  assert.equal(shouldRestoreLegacyBastionCatalog(
    { roomCatalog: [] },
    { isLegacyAdventure: true, legacySlugs },
  ), true);
});

test('un catalogue stocké non vide reste prioritaire', () => {
  assert.equal(shouldRestoreLegacyBastionCatalog(
    { roomCatalog: [{ slug: 'custom_a' }], salles: { forge: { niveau: 1 } } },
    { isLegacyAdventure: true, legacySlugs },
  ), false);
});

test('une nouvelle aventure réellement vide reste sans catalogue imposé', () => {
  assert.equal(shouldRestoreLegacyBastionCatalog(
    { roomCatalog: [] },
    { isLegacyAdventure: false, legacySlugs },
  ), false);
});

test('les champs de l’ancien modèle déclenchent la restauration', () => {
  const opts = { isLegacyAdventure: false, legacySlugs };
  assert.equal(shouldRestoreLegacyBastionCatalog({ roomCatalog: [], customRooms: [{ slug: 'custom_a' }] }, opts), true);
  assert.equal(shouldRestoreLegacyBastionCatalog({ roomCatalog: [], catalogOverrides: { forge: { nom: 'Forge royale' } } }, opts), true);
  assert.equal(shouldRestoreLegacyBastionCatalog({ roomCatalog: [], salles: { forge: { niveau: 1 } } }, opts), true);
  assert.equal(shouldRestoreLegacyBastionCatalog({ roomCatalog: [], personnel: [{ roomSlug: 'taverne' }] }, opts), true);
});
