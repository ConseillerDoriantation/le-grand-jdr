import { getDocData, saveDoc } from '../../data/firestore.js';
import { registerActions } from '../../core/actions.js';
import { openModal, closeModal, closeModalDirect, confirmModal, setModalCloseGuard } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { loadWeaponFormats, saveWeaponFormats, normalizeWeaponTechnique } from '../../shared/weapon-formats.js';
import { loadDamageTypes, saveDamageTypes } from '../../shared/damage-types.js';
import { CONDITION_DEFAULT_LIBRARY, loadConditionLibrary } from '../../shared/conditions.js';
import { loadSpellMatrices, saveSpellMatrices, SPELL_SLOTS, SLOT_LABELS, COMBO_IDS, COMBO_DEFAULTS } from '../../shared/spell-matrices.js';
import { _esc, modStr } from '../../shared/html.js';
import { computeEquipStatsBonus, getMod, getMaitriseBonus as _getMaitriseBonus } from '../../shared/char-stats.js';
import { openCharacterRulesAdmin } from '../../shared/character-rules.js';
import { openEquipmentSlotsAdmin, getPrimaryWeaponSlotId, getSecondaryWeaponSlotId } from '../../shared/equipment-slots.js';
import { openArmorSetsAdmin } from '../../shared/armor-set-settings.js';
import { openSpellSystemAdmin } from '../../shared/spell-system.js';
import { defaultCombatStyles, detectCombatStyle as detectCombatStyleRule, normalizeCombatStyles } from '../../shared/combat-styles.js';
import { DEFAULT_UNARMED, getMainWeapon, normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData, syncEquipmentAfterInventoryMutation, resolveEquippedInventoryIndices, _getBaseTraits, _getAddedTraits, _getTraits } from '../../shared/equipment-utils.js';
export { DEFAULT_UNARMED, getMainWeapon, normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData, syncEquipmentAfterInventoryMutation, _getBaseTraits, _getAddedTraits, _getTraits };

// ══════════════════════════════════════════════
// STYLES DE COMBAT
// Firestore : world/combat_styles → { styles:[{id,label,condPrincipale,condSecondaire,description,couleur}] }
// ══════════════════════════════════════════════
export let _combatStyles = null; // cache en mémoire
export let _weaponFormats = null; // cache en mémoire (partagé avec weapon-formats.js)
let _damageTypes = null; // cache local types de dégâts
let _techniqueConditions = CONDITION_DEFAULT_LIBRARY;
let _wfTechniqueFormatIndex = -1;
let _wfTechniqueDrafts = [];
let _wfTechniqueDirty = false;
let _dtTechniqueTypeIndex = -1;
let _dtTechniqueDrafts = [];
let _dtTechniqueDirty = false;

export async function loadCombatStyles() {
  if (_combatStyles) return _combatStyles;
  const [stylesDoc, formats] = await Promise.all([
    getDocData('world', 'combat_styles').catch(() => null),
    loadWeaponFormats(),
  ]);
  _combatStyles = normalizeCombatStyles(stylesDoc?.styles || _defaultCombatStyles());
  _weaponFormats = formats;
  return _combatStyles;
}

export function _defaultCombatStyles() {
  return defaultCombatStyles();
}

/**
 * Détecte le style de combat actif selon les armes équipées.
 * condSousTypeS : si renseigné, la main secondaire doit avoir ce sousType (insensible à la casse).
 * Ordre des styles : du plus spécifique au plus général.
 */
export function detectCombatStyle(c, styles) {
  return detectCombatStyleRule(c, styles);
}

// Admin : ouvrir la gestion des styles de combat
export async function openCombatStylesAdmin() {
  try {
    const styles = await loadCombatStyles();
    _renderCombatStylesModal(styles);
  } catch (e) { notifySaveError(e); }
}

export function _renderCombatStylesModal(styles) {
  const normalized = normalizeCombatStyles(styles);
  const rulePills = style => {
    const rules = style.rules;
    const pills = [];
    if (rules.opportunityAttack === 'allow') pills.push('<span class="cs-rule-pill reaction">↪ Opportunité autorisée</span>');
    if (rules.opportunityAttack === 'forbid') pills.push('<span class="cs-rule-pill muted">⊘ Sans opportunité</span>');
    if (rules.contactAttackMode !== 'none') {
      const label = rules.contactAttackMode === 'advantage' ? 'Avantage' : 'Désavantage';
      const scope = rules.contactAttackScope === 'all' ? 'toutes actions ciblées' : 'attaques et soins à distance';
      pills.push(`<span class="cs-rule-pill ${rules.contactAttackMode === 'advantage' ? 'positive' : 'warning'}">${rules.contactAttackMode === 'advantage' ? '↗' : '↘'} ${label} au contact · ${scope} · ${rules.contactDistance}c</span>`);
    }
    return pills.join('') || '<span class="cs-rule-pill muted">Règles héritées</span>';
  };

  openModal('', `
    <div class="sh-admin-modal is-combat-styles">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">⚔️</div>
        <div class="sh-admin-head-title">
          <h2>Styles de combat</h2>
          <small>Détection par équipement · règles automatiquement appliquées dans le VTT</small>
        </div>
        <button class="sh-admin-close" data-action="close-modal" title="Fermer">✕</button>
      </div>
      <div class="sh-admin-body">
        <p class="sh-admin-intro">Le premier style correspondant à l’équipement actif est utilisé. La description sert au contexte ; les règles ci-dessous pilotent réellement le combat.</p>
        <div class="cs-style-list" id="cs-styles-list">
          ${normalized.map((s, i) => `
            <article class="cs-style-admin-card" style="--style-c:${s.couleur || '#4f8cff'}">
              <div class="cs-style-admin-main">
                <div class="cs-style-admin-title">${_esc(s.label || `Style ${i + 1}`)}</div>
                <div class="cs-style-admin-rules">${rulePills(s)}</div>
                ${s.description ? `<p>${_esc(s.description)}</p>` : ''}
                <div class="cs-style-admin-match">
                  <span><b>Principale</b>${_esc((s.condPrincipale || []).filter(Boolean).join(', ') || 'aucune arme')}</span>
                  <span><b>Secondaire</b>${_esc((s.condSecondaire || []).filter(Boolean).join(', ') || 'aucune arme')}</span>
                </div>
              </div>
              <div class="cs-style-admin-actions">
                <button class="btn-icon" data-action="_editCombatStyle" data-idx="${i}" title="Modifier">✏️</button>
                <button class="btn-icon danger" data-action="_deleteCombatStyle" data-idx="${i}" title="Supprimer">🗑️</button>
              </div>
            </article>`).join('')}
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-gold" data-action="_addCombatStyle">＋ Nouveau style</button>
        <span class="sh-admin-footer-spacer"></span>
        <button class="btn btn-outline btn-sm" data-action="close-modal">Fermer</button>
      </div>
    </div>`);
}

