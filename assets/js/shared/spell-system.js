// Adventure-scoped spell creation mode.
// Firestore: world/spell_system
//
// DÉFAUTS — ne pas « corriger » : le fallback ci-dessous ('runes') ne sert que
// pour les aventures LEGACY sans doc (elles gardent leur comportement d'origine).
// Une NOUVELLE aventure écrit explicitement mode:'classic' à la création
// (core/adventure.js — positionnement D&D-first, runes = contenu optionnel).

const DOC_ID = 'spell_system';
const DEFAULT_CONFIG = Object.freeze({ mode: 'runes', costTable: {} });

// Coût de chaque brique de sort (noyau + runes), par ressource. Le MJ édite ces
// montants directement (ex. Noyau = 2 PM / 2 PV / 5 Or). La clé du noyau est
// '__noyau'. Liste alignée sur RUNE_META (features/characters/spells.js).
export const SPELL_COST_ROWS = [
  { key: '__noyau',      label: 'Noyau (base)',  icon: '✦'  },
  { key: 'Puissance',    label: 'Puissance',     icon: '⚔️' },
  { key: 'Protection',   label: 'Protection',    icon: '💚' },
  { key: 'Amplification',label: 'Amplification', icon: '🌐' },
  { key: 'Dispersion',   label: 'Dispersion',    icon: '🎯' },
  { key: 'Enchantement', label: 'Enchantement',  icon: '✨' },
  { key: 'Affliction',   label: 'Affliction',    icon: '💀' },
  { key: 'Invocation',   label: 'Invocation',    icon: '🐾' },
  { key: 'Chance',       label: 'Chance',        icon: '🍀' },
  { key: 'Durée',        label: 'Durée',         icon: '⏱️' },
  { key: 'Concentration',label: 'Concentration', icon: '🧠' },
  { key: 'Déclenchement',label: 'Déclenchement', icon: '⚡' },
];

// Colonnes de ressources éditables + coût par défaut de CHAQUE brique.
// (Défaut identique pour toutes les briques : 2 PM, 2 PV, 5 Or.)
export const SPELL_COST_COLS = [
  { res: 'pm', label: 'PM', icon: '✦',  def: 2,  color: '#4f8cff' },
  { res: 'pv', label: 'PV', icon: '❤️', def: 2,  color: '#e0556f' },
  { res: 'or', label: 'Or', icon: '🪙', def: 10, color: '#d9a441' },
];
const _COL_DEF = Object.fromEntries(SPELL_COST_COLS.map(c => [c.res, c.def]));

let _config = null;
let _loadPromise = null;
let _adminPromise = null;
let openModal = null;
let closeModalDirect = null;
let showNotif = null;

function _normalizeCostTable(raw = {}) {
  const out = {};
  for (const { key } of SPELL_COST_ROWS) {
    for (const { res, def } of SPELL_COST_COLS) {
      const n = Number(raw?.[key]?.[res]);
      // On ne stocke que les valeurs valides ≠ défaut (défaut implicite).
      if (Number.isFinite(n) && n >= 0 && n !== def) {
        (out[key] ||= {})[res] = Math.round(n);
      }
    }
  }
  return out;
}

function _normalize(raw = {}) {
  return {
    mode: raw.mode === 'classic' ? 'classic' : 'runes',
    costTable: _normalizeCostTable(raw.costTable),
  };
}

export function getSpellSystemMode() {
  return (_config || DEFAULT_CONFIG).mode;
}

/** Coût d'une brique (`key` = rune ou '__noyau') dans une ressource, défaut inclus. */
export function spellRuneCost(key, res) {
  const stored = Number((_config || DEFAULT_CONFIG).costTable?.[key]?.[res]);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return _COL_DEF[res] ?? 0;
}

/**
 * Réduction de coût d'un set d'armure (ex. set léger) traduite dans la ressource
 * du sort. Le MJ configure un delta en PM (`spellPmDelta`) ; on le met à l'échelle
 * proportionnellement au coût du NOYAU dans chaque ressource :
 *   delta_res = spellPmDelta × (coûtNoyau[res] / coûtNoyau[pm])
 * Par défaut (noyau 2 PM / 2 PV / 10 Or, set léger −2 PM) → −2 PM, −2 PV, −10 Or,
 * soit « enlève un noyau ». Fonctionne quel que soit le mode (runes/classique).
 */
export function spellSetCostDelta(pmDelta, res) {
  const d = Number(pmDelta) || 0;
  if (!d || res === 'none') return 0;
  const noyauPm = spellRuneCost('__noyau', 'pm') || 1;
  return Math.round(d * spellRuneCost('__noyau', res) / noyauPm);
}

/** Table complète {clé: {pm,pv,or}} avec défauts appliqués — pour la modale MJ. */
export function getSpellCostTable() {
  const out = {};
  for (const { key } of SPELL_COST_ROWS) {
    out[key] = {};
    for (const { res } of SPELL_COST_COLS) out[key][res] = spellRuneCost(key, res);
  }
  return out;
}

export async function loadSpellSystem({ refresh = false } = {}) {
  if (_config && !refresh) return _config;
  if (_loadPromise && !refresh) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const { getDocData } = await import('../data/firestore.js');
      _config = _normalize(await getDocData('world', DOC_ID) || DEFAULT_CONFIG);
    } catch {
      _config = { ...DEFAULT_CONFIG };
    } finally {
      _loadPromise = null;
    }
    return _config;
  })();
  return _loadPromise;
}

