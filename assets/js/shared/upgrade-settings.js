// ══════════════════════════════════════════════
// CONFIG AMÉLIORATIONS D'ÉQUIPEMENT
// Firestore : world/upgrade_settings
//
// Stocke les tarifs, plafonds et options du système d'amélioration
// gérés depuis la console MJ (boutique → ⚙️ Améliorations).
// ══════════════════════════════════════════════

import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModalDirect, confirmModal } from './modal.js';
import { showNotif } from './notifications.js';
import { _esc } from './html.js';

let _settings = null;

// Valeurs par défaut — utilisées si le doc Firestore n'existe pas
// ou en fallback champ par champ pour les MJ qui ont une config partielle.
export const DEFAULT_UPGRADE_SETTINGS = {
  trait: {
    deconstructCost: 0,        // PO pour détruire un item et récupérer son trait
    addTraitFromFragment: 100, // PO pour poser un fragment sur slot vide
    overwriteTrait: 200,       // PO pour écraser un trait existant
    extractAllTraits: false,   // true = détruire récupère tous les traits, false = seulement le 1er
  },
  weapon: {
    '1H': { 1: 150, 2: 300 },                    // 1ᵉʳ, 2ᵉ point de stat
    '2H': { 1: 250, 2: 500, 3: 800, 4: 1200 },   // 1ᵉʳ, 2ᵉ, 3ᵉ, 4ᵉ point
  },
  amulet: { 1: 200, 2: 400, 3: 800 },            // 1ʳᵉ, 2ᵉ, 3ᵉ stat distincte
  ring:   { 1: 250 },                            // 1 palier max — stat et effet améliorables séparément (chacun +1 max)
  caps: {
    weapon1H: 2,
    weapon2H: 4,
    amulet:   3,
    ring:     1,
    // Slots de traits par catégorie d'item — clés alignées sur FRAGMENT_CATEGORIES (artisan.js)
    traitsPerItem: {
      arme:            2,
      'Tête':          1,
      'Torse':         1,
      'Pieds':         1,
      'Amulette':      1,
      'Anneau':        1,
      'Objet magique': 1,
    },
  },
  // Drapeau optionnel : rembourser X% du coût total des upgrades à la revente
  // ex : 0.2 = 20% remboursés. 0 = perte totale.
  refundUpgradeRatio: 0,
};

// ── Fusion défensive : préserve les défauts pour tout champ manquant ─────
function _mergeDefaults(stored = {}) {
  const d = DEFAULT_UPGRADE_SETTINGS;
  return {
    trait: { ...d.trait, ...(stored.trait || {}) },
    weapon: {
      '1H': { ...d.weapon['1H'], ...(stored.weapon?.['1H'] || {}) },
      '2H': { ...d.weapon['2H'], ...(stored.weapon?.['2H'] || {}) },
    },
    amulet: { ...d.amulet, ...(stored.amulet || {}) },
    ring:   { ...d.ring,   ...(stored.ring   || {}) },
    caps: {
      ...d.caps,
      ...(stored.caps || {}),
      // ring ne peut jamais dépasser 1 (1 upgrade stat + 1 upgrade effet, chacun indépendant)
      ring: Math.min(stored.caps?.ring ?? d.caps.ring, 1),
      traitsPerItem: { ...d.caps.traitsPerItem, ...(stored.caps?.traitsPerItem || {}) },
    },
    refundUpgradeRatio: stored.refundUpgradeRatio ?? d.refundUpgradeRatio,
  };
}

export async function loadUpgradeSettings() {
  if (_settings) return _settings;
  try {
    const doc = await getDocData('world', 'upgrade_settings');
    _settings = _mergeDefaults(doc || {});
  } catch {
    _settings = _mergeDefaults({});
  }
  return _settings;
}

export async function saveUpgradeSettings(settings) {
  await saveDoc('world', 'upgrade_settings', settings);
  _settings = _mergeDefaults(settings);
}

export function invalidateUpgradeSettingsCache() {
  _settings = null;
}

// Helper synchrone — renvoie le cache actuel ou les défauts si pas chargé
export function getUpgradeSettings() {
  return _settings || DEFAULT_UPGRADE_SETTINGS;
}

// ── Revente : helpers d'audit du coût investi en améliorations ───────────
/**
 * Somme des coûts (PO) loggés dans `item.upgrades.history`.
 * Sert de base au remboursement à la revente.
 */
export function getUpgradeTotalCost(item = {}) {
  const hist = item?.upgrades?.history;
  if (!Array.isArray(hist) || !hist.length) return 0;
  return hist.reduce((s, h) => s + (parseInt(h?.cost) || 0), 0);
}

/**
 * Montant remboursé à la revente d'un item amélioré
 * en fonction du `refundUpgradeRatio` (0 par défaut → aucune reprise).
 */
