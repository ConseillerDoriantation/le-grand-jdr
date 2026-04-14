// ══════════════════════════════════════════════════════════════════════════════
// Rendu SVG des marqueurs de lieux + gestion des clics.
// Émet 'marker:click' quand un marqueur est cliqué.
// ══════════════════════════════════════════════════════════════════════════════

import { state, emit, getTypeMeta, getOrgsOfPlace } from '../map.state.js';
import { getImageSize } from './viewport.js';
import { STATE } from '../../../core/state.js';

let svgEl = null;

export function bindMarkers(svg) {
  svgEl = svg;
}

export function renderMarkers() {
  if (!svgEl) return;
  const { w, h } = getImageSize();
  svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svgEl.setAttribute('width', w);
  svgEl.setAttribute('height', h);

  const visible = state.places.filter(isVisible);
  svgEl.innerHTML = visible.map(placeToSvg).join('');

  // Wiring des clics (délégation ciblée par groupe)
  svgEl.querySelectorAll('[data-place-id]').forEach(node => {
    node.addEventListener('click', ev => {
      ev.stopPropagation();
      emit('marker:click', { id: node.dataset.placeId });
    });
  });
}

function isVisible(place) {
  if (!place.marker) return false;
  // MJ : on voit tout sauf si le filtre "vue joueur" est actif
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

  const r = selected ? 13 : 10;
  const ringR = r + 6;
  const strokeW = hasOrgs ? 2.4 : 1.6;
  const color = hidden ? '#555' : type.color;
  const opacity = hidden ? 0.55 : 1;

  return `
    <g data-place-id="${place.id}" style="cursor:pointer;pointer-events:all" opacity="${opacity}">
      ${selected ? `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="${color}" opacity="0.22"/>` : ''}
      <circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="${color}" opacity="0.18"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#0b1118" stroke-width="${strokeW}"/>
      ${hasOrgs ? `<circle cx="${cx + r - 1}" cy="${cy - r + 1}" r="3.2" fill="#e8b84b" stroke="#0b1118" stroke-width="1"/>` : ''}
      <text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central"
            font-size="${r}" style="pointer-events:none;user-select:none">${type.icon}</text>
      <text x="${cx}" y="${cy + r + 14}" text-anchor="middle"
            font-family="'Cinzel',serif" font-size="11" fill="${color}"
            stroke="#0b1118" stroke-width="3" paint-order="stroke"
            style="pointer-events:none;user-select:none">${escapeXml(place.name)}</text>
    </g>
  `;
}

function escapeXml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => (
    { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]
  ));
}
