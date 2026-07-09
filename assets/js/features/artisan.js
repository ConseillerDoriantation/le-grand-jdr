// ══════════════════════════════════════════════════════════════════════════════
// ARTISAN — Améliorations d'équipement
//
// Modale complète accessible depuis la boutique. Gère :
//   - Sac de fragments de traits (catégorisé par slot d'origine)
//   - Liste des items améliorables de l'inventaire du joueur
//   - Actions : détruire, ajouter, écraser, améliorer stats
//
// Tarifs et plafonds : world/upgrade_settings (édité par le MJ).
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { getShopCharId } from '../shared/shop-session.js';
import { trySave } from '../shared/crud.js';
import { openModal, pushModal, closeModalDirect, confirmModal, modalSection } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import {
  calcOr, getItemStatBonus, getItemBaseStatBonus, getItemUpgradeStatBonus,
  ITEM_STAT_META, ITEM_STAT_BY_FULL, computeEquipStatsBonus, getDefaultCharForUser,
} from '../shared/char-stats.js';
import {
  _getTraits, _getBaseTraits, _getAddedTraits,
  syncEquipmentAfterInventoryMutation, buildEquippedItemFromInventory,
} from '../shared/equipment-utils.js';
import { loadUpgradeSettings, getUpgradeSettings } from '../shared/upgrade-settings.js';
import { getVisibleCharacters } from '../shared/character-state.js';

// ══════════════════════════════════════════════
// CATÉGORIES DE FRAGMENTS
// Un fragment ne peut être posé que sur un item de la même catégorie.
// (Toutes les armes partagent la catégorie 'arme', peu importe le format.)
// ══════════════════════════════════════════════
export const FRAGMENT_CATEGORIES = [
  { id: 'arme',          label: 'Arme',          icon: '⚔️' },
  { id: 'Tête',          label: 'Tête',          icon: '🪖' },
  { id: 'Torse',         label: 'Torse',         icon: '🛡️' },
  { id: 'Pieds',         label: 'Pieds',         icon: '🥾' },
  { id: 'Amulette',      label: 'Amulette',      icon: '📿' },
  { id: 'Anneau',        label: 'Anneau',        icon: '💍' },
  { id: 'Objet magique', label: 'Objet magique', icon: '🔮' },
];

const FRAGMENT_CAT_BY_ID = Object.fromEntries(FRAGMENT_CATEGORIES.map(c => [c.id, c]));

// Détecte la catégorie de fragment d'un item d'inventaire.
// Renvoie null si l'item n'est pas améliorable (ex : potion, item libre).

const STORE = {
  activeCharId: null,
  activeItemIndex: null,   // objet sélectionné dans l'établi (index inventaire)
  mjFreeMode: false,
};

export function getItemFragmentCategory(item = {}) {
  if (!item) return null;
  const tpl = (item.template || '').toLowerCase();
  if (tpl === 'arme' || /arme|bouclier|baguette|main libre/i.test(item.format || '')) {
    return 'arme';
  }
  if (item.slotArmure && FRAGMENT_CAT_BY_ID[item.slotArmure]) return item.slotArmure;
  if (item.slotBijou && FRAGMENT_CAT_BY_ID[item.slotBijou]) return item.slotBijou;
  return null;
}

// Retourne le nombre de slots de traits autorisés pour un item.
// La clé du plafond est directement la catégorie de fragment (artisan unifié).
export function getItemTraitsSlotCount(item = {}) {
  const s = getUpgradeSettings();
  const cat = getItemFragmentCategory(item);
  if (!cat) return 0;
  return s.caps?.traitsPerItem?.[cat] ?? 1;
}

// ══════════════════════════════════════════════
// FRAGMENTS — accès au sac du personnage
// Structure : c.traitFragments = { 'arme': { 'Tranchant': 2 }, 'Tête': { ... } }
// ══════════════════════════════════════════════

export function getCharacterFragments(c) {
  return c?.traitFragments || {};
}

export function getFragmentCount(c, category, traitName) {
  return c?.traitFragments?.[category]?.[traitName] || 0;
}

// Mutation pure d'un objet traitFragments — renvoie un nouvel objet
export function _addFragment(fragments, category, traitName, delta = 1) {
  const next = { ...(fragments || {}) };
  next[category] = { ...(next[category] || {}) };
  const cur = parseInt(next[category][traitName]) || 0;
  const updated = cur + delta;
  if (updated <= 0) {
    delete next[category][traitName];
    if (!Object.keys(next[category]).length) delete next[category];
  } else {
    next[category][traitName] = updated;
  }
  return next;
}

// ══════════════════════════════════════════════
// SÉLECTION DU PERSONNAGE CIBLE
// Joueur : son perso unique (ou le seul auquel il a accès)
// MJ : sélecteur de personnage
// ══════════════════════════════════════════════

// Mode MJ : si actif, toutes les améliorations sont gratuites mais loggent
// `mjOverride: true` dans l'historique de l'item. Réservé aux admins.

// Le coût est-il finançable (or suffisant OU mode MJ gratuit actif) ?
function _canAfford(c, cost) {
  return STORE.mjFreeMode || cost <= calcOr(c);
}

function _getEligibleChars() {
  return getVisibleCharacters();
}

function _getActiveArtisanChar() {
  const chars = _getEligibleChars();
  if (!chars.length) return null;
  let active = chars.find(c => c.id === STORE.activeCharId);
  if (!active) {
    // Réutilise la sélection boutique si valide, sinon le perso favori (★), sinon le premier
    active = chars.find(c => c.id === getShopCharId())
      || getDefaultCharForUser(chars, STATE.user?.uid)
      || chars[0];
    STORE.activeCharId = active?.id || null;
  }
  return active;
}

// ══════════════════════════════════════════════
// MODALE PRINCIPALE
// ══════════════════════════════════════════════

export async function openArtisanModal() {
  await loadUpgradeSettings();
  STORE.activeCharId = null; // reset à chaque ouverture
  STORE.activeItemIndex = null;
  STORE.mjFreeMode = false;          // sécurité : MJ doit ré-activer le mode gratuit à chaque session
  _renderArtisanModal();
}

