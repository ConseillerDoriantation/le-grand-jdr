// ══════════════════════════════════════════════════════════════════════════════
// Panneau latéral contextuel — affiche la fiche du lieu ou de l'organisation
// actuellement sélectionnée. Émet 'panel:action' pour les boutons.
// ══════════════════════════════════════════════════════════════════════════════

import { state, on, emit, getPlaceById, getOrgById, getOrgsOfPlace, getTypeMeta } from '../map.state.js';
import { _esc } from '../../../shared/html.js';
import { STATE } from '../../../core/state.js';

let panelEl = null;

export function bindSidepanel(el) {
  panelEl = el;
  on('selection:changed', render);
  on('places:changed', render);
  on('organizations:changed', render);

  panelEl.addEventListener('click', onClick);
  render();
}

function render() {
  if (!panelEl) return;
  const sel = state.selection;
  panelEl.classList.toggle('is-open', !!sel);
  if (!sel) {
    panelEl.innerHTML = emptyView();
    return;
  }
  if (sel.kind === 'place') {
    panelEl.innerHTML = placeView(getPlaceById(sel.id));
    return;
  }
  if (sel.kind === 'org') {
    panelEl.innerHTML = orgView(getOrgById(sel.id));
    return;
  }
}

function onClick(e) {
  const actionNode = e.target.closest('[data-action]');
  if (actionNode) {
    emit('panel:action', {
      action: actionNode.dataset.action,
      placeId: actionNode.dataset.placeId,
      orgId: actionNode.dataset.orgId,
    });
    return;
  }
  const orgItem = e.target.closest('[data-select-org]');
  if (orgItem) {
    state.selection = { kind: 'org', id: orgItem.dataset.selectOrg };
    emit('selection:changed');
  }
}

// ── Vues ──────────────────────────────────────────────────────────────────────

function emptyView() {
  const nbPlaces = state.places.length;
  const nbOrgs   = state.organizations.length;
  const nbPlaced = state.places.filter(p => p.marker).length;
  return `
    <div class="map-panel map-panel--empty">
      <h3>Carte du monde</h3>
      <p class="map-dim">${nbPlaces} lieu${nbPlaces > 1 ? 'x' : ''} · ${nbOrgs} organisation${nbOrgs > 1 ? 's' : ''}</p>
      <p class="map-dim map-small">${nbPlaced} placé${nbPlaced > 1 ? 's' : ''} sur la carte</p>
      <p class="map-dim map-small map-hint">Cliquez sur un marqueur pour en savoir plus.</p>
    </div>
  `;
}

