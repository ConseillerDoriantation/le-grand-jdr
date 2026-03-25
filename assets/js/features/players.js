import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function openPlayerPresentModal(player = null) {
  openModal(player ? '✏️ Modifier le joueur' : '⚔️ Présenter un joueur', `
    <div class="form-group"><label>Nom du personnage</label><input class="input-field" id="pp-nom" value="${player?.nom || ''}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Classe</label><input class="input-field" id="pp-classe" value="${player?.classe || ''}"></div>
      <div class="form-group"><label>Race</label><input class="input-field" id="pp-race" value="${player?.race || ''}"></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Niveau</label><input type="number" class="input-field" id="pp-niveau" value="${player?.niveau || 1}"></div>
      <div class="form-group"><label>Emoji</label><input class="input-field" id="pp-emoji" value="${player?.emoji || '⚔️'}"></div>
    </div>
    <div class="form-group"><label>Joueur</label><input class="input-field" id="pp-joueur" value="${player?.joueur || ''}"></div>
    <div class="form-group"><label>Présentation</label><textarea class="input-field" id="pp-bio" rows="5">${player?.bio || ''}</textarea></div>
    <div class="form-group"><label>URL image</label><input class="input-field" id="pp-img" value="${player?.imageUrl || ''}"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="savePlayerPresent('${player?.id || ''}')">Enregistrer</button>
  `);
}

async function savePlayerPresent(id = '') {
  const data = {
    nom: document.getElementById('pp-nom')?.value?.trim() || 'Personnage',
    classe: document.getElementById('pp-classe')?.value?.trim() || '',
    race: document.getElementById('pp-race')?.value?.trim() || '',
    niveau: parseInt(document.getElementById('pp-niveau')?.value, 10) || 1,
    emoji: document.getElementById('pp-emoji')?.value?.trim() || '⚔️',
    joueur: document.getElementById('pp-joueur')?.value?.trim() || '',
    bio: document.getElementById('pp-bio')?.value || '',
    imageUrl: document.getElementById('pp-img')?.value?.trim() || '',
  };
  if (id) await updateInCol('players', id, data);
  else await addToCol('players', data);
  closeModal();
  showNotif('Présentation enregistrée.', 'success');
  await PAGES.players();
}

function viewPlayerDetail(id) {
  loadCollection('players').then((items) => {
    const player = items.find((entry) => entry.id === id);
    if (!player) return;
    openModal(`⚔️ ${player.nom || 'Joueur'}`, `
      <div style="display:grid;grid-template-columns:140px 1fr;gap:1rem;align-items:start">
        <div style="text-align:center">${player.imageUrl ? `<img src="${player.imageUrl}" style="width:140px;height:140px;object-fit:cover;border-radius:12px;border:1px solid var(--border)">` : `<div style="font-size:4rem">${player.emoji || '⚔️'}</div>`}</div>
        <div>
          <div style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--gold)">${player.nom || 'Joueur'}</div>
          <div style="margin-top:0.35rem;color:var(--text-muted)">${player.classe || ''}${player.race ? ` — ${player.race}` : ''}</div>
          <div style="margin-top:0.35rem"><span class="badge badge-gold">Niv. ${player.niveau || 1}</span></div>
          <div style="margin-top:0.35rem;color:var(--text-muted)">Joueur : ${player.joueur || '-'}</div>
          <div style="margin-top:1rem;line-height:1.6">${player.bio || ''}</div>
        </div>
      </div>
    `);
  });
}

async function editPlayerPresent(id) {
  const items = await loadCollection('players');
  const player = items.find((entry) => entry.id === id);
  if (player) openPlayerPresentModal(player);
}

async function deletePlayerPresent(id) {
  if (!confirm('Supprimer cette présentation ?')) return;
  await deleteFromCol('players', id);
  showNotif('Présentation supprimée.', 'success');
  await PAGES.players();
}

Object.assign(window, { openPlayerPresentModal, savePlayerPresent, viewPlayerDetail, editPlayerPresent, deletePlayerPresent });
