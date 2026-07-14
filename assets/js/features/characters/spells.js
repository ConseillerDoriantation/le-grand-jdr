import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { trySave } from '../../shared/crud.js';
import { openModal, closeModal, pushModal, popModal, closeModalDirect, updateModalContent, confirmModal, setModalCloseGuard, clearModalCloseGuard } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _nl2br, _norm } from '../../shared/html.js';
import { calcDeckMax, calcPMMax, getMaitriseBonus as getSharedMaitriseBonus } from '../../shared/char-stats.js';
import { loadDamageTypes } from '../../shared/damage-types.js';
import { loadConditionLibrary } from '../../shared/conditions.js';
import { loadSpellMatrices, getMatrixSuggestions, getComboConfig } from '../../shared/spell-matrices.js';
import { getArmorSetData, getMainWeapon } from './data.js';
import { getSpellSystemMode, loadSpellSystem } from '../../shared/spell-system.js';
import { makeSortable } from '../../shared/sortable-helper.js';
import { lsJson } from '../../shared/local-storage.js';
import { pickImageFile } from '../../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../../shared/image-crop.js';
import { setSpellCaches, setConditionsLibCache, getSpellMatricesCache, _SPELL_STAT_OPTIONS, _activeCombos, _runeCounts, _ampDispCircleSize, _ampDispDim, _ampCrossDim, _ampLength, _autoSourceAfflictionDot, _autoSourceCA, _autoSourceDegats, _autoSourceDuree, _autoSourceEnchantDeg, _autoSourceSoin, _autoValHtml, _buildSortResume, _calcAfflictionDot, _calcDrainPct, _calcEnchantDegats, _calcInvocationStats, _calcLaceration, _hasLaceration, _calcSortCibles, _calcSortDegats, _calcSortDeplacement, _calcSortDuree, _calcSortSoin, _calcSortZone, _getCurrentSpellChar, _getSortAction, _getSortCA, _getSortProtectionMode, _getSortTypes, _needsDureeBase, _readVisibleStatOverride, noyauTypesFor, spellVM, spellUid, ensureSpellIds } from './spells-calc.js';

let _sortsSearch = '';
// Facettes COMBINABLES : type ET rune ET noyau (chacune toggle indépendamment).
let _sortsTypeFilter = '';    // '' | 'offensif' | 'defensif' | 'utilitaire'
let _sortsRuneFilter = '';    // '' | nom de rune
let _sortsNoyauFilter = '';   // '' | clé de noyau (_noyauFilterKey)
let _sortsPmFilter = '';   // filtre par coût en PM : '' | 'low' | 'mid' | 'high'
// Mode de l'onglet : 'grimoire' (gérer — cartes/liste, catégories, édition) |
// 'prepare' (préparer le Deck — tuiles + sockets + PM). Persisté en localStorage
// (globalement en défaut + par personnage via cs-sorts-ui).
// Rétro-compat : ancienne densité 'tiles' stockée = mode Préparer.
let _sortsMode = ['grimoire', 'prepare'].includes(lsJson.get('cs-sorts-mode'))
  ? lsJson.get('cs-sorts-mode')
  : (lsJson.get('cs-sorts-density') === 'tiles' ? 'prepare' : 'grimoire');
// Densité du Grimoire : 'list' (une ligne par sort — défaut, scan rapide) |
// 'cards' (grille détaillée). Préférence persistée — PAS un filtre (jamais reset par ↺).
let _sortsDensity = lsJson.get('cs-sorts-density') === 'cards' ? 'cards' : 'list';
let _sortsValidationFilter = '';
let _sortsDuplicateOnly = false; // vue ciblée : uniquement les recettes utilisées plusieurs fois
let _sortsRecipeKeyFilter = '';  // empreinte exacte ciblée depuis une alerte « Recette ×N »
let _sortsCompareKeys = [];      // sélection temporaire de 0 à 2 sorts dans le compendium
let _sortsInspectorKey = '';      // sort consulté dans l'inspecteur RPG latéral
let _sortsReplaceIdx = null;   // mode « Remplacer quel sort ? » : index du sort entrant
let _sortsUiCharId = null;     // perso dont l'état UI (mode/densité/pliage) est chargé
let _sortsOrder = 'manual';
let _sortsSearchTimer = null;
let _sortsCatCollapsed = {};
let _sortsCatPanelOpen = false;   // panneau inline de gestion des catégories (remplace la modale)
let _sortsFiltersOpen = false;    // panneau repliable Filtres & tri (anti-cockpit)
let _sortsMenuOpen = false;       // menu repliable « Plus d'outils » (invocations, catégories…)
let _sortsAnalysisOpen = false;   // outils avancés du rail, masqués par défaut
let _newSortCatColor = '#4f8cff';
let _runeCountsEdit = {};
let _sortAllowedNoyauIds = null;
let _noyauIdsEdit = [];   // noyaux élémentaires sélectionnés (multi). [0] = primaire (compat soin/suggestions/VTT).
let _sortTypesEdit = new Set(['utilitaire']);
let _deplModeEdit = null;
let _actionModeEdit = 'reaction';
let _protModeEdit = 'ca';   // mode rune Protection en cours d'édition ('ca'|'soin') — source fiable (≠ DOM périmé)
let _zoneShapeEdit = 'rect'; // forme de zone combo Amp+Disp en cours d'édition ('rect'|'cross')
let _enchantExtraSavedEdit = [];   // états d'enchantement supplémentaires sauvegardés (slots 2..n)
let _invImageEdit = '';      // image (dataUrl) de l'invocation en cours d'édition
let _invCrop = null;         // instance du cropper pan/zoom inline de l'image d'invocation
let _invCfgIdx = -1;         // index (deck) du sort dont on configure l'invocation
let _invOriginal = null;     // s.invocation du sort en cours d'édition (préserve sélection/legacy)
let _sortIconPickerOutsideBound = false;
let _sortModalBaseline = null;   // instantané du sort à l'ouverture (garde anti-perte)
let _sortEditWasOk = false;          // édite-t-on un sort DÉJÀ validé, côté joueur ? (bandeau avant/après)
let _sortEditContentBaseline = null; // signature de CONTENU jouable au mount (≠ nom/note/cat)
let _spellRenderCachesReady = false;
let _spellRenderCachesPromise = null;
let _classicDamageTypes = [];

// Le grimoire a besoin des matrices dès son premier rendu (pas seulement quand
// la forge s'ouvre), sinon les noyaux par id restent temporairement introuvables.
function _ensureSpellRenderCaches() {
  if (_spellRenderCachesReady || _spellRenderCachesPromise) return;
  _spellRenderCachesPromise = Promise.all([loadDamageTypes(), loadSpellMatrices()])
    .then(([damageTypes, matrices]) => {
      setSpellCaches(matrices, damageTypes);
      _spellRenderCachesReady = true;
      if (charSession.getCurrentCharTab() === 'sorts') _renderSpellsTab();
    })
    .catch(err => {
      console.warn('[sorts] Impossible de charger les noyaux du grimoire', err);
      _spellRenderCachesPromise = null;
    });
}

function _renderSpellsTab(c = _getCurrentSpellChar()) {
  if (!c) return;
  if (charSession.getCurrentCharTab() === 'sorts') {
    charSession.renderTab('sorts', c, charSession.getCanEditChar());
  } else {
    charSession.renderSheet(c, 'sorts');
  }
}

function _sortValidationState(s) {
  if (s?.mjValidation) return s.mjValidation;
  if (typeof s?.mjValidated === 'boolean') return s.mjValidated ? 'ok' : 'pending';
  // Sort créé AVANT la validation MJ (aucun champ) → considéré validé (rétro-compat) :
  // sinon tous les sorts existants seraient bloqués hors du deck côté joueur.
  return 'ok';
}

function _sortsHasActiveOrderFilter() {
  // Plier une catégorie ne change ni l'ordre ni le sous-ensemble de ses cartes :
  // le drag & drop doit donc rester disponible dans les catégories ouvertes.
  return !!(_sortsSearch || _sortsTypeFilter || _sortsRuneFilter || _sortsNoyauFilter
    || _sortsPmFilter || _sortsOrder !== 'manual' || _sortsValidationFilter
    || _sortsDuplicateOnly || _sortsRecipeKeyFilter);
}

// Densité effective : le mode Préparer rend toujours en tuiles, le Grimoire
// suit la préférence cartes/liste.
function _sortsEffDensity() {
  return _sortsMode === 'prepare' ? 'tiles' : _sortsDensity;
}

// ── État UI PAR PERSONNAGE (mode / densité / catégories pliées) ─────────────
// Un seul doc localStorage `cs-sorts-ui` : { [charId]: { mode, density, collapsed } }.
// Au changement de perso : on charge son état et on remet les filtres transitoires
// à zéro (recherche/facettes appartiennent à une session de consultation, pas au perso).
function _sortsLoadUiFor(charId) {
  if (!charId || charId === _sortsUiCharId) return;
  _sortsUiCharId = charId;
  const ui = (lsJson.get('cs-sorts-ui') || {})[charId] || {};
  if (['grimoire', 'prepare'].includes(ui.mode)) _sortsMode = ui.mode;
  if (['cards', 'list'].includes(ui.density))    _sortsDensity = ui.density;
  _sortsCatCollapsed = (ui.collapsed && typeof ui.collapsed === 'object') ? { ...ui.collapsed } : {};
  _sortsSearch = ''; _sortsTypeFilter = ''; _sortsRuneFilter = ''; _sortsNoyauFilter = '';
  _sortsPmFilter = ''; _sortsValidationFilter = ''; _sortsOrder = 'manual';
  _sortsDuplicateOnly = false; _sortsRecipeKeyFilter = ''; _sortsCompareKeys = [];
  _sortsInspectorKey = ''; _sortsAnalysisOpen = false;
  _sortsReplaceIdx = null; _openSortIdx = null;
}
function _sortsPersistUi() {
  if (!_sortsUiCharId) return;
  const all = lsJson.get('cs-sorts-ui') || {};
  all[_sortsUiCharId] = { mode: _sortsMode, density: _sortsDensity, collapsed: _sortsCatCollapsed || {} };
  lsJson.set('cs-sorts-ui', all);
}

function _noyauFilterKey(t) {
  return t?.id || _norm(t?.label || t?.nom || '');
}

function _effectiveSortPm(s, pmDelta = 0) {
  // Une seule vérité : le présentateur partagé (override MJ > pm > cout legacy + delta).
  return spellVM(s, pmDelta).pm ?? 0;
}

