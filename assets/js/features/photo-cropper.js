import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

// ══════════════════════════════════════════════
// PHOTO CROPPER — drag + zoom, export 300×300
//
// Principe :
//   La zone est un carré fixe de VIEW_SIZE px.
//   L'image est dessinée à (ox, oy) avec scale s.
//   "Ce qu'on voit dans la zone" = la région de
//   l'image naturelle qui tombe dans [0, VIEW_SIZE].
//
//   Pour exporter, on calcule la portion de l'image
//   source correspondant à la zone visible, et on
//   la dessine sur un canvas OUTPUT_SIZE×OUTPUT_SIZE.
// ══════════════════════════════════════════════

const VIEW_SIZE   = 300;   // taille du preview en px CSS
const OUTPUT_SIZE = 300;   // taille de sortie du canvas

function openPhotoCropper(charId) {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => _showCropModal(ev.target.result, charId);
    reader.readAsDataURL(file);
  };
  input.click();
}

function _showCropModal(dataUrl, charId) {
  openModal('📷 Cadrer la photo', `
    <p style="font-size:0.75rem;color:var(--text-dim);margin-bottom:0.7rem;text-align:center">
      Glisse pour repositionner · Scroll ou slider pour zoomer
    </p>
    <div id="crop-zone"
         style="position:relative;width:${VIEW_SIZE}px;height:${VIEW_SIZE}px;
                margin:0 auto;border-radius:14px;overflow:hidden;
                background:#111827;cursor:grab;touch-action:none;
                border:2px solid var(--border-bright)">
      <img id="crop-img" src="${dataUrl}"
           style="position:absolute;transform-origin:0 0;
                  pointer-events:none;display:block;user-select:none;
                  max-width:none;max-height:none;">
      <!-- croix de centrage visuelle -->
      <div style="position:absolute;inset:0;pointer-events:none;
                  border:1px dashed rgba(255,255,255,0.15);border-radius:12px"></div>
    </div>
    <div style="width:${VIEW_SIZE}px;margin:0.75rem auto 0">
      <div style="display:flex;align-items:center;gap:0.6rem">
        <span style="font-size:0.65rem;color:var(--text-dim)">−</span>
        <input type="range" id="crop-zoom" min="0.1" max="4" step="0.01" value="1"
               style="flex:1;accent-color:var(--gold)">
        <span style="font-size:0.65rem;color:var(--text-dim)">+</span>
      </div>
    </div>
    <div style="display:flex;gap:0.6rem;justify-content:flex-end;
                width:${VIEW_SIZE}px;margin:0.8rem auto 0">
      <button class="btn btn-outline" onclick="closeModal()">Annuler</button>
      <button class="btn btn-gold"    onclick="saveCroppedPhoto('${charId}')">✅ Enregistrer</button>
    </div>
  `);

  requestAnimationFrame(() => _initCropper());
}

// État partagé du cropper
let _cs = null; // { ox, oy, scale, img, naturalW, naturalH }

function _initCropper() {
  const zone   = document.getElementById('crop-zone');
  const img    = document.getElementById('crop-img');
  const slider = document.getElementById('crop-zoom');
  if (!zone || !img || !slider) return;

  _cs = { ox: 0, oy: 0, scale: 1, img, dragging: false, startMX: 0, startMY: 0 };

  img.onload = () => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    _cs.naturalW = nw;
    _cs.naturalH = nh;

    // Zoom initial : l'image couvre toute la zone (cover)
    const initScale = Math.max(VIEW_SIZE / nw, VIEW_SIZE / nh);
    _cs.scale = initScale;
    slider.min   = (Math.min(VIEW_SIZE / nw, VIEW_SIZE / nh) * 0.5).toFixed(3);
    slider.max   = (initScale * 6).toFixed(3);
    slider.value = initScale;

    // Centrer
    _cs.ox = (VIEW_SIZE - nw * initScale) / 2;
    _cs.oy = (VIEW_SIZE - nh * initScale) / 2;
    _applyCSS();
  };

  // ── Slider zoom ───────────────────────────
  slider.addEventListener('input', () => {
    const newScale = parseFloat(slider.value);
    // On zoome par rapport au centre de la zone
    const cx = VIEW_SIZE / 2, cy = VIEW_SIZE / 2;
    _cs.ox = cx - (cx - _cs.ox) * (newScale / _cs.scale);
    _cs.oy = cy - (cy - _cs.oy) * (newScale / _cs.scale);
    _cs.scale = newScale;
    _applyCSS();
  });

  // ── Wheel zoom ────────────────────────────
  zone.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    const newScale = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), _cs.scale * factor));
    const rect = zone.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    _cs.ox = mx - (mx - _cs.ox) * (newScale / _cs.scale);
    _cs.oy = my - (my - _cs.oy) * (newScale / _cs.scale);
    _cs.scale = newScale;
    slider.value = newScale;
    _applyCSS();
  }, { passive: false });

  // ── Drag souris ───────────────────────────
  zone.addEventListener('mousedown', e => {
    _cs.dragging = true;
    _cs.startMX  = e.clientX - _cs.ox;
    _cs.startMY  = e.clientY - _cs.oy;
    zone.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!_cs?.dragging) return;
    _cs.ox = e.clientX - _cs.startMX;
    _cs.oy = e.clientY - _cs.startMY;
    _applyCSS();
  });
  window.addEventListener('mouseup', () => {
    if (_cs) _cs.dragging = false;
    if (zone) zone.style.cursor = 'grab';
  });

  // ── Drag tactile ──────────────────────────
  let _t0 = null;
  zone.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      _cs.dragging = true;
      _cs.startMX  = t.clientX - _cs.ox;
      _cs.startMY  = t.clientY - _cs.oy;
      _t0 = null;
    } else if (e.touches.length === 2) {
      _t0 = _pinchDist(e);
      _cs.dragging = false;
    }
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && _cs.dragging) {
      const t = e.touches[0];
      _cs.ox = t.clientX - _cs.startMX;
      _cs.oy = t.clientY - _cs.startMY;
      _applyCSS();
    } else if (e.touches.length === 2 && _t0 > 0) {
      const d1 = _pinchDist(e);
      const factor = d1 / _t0;
      const newScale = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), _cs.scale * factor));
      const cx = VIEW_SIZE / 2, cy = VIEW_SIZE / 2;
      _cs.ox = cx - (cx - _cs.ox) * (newScale / _cs.scale);
      _cs.oy = cy - (cy - _cs.oy) * (newScale / _cs.scale);
      _cs.scale = newScale;
      slider.value = newScale;
      _t0 = d1;
      _applyCSS();
    }
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener('touchend', () => { _cs.dragging = false; _t0 = null; });
}

