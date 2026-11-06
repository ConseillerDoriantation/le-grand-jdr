import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const ledger = readFileSync(new URL('assets/js/features/characters/ledger.js', root), 'utf8');
const inventory = readFileSync(new URL('assets/js/features/characters/inventory.js', root), 'utf8');
const economy = readFileSync(new URL('assets/js/shared/economy.js', root), 'utf8');
const logic = readFileSync(new URL('assets/js/shared/ledger-logic.js', root), 'utf8');
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');

test('le compte affiche la bourse et les trois gestes sans modale', () => {
  for (const marker of [
    'Dans ta bourse', "Ajouter de l'or", "Retirer de l'or", "Envoyer de l'or",
    'id="cptAmt"', 'id="cptPrev"', 'data-action="ledgerCommit"',
  ]) assert.ok(ledger.includes(marker), marker);
  assert.doesNotMatch(ledger, /openModal\(/);
});

test('l historique est filtrable, groupé par jour et corrigé en place', () => {
  for (const marker of [
    'filterLedger(', 'endOfDayBalances(', 'data-action="ledgerSetSource"',
    'data-action="ledgerToggleRow"', 'data-action="ledgerSaveEntry"',
    'data-action="ledgerDeleteEntry"', 'Afficher ${Math.min(25, remaining)} de plus',
  ]) assert.ok(ledger.includes(marker), marker);
  assert.doesNotMatch(ledger, /contenteditable=/);
});

test('les écritures manuelles passent par economy et les actions sont annulables', () => {
  assert.match(ledger, /useGoldMulti\(character\.id/);
  assert.match(ledger, /label: 'Annuler'/);
  assert.match(economy, /buildGoldAccount\(c, entries/);
  assert.match(economy, /updateInCol\('characters', c\.id, payload\)/);
  assert.match(logic, /ts:/, 'les lignes sont horodatées par le constructeur partagé');
});

test('l envoi d or est mutualisé avec la modale existante et compensé en cas d échec', () => {
  assert.match(inventory, /export async function sendGoldTo/);
  assert.match(inventory, /const result = await sendGoldTo\(fromCharId, targetId/);
  assert.match(inventory, /↻ Rollback transfert échoué/);
  assert.match(ledger, /await sendGoldTo\(character\.id, target\.id/);
});

test('la carte Or ouvre directement Ajouter Retirer et Envoyer', () => {
  assert.match(sheet, /data-action="openIdentityLedger"[^>]*data-mode="add"/);
  assert.match(sheet, /data-action="openIdentityLedger"[^>]*data-mode="sub"/);
  assert.match(sheet, /data-action="openIdentityLedger"[^>]*data-mode="send"/);
  assert.match(sheet, /identityFormula = 'Gains − dépenses'/);
});

test('le design Compte occupe la largeur disponible, reste responsive et respecte reduced motion', () => {
  assert.match(css, /\.cpt \{[^}]*width:100%;[^}]*max-width:none;[^}]*min-width:0;[^}]*container-type:inline-size;/s);
  assert.match(css, /\.cpt-num b \{[^}]*font-size:46px;/s);
  assert.match(css, /@container \(max-width:640px\)/);
  assert.match(css, /@container \(max-width:460px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{ \.cpt \*/);
});
