// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// ✓ Upload + redimensionnement image (ratio libre, max 1400px, fond flou à l'affichage)
// ✓ Hauts-faits sans image affichés correctement (emoji + fond)
// ✓ Drag & drop SortableJS pour réordonner, ordre persisté dans Firestore
// ✓ Ordre partagé pour tous les utilisateurs
// ══════════════════════════════════════════════════════════════════════════════
import Sortable from '../vendor/sortable.esm.js';
import { loadCollection, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { STATE } from '../core/state.js';
import { attachDropAndResize } from '../shared/image-crop.js';
import PAGES from './pages.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const CATS = [
  { id: 'epique',   label: '⚔️ Épique',   color: '#4f8cff', glow: 'rgba(79,140,255,0.14)'  },
  { id: 'comique',  label: '🎭 Comique',  color: '#e8b84b', glow: 'rgba(232,184,75,0.14)'  },
  { id: 'histoire', label: '📖 Histoire', color: '#22c38e', glow: 'rgba(34,195,142,0.14)'  },
];

let _achRowSortables = [];
let _achDragBlockClick = false;
let _achClickGuardInstalled = false;
let _achUploader = null;

// ── MODAL PRINCIPAL ──────────────────────────────────────────────────────────
function openAchievementModal(id = null) {
  const ex = id ? (window._achItems || []).find(a => a.id === id) : null;
  _achUploader?.destroy(); _achUploader = null;

  openModal(
    id ? `✏️ Modifier — ${ex?.titre || 'Haut-Fait'}` : '🏆 Nouveau Haut-Fait',
    `
    <div class="form-group">
      <label>Catégorie</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${CATS.map(c => `
          <button type="button" id="ach-cat-${c.id}" onclick="window._achSelectCat('${c.id}')"
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
        <input class="input-field" id="ach-date"
          value="${ex?.date || new Date().toLocaleDateString('fr-FR')}">
      </div>
    </div>

    ${(() => {
      const chars = STATE.characters || [];
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
            return `<div onclick="window._achToggleContrib('${c.id}')"
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
      onclick="window.saveAchievement('${id || ''}')">
      ${id ? 'Enregistrer les modifications' : 'Créer le Haut-Fait'}
    </button>
    `
  );

  // Sélecteur catégorie
  window._achSelectCat = (catId) => {
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
  window._achSelectCat(ex?.categorie || 'epique');

  window._achToggleContrib = (charId) => {
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
    const ex = id ? (window._achItems || []).find(a => a.id === id) : null;
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
    };

    let docId = id;
    if (!id) {
      docId = `ach_${Date.now()}`;
      await saveDoc('achievements', docId, payload);
      const order = await _loadOrder();
      order.push(docId);
      await _saveOrder(order);
      if (window._achItems) window._achItems.push({ id: docId, ...payload });
    } else {
      await saveDoc('achievements', docId, payload);
      if (window._achItems) {
        window._achItems = window._achItems.map(a => a.id === id ? { id, ...payload } : a);
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
  if (!window._achItems) window._achItems = await loadCollection('achievements');
  openAchievementModal(id);
}

// ── SUPPRIMER ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  try {
    if (!await confirmModal('Supprimer ce haut-fait définitivement ?')) return;
    await deleteFromCol('achievements', id);
    if (window._achItems) window._achItems = window._achItems.filter(a => a.id !== id);
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

function _mergeCategoryOrder(catId, catOrder, globalOrder) {
  const allIds      = (window._achItems || []).map(a => a.id);
  const globalIds   = globalOrder.filter(id => allIds.includes(id));
  const missingIds  = allIds.filter(id => !globalIds.includes(id));
  const fullOrder   = [...globalIds, ...missingIds];
  const catIds     = new Set((window._achItems || [])
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
  window._achItems = _applyOrder(window._achItems || [], merged);
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

function _achievementSortableOptions(overrides = {}) {
  return {
    animation: 120,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    filter: 'button, a, input, select, textarea, .btn, .btn-icon, .ach-admin-btns',
    preventOnFilter: false,
    ghostClass: 'ach-sortable-ghost',
    chosenClass: 'ach-sortable-chosen',
    dragClass: 'ach-sortable-drag',
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 5,
    delay: 150,
    delayOnTouchOnly: true,
    touchStartThreshold: 5,
    onStart: () => {
      document.body.classList.add('ach-dragging');
      _achDragBlockClick = true;
    },
    ...overrides,
  };
}

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupAchievementsDnd(catId) {
  if (!STATE.isAdmin) {
    _destroyAchievementSortables();
    return;
  }
  const grid = document.getElementById(`ach-grid-${catId}`);
  if (!grid) return;

  _installAchievementClickGuard();
  _destroyAchievementSortables();

  grid.querySelectorAll('.ach-row').forEach(row => {
    _achRowSortables.push(new Sortable(row, _achievementSortableOptions({
      group: `achievements-${catId}`,
      draggable: '.ach-sortable-item',
      onEnd: async (evt) => {
        _finishAchievementDrag();
        if (evt.oldIndex === evt.newIndex && evt.from === evt.to) return;

        const domOrder = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
        await _persistCategoryOrder(catId, domOrder);
        showNotif('Ordre sauvegardé.', 'success');
        await _achRebuildJustified(catId);
      },
    })));
  });
}

// ── LIGHTBOX IMAGE ────────────────────────────────────────────────────────────
function _achOpenImage(url) {
  // Overlay plein écran avec l'image agrandie, clic ou Escape pour fermer
  const existing = document.getElementById('ach-lightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.92)',
    'display:flex;align-items:center;justify-content:center',
    'cursor:zoom-out',
    'animation:achLbFade .18s ease',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes achLbFade { from { opacity:0 } to { opacity:1 } }
      @keyframes achLbScale { from { transform:scale(.92) } to { transform:scale(1) } }
    </style>
    <img src="${url}"
      style="max-width:92vw;max-height:90vh;object-fit:contain;border-radius:12px;
             box-shadow:0 24px 80px rgba(0,0,0,.8);
             animation:achLbScale .18s ease;pointer-events:none;display:block">
    <button style="position:absolute;top:20px;right:24px;background:rgba(255,255,255,.1);
      border:1px solid rgba(255,255,255,.2);border-radius:999px;
      color:#fff;font-size:1.2rem;width:40px;height:40px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:background .15s">✕</button>
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
  { id:'epique',   label:'Épique',   emoji:'⚔️',  color:'#4f8cff', glow:'rgba(79,140,255,0.14)' },
  { id:'comique',  label:'Comique',  emoji:'🎭',  color:'#e8b84b', glow:'rgba(232,184,75,0.14)' },
  { id:'histoire', label:'Histoire', emoji:'📖',  color:'#22c38e', glow:'rgba(34,195,142,0.14)' },
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

// HTML d'une carte dans le justified layout
function _achCardHTML(item, cat, isAdmin) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = STATE.characters || [];
  const contribs  = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);

  const contribsHtml = contribs.length ? `
    <div class="ach-contribs">
      ${contribs.map(c => {
        const col      = CHAR_COLS[c.nom?.charCodeAt(0) % 6 || 0];
        const photoPos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
        return `<div class="ach-contrib-pill" style="border-color:${col}50">
          <div class="ach-contrib-avatar" style="background:${col}22;color:${col}">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
              : (c.nom || '?')[0].toUpperCase()}
          </div>
          <span class="ach-contrib-name">${_esc(c.nom || '?')}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const adminHtml = isAdmin ? `
    <div class="ach-admin-btns">
      <button class="btn btn-outline btn-sm" style="flex:1;font-size:.7rem"
        onclick="event.stopPropagation();editAchievement('${item.id}')">✏️ Modifier</button>
      <button class="btn-icon" style="color:#ff6b6b"
        onclick="event.stopPropagation();deleteAchievement('${item.id}')">🗑️</button>
    </div>` : '';

  const imageHtml = item.imageUrl
    ? `<img src="${item.imageUrl}" loading="lazy" draggable="false">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
         font-size:3.5rem;background:linear-gradient(135deg,${cat.glow},var(--bg-panel))">${item.emoji || cat.emoji}</div>`;

  return `
    <div class="ach-badge-cat" style="color:${cat.color};border-color:${cat.color}55">${cat.emoji} ${cat.label}</div>
    ${item.date ? `<div class="ach-badge-date">${item.date}</div>` : ''}
    ${imageHtml}
    <div class="ach-meta">
      <div class="ach-meta-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-meta-desc">${_esc(item.description)}</div>` : ''}
      ${contribsHtml}
      ${adminHtml}
    </div>`;
}

// Rendu justified dans le conteneur
async function _achRenderJustified(catId, items, cat, container) {
  const withRatios = await _achMeasureRatios(items);

  // Stocker les ratios mesurés pour les rebuilds DnD
  withRatios.forEach(item => {
    const idx = (window._achItems || []).findIndex(a => a.id === item.id);
    if (idx >= 0) window._achItems[idx] = { ...window._achItems[idx], aspectRatio: item.aspectRatio };
  });

  const containerW = container.clientWidth || 900;
  const targetH    = window.innerWidth < 1024 ? (window.innerWidth < 600 ? 150 : 220) : 340;
  const gap        = 10;
  const rows       = _achBuildRows(withRatios, containerW, targetH, gap);
  const isAdmin    = STATE.isAdmin;

  container.innerHTML = rows.map(row => `
    <div class="ach-row" style="height:${row.h}px">
      ${row.items.map(item => `
        <div class="ach-item ${isAdmin ? 'ach-sortable-item' : ''}" data-ach-id="${item.id}"
          style="width:${item.w}px;height:${row.h}px;${isAdmin ? 'cursor:grab' : ''}"
          ${item.imageUrl ? `onclick="window._achOpenImage('${item.imageUrl.replace(/'/g, "\\'")}')"` : ''}>
          ${_achCardHTML(item, cat, isAdmin)}
        </div>`).join('')}
    </div>`).join('');
}

// Rebuild après réordonnancement DnD (lit l'ordre DOM, recalcule le layout)
async function _achRebuildJustified(catId) {
  const grid = document.getElementById(`ach-grid-${catId}`);
  const cat  = ACH_CATS.find(c => c.id === catId);
  if (!grid || !cat) return;

  const itemsById  = Object.fromEntries((window._achItems || []).map(a => [a.id, a]));
  const orderedIds = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
  const ordered    = orderedIds.map(id => itemsById[id]).filter(Boolean);

  await _achRenderJustified(catId, ordered, cat, grid);
  setupAchievementsDnd(catId);
}
window._achRebuildJustified = _achRebuildJustified;

// ── OVERRIDE PAGES.ACHIEVEMENTS ───────────────────────────────────────────────
const _origPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  const [items, order] = await Promise.all([
    loadCollection('achievements'),
    _loadOrder(),
  ]);
  window._achItems = _applyOrder(items, order);
  await _origPage();

  // Justified layout pour la catégorie active
  const catId  = window._achCat || 'epique';
  const cat    = ACH_CATS.find(c => c.id === catId);
  const grid   = document.getElementById(`ach-grid-${catId}`);
  const catItems = (window._achItems || []).filter(a => (a.categorie || 'epique') === catId);

  if (cat && grid && catItems.length) {
    await _achRenderJustified(catId, catItems, cat, grid);
    setupAchievementsDnd(catId);
  }
};

// ── EXPORTS ───────────────────────────────────────────────────────────────────
Object.assign(window, {
  openAchievementModal,
  saveAchievement,
  editAchievement,
  deleteAchievement,
  setupAchievementsDnd,
  _achOpenImage,
});