function _renderArtisanModal() {
  const chars = _getEligibleChars();
  const c = _getActiveArtisanChar();

  if (!chars.length) {
    openModal('🔨 Artisan', `
      <div style="padding:1rem;text-align:center;color:var(--text-dim);font-size:.9rem">
        Aucun personnage disponible.<br>
        ${STATE.isAdmin ? 'Aucun personnage n\'existe.' : 'Crée un personnage pour utiliser l\'artisan.'}
      </div>`);
    return;
  }

  const charSelect = chars.length > 1 || STATE.isAdmin
    ? `<select class="input-field" style="font-size:.85rem;padding:.4rem .55rem"
        data-change="_artisanSelectChar">
        ${chars.map(ch => `<option value="${ch.id}"${ch.id === c?.id ? ' selected' : ''}>${_esc(ch.nom || '?')}${STATE.isAdmin ? ` (${_esc(ch.ownerPseudo || '')})` : ''}</option>`).join('')}
      </select>`
    : `<div style="font-size:.92rem;font-weight:700;color:var(--text)">${_esc(c?.nom || '?')}</div>`;

  const or = c ? Math.floor(calcOr(c)) : 0;

  const mjToggle = STATE.isAdmin ? `
    <label style="display:flex;align-items:center;gap:.4rem;font-size:.74rem;
      color:${STORE.mjFreeMode ? '#ff6b6b' : 'var(--text-dim)'};cursor:pointer;
      padding:.3rem .55rem;border-radius:6px;border:1px solid ${STORE.mjFreeMode ? 'rgba(255,107,107,.4)' : 'var(--border)'};
      background:${STORE.mjFreeMode ? 'rgba(255,107,107,.08)' : 'transparent'};white-space:nowrap">
      <input type="checkbox" ${STORE.mjFreeMode ? 'checked' : ''}
        data-change="_artisanToggleMjFree"
        style="margin:0;cursor:pointer">
      🔧 MJ gratuit
    </label>` : '';

  openModal('🔨 Artisan — Améliorations d\'équipement', `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.85rem">
      <div style="flex:1">${charSelect}</div>
      ${mjToggle}
      <div style="font-size:.85rem;color:var(--gold);font-weight:700;white-space:nowrap">💰 ${or} PO</div>
    </div>

    <div class="art-layout">
      <div class="art-left">
        <div class="art-left-hd">🛠️ Ton équipement</div>
        ${_renderItemList(c)}
        ${_renderFragmentBag(c)}
      </div>
      <div class="art-right">
        ${_renderWorkbench(c)}
      </div>
    </div>
  `, { subtitle: 'Choisis un objet à gauche pour l\'améliorer', accent: '#f4c430' });
  document.getElementById('modal-box')?.classList.add('modal--artisan');
}

// ── Sac de fragments ────────────────────────────────────────────────
function _renderFragmentBag(c) {
  const bag = getCharacterFragments(c);
  const totalCount = Object.values(bag).reduce(
    (s, frags) => s + Object.values(frags || {}).reduce((s2, n) => s2 + (parseInt(n) || 0), 0),
    0,
  );

  const sections = FRAGMENT_CATEGORIES.map(cat => {
    const frags = bag[cat.id] || {};
    const entries = Object.entries(frags).filter(([, n]) => (parseInt(n) || 0) > 0);
    if (!entries.length) return '';
    const chips = entries.map(([name, n]) =>
      `<span class="art-frag-chip" title="${_esc(name)} — pose-able sur un ${_esc(cat.label.toLowerCase())}">
        ${_esc(name)} <span class="art-frag-chip-n">×${n}</span>
      </span>`
    ).join('');
    return `<div class="art-frag-cat">
      <span class="art-frag-cat-hd">${cat.icon} ${_esc(cat.label)}</span>
      <div class="art-frag-cat-chips">${chips}</div>
    </div>`;
  }).filter(Boolean).join('');

  return `
    <div class="art-frag-bag">
      <div class="art-frag-bag-hd">
        <span style="font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim)">
          🎒 Sac de fragments
        </span>
        <span style="font-size:.7rem;color:var(--text-dim)">${totalCount} fragment${totalCount > 1 ? 's' : ''}</span>
      </div>
      <div class="art-frag-hint">Obtenus en <strong>recyclant</strong> un objet à trait. Sers-t'en pour <strong>ajouter</strong> un trait à un objet de la même catégorie.</div>
      ${sections || `<div class="art-frag-empty">Aucun fragment — recycle un équipement à trait pour en obtenir.</div>`}
    </div>`;
}

// Résumé d'un item pour la liste (traits + bonus de stats en une ligne courte).
function _itemSummary(item) {
  const totalTraits = _getTraits(item).length;
  const slotCount = getItemTraitsSlotCount(item);
  const upBonus = ITEM_STAT_META
    .map(m => [m.short, getItemUpgradeStatBonus(item, m.full)])
    .filter(([, v]) => v > 0)
    .map(([s, v]) => `+${v}${s}`).join(' ');
  const parts = [];
  if (slotCount > 0) parts.push(`${totalTraits}/${slotCount} trait${slotCount > 1 ? 's' : ''}`);
  if (upBonus) parts.push(upBonus);
  return parts.join(' · ');
}

// ── Liste des objets améliorables (colonne gauche, sélectionnable) ──────
function _renderItemList(c) {
  if (!c) return `<div class="art-empty">Sélectionne un personnage.</div>`;
  const inv = Array.isArray(c.inventaire) ? c.inventaire : [];
  const eligible = inv
    .map((it, idx) => ({ it, idx, cat: getItemFragmentCategory(it) }))
    .filter(({ cat }) => cat !== null);

  if (!eligible.length) {
    return `<div class="art-empty">Aucun équipement améliorable dans l'inventaire.<br>
      <span style="font-size:.9em">Achète une arme, une armure ou un bijou dans la boutique.</span></div>`;
  }

  return `<div class="art-item-list">
    ${eligible.map(({ it, idx, cat }) => {
      const meta = FRAGMENT_CAT_BY_ID[cat];
      const active = idx === STORE.activeItemIndex;
      const summary = _itemSummary(it);
      return `<button class="art-item-card${active ? ' is-active' : ''}" data-action="_artisanSelectItem" data-i="${idx}">
        <span class="art-item-cat" title="${_esc(meta?.label || '')}">${meta?.icon || '📦'}</span>
        <span class="art-item-card-body">
          <span class="art-item-name">${_esc(it.nom || 'Sans nom')}</span>
          ${summary ? `<span class="art-item-sum">${summary}</span>` : ''}
        </span>
        <span class="art-item-chev">${active ? '▾' : '›'}</span>
      </button>`;
    }).join('')}
  </div>`;
}

