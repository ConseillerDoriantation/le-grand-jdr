import { saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function showInfoSection(id, el) {
  document.querySelectorAll('#info-nav .tutorial-nav-item').forEach((item) => item.classList.remove('active'));
  el?.classList.add('active');
  window._infoSection = id;
  const section = (window._infoSections || []).find((entry) => entry.id === id);
  const contentEl = document.getElementById('info-content');
  if (contentEl && section) contentEl.textContent = section.content || '';
}

function editInfoSection(id) {
  const section = (window._infoSections || []).find((entry) => entry.id === id);
  if (!section) return;
  openModal(`✏️ ${section.title}`, `
    <div class="form-group"><label>Contenu</label>
      <textarea class="input-field" id="info-edit-content" rows="16" style="font-family:monospace;font-size:0.82rem">${section.content || ''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="JDRApp.saveInfoSection('${id}')">Enregistrer</button>
  `);
}

async function saveInfoSection(id) {
  try {
    const sections = [...(window._infoSections || [])];
    const index = sections.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    sections[index] = { ...sections[index], content: document.getElementById('info-edit-content')?.value || '' };
    window._infoSections = sections;
    await saveDoc('informations', 'main', { sections });
    closeModal();
    showNotif('Section mise à jour.', 'success');
    await PAGES.informations();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

function getInfoStats() {
  return `RACES ET STATISTIQUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Chaque race confère des bonus. Les statistiques principales influencent directement les jets, les PV, les PM et le deck.`;
}

function getInfoEquipements() {
  return `ÉQUIPEMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Le torse détermine la CA de base. Les armes et accessoires ajoutent des effets, bonus plats ou capacités spéciales.`;
}

function getInfoCombat() {
  return `COMBAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Chaque tour : 1 action, 1 action bonus éventuelle, 1 réaction et du déplacement. Un jet d20 sert à toucher.`;
}

function getInfoDeck() {
  return `DECK ET RUNES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Les sorts actifs occupent des places de deck. Les runes modifient un noyau élémentaire pour produire des effets.`;
}

function getInfoArtisanat() {
  return `ARTISANAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Forge, cuisine, alchimie et confection nécessitent des matériaux, une recette et un atelier adapté.`;
}

function getInfoBastion() {
  return `BASTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Le bastion évolue avec le groupe. Ses salles et son journal racontent la progression collective.`;
}

function getInfoEtats() {
  return `ÉTATS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Brûlure, gel, poison, étourdissement et autres altérations doivent être appliqués et suivis par le MJ.`;
}

// Initialiser le namespace si app.js ne l'a pas encore fait
window.JDRApp = window.JDRApp || {};

Object.assign(window.JDRApp, {
  showInfoSection,
  editInfoSection,
  saveInfoSection,
  getInfoStats,
  getInfoEquipements,
  getInfoCombat,
  getInfoDeck,
  getInfoArtisanat,
  getInfoBastion,
  getInfoEtats,
});
