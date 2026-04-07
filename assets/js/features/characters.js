import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

// ══════════════════════════════════════════════
// STYLES DE COMBAT
// Firestore : world/combat_styles → { styles:[{id,label,condPrincipale,condSecondaire,description,couleur}] }
// ══════════════════════════════════════════════
let _combatStyles = null; // cache en mémoire

async function loadCombatStyles() {
  if (_combatStyles) return _combatStyles;
  try {
    const doc = await getDocData('world', 'combat_styles');
    _combatStyles = doc?.styles || _defaultCombatStyles();
  } catch {
    _combatStyles = _defaultCombatStyles();
  }
  return _combatStyles;
}

function _defaultCombatStyles() {
  return [
    {
      id: 'baguette',
      label: '🪄 Baguette magique',
      condPrincipale: ['Arme 1M CaC Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.',''],
      condSecondaire: ['Arme Secondaire (Bouclier, Torche...)'],
      condSousTypeS:  ['Baguette','baguette'],       // sousType de la main secondaire
      description: 'Baguette en main secondaire : dégâts de l\'arme passent de 1d6 à 1d10. Accès à la magie.',
      couleur: '#b47fff',
    },
    {
      id: 'bouclier',
      label: '🛡️ Bouclier',
      condPrincipale: ['Arme 1M CaC Phy.','Arme 2M CaC Phy.',''],
      condSecondaire: ['Arme Secondaire (Bouclier, Torche...)'],
      condSousTypeS:  ['Bouclier','bouclier'],
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
      condSecondaire: ['Arme Secondaire (Bouclier, Torche...)',''],
      condSousTypeS:  [],                            // n'importe quel secondaire non bouclier/baguette
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
function detectCombatStyle(c, styles) {
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
async function openCombatStylesAdmin() {
  const styles = await loadCombatStyles();
  _renderCombatStylesModal(styles);
}

function _renderCombatStylesModal(styles) {
  const FORMATS = [
    '', 'Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.',
    'Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)',
  ];

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
  if (!confirm('Supprimer ce style ?')) return;
  _combatStyles.splice(i, 1);
  await saveDoc('world', 'combat_styles', { styles: _combatStyles });
  showNotif('Style supprimé.', 'success');
  _renderCombatStylesModal(_combatStyles);
};

const FORMATS_OPT = [
  { v:'', l:'(aucune arme)' },
  { v:'Arme 1M CaC Phy.', l:'Arme 1M CaC Phy.' },
  { v:'Arme 2M CaC Phy.', l:'Arme 2M CaC Phy.' },
  { v:'Arme 2M Dist Phy.', l:'Arme 2M Dist Phy.' },
  { v:'Arme 2M CaC Mag.', l:'Arme 2M CaC Mag.' },
  { v:'Arme 2M Dist Mag.', l:'Arme 2M Dist Mag.' },
  { v:'Arme Secondaire (Bouclier, Torche...)', l:'Arme Secondaire' },
];

function _openStyleEditor(idx, s) {
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
            ${FORMATS_OPT.map(o=>`<option value="${o.v}" ${v===o.v?'selected':''}>${o.l}</option>`).join('')}
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
            ${FORMATS_OPT.map(o=>`<option value="${o.v}" ${v===o.v?'selected':''}>${o.l}</option>`).join('')}
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
      ${FORMATS_OPT.map(o=>`<option value="${o.v}">${o.l}</option>`).join('')}
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
// COMPUTED STATS
// ══════════════════════════════════════════════
// Retourne la liste des traits d'un item — priorité à traits[] (array), fallback sur trait (string legacy)
function _getTraits(item = {}) {
  if (Array.isArray(item.traits) && item.traits.length > 0) return item.traits.filter(Boolean);
  if (item.trait) return [item.trait];
  return [];
}

function getMod(c, key) {
  const base = (c.stats||{})[key]||8;
  const bonus = (c.statsBonus||{})[key]||0;
  const total = Math.min(22, base+bonus); // modificateur plafonné à +6 (score max 22)
  return Math.floor((total-10)/2);
}
function modStr(v) { return v >= 0 ? '+'+v : String(v); }
const ITEM_STAT_META = [
  { full:'force', store:'fo', short:'Fo', label:'Force' },
  { full:'dexterite', store:'dex', short:'Dex', label:'Dextérité' },
  { full:'intelligence', store:'in', short:'Int', label:'Intelligence' },
  { full:'sagesse', store:'sa', short:'Sag', label:'Sagesse' },
  { full:'constitution', store:'co', short:'Con', label:'Constitution' },
  { full:'charisme', store:'ch', short:'Cha', label:'Charisme' },
];
const ITEM_STAT_BY_FULL = Object.fromEntries(ITEM_STAT_META.map(s => [s.full, s]));
const ITEM_STAT_BY_STORE = Object.fromEntries(ITEM_STAT_META.map(s => [s.store, s]));

function statShort(key) {
  return ITEM_STAT_BY_FULL[key]?.short || '';
}

function collectItemBonusEntries(item = {}) {
  return ITEM_STAT_META
    .map(stat => ({ ...stat, value: parseInt(item?.[stat.store]) || 0 }))
    .filter(stat => stat.value);
}

function formatItemBonusText(item = {}) {
  const entries = collectItemBonusEntries(item);
  if (entries.length) return entries.map(stat => `${stat.short} ${stat.value > 0 ? '+' : ''}${stat.value}`).join(' · ');
  return item?.stats || '';
}

function getEquippedInventoryIndexMap(c) {
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

function syncEquipmentAfterInventoryMutation(c, removedIndices = []) {
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

function normalizeArmorType(type = '') {
  const raw = String(type || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!raw) return '';
  if (['leger', 'legere', 'light'].includes(raw)) return 'Légère';
  if (['intermediaire', 'medium', 'mid'].includes(raw)) return 'Intermédiaire';
  if (['lourd', 'lourde', 'heavy'].includes(raw)) return 'Lourde';
  return String(type || '').trim();
}

function getArmorTypeMeta(type = '') {
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

function getArmorSetChipText(setData = {}) {
  if (!setData?.isActive) return '';
  return setData.activeEffect?.chipText || getArmorTypeMeta(setData.fullType).chipText || '';
}

function getArmorSetData(c = {}) {
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

function applyFlatBonusToRollText(text = '', bonus = 0) {
  const raw = String(text || '').trim();
  if (!raw || !bonus) return raw;
  const match = raw.match(/^(.*?)([+-]\s*\d+)\s*$/);
  if (!match) return `${raw} ${modStr(bonus)}`;
  const prefix = match[1].trimEnd();
  const current = parseInt(match[2].replace(/\s+/g, ''), 10) || 0;
  return `${prefix} ${modStr(current + bonus)}`;
}

function getToucherDisplay(c, item = {}, fallbackKey = 'force') {
  const statKey = item.toucherStat || fallbackKey;
  const setBonus = getArmorSetData(c).modifiers.toucherBonus || 0;
  if (item.toucherStat) return `1d20 ${modStr(getMod(c, statKey) + setBonus)}`;
  if (item.toucher) return applyFlatBonusToRollText(item.toucher, setBonus);
  return `1d20 ${modStr(getMod(c, fallbackKey) + setBonus)}`;
}

function getDegatsDisplay(c, item = {}, fallbackKey = 'force') {
  if (!item.degats) return '—';
  const statKey = item.degatsStat || fallbackKey;
  const statMod = getMod(c, statKey);
  // Bonus de maîtrise : chercher dans c.maitrises le type qui correspond
  const maitrisesBonus = _getMaitriseBonus(c, item);
  const totalMod = statMod + maitrisesBonus;
  const maitriseTag = maitrisesBonus > 0
    ? ` <span style="font-size:.65rem;color:#b47fff" title="Maîtrise +${maitrisesBonus}">✦+${maitrisesBonus}</span>`
    : '';
  return `${item.degats} ${modStr(totalMod)}${maitriseTag}`;
}

// Retourne le bonus de maîtrise d'un item pour un personnage
function _getMaitriseBonus(c, item = {}) {
  if (!c?.maitrises?.length) return 0;

  // Construire la liste des types à tester par priorité :
  // 1. sousType du slot équipé (copié depuis boutique lors de l'équipement)
  // 2. typeArme du slot (saisi manuellement)
  // 3. sousType de l'item inventaire source (si le slot a un sourceInvIndex)
  // 4. typeArme de l'item inventaire source
  const candidates = new Set();

  const addIfNonEmpty = v => { if (v && v.trim()) candidates.add(v.toLowerCase().trim()); };

  addIfNonEmpty(item.sousType);
  addIfNonEmpty(item.typeArme);

  // Chercher dans l'inventaire via sourceInvIndex si le slot n'a pas de sousType
  if (!item.sousType && Number.isInteger(item.sourceInvIndex)) {
    const invItem = (c.inventaire || [])[item.sourceInvIndex];
    if (invItem) {
      addIfNonEmpty(invItem.sousType);
      addIfNonEmpty(invItem.typeArme);
    }
  }

  if (!candidates.size) return 0;

  let best = 0;
  for (const m of c.maitrises) {
    const mType = (m.typeArme || '').toLowerCase().trim();
    if (!mType) continue;
    for (const cand of candidates) {
      if (cand === mType || cand.includes(mType) || mType.includes(cand)) {
        best = Math.max(best, parseInt(m.niveau) || 0);
        break;
      }
    }
  }
  return best;
}

function calcCA(c) {
  const equip = c.equipement||{};
  const torse = equip['Torse']?.typeArmure||'';
  let caBase = 8;
  if (torse==='Légère') caBase=10;
  else if (torse==='Intermédiaire') caBase=12;
  else if (torse==='Lourde') caBase=14;
  const caEquip = Object.values(equip).reduce((s,it)=>s+(it.ca||0),0);

  // +2 CA si bouclier en main secondaire
  const mainS = equip['Main secondaire'];
  const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();
  const hasBouclier = stypeS.includes('bouclier') || stypeS.includes('shield');
  const bouclierBonus = hasBouclier ? 2 : 0;

  return caBase + getMod(c,'dexterite') + caEquip + bouclierBonus;
}
function calcVitesse(c) { return 3 + getMod(c,'force'); }
function calcDeckMax(c) {
  const modIn = getMod(c,'intelligence');
  const niveau = c.niveau||1;
  return 3 + Math.min(0,modIn) + Math.floor(Math.max(0,modIn) * Math.pow(Math.max(0,niveau-1),0.75));
}
function calcPVMax(c) {
  const modCo = getMod(c,'constitution');
  const niv = c.niveau||1;
  // Bonus positif : +modCo PV par niveau gagné (scalable)
  // Malus négatif  : appliqué UNE SEULE FOIS (pas multiplié par niveau)
  // Ex: modCo=-1, niv=10 → pvBase-1 (et non pvBase-10)
  const progression = modCo > 0 ? Math.floor(modCo*(niv-1)) : modCo;
  return Math.max(1, (c.pvBase||10) + progression);
}
function calcPMMax(c) {
  const modSa = getMod(c,'sagesse');
  const niv = c.niveau||1;
  // Même logique : malus fixe une seule fois, bonus scalable par niveau
  const progression = modSa > 0 ? Math.floor(modSa*(niv-1)) : modSa;
  return Math.max(0, (c.pmBase||10) + progression);
}

function calcOr(c) {
  const compte = c.compte||{recettes:[],depenses:[]};
  const totalR = (compte.recettes||[]).reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = (compte.depenses||[]).reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  return Math.round((totalR - totalD) * 100) / 100;
}


function calcPalier(niveau) {
  return 100 * niveau * niveau; // 100, 400, 900, 1600...
}

function pct(cur,max) { return max>0 ? Math.max(0,Math.min(100,Math.round(cur/max*100))) : 0; }

// ══════════════════════════════════════════════
// SÉLECTION
// ══════════════════════════════════════════════
function selectChar(id, el) {
  document.querySelectorAll('#char-pills .char-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const c = STATE.characters.find(x=>x.id===id);
  if (c) { STATE.activeChar=c; renderCharSheet(c, window._currentCharTab||'carac'); }
}

function filterAdminChars(pseudo, el) {
  document.querySelectorAll('#admin-player-filter .char-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const pills = document.querySelector('#char-pills');
  if (!pills) return;
  const chars = pseudo ? STATE.characters.filter(c=>c.ownerPseudo===pseudo) : STATE.characters;
  pills.innerHTML = chars.map((c,i)=>`<div class="char-pill ${i===0?'active':''}" onclick="selectChar('${c.id}',this)">${c.nom||'Sans nom'}</div>`).join('');
  if (chars.length > 0) { STATE.activeChar=chars[0]; renderCharSheet(chars[0]); }
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  const canEdit = STATE.isAdmin || c.uid === STATE.user?.uid;
  const currentTab = keepTab || window._currentCharTab || 'combat';

  window._currentChar = c;
  window._canEditChar = canEdit;
  window._currentCharTab = currentTab;

  const pvMax = calcPVMax(c);
  const pmMax = calcPMMax(c);
  const pvCur = c.pvActuel ?? pvMax;
  const pmCur = c.pmActuel ?? pmMax;
  const pvPct = pct(pvCur, pvMax);
  const pmPct = pct(pmCur, pmMax);
  const xpPct = pct(c.exp||0, calcPalier(c.niveau||1));
  const deckActifs = (c.deck_sorts||[]).filter(s=>s.actif).length;
  const deckMax = calcDeckMax(c);
  const pvColor = pvPct < 25 ? 'var(--crimson-light)' : pvPct < 50 ? '#f59e0b' : 'var(--green)';

  const titres = c.titres||[];
  const titreHtml = titres.map(t=>`<span class="badge badge-gold" style="font-size:0.65rem">${t}</span>`).join('');

  // Stats inline — compactes pour la zone haute
  const STATS = [
    {key:'force',abbr:'Fo',label:'Force'},
    {key:'dexterite',abbr:'Dex',label:'Dextérité'},
    {key:'constitution',abbr:'Co',label:'Constitution'},
    {key:'intelligence',abbr:'Int',label:'Intelligence'},
    {key:'sagesse',abbr:'Sag',label:'Sagesse'},
    {key:'charisme',abbr:'Cha',label:'Charisme'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  const caracHtml = STATS.map(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    const mStr = m >= 0 ? '+'+m : String(m);
    const mClass = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    const bonusStr = bonus >= 0 ? `+${bonus}` : String(bonus);
    const bonusTone = bonus > 0 ? 'is-pos' : bonus < 0 ? 'is-neg' : 'is-zero';
    return `<div class="cs-carac-card ${canEdit ? 'is-clickable' : ''}"
             title="${canEdit ? `Modifier la base de ${st.label}` : st.label}"
             ${canEdit ? `onclick="inlineEditStatFromCard(event,'${c.id}','${st.key}',this)"` : ''}>
      <div class="cs-carac-head">
        <div class="cs-carac-abbr">${st.abbr}</div>
        <div class="cs-carac-mod-badge ${mClass}">${mStr}</div>
      </div>
      <div class="cs-carac-total-label">Total</div>
      <div class="cs-carac-val">${total}</div>
      <div class="cs-carac-breakdown">
        <div class="cs-carac-breakdown-item">
          <span class="cs-carac-breakdown-label">Base</span>
          <span class="cs-carac-breakdown-value ${canEdit ? 'cs-editable js-stat-base' : ''}"
                ${canEdit ? `title="Modifier la base"` : ''}>${base}</span>
        </div>
        <div class="cs-carac-breakdown-item">
          <span class="cs-carac-breakdown-label">Équip.</span>
          <span class="cs-carac-breakdown-value ${bonusTone}">${bonusStr}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Switch rapide entre personnages du même joueur (ou tous pour admin)
  const allChars = STATE.characters || [];
  const switchableChars = STATE.isAdmin
    ? allChars
    : allChars.filter(x => x.uid === STATE.user?.uid);
  const charSwitcher = switchableChars.length > 1
    ? `<div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.5rem">
        ${switchableChars.map(ch => `
        <button onclick="selectChar('${ch.id}',document.querySelector('[data-charid=\\'${ch.id}\\']') || document.querySelector('.char-pill'))"
          style="font-size:.68rem;padding:2px 9px;border-radius:999px;cursor:pointer;
          border:1px solid ${ch.id===c.id?'var(--gold)':'var(--border)'};
          background:${ch.id===c.id?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
          color:${ch.id===c.id?'var(--gold)':'var(--text-dim)'};
          font-weight:${ch.id===c.id?'700':'400'};transition:all .12s"
          ${ch.id===c.id?'disabled':''}>
          ${ch.nom||'?'}
        </button>`).join('')}
      </div>`
    : '';

  // Onglets — 5 onglets (Carac fusionné dans Combat, secondaires regroupés)
  const TABS = [
    { id:'combat',     label:'⚔️ Combat'     },
    { id:'sorts',      label:'✨ Sorts'       },
    { id:'inventaire', label:'🎒 Inventaire'  },
    { id:'quetes',     label:'📜 Quêtes'      },
    { id:'plus',       label:'···'            },
  ];
  // Onglets "plus" = compte + notes + maitrises (dans un sous-menu)
  const isSecondaryTab = ['compte','notes','maitrises'].includes(currentTab);

  area.innerHTML = `
<div class="cs-shell">

  <!-- ═══ LIGNE HAUTE : panneau gauche + caractéristiques ═══ -->
  <div class="cs-top">

    <div class="cs-identity-panel">

      ${charSwitcher}

      <!-- Photo + Nom -->
      <div class="cs-id-header">
        <div class="cs-photo-wrap" id="char-photo-wrap">
          <div class="cs-photo" id="char-photo"
               onclick="${canEdit?`openPhotoCropper('${c.id}')`:''}"
               style="cursor:${canEdit?'pointer':'default'}">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;
                   transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);
                   transform-origin:center center;">`
              : `<div class="cs-photo-placeholder">
                   ${canEdit?'<span style="font-size:1.5rem">📷</span>':'<span style="font-size:1.8rem;opacity:0.3">⚔️</span>'}
                 </div>`}
          </div>
          ${canEdit&&c.photo?`<button class="cs-photo-del" onclick="deleteCharPhoto('${c.id}')" title="Supprimer">✕</button>`:''}
        </div>
        <div class="cs-id-info">
          <div class="cs-name-row">
            ${canEdit
              ? `<span class="cs-name cs-editable" onclick="inlineEditText('${c.id}','nom',this)" title="Cliquer pour modifier">${c.nom||'Nouveau personnage'}</span>`
              : `<span class="cs-name">${c.nom||'Nouveau personnage'}</span>`}
            ${canEdit?`<button class="cs-delete-btn" onclick="deleteChar('${c.id}')" title="Supprimer le personnage">🗑️</button>`:''}
          </div>
          <div class="cs-titres">
            ${titreHtml}
            ${canEdit?`<button class="cs-add-titre" onclick="manageTitres('${c.id}')">＋ titre</button>`:''}
          </div>
        </div>
      </div>

      <!-- Niveau + Or + XP compact sur une ligne -->
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
        <span class="cs-level-badge">
          ${canEdit
            ? `<span class="cs-editable-num" onclick="inlineEditNum('${c.id}','niveau',this,1,20)" title="Modifier">Niv. ${c.niveau||1}</span>`
            : `Niv. ${c.niveau||1}`}
        </span>
        <span class="cs-or" title="Solde du Livret de Compte">💰 ${calcOr(c)} or</span>
        <!-- XP compact : barre fine + % -->
        <div style="display:flex;align-items:center;gap:.35rem;flex:1;min-width:80px" title="XP : ${c.exp||0} / ${calcPalier(c.niveau||1)}">
          <div style="flex:1;height:4px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden">
            <div id="xp-bar-fill" style="width:${xpPct}%;height:100%;background:var(--gold);border-radius:2px;transition:width .4s"></div>
          </div>
          <span id="xp-pct" style="font-size:.6rem;color:var(--text-dim);white-space:nowrap">${xpPct}%</span>
          ${canEdit ? `<input type="number" class="cs-xp-input cs-inline-num"
            id="xp-direct-input" value="${c.exp||0}" min="0" max="${calcPalier(c.niveau||1)}"
            onchange="saveXpDirect('${c.id}',this)" oninput="previewXpBar(this,${calcPalier(c.niveau||1)})"
            style="width:50px;font-size:.65rem;padding:1px 4px;text-align:center;
            background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:5px;
            color:var(--text-dim)" title="XP actuel">` : ''}
        </div>
      </div>

      <div class="cs-divider"></div>

      <!-- PV / PM — boutons plus grands pour le live -->
      <div class="cs-vitals-row">
        <div class="cs-vital-block">
          <div class="cs-vital-label">❤️ PV</div>
          <div class="cs-vital-controls">
            ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pvActuel',-1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">−</button>`:''}
            <span class="cs-vital-val" id="pv-val" style="color:${pvColor}">${pvCur}</span>
            ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pvActuel',1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">+</button>`:''}
          </div>
          <div class="cs-bar-bg cs-bar-hp"><div class="cs-bar-fill cs-bar-hp-fill ${pvPct>50?'high':pvPct>25?'mid':''}" id="pv-bar" style="width:${pvPct}%"></div></div>
          <div class="cs-vital-sub">max <span id="pv-max">${pvMax}</span></div>
        </div>
        <div class="cs-vital-block">
          <div class="cs-vital-label">🔵 PM</div>
          <div class="cs-vital-controls">
            ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pmActuel',-1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">−</button>`:''}
            <span class="cs-vital-val" id="pm-val" style="color:var(--blue)">${pmCur}</span>
            ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pmActuel',1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">+</button>`:''}
          </div>
          <div class="cs-bar-bg cs-bar-pm"><div class="cs-bar-fill cs-bar-pm-fill" id="pm-bar" style="width:${pmPct}%"></div></div>
          <div class="cs-vital-sub">max <span id="pm-max">${pmMax}</span></div>
        </div>
      </div>

      <!-- CA / Vit / Deck -->
      <div class="cs-secondary-row">
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🛡️ CA</span>
          <span class="cs-chip-val">${calcCA(c)}</span>
        </div>
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🏃 Vit</span>
          <span class="cs-chip-val">${calcVitesse(c)}m</span>
        </div>
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🃏 Deck</span>
          <span class="cs-chip-val">${deckActifs}/${deckMax}</span>
        </div>
      </div>

    </div><!-- /cs-identity-panel -->

    <!-- BLOC DROIT : Caractéristiques compactes -->
    <div class="cs-carac-panel">
      <div class="cs-carac-panel-title">
        Caractéristiques
        ${canEdit?'<span class="cs-hint">cliquer pour modifier</span>':''}
      </div>
      <div class="cs-carac-grid">
        ${caracHtml}
      </div>
      <div class="cs-base-row">
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">PV base</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Modifier"`:''}
          >${c.pvBase||10}</div>
          <div class="cs-base-chip-sub">→ max ${pvMax}</div>
        </div>
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">PM base</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Modifier"`:''}
          >${c.pmBase||10}</div>
          <div class="cs-base-chip-sub">→ max ${pmMax}</div>
        </div>
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">Palier XP</span>
          <div class="cs-base-chip-val">${calcPalier(c.niveau||1)}</div>
          <div class="cs-base-chip-sub">100 × niv²</div>
        </div>
      </div>
    </div><!-- /cs-carac-panel -->

  </div><!-- /cs-top -->

  <!-- ═══ ONGLETS + CONTENU ═══ -->
  <div class="cs-right-col">
    <div class="cs-tabs" id="char-tabs">
      ${TABS.map(tab => {
        // Onglet "···" est actif si on est sur un onglet secondaire
        const isActive = tab.id === 'plus'
          ? isSecondaryTab
          : currentTab === tab.id;
        return `<button class="cs-tab ${isActive?'active':''}"
          onclick="${tab.id === 'plus' ? `window._toggleSecondaryTabs(this)` : `showCharTab('${tab.id}',this)`}"
          data-tab="${tab.id}">${tab.label}</button>`;
      }).join('')}
    </div>

    <!-- Sous-menu onglets secondaires (compte + notes + maitrises) -->
    <div id="cs-secondary-tabs" style="display:${isSecondaryTab?'flex':'none'};
      gap:.35rem;padding:.4rem 0 .1rem;border-bottom:1px solid var(--border);margin-bottom:.15rem">
      ${['compte','notes','maitrises'].map(tab => `
      <button class="cs-tab ${currentTab===tab?'active':''}" style="font-size:.72rem;min-height:30px;padding:.3rem .65rem"
        onclick="showCharTab('${tab}',this)">
        ${tab==='compte'?'💰 Compte':tab==='notes'?'📝 Notes':'⚔️ Maîtrises'}
      </button>`).join('')}
    </div>

    <div id="char-tab-content" class="cs-tab-body"></div>
  </div>

</div>`;

  _renderTab(currentTab, c, canEdit);

  // Toggle sous-menu secondaire
  window._toggleSecondaryTabs = (btn) => {
    const panel = document.getElementById('cs-secondary-tabs');
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible && !['compte','notes','maitrises'].includes(window._currentCharTab)) {
      showCharTab('compte', document.querySelector('#cs-secondary-tabs .cs-tab'));
    }
  };
}

function _renderTab(tab, c, canEdit) {
  const area = document.getElementById('char-tab-content');
  if (!area) return;
  const renders = {
    combat:     ()=>renderCharEquip(c,canEdit),
    carac:      ()=>renderCharEquip(c,canEdit),
    sorts:      ()=>renderCharDeck(c,canEdit),
    inventaire: ()=>renderCharInventaire(c,canEdit),
    quetes:     ()=>renderCharQuetes(c,canEdit),
    compte:     ()=>renderCharCompte(c,canEdit),
    notes:      ()=>renderCharNotes(c,canEdit),
    maitrises:  ()=>renderCharMaitrises(c,canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
}

function showCharTab(tab, el) {
  // Gérer les onglets secondaires (compte/notes) — activer le ··· comme actif
  const isSecondary = ['compte','notes','maitrises'].includes(tab);
  document.querySelectorAll('#char-tabs .cs-tab').forEach(t => {
    t.classList.remove('active');
    if (isSecondary && t.dataset.tab === 'plus') t.classList.add('active');
  });
  if (!isSecondary && el) el.classList.add('active');

  window._currentCharTab = tab;
  // Afficher le sous-menu secondaire si nécessaire
  const secondary = document.getElementById('cs-secondary-tabs');
  if (secondary) secondary.style.display = isSecondary ? 'flex' : 'none';

  _renderTab(tab, window._currentChar, window._canEditChar);
}

// ══════════════════════════════════════════════
// INLINE EDIT HELPERS — clic direct sur la valeur
// ══════════════════════════════════════════════
function inlineEditText(charId, field, el) {
  const cur = el.textContent.trim();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = cur;
  input.className = 'cs-inline-input';
  input.style.cssText = 'width:100%;font-size:inherit;font-weight:inherit;font-family:inherit;color:inherit;';

  const save = async () => {
    const val = input.value.trim() || cur;
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c || val === cur) { el.textContent = cur; input.replaceWith(el); return; }
    c[field] = val;
    await updateInCol('characters', charId, {[field]: val});
    el.textContent = val;
    input.replaceWith(el);
    // Update pill if name changed
    if (field === 'nom') {
      document.querySelectorAll('#char-pills .char-pill.active').forEach(p=>p.textContent=val);
    }
    showNotif('Mis à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.value=cur;input.blur();} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

function inlineEditNum(charId, field, el, min=0, max=99999) {
  const cur = el.textContent.replace(/[^\d-]/g,'').trim();
  const input = document.createElement('input');
  input.type = 'number';
  input.value = cur;
  input.min = min; input.max = max;
  input.className = 'cs-inline-input cs-inline-num';
  input.style.cssText += ';-moz-appearance:textfield;';

  const save = async () => {
    const val = Math.max(min, Math.min(max, parseInt(input.value)||0));
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) { input.replaceWith(el); return; }
    c[field] = val;
    await updateInCol('characters', charId, {[field]: val});
    el.textContent = field==='niveau' ? `Niv. ${val}` : field==='or' ? `💰 ${val} or` : val;
    input.replaceWith(el);
    // Recompute if niveau changed (affects pvMax, pmMax, deck)
    if (['niveau','pvBase','pmBase'].includes(field)) renderCharSheet(c, window._currentCharTab);
    else showNotif('Mis à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.replaceWith(el);} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

// Inline stat edit — click anywhere on the carac card
function inlineEditStatFromCard(event, charId, statKey, cardEl) {
  if (!cardEl) return;

  if (event?.target?.closest('input, button, textarea, select, a')) return;
  if (cardEl.querySelector('input.cs-inline-input')) return;

  const baseEl = cardEl.querySelector('.js-stat-base');
  if (!baseEl) return;

  inlineEditStat(charId, statKey, baseEl);
}

// Inline stat edit — click on carac box value
function inlineEditStat(charId, statKey, el) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  const cur = parseInt((c?.stats||{})[statKey]) || 8;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = cur;
  input.min = 1; input.max = 30;
  input.className = 'cs-inline-input cs-inline-num';
  input.style.cssText = 'width:52px;font-size:1.3rem;font-weight:700;text-align:center;-moz-appearance:textfield;';

  const save = async () => {
    const val = Math.max(1, Math.min(30, parseInt(input.value)||cur));
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) { input.replaceWith(el); return; }
    c.stats = c.stats||{};
    c.stats[statKey] = val;
    await updateInCol('characters', charId, {stats: c.stats});
    input.replaceWith(el);
    renderCharSheet(c, window._currentCharTab);
    showNotif('Stat mise à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.replaceWith(el);} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

// ══════════════════════════════════════════════
// TAB : CARACTÉRISTIQUES
// ══════════════════════════════════════════════
function renderCharCarac(c, canEdit) {
  const STATS_TAB = [
    {key:'force',label:'Force',abbr:'Fo'},
    {key:'dexterite',label:'Dextérité',abbr:'Dex'},
    {key:'constitution',label:'Constitution',abbr:'Co'},
    {key:'intelligence',label:'Intelligence',abbr:'Int'},
    {key:'sagesse',label:'Sagesse',abbr:'Sag'},
    {key:'charisme',label:'Charisme',abbr:'Cha'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  let html = `<div class="cs-section">
    <div class="cs-section-title">📊 Caractéristiques
      ${canEdit?'<span class="cs-hint">cliquer sur la valeur de base pour modifier</span>':''}
    </div>
    <div style="display:grid;gap:.5rem">
      <div style="display:grid;grid-template-columns:minmax(120px,1.3fr) repeat(4,minmax(62px,.7fr));gap:.5rem;align-items:center;padding:0 .75rem;color:var(--text-dim);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em">
        <span>Stat</span>
        <span style="text-align:center">Base</span>
        <span style="text-align:center">Équip.</span>
        <span style="text-align:center">Total</span>
        <span style="text-align:center">Mod</span>
      </div>`;

  STATS_TAB.forEach(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    const bonusStr = bonus > 0 ? `+${bonus}` : String(bonus);
    const modClass = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    html += `<div style="display:grid;grid-template-columns:minmax(120px,1.3fr) repeat(4,minmax(62px,.7fr));gap:.5rem;align-items:center;padding:.75rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated)">
      <div>
        <div style="font-weight:700;color:var(--text)">${st.label}</div>
        <div style="font-size:.72rem;color:var(--text-dim)">${st.abbr}</div>
      </div>
      <div style="text-align:center">
        <span class="${canEdit?'cs-editable':''}"
              ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Modifier la base"`:''}
              style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);font-weight:700;color:var(--text)">
          ${base}
        </span>
      </div>
      <div style="text-align:center">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:${bonus ? 'rgba(79,140,255,.10)' : 'var(--bg-card)'};font-weight:700;color:${bonus ? '#7fb0ff' : 'var(--text-dim)'}">
          ${bonusStr}
        </span>
      </div>
      <div style="text-align:center">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);font-weight:800;color:var(--text)">
          ${total}
        </span>
      </div>
      <div style="text-align:center">
        <span class="cs-carac-detail-mod ${modClass}" style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px">
          ${modStr(m)}
        </span>
      </div>
    </div>`;
  });
  html += `</div>
    <div style="margin-top:.65rem;font-size:.76rem;color:var(--text-dim)">
      Total = Base + bonus d'équipement. Le modificateur est calculé à partir du total.
    </div>
  </div>`;

  html += `<div class="cs-section">
    <div class="cs-section-title">⚙️ Base PV & PM
      ${canEdit?'<span class="cs-hint">cliquer pour modifier — les max sont recalculés</span>':''}
    </div>
    <div class="cs-base-grid">
      <div class="cs-base-card">
        <div class="cs-base-label">PV Base (niv.1)</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Cliquer pour modifier"`:''}>
          ${c.pvBase||10}
        </div>
        <div class="cs-base-formula">PV max actuel : ${calcPVMax(c)}</div>
        <div class="cs-base-sub">PV max = Base + Mod(Co) × (Niv−1)</div>
      </div>
      <div class="cs-base-card">
        <div class="cs-base-label">PM Base (niv.1)</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Cliquer pour modifier"`:''}>
          ${c.pmBase||10}
        </div>
        <div class="cs-base-formula">PM max actuel : ${calcPMMax(c)}</div>
        <div class="cs-base-sub">PM max = Base + Mod(Sa) × (Niv−1)</div>
      </div>
      <div class="cs-base-card">
        <div class="cs-base-label">Palier XP suivant</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','palier',this,1,99999)" title="Cliquer pour modifier"`:''}>
          ${c.palier||100}
        </div>
        <div class="cs-base-sub">XP actuel : ${c.exp||0}</div>
      </div>
    </div>
  </div>`;

  if (c.setBonusActif) {
    html += `<div class="cs-section">
      <div class="cs-section-title">✨ Bonus de Set</div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-style:italic">${c.setBonusActif}</div>
    </div>`;
  }
  return html;
}

function _renderInventaireBoutique(char) {
  const invRaw = (char.inventaire || []).map((item, i) => ({ item, i })).filter(({ item }) => item.source === 'boutique');
  if (!invRaw.length) return '';

  const RARETE_LABELS = ['', 'Commun', 'Peu commun', 'Rare', 'Très rare'];
  const RARETE_COLORS = ['', '#9ca3af', '#4ade80', '#60a5fa', '#c084fc'];
  const canEdit = window._canEditChar ?? STATE.isAdmin;

  // ── Regrouper par itemId + nom ──────────────────────────────────────────
  const grouped = [];
  invRaw.forEach(({ item, i }) => {
    const key = (item.itemId||'') + '||' + (item.nom||'');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte)||1;
      existing.indices.push(i);
    } else {
      grouped.push({ key, item: {...item}, qte: parseInt(item.qte)||1, indices: [i] });
    }
  });

  const cards = grouped.map(g => {
    const item = g.item;
    const indicesB64 = btoa(JSON.stringify(g.indices));
    const rareteN  = parseInt(item.rarete) || 0;
    const rareteC  = RARETE_COLORS[rareteN] || '#555';
    const rareteL  = RARETE_LABELS[rareteN] || '';
    const prixAchat = parseFloat(item.prixAchat) || 0;
    const prixVente = parseFloat(item.prixVente) || Math.round(prixAchat * 0.6);

    const infos = [];
    const bonusText = formatItemBonusText(item);
    if (item.format)      infos.push({ label: 'Format',    val: item.format });
    if (item.slotArmure)  infos.push({ label: 'Slot',      val: item.slotArmure });
    if (item.slotBijou)   infos.push({ label: 'Slot',      val: item.slotBijou });
    if (item.typeArmure)  infos.push({ label: 'Type',      val: item.typeArmure });
    if (item.degats)      infos.push({ label: '⚔️ Dégâts',  val: `${item.degats}${item.degatsStat ? ` + ${statShort(item.degatsStat)}` : ''}`,  color: '#ff6b6b' });
    if (item.toucherStat) infos.push({ label: 'Toucher',    val: statShort(item.toucherStat), color: '#e8b84b' });
    else if (item.toucher) infos.push({ label: 'Toucher',   val: item.toucher, color: '#e8b84b' });
    if (item.ca || item.ca === 0) infos.push({ label: '🛡️ CA', val: item.ca });
    if (bonusText)        infos.push({ label: 'Stats',      val: bonusText,   color: '#4f8cff' });
    _getTraits(item).forEach(t => infos.push({ label: 'Trait', val: t, color: '#b47fff', italic: true }));
    if (item.type)        infos.push({ label: 'Type',       val: item.type });
    if (item.effet)       infos.push({ label: 'Effet',      val: item.effet });
    if (item.description) infos.push({ label: 'Desc.',      val: item.description, muted: true });

    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      padding:.85rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-left:3px solid ${rareteC}">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600;line-height:1.2">
            ${item.nom || '?'}
          </div>
          ${rareteL ? `<div style="font-size:.68rem;color:${rareteC};margin-top:1px">${'★'.repeat(rareteN)+'☆'.repeat(4-rareteN)} ${rareteL}</div>` : ''}
        </div>
        <span style="font-size:.72rem;background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:999px;padding:2px 8px;color:var(--text-muted);flex-shrink:0">×${g.qte}</span>
      </div>

      ${infos.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem .75rem">
        ${infos.map(info => `
          <div style="display:flex;align-items:baseline;gap:.3rem;font-size:.78rem">
            <span style="color:var(--text-dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.5px">${info.label}</span>
            <span style="color:${info.color||'var(--text-muted)'};${info.italic?'font-style:italic':''};font-weight:${info.color?'600':'400'}">${info.val}</span>
          </div>`).join('')}
      </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.25rem;
        padding-top:.5rem;border-top:1px solid var(--border)">
        <div style="font-size:.72rem;color:var(--text-dim)">
          <span title="Prix d'achat">💰 ${prixAchat} or</span>
          <span style="margin:0 .3rem;opacity:.4">·</span>
          <span title="Prix de revente" style="color:var(--gold)">🔄 ${prixVente} or/u</span>
        </div>
        ${canEdit ? `
        <div style="display:flex;gap:.4rem;align-items:center">
          <button onclick="openSellInvModal('${char.id}','${indicesB64}',${prixVente},'${item.nom||''}')"
            style="background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:var(--gold);transition:all .15s"
            onmouseover="this.style.background='rgba(232,184,75,.15)'"
            onmouseout="this.style.background='rgba(232,184,75,.08)'">
            🔄 Vendre
          </button>
          ${(STATE.characters||[]).filter(x=>x.id!==char.id).length ? `
          <button onclick="openSendInvModal('${char.id}','${indicesB64}','${item.nom||''}')"
            style="background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:#4f8cff;transition:all .15s"
            onmouseover="this.style.background='rgba(79,140,255,.15)'"
            onmouseout="this.style.background='rgba(79,140,255,.08)'"
            title="Envoyer">
            📤 Envoyer
          </button>` : ''}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div style="margin-bottom:1.5rem">
    <div style="font-size:.72rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;
      margin-bottom:.75rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)">
      🛒 Inventaire Boutique
      <span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:999px;padding:1px 7px;margin-left:.4rem;color:var(--text-dim)">${grouped.reduce((s,g)=>s+g.qte,0)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:.6rem">${cards}</div>
  </div>`;
}

// ══════════════════════════════════════════════
// TAB : COMBAT
// ══════════════════════════════════════════════
function renderCharEquip(c, canEdit) {
  const equip = c.equipement||{};
  const weaponSlots = ['Main principale','Main secondaire'];
  const armorSlots = ['Tête','Torse','Bottes','Amulette','Anneau','Objet magique'];
  const armorSet = getArmorSetData(c);
  const armorSetChipText = getArmorSetChipText(armorSet);
  const s = c.stats||{}; const sb = c.statsBonus||{};
  const fo = (s.force||10)+(sb.force||0);
  const dex = (s.dexterite||8)+(sb.dexterite||0);

  let html = '';

  html += `<div class="cs-section">
    <div class="cs-section-title">⚔️ Armes
      ${canEdit?'<span class="cs-hint">cliquer sur ✏️ pour modifier</span>':''}
    </div>`;

  weaponSlots.forEach(slot => {
    const item    = equip[slot]||{};
    const statKey = item.statAttaque==='dexterite' ? 'dexterite'
                  : item.statAttaque==='intelligence' ? 'intelligence'
                  : 'force';
    const statVal = (s[statKey]||8)+(sb[statKey]||0);
    const mod     = Math.floor((Math.min(22,statVal)-10)/2);
    const modS    = modStr(mod);

    const toucherDisplay = getToucherDisplay(c, item, statKey);
    const degatsDisplay = getDegatsDisplay(c, item, statKey);
    const bonusDisplay = formatItemBonusText(item);

    // Badge format
    const formatBadge = item.format
      ? `<span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
           border-radius:6px;padding:1px 6px;color:var(--text-dim)">${item.format}</span>`
      : '';

    html += `<div class="cs-weapon-row">
      <div class="cs-weapon-slot-label">${slot}</div>
      <div class="cs-weapon-body">
        ${item.nom ? `
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem">
            <div class="cs-weapon-name">${item.nom}</div>
            ${formatBadge}
          </div>
          ${_getTraits(item).map(t => `<div class="cs-weapon-trait">${t}</div>`).join('')}
          <div class="cs-weapon-stats">
            <span class="cs-ws">
              <span class="cs-ws-label">Toucher</span>
              <span class="cs-ws-val gold">${toucherDisplay}</span>
            </span>
            <span class="cs-ws">
              <span class="cs-ws-label">Dégâts</span>
              <span class="cs-ws-val red">${degatsDisplay}</span>
            </span>
            ${bonusDisplay?`<span class="cs-ws">
              <span class="cs-ws-label">Bonus</span>
              <span class="cs-ws-val" style="color:#4f8cff">${bonusDisplay}</span>
            </span>`:''}
            ${item.portee?`<span class="cs-ws">
              <span class="cs-ws-label">Portée</span>
              <span class="cs-ws-val">${item.portee}</span>
            </span>`:''}
            ${item.particularite?`<span class="cs-ws cs-ws-wide">
              <span class="cs-ws-label">Particularité</span>
              <span class="cs-ws-val muted">${item.particularite}</span>
            </span>`:''}
          </div>`
        : `<div class="cs-weapon-empty">— Vide —</div>`}
      </div>
      ${canEdit?`<button class="cs-equip-btn" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
    </div>`;
  });

  html += `<div class="cs-combat-info">
    🎲 Critique : Maximum des dés + relance les dés de dégâts.
  </div>`;

  // ── Effets actifs du set d'armure ─────────────────────────────────────────
  if (armorSet.isActive) {
    const mod   = armorSet.modifiers;
    const tone  = armorSet.activeEffect?.tone || 'neutral';
    const TONE_COLORS = { light:'#22c38e', medium:'#4f8cff', heavy:'#e8b84b', neutral:'var(--text-dim)' };
    const col   = TONE_COLORS[tone] || 'var(--text-dim)';

    // Effets actifs (ceux qui ont une valeur non nulle)
    const effects = [];
    if (mod.spellPmDelta < 0)   effects.push({ icon:'🧙', text:`Sorts −${Math.abs(mod.spellPmDelta)} PM`, desc:'Coût réduit' });
    if (mod.toucherBonus > 0)   effects.push({ icon:'🎯', text:`Toucher +${mod.toucherBonus}`, desc:'Sur tous les jets de toucher' });
    if (mod.damageReduction > 0)effects.push({ icon:'🛡️', text:`Réduction ${mod.damageReduction}`, desc:'Dégâts reçus réduits' });

    // Bouclier (calculé séparément car pas dans le set)
    const mainS   = (c?.equipement||{})['Main secondaire'];
    const stypeS  = (mainS?.sousType || mainS?.nom || '').toLowerCase();
    if (stypeS.includes('bouclier') || stypeS.includes('shield')) {
      effects.push({ icon:'🛡️', text:'CA +2', desc:'Bonus bouclier' });
    }

    html += `<div style="background:${col}0c;border:1px solid ${col}33;border-radius:10px;
      padding:.65rem .85rem;margin-top:.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
        <span style="font-size:.78rem;font-weight:700;color:${col}">${armorSetChipText}</span>
        <span style="font-size:.65rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Set complet</span>
      </div>
      ${effects.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.4rem">
        ${effects.map(e => `
        <div style="display:flex;align-items:center;gap:.35rem;padding:.25rem .6rem;
          background:${col}12;border-radius:6px;border:1px solid ${col}28">
          <span style="font-size:.85rem">${e.icon}</span>
          <span style="font-size:.78rem;font-weight:700;color:${col}">${e.text}</span>
          <span style="font-size:.67rem;color:var(--text-dim)">${e.desc}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
  } else {
    // Pas de set complet — afficher ce qui est équipé partiellement
    const mainS  = (c?.equipement||{})['Main secondaire'];
    const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();
    if (stypeS.includes('bouclier') || stypeS.includes('shield')) {
      html += `<div style="display:inline-flex;align-items:center;gap:.4rem;margin-top:.4rem;
        padding:.25rem .65rem;background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.25);
        border-radius:6px;font-size:.75rem">
        <span>🛡️</span>
        <span style="color:#4f8cff;font-weight:700">CA +2</span>
        <span style="color:var(--text-dim)">Bouclier</span>
      </div>`;
    }
  }

  // ── Style de combat actif ─────────────────────────────────────────────────
  const styleId = `cs-combat-style-${c.id||'x'}`;
  html += `<div id="${styleId}" style="margin-top:.6rem"></div>`;
  setTimeout(async () => {
    const el = document.getElementById(styleId);
    if (!el) return;
    const styles = await loadCombatStyles();
    const style  = detectCombatStyle(c, styles);
    if (!style) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="background:${style.couleur}11;border:1px solid ${style.couleur}44;
        border-left:3px solid ${style.couleur};border-radius:10px;
        padding:.65rem .9rem;display:flex;flex-direction:column;gap:.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <span style="font-weight:700;font-size:.84rem;color:${style.couleur}">${style.label}</span>
          <span style="font-size:.65rem;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase">Style de combat</span>
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);line-height:1.55">${style.description}</div>
      </div>
      ${STATE.isAdmin ? `<button onclick="openCombatStylesAdmin()" class="btn btn-outline btn-sm"
        style="margin-top:.35rem;font-size:.7rem;width:100%">⚙️ Gérer les styles</button>` : ''}
    `;
  }, 0);

  html += `</div>`;

  // Actions
  html += `<div class="cs-section">
    <div class="cs-section-title">📋 Actions</div>
    <div class="cs-actions-grid">
      ${[
        ['⚡','Action','Frappe / Sort / Compétence'],
        ['🏃','Action','Courir (×2 vitesse)'],
        ['🛡️','Action','Se désengager'],
        ['👁️','Action','Se cacher'],
        ['🤝','Action','Aider (retire état allié)'],
        ['🔄','Action','Changer d\'arme'],
      ].map(([icon,type,desc])=>`
        <div class="cs-action-chip">
          <span class="cs-action-icon">${icon}</span>
          <div><div class="cs-action-type">${type}</div><div class="cs-action-desc">${desc}</div></div>
        </div>`).join('')}
    </div>
    <div class="cs-action-footer">1 Action + 1 Action Bonus + 1 Réaction + Déplacement par tour</div>
  </div>`;

  // Armures
  html += `<div class="cs-section">
    <div class="cs-section-title">🛡️ Armures & Accessoires</div>
    <div class="cs-armor-grid">`;
  armorSlots.forEach(slot => {
    const item = equip[slot]||{};
    const bonuses = ['fo','dex','in','sa','co','ch','ca'].filter(k=>item[k]);
    const armorTypeMeta = getArmorTypeMeta(item.typeArmure || '');
    html += `<div class="cs-armor-card ${item.nom?'equipped':''}">
      <div class="cs-armor-slot">${slot}</div>
      <div class="cs-armor-name">${item.nom||'—'}</div>
      ${armorTypeMeta.label ? `<div class="cs-armor-type cs-armor-type--${armorTypeMeta.tone}" data-armor-tone="${armorTypeMeta.tone}">${armorTypeMeta.label}</div>` : ''}
      ${_getTraits(item).map(t => `<div class="cs-armor-trait">${t}</div>`).join('')}
      ${bonuses.length?`<div class="cs-armor-bonuses">${bonuses.map(k=>`<span class="badge badge-gold" style="font-size:0.6rem">${k.toUpperCase()} ${item[k]>0?'+'+item[k]:item[k]}</span>`).join('')}</div>`:''}
      ${canEdit?`<button class="cs-equip-btn-sm" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
    </div>`;
  });

  const totals = {fo:0,dex:0,in:0,sa:0,co:0,ch:0,ca:0};
  Object.values(equip).forEach(it=>Object.keys(totals).forEach(k=>{totals[k]+=(it[k]||0);}));
  const totalStr = Object.entries(totals).filter(([,v])=>v!==0).map(([k,v])=>`${k.toUpperCase()} ${v>0?'+'+v:v}`).join(' · ');
  if (totalStr) html += `<div class="cs-bonus-total">Bonus total : ${totalStr}</div>`;
  html += `</div></div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : SORTS
// ══════════════════════════════════════════════
// ── Drag and Drop sorts ──────────────────────
let _dragSortIdx = null;

function sortDragStart(e, idx) {
  _dragSortIdx = idx;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}
function sortDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cs-sort-row').forEach(el => {
    el.classList.remove('cs-drop-before', 'cs-drop-after');
  });
  const rect = e.currentTarget.getBoundingClientRect();
  const mid  = rect.top + rect.height / 2;
  if (e.clientY < mid) {
    e.currentTarget.classList.add('cs-drop-before');
  } else {
    e.currentTarget.classList.add('cs-drop-after');
  }
}
function sortDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.cs-sort-row').forEach(el => {
    el.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  });
}
async function sortDrop(e, toIdx) {
  e.preventDefault();
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const insertAfter = e.clientY >= rect.top + rect.height / 2;
  const actualIdx   = insertAfter ? toIdx + 1 : toIdx;
  card.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  document.querySelectorAll('.cs-sort-row').forEach(el =>
    el.classList.remove('cs-drop-before', 'cs-drop-after'));
  const fromIdx = _dragSortIdx;
  _dragSortIdx = null;
  if (fromIdx === null) return;
  const c = STATE.activeChar; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  if (fromIdx === actualIdx || fromIdx === actualIdx - 1) return;
  const [moved] = sorts.splice(fromIdx, 1);
  const insertAt = actualIdx > fromIdx ? actualIdx - 1 : actualIdx;
  sorts.splice(insertAt, 0, moved);
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, {deck_sorts: sorts});
  renderCharSheet(c, 'sorts');
}


// ── Helpers calcul sorts ─────────────────────────────────────────────────────

/**
 * TYPES d'un sort : tableau ['offensif','defensif','utilitaire']
 * Stocké explicitement dans s.types[]
 * Fallback legacy : typeSoin → defensif, noyau → offensif, sinon utilitaire
 */
function _getSortTypes(s) {
  if (Array.isArray(s.types) && s.types.length) return s.types;
  // Legacy
  if (s.typeSoin) return ['defensif'];
  if (s.noyau)   return ['offensif'];
  return ['utilitaire'];
}

/** Type d'action : 'action' | 'action_bonus' | 'reaction'
 *  + concentration : boolean
 *  Réaction et Concentration = 100% déterminées par les runes.
 *  Action Bonus = rune Enchantement. Override manuel possible pour Action/Action Bonus uniquement.
 */
function _getSortAction(s) {
  const runes = s.runes || [];
  const action        = runes.includes('Réaction')     ? 'reaction'
                      : runes.includes('Enchantement') ? 'action_bonus'
                      : s.actionOverride               || 'action';
  const concentration = runes.includes('Concentration');
  return { action, concentration };
}

/**
 * Dégâts effectifs d'un sort offensif.
 * - Base = dégâts de l'arme principale si degats vide
 * - Chaque rune Puissance : +1 dé
 * - Chaînage PP : totalPP > 1 → +(totalPP-1)*2 bonus fixe
 */
function _calcSortDegats(s, c) {
  const equip   = c?.equipement || {};
  const mainP   = equip['Main principale'];
  const armeDeg = mainP?.degats || '1d6';

  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;

  const runes   = s.runes || [];
  const nbPuiss = runes.filter(r => r === 'Puissance').length;
  const nbProt  = runes.filter(r => r === 'Protection').length;
  const totalPP = nbPuiss + nbProt;
  const bonusVal = totalPP > 1 ? (totalPP - 1) * 2 : 0;

  if (totalPP === 0 && bonusVal === 0) return base;

  const match = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (match) {
    let result = `${parseInt(match[1]) + totalPP}${match[2]}${match[3]}`;
    if (bonusVal > 0) result += ` +${bonusVal}`;
    return result;
  }
  let result = base;
  if (totalPP > 0) result += ` +${totalPP}d6`;
  if (bonusVal > 0) result += ` +${bonusVal}`;
  return result;
}

/**
 * Soin effectif.
 * - Base 1d4 + Protection chaîné : +1d4 par rune, +2 soin fixe par paire (chaînage)
 * - Format texte libre (ex: "moitié des dégâts") → affiché tel quel, rien ajouté
 */
function _calcSortSoin(s) {
  const runes  = s.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const chainSoin = nbProt > 1 ? nbProt - 1 : 0;
  const base   = (s.soin || '').trim();

  const buildDefault = (diceCount) => {
    let r = `${diceCount}d4`;
    if (chainSoin > 0) r += ` +${chainSoin * 2}`;
    return r;
  };

  if (!base || base.toLowerCase() === '= base') return buildDefault(1 + nbProt);
  if (nbProt > 0) {
    const match = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (match) {
      // Format XdY reconnu → on ajoute les dés Protection + chaînage
      let r = `${parseInt(match[1]) + nbProt}${match[2]}${match[3]}`;
      if (chainSoin > 0) r += ` +${chainSoin * 2}`;
      return r;
    }
    // Texte libre → on n'ajoute rien, on respecte ce qui est écrit
    return base;
  }
  return base;
}

/** Mode de la rune Protection : 'soin' | 'ca' — stocké dans s.protectionMode */
function _getSortProtectionMode(s) {
  return s?.protectionMode || 'ca'; // défaut CA si non précisé
}

/** Valeur CA libre (rune Protection mode CA) — saisie directement par le joueur */
function _getSortCA(s) {
  return (s?.ca || '').trim() || 'CA +2 (2 tours)';
}

/**
 * Nombre de cibles — DISPERSION avec chaînage corrigé :
 * N runes Dispersion → (N+1) cibles + (N-1) bonus chaînage = 2N cibles
 * Ex: 1 rune → 2 cibles, 2 runes → 4 cibles, 3 runes → 6 cibles
 */
function _calcSortCibles(s) {
  const n = (s.runes||[]).filter(r => r === 'Dispersion').length;
  if (n === 0) return 1;
  return n + 1 + (n - 1); // = 2N
}

/** Durée en tours (Durée : +2 tours par rune, chaînage : +1 supplémentaire par rune après la 1ère) */
function _calcSortDuree(s) {
  const runes = s.runes || [];
  const nbDur = runes.filter(r => r === 'Durée').length;
  if (nbDur === 0) return null;
  // 1 rune → +2, 2 runes → +2+3=+5, 3 runes → +2+3+4...
  let total = 0;
  for (let i = 0; i < nbDur; i++) total += 2 + i;
  return total;
}

/** Zone d'amplification (Amplification : +3m, chaînage : +2m par rune après la 1ère) */
function _calcSortZone(s) {
  const runes = s.runes || [];
  const nbAmp = runes.filter(r => r === 'Amplification').length;
  if (nbAmp === 0) return null;
  // 1 rune → +3m, 2 runes → +3+2=+5m total (zone 4×4), etc.
  let total = 3;
  for (let i = 1; i < nbAmp; i++) total += 2;
  return total;
}

/** Lacération : réduction CA cible */
function _calcLaceration(s) {
  const nb = (s.runes||[]).filter(r => r === 'Lacération').length;
  if (!nb) return null;
  // Chaînage : -1 CA par rune
  return { reduction: nb, max: 2, maxElite: 4 };
}

/** Chance : réduction RC */
function _calcChance(s) {
  const nb = (s.runes||[]).filter(r => r === 'Chance').length;
  if (!nb) return null;
  // RC de base 20, chaînage -1 par rune → RC = 20 - nb
  return { rc: 20 - nb };
}

/**
 * Génère le résumé textuel complet des effets d'un sort
 * sous forme de tableau de lignes {icon, label, detail}
 */
function _buildSortResume(s, c) {
  const lines = [];
  const runes  = s.runes || [];
  const types  = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);

  // Action
  const actionLabels = { action:'⚡ Action', action_bonus:'✴️ Action Bonus', reaction:'🔄 Réaction' };
  let actionStr = actionLabels[action] || '⚡ Action';
  if (concentration) actionStr += ' + 🧠 Concentration';
  lines.push({ icon: '', label: actionStr, detail: concentration ? 'JS Sagesse DD 11 si dégâts reçus · jusqu\'à 10 tours' : '' });

  // Dégâts (si offensif)
  if (types.includes('offensif')) {
    const equip  = c?.equipement || {};
    const mainP  = equip['Main principale'];
    const statKey = mainP?.statAttaque || mainP?.toucherStat || 'force';
    const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
    const mod     = Math.floor((Math.min(22, statVal) - 10) / 2);
    const modStr  = mod >= 0 ? `+${mod}` : `${mod}`;
    const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int' }[statKey] || statKey.slice(0,3);
    const deg = _calcSortDegats(s, c);
    lines.push({ icon:'⚔️', label:`${deg} ${modStr} ${statLbl}`, detail:'Dégâts' });
  }

  // Protection : Soin ou CA selon protectionMode
  const hasDefensif = types.includes('defensif');
  const nbProt = runes.filter(r => r === 'Protection').length;
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (mode === 'soin') {
      lines.push({ icon:'💚', label:_calcSortSoin(s), detail:`Soin · chaîné : +${nbProt}d4${nbProt > 1 ? ` +${(nbProt-1)*2}` : ''}` });
    } else {
      lines.push({ icon:'🛡️', label:_getSortCA(s), detail:'' });
    }
  } else if (hasDefensif) {
    lines.push({ icon:'🛡️', label:'Effet défensif', detail:'Décris l\'effet ci-dessous' });
  }

  // Cibles
  const nbCibles = _calcSortCibles(s);
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  if (nbCibles > 1) {
    lines.push({ icon:'🎯', label:`${nbCibles} cibles`, detail: nbDisp > 1 ? `${nbDisp} runes Dispersion (chaîné : ×2)` : '1 rune Dispersion' });
  }

  // Zone (Amplification)
  const zone = _calcSortZone(s);
  if (zone) {
    const nbAmp = runes.filter(r => r === 'Amplification').length;
    lines.push({ icon:'📐', label:`Zone +${zone}m`, detail: nbAmp > 1 ? `${nbAmp} runes (chaîné : +2m/rune supp.)` : '1 rune Amplification' });
  }

  // Durée
  const duree = _calcSortDuree(s);
  if (duree) {
    const nbDur = runes.filter(r => r === 'Durée').length;
    lines.push({ icon:'⏱️', label:`+${duree} tours`, detail: nbDur > 1 ? `Chaîné : +${nbDur} tours supp.` : 'Durée de l\'effet' });
  }

  // Lacération
  const lac = _calcLaceration(s);
  if (lac) lines.push({ icon:'🩸', label:`CA cible −${lac.reduction}`, detail:`Max −${lac.max} (−${lac.maxElite} Élites/Boss)` });

  // Chance
  const chc = _calcChance(s);
  if (chc) lines.push({ icon:'🍀', label:`RC ${chc.rc}–20`, detail:'Critique aussi max · chaîné : RC−1/rune' });

  // Enchantement / Affliction
  if (runes.includes('Enchantement')) lines.push({ icon:'✨', label:'Enchantement allié', detail:'Applique l\'élément sur équipement allié · 2 tours · Action Bonus' });
  if (runes.includes('Affliction'))   lines.push({ icon:'💀', label:'Affliction ennemi', detail:'Applique l\'élément + état sur équipement ennemi · 2 tours · Action Bonus' });

  // Invocation
  if (runes.includes('Invocation')) lines.push({ icon:'🐾', label:'Invocation', detail:'Créature liée · 10 PV · CA 10' });

  // Concentration (rappel JS si pas déjà mentionné)
  if (concentration && action !== 'action') {
    lines.push({ icon:'🧠', label:'Concentration', detail:'JS Sagesse DD 11 si dégâts reçus · jusqu\'à 10 tours' });
  }

  return lines;
}

function renderCharDeck(c, canEdit) {
  const allSorts = c.deck_sorts || [];
  const cats     = c.sort_cats  || [];
  const equip    = c?.equipement || {};
  const mainP    = equip['Main principale'];
  const armeDeg  = mainP?.degats || '1d6';
  const openIdx  = window._openSortIdx ?? null;

  // Bonus/malus du set d'armure sur les sorts
  const armorSet   = getArmorSetData(c);
  const pmDelta    = armorSet.modifiers?.spellPmDelta || 0;   // ex: -2 pour Léger
  const setLabel   = armorSet.isActive ? armorSet.activeEffect?.label || '' : '';

  // Grouper par catégorie
  const DEFAULT_CAT = { id: '__none', nom: 'Sans catégorie', couleur: '#4f8cff' };
  const allCats = cats.length ? [...cats, DEFAULT_CAT] : [DEFAULT_CAT];
  const sortsByCat = {};
  allCats.forEach(cat => { sortsByCat[cat.id] = []; });
  allSorts.forEach((s, globalIdx) => {
    const catId = s.catId && cats.find(cat => cat.id === s.catId) ? s.catId : '__none';
    sortsByCat[catId].push({ s, globalIdx });
  });

  let html = `<div class="cs-section">
    <div class="cs-section-title">✨ Sorts & Compétences
      <div style="display:flex;gap:.4rem">
        ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="addSort()">+ Sort</button>` : ''}
        ${canEdit ? `<button class="btn btn-outline btn-sm" style="font-size:.7rem" onclick="openSortCatEditor()">📂 Catégories</button>` : ''}
      </div>
    </div>
    <div class="cs-sort-info">
      <strong>Noyau + Runes.</strong> PM = 2 × (noyau + runes).
      Dégâts sorts = arme principale <em>(${armeDeg})</em>. Soin base = 1d4.
    </div>`;

  // Indicateur set léger (PM réduits)
  if (pmDelta !== 0) {
    const isBonus = pmDelta > 0;
    const col = isBonus ? '#22c38e' : '#22c38e'; // toujours vert (c'est un avantage)
    html += `<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem .75rem;
      background:rgba(34,195,142,.06);border:1px solid rgba(34,195,142,.25);
      border-radius:8px;margin-bottom:.5rem;font-size:.78rem">
      <span style="font-size:.9rem">🧙</span>
      <span style="color:#22c38e;font-weight:600">Set Léger</span>
      <span style="color:var(--text-muted)">→ coût des sorts</span>
      <span style="color:#22c38e;font-weight:700;background:rgba(34,195,142,.12);
        border-radius:6px;padding:1px 7px">${pmDelta > 0 ? '+' : ''}${pmDelta} PM</span>
      <span style="color:var(--text-dim);font-size:.7rem">(appliqué automatiquement)</span>
    </div>`;
  }

  if (allSorts.length === 0) {
    html += `<div class="cs-empty">🔮 Aucun sort créé</div>`;
  } else {
    allCats.forEach(cat => {
      const entries = sortsByCat[cat.id] || [];
      if (!entries.length) return;
      if (cats.length > 0) {
        html += `<div style="display:flex;align-items:center;gap:.5rem;margin:.75rem 0 .35rem;
          padding:.3rem .5rem;border-left:3px solid ${cat.couleur};background:${cat.couleur}0f;border-radius:0 6px 6px 0">
          <span style="font-size:.72rem;font-weight:700;color:${cat.couleur};letter-spacing:.5px;text-transform:uppercase">${cat.nom}</span>
          <span style="font-size:.65rem;color:var(--text-dim)">${entries.length} sort${entries.length>1?'s':''}</span>
        </div>`;
      }
      html += `<div class="cs-sort-list" data-cat="${cat.id}">`;
      entries.forEach(({ s, globalIdx: i }) => {
        html += _renderSortRow(s, i, openIdx, canEdit, armeDeg, c, pmDelta);
      });
      html += `</div>`;
    });
  }

  html += `</div>`;
  return html;
}

function _renderSortRow(s, i, openIdx, canEdit, armeDeg, c, pmDelta = 0) {
  const isOpen   = openIdx === i;
  const runesAll = s.runes || [];
  const types    = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);
  const nbCibles = _calcSortCibles(s);

  // Badges de type (multi)
  const TYPE_CFG = {
    offensif:   { label:'⚔️ Offensif',   color:'#ff6b6b' },
    defensif:   { label:'🛡️ Défensif',   color:'#22c38e' },
    utilitaire: { label:'✨ Utilitaire', color:'#b47fff' },
  };
  const typeBadges = types.map(t => {
    const cfg = TYPE_CFG[t] || { label: t, color:'#aaa' };
    return `<span style="font-size:.66rem;padding:1px 6px;border-radius:999px;flex-shrink:0;
      background:${cfg.color}18;color:${cfg.color};border:1px solid ${cfg.color}33;
      white-space:nowrap">${cfg.label}</span>`;
  }).join('');

  // Badge action
  const ACTION_CFG = {
    action:       { label:'⚡ Action',        color:'#e8b84b' },
    action_bonus: { label:'✴️ Action Bonus',  color:'#f97316' },
    reaction:     { label:'🔄 Réaction',      color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action] || ACTION_CFG.action;
  const actionBadge = `<span style="font-size:.66rem;padding:1px 6px;border-radius:999px;flex-shrink:0;
    background:${acfg.color}18;color:${acfg.color};border:1px solid ${acfg.color}33;
    white-space:nowrap">${acfg.label}</span>`;
  const concBadge = concentration
    ? `<span style="font-size:.66rem;padding:1px 6px;border-radius:999px;flex-shrink:0;
        background:#60a5fa18;color:#60a5fa;border:1px solid #60a5fa33;white-space:nowrap">🧠 Conc.</span>`
    : '';

  // ── Calcul des stats clés toujours visibles ──
  const equip   = c?.equipement || {};
  const mainP   = equip['Main principale'];
  const statKey = mainP?.statAttaque || mainP?.toucherStat || 'force';
  const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
  const mod     = Math.floor((Math.min(22, statVal) - 10) / 2);
  const modStr  = mod >= 0 ? `+${mod}` : `${mod}`;
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int' }[statKey] || statKey.slice(0,3);

  const nbPuiss  = runesAll.filter(r => r === 'Puissance').length;
  const nbProt   = runesAll.filter(r => r === 'Protection').length;
  const totalPP  = nbPuiss + nbProt;
  const chainBonus = totalPP > 1 ? `+${(totalPP-1)*2}` : '';

  // Ligne stats : tous les effets clés sur une ligne
  const statsChips = [];
  if (types.includes('offensif')) {
    statsChips.push({ icon:'⚔️', val:`${_calcSortDegats(s, c)} ${modStr} ${statLbl}`, color:'#ff6b6b' });
  }
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (mode === 'soin') {
      statsChips.push({ icon:'💚', val:_calcSortSoin(s), color:'#22c38e' });
    } else {
      statsChips.push({ icon:'🛡️', val:_getSortCA(s), color:'#22c38e' });
    }
  }
  if (nbCibles > 1) {
    statsChips.push({ icon:'🎯', val:`×${nbCibles} cibles`, color:'#4f8cff' });
  }
  const zone = _calcSortZone(s);
  if (zone) statsChips.push({ icon:'📐', val:`+${zone}m`, color:'#b47fff' });
  const duree = _calcSortDuree(s);
  if (duree) statsChips.push({ icon:'⏱️', val:`+${duree}t`, color:'#9ca3af' });

  const statsLine = statsChips.map(c =>
    `<span style="font-size:.76rem;font-weight:600;color:${c.color};white-space:nowrap">${c.icon} ${c.val}</span>`
  ).join('<span style="color:var(--text-dim);font-size:.7rem;margin:0 1px">·</span>');

  // Description tronquée toujours visible
  const descShort = s.effet ? (s.effet.length > 60 ? s.effet.slice(0, 58) + '…' : s.effet) : '';

  return `<div class="cs-sort-row ${s.actif?'actif':''}"
    draggable="true" data-sort-idx="${i}"
    ondragstart="sortDragStart(event,${i})"
    ondragover="sortDragOver(event)"
    ondrop="sortDrop(event,${i})"
    ondragend="sortDragEnd(event)">
    <div class="cs-sort-row-main" onclick="toggleSortDetail(${i})" style="cursor:pointer">
      <div class="toggle ${s.actif?'on':''}"
           onclick="event.stopPropagation();${canEdit?`toggleSort(${i})`:''}"
           title="${s.actif?'Désactiver':'Activer'}"></div>

      <div class="cs-sort-row-info" style="flex:1;min-width:0">
        <!-- Ligne 1 : nom + PM + chevron -->
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
          <span style="font-family:'Cinzel',serif;font-size:.93rem;font-weight:700;
            color:var(--text);flex:1;min-width:0;white-space:nowrap;
            overflow:hidden;text-overflow:ellipsis">${s.nom||'Sans nom'}</span>
          <span class="cs-sort-row-pm" style="flex-shrink:0">${
            pmDelta !== 0
              ? `<span style="text-decoration:line-through;color:var(--text-dim);font-size:.68rem">${s.pm||0}</span> <span style="color:#22c38e;font-weight:700">${Math.max(0,(s.pm||0)+pmDelta)}</span> PM`
              : `${s.pm||0} PM`
          }</span>
          <span class="cs-sort-row-chevron" style="flex-shrink:0">${isOpen?'▲':'▼'}</span>
        </div>
        <!-- Ligne 2 : types + action + concentration -->
        <div style="display:flex;align-items:center;gap:.3rem;margin-top:.2rem;flex-wrap:wrap">
          ${typeBadges}
          ${actionBadge}
          ${concBadge}
          <div style="display:flex;gap:.2rem;margin-left:auto;flex-shrink:0">
            ${s.noyau ? `<span class="cs-sort-badge gold">${s.noyau.split(' ')[0]}</span>` : ''}
            ${totalPP > 0 ? `<span class="cs-sort-badge gold">${chainBonus||`+${totalPP}🎲`}</span>` : ''}
          </div>
        </div>
        <!-- Ligne 3 : stats clés toujours visibles -->
        ${statsLine ? `<div style="display:flex;align-items:center;gap:.3rem;margin-top:.25rem;flex-wrap:wrap">
          ${statsLine}
        </div>` : ''}
        <!-- Ligne 4 : description courte toujours visible -->
        ${descShort ? `<div style="margin-top:.2rem;font-size:.74rem;color:var(--text-dim);
          font-style:italic;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${descShort}
        </div>` : ''}
      </div>

      ${canEdit ? `<span class="cs-sort-row-actions" onclick="event.stopPropagation()"
        style="display:flex;gap:.15rem;flex-shrink:0;margin-left:.25rem">
        <button class="btn-icon" onclick="editSort(${i})">✏️</button>
        <button class="btn-icon" onclick="deleteSort(${i})">🗑️</button>
      </span>` : ''}
    </div>

    ${isOpen ? `<div class="cs-sort-row-detail">
      ${s.noyau ? `<div class="cs-sort-dl"><span class="cs-sort-dl-label">Noyau</span>${s.noyau}</div>` : ''}
      ${runesAll.length ? `<div class="cs-sort-dl"><span class="cs-sort-dl-label">Runes (${runesAll.length})</span>${runesAll.join(' · ')}</div>` : ''}

      <!-- Résumé des effets -->
      <div style="margin:.5rem 0;border-top:1px solid var(--border);padding-top:.5rem">
        <div style="font-size:.7rem;font-weight:700;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase;margin-bottom:.35rem">📋 Effets calculés</div>
        ${_buildSortResume(s, c).map(line => `
        <div style="display:flex;align-items:baseline;gap:.4rem;padding:.18rem 0;font-size:.8rem">
          <span style="min-width:1.2rem;text-align:center">${line.icon}</span>
          <span style="font-weight:600;color:var(--text)">${line.label}</span>
          ${line.detail ? `<span style="color:var(--text-dim);font-size:.72rem">${line.detail}</span>` : ''}
        </div>`).join('')}
      </div>

      ${s.effet ? `<div class="cs-sort-dl"><span class="cs-sort-dl-label">Description</span>${s.effet}</div>` : ''}
    </div>` : ''}
  </div>`;
}

