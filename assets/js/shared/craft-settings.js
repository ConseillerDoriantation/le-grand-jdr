// ══════════════════════════════════════════════════════════════════════════════
// CONFIG DU CRAFT GÉNÉRATIF — Firestore : world/craft_config
//
// Réglé depuis la console MJ. Relie chaque discipline (Forge/Confection/Orfèvre)
// à une compétence des Jets 🎲, mappe catégorie d'objet → discipline, et fixe les
// DD / quantités par palier + le remboursement en cas d'échec.
// La logique pure vit dans shared/craft-engine.js (source des valeurs par défaut).
// ══════════════════════════════════════════════════════════════════════════════

import { getDocData, saveDoc, loadCollection } from '../data/firestore.js';
import { openModal, closeModal, closeModalDirect, confirmModal } from './modal.js';
import { registerActions } from '../core/actions.js';
import { showNotif } from './notifications.js';
import { _esc } from './html.js';
import { normalizeDiceSkills, DICE_SKILLS_DEFAULT } from './dice-skills.js';
import { DEFAULT_CRAFT_CONFIG } from './craft-engine.js';

let _cfg = null;
let _skills = [];
let _shopItems = [];
const PALIERS = [1, 2, 3];
const STARS = { 1: '★', 2: '★★', 3: '★★★' };

const DISCIPLINES = [
  { id: 'forge',      label: '⚒️ Forge' },
  { id: 'confection', label: '🧵 Confection' },
  { id: 'orfevre',    label: '💎 Orfèvre' },
];
// Catégories = « buckets » de matériaux/discipline, dérivés de la NATURE (+ portée
// pour les armes) et NON de la famille. Le craft mappe automatiquement :
// épée physique → « Armes physiques · mêlée » ; épée magique → « Armes magiques ».
const OBJ_CATEGORIES = [
  { id: 'armeCaC',              label: '⚔️ Armes physiques · mêlée' },
  { id: 'armeDist',            label: '🏹 Armes physiques · distance' },
  { id: 'armeMagique',         label: '🔮 Armes magiques (toutes)' },
  { id: 'armureLegere',        label: '🥋 Armures légères' },
  { id: 'armureIntermediaire', label: '🧥 Armures intermédiaires' },
  { id: 'armureLourde',        label: '🛡️ Armures lourdes' },
  { id: 'anneau',              label: '💍 Anneaux' },
  { id: 'amulette',            label: '📿 Amulettes' },
];

// Fusion défensive : tout champ manquant retombe sur les défauts du moteur.
function _merge(stored = {}) {
  const d = DEFAULT_CRAFT_CONFIG;
  return {
    categorieDiscipline:  { ...d.categorieDiscipline,  ...(stored.categorieDiscipline  || {}) },
    disciplineCompetence: { ...d.disciplineCompetence, ...(stored.disciplineCompetence || {}) },
    ddParPalier:          { ...d.ddParPalier,          ...(stored.ddParPalier          || {}) },
    quantiteParPalier:    { ...d.quantiteParPalier,    ...(stored.quantiteParPalier    || {}) },
    refundFractionOnFail: stored.refundFractionOnFail ?? d.refundFractionOnFail,
    // Recettes : par type d'objet × palier → matériau requis.
    // { '<type>': { '1': { itemId, quantite }, '2': {…}, '3': {…} } }
    recipes:              { ...(stored.recipes || {}) },
  };
}

/** Exigence normalisée d'un type×palier : [{itemId, quantite}] (vide si non liée). */
export function craftRecipeMaterials(type, tier, cfg = getCraftSettings()) {
  const r = cfg?.recipes?.[type]?.[tier];
  if (!r || !r.itemId) return [];
  const defQty = cfg?.quantiteParPalier?.[tier] ?? DEFAULT_CRAFT_CONFIG.quantiteParPalier[tier];
  return [{ itemId: String(r.itemId), quantite: Math.max(1, parseInt(r.quantite, 10) || defQty) }];
}

export async function loadCraftSettings() {
  if (_cfg) return _cfg;
  try { _cfg = _merge((await getDocData('world', 'craft_config')) || {}); }
  catch { _cfg = _merge({}); }
  return _cfg;
}
export function getCraftSettings() { return _cfg || _merge({}); }
export function invalidateCraftSettingsCache() { _cfg = null; }
export async function saveCraftSettings(cfg) {
  await saveDoc('world', 'craft_config', cfg);
  _cfg = _merge(cfg);
}

