import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

export function openCollectionModal(card) {
  openModal(card ? '✏️ Modifier la carte' : '🃏 Nouvelle Carte', `
    <div class="form-group"><label>Nom de la carte</label><input class="input-field" id="cc-nom" value="${card?.nom || ''}"></div>
    <div class="form-group"><label>URL de l'image</label><input class="input-field" id="cc-img" value="${card?.imageUrl || ''}" placeholder="https://..."></div>
    <div class="form-group"><label>Emoji (si pas d'image)</label><input class="input-field" id="cc-emoji" value="${card?.emoji || '🃏'}"></div>
    <div class="form-group"><label>Rareté</label>
      <select class="input-field" id="cc-rarete">
        ${['Commune', 'Peu commune', 'Rare', 'Épique', 'Légendaire'].map((r) => `<option ${r === (card?.rarete || 'Commune') ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="cc-desc" rows="3">${card?.description || ''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCard('${card?.id || ''}')">Enregistrer</button>
  `);
}

export async function saveCard(id) {
  const data = {
    nom: document.getElementById('cc-nom')?.value || '?',
    imageUrl: document.getElementById('cc-img')?.value || '',
    emoji: document.getElementById('cc-emoji')?.value || '🃏',
    rarete: document.getElementById('cc-rarete')?.value || 'Commune',
    description: document.getElementById('cc-desc')?.value || '',
  };
  if (id) await updateInCol('collection', id, data);
  else await addToCol('collection', data);
  closeModal();
  showNotif('Carte enregistrée !', 'success');
  window.navigate?.('collection');
}

export function viewCard(id) {
  loadCollection('collection').then((items) => {
    const c = items.find((x) => x.id === id);
    if (!c) return;
    openModal(`🃏 ${c.nom || 'Carte'}`, `
      ${c.imageUrl ? `<div style="text-align:center;margin-bottom:1rem"><img src="${c.imageUrl}" style="max-width:260px;border-radius:12px;border:1px solid var(--border)"></div>` : `<div style="text-align:center;font-size:4rem;margin-bottom:1rem">${c.emoji || '🃏'}</div>`}
      <div style="text-align:center;margin-bottom:0.8rem"><span class="badge badge-gold">${c.rarete || 'Commune'}</span></div>
      <div style="font-size:0.9rem;line-height:1.7;color:var(--text-muted);white-space:pre-wrap">${c.description || ''}</div>
    `);
  });
}

export async function editCard(id) {
  const items = await loadCollection('collection');
  const c = items.find((x) => x.id === id);
  if (c) openCollectionModal(c);
}

export async function deleteCard(id) {
  if (!confirm('Supprimer cette carte ?')) return;
  await deleteFromCol('collection', id);
  showNotif('Carte supprimée.', 'success');
  window.navigate?.('collection');
}

Object.assign(window, { openCollectionModal, saveCard, viewCard, editCard, deleteCard });