// Empreinte de fabrication : noyaux + multiset de runes. Deux sorts portant la
// même empreinte partagent la même recette, même si leur nom ou leur catégorie diffère.
function _spellRecipeKey(s) {
  if (s?.designMode === 'classic') return `classic|${s?.id || s?.nom || ''}`;
  const runeCounts = new Map();
  _displayRunes(s?.runes || []).forEach(r => runeCounts.set(r, (runeCounts.get(r) || 0) + 1));
  const runes = [...runeCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    .map(([name, count]) => `${_norm(name)}:${count}`);
  const noyaux = noyauTypesFor(s)
    .map(t => _noyauFilterKey(t))
    .filter(Boolean)
    .sort();
  return `${noyaux.join('+') || 'sans-noyau'}|${runes.join('+') || 'sans-rune'}`;
}

function _spellCompareKey(s, index) {
  return s?.id || `legacy:${index}:${_norm(s?.nom || '')}:${_spellRecipeKey(s)}`;
}

function _spellRank(s, pmDelta = 0) {
  const runeCount = _displayRunes(s?.runes || []).length;
  const noyauCount = Math.max(1, noyauTypesFor(s).length);
  const complexity = _effectiveSortPm(s, pmDelta) + runeCount * 2 + Math.max(0, noyauCount - 1) * 2;
  if (complexity <= 6) return { n: 1, roman: 'I', label: 'Initiation', color: '#7c8aa5' };
  if (complexity <= 11) return { n: 2, roman: 'II', label: 'Adepte', color: '#4f8cff' };
  if (complexity <= 16) return { n: 3, roman: 'III', label: 'Expert', color: '#b47fff' };
  if (complexity <= 22) return { n: 4, roman: 'IV', label: 'Maître', color: '#e8b84b' };
  return { n: 5, roman: 'V', label: 'Légendaire', color: '#ff6b6b' };
}

function _spellCompareRuneText(s) {
  if (s?.designMode === 'classic') return 'Création classique';
  const counts = new Map();
  _displayRunes(s?.runes || []).forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    .map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ''}`)
    .join(' · ') || 'Aucune rune';
}

function _renderSpellInspector(allSorts, pmDelta, c, canEdit) {
  if (!_sortsInspectorKey) return '';
  const entry = allSorts.map((s, index) => ({ s, index, key: _spellCompareKey(s, index) }))
    .find(item => item.key === _sortsInspectorKey);
  if (!entry) return '';
  const { s, index, key } = entry;
  const isCompared = _sortsCompareKeys.includes(key);
  const rank = _spellRank(s, pmDelta);
  const noyaux = noyauTypesFor(s);
  const runeCounts = new Map();
  _displayRunes(s.runes || []).forEach(r => runeCounts.set(r, (runeCounts.get(r) || 0) + 1));
  const runeHtml = [...runeCounts.entries()].map(([name, count]) => {
    const meta = RUNE_META.find(rm => rm.nom === name);
    return `<span style="--c:${meta?.color || '#7c8aa5'}"><i>${meta?.icon || '✦'}</i><b>${_esc(name)}</b>${count > 1 ? `<em>×${count}</em>` : ''}</span>`;
  }).join('');
  const effects = _buildSortResume(s, c);

  return `<aside class="cs-spellinspector" style="--rank-col:${rank.color}" aria-label="Détails de ${_esc(s.nom || 'ce sort')}">
    <header class="cs-spellinspector-hero">
      <button class="cs-spellinspector-close" data-action="_sortsCloseInspector" title="Fermer">✕</button>
      <span class="cs-spellinspector-icon">${s.icon || '✦'}</span>
      <div><span>RANG ${rank.roman} · ${rank.label.toUpperCase()}</span><h3>${_esc(s.nom || 'Sort sans nom')}</h3></div>
      <strong>${_effectiveSortPm(s, pmDelta)}<small>PM</small></strong>
    </header>
    <div class="cs-spellinspector-recipe">
      <span>${s.designMode === 'classic' ? 'SYSTÈME' : 'COMPOSITION'}</span>
      <div class="cs-spellinspector-noyaux">${noyaux.length ? noyaux.map(t => `<b style="--c:${t.color || '#888'}">${t.icon || '✦'} ${_esc(t.label || t.nom || 'Noyau')}</b>`).join('') : s.designMode === 'classic' ? '<b>◇ Neutre</b>' : '<b class="is-missing">⚠ Noyau à définir</b>'}</div>
      <div class="cs-spellinspector-runes">${s.designMode === 'classic' ? '<span class="is-empty">✦ Sort classique</span>' : (runeHtml || '<span class="is-empty">Aucune rune</span>')}</div>
    </div>
    <div class="cs-spellinspector-state">
      <span><small>STATUT</small><b>${_sortValidationState(s)==='ok'?'✓ Validé':_sortValidationState(s)==='no'?'✕ À corriger':'⌛ En attente'}</b></span>
      <span><small>DECK</small><b>${s.actif?'⚡ Dans le deck':'Hors du deck'}</b></span>
    </div>
    ${s.effet ? `<div class="cs-spellinspector-description"><span>DESCRIPTION</span><p>${_esc(s.effet)}</p></div>` : ''}
    <details class="cs-spellinspector-effects">
      <summary><span>Voir les effets calculés</span><b>${effects.length}</b></summary>
      <div class="cs-spellinspector-effects-list">
        ${effects.map(line => `<div><i>${line.icon || '•'}</i><p><b>${_esc(line.label)}</b>${line.detail ? `<small>${_esc(line.detail)}</small>` : ''}</p></div>`).join('')}
      </div>
    </details>
    <footer>
      <button class="is-compare ${isCompared?'on':''}" data-action="_sortsToggleCompare" data-idx="${index}">${isCompared?'✓ Sélectionné':'◫ Comparer'}</button>
      ${canEdit ? `<button data-action="duplicateSort" data-idx="${index}">⧉ Dupliquer</button>
      ${(s.runes || []).includes('Invocation') ? `<button data-action="_openInvocationConfig" data-idx="${index}">🐾 Invocation</button>` : ''}
      <button data-action="toggleSort" data-idx="${index}">${s.actif?'− Retirer du deck':'⚡ Ajouter au deck'}</button>
      <button class="is-primary" data-action="editSort" data-idx="${index}">✏ Modifier</button>
      <button class="is-danger" data-action="deleteSort" data-idx="${index}">🗑 Supprimer</button>` : ''}
    </footer>
  </aside>`;
}

function _renderSpellComparePanel(allSorts, pmDelta, c) {
  const selected = _sortsCompareKeys
    .map(key => allSorts.map((s, index) => ({ s, index, key: _spellCompareKey(s, index) })).find(entry => entry.key === key))
    .filter(Boolean);
  if (!selected.length) return '';
  if (selected.length === 1) {
    const { s } = selected[0];
    return `<section class="cs-spellcompare cs-spellcompare--waiting" tabindex="-1" aria-live="polite">
      <span class="cs-spellcompare-wait-icon">◫</span>
      <div><b>${_esc(s.nom || 'Sort')} sélectionné</b><small>Clique sur une autre carte : la comparaison s’ouvrira immédiatement.</small></div>
      <button data-action="_sortsClearCompare">Annuler</button>
    </section>`;
  }

  const [left, right] = selected;
  const factsFor = ({ s }) => {
    const { action } = _getSortAction(s);
    const actionLabel = { action: 'Action', action_bonus: 'Action bonus', reaction: 'Réaction' }[action] || 'Action';
    const noyaux = noyauTypesFor(s).map(t => t.label || t.nom).filter(Boolean).join(' + ') || 'À définir';
    const types = _getSortTypes(s).map(type => ({ offensif:'Offensif', defensif:'Soutien', utilitaire:'Utilitaire' }[type] || type)).join(' + ');
    return {
      pm: { label: 'Coût', value: `${_effectiveSortPm(s, pmDelta)} PM` },
      noyau: { label: 'Noyau', value: noyaux },
      runes: { label: 'Runes', value: _spellCompareRuneText(s) },
      role: { label: 'Rôle', value: types || 'Non défini' },
      action: { label: 'Activation', value: actionLabel },
      deck: { label: 'Deck', value: s.actif ? 'Équipé' : 'Hors deck' },
      effect: { label: 'Effet', value: String(s.effet || 'Aucune description') },
      recipe: { label: 'Empreinte', value: _spellRecipeKey(s) },
    };
  };
  const a = factsFor(left), b = factsFor(right);
  const rows = ['pm','noyau','runes','role','action','deck'].map(key => {
    const diff = _norm(a[key].value) !== _norm(b[key].value);
    return `<div class="cs-spellcompare-row ${diff ? 'is-diff' : 'is-same'}">
      <span class="cs-spellcompare-row-label">${a[key].label}</span>
      <span>${_esc(a[key].value)}</span>
      <i>${diff ? '≠' : '='}</i>
      <span>${_esc(b[key].value)}</span>
    </div>`;
  }).join('');
  const sameRecipe = a.recipe.value === b.recipe.value;

  return `<section class="cs-spellcompare" tabindex="-1" aria-live="polite">
    <header class="cs-spellcompare-head">
      <div><span>ANALYSE CROISÉE</span><b>Comparaison de sorts</b></div>
      <span class="cs-spellcompare-verdict ${sameRecipe ? 'is-same' : 'is-different'}">${sameRecipe ? '⚠ Même recette' : '✦ Recettes distinctes'}</span>
      <button data-action="_sortsClearCompare" title="Fermer la comparaison">✕</button>
    </header>
    <div class="cs-spellcompare-titles">
      <div><span>${left.s.icon || '✦'}</span><b>${_esc(left.s.nom || 'Sort')}</b></div>
      <span>VS</span>
      <div><span>${right.s.icon || '✦'}</span><b>${_esc(right.s.nom || 'Sort')}</b></div>
    </div>
    <div class="cs-spellcompare-rows">${rows}</div>
    <div class="cs-spellcompare-effects">
      <article><span>EFFET</span><p>${_esc(a.effect.value)}</p></article>
      <article><span>EFFET</span><p>${_esc(b.effect.value)}</p></article>
    </div>
  </section>`;
}

// Tranche de coût d'un sort (PM effectif, set léger inclus) — pour le filtre par mana.
function _sortPmBucket(pm) {
  if (pm <= 4) return 'low';
  if (pm <= 8) return 'mid';
  return 'high';
}
const _PM_BUCKETS = [
  ['low',  '💧 Faible', '≤ 4 PM'],
  ['mid',  '🔷 Moyen',  '6–8 PM'],
  ['high', '🔶 Élevé',  '≥ 10 PM'],
];

function _sortsOrderComparator(order, pmDelta = 0) {
  const valRank = { pending: 0, no: 1, ok: 2 };
  return (a, b) => {
    const sa = a?.s || {};
    const sb = b?.s || {};
    if (order === 'pm') {
      const d = _effectiveSortPm(sa, pmDelta) - _effectiveSortPm(sb, pmDelta);
      if (d) return d;
    } else if (order === 'nom') {
      const d = String(sa.nom || '').localeCompare(String(sb.nom || ''), 'fr', { sensitivity: 'base' });
      if (d) return d;
    } else if (order === 'validation') {
      const d = (valRank[_sortValidationState(sa)] ?? 9) - (valRank[_sortValidationState(sb)] ?? 9);
      if (d) return d;
    } else if (order === 'recipe') {
      const d = _spellRecipeKey(sa).localeCompare(_spellRecipeKey(sb), 'fr', { sensitivity: 'base' });
      if (d) return d;
    }
    return (a?.globalIdx || 0) - (b?.globalIdx || 0);
  };
}

function _renderDeckStats(activeSorts = [], deckMax = Infinity, pmDelta = 0) {
  if (!activeSorts.length) return '';
  const pmCounts = new Map();
  const typeCounts = { offensif: 0, defensif: 0, utilitaire: 0 };
  const noyauCounts = new Map();
  activeSorts.forEach(s => {
    const pm = _effectiveSortPm(s, pmDelta);
    pmCounts.set(pm, (pmCounts.get(pm) || 0) + 1);
    const types = _getSortTypes(s);
    if (types.includes('offensif')) typeCounts.offensif += 1;
    if (types.includes('defensif')) typeCounts.defensif += 1;
    if (types.includes('utilitaire') && !types.includes('offensif') && !types.includes('defensif')) typeCounts.utilitaire += 1;
    noyauTypesFor(s).forEach(t => {
      const k = _noyauFilterKey(t);
      if (!k) return;
      const cur = noyauCounts.get(k) || { t, count: 0 };
      cur.count += 1;
      noyauCounts.set(k, cur);
    });
  });
  const pmChips = [...pmCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pm, count]) => `<span>${pm} PM <b>×${count}</b></span>`)
    .join('');
  const typeChips = [
    typeCounts.offensif ? `<span class="off">⚔️ Off <b>${typeCounts.offensif}</b></span>` : '',
    typeCounts.defensif ? `<span class="def">🛡️ Soutien <b>${typeCounts.defensif}</b></span>` : '',
    typeCounts.utilitaire ? `<span class="util">🔧 Util <b>${typeCounts.utilitaire}</b></span>` : '',
  ].filter(Boolean).join('');
  const noyauChips = [...noyauCounts.values()]
    .sort((a, b) => String(a.t.label || '').localeCompare(String(b.t.label || ''), 'fr', { sensitivity: 'base' }))
    .map(({ t, count }) => `<span style="--c:${t.color || '#8aa'}">${t.icon || '✦'} ${_esc(t.label || t.nom || 'Noyau')} <b>${count}</b></span>`)
    .join('');
  // Une seule ligne discrète : label + PM · types · éléments. Pas d'en-tête ni de
  // compteur (déjà dans le segment « ⚡ Deck N/M » au-dessus), pas de gros encadré.
  const sep = `<span class="cs-sorts-deckstrip-sep"></span>`;
  return `<div class="cs-sorts-deckstrip" title="Répartition de ton Deck actif">
    <span class="cs-sorts-deckstrip-lbl">📊 Deck</span>
    ${pmChips ? `<span class="cs-sorts-deckstrip-grp pm">${pmChips}</span>` : ''}
    ${typeChips ? `${pmChips ? sep : ''}<span class="cs-sorts-deckstrip-grp">${typeChips}</span>` : ''}
    ${noyauChips ? `${(pmChips || typeChips) ? sep : ''}<span class="cs-sorts-deckstrip-grp">${noyauChips}</span>` : ''}
  </div>`;
}

// ── Deck en SOCKETS (vue Grimoire) : le loadout comme une barre d'action ──
// Chaque sort préparé = un socket rempli (clic = retirer, hover = fiche) ;
// la capacité INT restante = sockets vides en pointillés (clic = suggère les
// sorts préparables). Remplace la ligne 📊 deckstrip en densité 'tiles'.
function _renderDeckSockets(entries, deckMax, pmDelta, canEdit, pmCur = null, pmMax = null) {
  const over = Number.isFinite(deckMax) && entries.length > deckMax;
  const replacing = _sortsReplaceIdx != null;
  const slots = entries.map(({ s, i }, slotIndex) => canEdit
    ? (replacing
      ? `<button class="cs-sock is-filled is-swap" data-action="_sortsReplaceWith" data-idx="${i}" title="Remplacer ${_esc(s.nom || 'ce sort')} par le sort choisi"><span class="cs-sock-key">${slotIndex + 1}</span><span class="cs-sock-ic">${s.icon ? _esc(s.icon) : '✦'}</span><span class="cs-sock-x">⇄</span></button>`
      : `<button class="cs-sock is-filled" data-action="toggleSort" data-idx="${i}" title="${_esc(s.nom || 'Sort')} — retirer du Deck"><span class="cs-sock-key">${slotIndex + 1}</span><span class="cs-sock-ic">${s.icon ? _esc(s.icon) : '✦'}</span><span class="cs-sock-x">✕</span></button>`)
    : `<span class="cs-sock is-filled" data-idx="${i}" title="${_esc(s.nom || 'Sort')}"><span class="cs-sock-key">${slotIndex + 1}</span><span class="cs-sock-ic">${s.icon ? _esc(s.icon) : '✦'}</span></span>`);
  if (Number.isFinite(deckMax)) {
    for (let k = entries.length; k < deckMax; k++) {
      slots.push(canEdit
        ? `<button class="cs-sock is-empty" data-action="_sortsHintPreparable" title="Emplacement ${k + 1} libre — montre les sorts préparables"><span class="cs-sock-key">${k + 1}</span>＋</button>`
        : `<span class="cs-sock is-empty"><span class="cs-sock-key">${k + 1}</span>＋</span>`);
    }
  }
  const pmSum = entries.reduce((a, { s }) => a + _effectiveSortPm(s, pmDelta), 0);
  const pmRes = pmMax != null
    ? `<span class="cs-sorts-pmres ${pmCur <= Math.floor(pmMax / 4) ? 'is-low' : ''}" title="Tes points de magie actuels / maximum">💧 <b>${pmCur}</b><small>/${pmMax} PM</small></span>`
    : '';
  return `<div class="cs-sorts-sockets ${over ? 'is-over' : ''} ${replacing ? 'is-replacing' : ''}">
    <span class="cs-sorts-sockets-lbl" title="Ton Deck : sorts préparés / capacité (INT)">⚡</span>
    <div class="cs-sorts-sockets-row">${slots.join('')}</div>
    ${replacing ? `<span class="cs-sorts-swaphint">Remplacer quel sort ?</span>
      <button class="cs-sorts-swapcancel" data-action="_sortsCancelReplace" title="Annuler le remplacement">✕ Annuler</button>` : ''}
    <span class="cs-sorts-sockets-right">
      ${pmSum ? `<span class="cs-sorts-sockets-pm" title="Coût total si chaque sort préparé est lancé une fois">Σ <b>${pmSum} PM</b></span>` : ''}
      ${pmRes}
    </span>
  </div>`;
}

// ── Interactions tuile (mode Préparer) ───────────────────────────────────────
// Pointeur fin : clic = préparer/retirer, avec flux « Remplacer quel sort ? » si
// le Deck est plein. Tactile (pas de survol) ou lecture seule : tap = fiche rapide
// (le tap ne prépare JAMAIS à l'aveugle — la tooltip n'existe pas sur tactile).
function _sortsTileTap(i) {
  const canEdit = charSession.getCanEditChar();
  if (!canEdit || !window.matchMedia?.('(hover: hover)').matches) { _sortsOpenSheet(i); return; }
  _sortsTileToggle(i);
}

async function _sortsTileToggle(i) {
  const c = _getCurrentSpellChar(); if (!c) return;
  const s = (c.deck_sorts || [])[i]; if (!s) return;
  const validated = STATE.isAdmin || _sortValidationState(s) === 'ok';
  const deckMax = calcDeckMax(c);
  const deckCount = (c.deck_sorts || []).filter(x => x?.actif).length;
  if (!s.actif && validated && Number.isFinite(deckMax) && deckCount >= deckMax) {
    _sortsReplaceIdx = i;
    _sortsRerender();
    showNotif('Deck plein — choisis dans le tray ⚡ le sort à remplacer.', 'info');
    return;
  }
  // Import dynamique : évite un cycle statique spells → forms (→ pages → characters).
  const { toggleSort } = await import('./forms.js');
  toggleSort(i);
}

function _sortsCancelReplace() { _sortsReplaceIdx = null; _sortsRerender(); }

// Échange en UNE écriture : le sort du socket sort du Deck, le sort choisi y entre.
async function _sortsReplaceWith(outIdx) {
  const c = _getCurrentSpellChar();
  const inIdx = _sortsReplaceIdx;
  _sortsReplaceIdx = null;
  if (!c || inIdx == null) { _sortsRerender(); return; }
  const sorts = [...(c.deck_sorts || [])];
  const sIn = sorts[inIdx], sOut = sorts[outIdx];
  if (!sIn || !sOut || !sOut.actif || sIn.actif) { _sortsRerender(); return; }
  sorts[outIdx] = { ...sOut, actif: false };
  sorts[inIdx]  = { ...sIn,  actif: true };
  ensureSpellIds(sorts);
  if (await trySave('characters', c.id, { deck_sorts: sorts })) {
    c.deck_sorts = sorts;
    if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
    if (charSession.getCurrentChar()?.id === c.id)
      charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
    showNotif(`⚡ ${_esc(sIn.nom || 'Sort')} remplace ${_esc(sOut.nom || 'ce sort')} dans le Deck`, 'success');
  }
  _renderSpellsTab(c);
}

// ── Fiche rapide (tactile / lecture seule) : clone de la carte en bottom-sheet ──
let _spellSheetEl = null;
function _sortsCloseSheet() { _spellSheetEl?.remove(); _spellSheetEl = null; }
function _sortsOpenSheet(i) {
  _sortsCloseSheet();
  _spellTTHide();
  const c = _getCurrentSpellChar();
  const s = (c?.deck_sorts || [])[i]; if (!s) return;
  const canEdit = charSession.getCanEditChar();
  const card = document.querySelector(`.cs-spellcard[data-sort-idx="${i}"]`); if (!card) return;
  const wrap = document.createElement('div');
  wrap.className = 'cs-spell-sheet-overlay';
  wrap.innerHTML = `<div class="cs-v3 cs-spell-sheet" role="dialog" aria-modal="true" aria-label="${_esc(s.nom || 'Sort')}">
    <div class="cs-spell-sheet-card"></div>
    <div class="cs-spell-sheet-btns">
      ${canEdit ? `<button class="btn btn-sm ${s.actif ? 'btn-outline' : 'btn-gold'}" data-action="_sortsSheetToggle" data-idx="${i}">${s.actif ? '− Retirer du Deck' : '⚡ Préparer'}</button>` : ''}
      ${canEdit ? `<button class="btn btn-outline btn-sm" data-action="editSort" data-idx="${i}">✏️ Modifier</button>` : ''}
      <button class="btn btn-outline btn-sm cs-spell-sheet-close" type="button">Fermer</button>
    </div>
  </div>`;
  const clone = card.cloneNode(true);
  clone.classList.remove('is-open', 'cs-hintme');
  clone.removeAttribute('data-action');
  clone.removeAttribute('tabindex');
  clone.removeAttribute('role');
  wrap.querySelector('.cs-spell-sheet-card').appendChild(clone);
  // Fermeture : tap sur le fond, « Fermer », ou après toute action (le dispatch
  // global data-action tourne sur document → on laisse l'événement remonter,
  // puis on retire la fiche au tick suivant).
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.cs-spell-sheet-close') || e.target.closest('[data-action]')) {
      setTimeout(_sortsCloseSheet, 0);
    }
  });
  document.body.appendChild(wrap);
  _spellSheetEl = wrap;
}
// Préparer depuis la fiche : réutilise le flux tuile (garde deck plein incluse).
function _sortsSheetToggle(i) { _sortsTileToggle(i); }

// ── Tooltip « objet de jeu » (vue Grimoire) ─────────────────────────────────
// Au survol/focus d'une tuile (ou d'un socket), on clone la CARTE complète dans
// un conteneur flottant : hors de .is-tiles, le clone reprend la mise en page
// carte (héros, chips, runes, desc, note MJ) → toute l'info, zéro duplication
// de logique. Purement informatif (pointer-events: none), détruit au départ.
let _spellTT = null;
let _spellTTFor = null;
let _spellTTBound = false;
function _spellTTHide() {
  _spellTT?.remove();
  _spellTT = null; _spellTTFor = null;
}
function _spellTTShow(card, anchor) {
  if (_spellTTFor === card) return;   // déjà affichée pour cette tuile
  _spellTTHide();
  const tt = document.createElement('div');
  tt.className = 'cs-v3 cs-spell-tt';   // .cs-v3 : réactive les styles de carte
  const clone = card.cloneNode(true);
  clone.classList.remove('is-open');
  clone.removeAttribute('data-action');
  clone.removeAttribute('tabindex');
  tt.appendChild(clone);
  document.body.appendChild(tt);
  // Placement : à droite de l'ancre si possible, sinon à gauche ; clampé au viewport.
  const r = anchor.getBoundingClientRect();
  const w = tt.offsetWidth, h = tt.offsetHeight;
  let x = r.right + 10;
  if (x + w > innerWidth - 8) x = r.left - w - 10;
  if (x < 8) x = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8));
  const y = Math.min(Math.max(8, r.top - 4), Math.max(8, innerHeight - h - 8));
  tt.style.left = `${x}px`; tt.style.top = `${y}px`;
  requestAnimationFrame(() => tt.classList.add('show'));
  _spellTT = tt; _spellTTFor = card;
}
function _spellTTTarget(e) {
  // Dock d'actions (⧉✏️🗑️) : on vise un bouton → pas de tooltip par-dessus.
  const tile = e.target.closest?.('.is-tiles .cs-spellcard');
  if (tile) return { card: tile, anchor: tile };
  const sock = e.target.closest?.('.cs-sock[data-idx]');
  if (sock) {
    const card = document.querySelector(`.is-tiles .cs-spellcard[data-sort-idx="${sock.dataset.idx}"]`);
    if (card) return { card, anchor: sock };
  }
  return null;
}
function _bindSpellTilesTooltip() {
  if (_spellTTBound) return;
  _spellTTBound = true;
  // Clavier : Enter/Espace activent les contrôles non-boutons de l'onglet Sorts
  // (toggle du Deck, tuile, en-tête de catégorie) — alternative au pointeur.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.matches('input, textarea, select, button, a')) return;
    if (!el.matches('.cs-spellcard .toggle[data-action], .cs-sort-cat-hdr[data-action], article.cs-spellcard[data-action]')) return;
    e.preventDefault();
    el.click();
  });
  if (!window.matchMedia?.('(hover: hover)').matches) return;   // tactile : pas de survol (tap = fiche rapide)
  document.addEventListener('mouseover', (e) => {
    const t = _spellTTTarget(e);
    if (t) _spellTTShow(t.card, t.anchor); else _spellTTHide();
  });
  document.addEventListener('focusin', (e) => {
    const t = _spellTTTarget(e);
    if (t) _spellTTShow(t.card, t.anchor); else _spellTTHide();
  });
  document.addEventListener('scroll', _spellTTHide, true);
  document.addEventListener('click', _spellTTHide, true);   // toggle/re-render → jamais de tooltip périmée
}

// Socket vide cliqué : fait pulser les tuiles préparables (validées + non actives).
function _sortsHintPreparable() {
  document.querySelectorAll('.is-tiles .cs-spellcard:not(.is-actif)').forEach(el => {
    if (el.querySelector('.toggle.is-locked')) return;   // non validé ou deck plein
    el.classList.remove('cs-hintme'); void el.offsetWidth; el.classList.add('cs-hintme');
  });
}

// ── Drag & drop des CARTES de sorts (Sortable.js), y compris ENTRE catégories ──
// Chaque grille de catégorie est une zone Sortable du même groupe → on peut
// déplacer un sort dans une autre catégorie. À la dépose, on reconstruit l'ordre
// global + la catégorie de chaque sort depuis le DOM, puis on persiste et on
// re-render (pour rafraîchir les data-sort-idx, sinon une 2ᵉ dépose serait fausse).
let _sortCardSortables = [];
export function bindSortCardsDnd(c, canEdit) {
  _bindSpellTilesTooltip();   // délégué global, s'auto-garde (no-op hors survol/tuiles)
  _sortCardSortables.forEach(s => { try { s.destroy(); } catch {} });
  _sortCardSortables = [];
  if (!canEdit || _sortsHasActiveOrderFilter()) return;
  document.querySelectorAll('.cs-spellcard-grid').forEach(grid => {
    _sortCardSortables.push(makeSortable(grid, {
      prefix: 'cs',
      group: 'cs-spell-cards',
      draggable: '.cs-spellcard',
      handle: '.cs-spellcard-drag',
      animation: 90,
      delay: 0,
      forceFallback: false,
      fallbackTolerance: 3,
      // Desktop : drag natif, beaucoup plus réactif que le fallback JS forcé.
      // Si Sortable repasse en fallback, le clone reste dans .cs-v3 pour garder le style.
      fallbackOnBody: false,
      onEnd: async () => {
        const wrap = document.getElementById('cs-sort-cats-wrap');
        if (!wrap) return;
        const old = c.deck_sorts || [];
        const cats = c.sort_cats || [];
        const next = [];
        let changed = false;
        const gridByCat = new Map(
          [...wrap.querySelectorAll('.cs-spellcard-grid')].map(g => [g.dataset.cat || '__none', g])
        );
        const oldCatId = (spell) => (spell?.catId && cats.some(ct => ct.id === spell.catId)) ? spell.catId : '';

        // Une catégorie repliée n'a pas de grille dans le DOM : on conserve alors
        // ses sorts dans leur ordre actuel. Les catégories ouvertes reprennent
        // l'ordre visible après la dépose, y compris les transferts entre elles.
        [...cats.map(cat => cat.id), ''].forEach(catId => {
          const grid = gridByCat.get(catId || '__none');
          if (!grid) {
            next.push(...old.filter(spell => oldCatId(spell) === catId));
            return;
          }
          grid.querySelectorAll('.cs-spellcard').forEach(card => {
            const spell = old[Number(card.dataset.sortIdx)];
            if (!spell) return;
            if (oldCatId(spell) !== catId) {
              next.push({ ...spell, catId });
              changed = true;
            } else {
              next.push(spell);
            }
          });
        });
        // Sécurité : on ne persiste que si chaque sort est retrouvé exactement une fois.
        if (next.length !== old.length) { _renderSpellsTab(c); return; }
        // Ordre inchangé ET aucune recatégorisation → rien à faire.
        if (!changed && next.every((s, k) => s === old[k])) return;
        ensureSpellIds(next);
        const prevOrder = [...old];
        c.deck_sorts = next;
        if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
        if (charSession.getCurrentChar()?.id === c.id)
          charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
        if (await trySave('characters', c.id, { deck_sorts: next })) {
          showNotif('Ordre des sorts mis à jour', 'info', {
            duration: 5000,
            action: {
              label: '↺ Annuler',
              onClick: async () => {
                c.deck_sorts = prevOrder;
                if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
                if (charSession.getCurrentChar()?.id === c.id)
                  charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
                if (await trySave('characters', c.id, { deck_sorts: prevOrder })) _renderSpellsTab(c);
              },
            },
          });
        }
        _renderSpellsTab(c);
      },
    }));
  });
}

export function renderCharDeck(c, canEdit) {
  _ensureSpellRenderCaches();
  _sortsLoadUiFor(c.id);   // état UI par personnage (mode/densité/pliage) + reset des filtres transitoires
  const allSorts = c.deck_sorts || [];
  const cats     = c.sort_cats  || [];
  const mainP    = getMainWeapon(c);
  const armeDeg  = mainP.degats;
  // Les détails vivent désormais dans l'inspecteur intégré : aucune carte ne
  // change de hauteur, ce qui stabilise les vues Cartes et Liste.
  const openIdx = null;

  const armorSet = getArmorSetData(c);
  const pmDelta  = armorSet.modifiers?.spellPmDelta || 0;

  // ── État UI persistant (filtres / recherche / pliage) ─────────────
  const search   = _norm(_sortsSearch || '');   // minuscules + sans accents
  const mode     = _sortsMode;                    // 'grimoire' | 'prepare'
  const typeFlt  = _sortsTypeFilter || '';        // '' | 'offensif' | 'defensif' | 'utilitaire'
  const runeFlt  = _sortsRuneFilter || '';        // '' | nom de rune (combinable)
  const noyFlt   = _sortsNoyauFilter || '';       // '' | clé de noyau (combinable)
  const pmFlt    = _sortsPmFilter || '';          // '' | 'low' | 'mid' | 'high' (coût en PM)
  const validationFlt = _sortsValidationFilter || '';
  const order = ['manual', 'pm', 'nom', 'validation', 'recipe'].includes(_sortsOrder) ? _sortsOrder : 'manual';
  const density = _sortsEffDensity();             // 'cards' | 'list' (Grimoire) | 'tiles' (Préparer)
  const hasOrderFilter = _sortsHasActiveOrderFilter();
  const collapsed = _sortsCatCollapsed || {};     // { catId: true } = replié

  const DEFAULT_CAT = { id: '__none', nom: 'Sans catégorie', couleur: '#4f8cff' };
  const allCats = cats.length ? [...cats, DEFAULT_CAT] : [DEFAULT_CAT];

  // Stats globales avant filtre
  const activeSorts = allSorts.filter(s => s.actif);
  const deckCount = activeSorts.length;
  const deckMax   = calcDeckMax(c);
  // PM du perso (mode Préparer) : ressource courante pour signaler les sorts
  // trop chers — même source que la fiche (pmActuel, défaut = max).
  const pmMax = calcPMMax(c);
  const pmCur = Number.isFinite(parseInt(c.pmActuel)) ? parseInt(c.pmActuel) : pmMax;
  const validationCounts = allSorts.reduce((acc, s) => {
    acc[_sortValidationState(s)] = (acc[_sortValidationState(s)] || 0) + 1;
    return acc;
  }, { pending: 0, ok: 0, no: 0 });

  // ── Application des filtres : search + statut + coût + type ──────
  const matchSpell = (s) => {
    if (search) {
      const catName = cats.find(ct => ct.id === s.catId)?.nom || '';
      const hay = _norm([
        s.nom || '', s.effet || '', s.noyau || '', s.mjNotes || '', catName,
        ...noyauTypesFor(s).map(t => t.label || t.nom || ''),
        ...(s.runes || []),
      ].join(' '));
      if (!hay.includes(search)) return false;
    }
    if (validationFlt && _sortValidationState(s) !== validationFlt) return false;
    if (pmFlt && _sortPmBucket(_effectiveSortPm(s, pmDelta)) !== pmFlt) return false;
    if (_sortsDuplicateOnly && (recipeCounts.get(_spellRecipeKey(s)) || 0) < 2) return false;
    if (_sortsRecipeKeyFilter && _spellRecipeKey(s) !== _sortsRecipeKeyFilter) return false;
    // Facettes COMBINABLES : type ET rune ET noyau (chacune indépendante)
    if (typeFlt) {
      const types = _getSortTypes(s);
      if (typeFlt === 'offensif'   && !types.includes('offensif')) return false;
      if (typeFlt === 'defensif'   && !types.includes('defensif')) return false;
      if (typeFlt === 'utilitaire' && !(types.includes('utilitaire') && !types.includes('offensif') && !types.includes('defensif'))) return false;
    }
    if (runeFlt && !_displayRunes(s.runes || []).includes(runeFlt)) return false;
    if (noyFlt && !noyauTypesFor(s).some(t => _noyauFilterKey(t) === noyFlt)) return false;
    return true;
  };

  // ── Filtre INTELLIGENT : ne proposer que les types et runes RÉELLEMENT utilisés ──
  const usedTypes = new Set();   // 'offensif' | 'defensif' | 'utilitaire'
  const usedRunes = new Set();   // noms de runes présents dans au moins un sort
  const runeUsageCounts = new Map(); // occurrences totales : atlas du grimoire
  const usedNoyaux = new Map();  // noyaux/éléments présents dans au moins un sort
  const usedPmBuckets = new Set(); // tranches de coût présentes (pour le filtre mana)
  allSorts.forEach(s => {
    usedPmBuckets.add(_sortPmBucket(_effectiveSortPm(s, pmDelta)));
    const t = _getSortTypes(s);
    if (t.includes('offensif')) usedTypes.add('offensif');
    if (t.includes('defensif')) usedTypes.add('defensif');
    if (t.includes('utilitaire') && !t.includes('offensif') && !t.includes('defensif')) usedTypes.add('utilitaire');
    _displayRunes(s.runes || []).forEach(r => {
      usedRunes.add(r);
      runeUsageCounts.set(r, (runeUsageCounts.get(r) || 0) + 1);
    });
    noyauTypesFor(s).forEach(nt => {
      const k = _noyauFilterKey(nt);
      if (k && !usedNoyaux.has(k)) usedNoyaux.set(k, nt);
    });
  });
  const TYPE_META = {
    offensif:   { lbl: '⚔️ Off',  cls: 'off' },
    defensif:   { lbl: '🛡️ Soutien',  cls: 'def' },
    utilitaire: { lbl: '🔧 Util.', cls: 'util' },
  };
  // Runes ordonnées comme RUNE_META, filtrées sur celles utilisées par le perso.
  const usedRuneMetas = RUNE_META.filter(rm => usedRunes.has(rm.nom));
  const usedNoyauMetas = [...usedNoyaux.entries()]
    .sort((a, b) => String(a[1].label || '').localeCompare(String(b[1].label || ''), 'fr', { sensitivity: 'base' }));

  const recipeCounts = new Map();
  allSorts.forEach(s => {
    if (!_displayRunes(s.runes || []).length) return;
    const key = _spellRecipeKey(s);
    recipeCounts.set(key, (recipeCounts.get(key) || 0) + 1);
  });
  const repeatedRecipeGroups = [...recipeCounts.values()].filter(count => count > 1).length;
  const repeatedRecipeExtras = [...recipeCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const dominantRune = [...runeUsageCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const dominantRuneMeta = dominantRune ? RUNE_META.find(rm => rm.nom === dominantRune[0]) : null;

  const sortsByCat = {};
  allCats.forEach(cat => { sortsByCat[cat.id] = []; });
  let visibleCount = 0;
  allSorts.forEach((s, globalIdx) => {
    const catId = s.catId && cats.find(cat => cat.id === s.catId) ? s.catId : '__none';
    const ok = matchSpell(s);
    sortsByCat[catId].push({ s, globalIdx, hidden: !ok });
    if (ok) visibleCount += 1;
  });

  // L'en-tête reste volontairement limité à la recherche et aux deux modes.
  const deckOver = deckCount > deckMax;
  const filtersActive = !!(typeFlt || runeFlt || noyFlt || pmFlt || validationFlt || _sortsDuplicateOnly || _sortsRecipeKeyFilter || order !== 'manual');
  let html = `<div class="cs-section cs-section--compact cs-sorts-v3 is-${mode} ${mode==='grimoire' && _sortsCompareKeys.length===1?'is-compare-picking':''}">

    <!-- Barre d'action : retrouver et affiner la bibliothèque -->
    <div class="cs-sorts-bar">
      <div class="cs-sorts-search-wrap">
        <span class="cs-sorts-search-ico">🔍</span>
        <input type="text" class="cs-sorts-search" id="cs-sorts-search"
          placeholder="Rechercher un sort…"
          value="${_esc(_sortsSearch || '')}"
          aria-label="Rechercher un sort (nom, effet, rune, élément, catégorie)"
          data-input="_sortsSearchInput">
        ${search ? `<button class="cs-sorts-search-clear" data-action="_sortsSetSearch" data-val="" title="Effacer">✕</button>` : ''}
      </div>
      <button class="cs-sorts-toolbtn ${_sortsFiltersOpen?'is-active':''}${filtersActive?' has-dot':''}" data-action="_sortsToggleFilters" aria-pressed="${_sortsFiltersOpen?'true':'false'}" title="Filtres & tri">
        <span class="cs-sorts-toolbtn-ico">⚙</span><span class="cs-sorts-toolbtn-lbl">Filtres</span>
      </button>
      <button class="cs-sorts-toolbtn ${_sortsMenuOpen?'is-active':''}" data-action="_sortsToggleMenu" aria-pressed="${_sortsMenuOpen?'true':'false'}" title="Plus d'outils">
        <span class="cs-sorts-toolbtn-ico">⋯</span>
      </button>
    </div>

    <!-- Deux espaces mentaux distincts : collection / équipement -->
    <div class="cs-sorts-viewrow">
      <div class="cs-sorts-viewseg" role="tablist" aria-label="Mode de l'onglet Sorts">
        <button class="cs-sorts-seg ${mode==='grimoire'?'on':''}" role="tab" aria-selected="${mode==='grimoire'}" data-action="_sortsSetMode" data-mode="grimoire" title="Gérer tes sorts : catégories, filtres, édition">
          <span class="cs-sorts-seg-ico">📖</span>
          <span class="cs-sorts-seg-copy"><strong>Ma collection</strong><small>Classer et modifier les sorts</small></span>
          <b>${allSorts.length}</b>
        </button>
        <button class="cs-sorts-seg cs-sorts-seg--deck ${mode==='prepare'?'on':''} ${deckOver?'is-over':''}" role="tab" aria-selected="${mode==='prepare'}" data-action="_sortsSetMode" data-mode="prepare" title="Préparer ton Deck : clique une tuile pour ajouter ou retirer un sort (capacité INT)">
          <span class="cs-sorts-seg-ico">⚡</span>
          <span class="cs-sorts-seg-copy"><strong>Mon deck</strong><small>Choisir les sorts de combat</small></span>
          <b>${deckCount}<small>/${deckMax}</small></b>
        </button>
      </div>
      ${mode==='grimoire' ? `<div class="cs-sorts-viewseg cs-sorts-densityseg" role="group" aria-label="Densité d'affichage">
        <button class="cs-sorts-seg cs-sorts-seg--dens ${density==='cards'?'on':''}" data-action="_sortsSetDensity" data-density="cards" aria-pressed="${density==='cards'}" title="Vue cartes — le détail visible">▦</button>
        <button class="cs-sorts-seg cs-sorts-seg--dens ${density==='list'?'on':''}" data-action="_sortsSetDensity" data-density="list" aria-pressed="${density==='list'}" title="Vue liste — une ligne par sort">☰</button>
      </div>` : ''}
    </div>

    <!-- ②bis Menu « Plus d'outils » (repliable) -->
    ${_sortsMenuOpen ? `<div class="cs-sorts-menu">
      ${canEdit ? `<button class="cs-sorts-menu-item" data-action="openInvocationLibrary">🐾 Mes invocations</button>` : ''}
      ${cats.length ? `<button class="cs-sorts-menu-item" data-action="_sortsToggleAllCats">⇕ Plier / déplier tout</button>` : ''}
      ${STATE.isAdmin ? (() => {
        const rl = Number.isFinite(parseInt(c.maxRunes)) ? parseInt(c.maxRunes) : 1;
        return `<div class="cs-sorts-menu-mjrunes" title="MJ : runes d'effet débloquées pour ce personnage">
          <span>🔮 Runes MJ</span>
          <button class="cs-sorts-mjrunes-btn" data-action="_sortsAdjRuneLimit" data-delta="-1"${rl<=0?' disabled':''}>−</button>
          <b>${rl}</b>
          <button class="cs-sorts-mjrunes-btn" data-action="_sortsAdjRuneLimit" data-delta="1"${rl>=20?' disabled':''}>＋</button>
        </div>`;
      })() : ''}
    </div>` : ''}

    <!-- ③ Panneau Filtres & tri (repliable) -->
    ${_sortsFiltersOpen ? `<div class="cs-sorts-filterpanel">
      <div class="cs-sorts-filt-row">
        <span class="cs-sorts-filt-lbl">Trier</span>
        ${[['manual','Manuel'],['pm','PM'],['nom','Nom'],['recipe','Recette'],['validation','MJ']]
          .map(([v,lbl]) => `<button class="cs-sorts-chip sort ${order===v?'on':''}" data-action="_sortsSetOrder" data-order="${v}">${lbl}</button>`).join('')}
      </div>
      <div class="cs-sorts-filt-row cs-sorts-filt-row--mj">
        <span class="cs-sorts-filt-lbl">Statut</span>
        <button class="cs-sorts-chip mj ${validationFlt===''?'on':''}" data-action="_sortsSetValidation" data-val="">Tous</button>
        <button class="cs-sorts-chip mj wait ${validationFlt==='pending'?'on':''}" data-action="_sortsSetValidation" data-val="pending" title="En attente de validation MJ">⏳ ${validationCounts.pending || 0}</button>
        <button class="cs-sorts-chip mj ok ${validationFlt==='ok'?'on':''}" data-action="_sortsSetValidation" data-val="ok" title="Validés par le MJ">✅ ${validationCounts.ok || 0}</button>
        <button class="cs-sorts-chip mj no ${validationFlt==='no'?'on':''}" data-action="_sortsSetValidation" data-val="no" title="Refusés — à corriger">❌ ${validationCounts.no || 0}</button>
      </div>
      ${usedPmBuckets.size > 1 ? `<div class="cs-sorts-filt-row">
        <span class="cs-sorts-filt-lbl">Coût</span>
        <button class="cs-sorts-chip pm ${pmFlt===''?'on':''}" data-action="_sortsSetPm" data-pm="">Tous</button>
        ${_PM_BUCKETS.filter(([k]) => usedPmBuckets.has(k)).map(([k, lbl, tip]) =>
          `<button class="cs-sorts-chip pm ${pmFlt===k?'on':''}" data-action="_sortsSetPm" data-pm="${k}" title="${tip}">${lbl}</button>`).join('')}
      </div>` : ''}
      ${(usedTypes.size || usedRuneMetas.length || usedNoyauMetas.length) ? `<div class="cs-sorts-filt-row">
        <span class="cs-sorts-filt-lbl">Filtrer</span>
        <button class="cs-sorts-chip type ${(!typeFlt && !runeFlt && !noyFlt)?'on':''}" data-action="_sortsClearFacets" title="Effacer type, rune et noyau">Tout</button>
        ${['offensif','defensif','utilitaire'].filter(t => usedTypes.has(t)).map(t => {
          const m = TYPE_META[t];
          return `<button class="cs-sorts-chip type ${m.cls} ${typeFlt===t?'on':''}" data-action="_sortsSetType" data-type="${t}" title="Combinable avec une rune et un noyau">${m.lbl}</button>`;
        }).join('')}
        ${usedRuneMetas.length ? `<span class="cs-sorts-filt-sep"></span>` : ''}
        ${usedRuneMetas.map(rm =>
          `<button class="cs-sorts-chip rune ${runeFlt===rm.nom?'on':''}" style="--c:${rm.color}" data-action="_sortsSetRune" data-rune="${_esc(rm.nom)}" title="${_esc(rm.effet || rm.nom)} — combinable avec type et noyau">${rm.icon} ${_esc(rm.nom)}</button>`
        ).join('')}
        ${usedNoyauMetas.length ? `<span class="cs-sorts-filt-sep"></span>` : ''}
        ${usedNoyauMetas.map(([key, nt]) =>
          `<button class="cs-sorts-chip noyau ${noyFlt===key?'on':''}" style="--c:${nt.color || '#8aa'}" data-action="_sortsSetNoyau" data-noyau="${_esc(key)}" title="Noyau ${_esc(nt.label || nt.nom || '')} — combinable avec type et rune">${nt.icon || '✦'} ${_esc(nt.label || nt.nom || 'Noyau')}</button>`
        ).join('')}
      </div>` : ''}
      ${filtersActive ? `<div class="cs-sorts-filt-row cs-sorts-filt-row--reset">
        <button class="cs-sorts-chip reset" data-action="_sortsResetFilters" title="Réinitialiser filtres et tri">↺ Réinitialiser</button>
      </div>` : ''}
    </div>` : ''}

    <!-- ④ Tray du Deck (Préparer : sockets + PM, sticky) ou ligne 📊 discrète (+ Set Léger) -->
    ${density === 'tiles' ? `<div class="cs-sorts-deckinfo is-tray">
      ${_renderDeckSockets(allSorts.map((s, gi) => ({ s, i: gi })).filter(x => x.s.actif), deckMax, pmDelta, canEdit, pmCur, pmMax)}
      ${pmDelta !== 0 ? `<span class="cs-sorts-setlight" title="Le Set Léger équipé modifie automatiquement le coût de tes sorts">
        🧙 Set Léger <b>${pmDelta > 0 ? '+' : ''}${pmDelta} PM</b>
      </span>` : ''}
    </div>` : (activeSorts.length || pmDelta !== 0) ? `<div class="cs-sorts-deckinfo">
      ${_renderDeckStats(activeSorts, deckMax, pmDelta)}
      ${pmDelta !== 0 ? `<span class="cs-sorts-setlight" title="Le Set Léger équipé modifie automatiquement le coût de tes sorts">
        🧙 Set Léger <b>${pmDelta > 0 ? '+' : ''}${pmDelta} PM</b>
      </span>` : ''}
    </div>` : ''}`;

  // ── État vide / aucun résultat ───────────────────────────────────
  if (allSorts.length === 0) {
    html += `<div class="cs-sorts-empty-state cs-sorts-empty-state--first">
      <div class="cs-sorts-empty-ico">🔮</div>
      <div class="cs-sorts-empty-body">
        <b>Aucun sort créé</b>
        <span>Un sort part d'un noyau élémentaire, gagne des runes d'effet, calcule ses PM, puis passe en validation MJ avant d'entrer dans le Deck.</span>
      </div>
      ${canEdit ? `<button class="btn btn-gold btn-sm" data-action="addSort">＋ Premier sort</button>` : ''}
    </div></div>`;
    return html;
  }
  if (visibleCount === 0) {
    html += `<div class="cs-sorts-empty-state cs-sorts-noresult">
      <div class="cs-sorts-empty-ico">🔎</div>
      <div class="cs-sorts-empty-body">
        <b>Aucun sort ne correspond</b>
        <span>${search ? `« ${_esc(search)} »${typeFlt?' · '+typeFlt:''}${validationFlt?' · statut filtré':''}` : 'Essaie un autre filtre.'}</span>
      </div>
      <button class="btn btn-outline btn-sm" data-action="_sortsResetFilters">Réinitialiser</button>
    </div></div>`;
    return html;
  }

  // ── Espace de travail : navigation latérale + collection ──────────
  const libraryHead = `<div class="cs-spellbook-library-head">
    <div>
      <span class="cs-spellbook-library-kicker">${mode === 'prepare' ? 'SÉLECTION DE COMBAT' : 'COMPENDIUM'}</span>
      <h3>${mode === 'prepare' ? 'Choisis tes sorts' : 'Bibliothèque de sorts'}</h3>
      <p>${mode === 'prepare' ? 'Clique sur une compétence pour l’ajouter ou la retirer du deck.' : 'Parcours, compare et modifie ton arsenal magique.'}</p>
    </div>
    <div class="cs-spellbook-library-tools">
      ${_sortsRecipeKeyFilter ? `<button class="cs-spellbook-recipefilter" data-action="_sortsClearRecipeFilter" title="Afficher de nouveau toutes les recettes">≈ Recette ciblée <span>✕</span></button>` : ''}
      <span class="cs-spellbook-library-count">${visibleCount} affiché${visibleCount > 1 ? 's' : ''}</span>
    </div>
  </div>`;
  const comparePanel = mode === 'grimoire' ? _renderSpellComparePanel(allSorts, pmDelta, c) : '';
  const inspectorPanel = mode === 'grimoire' ? _renderSpellInspector(allSorts, pmDelta, c, canEdit) : '';
  const catManagerPanel = mode === 'grimoire' && canEdit && _sortsCatPanelOpen ? _renderCatManager(cats) : '';

  if (mode === 'grimoire') {
    const sidebarCats = allCats.map(cat => {
      const entries = (sortsByCat[cat.id] || []).filter(e => !e.hidden);
      const total = (sortsByCat[cat.id] || []).length;
      if (!total && !canEdit) return '';
      const prepared = entries.filter(e => e.s.actif).length;
      return `<button class="cs-spellnav-cat" style="--cat-col:${cat.couleur}" data-action="_sortsFocusCategory" data-id="${cat.id}">
        <span class="cs-spellnav-cat-mark"></span>
        <span class="cs-spellnav-cat-copy"><b>${_esc(cat.nom)}</b><small>${prepared} dans le deck</small></span>
        <span class="cs-spellnav-cat-count">${entries.length}</span>
      </button>`;
    }).join('');

    html += `<div class="cs-spellbook-workspace ${inspectorPanel?'has-inspector':''}">
      <aside class="cs-spellbook-sidebar ${_sortsAnalysisOpen?'is-analysis-open':''}" aria-label="Navigation du grimoire">
        <div class="cs-spellnav-head">
          <span class="cs-spellnav-rune">✦</span>
          <div><b>Mon grimoire</b><small>${allSorts.length} sorts maîtrisés</small></div>
        </div>
        ${canEdit ? `<button class="cs-spellnav-create" data-action="addSort"><span>＋</span><b>Créer un sort</b><small>Ouvrir la forge</small></button>` : ''}
        <div class="cs-spellnav-section">
          <span class="cs-spellnav-label">CATÉGORIES</span>
          <div class="cs-spellnav-cats">${sidebarCats}</div>
        </div>
        <button class="cs-spellnav-analysis-toggle ${_sortsAnalysisOpen?'on':''}" data-action="_sortsToggleAnalysis">
          <span>⌁</span><b>Analyse du grimoire</b><i>${_sortsAnalysisOpen?'−':'＋'}</i>
        </button>
        ${usedRuneMetas.length ? `<div class="cs-spellnav-section cs-spellnav-rune-section cs-spellnav-advanced">
          <span class="cs-spellnav-label">RUNES UTILISÉES</span>
          <div class="cs-spellnav-runes">
            ${usedRuneMetas.map(rm => `<button class="${runeFlt===rm.nom?'on':''}" style="--rune-col:${rm.color}" data-action="_sortsSetRune" data-rune="${_esc(rm.nom)}" title="Afficher les sorts avec la rune ${_esc(rm.nom)}">
              <span class="cs-spellnav-rune-icon">${rm.icon}</span>
              <span class="cs-spellnav-rune-name">${_esc(rm.nom)}</span>
              <b>×${runeUsageCounts.get(rm.nom) || 0}</b>
            </button>`).join('')}
          </div>
        </div>` : ''}
        <div class="cs-spellnav-section cs-spellnav-insight-section cs-spellnav-advanced">
          <span class="cs-spellnav-label">DIVERSITÉ DU GRIMOIRE</span>
          <div class="cs-spellnav-insights">
            <div><span class="is-unique">✦</span><p><b>${recipeCounts.size}</b><small>recettes distinctes</small></p></div>
            ${repeatedRecipeGroups ? `<button class="has-warning ${_sortsDuplicateOnly?'on':''}" data-action="_sortsToggleDuplicateRecipes" title="Afficher uniquement les recettes répétées"><span>≈</span><p><b>${repeatedRecipeExtras}</b><small>sort${repeatedRecipeExtras > 1 ? 's' : ''} à recette répétée</small></p></button>` : `<div><span class="is-ok">✓</span><p><b>Unique</b><small>aucune recette répétée</small></p></div>`}
            ${dominantRune && dominantRuneMeta ? `<div style="--rune-col:${dominantRuneMeta.color}"><span class="is-rune">${dominantRuneMeta.icon}</span><p><b>${_esc(dominantRune[0])}</b><small>rune dominante · ×${dominantRune[1]}</small></p></div>` : ''}
          </div>
        </div>
        <div class="cs-spellnav-section cs-spellnav-advanced">
          <span class="cs-spellnav-label">SUIVI MJ</span>
          <div class="cs-spellnav-statuses">
            <button data-action="_sortsSetValidation" data-val="" class="${validationFlt===''?'on':''}"><span>◆</span> Tous <b>${allSorts.length}</b></button>
            <button data-action="_sortsSetValidation" data-val="ok" class="is-ok ${validationFlt==='ok'?'on':''}"><span>✓</span> Validés <b>${validationCounts.ok || 0}</b></button>
            <button data-action="_sortsSetValidation" data-val="pending" class="is-wait ${validationFlt==='pending'?'on':''}"><span>⌛</span> En attente <b>${validationCounts.pending || 0}</b></button>
            ${validationCounts.no ? `<button data-action="_sortsSetValidation" data-val="no" class="is-no ${validationFlt==='no'?'on':''}"><span>!</span> À corriger <b>${validationCounts.no}</b></button>` : ''}
          </div>
        </div>
        ${canEdit ? `<button class="cs-spellnav-manage ${_sortsCatPanelOpen?'on':''}" data-action="openSortCatEditor"
          aria-expanded="${_sortsCatPanelOpen}" aria-controls="cs-catmgr" title="Ajouter, renommer, colorer ou supprimer une catégorie">
          <span class="cs-spellnav-manage-icon">✎</span>
          <span class="cs-spellnav-manage-copy"><b>${_sortsCatPanelOpen?'Fermer l’éditeur':'Modifier les catégories'}</b><small>Ajouter, renommer ou colorer</small></span>
          <i>${_sortsCatPanelOpen?'−':'›'}</i>
        </button>` : ''}
      </aside>
      <main class="cs-spellbook-collection">${libraryHead}${comparePanel}${catManagerPanel}<div class="cs-sort-cats-wrap" id="cs-sort-cats-wrap">`;
  } else {
    html += `${libraryHead}<div class="cs-sort-cats-wrap" id="cs-sort-cats-wrap">`;
  }
  allCats.forEach(cat => {
    const entries = sortsByCat[cat.id] || [];
    const visibleEntries = entries.filter(e => !e.hidden);
    if (order !== 'manual') visibleEntries.sort(_sortsOrderComparator(order, pmDelta));
    const showEmptyDrop = canEdit && !hasOrderFilter;
    if (!visibleEntries.length && !showEmptyDrop) return;
    const isDefault = cat.id === '__none';
    const isCollapsed = !!collapsed[cat.id];
    const activeInCat = visibleEntries.filter(e => e.s.actif).length;

    html += `<div class="cs-sort-cat-block ${isDefault?'is-default':''} ${isCollapsed?'is-collapsed':''}" data-cat-id="${cat.id}" style="--cat-col:${cat.couleur}">`;
    if (cats.length > 0) {
      html += `<div class="cs-sort-cat-hdr" style="--cat-col:${cat.couleur}"
          data-action="_sortsToggleCat" data-id="${cat.id}"
          tabindex="0" role="button" aria-expanded="${!isCollapsed}">
        ${(!isDefault && canEdit) ? `<span class="cs-sort-cat-drag" title="Glisser pour réordonner" data-action="" data-stop-propagation>⠿</span>` : ''}
        <span class="cs-sort-cat-chev">${isCollapsed?'▸':'▾'}</span>
        <span class="cs-sort-cat-name">${_esc(cat.nom)}</span>
        <span class="cs-sort-cat-count">${visibleEntries.length} sort${visibleEntries.length>1?'s':''} · ${activeInCat} dans le deck</span>
      </div>`;
    }
    if (!isCollapsed) {
      html += `<div class="cs-spellcard-grid ${density==='list'?'is-list':density==='tiles'?'is-tiles':'is-cards'} ${visibleEntries.length?'':'is-empty'}" data-cat="${cat.id}">`;
      visibleEntries.forEach(({ s, globalIdx: i }) => {
        html += _renderSortCard(s, i, openIdx, canEdit, armeDeg, c, cats, pmDelta, deckCount, deckMax, pmCur, recipeCounts.get(_spellRecipeKey(s)) || 1, canEdit && !hasOrderFilter);
        if (inspectorPanel && _spellCompareKey(s, i) === _sortsInspectorKey) html += inspectorPanel;
      });
      if (!visibleEntries.length) {
        html += `<div class="cs-spellcard-emptydrop">Dépose un sort ici</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;  // /cat-block
  });

  html += `</div>`;  // /cats-wrap

  if (mode === 'grimoire') html += `</main></div>`; // /collection /workspace

  html += `</div>`;
  return html;
}

// ── Handlers UI (search / filtres / pliage) ─────────────────────────
function _sortsRerender() {
  _renderSpellsTab();
}
// Le re-render détruit l'input → on lui rend le focus (caret en fin) pour que
// la frappe continue sans interruption.
function _sortsRestoreSearchFocus() {
  const el = document.getElementById('cs-sorts-search');
  if (!el) return;
  el.focus({ preventScroll: true });
  const n = el.value.length;
  try { el.setSelectionRange(n, n); } catch { /* type non textuel */ }
}
function _sortsSetSearch(v, opts = {}) {
  _sortsSearch = v || '';
  if (_sortsSearchTimer) clearTimeout(_sortsSearchTimer);
  if (opts.immediate) {
    _sortsSearchTimer = null;
    _sortsRerender();
    _sortsRestoreSearchFocus();
    return;
  }
  _sortsSearchTimer = setTimeout(() => {
    _sortsSearchTimer = null;
    _sortsRerender();
    _sortsRestoreSearchFocus();
  }, 150);
}
function _sortsSetMode(m) {
  const mode = m === 'prepare' ? 'prepare' : 'grimoire';
  if (mode === _sortsMode) return;
  _sortsMode = mode;
  _sortsReplaceIdx = null;
  lsJson.set('cs-sorts-mode', mode);   // défaut global (nouveaux persos)
  _sortsPersistUi();
  _sortsRerender();
}
// Facettes combinables : re-cliquer une facette active la désactive.
function _sortsSetType(t) {
  const v = ['offensif', 'defensif', 'utilitaire'].includes(t) ? t : '';
  _sortsTypeFilter = (v && v !== _sortsTypeFilter) ? v : '';
  _sortsRerender();
}
function _sortsSetRune(r) {
  _sortsRuneFilter = (r && r !== _sortsRuneFilter) ? r : '';
  _sortsRerender();
}
function _sortsSetNoyau(k) {
  _sortsNoyauFilter = (k && k !== _sortsNoyauFilter) ? k : '';
  _sortsRerender();
}
function _sortsClearFacets() {
  _sortsTypeFilter = ''; _sortsRuneFilter = ''; _sortsNoyauFilter = '';
  _sortsRerender();
}
function _sortsSetPm(v) {
  _sortsPmFilter = ['low', 'mid', 'high'].includes(v) ? v : '';
  _sortsRerender();
}
function _sortsSetDensity(v) {
  const d = v === 'list' ? 'list' : 'cards';
  if (d === _sortsDensity) return;
  _sortsDensity = d;
  lsJson.set('cs-sorts-density', d);   // défaut global (nouveaux persos)
  _sortsPersistUi();
  _sortsRerender();
}
function _sortsSetValidation(v) {
  _sortsValidationFilter = ['ok', 'pending', 'no'].includes(v) ? v : '';
  _sortsRerender();
}
function _sortsSetOrder(v) {
  _sortsOrder = ['manual', 'pm', 'nom', 'validation', 'recipe'].includes(v) ? v : 'manual';
  _sortsRerender();
}
// MJ : règle le nombre de runes d'effet débloquées (characters.maxRunes) directement
// depuis l'onglet Sorts, sans ouvrir l'éditeur de sort.
async function _sortsAdjRuneLimit(delta) {
  if (!STATE.isAdmin) return;
  const c = _getCurrentSpellChar() || STATE.activeChar; if (!c) return;
  const cur  = parseInt(c.maxRunes);
  const base = Number.isFinite(cur) ? cur : 1;
  const next = Math.max(0, Math.min(20, base + (parseInt(delta) || 0)));
  if (next === base) return;
  c.maxRunes = next;
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (charSession.getCurrentChar()?.id === c.id)
    charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  if (await trySave('characters', c.id, { maxRunes: next })) {
    _renderSpellsTab(c);
    showNotif(`🔮 Runes d'effet : ${next} pour ${_esc(c.nom || 'ce perso')}`, 'success');
  }
}

async function _sortsSetCardCat(idx, catId) {
  const c = _getCurrentSpellChar() || STATE.activeChar; if (!c) return;
  const cats = c.sort_cats || [];
  const cleanCatId = cats.some(cat => cat.id === catId) ? catId : '';
  const sorts = [...(c.deck_sorts || [])];
  const s = sorts[idx]; if (!s) return;
  const prevCatId = s.catId || '';
  if (prevCatId === cleanCatId) return;
  sorts[idx] = { ...s, catId: cleanCatId };
  ensureSpellIds(sorts);
  c.deck_sorts = sorts;
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (charSession.getCurrentChar()?.id === c.id)
    charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  if (await trySave('characters', c.id, { deck_sorts: sorts })) {
    _renderSpellsTab(c);
  } else {
    sorts[idx] = { ...sorts[idx], catId: prevCatId };
    c.deck_sorts = sorts;
    if (charSession.getCurrentChar()?.id === c.id)
      charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
    _renderSpellsTab(c);
  }
}

function _sortsToggleCat(catId) {
  _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}) };
  _sortsCatCollapsed[catId] = !_sortsCatCollapsed[catId];
  _sortsPersistUi();
  _sortsRerender();
}
function _sortsToggleAllCats() {
  const c = _getCurrentSpellChar(); if (!c) return;
  const cats = c.sort_cats || [];
  const all = [...cats.map(cat => cat.id), '__none'];
  const cur = _sortsCatCollapsed || {};
  const anyOpen = all.some(id => !cur[id]);
  const next = {};
  all.forEach(id => { next[id] = anyOpen; });   // si au moins 1 ouvert → tout plier; sinon tout déplier
  _sortsCatCollapsed = next;
  _sortsPersistUi();
  _sortsRerender();
}
function _sortsResetFilters() {
  if (_sortsSearchTimer) clearTimeout(_sortsSearchTimer);
  _sortsSearchTimer = null;
  _sortsSearch = '';
  _sortsTypeFilter = '';
  _sortsRuneFilter = '';
  _sortsNoyauFilter = '';
  _sortsPmFilter = '';
  _sortsValidationFilter = '';
  _sortsDuplicateOnly = false;
  _sortsRecipeKeyFilter = '';
  _sortsOrder = 'manual';
  _sortsRerender();
}

