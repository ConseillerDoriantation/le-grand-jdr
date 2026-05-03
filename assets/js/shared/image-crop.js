// ══════════════════════════════════════════════════════════════════════════════
// SHARED / IMAGE-CROP.JS — Recadrage d'image unifié
//
// Trois modes :
//   panzoom    → cadre fixe carré, l'image bouge/zoome dessous (portraits/avatars)
//   selection  → image fixe, rectangle de sélection avec poignées (illustrations)
//   resize     → pas de UI, juste un redimensionnement + compression JPEG
//
// Architecture :
//   - Chaque attachXxx() retourne un controller indépendant ({ destroy, ... }).
//     Pas d'état partagé : plusieurs modals/instances peuvent coexister.
//   - attachDropAndCrop / attachDropAndResize composent dropzone + traitement
//     pour couvrir le cas dominant (formulaire) en quelques lignes.
//
// Principes du retour `getResult()` :
//   string    → nouvelle image traitée (à persister)
//   null      → l'utilisateur a explicitement effacé l'image
//   undefined → aucun changement (conserver l'image existante)
// ══════════════════════════════════════════════════════════════════════════════

import { bindImageUploadDropZone } from './image-upload.js';

// ── Helpers internes ─────────────────────────────────────────────────────────

const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _bindEvents(target, events) {
  events.forEach(([type, handler, opts]) => target?.addEventListener(type, handler, opts));
  return () => events.forEach(([type, handler]) => target?.removeEventListener(type, handler));
}

function _compressJpeg(canvas, { target, qualities }) {
  let b64;
  for (const q of qualities) {
    b64 = canvas.toDataURL('image/jpeg', q);
    if (b64.length <= target) return b64;
  }
  return b64;
}

function _idlePreviewHtml() {
  return `<div style="font-size:1.5rem;margin-bottom:3px">🖼️</div>
    <div style="font-size:.75rem;color:var(--text-muted)">
      <span style="color:var(--gold)">Cliquer</span> ou glisser une image</div>`;
}