// ── Établi (colonne droite) : tout ce qu'on peut faire à l'objet choisi ──
function _renderWorkbench(c) {
  if (!c) return '';
  if (STORE.activeItemIndex == null) {
    return `<div class="art-wb-empty">
      <div class="art-wb-empty-ic">🔨</div>
      <div>Choisis un objet à gauche pour voir ce que tu peux améliorer.</div>
    </div>`;
  }
  const item = (c.inventaire || [])[STORE.activeItemIndex];
  const cat = item ? getItemFragmentCategory(item) : null;
  if (!item || !cat) { STORE.activeItemIndex = null; return _renderWorkbench(c); }
  const meta = FRAGMENT_CAT_BY_ID[cat];
  const i = STORE.activeItemIndex;

  // État actuel (bonus de stats + traits)
  const upBonus = ITEM_STAT_META
    .map(m => [m.short, getItemUpgradeStatBonus(item, m.full)])
    .filter(([, v]) => v > 0)
    .map(([s, v]) => `<span class="art-up-chip">+${v} ${s}</span>`).join('');
  const allTraits = _getTraits(item);
  const traitState = allTraits.length
    ? allTraits.map(t => `<span class="art-trait-chip">${_esc(t)}</span>`).join('')
    : '<span class="art-muted" style="font-size:.72rem">aucun trait</span>';

  const histBtn = Array.isArray(item?.upgrades?.history) && item.upgrades.history.length
    ? `<button class="art-wb-hist" data-action="_artisanOpenHistory" data-i="${i}" title="Historique des améliorations">📜 ${item.upgrades.history.length}</button>`
    : '';

  return `<div class="art-wb">
    <div class="art-wb-hd">
      <span class="art-wb-ico">${meta?.icon || '📦'}</span>
      <span class="art-wb-name">${_esc(item.nom || 'Sans nom')}</span>
      <span class="art-wb-cat">${_esc(meta?.label || cat)}${item.format ? ` · ${_esc(item.format)}` : ''}</span>
      ${histBtn}
    </div>
    <div class="art-wb-state">${upBonus}${upBonus && allTraits.length ? '' : ''}${traitState}</div>

    ${_renderTraitsSection(item, i, c, cat)}
    ${_renderStatsSection(item, i, c, cat)}
    ${_renderRecycleSection(item, i, cat)}
  </div>`;
}

// ── Toggle MJ gratuit (admins seulement) ────────────────────────────
function _artisanToggleMjFree(on) {
  if (!STATE.isAdmin) { STORE.mjFreeMode = false; return; }
  STORE.mjFreeMode = !!on;
  _renderArtisanModal();
}

// ── Historique des améliorations d'un item ─────────────────────────
function _artisanOpenHistory(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;
  const hist = Array.isArray(item.upgrades?.history) ? item.upgrades.history : [];

  const fmt = (e) => {
    const d = new Date(e.at || 0);
    const date = isNaN(d) ? '?' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const op = e.op || 'upgrade';
    const detail = [
      e.stat   ? `stat ${e.stat}` : null,
      e.level  ? `palier ${e.level}` : null,
      e.trait  ? `trait « ${e.trait} »` : null,
    ].filter(Boolean).join(' · ');
    const cost = parseInt(e.cost) || 0;
    const mj   = e.mjOverride ? ' <span style="color:#ff6b6b;font-weight:700">MJ</span>' : '';
    return `<div style="display:flex;justify-content:space-between;gap:.5rem;
      padding:.4rem .55rem;border-radius:6px;background:var(--bg-elevated);
      border:1px solid var(--border);font-size:.78rem">
      <div>
        <div style="font-weight:600;color:var(--text)">${_esc(op)}${mj}</div>
        <div style="color:var(--text-dim);font-size:.72rem">${_esc(detail || '—')}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="color:var(--gold);font-weight:700">${cost} PO</div>
        <div style="color:var(--text-dim);font-size:.7rem">${date}</div>
      </div>
    </div>`;
  };

  const totalCost = hist.reduce((s, e) => s + (parseInt(e.cost) || 0), 0);
  const body = hist.length
    ? `<div style="display:flex;flex-direction:column;gap:.4rem;max-height:50vh;overflow-y:auto">${hist.map(fmt).join('')}</div>
       <div style="margin-top:.75rem;padding-top:.5rem;border-top:1px solid var(--border);
         font-size:.8rem;color:var(--text-muted);display:flex;justify-content:space-between">
         <span>Total investi</span><strong style="color:var(--gold)">${totalCost} PO</strong>
       </div>`
    : `<div style="padding:1rem;text-align:center;color:var(--text-dim);font-size:.85rem">
         Aucun historique pour cet item.
       </div>`;

  pushModal(`📜 Historique — ${_esc(item.nom || 'objet')}`, `${body}
    <div style="margin-top:.85rem;text-align:right">
      <button class="btn btn-outline btn-sm" data-action="_artisanCloseModal">Fermer</button>
    </div>`);
};

// ══════════════════════════════════════════════
// HELPERS DE PERSISTANCE & SYNCHRONISATION
// ══════════════════════════════════════════════