function _pinchDist(e) {
  const a = e.touches[0], b = e.touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function _applyCSS() {
  if (!_cs?.img) return;
  _cs.img.style.transform = `translate(${_cs.ox}px, ${_cs.oy}px) scale(${_cs.scale})`;
}

// ══════════════════════════════════════════════
// EXPORT — la formule correcte
//
// Dans la zone VIEW_SIZE×VIEW_SIZE, l'image source
// (naturalW × naturalH) est placée à (ox, oy)
// avec un facteur scale.
//
// Un pixel CSS (px, py) dans la zone correspond
// à un pixel source :
//   sx = (px - ox) / scale
//   sy = (py - oy) / scale
//
// La zone va de (0,0) à (VIEW_SIZE, VIEW_SIZE)
// donc en coordonnées source :
//   src_x =   (0     - ox) / scale  =  -ox / scale
//   src_y =   (0     - oy) / scale  =  -oy / scale
//   src_w = VIEW_SIZE / scale
//   src_h = VIEW_SIZE / scale
//
// On dessine ça sur un canvas OUTPUT_SIZE×OUTPUT_SIZE.
// ══════════════════════════════════════════════
async function saveCroppedPhoto(charId) {
  if (!_cs?.img || !_cs.scale) {
    showNotif('Erreur : cropper non initialisé.', 'error');
    return;
  }

  const { ox, oy, scale, img, naturalW, naturalH } = _cs;

  // Région source correspondant à la zone visible
  const srcX = -ox / scale;
  const srcY = -oy / scale;
  const srcW =  VIEW_SIZE / scale;
  const srcH =  VIEW_SIZE / scale;

  // Clamper pour ne pas déborder de l'image source
  const clampedSrcX = Math.max(0, srcX);
  const clampedSrcY = Math.max(0, srcY);
  const clampedSrcW = Math.min(srcW, naturalW - clampedSrcX);
  const clampedSrcH = Math.min(srcH, naturalH - clampedSrcY);

  // Position de destination sur le canvas (si l'image ne couvre pas tout)
  const dstX = Math.max(0, (0  - srcX) * (OUTPUT_SIZE / srcW));
  const dstY = Math.max(0, (0  - srcY) * (OUTPUT_SIZE / srcH));
  const dstW = clampedSrcW * (OUTPUT_SIZE / srcW);
  const dstH = clampedSrcH * (OUTPUT_SIZE / srcH);

  const canvas = document.createElement('canvas');
  canvas.width  = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');

  // Fond noir si l'image ne couvre pas tout le carré
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  ctx.drawImage(
    img,
    clampedSrcX, clampedSrcY, clampedSrcW, clampedSrcH,  // source
    dstX,        dstY,        dstW,         dstH           // destination
  );

  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c) { showNotif('Personnage introuvable.', 'error'); return; }

  c.photo   = dataUrl;
  c.photoZoom = 1; c.photoX = 0; c.photoY = 0; // legacy reset
  await updateInCol('characters', charId, { photo: dataUrl, photoZoom: 1, photoX: 0, photoY: 0 });

  _cs = null;
  closeModal();
  showNotif('Photo enregistrée !', 'success');
  window.renderCharSheet?.(c, window._currentCharTab || 'combat');
}

async function deleteCharPhoto(charId) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  c.photo = null; c.photoZoom = 1; c.photoX = 0; c.photoY = 0;
  await updateInCol('characters', charId, { photo: null, photoZoom: 1, photoX: 0, photoY: 0 });
  _cs = null;
  showNotif('Photo supprimée.', 'success');
  window.renderCharSheet?.(c, window._currentCharTab || 'combat');
}

Object.assign(window, { openPhotoCropper, saveCroppedPhoto, deleteCharPhoto });
