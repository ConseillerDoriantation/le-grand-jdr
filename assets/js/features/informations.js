import { saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

export function showInfoSection(id, el) {
  document.querySelectorAll('.tutorial-nav-item').forEach((i) => i.classList.remove('active'));
  el?.classList.add('active');
  window._infoSection = id;
  const section = (window._infoSections || []).find((s) => s.id === id);
  const contentEl = document.getElementById('info-content');
  if (contentEl && section) contentEl.textContent = section.content;
}

export function editInfoSection(id) {
  const section = (window._infoSections || []).find((s) => s.id === id);
  if (!section) return;
  openModal(`✏️ ${section.title}`, `
    <div class="form-group"><label>Contenu</label>
      <textarea class="input-field" id="info-edit-content" rows="15" style="font-family:monospace;font-size:0.82rem">${section.content || ''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInfoSection('${id}')">Enregistrer</button>
  `);
}

export async function saveInfoSection(id) {
  const sections = window._infoSections || [];
  const idx = sections.findIndex((s) => s.id === id);
  if (idx < 0) return;
  sections[idx].content = document.getElementById('info-edit-content')?.value || '';
  window._infoSections = sections;
  await saveDoc('informations', 'main', { sections });
  closeModal();
  showNotif('Section mise à jour !', 'success');
  window.navigate?.('informations');
}

export function getInfoStats() { return `RACES & BONUS ÉLÉMENTAIRES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Humain     : +1 Fo, +2 Dex / +2 Fo, +1 Dex
  Elfe       : +2 Fo, +1 Dex (ou inverse)
  Nain       : +1 Dex, +2 In / +2 Dex, +1 In
  Demi-Anim. : +2 Fo, +1 Dex / autre
  Créa. Mag. : +1 Fo, +2 In / autre
  Gnome      : +2 Fo, +1 Dex / autre

ÉLÉMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Feu    : +2 Fo, +1 Dex / +1 Fo, +2 Dex
  Eau    : +1 Fo, +2 Dex / +2 Fo, +1 Dex
  Vent   : +2 Fo, +1 Dex
  Terre  : +1 Fo, +2 Dex
  Lumière: +1 Fo, +2 In / +2 Fo, +1 In
  Ombre  : +2 Fo, +1 Dex

MODIFICATEURS MAXIMUM : +6 (22 points)`; }
export function getInfoEquipements() { return `EMPLACEMENTS D'ÉQUIPEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Tête         : Jusqu'à 2 points de stats
  Torse        : Jusqu'à 4 pts. Fixe la CA de base.
  Pieds        : Jusqu'à 3 points de stats
  Bague        : Jusqu'à 2 pts + bonus plats
  Amulette     : 1 pt sur 3 stats différentes + effets spéciaux
  Objet Magique: Activable en combat`; }
export function getInfoCombat() { return `DÉROULEMENT D'UN TOUR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Chaque tour : 1 Action + 1 Action Bonus + 1 Réaction + Déplacement

ATTAQUER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Toucher : 1d20 + Modificateur de l'arme
  → Si score > CA cible : touche`; }
export function getInfoDeck() { return `LE DECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Contient tous les sorts utilisables en combat ou tension.
Hors combat : tous les sorts créés sont utilisables.`; }
export function getInfoArtisanat() { return `ARTISANAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Nécessite : Outil/atelier + recette + jet d'artisanat (Fo/Dex/In).`; }
export function getInfoBastion() { return `LE BASTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Génère de l'or à chaque session. Les améliorations renforcent le groupe.`; }
export function getInfoEtats() { return `ÉTATS DE COMBAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Invisible · Endormi · Cécité · Charmé · Effrayé · Entravé · Étourdi · Pétrifié · DoT · Provoqué · Silence · Inconscient`; }

Object.assign(window, { showInfoSection, editInfoSection, saveInfoSection });