// Regénère tous les slots équipés à partir de l'inventaire courant.
// Utile après mutation d'un item d'inventaire pour propager les nouveaux traits/stats.
function _rebuildAllEquipment(c) {
  const inv = Array.isArray(c.inventaire) ? c.inventaire : [];
  const equip = c.equipement || {};
  const next = {};

  Object.entries(equip).forEach(([slot, eq]) => {
    const idx = Number.isInteger(eq?.sourceInvIndex) ? eq.sourceInvIndex : parseInt(eq?.sourceInvIndex, 10);
    if (Number.isInteger(idx) && inv[idx]) {
      const rebuilt = buildEquippedItemFromInventory(slot, inv[idx], idx);
      if (rebuilt) next[slot] = rebuilt;
    } else if (eq) {
      // Slot équipé sans lien d'inventaire (saisi manuellement) : on garde tel quel
      next[slot] = eq;
    }
  });

  return next;
}

// Ajoute une dépense au ledger du personnage.
// En mode MJ gratuit, on ne débite pas le ledger.
function _logExpense(c, label, amount) {
  if (STORE.mjFreeMode || amount <= 0) return;
  const compte = c.compte || { recettes: [], depenses: [] };
  const depenses = Array.isArray(compte.depenses) ? [...compte.depenses] : [];
  depenses.push({
    date: new Date().toISOString().slice(0, 10),
    libelle: label,
    montant: amount,
  });
  c.compte = { ...compte, depenses };
}

// Ajoute une entrée à l'historique d'amélioration de l'item.
// En mode MJ gratuit, le coût est forcé à 0 et l'override est tracé.
function _logUpgradeHistory(item, entry) {
  const up = item.upgrades || {};
  const history = Array.isArray(up.history) ? [...up.history] : [];
  history.push({
    at: Date.now(),
    by: STATE.user?.uid || null,
    ...entry,
    cost: STORE.mjFreeMode ? 0 : (parseInt(entry.cost) || 0),
    mjOverride: !!STORE.mjFreeMode,
  });
  item.upgrades = { ...up, history };
}

// Persiste le perso (inventaire + traitFragments + compte + equipement + statsBonus)
// puis re-render la modale principale.
async function _persistChar(c) {
  c.equipement = _rebuildAllEquipment(c);
  c.statsBonus = computeEquipStatsBonus(c.equipement);
  await trySave('characters', c.id, {
    inventaire:     c.inventaire     || [],
    traitFragments: c.traitFragments || {},
    compte:         c.compte         || { recettes: [], depenses: [] },
    equipement:     c.equipement,
    statsBonus:     c.statsBonus,
  });
  closeModalDirect();
  _renderArtisanModal();
}

// ══════════════════════════════════════════════
// ÉTABLI — SECTION TRAITS (inline)
// ══════════════════════════════════════════════

function _renderTraitsSection(item, invIndex, c, cat) {
  const catMeta    = FRAGMENT_CAT_BY_ID[cat];
  const baseTraits = _getBaseTraits(item);
  const allTraits  = [..._getTraits(item)];
  const slotCount  = getItemTraitsSlotCount(item);
  const totalUsed  = allTraits.length;
  const slotsLibres= Math.max(0, slotCount - totalUsed);
  const s          = getUpgradeSettings();
  const fragments  = c.traitFragments?.[cat] || {};
  const fragNames  = Object.entries(fragments).filter(([, n]) => (parseInt(n) || 0) > 0).map(([name, n]) => ({ name, n }));

  if (slotCount <= 0) return '';

  // Pastilles d'emplacements (pleins / libres)
  const pips = Array.from({ length: slotCount }, (_, k) =>
    `<span class="art-pip${k < totalUsed ? ' is-on' : ''}"></span>`).join('');

  // Chips des traits actuels (base + ajoutés★) — lecture seule (le remplacement
  // a maintenant sa propre rangée d'actions, aussi visible que l'ajout).
  const traitRows = allTraits.length
    ? allTraits.map((t, k) => `<span class="art-trait-chip${k >= baseTraits.length ? ' art-trait-chip--added' : ''}">${_esc(t)}${k >= baseTraits.length ? ' ★' : ''}</span>`).join('')
    : '<span class="art-muted" style="font-size:.72rem">Aucun trait posé.</span>';

  // ── Ajouter (slot libre) ──
  let addHtml = '';
  if (slotsLibres > 0) {
    addHtml = fragNames.length
      ? `<div class="art-sub"><span class="art-sub-lbl art-sub-lbl--add">＋ Ajouter un trait</span>
          <div class="art-act-row">${fragNames.map(f => `<button class="art-act art-act--gold" data-action="_artisanAddTrait" data-i="${invIndex}" data-frag="${_esc(f.name)}" title="Poser « ${_esc(f.name)} » (${s.trait.addTraitFromFragment} PO)">
            <span class="art-act-lbl">${_esc(f.name)}</span><span class="art-act-cost">${s.trait.addTraitFromFragment} PO</span><span class="art-act-n">×${f.n}</span></button>`).join('')}</div>
        </div>`
      : `<div class="art-muted" style="font-size:.72rem">Aucun fragment « ${_esc(catMeta?.label || cat)} » dans ton sac. Recycle un objet pour en obtenir.</div>`;
  }

  // ── Remplacer (même poids visuel que l'ajout) ──
  let owHtml = '';
  if (allTraits.length && fragNames.length) {
    owHtml = `<div class="art-sub"><span class="art-sub-lbl art-sub-lbl--replace">↻ Remplacer un trait</span>
      <div class="art-act-row">${allTraits.map(t => `<button class="art-act art-act--replace" data-action="_artisanOverwriteStart" data-i="${invIndex}" data-trait="${_esc(t)}" title="Remplacer « ${_esc(t)} » par un fragment (${s.trait.overwriteTrait} PO)">
        <span class="art-act-lbl">${_esc(t)}</span><span class="art-act-cost">${s.trait.overwriteTrait} PO</span></button>`).join('')}</div>
    </div>`;
  }

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">🔖 Traits <span class="art-wb-sec-sub">${totalUsed}/${slotCount} emplacement${slotCount > 1 ? 's' : ''}</span><span class="art-pips">${pips}</span></div>
    <div class="art-trait-current">${traitRows}</div>
    ${addHtml}${owHtml}
    ${(slotsLibres <= 0 && !allTraits.length) ? '' : ''}
  </div>`;
}

// Section « Recycler » (ex-destruction) — récupère les traits en fragments.
function _renderRecycleSection(item, invIndex, cat) {
  const s = getUpgradeSettings();
  const allTraits = _getTraits(item);
  if (!allTraits.length) return '';
  const extractInfo = s.trait.extractAllTraits
    ? `Tu récupères ${allTraits.length} fragment${allTraits.length > 1 ? 's' : ''}.`
    : (allTraits.length > 1 ? 'Tu choisiras le trait à récupérer (les autres sont perdus).' : 'Tu récupères son trait en fragment.');
  return `<div class="art-wb-sec art-wb-sec--danger">
    <div class="art-wb-sec-hd">♻️ Recycler en fragments</div>
    <div class="art-recycle">
      <button class="art-act art-act--danger" data-action="_artisanDestroyStart" data-i="${invIndex}">♻️ Recycler <span class="art-act-cost">${s.trait.deconstructCost} PO</span></button>
      <span class="art-muted" style="font-size:.72rem">Détruit l'objet. ${extractInfo}</span>
    </div>
  </div>`;
}

// ── Détruire : si plusieurs traits et !extractAllTraits, demander lequel ──
async function _artisanDestroyStart(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const s = getUpgradeSettings();
  const allTraits = _getTraits(item);
  if (!allTraits.length) return;
  const cost = s.trait.deconstructCost || 0;
  const costTxt = STORE.mjFreeMode ? 'Gratuit (MJ)' : `${cost} PO`;

  if (s.trait.extractAllTraits || allTraits.length === 1) {
    // Cas simple → une seule confirmation.
    const list = allTraits.map(t => `« ${_esc(t)} »`).join(', ');
    if (!await confirmModal(`Recycler « ${_esc(item.nom || 'objet')} » ?<br>Tu récupères ${allTraits.length} fragment${allTraits.length > 1 ? 's' : ''} (${list}). L'objet est détruit.<br><span style="color:var(--gold)">${costTxt}</span>`,
      { title: '♻️ Recycler en fragments', confirmLabel: 'Recycler', danger: true, icon: '♻️' })) return;
    return _artisanDoDestroy(invIndex, allTraits);
  }

  // Plusieurs traits → le choix EST la confirmation (pas de 2ᵉ modale).
  pushModal(`♻️ Recycler « ${item.nom || 'objet'} »`, `
    <div class="art-muted" style="font-size:.8rem;margin-bottom:.6rem;line-height:1.5">
      Quel trait veux-tu <strong>récupérer en fragment</strong> ? Les autres seront <strong style="color:#ff8ca7">perdus</strong>, et l'objet détruit.<br>
      <span style="color:var(--gold)">${costTxt}</span> · action <strong>immédiate</strong>.
    </div>
    <div class="art-ow-list">
      ${allTraits.map(t => `
        <button class="art-ow-opt" data-action="_artisanDestroyConfirm" data-i="${invIndex}" data-trait="${_esc(t)}">
          <span class="art-ow-opt-name">${_esc(t)}</span>
          <span class="art-ow-opt-cta">♻️ Récupérer</span>
        </button>
      `).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">Annuler</button>
    </div>
  `);
};

