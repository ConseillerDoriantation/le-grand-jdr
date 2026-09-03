// ══════════════════════════════════════════════════════════════════════════
// ONGLET CAPACITÉS (V3) — Résistances · Capacités & Traits · Compétences · Langues
// Modèle de données neuf, stocké à la racine du personnage :
//   c.resistances = [{ t, k, cat }]   (k: res|imm|vul|abs · cat: degat|etat)
//   c.capacites   = [{ nom, kind, usage, cost, desc }]   (kind: class|race|histo|autre)
//   c.langues     = [{ nom, niv }]     (niv: natif|courant|notions)
//   c.competences = [{ nom, stat, niv }] (niv: aucun|forme|expert)
// Les résistances de DÉGÂTS accordées par l'équipement (getCharDamageProfile)
// sont fusionnées et dédupliquées → non cumulables avec les résistances innées.
// ══════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { updateInCol } from '../../data/firestore.js';
import { showNotif } from '../../shared/notifications.js';
import { openModal, closeModalDirect, modalSection } from '../../shared/modal.js';
import { _esc } from '../../shared/html.js';
import { getCharDamageProfile } from '../../shared/equipment-utils.js';
import { DEFAULT_DAMAGE_TYPES, loadDamageTypes, getDamageTypeById } from '../../shared/damage-types.js';
import { CONDITION_DEFAULT_LIBRARY, loadConditionLibrary } from '../../shared/conditions.js';
import { getCharacterById } from '../../shared/character-state.js';
import { DICE_SKILLS_DEFAULT } from '../../shared/dice-skills.js';
import { getMod, computeEquipSkillBonus } from '../../shared/char-stats.js';

// Compétences : liste FIXE (compétence → caractéristique) alignée sur la modale
// de jets « Compétences et caractéristiques ». On exclut les entrées « brutes »
// (les caractéristiques elles-mêmes + Combat) pour ne garder que les compétences.
const _RAW_SKILL_NAMES = new Set(['Force', 'Dextérité', 'Constitution', 'Intelligence', 'Sagesse', 'Charisme', 'Combat']);
const SKILL_LIST = DICE_SKILLS_DEFAULT.filter(s => s.stat && !_RAW_SKILL_NAMES.has(s.name));
const _STAT_ABBR_TO_KEY = { FOR: 'force', DEX: 'dexterite', CON: 'constitution', INT: 'intelligence', SAG: 'sagesse', CHA: 'charisme' };
// Niveau → bonus fixe appliqué au jet (le VTT applique aussi l'avantage en expertise).
const SKILL_BONUS = { forme: 2, expert: 2 };

// Caches (chargés à froid, puis re-render du tab) : types de dégâts + états de l'aventure.
let _capDmgTypes = null;
let _capConditions = null;

const RES_KINDS = {
  res: { lbl: 'Résistance',    cls: 'res' },
  imm: { lbl: 'Immunité',      cls: 'imm' },
  vul: { lbl: 'Vulnérabilité', cls: 'vul' },
  abs: { lbl: 'Absorption',    cls: 'imm' },
};
const CAP_KINDS = {
  class:  { ico: '⚔️', label: 'Classe',      c: '#7eb0ff' },
  race:   { ico: '🧬', label: 'Race',        c: '#22c38e' },
  histo:  { ico: '📜', label: 'Historique',  c: '#f4c430' },
  autre:  { ico: '✦',  label: 'Autre',       c: '#9d6fff' },
};
const LANG_NIV = { natif: 'natif', courant: 'courant', notions: 'notions' };
const COMP_NIV = {
  aucun:  { lbl: 'Non formée', dot: '' },
  forme:  { lbl: 'Formée',     dot: 'forme' },
  expert: { lbl: 'Expertise',  dot: 'expert' },
};

// ── Résolution type de dégât / état (label + icône) ───────────────────────
function _dmgMeta(id) {
  const list = _capDmgTypes || DEFAULT_DAMAGE_TYPES;
  const t = getDamageTypeById(list, id) || list.find(x => x.id === id);
  return t ? { label: t.label || t.nom || id, ico: t.icon || t.emoji || '🔸' } : { label: id, ico: '🔸' };
}
function _etatMeta(id) {
  const list = _capConditions || CONDITION_DEFAULT_LIBRARY;
  const t = list.find(x => x.id === id || x.nom === id || x.label === id);
  return t ? { label: t.label || t.nom || id, ico: t.icon || t.emoji || '⛓️' } : { label: id, ico: '⛓️' };
}

