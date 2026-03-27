// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// Admin uniquement : ajouter, modifier, supprimer
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, saveToCollection, deleteFromCollection } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

const CATS = [
  { id: 'epique',   label: '⚔️ Épique'   },
  { id: 'comique',  label: '🎭 Comique'  },
  { id: 'histoire', label: '📖 Histoire' },
];

// ── Ouvrir le modal d'ajout ──────────────────────────────────────────────────
function openAchievementModal(id = null) {
  // Si édition, pré-remplir
  const existing = id
    ? (window._achItems || []).find(a => a.id === id)
    : null;

  openModal(
    id ? `✏️ Modifier — ${existing?.titre || 'Haut-Fait'}` : '🏆 Nouveau Haut-Fait',
    `
    <div class="form-group">
      <label>Catégorie</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap" id="ach-cat-picker">
        ${CATS.map(c => `
          <button type="button"
            onclick="window._achSelectCat('${c.id}')"
            id="ach-cat-${c.id}"
            style="
              padding:0.4rem 0.9rem;border-radius:999px;font-size:0.8rem;cursor:pointer;
              border:1px solid ${existing?.categorie === c.id ? 'var(--gold)' : 'var(--border)'};
              background:${existing?.categorie === c.id ? 'rgba(232,184,75,0.12)' : 'transparent'};
              color:${existing?.categorie === c.id ? 'var(--gold)' : 'var(--text-muted)'};
              transition:all 0.15s;
            "
          >${c.label}</button>
        `).join('')}
      </div>
      <input type="hidden" id="ach-categorie" value="${existing?.categorie || 'epique'}">
    </div>

    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="ach-titre" value="${existing?.titre || ''}" placeholder="ex: L'œuf de Dragon">
    </div>

    <div class="form-group">
      <label>Description <span style="font-size:0.75rem;color:var(--text-dim)">(visible par les joueurs)</span></label>
      <textarea class="input-field" id="ach-desc" rows="3" placeholder="Ce qui s'est passé, en une ou deux phrases percutantes.">${existing?.description || ''}</textarea>
    </div>

    <div class="form-group">
      <label>URL de l'image</label>
      <input class="input-field" id="ach-image" value="${existing?.imageUrl || ''}" placeholder="https://...">
      <div style="font-size:0.73rem;color:var(--text-dim);margin-top:4px">Hébergez vos images sur Imgur ou Cloudinary.</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
      <div class="form-group">
        <label>Emoji (si pas d'image)</label>
        <input class="input-field" id="ach-emoji" value="${existing?.emoji || '🏆'}" style="font-size:1.2rem">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="input-field" id="ach-date" value="${existing?.date || new Date().toLocaleDateString('fr-FR')}" placeholder="Session 1">
      </div>
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="window.saveAchievement('${id || ''}')">
      ${id ? 'Enregistrer les modifications' : 'Créer le Haut-Fait'}
    </button>
    `
  );

  // Initialiser la sélection de catégorie au bon état
  window._achSelectCat = (catId) => {
    document.getElementById('ach-categorie').value = catId;
    CATS.forEach(c => {
      const btn = document.getElementById(`ach-cat-${c.id}`);
      if (!btn) return;
      const active = c.id === catId;
      btn.style.borderColor = active ? 'var(--gold)' : 'var(--border)';
      btn.style.background  = active ? 'rgba(232,184,75,0.12)' : 'transparent';
      btn.style.color       = active ? 'var(--gold)' : 'var(--text-muted)';
    });
  };

  // Sélectionner la catégorie par défaut
  window._achSelectCat(existing?.categorie || 'epique');
}

// ── Sauvegarder ──────────────────────────────────────────────────────────────
async function saveAchievement(id = '') {
  const titre = document.getElementById('ach-titre')?.value?.trim();
  if (!titre) { showNotif('Le titre est requis.', 'error'); return; }

  const payload = {
    titre,
    categorie:   document.getElementById('ach-categorie')?.value || 'epique',
    description: document.getElementById('ach-desc')?.value?.trim()  || '',
    imageUrl:    document.getElementById('ach-image')?.value?.trim() || '',
    emoji:       document.getElementById('ach-emoji')?.value?.trim() || '🏆',
    date:        document.getElementById('ach-date')?.value?.trim()  || '',
  };

  const docId = id || `ach_${Date.now()}`;
  await saveToCollection('achievements', { id: docId, ...payload });

  // Mettre à jour le cache local si présent
  if (window._achItems) {
    if (id) {
      window._achItems = window._achItems.map(a => a.id === id ? { id: docId, ...payload } : a);
    } else {
      window._achItems.push({ id: docId, ...payload });
    }
  }

  closeModal();
  showNotif(id ? 'Haut-Fait mis à jour.' : `"${titre}" ajouté !`, 'success');
  await PAGES.achievements();
}

// ── Éditer ────────────────────────────────────────────────────────────────────
async function editAchievement(id) {
  // Charger si besoin
  if (!window._achItems) {
    window._achItems = await loadCollection('achievements');
  }
  openAchievementModal(id);
}

// ── Supprimer ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  if (!confirm('Supprimer ce haut-fait définitivement ?')) return;
  await deleteFromCollection('achievements', id);
  if (window._achItems) {
    window._achItems = window._achItems.filter(a => a.id !== id);
  }
  showNotif('Haut-Fait supprimé.', 'success');
  await PAGES.achievements();
}

// ── Override de loadCollection pour cacher le cache ──────────────────────────
// pages.js appelle loadCollection directement ; on garde un cache ici
// pour que editAchievement puisse pré-remplir le modal sans re-fetch.
const _origAchPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  // On recharge depuis Firestore à chaque navigation — pas de cache périmé
  window._achItems = await loadCollection('achievements');
  return _origAchPage();
};

// ── Exports globaux ───────────────────────────────────────────────────────────
Object.assign(window, {
  openAchievementModal,
  saveAchievement,
  editAchievement,
  deleteAchievement,
});
