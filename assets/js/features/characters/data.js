import { getDocData, saveDoc } from '../../data/firestore.js';
import { registerActions } from '../../core/actions.js';
import { openModal, closeModal, confirmModal } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { loadWeaponFormats, saveWeaponFormats } from '../../shared/weapon-formats.js';
import { loadDamageTypes, saveDamageTypes, DEFAULT_DAMAGE_TYPES } from '../../shared/damage-types.js';
import { loadSpellMatrices, saveSpellMatrices, SPELL_SLOTS, SLOT_LABELS, COMBO_IDS, COMBO_DEFAULTS } from '../../shared/spell-matrices.js';
import { _esc, modStr } from '../../shared/html.js';
import { computeEquipStatsBonus, getMod, getMaitriseBonus as _getMaitriseBonus } from '../../shared/char-stats.js';
import { openCharacterRulesAdmin } from '../../shared/character-rules.js';
import { openEquipmentSlotsAdmin, getPrimaryWeaponSlotId, getSecondaryWeaponSlotId } from '../../shared/equipment-slots.js';
import { openSpellSystemAdmin } from '../../shared/spell-system.js';
import { DEFAULT_UNARMED, getMainWeapon, normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData, syncEquipmentAfterInventoryMutation, resolveEquippedInventoryIndices, _getBaseTraits, _getAddedTraits, _getTraits } from '../../shared/equipment-utils.js';
export { DEFAULT_UNARMED, getMainWeapon, normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData, syncEquipmentAfterInventoryMutation, _getBaseTraits, _getAddedTraits, _getTraits };

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
  const mainP  = equip[getPrimaryWeaponSlotId()];
  const mainS  = equip[getSecondaryWeaponSlotId()];
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
            <button class="btn-icon" style="font-size:.72rem" data-action="_editCombatStyle" data-idx="${i}">✏️</button>
            <button class="btn-icon" style="font-size:.72rem;color:#ff6b6b" data-action="_deleteCombatStyle" data-idx="${i}">🗑️</button>
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
      <button class="btn btn-gold" style="flex:1" data-action="_addCombatStyle">+ Nouveau style</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Fermer</button>
    </div>
  `);
}

function _addCombatStyle() {
  _openStyleEditor(-1, { label:'', condPrincipale:[], condSecondaire:[], description:'', couleur:'#4f8cff' });
}
function _editCombatStyle(i) {
  _openStyleEditor(i, _combatStyles[i] || {});
}
async function _deleteCombatStyle(i) {
  if (!await confirmModal('Supprimer ce style ?')) return;
  _combatStyles.splice(i, 1);
  await saveDoc('world', 'combat_styles', { styles: _combatStyles });
  showNotif('Style supprimé.', 'success');
  _renderCombatStylesModal(_combatStyles);
}

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
          <button type="button" data-action="_removeParent" style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:0 6px">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" data-action="_csAddCond" data-container="cs-cond-p" data-sel="cs-cond-p-sel"
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
          <button type="button" data-action="_removeParent" style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:0 6px">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" data-action="_csAddCond" data-container="cs-cond-s" data-sel="cs-cond-s-sel"
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
      <button class="btn btn-gold" style="flex:1" data-action="_saveCombatStyle" data-idx="${idx}">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="_backToStylesList">← Retour</button>
    </div>
  `);
}

function _csAddCond(containerId, selClass) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:.3rem';
  div.innerHTML = `
    <select class="input-field ${selClass}" style="flex:1">
      ${_getFormatsOpt().map(o=>`<option value="${o.v}">${o.l}</option>`).join('')}
    </select>
    <button type="button" data-action="_removeParent"
      style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:0 6px">✕</button>`;
  container.appendChild(div);
}

async function _saveCombatStyle(idx) {
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
}

