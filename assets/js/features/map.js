// ══════════════════════════════════════════════════════════════════════════════
// MAP.JS — Carte interactive
// Markers cliquables · Zoom/pan · Fog of war · Interface admin
// ══════════════════════════════════════════════════════════════════════════════
import { getDocData, saveDoc, loadCollection, saveToCollection, deleteFromCollection } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';

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
  mapState.fogZones = fogDoc?.zones || [];

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
        <canvas id="map-fog" style="position:absolute;top:0;left:0;pointer-events:none;opacity:0.82"></canvas>
      </div>

      <!-- Contrôles zoom -->
      <div style="position:absolute;bottom:1rem;right:1rem;display:flex;flex-direction:column;gap:6px;z-index:10">
        <button class="btn btn-outline" id="map-zoom-in"  style="width:36px;height:36px;padding:0;font-size:1.1rem;display:flex;align-items:center;justify-content:center">+</button>
        <button class="btn btn-outline" id="map-zoom-out" style="width:36px;height:36px;padding:0;font-size:1.1rem;display:flex;align-items:center;justify-content:center">−</button>
        <button class="btn btn-outline" id="map-reset"    style="width:36px;height:36px;padding:0;font-size:0.75rem;display:flex;align-items:center;justify-content:center" title="Réinitialiser la vue">⌂</button>
      </div>

      <!-- Barre admin -->
      ${STATE.isAdmin ? `
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
          🌫️ Brouillard
        </button>
        <button class="btn btn-outline btn-sm" id="btn-map-settings" style="border-radius:999px;font-size:0.75rem">
          ⚙️ Paramètres
        </button>
      </div>
      <div id="map-placing-hint" style="
        display:none;position:absolute;bottom:4rem;left:50%;transform:translateX(-50%);
        background:rgba(79,140,255,0.15);border:1px solid var(--border-bright);
        border-radius:999px;padding:0.4rem 1rem;font-size:0.8rem;color:var(--gold);
        z-index:10;pointer-events:none;
      ">Cliquez sur la carte pour placer le lieu</div>
      ` : ''}

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
    const rect = document.getElementById('map-transform').getBoundingClientRect();
    const x    = ((e.clientX - rect.left) / mapState.scale / rect.width  * 100);
    const y    = ((e.clientY - rect.top)  / mapState.scale / rect.height * 100);
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

