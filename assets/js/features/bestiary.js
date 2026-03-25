import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function parseAttacks(raw) {
  return raw
    .split('
')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [nom, degats, effet] = line.split('|').map((part) => part?.trim() || '');
      return { nom: nom || 'Attaque', degats: degats || '?', effet: effet || '' };
    });
}

function openBestiaryModal(creature = null) {
  openModal(creature ? '✏️ Modifier la créature' : '🐉 Nouvelle créature', `
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Nom</label><input class="input-field" id="best-nom" value="${creature?.nom || ''}"></div>
      <div class="form-group"><label>Catégorie</label><input class="input-field" id="best-cat" value="${creature?.categorie || ''}"></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Emoji</label><input class="input-field" id="best-emoji" value="${creature?.emoji || '🐉'}"></div>
      <div class="form-group"><label>Traits</label><input class="input-field" id="best-traits" value="${creature?.traits || ''}"></div>
    </div>
    <div class="grid-4" style="gap:0.8rem">
      <div class="form-group"><label>PV</label><input type="number" class="input-field" id="best-pv" value="${creature?.pv || 10}"></div>
      <div class="form-group"><label>PM</label><input type="number" class="input-field" id="best-pm" value="${creature?.pm || 0}"></div>
      <div class="form-group"><label>CA</label><input type="number" class="input-field" id="best-ca" value="${creature?.ca || 10}"></div>
      <div class="form-group"><label>XP</label><input type="number" class="input-field" id="best-xp" value="${creature?.xp || 0}"></div>
    </div>
    <div class="form-group"><label>Attaques (une par ligne : nom | dégâts | effet)</label><textarea class="input-field" id="best-attaques" rows="5">${(creature?.attaques || []).map((a) => `${a.nom || ''} | ${a.degats || ''} | ${a.effet || ''}`).join('\n')}</textarea></div>
    <div class="form-group"><label>Butins</label><input class="input-field" id="best-butins" value="${creature?.butins || ''}"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBestiary('${creature?.id || ''}')">Enregistrer</button>
  `);
}

async function saveBestiary(id = '') {
  const data = {
    nom: document.getElementById('best-nom')?.value?.trim() || 'Créature',
    categorie: document.getElementById('best-cat')?.value?.trim() || 'Créature',
    emoji: document.getElementById('best-emoji')?.value?.trim() || '🐉',
    traits: document.getElementById('best-traits')?.value?.trim() || '',
    pv: parseInt(document.getElementById('best-pv')?.value, 10) || 10,
    pm: parseInt(document.getElementById('best-pm')?.value, 10) || 0,
    ca: parseInt(document.getElementById('best-ca')?.value, 10) || 10,
    xp: parseInt(document.getElementById('best-xp')?.value, 10) || 0,
    attaques: parseAttacks(document.getElementById('best-attaques')?.value || ''),
    butins: document.getElementById('best-butins')?.value?.trim() || '',
  };
  if (id) await updateInCol('bestiaire', id, data);
  else await addToCol('bestiaire', data);
  closeModal();
  showNotif('Créature enregistrée.', 'success');
  await PAGES.bestiaire();
}

async function editBestiary(id) {
  const items = await loadCollection('bestiaire');
  const creature = items.find((entry) => entry.id === id);
  if (creature) openBestiaryModal(creature);
}

async function deleteBestiary(id) {
  if (!confirm('Supprimer cette créature ?')) return;
  await deleteFromCol('bestiaire', id);
  showNotif('Créature supprimée.', 'success');
  await PAGES.bestiaire();
}

function filterBestiary(category, el) {
  document.querySelectorAll('#best-cats .tab').forEach((tab) => tab.classList.remove('active'));
  el?.classList.add('active');
  document.querySelectorAll('#bestiary-list .bestiary-card').forEach((card) => {
    card.style.display = !category || card.dataset.cat === category ? '' : 'none';
  });
}

Object.assign(window, { openBestiaryModal, saveBestiary, editBestiary, deleteBestiary, filterBestiary });