function _artisanDestroyConfirm(invIndex, traitName) {
  closeModalDirect(); // ferme le sélecteur (qui servait de confirmation)
  _artisanDoDestroy(invIndex, [traitName]);
}

async function _artisanDoDestroy(invIndex, traitsToExtract) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  if (!cat) { showNotif('Cet item n\'est pas catégorisable.', 'error'); return; }

  const s    = getUpgradeSettings();
  const cost = s.trait.deconstructCost || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  // 1) Supprimer l'item de l'inventaire
  const inv = [...(c.inventaire || [])];
  inv.splice(invIndex, 1);
  c.inventaire = inv;
  STORE.activeItemIndex = null;   // l'objet recyclé n'existe plus → établi vide

  // 2) Sync équipement (décale les sourceInvIndex)
  const sync = syncEquipmentAfterInventoryMutation(c, [invIndex]);
  c.equipement = sync.equipement;
  c.statsBonus = sync.statsBonus;

  // 3) Ajouter les fragments
  let frags = c.traitFragments || {};
  traitsToExtract.forEach(t => { frags = _addFragment(frags, cat, t, +1); });
  c.traitFragments = frags;

  // 4) Débit or si applicable
  if (cost > 0) _logExpense(c, `Artisan : destruction de ${item.nom}`, cost);

  await _persistChar(c);
  showNotif(`${traitsToExtract.length} fragment(s) ajouté(s) au sac.`, 'success');
}

