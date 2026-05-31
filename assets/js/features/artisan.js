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
import { updateInCol } from '../data/firestore.js';
import { openModal, pushModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import {
  calcOr, getItemStatBonus, getItemBaseStatBonus, getItemUpgradeStatBonus,
  ITEM_STAT_META, ITEM_STAT_BY_FULL, computeEquipStatsBonus,
} from '../shared/char-stats.js';
import {
  _getTraits, _getBaseTraits, _getAddedTraits,
  syncEquipmentAfterInventoryMutation,
} from './characters/data.js';
import { buildEquippedItemFromInventory } from './characters/equipment.js';
import { loadUpgradeSettings, getUpgradeSettings } from '../shared/upgrade-settings.js';

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

let _activeArtisanCharId = null;
// Mode MJ : si actif, toutes les améliorations sont gratuites mais loggent
// `mjOverride: true` dans l'historique de l'item. Réservé aux admins.
let _mjFreeMode = false;

// Le coût est-il finançable (or suffisant OU mode MJ gratuit actif) ?
function _canAfford(c, cost) {
  return _mjFreeMode || cost <= calcOr(c);
}

function _getEligibleChars() {
  const all = Array.isArray(STATE.characters) ? STATE.characters : [];
  return STATE.isAdmin ? all : all.filter(c => c.uid === STATE.user?.uid);
}

function _getActiveArtisanChar() {
  const chars = _getEligibleChars();
  if (!chars.length) return null;
  let active = chars.find(c => c.id === _activeArtisanCharId);
  if (!active) {
    active = chars.find(c => c.id === getShopCharId()) || chars[0];
    _activeArtisanCharId = active?.id || null;
  }
  return active;
}

// ══════════════════════════════════════════════
// MODALE PRINCIPALE
// ══════════════════════════════════════════════

export async function openArtisanModal() {
  await loadUpgradeSettings();
  _activeArtisanCharId = null; // reset à chaque ouverture
  _mjFreeMode = false;          // sécurité : MJ doit ré-activer le mode gratuit à chaque session
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
      color:${_mjFreeMode ? '#ff6b6b' : 'var(--text-dim)'};cursor:pointer;
      padding:.3rem .55rem;border-radius:6px;border:1px solid ${_mjFreeMode ? 'rgba(255,107,107,.4)' : 'var(--border)'};
      background:${_mjFreeMode ? 'rgba(255,107,107,.08)' : 'transparent'};white-space:nowrap">
      <input type="checkbox" ${_mjFreeMode ? 'checked' : ''}
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

    ${_renderFragmentBag(c)}

    <div style="margin-top:1rem;font-size:.78rem;font-weight:700;letter-spacing:.06em;
      text-transform:uppercase;color:var(--text-dim);margin-bottom:.5rem">
      Inventaire améliorable
    </div>
    ${_renderUpgradeableItemsList(c)}
  `);
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
          Sac de fragments
        </span>
        <span style="font-size:.7rem;color:var(--text-dim)">${totalCount} fragment${totalCount > 1 ? 's' : ''}</span>
      </div>
      ${sections || `<div class="art-frag-empty">Aucun fragment — détruis un équipement avec un trait pour en obtenir un.</div>`}
    </div>`;
}

// ── Liste des items améliorables ────────────────────────────────────
function _renderUpgradeableItemsList(c) {
  if (!c) return `<div class="art-empty">Sélectionne un personnage.</div>`;
  const inv = Array.isArray(c.inventaire) ? c.inventaire : [];

  // Filtrer les items qui ont une catégorie de fragment (= éligibles)
  const eligible = inv
    .map((it, idx) => ({ it, idx, cat: getItemFragmentCategory(it) }))
    .filter(({ cat }) => cat !== null);

  if (!eligible.length) {
    return `<div class="art-empty">Aucun équipement améliorable dans l'inventaire.</div>`;
  }

  return `<div class="art-item-list">
    ${eligible.map(({ it, idx, cat }) => _renderUpgradeableItemRow(it, idx, cat)).join('')}
  </div>`;
}

function _renderUpgradeableItemRow(item, invIndex, category) {
  const cat = FRAGMENT_CAT_BY_ID[category];
  const baseTraits  = _getBaseTraits(item);
  const addedTraits = _getAddedTraits(item);
  const slotCount   = getItemTraitsSlotCount(item);
  const totalTraits = baseTraits.length + addedTraits.length;

  // Synthèse des stats d'amélioration en cours
  const upBonusEntries = ITEM_STAT_META
    .map(meta => [meta.short, getItemUpgradeStatBonus(item, meta.full)])
    .filter(([, v]) => v > 0);
  const upBonusText = upBonusEntries.length
    ? upBonusEntries.map(([s, v]) => `<span class="art-up-chip">+${v} ${s}</span>`).join('')
    : '';

  const traitChips = baseTraits.map(t =>
    `<span class="art-trait-chip">${_esc(t)}</span>`
  ).concat(addedTraits.map(t =>
    `<span class="art-trait-chip art-trait-chip--added" title="Trait ajouté par amélioration">${_esc(t)} ★</span>`
  )).join('');

  const slotsBadge = `<span class="art-slot-count">${totalTraits}/${slotCount} slot${slotCount > 1 ? 's' : ''}</span>`;

  return `
    <div class="art-item-row">
      <div class="art-item-hd">
        <span class="art-item-cat" title="${_esc(cat?.label || '')}">${cat?.icon || '📦'}</span>
        <span class="art-item-name">${_esc(item.nom || 'Sans nom')}</span>
        ${slotsBadge}
      </div>
      <div class="art-item-meta">
        ${traitChips || '<span class="art-no-traits">Aucun trait</span>'}
        ${upBonusText ? `<span class="art-up-bonus-wrap">${upBonusText}</span>` : ''}
      </div>
      <div class="art-item-actions">
        <button class="btn btn-outline btn-sm" data-action="_artisanOpenTraitsActions" data-i="${invIndex}">🔖 Traits</button>
        <button class="btn btn-outline btn-sm" data-action="_artisanOpenStatsActions" data-i="${invIndex}">📈 Stats</button>
        ${Array.isArray(item?.upgrades?.history) && item.upgrades.history.length
          ? `<button class="btn btn-outline btn-sm" data-action="_artisanOpenHistory" data-i="${invIndex}" title="Historique des améliorations">📜 ${item.upgrades.history.length}</button>`
          : ''}
      </div>
    </div>`;
}

// ── Toggle MJ gratuit (admins seulement) ────────────────────────────
function _artisanToggleMjFree(on) {
  if (!STATE.isAdmin) { _mjFreeMode = false; return; }
  _mjFreeMode = !!on;
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
  if (_mjFreeMode || amount <= 0) return;
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
    cost: _mjFreeMode ? 0 : (parseInt(entry.cost) || 0),
    mjOverride: !!_mjFreeMode,
  });
  item.upgrades = { ...up, history };
}

