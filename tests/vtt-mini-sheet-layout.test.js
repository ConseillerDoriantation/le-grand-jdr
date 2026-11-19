import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');
const miniSheet = readFileSync(new URL('../assets/js/features/vtt/vtt-mini-fiche.js', import.meta.url), 'utf8');
const inspector = readFileSync(new URL('../assets/js/features/vtt/vtt-inspector.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');

test('la mini-fiche garde la largeur de la maquette malgré les anciennes règles', () => {
  assert.match(css, /\.vtt-root\s*\{\s*--vtt-mini-w:\s*384px/);
  assert.match(css, /\.vtt-mini-panel\.open\s*\{[^}]*width:\s*min\(var\(--vtt-mini-w\),\s*calc\(100vw - 32px\)\)\s*!important/si);
});

test('la v2 retire les chiffres clés redondants de la zone fixe', () => {
  assert.doesNotMatch(miniSheet, /function _msFactsHtml/);
  assert.match(miniSheet, /class="vtt-ms-defenses"/);
  assert.match(miniSheet, /class="vtt-ms-purse"/);
});

test('le sélecteur du nom propose les personnages avec leur portrait', () => {
  assert.match(miniSheet, /class="vtt-ms-pop-it vtt-ms-pop-char/);
  assert.match(miniSheet, /const photo = characterPortraitSrc\(x\)/);
  assert.match(miniSheet, /data-vtt-fn="_vttSelectMiniChar"/);
  assert.doesNotMatch(miniSheet, /class="vtt-ms-character-strip"/);
});

test('le sélecteur inclut tous les personnages possédés ou délégués', () => {
  assert.match(miniSheet, /let _miniRosterUid = null/);
  assert.match(miniSheet, /function _msCharacterGrantedToUid\(character, uid\)/);
  assert.match(miniSheet, /isCharacterGrantedToUid\(character, VS\.tokens, uid, VS\.characters\)/);
  assert.match(miniSheet, /function _msControlsCharacter\(character/);
  assert.match(miniSheet, /function _msAvailableCharacters\(uid\)/);
  assert.match(miniSheet, /const controllerUid = STATE\.isAdmin \? uid : \(STATE\.user\?\.uid \|\| uid\)/);
  assert.match(miniSheet, /all\.filter\(character => _msCharacterGrantedToUid\(character, controllerUid\)\)/);
  assert.match(miniSheet, /_msAvailableCharacters\(_miniRosterUid \|\| uid\)/);
  assert.match(miniSheet, /Personnages contrôlés/);
  assert.match(miniSheet, /class="vtt-ms-pop-delegated">Délégué/);
  assert.match(css, /\.vtt-ms-pop-delegated\s*\{/);
});

test('les droits complets suivent le personnage sélectionné et non le compte ouvreur', () => {
  const permission = miniSheet.match(/function _msCanEdit\(uid,[\s\S]*?\n\}/)?.[0] || '';
  assert.match(permission, /_msControlsCharacter\(character\)/);
  assert.doesNotMatch(permission, /STATE\.user\?\.uid === uid\) return true/);
  assert.match(miniSheet, /VS\.miniUid = VS\.characters\[charId\]\?\.uid \|\| uid/);
});

test('les dons ciblent les personnages de la scène et affichent leur portrait', () => {
  const targets = miniSheet.match(/function _msPresentTargets\(senderCharId\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(targets, /VS\.activePage\?\.id/);
  assert.match(targets, /token\?\.pageId === pageId/);
  assert.match(targets, /token\.characterId !== senderCharId/);
  assert.match(targets, /characterPortraitSrc\(character\) \|\| token\.imageUrl/);
  assert.doesNotMatch(targets, /Object\.entries\(VS\.presence/);
  assert.match(miniSheet, /function _msTargetAvatar\(target\)/);
  assert.match(css, /\.vtt-ms-target-av img\s*\{/);
});

test('la poignée redimensionne la variable réellement utilisée par la mini-fiche', () => {
  assert.match(miniSheet, /aria-label="Redimensionner la mini-fiche"/);
  assert.match(miniSheet, /root\.style\.setProperty\('--vtt-mini-w'/);
  assert.doesNotMatch(miniSheet, /style\.setProperty\('--vtt-ms-w'/);
  assert.match(css, /\.vtt-ms-resize\s*\{[^}]*width:\s*16px;[^}]*cursor:\s*ew-resize;/s);
  assert.match(css, /\.vtt-ms-resize::after\s*\{[^}]*content:'⋮'/s);
});

test('le pupitre compact affiche ses ressources éditables et un vrai bouton Fiche', () => {
  assert.match(inspector, /class="vtt-fiche vtt-fiche--compact"/);
  assert.match(inspector, /class="vtt-resource-summary vtt-resource-summary--/);
  assert.match(inspector, /<b>Fiche<\/b><kbd>C<\/kbd>/);
  assert.match(inspector, /sheet: '<rect x="5" y="3"/);
  assert.match(inspector, /\$\{_tactic \? `<span class="vtt-fiche-actions-separator"/);
  assert.match(inspector, /_resource\('Garde'/);
  assert.match(inspector, /setter: '_vttMsSetGarde'/);
  assert.doesNotMatch(inspector, /vtt-eco-row--compact/);
});

test('le pupitre expose les statistiques et effets directement sans contrôle segmenté', () => {
  assert.match(inspector, /class="vtt-fiche-readouts/);
  assert.match(inspector, /data-ins-anchor="stats"/);
  assert.match(inspector, /class="vtt-fiche-effects/);
  assert.match(inspector, /data-ins-anchor="effets"/);
  assert.match(inspector, /class="vtt-fiche-more/);
  assert.match(inspector, /data-ins-anchor="gerer"/);
  assert.doesNotMatch(inspector, /class="vtt-fiche-tabs"/);
  assert.doesNotMatch(css, /\.vtt-fiche-tabs\b/);
  assert.match(css, /\.vtt-fiche-readouts\s*\{/);
  assert.match(css, /\.vtt-effect-tile\s*\{/);
});

test('la bulle du pupitre suit son ancre et reste sous la topbar', () => {
  assert.match(inspector, /function _syncInspectorPopoverGeometry\(\)/);
  assert.match(inspector, /document\.querySelector\('\.vtt-band, \.vtt-toolbar, \.vtt-topbar, \.vtt-session-bar'\)/);
  assert.match(inspector, /ficheRect\.top - usefulTop - 12/);
  assert.match(inspector, /panel\.style\.setProperty\('--ax'/);
  assert.match(inspector, /event\.key !== 'Escape' \|\| !_insTab/);
  assert.match(inspector, /event\.target\.closest\('#vtt-inspector \.vtt-fiche-panel, #vtt-inspector \[data-ins-anchor\]'/);
  assert.match(css, /\.vtt-fiche-panel::after\s*\{[\s\S]*?left:\s*var\(--ax/);
});

test('les états sont résumés et affichés dans une liste unifiée', () => {
  assert.match(inspector, /summarizeTokenEffects\(/);
  assert.match(inspector, /name="vtt-token-effects"/);
  assert.match(inspector, /class="vtt-condition-picker-grid"/);
  assert.match(inspector, /data-vtt-fn="_vttInsFilterConditionPicker"/);
  assert.match(inspector, /data-vtt-fn="_vttConditionApply"/);
  assert.match(css, /\.vtt-effect-impact\s*\{/);
  assert.match(css, /\.vtt-effect-item\s*\{/);
  assert.match(inspector, /_tileItems\.length > 4 \? _tileItems\.slice\(0, 3\)/);
  assert.match(inspector, /\+\$\{_tileItems\.length - 3\}/);
  assert.match(inspector, /const ctrls = STATE\.isAdmin/);
});

test('un joueur tiers garde les états et Mes notes en lecture seule', () => {
  assert.match(inspector, /allowed:_effectCount > 0 \|\| STATE\.isAdmin/);
  assert.match(inspector, /allowed:!STATE\.isAdmin && !!t\.beastId/);
  assert.match(inspector, /const ctrls = STATE\.isAdmin/);
  assert.match(inspector, /const _readouts = _ctrl \?/);
  assert.match(inspector, /const _manageButton = _availableSections\.has\('gerer'\) \?/);
  assert.match(inspector, /if \(t\.beastId\) \{/);
});

test('les lectures tactiques incluent la course et ignorent les effets expirés', () => {
  assert.match(inspector, /const _movement = VS\.session\?\.combat\?\.active \? _baseMovement \+ \(t\.bonusMvt \|\| 0\)/);
  assert.match(inspector, /const _effectIsActive = effect =>/);
  assert.match(inspector, /filter\(_effectIsActive\)\.map\(condition/);
  assert.match(inspector, /buffs: \(t\.buffs \|\| \[\]\)\.filter\(_effectIsActive\)/);
});

test('Mes notes reprend le bandeau et les trois estimations du bestiaire joueur', () => {
  assert.match(inspector, /class="vtt-creat-help-banner"/);
  assert.match(inspector, /CA estimée/);
  assert.match(inspector, /Vitesse est\./);
  assert.match(inspector, /PV estimés/);
  assert.match(css, /\.vtt-creat-estimates\s*\{/);
});

test('Bestiaire affiche la CA tactique et conserve la base comme provenance', () => {
  assert.match(inspector, /<small>CA<\/small><b>\$\{realCaBuffed \?\? '\?'\}<\/b>/);
  assert.match(inspector, /<em>base \$\{beast\.ca \?\? '\?'\}<\/em>/);
  assert.match(inspector, /beast\.initiative \?\? '—'/);
});

test('Gérer sépare présence source contrôle partagé et actions MJ', () => {
  assert.match(inspector, /Visible des joueurs/);
  assert.doesNotMatch(inspector, /data-page-select="vtt-ins-page-/);
  assert.match(inspector, /data-vtt-fn="_vttMoveTokenToPage"/);
  assert.match(inspector, /Contrôle partagé/);
  assert.match(inspector, /Ouvrir la source/);
  assert.match(inspector, /Purger les effets/);
  assert.match(inspector, /const _canManage = STATE\.isAdmin \|\| _isOwner/);
  assert.match(inspector, /data-vtt-fn="_vttInsPurge"/);
  assert.match(inspector, /getCharacterDelegates\(linkedCharacter \|\| t\)/);
  assert.match(vtt, /const ownerUid = t\.ownerId \|\| \(t\.characterId \? VS\.characters\[t\.characterId\]\?\.uid : null\)/);
});

test('le pupitre reste une ligne compacte quelle que soit la ressource affichée', () => {
  assert.match(css, /\.vtt-fiche\s*\{[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.vtt-fiche-id\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.vtt-bars--compact\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(inspector, /class="vtt-fiche-main"/);
});

test('le pupitre conserve son contraste en thème clair', () => {
  assert.match(css, /\.vtt-fiche\s*\{[^}]*--vtt-dock-bg:[^}]*--vtt-sheet-bg:/s);
  assert.match(css, /\[data-theme="light"\] \.vtt-fiche\s*\{[^}]*--vtt-dock-bg:[^}]*--vtt-dock-track:[^}]*--vtt-sheet-bg:/s);
  assert.match(css, /\.vtt-who-name\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(css, /\.vtt-who-av\s*\{[^}]*border-color:\s*var\(--c,/s);
});

test('le vieux bouton Ma fiche et sa préférence de repli ont disparu', () => {
  assert.doesNotMatch(vtt, /🎴 Ma fiche/);
  assert.doesNotMatch(vtt, /_vttToggleFicheDock/);
  assert.doesNotMatch(css, /\.vtt-fiche-dock-toggle/);
});

test('Combat suit la carte de la maquette sans réintroduire la Garde', () => {
  const combat = miniSheet.match(/function _msTabCombat\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(combat, /weaponSlots\.map/);
  assert.match(combat, /class="vtt-ms-weapon/);
  assert.match(combat, /Armes en main/);
  assert.match(combat, /_msWeaponUsesTwoHands/);
  assert.match(combat, /vtt-ms-defenses/);
  assert.match(combat, /const deckUsage = getDeckUsage\(c\?\.deck_sorts\)/);
  assert.match(combat, /<b>\$\{deckUsage\.used\}\/\$\{deckMax\}<\/b><small>Deck<\/small>/);
  assert.doesNotMatch(combat, /<small>Initiative<\/small>/);
  assert.doesNotMatch(combat, /calcGardeMax|_vttMsSetGarde/);
});

test('chaque arme ouvre directement les équipements compatibles', () => {
  const combat = miniSheet.match(/function _msTabCombat\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(combat, /class="vtt-ms-change/);
  assert.match(combat, /data-vtt-fn="_vttMsPop"/);
  assert.match(combat, /data-vtt-args="slot\|\$\{_esc\(pid\)\}\|\$\{_esc\(slot\.id\)\}"/);
  assert.match(combat, /Emplacement libre/);
  assert.match(css, /\.vtt-ms-change:hover,[\s\S]*?\.vtt-ms-change\.sel\s*\{/);
});

test('les cinq onglets v2 restent lisibles et Sorts disparaît sans sort', () => {
  assert.match(miniSheet, /\['combat', 'Combat', 'combat'/);
  assert.match(miniSheet, /\['capa', 'Capacités', 'capa'/);
  assert.match(miniSheet, /hasSpells \? \[\['sorts', 'Sorts', 'sorts'/);
  assert.match(miniSheet, /\['sac', 'Sac', 'inv'/);
  assert.match(miniSheet, /\['journal', 'Journal', 'journal'/);
  assert.match(css, /\.vtt-ms-tab\s*\{[^}]*flex-direction:\s*column/s);
});

test('la mini-fiche v2 ne conserve ni rail ni déplacement du pupitre', () => {
  assert.doesNotMatch(miniSheet, /_miniCollapsed|_msCollapsedHtml|_vttMsToggleCollapsed/);
  assert.doesNotMatch(vtt, /_vttMsToggleCollapsed/);
  assert.doesNotMatch(css, /\.vtt-ms-rail\b/);
  assert.doesNotMatch(css, /\.vtt-mini-panel\.open[^\n{]*~\s*\.vtt-fiche-dock/);
});

test('la mini-fiche flotte hors du flux de la carte', () => {
  const bodyStart = vtt.indexOf('<div class="vtt-body">');
  const mini = vtt.indexOf('<div class="vtt-mini-panel" id="vtt-mini-panel">');
  const bodyEnd = vtt.lastIndexOf('</div>', mini);
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart && mini > bodyEnd);
  assert.match(css, /\.vtt-mini-panel\s*\{[^}]*position:absolute!important/s);
  assert.match(miniSheet, /function _syncMiniSheetGeometry\(\)/);
});

test('les actions courantes restent dans le popover interne', () => {
  const equipPicker = miniSheet.match(/function _vttMsEquipPicker[\s\S]*?\n\}/)?.[0] || '';
  const sendPicker = miniSheet.match(/function _vttMsSendPicker[\s\S]*?\n\}/)?.[0] || '';
  const goldPicker = miniSheet.match(/function _vttMsSendGoldPicker[\s\S]*?\n\}/)?.[0] || '';
  assert.match(equipPicker, /_vttMsPop\('equipto'/);
  assert.match(sendPicker, /_vttMsPop\('send'/);
  assert.match(goldPicker, /_vttMsPop\('gold'/);
  assert.doesNotMatch(`${equipPicker}${sendPicker}${goldPicker}`, /openModal/);
  assert.match(miniSheet, /document\.addEventListener\('pointerdown'/);
});

test('consommer est protégé par les droits et journalisé', () => {
  const consume = miniSheet.match(/async function _vttMsConsumeItem[\s\S]*?\n\}/)?.[0] || '';
  assert.match(consume, /if \(!_msCanEdit\(uid, charId\)\) return/);
  assert.match(consume, /makeInventoryHistoryEntry\('consume'/);
  assert.match(consume, /syncEquipmentAfterInventoryMutation/);
  assert.match(miniSheet, /data-vtt-fn="_vttMsConsumeItem"/);
});

test('la mini-fiche ne propose aucun jet de dés', () => {
  assert.doesNotMatch(miniSheet, /data-vtt-fn="_vtt(?:Dice|Roll|Jet)/);
  assert.doesNotMatch(miniSheet, /vtt-ms-dice-footer|vtt-ms-roll-mode/);
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

test('l’en-tête affiche classe titre et XP sans élément parasite', () => {
  assert.match(miniSheet, /\[c\?\.classe, c\?\.race\]/);
  assert.match(miniSheet, /titleText \? `<i>/);
  assert.doesNotMatch(miniSheet, /class="vtt-ms-online-dot /);
  assert.match(miniSheet, /class="vtt-ms-xp-summary"><b>/);
  assert.doesNotMatch(miniSheet, /vtt-ms-xp-summary"><span>[\s\S]*?<i>/);
  assert.match(css, /\.vtt-ms-xp-summary > b\s*\{[^}]*color:\s*#f3f6fb/);
  assert.match(css, /\.vtt-ms-xp-summary > span\s*\{[^}]*color:\s*#687991/);
});

test('les traits d’équipement ont une présentation violette et sobre', () => {
  assert.match(css, /\.vtt-ms-equip-chip\.is-trait\s*\{[^}]*border-color:\s*#63468e;[^}]*background:\s*#251b3d;[^}]*color:\s*#c6a4f5;/s);
});

test('les armes détaillées ne se répètent pas dans Équipement', () => {
  const equipment = miniSheet.match(/function _msTabEquipement\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(equipment, /filter\(slot => slot\.kind !== 'weapon'\)/);
  assert.match(equipment, /const occupied = slots\.filter/);
  assert.match(equipment, /const full = occupied/);
  assert.match(equipment, /\$\{occupied\.length\}\/\$\{slots\.length\}/);
});

test('le Sac masque Recettes sans recette et permet un don quantifié', () => {
  const sac = miniSheet.match(/function _msTabSac\([\s\S]*?\n\}/)?.[0] || '';
  const send = miniSheet.match(/async function _vttMsConfirmSend\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(sac, /const hasRecipes = !!known\?\.length/);
  assert.match(sac, /hasRecipes \? `<div class="vtt-ms-seg">/);
  assert.match(miniSheet, /id="vtt-ms-give-qty"/);
  assert.match(send, /const qty = Math\.max\(1, Math\.min\(matches\.length, requestedQty\)\)/);
});

test('la suppression d’un objet laisse quatre secondes pour annuler', () => {
  const deletion = miniSheet.match(/async function _vttMsDeleteItem[\s\S]*?\n\}/)?.[0] || '';
  assert.match(deletion, /duration:\s*4000/);
  assert.match(deletion, /label:\s*'Annuler'/);
});

test('le popover XP montre la progression avant les actions', () => {
  assert.match(miniSheet, /class="vtt-ms-xp-pop"/);
  assert.match(miniSheet, /const pct = palier > 0/);
  assert.match(css, /\.vtt-ms-xp-pop\s*\{/);
});

test('les sorts gardent leur valeur principale et la préparation à droite', () => {
  const spells = miniSheet.match(/function _msSpellLine\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(spells, /class="vtt-ms-sp-main"/);
  assert.match(spells, /class="vtt-ms-sp-badge conc"/);
  assert.match(spells, /action: \['Action', '#4f8cff', 'action'\]/);
  assert.match(spells, /action_bonus: \['Action bonus', '#f97316', 'bonus'\]/);
  assert.match(spells, /reaction: \['Réaction', '#ec4899', 'reaction'\]/);
  assert.match(spells, /class="vtt-ms-sp-act \$\{acfg\[2\]\}"/);
  assert.match(spells, /\$\{toggle\}\s*\n\s*<\/div>/);
  assert.match(css, /\.vtt-ms-sp-act\s*\{[^}]*background:color-mix\(in srgb,var\(--ac\) 14%,transparent\)/s);
});

test('le changement d’équipement reprend la liste illustrée de la maquette', () => {
  const popover = miniSheet.match(/function _msPopHtml\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(popover, /class="vtt-ms-pop-current"/);
  assert.match(popover, /class="vtt-ms-pop-option-tile"/);
  assert.match(popover, /class="vtt-ms-pop-option-body"/);
  assert.match(popover, /class="vtt-ms-pop-remove"/);
  assert.match(popover, /p\.v === 'slot' \? \(_msSlots\(\)\.find/);
  assert.match(css, /\.vtt-ms-pop-option\s*\{[^}]*display:flex[^}]*border-radius:10px/s);
});

test('le Sac garde une seule ligne compacte par objet', () => {
  const inventory = miniSheet.match(/function _msTabInventaire\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(inventory, /class="vtt-ms-it-q">×\$\{total\}/);
  assert.match(inventory, /const detailLine = \[detail, \.\.\.stats, \.\.\.traits\]/);
  assert.doesNotMatch(inventory, /\$\{isEquipCat \? _msItemChips\(item\)/);
  assert.match(css, /\.vtt-mini-panel \.vtt-ms-it\s*\{[^}]*grid-template-columns:30px minmax\(0,1fr\) auto auto/s);
});

test('le Journal reprend son en-tête compact, les tags et les actions en ligne', () => {
  const notes = miniSheet.match(/function _msTabNotes\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(notes, /class="vtt-ms-notes-head"/);
  assert.match(notes, /note\.tag \|\| note\.categorie/);
  assert.match(notes, /class="vtt-ms-note-main"/);
  assert.match(notes, /class="vtt-ms-note-card open"/);
  assert.match(notes, /class="vtt-ms-note-close"/);
  assert.match(css, /\.vtt-ms-note-card\s*\{[^}]*border:1px solid var\(--border\)[^}]*border-radius:12px/s);
});

test('les surfaces principales reprennent les cartes et proportions de la maquette', () => {
  assert.match(css, /\.vtt-ms-st\s*\{[^}]*flex-direction:column[^}]*border-radius:11px/s);
  assert.match(css, /\.vtt-ms-save\s*\{[^}]*display:flex[^}]*border-radius:11px/s);
  assert.match(css, /\.vtt-ms-skill\s*\{[^}]*background:var\(--surface-2\)/s);
  assert.match(css, /\.vtt-ms-eqs\s*\{[^}]*border-radius:14px/s);
  assert.match(css, /\.vtt-mini-panel \.vtt-ms-inv\s*\{[^}]*border-radius:14px/s);
});

test('les écrans bas compactent la zone fixe puis font défiler tout le panneau', () => {
  assert.match(css, /@media \(max-height:720px\)[\s\S]*?\.vtt-ms-st span\{display:none\}/);
  assert.match(css, /@media \(max-height:620px\)[\s\S]*?\.vtt-ms-tabbar \{ position:sticky!important/);
});

test('le nom reste aligné comme dans la maquette sans pastille de connexion', () => {
  assert.match(miniSheet, /<div class="vtt-ms-name"><span>/);
  assert.doesNotMatch(miniSheet, /\$\{onlineDot\}/);
  assert.doesNotMatch(miniSheet, /const subLine =/);
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
