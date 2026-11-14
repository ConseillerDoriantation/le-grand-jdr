import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readNpcs = () => readFile(new URL('../assets/js/features/npcs.js', import.meta.url), 'utf8');
const readJournal = () => readFile(new URL('../assets/js/features/characters/journal.js', import.meta.url), 'utf8');
const readNpcCss = () => readFile(new URL('../assets/css/npcs.css', import.meta.url), 'utf8');
const readVttEffective = () => readFile(new URL('../assets/js/features/vtt/vtt-effective.js', import.meta.url), 'utf8');
const readVtt = () => readFile(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');

test('les routes PNJ utilisent les trois onglets et redirigent les anciennes valeurs', async () => {
  const source = await readNpcs();
  assert.match(source, /const NPC_ROUTE_SHEET_TABS = \['fiche', 'combat', 'sorts'\]/);
  assert.match(source, /dossier: 'fiche', relations: 'fiche', chronologie: 'fiche', tactique: 'combat'/);
  assert.match(source, /return `\$\{id\}\/\$\{safeTab\}`/);
});

test('une exception avec niveau null suit la posture du groupe', async () => {
  const source = await readNpcs();
  assert.match(source, /function _npcExceptionLevel[\s\S]*return raw === null \|\| raw === undefined \|\| raw === ''[\s\S]*\? null/);
  assert.match(source, /row\.exLevel == null \? inheritedLevel : row\.exLevel/);
  assert.match(source, /Comme le groupe/);
});

test('une exception secrète est neutralisée dans la vue joueur', async () => {
  const source = await readNpcs();
  assert.match(source, /player && exception\.secret\)\) return null/);
  assert.match(source, /!admin && row\.exception\?\.secret[\s\S]*exception: null, exLevel: null/);
});

test('le ressenti est lu et écrit dans characters.relations via npcId', async () => {
  const source = await readNpcs();
  assert.match(source, /function _npcFeelingFor[\s\S]*character\?\.relations[\s\S]*r\?\.npcId === npcId/);
  assert.match(source, /async function _npcSaveFeeling[\s\S]*trySave\('characters', charId, \{ relations \}\)/);
  assert.match(source, /npcId, nom: n\.nom \|\| 'PNJ', img: n\.imageUrl/);
});

test('les cinq clés historiques de ressenti correspondent à la nouvelle échelle', async () => {
  const source = await readNpcs();
  assert.match(source, /NPC_SENT_TO_LEVEL = \{ ennemi: 0, mefiance: 1, neutre: 2, allie: 3, lien: 4 \}/);
  assert.match(source, /NPC_LEVEL_TO_SENT = \['ennemi', 'mefiance', 'neutre', 'allie', 'lien'\]/);
  const journal = await readJournal();
  assert.match(journal, /k:'ennemi',[\s\S]*lbl:'Hostile'/);
  assert.match(journal, /k:'allie',[\s\S]*lbl:'Amical'/);
  assert.match(journal, /k:'lien',[\s\S]*lbl:'Allié'/);
});

test('le passage Direct vers Par événements conserve le palier', async () => {
  const source = await readNpcs();
  assert.match(source, /const currentLevel = _affiniteNiveau\(n\)/);
  assert.match(source, /mode, niveau: currentLevel/);
  assert.match(source, /valeur: Number\(_affiniteSeuils\[thresholdKeys\[currentLevel\]\]\) \|\| 0/);
});

