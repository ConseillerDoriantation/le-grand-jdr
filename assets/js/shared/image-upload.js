// ══════════════════════════════════════════════════════════════════════════════
// SHARED / IMAGE-UPLOAD.JS — Upload et recadrage d'image unifié
//
// Deux modes :
//   A) Crop canvas interactif (sélection rectangulaire avec poignées)
//      → utilisé par players.js, story.js, world.js, achievements.js, npcs.js
//
//   B) Crop zoom/drag (photo portrait circulaire)
//      → utilisé par photo-cropper.js (personnages)
//
// Usage minimal :
//   import { createImageDropZone, bindImageCrop } from '../shared/image-upload.js';
//
//   // Dans un modal HTML, ajouter :
//   createImageDropZone({ dropId: 'my-drop', canvasId: 'my-canvas', ... })
//   // puis récupérer le base64 :
//   const b64 = await confirmCrop('my-canvas');
// ══════════════════════════════════════════════════════════════════════════════

// ── État partagé du cropper canvas ─────────────────────────────────────────────
// Exporté comme _crop pour compatibilité avec le code existant des features
export const _crop = {
  img: null, cropX: 0, cropY: 0, cropW: 0, cropH: 0,
  startX: 0, startY: 0,
  isDragging: false, isResizing: false, handle: null,
  natW: 0, natH: 0, dispScale: 1,
  base64: null,
  canvasId: null,   // id du canvas actif
};

export const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── HTML : zone de drop/upload ────────────────────────────────────────────────

/**
 * Retourne le HTML d'une zone de drop d'image réutilisable.
 * @param {Object} opts
 *   dropId      — id de la div de drop
 *   previewId   — id de la div de preview
 *   canvasWrapId— id du wrapper du canvas (affiché après sélection)
 *   canvasId    — id du canvas de recadrage
 *   confirmFnName — nom de la fonction window à appeler pour confirmer
 *   clearFnName   — nom de la fonction window pour effacer (optionnel)
 *   currentUrl  — URL de l'image existante (optionnel)
 *   label       — libellé du champ (défaut: 'Illustration')
 */