async function _loadSkills() {
  try {
    const doc = await getDocData('world', 'dice_skills');
    _skills = normalizeDiceSkills(doc?.skills || doc?.list || doc, DICE_SKILLS_DEFAULT);
  } catch { _skills = normalizeDiceSkills(DICE_SKILLS_DEFAULT); }
  if (!_skills.length) _skills = normalizeDiceSkills(DICE_SKILLS_DEFAULT);
  return _skills;
}

// ══════════════════════════════════════════════
// ADMIN — modale de réglage
// ══════════════════════════════════════════════
export async function openCraftSettingsAdmin() {
  await loadCraftSettings();
  await _loadSkills();
  try {
    _shopItems = (await loadCollection('shop') || [])
      .filter(it => it && it.nom)
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
  } catch { _shopItems = []; }
  _renderModal();
}

function _itemOptions(selected) {
  const opts = _shopItems.map(it => `<option value="${_esc(it.id)}" ${it.id === selected ? 'selected' : ''}>${_esc(it.nom)}</option>`).join('');
  return `<option value="">— aucun —</option>${opts}`;
}

function _skillOptions(selected) {
  const opts = _skills.map(s => `<option value="${_esc(s.name)}" ${s.name === selected ? 'selected' : ''}>${_esc(s.name)}${s.stat ? ` (${_esc(s.stat)})` : ''}</option>`).join('');
  return `<option value="">— compétence —</option>${opts}`;
}
function _discOptions(selected) {
  return DISCIPLINES.map(d => `<option value="${d.id}" ${d.id === selected ? 'selected' : ''}>${d.label}</option>`).join('');
}

function _renderModal() {
  const s = getCraftSettings();
  const compRow = (disc, label) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <select class="sh-admin-row-input" data-change="_craftDisc" data-field="disciplineCompetence.${disc}">
        ${_skillOptions(s.disciplineCompetence?.[disc] || '')}
      </select>
    </div>`;
  const catRow = (cat, label) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <select class="sh-admin-row-input" data-change="_craftCat" data-field="categorieDiscipline.${cat}">
        ${_discOptions(s.categorieDiscipline?.[cat] || '')}
      </select>
    </div>`;
  const numRow = (label, field, val, min = 0, max = 99) => `
    <div class="sh-admin-row-line">
      <span class="sh-admin-row-lbl">${label}</span>
      <input type="number" class="sh-admin-row-input small" value="${val}" min="${min}" max="${max}" step="1"
        data-input="_craftNum" data-field="${field}">
    </div>`;

  openModal('', `
  <div class="sh-admin-modal is-upgrades">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">⚒️</div>
      <div class="sh-admin-head-title">
        <h2>Réglages du craft</h2>
        <small>Disciplines, compétences et paliers · s'applique immédiatement</small>
      </div>
      <button class="sh-admin-close" data-action="_craftStgClose" title="Fermer">✕</button>
    </div>
    <div class="sh-admin-body">

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🎲 Compétence par discipline</div>
        <p class="sh-admin-section-hint">Le jet de craft = <b>d20 + cette compétence</b> vs DD du palier.</p>
        ${compRow('forge', '⚒️ Forge')}
        ${compRow('confection', '🧵 Confection')}
        ${compRow('orfevre', '💎 Orfèvre')}
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🗂️ Catégorie d'objet → discipline</div>
        <p class="sh-admin-section-hint">Catégories basées sur la <b>nature</b> (+ portée pour les armes), pas sur la famille : une <em>épée physique</em> compte comme « mêlée physique », une <em>épée magique</em> comme « armes magiques ». Le craft déduit la catégorie automatiquement.</p>
        ${OBJ_CATEGORIES.map(c => catRow(c.id, c.label)).join('')}
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🧱 Matériaux requis par catégorie</div>
        <p class="sh-admin-section-hint">Par catégorie (= nature + portée) × palier, choisis l'objet-matériau requis (créé en Boutique) et la quantité (vide = défaut du palier). Ex. « Armes physiques · mêlée ★★ » → <em>Matériaux bestiaux ★★</em> ; « Armes magiques ★★ » → <em>Matériaux mystiques ★★</em>. Toutes les épées physiques partagent donc le même matériau, les magiques un autre.</p>
        ${OBJ_CATEGORIES.map(c => `
          <div style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--border-md)">
            <div class="sh-admin-section-title" style="font-size:.78rem;margin-bottom:4px">${c.label}</div>
            ${PALIERS.map(p => {
              const r = s.recipes?.[c.id]?.[p] || {};
              const defQty = s.quantiteParPalier?.[p] ?? '';
              return `<div class="sh-admin-row-line">
                <span class="sh-admin-row-lbl" style="min-width:34px">${STARS[p]}</span>
                <select class="sh-admin-row-input" data-change="_craftRecipeMat" data-type="${c.id}" data-tier="${p}">${_itemOptions(r.itemId || '')}</select>
                <input type="number" class="sh-admin-row-input small" min="1" max="99" value="${r.quantite ?? ''}" placeholder="${defQty}"
                  data-input="_craftRecipeQty" data-type="${c.id}" data-tier="${p}" title="Quantité (vide = ${defQty})">
              </div>`;
            }).join('')}
          </div>`).join('')}
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🎯 Difficulté (DD) par palier</div>
        ${numRow('★ (1★)',   'ddParPalier.1', s.ddParPalier?.[1] ?? 11, 1, 40)}
        ${numRow('★★ (2★)',  'ddParPalier.2', s.ddParPalier?.[2] ?? 14, 1, 40)}
        ${numRow('★★★ (3★)', 'ddParPalier.3', s.ddParPalier?.[3] ?? 17, 1, 40)}
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📦 Matériaux requis par palier</div>
        ${numRow('★ (1★)',   'quantiteParPalier.1', s.quantiteParPalier?.[1] ?? 6)}
        ${numRow('★★ (2★)',  'quantiteParPalier.2', s.quantiteParPalier?.[2] ?? 10)}
        ${numRow('★★★ (3★)', 'quantiteParPalier.3', s.quantiteParPalier?.[3] ?? 15)}
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">💥 Échec</div>
        <div class="sh-admin-row-line">
          <span class="sh-admin-row-lbl">Matériaux rendus en cas d'échec</span>
          <input type="number" class="sh-admin-row-input small" value="${Math.round((s.refundFractionOnFail || 0) * 100)}" min="0" max="100" step="5"
            data-input="_craftRefund">
          <span class="sh-admin-row-unit">%</span>
        </div>
        <p class="sh-admin-section-hint" style="margin-top:6px">0 % = perte totale (défaut, loot généreux).</p>
      </div>

    </div>
    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-action="_craftStgReset">↻ Restaurer défauts</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-outline btn-sm" data-action="_craftStgClose">Annuler</button>
      <button class="btn btn-gold btn-sm" data-action="_craftStgSave">💾 Enregistrer</button>
    </div>
  </div>`);
}

