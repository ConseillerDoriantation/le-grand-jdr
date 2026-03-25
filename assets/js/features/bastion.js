import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function getDefaultBastion() {
  return {
    nom: 'Bastion sans nom',
    niveau: 1,
    tresor: 0,
    defense: 0,
    description: 'Votre bastion attend sa première description.',
    salles: [],
    journal: [],
  };
}

async function editBastion() {
  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  openModal('🏰 Modifier le bastion', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="bastion-nom" value="${current.nom || ''}"></div>
    <div class="grid-3" style="gap:0.75rem">
      <div class="form-group"><label>Niveau</label><input type="number" class="input-field" id="bastion-niveau" value="${current.niveau || 1}"></div>
      <div class="form-group"><label>Trésor</label><input type="number" class="input-field" id="bastion-tresor" value="${current.tresor || 0}"></div>
      <div class="form-group"><label>Défense</label><input type="number" class="input-field" id="bastion-defense" value="${current.defense || 0}"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="bastion-description" rows="5">${current.description || ''}</textarea></div>
    <div class="form-group"><label>Salles (une par ligne : nom | niveau | effet)</label><textarea class="input-field" id="bastion-salles" rows="6">${(current.salles || []).map((s) => `${s.nom || ''} | ${s.niveau || 1} | ${s.effet || ''}`).join('\n')}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastion()">Enregistrer</button>
  `);
}

async function saveBastion() {
  const sallesRaw = document.getElementById('bastion-salles')?.value || '';
  const salles = sallesRaw
    .split('
')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [nom, niveau, effet] = line.split('|').map((part) => part?.trim() || '');
      return { nom: nom || 'Salle', niveau: parseInt(niveau, 10) || 1, effet: effet || '' };
    });

  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  await saveDoc('bastion', 'main', {
    nom: document.getElementById('bastion-nom')?.value?.trim() || 'Bastion sans nom',
    niveau: parseInt(document.getElementById('bastion-niveau')?.value, 10) || 1,
    tresor: parseInt(document.getElementById('bastion-tresor')?.value, 10) || 0,
    defense: parseInt(document.getElementById('bastion-defense')?.value, 10) || 0,
    description: document.getElementById('bastion-description')?.value || '',
    salles,
    journal: current.journal || [],
  });
  closeModal();
  showNotif('Bastion mis à jour.', 'success');
  await PAGES.bastion();
}

function addBastionLog() {
  openModal('📝 Ajouter une entrée au journal', `
    <div class="form-group"><label>Date</label><input class="input-field" id="bastion-log-date" value="${new Date().toLocaleDateString('fr-FR')}"></div>
    <div class="form-group"><label>Texte</label><textarea class="input-field" id="bastion-log-text" rows="5"></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastionLog()">Ajouter</button>
  `);
}

async function saveBastionLog() {
  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  const journal = current.journal || [];
  journal.unshift({
    date: document.getElementById('bastion-log-date')?.value?.trim() || new Date().toLocaleDateString('fr-FR'),
    texte: document.getElementById('bastion-log-text')?.value?.trim() || '',
  });
  await saveDoc('bastion', 'main', { ...current, journal });
  closeModal();
  showNotif('Entrée ajoutée.', 'success');
  await PAGES.bastion();
}

Object.assign(window, { getDefaultBastion, editBastion, saveBastion, addBastionLog, saveBastionLog });
