// ══════════════════════════════════════════════
// AVENTURES — Page de gestion (admin)
// ══════════════════════════════════════════════

import { STATE, setAdventures } from '../core/state.js';
import { confirmModal } from '../shared/modal.js';
import { registerActions } from '../core/actions.js';
import { openModal, closeModal }              from '../shared/modal.js';
import { showNotif }                          from '../shared/notifications.js';
import { _esc }                               from '../shared/html.js';
import {
  createAdventure,
  updateAdventureMeta,
  deleteAdventure,
  removePlayerFromAdventure,
  removeSelfFromAdventure,
  promoteToAdmin,
  relinkPlayerAccount,
  inviteByEmail,
  cancelInvite,
  loadAllUsers,
  loadUserAdventures,
  selectAdventure,
} from '../core/adventure.js';
import { exportAdventure, importAdventure, loadCollectionWhere } from '../data/firestore.js';
import { unwatchAll } from '../shared/realtime.js';

// ── Page principale ────────────────────────────
async function renderAventuresPage() {
  const content = document.getElementById('main-content');
  if (!content) return;

  const adventures = STATE.adventures;
  const uid        = STATE.user?.uid;

  let html = `<div class="page-header">
    <h1 class="page-title">🗺️ Aventures</h1>
    <button class="btn btn-gold" data-action="openCreateAdventureModal">+ Nouvelle aventure</button>
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
  // Quitter : réservé aux membres NON créateurs (le créateur supprime l'aventure).
  const canLeave = adv.createdBy !== STATE.user?.uid;
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
          : `<button class="btn btn-outline btn-sm" data-action="pickAdventure" data-id="${adv.id}">Rejoindre</button>`}
        ${isAdvAdmin ? `<button class="btn btn-outline btn-sm" data-action="openManageAdventureModal" data-id="${adv.id}">⚙️ Gérer</button>` : ''}
        ${canLeave ? `<button class="btn btn-outline btn-sm adv-leave-btn" data-action="_advLeave" data-id="${adv.id}" title="Quitter cette aventure (supprime ton personnage)">🚪 Quitter</button>` : ''}
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
            data-action="_advPickEmoji" data-emoji="${e}" data-target-id="adv-emoji"
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
        <button class="btn btn-outline btn-sm" data-action="_advClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_doCreateAdventure">Créer</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--border);margin:.2rem 0 0">
      <div style="display:flex;flex-direction:column;gap:.35rem">
        <span style="font-size:.78rem;color:var(--text-dim)">…ou recréer une campagne supprimée depuis sa sauvegarde :</span>
        <button class="btn btn-outline btn-sm" data-action="_advCreateFromBackup" style="align-self:flex-start">
          📥 Créer depuis un backup (JSON)
        </button>
      </div>
    </div>
  `);
}

async function doCreateAdventure() {
  const nom   = document.getElementById('adv-nom')?.value?.trim();
  const emoji = document.getElementById('adv-emoji')?.value || '⚔️';
  const desc  = document.getElementById('adv-desc')?.value?.trim() || '';

  if (!nom) { showNotif('Donne un nom à ton aventure.', 'error'); return; }

  try {
    const adv = await createAdventure({ nom, emoji, description: desc });
    closeModal();
    showNotif(`Aventure "${nom}" créée !`, 'success');
    // Rafraîchir la liste
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    renderAventuresPage();
  } catch (e) {
    showNotif(e.message || 'Erreur lors de la création.', 'error');
  }
}

const _ADV_EMOJIS = ['⚔️','🏰','🗺️','🐉','🌙','🔮','🌊','🔥','🌿','⚡','🧙','🏴'];

