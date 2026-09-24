import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');
const miniSheet = readFileSync(new URL('../assets/js/features/vtt/vtt-mini-fiche.js', import.meta.url), 'utf8');
const inspector = readFileSync(new URL('../assets/js/features/vtt/vtt-inspector.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');

test('la mini-fiche garde la largeur de la maquette malgré les anciennes règles', () => {
  assert.match(css, /\.vtt-root\s*\{\s*--vtt-mini-w:\s*410px/);
  assert.match(css, /\.vtt-mini-panel\.open\s*\{[^}]*width:\s*min\(var\(--vtt-mini-w\),\s*calc\(100vw - 32px\)\)\s*!important/si);
});

test('les chiffres clés retirent la maîtrise et conservent CA vitesse Deck et Or', () => {
  const facts = miniSheet.match(/function _msFactsHtml\(c\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(facts, /Classe d'armure/);
  assert.match(facts, /Vitesse/);
  assert.match(facts, /Deck/);
  assert.match(facts, /Or/);
  assert.doesNotMatch(facts, /Maît|Maîtrise|getMaitriseBonus/);
  assert.match(css, /button\.vtt-ms-fact:hover\s*\{[^}]*border-color:\s*#26364b;/s);
});

test('le sélecteur du nom propose les personnages avec leur portrait', () => {
  assert.match(miniSheet, /class="vtt-ms-pop-it vtt-ms-pop-char/);
  assert.match(miniSheet, /x\?\.photoURL \|\| x\?\.photo \|\| x\?\.avatar/);
  assert.match(miniSheet, /data-vtt-fn="_vttSelectMiniChar"/);
  assert.doesNotMatch(miniSheet, /class="vtt-ms-character-strip"/);
});

test('le sélecteur inclut tous les personnages possédés ou délégués', () => {
  assert.match(miniSheet, /import \{ canControlCharacter, getControlledCharacters \}/);
  assert.match(miniSheet, /function _msAvailableCharacters\(uid\)/);
  assert.match(miniSheet, /getControlledCharacters\(all, STATE\.user\?\.uid, \{ sorted: false \}\)/);
  assert.match(miniSheet, /Personnages contrôlés/);
  assert.match(miniSheet, /class="vtt-ms-pop-delegated">Délégué/);
  assert.match(css, /\.vtt-ms-pop-delegated\s*\{/);
});

test('les droits complets suivent le personnage sélectionné et non le compte ouvreur', () => {
  const permission = miniSheet.match(/function _msCanEdit\(uid,[\s\S]*?\n\}/)?.[0] || '';
  assert.match(permission, /canControlCharacter\(character, STATE\.user\?\.uid\)/);
  assert.doesNotMatch(permission, /STATE\.user\?\.uid === uid\) return true/);
  assert.match(miniSheet, /VS\.miniUid = VS\.characters\[charId\]\?\.uid \|\| uid/);
});

test('le pupitre compact affiche ses ressources éditables et un vrai bouton Fiche', () => {
  assert.match(inspector, /class="vtt-fiche vtt-fiche--compact"/);
  assert.match(inspector, /class="vtt-resource-summary vtt-resource-summary--/);
  assert.match(inspector, /<b>Fiche<\/b><kbd>C<\/kbd>/);
  assert.match(inspector, /\$\{_tabBar \? `<details class="vtt-fiche-tools">/);
  assert.match(inspector, /_resource\('Garde'/);
  assert.match(inspector, /setter: '_vttMsSetGarde'/);
  assert.doesNotMatch(inspector, /vtt-eco-row--compact/);
});

test('le menu du pupitre donne toujours accès à Stats États et Gérer', () => {
  assert.match(inspector, /\{ k:'stats',[\s\S]*?lb:'Stats'/);
  assert.match(inspector, /\{ k:'effets',[\s\S]*?lb:'États'/);
  assert.match(inspector, /\{ k:'gerer',[\s\S]*?lb:'Gérer'/);
  assert.match(inspector, /\$\{_panelHtml\}[\s\S]*?\$\{_identitySheetBtn\}[\s\S]*?\$\{_tabBar \?/);
  assert.match(inspector, /aria-label="Ouvrir Stats, États et Gérer">•••/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.vtt-fiche-tools\s*\{\s*display:\s*block;/);
});

test('le pupitre reste une ligne compacte quelle que soit la ressource affichée', () => {
  assert.match(css, /\.vtt-fiche\s*\{[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.vtt-fiche-id\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.vtt-bars--compact\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(inspector, /class="vtt-fiche-main"/);
});

test('le vieux bouton Ma fiche et sa préférence de repli ont disparu', () => {
  assert.doesNotMatch(vtt, /🎴 Ma fiche/);
  assert.doesNotMatch(vtt, /_vttToggleFicheDock/);
  assert.doesNotMatch(css, /\.vtt-fiche-dock-toggle/);
});

test('Combat suit la carte de la maquette sans réintroduire la Garde', () => {
  const combat = miniSheet.match(/function _msTabCombat\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(combat, /class="vtt-ms-atk"/);
  assert.match(combat, /Principale/);
  assert.match(combat, /Secondaire/);
  assert.match(combat, /_vttMsAttackSlot/);
  assert.doesNotMatch(combat, /calcGardeMax|_vttMsSetGarde|vtt-ms-defenses/);
});

test('les quatre onglets de la mini-fiche restent sur une ligne', () => {
  assert.match(css, /\.vtt-ms-tab\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.vtt-ms-tab-lbl,\s*\.vtt-ms-tab small\s*\{[^}]*white-space:\s*nowrap;/s);
});

test('la mini-fiche peut devenir un rail puis se redéployer depuis son portrait', () => {
  assert.match(miniSheet, /let _miniCollapsed = false/);
  assert.match(miniSheet, /function _vttMsToggleCollapsed/);
  assert.match(miniSheet, /class="vtt-ms-rail"/);
  assert.match(miniSheet, /data-vtt-fn="_vttMsToggleCollapsed"/);
  assert.match(vtt, /_vttMsToggleCollapsed/);
  assert.match(css, /\.vtt-mini-panel\.open\.is-collapsed\s*\{[^}]*width:\s*64px\s*!important/s);
});

test('le portrait de la mini-fiche reste circulaire et recadré vers le visage', () => {
  assert.match(css, /\.vtt-ms-portrait \.vtt-ms-avatar,[\s\S]*?border-radius:\s*50%\s*!important/);
  assert.match(css, /object-position:\s*50% 18%/);
  assert.match(css, /clip-path:\s*circle\(50% at 50% 50%\)/);
});

test('modifier la Garde depuis le pupitre ne peut pas ouvrir la mini-fiche', () => {
  const setter = vtt.match(/async function _vttMsSetGarde\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(setter, /if \(VS\.miniUid === uid && VS\.miniCharId === charId\) _renderMiniSheet\(uid\)/);
  assert.doesNotMatch(setter, /\n\s*_renderMiniSheet\(uid\);/);
  assert.ok(setter.indexOf('c.garde = val') < setter.indexOf('await updateDoc'), 'la Garde doit être mise à jour avant le réseau');
});

test('l’en-tête affiche classe statut discret et XP sans seconde barre', () => {
  assert.match(miniSheet, /\[c\?\.race, c\?\.classe, c\?\.titreActuel \|\| c\?\.titre\]/);
  assert.match(miniSheet, /class="vtt-ms-online-dot /);
  assert.match(miniSheet, /class="vtt-ms-xp-summary"><b>/);
  assert.doesNotMatch(miniSheet, /vtt-ms-xp-summary"><span>[\s\S]*?<i>/);
  assert.match(css, /\.vtt-ms-xp-summary > b\s*\{[^}]*color:\s*#f3f6fb/);
  assert.match(css, /\.vtt-ms-xp-summary > span\s*\{[^}]*color:\s*#687991/);
});

test('les traits d’équipement ont une présentation violette et sobre', () => {
  assert.match(css, /\.vtt-ms-equip-chip\.is-trait\s*\{[^}]*border-color:\s*#63468e;[^}]*background:\s*#251b3d;[^}]*color:\s*#c6a4f5;/s);
});

test('l’arme détaillée dans Attaque ne se répète pas dans Équipement', () => {
  const equipment = miniSheet.match(/function _msTabEquipement\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(equipment, /const occupied = slots\.filter/);
  assert.match(equipment, /const full = occupied\.filter\(s => s\.id !== _msAttackSlot\)/);
  assert.match(equipment, /\$\{occupied\.length\}\/\$\{slots\.length\}/);
});

test('le statut de connexion est placé à côté du nom', () => {
  assert.match(miniSheet, /<div class="vtt-ms-name">\$\{onlineDot\}<span>/);
  assert.doesNotMatch(miniSheet, /const subLine =/);
  assert.match(css, /\.vtt-ms-name > \.vtt-ms-online-dot\s*\{/);
});

test('les réglages du pupitre restent ouverts jusqu’au clic extérieur', () => {
  assert.match(inspector, /let _openResourceKey = null/);
  assert.match(inspector, /data-resource="\$\{resourceKey\}"[\s\S]*?_openResourceKey === resourceKey \? 'open'/);
  assert.match(inspector, /document\.addEventListener\('pointerdown',[\s\S]*?openEditor\.contains\(event\.target\)/);
  assert.match(inspector, /_wireResourceEditors\(el\)/);
});

test('un personnage en réserve laisse place au pupitre vide et à son invocation', () => {
  const fallback = inspector.match(/function _defaultInspectorToken\(t\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fallback, /return onPage\.find/);
  assert.doesNotMatch(fallback, /const candidates/);
  assert.match(inspector, /class="vtt-fiche vtt-fiche--compact vtt-fiche--empty"/);
  assert.match(inspector, /class="vtt-empty-invoke"[\s\S]*?data-vtt-fn="_vttInvokeMyToken"/);
  assert.match(css, /\.vtt-fiche--empty\s*\{/);
});
