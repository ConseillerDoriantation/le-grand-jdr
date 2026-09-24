// ══════════════════════════════════════════════════════════════════════════════
// VTT-MINI-FICHE.JS — Mini-fiche personnage (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// Popup 4 onglets (Combat / Équipement / Sorts / Inventaire / Notes) d'un perso
// joueur. État partagé miniUid/miniCharId via VS ; affichage de sorts réutilisé
// depuis vtt.js (helpers _vttSort*/_vttDisplayRunes, circulaires).
// ══════════════════════════════════════════════════════════════════════════════

import { db, updateDoc, writeBatch, addDoc, serverTimestamp } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc, _norm, loadingHtml } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { openModal, closeModalDirect } from '../../shared/modal.js';
import { getArmorSetData, syncEquipmentAfterInventoryMutation, _getTraits } from '../../shared/equipment-utils.js';
import { calcSpellDuration, calcSpellTargets, getProtectionRestoreMode } from '../../shared/spell-runes.js';
import { ZONE_SHAPES, _zoneDims, _zoneCount } from '../../shared/spell-zones.js';
import { getDamageTypeById } from '../../shared/damage-types.js';
import { calcCA, calcDeckMax, calcPMMax, calcPVMax, calcPalier, calcVitesse, calcOr,
         computeEquipStatsBonus, getItemStatBonus, getMaitriseBonus, getMod,
         sortCharactersForDisplay, favoriteFirst } from '../../shared/char-stats.js';
import { useGold } from '../../shared/economy.js';
import { loadCollection } from '../../data/firestore.js'; // lecture recettes/boutique (couche quota)
import { shopItemToInvEntry, getInventoryItemImage } from '../../shared/inventory-utils.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry } from '../../shared/inventory-history.js';
import { bumpSkill } from '../../shared/stats.js';
import { _chrRef, _logCol } from './vtt-refs.js'; // refs Firestore perso + log VTT (leaf)
import { _STAT_COLOR, _VTT_RUNE_META, _MS_BONUS_BUFF } from './vtt-constants.js'; // constantes pures (leaf)
import { _vttPanelError } from './vtt-utils.js'; // frontière d'erreur (leaf)
import { resolveCharacterControlToken } from './vtt-token-control.js';
import { _effectDisplay, _vttSortDmgFormula,
         _vttSortSoinFormula, _vttAmpDispCircleSize, _vttSpellActionMode, _vttDisplayRunes,
         } from './vtt-spell-display.js'; // formules de sorts (leaf — mini-fiche découplée de vtt.js)
import { spellCostRes, _calcSortMana } from '../characters/spells-calc.js'; // ressource de coût + régén PM
import { _renderPresenceCol } from './vtt-presence.js'; // circ. (toggle mini → refresh colonne)
import {
  equipmentSlotAcceptsItem, getEquipmentSlot, getEquipmentSlots,
  getPrimaryWeaponSlotId,
} from '../../shared/equipment-slots.js';
import { canControlCharacter, getControlledCharacters } from '../../shared/character-state.js';
import { deckHasRoomFor, getDeckUsage, isAlwaysPreparedSpell } from '../../shared/spell-deck.js';
import { lsJson } from '../../shared/local-storage.js';

let _miniTab = 'combat'; // onglet actif de la mini-fiche (état local)
let _msSac   = 'obj';    // sous-onglet du Sac : 'obj' | 'craft' | 'bourse'
let _msAttackSlot = null; // arme affichée dans Combat (principale / secondaire)
let _miniCollapsed = false; // rail compact de la mini-fiche

// ── Constantes & état local ─────────────────────────────────────────
const _MS_STATS   = [
  { key:'force',        abbr:'FOR' }, { key:'dexterite',    abbr:'DEX' },
  { key:'constitution', abbr:'CON' }, { key:'intelligence', abbr:'INT' },
  { key:'sagesse',      abbr:'SAG' }, { key:'charisme',     abbr:'CHA' },
];
let _msOpenNote   = null; // index de la note dépliée (onglet Notes)
let _msOpenSpell  = null; // id/index du sort déplié (onglet Sorts)
let _msInvQuery   = '', _msInvCat  = 'all';
let _msSortQuery  = '', _msSortCat = 'all';
let _msCraftQuery = '';   // filtre de recherche de l'onglet Craft

// MINI-FICHE PERSONNAGE — 4 onglets
// ═══════════════════════════════════════════════════════════════════

// Slots canoniques — mêmes clés que la vraie fiche personnage (characters/combat.js
// + characters/equipment.js). NE PAS inventer d'emplacements ici.
const _msSlots = () => getEquipmentSlots();

// ─── Helpers locaux ───────────────────────────────────────────────

function _msCatItem(item) {
  const t = item?.template || '';
  if (t === 'arme'   || item?.degats)                     return 'arme';
  if (t === 'armure' || item?.slotArmure || item?.typeArmure) return 'armure';
  if (t === 'bijou'  || item?.slotBijou)                  return 'bijou';
  if (t === 'consommable')                                return 'consommable';
  return 'divers';
}

function _msEquipStatBonuses(item = {}) {
  return _MS_STATS
    .map(s => ({ ...s, value: getItemStatBonus(item, s.key) }))
    .filter(s => s.value);
}

function _msEquipTraits(item = {}) {
  return _getTraits(item).map(t => String(t || '').trim()).filter(Boolean);
}

function _msEquipSourceItem(equipped = {}, inv = []) {
  if (!equipped?.nom) return equipped;
  const idx = Number(equipped.sourceInvIndex);
  const source = Number.isInteger(idx) && idx >= 0 ? inv[idx] : null;
  if (!source?.nom) return equipped;
  if (equipped.itemId && source.itemId && equipped.itemId !== source.itemId) return equipped;
  if (equipped.itemId && source.itemId === equipped.itemId) return source;
  return _norm(source.nom || '') === _norm(equipped.nom || '') ? source : equipped;
}

function _msEquipContributionHtml(item = {}, opts = {}) {
  if (!item?.nom) return '';
  const compact = !!opts.compact;
  const label = opts.label ? `<span class="vtt-ms-equip-label">${_esc(opts.label)}</span>` : '';
  const stats = _msEquipStatBonuses(item);
  const traits = _msEquipTraits(item);
  const statHtml = stats.map(s => `
    <span class="vtt-ms-equip-chip is-stat ${s.value > 0 ? 'is-positive' : 'is-negative'}">
      ${s.abbr} ${s.value > 0 ? '+' : ''}${s.value}
    </span>`).join('');
  const shownTraits = compact ? traits.slice(0, 3) : traits;
  const traitHtml = shownTraits.map(t =>
    `<span class="vtt-ms-equip-chip is-trait" title="${_esc(t)}">${_esc(t)}</span>`
  ).join('');
  const hiddenCount = traits.length - shownTraits.length;
  const moreHtml = hiddenCount > 0
    ? `<span class="vtt-ms-equip-chip is-more" title="${_esc(traits.slice(shownTraits.length).join(', '))}">+${hiddenCount}</span>`
    : '';
  if (!statHtml && !traitHtml && !moreHtml) return '';
  return `<div class="vtt-ms-equip-contrib${compact ? ' is-compact' : ''}">${label}${statHtml}${traitHtml}${moreHtml}</div>`;
}

// Chips propres d'un objet (Sac) : bonus de stats + CA/VIT (vert/rouge) et
// traits (violet). Mêmes données que _msEquipContributionHtml, style épuré.
function _msItemChips(item = {}) {
  const parts = [];
  _msEquipStatBonuses(item).forEach(s => parts.push(`<span class="vtt-ms-chip ${s.value > 0 ? 'pos' : 'neg'}">${s.abbr} ${s.value > 0 ? '+' : ''}${s.value}</span>`));
  const ca = parseInt(item.ca) || 0; if (ca) parts.push(`<span class="vtt-ms-chip pos">CA ${ca > 0 ? '+' : ''}${ca}</span>`);
  const vit = parseInt(item.vitesse ?? item.vit ?? item.bonusVitesse) || 0; if (vit) parts.push(`<span class="vtt-ms-chip ${vit > 0 ? 'pos' : 'neg'}">VIT ${vit > 0 ? '+' : ''}${vit}</span>`);
  _msEquipTraits(item).forEach(t => parts.push(`<span class="vtt-ms-chip trait" title="${_esc(t)}">${_esc(t)}</span>`));
  return parts.length ? `<div class="vtt-ms-chips">${parts.join('')}</div>` : '';
}

function _msBuildEquipItem(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = getEquipmentSlot(slot)?.kind === 'weapon';
  const base = {
    nom: item.nom||'',
    fo: getItemStatBonus(item, 'force'), dex: getItemStatBonus(item, 'dexterite'),
    in: getItemStatBonus(item, 'intelligence'), sa:  getItemStatBonus(item, 'sagesse'),
    co: getItemStatBonus(item, 'constitution'), ch:  getItemStatBonus(item, 'charisme'),
    traits: _msEquipTraits(item),
    sourceInvIndex: invIndex, itemId: item.itemId||'',
  };
  if (isWeapon) {
    const statAtk = item.toucherStat || item.statAttaque
      || (String(item.format||'').includes('Mag.') ? 'intelligence'
          : String(item.format||'').includes('Dist.') ? 'dexterite' : 'force');
    return { ...base,
      degats: item.degats||'', degatsStat: item.degatsStat||statAtk,
      toucherStat: statAtk, typeArme: item.typeArme||'',
      portee: item.portee||'', particularite: item.particularite||item.effet||'',
      format: item.format||'' };
  }
  return { ...base,
    ca: parseInt(item.ca)||0, typeArmure: item.typeArmure||'',
    slotArmure: item.slotArmure||'', slotBijou: item.slotBijou||'' };
}

function _msCanEdit(uid, charId = VS.miniCharId) {
  if (STATE.isAdmin) return true;
  const character = charId ? VS.characters[charId] : null;
  if (character) return canControlCharacter(character, STATE.user?.uid);
  return !!uid && STATE.user?.uid === uid;
}

function _msAvailableCharacters(uid) {
  const all = Object.values(VS.characters || {});
  // Le MJ conserve le contexte du joueur ouvert. Pour un joueur, la source de
  // vérité est le contrôle canonique : personnages possédés + tous les délégués.
  const available = STATE.isAdmin
    ? all.filter(character => character.uid === uid)
    : getControlledCharacters(all, STATE.user?.uid, { sorted: false });
  return favoriteFirst(available);
}

// Sécurité — droit d'OUVRIR/VOIR une mini-feuille (contenu privé : équipement,
// sac, or, notes…). Un joueur ne peut voir que la sienne, ou celle d'un
// personnage qu'il contrôle réellement via un token possédé/délégué. Le MJ, tout.
// Empêche de consulter la fiche d'un autre joueur depuis la présence ou un token.
function _msCanView(uid, charId = null) {
  if (_msCanEdit(uid, charId)) return true;
  if (charId) return !!resolveCharacterControlToken(charId, VS.tokens, STATE.user?.uid, VS.characters);
  return false;
}

// La délégation donne accès à la fiche complète. Le fallback token conserve la
// compatibilité avec une ancienne délégation pas encore migrée sur le personnage.
function _msCanEditVitals(charId, uid) {
  if (_msCanEdit(uid, charId)) return true;
  return !!resolveCharacterControlToken(charId, VS.tokens, STATE.user?.uid, VS.characters);
}

// Reproduit STRICTEMENT la logique de characters/equipment.js (editEquipSlot)
// pour que les items équipables dans la vraie fiche le soient aussi ici.
function _msItemFitsSlot(item, slot, equip, idx) {
  if (!item?.nom) return false;
  // Déjà équipé dans un autre slot → exclu
  if (Object.entries(equip).some(([s, e]) => s !== slot && e?.sourceInvIndex === idx)) return false;

  return equipmentSlotAcceptsItem(slot, item);
}

// ─── Icônes SVG monochromes (remplacent les emojis multicolores, incohérents) ──
// Style « ligne » (currentColor), taille 1em, cohérent avec le reste du design.
const _MS_ICONS = {
  combat: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>',
  equip:  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  sorts:  '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/>',
  inv:    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  craft:  '<path d="m15.5 12.5-8 8a2.12 2.12 0 0 1-3-3l8-8"/><path d="M17.64 15 22 10.64"/><path d="m20.9 11.7-1.24-1.25c-.6-.6-.94-1.4-.94-2.25v-.86L16 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h.86c.85 0 1.65.34 2.25.94l1.24 1.24"/>',
  compte: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  notes:  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  dice:   '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/><circle cx="15.5" cy="8.5" r="1.1"/><circle cx="8.5" cy="15.5" r="1.1"/>',
  bolt:   '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  send:   '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6 12 2 8 6"/><path d="M12 2v13"/>',
  trash:  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  ring:   '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10 12 4l3.5 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x:      '<path d="M18 6 6 18M6 6l12 12"/>',
  potion: '<path d="M9 3h6"/><path d="M10 3v5L5 17a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/>',
  misc:   '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
};
function _msIco(name, cls = 'vtt-ms-ic') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_MS_ICONS[name] || ''}</svg>`;
}

// ─── Handlers exposés ────────────────────────────────────────────

function _vttMsTab(tab) { _miniTab = tab; _miniCollapsed = false; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsToggleCollapsed() { _miniCollapsed = !_miniCollapsed; _msPop = null; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsAttackSlot(slotId) { _msAttackSlot = slotId; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// ── Filtres des onglets Sac / Sorts ──────────────────────────────
// Barre commune : puces de catégorie + champ de recherche. `kind` = 'inv'|'sorts'.
// `chips` = [{ key, label, color? }] ; la puce active vient de l'état module.
function _msFilterBar(kind, chips, query) {
  const activeCat = kind === 'inv' ? _msInvCat : kind === 'sorts' ? _msSortCat : 'all';
  const catFn     = kind === 'inv' ? '_vttMsInvCat' : '_vttMsSortCat';
  const searchFn  = kind === 'inv' ? '_vttMsInvSearch' : kind === 'sorts' ? '_vttMsSortSearch' : '_vttMsCraftSearch';
  const clrFn     = kind === 'inv' ? '_vttMsInvClear' : kind === 'sorts' ? '_vttMsSortClear' : '_vttMsCraftClear';
  // ch.label / ch.color viennent de noms de catégorie saisis par le joueur → échappés.
  const chipsHtml = chips.map(ch =>
    `<button class="vtt-ms-fchip${activeCat===ch.key?' active':''}"${ch.color?` style="--chip-col:${_esc(ch.color)}"`:''}
      data-vtt-fn="${catFn}" data-vtt-args="${ch.key}|$this">${_esc(ch.label)}</button>`
  ).join('');
  const ph = kind === 'inv' ? 'Rechercher un objet…' : kind === 'sorts' ? 'Rechercher un sort…' : 'Rechercher…';
  return `<div class="vtt-ms-filter" data-kind="${kind}">
    <div class="vtt-ms-fsearch">
      <span class="vtt-ms-fsearch-ic">${_msIco('search')}</span>
      <input type="text" class="vtt-ms-fsearch-input" placeholder="${ph}"
        value="${_esc(query)}" data-vtt-fn="${searchFn}" data-vtt-on="input" data-vtt-args="$value">
      ${query ? `<button class="vtt-ms-fsearch-clr" title="Effacer" data-vtt-fn="${clrFn}">${_msIco('x')}</button>` : '<kbd class="vtt-ms-fsearch-kbd">/</kbd>'}
    </div>
    ${chipsHtml ? `<div class="vtt-ms-fchips">${chipsHtml}</div>` : ''}
  </div>`;
}

// Applique le filtre Sac (catégorie + recherche) par show/hide, sans re-render.
function _msApplyInvFilter() {
  const q = _norm(_msInvQuery);
  const groups = document.querySelectorAll('#vtt-mini-panel .vtt-ms-inv-group');
  let anyVisible = false;
  groups.forEach(g => {
    if (_msInvCat !== 'all' && g.dataset.cat !== _msInvCat) { g.style.display = 'none'; return; }
    let n = 0;
    g.querySelectorAll('.vtt-ms-inv-item').forEach(it => {
      const m = !q || (it.dataset.name || '').includes(q);
      it.style.display = m ? '' : 'none';
      if (m) n++;
    });
    g.style.display = n ? '' : 'none';
    if (n) anyVisible = true;
  });
  _msToggleEmpty('inv', anyVisible || !groups.length);
}

// Applique le filtre Sorts (catégorie / deck actif + recherche) sans re-render.
function _msApplySortFilter() {
  const q = _norm(_msSortQuery);
  const cards = document.querySelectorAll('#vtt-mini-panel .vtt-ms-spellgrid .vtt-ms-sp');
  let anyVisible = false;
  cards.forEach(card => {
    const catOk = _msSortCat === 'all'
      || (_msSortCat === '__deck' ? card.dataset.actif === '1' : card.dataset.cat === _msSortCat);
    const m = catOk && (!q || (card.dataset.name || '').includes(q));
    card.style.display = m ? '' : 'none';
    if (m) anyVisible = true;
  });
  _msToggleEmpty('sorts', anyVisible || !cards.length);
}

// Applique le filtre Craft (recherche : nom / type / effet / ingrédients) sans re-render.
function _msApplyCraftFilter() {
  const q = _norm(_msCraftQuery);
  const cards = document.querySelectorAll('#vtt-mini-panel .vtt-ms-craft .vtt-ms-craft-card');
  let anyVisible = false;
  cards.forEach(card => {
    const m = !q || (card.dataset.name || '').includes(q);
    card.style.display = m ? '' : 'none';
    if (m) anyVisible = true;
  });
  _msToggleEmpty('craft', anyVisible || !cards.length);
}

function _msToggleEmpty(kind, anyVisible) {
  const el = document.querySelector(`#vtt-mini-panel .vtt-ms-filter-empty[data-kind="${kind}"]`);
  if (el) el.style.display = anyVisible ? 'none' : '';
}