// Panneaux repliables de l'onglet (anti-cockpit) : filtres/tri, menu outils, analyse.
function _sortsToggleFilters() { _sortsFiltersOpen = !_sortsFiltersOpen; _sortsRerender(); }
function _sortsToggleMenu()    { _sortsMenuOpen    = !_sortsMenuOpen;    _sortsRerender(); }
function _sortsToggleAnalysis() { _sortsAnalysisOpen = !_sortsAnalysisOpen; _sortsRerender(); }

// Navigation du compendium : déplie si nécessaire puis amène l'école choisie au centre.
function _sortsFocusCategory(id) {
  const scrollToCat = () => {
    const target = [...document.querySelectorAll('.cs-sort-cat-block')]
      .find(el => el.dataset.catId === id);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (_sortsCatCollapsed?.[id]) {
    _sortsCatCollapsed[id] = false;
    _sortsPersistUi();
    _sortsRerender();
    requestAnimationFrame(() => requestAnimationFrame(scrollToCat));
    return;
  }
  scrollToCat();
}

function _sortsToggleDuplicateRecipes() {
  _sortsDuplicateOnly = !_sortsDuplicateOnly;
  if (_sortsDuplicateOnly) _sortsRecipeKeyFilter = '';
  _sortsRerender();
}

function _sortsFocusRecipe(key) {
  _sortsRecipeKeyFilter = key && key !== _sortsRecipeKeyFilter ? key : '';
  if (_sortsRecipeKeyFilter) _sortsDuplicateOnly = false;
  _sortsRerender();
}

function _sortsClearRecipeFilter() {
  _sortsRecipeKeyFilter = '';
  _sortsRerender();
}

function _sortsInspectSpell(index) {
  const c = _getCurrentSpellChar();
  const s = (c?.deck_sorts || [])[index];
  if (!s) return;
  const key = _spellCompareKey(s, index);

  // Comparaison guidée : après le premier choix, cliquer une autre carte
  // sélectionne directement le second sort au lieu d'ouvrir une nouvelle fiche.
  if (_sortsCompareKeys.length === 1 && !_sortsCompareKeys.includes(key)) {
    _sortsToggleCompare(index);
    return;
  }

  const opening = _sortsInspectorKey !== key;
  _sortsInspectorKey = opening ? key : '';
  _sortsRerender();
  if (opening) {
    requestAnimationFrame(() => document.querySelector('.cs-spellinspector')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
}

function _sortsCloseInspector() {
  _sortsInspectorKey = '';
  _sortsRerender();
}

function _sortsFocusComparePanel() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const panel = document.querySelector('.cs-spellcompare');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel?.focus({ preventScroll: true });
  }));
}

function _sortsToggleCompare(index) {
  const c = _getCurrentSpellChar();
  const s = (c?.deck_sorts || [])[index];
  if (!s) return;
  const key = _spellCompareKey(s, index);
  if (_sortsCompareKeys.includes(key)) {
    _sortsCompareKeys = _sortsCompareKeys.filter(k => k !== key);
  } else if (_sortsCompareKeys.length < 2) {
    _sortsCompareKeys = [..._sortsCompareKeys, key];
  } else {
    _sortsCompareKeys = [key];
    showNotif('Nouvelle comparaison — choisis un deuxième sort.', 'info');
  }

  // Un seul sort sélectionné = mode de choix guidé. On libère la place occupée
  // par la fiche et on garde le bandeau d'instruction visible.
  if (_sortsCompareKeys.length === 1) _sortsInspectorKey = '';
  _sortsRerender();
  if (_sortsCompareKeys.length) _sortsFocusComparePanel();
}

function _sortsClearCompare() {
  _sortsCompareKeys = [];
  _sortsRerender();
}

function _renderSortCard(s, i, openIdx, canEdit, armeDeg, c, cats = [], pmDelta = 0, deckCount = 0, deckMax = Infinity, pmCur = null, recipeRepeats = 1, canDrag = false) {
  const isOpen   = openIdx === i;
  const isTiles  = _sortsEffDensity() === 'tiles';
  const compareKey = _spellCompareKey(s, i);
  const isCompared = _sortsCompareKeys.includes(compareKey);
  const isInspected = _sortsInspectorKey === compareKey;
  const runesAll = s.runes || [];
  const isClassic = s.designMode === 'classic';
  const types    = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);
  const nbCibles = _calcSortCibles(s);
  const nbProt   = runesAll.filter(r => r === 'Protection').length;
  const nbAmp    = runesAll.filter(r => r === 'Amplification').length;
  const activeIds = new Set(_activeCombos(s).map(co => co.id));

  const ACTION_CFG = {
    action:       { label:'⚡ Act.',   color:'#e8b84b' },
    action_bonus: { label:'✴️ Bonus', color:'#f97316' },
    reaction:     { label:'🔄 Réac.', color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action] || ACTION_CFG.action;

  // Modificateur de l'arme principale + maîtrise (Poings 2d4+Force si vide)
  const mainP   = getMainWeapon(c);
  const statKey = mainP.statAttaque || mainP.toucherStat || 'force';
  const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
  const statMod = Math.floor((Math.min(22, statVal) - 10) / 2);
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
  const statModS = statMod >= 0 ? `+${statMod}` : `${statMod}`;
  const maitrise = getSharedMaitriseBonus(c, mainP || {});

  // ── Détection des modes "sans dégâts d'impact" ─────────────────────
  const hasEnchant    = runesAll.includes('Enchantement');
  const hasAffliction = runesAll.includes('Affliction');
  const enchantMode   = s.enchantMode || 'dmg';
  const afflictionMode = s.afflictionMode || 'dot';
  // Branche Lacération d'Affliction : frappe l'attaque de base + réduit la CA,
  // donc PAS de suppression d'impact ni de chip DoT/État.
  const isLaceration  = _hasLaceration(s);
  const hasAfflictionDebuff = hasAffliction && afflictionMode !== 'laceration';
  // Enchantement-only : pas de dégâts d'impact si pas de degats explicite
  const isEnchantOnly = hasEnchant && !((s.degats || '').trim());
  // Modes Toucher / Déplacement : buff pur sur allié, JAMAIS de dégâts d'impact
  // (même si un degats résiduel traîne d'un ancien mode Dégâts).
  const enchantBuffOnly = hasEnchant && (enchantMode === 'toucher' || enchantMode === 'deplacement');
  // Affliction = jamais d'impact (comme défini côté VTT)
  // Déplacement (Amplification mode déplacement) = jamais de dégâts.
  // Invocation = le sort invoque une créature (qui a ses propres dégâts) — pas d'impact du lanceur.
  const suppressImpactDmg = activeIds.has('coup_chance') || isEnchantOnly || enchantBuffOnly || hasAfflictionDebuff || s.ampMode === 'deplacement' || runesAll.includes('Invocation');

  // Chips clés pour la ligne compacte
  const chips = [];

  // ── 1. Dégâts d'impact (offensif, OU Lacération qui frappe toujours) ──
  if ((types.includes('offensif') || isLaceration) && !suppressImpactDmg) {
    const degBase = _calcSortDegats(s, c);
    let val = degBase;
    if (!isClassic && statMod !== 0) val += ` · ${statLbl}${statModS}`;
    chips.push({ icon:'⚔️', val, color:'#ff6b6b', lbl:'Dégâts infligés' });
  }

  if (isClassic && s.classicEffect === 'heal' && s.soin) {
    chips.push({ icon:'💚', val:_calcSortSoin(s, c), color:'#22c38e', lbl:'Soin' });
  } else if (isClassic && s.classicEffect === 'summon') {
    const maxInv = Math.max(1, parseInt(s.invocation?.max ?? s.classicInvocationCount) || 1);
    chips.push({ icon:'🐾', val:`${maxInv} invocation${maxInv > 1 ? 's' : ''}`, color:'#a16207', lbl:'Créature invoquée' });
  } else if (isClassic && s.classicEffect === 'utility' && s.effet) {
    chips.push({ icon:'✨', val:s.effet, color:'#b47fff', lbl:'Effet utilitaire' });
  }

  if (isClassic && s.classicStateId) {
    const condition = _conditionsLibCache?.find(item => item.id === s.classicStateId);
    chips.push({
      icon: condition?.icon || '◈',
      val: condition?.label || 'État',
      color: s.classicTarget === 'enemy' ? '#ef4444' : '#e8b84b',
      lbl: s.classicTarget === 'enemy'
        ? `Jet de sauvegarde DD ${parseInt(s.classicStateDC) || 11}`
        : 'État appliqué à la cible',
    });
  }

  // ── 2. Affliction : mode décide (DoT / État / Lacération) ──
  // Sentinelle (Affliction + Invocation) absorbe la branche → pas de chip ici.
  const isSentinelle = hasAffliction && runesAll.includes('Invocation');
  if (isSentinelle) {
    // rien : l'affliction est portée par la sentinelle (chip Invocation géré ailleurs)
  } else if (isLaceration) {
    const lac = _calcLaceration(s);
    if (lac) chips.push({ icon:'🩸', val:`CA −${Math.min(lac.reduction, lac.maxElite)}`, color:'#dc2626', lbl:'Réduction de CA de la cible (Lacération)' });
  } else if (hasAfflictionDebuff && !activeIds.has('regeneration')) {
    if (afflictionMode === 'etat') {
      // Mode État : on affiche TOUJOURS un chip état, jamais DoT
      const etat = s.afflictionEtatId
        ? _conditionsLibCache?.find(c2 => c2.id === s.afflictionEtatId)
        : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ État non défini';
      chips.push({ icon:'⛓', val: lbl, color:'#8b5cf6', lbl:'État infligé à l\'ennemi (Affliction)' });
    } else {
      // Mode DoT : formule scalée
      const dot = _calcAfflictionDot(s);
      chips.push({ icon:'🩸', val: `${dot}/t`, color:'#8b5cf6', lbl:'Dégâts par tour (Affliction)' });
    }
  }

  // ── 3. Enchantement : mode décide, JAMAIS de fallback dégâts en mode État ──
  if (hasEnchant && !activeIds.has('arme_invoquee')) {
    if (enchantMode === 'etat') {
      const ids = (Array.isArray(s.enchantEtatIds) && s.enchantEtatIds.length)
        ? s.enchantEtatIds : (s.enchantEtatId ? [s.enchantEtatId] : []);
      if (ids.length) {
        ids.forEach(id => {
          const etat = _conditionsLibCache?.find(c2 => c2.id === id);
          chips.push({ icon:'✨', val: etat ? `${etat.icon || ''} ${etat.label}` : '⚠ État', color:'#e8b84b', lbl:'État bénéfique sur l\'allié (Enchantement)' });
        });
      } else {
        chips.push({ icon:'✨', val: '⚠ État non défini', color:'#e8b84b', lbl:'Enchantement : aucun état défini' });
      }
    } else if (enchantMode === 'toucher' || enchantMode === 'deplacement') {
      const nbP   = runesAll.filter(r => r === 'Puissance').length;
      const bonus = Number.isFinite(parseInt(s.enchantBonus)) ? parseInt(s.enchantBonus) : (2 + nbP);
      const ic    = enchantMode === 'toucher' ? '🎯' : '👢';
      chips.push({ icon: ic, val: `+${bonus}`, color:'#e8b84b', lbl: enchantMode === 'toucher' ? 'Bonus au toucher de l\'allié' : 'Bonus de déplacement de l\'allié' });
    } else {
      // Mode Dégâts : formule bonus sur arme alliée
      const degAuto = _calcEnchantDegats(s);
      if (degAuto) chips.push({ icon:'✨', val: `+${degAuto}`, color:'#e8b84b', lbl:'Bonus de dégâts sur l\'arme alliée' });
    }
  }
  if (activeIds.has('coup_chance')) {
    chips.push({ icon:'🍀', val:'Prochain jet échoué', color:'#facc15', lbl:'Relance le prochain jet raté (Coup de chance)' });
  }

  // ── 4. Protection (CA ou Soin) ──
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (activeIds.has('regeneration')) {
      const dice = nbProt + runesAll.filter(r => r === 'Affliction').length;
      chips.push({ icon:'💚', val: `${(s.regenerationFormula || '').trim() || `${dice}d4`}/t`, color:'#22c38e', lbl:'Soin par tour (Régénération)' });
    } else if (mode === 'soin') {
      if (activeIds.has('drain')) {
        const pct = Math.round(_calcDrainPct(s) * 100);
        chips.push({ icon:'🩸', val: `Drain ${pct}%`, color:'#ff6b6b', lbl:'Vol de vie : % des dégâts rendus au lanceur (Drain)' });
      } else {
        const soinBase = _calcSortSoin(s, c);
        chips.push({ icon:'💚', val: soinBase, color:'#22c38e', lbl:'Soin' });
      }
    } else {
      if (activeIds.has('bouclier_reactif')) {
        chips.push({ icon:'🛡️', val:'Bloque 1', color:'#22c38e', lbl:'Bloque 1 attaque entrante (Bouclier réactif)' });
      } else {
        chips.push({ icon:'🛡️', val:_getSortCA(s), color:'#22c38e', lbl:'Bonus de CA (Protection)' });
      }
    }
  } else if (types.includes('defensif') && nbAmp > 0 && s.ampMode !== 'deplacement') {
    const soinBase = _calcSortSoin(s, c);
    chips.push({ icon:'💚', val: soinBase, color:'#22c38e', lbl:'Soin' });
  }

  // ── 5. Cibles / zone / déplacement / durée ──
  if (nbCibles > 1) chips.push({ icon:'🎯', val:`×${nbCibles}`, color:'#4f8cff', lbl:'Nombre de cibles', dim:true });
  const zone  = _calcSortZone(s);
  if (zone)  chips.push({ icon:'📐', val:`${zone.w}×${zone.h}c`, color:'#b47fff', lbl:'Zone d\'effet (cases)', dim:true });
  const depl  = _calcSortDeplacement(s);
  if (depl) {
    const dIcon = depl.mode === 'self' ? '🏃' : depl.mode === 'pull' ? '↙' : '↗';
    const dVal  = depl.max != null ? `1–${depl.max}c` : `${depl.distance}c`;
    chips.push({ icon: dIcon, val: dVal, color:'#e8b84b', lbl: depl.mode === 'self' ? 'Déplacement du lanceur (cases)' : depl.mode === 'pull' ? 'Attire la cible (cases)' : 'Repousse la cible (cases)', dim:true });
  }
  // Durée : affichée uniquement pour les sorts persistants
  if (_needsDureeBase(s)) {
    const duree = _calcSortDuree(s);
    if (duree) chips.push({ icon:'⏱️', val:`${duree}t`, color:'#9ca3af', lbl:'Durée de l\'effet (tours)', dim:true });
  }
  if (isClassic && (parseInt(s.cooldownTurns) || 0) > 0) {
    chips.push({ icon:'↻', val:`${parseInt(s.cooldownTurns)}t`, color:'#fbbf24', lbl:'Temps de recharge en combat', dim:true });
  }

  // ── 6. Pill JS sauvegarde pour Affliction (info utile au combat) ──
  // (Pas de JS en branche Lacération : c'est une frappe + réduction de CA.)
  if (hasAfflictionDebuff && !activeIds.has('regeneration') && !activeIds.has('sentinelle')) {
    const nbAff = runesAll.filter(r => r === 'Affliction').length;
    const dd = 11 + 2 * (nbAff - 1);
    chips.push({ icon:'🛡', val:`DD ${dd}`, color:'#ef4444', lbl:'Jet de sauvegarde de la cible pour résister', dim:true });
  }

  // ── Combo Sort suspendu : pill explicite (stocké au cast, déclenché hors-tour) ──
  if (activeIds.has('sort_suspendu')) {
    const nbDur = runesAll.filter(r => r === 'Durée').length;
    chips.push({ icon:'🔮', val:`Suspendu · ${2 + 2 * nbDur}t`, color:'#a855f7', lbl:'Sort suspendu : déclenché plus tard, hors de ton tour' });
  }

  // ── Mode Préparer : sort trop cher pour les PM actuels — informatif, pas bloquant ──
  const pmShort = isTiles && pmCur != null
    ? Math.max(0, _effectiveSortPm(s, pmDelta) - pmCur)
    : 0;
  if (pmShort > 0) {
    chips.push({ icon:'💧', val:`Il manque ${pmShort} PM`, color:'#4f8cff', lbl:'PM insuffisants pour le lancer maintenant', dim:true });
  }

  // ── Effet principal promu en ligne « héros » ; le reste en chips secondaires ──
  // primaryChip = 1er effet réel (non-dim). Les chips dim (cibles/zone/durée/DD)
  // restent en secondaire. Si aucun effet réel, pas de héros (que du secondaire).
  const primaryChip = chips.find(ch => !ch.dim) || null;
  const restChips   = primaryChip ? chips.filter(ch => ch !== primaryChip) : chips;

  // ── Coût PM : UNE seule vérité (override MJ > pm calculé, + Set Léger) ──
  // La valeur affichée = coût réellement payé (identique Deck/filtres/VTT) ;
  // le title déroule la chaîne Base → Ajustement MJ → Set Léger → final.
  const pmAuto  = parseInt(s.pm) || 0;
  const pmOvr   = Number.isFinite(parseInt(s.pmOverride)) ? parseInt(s.pmOverride) : null;
  const pmBase  = pmOvr ?? pmAuto;
  const pmFinal = _effectiveSortPm(s, pmDelta);
  const pmTitle = (pmOvr != null && pmOvr !== pmAuto) || pmDelta !== 0
    ? `Coût : base ${pmAuto} PM${pmOvr != null && pmOvr !== pmAuto ? ` · ajusté MJ ${pmOvr}` : ''}${pmDelta !== 0 ? ` · Set Léger ${pmDelta > 0 ? '+' : ''}${pmDelta}` : ''} → ${pmFinal} PM`
    : 'Coût en points de magie';
  const pmVal = pmDelta !== 0
    ? `<span class="cs-sort-pm-old">${pmBase}</span><span class="cs-sort-pm-new">${pmFinal}</span>`
    : `${pmFinal}`;

  const typeCol = types.includes('offensif') ? '#ff6b6b'
                : types.includes('defensif')  ? '#22c38e'
                : '#b47fff';

  // ── Validation MJ — statut en pastille discrète dans l'en-tête (hors de la rangée
  //    d'effets), boutons MJ (admin) révélés au survol juste à côté du nom. ──
  const vs = _sortValidationState(s);
  const valTitle = vs === 'ok' ? 'Sort validé par le Maître du Jeu'
                 : vs === 'no' ? 'Sort refusé par le Maître du Jeu'
                 : 'Pas encore validé par le Maître du Jeu';
  const valStatus = vs === 'ok' ? '' : `<span class="cs-spellcard-status cs-spellcard-status--${vs}" title="${valTitle}">${vs==='no'?'❌':'⏳'}</span>`;
  const valActions = STATE.isAdmin ? `<span class="cs-spellcard-mj-actions" data-stop-propagation>
    <button class="cs-spellcard-mjbtn ok ${vs==='ok'?'is-active':''}" data-action="setSortValidation" data-idx="${i}" data-val="ok" title="Valider ce sort">✅</button>
    <button class="cs-spellcard-mjbtn no ${vs==='no'?'is-active':''}" data-action="setSortValidation" data-idx="${i}" data-val="no" title="Refuser ce sort">❌</button>
  </span>` : '';

  // ── Noyaux (éléments) en petites pastilles ──
  const nts = noyauTypesFor(s);
  const noyauPills = nts.map(t =>
    `<span class="cs-spellcard-noyau" style="--c:${t.color||'#888'}" title="Noyau ${_esc(t.label)}">${t.icon || ''}</span>`
  ).join('');

  // ── Runes présentes (comptées) — affichage seul (l'édition se fait dans l'éditeur) ──
  const counts = {};
  _displayRunes(runesAll).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const runeMetas = RUNE_META.filter(rm => (counts[rm.nom] || 0) > 0);
  const runeChips = runeMetas.length ? `<div class="cs-spellcard-runes">
    ${runeMetas.map(rm => `<span class="cs-runechip" style="--c:${rm.color}" title="${_esc(rm.nom)} — ${_esc(rm.effet)}">${rm.icon} ${_esc(rm.nom)}${(counts[rm.nom]>1)?` ×${counts[rm.nom]}`:''}</span>`).join('')}
  </div>` : '';

  const recipeStrip = isClassic ? `<div class="cs-spellrecipe" aria-label="Paramètres du sort classique">
    <span class="cs-spellrecipe-label">CLASSIQUE</span>
    <div class="cs-spellrecipe-flow">
      <span class="cs-spellrecipe-noyaux">
        ${nts.length ? nts.map(t => `<span style="--c:${t.color || '#888'}" title="Élément ${_esc(t.label || '')}">${t.icon || '✦'}<i>${_esc(t.label || 'Élément')}</i></span>`).join('') : '<span class="is-empty"><i>◇</i><b>Neutre</b></span>'}
      </span>
      <span class="cs-spellrecipe-arrow">›</span>
      <span class="cs-spellrecipe-runes"><span style="--c:#5bc0eb"><i>✦</i><b>${s.classicEffect === 'damage' ? 'Dégâts' : s.classicEffect === 'heal' ? 'Soin' : s.classicEffect === 'summon' ? 'Invocation' : 'Utilitaire'}</b></span></span>
    </div>
  </div>` : `<div class="cs-spellrecipe ${recipeRepeats > 1 ? 'has-twin' : ''}" aria-label="Composition du sort">
    <span class="cs-spellrecipe-label">RECETTE</span>
    <div class="cs-spellrecipe-flow">
      <span class="cs-spellrecipe-noyaux">
        ${nts.length ? nts.map(t => `<span style="--c:${t.color || '#888'}" title="Noyau ${_esc(t.label || t.nom || '')}">${t.icon || '✦'}<i>${_esc(t.label || t.nom || 'Noyau')}</i></span>`).join('') : '<span class="is-empty is-missing" title="Ce sort ne contient aucun noyau enregistré">⚠<i>Noyau à définir</i></span>'}
      </span>
      <span class="cs-spellrecipe-arrow">›</span>
      <span class="cs-spellrecipe-runes">
        ${runeMetas.length ? runeMetas.map(rm => `<span style="--c:${rm.color}" title="${_esc(rm.nom)} — ${_esc(rm.effet || '')}"><i>${rm.icon}</i><b>${_esc(rm.nom)}</b>${counts[rm.nom] > 1 ? `<em>×${counts[rm.nom]}</em>` : ''}</span>`).join('') : '<span class="is-empty"><i>◇</i><b>Aucune rune</b></span>'}
      </span>
    </div>
    ${recipeRepeats > 1 ? `<button class="cs-spellrecipe-twin ${_sortsRecipeKeyFilter===_spellRecipeKey(s)?'on':''}" data-action="_sortsFocusRecipe" data-recipe="${_esc(_spellRecipeKey(s))}" title="Afficher les ${recipeRepeats} sorts utilisant exactement cette recette">⚠ Recette ×${recipeRepeats}</button>` : ''}
  </div>`;

  const validationAllows = STATE.isAdmin || vs === 'ok';
  const deckFull = deckCount >= deckMax;
  const deckAllows = s.actif || !deckFull;
  const canActivate = validationAllows && deckAllows;
  const lockTitle = !validationAllows
    ? 'Doit être validé par le MJ pour entrer dans le Deck'
    : !deckAllows
      ? `Deck plein (${deckCount}/${deckMax}) — retire un sort avant d'en ajouter un`
      : (s.actif?'Retirer du deck':'Ajouter au deck');

  // Mode Préparer (tuiles) : la tuile ENTIÈRE = _sortsTileTap (pointeur : préparer/
  // retirer avec flux « Remplacer » si deck plein ; tactile ou lecture seule : fiche
  // rapide). Les boutons enfants gagnent au dispatch (closest [data-action]) donc
  // Le bouton Deck et la poignée gagnent au dispatch. tabindex → activation clavier.
  const tileAttrs = isTiles
    ? ` tabindex="0" data-action="_sortsTileTap" data-idx="${i}"${canEdit ? ` role="button" aria-pressed="${s.actif?'true':'false'}"` : ''}`
    : ` tabindex="0" data-action="_sortsInspectSpell" data-idx="${i}" role="button" aria-label="${_sortsCompareKeys.length===1 && !isCompared?'Choisir comme second sort : ':'Inspecter '}${_esc(s.nom || 'ce sort')}"`;
  const isSwapIn = isTiles && _sortsReplaceIdx === i;

  return `<article class="cs-spellcard ${s.actif?'is-actif':''} ${isOpen?'is-open':''} ${isCompared?'is-compared':''} ${isInspected?'is-inspected':''} ${vs==='no'?'is-refused':''} ${pmShort>0?'is-pmshort':''} ${isSwapIn?'is-swapin':''}" style="--type-col:${typeCol}"
    data-sort-idx="${i}"${tileAttrs}>
    ${canDrag ? `<span class="cs-spellcard-drag" data-action="" data-stop-propagation title="Maintenir puis glisser pour déplacer le sort" aria-label="Déplacer le sort">⠿</span>` : ''}

    <header class="cs-spellcard-head">
      ${canEdit
        ? `<button type="button" class="toggle cs-spellcard-equip ${s.actif?'on':''} ${(!canActivate && !s.actif)?'is-locked':''}" data-label="${s.actif?'✓ Dans le deck':(!canActivate?'🔒 Indisponible':'＋ Ajouter')}" aria-pressed="${s.actif?'true':'false'}" aria-label="${s.actif?'Retirer':'Ajouter'} ${_esc(s.nom||'ce sort')} ${s.actif?'du':'au'} deck" data-action="toggleSort" data-idx="${i}" data-stop-propagation title="${lockTitle}"></button>`
        : `<span class="toggle cs-spellcard-equip ${s.actif?'on':''}" data-label="${s.actif?'✓ Dans le deck':'Hors deck'}"></span>`}
      <span class="cs-spellcard-icon">${s.icon ? _esc(s.icon) : '✦'}</span>
      <div class="cs-spellcard-id">
        <div class="cs-spellcard-name-row">
          <span class="cs-spellcard-name" title="${_esc(s.nom||'Sans nom')}">${_esc(s.nom||'Sans nom')}</span>
          ${valStatus}${valActions}
        </div>
        <div class="cs-spellcard-sub">
          <span class="cs-spellcard-act" style="--c:${acfg.color}">${acfg.label}</span>
          ${concentration ? `<span class="cs-spellcard-conc" title="Concentration">🧠</span>` : ''}
          ${noyauPills}
        </div>
      </div>
      <span class="cs-spellcard-pm" title="${_esc(pmTitle)}">${pmVal}<small>PM</small></span>
    </header>

    ${recipeStrip}

    ${(primaryChip || restChips.length) ? `<div class="cs-spellcard-tags">
      ${primaryChip ? `<span class="cs-spellcard-hero" style="--c:${primaryChip.color}"${primaryChip.lbl?` title="${_esc(primaryChip.lbl)}"`:''}><span class="cs-spellcard-hero-ic">${primaryChip.icon}</span><span class="cs-spellcard-hero-val">${_esc(primaryChip.val)}</span></span>` : ''}
      ${restChips.map(ch => `<span class="cs-sort-sstat${ch.dim?' cs-sort-sstat--dim':''}" style="--c:${ch.color}"${ch.lbl?` title="${_esc(ch.lbl)}"`:''}>${ch.icon} ${_esc(ch.val)}</span>`).join('')}
    </div>` : ''}

    ${s.effet ? `<p class="cs-spellcard-desc" data-action="_sortsInspectSpell" data-idx="${i}" title="Ouvrir la fiche du sort">${_esc(s.effet)}</p>` : ''}

    ${s.mjNotes ? `<div class="cs-spellcard-mjnote" title="Note / restriction du Maître du Jeu">
      <span class="cs-spellcard-mjnote-ic">📌</span>
      <span class="cs-spellcard-mjnote-tx">${isOpen ? _nl2br(s.mjNotes) : _esc(s.mjNotes)}</span>
    </div>` : ''}

    ${runeChips}

    ${isOpen ? `<div class="cs-spellcard-detail">
      <div class="cs-sort-detail-effects">
        <div class="cs-sort-detail-effects-title">📋 Effets calculés</div>
        ${_buildSortResume(s, c).map(line => `
          <div class="cs-sort-detail-effect-row">
            <span class="cs-sort-detail-icon">${line.icon}</span>
            <span class="cs-sort-detail-label">${line.label}</span>
            ${line.detail ? `<span class="cs-sort-detail-meta">${line.detail}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}

  </article>`;
}

// ── Catégories de sorts ───────────────────────────────────────────────────────
const _CAT_COLORS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b','#9ca3af'];

// Panneau INLINE de gestion des catégories (plus de modale). Crée / renomme /
// recolorie / supprime — la suppression NE supprime PAS les sorts (catId remis à '').
function _renderCatManager(cats = []) {
  const swatch = (col, action, idx, sel) =>
    `<button type="button" class="cs-catmgr-col ${sel?'on':''}" style="background:${col}" data-action="${action}" data-stop-propagation${idx!=null?` data-idx="${idx}"`:''} data-col="${col}" title="${sel?'Couleur actuelle':'Choisir cette couleur'}"></button>`;
  return `<div class="cs-catmgr" id="cs-catmgr" tabindex="-1" aria-label="Modifier les catégories">
    <div class="cs-catmgr-head">
      <span class="cs-catmgr-title">📂 Modifier les catégories</span>
      <span class="cs-catmgr-sub">Ajoute, renomme ou colore tes sections. Supprimer une catégorie conserve toujours ses sorts.</span>
    </div>
    ${cats.length ? `<div class="cs-catmgr-list">
      ${cats.map((cat, i) => `
        <div class="cs-catmgr-row" style="--cat-col:${cat.couleur}">
          <span class="cs-catmgr-dot" style="background:${cat.couleur}"></span>
          <input class="cs-catmgr-name" value="${_esc(cat.nom)}" maxlength="40"
            data-change="_renameSortCat" data-idx="${i}" placeholder="Nom de la catégorie">
          <div class="cs-catmgr-colors">${_CAT_COLORS.map(col => swatch(col, '_recolorSortCat', i, cat.couleur === col)).join('')}</div>
          <button class="btn-icon cs-catmgr-del" data-action="_delSortCat" data-idx="${i}" title="Supprimer (les sorts sont conservés)">🗑️</button>
        </div>`).join('')}
    </div>` : `<div class="cs-catmgr-empty">Aucune catégorie pour l'instant.</div>`}
    <div class="cs-catmgr-new">
      <input class="cs-catmgr-name" id="cs-newcat-name" maxlength="40" placeholder="Nouvelle catégorie…">
      <div class="cs-catmgr-colors">${_CAT_COLORS.map(col => swatch(col, '_pickNewSortCatColor', null, _newSortCatColor === col)).join('')}</div>
      <button type="button" class="btn btn-gold btn-sm cs-catmgr-add" data-action="_addSortCat" data-col="${_newSortCatColor}">Ajouter</button>
    </div>
  </div>`;
}

// Toggle du panneau inline (remplace l'ancienne modale).
export function openSortCatEditor() {
  _sortsCatPanelOpen = !_sortsCatPanelOpen;
  _renderSpellsTab();
  if (_sortsCatPanelOpen) requestAnimationFrame(() => requestAnimationFrame(() => {
    const panel = document.getElementById('cs-catmgr');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel?.focus({ preventScroll: true });
  }));
}

function _pickNewSortCatColor(btn) {
  const couleur = btn?.dataset?.col || _CAT_COLORS[0];
  _newSortCatColor = couleur;
  document.querySelectorAll('.cs-catmgr-new .cs-catmgr-col').forEach(b => b.classList.toggle('on', b.dataset.col === couleur));
  const addBtn = document.querySelector('.cs-catmgr-add');
  if (addBtn) addBtn.dataset.col = couleur;
}

async function _addSortCat(couleur) {
  const c = _getCurrentSpellChar() || STATE.activeChar; if (!c) return;
  const inp = document.getElementById('cs-newcat-name');
  const nom = (inp?.value || '').trim();
  if (!nom) {
    showNotif('Donne un nom à la catégorie.', 'error');
    inp?.focus();
    return;
  }
  const prevCats = c.sort_cats || [];
  const cats = [...prevCats];
  cats.push({ id: `cat_${Date.now()}`, nom, couleur: couleur || _newSortCatColor || _CAT_COLORS[0] });
  c.sort_cats = cats;
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (charSession.getCurrentChar()?.id === c.id)
    charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  if (await trySave('characters', c.id, { sort_cats: cats })) {
    showNotif('Catégorie créée !', 'success');
    _renderSpellsTab(c);   // _sortsCatPanelOpen reste vrai → le panneau reste ouvert
  } else {
    c.sort_cats = prevCats;
    if (charSession.getCurrentChar()?.id === c.id)
      charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
    _renderSpellsTab(c);
  }
}

async function _renameSortCat(idx, value) {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  if (!cats[idx]) return;
  const nom = (value || '').trim();
  if (!nom || nom === cats[idx].nom) return;
  cats[idx] = { ...cats[idx], nom };
  c.sort_cats = cats;
  if (await trySave('characters', c.id, { sort_cats: cats })) _renderSpellsTab(c);
}

async function _recolorSortCat(idx, couleur) {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  if (!cats[idx] || cats[idx].couleur === couleur) return;
  cats[idx] = { ...cats[idx], couleur };
  c.sort_cats = cats;
  if (await trySave('characters', c.id, { sort_cats: cats })) _renderSpellsTab(c);
}

async function _delSortCat(idx) {
  const c = STATE.activeChar; if (!c) return;
  const cats  = [...(c.sort_cats || [])];
  const cat   = cats[idx]; if (!cat) return;
  if (!await confirmModal(`Supprimer la catégorie <b>${_esc(cat.nom)}</b> ?<br><span style="color:var(--text-dim);font-size:.85em">Ses sorts sont conservés (ils repassent « Sans catégorie »).</span>`, {
    title: 'Supprimer la catégorie', confirmLabel: 'Supprimer', icon: '🗑️',
  })) return;
  // Les sorts de la catégorie sont CONSERVÉS : on remet juste leur catId à ''.
  const sorts = (c.deck_sorts || []).map(s => s.catId === cat.id ? { ...s, catId: '' } : s);
  cats.splice(idx, 1);
  c.sort_cats  = cats;
  c.deck_sorts = sorts;
  if (await trySave('characters', c.id, { sort_cats: cats, deck_sorts: sorts })) {
    showNotif('Catégorie supprimée (sorts conservés).', 'success');
    _renderSpellsTab(c);
  }
}


export function toggleSortDetail(idx) {
  _openSortIdx = _openSortIdx === idx ? null : idx;
  _renderSpellsTab();
}


// ── Éditeur de sorts ──────────────────────────────────────────────────────────
// Contexte d'édition : null = sort de perso (STATE.activeChar.deck_sorts)
// sinon { item, idx, onSave } = sort embarqué dans un item de boutique.
// saveSort() lit ce contexte pour aiguiller la sauvegarde.
let _itemEditCtx = null;

export function addSort() { _itemEditCtx = null; openSortModal(-1, {}); }
export function editSort(idx) { _itemEditCtx = null; openSortModal(idx, (STATE.activeChar?.deck_sorts||[])[idx]); }

/** Ouvre la modal de sort pour éditer une action d'objet.
 *  item   : l'objet portant les actions
 *  idx    : index dans item.actions (-1 pour ajout)
 *  onSave : callback async(item) appelé après la sauvegarde — doit persister l'item
 *  charForCalc : perso optionnel pour les calculs d'aperçu (sinon null) */
export function editItemSpell(item, idx, onSave, charForCalc = null) {
  // Le perso de calcul est porté par le contexte (_itemEditCtx.charForCalc) et
  // résolu via _modalChar() : aucune mutation de STATE.activeChar.
  _itemEditCtx = { item, idx, onSave, charForCalc };
  const action = idx >= 0 ? (item.actions || [])[idx] || {} : {};
  openSortModal(idx, action);
}

/** Perso contextuel de la modale de sort en cours d'édition.
 *  - Édition d'un sort de perso : le perso actif global.
 *  - Édition d'une action d'item (boutique) : le perso de calcul passé à
 *    editItemSpell, sinon le perso actif en repli.
 *  Source unique pour tous les calculs/preview de la modale — supprime la
 *  substitution fragile de STATE.activeChar. */
function _modalChar() {
  return _itemEditCtx?.charForCalc ?? STATE.activeChar ?? null;
}
export function addItemSpell(item, onSave, charForCalc = null) {
  return editItemSpell(item, -1, onSave, charForCalc);
}

let _openSortIdx = -1;

// ── Métadonnées des runes ────────────────────────────────────────────────────
// Centralisé pour qu'un seul endroit définisse icône, couleur, effet de base et famille
const RUNE_META = [
  { nom:'Puissance',     icon:'⚔️', color:'#ef4444', family:'puissance', effet:'+1 dé de dégâts' },
  { nom:'Protection',    icon:'💚', color:'#22c38e', family:'puissance', effet:'+1d4 soin OU +2 CA (2 tours)' },
  { nom:'Amplification', icon:'🌐', color:'#4f8cff', family:'portee',    effet:'Zone +3 cases' },
  { nom:'Dispersion',    icon:'🎯', color:'#a855f7', family:'portee',    effet:'Touche plusieurs cibles (1 → 2 → 3 → 4…)' },
  { nom:'Enchantement',  icon:'✨', color:'#e8b84b', family:'soutien',   effet:'Booste un allié · 2 tours' },
  { nom:'Affliction',    icon:'💀', color:'#8b5cf6', family:'soutien',   effet:'Élément + état sur arme ennemie · 2 tours' },
  { nom:'Invocation',    icon:'🐾', color:'#a16207', family:'soutien',   effet:'Créature liée · 10 PV, CA 10' },
  { nom:'Chance',        icon:'🍀', color:'#facc15', family:'soutien',   effet:'RC −1 par rune · crit = double max' },
  { nom:'Durée',         icon:'⏱️', color:'#06b6d4', family:'meta',      effet:'+2 tours' },
  { nom:'Concentration', icon:'🧠', color:'#6366f1', family:'meta',      effet:'Maintien hors tour · JS Sa DD 11 si touché' },
  { nom:'Déclenchement', icon:'⚡', color:'#f97316', family:'meta',      effet:'Transforme le sort en Réaction ou Action Bonus · non cumulable' },
];

const ACTION_RUNE = 'Déclenchement';
const ACTION_MODE_LABELS = {
  reaction: 'Réaction',
  action_bonus: 'Action Bonus',
};

function _spellActionMode(s) {
  const runes = s?.runes || [];
  if (runes.includes(ACTION_RUNE) && (s?.actionMode === 'reaction' || s?.actionMode === 'action_bonus')) return s.actionMode;
  if (runes.includes('Réaction')) return 'reaction';
  if (runes.includes('Action Bonus')) return 'action_bonus';
  return 'reaction';
}

function _buildRunesFromCounts() {
  const runes = [];
  Object.entries(_runeCountsEdit || {}).forEach(([nom, cnt]) => {
    for (let i = 0; i < cnt; i++) runes.push(nom);
  });
  return runes;
}

function _displayRunes(runes = []) {
  let hasActionRune = false;
  const out = [];
  runes.forEach(r => {
    if (r === 'Réaction' || r === 'Action Bonus' || r === ACTION_RUNE) {
      if (!hasActionRune) out.push(ACTION_RUNE);
      hasActionRune = true;
      return;
    }
    out.push(r);
  });
  return out;
}

const RUNE_GROUPS = [
  { id:'puissance', title:'⚔️ Puissance brute',    desc:'Dégâts et défense' },
  { id:'portee',    title:'🎯 Portée & cibles',    desc:'Zone et nombre de cibles' },
  { id:'soutien',   title:'✨ Soutien & contrôle', desc:'Buffs, debuffs et invocations' },
  { id:'meta',      title:'⏱️ Méta',              desc:'Timing et durée' },
];

/** Décrit la contribution actuelle d'une rune en clair. */
function _runeLiveContribution(nom, counts) {
  const cnt = counts[nom] || 0;
  if (cnt === 0) return null;

  switch (nom) {
    case 'Puissance': {
      return {
        main:  `+${cnt} dé${cnt>1?'s':''} de dégâts · sur 1 cible`,
      };
    }
    case 'Protection': {
      // Contexte : lit le mode (état module fiable, pas le DOM qui peut être périmé
      // pendant la construction de l'éditeur) et la présence de Réaction.
      const protMode = _protModeEdit || 'ca';
      const hasReac = (counts.Réaction || 0) > 0 || ((counts[ACTION_RUNE] || 0) > 0 && _actionModeEdit === 'reaction');
      // Combo Bouclier réactif (Réa + Prot mode CA) : pas de soin, blocage 1 attaque
      if (hasReac && protMode === 'ca') {
        const tier = cnt >= 3 ? 'Boss ou inférieur' : cnt === 2 ? 'Élite ou inférieur' : 'Mob classique';
        return {
          main:  `Combo Bouclier réactif · Bloque 1 attaque entrante · plafond ${tier}`,
        };
      }
      // Mode CA pur (sans Réaction)
      if (protMode === 'ca') {
        return {
          main:  `+${cnt*2} CA · sur 1 cible (2 tours)`,
        };
      }
      // Mode soin
      return {
        main:  `+${cnt}d4 soin · sur 1 cible`,
      };
    }
    case 'Amplification': {
      const len = _ampLength(cnt);
      const nbDisp = counts['Dispersion'] || 0;
      if (nbDisp > 0) {
        const cross = _zoneShapeEdit === 'cross';
        const dim = cross ? _ampCrossDim : _ampDispDim;
        const h = dim(cnt), w = dim(nbDisp);
        return { main: cross ? `Combo → croix ${h}×${w} (longue portée, sans diagonales)` : `Combo Dispersion → rectangle ${h}×${w} cases` };
      }
      return { main: `Zone ${len}×1 cases (ligne)` };
    }
    case 'Dispersion': {
      const nbAmp = counts['Amplification'] || 0;
      if (nbAmp > 0) {
        const cross = _zoneShapeEdit === 'cross';
        const dim = cross ? _ampCrossDim : _ampDispDim;
        const h = dim(nbAmp), w = dim(cnt);
        return { main: cross ? `Combo → croix ${h}×${w} (Amp=bras vertical, Disp=bras horizontal)` : `Combo Amp+Disp → rectangle ${h}×${w} (Amp=hauteur, Disp=largeur)` };
      }
      return { main: `${1 + cnt} cibles différentes` };
    }
    case 'Lacération': {
      const red = cnt;
      return {
        main:  `CA cible −${red} · sur 1 cible`,
      };
    }
    case 'Chance': {
      const rcLow = Math.max(2, 20 - cnt);
      return {
        main:  `Critique RC ${rcLow}–20 · crit = double max`,
      };
    }
    case 'Durée': {
      const bonus = 2 * cnt;
      return {
        main:  `+${bonus} tour${bonus>1?'s':''} de durée`,
      };
    }
    case 'Enchantement':
      return {
        main:  cnt === 1
          ? 'Buff sur allié · 2 tours · cibles via Dispersion'
          : `Buff allié · 2 tours · cibles via Dispersion (les runes Enchantement n'ajoutent pas de cible)`,
      };
    case 'Affliction':
      return {
        main:  `Debuff sur ennemi · 2 tours · Action · JS DD ${11 + 2 * (cnt - 1)} · cibles via Dispersion`,
      };
    case 'Invocation':
      return {
        main:  `Invoque ${cnt} créature${cnt>1?'s':''} (1 par rune) — choix au lancement`,
      };
    case 'Concentration':
      return { main: 'Maintenu hors tour · JS Sa DD 11 si dégâts reçus' };
    case ACTION_RUNE:
      return { main: `Lancé en ${ACTION_MODE_LABELS[_actionModeEdit] || 'Réaction'}` };
    default:
      return { main: `×${cnt}` };
  }
}