// Persiste le perso (inventaire + traitFragments + compte + equipement + statsBonus)
// puis re-render la modale principale.
async function _persistChar(c) {
  try {
    c.equipement = _rebuildAllEquipment(c);
    c.statsBonus = computeEquipStatsBonus(c.equipement);
    await updateInCol('characters', c.id, {
      inventaire:     c.inventaire     || [],
      traitFragments: c.traitFragments || {},
      compte:         c.compte         || { recettes: [], depenses: [] },
      equipement:     c.equipement,
      statsBonus:     c.statsBonus,
    });
    closeModalDirect();
    _renderArtisanModal();
  } catch (e) {
    notifySaveError(e);
  }
}

// ══════════════════════════════════════════════
// ACTIONS — TRAITS
// Sous-modale ouverte depuis le bouton "🔖 Traits" sur un item de la liste.
// ══════════════════════════════════════════════

function _artisanOpenTraitsActions(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat        = getItemFragmentCategory(item);
  const catMeta    = FRAGMENT_CAT_BY_ID[cat];
  const baseTraits = _getBaseTraits(item);
  const addedTraits= _getAddedTraits(item);
  const allTraits  = [..._getTraits(item)];
  const slotCount  = getItemTraitsSlotCount(item);
  const totalUsed  = allTraits.length;
  const slotsLibres= Math.max(0, slotCount - totalUsed);

  const s         = getUpgradeSettings();
  const fragments = c.traitFragments?.[cat] || {};
  const fragNames = Object.entries(fragments).filter(([, n]) => (parseInt(n) || 0) > 0).map(([name, n]) => ({ name, n }));

  const or = Math.floor(calcOr(c));

  // ── Section "Détruire" ──
  const destroyExtractInfo = s.trait.extractAllTraits
    ? `→ tous les traits récupérés (${allTraits.length})`
    : (allTraits.length > 1 ? '→ choisir le trait à extraire' : '→ trait extrait');

  const destroyBtn = allTraits.length === 0
    ? `<button class="btn btn-outline btn-sm" disabled style="opacity:.5;cursor:not-allowed">Aucun trait à extraire</button>`
    : `<button class="btn btn-danger btn-sm" data-action="_artisanDestroyStart" data-i="${invIndex}">
         🗑️ Détruire — ${s.trait.deconstructCost} PO
       </button>`;

  // ── Section "Ajouter" ──
  let addSection;
  if (slotsLibres <= 0) {
    addSection = `<div class="art-muted">Aucun slot libre (${totalUsed}/${slotCount}).</div>`;
  } else if (!fragNames.length) {
    addSection = `<div class="art-muted">Aucun fragment compatible dans le sac (${catMeta?.label || cat}).</div>`;
  } else {
    addSection = `
      <div style="display:flex;flex-direction:column;gap:.35rem">
        ${fragNames.map(f => `
          <div class="art-frag-row">
            <span class="art-trait-chip">${_esc(f.name)}</span>
            <span class="art-frag-row-n">×${f.n}</span>
            <button class="btn btn-gold btn-sm" style="margin-left:auto"
              data-action="_artisanAddTrait" data-i="${invIndex}" data-frag="${_esc(f.name)}">
              + Poser — ${s.trait.addTraitFromFragment} PO
            </button>
          </div>
        `).join('')}
      </div>`;
  }

  // ── Section "Écraser" ──
  let overwriteSection;
  if (!allTraits.length) {
    overwriteSection = `<div class="art-muted">Aucun trait à écraser.</div>`;
  } else if (!fragNames.length) {
    overwriteSection = `<div class="art-muted">Aucun fragment compatible dans le sac (${catMeta?.label || cat}).</div>`;
  } else {
    overwriteSection = `
      <div style="display:flex;flex-direction:column;gap:.35rem">
        <div class="art-muted" style="font-size:.72rem">Choisis le trait à écraser :</div>
        ${allTraits.map((t, i) => {
          const isAdded = i >= baseTraits.length;
          return `<div class="art-frag-row">
            <span class="art-trait-chip${isAdded ? ' art-trait-chip--added' : ''}">${_esc(t)}${isAdded ? ' ★' : ''}</span>
            <button class="btn btn-outline btn-sm" style="margin-left:auto"
              data-action="_artisanOverwriteStart" data-i="${invIndex}" data-trait="${_esc(t)}">
              Écraser…
            </button>
          </div>`;
        }).join('')}
      </div>`;
  }

  pushModal(`🔖 Traits — ${item.nom || ''}`, `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;font-size:.78rem;color:var(--text-dim)">
      <span>${catMeta?.icon || ''} ${catMeta?.label || cat} · ${totalUsed}/${slotCount} slot${slotCount > 1 ? 's' : ''}</span>
      <span style="color:var(--gold);font-weight:700">💰 ${or} PO</span>
    </div>

    <div class="art-section">
      <div class="art-section-hd">🗑️ Détruire pour fragment</div>
      <div class="art-section-bd">
        <div class="art-muted" style="font-size:.72rem;margin-bottom:.35rem">
          L'objet est supprimé de l'inventaire. ${destroyExtractInfo}.
        </div>
        ${destroyBtn}
      </div>
    </div>

    <div class="art-section">
      <div class="art-section-hd">＋ Ajouter un trait</div>
      <div class="art-section-bd">${addSection}</div>
    </div>

    <div class="art-section">
      <div class="art-section-hd">↻ Écraser un trait existant</div>
      <div class="art-section-bd">
        <div class="art-muted" style="font-size:.72rem;margin-bottom:.35rem">
          Coût : ${s.trait.overwriteTrait} PO + 1 fragment. L'ancien trait est <strong>perdu</strong>.
        </div>
        ${overwriteSection}
      </div>
    </div>

    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">← Retour</button>
    </div>
  `);
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

  if (s.trait.extractAllTraits || allTraits.length === 1) {
    // Pas de choix
    return _artisanDoDestroy(invIndex, allTraits);
  }

  // Choix du trait à extraire
  pushModal(`Choisir le trait à extraire`, `
    <div class="art-muted" style="font-size:.78rem;margin-bottom:.5rem">
      Quel trait veux-tu récupérer en fragment ? Les autres seront perdus.
    </div>
    <div style="display:flex;flex-direction:column;gap:.35rem">
      ${allTraits.map(t => `
        <button class="btn btn-outline btn-sm" style="text-align:left"
          data-action="_artisanDestroyConfirm" data-i="${invIndex}" data-trait="${_esc(t)}">
          <span class="art-trait-chip">${_esc(t)}</span>
        </button>
      `).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">Annuler</button>
    </div>
  `);
};

