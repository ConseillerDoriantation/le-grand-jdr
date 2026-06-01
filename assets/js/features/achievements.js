// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// ✓ Upload + redimensionnement image (ratio libre, max 1400px, fond flou à l'affichage)
// ✓ Hauts-faits sans image affichés correctement (emoji + fond)
// ✓ Drag & drop SortableJS pour réordonner, ordre persisté dans Firestore
// ✓ Ordre partagé pour tous les utilisateurs
// ══════════════════════════════════════════════════════════════════════════════
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { confirmDelete } from '../shared/crud.js';
import { loadCollection, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { watch, watchDoc } from '../shared/realtime.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { STATE } from '../core/state.js';
import { attachDropAndResize } from '../shared/image-crop.js';
import { sortCharactersForDisplay } from '../shared/char-stats.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const CATS = [
  { id: 'epique',   label: '⚔️ Épique',   color: '#4f8cff', glow: 'rgba(79,140,255,0.14)'  },
  { id: 'comique',  label: '🎭 Comique',  color: '#e8b84b', glow: 'rgba(232,184,75,0.14)'  },
  { id: 'histoire', label: '📖 Histoire', color: '#22c38e', glow: 'rgba(34,195,142,0.14)'  },
];


const STORE = {
  items:         [],        // hauts-faits chargés
  lightboxItems: {},        // { [catId]: item[] } cache lightbox
  filter:        'all',     // 'all' | 'epique' | 'comique' | 'histoire'
  charFilter:    'all',     // 'all' | charId
  view:          'galerie', // 'galerie' | 'timeline'
  search:        '',
  timelineDesc:  false,     // true = plus récent en haut
  order:         [],        // miroir de l'ordre Firestore
};

let _achRowSortables = [];
let _achDragBlockClick = false;
let _achClickGuardInstalled = false;
let _achUploader = null;

let _achSelectCat = () => {};
let _achToggleContrib = () => {};

export function getAchievementsShellState() {
  return { items: STORE.items, filter: STORE.filter, view: STORE.view, search: STORE.search };
}