// ── Getters normalisés ────────────────────────────────────────────────────
const _arr = (c, f) => Array.isArray(c?.[f]) ? c[f] : [];

// Résistances de dégâts fusionnées innées + équipement (dédupliquées par type).
function _mergedDmgResist(c) {
  const innate = _arr(c, 'resistances').filter(r => r.cat === 'degat');
  const seen = new Map();                       // typeId → {t,k,src}
  innate.forEach(r => { if (!seen.has(r.t)) seen.set(r.t, { t: r.t, k: r.k, src: 'inné' }); });
  const eq = getCharDamageProfile(c);
  if (eq) {
    const push = (ids, k) => (ids || []).forEach(id => { if (!seen.has(id)) seen.set(id, { t: id, k, src: 'équip.' }); });
    push(eq.resistances, 'res');
    push(eq.immunites, 'imm');
    push(eq.faiblesses, 'vul');
    push(eq.absorptions, 'abs');
  }
  return [...seen.values()];
}

// ══════════════════════════════════════════════════════════════════════════
// RENDU
// ══════════════════════════════════════════════════════════════════════════
export function renderCharCapacites(c, canEdit) {
  _bootstrapCaches(c);
  return `<div class="cs-caps">
    ${_sectionResist(c, canEdit)}
    ${_sectionCapacites(c, canEdit)}
    ${_sectionCompetences(c, canEdit)}
    ${_sectionLangues(c, canEdit)}
  </div>`;
}

function _hdr(icon, title, hint, addFn) {
  return `<div class="cs-section-hdr">
    <span class="cs-section-title">${icon} ${title}</span>
    ${hint ? `<span class="cs-hint">${hint}</span>` : ''}
    ${addFn ? `<button class="cs-inv-action-btn" data-action="${addFn}" data-id="${STATE.activeChar?.id || ''}">＋ Ajouter</button>` : ''}
  </div>`;
}

function _sectionResist(c, canEdit) {
  const dmg = _mergedDmgResist(c);
  const etats = _arr(c, 'resistances').filter(r => r.cat === 'etat');
  const chip = (r, meta) => {
    const k = RES_KINDS[r.k] || RES_KINDS.res;
    return `<span class="resist-chip ${k.cls}" title="${k.lbl}${r.src ? ' · ' + r.src : ''}">${meta.ico} ${_esc(meta.label)} <b>${k.lbl}</b>${r.src === 'équip.' ? '<i class="resist-src">🛡️</i>' : (canEdit && r.src !== 'équip.' ? `<button class="resist-x" data-action="capRemoveResist" data-t="${_esc(r.t)}" data-cat="degat" data-stop-propagation title="Retirer">✕</button>` : '')}</span>`;
  };
  const dmgChips = dmg.length ? dmg.map(r => chip(r, _dmgMeta(r.t))).join('') : `<span class="cs-caps-empty">Aucune résistance aux dégâts.</span>`;
  const etatChips = etats.length
    ? etats.map(r => {
        const k = RES_KINDS[r.k] || RES_KINDS.res;
        const meta = _etatMeta(r.t);
        return `<span class="resist-chip ${k.cls}" title="${k.lbl}">${meta.ico} ${_esc(meta.label)} <b>${k.lbl}</b>${canEdit ? `<button class="resist-x" data-action="capRemoveResist" data-t="${_esc(r.t)}" data-cat="etat" data-stop-propagation title="Retirer">✕</button>` : ''}</span>`;
      }).join('')
    : `<span class="cs-caps-empty">Aucune résistance aux états.</span>`;
  return `<section class="cs-section cs-section--compact">
    ${_hdr('🛡️', 'Résistances', 'non cumulables avec l’équipement', canEdit ? 'capAddResist' : '')}
    <div class="resist-row"><span class="resist-lbl">Dégâts</span>${dmgChips}</div>
    <div class="resist-row"><span class="resist-lbl">États</span>${etatChips}</div>
  </section>`;
}

