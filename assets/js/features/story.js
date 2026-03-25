import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function openStoryModal(item = null) {
  openModal(item ? '✏️ Modifier un élément' : '📚 Nouvel événement / mission', `
    <div class="form-group"><label>Type</label>
      <select class="input-field" id="st-type">
        <option value="event" ${item?.type === 'event' ? 'selected' : ''}>Événement</option>
        <option value="combat" ${item?.type === 'combat' ? 'selected' : ''}>Combat</option>
        <option value="mission" ${item?.type === 'mission' ? 'selected' : ''}>Mission</option>
      </select>
    </div>
    <div class="form-group"><label>Titre</label><input class="input-field" id="st-titre" value="${item?.titre || ''}"></div>
    <div class="form-group"><label>Date / session</label><input class="input-field" id="st-date" value="${item?.date || ''}"></div>
    <div class="form-group"><label>Acte</label><input class="input-field" id="st-acte" value="${item?.acte || ''}"></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="st-desc" rows="5">${item?.description || ''}</textarea></div>
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

  const typeEl = document.getElementById('st-type');
  const missionBox = document.getElementById('st-mission-extra');
  typeEl?.addEventListener('change', (e) => {
    if (missionBox) missionBox.style.display = e.target.value === 'mission' ? '' : 'none';
  });
}

async function saveStory(id = '') {
  const data = {
    type: document.getElementById('st-type')?.value || 'event',
    titre: document.getElementById('st-titre')?.value?.trim() || 'Événement',
    date: document.getElementById('st-date')?.value?.trim() || '',
    acte: document.getElementById('st-acte')?.value?.trim() || '',
    description: document.getElementById('st-desc')?.value || '',
    statut: document.getElementById('st-statut')?.value || 'En cours',
    recompense: document.getElementById('st-recompense')?.value?.trim() || '',
  };
  if (id) await updateInCol('story', id, data);
  else await addToCol('story', data);
  closeModal();
  showNotif('Trame enregistrée.', 'success');
  await PAGES.story();
}

async function editStory(id) {
  const items = await loadCollection('story');
  const item = items.find((entry) => entry.id === id);
  if (item) openStoryModal(item);
}

async function deleteStory(id) {
  if (!confirm('Supprimer cet élément ?')) return;
  await deleteFromCol('story', id);
  showNotif('Élément supprimé.', 'success');
  await PAGES.story();
}

Object.assign(window, { openStoryModal, saveStory, editStory, deleteStory });
