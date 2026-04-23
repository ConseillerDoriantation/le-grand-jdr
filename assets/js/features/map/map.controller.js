// ══════════════════════════════════════════════════════════════════════════════
// MAP CONTROLLER — orchestrateur unique du module Carte.
// Seul fichier qui connaît à la fois les repos, le rendu et l'UI.
// Les autres modules ne communiquent que via map.state (pub/sub).
// ══════════════════════════════════════════════════════════════════════════════

import { state, emit, on, resetListeners, getPlaceById, getOrgById } from './map.state.js';

// Data
import { listPlaceTypes } from './data/types.repo.js';
import { listPlaces, savePlace, removePlace } from './data/places.repo.js';
import { listOrganizations, saveOrganization, removeOrganization } from './data/organizations.repo.js';
import { loadMap, loadFogZones } from './data/maps.repo.js';

// Rendu
import { bindViewport, applyTransform, zoom, resetView, screenToNorm, getImageSize } from './render/viewport.js';
import { bindMarkers, renderMarkers, updateMarkerScales } from './render/markers.js';
import { bindFog, renderFog, startFogDraw, stopFogDraw, clearFog, togglePlayerPreview, updateFogScales } from './render/fog.js';

// UI
import { bindSidepanel } from './ui/sidepanel.js';
import { openPlaceForm } from './ui/place.form.js';
import { openOrganizationForm } from './ui/organization.form.js';
import { openMapSettingsModal } from './ui/settings.js';

// Intégration projet
import { STATE } from '../../core/state.js';
import { showNotif } from '../../shared/notifications.js';
import { confirmModal } from '../../shared/modal.js';
import { _esc } from '../../shared/html.js';

let rootContainer = null;
let stylesInjected = false;

// ── Entrée publique ──────────────────────────────────────────────────────────

export async function initMap(containerEl) {
  rootContainer = containerEl;
  resetListeners();
  injectStyles();

  // 1. Charger les données en parallèle
  const [map, types, places, organizations, fogZones] = await Promise.all([
    loadMap(),
    listPlaceTypes(),
    listPlaces(),
    listOrganizations(),
    loadFogZones(),
  ]);

  state.map = map;
  state.types = types;
  state.places = places;
  state.organizations = organizations;
  state.fogZones = fogZones;
  state.selection = null;
  state.mode = 'navigate';
  state.modeContext = null;
  state.viewport = { scale: 0.14, offsetX: 25, offsetY: -250 };
  state.filters = { types: new Set(), onlyRevealed: false, query: '' };

  // 2. Monter le shell DOM
  containerEl.innerHTML = shellHTML();
  const root      = containerEl.querySelector('#map-root');
  const transform = containerEl.querySelector('#map-transform');
  const img       = containerEl.querySelector('#map-img');
  const svg       = containerEl.querySelector('#map-svg');
  const canvas    = containerEl.querySelector('#map-fog');
  const panel     = containerEl.querySelector('#map-sidepanel');

  // 3. Réactivité (AVANT les binds : bindViewport peut émettre 'viewport:ready'
  //    de façon synchrone si l'image est déjà en cache du navigateur).
  on('viewport:ready',     onViewportReady);
  on('viewport:changed',   onViewportChanged);
  on('places:changed',     () => { renderMarkers(); });
  on('organizations:changed', () => { renderMarkers(); });
  on('selection:changed',  () => { renderMarkers(); });
  on('filters:changed',    () => { renderMarkers(); });
  on('fog:mode',           onFogModeChanged);
  on('marker:click',       onMarkerClick);
  on('panel:action',       onPanelAction);

  // 4. Brancher les modules de rendu
  bindMarkers(svg);
  bindFog(canvas, root, transform);
  bindSidepanel(panel);
  bindViewport(root, transform, img);

  // 5. Événements UI (toolbar, carte, recherche, filtres)
  wireToolbar(containerEl);
  wireMapClick(root);
  wireSearch(containerEl);
  wireFilters(containerEl);

  applyTransform();
}