function _sectionCapacites(c, canEdit) {
  const caps = _arr(c, 'capacites');
  const cards = caps.length ? caps.map((cap, i) => {
    const km = CAP_KINDS[cap.kind] || CAP_KINDS.autre;
    return `<div class="capa-card" style="--cap-c:${km.c}">
      <div class="capa-head">
        <span class="capa-kind">${km.ico} ${km.label}</span>
        ${cap.usage ? `<span class="capa-usage">${_esc(cap.usage)}</span>` : ''}
        ${canEdit ? `<span class="capa-acts">
          <button class="capa-x" data-action="capEditCapacite" data-idx="${i}" data-id="${c.id}" title="Modifier">✎</button>
          <button class="capa-x" data-action="capRemoveCapacite" data-idx="${i}" data-id="${c.id}" title="Supprimer">✕</button>
        </span>` : ''}
      </div>
      <div class="capa-name">${_esc(cap.nom || 'Sans nom')}</div>
      ${cap.desc ? `<div class="capa-desc">${_esc(cap.desc)}</div>` : ''}
      ${cap.cost ? `<div class="capa-cost">Coût : <b>${_esc(cap.cost)}</b></div>` : ''}
    </div>`;
  }).join('') : `<span class="cs-caps-empty">Aucune capacité ni trait. ${canEdit ? 'Ajoute-en avec ＋.' : ''}</span>`;
  return `<section class="cs-section cs-section--compact">
    ${_hdr('🌀', 'Capacités & Traits', 'Classe · Race · Historique', canEdit ? 'capAddCapacite' : '')}
    <div class="capa-grid">${cards}</div>
  </section>`;
}

function _sectionCompetences(c, canEdit) {
  // c.competences = map { [skillName]: 'forme'|'expert' } (absent = non formée).
  const levels = (c.competences && !Array.isArray(c.competences)) ? c.competences : {};
  const line = (sk) => {
    const lvl = COMP_NIV[levels[sk.name]] ? levels[sk.name] : 'aucun';
    const statKey = _STAT_ABBR_TO_KEY[sk.stat];
    const base = statKey ? getMod(c, statKey) : 0;
    const equipB = computeEquipSkillBonus(c.equipement || {}, sk.name) || 0;
    const total = base + equipB + (SKILL_BONUS[lvl] || 0);
    const modStr = (total >= 0 ? '+' : '') + total;
    const detail = `Base ${base >= 0 ? '+' : ''}${base}${equipB ? ` · équip. ${equipB >= 0 ? '+' : ''}${equipB}` : ''}${SKILL_BONUS[lvl] ? ` · ${lvl === 'expert' ? 'expertise' : 'maîtrise'} +${SKILL_BONUS[lvl]}` : ''}`;
    const title = `${detail}${lvl === 'expert' ? ' · avantage' : ''}${canEdit ? ' — cliquer pour changer le niveau' : ''}`;
    return `<div class="comp-line ${lvl}" title="${_esc(title)}"${canEdit ? ` data-action="capCycleSkill" data-skill="${_esc(sk.name)}" data-id="${c.id}" role="button" tabindex="0"` : ''}>
      <span class="comp-dot ${COMP_NIV[lvl].dot}"></span>
      <span class="comp-name">${_esc(sk.name)}</span>
      <span class="comp-stat">${_esc(sk.stat)}</span>
      <span class="comp-mod">${modStr}</span>
    </div>`;
  };
  return `<section class="cs-section cs-section--compact">
    ${_hdr('🎓', 'Compétences', '○ non formée · ◐ formée (+2) · ◉ expertise (+2 &amp; avantage)', '')}
    <div class="comp-grid">${SKILL_LIST.map(line).join('')}</div>
  </section>`;
}

function _sectionLangues(c, canEdit) {
  const langs = _arr(c, 'langues');
  const chips = langs.length ? langs.map((l, i) => {
    const niv = LANG_NIV[l.niv] ? l.niv : 'courant';
    return `<span class="lang-chip lvl-${niv === 'natif' ? 'natif' : niv === 'courant' ? 'fluent' : 'lit'}">
      <b>${_esc(l.nom || '')}</b><span>${_esc(niv)}</span>
      ${canEdit ? `<button class="resist-x" data-action="capRemoveLangue" data-idx="${i}" data-id="${c.id}" data-stop-propagation title="Retirer">✕</button>` : ''}
    </span>`;
  }).join('') : `<span class="cs-caps-empty">Aucune langue.</span>`;
  return `<section class="cs-section cs-section--compact">
    ${_hdr('💬', 'Langues', '', canEdit ? 'capAddLangue' : '')}
    <div class="lang-row">${chips}</div>
  </section>`;
}