/**
 * Rend la section runes complète :
 *   ① "Mes runes" — grosses cartes pour les runes actives, avec contrib live
 *   ② "Ajouter une rune" — picker compact par famille
 * Re-appelée après chaque incrément/décrément pour rester synchro.
 */
// Nombre max de runes d'effet débloquées pour le perso courant (défaut 1).
// Le MJ peut le débloquer par personnage (champ characters.maxRunes).
function _spellRuneLimit() {
  const n = parseInt(STATE.activeChar?.maxRunes);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function _renderRunesSection() {
  const counts = _runeCountsEdit || {};
  const activeMetas = RUNE_META.filter(r => (counts[r.nom] || 0) > 0);
  // ── En-tête : compteur de runes d'effet vs limite du perso ──────────────
  const limit  = _spellRuneLimit();
  const total  = Object.values(counts).reduce((a, b) => a + b, 0);
  const atLimit = total >= limit;
  const limitHeader = `<div class="cs-rune-limit${total > limit ? ' over' : atLimit ? ' full' : ''}">
    <span class="cs-rune-limit-count">🔮 Runes d'effet <b>${total}</b> / ${limit}</span>
    ${STATE.isAdmin
      ? `<span class="cs-rune-limit-mj">
          <span>Débloquées (MJ)</span>
          <button type="button" class="cs-rune-btn minus" data-action="_mjAdjRuneLimit" data-delta="-1" title="Retirer une rune débloquée">−</button>
          <button type="button" class="cs-rune-btn plus"  data-action="_mjAdjRuneLimit" data-delta="1" title="Débloquer une rune">+</button>
        </span>`
      : (atLimit ? `<span class="cs-rune-limit-hint">Limite atteinte — le MJ peut en débloquer</span>` : '')}
  </div>`;

  // ① Grosses cartes des runes actives
  const activeHtml = activeMetas.length ? activeMetas.map(r => {
    const cnt = counts[r.nom];
    const contrib = _runeLiveContribution(r.nom, counts);
    return `<div class="cs-rune-active" style="--rune-c:${r.color}">
      <div class="cs-rune-active-main">
        <div class="cs-rune-active-hdr">
          <span class="cs-rune-active-icon">${r.icon}</span>
          <span class="cs-rune-active-nom">${r.nom}</span>
          <span class="cs-rune-active-x">×${cnt}</span>
        </div>
        <div class="cs-rune-active-contrib">${contrib?.main || r.effet}</div>
      </div>
      <div class="cs-rune-active-ctrl">
        <button type="button" class="cs-rune-btn minus" data-action="runeDecrement" data-nom="${r.nom}">−</button>
        <button type="button" class="cs-rune-btn plus"  data-action="runeIncrement" data-nom="${r.nom}">+</button>
      </div>
    </div>`;
  }).join('') : `<div class="cs-rune-active-empty">
    <span class="cs-rune-active-empty-icon">🔮</span>
    <span>Aucune rune sélectionnée. Choisis ci-dessous pour façonner ton sort.</span>
  </div>`;

  // ② Picker compact — n'affiche QUE les runes pas encore actives
  // (les actives sont gérées via leurs cartes en haut, plus de doublon = plus d'ambiguïté)
  const pickerGroups = RUNE_GROUPS.map(g => {
    const runesInGroup = RUNE_META.filter(r => r.family === g.id && !((counts[r.nom] || 0) > 0));
    if (runesInGroup.length === 0) return ''; // groupe vide = caché
    return `<div class="cs-rune-pick-group">
      <div class="cs-rune-pick-group-title">${g.title} <span>${g.desc}</span></div>
      <div class="cs-rune-pick-list">
        ${runesInGroup.map(r => `
          <button type="button" class="cs-rune-pick-item"
            style="--rune-c:${r.color}" data-action="runeIncrement" data-nom="${r.nom}"
            data-tip="${r.effet}" aria-label="Ajouter ${r.nom} — ${r.effet}">
            <span class="cs-rune-pick-icon">${r.icon}</span>
            <span class="cs-rune-pick-nom">${r.nom}</span>
            <span class="cs-rune-pick-add" aria-hidden="true">+</span>
          </button>
        `).join('')}
      </div>
    </div>`;
  }).filter(Boolean).join('');

  const pickerEmpty = pickerGroups === '';
  const pickerHtml = pickerEmpty
    ? `<div class="cs-runes-picker-empty">✓ Toutes les runes sont actives — utilise les boutons + sur les cartes ci-dessus pour empiler une même rune.</div>`
    : pickerGroups;

  // Joueur ayant atteint sa limite → on verrouille l'ajout (le MJ n'est jamais bloqué)
  const locked = atLimit && !STATE.isAdmin;
  return `
    ${limitHeader}
    <div class="cs-runes-block${locked ? ' cs-runes-locked' : ''}">
      <div class="cs-runes-active-list">${activeHtml}</div>
      <div class="cs-runes-picker">
        <div class="cs-runes-picker-hdr">+ Ajouter une rune <span>(les runes actives sont gérées via les cartes au-dessus)</span></div>
        ${pickerHtml}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// LA RÉSONANCE — circuit de combos vivant dans la forge
// La VÉRITÉ de l'activation reste _activeCombos()/SORT_COMBOS (spells-calc.js) +
// la config MJ (getComboConfig). Ce catalogue ne fait que (a) décrire chaque recette
// et (b) détecter la PROXIMITÉ ("en approche") — notion absente du moteur, dont le
// detect() est binaire. On n'invente aucune règle : on met en scène celles qui existent.
// ══════════════════════════════════════════════════════════════════════════════
const RESONANCE_CATALOG = [
  { id:'bouclier_reactif', icon:'🛡️', color:'#22c38e', name:'Bouclier réactif',
    effet:'Annule 1 attaque entrante',
    ingredients:(ct,s)=>[
      { label:'Réaction',    ok:(ct.Réaction||0)>0 },
      { label:'Protection',  ok:(ct.Protection||0)>0 },
      { label:'mode CA',     ok:(s.protectionMode||'ca')==='ca' },
    ] },
  { id:'drain', icon:'🩸', color:'#ff6b6b', name:'Drain personnel',
    effet:'Vol de vie sur les dégâts infligés',
    ingredients:(ct,s)=>[
      { label:'Type offensif', ok:_getSortTypes(s).includes('offensif') },
      { label:'Protection',    ok:(ct.Protection||0)>0 },
    ] },
  { id:'regeneration', icon:'💚', color:'#22c38e', name:'Régénération',
    effet:'Soin sur la durée à un allié',
    ingredients:(ct)=>[
      { label:'Protection', ok:(ct.Protection||0)>0 },
      { label:'Affliction', ok:(ct.Affliction||0)>0 },
    ],
    blockers:(ct,s)=>[
      ...((ct.Invocation||0)>0 ? ['Invocation (→ Sentinelle)'] : []),
      ...(s.afflictionMode==='laceration' ? ['mode Lacération'] : []),
    ] },
  { id:'zone_elargie', icon:'🌐', color:'#4f8cff', name:'Zone élargie',
    effet:'Grande zone d’effet plaçable',
    ingredients:(ct)=>[
      { label:'Amplification', ok:(ct.Amplification||0)>0 },
      { label:'Dispersion',    ok:(ct.Dispersion||0)>0 },
    ] },
  { id:'arme_invoquee', icon:'⚔️', color:'#e8b84b', name:'Arme invoquée',
    effet:'Invoque une arme élémentaire',
    ingredients:(ct)=>[
      { label:'Enchantement', ok:(ct.Enchantement||0)>0 },
      { label:'Invocation',   ok:(ct.Invocation||0)>0 },
    ] },
  { id:'sentinelle', icon:'🪤', color:'#a16207', name:'Sentinelle / Piège',
    effet:'Invoque une sentinelle stationnaire',
    ingredients:(ct)=>[
      { label:'Affliction', ok:(ct.Affliction||0)>0 },
      { label:'Invocation', ok:(ct.Invocation||0)>0 },
    ] },
  { id:'coup_chance', icon:'🍀', color:'#facc15', name:'Coup de chance',
    effet:'Relance automatique du prochain échec',
    ingredients:(ct)=>[
      { label:'Chance',   ok:(ct.Chance||0)>0 },
      { label:'Réaction', ok:(ct.Réaction||0)>0 },
    ] },
  { id:'sort_suspendu', icon:'🔮', color:'#a855f7', name:'Sort suspendu',
    effet:'Sort stocké, déclenché hors-tour',
    ingredients:(ct)=>[
      { label:'Concentration', ok:(ct.Concentration||0)>0 },
      { label:'Réaction',      ok:(ct.Réaction||0)>0 },
    ],
    blockers:(ct)=>[
      ...((ct.Affliction||0)>0   ? ['Affliction']   : []),
      ...((ct.Enchantement||0)>0 ? ['Enchantement'] : []),
      ...((ct.Invocation||0)>0   ? ['Invocation']   : []),
    ] },
  { id:'canalise_persistant', icon:'🧠', color:'#06b6d4', name:'Sort canalisé persistant',
    effet:'Tient tant que la concentration tient',
    ingredients:(ct)=>[
      { label:'Durée',         ok:(ct.Durée||0)>0 },
      { label:'Concentration', ok:(ct.Concentration||0)>0 },
    ],
    blockers:(ct)=>((ct.Réaction||0)>0 ? ['Réaction (→ Sort suspendu)'] : []) },
];

// Combos allumés au rendu précédent → sert à n'animer QUE les nouveaux (pas de
// flash à chaque frappe pour un combo déjà actif). Réinitialisé à l'ouverture.
let _rezPrevLit = new Set();

/** Rend le circuit de Résonance depuis l'état courant de la forge. */
function _renderResonance() {
  let s;
  try { s = _buildSortFromDOM(); } catch { return ''; }
  const counts    = _runeCounts(s);
  const activeMap = new Map(_activeCombos(s).map(co => [co.id, co]));
  const matrices  = getSpellMatricesCache();

  const lit = [];
  const near = [];
  RESONANCE_CATALOG.forEach(entry => {
    if (activeMap.has(entry.id)) {
      const a = activeMap.get(entry.id);
      lit.push({ entry, name: a.name || entry.name, detail: a.detail || entry.effet });
      return;
    }
    let cfg; try { cfg = getComboConfig(matrices, entry.id); } catch { cfg = null; }
    if (cfg && cfg.enabled === false) return;   // MJ a désactivé ce combo → aucun teaser
    const ings     = entry.ingredients(counts, s) || [];
    const blockers = entry.blockers ? (entry.blockers(counts, s) || []) : [];
    const have     = ings.filter(i => i.ok).length;
    const ratio    = ings.length ? have / ings.length : 0;
    // "En approche" : au moins la moitié des ingrédients réunis → on révèle la piste.
    if (have > 0 && ratio >= 0.5) near.push({ entry, name: (cfg && cfg.name) || entry.name, ings, blockers, ratio });
  });
  near.sort((a, b) => b.ratio - a.ratio);
  const nearShown = near.slice(0, 3);

  const litHtml = lit.map(l => {
    const isNew = !_rezPrevLit.has(l.entry.id);
    return `<div class="cs-rez-card cs-rez-card--lit${isNew ? ' is-new' : ''}" style="--rez-c:${l.entry.color}">
      <div class="cs-rez-spark" aria-hidden="true"></div>
      <div class="cs-rez-head">
        <span class="cs-rez-icon">${l.entry.icon}</span>
        <span class="cs-rez-name">${_esc(l.name)}</span>
        <span class="cs-rez-badge">résonne</span>
      </div>
      <div class="cs-rez-detail">${_esc(l.detail)}</div>
    </div>`;
  }).join('');

  const nearHtml = nearShown.map(n => {
    const chips = n.ings.map(i => `<span class="cs-rez-ing${i.ok ? ' ok' : ''}">${i.ok ? '✓' : '○'} ${_esc(i.label)}</span>`).join('');
    const blk = n.blockers.length
      ? `<div class="cs-rez-blocker">⚠ bloqué par ${n.blockers.map(b => _esc(b)).join(', ')}</div>`
      : '';
    return `<div class="cs-rez-card cs-rez-card--near" style="--rez-c:${n.entry.color}">
      <div class="cs-rez-head">
        <span class="cs-rez-icon">${n.entry.icon}</span>
        <span class="cs-rez-name">${_esc(n.name)}</span>
        <span class="cs-rez-hint">en approche</span>
      </div>
      <div class="cs-rez-ings">${chips}</div>
      ${blk}
    </div>`;
  }).join('');

  _rezPrevLit = new Set(lit.map(l => l.entry.id));

  if (!lit.length && !nearShown.length) {
    return `<div class="cs-rez-empty"><span class="cs-rez-empty-ico">✦</span> Certaines paires de runes révèlent des <b>pouvoirs cachés</b>. Empile-les pour les faire résonner…</div>`;
  }
  return `${lit.length ? `<div class="cs-rez-grid cs-rez-grid--lit">${litHtml}</div>` : ''}${nearShown.length ? `<div class="cs-rez-grid cs-rez-grid--near">${nearHtml}</div>` : ''}`;
}

/** Décompose le coût PM en chips lisibles (Noyau + chaque rune ×2). */
function _renderPmBreakdown() {
  const noyau  = document.getElementById('s-noyau')?.value || '';
  const counts = _runeCountsEdit || {};
  const parts  = [];
  if (noyau) parts.push({ lbl:'Noyau', pm:2, cnt:1 });
  RUNE_META.forEach(rm => {
    const cnt = counts[rm.nom] || 0;
    if (cnt > 0) parts.push({ lbl: rm.icon, pm: cnt * 2, cnt });
  });
  if (!parts.length) return `<span class="cs-pmbd-min">Minimum 2 PM · choisis un noyau</span>`;
  return parts
    .map(p => `<span class="cs-pmbd-chip">${_esc(p.lbl)}${p.cnt > 1 ? ` ×${p.cnt}` : ''}<b>${p.pm}</b></span>`)
    .join('<span class="cs-pmbd-plus">+</span>');
}

function _classicInt(id, fallback = 0, min = 0, max = 999) {
  const value = parseInt(document.getElementById(id)?.value);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function _isClassicFormulaValid(value) {
  return /^\s*(?:\d+d\d+|\d+)(?:\s*[+-]\s*\d+)?\s*$/i.test(String(value || ''));
}

function _classicSelectOptions(options, selected) {
  return options.map(([value, label]) => `<option value="${_esc(value)}" ${value === selected ? 'selected' : ''}>${_esc(label)}</option>`).join('');
}

function _classicInvocationIdsFromDOM(max = 1) {
  return [...document.querySelectorAll('input[name="s-classic-invocation-id"]:checked')]
    .map(input => input.value)
    .filter(Boolean)
    .slice(0, Math.max(1, parseInt(max) || 1));
}

function _buildClassicSortFromDOM(idx = -1, prevList = []) {
  const prev = idx >= 0 ? (prevList[idx] || {}) : {};
  const effectKind = document.getElementById('s-classic-effect')?.value || 'damage';
  const target = effectKind === 'summon'
    ? 'any'
    : (document.getElementById('s-classic-target')?.value || (effectKind === 'heal' ? 'ally' : 'enemy'));
  const stateEnabled = effectKind !== 'summon' && !!document.getElementById('s-classic-state-enabled')?.checked;
  const stateId = stateEnabled ? (document.getElementById('s-classic-state')?.value || '') : '';
  const stateMeta = stateId ? _conditionsLibCache?.find(condition => condition.id === stateId) : null;
  const zoneEnabled = effectKind !== 'summon' && target !== 'self' && !!document.getElementById('s-classic-zone-enabled')?.checked;
  const elementId = document.getElementById('s-classic-element')?.value || '';
  const element = _classicDamageTypes.find(type => type.id === elementId);
  const duration = _classicInt('s-classic-duration', 0, 0, 99);
  const pm = _classicInt('s-classic-pm', 0, 0, 99);
  const types = effectKind === 'damage' ? ['offensif']
    : effectKind === 'heal' ? ['defensif'] : ['utilitaire'];
  const invCount = _classicInt('s-classic-invocation-count', 1, 1, 12);
  const invIds = effectKind === 'summon' ? _classicInvocationIdsFromDOM(invCount) : [];
  const hostileState = stateId && target === 'enemy';
  const friendlyState = stateId && (target === 'ally' || target === 'self');
  const previousValidation = _sortValidationState(prev);
  const validation = STATE.isAdmin
    ? (document.getElementById('s-classic-validation')?.value || 'pending')
    : previousValidation;
  return {
    designMode: 'classic',
    classicFormulaFinal: true,
    icon: (document.getElementById('s-classic-icon')?.value || '').trim() || '✦',
    nom: (document.getElementById('s-nom')?.value || '').trim(),
    catId: document.getElementById('s-classic-catid')?.value || '',
    effet: (document.getElementById('s-classic-description')?.value || '').trim(),
    types,
    typeSoin: effectKind === 'heal',
    classicEffect: effectKind,
    classicTarget: target,
    targetSelf: target === 'self',
    degats: effectKind === 'damage' ? (document.getElementById('s-classic-formula')?.value || '').trim() : '',
    soin: effectKind === 'heal' ? (document.getElementById('s-classic-formula')?.value || '').trim() : '',
    protectionMode: effectKind === 'heal' ? 'soin' : 'ca',
    toucherStat: effectKind === 'damage' ? (document.getElementById('s-classic-touch-stat')?.value || '') : 'none',
    degatsStat: effectKind === 'utility'
      ? 'none'
      : (document.getElementById('s-classic-effect-stat')?.value || 'none'),
    noyau: element ? `${element.label} ${element.icon || ''}`.trim() : '',
    noyauTypeId: elementId || null,
    noyauTypeIds: elementId ? [elementId] : [],
    runes: [],
    actionMode: document.getElementById('s-classic-action')?.value || 'action',
    pm,
    pmOverride: null,
    portee: target === 'self' ? 0 : _classicInt('s-classic-range', 1, 0, 99),
    zoneW: zoneEnabled ? _classicInt('s-classic-zone-w', 1, 1, 50) : null,
    zoneH: zoneEnabled ? _classicInt('s-classic-zone-h', 1, 1, 50) : null,
    zoneShape: zoneEnabled ? (document.getElementById('s-classic-zone-shape')?.value || 'rect') : 'rect',
    dureeBase: duration,
    classicDuration: duration,
    cooldownTurns: _classicInt('s-classic-cooldown', 0, 0, 99),
    classicStateId: stateId || null,
    classicStateLabel: stateId ? (stateMeta?.label || prev.classicStateLabel || stateId) : null,
    classicStateIcon: stateId ? (stateMeta?.icon || prev.classicStateIcon || '') : null,
    classicStateDC: hostileState ? _classicInt('s-classic-state-dc', 11, 1, 40) : null,
    classicStateSaveStat: hostileState ? (document.getElementById('s-classic-state-stat')?.value || 'sagesse') : null,
    enchantMode: friendlyState ? 'etat' : null,
    enchantEtatId: friendlyState ? stateId : null,
    enchantEtatIds: friendlyState ? [stateId] : [],
    afflictionMode: hostileState ? 'etat' : null,
    afflictionEtatId: hostileState ? stateId : null,
    afflictionSaveStat: hostileState ? (document.getElementById('s-classic-state-stat')?.value || 'sagesse') : '',
    invocation: effectKind === 'summon'
      ? {
          ids: invIds,
          max: invCount,
          stats: prev.invocation?.stats || null,
          actions: Array.isArray(prev.invocation?.actions) ? prev.invocation.actions : [],
          image: prev.invocation?.image || '',
        }
      : null,
    mjAutoHit: !!document.getElementById('s-classic-auto-hit')?.checked,
    mjAlwaysMax: STATE.isAdmin
      ? !!document.getElementById('s-classic-always-max')?.checked
      : !!prev.mjAlwaysMax,
    mjNotes: STATE.isAdmin
      ? (document.getElementById('s-classic-mj-notes')?.value || '').trim()
      : (prev.mjNotes || ''),
    mjValidation: validation,
    mjValidated: validation === 'ok',
    actif: idx >= 0 ? !!prev.actif : false,
    id: prev.id || null,
  };
}

function _refreshClassicSpellForm() {
  const effect = document.getElementById('s-classic-effect')?.value || 'damage';
  const target = document.getElementById('s-classic-target')?.value || 'enemy';
  const stateOn = !!document.getElementById('s-classic-state-enabled')?.checked;
  const zoneOn = target !== 'self' && !!document.getElementById('s-classic-zone-enabled')?.checked;
  const isSummon = effect === 'summon';
  const formula = document.getElementById('s-classic-formula-group');
  if (formula) formula.style.display = (effect === 'utility' || isSummon) ? 'none' : '';
  const effectStat = document.getElementById('s-classic-effect-stat-group');
  if (effectStat) effectStat.style.display = (effect === 'utility' || isSummon) ? 'none' : '';
  const formulaLabel = document.getElementById('s-classic-formula-label');
  if (formulaLabel) formulaLabel.textContent = effect === 'heal' ? 'Formule de soin' : 'Formule de dégâts';
  const touch = document.getElementById('s-classic-touch-group');
  if (touch) touch.style.display = effect === 'damage' ? '' : 'none';
  const autoHit = document.getElementById('s-classic-auto-hit-group');
  if (autoHit) autoHit.style.display = effect === 'damage' ? '' : 'none';
  const state = document.getElementById('s-classic-state-fields');
  if (state) state.style.display = stateOn ? '' : 'none';
  const save = document.getElementById('s-classic-save-fields');
  if (save) save.style.display = stateOn && target === 'enemy' ? '' : 'none';
  const zone = document.getElementById('s-classic-zone-fields');
  if (zone) zone.style.display = (zoneOn && !isSummon) ? '' : 'none';
  const zoneToggle = document.getElementById('s-classic-zone-toggle');
  if (zoneToggle) zoneToggle.style.display = (target === 'self' || isSummon) ? 'none' : '';
  const stateSection = document.getElementById('s-classic-state-section');
  if (stateSection) stateSection.style.display = isSummon ? 'none' : '';
  const targetGroup = document.getElementById('s-classic-target-group');
  if (targetGroup) targetGroup.style.display = isSummon ? 'none' : '';
  const invocationSection = document.getElementById('s-classic-invocation-section');
  if (invocationSection) invocationSection.style.display = isSummon ? '' : 'none';
  document.querySelectorAll('.classic-inv-card').forEach(card => {
    card.classList.toggle('is-on', !!card.querySelector('input[name="s-classic-invocation-id"]')?.checked);
  });
  const range = document.getElementById('s-classic-range');
  if (range) range.disabled = target === 'self' && !isSummon;

  const preview = document.getElementById('s-classic-preview');
  if (preview) {
    const spell = _buildClassicSortFromDOM();
    const condition = spell.classicStateId ? _conditionsLibCache?.find(item => item.id === spell.classicStateId) : null;
    const action = { action:'Action', action_bonus:'Action Bonus', reaction:'Réaction' }[spell.actionMode] || 'Action';
    const effectText = spell.classicEffect === 'damage' ? `⚔️ ${spell.degats || 'Formule manquante'}`
      : spell.classicEffect === 'heal' ? `💚 ${spell.soin || 'Formule manquante'}`
        : spell.classicEffect === 'summon' ? `🐾 ${spell.invocation?.max || 1} invocation${(spell.invocation?.max || 1) > 1 ? 's' : ''}`
          : `✨ ${spell.effet || 'Effet utilitaire'}`;
    const zoneText = spell.zoneW && spell.zoneH
      ? ` · zone ${spell.zoneW}×${spell.zoneH}` : '';
    preview.innerHTML = `
      <div><strong>${_esc(action)}</strong><span>${spell.pm} PM</span></div>
      <p>${_esc(effectText)}</p>
      <small>Portée ${spell.portee} case${spell.portee > 1 ? 's' : ''}${_esc(zoneText)}${spell.classicDuration ? ` · ${spell.classicDuration} tour${spell.classicDuration > 1 ? 's' : ''}` : ' · instantané'}</small>
      ${condition ? `<small>${_esc(`${condition.icon || ''} ${condition.label}`)}${spell.classicStateDC ? ` · JS ${_esc(spell.classicStateSaveStat)} DD ${spell.classicStateDC}` : ''}</small>` : ''}
      ${spell.classicEffect === 'summon' && spell.invocation?.ids?.length ? `<small>${spell.invocation.ids.length} invocation${spell.invocation.ids.length > 1 ? 's' : ''} présélectionnée${spell.invocation.ids.length > 1 ? 's' : ''}</small>` : ''}
      ${spell.cooldownTurns ? `<small>Recharge : ${spell.cooldownTurns} tour${spell.cooldownTurns > 1 ? 's' : ''}</small>` : ''}`;
  }
}

async function _populateClassicStateSelect(savedId = '', { preserveUnsupported = true } = {}) {
  const select = document.getElementById('s-classic-state');
  if (!select) return;
  const conditions = await _loadAllConditions();
  const target = document.getElementById('s-classic-target')?.value || 'enemy';
  const usage = target === 'ally' || target === 'self' ? 'enchantment' : 'affliction';
  const filtered = target === 'any'
    ? conditions
    : conditions.filter(condition => _conditionSupportsSpellUsage(condition, usage)
      || (preserveUnsupported && condition.id === savedId));
  select.innerHTML = '<option value="">— Choisir un état —</option>'
    + filtered.map(condition => `<option value="${_esc(condition.id)}" ${condition.id === savedId ? 'selected' : ''}>${_esc(`${condition.icon || ''} ${condition.label}`)}</option>`).join('');
  _refreshClassicSpellForm();
}

async function _classicTargetChanged() {
  const savedId = document.getElementById('s-classic-state')?.value || '';
  await _populateClassicStateSelect(savedId, { preserveUnsupported: false });
  _refreshClassicSpellForm();
}

function _classicStateChanged() {
  const id = document.getElementById('s-classic-state')?.value || '';
  const condition = id ? _conditionsLibCache?.find(item => item.id === id) : null;
  if (condition && document.getElementById('s-classic-target')?.value === 'enemy') {
    const stat = document.getElementById('s-classic-state-stat');
    const dc = document.getElementById('s-classic-state-dc');
    if (stat && condition.defaultSaveStat) stat.value = condition.defaultSaveStat;
    if (dc) dc.value = condition.defaultDC ?? 11;
  }
  _refreshClassicSpellForm();
}

function _renderClassicInvocationPicker(selectedIds = [], max = 1) {
  const invs = _libInvs();
  const selected = new Set((selectedIds || []).filter(Boolean));
  const limit = Math.max(1, parseInt(max) || 1);
  if (!invs.length) {
    return `<div class="classic-inv-empty">
      <strong>Aucune invocation enregistrée.</strong>
      <span>Crée d'abord des invocations depuis le menu “Mes invocations” du grimoire.</span>
    </div>`;
  }
  return `<div class="classic-inv-grid">
    ${invs.map(iv => {
      const checked = selected.has(iv.id);
      const hpTxt = (iv.currentHp != null && iv.stats?.pv != null && parseInt(iv.currentHp) < parseInt(iv.stats.pv))
        ? `${iv.currentHp}/${iv.stats.pv}` : (iv.stats?.pv ?? '?');
      return `<label class="classic-inv-card ${checked ? 'is-on' : ''}">
        <input type="checkbox" name="s-classic-invocation-id" value="${_esc(iv.id)}" ${checked ? 'checked' : ''}>
        <span class="classic-inv-portrait">${iv.image ? `<img src="${iv.image}" alt="">` : '🐾'}</span>
        <span class="classic-inv-body">
          <b>${_esc(iv.nom || 'Invocation')}</b>
          <small>❤️ ${hpTxt} · 🛡️ ${iv.stats?.ca ?? 10} · ⚔️ ${_esc(iv.stats?.attaque || '1d4 +2')}</small>
        </span>
      </label>`;
    }).join('')}
  </div>
  <div class="classic-inv-foot">
    <span>Le VTT proposera ces créatures en priorité. Limite : ${limit} invocation${limit > 1 ? 's' : ''}.</span>
    <span>Bibliothèque : menu “Mes invocations”.</span>
  </div>`;
}

async function _openClassicSortModal(idx, s, allTypes) {
  _classicDamageTypes = Array.isArray(allTypes) ? allTypes : [];
  const effect = s?.classicEffect || (s?.invocation ? 'summon' : s?.soin ? 'heal' : s?.degats ? 'damage' : 'utility');
  const target = effect === 'summon' ? 'any' : (s?.classicTarget || (effect === 'heal' ? 'ally' : 'enemy'));
  const hasZone = (parseInt(s?.zoneW) || 0) > 0 || (parseInt(s?.zoneH) || 0) > 0;
  const hasState = !!(s?.classicStateId || s?.enchantEtatId || s?.afflictionEtatId);
  const stateId = s?.classicStateId || s?.enchantEtatId || s?.afflictionEtatId || '';
  const selectedElement = s?.noyauTypeId || '';
  const charForAccess = _modalChar();
  const charElements = new Set(charForAccess?.elements || []);
  let elements = STATE.isAdmin || !charForAccess
    ? [...allTypes]
    : allTypes.filter(type => !type.isMagic || charElements.has(type.id));
  const legacyElement = selectedElement ? allTypes.find(type => type.id === selectedElement) : null;
  if (legacyElement && !elements.some(type => type.id === selectedElement)) elements = [...elements, legacyElement];
  const formula = effect === 'heal' ? (s?.soin || '') : (s?.degats || '');
  const invocationMax = Math.max(1, parseInt(s?.invocation?.max ?? s?.classicInvocationCount) || 1);
  const invocationIds = Array.isArray(s?.invocation?.ids) ? s.invocation.ids : [];
  const validation = _sortValidationState(s);
  const _modalOpen = _itemEditCtx ? pushModal : openModal;
  _modalOpen('', `
    <div class="sh-admin-modal is-spell is-classic-spell" id="s-classic-form">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">✦</div>
        <div class="sh-admin-head-title">
          <h2>${idx >= 0 ? 'Modifier le sort' : 'Nouveau sort classique'}</h2>
          <small>Définis directement le résultat en jeu, sans noyaux ni runes d’effet.</small>
        </div>
        <button class="sh-admin-close" data-action="closeModalDirect" aria-label="Fermer">×</button>
      </div>
      <div class="sh-admin-body">
        <div class="classic-spell-layout">
          <main class="classic-spell-main">
            <section class="classic-spell-section">
              <div class="classic-spell-section-head"><span>1</span><div><b>Identité</b><small>Ce que les joueurs reconnaîtront immédiatement.</small></div></div>
              <div class="classic-spell-identity">
                <label><span>Icône</span><input id="s-classic-icon" class="input-field" maxlength="4" value="${_esc(s?.icon || '✦')}"></label>
                <label class="is-wide"><span>Nom du sort</span><input id="s-nom" class="input-field" value="${_esc(s?.nom || '')}" placeholder="Boule de feu, Mot de soin…"></label>
                <label><span>Catégorie</span><select id="s-classic-catid" class="input-field"><option value="">— Aucune —</option>${(_modalChar()?.sort_cats || []).map(cat => `<option value="${_esc(cat.id)}" ${s?.catId === cat.id ? 'selected' : ''}>${_esc(cat.nom)}</option>`).join('')}</select></label>
              </div>
              <label><span>Description / effet libre</span><textarea id="s-classic-description" class="input-field" rows="2" placeholder="Décris le résultat, l’apparence ou les conditions particulières…">${_esc(s?.effet || '')}</textarea></label>
            </section>

            <section class="classic-spell-section">
              <div class="classic-spell-section-head"><span>2</span><div><b>Effet principal</b><small>La formule saisie est finale : aucun bonus de rune ne sera ajouté.</small></div></div>
              <div class="classic-spell-grid">
                <label><span>Nature</span><select id="s-classic-effect" class="input-field" data-change="_classicRefresh">${_classicSelectOptions([['damage','Dégâts'],['heal','Soin'],['summon','Invocation'],['utility','Utilitaire']], effect)}</select></label>
                <label><span>Élément</span><select id="s-classic-element" class="input-field"><option value="">— Neutre / aucun —</option>${elements.map(type => `<option value="${_esc(type.id)}" ${type.id === selectedElement ? 'selected' : ''}>${_esc(`${type.icon || ''} ${type.label}`)}</option>`).join('')}</select></label>
                <label id="s-classic-formula-group" class="classic-spell-span-2"><span id="s-classic-formula-label">Formule</span><input id="s-classic-formula" class="input-field" value="${_esc(formula)}" placeholder="Ex. 2d8+3 ou 12"></label>
                <label id="s-classic-effect-stat-group"><span>Bonus de caractéristique</span><select id="s-classic-effect-stat" class="input-field">${_SPELL_STAT_OPTIONS(s?.degatsStat || 'none')}</select></label>
                <label id="s-classic-touch-group"><span>Jet d’attaque</span><select id="s-classic-touch-stat" class="input-field">${_SPELL_STAT_OPTIONS(s?.toucherStat)}</select></label>
                <label id="s-classic-auto-hit-group" class="classic-spell-check"><input type="checkbox" id="s-classic-auto-hit" ${s?.mjAutoHit ? 'checked' : ''}><span><b>Réussite automatique</b><small>Le sort ne demande aucun jet de toucher.</small></span></label>
              </div>
            </section>

            <section class="classic-spell-section">
              <div class="classic-spell-section-head"><span>3</span><div><b>Ciblage et zone</b><small>La zone sera placée dans la portée du sort sur la table virtuelle.</small></div></div>
              <div class="classic-spell-grid">
                <label id="s-classic-target-group"><span>Cible</span><select id="s-classic-target" class="input-field" data-change="_classicTargetChanged">${_classicSelectOptions([['enemy','Ennemi'],['ally','Allié'],['self','Lanceur'],['any','Toute cible']], target)}</select></label>
                <label><span>Portée</span><div class="classic-spell-unit"><input type="number" id="s-classic-range" class="input-field" min="0" max="99" value="${s?.portee ?? 1}"><span>cases</span></div></label>
                <label id="s-classic-zone-toggle" class="classic-spell-check classic-spell-span-2"><input type="checkbox" id="s-classic-zone-enabled" data-change="_classicRefresh" ${hasZone ? 'checked' : ''}><span><b>Sort de zone plaçable</b><small>Toutes les cibles compatibles dans la zone subissent l’effet.</small></span></label>
                <div id="s-classic-zone-fields" class="classic-spell-zone classic-spell-span-2">
                  <label><span>Largeur</span><input type="number" id="s-classic-zone-w" class="input-field" min="1" max="50" value="${parseInt(s?.zoneW) || 3}"></label>
                  <label><span>Hauteur</span><input type="number" id="s-classic-zone-h" class="input-field" min="1" max="50" value="${parseInt(s?.zoneH) || 3}"></label>
                  <label><span>Forme</span><select id="s-classic-zone-shape" class="input-field">${_classicSelectOptions([['rect','Rectangle / carré'],['cross','Croix'],['diamond','Cercle sur la grille']], s?.zoneShape || 'rect')}</select></label>
                </div>
              </div>
            </section>

            <section class="classic-spell-section" id="s-classic-invocation-section">
              <div class="classic-spell-section-head"><span>4</span><div><b>Invocation</b><small>Choisis combien de créatures le sort peut placer, et lesquelles proposer par défaut.</small></div></div>
              <div class="classic-spell-grid">
                <label><span>Nombre maximum</span><div class="classic-spell-unit"><input type="number" id="s-classic-invocation-count" class="input-field" min="1" max="12" value="${invocationMax}"><span>invoc.</span></div></label>
                <div class="classic-spell-note"><b>Placement VTT</b><span>Au lancement, le joueur pose les invocations une par une dans la portée du sort.</span></div>
              </div>
              ${_renderClassicInvocationPicker(invocationIds, invocationMax)}
            </section>

            <section class="classic-spell-section" id="s-classic-state-section">
              <div class="classic-spell-section-head"><span>4</span><div><b>État appliqué</b><small>Optionnel, en plus de l’effet principal.</small></div></div>
              <label class="classic-spell-check"><input type="checkbox" id="s-classic-state-enabled" data-change="_classicRefresh" ${hasState ? 'checked' : ''}><span><b>Appliquer un état</b><small>Buff sur un allié, affliction avec sauvegarde sur un ennemi.</small></span></label>
              <div id="s-classic-state-fields" class="classic-spell-grid classic-spell-subfields">
                <label class="classic-spell-span-2"><span>État</span><select id="s-classic-state" class="input-field" data-change="_classicStateChanged"><option value="">Chargement…</option></select></label>
                <div id="s-classic-save-fields" class="classic-spell-zone classic-spell-span-2">
                  <label><span>Sauvegarde</span><select id="s-classic-state-stat" class="input-field">${_classicSelectOptions([['force','Force'],['dexterite','Dextérité'],['constitution','Constitution'],['intelligence','Intelligence'],['sagesse','Sagesse'],['charisme','Charisme']], s?.classicStateSaveStat || s?.afflictionSaveStat || 'sagesse')}</select></label>
                  <label><span>DD</span><input type="number" id="s-classic-state-dc" class="input-field" min="1" max="40" value="${s?.classicStateDC || 11}"></label>
                </div>
              </div>
            </section>
          </main>

          <aside class="classic-spell-side">
            <section class="classic-spell-preview" id="s-classic-preview"></section>
            <section class="classic-spell-section">
              <div class="classic-spell-section-head"><span>5</span><div><b>Coût et rythme</b><small>Valeurs directement utilisées dans le VTT.</small></div></div>
              <div class="classic-spell-grid is-compact">
                <label><span>Coût</span><div class="classic-spell-unit"><input type="number" id="s-classic-pm" class="input-field" min="0" max="99" value="${s?.pmOverride ?? s?.pm ?? 0}"><span>PM</span></div></label>
                <label><span>Action</span><select id="s-classic-action" class="input-field">${_classicSelectOptions([['action','Action'],['action_bonus','Action Bonus'],['reaction','Réaction']], s?.actionMode || 'action')}</select></label>
                <label><span>Durée</span><div class="classic-spell-unit"><input type="number" id="s-classic-duration" class="input-field" min="0" max="99" value="${s?.classicDuration ?? s?.dureeBase ?? 0}"><span>tours</span></div></label>
                <label><span>Recharge</span><div class="classic-spell-unit"><input type="number" id="s-classic-cooldown" class="input-field" min="0" max="99" value="${s?.cooldownTurns ?? 0}"><span>tours</span></div></label>
              </div>
            </section>
            <section class="classic-spell-section classic-spell-mj">
              <div class="classic-spell-section-head"><span>MJ</span><div><b>Validation</b><small>Équilibrage et exceptions.</small></div></div>
              ${STATE.isAdmin ? `
                <label><span>Statut</span><select id="s-classic-validation" class="input-field">${_classicSelectOptions([['ok','Validé'],['pending','En attente'],['no','Refusé']], validation)}</select></label>
                <label class="classic-spell-check"><input type="checkbox" id="s-classic-always-max" ${s?.mjAlwaysMax ? 'checked' : ''}><span><b>Toujours valeur maximum</b><small>Les dés prennent leur valeur maximale.</small></span></label>
                <label><span>Notes MJ</span><textarea id="s-classic-mj-notes" class="input-field" rows="2">${_esc(s?.mjNotes || '')}</textarea></label>`
              : `<div class="classic-spell-readonly">${validation === 'ok' ? '✓ Validé' : validation === 'no' ? '✕ Refusé' : '◷ En attente de validation'}</div>`}
            </section>
          </aside>
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="closeModalDirect">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="saveSort" data-idx="${idx}">Enregistrer le sort</button>
      </div>
    </div>`);

  const modal = document.querySelector('.modal');
  modal?.addEventListener('input', _refreshClassicSpellForm);
  modal?.addEventListener('change', _refreshClassicSpellForm);
  await _populateClassicStateSelect(stateId);
  _refreshClassicSpellForm();
  if (idx < 0) document.getElementById('s-nom')?.focus();
  if (!_itemEditCtx) {
    _sortModalBaseline = JSON.stringify(_buildClassicSortFromDOM());
    setModalCloseGuard(_sortModalCloseGuard);
  }
}

export async function openSortModal(idx, s) {
  _rezPrevLit = new Set();   // réinitialise l'anim d'ignition à chaque ouverture
  // Bandeau avant/après : uniquement quand un JOUEUR édite un sort DÉJÀ validé
  // (l'admin pilote la validation lui-même → pas de retour automatique en attente).
  _sortEditWasOk = idx >= 0 && !STATE.isAdmin && _sortValidationState(s) === 'ok';
  _sortEditContentBaseline = null;   // capturé au mount (après stabilisation des dropdowns)
  const [allTypes, matrices] = await Promise.all([loadDamageTypes(), loadSpellMatrices(), loadSpellSystem()]);
  // Caches globaux utilisés par _getSortCA, _calcSortSoin, suggestions...
  setSpellCaches(matrices, allTypes);
  const useClassic = s?.designMode === 'classic'
    || (idx < 0 && getSpellSystemMode() === 'classic');
  if (useClassic) return _openClassicSortModal(idx, s || {}, allTypes);
  // Tous les types de dégâts restent la source globale des noyaux.
  // L'accès joueur aux noyaux magiques est ensuite filtré par personnage (c.elements).
  const RUNES = RUNE_META; // alias local pour compat ascendante
  _sortModalBaseline = null;   // inerte tant que le baseline n'est pas capturé (mount)

  const runesSrc = s?.runes||[];
  const runeCounts = {};
  _actionModeEdit = _spellActionMode(s);
  _protModeEdit = s?.protectionMode || 'ca';   // fixé depuis la donnée (pas le DOM périmé)
  _zoneShapeEdit = s?.zoneShape === 'cross' ? 'cross' : 'rect';
  _enchantExtraSavedEdit = Array.isArray(s?.enchantEtatIds) ? s.enchantEtatIds.slice(1) : [];
  runesSrc.forEach(r => {
    const nom = (r === 'Réaction' || r === 'Action Bonus') ? ACTION_RUNE : r;
    runeCounts[nom] = (runeCounts[nom] || 0) + 1;
  });
  if (runeCounts[ACTION_RUNE] > 1) runeCounts[ACTION_RUNE] = 1;
  _runeCountsEdit = { ...runeCounts };

  // Noyau : id de type (nouveau) ou migration depuis label (ancien)
  let noyauTypeIdSel = s?.noyauTypeId || '';
  if (!noyauTypeIdSel && s?.noyau) {
    // Migration : chercher par label ou par label partiel (ex: 'Feu 🔥' → 'feu')
    const legacy = allTypes.find(n =>
      n.label === s.noyau ||
      s.noyau.toLowerCase().startsWith(n.label.toLowerCase())
    );
    noyauTypeIdSel = legacy?.id || '';
  }
  const charForAccess = _modalChar();
  const charElements  = new Set(charForAccess?.elements || []);
  const canUseAllNoyaux = STATE.isAdmin || !charForAccess;
  const allowedNoyaux = canUseAllNoyaux
    ? [...allTypes]
    : allTypes.filter(n => !n.isMagic || charElements.has(n.id));
  const selectedNoyau = noyauTypeIdSel ? allTypes.find(n => n.id === noyauTypeIdSel) : null;
  const selectedLocked = selectedNoyau && !allowedNoyaux.some(n => n.id === selectedNoyau.id);
  const NOYAUX = selectedLocked
    ? [...allowedNoyaux, { ...selectedNoyau, locked: true }]
    : allowedNoyaux;
  _sortAllowedNoyauIds = new Set(allowedNoyaux.map(n => n.id));
  // Multi-noyau : liste ordonnée des éléments sélectionnés ([0] = primaire).
  // Migration : noyauTypeIds (nouveau) → sinon le noyau unique migré ci-dessus.
  _noyauIdsEdit = Array.isArray(s?.noyauTypeIds) && s.noyauTypeIds.length
    ? s.noyauTypeIds.filter(Boolean)
    : (noyauTypeIdSel ? [noyauTypeIdSel] : []);

  const noyauSel      = noyauTypeIdSel
    ? (selectedNoyau?.label || s?.noyau || '')
    : (s?.noyau || '');
  // Pas de type par défaut sur un sort nouveau — l'utilisateur choisit. Compat legacy uniquement.
  const typesInit = Array.isArray(s?.types) ? s.types
    : (s?.typeSoin ? ['defensif'] : (s?.noyau ? ['offensif'] : []));

  _sortTypesEdit  = new Set(typesInit);
  _deplModeEdit   = s?.deplacement?.mode || (s?.ampMode === 'deplacement' ? 'self' : null);
  _invImageEdit   = s?.invocation?.image || '';
  _invOriginal    = (s?.invocation && typeof s.invocation === 'object') ? s.invocation : null;

  const hasEnchant  = runesSrc.includes('Enchantement');
  const hasProt     = runesSrc.includes('Protection');
  const hasInvoc    = runesSrc.includes('Invocation') && !runesSrc.includes('Affliction') && !hasEnchant;
  const ivStats     = s?.invocation?.stats || {};                  // overrides sauvegardés
  const ivDerived   = _calcInvocationStats({ runes: runesSrc });   // valeurs dérivées (placeholders)
  const enchantModeForEdit = 'etat';
  const enchantEtatForEdit = s?.enchantEtatId
    || ((s?.enchantMode || 'etat') === 'dmg' ? 'empowered'
      : (s?.enchantMode === 'deplacement' ? 'swift'
        : (s?.enchantMode === 'toucher' ? 'guided' : '')));

  // Le rendu réel des runes est fait par _renderRunesSection (module-level),
  // appelé au mount et après chaque incrément/décrément pour rester synchro.
  const runesSectionHtml = _renderRunesSection();

  const TYPE_CFG = [
    { v:'offensif',   label:'⚔️ Offensif',   color:'#ff6b6b' },
    { v:'defensif',   label:'🛡️ Soutien',   color:'#22c38e' },
    { v:'utilitaire', label:'✨ Utilitaire', color:'#b47fff' },
  ];
  const typeBtnsHtml = TYPE_CFG.map(t => {
    const isSel = typesInit.includes(t.v);
    return `<button type="button" id="s-type-${t.v}"
      data-action="_toggleSortType" data-type="${t.v}"
      style="flex:1;padding:.4rem .3rem;border-radius:8px;font-size:.75rem;cursor:pointer;
      border:2px solid ${isSel?t.color:'var(--border)'};
      background:${isSel?t.color+'20':'var(--bg-elevated)'};
      color:${isSel?t.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${t.label}</button>`;
  }).join('');

  // Amplification : mode Zone | Déplacement (calqué sur Protection soin/CA)
  const hasAmp   = runesSrc.includes('Amplification');
  const nbAmp    = runesSrc.filter(r => r === 'Amplification').length;
  const ampMode  = s?.ampMode || 'zone';
  const hasDisp  = runesSrc.includes('Dispersion');
  const hasInv   = runesSrc.includes('Invocation');
  const hasActionRune = (_runeCountsEdit[ACTION_RUNE] || 0) > 0;
  const actionMode = _actionModeEdit || 'reaction';
  const actionModeBtnsHtml = [
    { v:'reaction', label:'🔄 Réaction', col:'#ec4899', detail:'Hors de son tour' },
    { v:'action_bonus', label:'✴️ Action Bonus', col:'#f97316', detail:'Action Bonus du tour' },
  ].map(opt => {
    const sel = actionMode === opt.v;
    return `<button type="button" id="s-action-mode-${opt.v}"
      data-action="_selectActionMode" data-val="${opt.v}"
      style="flex:1;padding:.42rem .35rem;border-radius:8px;cursor:pointer;transition:all .15s;
      border:2px solid ${sel?opt.col:'var(--border)'};
      background:${sel?opt.col+'18':'var(--bg-elevated)'};text-align:center">
      <div style="font-size:.76rem;font-weight:700;color:${sel?opt.col:'var(--text-dim)'}">${opt.label}</div>
      <div style="font-size:.64rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
    </button>`;
  }).join('');
  // Sous-modes de déplacement (Soi / Pousser / Attirer)
  const deplCur = s?.deplacement?.mode || 'self';
  const deplBtnsHtml = [
    { v:'self', label:'🏃 Soi',     col:'#22c38e' },
    { v:'push', label:'↗ Pousser',  col:'#e8b84b' },
    { v:'pull', label:'↙ Attirer',  col:'#4f8cff' },
  ].map(opt => {
    const sel = deplCur === opt.v;
    return `<button type="button" id="s-depl-${opt.v}"
      data-action="_selectDeplMode" data-val="${opt.v}"
      style="flex:1;padding:.3rem .2rem;border-radius:7px;font-size:.72rem;cursor:pointer;transition:all .15s;
        border:2px solid ${sel?opt.col:'var(--border)'};
        background:${sel?opt.col+'20':'var(--bg-elevated)'};
        color:${sel?opt.col:'var(--text-dim)'};
        font-weight:${sel?'700':'400'}">${opt.label}</button>`;
  }).join('');

  // Si on édite une action d'item, on EMPILE la modal sur la modal du shop
  // (pushModal) pour pouvoir la restaurer après. Sinon openModal classique.
  const _modalOpen = _itemEditCtx ? pushModal : openModal;
  _modalOpen('', `
   <div class="sh-admin-modal is-spell">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">${idx>=0?'✏️':'✨'}</div>
      <div class="sh-admin-head-title">
        <h2>${idx>=0?'Modifier le sort':'Nouveau sort'}</h2>
        <small>Construis le sort étape par étape : identité, noyau, runes, puis réglages.</small>
      </div>
      <button class="sh-admin-close" data-action="closeModalDirect" title="Fermer">✕</button>
    </div>
    <div class="sh-admin-body">
     <div class="cs-spell-forge">
    ${_sortEditWasOk ? `<div id="s-revalidate-banner" class="cs-forge-revalidate" hidden>
      <span class="cs-forge-revalidate-ico">⚠️</span>
      <span>Ce sort est <b>validé</b>. L'enregistrer avec ces changements le renverra <b>en attente de validation MJ</b> et le retirera du Deck.</span>
    </div>` : ''}
    <!-- ① Essentiel : tout ce qui identifie le sort avant la mécanique -->
    <section class="cs-spell-card cs-spell-card--identity" aria-label="Essentiel du sort">
      <div class="cs-spell-card-head"><span>1</span><div><b>Essentiel</b><small>Nom, catégorie et intention du sort.</small></div></div>
      <div class="cs-spell-identity">
        <div class="cs-spell-identity-field"><label>Icône</label>
          <button type="button" id="s-icon-btn" class="cs-spell-icon-btn"
            data-action="_toggleSortIconPicker"
            title="Cliquer pour choisir une icône">${s?.icon || '🔮'}</button>
          <input type="hidden" id="s-icon" value="${s?.icon||''}">
          <div id="s-icon-picker" class="cs-spell-icon-picker" style="display:none"></div>
        </div>
        <div class="cs-spell-identity-field cs-spell-identity-field--name"><label>Nom du sort</label>
          <input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu, Vague de soin…" aria-describedby="s-nom-error">
          <div id="s-nom-error" class="cs-spell-field-error" hidden>Donne un nom au sort avant de l'enregistrer.</div>
        </div>
        <div class="cs-spell-identity-field"><label>Catégorie</label>
          <select class="input-field" id="s-catid">
            <option value="">— Aucune —</option>
            ${(_modalChar()?.sort_cats||[]).map(cat =>
              `<option value="${cat.id}" ${s?.catId===cat.id?'selected':''}>${cat.nom}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="cs-spell-inline-row cs-spell-type-row">
        <span class="cs-spell-inline-label" title="Optionnel · plusieurs possibles · cliquer pour activer/désactiver">Type</span>
        <div class="cs-spell-type-buttons">${typeBtnsHtml}</div>
      </div>
      <div class="form-group cs-spell-desc">
        <label>Description / effet libre <span>narration, conditions spéciales, fluff</span></label>
        <textarea class="input-field" id="s-effet" rows="2" placeholder="Décris brièvement le sort, son apparence, ses conditions particulières…">${s?.effet||''}</textarea>
      </div>
    </section>

   <!-- Atelier principal : construction à gauche, résumé et réglages à droite -->
   <div class="cs-spell-layout">
    <main class="cs-spell-main">

    <!-- ③ Noyau — section visuelle dédiée -->
    <div class="cs-spell-section cs-spell-section--noyau">
      <div class="cs-spell-section-title"><span class="cs-step-pill">2</span> Rune noyau <span class="cs-spell-section-hint">obligatoire · 2 PM · un ou plusieurs éléments</span></div>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.length ? NOYAUX.map(n => {
          const selected = _noyauIdsEdit.includes(n.id);
          const locked = !!n.locked;
          const selectedStyle = selected ? `border-color:${n.color};background:${n.color}20;color:${n.color}` : '';
          const attrs = locked
            ? `disabled aria-disabled="true" title="Ce noyau n'est plus accessible à ce personnage"`
            : `data-action="selectNoyau" data-noyau-label="${_esc(n.label+' '+n.icon)}" data-noyau-color="${n.color}" title="Choisir ${n.label}"`;
          const lockedBadge = locked ? '<span class="cs-noyau-lock">non accessible</span>' : '';
          return `<button type="button" class="cs-noyau-btn ${selected?'selected':''}${locked?' cs-noyau-btn--locked':''}" style="${selectedStyle}" ${attrs} data-noyau-id="${n.id}" aria-pressed="${selected?'true':'false'}">${n.icon} ${n.label}${lockedBadge}</button>`;
        }).join('') : '<div class="cs-noyau-empty">Aucun noyau accessible. Demande au MJ de débloquer un élément sur ta fiche.</div>'}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
      <input type="hidden" id="s-noyau-id" value="${noyauTypeIdSel}">
      <div id="s-noyau-error" class="cs-spell-field-error" hidden>Sélectionne une rune noyau pour enregistrer ce sort.</div>
    </div>

    <!-- ④ Runes — Forge -->
    <div class="cs-spell-section cs-spell-section--runes">
      <div class="cs-spell-section-title"><span class="cs-step-pill">3</span> Runes d’effet <span class="cs-spell-section-hint">+2 PM par rune · cumulables</span></div>
      <div id="cs-runes-section">${runesSectionHtml}</div>
    </div>

    <!-- ✦ La Résonance — RÉSERVÉE AU MJ : révèle les combos. Cachée aux joueurs
         pour ne pas spoiler la découverte des combinaisons. -->
    ${STATE.isAdmin ? `<div class="cs-spell-section cs-spell-section--resonance">
      <div class="cs-spell-section-title"><span class="cs-step-pill">✦</span> Résonance <span class="cs-spell-section-hint">MJ · les combos s’allument quand les bonnes runes se rencontrent</span></div>
      <div id="cs-resonance" class="cs-resonance"></div>
    </div>` : ''}

    <!-- ④ Effets générés par les choix précédents -->
    <section class="cs-spell-effects-panel" aria-label="Effets générés par le sort">
      <div class="cs-spell-effects-title"><span class="cs-step-pill">4</span><div><b>Effets actifs</b><small>Les options apparaissent uniquement quand les runes ou types concernés sont présents.</small></div></div>
      <div id="s-effects-empty" class="cs-spell-effects-empty">Choisis un type ou une rune pour afficher les effets actifs.</div>

    <!-- Dégâts — visible si type offensif (auto-val avec toggle Custom) ;
         masqué quand Affliction est présente (la Puissance scale le DoT à la place) -->
    <div id="s-degats-section" style="${(typesInit.includes('offensif') && !runesSrc.includes('Affliction') && ampMode !== 'deplacement')?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-degats',
        label: '⚔️ Dégâts',
        autoValue:  _calcSortDegats(s || {}, _modalChar()),
        autoSource: _autoSourceDegats(s || {}, _modalChar()),
        currentValue: s?.degats,
        placeholder: 'ex : 3d8 +2, 2d10 Feu… (vide = formule auto)',
        // Mode Custom : la formule ET les stats sont éditables ensemble.
        extraEdit: {
          hasOverride: !!(s?.toucherStat || s?.degatsStat),
          html: `
            <div class="cs-spell-stats-grid">
              <div>
                <span class="cs-spell-stats-tag">🎯 Toucher</span>
                <select class="input-field" id="s-toucher-stat">
                  ${_SPELL_STAT_OPTIONS(s?.toucherStat)}
                </select>
              </div>
              <div>
                <span class="cs-spell-stats-tag">⚔️ Dégâts</span>
                <select class="input-field" id="s-degats-stat" data-change="_refreshAutoValChips">
                  ${_SPELL_STAT_OPTIONS(s?.degatsStat)}
                </select>
              </div>
            </div>`,
        },
      })}
    </div>

    <!-- Protection — visible si rune Protection > 0 -->
    <div id="s-prot-section" style="${hasProt?'':'display:none'}">
      <!-- Combo Drain (sort offensif + Protection) : la Protection devient un vol
           de vie %, le choix CA/Soin et le montant n'ont plus de sens → masqués. -->
      <div id="s-prot-drain" style="display:none" class="cs-prot-drain">
        🩸 <b>Vol de vie</b> — soigne le lanceur de <b><span id="s-prot-drain-pct">50</span>%</b> des dégâts infligés
        <span class="cs-prot-drain-sub">% fixé par Protection · capé par la frappe de base hors Puissance</span>
      </div>
      <div class="form-group" id="s-prot-mode-group">
        <label>Rune Protection — effet</label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'ca',   label:'🛡️ Augmente la CA', color:'#22c38e', detail:'+2 CA · 2 tours' },
            { v:'soin', label:'💚 Soigne',           color:'#4f8cff', detail:'+1d4 par rune'  },
          ].map(opt => {
            const sel = (s?.protectionMode || 'ca') === opt.v;
            return `<button type="button" id="s-prot-${opt.v}" data-action="_selectProtMode" data-val="${opt.v}"
              style="flex:1;padding:.45rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.78rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.65rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-prot-mode" value="${s?.protectionMode||'ca'}">
      </div>
      <div id="s-ca-section" style="${(s?.protectionMode||'ca')==='ca'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-ca',
          label: '🛡️ Effet CA',
          autoValue:  _getSortCA(s || {}),
          autoSource: _autoSourceCA(s || {}),
          currentValue: s?.ca,
          placeholder: 'ex : CA +3, Bouclier magique +2…',
        })}
      </div>
    </div>

    <!-- Soin — visible si Protection en mode soin, ou Soutien + Amplification.
         Si le sort est aussi Offensif, on n'expose PAS le sélecteur de stat ici (déjà dans Dégâts). -->
    <div id="s-soin-section" style="${((hasProt && (s?.protectionMode||'ca')==='soin') || (typesInit.includes('defensif') && hasAmp && ampMode !== 'deplacement'))?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-soin',
        label: '💚 Soin',
        autoValue:  _calcSortSoin(s || {}, _modalChar()),
        autoSource: _autoSourceSoin(s || {}, _modalChar()),
        currentValue: s?.soin,
        placeholder: 'ex : 3d6 +2, moitié des dégâts… (vide = formule auto)',
        extraEdit: typesInit.includes('offensif') ? null : {
          hasOverride: !!s?.degatsStat,
          html: `
            <div class="cs-spell-stats-grid one">
              <div>
                <span class="cs-spell-stats-tag">💚 Stat de soin</span>
                <select class="input-field" id="s-degats-stat-soin" data-change="_refreshAutoValChips">
                  ${_SPELL_STAT_OPTIONS(s?.degatsStat)}
                </select>
              </div>
            </div>`,
        },
      })}
    </div>

    <div id="s-regeneration-section" class="cs-spell-slot-box cs-spell-slot-box--def" style="display:none">
      <div class="cs-spell-slot-title">💚 Régénération <span>Protection + Affliction · soin sur la durée</span></div>
      ${_autoValHtml({
        fieldId: 's-regeneration-formula',
        label: '💚 HoT',
        autoValue: '',
        autoSource: 'Protection + Affliction',
        currentValue: s?.regenerationFormula,
        placeholder: 'ex : 2d4, 3d4...',
      })}
    </div>

    <!-- Enchantement — visible si rune Enchantement > 0 -->
    <div id="s-enchant-section" class="cs-spell-slot-box cs-spell-slot-box--ench" style="${hasEnchant?'':'display:none'}">
      <div class="cs-spell-slot-title">✨ Enchantement <span>Cible alliée · 2 tours</span></div>

      <input type="hidden" id="s-enchant-mode" value="${enchantModeForEdit}">

      <!-- Mode État : applique un état choisi à l'allié ciblé -->
      <div id="s-enchant-etat-block" class="form-group">
        <label>État appliqué à l'allié <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— buff/bénédiction ; durée selon l'état</span></label>
        <select class="input-field" id="s-enchant-etat">
          <option value="">— Aucun (effet libre uniquement) —</option>
        </select>
        <input type="hidden" id="s-enchant-etat-saved" value="${enchantEtatForEdit}">
        <div id="s-enchant-state-tuning" style="display:none;margin-top:.55rem">
          <div id="s-enchant-move-tune" style="display:none">
            ${_autoValHtml({
              fieldId: 's-enchant-state-move-bonus',
              label: '💨 Déplacement naturel',
              autoValue: '',
              autoSource: 'État + Amplification',
              currentValue: s?.enchantStateMoveBonus,
              placeholder: 'ex : 1, 2, 3...',
            })}
          </div>
          <div id="s-enchant-dmg-tune" style="display:none;margin-top:.45rem">
            ${_autoValHtml({
              fieldId: 's-enchant-state-dmg-formula',
              label: '✨ Dégâts naturels',
              autoValue: '',
              autoSource: 'État + Puissance',
              currentValue: s?.enchantStateDmgFormula,
              placeholder: 'ex : 1d4 +2, 2d4 +2...',
            })}
          </div>
        </div>
      </div>
      <!-- États supplémentaires : 1 sélecteur par rune Enchantement en plus.
           Chaque état est appliqué à l'allié, modulé par Puissance/Amplification/Durée. -->
      <div id="s-enchant-extra-slots"></div>
    </div>

    <!-- Affliction — visible si rune Affliction > 0 -->
    <div id="s-affliction-section" class="cs-spell-slot-box cs-spell-slot-box--aff" style="${runesSrc.includes('Affliction')?'':'display:none'}">
      <div class="cs-spell-slot-title">💀 Affliction <span>Cible ennemie · 2 tours · Action · effet selon la branche</span></div>

      <!-- Combo Sentinelle (Affliction + Invocation) : les branches ne s'appliquent pas -->
      <div id="s-affliction-sentinelle-note" style="${runesSrc.includes('Invocation')?'':'display:none'};font-size:.78rem;line-height:1.5;color:var(--text-muted);background:rgba(161,98,7,.1);border:1px solid rgba(161,98,7,.3);border-radius:8px;padding:.55rem .7rem">
        🪤 <strong style="color:#d9a441">Sentinelle</strong> — Affliction + Invocation : l'affliction est <strong>portée par la sentinelle invoquée</strong>. Les branches (DoT / État / Lacération) ne s'appliquent pas ici.
      </div>

      <!-- Branches d'Affliction — masquées quand c'est une Sentinelle -->
      <div id="s-affliction-modes" style="${runesSrc.includes('Invocation')?'display:none':''}">

      <!-- Mode toggle : DoT (dégâts/tour) · État · Lacération (CA cible + frappe) -->
      <div class="form-group">
        <label>Branche</label>
        <div class="cs-slot-grid" style="grid-template-columns:1fr 1fr 1fr">
          <button type="button" id="s-affliction-mode-dot"
            data-action="_selectAfflictionMode" data-val="dot"
            class="cs-slot-btn ${(s?.afflictionMode||'dot')==='dot'?'selected':''}">🩸 DoT</button>
          <button type="button" id="s-affliction-mode-etat"
            data-action="_selectAfflictionMode" data-val="etat"
            class="cs-slot-btn ${s?.afflictionMode==='etat'?'selected':''}">⛓ État</button>
          <button type="button" id="s-affliction-mode-laceration"
            data-action="_selectAfflictionMode" data-val="laceration"
            class="cs-slot-btn ${s?.afflictionMode==='laceration'?'selected':''}">🩸 Lacération</button>
        </div>
        <input type="hidden" id="s-affliction-mode" value="${s?.afflictionMode||'dot'}">
      </div>

      <!-- Slot legacy conservé en hidden pour rétro-compat des sorts existants -->
      <input type="hidden" id="s-affliction-slot" value="${s?.afflictionSlot||'torse'}">
      <input type="hidden" id="s-affliction-save-stat" value="${s?.afflictionSaveStat||''}">

      <!-- DoT mode : formule de dégâts par tour (auto + custom override) -->
      <div id="s-affliction-dot-block" style="${(s?.afflictionMode||'dot')==='dot'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-affliction-dot-formula',
          label: '⚔️ Dégâts du DoT par tour',
          autoValue:  _calcAfflictionDot(s || {}),
          autoSource: _autoSourceAfflictionDot(s || {}),
          currentValue: s?.afflictionDotFormula,
          placeholder: 'ex : 1d4 +2, 3d6, 2d8 +4…',
        })}
      </div>

      <!-- État mode : liste déroulante -->
      <div id="s-affliction-etat-block" class="form-group" style="${s?.afflictionMode==='etat'?'':'display:none'}">
        <label>État infligé sur échec <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— appliqué avec sa durée par défaut</span></label>
        <select class="input-field" id="s-affliction-etat">
          <option value="">— Aucun (effet libre uniquement) —</option>
        </select>
        <input type="hidden" id="s-affliction-etat-saved" value="${s?.afflictionEtatId||''}">
      </div>

      <!-- Lacération mode : frappe l'attaque de base + réduit la CA de la cible -->
      <div id="s-affliction-laceration-block" style="${s?.afflictionMode==='laceration'?'':'display:none'};font-size:.78rem;line-height:1.5;color:var(--text-muted);background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.22);border-radius:8px;padding:.55rem .7rem;margin-top:.4rem">
        🩸 <strong style="color:#f87171">Lacération</strong> — le sort inflige <strong>l'attaque de base</strong> et réduit la <strong>CA de la cible de −1 par rune Affliction</strong>, plafonné à <strong>−2</strong> (joueur) / <strong>−4</strong> (Élite-Boss), pendant 2 tours. Pas de DoT ni d'état.
      </div>
      </div><!-- /s-affliction-modes -->
    </div><!-- /s-affliction-section -->

    <!-- Rune Déclenchement — mode Réaction ou Action Bonus -->
    <div id="s-action-rune-section" style="${hasActionRune?'':'display:none'}">
      <div class="form-group">
        <label>⚡ Rune Déclenchement — timing</label>
        <div style="display:flex;gap:.4rem">${actionModeBtnsHtml}</div>
        <input type="hidden" id="s-action-mode" value="${actionMode}">
        <div style="font-size:.72rem;color:var(--text-dim);padding:.35rem .1rem 0">
          Les combos de Réaction se déclenchent uniquement avec le mode <b>Réaction</b>.
        </div>
      </div>
    </div>

    <!-- ⑨ Rune Amplification — mode Zone ou Déplacement (visible si rune présente) -->
    <div id="s-amp-section" style="${hasAmp && !hasEnchant?'':'display:none'}">
      <div class="form-group">
        <label>🌐 Rune Amplification — effet</label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'zone',        label:'📐 Zone',        color:'#b47fff', detail:'Zone alignée · 3N cases' },
            { v:'deplacement', label:'↔ Déplacement', color:'#e8b84b', detail:'Soi/cible · sans dégâts' },
          ].map(opt => {
            const sel = ampMode === opt.v;
            return `<button type="button" id="s-amp-${opt.v}" data-action="_selectAmpMode" data-val="${opt.v}"
              style="flex:1;padding:.45rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.78rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.65rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-amp-mode" value="${ampMode}">
      </div>

      <div id="s-amp-zone-section" style="${ampMode==='zone'?'':'display:none'}">
        <div style="font-size:.74rem;color:var(--text-dim);padding:.1rem .1rem .3rem">
          📐 Zone depuis les runes : sans Dispersion → <b>ligne 3N×1</b>. Combo <b>Amp + Dispersion</b> → <b>Amplification = hauteur</b>, <b>Dispersion = largeur</b> (chaque rune agrandit son axe).
        </div>
        <div id="s-amp-shape-row" class="form-group" style="${hasDisp?'':'display:none'}">
          <label style="font-size:.72rem">✚ Forme (combo Amplification + Dispersion)</label>
          <div style="font-size:.66rem;color:var(--text-dim);padding:0 .1rem .25rem;line-height:1.4">
            <b>Carré</b> = plus de cases (diagonales comprises). <b>Croix</b> = bras plus longs (6N−1) → frappe plus loin en ligne, mais sans les diagonales.
          </div>
          <div style="display:flex;gap:.4rem">
            ${[
              { v:'rect',  label:'▭ Rectangle / Carré', color:'#4f8cff' },
              { v:'cross', label:'✚ Croix',             color:'#a855f7' },
            ].map(o => {
              const sel = _zoneShapeEdit === o.v;
              return `<button type="button" data-action="_selectZoneShape" data-val="${o.v}"
                style="flex:1;padding:.42rem;border-radius:8px;cursor:pointer;transition:all .15s;
                border:2px solid ${sel?o.color:'var(--border)'};background:${sel?o.color+'18':'var(--bg-elevated)'};
                text-align:center;font-size:.75rem;font-weight:700;color:${sel?o.color:'var(--text-dim)'}">${o.label}</button>`;
            }).join('')}
          </div>
          <input type="hidden" id="s-zone-shape" value="${_zoneShapeEdit}">
        </div>
      </div>

      <div id="s-amp-depl-section" style="${ampMode==='deplacement'?'':'display:none'}">
        <div class="cs-spell-inline-row">
          <span class="cs-spell-inline-label">↔️ Type</span>
          <div style="display:flex;gap:.25rem;flex:1">${deplBtnsHtml}</div>
        </div>
        <div style="font-size:.74rem;color:var(--text-dim);padding:.25rem .1rem">
          Portée : <b id="s-amp-depl-range" style="color:var(--text)">1 à ${_ampLength(nbAmp) || 0} cases</b>
          <span> · selon le nombre de runes Amplification</span>
        </div>
        <div style="font-size:.7rem;color:#e8b84b;padding:0 .1rem .2rem">⚠ Les sorts de déplacement n'infligent pas de dégâts.</div>
      </div>
    </div>

    <!-- Invocation : choix d'invocations de la BIBLIOTHÈQUE (stats/actions créées à l'avance) -->
    <div id="s-invocation-section" class="cs-inv-section" style="${hasInvoc?'':'display:none'}">
      <div class="cs-inv-head">
        <span class="cs-inv-head-icon">🐾</span>
        <div class="cs-inv-head-text">
          <div class="cs-inv-head-title">Invocations</div>
          <div class="cs-inv-head-sub">Crée tes créatures dans la bibliothèque, puis choisis lesquelles ce sort invoque (1 par rune Invocation) via le bouton 🐾 sur la carte du sort.</div>
        </div>
      </div>
      <div class="cs-inv-pick-row">
        <button type="button" class="btn btn-outline btn-sm" data-action="openInvocationLibrary">🐾 Mes invocations</button>
        <span class="cs-inv-pick-note">${(_invOriginal?.ids?.length) ? `${_invOriginal.ids.length} sélectionnée(s)` : (_invOriginal?.stats ? 'Invocation héritée (legacy) — re-sélectionne via 🐾' : 'Aucune sélectionnée')}</span>
      </div>
    </div>

    </section><!-- /cs-spell-effects-panel -->
    </main>

    <aside class="cs-spell-side" aria-label="Résumé et réglages du sort">
      <div class="cs-spell-side-card cs-spell-side-card--preview">
        <div class="cs-spell-preview cs-spell-preview--sticky">
          <div class="cs-spell-preview-title">Résumé jouable <span class="cs-spell-preview-pm">Coût : <strong id="s-pm-display">0</strong> PM</span></div>
          <div id="s-pm-breakdown" class="cs-pmbd"></div>
          <div id="s-preview-body" class="cs-spell-preview-body"></div>
          <input type="hidden" id="s-pm" value="${s?.pm||2}">
        </div>
      </div>

      <details class="cs-spell-advanced" open>
        <summary><span>Réglages</span><small>Durée et portée optionnelles</small></summary>
        <div class="cs-spell-advanced-body">

    <!-- ⑧ Durée — auto-calculée (base 2 tours + Durée scalée), override possible.
         Visible pour tous les sorts persistants (Enchant, Affliction, Protection CA, rune Durée). -->
    <div id="s-duree-base-section" class="cs-duree-section" style="${_needsDureeBase(s)?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-duree-base',
        label: '⏳ Durée (tours)',
        autoValue:  String(_calcSortDuree(s || {})),
        autoSource: _autoSourceDuree(s || {}),
        currentValue: s?.dureeBase,
        placeholder: 'ex : 5',
      })}
    </div>

    <!-- ⑧b Portée — override de la portée de l'arme (laisser vide = portée d'arme) -->
    <div class="form-group cs-spell-side-setting">
      <label>🎯 Portée <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">cases — laisser vide pour utiliser la portée de l'arme</span></label>
      <div style="display:flex;gap:.4rem;align-items:center">
        <input type="number" class="input-field" id="s-portee" min="0" max="50"
          value="${s?.portee != null ? s.portee : ''}" placeholder="auto (arme)" style="width:100px;text-align:center;padding:.3rem">
        <span style="font-size:.8rem;color:var(--text-dim)">cases</span>
      </div>
    </div>

        </div>
      </details>

      <details class="cs-spell-advanced cs-spell-advanced--mj" ${STATE.isAdmin ? 'open' : ''}>
        <summary><span>Validation MJ</span><small>Statut, notes et exceptions</small></summary>
        <div class="cs-spell-advanced-body">

    <!-- ⑩ Limites MJ (équilibrage + overrides) -->
    <div class="cs-mj-limits">
      <div class="cs-mj-limits-title">🔒 Limites MJ <span>— équilibrage des combos & overrides</span></div>

      <!-- Validation MJ : 3 états (admins) / badge lecture seule (joueurs) -->
      ${(() => {
        const vs = _sortValidationState(s);
        if (STATE.isAdmin) {
          const seg = (val, label) => `<button type="button" class="cs-mjval-btn cs-mjval-btn--${val} ${vs===val?'is-active':''}" data-mjval="${val}" data-action="_csSetMjVal">${label}</button>`;
          return `<div class="cs-mjval-block">
            <div class="cs-mjval-block-title">Validation MJ <span>— statut de ce sort</span></div>
            <input type="hidden" id="s-mj-validation" value="${vs}">
            <div class="cs-mjval-seg">
              ${seg('ok', '✅ Validé')}
              ${seg('pending', '⏳ En attente')}
              ${seg('no', '❌ Refusé')}
            </div>
          </div>`;
        }
        const lbl = vs === 'ok' ? '✅ Sort validé par le MJ'
                  : vs === 'no' ? '❌ Sort refusé par le MJ'
                  : '⏳ En attente de validation du MJ';
        return `<div class="cs-mjval-readonly cs-mjval-readonly--${vs}">${lbl}</div>`;
      })()}

      <div class="form-group" style="margin-bottom:.5rem">
        <label style="font-size:.72rem">Notes / restrictions <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(affichées dans la fiche)</span></label>
        <textarea class="input-field" id="s-mj-notes" rows="2" placeholder="ex : soin va uniquement au lanceur">${s?.mjNotes||''}</textarea>
      </div>

      ${STATE.isAdmin ? `
      <div class="form-group" style="margin-bottom:.5rem">
        <label style="font-size:.72rem">Coût PM personnalisé <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(MJ — vide = auto selon runes ; set léger appliqué par-dessus, jamais en dessous de 0)</span></label>
        <input type="number" class="input-field" id="s-pm-override" min="0" max="50"
          value="${s?.pmOverride ?? ''}" placeholder="auto"
          style="max-width:120px">
      </div>
      <div class="cs-mj-validation cs-mj-validation--max ${s?.mjAlwaysMax?'is-on':''}">
        <input type="checkbox" id="s-mj-always-max" ${s?.mjAlwaysMax?'checked':''}
          data-change="_csMjValToggle">
        <label for="s-mj-always-max" class="cs-mj-validation-label">
          <span class="cs-mj-validation-switch"><span class="cs-mj-validation-thumb"></span></span>
          <span class="cs-mj-validation-info">
            <span class="cs-mj-validation-title">🎲 Toujours valeur maximum</span>
            <span class="cs-mj-validation-sub">Les dés tirent leur valeur max (1d6 = 6, 2d4+2 = 10) — potions, objets à effet fixe</span>
          </span>
          <span class="cs-mj-validation-state"></span>
        </label>
      </div>
      <div class="cs-mj-validation cs-mj-validation--autohit ${s?.mjAutoHit?'is-on':''}">
        <input type="checkbox" id="s-mj-auto-hit" ${s?.mjAutoHit?'checked':''}
          data-change="_csMjValToggle">
        <label for="s-mj-auto-hit" class="cs-mj-validation-label">
          <span class="cs-mj-validation-switch"><span class="cs-mj-validation-thumb"></span></span>
          <span class="cs-mj-validation-info">
            <span class="cs-mj-validation-title">✅ Réussite automatique (sans jet)</span>
            <span class="cs-mj-validation-sub">Pas de jet de toucher : le sort réussit toujours (évite les échecs critiques — potions, soins, buffs à effet garanti)</span>
          </span>
          <span class="cs-mj-validation-state"></span>
        </label>
      </div>` : ''}
    </div>
        </div>
      </details>

    </aside>
   </div><!-- /cs-spell-layout -->

   </div><!-- /cs-spell-forge -->
    </div><!-- /sh-admin-body -->
    <div class="sh-admin-footer">
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-gold btn-sm" data-action="saveSort" data-idx="${idx}">💾 Enregistrer le sort</button>
    </div>
   </div><!-- /sh-admin-modal -->
  `);

  setTimeout(() => {
    updateSortPM();
    // Applique l'état initial des sections conditionnelles (Dégâts/Soin/CA, Drain,
    // Invocation…) dès l'ouverture — sinon un sort déjà Drain affichait les onglets
    // CA/Soin tant qu'on n'avait pas interagi.
    _refreshConditionalSections();
    _updateSortPreview();
    // Listeners génériques pour rafraîchir la preview à chaque saisie
    const modal = document.querySelector('.modal');
    if (modal && !modal.dataset.previewBound) {
      modal.dataset.previewBound = '1';
      modal.addEventListener('input', (event) => {
        if (event.target?.id === 's-nom') _setSortNameRequiredError(false);
        _updateSortPreview();
      });
      modal.addEventListener('change', _updateSortPreview);
      modal.addEventListener('change', (event) => {
        if (event.target?.id === 's-enchant-etat') _refreshEnchantStateTuning();
      });
      // Emoji perso : Entrée dans le champ applique l'emoji saisi.
      modal.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 's') {
          event.preventDefault();
          const saveBtn = modal.querySelector('[data-action="saveSort"]');
          if (saveBtn && !saveBtn.disabled) saveSort(Number(saveBtn.dataset.idx));
          return;
        }
        if (event.target?.id === 's-icon-custom' && event.key === 'Enter') {
          event.preventDefault(); _applyCustomSortIcon();
        }
      });
    }
    if (idx < 0) {
      const nameEl = document.getElementById('s-nom');
      nameEl?.focus();
      nameEl?.select?.();
    }
    // Populate les listes déroulantes d'état (affliction + enchantement).
    // Au chargement initial, le dropdown n'a que l'option "— Aucun —" : la valeur
    // saved-etat-id n'est pas encore "sélectionnée" dans le <select>. Après async
    // populate, on re-render la preview pour qu'elle reflète l'état choisi.
    Promise.all([
      _populateAfflictionEtatSelect(),
      _populateEnchantEtatSelect(),
      _renderEnchantExtraSlots(),
    ]).then(() => {
      _refreshEnchantStateTuning();
      _updateSortPreview();
      // Garde anti-perte : baseline après stabilisation (dropdowns peuplés).
      // Uniquement pour la forge de perso (le path item est empilé sur la boutique).
      if (!_itemEditCtx) {
        _sortModalBaseline = _snapshotSortModal();
        if (_sortEditWasOk) { try { _sortEditContentBaseline = _sortContentSig(_buildSortFromDOM()); } catch { _sortEditContentBaseline = null; } }
        setModalCloseGuard(_sortModalCloseGuard);
      }
    });
  }, 50);
}

// Cache des états en mémoire pour éviter de retaper Firestore à chaque dropdown
let _conditionsLibCache = null;

/** Source unique : lit world/conditions dans Firestore via le module partagé. */
async function _loadAllConditions() {
  if (_conditionsLibCache) return _conditionsLibCache;
  _conditionsLibCache = await loadConditionLibrary();
  setConditionsLibCache(_conditionsLibCache); // alimente aussi le cache de spells-calc.js
  return _conditionsLibCache;
}

function _conditionSupportsSpellUsage(condition, usage) {
  const su = condition?.spellUsage;
  if (!su || typeof su !== 'object') return true; // compat anciens états avant migration
  return usage === 'enchantment' ? !!su.enchantment : !!su.affliction;
}

/** Remplit un <select> d'état (Enchantement OU Affliction) depuis la BDD. */
async function _populateConditionSelect(selectId, savedHiddenId, usage) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const savedVal = document.getElementById(savedHiddenId)?.value || '';
  const lib = await _loadAllConditions();
  const filtered = lib.filter(c => _conditionSupportsSpellUsage(c, usage) || c.id === savedVal);
  if (!lib.length) {
    sel.innerHTML = `<option value="">⚠️ Aucun état en BDD — ouvrir le VTT une fois pour initialiser</option>`;
    return;
  }
  if (!filtered.length) {
    sel.innerHTML = `<option value="">— Aucun état compatible —</option>`;
    return;
  }
  sel.innerHTML = `<option value="">— Aucun —</option>`
    + filtered.map(c => `<option value="${c.id}" ${c.id===savedVal?'selected':''}>${c.icon||''} ${c.label}</option>`).join('');
}

function _populateEnchantEtatSelect()    { return _populateConditionSelect('s-enchant-etat', 's-enchant-etat-saved', 'enchantment'); }

// États d'enchantement SUPPLÉMENTAIRES : 1 sélecteur par rune Enchantement en plus
// du premier. Idempotent (ne reconstruit que si le nombre change → préserve les choix).
async function _renderEnchantExtraSlots() {
  const container = document.getElementById('s-enchant-extra-slots');
  if (!container) return;
  const needed = Math.max(0, (_runeCountsEdit?.Enchantement || 0) - 1);   // le 1er état = s-enchant-etat
  const existing = container.querySelectorAll('select.s-enchant-extra').length;
  if (existing === needed && container.dataset.rendered === '1') return;   // rien à refaire
  const cur = [...container.querySelectorAll('select.s-enchant-extra')].map(s => s.value);
  const saved = (i) => cur[i] ?? _enchantExtraSavedEdit[i] ?? '';
  container.dataset.rendered = '1';
  if (needed === 0) { container.innerHTML = ''; return; }
  container.innerHTML = Array.from({ length: needed }, (_, i) => `
    <div class="form-group" style="margin-top:.55rem">
      <label>État supplémentaire ${i + 2} <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— rune Enchantement n°${i + 2} · modulé par les runes</span></label>
      <select class="input-field s-enchant-extra" id="s-enchant-etat-${i + 1}">
        <option value="">— Aucun —</option>
      </select>
      <input type="hidden" id="s-enchant-etat-${i + 1}-saved" value="${_esc(saved(i))}">
    </div>`).join('');
  for (let i = 0; i < needed; i++) {
    await _populateConditionSelect(`s-enchant-etat-${i + 1}`, `s-enchant-etat-${i + 1}-saved`, 'enchantment');
  }
}
// Liste ordonnée des états d'enchantement choisis (1er + supplémentaires non vides).
function _collectEnchantEtatIds() {
  const ids = [];
  const first = document.getElementById('s-enchant-etat')?.value || '';
  if (first) ids.push(first);
  document.querySelectorAll('#s-enchant-extra-slots select.s-enchant-extra').forEach(sel => {
    if (sel.value) ids.push(sel.value);
  });
  return ids;
}
function _populateAfflictionEtatSelect() { return _populateConditionSelect('s-affliction-etat', 's-affliction-etat-saved', 'affliction'); }

function _refreshEnchantStateTuning() {
  const wrap = document.getElementById('s-enchant-state-tuning');
  if (!wrap) return;
  const id = document.getElementById('s-enchant-etat')?.value || '';
  const condition = id ? _conditionsLibCache?.find(c => c.id === id) : null;
  const effects = condition?.effects || {};
  const hasMove = effects.movementBonus != null;
  const hasDmg = !!effects.dmgDealtBonus;
  const move = document.getElementById('s-enchant-move-tune');
  const dmg = document.getElementById('s-enchant-dmg-tune');
  if (move) move.style.display = hasMove ? '' : 'none';
  if (dmg) dmg.style.display = hasDmg ? '' : 'none';
  wrap.style.display = (hasMove || hasDmg) ? '' : 'none';
  _refreshAutoValChips();
  _collapseEnchantStateAutoIfMatching('s-enchant-state-move-bonus');
  _collapseEnchantStateAutoIfMatching('s-enchant-state-dmg-formula');
}

function _collapseEnchantStateAutoIfMatching(fieldId) {
  const input = document.getElementById(fieldId);
  const auto = document.getElementById(`${fieldId}-autoval`);
  const edit = document.getElementById(`${fieldId}-edit`);
  const display = document.getElementById(`${fieldId}-display`);
  const wrap = display?.parentElement;
  if (!input || !auto || !edit || !display || !wrap) return;
  if (!input.value.trim()) return;
  if (input.value.trim() !== auto.textContent.trim()) return;
  input.value = '';
  edit.style.display = 'none';
  display.style.display = '';
  wrap.classList.remove('is-custom');
}

function _calcEnchantStateMoveAuto(s) {
  const id = s?.enchantEtatId || '';
  const condition = id ? _conditionsLibCache?.find(c => c.id === id) : null;
  const baseRaw = condition?.effects?.movementBonus;
  if (baseRaw == null) return '';
  const base = Number.isFinite(parseInt(baseRaw)) ? parseInt(baseRaw) : 0;
  const nbAmp = (s?.runes || []).filter(r => r === 'Amplification').length;
  return String(base + nbAmp);
}

function _calcEnchantStateDmgAuto(s) {
  const id = s?.enchantEtatId || '';
  const condition = id ? _conditionsLibCache?.find(c => c.id === id) : null;
  if (!condition?.effects?.dmgDealtBonus) return '';
  const nbP = (s?.runes || []).filter(r => r === 'Puissance').length;
  return `${1 + nbP}d4 +2`;
}

function _isRegenerationComboActive(counts = _runeCountsEdit) {
  return (counts?.Protection || 0) > 0
    && (counts?.Affliction || 0) > 0
    && (document.getElementById('s-affliction-mode')?.value || 'dot') !== 'laceration';
}

function _isCoupChanceComboActive(counts = _runeCountsEdit) {
  const actionMode = document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction';
  const hasReaction = (counts?.Réaction || 0) > 0
    || ((counts?.[ACTION_RUNE] || 0) > 0 && actionMode === 'reaction');
  return (counts?.Chance || 0) > 0 && hasReaction;
}

function _calcRegenerationAuto(s) {
  const runes = s?.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const nbAff = runes.filter(r => r === 'Affliction').length;
  return nbProt > 0 && nbAff > 0 ? `${nbProt + nbAff}d4` : '';
}

/** Re-style les boutons de type + ajuste la visibilité des sections conditionnelles. */
function _applyTypeChange() {
  const TYPE_CFG = {
    offensif:   '#ff6b6b',
    defensif:   '#22c38e',
    utilitaire: '#b47fff',
  };
  Object.entries(TYPE_CFG).forEach(([t, color]) => {
    const btn = document.getElementById(`s-type-${t}`);
    if (!btn) return;
    const active = _sortTypesEdit.has(t);
    btn.style.borderColor  = active ? color : 'var(--border)';
    btn.style.background   = active ? color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
  _refreshConditionalSections();
  _updateSortPreview();
}

/** Met à jour la visibilité des sections Dégâts/Soin selon types + runes + mode protection.
 *  Soin n'apparaît que si le mode Protection est explicitement 'soin' (ne s'affiche jamais
 *  en mode CA pour éviter la confusion avec le Bouclier réactif).
 */
function _refreshConditionalSections() {
  const isOffensive = _sortTypesEdit.has('offensif');
  const isSupport   = _sortTypesEdit.has('defensif');
  const counts      = _runeCountsEdit || {};
  const hasProt     = (counts.Protection || 0) > 0;
  const hasAmp      = (counts.Amplification || 0) > 0;
  const hasEnchant  = (counts.Enchantement || 0) > 0;
  const hasAffliction = (counts.Affliction || 0) > 0;
  const protMode    = document.getElementById('s-prot-mode')?.value || 'ca';
  const ampMode     = document.getElementById('s-amp-mode')?.value || 'zone';
  const isDepl      = ampMode === 'deplacement';
  const isCoupChance = _isCoupChanceComboActive(counts);
  const dSec = document.getElementById('s-degats-section');
  const sSec = document.getElementById('s-soin-section');
  // Affliction supprime les dégâts d'impact : la rune Puissance scale le DoT
  // de l'affliction, pas un dégât direct. Le mode Déplacement les supprime aussi.
  // Invocation : le sort n'a pas de dégâts propres (la créature frappe) → masque
  // la section Dégâts même en offensif (Puissance scale l'attaque de l'invocation).
  const anyInvoc = (counts.Invocation || 0) > 0;
  // Branche Lacération d'Affliction (ou legacy rune) : frappe toujours l'attaque
  // de base → section Dégâts visible même si « offensif » n'est pas coché, et
  // l'affliction n'est PAS en suppression d'impact dans ce mode.
  const _afflMode = document.getElementById('s-affliction-mode')?.value || 'dot';
  const isLaceration = (counts.Lacération || 0) > 0 || (hasAffliction && _afflMode === 'laceration');
  const isRegen = _isRegenerationComboActive(counts);
  const hasAfflictionDebuff = hasAffliction && _afflMode !== 'laceration';
  if (dSec) dSec.style.display = ((isOffensive || isLaceration) && !isCoupChance && !hasAfflictionDebuff && !isDepl && !anyInvoc) ? '' : 'none';
  // Combo Drain : sort offensif + Protection → la Protection devient un vol de vie %.
  // On masque alors le choix CA/Soin et leurs montants, et on affiche l'indicateur.
  const isDrain   = isOffensive && hasProt;
  const isAmpSupportHeal = isSupport && hasAmp && !isDepl && !hasProt;
  const protSec = document.getElementById('s-prot-section');
  const affSec = document.getElementById('s-affliction-section');
  const regenSec = document.getElementById('s-regeneration-section');
  const enchantSec = document.getElementById('s-enchant-section');
  const ampSec = document.getElementById('s-amp-section');
  const affModes = document.getElementById('s-affliction-modes');
  const protGroup = document.getElementById('s-prot-mode-group');
  const caSec     = document.getElementById('s-ca-section');
  const drainEl   = document.getElementById('s-prot-drain');
  if (protSec) protSec.style.display = (hasProt && !isRegen) ? '' : 'none';
  if (affSec)  affSec.style.display  = (hasAffliction && !isRegen) ? '' : 'none';
  if (regenSec)  regenSec.style.display  = isRegen ? '' : 'none';
  if (enchantSec) enchantSec.style.display = hasEnchant ? '' : 'none';
  if (hasEnchant) _renderEnchantExtraSlots();   // (re)génère 1 select par rune Enchantement en plus
  // Avec Enchantement, l'Amplification BOOSTE l'effet (portée/déplacement de l'état) :
  // pas de choix de mode zone/déplacement → on masque la section et on force « zone ».
  if (ampSec) ampSec.style.display = (hasAmp && !hasEnchant) ? '' : 'none';
  if (hasEnchant) {
    const ampHidden = document.getElementById('s-amp-mode');
    if (ampHidden && ampHidden.value !== 'zone') ampHidden.value = 'zone';
  }
  if (affModes)  affModes.style.display  = isRegen ? 'none' : '';
  if (protGroup) protGroup.style.display = (isDrain || isRegen) ? 'none' : '';
  if (caSec)     caSec.style.display     = (!isDrain && !isRegen && protMode === 'ca') ? '' : 'none';
  if (sSec)      sSec.style.display      = (!isDrain && !isRegen && ((hasProt && protMode === 'soin') || isAmpSupportHeal)) ? '' : 'none';
  if (drainEl) {
    drainEl.style.display = isDrain ? '' : 'none';
    if (isDrain) {
      const pctEl = document.getElementById('s-prot-drain-pct');
      if (pctEl) pctEl.textContent = Math.round((0.25 + 0.25 * (counts.Protection || 0)) * 100);
    }
  }
  // Section Invocation générique : rune Invocation seule (hors combos Sentinelle/Arme invoquée)
  const hasInvoc = anyInvoc && !(counts.Affliction > 0) && !(counts.Enchantement > 0);
  const iSec = document.getElementById('s-invocation-section');
  if (iSec) iSec.style.display = hasInvoc ? '' : 'none';
  if (hasInvoc) _refreshInvocationDerived();
  const empty = document.getElementById('s-effects-empty');
  if (empty) {
    const visibleIds = [
      's-degats-section', 's-prot-section', 's-soin-section', 's-regeneration-section',
      's-allonge-section', 's-enchant-section', 's-affliction-section', 's-action-rune-section',
      's-amp-section', 's-invocation-section',
    ];
    const hasVisible = visibleIds.some(id => {
      const el = document.getElementById(id);
      return el && el.style.display !== 'none';
    });
    empty.style.display = hasVisible ? 'none' : '';
  }
}

function _toggleSortType(type) {
  if (_sortTypesEdit.has(type)) _sortTypesEdit.delete(type);
  else _sortTypesEdit.add(type);
  _applyTypeChange();
}

// ── Configuration de l'invocation (modale depuis la carte du sort) ─────────────
//    Les actions = vrais sorts, édités via la modale de sort complète
//    (editItemSpell). La modale de config N'EST PAS un éditeur de sort → ouvrir
//    l'éditeur d'action par-dessus ne crée aucun conflit d'état (pattern boutique).
function _invCfgSort() {
  const c = STATE.activeChar;
  return c ? (c.deck_sorts || [])[_invCfgIdx] : null;
}
// Bouton 🐾 de la carte du sort → SÉLECTEUR d'invocations de la bibliothèque.
export function openInvocationConfig(idx) {
  const c = STATE.activeChar; if (!c) return;
  const s = (c.deck_sorts || [])[idx]; if (!s) return;
  _invCfgIdx = idx;
  _itemEditCtx = null;
  openModal(`🐾 Invocations — ${_esc(s.nom || 'Sort')}`, _renderInvSelectBody());
}
function _invSelTitle() { const s = _invCfgSort(); return `🐾 Invocations — ${_esc(s?.nom || 'Sort')}`; }
function _renderInvSelectBody() {
  const s = _invCfgSort(); if (!s) return '<div style="padding:1rem">Sort introuvable.</div>';
  const nbInv = (s.runes || []).filter(r => r === 'Invocation').length || 1;
  const lib = _libInvs();
  if (!s.invocation || typeof s.invocation !== 'object' || !Array.isArray(s.invocation.ids)) {
    s.invocation = { ids: Array.isArray(s.invocation?.ids) ? s.invocation.ids : [] };
  }
  const sel = s.invocation.ids;
  const selCount = sel.filter(id => lib.some(iv => iv.id === id)).length;
  const cards = lib.map(iv => {
    const on = sel.includes(iv.id);
    const full = !on && selCount >= nbInv;
    return `<button class="cs-invsel-card${on?' is-on':''}" data-action="_toggleInvSelect" data-id="${iv.id}" ${full?'disabled':''}>
      <span class="cs-invsel-portrait">${iv.image ? `<img src="${iv.image}" alt="">` : '🐾'}</span>
      <span class="cs-invsel-body"><span class="cs-invsel-name">${_esc(iv.nom || 'Invocation')}</span>
      <span class="cs-invsel-stats">❤️ ${iv.stats?.pv ?? '?'} · 🛡️ ${iv.stats?.ca ?? 10} · ⚔️ ${_esc(iv.stats?.attaque || '1d4 +2')}</span></span>
      <span class="cs-invsel-check">${on ? '✓' : '+'}</span>
    </button>`;
  }).join('');
  return `<div class="cs-invsel">
    <div class="cs-invsel-hd">Choisis jusqu'à <b>${nbInv}</b> invocation${nbInv>1?'s':''} (1 par rune Invocation) — <b>${selCount}/${nbInv}</b> sélectionnée(s)</div>
    ${lib.length ? `<div class="cs-invsel-list">${cards}</div>`
      : `<div class="cs-invsel-empty">Aucune invocation en bibliothèque.<br><button class="btn btn-gold btn-sm" data-action="openInvocationLibrary" style="margin-top:.5rem">🐾 Créer une invocation</button></div>`}
    <div class="cs-invsel-foot">
      <button class="btn btn-outline btn-sm" data-action="openInvocationLibrary">🐾 Gérer la bibliothèque</button>
      <button class="btn btn-gold" data-action="closeModalDirect">Terminé</button>
    </div>
  </div>`;
}
async function _toggleInvSelect(id) {
  const c = STATE.activeChar; const s = _invCfgSort(); if (!s) return;
  const nbInv = (s.runes || []).filter(r => r === 'Invocation').length || 1;
  let ids = Array.isArray(s.invocation?.ids) ? [...s.invocation.ids] : [];
  if (ids.includes(id)) ids = ids.filter(x => x !== id);
  else { if (ids.length >= nbInv) return; ids.push(id); }
  s.invocation = { ids };
  await trySave('characters', c.id, { deck_sorts: c.deck_sorts });
  updateModalContent(_invSelTitle(), _renderInvSelectBody());
  _sortsRerender?.();
}
function _refreshInvocationConfig() {
  const s = _invCfgSort(); if (!s) return;
  updateModalContent(`🐾 Invocation — ${_esc(s.nom || 'Sort')}`, _renderInvocationConfigBody());
}
function _renderInvocationConfigBody() {
  const s = _invCfgSort(); if (!s) return '<div style="padding:1rem">Sort introuvable.</div>';
  const iv  = _calcInvocationStats(s);
  const img = s.invocation?.image;
  const acts = Array.isArray(s.invocation?.actions) ? s.invocation.actions : [];
  const _invCalcChar = _invocationCalcChar(s); // base de calcul = attaque de la créature
  const dureeStr = iv.concentration ? 'Concentration' : `${iv.duree} tour${iv.duree>1?'s':''}`;
  return `
    <div class="inv-cfg">
      <div class="inv-cfg-head">
        <div class="inv-cfg-portrait">${img ? `<img src="${img}" alt="">` : '<span>🐾</span>'}</div>
        <div class="inv-cfg-vitals">
          <span class="inv-cfg-vital">❤️ <b>${iv.pv}</b> PV</span>
          <span class="inv-cfg-vital">🛡️ CA <b>${iv.ca}</b></span>
          <span class="inv-cfg-vital">⚔️ <b>${_esc(iv.attaque)}</b> · +${iv.toucher}</span>
          <span class="inv-cfg-vital">👢 <b>${iv.deplacement}</b></span>
          <span class="inv-cfg-vital">⏱️ <b>${dureeStr}</b></span>
        </div>
      </div>
      <div class="inv-cfg-hint">Les stats et l'image se règlent dans l'éditeur du sort. Ici, conçois les <b>actions</b> de la créature — chacune s'édite avec la modale de sort complète (runes, dégâts, effets…).</div>
      <div class="inv-cfg-actions-hd">
        <span>🎬 Actions de la créature</span>
        <button class="btn btn-gold btn-sm" data-action="_invCfgAddAction">＋ Nouvelle action</button>
      </div>
      <div class="inv-cfg-list">
        ${acts.length ? acts.map((a, ai) => {
          // Dégâts calculés sur la base de l'ATTAQUE de la créature (pas l'arme du perso)
          const _off = _getSortTypes(a).includes('offensif') || _hasLaceration(a);
          const _dmg = _off ? _calcSortDegats(a, _invCalcChar) : '';
          const _meta = [
            _dmg ? `🎲 ${_esc(_dmg)}` : '',
            Array.isArray(a.runes) && a.runes.length ? `${a.runes.length} rune${a.runes.length>1?'s':''}` : 'sans rune',
            a.pm ? `${a.pm} PM` : '',
          ].filter(Boolean).join(' · ');
          return `
          <div class="inv-cfg-act">
            <div class="inv-cfg-act-main" data-action="_invCfgEditAction" data-aidx="${ai}">
              <span class="inv-cfg-act-name">🎬 ${_esc(a.nom || 'Action')}</span>
              <span class="inv-cfg-act-meta">${_meta}</span>
            </div>
            <button class="btn-icon" data-action="_invCfgEditAction" data-aidx="${ai}" title="Modifier">✏️</button>
            <button class="btn-icon" data-action="_invCfgDeleteAction" data-aidx="${ai}" title="Supprimer">🗑️</button>
          </div>`;
        }).join('') : '<div class="inv-cfg-empty">Aucune action. Crée la première attaque ou capacité de la créature.</div>'}
      </div>
      <div class="inv-cfg-foot">
        <button class="btn btn-outline" data-action="closeModalDirect">Fermer</button>
      </div>
    </div>`;
}
// Contexte de calcul "créature" : ses actions se basent sur l'ATTAQUE de
// l'invocation (ex. 1d4 +2), pas sur l'arme du personnage. On fabrique un perso
// virtuel neutre (stats 10 → mod 0) dont l'arme principale = l'attaque de la créature.
function _invocationCalcChar(invSort) {
  const iv = _calcInvocationStats(invSort || {});
  return {
    id: '__invocationCalc',
    nom: invSort?.nom ? `Créature (${invSort.nom})` : 'Créature invoquée',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': {
      nom: 'Attaque de la créature', degats: iv.attaque,
      statAttaque: 'force', toucherStat: 'force', degatsStat: 'force',
      portee: 1, isDefault: true,
    } },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [], elements: [],
  };
}
function _invCfgAddAction() {
  const s = _invCfgSort(); if (!s) return;
  if (!s.invocation) s.invocation = {};
  if (!Array.isArray(s.invocation.actions)) s.invocation.actions = [];
  editItemSpell({ actions: s.invocation.actions }, -1, _invCfgOnActionSave, _invocationCalcChar(s));
}
function _invCfgEditAction(aidx) {
  const s = _invCfgSort(); if (!s?.invocation?.actions) return;
  editItemSpell({ actions: s.invocation.actions }, parseInt(aidx), _invCfgOnActionSave, _invocationCalcChar(s));
}
async function _invCfgOnActionSave(holder) {
  const c = STATE.activeChar, s = _invCfgSort(); if (!c || !s) return;
  if (!s.invocation) s.invocation = {};
  s.invocation.actions = holder.actions;
  await trySave('characters', c.id, { deck_sorts: c.deck_sorts });
  _refreshInvocationConfig();       // la modale de config est déjà restaurée (popModal)
}
async function _invCfgDeleteAction(aidx) {
  const c = STATE.activeChar, s = _invCfgSort(); if (!c || !s?.invocation?.actions) return;
  if (!await confirmModal('Supprimer cette action ?')) return;
  s.invocation.actions.splice(parseInt(aidx), 1);
  await trySave('characters', c.id, { deck_sorts: c.deck_sorts });
  _refreshInvocationConfig();
}
// Bloc image : aperçu + boutons (mode normal). Le cropper inline remplace ce
// contenu pendant le cadrage (cf. _invStartCrop).
function _renderInvImageBlock() {
  return `
    <div class="cs-inv-img-preview">${_invImageEdit ? `<img src="${_invImageEdit}" alt="">` : '<span>🐾</span>'}</div>
    <div class="cs-inv-img-actions">
      <button type="button" class="btn btn-outline btn-sm" data-action="_invPickImage">${_invImageEdit ? '🔄 Changer' : '⬆ Image'}</button>
      ${_invImageEdit ? `<button type="button" class="btn btn-outline btn-sm" data-action="_invClearImage">✕</button>` : ''}
    </div>`;
}
function _refreshInvImageBlock() {
  const el = document.getElementById('s-inv-img-block');
  if (el) el.innerHTML = _renderInvImageBlock();
}
function _invPickImage() {
  pickImageFile({ onImage: ({ dataUrl }) => _invStartCrop(dataUrl) });
}
// Cadrage INLINE (pas de modale imbriquée → aucune perte de saisie de l'éditeur)
function _invStartCrop(dataUrl) {
  const host = document.getElementById('s-inv-img-block'); if (!host) return;
  host.innerHTML = `
    ${panZoomCropHTML({ idPrefix: 'inv-crop', viewSize: 200 })}
    <div class="cs-inv-crop-actions">
      <button type="button" class="btn btn-outline btn-sm" data-action="_invCropCancel">Annuler</button>
      <button type="button" class="btn btn-gold btn-sm" data-action="_invCropSave">✅ Valider</button>
    </div>`;
  requestAnimationFrame(() => {
    _invCrop?.destroy?.();
    _invCrop = attachPanZoomCrop({ idPrefix: 'inv-crop', dataUrl, viewSize: 200, outputSize: 256 });
  });
}
function _invCropSave() {
  const b64 = _invCrop?.getBase64();
  _invCrop?.destroy?.(); _invCrop = null;
  if (b64) {
    _invImageEdit = b64;
    const hid = document.getElementById('s-inv-image'); if (hid) hid.value = b64;
  }
  _refreshInvImageBlock();
  _updateSortPreview();
}
function _invCropCancel() {
  _invCrop?.destroy?.(); _invCrop = null;
  _refreshInvImageBlock();
}
function _invClearImage() {
  _invImageEdit = '';
  const hid = document.getElementById('s-inv-image'); if (hid) hid.value = '';
  _refreshInvImageBlock();
  _updateSortPreview();
}
// Met à jour les placeholders (valeurs dérivées) selon les runes courantes.
function _refreshInvocationDerived() {
  const runes = _buildRunesFromCounts();
  const d = _calcInvocationStats({ runes });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.placeholder = String(val); };
  set('s-inv-attaque', d.attaque); set('s-inv-toucher', d.toucher); set('s-inv-pv', d.pv);
  set('s-inv-ca', d.ca); set('s-inv-deplacement', d.deplacement); set('s-inv-duree', d.duree);
}
// Invocation du sort = SÉLECTION d'invocations de la bibliothèque (édit via 🐾 sur
// la carte). L'éditeur de sort ne fait que PRÉSERVER la sélection/legacy existante
// (null si pas de rune Invocation).
function _buildInvocationFromDOM() {
  if (!((_runeCountsEdit?.Invocation || 0) > 0)) return null;
  if (_invOriginal && Array.isArray(_invOriginal.ids)) return { ids: [..._invOriginal.ids] };
  // Rétro-compat : ancien sort avec invocation "inline" (stats/actions) → préservée telle quelle.
  if (_invOriginal && _invOriginal.stats) return _invOriginal;
  return { ids: [] };
}

// ══════════════════════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE D'INVOCATIONS (par personnage : c.invocations[])
// Chaque invocation = instance unique { id, nom, image, stats:{attaque,toucher,pv,
// ca,deplacement,pmMax}, actions:[], currentHp, currentPm }. La rune Invocation
// d'un sort en SÉLECTIONNE (≤ nbInv). Stats finales au lancement = base + bonus de
// runes (_calcSummonStats, côté VTT). Les PV/PM courants persistent entre apparitions.
// ══════════════════════════════════════════════════════════════════════════════
let _libInvIdx = -1; // index de l'invocation de la bibliothèque en cours d'édition

function _libInvs() { return Array.isArray(STATE.activeChar?.invocations) ? STATE.activeChar.invocations : []; }
function _libInvCurrent() { return _libInvs()[_libInvIdx] || null; }
function _invUuid() { return 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
async function _saveLibInvs() {
  const c = STATE.activeChar; if (!c) return;
  await trySave('characters', c.id, { invocations: c.invocations || [] });
}

// ── Manager : liste des invocations du perso ──────────────────────────────────
export function openInvocationLibrary() {
  const c = STATE.activeChar; if (!c) return;
  if (!Array.isArray(c.invocations)) c.invocations = [];
  _libInvIdx = -1;
  openModal('🐾 Mes invocations', _renderInvLibraryBody());
}
function _refreshInvLibrary() { updateModalContent('🐾 Mes invocations', _renderInvLibraryBody()); }
function _renderInvLibraryBody() {
  const invs = _libInvs();
  const cards = invs.map((iv, i) => {
    const hpTxt = (iv.currentHp != null && iv.stats?.pv != null && iv.currentHp < parseInt(iv.stats.pv))
      ? `${iv.currentHp}/${iv.stats.pv}` : (iv.stats?.pv ?? '?');
    return `<div class="cs-invlib-card">
      <div class="cs-invlib-portrait">${iv.image ? `<img src="${iv.image}" alt="">` : '<span>🐾</span>'}</div>
      <div class="cs-invlib-info">
        <div class="cs-invlib-name">${_esc(iv.nom || 'Invocation')}</div>
        <div class="cs-invlib-stats">❤️ ${hpTxt} · 🛡️ ${iv.stats?.ca ?? 10} · ⚔️ ${_esc(iv.stats?.attaque || '1d4 +2')}${(iv.actions||[]).length ? ` · 🎬 ${iv.actions.length}` : ''}</div>
      </div>
      <div class="cs-invlib-actions">
        <button class="btn-icon" data-action="_editLibInv" data-idx="${i}" title="Modifier">✏️</button>
        <button class="btn-icon" data-action="_deleteLibInv" data-idx="${i}" title="Supprimer">🗑️</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="cs-invlib">
    <div class="cs-invlib-hint">Crée tes créatures à l'avance (stats, image, actions). Un sort à rune <b>Invocation</b> choisira ensuite laquelle/lesquelles invoquer (1 par rune). Chaque invocation garde ses PV/PM entre deux apparitions.</div>
    <div class="cs-invlib-list">${cards || '<div class="cs-invlib-empty">Aucune invocation. Crée ta première créature.</div>'}</div>
    <div class="cs-invlib-foot">
      <button class="btn btn-gold" data-action="_editLibInv" data-idx="-1">＋ Nouvelle invocation</button>
      <button class="btn btn-outline" data-action="closeModalDirect">Fermer</button>
    </div>
  </div>`;
}

// ── Éditeur d'une invocation de la bibliothèque ───────────────────────────────
function _editLibInv(idx) {
  const c = STATE.activeChar; if (!c) return;
  if (!Array.isArray(c.invocations)) c.invocations = [];
  if (idx < 0) {
    c.invocations.push({ id: _invUuid(), nom: '', image: '', stats: { attaque:'1d4 +2', toucher:2, pv:10, ca:10, deplacement:3, pmMax:0 }, actions: [], currentHp: null, currentPm: null });
    _libInvIdx = c.invocations.length - 1;
  } else {
    _libInvIdx = idx;
  }
  _invImageEdit = _libInvCurrent()?.image || '';
  openModal('🐾 Invocation', _renderLibInvEditorBody());
}
function _refreshLibInvEditor() { updateModalContent('🐾 Invocation', _renderLibInvEditorBody()); }
function _renderLibInvEditorBody() {
  const iv = _libInvCurrent(); if (!iv) return '<div style="padding:1rem">Invocation introuvable.</div>';
  const st = iv.stats || {};
  const fields = [
    { id:'attaque',     ic:'⚔️', lbl:'Attaque',     type:'text',   val:_esc(st.attaque ?? '1d4 +2'), ph:'1d4 +2' },
    { id:'toucher',     ic:'🎯', lbl:'Toucher',     type:'number', val:(st.toucher ?? 2),  ph:'2' },
    { id:'pv',          ic:'❤️', lbl:'PV',          type:'number', val:(st.pv ?? 10),      ph:'10' },
    { id:'ca',          ic:'🛡️', lbl:'CA',          type:'number', val:(st.ca ?? 10),      ph:'10' },
    { id:'deplacement', ic:'👢', lbl:'Déplacement', type:'number', val:(st.deplacement ?? 3), ph:'3' },
    { id:'pmMax',       ic:'✦',  lbl:'PM',          type:'number', val:(st.pmMax ?? 0),    ph:'0' },
  ];
  const acts = Array.isArray(iv.actions) ? iv.actions : [];
  const calcChar = _libInvCalcChar(iv);
  return `<div class="cs-invedit">
    <div class="cs-spell-section">
      <div class="cs-spell-section-title">🐾 Identité &amp; statistiques <span class="cs-spell-section-hint">stats de base de la créature</span></div>
      <div class="cs-inv-body">
        <div class="cs-inv-imgcol">
          <div id="s-inv-img-block" class="cs-inv-img-block">${_renderInvImageBlock()}</div>
          <input type="hidden" id="s-inv-image" value="${_invImageEdit||''}">
        </div>
        <div class="cs-inv-grid">
          <label class="cs-inv-stat" style="grid-column:1/-1">
            <span class="cs-inv-stat-lbl">🐾 Nom</span>
            <input class="cs-inv-stat-in" id="s-inv-nom" type="text" value="${_esc(iv.nom||'')}" placeholder="Nom de la créature">
          </label>
          ${fields.map(f => `<label class="cs-inv-stat">
            <span class="cs-inv-stat-lbl">${f.ic} ${f.lbl}</span>
            <input class="cs-inv-stat-in" id="s-inv-${f.id}" type="${f.type}" value="${f.val}" placeholder="${f.ph}">
          </label>`).join('')}
        </div>
      </div>
    </div>
    <div class="cs-spell-section">
      <div class="cs-spell-section-title">🎬 Actions de la créature <span class="cs-spell-section-hint">mini-sorts joués par l'invocation</span>
        <button class="btn btn-gold btn-sm" style="margin-left:auto" data-action="_libInvAddAction">＋ Action</button>
      </div>
      <div class="inv-cfg-list">
        ${acts.length ? acts.map((a, ai) => {
          const _off = _getSortTypes(a).includes('offensif') || _hasLaceration(a);
          const _dmg = _off ? _calcSortDegats(a, calcChar) : '';
          const _meta = [_dmg ? `🎲 ${_esc(_dmg)}` : '', (a.runes||[]).length ? `${a.runes.length} rune${a.runes.length>1?'s':''}` : 'sans rune', a.pm ? `${a.pm} PM` : ''].filter(Boolean).join(' · ');
          return `<div class="inv-cfg-act">
            <div class="inv-cfg-act-main" data-action="_libInvEditAction" data-aidx="${ai}">
              <span class="inv-cfg-act-name">🎬 ${_esc(a.nom || 'Action')}</span>
              <span class="inv-cfg-act-meta">${_meta}</span>
            </div>
            <button class="btn-icon" data-action="_libInvEditAction" data-aidx="${ai}" title="Modifier">✏️</button>
            <button class="btn-icon" data-action="_libInvDeleteAction" data-aidx="${ai}" title="Supprimer">🗑️</button>
          </div>`;
        }).join('') : '<div class="inv-cfg-empty">Aucune action — la créature attaquera avec son attaque de base.</div>'}
      </div>
    </div>
    <div class="cs-invedit-foot">
      <button class="btn btn-outline" data-action="_libInvBack">← Bibliothèque</button>
      <button class="btn btn-gold" data-action="_saveLibInv">💾 Enregistrer</button>
    </div>
  </div>`;
}
function _libInvCalcChar(iv) {
  return {
    id: '__invocationCalc', nom: iv?.nom ? `Créature (${iv.nom})` : 'Créature invoquée',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': { nom: 'Attaque de la créature', degats: iv?.stats?.attaque || '1d4 +2', statAttaque:'force', toucherStat:'force', degatsStat:'force', portee:1, isDefault:true } },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [], elements: [],
  };
}
// Lit les champs DOM → stats de l'invocation courante (sans toucher aux actions).
function _readLibInvStatsFromDOM() {
  const iv = _libInvCurrent(); if (!iv) return;
  const v = id => (document.getElementById(id)?.value ?? '').trim();
  const num = id => { const n = parseInt(v(id)); return Number.isFinite(n) ? n : 0; };
  iv.nom = v('s-inv-nom');
  iv.image = _invImageEdit || document.getElementById('s-inv-image')?.value || '';
  iv.stats = {
    attaque: v('s-inv-attaque') || '1d4 +2', toucher: num('s-inv-toucher'), pv: num('s-inv-pv'),
    ca: num('s-inv-ca') || 10, deplacement: num('s-inv-deplacement'), pmMax: num('s-inv-pmMax'),
  };
}
async function _saveLibInv() {
  const iv = _libInvCurrent(); if (!iv) return;
  _readLibInvStatsFromDOM();
  if (!iv.nom) { showNotif('Donne un nom à l\'invocation.', 'error'); return; }
  await _saveLibInvs();
  showNotif('Invocation enregistrée !', 'success');
  openModal('🐾 Mes invocations', _renderInvLibraryBody());
}
function _libInvBack() {
  _readLibInvStatsFromDOM();              // ne perd pas la saisie en cours
  openModal('🐾 Mes invocations', _renderInvLibraryBody());
}
async function _deleteLibInv(idx) {
  const c = STATE.activeChar; if (!c?.invocations) return;
  if (!await confirmModal('Supprimer cette invocation ?')) return;
  c.invocations.splice(idx, 1);
  await _saveLibInvs();
  _refreshInvLibrary();
}
// Actions de l'invocation (mini-sorts) — réutilise editItemSpell.
function _libInvAddAction() {
  _readLibInvStatsFromDOM();
  const iv = _libInvCurrent(); if (!iv) return;
  if (!Array.isArray(iv.actions)) iv.actions = [];
  editItemSpell({ actions: iv.actions }, -1, _libInvOnActionSave, _libInvCalcChar(iv));
}
function _libInvEditAction(aidx) {
  _readLibInvStatsFromDOM();
  const iv = _libInvCurrent(); if (!iv?.actions) return;
  editItemSpell({ actions: iv.actions }, parseInt(aidx), _libInvOnActionSave, _libInvCalcChar(iv));
}
async function _libInvOnActionSave(holder) {
  const iv = _libInvCurrent(); if (!iv) return;
  iv.actions = holder.actions;
  await _saveLibInvs();
  _refreshLibInvEditor();
}
async function _libInvDeleteAction(aidx) {
  const iv = _libInvCurrent(); if (!iv?.actions) return;
  if (!await confirmModal('Supprimer cette action ?')) return;
  iv.actions.splice(parseInt(aidx), 1);
  await _saveLibInvs();
  _refreshLibInvEditor();
}

function _selectDeplMode(mode) {
  _deplModeEdit = mode;
  const DEPL_CFG = { self:'#22c38e', push:'#e8b84b', pull:'#4f8cff' };
  ['self', 'push', 'pull'].forEach(v => {
    const btn = document.getElementById(`s-depl-${v}`);
    if (!btn) return;
    const col = DEPL_CFG[v] || '#9ca3af';
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'20' : 'var(--bg-elevated)';
    btn.style.color       = active ? col : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '700' : '400';
  });
  _updateSortPreview();
}

// Mode de la rune Amplification : 'zone' | 'deplacement' (calqué sur _selectProtMode).
function _selectAmpMode(mode) {
  const hidden = document.getElementById('s-amp-mode');
  if (hidden) hidden.value = mode;
  if (mode === 'deplacement' && !_deplModeEdit) _deplModeEdit = 'self';
  const zSec = document.getElementById('s-amp-zone-section');
  const dSec = document.getElementById('s-amp-depl-section');
  if (zSec) zSec.style.display = mode === 'zone' ? '' : 'none';
  if (dSec) dSec.style.display = mode === 'deplacement' ? '' : 'none';
  [['zone','#b47fff'], ['deplacement','#e8b84b']].forEach(([v, col]) => {
    const btn = document.getElementById(`s-amp-${v}`);
    if (!btn) return;
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'18' : 'var(--bg-elevated)';
    const t = btn.querySelector('div'); if (t) t.style.color = active ? col : 'var(--text-dim)';
  });
  if (mode === 'deplacement') _selectDeplMode(_deplModeEdit || 'self');
  _refreshConditionalSections();   // masque/affiche Dégâts selon le mode
  _updateSortPreview();
}

// Forme de la zone combo Amp+Disp ('rect' | 'cross').
function _selectZoneShape(shape) {
  _zoneShapeEdit = shape === 'cross' ? 'cross' : 'rect';
  const hidden = document.getElementById('s-zone-shape');
  if (hidden) hidden.value = _zoneShapeEdit;
  document.querySelectorAll('[data-action="_selectZoneShape"]').forEach(btn => {
    const active = btn.dataset.val === _zoneShapeEdit;
    const col = btn.dataset.val === 'cross' ? '#a855f7' : '#4f8cff';
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col + '18' : 'var(--bg-elevated)';
    btn.style.color       = active ? col : 'var(--text-dim)';
  });
  _updateSortPreview();
}

function _selectActionMode(mode) {
  _actionModeEdit = mode === 'action_bonus' ? 'action_bonus' : 'reaction';
  const hidden = document.getElementById('s-action-mode');
  if (hidden) hidden.value = _actionModeEdit;
  [
    ['reaction', '#ec4899'],
    ['action_bonus', '#f97316'],
  ].forEach(([v, col]) => {
    const btn = document.getElementById(`s-action-mode-${v}`);
    if (!btn) return;
    const active = v === _actionModeEdit;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background = active ? col + '18' : 'var(--bg-elevated)';
    const t = btn.querySelector('div');
    if (t) t.style.color = active ? col : 'var(--text-dim)';
  });
  _refreshRunesSection?.(ACTION_RUNE);
  _updateSortPreview();
}

function _selectProtMode(mode) {
  _protModeEdit = mode;   // garde l'état module synchro (source du label de la carte rune)
  const hidden  = document.getElementById('s-prot-mode');
  const caSec   = document.getElementById('s-ca-section');
  if (hidden)  hidden.value = mode;
  if (caSec)   caSec.style.display   = mode === 'ca'   ? '' : 'none';
  // La section Soin a maintenant sa propre logique (type Soutien OU Protection mode soin)
  _refreshConditionalSections();
  ['ca','soin'].forEach(v => {
    const btn = document.getElementById(`s-prot-${v}`);
    if (!btn) return;
    const colors = { ca:'#22c38e', soin:'#4f8cff' };
    const col = colors[v];
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'18' : 'var(--bg-elevated)';
    btn.querySelector('div').style.color = active ? col : 'var(--text-dim)';
  });
  // Section Durée base : visible si Protection mode CA actif
  const dureeSec = document.getElementById('s-duree-base-section');
  if (dureeSec) {
    const s = _buildSortFromDOM();
    dureeSec.style.display = _needsDureeBase(s) ? '' : 'none';
  }
  // Re-render des runes actives pour que la carte Protection reflète le mode courant
  // (CA → "+2 CA · sur 1 cible (2 tours)" / Soin → "+1d4 soin · sur 1 cible")
  _refreshRunesSection?.('Protection');
  _updateSortPreview();
}

export function runeIncrement(nom) {
  _runeCountsEdit = _runeCountsEdit||{};
  if (nom === ACTION_RUNE && (_runeCountsEdit[ACTION_RUNE] || 0) > 0) {
    _refreshRunesSection(nom);
    return;
  }
  // Limite de runes d'effet par personnage (le MJ et les contextes spéciaux
  // — actions d'objet/invocation — ne sont pas limités).
  if (!STATE.isAdmin && !_itemEditCtx) {
    const total = Object.values(_runeCountsEdit).reduce((a, b) => a + b, 0);
    const limit = _spellRuneLimit();
    if (total >= limit) {
      showNotif(`Limite de runes d'effet atteinte (${limit}). Le MJ peut en débloquer.`, 'error');
      return;
    }
  }
  const prevCnt = _runeCountsEdit[nom] || 0;
  _runeCountsEdit[nom] = prevCnt + 1;
  // Intelligence : la 1ère Protection suggère la branche Soutien.
  // Puissance ne coche pas Offensif : elle peut renforcer un enchantement, un DoT,
  // une invocation, etc. sans impliquer des dégâts directs au cast.
  if (prevCnt === 0 && _sortTypesEdit) {
    if (nom === 'Protection' && !_sortTypesEdit.has('defensif')) {
      _sortTypesEdit.add('defensif');
      _applyTypeChange();
    }
  }
  _refreshRunesSection(nom);
}

