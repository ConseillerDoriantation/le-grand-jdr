import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

// ══════════════════════════════════════════════
// PHOTO CROPPER — drag + zoom sur carré 1:1
// Sauvegarde : base64 canvas 300x300
// ══════════════════════════════════════════════

const CANVAS_SIZE = 300; // taille de sortie

function openPhotoCropper(charId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => _showCropModal(ev.target?.result, charId);
    reader.readAsDataURL(file);
  };
  input.click();
}

function _showCropModal(dataUrl, charId) {
  openModal('📷 Cadrer la photo', `
    <div style="position:relative;width:300px;height:300px;margin:0 auto;
         border-radius:12px;overflow:hidden;background:#111;
         cursor:grab;touch-action:none;border:2px solid var(--border)"
         id="crop-zone">
      <img id="crop-img" src="${dataUrl}"
           style="position:absolute;transform-origin:0 0;pointer-events:none;display:block;user-select:none;">
    </div>
    <div style="margin:0.8rem auto;width:300px">
      <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.3rem">Zoom</label>
      <input type="range" id="crop-zoom" min="0.5" max="4" step="0.05" value="1"
             style="width:100%;accent-color:var(--gold)">
    </div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end;width:300px;margin:0 auto">
      <button class="btn btn-outline" onclick="closeModal()">Annuler</button>
      <button class="btn btn-gold" onclick="saveCroppedPhoto('${charId}')">Enregistrer</button>
    </div>
  `);

  // Attendre que le DOM soit prêt
  requestAnimationFrame(() => _initCropper(dataUrl));
}

function _initCropper(dataUrl) {
  const zone  = document.getElementById('crop-zone');
  const img   = document.getElementById('crop-img');
  const zoom  = document.getElementById('crop-zoom');
  if (!zone || !img || !zoom) return;

  const state = { x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0 };
  window._cropState = state;

  // Quand l'image charge, centrer
  img.onload = () => {
    const natural = Math.min(img.naturalWidth, img.naturalHeight);
    state.scale = CANVAS_SIZE / natural;
    state.x = (CANVAS_SIZE - img.naturalWidth  * state.scale) / 2;
    state.y = (CANVAS_SIZE - img.naturalHeight * state.scale) / 2;
    zoom.value = state.scale;
    _applyTransform(img, state);
  };

  // Zoom slider
  zoom.addEventListener('input', () => {
    const newScale = parseFloat(zoom.value);
    const cx = CANVAS_SIZE / 2, cy = CANVAS_SIZE / 2;
    state.x = cx - (cx - state.x) * (newScale / state.scale);
    state.y = cy - (cy - state.y) * (newScale / state.scale);
    state.scale = newScale;
    _applyTransform(img, state);
  });

  // Drag souris
  zone.addEventListener('mousedown', e => {
    state.dragging = true;
    state.startX = e.clientX - state.x;
    state.startY = e.clientY - state.y;
    zone.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!state.dragging) return;
    state.x = e.clientX - state.startX;
    state.y = e.clientY - state.startY;
    _applyTransform(img, state);
  });
  window.addEventListener('mouseup', () => { state.dragging = false; zone.style.cursor = 'grab'; });

  // Drag touch
  zone.addEventListener('touchstart', e => {
    const t = e.touches[0];
    state.dragging = true;
    state.startX = t.clientX - state.x;
    state.startY = t.clientY - state.y;
    e.preventDefault();
  }, {passive: false});
  zone.addEventListener('touchmove', e => {
    if (!state.dragging) return;
    const t = e.touches[0];
    state.x = t.clientX - state.startX;
    state.y = t.clientY - state.startY;
    _applyTransform(img, state);
    e.preventDefault();
  }, {passive: false});
  zone.addEventListener('touchend', () => { state.dragging = false; });

  // Pinch zoom (touch)
  let lastDist = 0;
  zone.addEventListener('touchstart', e => {
    if (e.touches.length === 2) lastDist = _touchDist(e);
  });
  zone.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const dist = _touchDist(e);
      if (lastDist > 0) {
        const ratio = dist / lastDist;
        const newScale = Math.max(0.5, Math.min(4, state.scale * ratio));
        state.x = CANVAS_SIZE/2 - (CANVAS_SIZE/2 - state.x) * (newScale/state.scale);
        state.y = CANVAS_SIZE/2 - (CANVAS_SIZE/2 - state.y) * (newScale/state.scale);
        state.scale = newScale;
        zoom.value = newScale;
        _applyTransform(img, state);
      }
      lastDist = dist;
      e.preventDefault();
    }
  }, {passive: false});

  // Scroll wheel zoom
  zone.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(0.5, Math.min(4, state.scale + delta));
    const rect = zone.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.x = mx - (mx - state.x) * (newScale/state.scale);
    state.y = my - (my - state.y) * (newScale/state.scale);
    state.scale = newScale;
    zoom.value = newScale;
    _applyTransform(img, state);
  }, {passive: false});
}

function _touchDist(e) {
  const [a, b] = [e.touches[0], e.touches[1]];
  return Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
}

function _applyTransform(img, state) {
  img.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.scale})`;
}

async function saveCroppedPhoto(charId) {
  const img   = document.getElementById('crop-img');
  const state = window._cropState;
  if (!img || !state) return;

  // Canvas 300×300 — on dessine l'image à la position/scale actuelle
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    img,
    -state.x / state.scale,
    -state.y / state.scale,
    CANVAS_SIZE / state.scale,
    CANVAS_SIZE / state.scale,
    0, 0, CANVAS_SIZE, CANVAS_SIZE
  );

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  c.photo = dataUrl;
  // On remet zoom/offset à 1/0 car c'est déjà intégré dans le canvas
  c.photoZoom = 1; c.photoX = 0; c.photoY = 0;
  await updateInCol('characters', charId, { photo: dataUrl, photoZoom: 1, photoX: 0, photoY: 0 });
  closeModal();
  showNotif('Photo enregistrée !', 'success');
  window.renderCharSheet?.(c, window._currentCharTab || 'combat');
}

async function deleteCharPhoto(charId) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  c.photo = null; c.photoZoom = 1; c.photoX = 0; c.photoY = 0;
  await updateInCol('characters', charId, { photo: null, photoZoom: 1, photoX: 0, photoY: 0 });
  showNotif('Photo supprimée.', 'success');
  window.renderCharSheet?.(c, window._currentCharTab || 'combat');
}

Object.assign(window, { openPhotoCropper, saveCroppedPhoto, deleteCharPhoto });
