// ══════════════════════════════════════════════
// QUESTS.JS — Quêtes
// Admin : créer / modifier / supprimer des quêtes
// Joueur : voir les quêtes actives et y participer avec son personnage
// ══════════════════════════════════════════════
import { loadCollection, addToCol, saveDoc, deleteFromCol, invalidateCache } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

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
  const uid   = STATE.user?.uid;
  const joined = myChar ? parts.some(p => p.uid === uid) : false;

  const partsHtml = parts.length > 0
    ? `<div class="quest-parts">
        ${parts.map(p => _portrait(p, 28)).join('')}
        <span class="quest-parts-count">${parts.length} participant${parts.length > 1 ? 's' : ''}</span>
       </div>`
    : `<div class="quest-parts-empty">Aucun participant</div>`;

  const joinBtn = (!STATE.isAdmin && myChar && q.statut === 'active') ? `
    <button class="quest-join-btn${joined ? ' quest-join-btn--joined' : ''}"
      onclick="window._questToggleJoin('${q.id}')">
      ${joined ? '✓ Rejoint' : '+ Rejoindre'}
    </button>` : '';

  const adminBtns = STATE.isAdmin ? `
    <button class="quest-icon-btn" onclick="window._questEdit('${q.id}')" title="Modifier">✏️</button>
    <button class="quest-icon-btn quest-icon-btn--del" onclick="window._questDelete('${q.id}')" title="Supprimer">🗑️</button>
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
    ${partsHtml}
  </div>`;
}

// ── Page principale ───────────────────────────
async function renderQuestsPage() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Chargement…</div>`;

  const uid = STATE.user?.uid;
  const [quests, chars] = await Promise.all([
    loadCollection('quests').catch(() => []),
    loadCollection('characters').catch(() => []),
  ]);

  // Premier personnage appartenant au joueur
  const myChar = STATE.isAdmin ? null : (chars.find(c => c.uid === uid) || null);

  // Tri : actives → terminées → échouées, puis par date desc
  const sorted = [...quests].sort((a, b) => {
    const ord = { active: 0, terminee: 1, echouee: 2 };
    const sa  = ord[a.statut] ?? 1;
    const sb  = ord[b.statut] ?? 1;
    if (sa !== sb) return sa - sb;
    return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1;
  });

  window._questItems  = quests;
  window._questMyChar = myChar;

  const activeCount = quests.filter(q => q.statut === 'active').length;

  content.innerHTML = `
  <div class="page-header">
    <div class="page-title"><span class="page-title-accent">📋 Quêtes</span></div>
    <div class="page-subtitle">${activeCount} quête${activeCount !== 1 ? 's' : ''} active${activeCount !== 1 ? 's' : ''}</div>
  </div>

  ${STATE.isAdmin ? `
  <div style="margin-bottom:1.2rem">
    <button class="btn btn-gold" onclick="window._questNew()">+ Nouvelle quête</button>
  </div>` : ''}

  ${sorted.length === 0
    ? `<div class="empty-state"><div class="icon">📋</div><p>Aucune quête pour l'instant.</p></div>`
    : `<div class="quest-grid">${sorted.map(q => _questCard(q, myChar)).join('')}</div>`}
  `;
}

// ── Toggle participation ──────────────────────
window._questToggleJoin = async function (id) {
  const q      = (window._questItems || []).find(x => x.id === id);
  const myChar = window._questMyChar;
  if (!q || !myChar) return;

  const uid   = STATE.user?.uid;
  const parts = Array.isArray(q.participants) ? [...q.participants] : [];
  const idx   = parts.findIndex(p => p.uid === uid);

  if (idx >= 0) {
    parts.splice(idx, 1);
  } else {
    parts.push({
      uid,
      charId: myChar.id,
      nom:    myChar.nom    || '?',
      photo:  myChar.photo  || null,
      photoX: myChar.photoX || 0,
      photoY: myChar.photoY || 0,
    });
  }

  try {
    await saveDoc('quests', id, { participants: parts });
    invalidateCache('quests');
    showNotif(idx >= 0 ? 'Tu as quitté cette quête.' : 'Tu as rejoint cette quête !', idx >= 0 ? 'info' : 'success');
    await renderQuestsPage();
  } catch {
    showNotif('Erreur lors de la mise à jour.', 'error');
  }
};

// ── Modales admin ─────────────────────────────
window._questNew  = () => _openQuestModal(null);
window._questEdit = id => _openQuestModal(id);

function _openQuestModal(id) {
  const ex = id ? (window._questItems || []).find(q => q.id === id) : null;

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
    <div class="form-group">
      <label>Récompense</label>
      <input class="input-field" id="q-recompense" value="${_esc(ex?.recompense || '')}" placeholder="ex: 300 XP + 50 or">
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
      <button class="btn btn-gold" onclick="window._questSave(${id ? `'${id}'` : 'null'})">
        ${id ? 'Enregistrer' : 'Créer la quête'}
      </button>
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
    </div>
    `
  );
}

window._questSave = async function (id) {
  const titre      = document.getElementById('q-titre')?.value.trim();
  const desc       = document.getElementById('q-desc')?.value.trim();
  const recompense = document.getElementById('q-recompense')?.value.trim();
  const difficulte = document.getElementById('q-difficulte')?.value;
  const statut     = document.getElementById('q-statut')?.value;

  if (!titre) { showNotif('Le titre est obligatoire.', 'error'); return; }

  const data = { titre, description: desc || '', recompense: recompense || '', difficulte, statut };

  try {
    if (id) {
      await saveDoc('quests', id, data);
      showNotif('Quête mise à jour.', 'success');
    } else {
      await addToCol('quests', { ...data, participants: [] });
      showNotif('Quête créée !', 'success');
    }
    closeModal();
    await renderQuestsPage();
  } catch {
    showNotif('Erreur lors de l\'enregistrement.', 'error');
  }
};

window._questDelete = async function (id) {
  const q = (window._questItems || []).find(x => x.id === id);
  if (!confirm(`Supprimer la quête "${q?.titre || id}" ?`)) return;
  try {
    await deleteFromCol('quests', id);
    showNotif('Quête supprimée.', 'info');
    await renderQuestsPage();
  } catch {
    showNotif('Erreur lors de la suppression.', 'error');
  }
};

// ── Enregistrement dans PAGES ─────────────────
PAGES.quests = renderQuestsPage;
