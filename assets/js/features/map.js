// ══════════════════════════════════════════════════════════════════════════════
// MAP.JS — Carte interactive
// Markers cliquables · Zoom/pan · Fog of war · Interface admin
// ══════════════════════════════════════════════════════════════════════════════
import { getDocData, saveDoc, loadCollection, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { _esc } from '../shared/html.js';
import { bindImageDropZone, confirmCanvasCrop, getCroppedBase64, resetCrop } from '../shared/image-upload.js';

// ── Types de lieux ────────────────────────────────────────────────────────────
export const LIEU_TYPES = [
  { id: 'ville',    label: 'Ville',         emoji: '🏙️', color: '#4f8cff' },
  { id: 'village',  label: 'Village',       emoji: '🏘️', color: '#22c38e' },
  { id: 'donjon',   label: 'Donjon',        emoji: '⚔️', color: '#ff6b6b' },
  { id: 'nature',   label: 'Lieu naturel',  emoji: '🌿', color: '#90c46b' },
  { id: 'ruines',   label: 'Ruines',        emoji: '🏚️', color: '#b0956a' },
  { id: 'special',  label: 'Spécial',       emoji: '✨', color: '#e8b84b' },
];

// ── État local ────────────────────────────────────────────────────────────────
let mapState = {
  imageUrl: '',
  lieux: [],          // markers chargés depuis Firestore
  fogZones: [],       // zones de brouillard
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  placingMode: false, // mode admin : clic pour placer un marker
  selectedLieu: null,
};

// ── Initialisation ────────────────────────────────────────────────────────────
export async function initMap(containerEl) {
  const doc      = await getDocData('world', 'map');
  const lieux    = await loadCollection('map_lieux');
  const fogDoc   = await getDocData('world', 'map_fog');

  mapState.imageUrl = doc?.imageUrl || '';
  mapState.lieux    = lieux || [];
  // Migrer l'ancien format {x,y,r} vers le nouveau {pts:[...]}
  const rawZones = fogDoc?.zones || [];
  mapState.fogZones = rawZones.filter(z => Array.isArray(z.pts)); // ignorer l'ancien format circulaire

  renderMap(containerEl);
}

// ── Rendu principal ───────────────────────────────────────────────────────────
function renderMap(containerEl) {
  containerEl.innerHTML = `
    <div id="map-root" style="position:relative;width:100%;height:100%;overflow:hidden;background:#0b1118;border-radius:var(--radius-lg)">

      <!-- Wrapper zoomable/panable -->
      <div id="map-transform" style="position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;cursor:grab;user-select:none">

        <!-- Image de la carte -->
        ${mapState.imageUrl
          ? `<img id="map-img" src="${mapState.imageUrl}" style="display:block;max-width:none;pointer-events:none" draggable="false">`
          : `<div style="width:1200px;height:800px;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-style:italic;font-size:0.9rem">
               ${STATE.isAdmin ? 'Aucune image. Cliquez sur ⚙️ pour en ajouter une.' : 'La carte sera dévoilée par le Maître de Jeu.'}
             </div>`
        }

        <!-- Markers SVG superposés -->
        <svg id="map-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible"></svg>

        <!-- Fog of war canvas -->
        <canvas id="map-fog" style="position:absolute;top:0;left:0;pointer-events:none;opacity:1"></canvas>
      </div>

      <!-- Contrôles zoom -->\n      <div style="position:absolute;bottom:1rem;right:1rem;display:flex;flex-direction:column;gap:6px;z-index:10">
        <button class="btn btn-outline" id="map-zoom-in"  style="width:36px;height:36px;padding:0;font-size:1.1rem;display:flex;align-items:center;justify-content:center">+</button>
        <button class="btn btn-outline" id="map-zoom-out" style="width:36px;height:36px;padding:0;font-size:1.1rem;display:flex;align-items:center;justify-content:center">−</button>
        <button class="btn btn-outline" id="map-reset"    style="width:36px;height:36px;padding:0;font-size:0.75rem;display:flex;align-items:center;justify-content:center" title="Réinitialiser la vue">⌂</button>
      </div>

      <!-- Barre admin -->\n      ${STATE.isAdmin ? `
      <div id="map-admin-bar" style="
        position:absolute;top:1rem;left:50%;transform:translateX(-50%);
        background:rgba(11,17,24,0.92);border:1px solid var(--border-strong);
        border-radius:999px;padding:0.4rem 0.75rem;
        display:flex;align-items:center;gap:0.6rem;z-index:10;
        backdrop-filter:blur(8px);
      ">
        <button class="btn btn-outline btn-sm" id="btn-place-marker" style="border-radius:999px;font-size:0.75rem">
          📍 Placer un lieu
        </button>
        <button class="btn btn-outline btn-sm" id="btn-fog-toggle" style="border-radius:999px;font-size:0.75rem">
          🌫️ Dessiner le fog
        </button>
        <button class="btn btn-outline btn-sm" id="btn-map-settings" style="border-radius:999px;font-size:0.75rem">
          ⚙️ Paramètres
        </button>
      </div>
      <div id="map-placing-hint" style="
        display:none;position:absolute;bottom:4rem;left:50%;transform:translateX(-50%);
        background:rgba(79,140,255,0.15);border:1px solid var(--border-bright);
        border-radius:999px;padding:0.4rem 1rem;font-size:0.8rem;color:var(--gold);
        z-index:10;pointer-events:none;white-space:nowrap;
      ">Cliquez sur la carte pour placer le lieu</div>
      ` : `
      <!-- Indicateur fog joueur -->
      ${(mapState.fogZones||[]).length === 0 ? `
      <div style="position:absolute;top:1rem;left:50%;transform:translateX(-50%);
        background:rgba(8,12,20,0.88);border:1px solid rgba(255,255,255,0.08);
        border-radius:999px;padding:.35rem .9rem;font-size:.75rem;color:var(--text-dim);
        z-index:10;pointer-events:none">
        🌫️ Le Maître de Jeu n'a pas encore révélé la carte
      </div>` : ''}
      `}

      <!-- Sidebar lieu -->
      <div id="map-sidebar" style="
        position:absolute;top:0;right:0;bottom:0;width:280px;
        background:rgba(11,17,24,0.95);border-left:1px solid var(--border);
        transform:translateX(100%);transition:transform 0.25s ease;
        z-index:20;overflow-y:auto;display:flex;flex-direction:column;
      "></div>
    </div>
  `;

  setupZoomPan();
  renderMarkers();
  renderFog();
  if (STATE.isAdmin) setupAdminControls();
}

// ── Zoom / Pan ────────────────────────────────────────────────────────────────
function setupZoomPan() {
  const root      = document.getElementById('map-root');
  const transform = document.getElementById('map-transform');
  if (!root || !transform) return;

  function applyTransform() {
    transform.style.transform = `translate(${mapState.offsetX}px, ${mapState.offsetY}px) scale(${mapState.scale})`;
  }

  // Molette
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect  = root.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.1 : 0.91;
    const newScale = Math.min(Math.max(mapState.scale * delta, 0.3), 5);

    mapState.offsetX = mx - (mx - mapState.offsetX) * (newScale / mapState.scale);
    mapState.offsetY = my - (my - mapState.offsetY) * (newScale / mapState.scale);
    mapState.scale   = newScale;
    applyTransform();
  }, { passive: false });

  // Drag souris
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (mapState.placingMode) return;
    mapState.isDragging = true;
    mapState.dragStart  = { x: e.clientX - mapState.offsetX, y: e.clientY - mapState.offsetY };
    transform.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!mapState.isDragging) return;
    mapState.offsetX = e.clientX - mapState.dragStart.x;
    mapState.offsetY = e.clientY - mapState.dragStart.y;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    mapState.isDragging = false;
    transform.style.cursor = 'grab';
  });

  // Touch
  let lastTouchDist = null;
  root.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && !mapState.placingMode) {
      mapState.isDragging = true;
      mapState.dragStart  = { x: e.touches[0].clientX - mapState.offsetX, y: e.touches[0].clientY - mapState.offsetY };
    }
    if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  root.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && mapState.isDragging) {
      mapState.offsetX = e.touches[0].clientX - mapState.dragStart.x;
      mapState.offsetY = e.touches[0].clientY - mapState.dragStart.y;
      applyTransform();
    }
    if (e.touches.length === 2 && lastTouchDist) {
      const dist     = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const ratio    = dist / lastTouchDist;
      mapState.scale = Math.min(Math.max(mapState.scale * ratio, 0.3), 5);
      lastTouchDist  = dist;
      applyTransform();
    }
  }, { passive: true });

  root.addEventListener('touchend', () => { mapState.isDragging = false; lastTouchDist = null; });

  // Clic sur la carte (placer marker en mode admin)
  root.addEventListener('click', (e) => {
    if (!mapState.placingMode || !STATE.isAdmin) return;
    const img  = document.getElementById('map-img');
    if (!img) return;
    const rect = img.getBoundingClientRect(); // rect de l'image affichée (tient compte du zoom/pan)
    const x    = ((e.clientX - rect.left) / rect.width)  * 100;
    const y    = ((e.clientY - rect.top)  / rect.height) * 100;
    // Vérifier que le clic est bien sur l'image
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    openPlaceLieuModal(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  });

  // Boutons zoom
  document.getElementById('map-zoom-in')?.addEventListener('click', () => {
    mapState.scale = Math.min(mapState.scale * 1.2, 5);
    applyTransform();
  });
  document.getElementById('map-zoom-out')?.addEventListener('click', () => {
    mapState.scale = Math.max(mapState.scale * 0.83, 0.3);
    applyTransform();
  });
  document.getElementById('map-reset')?.addEventListener('click', () => {
    mapState.scale = 1; mapState.offsetX = 0; mapState.offsetY = 0;
    applyTransform();
  });

  applyTransform();
}