export function runeDecrement(nom) {
  _runeCountsEdit = _runeCountsEdit||{};
  if ((_runeCountsEdit[nom]||0) <= 0) return;
  _runeCountsEdit[nom]--;
  if (_runeCountsEdit[nom] === 0) delete _runeCountsEdit[nom];
  _refreshRunesSection(nom);
}

// MJ : débloque / retire des runes d'effet pour le perso courant (characters.maxRunes).
async function _mjAdjRuneLimit(delta) {
  if (!STATE.isAdmin) return;
  const c = STATE.activeChar; if (!c) return;
  const cur  = parseInt(c.maxRunes);
  const base = Number.isFinite(cur) ? cur : 1;
  const next = Math.max(0, Math.min(20, base + (parseInt(delta) || 0)));
  if (next === base) return;
  c.maxRunes = next;
  await trySave('characters', c.id, { maxRunes: next }).catch(() => {});
  _refreshRunesSection();
  showNotif(`🔮 Runes d'effet débloquées : ${next} pour ${_esc(c.nom || 'ce perso')}`, 'success');
}

/**
 * Re-render la section runes complète + sync les sections conditionnelles + PM + preview.
 * Appelée après chaque incrément/décrément. Évite la désync entre carte active et picker.
 */
function _refreshRunesSection(changedNom) {
  const section = document.getElementById('cs-runes-section');
  if (section) section.innerHTML = _renderRunesSection();
  // Sections conditionnelles (rune X > 0 → section X visible)
  const cnt = _runeCountsEdit[changedNom] || 0;
  const sectionMap = {
    Protection:    's-prot-section',
    Enchantement:  's-enchant-section',
    Affliction:    's-affliction-section',
    Amplification: 's-amp-section',
    [ACTION_RUNE]: 's-action-rune-section',
  };
  const sectionId = sectionMap[changedNom];
  if (sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.style.display = cnt > 0 ? '' : 'none';
  }
  // Combo Sentinelle (Affliction + Invocation) : masque les branches d'affliction
  // (DoT/État/Lacération) et affiche une note — c'est une invocation de sentinelle.
  {
    const isSentinelle = (_runeCountsEdit['Affliction'] || 0) > 0 && (_runeCountsEdit['Invocation'] || 0) > 0;
    const isRegen = _isRegenerationComboActive(_runeCountsEdit);
    const modesEl = document.getElementById('s-affliction-modes');
    const noteEl  = document.getElementById('s-affliction-sentinelle-note');
    if (modesEl) modesEl.style.display = (isSentinelle || isRegen) ? 'none' : '';
    if (noteEl)  noteEl.style.display  = isSentinelle ? '' : 'none';
  }
  // Plus aucune rune Amplification → on repasse en mode Zone (évite un état
  // « déplacement » fantôme sans rune, qui supprimerait zone/dégâts à tort).
  if (changedNom === 'Amplification' && cnt === 0) {
    const ampHidden = document.getElementById('s-amp-mode');
    if (ampHidden && ampHidden.value !== 'zone') _selectAmpMode('zone');
  }
  // Portée de déplacement : dépend du nombre de runes Amplification.
  const rangeEl = document.getElementById('s-amp-depl-range');
  if (rangeEl) rangeEl.textContent = `1 à ${_ampLength(_runeCountsEdit['Amplification'] || 0) || 0} cases`;
  // Section Durée de base : visible selon le contexte
  const dureeSec = document.getElementById('s-duree-base-section');
  if (dureeSec) {
    const s = _buildSortFromDOM();
    dureeSec.style.display = _needsDureeBase(s) ? '' : 'none';
  }
  // La visibilité Dégâts/Soin dépend des types ET de la rune Protection
  _refreshConditionalSections();
  if (changedNom === 'Puissance' || changedNom === 'Amplification' || changedNom === 'Enchantement') {
    _refreshEnchantStateTuning();
  }
  updateSortPM();
}