// ── Modal gestion d'une aventure (membres + infos) ──────
export async function openManageAdventureModal(adventureId) {
  const adv = STATE.adventures.find(a => a.id === adventureId);
  if (!adv) return;

  // Noms des membres : memberProfiles (dénormalisé) suffit pour un MJ non super-admin.
  // loadAllUsers n'est utile qu'au super-admin (données cross-user + détection de
  // doublon) ; pour un MJ normal il ne ferait que N lectures users/{uid} refusées.
  const allUsers = STATE.isSuperAdmin ? await loadAllUsers(adv) : [];
  const admins   = adv.admins   || [];
  const players  = adv.players  || [];
  const access   = adv.accessList || [];
  const profiles = adv.memberProfiles || {};

  const memberUids = new Set([...access, ...players, ...admins]);
  const usersById  = new Map(allUsers.map(u => [u.id, u]));

  // Nom affichable d'un membre par uid, SANS dépendre de la lecture de users/{uid}
  // (bloquée pour un MJ non super-admin) : priorité au pseudo dénormalisé sur le doc
  // aventure (memberProfiles), puis aux users lus (super-admin / soi), puis fallback.
  const _nameFor = (uid) => {
    const p = profiles[uid];
    const denorm = typeof p === 'string' ? p : (p?.pseudo || p?.email);
    const u = usersById.get(uid);
    return denorm || u?.pseudo || u?.email || `Joueur ${uid.slice(0, 6)}…`;
  };

  // Détection des comptes en double : un MEMBRE (ancien uid) dont l'email possède
  // un AUTRE compte non-membre (nouvel uid) → proposer la réassociation. Sert au
  // cas "mdp oublié → nouvel uid → En attente d'invitation". Ne fonctionne que si on
  // a pu lire les users (super-admin) ; sinon pas de bouton relink (dégradation OK).
  const _emailToUsers = {};
  allUsers.forEach(u => { if (u.email) (_emailToUsers[u.email.toLowerCase()] ||= []).push(u); });
  const _newUidFor = (uid) => {
    const u = usersById.get(uid);
    if (!u?.email) return null;
    const dupe = (_emailToUsers[u.email.toLowerCase()] || [])
      .find(d => d.id !== uid && !memberUids.has(d.id));
    return dupe ? dupe.id : null;
  };

  const _memberLine = (uid, isAdmin) => {
    const isCreator = uid === adv.createdBy;
    const newUid    = _newUidFor(uid);
    return `<div class="adv-member-row" id="mbr-${uid}">
      <span class="adv-member-pseudo">${_esc(_nameFor(uid))}</span>
      ${isAdmin ? '<span class="adv-role adv-role--mj">MJ</span>' : '<span class="adv-role adv-role--joueur">Joueur</span>'}
      <div class="adv-member-actions">
        ${newUid ? `<button class="btn-icon" title="Réassocier au nouveau compte (changement d'identifiant : transfère accès + personnages)" style="color:#4f8cff" data-action="_advRelink" data-adv-id="${adventureId}" data-old-uid="${uid}" data-new-uid="${newUid}">🔗</button>` : ''}
        ${!isAdmin && !isCreator ? `<button class="btn-icon" title="Promouvoir MJ" data-action="_advPromote" data-adv-id="${adventureId}" data-uid="${uid}">⬆️</button>` : ''}
        ${!isCreator ? `<button class="btn-icon" title="Retirer" style="color:#ff6b6b" data-action="_advRemove" data-adv-id="${adventureId}" data-uid="${uid}">✕</button>` : ''}
      </div>
    </div>`;
  };

  // Rendu piloté par les tableaux d'uid du doc (fiables) plutôt que par les users lus.
  const playerUids = players.filter(uid => !admins.includes(uid));
  const memberLines = [
    ...admins.map(uid => _memberLine(uid, true)),
    ...playerUids.map(uid => _memberLine(uid, false)),
  ];

  // Invitations en attente : emails ajoutés à invitedEmails, pas encore acceptés.
  // On dédoublonne l'affichage (invitedEmails stocke raw+lower → on garde 1 forme
  // par email, en préférant la forme avec majuscules si présente).
  const pendingByLower = new Map();
  (adv.invitedEmails || []).forEach(e => {
    const lower = String(e).toLowerCase();
    if (!pendingByLower.has(lower) || e !== lower) pendingByLower.set(lower, e);
  });
  const pendingInvites = [...pendingByLower.values()];
  const currentEmoji = adv.emoji || '⚔️';

  openModal(`⚙️ Gérer — ${currentEmoji} ${adv.nom}`, `
    <div style="display:flex;flex-direction:column;gap:1.1rem">

      <!-- Infos de l'aventure -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.5rem">INFOS DE L'AVENTURE</div>
        <div style="display:flex;flex-direction:column;gap:.6rem">
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            ${_ADV_EMOJIS.map(e => `<button type="button" class="adv-emoji-btn ${e === currentEmoji ? 'selected' : ''}"
              data-action="_advPickEmoji" data-emoji="${e}" data-target-id="adv-edit-emoji"
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
            <button class="btn btn-gold btn-sm" data-action="_advSaveMeta" data-id="${adventureId}">💾 Enregistrer</button>
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

      <!-- Inviter par email -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.4rem">INVITER UN JOUEUR</div>
        <div style="display:flex;gap:.4rem;align-items:center">
          <input type="email" id="adv-invite-email" placeholder="email@exemple.com"
            data-enter-click="#_advInvite-${adventureId}"
            style="flex:1;padding:.5rem .7rem;border-radius:9px;border:1px solid var(--border);
            background:var(--bg-elevated);color:var(--text);font-size:.85rem">
          <button class="btn btn-gold btn-sm" id="_advInvite-${adventureId}" data-action="_advInvite" data-id="${adventureId}">Inviter</button>
        </div>
        <p style="font-size:.74rem;color:var(--text-dim);margin:.4rem 0 0">
          Le joueur reçoit une invitation à accepter à sa prochaine connexion. Il peut ne pas encore avoir de compte.
        </p>
      </div>

      ${pendingInvites.length ? `<div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.4rem">INVITATIONS EN ATTENTE (${pendingInvites.length})</div>
        <div style="display:flex;flex-direction:column;gap:.3rem">
          ${pendingInvites.map(e => `<div class="adv-member-row">
            <span class="adv-member-pseudo">${_esc(e)}</span>
            <span class="adv-role adv-role--joueur">Invité</span>
            <div class="adv-member-actions">
              <button class="btn-icon" title="Annuler l'invitation" style="color:#ff6b6b"
                data-action="_advCancelInvite" data-adv-id="${adventureId}" data-email="${_esc(e)}">✕</button>
            </div>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <hr style="border:none;border-top:1px solid var(--border);margin:0">

      <!-- Sauvegarde -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:.4rem">SAUVEGARDE</div>
        <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 .5rem">
          Backup JSON complet de la campagne (persos, récit, monde, VTT…) — filet de sécurité contre une fausse manip.
          La restauration réécrit les docs du backup <strong>sans rien supprimer</strong> et ne touche pas aux membres/permissions.
        </p>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" data-action="_advExport" data-id="${adventureId}">💾 Exporter (backup JSON)</button>
          <button class="btn btn-outline btn-sm" data-action="_advImport" data-id="${adventureId}">♻️ Restaurer (import JSON)</button>
        </div>
      </div>

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
              data-action="_advDelete" data-id="${adventureId}">Oui, supprimer définitivement</button>
            <button class="btn btn-outline btn-sm"
              data-action="_advHideDeleteConfirm">Annuler</button>
          </div>
        </div>
        <button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:#ff6b6b44"
          data-action="_advShowDeleteConfirm">
          🗑️ Supprimer l'aventure
        </button>
      </div>` : ''}

      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-outline btn-sm" data-action="_advClose">Fermer</button>
      </div>
    </div>
  `);
}

async function saveAdventureMeta(advId) {
  const nom   = document.getElementById('adv-edit-nom')?.value?.trim();
  const emoji = document.getElementById('adv-edit-emoji')?.value || '⚔️';
  const desc  = document.getElementById('adv-edit-desc')?.value?.trim() || '';

  if (!nom) { showNotif('Le nom ne peut pas être vide.', 'error'); return; }

  try {
    await updateAdventureMeta(advId, { nom, emoji, description: desc });
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    showNotif('Aventure mise à jour.', 'success');
    closeModal();
    renderAventuresPage();
  } catch (e) { showNotif(e.message, 'error'); }
}

// Backup JSON complet d'une campagne (export seul — la restauration est une étape
// dédiée). Lecture directe via firestore.js, puis téléchargement Blob (cf. bastion).
async function exportAdventureBackup(advId, btn) {
  const adv = STATE.adventures.find(a => a.id === advId);
  const label = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Export en cours…'; }
  try {
    const payload = await exportAdventure(advId);
    const total = Object.values(payload.collections).reduce((n, arr) => n + arr.length, 0);
    const slug = (adv?.nom || 'campagne')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campagne';
    const filename = `campagne-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 100);
    showNotif(`💾 ${filename} — ${total} document(s) sauvegardé(s)`, 'success');
  } catch (e) {
    showNotif(`Échec de l'export : ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; if (label != null) btn.textContent = label; }
  }
}

// Crée une NOUVELLE aventure à partir d'un backup, puis y restaure tout le contenu.
// Sert à récupérer une campagne entièrement supprimée (la restauration "dans une
// aventure existante" suppose qu'elle existe encore). Super-admin uniquement, comme
// la création normale. Le créateur devient l'unique MJ : les anciens membres ne
// sont pas recopiés (doc racine reconstruit par createAdventure, pas restauré).
function createAdventureFromBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch { showNotif('Fichier illisible (JSON invalide).', 'error'); return; }

    if (payload?.type !== 'le-grand-jdr.campaign' || !payload.collections) {
      showNotif("Ce fichier n'est pas un backup de campagne.", 'error'); return;
    }

    const meta  = payload.adventure || {};
    const nom   = (meta.nom || '').trim() || 'Campagne restaurée';
    const total = Object.values(payload.collections)
      .reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    const when  = payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('fr-FR') : '?';

    const ok = await confirmModal(
      `Créer une <strong>nouvelle</strong> aventure « ${_esc(nom)} » et y restaurer
       <strong>${total}</strong> document(s) (backup du ${when}).<br><br>
       • Tu en seras l'<strong>unique MJ</strong> ; les anciens membres ne sont pas recopiés (à ré-inviter ensuite).<br>
       • Une aventure neuve est créée : l'éventuelle aventure d'origine n'est pas touchée.`,
      { title: '📥 Créer depuis un backup', confirmLabel: 'Créer et restaurer', danger: false, icon: '📥' }
    );
    if (!ok) return;

    try {
      const adv = await createAdventure({ nom, emoji: meta.emoji || '⚔️', description: meta.description || '' });
      closeModal();
      const res = await importAdventure(adv.id, payload);
      const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
      setAdventures(adventures);
      renderAventuresPage();
      if (res.failed.length) {
        showNotif(`« ${nom} » créée. Restauré ${res.written} doc(s). Échecs : ${res.failed.map(f => f.col).join(', ')}`, 'error');
      } else {
        showNotif(`✅ « ${nom} » recréée — ${res.written} document(s) restauré(s).`, 'success');
      }
    } catch (e) {
      showNotif(`Échec : ${e.message}`, 'error');
    }
  });
  document.body.appendChild(input);
  input.click();
}

