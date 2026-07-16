// Adventure-scoped spell creation mode.
// Firestore: world/spell_system
//
// DÉFAUTS — ne pas « corriger » : le fallback ci-dessous ('runes') ne sert que
// pour les aventures LEGACY sans doc (elles gardent leur comportement d'origine).
// Une NOUVELLE aventure écrit explicitement mode:'classic' à la création
// (core/adventure.js — positionnement D&D-first, runes = contenu optionnel).

const DOC_ID = 'spell_system';
const DEFAULT_CONFIG = Object.freeze({ mode: 'runes' });

let _config = null;
let _loadPromise = null;
let _adminPromise = null;
let openModal = null;
let closeModalDirect = null;
let showNotif = null;

function _normalize(raw = {}) {
  return { mode: raw.mode === 'classic' ? 'classic' : 'runes' };
}

export function getSpellSystemMode() {
  return (_config || DEFAULT_CONFIG).mode;
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

export async function saveSpellSystem(mode) {
  const next = _normalize({ mode });
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
      _spellSystemSave: async () => {
        const mode = document.querySelector('input[name="spell-system-mode"]:checked')?.value || 'runes';
        try {
          await saveSpellSystem(mode);
          showNotif(mode === 'classic'
            ? 'La forge classique sera utilisée pour les nouveaux sorts.'
            : 'La forge de runes sera utilisée pour les nouveaux sorts.', 'success');
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
  const option = (value, icon, title, detail) => `
    <label class="spell-system-option ${mode === value ? 'is-selected' : ''}">
      <input type="radio" name="spell-system-mode" value="${value}" ${mode === value ? 'checked' : ''}>
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
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_spellSystemClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_spellSystemSave">Enregistrer</button>
      </div>
    </div>`);
}
