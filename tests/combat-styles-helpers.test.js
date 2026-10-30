import test from 'node:test';
import assert from 'node:assert/strict';

import {
  explainCombatStyle, combatStyleCoverage, autoOrderCombatStyles,
  splitStyleLabel, joinStyleLabel, LEGACY_FORMAT_MAP,
} from '../assets/js/shared/combat-styles.js';

const FORMATS = [
  { label: 'Épée', isMagic: false, defaults: { mains: '1 main' } },
  { label: 'Dague', isMagic: false, defaults: { mains: '1 main' } },
  { label: 'Arc', isMagic: false, defaults: { mains: '2 mains' } },
  { label: 'Bâton de mage', isMagic: true, defaults: { mains: '2 mains' } },
  { label: 'Bouclier', isMagic: false, defaults: { mains: '1 main' } },
];
const W = (format, mains) => ({ format, nom: format, mains });

const DUELLISTE = { id: 'duel', label: '🤺 Duelliste', condPrincipale: ['Épée'], condSecondaire: [''], condMains: '1' };
const MAIN_LIBRE = { id: 'libre', label: '🤜 Main libre', condPrincipale: ['*'], condSecondaire: [''] };
const PROTECTEUR = { id: 'prot', label: '🛡️ Protecteur', condPrincipale: ['Épée', ''], condSecondaire: ['Bouclier'] };
const CATCHALL = { id: 'any', label: 'Catch', condPrincipale: [], condSecondaire: [] };

test('explainCombatStyle : null si correspond, sinon la raison', () => {
  assert.equal(explainCombatStyle(DUELLISTE, W('Épée', '1 main'), null, FORMATS), null);
  assert.equal(explainCombatStyle(DUELLISTE, W('Dague', '1 main'), null, FORMATS), 'main principale');
  assert.equal(explainCombatStyle(DUELLISTE, W('Épée', '2 mains'), null, FORMATS), 'maniement');
  assert.equal(explainCombatStyle(DUELLISTE, W('Épée', '1 main'), W('Bouclier', '1 main'), FORMATS), 'main secondaire');
  assert.equal(explainCombatStyle(MAIN_LIBRE, null, null, FORMATS), 'main principale'); // '*' exige une arme
  assert.equal(explainCombatStyle(MAIN_LIBRE, W('Arc', '2 mains'), null, FORMATS), null);
});

test('combatStyleCoverage : Main libre capture Duelliste si placée avant', () => {
  const styles = [MAIN_LIBRE, DUELLISTE]; // Main libre d'abord → capture le duelliste
  const cov = combatStyleCoverage(styles, FORMATS);
  assert.ok(cov.matches.duel > 0);
  assert.equal(cov.wins.duel, 0);               // masqué
  assert.ok(cov.capturedBy.duel.libre > 0);     // capturé par Main libre
  // Dans l'autre ordre, le duelliste gagne sa combinaison spécifique.
  const cov2 = combatStyleCoverage([DUELLISTE, MAIN_LIBRE], FORMATS);
  assert.ok(cov2.wins.duel > 0);
});

test('combatStyleCoverage : combinaisons impossibles (arme 2 mains + autre arme) et gaps', () => {
  const cov = combatStyleCoverage([DUELLISTE], FORMATS);
  // Arc (2 mains) en principale + Épée en secondaire = impossible.
  const iMain = cov.slots.indexOf('Arc'), iSec = cov.slots.indexOf('Épée');
  assert.equal(cov.grid[iMain][iSec].impossible, true);
  assert.ok(cov.gaps > 0); // beaucoup de combinaisons sans style (seul le duelliste existe)
});

test('autoOrderCombatStyles : spécifique d’abord, attrape-tout en dernier, stable', () => {
  const ordered = autoOrderCombatStyles([MAIN_LIBRE, DUELLISTE, CATCHALL], FORMATS);
  assert.equal(ordered[ordered.length - 1].id, 'any');          // catch-all en dernier
  assert.ok(ordered.indexOf(DUELLISTE) < ordered.indexOf(MAIN_LIBRE)); // duelliste + spécifique → avant
});

test('round-trip du libellé emoji + nom', () => {
  assert.deepEqual(splitStyleLabel('🤺 Duelliste'), { icon: '🤺', name: 'Duelliste' });
  assert.deepEqual(splitStyleLabel('Main libre'), { icon: '', name: 'Main libre' });
  assert.equal(joinStyleLabel('🤺', 'Duelliste'), '🤺 Duelliste');
  assert.equal(joinStyleLabel('', 'Sans icône'), 'Sans icône');
  // round-trip
  const r = splitStyleLabel('🛡️ Protecteur');
  assert.equal(joinStyleLabel(r.icon, r.name), '🛡️ Protecteur');
});

test('LEGACY_FORMAT_MAP mappe les anciens formats vers des types', () => {
  assert.deepEqual(LEGACY_FORMAT_MAP['Arme 2M Dist Phy.'], ['Arc', 'Arbalète']);
});
