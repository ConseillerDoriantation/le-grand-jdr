import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── Données statiques des améliorations ──────────────────────────────────────
export const BASTION_AMELIORATIONS = [
  {
    id: 'cuisine',
    nom: 'Cuisine',
    emoji: '🍳',
    cout: 500,
    description: 'Cuisiner avant une mission sans marmite ni pierre de feu.',
    detail: 'Permet à tout le groupe de préparer des repas avant de partir en mission. Aucun équipement requis — les bonus alimentaires s\'appliquent normalement.',
  },
  {
    id: 'alchimie',
    nom: 'Atelier d\'Alchimie',
    emoji: '⚗️',
    cout: 500,
    description: 'Préparer des potions avant mission sans alambic ni feu.',
    detail: 'Permet de préparer des potions avant une mission. Aucun alambic ni pierre de feu requis. Les recettes connues peuvent être utilisées librement.',
  },
  {
    id: 'forge',
    nom: 'Forge',
    emoji: '⚒️',
    cout: 500,
    description: 'Crafter armes physiques et armures lourdes avec recette.',
    detail: 'Permet de fabriquer des armes physiques et des armures lourdes, à condition de posséder la recette. Les matériaux restent à fournir.',
  },
  {
    id: 'confection',
    nom: 'Atelier de Confection',
    emoji: '🧵',
    cout: 500,
    description: 'Crafter armes à dist., armures légères et intermédiaires.',
    detail: 'Permet de fabriquer des armes à distance physiques, armures légères et armures intermédiaires avec les recettes correspondantes.',
  },
  {
    id: 'orfevrerie',
    nom: 'Atelier d\'Orfèvre',
    emoji: '💎',
    cout: 500,
    description: 'Crafter armes magiques et bijoux avec recette connue.',
    detail: 'Permet de fabriquer des armes magiques et des bijoux. Chaque pièce nécessite la recette correspondante et les matériaux adéquats.',
  },
  {
    id: 'stockage',
    nom: 'Extension Stockage',
    emoji: '📦',
    cout: 200,
    description: '+10 emplacements de stockage permanent au Bastion.',
    detail: 'Augmente la capacité de stockage du Bastion de 10 emplacements. Peut être achetée plusieurs fois. Chaque achat compte comme une amélioration de niveau.',
  },
];

// ── Événements aléatoires ────────────────────────────────────────────────────
export const BASTION_EVENTS = [
  {
    id: 'vol',
    nom: 'Vol',
    emoji: '🗡️',
    description: 'Des voleurs ont sévi cette nuit.',
    effet: '-20% des revenus totaux',
    modificateur: 0.80,
    bonus: 0,
    couleur: 'crimson',
    badgeClass: 'badge-red',
    badgeText: '−20%',
  },
  {
    id: 'inspection',
    nom: 'Inspection',
    emoji: '📜',
    description: 'Les autorités ont inspecté les lieux. Tout est en ordre.',
    effet: 'Revenu normal',
    modificateur: 1.0,
    bonus: 0,
    couleur: 'neutral',
    badgeClass: 'badge-blue',
    badgeText: '±0',
  },
  {
    id: 'calme',
    nom: 'Calme',
    emoji: '☁️',
    description: 'Une période tranquille, sans événement notable.',
    effet: 'Revenu normal',
    modificateur: 1.0,
    bonus: 0,
    couleur: 'neutral',
    badgeClass: 'badge-blue',
    badgeText: '±0',
  },
  {
    id: 'riche',
    nom: 'Clientèle riche',
    emoji: '💰',
    description: 'Des clients fortunés ont fait une commande exceptionnelle.',
    effet: '+10 or ce cycle',
    modificateur: 1.0,
    bonus: 10,
    couleur: 'gold',
    badgeClass: 'badge-gold',
    badgeText: '+10 or',
  },
  {
    id: 'rumeur',
    nom: 'Rumeur favorable',
    emoji: '📣',
    description: 'Une bonne réputation court dans toute la région.',
    effet: '+20 or ce cycle',
    modificateur: 1.0,
    bonus: 20,
    couleur: 'gold',
    badgeClass: 'badge-gold',
    badgeText: '+20 or',
  },
  {
    id: 'succes',
    nom: 'Succès commercial',
    emoji: '⭐',
    description: 'Une période exceptionnellement faste pour les affaires.',
    effet: '+30 or ce cycle',
    modificateur: 1.0,
    bonus: 30,
    couleur: 'green',
    badgeClass: 'badge-green',
    badgeText: '+30 or',
  },
];