function _set(path, value) {
  const parts = path.split('.');
  const s = getCraftSettings();
  let cur = s;
  for (let i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] == null) cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = value;
  _cfg = s;
}

function _setRecipe(type, tier, key, value) {
  const s = getCraftSettings();
  (s.recipes ??= {});
  (s.recipes[type] ??= {});
  (s.recipes[type][tier] ??= {});
  if (value === null || value === '') delete s.recipes[type][tier][key];
  else s.recipes[type][tier][key] = value;
  _cfg = s;
}

async function _saveAndClose() {
  try {
    await saveCraftSettings(getCraftSettings());
    showNotif('Réglages du craft enregistrés.', 'success');
    closeModalDirect();
  } catch (e) { console.error(e); showNotif('Erreur lors de l\'enregistrement.', 'error'); }
}
async function _resetDefaults() {
  if (!await confirmModal('Restaurer les valeurs par défaut du craft ?', { title: 'Confirmation' })) return;
  _cfg = _merge({});
  _renderModal();
}

registerActions({
  _craftStgClose: () => closeModal(),
  _craftStgSave:  () => _saveAndClose(),
  _craftStgReset: () => _resetDefaults(),
  _craftDisc:  (el) => _set(el.dataset.field, el.value),
  _craftCat:   (el) => _set(el.dataset.field, el.value),
  _craftNum:   (el) => _set(el.dataset.field, Math.max(0, parseInt(el.value, 10) || 0)),
  _craftRefund:(el) => _set('refundFractionOnFail', Math.max(0, Math.min(100, parseInt(el.value, 10) || 0)) / 100),
  _craftRecipeMat: (el) => _setRecipe(el.dataset.type, el.dataset.tier, 'itemId', el.value),
  _craftRecipeQty: (el) => _setRecipe(el.dataset.type, el.dataset.tier, 'quantite', el.value ? Math.max(1, parseInt(el.value, 10) || 0) : null),
});
