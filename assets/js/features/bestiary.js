// ══════════════════════════════════════════════════════════════════════════════
// BESTIARY.JS — Le Bestiaire
// ✓ Admin : CRUD créatures, image+crop, attaques/traits/butins dynamiques
// ✓ Joueur : galerie + suivi personnel (PV/PM live, notes)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, loadChars, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { attachDropAndCrop } from '../shared/image-crop.js';

// ── État local ────────────────────────────────────────────────────────────────
let _bstCropper = null;
let _creatures  = [];
let _tracker    = {}; // { [creatureId]: { pvActuel, pmActuel, notes, deductions:{pv,pm,ca,for,...} } }
let _damageTypes = null;
let _searchVal  = '';
let _filterType = ''; // filtre par type de créature
let _filterRang  = ''; // filtre par rang (classique, elite, boss)
let _activeId   = null; // créature ouverte dans le panneau
let _bestiaireId = 'main'; // id du bestiaire actif (admin peut switcher)
let _viewAsUid   = null; // admin : voir le bestiaire d'un joueur (null = vue MJ)
let _playersList = []; // [{ uid, pseudo }] — peuplé côté admin

// Vue "MJ" effective : admin ET pas en train de consulter un joueur.
// Quand l'admin bascule sur un joueur, on rend exactement comme côté joueur
// pour pouvoir voir/modifier ses estimations.
function _isViewingPlayer() {
  return STATE.isAdmin && _viewAsUid && _viewAsUid !== STATE.user?.uid;
}
function _isAdminView() {
  return STATE.isAdmin && !_isViewingPlayer();
}

const RANG_STYLE = {
  classique: { label:'Classique', color:'#94a3b8', glow:'rgba(148,163,184,0.18)', border:'rgba(148,163,184,0.40)', bg:'rgba(148,163,184,0.10)' },
  elite:     { label:'Élite',     color:'#e8b84b', glow:'rgba(232,184,75,0.22)',  border:'rgba(232,184,75,0.40)',  bg:'rgba(232,184,75,0.12)'  },
  boss:      { label:'Boss',      color:'#ff5a7e', glow:'rgba(255,90,126,0.24)',  border:'rgba(255,90,126,0.40)',  bg:'rgba(255,90,126,0.12)'  },
};

function _beastSearchText(c = {}) {
  const attaques = Array.isArray(c.attaques)
    ? c.attaques.map(a => [a.nom, a.toucher, a.degats, a.portee, a.description].filter(Boolean).join(' ')).join(' ')
    : '';
  const traits = Array.isArray(c.traits)
    ? c.traits.map(t => [t.nom, t.description].filter(Boolean).join(' ')).join(' ')
    : '';
  const butins = Array.isArray(c.butins)
    ? c.butins.map(b => [b.nom, b.quantite, b.chance].filter(Boolean).join(' ')).join(' ')
    : '';

  return _norm([
    c.nom,
    c.type,
    c.environnement,
    c.description,
    c.emoji,
    c.rang,
    c.niveau,
    c.dangerositeXp,
    attaques,
    traits,
    butins,
  ].filter(v => v !== undefined && v !== null && v !== '').join(' '));
}

function _beastMatchesFilters(c, { search = _searchVal, type = _filterType, rang = _filterRang } = {}) {
  const q = _norm(search);
  const fType = _norm(type);
  const fRang = _norm(rang);
  const matchSearch = !q || _searchIncludes(_beastSearchText(c), search);
  const matchType = !fType || _norm(c.type) === fType;
  const matchRang = !fRang || _norm(c.rang || 'classique') === fRang;
  return matchSearch && matchType && matchRang;
}

// Métadonnées visuelles communes aux 4 catégories de relation aux dégâts.
// Palette neutre alignée avec DMG_INTERACTIONS du VTT : aucune teinte ne
// suggère "bon / mauvais" pour le joueur attaquant.
const DMG_RELATIONS = [
  { key: 'absorptions', label: 'Absorptions', short: 'Soin',       icon: '💚', color: '#b47fff' },
  { key: 'immunites',   label: 'Immunités',   short: 'Aucun dégât', icon: '🚫', color: '#94a3b8' },
  { key: 'resistances', label: 'Résistances', short: '½ dégâts',  icon: '🛡️', color: '#4f8cff' },
  { key: 'faiblesses',  label: 'Faiblesses',  short: '×2 dégâts',  icon: '💢', color: '#f59e0b' },
];

function _damageTypeBadge(typeId, types, color) {
  const type = (types || []).find(t => t.id === typeId);
  const label = type ? `${type.icon||''} ${_esc(type.label)}` : _esc(typeId);
  return `<span style="font-size:.72rem;padding:.18rem .5rem;border-radius:999px;border:1px solid ${color};color:${color};background:${color}1a">${label}</span>`;
}

function _renderRelationCard(rel, ids, types) {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  return `<div style="display:flex;flex-direction:column;gap:.35rem;padding:.5rem .6rem;
    border:1px solid ${rel.color}33;background:${rel.color}10;border-radius:10px;border-left:3px solid ${rel.color}">
    <div style="display:flex;align-items:center;gap:.4rem">
      <span style="font-size:.9rem">${rel.icon}</span>
      <span style="font-size:.74rem;font-weight:700;color:${rel.color};letter-spacing:.02em">${rel.label}</span>
      <span style="font-size:.62rem;color:var(--text-dim);margin-left:auto">${rel.short}</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.3rem">
      ${ids.map(id => _damageTypeBadge(id, types, rel.color)).join('')}
    </div>
  </div>`;
}

function _renderDamageProfile(beast, types) {
  if (!beast) return '';
  const cards = DMG_RELATIONS.map(rel => {
    const ids = Array.isArray(beast[rel.key]) ? beast[rel.key] : [];
    if (!ids.length) return null;
    const tags = ids.map(id => {
      const type = (types||[]).find(t => t.id === id);
      const label = type ? `${type.icon||''} ${_esc(type.label)}` : _esc(id);
      return `<span class="bst-dmg-tag" style="border-color:${rel.color}55;color:${rel.color}">${label}</span>`;
    }).join('');
    return `<div class="bst-dmg-card" style="border-color:${rel.color}33;border-left-color:${rel.color}">
      <div class="bst-dmg-head">
        <span class="bst-dmg-icon">${rel.icon}</span>
        <span class="bst-dmg-name" style="color:${rel.color}">${rel.label}</span>
        <span class="bst-dmg-rule">${rel.short}</span>
      </div>
      <div class="bst-dmg-tags">${tags}</div>
    </div>`;
  }).filter(Boolean);
  if (!cards.length) return '';
  return `<div class="bst-section">
    <div class="bst-section-title">🛡️ Relations aux dégâts</div>
    <div class="bst-dmg-grid">${cards.join('')}</div>
  </div>`;
}