// ── Catégories de sorts ───────────────────────────────────────────────────────
function openSortCatEditor() {
  const c    = STATE.activeChar; if (!c) return;
  const cats = c.sort_cats || [];
  const COLORS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b','#9ca3af'];

  openModal('📂 Catégories de sorts', `
    <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.75rem">
      Crée des catégories pour organiser tes sorts. Glisse les sorts d'une catégorie à l'autre depuis la liste.
    </div>
    <div id="sort-cats-list" style="display:flex;flex-direction:column;gap:.4rem">
      ${cats.map((cat, i) => `
      <div style="display:flex;align-items:center;gap:.5rem;background:var(--bg-elevated);
        border-radius:8px;padding:.5rem .7rem;border:1px solid var(--border)">
        <div style="width:12px;height:12px;border-radius:50%;background:${cat.couleur};flex-shrink:0"></div>
        <span style="flex:1;font-size:.84rem;color:var(--text)">${cat.nom}</span>
        <button class="btn-icon" style="font-size:.72rem" onclick="window._editSortCat(${i})">✏️</button>
        <button class="btn-icon" style="font-size:.72rem;color:#ff6b6b" onclick="window._delSortCat(${i})">🗑️</button>
      </div>`).join('')}
      ${cats.length === 0 ? `<div style="text-align:center;padding:1rem;color:var(--text-dim);font-size:.8rem;font-style:italic">Aucune catégorie</div>` : ''}
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.75rem">
      ${COLORS.map(col => `<button onclick="window._addSortCat('${col}')"
        style="width:28px;height:28px;border-radius:50%;background:${col};border:2px solid transparent;
        cursor:pointer;transition:transform .1s" onmouseover="this.style.transform='scale(1.2)'"
        onmouseout="this.style.transform=''" title="Créer une catégorie ${col}"></button>`).join('')}
      <span style="font-size:.75rem;color:var(--text-dim);align-self:center;margin-left:.25rem">← clique pour créer</span>
    </div>
    <button class="btn btn-outline btn-sm" style="width:100%;margin-top:.75rem" onclick="closeModal()">Fermer</button>
  `);
}

