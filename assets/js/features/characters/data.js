import { getDocData, saveDoc, loadCollection, updateInCol } from '../../data/firestore.js';
import { registerActions } from '../../core/actions.js';
import { openModal, closeModal, closeModalDirect, confirmModal, setModalCloseGuard } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { loadWeaponFormats, saveWeaponFormats, normalizeWeaponTechnique, normalizeWeaponFormat } from '../../shared/weapon-formats.js';
import { loadDamageTypes, saveDamageTypes, damageTypeEmitsLight, normalizeDamageType, DEFAULT_RULES, invalidateDamageTypesCache } from '../../shared/damage-types.js';
import { CONDITION_DEFAULT_LIBRARY, loadConditionLibrary } from '../../shared/conditions.js';
import { loadSpellMatrices, saveSpellMatrices, SPELL_SLOTS, SLOT_LABELS, COMBO_IDS, COMBO_DEFAULTS } from '../../shared/spell-matrices.js';
import { _esc, modStr } from '../../shared/html.js';
import { computeEquipStatsBonus, getMod, getMaitriseBonus as _getMaitriseBonus, statShort } from '../../shared/char-stats.js';
import { openCharacterRulesAdmin } from '../../shared/character-rules.js';
import { openEquipmentSlotsAdmin, getPrimaryWeaponSlotId, getSecondaryWeaponSlotId } from '../../shared/equipment-slots.js';
import { openArmorSetsAdmin } from '../../shared/armor-set-settings.js';
import { openSpellSystemAdmin } from '../../shared/spell-system.js';
import { defaultCombatStyles, detectCombatStyle as detectCombatStyleRule, normalizeCombatStyles } from '../../shared/combat-styles.js';
import { WEAPON_HANDS_OPTIONS, hasWeaponDefaults, missingWeaponFamilies, normalizeWeaponDefaults, resolveWeaponFamily, weaponDefaultsSummary, weaponHandsLabel, normalizeWeaponFamilyKey } from '../../shared/weapon-family.js';
import { simulate as _wfSimulate, simBreakEven as _wfBreakEven } from '../../shared/weapon-sim.js';
import { makeTechniqueEditor } from '../../shared/technique-editor.js';
import { DEFAULT_UNARMED, isWeaponLikeItem, getMainWeapon, normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData, syncEquipmentAfterInventoryMutation, resolveEquippedInventoryIndices, _getBaseTraits, _getAddedTraits, _getTraits } from '../../shared/equipment-utils.js';
export { DEFAULT_UNARMED, getMainWeapon, normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData, syncEquipmentAfterInventoryMutation, _getBaseTraits, _getAddedTraits, _getTraits };

