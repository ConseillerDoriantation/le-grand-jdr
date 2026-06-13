// ══════════════════════════════════════════════════════════════════════════════
// Panneau latéral contextuel — affiche la fiche du lieu ou de l'organisation
// actuellement sélectionnée. Émet 'panel:action' pour les boutons.
// ══════════════════════════════════════════════════════════════════════════════

import { state, on, emit, getPlaceById, getOrgById, getOrgsOfPlace, getNpcById, getNpcsOfPlace, getMissionsOfPlace, getTypeMeta } from '../map.state.js';
import { _esc, _norm } from '../../../shared/html.js';
import { STATE } from '../../../core/state.js';
import { setHistoireCtx } from '../../../shared/histoire-ctx.js';

let panelEl = null;

// ── État UI local (session) ───────────────────────────────────────────────────
// Sections explicitement repliées par l'utilisateur (clé = `${placeId}:${nom}`).
// Tout est déplié par défaut ; le clic sur le header inverse l'état.
const panelToggled = new Set();
// Requête de recherche dans le panneau, scopée par lieu.
const placeQuery = new Map();
// Au-delà de ce total d'items cherchables, on affiche la barre de recherche.
const PLACE_SEARCH_THRESHOLD = 5;

const isCollapsed = key => panelToggled.has(key);

export function bindSidepanel(el) {
  panelEl = el;
  on('selection:changed', render);
  on('places:changed', render);
  on('organizations:changed', render);

  panelEl.addEventListener('click', onClick);
  panelEl.addEventListener('input', onInput);
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
    applyPlaceFilter();
    return;
  }
  if (sel.kind === 'org') {
    panelEl.innerHTML = orgView(getOrgById(sel.id));
    return;
  }
  if (sel.kind === 'npc') {
    panelEl.innerHTML = npcView(getNpcById(sel.id), sel.placeId);
    return;
  }
}

// ── Recherche dans le panneau ────────────────────────────────────────────────
// Filtre appliqué en place (pas de re-render → focus de l'input préservé).
// Chaque item porte data-search-text (texte normalisé). Le compteur de chaque
// section bascule en "visibles/total" et les sections sans match affichent
// "Aucun résultat" via CSS (.is-empty-match).
function applyPlaceFilter() {
  const root = panelEl?.querySelector('[data-place-panel]');
  if (!root) return;
  const placeId = root.dataset.placePanel;
  const q = _norm(placeQuery.get(placeId) || '');
  const active = !!q;
  root.classList.toggle('is-searching', active);

  root.querySelectorAll('[data-search-section]').forEach(section => {
    const items = section.querySelectorAll('[data-search-text]');
    const total = items.length;
    let visible = 0;
    items.forEach(item => {
      const ok = !active || item.dataset.searchText.includes(q);
      item.hidden = !ok;
      if (ok) visible++;
    });
    const countEl = section.querySelector('.map-panel__count');
    if (countEl) countEl.textContent = active ? `${visible}/${total}` : String(total);
    section.classList.toggle('is-empty-match', active && total > 0 && visible === 0);
  });
}

function onInput(e) {
  const search = e.target.closest('[data-place-search]');
  if (!search) return;
  const placeId = search.dataset.placeSearch;
  if (search.value) placeQuery.set(placeId, search.value);
  else placeQuery.delete(placeId);
  applyPlaceFilter();
}