window._addSortCat = async (couleur) => {
  const nom = prompt('Nom de la catégorie :');
  if (!nom?.trim()) return;
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  cats.push({ id: `cat_${Date.now()}`, nom: nom.trim(), couleur });
  c.sort_cats = cats;
  await updateInCol('characters', c.id, { sort_cats: cats });
  showNotif('Catégorie créée !', 'success');
  openSortCatEditor();
  renderCharSheet(c, 'sorts');
};

window._editSortCat = async (idx) => {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  const nom = prompt('Renommer :', cats[idx].nom);
  if (!nom?.trim()) return;
  cats[idx].nom = nom.trim();
  c.sort_cats = cats;
  await updateInCol('characters', c.id, { sort_cats: cats });
  openSortCatEditor();
  renderCharSheet(c, 'sorts');
};

window._delSortCat = async (idx) => {
  const c = STATE.activeChar; if (!c) return;
  const cats  = [...(c.sort_cats || [])];
  const catId = cats[idx].id;
  // Retirer la catégorie des sorts qui l'avaient
  const sorts = (c.deck_sorts || []).map(s => s.catId === catId ? { ...s, catId: '' } : s);
  cats.splice(idx, 1);
  c.sort_cats  = cats;
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, { sort_cats: cats, deck_sorts: sorts });
  showNotif('Catégorie supprimée.', 'success');
  openSortCatEditor();
  renderCharSheet(c, 'sorts');
};


