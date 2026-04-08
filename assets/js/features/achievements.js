// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// ✓ Upload + recadrage d'image canvas (ratio 4:3 forcé, 8 poignées)
// ✓ Hauts-faits sans image affichés correctement (emoji + fond)
// ✓ Drag & drop précis pour réordonner, ordre persisté dans Firestore
// ✓ Ordre partagé pour tous les utilisateurs
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { _crop, _clamp, bindImageDropZone, confirmCanvasCrop, getCroppedBase64, resetCrop } from '../shared/image-upload.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const CATS = [
  { id: 'epique',   label: '⚔️ Épique',   color: '#4f8cff', glow: 'rgba(79,140,255,0.14)'  },
  { id: 'comique',  label: '🎭 Comique',  color: '#e8b84b', glow: 'rgba(232,184,75,0.14)'  },
  { id: 'histoire', label: '📖 Histoire', color: '#22c38e', glow: 'rgba(34,195,142,0.14)'  },
];

// _crop → géré par shared/image-upload.js

// ── MODAL PRINCIPAL ──────────────────────────────────────────────────────────
function openAchievementModal(id = null) {
  const ex = id ? (window._achItems || []).find(a => a.id === id) : null;
  _crop.base64 = null;

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
      "
        onclick="document.getElementById('ach-file').click()"
        ondragover="event.preventDefault();this.style.borderColor='var(--gold)'"
        ondragleave="this.style.borderColor='var(--border-strong)'"
        ondrop="event.preventDefault();this.style.borderColor='var(--border-strong)';window._achFile(event.dataTransfer.files[0])">
        <div id="ach-drop-preview">
          ${ex?.imageUrl
            ? `<img src="${ex.imageUrl}" style="max-height:80px;border-radius:8px;max-width:100%">`
            : `<div style="font-size:2rem;margin-bottom:4px">🖼️</div>`}
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">
          Glisser une image ou <span style="color:var(--gold)">cliquer pour choisir</span>
        </div>
        <div style="font-size:0.7rem;color:var(--text-dim);margin-top:2px">JPG · PNG · WebP — max 5 Mo</div>
      </div>

      <!-- Zone crop (cachée initialement) -->
      <div id="ach-crop-wrap" style="display:none;margin-top:1rem">
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.5rem">
          Déplacez et redimensionnez la sélection — ratio 4:3 verrouillé
        </div>
        <canvas id="ach-crop-canvas"
          style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none">
        </canvas>
        <button type="button" class="btn btn-gold btn-sm"
          style="margin-top:0.6rem;width:100%" onclick="window._achConfirmCrop()">
          ✂️ Confirmer le recadrage
        </button>
        <div id="ach-crop-ok" style="display:none;font-size:0.75rem;color:var(--green);text-align:center;margin-top:4px">
          ✓ Image recadrée
        </div>
      </div>
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

  // ── Input file créé en JS (évite l'orphelin DOM via innerHTML) ────────────
  const achFileInput = document.createElement('input');
  achFileInput.type   = 'file';
  achFileInput.id     = 'ach-file';
  achFileInput.accept = 'image/*';
  achFileInput.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none';
  document.body.appendChild(achFileInput);

  const handleAchFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { showNotif('Image trop lourde (max 5 Mo).', 'error'); return; }
    const r = new FileReader();
    r.onload = (e) => _initCrop(e.target.result);
    r.readAsDataURL(file);
  };

  achFileInput.addEventListener('change', () => handleAchFile(achFileInput.files[0]));
  window._achFile = handleAchFile;

  // Rebind la drop zone avec addEventListener (pas onclick inline)
  const achDropZone = document.getElementById('ach-drop-zone');
  if (achDropZone) {
    achDropZone.onclick     = () => achFileInput.click();
    achDropZone.ondragover  = (e) => { e.preventDefault(); achDropZone.style.borderColor = 'var(--gold)'; };
    achDropZone.ondragleave = ()  => { achDropZone.style.borderColor = 'var(--border-strong)'; };
    achDropZone.ondrop      = (e) => { e.preventDefault(); achDropZone.style.borderColor = 'var(--border-strong)'; handleAchFile(e.dataTransfer.files[0]); };
  }

  // Nettoyer quand le modal se ferme
  const achObs = new MutationObserver(() => {
    if (!document.getElementById('ach-drop-zone')) { achFileInput.remove(); achObs.disconnect(); }
  });
  achObs.observe(document.body, { childList: true, subtree: true });
}