function _imagePreviewHtml(url, maxHeight) {
  return `<img src="${url}" style="max-height:${maxHeight}px;border-radius:8px;max-width:100%">`;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE PAN/ZOOM — image carrée que l'utilisateur déplace/zoome
// ══════════════════════════════════════════════════════════════════════════════

export function panZoomCropHTML({
  idPrefix = 'crop',
  viewSize = 300,
  hint = true,
} = {}) {
  const hintHtml = hint
    ? `<p style="font-size:.75rem;color:var(--text-dim);margin-bottom:.5rem;text-align:center">Glisse pour repositionner · Scroll ou slider pour zoomer</p>`
    : '';
  return `
    ${hintHtml}
    <div id="${idPrefix}-zone" style="position:relative;width:${viewSize}px;height:${viewSize}px;margin:0 auto;border-radius:14px;overflow:hidden;background:#111827;cursor:grab;touch-action:none;border:2px solid var(--border-bright)">
      <img id="${idPrefix}-img" alt="" style="position:absolute;transform-origin:0 0;pointer-events:none;display:block;user-select:none;max-width:none;max-height:none">
      <div style="position:absolute;inset:0;pointer-events:none;border:1px dashed rgba(255,255,255,.15);border-radius:12px"></div>
    </div>
    <div style="width:${viewSize}px;margin:.75rem auto 0">
      <div style="display:flex;align-items:center;gap:.6rem">
        <span style="font-size:.65rem;color:var(--text-dim)">-</span>
        <input type="range" id="${idPrefix}-zoom" min="0.1" max="4" step="0.01" value="1" style="flex:1;accent-color:var(--gold)">
        <span style="font-size:.65rem;color:var(--text-dim)">+</span>
      </div>
    </div>`;
}

export function attachPanZoomCrop({
  idPrefix = 'crop',
  dataUrl,
  viewSize = 300,
  outputSize = 300,
  jpegQuality = 0.88,
  background = '#111827',
}) {
  const zone = document.getElementById(`${idPrefix}-zone`);
  const img = document.getElementById(`${idPrefix}-img`);
  const slider = document.getElementById(`${idPrefix}-zoom`);
  if (!zone || !img || !slider) return null;

  const s = { ox: 0, oy: 0, scale: 1, dragging: false, startMX: 0, startMY: 0, naturalW: 0, naturalH: 0, t0: null };
  const apply = () => { img.style.transform = `translate(${s.ox}px, ${s.oy}px) scale(${s.scale})`; };
  const pinch = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const zoomTo = (newScale, cx, cy) => {
    s.ox = cx - (cx - s.ox) * (newScale / s.scale);
    s.oy = cy - (cy - s.oy) * (newScale / s.scale);
    s.scale = newScale;
  };

  const h = {
    sliderInput: () => { zoomTo(parseFloat(slider.value), viewSize / 2, viewSize / 2); apply(); },
    wheel: (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      const nv = _clamp(s.scale * factor, parseFloat(slider.min), parseFloat(slider.max));
      const r = zone.getBoundingClientRect();
      zoomTo(nv, e.clientX - r.left, e.clientY - r.top);
      slider.value = nv; apply();
    },
    mousedown: (e) => {
      s.dragging = true; s.startMX = e.clientX - s.ox; s.startMY = e.clientY - s.oy;
      zone.style.cursor = 'grabbing'; e.preventDefault();
    },
    mousemove: (e) => { if (!s.dragging) return; s.ox = e.clientX - s.startMX; s.oy = e.clientY - s.startMY; apply(); },
    mouseup: () => { s.dragging = false; zone.style.cursor = 'grab'; },
    touchstart: (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        s.dragging = true; s.startMX = t.clientX - s.ox; s.startMY = t.clientY - s.oy; s.t0 = null;
      } else if (e.touches.length === 2) { s.t0 = pinch(e); s.dragging = false; }
      e.preventDefault();
    },
    touchmove: (e) => {
      if (e.touches.length === 1 && s.dragging) {
        const t = e.touches[0]; s.ox = t.clientX - s.startMX; s.oy = t.clientY - s.startMY; apply();
      } else if (e.touches.length === 2 && s.t0 > 0) {
        const d = pinch(e), factor = d / s.t0;
        const nv = _clamp(s.scale * factor, parseFloat(slider.min), parseFloat(slider.max));
        zoomTo(nv, viewSize / 2, viewSize / 2);
        slider.value = nv; s.t0 = d; apply();
      }
      e.preventDefault();
    },
    touchend: () => { s.dragging = false; s.t0 = null; },
  };

  img.onload = () => {
    s.naturalW = img.naturalWidth; s.naturalH = img.naturalHeight;
    const init = Math.max(viewSize / s.naturalW, viewSize / s.naturalH);
    s.scale = init;
    slider.min = (Math.min(viewSize / s.naturalW, viewSize / s.naturalH) * 0.5).toFixed(3);
    slider.max = (init * 6).toFixed(3);
    slider.value = init;
    s.ox = (viewSize - s.naturalW * init) / 2;
    s.oy = (viewSize - s.naturalH * init) / 2;
    apply();
  };
  img.src = dataUrl;

  const unbind = [
    _bindEvents(slider, [['input', h.sliderInput]]),
    _bindEvents(zone, [
      ['wheel', h.wheel, { passive: false }],
      ['mousedown', h.mousedown],
      ['touchstart', h.touchstart, { passive: false }],
      ['touchmove', h.touchmove, { passive: false }],
      ['touchend', h.touchend],
    ]),
    _bindEvents(window, [['mousemove', h.mousemove], ['mouseup', h.mouseup]]),
  ];

  return {
    getBase64() {
      if (!s.naturalW) return null;
      const srcX = -s.ox / s.scale, srcY = -s.oy / s.scale;
      const srcW = viewSize / s.scale, srcH = viewSize / s.scale;
      const cx = Math.max(0, srcX), cy = Math.max(0, srcY);
      const cw = Math.min(srcW, s.naturalW - cx);
      const ch = Math.min(srcH, s.naturalH - cy);
      const dx = Math.max(0, (0 - srcX) * (outputSize / srcW));
      const dy = Math.max(0, (0 - srcY) * (outputSize / srcH));
      const out = document.createElement('canvas');
      out.width = outputSize; out.height = outputSize;
      const ctx = out.getContext('2d');
      ctx.fillStyle = background; ctx.fillRect(0, 0, outputSize, outputSize);
      ctx.drawImage(img, cx, cy, cw, ch, dx, dy, cw * (outputSize / srcW), ch * (outputSize / srcH));
      return out.toDataURL('image/jpeg', jpegQuality);
    },
    destroy() { unbind.forEach(fn => fn()); },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE SÉLECTION — rectangle de crop redimensionnable sur l'image
// ══════════════════════════════════════════════════════════════════════════════

const _HANDLE_CURSORS = {
  nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize',
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
};

function _handles(s) {
  const { cropX: x, cropY: y, cropW: w, cropH: h } = s;
  return [
    { id: 'nw', x, y },                { id: 'n', x: x + w / 2, y },         { id: 'ne', x: x + w, y },
    { id: 'w',  x, y: y + h / 2 },                                            { id: 'e',  x: x + w, y: y + h / 2 },
    { id: 'sw', x, y: y + h },         { id: 's', x: x + w / 2, y: y + h },  { id: 'se', x: x + w, y: y + h },
  ];
}

function _hitHandle(s, nx, ny) {
  const tol = 9 / s.dispScale;
  return _handles(s).find(h => Math.abs(h.x - nx) < tol && Math.abs(h.y - ny) < tol) || null;
}

function _toNative(canvas, scale, cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
}

function _initialFraming({ natW, natH, ratio, initialRatio }) {
  const r = ratio ? ratio.w / ratio.h : (initialRatio ? initialRatio.w / initialRatio.h : null);
  if (r) {
    let w = natW * 0.85, h = w / r;
    if (h > natH * 0.85) { h = natH * 0.85; w = h * r; }
    return {
      cropX: Math.round((natW - w) / 2),
      cropY: Math.round((natH - h) / 2),
      cropW: Math.round(w),
      cropH: Math.round(h),
    };
  }
  // Pas de ratio cible : rectangle 85% × 85% centré
  const w = Math.round(natW * 0.85), h = Math.round(natH * 0.85);
  return {
    cropX: Math.round((natW - w) / 2),
    cropY: Math.round((natH - h) / 2),
    cropW: w,
    cropH: h,
  };
}

export function attachSelectionCrop({
  canvasId,
  dataUrl,
  ratio = null,            // { w, h } verrouille le ratio. null = libre.
  initialRatio = null,     // { w, h } pour un cadrage initial même en ratio libre.
  maxDisplayW = 400,
  showSizeOverlay = true,
  showGridlines = true,
  output = {},
}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const cfg = {
    maxW: 1400,
    target: 700_000,
    qualities: [0.85, 0.75, 0.65, 0.55],
    ...output,
  };

  const s = {
    img: null, natW: 0, natH: 0, dispScale: 1,
    cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    isDragging: false, isResizing: false, handle: null,
    startX: 0, startY: 0,
    base64: null,
  };

  const MIN = 40;
  const R = ratio ? ratio.w / ratio.h : null;

  const draw = () => {
    if (!s.img) return;
    const ctx = canvas.getContext('2d');
    const { img, natW, natH, cropX, cropY, cropW, cropH } = s;

    ctx.clearRect(0, 0, natW, natH);
    ctx.drawImage(img, 0, 0, natW, natH);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, natW, natH);
    ctx.drawImage(img, cropX, cropY, cropW, cropH, cropX, cropY, cropW, cropH);

    ctx.strokeStyle = '#e8b84b';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX, cropY, cropW, cropH);

    if (showGridlines) {
      ctx.strokeStyle = 'rgba(232,184,75,0.3)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cropX + cropW * i / 3, cropY);
        ctx.lineTo(cropX + cropW * i / 3, cropY + cropH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cropX, cropY + cropH * i / 3);
        ctx.lineTo(cropX + cropW, cropY + cropH * i / 3);
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#e8b84b';
    ctx.strokeStyle = '#0b1118';
    ctx.lineWidth = 1.5;
    _handles(s).forEach(h => {
      ctx.fillRect(h.x - 6, h.y - 6, 12, 12);
      ctx.strokeRect(h.x - 6, h.y - 6, 12, 12);
    });

    if (showSizeOverlay) {
      ctx.fillStyle = 'rgba(232,184,75,0.9)';
      ctx.font = '12px monospace';
      ctx.fillText(`${cropW}×${cropH}`, cropX + 6, cropY + 18);
    }
  };

  const onStart = (cx, cy) => {
    const { x, y } = _toNative(canvas, s.dispScale, cx, cy);
    const h = _hitHandle(s, x, y);
    if (h) { s.isResizing = true; s.handle = h.id; return; }
    const { cropX, cropY, cropW, cropH } = s;
    if (x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropH) {
      s.isDragging = true;
      s.startX = x - cropX;
      s.startY = y - cropY;
    }
  };

  const onMove = (cx, cy) => {
    if (!s.isDragging && !s.isResizing) return;
    const { x, y } = _toNative(canvas, s.dispScale, cx, cy);
    const W = s.natW, H = s.natH;

    if (s.isDragging) {
      s.cropX = Math.round(_clamp(x - s.startX, 0, W - s.cropW));
      s.cropY = Math.round(_clamp(y - s.startY, 0, H - s.cropH));
      draw();
      return;
    }

    let { cropX, cropY, cropW, cropH } = s;
    const handle = s.handle;
    const a = { x: cropX, y: cropY, x2: cropX + cropW, y2: cropY + cropH };

    if (R) {
      // Ratio verrouillé : la largeur (ou hauteur pour n/s) pilote, l'autre suit
      if (handle === 'se')      { cropW = _clamp(x - a.x, MIN, W - a.x); cropH = Math.round(cropW / R); }
      else if (handle === 'sw') { cropW = _clamp(a.x2 - x, MIN, a.x2);   cropH = Math.round(cropW / R); cropX = a.x2 - cropW; }
      else if (handle === 'ne') { cropW = _clamp(x - a.x, MIN, W - a.x); cropH = Math.round(cropW / R); cropY = a.y2 - cropH; }
      else if (handle === 'nw') { cropW = _clamp(a.x2 - x, MIN, a.x2);   cropH = Math.round(cropW / R); cropX = a.x2 - cropW; cropY = a.y2 - cropH; }
      else if (handle === 'e')  { cropW = _clamp(x - a.x, MIN, W - a.x); cropH = Math.round(cropW / R); }
      else if (handle === 'w')  { cropW = _clamp(a.x2 - x, MIN, a.x2);   cropH = Math.round(cropW / R); cropX = a.x2 - cropW; }
      else if (handle === 's')  { cropH = _clamp(y - a.y, MIN, H - a.y); cropW = Math.round(cropH * R); }
      else if (handle === 'n')  { cropH = _clamp(a.y2 - y, MIN, a.y2);   cropW = Math.round(cropH * R); cropY = a.y2 - cropH; }
    } else {
      // Ratio libre
      if (handle === 'se')      { cropW = _clamp(x - a.x, MIN, W - a.x); cropH = _clamp(y - a.y, MIN, H - a.y); }
      else if (handle === 'sw') { cropW = _clamp(a.x2 - x, MIN, a.x2);   cropH = _clamp(y - a.y, MIN, H - a.y); cropX = a.x2 - cropW; }
      else if (handle === 'ne') { cropW = _clamp(x - a.x, MIN, W - a.x); cropH = _clamp(a.y2 - y, MIN, a.y2);   cropY = a.y2 - cropH; }
      else if (handle === 'nw') { cropW = _clamp(a.x2 - x, MIN, a.x2);   cropH = _clamp(a.y2 - y, MIN, a.y2);   cropX = a.x2 - cropW; cropY = a.y2 - cropH; }
      else if (handle === 'e')  { cropW = _clamp(x - a.x, MIN, W - a.x); }
      else if (handle === 'w')  { cropW = _clamp(a.x2 - x, MIN, a.x2);   cropX = a.x2 - cropW; }
      else if (handle === 's')  { cropH = _clamp(y - a.y, MIN, H - a.y); }
      else if (handle === 'n')  { cropH = _clamp(a.y2 - y, MIN, a.y2);   cropY = a.y2 - cropH; }
    }

    s.cropX = Math.round(_clamp(cropX, 0, W - MIN));
    s.cropY = Math.round(_clamp(cropY, 0, H - MIN));
    s.cropW = Math.round(_clamp(cropW, MIN, W - s.cropX));
    s.cropH = Math.round(_clamp(cropH, MIN, H - s.cropY));
    draw();
  };

  const onEnd = () => { s.isDragging = false; s.isResizing = false; s.handle = null; };

  const onCanvasMove = (e) => {
    if (s.isDragging || s.isResizing) return;
    const { x, y } = _toNative(canvas, s.dispScale, e.clientX, e.clientY);
    const h = _hitHandle(s, x, y);
    if (h) { canvas.style.cursor = _HANDLE_CURSORS[h.id]; return; }
    const { cropX, cropY, cropW, cropH } = s;
    canvas.style.cursor = (x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropH) ? 'move' : 'crosshair';
  };

  const unbind = [
    _bindEvents(canvas, [
      ['mousedown', e => { e.preventDefault(); onStart(e.clientX, e.clientY); }],
      ['mousemove', onCanvasMove],
      ['touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false }],
      ['touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false }],
      ['touchend', onEnd],
    ]),
    _bindEvents(window, [
      ['mousemove', e => onMove(e.clientX, e.clientY)],
      ['mouseup', onEnd],
    ]),
  ];

  const img = new Image();
  img.onload = () => {
    s.img = img;
    s.natW = img.naturalWidth;
    s.natH = img.naturalHeight;
    const maxW = Math.min(maxDisplayW, img.naturalWidth);
    s.dispScale = maxW / img.naturalWidth;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width = maxW + 'px';
    canvas.style.height = Math.round(img.naturalHeight * s.dispScale) + 'px';
    Object.assign(s, _initialFraming({ natW: s.natW, natH: s.natH, ratio, initialRatio }));
    draw();
  };
  img.src = dataUrl;

  return {
    getBase64() { return s.base64; },
    confirm() {
      if (!s.img) return null;
      const { img, cropX, cropY, cropW, cropH } = s;
      const scale = cropW > cfg.maxW ? cfg.maxW / cropW : 1;
      const out = document.createElement('canvas');
      out.width = Math.round(cropW * scale);
      out.height = Math.round(cropH * scale);
      out.getContext('2d').drawImage(img, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);
      s.base64 = _compressJpeg(out, cfg);
      return s.base64;
    },
    destroy() { unbind.forEach(fn => fn()); },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// REDIMENSIONNEMENT SIMPLE (sans UI de crop)
// ══════════════════════════════════════════════════════════════════════════════

export function resizeImageDataUrl(dataUrl, {
  maxW = 1400,
  maxH = null,
  format = 'image/jpeg',
  quality = 0.88,
} = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const limitW = maxW;
      const limitH = maxH ?? maxW;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > limitW || h > limitH) {
        if (w / limitW >= h / limitH) { h = Math.round(h * limitW / w); w = limitW; }
        else                          { w = Math.round(w * limitH / h); h = limitH; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(format, quality));
    };
    img.onerror = () => reject(new Error('Image illisible.'));
    img.src = dataUrl;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSÉ : DROPZONE + CROP SÉLECTION + UI complète
//
// Le cas dominant : un formulaire avec une zone de drop, un canvas masqué,
// un bouton "Confirmer", un bouton "Retirer", et un statut texte.
// ══════════════════════════════════════════════════════════════════════════════

export function attachDropAndCrop({
  dropEl,
  previewEl,
  cropWrapEl,
  canvasId,
  statusEl = null,
  confirmBtnEl = null,
  clearBtnEl = null,

  initialUrl = '',
  ratio = null,
  initialRatio = null,
  maxDisplayW = 400,
  showSizeOverlay = true,
  showGridlines = true,
  output = {},

  previewMaxH = 80,
  cropHintText = 'Recadrez ci-dessous',
  onResult = null,
}) {
  if (!dropEl) return null;

  let cropper = null;
  let result = 'unset';     // 'unset' | 'cropped' | 'cleared'
  let cropped = null;

  const renderIdle = (url) => {
    if (!previewEl) return;
    previewEl.innerHTML = url ? _imagePreviewHtml(url, previewMaxH) : _idlePreviewHtml();
  };

  const renderCropping = (dataUrl) => {
    if (!previewEl) return;
    previewEl.innerHTML =
      `<img src="${dataUrl}" style="max-height:${Math.round(previewMaxH * 0.65)}px;border-radius:6px;opacity:.6">
       <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px">${cropHintText}</div>`;
  };

  const startCrop = (dataUrl) => {
    cropper?.destroy();
    if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
    if (cropWrapEl) cropWrapEl.style.display = 'block';
    renderCropping(dataUrl);
    cropper = attachSelectionCrop({
      canvasId, dataUrl, ratio, initialRatio, maxDisplayW,
      showSizeOverlay, showGridlines, output,
    });
  };

  const confirm = () => {
    const b64 = cropper?.confirm();
    if (!b64) return null;
    cropper.destroy(); cropper = null;
    if (cropWrapEl) cropWrapEl.style.display = 'none';
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = 'var(--green)';
      statusEl.textContent = `✓ Image prête (${Math.round(b64.length / 1024)} KB)`;
    }
    renderIdle(b64);
    cropped = b64;
    result = 'cropped';
    onResult?.(b64);
    return b64;
  };

  const reset = () => {
    cropper?.destroy(); cropper = null;
    if (cropWrapEl) cropWrapEl.style.display = 'none';
    if (statusEl) statusEl.style.display = 'none';
    renderIdle(null);
    cropped = null;
    result = 'cleared';
    onResult?.(null);
  };

  renderIdle(initialUrl || null);

  const upload = bindImageUploadDropZone(dropEl, {
    onImage: ({ dataUrl }) => startCrop(dataUrl),
  });

  const onConfirmClick = () => confirm();
  const onClearClick = () => reset();
  confirmBtnEl?.addEventListener('click', onConfirmClick);
  clearBtnEl?.addEventListener('click', onClearClick);

  // Auto-cleanup quand la dropzone quitte le DOM (ex : fermeture de modal).
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cropper?.destroy();
    upload.destroy();
    confirmBtnEl?.removeEventListener('click', onConfirmClick);
    clearBtnEl?.removeEventListener('click', onClearClick);
    obs.disconnect();
  };
  const obs = new MutationObserver(() => {
    if (!document.body.contains(dropEl)) destroy();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return { confirm, reset, destroy, getResult() {
    if (result === 'cropped') return cropped;
    if (result === 'cleared') return null;
    return undefined;
  } };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSÉ : DROPZONE + REDIMENSIONNEMENT (pas de crop UI)
//
// Pour les cas où on veut juste compresser + afficher (achievements, etc.).
// ══════════════════════════════════════════════════════════════════════════════

export function attachDropAndResize({
  dropEl,
  previewEl,
  statusEl = null,
  initialUrl = '',
  resize = {},
  maxFileSize = null,
  previewMaxH = 80,
  onError = null,
  onResult = null,
}) {
  if (!dropEl) return null;

  let result = 'unset';
  let resized = null;

  const renderIdle = (url) => {
    if (!previewEl) return;
    previewEl.innerHTML = url ? _imagePreviewHtml(url, previewMaxH) : _idlePreviewHtml();
  };
  renderIdle(initialUrl || null);

  const handle = async (file, dataUrl) => {
    if (maxFileSize && file && file.size > maxFileSize) {
      onError?.(new Error('Image trop lourde.'));
      return;
    }
    try {
      const b64 = await resizeImageDataUrl(dataUrl, resize);
      resized = b64;
      result = 'cropped';
      renderIdle(b64);
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--green)';
        statusEl.textContent = `✓ Image prête (${Math.round(b64.length / 1024)} KB)`;
      }
      onResult?.(b64);
    } catch (e) { onError?.(e); }
  };

  const upload = bindImageUploadDropZone(dropEl, {
    onImage: ({ file, dataUrl }) => handle(file, dataUrl),
  });

  return {
    destroy() { upload.destroy(); },
    reset() {
      resized = null;
      result = 'cleared';
      renderIdle(null);
      if (statusEl) statusEl.style.display = 'none';
      onResult?.(null);
    },
    getResult() {
      if (result === 'cropped') return resized;
      if (result === 'cleared') return null;
      return undefined;
    },
  };
}