function _backToStylesList() {
  _renderCombatStylesModal(_combatStyles || []);
}

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
  const magPill = (isMagic, i) => {
    const on = !!isMagic;
    return `<button class="sh-admin-pill-toggle ${on?'on':''}"
      style="--pt-bg:rgba(180,127,255,.18);--pt-bd:rgba(180,127,255,.45);--pt-c:#c084fc"
      data-action="_toggleWeaponFormatMagic" data-idx="${i}"
      title="${on ? 'Magique — clic pour passer en physique' : 'Physique — clic pour passer en magique'}">
      ${on ? '🔮 Magique' : '💪 Physique'}
    </button>`;
  };

  openModal('', `
  <div class="sh-admin-modal is-formats">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">⚔️</div>
      <div class="sh-admin-head-title">
        <h2>Formats d'armes</h2>
        <small>${formats.length} format${formats.length>1?'s':''} configuré${formats.length>1?'s':''} · utilisés dans la boutique et les styles de combat</small>
      </div>
      <button class="sh-admin-close" data-action="close-modal" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">
      <p class="sh-admin-intro">
        Bascule chaque format en <em>🔮 Magique</em> (le joueur choisit son élément à l'attaque) ou <em>💪 Physique</em> (dégâts physiques fixes).
      </p>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📋 Formats existants</div>
        <div class="sh-admin-list" id="wf-list">
          ${formats.length === 0
            ? '<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun format — ajoute-en un ci-dessous.</div>'
            : formats.map((f, i) => `
              <div class="sh-admin-list-item">
                <span class="sh-admin-list-item-label">${_esc(f.label)}</span>
                ${magPill(f.isMagic, i)}
                <button class="sh-admin-del-btn" data-action="_deleteWeaponFormat" data-idx="${i}" title="Supprimer">🗑️</button>
              </div>`).join('')}
        </div>

        <div class="sh-admin-add-row">
          <input type="text" id="wf-new-label" placeholder="Nouveau format (ex: Arme 2M CaC Mag.)..."
            data-enter-click="[data-action=_addWeaponFormat]">
          <button class="btn btn-gold btn-sm" data-action="_addWeaponFormat">+ Ajouter</button>
        </div>
      </div>
    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-arcane btn-sm" data-action="openDamageTypesAdmin">⚡ Types de dégâts…</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Fermer</button>
    </div>
  </div>
  `);
  setTimeout(() => document.getElementById('wf-new-label')?.focus(), 60);
}

async function _toggleWeaponFormatMagic(i) {
  const formats = [...(_weaponFormats || [])];
  if (!formats[i]) return;
  const nowMagic = !formats[i].isMagic;
  formats[i] = { ...formats[i], isMagic: nowMagic, damageType: nowMagic ? '' : 'physique' };
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
  _renderWeaponFormatsModal(formats);
}

async function _addWeaponFormat() {
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
}

