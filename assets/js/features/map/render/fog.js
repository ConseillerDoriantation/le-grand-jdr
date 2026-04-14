// ══════════════════════════════════════════════════════════════════════════════
// Fog of war — polygones révélés par le MJ.
// Port du comportement existant (format {pts:[{x%, y%}]} dans world/map_fog).
// - Côté joueur : la carte est noire, les zones révélées percent le fog.
// - Côté MJ : overlay SVG vert qui matérialise les zones sans masquer la carte.
// - Mode dessin (MJ) : clic = ajouter un point, double-clic/Entrée = fermer.
// ══════════════════════════════════════════════════════════════════════════════

import { state, emit } from '../map.state.js';
import { saveFogZones } from '../data/maps.repo.js';
import { getImageSize } from './viewport.js';
import { STATE } from '../../../core/state.js';
import { showNotif } from '../../../shared/notifications.js';
import { confirmModal } from '../../../shared/modal.js';

let canvasEl = null;
let rootEl = null;
let transformEl = null;
let previewMode = false; // admin → simuler la vue joueur

const drawing = { active: false, current: [], mousePos: null };
let drawDetachers = [];

export function bindFog(canvas, root, transform) {
  canvasEl = canvas;
  rootEl = root;
  transformEl = transform;
}

export function renderFog() {
  if (!canvasEl) return;
  const { w, h } = getImageSize();
  canvasEl.width = w;
  canvasEl.height = h;
  canvasEl.style.width = `${w}px`;
  canvasEl.style.height = `${h}px`;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const asPlayer = !STATE.isAdmin || previewMode;

  if (asPlayer) {
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, w, h);
    if (state.fogZones.length) {
      ctx.globalCompositeOperation = 'destination-out';
      state.fogZones.forEach(poly => fillPoly(ctx, poly, w, h));
      ctx.globalCompositeOperation = 'source-over';
    }
    renderOverlay(false);
    return;
  }

  // Admin : pas de fog opaque, juste l'overlay SVG des zones
  renderOverlay(true);
}

function fillPoly(ctx, poly, W, H) {
  if (!poly.pts?.length) return;
  ctx.beginPath();
  poly.pts.forEach((p, i) => {
    const px = (p.x / 100) * W;
    const py = (p.y / 100) * H;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

function renderOverlay(isAdmin) {
  if (!transformEl) return;
  let ol = document.getElementById('map-fog-overlay');
  if (!ol) {
    ol = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ol.id = 'map-fog-overlay';
    ol.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    ol.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible';
    transformEl.appendChild(ol);
  }
  const { w, h } = getImageSize();
  ol.setAttribute('viewBox', `0 0 ${w} ${h}`);
  ol.setAttribute('width', w);
  ol.setAttribute('height', h);

  let svg = '';
  state.fogZones.forEach((poly, pi) => {
    if (!poly.pts?.length) return;
    const d = poly.pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x / 100 * w).toFixed(1)} ${(p.y / 100 * h).toFixed(1)}`)
      .join(' ') + ' Z';
    svg += `<path d="${d}" fill="rgba(34,195,142,0.12)" stroke="rgba(34,195,142,0.65)" stroke-width="1.5"/>`;
    if (isAdmin) {
      const cx = poly.pts.reduce((s, p) => s + p.x / 100 * w, 0) / poly.pts.length;
      const cy = poly.pts.reduce((s, p) => s + p.y / 100 * h, 0) / poly.pts.length;
      svg += `<g style="pointer-events:all;cursor:pointer" data-fog-remove="${pi}">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="rgba(200,40,40,0.85)" stroke="#fff" stroke-width="1.5"/>
        <text x="${cx.toFixed(1)}" y="${(cy + 4.5).toFixed(1)}" text-anchor="middle" font-size="12" fill="#fff" font-weight="bold">✕</text>
      </g>`;
    }
  });

  // Polygone en cours de dessin
  if (drawing.active && drawing.current.length) {
    const pts = drawing.current;
    const all = drawing.mousePos ? [...pts, drawing.mousePos] : pts;
    if (all.length >= 2) {
      const d = all
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x / 100 * w).toFixed(1)} ${(p.y / 100 * h).toFixed(1)}`)
        .join(' ');
      svg += `<path d="${d}" fill="rgba(232,184,75,0.10)" stroke="rgba(232,184,75,0.85)" stroke-width="1.5" stroke-dasharray="6 3"/>`;
    }
    pts.forEach((p, i) => {
      svg += `<circle cx="${(p.x / 100 * w).toFixed(1)}" cy="${(p.y / 100 * h).toFixed(1)}" r="${i === 0 ? 7 : 4}" fill="${i === 0 ? 'rgba(232,184,75,0.9)' : 'rgba(255,255,255,0.85)'}" stroke="rgba(232,184,75,0.8)" stroke-width="1.5"/>`;
    });
    if (drawing.mousePos) {
      svg += `<circle cx="${(drawing.mousePos.x / 100 * w).toFixed(1)}" cy="${(drawing.mousePos.y / 100 * h).toFixed(1)}" r="3" fill="rgba(232,184,75,0.6)"/>`;
    }
  }

  ol.innerHTML = svg;

  // Clics sur les croix de suppression
  ol.querySelectorAll('[data-fog-remove]').forEach(node => {
    node.addEventListener('click', async ev => {
      ev.stopPropagation();
      const idx = parseInt(node.dataset.fogRemove, 10);
      if (!await confirmModal('Supprimer cette zone révélée ?', {title: 'Suppression de la zone de brouillard'})) return;
      state.fogZones.splice(idx, 1);
      try {
        await saveFogZones(state.fogZones);
        renderFog();
        showNotif('Zone supprimée.', 'success');
      } catch (e) {
        console.error('[fog] remove', e);
        showNotif('Erreur de suppression.', 'error');
      }
    });
  });
}

