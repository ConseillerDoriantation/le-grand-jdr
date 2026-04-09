import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

function getDefaultTutorial() {
  return [
    { title: 'Introduction', content: 'Bienvenue dans Le Grand JDR. Cette section pourra être enrichie par le MJ.' },
    { title: 'Créer un personnage', content: 'Choisis une race, une classe et répartis tes statistiques.' },
    { title: 'Combat', content: 'Chaque tour comprend une action, un déplacement et éventuellement une réaction.' },
  ];
}

function showTutSection(index, el) {
  document.querySelectorAll('#tut-nav .tutorial-nav-item').forEach((item) => item.classList.remove('active'));
  el?.classList.add('active');
  const section = (window._tutSections || [])[index];
  const content = document.getElementById('tut-content');
  if (content && section) content.textContent = section.content || '';
}

async function editTutorial() {
  const doc = await getDocData('tutorial', 'main');
  const sections = doc?.sections || getDefaultTutorial();
  openModal('📕 Modifier le tutoriel', `
    <div class="form-group"><label>Sections (une par bloc : titre | contenu)</label>
      <textarea class="input-field" id="tutorial-edit" rows="16">${sections.map((section) => `${section.title} | ${section.content}`).join('\n\n')}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveTutorial()">Enregistrer</button>
  `);
}

async function saveTutorial() {
  try {
    const raw = document.getElementById('tutorial-edit')?.value || '';
    const sections = raw
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const [title, ...rest] = block.split('|');
        return { title: (title || 'Section').trim(), content: rest.join('|').trim() };
      });

    await saveDoc('tutorial', 'main', { sections: sections.length ? sections : getDefaultTutorial() });
    closeModal();
    showNotif('Tutoriel mis à jour.', 'success');
    await PAGES.tutorial();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// Initialiser le namespace si app.js ne l'a pas encore fait
window.JDRApp = window.JDRApp || {};

Object.assign(window.JDRApp, { getDefaultTutorial, showTutSection, editTutorial, saveTutorial });