function placeView(place) {
  if (!place) return emptyView();
  const type = getTypeMeta(place.type);
  const orgs = getOrgsOfPlace(place.id);
  const admin = STATE.isAdmin;
  const visLabel = {
    hidden:   `<span class="map-chip map-chip--danger">Masqué</span>`,
    revealed: `<span class="map-chip">Révélé</span>`,
    public:   `<span class="map-chip map-chip--gold">Public</span>`,
  }[place.visibility] || '';

  return `
    <div class="map-panel">
      <header class="map-panel__header" style="--accent:${type.color}">
        <div class="map-panel__icon">${type.icon}</div>
        <div class="map-panel__head-main">
          <div class="map-panel__kicker">${_esc(type.label)}${place.marker ? '' : ' · non placé'}</div>
          <h3>${_esc(place.name)}</h3>
          <div class="map-panel__chips">${visLabel}</div>
        </div>
        <button class="map-panel__close" data-action="close" title="Fermer">×</button>
      </header>

      ${place.imageUrl ? `<img class="map-panel__image" src="${_esc(place.imageUrl)}" alt="">` : ''}

      ${place.summary ? `<p class="map-panel__summary">${_esc(place.summary)}</p>` : ''}
      ${place.description ? `<div class="map-panel__desc">${_esc(place.description)}</div>` : ''}

      ${place.tags?.length ? `
        <div class="map-panel__tags">
          ${place.tags.map(t => `<span class="map-chip map-chip--outline">${_esc(t)}</span>`).join('')}
        </div>` : ''}

      <section class="map-panel__section">
        <div class="map-panel__section-head">
          <h4>Organisations <span class="map-dim">(${orgs.length})</span></h4>
          ${admin ? `<button class="map-btn map-btn--sm" data-action="new-org" data-place-id="${place.id}">+ Ajouter</button>` : ''}
        </div>
        ${orgs.length ? `
          <ul class="map-orgs">
            ${orgs.map(o => `
              <li class="map-orgs__item" data-select-org="${o.id}">
                <strong>${_esc(o.name)}</strong>
                <span class="map-dim map-small">${_esc(o.category)}</span>
                ${o.summary ? `<p class="map-small">${_esc(o.summary)}</p>` : ''}
              </li>`).join('')}
          </ul>`
        : `<p class="map-dim map-small">Aucune organisation pour l'instant.</p>`}
      </section>

      ${place.meta?.pnj?.length ? `
        <section class="map-panel__section">
          <h4>PNJ présents</h4>
          <ul class="map-plain">
            ${place.meta.pnj.map(p => `<li>👤 ${_esc(p)}</li>`).join('')}
          </ul>
        </section>` : ''}

      ${admin && place.meta?.notes ? `
        <section class="map-panel__section map-panel__notes">
          <h4>Notes MJ</h4>
          <p class="map-small">${_esc(place.meta.notes)}</p>
        </section>` : ''}

      ${admin ? `
      <footer class="map-panel__actions">
        <button class="map-btn map-btn--sm" data-action="edit-place" data-place-id="${place.id}">Éditer</button>
        <button class="map-btn map-btn--sm" data-action="reposition" data-place-id="${place.id}">${place.marker ? 'Repositionner' : 'Placer'}</button>
        <button class="map-btn map-btn--sm map-btn--danger" data-action="delete-place" data-place-id="${place.id}">Supprimer</button>
      </footer>` : ''}
    </div>
  `;
}

function orgView(org) {
  if (!org) return emptyView();
  const place = getPlaceById(org.placeId);
  const admin = STATE.isAdmin;
  return `
    <div class="map-panel">
      <nav class="map-panel__crumbs">
        <a href="#" data-action="back-to-place" data-place-id="${org.placeId}">← ${_esc(place?.name || 'Lieu')}</a>
      </nav>
      <header class="map-panel__header">
        <div class="map-panel__icon">🏛️</div>
        <div class="map-panel__head-main">
          <div class="map-panel__kicker">${_esc(org.category)}</div>
          <h3>${_esc(org.name)}</h3>
        </div>
        <button class="map-panel__close" data-action="close" title="Fermer">×</button>
      </header>

      ${org.imageUrl ? `<img class="map-panel__image" src="${_esc(org.imageUrl)}" alt="">` : ''}
      ${org.summary ? `<p class="map-panel__summary">${_esc(org.summary)}</p>` : ''}
      ${org.description ? `<div class="map-panel__desc">${_esc(org.description)}</div>` : ''}

      ${Object.keys(org.meta || {}).length ? `
        <section class="map-panel__section">
          <h4>Informations</h4>
          <dl class="map-meta">
            ${Object.entries(org.meta).map(([k, v]) =>
              `<dt>${_esc(metaLabel(k))}</dt><dd>${_esc(String(v))}</dd>`).join('')}
          </dl>
        </section>` : ''}

      ${admin ? `
      <footer class="map-panel__actions">
        <button class="map-btn map-btn--sm" data-action="edit-org" data-org-id="${org.id}">Éditer</button>
        <button class="map-btn map-btn--sm map-btn--danger" data-action="delete-org" data-org-id="${org.id}">Supprimer</button>
      </footer>` : ''}
    </div>
  `;
}

const META_LABELS = {
  leader: 'Dirigeant',
  disposition: 'Disposition',
  members: 'Membres',
  wealth: 'Richesse',
  schedule: 'Horaires',
};
function metaLabel(k) { return META_LABELS[k] || k; }
