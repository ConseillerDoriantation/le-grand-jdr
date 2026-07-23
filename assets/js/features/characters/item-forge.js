// ══════════════════════════════════════════════════════════════════════════════
// ITEM-FORGE.JS — Création d'objets par le joueur (et le MJ) depuis la fiche.
//
// Permet de forger un objet « maison » sans passer par la boutique : arme,
// armure, accessoire ou objet. Les champs proposés suivent les RÈGLES de
// l'aventure courante (formats d'armes, emplacements d'équipement, types
// d'armure, raretés) — rien n'est codé en dur. L'objet est ajouté directement
// à l'inventaire du personnage (source: 'custom') → aucune surface Firestore
// nouvelle, la garde d'écriture du perso couvre déjà propriétaire + MJ.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { trySave } from '../../shared/crud.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { buildRaretePicker, loadRarities } from '../../shared/rarity.js';
import { getCharacterById } from '../../shared/character-state.js';
import { loadEquipmentSlots, getEquipmentItemOptions } from '../../shared/equipment-slots.js';
import { loadWeaponFormats } from '../../shared/weapon-formats.js';
import { loadArmorSetSettings, getArmorTypeOptions } from '../../shared/armor-set-settings.js';
import { ITEM_STATS } from '../shop-item-stats.js';

const FORGE_CATS = [
  { id: 'arme',   label: 'Arme',       icon: '⚔️' },
  { id: 'armure', label: 'Armure',     icon: '🛡️' },
  { id: 'bijou',  label: 'Accessoire', icon: '💍' },
  { id: 'objet',  label: 'Objet',      icon: '📦' },
];
const DERIVED_BONUSES = [
  ['caBonus', 'CA'], ['pvMaxBonus', 'PV'], ['pmMaxBonus', 'PM'],
  ['vitesseBonus', 'Vit.'], ['initiativeBonus', 'Init.'],
];

let _actionsBound = false;
let _forge = null;

function _blankDraft() {
  return {
    nom: '', rarete: 0, description: '',
    // arme
    format: '', degats: '', degatsStats: [], toucherStat: '', portee: '', traits: '',
    // armure / accessoire
    slotArmure: '', typeArmure: '', ca: '', slotBijou: '',
    // bonus (stats + dérivés)
    for: '', dex: '', in: '', sa: '', co: '', ch: '',
    caBonus: '', pvMaxBonus: '', pmMaxBonus: '', vitesseBonus: '', initiativeBonus: '',
    // objet
    type: '', quantite: 1,
  };
}

const _opt = (value, label, sel) =>
  `<option value="${_esc(value)}" ${String(sel) === String(value) ? 'selected' : ''}>${_esc(label)}</option>`;

// Pastilles de stat : multi (dégâts) ou choix unique (toucher).
function _statChips(action, isOn) {
  const kind = action === '_forgeToucherPick' ? 'touch' : 'dmg';
  return `<div class="forge-chips">` + ITEM_STATS.map(s =>
    `<button type="button" class="forge-chip forge-chip--${kind} ${isOn(s.key) ? 'is-on' : ''}" data-action="${action}" data-stat="${s.key}">${s.short}</button>`
  ).join('') + `</div>`;
}

// ── Briques de champ ─────────────────────────────────────────────────────────
const _fRow = (label, inner) => `<label class="forge-field"><span>${label}</span>${inner}</label>`;
const _section = (title, inner) => `<section class="forge-sec"><h4 class="forge-sec-t">${title}</h4>${inner}</section>`;
const _row2 = (a, b) => `<div class="forge-row2">${a}${b}</div>`;
const _fText = (f, ph = '') =>
  `<input class="input-field" data-forge-field="${f}" value="${_esc(_forge.draft[f] ?? '')}" placeholder="${_esc(ph)}">`;
const _fNum = (f, ph = '') =>
  `<input class="input-field" type="number" data-forge-field="${f}" value="${_esc(_forge.draft[f] ?? '')}" placeholder="${_esc(ph)}">`;