// Restauration (phase 2) : choisit un fichier, valide, confirme fortement, puis
// réécrit via firestore.js (upsert, aucune suppression, doc racine intouché).
function importAdventureBackup(advId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch { showNotif('Fichier illisible (JSON invalide).', 'error'); return; }

    if (payload?.type !== 'le-grand-jdr.campaign' || !payload.collections) {
      showNotif("Ce fichier n'est pas un backup de campagne.", 'error'); return;
    }

    const adv      = STATE.adventures.find(a => a.id === advId);
    const total    = Object.values(payload.collections)
      .reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    const mismatch = payload.adventureId && payload.adventureId !== advId;
    const when     = payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('fr-FR') : '?';

    const ok = await confirmModal(
      `Restaurer <strong>${total}</strong> document(s) dans <strong>${_esc(adv?.nom || advId)}</strong>
       (backup du ${when}).<br><br>
       • Les docs du backup <strong>écrasent</strong> ceux de même identifiant.<br>
       • <strong>Aucune suppression</strong> : ce qui a été ajouté depuis est conservé.<br>
       • Membres, MJ et dispos joueurs ne sont pas modifiés.
       ${mismatch ? `<br><br>⚠️ Ce backup provient d'une <strong>autre aventure</strong> (${_esc(payload.adventureId)}).` : ''}`,
      { title: '♻️ Restaurer la campagne', confirmLabel: 'Restaurer', icon: '♻️' }
    );
    if (!ok) return;

    // confirmModal a empilé/restauré la modale Gérer → le bouton d'origine est
    // détaché. On re-cible le bouton vivant pour le retour visuel pendant l'import.
    const liveBtn = document.querySelector('[data-action="_advImport"]');
    const label = liveBtn ? liveBtn.textContent : null;
    if (liveBtn) { liveBtn.disabled = true; liveBtn.textContent = '♻️ Restauration…'; }
    try {
      const res = await importAdventure(advId, payload);
      if (res.failed.length) {
        showNotif(`Restauré ${res.written} doc(s). Échecs : ${res.failed.map(f => f.col).join(', ')}`, 'error');
      } else {
        showNotif(`✅ ${res.written} document(s) restauré(s) sur ${res.collections} collection(s). Recharge la page pour voir les données.`, 'success');
      }
    } catch (e) {
      showNotif(`Échec de la restauration : ${e.message}`, 'error');
    } finally {
      if (liveBtn) { liveBtn.disabled = false; if (label != null) liveBtn.textContent = label; }
    }
  });
  document.body.appendChild(input);
  input.click();
}