// ── Shell HTML ───────────────────────────────────────────────────────────────

function shellHTML() {
  const hasImage = !!state.map?.imageUrl;
  const isAdmin = STATE.isAdmin;
  const regionName = state.map?.regionName || 'Carte du monde';

  return `
    <div class="map-layout">

      <header class="map-topbar">
        <div class="map-topbar__title">
          <span class="map-topbar__region">${_esc(regionName)}</span>
        </div>
        <div class="map-topbar__search">
          <input type="search" id="map-search" placeholder="Rechercher un lieu, une organisation…" autocomplete="off">
        </div>
        <div class="map-topbar__filters" id="map-filters"></div>
      </header>

      <div class="map-workspace">
        <div id="map-root" class="map-root${hasImage ? ' is-loading' : ''}">
          <div class="map-loader" aria-hidden="true"><span class="map-loader__text">Chargement de la carte</span></div>
          <div id="map-transform" class="map-transform">
            ${hasImage
              ? `<img id="map-img" src="${_esc(state.map.imageUrl)}" draggable="false" alt="">`
              : `<div class="map-placeholder">
                   ${isAdmin
                     ? 'Aucune image. Ouvre ⚙️ Paramètres pour en ajouter une.'
                     : 'La carte sera dévoilée par le Maître de Jeu.'}
                 </div>`}
            <svg id="map-svg" xmlns="http://www.w3.org/2000/svg"></svg>
            <canvas id="map-fog"></canvas>
          </div>

          <div class="map-controls">
            <button data-toolbar="zoom-in" title="Zoom +">+</button>
            <button data-toolbar="zoom-out" title="Zoom −">−</button>
            <button data-toolbar="reset" title="Réinitialiser">⌂</button>
          </div>

          ${isAdmin ? `
          <div class="map-admin-bar">
            <button data-toolbar="new-place">📍 Nouveau lieu</button>
            <button data-toolbar="fog">🌫️ Fog</button>
            <button data-toolbar="player-preview">👁️ Vue joueur</button>
            <button data-toolbar="settings">⚙️ Paramètres</button>
          </div>
          <div class="map-mode-hint" id="map-mode-hint" hidden></div>
          ` : ''}
        </div>

        <aside id="map-sidepanel" class="map-sidepanel"></aside>
      </div>
    </div>
  `;
}

// ── Filtres & recherche ──────────────────────────────────────────────────────

function wireFilters(container) {
  const wrap = container.querySelector('#map-filters');
  if (!wrap) return;
  wrap.innerHTML = state.types
    .filter(t => state.places.some(p => p.type === t.id))
    .map(t => `<button class="map-chip map-chip--filter" data-filter-type="${t.id}" style="--chip:${t.color}">${t.icon} ${_esc(t.label)}</button>`)
    .join('');

  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter-type]');
    if (!btn) return;
    const id = btn.dataset.filterType;
    if (state.filters.types.has(id)) state.filters.types.delete(id);
    else state.filters.types.add(id);
    btn.classList.toggle('is-active', state.filters.types.has(id));
    emit('filters:changed');
  });
}

function wireSearch(container) {
  const input = container.querySelector('#map-search');
  if (!input) return;
  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.filters.query = input.value.trim();
      emit('filters:changed');
      // Si un seul résultat matche un lieu, on le sélectionne
      if (state.filters.query.length >= 2) {
        const q = state.filters.query.toLowerCase();
        const hit = state.places.find(p =>
          p.name.toLowerCase().includes(q) ||
          (p.tags || []).some(t => t.toLowerCase().includes(q)));
        if (hit) {
          state.selection = { kind: 'place', id: hit.id };
          emit('selection:changed');
        }
      }
    }, 150);
  });
}

// ── Toolbar (zoom, admin) ────────────────────────────────────────────────────