const _fArea = (f) =>
  `<textarea class="input-field" data-forge-field="${f}" rows="2" placeholder="Description, effet…">${_esc(_forge.draft[f] || '')}</textarea>`;
const _fSelect = (f, optionsHtml) => `<select class="input-field" data-forge-field="${f}">${optionsHtml}</select>`;
const _advanced = (title, inner) => `<details class="forge-adv"><summary>${title}</summary>${inner}</details>`;

function _statBonusGrid() {
  return `<div class="forge-grid forge-grid--6">` + ITEM_STATS.map(s =>
    `<label class="forge-mini"><span>${s.short}</span>` +
    `<input class="input-field" type="number" data-forge-field="${s.store}" value="${_esc(_forge.draft[s.store] || '')}" placeholder="0"></label>`
  ).join('') + `</div>`;
}
function _derivedBonusGrid() {
  return `<div class="forge-grid forge-grid--5">` + DERIVED_BONUSES.map(([k, l]) =>
    `<label class="forge-mini"><span>${l}</span>` +
    `<input class="input-field" type="number" data-forge-field="${k}" value="${_esc(_forge.draft[k] || '')}" placeholder="0"></label>`
  ).join('') + `</div>`;
}

// Emplacement : liste déroulante des catégories de l'aventure (garantit
// l'équipabilité) ; repli en champ libre si l'aventure n'en définit aucune.
function _slotField(field, options) {
  if (options.length) {
    return _fSelect(field, `<option value="">—</option>` +
      options.map(v => _opt(v, v, _forge.draft[field])).join(''));
  }
  return _fText(field, 'Ex. Torse, Anneau…');
}

function _catBody() {
  const d = _forge.draft, cat = _forge.cat;
  const identity = _section('Identité',
    _row2(
      _fRow('Nom', _fText('nom', 'Nom de l’objet')),
      _fRow('Rareté', buildRaretePicker('forge', d.rarete)),
    ));

  if (cat === 'arme') {
    const formatOpts = `<option value="">—</option>` +
      _forge.formats.map(fm => _opt(fm.label, fm.label, d.format)).join('');
    return identity +
      _section('Combat',
        _fRow('Format', _fSelect('format', formatOpts)) +
        _row2(
          _fRow('Dégâts', _fText('degats', 'Ex. 1d8')),
          _fRow('Portée', _fText('portee', 'Ex. 1, 18/54…')),
        ) +
        _fRow('Stats de dégâts', _statChips('_forgeStatToggle', k => d.degatsStats.includes(k))) +
        _fRow('Stat de toucher', _statChips('_forgeToucherPick', k => d.toucherStat === k))) +
      _section('Détails',
        _fRow('Traits', _fText('traits', 'Séparés par des virgules')) +
        _advanced('Bonus de stats', _statBonusGrid()) +
        _fRow('Description', _fArea('description')));
  }

  if (cat === 'armure') {
    return identity +
      _section('Protection',
        _row2(
          _fRow('Emplacement', _slotField('slotArmure', _forge.armorSlots)),
          _fRow('Type d’armure', `<input class="input-field" data-forge-field="typeArmure" list="forge-armor-types" value="${_esc(d.typeArmure || '')}" placeholder="Ex. Légère, Lourde…">`),
        ) +
        _fRow('CA', _fNum('ca', '0'))) +
      _section('Bonus & détails',
        _advanced('Bonus de stats', _statBonusGrid()) +
        _advanced('Bonus dérivés', _derivedBonusGrid()) +
        _fRow('Description', _fArea('description'))) +
      `<datalist id="forge-armor-types">${_forge.armorTypes.map(t => `<option value="${_esc(t)}">`).join('')}</datalist>`;
  }

  if (cat === 'bijou') {
    return identity +
      _section('Accessoire', _fRow('Emplacement', _slotField('slotBijou', _forge.accSlots))) +
      _section('Bonus & détails',
        _advanced('Bonus de stats', _statBonusGrid()) +
        _advanced('Bonus dérivés', _derivedBonusGrid()) +
        _fRow('Description', _fArea('description')));
  }

  // objet
  return identity +
    _section('Objet',
      _row2(
        _fRow('Type', _fText('type', 'Ex. Potion, Matériau…')),
        _fRow('Quantité', _fNum('quantite', '1')),
      ) +
      _fRow('Description', _fArea('description')));
}