/**
 * Active le mode "Custom" sur un champ auto-calculé.
 * fieldId : 's-degats' | 's-soin' | 's-ca' | 's-enchant-degats'
 */
function _enableSortCustom(fieldId) {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  const wrap    = display?.parentElement; // .cs-spell-autoval
  if (display) display.style.display = 'none';
  if (edit)    edit.style.display = '';
  if (wrap)    wrap.classList.add('is-custom');   // CSS gère aussi via la classe
  if (input) { input.focus(); input.select?.(); }
}

/** Repasse en mode "Auto" — vide UNIQUEMENT la formule override.
 *  Les overrides de stat sont indépendants : pour les remettre en Auto,
 *  l'utilisateur sélectionne "Auto (arme)" dans le menu déroulant.
 */
function _disableSortCustom(fieldId) {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  const wrap    = display?.parentElement; // .cs-spell-autoval
  if (input)   input.value = '';
  if (edit)    edit.style.display = 'none';
  if (display) display.style.display = '';
  if (wrap)    wrap.classList.remove('is-custom');  // sinon la chip reste cachée par CSS
  _refreshAutoValChips();
  _updateSortPreview();
}

/** Recalcule les valeurs affichées dans les chips auto (dégâts, soin, CA, enchant). */
function _refreshAutoValChips() {
  const s = _buildSortFromDOM();
  const c = _modalChar();
  if (!c) return;
  const apply = (fieldId, value, source) => {
    const v = document.getElementById(`${fieldId}-autoval`);
    const r = document.getElementById(`${fieldId}-source`);
    if (v && value !== undefined) v.textContent = value || '—';
    if (r && source !== undefined) r.textContent = source || '';
  };
  apply('s-degats',         _calcSortDegats(s, c),  _autoSourceDegats(s, c));
  apply('s-soin',           _calcSortSoin(s, c),    _autoSourceSoin(s, c));
  apply('s-ca',             _getSortCA(s),          _autoSourceCA(s));
  apply('s-enchant-degats', _calcEnchantDegats(s),  _autoSourceEnchantDeg(s));
  apply('s-enchant-state-move-bonus', _calcEnchantStateMoveAuto(s), 'État + Amplification');
  apply('s-enchant-state-dmg-formula', _calcEnchantStateDmgAuto(s), 'État + Puissance');
  apply('s-regeneration-formula', _calcRegenerationAuto(s), 'Protection + Affliction');
  apply('s-affliction-dot-formula', _calcAfflictionDot(s), _autoSourceAfflictionDot(s));
  apply('s-duree-base', String(_calcSortDuree(s)), _autoSourceDuree(s));
}

