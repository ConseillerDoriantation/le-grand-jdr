import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function editWorldContent() {
  const doc = await getDocData('world', 'main');
  const sections = (doc?.sections?.length ? doc.sections : [{ title: 'Introduction', content: '' }]).map((s) => ({ ...s }));
  window.__worldSections = sections;
  renderWorldModal();
}

function renderWorldModal() {
  const sections = window.__worldSections || [{ title: 'Introduction', content: '' }];
  openModal('📖 Modifier le contenu du monde', `
    <div id="world-sections">
      ${sections.map((section, index) => `
        <div class="card" style="margin-bottom:1rem;padding:1rem">
          <div class="form-group"><label>Titre</label><input class="input-field" id="ws-title-${index}" value="${escapeHtml(section.title || '')}"></div>
          <div class="form-group"><label>Contenu</label><textarea class="input-field" id="ws-content-${index}" rows="6">${escapeHtml(section.content || '')}</textarea></div>
          <button class="btn btn-danger btn-sm" onclick="removeWorldSection(${index})">Supprimer</button>
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn btn-outline" onclick="addWorldSection()">+ Ajouter une section</button>
      <button class="btn btn-gold" onclick="saveWorld()">Enregistrer</button>
    </div>
  `);
}

function addWorldSection() {
  const sections = window.__worldSections || [];
  sections.push({ title: '', content: '' });
  window.__worldSections = sections;
  renderWorldModal();
}

function removeWorldSection(index) {
  const sections = (window.__worldSections || []).filter((_, i) => i !== index);
  window.__worldSections = sections.length ? sections : [{ title: 'Introduction', content: '' }];
  renderWorldModal();
}

async function saveWorld() {
  const sections = [];
  const count = (window.__worldSections || []).length;
  for (let i = 0; i < count; i += 1) {
    const title = document.getElementById(`ws-title-${i}`)?.value?.trim() || '';
    const content = document.getElementById(`ws-content-${i}`)?.value || '';
    if (title || content) sections.push({ title: title || 'Section', content });
  }
  await saveDoc('world', 'main', { sections: sections.length ? sections : [{ title: 'Introduction', content: '' }] });
  closeModal();
  showNotif('Monde mis à jour.', 'success');
  await PAGES.world();
}

async function saveMapUrl() {
  const imageUrl = document.getElementById('map-url-input')?.value?.trim() || '';
  await saveDoc('world', 'map', { imageUrl });
  showNotif('Carte mise à jour.', 'success');
  await PAGES.map();
}

Object.assign(window, { editWorldContent, addWorldSection, removeWorldSection, saveWorld, saveMapUrl });