function toggleSortDetail(idx) {
  window._openSortIdx = window._openSortIdx === idx ? null : idx;
  _renderTab('sorts', window._currentChar, window._canEditChar);
}


function isEquipableInventoryItem(item = {}) {
  const tpl = (item.template || '').toLowerCase();
  const format = item.format || '';
  const slotArmure = item.slotArmure || '';
  const slotBijou = item.slotBijou || '';
  const typeArmure = item.typeArmure || '';
  const haystack = [
    item.type,
    item.categorie,
    item.category,
    item.sousCategorie,
    item.subcategory,
    item.nom,
    item.description,
  ].filter(Boolean).join(' ').toLowerCase();

  if (tpl === 'arme' || tpl === 'armure' || tpl === 'bijou') return true;
  if (format || slotArmure || slotBijou || typeArmure) return true;
  if (item.degats || item.ca || item.toucherStat || item.degatsStat) return true;

  return ['arme','weapon','épée','epee','arc','dague','hache','lance','marteau','bouclier','armure','armor','casque','capuche','botte','gants','amulette','anneau','bijou','talisman']
    .some(keyword => haystack.includes(keyword));
}

function renderCharInventaire(c, canEdit) {
  const invRaw = c.inventaire || [];

  const grouped = [];
  invRaw.forEach((item, realIdx) => {
    const key = (item.itemId || '') + '||' + (item.nom || '');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte) || 1;
      existing.indices.push(realIdx);
    } else {
      grouped.push({ key, item: { ...item }, qte: parseInt(item.qte) || 1, indices: [realIdx] });
    }
  });

  const equipmentGroups = grouped.filter(g => isEquipableInventoryItem(g.item));
  const otherGroups = grouped.filter(g => !isEquipableInventoryItem(g.item));
  const otherChars = STATE.characters?.filter(x => x.id !== c.id) || [];
  const equippedMap = getEquippedInventoryIndexMap(c);

  const RARETE_COLORS = ['', '#9ca3af', '#4ade80', '#60a5fa', '#c084fc'];
  const RARETE_LABELS = ['', 'Commun', 'Peu commun', 'Rare', 'Très rare'];
  const equipOpen = window._charInvEquipOpen !== false;

  const totalQty = groups => groups.reduce((sum, g) => sum + (parseInt(g.qte) || 0), 0);

  const renderInventoryCards = groups => groups.map(g => {
    const item = g.item;
    const pv = parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat) || 0) * 0.6);
    const pa = parseFloat(item.prixAchat) || 0;
    const indicesB64 = btoa(JSON.stringify(g.indices));

    const rareteN = parseInt(item.rarete) || 0;
    const rareteC = RARETE_COLORS[rareteN] || 'var(--border)';
    const rareteL = RARETE_LABELS[rareteN] || '';
    const equippedSlots = [...new Set(g.indices.flatMap(idx => equippedMap.get(idx) || []))];
    const isEquipped = equippedSlots.length > 0;
    const equippedLabel = isEquipped
      ? `Équipé${equippedSlots.length ? ` · ${equippedSlots.join(' · ')}` : ''}`
      : '';

    const chips = [];
    const bonusText = formatItemBonusText(item);
    // ── Chips normalisées ─────────────────────────────────────────────────────
    // Ordre fixe : Format → Type arme → Emplacement → Type armure → Bijou →
    //              Dégâts → Toucher → CA → Stats → Trait → Type/Effet
    if (item.format)     chips.push({ label: 'Format',   val: item.format,     color: '#e8b84b' });
    if (item.sousType)   chips.push({ label: 'Type arme',val: item.sousType,   color: '#e8b84b' });
    if (item.slotArmure) chips.push({ label: 'Slot',     val: item.slotArmure, color: '#4f8cff' });
    if (item.typeArmure) chips.push({ label: 'Type',     val: item.typeArmure, color: '#4f8cff' });
    if (item.slotBijou)  chips.push({ label: 'Bijou',    val: item.slotBijou,  color: '#c084fc' });
    if (item.degats) {
      const degStr = item.degatsStat
        ? `${item.degats} + ${statShort(item.degatsStat)}`
        : item.degats;
      chips.push({ label: 'Dégâts', val: degStr, color: '#ff6b6b' });
    }
    // toucherStat prioritaire sur toucher textuel
    if (item.toucherStat)      chips.push({ label: 'Toucher', val: statShort(item.toucherStat), color: '#e8b84b' });
    else if (item.toucher)     chips.push({ label: 'Toucher', val: item.toucher,                 color: '#e8b84b' });
    if (item.ca != null && item.ca !== '') chips.push({ label: 'CA', val: `+${parseInt(item.ca)||0}`, color: '#4f8cff' });
    if (bonusText) chips.push({ label: 'Stats', val: bonusText, color: '#4f8cff' });
    _getTraits(item).forEach(t => chips.push({ label: 'Trait', val: t, color: '#b47fff' }));
    // Type libre uniquement si pas déjà couvert
    if (item.type && !item.degats && !item.slotArmure && !item.slotBijou && !item.format)
      chips.push({ label: 'Type', val: item.type, color: 'var(--text-muted)' });
    if (item.effet && !item.degats)
      chips.push({ label: 'Effet', val: item.effet.length > 60 ? item.effet.slice(0,60)+'…' : item.effet, color: 'var(--text-muted)' });

    return `<div class="inv-card" style="border-left:3px solid ${rareteC}">
      <div class="inv-card-header">
        <div>
          <div class="inv-card-title">${item.nom || '?'}</div>
          ${rareteL ? `<div class="inv-card-sub" style="color:${rareteC}">${'★'.repeat(rareteN) + '☆'.repeat(4 - rareteN)} ${rareteL}</div>` : ''}
          ${isEquipped ? `<div class="inv-card-sub" style="margin-top:4px"><span class="inv-badge-equipped">✓ ${equippedLabel}</span></div>` : ''}
        </div>
        <span class="inv-card-qte">×${g.qte}</span>
      </div>

      ${chips.length ? `<div class="inv-card-stats">
        ${chips.map(ch => `<div class="inv-stat-chip">
          <span class="inv-stat-label">${ch.label}</span>
          <span class="inv-stat-val" style="color:${ch.color}">${ch.val}</span>
        </div>`).join('')}
      </div>` : ''}

      ${item.description ? `<div class="inv-card-desc">${item.description}</div>` : ''}

      <div class="inv-card-footer">
        <div class="inv-price-block">
          ${pa ? `<span class="inv-price-buy" title="Prix d'achat">💰 ${pa} or</span>` : ''}
          ${pa && pv ? `<span style="color:var(--border);font-size:.65rem">|</span>` : ''}
          ${pv ? `<span class="inv-price-sell" title="Prix de revente">🔄 ${pv} or/u</span>` : ''}
        </div>
        ${canEdit ? `<div class="inv-actions">
          ${item.source === 'boutique' ? `<button class="inv-btn inv-btn-sell"
            onclick="openSellInvModal('${c.id}','${indicesB64}',${pv},'${(item.nom || '').replace(/'/g, "\\'")}')">
            🔄 Vendre
          </button>` : ''}
        </div>` : ''}
        ${otherChars.length ? `<div class="inv-actions" style="${canEdit?'margin-left:.25rem':''}">
          <button class="inv-btn inv-btn-send"
            onclick="openSendInvModal('${c.id}','${indicesB64}','${(item.nom || '').replace(/'/g, "\\'")}')">
            ↗ Envoyer
          </button>
        </div>` : ''}
        ${canEdit ? `<div class="inv-actions" style="margin-left:.25rem">
          <button class="inv-btn inv-btn-del"
            onclick="openDeleteInvModal('${c.id}','${indicesB64}','${(item.nom || '').replace(/'/g, "\\'")}')">
            🗑
          </button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  let html = `
  <style>
    .inv-card {
      background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      overflow:hidden;transition:box-shadow .15s;
    }
    .inv-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.35); }
    .inv-card-header {
      display:flex;align-items:flex-start;justify-content:space-between;
      padding:.75rem 1rem .5rem;gap:.5rem;
    }
    .inv-card-title {
      font-family:'Cinzel',serif;font-size:.9rem;font-weight:600;
      color:var(--text);line-height:1.2;
    }
    .inv-card-sub {
      font-size:.7rem;margin-top:2px;
    }
    .inv-badge-equipped {
      display:inline-flex;align-items:center;gap:.3rem;
      padding:2px 8px;border-radius:999px;
      font-size:.68rem;font-weight:600;
      color:#4ade80;background:rgba(74,222,128,.1);
      border:1px solid rgba(74,222,128,.28);
    }
    .inv-card-qte {
      font-family:'Cinzel',serif;font-size:.85rem;font-weight:700;
      color:var(--text);background:var(--bg-elevated);border:1px solid var(--border);
      border-radius:8px;padding:2px 10px;flex-shrink:0;white-space:nowrap;
    }
    .inv-card-stats {
      display:flex;flex-wrap:wrap;gap:.3rem .6rem;
      padding:0 1rem .6rem;
    }
    .inv-stat-chip {
      display:flex;align-items:center;gap:.25rem;
      background:var(--bg-elevated);border-radius:6px;
      padding:2px 8px;font-size:.75rem;border:1px solid var(--border);
    }
    .inv-stat-label {
      color:var(--text-dim);font-size:.65rem;text-transform:uppercase;letter-spacing:.5px;
    }
    .inv-stat-val { font-weight:600; }
    .inv-card-desc {
      padding:0 1rem .6rem;font-size:.78rem;color:var(--text-muted);
      font-style:italic;line-height:1.5;
    }
    .inv-card-footer {
      display:flex;align-items:center;justify-content:space-between;
      padding:.5rem 1rem .65rem;border-top:1px solid var(--border);
      background:rgba(0,0,0,.15);gap:.5rem;
    }
    .inv-price-block {
      display:flex;align-items:center;gap:.5rem;font-size:.75rem;
    }
    .inv-price-buy { color:var(--text-dim); }
    .inv-price-sell { color:var(--gold); }
    .inv-actions {
      display:flex;align-items:center;gap:.4rem;flex-shrink:0;
    }
    .inv-btn {
      display:flex;align-items:center;gap:.3rem;
      border-radius:8px;padding:4px 10px;cursor:pointer;
      font-size:.73rem;font-weight:500;border:1px solid;
      transition:all .15s;line-height:1;
    }
    .inv-btn-sell {
      background:rgba(232,184,75,.08);border-color:rgba(232,184,75,.3);color:var(--gold);
    }
    .inv-btn-sell:hover { background:rgba(232,184,75,.18);border-color:rgba(232,184,75,.6); }
    .inv-btn-send {
      background:rgba(79,140,255,.08);border-color:rgba(79,140,255,.3);color:#4f8cff;
    }
    .inv-btn-send:hover { background:rgba(79,140,255,.18);border-color:rgba(79,140,255,.6); }
    .inv-btn-del {
      background:rgba(255,107,107,.06);border-color:rgba(255,107,107,.25);color:#ff6b6b;
      padding:4px 8px;
    }
    .inv-btn-del:hover { background:rgba(255,107,107,.15);border-color:rgba(255,107,107,.5); }
    .inv-group {
      border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.015);
      overflow:hidden;
    }
    .inv-group + .inv-group,
    .inv-group + .inv-group-static,
    .inv-group-static + .inv-group,
    .inv-group-static + .inv-group-static { margin-top:.9rem; }
    .inv-group > summary,
    .inv-group-static-head {
      list-style:none;display:flex;align-items:center;justify-content:space-between;gap:.75rem;
      padding:.9rem 1rem;cursor:pointer;background:rgba(255,255,255,.02);
      border-bottom:1px solid rgba(255,255,255,.04);
    }
    .inv-group > summary::-webkit-details-marker { display:none; }
    .inv-group-title-wrap,
    .inv-group-static-title-wrap { display:flex;align-items:center;gap:.55rem;min-width:0; }
    .inv-group-title,
    .inv-group-static-title { font-size:.88rem;font-weight:700;color:var(--text); }
    .inv-group-meta,
    .inv-group-static-meta { font-size:.74rem;color:var(--text-dim); }
    .inv-group-count {
      display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;
      padding:0 .55rem;border-radius:999px;border:1px solid var(--border);
      background:var(--bg-elevated);color:var(--text-muted);font-size:.74rem;font-weight:700;
    }
    .inv-group-chevron {
      color:var(--text-dim);font-size:.82rem;transition:transform .15s ease;
    }
    .inv-group[open] .inv-group-chevron { transform:rotate(90deg); }
    .inv-group-body,
    .inv-group-static-body { padding:1rem;display:flex;flex-direction:column;gap:.6rem; }
  </style>
  <div class="cs-section">
    <div class="cs-section-title">🎒 Inventaire
      <span class="cs-hint">${invRaw.length} objet${invRaw.length !== 1 ? 's' : ''}</span>
    </div>`;

  if (grouped.length === 0) {
    html += `<div class="cs-empty" style="padding:2rem;text-align:center">
      <div style="font-size:2rem;margin-bottom:.5rem;opacity:.3">🎒</div>
      <div style="font-size:.85rem;color:var(--text-dim)">Inventaire vide.</div>
      <div style="font-size:.75rem;color:var(--text-dim);margin-top:.3rem">Achetez des objets depuis la Boutique.</div>
    </div>`;
  } else {
    if (equipmentGroups.length) {
      html += `<details class="inv-group" ${equipOpen ? 'open' : ''} ontoggle="window._charInvEquipOpen=this.open">
        <summary>
          <div class="inv-group-title-wrap">
            <span>🛡️</span>
            <div>
              <div class="inv-group-title">Équipement</div>
              <div class="inv-group-meta">Armes, armures, bijoux et accessoires équipables</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:.55rem;flex-shrink:0">
            <span class="inv-group-count">${totalQty(equipmentGroups)}</span>
            <span class="inv-group-chevron">▶</span>
          </div>
        </summary>
        <div class="inv-group-body">${renderInventoryCards(equipmentGroups)}</div>
      </details>`;
    }

    if (otherGroups.length) {
      html += `<div class="inv-group-static">
        <div class="inv-group-static-head">
          <div class="inv-group-static-title-wrap">
            <span>🎒</span>
            <div>
              <div class="inv-group-static-title">Autres objets</div>
              <div class="inv-group-static-meta">Consommables, ressources, quêtes et divers</div>
            </div>
          </div>
          <span class="inv-group-count">${totalQty(otherGroups)}</span>
        </div>
        <div class="inv-group-static-body">${renderInventoryCards(otherGroups)}</div>
      </div>`;
    }
  }

  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : QUÊTES