export function imageDropZoneHTML({
  dropId = 'img-drop',
  previewId = 'img-preview',
  canvasWrapId = 'img-crop-wrap',
  canvasId = 'img-crop-canvas',
  confirmFnName = '_confirmImgCrop',
  clearFnName = null,
  currentUrl = '',
  label = 'Illustration',
} = {}) {
  return `
    <div class="form-group">
      <label>${label}</label>
      <div id="${dropId}" style="border:2px dashed var(--border-strong);border-radius:10px;
        padding:.85rem;text-align:center;cursor:pointer;background:var(--bg-elevated)">
        <div id="${previewId}">
          ${currentUrl
            ? `<img src="${currentUrl}" style="max-height:80px;border-radius:8px;max-width:100%">`
            : `<div style="font-size:1.5rem;margin-bottom:3px">🖼️</div>
               <div style="font-size:.75rem;color:var(--text-muted)">
                 <span style="color:var(--gold)">Cliquer</span> ou glisser une image</div>`}
        </div>
      </div>
      <div id="${canvasWrapId}" style="display:none;margin-top:.6rem">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.35rem">Recadrez l'illustration</div>
        <canvas id="${canvasId}" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" style="width:100%;margin-top:.4rem"
          onclick="window['${confirmFnName}']()">✂️ Confirmer le recadrage</button>
        <div id="${canvasId}-ok" style="display:none;font-size:.72rem;text-align:center;margin-top:3px;color:var(--green)"></div>
      </div>
      ${currentUrl && clearFnName ? `<button type="button" onclick="window['${clearFnName}']()"
        style="font-size:.72rem;background:none;border:none;cursor:pointer;color:#ff6b6b;margin-top:.3rem">
        ✕ Retirer l'image</button>` : ''}
    </div>`;
}

// ── Binding : connecte les events sur la zone de drop ─────────────────────────

/**
 * Connecte une zone de drop à un canvas de recadrage.
 * @param {Object} opts
 *   dropId, previewId, canvasWrapId, canvasId — mêmes que imageDropZoneHTML
 *   ratio         — { w, h } ratio de recadrage initial (ex: {w:4,h:3}). null = libre.
 *   maxDisplayW   — largeur max du canvas affiché (défaut: 440)
 *   onCropReady   — callback(base64) appelé après confirmation
 */
export function bindImageDropZone({
  dropId = 'img-drop',
  previewId = 'img-preview',
  canvasWrapId = 'img-crop-wrap',
  canvasId = 'img-crop-canvas',
  ratio = null,
  maxDisplayW = 440,
  onCropReady = null,
} = {}) {
  // Créer l'input file caché
  const fi = document.createElement('input');
  fi.type = 'file';
  fi.accept = 'image/*';
  fi.style.cssText = 'position:absolute;opacity:0;width:0;height:0';
  document.body.appendChild(fi);

  const handleFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = (e) => _initCanvasCrop(e.target.result, { canvasWrapId, canvasId, previewId, ratio, maxDisplayW });
    r.readAsDataURL(file);
  };

  fi.addEventListener('change', () => handleFile(fi.files[0]));

  const drop = document.getElementById(dropId);
  drop?.addEventListener('click', () => fi.click());
  drop?.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--gold)'; });
  drop?.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--border-strong)'; });
  drop?.addEventListener('drop', e => {
    e.preventDefault();
    drop.style.borderColor = 'var(--border-strong)';
    handleFile(e.dataTransfer.files[0]);
  });

  // Auto-cleanup quand le drop zone disparaît du DOM
  const obs = new MutationObserver(() => {
    if (!document.getElementById(dropId)) { fi.remove(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Stocker le callback pour confirmCanvasCrop
  _crop._onCropReady = onCropReady;

  return { handleFile };
}

// ── Crop canvas interactif ────────────────────────────────────────────────────

function _initCanvasCrop(dataUrl, { canvasWrapId, canvasId, previewId, ratio, maxDisplayW = 440 }) {
  const wrap   = document.getElementById(canvasWrapId);
  const canvas = document.getElementById(canvasId);
  if (!wrap || !canvas) return;

  wrap.style.display = 'block';
  const okEl = document.getElementById(canvasId + '-ok');
  if (okEl) okEl.style.display = 'none';

  // Reset state
  _crop.base64   = null;
  _crop.canvasId = canvasId;

  const img = new Image();
  img.onload = () => {
    _crop.img  = img;
    _crop.natW = img.naturalWidth;
    _crop.natH = img.naturalHeight;

    const maxW = Math.min(maxDisplayW, img.naturalWidth);
    _crop.dispScale = maxW / img.naturalWidth;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width  = maxW + 'px';
    canvas.style.height = Math.round(img.naturalHeight * _crop.dispScale) + 'px';

    // Sélection initiale selon le ratio demandé
    if (ratio) {
      const r = ratio.w / ratio.h;
      let w = img.naturalWidth * 0.85;
      let h = w / r;
      if (h > img.naturalHeight * 0.85) { h = img.naturalHeight * 0.85; w = h * r; }
      _crop.cropX = Math.round((img.naturalWidth  - w) / 2);
      _crop.cropY = Math.round((img.naturalHeight - h) / 2);
      _crop.cropW = Math.round(w);
      _crop.cropH = Math.round(h);
    } else {
      // Défaut : portrait 3:4
      const w = Math.round(Math.min(img.naturalWidth, img.naturalHeight * 0.75));
      const h = Math.round(w * 4 / 3);
      _crop.cropX = Math.round((img.naturalWidth  - w) / 2);
      _crop.cropY = Math.round((img.naturalHeight - h) / 2);
      _crop.cropW = w;
      _crop.cropH = Math.min(h, img.naturalHeight);
    }

    _drawCanvasCrop();
    _bindCanvasCropEvents(canvas);

    // Preview dans la zone de drop
    const prev = document.getElementById(previewId);
    if (prev) prev.innerHTML = `<img src="${dataUrl}" style="max-height:50px;border-radius:6px;opacity:.6">
      <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px">Recadrez ci-dessous</div>`;
  };
  img.src = dataUrl;
}

function _getHandles() {
  const { cropX: x, cropY: y, cropW: w, cropH: h } = _state;
  return [
    { id: 'nw', x,       y       }, { id: 'n', x: x+w/2, y       }, { id: 'ne', x: x+w, y       },
    { id: 'w',  x,       y:y+h/2 },                                  { id: 'e',  x: x+w, y:y+h/2 },
    { id: 'sw', x,       y: y+h  }, { id: 's', x: x+w/2, y: y+h  }, { id: 'se', x: x+w, y: y+h  },
  ];
}

function _hitHandle(nx, ny) {
  const tol = 9 / _crop.dispScale;
  return _getHandles().find(h => Math.abs(h.x - nx) < tol && Math.abs(h.y - ny) < tol) || null;
}

function _toNative(canvas, cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left) / _crop.dispScale, y: (cy - r.top) / _crop.dispScale };
}