function onClick(e) {
  // Toggle d'une section : on bascule la classe en place pour ne pas perdre le
  // focus de l'input de recherche pendant la frappe.
  const toggleNode = e.target.closest('[data-toggle-section]');
  if (toggleNode) {
    const key = toggleNode.dataset.toggleSection;
    const wasCollapsed = panelToggled.has(key);
    if (wasCollapsed) panelToggled.delete(key);
    else panelToggled.add(key);
    const section = toggleNode.closest('.map-panel__section');
    if (section) section.classList.toggle('is-collapsed', !wasCollapsed);
    toggleNode.setAttribute('aria-expanded', String(wasCollapsed));
    return;
  }
  const actionNode = e.target.closest('[data-action]');
  if (actionNode) {
    emit('panel:action', {
      action: actionNode.dataset.action,
      placeId: actionNode.dataset.placeId,
      orgId: actionNode.dataset.orgId,
    });
    return;
  }
  const npcItem = e.target.closest('[data-open-npc]');
  if (npcItem) {
    const placeId = state.selection?.kind === 'place' ? state.selection.id : null;
    state.selection = { kind: 'npc', id: npcItem.dataset.openNpc, placeId };
    emit('selection:changed');
    return;
  }
  const missionItem = e.target.closest('[data-open-mission]');
  if (missionItem) {
    setHistoireCtx(
      missionItem.dataset.openMission,
      missionItem.dataset.missionTitre || 'Mission',
      missionItem.dataset.missionActe || '',
    );
    import('../../../core/navigation.js').then(m => m.navigate('histoire'));
    return;
  }
  const orgItem = e.target.closest('[data-select-org]');
  if (orgItem) {
    state.selection = { kind: 'org', id: orgItem.dataset.selectOrg };
    emit('selection:changed');
  }
}

// ── Helper sections ──────────────────────────────────────────────────────────
// Toutes les sections du panneau d'un lieu passent par ce helper : header
// cliquable (button) + corps dans un wrapper toggleable via CSS (sans re-render).
function renderSection({ key, title, count, body, extra = '', cls = '' }) {
  const collapsed = isCollapsed(key);
  return `
    <section class="map-panel__section${cls ? ' ' + cls : ''}${collapsed ? ' is-collapsed' : ''}" data-search-section>
      <header class="map-panel__section-head">
        <button type="button" class="map-panel__section-trigger"
                data-toggle-section="${key}" aria-expanded="${!collapsed}">
          <span class="map-panel__chev" aria-hidden="true">▾</span>
          <span class="map-panel__section-title">${_esc(title)}</span>
          <span class="map-panel__count">${count}</span>
        </button>
        ${extra}
      </header>
      <div class="map-panel__section-body">
        ${body}
      </div>
    </section>`;
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
  const npcs = getNpcsOfPlace(place);
  const admin = STATE.isAdmin;
  const missions = admin ? getMissionsOfPlace(place) : [];
  const visLabel = {
    hidden:   `<span class="map-chip map-chip--danger">Masqué</span>`,
    revealed: `<span class="map-chip">Révélé</span>`,
    public:   `<span class="map-chip map-chip--gold">Public</span>`,
  }[place.visibility] || '';

  const searchableCount = orgs.length + npcs.length + missions.length;
  const showSearch = searchableCount > PLACE_SEARCH_THRESHOLD;
  const query = placeQuery.get(place.id) || '';

  return `
    <div class="map-panel" data-place-panel="${place.id}">
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

      ${showSearch ? `
        <div class="map-panel__searchbar">
          <span class="map-panel__searchbar-icon" aria-hidden="true">🔎</span>
          <input type="search" data-place-search="${place.id}" value="${_esc(query)}"
                 placeholder="Rechercher (PNJ, organisation…)" autocomplete="off">
        </div>` : ''}

      ${orgsSection(place, orgs, admin)}
      ${npcsSection(place, npcs)}
      ${missionsSection(place, missions, admin)}

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

// ── Sections du panneau lieu ─────────────────────────────────────────────────

function orgsSection(place, orgs, admin) {
  const key = `${place.id}:orgs`;
  const body = orgs.length === 0
    ? `<p class="map-dim map-small">Aucune organisation pour l'instant.</p>`
    : `<ul class="map-orgs">
        ${orgs.map(o => `
          <li class="map-orgs__item" data-select-org="${o.id}"
              data-search-text="${_esc(_norm(`${o.name || ''} ${o.category || ''} ${o.summary || ''}`))}">
            <strong>${_esc(o.name)}</strong>
            <span class="map-dim map-small">${_esc(o.category)}</span>
            ${o.summary ? `<p class="map-small">${_esc(o.summary)}</p>` : ''}
          </li>`).join('')}
        <li class="map-panel__empty-match">Aucun résultat.</li>
      </ul>`;
  const extra = admin
    ? `<button class="map-btn map-btn--sm" data-action="new-org" data-place-id="${place.id}">+ Ajouter</button>`
    : '';
  return renderSection({ key, title: 'Organisations', count: orgs.length, body, extra });
}

