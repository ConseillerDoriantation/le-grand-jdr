// ══════════════════════════════════════════════════════════════════════════════
// Rendu SVG des marqueurs de lieux + gestion des clics.
// Émet 'marker:click' quand un marqueur est cliqué.
//
// Structure d'un marqueur :
//   <g data-place-id="X" transform="translate(cx,cy)">
//     <g data-scale transform="scale(s)">… visuels à taille fixe …</g>
//   </g>
//
// Ce découplage permet de contre-zoomer sans reconstruire le DOM :
// updateMarkerScales() ne fait que réécrire l'attribut transform des
// <g data-scale>, au lieu de régénérer tout l'innerHTML à chaque zoom.
// ══════════════════════════════════════════════════════════════════════════════

import { state, emit, getTypeMeta, getOrgsOfPlace, getMarkerScale } from '../map.state.js';
import { getImageSize } from './viewport.js';
import { STATE } from '../../../core/state.js';
import { _esc } from '../../../shared/html.js';

let svgEl = null;

export function bindMarkers(svg) {
  svgEl = svg;
  // Délégation : un seul listener pour tous les marqueurs, attaché une fois.
  svg.addEventListener('click', ev => {
    const g = ev.target.closest('[data-place-id]');
    if (!g) return;
    ev.stopPropagation();
    emit('marker:click', { id: g.dataset.placeId });
  });
}

// Full rebuild — places / selection / filtres / organisations.
export function renderMarkers() {
  if (!svgEl) return;
  const { w, h } = getImageSize();
  svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svgEl.setAttribute('width', w);
  svgEl.setAttribute('height', h);

  const visible = state.places.filter(isVisible);
  svgEl.innerHTML = visible.map(placeToSvg).join('');
}

// Cheap update — ne change que le facteur de contre-zoom des marqueurs.
// Appelé sur 'viewport:changed' quand la scale a effectivement changé.
export function updateMarkerScales() {
  if (!svgEl) return;
  const s = getMarkerScale();
  const t = `scale(${s})`;
  svgEl.querySelectorAll('[data-scale]').forEach(g => g.setAttribute('transform', t));
}

function isVisible(place) {
  if (!place.marker) return false;
  const isAdmin = STATE.isAdmin;
  if (!isAdmin && place.visibility === 'hidden') return false;
  if (isAdmin && state.filters.onlyRevealed && place.visibility === 'hidden') return false;

  if (state.filters.types.size && !state.filters.types.has(place.type)) return false;

  const q = (state.filters.query || '').trim().toLowerCase();
  if (q) {
    const hay = `${place.name} ${place.summary} ${(place.tags || []).join(' ')}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function placeToSvg(place) {
  const { w, h } = getImageSize();
  const cx = place.marker.x * w;
  const cy = place.marker.y * h;
  const type = getTypeMeta(place.type);
  const orgs = getOrgsOfPlace(place.id);
  const hasOrgs = orgs.length > 0;
  const selected = state.selection?.kind === 'place' && state.selection.id === place.id;
  const hidden = place.visibility === 'hidden';

  // Tailles fixes en coords locales — le contre-zoom est fait par <g data-scale>.
  const r = selected ? 18 : 14;
  const ringR = r + 7;
  const haloR = r + 5;
  const strokeW = hasOrgs ? 2.8 : 1.8;
  const color = hidden ? '#555' : type.color;
  const opacity = hidden ? 0.55 : 1;
  const s = getMarkerScale();

  return `
    <g data-place-id="${place.id}" transform="translate(${cx},${cy})" style="cursor:pointer;pointer-events:all" opacity="${opacity}">
      <g data-scale transform="scale(${s})">
        ${selected ? `<circle r="${ringR}" fill="${color}" opacity="0.22"/>` : ''}
        <circle r="${haloR}" fill="${color}" opacity="0.18"/>
        <circle r="${r}" fill="${color}" stroke="#0b1118" stroke-width="${strokeW}"/>
        ${hasOrgs ? `<circle cx="${r - 1.5}" cy="${-r + 1.5}" r="4.5" fill="#e8b84b" stroke="#0b1118" stroke-width="1.2"/>` : ''}
        <text y="1" text-anchor="middle" dominant-baseline="central"
              font-size="${r}" style="pointer-events:none;user-select:none">${type.icon}</text>
        <text y="${r + 17}" text-anchor="middle"
              font-family="'Cinzel',serif" font-size="14" fill="${color}"
              stroke="#0b1118" stroke-width="3.5" paint-order="stroke"
              style="pointer-events:none;user-select:none">${_esc(place.name)}</text>
      </g>
    </g>
  `;
}
