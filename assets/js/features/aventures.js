// ══════════════════════════════════════════════
// AVENTURES — Page de gestion (admin)
// ══════════════════════════════════════════════

import { STATE, setAdventures, setAdventure } from '../core/state.js';
import { openModal, closeModal }              from '../shared/modal.js';
import { showNotif }                          from '../shared/notifications.js';
import { _esc }                               from '../shared/html.js';
import {
  createAdventure,
  updateAdventureMeta,
  deleteAdventure,
  addPlayerToAdventure,
  removePlayerFromAdventure,
  promoteToAdmin,
  loadAllUsers,
  loadUserAdventures,
  selectAdventure,
} from '../core/adventure.js';
import { navigate } from '../core/navigation.js';

// ── Page principale ────────────────────────────
async function renderAventuresPage() {
  const content = document.getElementById('main-content');
  if (!content) return;

  const adventures = STATE.adventures;
  const uid        = STATE.user?.uid;

  let html = `<div class="page-header">
    <h1 class="page-title">🗺️ Aventures</h1>
    ${STATE.isSuperAdmin ? `<button class="btn btn-gold" onclick="openCreateAdventureModal()">+ Nouvelle aventure</button>` : ''}
  </div>`;

  if (adventures.length === 0) {
    html += `<div class="cs-empty">Aucune aventure disponible.</div>`;
  } else {
    html += `<div class="adv-manage-list">`;
    for (const adv of adventures) {
      const isAdvAdmin = adv.admins?.includes(uid);
      const isCurrent  = STATE.adventure?.id === adv.id;
      html += _renderAdventureCard(adv, isAdvAdmin, isCurrent);
    }
    html += `</div>`;
  }

  content.innerHTML = html;
}

function _renderAdventureCard(adv, isAdvAdmin, isCurrent) {
  const members  = (adv.accessList || []).length;
  const adminCnt = (adv.admins    || []).length;
  return `
  <div class="adv-manage-card ${isCurrent ? 'adv-manage-card--active' : ''}">
    <div class="adv-manage-card-hdr">
      <span class="adv-manage-emoji">${adv.emoji || '⚔️'}</span>
      <div class="adv-manage-info">
        <span class="adv-manage-nom">${_esc(adv.nom)}</span>
        <span class="adv-manage-meta">👥 ${members} membre${members>1?'s':''} · ⚙️ ${adminCnt} MJ</span>
      </div>
      <div class="adv-manage-actions">
        ${isCurrent
          ? `<span class="adv-badge-active">Actuelle</span>`
          : `<button class="btn btn-outline btn-sm" onclick="window.pickAdventure('${adv.id}')">Rejoindre</button>`}
        ${isAdvAdmin ? `<button class="btn btn-outline btn-sm" onclick="openManageAdventureModal('${adv.id}')">⚙️ Gérer</button>` : ''}
      </div>
    </div>
    ${adv.description ? `<p class="adv-manage-desc">${_esc(adv.description)}</p>` : ''}
  </div>`;
}