// ══════════════════════════════════════════════
function renderCharQuetes(c, canEdit) {
  const quetes = c.quetes||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📜 Journal de Quête
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addQuete()">+ Ajouter</button>`:''}
    </div>`;

  if (quetes.length===0) {
    html += `<div class="cs-empty">Aucune quête.</div>`;
  } else {
    quetes.forEach((q,i) => {
      html += `<div class="cs-quest-row">
        <div class="cs-quest-info">
          <div class="cs-quest-name">${q.nom||'?'}</div>
          <div class="cs-quest-meta">${q.type||''} ${q.description?'— '+q.description:''}</div>
        </div>
        <div class="cs-quest-right">
          <span class="badge badge-${q.valide?'green':'blue'}">${q.valide?'Validée':'En cours'}</span>
          ${canEdit?`<button class="btn-icon" onclick="toggleQuete(${i})" title="${q.valide?'Rouvrir':'Valider'}">✔️</button>
                     <button class="btn-icon" onclick="deleteQuete(${i})">🗑️</button>`:''}
        </div>
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : NOTES
// ══════════════════════════════════════════════
function renderCharNotes(c, canEdit) {
  const notes = c.notesList||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📝 Notes
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addNote()">+ Nouvelle note</button>`:''}
    </div>`;

  if (notes.length===0) {
    html += `<div class="cs-empty">Aucune note. Crée ta première note avec le bouton ci-dessus.</div>`;
  } else {
    notes.forEach((note, i) => {
      const isOpen = window._openNote === i;
      html += `<div class="cs-note-card">
        <div class="cs-note-header" onclick="toggleNote(${i})">
          <div class="cs-note-meta">
            <span class="cs-note-icon">📄</span>
            <span class="cs-note-title">${note.titre||'Note sans titre'}</span>
            ${note.date?`<span class="cs-note-date">${note.date}</span>`:''}
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center">
            ${canEdit?`<button class="btn-icon" onclick="event.stopPropagation();editNoteTitle(${i})" title="Renommer">✏️</button>
                       <button class="btn-icon" onclick="event.stopPropagation();deleteNote(${i})" title="Supprimer">🗑️</button>`:''}
            <span class="cs-note-chevron">${isOpen?'▲':'▼'}</span>
          </div>
        </div>
        ${isOpen?`<div class="cs-note-body">
          ${canEdit
            ? `<textarea class="input-field cs-note-textarea" id="note-area-${i}" rows="10"
                         placeholder="Contenu de la note...">${note.contenu||''}</textarea>
               <button class="btn btn-gold btn-sm" style="margin-top:0.6rem" onclick="saveNote(${i})">💾 Enregistrer</button>`
            : `<div class="cs-note-content">${(note.contenu||'Aucun contenu.').replace(/\n/g,'<br>')}</div>`
          }
        </div>`:''}
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}


function previewXpBar(input, palier) {
  const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
  const p = palier > 0 ? Math.round(val/palier*100) : 0;
  const bar = document.getElementById('xp-bar-fill');
  const pct = document.getElementById('xp-pct');
  if (bar) bar.style.width = p + '%';
  if (pct) pct.textContent = p + '%';
}

async function saveXpDirect(charId, input) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  const palier = calcPalier(c.niveau||1);
  const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
  c.exp = val;
  input.value = val;
  previewXpBar(input, palier);
  await updateInCol('characters', charId, {exp: val});
  showNotif('XP mis à jour !', 'success');
}

function toggleNote(idx) {
  window._openNote = window._openNote === idx ? null : idx;
  _renderTab('notes', window._currentChar, window._canEditChar);
}

function addNote() {
  const c = STATE.activeChar; if(!c) return;
  const notes = c.notesList||[];
  const now = new Date().toLocaleDateString('fr-FR');
  notes.push({ titre: 'Nouvelle note', contenu: '', date: now });
  c.notesList = notes;
  window._openNote = notes.length - 1;
  updateInCol('characters', c.id, {notesList: notes}).then(()=>{
    _renderTab('notes', c, window._canEditChar);
  });
}

function editNoteTitle(idx) {
  const c = STATE.activeChar; if(!c) return;
  const note = (c.notesList||[])[idx];
  if (!note) return;
  const cur = note.titre||'Sans titre';
  const val = prompt('Titre de la note :', cur);
  if (val === null) return;
  note.titre = val.trim()||cur;
  c.notesList[idx] = note;
  updateInCol('characters', c.id, {notesList: c.notesList}).then(()=>{
    _renderTab('notes', c, window._canEditChar);
    showNotif('Titre mis à jour !','success');
  });
}

async function saveNote(idx) {
  const c = STATE.activeChar; if(!c) return;
  const ta = document.getElementById(`note-area-${idx}`);
  if (!ta) return;
  c.notesList[idx].contenu = ta.value;
  await updateInCol('characters', c.id, {notesList: c.notesList});
  showNotif('Note enregistrée !','success');
}

async function deleteNote(idx) {
  const c = STATE.activeChar; if(!c) return;
  if (!confirm('Supprimer cette note ?')) return;
  c.notesList.splice(idx, 1);
  if (window._openNote >= c.notesList.length) window._openNote = null;
  await updateInCol('characters', c.id, {notesList: c.notesList});
  _renderTab('notes', c, window._canEditChar);
  showNotif('Note supprimée.','success');
}