// ── CROPPER ───────────────────────────────────────────────────────────────────
function _initCrop(dataUrl) {
  const wrap    = document.getElementById('ach-crop-wrap');
  const canvas  = document.getElementById('ach-crop-canvas');
  const preview = document.getElementById('ach-drop-preview');
  if (!wrap || !canvas) return;

  _crop.base64 = null;
  document.getElementById('ach-crop-ok').style.display = 'none';
  wrap.style.display = 'block';

  const img = new Image();
  img.onload = () => {
    _crop.img   = img;
    _crop.natW  = img.naturalWidth;
    _crop.natH  = img.naturalHeight;

    // Canvas affiché à max 400px de large
    const maxW        = Math.min(400, img.naturalWidth);
    _crop.dispScale   = maxW / img.naturalWidth;
    canvas.width      = img.naturalWidth;
    canvas.height     = img.naturalHeight;
    canvas.style.width  = maxW + 'px';
    canvas.style.height = Math.round(img.naturalHeight * _crop.dispScale) + 'px';

    // Sélection initiale 4:3 centrée, 80% de la largeur
    const R = 4 / 3;
    let w = img.naturalWidth  * 0.8;
    let h = w / R;
    if (h > img.naturalHeight * 0.8) { h = img.naturalHeight * 0.8; w = h * R; }
    _crop.cropX = Math.round((img.naturalWidth  - w) / 2);
    _crop.cropY = Math.round((img.naturalHeight - h) / 2);
    _crop.cropW = Math.round(w);
    _crop.cropH = Math.round(h);

    _drawCrop();
    _bindCropEvents(canvas);

    // Petit aperçu dans la zone de drop
    preview.innerHTML = `<img src="${dataUrl}"
      style="max-height:50px;border-radius:6px;opacity:0.6">
      <div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px">Recadrez ci-dessous</div>`;
  };
  img.src = dataUrl;
}

function _handles() {
  const { cropX: x, cropY: y, cropW: w, cropH: h } = _crop;
  return [
    { id:'nw', x,       y       }, { id:'n', x:x+w/2, y       }, { id:'ne', x:x+w, y       },
    { id:'w',  x,       y:y+h/2 },                                { id:'e',  x:x+w, y:y+h/2 },
    { id:'sw', x,       y:y+h   }, { id:'s', x:x+w/2, y:y+h   }, { id:'se', x:x+w, y:y+h   },
  ];
}

function _hitHandle(nx, ny) {
  const tol = 9 / _crop.dispScale;
  return _handles().find(h => Math.abs(h.x - nx) < tol && Math.abs(h.y - ny) < tol) || null;
}

function _drawCrop() {
  const canvas = document.getElementById('ach-crop-canvas');
  if (!canvas || !_crop.img) return;
  const ctx = canvas.getContext('2d');
  const { img, natW, natH, cropX, cropY, cropW, cropH } = _crop;

  ctx.clearRect(0, 0, natW, natH);
  ctx.drawImage(img, 0, 0, natW, natH);

  // Fond assombri
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, natW, natH);

  // Zone sélectionnée
  ctx.drawImage(img, cropX, cropY, cropW, cropH, cropX, cropY, cropW, cropH);

  // Bordure
  ctx.strokeStyle = '#e8b84b';
  ctx.lineWidth   = 2;
  ctx.strokeRect(cropX, cropY, cropW, cropH);

  // Tiers
  ctx.strokeStyle = 'rgba(232,184,75,0.3)';
  ctx.lineWidth   = 1;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(cropX + cropW * i / 3, cropY); ctx.lineTo(cropX + cropW * i / 3, cropY + cropH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cropX, cropY + cropH * i / 3); ctx.lineTo(cropX + cropW, cropY + cropH * i / 3); ctx.stroke();
  }

  // Poignées
  ctx.fillStyle   = '#e8b84b';
  ctx.strokeStyle = '#0b1118';
  ctx.lineWidth   = 1.5;
  _handles().forEach(h => {
    ctx.fillRect(h.x - 6, h.y - 6, 12, 12);
    ctx.strokeRect(h.x - 6, h.y - 6, 12, 12);
  });

  // Dimensions
  ctx.fillStyle = 'rgba(232,184,75,0.9)';
  ctx.font      = '12px monospace';
  ctx.fillText(`${cropW} × ${cropH}`, cropX + 6, cropY + 18);
}

function _toNative(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / _crop.dispScale, y: (clientY - r.top) / _crop.dispScale };
}

// _clamp → importé depuis shared/image-upload.js

