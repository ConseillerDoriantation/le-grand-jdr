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
  loadMyCharacters,
  promoteToAdmin,
  relinkPlayerAccount,
  setAdventureFeatures,
  inviteByEmail,
  cancelInvite,
  loadAllUsers,
  loadUserAdventures,
  selectAdventure,
} from '../core/adventure.js';
import { exportAdventure, importAdventure } from '../data/firestore.js';
import { unwatchAll } from '../shared/realtime.js';
import { TOGGLEABLE_FEATURES, enabledFeaturesOf } from '../shared/features.js';

// ── Page principale ────────────────────────────
async function renderAventuresPage() {
  const content = document.getElementById('main-content');
  if (!content) return;

  const adventures = Array.isArray(STATE.adventures) ? STATE.adventures : [];
  const uid        = STATE.user?.uid;
  const current    = adventures.find(a => a.id === STATE.adventure?.id) || STATE.adventure || null;
  const adminCount = adventures.filter(a => a.admins?.includes(uid)).length;
  const playerCount = adventures.filter(a => !a.admins?.includes(uid)).length;
  const totalMembers = adventures.reduce((sum, a) => sum + (a.accessList || []).length, 0);

  let html = `
  <div class="adv-page-v2">
    <section class="adv-command">
      <div class="adv-command-main">
        <span class="adv-kicker">Campagnes</span>
        <h1>Aventures</h1>
        <p>Choisis la campagne active, gère les membres et crée un nouvel espace de jeu.</p>
      </div>
      <div class="adv-command-actions">
        <button class="adv-primary-action" data-action="openCreateAdventureModal">
          <span>+</span>
          <strong>Nouvelle aventure</strong>
        </button>
      </div>
    </section>

    <section class="adv-overview">
      <article class="adv-current-panel">
        ${current ? _renderCurrentAdventure(current) : _renderNoCurrentAdventure()}
      </article>
      <aside class="adv-side-panel">
        <div class="adv-side-title">Repères</div>
        <div class="adv-side-stats">
          ${_renderStat('Aventures', adventures.length)}
          ${_renderStat('MJ', adminCount)}
          ${_renderStat('Joueur', playerCount)}
          ${_renderStat('Membres', totalMembers)}
        </div>
        <button class="adv-secondary-action" data-action="_advCreateFromBackup">Créer depuis un backup</button>
      </aside>
    </section>`;

  if (adventures.length === 0) {
    html += _renderAdventureEmpty();
  } else {
    html += `<section class="adv-library">
      <div class="adv-section-head">
        <div>
          <span class="adv-kicker">Bibliothèque</span>
          <h2>Toutes tes aventures</h2>
        </div>
        <span>${adventures.length} campagne${adventures.length > 1 ? 's' : ''}</span>
      </div>
      <div class="adv-manage-list">`;
    for (const adv of adventures) {
      const isAdvAdmin = adv.admins?.includes(uid);
      const isCurrent  = STATE.adventure?.id === adv.id;
      html += _renderAdventureCard(adv, isAdvAdmin, isCurrent);
    }
    html += `</div></section>`;
  }

  html += `</div>`;
  content.innerHTML = html;
}

function _renderStat(label, value) {
  return `<div class="adv-stat">
    <strong>${value}</strong>
    <span>${label}</span>
  </div>`;
}

function _roleLabel(adv) {
  const uid = STATE.user?.uid;
  if (adv.createdBy === uid) return 'Créateur';
  if (adv.admins?.includes(uid)) return 'MJ';
  return 'Joueur';
}

function _memberInitials(adv) {
  const profiles = adv.memberProfiles || {};
  const uids = [...new Set([...(adv.admins || []), ...(adv.players || []), ...(adv.accessList || [])])].slice(0, 5);
  return uids.map(uid => {
    const p = profiles[uid];
    const label = typeof p === 'string' ? p : (p?.pseudo || p?.email || uid);
    const initial = String(label || '?').trim().charAt(0).toUpperCase() || '?';
    return `<span class="adv-member-dot" title="${_esc(label)}">${_esc(initial)}</span>`;
  }).join('');
}