function wireToolbar(container) {
  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-toolbar]');
    if (!btn) return;
    const action = btn.dataset.toolbar;

    switch (action) {
      case 'zoom-in':  zoom(1.2); break;
      case 'zoom-out': zoom(0.83); break;
      case 'reset':    resetView(); break;
      case 'new-place': onNewPlace(); break;
      case 'fog':
        if (state.mode === 'fog') stopFogDraw();
        else startFogDraw();
        break;
      case 'player-preview': {
        const active = togglePlayerPreview();
        btn.classList.toggle('is-active', active);
        break;
      }
      case 'settings':
        openMapSettingsModal(async () => {
          state.map = await loadMap();
          // Re-monter le shell pour intégrer la nouvelle image
          initMap(rootContainer);
        });
        break;
    }
  });
}

// ── Clic sur la carte (placement / repositionnement) ────────────────────────

function wireMapClick(root) {
  root.addEventListener('click', async e => {
    if (state.mode !== 'placing' && state.mode !== 'repositioning') return;
    const { x, y } = screenToNorm(e.clientX, e.clientY);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    const placeId = state.modeContext?.placeId;
    const place = getPlaceById(placeId);
    if (!place) { exitPlacingMode(); return; }

    place.marker = { mapId: state.activeMapId, x, y, icon: null };
    await runAction('save marker', async () => {
      await savePlace(place);
      exitPlacingMode();
      emit('places:changed');
      showNotif(`${place.name} placé sur la carte.`, 'success');
    }, 'Erreur de sauvegarde de la position.');
  });
}

// ── Wrapper try/catch commun aux actions Firestore ───────────────────────────
// Renvoie true si fn() s'est exécutée sans erreur, false sinon (notif + log).
async function runAction(label, fn, errorMsg) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.error(`[map] ${label}`, e);
    showNotif(errorMsg, 'error');
    return false;
  }
}

// ── Hooks réactifs ───────────────────────────────────────────────────────────

function onViewportReady() {
  renderMarkers();
  renderFog();
  lastScale = state.viewport.scale;
  // Révéler la carte seulement après le premier rendu complet (image + fog).
  rootContainer?.querySelector('#map-root')?.classList.remove('is-loading');
}

// Pan seul : la transform CSS parent suffit → rien à refaire ici.
// Zoom : on ne reconstruit pas les SVG, on ne met à jour que le contre-zoom
// des marqueurs et des ✕ de fog. rAF-throttlé pour encaisser les salves de molette.
let rafPending = false;
let lastScale = null;
function onViewportChanged() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const cur = state.viewport?.scale;
    if (cur === lastScale) return;
    lastScale = cur;
    updateMarkerScales();
    updateFogScales();
  });
}

function onMarkerClick({ id }) {
  state.selection = { kind: 'place', id };
  emit('selection:changed');
}

function onFogModeChanged({ active }) {
  const hint = document.getElementById('map-mode-hint');
  if (hint) {
    hint.hidden = !active;
    hint.textContent = active
      ? 'Fog : clic = point · double-clic/Entrée = fermer · Suppr = annuler · Échap = quitter'
      : '';
  }
  const fogBtn = rootContainer?.querySelector('[data-toolbar="fog"]');
  fogBtn?.classList.toggle('is-active', active);
}

