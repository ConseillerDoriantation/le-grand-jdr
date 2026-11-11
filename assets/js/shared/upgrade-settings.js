// ══════════════════════════════════════════════
// CONFIG AMÉLIORATIONS D'ÉQUIPEMENT
// Firestore : world/upgrade_settings
//
// Stocke les tarifs, plafonds et options du système d'amélioration
// gérés depuis la console MJ (boutique → Artisanat → Améliorer).
// ══════════════════════════════════════════════

import { getDocData, saveDoc } from '../data/firestore.js';
import { closeModal } from './modal.js';
import { openModal, closeModalDirect, confirmModal } from './modal.js';
import { registerActions } from '../core/actions.js';
import { showNotif } from './notifications.js';
import { _esc } from './html.js';
import { getRarities, loadRarities } from './rarity.js';
import { DEFAULT_RARITY_CAPS, DEFAULT_RING_CAPS, rarityCapFromTable } from './rarity-caps.js';
import { DEFAULT_REFORGE, mergeReforge } from './reforge.js';
import { upgradeResaleBonus } from './upgrade-value.js';

let _settings = null;
let _roomCatalog = [];  // catalogue de salles de l'aventure (pour les sélecteurs reforge)

// Salles par défaut si l'aventure n'a pas (encore) de catalogue chargé.
const _ROOM_FALLBACK = [
  { slug: 'forge',              nom: '🔨 Forge' },
  { slug: 'atelier_confection', nom: '🧵 Atelier de confection' },
  { slug: 'atelier_orfevre',    nom: '💎 Atelier d\'orfèvre' },
];
// <option> des salles disponibles ; garde la valeur courante même si hors catalogue.
function _roomOptions(selected) {
  const list = _roomCatalog.length ? _roomCatalog : _ROOM_FALLBACK;
  const slugs = new Set(list.map(r => r.slug));
  const all = selected && !slugs.has(selected) ? [...list, { slug: selected, nom: selected }] : list;
  return all.map(r => {
    const label = `${r.emoji ? r.emoji + ' ' : ''}${r.nom || r.slug}`;
    return `<option value="${_esc(r.slug)}" ${r.slug === selected ? 'selected' : ''}>${_esc(label)}</option>`;
  }).join('');
}

// Valeurs par défaut — utilisées si le doc Firestore n'existe pas
// ou en fallback champ par champ pour les MJ qui ont une config partielle.
export const DEFAULT_UPGRADE_SETTINGS = {
  trait: {
    deconstructCost: 0,        // PO pour détruire un item et récupérer son trait
    addTraitFromFragment: 100, // PO pour poser un fragment sur slot vide
    overwriteTrait: 200,       // PO pour écraser un trait existant
    extractAllTraits: false,   // true = tous les traits, false = un trait recyclable choisi par le joueur
  },
  weapon: {
    '1H': { 1: 150, 2: 300 },                    // 1ᵉʳ, 2ᵉ point de stat
    '2H': { 1: 250, 2: 500, 3: 800, 4: 1200 },   // 1ᵉʳ, 2ᵉ, 3ᵉ, 4ᵉ point
  },
  amulet: { 1: 200, 2: 400, 3: 800 },            // 1ʳᵉ, 2ᵉ, 3ᵉ stat distincte
  ring:   { 1: 250, 2: 450, 3: 700, 4: 1000, 5: 1400 }, // coût par point de profondeur (sur ses stats natives)
  caps: {
    weapon1H: 2,
    weapon2H: 4,
    amulet:   3,
    // Slots de traits par catégorie d'item — clés alignées sur FRAGMENT_CATEGORIES (artisan.js)
    // (l'anneau utilise rarityCaps.ring, pas traitsPerItem.Anneau)
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
  // Plafonds imposés par la RARETÉ (valeur 1..N, cf. rarity.js). C'est le plafond
  // DUR : le plafond effectif d'un objet = min(plafond catégorie ci-dessus,
  // plafond rareté ici). Une 1★ ne peut donc jamais égaler une 5★ — on ne fait
  // que remplir le budget de sa rareté, défini par le MJ. 0/rareté non définie = commun (1).
  rarityCaps: { ...DEFAULT_RARITY_CAPS, ring: DEFAULT_RING_CAPS }, // tables pures dans rarity-caps.js
  // Reforge (monter la rareté) — gatée Bastion. Logique pure dans reforge.js.
  // Améliorer stats/traits reste libre ; seule la reforge dépend d'une salle.
  reforge: DEFAULT_REFORGE,
  // Revente d'un objet amélioré : + X % du tarif ACTUEL des améliorations qu'il
  // porte (cf. upgrade-value.js). ex : 0.2 = 20 %. 0 = améliorations perdues.
  refundUpgradeRatio: 0,
  // Métadonnées d'interface de la modale Artisanat. Les tarifs calculés restent
  // toujours persistés dans weapon/amulet/ring pour les consommateurs métier.
  pricing: {
    '1H': { mode: 'manuel', base: 150, mult: 2 },
    '2H': { mode: 'manuel', base: 250, mult: 2 },
    amulet: { mode: 'manuel', base: 200, mult: 2 },
    ring: { mode: 'manuel', base: 250, mult: 1 },
  },
}

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
      traitsPerItem: { ...d.caps.traitsPerItem, ...(stored.caps?.traitsPerItem || {}) },
    },
    rarityCaps: {
      traits: { ...d.rarityCaps.traits, ...(stored.rarityCaps?.traits || {}) },
      stats:  { ...d.rarityCaps.stats,  ...(stored.rarityCaps?.stats  || {}) },
      ring: {
        traits: { ...d.rarityCaps.ring.traits, ...(stored.rarityCaps?.ring?.traits || {}) },
        stats:  { ...d.rarityCaps.ring.stats,  ...(stored.rarityCaps?.ring?.stats  || {}) },
      },
    },
    reforge: mergeReforge(stored.reforge),
    refundUpgradeRatio: stored.refundUpgradeRatio ?? d.refundUpgradeRatio,
    pricing: {
      '1H': { ...d.pricing['1H'], ...(stored.pricing?.['1H'] || {}) },
      '2H': { ...d.pricing['2H'], ...(stored.pricing?.['2H'] || {}) },
      amulet: { ...d.pricing.amulet, ...(stored.pricing?.amulet || {}) },
      ring: { ...d.pricing.ring, ...(stored.pricing?.ring || {}) },
    },
  };
}