function _renderCurrentAdventure(adv) {
  const members = (adv.accessList || []).length;
  const enabledCount = enabledFeaturesOf(adv).length;
  return `
    <div class="adv-current-badge">Aventure active</div>
    <div class="adv-current-body">
      <div class="adv-current-emoji">${adv.emoji || '⚔️'}</div>
      <div class="adv-current-copy">
        <span class="adv-kicker">${_esc(_roleLabel(adv))}</span>
        <h2>${_esc(adv.nom || 'Aventure sans nom')}</h2>
        <p>${_esc(adv.description || 'Aucune description renseignée pour cette aventure.')}</p>
      </div>
    </div>
    <div class="adv-current-foot">
      <span>${members} membre${members > 1 ? 's' : ''}</span>
      <span>${enabledCount} page${enabledCount > 1 ? 's' : ''} active${enabledCount > 1 ? 's' : ''}</span>
      <span class="adv-current-members">${_memberInitials(adv)}</span>
    </div>`;
}

function _renderNoCurrentAdventure() {
  return `
    <div class="adv-current-badge">Aucune active</div>
    <div class="adv-current-body">
      <div class="adv-current-emoji">◇</div>
      <div class="adv-current-copy">
        <span class="adv-kicker">Sélection</span>
        <h2>Choisis une aventure</h2>
        <p>La campagne sélectionnée devient le contexte de toutes les pages.</p>
      </div>
    </div>`;
}

function _renderAdventureEmpty() {
  return `<section class="adv-empty-v2">
    <div class="adv-empty-mark">◇</div>
    <h2>Aucune aventure disponible</h2>
    <p>Crée une première campagne ou restaure un backup JSON si tu repars d'une sauvegarde.</p>
    <div class="adv-empty-actions">
      <button class="btn btn-gold" data-action="openCreateAdventureModal">Créer une aventure</button>
      <button class="btn btn-outline" data-action="_advCreateFromBackup">Créer depuis un backup</button>
    </div>
  </section>`;
}