// ── Markers ───────────────────────────────────────────────────────────────────
function renderMarkers() {
  const svg = document.getElementById('map-svg');
  const img = document.getElementById('map-img');
  if (!svg || !img) return;

  // Attendre que l'image soit chargée pour avoir les dimensions
  const doRender = () => {
    svg.setAttribute('width',  img.naturalWidth  || img.offsetWidth);
    svg.setAttribute('height', img.naturalHeight || img.offsetHeight);
    svg.innerHTML = '';

    mapState.lieux.forEach(lieu => {
      if (lieu.hidden && !STATE.isAdmin) return;

      const x = (lieu.x / 100) * (img.naturalWidth  || img.offsetWidth);
      const y = (lieu.y / 100) * (img.naturalHeight || img.offsetHeight);
      const type  = LIEU_TYPES.find(t => t.id === lieu.type) || LIEU_TYPES[0];
      const color = lieu.hidden ? '#555' : type.color;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.style.cursor = 'pointer';
      g.style.pointerEvents = 'all';

      // Ombre portée
      g.innerHTML = `
        <circle cx="${x}" cy="${y}" r="14" fill="${color}" opacity="0.18"/>
        <circle cx="${x}" cy="${y}" r="9"  fill="${color}" opacity="${lieu.hidden ? 0.4 : 0.9}" stroke="#0b1118" stroke-width="1.5"/>
        <text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central"
          font-size="10" style="pointer-events:none;user-select:none">${type.emoji}</text>
        <text x="${x}" y="${y + 22}" text-anchor="middle"
          font-family="'Cinzel',serif" font-size="10" fill="${color}"
          stroke="#0b1118" stroke-width="3" paint-order="stroke"
          style="pointer-events:none;user-select:none">${lieu.nom}</text>
      `;

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        openSidebar(lieu);
      });

      if (STATE.isAdmin) {
        g.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openEditLieuModal(lieu);
        });
      }

      svg.appendChild(g);
    });
  };

  if (img.complete && img.naturalWidth) doRender();
  else img.addEventListener('load', doRender);
}

// ── Fog of war — polygones précis ────────────────────────────────────────────
let _fogDrawing = { active:false, current:[], mousePos:null };

