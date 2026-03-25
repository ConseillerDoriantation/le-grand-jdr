import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

export function openPlayerPresentModal(p) {
  openModal(p ? '✏️ Modifier le Joueur' : '⚔️ Présenter un Joueur', `
    <div class="form-group"><label>Nom du personnage</label><input class="input-field" id="pp-nom" value="${p?.nom || ''}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Classe</label><input class="input-field" id="pp-classe" value="${p?.classe || ''}" placeholder="Guerrier, Mage..."></div>
      <div class="form-group"><label>Race</label><input class="input-field" id="pp-race" value="${p?.race || ''}" placeholder="Humain, Elfe..."></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Niveau</label><input type="number" class="input-field" id="pp-niveau" value="${p?.niveau || 1}"></div>
      <div class="form-group"><label>Emoji / Avatar</label><input class="input-field" id="pp-emoji" value="${p?.emoji || '⚔️'}"></div>
    </div>
    <div class="form-group"><label>Joueur (pseudo)</label><input class="input-field" id="pp-joueur" value="${p?.joueur || ''}"></div>
    <div class="form-group"><label>Présentation / Histoire</label><textarea class="input-field" id="pp-bio" rows="5">${p?.bio || ''}</textarea></div>
    <div class="form-group"><label>URL Image</label><input class="input-field" id="pp-img" value="${p?.imageUrl || ''}" placeholder="https://..."></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="savePlayerPresent('${p?.id || ''}')">Enregistrer</button>
  `);
}

export async function savePlayerPresent(id) {
  const data = {
    nom: document.getElementById('pp-nom')?.value || '?',
    classe: document.getElementById('pp-classe')?.value || '',
    race: document.getElementById('pp-race')?.value || '',
    niveau: parseInt(document.getElementById('pp-niveau')?.value, 10) || 1,
    emoji: document.getElementById('pp-emoji')?.value || '⚔️',
    joueur: document.getElementById('pp-joueur')?.value || '',
    bio: document.getElementById('pp-bio')?.value || '',
    imageUrl: document.getElementById('pp-img')?.value || '',
  };
  if (id) await updateInCol('players', id, data);
  else await addToCol('players', data);
  closeModal();
  showNotif('Joueur enregistré !', 'success');
  window.navigate?.('players');
}

export function viewPlayerDetail(id) {
  loadCollection('players').then((items) => {
    const p = items.find((x) => x.id === id);
    if (!p) return;
    openModal(`⚔️ ${p.nom}`, `
      ${p.imageUrl ? `<div style="text-align:center;margin-bottom:1rem"><img src="${p.imageUrl}" style="max-width:200px;border-radius:50%;border:3px solid var(--gold)"></div>` : `<div style="text-align:center;font-size:4rem;margin-bottom:1rem">${p.emoji || '⚔️'}</div>`}
      <div style="text-align:center">
        <div style="font-family:'Cinzel',serif;font-size:1.3rem;color:var(--gold);margin-bottom:0.3rem">${p.nom}</div>
        <div style="color:var(--text-muted);font-style:italic;margin-bottom:0.5rem">${p.classe || ''} ${p.race ? `— ${p.race}` : ''}</div>
        <span class="badge badge-gold">Niveau ${p.niveau || 1}</span>
        ${p.joueur ? `<div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-dim)">Joué par ${p.joueur}</div>` : ''}
      </div>
      <hr class="divider">
      <div style="font-size:0.9rem;line-height:1.7;color:var(--text-muted);font-style:italic;white-space:pre-wrap">${p.bio || ''}</div>
    `);
  });
}

export async function editPlayerPresent(id) {
  const items = await loadCollection('players');
  const p = items.find((x) => x.id === id);
  if (p) openPlayerPresentModal(p);
}

export async function deletePlayerPresent(id) {
  if (!confirm('Supprimer ce joueur ?')) return;
  await deleteFromCol('players', id);
  showNotif('Supprimé.', 'success');
  window.navigate?.('players');
}

Object.assign(window, { openPlayerPresentModal, savePlayerPresent, viewPlayerDetail, editPlayerPresent, deletePlayerPresent });
