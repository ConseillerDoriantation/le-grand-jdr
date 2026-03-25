import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function openCollectionModal(card = null) {
  openModal(card ? '✏️ Modifier la carte' : '🃏 Nouvelle carte', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="cc-nom" value="${card?.nom || ''}"></div>
    <div class="form-group"><label>URL image</label><input class="input-field" id="cc-img" value="${card?.imageUrl || ''}" placeholder="https://..."></div>
    <div class="form-group"><label>Emoji</label><input class="input-field" id="cc-emoji" value="${card?.emoji || '🃏'}"></div>
    <div class="form-group"><label>Rareté</label>
      <select class="input-field" id="cc-rarete">
        ${['Commune', 'Peu commune', 'Rare', 'Épique', 'Légendaire'].map((r) => `<option ${r === (card?.rarete || 'Commune') ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="cc-desc" rows="4">${card?.description || ''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCard('${card?.id || ''}')">Enregistrer</button>
  `);
}

async function saveCard(id = '') {
  const data = {
    nom: document.getElementById('cc-nom')?.value?.trim() || 'Carte',
    imageUrl: document.getElementById('cc-img')?.value?.trim() || '',
    emoji: document.getElementById('cc-emoji')?.value?.trim() || '🃏',
    rarete: document.getElementById('cc-rarete')?.value || 'Commune',
    description: document.getElementById('cc-desc')?.value || '',
  };
  if (id) await updateInCol('collection', id, data);
  else await addToCol('collection', data);
  closeModal();
  showNotif('Carte enregistrée.', 'success');
  await PAGES.collection();
}

function viewCard(id) {
  loadCollection('collection').then((items) => {
    const card = items.find((entry) => entry.id === id);
    if (!card) return;
    openModal(`🃏 ${card.nom || 'Carte'}`, `
      <div style="text-align:center;margin-bottom:1rem">
        ${card.imageUrl ? `<img src="${card.imageUrl}" style="max-width:220px;border-radius:8px;border:1px solid var(--border)">` : `<div style="font-size:5rem">${card.emoji || '🃏'}</div>`}
      </div>
      <div style="text-align:center;font-family:'Cinzel',serif;font-size:1.1rem;color:var(--gold)">${card.nom || 'Carte'}</div>
      <div style="text-align:center;margin-top:0.5rem"><span class="badge badge-gold">${card.rarete || 'Commune'}</span></div>
      <div style="margin-top:1rem;font-size:0.85rem;color:var(--text-muted);line-height:1.6">${card.description || ''}</div>
    `);
  });
}

async function editCard(id) {
  const items = await loadCollection('collection');
  const card = items.find((entry) => entry.id === id);
  if (card) openCollectionModal(card);
}

async function deleteCard(id) {
  if (!confirm('Supprimer cette carte ?')) return;
  await deleteFromCol('collection', id);
  showNotif('Carte supprimée.', 'success');
  await PAGES.collection();
}

Object.assign(window, { openCollectionModal, saveCard, viewCard, editCard, deleteCard });