/**
 * Met à jour les chips "💡 Suggéré : …" d'Enchantement et Affliction.
 * Lit le noyau + slot du DOM, interroge la matrice MJ.
 * Si une suggestion existe pour la combinaison, affiche le chip cliquable.
 *
 * Pré-remplissage agressif : si la textarea d'effet est encore VIDE (jamais touchée),
 * on injecte automatiquement la suggestion. Si l'utilisateur a tapé quoi que ce soit,
 * on respecte sa saisie et on n'écrase pas (juste le chip reste visible pour qu'il puisse l'appliquer manuellement).
 */
function _refreshSpellSuggestions() {
  const matrices = getSpellMatricesCache();
  if (!matrices) return;
  const noyauId  = document.getElementById('s-noyau-id')?.value || '';
  const enchSlot = document.getElementById('s-enchant-slot')?.value || 'arme';
  const affSlot  = document.getElementById('s-affliction-slot')?.value || 'arme';

  const renderSuggestions = (cat, suggestions) => {
    const wrap = document.getElementById(`s-${cat}-suggest`);
    const list = document.getElementById(`s-${cat}-suggest-list`);
    const txtEl = document.getElementById(`s-${cat}-effect`);
    if (!wrap || !list) return;
    if (!suggestions.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
    wrap.style.display = '';
    // Encode chaque suggestion en base64 pour passage sans risque dans l'onclick
    list.innerHTML = suggestions.map(s => {
      const encoded = btoa(unescape(encodeURIComponent(s)));
      return `<button type="button" class="cs-spell-suggest-btn"
        data-action="_pickSpellSuggestion" data-cat="${cat}" data-encoded="${encoded}"
        title="Cliquer pour appliquer cette suggestion">↓ ${_esc(s)}</button>`;
    }).join('');
    // Pré-remplissage agressif : si la textarea est vide et jamais touchée,
    // injecte la 1ère suggestion (comportement historique)
    if (txtEl && !txtEl.value.trim() && !txtEl.dataset.userTouched) {
      txtEl.value = suggestions[0];
    }
  };

  renderSuggestions('enchant',    getMatrixSuggestions(matrices, 'enchant',    noyauId, enchSlot));
  renderSuggestions('affliction', getMatrixSuggestions(matrices, 'affliction', noyauId, affSlot));
}

/** Bibliothèque d'icônes pour les sorts (emojis sélectionnés pour le thème JdR). */
const SPELL_ICONS = [
  // Élémentaires
  '🔥','💧','🌪','🌍','⚡','❄️','☀️','🌙','⭐','✨',
  // Offensifs
  '⚔️','🗡️','🏹','💥','💣','☄️','🌋','🌊','🌩','🩸',
  // Soutien / soin
  '🛡️','🛡','💚','💗','❤️‍🩹','✝️','🪽','🕊','🌿','🍀',
  // Contrôle / état
  '💀','☠️','🕸','🪨','🪤','🧊','🔇','😵','🥶','🥵',
  // Magie / arcanes
  '🔮','🪄','📜','📖','🎴','🌀','♾️','♾','🧿','👁️',
  // Invocations / créatures
  '🐾','🐺','🐉','🦅','🦂','🐍','🦋','🦇','🦴','🐾',
  // Divers
  '👊','👋','🫳','🫸','🤚','🪦','🗿','🎭','🃏','🎲',
];

// Ferme le picker quand on clique en dehors
function _bindSortIconPickerOutsideClose() {
  if (_sortIconPickerOutsideBound) return;
  _sortIconPickerOutsideBound = true;
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('s-icon-picker');
    const btn    = document.getElementById('s-icon-btn');
    if (!picker || picker.style.display === 'none') return;
    if (picker.contains(e.target) || btn?.contains(e.target)) return;
    picker.style.display = 'none';
  }, true);
}

function _toggleSortIconPicker() {
  _bindSortIconPickerOutsideClose();
  const picker = document.getElementById('s-icon-picker');
  if (!picker) return;
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
  // Génère le contenu à l'ouverture (au cas où la sélection courante a changé)
  const current = document.getElementById('s-icon')?.value || '';
  const grid = [...new Set(SPELL_ICONS)].map(ic => {
    const sel = ic === current ? ' is-selected' : '';
    return `<button type="button" class="cs-spell-icon-opt${sel}"
      data-action="_pickSortIcon" data-icon="${_esc(ic)}">${ic}</button>`;
  }).join('') + `<button type="button" class="cs-spell-icon-opt cs-spell-icon-opt--clear"
      data-action="_pickSortIcon" data-icon="" title="Aucune icône — utilise celle du noyau">✕</button>`;
  // Zone "emoji perso" collante : champ libre pour n'importe quel emoji.
  picker.innerHTML = `
    <div class="cs-spell-icon-custom">
      <input type="text" id="s-icon-custom" class="cs-spell-icon-custom-input"
        placeholder="Emoji perso… (ex : 🦄)" maxlength="8" value="${_esc(current)}">
      <button type="button" class="cs-spell-icon-custom-ok" data-action="_applyCustomSortIcon" title="Utiliser cet emoji">OK</button>
    </div>
    <div class="cs-spell-icon-grid">${grid}</div>`;
  picker.style.display = 'block';
}

// Applique l'emoji libre saisi (champ "emoji perso"). Accepte tout caractère/emoji.
function _applyCustomSortIcon() {
  const v = (document.getElementById('s-icon-custom')?.value || '').trim();
  if (!v) return;
  _pickSortIcon(v);
}

function _pickSortIcon(icon) {
  const hidden = document.getElementById('s-icon');
  const btn    = document.getElementById('s-icon-btn');
  const picker = document.getElementById('s-icon-picker');
  if (hidden) hidden.value = icon;
  if (btn)    btn.textContent = icon || '🔮';
  if (picker) picker.style.display = 'none';
  // Met à jour la preview live
  _updateSortPreview();
}

/**
 * Applique une suggestion spécifique (base64 encodé) dans la textarea d'effet.
 * Appelé depuis les boutons générés par _refreshSpellSuggestions.
 * cat = 'enchant' | 'affliction'
 */
function _pickSpellSuggestion(cat, encoded) {
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (!txtEl) return;
  let suggestion = '';
  try { suggestion = decodeURIComponent(escape(atob(encoded))); } catch { suggestion = ''; }
  if (!suggestion) return;
  txtEl.value = suggestion;
  txtEl.dataset.userTouched = '1';                 // évite l'écrasement auto au prochain refresh
  txtEl.dispatchEvent(new Event('input', { bubbles: true })); // trigger preview update
  txtEl.focus();
}

// Compat ascendante : si du code legacy appelle encore _applySpellSuggest,
// on tente de prendre la 1ère suggestion disponible.
function _applySpellSuggest(cat) {
  const list = document.getElementById(`s-${cat}-suggest-list`);
  const firstBtn = list?.querySelector('.cs-spell-suggest-btn');
  if (firstBtn) firstBtn.click();
}

/**
 * Sélectionne un slot pour Enchantement ou Affliction.
 * groupId : 'enchant' ou 'affliction'
 */
/** Toggle Dégâts/État pour l'enchantement. */
function _selectEnchantMode(mode) {
  const hidden = document.getElementById('s-enchant-mode');
  if (hidden) hidden.value = mode;
  ['dmg','toucher','deplacement','etat'].forEach(m =>
    document.getElementById(`s-enchant-mode-${m}`)?.classList.toggle('selected', mode === m));
  const isBonus = ['toucher','deplacement'].includes(mode);
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('s-enchant-dmg-block',   mode === 'dmg');
  show('s-enchant-bonus-block', isBonus);
  show('s-enchant-etat-block',  mode === 'etat');
  // Adapte le libellé du champ bonus selon la cible boostée
  const lbl = document.getElementById('s-enchant-bonus-label');
  if (lbl) lbl.textContent = mode === 'toucher' ? '🎯 Bonus au toucher'
                           : mode === 'deplacement' ? '👢 Cases de déplacement en plus' : 'Bonus';
  _updateSortPreview();
}

/** Branche d'Affliction : DoT / État / Lacération. */
function _selectAfflictionMode(mode) {
  const hidden = document.getElementById('s-affliction-mode');
  if (hidden) hidden.value = mode;
  document.getElementById('s-affliction-mode-dot')?.classList.toggle('selected', mode === 'dot');
  document.getElementById('s-affliction-mode-etat')?.classList.toggle('selected', mode === 'etat');
  document.getElementById('s-affliction-mode-laceration')?.classList.toggle('selected', mode === 'laceration');
  const dotBlock = document.getElementById('s-affliction-dot-block');
  const etatBlock = document.getElementById('s-affliction-etat-block');
  const lacBlock = document.getElementById('s-affliction-laceration-block');
  if (dotBlock) dotBlock.style.display = mode === 'dot' ? '' : 'none';
  if (etatBlock) etatBlock.style.display = mode === 'etat' ? '' : 'none';
  if (lacBlock) lacBlock.style.display = mode === 'laceration' ? '' : 'none';
  _updateSortPreview();
}

export function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(_runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
  const pm = total * 2 || 2;
  const pmEl = document.getElementById('s-pm');
  const dispEl = document.getElementById('s-pm-display');
  if (pmEl)   pmEl.value = pm;
  if (dispEl) dispEl.textContent = pm;
  const bd = document.getElementById('s-pm-breakdown');
  if (bd) bd.innerHTML = _renderPmBreakdown();
  _updateSortPreview();
}