function renderFog() {
  const canvas = document.getElementById('map-fog');
  const img    = document.getElementById('map-img');
  if (!canvas || !img) return;

  const doFog = () => {
    const W = img.naturalWidth || img.offsetWidth;
    const H = img.naturalHeight || img.offsetHeight;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const polys = mapState.fogZones || [];

    if (STATE.isAdmin) {
      // ── ADMIN : fog léger juste pour visualiser les zones ─────────────────
      // Pas de fog opaque — on voit tout, les zones sont juste colorées en vert
      // (le SVG overlay s'en charge via _renderFogOverlay)
      _renderFogOverlay();
      return;
    }

    // ── JOUEUR : fog noir total sur TOUTE la carte ───────────────────────────
    // Les zones dessinées par le MJ = zones RÉVÉLÉES (trous dans le fog)
    if (polys.length === 0) {
      // Aucune zone révélée : noir absolu
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    // Noir absolu sur toute la carte
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, W, H);

    // Percer les zones révélées
    ctx.globalCompositeOperation = 'destination-out';
    polys.forEach(poly => {
      if (!poly.pts?.length) return;
      ctx.beginPath();
      poly.pts.forEach((p, i) => {
        const px = (p.x / 100) * W;
        const py = (p.y / 100) * H;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    // Bordure douce sur les bords des trous
    ctx.globalCompositeOperation = 'source-over';
    polys.forEach(poly => {
      if (!poly.pts?.length) return;
      ctx.beginPath();
      poly.pts.forEach((p, i) => {
        const px = (p.x / 100) * W;
        const py = (p.y / 100) * H;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(34,195,142,0.25)';
      ctx.lineWidth = 3;
      ctx.stroke();
    });
  };

  if (img.complete && img.naturalWidth) doFog();
  else img.addEventListener('load', doFog);
}

function _renderFogOverlay() {
  let ol = document.getElementById('fog-draw-overlay');
  const transform = document.getElementById('map-transform');
  if (!transform) return;
  if (!ol) {
    ol = document.createElementNS('http://www.w3.org/2000/svg','svg');
    ol.id = 'fog-draw-overlay';
    ol.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible';
    transform.appendChild(ol);
  }
  const img = document.getElementById('map-img');
  if (!img) return;
  const W = img.naturalWidth||img.offsetWidth, H = img.naturalHeight||img.offsetHeight;
  ol.setAttribute('viewBox',`0 0 ${W} ${H}`);
  let svg = '';

  // Polygones sauvegardés (contour vert + croix admin)
  (mapState.fogZones||[]).forEach((poly,pi) => {
    if (!poly.pts?.length) return;
    const d = poly.pts.map((p,i) => `${i===0?'M':'L'}${(p.x/100*W).toFixed(1)} ${(p.y/100*H).toFixed(1)}`).join(' ')+' Z';
    svg += `<path d="${d}" fill="rgba(34,195,142,0.12)" stroke="rgba(34,195,142,0.65)" stroke-width="1.5"/>`;
    if (STATE.isAdmin) {
      const cx = poly.pts.reduce((s,p)=>s+p.x/100*W,0)/poly.pts.length;
      const cy = poly.pts.reduce((s,p)=>s+p.y/100*H,0)/poly.pts.length;
      svg += `<g style="pointer-events:all;cursor:pointer" onclick="window.removeFogPoly(${pi})">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="rgba(200,40,40,0.85)" stroke="#fff" stroke-width="1.5"/>
        <text x="${cx.toFixed(1)}" y="${(cy+4.5).toFixed(1)}" text-anchor="middle" font-size="12" fill="white" font-weight="bold">✕</text>
      </g>`;
    }
  });

  // Polygone en cours
  const pts = _fogDrawing.current, mouse = _fogDrawing.mousePos;
  if (_fogDrawing.active && pts.length) {
    const all = mouse ? [...pts, mouse] : pts;
    if (all.length >= 2) {
      const d = all.map((p,i) => `${i===0?'M':'L'}${(p.x/100*W).toFixed(1)} ${(p.y/100*H).toFixed(1)}`).join(' ');
      svg += `<path d="${d}" fill="rgba(232,184,75,0.10)" stroke="rgba(232,184,75,0.85)" stroke-width="1.5" stroke-dasharray="6 3"/>`;
      if (mouse && pts.length >= 2) {
        svg += `<line x1="${(mouse.x/100*W).toFixed(1)}" y1="${(mouse.y/100*H).toFixed(1)}" x2="${(pts[0].x/100*W).toFixed(1)}" y2="${(pts[0].y/100*H).toFixed(1)}" stroke="rgba(232,184,75,0.3)" stroke-width="1" stroke-dasharray="4 4"/>`;
      }
    }
    pts.forEach((p,i) => {
      svg += `<circle cx="${(p.x/100*W).toFixed(1)}" cy="${(p.y/100*H).toFixed(1)}" r="${i===0?7:4}" fill="${i===0?'rgba(232,184,75,0.9)':'rgba(255,255,255,0.85)'}" stroke="rgba(232,184,75,0.8)" stroke-width="1.5"/>`;
    });
    if (mouse) svg += `<circle cx="${(mouse.x/100*W).toFixed(1)}" cy="${(mouse.y/100*H).toFixed(1)}" r="3" fill="rgba(232,184,75,0.6)" stroke="none"/>`;
  }
  ol.innerHTML = svg;
}

// ── Mode dessin fog ───────────────────────────────────────────────────────────
function startFogDrawMode() {
  _fogDrawing.active = true; _fogDrawing.current = []; _fogDrawing.mousePos = null;
  const root = document.getElementById('map-root');
  const transform = document.getElementById('map-transform');
  if (!root || !transform) return;
  transform.style.cursor = 'crosshair';

  const hint = document.getElementById('map-placing-hint');
  if (hint) { hint.style.display='block'; hint.textContent='Clic : ajouter un point · Double-clic ou Entrée : fermer · Suppr : annuler dernier · Échap : quitter'; }

  function pct(e) {
    const r = transform.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX-r.left)/mapState.scale/(r.width/mapState.scale))*100)),
      y: Math.min(100, Math.max(0, ((e.clientY-r.top) /mapState.scale/(r.height/mapState.scale))*100)),
    };
  }

  window._fogMM = (e) => { if (!_fogDrawing.active) return; _fogDrawing.mousePos = pct(e); _renderFogOverlay(); };
  window._fogCL = (e) => {
    if (!_fogDrawing.active) return;
    e.stopPropagation();
    _fogDrawing.current.push(pct(e));
    _renderFogOverlay();
  };
  window._fogDC = (e) => {
    if (!_fogDrawing.active) return;
    e.stopPropagation(); e.preventDefault();
    if (_fogDrawing.current.length > 0) _fogDrawing.current.pop(); // enlever le point du 2e clic
    if (_fogDrawing.current.length >= 3) _fogCommit([..._fogDrawing.current]);
    _fogDrawing.current = [];
    _renderFogOverlay();
  };
  window._fogKD = (e) => {
    if (e.key==='Escape') stopFogDrawMode();
    else if ((e.key==='Backspace'||e.key==='Delete') && _fogDrawing.current.length>0) { _fogDrawing.current.pop(); _renderFogOverlay(); }
    else if (e.key==='Enter' && _fogDrawing.current.length>=3) { _fogCommit([..._fogDrawing.current]); _fogDrawing.current=[]; _renderFogOverlay(); }
  };

  root.addEventListener('mousemove', window._fogMM);
  root.addEventListener('click',    window._fogCL, { capture:true });
  root.addEventListener('dblclick', window._fogDC, { capture:true });
  window.addEventListener('keydown', window._fogKD);
}

function stopFogDrawMode() {
  _fogDrawing.active=false; _fogDrawing.current=[]; _fogDrawing.mousePos=null;
  const root = document.getElementById('map-root');
  root?.removeEventListener('mousemove', window._fogMM);
  root?.removeEventListener('click',    window._fogCL, { capture:true });
  root?.removeEventListener('dblclick', window._fogDC, { capture:true });
  window.removeEventListener('keydown', window._fogKD);
  document.getElementById('map-transform').style.cursor = 'grab';
  const hint = document.getElementById('map-placing-hint');
  if (hint) hint.style.display = 'none';
  const btn = document.getElementById('btn-fog-toggle');
  if (btn) { btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; btn.textContent='🌫️ Dessiner le fog'; }
  document.getElementById('fog-control-bar')?.remove();
  _renderFogOverlay();
}

// Aperçu joueur : simule le fog tel que vu par un joueur
let _fogPreviewActive = false;
window._toggleFogPreview = () => {
  _fogPreviewActive = !_fogPreviewActive;
  const btn = document.getElementById('btn-fog-preview');
  if (btn) {
    btn.style.background  = _fogPreviewActive ? 'rgba(34,195,142,.2)' : '';
    btn.style.borderColor = _fogPreviewActive ? 'rgba(34,195,142,.5)' : '';
    btn.style.color       = _fogPreviewActive ? '#22c38e' : '';
    btn.textContent       = _fogPreviewActive ? '👁️ Mode MJ' : '👁️ Aperçu joueur';
  }
  const canvas = document.getElementById('map-fog');
  const img    = document.getElementById('map-img');
  if (!canvas || !img) return;
  const W = img.naturalWidth || img.offsetWidth;
  const H = img.naturalHeight || img.offsetHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  if (_fogPreviewActive) {
    // Simuler le fog joueur
    const polys = mapState.fogZones || [];
    ctx.fillStyle = 'rgba(8,12,20,0.96)';
    ctx.fillRect(0, 0, W, H);
    if (polys.length) {
      ctx.globalCompositeOperation = 'destination-out';
      polys.forEach(poly => {
        if (!poly.pts?.length) return;
        ctx.beginPath();
        poly.pts.forEach((p, i) => {
          i === 0 ? ctx.moveTo((p.x/100)*W, (p.y/100)*H) : ctx.lineTo((p.x/100)*W, (p.y/100)*H);
        });
        ctx.closePath(); ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }
  } else {
    _renderFogOverlay();
  }
};

async function _fogCommit(pts) {
  if (!mapState.fogZones) mapState.fogZones = [];
  mapState.fogZones.push({ pts });
  await saveDoc('world','map_fog',{ zones: mapState.fogZones });
  renderFog();
  showNotif('Zone révélée ajoutée ✓','success');
}

window.removeFogPoly = async (i) => {
  mapState.fogZones.splice(i, 1);
  await saveDoc('world','map_fog',{ zones: mapState.fogZones });
  renderFog();
  showNotif('Zone supprimée.','success');
};

window.clearFog = async () => {
  if (!confirm('Effacer toutes les zones révélées ?')) return;
  mapState.fogZones = [];
  await saveDoc('world','map_fog',{ zones:[] });
  renderFog();
  showNotif('Brouillard effacé.','success');
};

window.saveFog = async () => {
  await saveDoc('world','map_fog',{ zones: mapState.fogZones||[] });
  renderFog();
};

// ── Sidebar lieu ──────────────────────────────────────────────────────────────
function openSidebar(lieu) {
  mapState.selectedLieu = lieu;
  const sidebar = document.getElementById('map-sidebar');
  const type    = LIEU_TYPES.find(t => t.id === lieu.type) || LIEU_TYPES[0];

  sidebar.innerHTML = `
    <div style="padding:1.2rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem">
        <div>
          <div style="font-size:0.7rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">
            ${type.emoji} ${type.label}${lieu.hidden ? ' · <span style="color:#ff6b6b">Masqué</span>' : ''}
          </div>
          <h2 style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--gold);line-height:1.2;margin:0">${lieu.nom}</h2>
        </div>
        <button onclick="window.closeMapSidebar()" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:1.2rem;padding:0;line-height:1;flex-shrink:0">×</button>
      </div>
    </div>

    <div style="padding:1.2rem;flex:1">
      ${lieu.image ? `<img src="${lieu.image}" style="width:100%;border-radius:8px;margin-bottom:1rem;object-fit:cover;max-height:140px">` : ''}

      ${lieu.description
        ? `<p style="font-size:0.83rem;color:var(--text-muted);line-height:1.7;margin-bottom:1rem;font-style:italic">${lieu.description}</p>`
        : `<p style="font-size:0.8rem;color:var(--text-dim);font-style:italic">Aucune description.</p>`}

      ${lieu.pnj?.length ? `
        <div style="margin-bottom:1rem">
          <div style="font-size:0.72rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">PNJ présents</div>
          ${lieu.pnj.map(p => `<div style="font-size:0.82rem;color:var(--text-muted);padding:3px 0">👤 ${p}</div>`).join('')}
        </div>` : ''}

      ${lieu.tags?.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:1rem">
          ${lieu.tags.map(t => `<span style="font-size:0.7rem;background:rgba(79,140,255,0.1);color:var(--gold);border:1px solid rgba(79,140,255,0.2);border-radius:999px;padding:2px 8px">${t}</span>`).join('')}
        </div>` : ''}

      ${lieu.notes && STATE.isAdmin ? `
        <div style="background:rgba(226,185,111,0.05);border:1px solid rgba(226,185,111,0.15);border-radius:8px;padding:0.75rem;margin-bottom:1rem">
          <div style="font-size:0.68rem;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Notes MJ</div>
          <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.6">${lieu.notes}</div>
        </div>` : ''}
    </div>

    ${STATE.isAdmin ? `
    <div style="padding:1rem;border-top:1px solid var(--border);display:flex;gap:0.5rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="window.openEditLieuModalById('${lieu.id}')">✏️ Modifier</button>
      <button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:rgba(255,107,107,0.3)" onclick="window.deleteLieu('${lieu.id}')">🗑️</button>
    </div>` : ''}
  `;

  sidebar.style.transform = 'translateX(0)';
}

window.closeMapSidebar = () => {
  const sidebar = document.getElementById('map-sidebar');
  if (sidebar) sidebar.style.transform = 'translateX(100%)';
  mapState.selectedLieu = null;
};

// ── Admin : contrôles ─────────────────────────────────────────────────────────
function setupAdminControls() {
  document.getElementById('btn-place-marker')?.addEventListener('click', () => {
    mapState.placingMode = !mapState.placingMode;
    const btn  = document.getElementById('btn-place-marker');
    const hint = document.getElementById('map-placing-hint');
    btn.style.background  = mapState.placingMode ? 'rgba(79,140,255,0.15)' : '';
    btn.style.borderColor = mapState.placingMode ? 'var(--border-bright)' : '';
    btn.style.color       = mapState.placingMode ? 'var(--gold)' : '';
    hint.style.display    = mapState.placingMode ? 'block' : 'none';
    document.getElementById('map-transform').style.cursor = mapState.placingMode ? 'crosshair' : 'grab';
  });

  document.getElementById('btn-fog-toggle')?.addEventListener('click', () => {
    if (_fogDrawing.active) {
      stopFogDrawMode();
    } else {
      const btn = document.getElementById('btn-fog-toggle');
      if (btn) {
        btn.style.background  = 'rgba(79,140,255,0.15)';
        btn.style.borderColor = 'var(--border-bright)';
        btn.style.color       = 'var(--gold)';
        btn.textContent       = '🌫️ Stop dessin';
      }
      // Boutons de contrôle fog
      let fogBar = document.getElementById('fog-control-bar');
      if (!fogBar) {
        fogBar = document.createElement('div');
        fogBar.id = 'fog-control-bar';
        fogBar.style.cssText = 'position:absolute;bottom:4.5rem;left:50%;transform:translateX(-50%);z-index:11;display:flex;gap:.4rem;';
        fogBar.innerHTML = `
          <button class="btn btn-outline btn-sm" onclick="window.clearFog()"
            style="font-size:.73rem;color:#ff6b6b;border-color:rgba(255,107,107,0.4)">🗑️ Effacer tout le fog</button>
          <button class="btn btn-outline btn-sm" id="btn-fog-preview"
            style="font-size:.73rem" onclick="window._toggleFogPreview()">👁️ Aperçu joueur</button>
        `;
        document.getElementById('map-root')?.appendChild(fogBar);
      }
      fogBar.style.display = 'flex';
      startFogDrawMode();
    }
  });
  document.getElementById('btn-map-settings')?.addEventListener('click', openMapSettingsModal);
}

// ── Admin : placer un lieu ────────────────────────────────────────────────────
function openPlaceLieuModal(x, y) {
  mapState.placingMode = false;
  document.getElementById('btn-place-marker').style.background = '';
  document.getElementById('btn-place-marker').style.borderColor = '';
  document.getElementById('btn-place-marker').style.color = '';
  document.getElementById('map-placing-hint').style.display = 'none';
  document.getElementById('map-transform').style.cursor = 'grab';

  openModal('📍 Nouveau lieu', `
    <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:.75rem;
      background:rgba(79,140,255,.06);border:1px solid rgba(79,140,255,.2);
      border-radius:8px;padding:.5rem .75rem">
      📍 Position fixée par le clic — X: ${x.toFixed(1)}% · Y: ${y.toFixed(1)}%
    </div>
    <input type="hidden" id="lieu-x" value="${x}">
    <input type="hidden" id="lieu-y" value="${y}">
    <div class="form-group"><label>Nom du lieu</label><input class="input-field" id="lieu-nom" placeholder="ex: Cap d'Espérance" autofocus></div>
    <div class="form-group">
      <label>Type</label>
      <select class="input-field" id="lieu-type">
        ${LIEU_TYPES.map(t => `<option value="${t.id}">${t.emoji} ${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Description <span style="color:var(--text-dim);font-weight:400">(visible joueurs)</span></label>
      <textarea class="input-field" id="lieu-desc" rows="3" placeholder="Un port animé sur la côte..."></textarea>
    </div>
    <div class="form-group"><label>PNJ présents <span style="color:var(--text-dim);font-weight:400">(un par ligne)</span></label>
      <textarea class="input-field" id="lieu-pnj" rows="2"></textarea>
    </div>
    <div class="form-group"><label>Tags <span style="color:var(--text-dim);font-weight:400">(séparés par des virgules)</span></label>
      <input class="input-field" id="lieu-tags" placeholder="commerce, port, quête">
    </div>
    <div class="form-group"><label>Notes MJ <span style="color:var(--text-dim);font-weight:400">(privées)</span></label>
      <textarea class="input-field" id="lieu-notes" rows="2"></textarea>
    </div>
    <div class="form-group"><label>URL image <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
      <input class="input-field" id="lieu-image" placeholder="https://...">
    </div>
    <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;
      font-size:.84rem;color:var(--text-muted);margin-bottom:1rem;
      padding:.6rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);border-radius:8px">
      <input type="checkbox" id="lieu-hidden" style="accent-color:#ff6b6b">
      <span>🙈 Masqué aux joueurs <span style="color:var(--text-dim);font-size:.75rem">(le lieu existe mais n'est pas visible)</span></span>
    </label>
    <button class="btn btn-gold" style="width:100%" onclick="window.saveLieu()">Créer le lieu</button>
  `);
  setTimeout(() => document.getElementById('lieu-nom')?.focus(), 60);
}

window.saveLieu = async function(id = null) {
  const nom   = document.getElementById('lieu-nom')?.value?.trim();
  if (!nom) { showNotif('Le nom est requis.', 'error'); return; }

  const pnjRaw  = document.getElementById('lieu-pnj')?.value  || '';
  const tagsRaw = document.getElementById('lieu-tags')?.value || '';
  const payload = {
    nom,
    type:        document.getElementById('lieu-type')?.value   || 'ville',
    description: document.getElementById('lieu-desc')?.value   || '',
    pnj:         pnjRaw.split('\n').map(p => p.trim()).filter(Boolean),
    tags:        tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
    notes:       document.getElementById('lieu-notes')?.value  || '',
    image:       document.getElementById('lieu-image')?.value  || '',
    hidden:      document.getElementById('lieu-hidden')?.checked || false,
    x:           parseFloat(document.getElementById('lieu-x')?.value) || 50,
    y:           parseFloat(document.getElementById('lieu-y')?.value) || 50,
  };

  if (id) {
    // Mise à jour
    await saveDoc('map_lieux', id, payload);
    mapState.lieux = mapState.lieux.map(l => l.id === id ? { id, ...payload } : l);
    showNotif('Lieu mis à jour.', 'success');
  } else {
    // Nouveau
    const newId  = `lieu_${Date.now()}`;
    await saveDoc('map_lieux', newId, payload);
    mapState.lieux.push({ id: newId, ...payload });
    showNotif(`${nom} ajouté à la carte.`, 'success');
  }

  closeModal();
  renderMarkers();
  if (mapState.selectedLieu?.id === id) openSidebar({ id, ...payload });
};

// ── Admin : éditer un lieu ────────────────────────────────────────────────────
function openEditLieuModal(lieu) {
  openModal(`✏️ Modifier — ${lieu.nom}`, `
    <div class="form-group"><label>Nom</label><input class="input-field" id="lieu-nom" value="${lieu.nom || ''}"></div>
    <div class="form-group">
      <label>Type</label>
      <select class="input-field" id="lieu-type">
        ${LIEU_TYPES.map(t => `<option value="${t.id}" ${t.id === lieu.type ? 'selected' : ''}>${t.emoji} ${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Description <span style="color:var(--text-dim);font-weight:400">(visible joueurs)</span></label>
      <textarea class="input-field" id="lieu-desc" rows="3">${lieu.description || ''}</textarea>
    </div>
    <div class="form-group"><label>PNJ présents <span style="color:var(--text-dim);font-weight:400">(un par ligne)</span></label>
      <textarea class="input-field" id="lieu-pnj" rows="2">${(lieu.pnj || []).join('\n')}</textarea>
    </div>
    <div class="form-group"><label>Tags <span style="color:var(--text-dim);font-weight:400">(séparés par des virgules)</span></label>
      <input class="input-field" id="lieu-tags" value="${(lieu.tags || []).join(', ')}">
    </div>
    <div class="form-group"><label>Notes MJ <span style="color:var(--text-dim);font-weight:400">(privées)</span></label>
      <textarea class="input-field" id="lieu-notes" rows="2">${lieu.notes || ''}</textarea>
    </div>
    <div class="form-group"><label>URL image</label>
      <input class="input-field" id="lieu-image" value="${lieu.image || ''}">
    </div>
    <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;
      font-size:.84rem;color:var(--text-muted);margin-bottom:.75rem;
      padding:.6rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);border-radius:8px">
      <input type="checkbox" id="lieu-hidden" ${lieu.hidden ? 'checked' : ''} style="accent-color:#ff6b6b">
      <span>🙈 Masqué aux joueurs <span style="color:var(--text-dim);font-size:.75rem">(le lieu existe mais n'est pas visible)</span></span>
    </label>
    <div class="form-group">
      <label>Position <span style="color:var(--text-dim);font-weight:400">(% sur la carte)</span></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
        <div><label style="font-size:.72rem;color:var(--text-dim)">X</label>
          <input type="number" class="input-field" id="lieu-x" value="${lieu.x}" step="0.1" min="0" max="100"></div>
        <div><label style="font-size:.72rem;color:var(--text-dim)">Y</label>
          <input type="number" class="input-field" id="lieu-y" value="${lieu.y}" step="0.1" min="0" max="100"></div>
      </div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="window.saveLieu('${lieu.id}')">Enregistrer</button>
  `);
}

window.openEditLieuModalById = (id) => {
  const lieu = mapState.lieux.find(l => l.id === id);
  if (lieu) openEditLieuModal(lieu);
};

window.deleteLieu = async (id) => {
  if (!confirm('Supprimer ce lieu de la carte ?')) return;
  await deleteFromCol('map_lieux', id);
  mapState.lieux = mapState.lieux.filter(l => l.id !== id);
  window.closeMapSidebar();
  renderMarkers();
  showNotif('Lieu supprimé.', 'success');
};

// ── Admin : fog of war ────────────────────────────────────────────────────────


// ── Admin : paramètres carte (avec upload + crop) ────────────────────────────
let _mapCrop = {
  img:null, cropX:0,cropY:0,cropW:0,cropH:0,
  startX:0,startY:0, isDragging:false,isResizing:false,handle:null,
  natW:0,natH:0,dispScale:1, base64:null,
};
const _mc = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

async function openMapSettingsModal() {
  const doc = await getDocData('world', 'map');
  _mapCrop.base64 = null;

  openModal('⚙️ Paramètres de la carte', `
    <div class="form-group">
      <label>Nom de la région</label>
      <input class="input-field" id="map-region-name" value="${doc?.regionName || ''}" placeholder="La Région des Brumes">
    </div>

    <div class="form-group">
      <label>Image de la carte</label>
      <div id="map-drop-zone" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated);transition:border-color .15s">
        <div id="map-drop-preview">
          ${doc?.imageUrl
            ? `<img src="${doc.imageUrl}" style="max-height:80px;border-radius:8px;max-width:100%">`
            : `<div style="font-size:2rem;margin-bottom:4px">🗺️</div>`}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:4px">
          Glisser ou <span style="color:var(--gold)">cliquer pour choisir</span>
        </div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-top:2px">JPG · PNG · WebP — sera compressée automatiquement pour Firestore</div>
      </div>

      <!-- Crop zone -->
      <div id="map-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">
          Recadrez si nécessaire — ratio libre
        </div>
        <canvas id="map-crop-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" style="margin-top:.5rem;width:100%"
          onclick="window._mapConfirmCrop()">✂️ Confirmer et compresser</button>
        <div id="map-crop-ok" style="display:none;font-size:.75rem;text-align:center;margin-top:4px"></div>
      </div>
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="window.saveMapSettings()">
      Enregistrer
    </button>
  `);

  // ── Créer l'input file EN JS après le rendu du modal ──────────────────────
  // Raison : innerHTML ne connecte pas correctement les <input type="file">
  // au DOM dans certains contextes, les rendant non-cliquables (offsetParent null).
  const fileInput = document.createElement('input');
  fileInput.type   = 'file';
  fileInput.id     = 'map-file';
  fileInput.accept = 'image/*';
  fileInput.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none';
  document.body.appendChild(fileInput);

  const handleFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) { showNotif('Image trop lourde (max 20 Mo).', 'error'); return; }
    const r = new FileReader();
    r.onload = (e) => _initMapCrop(e.target.result);
    r.readAsDataURL(file);
  };

  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  window._mapFile = handleFile;

  // Clic sur la drop zone → déclenche l'input file natif
  const dropZone = document.getElementById('map-drop-zone');
  dropZone?.addEventListener('click', () => fileInput.click());
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--gold)'; });
  dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border-strong)'; });
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-strong)';
    handleFile(e.dataTransfer.files[0]);
  });

  // Nettoyer l'input quand le modal se ferme
  const observer = new MutationObserver(() => {
    if (!document.getElementById('map-drop-zone')) {
      fileInput.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function _initMapCrop(dataUrl) {
  const wrap   = document.getElementById('map-crop-wrap');
  const canvas = document.getElementById('map-crop-canvas');
  const prev   = document.getElementById('map-drop-preview');
  if (!wrap || !canvas) return;
  _mapCrop.base64 = null;
  document.getElementById('map-crop-ok').style.display = 'none';
  wrap.style.display = 'block';

  const img = new Image();
  img.onload = () => {
    _mapCrop.img = img; _mapCrop.natW = img.naturalWidth; _mapCrop.natH = img.naturalHeight;
    // Limiter l'affichage à 420px de large max
    const maxW = Math.min(420, img.naturalWidth);
    _mapCrop.dispScale = maxW / img.naturalWidth;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width  = maxW + 'px';
    canvas.style.height = Math.round(img.naturalHeight * _mapCrop.dispScale) + 'px';

    // Sélection initiale = image entière (ratio libre pour la carte)
    _mapCrop.cropX = 0; _mapCrop.cropY = 0;
    _mapCrop.cropW = img.naturalWidth; _mapCrop.cropH = img.naturalHeight;

    _drawMapCrop(); _bindMapCrop(canvas);
    if (prev) prev.innerHTML = `<img src="${dataUrl}" style="max-height:60px;border-radius:6px;opacity:.6">
      <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px">Recadrez ci-dessous</div>`;
  };
  img.src = dataUrl;
}

function _mapHandles() {
  const {cropX:x,cropY:y,cropW:w,cropH:h} = _mapCrop;
  return [{id:'nw',x,y},{id:'n',x:x+w/2,y},{id:'ne',x:x+w,y},
          {id:'w',x,y:y+h/2},{id:'e',x:x+w,y:y+h/2},
          {id:'sw',x,y:y+h},{id:'s',x:x+w/2,y:y+h},{id:'se',x:x+w,y:y+h}];
}
function _mapHitH(nx,ny){
  const tol=9/_mapCrop.dispScale;
  return _mapHandles().find(h=>Math.abs(h.x-nx)<tol&&Math.abs(h.y-ny)<tol)||null;
}
function _drawMapCrop() {
  const canvas=document.getElementById('map-crop-canvas'); if(!canvas||!_mapCrop.img) return;
  const ctx=canvas.getContext('2d'),{img,natW,natH,cropX,cropY,cropW,cropH}=_mapCrop;
  ctx.clearRect(0,0,natW,natH); ctx.drawImage(img,0,0,natW,natH);
  ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,natW,natH);
  ctx.drawImage(img,cropX,cropY,cropW,cropH,cropX,cropY,cropW,cropH);
  ctx.strokeStyle='#4f8cff'; ctx.lineWidth=2; ctx.strokeRect(cropX,cropY,cropW,cropH);
  // Tiers
  ctx.strokeStyle='rgba(79,140,255,.25)'; ctx.lineWidth=1;
  for(let i=1;i<=2;i++){
    ctx.beginPath();ctx.moveTo(cropX+cropW*i/3,cropY);ctx.lineTo(cropX+cropW*i/3,cropY+cropH);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cropX,cropY+cropH*i/3);ctx.lineTo(cropX+cropW,cropY+cropH*i/3);ctx.stroke();
  }
  // Poignées
  ctx.fillStyle='#4f8cff'; ctx.strokeStyle='#0b1118'; ctx.lineWidth=1.5;
  _mapHandles().forEach(h=>{ctx.fillRect(h.x-6,h.y-6,12,12);ctx.strokeRect(h.x-6,h.y-6,12,12);});
  ctx.fillStyle='rgba(79,140,255,.9)'; ctx.font='12px monospace';
  ctx.fillText(`${cropW} × ${cropH}`,cropX+6,cropY+18);
}
function _mapToN(canvas,cx,cy){
  const r=canvas.getBoundingClientRect();
  return{x:(cx-r.left)/_mapCrop.dispScale, y:(cy-r.top)/_mapCrop.dispScale};
}
function _bindMapCrop(canvas) {
  const MIN=40;
  const onStart=(cx,cy)=>{
    const{x,y}=_mapToN(canvas,cx,cy), h=_mapHitH(x,y);
    if(h){_mapCrop.isResizing=true;_mapCrop.handle=h.id;}
    else{const{cropX,cropY,cropW,cropH}=_mapCrop;
      if(x>=cropX&&x<=cropX+cropW&&y>=cropY&&y<=cropY+cropH)
        {_mapCrop.isDragging=true;_mapCrop.startX=x-cropX;_mapCrop.startY=y-cropY;}}
  };
  const onMove=(cx,cy)=>{
    if(!_mapCrop.isDragging&&!_mapCrop.isResizing) return;
    const{x,y}=_mapToN(canvas,cx,cy),{natW:W,natH:H}=_mapCrop;
    if(_mapCrop.isDragging){
      _mapCrop.cropX=Math.round(_mc(x-_mapCrop.startX,0,W-_mapCrop.cropW));
      _mapCrop.cropY=Math.round(_mc(y-_mapCrop.startY,0,H-_mapCrop.cropH));
      _drawMapCrop(); return;
    }
    // Redimensionnement libre (pas de ratio forcé pour la carte)
    let{cropX,cropY,cropW,cropH,handle}=_mapCrop;
    const a={x:cropX,y:cropY,x2:cropX+cropW,y2:cropY+cropH};
    if(handle==='se'){cropW=_mc(x-a.x,MIN,W-a.x);cropH=_mc(y-a.y,MIN,H-a.y);}
    else if(handle==='sw'){cropW=_mc(a.x2-x,MIN,a.x2);cropH=_mc(y-a.y,MIN,H-a.y);cropX=a.x2-cropW;}
    else if(handle==='ne'){cropW=_mc(x-a.x,MIN,W-a.x);cropH=_mc(a.y2-y,MIN,a.y2);cropY=a.y2-cropH;}
    else if(handle==='nw'){cropW=_mc(a.x2-x,MIN,a.x2);cropH=_mc(a.y2-y,MIN,a.y2);cropX=a.x2-cropW;cropY=a.y2-cropH;}
    else if(handle==='e'){cropW=_mc(x-a.x,MIN,W-a.x);}
    else if(handle==='w'){cropW=_mc(a.x2-x,MIN,a.x2);cropX=a.x2-cropW;}
    else if(handle==='s'){cropH=_mc(y-a.y,MIN,H-a.y);}
    else if(handle==='n'){cropH=_mc(a.y2-y,MIN,a.y2);cropY=a.y2-cropH;}
    _mapCrop.cropX=Math.round(_mc(cropX,0,W-MIN));_mapCrop.cropY=Math.round(_mc(cropY,0,H-MIN));
    _mapCrop.cropW=Math.round(_mc(cropW,MIN,W-_mapCrop.cropX));_mapCrop.cropH=Math.round(_mc(cropH,MIN,H-_mapCrop.cropY));
    _drawMapCrop();
  };
  const onEnd=()=>{_mapCrop.isDragging=false;_mapCrop.isResizing=false;_mapCrop.handle=null;};
  const CM={nw:'nw-resize',ne:'ne-resize',sw:'sw-resize',se:'se-resize',n:'n-resize',s:'s-resize',e:'e-resize',w:'w-resize'};
  canvas.addEventListener('mousemove',e=>{
    if(_mapCrop.isDragging||_mapCrop.isResizing) return;
    const{x,y}=_mapToN(canvas,e.clientX,e.clientY),h=_mapHitH(x,y);
    if(h){canvas.style.cursor=CM[h.id];return;}
    const{cropX,cropY,cropW,cropH}=_mapCrop;
    canvas.style.cursor=(x>=cropX&&x<=cropX+cropW&&y>=cropY&&y<=cropY+cropH)?'move':'crosshair';
  });
  canvas.addEventListener('mousedown',e=>{e.preventDefault();onStart(e.clientX,e.clientY);});
  window.addEventListener('mousemove',e=>onMove(e.clientX,e.clientY));
  window.addEventListener('mouseup',onEnd);
  canvas.addEventListener('touchstart',e=>{e.preventDefault();onStart(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();onMove(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  canvas.addEventListener('touchend',onEnd);
}

// ── Compression pour Firestore (limite ~1 048 487 bytes par champ) ────────────
// base64 = ~1.37× la taille binaire → on cible 700 KB base64 max
function _compressMapForFirestore(img, sx, sy, sw, sh) {
  const TARGET = 700_000;
  const MAX_W  = 1800;

  const scale = sw > MAX_W ? MAX_W / sw : 1;
  const outW  = Math.round(sw * scale);
  const outH  = Math.round(sh * scale);

  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  // Essayer qualité décroissante
  for (const q of [0.80, 0.70, 0.60, 0.50]) {
    const b64 = out.toDataURL('image/jpeg', q);
    if (b64.length <= TARGET) return b64;
  }

  // Réduire les dimensions si encore trop grand
  const out2 = document.createElement('canvas');
  out2.width  = Math.round(outW * 0.6);
  out2.height = Math.round(outH * 0.6);
  out2.getContext('2d').drawImage(out, 0, 0, out2.width, out2.height);
  return out2.toDataURL('image/jpeg', 0.72);
}

window._mapConfirmCrop = () => {
  const { img, cropX, cropY, cropW, cropH } = _mapCrop;
  if (!img) return;

  const statusEl = document.getElementById('map-crop-ok');
  if (statusEl) {
    statusEl.style.display  = 'block';
    statusEl.textContent    = '⏳ Compression…';
    statusEl.style.color    = 'var(--text-muted)';
  }

  setTimeout(() => {
    _mapCrop.base64 = _compressMapForFirestore(img, cropX, cropY, cropW, cropH);
    document.getElementById('map-crop-wrap').style.display = 'none';
    if (statusEl) {
      statusEl.textContent = `✓ Image prête (${Math.round(_mapCrop.base64.length / 1024)} KB)`;
      statusEl.style.color = 'var(--green)';
    }
    const p = document.getElementById('map-drop-preview');
    if (p) p.innerHTML = `<img src="${_mapCrop.base64}" style="max-height:80px;border-radius:8px">`;
  }, 0);
};

window.saveMapSettings = async () => {
  const regionName = document.getElementById('map-region-name')?.value?.trim() || '';

  let imageUrl = '';
  if (_mapCrop.base64) {
    imageUrl = _mapCrop.base64;
  } else {
    const existing = await getDocData('world', 'map');
    imageUrl = existing?.imageUrl || '';
  }

  // Vérification finale avant envoi Firestore
  if (imageUrl.length > 900_000) {
    showNotif('Image encore trop grande. Recadrez une zone plus petite.', 'error');
    return;
  }

  await saveDoc('world', 'map', { imageUrl, regionName });
  mapState.imageUrl = imageUrl;
  _mapCrop.base64 = null;
  closeModal();
  showNotif('Carte mise à jour !', 'success');
  await window.navigate?.('map');
};

// ── Export global ─────────────────────────────────────────────────────────────
Object.assign(window, {
  initMap,
  LIEU_TYPES,
  openMapSettingsModal,
});