// ══════════════════════════════════════════════════════════════════════════
// CHARGEMENT À FROID DES CACHES (types de dégâts + états)
// ══════════════════════════════════════════════════════════════════════════
let _bootstrapping = false;
function _bootstrapCaches(c) {
  if ((_capDmgTypes && _capConditions) || _bootstrapping) return;
  _bootstrapping = true;
  Promise.all([
    loadDamageTypes().catch(() => DEFAULT_DAMAGE_TYPES),
    loadConditionLibrary({ refresh: false }).catch(() => CONDITION_DEFAULT_LIBRARY),
  ]).then(([dmg, cond]) => {
    _capDmgTypes = dmg || DEFAULT_DAMAGE_TYPES;
    _capConditions = cond || CONDITION_DEFAULT_LIBRARY;
    _bootstrapping = false;
    // Re-render si on est toujours sur l'onglet Capacités du même perso.
    const cur = charSession.getCurrentChar?.();
    if (cur?.id === c.id && charSession.getCurrentCharTab?.() === 'capacites') {
      charSession.renderTab?.('capacites', cur, charSession.getCanEditChar?.());
    }
  }).catch(() => { _bootstrapping = false; });
}

// ══════════════════════════════════════════════════════════════════════════
// PERSISTANCE + RE-RENDER
// ══════════════════════════════════════════════════════════════════════════
async function _saveCaps(charId, patch) {
  const c = getCharacterById(charId);
  if (!c) return;
  Object.assign(c, patch);
  await updateInCol('characters', charId, patch);
  if (charSession.getCurrentChar?.()?.id === charId) {
    charSession.renderTab?.('capacites', c, charSession.getCanEditChar?.());
  }
}

