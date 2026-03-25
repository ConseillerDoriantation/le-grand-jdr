import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function openAchievementModal(item = null) {
  openModal(item ? '✏️ Modifier le haut-fait' : '🏆 Nouveau haut-fait', `
    <div class="form-group"><label>Titre</label><input class="input-field" id="ach-titre" value="${item?.titre || ''}"></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="ach-desc" rows="4">${item?.description || ''}</textarea></div>
    <div class="form-group"><label>URL image</label><input class="input-field" id="ach-img" value="${item?.imageUrl || ''}" placeholder="https://..."></div>
    <div class="form-group"><label>Emoji</label><input class="input-field" id="ach-emoji" value="${item?.emoji || '🏆'}"></div>
    <div class="form-group"><label>Date</label><input class="input-field" id="ach-date" value="${item?.date || new Date().toLocaleDateString('fr-FR')}"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveAchievement('${item?.id || ''}')">Enregistrer</button>
  `);
}

async function saveAchievement(id = '') {
  const data = {
    titre: document.getElementById('ach-titre')?.value?.trim() || 'Haut-fait',
    description: document.getElementById('ach-desc')?.value || '',
    imageUrl: document.getElementById('ach-img')?.value?.trim() || '',
    emoji: document.getElementById('ach-emoji')?.value?.trim() || '🏆',
    date: document.getElementById('ach-date')?.value?.trim() || '',
  };
  if (id) await updateInCol('achievements', id, data);
  else await addToCol('achievements', data);
  closeModal();
  showNotif('Haut-fait enregistré.', 'success');
  await PAGES.achievements();
}

async function editAchievement(id) {
  const items = await loadCollection('achievements');
  const item = items.find((entry) => entry.id === id);
  if (item) openAchievementModal(item);
}

async function deleteAchievement(id) {
  if (!confirm('Supprimer ce haut-fait ?')) return;
  await deleteFromCol('achievements', id);
  showNotif('Haut-fait supprimé.', 'success');
  await PAGES.achievements();
}

Object.assign(window, { openAchievementModal, saveAchievement, editAchievement, deleteAchievement });