function _renderForge() {
  const tabs = FORGE_CATS.map(c =>
    `<button type="button" class="forge-tab ${_forge.cat === c.id ? 'is-active' : ''}" data-action="_forgeTab" data-cat="${c.id}">${c.icon} ${c.label}</button>`
  ).join('');
  const body = `
    <div class="forge">
      <div class="forge-tabs">${tabs}</div>
      <div class="forge-body">${_catBody()}</div>
      <div class="forge-actions">
        <button class="btn btn-outline btn-sm" data-action="_forgeClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_forgeSave">Créer l’objet</button>
      </div>
    </div>`;
  openModal('🛠️ Créer un objet', body, { subtitle: 'Défini selon les règles de cette aventure' });
}

// Relit les champs présents dans le DOM vers le brouillon (avant un changement
// d'onglet ou l'enregistrement) → aucun handler par frappe.
function _syncDraftFromDom() {
  if (!_forge) return;
  document.querySelectorAll('[data-forge-field]').forEach(el => {
    _forge.draft[el.dataset.forgeField] = el.value;
  });
  // Le sélecteur d'étoiles (rarity.js) écrit dans un input caché #forge-rarete.
  const rar = document.getElementById('forge-rarete');
  if (rar) _forge.draft.rarete = parseInt(rar.value) || 0;
}

function _pickStatBonuses(d) {
  const out = {};
  ITEM_STATS.forEach(s => { const v = parseInt(d[s.store]) || 0; if (v) out[s.store] = v; });
  return out;
}
function _pickDerivedBonuses(d) {
  const out = {};
  DERIVED_BONUSES.forEach(([k]) => { const v = parseInt(d[k]) || 0; if (v) out[k] = v; });
  return out;
}
function _parseTraits(raw) {
  return String(raw || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 12);
}

function _buildItem() {
  const d = _forge.draft, cat = _forge.cat;
  const base = {
    nom: String(d.nom || '').trim(),
    rarete: parseInt(d.rarete) || 0,
    description: String(d.description || '').trim(),
    source: 'custom',
    createdBy: STATE.user?.uid || '',
  };

  if (cat === 'arme') {
    const stats = (d.degatsStats || []).filter(Boolean);
    return {
      ...base, template: 'arme',
      format: d.format || '',
      degats: String(d.degats || '').trim(),
      degatsStats: stats,
      degatsStat: stats[0] || '',
      toucherStat: d.toucherStat || '',
      statAttaque: d.toucherStat || stats[0] || '',
      portee: String(d.portee || '').trim(),
      traits: _parseTraits(d.traits),
      ..._pickStatBonuses(d),
    };
  }
  if (cat === 'armure') {
    return {
      ...base, template: 'armure',
      slotArmure: d.slotArmure || '',
      typeArmure: String(d.typeArmure || '').trim(),
      ca: parseInt(d.ca) || 0,
      ..._pickStatBonuses(d), ..._pickDerivedBonuses(d),
    };
  }
  if (cat === 'bijou') {
    return {
      ...base, template: 'bijou',
      slotBijou: d.slotBijou || '',
      ..._pickStatBonuses(d), ..._pickDerivedBonuses(d),
    };
  }
  return { ...base, type: String(d.type || '').trim() };
}

