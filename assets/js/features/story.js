import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

export function openStoryModal(item) {
  openModal(item ? '✏️ Modifier' : '📚 Nouvel Événement / Mission', `
    <div class="form-group"><label>Type</label>
      <select class="input-field" id="st-type">
        <option value="event" ${item?.type === 'event' ? 'selected' : ''}>Événement</option>
        <option value="combat" ${item?.type === 'combat' ? 'selected' : ''}>Combat</option>
        <option value="mission" ${item?.type === 'mission' ? 'selected' : ''}>Mission</option>
      </select>
    </div>
    <div class="form-group"><label>Titre</label><input class="input-field" id="st-titre" value="${item?.titre || ''}"></div>
    <div class="form-group"><label>Date / Session</label><input class="input-field" id="st-date" value="${item?.date || ''}" placeholder="Session 1, Jour 3..."></div>
    <div class="form-group"><label>Acte</label><input class="input-field" id="st-acte" value="${item?.acte || ''}" placeholder="Acte I : Les Débuts"></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="st-desc" rows="4">${item?.description || ''}</textarea></div>
    <div id="st-mission-extra" style="${item?.type === 'mission' ? '' : 'display:none'}">
      <div class="form-group"><label>Statut</label>
        <select class="input-field" id="st-statut">
          ${['En cours', 'Terminée', 'Échouée', 'En attente'].map((s) => `<option ${s === (item?.statut || 'En cours') ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Récompense</label><input class="input-field" id="st-recompense" value="${item?.recompense || ''}"></div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveStory('${item?.id || ''}')">Enregistrer</button>
  `);

  const typeSelect = document.getElementById('st-type');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      const extra = document.getElementById('st-mission-extra');
      if (extra) extra.style.display = e.target.value === 'mission' ? '' : 'none';
    });
  }
}

export async function saveStory(id) {
  const type = document.getElementById('st-type')?.value || 'event';
  const data = {
    type,
    date: document.getElementById('st-date')?.value || '',
    acte: document.getElementById('st-acte')?.value || '',
    titre: document.getElementById('st-titre')?.value || '?',
    description: document.getElementById('st-desc')?.value || '',
    statut: document.getElementById('st-statut')?.value || 'En cours',
    recompense: document.getElementById('st-recompense')?.value || '',
  };
  if (id) await updateInCol('story', id, data);
  else await addToCol('story', data);
  closeModal();
  showNotif('Événement enregistré !', 'success');
  window.navigate?.('story');
}

export async function editStory(id) {
  const items = await loadCollection('story');
  const item = items.find((i) => i.id === id);
  if (item) openStoryModal(item);
}

export async function deleteStory(id) {
  if (!confirm('Supprimer cet élément ?')) return;
  await deleteFromCol('story', id);
  showNotif('Supprimé.', 'success');
  window.navigate?.('story');
}

Object.assign(window, { openStoryModal, saveStory, editStory, deleteStory });