function _drawCanvasCrop() {
  const canvas = document.getElementById(_crop.canvasId);
  if (!canvas || !_crop.img) return;
  const ctx = canvas.getContext('2d');
  const { img, natW, natH, cropX, cropY, cropW, cropH } = _state;

  ctx.clearRect(0, 0, natW, natH);
  ctx.drawImage(img, 0, 0, natW, natH);

  // Obscurcir hors sélection
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, natW, natH);

  // Zone claire
  ctx.drawImage(img, cropX, cropY, cropW, cropH, cropX, cropY, cropW, cropH);

  // Bordure dorée
  ctx.strokeStyle = '#e8b84b';
  ctx.lineWidth   = 2;
  ctx.strokeRect(cropX, cropY, cropW, cropH);

  // Lignes de tiers (règle des tiers)
  ctx.strokeStyle = 'rgba(232,184,75,0.3)';
  ctx.lineWidth   = 1;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(cropX + cropW * i / 3, cropY);  ctx.lineTo(cropX + cropW * i / 3, cropY + cropH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cropX, cropY + cropH * i / 3);  ctx.lineTo(cropX + cropW, cropY + cropH * i / 3); ctx.stroke();
  }

  // Poignées
  ctx.fillStyle   = '#e8b84b';
  ctx.strokeStyle = '#0b1118';
  ctx.lineWidth   = 1.5;
  _getHandles().forEach(h => {
    ctx.fillRect(h.x - 6, h.y - 6, 12, 12);
    ctx.strokeRect(h.x - 6, h.y - 6, 12, 12);
  });
}

function _bindCanvasCropEvents(canvas) {
  const MIN = 40;

  const onStart = (cx, cy) => {
    const { x, y } = _toNative(canvas, cx, cy);
    const h = _hitHandle(x, y);
    if (h) {
      _crop.isResizing = true;
      _crop.handle     = h.id;
    } else {
      const { cropX, cropY, cropW, cropH } = _state;
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
    const { natW: W, natH: H } = _state;

    if (_crop.isDragging) {
      _crop.cropX = Math.round(_clamp(x - _crop.startX, 0, W - _crop.cropW));
      _crop.cropY = Math.round(_clamp(y - _crop.startY, 0, H - _crop.cropH));
      _drawCanvasCrop();
      return;
    }

    let { cropX, cropY, cropW, cropH, handle } = _state;
    const a = { x: cropX, y: cropY, x2: cropX + cropW, y2: cropY + cropH };

    if      (handle === 'se') { cropW = _clamp(x - a.x,  MIN, W - a.x);  cropH = _clamp(y - a.y,  MIN, H - a.y); }
    else if (handle === 'sw') { cropW = _clamp(a.x2 - x, MIN, a.x2);     cropH = _clamp(y - a.y,  MIN, H - a.y); cropX = a.x2 - cropW; }
    else if (handle === 'ne') { cropW = _clamp(x - a.x,  MIN, W - a.x);  cropH = _clamp(a.y2 - y, MIN, a.y2);    cropY = a.y2 - cropH; }
    else if (handle === 'nw') { cropW = _clamp(a.x2 - x, MIN, a.x2);     cropH = _clamp(a.y2 - y, MIN, a.y2);    cropX = a.x2 - cropW; cropY = a.y2 - cropH; }
    else if (handle === 'e')  { cropW = _clamp(x - a.x,  MIN, W - a.x); }
    else if (handle === 'w')  { cropW = _clamp(a.x2 - x, MIN, a.x2);     cropX = a.x2 - cropW; }
    else if (handle === 's')  { cropH = _clamp(y - a.y,  MIN, H - a.y); }
    else if (handle === 'n')  { cropH = _clamp(a.y2 - y, MIN, a.y2);     cropY = a.y2 - cropH; }

    _crop.cropX = Math.round(_clamp(cropX, 0, W - MIN));
    _crop.cropY = Math.round(_clamp(cropY, 0, H - MIN));
    _crop.cropW = Math.round(_clamp(cropW, MIN, W - _crop.cropX));
    _crop.cropH = Math.round(_clamp(cropH, MIN, H - _crop.cropY));
    _drawCanvasCrop();
  };

  const onEnd = () => {
    _crop.isDragging = false;
    _crop.isResizing = false;
    _crop.handle     = null;
  };

  canvas.addEventListener('mousedown',  e => { e.preventDefault(); onStart(e.clientX, e.clientY); });
  window.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup',    onEnd);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); },  { passive: false });
  canvas.addEventListener('touchend',   onEnd);
}

/**
 * Confirme le recadrage et retourne le base64 compressé.
 * Appeler depuis le bouton "Confirmer" du modal.
 * @param {string} canvasId — id du canvas actif
 * @param {string} [okElId] — id de l'élément de statut (optionnel)
 * @param {number} [targetBytes] — taille max en octets (défaut 700_000)
 * @returns {string|null} base64 JPEG ou null si erreur
 */
export function confirmCanvasCrop(canvasId, okElId = null, targetBytes = 700_000) {
  const { img, cropX, cropY, cropW, cropH } = _state;
  if (!img) return null;

  const statusEl = okElId ? document.getElementById(okElId) : null;
  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '⏳ Compression…'; }

  const scale = cropW > 1400 ? 1400 / cropW : 1;
  const out   = document.createElement('canvas');
  out.width   = Math.round(cropW * scale);
  out.height  = Math.round(cropH * scale);
  out.getContext('2d').drawImage(img, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);

  let b64;
  for (const q of [0.85, 0.75, 0.65, 0.55]) {
    b64 = out.toDataURL('image/jpeg', q);
    if (b64.length <= targetBytes) break;
  }

  _crop.base64 = b64;

  if (statusEl) {
    statusEl.textContent = `✓ Image prête (${Math.round(b64.length / 1024)} KB)`;
    statusEl.style.color = 'var(--green)';
  }

  const wrap = document.getElementById(canvasId)?.parentElement;
  if (wrap) wrap.style.display = 'none';

  if (_crop._onCropReady) _crop._onCropReady(b64);
  return b64;
}