function _renderAdventureCard(adv, isAdvAdmin, isCurrent) {
  const members  = (adv.accessList || []).length;
  const adminCnt = (adv.admins    || []).length;
  const enabledCount = enabledFeaturesOf(adv).length;
  const pendingCount = new Set((adv.invitedEmails || []).map(e => String(e).toLowerCase())).size;
  const canLeave = adv.createdBy !== STATE.user?.uid;
  return `
  <div class="adv-manage-card ${isCurrent ? 'adv-manage-card--active' : ''}">
    <div class="adv-card-topline">
      <span class="adv-role-pill">${_esc(_roleLabel(adv))}</span>
      ${isCurrent ? `<span class="adv-badge-active">Active</span>` : ''}
    </div>
    <div class="adv-manage-card-hdr">
      <span class="adv-manage-emoji">${adv.emoji || '⚔️'}</span>
      <div class="adv-manage-info">
        <span class="adv-manage-nom">${_esc(adv.nom || 'Aventure sans nom')}</span>
        <span class="adv-manage-meta">${members} membre${members>1?'s':''} · ${adminCnt} MJ · ${enabledCount} page${enabledCount>1?'s':''}</span>
      </div>
    </div>
    <p class="adv-manage-desc">${_esc(adv.description || 'Aucune description renseignée.')}</p>
    <div class="adv-card-metrics">
      <span>${_memberInitials(adv) || '<i>Aucun membre</i>'}</span>
      ${pendingCount ? `<span>${pendingCount} invitation${pendingCount>1?'s':''}</span>` : ''}
    </div>
    <div class="adv-manage-actions">
      ${isCurrent
        ? `<button class="adv-card-action is-current" type="button" disabled>Campagne active</button>`
        : `<button class="adv-card-action" data-action="pickAdventure" data-id="${adv.id}">Entrer</button>`}
      ${isAdvAdmin ? `<button class="adv-card-action adv-card-action--muted" data-action="openManageAdventureModal" data-id="${adv.id}">Gérer</button>` : ''}
      ${canLeave ? `<button class="adv-card-action adv-card-action--danger" data-action="_advLeave" data-id="${adv.id}" title="Quitter cette aventure et supprimer ton personnage">Quitter</button>` : ''}
    </div>
  </div>`;
}
// ── Modal création d'aventure ──────────────────
export function openCreateAdventureModal() {
  const EMOJIS = ['⚔️','🏰','🗺️','🐉','🌙','🔮','🌊','🔥','🌿','⚡','🧙','🏴'];
  openModal('Nouvelle aventure', `
    <div class="adv-create-modal">
      <div class="adv-create-head">
        <div class="adv-create-mark">✦</div>
        <div>
          <span class="adv-kicker">Nouvelle campagne</span>
          <h3>Prépare un nouvel espace de jeu</h3>
          <p>Tu pourras ensuite inviter les joueurs, choisir les pages actives et importer un backup si besoin.</p>
        </div>
      </div>

      <div class="adv-create-grid">
        <div class="adv-create-field adv-create-field--wide">
          <label>Nom de l'aventure *</label>
          <input type="text" id="adv-nom" placeholder="Ex : La Chute des Dieux" maxlength="60">
        </div>

        <div class="adv-create-field adv-create-field--wide">
          <label>Emblème</label>
          <div class="adv-create-emojis">
            ${EMOJIS.map((e, i) => `<button type="button" class="adv-emoji-btn adv-create-emoji ${i === 0 ? 'selected' : ''}"
              data-action="_advPickEmoji" data-emoji="${e}" data-target-id="adv-emoji">${e}</button>`).join('')}
            <input type="hidden" id="adv-emoji" value="⚔️">
          </div>
        </div>

        <div class="adv-create-field adv-create-field--wide">
          <label>Description</label>
          <textarea id="adv-desc" rows="4" placeholder="Ambiance, promesse de campagne, ton général..."></textarea>
        </div>
      </div>

      <div class="adv-create-actions">
        <button class="btn btn-outline btn-sm" data-action="_advClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_doCreateAdventure">Créer l'aventure</button>
      </div>

      <div class="adv-create-backup">
        <div>
          <strong>Repartir d'une sauvegarde</strong>
          <span>Crée une nouvelle aventure puis restaure le contenu du fichier JSON.</span>
        </div>
        <button class="btn btn-outline btn-sm" data-action="_advCreateFromBackup">Créer depuis un backup</button>
      </div>
    </div>
  `, { subtitle: 'Campagne, accès et sauvegarde', accent: '#7fb2ff' });
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
  const absorbedUids = new Set(Object.keys(adv.accountRelinks || {}));

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
  // a pu lire les users (super-admin). Pour un MJ standard, on complète avec
  // memberProfiles ; sinon le bouton reste disponible en saisie manuelle d'UID.
  const _emailToUsers = {};
  allUsers.forEach(u => { if (u.email) (_emailToUsers[u.email.toLowerCase()] ||= []).push(u); });
  const _userEmailByUid = new Map();
  allUsers.forEach(u => {
    if (u?.id && u?.email) _userEmailByUid.set(u.id, String(u.email).trim().toLowerCase());
  });
  const charCountByUid = new Map();
  (STATE.characters || []).forEach(c => {
    if (!c?.uid) return;
    charCountByUid.set(c.uid, (charCountByUid.get(c.uid) || 0) + 1);
  });

  const _profileEmail = (uid) => {
    const p = profiles[uid];
    const email = typeof p === 'string' ? '' : (p?.email || '');
    return _userEmailByUid.get(uid) || String(email).trim().toLowerCase();
  };

  const _newUidFor = (uid) => {
    if (absorbedUids.has(uid)) return null;
    const u = usersById.get(uid);
    if (u?.email) {
      const dupe = (_emailToUsers[u.email.toLowerCase()] || [])
        .find(d => d.id !== uid && !memberUids.has(d.id));
      if (dupe) return dupe.id;
    }

    const email = _profileEmail(uid);
    if (!email) return null;
    const dupes = [...memberUids].filter(other => other !== uid && !absorbedUids.has(other) && _profileEmail(other) === email);
    if (!dupes.length) return null;
    const srcCount = charCountByUid.get(uid) || 0;
    const target = dupes.sort((a, b) => (charCountByUid.get(a) || 0) - (charCountByUid.get(b) || 0))[0];
    return srcCount > 0 && srcCount > (charCountByUid.get(target) || 0) ? target : null;
  };

  const _memberLine = (uid, isAdmin) => {
    const isCreator = uid === adv.createdBy;
    const newUid    = _newUidFor(uid);
    return `<div class="adv-member-row" id="mbr-${uid}">
      <span class="adv-member-pseudo">${_esc(_nameFor(uid))}</span>
      ${isAdmin ? '<span class="adv-role adv-role--mj">MJ</span>' : '<span class="adv-role adv-role--joueur">Joueur</span>'}
      <div class="adv-member-actions">
        ${newUid && !isCreator ? `<button class="btn-icon" title="Réassocier au compte détecté" style="color:#4f8cff" data-action="_advRelink" data-adv-id="${adventureId}" data-old-uid="${uid}" data-new-uid="${newUid}">🔗</button>` : ''}
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

  const enabled = new Set(enabledFeaturesOf(adv));
  const featuresHtml = TOGGLEABLE_FEATURES.map(f => `
    <button type="button" class="adv-feat-toggle ${enabled.has(f.key) ? 'is-on' : ''}"
      data-action="_advToggleFeature" data-adv-id="${adventureId}" data-feature="${f.key}"
      aria-pressed="${enabled.has(f.key)}">
      <span class="adv-feat-ico">${f.icon}</span>
      <span class="adv-feat-name">${_esc(f.label)}</span>
      <span class="adv-feat-switch" aria-hidden="true"></span>
    </button>`).join('');

  const pendingHtml = pendingInvites.length ? `
    <section class="adv-manage-panel adv-manage-panel--compact">
      <div class="adv-panel-head">
        <div>
          <span class="adv-kicker">Invitations</span>
          <h3>En attente</h3>
        </div>
        <span class="adv-panel-count">${pendingInvites.length}</span>
      </div>
      <div class="adv-manage-stack">
        ${pendingInvites.map(e => `<div class="adv-member-row adv-member-row--pending">
          <span class="adv-member-pseudo">${_esc(e)}</span>
          <span class="adv-role adv-role--joueur">Invité</span>
          <div class="adv-member-actions">
            <button class="btn-icon" title="Annuler l'invitation"
              data-action="_advCancelInvite" data-adv-id="${adventureId}" data-email="${_esc(e)}">×</button>
          </div>
        </div>`).join('')}
      </div>
    </section>` : '';

  const dangerHtml = STATE.isSuperAdmin ? `
    <section class="adv-manage-panel adv-manage-panel--danger">
      <div class="adv-panel-head">
        <div>
          <span class="adv-kicker">Danger</span>
          <h3>Suppression</h3>
        </div>
      </div>
      <p>Supprimer l'aventure efface définitivement ses données. Cette action est réservée au super-admin.</p>
      <div id="adv-delete-confirm" class="adv-delete-confirm" style="display:none">
        <strong>Supprimer ${_esc(adv.nom)} ?</strong>
        <span>Cette action est irréversible.</span>
        <div class="adv-danger-actions">
          <button class="adv-danger-confirm" data-action="_advDelete" data-id="${adventureId}">Supprimer définitivement</button>
          <button class="btn btn-outline btn-sm" data-action="_advHideDeleteConfirm">Annuler</button>
        </div>
      </div>
      <button class="adv-danger-trigger" data-action="_advShowDeleteConfirm">Supprimer l'aventure</button>
    </section>` : '';

  openModal(`Gérer — ${currentEmoji} ${adv.nom}`, `
    <div class="adv-manage-modal">
      <header class="adv-manage-hero">
        <div class="adv-manage-hero-mark">${currentEmoji}</div>
        <div class="adv-manage-hero-copy">
          <span class="adv-kicker">Configuration</span>
          <h3>${_esc(adv.nom || 'Aventure sans nom')}</h3>
          <p>${access.length} membre${access.length > 1 ? 's' : ''} · ${admins.length} MJ · ${enabled.size} page${enabled.size > 1 ? 's' : ''} active${enabled.size > 1 ? 's' : ''}</p>
        </div>
      </header>

      <div class="adv-manage-grid">
        <section class="adv-manage-panel adv-manage-panel--identity">
          <div class="adv-panel-head">
            <div>
              <span class="adv-kicker">Identité</span>
              <h3>Présentation</h3>
            </div>
            <button class="adv-panel-save" data-action="_advSaveMeta" data-id="${adventureId}">Enregistrer</button>
          </div>
          <div class="adv-edit-emojis">
            ${_ADV_EMOJIS.map(e => `<button type="button" class="adv-emoji-btn adv-edit-emoji ${e === currentEmoji ? 'selected' : ''}"
              data-action="_advPickEmoji" data-emoji="${e}" data-target-id="adv-edit-emoji">${e}</button>`).join('')}
            <input type="hidden" id="adv-edit-emoji" value="${currentEmoji}">
          </div>
          <label class="adv-edit-field">
            <span>Nom</span>
            <input type="text" id="adv-edit-nom" value="${_esc(adv.nom || '')}" maxlength="60">
          </label>
          <label class="adv-edit-field">
            <span>Description</span>
            <textarea id="adv-edit-desc" rows="4" placeholder="Description optionnelle">${_esc(adv.description || '')}</textarea>
          </label>
        </section>

        <section class="adv-manage-panel adv-manage-panel--members">
          <div class="adv-panel-head">
            <div>
              <span class="adv-kicker">Membres</span>
              <h3>Accès joueurs</h3>
            </div>
            <span class="adv-panel-count">${access.length}</span>
          </div>
          <div id="adv-members-list" class="adv-manage-stack adv-members-list-v2">
            ${memberLines.join('') || '<div class="adv-muted-line">Aucun membre</div>'}
          </div>
          <div class="adv-invite-box">
            <label for="adv-invite-email">Inviter par email</label>
            <div class="adv-invite-row">
              <input type="email" id="adv-invite-email" placeholder="email@exemple.com" data-enter-click="#_advInvite-${adventureId}">
              <button class="adv-panel-save" id="_advInvite-${adventureId}" data-action="_advInvite" data-id="${adventureId}">Inviter</button>
            </div>
            <p>L'invitation sera visible à la prochaine connexion du joueur.</p>
          </div>
        </section>

        ${pendingHtml}

        <section class="adv-manage-panel adv-manage-panel--features">
          <div class="adv-panel-head">
            <div>
              <span class="adv-kicker">Pages</span>
              <h3>Fonctionnalités actives</h3>
            </div>
            <span class="adv-panel-count">${enabled.size}</span>
          </div>
          <p class="adv-panel-note">Choisis les sections accessibles pour cette aventure. Les changements sont sauvegardés immédiatement.</p>
          <div class="adv-feat-grid adv-feat-grid--modal">${featuresHtml}</div>
        </section>

        <section class="adv-manage-panel adv-manage-panel--backup">
          <div class="adv-panel-head">
            <div>
              <span class="adv-kicker">Sauvegarde</span>
              <h3>Backup JSON</h3>
            </div>
          </div>
          <p>Exporter crée une copie complète. Restaurer réécrit les documents du backup sans supprimer ce qui existe déjà.</p>
          <div class="adv-backup-actions">
            <button class="adv-card-action adv-card-action--muted" data-action="_advExport" data-id="${adventureId}">Exporter</button>
            <button class="adv-card-action adv-card-action--muted" data-action="_advImport" data-id="${adventureId}">Restaurer</button>
          </div>
        </section>

        ${dangerHtml}
      </div>

      <footer class="adv-manage-footer">
        <button class="btn btn-outline btn-sm" data-action="_advClose">Fermer</button>
      </footer>
    </div>
  `, { subtitle: 'Membres, pages actives et sauvegardes', accent: '#7fb2ff' });
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
  if (!ok) return;

  try {
    // La cascade purgeCharacter cible l'aventure active → s'y placer si nécessaire.
    if (STATE.adventure?.id !== advId) selectAdventure(adv);

    // Requête directe (pas le cache-live qui peut bloquer sur une collection vide).
    const myChars = await loadMyCharacters(advId);
    if (myChars.length) {
      const { purgeCharacter } = await import('./characters/forms.js');
      for (const c of myChars) {
        try { await purgeCharacter(c.id); }
        catch (e) { console.warn('[leaveAdventure] purge perso ignorée', c.id, e?.code || e); }
      }
    }

    await removeSelfFromAdventure(advId);

    closeModal();
    unwatchAll();
    showNotif(`Tu as quitté « ${adv.nom} ».`, 'success');

    // Router hors de l'aventure : recharger la liste et afficher le picker.
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    const { showAdventurePicker } = await import('../core/layout.js');
    showAdventurePicker(adventures);
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

// Toggle optimiste d'une fonctionnalité : flip visuel immédiat, collecte des clés
// actives depuis le DOM, sauvegarde, ré-application de la visibilité de la nav.
// Revert visuel en cas d'échec. Pas de re-render de la modale (fluide).
async function toggleAdventureFeature(btn) {
  const advId = btn.dataset.advId;
  const on = btn.classList.toggle('is-on');
  btn.setAttribute('aria-pressed', String(on));
  const keys = [...document.querySelectorAll('.adv-feat-toggle.is-on[data-feature]')]
    .map(b => b.dataset.feature);
  try {
    await setAdventureFeatures(advId, keys);
    const adventures = await loadUserAdventures(STATE.user.uid, { email: STATE.profile?.email || STATE.user?.email });
    setAdventures(adventures);
    const { applyFeatureVisibility } = await import('../core/layout.js');
    applyFeatureVisibility();
  } catch (e) {
    btn.classList.toggle('is-on');
    btn.setAttribute('aria-pressed', String(!on));
    showNotif(e.message || 'Échec de la modification.', 'error');
  }
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

async function relinkAdventurePlayer(advId, oldUid, newUid = '') {
  let targetUid = String(newUid || '').trim();
  if (!targetUid || targetUid === oldUid) {
    showNotif('Identifiant de destination invalide.', 'error');
    return;
  }
  if (!await confirmModal('Réassocier ce joueur à son nouveau compte ?<br><br><span style="opacity:.8;font-size:.88em">Son accès à l\'aventure et ses personnages seront transférés de l\'ancien identifiant vers le nouveau. À faire après qu\'il se soit reconnecté avec son nouveau compte.</span>', { title: 'Réassocier le joueur', confirmLabel: 'Réassocier', danger: false, icon: '🔗' })) return;
  try {
    const { migrated } = await relinkPlayerAccount(advId, oldUid, targetUid);
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
  _advToggleFeature: (btn) => toggleAdventureFeature(btn),
  _advDelete: (btn) => deleteAdventureAndRefresh(btn.dataset.id),
  _advHideDeleteConfirm: () => { document.getElementById('adv-delete-confirm').style.display = 'none'; },
  _advShowDeleteConfirm: (btn) => {
    document.getElementById('adv-delete-confirm').style.display = 'grid';
    btn.style.display = 'none';
  },
  _advPromote: (btn) => promoteAdventurePlayer(btn.dataset.advId, btn.dataset.uid),
  _advRemove: (btn) => removeAdventurePlayer(btn.dataset.advId, btn.dataset.uid),
  _advRelink: (btn) => relinkAdventurePlayer(btn.dataset.advId, btn.dataset.oldUid, btn.dataset.newUid),
});
