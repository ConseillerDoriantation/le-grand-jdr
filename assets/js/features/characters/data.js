import { getDocData, saveDoc } from '../../data/firestore.js';
import { openModal, closeModal, confirmModal } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { loadWeaponFormats, saveWeaponFormats } from '../../shared/weapon-formats.js';
import { loadDamageTypes, saveDamageTypes, DEFAULT_DAMAGE_TYPES } from '../../shared/damage-types.js';
import { loadSpellMatrices, saveSpellMatrices, SPELL_SLOTS, SLOT_LABELS, COMBO_IDS, COMBO_DEFAULTS } from '../../shared/spell-matrices.js';
import { _esc, modStr } from '../../shared/html.js';
import { computeEquipStatsBonus, getMod, getMaitriseBonus as _getMaitriseBonus } from '../../shared/char-stats.js';

// ══════════════════════════════════════════════
// ARME PAR DÉFAUT — Poings (mains nues)
// Si "Main principale" est vide, le personnage frappe à mains nues :
//   - 2d4 de dégâts (au lieu de 1d6)
//   - Force pour le toucher ET les dégâts
// ══════════════════════════════════════════════
export const DEFAULT_UNARMED = Object.freeze({
  nom:         'Poings',
  degats:      '2d4',
  statAttaque: 'force',
  format:      'À une main',
  portee:      1,
  icon:        '👊',
  isDefault:   true, // flag pour distinguer de l'équipement réel
});

/**
 * Retourne l'arme principale équipée, ou un objet "Poings" virtuel si vide.
 * Toujours un objet utilisable (jamais null/undefined).
 */
export function getMainWeapon(c) {
  const mainP = c?.equipement?.['Main principale'];
  if (mainP && mainP.nom) return mainP;
  return { ...DEFAULT_UNARMED };
}

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
  } catch (e) { notifySaveError(e); }
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