/** Mini-récap pictogrammes pour la card admin (compact). */
function _renderDamageProfileMini(beast) {
  if (!beast) return '';
  const parts = DMG_RELATIONS
    .map(rel => {
      const n = (beast[rel.key] || []).length;
      if (!n) return null;
      return `<span title="${rel.label} (${n})" style="display:inline-flex;align-items:center;gap:1px;font-size:.6rem;color:${rel.color};background:${rel.color}1a;border:1px solid ${rel.color}55;padding:0 4px;border-radius:6px">${rel.icon}<strong style="font-size:.55rem">${n}</strong></span>`;
    })
    .filter(Boolean);
  if (!parts.length) return '';
  return `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:.3rem">${parts.join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉDITION INLINE — Panneau admin (auto-save Firestore)
// ══════════════════════════════════════════════════════════════════════════════
const _bstPending = {};
let _bstSaveTimer = null;

function _bstFlushSaves() {
  const col = window._bstCurrentCol || 'bestiary';
  const ids = Object.keys(_bstPending);
  if (!ids.length) return;
  ids.forEach(id => {
    const patch = _bstPending[id];
    delete _bstPending[id];
    updateInCol(col, id, patch)
      .then(() => {
        const idx = _creatures.findIndex(c => c.id === id);
        if (idx >= 0) Object.assign(_creatures[idx], patch);
      })
      .catch(notifySaveError);
  });
}

function _bstQueueSave(id, patch) {
  _bstPending[id] = { ...(_bstPending[id] || {}), ...patch };
  clearTimeout(_bstSaveTimer);
  _bstSaveTimer = setTimeout(_bstFlushSaves, 400);
}

// Auto-save générique (texte / select)
window._bstUpdate = (id, field, val) => _bstQueueSave(id, { [field]: val });
window._bstUpdateNum = (id, field, val) => _bstQueueSave(id, { [field]: parseInt(val) || 0 });

// Nom : sync visuel des cartes et du hero
window._bstUpdateNom = (id, val) => {
  _bstQueueSave(id, { nom: val });
  document.querySelectorAll(`.bst-card[data-beast-id="${id}"] .bst-card-name`)
    .forEach(el => el.textContent = val || '?');
};

// Caracs : sauve + recalcule le modificateur affiché
window._bstUpdateCarac = (id, key, val) => {
  _bstQueueSave(id, { [key]: parseInt(val) || 0 });
  const n = parseInt(val);
  let txt = '', cls = 'zero';
  if (!isNaN(n)) {
    const m = Math.floor((n - 10) / 2);
    txt = m >= 0 ? `+${m}` : `${m}`;
    cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
  }
  const modEl = document.querySelector(`[data-bst-mod="${id}-${key}"]`);
  if (modEl) { modEl.textContent = txt; modEl.className = `bst-carac-mod ${cls}`; }
};

// Changement de rang : sauve + met à jour cartes + panneau (couleurs + label)
window._bstSelectRangPanel = (id, rang) => {
  _bstQueueSave(id, { rang });
  const rs = RANG_STYLE[rang] || RANG_STYLE.classique;
  document.querySelectorAll(`.bst-card[data-beast-id="${id}"]`).forEach(card => {
    card.style.setProperty('--rang-c', rs.color);
    card.style.setProperty('--rang-glow', rs.glow);
    const rangEl = card.querySelector('.bst-card-rang');
    if (rangEl) rangEl.textContent = rs.label;
  });
  const panel = document.querySelector('.bst-panel');
  if (panel) {
    panel.style.setProperty('--rang-c', rs.color);
    panel.style.setProperty('--rang-glow', rs.glow);
  }
  document.querySelectorAll('[data-bst-rang-btn]').forEach(btn => {
    const r = btn.dataset.bstRangBtn;
    const rst = RANG_STYLE[r] || RANG_STYLE.classique;
    const active = r === rang;
    btn.classList.toggle('active', active);
    btn.style.color       = active ? rst.color : '';
    btn.style.borderColor = active ? rst.color : '';
    btn.style.background  = active ? `${rst.color}1a` : '';
  });
};

// Toggle relation aux dégâts
window._bstToggleDmg = (id, rel, typeId) => {
  const c = _creatures.find(x => x.id === id);
  if (!c) return;
  const set = new Set(Array.isArray(c[rel]) ? c[rel] : []);
  if (set.has(typeId)) set.delete(typeId); else set.add(typeId);
  c[rel] = [...set];
  _bstQueueSave(id, { [rel]: c[rel] });
  const chip = document.querySelector(`[data-dmg-chip="${id}-${rel}-${typeId}"]`);
  if (chip) {
    const active = set.has(typeId);
    const meta = DMG_RELATIONS.find(r => r.key === rel);
    chip.classList.toggle('active', active);
    chip.style.color       = active ? meta.color : '';
    chip.style.borderColor = active ? meta.color : '';
    chip.style.background  = active ? `${meta.color}1a` : '';
  }
};

// Lecture + save d'un tableau dynamique (attaques / traits / butins) depuis le panneau
window._bstSaveArr = (id, type) => {
  const container = document.getElementById(`bst-p-${type}-${id}`);
  if (!container) return;
  const rows = [...container.querySelectorAll('.bst-p-row')];
  let arr;
  if (type === 'attaques') {
    arr = rows.map(row => ({
      nom:          row.querySelector('[data-f=nom]')?.value?.trim()     || '',
      toucher:      row.querySelector('[data-f=toucher]')?.value?.trim() || '',
      degats:       row.querySelector('[data-f=degats]')?.value?.trim()  || '',
      portee:       row.querySelector('[data-f=portee]')?.value?.trim()  || '',
      damageTypeId: row.querySelector('[data-f=dmgType]')?.value         || '',
      description:  row.querySelector('[data-f=desc]')?.value?.trim()    || '',
    })).filter(a => a.nom || a.degats || a.description);
  } else if (type === 'traits') {
    arr = rows.map(row => ({
      nom:         row.querySelector('[data-f=nom]')?.value?.trim()  || '',
      description: row.querySelector('[data-f=desc]')?.value?.trim() || '',
    })).filter(t => t.nom || t.description);
  } else {
    arr = rows.map(row => ({
      nom:      row.querySelector('[data-f=nom]')?.value?.trim()    || '',
      quantite: row.querySelector('[data-f=qte]')?.value?.trim()    || '',
      chance:   row.querySelector('[data-f=chance]')?.value?.trim() || '',
    })).filter(b => b.nom);
  }
  _bstQueueSave(id, { [type]: arr });
  // Met à jour le compteur en titre
  const countEl = document.querySelector(`[data-bst-count="${id}-${type}"]`);
  if (countEl) countEl.textContent = arr.length;
};

window._bstAddPanelRow = (id, type) => {
  const container = document.getElementById(`bst-p-${type}-${id}`);
  if (!container) return;
  const i = container.querySelectorAll('.bst-p-row').length;
  const html = type === 'attaques' ? _panelAttackRow({}, id, i)
             : type === 'traits'   ? _panelTraitRow({}, id, i)
             :                       _panelButinRow({}, id, i);
  const tpl = document.createElement('div');
  tpl.innerHTML = html.trim();
  container.appendChild(tpl.firstElementChild);
};

window._bstRemovePanelRow = (id, type, btn) => {
  const row = btn?.closest?.('.bst-p-row');
  if (!row) return;
  row.remove();
  window._bstSaveArr(id, type);
};

// Row renderers (panneau)
function _panelAttackRow(a = {}, id, i) {
  const types = window._bstDamageTypes || _damageTypes || [];
  return `<div class="bst-p-row">
    <div class="bst-p-row-grid bst-p-row-grid-2">
      <input class="bst-p-input" data-f="nom" placeholder="Nom de l'attaque" value="${_esc(a.nom||'')}"
        oninput="window._bstSaveArr('${id}','attaques')">
      <select class="bst-p-input" data-f="dmgType"
        onchange="window._bstSaveArr('${id}','attaques')">
        <option value="">Type de dégâts</option>
        ${types.map(t => `<option value="${t.id}"${a.damageTypeId===t.id?' selected':''}>${t.icon||''} ${_esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div class="bst-p-row-grid bst-p-row-grid-3">
      <input class="bst-p-input" data-f="toucher" placeholder="🎯 Toucher" value="${_esc(a.toucher||'')}"
        oninput="window._bstSaveArr('${id}','attaques')">
      <input class="bst-p-input" data-f="degats" placeholder="⚔️ Dégâts" value="${_esc(a.degats||'')}"
        oninput="window._bstSaveArr('${id}','attaques')">
      <input class="bst-p-input" data-f="portee" placeholder="📏 Portée" value="${_esc(a.portee||'')}"
        oninput="window._bstSaveArr('${id}','attaques')">
    </div>
    <div class="bst-p-row-grid" style="grid-template-columns:1fr auto">
      <input class="bst-p-input" data-f="desc" placeholder="Description / effet…" value="${_esc(a.description||'')}"
        oninput="window._bstSaveArr('${id}','attaques')">
      <button class="bst-p-row-remove" onclick="window._bstRemovePanelRow('${id}','attaques',this)" title="Retirer">✕</button>
    </div>
  </div>`;
}

function _panelTraitRow(t = {}, id, i) {
  return `<div class="bst-p-row">
    <div class="bst-p-row-grid" style="grid-template-columns:1fr auto">
      <input class="bst-p-input" data-f="nom" placeholder="Nom du trait" value="${_esc(t.nom||'')}"
        oninput="window._bstSaveArr('${id}','traits')">
      <button class="bst-p-row-remove" onclick="window._bstRemovePanelRow('${id}','traits',this)" title="Retirer">✕</button>
    </div>
    <input class="bst-p-input" data-f="desc" placeholder="Description…" value="${_esc(t.description||'')}"
      oninput="window._bstSaveArr('${id}','traits')">
  </div>`;
}

function _panelButinRow(b = {}, id, i) {
  return `<div class="bst-p-row">
    <div class="bst-p-row-grid" style="grid-template-columns:1fr 80px 80px auto">
      <input class="bst-p-input" data-f="nom" placeholder="Nom de l'objet" value="${_esc(b.nom||'')}"
        oninput="window._bstSaveArr('${id}','butins')">
      <input class="bst-p-input" data-f="qte" placeholder="Qté" value="${_esc(b.quantite||'')}"
        oninput="window._bstSaveArr('${id}','butins')">
      <input class="bst-p-input" data-f="chance" placeholder="Chance" value="${_esc(b.chance||'')}"
        oninput="window._bstSaveArr('${id}','butins')">
      <button class="bst-p-row-remove" onclick="window._bstRemovePanelRow('${id}','butins',this)" title="Retirer">✕</button>
    </div>
  </div>`;
}

// Matrice de relations aux dégâts (panneau, version chips compacte)
function _renderDamageMatrixPanel(c, types) {
  return `<div class="bst-section">
    <div class="bst-section-title">🛡️ Relations aux dégâts</div>
    <div class="bst-dmg-edit">
      ${DMG_RELATIONS.map(rel => {
        const active = Array.isArray(c[rel.key]) ? c[rel.key] : [];
        return `<div class="bst-dmg-edit-row" style="border-left:3px solid ${rel.color};background:${rel.color}08">
          <div class="bst-dmg-edit-head">
            <span class="bst-dmg-icon">${rel.icon}</span>
            <span class="bst-dmg-name" style="color:${rel.color}">${rel.label}</span>
            <span class="bst-dmg-rule">${rel.short}</span>
          </div>
          <div class="bst-dmg-edit-chips">
            ${(types || []).map(t => {
              const isActive = active.includes(t.id);
              return `<button type="button" data-dmg-chip="${c.id}-${rel.key}-${t.id}"
                class="bst-dmg-chip${isActive?' active':''}"
                style="${isActive?`color:${rel.color};border-color:${rel.color};background:${rel.color}1a`:''}"
                onclick="window._bstToggleDmg('${c.id}','${rel.key}','${t.id}')">
                ${t.icon||''} ${_esc(t.label)}
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/**
 * Matrice unique : lignes = types de dégâts, colonnes = catégories.
 * Vue compacte qui rend les conflits (un type coché dans 2 catégories)
 * immédiatement visibles sur une même ligne.
 */
function _renderDamageTypeMatrix(beast, types) {
  const rels = DMG_RELATIONS;

  const headerCells = rels.map(rel =>
    `<div style="text-align:center;padding:.5rem .25rem;font-size:.66rem;font-weight:700;color:${rel.color};
      border-left:1px solid var(--border);background:${rel.color}10">
      <div style="font-size:1rem;line-height:1">${rel.icon}</div>
      <div style="margin-top:.2rem;letter-spacing:.02em">${_esc(rel.label.replace(/s$/, '.'))}</div>
      <div style="font-size:.55rem;font-weight:400;color:var(--text-dim);margin-top:.05rem">${rel.short}</div>
    </div>`
  ).join('');

  const bodyCells = types.map(t => {
    const cells = rels.map(rel => {
      const arr = Array.isArray(beast?.[rel.key]) ? beast[rel.key] : [];
      const checked = arr.includes(t.id);
      return `<label data-bst-cell="${t.id}" data-bst-rel="${rel.key}"
        style="display:flex;align-items:center;justify-content:center;cursor:pointer;
               border-top:1px solid var(--border);border-left:1px solid var(--border);
               background:${checked ? `${rel.color}22` : 'transparent'};transition:background .12s;padding:.4rem .25rem">
        <input type="checkbox" name="bst-${rel.key}" value="${t.id}" ${checked?'checked':''}
          style="accent-color:${rel.color};margin:0;width:15px;height:15px;cursor:pointer"
          onchange="window._bstSyncDmgConflicts()">
      </label>`;
    }).join('');
    return `<div data-bst-row="${t.id}"
        style="display:flex;align-items:center;gap:.45rem;padding:.4rem .65rem;font-size:.78rem;color:var(--text);
               border-top:1px solid var(--border);min-width:0">
        <span style="font-size:.95rem;flex-shrink:0">${t.icon||''}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(t.label)}</span>
        <span data-bst-row-warn="${t.id}" style="display:none;margin-left:auto;font-size:.62rem;color:#f59e0b;font-weight:700"
          title="Ce type est sélectionné dans plusieurs catégories">⚠</span>
      </div>${cells}`;
  }).join('');

  return `<div data-bst-matrix style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg-elevated)">
    <div style="display:grid;grid-template-columns:minmax(140px,1.6fr) repeat(${rels.length}, minmax(56px,1fr));align-items:stretch">
      <div style="padding:.5rem .65rem;font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim)">Type</div>
      ${headerCells}
      ${bodyCells}
    </div>
  </div>`;
}

/** Met en évidence les types de dégâts cochés dans plusieurs catégories (matrice). */
window._bstSyncDmgConflicts = () => {
  const matrix = document.querySelector('[data-bst-matrix]');
  if (!matrix) return;
  const counts = new Map();
  matrix.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
    counts.set(cb.value, (counts.get(cb.value) || 0) + 1);
  });
  matrix.querySelectorAll('[data-bst-cell]').forEach(cell => {
    const cb = cell.querySelector('input[type=checkbox]');
    const checked = !!cb?.checked;
    const rel = DMG_RELATIONS.find(r => r.key === cell.dataset.bstRel);
    const isConflict = checked && (counts.get(cell.dataset.bstCell) || 0) > 1;
    cell.style.background = isConflict ? 'rgba(245,158,11,.22)'
                          : checked    ? `${rel?.color || 'var(--gold)'}22`
                                       : 'transparent';
    cell.style.boxShadow = isConflict ? '0 0 0 1px #f59e0b inset' : 'none';
  });
  matrix.querySelectorAll('[data-bst-row-warn]').forEach(warn => {
    const tid = warn.dataset.bstRowWarn;
    warn.style.display = (counts.get(tid) || 0) > 1 ? 'inline' : 'none';
  });
};

function _readDamageTypeSelections(name) {
  return [...document.querySelectorAll(`input[name=bst-${name}]:checked`)].map(el => el.value).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════════
// BANDEAU AVATARS — sélecteur de vue (MJ ↔ joueur)
// ══════════════════════════════════════════════════════════════════════════════
function _avatarTile({ active, ringColor, onClick, imageUrl, fallback, pseudo, charNom }) {
  const ring = active ? ringColor : 'var(--border)';
  const shadow = active ? `0 0 0 2px ${ringColor}33` : 'none';
  const labelColor = active ? ringColor : 'var(--text-dim)';
  return `<button onclick="${onClick}" title="${_esc(pseudo)}${charNom?` — ${_esc(charNom)}`:''}"
    style="display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:.25rem;
    border:none;background:none;cursor:pointer;border-radius:8px;min-width:54px;
    transition:background .12s"
    onmouseover="this.style.background='rgba(255,255,255,.04)'"
    onmouseout="this.style.background='none'">
    <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;
      border:2px solid ${ring};box-shadow:${shadow};
      background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;
      font-weight:700;color:var(--text);font-size:1rem;flex-shrink:0">
      ${imageUrl
        ? `<img src="${imageUrl}" alt="" style="width:100%;height:100%;object-fit:cover">`
        : _esc(fallback)}
    </div>
    <div style="font-size:.62rem;color:${labelColor};max-width:72px;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;font-weight:${active?'700':'400'}">${_esc(pseudo)}</div>
  </button>`;
}

function _renderPlayerAvatars() {
  return `<div style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:flex-start;margin-top:.5rem;
    padding:.4rem .5rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px">
    ${_avatarTile({
      active:    !_viewAsUid,
      ringColor: 'var(--gold)',
      onClick:   `window._bstViewAs('')`,
      imageUrl:  '',
      fallback:  '👑',
      pseudo:    'MJ',
      charNom:   '',
    })}
    <div style="width:1px;align-self:stretch;background:var(--border);margin:0 .15rem"></div>
    ${_playersList.map(p => _avatarTile({
      active:    _viewAsUid === p.uid,
      ringColor: '#4f8cff',
      onClick:   `window._bstViewAs('${p.uid}')`,
      imageUrl:  p.portraitUrl,
      fallback:  p.initial,
      pseudo:    p.pseudo,
      charNom:   p.charNom,
    })).join('')}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderBestiary() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">⏳</div></div>`;

  // Admin : charger la liste des bestiaires disponibles
  if (STATE.isAdmin) {
    const meta = await getDocData('bestiary_meta', 'list');
    const list = meta?.list || [];
    if (!list.find(b => b.id === 'main')) list.unshift({ id:'main', label:'Bestiaire principal' });
    window._bstBestiaireList = list;

    // Liste des joueurs (uid + pseudo) pour la vue "bestiaire d'un joueur".
    // Source primaire : STATE.characters (déjà chargé via la page d'accueil).
    // Fallback : loadChars(null) si on arrive direct au bestiaire.
    let chars = STATE.characters;
    if (!chars || !chars.length) {
      try { chars = await loadChars(null); } catch { chars = []; }
    }
    // Portrait du PJ : même ordre de fallback que le VTT pour la cohérence.
    // Tout est déjà en mémoire (STATE.characters), aucune lecture Firestore en plus.
    const seen = new Map();
    (chars || []).forEach(c => {
      if (!c?.uid || c.uid === STATE.user?.uid) return;
      const pseudo = c.ownerPseudo || c.nom || c.uid;
      const photo  = c.photoURL || c.photo || c.avatar || c.portraitUrl || c.imageUrl || '';
      const existing = seen.get(c.uid);
      // Préférer un PJ qui a une photo, sinon le premier rencontré.
      if (!existing || (!existing.portraitUrl && photo)) {
        seen.set(c.uid, {
          uid:         c.uid,
          pseudo,
          charNom:     c.nom || '',
          portraitUrl: photo,
          initial:     (pseudo || '?').charAt(0).toUpperCase(),
        });
      }
    });
    _playersList = [...seen.values()]
      .sort((a,b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity:'base' }));
  }

  // Charger les créatures du bestiaire actif
  const col = _bestiaireId === 'main' ? 'bestiary' : `bestiary_${_bestiaireId}`;
  _creatures = await loadCollection(col);
  _creatures.sort((a,b) => (a.nom||'').localeCompare(b.nom||''));
  window._bstCurrentCol = col;

  if (!_damageTypes) _damageTypes = await loadDamageTypes();

  // Tracker : MJ peut consulter celui d'un joueur via _viewAsUid
  const trackerUid = _viewAsUid || STATE.user?.uid;
  if (trackerUid) {
    const trackerDoc = await getDocData('bestiary_tracker', trackerUid);
    _tracker = trackerDoc?.data || {};
  } else {
    _tracker = {};
  }

  _render();
}

function _render() {
  const content = document.getElementById('main-content');

  const allTypes = [...new Set(_creatures.map(c => c.type||'').filter(Boolean))].sort();
  const filtered = _creatures.filter(c => _beastMatchesFilters(c));

  // Comptes par rang (total, sans filtre rang)
  const byRang = { classique:0, elite:0, boss:0 };
  _creatures.forEach(c => { const r = c.rang||'classique'; if (byRang[r]!==undefined) byRang[r]++; });

  const ribbonData = [
    { label:'Total',    icon:'🐾', count:_creatures.length, c:'#7eb0ff',              filter:'' },
    { label:'Classique',icon:'◆',  count:byRang.classique,  c:RANG_STYLE.classique.color, filter:'classique' },
    { label:'Élite',    icon:'★',  count:byRang.elite,      c:RANG_STYLE.elite.color,     filter:'elite'     },
    { label:'Boss',     icon:'☠',  count:byRang.boss,       c:RANG_STYLE.boss.color,      filter:'boss'      },
  ];

  const bstList = window._bstBestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  const tabsHtml = STATE.isAdmin ? `
    <div class="bst-tabs">
      ${bstList.map(b => `
        <button class="bst-tab${b.id===_bestiaireId?' active':''}" onclick="window._bstSwitchBestiaire('${b.id}')">
          📜 ${_esc(b.label)}
        </button>`).join('')}
      <button class="bst-tab add" onclick="window._bstCreateBestiaire()">+ Nouveau</button>
    </div>` : '';

  content.innerHTML = `
  <div class="bst-page ${_activeId ? 'has-panel' : 'no-panel'}">

  <!-- ═ HERO ═══════════════════════════════════════════════════════════════ -->
  <div class="bst-hero">
    <div class="bst-hero-row">
      <div class="bst-hero-title-block">
        <div class="bst-eyebrow">Encyclopédie des Créatures</div>
        <h1 class="bst-title">✦ Cartulaire des Bêtes ✦</h1>
        <p class="bst-subtitle">— Ce qui rôde au-delà des cendres —</p>
      </div>
      ${tabsHtml ? `<div>${tabsHtml}</div>` : ''}
    </div>

    <div class="bst-ribbon">
      ${ribbonData.map(r => `
        <div class="bst-ribbon-item${(!r.filter && !_filterRang)||(r.filter && _filterRang===r.filter)?' active':''}"
          style="--c:${r.c}"
          onclick="window._bstSetRang('${r.filter}')">
          <div class="bst-ribbon-icon">${r.icon}</div>
          <div>
            <div class="bst-ribbon-num">${r.count}</div>
            <div class="bst-ribbon-lbl">${r.label}</div>
          </div>
        </div>`).join('')}
    </div>

    ${STATE.isAdmin && _playersList.length ? _renderPlayerAvatars() : ''}
  </div>

  ${_isViewingPlayer() ? `
  <div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 2rem;
    border-bottom:1px solid rgba(79,140,255,.2);background:rgba(79,140,255,.06)">
    <span>👁</span>
    <span style="font-size:.78rem;color:var(--text)">
      Vue du bestiaire de <strong style="color:#4f8cff">${_esc(_playersList.find(p=>p.uid===_viewAsUid)?.pseudo||'?')}</strong>
      — tes modifications sont enregistrées chez ce joueur.
    </span>
    <button onclick="window._bstViewAs('')" style="margin-left:auto;font-size:.7rem;padding:3px 10px;
      border-radius:999px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-dim);cursor:pointer">
      Revenir à la vue MJ
    </button>
  </div>` : ''}

  <!-- ═ CONTROLS ════════════════════════════════════════════════════════════ -->
  <div class="bst-controls-bar">
    <div class="bst-search-wrap">
      <span style="color:var(--text-dim);font-size:.9rem;flex-shrink:0">🔍</span>
      <input type="text" id="bst-search" placeholder="Rechercher…"
        value="${_esc(_searchVal)}"
        oninput="window._bstSearchInput(this.value)"
        style="background:none;border:none;outline:none;color:var(--text);font-size:.8rem;flex:1;min-width:0">
    </div>
    <div class="chip-row">
      <button class="chip${!_filterType?' active':''}" onclick="window._bstSetType('')">Tous</button>
      ${allTypes.map(t => `
        <button class="chip${_norm(_filterType)===_norm(t)?' active':''}"
          onclick="window._bstSetType('${t.replace(/'/g,"\\'")}')">
          ${_esc(t)}
        </button>`).join('')}
    </div>
    ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" style="white-space:nowrap;flex-shrink:0" onclick="openBeastModal()">+ Créature</button>` : ''}
  </div>

  <!-- ═ LAYOUT ═══════════════════════════════════════════════════════════════ -->
  <div class="bst-layout ${_activeId ? 'has-panel' : 'no-panel'}">
    <div class="bst-grid-wrap">
      ${filtered.length === 0 ? `
        <div class="bst-empty">
          <div class="bst-empty-icon">🐉</div>
          <div class="bst-empty-title">${_creatures.length===0 ? 'Aucune créature dans le bestiaire' : 'Aucun résultat'}</div>
          <div class="bst-empty-sub">${_creatures.length===0 ? 'Ajoutez la première créature pour commencer.' : 'Essayez un filtre différent.'}</div>
          ${STATE.isAdmin && _creatures.length===0 ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="openBeastModal()">+ Ajouter la première créature</button>` : ''}
        </div>` : `
        <div class="bst-grid">
          ${filtered.map(c => _renderCard(c)).join('')}
        </div>`}
    </div>

    <div class="bst-panel-slot">
      ${_activeId ? _renderPanel(_creatures.find(c => c.id === _activeId)) : ''}
    </div>
  </div>
  </div>`;
}

