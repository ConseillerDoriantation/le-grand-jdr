// ══════════════════════════════════════════════════════════════════════════════
// Viewport — pan, zoom, conversions coordonnées normalisées <-> pixels image.
// Les lieux stockent x,y dans [0..1] (indépendant de la résolution de l'image).
// Ce module se charge de tout ce qui concerne la transformation visuelle.
// ══════════════════════════════════════════════════════════════════════════════

import { state, emit } from '../map.state.js';

let rootEl = null;
let transformEl = null;
let imgEl = null;
let imgNatural = { w: 1200, h: 800 };
let detachFns = [];

export function bindViewport(root, transform, image) {
  rootEl = root;
  transformEl = transform;
  imgEl = image;

  if (imgEl) {
    const onLoad = () => {
      imgNatural = {
        w: imgEl.naturalWidth || 1200,
        h: imgEl.naturalHeight || 800,
      };
      // Re-applique la transformation maintenant que la taille réelle de
      // l'image est connue : sans ça, le premier affichage peut différer
      // du résultat d'un resetView alors que state.viewport est identique.
      applyTransform();
      emit('viewport:ready');
    };
    if (imgEl.complete && imgEl.naturalWidth) onLoad();
    else imgEl.addEventListener('load', onLoad, { once: true });
  } else {
    // Pas d'image : on garde des dimensions par défaut pour que le SVG ait un viewBox
    queueMicrotask(() => emit('viewport:ready'));
  }

  attachPanZoom();
  applyTransform();
}

export function destroyViewport() {
  detachFns.forEach(fn => fn());
  detachFns = [];
  rootEl = transformEl = imgEl = null;
}

export function getImageSize() {
  return imgNatural;
}

// Coord normalisée [0..1] -> pixel dans le repère image
export function normToImagePx(nx, ny) {
  return { x: nx * imgNatural.w, y: ny * imgNatural.h };
}

// Clic écran -> coord normalisée [0..1] dans le repère image
// On utilise la bounding rect de l'image elle-même (elle inclut déjà le transform parent).
export function screenToNorm(clientX, clientY) {
  if (!imgEl) return { x: 0, y: 0 };
  const rect = imgEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top)  / rect.height,
  };
}

export function applyTransform() {
  if (!transformEl) return;
  const { scale, offsetX, offsetY } = state.viewport;
  const t = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  transformEl.style.transform = t;
}

export function zoom(factor, centerClientX, centerClientY) {
  if (!rootEl) return;
  const prev = state.viewport.scale;
  const next = Math.max(0.10, Math.min(5, prev * factor));
  if (next === prev) return;

  // Zoom centré sur le pointeur si fourni, sinon centre du root
  const rect = rootEl.getBoundingClientRect();
  const cx = (centerClientX ?? rect.left + rect.width / 2) - rect.left;
  const cy = (centerClientY ?? rect.top + rect.height / 2) - rect.top;

  state.viewport.offsetX = cx - (cx - state.viewport.offsetX) * (next / prev);
  state.viewport.offsetY = cy - (cy - state.viewport.offsetY) * (next / prev);
  state.viewport.scale = next;
  applyTransform();
  emit('viewport:changed');
}

export function resetView() {
  state.viewport = { scale: 0.14, offsetX: 25, offsetY: -250 };
  applyTransform();
  emit('viewport:changed');
}

// ── Interactions pan/zoom (souris + touch) ────────────────────────────────────

function attachPanZoom() {
  if (!rootEl || !transformEl) return;

  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  let lastTouchDist = null;

  const canPan = () => state.mode === 'navigate' || state.mode === 'repositioning';

  const onMouseDown = e => {
    if (e.button !== 0) return;
    if (!canPan()) return;
    dragging = true;
    sx = e.clientX - state.viewport.offsetX;
    sy = e.clientY - state.viewport.offsetY;
    ox = state.viewport.offsetX;
    oy = state.viewport.offsetY;
    transformEl.style.cursor = 'grabbing';
  };
  const onMouseMove = e => {
    if (!dragging) return;
    state.viewport.offsetX = e.clientX - sx;
    state.viewport.offsetY = e.clientY - sy;
    applyTransform();
  };
  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    if (transformEl) transformEl.style.cursor = 'grab';
  };
  const onWheel = e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    zoom(factor, e.clientX, e.clientY);
  };

  // Touch
  const onTouchStart = e => {
    if (e.touches.length === 1 && canPan()) {
      dragging = true;
      sx = e.touches[0].clientX - state.viewport.offsetX;
      sy = e.touches[0].clientY - state.viewport.offsetY;
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  };
  const onTouchMove = e => {
    if (e.touches.length === 1 && dragging) {
      state.viewport.offsetX = e.touches[0].clientX - sx;
      state.viewport.offsetY = e.touches[0].clientY - sy;
      applyTransform();
    } else if (e.touches.length === 2 && lastTouchDist) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      zoom(dist / lastTouchDist);
      lastTouchDist = dist;
    }
  };
  const onTouchEnd = () => { dragging = false; lastTouchDist = null; };

  rootEl.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  rootEl.addEventListener('wheel', onWheel, { passive: false });
  rootEl.addEventListener('touchstart', onTouchStart, { passive: true });
  rootEl.addEventListener('touchmove', onTouchMove, { passive: true });
  rootEl.addEventListener('touchend', onTouchEnd);

  detachFns.push(
    () => rootEl?.removeEventListener('mousedown', onMouseDown),
    () => window.removeEventListener('mousemove', onMouseMove),
    () => window.removeEventListener('mouseup', onMouseUp),
    () => rootEl?.removeEventListener('wheel', onWheel),
    () => rootEl?.removeEventListener('touchstart', onTouchStart),
    () => rootEl?.removeEventListener('touchmove', onTouchMove),
    () => rootEl?.removeEventListener('touchend', onTouchEnd),
  );
}
