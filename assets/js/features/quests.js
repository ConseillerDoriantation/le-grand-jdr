// ══════════════════════════════════════════════
// QUESTS.JS — Quêtes
// Admin : créer / modifier / supprimer des quêtes
// Joueur : voir les quêtes actives et y participer avec son personnage
// ══════════════════════════════════════════════
import { addToCol, saveDoc, deleteFromCol } from '../data/firestore.js';
import { registerActions } from '../core/actions.js';
import { watch } from '../shared/realtime.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, appSplashHtml, pageHeaderHtml} from '../shared/html.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { listPlaces } from './map/data/places.repo.js';

// ── Constantes ────────────────────────────────
const DIFF = [
  { id: 'facile',    label: 'Facile',    color: '#22c38e' },
  { id: 'moyen',     label: 'Moyen',     color: '#4f8cff' },
  { id: 'difficile', label: 'Difficile', color: '#e8b84b' },
  { id: 'extreme',   label: 'Extrême',   color: '#ff6b6b' },
];
const STATUT = [
  { id: 'active',   label: 'Active',   color: '#4f8cff' },
  { id: 'terminee', label: 'Terminée', color: '#22c38e' },
  { id: 'echouee',  label: 'Échouée',  color: '#ff6b6b' },
];

const _diff   = id => DIFF.find(d => d.id === id)   || DIFF[1];
const _statut = id => STATUT.find(s => s.id === id) || STATUT[0];


const STORE = {
  chars: null,   // personnages chargés
  places: [],     // [{ id, name }] — autocomplete Lieu
  questItems: [],
  questMyChar: null,
  questMyChars: [],
};