// ── Card créature ─────────────────────────────────────────────────────────────
function _renderCard(c) {
  const isActive = c.id === _activeId;
  const rang     = c.rang || 'classique';
  const rs       = RANG_STYLE[rang] || RANG_STYLE.classique;
  const track    = _tracker[c.id] || {};

  const pvMax    = _isAdminView() ? (parseInt(c.pvMax)||0) : 0;
  const pvActuel = track.pvActuel !== undefined ? parseInt(track.pvActuel) : pvMax;
  const pvPct    = pvMax > 0 ? Math.max(0, Math.min(100, Math.round(pvActuel/pvMax*100))) : 0;

  return `<div class="bst-card${isActive?' active':''}"
    style="--rang-c:${rs.color};--rang-glow:${rs.glow}"
    data-beast-id="${_esc(c.id)}"
    onclick="window._bstOpen('${c.id}')">

    ${c.imageUrl
      ? `<img class="bst-card-img" src="${_esc(c.imageUrl)}" alt="${_esc(c.nom||'')}" loading="lazy">`
      : `<div class="bst-card-empty">${c.emoji||'🐲'}</div>`}

    <div class="bst-card-rang">${_esc(rs.label)}</div>
    ${c.niveau ? `<div class="bst-card-niveau">${c.niveau}</div>` : ''}

    <div class="bst-card-body">
      <div class="bst-card-name">${_esc(c.nom||'?')}</div>
      ${c.type||c.environnement
        ? `<div class="bst-card-meta">${_esc([c.type,c.environnement].filter(Boolean).join(' · '))}</div>`
        : ''}

      ${_isAdminView() && (c.pvMax||c.ca||c.vitesse) ? `
      <div class="bst-card-stats">
        ${c.pvMax   ? `<span class="bst-card-stat">❤️ ${c.pvMax}</span>`   : ''}
        ${c.ca      ? `<span class="bst-card-stat">🛡️ ${c.ca}</span>`      : ''}
        ${c.vitesse ? `<span class="bst-card-stat">💨 ${c.vitesse}m</span>` : ''}
      </div>` : ''}

      ${_isAdminView() && pvMax > 0 ? `
      <div class="bst-card-pv">
        <div class="bst-card-pv-fill" style="width:${pvPct}%"></div>
      </div>
      <div class="bst-card-pv-lbl"><span>${pvActuel} PV</span><span>/ ${pvMax}</span></div>` : ''}
    </div>

    ${STATE.isAdmin ? `
    <div style="display:flex;gap:3px;padding:.35rem .6rem;border-top:1px solid var(--border);justify-content:flex-end">
      <button class="btn-icon" style="font-size:.7rem;color:#ff5a7e" onclick="event.stopPropagation();deleteBeast('${c.id}')" title="Supprimer">🗑️</button>
    </div>` : ''}
  </div>`;
}

