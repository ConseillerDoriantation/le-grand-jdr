import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

export function showTutSection(idx, el) {
  document.querySelectorAll('.tutorial-nav-item').forEach((i) => i.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tut-content').textContent = (window._tutSections || [])[idx]?.content || '';
}

export async function editTutorial() {
  const tutorialDoc = await getDocData('tutorial', 'main');
  const sections = tutorialDoc?.sections || getDefaultTutorial();
  openModal('📕 Modifier le Tutoriel', `
    <div id="tut-sections">
      ${sections.map((s, i) => `
        <div style="margin-bottom:1rem;background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:1rem">
          <div class="form-group"><label>Titre</label><input class="input-field" id="ts-title-${i}" value="${s.title || ''}"></div>
          <div class="form-group"><label>Contenu</label><textarea class="input-field" id="ts-content-${i}" rows="8">${s.content || ''}</textarea></div>
        </div>`).join('')}
    </div>
    <button class="btn btn-gold" style="width:100%" onclick="saveTutorial(${sections.length})">Enregistrer</button>
  `);
  window._tutSectionCount = sections.length;
}

export async function saveTutorial(count) {
  const sections = [];
  for (let i = 0; i < (window._tutSectionCount || count); i += 1) {
    const t = document.getElementById(`ts-title-${i}`);
    const c = document.getElementById(`ts-content-${i}`);
    if (t && c) sections.push({ title: t.value, content: c.value });
  }
  await saveDoc('tutorial', 'main', { sections });
  closeModal();
  showNotif('Tutoriel mis à jour !', 'success');
  window.navigate?.('tutorial');
}

export function getDefaultTutorial() {
  return [
    { title: 'Introduction', content: 'Bienvenue dans Le Grand JDR !

Ce tutoriel t'explique comment fonctionnent les mécaniques du jeu.' },
    { title: 'Les Caractéristiques', content: 'Force (Fo) : Puissance physique, attaques au corps-à-corps.
Dextérité (Dex) : Agilité, attaques à distance.
Intelligence (In) : Aptitude magique.
Sagesse (Sa) : Perception et sorts de support.
Constitution (Co) : Endurance, PV bonus.
Charisme (Ch) : Persuasion, sorts de charme.

Le Modificateur = (Stat - 10) / 2 (arrondi inférieur).' },
    { title: 'Le Combat', content: 'Chaque tour tu disposes de :
• 1 Action
• 1 Action Bonus
• 1 Réaction
• Déplacement (Vitesse en mètres)

Attaque : 1d20 + Modificateur vs CA de la cible.
Critique : Max des dés + relance les dés de dégâts.' },
    { title: 'La Magie', content: 'Les sorts coûtent des PM.
Le Noyau indique quelle caractéristique est utilisée.

* = Sort qui ne dépend d'aucune stat.

Magie à mains nues : +2 PM, pas d'effet de set.' },
    { title: 'L'Équipement', content: 'L'équipement apporte des bonus à tes caractéristiques et à ta CA.

Effet de Set : Equiper plusieurs pièces d'un même set active un bonus spécial.

Armes : Main principale (attaque principale) et main secondaire (réaction).' },
    { title: 'Les Runes', content: 'Les runes sont des améliorations que l'on peut appliquer à l'équipement.

Elles apportent des effets supplémentaires uniques.' },
  ];
}

Object.assign(window, { showTutSection, editTutorial, saveTutorial });
