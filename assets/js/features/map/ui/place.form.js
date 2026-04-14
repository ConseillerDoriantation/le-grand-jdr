// ══════════════════════════════════════════════════════════════════════════════
// Formulaire de création / édition d'un lieu.
// Utilise openModal(title, html) existant puis branche les boutons après coup.
// Retourne une Promise<place|null>.
// ══════════════════════════════════════════════════════════════════════════════

import { openModal, closeModalDirect } from '../../../shared/modal.js';
import { state } from '../map.state.js';
import { _esc } from '../../../shared/html.js';

export function openPlaceForm(existing = null) {
  return new Promise(resolve => {
    const isNew = !existing;
    const place = existing ? { ...existing } : {
      id: '',
      name: '',
      type: 'ville',
      summary: '',
      description: '',
      imageUrl: '',
      tags: [],
      visibility: 'hidden',
      meta: {},
      marker: null,
    };

    const typesOpts = state.types
      .map(t => `<option value="${t.id}" ${t.id === place.type ? 'selected' : ''}>${t.icon} ${_esc(t.label)}</option>`)
      .join('');

    const title = isNew ? '📍 Nouveau lieu' : `✏️ Modifier — ${_esc(place.name)}`;

    openModal(title, `
      <form id="map-place-form" class="map-form">
        ${isNew ? `
          <div class="form-group">
            <label>Identifiant <span class="map-dim map-small">(auto si vide — ex: valdoran)</span></label>
            <input class="input-field" name="id" value="${_esc(place.id)}">
          </div>` : ''}

        <div class="form-group">
          <label>Nom du lieu</label>
          <input class="input-field" name="name" value="${_esc(place.name)}" required autofocus>
        </div>

        <div class="form-group">
          <label>Type</label>
          <select class="input-field" name="type">${typesOpts}</select>
        </div>

        <div class="form-group">
          <label>Résumé <span class="map-dim map-small">(une ligne, visible en tooltip)</span></label>
          <input class="input-field" name="summary" value="${_esc(place.summary)}" placeholder="Cité portuaire...">
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea class="input-field" name="description" rows="4">${_esc(place.description)}</textarea>
        </div>

        <div class="form-group">
          <label>Tags <span class="map-dim map-small">(séparés par virgules)</span></label>
          <input class="input-field" name="tags" value="${_esc((place.tags || []).join(', '))}" placeholder="commerce, port, quête">
        </div>

        <div class="form-group">
          <label>URL image <span class="map-dim map-small">(optionnel)</span></label>
          <input class="input-field" name="imageUrl" value="${_esc(place.imageUrl)}" placeholder="https://...">
        </div>

        <div class="form-group">
          <label>Visibilité</label>
          <select class="input-field" name="visibility">
            <option value="hidden"   ${place.visibility === 'hidden'   ? 'selected' : ''}>Masqué (MJ uniquement)</option>
            <option value="revealed" ${place.visibility === 'revealed' ? 'selected' : ''}>Révélé aux joueurs</option>
            <option value="public"   ${place.visibility === 'public'   ? 'selected' : ''}>Public</option>
          </select>
        </div>

        <div class="form-group">
          <label>Notes MJ <span class="map-dim map-small">(privées)</span></label>
          <textarea class="input-field" name="notes" rows="2">${_esc(place.meta?.notes || '')}</textarea>
        </div>

        <div class="map-form__actions">
          <button type="button" class="btn btn-outline" data-role="cancel">Annuler</button>
          <button type="submit" class="btn btn-gold">${isNew ? 'Créer le lieu' : 'Enregistrer'}</button>
        </div>
      </form>
    `);

    const form = document.getElementById('map-place-form');
    if (!form) return resolve(null);

    const close = result => { closeModalDirect(); resolve(result); };

    form.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.name?.trim()) return;
      const id = isNew ? (data.id?.trim() || slug(data.name)) : place.id;
      const merged = {
        ...place,
        id,
        name: data.name.trim(),
        type: data.type,
        summary: data.summary.trim(),
        description: data.description.trim(),
        imageUrl: data.imageUrl.trim(),
        tags: data.tags.split(',').map(s => s.trim()).filter(Boolean),
        visibility: data.visibility,
        meta: { ...place.meta, notes: data.notes.trim() },
      };
      close(merged);
    });
  });
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `lieu-${Date.now()}`;
}