// ══════════════════════════════════════════════
// STYLES DE COMBAT
// Firestore : world/combat_styles → { styles:[{id,label,condPrincipale,condSecondaire,description,couleur}] }
// ══════════════════════════════════════════════
export let _combatStyles = null; // cache en mémoire
export let _weaponFormats = null; // cache en mémoire (partagé avec weapon-formats.js)
let _damageTypes = null; // cache local types de dégâts
let _techniqueConditions = CONDITION_DEFAULT_LIBRARY;
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
  return detectCombatStyleRule(c, styles, _weaponFormats || []);
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
                  <span><b>Principale</b>${_esc((s.condPrincipale || []).filter(Boolean).join(', ') || ((s.condPrincipale || []).length ? 'aucune arme' : 'toute arme'))}${s.condMains ? ` · ${s.condMains === '2' ? '2 mains' : '1 main'}` : ''}</span>
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
    { v:'*', l:'(toute arme)' },
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
          <div class="cs-style-editor-heading"><span>2</span><div><b>Équipement déclencheur</b><small>Types d’arme par main ; plusieurs choix dans une main signifient « ou ». Aucun choix = n’importe quelle arme.</small></div></div>
          <div class="cs-style-hands-grid">
            <div class="cs-style-hand">
              <label>Main principale</label>
              <div id="cs-cond-p" class="cs-style-conditions">
        ${(s.condPrincipale?.length ? s.condPrincipale : ['*']).map((v,fi) => `
                <div class="cs-style-condition-row">
          <select class="input-field cs-cond-p-sel">
            ${_getFormatsOpt().map(o=>`<option value="${_esc(o.v)}" ${v===o.v?'selected':''}>${_esc(o.l)}</option>`).join('')}
          </select>
                  <button type="button" data-action="_removeParent" title="Retirer">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" data-action="_csAddCond" data-container="cs-cond-p" data-sel="cs-cond-p-sel"
                class="cs-style-add-condition">＋ Ajouter un type</button>
              <label class="cs-style-field" style="margin-top:.5rem"><span>Maniement de l’arme principale</span>
                <select class="input-field" id="cs-style-hands">
                  <option value="" ${!style.condMains ? 'selected' : ''}>Indifférent</option>
                  <option value="1" ${String(style.condMains) === '1' ? 'selected' : ''}>À une main</option>
                  <option value="2" ${String(style.condMains) === '2' ? 'selected' : ''}>À deux mains</option>
                </select>
              </label>
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
                class="cs-style-add-condition">＋ Ajouter un type</button>
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
    condMains: document.getElementById('cs-style-hands')?.value || '',
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
// FORMATS D'ARMES — Admin (modale maître/détail, brouillon unique)
// ══════════════════════════════════════════════
// Armes de la boutique (catalogue) : compteur par type + migration « format de
// maniement → type d'arme ». Collection session-live : aucune lecture en plus.
let _wfShopWeapons = [];

// — État : un SEUL brouillon pour tout (nature, défauts, techniques). La bascule
//   physique/magique, l'ajout, la suppression et les techniques ne sont plus
//   enregistrés au fil de l'eau (sauf les actions de migration, cf. §migration).
let _wfSaved = [];       // référence enregistrée (clone normalisé)
let _wfDraft = [];       // brouillon courant
let _wfSelId = null;     // id du type sélectionné
let _wfOpenTech = null;  // id de la technique ouverte (accordéon)
let _wfAsk = null;       // 'close' | 'del' | null
let _wfFxMenu = false;   // menu « ajouter un modificateur » ouvert
let _wfAddMenu = false;  // menu « ajouter une technique » ouvert
let _wfSim = { atk: 5, ca: 14, mod: 3, adv: false }; // hypothèses de simulation (non persisté)
let _wfSimNormal = false; // aperçu joueur : « Attaque normale » sélectionnée
let _wfMounted = false;

const _wfCloneList = v => (v || []).map(f => normalizeWeaponFormat({ ...f }));
const _wfCur = () => _wfDraft.find(f => f.id === _wfSelId) || _wfDraft[0] || null;
const _wfIsLegacy = f => /^arme\s/i.test(f?.label || '') || f?.legacy === true;
const _WF_DEGATS_RE = /^\d*d\d+(?:[+-]\d+)?$/i;

// ── Icônes (sprite injecté à l'ouverture) ──
const _WF_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="wf-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></symbol>
<symbol id="wf-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
<symbol id="wf-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></symbol>
<symbol id="wf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></symbol>
<symbol id="wf-dup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol>
<symbol id="wf-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></symbol>
<symbol id="wf-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="wf-undo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></symbol>
</defs></svg>`;
const _wfIc = id => `<svg class="wf-ic"><use href="#wf-${id}"></use></svg>`;

// ── Métadonnées des modificateurs de technique (résumé + tag d'équilibrage) ──
// `on(t)` : actif = champ ≠ défaut. `good` : avantage (vert) vs contrepartie.
// `txt(t)` : fragment de résumé. Réutilisé par la simulation (phase C).
const _WF_STAT_SHORT = { force: 'FOR', dexterite: 'DEX', constitution: 'CON', intelligence: 'INT', sagesse: 'SAG', charisme: 'CHA' };
const _wfDmgLabel = id => (_damageTypes || []).find(d => d.id === id)?.label || id || '';
const _wfCondLabel = id => (_techniqueConditions || []).find(c => c.id === id)?.label || id || '';
const _wfDmgOpts = () => (_damageTypes || []).map(d => [d.id, `${d.icon ? d.icon + ' ' : ''}${d.label}`]);
const _wfCondOpts = () => (_techniqueConditions || []).map(c => [c.id, `${c.icon ? c.icon + ' ' : ''}${c.label}`]);
// ── Éditeur de techniques factorisé (shared/technique-editor.js), partagé par
//    la modale des types d'arme et celle des types de dégâts. Une seule table de
//    modificateurs, une seule carte. Les contrôleurs hôtes dispatchent data-wf-*.
const _TE = makeTechniqueEditor({
  esc: _esc, icon: _wfIc,
  statOptions: () => _TECH_STAT_OPTIONS,
  damageTypeOptions: _wfDmgOpts, conditionOptions: _wfCondOpts,
  damageLabel: _wfDmgLabel, conditionLabel: _wfCondLabel, degatsRe: _WF_DEGATS_RE,
});
const _WF_MODS = _TE.MODS;
const _WF_GROUPS = _TE.GROUPS;
function _wfTechActiveMods(t) { return _TE.activeMods(t); }
function _wfTechSummary(t) { return _TE.summary(t); }
function _wfTechFormulaBad(t) { return _TE.isInvalid(t); }
function _wfTechTag(t) { return _TE.balance(t); }
function _wfTechEditorHtml(f, t) { return _TE.editorHtml(t, { menuOpen: _wfFxMenu }); }
function _wfFxMenuHtml(t) { return _TE.fxMenuHtml(t); }
const _WF_PRESET_ORDER = [['blank', 'Technique libre'], ['weak_spot', 'Point faible'], ['power', 'Coup puissant'], ['dagger_sneak', 'Coup sournois'], ['axe_momentum', 'Élan total'], ['hammer_crush', 'Broyeur'], ['sword_control', 'Frappe maîtrisée']];
function _wfAddTechMenuHtml() { return _TE.presetMenuHtml(_WF_TECHNIQUE_PRESETS, normalizeWeaponTechnique, _WF_PRESET_ORDER); }

export async function openWeaponFormatsAdmin() {
  let shopItems = [];
  [_weaponFormats, _damageTypes, _techniqueConditions, shopItems] = await Promise.all([
    loadWeaponFormats(), loadDamageTypes(), loadConditionLibrary(), loadCollection('shop').catch(() => []),
  ]);
  _wfShopWeapons = (shopItems || []).filter(isWeaponLikeItem);
  _wfSaved = _wfCloneList(_weaponFormats);
  _wfDraft = _wfCloneList(_weaponFormats);
  _wfSelId = _wfDraft[0]?.id || null;
  _wfOpenTech = _wfCur()?.techniques?.[0]?.id || null;
  _wfAsk = null;
  _renderWeaponFormatsModal();
  _wfMount();
}

// ── Compteur d'armes de la boutique par type (resolveWeaponFamily) ──
function _wfCount(f) {
  if (!f || !_wfShopWeapons.length) return 0;
  return _wfShopWeapons.filter(w => resolveWeaponFamily(_wfDraft, w)?.id === f.id).length;
}

// ── Validation continue ──
function _wfTypeErrs(f) {
  const e = [];
  if (!String(f.label || '').trim()) e.push('name');
  else if (_wfDraft.some(o => o !== f && normalizeWeaponFamilyKey(o.label) === normalizeWeaponFamilyKey(f.label))) e.push('dupname');
  const deg = String(f.defaults?.degats || '').replace(/\s+/g, '');
  if (deg && !_WF_DEGATS_RE.test(deg)) e.push('degats');
  if ((f.techniques || []).some(t => !String(t.label || '').trim() || _wfTechFormulaBad(t))) e.push('tech');
  return e;
}
const _wfAllErr = () => _wfDraft.filter(f => _wfTypeErrs(f).length);
const _wfDirty = () => JSON.stringify(_wfDraft) !== JSON.stringify(_wfSaved);

// ══════════════════════════════════════════════
// Migration (actions immédiates : brouillon + référence enregistrée)
// ══════════════════════════════════════════════
function _wfMigrationState() {
  const missing = missingWeaponFamilies(_wfDraft, _wfShopWeapons);
  const toUpdate = [];
  const untyped = [];
  for (const item of _wfShopWeapons) {
    const family = resolveWeaponFamily(_wfDraft, item);
    if (!family || _wfIsLegacy(family)) { untyped.push(item); continue; }
    if (item.format !== family.label || item.formatId !== family.id || item.sousType !== family.label || !item.mains) {
      toUpdate.push({ item, family });
    }
  }
  return { missing, toUpdate, untyped };
}

function _wfMigrationHtml() {
  if (!_wfShopWeapons.length) return '';
  const { missing, toUpdate, untyped } = _wfMigrationState();
  const legacy = _wfDraft.filter(_wfIsLegacy);
  if (!missing.length && !toUpdate.length && !untyped.length && !legacy.length) return '';
  const step = (ok, body) => `<div class="wf-mig-s${ok ? ' ok' : ''}"><i>${ok ? '✓' : ''}</i><div>${body}</div></div>`;
  return `<div class="wf-mig"><b>🔁 Passage aux types d’arme</b>
    <p>Les anciens formats de maniement sont remplacés par des types d’arme ; le maniement devient un champ de chaque arme.</p>
    ${step(!missing.length, missing.length
      ? `Créer <b>${missing.length}</b> type${missing.length > 1 ? 's' : ''} : ${missing.map(f => `${_esc(f.label)}${f.isMagic ? ' 🔮' : ''}`).join(', ')}.<br><button type="button" class="wf-btn gh sm" data-wf-mig="import">Créer</button>`
      : 'Tous les types saisis sur les armes existent.')}
    ${step(!toUpdate.length, toUpdate.length
      ? `Mettre à jour <b>${toUpdate.length}</b> arme${toUpdate.length > 1 ? 's' : ''} (type + maniement).<br><button type="button" class="wf-btn gh sm" data-wf-mig="convert">Mettre à jour</button>`
      : 'Les armes de la boutique sont à jour.')}
    ${step(!legacy.length, legacy.length
      ? `Réattribuer les techniques des anciens formats, puis supprimer : ${legacy.map(f => _esc(f.label)).join(', ')}.`
      : 'Aucun ancien format restant.')}
    ${untyped.length ? `<p style="color:var(--amber)">⚠️ ${untyped.length} arme${untyped.length > 1 ? 's' : ''} sans type reconnu : ${untyped.slice(0, 10).map(i => _esc(i.nom || '?')).join(', ')}${untyped.length > 10 ? '…' : ''}</p>` : ''}
  </div>`;
}

async function _wfMigImport() {
  const missing = missingWeaponFamilies(_wfDraft, _wfShopWeapons);
  if (!missing.length) return;
  const stamp = Date.now();
  missing.forEach((f, i) => {
    const created = normalizeWeaponFormat({ id: `type_${stamp}_${i}`, label: f.label, damageType: f.damageType, isMagic: f.isMagic, techniques: [] });
    _wfDraft.push(created);
    _wfSaved.push(_wfCloneList([created])[0]); // enregistré d'office : pas une modif en attente
  });
  await saveWeaponFormats(_wfDraft);
  _weaponFormats = _wfCloneList(_wfDraft);
  showNotif(`${missing.length} type${missing.length > 1 ? 's' : ''} d’arme créé${missing.length > 1 ? 's' : ''}.`, 'success');
  _wfRender();
}

async function _wfMigConvert() {
  const { toUpdate } = _wfMigrationState();
  if (!toUpdate.length) return;
  let done = 0;
  for (const { item, family } of toUpdate) {
    const patch = { format: family.label, formatId: family.id, sousType: family.label, mains: item.mains || weaponHandsLabel(item) };
    const ok = await updateInCol('shop', item.id, patch).then(() => true, () => false);
    if (ok) { Object.assign(item, patch); done += 1; }
  }
  showNotif(`${done}/${toUpdate.length} arme(s) mise(s) à jour.`, done === toUpdate.length ? 'success' : 'warning');
  _wfRender();
}

// ══════════════════════════════════════════════
// Rendu
// ══════════════════════════════════════════════
function _wfRowSub(f) {
  if (_wfIsLegacy(f)) return 'Ancien format';
  const n = (f.techniques || []).length;
  const deg = f.defaults?.degats || '';
  return [deg, `${n} technique${n > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
}
function _wfListHtml() {
  const groups = [
    ['Physiques', _wfDraft.filter(f => !f.isMagic && !_wfIsLegacy(f)), 'var(--gold)'],
    ['Magiques', _wfDraft.filter(f => f.isMagic && !_wfIsLegacy(f)), 'var(--arcane)'],
    ['Anciens formats', _wfDraft.filter(_wfIsLegacy), 'var(--amber)'],
  ];
  let h = '';
  groups.forEach(([label, list, color]) => {
    if (!list.length) return;
    h += `<span class="wf-lbl">${label}</span>`;
    h += list.map(f => {
      const err = _wfTypeErrs(f).length, dirty = JSON.stringify(f) !== JSON.stringify(_wfSaved.find(o => o.id === f.id));
      const cnt = _wfCount(f);
      const mark = err ? '<span class="wf-err" title="À corriger"></span>'
        : dirty ? '<span class="wf-dirty" title="Modifié"></span>'
          : (cnt ? `<span class="wf-cnt" title="Armes de la boutique">${cnt}</span>` : '');
      return `<button type="button" class="wf-row${f.id === _wfSelId ? ' on' : ''}${_wfIsLegacy(f) ? ' legacy' : ''}" style="--c:${color}" data-wf-sel="${_esc(f.id)}">
        <span class="wf-dot"></span>
        <span style="min-width:0"><span class="wf-nm">${_esc(f.label) || '<i style=\"color:var(--crimson)\">Sans nom</i>'}</span><span class="wf-sub">${_esc(_wfRowSub(f))}</span></span>
        ${mark}</button>`;
    }).join('');
  });
  h += `<button type="button" class="wf-add" data-wf-add>${_wfIc('plus')}Nouveau type</button>`;
  h += _wfMigrationHtml();
  return h;
}

function _wfStatChips(f) {
  const sel = f.defaults?.degatsStats || [];
  return Object.entries(_WF_STAT_SHORT).map(([k, short]) => {
    const on = sel.includes(k), full = sel.length >= 2 && !on;
    return `<button type="button" class="wf-chip${on ? ' on' : ''}" ${full ? 'disabled' : ''} data-wf-stat="${k}">${short}</button>`;
  }).join('');
}
function _wfProfileHtml(f) {
  const d = f.defaults || {};
  const statOpt = (sel) => `<option value="">Aucune</option>${_TECH_STAT_OPTIONS.map(([v, l]) => `<option value="${v}"${sel === v ? ' selected' : ''}>${l}</option>`).join('')}`;
  return `<div class="wf-prof">
    <div class="wf-pf"><span>Dégâts</span><input class="wf-fi${_wfTypeErrs(f).includes('degats') ? ' bad' : ''}" value="${_esc(d.degats || '')}" maxlength="30" placeholder="1d8" data-wf-degats></div>
    <div class="wf-pf"><span>Carac de dégâts (2 max)</span><div class="wf-chips">${_wfStatChips(f)}</div></div>
    <div class="wf-pf"><span>Carac de toucher</span><select class="wf-sel sans" data-wf-toucher>${statOpt(d.toucherStat || '')}</select></div>
    <div class="wf-pf"><span>Maniement</span><div class="wf-seg">${[['', 'Libre'], ...WEAPON_HANDS_OPTIONS.map(v => [v, v])].map(([v, l]) => `<button type="button" class="${(d.mains || '') === v ? 'on' : ''}" data-wf-mains="${v}">${l}</button>`).join('')}</div></div>
    <div class="wf-pf"><span>Portée</span><input class="wf-fi sans" value="${_esc(d.portee || '')}" maxlength="30" placeholder="1, 18/54…" data-wf-portee></div>
    <div class="wf-pf"><span>Bonus de CA</span><div class="wf-stp"><button type="button" data-wf-ca="-1">−</button><span>${d.caBonus > 0 ? '+' : ''}${d.caBonus || 0}</span><button type="button" data-wf-ca="1">+</button></div></div>
  </div>
  <p class="wf-pline">Sur l’arme : <b>${_esc(weaponDefaultsSummary(d, statShort) || 'aucun pré-remplissage')}</b>. Une valeur saisie à la main n’est jamais écrasée.</p>`;
}

function _wfTechniquesHtml(f) {
  const techs = f.techniques || [];
  let h = '<div class="wf-tqs">';
  h += techs.length ? techs.map(t => {
    const open = t.id === _wfOpenTech, tag = _wfTechTag(t);
    return `<div class="wf-tq${open ? ' open' : ''}${tag?.cls === 'ko' ? ' bad' : ''}">
      <button type="button" class="wf-tq-h" data-wf-tech="${_esc(t.id)}">
        <span class="wf-tq-ic">${_esc(t.icon || '🎯')}</span>
        <span style="min-width:0"><b>${_esc(t.label) || '<i style=\"color:var(--crimson)\">Sans nom</i>'}</b><span class="wf-tq-sum">${_esc(_wfTechSummary(t))}</span></span>
        ${tag ? `<span class="wf-tag ${tag.cls}">${tag.txt}</span>` : '<span></span>'}
        ${_wfIc('chev')}
      </button>
      ${open ? _wfTechEditorHtml(f, t) : ''}
    </div>`;
  }).join('') : '<div class="wf-empty-fx">Aucune technique. Les attaques de ce type restent normales.</div>';
  h += '</div>';
  h += `<div class="wf-addtq"><button type="button" class="wf-addtier" data-wf-addmenu>${_wfIc('plus')}Ajouter une technique</button>${_wfAddMenu ? _wfAddTechMenuHtml() : ''}</div>`;
  return h;
}

// ── Simulation (colonne droite) : 100 % client, rien n'est enregistré ──
const _wfPct = p => `${Math.round(p * 100)}%`;
const _wfSg1 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace('.0', '')}`;
function _wfSimStp(field, val, { min, max, pre = '' } = {}) {
  return `<div class="wf-stp"><button type="button" data-wf-sim="${field}" data-dir="-1" data-min="${min}" data-max="${max}">−</button><span>${pre}${val}</span><button type="button" data-wf-sim="${field}" data-dir="1" data-min="${min}" data-max="${max}">+</button></div>`;
}
function _wfCmpRow(label, a, b, fmt, better) {
  const cls = b > a ? (better === 'up' ? 'up' : 'dn') : b < a ? (better === 'up' ? 'dn' : 'up') : '';
  return `<span>${label}</span><b>${fmt(a)}</b><b class="${cls}">${fmt(b)}</b>`;
}
function _wfSimHtml() {
  const f = _wfCur();
  if (!f) return '<div class="wf-empty"><p>Sélectionne un type pour simuler ses techniques.</p></div>';
  const techs = f.techniques || [];
  const tech = _wfSimNormal ? null : (techs.find(x => x.id === _wfOpenTech) || techs[0] || null);
  const P = _wfSim;
  const simN = _wfSimulate(f, null, P);
  const simT = tech ? _wfSimulate(f, tech, P) : null;
  const noDice = !(f.defaults?.degats || '').trim();

  let h = `<h2>Simulation</h2><p>Un héros fictif attaque une cible. Rien n'est enregistré.${noDice ? ' <span style="color:var(--amber)">Renseigne les dégâts pour une estimation fidèle (1d6 par défaut).</span>' : ''}</p>`;
  h += `<div class="wf-hyp">
    <span>Bonus d'attaque</span>${_wfSimStp('atk', P.atk, { min: -5, max: 20, pre: P.atk > 0 ? '+' : '' })}
    <span>CA de la cible</span>${_wfSimStp('ca', P.ca, { min: 5, max: 30 })}
    <span>Mod. de carac</span>${_wfSimStp('mod', P.mod, { min: -3, max: 12, pre: P.mod > 0 ? '+' : '' })}
    <span>Avantage</span><label class="wf-mini" style="justify-content:flex-end"><button type="button" class="wf-sw${P.adv ? ' on' : ''}" data-wf-simadv role="switch" aria-checked="${P.adv}"></button></label>
  </div>`;

  if (simT) {
    h += `<div class="wf-cmp">
      <div class="hd">Par attaque</div><div class="hd">Normale</div><div class="hd">${_esc(tech.label) || 'Technique'}</div>
      ${_wfCmpRow('Toucher', simN.hitPct, simT.hitPct, _wfPct, 'up')}
      ${_wfCmpRow('Critique', simN.critPct, simT.critPct, _wfPct, 'up')}
      ${_wfCmpRow('Dégâts/touche', simN.dmgHit, simT.dmgHit, v => v.toFixed(1), 'up')}
      <div class="tot">Attendu</div><b class="tot">${simN.expected.toFixed(1)}</b><b class="tot ${simT.expected > simN.expected ? 'up' : simT.expected < simN.expected ? 'dn' : ''}">${simT.expected.toFixed(1)}</b>
    </div>`;

    const diff = simT.expected - simN.expected;
    const be = _wfBreakEven(f, tech, P);
    const unq = [];
    if ((tech.blastRadius || 0) > 0) unq.push('zone');
    if (tech.conditionId) unq.push('état');
    if ((tech.forcedMovement || 'none') !== 'none') unq.push('déplacement');
    if ((tech.scalingMode || 'none') !== 'none') unq.push('progression');
    const cost = [];
    if ((tech.resourceType || 'none') !== 'none' && tech.resourceCost) cost.push(`${tech.resourceCost} ${({ pm: 'PM', pv: 'PV', or: 'or' })[tech.resourceType] || ''}`);
    if ((tech.usageScope || 'none') !== 'none') cost.push(`${tech.maxUses || 1}/${tech.usageScope === 'session' ? 'session' : 'combat'}`);
    if (tech.cooldownRounds) cost.push(`recharge ${tech.cooldownRounds} t`);
    h += `<div class="wf-verd ${diff > 0.05 ? 'good' : diff < -0.05 ? 'bad' : ''}">
      <b>${_wfSg1(diff)} dégât attendu par attaque</b>
      <span>contre CA ${P.ca}${be != null ? ` · rentable à partir de CA ${be}` : diff >= 0 ? ' · gagnant sur toute la plage' : ' · perdant sur toute la plage'}</span>
      ${tech.inactive || (tech.requiresAdvantage && !P.adv) ? '<span class="risk">Nécessite l\'avantage : inactive ici.</span>' : ''}
      ${(tech.missSelfCaMalus || 0) > 0 ? `<span class="risk">Raté dans ${_wfPct(1 - simT.hitPct)} des cas → CA −${tech.missSelfCaMalus} jusqu'à la fin du round.</span>` : ''}
      ${(tech.missSelfConditionId) ? `<span class="risk">Raté → ${_esc(_wfCondLabel(tech.missSelfConditionId))} sur soi.</span>` : ''}
      ${cost.length ? `<span>Coût : ${cost.join(' · ')}.</span>` : ''}
      ${unq.length ? `<span>Non chiffré : ${unq.join(', ')}.</span>` : ''}
    </div>`;

    // Courbe : écart attendu de CA 8 à 24.
    const diffs = [];
    for (let ca = 8; ca <= 24; ca++) diffs.push({ ca, d: _wfSimulate(f, tech, { ...P, ca }).expected - _wfSimulate(f, null, { ...P, ca }).expected });
    const maxAbs = Math.max(0.1, ...diffs.map(x => Math.abs(x.d)));
    h += `<div class="wf-sec"><span class="wf-lbl">Écart attendu selon la CA</span>
      <div class="wf-curve">${diffs.map(x => `<button type="button" class="wf-cv ${x.d >= 0 ? 'p' : 'n'}${x.ca === P.ca ? ' cur' : ''}" data-wf-curve="${x.ca}" title="CA ${x.ca} : ${_wfSg1(x.d)}"><i style="height:${Math.round(Math.abs(x.d) / maxAbs * 46)}%"></i></button>`).join('')}</div>
      <div class="wf-cax"><span>CA 8</span><span>16</span><span>24</span></div></div>`;
  } else {
    h += `<div class="wf-verd"><b>Attaque normale</b><span>Toucher ${_wfPct(simN.hitPct)} · critique ${_wfPct(simN.critPct)} · ${simN.dmgHit.toFixed(1)} dégâts/touche · ${simN.expected.toFixed(1)} attendu.</span></div>`;
  }

  // Aperçu joueur : Attaque normale + techniques (grisées si avantage requis absent).
  h += `<div class="wf-sec"><span class="wf-lbl">Côté joueur</span><div class="wf-pick">`;
  h += `<button type="button" class="wf-po${_wfSimNormal ? ' on' : ''}" data-wf-pick="normal"><i></i><span class="wf-e2">⚔️</span><span style="min-width:0"><b>Attaque normale</b><small>Toujours disponible</small></span></button>`;
  h += techs.map(x => {
    const dis = x.requiresAdvantage && !P.adv;
    const sel = !_wfSimNormal && x.id === tech?.id;
    return `<button type="button" class="wf-po${sel ? ' on' : ''}${dis ? ' dis' : ''}" data-wf-pick="${_esc(x.id)}"><i></i><span class="wf-e2">${_esc(x.icon || '🎯')}</span><span style="min-width:0"><b>${_esc(x.label) || 'Sans nom'}</b><small>${_esc(dis ? 'Nécessite l\'avantage' : (x.description || _wfTechSummary(x)))}</small></span></button>`;
  }).join('');
  h += `</div></div>`;
  return h;
}

function _wfMainHtml() {
  const f = _wfCur();
  if (!f) return `<div class="wf-empty"><p>Aucun type d’arme.</p><button type="button" class="wf-btn gh" data-wf-add>Nouveau type</button></div>`;
  const e = _wfTypeErrs(f), i = _wfDraft.indexOf(f), cnt = _wfCount(f);
  const saved = _wfSaved.find(o => o.id === f.id);
  const locked = !!saved && cnt > 0; // renommage propagé non livré → verrouillé si utilisé
  const nat = f.isMagic ? 1 : 0;
  const natWord = _wfIsLegacy(f) ? 'OLD' : f.isMagic ? 'MAG' : 'PHY';
  const color = _wfIsLegacy(f) ? 'var(--amber)' : f.isMagic ? 'var(--arcane)' : 'var(--gold)';
  const st = e.includes('name') ? ['ko', 'Donne un nom au type.']
    : e.includes('dupname') ? ['ko', 'Un autre type porte déjà ce nom.']
      : locked ? ['', `${cnt} arme${cnt > 1 ? 's' : ''} · duplique pour créer une variante (le renommage d’un type utilisé viendra plus tard)`]
        : ['', [cnt ? `${cnt} arme${cnt > 1 ? 's' : ''} de la boutique` : 'Aucune arme', f.isMagic ? 'dégâts selon l’élément de l’arme' : 'dégâts physiques'].join(' · ')];

  let h = `<div class="wf-eh" style="--c:${color}">
    <div class="wf-nat">${natWord}</div>
    <div class="wf-t">
      <input class="wf-name${e.includes('name') || e.includes('dupname') ? ' bad' : ''}" id="wf-name" value="${_esc(f.label)}" placeholder="Ex. Hallebarde" ${locked ? 'readonly title="Renommage verrouillé : type utilisé par des armes"' : ''} data-wf-name>
      <small class="${st[0]}">${_esc(st[1])}</small>
    </div>
    <div class="wf-acts">
      ${_wfIsLegacy(f) ? '' : `<div class="wf-seg nat-s"><button type="button" class="${nat === 0 ? 'on' : ''}" data-nat="0" data-wf-nat="0">Physique</button><button type="button" class="${nat === 1 ? 'on' : ''}" data-nat="1" data-wf-nat="1">Magique</button></div>`}
      <button type="button" class="wf-ib" data-wf-mv="-1" title="Monter" ${i <= 0 ? 'disabled' : ''}>${_wfIc('up')}</button>
      <button type="button" class="wf-ib" data-wf-mv="1" title="Descendre" ${i >= _wfDraft.length - 1 ? 'disabled' : ''}>${_wfIc('down')}</button>
      <button type="button" class="wf-ib" data-wf-dup title="Dupliquer">${_wfIc('dup')}</button>
      <button type="button" class="wf-ib del" data-wf-del title="Supprimer">${_wfIc('trash')}</button>
    </div>
  </div>`;

  if (_wfIsLegacy(f)) {
    const targets = _wfDraft.filter(o => o !== f && !_wfIsLegacy(o));
    const n = (f.techniques || []).length;
    h += `<div class="wf-banner">${n
      ? `<div><b>Ancien format.</b> Ses ${n} technique${n > 1 ? 's' : ''} doivent rejoindre un vrai type.</div>${targets.length ? `<select class="wf-sel sans" id="wf-movetgt">${targets.map(o => `<option value="${_esc(o.id)}">${_esc(o.label)}</option>`).join('')}</select><button type="button" class="wf-btn gh sm" data-wf-movetechs>Déplacer ${n} technique${n > 1 ? 's' : ''}</button>` : ''}`
      : `<div><b>Ce format est vide.</b></div><button type="button" class="wf-btn gh sm" data-wf-del>Supprimer le format</button>`}</div>`;
  }

  h += `<div class="wf-sec"><span class="wf-lbl">Profil par défaut</span>${_wfProfileHtml(f)}</div>`;
  h += `<div class="wf-sec"><span class="wf-lbl">Techniques</span><p class="wf-hint">Le joueur choisit une technique avant le jet ; « Attaque normale » reste disponible.</p>${_wfTechniquesHtml(f)}</div>`;
  return h;
}

function _wfFootHtml() {
  const bad = _wfAllErr(), dirty = _wfDirty();
  if (_wfAsk === 'close') return `<span class="wf-ask">Abandonner les modifications ?</span><span class="wf-sp"></span><button type="button" class="wf-btn tx" data-wf-keep>Continuer l’édition</button><button type="button" class="wf-btn gh" data-wf-discard>Abandonner</button>`;
  if (_wfAsk === 'del') {
    const f = _wfCur(), c = _wfCount(f), n = (f?.techniques || []).length;
    return `<span class="wf-ask">Supprimer « ${_esc(f?.label) || 'Sans nom'} » ?<small>${[c ? `${c} arme${c > 1 ? 's' : ''} perdront leur type` : '', n ? `${n} technique${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'Aucune arme concernée.'}</small></span><span class="wf-sp"></span><button type="button" class="wf-btn tx" data-wf-keep>Annuler</button><button type="button" class="wf-btn dg" data-wf-delok>Supprimer</button>`;
  }
  const info = bad.length ? `<span class="wf-info ko">${bad.length} type${bad.length > 1 ? 's' : ''} à corriger</span>`
    : dirty ? `<span class="wf-info"><span class="wf-dot2"></span>Modifications non enregistrées</span>`
      : '<span class="wf-info">À jour</span>';
  return `<button type="button" class="wf-btn gh sm" data-wf-dmgtypes>⚡ Types de dégâts…</button>${info}<span class="wf-sp"></span>
    <button type="button" class="wf-btn tx" data-wf-revert ${dirty ? '' : 'disabled'}>${_wfIc('undo')}Annuler les modifications</button>
    <button type="button" class="wf-btn pri" data-wf-save ${dirty && !bad.length ? '' : 'disabled'}>Enregistrer</button>`;
}

function _wfRenderList() { const el = document.getElementById('wf-list'); if (el) el.innerHTML = _wfListHtml(); }
function _wfRenderMain() { const el = document.getElementById('wf-main'); if (el) el.innerHTML = _wfMainHtml(); }
function _wfRenderSim() { const el = document.getElementById('wf-sim'); if (el) el.innerHTML = _wfSimHtml(); }
function _wfRenderFoot() { const el = document.getElementById('wf-foot'); if (el) el.innerHTML = _wfFootHtml(); }
function _wfRender() { _wfRenderList(); _wfRenderMain(); _wfRenderSim(); _wfRenderFoot(); _wfSyncGuard(); }

function _wfSyncGuard() {
  setModalCloseGuard(() => {
    if (_wfAsk) return true;
    if (_wfDirty()) { _wfAsk = 'close'; _wfRenderFoot(); return true; }
    return false;
  });
}

function _renderWeaponFormatsModal() {
  openModal('', `${_WF_SPRITE}<div class="wf">
    <header class="wf-mh"><div><h2>Types d’arme & techniques</h2><small>Un type par famille d’arme. Il pré-remplit la boutique et porte les techniques proposées avant le jet.</small></div><span class="wf-sp"></span><button type="button" class="wf-x" data-wf-close aria-label="Fermer">${_wfIc('x')}</button></header>
    <div class="wf-body"><nav class="wf-list" id="wf-list"></nav><div class="wf-main" id="wf-main"></div><aside class="wf-sim" id="wf-sim"></aside></div>
    <footer class="wf-mf" id="wf-foot"></footer>
  </div>`);
  _wfRenderList(); _wfRenderMain(); _wfRenderSim(); _wfRenderFoot();
  _wfSyncGuard();
}

// ══════════════════════════════════════════════
// Contrôleur (écouteurs délégués, montés une fois)
// ══════════════════════════════════════════════
function _wfSelectTech(f, id) { _wfOpenTech = (_wfOpenTech === id) ? null : id; }

async function _wfSave() {
  if (_wfAllErr().length || !_wfDirty()) return;
  const draft = _wfDraft.map(f => normalizeWeaponFormat({ ...f }));
  await saveWeaponFormats(draft);
  _weaponFormats = _wfCloneList(draft);
  _wfDraft = _wfCloneList(draft);
  _wfSaved = _wfCloneList(draft);
  if (!_wfCur()) _wfSelId = _wfDraft[0]?.id || null;
  showNotif('Types d’arme enregistrés.', 'success');
  _wfRender();
}

function _wfMount() {
  if (_wfMounted) return; _wfMounted = true;
  document.addEventListener('click', ev => {
    if (!document.querySelector('.wf')) return;
    const t = ev.target.closest('[data-wf-sel],[data-wf-add],[data-wf-nat],[data-wf-mv],[data-wf-dup],[data-wf-del],[data-wf-delok],[data-wf-stat],[data-wf-mains],[data-wf-ca],[data-wf-tech],[data-wf-addtech],[data-wf-addmenu],[data-wf-trig],[data-wf-fxmenu],[data-wf-fxadd],[data-wf-fxrm],[data-wf-fxset],[data-wf-fxtog],[data-wf-step],[data-wf-duptech],[data-wf-deltech],[data-wf-sim],[data-wf-simadv],[data-wf-curve],[data-wf-pick],[data-wf-mig],[data-wf-movetechs],[data-wf-revert],[data-wf-save],[data-wf-dmgtypes],[data-wf-close],[data-wf-keep],[data-wf-discard]');
    if (!t) { if (_wfFxMenu || _wfAddMenu) { _wfFxMenu = false; _wfAddMenu = false; _wfRenderMain(); } return; }
    const d = t.dataset, f = _wfCur();
    const _ot = () => (f?.techniques || []).find(x => x.id === _wfOpenTech);
    // Simulation (colonne droite) : ne touche pas au brouillon, re-rend seulement la colonne.
    if (d.wfSim) { const v = (parseInt(_wfSim[d.wfSim], 10) || 0) + (+d.dir); _wfSim[d.wfSim] = Math.max(+d.min, Math.min(+d.max, v)); return _wfRenderSim(); }
    if ('wfSimadv' in d) { _wfSim.adv = !_wfSim.adv; return _wfRenderSim(); }
    if (d.wfCurve) { _wfSim.ca = parseInt(d.wfCurve, 10) || _wfSim.ca; return _wfRenderSim(); }
    if (d.wfPick) { if (d.wfPick === 'normal') { _wfSimNormal = true; } else { _wfSimNormal = false; _wfOpenTech = d.wfPick; } _wfRenderMain(); return _wfRenderSim(); }
    // Menus (ajouter modificateur / technique) : bascule ; tout autre clic les ferme.
    if ('wfFxmenu' in d) { _wfFxMenu = !_wfFxMenu; _wfAddMenu = false; return _wfRenderMain(); }
    if ('wfAddmenu' in d) { _wfAddMenu = !_wfAddMenu; _wfFxMenu = false; return _wfRenderMain(); }
    _wfFxMenu = false; _wfAddMenu = false;
    if (d.wfTrig) { const o = _ot(); if (o) o.trigger = d.wfTrig; _wfRenderMain(); return _wfRenderSim(); }
    if (d.wfFxadd) { const o = _ot(), m = _WF_MODS.find(x => x.k === d.wfFxadd); if (o && m && !m.on(o)) m.add(o); return _wfRender(); }
    if (d.wfFxrm) { const o = _ot(), m = _WF_MODS.find(x => x.k === d.wfFxrm); if (o && m) m.clear(o); return _wfRender(); }
    if (d.wfFxset) { const [field, val] = d.wfFxset.split(':'); const o = _ot(); if (o) o[field] = val; return _wfRender(); }
    if (d.wfFxtog) { const field = d.wfFxtog, o = _ot(); if (o) { const cur = field === 'allowWithAbilities' ? o.allowWithAbilities !== false : !!o[field]; o[field] = !cur; } return _wfRender(); }
    if (d.wfStep) { const field = d.wfStep, o = _ot(); if (o) { const step = +d.step || 1, min = +d.min, max = +d.max; let v = (parseInt(o[field], 10) || 0) + (+d.dir) * step; if (d.zero === '1' && v === 0) v += (+d.dir) * step; o[field] = Math.max(min, Math.min(max, v)); } return _wfRender(); }
    if ('wfDuptech' in d) { const o = _ot(); if (f && o) { const copy = { ...JSON.parse(JSON.stringify(o)), id: `tech_${Date.now()}`, label: `${o.label} (copie)` }; f.techniques.splice(f.techniques.indexOf(o) + 1, 0, copy); _wfOpenTech = copy.id; } return _wfRender(); }
    if ('wfDeltech' in d) { const o = _ot(); if (f && o) { f.techniques.splice(f.techniques.indexOf(o), 1); _wfOpenTech = null; showNotif('Technique supprimée. « Annuler les modifications » pour revenir.', 'info'); } return _wfRender(); }
    if (d.wfSel != null) { _wfSelId = d.wfSel; _wfOpenTech = _wfCur()?.techniques?.[0]?.id || null; _wfSimNormal = false; return _wfRender(); }
    if ('wfAdd' in d) { const id = `fmt_${Date.now()}`; _wfDraft.push(normalizeWeaponFormat({ id, label: '', isMagic: false, damageType: 'physique', techniques: [] })); _wfSelId = id; _wfOpenTech = null; _wfRender(); document.getElementById('wf-name')?.focus(); return; }
    if (d.wfNat != null) { if (f && !_wfIsLegacy(f)) { f.isMagic = d.wfNat === '1'; f.damageType = f.isMagic ? '' : 'physique'; } return _wfRender(); }
    if (d.wfMv) { const i = _wfDraft.indexOf(f), j = i + (+d.wfMv); if (_wfDraft[j]) { [_wfDraft[i], _wfDraft[j]] = [_wfDraft[j], _wfDraft[i]]; _wfRender(); } return; }
    if ('wfDup' in d) { if (!f) return; const id = `fmt_${Date.now()}`; const copy = normalizeWeaponFormat({ ..._wfCloneList([f])[0], id, label: `${f.label} (copie)` }); copy.techniques = (copy.techniques || []).map((tq, k) => ({ ...tq, id: `tech_${Date.now()}_${k}` })); _wfDraft.splice(_wfDraft.indexOf(f) + 1, 0, copy); _wfSelId = id; return _wfRender(); }
    if ('wfDel' in d) { _wfAsk = 'del'; return _wfRenderFoot(); }
    if ('wfDelok' in d) { const i = _wfDraft.indexOf(f); _wfDraft.splice(i, 1); _wfSelId = (_wfDraft[i] || _wfDraft[i - 1])?.id || null; _wfOpenTech = _wfCur()?.techniques?.[0]?.id || null; _wfAsk = null; return _wfRender(); }
    if (d.wfStat) { if (f) { const arr = f.defaults.degatsStats || (f.defaults.degatsStats = []); const k = d.wfStat, ix = arr.indexOf(k); if (ix >= 0) arr.splice(ix, 1); else if (arr.length < 2) arr.push(k); } return _wfRender(); }
    if (d.wfMains != null) { if (f) f.defaults.mains = d.wfMains; return _wfRender(); }
    if (d.wfCa) { if (f) { const v = Math.max(-10, Math.min(10, (f.defaults.caBonus || 0) + (+d.wfCa))); f.defaults.caBonus = v; } return _wfRender(); }
    if (d.wfTech) { _wfSelectTech(f, d.wfTech); _wfSimNormal = false; _wfRenderMain(); return _wfRenderSim(); }
    if (d.wfAddtech) { if (f) { const src = _WF_TECHNIQUE_PRESETS[d.wfAddtech] || _WF_TECHNIQUE_PRESETS.blank; const nt = normalizeWeaponTechnique({ ...src, id: `tech_${Date.now()}` }, (f.techniques || []).length); (f.techniques || (f.techniques = [])).push(nt); _wfOpenTech = nt.id; } return _wfRender(); }
    if (d.wfMig === 'import') return _wfMigImport();
    if (d.wfMig === 'convert') return _wfMigConvert();
    if ('wfMovetechs' in d) { if (f) { const tgtId = document.getElementById('wf-movetgt')?.value; const tgt = _wfDraft.find(o => o.id === tgtId); if (tgt) { tgt.techniques = [...(tgt.techniques || []), ...(f.techniques || [])]; f.techniques = []; showNotif('Techniques déplacées.', 'success'); } } return _wfRender(); }
    if ('wfRevert' in d) { _wfDraft = _wfCloneList(_wfSaved); if (!_wfCur()) _wfSelId = _wfDraft[0]?.id || null; _wfAsk = null; return _wfRender(); }
    if ('wfSave' in d) return _wfSave();
    if ('wfDmgtypes' in d) { if (_wfDirty()) { _wfAsk = 'close'; return _wfRenderFoot(); } clearModalGuardAndOpenDamageTypes(); return; }
    if ('wfClose' in d) { if (_wfDirty()) { _wfAsk = 'close'; _wfRenderFoot(); } else { setModalCloseGuard(null); closeModalDirect(); } return; }
    if ('wfKeep' in d) { _wfAsk = null; return _wfRenderFoot(); }
    if ('wfDiscard' in d) { _wfAsk = null; _wfDraft = _wfCloneList(_wfSaved); _wfSelId = _wfDraft[0]?.id || null; setModalCloseGuard(null); closeModalDirect(); return; }
  });
  document.addEventListener('input', ev => {
    if (!document.querySelector('.wf')) return;
    const f = _wfCur(); if (!f) return;
    const el = ev.target;
    if (el.hasAttribute('data-wf-name')) { f.label = el.value; _wfRenderList(); _wfRenderFoot(); const e = _wfTypeErrs(f); el.classList.toggle('bad', e.includes('name') || e.includes('dupname')); }
    else if (el.hasAttribute('data-wf-degats')) { f.defaults.degats = el.value.replace(/\s+/g, ''); _wfRenderList(); _wfRenderFoot(); el.classList.toggle('bad', _wfTypeErrs(f).includes('degats')); _wfUpdatePline(f); _wfRenderSim(); }
    else if (el.hasAttribute('data-wf-portee')) { f.defaults.portee = el.value; _wfRenderFoot(); _wfUpdatePline(f); }
    else if (el.hasAttribute('data-wf-fxt')) {
      const field = el.getAttribute('data-wf-fxt'); const o = (f.techniques || []).find(x => x.id === _wfOpenTech);
      if (o) { o[field] = el.value; if (field === 'label') el.classList.toggle('bad', !String(el.value).trim()); _wfRenderList(); _wfRenderFoot(); _wfRefreshOpenTechHead(o); _wfRenderSim(); }
    }
  });
  document.addEventListener('change', ev => {
    if (!document.querySelector('.wf')) return;
    const f = _wfCur(); if (!f) return;
    if (ev.target.hasAttribute('data-wf-toucher')) { f.defaults.toucherStat = ev.target.value; _wfRender(); }
    else if (ev.target.hasAttribute('data-wf-fx')) { const field = ev.target.getAttribute('data-wf-fx'); const o = (f.techniques || []).find(x => x.id === _wfOpenTech); if (o) { o[field] = ev.target.value; _wfRenderMain(); _wfRenderList(); _wfRenderFoot(); _wfRenderSim(); } }
  });
  document.addEventListener('keydown', ev => {
    if (!document.querySelector('.wf')) return;
    if (ev.key === 'Escape') {
      if (_wfAsk) { ev.stopPropagation(); ev.preventDefault(); _wfAsk = null; _wfRenderFoot(); return; }
    }
  }, true);
}

function _wfUpdatePline(f) {
  const el = document.querySelector('.wf .wf-pline b');
  if (el) el.textContent = weaponDefaultsSummary(f.defaults, statShort) || 'aucun pré-remplissage';
}

function clearModalGuardAndOpenDamageTypes() { setModalCloseGuard(null); openDamageTypesAdmin(); }

// Rafraîchit l'en-tête de la technique ouverte sans recréer son éditeur (focus
// préservé pendant la frappe) : nom, résumé généré, tag d'équilibrage.
function _wfRefreshOpenTechHead(t) {
  const card = document.querySelector('.wf .wf-tq.open');
  if (!card) return;
  const nm = card.querySelector('.wf-tq-h b'); if (nm) nm.textContent = t.label || 'Sans nom';
  const sum = card.querySelector('.wf-tq-sum'); if (sum) sum.textContent = _wfTechSummary(t);
  const tag = _wfTechTag(t), slot = card.querySelector('.wf-tq-h > .wf-tag, .wf-tq-h > span:nth-child(3)');
  if (slot) { if (tag) { slot.className = `wf-tag ${tag.cls}`; slot.textContent = tag.txt; } else { slot.className = ''; slot.textContent = ''; } }
  card.classList.toggle('bad', tag?.cls === 'ko');
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
  // Techniques de frappe par famille d'arme : un choix déclaré avant le jet, avec un coût.
  dagger_sneak: {
    icon: '🗡️', label: 'Coup sournois',
    description: 'Exploite une ouverture : avec l’avantage, +2 dés d’arme. Si tu rates quand même, tu es à découvert.',
    allowWithAbilities: false, requiresAdvantage: true, extraWeaponDice: 2, missSelfConditionId: 'exposed',
  },
  axe_momentum: {
    icon: '🪓', label: 'Élan total',
    description: 'Frappe à fond : critique sur 18–20, mais −2 au toucher et −2 CA si tu rates.',
    allowWithAbilities: false, attackModifier: -2, critRangeBonus: 2, missSelfCaMalus: 2,
  },
  hammer_crush: {
    icon: '🔨', label: 'Broyeur',
    description: 'Écrase l’armure : ignore 20 % de la CA de la cible, au prix de 3 dégâts. Rentable contre les cibles blindées.',
    allowWithAbilities: false, armorIgnorePct: 20, damageMalusFlat: 3,
  },
  sword_control: {
    icon: '⚔️', label: 'Frappe maîtrisée',
    description: 'Coup sûr : +2 au toucher, −2 dégâts.',
    allowWithAbilities: false, attackModifier: 2, damageMalusFlat: 2,
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

        <details class="tech-builder-section" ${t.requiresAdvantage || t.critRangeBonus || t.armorIgnorePct || t.damageMalusFlat || t.missSelfCaMalus || t.missSelfConditionId ? 'open' : ''}>
          <summary><span>5</span><div><b>Frappe et contrecoup</b><small>Critique, armure, coût en dégâts, risque en cas de raté.</small></div></summary>
          <div class="tech-builder-grid">
            <label><span>Critique élargi (crans)</span><input type="number" min="0" max="5" value="${t.critRangeBonus || 0}" title="2 = critique sur 18–20" ${bind('critRangeBonus')}></label>
            <label><span>CA ignorée (%)</span><input type="number" min="0" max="100" value="${t.armorIgnorePct || 0}" ${bind('armorIgnorePct')}></label>
            <label><span>Malus de dégâts</span><input type="number" min="0" max="99" value="${t.damageMalusFlat || 0}" ${bind('damageMalusFlat')}></label>
            <label><span>Raté : malus de CA</span><input type="number" min="0" max="10" value="${t.missSelfCaMalus || 0}" ${bind('missSelfCaMalus')}></label>
            <label><span>Raté : état sur soi</span><select ${bind('missSelfConditionId', 'change')}>${_techniqueOptions(conditionOptions, t.missSelfConditionId || '', 'Aucun')}</select></label>
          </div>
          <label class="wf-tech-check tech-builder-check"><input type="checkbox" ${t.requiresAdvantage ? 'checked' : ''} ${bind('requiresAdvantage', 'change')}><span><b>Avec l’avantage seulement</b><small>Sans avantage au moment du jet, la technique ne s’active pas et l’attaque reste normale.</small></span></label>
          <small class="tech-builder-note">Le contrecoup s’applique au lanceur si l’attaque rate toutes ses cibles, jusqu’à la fin du round, en combat uniquement.</small>
        </details>

        <details class="tech-builder-section">
          <summary><span>6</span><div><b>Coût et limites</b><small>Ressource, usages et recharge.</small></div></summary>
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

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// TYPES DE DÉGÂTS — Admin (modale maître/détail, brouillon unique)
// ══════════════════════════════════════════════

const MISS_EFFECT_LABELS = { none: 'Aucun', half: 'Moitié', full: 'Complets' };
// Palette élargie (12) + pastille arc-en-ciel libre à côté.
const DT_SWATCHES = ['#9ca3af', '#a8a29e', '#cbd5e1', '#7c8ba1', '#f97316', '#f9d71c', '#facc15', '#ef4444', '#84cc16', '#22c55e', '#38bdf8', '#4f8cff', '#6366f1', '#a78bfa', '#b47fff', '#ec4899', '#14b8a6', '#64748b'];
const DT_EMOJIS = ['🔥','💧','🌊','🌬️','🪨','⛰️','🌱','⚡','❄️','☀️','🌙','🌑','✨','🌟','💥','💢','🔮','🌀','☠️','🧪','🩸','☣️','⚗️','🦠','🧨','🌋','🧊','♨️','🫧','🌩️','🗡️','🏹','🛡️','⚔️','👊','🦷','🐍','👁️','🪄','📖','⭐','💫'];
// Presets (dt-data) : chacun a au moins une contrepartie.
const _DT_TECHNIQUE_PRESETS = {
  blank: { icon: '💥', label: 'Nouvelle technique' },
  burst: { icon: '💥', label: 'Explosion élémentaire', description: 'Sur une touche, l’élément explose autour de la cible.', extraDamageFormula: '1d4', addWeaponModifier: true, blastRadius: 1, areaShape: 'circle', resourceType: 'pm', resourceCost: 2 },
  dot: { icon: '🔥', label: 'Brûlure persistante', description: 'La cible continue de souffrir après l’impact.', conditionId: 'burning', conditionDuration: 2, conditionSaveStat: 'constitution', damageMalusFlat: 2 },
  surge: { icon: '⚡', label: 'Surcharge', description: 'Libère tout l’élément d’un coup, au risque de se découvrir.', extraWeaponDice: 1, missSelfCaMalus: 2 },
  chill: { icon: '🧊', label: 'Gel mordant', description: 'Ralentit la cible, mais le coup est moins appuyé.', conditionId: 'slowed', conditionDuration: 1, damageMalusFlat: 1, cooldownRounds: 2 },
};
function _dtTechniqueCard(t, i) { return _techniqueConfigCard(t, i, 'damage'); }

// — État : un seul brouillon pour tout (règles + apparence + techniques). —
let _dtSaved = [], _dtDraft = [], _dtSelId = null, _dtOpenTech = null, _dtAsk = null, _dtFxMenu = false;
let _dtReplaceId = 'physique', _dtEmoji = false, _dtMounted = false;
const _DT_DEGATS_RE = /^\d*d\d+(?:[+-]\d+)?$/i;

const _dtClone = list => (list || []).map(t => normalizeDamageType({ ...t }));
const _dtCur = () => _dtDraft.find(t => t.id === _dtSelId) || _dtDraft[0] || null;
const _dtKey = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Icônes (sprite partagé avec .wf) : réutilise #wf-* ──
const _dtIc = id => `<svg class="wf-ic"><use href="#wf-${id}"></use></svg>`;

const _dtRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function _dtProximity(t) {
  const a = _dtRgb(t.color); if (!a) return [];
  return _dtDraft.filter(o => o !== t && o.color).map(o => { const b = _dtRgb(o.color); return b ? [o, Math.hypot(a[0] - b[0], a[1] - b[1])] : null; })
    .filter(x => x && x[1] < 32).map(x => x[0].label || 'Sans nom');
}
function _dtRuleSummary(t) {
  const r = t.rules || {}, parts = [];
  if ((r.missEffect || 'none') !== 'none') {
    const scope = r.missScope || 'always';
    parts.push(`${r.missEffect === 'half' ? '½' : 'tous'} sur raté${scope === 'magic' ? ' (magie)' : scope === 'physical' ? ' (phys.)' : ''}`);
  }
  if (r.armorPen) parts.push(`${r.armorPen}% armure`);
  if (r.dmgBonus) parts.push(`${r.dmgBonus > 0 ? '+' : ''}${r.dmgBonus} dégâts`);
  return parts.join(' · ');
}
function _dtRowSub(t) {
  const rule = _dtRuleSummary(t), n = (t.techniques || []).length;
  return [rule, n ? `${n} tech.` : ''].filter(Boolean).join(' · ') || 'Aucune règle';
}
function _dtTypeErrs(t) {
  const e = [];
  if (!String(t.label || '').trim()) e.push('name');
  else if (_dtDraft.some(o => o !== t && _dtKey(o.label) === _dtKey(t.label))) e.push('dupname');
  if ((t.techniques || []).some(x => !String(x.label || '').trim() || [x.extraDamageFormula, x.scalingFormula].some(f => f && !_DT_DEGATS_RE.test(String(f).replace(/\s+/g, ''))))) e.push('tech');
  return e;
}
const _dtAllErr = () => _dtDraft.filter(t => _dtTypeErrs(t).length);
const _dtDirty = () => JSON.stringify(_dtDraft) !== JSON.stringify(_dtSaved);
// Comptage d'usage : armes (boutique) + sorts (matrices) par id de type.
function _dtUsage(id) { const u = _dtUsageMap[id] || { w: 0, s: 0 }; return u; }
let _dtUsageMap = {};

export async function openDamageTypesAdmin() {
  [_damageTypes, _techniqueConditions] = await Promise.all([loadDamageTypes(), loadConditionLibrary()]);
  _dtSaved = _dtClone(_damageTypes);
  _dtDraft = _dtClone(_damageTypes);
  _dtSelId = _dtDraft[0]?.id || null;
  _dtOpenTech = _dtCur()?.techniques?.[0]?.id || null;
  _dtAsk = null; _dtEmoji = false; _dtReplaceId = 'physique';
  _dtUsageMap = {};
  _renderDamageTypesModal();
  _dtMount();
  // Index d'usage en arrière-plan (ne bloque pas l'ouverture).
  _dtBuildUsage();
}

async function _dtBuildUsage() {
  const map = {};
  try {
    const { getCachedCollection, loadCollection } = await import('../../data/firestore.js');
    const shop = getCachedCollection('shop') || await loadCollection('shop').catch(() => []);
    (shop || []).forEach(it => { const id = it?.damageTypeId; if (id) (map[id] || (map[id] = { w: 0, s: 0 })).w++; });
  } catch { /* boutique indisponible */ }
  try {
    const mats = await loadSpellMatrices().catch(() => null);
    const bump = id => { if (id) (map[id] || (map[id] = { w: 0, s: 0 })).s++; };
    const scan = obj => { if (!obj || typeof obj !== 'object') return; if (obj.noyauTypeId) bump(obj.noyauTypeId); if (obj.elementId) bump(obj.elementId); Object.values(obj).forEach(v => { if (v && typeof v === 'object') scan(v); }); };
    scan(mats);
  } catch { /* matrices indisponibles */ }
  _dtUsageMap = map;
  if (document.querySelector('.dt')) { _dtRenderList(); _dtRenderMain(); }
}

// ══════════════════════════════════════════════
// Rendu
// ══════════════════════════════════════════════
function _dtListHtml() {
  const groups = [['Physiques', _dtDraft.filter(t => !t.isMagic)], ['Magiques', _dtDraft.filter(t => t.isMagic)]];
  let h = '';
  groups.forEach(([label, list]) => {
    if (!list.length) return;
    h += `<span class="wf-lbl">${label}</span>`;
    h += list.map(t => {
      const err = _dtTypeErrs(t).length, dirty = JSON.stringify(t) !== JSON.stringify(_dtSaved.find(o => o.id === t.id));
      const u = _dtUsage(t.id), total = u.w + u.s;
      const mark = err ? '<span class="wf-err" title="À corriger"></span>'
        : dirty ? '<span class="wf-dirty" title="Modifié"></span>'
          : (total ? `<span class="wf-cnt" title="${u.w} arme${u.w > 1 ? 's' : ''} et ${u.s} sort${u.s > 1 ? 's' : ''}">${total}</span>` : '');
      return `<button type="button" class="wf-row dt-row${t.id === _dtSelId ? ' on' : ''}" style="--c:${_esc(t.color || '#9ca3af')}" data-dt-sel="${_esc(t.id)}">
        <span class="dt-pastille">${t.icon ? _esc(t.icon) : '·'}</span>
        <span style="min-width:0"><span class="wf-nm">${_esc(t.label) || '<i style=\"color:var(--crimson)\">Sans nom</i>'}</span><span class="wf-sub">${_esc(_dtRowSub(t))}</span></span>
        ${mark}</button>`;
    }).join('');
  });
  h += `<button type="button" class="wf-add" data-dt-add>${_dtIc('plus')}Nouveau type</button>`;
  return h;
}

function _dtApparenceHtml(t) {
  const color = t.color || '#9ca3af';
  const isPreset = DT_SWATCHES.some(c => c.toLowerCase() === color.toLowerCase());
  const prox = _dtProximity(t);
  const sw = DT_SWATCHES.map(c => `<button type="button" class="dt-color${c.toLowerCase() === color.toLowerCase() ? ' on' : ''}" style="--c:${c}" data-dt-color="${c}" aria-label="${c}"></button>`).join('');
  return `<div class="wf-sec"><span class="wf-lbl">Apparence</span>
    <div class="dt-colors">${sw}<label class="dt-rainbow${isPreset ? '' : ' on'}" title="Couleur libre"><input type="color" value="${_esc(color)}" data-dt-colorpick><span style="--c:${_esc(color)}"></span></label></div>
    <div class="dt-preview"><span class="dt-chip" style="--c:${_esc(color)}">${t.icon ? _esc(t.icon) + ' ' : ''}${_esc(t.label) || 'Type'}</span><span class="dt-journal"><b style="color:${_esc(color)}">7</b> dégâts · ${_esc((t.label || 'type').toLowerCase())}</span></div>
    ${prox.length ? `<p class="dt-prox">Couleur très proche de ${_esc(prox.join(', '))} : difficile à distinguer en jeu.</p>` : ''}
  </div>`;
}

function _dtRulesHtml(t) {
  const r = t.rules || {};
  const me = r.missEffect || 'none', scope = r.missScope || 'always';
  const rl = (lbl, help, ctl, indent) => `<div class="dt-rl${indent ? ' dt-rl--sub' : ''}"><div class="dt-rl-t"><b>${lbl}</b><small>${help}</small></div><div class="dt-rl-c">${ctl}</div></div>`;
  let h = `<div class="wf-sec"><span class="wf-lbl">Règles de combat</span><div class="dt-rules">`;
  h += rl('Dégâts sur un raté', 'L’échec critique n’inflige jamais de dégâts', _dtSeg('rules.missEffect', me, [['none', 'Aucun'], ['half', 'Moitié'], ['full', 'Complets']]));
  if (me !== 'none') h += rl('↳ Pour les attaques', 'Si ton système distingue magie et physique', _dtSeg('rules.missScope', scope, [['always', 'Toutes'], ['magic', 'Magiques'], ['physical', 'Physiques']]), true);
  h += rl('Pénétration d’armure', 'Part de la CA de la cible ignorée au toucher', _dtStp('rules.armorPen', r.armorPen || 0, { min: 0, max: 100, step: 5, suf: '%' }));
  h += rl('Bonus de dégâts', 'Ajouté à chaque jet, critique compris', _dtStp('rules.dmgBonus', r.dmgBonus || 0, { min: -10, max: 10, pre: (r.dmgBonus || 0) > 0 ? '+' : '' }));
  h += rl('Émet de la lumière', 'Une source lumineuse de cet élément', `<button type="button" class="wf-sw${damageTypeEmitsLight(t) ? ' on' : ''}" data-dt-light role="switch" aria-checked="${damageTypeEmitsLight(t)}"></button>`);
  h += `</div>`;
  const sum = _dtRuleSummary(t);
  h += `<p class="wf-pline">En jeu : <b>${_esc(sum || 'aucune règle')}</b>${sum ? '' : ' · se comporte comme un type neutre, à la D&D'}.</p>`;
  if (me === 'full') h += `<p class="dt-prox" style="color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,transparent)">Tous les dégâts passent sur un raté : la CA ne protège plus que de l’échec critique.</p>`;
  h += `</div>`;
  return h;
}

function _dtTechniquesHtml(t) {
  const techs = t.techniques || [];
  let h = `<div class="wf-sec"><span class="wf-lbl">Techniques</span><p class="wf-hint">Cumulables avec la technique de l’arme · une fois par cible et par activation.</p><div class="wf-tqs">`;
  h += techs.length ? techs.map(x => {
    const open = x.id === _dtOpenTech, tag = _wfTechTag(x);
    return `<div class="wf-tq${open ? ' open' : ''}${tag?.cls === 'ko' ? ' bad' : ''}">
      <button type="button" class="wf-tq-h" data-dt-tech="${_esc(x.id)}">
        <span class="wf-tq-ic">${_esc(x.icon || '💥')}</span>
        <span style="min-width:0"><b>${_esc(x.label) || '<i style=\"color:var(--crimson)\">Sans nom</i>'}</b><span class="wf-tq-sum">${_esc(_wfTechSummary(x))}</span></span>
        ${tag ? `<span class="wf-tag ${tag.cls}">${tag.txt}</span>` : '<span></span>'}
        ${_dtIc('chev')}
      </button>
      ${open ? _TE.editorHtml(x, { menuOpen: _dtFxMenu }) : ''}
    </div>`;
  }).join('') : '<div class="wf-empty-fx">Aucune technique : ce type garde son comportement normal.</div>';
  h += `</div><div class="wf-presets"><span class="wf-lbl">Ajouter</span>${[['blank', '＋ Libre'], ['burst', '💥 Explosion'], ['dot', '🔥 Brûlure'], ['surge', '⚡ Surcharge'], ['chill', '🧊 Gel']].map(([k, l]) => `<button type="button" class="wf-chip" data-dt-addtech="${k}">${l}</button>`).join('')}</div></div>`;
  return h;
}

function _dtMainHtml() {
  const t = _dtCur();
  if (!t) return `<div class="wf-empty"><p>Aucun type de dégâts.</p><button type="button" class="wf-btn gh" data-dt-add>Nouveau type</button></div>`;
  const e = _dtTypeErrs(t), i = _dtDraft.indexOf(t), u = _dtUsage(t.id);
  const isPhys = t.id === 'physique';
  const color = t.color || '#9ca3af';
  const st = e.includes('name') ? ['ko', 'Nom vide.']
    : e.includes('dupname') ? ['ko', 'Nom déjà pris.']
      : ['', `${(u.w + u.s) ? `Utilisé par ${u.w} arme${u.w > 1 ? 's' : ''} et ${u.s} sort${u.s > 1 ? 's' : ''}` : 'Pas encore utilisé'}${isPhys ? ' · type de repli quand rien n’est précisé' : ''}`];
  let h = `<div class="wf-eh" style="--c:${_esc(color)}">
    <div class="dt-emoji-wrap"><button type="button" class="dt-emoji-btn" data-dt-emoji aria-label="Icône">${t.icon ? _esc(t.icon) : '<span class="dt-emoji-ph">+</span>'}</button>${_dtEmoji ? _dtEmojiPopHtml(t) : ''}</div>
    <div class="wf-t"><input class="wf-name${e.includes('name') || e.includes('dupname') ? ' bad' : ''}" id="dt-name" value="${_esc(t.label)}" placeholder="Ex. Feu, Acide, Psychique" data-dt-name><small class="${st[0]}">${_esc(st[1])}</small></div>
    <div class="wf-acts">
      <div class="wf-seg nat-s"><button type="button" class="${t.isMagic ? '' : 'on'}" data-nat="0" data-dt-nat="0">Physique</button><button type="button" class="${t.isMagic ? 'on' : ''}" data-nat="1" data-dt-nat="1">Magique</button></div>
      <button type="button" class="wf-ib" data-dt-mv="-1" title="Monter" ${i <= 0 ? 'disabled' : ''}>${_dtIc('up')}</button>
      <button type="button" class="wf-ib" data-dt-mv="1" title="Descendre" ${i >= _dtDraft.length - 1 ? 'disabled' : ''}>${_dtIc('down')}</button>
      <button type="button" class="wf-ib" data-dt-dup title="Dupliquer">${_dtIc('dup')}</button>
      <button type="button" class="wf-ib del" data-dt-del title="Supprimer" ${isPhys ? 'disabled title="Le type de repli ne peut pas être supprimé"' : ''}>${_dtIc('trash')}</button>
    </div>
  </div>`;
  if (t.isMagic) h += `<p class="wf-hint">Réservé aux personnages qui le connaissent · dégâts via maîtrise + carac magique.</p>`;
  h += _dtApparenceHtml(t);
  h += _dtRulesHtml(t);
  h += _dtTechniquesHtml(t);
  return h;
}

function _dtEmojiPopHtml(t) {
  return `<div class="dt-emoji-pop"><div class="dt-emoji-grid">${DT_EMOJIS.map(e => `<button type="button" class="${t.icon === e ? 'on' : ''}" data-dt-pick="${e}">${e}</button>`).join('')}</div>
    <div class="dt-emoji-foot"><input class="wf-fi sans" id="dt-emoji-in" placeholder="Colle ton emoji…" maxlength="8"><button type="button" class="wf-btn tx" data-dt-pick="">Aucun</button></div></div>`;
}

function _dtFootHtml() {
  const bad = _dtAllErr(), dirty = _dtDirty();
  if (_dtAsk === 'close') return `<span class="wf-ask">Abandonner les modifications ?</span><span class="wf-sp"></span><button type="button" class="wf-btn tx" data-dt-keep>Continuer l’édition</button><button type="button" class="wf-btn gh" data-dt-discard>Abandonner</button>`;
  if (_dtAsk === 'del') {
    const t = _dtCur(), u = _dtUsage(t.id), used = u.w + u.s, n = (t?.techniques || []).length;
    const others = _dtDraft.filter(o => o !== t);
    const replSel = used ? `<select class="wf-sel sans" id="dt-replace">${others.map(o => `<option value="${_esc(o.id)}"${o.id === _dtReplaceId ? ' selected' : ''}>${_esc(o.label)}</option>`).join('')}</select>` : '';
    return `<span class="wf-ask">Supprimer « ${_esc(t?.label) || 'Sans nom'} » ?<small>${[used ? `${u.w} arme${u.w > 1 ? 's' : ''} et ${u.s} sort${u.s > 1 ? 's' : ''} basculeront vers le type choisi` : 'Aucun usage', n ? `${n} technique${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</small></span>${replSel}<span class="wf-sp"></span><button type="button" class="wf-btn tx" data-dt-keep>Annuler</button><button type="button" class="wf-btn dg" data-dt-delok>Supprimer</button>`;
  }
  const info = bad.length ? `<span class="wf-info ko">${bad.length} type${bad.length > 1 ? 's' : ''} à corriger</span>`
    : dirty ? `<span class="wf-info"><span class="wf-dot2"></span>Modifications non enregistrées</span>`
      : '<span class="wf-info">À jour</span>';
  return `<button type="button" class="wf-btn gh sm" data-dt-weapons>⚔️ Types d’arme…</button>${info}<span class="wf-sp"></span>
    <button type="button" class="wf-btn tx" data-dt-revert ${dirty ? '' : 'disabled'}>${_dtIc('undo')}Annuler les modifications</button>
    <button type="button" class="wf-btn pri" data-dt-save ${dirty && !bad.length ? '' : 'disabled'}>Enregistrer</button>`;
}

function _dtRenderList() { const el = document.getElementById('dt-list'); if (el) el.innerHTML = _dtListHtml(); }
function _dtRenderMain() { const el = document.getElementById('dt-main'); if (el) el.innerHTML = _dtMainHtml(); }
function _dtRenderFoot() { const el = document.getElementById('dt-foot'); if (el) el.innerHTML = _dtFootHtml(); }
function _dtRender() { _dtRenderList(); _dtRenderMain(); _dtRenderFoot(); _dtSyncGuard(); }
function _dtSyncGuard() { setModalCloseGuard(() => { if (_dtAsk) return true; if (_dtDirty()) { _dtAsk = 'close'; _dtRenderFoot(); return true; } return false; }); }

function _renderDamageTypesModal() {
  openModal('', `${_WF_SPRITE}<div class="dt">
    <header class="wf-mh"><div><h2>Types de dégâts</h2><small>Chaque type porte sa couleur, ses règles de combat et des techniques optionnelles, appliquées dans le VTT.</small></div><span class="wf-sp"></span><button type="button" class="wf-x" data-dt-close aria-label="Fermer">${_dtIc('x')}</button></header>
    <div class="wf-body wf-body--2"><nav class="wf-list" id="dt-list"></nav><div class="wf-main" id="dt-main"></div></div>
    <footer class="wf-mf" id="dt-foot"></footer>
  </div>`);
  _dtRenderList(); _dtRenderMain(); _dtRenderFoot();
  _dtSyncGuard();
}

// ── Contrôles (réutilisent les primitives .wf-*) ──
function _dtStp(field, val, o = {}) {
  const { step = 1, min = 0, max = 99, pre = '', suf = '' } = o;
  const a = `data-dt-step="${field}" data-step="${step}" data-min="${min}" data-max="${max}"`;
  return `<div class="wf-stp"><button type="button" ${a} data-dir="-1">−</button><span>${pre}${val}${suf}</span><button type="button" ${a} data-dir="1">+</button></div>`;
}
function _dtSeg(field, val, opts) { return `<div class="wf-seg">${opts.map(([v, l]) => `<button type="button" class="${val === v ? 'on' : ''}" data-dt-set="${field}:${v}">${_esc(l)}</button>`).join('')}</div>`; }

function _dtSetPath(t, path, value) {
  if (path.startsWith('rules.')) { t.rules = t.rules || {}; t.rules[path.slice(6)] = value; }
  else t[path] = value;
}

async function _dtSave() {
  if (_dtAllErr().length || !_dtDirty()) return;
  const draft = _dtDraft.map(t => normalizeDamageType({ ...t }));
  await saveDamageTypes(draft);
  invalidateDamageTypesCache();
  _damageTypes = _dtClone(draft);
  _dtDraft = _dtClone(draft);
  _dtSaved = _dtClone(draft);
  if (!_dtCur()) _dtSelId = _dtDraft[0]?.id || null;
  showNotif('Types de dégâts enregistrés.', 'success');
  _dtRender();
}

function _dtMount() {
  if (_dtMounted) return; _dtMounted = true;
  document.addEventListener('click', ev => {
    if (!document.querySelector('.dt')) return;
    // Fermer la palette d'emoji sur un clic extérieur.
    if (_dtEmoji && !ev.target.closest('.dt-emoji-wrap')) { _dtEmoji = false; _dtRenderMain(); }
    const t = ev.target.closest('[data-dt-sel],[data-dt-add],[data-dt-nat],[data-dt-mv],[data-dt-dup],[data-dt-del],[data-dt-delok],[data-dt-color],[data-dt-light],[data-dt-set],[data-dt-step],[data-dt-tech],[data-dt-addtech],[data-dt-emoji],[data-dt-pick],[data-dt-weapons],[data-dt-revert],[data-dt-save],[data-dt-close],[data-dt-keep],[data-dt-discard],[data-wf-step],[data-wf-fxadd],[data-wf-fxrm],[data-wf-fxset],[data-wf-fxtog],[data-wf-trig],[data-wf-fxmenu],[data-wf-duptech],[data-wf-deltech]');
    if (!t) { if (_dtFxMenu) { _dtFxMenu = false; _dtRenderMain(); } return; }
    const d = t.dataset, cur = _dtCur();
    const _dtOt = () => (cur?.techniques || []).find(x => x.id === _dtOpenTech);
    // ── Éditeur de technique partagé (data-wf-*) ──
    if ('wfFxmenu' in d) { _dtFxMenu = !_dtFxMenu; return _dtRenderMain(); }
    if (d.wfTrig || d.wfFxadd || d.wfFxrm || d.wfFxset || d.wfFxtog || d.wfStep) { _dtFxMenu = false; if (_TE.applyClick(d, _dtOt())) return _dtRender(); return _dtRenderMain(); }
    if ('wfDuptech' in d) { const o = _dtOt(); if (cur && o) { const copy = { ...JSON.parse(JSON.stringify(o)), id: `dtt_${Date.now()}`, label: `${o.label} (copie)` }; cur.techniques.splice(cur.techniques.indexOf(o) + 1, 0, copy); _dtOpenTech = copy.id; } _dtFxMenu = false; return _dtRender(); }
    if ('wfDeltech' in d) { const o = _dtOt(); if (cur && o) { cur.techniques.splice(cur.techniques.indexOf(o), 1); _dtOpenTech = null; showNotif('Technique supprimée. « Annuler les modifications » pour revenir.', 'info'); } _dtFxMenu = false; return _dtRender(); }
    _dtFxMenu = false;
    if (d.dtSel != null) { _dtSelId = d.dtSel; _dtOpenTech = _dtCur()?.techniques?.[0]?.id || null; _dtEmoji = false; return _dtRender(); }
    if ('dtAdd' in d) { const id = `dt_${Date.now()}`; _dtDraft.push(normalizeDamageType({ id, label: '', icon: '', color: '#9ca3af', isMagic: false, rules: { ...DEFAULT_RULES, missScope: 'always' }, techniques: [] })); _dtSelId = id; _dtOpenTech = null; _dtEmoji = false; _dtRender(); document.getElementById('dt-name')?.focus(); return; }
    if (d.dtNat != null) { if (cur) cur.isMagic = d.dtNat === '1'; return _dtRender(); }
    if (d.dtMv) { const i = _dtDraft.indexOf(cur), j = i + (+d.dtMv); if (_dtDraft[j]) { [_dtDraft[i], _dtDraft[j]] = [_dtDraft[j], _dtDraft[i]]; _dtRender(); } return; }
    if ('dtDup' in d) { if (!cur) return; const id = `dt_${Date.now()}`; const copy = normalizeDamageType({ ..._dtClone([cur])[0], id, label: `${cur.label} (copie)` }); copy.techniques = (copy.techniques || []).map((tq, k) => ({ ...tq, id: `dtt_${Date.now()}_${k}` })); _dtDraft.splice(_dtDraft.indexOf(cur) + 1, 0, copy); _dtSelId = id; return _dtRender(); }
    if ('dtDel' in d) { if (cur?.id === 'physique') return; _dtReplaceId = _dtDraft.find(o => o !== cur && o.id === 'physique')?.id || _dtDraft.find(o => o !== cur)?.id || 'physique'; _dtAsk = 'del'; return _dtRenderFoot(); }
    if ('dtDelok' in d) { const i = _dtDraft.indexOf(cur); _dtDraft.splice(i, 1); _dtSelId = (_dtDraft[i] || _dtDraft[i - 1])?.id || null; _dtOpenTech = _dtCur()?.techniques?.[0]?.id || null; _dtAsk = null; return _dtRender(); }
    if (d.dtColor) { if (cur) cur.color = d.dtColor; return _dtRender(); }
    if ('dtLight' in d) { if (cur) cur.emitsLight = !damageTypeEmitsLight(cur); return _dtRender(); }
    if (d.dtSet) { const [path, val] = d.dtSet.split(':'); if (cur) { _dtSetPath(cur, path, val); } return _dtRender(); }
    if (d.dtStep) { const path = d.dtStep; if (cur) { const base = path.startsWith('rules.') ? (cur.rules?.[path.slice(6)] || 0) : (cur[path] || 0); let v = (parseInt(base, 10) || 0) + (+d.dir) * (+d.step || 1); v = Math.max(+d.min, Math.min(+d.max, v)); _dtSetPath(cur, path, v); } return _dtRender(); }
    if (d.dtTech) { _dtOpenTech = (_dtOpenTech === d.dtTech) ? null : d.dtTech; return _dtRenderMain(); }
    if (d.dtAddtech) { if (cur) { const src = _DT_TECHNIQUE_PRESETS[d.dtAddtech] || _DT_TECHNIQUE_PRESETS.blank; const nt = normalizeWeaponTechnique({ ...src, id: `dtt_${Date.now()}` }, (cur.techniques || []).length); (cur.techniques || (cur.techniques = [])).push(nt); _dtOpenTech = nt.id; } return _dtRender(); }
    if ('dtEmoji' in d) { _dtEmoji = !_dtEmoji; return _dtRenderMain(); }
    if ('dtPick' in d) { if (cur) cur.icon = d.dtPick || ''; _dtEmoji = false; return _dtRender(); }
    if ('dtWeapons' in d) { if (_dtDirty()) { _dtAsk = 'close'; return _dtRenderFoot(); } setModalCloseGuard(null); openWeaponFormatsAdmin(); return; }
    if ('dtRevert' in d) { _dtDraft = _dtClone(_dtSaved); if (!_dtCur()) _dtSelId = _dtDraft[0]?.id || null; _dtAsk = null; return _dtRender(); }
    if ('dtSave' in d) return _dtSave();
    if ('dtClose' in d) { if (_dtDirty()) { _dtAsk = 'close'; _dtRenderFoot(); } else { setModalCloseGuard(null); closeModalDirect(); } return; }
    if ('dtKeep' in d) { _dtAsk = null; return _dtRenderFoot(); }
    if ('dtDiscard' in d) { _dtAsk = null; _dtDraft = _dtClone(_dtSaved); _dtSelId = _dtDraft[0]?.id || null; setModalCloseGuard(null); closeModalDirect(); return; }
  });
  document.addEventListener('input', ev => {
    if (!document.querySelector('.dt')) return;
    const cur = _dtCur(); if (!cur) return;
    const el = ev.target;
    if (el.hasAttribute('data-dt-name')) { cur.label = el.value; _dtRenderList(); _dtRenderFoot(); const e = _dtTypeErrs(cur); el.classList.toggle('bad', e.includes('name') || e.includes('dupname')); }
    else if (el.hasAttribute('data-dt-colorpick')) { cur.color = el.value; _dtRenderList(); const eh = document.querySelector('.dt .wf-eh'); if (eh) eh.style.setProperty('--c', cur.color); const pv = document.querySelector('.dt .dt-chip'); if (pv) pv.style.setProperty('--c', cur.color); }
    else if (el.id === 'dt-emoji-in') { const first = Array.from(el.value.trim())[0] || ''; if (first) { cur.icon = first; _dtEmoji = false; _dtRender(); } }
    else if (el.hasAttribute('data-wf-fxt')) {
      const o = (cur.techniques || []).find(x => x.id === _dtOpenTech);
      const field = _TE.applyField(el.dataset, o, el.value);
      if (field) { if (field === 'label') el.classList.toggle('bad', !String(el.value).trim()); _dtRenderList(); _dtRenderFoot(); const card = document.querySelector('.dt .wf-tq.open'); if (card && o) { const nm = card.querySelector('.wf-tq-h b'); if (nm) nm.textContent = o.label || 'Sans nom'; const sum = card.querySelector('.wf-tq-sum'); if (sum) sum.textContent = _wfTechSummary(o); } }
    }
  });
  document.addEventListener('change', ev => {
    if (!document.querySelector('.dt')) return;
    const cur = _dtCur(); if (!cur) return;
    if (ev.target.hasAttribute('data-dt-colorpick')) { cur.color = ev.target.value; _dtRender(); }
    else if (ev.target.hasAttribute('data-dt-replace')) { _dtReplaceId = ev.target.value; }
    else if (ev.target.hasAttribute('data-wf-fx')) { const o = (cur.techniques || []).find(x => x.id === _dtOpenTech); if (_TE.applyField(ev.target.dataset, o, ev.target.value)) { _dtRenderMain(); _dtRenderList(); _dtRenderFoot(); } }
  });
  document.addEventListener('keydown', ev => {
    if (!document.querySelector('.dt')) return;
    if (ev.key === 'Escape') {
      if (_dtEmoji) { ev.stopPropagation(); _dtEmoji = false; _dtRenderMain(); return; }
      if (_dtAsk) { ev.stopPropagation(); ev.preventDefault(); _dtAsk = null; _dtRenderFoot(); return; }
    }
  }, true);
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
    { id:'protectionCA', label:'🛡️ Protection',       desc:'Bonus de CA et réduction de dégâts par élément' },
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
        Bonus de CA et réduction de dégâts par rune Protection selon l'élément du noyau.
        Valeurs par défaut : <strong>+2 CA</strong> et <strong>−2 dégâts</strong> par rune (1 dégât minimum). La note s'affiche dans la fiche du sort.
      </p>
      <div style="display:flex;flex-direction:column;gap:.35rem">
        ${types.map(t => {
          const ov  = _spellMatricesDraft.protectionCA[t.id] || {};
          const mod = ov.mod ?? 2;
          const red = ov.reduction ?? 2;
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
            <label style="display:flex;align-items:center;gap:.25rem;font-size:.72rem;color:var(--text-dim)" title="Dégâts retirés à chaque coup reçu, par rune Protection en mode Réduction">
              Réd. /rune
              <input type="number" min="0" max="10" step="1" value="${red}"
                data-change="_setSpellMatrixRedStep" data-tid="${t.id}"
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

function _setSpellMatrixRedStep(elementId, val) {
  const n = parseInt(val);
  if (!Number.isFinite(n)) return;
  if (!_spellMatricesDraft.protectionCA[elementId]) _spellMatricesDraft.protectionCA[elementId] = {};
  _spellMatricesDraft.protectionCA[elementId].reduction = Math.max(0, Math.min(10, n));
}

function _setSpellMatrixCANote(elementId, val) {
  if (!_spellMatricesDraft.protectionCA[elementId]) _spellMatricesDraft.protectionCA[elementId] = {};
  const v = (val || '').trim();
  if (v) _spellMatricesDraft.protectionCA[elementId].note = v;
  else   delete _spellMatricesDraft.protectionCA[elementId].note;
  // Cleanup si entrée vide (ni mod ≠ 2, ni réduction ≠ 2, ni note)
  const entry = _spellMatricesDraft.protectionCA[elementId];
  if (entry && (entry.mod === undefined || entry.mod === 2)
      && (entry.reduction === undefined || entry.reduction === 2) && !entry.note) {
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
  const setDmgBonus = getArmorSetData(c).modifiers.damageBonus || 0;
  const statLabel = statsArr.map(k => _STAT_LABELS[k] || k).join(' + ');
  return {
    roll:           `${item.degats} ${modStr(statMod + maitriseBonus + setDmgBonus)}`,
    statLabel,
    statMod,
    maitriseBonus,
    setDmgBonus,
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
  _setSpellMatrixCAMod:        (el) => _setSpellMatrixCAMod(el.dataset.tid, el.value),
  _setSpellMatrixRedStep:      (el) => _setSpellMatrixRedStep(el.dataset.tid, el.value),
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
  openCombatStylesAdmin:    ()    => openCombatStylesAdmin(),
  openWeaponFormatsAdmin:   ()    => openWeaponFormatsAdmin(),
  openDamageTypesAdmin:     ()    => openDamageTypesAdmin(),
  openSpellMatricesAdmin:   ()    => openSpellMatricesAdmin(),
  openCharacterRulesAdmin:  ()    => openCharacterRulesAdmin(),
  openEquipmentSlotsAdmin:  ()    => openEquipmentSlotsAdmin(),
  openArmorSetsAdmin:       ()    => openArmorSetsAdmin(),
  openSpellSystemAdmin:     ()    => openSpellSystemAdmin(),
  _switchSpellMatrixTab:    (btn) => _switchSpellMatrixTab(btn.dataset.tab),
  _saveSpellMatrices:       ()    => _saveSpellMatrices(),
});