async function _saveForge() {
  if (!_forge) return;
  _syncDraftFromDom();
  const c = getCharacterById(_forge.charId) || STATE.activeChar;
  if (!c) { showNotif('Personnage introuvable.', 'error'); return; }

  const item = _buildItem();
  if (!item.nom) { showNotif('Donne un nom à ton objet.', 'error'); return; }
  if (_forge.cat === 'arme' && !item.degats) { showNotif('Indique les dégâts (ex. 1d8).', 'error'); return; }
  if (_forge.cat === 'armure' && !item.slotArmure) { showNotif('Choisis un emplacement d’armure.', 'error'); return; }
  if (_forge.cat === 'bijou' && !item.slotBijou) { showNotif('Choisis un emplacement d’accessoire.', 'error'); return; }

  const count = _forge.cat === 'objet'
    ? Math.max(1, Math.min(999, parseInt(_forge.draft.quantite) || 1))
    : 1;
  const entries = Array.from({ length: count }, () => ({ ...item, qte: 1 }));
  const inv = [...(Array.isArray(c.inventaire) ? c.inventaire : []), ...entries];

  if (await trySave('characters', c.id, { inventaire: inv })) {
    c.inventaire = inv;
    if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
    const stChar = (STATE.characters || []).find(x => x.id === c.id);
    if (stChar) stChar.inventaire = inv;
    closeModal();
    showNotif(count > 1
      ? `×${count} « ${item.nom} » ajoutés à l’inventaire.`
      : `« ${item.nom} » créé et ajouté à l’inventaire.`, 'success');
    charSession.renderSheet?.(c, 'inventaire');
  }
}

function _ensureForgeActions() {
  if (_actionsBound) return;
  _actionsBound = true;
  registerActions({
    _forgeTab: (btn) => { _syncDraftFromDom(); _forge.cat = btn.dataset.cat; _renderForge(); },
    _forgeStatToggle: (btn) => {
      _syncDraftFromDom();
      const key = btn.dataset.stat;
      const arr = _forge.draft.degatsStats;
      const i = arr.indexOf(key);
      if (i >= 0) arr.splice(i, 1); else arr.push(key);
      _renderForge();
    },
    _forgeToucherPick: (btn) => {
      _syncDraftFromDom();
      const key = btn.dataset.stat;
      _forge.draft.toucherStat = _forge.draft.toucherStat === key ? '' : key;
      _renderForge();
    },
    _forgeClose: () => closeModal(),
    _forgeSave: () => _saveForge(),
  });
}

export async function openCreateItemModal(charId) {
  const c = charId ? getCharacterById(charId) : STATE.activeChar;
  if (!c) { showNotif('Aucun personnage actif.', 'error'); return; }
  const canEdit = charSession.getCanEditChar?.() ?? STATE.isAdmin;
  if (!canEdit) { showNotif('Tu ne peux pas modifier ce personnage.', 'error'); return; }

  _ensureForgeActions();
  const [, formats] = await Promise.all([
    loadEquipmentSlots().catch(() => null),
    loadWeaponFormats().catch(() => []),
    loadArmorSetSettings().catch(() => null),
    loadRarities().catch(() => null),
  ]);
  // Les règles de l'aventure sont un CONFORT : si un de ces documents manque ou
  // est refusé en lecture, la forge doit quand même s'ouvrir (listes vides)
  // plutôt que d'échouer sans rien afficher.
  const safe = (read, fallback = []) => {
    try {
      const out = read();
      return Array.isArray(out) ? out : fallback;
    } catch (err) {
      console.warn('[forge] règle d’aventure illisible', err);
      return fallback;
    }
  };
  _forge = {
    charId: c.id,
    cat: 'arme',
    draft: _blankDraft(),
    formats: Array.isArray(formats) ? formats : [],
    armorSlots: safe(() => getEquipmentItemOptions('armor')),
    accSlots: safe(() => getEquipmentItemOptions('accessory')),
    armorTypes: safe(() => getArmorTypeOptions()),
  };
  _renderForge();
}