function _addCombatStyle() {
  _openStyleEditor(-1, {
    label:'', condPrincipale:[], condSecondaire:[], description:'', couleur:'#4f8cff',
    rules: { opportunityAttack:'inherit', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 },
  });
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
  const style = normalizeCombatStyles([s])[0];
  const rules = style.rules;
  openModal('', `
    <div class="sh-admin-modal is-combat-styles is-editor">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">${idx >= 0 ? '✏️' : '＋'}</div>
        <div class="sh-admin-head-title">
          <h2>${idx >= 0 ? 'Modifier le style' : 'Nouveau style'}</h2>
          <small>Associe un équipement à des règles lisibles et exécutables</small>
        </div>
        <button class="sh-admin-close" data-action="close-modal" title="Fermer">✕</button>
      </div>
      <div class="sh-admin-body cs-style-editor">
        <section class="cs-style-editor-section identity">
          <div class="cs-style-editor-heading"><span>1</span><div><b>Identité</b><small>Nom et repère visuel sur la fiche.</small></div></div>
          <div class="cs-style-identity-grid">
            <label class="cs-style-field"><span>Nom du style</span><input class="input-field" id="cs-style-label" value="${_esc(style.label || '')}" placeholder="🏹 Tir à distance"></label>
            <label class="cs-style-field color"><span>Couleur</span><input type="color" id="cs-style-color" value="${_esc(style.couleur || '#4f8cff')}"></label>
          </div>
        </section>

        <section class="cs-style-editor-section">
          <div class="cs-style-editor-heading"><span>2</span><div><b>Équipement déclencheur</b><small>Plusieurs choix dans une main signifient « ou ».</small></div></div>
          <div class="cs-style-hands-grid">
            <div class="cs-style-hand">
              <label>Main principale</label>
              <div id="cs-cond-p" class="cs-style-conditions">
        ${(s.condPrincipale?.length ? s.condPrincipale : ['']).map((v,fi) => `
                <div class="cs-style-condition-row">
          <select class="input-field cs-cond-p-sel">
            ${_getFormatsOpt().map(o=>`<option value="${_esc(o.v)}" ${v===o.v?'selected':''}>${_esc(o.l)}</option>`).join('')}
          </select>
                  <button type="button" data-action="_removeParent" title="Retirer">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" data-action="_csAddCond" data-container="cs-cond-p" data-sel="cs-cond-p-sel"
                class="cs-style-add-condition">＋ Ajouter un format</button>
            </div>
            <div class="cs-style-hand">
              <label>Main secondaire</label>
              <div id="cs-cond-s" class="cs-style-conditions">
        ${(s.condSecondaire?.length ? s.condSecondaire : ['']).map((v,fi) => `
                <div class="cs-style-condition-row">
          <select class="input-field cs-cond-s-sel">
            ${_getFormatsOpt().map(o=>`<option value="${_esc(o.v)}" ${v===o.v?'selected':''}>${_esc(o.l)}</option>`).join('')}
          </select>
                  <button type="button" data-action="_removeParent" title="Retirer">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" data-action="_csAddCond" data-container="cs-cond-s" data-sel="cs-cond-s-sel"
                class="cs-style-add-condition">＋ Ajouter un format</button>
            </div>
          </div>
        </section>

        <section class="cs-style-editor-section">
          <div class="cs-style-editor-heading"><span>3</span><div><b>Règles actives</b><small>Ces choix ne sont pas seulement descriptifs : le VTT les utilise.</small></div></div>
          <div class="cs-style-rules-grid">
            <label class="cs-style-field">
              <span>Attaque d’opportunité</span>
              <select class="input-field" id="cs-style-opportunity">
                <option value="inherit" ${rules.opportunityAttack==='inherit'?'selected':''}>Aucune règle particulière</option>
                <option value="allow" ${rules.opportunityAttack==='allow'?'selected':''}>Autorisée à la sortie de portée</option>
                <option value="forbid" ${rules.opportunityAttack==='forbid'?'selected':''}>Interdite avec ce style</option>
              </select>
              <small>La réaction est disponible lorsqu’une cible quitte la portée d’attaque.</small>
            </label>
            <label class="cs-style-field">
              <span>Ennemi au contact</span>
              <select class="input-field" id="cs-style-contact-mode">
                <option value="none" ${rules.contactAttackMode==='none'?'selected':''}>Aucun modificateur</option>
                <option value="disadvantage" ${rules.contactAttackMode==='disadvantage'?'selected':''}>Désavantage automatique</option>
                <option value="advantage" ${rules.contactAttackMode==='advantage'?'selected':''}>Avantage automatique</option>
              </select>
              <small>Se combine naturellement aux avantages et désavantages des états.</small>
            </label>
            <label class="cs-style-field">
              <span>Actions concernées</span>
              <select class="input-field" id="cs-style-contact-scope">
                <option value="ranged" ${rules.contactAttackScope==='ranged'?'selected':''}>Attaques et soins à distance</option>
                <option value="all" ${rules.contactAttackScope==='all'?'selected':''}>Toutes les actions ciblées</option>
              </select>
            </label>
            <label class="cs-style-field compact">
              <span>Distance de contact</span>
              <div class="cs-style-distance"><input class="input-field" type="number" id="cs-style-contact-distance" min="1" max="12" value="${rules.contactDistance}"><em>cases</em></div>
            </label>
          </div>
          <div class="cs-style-rule-info"><span>✦</span><div><b>Dégâts en cas d’échec</b><small>Cette règle vient du type de dégâts de l’arme : un type magique configuré à « moitié » inflige ½ dégâts sur un échec de CA, et toujours 0 sur un échec critique.</small></div></div>
        </section>

        <section class="cs-style-editor-section">
          <div class="cs-style-editor-heading"><span>4</span><div><b>Effets complémentaires</b><small>Pour les règles qui ne sont pas encore automatisées.</small></div></div>
          <label class="cs-style-field"><span>Description</span><textarea class="input-field" id="cs-style-desc" rows="3" placeholder="Ex. : peut parer et gagner +1 CA lorsqu’il est en garde.">${_esc(style.description || '')}</textarea></label>
        </section>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_backToStylesList">← Liste</button>
        <span class="sh-admin-footer-spacer"></span>
        <button class="btn btn-gold" data-action="_saveCombatStyle" data-idx="${idx}">Enregistrer le style</button>
      </div>
    </div>
  `);
}

function _csAddCond(containerId, selClass) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'cs-style-condition-row';
  div.innerHTML = `
    <select class="input-field ${selClass}">
      ${_getFormatsOpt().map(o=>`<option value="${_esc(o.v)}">${_esc(o.l)}</option>`).join('')}
    </select>
    <button type="button" data-action="_removeParent" title="Retirer">✕</button>`;
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
    condSousTypeS: idx >= 0 ? (_combatStyles[idx]?.condSousTypeS || []) : [],
    rules: {
      opportunityAttack: document.getElementById('cs-style-opportunity')?.value || 'inherit',
      opportunityTrigger: 'leave-reach',
      contactAttackMode: document.getElementById('cs-style-contact-mode')?.value || 'none',
      contactAttackScope: document.getElementById('cs-style-contact-scope')?.value || 'ranged',
      contactDistance: Math.max(1, Math.min(12, parseInt(document.getElementById('cs-style-contact-distance')?.value, 10) || 1)),
    },
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
  [_weaponFormats, _damageTypes, _techniqueConditions] = await Promise.all([
    loadWeaponFormats(), loadDamageTypes(), loadConditionLibrary(),
  ]);
  _renderWeaponFormatsModal(_weaponFormats);
}

export async function openDamageTypesAdmin() {
  [_damageTypes, _techniqueConditions] = await Promise.all([loadDamageTypes(), loadConditionLibrary()]);
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
        Bascule chaque format en <em>🔮 Magique</em> ou <em>💪 Physique</em>, puis ajoute des <strong>techniques optionnelles</strong> proposées au joueur au moment de l'attaque.
      </p>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📋 Formats existants</div>
        <div class="sh-admin-list" id="wf-list">
          ${formats.length === 0
            ? '<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun format — ajoute-en un ci-dessous.</div>'
            : formats.map((f, i) => `
              <div class="sh-admin-list-item">
                <span class="sh-admin-list-item-label">${_esc(f.label)}</span>
                <button class="wf-tech-open" data-action="_editWeaponFormatTechniques" data-idx="${i}"
                  title="Configurer les techniques de ce format">
                  🎯 ${f.techniques?.length || 0} technique${(f.techniques?.length || 0) > 1 ? 's' : ''}
                </button>
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

const _WF_TECHNIQUE_PRESETS = {
  blank: {
    icon: '⚔️', label: 'Nouvelle technique', description: '', defenseBonus: 0,
    extraWeaponDice: 0, extraDamageFormula: '', extraDamageFlat: 0,
    addWeaponModifier: false, blastRadius: 0, onHitEffect: '',
  },
  weak_spot: {
    icon: '🎯', label: 'Point faible',
    description: 'Vise une zone vulnérable : plus difficile à toucher, mais plus destructeur.',
    defenseBonus: 4, extraWeaponDice: 1, extraDamageFormula: '', extraDamageFlat: 0,
    addWeaponModifier: false, blastRadius: 0, onHitEffect: '',
  },
  power: {
    icon: '💥', label: 'Coup puissant',
    description: 'Sacrifie la précision pour porter un impact plus lourd.',
    defenseBonus: 2, extraWeaponDice: 0, extraDamageFormula: '', extraDamageFlat: 2,
    addWeaponModifier: false, blastRadius: 0, onHitEffect: '',
  },
};

const _TECH_STAT_OPTIONS = [
  ['force', 'Force'], ['dexterite', 'Dextérité'], ['constitution', 'Constitution'],
  ['intelligence', 'Intelligence'], ['sagesse', 'Sagesse'], ['charisme', 'Charisme'],
];

function _techniqueOptions(rows, selected, emptyLabel = '') {
  return `${emptyLabel ? `<option value="">${_esc(emptyLabel)}</option>` : ''}${rows.map(([value, label]) =>
    `<option value="${_esc(value)}" ${selected === value ? 'selected' : ''}>${_esc(label)}</option>`
  ).join('')}`;
}

function _techniqueConfigCard(t, i, kind) {
  const isWeapon = kind === 'weapon';
  const handler = isWeapon ? '_wfTechniqueDraftField' : '_dtTechniqueDraftField';
  const remove = isWeapon ? '_deleteWeaponFormatTechnique' : '_deleteDamageTypeTechnique';
  const bind = (field, event = 'input') => `data-${event}="${handler}" data-idx="${i}" data-field="${field}"`;
  const damageOptions = (_damageTypes || []).map(type => [type.id, `${type.icon || ''} ${type.label}`]);
  const conditionOptions = (_techniqueConditions || []).map(condition => [condition.id, `${condition.icon || ''} ${condition.label}`]);
  return `
    <article class="wf-tech-card tech-builder-card">
      <div class="wf-tech-card-head">
        <input class="wf-tech-icon" value="${_esc(t.icon || (isWeapon ? '🎯' : '💥'))}" maxlength="8" ${bind('icon')} aria-label="Icône">
        <input class="wf-tech-name" value="${_esc(t.label || '')}" maxlength="60" placeholder="Nom de la technique" ${bind('label')}>
        <span class="tech-builder-kind">${isWeapon ? '⚔️ Arme' : '✨ Type de dégâts'}</span>
        <button class="sh-admin-del-btn" data-action="${remove}" data-idx="${i}" title="Retirer la technique">🗑️</button>
      </div>
      <textarea class="wf-tech-desc" rows="2" maxlength="240" placeholder="Décris clairement ce choix pour le joueur…" ${bind('description')}>${_esc(t.description || '')}</textarea>

      <div class="tech-builder-sections">
        <details class="tech-builder-section is-core" open>
          <summary><span>1</span><div><b>Déclenchement</b><small>Quand et avec quelle précision ?</small></div></summary>
          <div class="tech-builder-grid">
            <label><span>Déclenchement</span><select ${bind('trigger', 'change')}>${_techniqueOptions([
              ['hit', 'Sur une touche'], ['miss', 'Sur un échec'], ['crit', 'Sur un critique'], ['always', 'Toujours'],
            ], t.trigger || 'hit')}</select></label>
            <label><span>Effets si échec</span><select ${bind('missEffectMode', 'change')}>${_techniqueOptions([
              ['none', 'Aucun effet'], ['half', 'Effets + ½ dégâts'], ['full', 'Effets + dégâts complets'],
            ], t.missEffectMode || 'none')}</select></label>
            <label><span>Bonus au toucher</span><input type="number" min="-30" max="30" value="${t.attackModifier || 0}" ${bind('attackModifier')}></label>
            <label><span>CA de la cible</span><input type="number" min="0" max="30" value="${t.defenseBonus || 0}" ${bind('defenseBonus')}></label>
            <label><span>Sur un critique</span><select ${bind('criticalMode', 'change')}>${_techniqueOptions([
              ['normal', 'Bonus normal'], ['double', 'Bonus doublé'],
            ], t.criticalMode || 'normal')}</select></label>
          </div>
          <label class="wf-tech-check tech-builder-check"><input type="checkbox" ${t.allowWithAbilities !== false ? 'checked' : ''} ${bind('allowWithAbilities', 'change')}><span><b>Disponible avec les sorts et compétences</b><small>Sinon, la technique apparaît uniquement sur l’attaque directe de l’arme ou du type concerné.</small></span></label>
          <small class="tech-builder-note">« Effets si échec » concerne uniquement une technique normalement déclenchée sur une touche. Un déclencheur « Sur un échec » reste volontairement actif.</small>
        </details>

        <details class="tech-builder-section" open>
          <summary><span>2</span><div><b>Dégâts et progression</b><small>La part propre à cette technique.</small></div></summary>
          <div class="tech-builder-grid tech-builder-grid--damage">
            <label><span>Dés de l’arme</span><input type="number" min="0" max="9" value="${t.extraWeaponDice || 0}" ${bind('extraWeaponDice')}></label>
            <label><span>Formule bonus</span><input value="${_esc(t.extraDamageFormula || '')}" maxlength="30" placeholder="1d6" ${bind('extraDamageFormula')}></label>
            <label><span>Dégâts plats</span><input type="number" min="0" max="999" value="${t.extraDamageFlat || 0}" ${bind('extraDamageFlat')}></label>
            <label><span>Type propre</span><select ${bind('damageTypeId', 'change')}>${_techniqueOptions(damageOptions, t.damageTypeId || '', 'Même type que l’attaque')}</select></label>
          </div>
          <label class="wf-tech-check tech-builder-check"><input type="checkbox" ${t.addWeaponModifier ? 'checked' : ''} ${bind('addWeaponModifier', 'change')}><span><b>Ajouter le modificateur de l’arme</b><small>Ex. DEX avec un arc ou FOR avec une hache.</small></span></label>
          <div class="tech-builder-progression">
            <label><span>Progression</span><select ${bind('scalingMode', 'change')}>${_techniqueOptions([
              ['none', 'Aucune'], ['level', 'Selon le niveau'], ['mastery', 'Selon la maîtrise'], ['stat', 'Selon une caractéristique'],
            ], t.scalingMode || 'none')}</select></label>
            <label><span>Chaque palier de</span><input type="number" min="1" max="20" value="${t.scalingEvery || 1}" ${bind('scalingEvery')}></label>
            <label><span>Ajoute</span><input value="${_esc(t.scalingFormula || '')}" maxlength="30" placeholder="1d4" ${bind('scalingFormula')}></label>
            <label><span>Caractéristique</span><select ${bind('scalingStat', 'change')}>${_techniqueOptions(_TECH_STAT_OPTIONS, t.scalingStat || 'force')}</select></label>
          </div>
        </details>

        <details class="tech-builder-section">
          <summary><span>3</span><div><b>Zone</b><small>Forme, origine et cibles affectées.</small></div></summary>
          <div class="tech-builder-grid">
            <label><span>Rayon / longueur</span><input type="number" min="0" max="30" value="${t.blastRadius || 0}" ${bind('blastRadius')}></label>
            <label><span>Forme</span><select ${bind('areaShape', 'change')}>${_techniqueOptions([
              ['square', 'Carré'], ['circle', 'Cercle'], ['line', 'Ligne'], ['cone', 'Cône'],
            ], t.areaShape || 'square')}</select></label>
            <label><span>Origine</span><select ${bind('areaOrigin', 'change')}>${_techniqueOptions([
              ['target', 'Autour de la cible'], ['caster', 'Autour du lanceur'],
            ], t.areaOrigin || 'target')}</select></label>
            <label><span>Affecte</span><select ${bind('areaTargets', 'change')}>${_techniqueOptions([
              ['all', 'Tout le monde'], ['enemies', 'Ennemis seulement'], ['allies', 'Alliés seulement'],
            ], t.areaTargets || 'all')}</select></label>
          </div>
          <label class="wf-tech-check tech-builder-check"><input type="checkbox" ${t.includeCaster ? 'checked' : ''} ${bind('includeCaster', 'change')}><span><b>Le lanceur peut être affecté</b><small>Utile pour les auras, risques et explosions sans protection.</small></span></label>
          <small class="tech-builder-note">Les lignes et cônes partent toujours du lanceur vers la cible visée.</small>
        </details>

        <details class="tech-builder-section">
          <summary><span>4</span><div><b>État et déplacement</b><small>Effets mécaniques appliqués au déclenchement.</small></div></summary>
          <div class="tech-builder-grid">
            <label><span>État appliqué</span><select ${bind('conditionId', 'change')}>${_techniqueOptions(conditionOptions, t.conditionId || '', 'Aucun état')}</select></label>
            <label><span>Durée (tours)</span><input type="number" min="0" max="100" value="${t.conditionDuration || 0}" title="0 utilise la durée par défaut de l’état" ${bind('conditionDuration')}></label>
            <label><span>Jet de sauvegarde</span><select ${bind('conditionSaveStat', 'change')}>${_techniqueOptions(_TECH_STAT_OPTIONS, t.conditionSaveStat || '', 'Aucun JS')}</select></label>
            <label><span>DD</span><input type="number" min="0" max="99" value="${t.conditionSaveDC || 0}" placeholder="0 = défaut" ${bind('conditionSaveDC')}></label>
            <label><span>Déplacement</span><select ${bind('forcedMovement', 'change')}>${_techniqueOptions([
              ['none', 'Aucun'], ['push', 'Pousser'], ['pull', 'Attirer'],
            ], t.forcedMovement || 'none')}</select></label>
            <label><span>Distance</span><input type="number" min="0" max="30" value="${t.forcedMovementDistance || 0}" ${bind('forcedMovementDistance')}></label>
          </div>
          <label class="wf-tech-effect"><span>Effet affiché dans le résultat</span><input value="${_esc(t.onHitEffect || '')}" maxlength="160" placeholder="Ex. La cible lâche son arme" ${bind('onHitEffect')}></label>
        </details>

        <details class="tech-builder-section">
          <summary><span>5</span><div><b>Coût et limites</b><small>Ressource, usages et recharge.</small></div></summary>
          <div class="tech-builder-grid">
            <label><span>Ressource</span><select ${bind('resourceType', 'change')}>${_techniqueOptions([
              ['none', 'Aucune'], ['pm', 'Points de mana'], ['pv', 'Points de vie'], ['or', 'Or'],
            ], t.resourceType || 'none')}</select></label>
            <label><span>Coût</span><input type="number" min="0" max="999" value="${t.resourceCost || 0}" ${bind('resourceCost')}></label>
            <label><span>Limite</span><select ${bind('usageScope', 'change')}>${_techniqueOptions([
              ['none', 'Illimitée'], ['combat', 'Par combat'], ['session', 'Par session'],
            ], t.usageScope || 'none')}</select></label>
            <label><span>Utilisations</span><input type="number" min="0" max="99" value="${t.maxUses || 0}" ${bind('maxUses')}></label>
            <label><span>Recharge (tours)</span><input type="number" min="0" max="99" value="${t.cooldownRounds || 0}" ${bind('cooldownRounds')}></label>
          </div>
          <small class="tech-builder-note">0 = gratuit, illimité ou sans recharge. Les limites de session repartent à la prochaine ouverture de table.</small>
        </details>
      </div>
    </article>`;
}

function _wfTechniqueCard(t, i) { return _techniqueConfigCard(t, i, 'weapon'); }

function _editWeaponFormatTechniques(i) {
  const format = _weaponFormats?.[i];
  if (!format) return;
  _wfTechniqueFormatIndex = i;
  _wfTechniqueDrafts = (format.techniques || []).map((t, idx) => normalizeWeaponTechnique({ ...t }, idx));
  _wfTechniqueDirty = false;
  _renderWeaponFormatTechniquesEditor();
}

function _installWeaponTechniqueCloseGuard() {
  setModalCloseGuard(() => {
    if (!_wfTechniqueDirty) return false;
    confirmModal('Quitter sans enregistrer les techniques ?', { title: 'Modifications non enregistrées' })
      .then(ok => {
        if (!ok) return;
        _wfTechniqueDirty = false;
        closeModalDirect();
      });
    return true;
  });
}

function _renderWeaponFormatTechniquesEditor() {
  const format = _weaponFormats?.[_wfTechniqueFormatIndex];
  if (!format) return _renderWeaponFormatsModal(_weaponFormats || []);
  openModal('', `
    <div class="sh-admin-modal is-formats wf-tech-editor">
      <div class="sh-admin-head">
        <button class="wf-tech-back" data-action="_backToWeaponFormats" title="Retour aux formats">←</button>
        <div class="sh-admin-head-ico">🎯</div>
        <div class="sh-admin-head-title">
          <h2>Techniques · ${_esc(format.label)}</h2>
          <small>Le joueur choisit une technique avant le jet. « Attaque normale » reste toujours disponible.</small>
        </div>
        <button class="sh-admin-close" data-action="close-modal" title="Fermer">✕</button>
      </div>
      <div class="sh-admin-body">
        <p class="sh-admin-intro">
          Chaque technique possède ses propres règles de déclenchement, dégâts, zone, état, déplacement et coût.
          Les deux premiers blocs restent ouverts ; les réglages avancés se déplient au besoin. Une technique d’arme et une technique élémentaire peuvent être activées ensemble.
        </p>
        <div class="wf-tech-list">
          ${_wfTechniqueDrafts.length
            ? _wfTechniqueDrafts.map(_wfTechniqueCard).join('')
            : '<div class="wf-tech-empty"><span>🎯</span><strong>Aucune technique</strong><small>Les attaques de ce format restent entièrement normales.</small></div>'}
        </div>
        <div class="wf-tech-presets">
          <span>Ajouter :</span>
          <button data-action="_addWeaponFormatTechnique" data-preset="blank">＋ Libre</button>
          <button data-action="_addWeaponFormatTechnique" data-preset="weak_spot">🎯 Point faible</button>
          <button data-action="_addWeaponFormatTechnique" data-preset="power">💥 Coup puissant</button>
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_backToWeaponFormats">Retour</button>
        <div class="sh-admin-footer-spacer"></div>
        <button class="btn btn-gold" data-action="_saveWeaponFormatTechniques">Enregistrer les techniques</button>
      </div>
    </div>`);
  _installWeaponTechniqueCloseGuard();
}

function _wfTechniqueDraftField(el) {
  const technique = _wfTechniqueDrafts[Number(el.dataset.idx)];
  if (!technique) return;
  const field = el.dataset.field;
  technique[field] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (parseInt(el.value, 10) || 0) : el.value;
  _wfTechniqueDirty = true;
}

function _addWeaponFormatTechnique(preset = 'blank') {
  const source = _WF_TECHNIQUE_PRESETS[preset] || _WF_TECHNIQUE_PRESETS.blank;
  _wfTechniqueDrafts.push(normalizeWeaponTechnique({ ...source, id: `tech_${Date.now()}` }, _wfTechniqueDrafts.length));
  _wfTechniqueDirty = true;
  _renderWeaponFormatTechniquesEditor();
}

function _deleteWeaponFormatTechnique(i) {
  if (!_wfTechniqueDrafts[i]) return;
  _wfTechniqueDrafts.splice(i, 1);
  _wfTechniqueDirty = true;
  _renderWeaponFormatTechniquesEditor();
}

async function _backToWeaponFormats() {
  if (_wfTechniqueDirty) {
    const discard = await confirmModal('Revenir aux formats sans enregistrer les techniques ?', { title: 'Modifications non enregistrées' });
    if (!discard) return;
  }
  _wfTechniqueDirty = false;
  _renderWeaponFormatsModal(_weaponFormats || []);
}

async function _saveWeaponFormatTechniques() {
  const i = _wfTechniqueFormatIndex;
  if (!_weaponFormats?.[i]) return;
  const techniques = _wfTechniqueDrafts.map(normalizeWeaponTechnique).filter(t => t.label);
  const invalidFormula = techniques.find(t =>
    [t.extraDamageFormula, t.scalingFormula].some(formula => formula && !/^\d*d\d+(?:[+-]\d+)?$/i.test(formula))
  );
  if (invalidFormula) {
    showNotif(`Formule invalide pour « ${invalidFormula.label} » (exemple attendu : 1d6+2).`, 'error');
    return;
  }
  const formats = _weaponFormats.map((format, idx) => idx === i ? { ...format, techniques } : format);
  await saveWeaponFormats(formats);
  _weaponFormats = formats;
  _wfTechniqueDirty = false;
  showNotif(`${techniques.length} technique${techniques.length > 1 ? 's' : ''} enregistrée${techniques.length > 1 ? 's' : ''}.`, 'success');
  _renderWeaponFormatsModal(formats);
}

// ══════════════════════════════════════════════
// TYPES DE DÉGÂTS — Admin
// ══════════════════════════════════════════════

const MISS_EFFECT_LABELS = { none: 'Aucun', half: 'Moitié', full: 'Complets' };

// Palette d'accès rapide (couvre les types par défaut) — le sélecteur libre reste dispo.
const DT_SWATCHES = ['#9ca3af', '#f97316', '#4f8cff', '#22c38e', '#b47fff', '#6366f1', '#f9d71c', '#ef4444', '#ec4899', '#14b8a6'];

// Résumé compact des réglages d'un type → évite de déplier pour savoir ce qu'il fait.
function _dtBadges(t) {
  const r = t.rules || {}, b = [];
  if (t.isMagic) b.push('<span class="dt-badge dt-badge--mag" title="Élément magique">🔮</span>');
  if (t.techniques?.length) b.push(`<span class="dt-badge dt-badge--tech" title="Technique optionnelle">💥 ${t.techniques.length}</span>`);
  const me = r.missEffect || 'none';
  if (me !== 'none') {
    const scope = r.missScope || 'always';
    const sfx = scope === 'magic' ? ' magie' : scope === 'physical' ? ' phys.' : '';
    b.push(`<span class="dt-badge" title="Dégâts sur un raté">${me === 'half' ? '½' : '100%'} raté${sfx}</span>`);
  }
  if (r.armorPen) b.push(`<span class="dt-badge" title="Pénétration d'armure">PA ${r.armorPen}%</span>`);
  if (r.dmgBonus) b.push(`<span class="dt-badge" title="Bonus de dégâts">${r.dmgBonus > 0 ? '+' : ''}${r.dmgBonus} dég.</span>`);
  return b.join('');
}

function _renderDamageTypesModal(types) {
  _closeDmgEmoji();   // pas de popover orphelin après un re-render
  // Ligne COMPACTE (emoji + nom + résumé) ; les réglages se déplient à la demande
  // (accordéon) → 5 types tiennent à l'écran au lieu d'un long scroll.
  const mkRow = (t, i) => {
    const r = t.rules || {};
    const color = t.color || '#9ca3af';
    const missOpts = ['none', 'half', 'full'].map(v =>
      `<option value="${v}"${(r.missEffect || 'none') === v ? ' selected' : ''}>${MISS_EFFECT_LABELS[v]}</option>`
    ).join('');
    const scopeOpts = [['always', 'Toute attaque'], ['magic', 'Attaques magiques'], ['physical', 'Attaques physiques']].map(([v, l]) =>
      `<option value="${v}"${(r.missScope || 'always') === v ? ' selected' : ''}>${l}</option>`
    ).join('');
    const swatches = DT_SWATCHES.map(c =>
      `<button type="button" class="dt-sw${c.toLowerCase() === color.toLowerCase() ? ' is-active' : ''}"
         style="background:${c}" data-action="_setDmgColor" data-i="${i}" data-color="${c}"
         title="${c}" aria-label="Couleur ${c}"></button>`).join('');
    return `
    <div class="sh-admin-list-item dt-row" data-row="${i}" style="--dt-accent:${_esc(color)}">
      <div class="dt-head">
        <span class="dt-grip" title="Glisser pour réordonner" aria-hidden="true">⠿</span>
        <button type="button" class="dt-emoji-btn" data-action="_openDmgEmoji" data-i="${i}"
          title="Choisir un emoji">${t.icon ? _esc(t.icon) : '<span class="dt-emoji-ph">＋</span>'}</button>
        <input type="text" class="dt-name" value="${_esc(t.label)}" placeholder="Nom du type"
          aria-label="Nom du type"
          data-change="_saveDmgTypeProp" data-i="${i}" data-prop="label">
        <span class="dt-badges" data-badges="${i}">${_dtBadges(t)}</span>
        <button type="button" class="wf-tech-open dt-tech-open" data-action="_editDamageTypeTechniques" data-idx="${i}"
          title="Configurer les techniques de ce type">💥 ${t.techniques?.length || 0}</button>
        <button type="button" class="dt-toggle" data-action="_toggleDmgRow" data-i="${i}"
          title="Régler ce type" aria-label="Régler ce type">▾</button>
        <button class="sh-admin-del-btn" data-action="_deleteDmgType" data-idx="${i}" title="Supprimer">🗑️</button>
      </div>

      <div class="dt-body">
        <div class="dt-colors">
          <span class="dt-colors-lbl">Couleur</span>
          ${swatches}
          <input type="color" class="dt-color-pick" value="${color}"
            title="Couleur personnalisée" aria-label="Couleur personnalisée"
            data-change="_setDmgColorPick" data-i="${i}">
        </div>

        <div class="dt-rules">
          <div class="dt-rules-grid">
            <label class="dt-field">
              <span class="dt-field-lbl">Sur un raté</span>
              <select class="dt-input" data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.missEffect">${missOpts}</select>
              <span class="dt-field-help">Défaut : aucun.</span>
            </label>
            <label class="dt-field">
              <span class="dt-field-lbl">…s'applique à</span>
              <select class="dt-input" data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.missScope">${scopeOpts}</select>
              <span class="dt-field-help">Si ton système distingue.</span>
            </label>
            <label class="dt-field">
              <span class="dt-field-lbl">Pén. armure</span>
              <span class="dt-input-wrap">
                <input type="number" class="dt-input" min="0" max="100" value="${r.armorPen || 0}"
                  data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.armorPen" data-vtype="num">
                <span class="dt-unit">%</span>
              </span>
              <span class="dt-field-help">CA ignorée.</span>
            </label>
            <label class="dt-field">
              <span class="dt-field-lbl">Bonus dégâts</span>
              <input type="number" class="dt-input" value="${r.dmgBonus || 0}"
                data-change="_saveDmgTypeProp" data-i="${i}" data-prop="rules.dmgBonus" data-vtype="num">
              <span class="dt-field-help">À chaque jet.</span>
            </label>
          </div>
          <label class="dt-magic">
            <span class="dt-switch">
              <input type="checkbox" ${t.isMagic ? 'checked' : ''}
                data-change="_saveDmgTypeProp" data-i="${i}" data-prop="isMagic" data-vtype="bool">
              <span class="dt-switch-track"><span class="dt-switch-thumb"></span></span>
            </span>
            <span class="dt-magic-txt">
              <b>🔮 Élément magique</b>
              <small>Réservé aux personnages qui le connaissent · dégâts via maîtrise + stat magique.</small>
            </span>
          </label>
        </div>
      </div>
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
        Glisse ⠿ pour réordonner · <strong>▾</strong> pour régler un type (couleur, comportement en combat,
        nature magique). Les réglages s'appliquent automatiquement dans le VTT.
      </p>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📋 Types existants</div>
        <div class="sh-admin-list">
          ${types.length === 0
            ? '<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun type — ajoute-en un ci-dessous.</div>'
            : types.map((t, i) => mkRow(t, i)).join('')}
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
  _initDmgSortable();
}

const _DT_TECHNIQUE_PRESETS = {
  blank: {
    icon: '💥', label: 'Nouvelle technique', description: '', defenseBonus: 0,
    extraWeaponDice: 0, extraDamageFormula: '', extraDamageFlat: 0,
    addWeaponModifier: false, blastRadius: 0, onHitEffect: '',
  },
  burst: {
    icon: '💥', label: 'Explosion élémentaire',
    description: 'Sur une touche, l’élément explose autour de la cible.',
    defenseBonus: 0, extraWeaponDice: 0, extraDamageFormula: '1d4', extraDamageFlat: 0,
    addWeaponModifier: true, blastRadius: 1, onHitEffect: '',
  },
};

function _dtTechniqueCard(t, i) { return _techniqueConfigCard(t, i, 'damage'); }

function _editDamageTypeTechniques(i) {
  const type = _damageTypes?.[i];
  if (!type) return;
  _dtTechniqueTypeIndex = i;
  _dtTechniqueDrafts = (type.techniques || []).map((technique, idx) => normalizeWeaponTechnique({ ...technique }, idx));
  _dtTechniqueDirty = false;
  _renderDamageTypeTechniquesEditor();
}

function _installDamageTypeTechniqueCloseGuard() {
  setModalCloseGuard(() => {
    if (!_dtTechniqueDirty) return false;
    confirmModal('Quitter sans enregistrer les techniques ?', { title: 'Modifications non enregistrées' })
      .then(ok => {
        if (!ok) return;
        _dtTechniqueDirty = false;
        closeModalDirect();
      });
    return true;
  });
}

function _renderDamageTypeTechniquesEditor() {
  const type = _damageTypes?.[_dtTechniqueTypeIndex];
  if (!type) return _renderDamageTypesModal(_damageTypes || []);
  openModal('', `
    <div class="sh-admin-modal is-formats wf-tech-editor">
      <div class="sh-admin-head">
        <button class="wf-tech-back" data-action="_backToDamageTypes" title="Retour aux types de dégâts">←</button>
        <div class="sh-admin-head-ico">${_esc(type.icon || '💥')}</div>
        <div class="sh-admin-head-title">
          <h2>Techniques · ${_esc(type.label)}</h2>
          <small>Le joueur choisit de les activer avant son jet. L’attaque normale reste toujours disponible.</small>
        </div>
        <button class="sh-admin-close" data-action="close-modal" title="Fermer">✕</button>
      </div>
      <div class="sh-admin-body">
        <p class="sh-admin-intro">
          Cette technique dispose exactement des mêmes possibilités qu’une technique d’arme : déclencheur, précision, dégâts, zone, états, déplacement, coût et recharge.
          Elle peut être cumulée avec une technique de l’arme équipée ; une même cible ne reçoit chaque technique qu’une fois par activation.
        </p>
        <div class="wf-tech-list">
          ${_dtTechniqueDrafts.length
            ? _dtTechniqueDrafts.map(_dtTechniqueCard).join('')
            : '<div class="wf-tech-empty"><span>💥</span><strong>Aucune technique</strong><small>Ce type de dégâts conserve son comportement normal.</small></div>'}
        </div>
        <div class="wf-tech-presets">
          <span>Ajouter :</span>
          <button data-action="_addDamageTypeTechnique" data-preset="blank">＋ Libre</button>
          <button data-action="_addDamageTypeTechnique" data-preset="burst">💥 Explosion 1d4 + mod</button>
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_backToDamageTypes">Retour</button>
        <div class="sh-admin-footer-spacer"></div>
        <button class="btn btn-gold" data-action="_saveDamageTypeTechniques">Enregistrer les techniques</button>
      </div>
    </div>`);
  _installDamageTypeTechniqueCloseGuard();
}

function _dtTechniqueDraftField(el) {
  const technique = _dtTechniqueDrafts[Number(el.dataset.idx)];
  if (!technique) return;
  const field = el.dataset.field;
  technique[field] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (parseInt(el.value, 10) || 0) : el.value;
  _dtTechniqueDirty = true;
}

function _addDamageTypeTechnique(preset = 'blank') {
  const source = _DT_TECHNIQUE_PRESETS[preset] || _DT_TECHNIQUE_PRESETS.blank;
  const type = _damageTypes?.[_dtTechniqueTypeIndex];
  const label = preset === 'burst' && type?.id === 'feu' ? 'Explosion ardente' : source.label;
  _dtTechniqueDrafts.push(normalizeWeaponTechnique({ ...source, label, id: `dtype_tech_${Date.now()}` }, _dtTechniqueDrafts.length));
  _dtTechniqueDirty = true;
  _renderDamageTypeTechniquesEditor();
}

function _deleteDamageTypeTechnique(i) {
  if (!_dtTechniqueDrafts[i]) return;
  _dtTechniqueDrafts.splice(i, 1);
  _dtTechniqueDirty = true;
  _renderDamageTypeTechniquesEditor();
}

async function _backToDamageTypes() {
  if (_dtTechniqueDirty) {
    const discard = await confirmModal('Revenir aux types sans enregistrer les techniques ?', { title: 'Modifications non enregistrées' });
    if (!discard) return;
  }
  _dtTechniqueDirty = false;
  _renderDamageTypesModal(_damageTypes || []);
}

async function _saveDamageTypeTechniques() {
  const i = _dtTechniqueTypeIndex;
  if (!_damageTypes?.[i]) return;
  const techniques = _dtTechniqueDrafts.map(normalizeWeaponTechnique).filter(technique => technique.label);
  const invalidFormula = techniques.find(technique =>
    [technique.extraDamageFormula, technique.scalingFormula].some(formula => formula && !/^\d*d\d+(?:[+-]\d+)?$/i.test(formula))
  );
  if (invalidFormula) {
    showNotif(`Formule invalide pour « ${invalidFormula.label} » (exemple attendu : 1d4+2).`, 'error');
    return;
  }
  const types = _damageTypes.map((type, idx) => idx === i ? { ...type, techniques } : type);
  await saveDamageTypes(types);
  _damageTypes = types;
  _dtTechniqueDirty = false;
  showNotif(`${techniques.length} technique${techniques.length > 1 ? 's' : ''} enregistrée${techniques.length > 1 ? 's' : ''}.`, 'success');
  _renderDamageTypesModal(types);
}

// ── Réordonnancement par glisser-déposer (Sortable, poignée ⠿) ──────────────
async function _initDmgSortable() {
  const list = document.querySelector('.sh-admin-modal.is-formats .sh-admin-list');
  if (!list || list.dataset.sortable) return;
  list.dataset.sortable = '1';
  const { default: Sortable } = await import('../../vendor/sortable.esm.js');
  new Sortable(list, {
    animation: 160, handle: '.dt-grip',
    ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      const types = [...(_damageTypes || [])];
      const [moved] = types.splice(evt.oldIndex, 1);
      types.splice(evt.newIndex, 0, moved);
      await saveDamageTypes(types);
      _damageTypes = types;
      _renderDamageTypesModal(types);
    },
  });
}

// ── Emoji : sélection dans une palette + collage du sien (borné à 1 emoji) ──
const DT_EMOJIS = ['🔥','💧','🌊','🌬️','🪨','⛰️','🌱','⚡','❄️','☀️','🌙','🌑','✨','🌟','💥','💢','🔮','🌀','☠️','🧪','🩸','☣️','⚗️','🦠','🧨','🌋','🧊','♨️','🫧','🌩️','🗡️','🏹','🛡️','⚔️','👊','🦷','🐍','👁️','🪄','📖','⭐','💫'];

// Premier « emoji » (grappheme) d'une chaîne collée → force 1 seul symbole.
function _firstEmoji(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...seg.segment(s)][0]?.segment || '';
  } catch { return [...s][0] || ''; }
}