export function invalidateSpellSystemCache() {
  _config = null;
  _loadPromise = null;
}

export async function saveSpellSystem(mode, costTable) {
  const next = _normalize({ mode, costTable: costTable ?? _config?.costTable });
  const { saveDoc } = await import('../data/firestore.js');
  await saveDoc('world', DOC_ID, { version: 1, ...next });
  _config = next;
  return next;
}

export function setSpellSystemForTests(mode) {
  _config = _normalize({ mode });
}

async function _ensureAdmin() {
  if (_adminPromise) return _adminPromise;
  _adminPromise = Promise.all([
    import('../core/actions.js'), import('./modal.js'), import('./notifications.js'),
  ]).then(([actions, modal, notifications]) => {
    openModal = modal.openModal;
    closeModalDirect = modal.closeModalDirect;
    showNotif = notifications.showNotif;
    actions.registerActions({
      _spellSystemClose: () => closeModalDirect(),
      // Le coût des runes ne concerne que la Forge de runes → masqué en mode classique.
      _spellSystemModeToggle: () => {
        const runes = document.querySelector('input[name="spell-system-mode"]:checked')?.value === 'runes';
        const sec = document.getElementById('spell-cost-config');
        if (sec) sec.hidden = !runes;
        document.querySelectorAll('.spell-system-option').forEach(el => {
          el.classList.toggle('is-selected', el.querySelector('input')?.checked);
        });
      },
      _spellSystemSave: async () => {
        const mode = document.querySelector('input[name="spell-system-mode"]:checked')?.value || 'runes';
        const costTable = {};
        SPELL_COST_ROWS.forEach(({ key }) => {
          SPELL_COST_COLS.forEach(({ res }) => {
            const el = document.getElementById(`spell-cost-${key}-${res}`);
            if (el) (costTable[key] ||= {})[res] = Number(el.value);
          });
        });
        try {
          await saveSpellSystem(mode, costTable);
          showNotif('Système de sorts enregistré (les nouveaux sorts appliqueront ces coûts).', 'success');
          closeModalDirect();
        } catch (error) {
          showNotif(error?.message || 'Erreur de sauvegarde.', 'error');
        }
      },
    });
  });
  return _adminPromise;
}

export async function openSpellSystemAdmin() {
  await _ensureAdmin();
  await loadSpellSystem();
  const mode = getSpellSystemMode();
  const costTable = getSpellCostTable();
  const option = (value, icon, title, detail) => `
    <label class="spell-system-option ${mode === value ? 'is-selected' : ''}">
      <input type="radio" name="spell-system-mode" value="${value}" ${mode === value ? 'checked' : ''} data-change="_spellSystemModeToggle">
      <span class="spell-system-option-icon">${icon}</span>
      <span><strong>${title}</strong><small>${detail}</small></span>
    </label>`;
  openModal('', `
    <div class="sh-admin-modal is-spell-system">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">🔮</div>
        <div class="sh-admin-head-title">
          <h2>Système de création des sorts</h2>
          <small>Choisis la forge proposée par défaut dans cette aventure.</small>
        </div>
        <button class="sh-admin-close" data-action="_spellSystemClose" aria-label="Fermer">×</button>
      </div>
      <div class="sh-admin-body">
        <div class="spell-system-options">
          ${option('runes', 'ᚱ', 'Forge de runes', 'Noyaux, runes cumulables, effets dérivés et combos de résonance.')}
          ${option('classic', '✦', 'Sorts classiques', 'Effets directs : dégâts ou soin, portée, zone, état, durée et recharge.')}
        </div>
        <div class="spell-system-note">
          <strong>Aucune conversion automatique.</strong>
          Les sorts déjà créés conservent leur système et restent modifiables avec leur propre forge.
        </div>

        <div class="spell-cost-config" id="spell-cost-config" ${mode === 'runes' ? '' : 'hidden'}>
          <div class="spell-cost-config-head">
            <strong>💰 Coût des runes</strong>
            <small>Coût de chaque brique dans chaque ressource. Le coût d'un sort = somme du noyau et de ses runes. Appliqué aux sorts créés ou modifiés ensuite.</small>
          </div>
          <div class="spell-cost-table">
            <div class="spell-cost-row spell-cost-row--head">
              <span class="spell-cost-cell-lbl">Brique</span>
              ${SPELL_COST_COLS.map(c => `<span class="spell-cost-cell-col" style="--rc:${c.color}"><span class="spell-cost-col-ic">${c.icon}</span>${c.label}</span>`).join('')}
            </div>
            ${SPELL_COST_ROWS.map(({ key, label, icon }, i) => `
              <div class="spell-cost-row${key === '__noyau' ? ' is-noyau' : ''}">
                <span class="spell-cost-cell-lbl"><span class="spell-cost-row-ic">${icon}</span>${label}</span>
                ${SPELL_COST_COLS.map(c => `
                  <label class="spell-cost-cell" style="--rc:${c.color}">
                    <input type="number" id="spell-cost-${key}-${c.res}" class="spell-cost-cell-input"
                      min="0" max="99" step="1" value="${costTable[key][c.res]}" aria-label="${label} — ${c.label}">
                  </label>`).join('')}
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_spellSystemClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_spellSystemSave">Enregistrer</button>
      </div>
    </div>`);
}
