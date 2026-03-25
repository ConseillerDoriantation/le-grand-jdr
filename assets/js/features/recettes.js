import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function openRecetteModal(type, existing = null) {
  const title = type === 'potion' ? '🧪 Potion' : '🍳 Recette';
  openModal(existing ? `✏️ Modifier ${title}` : `${title} nouvelle`, `
    <div class="form-group"><label>Nom</label><input class="input-field" id="rec-nom" value="${existing?.nom || ''}"></div>
    <div class="form-group"><label>Famille / Type</label><input class="input-field" id="rec-famille" value="${existing?.famille || ''}"></div>
    <div class="form-group"><label>Durée</label><input class="input-field" id="rec-duree" value="${existing?.duree || ''}"></div>
    <div class="form-group"><label>Ingrédients</label><input class="input-field" id="rec-ingredients" value="${existing?.ingredients || ''}"></div>
    <div class="form-group"><label>Effet</label><textarea class="input-field" id="rec-effet" rows="4">${existing?.effet || ''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveRecette('${type}','${existing?.id || ''}')">Enregistrer</button>
  `);
}

export async function saveRecette(type, id = '') {
  const doc = await getDocData('recettes', 'main') || { recettes: [], potions: [] };
  const key = type === 'potion' ? 'potions' : 'recettes';
  const items = [...(doc[key] || [])];
  const data = {
    id: id || uid(),
    nom: document.getElementById('rec-nom')?.value || '?',
    famille: document.getElementById('rec-famille')?.value || '',
    duree: document.getElementById('rec-duree')?.value || '',
    ingredients: document.getElementById('rec-ingredients')?.value || '',
    effet: document.getElementById('rec-effet')?.value || '',
  };
  const idx = items.findIndex((x) => x.id === data.id);
  if (idx >= 0) items[idx] = data;
  else items.push(data);
  doc[key] = items;
  await saveDoc('recettes', 'main', doc);
  closeModal();
  showNotif('Recette enregistrée !', 'success');
  window.navigate?.('recettes');
}

export async function editRecette(id, type) {
  const doc = await getDocData('recettes', 'main') || { recettes: [], potions: [] };
  const key = type === 'potion' ? 'potions' : 'recettes';
  const existing = (doc[key] || []).find((x) => x.id === id);
  if (existing) openRecetteModal(type, existing);
}

export async function deleteRecette(id) {
  if (!confirm('Supprimer ?')) return;
  const doc = await getDocData('recettes', 'main') || { recettes: [], potions: [] };
  doc.recettes = (doc.recettes || []).filter((r) => r.id !== id);
  doc.potions = (doc.potions || []).filter((r) => r.id !== id);
  await saveDoc('recettes', 'main', doc);
  showNotif('Supprimé.', 'success');
  window.navigate?.('recettes');
}

Object.assign(window, { openRecetteModal, saveRecette, editRecette, deleteRecette });