// ── MODAL PRINCIPAL ──────────────────────────────────────────────────────────
export function openAchievementModal(id = null) {
  const ex = id ? (STORE.items || []).find(a => a.id === id) : null;
  _achUploader?.destroy(); _achUploader = null;

  openModal(
    id ? `✏️ Modifier — ${ex?.titre || 'Haut-Fait'}` : '🏆 Nouveau Haut-Fait',
    `
    <div class="form-group">
      <label>Catégorie</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${CATS.map(c => `
          <button type="button" id="ach-cat-${c.id}" data-action="_achSelectCat" data-id="${c.id}"
            style="padding:0.4rem 0.9rem;border-radius:999px;font-size:0.8rem;cursor:pointer;
                   border:1px solid var(--border);background:transparent;
                   color:var(--text-muted);transition:all 0.15s;">
            ${c.label}
          </button>`).join('')}
      </div>
      <input type="hidden" id="ach-categorie" value="${ex?.categorie || 'epique'}">
    </div>

    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="ach-titre"
        value="${ex?.titre || ''}" placeholder="ex: L'œuf de Dragon">
    </div>

    <div class="form-group">
      <label>Description <span style="font-size:0.75rem;color:var(--text-dim)">(visible par les joueurs)</span></label>
      <textarea class="input-field" id="ach-desc" rows="3"
        placeholder="Ce qui s'est passé...">${ex?.description || ''}</textarea>
    </div>

    <div class="form-group">
      <label>Image</label>

      <!-- Zone de drop -->
      <div id="ach-drop-zone" style="
        border:2px dashed var(--border-strong);border-radius:12px;
        padding:1.2rem;text-align:center;cursor:pointer;
        transition:border-color 0.15s;background:var(--bg-elevated);
      ">
        <div id="ach-drop-preview"></div>
        <div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px">JPG · PNG · WebP — max 5 Mo</div>
      </div>

      <div id="ach-img-ready" style="display:none;font-size:0.75rem;text-align:center;margin-top:6px"></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
      <div class="form-group">
        <label>Emoji (si pas d'image)</label>
        <input class="input-field" id="ach-emoji"
          value="${ex?.emoji || '🏆'}" style="font-size:1.2rem">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" class="input-field" id="ach-date"
          value="${_toISO(ex?.date) || _todayISO()}">
      </div>
    </div>

    ${STATE.isAdmin ? `
    <div class="form-group" style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;border-radius:8px;background:rgba(180,127,255,0.08);border:1px solid rgba(180,127,255,0.18)">
      <input type="checkbox" id="ach-secret" ${ex?.secret ? 'checked' : ''}
        style="width:18px;height:18px;cursor:pointer;accent-color:#b47fff">
      <label for="ach-secret" style="margin:0;cursor:pointer;display:flex;flex-direction:column;gap:2px;flex:1">
        <span style="font-weight:600;font-size:.85rem;color:#b47fff">🔒 Haut-Fait secret (MJ uniquement)</span>
        <span style="font-size:.7rem;color:var(--text-dim);font-weight:400">Caché aux joueurs jusqu'à la révélation. Utile pour les prophéties, twists, récompenses surprise.</span>
      </label>
    </div>` : ''}

    ${(() => {
      const chars = sortCharactersForDisplay(STATE.characters || []);
      if (!chars.length) return '';
      const contrib = ex?.contributeurs || [];
      const COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
      return `<div class="form-group">
        <label>Personnages contributeurs <span style="font-size:.73rem;color:var(--text-dim);font-weight:400">(optionnel)</span></label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:.5rem;margin-top:.3rem">
          ${chars.map(c => {
            const isOn = contrib.includes(c.id);
            const col  = COLS[c.nom?.charCodeAt(0)%6||0];
            const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
            return `<div data-action="_achToggleContrib" data-id="${c.id}"
              id="ach-contrib-${c.id}"
              data-contrib-nom="${(c.nom||'?').replace(/"/g,'&quot;')}"
              style="display:flex;flex-direction:column;align-items:center;gap:.3rem;
                padding:.5rem .3rem;border-radius:10px;cursor:pointer;transition:all .15s;
                border:2px solid ${isOn?col:'var(--border)'};
                background:${isOn?col+'18':'var(--bg-elevated)'}">
              <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;
                border:2px solid ${isOn?col:'rgba(255,255,255,.1)'};
                background:${col}18;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                ${c.photo
                  ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
                  : `<span style="font-family:'Cinzel',serif;font-weight:700;font-size:.95rem;color:${col}">${(c.nom||'?')[0].toUpperCase()}</span>`}
              </div>
              <span style="font-size:.65rem;text-align:center;
                color:${isOn?col:'var(--text-dim)'};font-weight:${isOn?'700':'400'};
                line-height:1.2;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(c.nom||'?')}</span>
              ${isOn?`<div class="ach-dot" style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></div>`:''}
            </div>`;
          }).join('')}
        </div>
        <input type="hidden" id="ach-contributeurs" value="${contrib.join(',')}">
      </div>`;
    })()}

    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem"
      data-action="saveAchievement" data-id="${id || ''}">
      ${id ? 'Enregistrer les modifications' : 'Créer le Haut-Fait'}
    </button>
    `
  );

  // Sélecteur catégorie
  _achSelectCat = (catId) => {
    document.getElementById('ach-categorie').value = catId;
    CATS.forEach(c => {
      const btn    = document.getElementById(`ach-cat-${c.id}`);
      const active = c.id === catId;
      if (!btn) return;
      btn.style.borderColor = active ? c.color : 'var(--border)';
      btn.style.background  = active ? c.glow  : 'transparent';
      btn.style.color       = active ? c.color  : 'var(--text-muted)';
    });
  };
  _achSelectCat(ex?.categorie || 'epique');

  _achToggleContrib = (charId) => {
    const hidden = document.getElementById('ach-contributeurs');
    if (!hidden) return;
    const current = hidden.value ? hidden.value.split(',') : [];
    const idx     = current.indexOf(charId);
    const next    = idx >= 0 ? current.filter(x => x !== charId) : [...current, charId];
    hidden.value  = next.join(',');
    const card    = document.getElementById(`ach-contrib-${charId}`);
    if (!card) return;
    const active  = next.includes(charId);
    const COLS    = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
    const nom     = card.dataset.contribNom || '';
    const col     = COLS[nom.charCodeAt(0) % 6];
    card.style.borderColor = active ? col : 'var(--border)';
    card.style.background  = active ? col + '18' : 'var(--bg-elevated)';
    // Cercle portrait
    const circle = card.querySelector('div');
    if (circle) circle.style.borderColor = active ? col : 'rgba(255,255,255,.1)';
    // Nom
    const nameEl = card.querySelector('span');
    if (nameEl) { nameEl.style.color = active ? col : 'var(--text-dim)'; nameEl.style.fontWeight = active ? '700' : '400'; }
    // Point indicateur
    const dotEl  = card.querySelector('.ach-dot');
    if (active && !dotEl) {
      const dot = document.createElement('div');
      dot.className = 'ach-dot';
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0`;
      card.appendChild(dot);
    } else if (!active && dotEl) dotEl.remove();
  };

  // ── Upload + redimensionnement (max 1400px, JPEG .88, pas de crop) ────────
  _achUploader = attachDropAndResize({
    dropEl:       document.getElementById('ach-drop-zone'),
    previewEl:    document.getElementById('ach-drop-preview'),
    statusEl:     document.getElementById('ach-img-ready'),
    initialUrl:   ex?.imageUrl || '',
    resize:       { maxW: 1400, quality: 0.88 },
    maxFileSize:  5 * 1024 * 1024,
    onError:      (err) => showNotif(err.message || 'Image trop lourde.', 'error'),
  });
}

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveAchievement(id = '') {
  try {
    const titre = document.getElementById('ach-titre')?.value?.trim();
    if (!titre) { showNotif('Le titre est requis.', 'error'); return; }

    const uploaded = _achUploader?.getResult();
    const ex = id ? (STORE.items || []).find(a => a.id === id) : null;
    const imageUrl = typeof uploaded === 'string' ? uploaded : (ex?.imageUrl || '');

    const contribRaw = document.getElementById('ach-contributeurs')?.value || '';
    const contributeurs = contribRaw ? contribRaw.split(',').filter(Boolean) : [];
    const payload = {
      titre,
      categorie:    document.getElementById('ach-categorie')?.value || 'epique',
      description:  document.getElementById('ach-desc')?.value?.trim()  || '',
      imageUrl,
      emoji:        document.getElementById('ach-emoji')?.value?.trim() || '🏆',
      date:         document.getElementById('ach-date')?.value?.trim()  || '',
      contributeurs,
      secret:       !!document.getElementById('ach-secret')?.checked,
    };

    let docId = id;
    if (!id) {
      docId = `ach_${Date.now()}`;
      await saveDoc('achievements', docId, payload);
      const order = await _loadOrder();
      order.push(docId);
      await _saveOrder(order);
      if (STORE.items) STORE.items.push({ id: docId, ...payload });
    } else {
      await saveDoc('achievements', docId, payload);
      if (STORE.items) {
        STORE.items = STORE.items.map(a => a.id === id ? { id, ...payload } : a);
      }
    }

    _achUploader?.destroy(); _achUploader = null;
    closeModal();
    showNotif(id ? 'Haut-Fait mis à jour.' : `"${titre}" ajouté !`, 'success');
    await PAGES.achievements();
  } catch (e) { notifySaveError(e); }
}

// ── ÉDITER ────────────────────────────────────────────────────────────────────
async function editAchievement(id) {
  if (!STORE.items) STORE.items = await loadCollection('achievements');
  openAchievementModal(id);
}

// ── SUPPRIMER ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  try {
    if (!await confirmDelete('achievements', id, 'Supprimer ce haut-fait définitivement ?')) return;
    if (STORE.items) STORE.items = STORE.items.filter(a => a.id !== id);
    const order = (await _loadOrder()).filter(oid => oid !== id);
    await _saveOrder(order);
    showNotif('Haut-Fait supprimé.', 'success');
    await PAGES.achievements();
  } catch (e) { notifySaveError(e); }
}

// ── ORDRE ─────────────────────────────────────────────────────────────────────
async function _loadOrder() {
  const doc = await getDocData('achievements_meta', 'order');
  return Array.isArray(doc?.order) ? doc.order : [];
}
async function _saveOrder(order) {
  try {
    await saveDoc('achievements_meta', 'order', { order });
  } catch (e) { notifySaveError(e); }
}
function _applyOrder(items, order) {
  if (!order.length) return items;
  const map     = Object.fromEntries(items.map(a => [a.id, a]));
  const ordered = order.filter(id => map[id]).map(id => map[id]);
  const rest    = items.filter(a => !order.includes(a.id));
  return [...ordered, ...rest];
}

function _refreshAchievementCounters() {
  const all = STORE.items || [];
  const visible = STATE.isAdmin ? all : all.filter(a => !a.secret);
  const counts = { all: visible.length };
  CATS.forEach(c => {
    counts[c.id] = visible.filter(a => (a.categorie || 'epique') === c.id).length;
  });
  document.querySelectorAll('.hall-counter[data-filter]').forEach(el => {
    const num = el.querySelector('.hall-counter-num');
    if (num) num.textContent = counts[el.dataset.filter] ?? 0;
  });
}

function _mergeCategoryOrder(catId, catOrder, globalOrder) {
  const allIds      = (STORE.items || []).map(a => a.id);
  const globalIds   = globalOrder.filter(id => allIds.includes(id));
  const missingIds  = allIds.filter(id => !globalIds.includes(id));
  const fullOrder   = [...globalIds, ...missingIds];
  const catIds     = new Set((STORE.items || [])
    .filter(a => (a.categorie || 'epique') === catId)
    .map(a => a.id));
  const cleanOrder = catOrder.filter(id => catIds.has(id));
  const others     = fullOrder.filter(id => !catIds.has(id));
  const lastCatIdx = Math.max(-1, ...fullOrder.map((id, i) => catIds.has(id) ? i : -1));
  const firstOther = fullOrder.find((id, i) => !catIds.has(id) && i > lastCatIdx);

  if (!firstOther) return [...others, ...cleanOrder];

  const idx = others.indexOf(firstOther);
  return [...others.slice(0, idx), ...cleanOrder, ...others.slice(idx)];
}

async function _persistCategoryOrder(catId, orderedIds) {
  const merged = _mergeCategoryOrder(catId, orderedIds, await _loadOrder());
  await _saveOrder(merged);
  STORE.items = _applyOrder(STORE.items || [], merged);
  return merged;
}

function _installAchievementClickGuard() {
  if (_achClickGuardInstalled) return;
  _achClickGuardInstalled = true;
  document.addEventListener('click', (e) => {
    if (!_achDragBlockClick) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function _finishAchievementDrag() {
  document.body.classList.remove('ach-dragging');
  setTimeout(() => { _achDragBlockClick = false; }, 350);
}

function _destroyAchievementSortables() {
  _achRowSortables.forEach(sortable => sortable?.destroy());
  _achRowSortables = [];
}


// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupAchievementsDnd(catId) {
  if (!STATE.isAdmin || !catId) {
    _destroyAchievementSortables();
    return;
  }
  const grid = document.getElementById('ach-gallery');
  if (!grid) return;

  _installAchievementClickGuard();
  _destroyAchievementSortables();

  grid.querySelectorAll('.ach-row').forEach(row => {
    _achRowSortables.push(makeSortable(row, {
      prefix: 'ach',
      animation: 120,
      filter: 'button, a, input, select, textarea, .btn, .btn-icon, .ach-admin-btns',
      group: `achievements-${catId}`,
      draggable: '.ach-sortable-item',
      onStart: () => { document.body.classList.add('ach-dragging'); _achDragBlockClick = true; },
      onEnd: async (evt) => {
        _finishAchievementDrag();
        if (evt.oldIndex === evt.newIndex && evt.from === evt.to) return;
        const domOrder = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
        await _persistCategoryOrder(catId, domOrder);
        showNotif('Ordre sauvegardé.', 'success');
        await _achRebuildGallery(catId);
      },
    }));
  });
}

// ── LIGHTBOX IMAGE ────────────────────────────────────────────────────────────
function _achOpenImage(url) {
  // Overlay plein écran avec l'image agrandie, clic ou Escape pour fermer
  const existing = document.getElementById('ach-lightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.className = 'ach-lightbox-basic';

  overlay.innerHTML = `
    <img class="ach-lb-image-basic" src="${url}">
    <button class="ach-lb-close" type="button">✕</button>
  `;

  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 160); };
  overlay.addEventListener('click', close);
  overlay.querySelector('button').addEventListener('click', close);

  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

// ── JUSTIFIED LAYOUT ENGINE ───────────────────────────────────────────────────

const ACH_CATS = [
  { id:'epique',   label:'Épique',   emoji:'⚔️',  color:'#4f8cff', glow:'rgba(79,140,255,0.18)',  line:'rgba(79,140,255,0.35)'  },
  { id:'comique',  label:'Comique',  emoji:'🎭',  color:'#e8b84b', glow:'rgba(232,184,75,0.18)',  line:'rgba(232,184,75,0.35)'  },
  { id:'histoire', label:'Histoire', emoji:'📖',  color:'#22c38e', glow:'rgba(34,195,142,0.18)', line:'rgba(34,195,142,0.35)' },
];

// Mesure les aspect-ratios manquants en chargeant les images
async function _achMeasureRatios(items) {
  return Promise.all(items.map(item => {
    if (item.aspectRatio)  return Promise.resolve(item);
    if (!item.imageUrl)    return Promise.resolve({ ...item, aspectRatio: 1 });
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve({ ...item, aspectRatio: img.naturalWidth / img.naturalHeight });
      img.onerror = () => resolve({ ...item, aspectRatio: 4 / 3 });
      img.src = item.imageUrl;
    });
  }));
}

// Algorithme justified : même hauteur par rangée, largeurs proportionnelles au ratio
// Résultat garanti : conteneur W/H = ratio image → object-fit:cover sans aucun recadrage
function _achBuildRows(items, containerW, targetH, gap) {
  const rows = [];
  let row = [], naturalW = 0;

  const flush = (partial) => {
    const n      = row.length;
    const availW = containerW - (n - 1) * gap;
    const scale  = partial ? 1 : availW / naturalW;
    const h      = Math.round(targetH * scale);
    rows.push({ h, items: row.map(i => ({ ...i, w: Math.round(i._ratio * targetH * scale) })) });
    row = []; naturalW = 0;
  };

  for (const item of items) {
    const ratio = item.aspectRatio || 4 / 3;
    row.push({ ...item, _ratio: ratio });
    naturalW += ratio * targetH;
    if (naturalW + (row.length - 1) * gap >= containerW) flush(false);
  }
  if (row.length) flush(true); // dernière rangée partielle

  return rows;
}

// ── HTML d'une carte galerie ──────────────────────────────────────────────────
function _achCardHTML(item, isAdmin) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = sortCharactersForDisplay(STATE.characters || []);
  const contribs  = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);
  const cat       = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];

  const contribsHtml = contribs.length ? `
    <div class="ach-contribs">
      ${contribs.map(c => {
        const col      = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        const photoPos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
        return `<div class="ach-contrib" style="border-color:${col}55">
          <div class="ach-contrib-av" style="background:${col}22;color:${col};border-color:${col}">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
              : (c.nom || '?')[0].toUpperCase()}
          </div>
          <span class="ach-contrib-name" style="color:${col}">${_esc(c.nom || '?')}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const adminHtml = isAdmin ? `
    <div class="ach-admin-btns">
      <button class="btn btn-outline btn-sm" style="flex:1;font-size:.7rem"
        data-action="editAchievement" data-id="${item.id}" data-stop-propagation>✏️ Modifier</button>
      <button class="btn-icon" style="color:#ff6b6b"
        data-action="deleteAchievement" data-id="${item.id}" data-stop-propagation>🗑️</button>
    </div>` : '';

  const imageHtml = item.imageUrl
    ? `<img class="ach-img" src="${item.imageUrl}" loading="lazy" draggable="false">`
    : `<div class="ach-img-empty"><div class="ach-img-empty-emoji">${item.emoji || cat.emoji}</div></div>`;

  const secretBadge = (isAdmin && item.secret)
    ? `<div class="ach-secret-badge" title="Caché aux joueurs">🔒 Secret</div>` : '';

  const dateDisplay = _formatDateFr(item.date);
  return `
    <div class="ach-cat-badge">${cat.emoji} ${cat.label}</div>
    ${dateDisplay ? `<div class="ach-date-badge">${_esc(dateDisplay)}</div>` : ''}
    ${secretBadge}
    ${imageHtml}
    <div class="ach-meta">
      <div class="ach-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-desc">${_esc(item.description)}</div>` : ''}
      ${contribsHtml}
      ${adminHtml}
    </div>`;
}

// ── Rendu justified dans le conteneur ────────────────────────────────────────
async function _achRenderJustified(catId, items, container) {
  const withRatios = await _achMeasureRatios(items);
  withRatios.forEach(item => {
    const idx = (STORE.items || []).findIndex(a => a.id === item.id);
    if (idx >= 0) STORE.items[idx] = { ...STORE.items[idx], aspectRatio: item.aspectRatio };
  });

  const containerW = container.clientWidth || 900;
  const w = window.innerWidth;
  const targetH = w < 600 ? 150 : w < 1024 ? 220 : w < 1440 ? 300 : w < 1920 ? 380 : 440;
  const gap     = 10;
  const rows       = _achBuildRows(withRatios, containerW, targetH, gap);
  const isAdmin    = STATE.isAdmin;

  container.innerHTML = rows.map((row, rowIdx) => `
    <div class="ach-row" style="height:${row.h}px">
      ${row.items.map((item, colIdx) => {
        const icat    = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
        const noDesc  = !item.description ? ' no-desc' : '';
        const delay   = (rowIdx * 4 + colIdx) * 30;
        return `<div class="ach-item${isAdmin ? ' ach-sortable-item' : ''}${noDesc}" data-ach-id="${item.id}"
          style="width:${item.w}px;height:${row.h}px;--c:${icat.color};--c-glow:${icat.glow};--c-line:${icat.line};animation-delay:${delay}ms;${isAdmin ? 'cursor:grab' : ''}"
          data-action="_achOpenLightbox" data-id="${item.id}">
          ${_achCardHTML(item, isAdmin)}
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ── Rebuild galerie après DnD ─────────────────────────────────────────────────
async function _achRebuildGallery(catId) {
  const grid = document.getElementById('ach-gallery');
  if (!grid) return;
  const itemsById  = Object.fromEntries((STORE.items || []).map(a => [a.id, a]));
  const orderedIds = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
  const ordered    = orderedIds.map(id => itemsById[id]).filter(Boolean);
  await _achRenderJustified(catId, ordered, grid);
  setupAchievementsDnd(catId);
}

// ── parseDate helper ──────────────────────────────────────────────────────────
// Accepte plusieurs formats : "15 mars 2024", "15/03/2024", "15-03-2024",
// "2024-03-15" (ISO), "15.03.2024". Retourne le timestamp ms ou 0 si invalide.
const _MOIS = {
  janvier:0, fevrier:1, février:1, mars:2, avril:3, mai:4, juin:5,
  juillet:6, aout:7, août:7, septembre:8, octobre:9, novembre:10,
  decembre:11, décembre:11,
  // formes abrégées courantes
  janv:0, fevr:1, févr:1, juil:6, sept:8, oct:9, nov:10, dec:11, déc:11,
};
function parseDate(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (!s) return 0;

  // ISO yyyy-mm-dd (ou yyyy/mm/dd)
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime() || 0;

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (français)
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]).getTime() || 0;
  }

  // "15 mars 2024" — mois en lettres (avec ou sans accent)
  m = s.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{2,4})/);
  if (m) {
    const moisKey = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const moisIdx = _MOIS[moisKey] ?? _MOIS[m[2].toLowerCase()];
    if (moisIdx == null) return 0;
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, moisIdx, +m[1]).getTime() || 0;
  }

  return 0;
}

// ── helpers date : ISO (stockage / input) vs FR (affichage) ──────────────────
function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _toISO(str) {
  const ts = parseDate(str);
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _formatDateFr(str) {
  const ts = parseDate(str);
  if (!ts) return str ? String(str) : '';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Timeline HTML ─────────────────────────────────────────────────────────────
function _renderTimeline(items) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars   = sortCharactersForDisplay(STATE.characters || []);
  const isAdmin = STATE.isAdmin;
  // Tri chronologique. Les hauts-faits sans date valide sont relégués à la fin
  // (peu importe le sens du tri). Sens contrôlé par STORE.timelineDesc.
  const desc = !!STORE.timelineDesc;
  const sorted = [...items].sort((a, b) => {
    const da = parseDate(a.date), db = parseDate(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return desc ? db - da : da - db;
  });

  if (!sorted.length) return '';

  const cardHTML = (item, side) => {
    const cat     = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
    const contribs = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);
    const imgEl   = item.imageUrl
      ? `<img class="tl-card-img" src="${item.imageUrl}" loading="lazy">`
      : `<div class="tl-card-empty" style="--c-glow:${cat.glow}">${item.emoji || cat.emoji}</div>`;
    const contribsEl = contribs.length ? `
      <div class="tl-card-contribs">
        ${contribs.map(c => {
          const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
          const pos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
          return `<div class="tl-card-contrib" style="border-color:${col}55;color:${col}">
            <div class="tl-card-contrib-av" style="background:${col}22;color:${col}">
              ${c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${pos}">` : (c.nom||'?')[0]}
            </div>
            ${_esc(c.nom || '?')}
          </div>`;
        }).join('')}
      </div>` : '';
    const adminEl = isAdmin ? `
      <div class="tl-card-admin">
        <button class="btn btn-outline btn-sm" style="flex:1;font-size:.7rem"
          data-action="editAchievement" data-id="${item.id}" data-stop-propagation>✏️ Modifier</button>
        <button class="btn-icon" style="color:#ff6b6b"
          data-action="deleteAchievement" data-id="${item.id}" data-stop-propagation>🗑️</button>
      </div>` : '';

    const secretBadge = (isAdmin && item.secret)
      ? `<div class="ach-secret-badge" style="position:absolute;top:8px;right:8px;z-index:3">🔒 Secret</div>` : '';
    return `<div class="tl-card" style="--c:${cat.color};--c-glow:${cat.glow};--c-line:${cat.line};position:relative"
      ${item.imageUrl ? `data-action="_achOpenLightbox" data-id="${item.id}"` : ''}>
      ${imgEl}
      ${secretBadge}
      <div class="tl-card-body">
        <div class="tl-card-cat" style="background:${cat.glow};border:1px solid ${cat.line};color:${cat.color}">${cat.emoji} ${cat.label}</div>
        <div class="tl-card-title">${_esc(item.titre || 'Haut-Fait')}</div>
        ${item.description ? `<div class="tl-card-desc">${_esc(item.description)}</div>` : ''}
        ${contribsEl}
        ${adminEl}
      </div>
    </div>`;
  };

  return `<div class="timeline">
    ${sorted.map((item, idx) => {
      const side  = idx % 2 === 0 ? 'left' : 'right';
      const cat   = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
      const delay = `${idx * 60}ms`;
      return `<div class="tl-item ${side}" style="animation-delay:${delay}">
        ${side === 'left'  ? cardHTML(item, side) : '<div class="tl-spacer"></div>'}
        <div class="tl-node-wrap">
          <div class="tl-node">
            <div class="tl-node-dot" style="--c:${cat.color};--c-glow:${cat.glow}">${cat.emoji}</div>
            ${(() => { const d = _formatDateFr(item.date); return d ? `<div class="tl-node-date" style="color:${cat.color}">${_esc(d)}</div>` : ''; })()}
          </div>
        </div>
        ${side === 'right' ? cardHTML(item, side) : '<div class="tl-spacer"></div>'}
      </div>`;
    }).join('')}
  </div>`;
}

// ── Barre additionnelle : chips par perso + sens timeline ────────────────────
function _achRenderControlsExtras() {
  // On l'injecte au-dessus de #ach-content, à l'intérieur de .hall-content
  const root = document.querySelector('.hall-content');
  if (!root) return;
  let bar = document.getElementById('ach-extra-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ach-extra-bar';
    bar.className = 'ach-extra-bar';
    root.insertBefore(bar, root.firstChild);
  }

  // Chips perso : seulement ceux qui ont au moins 1 HF visible pour l'utilisateur
  const all = STORE.items || [];
  const visible = STATE.isAdmin ? all : all.filter(a => !a.secret);
  const counts = new Map();
  visible.forEach(a => (a.contributeurs || []).forEach(cid => counts.set(cid, (counts.get(cid)||0)+1)));
  const chars = (STATE.characters || []).filter(c => counts.has(c.id));
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const active = STORE.charFilter || 'all';
  const isTimeline = (STORE.view || 'galerie') === 'timeline';
  const desc = !!STORE.timelineDesc;

  const charChips = chars.length ? `
    <div class="ach-char-filter">
      <button class="ach-char-chip${active==='all'?' active':''}" data-charid="all"
        data-action="_achSetCharFilter" title="Tous les personnages">👥 Tous</button>
      ${chars.map(c => {
        const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        const pos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
        const isOn = active === c.id;
        return `<button class="ach-char-chip${isOn?' active':''}" data-charid="${c.id}"
          data-action="_achSetCharFilter"
          style="--c:${col}" title="${_esc(c.nom||'?')} — ${counts.get(c.id)} haut${counts.get(c.id)>1?'s':''}-fait${counts.get(c.id)>1?'s':''}">
          <span class="ach-char-chip-av">
            ${c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${pos}">`
                      : `<span style="font-family:'Cinzel',serif;font-weight:700">${(c.nom||'?')[0].toUpperCase()}</span>`}
          </span>
          <span class="ach-char-chip-name">${_esc((c.nom||'?').slice(0,12))}</span>
          <span class="ach-char-chip-count">${counts.get(c.id)}</span>
        </button>`;
      }).join('')}
    </div>` : '';

  const sortBtn = isTimeline ? `
    <button class="ach-sort-toggle" data-action="_achToggleTimelineDir"
      title="Inverser le sens de la chronologie">
      ${desc ? '↓ Plus récent en haut' : '↑ Plus ancien en haut'}
    </button>` : '';

  bar.innerHTML = charChips + sortBtn;
  bar.style.display = (charChips || sortBtn) ? 'flex' : 'none';
}

// ── Rendu du contenu (filtre + vue) ──────────────────────────────────────────
async function _achRenderContent() {
  const contentEl = document.getElementById('ach-content');
  if (!contentEl) return;
  _refreshAchievementCounters();
  _achRenderControlsExtras();

  const all        = STORE.items || [];
  const filter     = STORE.filter || 'all';
  const charFilter = STORE.charFilter || 'all';
  const search     = (STORE.search || '').trim().toLowerCase();
  const isAdmin    = STATE.isAdmin;

  // 1. Filtre secret (joueurs ne voient pas les HF secrets)
  let filtered = isAdmin ? all : all.filter(a => !a.secret);
  // 2. Filtre catégorie
  if (filter !== 'all') filtered = filtered.filter(a => (a.categorie || 'epique') === filter);
  // 3. Filtre par perso contributeur
  if (charFilter !== 'all') filtered = filtered.filter(a => (a.contributeurs || []).includes(charFilter));
  // 4. Recherche
  if (search) {
    filtered = filtered.filter(a =>
      (a.titre || '').toLowerCase().includes(search) ||
      (a.description || '').toLowerCase().includes(search)
    );
  }

  // Map lightbox (limitée aussi pour les joueurs : pas d'ouverture d'un HF secret)
  const visibleForLightbox = isAdmin ? all : all.filter(a => !a.secret);
  STORE.lightboxItems = Object.fromEntries(visibleForLightbox.map(a => [a.id, a]));

  if (!filtered.length) {
    const catDef = ACH_CATS.find(c => c.id === filter);
    const charName = charFilter !== 'all'
      ? ((STATE.characters || []).find(c => c.id === charFilter)?.nom || 'ce personnage')
      : null;
    let title = 'Aucun haut-fait';
    let sub = STATE.isAdmin ? 'Ajoutez le premier !' : '';
    if (search) { title = 'Aucun résultat'; sub = `pour « ${_esc(search)} »`; }
    else if (charName) { title = `Aucun haut-fait`; sub = `pour « ${_esc(charName)} »`; }
    contentEl.innerHTML = `
      <div class="hall-empty">
        <div class="hall-empty-icon">${catDef?.emoji || '🏆'}</div>
        <div class="hall-empty-title">${title}</div>
        <div class="hall-empty-sub">${sub}</div>
      </div>`;
    return;
  }

  if ((STORE.view || 'galerie') === 'timeline') {
    contentEl.innerHTML = _renderTimeline(filtered);
    return;
  }

  // Galerie justified
  const galleryEl = document.createElement('div');
  galleryEl.id        = 'ach-gallery';
  galleryEl.className = 'ach-justified';
  contentEl.innerHTML = '';
  contentEl.appendChild(galleryEl);

  await _achRenderJustified(filter, filtered, galleryEl);
  setupAchievementsDnd(filter !== 'all' ? filter : null);
}

// ── Actions état (appelées depuis les boutons HTML) ───────────────────────────
function _achSetFilter(filter) {
  STORE.filter = filter;
  document.querySelectorAll('.hall-counter').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === filter);
  });
  _achRenderContent();
};
function _achSetView(view) {
  STORE.view = view;
  document.querySelectorAll('.view-tab').forEach((btn, i) => {
    btn.classList.toggle('active', i === (view === 'timeline' ? 1 : 0));
  });
  _achRenderContent();
};
let _achSearchTimer = null;
function _achSetSearch(val) {
  STORE.search = val;
  clearTimeout(_achSearchTimer);
  _achSearchTimer = setTimeout(_achRenderContent, 240);
};
function _achSetCharFilter(charId) {
  STORE.charFilter = charId || 'all';
  document.querySelectorAll('.ach-char-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.charid === STORE.charFilter);
  });
  _achRenderContent();
};
function _achToggleTimelineDir() {
  STORE.timelineDesc = !STORE.timelineDesc;
  _achRenderContent();
};

