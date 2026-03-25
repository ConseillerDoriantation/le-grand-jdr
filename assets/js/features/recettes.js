import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function findRecette(type, id, doc) {
  const list = type === 'potion' ? (doc?.potions || []) : (doc?.recettes || []);
  return list.find((entry) => entry.id === id) || null;
}

async function openRecetteModal(type = 'cuisine', id = '') {
  const doc = await getDocData('recettes', 'main');
  const existing = id ? findRecette(type, id, doc) : null;
  openModal(existing ? '✏️ Modifier' : type === 'potion' ? '🧪 Nouvelle potion' : '🍳 Nouvelle recette', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="rec-nom" value="${existing?.nom || ''}"></div>
    <div class="form-group"><label>Famille</label><input class="input-field" id="rec-famille" value="${existing?.famille || ''}"></div>
    <div class="form-group"><label>Durée</label><input class="input-field" id="rec-duree" value="${existing?.duree || ''}"></div>
    <div class="form-group"><label>Ingrédients</label><input class="input-field" id="rec-ingredients" value="${existing?.ingredients || ''}"></div>
    <div class="form-group"><label>Effet</label><textarea class="input-field" id="rec-effet" rows="4">${existing?.effet || ''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveRecette('${type}','${id}')">Enregistrer</button>
  `);
}

async function saveRecette(type = 'cuisine', id = '') {
  const doc = (await getDocData('recettes', 'main')) || { recettes: [], potions: [] };
  const key = type === 'potion' ? 'potions' : 'recettes';
  const list = [...(doc[key] || [])];
  const data = {
    id: id || `r_${Date.now()}`,
    nom: document.getElementById('rec-nom')?.value?.trim() || 'Recette',
    famille: document.getElementById('rec-famille')?.value?.trim() || '',
    duree: document.getElementById('rec-duree')?.value?.trim() || '',
    ingredients: document.getElementById('rec-ingredients')?.value?.trim() || '',
    effet: document.getElementById('rec-effet')?.value || '',
  };
  const index = list.findIndex((entry) => entry.id === data.id);
  if (index >= 0) list[index] = data;
  else list.push(data);
  await saveDoc('recettes', 'main', { ...doc, [key]: list });
  closeModal();
  showNotif('Recette enregistrée.', 'success');
  await PAGES.recettes();
}

async function editRecette(id, type = 'cuisine') {
  await openRecetteModal(type, id);
}

async function deleteRecette(id) {
  const doc = (await getDocData('recettes', 'main')) || { recettes: [], potions: [] };
  await saveDoc('recettes', 'main', {
    ...doc,
    recettes: (doc.recettes || []).filter((entry) => entry.id !== id),
    potions: (doc.potions || []).filter((entry) => entry.id !== id),
  });
  showNotif('Recette supprimée.', 'success');
  await PAGES.recettes();
}

Object.assign(window, { openRecetteModal, saveRecette, editRecette, deleteRecette });