// ── Calcul des revenus ───────────────────────────────────────────────────────
export function calculerRevenuBastion(data) {
  const amelios = data.ameliorations || {};
  const nbAmelios = Object.values(amelios).filter(Boolean).length;
  const base = 100 + nbAmelios * 100;

  const evtId = data.evenementCourant || 'calme';
  const evt = BASTION_EVENTS.find((e) => e.id === evtId) || BASTION_EVENTS[2];

  let brut = Math.round(base * evt.modificateur) + (evt.bonus || 0);
  const fondateurs = Math.round(brut * 0.1);
  const reinvesti = brut - fondateurs;

  return { brut, fondateurs, reinvesti, base, nbAmelios, evt };
}

// ── Données par défaut ───────────────────────────────────────────────────────
export function getDefaultBastion() {
  return {
    nom: 'Le Bastion',
    niveau: 1,
    tresor: 0,
    defense: 0,
    description: 'Votre bastion attend sa première description.',
    ameliorations: {},
    evenementCourant: 'calme',
    fondateurs: [],
    historique: [],
    activite: '',
    pnj: '',
    salles: [],
    journal: [],
  };
}

// ── Éditer les infos générales ───────────────────────────────────────────────
async function editBastion() {
  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  openModal('🏰 Modifier le Bastion', `
    <div class="form-group">
      <label>Nom du Bastion</label>
      <input class="input-field" id="b-nom" value="${current.nom || ''}">
    </div>
    <div class="grid-2" style="gap:0.75rem">
      <div class="form-group">
        <label>Trésor (or)</label>
        <input type="number" class="input-field" id="b-tresor" value="${current.tresor || 0}">
      </div>
      <div class="form-group">
        <label>Défense</label>
        <input type="number" class="input-field" id="b-defense" value="${current.defense || 0}">
      </div>
    </div>
    <div class="form-group">
      <label>Activité principale</label>
      <input class="input-field" id="b-activite" value="${current.activite || ''}" placeholder="ex: Commerce d'armes">
    </div>
    <div class="form-group">
      <label>PNJ en charge</label>
      <input class="input-field" id="b-pnj" value="${current.pnj || ''}" placeholder="ex: Aldric le Forgeron">
    </div>
    <div class="form-group">
      <label>Fondateurs (un par ligne)</label>
      <textarea class="input-field" id="b-fondateurs" rows="3" placeholder="Kael\nMira\nSoren">${(current.fondateurs || []).join('\n')}</textarea>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="b-description" rows="4">${current.description || ''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastionInfos()">Enregistrer</button>
  `);
}

async function saveBastionInfos() {
  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  const fondateursRaw = document.getElementById('b-fondateurs')?.value || '';
  const fondateurs = fondateursRaw.split('\n').map((f) => f.trim()).filter(Boolean);

  await saveDoc('bastion', 'main', {
    ...current,
    nom: document.getElementById('b-nom')?.value?.trim() || 'Le Bastion',
    tresor: parseInt(document.getElementById('b-tresor')?.value, 10) || 0,
    defense: parseInt(document.getElementById('b-defense')?.value, 10) || 0,
    activite: document.getElementById('b-activite')?.value?.trim() || '',
    pnj: document.getElementById('b-pnj')?.value?.trim() || '',
    fondateurs,
    description: document.getElementById('b-description')?.value || '',
  });

  closeModal();
  showNotif('Bastion mis à jour.', 'success');
  await PAGES.bastion();
}