// ── LIGHTBOX ENRICHIE ─────────────────────────────────────────────────────────
function _achOpenLightbox(itemId) {
  const item = (STORE.lightboxItems || {})[itemId] || (STORE.items || []).find(a => a.id === itemId);
  if (!item) return;
  const cat       = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = sortCharactersForDisplay(STATE.characters || []);
  const contribs  = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);

  const existing = document.getElementById('ach-lightbox');
  if (existing) existing.remove();

  const contribsHtml = contribs.length ? `
    <div class="ach-lb-contribs">
      ${contribs.map(c => {
        const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        return `<span style="display:flex;align-items:center;gap:4px;font-size:.68rem;color:${col}">
          <span style="width:16px;height:16px;border-radius:50%;background:${col}22;border:1px solid ${col};
            display:flex;align-items:center;justify-content:center;font-size:.55rem;font-family:'Cinzel',serif;font-weight:700">
            ${(c.nom||'?')[0]}
          </span>${_esc(c.nom || '?')}</span>`;
      }).join('')}
    </div>` : '';

  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.className = 'ach-lightbox-rich';
  overlay.innerHTML = `
    ${item.imageUrl ? `<img class="ach-lb-image-rich" src="${item.imageUrl}">` : ""}
    <div class="ach-lb-info${item.imageUrl ? "" : " is-empty"}">
      <div class="ach-lb-cat" style="background:${cat.glow};border-color:${cat.line};color:${cat.color}">${cat.emoji} ${cat.label}</div>
      <div class="ach-lb-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-lb-desc">${_esc(item.description)}</div>` : ''}
      ${contribsHtml}
    </div>
    <button class="ach-lb-close" type="button">✕</button>
  `;

  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 160); };
  overlay.addEventListener('click', close);
  overlay.querySelector('button').addEventListener('click', e => { e.stopPropagation(); close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
// ── OVERRIDE PAGES.ACHIEVEMENTS ───────────────────────────────────────────────
const _origPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  const [items, order] = await Promise.all([
    loadCollection('achievements'),
    _loadOrder(),
  ]);
  STORE.order    = order;
  STORE.items = _applyOrder(items || [], order);
  STORE.filter ??= 'all';
  STORE.view   ??= 'galerie';
  STORE.search ??= '';
  PAGES._achievementsShellState = getAchievementsShellState();

  await _origPage();    // génère le shell (hero + controls + #ach-content)
  await _achRenderContent();

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // On évite de re-render pendant un drag SortableJS pour ne pas casser
  // l'instance en cours ; les saves admin re-render explicitement après onEnd.
  // unwatchAll() côté navigation s'occupe du cleanup.
  watch('ach-items', 'achievements', items => {
    if (STATE.currentPage !== 'achievements') return;
    if (document.body.classList.contains('ach-dragging')) return;
    STORE.items = _applyOrder(items || [], STORE.order);
    _achRenderContent();
  });

  watchDoc('ach-order', 'achievements_meta', 'order', doc => {
    if (STATE.currentPage !== 'achievements') return;
    if (document.body.classList.contains('ach-dragging')) return;
    STORE.order    = Array.isArray(doc?.order) ? doc.order : [];
    STORE.items = _applyOrder(STORE.items || [], STORE.order);
    _achRenderContent();
  });
};

registerActions({
  _achSetSearch:         (el)  => _achSetSearch(el.value),
  _achSetFilter:         (btn) => _achSetFilter(btn.dataset.val),
  _achSetView:           (btn) => _achSetView(btn.dataset.val),
  openAchievementModal:  ()    => openAchievementModal(),
  _achSelectCat:         (btn) => _achSelectCat(btn.dataset.id),
  _achToggleContrib:     (btn) => _achToggleContrib(btn.dataset.id),
  saveAchievement:       (btn) => saveAchievement(btn.dataset.id || ''),
  editAchievement:       (btn) => editAchievement(btn.dataset.id),
  deleteAchievement:     (btn) => deleteAchievement(btn.dataset.id),
  _achOpenLightbox:      (btn) => _achOpenLightbox(btn.dataset.id),
  _achSetCharFilter:     (btn) => _achSetCharFilter(btn.dataset.charid),
  _achToggleTimelineDir: ()    => _achToggleTimelineDir(),
});