function _questRequiredCount(q = {}) {
  const n = parseInt(q.participantsRequis ?? q.participantsRequired ?? q.nbParticipants ?? 0, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── Mini portrait d'un participant ────────────
function _portrait(p, size = 28) {
  const pos = `${50 + (p.photoX || 0) * 50}% ${50 + (p.photoY || 0) * 50}%`;
  if (p.photo) {
    return `<img src="${p.photo}" title="${_esc(p.nom || '?')}"
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;
             object-position:${pos};border:2px solid var(--bg-card);flex-shrink:0">`;
  }
  return `<div title="${_esc(p.nom || '?')}" style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:rgba(79,140,255,.18);border:2px solid var(--bg-card);
    flex-shrink:0;display:flex;align-items:center;justify-content:center;
    font-family:'Cinzel',serif;font-size:${Math.round(size * .4)}px;
    font-weight:700;color:var(--gold)">${(p.nom || '?')[0].toUpperCase()}</div>`;
}

// ── Carte quête ───────────────────────────────
function _questCard(q, myChar) {
  const df    = _diff(q.difficulte);
  const st    = _statut(q.statut);
  const parts = Array.isArray(q.participants) ? q.participants : [];
  const required = _questRequiredCount(q);
  const uid   = STATE.user?.uid;
  const joined = myChar ? parts.some(p => p.uid === uid) : false;
  const partsLabel = `${parts.length} intéressé${parts.length > 1 ? 's' : ''}${required ? ` · ${required} requis` : ''}`;

  const partsHtml = parts.length > 0
    ? `<div class="quest-parts">
        ${parts.map(p => _portrait(p, 28)).join('')}
        <span class="quest-parts-count">${partsLabel}</span>
       </div>`
    : `<div class="quest-parts-empty">${required ? `0 intéressé · ${required} requis` : 'Aucun intéressé'}</div>`;

  const joinBtn = (!STATE.isAdmin && myChar && q.statut === 'active') ? `
    <button class="quest-join-btn${joined ? ' quest-join-btn--joined' : ''}"
      data-action="_questToggleJoin" data-id="${q.id}">
      ${joined ? '✓ Rejoint' : '+ Rejoindre'}
    </button>` : '';

  const adminBtns = STATE.isAdmin ? `
    <button class="quest-icon-btn" data-action="_questEdit" data-id="${q.id}" title="Modifier">✏️</button>
    <button class="quest-icon-btn quest-icon-btn--del" data-action="_questDelete" data-id="${q.id}" title="Supprimer">🗑️</button>
  ` : '';

  return `
  <div class="quest-card${q.statut === 'active' ? ' quest-card--active' : ''}">
    <div class="quest-card-hd">
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;flex:1;min-width:0">
        <span class="quest-badge" style="background:${df.color}22;color:${df.color};border-color:${df.color}44">${df.label}</span>
        <span class="quest-badge" style="background:${st.color}22;color:${st.color};border-color:${st.color}44">${st.label}</span>
      </div>
      <div style="display:flex;gap:.3rem;align-items:center;flex-shrink:0">
        ${joinBtn}${adminBtns}
      </div>
    </div>
    <div class="quest-card-title">${_esc(q.titre || 'Quête')}</div>
    ${q.description ? `<div class="quest-card-desc">${_esc(q.description)}</div>` : ''}
    ${q.recompense  ? `<div class="quest-reward">🎁 ${_esc(q.recompense)}</div>` : ''}
    ${q.lieu ? `<div style="font-size:.78rem;color:var(--text-dim);margin-top:.15rem">📍 ${_esc(q.lieu)}</div>` : ''}
    ${partsHtml}
  </div>`;
}

// ── Cache local pour re-renders subscription ──

// ── Rendu depuis les données (sans rechargement Firestore) ────────────────
function _applyQuestsRender(quests) {
  const content = document.getElementById('main-content');
  if (!content) return;

  const uid     = STATE.user?.uid;
  const myChars = STATE.isAdmin ? [] : (STORE.chars || []).filter(c => c.uid === uid);
  const myChar  = myChars[0] || null;

  STORE.questItems = quests;
  STORE.questMyChar = myChar;
  STORE.questMyChars = myChars;

  const sorted = [...quests].sort((a, b) => {
    const ord = { active: 0, terminee: 1, echouee: 2 };
    const sa  = ord[a.statut] ?? 1;
    const sb  = ord[b.statut] ?? 1;
    if (sa !== sb) return sa - sb;
    return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1;
  });

  const activeCount = quests.filter(q => q.statut === 'active').length;

  content.innerHTML = `
  ${pageHeaderHtml('📋 Quêtes', `${activeCount} quête${activeCount !== 1 ? 's' : ''} active${activeCount !== 1 ? 's' : ''}`)}

  ${STATE.isAdmin ? `
  <div style="margin-bottom:1.2rem">
    <button class="btn btn-gold" data-action="_questNew">+ Nouvelle quête</button>
  </div>` : ''}

  ${sorted.length === 0
    ? `<div class="empty-state"><div class="icon">📋</div><p>Aucune quête pour l'instant.</p></div>`
    : `<div class="quest-grid">${sorted.map(q => _questCard(q, myChar)).join('')}</div>`}
  `;
}

// ── Page principale ───────────────────────────
async function renderQuestsPage() {
  const content = document.getElementById('main-content');
  content.innerHTML = appSplashHtml();

  // `listPlaces` n'est pas couvert par un listener temps réel : on garde le
  // fetch initial. `quests` et `characters` sont, eux, gérés intégralement par
  // les abonnements ci-dessous → le snapshot initial fournit déjà les données,
  // pas besoin d'un loadCollection en plus (économie : 2× lectures au montage).
  STORE.places = ((await listPlaces().catch(() => [])) || [])
    .filter(p => p?.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  // Abonnements temps réel — le premier fire fait le rendu initial.
  // Avec la persistance IndexedDB, ce premier fire est servi du cache local
  // (instantané, sans lecture facturée) si la collection a déjà été vue.
  watch('quests', 'quests', data => {
    if (STATE.currentPage !== 'quests') return;
    _applyQuestsRender(data || []);
  });
  watch('quests-chars', 'characters', data => {
    if (STATE.currentPage !== 'quests') return;
    STORE.chars = data || [];
    _applyQuestsRender(STORE.questItems || []);
  });
}

// ── Toggle participation ──────────────────────
async function toggleQuestJoin(id) {
  const q   = (STORE.questItems || []).find(x => x.id === id);
  if (!q) return;

  const uid   = STATE.user?.uid;
  const parts = Array.isArray(q.participants) ? [...q.participants] : [];
  const idx   = parts.findIndex(p => p.uid === uid);

  if (idx >= 0) {
    // Quitter — pas besoin de choisir le personnage
    parts.splice(idx, 1);
    await _questSaveParts(id, parts, true);
  } else {
    // Rejoindre — sélectionner le personnage si plusieurs
    const myChars = STORE.questMyChars || [];
    if (myChars.length > 1) {
      _questOpenCharPicker(id, myChars);
    } else {
      if (!myChars[0]) return;
      await _questJoinWithChar(id, myChars[0]);
    }
  }
}

function _questOpenCharPicker(questId, chars) {
  const rows = chars.map(c => {
    const pos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
    const avatar = c.photo
      ? `<img src="${_esc(c.photo)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;object-position:${pos};flex-shrink:0">`
      : `<div style="width:38px;height:38px;border-radius:50%;background:rgba(79,140,255,.18);
           flex-shrink:0;display:flex;align-items:center;justify-content:center;
           font-family:'Cinzel',serif;font-weight:700;font-size:.9rem;color:var(--gold)">
           ${(c.nom || '?')[0].toUpperCase()}</div>`;
    const sub = [c.classe, c.race].filter(Boolean).join(' · ');
    return `<button class="btn btn-outline"
        style="display:flex;align-items:center;gap:.75rem;padding:.6rem .9rem;text-align:left;width:100%"
        data-action="_questPickChar" data-quest-id="${_esc(questId)}" data-id="${_esc(c.id)}">
        ${avatar}
        <div style="min-width:0">
          <div style="font-weight:700;font-size:.88rem;color:var(--text)">${_esc(c.nom || '?')}</div>
          ${sub ? `<div style="font-size:.72rem;color:var(--text-dim)">${_esc(sub)}</div>` : ''}
        </div>
      </button>`;
  }).join('');

  openModal('Quel personnage rejoint cette quête ?', `
    <div style="display:flex;flex-direction:column;gap:.45rem">${rows}</div>
    <div style="margin-top:.75rem;text-align:right">
      <button class="btn btn-outline btn-sm" data-action="_questCloseModal">Annuler</button>
    </div>`);
}

async function pickQuestChar(questId, charId) {
  closeModal();
  const char = (STORE.questMyChars || []).find(c => c.id === charId);
  if (!char) return;
  await _questJoinWithChar(questId, char);
}

async function _questJoinWithChar(id, char) {
  const q   = (STORE.questItems || []).find(x => x.id === id);
  if (!q) return;
  const uid   = STATE.user?.uid;
  const parts = Array.isArray(q.participants) ? [...q.participants] : [];
  parts.push({
    uid,
    charId: char.id,
    nom:    char.nom    || '?',
    photo:  char.photo  || null,
    photoX: char.photoX || 0,
    photoY: char.photoY || 0,
  });
  await _questSaveParts(id, parts, false);
}

async function _questSaveParts(id, parts, leaving) {
  try {
    await saveDoc('quests', id, { participants: parts });
    showNotif(leaving ? 'Tu as quitté cette quête.' : 'Tu as rejoint cette quête !', leaving ? 'info' : 'success');
    // La subscription temps réel met à jour l'affichage automatiquement
  } catch {
    showNotif('Erreur lors de la mise à jour.', 'error');
  }
}

// ── Modales admin ─────────────────────────────
function newQuest() { _openQuestModal(null); }
export function editQuest(id) { _openQuestModal(id); }

function _openQuestModal(id) {
  const ex = id ? (STORE.questItems || []).find(q => q.id === id) : null;

  openModal(
    id ? `✏️ Modifier — ${_esc(ex?.titre || 'Quête')}` : '📋 Nouvelle Quête',
    `
    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="q-titre" value="${_esc(ex?.titre || '')}" placeholder="ex: La Tour Maudite">
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="q-desc" rows="3" placeholder="Détails de la mission...">${_esc(ex?.description || '')}</textarea>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(112px,140px);gap:.75rem;align-items:end">
      <div class="form-group">
        <label>Récompense</label>
        <input class="input-field" id="q-recompense" value="${_esc(ex?.recompense || '')}" placeholder="ex: 300 XP + 50 or">
      </div>
      <div class="form-group">
        <label>Participants requis <span style="color:var(--text-dim);font-weight:400">(objectif)</span></label>
        <input class="input-field" id="q-participants-requis" type="number" min="0" step="1"
          value="${_questRequiredCount(ex)}" placeholder="ex: 4">
      </div>
    </div>
    <div class="form-group">
      <label>Lieu <span style="color:var(--text-dim);font-weight:400">(optionnel — relie la quête à la carte)</span></label>
      <input class="input-field" id="q-lieu" list="q-lieu-options" value="${_esc(ex?.lieu || '')}" placeholder="ex: Valdoran" autocomplete="off">
      <datalist id="q-lieu-options">
        ${STORE.places.map(p => `<option value="${_esc(p.name)}"></option>`).join('')}
      </datalist>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="form-group">
        <label>Difficulté</label>
        <select class="input-field" id="q-difficulte">
          ${DIFF.map(d => `<option value="${d.id}"${(ex?.difficulte || 'moyen') === d.id ? ' selected' : ''}>${d.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Statut</label>
        <select class="input-field" id="q-statut">
          ${STATUT.map(s => `<option value="${s.id}"${(ex?.statut || 'active') === s.id ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:.6rem;margin-top:.5rem">
      <button class="btn btn-gold" data-action="_questSave" data-id="${id || ''}">
        ${id ? 'Enregistrer' : 'Créer la quête'}
      </button>
      <button class="btn btn-secondary" data-action="_questCloseModal">Annuler</button>
    </div>
    `
  );
}

async function saveQuest(id) {
  const titre      = document.getElementById('q-titre')?.value.trim();
  const desc       = document.getElementById('q-desc')?.value.trim();
  const recompense = document.getElementById('q-recompense')?.value.trim();
  const lieu       = document.getElementById('q-lieu')?.value.trim();
  const requisRaw  = parseInt(document.getElementById('q-participants-requis')?.value, 10);
  const participantsRequis = Number.isFinite(requisRaw) && requisRaw > 0 ? requisRaw : 0;
  const difficulte = document.getElementById('q-difficulte')?.value;
  const statut     = document.getElementById('q-statut')?.value;

  if (!titre) { showNotif('Le titre est obligatoire.', 'error'); return; }

  const data = {
    titre,
    description: desc || '',
    recompense: recompense || '',
    lieu: lieu || '',
    participantsRequis,
    difficulte,
    statut,
  };

  try {
    if (id) {
      await saveDoc('quests', id, data);
      showNotif('Quête mise à jour.', 'success');
    } else {
      await addToCol('quests', { ...data, participants: [] });
      showNotif('Quête créée !', 'success');
    }
    closeModal();
    // La subscription temps réel met à jour l'affichage automatiquement
  } catch {
    showNotif('Erreur lors de l\'enregistrement.', 'error');
  }
}

async function deleteQuest(id) {
  const q = (STORE.questItems || []).find(x => x.id === id);
  if (!confirm(`Supprimer la quête "${q?.titre || id}" ?`)) return;
  try {
    await deleteFromCol('quests', id);
    showNotif('Quête supprimée.', 'info');
    // La subscription temps réel met à jour l'affichage automatiquement
  } catch {
    showNotif('Erreur lors de la suppression.', 'error');
  }
}

// ── Enregistrement dans PAGES ─────────────────
PAGES.quests = renderQuestsPage;

registerActions({
  _questToggleJoin: (btn) => toggleQuestJoin(btn.dataset.id),
  _questEdit:       (btn) => editQuest(btn.dataset.id),
  _questDelete:     (btn) => deleteQuest(btn.dataset.id),
  _questNew:        ()    => newQuest(),
  _questPickChar:   (btn) => pickQuestChar(btn.dataset.questId, btn.dataset.id),
  _questSave:       (btn) => saveQuest(btn.dataset.id || null),
  _questCloseModal: ()    => closeModal(),
});