// ── Débloquer une amélioration ───────────────────────────────────────────────
async function debloquerAmelioration(id) {
  const amelio = BASTION_AMELIORATIONS.find((a) => a.id === id);
  if (!amelio) return;

  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();

  if ((current.tresor || 0) < amelio.cout) {
    showNotif(`Fonds insuffisants. Il faut ${amelio.cout} or.`, 'error');
    return;
  }

  openModal(`${amelio.emoji} Débloquer — ${amelio.nom}`, `
    <p style="color:var(--text-muted);margin-bottom:1.2rem;line-height:1.6">${amelio.detail}</p>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:1.2rem;display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-muted)">Coût de l'amélioration</span>
      <span style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--gold)">${amelio.cout} or</span>
    </div>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:1.5rem;display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-muted)">Trésor actuel</span>
      <span style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--green)">${current.tresor || 0} or</span>
    </div>
    <button class="btn btn-gold" style="width:100%" onclick="confirmDebloquer('${id}')">Confirmer l'investissement</button>
  `);
}

async function confirmDebloquer(id) {
  const amelio = BASTION_AMELIORATIONS.find((a) => a.id === id);
  if (!amelio) return;

  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  const amelios = { ...(current.ameliorations || {}), [id]: true };
  const nbAmelios = Object.values(amelios).filter(Boolean).length;

  await saveDoc('bastion', 'main', {
    ...current,
    ameliorations: amelios,
    tresor: (current.tresor || 0) - amelio.cout,
    niveau: 1 + nbAmelios,
  });

  closeModal();
  showNotif(`${amelio.nom} débloquée ! Le Bastion monte au niveau ${1 + nbAmelios}.`, 'success');
  await PAGES.bastion();
}

// ── Tirer un événement ───────────────────────────────────────────────────────
async function tirerEvenement() {
  const idx = Math.floor(Math.random() * 6);
  const evt = BASTION_EVENTS[idx];

  const current = (await getDocData('bastion', 'main')) || getDefaultBastion();
  const { brut, fondateurs, reinvesti } = calculerRevenuBastion({
    ...current,
    evenementCourant: evt.id,
  });

  // Ajouter à l'historique
  const historique = current.historique || [];
  historique.push({ session: historique.length + 1, brut, reinvesti, evenement: evt.nom });
  if (historique.length > 20) historique.shift(); // garder 20 entrées max

  await saveDoc('bastion', 'main', {
    ...current,
    evenementCourant: evt.id,
    tresor: (current.tresor || 0) + reinvesti,
    historique,
  });

  showNotif(`${evt.emoji} ${evt.nom} — ${evt.effet}. +${reinvesti} or réinvesti dans le trésor.`, 'success');
  await PAGES.bastion();
}

// ── Journal ──────────────────────────────────────────────────────────────────
function addBastionLog() {
  openModal('📝 Ajouter une entrée au journal', `
    <div class="form-group">
      <label>Date</label>
      <input class="input-field" id="bastion-log-date" value="${new Date().toLocaleDateString('fr-FR')}">
    </div>
    <div class="form-group">
      <label>Texte</label>
      <textarea class="input-field" id="bastion-log-text" rows="5"></textarea>
    </div>
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

// ── Exports globaux ──────────────────────────────────────────────────────────
// Les constantes sont exposées sur window pour que pages.js puisse les lire
// sans import dynamique (architecture existante du projet).
Object.assign(window, {
  // Constantes (utilisées dans le rendu pages.js)
  BASTION_AMELIORATIONS,
  BASTION_EVENTS,
  calculerRevenuBastion,
  // Actions
  getDefaultBastion,
  editBastion,
  saveBastionInfos,
  debloquerAmelioration,
  confirmDebloquer,
  tirerEvenement,
  addBastionLog,
  saveBastionLog,
  // Compat legacy
  saveBastion: saveBastionInfos,
});