/** Reconstruit un objet sort depuis l'état du modal (pour la preview live) */
function _buildSortFromDOM() {
  const noyau       = document.getElementById('s-noyau')?.value || '';
  const noyauTypeId = document.getElementById('s-noyau-id')?.value || '';
  const runes = _buildRunesFromCounts();
  const types = [...(_sortTypesEdit || new Set(['utilitaire']))];
  const dureeBase = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = _deplModeEdit || null;
  const iconRaw  = document.getElementById('s-icon')?.value || '';
  const mjVal    = document.getElementById('s-mj-validation')?.value || 'pending';
  return {
    icon:        iconRaw.trim() || '',
    mjValidation: mjVal, mjValidated: mjVal === 'ok',
    noyau, noyauTypeId, noyauTypeIds: [..._noyauIdsEdit], runes, types,
    actionMode: (_runeCountsEdit?.[ACTION_RUNE] || 0) > 0
      ? (document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction')
      : null,
    degats: document.getElementById('s-degats')?.value || '',
    soin:   document.getElementById('s-soin')?.value || '',
    ca:     document.getElementById('s-ca')?.value || '',
    effet:  document.getElementById('s-effet')?.value || '',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantBonus:     (() => { const v = document.getElementById('s-enchant-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantEtatIds:   _collectEnchantEtatIds(),
    enchantStateMoveBonus: (() => { const v = document.getElementById('s-enchant-state-move-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantStateDmgFormula: document.getElementById('s-enchant-state-dmg-formula')?.value?.trim() || '',
    enchantSlot:      'arme', // legacy compat (preview live, sera écrasé à la save par la valeur en BDD)
    enchantEffect:    document.getElementById('s-enchant-effect')?.value ?? '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'arme',
    afflictionMode:   document.getElementById('s-affliction-mode')?.value || 'dot',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value || '',
    afflictionEtatId: document.getElementById('s-affliction-etat')?.value || null,
    afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
    regenerationFormula: document.getElementById('s-regeneration-formula')?.value?.trim() || '',
    afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
    zoneW: null,
    zoneH: null,
    dureeBase: dureeBase >= 2 ? dureeBase : null,
    deplacement: deplMode ? { mode: deplMode } : null,
    ampMode: document.getElementById('s-amp-mode')?.value || 'zone',
    zoneShape: _zoneShapeEdit === 'cross' ? 'cross' : 'rect',
    // Portée + stats overrides : doivent être lus du DOM pour que la preview live
    // et les chips auto reflètent la sélection courante (sinon auto-dérivation kick in).
    portee:      (() => {
      // Distingue champ VIDE (→ null = auto/arme) de la valeur 0 (→ "sur soi")
      const raw = document.getElementById('s-portee')?.value;
      if (raw === '' || raw == null) return null;
      const n = parseInt(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    toucherStat: _readVisibleStatOverride('s-toucher-stat'),
    degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
    invocation:  _buildInvocationFromDOM(),
    mjNotes: document.getElementById('s-mj-notes')?.value || '',
  };
}

/** Rafraîchit la preview live dans l'éditeur de sort */
/** Perso placeholder neutre pour la preview en contexte item (pas de perso actif).
 *  Stats 10 partout (mod 0), Poings (1d6 Phys, portée 1 case), pas d'équipement.
 *  Permet à _buildSortResume / _calcSortDegats / etc. de calculer un aperçu générique. */
// ── Garde anti-perte de la forge ────────────────────────────────────────────
// Compare l'état d'édition courant à l'instantané pris à l'ouverture. Le hook
// dans closeModalDirect() consulte _sortModalCloseGuard quand la forge elle-même
// va se fermer (✕ barre, ✕ forge, Échap, clic overlay), jamais lorsqu'une couche
// de confirmation empilée est simplement annulée. Désarmé au save et au discard.
function _snapshotSortModal() {
  try {
    return document.getElementById('s-classic-form')
      ? JSON.stringify(_buildClassicSortFromDOM())
      : JSON.stringify(_buildSortFromDOM());
  } catch { return null; }
}
function _sortModalIsDirty() {
  const b = _sortModalBaseline;
  if (b == null) return false;
  const n = _snapshotSortModal();
  return n != null && n !== b;
}
function _sortModalCloseGuard() {
  if (!_sortModalIsDirty()) return false;   // rien à perdre → fermeture normale
  // Confirmation INLINE, superposée à la forge SANS remplacer son DOM (contrairement à
  // confirmModal/pushModal qui détruirait les saisies). « Continuer » garde tout intact ;
  // « Fermer » désarme le garde puis ferme réellement.
  const modal = document.querySelector('.modal');
  if (!modal) return false;                                   // pas de forge → laisse fermer
  if (modal.querySelector('.cs-forge-guard')) return true;    // confirmation déjà affichée
  const layer = document.createElement('div');
  layer.className = 'cs-forge-guard';
  layer.innerHTML = `
    <div class="cs-forge-guard-box" role="alertdialog" aria-modal="true">
      <div class="cs-forge-guard-ico">⚠️</div>
      <div class="cs-forge-guard-title">Modifications non enregistrées</div>
      <div class="cs-forge-guard-msg">Des modifications de ce sort ne sont pas enregistrées.</div>
      <div class="cs-forge-guard-btns">
        <button type="button" class="cs-forge-guard-save">💾 Enregistrer et fermer</button>
        <div class="cs-forge-guard-btns-row">
          <button type="button" class="cs-forge-guard-close">Fermer sans enregistrer</button>
          <button type="button" class="cs-forge-guard-cancel">Continuer l’édition</button>
        </div>
      </div>
    </div>`;
  modal.appendChild(layer);
  const cancel = () => layer.remove();
  // Enregistrer et fermer : délègue à saveSort (qui valide nom/noyau, sauve et ferme).
  // Si la save échoue (ex. nom manquant), la forge reste ouverte avec l'erreur.
  layer.querySelector('.cs-forge-guard-save').addEventListener('click', () => {
    layer.remove();
    const idx = Number(modal.querySelector('[data-action="saveSort"]')?.dataset.idx ?? -1);
    saveSort(idx);
  });
  layer.querySelector('.cs-forge-guard-close').addEventListener('click', () => {
    _sortModalBaseline = null;
    clearModalCloseGuard();   // désarme AVANT de fermer → pas de re-déclenchement
    layer.remove();
    closeModalDirect();
  });
  layer.querySelector('.cs-forge-guard-cancel').addEventListener('click', cancel);
  layer.addEventListener('click', (e) => { if (e.target === layer) cancel(); });
  return true;   // bloque la fermeture immédiate
}

function _itemPreviewPlaceholderChar() {
  return {
    id: '__itemPreview',
    nom: 'Objet',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': null },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [],
    elements: [],
  };
}

function _updateSortPreview() {
  const body = document.getElementById('s-preview-body');
  if (!body) return;
  // En contexte item-edit : on utilise un perso virtuel pour avoir un aperçu générique
  //   (formules de base sans modificateurs perso, ce qui correspond au comportement réel
  //   de l'item — les modificateurs viennent du caster au moment de l'utilisation).
  const c = _modalChar() || (_itemEditCtx ? _itemPreviewPlaceholderChar() : null);
  if (!c) { body.innerHTML = ''; return; }
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
  if (typeof _refreshSpellSuggestions === 'function') _refreshSpellSuggestions();
  const s = _buildSortFromDOM();
  let lines = [];
  try {
    lines = _buildSortResume(s, c);
  } catch (e) {
    console.warn('[Preview] _buildSortResume a échoué :', e);
    lines = [{ icon:'⚠️', label:'Aperçu indisponible', detail: String(e?.message || e) }];
  }
  body.innerHTML = lines.map(l => `
    <div class="cs-spell-preview-row ${l.isCombo ? 'cs-spell-preview-row--combo' : ''}">
      ${l.icon ? `<span class="cs-spell-preview-icon">${l.icon}</span>` : '<span class="cs-spell-preview-icon"></span>'}
      <span class="cs-spell-preview-label">${_esc(l.label)}</span>
      ${l.detail ? `<span class="cs-spell-preview-detail">${_esc(l.detail)}</span>` : ''}
    </div>
  `).join('');

  // La Résonance : circuit de combos (allumés + en approche). RÉSERVÉE AU MJ — la
  // section n'existe pas côté joueur (cf. openSortModal), donc rez est nul pour eux.
  const rez = STATE.isAdmin ? document.getElementById('cs-resonance') : null;
  if (rez) rez.innerHTML = _renderResonance();

  // Bandeau avant/après : prévient AVANT la save qu'un changement de contenu
  // renverra ce sort validé en attente MJ (même comparaison que saveSort).
  const banner = document.getElementById('s-revalidate-banner');
  if (banner && _sortEditWasOk) {
    const changed = _sortEditContentBaseline != null && _sortContentSig(s) !== _sortEditContentBaseline;
    banner.hidden = !changed;
    const saveBtn = document.querySelector('.sh-admin-footer [data-action="saveSort"]');
    if (saveBtn) saveBtn.textContent = changed ? '💾 Enregistrer (repasse à valider)' : '💾 Enregistrer le sort';
  }
}

function _setSortNameRequiredError(show, message = "Donne un nom au sort avant de l'enregistrer.") {
  const field = document.getElementById('s-nom')?.closest('.cs-spell-identity-field');
  const input = document.getElementById('s-nom');
  const error = document.getElementById('s-nom-error');
  field?.classList.toggle('is-invalid', !!show);
  input?.setAttribute('aria-invalid', show ? 'true' : 'false');
  if (error) {
    error.textContent = message;
    error.hidden = !show;
  }
}

function _requireSortName() {
  const input = document.getElementById('s-nom');
  const valid = !!(input?.value || '').trim();
  const message = "Donne un nom au sort avant de l'enregistrer.";
  _setSortNameRequiredError(!valid, message);
  if (!valid) {
    showNotif(message, 'error');
    input?.focus();
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return valid;
}

function _setNoyauRequiredError(show, message = 'Sélectionne une rune noyau pour enregistrer ce sort.') {
  const section = document.querySelector('.cs-spell-section--noyau');
  const error   = document.getElementById('s-noyau-error');
  section?.classList.toggle('is-invalid', !!show);
  document.querySelectorAll('.cs-noyau-btn').forEach(btn => {
    btn.setAttribute('aria-invalid', show ? 'true' : 'false');
  });
  if (error) {
    error.textContent = message;
    error.hidden = !show;
  }
}

function _requireNoyauSelection() {
  const allowedIds = _sortAllowedNoyauIds;
  const ids = _noyauIdsEdit.filter(Boolean);
  const hasNoyau = ids.length > 0;
  const hasAccess = !allowedIds || ids.every(id => allowedIds.has(id));
  const valid = hasNoyau && hasAccess;
  const message = hasNoyau && !hasAccess
    ? "Ce noyau n'est pas accessible à ce personnage. Le MJ doit lui débloquer cet élément."
    : 'Sélectionne une rune noyau pour enregistrer ce sort.';
  _setNoyauRequiredError(!valid, message);
  if (!valid) {
    showNotif(message, 'error');
    document.querySelector('.cs-spell-section--noyau')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return valid;
}

export function selectNoyau(el, noyauId, noyauLabel, noyauColor) {
  // Multi-noyau : toggle de l'élément dans la sélection ([0] = primaire).
  const i = _noyauIdsEdit.indexOf(noyauId);
  if (i >= 0) _noyauIdsEdit.splice(i, 1);
  else        _noyauIdsEdit.push(noyauId);
  const on = _noyauIdsEdit.includes(noyauId);
  el.classList.toggle('selected', on);
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on && noyauColor) {
    el.style.borderColor = noyauColor;
    el.style.background  = noyauColor + '20';
    el.style.color       = noyauColor;
  } else {
    el.style.borderColor = '';
    el.style.background  = '';
    el.style.color       = '';
  }
  // Primaire = premier sélectionné → conserve s-noyau / s-noyau-id pour la compat
  // (calcul des soins, suggestions matrice, élément par défaut côté VTT).
  const primId  = _noyauIdsEdit[0] || '';
  const primBtn = primId ? document.querySelector(`.cs-noyau-btn[data-noyau-id="${primId}"]`) : null;
  const inputLabel = document.getElementById('s-noyau');
  const inputId    = document.getElementById('s-noyau-id');
  if (inputId)    inputId.value    = primId;
  if (inputLabel) inputLabel.value = primId
    ? (primBtn?.getAttribute('data-noyau-label') || noyauLabel || primId)
    : '';
  _setNoyauRequiredError(_noyauIdsEdit.length === 0);
  // Le changement de noyau affecte le calcul des soins (magique → arme · physique → Con)
  // et les suggestions matrice (Enchant/Affliction · Protection CA)
  updateSortPM();
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
}


// Signature du CONTENU jouable d'un sort (hors champs volatils : actif, validation,
// catégorie, PM dérivé, notes/flags MJ, id). Sert à détecter une modification réelle.
// `types` est mécanique (offensif active les dégâts d'impact côté carte/VTT) →
// inclus sous forme CANONIQUE via _getSortTypes (dérive aussi le legacy typeSoin,
// sinon un vieux sort sans champ `types` diffèrerait au premier resave sans
// changement réel). `typeSoin` brut reste exclu (dérivé, redondant).
function _sortContentSig(s) {
  if (!s) return '';
  const SKIP = new Set(['actif','mjValidation','mjValidated','catId','pm','pmOverride','mjNotes','mjAlwaysMax','enchantSlot','types','typeSoin','id']);
  const o = {};
  Object.keys(s).filter(k => !SKIP.has(k)).sort().forEach(k => { o[k] = s[k]; });
  o.types = [...(_getSortTypes(s) || [])].sort();
  return JSON.stringify(o);
}

function _sanitizeAbsorbedComboFields(s) {
  if (!s) return s;
  const comboIds = new Set(_activeCombos(s).map(c => c.id));
  const clearEnchant = comboIds.has('arme_invoquee');
  const clearAffliction = comboIds.has('regeneration') || comboIds.has('sentinelle');
  const clearAmpMode = comboIds.has('zone_elargie');

  if (clearEnchant) {
    s.enchantMode = 'dmg';
    s.enchantDegats = '';
    s.enchantBonus = null;
    s.enchantEtatId = null;
    s.enchantEtatIds = [];
    s.enchantStateMoveBonus = null;
    s.enchantStateDmgFormula = '';
    s.enchantEffect = '';
    s.enchantSlot = 'arme';
  }
  if (clearAffliction) {
    s.afflictionMode = 'dot';
    s.afflictionSlot = 'torse';
    s.afflictionSaveStat = '';
    s.afflictionEffect = '';
    s.afflictionDotFormula = '';
    s.afflictionEtatId = null;
  }
  if (clearAmpMode) {
    s.ampMode = 'zone';
    s.deplacement = null;
  }
  if (comboIds.has('coup_chance')) {
    s.degats = '';
    if (Array.isArray(s.types)) {
      s.types = s.types.filter(t => t !== 'offensif');
      if (!s.types.length) s.types = ['utilitaire'];
    }
    s.typeSoin = false;
  }
  if (comboIds.has('regeneration') || comboIds.has('drain') || comboIds.has('bouclier_reactif')) {
    s.typeSoin = false;
  }
  return s;
}

// Anti double-clic : une sauvegarde de sort à la fois. L'état local n'est modifié
// QU'APRÈS le succès Firestore (plus de doublon possible sur retry après échec).
let _sortSaving = false;

async function _saveClassicSort(idx, btn = null) {
  if (_sortSaving) return false;
  if (!_requireSortName()) return false;

  const effect = document.getElementById('s-classic-effect')?.value || 'damage';
  const formula = document.getElementById('s-classic-formula')?.value?.trim() || '';
  if (!['utility', 'summon'].includes(effect) && !formula) {
    showNotif(`Indique une formule de ${effect === 'heal' ? 'soin' : 'dégâts'}.`, 'warning');
    document.getElementById('s-classic-formula')?.focus();
    return false;
  }
  if (!['utility', 'summon'].includes(effect) && !_isClassicFormulaValid(formula)) {
    showNotif('Formule invalide. Utilise par exemple 2d8+3 ou 12.', 'warning');
    document.getElementById('s-classic-formula')?.focus();
    return false;
  }
  if (document.getElementById('s-classic-state-enabled')?.checked
      && !document.getElementById('s-classic-state')?.value) {
    showNotif('Choisis l\'état appliqué par le sort.', 'warning');
    document.getElementById('s-classic-state')?.focus();
    return false;
  }
  if (document.getElementById('s-classic-state-enabled')?.checked
      && document.getElementById('s-classic-target')?.value === 'any') {
    showNotif('Pour un état, précise si la cible est un ennemi, un allié ou le lanceur.', 'warning');
    document.getElementById('s-classic-target')?.focus();
    return false;
  }

  _sortSaving = true;
  const saveBtn = btn || document.querySelector('[data-action="saveSort"]');
  saveBtn?.setAttribute('disabled', '');
  saveBtn?.setAttribute('aria-busy', 'true');
  try {
    if (_itemEditCtx) {
      const { item, idx: itemIdx, onSave } = _itemEditCtx;
      const actions = Array.isArray(item.actions) ? [...item.actions] : [];
      const spell = _buildClassicSortFromDOM(itemIdx, actions);
      spell.id = spell.id || (itemIdx >= 0 ? actions[itemIdx]?.id : null) || `a${Date.now().toString(36)}`;
      if (itemIdx >= 0) actions[itemIdx] = { ...actions[itemIdx], ...spell };
      else actions.push(spell);
      item.actions = actions;
      _itemEditCtx = null;
      _sortModalBaseline = null;
      clearModalCloseGuard();
      closeModal();
      await onSave(item);
      showNotif(`Action enregistrée · ${spell.pm} PM`, 'success');
      return true;
    }

    const character = STATE.activeChar;
    if (!character) return false;
    const spells = Array.isArray(character.deck_sorts) ? character.deck_sorts : [];
    const previous = idx >= 0 ? spells[idx] : null;
    const previousValidation = _sortValidationState(previous);
    const spell = _buildClassicSortFromDOM(idx, spells);
    spell.id = spell.id || spellUid();

    if (!STATE.isAdmin && previous
        && (previousValidation === 'ok' || previousValidation === 'no')
        && _sortContentSig(previous) !== _sortContentSig(spell)) {
      spell.mjValidation = 'pending';
      spell.mjValidated = false;
      spell.actif = false;
      showNotif(previousValidation === 'ok'
        ? 'Sort modifié : il repasse en validation et sort du Deck.'
        : 'Sort corrigé : il est renvoyé en validation au MJ.', 'info');
    }

    const isNew = idx < 0;
    const next = [...spells];
    if (idx >= 0) next[idx] = spell;
    else next.push(spell);
    ensureSpellIds(next);
    if (!(await trySave('characters', character.id, { deck_sorts: next }))) return false;

    character.deck_sorts = next;
    if (charSession.getCurrentChar()?.id === character.id) {
      charSession.set(character, charSession.getCanEditChar(), charSession.getCurrentCharTab());
    }
    if (STATE.activeChar?.id === character.id) STATE.activeChar = character;
    _sortModalBaseline = null;
    clearModalCloseGuard();
    closeModal();
    showNotif(`Sort enregistré · ${spell.pm} PM`, 'success');

    if (isNew) {
      _sortsSearch = '';
      _sortsTypeFilter = '';
      _sortsRuneFilter = '';
      _sortsNoyauFilter = '';
      _sortsPmFilter = '';
      _sortsValidationFilter = '';
      const catId = spell.catId && (character.sort_cats || []).some(cat => cat.id === spell.catId)
        ? spell.catId : '__none';
      _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}), [catId]: false };
    }
    _renderSpellsTab(character);
    return true;
  } catch (error) {
    notifySaveError(error);
    return false;
  } finally {
    _sortSaving = false;
    saveBtn?.removeAttribute('disabled');
    saveBtn?.removeAttribute('aria-busy');
  }
}

export async function saveSort(idx, btn = null) {
  if (document.getElementById('s-classic-form')) return _saveClassicSort(idx, btn);
  // Si on édite une action d'item (depuis le shop), on aiguille vers le bon save
  if (_itemEditCtx) return _saveItemSpell();
  if (_sortSaving) return;
  const hasName = _requireSortName();
  const hasNoyau = _requireNoyauSelection();
  if (!hasName || !hasNoyau) return;
    const c = STATE.activeChar; if(!c) return;
    const sorts = c.deck_sorts||[];
  _sortSaving = true;
  const saveBtn = btn || document.querySelector('[data-action="saveSort"]');
  saveBtn?.setAttribute('disabled', '');
  saveBtn?.setAttribute('aria-busy', 'true');
  try {
    const noyau       = document.getElementById('s-noyau')?.value||'';
    const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';

    // Runes depuis _runeCountsEdit
    const runes = _buildRunesFromCounts();

    const totalRunes = (noyau ? 1 : 0) + runes.length;
    const autoPm     = totalRunes * 2 || 2;

    // Types (multi)
    const types = [...(_sortTypesEdit || new Set(['utilitaire']))];

    // Action override (null = auto)

    const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
    const deplMode = _deplModeEdit || null;

    // Validation MJ (3 états) : seuls les admins peuvent la modifier ; sinon on garde la valeur existante
    const prevVal = idx >= 0 ? _sortValidationState(sorts[idx]) : 'pending';
    const mjValidation = STATE.isAdmin
      ? (document.getElementById('s-mj-validation')?.value || 'pending')
      : prevVal;
    const mjValidated  = mjValidation === 'ok'; // rétro-compat booléen

    // PM override (MJ uniquement) : si vide → null (utilise autoPm). Si admin n'existe pas ce champ.
    const pmOvrRaw = STATE.isAdmin ? document.getElementById('s-pm-override')?.value : null;
    const pmOvrInt = pmOvrRaw != null && pmOvrRaw !== '' ? parseInt(pmOvrRaw) : null;
    const pmOverride = (pmOvrInt != null && Number.isFinite(pmOvrInt) && pmOvrInt >= 0)
      ? pmOvrInt
      : (STATE.isAdmin ? null : (idx >= 0 ? sorts[idx]?.pmOverride ?? null : null));
    const newSort = _sanitizeAbsorbedComboFields({
      icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
      mjValidation, mjValidated,
      mjAlwaysMax: STATE.isAdmin
        ? !!document.getElementById('s-mj-always-max')?.checked
        : (idx >= 0 ? !!sorts[idx]?.mjAlwaysMax : false),
      mjAutoHit: STATE.isAdmin
        ? !!document.getElementById('s-mj-auto-hit')?.checked
        : (idx >= 0 ? !!sorts[idx]?.mjAutoHit : false),
      nom:      document.getElementById('s-nom')?.value?.trim() || '',
      pm:       autoPm,
      pmOverride,
      noyau,
      noyauTypeId,
      noyauTypeIds: [..._noyauIdsEdit],
      runes,
      actionMode: (_runeCountsEdit?.[ACTION_RUNE] || 0) > 0
        ? (document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction')
        : null,
      types,
      degats:   document.getElementById('s-degats')?.value||'',
      soin:     document.getElementById('s-soin')?.value||'',
      ca:       document.getElementById('s-ca')?.value||'',
      effet:    document.getElementById('s-effet')?.value||'',
      protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
      // Legacy compat : typeSoin si defensif sans offensif + mode soin
      typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
      catId:         document.getElementById('s-catid')?.value || '',
      actif:         idx>=0 ? sorts[idx].actif : false,
      enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
      enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantBonus:     (() => { const v = document.getElementById('s-enchant-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
      enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantEtatIds:   _collectEnchantEtatIds(),
      enchantStateMoveBonus: (() => { const v = document.getElementById('s-enchant-state-move-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
      enchantStateDmgFormula: document.getElementById('s-enchant-state-dmg-formula')?.value?.trim() || '',
      // enchantSlot legacy : conservé en BDD pour rétro-compat des combos, mais
      // l'UI n'expose plus de slot. Défaut 'arme' aligné sur le bonus dégâts.
      enchantSlot:      idx >= 0 ? (sorts[idx]?.enchantSlot || 'arme') : 'arme',
      enchantEffect:    document.getElementById('s-enchant-effect')?.value
                        ?? (idx >= 0 ? (sorts[idx]?.enchantEffect || '') : ''),
      afflictionSlot:    document.getElementById('s-affliction-slot')?.value || 'torse',
      afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
      afflictionMode:    document.getElementById('s-affliction-mode')?.value || 'dot',
      afflictionEffect:  document.getElementById('s-affliction-effect')?.value
                         ?? (idx >= 0 ? (sorts[idx]?.afflictionEffect || '') : ''),
      afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
      regenerationFormula: document.getElementById('s-regeneration-formula')?.value?.trim() || '',
      afflictionEtatId:  document.getElementById('s-affliction-etat')?.value || null,
      zoneW: null,
      zoneH: null,
      dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
      deplacement: deplMode ? { mode: deplMode } : null,
    ampMode: document.getElementById('s-amp-mode')?.value || 'zone',
    zoneShape: _zoneShapeEdit === 'cross' ? 'cross' : 'rect',
      // Portée override : 0 ou vide = utilise la portée de l'arme par défaut (côté VTT)
      portee:     (() => {
        const raw = document.getElementById('s-portee')?.value;
        if (raw === '' || raw == null) return null;
        const n = parseInt(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      // Stats overrides : '' = suit l'arme principale (auto).
      // On lit uniquement les sélecteurs VISIBLES (helper _readVisibleStatOverride)
      // → évite que le sélecteur d'une section cachée n'écrase la sélection utilisateur.
      toucherStat: _readVisibleStatOverride('s-toucher-stat'),
      degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
      invocation:   _buildInvocationFromDOM(),
      // Note MJ : VERROUILLÉE côté joueur — un joueur ne peut ni la modifier ni
      // l'effacer, elle est reconduite telle quelle (le champ de la forge n'est
      // qu'un affichage pour lui).
      mjNotes:      STATE.isAdmin
        ? (document.getElementById('s-mj-notes')?.value?.trim() || '')
        : (idx >= 0 ? (sorts[idx]?.mjNotes || '') : ''),
    });
    // Id STABLE (les index bougent au tri/drag ; le VTT peut référencer le sort).
    newSort.id = (idx >= 0 && sorts[idx]?.id) || spellUid();
    // Validation : côté JOUEUR, un sort VALIDÉ modifié repasse « À valider » et
    // sort du Deck ; un sort REFUSÉ corrigé repart AUSSI dans la file du MJ
    // (sinon il resterait refusé à jamais). Le MJ pilote la validation
    // explicitement (sélecteur) → on ne touche pas à son choix.
    if (!STATE.isAdmin && idx >= 0 && (prevVal === 'ok' || prevVal === 'no')
        && _sortContentSig(sorts[idx]) !== _sortContentSig(newSort)) {
      newSort.mjValidation = 'pending';
      newSort.mjValidated  = false;
      newSort.actif        = false;
      showNotif(prevVal === 'ok'
        ? 'Sort modifié → repasse « À valider » et sort du Deck.'
        : 'Sort corrigé → renvoyé en validation au MJ.', 'info');
    }

    const isNew = idx < 0;
    // Copie de travail : l'état local (c.deck_sorts) n'est modifié QU'AU SUCCÈS.
    const next = [...sorts];
    if (idx >= 0) next[idx] = newSort; else next.push(newSort);
    ensureSpellIds(next);
    if (!(await trySave('characters', c.id, { deck_sorts: next }))) return;   // échec : modal ouverte, rien perdu

    c.deck_sorts = next;
    // Sync les références pour que les filtres / re-render lisent la version fraîche
    if (charSession.getCurrentChar()?.id === c.id) charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
    if (STATE.activeChar?.id === c.id)    STATE.activeChar    = c;
    _sortModalBaseline = null; clearModalCloseGuard();   // désarme la garde avant la fermeture
    closeModal();
    const _setDelta = getArmorSetData(c)?.modifiers?.spellPmDelta || 0;
    showNotif(`Sort enregistré — ${_effectiveSortPm(newSort, _setDelta)} PM`, 'success');

    // ── Sur ajout : s'assure que le nouveau sort soit visible ────────
    if (isNew) {
      // Reset les filtres qui pourraient cacher le sort fraîchement créé
      _sortsSearch = '';
      _sortsTypeFilter = '';
      _sortsRuneFilter = '';
      _sortsNoyauFilter = '';
      _sortsPmFilter = '';
      _sortsValidationFilter = '';
      // Déplie la catégorie où le sort vient d'être ajouté
      const newCatId = newSort.catId
        && (c.sort_cats || []).find(cat => cat.id === newSort.catId)
        ? newSort.catId : '__none';
      _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}) };
      _sortsCatCollapsed[newCatId] = false;
    }

    // Force un re-render du tab Sorts en V3 si dispo, sinon fallback legacy
    _renderSpellsTab(c);
  } finally {
    _sortSaving = false;
    saveBtn?.removeAttribute('disabled');
    saveBtn?.removeAttribute('aria-busy');
  }
}

/** Build d'un objet "sort" depuis le formulaire courant — réutilisable pour items. */
function _buildSortFromForm(idx, prevList = []) {
  const noyau       = document.getElementById('s-noyau')?.value||'';
  const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';
  const runes = _buildRunesFromCounts();
  const totalRunes = (noyau ? 1 : 0) + runes.length;
  const autoPm     = totalRunes * 2 || 2;
  const types = [...(_sortTypesEdit || new Set(['utilitaire']))];
  const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = _deplModeEdit || null;
  const prevVal = idx >= 0 ? _sortValidationState(prevList[idx]) : 'pending';
  const mjValidation = STATE.isAdmin
    ? (document.getElementById('s-mj-validation')?.value || 'pending')
    : prevVal;
  const mjValidated  = mjValidation === 'ok'; // rétro-compat booléen
  const pmOvrRaw = STATE.isAdmin ? document.getElementById('s-pm-override')?.value : null;
  const pmOvrInt = pmOvrRaw != null && pmOvrRaw !== '' ? parseInt(pmOvrRaw) : null;
  const pmOverride = (pmOvrInt != null && Number.isFinite(pmOvrInt) && pmOvrInt >= 0)
    ? pmOvrInt
    : (STATE.isAdmin ? null : (idx >= 0 ? prevList[idx]?.pmOverride ?? null : null));
  return _sanitizeAbsorbedComboFields({
    icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
    mjValidation, mjValidated,
    nom:      document.getElementById('s-nom')?.value?.trim() || '',
    pm:       autoPm,
    pmOverride,
    mjAlwaysMax: STATE.isAdmin
      ? !!document.getElementById('s-mj-always-max')?.checked
      : (idx >= 0 ? !!prevList[idx]?.mjAlwaysMax : false),
    mjAutoHit: STATE.isAdmin
      ? !!document.getElementById('s-mj-auto-hit')?.checked
      : (idx >= 0 ? !!prevList[idx]?.mjAutoHit : false),
    noyau, noyauTypeId, runes,
    actionMode: (_runeCountsEdit?.[ACTION_RUNE] || 0) > 0
      ? (document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction')
      : null,
    types,
    degats:   document.getElementById('s-degats')?.value||'',
    soin:     document.getElementById('s-soin')?.value||'',
    ca:       document.getElementById('s-ca')?.value||'',
    effet:    document.getElementById('s-effet')?.value||'',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantBonus:     (() => { const v = document.getElementById('s-enchant-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantEtatIds:   _collectEnchantEtatIds(),
    enchantStateMoveBonus: (() => { const v = document.getElementById('s-enchant-state-move-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantStateDmgFormula: document.getElementById('s-enchant-state-dmg-formula')?.value?.trim() || '',
    enchantSlot:      idx >= 0 ? (prevList[idx]?.enchantSlot || 'arme') : 'arme',
    enchantEffect:    document.getElementById('s-enchant-effect')?.value ?? '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'torse',
    afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
    afflictionMode:   document.getElementById('s-affliction-mode')?.value || 'dot',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value ?? '',
    afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
    regenerationFormula: document.getElementById('s-regeneration-formula')?.value?.trim() || '',
    afflictionEtatId: document.getElementById('s-affliction-etat')?.value || null,
    zoneW: null, zoneH: null,
    dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
    deplacement: deplMode ? { mode: deplMode } : null,
    ampMode: document.getElementById('s-amp-mode')?.value || 'zone',
    zoneShape: _zoneShapeEdit === 'cross' ? 'cross' : 'rect',
    portee:     (() => {
      const raw = document.getElementById('s-portee')?.value;
      if (raw === '' || raw == null) return null;
      const n = parseInt(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    toucherStat: _readVisibleStatOverride('s-toucher-stat'),
    degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
    mjNotes:      document.getElementById('s-mj-notes')?.value?.trim() || '',
  });
}

/** Hook de sauvegarde aiguillée : utilisé quand on édite une action d'item.
 *  Lance _itemEditCtx.onSave avec l'item mis à jour, puis ferme. */
async function _saveItemSpell() {
  if (!_itemEditCtx) return false;
  try {
    const hasName = _requireSortName();
    const hasNoyau = _requireNoyauSelection();
    if (!hasName || !hasNoyau) return false;
    const { item, idx, onSave } = _itemEditCtx;
    const acts = Array.isArray(item.actions) ? [...item.actions] : [];
    const newSort = _buildSortFromForm(idx, acts);
    if (!newSort.id) newSort.id = idx >= 0 ? (acts[idx]?.id || `a${Date.now().toString(36)}`) : `a${Date.now().toString(36)}`;
    if (idx >= 0) acts[idx] = { ...acts[idx], ...newSort };
    else acts.push(newSort);
    item.actions = acts;
    const cb = onSave;
    _itemEditCtx = null;
    // 1) Pop la modal de sort → la modal du shop est restaurée à l'écran
    closeModal();
    // 2) Maintenant on déclenche le callback shop pour rafraîchir la section actions
    //    (l'#si-actions-host est de nouveau dans le DOM après la restauration)
    await cb(item);
    showNotif(`Action enregistrée — ${newSort.pm} PM`, 'success');
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}

// (le check _itemEditCtx est désormais en tête de saveSort — pas de monkey-patch)

registerActions({
  _classicRefresh:        ()    => _refreshClassicSpellForm(),
  _classicTargetChanged:  ()    => _classicTargetChanged(),
  _classicStateChanged:   ()    => _classicStateChanged(),
  _sortsSearchInput:      (el)  => _sortsSetSearch(el.value),
  _refreshAutoValChips:   ()    => _refreshAutoValChips(),
  _csMjValToggle:         (el)  => el.closest('.cs-mj-validation')?.classList.toggle('is-on', el.checked),
  _csSetMjVal:            (btn) => {
    const val = btn.dataset.mjval;
    const inp = document.getElementById('s-mj-validation');
    if (inp) inp.value = val;
    document.querySelectorAll('.cs-mjval-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mjval === val));
    _updateSortPreview();
  },
  addSort:                ()    => addSort(),
  openSortCatEditor:      ()    => openSortCatEditor(),
  toggleSortDetail:       (btn) => toggleSortDetail(Number(btn.dataset.idx)),
  editSort:               (btn) => editSort(Number(btn.dataset.idx)),
  saveSort:               (btn) => saveSort(Number(btn.dataset.idx), btn),
  selectNoyau:            (btn) => selectNoyau(btn, btn.dataset.noyauId, btn.dataset.noyauLabel, btn.dataset.noyauColor),
  runeIncrement:          (btn) => runeIncrement(btn.dataset.nom),
  runeDecrement:          (btn) => runeDecrement(btn.dataset.nom),
  _mjAdjRuneLimit:        (btn) => _mjAdjRuneLimit(btn.dataset.delta),
  closeModalDirect:       ()    => closeModalDirect(),
  _enableSortCustom:      (btn) => _enableSortCustom(btn.dataset.field),
  _disableSortCustom:     (btn) => _disableSortCustom(btn.dataset.field),
  _sortsSetSearch:        (btn) => _sortsSetSearch(btn.dataset.val, { immediate: true }),
  _sortsSetMode:          (btn) => _sortsSetMode(btn.dataset.mode),
  _sortsSetType:          (btn) => _sortsSetType(btn.dataset.type),
  _sortsSetRune:          (btn) => _sortsSetRune(btn.dataset.rune),
  _sortsSetNoyau:         (btn) => _sortsSetNoyau(btn.dataset.noyau),
  _sortsClearFacets:      ()    => _sortsClearFacets(),
  _sortsSetPm:            (btn) => _sortsSetPm(btn.dataset.pm),
  _sortsSetDensity:       (btn) => _sortsSetDensity(btn.dataset.density),
  _sortsHintPreparable:   ()    => _sortsHintPreparable(),
  _sortsTileTap:          (btn) => _sortsTileTap(Number(btn.dataset.idx)),
  _sortsSheetToggle:      (btn) => _sortsSheetToggle(Number(btn.dataset.idx)),
  _sortsReplaceWith:      (btn) => _sortsReplaceWith(Number(btn.dataset.idx)),
  _sortsCancelReplace:    ()    => _sortsCancelReplace(),
  _sortsSetValidation:    (btn) => _sortsSetValidation(btn.dataset.val),
  _sortsSetOrder:         (btn) => _sortsSetOrder(btn.dataset.order),
  _sortsAdjRuneLimit:     (btn) => _sortsAdjRuneLimit(btn.dataset.delta),
  _sortsSetCardCat:       (el)  => _sortsSetCardCat(Number(el.dataset.idx), el.value),
  _sortsToggleCat:        (btn) => _sortsToggleCat(btn.dataset.id),
  _sortsFocusCategory:    (btn) => _sortsFocusCategory(btn.dataset.id),
  _sortsToggleDuplicateRecipes: () => _sortsToggleDuplicateRecipes(),
  _sortsFocusRecipe:      (btn) => _sortsFocusRecipe(btn.dataset.recipe),
  _sortsClearRecipeFilter: ()   => _sortsClearRecipeFilter(),
  _sortsInspectSpell:     (btn) => _sortsInspectSpell(Number(btn.dataset.idx)),
  _sortsCloseInspector:   ()    => _sortsCloseInspector(),
  _sortsToggleCompare:    (btn) => _sortsToggleCompare(Number(btn.dataset.idx)),
  _sortsClearCompare:     ()    => _sortsClearCompare(),
  _sortsToggleAllCats:    ()    => _sortsToggleAllCats(),
  _sortsResetFilters:     ()    => _sortsResetFilters(),
  _sortsToggleFilters:    ()    => _sortsToggleFilters(),
  _sortsToggleMenu:       ()    => _sortsToggleMenu(),
  _sortsToggleAnalysis:   ()    => _sortsToggleAnalysis(),
  _renameSortCat:         (el)  => _renameSortCat(Number(el.dataset.idx), el.value),
  _recolorSortCat:        (btn) => _recolorSortCat(Number(btn.dataset.idx), btn.dataset.col),
  _delSortCat:            (btn) => _delSortCat(Number(btn.dataset.idx)),
  _addSortCat:            (btn) => _addSortCat(btn.dataset.col),
  _pickNewSortCatColor:   (btn) => _pickNewSortCatColor(btn),
  _toggleSortType:        (btn) => _toggleSortType(btn.dataset.type),
  _selectDeplMode:        (btn) => _selectDeplMode(btn.dataset.val),
  _selectActionMode:      (btn) => _selectActionMode(btn.dataset.val),
  _selectProtMode:        (btn) => _selectProtMode(btn.dataset.val),
  _selectAmpMode:         (btn) => _selectAmpMode(btn.dataset.val),
  _selectZoneShape:       (btn) => _selectZoneShape(btn.dataset.val),
  _selectEnchantMode:     (btn) => _selectEnchantMode(btn.dataset.val),
  _selectAfflictionMode:  (btn) => _selectAfflictionMode(btn.dataset.val),
  _toggleSortIconPicker:  ()    => _toggleSortIconPicker(),
  _applyCustomSortIcon:   ()    => _applyCustomSortIcon(),
  _pickSortIcon:          (btn) => _pickSortIcon(btn.dataset.icon),
  _pickSpellSuggestion:   (btn) => _pickSpellSuggestion(btn.dataset.cat, btn.dataset.encoded),
  _invPickImage:          ()    => _invPickImage(),
  _invClearImage:         ()    => _invClearImage(),
  _invCropSave:           ()    => _invCropSave(),
  _invCropCancel:         ()    => _invCropCancel(),
  _openInvocationConfig:  (btn) => openInvocationConfig(Number(btn.dataset.idx)),
  _invCfgAddAction:       ()    => _invCfgAddAction(),
  _invCfgEditAction:      (btn) => _invCfgEditAction(btn.dataset.aidx),
  _invCfgDeleteAction:    (btn) => _invCfgDeleteAction(btn.dataset.aidx),
  // Bibliothèque d'invocations + sélecteur
  openInvocationLibrary:  ()    => openInvocationLibrary(),
  _editLibInv:            (btn) => _editLibInv(Number(btn.dataset.idx)),
  _deleteLibInv:          (btn) => _deleteLibInv(Number(btn.dataset.idx)),
  _saveLibInv:            ()    => _saveLibInv(),
  _libInvBack:            ()    => _libInvBack(),
  _libInvAddAction:       ()    => _libInvAddAction(),
  _libInvEditAction:      (btn) => _libInvEditAction(btn.dataset.aidx),
  _libInvDeleteAction:    (btn) => _libInvDeleteAction(btn.dataset.aidx),
  _toggleInvSelect:       (btn) => _toggleInvSelect(btn.dataset.id),
});