test('un événement de relation accepte un montant de points libre', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /data-action="npcEventDeltaCustom" data-custom-delta/);
  assert.match(source, /function _npcEventDeltaCustom\(button\)[\s\S]*button\.replaceWith\(input\)/);
  assert.match(source, /npc-rd-event-delta-inline/);
  assert.doesNotMatch(source, /promptModal\('Montant de points/);
  assert.doesNotMatch(source, /id="npc-rd-event-delta-custom"/);
  assert.match(source, /const delta = Number\(_histEditDelta\)/);
  assert.match(source, /delta,\s*\n\s*texte: text/);
  assert.match(source, /affinite\.valeur = \(Number\(affinite\.valeur\) \|\| 0\) \+ delta/);
  assert.doesNotMatch(source, /Math\.(?:min|max)\([^\n]*_histEditDelta/);
  assert.match(css, /\.npc-rd-event-delta-custom/);
});

test('les points, le texte et la date se modifient directement dans la ligne', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  for (const field of ['delta', 'text', 'date']) assert.match(source, new RegExp(`data-focus="${field}"`));
  assert.match(source, /editHistoriqueEntry\(button, npcId, index, field = 'text'\)/);
  assert.match(source, /npc-rd-event-inline-input--\$\{safeField\}/);
  assert.match(source, /input\.addEventListener\('blur',[\s\S]*commit/);
  assert.match(source, /trySave\('npcs', npcId, \{ affinite \}\)/);
  assert.doesNotMatch(source, /openModal\(`Modifier l'événement/);
  assert.doesNotMatch(source, /id="hist-edit-(?:delta|date|text)"/);
  assert.match(css, /\.npc-rd-event-edit:hover/);
  assert.match(css, /\.npc-rd-event-inline-input/);
});

test('les portraits restent tolérants quand personnage ou profil est absent', async () => {
  const source = await readNpcs();
  assert.match(source, /const _profilePortraitSrc[\s\S]*p\?\.portraitUrl/);
  assert.match(source, /const _charPortraitSrc[\s\S]*c\?\.photo[\s\S]*_profilePortraitSrc\(profile\)/);
  assert.match(source, /const _profileCroppedAvatar[\s\S]*profile\?\.imageUrl/);
});

test('les écritures relationnelles partent au change via la couche Firestore existante', async () => {
  const source = await readNpcs();
  assert.match(source, /data-change="npcSaveException"/);
  assert.match(source, /data-change="npcSaveFeeling"/);
  assert.match(source, /addToCol\('npc_affinites', data\)/);
  assert.match(source, /trySave\('characters', charId, \{ relations \}\)/);
});

test('une affinité locale ne provoque pas un second rendu au retour Firestore', async () => {
  const source = await readNpcs();
  assert.match(source, /function _npcAffiUiSignature\(\)/);
  assert.match(source, /watchPageCollection\('npcs-affi'[\s\S]*_refreshNpcAffiUi\(\{ list: true \}\)/);
  assert.match(source, /function _refreshNpcAffiUi[\s\S]*signature === _npcAffiRenderedSignature[\s\S]*return false/);
  assert.match(source, /function _refreshNpcCrossRelationsSection[\s\S]*replaceHtmlPreservingView\(section/);
  assert.match(source, /function _refreshNpcCrossSummary[\s\S]*current\.innerHTML = next\.innerHTML/);
  assert.match(source, /Object\.assign\(entry, patch\);[\s\S]*summary: !choiceAction[\s\S]*trySave\('npc_affinites'/);
  assert.match(source, /async function _npcCreateLink[\s\S]*_refreshNpcAffiUi\(\{ list: true \}\)/);
});

test('la fiche PNJ occupe la largeur disponible et ses onglets restent visibles au scroll', async () => {
  const css = await readNpcCss();
  assert.match(css, /\.main-content > \.npc-rd-page,[\s\S]*max-width: none/);
  assert.match(css, /\.npc-rd-tabs \{ position: sticky !important; top: 60px/);
  assert.match(css, /\.npc-rd-detail \{ min-width: 0; overflow: visible/);
});

test('les statuts, réglages et regards croisés reprennent les composants du handoff', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /\['', 'Vivant'\], \['mort', 'Mort'\], \['disparu', 'Disparu'\]/);
  assert.match(source, />Direct<\/button>[\s\S]*>Par événements<\/button>/);
  assert.match(source, /function _renderNpcDistributions[\s\S]*npc-rd-dist-bar[\s\S]*is-inherited/);
  assert.match(source, /npc-rd-inline-scale npc-rd-inline-scale--six/);
  assert.match(css, /\.npc-rd-segment button \{[\s\S]*font-size: 12px;[\s\S]*font-weight: 500/);
  assert.match(css, /\.npc-rd-distribution \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.npc-rd-cross-head, \.npc-rd-cross-summary \{[\s\S]*minmax\(150px, \.85fr\)[\s\S]*minmax\(0, 1\.5fr\)/);
});

test('les ressentis réemploient les types de relation tout en gardant une étiquette libre', async () => {
  const source = await readNpcs();
  assert.match(source, /const relationTypes = _affiniteTypeChoices\(\)/);
  assert.match(source, /relationTypes\.map\(type => `<button[\s\S]*npcSetFeelingSuggestion/);
  assert.match(source, /Étiquette personnalisée<input type="text"[\s\S]*data-field="sentiment"/);
  assert.match(source, /const current = _npcFeelingFor[\s\S]*current === \(btn\?\.dataset\?\.value/);
});

test('le profil Bastion suit la carte compacte et reste éditable sans nouvelle lecture', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /class="npc-rd-bastion/);
  assert.match(source, /npc-rd-bastion-toggle[\s\S]*data-action="npcToggleRecrutable"/);
  assert.match(source, /npc-rd-bastion-activities[\s\S]*data-action="npcToggleActivite"/);
  assert.match(source, /data-field="passif"[\s\S]*data-field="salaireSuggere"/);
  assert.match(css, /\.npc-rd-bastion-fields \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 150px/);
});

test('la barre des onglets devient fixe avec le nom du PNJ après le bandeau', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /tabs\.classList\.toggle\('is-fixed', fixed\)/);
  assert.match(source, /sheet\.classList\.toggle\('has-fixed-tabs', fixed\)/);
  assert.match(css, /\.npc-rd-tabs\.is-fixed \{ position: fixed !important/);
  assert.match(css, /\.npc-rd-tabs\.is-condensed \.npc-rd-tab-identity/);
});

test('la modal des affinités spécifiques gère le catalogue complet et son usage', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /function _getAffiniteTypesManagerHtml\(\)[\s\S]*_affiniteTypeChoices\(\)/);
  assert.match(source, /_affiPerso\.filter\(link => link\.typeId === type\.id\)\.length/);
  assert.match(source, /class="npc-rd-type-form"[\s\S]*id="aft-emoji-val"[\s\S]*id="aft-label"[\s\S]*id="aft-color-grid"/);
  assert.match(source, /openModal\('Types de relation', _getAffiniteTypesManagerHtml\(\)\)/);
  assert.match(source, /batchSaveInCol\(updates\)/);
  assert.match(source, /typeId: '', typeLabel: ''/);
  assert.match(source, /label: '↶ Annuler'/);
  assert.match(css, /\.npc-rd-type-list \{/);
  assert.match(css, /\.npc-rd-type-swatch\.is-on/);
});