function _artisanDestroyConfirm(invIndex, traitName) {
  closeModalDirect(); // ferme la sous-modale de choix
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

  const traitList = traitsToExtract.map(t => `« ${t} »`).join(', ');
  const confirmMsg = `Détruire « ${item.nom} » et récupérer ${traitsToExtract.length} fragment${traitsToExtract.length > 1 ? 's' : ''} (${traitList}) ?`;
  if (!await confirmModal(confirmMsg, { title: 'Confirmation', danger: true })) return;

  // 1) Supprimer l'item de l'inventaire
  const inv = [...(c.inventaire || [])];
  inv.splice(invIndex, 1);
  c.inventaire = inv;

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

  pushModal(`Écraser « ${oldTraitName} »`, `
    <div class="art-muted" style="font-size:.78rem;margin-bottom:.5rem">
      Choisis le fragment à poser à la place. <strong>${_esc(oldTraitName)}</strong> sera <strong>perdu</strong>.<br>
      Coût : ${s.trait.overwriteTrait} PO + 1 fragment.
    </div>
    <div style="display:flex;flex-direction:column;gap:.35rem">
      ${fragNames.map(f => `
        <div class="art-frag-row">
          <span class="art-trait-chip">${_esc(f.name)}</span>
          <span class="art-frag-row-n">×${f.n}</span>
          <button class="btn btn-gold btn-sm" style="margin-left:auto"
            data-action="_artisanOverwriteConfirm" data-i="${invIndex}" data-old="${_esc(oldTraitName)}" data-frag="${_esc(f.name)}">
            Confirmer
          </button>
        </div>
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

  closeModalDirect(); // ferme la sous-modale de choix de fragment

  if (!await confirmModal(
    `Écraser « ${oldTraitName} » par « ${newFragmentName} » ?\nL'ancien trait sera perdu.`,
    { title: 'Confirmation', danger: true })) return;

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
  _activeArtisanCharId = id;
  _renderArtisanModal();
};

function _artisanOpenStatsActions(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  if (cat === 'Anneau')   return _openRingStatsModal(invIndex);
  if (cat === 'Amulette') return _openAmuletStatsModal(invIndex);
  if (cat === 'arme')     return _openWeaponStatsModal(invIndex);

  showNotif(`Cet item ne supporte pas l'amélioration de stats.`, 'info');
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
function _openRingStatsModal(invIndex) {
  const c = _getActiveArtisanChar();
  const item = c.inventaire[invIndex];
  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;

  const primary = _detectPrimaryStat(item);
  if (!primary) {
    pushModal(`💍 Anneau — ${item.nom || ''}`, `
      <div class="art-muted" style="text-align:center;padding:1rem">
        Cet anneau n'a pas de stat de base — l'amélioration de stat n'est pas possible.
        <br>Tu peux quand même améliorer l'<strong>effet</strong> ci-dessous.
      </div>
      ${_renderRingEffectSection(item, invIndex, s, cap)}
      <div style="display:flex;gap:.4rem;margin-top:.7rem">
        <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">← Retour</button>
      </div>`);
    return;
  }

  const statLevel   = parseInt(item.upgrades?.statBonus?.[primary.store]) || 0;
  const effectLevel = parseInt(item.upgrades?.effectBonus) || 0;
  const baseStatVal = getItemBaseStatBonus(item, primary.full);
  const totalStat   = baseStatVal + statLevel;
  const or = Math.floor(calcOr(c));

  const nextStatLvl   = statLevel + 1;
  const canUpStat     = nextStatLvl <= cap;
  const statCost      = canUpStat ? (s.ring?.[nextStatLvl] || 0) : 0;

  pushModal(`💍 Anneau — ${item.nom || ''}`, `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;font-size:.78rem;color:var(--text-dim)">
      <span>Stat de base : <strong style="color:var(--text)">${primary.label}</strong></span>
      <span style="color:var(--gold);font-weight:700">💰 ${or} PO</span>
    </div>

    <div class="art-section">
      <div class="art-section-hd">⭐ État actuel</div>
      <div class="art-section-bd" style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
        <span class="art-up-chip">+${totalStat} ${primary.short}${statLevel > 0 ? ` (base +${baseStatVal} · upg +${statLevel})` : ''}</span>
        <span class="art-up-chip">Effet renforcé +${effectLevel}</span>
        <span class="art-slot-count" style="margin-left:auto">Stat ${statLevel}/${cap} · Effet ${effectLevel}/${cap}</span>
      </div>
    </div>

    <div class="art-section">
      <div class="art-section-hd">📈 Améliorer la stat (${primary.label})</div>
      <div class="art-section-bd">
        ${canUpStat ? `
          <div class="art-muted" style="font-size:.78rem;margin-bottom:.5rem">
            Palier suivant : <strong>+${nextStatLvl} ${primary.short}</strong> (cumulé sur la stat de base).
          </div>
          <button class="btn btn-gold btn-sm" style="width:100%"
            data-action="_artisanRingUpgradeStat" data-i="${invIndex}">
            Améliorer la stat — ${statCost} PO
          </button>
        ` : `<div class="art-muted">Stat au palier maximum (${cap}/${cap}).</div>`}
      </div>
    </div>

    ${_renderRingEffectSection(item, invIndex, s, cap)}

    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">← Retour</button>
    </div>
  `);
}

// Section "Améliorer l'effet" — réutilisable (avec ou sans stat de base)
function _renderRingEffectSection(item, invIndex, s, cap) {
  const effectLevel  = parseInt(item.upgrades?.effectBonus) || 0;
  const nextEffectLvl = effectLevel + 1;
  const canUpEff     = nextEffectLvl <= cap;
  const effCost      = canUpEff ? (s.ring?.[nextEffectLvl] || 0) : 0;
  const baseEffect   = item.effet || '';

  return `
    <div class="art-section">
      <div class="art-section-hd">✨ Améliorer l'effet</div>
      <div class="art-section-bd">
        ${baseEffect
          ? `<div class="art-muted" style="font-size:.74rem;margin-bottom:.4rem">
               Effet de base : <em>${_esc(baseEffect)}</em>
             </div>`
          : ''}
        ${canUpEff ? `
          <div class="art-muted" style="font-size:.78rem;margin-bottom:.5rem">
            Palier suivant : <strong>+${nextEffectLvl} à l'effet</strong> (renforce le bonus flat de l'anneau).
          </div>
          <button class="btn btn-gold btn-sm" style="width:100%"
            data-action="_artisanRingUpgradeEffect" data-i="${invIndex}">
            Améliorer l'effet — ${effCost} PO
          </button>
        ` : `<div class="art-muted">Effet au palier maximum (${cap}/${cap}).</div>`}
      </div>
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
function _openAmuletStatsModal(invIndex) {
  const c = _getActiveArtisanChar();
  const item = c.inventaire[invIndex];
  const s = getUpgradeSettings();
  const cap = s.caps?.amulet ?? 3;

  const used = _getUpgradedStatEntries(item);
  const usedSet = new Set(used.map(e => e.meta.full));
  const usedCount = used.length;
  const slotN = usedCount + 1;
  const cost = slotN <= cap ? (s.amulet?.[slotN] || 0) : 0;
  const or = Math.floor(calcOr(c));

  const remainingStats = ITEM_STAT_META.filter(m => !usedSet.has(m.full));
  const canAdd = usedCount < cap && remainingStats.length > 0;

  const usedHtml = used.length
    ? used.map(e => `<span class="art-up-chip">+${e.val} ${e.meta.short}</span>`).join('')
    : `<span class="art-muted" style="font-size:.74rem">Aucune amélioration.</span>`;

  let addHtml;
  if (!canAdd) {
    addHtml = usedCount >= cap
      ? `<div class="art-muted">Plafond atteint (${cap}/${cap}).</div>`
      : `<div class="art-muted">Toutes les stats sont déjà améliorées.</div>`;
  } else {
    addHtml = `
      <div class="art-muted" style="font-size:.78rem;margin-bottom:.5rem">
        ${usedCount}/${cap} stat(s) déjà ajoutée(s). Coût de la suivante : <strong>${cost} PO</strong>.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem">
        ${remainingStats.map(m => `
          <button class="btn btn-outline btn-sm"
            data-action="_artisanAmuletAddStat" data-i="${invIndex}" data-stat="${_esc(m.full)}">
            +1 ${m.short}
          </button>
        `).join('')}
      </div>`;
  }

  pushModal(`📿 Amulette — ${item.nom || ''}`, `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;font-size:.78rem;color:var(--text-dim)">
      <span>Stats distinctes : ${usedCount}/${cap}</span>
      <span style="color:var(--gold);font-weight:700">💰 ${or} PO</span>
    </div>

    <div class="art-section">
      <div class="art-section-hd">⭐ Améliorations actuelles</div>
      <div class="art-section-bd" style="display:flex;gap:.4rem;flex-wrap:wrap">${usedHtml}</div>
    </div>

    <div class="art-section">
      <div class="art-section-hd">＋ Ajouter une stat</div>
      <div class="art-section-bd">${addHtml}</div>
    </div>

    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">← Retour</button>
    </div>
  `);
}

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
function _openWeaponStatsModal(invIndex) {
  const c = _getActiveArtisanChar();
  const item = c.inventaire[invIndex];
  const s = getUpgradeSettings();

  const fmt = String(item.format || '');
  const is2H = /2M|2m/.test(fmt);
  const cap = is2H ? (s.caps?.weapon2H ?? 4) : (s.caps?.weapon1H ?? 2);
  const tariffTable = is2H ? (s.weapon?.['2H'] || {}) : (s.weapon?.['1H'] || {});
  const handLabel = is2H ? '2M' : '1M';

  const used = _getUpgradedStatEntries(item);
  const total = used.reduce((s2, e) => s2 + e.val, 0);
  const slotN = total + 1;
  const cost = total < cap ? (tariffTable[slotN] || 0) : 0;
  const or = Math.floor(calcOr(c));
  const canAdd = total < cap;

  const usedHtml = used.length
    ? used.map(e => `<span class="art-up-chip">+${e.val} ${e.meta.short}</span>`).join('')
    : `<span class="art-muted" style="font-size:.74rem">Aucune amélioration.</span>`;

  let addHtml;
  if (!canAdd) {
    addHtml = `<div class="art-muted">Plafond atteint (${total}/${cap} points).</div>`;
  } else {
    addHtml = `
      <div class="art-muted" style="font-size:.78rem;margin-bottom:.5rem">
        ${total}/${cap} points utilisés. Coût du ${slotN}ᵉ point : <strong>${cost} PO</strong>.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem">
        ${ITEM_STAT_META.map(m => `
          <button class="btn btn-outline btn-sm"
            data-action="_artisanWeaponAddPoint" data-i="${invIndex}" data-stat="${_esc(m.full)}">
            +1 ${m.short}
          </button>
        `).join('')}
      </div>`;
  }

  pushModal(`⚔️ Arme — ${item.nom || ''}`, `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;font-size:.78rem;color:var(--text-dim)">
      <span>Format ${handLabel} · Points : ${total}/${cap}</span>
      <span style="color:var(--gold);font-weight:700">💰 ${or} PO</span>
    </div>

    <div class="art-section">
      <div class="art-section-hd">⭐ Améliorations actuelles</div>
      <div class="art-section-bd" style="display:flex;gap:.4rem;flex-wrap:wrap">${usedHtml}</div>
    </div>

    <div class="art-section">
      <div class="art-section-hd">＋ Ajouter un point de stat</div>
      <div class="art-section-bd">${addHtml}</div>
    </div>

    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="_artisanBack">← Retour</button>
    </div>
  `);
}

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
  _artisanToggleMjFree: (el) => _artisanToggleMjFree(el.checked),
  _artisanOpenTraitsActions: (btn) => _artisanOpenTraitsActions(Number(btn.dataset.i)),
  _artisanOpenStatsActions: (btn) => _artisanOpenStatsActions(Number(btn.dataset.i)),
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
