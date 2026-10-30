import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const feature = readFileSync(new URL('assets/js/features/characters/inventory.js', root), 'utf8');
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');

test('l onglet inventaire utilise la vue v10 trois listes (Sur moi · À portée · Sac)', () => {
  assert.match(sheet, /inv:\s*\(\)\s*=>\s*renderCharInventaire\(c, canEdit\)/);
  const worn = feature.indexOf("head('Sur moi'");
  const belt = feature.indexOf("head('À portée de main'");
  const bag = feature.indexOf("head('Sac'");
  assert.ok(worn >= 0 && belt > worn && bag > belt, 'les trois sections dans l’ordre');
  assert.match(feature, /const slots = getEquipmentSlots\(\)/);
  // Sac groupé par type d'objet réel, pas de groupes en dur.
  assert.match(feature, /_invCategoryGroups\(bagGroups\)/);
});

test('une ligne = losange + nom + qté + info clé, détail en accordéon', () => {
  for (const marker of [
    'class="iv-row',
    'data-action="_invToggleRow"',
    'class="iv-n"',
    'class="iv-k"',
    'class="iv-gem"',   // losange de rareté
    'class="iv-dot"',   // point « nouveau »
    'class="iv-leg"',   // légende des raretés
    'Commun : sans marque',
  ]) assert.ok(feature.includes(marker), marker);
  // Rareté « notable » = au-dessus du commun (barème réel 1-indexé).
  assert.match(feature, /_IV_NOTABLE\s*=\s*rare\s*=>\s*rare\s*>=\s*2/);
});

test('la barre et les actions réutilisent les flux existants', () => {
  for (const marker of [
    'data-input="_charInvSearch"',
    'data-action="addInvItem"',       // + Ajouter (forge/butin)
    'recipeBookButton(c)',
    'inventoryHistoryButton(c)',
    'data-action="_invConsumeOne"',    // Utiliser (ceinture)
    'data-action="equipInventoryItem"',
    'data-action="clearEquipSlot"',    // Retirer
    'data-action="_invToggleBelt"',
    'data-action="openSellInvModal"',  // Vendre
    'data-action="openSendInvModal"',  // Donner
    'data-action="openDeleteInvModal"',// Jeter
    'data-action="openInventoryReadableContent"', // Lire
  ]) assert.ok(feature.includes(marker), marker);
  // Un objet de quête n'a ni Vendre ni Jeter.
  assert.match(feature, /!isQuest[^\n]*data-action="openDeleteInvModal"/);
});

test('raccourci « / » et fermeture Échap de l’accordéon', () => {
  assert.match(feature, /e\.key === '\/'/);
  assert.match(feature, /e\.key === 'Escape'[\s\S]*?_invSelected = ''/);
});

test('la densité v5 (tri, puces, répartition, panneau sticky) est supprimée', () => {
  for (const gone of [
    'data-action="_invSetSort"',
    'data-action="_invToggleNew"',
    'data-action="_invSetCategory"',
    'inv5-shell',
    'inv5-distribution',
    'inv5-chip',
    'function _invDetailHtml',
    'function renderCharInventaireLegacy',
  ]) assert.ok(!feature.includes(gone), `supprimé : ${gone}`);
  // La barre de chiffres (Bourse/Valeur/Objets) est retirée de l'inventaire.
  assert.ok(!feature.includes('<small>Bourse</small>'), 'barre Bourse retirée');
});

test('CSS v10 présent, scopé .cs-v3, responsive et contraste thème clair', () => {
  // Colonnes fluides pour remplir l'écran (plus de colonne unique centrée).
  assert.match(css, /\.cs-v3 \.iv-body \{[^}]*column-width: 480px/);
  assert.match(css, /\.cs-v3 \.iv-leg \{[^}]*column-span: all/);
  assert.match(css, /\.cs-v3 \.iv-row \{/);
  assert.match(css, /\.cs-v3 \.iv-gem \{/);
  assert.match(css, /\.cs-v3 \.iv-row\[data-r\] \.iv-n b \{ color: var\(--iv-rc\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.cs-v3 \.iv-k \{ max-width: 42%/);
  assert.match(css, /\[data-theme="light"\] \.cs-v3 \.iv-row\[data-r\] \.iv-n b/);
  // Les classes inv5 ne doivent plus exister dans le CSS.
  assert.ok(!css.includes('.inv5-shell'), 'CSS inv5-shell retiré');
  assert.ok(!css.includes('.inv5-distribution'), 'CSS inv5-distribution retiré');
});

test('le changement d onglet rejoue le fondu (characters.js)', () => {
  assert.match(sheet, /if \(!samePanel\)[\s\S]*?area\.classList\.add\('cs-tab-fadein'\)/);
});

test('la recherche met à jour la liste de façon ciblée et débouncée (sans re-render total)', () => {
  // La liste est isolée dans un helper réutilisé par le rendu complet ET la MAJ ciblée.
  assert.match(feature, /function _ivBuildListHtml\(c, canEdit\)/);
  assert.match(feature, /const listHtml = _ivBuildListHtml\(c, canEdit\)/);       // rendu complet
  assert.match(feature, /body\.innerHTML = _ivBuildListHtml\(/);                   // MAJ ciblée .iv-body
  assert.match(feature, /document\.querySelector\('\.iv \.iv-body'\)/);
  // Le handler de recherche passe par le débounce ciblé, plus par le re-render total.
  assert.match(feature, /_charInvSearch:\s*\(el\)\s*=>\s*\{[^}]*_ivDebouncedListUpdate\(\)/);
  assert.ok(!/_charInvSearch:\s*\(el\)\s*=>\s*\{[^}]*_rerenderInventoryView/.test(feature),
    'la recherche ne doit plus déclencher un re-render total de l’onglet');
  // Débounce présent.
  assert.match(feature, /function _ivDebouncedListUpdate\(\)[\s\S]*?setTimeout\([\s\S]*?120\)/);
});