// ── Plafond imposé par la rareté ─────────────────────────────────────────
// kind: 'traits' (slots) | 'stats' (points). rarete 0/non définie → commun (1).
// Rareté au-delà de la table → on prend la valeur définie la plus proche en dessous.
export function rarityCapFor(kind, rarete, settings = null) {
  const s = settings || getUpgradeSettings();
  const table = s?.rarityCaps?.[kind] || DEFAULT_RARITY_CAPS[kind];
  return rarityCapFromTable(table, rarete);
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
 * Somme des coûts (PO) loggés dans `item.upgrades.history` (audit : PO
 * réellement payées). La revente, elle, part du tarif actuel.
 */
export function getUpgradeTotalCost(item = {}) {
  const hist = item?.upgrades?.history;
  if (!Array.isArray(hist) || !hist.length) return 0;
  return hist.reduce((s, h) => s + (parseInt(h?.cost) || 0), 0);
}

/**
 * Montant repris à la revente d'un item amélioré : `refundUpgradeRatio` × tarif
 * actuel de ses améliorations (0 par défaut → aucune reprise).
 */
export function calcUpgradeRefund(item = {}, settings = null) {
  return upgradeResaleBonus(item, settings || getUpgradeSettings());
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
  // Le chargement du catalogue a migré dans artisan-settings.js :
  // getDocData('bastion', 'main') reste session-live et n'ajoute pas de listener.
  const { openArtisanSettings } = await import('./artisan-settings.js');
  return openArtisanSettings('ameliorer');
}

function _renderUpgradeSettingsModal() {
  const s = getUpgradeSettings();

  // Row "tarif" : label flex + input nombre + unité PO
  const tierRow = (label, value, field, step = 10) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <input type="number" class="sh-admin-row-input" value="${value}" min="0" step="${step}"
        data-input="_upgField" data-field="${field}">
      <span class="sh-admin-row-unit">PO</span>
    </div>`;

  // Row "plafond" : label + input nombre + (pas d'unité ou unité custom)
  const capRow = (label, value, field, unit = '') => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <input type="number" class="sh-admin-row-input small" value="${value}" min="0" step="1"
        data-input="_upgField" data-field="${field}">
      ${unit ? `<span class="sh-admin-row-unit">${unit}</span>` : '<span class="sh-admin-row-unit"></span>'}
    </div>`;

  // Row "plafond par rareté" : label rareté + slots de traits + points de stats.
  const rarities = getRarities();
  const rarityRow = (r) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${'★'.repeat(r.value)} ${_esc(r.name)}</span>
      <input type="number" class="sh-admin-row-input small" value="${s.rarityCaps?.traits?.[r.value] ?? 0}" min="0" step="1"
        data-input="_upgField" data-field="rarityCaps.traits.${r.value}">
      <span class="sh-admin-row-unit">traits</span>
      <input type="number" class="sh-admin-row-input small" value="${s.rarityCaps?.stats?.[r.value] ?? 0}" min="0" step="1"
        data-input="_upgField" data-field="rarityCaps.stats.${r.value}">
      <span class="sh-admin-row-unit">stats</span>
    </div>`;

  // Row "plafond anneau par rareté" : traits + points de profondeur (stats natives).
  const ringRarityRow = (r) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${'★'.repeat(r.value)} ${_esc(r.name)}</span>
      <input type="number" class="sh-admin-row-input small" value="${s.rarityCaps?.ring?.traits?.[r.value] ?? 0}" min="0" step="1"
        data-input="_upgField" data-field="rarityCaps.ring.traits.${r.value}">
      <span class="sh-admin-row-unit">traits</span>
      <input type="number" class="sh-admin-row-input small" value="${s.rarityCaps?.ring?.stats?.[r.value] ?? 0}" min="0" step="1"
        data-input="_upgField" data-field="rarityCaps.ring.stats.${r.value}">
      <span class="sh-admin-row-unit">pts stat</span>
    </div>`;

  // Reforge : discipline → salle du Bastion (sélecteur).
  const discRow = (disc, label) => {
    const sel = s.reforge?.disciplineRoom?.[disc] || '';
    return `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <select class="sh-admin-row-input" data-change="_upgStr" data-field="reforge.disciplineRoom.${disc}">
        <option value="" ${sel ? '' : 'selected'}>— aucune salle —</option>
        ${_roomOptions(sel)}
      </select>
    </div>`;
  };
  // Reforge : par rareté cible → niveau de salle requis + coût en or.
  const reforgeRarityRow = (r) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${'★'.repeat(r.value)} ${_esc(r.name)}</span>
      <input type="number" class="sh-admin-row-input small" value="${s.reforge?.roomLevelForRarity?.[r.value] ?? 1}" min="1" step="1"
        data-input="_upgField" data-field="reforge.roomLevelForRarity.${r.value}">
      <span class="sh-admin-row-unit">niv.</span>
      <input type="number" class="sh-admin-row-input small" value="${s.reforge?.goldForRarity?.[r.value] ?? 0}" min="0" step="10"
        data-input="_upgField" data-field="reforge.goldForRarity.${r.value}">
      <span class="sh-admin-row-unit">PO</span>
    </div>`;

  openModal('', `
  <div class="sh-admin-modal is-upgrades">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">⚙️</div>
      <div class="sh-admin-head-title">
        <h2>Tarifs et plafonds des améliorations</h2>
        <small>Configuration globale de l'<em>Artisan</em> · s'applique immédiatement</small>
      </div>
      <button class="sh-admin-close" data-action="_upgClose" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">

      <!-- ── Traits ────────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🔖 Traits</div>
        ${tierRow('Détruire un objet pour récupérer son trait',
          s.trait.deconstructCost,
          'trait.deconstructCost')}
        ${tierRow('Ajouter un trait (slot libre, fragment requis)',
          s.trait.addTraitFromFragment,
          'trait.addTraitFromFragment')}
        ${tierRow('Écraser un trait existant',
          s.trait.overwriteTrait,
          'trait.overwriteTrait')}
        <label class="sh-admin-row-checkbox" style="margin-top:8px;padding:6px 0">
          <input type="checkbox" ${s.trait.extractAllTraits ? 'checked' : ''}
            data-change="_upgCheck" data-field="trait.extractAllTraits">
          <span>Récupérer <b>tous</b> les traits à la destruction <small style="color:var(--text-dim)">(sinon un trait au choix)</small></span>
        </label>
      </div>

      <!-- ── Armes 1M ──────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">⚔️ Armes 1M <small style="font-weight:400;color:var(--text-dim);font-family:inherit">— bouclier, baguette, main libre</small></div>
        <p class="sh-admin-section-hint">Plafond : <b style="color:var(--text)">${s.caps.weapon1H}</b> points de stats distribuables.</p>
        ${tierRow('1ᵉʳ point de stat', s.weapon['1H'][1], 'weapon.1H.1')}
        ${tierRow('2ᵉ point de stat',  s.weapon['1H'][2], 'weapon.1H.2')}
      </div>

      <!-- ── Armes 2M ──────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">⚔️ Armes 2M</div>
        <p class="sh-admin-section-hint">Plafond : <b style="color:var(--text)">${s.caps.weapon2H}</b> points de stats distribuables.</p>
        ${tierRow('1ᵉʳ point de stat', s.weapon['2H'][1], 'weapon.2H.1')}
        ${tierRow('2ᵉ point de stat',  s.weapon['2H'][2], 'weapon.2H.2')}
        ${tierRow('3ᵉ point de stat',  s.weapon['2H'][3], 'weapon.2H.3')}
        ${tierRow('4ᵉ point de stat',  s.weapon['2H'][4], 'weapon.2H.4')}
      </div>

      <!-- ── Amulettes ─────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📿 Amulettes</div>
        <p class="sh-admin-section-hint">3 stats distinctes max, +1 chacune.</p>
        ${tierRow('1ʳᵉ stat', s.amulet[1], 'amulet.1')}
        ${tierRow('2ᵉ stat',  s.amulet[2], 'amulet.2')}
        ${tierRow('3ᵉ stat',  s.amulet[3], 'amulet.3')}
      </div>

      <!-- ── Anneaux ───────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">💍 Anneaux</div>
        <p class="sh-admin-section-hint">L'anneau approfondit uniquement les stats qu'il porte déjà (profondeur). Coût par point de profondeur ; le nombre de points est plafonné par la rareté (ci-dessous).</p>
        ${tierRow('1ᵉʳ point', s.ring[1], 'ring.1')}
        ${tierRow('2ᵉ point',  s.ring[2], 'ring.2')}
        ${tierRow('3ᵉ point',  s.ring[3], 'ring.3')}
        ${tierRow('4ᵉ point',  s.ring[4], 'ring.4')}
        ${tierRow('5ᵉ point',  s.ring[5], 'ring.5')}
      </div>

      <!-- ── Plafonds ──────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📏 Plafonds</div>
        ${capRow('Points stats max — Arme 1M', s.caps.weapon1H, 'caps.weapon1H')}
        ${capRow('Points stats max — Arme 2M', s.caps.weapon2H, 'caps.weapon2H')}
        ${capRow('Stats max — Amulette',       s.caps.amulet,   'caps.amulet')}

        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border-md)">
          <p class="sh-admin-section-hint" style="margin-bottom:6px">Slots de traits par catégorie d'item :</p>
          ${capRow('⚔️ Arme (toutes confondues)', s.caps.traitsPerItem.arme,            'caps.traitsPerItem.arme')}
          ${capRow('🪖 Tête',                     s.caps.traitsPerItem['Tête'],          'caps.traitsPerItem.Tête')}
          ${capRow('🛡️ Torse',                    s.caps.traitsPerItem['Torse'],         'caps.traitsPerItem.Torse')}
          ${capRow('🥾 Pieds',                    s.caps.traitsPerItem['Pieds'],         'caps.traitsPerItem.Pieds')}
          ${capRow('📿 Amulette',                 s.caps.traitsPerItem['Amulette'],      'caps.traitsPerItem.Amulette')}
          ${capRow('💍 Anneau',                   s.caps.traitsPerItem['Anneau'],        'caps.traitsPerItem.Anneau')}
          ${capRow('🔮 Objet magique',            s.caps.traitsPerItem['Objet magique'], 'caps.traitsPerItem.Objet magique')}
        </div>
      </div>

      <!-- ── Plafonds par rareté (plafond DUR) ─────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">⭐ Plafonds par rareté</div>
        <p class="sh-admin-section-hint">Plafond <b style="color:var(--text)">dur</b> imposé par la rareté : le plafond réel d'un objet = <em>min(plafond de catégorie ci-dessus, plafond de rareté ici)</em>. Empêche une 1★ d'égaler une 5★. Les armes 1 main restent bornées par le plafond « Arme 1M ».</p>
        ${rarities.length
          ? rarities.map(rarityRow).join('')
          : '<p class="sh-admin-section-hint">Aucune rareté définie — configure-les d’abord dans l’admin des raretés.</p>'}
        ${rarities.length ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border-md)">
          <p class="sh-admin-section-hint" style="margin-bottom:6px">💍 Anneau — plafonds propres (il n'améliore que ses stats natives, en profondeur) :</p>
          ${rarities.map(ringRarityRow).join('')}
        </div>` : ''}
      </div>

      <!-- ── Reforge (monter la rareté, gatée Bastion — Option A) ── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">⭐ Reforge <small style="font-weight:400;color:var(--text-dim);font-family:inherit">— monter la rareté</small></div>
        <p class="sh-admin-section-hint">Seule la reforge (monter la rareté d'un cran, définitif) dépend d'une salle du Bastion. Améliorer stats/traits reste libre. Matériaux requis = la recette de craft de la catégorie (palier = rareté visée, max 3). Réglé par aventure.</p>
        <label class="sh-admin-row-checkbox" style="padding:6px 0">
          <input type="checkbox" ${s.reforge?.enabled ? 'checked' : ''} data-change="_upgCheck" data-field="reforge.enabled">
          <span>Activer la reforge</span>
        </label>
        <div class="sh-admin-row-line">
          <span class="sh-admin-row-lbl">Matériaux consommés (% de la recette de craft)</span>
          <input type="number" class="sh-admin-row-input small" value="${s.reforge?.materialPercent ?? 50}" min="0" max="100" step="5"
            data-input="_upgField" data-field="reforge.materialPercent">
          <span class="sh-admin-row-unit">%</span>
        </div>
        <p class="sh-admin-section-hint" style="margin:2px 0 4px">100 % = recette complète (= crafter un objet neuf) · 50 % = moitié · 0 % = or seul.</p>
        <p class="sh-admin-section-hint" style="margin:8px 0 4px">Discipline de craft → salle du Bastion :</p>
        ${discRow('forge', '⚒️ Forge')}
        ${discRow('confection', '🧵 Confection')}
        ${discRow('orfevre', '💎 Orfèvre')}
        <p class="sh-admin-section-hint" style="margin:12px 0 4px">Par rareté cible : niveau de salle requis + coût en or :</p>
        ${rarities.filter(r => r.value >= 2).length
          ? rarities.filter(r => r.value >= 2).map(reforgeRarityRow).join('')
          : '<p class="sh-admin-section-hint">Aucune rareté ≥ 2★ définie.</p>'}
      </div>

      <!-- ── Revente ───────────────────────────────────────── -->
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">💰 Revente</div>
        <div class="sh-admin-row-line">
          <span class="sh-admin-row-lbl">Reprise des améliorations à la revente</span>
          <input type="number" class="sh-admin-row-input small" value="${Math.round(s.refundUpgradeRatio * 100)}" min="0" max="100" step="5"
            data-input="_upgRatio">
          <span class="sh-admin-row-unit">%</span>
        </div>
        <p class="sh-admin-section-hint" style="margin-top:6px">
          Un objet amélioré se revend à son prix de revente + ce % du tarif actuel de ses améliorations (grilles ci-dessus) : changer un tarif ou ce % s'applique aux ventes suivantes. 0 % = améliorations perdues. L'objet de base est restitué en stock.
        </p>
      </div>

    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-action="_upgReset">↻ Restaurer défauts</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-outline btn-sm" data-action="_upgClose">Annuler</button>
      <button class="btn btn-gold btn-sm" data-action="_upgSave">💾 Enregistrer</button>
    </div>
  </div>
  `);
}