function _bindCropEvents(canvas) {
  const R   = 4 / 3;
  const MIN = 40;

  const onStart = (cx, cy) => {
    const { x, y } = _toNative(canvas, cx, cy);
    const h        = _hitHandle(x, y);
    if (h) {
      _crop.isResizing = true; _crop.handle = h.id;
    } else {
      const { cropX, cropY, cropW, cropH } = _crop;
      if (x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropH) {
        _crop.isDragging = true;
        _crop.startX = x - cropX;
        _crop.startY = y - cropY;
      }
    }
  };

  const onMove = (cx, cy) => {
    if (!_crop.isDragging && !_crop.isResizing) return;
    const { x, y } = _toNative(canvas, cx, cy);
    const { natW: W, natH: H } = _crop;

    if (_crop.isDragging) {
      _crop.cropX = Math.round(_clamp(x - _crop.startX, 0, W - _crop.cropW));
      _crop.cropY = Math.round(_clamp(y - _crop.startY, 0, H - _crop.cropH));
      _drawCrop(); return;
    }

    // Redimensionnement avec contrainte 4:3
    let { cropX, cropY, cropW, cropH, handle } = _crop;
    const anchor = { x: cropX, y: cropY, x2: cropX + cropW, y2: cropY + cropH };

    if (handle === 'se') {
      cropW = _clamp(x - anchor.x, MIN, W - anchor.x);
      cropH = Math.round(cropW / R);
      if (anchor.y + cropH > H) { cropH = H - anchor.y; cropW = Math.round(cropH * R); }
    } else if (handle === 'sw') {
      cropW = _clamp(anchor.x2 - x, MIN, anchor.x2);
      cropH = Math.round(cropW / R);
      cropX = anchor.x2 - cropW;
      if (cropY + cropH > H) { cropH = H - cropY; cropW = Math.round(cropH * R); cropX = anchor.x2 - cropW; }
    } else if (handle === 'ne') {
      cropW = _clamp(x - anchor.x, MIN, W - anchor.x);
      cropH = Math.round(cropW / R);
      cropY = anchor.y2 - cropH;
      if (cropY < 0) { cropY = 0; cropH = anchor.y2; cropW = Math.round(cropH * R); }
    } else if (handle === 'nw') {
      cropW = _clamp(anchor.x2 - x, MIN, anchor.x2);
      cropH = Math.round(cropW / R);
      cropX = anchor.x2 - cropW;
      cropY = anchor.y2 - cropH;
      if (cropY < 0) { cropY = 0; cropH = anchor.y2; cropW = Math.round(cropH * R); cropX = anchor.x2 - cropW; }
    } else if (handle === 'e') {
      cropW = _clamp(x - anchor.x, MIN, W - anchor.x);
      cropH = Math.round(cropW / R);
    } else if (handle === 'w') {
      cropW = _clamp(anchor.x2 - x, MIN, anchor.x2);
      cropH = Math.round(cropW / R);
      cropX = anchor.x2 - cropW;
    } else if (handle === 's') {
      cropH = _clamp(y - anchor.y, MIN, H - anchor.y);
      cropW = Math.round(cropH * R);
    } else if (handle === 'n') {
      cropH = _clamp(anchor.y2 - y, MIN, anchor.y2);
      cropW = Math.round(cropH * R);
      cropY = anchor.y2 - cropH;
    }

    _crop.cropX = Math.round(_clamp(cropX, 0, W - MIN));
    _crop.cropY = Math.round(_clamp(cropY, 0, H - MIN));
    _crop.cropW = Math.round(_clamp(cropW, MIN, W - _crop.cropX));
    _crop.cropH = Math.round(_clamp(cropH, MIN, H - _crop.cropY));
    _drawCrop();
  };

  const onEnd = () => { _crop.isDragging = false; _crop.isResizing = false; _crop.handle = null; };

  // Curseur
  const CURSOR_MAP = { nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize', n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize' };
  canvas.addEventListener('mousemove', (e) => {
    if (_crop.isDragging || _crop.isResizing) return;
    const { x, y } = _toNative(canvas, e.clientX, e.clientY);
    const h = _hitHandle(x, y);
    if (h) { canvas.style.cursor = CURSOR_MAP[h.id]; return; }
    const { cropX, cropY, cropW, cropH } = _crop;
    canvas.style.cursor = (x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropH) ? 'move' : 'crosshair';
  });

  canvas.addEventListener('mousedown',  (e) => { e.preventDefault(); onStart(e.clientX, e.clientY); });
  window.addEventListener('mousemove',  (e) => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup',    onEnd);
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchend',   onEnd);
}

window._achConfirmCrop = () => {
  const { img, cropX, cropY, cropW, cropH } = _crop;
  if (!img) return;
  const OUT_W = Math.min(800, cropW);
  const OUT_H = Math.round(OUT_W / (4 / 3));
  const out   = document.createElement('canvas');
  out.width   = OUT_W; out.height = OUT_H;
  out.getContext('2d').drawImage(img, cropX, cropY, cropW, cropH, 0, 0, OUT_W, OUT_H);
  _crop.base64 = out.toDataURL('image/jpeg', 0.88);

  document.getElementById('ach-crop-ok').style.display   = 'block';
  document.getElementById('ach-crop-wrap').style.display  = 'none';
  const p = document.getElementById('ach-drop-preview');
  if (p) p.innerHTML = `<img src="${_crop.base64}" style="max-height:80px;border-radius:8px">`;
};

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveAchievement(id = '') {
  const titre = document.getElementById('ach-titre')?.value?.trim();
  if (!titre) { showNotif('Le titre est requis.', 'error'); return; }

  let imageUrl = '';
  if (_crop.base64) {
    imageUrl = _crop.base64;
  } else {
    const ex = id ? (window._achItems || []).find(a => a.id === id) : null;
    imageUrl  = ex?.imageUrl || '';
  }

  const payload = {
    titre,
    categorie:   document.getElementById('ach-categorie')?.value || 'epique',
    description: document.getElementById('ach-desc')?.value?.trim()  || '',
    imageUrl,
    emoji:       document.getElementById('ach-emoji')?.value?.trim() || '🏆',
    date:        document.getElementById('ach-date')?.value?.trim()  || '',
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

  _crop.base64 = null;
  closeModal();
  showNotif(id ? 'Haut-Fait mis à jour.' : `"${titre}" ajouté !`, 'success');
  await PAGES.achievements();
}

// ── ÉDITER ────────────────────────────────────────────────────────────────────
async function editAchievement(id) {
  if (!window._achItems) window._achItems = await loadCollection('achievements');
  openAchievementModal(id);
}

// ── SUPPRIMER ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  if (!confirm('Supprimer ce haut-fait définitivement ?')) return;
  await deleteFromCol('achievements', id);
  if (window._achItems) window._achItems = window._achItems.filter(a => a.id !== id);
  const order = (await _loadOrder()).filter(oid => oid !== id);
  await _saveOrder(order);
  showNotif('Haut-Fait supprimé.', 'success');
  await PAGES.achievements();
}

// ── ORDRE ─────────────────────────────────────────────────────────────────────
async function _loadOrder() {
  const doc = await getDocData('achievements_meta', 'order');
  return Array.isArray(doc?.order) ? doc.order : [];
}
async function _saveOrder(order) {
  await saveDoc('achievements_meta', 'order', { order });
}
function _applyOrder(items, order) {
  if (!order.length) return items;
  const map     = Object.fromEntries(items.map(a => [a.id, a]));
  const ordered = order.filter(id => map[id]).map(id => map[id]);
  const rest    = items.filter(a => !order.includes(a.id));
  return [...ordered, ...rest];
}

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupAchievementsDnd(catId) {
  if (!STATE.isAdmin) return;
  const grid = document.getElementById(`ach-grid-${catId}`);
  if (!grid) return;

  let dragged = null;

  grid.querySelectorAll('[data-ach-id]').forEach(card => {
    card.setAttribute('draggable', 'true');

    card.addEventListener('dragstart', (e) => {
      dragged = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.achId);
      requestAnimationFrame(() => {
        card.style.opacity   = '0.35';
        card.style.transform = 'scale(0.96)';
      });
    });

    card.addEventListener('dragend', async () => {
      card.style.opacity   = '';
      card.style.transform = '';
      dragged = null;

      // Lire l'ordre depuis le DOM après drop
      const domOrder = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);

      // Reconstruire l'ordre global : conserver les IDs des autres catégories
      const catIds     = new Set((window._achItems || [])
        .filter(a => (a.categorie || 'epique') === catId)
        .map(a => a.id));
      const globalOrder = await _loadOrder();
      const otherIds    = globalOrder.filter(id => !catIds.has(id));

      // Trouver la position d'insertion : juste avant le premier ID d'une autre catégorie
      // qui était après les items de cette catégorie (ou à la fin)
      const firstOtherAfter = globalOrder.find(id => !catIds.has(id) &&
        globalOrder.indexOf(id) > Math.max(...globalOrder.map((v, i) => catIds.has(v) ? i : -1)));

      let merged;
      if (firstOtherAfter) {
        const insertAt = otherIds.indexOf(firstOtherAfter);
        merged = [
          ...otherIds.slice(0, insertAt),
          ...domOrder,
          ...otherIds.slice(insertAt),
        ];
      } else {
        merged = [...otherIds, ...domOrder];
      }

      await _saveOrder(merged);
      showNotif('Ordre sauvegardé.', 'success');
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged || card === dragged) return;
      const rect  = card.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      if (after) card.after(dragged);
      else       card.before(dragged);
    });

    card.addEventListener('dragenter', (e) => e.preventDefault());
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

// ── OVERRIDE PAGES.ACHIEVEMENTS ───────────────────────────────────────────────
const _origPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  const [items, order] = await Promise.all([
    loadCollection('achievements'),
    _loadOrder(),
  ]);
  window._achItems = _applyOrder(items, order);
  const result = await _origPage();
  ['epique', 'comique', 'histoire'].forEach(catId => setupAchievementsDnd(catId));
  return result;
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