// ── Ajouter un trait (slot libre) ──
async function _artisanAddTrait(invIndex, fragmentName) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  if (!cat) return;

  const slotCount = getItemTraitsSlotCount(item);
  const totalTraits = _getTraits(item).length;
  if (totalTraits >= slotCount) { showNotif('Aucun slot libre.', 'error'); return; }

  const fragCount = getFragmentCount(c, cat, fragmentName);
  if (fragCount <= 0) { showNotif('Fragment indisponible.', 'error'); return; }

  const s = getUpgradeSettings();
  const cost = s.trait.addTraitFromFragment || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  if (!await confirmModal(`Poser le trait « ${_esc(fragmentName)} » sur « ${_esc(item.nom || 'objet')} » ?<br><span style="color:var(--gold)">${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${cost} PO`}</span> · consomme 1 fragment.`,
    { title: '🔖 Ajouter un trait', confirmLabel: 'Poser', danger: false, icon: '🔖' })) return;

  // Mutation
  const inv = [...(c.inventaire || [])];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    addedTraits: [...(up.addedTraits || []), fragmentName],
  };
  _logUpgradeHistory(newItem, { op: 'add_trait', value: fragmentName, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  c.traitFragments = _addFragment(c.traitFragments || {}, cat, fragmentName, -1);
  if (cost > 0) _logExpense(c, `Artisan : ajout du trait ${fragmentName} sur ${item.nom}`, cost);

  await _persistChar(c);
  showNotif(`Trait « ${fragmentName} » ajouté.`, 'success');
};

// ── Écraser un trait existant ──
function _artisanOverwriteStart(invIndex, oldTraitName) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  const fragments = c.traitFragments?.[cat] || {};
  const fragNames = Object.entries(fragments).filter(([, n]) => (parseInt(n) || 0) > 0).map(([name, n]) => ({ name, n }));

  if (!fragNames.length) {
    showNotif('Aucun fragment compatible dans le sac.', 'error');
    return;
  }

  const s = getUpgradeSettings();

  pushModal(`↻ Remplacer « ${oldTraitName} »`, `
    <div class="art-muted" style="font-size:.8rem;margin-bottom:.6rem;line-height:1.5">
      Choisis le fragment à poser à la place. <strong style="color:#ff8ca7">« ${_esc(oldTraitName)} » sera définitivement perdu</strong>.<br>
      Coût : <strong style="color:var(--gold)">${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${s.trait.overwriteTrait} PO`}</strong> + 1 fragment. Le choix ci-dessous est <strong>immédiat</strong>.
    </div>
    <div class="art-ow-list">
      ${fragNames.map(f => `
        <button class="art-ow-opt" data-action="_artisanOverwriteConfirm" data-i="${invIndex}" data-old="${_esc(oldTraitName)}" data-frag="${_esc(f.name)}">
          <span class="art-ow-opt-name">${_esc(f.name)}</span>
          <span class="art-ow-opt-n">×${f.n}</span>
          <span class="art-ow-opt-cta">↻ Poser${STORE.mjFreeMode ? '' : ` · ${s.trait.overwriteTrait} PO`}</span>
        </button>
      `).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">Annuler</button>
    </div>
  `);
};

async function _artisanOverwriteConfirm(invIndex, oldTraitName, newFragmentName) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  if (!cat) return;

  if (getFragmentCount(c, cat, newFragmentName) <= 0) { showNotif('Fragment indisponible.', 'error'); return; }

  const s = getUpgradeSettings();
  const cost = s.trait.overwriteTrait || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  // Le sélecteur de fragment EST la confirmation (il annonce clairement la perte
  // et le coût) → on applique directement, sans 2ᵉ modale.
  closeModalDirect(); // ferme le sélecteur

  // Mutation
  const inv = [...(c.inventaire || [])];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  const baseTraits  = _getBaseTraits(item);     // base après éventuels removed
  const addedTraits = _getAddedTraits(item);

  const isBaseTrait  = baseTraits.includes(oldTraitName);
  const isAddedTrait = addedTraits.includes(oldTraitName);

  let nextRemovedBase = up.removedBaseTraits || [];
  let nextAddedTraits = up.addedTraits || [];

  if (isAddedTrait) {
    // Retire le trait ajouté (premier match suffit)
    const idx = nextAddedTraits.indexOf(oldTraitName);
    nextAddedTraits = [...nextAddedTraits.slice(0, idx), ...nextAddedTraits.slice(idx + 1)];
  } else if (isBaseTrait) {
    // Marque le trait base comme supprimé
    nextRemovedBase = [...nextRemovedBase, oldTraitName];
  }

  // Ajoute le nouveau trait
  nextAddedTraits = [...nextAddedTraits, newFragmentName];

  newItem.upgrades = {
    ...up,
    removedBaseTraits: nextRemovedBase,
    addedTraits: nextAddedTraits,
  };
  _logUpgradeHistory(newItem, { op: 'overwrite_trait', from: oldTraitName, to: newFragmentName, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  // Décrémente le fragment, débit or
  c.traitFragments = _addFragment(c.traitFragments || {}, cat, newFragmentName, -1);
  if (cost > 0) _logExpense(c, `Artisan : écrasement ${oldTraitName} → ${newFragmentName} sur ${item.nom}`, cost);

  await _persistChar(c);
  showNotif(`Trait « ${oldTraitName} » remplacé par « ${newFragmentName} ».`, 'success');
}

// ══════════════════════════════════════════════
// ACTIONS — STATS
// Dispatch selon catégorie : anneau / amulette / arme.
// (Armures Tête/Torse/Pieds et Objet magique : pas d'amélioration stats.)
// ══════════════════════════════════════════════

function _artisanSelectChar(id) {
  STORE.activeCharId = id;
  STORE.activeItemIndex = null;   // repart sans objet sélectionné
  _renderArtisanModal();
};

// Sélection d'un objet dans la colonne gauche → affiche/masque son établi.
function _artisanSelectItem(invIndex) {
  STORE.activeItemIndex = (STORE.activeItemIndex === invIndex) ? null : invIndex;
  _renderArtisanModal();
}

// Section « Stats » de l'établi — dispatch inline selon la catégorie.
function _renderStatsSection(item, invIndex, c, cat) {
  if (cat === 'Anneau')   return _renderRingStats(item, invIndex, c);
  if (cat === 'Amulette') return _renderAmuletStats(item, invIndex, c);
  if (cat === 'arme')     return _renderWeaponStats(item, invIndex, c);
  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats</div>
    <div class="art-muted" style="font-size:.72rem">Cet objet s'améliore uniquement par ses <strong>traits</strong> (pas de bonus de stats).</div>
  </div>`;
}

// ── Helpers communs ──────────────────────────────────────────────────

// Retourne la 1ʳᵉ stat non nulle d'un item (utile pour anneaux).
function _detectPrimaryStat(item) {
  for (const meta of ITEM_STAT_META) {
    if (getItemBaseStatBonus(item, meta.full) !== 0) return meta;
  }
  return null;
}

// Somme totale des points de stats déjà ajoutés via upgrades.
function _sumUpgradeStatPoints(item) {
  const sb = item?.upgrades?.statBonus || {};
  return Object.values(sb).reduce((s, v) => s + (parseInt(v) || 0), 0);
}

// Liste des stats déjà améliorées avec leur valeur.
function _getUpgradedStatEntries(item) {
  const sb = item?.upgrades?.statBonus || {};
  return ITEM_STAT_META
    .map(m => ({ meta: m, val: parseInt(sb[m.store]) || 0 }))
    .filter(({ val }) => val > 0);
}

// ══════════════════════════════════════════════
// ANNEAU — DEUX TRACKS INDÉPENDANTS
//   • Stat de base (auto-détectée) — paliers 1..cap
//   • Effet flat (effectBonus)     — paliers 1..cap
// Tarif `s.ring[N]` partagé pour les deux tracks.
// ══════════════════════════════════════════════
function _renderRingStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;
  const primary = _detectPrimaryStat(item);
  const statLevel   = primary ? (parseInt(item.upgrades?.statBonus?.[primary.store]) || 0) : 0;
  const effectLevel = parseInt(item.upgrades?.effectBonus) || 0;

  const acts = [];
  if (primary) {
    const nextStatLvl = statLevel + 1;
    if (nextStatLvl <= cap) {
      const cost = s.ring?.[nextStatLvl] || 0;
      acts.push(`<button class="art-act art-act--emerald" data-action="_artisanRingUpgradeStat" data-i="${invIndex}">📈 +1 ${primary.short} <span class="art-act-cost">${cost} PO</span></button>`);
    }
  }
  const nextEff = effectLevel + 1;
  if (nextEff <= cap) {
    const cost = s.ring?.[nextEff] || 0;
    acts.push(`<button class="art-act art-act--gold" data-action="_artisanRingUpgradeEffect" data-i="${invIndex}">✨ Renforcer l'effet <span class="art-act-cost">${cost} PO</span></button>`);
  }

  const totalStat = primary ? getItemBaseStatBonus(item, primary.full) + statLevel : 0;
  const cur = [];
  if (primary) cur.push(`<span class="art-up-chip">+${totalStat} ${primary.short}</span>`);
  cur.push(`<span class="art-up-chip">Effet +${effectLevel}</span>`);
  const baseEffect = item.effet ? `<div class="art-muted" style="font-size:.7rem;margin-top:.35rem">Effet : <em>${_esc(item.effet)}</em></div>` : '';

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats d'anneau <span class="art-wb-sec-sub">stat ${statLevel}/${cap} · effet ${effectLevel}/${cap}</span></div>
    <div class="art-trait-current">${cur.join('')}</div>
    ${acts.length ? `<div class="art-act-row">${acts.join('')}</div>` : `<div class="art-muted" style="font-size:.72rem">Tout est au palier maximum.</div>`}
    ${baseEffect}
  </div>`;
}

function _renderAmuletStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = s.caps?.amulet ?? 3;
  const used = _getUpgradedStatEntries(item);
  const usedSet = new Set(used.map(e => e.meta.full));
  const slotN = used.length + 1;
  const cost = slotN <= cap ? (s.amulet?.[slotN] || 0) : 0;
  const remaining = ITEM_STAT_META.filter(m => !usedSet.has(m.full));
  const canAdd = used.length < cap && remaining.length > 0;

  const cur = used.length ? used.map(e => `<span class="art-up-chip">+${e.val} ${e.meta.short}</span>`).join('') : '<span class="art-muted" style="font-size:.72rem">aucune stat améliorée</span>';
  const add = canAdd
    ? `<div class="art-act-row">${remaining.map(m => `<button class="art-act art-act--emerald" data-action="_artisanAmuletAddStat" data-i="${invIndex}" data-stat="${_esc(m.full)}">+1 ${m.short} <span class="art-act-cost">${cost} PO</span></button>`).join('')}</div>`
    : `<div class="art-muted" style="font-size:.72rem">${used.length >= cap ? `Plafond atteint (${cap} stats).` : 'Toutes les stats sont déjà améliorées.'}</div>`;

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats d'amulette <span class="art-wb-sec-sub">${used.length}/${cap} stats</span></div>
    <div class="art-trait-current">${cur}</div>
    ${add}
  </div>`;
}