// ── Modifications en mémoire (sauvegarde déclenchée à la fermeture) ──
function _upgSetField(path, value) {
  const parts = path.split('.');
  const s = getUpgradeSettings();
  let cur = s;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  _settings = s;
}

async function _upgSaveAndClose() {
  try {
    await saveUpgradeSettings(getUpgradeSettings());
    showNotif('Paramètres enregistrés.', 'success');
    closeModalDirect();
  } catch (e) {
    console.error(e);
    showNotif('Erreur lors de l\'enregistrement.', 'error');
  }
}

async function _upgResetDefaults() {
  if (!await confirmModal('Restaurer les valeurs par défaut ? Vos tarifs actuels seront écrasés.', {
    title: 'Confirmation',
  })) return;
  _settings = JSON.parse(JSON.stringify(DEFAULT_UPGRADE_SETTINGS));
  _renderUpgradeSettingsModal();
}


registerActions({
  _upgClose: () => closeModal(),
  _upgReset: () => _upgResetDefaults(),
  _upgSave: () => _upgSaveAndClose(),
  _upgField: (el) => _upgSetField(el.dataset.field, +el.value),
  _upgStr: (el) => _upgSetField(el.dataset.field, el.value),
  _upgCheck: (el) => _upgSetField(el.dataset.field, el.checked),
  _upgRatio: (el) => _upgSetField('refundUpgradeRatio', (+el.value) / 100),
});