// ── Mode dessin (MJ) ──────────────────────────────────────────────────────────

export function startFogDraw() {
  if (drawing.active) return;
  drawing.active = true;
  drawing.current = [];
  drawing.mousePos = null;
  state.mode = 'fog';
  if (transformEl) transformEl.style.cursor = 'crosshair';

  const toPct = (clientX, clientY) => {
    // On prend les coordonnées relatives au rect de l'image (inclut déjà le transform)
    const img = document.getElementById('map-img');
    const rect = img?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const onMove = e => {
    drawing.mousePos = toPct(e.clientX, e.clientY);
    renderFog();
  };
  const onClick = e => {
    e.stopPropagation();
    drawing.current.push(toPct(e.clientX, e.clientY));
    renderFog();
  };
  const onDblClick = e => {
    e.stopPropagation();
    e.preventDefault();
    // Le dblclick ajoute un point via le 1er clic : on le retire
    if (drawing.current.length > 0) drawing.current.pop();
    commit();
  };
  const onKey = e => {
    if (e.key === 'Escape') stopFogDraw();
    else if ((e.key === 'Backspace' || e.key === 'Delete') && drawing.current.length) {
      drawing.current.pop();
      renderFog();
    } else if (e.key === 'Enter' && drawing.current.length >= 3) {
      commit();
    }
  };

  rootEl.addEventListener('mousemove', onMove);
  rootEl.addEventListener('click', onClick, { capture: true });
  rootEl.addEventListener('dblclick', onDblClick, { capture: true });
  window.addEventListener('keydown', onKey);

  drawDetachers = [
    () => rootEl.removeEventListener('mousemove', onMove),
    () => rootEl.removeEventListener('click', onClick, { capture: true }),
    () => rootEl.removeEventListener('dblclick', onDblClick, { capture: true }),
    () => window.removeEventListener('keydown', onKey),
  ];
  emit('fog:mode', { active: true });
}

export function stopFogDraw() {
  if (!drawing.active) return;
  drawing.active = false;
  drawing.current = [];
  drawing.mousePos = null;
  drawDetachers.forEach(fn => fn());
  drawDetachers = [];
  if (transformEl) transformEl.style.cursor = 'grab';
  if (state.mode === 'fog') state.mode = 'navigate';
  renderFog();
  emit('fog:mode', { active: false });
}

async function commit() {
  if (drawing.current.length < 3) {
    drawing.current = [];
    renderFog();
    return;
  }
  state.fogZones.push({ pts: [...drawing.current] });
  drawing.current = [];
  try {
    await saveFogZones(state.fogZones);
    showNotif('Zone révélée ajoutée ✓', 'success');
  } catch (e) {
    console.error('[fog] save', e);
    showNotif('Erreur de sauvegarde du fog.', 'error');
  }
  renderFog();
}

export async function clearFog() {
  if (!await confirmModal('Effacer toutes les zones révélées ?')) return;
  state.fogZones = [];
  await saveFogZones([]);
  renderFog();
  showNotif('Brouillard effacé.', 'success');
}

export function togglePlayerPreview() {
  previewMode = !previewMode;
  renderFog();
  return previewMode;
}