export function _renderWeaponFormatsModal(formats) {
  const magBadge = (isMagic, i) => {
    const on = !!isMagic;
    return `<button
      onclick="window._toggleWeaponFormatMagic(${i})"
      style="padding:.25rem .55rem;border-radius:7px;font-size:.7rem;font-weight:700;cursor:pointer;
             border:1px solid ${on ? '#b47fff' : 'var(--border)'};
             background:${on ? 'rgba(180,127,255,.18)' : 'var(--bg-base)'};
             color:${on ? '#c084fc' : 'var(--text-dim)'};white-space:nowrap"
      title="${on ? 'Cliquer pour passer en physique' : 'Cliquer pour passer en magique'}">
      ${on ? '🔮 Magique' : '💪 Physique'}
    </button>`;
  };

  openModal('⚔️ Formats d\'armes', `
    <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.75rem">
      Ces formats apparaissent dans la boutique et dans les styles de combat.<br>
      <span style="color:#c084fc">Magique</span> = le joueur choisit son élément à l'attaque.
      <span style="color:#9ca3af">Physique</span> = toujours dégâts physiques.
    </div>
    <div id="wf-list" style="display:flex;flex-direction:column;gap:.35rem">
      ${formats.map((f, i) => `
      <div style="display:flex;align-items:center;gap:.5rem;background:var(--bg-elevated);
        border:1px solid var(--border);border-radius:8px;padding:.45rem .7rem">
        <span style="flex:1;font-size:.84rem;color:var(--text)">${_esc(f.label)}</span>
        ${magBadge(f.isMagic, i)}
        <button class="btn-icon" style="font-size:.7rem;color:#ff6b6b" onclick="window._deleteWeaponFormat(${i})">🗑️</button>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.75rem">
      <input class="input-field" id="wf-new-label" placeholder="Nouveau format..." style="flex:1">
      <button class="btn btn-gold btn-sm" onclick="window._addWeaponFormat()">+ Ajouter</button>
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.5rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="window.openDamageTypesAdmin()">⚡ Types de dégâts…</button>
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="closeModal()">Fermer</button>
    </div>
  `);
  setTimeout(() => document.getElementById('wf-new-label')?.focus(), 60);
}

window._toggleWeaponFormatMagic = async (i) => {
  const formats = [...(_weaponFormats || [])];
  if (!formats[i]) return;
  const nowMagic = !formats[i].isMagic;
  formats[i] = { ...formats[i], isMagic: nowMagic, damageType: nowMagic ? '' : 'physique' };
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
  _renderWeaponFormatsModal(formats);
};

window._addWeaponFormat = async () => {
  const label = document.getElementById('wf-new-label')?.value?.trim();
  if (!label) { showNotif('Nom requis.', 'error'); return; }
  const formats = _weaponFormats ? [..._weaponFormats] : [];
  if (formats.some(f => f.label.toLowerCase() === label.toLowerCase())) {
    showNotif('Ce format existe déjà.', 'error'); return;
  }
  formats.push({ id: `fmt_${Date.now()}`, label, damageType: 'physique', isMagic: false });
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
    const isMagic = !!t.isMagic;
    return `
    <div style="display:flex;flex-wrap:wrap;gap:.4rem .8rem;margin-top:.35rem;padding:.35rem .5rem;
      background:var(--bg-base);border-radius:6px;font-size:.76rem;color:var(--text-dim)">
      <label style="display:flex;align-items:center;gap:.3rem">
        <input type="text" class="input-field" value="${_esc(t.icon||'')}"
          style="width:38px;font-size:.85rem;text-align:center;padding:2px 4px"
          placeholder="🔥" title="Icône"
          onchange="window._saveDmgTypeProp(${i},'icon',this.value)">
        <input type="color" value="${t.color||'#9ca3af'}" title="Couleur"
          style="width:26px;height:22px;border:none;border-radius:4px;cursor:pointer;background:none;padding:0"
          onchange="window._saveDmgTypeProp(${i},'color',this.value)">
      </label>
      <label style="display:flex;align-items:center;gap:.3rem">
        <input type="checkbox" ${isMagic ? 'checked' : ''}
          onchange="window._saveDmgTypeProp(${i},'isMagic',this.checked)"
          title="Type magique — armes magiques peuvent utiliser cet élément">
        Magique
      </label>
      <label style="display:flex;align-items:center;gap:.3rem">
        Raté
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
      Chaque type définit des règles appliquées automatiquement dans le VTT.<br>
      <span style="color:var(--gold)">Magique</span> = armes magiques et sorts peuvent utiliser cet élément.
    </div>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${types.map((t, i) => `
      <div style="background:var(--bg-elevated);border:1px solid ${t.color||'var(--border)'};border-radius:8px;padding:.5rem .7rem">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="font-size:1rem;min-width:1.2rem;text-align:center">${t.icon||'—'}</span>
          <input class="input-field" value="${_esc(t.label)}" style="flex:1;font-size:.84rem"
            onchange="window._saveDmgTypeProp(${i},'label',this.value)">
          <button class="btn-icon" style="font-size:.7rem;color:#ff6b6b"
            onclick="window._deleteDmgType(${i})">🗑️</button>
        </div>
        ${mkRules(t, i)}
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.75rem">
      <input class="input-field" id="dt-new-icon" placeholder="🌊" style="width:44px;text-align:center">
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
  const icon  = document.getElementById('dt-new-icon')?.value?.trim() || '';
  if (!label) { showNotif('Nom requis.', 'error'); return; }
  const types = [...(_damageTypes || [])];
  if (types.some(t => t.label.toLowerCase() === label.toLowerCase())) {
    showNotif('Ce type existe déjà.', 'error'); return;
  }
  types.push({
    id:      `dt_${Date.now()}`,
    label,
    icon,
    color:   '#9ca3af',
    isMagic: true,
    rules:   { missEffect: 'half', armorPen: 0, dmgBonus: 0 },
  });
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
// MATRICES DE SORTS — Admin (Enchantement / Affliction / Protection CA)
// Source : world/spell_matrices · UI multi-onglets, sauvegarde explicite
// ══════════════════════════════════════════════

let _spellMatricesDraft = null; // brouillon en cours d'édition
let _spellMatricesTab   = 'enchant';

export async function openSpellMatricesAdmin() {
  const [types, matrices] = await Promise.all([loadDamageTypes(), loadSpellMatrices()]);
  // Copie profonde pour éviter de muter le cache avant Enregistrer
  _spellMatricesDraft = {
    enchant:      { ...(matrices.enchant      || {}) },
    affliction:   { ...(matrices.affliction   || {}) },
    protectionCA: { ...(matrices.protectionCA || {}) },
    combos:       { ...(matrices.combos       || {}) },
    combo_arms:   { ...(matrices.combo_arms   || {}) },
  };
  _spellMatricesTab = 'enchant';
  _renderSpellMatricesModal(types);
}

function _renderSpellMatricesModal(types) {
  const TABS = [
    { id:'enchant',      label:'✨ Enchantement',     desc:'Effets sur les alliés (Action Bonus · 2 tours)' },
    { id:'affliction',   label:'💀 Affliction',       desc:'Effets sur les ennemis (Action · 2 tours)'      },
    { id:'protectionCA', label:'🛡️ Protection CA',    desc:'Variantes du bonus CA par élément'              },
    { id:'combos',       label:'🔗 Combos',           desc:'Activer / renommer les combos de runes'         },
    { id:'combo_arms',   label:'⚔️ Armes invoquées',  desc:'Arme par élément pour le combo Enchant+Invoc'   },
  ];

  const tabBtns = TABS.map(t => {
    const active = _spellMatricesTab === t.id;
    return `<button type="button" onclick="window._switchSpellMatrixTab('${t.id}')"
      style="flex:1;padding:.5rem .4rem;border-radius:8px 8px 0 0;font-size:.78rem;cursor:pointer;
        border:1px solid var(--border);border-bottom:none;
        background:${active?'var(--bg-elevated)':'var(--bg-base)'};
        color:${active?'var(--text)':'var(--text-dim)'};
        font-weight:${active?'700':'400'};margin-bottom:-1px">${t.label}</button>`;
  }).join('');

  const currentTab = TABS.find(t => t.id === _spellMatricesTab);
  let tabBodyHtml = '';

  if (_spellMatricesTab === 'protectionCA') {
    // Tableau : élément → mod CA + note
    tabBodyHtml = `
      <p style="font-size:.74rem;color:var(--text-dim);margin:.4rem 0 .6rem">
        Bonus de CA par rune Protection selon l'élément du noyau.
        Valeur par défaut : <strong>+2</strong> par rune. La note s'affiche dans la fiche du sort.
      </p>
      <div style="display:flex;flex-direction:column;gap:.35rem">
        ${types.map(t => {
          const ov  = _spellMatricesDraft.protectionCA[t.id] || {};
          const mod = ov.mod ?? 2;
          const note = ov.note || '';
          return `<div style="display:flex;align-items:center;gap:.5rem;background:var(--bg-elevated);
            border:1px solid var(--border);border-radius:7px;padding:.4rem .6rem">
            <span style="min-width:120px;font-size:.85rem;color:${t.color||'var(--text)'};font-weight:600">${t.icon||''} ${_esc(t.label)}</span>
            <label style="display:flex;align-items:center;gap:.25rem;font-size:.72rem;color:var(--text-dim)">
              CA /rune
              <input type="number" min="0" max="10" step="1" value="${mod}"
                onchange="window._setSpellMatrixCAMod('${t.id}', this.value)"
                style="width:48px;padding:.2rem;text-align:center;background:var(--bg-base);
                border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:.85rem">
            </label>
            <input class="input-field" placeholder="Note (ex: désavantage à distance contre la cible)"
              value="${_esc(note)}" oninput="window._setSpellMatrixCANote('${t.id}', this.value)"
              style="flex:1;font-size:.74rem;padding:.25rem .45rem">
          </div>`;
        }).join('')}
      </div>`;
  } else if (_spellMatricesTab === 'combos') {
    // Liste des combos avec checkbox enabled + champ nom personnalisé
    const COMBO_DESCS = {
      drain:               'Puissance + Protection → dégâts ET soin sur le même lancer',
      zone_elargie:        'Amplification + Dispersion → Dispersion élargit la zone au lieu d\'ajouter des cibles',
      arme_invoquee:       'Enchantement + Invocation → manifeste une arme magique élémentaire (voir onglet Armes invoquées)',
      allonge_magique:     'Enchantement (Arme) + Amplification → portée d\'arme étendue au lieu d\'une zone',
      sentinelle:          'Affliction + Invocation → sentinelle stationnaire qui afflige à l\'entrée',
      canalise_persistant: 'Durée + Concentration → tient tant que la concentration · grâce après rupture',
      bouclier_reactif:    'Réaction + Protection (CA) → consommé en réaction à une attaque entrante',
    };
    tabBodyHtml = `
      <p style="font-size:.74rem;color:var(--text-dim);margin:.4rem 0 .6rem">
        Active ou désactive chaque combo, et renomme-le si tu veux un libellé personnalisé.
        Décocher un combo le retire de la détection automatique côté joueur.
      </p>
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${COMBO_IDS.map(id => {
          const def = COMBO_DEFAULTS[id] || { enabled: true, name: id };
          const ov  = _spellMatricesDraft.combos[id] || {};
          const enabled = ov.enabled !== undefined ? !!ov.enabled : def.enabled;
          const name    = (ov.name && ov.name.trim()) || def.name;
          return `<div style="display:flex;align-items:center;gap:.55rem;background:var(--bg-elevated);
            border:1px solid var(--border);border-radius:8px;padding:.5rem .7rem">
            <label style="display:flex;align-items:center;gap:.35rem;cursor:pointer;font-size:.78rem">
              <input type="checkbox" ${enabled?'checked':''}
                onchange="window._setSpellMatrixComboEnabled('${id}', this.checked)">
              <span style="color:${enabled?'var(--text)':'var(--text-dim)'};font-weight:${enabled?'700':'400'}">${def.name}</span>
            </label>
            <input class="input-field" placeholder="Nom personnalisé (vide = ${_esc(def.name)})"
              value="${_esc(ov.name||'')}"
              oninput="window._setSpellMatrixComboName('${id}', this.value)"
              style="flex:1;font-size:.74rem;padding:.25rem .45rem">
            <span style="font-size:.66rem;color:var(--text-dim);font-style:italic;min-width:50%;text-align:right">${COMBO_DESCS[id] || ''}</span>
          </div>`;
        }).join('')}
      </div>`;
  } else if (_spellMatricesTab === 'combo_arms') {
    // Matrice : élément → arme invoquée (nom, dégâts, stat, portée, note)
    const statOpts = [
      { v:'force',        l:'Force'        },
      { v:'dexterite',    l:'Dextérité'    },
      { v:'intelligence', l:'Intelligence' },
      { v:'constitution', l:'Constitution' },
      { v:'sagesse',      l:'Sagesse'      },
      { v:'charisme',     l:'Charisme'     },
    ];
    tabBodyHtml = `
      <p style="font-size:.74rem;color:var(--text-dim);margin:.4rem 0 .6rem">
        Définit l'arme manifestée pour chaque élément quand le combo
        <strong>Enchantement + Invocation</strong> est actif. Laisse vide pour utiliser le fallback générique 1d8.
      </p>
      <div style="display:flex;flex-direction:column;gap:.55rem;max-height:55vh;overflow-y:auto;padding-right:.3rem">
        ${types.map(t => {
          const a = _spellMatricesDraft.combo_arms[t.id] || {};
          return `<div style="background:var(--bg-elevated);border:1px solid var(--border);
            border-radius:8px;padding:.5rem .7rem">
            <div style="font-size:.85rem;color:${t.color||'var(--text)'};font-weight:700;margin-bottom:.4rem">
              ${t.icon||''} ${_esc(t.label)}
            </div>
            <div style="display:grid;grid-template-columns:1.4fr .9fr 1fr 1fr .6fr 1.6fr;gap:.35rem;align-items:end">
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Arme</span>
                <input class="input-field" placeholder="ex : Épée flottante"
                  value="${_esc(a.weapon||'')}"
                  oninput="window._setSpellMatrixArm('${t.id}','weapon', this.value)"
                  style="font-size:.76rem;padding:.25rem .4rem">
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Dégâts</span>
                <input class="input-field" placeholder="ex : 1d8 +2"
                  value="${_esc(a.degats||'')}"
                  oninput="window._setSpellMatrixArm('${t.id}','degats', this.value)"
                  style="font-size:.76rem;padding:.25rem .4rem">
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Stat Toucher</span>
                <select class="input-field"
                  onchange="window._setSpellMatrixArm('${t.id}','statToucher', this.value)"
                  style="font-size:.74rem;padding:.25rem .4rem">
                  ${statOpts.map(o => `<option value="${o.v}" ${(a.statToucher||a.stat||'force')===o.v?'selected':''}>${o.l}</option>`).join('')}
                </select>
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Stat Dégâts</span>
                <select class="input-field"
                  onchange="window._setSpellMatrixArm('${t.id}','statDegats', this.value)"
                  style="font-size:.74rem;padding:.25rem .4rem">
                  ${statOpts.map(o => `<option value="${o.v}" ${(a.statDegats||a.stat||'force')===o.v?'selected':''}>${o.l}</option>`).join('')}
                </select>
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Portée (m)</span>
                <input type="number" min="1" max="30" placeholder="1"
                  value="${a.portee||''}"
                  oninput="window._setSpellMatrixArm('${t.id}','portee', this.value)"
                  style="font-size:.76rem;padding:.25rem .4rem;background:var(--bg-base);
                  border:1px solid var(--border);border-radius:5px;color:var(--text);text-align:center">
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Note (propriétés)</span>
                <input class="input-field" placeholder="ex : Action Bonus chaque tour…"
                  value="${_esc(a.note||'')}"
                  oninput="window._setSpellMatrixArm('${t.id}','note', this.value)"
                  style="font-size:.74rem;padding:.25rem .4rem">
              </label>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    // Tableau (élément × slot) → effet texte
    const catKey = _spellMatricesTab;
    const placeholderEx = catKey === 'enchant'
      ? 'ex : Vision Nocturne, Vitesse +2 cases…'
      : 'ex : Cécité, DoT 1d4+2/tour, Entrave…';
    tabBodyHtml = `
      <p style="font-size:.74rem;color:var(--text-dim);margin:.4rem 0 .6rem">
        Pour chaque <strong>(élément × slot)</strong>, décris l'effet thématique appliqué.
        Vide = aucune suggestion pour cette combinaison (le joueur devra taper l'effet manuellement).
      </p>
      <div style="display:flex;flex-direction:column;gap:.55rem;max-height:55vh;overflow-y:auto;padding-right:.3rem">
        ${types.map(t => {
          const row = _spellMatricesDraft[catKey][t.id] || {};
          return `<div style="background:var(--bg-elevated);border:1px solid var(--border);
            border-radius:8px;padding:.5rem .7rem">
            <div style="font-size:.85rem;color:${t.color||'var(--text)'};font-weight:700;margin-bottom:.4rem">
              ${t.icon||''} ${_esc(t.label)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.35rem">
              ${SPELL_SLOTS.map(slot => {
                const val = row[slot] || '';
                return `<label style="display:flex;flex-direction:column;gap:.15rem">
                  <span style="font-size:.7rem;color:var(--text-dim);font-weight:600">${SLOT_LABELS[slot]}</span>
                  <input class="input-field" placeholder="${placeholderEx}"
                    value="${_esc(val)}"
                    oninput="window._setSpellMatrixEffect('${catKey}','${t.id}','${slot}', this.value)"
                    style="font-size:.76rem;padding:.3rem .45rem">
                </label>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  openModal('🔮 Matrices de sorts', `
    <p style="font-size:.78rem;color:var(--text-dim);margin-bottom:.6rem">
      ${currentTab.desc}<br>
      <em style="font-size:.7rem">Les effets remplis ici sont proposés aux joueurs sous forme de suggestion cliquable.
      Ils restent libres de saisir leur propre effet.</em>
    </p>
    <div style="display:flex;gap:.15rem;margin-bottom:0">${tabBtns}</div>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:0 8px 8px 8px;padding:.7rem">
      ${tabBodyHtml}
    </div>
    <div style="display:flex;gap:.4rem;margin-top:.7rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="closeModal()">Annuler</button>
      <button class="btn btn-gold btn-sm"    style="flex:2" onclick="window._saveSpellMatrices()">💾 Enregistrer les matrices</button>
    </div>
  `);
}

window._switchSpellMatrixTab = (tab) => {
  _spellMatricesTab = tab;
  loadDamageTypes().then(types => _renderSpellMatricesModal(types));
};

window._setSpellMatrixEffect = (catKey, elementId, slot, value) => {
  if (!_spellMatricesDraft[catKey][elementId]) _spellMatricesDraft[catKey][elementId] = {};
  const v = (value || '').trim();
  if (v) _spellMatricesDraft[catKey][elementId][slot] = v;
  else   delete _spellMatricesDraft[catKey][elementId][slot];
  if (Object.keys(_spellMatricesDraft[catKey][elementId]).length === 0) {
    delete _spellMatricesDraft[catKey][elementId];
  }
};

window._setSpellMatrixCAMod = (elementId, val) => {
  const n = parseInt(val);
  if (!Number.isFinite(n)) return;
  if (!_spellMatricesDraft.protectionCA[elementId]) _spellMatricesDraft.protectionCA[elementId] = {};
  _spellMatricesDraft.protectionCA[elementId].mod = Math.max(0, Math.min(10, n));
};

window._setSpellMatrixCANote = (elementId, val) => {
  if (!_spellMatricesDraft.protectionCA[elementId]) _spellMatricesDraft.protectionCA[elementId] = {};
  const v = (val || '').trim();
  if (v) _spellMatricesDraft.protectionCA[elementId].note = v;
  else   delete _spellMatricesDraft.protectionCA[elementId].note;
  // Cleanup si entrée vide (ni mod ≠ 2, ni note)
  const entry = _spellMatricesDraft.protectionCA[elementId];
  if (entry && (entry.mod === undefined || entry.mod === 2) && !entry.note) {
    delete _spellMatricesDraft.protectionCA[elementId];
  }
};

window._setSpellMatrixComboEnabled = (comboId, enabled) => {
  if (!_spellMatricesDraft.combos[comboId]) _spellMatricesDraft.combos[comboId] = {};
  _spellMatricesDraft.combos[comboId].enabled = !!enabled;
  // Cleanup : retire l'entrée si elle correspond aux défauts et pas de nom custom
  const def = COMBO_DEFAULTS[comboId];
  const e   = _spellMatricesDraft.combos[comboId];
  if (def && e.enabled === def.enabled && !(e.name && e.name.trim())) {
    delete _spellMatricesDraft.combos[comboId];
  }
  loadDamageTypes().then(types => _renderSpellMatricesModal(types));
};

window._setSpellMatrixComboName = (comboId, val) => {
  if (!_spellMatricesDraft.combos[comboId]) _spellMatricesDraft.combos[comboId] = {};
  const v = (val || '').trim();
  if (v) _spellMatricesDraft.combos[comboId].name = v;
  else   delete _spellMatricesDraft.combos[comboId].name;
  // Cleanup
  const def = COMBO_DEFAULTS[comboId];
  const e   = _spellMatricesDraft.combos[comboId];
  if (def && (e.enabled === undefined || e.enabled === def.enabled) && !(e.name && e.name.trim())) {
    delete _spellMatricesDraft.combos[comboId];
  }
};

window._setSpellMatrixArm = (elementId, key, val) => {
  if (!_spellMatricesDraft.combo_arms[elementId]) _spellMatricesDraft.combo_arms[elementId] = {};
  const v = (val == null) ? '' : String(val).trim();
  if (v) _spellMatricesDraft.combo_arms[elementId][key] = (key === 'portee') ? (parseInt(v) || 1) : v;
  else   delete _spellMatricesDraft.combo_arms[elementId][key];
  // Cleanup si toutes les clés sont vides
  const e = _spellMatricesDraft.combo_arms[elementId];
  const meaningful = ['weapon','degats','statToucher','statDegats','portee','note'].some(k => e[k] !== undefined && e[k] !== '');
  if (!meaningful) delete _spellMatricesDraft.combo_arms[elementId];
};

window._saveSpellMatrices = async () => {
  try {
    await saveSpellMatrices(_spellMatricesDraft);
    closeModal();
    showNotif('Matrices de sorts enregistrées.', 'success');
  } catch (e) { notifySaveError(e); }
};

window.openSpellMatricesAdmin = openSpellMatricesAdmin;

// ══════════════════════════════════════════════
// COMPUTED STATS
// ══════════════════════════════════════════════
// Traits de base d'un item — priorité à traits[] (array), fallback sur trait (string legacy)
// N'inclut PAS les traits ajoutés par amélioration (upgrades.addedTraits).
// Filtre les traits supprimés à l'écrasement (upgrades.removedBaseTraits).
export function _getBaseTraits(item = {}) {
  const removed = new Set(item?.upgrades?.removedBaseTraits || []);
  const out = [];
  if (Array.isArray(item.traits) && item.traits.length > 0) {
    item.traits.forEach(t => { if (t && !removed.has(t)) out.push(t); });
  } else if (item.trait && !removed.has(item.trait)) {
    out.push(item.trait);
  }
  return out;
}

// Traits ajoutés par amélioration via l'artisan (upgrades.addedTraits).
export function _getAddedTraits(item = {}) {
  return Array.isArray(item?.upgrades?.addedTraits)
    ? item.upgrades.addedTraits.filter(Boolean)
    : [];
}

// Tous les traits effectifs d'un item : base + améliorations.
// Si l'item a un `upgrades.effectBonus` (anneaux), incrémente le PREMIER nombre
// trouvé dans la liste des traits (l'effet flat de l'anneau y est typiquement
// stocké, ex : "+1 vitesse" → "+2 vitesse" au palier 1).
export function _getTraits(item = {}) {
  const all = [..._getBaseTraits(item), ..._getAddedTraits(item)];
  const bonus = parseInt(item?.upgrades?.effectBonus) || 0;
  if (bonus <= 0) return all;

  let applied = false;
  return all.map(t => {
    if (applied) return t;
    const txt = String(t);
    const m = txt.match(/(?<![\d.])(\+?)(\d+)(?![\d.])/);
    if (!m) return t;
    applied = true;
    const sign  = m[1] || '';
    const value = parseInt(m[2]);
    return txt.replace(m[0], `${sign}${value + bonus}`);
  });
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
