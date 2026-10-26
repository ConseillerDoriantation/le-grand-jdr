import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/characters.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/characters.css', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../assets/js/features/characters/export.js', import.meta.url), 'utf8');
const exportCss = readFileSync(new URL('../assets/css/print.css', import.meta.url), 'utf8');
const lightboxSource = readFileSync(new URL('../assets/js/shared/image-lightbox.js', import.meta.url), 'utf8');
const photoSource = readFileSync(new URL('../assets/js/features/character-photo.js', import.meta.url), 'utf8');
const formsSource = readFileSync(new URL('../assets/js/features/characters/forms.js', import.meta.url), 'utf8');
const sidebar = source.slice(source.indexOf('function _buildSidebarHtml'), source.indexOf('function _buildBuildSwitcherHtml'));
const identityCss = css.slice(css.indexOf('/* ── Identité v9'));

test('le bloc identité utilise le portrait rond, l’anneau XP et les surfaces compactes', () => {
  assert.match(sidebar, /class="id-side ids"/);
  assert.match(sidebar, /class="ids-portrait/);
  assert.match(sidebar, /class="ids-ring"/);
  assert.match(sidebar, /class="ids-level\$\{ready/);
  assert.match(sidebar, /class="ids-facts"/);
  assert.match(identityCss, /\.cs-v3 \.ids-portrait \{[^}]*width: 136px;[^}]*height: 136px;/s);
  assert.match(sidebar, /pathLength="100" stroke-dasharray="\$\{xpPct\}/);
  assert.match(identityCss, /\.cs-v3 \.id-side\.ids \{[^}]*max-height: calc\(100vh/s);
  assert.match(identityCss, /\.cs-v3 \.id-side\.ids \{[^}]*border-radius: 14px;/s);
  assert.match(identityCss, /\.cs-v3 input\.ids-name \{[^}]*font: 600 1\.24rem/s);
});

test('le portrait ouvre directement le sélecteur et accepte le glisser-déposer', () => {
  assert.match(sidebar, /data-action="open-character-photo"/);
  assert.match(sidebar, /data-character-photo-drop="\$\{c\.id\}"/);
  assert.match(sidebar, /class="ids-portrait-hover"/);
  assert.match(photoSource, /function openDroppedCharacterPhoto/);
  assert.match(photoSource, /data-character-photo-drop/);
  assert.match(photoSource, /reader\.readAsDataURL\(file\)/);
  assert.match(photoSource, /compressDataUrl\(sourceDataUrl \|\| rawCropped/);
  assert.match(photoSource, /maxBytes: ORIGINAL_PHOTO_BUDGET/);
  assert.match(photoSource, /maxBytes: CROPPED_PHOTO_BUDGET/);
  assert.match(photoSource, /saveCharacterOriginalPhoto\(charId, activeBuildId, photoOriginal\)/);
  assert.match(photoSource, /photoOriginal: null/);
});

test('la pastille Aura ouvre la palette et permet de retirer la photo', () => {
  assert.match(source, /class="ids-pop ids-pop-look"/);
  assert.match(sidebar, /class="ids-portrait-edit ids-aura-button"/);
  assert.doesNotMatch(source, />Choisir une photo<\/button>/);
  assert.match(source, /Couleur de l'anneau d'expérience autour du portrait\./);
  assert.doesNotMatch(source, /jeton sur la carte, pastille dans le chat/);
  assert.match(source, /Object\.entries\(AURA_PALETTE\)/);
  assert.match(source, /data-action="delete-character-photo"/);
  assert.match(css, /\.cs-v3 \.ids-pop-look \{[^}]*width: 246px;/s);
  assert.match(identityCss, /\.cs-v3 \.ids-ring \{[^}]*filter: none;/s);
  assert.match(source, /document\.addEventListener\('pointerdown',[\s\S]*?_identityUi\.popover = null;[\s\S]*?_removeIdentityPopover\(\)/);
});

test('le total d XP se modifie directement en cliquant sur sa valeur', () => {
  assert.match(source, /class="ids-xp-current"[^>]*data-action="inlineEditNum"[^>]*data-field="exp"/);
  assert.match(source, /data-enter-click="#xp-add-button-\$\{c\.id\}"/);
  assert.doesNotMatch(source, /class="ids-xp-total"/);
  assert.match(css, /\.cs-v3 \.ids-xp-current:hover/);
});

test('PV PM et chiffres clés suivent l’ordre visuel de la maquette', () => {
  assert.match(sidebar, /ids-vital-head[^]*ids-vital-value[^]*ids-step/);
  assert.match(sidebar, /Base <b>\$\{key === 'pv'/);
  assert.match(sidebar, /data-calc="ca"[^]*<b>\$\{calcCA\(c\)\}<\/b><span>CA<\/span>/);
  assert.match(sidebar, /data-calc="or"[^]*class="or-card-amount"[^]*<span>Or<\/span>/);
  assert.doesNotMatch(sidebar, /🛡 CA|➤ Vitesse|✦ Deck|● Bourse/);
});

test('la saisie des PV actuels reprend la valeur synchronisée avec le VTT', () => {
  assert.match(formsSource, /stat === 'pvActuel'[\s\S]*?\(c\.hp \?\? c\.pvActuel\)/);
  assert.match(formsSource, /const cur = _currentVitalValue\(c, stat, maxVal\)/);
  assert.match(formsSource, /input\.value = _currentVitalValue\(c, stat, maxVal\)/);
});

test('la hiérarchie d’identité et le calcul compact suivent la maquette', () => {
  assert.match(identityCss, /\.cs-v3 input\.ids-name \{[^}]*font: 600 1\.24rem/s);
  assert.match(identityCss, /\.cs-v3 \.ids-sub \{[^}]*color: var\(--text-muted\)/s);
  assert.match(css, /\.cs-v3 \.ids-titles \{[^}]*font-family: Georgia[^}]*font-style: italic !important/s);
  assert.match(identityCss, /\.cs-v3 \.ids-inline:focus \{[^}]*background: var\(--surface-sunken\)/s);
  assert.match(source, /identityFormula = `Base \+ \$\{statShort\} × niveau \+ talents`/);
  assert.match(source, /class="ids-vital-detail-head"[^]*class="ids-calc-row"[^]*class="ids-vital-total"/);
  assert.doesNotMatch(source.slice(source.indexOf('function _identityVitalBreakdownHtml'), source.indexOf('function _buildSidebarHtml')), /cs-calc-rows|cs-brk-total/);
});

test('la colonne ne bouge pas avec le scroll et tous les calculs utilisent le détail compact', () => {
  assert.match(css, /\.cs-v3 \.id-side\.ids \{[^}]*scrollbar-gutter: stable both-edges;/s);
  for (const formula of [
    "identityFormula = 'Base + DEX + équipement'",
    "identityFormula = 'Base + FOR + équipement'",
    "identityFormula = 'Base + INT + niveau'",
    "identityFormula = 'Recettes − dépenses'",
  ]) assert.ok(source.includes(formula));
  const toggle = source.slice(source.indexOf('function toggleCharDerivative'), source.indexOf('function registerCharBlurActions'));
  assert.match(toggle, /ids-vital-detail-head/);
  assert.match(toggle, /ids-calc-row/);
  assert.match(toggle, /ids-vital-total/);
  assert.doesNotMatch(toggle, /cs-brk-hd|cs-calc-rows|cs-brk-total|cs-brk-note/);
  assert.match(css, /\.cs-v3 \.ids-breakdown \.ids-calc-row \{[^}]*font-size: \.63rem;/s);
});

test('ouvrir les popovers ne reconstruit ni ne redimensionne la fiche', () => {
  const toggle = source.slice(source.indexOf('function _toggleIdentityPopover'), source.indexOf('async function _openCharacterPortraitViewer'));
  assert.match(toggle, /layer\.id = 'identity-popover-layer'/);
  assert.match(toggle, /document\.body\.appendChild\(layer\)/);
  assert.doesNotMatch(toggle, /side\.insertAdjacentHTML|side\.appendChild/);
  assert.doesNotMatch(sidebar, /_identityPopoverHtml/);
  assert.doesNotMatch(toggle, /_rerenderIdentity|renderCharSheet/);
  assert.match(toggle, /side\.querySelector\('\.ids-aura-button'\)/);
  assert.match(toggle, /side\.querySelector\('\.ids-hero'\)/);
  assert.match(toggle, /popover\.style\.top = `\$\{Math\.round\(rect\.bottom \+ 8\)\}px`/);
  assert.match(toggle, /focus\(\{ preventScroll: true \}\)/);
  assert.match(css, /\.cs-v3 \.ids-pop \{[^}]*position: fixed;/s);
  assert.doesNotMatch(css, /\.cs-v3 \.ids-pop \{[^}]*position: absolute;/s);
  assert.match(css, /\.ids-pop-layer \{[^}]*position: fixed;[^}]*pointer-events: none;/s);
});

test('le menu export conserve des options lisibles dans les outils compacts', () => {
  assert.match(css, /\.cs-v3 \.ids-tools > button/);
  assert.doesNotMatch(css, /\.cs-v3 \.ids-tools button \{/);
  assert.match(exportSource, /Exporter la fiche/);
  assert.match(exportSource, />JSON<\/span>/);
  assert.match(exportSource, />PDF<\/span>/);
  assert.match(exportCss, /\.cs-export-opt \{[^}]*min-height: 54px;/s);
  assert.match(exportCss, /\.cs-export-opt-ico \{[^}]*flex: 0 0 38px;/s);
});

test('les contrôles identité réutilisent les actions métier existantes', () => {
  for (const action of [
    'reassignCharOwner', '_setDefaultCharacter', 'openCharExportMenu', 'deleteChar',
    'open-character-photo', 'switchCharacterBuild', 'createCharacterBuild', 'deleteCharacterBuild',
    'adjustStat', '_adjVitalBase', 'toggleCharDerivative', 'openSendGoldModal',
  ]) assert.match(source, new RegExp(`data-(?:action|change)="${action}"`));
  assert.match(source, /data-change="setCharAuraColor"/);
  assert.match(source, /data-action="setCharAura"/);
  assert.match(source, /data-action="setCharacterLifeStatus"/);
});

test('le statut de vie reste discret et un personnage mort a son portrait en noir et blanc', () => {
  assert.match(source, /const CHARACTER_LIFE_STATUSES = Object\.freeze/);
  assert.match(sidebar, /class="ids-life is-\$\{lifeStatus\}"/);
  assert.match(source, /class="ids-pop ids-pop-status"/);
  assert.match(source, /role="menuitemradio"/);
  assert.match(sidebar, /lifeStatus === 'dead' \? ' is-dead' : ''/);
  assert.match(source, /updateInCol\('characters', c\.id, \{ lifeStatus: next \}\)/);
  assert.match(css, /\.cs-v3 \.ids-portrait\.is-dead \.ids-portrait-in img \{[^}]*filter: grayscale\(1\)/s);
  assert.match(css, /\.cs-v3 \.ids-life \{[^}]*border-radius: 999px/s);
});

test('l’édition directe persiste seulement à la validation et ne rerend pas les champs simples', () => {
  const save = source.slice(source.indexOf('async function _identityInlineCommit'), source.indexOf('async function _identityTitleCommit'));
  assert.match(sidebar, /data-change="identityInlineCommit"[^>]*data-field="nom"/);
  assert.match(sidebar, /data-change="identityInlineCommit"[^>]*data-field="classe"/);
  assert.match(sidebar, /data-change="identityInlineCommit"[^>]*data-field="race"/);
  assert.equal((save.match(/updateInCol\('characters'/g) || []).length, 1);
  assert.doesNotMatch(save, /_rerenderIdentity|renderCharSheet|showNotif/);
  assert.match(source, /data-change="identityTitleCommit"/);
  assert.match(source, /data-change="identityAddTitle"/);
  assert.match(source, /makeSortable\(host/);
  assert.match(source.slice(source.indexOf('function _initCharacterTitlesSortable'), source.indexOf('function _rerenderIdentity')), /onEnd: async[\s\S]*updateInCol\('characters'/);
});

test('les builds se créent, changent et se suppriment depuis la fiche sans modale', () => {
  assert.match(source, /data-popover="builds"/);
  assert.match(source, /class="ids-pop ids-pop-builds"/);
  assert.match(source, /data-action="renameCharacterBuild"/);
  assert.doesNotMatch(source, /function openCharacterBuildsModal/);
  assert.doesNotMatch(source, /openModal\('Builds du personnage'/);
  assert.match(css, /\.cs-v3 \.ids-build-option\.is-active/);
  assert.match(css, /\.cs-v3 \.ids-build-create/);
});

test('les modes lecture et mobile restent sûrs', () => {
  assert.match(sidebar, /\$\{canEdit \? `<div class="ids-tools"/);
  assert.match(sidebar, /\$\{STATE\.isAdmin \? `<button class="ids-owner"/);
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*?\.cs-v3 \.id-side\.ids \{[^}]*position: relative !important;[^}]*top: auto !important;[^}]*max-height: none;[^}]*overflow: visible;[^}]*\}/);
  assert.doesNotMatch(sidebar, /class="xp-block"/);
  assert.doesNotMatch(sidebar, /class="or-card"/);
  assert.doesNotMatch(sidebar, /class="aura-row"/);
});