// ── Petit formulaire modal générique ──────────────────────────────────────
// fields: [{ key, label, type:'text'|'textarea'|'select', options?, value? }]
function _capForm(title, fields, onSave) {
  const body = modalSection('', fields.map(f => {
    const id = `cap-f-${f.key}`;
    if (f.type === 'select') {
      const opts = f.options.map(([v, lbl]) => `<option value="${_esc(v)}" ${f.value === v ? 'selected' : ''}>${_esc(lbl)}</option>`).join('');
      return `<label class="cap-form-row"><span>${_esc(f.label)}</span><select id="${id}">${opts}</select></label>`;
    }
    if (f.type === 'textarea') {
      return `<label class="cap-form-row"><span>${_esc(f.label)}</span><textarea id="${id}" rows="3">${_esc(f.value || '')}</textarea></label>`;
    }
    return `<label class="cap-form-row"><span>${_esc(f.label)}</span><input type="text" id="${id}" value="${_esc(f.value || '')}" ${f.placeholder ? `placeholder="${_esc(f.placeholder)}"` : ''}></label>`;
  }).join('')) +
    `<div class="cap-form-foot">
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
      <button class="btn btn-gold btn-sm" id="cap-form-save">Enregistrer</button>
    </div>`;
  openModal(title, body);
  const saveBtn = document.getElementById('cap-form-save');
  saveBtn?.addEventListener('click', () => {
    const out = {};
    fields.forEach(f => { out[f.key] = (document.getElementById(`cap-f-${f.key}`)?.value || '').trim(); });
    closeModalDirect();
    onSave(out);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════════════════════════════════
function _dmgOptions() {
  return (_capDmgTypes || DEFAULT_DAMAGE_TYPES).map(t => [t.id, `${t.icon || t.emoji || ''} ${t.label || t.nom || t.id}`.trim()]);
}
function _etatOptions() {
  return (_capConditions || CONDITION_DEFAULT_LIBRARY).map(t => [t.id, `${t.icon || t.emoji || ''} ${t.label || t.nom || t.id}`.trim()]);
}

// Sélecteur en grille : clic sur une cible pour cycler son type de résistance.
// Dégâts : ∅ → Résistance → Immunité → Absorption → Vulnérabilité → ∅.
// États  : ∅ → Résistance → Immunité → Vulnérabilité → ∅ (pas d'absorption).
const _DMG_CYCLE  = ['', 'res', 'imm', 'abs', 'vul'];
const _ETAT_CYCLE = ['', 'res', 'imm', 'vul'];

function _resistPickerHtml(c) {
  const cur = _arr(c, 'resistances');
  const kindOf = (t, cat) => cur.find(r => r.t === t && r.cat === cat)?.k || '';
  const eqIds = (() => {
    const p = getCharDamageProfile(c); const s = new Set();
    if (p) [...p.resistances, ...p.immunites, ...p.faiblesses, ...p.absorptions].forEach(x => s.add(x));
    return s;
  })();
  const cell = (id, label, ico, cat, locked) => {
    const k = kindOf(id, cat);
    const km = k ? RES_KINDS[k] : null;
    return `<button type="button" class="res-pick ${km ? km.cls : ''}${locked ? ' is-locked' : ''}"${locked ? '' : ` data-action="capPickResist" data-t="${_esc(id)}" data-cat="${cat}" data-id="${c.id}"`} title="${locked ? 'Accordée par l’équipement (non modifiable ici)' : 'Cliquer pour changer'}">
      <span class="res-pick-nm">${ico} ${_esc(label)}${locked ? ' 🛡️' : ''}</span>
      <b>${locked ? 'équip.' : (km ? km.lbl : '—')}</b>
    </button>`;
  };
  const dmg = (_capDmgTypes || DEFAULT_DAMAGE_TYPES).map(t => cell(t.id, t.label || t.nom || t.id, t.icon || t.emoji || '🔸', 'degat', eqIds.has(t.id))).join('');
  const etat = (_capConditions || CONDITION_DEFAULT_LIBRARY).map(t => cell(t.id, t.label || t.nom || t.id, t.icon || t.emoji || '⛓️', 'etat', false)).join('');
  return `<div class="res-picker">
    <p class="res-pick-hint">Clique une cible pour cycler : <b class="res">Résistance</b> → <b class="imm">Immunité</b> → <b class="imm">Absorption</b> → <b class="vul">Vulnérabilité</b> → aucun. Les 🛡️ viennent de l'équipement.</p>
    <div class="res-pick-grp"><span class="cs-spellnav-label">Types de dégâts</span><div class="res-pick-grid">${dmg}</div></div>
    <div class="res-pick-grp"><span class="cs-spellnav-label">États <small>(pas d'absorption)</small></span><div class="res-pick-grid">${etat}</div></div>
    <div class="cap-form-foot"><button class="btn btn-gold btn-sm" data-action="close-modal">Fermer</button></div>
  </div>`;
}

function capAddResist(charId) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  openModal('Résistances', _resistPickerHtml(c));
}

function capPickResist(t, cat, charId) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  const cycle = cat === 'etat' ? _ETAT_CYCLE : _DMG_CYCLE;
  const list = _arr(c, 'resistances').slice();
  const i = list.findIndex(r => r.t === t && r.cat === cat);
  const curK = i >= 0 ? list[i].k : '';
  const nextK = cycle[(cycle.indexOf(curK) + 1) % cycle.length];
  // Libellé mémorisé → matching robuste côté VTT même si les ids d'états diffèrent.
  const label = cat === 'etat'
    ? ((_capConditions || CONDITION_DEFAULT_LIBRARY).find(x => x.id === t)?.label || '')
    : ((_capDmgTypes || DEFAULT_DAMAGE_TYPES).find(x => (x.id === t)) ? (( _capDmgTypes || DEFAULT_DAMAGE_TYPES).find(x => x.id === t).label || '') : '');
  if (!nextK) { if (i >= 0) list.splice(i, 1); }
  else if (i >= 0) list[i] = { t, k: nextK, cat, label };
  else list.push({ t, k: nextK, cat, label });
  Object.assign(c, { resistances: list });
  updateInCol('characters', charId, { resistances: list });
  openModal('Résistances', _resistPickerHtml(c));   // rafraîchit la grille (scroll conservé)
  if (charSession.getCurrentChar?.()?.id === charId) charSession.renderTab?.('capacites', c, charSession.getCanEditChar?.());
}

function capRemoveResist(t, cat, charId) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  const list = _arr(c, 'resistances').filter(r => !(r.t === t && r.cat === cat));
  _saveCaps(charId, { resistances: list });
}