// Quitter une aventure : supprime le(s) perso(s) du joueur (cascade complète) puis
// le retire de l'aventure. La cascade opère sur l'aventure ACTIVE → on s'y place
// d'abord si besoin. Réservé aux membres non créateurs (garde + règle Firestore).
async function leaveAdventure(advId) {
  const adv = STATE.adventures.find(a => a.id === advId);
  if (!adv) return;
  if (adv.createdBy === STATE.user?.uid) {
    showNotif("Tu es le créateur : supprime l'aventure au lieu de la quitter.", 'error');
    return;
  }

  const ok = await confirmModal(
    `Quitter <strong>${_esc(adv.nom)}</strong> ?<br><br>
     • Ton personnage et <strong>tout son contenu</strong> (objets, quêtes, hauts-faits, relations…)
       seront <strong>définitivement supprimés</strong> de cette aventure.<br>
     • Tu perdras l'accès à l'aventure.<br><br>
     Cette action est <strong>irréversible</strong>.`,
    { title: '🚪 Quitter l\'aventure', confirmLabel: 'Quitter et supprimer mon perso', danger: true, icon: '🚪' }
  );
  console.log('[leave] confirmation =', ok);
  if (!ok) return;

  try {
    console.log('[leave] début — scope courant', STATE.adventure?.id, '→ quitter', advId);
    // La cascade purgeCharacter cible l'aventure active → s'y placer si nécessaire.
    if (STATE.adventure?.id !== advId) selectAdventure(adv);

    const { purgeCharacter } = await import('./characters/forms.js');
    const myChars = await loadCollectionWhere('characters', 'uid', '==', STATE.user.uid);
    console.log('[leave] persos à purger :', myChars.length);
    for (const c of myChars) {
      try { await purgeCharacter(c.id); }
      catch (e) { console.warn('[leaveAdventure] purge perso ignorée', c.id, e?.code || e); }
    }

    console.log('[leave] retrait de l\'aventure…');
    await removeSelfFromAdventure(advId);
    console.log('[leave] retrait OK');

    closeModal();
    unwatchAll();
    showNotif(`Tu as quitté « ${adv.nom} ».`, 'success');

    // Router hors de l'aventure : recharger la liste et afficher le picker.
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    const { showAdventurePicker } = await import('../core/layout.js');
    showAdventurePicker(adventures);
    console.log('[leave] terminé → picker');
  } catch (e) {
    console.error('[leaveAdventure] échec :', e);
    showNotif(e.message || 'Échec — impossible de quitter.', 'error');
  }
}