// ══════════════════════════════════════════════
// TAB : LIVRET DE COMPTE
// ══════════════════════════════════════════════
function renderCharCompte(c, canEdit) {
  const compte = c.compte||{recettes:[], depenses:[]};
  const recettes = compte.recettes||[];
  const depenses = compte.depenses||[];

  const totalR = recettes.reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = depenses.reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  const solde = totalR - totalD;

  const renderRows = (list, type, canEdit) => {
    if (list.length===0) return `<tr><td colspan="4" class="cs-compte-empty">Aucune entrée.</td></tr>`;
    return list.map((row,i)=>`
      <tr class="cs-compte-row">
        <td>${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'date',this)">${row.date||'—'}</span>`
          : (row.date||'—')}</td>
        <td>${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'libelle',this)">${row.libelle||'—'}</span>`
          : (row.libelle||'—')}</td>
        <td class="${type==='recettes'?'cs-montant-pos':'cs-montant-neg'}">${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'montant',this)">${row.montant||0}</span>`
          : (row.montant||0)} or</td>
        ${canEdit?`<td><button class="btn-icon" onclick="deleteCompteRow('${type}',${i})">🗑️</button></td>`:''  }
      </tr>`).join('');
  };

  return `<div class="cs-section">
    <div class="cs-section-title">💰 Livret de Compte</div>

    <!-- Solde global -->
    <div class="cs-solde-bar">
      <div class="cs-solde-item">
        <span class="cs-solde-label">Recettes</span>
        <span class="cs-solde-val pos">+${totalR} or</span>
      </div>
      <div class="cs-solde-sep">−</div>
      <div class="cs-solde-item">
        <span class="cs-solde-label">Dépenses</span>
        <span class="cs-solde-val neg">−${totalD} or</span>
      </div>
      <div class="cs-solde-sep">=</div>
      <div class="cs-solde-item cs-solde-main">
        <span class="cs-solde-label">SOLDE</span>
        <span class="cs-solde-val ${solde>=0?'pos':'neg'}">${solde>=0?'+':''}${solde} or</span>
      </div>
    </div>

    <!-- Double tableau -->
    <div class="cs-compte-grid">

      <!-- Recettes -->
      <div class="cs-compte-col">
        <div class="cs-compte-col-header">
          <span class="cs-compte-col-title pos">📈 Recettes</span>
          ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addCompteRow('recettes')">+ Ajouter</button>`:''}
        </div>
        <table class="cs-compte-table">
          <thead><tr>
            <th>Date / Mission</th><th>Libellé</th><th>Montant</th>
            ${canEdit?'<th></th>':''}
          </tr></thead>
          <tbody>${renderRows(recettes,'recettes',canEdit)}</tbody>
          <tfoot><tr>
            <td colspan="${canEdit?3:2}" style="text-align:right;font-size:0.72rem;color:var(--text-muted);font-weight:700;padding-top:0.5rem">Total</td>
            <td class="cs-montant-pos" style="font-weight:800;padding-top:0.5rem">+${totalR} or</td>
            ${canEdit?'<td></td>':''}
          </tr></tfoot>
        </table>
      </div>

      <!-- Dépenses -->
      <div class="cs-compte-col">
        <div class="cs-compte-col-header">
          <span class="cs-compte-col-title neg">📉 Dépenses</span>
          ${canEdit?`<button class="btn btn-danger btn-sm" style="font-size:0.72rem" onclick="addCompteRow('depenses')">+ Ajouter</button>`:''}
        </div>
        <table class="cs-compte-table">
          <thead><tr>
            <th>Date / Mission</th><th>Libellé</th><th>Montant</th>
            ${canEdit?'<th></th>':''}
          </tr></thead>
          <tbody>${renderRows(depenses,'depenses',canEdit)}</tbody>
          <tfoot><tr>
            <td colspan="${canEdit?3:2}" style="text-align:right;font-size:0.72rem;color:var(--text-muted);font-weight:700;padding-top:0.5rem">Total</td>
            <td class="cs-montant-neg" style="font-weight:800;padding-top:0.5rem">−${totalD} or</td>
            ${canEdit?'<td></td>':''}
          </tr></tfoot>
        </table>
      </div>

    </div>
  </div>`;
}


function refreshOrDisplay(c) {
  const el = document.querySelector('.cs-or');
  if (el) el.textContent = '💰 ' + calcOr(c) + ' or';
}

function addCompteRow(type) {
  const c = STATE.activeChar; if(!c) return;
  const compte = c.compte||{recettes:[],depenses:[]};
  compte[type] = compte[type]||[];
  compte[type].push({ date: new Date().toLocaleDateString('fr-FR'), libelle: '', montant: 0 });
  c.compte = compte;
  updateInCol('characters', c.id, {compte}).then(()=>{
    _renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  });
}

async function deleteCompteRow(type, idx) {
  const c = STATE.activeChar; if(!c) return;
  (c.compte||{})[type]?.splice(idx,1);
  await updateInCol('characters', c.id, {compte: c.compte});
  _renderTab('compte', c, window._canEditChar);
  refreshOrDisplay(c);
}

function inlineEditCompteField(type, idx, field, el) {
  const c = STATE.activeChar; if(!c) return;
  const cur = el.textContent.replace(/ or$/,'').trim();
  const isNum = field === 'montant';
  const input = document.createElement('input');
  input.type = isNum ? 'number' : 'text';
  input.value = cur;
  input.className = 'cs-inline-input' + (isNum ? ' cs-inline-num' : '');
  input.style.cssText = 'width:' + (isNum ? '70px' : '120px') + ';font-size:inherit;';

  const save = async () => {
    const val = isNum ? (parseFloat(input.value)||0) : (input.value.trim()||cur);
    c.compte = c.compte||{recettes:[],depenses:[]};
    c.compte[type][idx][field] = val;
    await updateInCol('characters', c.id, {compte: c.compte});
    _renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape') input.replaceWith(el); });
  el.replaceWith(input);
  input.focus(); input.select();
}


// ── Décoder les indices depuis base64 ─────────────────────────────────────────
function _decodeIndices(b64) {
  try { return JSON.parse(atob(b64)); } catch { return []; }
}

// ── Modal vente avec quantité ─────────────────────────────────────────────────
function openSellInvModal(charId, indicesB64, prixVente, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  if (maxQte === 0) return;

  // Vérifier si des exemplaires sont équipés
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  const equippedMap = c ? getEquippedInventoryIndexMap(c) : new Map();
  const equippedSlots = [...new Set(indices.flatMap(idx => equippedMap.get(idx) || []))];
  const hasEquipped = equippedSlots.length > 0;

  openModal(`🔄 Vendre — ${nom}`, `
    ${hasEquipped ? `
    <div style="background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.3);
      border-radius:10px;padding:.65rem .9rem;margin-bottom:.85rem;
      display:flex;align-items:flex-start;gap:.5rem;font-size:.82rem">
      <span style="font-size:1rem;flex-shrink:0">⚠️</span>
      <div>
        <strong style="color:#ff6b6b;display:block;margin-bottom:.2rem">Objet actuellement équipé !</strong>
        <span style="color:var(--text-muted)">Slot${equippedSlots.length>1?'s':''} : ${equippedSlots.join(', ')}.
        Il sera automatiquement déséquipé si tu le vends.</span>
      </div>
    </div>` : ''}
    <div style="margin-bottom:1rem;font-size:.85rem;color:var(--text-muted)">
      <strong style="color:var(--gold)">${prixVente} or</strong> par unité · ${maxQte} en stock
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown();this.nextElementSibling.dispatchEvent(new Event('input'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">−</button>
        <input type="number" id="sell-qty" min="1" max="${maxQte}" value="1"
          style="width:60px;text-align:center" class="input-field"
          oninput="document.getElementById('sell-total').textContent=(Math.min(Math.max(1,parseInt(this.value)||1),${maxQte})*${prixVente})+' or'">
        <button type="button" onclick="this.previousElementSibling.stepUp();this.previousElementSibling.dispatchEvent(new Event('input'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">+</button>
      </div>
      <span style="font-size:.8rem;color:var(--text-dim)">→ <strong id="sell-total" style="color:var(--gold)">${prixVente} or</strong></span>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="sellInvItemBulk('${charId}','${indicesB64}',${prixVente})">
        🔄 Vendre${hasEquipped?' (déséquiper et vendre)':''}
      </button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function sellInvItemBulk(charId, indicesB64, prixVente) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;

  const allIndices = _decodeIndices(indicesB64);
  const qty = Math.min(Math.max(1, parseInt(document.getElementById('sell-qty')?.value)||1), allIndices.length);
  const equippedMap = getEquippedInventoryIndexMap(c);
  const unequippedIndices = allIndices.filter(idx => !(equippedMap.get(idx) || []).length);
  const equippedIndices = allIndices.filter(idx => (equippedMap.get(idx) || []).length);
  const indicesToSell = [...unequippedIndices, ...equippedIndices].slice(0, qty);

  const inv      = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const item     = inv[indicesToSell[0]];
  if (!item) return;
  const itemNom  = item.nom || 'objet';
  const totalPrix = prixVente * qty;

  // Retirer les items vendus (du plus grand index au plus petit pour ne pas décaler)
  const sorted = [...indicesToSell].sort((a,b)=>b-a);
  sorted.forEach(idx => inv.splice(idx, 1));

  // Créditer l'or
  const compte   = c.compte || { recettes:[], depenses:[] };
  const recettes = [...(compte.recettes||[])];
  recettes.push({
    date:    new Date().toLocaleDateString('fr-FR'),
    libelle: qty > 1 ? `Vente ×${qty} : ${itemNom}` : `Vente : ${itemNom}`,
    montant: totalPrix,
  });

  // Réincrémenter le stock boutique si besoin
  if (item.itemId && window.sellInvItemFromShop) {
    // On réincrémente N fois dans la boutique
    for (let i = 0; i < qty; i++) {
      await window._restockShopItem?.(item.itemId);
    }
  }

  const equipSync = syncEquipmentAfterInventoryMutation(c, indicesToSell);
  const payload = {
    inventaire: inv,
    compte: { ...compte, recettes },
  };
  if (equipSync.changed) {
    payload.equipement = equipSync.equipement;
    payload.statsBonus = equipSync.statsBonus;
  }

  await updateInCol('characters', charId, payload);
  c.inventaire = inv;
  c.compte     = { ...compte, recettes };
  if (equipSync.changed) {
    c.equipement = equipSync.equipement;
    c.statsBonus = equipSync.statsBonus;
  }

  closeModal();
  const unequipMsg = equipSync.removedSlots.length
    ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
    : '';
  showNotif(`💰 ×${qty} "${itemNom}" vendu${qty>1?'s':''} pour ${totalPrix} or !${unequipMsg}`, 'success');
  refreshOrDisplay(c);
  renderCharSheet(c, window._currentCharTab || 'inventaire');
}

// Alias pour compatibilité avec l'ancien code
async function sellInvItem(charId, invIndex) {
  // Construire indicesB64 depuis un index unique
  const b64 = btoa(JSON.stringify([invIndex]));
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  const item = (c?.inventaire||[])[invIndex];
  const pv = parseFloat(item?.prixVente) || Math.round((parseFloat(item?.prixAchat)||0)*0.6);
  openSellInvModal(charId, b64, pv, item?.nom||'objet');
}

// ══════════════════════════════════════════════
// SUPPRIMER avec quantité
// ══════════════════════════════════════════════
function openDeleteInvModal(charId, indicesB64, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  openModal(`🗑️ Supprimer — ${nom}`, `
    <div style="margin-bottom:1rem;font-size:.85rem;color:var(--text-muted)">
      ${maxQte} exemplaire${maxQte>1?'s':''} dans l'inventaire
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">−</button>
        <input type="number" id="del-qty" min="1" max="${maxQte}" value="1" style="width:60px;text-align:center" class="input-field">
        <button type="button" onclick="this.previousElementSibling.stepUp()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">+</button>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-outline btn-sm" style="flex:1;color:#ff6b6b;border-color:rgba(255,107,107,.35)"
        onclick="deleteInvItemBulk('${charId}','${indicesB64}')">🗑️ Supprimer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function deleteInvItemBulk(charId, indicesB64) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  const allIndices = _decodeIndices(indicesB64);
  const qty = Math.min(Math.max(1, parseInt(document.getElementById('del-qty')?.value)||1), allIndices.length);
  const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const removedIndices = allIndices.slice(0, qty);
  const sorted = [...removedIndices].sort((a,b)=>b-a);
  sorted.forEach(idx => inv.splice(idx, 1));
  const equipSync = syncEquipmentAfterInventoryMutation(c, removedIndices);
  const payload = { inventaire: inv };
  if (equipSync.changed) {
    payload.equipement = equipSync.equipement;
    payload.statsBonus = equipSync.statsBonus;
  }
  await updateInCol('characters', charId, payload);
  c.inventaire = inv;
  if (equipSync.changed) {
    c.equipement = equipSync.equipement;
    c.statsBonus = equipSync.statsBonus;
  }
  closeModal();
  const deleteMsg = equipSync.removedSlots.length
    ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
    : '';
  showNotif(`Objet(s) supprimé(s).${deleteMsg}`, 'success');
  renderCharSheet(c, window._currentCharTab || 'inventaire');
}

// ══════════════════════════════════════════════
// ENVOYER UN OBJET À UN AUTRE PERSONNAGE
// ══════════════════════════════════════════════
function openSendInvModal(charId, indicesB64OrIndex, nomOrUnused) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;

  // Accepter soit un indicesB64 (nouveau) soit un index numérique (ancien)
  let indices;
  if (typeof indicesB64OrIndex === 'number') {
    indices = [indicesB64OrIndex];
  } else {
    indices = _decodeIndices(indicesB64OrIndex);
  }
  if (!indices.length) return;

  const item    = (c.inventaire||[])[indices[0]];
  if (!item) return;
  const nom     = nomOrUnused || item.nom || 'Objet';
  const maxQte  = indices.length;
  const b64     = btoa(JSON.stringify(indices));

  const otherChars = STATE.characters?.filter(x => x.id !== charId) || [];
  if (!otherChars.length) { showNotif('Aucun autre personnage disponible.','error'); return; }

  const rareteN  = parseInt(item.rarete) || 0;
  const RARETE_C = ['','#9ca3af','#4ade80','#60a5fa','#c084fc'];
  const itemColor = RARETE_C[rareteN] || 'var(--border)';

  // Carte de l'objet envoyé
  const itemPreview = `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;
      background:var(--bg-elevated);border-radius:10px;border-left:3px solid ${itemColor};
      border:1px solid var(--border);margin-bottom:.85rem">
      <div style="flex:1;min-width:0">
        <div style="font-family:'Cinzel',serif;font-size:.88rem;font-weight:700;color:var(--text)">${nom}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">
          ${item.format||item.slotArmure||item.type||''}${maxQte>1?` · ${maxQte} disponible${maxQte>1?'s':''}`:' · 1 exemplaire'}
        </div>
      </div>
      ${maxQte > 1 ? `
      <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">
        <button type="button" id="send-dec"
          style="width:26px;height:26px;border-radius:6px;border:1px solid var(--border);
          background:var(--bg-card);cursor:pointer;font-size:1rem;color:var(--text);
          display:flex;align-items:center;justify-content:center;line-height:1"
          onclick="const i=document.getElementById('send-qty');i.value=Math.max(1,parseInt(i.value||1)-1)">−</button>
        <input type="number" id="send-qty" min="1" max="${maxQte}" value="1"
          style="width:44px;text-align:center;font-size:.85rem;font-weight:700;
          background:var(--bg-card);border:1px solid var(--border);border-radius:6px;
          color:var(--text);padding:3px 0">
        <button type="button" id="send-inc"
          style="width:26px;height:26px;border-radius:6px;border:1px solid var(--border);
          background:var(--bg-card);cursor:pointer;font-size:1rem;color:var(--text);
          display:flex;align-items:center;justify-content:center;line-height:1"
          onclick="const i=document.getElementById('send-qty');i.value=Math.min(${maxQte},parseInt(i.value||1)+1)">+</button>
      </div>` : ''}
    </div>`;

  // Grille de personnages — plus compact
  const targetCards = otherChars.map(target => {
    const initiale  = (target.nom||'?')[0].toUpperCase();
    const colors    = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
    const couleur   = colors[(target.nom||'').charCodeAt(0) % colors.length];
    const photoPos  = `${50+(target.photoX||0)*50}% ${50+(target.photoY||0)*50}%`;
    return `<label style="display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;
      border-radius:10px;border:2px solid var(--border);background:var(--bg-elevated);
      cursor:pointer;transition:all .12s"
      onmouseover="this.style.borderColor='${couleur}';this.style.background='${couleur}0f'"
      onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg-elevated)'">
      <input type="radio" name="send-target" value="${target.id}"
        style="accent-color:${couleur};flex-shrink:0;width:14px;height:14px">
      <div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;overflow:hidden;
        border:2px solid ${couleur};background:${couleur}18;
        display:flex;align-items:center;justify-content:center">
        ${target.photo
          ? `<img src="${target.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
          : `<span style="font-family:'Cinzel',serif;font-size:.95rem;font-weight:700;color:${couleur}">${initiale}</span>`}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:var(--text);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${target.nom||'?'}</div>
        ${target.ownerPseudo ? `<div style="font-size:.68rem;color:var(--text-dim)">${target.ownerPseudo}</div>` : ''}
      </div>
    </label>`;
  }).join('');

  openModal(`📤 Envoyer`, `
    ${itemPreview}
    <div style="font-size:.72rem;color:var(--text-dim);font-weight:600;
      text-transform:uppercase;letter-spacing:.8px;margin-bottom:.4rem">Destinataire</div>
    <div style="display:flex;flex-direction:column;gap:.35rem;
      max-height:260px;overflow-y:auto">${targetCards}</div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" onclick="sendInvItem('${charId}','${b64}')">📤 Envoyer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function sendInvItem(fromCharId, indicesB64) {
  const fromChar = STATE.characters?.find(x => x.id === fromCharId) || STATE.activeChar;
  if (!fromChar) return;

  const targetId = document.querySelector('input[name="send-target"]:checked')?.value;
  if (!targetId) { showNotif('Sélectionne un personnage cible.','error'); return; }

  const toChar = STATE.characters?.find(x => x.id === targetId);
  if (!toChar) { showNotif('Personnage introuvable.','error'); return; }

  const allIndices = _decodeIndices(indicesB64);
  const maxQte  = allIndices.length;
  const qtyEl   = document.getElementById('send-qty');
  const qty     = qtyEl ? Math.min(Math.max(1, parseInt(qtyEl.value)||1), maxQte) : 1;
  const equippedMap = getEquippedInventoryIndexMap(fromChar);
  const unequippedIndices = allIndices.filter(idx => !(equippedMap.get(idx) || []).length);
  const equippedIndices = allIndices.filter(idx => (equippedMap.get(idx) || []).length);
  const toSend  = [...unequippedIndices, ...equippedIndices].slice(0, qty);

  const fromInv = Array.isArray(fromChar.inventaire) ? [...fromChar.inventaire] : [];
  const firstItem = fromInv[toSend[0]];
  if (!firstItem) return;

  // Objets à transférer
  const itemsToTransfer = toSend.map(idx => ({...fromInv[idx]}));

  // Retirer de la source (du plus grand au plus petit)
  [...toSend].sort((a,b)=>b-a).forEach(idx => fromInv.splice(idx, 1));

  // Ajouter à la cible
  const toInv = Array.isArray(toChar.inventaire) ? [...toChar.inventaire] : [];
  itemsToTransfer.forEach(it => toInv.push(it));

  const equipSync = syncEquipmentAfterInventoryMutation(fromChar, toSend);
  const fromPayload = { inventaire: fromInv };
  if (equipSync.changed) {
    fromPayload.equipement = equipSync.equipement;
    fromPayload.statsBonus = equipSync.statsBonus;
  }

  await Promise.all([
    updateInCol('characters', fromCharId, fromPayload),
    updateInCol('characters', targetId,   { inventaire: toInv }),
  ]);
  fromChar.inventaire = fromInv;
  if (equipSync.changed) {
    fromChar.equipement = equipSync.equipement;
    fromChar.statsBonus = equipSync.statsBonus;
  }
  toChar.inventaire   = toInv;

  closeModal();
  const sendMsg = equipSync.removedSlots.length
    ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
    : '';
  showNotif(`📤 ×${qty} "${firstItem.nom||'objet'}" envoyé${qty>1?'s':''} à ${toChar.nom||'?'} !${sendMsg}`, 'success');
  renderCharSheet(fromChar, window._currentCharTab || 'inventaire');
}
async function adjustStat(stat, delta, charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  const base = stat==='pvActuel'?'pvBase':'pmBase';
  const maxVal = stat==='pvActuel' ? calcPVMax(c) : calcPMMax(c);
  const cur = c[stat]??maxVal;
  const newVal = Math.max(0, Math.min(maxVal, cur+delta));
  c[stat] = newVal;
  await updateInCol('characters', c.id, {[stat]: newVal});

  const p = pct(newVal, maxVal);
  if (stat==='pvActuel') {
    const valEl=document.getElementById('pv-val'), barEl=document.getElementById('pv-bar');
    if(valEl){valEl.textContent=newVal;valEl.style.color=p<25?'var(--crimson-light)':p<50?'#f59e0b':'var(--green)';}
    if(barEl){barEl.style.width=p+'%';barEl.className='cs-bar-fill cs-bar-hp-fill '+(p>50?'high':p>25?'mid':'');}
  } else {
    const valEl=document.getElementById('pm-val'), barEl=document.getElementById('pm-bar');
    if(valEl) valEl.textContent=newVal;
    if(barEl) barEl.style.width=p+'%';
  }
}

async function saveNotes() {
  const c = STATE.activeChar; if(!c) return;
  const notes = document.getElementById('char-notes-area')?.value||'';
  c.notes = notes;
  await updateInCol('characters', c.id, {notes});
  showNotif('Notes sauvegardées !','success');
}

async function toggleSort(idx) {
  const c=STATE.activeChar; if(!c) return;
  const sorts=c.deck_sorts||[];
  sorts[idx].actif=!sorts[idx].actif;
  c.deck_sorts=sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  renderCharSheet(c,'sorts');
}

async function toggleQuete(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.quetes[idx].valide=!c.quetes[idx].valide;
  await updateInCol('characters',c.id,{quetes:c.quetes});
  renderCharSheet(c,'quetes');
}

async function deleteQuete(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.quetes.splice(idx,1);
  await updateInCol('characters',c.id,{quetes:c.quetes});
  renderCharSheet(c,'quetes');
}

async function deleteSort(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.deck_sorts.splice(idx,1);
  await updateInCol('characters',c.id,{deck_sorts:c.deck_sorts});
  renderCharSheet(c,'sorts');
}

async function deleteInvItem(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.inventaire.splice(idx,1);
  await updateInCol('characters',c.id,{inventaire:c.inventaire});
  renderCharSheet(c,'inventaire');
}

async function deleteChar(id) {
  if (!confirm('Supprimer ce personnage ?')) return;
  await deleteFromCol('characters',id);
  showNotif('Personnage supprimé.','success');
  PAGES.characters();
}

async function createNewChar() {
  const data = {
    uid: STATE.user.uid,
    ownerPseudo: STATE.profile?.pseudo||'?',
    nom:'Nouveau personnage', titre:'', titres:[],
    niveau:1, or:0,
    pvBase:10, pvActuel:10, pmBase:10, pmActuel:10,
    exp:0,
    stats:{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10},
    statsBonus:{},
    equipement:{}, inventaire:[], deck_sorts:[], quetes:[], notes:'',
  };
  await addToCol('characters', data);
  showNotif('Personnage créé !','success');
  PAGES.characters();
}

// Gestion des titres via modal compact
function manageTitres(charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  window._editTitres = [...(c.titres||[])];
  const render = () => window._editTitres.map((t,i)=>
    `<span class="cs-titre-chip">${t}<button onclick="removeTitre(${i})">✕</button></span>`
  ).join('');
  openModal('🏅 Titres', `
    <div id="titres-list" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.8rem;min-height:2rem">${render()}</div>
    <div style="display:flex;gap:0.5rem">
      <input class="input-field" id="ei-titre-new" placeholder="Nouveau titre..." style="flex:1" onkeydown="if(event.key==='Enter')addTitre()">
      <button class="btn btn-outline btn-sm" onclick="addTitre()">+ Ajouter</button>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveTitres('${charId}')">Enregistrer</button>
  `);
}

function addTitre() {
  const input = document.getElementById('ei-titre-new');
  const val = input?.value.trim();
  if (!val) return;
  window._editTitres = window._editTitres||[];
  window._editTitres.push(val);
  input.value='';
  _refreshTitresList();
}

function removeTitre(idx) {
  window._editTitres.splice(idx,1);
  _refreshTitresList();
}

function _refreshTitresList() {
  const list = document.getElementById('titres-list');
  if (list) list.innerHTML = window._editTitres.map((t,i)=>
    `<span class="cs-titre-chip">${t}<button onclick="removeTitre(${i})">✕</button></span>`
  ).join('');
}

async function saveTitres(charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  c.titres = window._editTitres||[];
  await updateInCol('characters', charId, {titres: c.titres});
  closeModal();
  renderCharSheet(c, window._currentCharTab);
  showNotif('Titres mis à jour !','success');
}

// Sorts
function addSort() { openSortModal(-1, {}); }
function editSort(idx) { openSortModal(idx, (STATE.activeChar?.deck_sorts||[])[idx]); }

function openSortModal(idx, s) {
  const NOYAUX = ['Feu 🔥','Eau 💧','Terre 🪨','Vent 🌬️','Ombre 🌑','Lumière ✨','Physique 💪'];
  const RUNES = [
    {nom:'Puissance',     effet:'+ 1 dé de dégâts · chaîné : +2 fixe/paire'},
    {nom:'Protection',    effet:'+1d4 soin ou +2 CA (2 tr) · chaîné : soin+2 & CA+1'},
    {nom:'Amplification', effet:'Zone +3m · chaîné : +2m/rune supp.'},
    {nom:'Enchantement',  effet:'Élément sur équip. allié 2 tr → Action Bonus'},
    {nom:'Affliction',    effet:'Élément + état sur équip. ennemi 2 tr → Action Bonus'},
    {nom:'Invocation',    effet:'Créature liée · 10 PV, CA 10'},
    {nom:'Dispersion',    effet:'+1 cible · chaîné : ×2 (2 runes = 4 cibles)'},
    {nom:'Lacération',    effet:'CA cible −1 · chaîné : −1/rune (max −2, Élites −4)'},
    {nom:'Chance',        effet:'RC 19–20, critique max · chaîné : RC−1/rune'},
    {nom:'Durée',         effet:'+2 tours · chaîné : +1 supp./rune'},
    {nom:'Concentration', effet:'Actif jusqu\'à 10 tours · JS Sa DD11 si dégâts'},
    {nom:'Réaction',      effet:'Lance hors de son tour → Réaction'},
  ];

  const runesSrc = s?.runes||[];
  const runeCounts = {};
  runesSrc.forEach(r => { runeCounts[r] = (runeCounts[r]||0) + 1; });
  window._runeCountsEdit = {...runeCounts};

  const noyauSel  = s?.noyau||'';
  // Types existants (multi)
  const typesInit = Array.isArray(s?.types) && s.types.length ? s.types
    : (s?.typeSoin ? ['defensif'] : (s?.noyau ? ['offensif'] : ['utilitaire']));

  window._sortTypesEdit = new Set(typesInit);

  // Action override (Auto / Action / Action Bonus uniquement — Réaction = rune)
  window._sortActionEdit = s?.actionOverride || null;  // null = auto

  const runesHtml = RUNES.map(r => {
    const cnt = window._runeCountsEdit[r.nom]||0;
    const key = r.nom.replace(/\s/g,'_');
    return `<div class="cs-rune-counter" id="rune-row-${key}">
      <div class="cs-rune-counter-info">
        <span class="cs-rune-counter-name ${cnt>0?'selected':''}" id="rune-name-${key}">${r.nom}</span>
        <span class="cs-rune-counter-effet">${r.effet}</span>
      </div>
      <div class="cs-rune-counter-ctrl">
        <button type="button" class="cs-rune-btn minus" onclick="runeDecrement('${r.nom}')" ${cnt===0?'disabled':''}>−</button>
        <span class="cs-rune-count-val" id="rune-cnt-${key}">${cnt}</span>
        <button type="button" class="cs-rune-btn plus" onclick="runeIncrement('${r.nom}')">+</button>
      </div>
    </div>`;
  }).join('');

  const TYPE_CFG = [
    { v:'offensif',   label:'⚔️ Offensif',   color:'#ff6b6b' },
    { v:'defensif',   label:'🛡️ Défensif',   color:'#22c38e' },
    { v:'utilitaire', label:'✨ Utilitaire', color:'#b47fff' },
  ];
  const typeBtnsHtml = TYPE_CFG.map(t => {
    const isSel = typesInit.includes(t.v);
    return `<button type="button" id="s-type-${t.v}" data-type="${t.v}"
      onclick="window._toggleSortType('${t.v}')"
      style="flex:1;padding:.4rem .3rem;border-radius:8px;font-size:.75rem;cursor:pointer;
      border:2px solid ${isSel?t.color:'var(--border)'};
      background:${isSel?t.color+'20':'var(--bg-elevated)'};
      color:${isSel?t.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${t.label}</button>`;
  }).join('');

  const ACTION_CFG = [
    { v:null,           label:'Auto',            color:'#9ca3af' },
    { v:'action',       label:'⚡ Action',        color:'#e8b84b' },
    { v:'action_bonus', label:'✴️ Action Bonus',  color:'#f97316' },
  ];
  const actionBtnsHtml = ACTION_CFG.map(a => {
    const isSel = (window._sortActionEdit === a.v);
    return `<button type="button" id="s-action-${a.v??'auto'}" data-action="${a.v??'auto'}"
      onclick="window._selectSortAction(${a.v===null?'null':`'${a.v}'`})"
      style="flex:1;padding:.35rem .2rem;border-radius:7px;font-size:.7rem;cursor:pointer;
      border:2px solid ${isSel?a.color:'var(--border)'};
      background:${isSel?a.color+'20':'var(--bg-elevated)'};
      color:${isSel?a.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${a.label}</button>`;
  }).join('');

  openModal(idx>=0?'✏️ Modifier le Sort':'✨ Nouveau Sort', `
    <div class="grid-2" style="gap:.6rem;margin-bottom:.5rem">
      <div class="form-group" style="margin:0"><label>Nom</label>
        <input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu...">
      </div>
      <div class="form-group" style="margin:0"><label>Catégorie</label>
        <select class="input-field" id="s-catid">
          <option value="">— Aucune —</option>
          ${(STATE.activeChar?.sort_cats||[]).map(cat =>
            `<option value="${cat.id}" ${s?.catId===cat.id?'selected':''}>${cat.nom}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    <!-- Types (multi-sélection) -->
    <div class="form-group">
      <label>Type(s) <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">— plusieurs possibles</span></label>
      <div style="display:flex;gap:.4rem">${typeBtnsHtml}</div>
    </div>

    <!-- Type d'action -->
    <div class="form-group">
      <label>Action <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">— Auto = déduit des runes · Réaction/Concentration = rune</span></label>
      <div style="display:flex;gap:.3rem" id="s-action-btns">${actionBtnsHtml}</div>
    </div>

    <!-- Noyau -->
    <div class="form-group">
      <label>Noyau élémentaire <span style="color:var(--text-dim);font-weight:400">(2 PM)</span></label>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.map(n => `<div class="cs-noyau-btn ${noyauSel===n?'selected':''}"
             onclick="selectNoyau(this,'${n.replace(/'/g,"\\'")}')">${n}</div>`).join('')}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
    </div>

    <!-- Runes -->
    <div class="form-group">
      <label>Runes <span style="color:var(--text-dim);font-weight:400">(+2 PM chacune, cumulables)</span></label>
      <div class="cs-rune-list">${runesHtml}</div>
    </div>

    <div class="cs-sort-pm-display">
      Coût total : <strong id="s-pm-display">0</strong> PM
      <input type="hidden" id="s-pm" value="${s?.pm||2}">
    </div>

    <!-- Dégâts (si offensif) -->
    <div id="s-degats-section" style="${typesInit.includes('offensif')?'':'display:none'}">
      <div class="form-group"><label>Dégâts <span style="color:var(--text-dim);font-weight:400">(vide = dégâts de l'arme)</span></label>
        <input class="input-field" id="s-degats" value="${s?.degats||''}" placeholder="= arme automatiquement">
      </div>
    </div>

    <!-- Protection : Soin ou CA (visible si rune Protection présente) -->
    <div id="s-prot-section" style="${(s?.runes||[]).includes('Protection') ? '' : 'display:none'}">
      <div class="form-group">
        <label>Rune Protection — effet <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">que fait-elle ?</span></label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'ca',   label:'🛡️ Augmente la CA',  color:'#22c38e', detail:'+2 CA · 2 tours' },
            { v:'soin', label:'💚 Soigne',            color:'#4f8cff', detail:'+1d4 par rune'   },
          ].map(opt => {
            const sel = (s?.protectionMode || 'ca') === opt.v;
            return `<button type="button" id="s-prot-${opt.v}" onclick="window._selectProtMode('${opt.v}')"
              style="flex:1;padding:.5rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.8rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.68rem;color:var(--text-dim);margin-top:.1rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-prot-mode" value="${s?.protectionMode||'ca'}">
      </div>
      <!-- CA custom (visible si mode CA) -->
      <div id="s-ca-section" style="${(s?.protectionMode||'ca')==='ca'?'':'display:none'}">
        <div class="form-group"><label>Effet CA <span style="color:var(--text-dim);font-weight:400">(libre — ex: CA +2 (2 tours))</span></label>
          <input class="input-field" id="s-ca" value="${s?.ca||''}" placeholder="CA +2 (2 tours)">
        </div>
      </div>
      <!-- Soin custom (visible si mode soin) -->
      <div id="s-soin-section" style="${(s?.protectionMode||'ca')==='soin'?'':'display:none'}">
        <div class="form-group"><label>Soin <span style="color:var(--text-dim);font-weight:400">(vide = 1d4 base · XdY = calcul auto)</span></label>
          <input class="input-field" id="s-soin" value="${s?.soin||''}" placeholder="= 1d4 automatiquement">
        </div>
      </div>
    </div>

    <div class="form-group"><label>Description / Effet libre</label>
      <textarea class="input-field" id="s-effet" rows="2">${s?.effet||''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="saveSort(${idx})">Enregistrer</button>
  `);

  setTimeout(() => {
    updateSortPM();
    window._updateSortActionDisplay();

  }, 50);
}

window._toggleSortType = (type) => {
  const TYPE_CFG = {
    offensif:   '#ff6b6b',
    defensif:   '#22c38e',
    utilitaire: '#b47fff',
  };
  if (window._sortTypesEdit.has(type)) {
    if (window._sortTypesEdit.size === 1) return; // garder au moins 1
    window._sortTypesEdit.delete(type);
  } else {
    window._sortTypesEdit.add(type);
  }
  // Mettre à jour visuellement
  Object.entries(TYPE_CFG).forEach(([t, color]) => {
    const btn = document.getElementById(`s-type-${t}`);
    if (!btn) return;
    const active = window._sortTypesEdit.has(t);
    btn.style.borderColor  = active ? color : 'var(--border)';
    btn.style.background   = active ? color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
  // Afficher/masquer sections
  const dSec = document.getElementById('s-degats-section');
  const sSec = document.getElementById('s-soin-section');
  if (dSec) dSec.style.display = window._sortTypesEdit.has('offensif') ? '' : 'none';
  if (sSec) sSec.style.display = window._sortTypesEdit.has('defensif') ? '' : 'none';
};

window._selectSortAction = (val) => {
  window._sortActionEdit = val === 'auto' ? null : val;
  window._updateSortActionDisplay();
};

window._updateSortActionDisplay = () => {
  const ACTION_CFG = {
    null:         { label:'Auto',            color:'#9ca3af' },
    action:       { label:'⚡ Action',        color:'#e8b84b' },
    action_bonus: { label:'✴️ Action Bonus',  color:'#f97316' },
    reaction:     { label:'🔄 Réaction',      color:'#a78bfa' },
  };
  const cur = window._sortActionEdit;
  Object.entries(ACTION_CFG).forEach(([v, cfg]) => {
    const btn = document.getElementById(`s-action-${v === 'null' ? 'auto' : v}`);
    if (!btn) return;
    const active = (cur === null && v === 'null') || cur === v;
    btn.style.borderColor  = active ? cfg.color : 'var(--border)';
    btn.style.background   = active ? cfg.color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? cfg.color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
};

window._selectProtMode = (mode) => {
  const hidden  = document.getElementById('s-prot-mode');
  const caSec   = document.getElementById('s-ca-section');
  const soinSec = document.getElementById('s-soin-section');
  if (hidden)  hidden.value = mode;
  if (caSec)   caSec.style.display   = mode === 'ca'   ? '' : 'none';
  if (soinSec) soinSec.style.display = mode === 'soin' ? '' : 'none';
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
};

function runeIncrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  window._runeCountsEdit[nom] = (window._runeCountsEdit[nom]||0) + 1;
  _updateRuneDisplay(nom);
  updateSortPM();
}

function runeDecrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  if ((window._runeCountsEdit[nom]||0) <= 0) return;
  window._runeCountsEdit[nom]--;
  if (window._runeCountsEdit[nom] === 0) delete window._runeCountsEdit[nom];
  _updateRuneDisplay(nom);
  updateSortPM();
}

function _updateRuneDisplay(nom) {
  const key = nom.replace(/\s/g,'_');
  const cnt = window._runeCountsEdit[nom]||0;
  const valEl  = document.getElementById(`rune-cnt-${key}`);
  const nameEl = document.getElementById(`rune-name-${key}`);
  const minBtn = document.querySelector(`#rune-row-${key} .cs-rune-btn.minus`);
  if (valEl)   valEl.textContent = cnt;
  if (nameEl)  nameEl.classList.toggle('selected', cnt > 0);
  if (minBtn)  minBtn.disabled = cnt === 0;
  // Afficher/masquer la section Protection si rune Protection modifiée
  if (nom === 'Protection') {
    const protSec = document.getElementById('s-prot-section');
    if (protSec) protSec.style.display = cnt > 0 ? '' : 'none';
  }
}

function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(window._runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
  const pm = total * 2 || 2;
  const pmEl = document.getElementById('s-pm');
  const dispEl = document.getElementById('s-pm-display');
  if (pmEl)   pmEl.value = pm;
  if (dispEl) dispEl.textContent = pm;
}

function selectNoyau(el, noyau) {
  document.querySelectorAll('.cs-noyau-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  const input = document.getElementById('s-noyau');
  if (input) { input.value = noyau; updateSortPM(); }
}


async function saveSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  const sorts = c.deck_sorts||[];
  const noyau = document.getElementById('s-noyau')?.value||'';

  // Runes depuis _runeCountsEdit
  const runes = [];
  Object.entries(window._runeCountsEdit||{}).forEach(([nom, cnt]) => {
    for (let i=0; i<cnt; i++) runes.push(nom);
  });

  const totalRunes = (noyau ? 1 : 0) + runes.length;
  const autoPm     = totalRunes * 2 || 2;

  // Types (multi)
  const types = [...(window._sortTypesEdit || new Set(['utilitaire']))];

  // Action override (null = auto)
  const actionOverride = window._sortActionEdit || null;

  const newSort = {
    nom:      document.getElementById('s-nom')?.value||'Sort',
    pm:       autoPm,
    noyau,
    runes,
    types,
    degats:   document.getElementById('s-degats')?.value||'',
    soin:     document.getElementById('s-soin')?.value||'',
    ca:       document.getElementById('s-ca')?.value||'',
    effet:    document.getElementById('s-effet')?.value||'',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    // Legacy compat : typeSoin si defensif sans offensif + mode soin
    typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
    catId:    document.getElementById('s-catid')?.value || '',
    actif:    idx>=0 ? sorts[idx].actif : false,
    actionOverride,
  };
  if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
  c.deck_sorts=sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  closeModalDirect();
  showNotif(`Sort enregistré — ${newSort.pm} PM`, 'success');
  renderCharSheet(c,'sorts');
}


function computeEquipStatsBonus(equip = {}) {
  const bonus = { force:0, dexterite:0, intelligence:0, sagesse:0, constitution:0, charisme:0 };
  Object.values(equip || {}).forEach(it => {
    bonus.force        += parseInt(it?.fo)  || 0;
    bonus.dexterite    += parseInt(it?.dex) || 0;
    bonus.intelligence += parseInt(it?.in)  || 0;
    bonus.sagesse      += parseInt(it?.sa)  || 0;
    bonus.constitution += parseInt(it?.co)  || 0;
    bonus.charisme     += parseInt(it?.ch)  || 0;
  });
  return bonus;
}

function inferAttackStatFromItem(item = {}) {
  if (item.toucherStat) return item.toucherStat;
  if (item.statAttaque) return item.statAttaque;
  const format = String(item.format || '');
  if (format.includes('Mag.')) return 'intelligence';
  if (format.includes('Dist.')) return 'dexterite';
  return 'force';
}

function inferArmorSlotValue(slot, item = {}) {
  if (item.slotArmure) return item.slotArmure;
  if (slot === 'Bottes') return 'Pieds';
  return slot;
}

function inferAccessorySlotValue(slot, item = {}) {
  return item.slotBijou || slot;
}

function buildEquippedItemFromInventory(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');

  if (isWeapon) {
    return {
      nom: item.nom || '',
      traits: Array.isArray(item.traits) ? [...item.traits] : [],
      sousType: item.sousType || '',
      degats: item.degats || '',
      degatsStat: item.degatsStat || inferAttackStatFromItem(item),
      toucherStat: item.toucherStat || inferAttackStatFromItem(item),
      statAttaque: inferAttackStatFromItem(item),
      typeArme: item.typeArme || item.type || '',
      portee: item.portee || '',
      particularite: item.particularite || item.effet || item.description || '',
      format: item.format || '',
      toucher: item.toucher || '',
      stats: item.stats || '',
      fo: parseInt(item.fo) || 0,
      dex: parseInt(item.dex) || 0,
      in: parseInt(item.in) || 0,
      sa: parseInt(item.sa) || 0,
      co: parseInt(item.co) || 0,
      ch: parseInt(item.ch) || 0,
      sourceInvIndex: invIndex,
      itemId: item.itemId || '',
    };
  }

  return {
    nom: item.nom || '',
    traits: Array.isArray(item.traits) ? [...item.traits] : [],
    fo: parseInt(item.fo) || 0,
    dex: parseInt(item.dex) || 0,
    in: parseInt(item.in) || 0,
    sa: parseInt(item.sa) || 0,
    co: parseInt(item.co) || 0,
    ch: parseInt(item.ch) || 0,
    ca: parseInt(item.ca) || 0,
    typeArmure: item.typeArmure || '',
    slotArmure: item.slotArmure ? inferArmorSlotValue(slot, item) : '',
    slotBijou: item.slotBijou ? inferAccessorySlotValue(slot, item) : '',
    sourceInvIndex: invIndex,
    itemId: item.itemId || '',
  };
}

async function equipSlotFromInv(val, slot) {
  if (!val || !val.startsWith('inv:')) return;
  const c = STATE.activeChar; if (!c) return;

  const invIndex = parseInt(val.split(':')[1], 10);
  if (Number.isNaN(invIndex)) return;

  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const equip = { ...(c.equipement || {}) };

  Object.keys(equip).forEach(otherSlot => {
    if (otherSlot !== slot && equip[otherSlot]?.sourceInvIndex === invIndex) {
      delete equip[otherSlot];
    }
  });

  const equippedItem = buildEquippedItemFromInventory(slot, item, invIndex);
  if (!equippedItem) return;

  equip[slot] = equippedItem;
  const bonus = computeEquipStatsBonus(equip);

  c.equipement = equip;
  c.statsBonus = bonus;

  await updateInCol('characters', c.id, { equipement: equip, statsBonus: bonus });
  closeModal();
  showNotif(`Équipement mis à jour : ${item.nom || 'objet'} → ${slot}`, 'success');
  renderCharSheet(c, 'combat');
}

// Équipement — filtré depuis l'inventaire du personnage
function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equipped = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');

  // ── Règles de compatibilité par slot ────────────────────────────────────
  // On filtre d'abord par les champs structurés (format, slotArmure, typeArmure, template)
  // puis on accepte les items sans champ structuré comme fallback (compatibilité anciens items)

  const ARMES_1M_CAC    = ['Arme 1M CaC Phy.'];
  const ARME_SECONDAIRE = ['Arme Secondaire (Bouclier, Torche...)'];
  const TOUTES_ARMES    = ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)'];

  // Main principale : toutes les armes sauf secondaires pures
  // Main secondaire : armes 1M + armes secondaires (bouclier, torche...)
  const SLOT_ARME_FORMATS = {
    'Main principale': ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.'],
    'Main secondaire': [...ARMES_1M_CAC, ...ARME_SECONDAIRE],
  };

  // Slots d'armure → [slotArmure compatible, typeArmure compatible ou null=tous]
  const SLOT_ARMURE = {
    'Tête':    { slot: 'Tête',  types: null },
    'Torse':   { slot: 'Torse', types: null },
    'Bottes':  { slot: 'Pieds', types: null },
    'Amulette':    null, // pas d'armure, items libres
    'Anneau':      null,
    'Objet magique': null,
  };

  const inv = c.inventaire||[];
  const equippedEntries = Object.entries(c.equipement || {});
  const equippedInvIndex = Number.isInteger(equipped?.sourceInvIndex) ? equipped.sourceInvIndex : -1;

  // Filtrer les items compatibles avec ce slot
  const compatibles = inv
    .map((item, invIndex) => ({ item, invIndex }))
    .filter(({ item, invIndex }) => {
      if (!item?.nom) return false;

      const alreadyEquippedElsewhere = equippedEntries.some(([otherSlot, equippedItem]) =>
        otherSlot !== slot && equippedItem?.sourceInvIndex === invIndex
      );
      if (alreadyEquippedElsewhere) return false;

      const tpl = item.template || '';

      if (isWeapon) {
        const formats = SLOT_ARME_FORMATS[slot] || TOUTES_ARMES;
        if (tpl === 'arme' || item.format) {
          // Item structuré : si format vide mais template='arme', accepter dans tous les slots arme
          if (!item.format && tpl === 'arme') return true;
          return formats.includes(item.format);
        }
        // Item non structuré (ancien format) : accepter si le type ressemble à une arme
        const t = (item.type||'').toLowerCase();
        return ['arme','weapon','épée','lance','hache','arc','dague','baguette','baton'].some(k => t.includes(k));
      }

      // Slots d'armure structurés
      const armureRule = SLOT_ARMURE[slot];
      if (armureRule !== undefined) {
        if (armureRule === null) {
          if (tpl === 'bijou' || item.slotBijou) return item.slotBijou === slot;
          return tpl === 'libre' || tpl === 'classique' || (!tpl && !item.format && !item.slotArmure && !item.slotBijou);
        }
        if (tpl === 'armure' || item.slotArmure) {
          // Item structuré : vérifier slotArmure
          return item.slotArmure === armureRule.slot;
        }
        // Item non structuré : accepter si type ressemble à armure
        const t = (item.type||'').toLowerCase();
        return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
      }

      return false;
    });

  // Options pour le select
  const invOptions = compatibles.map(({ item, invIndex }) => {
    // Label enrichi avec les infos structurées
    let label = item.nom;
    if (item.format) label += ` — ${item.format}`;
    else if (item.slotArmure && item.typeArmure) label += ` — ${item.typeArmure}`;
    const isSelected = equippedInvIndex === invIndex || (equippedInvIndex < 0 && equipped.nom === item.nom);
    return `<option value="inv:${invIndex}" ${isSelected?'selected':''}>${label}</option>`;
  }).join('');

  const hasCompat = compatibles.length > 0;

  const isBijou = ['Amulette','Anneau','Objet magique'].includes(slot);

  openModal(`${isWeapon?'⚔️':isBijou?'💍':'🛡️'} Équiper — ${slot}`, `
    ${hasCompat
      ? `<div class="form-group">
          <label>Choisir depuis l'inventaire <span style="font-size:0.72rem;color:var(--text-dim)">· équipe immédiatement</span></label>
          <select class="input-field sh-modal-select" id="eq-inv-sel" data-equip-slot="${slot}" onchange="equipSlotFromInv(this.value, this.dataset.equipSlot)">
            <option value="">— Sélectionner un objet —</option>
            ${invOptions}
          </select>
        </div>
        <div class="cs-equip-divider">
          <span>ou saisir / ajuster manuellement</span>
        </div>`
      : `<div class="cs-equip-empty-inv">
          <span>⚠️ Aucun objet compatible dans l'inventaire.</span>
          <span style="font-size:0.72rem;color:var(--text-dim)">Achète des objets à la boutique ou saisis manuellement.</span>
        </div>`
    }

    <div class="form-group"><label>Nom</label><input class="input-field" id="eq-nom" value="${equipped.nom||''}"></div>

    ${isWeapon ? `
    <!-- ── Arme ── -->
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts</label>
        <input class="input-field" id="eq-degats" value="${equipped.degats||'1d6'}" placeholder="ex: 1d8">
      </div>
      <div class="form-group"><label>Stat d'attaque</label>
        <select class="input-field sh-modal-select" id="eq-stat-attaque">
          <option value="force"        ${(equipped.statAttaque||'force')==='force'?'selected':''}>Force</option>
          <option value="dexterite"    ${equipped.statAttaque==='dexterite'?'selected':''}>Dextérité</option>
          <option value="intelligence" ${equipped.statAttaque==='intelligence'?'selected':''}>Intelligence</option>
          <option value="constitution" ${equipped.statAttaque==='constitution'?'selected':''}>Constitution</option>
          <option value="sagesse" ${equipped.statAttaque==='sagesse'?'selected':''}>Sagesse</option>
          <option value="charisme" ${equipped.statAttaque==='charisme'?'selected':''}>Charisme</option>
        </select>
      </div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Portée</label>
        <input class="input-field" id="eq-portee" value="${equipped.portee||''}" placeholder="ex: Contact / 18m">
      </div>
      <div class="form-group"><label>Type d'arme</label>
        <input class="input-field" id="eq-type-arme" value="${equipped.typeArme||''}" placeholder="ex: Épée, Arc...">
      </div>
    </div>
    <div class="form-group"><label>Traits <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">séparés par des virgules</span></label>
      <input class="input-field" id="eq-traits" value="${(Array.isArray(equipped.traits)?equipped.traits:equipped.trait?[equipped.trait]:[]).join(', ')}" placeholder="ex: Polyvalente, Légère...">
    </div>
    <div class="form-group"><label>Particularité</label>
      <input class="input-field" id="eq-particularite" value="${equipped.particularite||''}" placeholder="ex: +1 magique, Argent...">
    </div>
    `
    : isBijou ? `
    <!-- ── Bijou ── -->
    <div class="form-group"><label>Description / effet</label>
      <input class="input-field" id="eq-particularite" value="${equipped.particularite||''}" placeholder="ex: +1 à tous les jets de sauvegarde">
    </div>
    <div class="form-group"><label>Traits <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">séparés par des virgules</span></label>
      <input class="input-field" id="eq-traits" value="${(Array.isArray(equipped.traits)?equipped.traits:equipped.trait?[equipped.trait]:[]).join(', ')}" placeholder="ex: Résistance feu, Vision nocturne...">
    </div>
    <div class="form-group"><label>Bonus de statistiques</label>
      <div class="grid-4" style="gap:.5rem">
        ${[['fo','For'],['dex','Dex'],['in','Int'],['sa','Sag'],['co','Con'],['ch','Cha'],['ca','CA']].map(([k,l])=>`
          <div class="form-group" style="margin:0"><label style="font-size:.68rem">${l}</label>
            <input type="number" class="input-field" id="eq-${k}" value="${equipped[k]||''}" placeholder="0">
          </div>`).join('')}
      </div>
    </div>
    `
    : `
    <!-- ── Armure ── -->
    <div class="grid-2" style="gap:.8rem">
      <div class="form-group"><label>Type d'armure</label>
        <select class="input-field sh-modal-select" id="eq-type-armure">
          <option value="">— Aucun —</option>
          ${['Légère','Intermédiaire','Lourde'].map(t=>`<option value="${t}" ${(equipped.typeArmure||'')=== t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>CA apportée</label>
        <input type="number" class="input-field" id="eq-ca" value="${equipped.ca||''}" placeholder="0">
      </div>
    </div>
    <div class="form-group"><label>Traits <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">séparés par des virgules</span></label>
      <input class="input-field" id="eq-traits" value="${(Array.isArray(equipped.traits)?equipped.traits:equipped.trait?[equipped.trait]:[]).join(', ')}" placeholder="ex: Résistance, Discrétion désavantage...">
    </div>
    <div class="form-group"><label>Bonus de statistiques</label>
      <div class="grid-4" style="gap:.5rem">
        ${[['fo','For'],['dex','Dex'],['in','Int'],['sa','Sag'],['co','Con'],['ch','Cha']].map(([k,l])=>`
          <div class="form-group" style="margin:0"><label style="font-size:.68rem">${l}</label>
            <input type="number" class="input-field" id="eq-${k}" value="${equipped[k]||''}" placeholder="0">
          </div>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>Particularité</label>
      <input class="input-field" id="eq-particularite" value="${equipped.particularite||''}" placeholder="ex: Résistance aux dégâts de feu...">
    </div>
    `}

    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveEquipSlot('${slot}')">Équiper</button>
      <button class="btn btn-danger" onclick="clearEquipSlot('${slot}')">Retirer</button>
    </div>
  `);
  // Stocker les compatibles pour previewEquipFromInv
  window._equipCompatibles  = compatibles;
  window._equipSelectedMeta = {
    format: equipped.format || '',
    toucher: equipped.toucher || '',
    toucherStat: equipped.toucherStat || inferAttackStatFromItem(equipped),
    degatsStat: equipped.degatsStat || equipped.statAttaque || '',
    stats: equipped.stats || '',
    fo: parseInt(equipped.fo) || 0,
    dex: parseInt(equipped.dex) || 0,
    in: parseInt(equipped.in) || 0,
    sa: parseInt(equipped.sa) || 0,
    co: parseInt(equipped.co) || 0,
    ch: parseInt(equipped.ch) || 0,
    typeArmure: equipped.typeArmure || '',
    slotArmure: equipped.slotArmure || '',
    slotBijou: equipped.slotBijou || '',
    traits: Array.isArray(equipped.traits) ? [...equipped.traits] : [],
    sousType: equipped.sousType || '',
  };
}

// Pré-remplir les champs depuis l'item sélectionné dans l'inventaire
function previewEquipFromInv(val, slot) {
  if (!val || !val.startsWith('inv:')) return;
  const idx  = parseInt(val.split(':')[1], 10);
  const compat = (window._equipCompatibles||[]).find(entry => entry?.invIndex === idx) || (window._equipCompatibles||[])[idx];
  const item = compat?.item || compat;
  if (!item) return;

  const nomEl = document.getElementById('eq-nom');
  if (nomEl) nomEl.value = item.nom||'';

  const isWeapon = slot.startsWith('Main');
  if (isWeapon) {
    if (item.degats && document.getElementById('eq-degats'))
      document.getElementById('eq-degats').value = item.degats;
    // Déduire stat d'attaque depuis le format
    if (item.format) {
      const statSel = document.getElementById('eq-stat-attaque');
      if (statSel) {
        if (item.format.includes('Mag.'))  statSel.value = 'intelligence';
        else if (item.format.includes('Dist.')) statSel.value = 'dexterite';
        else statSel.value = 'force';
      }
    }
    // Traits → champ texte
    const traitsEl = document.getElementById('eq-traits');
    if (traitsEl) {
      const t = Array.isArray(item.traits) ? item.traits : (item.trait ? [item.trait] : []);
      traitsEl.value = t.join(', ');
    }
    // Stocker format, toucher, stats, traits, sousType pour saveEquipSlot
    window._equipSelFormat  = item.format  || '';
    window._equipSelToucher = item.toucher || '';
    window._equipSelStats   = item.stats   || '';
    // Mettre à jour meta avec les infos de l'item sélectionné
    if (window._equipSelectedMeta) {
      window._equipSelectedMeta.format     = item.format  || '';
      window._equipSelectedMeta.toucher    = item.toucher || '';
      window._equipSelectedMeta.stats      = item.stats   || '';
      window._equipSelectedMeta.traits     = Array.isArray(item.traits) ? [...item.traits] : [];
      window._equipSelectedMeta.sousType   = item.sousType || '';
      window._equipSelectedMeta.degatsStat = item.degatsStat || item.statAttaque || 'force';
      window._equipSelectedMeta.toucherStat= item.toucherStat || item.statAttaque || 'force';
    }
  } else {
    // Stocker typeArmure pour saveEquipSlot
    window._equipSelTypeArmure = item.typeArmure||'';
    window._equipSelSlotArmure = item.slotArmure||'';
    if (window._equipSelectedMeta) {
      window._equipSelectedMeta.typeArmure = item.typeArmure || '';
      window._equipSelectedMeta.slotArmure = item.slotArmure || '';
      window._equipSelectedMeta.traits     = Array.isArray(item.traits) ? [...item.traits] : [];
    }
    // Traits → champ texte
    const traitsElA = document.getElementById('eq-traits');
    if (traitsElA) {
      const t = Array.isArray(item.traits) ? item.traits : (item.trait ? [item.trait] : []);
      traitsElA.value = t.join(', ');
    }
    // Type armure → select
    const typeArmureEl = document.getElementById('eq-type-armure');
    if (typeArmureEl && item.typeArmure) typeArmureEl.value = item.typeArmure;
    // Bonus stats depuis item boutique (valeurs numériques)
    ['fo','dex','in','sa','co','ch'].forEach(k => {
      const el = document.getElementById('eq-'+k);
      if (el && item[k] !== undefined) el.value = item[k];
    });
    // CA bonus
    const caEl = document.getElementById('eq-ca');
    if (caEl && item.ca) caEl.value = parseInt(item.ca)||0;
  }

  // Preview enrichi
  const preview = document.getElementById('eq-inv-preview');
  if (preview) {
    const tags = [
      item.format && `<span class="badge badge-gold" style="font-size:.65rem">${item.format}</span>`,
      item.slotArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.slotArmure}</span>`,
      item.typeArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.typeArmure}</span>`,
      item.degats && `<span style="font-size:.75rem;color:#ff6b6b">⚔️ ${item.degats}</span>`,
      item.toucher && `<span style="font-size:.75rem;color:#e8b84b">🎯 ${item.toucher}</span>`,
      item.ca && `<span style="font-size:.75rem;color:#4f8cff">🛡️ CA +${item.ca}</span>`,
    ].filter(Boolean).join(' ');
    preview.innerHTML = `<div class="cs-equip-inv-item" style="margin-top:.5rem;padding:.5rem .75rem;background:var(--bg-elevated);border-radius:8px;border:1px solid var(--border)">
      <strong style="font-size:.85rem">${item.nom}</strong>
      ${tags?`<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.25rem">${tags}</div>`:''}
      ${item.stats?`<div style="font-size:.72rem;color:#4f8cff;margin-top:.2rem">${item.stats}</div>`:''}
      ${_getTraits(item).map(t=>`<div style="font-size:.72rem;color:#b47fff;font-style:italic;margin-top:.1rem">${t}</div>`).join('')}
    </div>`;
  }
}


async function saveEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equip = c.equipement||{};
  const meta = window._equipSelectedMeta || {};
  const isBijou = ['Amulette','Anneau','Objet magique'].includes(slot);

  // Traits depuis champ texte (séparés par virgules)
  const readTraits = () => {
    const raw = document.getElementById('eq-traits')?.value || '';
    return raw.split(',').map(t => t.trim()).filter(Boolean);
  };

  if (slot.startsWith('Main')) {
    equip[slot] = {
      nom:           document.getElementById('eq-nom')?.value||'',
      degats:        document.getElementById('eq-degats')?.value||'',
      degatsStat:    meta.degatsStat || document.getElementById('eq-stat-attaque')?.value || 'force',
      toucherStat:   meta.toucherStat || document.getElementById('eq-stat-attaque')?.value || 'force',
      statAttaque:   document.getElementById('eq-stat-attaque')?.value||'force',
      typeArme:      document.getElementById('eq-type-arme')?.value||'',
      portee:        document.getElementById('eq-portee')?.value||'',
      particularite: document.getElementById('eq-particularite')?.value||'',
      traits:        readTraits(),
      format:        meta.format || '',
      toucher:       meta.toucher || '',
      stats:         meta.stats || '',
      sousType:      meta.sousType || '',
      fo: parseInt(meta.fo)||0, dex: parseInt(meta.dex)||0,
      in: parseInt(meta.in)||0, sa: parseInt(meta.sa)||0,
      co: parseInt(meta.co)||0, ch: parseInt(meta.ch)||0,
    };
  } else if (isBijou) {
    equip[slot] = {
      nom:           document.getElementById('eq-nom')?.value||'',
      particularite: document.getElementById('eq-particularite')?.value||'',
      traits:        readTraits(),
      fo:  parseInt(document.getElementById('eq-fo')?.value)||0,
      dex: parseInt(document.getElementById('eq-dex')?.value)||0,
      in:  parseInt(document.getElementById('eq-in')?.value)||0,
      sa:  parseInt(document.getElementById('eq-sa')?.value)||0,
      co:  parseInt(document.getElementById('eq-co')?.value)||0,
      ch:  parseInt(document.getElementById('eq-ch')?.value)||0,
      ca:  parseInt(document.getElementById('eq-ca')?.value)||0,
      slotBijou:  slot,
      typeArmure: meta.typeArmure||'',
      slotArmure: meta.slotArmure||'',
    };
  } else {
    // Armure : Tête / Torse / Bottes
    equip[slot] = {
      nom:           document.getElementById('eq-nom')?.value||'',
      typeArmure:    document.getElementById('eq-type-armure')?.value || meta.typeArmure||'',
      ca:            parseInt(document.getElementById('eq-ca')?.value)||0,
      traits:        readTraits(),
      particularite: document.getElementById('eq-particularite')?.value||'',
      fo:  parseInt(document.getElementById('eq-fo')?.value)||0,
      dex: parseInt(document.getElementById('eq-dex')?.value)||0,
      in:  parseInt(document.getElementById('eq-in')?.value)||0,
      sa:  parseInt(document.getElementById('eq-sa')?.value)||0,
      co:  parseInt(document.getElementById('eq-co')?.value)||0,
      ch:  parseInt(document.getElementById('eq-ch')?.value)||0,
      slotArmure: meta.slotArmure||'',
    };
  }
  c.equipement = equip;
  const bonus = computeEquipStatsBonus(equip);
  c.statsBonus = bonus;
  await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
  closeModal();
  showNotif('Équipement mis à jour !','success');
  renderCharSheet(c,'combat');
}

async function clearEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equip = c.equipement||{};
  delete equip[slot];
  c.equipement = equip;
  const bonus = computeEquipStatsBonus(equip);
  c.statsBonus = bonus;
  await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
  closeModal();
  showNotif('Emplacement libéré.','success');
  renderCharSheet(c,'combat');
}

// Inventaire
function addInvItem() {
  openModal('🎒 Ajouter un objet', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" placeholder="Potion de soin..."></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" placeholder="Consommable..."></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="1"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="inv-desc" rows="3" placeholder="(Action) Rend 10 PV..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInvItem(-1)">Ajouter</button>
  `);
}

function editInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.inventaire||[])[idx];
  openModal('✏️ Modifier', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" value="${item.nom||''}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" value="${item.type||''}"></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="${item.qte||1}"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="inv-desc" rows="3">${item.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInvItem(${idx})">Enregistrer</button>
  `);
}

async function saveInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const inv = c.inventaire||[];
  const newItem = {
    nom: document.getElementById('inv-nom')?.value||'?',
    type: document.getElementById('inv-type')?.value||'',
    qte: document.getElementById('inv-qte')?.value||'1',
    description: document.getElementById('inv-desc')?.value||'',
  };
  if (idx>=0) inv[idx]=newItem; else inv.push(newItem);
  c.inventaire=inv;
  await updateInCol('characters',c.id,{inventaire:inv});
  closeModal();
  showNotif('Inventaire mis à jour !','success');
  renderCharSheet(c,'inventaire');
}

// Quêtes
function addQuete() {
  openModal('📜 Ajouter une quête', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="q-nom" placeholder="La Crypte Maudite..."></div>
    <div class="form-group"><label>Type</label><input class="input-field" id="q-type" placeholder="Principale, Secondaire..."></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="q-desc" rows="3" placeholder="Objectif..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveQuete()">Ajouter</button>
  `);
}

async function saveQuete() {
  const c = STATE.activeChar; if(!c) return;
  const quetes = c.quetes||[];
  quetes.push({
    nom: document.getElementById('q-nom')?.value||'?',
    type: document.getElementById('q-type')?.value||'',
    description: document.getElementById('q-desc')?.value||'',
    valide: false,
  });
  c.quetes=quetes;
  await updateInCol('characters',c.id,{quetes});
  closeModal();
  showNotif('Quête ajoutée !','success');
  renderCharSheet(c,'quetes');
}

// Photo
function deleteCharPhoto(id) {
  const c = STATE.characters.find(x=>x.id===id)||STATE.activeChar;
  if (!c) return;
  c.photo=null; c.photoZoom=1; c.photoX=0; c.photoY=0;
  updateInCol('characters',id,{photo:null,photoZoom:1,photoX:0,photoY:0});
  renderCharSheet(c, window._currentCharTab);
}

// ══════════════════════════════════════════════
// MAÎTRISES D'ARMES
// ══════════════════════════════════════════════
function renderCharMaitrises(c, canEdit) {
  const maitrises = c.maitrises || [];

  let html = `
  <div style="padding:.75rem .25rem">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.85rem">
      <div>
        <div style="font-family:'Cinzel',serif;font-size:.95rem;color:var(--text)">Maîtrises d'armes</div>
        <div style="font-size:.74rem;color:var(--text-dim);margin-top:2px">
          Chaque niveau de maîtrise ajoute +1 aux dégâts des armes du type correspondant.
        </div>
      </div>
      ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="addMaitrise()">+ Ajouter</button>` : ''}
    </div>`;

  if (maitrises.length === 0) {
    html += `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic;font-size:.83rem">
      ${canEdit ? 'Aucune maîtrise — clique sur "+ Ajouter" pour en créer une.' : 'Aucune maîtrise enregistrée.'}
    </div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:.5rem">`;
    maitrises.forEach((m, i) => {
      const niveau = parseInt(m.niveau) || 0;
      // Barre de progression : niveau max = 5
      const MAX = 5;
      const pct = Math.min(100, Math.round(niveau / MAX * 100));
      html += `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:.7rem .85rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem">
          <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600">
            ⚔️ ${m.typeArme||'?'}
          </div>
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:.75rem;color:var(--gold);font-weight:700;background:rgba(232,184,75,.1);
              border:1px solid rgba(232,184,75,.25);border-radius:6px;padding:2px 8px">
              Maîtrise ${niveau > 0 ? '+'+niveau : '0'}
            </span>
            ${canEdit ? `
            <button class="btn-icon" style="font-size:.8rem" onclick="editMaitrise(${i})">✏️</button>
            <button class="btn-icon" style="font-size:.8rem;color:#ff6b6b" onclick="deleteMaitrise(${i})">🗑️</button>
            ` : ''}
          </div>
        </div>
        <!-- Barre de maîtrise -->
        <div style="display:flex;align-items:center;gap:.6rem">
          <div style="flex:1;background:var(--bg-card);border-radius:999px;height:6px;overflow:hidden;border:1px solid var(--border)">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--gold),#e8b84b);border-radius:999px;transition:width .4s"></div>
          </div>
          <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">Niv. ${niveau}/${MAX}</span>
        </div>
        ${m.note ? `<div style="font-size:.72rem;color:var(--text-dim);margin-top:.3rem;font-style:italic">${m.note}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  html += `
    <div style="margin-top:1rem;padding:.6rem .75rem;background:rgba(232,184,75,.05);
      border:1px solid rgba(232,184,75,.15);border-radius:8px;font-size:.75rem;color:var(--text-dim)">
      💡 Le bonus s'applique automatiquement si le type d'arme équipée correspond (ex: "Épée" correspond à une arme de type "Épée").
    </div>
  </div>`;

  return html;
}

// Construit le sélecteur de type d'arme (sousTypes de la boutique + valeur courante)
function _maitriseSousTypeSelect(current = '') {
  const shopTypes = window._shopSousTypes || [];
  // Fusionner avec les maitrises existantes du perso pour ne rien perdre
  const existing = (STATE.activeChar?.maitrises||[]).map(m=>m.typeArme).filter(Boolean);
  const all = [...new Set([...shopTypes, ...existing])].sort();

  if (all.length === 0) {
    // Boutique pas encore visitée — input texte fallback
    return `<input class="input-field" id="mait-type" value="${current}" placeholder="Arc, Épée, Lance...">
      <div style="font-size:.7rem;color:var(--text-dim);margin-top:.3rem">
        💡 Visitez la boutique une fois pour charger la liste des types disponibles.
      </div>`;
  }

  const options = all.map(t =>
    `<option value="${t}" ${t === current ? 'selected' : ''}>${t}</option>`
  ).join('');

  return `<select class="input-field" id="mait-type">
    ${current && !all.includes(current) ? `<option value="${current}" selected>${current}</option>` : ''}
    <option value="" ${!current ? 'selected' : ''} disabled>— Choisir un type —</option>
    ${options}
  </select>`;
}

async function addMaitrise() {
  const c = STATE.activeChar; if (!c) return;
  openModal('⚔️ Nouvelle maîtrise', `
    <div class="form-group"><label>Type d'arme</label>
      ${_maitriseSousTypeSelect('')}
    </div>
    <div class="form-group">
      <label>Niveau <span style="color:var(--text-dim);font-weight:400">(+1 aux dégâts par niveau)</span></label>
      <input type="number" class="input-field" id="mait-niveau" value="1" min="0" max="5">
    </div>
    <div class="form-group"><label>Note (optionnel)</label>
      <input class="input-field" id="mait-note" placeholder="Obtenu lors de la mission X...">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="saveMaitrise(-1)">Ajouter</button>
  `);
}

async function editMaitrise(idx) {
  const c = STATE.activeChar; if (!c) return;
  const m = (c.maitrises || [])[idx]; if (!m) return;
  openModal('✏️ Modifier la maîtrise', `
    <div class="form-group"><label>Type d'arme</label>
      ${_maitriseSousTypeSelect(m.typeArme||'')}
    </div>
    <div class="form-group">
      <label>Niveau</label>
      <input type="number" class="input-field" id="mait-niveau" value="${m.niveau||1}" min="0" max="5">
    </div>
    <div class="form-group"><label>Note (optionnel)</label>
      <input class="input-field" id="mait-note" value="${m.note||''}">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="saveMaitrise(${idx})">Enregistrer</button>
  `);
}

async function saveMaitrise(idx) {
  const typeArme = document.getElementById('mait-type')?.value?.trim();
  if (!typeArme) { showNotif('Le type d\'arme est requis.', 'error'); return; }
  const niveau = parseInt(document.getElementById('mait-niveau')?.value) || 0;
  const note   = document.getElementById('mait-note')?.value?.trim() || '';
  const c = STATE.activeChar; if (!c) return;
  const maitrises = [...(c.maitrises || [])];
  const entry = { typeArme, niveau, note };
  if (idx < 0) maitrises.push(entry);
  else maitrises[idx] = entry;
  c.maitrises = maitrises;
  await updateInCol('characters', c.id, { maitrises });
  closeModal();
  showNotif(idx < 0 ? `Maîtrise "${typeArme}" ajoutée !` : 'Maîtrise mise à jour.', 'success');
  renderCharSheet(c, 'maitrises');
}

async function deleteMaitrise(idx) {
  const c = STATE.activeChar; if (!c) return;
  const m = (c.maitrises || [])[idx];
  if (!confirm(`Supprimer la maîtrise "${m?.typeArme||'?'}" ?`)) return;
  c.maitrises = (c.maitrises || []).filter((_, i) => i !== idx);
  await updateInCol('characters', c.id, { maitrises: c.maitrises });
  showNotif('Maîtrise supprimée.', 'success');
  renderCharSheet(c, 'maitrises');
}

// ══════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════
Object.assign(window, {
  selectChar, filterAdminChars,
  sellInvItem, openSellInvModal, sellInvItemBulk,
  openDeleteInvModal, deleteInvItemBulk,
  openSendInvModal, sendInvItem,
  calcOr, refreshOrDisplay, calcPalier,
  selectNoyau, runeIncrement, runeDecrement,
  sortDragStart, sortDragOver, sortDragEnd, sortDrop,
  toggleSortDetail,
  previewXpBar, saveXpDirect,
  renderCharCompte,
  addCompteRow, deleteCompteRow, inlineEditCompteField,
  addNote, editNoteTitle, saveNote, deleteNote, toggleNote,
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  renderCharSheet, showCharTab,
  renderCharCarac, renderCharEquip, renderCharDeck,
  _renderInventaireBoutique,
  renderCharInventaire, renderCharQuetes, renderCharNotes,
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete, deleteSort, deleteInvItem, deleteChar,
  createNewChar,
  inlineEditText, inlineEditNum, inlineEditStatFromCard, inlineEditStat,
  manageTitres, addTitre, removeTitre, saveTitres,
  addSort, editSort, openSortModal, runeIncrement, runeDecrement, updateSortPM, saveSort,
  renderCharMaitrises,
  addMaitrise, editMaitrise, saveMaitrise, deleteMaitrise,
  editEquipSlot, saveEquipSlot, clearEquipSlot, equipSlotFromInv,
  previewEquipFromInv,
  addInvItem, editInvItem, saveInvItem,
  addQuete, saveQuete,
  deleteCharPhoto,
  openCombatStylesAdmin,
  openSortCatEditor,
});
