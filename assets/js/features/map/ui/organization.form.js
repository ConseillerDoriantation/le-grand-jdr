// ══════════════════════════════════════════════════════════════════════════════
// Formulaire de création / édition d'une organisation liée à un lieu.
// ══════════════════════════════════════════════════════════════════════════════

import { _esc } from '../../../shared/html.js';
import { state } from '../map.state.js';
import { openFormModal } from '../shared/form-modal.js';
import { slug } from '../shared/slug.js';

// Construit la liste de suggestions à partir des catégories déjà utilisées
// sur d'autres organisations en base (dédup insensible à la casse, triée).
// Une nouvelle catégorie saisie aujourd'hui devient une suggestion demain.
function buildCategorySuggestions() {
  const seen = new Map(); // key lowercase -> display original
  (state.organizations || []).forEach(o => {
    const c = (o.category || '').trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

const DISPOSITIONS = ['Amical', 'Neutre', 'Hostile'];

export function openOrganizationForm({ placeId, existing = null, placeName = '' } = {}) {
  if (!placeId && !existing?.placeId) {
    console.warn('[orga.form] placeId manquant');
    return Promise.resolve(null);
  }
  const isNew = !existing;
  const org = existing ? { ...existing } : {
    id: '',
    placeId,
    name: '',
    category: '',
    summary: '',
    description: '',
    imageUrl: '',
    visibility: 'revealed',
    meta: { leader: '', disposition: 'neutral' },
  };

  const title = isNew
    ? `🏛️ Nouvelle organisation${placeName ? ` — ${_esc(placeName)}` : ''}`
    : `✏️ Modifier — ${_esc(org.name)}`;

  const suggestions = buildCategorySuggestions();
  const catOpts = suggestions
    .map(c => `<option value="${_esc(c)}"></option>`)
    .join('');
  const dispOpts = DISPOSITIONS
    .map(d => `<option value="${d}" ${d === (org.meta.disposition || 'neutral') ? 'selected' : ''}>${d}</option>`)
    .join('');

  const bodyHtml = `
    <form id="map-org-form" class="map-form">
      <div class="form-group">
        <label>Nom</label>
        <input class="input-field" name="name" value="${_esc(org.name)}" required autofocus>
      </div>

      <div class="form-group">
        <label>Catégorie <span class="map-dim map-small">(libre — tape pour ajouter)</span></label>
        <input class="input-field" name="category" list="map-org-categories"
               value="${_esc(org.category)}" placeholder="Marchand, Guilde, Taverne…" autocomplete="off">
        <datalist id="map-org-categories">${catOpts}</datalist>
      </div>

      <div class="form-group">
        <label>Résumé <span class="map-dim map-small">(une ligne)</span></label>
        <input class="input-field" name="summary" value="${_esc(org.summary)}">
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea class="input-field" name="description" rows="4">${_esc(org.description)}</textarea>
      </div>

      <div class="form-group">
        <label>Dirigeant</label>
        <input class="input-field" name="meta.leader" value="${_esc(org.meta?.leader || '')}">
      </div>

      <div class="form-group">
        <label>Disposition</label>
        <select class="input-field" name="meta.disposition">${dispOpts}</select>
      </div>

      <div class="form-group">
        <label>URL image <span class="map-dim map-small">(optionnel)</span></label>
        <input class="input-field" name="imageUrl" value="${_esc(org.imageUrl)}">
      </div>

      <div class="form-group">
        <label>Visibilité</label>
        <select class="input-field" name="visibility">
          <option value="hidden"   ${org.visibility === 'hidden'   ? 'selected' : ''}>Masqué</option>
          <option value="revealed" ${org.visibility === 'revealed' ? 'selected' : ''}>Révélé</option>
          <option value="public"   ${org.visibility === 'public'   ? 'selected' : ''}>Public</option>
        </select>
      </div>

      <div class="map-form__actions">
        <button type="button" class="btn btn-outline" data-role="cancel">Annuler</button>
        <button type="submit" class="btn btn-gold">${isNew ? 'Créer l\'organisation' : 'Enregistrer'}</button>
      </div>
    </form>
  `;

  return openFormModal({
    title,
    bodyHtml,
    formId: 'map-org-form',
    parse: (_flat, fd) => {
      // meta.* -> objet meta, le reste au niveau racine
      const flat = {};
      const meta = { ...org.meta };
      for (const [k, v] of fd.entries()) {
        if (k.startsWith('meta.')) meta[k.slice(5)] = v;
        else flat[k] = v;
      }
      if (!flat.name?.trim()) return null;
      const id = org.id || `${org.placeId}-${slug(flat.name, 'org')}`;
      return {
        ...org,
        id,
        name: flat.name.trim(),
        category: (flat.category || '').trim() || 'Autre',
        summary: flat.summary.trim(),
        description: flat.description.trim(),
        imageUrl: flat.imageUrl.trim(),
        visibility: flat.visibility,
        meta,
      };
    },
  });
}