function _renderWeaponStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const is2H = /2M|2m/.test(String(item.format || ''));
  const cap = is2H ? (s.caps?.weapon2H ?? 4) : (s.caps?.weapon1H ?? 2);
  const tariff = is2H ? (s.weapon?.['2H'] || {}) : (s.weapon?.['1H'] || {});
  const used = _getUpgradedStatEntries(item);
  const total = used.reduce((a, e) => a + e.val, 0);
  const slotN = total + 1;
  const cost = total < cap ? (tariff[slotN] || 0) : 0;
  const canAdd = total < cap;

  const cur = used.length ? used.map(e => `<span class="art-up-chip">+${e.val} ${e.meta.short}</span>`).join('') : '<span class="art-muted" style="font-size:.72rem">aucun point placé</span>';
  const bar = `<span class="art-bar"><span style="width:${Math.round(total / cap * 100)}%"></span></span>`;
  const add = canAdd
    ? `<div class="art-act-row">${ITEM_STAT_META.map(m => `<button class="art-act art-act--emerald" data-action="_artisanWeaponAddPoint" data-i="${invIndex}" data-stat="${_esc(m.full)}">+1 ${m.short} <span class="art-act-cost">${cost} PO</span></button>`).join('')}</div>`
    : `<div class="art-muted" style="font-size:.72rem">Plafond atteint (${total}/${cap} points).</div>`;

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats d'arme <span class="art-wb-sec-sub">${total}/${cap} points</span>${bar}</div>
    <div class="art-trait-current">${cur}</div>
    ${add}
  </div>`;
}

// — Action : améliorer la stat de l'anneau seule
async function _artisanRingUpgradeStat(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const primary = _detectPrimaryStat(item);
  if (!primary) { showNotif('Aucune stat de base sur cet anneau.', 'error'); return; }

  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;
  const level = parseInt(item.upgrades?.statBonus?.[primary.store]) || 0;
  const nextLevel = level + 1;
  if (nextLevel > cap) { showNotif(`Stat au palier max (${cap}).`, 'error'); return; }

  const cost = s.ring?.[nextLevel] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  if (!await confirmModal(`Améliorer ${primary.label} au palier ${nextLevel} ?<br><span style="color:var(--gold)">${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${cost} PO`}</span>`,
    { title: '📈 Améliorer la stat', confirmLabel: 'Améliorer', danger: false, icon: '📈' })) return;

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [primary.store]: nextLevel },
  };
  _logUpgradeHistory(newItem, { op: 'ring_upgrade_stat', level: nextLevel, stat: primary.full, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : anneau ${item.nom || ''} stat ${primary.short} +${nextLevel}`, cost);

  await _persistChar(c);
  showNotif(`Stat ${primary.label} améliorée au palier ${nextLevel}.`, 'success');
}

// — Action : améliorer l'effet de l'anneau seul
async function _artisanRingUpgradeEffect(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;
  const level = parseInt(item.upgrades?.effectBonus) || 0;
  const nextLevel = level + 1;
  if (nextLevel > cap) { showNotif(`Effet au palier max (${cap}).`, 'error'); return; }

  const cost = s.ring?.[nextLevel] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  if (!await confirmModal(`Renforcer l'effet de l'anneau au palier ${nextLevel} ?<br><span style="color:var(--gold)">${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${cost} PO`}</span>`,
    { title: '✨ Renforcer l\'effet', confirmLabel: 'Renforcer', danger: false, icon: '✨' })) return;

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = { ...up, effectBonus: nextLevel };
  _logUpgradeHistory(newItem, { op: 'ring_upgrade_effect', level: nextLevel, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : anneau ${item.nom || ''} effet +${nextLevel}`, cost);

  await _persistChar(c);
  showNotif(`Effet renforcé au palier ${nextLevel}.`, 'success');
}

// ══════════════════════════════════════════════
// AMULETTE — jusqu'à N stats DISTINCTES, +1 chacune
// ══════════════════════════════════════════════
async function _artisanAmuletAddStat(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  if (!meta) return;

  const s = getUpgradeSettings();
  const cap = s.caps?.amulet ?? 3;

  const used = _getUpgradedStatEntries(item);
  if (used.length >= cap) { showNotif(`Plafond amulette atteint (${cap}).`, 'error'); return; }
  if (used.some(e => e.meta.full === meta.full)) {
    showNotif(`Stat ${meta.label} déjà améliorée.`, 'error'); return;
  }

  const slotN = used.length + 1;
  const cost = s.amulet?.[slotN] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  if (!await confirmModal(`Ajouter +1 ${meta.label} à l'amulette ?<br><span style="color:var(--gold)">${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${cost} PO`}</span>`,
    { title: '📈 Améliorer l\'amulette', confirmLabel: 'Ajouter', danger: false, icon: '📈' })) return;

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: 1 },
  };
  _logUpgradeHistory(newItem, { op: 'amulet_add_stat', stat: meta.full, slot: slotN, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : amulette ${item.nom || ''} +1 ${meta.short}`, cost);

  await _persistChar(c);
  showNotif(`+1 ${meta.label} ajouté à l'amulette.`, 'success');
}

// ══════════════════════════════════════════════
// ARME — points distribuables (cap 1H ou 2H)
// Le joueur peut cumuler plusieurs points sur la même stat ou répartir.
// ══════════════════════════════════════════════
async function _artisanWeaponAddPoint(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  if (!meta) return;

  const s = getUpgradeSettings();
  const fmt = String(item.format || '');
  const is2H = /2M|2m/.test(fmt);
  const cap = is2H ? (s.caps?.weapon2H ?? 4) : (s.caps?.weapon1H ?? 2);
  const tariffTable = is2H ? (s.weapon?.['2H'] || {}) : (s.weapon?.['1H'] || {});

  const sb = item.upgrades?.statBonus || {};
  const total = Object.values(sb).reduce((s2, v) => s2 + (parseInt(v) || 0), 0);
  if (total >= cap) { showNotif(`Plafond atteint (${cap} points).`, 'error'); return; }

  const slotN = total + 1;
  const cost = tariffTable[slotN] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  if (!await confirmModal(`Ajouter +1 ${meta.label} à l'arme ?<br><span style="color:var(--gold)">${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${cost} PO`}</span>`,
    { title: '📈 Améliorer l\'arme', confirmLabel: 'Ajouter', danger: false, icon: '📈' })) return;

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  const curStat = parseInt(up.statBonus?.[meta.store]) || 0;
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: curStat + 1 },
  };
  _logUpgradeHistory(newItem, { op: 'weapon_add_point', stat: meta.full, slot: slotN, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : arme ${item.nom || ''} +1 ${meta.short}`, cost);

  await _persistChar(c);
  showNotif(`+1 ${meta.label} ajouté à l'arme.`, 'success');
};


registerActions({
  _artisanSelectChar: (el) => _artisanSelectChar(el.value),
  _artisanSelectItem: (btn) => _artisanSelectItem(Number(btn.dataset.i)),
  _artisanToggleMjFree: (el) => _artisanToggleMjFree(el.checked),
  _artisanOpenHistory: (btn) => _artisanOpenHistory(Number(btn.dataset.i)),
  _artisanDestroyStart: (btn) => _artisanDestroyStart(Number(btn.dataset.i)),
  _artisanDestroyConfirm: (btn) => _artisanDestroyConfirm(Number(btn.dataset.i), btn.dataset.trait),
  _artisanAddTrait: (btn) => _artisanAddTrait(Number(btn.dataset.i), btn.dataset.frag),
  _artisanOverwriteStart: (btn) => _artisanOverwriteStart(Number(btn.dataset.i), btn.dataset.trait),
  _artisanOverwriteConfirm: (btn) => _artisanOverwriteConfirm(Number(btn.dataset.i), btn.dataset.old, btn.dataset.frag),
  _artisanRingUpgradeStat: (btn) => _artisanRingUpgradeStat(Number(btn.dataset.i)),
  _artisanRingUpgradeEffect: (btn) => _artisanRingUpgradeEffect(Number(btn.dataset.i)),
  _artisanAmuletAddStat: (btn) => _artisanAmuletAddStat(Number(btn.dataset.i), btn.dataset.stat),
  _artisanWeaponAddPoint: (btn) => _artisanWeaponAddPoint(Number(btn.dataset.i), btn.dataset.stat),
  _artisanCloseModal: () => closeModalDirect(),
  _artisanBack: () => closeModalDirect(),
});