// Section "PNJ présents". Priorité aux vrais PNJ (collection npcs) ; repli sur
// l'ancien place.meta.pnj (chaînes legacy) pour ne rien perdre.
function npcsSection(place, npcs) {
  const legacy = place.meta?.pnj || [];
  const total = npcs.length || legacy.length;
  if (!total) return '';
  const key = `${place.id}:npcs`;
  const body = npcs.length
    ? `<ul class="map-orgs">
        ${npcs.map(n => `
          <li class="map-orgs__item" data-open-npc="${n.id}"
              data-search-text="${_esc(_norm(`${n.nom || ''} ${n.role || ''} ${n.lieu || ''}`))}">
            <strong>👤 ${_esc(n.nom || 'PNJ')}</strong>
            ${n.role ? `<span class="map-dim map-small">${_esc(n.role)}</span>` : ''}
          </li>`).join('')}
        <li class="map-panel__empty-match">Aucun résultat.</li>
      </ul>`
    : `<ul class="map-plain">
        ${legacy.map(p => `<li data-search-text="${_esc(_norm(p))}">👤 ${_esc(p)}</li>`).join('')}
        <li class="map-panel__empty-match">Aucun résultat.</li>
      </ul>`;
  return renderSection({ key, title: 'PNJ présents', count: total, body });
}

// Section "Missions ici" (MJ uniquement — le contenu des missions est privé).
function missionsSection(place, missions, admin) {
  if (!admin || !missions.length) return '';
  const key = `${place.id}:missions`;
  const body = `
    <ul class="map-orgs">
      ${missions.map(m => `
        <li class="map-orgs__item" data-open-mission="${_esc(m.id)}"
            data-mission-titre="${_esc(m.titre)}" data-mission-acte="${_esc(m.acte)}"
            data-search-text="${_esc(_norm(`${m.titre || ''} ${m.acte || ''}`))}">
          <strong>📖 ${_esc(m.titre)}</strong>
          ${m.acte ? `<span class="map-dim map-small">${_esc(m.acte)}</span>` : ''}
        </li>`).join('')}
      <li class="map-panel__empty-match">Aucun résultat.</li>
    </ul>`;
  return renderSection({ key, title: 'Missions ici', count: missions.length, body, cls: 'map-panel__notes' });
}

// ── PNJ (fiche détaillée) ────────────────────────────────────────────────────

// Fiche PNJ contextuelle (lecture seule). La gestion des PNJ reste sur la
// page Personnages/PNJ ; ici on affiche un résumé sans coupler npcs.js.
function npcView(npc, placeId) {
  if (!npc) return emptyView();
  const place = getPlaceById(placeId);
  const orgs = Array.isArray(npc.organisations) ? npc.organisations.filter(Boolean) : [];
  return `
    <div class="map-panel">
      ${place ? `
      <nav class="map-panel__crumbs">
        <a href="#" data-action="back-to-place" data-place-id="${place.id}">← ${_esc(place.name)}</a>
      </nav>` : ''}
      <header class="map-panel__header">
        <div class="map-panel__icon"${npc.imageUrl ? ' style="overflow:hidden;padding:0"' : ''}>
          ${npc.imageUrl
            ? `<img src="${_esc(npc.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:top">`
            : '👤'}
        </div>
        <div class="map-panel__head-main">
          ${npc.role ? `<div class="map-panel__kicker">${_esc(npc.role)}</div>` : ''}
          <h3>${_esc(npc.nom || 'PNJ')}</h3>
        </div>
        <button class="map-panel__close" data-action="close" title="Fermer">×</button>
      </header>

      ${npc.lieu ? `<p class="map-panel__summary">📍 ${_esc(npc.lieu)}</p>` : ''}
      ${npc.description ? `<div class="map-panel__desc">${_esc(npc.description)}</div>` : ''}

      ${orgs.length ? `
        <section class="map-panel__section">
          <h4>Organisations</h4>
          <div class="map-panel__tags">
            ${orgs.map(o => `<span class="map-chip map-chip--outline">🏛️ ${_esc(o)}</span>`).join('')}
          </div>
        </section>` : ''}
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