/**
 * Retourne le base64 du dernier crop confirmé (ou null si aucun).
 */
export function getCroppedBase64() {
  return _crop.base64 || null;
}

/**
 * Réinitialise l'état du cropper.
 */
export function resetCrop() {
  Object.assign(_crop, {
    img: null, cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    startX: 0, startY: 0, isDragging: false, isResizing: false, handle: null,
    natW: 0, natH: 0, dispScale: 1, base64: null, canvasId: null,
  });
}

// ── Utilitaire : simple upload JPEG/PNG sans crop (uploadImage.js) ────────────

function _resizeDimensions(w, h, max = 400) {
  if (w <= max && h <= max) return { w, h };
  if (w > h) return { w: max, h: Math.round(h * max / w) };
  return { w: Math.round(w * max / h), h: max };
}

function _imageToBase64(img, w, h, format = 'image/jpeg', quality = 0.72) {
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(format, quality);
}

/**
 * Lit un fichier image et appelle onLoad(img).
 */
export function readImageFile(file, onLoad) {
  if (!file?.type.startsWith('image/')) return;
  const r = new FileReader();
  r.onload = e => {
    const img = new Image();
    img.onload = () => onLoad(img);
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}

/**
 * Upload simple avec compression JPEG (pour avatars, bannières).
 * @param {File} file
 * @param {{ previewId, hiddenId, max, quality }} opts
 * @returns {string} base64
 */
export function uploadJpeg(file, { previewId = null, hiddenId = null, max = 400, quality = 0.72 } = {}) {
  return new Promise(resolve => {
    readImageFile(file, img => {
      const { w, h } = _resizeDimensions(img.width, img.height, max);
      const b64 = _imageToBase64(img, w, h, 'image/jpeg', quality);
      if (hiddenId)  { const el = document.getElementById(hiddenId);  if (el) el.value = b64; }
      if (previewId) { const el = document.getElementById(previewId); if (el) el.innerHTML = `<img src="${b64}" style="max-height:80px;margin-top:.4rem;display:block;border-radius:6px">`; }
      resolve(b64);
    });
  });
}

/**
 * Upload simple avec PNG (transparence conservée, pour cartes/icônes).
 */
export function uploadPng(file, { previewId = null, hiddenId = null, max = 400 } = {}) {
  return new Promise(resolve => {
    readImageFile(file, img => {
      const { w, h } = _resizeDimensions(img.width, img.height, max);
      const b64 = _imageToBase64(img, w, h, 'image/png', 1);
      if (hiddenId)  { const el = document.getElementById(hiddenId);  if (el) el.value = b64; }
      if (previewId) { const el = document.getElementById(previewId); if (el) el.innerHTML = `<img src="${b64}" style="max-height:80px;margin-top:.4rem;display:block;border-radius:6px">`; }
      resolve(b64);
    });
  });
}

// ── Exposition globale (pour compatibilité avec les anciens appels window) ────
// Chaque feature expose ses propres wrappers window ; ceux-ci sont les fallbacks.
Object.assign(window, { previewUploadPng: (fi, pi, hi) => { const f = document.getElementById(fi)?.files?.[0]; if (f) uploadPng(f, { previewId: pi, hiddenId: hi }); }, previewUploadJpeg: (fi, pi, hi) => { const f = document.getElementById(fi)?.files?.[0]; if (f) uploadJpeg(f, { previewId: pi, hiddenId: hi }); }, });
