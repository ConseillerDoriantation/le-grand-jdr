import { getDocData, saveDoc } from '../../data/firestore.js';
import { openModal, closeModal, confirmModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { loadWeaponFormats, saveWeaponFormats } from '../../shared/weapon-formats.js';
import { loadDamageTypes, saveDamageTypes, DEFAULT_DAMAGE_TYPES } from '../../shared/damage-types.js';
import { _esc, modStr } from '../../shared/html.js';
import { computeEquipStatsBonus, getMod, getMaitriseBonus as _getMaitriseBonus } from '../../shared/char-stats.js';

// ══════════════════════════════════════════════
// STYLES DE COMBAT
// Firestore : world/combat_styles → { styles:[{id,label,condPrincipale,condSecondaire,description,couleur}] }
// ══════════════════════════════════════════════
export let _combatStyles = null; // cache en mémoire
export let _weaponFormats = null; // cache en mémoire (partagé avec weapon-formats.js)
let _damageTypes = null; // cache local types de dégâts

export async function loadCombatStyles() {
  if (_combatStyles) return _combatStyles;
  const [stylesDoc, formats] = await Promise.all([
    getDocData('world', 'combat_styles').catch(() => null),
    loadWeaponFormats(),
  ]);
  _combatStyles = stylesDoc?.styles || _defaultCombatStyles();
  _weaponFormats = formats;
  return _combatStyles;
}

export function _defaultCombatStyles() {
  return [
    {
      id: 'baguette',
      label: '🪄 Baguette magique',
      condPrincipale: ['Arme 1M CaC Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.',''],
      condSecondaire: ['Baguette'],
      condSousTypeS:  [],
      description: 'Baguette en main secondaire : dégâts de l\'arme passent de 1d6 à 1d10. Accès à la magie.',
      couleur: '#b47fff',
    },
    {
      id: 'bouclier',
      label: '🛡️ Bouclier',
      condPrincipale: ['Arme 1M CaC Phy.','Arme 2M CaC Phy.',''],
      condSecondaire: ['Bouclier'],
      condSousTypeS:  [],
      description: '+2 CA passive. Pas d\'attaque d\'opportunité avec la main secondaire.',
      couleur: '#22c38e',
    },
    {
      id: 'deux_mains',
      label: '⚔️⚔️ Deux armes',
      condPrincipale: ['Arme 1M CaC Phy.'],
      condSecondaire: ['Arme 1M CaC Phy.'],
      condSousTypeS:  [],
      description: 'Attaque bonus avec l\'arme secondaire (dégâts seulement, pas de mod). Désavantage si armes lourdes.',
      couleur: '#ff6b6b',
    },
    {
      id: 'main_libre',
      label: '🤜 Main libre',
      condPrincipale: ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 1M CaC Phy.'],
      condSecondaire: ['Main Libre',''],
      condSousTypeS:  [],
      description: 'Main secondaire libre (torche, objet...). Attaque d\'opportunité possible. Peut parer (+1 CA si en garde).',
      couleur: '#4f8cff',
    },
    {
      id: 'arme_2m',
      label: '🗡️ Arme à 2 mains',
      condPrincipale: ['Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.'],
      condSecondaire: [''],
      condSousTypeS:  [],
      description: 'Arme à 2 mains : dégâts maximisés (relancer les 1 et 2). Pas de réaction d\'attaque.',
      couleur: '#e8b84b',
    },
    {
      id: 'mains_nues',
      label: '🤛 Mains nues',
      condPrincipale: [''],
      condSecondaire: [''],
      condSousTypeS:  [],
      description: 'Aucune arme équipée. Dégâts 1d4 + Force. Attaque bonus possible chaque tour.',
      couleur: '#9ca3af',
    },
  ];
}

/**
 * Détecte le style de combat actif selon les armes équipées.
 * condSousTypeS : si renseigné, la main secondaire doit avoir ce sousType (insensible à la casse).
 * Ordre des styles : du plus spécifique au plus général.
 */
export function detectCombatStyle(c, styles) {
  const equip  = c?.equipement || {};
  const mainP  = equip['Main principale'];
  const mainS  = equip['Main secondaire'];
  const fmtP   = mainP?.format   || '';
  const fmtS   = mainS?.format   || '';
  const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();

  for (const style of styles) {
    const condP   = style.condPrincipale || [];
    const condS   = style.condSecondaire || [];
    const condST  = (style.condSousTypeS || []).map(s => s.toLowerCase());

    const matchP = condP.length === 0
      || condP.includes(fmtP)
      || (condP.includes('') && !fmtP);

    const matchS = condS.length === 0
      || condS.includes(fmtS)
      || (condS.includes('') && !fmtS);

    // Si le style a un filtre sousType secondaire, il doit correspondre
    const matchST = condST.length === 0
      || condST.some(st => stypeS.includes(st));

    // Pour "main libre" : le sousType secondaire NE DOIT PAS être bouclier ni baguette
    // (c'est géré par l'ordre : bouclier et baguette passent en premier)
    if (matchP && matchS && matchST) return style;
  }
  return null;
}

// Admin : ouvrir la gestion des styles de combat
export async function openCombatStylesAdmin() {
  try {
    const styles = await loadCombatStyles();
    _renderCombatStylesModal(styles);
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export function _renderCombatStylesModal(styles) {

  openModal('⚔️ Styles de Combat', `
    <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.75rem">
      Les styles sont détectés automatiquement selon les armes équipées.
      Le <strong>premier style</strong> dont les conditions correspondent est affiché.
    </div>
    <div id="cs-styles-list" style="display:flex;flex-direction:column;gap:.5rem">
      ${styles.map((s, i) => `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;
        padding:.7rem .85rem;border-left:3px solid ${s.couleur||'var(--border)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <div style="font-weight:600;font-size:.85rem;color:var(--text)">${s.label||'Style '+i}</div>
          <div style="display:flex;gap:.3rem">
            <button class="btn-icon" style="font-size:.72rem" onclick="window._editCombatStyle(${i})">✏️</button>
            <button class="btn-icon" style="font-size:.72rem;color:#ff6b6b" onclick="window._deleteCombatStyle(${i})">🗑️</button>
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:.2rem">
          Principale : <strong>${(s.condPrincipale||[]).join(', ')||'(vide)'}</strong>
          · Secondaire : <strong>${(s.condSecondaire||[]).join(', ')||'(vide)'}</strong>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:.25rem;font-style:italic">${s.description||''}</div>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" onclick="window._addCombatStyle()">+ Nouveau style</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Fermer</button>
    </div>
  `);
}

window._addCombatStyle = () => _openStyleEditor(-1, {
  label:'', condPrincipale:[], condSecondaire:[], description:'', couleur:'#4f8cff'
});
window._editCombatStyle = (i) => _openStyleEditor(i, _combatStyles[i] || {});
window._deleteCombatStyle = async (i) => {
  if (!await confirmModal('Supprimer ce style ?')) return;
  _combatStyles.splice(i, 1);
  await saveDoc('world', 'combat_styles', { styles: _combatStyles });
  showNotif('Style supprimé.', 'success');
  _renderCombatStylesModal(_combatStyles);
};

export function _getFormatsOpt() {
  return [
    { v:'', l:'(aucune arme)' },
    ...(_weaponFormats || []).map(f => ({ v: f.label, l: f.label })),
  ];
}

export function _openStyleEditor(idx, s) {
  openModal(idx >= 0 ? '✏️ Modifier le style' : '+ Nouveau style', `
    <div class="form-group">
      <label>Nom du style</label>
      <input class="input-field" id="cs-style-label" value="${s.label||''}" placeholder="🛡️ Bouclier">
    </div>
    <div class="form-group">
      <label>Format main principale <span style="color:var(--text-dim);font-weight:400">(plusieurs = OU)</span></label>
      <div id="cs-cond-p" style="display:flex;flex-direction:column;gap:.3rem">
        ${(s.condPrincipale?.length ? s.condPrincipale : ['']).map((v,fi) => `
        <div style="display:flex;gap:.3rem">
          <select class="input-field cs-cond-p-sel" style="flex:1">
            ${_getFormatsOpt().map(o=>`<option value="${o.v}" ${v===o.v?'selected':''}>${o.l}</option>`).join('')}
          </select>
          <button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:0 6px">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" onclick="window._csAddCond('cs-cond-p','cs-cond-p-sel')"
        style="font-size:.72rem;background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
        border-radius:6px;padding:2px 10px;cursor:pointer;color:#4f8cff;margin-top:.3rem">+ Condition</button>
    </div>
    <div class="form-group">
      <label>Format main secondaire <span style="color:var(--text-dim);font-weight:400">(plusieurs = OU)</span></label>
      <div id="cs-cond-s" style="display:flex;flex-direction:column;gap:.3rem">
        ${(s.condSecondaire?.length ? s.condSecondaire : ['']).map((v,fi) => `
        <div style="display:flex;gap:.3rem">
          <select class="input-field cs-cond-s-sel" style="flex:1">
            ${_getFormatsOpt().map(o=>`<option value="${o.v}" ${v===o.v?'selected':''}>${o.l}</option>`).join('')}
          </select>
          <button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:0 6px">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" onclick="window._csAddCond('cs-cond-s','cs-cond-s-sel')"
        style="font-size:.72rem;background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
        border-radius:6px;padding:2px 10px;cursor:pointer;color:#4f8cff;margin-top:.3rem">+ Condition</button>
    </div>
    <div class="form-group">
      <label>Description / Effets</label>
      <textarea class="input-field" id="cs-style-desc" rows="3" placeholder="Décris les bonus, malus, règles spéciales...">${s.description||''}</textarea>
    </div>
    <div class="form-group">
      <label>Couleur</label>
      <div style="display:flex;align-items:center;gap:.6rem">
        <input type="color" id="cs-style-color" value="${s.couleur||'#4f8cff'}"
          style="width:44px;height:36px;border-radius:8px;border:1px solid var(--border);cursor:pointer;padding:2px">
        <span style="font-size:.78rem;color:var(--text-dim)">Couleur de l'encart style</span>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="window._saveCombatStyle(${idx})">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="window._backToStylesList()">← Retour</button>
    </div>
  `);
}

window._csAddCond = (containerId, selClass) => {
  const container = document.getElementById(containerId);
  if (!container) return;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:.3rem';
  div.innerHTML = `
    <select class="input-field ${selClass}" style="flex:1">
      ${_getFormatsOpt().map(o=>`<option value="${o.v}">${o.l}</option>`).join('')}
    </select>
    <button type="button" onclick="this.parentElement.remove()"
      style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:0 6px">✕</button>`;
  container.appendChild(div);
};

window._saveCombatStyle = async (idx) => {
  const label = document.getElementById('cs-style-label')?.value?.trim();
  if (!label) { showNotif('Nom requis.', 'error'); return; }
  const condP = [...document.querySelectorAll('.cs-cond-p-sel')].map(s=>s.value);
  const condS = [...document.querySelectorAll('.cs-cond-s-sel')].map(s=>s.value);
  const style = {
    id: idx >= 0 ? (_combatStyles[idx]?.id || `style_${Date.now()}`) : `style_${Date.now()}`,
    label,
    condPrincipale: condP,
    condSecondaire: condS,
    description: document.getElementById('cs-style-desc')?.value?.trim() || '',
    couleur: document.getElementById('cs-style-color')?.value || '#4f8cff',
  };
  if (!_combatStyles) _combatStyles = [];
  if (idx >= 0) _combatStyles[idx] = style;
  else _combatStyles.push(style);
  await saveDoc('world', 'combat_styles', { styles: _combatStyles });
  showNotif('Style enregistré !', 'success');
  _renderCombatStylesModal(_combatStyles);
};

window._backToStylesList = () => _renderCombatStylesModal(_combatStyles || []);

// ══════════════════════════════════════════════
// FORMATS D'ARMES — Admin
// ══════════════════════════════════════════════
export async function openWeaponFormatsAdmin() {
  [_weaponFormats, _damageTypes] = await Promise.all([loadWeaponFormats(), loadDamageTypes()]);
  _renderWeaponFormatsModal(_weaponFormats);
}

export async function openDamageTypesAdmin() {
  _damageTypes = await loadDamageTypes();
  _renderDamageTypesModal(_damageTypes);
}

const _dmgTypeSelect = (i, val) => {
  const types = _damageTypes || DEFAULT_DAMAGE_TYPES;
  const opts = types.map(t =>
    `<option value="${_esc(t.id)}"${val===t.id?' selected':''}>${_esc(t.label)}</option>`
  ).join('');
  return `<select class="input-field" style="font-size:.75rem;padding:2px 6px;width:auto"
    onchange="window._setWeaponFormatType(${i}, this.value)">
    <option value=""${!val?' selected':''}>—</option>
    ${opts}
  </select>`;
};

export function _renderWeaponFormatsModal(formats) {
  openModal('⚔️ Formats d\'armes', `
    <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.75rem">
      Ces formats apparaissent dans la boutique (champ Format) et dans les conditions des styles de combat.
      Le type <strong>Magique</strong> applique ½ dégâts sur raté (hors fumble).
    </div>
    <div id="wf-list" style="display:flex;flex-direction:column;gap:.35rem">
      ${formats.map((f, i) => `
      <div style="display:flex;align-items:center;gap:.5rem;background:var(--bg-elevated);
        border:1px solid var(--border);border-radius:8px;padding:.45rem .7rem">
        <span style="flex:1;font-size:.84rem;color:var(--text)">${_esc(f.label)}</span>
        ${_dmgTypeSelect(i, f.damageType || '')}
        <button class="btn-icon" style="font-size:.7rem;color:#ff6b6b" onclick="window._deleteWeaponFormat(${i})">🗑️</button>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.75rem">
      <input class="input-field" id="wf-new-label" placeholder="Nouveau format..." style="flex:1">
      <select class="input-field" id="wf-new-type" style="font-size:.8rem;width:auto">
        <option value="">—</option>
        ${(_damageTypes||DEFAULT_DAMAGE_TYPES).map(t=>`<option value="${_esc(t.id)}">${_esc(t.label)}</option>`).join('')}
      </select>
      <button class="btn btn-gold btn-sm" onclick="window._addWeaponFormat()">+ Ajouter</button>
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.5rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="window.openDamageTypesAdmin()">⚡ Types de dégâts…</button>
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="closeModal()">Fermer</button>
    </div>
  `);
  setTimeout(() => document.getElementById('wf-new-label')?.focus(), 60);
}

window._setWeaponFormatType = async (i, damageType) => {
  const formats = [...(_weaponFormats || [])];
  if (!formats[i]) return;
  formats[i] = { ...formats[i], damageType };
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
};

window._addWeaponFormat = async () => {
  const label      = document.getElementById('wf-new-label')?.value?.trim();
  const damageType = document.getElementById('wf-new-type')?.value || '';
  if (!label) { showNotif('Nom requis.', 'error'); return; }
  const formats = _weaponFormats ? [..._weaponFormats] : [];
  if (formats.some(f => f.label.toLowerCase() === label.toLowerCase())) {
    showNotif('Ce format existe déjà.', 'error'); return;
  }
  formats.push({ id: `fmt_${Date.now()}`, label, damageType });
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
  showNotif('Format ajouté.', 'success');
  _renderWeaponFormatsModal(formats);
};

window._deleteWeaponFormat = async (i) => {
  if (!await confirmModal('Supprimer ce format ?', { title: 'Confirmation de suppression' })) return;
  const formats = [...(_weaponFormats || [])];
  formats.splice(i, 1);
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
  showNotif('Format supprimé.', 'success');
  _renderWeaponFormatsModal(formats);
};

// ══════════════════════════════════════════════
// TYPES DE DÉGÂTS — Admin
// ══════════════════════════════════════════════

const MISS_EFFECT_LABELS = { none: 'Aucun', half: 'Moitié', full: 'Complets' };

function _renderDamageTypesModal(types) {
  const mkRules = (t, i) => {
    const r = t.rules || {};
    const missOpts = ['none','half','full'].map(v =>
      `<option value="${v}"${(r.missEffect||'none')===v?' selected':''}>${MISS_EFFECT_LABELS[v]}</option>`
    ).join('');
    return `
    <div style="display:flex;flex-wrap:wrap;gap:.4rem .8rem;margin-top:.35rem;padding:.35rem .5rem;
      background:var(--bg-base);border-radius:6px;font-size:.76rem;color:var(--text-dim)">
      <label style="display:flex;align-items:center;gap:.3rem">
        Dégâts sur raté
        <select class="input-field" style="font-size:.75rem;padding:2px 5px;width:auto"
          onchange="window._saveDmgTypeProp(${i},'rules.missEffect',this.value)">
          ${missOpts}
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:.3rem">
        Pén. armure
        <input type="number" class="input-field" min="0" max="100" value="${r.armorPen||0}"
          style="width:52px;font-size:.75rem;padding:2px 5px"
          onchange="window._saveDmgTypeProp(${i},'rules.armorPen',+this.value)"> %
      </label>
      <label style="display:flex;align-items:center;gap:.3rem">
        Bonus dégâts
        <input type="number" class="input-field" value="${r.dmgBonus||0}"
          style="width:52px;font-size:.75rem;padding:2px 5px"
          onchange="window._saveDmgTypeProp(${i},'rules.dmgBonus',+this.value)">
      </label>
    </div>`;
  };

  openModal('⚡ Types de dégâts', `
    <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.75rem">
      Chaque type définit des règles appliquées automatiquement dans le VTT pour toutes les armes de ce type.
    </div>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${types.map((t, i) => `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:.5rem .7rem">
        <div style="display:flex;align-items:center;gap:.5rem">
          <input class="input-field" value="${_esc(t.label)}" style="flex:1;font-size:.84rem"
            onchange="window._saveDmgTypeProp(${i},'label',this.value)">
          <button class="btn-icon" style="font-size:.7rem;color:#ff6b6b"
            onclick="window._deleteDmgType(${i})">🗑️</button>
        </div>
        ${mkRules(t, i)}
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.75rem">
      <input class="input-field" id="dt-new-label" placeholder="Nouveau type..." style="flex:1">
      <button class="btn btn-gold btn-sm" onclick="window._addDmgType()">+ Ajouter</button>
    </div>
    <button class="btn btn-outline btn-sm" style="width:100%;margin-top:.5rem" onclick="closeModal()">Fermer</button>
  `);
  setTimeout(() => document.getElementById('dt-new-label')?.focus(), 60);
}

window._saveDmgTypeProp = async (i, path, value) => {
  const types = [...(_damageTypes || [])];
  if (!types[i]) return;
  if (path.startsWith('rules.')) {
    const key = path.slice(6);
    types[i] = { ...types[i], rules: { ...types[i].rules, [key]: value } };
  } else {
    types[i] = { ...types[i], [path]: value };
  }
  await saveDamageTypes(types);
  _damageTypes = types;
};

window._addDmgType = async () => {
  const label = document.getElementById('dt-new-label')?.value?.trim();
  if (!label) { showNotif('Nom requis.', 'error'); return; }
  const types = [...(_damageTypes || [])];
  if (types.some(t => t.label.toLowerCase() === label.toLowerCase())) {
    showNotif('Ce type existe déjà.', 'error'); return;
  }
  types.push({ id: `dt_${Date.now()}`, label, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } });
  await saveDamageTypes(types);
  _damageTypes = types;
  showNotif('Type ajouté.', 'success');
  _renderDamageTypesModal(types);
};

window._deleteDmgType = async (i) => {
  if (!await confirmModal('Supprimer ce type ?', { title: 'Confirmation' })) return;
  const types = [...(_damageTypes || [])];
  types.splice(i, 1);
  await saveDamageTypes(types);
  _damageTypes = types;
  showNotif('Type supprimé.', 'success');
  _renderDamageTypesModal(types);
};

// expose pour l'appel depuis le modal formats
window.openDamageTypesAdmin = async () => {
  _damageTypes = await loadDamageTypes();
  _renderDamageTypesModal(_damageTypes);
};

// ══════════════════════════════════════════════
// COMPUTED STATS
// ══════════════════════════════════════════════
// Retourne la liste des traits d'un item — priorité à traits[] (array), fallback sur trait (string legacy)
export function _getTraits(item = {}) {
  if (Array.isArray(item.traits) && item.traits.length > 0) return item.traits.filter(Boolean);
  if (item.trait) return [item.trait];
  return [];
}

export function getEquippedInventoryIndexMap(c) {
  const map = new Map();
  Object.entries(c?.equipement || {}).forEach(([slot, item]) => {
    const rawIdx = item?.sourceInvIndex;
    const idx = Number.isInteger(rawIdx) ? rawIdx : parseInt(rawIdx, 10);
    if (!Number.isInteger(idx) || idx < 0) return;
    const slots = map.get(idx) || [];
    slots.push(slot);
    map.set(idx, slots);
  });
  return map;
}

export function syncEquipmentAfterInventoryMutation(c, removedIndices = []) {
  const removed = [...new Set((removedIndices || [])
    .map(v => Number.isInteger(v) ? v : parseInt(v, 10))
    .filter(v => Number.isInteger(v) && v >= 0))].sort((a, b) => a - b);

  const currentEquip = c?.equipement || {};
  if (!removed.length) {
    return {
      equipement: currentEquip,
      statsBonus: c?.statsBonus || computeEquipStatsBonus(currentEquip),
      changed: false,
      removedSlots: [],
    };
  }

  const removedSet = new Set(removed);
  const countRemovedBefore = idx => {
    let count = 0;
    for (const removedIdx of removed) {
      if (removedIdx < idx) count++;
      else break;
    }
    return count;
  };

  const nextEquip = {};
  const removedSlots = [];
  let changed = false;

  Object.entries(currentEquip).forEach(([slot, item]) => {
    const rawIdx = item?.sourceInvIndex;
    const srcIdx = Number.isInteger(rawIdx) ? rawIdx : parseInt(rawIdx, 10);

    if (!Number.isInteger(srcIdx) || srcIdx < 0) {
      nextEquip[slot] = item;
      return;
    }

    if (removedSet.has(srcIdx)) {
      changed = true;
      removedSlots.push(slot);
      return;
    }

    const nextIdx = srcIdx - countRemovedBefore(srcIdx);
    if (nextIdx !== srcIdx) {
      nextEquip[slot] = { ...item, sourceInvIndex: nextIdx };
      changed = true;
      return;
    }

    nextEquip[slot] = item;
  });

  const statsBonus = computeEquipStatsBonus(nextEquip);
  const prevStats = c?.statsBonus || {};
  if (JSON.stringify(prevStats) !== JSON.stringify(statsBonus)) changed = true;

  return { equipement: nextEquip, statsBonus, changed, removedSlots };
}

export function normalizeArmorType(type = '') {
  const raw = String(type || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!raw) return '';
  if (['leger', 'legere', 'light'].includes(raw)) return 'Légère';
  if (['intermediaire', 'medium', 'mid'].includes(raw)) return 'Intermédiaire';
  if (['lourd', 'lourde', 'heavy'].includes(raw)) return 'Lourde';
  return String(type || '').trim();
}

export function getArmorTypeMeta(type = '') {
  const label = normalizeArmorType(type);
  if (label === 'Légère') {
    return {
      label,
      tone: 'light',
      chipText: 'Léger : Coût des sorts -2 PM',
      modifiers: { spellPmDelta: -2, toucherBonus: 0, damageReduction: 0 },
    };
  }
  if (label === 'Intermédiaire') {
    return {
      label,
      tone: 'medium',
      chipText: 'Intermédiaire : Toucher +2',
      modifiers: { spellPmDelta: 0, toucherBonus: 2, damageReduction: 0 },
    };
  }
  if (label === 'Lourde') {
    return {
      label,
      tone: 'heavy',
      chipText: 'Lourd : Réduction 2 dégâts',
      modifiers: { spellPmDelta: 0, toucherBonus: 0, damageReduction: 2 },
    };
  }
  return {
    label,
    tone: 'neutral',
    chipText: '',
    modifiers: { spellPmDelta: 0, toucherBonus: 0, damageReduction: 0 },
  };
}

export function getArmorSetChipText(setData = {}) {
  if (!setData?.isActive) return '';
  return setData.activeEffect?.chipText || getArmorTypeMeta(setData.fullType).chipText || '';
}

export function getArmorSetData(c = {}) {
  const equip = c?.equipement || {};
  const trackedSlots = ['Tête', 'Torse', 'Bottes'];
  const slots = trackedSlots.map(slot => {
    const item = equip?.[slot] || {};
    return {
      slot,
      item,
      type: normalizeArmorType(item?.typeArmure),
      equipped: Boolean(item?.nom),
    };
  });

  const equippedCount = slots.filter(entry => entry.equipped).length;
  const typedSlots = slots.filter(entry => entry.type);
  const counts = typedSlots.reduce((acc, entry) => {
    acc[entry.type] = (acc[entry.type] || 0) + 1;
    return acc;
  }, {});

  const fullType = ['Légère', 'Intermédiaire', 'Lourde']
    .find(type => counts[type] === trackedSlots.length) || '';

  const activeEffect = fullType ? getArmorTypeMeta(fullType) : null;
  const mixed = !fullType && Object.keys(counts).length > 1;
  const dominantType = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return {
    trackedSlots,
    slots,
    counts,
    equippedCount,
    fullType,
    dominantType,
    mixed,
    isComplete: equippedCount === trackedSlots.length,
    isActive: Boolean(activeEffect),
    activeEffect,
    modifiers: activeEffect?.modifiers || { spellPmDelta: 0, toucherBonus: 0, damageReduction: 0 },
  };
}

export function applyFlatBonusToRollText(text = '', bonus = 0) {
  const raw = String(text || '').trim();
  if (!raw || !bonus) return raw;
  const match = raw.match(/^(.*?)([+-]\s*\d+)\s*$/);
  if (!match) return `${raw} ${modStr(bonus)}`;
  const prefix = match[1].trimEnd();
  const current = parseInt(match[2].replace(/\s+/g, ''), 10) || 0;
  return `${prefix} ${modStr(current + bonus)}`;
}

const _STAT_LABELS = {
  force:'Force', dexterite:'Dex', intelligence:'Int',
  sagesse:'Sag', constitution:'Con', charisme:'Cha',
};

// Retourne les composants structurés du toucher (pour affichage avancé)
export function getWeaponToucherParts(c, item = {}, fallbackKey = 'force') {
  const statKey  = item.toucherStat || fallbackKey;
  const setBonus = getArmorSetData(c).modifiers.toucherBonus || 0;
  const statMod  = getMod(c, statKey);
  const total    = statMod + setBonus;
  if (item.toucher && !item.toucherStat) {
    return { roll: applyFlatBonusToRollText(item.toucher, setBonus), statLabel: null, setBonus };
  }
  return { roll: `1d20 ${modStr(total)}`, statLabel: _STAT_LABELS[statKey] || statKey, statMod, setBonus };
}

// Retourne les composants structurés des dégâts (pour affichage avancé)
export function getWeaponDegatsParts(c, item = {}, fallbackKey = 'force') {
  if (!item.degats) return null;
  const statsArr = Array.isArray(item.degatsStats) && item.degatsStats.length
    ? item.degatsStats.filter(Boolean)
    : [item.degatsStat || fallbackKey];
  const statMod = statsArr.reduce((sum, key) => sum + getMod(c, key), 0);
  const maitriseBonus = _getMaitriseBonus(c, item);
  const statLabel = statsArr.map(k => _STAT_LABELS[k] || k).join(' + ');
  return {
    roll:           `${item.degats} ${modStr(statMod + maitriseBonus)}`,
    statLabel,
    statMod,
    maitriseBonus,
  };
}

// Compatibilité — conservées pour les autres appelants
export function getToucherDisplay(c, item = {}, fallbackKey = 'force') {
  return getWeaponToucherParts(c, item, fallbackKey).roll;
}

export function getDegatsDisplay(c, item = {}, fallbackKey = 'force') {
  const p = getWeaponDegatsParts(c, item, fallbackKey);
  return p ? p.roll : '—';
}
