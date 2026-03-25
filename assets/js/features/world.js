import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

function buildWorldEditor(sections) {
  openModal('📖 Modifier le Contenu du Monde', `
    <div id="world-sections">
      ${sections.map((s, i) => `
        <div style="margin-bottom:1rem;background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:1rem">
          <div class="form-group"><label>Titre de la section</label><input class="input-field" id="ws-title-${i}" value="${s.title || ''}"></div>
          <div class="form-group"><label>Contenu</label><textarea class="input-field" id="ws-content-${i}" rows="5">${s.content || ''}</textarea></div>
          <button class="btn btn-danger btn-sm" onclick="removeWorldSection(${i})">Supprimer</button>
        </div>`).join('')}
    </div>
    <button class="btn btn-outline btn-sm" onclick="addWorldSection()" style="margin-bottom:1rem">+ Ajouter une section</button>
    <button class="btn btn-gold" style="width:100%" onclick="saveWorld()">Enregistrer</button>
  `);
}

export async function editWorldContent() {
  const worldDoc = await getDocData('world', 'main');
  const sections = worldDoc?.sections || [{ title: 'Introduction', content: '' }];
  window._worldSections = sections.map((s) => ({ ...s }));
  buildWorldEditor(window._worldSections);
}

export function addWorldSection() {
  const sections = window._worldSections || [];
  sections.push({ title: 'Nouvelle section', content: '' });
  window._worldSections = sections;
  buildWorldEditor(sections);
}

export function removeWorldSection(index) {
  const sections = (window._worldSections || []).filter((_, i) => i !== index);
  window._worldSections = sections;
  buildWorldEditor(sections);
}

export async function saveWorld() {
  const sections = [];
  const count = (window._worldSections || []).length;
  for (let i = 0; i < count; i += 1) {
    const t = document.getElementById(`ws-title-${i}`);
    const c = document.getElementById(`ws-content-${i}`);
    if (t && c) sections.push({ title: t.value, content: c.value });
  }
  await saveDoc('world', 'main', { sections });
  closeModal();
  showNotif('Monde mis à jour !', 'success');
  window.navigate?.('world');
}

export async function saveMapUrl() {
  const url = document.getElementById('map-url-input')?.value || '';
  await saveDoc('world', 'map', { imageUrl: url });
  showNotif('Carte mise à jour !', 'success');
  window.navigate?.('map');
}

Object.assign(window, { editWorldContent, addWorldSection, removeWorldSection, saveWorld, saveMapUrl });