let _dmgEmojiOutside = null;
function _closeDmgEmoji() {
  document.getElementById('dt-emoji-pop')?.remove();
  if (_dmgEmojiOutside) { document.removeEventListener('mousedown', _dmgEmojiOutside, true); _dmgEmojiOutside = null; }
}
function _openDmgEmoji(i, btn) {
  const already = document.getElementById('dt-emoji-pop');
  _closeDmgEmoji();
  if (already && already.dataset.i === String(i)) return;   // re-clic = fermer
  const pop = document.createElement('div');
  pop.id = 'dt-emoji-pop'; pop.className = 'dt-emoji-pop'; pop.dataset.i = String(i);
  pop.innerHTML = `
    <div class="dt-emoji-paste">
      <input type="text" id="dt-emoji-inp" placeholder="Colle ton emoji…" aria-label="Coller un emoji">
      <button type="button" class="dt-emoji-none" data-action="_pickDmgEmoji" data-i="${i}" data-emo="">Aucun</button>
    </div>
    <div class="dt-emoji-grid">${DT_EMOJIS.map(e =>
      `<button type="button" class="dt-emoji-opt" data-action="_pickDmgEmoji" data-i="${i}" data-emo="${e}">${e}</button>`).join('')}</div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 260, h = pop.offsetHeight || 240;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = (r.bottom + h + 8 > window.innerHeight) ? `${Math.max(8, r.top - h - 6)}px` : `${r.bottom + 6}px`;
  const inp = pop.querySelector('#dt-emoji-inp');
  // Collage / saisie : on ne garde que le 1er emoji.
  inp.addEventListener('input', () => { const e = _firstEmoji(inp.value); if (e && e !== inp.value) inp.value = e; });
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const e = _firstEmoji(inp.value); if (e) _pickDmgEmoji(i, e); } });
  setTimeout(() => inp.focus(), 30);
  _dmgEmojiOutside = (e) => { if (!pop.contains(e.target) && e.target !== btn) _closeDmgEmoji(); };
  requestAnimationFrame(() => document.addEventListener('mousedown', _dmgEmojiOutside, true));
}
async function _pickDmgEmoji(i, emo) {
  const clean = emo ? _firstEmoji(emo) : '';
  await _saveDmgTypeProp(i, 'icon', clean);
  const btn = document.querySelector(`.dt-emoji-btn[data-i="${i}"]`);
  if (btn) btn.innerHTML = clean ? _esc(clean) : '<span class="dt-emoji-ph">＋</span>';
  _closeDmgEmoji();
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
  // Le résumé de la ligne suit sans re-render (donc sans perte de focus).
  const bd = document.querySelector(`[data-badges="${i}"]`);
  if (bd) bd.innerHTML = _dtBadges(types[i]);
}

// Accordéon : un seul type déplié à la fois → la liste reste courte.
function _toggleDmgRow(i) {
  const row = document.querySelector(`.dt-row[data-row="${i}"]`);
  if (!row) return;
  const willOpen = !row.classList.contains('is-open');
  document.querySelectorAll('.dt-row.is-open').forEach(r => r.classList.remove('is-open'));
  if (willOpen) row.classList.add('is-open');
}

// Applique une couleur (pastille rapide ou sélecteur libre) : sauvegarde puis MAJ
// live de la ligne — pas de re-render, donc aucun champ ne perd le focus.
async function _setDmgColor(i, color) {
  if (!color) return;
  await _saveDmgTypeProp(i, 'color', color);
  const row = document.querySelector(`.dt-row[data-row="${i}"]`);
  if (!row) return;
  row.style.setProperty('--dt-accent', color);
  row.querySelectorAll('.dt-sw').forEach(b =>
    b.classList.toggle('is-active', (b.dataset.color || '').toLowerCase() === color.toLowerCase()));
  const pick = row.querySelector('.dt-color-pick');
  if (pick && pick.value !== color) pick.value = color;
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
    // Défaut NEUTRE (D&D-first) : pas de règle maison imposée. Le MJ active
    // ensuite « magique » et/ou un effet de raté s'il le souhaite.
    isMagic: false,
    rules:   { missEffect: 'none', missScope: 'always', armorPen: 0, dmgBonus: 0 },
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
  _editWeaponFormatTechniques: (btn) => _editWeaponFormatTechniques(Number(btn.dataset.idx)),
  _wfTechniqueDraftField:   (el)  => _wfTechniqueDraftField(el),
  _addWeaponFormatTechnique:(btn) => _addWeaponFormatTechnique(btn.dataset.preset),
  _deleteWeaponFormatTechnique: (btn) => _deleteWeaponFormatTechnique(Number(btn.dataset.idx)),
  _saveWeaponFormatTechniques: () => _saveWeaponFormatTechniques(),
  _backToWeaponFormats:     ()    => _backToWeaponFormats(),
  _editDamageTypeTechniques: (btn) => _editDamageTypeTechniques(Number(btn.dataset.idx)),
  _dtTechniqueDraftField:    (el)  => _dtTechniqueDraftField(el),
  _addDamageTypeTechnique:   (btn) => _addDamageTypeTechnique(btn.dataset.preset),
  _deleteDamageTypeTechnique:(btn) => _deleteDamageTypeTechnique(Number(btn.dataset.idx)),
  _saveDamageTypeTechniques: ()    => _saveDamageTypeTechniques(),
  _backToDamageTypes:        ()    => _backToDamageTypes(),
  _addWeaponFormat:         ()    => _addWeaponFormat(),
  _deleteWeaponFormat:      (btn) => _deleteWeaponFormat(Number(btn.dataset.idx)),
  openCombatStylesAdmin:    ()    => openCombatStylesAdmin(),
  openWeaponFormatsAdmin:   ()    => openWeaponFormatsAdmin(),
  openDamageTypesAdmin:     ()    => openDamageTypesAdmin(),
  openSpellMatricesAdmin:   ()    => openSpellMatricesAdmin(),
  openCharacterRulesAdmin:  ()    => openCharacterRulesAdmin(),
  openEquipmentSlotsAdmin:  ()    => openEquipmentSlotsAdmin(),
  openArmorSetsAdmin:       ()    => openArmorSetsAdmin(),
  openSpellSystemAdmin:     ()    => openSpellSystemAdmin(),
  _addDmgType:              ()    => _addDmgType(),
  _deleteDmgType:           (btn) => _deleteDmgType(Number(btn.dataset.idx)),
  _setDmgColor:             (btn) => _setDmgColor(Number(btn.dataset.i), btn.dataset.color),
  _setDmgColorPick:         (el)  => _setDmgColor(Number(el.dataset.i), el.value),
  _openDmgEmoji:            (btn) => _openDmgEmoji(Number(btn.dataset.i), btn),
  _pickDmgEmoji:            (btn) => _pickDmgEmoji(Number(btn.dataset.i), btn.dataset.emo),
  _toggleDmgRow:            (btn) => _toggleDmgRow(Number(btn.dataset.i)),
  _switchSpellMatrixTab:    (btn) => _switchSpellMatrixTab(btn.dataset.tab),
  _saveSpellMatrices:       ()    => _saveSpellMatrices(),
});