function capAddCapacite(charId) { _editCapacite(charId, null); }
function capEditCapacite(charId, idx) { _editCapacite(charId, idx); }
function _editCapacite(charId, idx) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  const list = _arr(c, 'capacites').slice();
  const cur = idx != null ? (list[idx] || {}) : {};
  _capForm(idx != null ? 'Modifier la capacité' : 'Ajouter une capacité', [
    { key: 'nom',   label: 'Nom',           type: 'text',     value: cur.nom },
    { key: 'kind',  label: 'Origine',       type: 'select',   value: cur.kind || 'class', options: Object.entries(CAP_KINDS).map(([k, v]) => [k, `${v.ico} ${v.label}`]) },
    { key: 'usage', label: 'Usage',         type: 'text',     value: cur.usage, placeholder: 'Passif · 1/repos · à volonté…' },
    { key: 'cost',  label: 'Coût',          type: 'text',     value: cur.cost, placeholder: 'ex : 2 PM' },
    { key: 'desc',  label: 'Description',    type: 'textarea', value: cur.desc },
  ], (o) => {
    if (!o.nom) { showNotif('Un nom est requis.', 'error'); return; }
    if (idx != null) list[idx] = o; else list.push(o);
    _saveCaps(charId, { capacites: list });
  });
}
function capRemoveCapacite(charId, idx) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  const list = _arr(c, 'capacites').slice(); list.splice(idx, 1);
  _saveCaps(charId, { capacites: list });
}

// Cycle du niveau d'une compétence : non formée → formée → expertise → non formée.
function capCycleSkill(skillName, charId) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  const levels = (c.competences && !Array.isArray(c.competences)) ? { ...c.competences } : {};
  const cur = levels[skillName] || 'aucun';
  const next = cur === 'aucun' ? 'forme' : cur === 'forme' ? 'expert' : 'aucun';
  if (next === 'aucun') delete levels[skillName]; else levels[skillName] = next;
  _saveCaps(charId, { competences: levels });
}

function capAddLangue(charId) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  _capForm('Ajouter une langue', [
    { key: 'nom', label: 'Langue', type: 'text',   value: '', placeholder: 'Commun, Elfique…' },
    { key: 'niv', label: 'Niveau', type: 'select', value: 'courant', options: [['natif', 'Natif'], ['courant', 'Courant'], ['notions', 'Notions']] },
  ], (o) => {
    if (!o.nom) { showNotif('Un nom est requis.', 'error'); return; }
    const list = _arr(c, 'langues').slice(); list.push(o);
    _saveCaps(charId, { langues: list });
  });
}
function capRemoveLangue(charId, idx) {
  charId = charId || STATE.activeChar?.id;
  const c = getCharacterById(charId); if (!c) return;
  const list = _arr(c, 'langues').slice(); list.splice(idx, 1);
  _saveCaps(charId, { langues: list });
}

registerActions({
  capAddResist:       (btn) => capAddResist(btn.dataset.id),
  capPickResist:      (btn) => capPickResist(btn.dataset.t, btn.dataset.cat, btn.dataset.id),
  capRemoveResist:    (btn) => capRemoveResist(btn.dataset.t, btn.dataset.cat, btn.dataset.id),
  capAddCapacite:     (btn) => capAddCapacite(btn.dataset.id),
  capEditCapacite:    (btn) => capEditCapacite(btn.dataset.id, Number(btn.dataset.idx)),
  capRemoveCapacite:  (btn) => capRemoveCapacite(btn.dataset.id, Number(btn.dataset.idx)),
  capCycleSkill:      (btn) => capCycleSkill(btn.dataset.skill, btn.dataset.id),
  capAddLangue:       (btn) => capAddLangue(btn.dataset.id),
  capRemoveLangue:    (btn) => capRemoveLangue(btn.dataset.id, Number(btn.dataset.idx)),
});