function _msSetActiveChip(kind, btn) {
  const root = document.querySelector(`#vtt-mini-panel .vtt-ms-filter[data-kind="${kind}"]`);
  root?.querySelectorAll('.vtt-ms-fchip').forEach(b => b.classList.toggle('active', b === btn));
}

function _vttMsInvSearch(val)  { _msInvQuery = val || ''; _msApplyInvFilter(); _msSyncClearBtn('inv'); }
function _vttMsInvCat(cat, btn){ _msInvCat = cat; _msSetActiveChip('inv', btn); _msApplyInvFilter(); }
function _vttMsInvClear()      { _msInvQuery = ''; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsSortSearch(val) { _msSortQuery = val || ''; _msApplySortFilter(); _msSyncClearBtn('sorts'); }
function _vttMsSortCat(cat,btn){ _msSortCat = cat; _msSetActiveChip('sorts', btn); _msApplySortFilter(); }
function _vttMsSortClear()     { _msSortQuery = ''; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsCraftSearch(val){ _msCraftQuery = val || ''; _msApplyCraftFilter(); _msSyncClearBtn('craft'); }
function _vttMsCraftClear()    { _msCraftQuery = ''; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// Affiche/masque le bouton ✕ de la recherche sans re-render complet (préserve le focus).
function _msSyncClearBtn(kind) {
  const query = kind === 'inv' ? _msInvQuery : kind === 'sorts' ? _msSortQuery : _msCraftQuery;
  const wrap  = document.querySelector(`#vtt-mini-panel .vtt-ms-filter[data-kind="${kind}"] .vtt-ms-fsearch`);
  if (!wrap) return;
  let btn = wrap.querySelector('.vtt-ms-fsearch-clr');
  if (query && !btn) {
    btn = document.createElement('button');
    btn.className = 'vtt-ms-fsearch-clr'; btn.title = 'Effacer'; btn.textContent = '✕';
    btn.dataset.vttFn = kind === 'inv' ? '_vttMsInvClear' : kind === 'sorts' ? '_vttMsSortClear' : '_vttMsCraftClear';
    wrap.appendChild(btn);
  } else if (!query && btn) {
    btn.remove();
  }
}

function _msPct(cur, max) {
  return max > 0 ? Math.max(0, Math.min(100, Math.round((Math.max(0, cur) / max) * 100))) : 0;
}

// _msVitalCard / _msVitalColor retirés : les PV/PM ne sont plus affichés dans la
// mini-feuille (le dock d'identité du pupitre les gère, en live et éditables).

// Neutralisé par la refonte : l'en-tête d'onglet est remplacé par la zone fixe
// (chiffres clés + caractéristiques). Conservé (vide) le temps que tous les
// onglets soient migrés.
function _msTabIntro() { return ''; }

// ── Zone fixe (refonte) : anneau XP, chiffres clés, caractéristiques ──
function _msXpUp(c) { const p = calcPalier(parseInt(c?.niveau) || 1); return p > 0 && (parseInt(c?.exp) || 0) >= p; }
function _msRingHtml(c, size = 58) {
  const xp = parseInt(c?.exp) || 0, niv = parseInt(c?.niveau) || 1, palier = calcPalier(niv);
  const p = palier > 0 ? Math.min(1, xp / palier) : 0;
  const r = size / 2 - 2.5, L = 2 * Math.PI * r, up = _msXpUp(c);
  return `<svg class="vtt-ms-ring${up ? ' up' : ''}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border-md,var(--border))" stroke-width="3"/>
    <circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${up ? '#f59e0b' : 'var(--arcane,#9d6fff)'}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(L * p).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
function _msFactsHtml(c) {
  const deckMax = calcDeckMax(c), du = getDeckUsage(c?.deck_sorts);
  return `<div class="vtt-ms-facts">
    <div class="vtt-ms-fact" title="Classe d'armure"><b>${calcCA(c)}</b><small>CA</small></div>
    <div class="vtt-ms-fact" title="Vitesse"><b>${calcVitesse(c)}</b><small>Vit.</small></div>
    <button class="vtt-ms-fact btn" data-vtt-fn="_vttMsTab" data-vtt-args="sorts" title="Sorts préparés"><b>${du.used}/${deckMax}</b><small>Deck</small></button>
    <button class="vtt-ms-fact btn" data-vtt-fn="_vttMsGoPurse" title="Ouvrir la bourse"><b>${calcOr(c)}</b><small>Or</small></button>
  </div>`;
}
function _msStatsFixedHtml(c) {
  return `<div class="vtt-ms-stats2">${_MS_STATS.map(s => {
    const base = (c?.stats || {})[s.key] || 8, bonus = (c?.statsBonus || {})[s.key] || 0;
    const total = Math.min(22, base + bonus), mod = getMod(c, s.key), col = _STAT_COLOR[s.abbr];
    const sgn = n => (n >= 0 ? '+' + n : '' + n);
    return `<div class="vtt-ms-st" style="--sc:${col}" title="${s.abbr} ${total} · base ${base}${bonus ? ` ${sgn(bonus)} équipement` : ''}">${bonus ? `<i>${sgn(bonus)}</i>` : ''}<small>${s.abbr}</small><b>${sgn(mod)}</b><span>${total}</span></div>`;
  }).join('')}</div>`;
}

function _msCollapsedHtml(c) {
  const img = c?.photoURL || c?.photo || c?.avatar || null;
  const init = _esc((c?.nom || '?')[0].toUpperCase());
  const niv = parseInt(c?.niveau) || 1;
  const tabs = [
    ['combat', 'combat', 'Combat'],
    ['sorts', 'sorts', 'Sorts'],
    ['sac', 'inv', 'Sac'],
    ['notes', 'notes', 'Carnet'],
  ];
  return `<div class="vtt-ms-rail">
    <button class="vtt-ms-rail-portrait" data-vtt-fn="_vttMsToggleCollapsed" title="Déployer la mini-fiche" aria-label="Déployer la mini-fiche">
      <span class="vtt-ms-rail-ring">${_msRingHtml(c, 48)}${img ? `<img src="${_esc(img)}" alt="">` : `<b>${init}</b>`}</span>
      <small>Niv. ${niv}</small>
    </button>
    <div class="vtt-ms-rail-fact"><b>${calcCA(c)}</b><small>CA</small></div>
    <div class="vtt-ms-rail-fact"><b>${calcOr(c)}</b><small>Or</small></div>
    <span class="vtt-ms-rail-sep" aria-hidden="true"></span>
    <nav class="vtt-ms-rail-tabs" aria-label="Mini-fiche">
      ${tabs.map(([key, icon, label]) => `<button class="${_miniTab === key ? 'active' : ''}" data-vtt-fn="_vttMsTab" data-vtt-args="${key}" title="Ouvrir ${label}" aria-label="Ouvrir ${label}">${_msIco(icon)}</button>`).join('')}
    </nav>
  </div>`;
}

// Sac : sous-onglets Objets / Recettes / Bourse (fusion des anciens onglets).
function _msTabSac(c, uid, canEdit) {
  if (_msSac !== 'obj' && _msSac !== 'craft' && _msSac !== 'bourse') _msSac = 'obj';
  const n = (c?.inventaire || []).length;
  const known = _msCraftRecipes ? _msKnownRecipes(uid) : null;
  const craftBadge = known ? `${known.filter(r => _msRecipeIngrStatus(r, _msInvNameCounts(c)).allOk).length}/${known.length}` : '';
  const seg = `<div class="vtt-ms-seg">${[['obj', 'Objets', n], ['craft', 'Recettes', craftBadge], ['bourse', 'Bourse', calcOr(c) + ' or']].map(([k, l, b]) =>
    `<button class="${_msSac === k ? 'on' : ''}" data-vtt-fn="_vttMsSac" data-vtt-args="${k}">${l}${b !== '' ? ` <small>${b}</small>` : ''}</button>`).join('')}</div>`;
  const body = _msSac === 'craft' ? _msTabCraft(c, uid, canEdit)
    : _msSac === 'bourse' ? _msTabCompte(c, uid, canEdit)
    : _msTabInventaire(c, uid, canEdit);
  return seg + body;
}
function _vttMsSac(sub) { _msSac = sub; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsGoPurse() { _miniTab = 'sac'; _msSac = 'bourse'; _miniCollapsed = false; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// ── Popover unique interne au panneau (remplace modales + <select>) ──
// _msPop = { v:'char'|'xp'|'slot'|'equipto'|'send'|'gold', pid, arg }
let _msPop = null;
let _msPopInit = false;
function _msClosePop() { _msPop = null; document.getElementById('vtt-ms-pop')?.remove(); }
function _vttMsPop(v, pid, arg = '') {
  if (_msPop && _msPop.pid === pid) { _msClosePop(); return; }
  _msPop = { v, pid, arg };
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}
function _msInitPop() {
  if (_msPopInit) return; _msPopInit = true;
  document.addEventListener('mousedown', e => {
    if (!_msPop) return;
    const panel = document.getElementById('vtt-mini-panel');
    if (!panel || !panel.contains(e.target)) { _msClosePop(); return; }
    if (e.target.closest('#vtt-ms-pop')) return;
    const trig = e.target.closest('[data-vtt-fn="_vttMsPop"]');
    if (trig && trig.dataset.pid === _msPop.pid) return;   // le toggle du clic s'en charge
    _msClosePop();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _msPop) { e.stopPropagation(); _msClosePop(); } }, true);
}
function _msPopHtml(c, uid) {
  const p = _msPop; if (!p) return '';
  let h = '';
  if (p.v === 'char') {
    const chars = _msAvailableCharacters(uid);
    h = `<div class="vtt-ms-pop-lbl">${STATE.isAdmin ? 'Personnages' : 'Personnages contrôlés'}</div>`
      + chars.map(x => {
          const photo = x?.photoURL || x?.photo || x?.avatar || '';
          const initial = _esc((x.nom || '?')[0].toUpperCase());
          const delegated = !STATE.isAdmin && x.uid !== STATE.user?.uid;
          const meta = _esc([x.race, x.classe, x.titreActuel || x.titre].filter(Boolean).join(' · '));
          return `<button class="vtt-ms-pop-it vtt-ms-pop-char${x.id === c.id ? ' on' : ''}" data-vtt-fn="_vttSelectMiniChar" data-vtt-args="${_esc(x.uid || uid)}|${x.id}">
            <span class="vtt-ms-pop-av">${photo ? `<img src="${_esc(photo)}" alt="">` : initial}</span>
            <span class="vtt-ms-pop-char-name"><b>${_esc(x.nom || 'Personnage')}</b><small>${delegated ? '<em class="vtt-ms-pop-delegated">Délégué</em>' : ''}${meta ? `<span>${meta}</span>` : ''}</small></span>
          </button>`;
        }).join('');
  } else if (p.v === 'slot') {
    const slotId = p.arg;
    const equip = c?.equipement || {}, inv = c?.inventaire || [];
    const cur = equip[slotId];
    const slotDef = _msSlots().find(s => s.id === slotId);
    const opts = inv.map((it, i) => ({ it, i })).filter(({ it, i }) => _msItemFitsSlot(it, slotId, equip, i));
    h = `<div class="vtt-ms-pop-lbl">${_esc(slotDef?.label || 'Emplacement')}</div>`
      + (opts.length
        ? opts.map(({ it, i }) => {
            const otherSlot = Object.keys(equip).find(s => s !== slotId && (equip[s]?.sourceInvIndex ?? -1) === i);
            const otherLbl = otherSlot ? _msSlots().find(s => s.id === otherSlot)?.label : '';
            const onCur = (cur?.sourceInvIndex ?? -2) === i;
            return `<button class="vtt-ms-pop-it${onCur ? ' on' : ''}" data-vtt-fn="_vttMsEquip" data-vtt-args="${c.id}|${uid}|${slotId}|${i}"><span>${_esc(it.nom)}${(it.qte || 1) > 1 ? ` ×${it.qte}` : ''}</span>${otherLbl && !onCur ? `<em>équipé : ${_esc(otherLbl)}</em>` : ''}</button>`;
          }).join('')
        : '<div class="vtt-ms-pop-empty">Aucun objet compatible dans le sac.</div>')
      + (cur?.nom ? `<div class="vtt-ms-pop-sep"></div><button class="vtt-ms-pop-it danger" data-vtt-fn="_vttMsUnequip" data-vtt-args="${c.id}|${uid}|${slotId}"><span>Retirer ${_esc(cur.nom)}</span></button>` : '');
  } else if (p.v === 'xp') {
    const niv = parseInt(c?.niveau) || 1, xp = parseInt(c?.exp) || 0, palier = calcPalier(niv), up = palier > 0 && xp >= palier;
    const canEdit = _msCanEdit(uid, c?.id);
    h = `<div class="vtt-ms-pop-lbl">Expérience · niveau ${niv}</div>`
      + (canEdit
        ? `<div class="vtt-ms-pop-form"><label>XP gagnée<input class="vtt-ms-pop-inp" id="vtt-ms-xp-add" type="number" min="1" placeholder="ex. 150 puis Entrée" data-vtt-fn="_vttMsAddXp" data-vtt-on="keydown-enter" data-vtt-args="${c.id}|${uid}|$value"></label>${up ? `<button class="vtt-ms-pop-btn amber" data-vtt-fn="_vttMsLevelUp" data-vtt-args="${c.id}|${uid}">Passer niveau ${niv + 1} · garde ${xp - palier} XP</button>` : `<div class="vtt-ms-pop-note">Encore ${palier - xp} XP avant le niveau ${niv + 1}.</div>`}</div>`
        : `<div class="vtt-ms-pop-empty">${xp} / ${palier} XP</div>`);
  } else if (p.v === 'gold') {
    const solde = calcOr(c);
    const targets = _msPresentTargets(uid);
    h = `<div class="vtt-ms-pop-lbl">Donner de l'or</div>`
      + (targets.length
        ? `<div class="vtt-ms-pop-form"><label>Montant (solde ${solde})<input class="vtt-ms-pop-inp" id="vtt-ms-gold-amt" type="number" min="1" max="${solde}" value="${Math.min(10, solde) || 1}"></label></div>`
          + targets.map(t => `<button class="vtt-ms-pop-it" data-vtt-fn="_vttMsConfirmSendGold" data-vtt-args="${c.id}|${uid}|${t.charId}"><span class="vtt-ms-pop-av">${_esc((t.charNom || '?')[0].toUpperCase())}</span><span>${_esc(t.charNom)}</span><em>${_esc(t.pseudo)}</em></button>`).join('')
        : '<div class="vtt-ms-pop-empty">Aucun joueur présent.</div>');
  } else if (p.v === 'send') {
    const inv = c?.inventaire || [];
    const item = inv[parseInt(p.arg)];
    const targets = _msPresentTargets(uid);
    h = `<div class="vtt-ms-pop-lbl">Donner ${_esc(item?.nom || 'l\'objet')}</div>`
      + (targets.length
        ? targets.map(t => `<button class="vtt-ms-pop-it" data-vtt-fn="_vttMsConfirmSend" data-vtt-args="${c.id}|${uid}|${p.arg}|${t.charId}"><span class="vtt-ms-pop-av">${_esc((t.charNom || '?')[0].toUpperCase())}</span><span>${_esc(t.charNom)}</span><em>${_esc(t.pseudo)}</em></button>`).join('')
        : '<div class="vtt-ms-pop-empty">Aucun joueur présent.</div>');
  }
  return `<div class="vtt-ms-pop" id="vtt-ms-pop">${h}</div>`;
}
function _msPlacePop() {
  const panel = document.getElementById('vtt-mini-panel');
  const pop = document.getElementById('vtt-ms-pop');
  if (!pop || !_msPop || !panel) return;
  let anchor; try { anchor = panel.querySelector(`[data-pid="${(window.CSS && CSS.escape) ? CSS.escape(_msPop.pid) : _msPop.pid}"]`); } catch { anchor = null; }
  if (!anchor) { _msClosePop(); return; }
  const ar = anchor.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = ar.left - pr.left;
  let y = ar.bottom - pr.top + 6;
  if (x + pw > pr.width - 8) x = Math.max(8, ar.right - pr.left - pw);
  if (ar.bottom + ph + 10 > pr.bottom) y = Math.max(8, ar.top - pr.top - ph - 6);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
}

function _msQuickSummary(c) {
  // PV/PM NE sont PLUS ici : le dock d'identité du pupitre les affiche déjà en
  // direct et éditables (fini la redondance). On garde une ligne de faits utiles
  // qui, eux, ne sont pas dans le dock (Deck, Or) ou complètent (CA, Vitesse).
  const deckMax = calcDeckMax(c);
  // Les sorts PRÉPARÉS vivent dans deck_sorts (cf. spells.js), pas dans sorts.
  const deckUsage = getDeckUsage(c?.deck_sorts);
  return `<div class="vtt-ms-summary">
    <div class="vtt-ms-quickfacts">
      <span><b>${calcCA(c)}</b><small>CA</small></span>
      <span><b>${calcVitesse(c)}</b><small>VIT.</small></span>
      <span><b>${deckUsage.used}/${deckMax}${deckUsage.free ? ` +${deckUsage.free}` : ''}</b><small>DECK</small></span>
      <span><b>${calcOr(c)}</b><small>OR</small></span>
    </div>
  </div>`;
}

async function _vttMsEquip(charId, uid, slot, invIndex) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = { ...(c.equipement||{}) };
  // Libère l'item s'il était déjà équipé ailleurs
  Object.keys(equip).forEach(s => { if (s !== slot && equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const built = _msBuildEquipItem(slot, item, invIndex); if (!built) return;
  equip[slot] = built;
  const bonus = computeEquipStatsBonus(equip);
  _msPop = null;
  c.equipement = equip; c.statsBonus = bonus;   // optimiste : reflet immédiat + ferme le popover
  _renderMiniSheet(uid);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${item.nom} → ${slot}`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

async function _vttMsUnequip(charId, uid, slot) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  const nom = equip[slot]?.nom || slot;
  delete equip[slot];
  const bonus = computeEquipStatsBonus(equip);
  _msPop = null;
  c.equipement = equip; c.statsBonus = bonus;   // optimiste : reflet immédiat + ferme le popover
  _renderMiniSheet(uid);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${nom} retiré`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Appelé par le <select> de l'onglet Équipement
function _vttMsSlotChange(sel, charId, uid, slotIdx) {
  const slot = _msSlots()[parseInt(slotIdx)]?.id; if (!slot) return;
  const val = sel.value;
  if (val === '') _vttMsUnequip(charId, uid, slot);
  else            _vttMsEquip(charId, uid, slot, parseInt(val));
}

// Ouvre une modale pour choisir le slot cible depuis l'inventaire
function _vttMsEquipPicker(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = c.equipement||{};
  // Seuls les slots compatibles avec cet item (sans check "usedElsewhere" pour qu'on puisse déplacer)
  const slots = _msSlots().filter(s => _msItemFitsSlot(item, s.id, {}, invIndex));
  if (!slots.length) { showNotif('Aucun slot compatible pour cet objet', 'info'); return; }
  if (slots.length === 1) { _vttMsEquip(charId, uid, slots[0].id, invIndex); return; }
  openModal(`⚔️ Équiper "${item.nom}"`, `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${slots.map(s => `<button class="btn btn-outline"
        data-vtt-fn="_vttCloseAnd" data-vtt-args="_vttMsEquip|${charId}|${uid}|${s.id}|${invIndex}">${_esc(s.icon)} ${_esc(s.label)}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Déséquipe un item depuis l'inventaire (tous les slots où il est équipé)
async function _vttMsUnequipAll(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = VS.characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  Object.keys(equip).forEach(s => { if (equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif('Déséquipé', 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Active / désactive un sort
async function _vttToggleMsSort(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  const s = sorts[idx]; if (!s) return;
  if (isAlwaysPreparedSpell(s)) {
    showNotif('Ce sort est toujours prêt et ne consomme aucun emplacement.', 'info');
    return;
  }
  // Un joueur ne peut mettre dans son Deck qu'un sort VALIDÉ par le MJ (le MJ n'est pas limité).
  const isValidated = (s.mjValidation || (s.mjValidated ? 'ok' : 'pending')) === 'ok';
  if (!s.actif && !isValidated && !STATE.isAdmin) {
    showNotif('Ce sort doit être validé par le MJ avant d\'entrer dans le Deck.', 'error');
    return;
  }
  const deckMax = calcDeckMax(c);
  const deckCount = getDeckUsage(sorts).used;
  if (!deckHasRoomFor(s, sorts, deckMax)) {
    showNotif(`Deck plein (${deckCount}/${deckMax}) — retire un sort avant d'en ajouter un.`, 'error');
    return;
  }
  sorts[idx] = { ...s, actif: !s.actif };
  try { await updateDoc(_chrRef(charId), { deck_sorts: sorts }); }
  catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Modale pour choisir le destinataire d'un objet
function _vttMsSendPicker(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = VS.characters[charId]; if (!c) return;
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const targets = Object.entries(VS.presence)
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) =>
      Object.values(VS.characters)
        .filter(ch => ch.uid === pUid)
        .map(ch => ({ pUid, charId: ch.id, charNom: ch.nom||p.pseudo, pseudo: p.pseudo }))
    );
  if (!targets.length) { showNotif('Aucun joueur présent à qui envoyer l\'objet', 'info'); return; }
  openModal(`📦 Envoyer "${item.nom||'objet'}"`, `
    <div style="display:flex;flex-direction:column;gap:.5rem">
      <p style="margin:0;font-size:.85rem;color:var(--text-dim)">Destinataire :</p>
      ${targets.map(t => `<button class="btn btn-outline" style="text-align:left"
        data-vtt-fn="_vttCloseAnd" data-vtt-args="_vttMsConfirmSend|${charId}|${uid}|${invIndex}|${t.charId}">
        ${t.pseudo} → ${t.charNom}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Effectue le transfert d'objet entre deux personnages
async function _vttMsConfirmSend(senderCharId, senderUid, invIndex, recipCharId) {
  _msPop = null;
  invIndex = parseInt(invIndex);
  const sender = VS.characters[senderCharId]; if (!sender) return;
  const recip  = VS.characters[recipCharId];  if (!recip)  return;
  const senderInv = [...(sender.inventaire||[])];
  const item = senderInv[invIndex]; if (!item) return;
  senderInv.splice(invIndex, 1);
  // Ajuste les sourceInvIndex dans l'équipement du sender
  const senderEquip = { ...(sender.equipement||{}) };
  Object.keys(senderEquip).forEach(s => {
    const e = senderEquip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete senderEquip[s];
    else if (e.sourceInvIndex > invIndex) senderEquip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const senderBonus = computeEquipStatsBonus(senderEquip);
  const recipInv = [...(recip.inventaire||[]), { ...item }];
  const senderHistory = inventoryHistoryPayload(sender, makeInventoryHistoryEntry('send', item, 1, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: 'VTT',
    targetName: recip.nom || '',
  }));
  const recipHistory = inventoryHistoryPayload(recip, makeInventoryHistoryEntry('receive', item, 1, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: sender.nom || 'VTT',
    targetName: sender.nom || '',
  }));
  try {
    const batch = writeBatch(db);
    batch.update(_chrRef(senderCharId), { inventaire: senderInv, equipement: senderEquip, statsBonus: senderBonus, ...senderHistory });
    batch.update(_chrRef(recipCharId), { inventaire: recipInv, ...recipHistory });
    await batch.commit();
    sender.inventaire = senderInv;
    sender.inventoryHistory = senderHistory.inventoryHistory;
    recip.inventaire = recipInv;
    recip.inventoryHistory = recipHistory.inventoryHistory;
    showNotif(`${item.nom||'Objet'} envoyé à ${recip.nom||'joueur'}`, 'success');
  } catch(e) {
    console.error('[vtt] send item', e);
    showNotif(e?.code === 'permission-denied'
      ? "Envoi refusé : règle Firestore d'inventaire manquante (don d'objet)"
      : 'Erreur envoi', 'error');
  }
}

// Supprime définitivement un exemplaire de l'inventaire (sans destinataire).
// Même logique de réindexation de l'équipement que _vttMsConfirmSend.
// Suppression SANS confirmation, avec « Annuler » (4 s) dans le toast.
// Écriture immédiate + ré-écriture à l'annulation : robuste face au listener
// temps réel des personnages (une écriture différée laisserait un snapshot
// entrant faire réapparaître l'objet). La réindexation est inchangée.
async function _vttMsDeleteItem(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = VS.characters[charId]; if (!c) return;
  const prevInv   = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const prevEquip = { ...(c.equipement || {}) };
  const prevBonus = { ...(c.statsBonus || {}) };
  const prevHist  = Array.isArray(c.inventoryHistory) ? [...c.inventoryHistory] : c.inventoryHistory;
  const item = prevInv[invIndex]; if (!item) return;

  const inv = [...prevInv]; inv.splice(invIndex, 1);
  const equip = { ...prevEquip };
  Object.keys(equip).forEach(s => {
    const e = equip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete equip[s];
    else if (e.sourceInvIndex > invIndex) equip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const bonus = computeEquipStatsBonus(equip);
  const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('delete', item, 1, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: 'VTT',
  }));

  _msPop = null;
  c.inventaire = inv; c.equipement = equip; c.statsBonus = bonus; c.inventoryHistory = historyPatch.inventoryHistory;
  _renderMiniSheet(uid);
  try {
    await updateDoc(_chrRef(charId), { inventaire: inv, equipement: equip, statsBonus: bonus, ...historyPatch });
  } catch (e) {
    console.error('[vtt] delete item', e);
    c.inventaire = prevInv; c.equipement = prevEquip; c.statsBonus = prevBonus; c.inventoryHistory = prevHist;
    _renderMiniSheet(uid);
    showNotif('Erreur suppression', 'error');
    return;
  }

  showNotif(`${item.nom || 'Objet'} supprimé`, 'info', { action: { label: 'Annuler', onClick: async () => {
    const cc = VS.characters[charId]; if (!cc) return;
    cc.inventaire = prevInv; cc.equipement = prevEquip; cc.statsBonus = prevBonus; cc.inventoryHistory = prevHist;
    _renderMiniSheet(uid);
    updateDoc(_chrRef(charId), { inventaire: prevInv, equipement: prevEquip, statsBonus: prevBonus, ...(prevHist !== undefined ? { inventoryHistory: prevHist } : {}) })
      .catch(err => { console.error('[vtt] undo delete', err); showNotif('Restauration impossible', 'error'); });
  } } });
}

// ─── Rendus par onglet ────────────────────────────────────────────

// Combat (refonte) : carte d'attaque en AFFICHAGE SEUL (aucun jet), apports
// d'arme complets (traits non tronqués) et bonus de set. Les caracs, les
// chiffres clés et l'XP sont dans la zone fixe ; l'équipement est ajouté ensuite.
function _msTabCombat(c, uid, canEdit) {
  const weaponSlots = _msSlots().filter(slot => slot.kind === 'weapon')
    .map(slot => ({ slot, item: c?.equipement?.[slot.id] }))
    .filter(entry => entry.item?.nom && entry.item?.degats);
  const primaryId = getPrimaryWeaponSlotId();
  if (!weaponSlots.some(entry => entry.slot.id === _msAttackSlot)) {
    _msAttackSlot = weaponSlots.find(entry => entry.slot.id === primaryId)?.slot.id || weaponSlots[0]?.slot.id || primaryId;
  }
  const weapon = c?.equipement?.[_msAttackSlot];
  const weaponSource = _msEquipSourceItem(weapon, c?.inventaire || []);
  let attackDice = '—';
  let attackTouch = '+0';
  if (weapon?.nom) {
    const wDmgStat = weapon.degatsStat || weapon.degatStat || 'force';
    const wTchStat = weapon.toucherStat || weapon.statAttaque || 'force';
    const setBonus = getArmorSetData(c).modifiers.toucherBonus || 0;
    const maitrise = getMaitriseBonus(c, weapon);
    const dmgMod   = getMod(c, wDmgStat);
    const tchTotal = getMod(c, wTchStat) + maitrise + setBonus;
    attackDice = `${weapon.degats||'—'}${dmgMod!==0?' '+(dmgMod>=0?'+'+dmgMod:dmgMod):''}`;
    attackTouch = `${tchTotal>=0?'+'+tchTotal:tchTotal}`;
  }
  // Apports : traits ENTIERS (plus de `compact`).
  const contrib = weapon?.nom ? _msEquipContributionHtml(weaponSource) : '';
  const weaponExtra = `${contrib}${weapon?.particularite ? `<div class="vtt-ms-atk-note">${_esc(weapon.particularite)}</div>` : ''}`;

  const setData = getArmorSetData(c);
  const setHtml = setData?.active ? `<div class="vtt-ms-setbonus">${_msIco('equip')} Set ${_esc(setData.type)}</div>` : '';

  const weaponSwitch = weaponSlots.length > 1 ? `<div class="vtt-ms-atk-switch" aria-label="Arme affichée">
    ${weaponSlots.map(({ slot }) => `<button type="button" class="${slot.id === _msAttackSlot ? 'on' : ''}"
      data-vtt-fn="_vttMsAttackSlot" data-vtt-args="${_esc(slot.id)}">${slot.role === 'primaryWeapon' ? 'Principale' : 'Secondaire'}</button>`).join('')}
  </div>` : '';

  return `
    <div class="vtt-ms-sect-label">Attaque</div>
    <div class="vtt-ms-atk">
      <div class="vtt-ms-atk-hd"><b>${weapon?.nom ? _esc(weapon.nom) : 'Mains nues'}</b>${weaponSwitch}</div>
      <div class="vtt-ms-atk-row">
        <div class="vtt-ms-atk-cell"><small>Toucher</small><b>${attackTouch}</b></div>
        <div class="vtt-ms-atk-cell"><small>Dégâts</small><b>${_esc(attackDice)}</b></div>
      </div>
      ${weaponExtra}
      ${weapon?.nom ? '' : '<div class="vtt-ms-atk-empty">Aucune arme équipée — choisis-en une dans Équipement.</div>'}
    </div>
    ${setHtml}`;
}

function _msXpSection(c, uid, canEdit) {
  const xp     = parseInt(c?.exp)    || 0;
  const niv    = parseInt(c?.niveau) || 1;
  const palier = calcPalier(niv);
  const pct    = palier > 0 ? Math.min(100, Math.round(xp / palier * 100)) : 0;

  if (canEdit) {
    return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <input class="vtt-ms-xp-input" type="number" value="${xp}" min="0"
          data-vtt-fn="_vttMsSetXp" data-vtt-on="change" data-vtt-args="${c.id}|${uid}|$value"
          data-enter="change-blur"
          title="XP total — Entrée pour valider">
        <span class="vtt-ms-xp-sep">/ ${palier}</span>
        <span class="vtt-ms-xp-niv">Niv.</span>
        <input class="vtt-ms-niv-input" type="number" value="${niv}" min="1" max="20"
          data-vtt-fn="_vttMsSetNiveau" data-vtt-on="change" data-vtt-args="${c.id}|${uid}|$value">
      </div>
      <div class="vtt-ms-xp-row vtt-ms-xp-add-row">
        <span class="vtt-ms-xp-add-icon">+</span>
        <input class="vtt-ms-xp-input vtt-ms-xp-delta-input" type="number" min="1" placeholder="gagné"
          id="vtt-xp-delta-${c.id}-${uid}"
          data-vtt-fn="_vttMsAddXp" data-vtt-on="keydown-enter" data-vtt-args="${c.id}|${uid}|$value"
          title="XP à ajouter — Entrée pour valider">
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
      ${palier > 0 && xp >= palier ? `<button class="vtt-ms-levelup-btn" data-vtt-fn="_vttMsLevelUp" data-vtt-args="${c.id}|${uid}">⬆️ Passer niveau ${niv + 1} · garde ${xp - palier} XP</button>` : ''}
    </div>`;
  }
  return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <span class="vtt-ms-xp-val">${xp} / ${palier}</span>
        <span class="vtt-ms-xp-badge">Niv. ${niv}</span>
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
}

// Équipement (refonte) : emplacements PLEINS en lignes pleine largeur avec tous
// les apports (traits entiers), emplacements LIBRES regroupés en pastilles. Un
// clic ouvre un popover de choix d'objet (compatibles + Retirer). Plus de <select>.
function _msTabEquipement(c, uid, canEdit) {
  const equip = c?.equipement || {}, inv = c?.inventaire || [];
  const slots = _msSlots();
  const occupied = slots.filter(s => equip[s.id]?.nom);
  // L'arme actuellement détaillée dans le bloc Attaque n'est pas répétée juste
  // en dessous. Les autres armes restent visibles et donc équipables/modifiables.
  const full = occupied.filter(s => s.id !== _msAttackSlot);
  const free = slots.filter(s => !equip[s.id]?.nom);
  const setData = getArmorSetData(c);
  const sIco = s => _msIco(s.kind === 'weapon' ? 'combat' : s.kind === 'armor' ? 'equip' : 'ring');
  const pa = sid => canEdit ? `data-vtt-fn="_vttMsPop" data-vtt-args="slot|slot-${sid}|${sid}" data-pid="slot-${sid}"` : '';
  const on = sid => (_msPop?.v === 'slot' && _msPop.arg === sid) ? ' sel' : '';

  const fullHtml = full.map(s => {
    const it = equip[s.id];
    const chips = _msEquipContributionHtml(_msEquipSourceItem(it, inv), { label: '' });
    return `<button class="vtt-ms-eq${on(s.id)}" ${pa(s.id)}>
      <span class="vtt-ms-eq-ic">${sIco(s)}</span>
      <span class="vtt-ms-eq-b"><small>${_esc(s.label)}</small><span class="vtt-ms-eq-nm">${_esc(it.nom)}</span>${chips}</span>
    </button>`;
  }).join('');
  const freeHtml = free.length
    ? `<div class="vtt-ms-eq-free"><span>Libres</span>${free.map(s => `<button class="vtt-ms-efree${on(s.id)}" ${pa(s.id)} title="Équiper : ${_esc(s.label)}">${sIco(s)}${_esc(s.label)}</button>`).join('')}</div>`
    : '';
  const setHtml = setData?.active ? `<div class="vtt-ms-setrow">${_msIco('equip')}<span>Set ${_esc(setData.type)}</span></div>` : '';

  return `<div class="vtt-ms-sect-label">Équipement <em>${occupied.length}/${slots.length}</em></div>
    <div class="vtt-ms-eqs">${fullHtml || (occupied.length ? '' : '<div class="vtt-ms-atk-empty">Rien d\'équipé.</div>')}</div>
    ${freeHtml}${setHtml}`;
}

// Méta runes (icône/couleur) — miroir de RUNE_META (spells.js) pour un rendu de
// carte identique côté VTT, sans importer le gros module de la fiche.
// [_VTT_RUNE_META → vtt-constants.js (importé en haut)]

// Chips d'effets clés (dégâts/soin/cibles/zone/durée), calculés avec les helpers
// natifs du VTT (cache-free → cohérents avec les options d'attaque du VTT).
function _vttSpellChips(s, c) {
  const chips = [];
  const isClassic = s?.designMode === 'classic';
  const types = (Array.isArray(s.types) && s.types.length) ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const runes = s.runes || [];
  const _isLac = runes.includes('Lacération') || (s.afflictionMode === 'laceration' && runes.includes('Affliction'));
  if (types.includes('offensif') || _isLac) {
    let dmg = _vttSortDmgFormula(s, c);
    if (isClassic && s.degatsStat && s.degatsStat !== 'none') {
      const mod = getMod(c, s.degatsStat);
      if (mod) dmg += `${mod > 0 ? ' +' : ' '}${mod}`;
    }
    if (dmg) chips.push({ icon:'⚔️', val: _effectDisplay(s, dmg), color:'#ff6b6b', lbl:'Dégâts infligés' });
  }
  if (runes.includes('Protection') && runes.includes('Affliction') && !_isLac) {
    const nbProt = runes.filter(r => r === 'Protection').length;
    const nbAff = runes.filter(r => r === 'Affliction').length;
    const regenFormula = `${(s.regenerationFormula || '').trim() || `${nbProt + nbAff}d4`}/t`;
    chips.push({ icon:'💚', val:_effectDisplay(s, regenFormula), color:'#22c38e', lbl:'Soin par tour (Régénération)' });
  }
  const isAmpSupportHeal = types.includes('defensif')
    && runes.includes('Amplification')
    && s.ampMode !== 'deplacement'
    && !runes.includes('Protection');
  const protectionRestoreMode = getProtectionRestoreMode(s);
  if (!(runes.includes('Protection') && runes.includes('Affliction') && !_isLac)
      && (protectionRestoreMode === 'soin' || s.typeSoin || isAmpSupportHeal)) {
    let soin = _vttSortSoinFormula(s, c);
    if (isClassic && s.degatsStat && s.degatsStat !== 'none') {
      const mod = getMod(c, s.degatsStat);
      if (mod) soin += `${mod > 0 ? ' +' : ' '}${mod}`;
    }
    if (soin) chips.push({ icon:'💚', val: _effectDisplay(s, soin), color:'#22c38e', lbl:'Soin' });
  }
  if (protectionRestoreMode === 'mana') {
    chips.push({ icon:'💙', val:`${_calcSortMana(s, c)} PM`, color:'#8b5cf6', lbl:'Régénération de PM' });
  }
  if (isClassic && s.classicEffect === 'utility' && s.effet) {
    chips.push({ icon:'✨', val:s.effet, color:'#b47fff', lbl:'Effet utilitaire' });
  }
  if (isClassic && s.classicEffect === 'summon') {
    const maxInv = Math.max(1, parseInt(s.invocation?.max ?? s.classicInvocationCount) || 1);
    chips.push({ icon:'🐾', val:`${maxInv} invocation${maxInv > 1 ? 's' : ''}`, color:'#a16207', lbl:'Créature invoquée' });
  }
  if (isClassic && s.classicStateId) {
    chips.push({
      icon:s.classicStateIcon || '◈',
      val:s.classicStateLabel || 'État',
      color:s.classicTarget === 'enemy' ? '#ef4444' : '#e8b84b',
      lbl:s.classicTarget === 'enemy'
        ? `Jet de sauvegarde DD ${parseInt(s.classicStateDC) || 11}`
        : 'État appliqué à la cible',
    });
  }
  const nbT = calcSpellTargets(s);
  if (nbT > 1) chips.push({ icon:'🎯', val:`×${nbT}`, color:'#4f8cff', lbl:'Nombre de cibles', dim:true });
  const nbAmp = runes.filter(r => r === 'Amplification').length;
  // Avec Enchantement (hors Invocation), l'Amplification booste l'effet → pas de zone.
  const _enchNoZone = runes.includes('Enchantement') && !runes.includes('Invocation');
  const _zoneIcon = (shp) => shp === 'cross' ? '✚' : shp === 'cone' ? '🔺' : shp === 'ring' ? '◯' : shp === 'line' ? '▬' : shp === 'diamond' ? '◇' : '📐';
  const _zoneLbl  = (shp) => shp === 'cross' ? 'Zone en croix' : shp === 'cone' ? 'Zone en cône' : shp === 'ring' ? 'Zone en anneau' : shp === 'line' ? 'Zone en ligne' : shp === 'diamond' ? 'Zone circulaire sur la grille' : 'Zone rectangulaire';
  if (isClassic && (parseInt(s.zoneW) || 0) > 0 && (parseInt(s.zoneH) || 0) > 0) {
    chips.push({ icon:_zoneIcon(s.zoneShape), val:`${parseInt(s.zoneW)}×${parseInt(s.zoneH)} cases`, color:'#b47fff', lbl:_zoneLbl(s.zoneShape), dim:true });
  } else if (nbAmp > 0 && s.ampMode !== 'deplacement' && !_enchNoZone) {
    // Modèle zones v2 : Amplification pilote la taille (forme au choix), Dispersion répète.
    const shp = ZONE_SHAPES.includes(s.zoneShape) ? s.zoneShape : 'rect';
    const d = _zoneDims(shp, nbAmp) || { w: 0, h: 0, shape: 'rect' };
    const nbDisp = runes.filter(r => r === 'Dispersion').length;
    const poses = nbDisp >= 1 ? ` ·×${_zoneCount(nbDisp)}` : '';
    chips.push({ icon:_zoneIcon(d.shape), val:`${d.w}×${d.h}${poses}`, color:'#b47fff', lbl:_zoneLbl(d.shape), dim:true });
  }
  if ((isClassic && (parseInt(s.classicDuration ?? s.dureeBase) || 0) > 0)
      || runes.includes('Durée') || (s.dureeBase && s.dureeBase >= 2)) {
    chips.push({ icon:'⏱️', val:`${calcSpellDuration(s)}t`, color:'#9ca3af', lbl:'Durée de l\'effet (tours)', dim:true });
  }
  if (isClassic && (parseInt(s.cooldownTurns) || 0) > 0) {
    chips.push({ icon:'↻', val:`${parseInt(s.cooldownTurns)}t`, color:'#fbbf24', lbl:'Temps de recharge en combat', dim:true });
  }
  return chips;
}

// Carte de sort VTT — même présentation que la fiche perso (classes .cs-spellcard,
// scope .cs-v3) avec câblage VTT (toggle deck par data-vtt-fn).
function _vttSpellCardHtml(s, i, c, uid, canEdit, deckCount = 0, deckMax = Infinity) {
  const runes = s.runes || [];
  const types = (Array.isArray(s.types) && s.types.length) ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const action = _vttSpellActionMode(s);
  const ACTION_CFG = {
    action:       { label:'⚡ Act.',   color:'#e8b84b' },
    action_bonus: { label:'✴️ Bonus', color:'#f97316' },
    reaction:     { label:'🔄 Réac.', color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action];
  const concentration = runes.includes('Concentration');
  const ids = (Array.isArray(s.noyauTypeIds) && s.noyauTypeIds.length) ? s.noyauTypeIds
            : (s.noyauTypeId ? [s.noyauTypeId] : []);
  const nts = ids.map(id => getDamageTypeById(VS.damageTypes, id)).filter(Boolean);
  const noyauPills = nts.map(t =>
    `<span class="cs-spellcard-noyau" style="--c:${t.color||'#888'}" title="Noyau ${_esc(t.label)}">${t.icon||''}</span>`).join('');
  const typeCol = types.includes('offensif') ? '#ff6b6b' : types.includes('defensif') ? '#22c38e' : '#b47fff';
  const vs = s.mjValidation || (s.mjValidated ? 'ok' : 'pending');
  const valBadge = vs === 'ok'
    ? `<span class="cs-spellcard-val ok" title="Sort validé par le MJ">✅ Validé</span>`
    : vs === 'no'
      ? `<span class="cs-spellcard-val no" title="Sort refusé par le MJ">❌ Refusé</span>`
      : `<span class="cs-spellcard-val wait" title="Pas encore validé par le MJ">⏳ À valider</span>`;
  const chips = _vttSpellChips(s, c);
  const counts = {}; _vttDisplayRunes(runes).forEach(r => { counts[r] = (counts[r]||0)+1; });
  const runeChips = Object.keys(counts).length ? `<div class="cs-spellcard-runes">${
    Object.entries(counts).map(([nom, n]) => {
      const m = _VTT_RUNE_META[nom] || { icon:'•', color:'#888' };
      return `<span class="cs-runechip" style="--c:${m.color}" title="${_esc(nom)}">${m.icon} ${_esc(nom)}${n>1?` ×${n}`:''}</span>`;
    }).join('')}</div>` : '';
  const validationAllows = STATE.isAdmin || vs === 'ok';
  const alwaysPrepared = isAlwaysPreparedSpell(s);
  const deckAllows = deckHasRoomFor(s, c.deck_sorts, deckMax);
  const canActivate = validationAllows && deckAllows;
  const lockTitle = !validationAllows
    ? 'Doit être validé par le MJ pour entrer dans le Deck'
    : !deckAllows
      ? `Deck plein (${deckCount}/${deckMax}) — retire un sort avant d'en ajouter un`
      : (s.actif?'Retirer du deck':'Ajouter au deck');
  const toggle = alwaysPrepared
    ? '<div class="toggle on is-always" title="Toujours prêt · aucun emplacement consommé"></div>'
    : canEdit
    ? `<div class="toggle ${s.actif?'on':''} ${(!canActivate && !s.actif)?'is-locked':''}" data-vtt-fn="_vttToggleMsSort" data-vtt-args="${c.id}|${uid}|${i}" title="${lockTitle}"></div>`
    : `<div class="toggle ${s.actif?'on':''}"></div>`;
  return `<article class="cs-spellcard ${s.actif?'is-actif':''} ${alwaysPrepared?'is-always-prepared':''} ${vs==='no'?'is-refused':''}" style="--type-col:${typeCol}"
      data-name="${_esc(_norm(s.nom||''))}" data-cat="${_esc(s.catId||'__none')}" data-actif="${s.actif?1:0}">
    <header class="cs-spellcard-head">
      ${toggle}
      <span class="cs-spellcard-icon">${s.icon ? _esc(s.icon) : '✦'}</span>
      <div class="cs-spellcard-id">
        <div class="cs-spellcard-name" title="${_esc(s.nom||'Sans nom')}">${_esc(s.nom||'Sans nom')}</div>
        <div class="cs-spellcard-sub">
          ${alwaysPrepared ? '<span class="cs-spellcard-always" title="Ne consomme aucun emplacement">∞ Toujours prêt</span>' : ''}
          <span class="cs-spellcard-act" style="--c:${acfg.color}">${acfg.label}</span>
          ${concentration ? `<span class="cs-spellcard-conc" title="Concentration">🧠</span>` : ''}
          ${noyauPills}
        </div>
      </div>
      <span class="cs-spellcard-pm" title="Coût du sort (ajustement MJ inclus)">${Number.isFinite(parseInt(s.pmOverride)) ? parseInt(s.pmOverride) : (parseInt(s.pm) || 0)}<small>${_esc(spellCostRes(s).label)}</small></span>
    </header>
    <div class="cs-spellcard-tags">${valBadge}${chips.map(ch => `<span class="cs-sort-sstat${ch.dim?' cs-sort-sstat--dim':''}" style="--c:${ch.color}"${ch.lbl?` title="${_esc(ch.lbl)}"`:''}>${ch.icon} ${_esc(ch.val)}</span>`).join('')}</div>
    ${s.effet ? `<p class="cs-spellcard-desc">${_esc(s.effet)}</p>` : ''}
    ${s.mjNotes ? `<div class="cs-spellcard-mjnote" title="Note / restriction du MJ"><span class="cs-spellcard-mjnote-ic">📌</span><span class="cs-spellcard-mjnote-tx">${_esc(s.mjNotes)}</span></div>` : ''}
    ${runeChips}
  </article>`;
}

// Sort déplié (id ou index) — clic sur la ligne (hors interrupteur de Deck).
function _vttMsToggleSpell(id) { _msOpenSpell = String(_msOpenSpell) === String(id) ? null : id; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// Ligne de sort compacte (refonte) : interrupteur Deck · icône teintée · nom +
// badges · action + 2 effets · coût. Un clic déplie tout (effets/desc/MJ/runes).
function _msSpellLine(s, i, c, uid, canEdit, deckCount, deckMax) {
  const runes = s.runes || [];
  const types = (Array.isArray(s.types) && s.types.length) ? s.types : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const action = _vttSpellActionMode(s);
  const ACT = { action: ['Act.', '#e8b84b'], action_bonus: ['Bonus', '#f97316'], reaction: ['Réac.', '#a78bfa'] };
  const acfg = ACT[action] || ACT.action;
  const vs = s.mjValidation || (s.mjValidated ? 'ok' : 'pending');
  const typeCol = types.includes('offensif') ? '#ff6b6b' : types.includes('defensif') ? '#22c38e' : '#b47fff';
  const chips = _vttSpellChips(s, c);
  const fx = chips.slice(0, 2).map(ch => `<span class="vtt-ms-sp-fx" style="--fxc:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('');
  const alwaysPrepared = isAlwaysPreparedSpell(s);
  const validationAllows = STATE.isAdmin || vs === 'ok';
  const deckAllows = deckHasRoomFor(s, c.deck_sorts, deckMax);
  const canActivate = validationAllows && deckAllows;
  const lockTitle = !validationAllows ? 'Doit être validé par le MJ'
    : !deckAllows ? `Deck plein (${deckCount}/${deckMax}) — retire un sort` : (s.actif ? 'Retirer du deck' : 'Ajouter au deck');
  const toggle = alwaysPrepared
    ? '<span class="vtt-ms-sp-tg always" title="Toujours prêt · aucun emplacement"></span>'
    : canEdit
      ? `<button class="vtt-ms-sp-tg${s.actif ? ' on' : ''}${(!canActivate && !s.actif) ? ' lock' : ''}" data-vtt-fn="_vttToggleMsSort" data-vtt-args="${c.id}|${uid}|${i}" title="${lockTitle}"></button>`
      : `<span class="vtt-ms-sp-tg${s.actif ? ' on' : ''}"></span>`;
  const cost = Number.isFinite(parseInt(s.pmOverride)) ? parseInt(s.pmOverride) : (parseInt(s.pm) || 0);
  const badges = `${alwaysPrepared ? '<span class="vtt-ms-sp-badge inf" title="Toujours prêt">∞</span>' : ''}${vs === 'pending' ? '<span class="vtt-ms-sp-badge wait">À valider</span>' : vs === 'no' ? '<span class="vtt-ms-sp-badge no">Refusé</span>' : ''}`;
  const open = String(_msOpenSpell) === String(s.id || i);
  let expand = '';
  if (open) {
    const counts = {}; _vttDisplayRunes(runes).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const runeChips = Object.keys(counts).length ? `<div class="vtt-ms-sp-chips">${Object.entries(counts).map(([nom, n]) => { const m = _VTT_RUNE_META[nom] || { icon: '•', color: '#888' }; return `<span class="vtt-ms-sp-rune" style="--rc:${m.color}">${m.icon} ${_esc(nom)}${n > 1 ? ` ×${n}` : ''}</span>`; }).join('')}</div>` : '';
    const allChips = chips.length > 2 ? `<div class="vtt-ms-sp-chips">${chips.map(ch => `<span class="vtt-ms-sp-chip" style="color:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('')}</div>` : '';
    expand = `<div class="vtt-ms-sp-x">${allChips}${s.effet ? `<p>${_esc(s.effet)}</p>` : ''}${s.mjNotes ? `<div class="vtt-ms-sp-mjn"><b>MJ</b> ${_esc(s.mjNotes)}</div>` : ''}${runeChips}</div>`;
  }
  return `<div class="vtt-ms-sp${open ? ' open' : ''}${s.actif ? '' : ' off'}" data-name="${_esc(_norm(s.nom || ''))}" data-cat="${_esc(s.catId || '__none')}" data-actif="${s.actif ? 1 : 0}">
    <div class="vtt-ms-sp-row" data-vtt-fn="_vttMsToggleSpell" data-vtt-args="${s.id || i}">
      ${toggle}
      <span class="vtt-ms-sp-ico" style="--tc:${typeCol}">${s.icon ? _esc(s.icon) : '✦'}</span>
      <div class="vtt-ms-sp-b"><div class="vtt-ms-sp-nm"><span>${_esc(s.nom || 'Sans nom')}</span>${badges}</div><div class="vtt-ms-sp-meta"><span class="vtt-ms-sp-act" style="--ac:${acfg[1]}">${acfg[0]}</span>${fx}</div></div>
      <div class="vtt-ms-sp-cost"><b>${cost}</b><small>${_esc(spellCostRes(s).label)}</small></div>
    </div>${expand}</div>`;
}

function _msTabSorts(c, uid, canEdit) {
  const sorts = c?.deck_sorts || [];
  if (!sorts.length) return '<div class="vtt-ms-empty">Aucun sort</div>';
  const deckUsage = getDeckUsage(sorts);
  const deckCount = deckUsage.used, deckFree = deckUsage.free, deckMax = calcDeckMax(c);
  const full = deckCount >= deckMax;
  const pmTotal = sorts.filter(s => s.actif).reduce((sum, s) => {
    if (spellCostRes(s).id !== 'pm') return sum;
    const pm = Number.isFinite(parseInt(s.pmOverride)) ? parseInt(s.pmOverride) : (parseInt(s.pm) || 0);
    return sum + Math.max(0, pm);
  }, 0);

  // Jauge de Deck en segments (+ « toujours prêts » en pointillé).
  const gauge = `<div class="vtt-ms-deck${full ? ' full' : ''}"><b>${deckCount}/${deckMax}</b><div class="vtt-ms-deck-g">${Array.from({ length: deckMax }, (_, k) => `<i class="${k < deckCount ? 'on' : ''}"></i>`).join('')}${Array.from({ length: deckFree }, () => '<i class="free" title="Toujours prêt"></i>').join('')}</div><small>${pmTotal} PM au total</small></div>`;

  // Barre de filtre (existante) : Tous · ⚡ Deck · catégories · Sans cat.
  let filterBar = '';
  if (sorts.length >= 4) {
    const cats = (c?.sort_cats || []).filter(ct => sorts.some(s => s.catId === ct.id));
    const chips = [{ key: 'all', label: 'Tous' }, { key: '__deck', label: `⚡ Deck (${deckUsage.active})` }, ...cats.map(ct => ({ key: ct.id, label: ct.nom || 'Catégorie', color: ct.couleur }))];
    if (sorts.some(s => !s.catId)) chips.push({ key: '__none', label: 'Sans cat.' });
    if (!chips.some(ch => ch.key === _msSortCat)) _msSortCat = 'all';
    filterBar = _msFilterBar('sorts', chips, _msSortQuery);
  } else { _msSortCat = 'all'; _msSortQuery = ''; }

  return `${gauge}${filterBar}
    <div class="vtt-ms-spellgrid">${sorts.map((s, i) => _msSpellLine(s, i, c, uid, canEdit, deckCount, deckMax)).join('')}</div>
    <div class="vtt-ms-filter-empty" data-kind="sorts" style="display:none">Aucun sort ne correspond.</div>`;
}

// ─── Onglet Compte (or : recettes / dépenses) ─────────────────────
// Réutilise la couche economy.js (useGold) + le modèle c.compte de la fiche.
// Destinataires d'un don (joueurs présents autres que soi) → { charId, charNom, pseudo }.
function _msPresentTargets(uid) {
  return Object.entries(VS.presence || {})
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) => Object.values(VS.characters)
      .filter(ch => ch.uid === pUid)
      .map(ch => ({ charId: ch.id, charNom: ch.nom || p.pseudo, pseudo: p.pseudo })));
}
const _msParseDate = (d) => { const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); return m ? new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]).getTime() : 0; };

// Bourse (refonte) : solde en grand, reçus/dépensés, ajout, don en popover,
// historique FUSIONNÉ chronologique (au lieu de deux colonnes).
function _msTabCompte(c, uid, canEdit) {
  const compte   = c?.compte || { recettes: [], depenses: [] };
  const recettes = compte.recettes || [];
  const depenses = compte.depenses || [];
  const totalR = recettes.reduce((s, r) => s + (parseFloat(r?.montant) || 0), 0);
  const totalD = depenses.reduce((s, d) => s + (parseFloat(d?.montant) || 0), 0);
  const solde  = calcOr(c);

  const merged = [
    ...recettes.map((r, i) => ({ ...r, type: 'recettes', idx: i, sign: 1 })),
    ...depenses.map((r, i) => ({ ...r, type: 'depenses', idx: i, sign: -1 })),
  ].map((e, order) => ({ ...e, _o: order }))
   .sort((a, b) => (_msParseDate(b.date) - _msParseDate(a.date)) || (b._o - a._o));

  const purse = `<div class="vtt-ms-purse">
    <div class="vtt-ms-purse-v"><b>${solde}<small>or</small></b><span><i>+${totalR}</i> reçus · <u>−${totalD}</u> dépensés</span></div>
    ${canEdit && solde > 0 ? `<button class="vtt-ms-purse-give" data-vtt-fn="_vttMsPop" data-vtt-args="gold|gold" data-pid="gold">${_msIco('send')} Donner</button>` : ''}
  </div>`;

  const addForm = canEdit ? `<div class="vtt-ms-tx-add">
      <input id="vtt-ms-cpt-lib" class="vtt-ms-tx-inp" type="text" placeholder="Libellé (ex. Vente potion)" maxlength="60">
      <input id="vtt-ms-cpt-amt" class="vtt-ms-tx-inp amt" type="number" min="1" step="1" placeholder="Montant" inputmode="numeric" onkeydown="if(event.key==='Enter')this.blur()">
    </div>
    <div class="vtt-ms-tx-btns">
      <button class="vtt-ms-tx-btn pos" data-vtt-fn="_vttMsCompteAdd" data-vtt-args="${c.id}|${uid}|1">+ Recette</button>
      <button class="vtt-ms-tx-btn neg" data-vtt-fn="_vttMsCompteAdd" data-vtt-args="${c.id}|${uid}|-1">− Dépense</button>
    </div>` : '';

  const hist = merged.length
    ? merged.map(e => `<div class="vtt-ms-tx">
        <small>${_esc(e.date || '')}</small>
        <span title="${_esc(e.libelle || '')}">${_esc(e.libelle || '—')}</span>
        <b class="${e.sign > 0 ? 'pos' : 'neg'}">${e.sign > 0 ? '+' : '−'}${e.montant || 0}</b>
        ${canEdit ? `<button class="vtt-ms-tx-del" data-vtt-fn="_vttMsCompteDel" data-vtt-args="${c.id}|${uid}|${e.type}|${e.idx}" title="Supprimer">${_msIco('trash')}</button>` : ''}
      </div>`).join('')
    : '<div class="vtt-ms-empty">Aucun mouvement.</div>';

  return `${purse}${addForm}<div class="vtt-ms-sect-label">Historique <em>${merged.length}</em></div><div class="vtt-ms-txlist">${hist}</div>`;
}

// Ajoute une recette (sign>0) ou dépense (sign<0). Réutilise useGold (vérifie le
// solde pour une dépense, 1 seule écriture, libellé cohérent avec la fiche).
async function _vttMsCompteAdd(charId, uid, sign) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const amtEl = document.getElementById('vtt-ms-cpt-amt');
  const libEl = document.getElementById('vtt-ms-cpt-lib');
  const montant = Math.abs(parseFloat(amtEl?.value) || 0);
  if (!montant) { showNotif('Montant invalide', 'info'); amtEl?.focus(); return; }
  const s = parseInt(sign) < 0 ? -1 : 1;
  const reason = (libEl?.value || '').trim() || (s > 0 ? 'Recette' : 'Dépense');
  const res = await useGold(charId, s * montant, reason, { charObj: c, refreshUI: false });
  if (!res.ok) { showNotif(res.error || 'Erreur', 'error'); return; }
  showNotif(`${s > 0 ? '+' : '−'}${montant} or — ${reason}`, 'success');
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

// Supprime une ligne de compte (recettes|depenses).
async function _vttMsCompteDel(charId, uid, type, idx) {
  if (!_msCanEdit(uid)) return;
  if (type !== 'recettes' && type !== 'depenses') return;
  idx = parseInt(idx);
  const c = VS.characters[charId]; if (!c) return;
  const prevCompte = { recettes: [], depenses: [], ...(c.compte || {}) };
  const list = [...(prevCompte[type] || [])];
  const removed = list[idx]; if (!removed) return;
  list.splice(idx, 1);
  const newCompte = { ...prevCompte, [type]: list };
  c.compte = newCompte;
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
  try { await updateDoc(_chrRef(charId), { compte: newCompte }); }
  catch (e) { console.error('[vtt] compte del', e); c.compte = prevCompte; if (VS.miniUid) _renderMiniSheet(VS.miniUid); showNotif('Erreur suppression', 'error'); return; }
  showNotif('Mouvement supprimé', 'info', { action: { label: 'Annuler', onClick: () => {
    const cc = VS.characters[charId]; if (!cc) return;
    cc.compte = prevCompte;
    if (VS.miniUid) _renderMiniSheet(VS.miniUid);
    updateDoc(_chrRef(charId), { compte: prevCompte }).catch(() => showNotif('Restauration impossible', 'error'));
  } } });
}

// Envoyer de l'or à un joueur présent — choix du montant + destinataire (mini-fiche).
function _vttMsSendGoldPicker(charId, uid) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const solde = calcOr(c);
  if (solde <= 0) { showNotif('Solde vide', 'info'); return; }
  const targets = Object.entries(VS.presence)
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) => Object.values(VS.characters)
      .filter(ch => ch.uid === pUid)
      .map(ch => ({ charId: ch.id, charNom: ch.nom || p.pseudo, pseudo: p.pseudo })));
  if (!targets.length) { showNotif('Aucun joueur présent à qui envoyer de l\'or', 'info'); return; }
  openModal('💰 Envoyer de l\'or', `
    <div style="display:flex;flex-direction:column;gap:.55rem">
      <div style="font-size:.8rem;color:var(--text-dim)">Solde : <strong style="color:var(--gold)">${solde} or</strong></div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.75rem">Montant</label>
        <input type="number" id="vtt-ms-gold-amt" class="input-field" min="1" max="${solde}" value="1" style="max-width:140px">
      </div>
      <p style="margin:.2rem 0 0;font-size:.85rem;color:var(--text-dim)">Destinataire :</p>
      ${targets.map(t => `<button class="btn btn-outline" style="text-align:left"
        data-vtt-fn="_vttMsConfirmSendGold" data-vtt-args="${charId}|${uid}|${t.charId}">
        ${_esc(t.pseudo)} → ${_esc(t.charNom)}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Effectue le transfert d'or entre deux persos (débit + crédit, rollback si échec).
// La règle Firestore autorise un non-propriétaire à modifier le `compte` d'un
// autre perso (cf. don d'objet) ; on passe charObj car STATE.characters est vide
// côté VTT (les persos vivent dans VS.characters).
async function _vttMsConfirmSendGold(senderCharId, senderUid, recipCharId) {
  if (!_msCanEdit(senderUid)) return;
  const sender = VS.characters[senderCharId]; if (!sender) return;
  const recip  = VS.characters[recipCharId];  if (!recip)  return;
  const amtEl = document.getElementById('vtt-ms-gold-amt');   // encore présent (popover pas re-rendu)
  _msPop = null;                                              // fermé au prochain rendu
  const montant = Math.floor(Math.abs(parseFloat(amtEl?.value) || 0));
  if (!montant) { showNotif('Montant invalide', 'info'); amtEl?.focus(); return; }
  if (montant > calcOr(sender)) { showNotif('Solde insuffisant', 'error'); return; }
  const debit = await useGold(senderCharId, -montant, `Don → ${recip.nom || 'joueur'}`, { charObj: sender, refreshUI: false });
  if (!debit.ok) { showNotif(debit.error || 'Erreur', 'error'); return; }
  const credit = await useGold(recipCharId, +montant, `Don ← ${sender.nom || 'joueur'}`, { charObj: recip, refreshUI: false });
  if (!credit.ok) {
    await useGold(senderCharId, +montant, 'Annulation du don', { charObj: sender, refreshUI: false }).catch(() => {});
    showNotif(/refus|permission/i.test(credit.error || '')
      ? "Envoi refusé : règle Firestore compte manquante (don d'or)" : (credit.error || 'Erreur — don annulé'), 'error');
    return;
  }
  closeModalDirect();
  showNotif(`💰 ${montant} or envoyé à ${recip.nom || 'joueur'}`, 'success');
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

function _msTabInventaire(c, uid, canEdit) {
  const inv = c?.inventaire||[];
  if (!inv.length) return '<div class="vtt-ms-empty">Inventaire vide</div>';

  // Catalogue boutique → images à jour (illustration du catalogue), comme la fiche.
  _msEnsureShop();
  const catalog = new Map((_msCraftShop || []).map(it => [it.id, it]));

  const equip = c?.equipement||{};
  const CAT_LABEL = { arme:'Armes', armure:'Armures', bijou:'Bijoux', consommable:'Consommables', divers:'Divers' };
  const cats = { arme:[], armure:[], bijou:[], consommable:[], divers:[] };

  // 1) Empilage par `itemId` UNIQUEMENT (objets boutique). Les entrées sans
  //    itemId restent une ligne par exemplaire — pas de fusion sur le nom.
  const stacksById = new Map();
  const singletons = [];
  inv.forEach((item, i) => {
    if (!item?.nom) return;
    if (item.itemId) {
      if (!stacksById.has(item.itemId)) stacksById.set(item.itemId, { item, indices: [] });
      stacksById.get(item.itemId).indices.push(i);
    } else {
      singletons.push({ item, indices: [i] });
    }
  });
  // 2) Range les groupes/singletons par catégorie
  for (const g of [...stacksById.values(), ...singletons]) {
    cats[_msCatItem(g.item)].push(g);
  }
  const totalUnitsAll = Object.values(cats).flat().reduce((s, g) => s + g.indices.length, 0);
  const equippedCount = Object.values(equip).filter(e => e?.nom).length;
  const presentCatCount = Object.values(cats).filter(g => g.length).length;

  const _rarColor = (rar) => ({
    commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff',
    tres_rare:'#b47fff', legendaire:'#f59e0b',
  })[rar] || '#9ca3af';

  // Barre de filtre dès 4 objets : recherche toujours dispo ; puces de catégorie
  // seulement s'il y en a plusieurs (inutiles sur une seule catégorie).
  const presentCats = Object.entries(cats).filter(([, g]) => g.length);
  let filterBar = '';
  if (inv.length >= 4) {
    const chips = presentCats.length > 1
      ? [{ key:'all', label:'Tous' }, ...presentCats.map(([cat]) => ({ key: cat, label: CAT_LABEL[cat] }))]
      : [];
    if (!chips.some(ch => ch.key === _msInvCat)) _msInvCat = 'all';
    filterBar = _msFilterBar('inv', chips, _msInvQuery);
  } else { _msInvCat = 'all'; _msInvQuery = ''; }

  let html = _msTabIntro('inv', 'Sac', `${totalUnitsAll}`, `${equippedCount} équipé${equippedCount > 1 ? 's' : ''} · ${presentCatCount} catégorie${presentCatCount > 1 ? 's' : ''}`)
    + filterBar + '<div class="vtt-ms-inv">';
  for (const [cat, groups] of Object.entries(cats)) {
    if (!groups.length) continue;
    const totalUnits = groups.reduce((s,g) => s + g.indices.length, 0);
    html += `<div class="vtt-ms-inv-group" data-cat="${cat}">
      <div class="vtt-ms-cat">${CAT_LABEL[cat]} <span>${totalUnits}</span></div>`;
    const catIco = { arme: 'combat', armure: 'equip', bijou: 'ring', consommable: 'potion', divers: 'misc' }[cat] || 'inv';
    for (const g of groups) {
      const item = g.item;
      const firstIdx = g.indices[0];
      const total = g.indices.length;
      const equippedIdx = g.indices.find(idx => Object.values(equip).some(e => e?.sourceInvIndex === idx));
      const isEq = equippedIdx !== undefined;
      const idxToEquip = g.indices.find(idx => !Object.values(equip).some(e => e?.sourceInvIndex === idx)) ?? firstIdx;
      const idxToUnequip = equippedIdx ?? firstIdx;
      const detail = item.degats
        ? `${item.degats}${item.typeArme?' · '+item.typeArme:''}${item.portee?' · '+item.portee:''}`
        : (item.typeArmure ? `${item.typeArmure}${item.ca?' · CA +'+item.ca:''}` : '');
      const eqEntry = isEq ? Object.entries(equip).find(([, e]) => e?.sourceInvIndex === equippedIdx) : null;
      const eqLabel = eqEntry ? (_msSlots().find(sl => sl.id === eqEntry[0])?.label || 'Équipé') : '';
      const img = getInventoryItemImage(item, item.itemId ? catalog.get(item.itemId) : null);
      const isEquipCat = (cat === 'arme' || cat === 'armure' || cat === 'bijou');
      html += `<div class="vtt-ms-inv-item vtt-ms-it${isEq?' eq':''}" data-name="${_esc(_norm(item.nom||''))}">
        <span class="vtt-ms-it-img" style="--rc:${_rarColor(item.rarete)}">${img ? `<img src="${_esc(img)}" alt="" loading="lazy">` : _msIco(catIco)}</span>
        <div class="vtt-ms-it-b">
          <div class="vtt-ms-it-nm"><span title="${_esc(item.nom)}">${_esc(item.nom)}</span>${total>1?`<span class="vtt-ms-it-q">×${total}</span>`:''}${eqLabel?`<span class="vtt-ms-it-slot">${_esc(eqLabel)}</span>`:''}</div>
          ${detail?`<div class="vtt-ms-it-d">${_esc(detail)}</div>`:''}
          ${isEquipCat ? _msItemChips(item) : ''}
        </div>
        ${canEdit?`<div class="vtt-ms-it-acts">
          ${isEquipCat && (!isEq || total > 1) ? `<button class="vtt-ms-it-btn" data-vtt-fn="_vttMsEquipPicker" data-vtt-args="${c.id}|${uid}|${idxToEquip}" title="Équiper" aria-label="Équiper">${_msIco('equip')}</button>` : ''}
          ${isEq ? `<button class="vtt-ms-it-btn" data-vtt-fn="_vttMsUnequipAll" data-vtt-args="${c.id}|${uid}|${idxToUnequip}" title="Déséquiper" aria-label="Déséquiper">${_msIco('unlock')}</button>` : ''}
          <button class="vtt-ms-it-btn" data-vtt-fn="_vttMsPop" data-vtt-args="send|send-${firstIdx}|${firstIdx}" data-pid="send-${firstIdx}" title="Donner" aria-label="Donner">${_msIco('send')}</button>
          <button class="vtt-ms-it-btn danger" data-vtt-fn="_vttMsDeleteItem" data-vtt-args="${c.id}|${uid}|${firstIdx}" title="Supprimer" aria-label="Supprimer">${_msIco('trash')}</button>
        </div>`:''}
      </div>`;
    }
    html += `</div>`; // .vtt-ms-inv-group
  }
  html += '</div>';
  html += `<div class="vtt-ms-filter-empty" data-kind="inv" style="display:none">Aucun objet ne correspond.</div>`;
  return html;
}

// ── Onglet Craft (recette rapide) ───────────────────────────────────────
// Liste les recettes connues du joueur (collection `recipes`, partagées via
// `acces`). Crafter consomme les ingrédients présents en sac et lance un jet
// d'Artisanat (d20 + mod INT) vs DD 11. Réussite → ajoute le résultat (objet
// boutique réel si la recette y est liée via shopItemId, sinon un consommable).
// Échec → ingrédients perdus quand même. Le jet est posté dans le log VTT.
const _MS_CRAFT_DD = 11;
// Type de recette → clé d'icône SVG (_msIco).
const _MS_CRAFT_TYPE_ICON = { cuisine:'craft', potion:'craft', arme:'combat', armure:'equip', bijou:'sorts' };

let _msCraftRecipes = null;   // recettes chargées (array) | null = pas encore chargé
let _msCraftLoading = false;
let _msCraftShop    = null;   // items boutique (chargés à la demande : recettes + images du sac)
let _msCraftConfirm = null;   // id de recette en confirmation inline
let _msCraftResult  = {};     // id de recette → { win, txt } affiché 6 s sur la carte
let _msShopLoading  = false;

// Charge le catalogue boutique une fois (cache session) pour résoudre les images
// d'inventaire à jour (illustration du catalogue), comme la vraie fiche perso.
async function _msEnsureShop() {
  if (_msCraftShop !== null || _msShopLoading) return;
  _msShopLoading = true;
  try { _msCraftShop = await loadCollection('shop'); }
  catch { _msCraftShop = []; }
  finally {
    _msShopLoading = false;
    if (VS.miniUid && _miniTab === 'sac') _renderMiniSheet(VS.miniUid);
  }
}

// Charge les recettes une fois (cache session). Re-render à l'arrivée des données.
async function _msEnsureCraftRecipes() {
  if (_msCraftRecipes !== null || _msCraftLoading) return;
  _msCraftLoading = true;
  try { _msCraftRecipes = await loadCollection('recipes'); }
  catch { _msCraftRecipes = []; }
  finally {
    _msCraftLoading = false;
    if (VS.miniUid && _miniTab === 'sac') _renderMiniSheet(VS.miniUid);
  }
}

// Recettes connues du perso : MJ = toutes, joueur = celles partagées avec lui.
function _msKnownRecipes(uid) {
  const list = _msCraftRecipes || [];
  return STATE.isAdmin ? list : list.filter(r => (r.acces || []).includes(uid));
}

// Compte les unités d'inventaire par nom normalisé (convention 1 entrée = 1 unité).
function _msInvNameCounts(c) {
  const counts = new Map();
  (c?.inventaire || []).forEach(it => {
    if (!it?.nom) return;
    const k = _norm(it.nom);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return counts;
}

// État des ingrédients d'une recette vis-à-vis du sac.
function _msRecipeIngrStatus(recipe, counts) {
  const ingrs = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).filter(ig => ig?.nom);
  const rows = ingrs.map(ig => {
    const need = Math.max(1, parseInt(ig.quantite) || 1);
    const have = counts.get(_norm(ig.nom)) || 0;
    return { nom: ig.nom, need, have, ok: have >= need };
  });
  return { rows, hasIngr: ingrs.length > 0, allOk: ingrs.length > 0 && rows.every(r => r.ok) };
}

function _msTabCraft(c, uid, canEdit) {
  if (_msCraftRecipes === null) { _msEnsureCraftRecipes(); return loadingHtml('Chargement des recettes…', { compact: true }); }

  const known = _msKnownRecipes(uid);
  if (!known.length) return '<div class="vtt-ms-empty">Aucune recette connue.</div>';

  const counts = _msInvNameCounts(c);
  const cards  = known
    .map(r => ({ r, st: _msRecipeIngrStatus(r, counts) }))
    .sort((a, b) => (b.st.allOk - a.st.allOk) || (a.r.nom || '').localeCompare(b.r.nom || ''));
  const craftableCount = cards.filter(x => x.st.allOk).length;

  const intMod = getMod(c, 'intelligence');
  const header = `<div class="vtt-ms-sect-label">Artisanat · INT ${intMod >= 0 ? '+' + intMod : intMod} contre DD ${_MS_CRAFT_DD}</div>`;
  return header
    + _msFilterBar('craft', [], _msCraftQuery)
    + `<div class="vtt-ms-filter-empty" data-kind="craft" style="display:none">Aucune recette ne correspond.</div>`
    + `<div class="vtt-ms-craft">${cards.map(({ r, st }) => {
    const icon = _msIco(_MS_CRAFT_TYPE_ICON[r.type] || 'craft');
    const searchTxt = _norm([r.nom, r.type, r.effet, ...((r.ingredients || []).map(ig => ig?.nom))].filter(Boolean).join(' '));
    const ingrHtml = st.hasIngr
      ? `<div class="vtt-ms-craft-ingrs">${st.rows.map(row =>
          `<span class="vtt-ms-craft-ingr">${_esc(row.nom)}<b class="${row.ok ? 'ok' : 'ko'}">${row.have}/${row.need}</b></span>`).join('')}</div>`
      : `<div class="vtt-ms-craft-noingr">Pas d'ingrédients listés — non craftable ici.</div>`;
    const canCraft = canEdit && st.allOk;
    const confirming = _msCraftConfirm === r.id && canCraft;
    const res = _msCraftResult[r.id];
    const successTxt = r.shopItemId ? 'Réussite : l\'objet va dans le sac.' : 'Réussite : effet à appliquer à la main.';
    const footer = !canEdit ? ''
      : confirming
        ? `<div class="vtt-ms-craft-ft"><p>Ingrédients consommés même en cas d'échec.</p><button class="vtt-ms-craft-btn ghost" data-vtt-fn="_vttMsCraftCancel">Annuler</button><button class="vtt-ms-craft-btn amber" data-vtt-fn="_vttMsCraft" data-vtt-args="${c.id}|${uid}|${r.id}">Lancer le jet</button></div>`
        : `<div class="vtt-ms-craft-ft"><p>${successTxt}</p><button class="vtt-ms-craft-btn${canCraft ? ' pri' : ''}" ${canCraft ? `data-vtt-fn="_vttMsCraftAsk" data-vtt-args="${r.id}"` : 'disabled'} title="${st.allOk ? `Jet d'Artisanat (INT) DD ${_MS_CRAFT_DD}` : 'Ingrédients manquants'}">${_msIco('craft')} Crafter</button></div>`;
    return `<div class="vtt-ms-craft-card${st.allOk ? ' craftable' : ''}" data-name="${_esc(searchTxt)}">
      <div class="vtt-ms-craft-hd">
        <span class="vtt-ms-craft-type${st.allOk ? ' ok' : ''}" title="${_esc(r.type || '')}">${icon}</span>
        <span class="vtt-ms-craft-name" title="${_esc(r.nom || '')}">${_esc(r.nom || '?')}</span>
        ${r.effet ? `<span class="vtt-ms-craft-effet" title="${_esc(r.effet)}">${_esc(r.effet)}</span>` : ''}
      </div>
      ${ingrHtml}
      ${res ? `<div class="vtt-ms-craft-res ${res.win ? 'win' : 'lose'}">${_esc(res.txt)}</div>` : ''}
      ${footer}
    </div>`;
  }).join('')}</div>`;
}

// Objet produit par un craft réussi : l'objet boutique lié à la recette, ou
// null si la recette n'a pas d'objet associé (ex. cuisine) — dans ce cas le
// craft se limite à consommer les ingrédients (résultat ajouté à la main).
async function _msBuildCraftResult(recipe) {
  if (!recipe.shopItemId) return null;
  if (_msCraftShop === null) { try { _msCraftShop = await loadCollection('shop'); } catch { _msCraftShop = []; } }
  const shopItem = _msCraftShop.find(i => i.id === recipe.shopItemId);
  return shopItem ? shopItemToInvEntry(shopItem, { source: 'craft' }) : null;
}

// Tente le craft : jet d'Artisanat (INT) DD 11. Consomme les ingrédients
// (succès OU échec) ; ajoute le résultat uniquement si réussi.
async function _vttMsCraft(charId, uid, recipeId) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const recipe = (_msCraftRecipes || []).find(r => r.id === recipeId); if (!recipe) return;

  const status = _msRecipeIngrStatus(recipe, _msInvNameCounts(c));
  if (!status.hasIngr) { showNotif('Recette sans ingrédients structurés.', 'info'); return; }
  if (!status.allOk)   { showNotif('Ingrédients insuffisants.', 'error'); return; }
  // La confirmation « Ingrédients consommés même en cas d'échec » est désormais
  // inline (sur la carte, cf. _vttMsCraftAsk). Ici on lance directement le jet.
  _msCraftConfirm = null;

  // 1) Indices des entrées à consommer (les `need` premières par nom normalisé).
  const oldInv = [...(c.inventaire || [])];
  const removedSet = new Set();
  for (const row of status.rows) {
    const key = _norm(row.nom);
    let left = row.need;
    for (let i = 0; i < oldInv.length && left > 0; i++) {
      if (!removedSet.has(i) && oldInv[i]?.nom && _norm(oldInv[i].nom) === key) { removedSet.add(i); left--; }
    }
    if (left > 0) { showNotif('Ingrédients insuffisants.', 'error'); return; } // garde-fou (course)
  }

  // 2) Jet d'Artisanat INT DD 11 (nat 1 = échec auto, nat 20 = succès auto).
  const mod    = getMod(c, 'intelligence');
  const d20    = Math.floor(Math.random() * 20) + 1;
  const total  = d20 + mod;
  const passed = d20 !== 1 && (d20 === 20 || total >= _MS_CRAFT_DD);
  await bumpSkill(c.id, c.nom || '', 'Artisanat', {
    crit: d20 === 20,
    fumble: d20 === 1,
    natural: d20,
    total,
  });

  // 3) Nouvel inventaire (ingrédients retirés) + objet appendé si réussite & objet lié.
  const removedIdx = [...removedSet];
  const newInv = oldInv.filter((_, i) => !removedSet.has(i));
  let produced = null;
  if (passed) { produced = await _msBuildCraftResult(recipe); if (produced) newInv.push(produced); }
  const historyEntries = status.rows.map(row => makeInventoryHistoryEntry('consume', { nom: row.nom }, row.need, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: 'Craft VTT',
    note: recipe.nom || '',
  }));
  if (produced) {
    historyEntries.push(makeInventoryHistoryEntry('add', produced, 1, {
      actorUid: STATE.user?.uid || '',
      actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
      source: 'Craft VTT',
      note: recipe.nom || '',
    }));
  }
  const historyPatch = inventoryHistoryPayload(c, historyEntries);

  // 4) Réindexe l'équipement (mêmes règles que l'artisan : indices d'origine).
  c.inventaire = newInv;
  const sync = syncEquipmentAfterInventoryMutation(c, removedIdx);

  try {
    await updateDoc(_chrRef(charId), { inventaire: newInv, equipement: sync.equipement, statsBonus: sync.statsBonus, ...historyPatch });
    c.equipement = sync.equipement; c.statsBonus = sync.statsBonus; c.inventoryHistory = historyPatch.inventoryHistory;
  } catch (e) { console.error('[vtt] craft', e); showNotif('Erreur sauvegarde', 'error'); return; }

  // 5) Log VTT (visible par toute la table).
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || c.nom || 'Joueur';
  addDoc(_logCol(), {
    type: 'craft', authorId: STATE.user?.uid || null, authorName,
    characterId: charId || null,
    characterImage: c.photoURL || c.photo || c.avatar || null,
    charName: c.nom || '', recipeName: recipe.nom || '',
    statLabel: 'Artisanat (INT)', mod, d20, total, dd: _MS_CRAFT_DD, passed,
    ...(VS.session?.live && VS.session?.statsSessionKey ? {
      statsSessionKey: VS.session.statsSessionKey,
      statsSessionDate: VS.session.statsSessionDate || '',
    } : {}),
    createdAt: serverTimestamp(),
  }).catch(() => {});

  const okMsg = produced ? `✅ ${produced.nom || recipe.nom} crafté !` : '✅ Réussi — ingrédients consommés';
  showNotif(
    `🔨 Artisanat : d20[${d20}]${mod >= 0 ? '+' : ''}${mod} = ${total} vs DD ${_MS_CRAFT_DD} → ` +
    (passed ? okMsg : '❌ Échec — ingrédients perdus'),
    passed ? 'success' : 'error');

  // Résultat affiché sur la carte pendant 6 s.
  _msCraftResult[recipeId] = {
    win: passed,
    txt: `d20 [${d20}] ${mod >= 0 ? '+' : ''}${mod} = ${total} contre DD ${_MS_CRAFT_DD} · ${passed ? (produced ? 'réussi, ajouté au sac' : 'réussi') : 'échec, ingrédients perdus'}`,
  };
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
  setTimeout(() => { delete _msCraftResult[recipeId]; if (VS.miniUid && _miniTab === 'sac' && _msSac === 'craft') _renderMiniSheet(VS.miniUid); }, 6000);
}

// Confirmation inline « Crafter » (1er clic) puis « Lancer le jet » (2e).
function _vttMsCraftAsk(recipeId) { _msCraftConfirm = recipeId; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsCraftCancel() { _msCraftConfirm = null; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// ── Onglet Notes (modèle notesList partagé avec la vraie fiche) ──────────
// Carnet (refonte) : + note ouvre directement, titre éditable sur place,
// textarea AUTOSAVE (débounce 600 ms, sans re-render pendant la frappe).
function _msTabNotes(c, uid, canEdit) {
  const notes = c?.notesList || [];
  let html = `<div class="vtt-ms-notes">`;
  if (canEdit) html += `<button class="vtt-ms-note-add" data-vtt-fn="_vttMsAddNote" data-vtt-args="${c.id}|${uid}">+ Nouvelle note</button>`;
  if (!notes.length) return html + `<div class="vtt-ms-empty">${canEdit ? 'Carnet vide. Crée une note.' : 'Carnet vide.'}</div></div>`;
  notes.forEach((note, i) => {
    const open = _msOpenNote === i;
    const preview = _msNoteText(note.contenu).split('\n')[0] || '';
    const body = open
      ? (canEdit
        ? `<div class="vtt-ms-note-body">
            <input class="vtt-ms-note-title-inp" id="vtt-ms-nt-t-${i}" data-note-idx="${i}" value="${_esc(note.titre || '')}" placeholder="Titre" maxlength="80">
            <textarea class="vtt-ms-note-area" id="vtt-ms-nt-x-${i}" data-note-idx="${i}" rows="6" placeholder="Écris ici…">${_esc(_msNoteText(note.contenu))}</textarea>
            <div class="vtt-ms-note-ft"><span class="vtt-ms-note-status" id="vtt-ms-nt-s-${i}">Enregistrement automatique</span><button class="vtt-ms-note-del" data-vtt-fn="_vttMsDeleteNote" data-vtt-args="${c.id}|${uid}|${i}" title="Supprimer la note">${_msIco('trash')}</button></div>
          </div>`
        : `<div class="vtt-ms-note-body"><p class="vtt-ms-note-content">${_esc(_msNoteText(note.contenu)) || '—'}</p></div>`)
      : (preview ? `<div class="vtt-ms-note-pv">${_esc(preview)}</div>` : '');
    html += `<div class="vtt-ms-note-card${open ? ' open' : ''}">
      <div class="vtt-ms-note-hd" data-vtt-fn="_vttMsToggleNote" data-vtt-args="${i}" role="button" tabindex="0" aria-expanded="${open}">
        <b class="vtt-ms-note-title">${_esc(note.titre || 'Sans titre')}</b>
        <small class="vtt-ms-note-date">${_esc(note.date || '')}</small>
        <span class="vtt-ms-note-chev">${open ? '▲' : '▼'}</span>
      </div>
      ${body}
    </div>`;
  });
  return html + '</div>';
}

// Autosave du Carnet — lie le titre + le textarea de la note ouverte, débounce
// 600 ms, écrit sans re-render (focus/caret préservés). Appelé après le rendu.
const _msNoteTimers = {};
function _bindMiniNotes(charId, uid) {
  const idx = _msOpenNote; if (idx === null || idx === undefined) return;
  const t = document.getElementById(`vtt-ms-nt-t-${idx}`);
  const x = document.getElementById(`vtt-ms-nt-x-${idx}`);
  const onInput = (el) => {
    const s = document.getElementById(`vtt-ms-nt-s-${idx}`);
    if (s) { s.textContent = 'Enregistrement…'; s.classList.remove('saved'); }
    if (el === t) { const h = el.closest('.vtt-ms-note-card')?.querySelector('.vtt-ms-note-title'); if (h) h.textContent = el.value.trim() || 'Sans titre'; }
    clearTimeout(_msNoteTimers[idx]);
    _msNoteTimers[idx] = setTimeout(() => _msNoteAutosave(charId, uid, idx), 600);
  };
  if (t) t.oninput = () => onInput(t);
  if (x) x.oninput = () => onInput(x);
}
async function _msNoteAutosave(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const t = document.getElementById(`vtt-ms-nt-t-${idx}`);
  const x = document.getElementById(`vtt-ms-nt-x-${idx}`);
  const notes = [...(c.notesList || [])];
  if (!notes[idx]) return;
  notes[idx] = { ...notes[idx], titre: (t ? (t.value.trim() || 'Sans titre') : notes[idx].titre), contenu: x ? x.value : notes[idx].contenu };
  c.notesList = notes;   // reflet local, PAS de re-render → frappe non interrompue
  const ok = await updateDoc(_chrRef(charId), { notesList: notes }).then(() => true).catch(() => false);
  const s = document.getElementById(`vtt-ms-nt-s-${idx}`);
  if (s) { s.textContent = ok ? 'Enregistré' : 'Non enregistré'; s.classList.toggle('saved', ok); }
}

// Texte affiché dans le textarea : si la note vient de l'éditeur riche de la vraie
// fiche (HTML), on la convertit en texte lisible pour ne pas montrer de balises.
function _msNoteText(contenu) {
  if (!contenu) return '';
  if (!/<[a-z][\s\S]*>/i.test(contenu)) return contenu; // déjà du texte brut
  const tmp = document.createElement('div');
  tmp.innerHTML = contenu.replace(/<\/(p|div|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function _vttMsAddNote(charId, uid) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  notes.push({ titre: '', contenu: '', date: new Date().toLocaleDateString('fr-FR') });
  const newIdx = notes.length - 1;
  _msOpenNote = newIdx;
  c.notesList = notes;                 // reflet local → note ouverte tout de suite
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
  setTimeout(() => document.getElementById(`vtt-ms-nt-t-${newIdx}`)?.focus(), 30);
  await updateDoc(_chrRef(charId), { notesList: notes }).catch(() => showNotif('Erreur sauvegarde', 'error'));
}

function _vttMsToggleNote(idx) {
  idx = parseInt(idx);
  _msOpenNote = _msOpenNote === idx ? null : idx;
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

// Suppression sans confirmation + toast « Annuler » (comme le Sac / la Bourse).
async function _vttMsDeleteNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = VS.characters[charId]; if (!c) return;
  const prev = [...(c.notesList || [])];
  if (!prev[idx]) return;
  const prevOpen = _msOpenNote;
  const notes = [...prev];
  notes.splice(idx, 1);
  if (_msOpenNote === idx) _msOpenNote = null;
  else if (_msOpenNote > idx) _msOpenNote--;
  c.notesList = notes;
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
  if (!await updateDoc(_chrRef(charId), { notesList: notes }).then(() => true).catch(() => false)) {
    c.notesList = prev; _msOpenNote = prevOpen;
    if (VS.miniUid) _renderMiniSheet(VS.miniUid);
    showNotif('Suppression impossible', 'error');
    return;
  }
  showNotif('Note supprimée', 'info', { action: { label: 'Annuler', onClick: () => {
    const cc = VS.characters[charId]; if (!cc) return;
    cc.notesList = prev; _msOpenNote = prevOpen;
    if (VS.miniUid) _renderMiniSheet(VS.miniUid);
    updateDoc(_chrRef(charId), { notesList: prev }).catch(() => showNotif('Restauration impossible', 'error'));
  } } });
}

// ─── Rendu principal ─────────────────────────────────────────────

function _renderMiniSheet(uid) {
  try { return _renderMiniSheetImpl(uid); }
  catch (e) { _vttPanelError('Mini-fiche', e, 'vtt-mini-panel'); }
}
function _renderMiniSheetImpl(uid) {
  const panel = document.getElementById('vtt-mini-panel');
  if (!panel) return;

  if (!uid) { panel.classList.remove('open'); panel.innerHTML = ''; return; }
  let pres = VS.presence[uid];
  const playerLabel = pres?.pseudo
    || (uid === STATE.user?.uid ? (STATE.user?.displayName || STATE.user?.email?.split('@')[0]) : '')
    || 'Joueur hors ligne';

  // Favori en tête → sélection d'office du perso favori si aucun choix explicite.
  const chars = _msAvailableCharacters(uid);
  if (!chars.length) {
    panel.classList.add('open');
    panel.innerHTML = `<div class="vtt-ms-empty">Aucun personnage lié pour ${_esc(playerLabel)}.</div>`;
    return;
  }

  const validId = chars.find(c => c.id === VS.miniCharId) ? VS.miniCharId : chars[0].id;
  VS.miniCharId = validId;
  const c = chars.find(c => c.id === validId);
  // Le contexte suit toujours le propriétaire réel du personnage sélectionné.
  // Les contrôleurs délégués gardent leurs droits via `_msCanEdit`.
  uid = c?.uid || uid;
  VS.miniUid = uid;
  pres = VS.presence[uid];
  // Sécurité (défense en profondeur) : ne jamais rendre la fiche d'un tiers, même
  // si l'ouverture est déclenchée par ailleurs. Seuls MJ / propriétaire / contrôleur
  // réel (délégation sur CE personnage) sont autorisés.
  if (!_msCanView(uid, c?.id)) {
    VS.miniUid = null; VS.miniCharId = null;
    panel.classList.remove('open'); panel.innerHTML = '';
    _syncMiniSheetLaunchers();
    return;
  }
  const canEdit = _msCanEdit(uid, c?.id);

  const img      = c?.photoURL || c?.photo || c?.avatar || null;
  const init     = (c?.nom || '?')[0].toUpperCase();

  // Migration des anciennes clés d'onglet → 4 onglets (Combat / Sorts / Sac / Carnet).
  if (_miniTab === 'equip') _miniTab = 'combat';
  else if (_miniTab === 'inv' || _miniTab === 'craft' || _miniTab === 'compte') {
    _msSac = _miniTab === 'craft' ? 'craft' : _miniTab === 'compte' ? 'bourse' : 'obj';
    _miniTab = 'sac';
  }

  const niv = parseInt(c?.niveau) || 1;
  if (_miniCollapsed) {
    panel.classList.add('open', 'is-collapsed');
    panel.innerHTML = _msCollapsedHtml(c);
    _syncMiniSheetLaunchers();
    return;
  }
  panel.classList.remove('is-collapsed');
  const up  = _msXpUp(c);
  const deckMax = calcDeckMax(c), du = getDeckUsage(c?.deck_sorts);
  const invN = (c?.inventaire || []).length, notesN = (c?.notesList || []).length;
  const TABS = [['combat', 'Combat', ''], ['sorts', 'Sorts', `${du.used}/${deckMax}`], ['sac', 'Sac', invN], ['notes', 'Carnet', notesN]];
  const tabBarHtml = `<div class="vtt-ms-tabbar">${TABS.map(([k, l, b]) =>
    `<button class="vtt-ms-tab${_miniTab === k ? ' active' : ''}" data-vtt-fn="_vttMsTab" data-vtt-args="${k}"><span class="vtt-ms-tab-lbl">${l}</span>${b !== '' ? ` <small>${b}</small>` : ''}</button>`).join('')}</div>`;

  const tabHtml =
      _miniTab === 'sorts' ? _msTabSorts(c, uid, canEdit)
    : _miniTab === 'sac'   ? _msTabSac(c, uid, canEdit)
    : _miniTab === 'notes' ? _msTabNotes(c, uid, canEdit)
    :                        _msTabCombat(c, uid, canEdit) + _msTabEquipement(c, uid, canEdit);

  const roBanner = !canEdit ? '<div class="vtt-ms-ro">Fiche consultable en lecture seule.</div>' : '';
  const subText = [c?.race, c?.classe, c?.titreActuel || c?.titre]
    .filter(Boolean)
    .map(_esc)
    .join(' · ');
  const online = !!pres;
  const onlineDot = `<span class="vtt-ms-online-dot ${online ? 'is-online' : 'is-offline'}" title="Joueur ${online ? 'en ligne' : 'hors ligne'}" aria-label="Joueur ${online ? 'en ligne' : 'hors ligne'}"></span>`;

  // Préserve le défilement + le focus/caret (recherches, notes, bourse).
  const ae = document.activeElement, fid = ae && panel.contains(ae) ? ae.id : null;
  const caret = fid && typeof ae.selectionStart === 'number' ? ae.selectionStart : null;
  const contentScroll = panel.querySelector('.vtt-ms-tab-content')?.scrollTop || 0;

  const multiChar = chars.length > 1;
  const xp = parseInt(c?.exp) || 0;
  const xpMax = calcPalier(niv);
  panel.classList.add('open');
  panel.innerHTML = `
    <div class="vtt-ms-resize" title="Glisser pour redimensionner"></div>
    <div class="vtt-ms-header">
      <button class="vtt-ms-portrait${up ? ' up' : ''}" data-vtt-fn="_vttMsPop" data-vtt-args="xp|xp" data-pid="xp" title="XP ${parseInt(c?.exp) || 0} / ${calcPalier(niv)} — gérer">
        ${_msRingHtml(c)}
        ${img ? `<img class="vtt-ms-avatar" src="${_esc(img)}" alt="">` : `<div class="vtt-ms-avatar-init">${init}</div>`}
        <span class="vtt-ms-niv">Niv. ${niv}${up ? ' ↑' : ''}</span>
      </button>
      <div class="vtt-ms-info">
        <div class="vtt-ms-name">${onlineDot}<span>${_esc(c?.nom || 'Personnage')}</span>${multiChar ? `<button class="vtt-ms-name-sel" data-vtt-fn="_vttMsPop" data-vtt-args="char|char" data-pid="char" title="Changer de personnage">▾</button>` : ''}</div>
        ${subText ? `<div class="vtt-ms-sub">${subText}</div>` : ''}
        <div class="vtt-ms-xp-summary"><b>${xp.toLocaleString('fr-FR')}</b><span>/ ${xpMax.toLocaleString('fr-FR')} XP</span></div>
      </div>
      <div class="vtt-ms-head-actions">
        <button class="vtt-ms-collapse" data-vtt-fn="_vttMsToggleCollapsed" title="Réduire la mini-fiche" aria-label="Réduire la mini-fiche">‹</button>
        <button class="vtt-ms-close" data-vtt-fn="_vttToggleMiniSheet" data-vtt-args="${uid}" title="Fermer · C" aria-label="Fermer la mini-fiche">×</button>
      </div>
    </div>
    ${roBanner}
    ${_msFactsHtml(c)}
    ${_msStatsFixedHtml(c)}
    ${tabBarHtml}
    <div class="vtt-ms-tab-content">${tabHtml}</div>
    ${_msPopHtml(c, uid)}`;

  // Applique le filtre de l'onglet actif sur le DOM fraîchement rendu.
  if (_miniTab === 'sac' && _msSac === 'obj') _msApplyInvFilter();
  else if (_miniTab === 'sorts')              _msApplySortFilter();
  else if (_miniTab === 'notes')              _bindMiniNotes(c.id, uid);
  _msInitPop(); _msPlacePop();
  _msInitResize(); _msApplyStoredWidth();
  const popInp = document.getElementById('vtt-ms-xp-add'); if (popInp && _msPop?.v === 'xp') popInp.focus();
  const content = panel.querySelector('.vtt-ms-tab-content'); if (content) content.scrollTop = contentScroll;
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* noop */ } } }
}

function _syncMiniSheetLaunchers() {
  document.querySelectorAll('.vtt-who-sheet').forEach(button => {
    const active = VS.miniUid === button.dataset.miniUid
      && VS.miniCharId === button.dataset.miniChar;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function _vttToggleMiniSheet(uid, charId = null) {
  const sameCharacter = VS.miniUid === uid && (!charId || VS.miniCharId === charId);
  if (sameCharacter) {
    _miniCollapsed = false;
    VS.miniUid = null; VS.miniCharId = null;
    const panel = document.getElementById('vtt-mini-panel');
    if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  } else {
    // Sécurité : refuser l'ouverture de la fiche d'un autre joueur (contenu privé).
    if (!_msCanView(uid, charId)) { showNotif('Fiche réservée à son propriétaire.', 'info'); return; }
    VS.miniUid = uid; VS.miniCharId = charId || null;
    _miniCollapsed = false;
    _renderMiniSheet(uid);
  }
  _syncMiniSheetLaunchers();
  _renderPresenceCol();
}

function _vttSelectMiniChar(uid, charId) {
  if (!_msCanView(uid, charId)) { showNotif('Fiche réservée à son propriétaire.', 'info'); return; }
  _msPop = null;
  VS.miniUid = VS.characters[charId]?.uid || uid;
  VS.miniCharId = charId;
  // Reset des filtres : l'inventaire/les sorts diffèrent d'un perso à l'autre.
  _msInvQuery = ''; _msInvCat = 'all'; _msSortQuery = ''; _msSortCat = 'all'; _msCraftQuery = '';
  _renderMiniSheet(VS.miniUid);
  _syncMiniSheetLaunchers();
}

// Touche C : ouvre/ferme la fiche du personnage contrôlé (token sélectionné,
// sinon son propre perso). Câblée dans _keyHandler (hors saisie, sans modif.).
function _vttMsKeyToggle() {
  if (VS.miniUid) { _vttToggleMiniSheet(VS.miniUid, VS.miniCharId); return; }
  const uid = STATE.user?.uid;
  const selT = VS.selected ? VS.tokens[VS.selected]?.data : null;
  if (selT?.characterId) {
    const sUid = selT.ownerId || VS.characters[selT.characterId]?.uid || uid;
    if (_msCanView(sUid, selT.characterId)) { _vttToggleMiniSheet(sUid, selT.characterId); return; }
  }
  const own = favoriteFirst(Object.values(VS.characters).filter(ch => ch.uid === uid));
  if (own.length) { _vttToggleMiniSheet(uid, own[0].id); return; }
  showNotif('Aucune fiche à afficher', 'info');
}

// Largeur réglable du panneau (340–560 px), mémorisée dans localStorage.
const _MS_W_MIN = 340, _MS_W_MAX = 560;
function _msApplyStoredWidth() {
  const panel = document.getElementById('vtt-mini-panel'); if (!panel) return;
  const w = parseInt(lsJson.get('vtt-ms-width', 0));
  if (w >= _MS_W_MIN && w <= _MS_W_MAX) panel.style.setProperty('--vtt-ms-w', w + 'px');
}
let _msResizeInit = false;
function _msInitResize() {
  if (_msResizeInit) return; _msResizeInit = true;
  let dragging = false;
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.vtt-ms-resize')) return;
    const panel = document.getElementById('vtt-mini-panel'); if (!panel) return;
    e.preventDefault(); dragging = true; panel.classList.add('resizing');
    try { e.target.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });
  document.addEventListener('pointermove', e => {
    if (!dragging) return;
    const panel = document.getElementById('vtt-mini-panel'); if (!panel) return;
    const left = panel.getBoundingClientRect().left;
    const w = Math.max(_MS_W_MIN, Math.min(_MS_W_MAX, Math.round(e.clientX - left)));
    panel.style.setProperty('--vtt-ms-w', w + 'px');
  });
  document.addEventListener('pointerup', () => {
    if (!dragging) return; dragging = false;
    const panel = document.getElementById('vtt-mini-panel');
    panel?.classList.remove('resizing');
    const w = parseInt((panel?.style.getPropertyValue('--vtt-ms-w') || '').replace('px', ''));
    if (w >= _MS_W_MIN && w <= _MS_W_MAX) lsJson.set('vtt-ms-width', w);
  });
}

export {
  _msApplyInvFilter,
  _msApplySortFilter,
  _vttMsKeyToggle,
  _msInitResize,
  _msApplyStoredWidth,
  _msBuildEquipItem,
  _msCanEdit,
  _msCanEditVitals,
  _msCatItem,
  _msFilterBar,
  _msItemFitsSlot,
  _msNoteText,
  _msSetActiveChip,
  _msSyncClearBtn,
  _msTabCombat,
  _msTabCompte,
  _msTabCraft,
  _msTabEquipement,
  _msTabInventaire,
  _msTabNotes,
  _msTabSorts,
  _msToggleEmpty,
  _msXpSection,
  _renderMiniSheet,
  _vttMsAddNote,
  _vttMsCompteAdd,
  _vttMsSendGoldPicker,
  _vttMsConfirmSendGold,
  _vttMsCompteDel,
  _vttMsConfirmSend,
  _vttMsCraft,
  _vttMsCraftAsk,
  _vttMsCraftCancel,
  _vttMsCraftSearch,
  _vttMsCraftClear,
  _vttMsDeleteItem,
  _vttMsDeleteNote,
  _vttMsEquip,
  _vttMsEquipPicker,
  _vttMsInvCat,
  _vttMsInvClear,
  _vttMsInvSearch,
  _vttMsSac,
  _vttMsGoPurse,
  _vttMsPop,
  _vttMsToggleSpell,
  _vttMsSendPicker,
  _vttMsSlotChange,
  _vttMsSortCat,
  _vttMsSortClear,
  _vttMsSortSearch,
  _vttMsTab,
  _vttMsToggleCollapsed,
  _vttMsAttackSlot,
  _vttMsToggleNote,
  _vttMsUnequip,
  _vttMsUnequipAll,
  _vttSelectMiniChar,
  _vttSpellCardHtml,
  _vttSpellChips,
  _vttToggleMiniSheet,
  _vttToggleMsSort,
};