async function _deleteWeaponFormat(i) {
  if (!await confirmModal('Supprimer ce format ?', { title: 'Confirmation de suppression' })) return;
  const formats = [...(_weaponFormats || [])];
  formats.splice(i, 1);
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
  showNotif('Format supprimé.', 'success');
  _renderWeaponFormatsModal(formats);
}

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
    <div class="sh-dmg-rules">
      <label class="sh-dmg-rule">
        <input type="text" value="${_esc(t.icon||'')}"
          class="sh-dmg-icon" placeholder="🔥" title="Icône"
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="icon">
        <input type="color" value="${t.color||'#9ca3af'}" title="Couleur"
          class="sh-dmg-color"
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="color">
      </label>
      <label class="sh-dmg-rule sh-dmg-rule-check">
        <input type="checkbox" ${isMagic ? 'checked' : ''}
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="isMagic" data-vtype="bool">
        <span>🔮 Magique</span>
      </label>
      <label class="sh-dmg-rule">
        <span>Raté</span>
        <select class="sh-admin-row-input" style="width:80px;text-align:left;font-family:inherit;font-weight:500;font-size:.76rem;padding:3px 6px"
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.missEffect">
          ${missOpts}
        </select>
      </label>
      <label class="sh-dmg-rule">
        <span>Pén. armure</span>
        <input type="number" class="sh-admin-row-input small" min="0" max="100" value="${r.armorPen||0}"
          style="width:50px"
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.armorPen" data-vtype="num">
        <span class="sh-admin-row-unit">%</span>
      </label>
      <label class="sh-dmg-rule">
        <span>Bonus dégâts</span>
        <input type="number" class="sh-admin-row-input small" value="${r.dmgBonus||0}"
          style="width:50px"
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.dmgBonus" data-vtype="num">
      </label>
    </div>`;
  };

  openModal('', `
  <div class="sh-admin-modal is-formats">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">⚡</div>
      <div class="sh-admin-head-title">
        <h2>Types de dégâts</h2>
        <small>${types.length} type${types.length>1?'s':''} configuré${types.length>1?'s':''} · règles appliquées automatiquement dans le VTT</small>
      </div>
      <button class="sh-admin-close" data-action="close-modal" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">
      <p class="sh-admin-intro">
        Marque un type comme <em>magique</em> pour qu'il soit choisissable par les armes magiques et les sorts.
      </p>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📋 Types existants</div>
        <div class="sh-admin-list">
          ${types.length === 0
            ? '<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun type — ajoute-en un ci-dessous.</div>'
            : types.map((t, i) => `
              <div class="sh-admin-list-item" style="flex-direction:column;align-items:stretch;gap:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:1.1rem;min-width:1.5rem;text-align:center">${t.icon||'—'}</span>
                  <input type="text" class="sh-admin-row-input" value="${_esc(t.label)}"
                    style="flex:1;text-align:left;font-family:inherit;font-weight:500"
                    data-change="_saveDmgTypeProp" data-i="${i}" data-prop="label">
                  <button class="sh-admin-del-btn" data-action="_deleteDmgType" data-idx="${i}" title="Supprimer">🗑️</button>
                </div>
                ${mkRules(t, i)}
              </div>`).join('')}
        </div>

        <div class="sh-admin-add-row">
          <input type="text" id="dt-new-icon" placeholder="🌊"
            style="width:50px;text-align:center;flex:0 0 auto">
          <input type="text" id="dt-new-label" placeholder="Nouveau type (ex: Eau, Foudre…)"
            data-enter-click="[data-action=_addDmgType]">
          <button class="btn btn-gold btn-sm" data-action="_addDmgType">+ Ajouter</button>
        </div>
      </div>
    </div>

    <div class="sh-admin-footer">
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Fermer</button>
    </div>
  </div>
  `);
  setTimeout(() => document.getElementById('dt-new-label')?.focus(), 60);
}

async function _saveDmgTypeProp(i, path, value) {
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
}

async function _addDmgType() {
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
}

async function _deleteDmgType(i) {
  if (!await confirmModal('Supprimer ce type ?', { title: 'Confirmation' })) return;
  const types = [...(_damageTypes || [])];
  types.splice(i, 1);
  await saveDamageTypes(types);
  _damageTypes = types;
  showNotif('Type supprimé.', 'success');
  _renderDamageTypesModal(types);
}


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
    { id:'enchant',      label:'✨ Enchantement',     desc:'Effets sur les alliés (Action · 2 tours)' },
    { id:'affliction',   label:'💀 Affliction',       desc:'Effets sur les ennemis (Action · 2 tours)'      },
    { id:'protectionCA', label:'🛡️ Protection CA',    desc:'Variantes du bonus CA par élément'              },
    { id:'combos',       label:'🔗 Combos',           desc:'Activer / renommer les combos de runes'         },
    { id:'combo_arms',   label:'⚔️ Armes invoquées',  desc:'Arme par élément pour le combo Enchant+Invoc'   },
  ];

  const tabBtns = TABS.map(t => {
    const active = _spellMatricesTab === t.id;
    return `<button type="button" data-action="_switchSpellMatrixTab" data-tab="${t.id}"
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
                data-change="_setSpellMatrixCAMod" data-tid="${t.id}"
                style="width:48px;padding:.2rem;text-align:center;background:var(--bg-base);
                border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:.85rem">
            </label>
            <input class="input-field" placeholder="Note (ex: désavantage à distance contre la cible)"
              value="${_esc(note)}" data-input="_setSpellMatrixCANote" data-tid="${t.id}"
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
                data-change="_setSpellMatrixComboEnabled" data-id="${id}">
              <span style="color:${enabled?'var(--text)':'var(--text-dim)'};font-weight:${enabled?'700':'400'}">${def.name}</span>
            </label>
            <input class="input-field" placeholder="Nom personnalisé (vide = ${_esc(def.name)})"
              value="${_esc(ov.name||'')}"
              data-input="_setSpellMatrixComboName" data-id="${id}"
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
                  data-input="_setSpellMatrixArm" data-tid="${t.id}" data-arm="weapon"
                  style="font-size:.76rem;padding:.25rem .4rem">
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Dégâts</span>
                <input class="input-field" placeholder="ex : 1d8 +2"
                  value="${_esc(a.degats||'')}"
                  data-input="_setSpellMatrixArm" data-tid="${t.id}" data-arm="degats"
                  style="font-size:.76rem;padding:.25rem .4rem">
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Stat Toucher</span>
                <select class="input-field"
                  data-change="_setSpellMatrixArm" data-tid="${t.id}" data-arm="statToucher"
                  style="font-size:.74rem;padding:.25rem .4rem">
                  ${statOpts.map(o => `<option value="${o.v}" ${(a.statToucher||a.stat||'force')===o.v?'selected':''}>${o.l}</option>`).join('')}
                </select>
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Stat Dégâts</span>
                <select class="input-field"
                  data-change="_setSpellMatrixArm" data-tid="${t.id}" data-arm="statDegats"
                  style="font-size:.74rem;padding:.25rem .4rem">
                  ${statOpts.map(o => `<option value="${o.v}" ${(a.statDegats||a.stat||'force')===o.v?'selected':''}>${o.l}</option>`).join('')}
                </select>
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Portée (m)</span>
                <input type="number" min="1" max="30" placeholder="1"
                  value="${a.portee||''}"
                  data-input="_setSpellMatrixArm" data-tid="${t.id}" data-arm="portee"
                  style="font-size:.76rem;padding:.25rem .4rem;background:var(--bg-base);
                  border:1px solid var(--border);border-radius:5px;color:var(--text);text-align:center">
              </label>
              <label style="display:flex;flex-direction:column;gap:.1rem">
                <span style="font-size:.66rem;color:var(--text-dim);font-weight:600">Note (propriétés)</span>
                <input class="input-field" placeholder="ex : Action Bonus chaque tour…"
                  value="${_esc(a.note||'')}"
                  data-input="_setSpellMatrixArm" data-tid="${t.id}" data-arm="note"
                  style="font-size:.74rem;padding:.25rem .4rem">
              </label>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    // Tableau (élément × slot) → liste d'effets (1 effet par ligne)
    const catKey = _spellMatricesTab;
    const placeholderEx = catKey === 'enchant'
      ? 'Vision nocturne\nŒil de l\'aigle (+perception)\nHalo guidant (+influence)'
      : 'Cécité (JS Sa)\nÉblouissement (désavantage)\nIllusion sensorielle';
    tabBodyHtml = `
      <p style="font-size:.74rem;color:var(--text-dim);margin:.4rem 0 .6rem">
        Pour chaque <strong>(élément × slot)</strong>, liste les effets thématiques possibles.
        <strong>Un effet par ligne</strong> — le joueur pourra piocher dans cette liste ou écrire le sien.
        Vide = pas de suggestion pour cette combinaison.
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
                const raw = row[slot];
                // Normalisation : array OU string legacy → lignes séparées par \n
                const txt = Array.isArray(raw) ? raw.join('\n') : (raw || '');
                const count = Array.isArray(raw) ? raw.length : (raw ? 1 : 0);
                const badge = count > 1
                  ? `<span style="font-size:.6rem;background:rgba(212,165,68,.18);color:var(--gold);border:1px solid rgba(212,165,68,.32);padding:1px 5px;border-radius:99px;font-weight:700">${count}</span>`
                  : '';
                return `<label style="display:flex;flex-direction:column;gap:.15rem">
                  <span style="font-size:.7rem;color:var(--text-dim);font-weight:600;display:flex;align-items:center;gap:.3rem">${SLOT_LABELS[slot]} ${badge}</span>
                  <textarea class="input-field" rows="3" placeholder="${_esc(placeholderEx)}"
                    data-input="_setSpellMatrixEffect" data-cat-key="${catKey}" data-tid="${t.id}" data-slot="${slot}"
                    style="font-size:.74rem;padding:.3rem .45rem;font-family:inherit;resize:vertical;min-height:60px">${_esc(txt)}</textarea>
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
      <button class="btn btn-outline btn-sm" style="flex:1" data-action="close-modal">Annuler</button>
      <button class="btn btn-gold btn-sm"    style="flex:2" data-action="_saveSpellMatrices">💾 Enregistrer les matrices</button>
    </div>
  `);
}

function _switchSpellMatrixTab(tab) {
  _spellMatricesTab = tab;
  loadDamageTypes().then(types => _renderSpellMatricesModal(types));
}

function _setSpellMatrixEffect(catKey, elementId, slot, value) {
  if (!_spellMatricesDraft[catKey][elementId]) _spellMatricesDraft[catKey][elementId] = {};
  // Multi-ligne : chaque ligne non vide devient une suggestion distincte
  const lines = String(value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    delete _spellMatricesDraft[catKey][elementId][slot];
  } else if (lines.length === 1) {
    // Une seule suggestion → stocke en string (rétrocompat minimaliste)
    _spellMatricesDraft[catKey][elementId][slot] = lines[0];
  } else {
    _spellMatricesDraft[catKey][elementId][slot] = lines;
  }
  if (Object.keys(_spellMatricesDraft[catKey][elementId]).length === 0) {
    delete _spellMatricesDraft[catKey][elementId];
  }
}

function _setSpellMatrixCAMod(elementId, val) {
  const n = parseInt(val);
  if (!Number.isFinite(n)) return;
  if (!_spellMatricesDraft.protectionCA[elementId]) _spellMatricesDraft.protectionCA[elementId] = {};
  _spellMatricesDraft.protectionCA[elementId].mod = Math.max(0, Math.min(10, n));
}

function _setSpellMatrixCANote(elementId, val) {
  if (!_spellMatricesDraft.protectionCA[elementId]) _spellMatricesDraft.protectionCA[elementId] = {};
  const v = (val || '').trim();
  if (v) _spellMatricesDraft.protectionCA[elementId].note = v;
  else   delete _spellMatricesDraft.protectionCA[elementId].note;
  // Cleanup si entrée vide (ni mod ≠ 2, ni note)
  const entry = _spellMatricesDraft.protectionCA[elementId];
  if (entry && (entry.mod === undefined || entry.mod === 2) && !entry.note) {
    delete _spellMatricesDraft.protectionCA[elementId];
  }
}

function _setSpellMatrixComboEnabled(comboId, enabled) {
  if (!_spellMatricesDraft.combos[comboId]) _spellMatricesDraft.combos[comboId] = {};
  _spellMatricesDraft.combos[comboId].enabled = !!enabled;
  // Cleanup : retire l'entrée si elle correspond aux défauts et pas de nom custom
  const def = COMBO_DEFAULTS[comboId];
  const e   = _spellMatricesDraft.combos[comboId];
  if (def && e.enabled === def.enabled && !(e.name && e.name.trim())) {
    delete _spellMatricesDraft.combos[comboId];
  }
  loadDamageTypes().then(types => _renderSpellMatricesModal(types));
}

function _setSpellMatrixComboName(comboId, val) {
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
}

function _setSpellMatrixArm(elementId, key, val) {
  if (!_spellMatricesDraft.combo_arms[elementId]) _spellMatricesDraft.combo_arms[elementId] = {};
  const v = (val == null) ? '' : String(val).trim();
  if (v) _spellMatricesDraft.combo_arms[elementId][key] = (key === 'portee') ? (parseInt(v) || 1) : v;
  else   delete _spellMatricesDraft.combo_arms[elementId][key];
  // Cleanup si toutes les clés sont vides
  const e = _spellMatricesDraft.combo_arms[elementId];
  const meaningful = ['weapon','degats','statToucher','statDegats','portee','note'].some(k => e[k] !== undefined && e[k] !== '');
  if (!meaningful) delete _spellMatricesDraft.combo_arms[elementId];
}

async function _saveSpellMatrices() {
  try {
    await saveSpellMatrices(_spellMatricesDraft);
    closeModal();
    showNotif('Matrices de sorts enregistrées.', 'success');
  } catch (e) { notifySaveError(e); }
}


// ══════════════════════════════════════════════
// COMPUTED STATS
// ══════════════════════════════════════════════
export function getEquippedInventoryIndexMap(c) {
  // Index → [slots]. Résolu par IDENTITÉ (cf. resolveEquippedInventoryIndices) :
  // un sourceInvIndex périmé ne décale plus la surbrillance sur le mauvais objet.
  const map = new Map();
  resolveEquippedInventoryIndices(c).forEach((idx, slot) => {
    const slots = map.get(idx) || [];
    slots.push(slot);
    map.set(idx, slots);
  });
  return map;
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

registerActions({
  _saveDmgTypeProp: (el) => {
    const t = el.dataset.vtype;
    const v = t === 'bool' ? el.checked : t === 'num' ? +el.value : el.value;
    _saveDmgTypeProp(Number(el.dataset.i), el.dataset.prop, v);
  },
  _setSpellMatrixCAMod:        (el) => _setSpellMatrixCAMod(el.dataset.tid, el.value),
  _setSpellMatrixCANote:       (el) => _setSpellMatrixCANote(el.dataset.tid, el.value),
  _setSpellMatrixComboEnabled: (el) => _setSpellMatrixComboEnabled(el.dataset.id, el.checked),
  _setSpellMatrixComboName:    (el) => _setSpellMatrixComboName(el.dataset.id, el.value),
  _setSpellMatrixArm:          (el) => _setSpellMatrixArm(el.dataset.tid, el.dataset.arm, el.value),
  _setSpellMatrixEffect:       (el) => _setSpellMatrixEffect(el.dataset.catKey, el.dataset.tid, el.dataset.slot, el.value),
  _removeParent:            (btn) => btn.parentElement?.remove(),
  _editCombatStyle:         (btn) => _editCombatStyle(Number(btn.dataset.idx)),
  _deleteCombatStyle:       (btn) => _deleteCombatStyle(Number(btn.dataset.idx)),
  _addCombatStyle:          ()    => _addCombatStyle(),
  _saveCombatStyle:         (btn) => _saveCombatStyle(Number(btn.dataset.idx)),
  _backToStylesList:        ()    => _backToStylesList(),
  _csAddCond:               (btn) => _csAddCond(btn.dataset.container, btn.dataset.sel),
  _toggleWeaponFormatMagic: (btn) => _toggleWeaponFormatMagic(Number(btn.dataset.idx)),
  _addWeaponFormat:         ()    => _addWeaponFormat(),
  _deleteWeaponFormat:      (btn) => _deleteWeaponFormat(Number(btn.dataset.idx)),
  openCombatStylesAdmin:    ()    => openCombatStylesAdmin(),
  openWeaponFormatsAdmin:   ()    => openWeaponFormatsAdmin(),
  openDamageTypesAdmin:     ()    => openDamageTypesAdmin(),
  openSpellMatricesAdmin:   ()    => openSpellMatricesAdmin(),
  openCharacterRulesAdmin:  ()    => openCharacterRulesAdmin(),
  openEquipmentSlotsAdmin:  ()    => openEquipmentSlotsAdmin(),
  openSpellSystemAdmin:     ()    => openSpellSystemAdmin(),
  _addDmgType:              ()    => _addDmgType(),
  _deleteDmgType:           (btn) => _deleteDmgType(Number(btn.dataset.idx)),
  _switchSpellMatrixTab:    (btn) => _switchSpellMatrixTab(btn.dataset.tab),
  _saveSpellMatrices:       ()    => _saveSpellMatrices(),
});