// ── Fog of war ────────────────────────────────────────────────────────────────
function renderFog() {
  const canvas = document.getElementById('map-fog');
  const img    = document.getElementById('map-img');
  if (!canvas || !img || !mapState.fogZones.length) return;

  const doFog = () => {
    const w = img.naturalWidth  || img.offsetWidth;
    const h = img.naturalHeight || img.offsetHeight;
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Fond sombre
    ctx.fillStyle = 'rgba(8,12,20,0.88)';
    ctx.fillRect(0, 0, w, h);

    // Découper les zones révélées
    ctx.globalCompositeOperation = 'destination-out';
    mapState.fogZones.forEach(zone => {
      const cx = (zone.x / 100) * w;
      const cy = (zone.y / 100) * h;
      const r  = (zone.r / 100) * Math.max(w, h);
      const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalCompositeOperation = 'source-over';
  };

  if (img.complete && img.naturalWidth) doFog();
  else img.addEventListener('load', doFog);
}

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

  document.getElementById('btn-fog-toggle')?.addEventListener('click', openFogModal);
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
    <div class="form-group"><label>Nom du lieu</label><input class="input-field" id="lieu-nom" placeholder="ex: Cap d'Espérance"></div>
    <div class="form-group">
      <label>Type</label>
      <select class="input-field" id="lieu-type">
        ${LIEU_TYPES.map(t => `<option value="${t.id}">${t.emoji} ${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Description (visible par les joueurs)</label><textarea class="input-field" id="lieu-desc" rows="4" placeholder="Un port animé sur la côte..."></textarea></div>
    <div class="form-group"><label>PNJ présents (un par ligne)</label><textarea class="input-field" id="lieu-pnj" rows="3"></textarea></div>
    <div class="form-group"><label>Tags (séparés par des virgules)</label><input class="input-field" id="lieu-tags" placeholder="commerce, port, quest"></div>
    <div class="form-group"><label>Notes MJ (privées)</label><textarea class="input-field" id="lieu-notes" rows="3"></textarea></div>
    <div class="form-group"><label>URL image (optionnel)</label><input class="input-field" id="lieu-image" placeholder="https://..."></div>
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem;color:var(--text-muted)">
        <input type="checkbox" id="lieu-hidden">
        Masqué aux joueurs (fog of war)
      </label>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
      <div class="form-group"><label>Position X (%)</label><input type="number" class="input-field" id="lieu-x" value="${x}" step="0.1"></div>
      <div class="form-group"><label>Position Y (%)</label><input type="number" class="input-field" id="lieu-y" value="${y}" step="0.1"></div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="window.saveLieu()">Créer le lieu</button>
  `);
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
    await saveToCollection('map_lieux', { id, ...payload });
    mapState.lieux = mapState.lieux.map(l => l.id === id ? { id, ...payload } : l);
    showNotif('Lieu mis à jour.', 'success');
  } else {
    // Nouveau
    const newId  = `lieu_${Date.now()}`;
    await saveToCollection('map_lieux', { id: newId, ...payload });
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
    <div class="form-group"><label>Description</label><textarea class="input-field" id="lieu-desc" rows="4">${lieu.description || ''}</textarea></div>
    <div class="form-group"><label>PNJ présents (un par ligne)</label><textarea class="input-field" id="lieu-pnj" rows="3">${(lieu.pnj || []).join('\n')}</textarea></div>
    <div class="form-group"><label>Tags (séparés par des virgules)</label><input class="input-field" id="lieu-tags" value="${(lieu.tags || []).join(', ')}"></div>
    <div class="form-group"><label>Notes MJ (privées)</label><textarea class="input-field" id="lieu-notes" rows="3">${lieu.notes || ''}</textarea></div>
    <div class="form-group"><label>URL image</label><input class="input-field" id="lieu-image" value="${lieu.image || ''}"></div>
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem;color:var(--text-muted)">
        <input type="checkbox" id="lieu-hidden" ${lieu.hidden ? 'checked' : ''}>
        Masqué aux joueurs
      </label>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
      <div class="form-group"><label>Position X (%)</label><input type="number" class="input-field" id="lieu-x" value="${lieu.x}" step="0.1"></div>
      <div class="form-group"><label>Position Y (%)</label><input type="number" class="input-field" id="lieu-y" value="${lieu.y}" step="0.1"></div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="window.saveLieu('${lieu.id}')">Enregistrer</button>
  `);
}

window.openEditLieuModalById = (id) => {
  const lieu = mapState.lieux.find(l => l.id === id);
  if (lieu) openEditLieuModal(lieu);
};

window.deleteLieu = async (id) => {
  if (!confirm('Supprimer ce lieu de la carte ?')) return;
  await deleteFromCollection('map_lieux', id);
  mapState.lieux = mapState.lieux.filter(l => l.id !== id);
  window.closeMapSidebar();
  renderMarkers();
  showNotif('Lieu supprimé.', 'success');
};

// ── Admin : fog of war ────────────────────────────────────────────────────────
function openFogModal() {
  openModal('🌫️ Brouillard de guerre', `
    <p style="font-size:0.83rem;color:var(--text-muted);margin-bottom:1rem;line-height:1.6">
      Ajoutez des zones révélées en précisant leur centre (%) et leur rayon (% de la carte).
      Les zones se superposent — plus le rayon est grand, plus la zone découverte est large.
    </p>
    <div id="fog-zones-list" style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem">
      ${mapState.fogZones.map((z, i) => `
        <div style="display:flex;gap:0.5rem;align-items:center;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.5rem 0.75rem">
          <span style="font-size:0.8rem;color:var(--text-muted);flex:1">Zone ${i + 1} — X:${z.x}% Y:${z.y}% R:${z.r}%</span>
          <button class="btn-icon" onclick="window.removeFogZone(${i})">🗑️</button>
        </div>`).join('') || '<p style="font-size:0.8rem;color:var(--text-dim);font-style:italic;text-align:center">Aucune zone révélée — toute la carte est dans le brouillard.</p>'}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:0.75rem">
      <div class="form-group"><label>X centre (%)</label><input type="number" class="input-field" id="fog-x" value="50" min="0" max="100"></div>
      <div class="form-group"><label>Y centre (%)</label><input type="number" class="input-field" id="fog-y" value="50" min="0" max="100"></div>
      <div class="form-group"><label>Rayon (%)</label><input type="number" class="input-field" id="fog-r" value="20" min="1" max="100"></div>
    </div>
    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-outline" style="flex:1" onclick="window.addFogZone()">+ Ajouter zone</button>
      <button class="btn btn-gold" style="flex:1" onclick="window.saveFog()">Enregistrer</button>
    </div>
    <div style="margin-top:0.75rem">
      <button class="btn btn-outline" style="width:100%;color:#ff6b6b;border-color:rgba(255,107,107,0.3)" onclick="window.clearFog()">
        Supprimer tout le brouillard
      </button>
    </div>
  `);
}

window.addFogZone = () => {
  const x = parseFloat(document.getElementById('fog-x')?.value) || 50;
  const y = parseFloat(document.getElementById('fog-y')?.value) || 50;
  const r = parseFloat(document.getElementById('fog-r')?.value) || 20;
  mapState.fogZones.push({ x, y, r });
  openFogModal();
};

window.removeFogZone = (i) => {
  mapState.fogZones.splice(i, 1);
  openFogModal();
};

window.saveFog = async () => {
  await saveDoc('world', 'map_fog', { zones: mapState.fogZones });
  closeModal();
  renderFog();
  showNotif('Brouillard mis à jour.', 'success');
};

window.clearFog = async () => {
  mapState.fogZones = [];
  await saveDoc('world', 'map_fog', { zones: [] });
  closeModal();
  renderFog();
  showNotif('Brouillard supprimé.', 'success');
};

// ── Admin : paramètres carte ──────────────────────────────────────────────────
async function openMapSettingsModal() {
  const doc = await getDocData('world', 'map');
  openModal('⚙️ Paramètres de la carte', `
    <div class="form-group">
      <label>URL de l'image de la carte</label>
      <input class="input-field" id="map-url-input" value="${doc?.imageUrl || ''}" placeholder="https://...">
      <div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px">Hébergez l'image sur Imgur, Cloudinary, ou un autre hébergeur public.</div>
    </div>
    <div class="form-group">
      <label>Nom de la région</label>
      <input class="input-field" id="map-region-name" value="${doc?.regionName || ''}" placeholder="La Région des Brumes">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="window.saveMapSettings()">Enregistrer</button>
  `);
}

window.saveMapSettings = async () => {
  const imageUrl   = document.getElementById('map-url-input')?.value?.trim()    || '';
  const regionName = document.getElementById('map-region-name')?.value?.trim() || '';
  await saveDoc('world', 'map', { imageUrl, regionName });
  mapState.imageUrl = imageUrl;
  closeModal();
  showNotif('Carte mise à jour.', 'success');
  // Recharger la carte dans la page
  await window.navigate?.('map');
};

// ── Export global ─────────────────────────────────────────────────────────────
Object.assign(window, { initMap, LIEU_TYPES });
