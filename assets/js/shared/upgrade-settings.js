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

  // Row "tarif" : label flex + input nombre + unité PO
  const tierRow = (label, value, onchange, step = 10) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <input type="number" class="sh-admin-row-input" value="${value}" min="0" step="${step}"
        oninput="${onchange}">
      <span class="sh-admin-row-unit">PO</span>
    </div>`;

  // Row "plafond" : label + input nombre + (pas d'unité ou unité custom)
  const capRow = (label, value, onchange, unit = '') => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <input type="number" class="sh-admin-row-input small" value="${value}" min="0" step="1"
        oninput="${onchange}">
      ${unit ? `<span class="sh-admin-row-unit">${unit}</span>` : '<span class="sh-admin-row-unit"></span>'}
    </div>`;

  openModal('', `
  <div class="sh-admin-modal is-upgrades">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">⚙️</div>
      <div class="sh-admin-head-title">
        <h2>Tarifs et plafonds des améliorations</h2>
        <small>Configuration globale de l'<em>Artisan</em> · s'applique immédiatement</small>
      </div>
      <button class="sh-admin-close" onclick="closeModal()" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">

      <!-- ── Traits ────────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🔖 Traits</div>
        ${tierRow('Détruire un objet pour récupérer son trait',
          s.trait.deconstructCost,
          "window._upgSetField('trait.deconstructCost',+this.value)")}
        ${tierRow('Ajouter un trait (slot libre, fragment requis)',
          s.trait.addTraitFromFragment,
          "window._upgSetField('trait.addTraitFromFragment',+this.value)")}
        ${tierRow('Écraser un trait existant',
          s.trait.overwriteTrait,
          "window._upgSetField('trait.overwriteTrait',+this.value)")}
        <label class="sh-admin-row-checkbox" style="margin-top:8px;padding:6px 0">
          <input type="checkbox" ${s.trait.extractAllTraits ? 'checked' : ''}
            onchange="window._upgSetField('trait.extractAllTraits',this.checked)">
          <span>Récupérer <b>tous</b> les traits à la destruction <small style="color:var(--text-dim)">(sinon seul le 1ᵉʳ)</small></span>
        </label>
      </div>

      <!-- ── Armes 1M ──────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">⚔️ Armes 1M <small style="font-weight:400;color:var(--text-dim);font-family:inherit">— bouclier, baguette, main libre</small></div>
        <p class="sh-admin-section-hint">Plafond : <b style="color:var(--text)">${s.caps.weapon1H}</b> points de stats distribuables.</p>
        ${tierRow('1ᵉʳ point de stat', s.weapon['1H'][1], "window._upgSetField('weapon.1H.1',+this.value)")}
        ${tierRow('2ᵉ point de stat',  s.weapon['1H'][2], "window._upgSetField('weapon.1H.2',+this.value)")}
      </div>

      <!-- ── Armes 2M ──────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">⚔️ Armes 2M</div>
        <p class="sh-admin-section-hint">Plafond : <b style="color:var(--text)">${s.caps.weapon2H}</b> points de stats distribuables.</p>
        ${tierRow('1ᵉʳ point de stat', s.weapon['2H'][1], "window._upgSetField('weapon.2H.1',+this.value)")}
        ${tierRow('2ᵉ point de stat',  s.weapon['2H'][2], "window._upgSetField('weapon.2H.2',+this.value)")}
        ${tierRow('3ᵉ point de stat',  s.weapon['2H'][3], "window._upgSetField('weapon.2H.3',+this.value)")}
        ${tierRow('4ᵉ point de stat',  s.weapon['2H'][4], "window._upgSetField('weapon.2H.4',+this.value)")}
      </div>

      <!-- ── Amulettes ─────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📿 Amulettes</div>
        <p class="sh-admin-section-hint">3 stats distinctes max, +1 chacune.</p>
        ${tierRow('1ʳᵉ stat', s.amulet[1], "window._upgSetField('amulet.1',+this.value)")}
        ${tierRow('2ᵉ stat',  s.amulet[2], "window._upgSetField('amulet.2',+this.value)")}
        ${tierRow('3ᵉ stat',  s.amulet[3], "window._upgSetField('amulet.3',+this.value)")}
      </div>

      <!-- ── Anneaux ───────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">💍 Anneaux</div>
        <p class="sh-admin-section-hint">Stat et effet améliorables séparément, +1 max chacun.</p>
        ${tierRow("Coût d'amélioration (+1)", s.ring[1], "window._upgSetField('ring.1',+this.value)")}
      </div>

      <!-- ── Plafonds ──────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📏 Plafonds</div>
        ${capRow('Points stats max — Arme 1M', s.caps.weapon1H, "window._upgSetField('caps.weapon1H',+this.value)")}
        ${capRow('Points stats max — Arme 2M', s.caps.weapon2H, "window._upgSetField('caps.weapon2H',+this.value)")}
        ${capRow('Stats max — Amulette',       s.caps.amulet,   "window._upgSetField('caps.amulet',+this.value)")}
        ${capRow('Paliers max — Anneau',       s.caps.ring,     "window._upgSetField('caps.ring',+this.value)")}

        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border-md)">
          <p class="sh-admin-section-hint" style="margin-bottom:6px">Slots de traits par catégorie d'item :</p>
          ${capRow('⚔️ Arme (toutes confondues)', s.caps.traitsPerItem.arme,            "window._upgSetField('caps.traitsPerItem.arme',+this.value)")}
          ${capRow('🪖 Tête',                     s.caps.traitsPerItem['Tête'],          "window._upgSetField('caps.traitsPerItem.Tête',+this.value)")}
          ${capRow('🛡️ Torse',                    s.caps.traitsPerItem['Torse'],         "window._upgSetField('caps.traitsPerItem.Torse',+this.value)")}
          ${capRow('🥾 Pieds',                    s.caps.traitsPerItem['Pieds'],         "window._upgSetField('caps.traitsPerItem.Pieds',+this.value)")}
          ${capRow('📿 Amulette',                 s.caps.traitsPerItem['Amulette'],      "window._upgSetField('caps.traitsPerItem.Amulette',+this.value)")}
          ${capRow('💍 Anneau',                   s.caps.traitsPerItem['Anneau'],        "window._upgSetField('caps.traitsPerItem.Anneau',+this.value)")}
          ${capRow('🔮 Objet magique',            s.caps.traitsPerItem['Objet magique'], "window._upgSetField('caps.traitsPerItem.Objet magique',+this.value)")}
        </div>
      </div>

      <!-- ── Revente ───────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">💰 Revente</div>
        <div class="sh-admin-row-line">
          <span class="sh-admin-row-lbl">Remboursement à la revente d'un objet amélioré</span>
          <input type="number" class="sh-admin-row-input small" value="${Math.round(s.refundUpgradeRatio * 100)}" min="0" max="100" step="5"
            oninput="window._upgSetField('refundUpgradeRatio',(+this.value)/100)">
          <span class="sh-admin-row-unit">%</span>
        </div>
        <p class="sh-admin-section-hint" style="margin-top:6px">
          0 % = perte totale des améliorations à la revente. L'objet de base est restitué en stock.
        </p>
      </div>

    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" onclick="window._upgResetDefaults()">↻ Restaurer défauts</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
      <button class="btn btn-gold btn-sm" onclick="window._upgSaveAndClose()">💾 Enregistrer</button>
    </div>
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