test('les types de relation se réordonnent par poignée et persistent au dragend', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /import \{ makeSortable \} from '\.\.\/shared\/sortable-helper\.js'/);
  assert.match(source, /class="npc-rd-type-drag"[\s\S]*Glisser pour réordonner/);
  assert.match(source, /function _mountAffiniteTypesSortable[\s\S]*makeSortable\(list,[\s\S]*handle: '\.npc-rd-type-drag:not\(\.is-locked\)'/);
  assert.match(source, /onEnd:[\s\S]*_persistAffiniteTypesOrder\(list\)/);
  assert.match(source, /async function _persistAffiniteTypesOrder[\s\S]*saveDoc\('npc_affinites', AFFINITE_TYPES_DOC_ID/);
  assert.match(css, /\.npc-rd-type-drag \{[\s\S]*cursor: grab/);
  assert.match(css, /\.npc-rd-type-sortable-ghost/);
});

test('la modal propose un sélecteur emoji et une couleur libre synchronisée', async () => {
  const source = await readNpcs();
  const css = await readNpcCss();
  assert.match(source, /function _aftEmojiGrid[\s\S]*EMOJI_PRESET\.map/);
  assert.match(source, /id="aft-emoji-grid"[\s\S]*_aftEmojiGrid\(s\.emoji\)/);
  assert.match(source, /type="color" id="aft-color-picker"[\s\S]*id="aft-color-hex"/);
  assert.match(source, /function _aftNormalizeHex[\s\S]*\^#\[0-9a-f\]\{6\}/);
  assert.match(source, /_aftColorPickerInput:[\s\S]*_aftColorHexInput:[\s\S]*_aftColorHexCommit:/);
  assert.match(css, /#aft-emoji-grid \{[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)[\s\S]*overflow-x: hidden/);
  assert.match(css, /\.npc-rd-custom-color input\[type="color"\]/);
});

test('le catalogue initial contient les seize relations demandées sans les recréer après suppression', async () => {
  const source = await readNpcs();
  for (const [label, emoji, color] of [
    ['Attaché', '❤️', '#e63946'], ['Confiance', '🤝', '#2a6fdb'],
    ['Reconnaissant', '🙏', '#e9a23b'], ['Respecte', '🫡', '#3d5a80'],
    ['Apprécie', '😊', '#7fb069'], ['Complice', '😏', '#9b5de5'],
    ['Admire', '✨', '#f4c430'], ['Épris', '💘', '#ff5da2'],
    ['Intrigué', '🤔', '#48cae4'], ['Neutre', '😐', '#9aa0a6'],
    ['Méfiant', '🤨', '#b08968'], ['Déçu', '💔', '#6c7a89'],
    ['Rancune', '😤', '#7b2d26'], ['Méprise', '😒', '#5e4b56'],
    ['Craint', '😨', '#9d8df1'], ['Hostile', '💢', '#c1121f'],
  ]) {
    assert.ok(source.includes(`label: '${label}'`), `type manquant : ${label}`);
    assert.ok(source.includes(`emoji: '${emoji}'`), `emoji manquant : ${emoji}`);
    assert.ok(source.includes(`couleur: '${color}'`), `couleur manquante : ${label}`);
  }
  assert.match(source, /Array\.isArray\(typesDoc\?\.types\)[\s\S]*typesDoc\.types[\s\S]*_defaultAffiniteTypes\(\)/);
  assert.match(source, /defaultsVersion: AFFINITE_TYPES_DEFAULTS_VERSION/);
  assert.match(source, /Number\(typesDoc\.defaultsVersion \|\| 0\) < AFFINITE_TYPES_DEFAULTS_VERSION/);
});

test('un PNJ conserve une galerie bornée et le portrait actif pilote le VTT', async () => {
  const [source, css, effective, vtt] = await Promise.all([
    readNpcs(), readNpcCss(), readVttEffective(), readVtt(),
  ]);
  assert.match(source, /const NPC_MAX_PORTRAITS = 6/);
  assert.match(source, /function _npcPortraitEntries[\s\S]*n\.portraits[\s\S]*n\.imageUrl/);
  assert.match(source, /function _npcPortraitManagerHtml[\s\S]*npcSelectPortrait[\s\S]*npcDeletePortrait[\s\S]*npcAddPortrait/);
  assert.match(source, /npc-rd-portrait-manage[\s\S]*data-action="npcSetPhoto"[\s\S]*portraitCount/);
  assert.match(source, /portraits: nextPortraits, activePortraitId: portrait\.id, imageUrl, imageFull/);
  assert.match(source, /maxBytes: NPC_PORTRAIT_BYTES[\s\S]*maxBytes: NPC_PORTRAIT_FULL_BYTES/);
  assert.match(css, /\.npc-rd-portrait-gallery \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.npc-rd-portrait-manage \{[\s\S]*position: absolute/);
  assert.match(effective, /activeNpcPortrait[\s\S]*n\.activePortraitId[\s\S]*activeNpcPortrait\?\.imageUrl/);
  assert.match(vtt, /activePortraitId:entity\.activePortraitId/);
});