async function onPanelAction({ action, placeId, orgId }) {
  switch (action) {
    case 'close':
      state.selection = null;
      emit('selection:changed');
      break;

    case 'new-org': {
      const place = getPlaceById(placeId);
      if (!place) return;
      const created = await openOrganizationForm({ placeId, placeName: place.name });
      if (!created) return;
      await runAction('save org', async () => {
        await saveOrganization(created);
        state.organizations = await listOrganizations();
        emit('organizations:changed');
        showNotif('Organisation créée.', 'success');
      }, 'Erreur de création.');
      break;
    }

    case 'edit-place': {
      const place = getPlaceById(placeId);
      if (!place) return;
      const updated = await openPlaceForm(place);
      if (!updated) return;
      await runAction('save place', async () => {
        await savePlace(updated);
        state.places = await listPlaces();
        emit('places:changed');
        showNotif('Lieu mis à jour.', 'success');
      }, 'Erreur de sauvegarde.');
      break;
    }

    case 'reposition': {
      const place = getPlaceById(placeId);
      if (!place) return;
      state.mode = 'repositioning';
      state.modeContext = { placeId: place.id };
      showHint(`Cliquez sur la carte pour ${place.marker ? 'repositionner' : 'placer'} ${place.name}.`);
      break;
    }

    case 'delete-place': {
      const place = getPlaceById(placeId);
      if (!place) return;
      if (!await confirmModal(`Supprimer "${place.name}" ?`, { title: 'Supprimer un lieu' })) return;
      await runAction('delete place', async () => {
        await removePlace(place.id);
        state.places = state.places.filter(p => p.id !== place.id);
        state.selection = null;
        emit('places:changed');
        emit('selection:changed');
        showNotif('Lieu supprimé.', 'success');
      }, 'Erreur de suppression.');
      break;
    }

    case 'edit-org': {
      const org = getOrgById(orgId);
      if (!org) return;
      const updated = await openOrganizationForm({
        placeId: org.placeId,
        existing: org,
        placeName: getPlaceById(org.placeId)?.name || '',
      });
      if (!updated) return;
      await runAction('save org', async () => {
        await saveOrganization(updated);
        state.organizations = await listOrganizations();
        emit('organizations:changed');
        showNotif('Organisation mise à jour.', 'success');
      }, 'Erreur de sauvegarde.');
      break;
    }

    case 'delete-org': {
      const org = getOrgById(orgId);
      if (!org) return;
      if (!await confirmModal(`Supprimer "${org.name}" ?`, { title: 'Supprimer une organisation'})) return;
      await runAction('delete org', async () => {
        await removeOrganization(org.id);
        state.organizations = state.organizations.filter(o => o.id !== org.id);
        // Retour à la fiche du lieu parent
        state.selection = org.placeId ? { kind: 'place', id: org.placeId } : null;
        emit('organizations:changed');
        emit('selection:changed');
        showNotif('Organisation supprimée.', 'success');
      }, 'Erreur de suppression.');
      break;
    }

    case 'back-to-place':
      state.selection = placeId ? { kind: 'place', id: placeId } : null;
      emit('selection:changed');
      break;
  }
}

// ── Création d'un nouveau lieu ───────────────────────────────────────────────

async function onNewPlace() {
  const created = await openPlaceForm(null);
  if (!created) return;
  const ok = await runAction('create place', async () => {
    await savePlace(created);
    state.places = await listPlaces();
    emit('places:changed');
    showNotif(`${created.name} créé.`, 'success');
  }, 'Erreur de création.');
  if (!ok) return;

  if (await confirmModal(`Placer "${created.name}" sur la carte maintenant ?`, {
    confirmLabel: 'Placer',
    cancelLabel: 'Plus tard',
    danger: false,
    icon: '📍',
  })) {
    state.selection = { kind: 'place', id: created.id };
    state.mode = 'placing';
    state.modeContext = { placeId: created.id };
    showHint(`Cliquez sur la carte pour placer ${created.name}.`);
    emit('selection:changed');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function exitPlacingMode() {
  state.mode = 'navigate';
  state.modeContext = null;
  hideHint();
}

function showHint(text) {
  const hint = document.getElementById('map-mode-hint');
  if (!hint) return;
  hint.hidden = false;
  hint.textContent = text;
}
function hideHint() {
  const hint = document.getElementById('map-mode-hint');
  if (!hint) return;
  hint.hidden = true;
  hint.textContent = '';
}

// ── Styles (injectés une seule fois) ─────────────────────────────────────────

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'assets/js/features/map/map.css';
  document.head.appendChild(link);
}