// ── Modal création d'aventure ──────────────────
export function openCreateAdventureModal() {
  const EMOJIS = ['⚔️','🏰','🗺️','🐉','🌙','🔮','🌊','🔥','🌿','⚡','🧙','🏴'];
  openModal('✨ Nouvelle aventure', `
    <div style="display:flex;flex-direction:column;gap:.85rem">
      <div class="form-group">
        <label>Nom de l'aventure *</label>
        <input type="text" id="adv-nom" placeholder="Ex : La Chute des Dieux" maxlength="60"
          style="width:100%;padding:.6rem .8rem;border-radius:10px;border:1px solid var(--border);
          background:var(--bg-elevated);color:var(--text);font-size:.9rem">
      </div>
      <div class="form-group">
        <label>Emoji</label>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${EMOJIS.map(e => `<button type="button" class="adv-emoji-btn"
            onclick="this.closest('.modal').querySelectorAll('.adv-emoji-btn').forEach(b=>b.classList.remove('selected'));this.classList.add('selected');document.getElementById('adv-emoji').value='${e}'"
            style="font-size:1.4rem;background:var(--bg-elevated);border:1px solid var(--border);
            border-radius:8px;width:2.4rem;height:2.4rem;cursor:pointer">${e}</button>`).join('')}
          <input type="hidden" id="adv-emoji" value="⚔️">
        </div>
      </div>
      <div class="form-group">
        <label>Description (optionnel)</label>
        <textarea id="adv-desc" rows="2" placeholder="Un court résumé de l'aventure…"
          style="width:100%;padding:.6rem .8rem;border-radius:10px;border:1px solid var(--border);
          background:var(--bg-elevated);color:var(--text);font-size:.88rem;resize:vertical"></textarea>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.4rem">
        <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
        <button class="btn btn-gold btn-sm" onclick="window._doCreateAdventure()">Créer</button>
      </div>
    </div>
  `);
}

window._doCreateAdventure = async () => {
  const nom   = document.getElementById('adv-nom')?.value?.trim();
  const emoji = document.getElementById('adv-emoji')?.value || '⚔️';
  const desc  = document.getElementById('adv-desc')?.value?.trim() || '';

  if (!nom) { showNotif('Donne un nom à ton aventure.', 'error'); return; }

  try {
    const adv = await createAdventure({ nom, emoji, description: desc });
    closeModal();
    showNotif(`Aventure "${nom}" créée !`, 'success');
    // Rafraîchir la liste
    const adventures = await loadUserAdventures(STATE.user.uid);
    setAdventures(adventures);
    renderAventuresPage();
  } catch (e) {
    showNotif(e.message || 'Erreur lors de la création.', 'error');
  }
};

const _ADV_EMOJIS = ['⚔️','🏰','🗺️','🐉','🌙','🔮','🌊','🔥','🌿','⚡','🧙','🏴'];

// ── Modal gestion d'une aventure (membres + infos) ──────
export async function openManageAdventureModal(adventureId) {
  const adv = STATE.adventures.find(a => a.id === adventureId);
  if (!adv) return;

  const allUsers = await loadAllUsers();
  const admins   = adv.admins   || [];
  const players  = adv.players  || [];
  const access   = adv.accessList || [];

  const _userLine = (u, isAdmin) => {
    const isCreator = u.uid === adv.createdBy;
    return `<div class="adv-member-row" id="mbr-${u.uid}">
      <span class="adv-member-pseudo">${_esc(u.pseudo || u.email)}</span>
      ${isAdmin ? '<span class="adv-role adv-role--mj">MJ</span>' : '<span class="adv-role adv-role--joueur">Joueur</span>'}
      <div class="adv-member-actions">
        ${!isAdmin && !isCreator ? `<button class="btn-icon" title="Promouvoir MJ" onclick="window._advPromote('${adventureId}','${u.uid}')">⬆️</button>` : ''}
        ${!isCreator ? `<button class="btn-icon" title="Retirer" style="color:#ff6b6b" onclick="window._advRemove('${adventureId}','${u.uid}')">✕</button>` : ''}
      </div>
    </div>`;
  };

  const memberLines = [
    ...allUsers.filter(u => admins.includes(u.uid)).map(u => _userLine(u, true)),
    ...allUsers.filter(u => players.includes(u.uid)).map(u => _userLine(u, false)),
  ];

  const nonMembers = allUsers.filter(u => !access.includes(u.uid));
  const currentEmoji = adv.emoji || '⚔️';

  openModal(`⚙️ Gérer — ${currentEmoji} ${adv.nom}`, `
    <div style="display:flex;flex-direction:column;gap:1.1rem">

      <!-- Infos de l'aventure -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.5rem">INFOS DE L'AVENTURE</div>
        <div style="display:flex;flex-direction:column;gap:.6rem">
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            ${_ADV_EMOJIS.map(e => `<button type="button" class="adv-emoji-btn ${e === currentEmoji ? 'selected' : ''}"
              onclick="this.closest('.modal-body,div').querySelectorAll('.adv-emoji-btn').forEach(b=>b.classList.remove('selected'));this.classList.add('selected');document.getElementById('adv-edit-emoji').value='${e}'"
              style="font-size:1.4rem;background:var(--bg-elevated);border:2px solid ${e === currentEmoji ? 'var(--gold)' : 'var(--border)'};
              border-radius:8px;width:2.4rem;height:2.4rem;cursor:pointer">${e}</button>`).join('')}
            <input type="hidden" id="adv-edit-emoji" value="${currentEmoji}">
          </div>
          <input type="text" id="adv-edit-nom" value="${_esc(adv.nom)}" maxlength="60"
            style="width:100%;padding:.55rem .8rem;border-radius:10px;border:1px solid var(--border);
            background:var(--bg-elevated);color:var(--text);font-size:.9rem">
          <textarea id="adv-edit-desc" rows="2"
            style="width:100%;padding:.55rem .8rem;border-radius:10px;border:1px solid var(--border);
            background:var(--bg-elevated);color:var(--text);font-size:.85rem;resize:vertical"
            placeholder="Description (optionnel)">${_esc(adv.description || '')}</textarea>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-gold btn-sm" onclick="window._advSaveMeta('${adventureId}')">💾 Enregistrer</button>
          </div>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--border);margin:0">

      <!-- Membres -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.4rem">MEMBRES (${access.length})</div>
        <div id="adv-members-list" style="display:flex;flex-direction:column;gap:.3rem">
          ${memberLines.join('') || '<div style="color:var(--text-dim);font-size:.82rem">Aucun membre</div>'}
        </div>
      </div>

      ${nonMembers.length ? `<div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.4rem">AJOUTER UN JOUEUR</div>
        <div style="display:flex;gap:.4rem;align-items:center">
          <select id="adv-add-user" style="flex:1;padding:.5rem .7rem;border-radius:9px;
            border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.85rem">
            ${nonMembers.map(u => `<option value="${u.uid}">${_esc(u.pseudo || u.email)}</option>`).join('')}
          </select>
          <button class="btn btn-gold btn-sm" onclick="window._advAdd('${adventureId}')">Ajouter</button>
        </div>
      </div>` : ''}

      ${STATE.isSuperAdmin ? `
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div>
        <div style="font-size:.78rem;font-weight:600;color:#ff6b6b;margin-bottom:.4rem">ZONE DANGEREUSE</div>
        <div id="adv-delete-confirm" style="display:none;background:rgba(255,107,107,.08);border:1px solid #ff6b6b44;
          border-radius:10px;padding:.7rem .9rem;margin-bottom:.5rem;font-size:.85rem;color:var(--text)">
          ⚠️ Supprimer <strong>${_esc(adv.nom)}</strong> et toutes ses données ?
          Cette action est <strong>irréversible</strong>.
          <div style="display:flex;gap:.4rem;margin-top:.6rem">
            <button class="btn btn-sm" style="background:#ff6b6b;color:#fff;border:none"
              onclick="window._advDelete('${adventureId}')">Oui, supprimer définitivement</button>
            <button class="btn btn-outline btn-sm"
              onclick="document.getElementById('adv-delete-confirm').style.display='none'">Annuler</button>
          </div>
        </div>
        <button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:#ff6b6b44"
          onclick="document.getElementById('adv-delete-confirm').style.display='block';this.style.display='none'">
          🗑️ Supprimer l'aventure
        </button>
      </div>` : ''}

      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-outline btn-sm" onclick="closeModal()">Fermer</button>
      </div>
    </div>
  `);
}

window._advSaveMeta = async (advId) => {
  const nom   = document.getElementById('adv-edit-nom')?.value?.trim();
  const emoji = document.getElementById('adv-edit-emoji')?.value || '⚔️';
  const desc  = document.getElementById('adv-edit-desc')?.value?.trim() || '';

  if (!nom) { showNotif('Le nom ne peut pas être vide.', 'error'); return; }

  try {
    await updateAdventureMeta(advId, { nom, emoji, description: desc });
    const adventures = await loadUserAdventures(STATE.user.uid);
    setAdventures(adventures);
    showNotif('Aventure mise à jour.', 'success');
    closeModal();
    renderAventuresPage();
  } catch (e) { showNotif(e.message, 'error'); }
};

window._advDelete = async (advId) => {
  try {
    await deleteAdventure(advId);
    closeModal();
    showNotif('Aventure supprimée.', 'success');
    // Si c'était l'aventure courante, retourner au picker
    const adventures = STATE.adventures; // déjà mis à jour par deleteAdventure
    if (adventures.length === 0) {
      const { showAdventurePicker } = await import('../core/layout.js');
      showAdventurePicker([]);
    } else {
      renderAventuresPage();
    }
  } catch (e) { showNotif(e.message, 'error'); }
};

window._advAdd = async (advId) => {
  const uid = document.getElementById('adv-add-user')?.value;
  if (!uid) return;
  try {
    await addPlayerToAdventure(advId, uid);
    const adventures = await loadUserAdventures(STATE.user.uid);
    setAdventures(adventures);
    showNotif('Joueur ajouté.', 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
};

window._advRemove = async (advId, targetUid) => {
  try {
    await removePlayerFromAdventure(advId, targetUid);
    const adventures = await loadUserAdventures(STATE.user.uid);
    setAdventures(adventures);
    showNotif('Joueur retiré.', 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
};

window._advPromote = async (advId, targetUid) => {
  try {
    await promoteToAdmin(advId, targetUid);
    const adventures = await loadUserAdventures(STATE.user.uid);
    setAdventures(adventures);
    showNotif('Joueur promu MJ.', 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
};



// ── Enregistrement de la page ──────────────────
import PAGES from './pages.js';
PAGES['aventures'] = renderAventuresPage;

// Supprimer le pickAdventure de aventures.js (défini dans init.js pour être disponible tôt)
// Exposer la modal de création pour le lazy-load
window._openCreateAdventureModalImpl = openCreateAdventureModal;
Object.assign(window, { openManageAdventureModal });