// ── Panneau détail ────────────────────────────────────────────────────────────
function _renderPanel(c) {
  if (!c) return '';
  const rang  = c.rang || 'classique';
  const rs    = RANG_STYLE[rang] || RANG_STYLE.classique;

  // MJ : panneau entièrement éditable (auto-save Firestore)
  if (_isAdminView()) return _renderPanelAdmin(c, rs);

  const track = _tracker[c.id] || {};
  const ded   = track.deductions || {};

  const pvMax     = parseInt(c.pvMax)    || 0;
  const pmMax     = parseInt(c.pmMax)    || 0;
  const pvActuel  = track.pvActuel  !== undefined ? parseInt(track.pvActuel)  : (pvMax || 0);
  const pmActuel  = track.pmActuel  !== undefined ? parseInt(track.pmActuel)  : (pmMax || 0);
  const caEstimee = track.caEstimee !== undefined ? parseInt(track.caEstimee) : 0;
  const vitEstimee= track.vitEstimee!== undefined ? parseInt(track.vitEstimee): 0;
  const pvPct     = pvMax > 0 ? Math.round(pvActuel / pvMax * 100) : 0;
  const pmPct     = pmMax > 0 ? Math.round(pmActuel / pmMax * 100) : 0;

  const attaques  = Array.isArray(c.attaques) ? c.attaques : [];
  const traits    = Array.isArray(c.traits)   ? c.traits   : [];
  const butins    = Array.isArray(c.butins)   ? c.butins   : [];
  const description = c.description == null ? '' : String(c.description);

  // Calcul modificateur D&D : floor((stat - 10) / 2)
  const mod = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return null;
    const m = Math.floor((n - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  };

  // ── Hero du panneau ──────────────────────────────────────────────────────
  const heroHtml = `
    <div class="bst-panel-hero">
      ${c.imageUrl
        ? `<img class="bst-panel-img" src="${_esc(c.imageUrl)}" alt="${_esc(c.nom||'')}">`
        : `<div class="bst-panel-empty">${c.emoji||'🐲'}</div>`}
      ${_isAdminView() ? `<div class="bst-panel-mj-badge">MJ</div>` : ''}
      <button class="bst-panel-close" onclick="window._bstClose()">✕</button>
      <div class="bst-panel-hero-info">
        <div class="bst-panel-rang">${_esc(rs.label)}</div>
        <div class="bst-panel-name">${_esc(c.nom||'?')}</div>
        ${c.type||c.environnement
          ? `<div class="bst-panel-meta">${_esc([c.type,c.environnement].filter(Boolean).join(' · '))}</div>`
          : ''}
      </div>
    </div>`;

  // ── Vitaux (5) ───────────────────────────────────────────────────────────
  // MJ : valeurs réelles (lecture seule, depuis c.pvMax / c.pmMax / c.ca / …)
  // Joueur : estimations modifiables (track.pvActuel, etc.) — synchronisées
  //          avec le VTT en temps réel (saisie ici → "?" disparaît côté VTT).
  const _estCell = (cls, lbl, trackKey, trackVal) => `
    <div class="bst-stat-cell ${cls}" onclick="this.querySelector('input')?.focus()">
      <input type="number" id="bst-${cls}-${c.id}"
        value="${trackVal || ''}" placeholder="?" min="0"
        class="bst-stat-track-input"
        onchange="window._bstSetStat('${c.id}','${trackKey}',this.value)">
      <div class="bst-stat-lbl">${lbl}</div>
    </div>`;

  const _staticCell = (cls, lbl, val) => `
    <div class="bst-stat-cell ${cls}">
      <div class="bst-stat-val">${val || '—'}</div>
      <div class="bst-stat-lbl">${lbl}</div>
    </div>`;

  const vitalsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Statistiques</div>
      <div class="bst-stats-base">
        ${_estCell('pv',  'PV',   'pvActuel',   pvActuel)}
        ${_estCell('pm',  'PM',   'pmActuel',   pmActuel)}
        ${_estCell('ca',  'CA',   'caEstimee',  caEstimee)}
        ${_estCell('vit', 'Vit.', 'vitEstimee', vitEstimee)}
        ${_staticCell('init','XP', '')}
      </div>
    </div>`;

  // ── Caracs (6) : MJ seulement ────────────────────────────────────────────
  const caracsHtml = _isAdminView() ? `
    <div class="bst-section">
      <div class="bst-section-title">Caractéristiques</div>
      <div class="bst-caracs">
        ${[
          ['FOR', c.force],['DEX', c.dexterite],['CON', c.constitution],
          ['INT', c.intelligence],['SAG', c.sagesse],['CHA', c.charisme],
        ].map(([lbl, val]) => {
          const m = mod(val);
          const posNeg = !m ? 'zero' : parseInt(m) > 0 ? 'pos' : 'neg';
          return `<div class="bst-carac">
            <div class="bst-carac-val">${val||'—'}</div>
            ${m ? `<div class="bst-carac-mod ${posNeg}">${m}</div>` : ''}
            <div class="bst-carac-lbl">${lbl}</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── Description ──────────────────────────────────────────────────────────
  const descHtml = description ? `
    <div class="bst-section">
      <div class="bst-section-title">Description</div>
      <div class="bst-desc">${_esc(description).replace(/\n/g,'<br>')}</div>
    </div>` : '';

  // ── Relations aux dégâts : MJ SEULEMENT ─────────────────────────────────
  const dmgHtml = _isAdminView() ? _renderDamageProfile(c, _damageTypes) : '';


  // ── Attaques MJ ──────────────────────────────────────────────────────────
  const attaquesHtml = _isAdminView() && attaques.length ? `
    <div class="bst-section">
      <div class="bst-section-title">⚔️ Attaques <span class="bst-section-count">${attaques.length}</span></div>
      ${attaques.map(a => `
        <div class="bst-atk">
          <div class="bst-atk-name">${_esc(a.nom||'Attaque')}</div>
          <div class="bst-atk-stats">
            ${a.toucher ? `<span class="bst-atk-stat touch">🎯 ${_esc(a.toucher)}</span>` : ''}
            ${a.degats  ? `<span class="bst-atk-stat dmg">⚔️ ${_esc(a.degats)}</span>`   : ''}
            ${a.portee  ? `<span class="bst-atk-stat range">📏 ${_esc(a.portee)}</span>` : ''}
          </div>
          ${a.description ? `<div class="bst-atk-desc">${_esc(a.description)}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  // ── Traits MJ ────────────────────────────────────────────────────────────
  const traitsHtml = _isAdminView() && traits.length ? `
    <div class="bst-section">
      <div class="bst-section-title">✨ Traits & Capacités <span class="bst-section-count">${traits.length}</span></div>
      ${traits.map(t => `
        <div class="bst-trait">
          <div class="bst-trait-name">${_esc(t.nom||'')}</div>
          ${t.description ? `<div class="bst-trait-desc">${_esc(t.description)}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  // ── Butins MJ (jamais joueur) ─────────────────────────────────────────────
  const butinsHtml = _isAdminView() && butins.length ? `
    <div class="bst-section">
      <div class="bst-section-title">💰 Butins <span class="bst-section-count">${butins.length}</span></div>
      <div class="bst-loots">
        ${butins.map(b => `
          <div class="bst-loot">
            <span class="bst-loot-name">${_esc(b.nom||'Objet')}</span>
            ${b.quantite ? `<span class="bst-loot-qty">${_esc(b.quantite)}</span>` : ''}
            ${b.chance   ? `<span class="bst-loot-chance">${_esc(b.chance)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  // ── Attaques Joueur : lignes vides à compléter ────────────────────────────
  const attaquesJoueurHtml = !_isAdminView() && attaques.length ? `
    <div class="bst-section">
      <div class="bst-section-title">⚔️ Attaques
        <span class="bst-section-count">${attaques.length} observée${attaques.length>1?'s':''}</span>
      </div>
      ${attaques.map((_, i) => `
        <div class="bst-atk">
          <input class="bst-deduct-input" style="margin-bottom:6px;font-weight:600"
            placeholder="Nom de l'attaque…"
            value="${_esc(ded['att_nom_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','att_nom_${i}',this.value)">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px">
            <input class="bst-deduct-input" placeholder="🎯 Toucher"
              value="${_esc(ded['att_toucher_'+i]||'')}"
              onchange="window._bstSetDeduction('${c.id}','att_toucher_${i}',this.value)">
            <input class="bst-deduct-input" placeholder="⚔️ Dégâts"
              value="${_esc(ded['att_degats_'+i]||'')}"
              onchange="window._bstSetDeduction('${c.id}','att_degats_${i}',this.value)">
            <input class="bst-deduct-input" placeholder="📏 Portée"
              value="${_esc(ded['att_portee_'+i]||'')}"
              onchange="window._bstSetDeduction('${c.id}','att_portee_${i}',this.value)">
          </div>
        </div>`).join('')}
    </div>` : '';

  // ── Traits Joueur : lignes vides à compléter ──────────────────────────────
  const traitsJoueurHtml = !_isAdminView() && traits.length ? `
    <div class="bst-section">
      <div class="bst-section-title">✨ Traits & Capacités
        <span class="bst-section-count">${traits.length} trait${traits.length>1?'s':''}</span>
      </div>
      ${traits.map((_, i) => `
        <div class="bst-trait">
          <input class="bst-deduct-input" style="margin-bottom:5px;font-weight:600"
            placeholder="Nom du trait…"
            value="${_esc(ded['tr_nom_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','tr_nom_${i}',this.value)">
          <input class="bst-deduct-input"
            placeholder="Description…"
            value="${_esc(ded['tr_desc_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','tr_desc_${i}',this.value)">
        </div>`).join('')}
    </div>` : '';

  return `
  <div class="bst-panel" style="--rang-c:${rs.color};--rang-glow:${rs.glow}">
    ${heroHtml}
    <div class="bst-panel-body">
      ${vitalsHtml}
      ${descHtml}
      ${attaquesJoueurHtml}
      ${traitsJoueurHtml}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PANNEAU MJ — entièrement éditable, auto-save
// ══════════════════════════════════════════════════════════════════════════════
function _renderPanelAdmin(c, rs) {
  const types     = _damageTypes || window._bstDamageTypes || [];
  const attaques  = Array.isArray(c.attaques) ? c.attaques : [];
  const traits    = Array.isArray(c.traits)   ? c.traits   : [];
  const butins    = Array.isArray(c.butins)   ? c.butins   : [];

  const modOf = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return { txt:'', cls:'zero' };
    const m = Math.floor((n - 10) / 2);
    return { txt: m >= 0 ? `+${m}` : `${m}`, cls: m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero' };
  };

  // ── Hero éditable : image cliquable, rang selector, nom, type, env ──────
  const heroHtml = `
    <div class="bst-panel-hero">
      ${c.imageUrl
        ? `<img class="bst-panel-img" src="${_esc(c.imageUrl)}" alt="${_esc(c.nom||'')}"
             style="cursor:pointer" onclick="window.openBeastImageModal('${c.id}')">`
        : `<div class="bst-panel-empty" style="cursor:pointer" onclick="window.openBeastImageModal('${c.id}')">${c.emoji||'🐲'}</div>`}
      <button class="bst-panel-img-edit" onclick="window.openBeastImageModal('${c.id}')" title="Changer l'image">📷</button>
      <div class="bst-panel-mj-badge">MJ</div>
      <button class="bst-panel-close" onclick="window._bstClose()">✕</button>
      <div class="bst-panel-hero-info">
        <div class="bst-panel-rang-selector">
          ${Object.entries(RANG_STYLE).map(([r, rst]) => {
            const active = (c.rang||'classique') === r;
            return `<button type="button" data-bst-rang-btn="${r}"
              class="bst-rang-btn${active?' active':''}"
              style="${active?`color:${rst.color};border-color:${rst.color};background:${rst.color}1a`:''}"
              onclick="window._bstSelectRangPanel('${c.id}','${r}')">${rst.label}</button>`;
          }).join('')}
        </div>
        <input class="bst-panel-name-input" value="${_esc(c.nom||'')}" placeholder="Nom de la créature…"
          oninput="window._bstUpdateNom('${c.id}', this.value)">
        <div class="bst-panel-meta-edit">
          <input class="bst-panel-edit-inline" placeholder="Type" value="${_esc(c.type||'')}"
            oninput="window._bstUpdate('${c.id}','type',this.value)">
          <span class="bst-panel-meta-dot">·</span>
          <input class="bst-panel-edit-inline" placeholder="Environnement" value="${_esc(c.environnement||'')}"
            oninput="window._bstUpdate('${c.id}','environnement',this.value)">
        </div>
      </div>
    </div>`;

  // ── Statistiques (5 cellules : PV PM CA Vit XP) + niveau + initiative ───
  const vitalsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Statistiques</div>
      <div class="bst-stats-base">
        <div class="bst-stat-cell pv" onclick="this.querySelector('input')?.focus()">
          <input type="number" min="0" value="${c.pvMax||''}" placeholder="0" class="bst-stat-track-input"
            oninput="window._bstUpdateNum('${c.id}','pvMax',this.value)">
          <div class="bst-stat-lbl">PV</div>
        </div>
        <div class="bst-stat-cell pm" onclick="this.querySelector('input')?.focus()">
          <input type="number" min="0" value="${c.pmMax||''}" placeholder="0" class="bst-stat-track-input"
            oninput="window._bstUpdateNum('${c.id}','pmMax',this.value)">
          <div class="bst-stat-lbl">PM</div>
        </div>
        <div class="bst-stat-cell ca" onclick="this.querySelector('input')?.focus()">
          <input type="number" min="0" value="${c.ca||''}" placeholder="0" class="bst-stat-track-input"
            oninput="window._bstUpdateNum('${c.id}','ca',this.value)">
          <div class="bst-stat-lbl">CA</div>
        </div>
        <div class="bst-stat-cell vit" onclick="this.querySelector('input')?.focus()">
          <input type="number" min="0" value="${c.vitesse||''}" placeholder="0" class="bst-stat-track-input"
            oninput="window._bstUpdateNum('${c.id}','vitesse',this.value)">
          <div class="bst-stat-lbl">Vit. (m)</div>
        </div>
        <div class="bst-stat-cell init" onclick="this.querySelector('input')?.focus()">
          <input type="number" min="0" value="${c.dangerositeXp||''}" placeholder="0" class="bst-stat-track-input"
            oninput="window._bstUpdateNum('${c.id}','dangerositeXp',this.value)">
          <div class="bst-stat-lbl">XP</div>
        </div>
      </div>
      <div class="bst-niv-row">
        <span class="bst-niv-lbl">Niveau / FP</span>
        <input type="number" min="0" value="${c.niveau||''}" placeholder="—"
          class="bst-p-input bst-p-input-sm"
          oninput="window._bstUpdateNum('${c.id}','niveau',this.value)">
        <span class="bst-niv-lbl">Initiative</span>
        <input type="number" value="${c.initiative||''}" placeholder="—"
          class="bst-p-input bst-p-input-sm"
          oninput="window._bstUpdateNum('${c.id}','initiative',this.value)">
        <span class="bst-niv-lbl">Emoji</span>
        <input value="${_esc(c.emoji||'🐲')}" placeholder="🐲"
          class="bst-p-input bst-p-input-sm" style="width:40px"
          oninput="window._bstUpdate('${c.id}','emoji',this.value)">
      </div>
    </div>`;

  // ── Caracs (6, avec auto-modificateur) ─────────────────────────────────
  const caracsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Caractéristiques</div>
      <div class="bst-caracs">
        ${[
          ['FOR','force'],['DEX','dexterite'],['CON','constitution'],
          ['INT','intelligence'],['SAG','sagesse'],['CHA','charisme'],
        ].map(([lbl, key]) => {
          const { txt, cls } = modOf(c[key]);
          return `<div class="bst-carac">
            <input type="number" min="0" value="${c[key]||''}" placeholder="—"
              class="bst-carac-input"
              oninput="window._bstUpdateCarac('${c.id}','${key}',this.value)">
            <div class="bst-carac-mod ${cls}" data-bst-mod="${c.id}-${key}">${txt}</div>
            <div class="bst-carac-lbl">${lbl}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  // ── Token VTT (taille en cases) ────────────────────────────────────────
  const tokenHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Token VTT (cases)</div>
      <div class="bst-token-row">
        <span class="bst-niv-lbl">Largeur</span>
        <select class="bst-p-input bst-p-input-sm" onchange="window._bstUpdateNum('${c.id}','tokenW',this.value)">
          ${[1,2,3,4,5].map(n => `<option value="${n}"${(c.tokenW||c.tokenSize||1)===n?' selected':''}>${n}</option>`).join('')}
        </select>
        <span class="bst-niv-lbl">×</span>
        <span class="bst-niv-lbl">Hauteur</span>
        <select class="bst-p-input bst-p-input-sm" onchange="window._bstUpdateNum('${c.id}','tokenH',this.value)">
          ${[1,2,3,4,5].map(n => `<option value="${n}"${(c.tokenH||c.tokenSize||1)===n?' selected':''}>${n}</option>`).join('')}
        </select>
      </div>
    </div>`;

  // ── Description (textarea) ─────────────────────────────────────────────
  const descHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Description</div>
      <textarea class="bst-panel-textarea" placeholder="Apparence, comportement, lore…" rows="3"
        oninput="window._bstUpdate('${c.id}','description',this.value)">${_esc(c.description||'')}</textarea>
    </div>`;

  // ── Relations aux dégâts (matrice chips compacte) ─────────────────────
  const dmgHtml = _renderDamageMatrixPanel(c, types);

  // ── Attaques (ajout / édition / suppression inline) ───────────────────
  const attaquesHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        ⚔️ Attaques
        <span class="bst-section-count" data-bst-count="${c.id}-attaques">${attaques.length}</span>
        <button class="bst-add-row-btn" onclick="window._bstAddPanelRow('${c.id}','attaques')">+ Ajouter</button>
      </div>
      <div id="bst-p-attaques-${c.id}" class="bst-p-rows">
        ${attaques.map((a, i) => _panelAttackRow(a, c.id, i)).join('')}
      </div>
    </div>`;

  const traitsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        ✨ Traits & Capacités
        <span class="bst-section-count" data-bst-count="${c.id}-traits">${traits.length}</span>
        <button class="bst-add-row-btn" onclick="window._bstAddPanelRow('${c.id}','traits')">+ Ajouter</button>
      </div>
      <div id="bst-p-traits-${c.id}" class="bst-p-rows">
        ${traits.map((t, i) => _panelTraitRow(t, c.id, i)).join('')}
      </div>
    </div>`;

  const butinsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        💰 Butins
        <span class="bst-section-count" data-bst-count="${c.id}-butins">${butins.length}</span>
        <button class="bst-add-row-btn" onclick="window._bstAddPanelRow('${c.id}','butins')">+ Ajouter</button>
      </div>
      <div id="bst-p-butins-${c.id}" class="bst-p-rows">
        ${butins.map((b, i) => _panelButinRow(b, c.id, i)).join('')}
      </div>
    </div>`;

  return `
  <div class="bst-panel" style="--rang-c:${rs.color};--rang-glow:${rs.glow}">
    ${heroHtml}
    <div class="bst-panel-body">
      ${vitalsHtml}
      ${caracsHtml}
      ${tokenHtml}
      ${descHtml}
      ${dmgHtml}
      ${attaquesHtml}
      ${traitsHtml}
      ${butinsHtml}
      <div class="bst-admin-actions">
        <button class="bst-btn-delete" style="flex:1" onclick="deleteBeast('${c.id}')">🗑️ Supprimer cette créature</button>
      </div>
    </div>
  </div>`;
}
// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — Créer / Modifier une créature
// ══════════════════════════════════════════════════════════════════════════════
async function openBeastModal(id = null) {
  _bstCropper?.destroy(); _bstCropper = null;
  const c = id ? _creatures.find(x => x.id === id) : null;

  const allDamageTypes = await loadDamageTypes();
  window._bstDamageTypes = allDamageTypes;

  // Sérialiser les tableaux dynamiques
  const attaques = c?.attaques || [{ nom:'', toucher:'', degats:'', portee:'', description:'', damageTypeId:'' }];
  const traits   = c?.traits   || [{ nom:'', description:'' }];
  const butins   = c?.butins   || [{ nom:'', quantite:'', chance:'' }];

  openModal(c ? `✏️ Modifier — ${c.nom||'Créature'}` : '🐉 Nouvelle créature', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="form-group" style="grid-column:1/-1">
        <label>Nom</label>
        <input class="input-field" id="bst-nom" value="${c?.nom||''}" placeholder="Gobelin, Dragon rouge...">
      </div>
      <div class="form-group">
        <label>Type</label>
        <input class="input-field" id="bst-type" value="${c?.type||''}" placeholder="Humanoïde, Bête, Mort-vivant...">
      </div>
      <div class="form-group">
        <label>Environnement</label>
        <input class="input-field" id="bst-env" value="${c?.environnement||''}" placeholder="Forêt, Donjon...">
      </div>
      <div class="form-group">
        <label>Niveau / FP</label>
        <input type="number" class="input-field" id="bst-niveau" value="${c?.niveau||''}" placeholder="1">
      </div>
      <div class="form-group">
        <label>XP récompense</label>
        <input type="number" class="input-field" id="bst-xp" value="${c?.dangerositeXp||''}" placeholder="100">
      </div>
      <div class="form-group">
        <label>Emoji (si pas d'image)</label>
        <input class="input-field" id="bst-emoji" value="${c?.emoji||'🐲'}" style="max-width:80px">
      </div>
      <div class="form-group">
        <label>Taille token VTT (cases L × H)</label>
        <div style="display:flex;gap:.5rem;align-items:center">
          <select class="input-field" id="bst-tokenW" style="flex:1">
            ${[1,2,3,4,5].map(n => `<option value="${n}"${(c?.tokenW||c?.tokenSize||1)===n?' selected':''}>${n}</option>`).join('')}
          </select>
          <span style="color:var(--text-dim)">×</span>
          <select class="input-field" id="bst-tokenH" style="flex:1">
            ${[1,2,3,4,5].map(n => `<option value="${n}"${(c?.tokenH||c?.tokenSize||1)===n?' selected':''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label>Rang</label>
        <div id="bst-rang-selector" data-rang="${c?.rang||'classique'}" style="display:flex;gap:.5rem">
          ${Object.entries(RANG_STYLE).map(([r, rst]) => {
            const active = (c?.rang||'classique') === r;
            return `<button type="button" onclick="window._bstSelectRang('${r}')" data-rang-btn="${r}"
              style="flex:1;padding:.4rem .6rem;border-radius:8px;cursor:pointer;font-size:.82rem;
              font-weight:${active?'700':'400'};
              border:1px solid ${active?rst.border:'var(--border)'};
              background:${active?rst.bg:'var(--bg-elevated)'};
              color:${active?rst.color:'var(--text-dim)'}">${rst.label}</button>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Image upload + crop -->
    <div class="form-group">
      <label>Image</label>
      <div id="bst-drop-zone" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated);transition:border-color .15s">
        <div id="bst-drop-preview"></div>
      </div>
      <div id="bst-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">Recadrez — ratio 4:3</div>
        <canvas id="bst-crop-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" id="bst-crop-confirm" style="margin-top:.5rem;width:100%">✂️ Confirmer le recadrage</button>
        <div id="bst-crop-ok" style="display:none;font-size:.75rem;text-align:center;margin-top:4px"></div>
      </div>
    </div>

    <!-- Stats -->
    <div class="form-group">
      <label>Statistiques</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
        ${[['pvMax','❤️ PV Max'],['pmMax','💙 PM Max'],['ca','🛡️ CA'],
           ['force','FOR'],['dexterite','DEX'],['constitution','CON'],
           ['intelligence','INT'],['sagesse','SAG'],['charisme','CHA'],
           ['vitesse','Vitesse (m)'],['initiative','Initiative']].map(([k,l]) => `
          <div>
            <label style="font-size:.68rem;color:var(--text-dim)">${l}</label>
            <input type="number" class="input-field" id="bst-${k}" value="${c?.[k]||''}" style="padding:4px 6px">
          </div>`).join('')}
      </div>
    </div>

    <!-- Description -->
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="bst-desc" rows="3" placeholder="Apparence, comportement...">${c?.description||''}</textarea>
    </div>

    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        <span>🛡️ Relations aux dégâts</span>
        <span style="font-size:.62rem;color:var(--text-dim);font-weight:400">⚠ ligne = type coché dans plusieurs catégories</span>
      </label>
      ${_renderDamageTypeMatrix(c, allDamageTypes)}
    </div>

    <!-- ATTAQUES dynamiques -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        ⚔️ Attaques
        <button type="button" onclick="window._bstAddRow('attaques')"
          style="font-size:.72rem;background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
          border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--gold)">+ Ligne</button>
      </label>
      <div id="bst-attaques-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${attaques.map((a, i) => _attackRow(a, i)).join('')}
      </div>
    </div>

    <!-- TRAITS dynamiques -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        ✨ Traits & Capacités
        <button type="button" onclick="window._bstAddRow('traits')"
          style="font-size:.72rem;background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
          border-radius:6px;padding:2px 8px;cursor:pointer;color:#4f8cff">+ Ligne</button>
      </label>
      <div id="bst-traits-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${traits.map((t, i) => _traitRow(t, i)).join('')}
      </div>
    </div>

    <!-- BUTINS dynamiques -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        💰 Butins
        <button type="button" onclick="window._bstAddRow('butins')"
          style="font-size:.72rem;background:rgba(34,195,142,.08);border:1px solid rgba(34,195,142,.3);
          border-radius:6px;padding:2px 8px;cursor:pointer;color:#22c38e">+ Ligne</button>
      </label>
      <div id="bst-butins-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${butins.map((b, i) => _butinRow(b, i)).join('')}
      </div>
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="saveBeast('${id||''}')">
      ${c ? 'Enregistrer' : 'Créer la créature'}
    </button>
  `);

  // Surligner d'éventuels conflits de catégories sur l'état initial.
  window._bstSyncDmgConflicts?.();

  _bstCropper?.destroy();
  _bstCropper = attachDropAndCrop({
    dropEl:        document.getElementById('bst-drop-zone'),
    previewEl:     document.getElementById('bst-drop-preview'),
    cropWrapEl:    document.getElementById('bst-crop-wrap'),
    canvasId:      'bst-crop-canvas',
    statusEl:      document.getElementById('bst-crop-ok'),
    confirmBtnEl:  document.getElementById('bst-crop-confirm'),
    initialUrl:    c?.imageUrl || '',
    ratio:         { w: 4, h: 3 },
    output:        { maxW: 1800, target: 700_000 },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL IMAGE — édition rapide de l'image depuis le panneau admin
// ══════════════════════════════════════════════════════════════════════════════
async function openBeastImageModal(id) {
  const c = _creatures.find(x => x.id === id);
  if (!c) return;
  _bstCropper?.destroy(); _bstCropper = null;

  openModal(`📷 Image — ${_esc(c.nom || 'Créature')}`, `
    <div class="form-group">
      <label>Image (ratio 4:3)</label>
      <div id="bst-img-drop" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated)">
        <div id="bst-img-preview"></div>
      </div>
      <div id="bst-img-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">Recadrez l'image</div>
        <canvas id="bst-img-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" id="bst-img-confirm" style="margin-top:.5rem;width:100%">✂️ Confirmer le recadrage</button>
        <div id="bst-img-ok" style="display:none;font-size:.75rem;text-align:center;margin-top:4px"></div>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="window._bstSaveImage('${id}')">💾 Enregistrer</button>
      ${c.imageUrl ? `<button class="btn btn-outline" onclick="window._bstRemoveImage('${id}')">🗑 Retirer</button>` : ''}
    </div>
  `);

  _bstCropper = attachDropAndCrop({
    dropEl:        document.getElementById('bst-img-drop'),
    previewEl:     document.getElementById('bst-img-preview'),
    cropWrapEl:    document.getElementById('bst-img-crop-wrap'),
    canvasId:      'bst-img-canvas',
    statusEl:      document.getElementById('bst-img-ok'),
    confirmBtnEl:  document.getElementById('bst-img-confirm'),
    initialUrl:    c?.imageUrl || '',
    ratio:         { w: 4, h: 3 },
    output:        { maxW: 1800, target: 700_000 },
  });
}

window._bstSaveImage = async (id) => {
  try {
    const cropResult = _bstCropper?.getResult();
    const current = _creatures.find(c => c.id === id)?.imageUrl || '';
    const imageUrl = typeof cropResult === 'string' ? cropResult : current;
    if (imageUrl && imageUrl.length > 900_000) {
      showNotif('Image trop grande, recadrez plus petit.', 'error');
      return;
    }
    const col = window._bstCurrentCol || 'bestiary';
    await updateInCol(col, id, { imageUrl });
    const idx = _creatures.findIndex(c => c.id === id);
    if (idx >= 0) _creatures[idx].imageUrl = imageUrl;
    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    _syncActivePanel();
    // MAJ visuel carte
    const card = document.querySelector(`.bst-card[data-beast-id="${id}"]`);
    if (card && imageUrl) {
      let img = card.querySelector('.bst-card-img');
      if (!img) {
        const empty = card.querySelector('.bst-card-empty');
        if (empty) {
          img = document.createElement('img');
          img.className = 'bst-card-img';
          img.loading = 'lazy';
          empty.replaceWith(img);
        }
      }
      if (img) img.src = imageUrl;
    }
    showNotif('Image mise à jour.', 'success');
  } catch (e) { notifySaveError(e); }
};

window._bstRemoveImage = async (id) => {
  try {
    const col = window._bstCurrentCol || 'bestiary';
    await updateInCol(col, id, { imageUrl: '' });
    const idx = _creatures.findIndex(c => c.id === id);
    if (idx >= 0) _creatures[idx].imageUrl = '';
    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    _syncActivePanel();
    showNotif('Image retirée.', 'success');
  } catch (e) { notifySaveError(e); }
};

// ── Lignes dynamiques ─────────────────────────────────────────────────────────
function _attackRow(a={}, i) {
  return `<div class="bst-dyn-row" id="bst-att-${i}" style="background:var(--bg-elevated);border-radius:8px;padding:.5rem;border:1px solid var(--border)">
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:.4rem;margin-bottom:.3rem">
      <input class="input-field" placeholder="Nom attaque" value="${a.nom||''}" id="bst-att-nom-${i}" style="font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Toucher" value="${a.toucher||''}" id="bst-att-toucher-${i}" style="font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Dégâts" value="${a.degats||''}" id="bst-att-degats-${i}" style="font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Portée" value="${a.portee||''}" id="bst-att-portee-${i}" style="font-size:.78rem;padding:4px 6px">
    </div>
    <div style="display:grid;grid-template-columns:1fr;gap:.4rem;margin-bottom:.3rem">
      <select class="input-field" id="bst-att-dmgtype-${i}" style="font-size:.78rem;padding:4px 6px">
        <option value="">Type de dégâts (physique par défaut)</option>
        ${(window._bstDamageTypes||[]).map(t=>`<option value="${t.id}"${a.damageTypeId===t.id?' selected':''}>${t.icon||''} ${_esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:.4rem">
      <input class="input-field" placeholder="Description de l'effet..." value="${a.description||''}" id="bst-att-desc-${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
      <button type="button" onclick="window._bstRemoveRow('attaques',${i})" style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px">✕</button>
    </div>
  </div>`;
}

function _traitRow(t={}, i) {
  return `<div class="bst-dyn-row" id="bst-tr-${i}" style="background:var(--bg-elevated);border-radius:8px;padding:.5rem;border:1px solid var(--border)">
    <div style="display:flex;gap:.4rem">
      <input class="input-field" placeholder="Nom du trait" value="${t.nom||''}" id="bst-tr-nom-${i}" style="width:160px;font-size:.78rem;padding:4px 6px;flex-shrink:0">
      <input class="input-field" placeholder="Description..." value="${t.description||''}" id="bst-tr-desc-${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
      <button type="button" onclick="window._bstRemoveRow('traits',${i})" style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px">✕</button>
    </div>
  </div>`;
}

function _butinRow(b={}, i) {
  return `<div class="bst-dyn-row" id="bst-bu-${i}" style="background:var(--bg-elevated);border-radius:8px;padding:.5rem;border:1px solid var(--border)">
    <div style="display:flex;gap:.4rem">
      <input class="input-field" placeholder="Nom de l'objet" value="${b.nom||''}" id="bst-bu-nom-${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Quantité" value="${b.quantite||''}" id="bst-bu-qte-${i}" style="width:80px;font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Chance %" value="${b.chance||''}" id="bst-bu-chance-${i}" style="width:80px;font-size:.78rem;padding:4px 6px">
      <button type="button" onclick="window._bstRemoveRow('butins',${i})" style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px">✕</button>
    </div>
  </div>`;
}

// ── Ajouter / supprimer une ligne dynamique ───────────────────────────────────
window._bstAddRow = (type) => {
  const container = document.getElementById(`bst-${type}-list`);
  if (!container) return;
  const i = container.querySelectorAll('.bst-dyn-row').length;
  const div = document.createElement('div');
  div.innerHTML = type==='attaques' ? _attackRow({},i) : type==='traits' ? _traitRow({},i) : _butinRow({},i);
  container.appendChild(div.firstElementChild);
};

window._bstRemoveRow = (type, i) => {
  const row = document.getElementById(`bst-${type==='attaques'?'att':type==='traits'?'tr':'bu'}-${i}`);
  row?.remove();
};

// ── Lire les lignes dynamiques depuis le DOM ──────────────────────────────────
function _readRows(type) {
  if (type === 'attaques') {
    return [...document.querySelectorAll('#bst-attaques-list .bst-dyn-row')].map((_,i) => ({
      nom:         document.getElementById(`bst-att-nom-${i}`)?.value?.trim()     || '',
      toucher:     document.getElementById(`bst-att-toucher-${i}`)?.value?.trim() || '',
      degats:      document.getElementById(`bst-att-degats-${i}`)?.value?.trim()  || '',
      portee:      document.getElementById(`bst-att-portee-${i}`)?.value?.trim()  || '',
      damageTypeId:document.getElementById(`bst-att-dmgtype-${i}`)?.value || '',
      description: document.getElementById(`bst-att-desc-${i}`)?.value?.trim()   || '',
    })).filter(a => a.nom || a.degats);
  }
  if (type === 'traits') {
    return [...document.querySelectorAll('#bst-traits-list .bst-dyn-row')].map((_,i) => ({
      nom:         document.getElementById(`bst-tr-nom-${i}`)?.value?.trim()  || '',
      description: document.getElementById(`bst-tr-desc-${i}`)?.value?.trim() || '',
    })).filter(t => t.nom || t.description);
  }
  // butins
  return [...document.querySelectorAll('#bst-butins-list .bst-dyn-row')].map((_,i) => ({
    nom:      document.getElementById(`bst-bu-nom-${i}`)?.value?.trim()    || '',
    quantite: document.getElementById(`bst-bu-qte-${i}`)?.value?.trim()    || '',
    chance:   document.getElementById(`bst-bu-chance-${i}`)?.value?.trim() || '',
  })).filter(b => b.nom);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDER / SUPPRIMER
// ══════════════════════════════════════════════════════════════════════════════
async function saveBeast(id = '') {
  try {
    const nom = document.getElementById('bst-nom')?.value?.trim();
    if (!nom) { showNotif('Le nom est requis.','error'); return; }

    // Image : nouveau crop > existante (pas de bouton "retirer" ici)
    const cropResult = _bstCropper?.getResult();
    let imageUrl = typeof cropResult === 'string'
      ? cropResult
      : (id ? (_creatures.find(c=>c.id===id)?.imageUrl || '') : '');

    // Vérifier taille Firestore
    if (imageUrl.length > 900_000) { showNotif('Image trop grande, recadrez plus petit.','error'); return; }

    const data = {
      nom,
      type:          document.getElementById('bst-type')?.value?.trim()    || '',
      environnement: document.getElementById('bst-env')?.value?.trim()     || '',
      niveau:        parseInt(document.getElementById('bst-niveau')?.value)||0,
      dangerositeXp: parseInt(document.getElementById('bst-xp')?.value)||0,
      emoji:         document.getElementById('bst-emoji')?.value?.trim()   || '🐲',
      tokenW:        Math.max(1, Math.min(5, parseInt(document.getElementById('bst-tokenW')?.value)||1)),
      tokenH:        Math.max(1, Math.min(5, parseInt(document.getElementById('bst-tokenH')?.value)||1)),
      rang:          document.getElementById('bst-rang-selector')?.dataset?.rang || 'classique',
      imageUrl,
      description:   document.getElementById('bst-desc')?.value?.trim()   || '',
      // Stats
      pvMax:          parseInt(document.getElementById('bst-pvMax')?.value)||0,
      pmMax:          parseInt(document.getElementById('bst-pmMax')?.value)||0,
      ca:             parseInt(document.getElementById('bst-ca')?.value)||0,
      force:          parseInt(document.getElementById('bst-force')?.value)||0,
      dexterite:      parseInt(document.getElementById('bst-dexterite')?.value)||0,
      constitution:   parseInt(document.getElementById('bst-constitution')?.value)||0,
      intelligence:   parseInt(document.getElementById('bst-intelligence')?.value)||0,
      sagesse:        parseInt(document.getElementById('bst-sagesse')?.value)||0,
      charisme:       parseInt(document.getElementById('bst-charisme')?.value)||0,
      vitesse:        parseInt(document.getElementById('bst-vitesse')?.value)||0,
      initiative:     parseInt(document.getElementById('bst-initiative')?.value)||0,
      resistances:    _readDamageTypeSelections('resistances'),
      immunites:      _readDamageTypeSelections('immunites'),
      absorptions:    _readDamageTypeSelections('absorptions'),
      faiblesses:     _readDamageTypeSelections('faiblesses'),
      // Tableaux dynamiques
      attaques: _readRows('attaques'),
      traits:   _readRows('traits'),
      butins:   _readRows('butins'),
    };

    const col = window._bstCurrentCol || 'bestiary';

    if (id) {
      await updateInCol(col, id, data);
      const idx = _creatures.findIndex(c=>c.id===id);
      if (idx>=0) _creatures[idx] = { ...data, id };
    } else {
      const newId = await addToCol(col, data);
      if (typeof newId === 'string') _creatures.push({ ...data, id: newId });
      else _creatures = await loadCollection(col);
      _creatures.sort((a,b)=>(a.nom||'').localeCompare(b.nom||''));
    }

    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    showNotif(id ? `${nom} mis à jour !` : `${nom} ajouté au bestiaire !`, 'success');
    _render();
  } catch (e) { notifySaveError(e); }
}

async function deleteBeast(id) {
  try {
    const col = window._bstCurrentCol || 'bestiary';
    const c = _creatures.find(x=>x.id===id);
    if (!await confirmModal(`Supprimer "${c?.nom||'cette créature'}" ?`, {title: 'Supprimer la créature'})) return;
    await deleteFromCol(col, id);
    _creatures = _creatures.filter(x=>x.id!==id);
    if (_activeId === id) _activeId = null;
    _render();
    showNotif('Créature supprimée.','success');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUIVI JOUEUR
// ══════════════════════════════════════════════════════════════════════════════
async function _saveTracker() {
  try {
    const uid = _viewAsUid || STATE.user?.uid; if (!uid) return;
    await saveDoc('bestiary_tracker', uid, { data: _tracker });
  } catch (e) { notifySaveError(e); }
}

function _syncActivePanel() {
  const page = document.querySelector('.bst-page');
  const layout = document.querySelector('.bst-layout');
  const panelSlot = document.querySelector('.bst-panel-slot');
  const activeCreature = _creatures.find(c => c.id === _activeId);

  page?.classList.toggle('has-panel', !!activeCreature);
  page?.classList.toggle('no-panel', !activeCreature);
  layout?.classList.toggle('has-panel', !!activeCreature);
  layout?.classList.toggle('no-panel', !activeCreature);

  document.querySelectorAll('.bst-card').forEach(card => {
    card.classList.toggle('active', card.dataset.beastId === _activeId);
  });

  if (panelSlot) {
    try {
      panelSlot.innerHTML = activeCreature ? _renderPanel(activeCreature) : '';
    } catch (err) {
      console.error('[bestiary] render panel failed:', err, activeCreature);
      panelSlot.innerHTML = activeCreature ? `
        <div class="bst-panel">
          <div class="bst-section">
            <div class="bst-section-title">Fiche creature</div>
            <div style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--text);font-weight:700">${_esc(activeCreature.nom || 'Creature')}</div>
            <div style="font-size:.78rem;color:var(--text-dim);margin-top:.35rem">Impossible d'afficher toutes les informations de cette creature.</div>
          </div>
        </div>` : '';
    }
  }
}

window._bstOpen = (id) => {
  _activeId = _activeId === id ? null : id;
  _syncActivePanel();
};
window._bstClose = () => {
  _activeId = null;
  _syncActivePanel();
};
window._bstSetRang = (rang) => { _filterRang = rang; _render(); };
window._bstSelectRang = (rang) => {
  const sel = document.getElementById('bst-rang-selector');
  if (!sel) return;
  sel.dataset.rang = rang;
  sel.querySelectorAll('[data-rang-btn]').forEach(btn => {
    const r = btn.dataset.rangBtn;
    const active = r === rang;
    const rst = RANG_STYLE[r] || RANG_STYLE.classique;
    btn.style.fontWeight = active ? '700' : '400';
    btn.style.border     = `1px solid ${active ? rst.border : 'var(--border)'}`;
    btn.style.background = active ? rst.bg  : 'var(--bg-elevated)';
    btn.style.color      = active ? rst.color : 'var(--text-dim)';
  });
};
// Recherche : met à jour la valeur et filtre la grille SANS rerender complet
window._bstSearchInput = (val) => {
  _searchVal = val;
  // Filtrer en live sans reconstruire toute la page
  document.querySelectorAll('.bst-card').forEach(card => {
    const id = card.dataset.beastId;
    const c  = _creatures.find(x => x.id === id);
    if (!c) return;
    card.style.display = _beastMatchesFilters(c, { search: val }) ? '' : 'none';
  });
};

window._bstSearch = (val) => { _searchVal = val; _render(); }; // legacy
window._bstSetType = (type) => { _filterType = type; _render(); };

// Switch de bestiaire (admin uniquement)
window._bstSwitchBestiaire = async (id) => {
  _bestiaireId = id;
  _activeId    = null;
  _searchVal   = '';
  _filterType  = '';
  _filterRang  = '';
  await renderBestiary();
};

// Vue admin → joueur : voir/modifier les estimations d'un joueur.
// uid vide ou égal à l'UID admin → retour à la vue MJ.
window._bstViewAs = async (uid) => {
  if (!STATE.isAdmin) return;
  _viewAsUid = (uid && uid !== STATE.user?.uid) ? uid : null;
  _activeId  = null;
  await renderBestiary();
};

window._bstCreateBestiaire = async () => {
  const label = prompt('Nom du nouveau bestiaire :');
  if (!label?.trim()) return;
  const id    = 'bst_' + Date.now();
  const list  = window._bstBestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  list.push({ id, label: label.trim() });
  await saveDoc('bestiary_meta', 'list', { list });
  window._bstBestiaireList = list;
  _bestiaireId = id;
  _activeId    = null;
  _filterRang  = '';
  await renderBestiary();
};

// Déductions joueur
window._bstSetDeduction = (id, key, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  if (!_tracker[id].deductions) _tracker[id].deductions = {};
  if (val === '' || val === null || val === undefined) {
    delete _tracker[id].deductions[key];
  } else {
    _tracker[id].deductions[key] = val;
  }
  _saveTracker();
};

window._bstAdjust = (id, type, delta) => {
  const c = _creatures.find(x=>x.id===id); if (!c) return;
  if (!_tracker[id]) _tracker[id] = {};
  const curKey = type==='pv'?'pvActuel':'pmActuel';
  // Vue MJ : connaît le max et le respecte. Vue joueur (ou MJ consultant un joueur) : pas de borne max.
  const max    = _isAdminView() ? (parseInt(c[type==='pv'?'pvMax':'pmMax'])||0) : null;
  const cur    = _tracker[id][curKey] !== undefined ? parseInt(_tracker[id][curKey]) : (max ?? 0);
  const newVal = max !== null ? Math.max(0, Math.min(max, cur + delta)) : Math.max(0, cur + delta);
  _tracker[id][curKey] = newVal;

  const input = document.getElementById(`bst-${type}-${id}`);
  const bar   = document.getElementById(`bst-${type}bar-${id}`);
  if (input) input.value = newVal;
  if (bar && max) {
    const pct = Math.round(newVal/max*100);
    bar.style.width = pct+'%';
  }
  if (_isAdminView() && max && type === 'pv') {
    const cardBar = [...document.querySelectorAll('.bst-card')]
      .find(card => card.dataset.beastId === id)
      ?.querySelector('.bst-card-pv-fill');
    if (cardBar) { cardBar.style.width = Math.round(newVal/max*100)+'%'; }
  }
  _saveTracker();
};

window._bstSetStat = (id, key, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  _tracker[id][key] = parseInt(val)||0;
  _saveTracker();
};

window._bstSetNotes = (id, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  _tracker[id].notes = val;
  _saveTracker();
};

window._bstReset = (id) => {
  const c = _creatures.find(x=>x.id===id); if (!c) return;
  // Vue MJ : remet les vraies valeurs. Vue joueur (ou MJ consultant un joueur) : remet les estimations à zéro.
  _tracker[id] = _isAdminView()
    ? { pvActuel: parseInt(c.pvMax)||0, pmActuel: parseInt(c.pmMax)||0, notes:'' }
    : { pvActuel: 0, pmActuel: 0, caEstimee: 0, vitEstimee: 0, pvCombat: 0, notes:'', deductions:{} };
  _saveTracker();
  _render();
};

// ── Override PAGES.bestiaire + exports ───────────────────────────────────────
PAGES.bestiaire = renderBestiary;

Object.assign(window, {
  renderBestiary,
  openBeastModal,
  openBeastImageModal,
  saveBeast,
  deleteBeast,
});