export function calcUpgradeRefund(item = {}, settings = null) {
  const s = settings || getUpgradeSettings();
  const ratio = parseFloat(s?.refundUpgradeRatio) || 0;
  if (ratio <= 0) return 0;
  return Math.round(getUpgradeTotalCost(item) * ratio);
}

/**
 * Indique si l'item porte au moins une amélioration (stat, effet ou trait).
 */
export function hasUpgrades(item = {}) {
  const up = item?.upgrades;
  if (!up) return false;
  if (up.statBonus && Object.values(up.statBonus).some(v => parseInt(v) > 0)) return true;
  if (parseInt(up.effectBonus) > 0) return true;
  if (Array.isArray(up.addedTraits) && up.addedTraits.length) return true;
  if (Array.isArray(up.removedBaseTraits) && up.removedBaseTraits.length) return true;
  return false;
}

// ══════════════════════════════════════════════
// ADMIN — modale d'édition
// ══════════════════════════════════════════════

export async function openUpgradeSettingsAdmin() {
  await loadUpgradeSettings();
  _renderUpgradeSettingsModal();
}

function _renderUpgradeSettingsModal() {
  const s = getUpgradeSettings();

  const tierRow = (label, value, onchange) => `
    <label style="display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--text-muted)">
      <span style="flex:1">${label}</span>
      <input type="number" class="input-field" value="${value}" min="0" step="10"
        style="width:90px;text-align:right;padding:.3rem .5rem;font-size:.8rem"
        oninput="${onchange}">
      <span style="font-size:.7rem;color:var(--text-dim)">PO</span>
    </label>`;

  const capRow = (label, value, onchange) => `
    <label style="display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--text-muted)">
      <span style="flex:1">${label}</span>
      <input type="number" class="input-field" value="${value}" min="0" step="1"
        style="width:60px;text-align:right;padding:.3rem .5rem;font-size:.8rem"
        oninput="${onchange}">
    </label>`;

  openModal('⚙️ Améliorations — Tarifs et plafonds', `
    <div style="font-size:.76rem;color:var(--text-dim);margin-bottom:.85rem;line-height:1.5">
      Configuration globale des améliorations d'équipement (boutique → 🔨 Artisan).<br>
      Les modifications s'appliquent immédiatement à toutes les améliorations futures.
    </div>

    <div style="display:flex;flex-direction:column;gap:1rem;max-height:60vh;overflow-y:auto;padding-right:.4rem">

      <!-- ── Traits ──────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">🔖 Traits</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${tierRow('Détruire un objet pour récupérer son trait',
            s.trait.deconstructCost,
            "window._upgSetField('trait.deconstructCost',+this.value)")}
          ${tierRow('Ajouter un trait (slot libre, fragment requis)',
            s.trait.addTraitFromFragment,
            "window._upgSetField('trait.addTraitFromFragment',+this.value)")}
          ${tierRow('Écraser un trait existant',
            s.trait.overwriteTrait,
            "window._upgSetField('trait.overwriteTrait',+this.value)")}
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--text-muted);margin-top:.2rem">
            <input type="checkbox" ${s.trait.extractAllTraits ? 'checked' : ''}
              onchange="window._upgSetField('trait.extractAllTraits',this.checked)">
            Récupérer <strong>tous</strong> les traits à la destruction (sinon seul le 1ᵉʳ)
          </label>
        </div>
      </div>

      <!-- ── Armes 1M ────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">⚔️ Armes 1M (1m CaC, bouclier, baguette, main libre)</div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-bottom:.4rem">Plafond de stats distribuables : ${s.caps.weapon1H} points</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${tierRow('1ᵉʳ point de stat',  s.weapon['1H'][1], "window._upgSetField('weapon.1H.1',+this.value)")}
          ${tierRow('2ᵉ point de stat',   s.weapon['1H'][2], "window._upgSetField('weapon.1H.2',+this.value)")}
        </div>
      </div>

      <!-- ── Armes 2M ────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">⚔️ Armes 2M</div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-bottom:.4rem">Plafond de stats distribuables : ${s.caps.weapon2H} points</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${tierRow('1ᵉʳ point de stat',  s.weapon['2H'][1], "window._upgSetField('weapon.2H.1',+this.value)")}
          ${tierRow('2ᵉ point de stat',   s.weapon['2H'][2], "window._upgSetField('weapon.2H.2',+this.value)")}
          ${tierRow('3ᵉ point de stat',   s.weapon['2H'][3], "window._upgSetField('weapon.2H.3',+this.value)")}
          ${tierRow('4ᵉ point de stat',   s.weapon['2H'][4], "window._upgSetField('weapon.2H.4',+this.value)")}
        </div>
      </div>

      <!-- ── Amulettes ───────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">📿 Amulettes</div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-bottom:.4rem">3 stats distinctes max, +1 chacune</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${tierRow('1ʳᵉ stat',  s.amulet[1], "window._upgSetField('amulet.1',+this.value)")}
          ${tierRow('2ᵉ stat',   s.amulet[2], "window._upgSetField('amulet.2',+this.value)")}
          ${tierRow('3ᵉ stat',   s.amulet[3], "window._upgSetField('amulet.3',+this.value)")}
        </div>
      </div>

      <!-- ── Anneaux ─────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">💍 Anneaux</div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-bottom:.4rem">Stat et effet améliorables séparément, +1 max chacun (1 amélioration par track)</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${tierRow('Coût d\'amélioration (+1)',  s.ring[1], "window._upgSetField('ring.1',+this.value)")}
        </div>
      </div>

      <!-- ── Plafonds ────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">📏 Plafonds</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${capRow('Points stats max — Arme 1M',     s.caps.weapon1H, "window._upgSetField('caps.weapon1H',+this.value)")}
          ${capRow('Points stats max — Arme 2M',     s.caps.weapon2H, "window._upgSetField('caps.weapon2H',+this.value)")}
          ${capRow('Stats max — Amulette',           s.caps.amulet,   "window._upgSetField('caps.amulet',+this.value)")}
          ${capRow('Paliers max — Anneau',           s.caps.ring,     "window._upgSetField('caps.ring',+this.value)")}
          <div style="border-top:1px solid var(--border);margin-top:.4rem;padding-top:.4rem"></div>
          <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:.2rem">Slots de traits par catégorie d'item :</div>
          ${capRow('⚔️ Arme (toutes confondues)', s.caps.traitsPerItem.arme,            "window._upgSetField('caps.traitsPerItem.arme',+this.value)")}
          ${capRow('🪖 Tête',                     s.caps.traitsPerItem['Tête'],          "window._upgSetField('caps.traitsPerItem.Tête',+this.value)")}
          ${capRow('🛡️ Torse',                    s.caps.traitsPerItem['Torse'],         "window._upgSetField('caps.traitsPerItem.Torse',+this.value)")}
          ${capRow('🥾 Pieds',                    s.caps.traitsPerItem['Pieds'],         "window._upgSetField('caps.traitsPerItem.Pieds',+this.value)")}
          ${capRow('📿 Amulette',                 s.caps.traitsPerItem['Amulette'],      "window._upgSetField('caps.traitsPerItem.Amulette',+this.value)")}
          ${capRow('💍 Anneau',                   s.caps.traitsPerItem['Anneau'],        "window._upgSetField('caps.traitsPerItem.Anneau',+this.value)")}
          ${capRow('🔮 Objet magique',            s.caps.traitsPerItem['Objet magique'], "window._upgSetField('caps.traitsPerItem.Objet magique',+this.value)")}
        </div>
      </div>

      <!-- ── Revente ─────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem .9rem">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">💰 Revente</div>
        <label style="display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--text-muted)">
          <span style="flex:1">Remboursement à la revente d'un objet amélioré</span>
          <input type="number" class="input-field" value="${Math.round(s.refundUpgradeRatio * 100)}" min="0" max="100" step="5"
            style="width:70px;text-align:right;padding:.3rem .5rem;font-size:.8rem"
            oninput="window._upgSetField('refundUpgradeRatio',(+this.value)/100)">
          <span style="font-size:.7rem;color:var(--text-dim)">% du coût</span>
        </label>
        <div style="font-size:.7rem;color:var(--text-dim);margin-top:.3rem">
          0% = perte totale des améliorations à la revente. L'objet de base est restitué en stock.
        </div>
      </div>

    </div>

    <div style="display:flex;gap:.4rem;margin-top:1rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="window._upgResetDefaults()">↻ Restaurer défauts</button>
      <button class="btn btn-gold btn-sm"    style="flex:2" onclick="window._upgSaveAndClose()">💾 Enregistrer</button>
    </div>
  `);
}

// ── Modifications en mémoire (sauvegarde déclenchée à la fermeture) ──
window._upgSetField = (path, value) => {
  const parts = path.split('.');
  const s = getUpgradeSettings();
  let cur = s;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  _settings = s;
};

window._upgSaveAndClose = async () => {
  try {
    await saveUpgradeSettings(getUpgradeSettings());
    showNotif('Paramètres enregistrés.', 'success');
    closeModalDirect();
  } catch (e) {
    console.error(e);
    showNotif('Erreur lors de l\'enregistrement.', 'error');
  }
};

window._upgResetDefaults = async () => {
  if (!await confirmModal('Restaurer les valeurs par défaut ? Vos tarifs actuels seront écrasés.', {
    title: 'Confirmation',
  })) return;
  _settings = JSON.parse(JSON.stringify(DEFAULT_UPGRADE_SETTINGS));
  _renderUpgradeSettingsModal();
};

window.openUpgradeSettingsAdmin = openUpgradeSettingsAdmin;