async function deleteAdventureAndRefresh(advId) {
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
}

async function inviteAdventurePlayer(advId) {
  const email = document.getElementById('adv-invite-email')?.value?.trim();
  if (!email) { showNotif('Saisis un email à inviter.', 'error'); return; }
  try {
    await inviteByEmail(advId, email);
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    showNotif(`Invitation envoyée à ${email}.`, 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
}

async function cancelAdventureInvite(advId, email) {
  try {
    await cancelInvite(advId, email);
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    showNotif('Invitation annulée.', 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
}

async function removeAdventurePlayer(advId, targetUid) {
  try {
    await removePlayerFromAdventure(advId, targetUid);
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    showNotif('Joueur retiré.', 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
}

async function promoteAdventurePlayer(advId, targetUid) {
  try {
    await promoteToAdmin(advId, targetUid);
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    showNotif('Joueur promu MJ.', 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message, 'error'); }
}

async function relinkAdventurePlayer(advId, oldUid, newUid) {
  if (!await confirmModal('Réassocier ce joueur à son nouveau compte ?<br><br><span style="opacity:.8;font-size:.88em">Son accès à l\'aventure et ses personnages seront transférés de l\'ancien identifiant vers le nouveau. À faire après qu\'il se soit reconnecté avec son nouveau compte.</span>', { title: 'Réassocier le joueur', confirmLabel: 'Réassocier', danger: false, icon: '🔗' })) return;
  try {
    const { migrated } = await relinkPlayerAccount(advId, oldUid, newUid);
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    showNotif(`Compte réassocié — ${migrated} personnage(s) transféré(s).`, 'success');
    openManageAdventureModal(advId);
  } catch (e) { showNotif(e.message || 'Échec de la réassociation.', 'error'); }
}



// ── Enregistrement de la page ──────────────────
import PAGES from './pages.js';
PAGES['aventures'] = renderAventuresPage;

registerActions({
  openCreateAdventureModal: () => openCreateAdventureModal(),
  openManageAdventureModal: (btn) => openManageAdventureModal(btn.dataset.id),
  _advPickEmoji: (btn) => {
    btn.closest('[class]')?.querySelectorAll('.adv-emoji-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const target = document.getElementById(btn.dataset.targetId);
    if (target) target.value = btn.dataset.emoji;
  },
  _advClose: () => closeModal(),
  _doCreateAdventure: () => doCreateAdventure(),
  _advCreateFromBackup: () => createAdventureFromBackup(),
  _advSaveMeta: (btn) => saveAdventureMeta(btn.dataset.id),
  _advExport: (btn) => exportAdventureBackup(btn.dataset.id, btn),
  _advImport: (btn) => importAdventureBackup(btn.dataset.id),
  _advInvite: (btn) => inviteAdventurePlayer(btn.dataset.id),
  _advCancelInvite: (btn) => cancelAdventureInvite(btn.dataset.advId, btn.dataset.email),
  _advLeave: (btn) => leaveAdventure(btn.dataset.id),
  _advDelete: (btn) => deleteAdventureAndRefresh(btn.dataset.id),
  _advHideDeleteConfirm: () => { document.getElementById('adv-delete-confirm').style.display = 'none'; },
  _advShowDeleteConfirm: (btn) => {
    document.getElementById('adv-delete-confirm').style.display = 'block';
    btn.style.display = 'none';
  },
  _advPromote: (btn) => promoteAdventurePlayer(btn.dataset.advId, btn.dataset.uid),
  _advRemove: (btn) => removeAdventurePlayer(btn.dataset.advId, btn.dataset.uid),
  _advRelink: (btn) => relinkAdventurePlayer(btn.dataset.advId, btn.dataset.oldUid, btn.dataset.newUid),
});
