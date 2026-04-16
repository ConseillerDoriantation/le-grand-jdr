// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth / aventure
// ══════════════════════════════════════════════

import { STATE } from './state.js';

// ── Switcher d'aventure (disponible dès le chargement) ────────────────────────
window.openAdventureSwitcher = function () {
  const adventures = STATE.adventures;
  if (!adventures?.length || adventures.length <= 1) return;

  // Utiliser openModal si disponible, sinon fallback natif
  if (typeof openModal === 'function') {
    openModal('🗺️ Changer d\'aventure', `
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${adventures.map(a => {
          const isCurrent = STATE.adventure?.id === a.id;
          return `<div class="adv-switch-row ${isCurrent ? 'adv-switch-row--active' : ''}"
            onclick="${isCurrent ? '' : `closeModal();window.pickAdventure('${a.id}')`}"
            style="cursor:${isCurrent ? 'default' : 'pointer'}">
            <span style="font-size:1.3rem">${a.emoji || '⚔️'}</span>
            <span style="flex:1;font-size:.9rem;color:var(--text)">${a.nom}</span>
            ${isCurrent ? '<span style="font-size:.75rem;color:var(--gold)">● Actuelle</span>' : ''}
          </div>`;
        }).join('')}
        <button class="btn btn-outline btn-sm" style="margin-top:.4rem" onclick="closeModal()">Fermer</button>
      </div>
    `);
  }
};

export function showApp() {
  const authScreen  = document.getElementById('auth-screen');
  const advScreen   = document.getElementById('adventure-screen');
  const app         = document.getElementById('app');

  if (authScreen) authScreen.style.display = 'none';
  if (advScreen)  advScreen.style.display  = 'none';
  if (app)        app.style.display        = 'block';

  // ── Header (mobile uniquement) ──────────────────
  const usernameEl = document.getElementById('header-username');
  const adminBadge = document.getElementById('admin-badge');
  if (usernameEl) usernameEl.textContent = STATE.profile?.pseudo || STATE.user?.email || '';
  if (adminBadge) adminBadge.style.display = STATE.isAdmin ? 'inline' : 'none';

  // ── Sidebar profile ─────────────────────────────
  _updateSidebarProfile();

  // ── Bandeau aventure (sidebar chip) ─────────────
  _updateAdventureBadge();

  // ── Bottom nav mobile dynamique ─────────────────
  _updateMobileBottomNav();

  // ── Items admin-only ────────────────────────────
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = STATE.isAdmin ? 'flex' : 'none';
  });
}

export function showAuth() {
  const authScreen = document.getElementById('auth-screen');
  const advScreen  = document.getElementById('adventure-screen');
  const app        = document.getElementById('app');
  if (authScreen) authScreen.style.display = 'flex';
  if (advScreen)  advScreen.style.display  = 'none';
  if (app)        app.style.display        = 'none';
}

// ── Afficher le sélecteur d'aventure ──────────
export function showAdventurePicker(adventures = []) {
  const authScreen = document.getElementById('auth-screen');
  const advScreen  = document.getElementById('adventure-screen');
  const app        = document.getElementById('app');

  if (authScreen) authScreen.style.display = 'none';
  if (app)        app.style.display        = 'none';
  if (!advScreen) return;

  advScreen.style.display = 'flex';
  _renderAdventurePicker(adventures);
}

// ── Masquer le sélecteur après sélection ──────
export function hideAdventurePicker() {
  const advScreen = document.getElementById('adventure-screen');
  if (advScreen) advScreen.style.display = 'none';
}

// ── Badge aventure dans le header ──────────────
function _updateAdventureBadge() {
  // Header badge (mobile)
  const badge = document.getElementById('adventure-badge');
  if (badge) {
    if (STATE.adventure) {
      badge.textContent = `${STATE.adventure.emoji || '⚔️'} ${STATE.adventure.nom}`;
      badge.style.display = 'inline';
      badge.onclick = () => window.openAdventureSwitcher?.();
    } else {
      badge.style.display = 'none';
    }
  }

  // Sidebar chip (desktop)
  const chip      = document.getElementById('sidebar-adv-chip');
  const chipEmoji = document.getElementById('sidebar-adv-emoji');
  const chipName  = document.getElementById('sidebar-adv-name');
  if (chip) {
    if (STATE.adventure) {
      if (chipEmoji) chipEmoji.textContent = STATE.adventure.emoji || '⚔️';
      if (chipName)  chipName.textContent  = STATE.adventure.nom || '';
      chip.style.display = 'flex';
    } else {
      chip.style.display = 'none';
    }
  }
}

// ── Profil sidebar ──────────────────────────────
function _updateSidebarProfile() {
  const avatarEl = document.getElementById('sidebar-avatar');
  const pseudoEl = document.getElementById('sidebar-pseudo');
  const roleEl   = document.getElementById('sidebar-role');

  const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';

  if (avatarEl) {
    // Initial de l'utilisateur dans l'avatar
    avatarEl.textContent = pseudo[0]?.toUpperCase() || '?';
    // Rendre l'avatar cliquable → page compte
    avatarEl.style.cursor = 'pointer';
    avatarEl.onclick = () => window.navigate?.('account');
  }
  if (pseudoEl) pseudoEl.textContent = pseudo;
  if (roleEl) {
    roleEl.style.display = STATE.isAdmin ? 'block' : 'none';
  }
}

// ── Bottom nav mobile dynamique ─────────────────
function _updateMobileBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;

  const playerItems = [
    { page: 'dashboard',  icon: '🏠', label: 'Accueil'   },
    { page: 'characters', icon: '📜', label: 'Perso'     },
    { page: 'story',      icon: '📚', label: 'Trame'     },
    { page: 'bestiaire',  icon: '🐉', label: 'Bestiaire' },
  ];
  const mjItems = [
    { page: 'dashboard',  icon: '🏠', label: 'Accueil'  },
    { page: 'story',      icon: '📚', label: 'Trame'    },
    { page: 'bestiaire',  icon: '🐉', label: 'Bestiaire'},
    { page: 'admin',      icon: '⚙️', label: 'Console'  },
  ];

  const items = STATE.isAdmin ? mjItems : playerItems;
  const currentPage = document.querySelector('.nav-item.active')?.dataset?.navigate || 'dashboard';

  nav.innerHTML = items.map(i => `
    <button class="bottom-nav-item ${currentPage === i.page ? 'active' : ''}"
      type="button" data-navigate="${i.page}" data-page="${i.page}">
      <span class="bn-icon" aria-hidden="true">${i.icon}</span>
      <span>${i.label}</span>
    </button>`).join('') + `
    <button class="bottom-nav-item" type="button" data-toggle-more aria-label="Plus de pages" aria-expanded="false">
      <span class="bn-icon" aria-hidden="true">⋯</span>
      <span>Plus</span>
    </button>`;
}

// ── Rendu de l'écran sélecteur ─────────────────
function _renderAdventurePicker(adventures) {
  const body = document.getElementById('adventure-picker-body');
  if (!body) return;

  const pseudo    = STATE.profile?.pseudo || 'Aventurier';
  const canCreate = STATE.isSuperAdmin;

  if (adventures.length === 0) {
    if (canCreate) {
      body.innerHTML = _renderCreateFirst();
    } else {
      body.innerHTML = _renderWaiting(pseudo);
    }
    return;
  }

  body.innerHTML = `
    <p class="adv-picker-subtitle">Choisis une aventure pour continuer, ${pseudo}.</p>
    <div class="adv-list">
      ${adventures.map(a => _renderAdvCard(a)).join('')}
    </div>
    ${canCreate ? `<div class="adv-picker-footer">
      <button class="btn btn-outline btn-sm" onclick="openCreateAdventureModal()">+ Nouvelle aventure</button>
    </div>` : ''}
  `;
}

function _renderAdvCard(adv) {
  const isAdmin    = Array.isArray(adv.admins) && adv.admins.includes(STATE.user?.uid);
  const members    = (adv.accessList || []).length;
  const statusCls  = adv.status === 'archived' ? 'adv-card--archived' : '';
  return `<div class="adv-card ${statusCls}" onclick="window.pickAdventure('${adv.id}')">
    <div class="adv-card-emoji">${adv.emoji || '⚔️'}</div>
    <div class="adv-card-info">
      <div class="adv-card-nom">${adv.nom}</div>
      <div class="adv-card-meta">
        ${isAdmin ? '<span class="adv-role adv-role--mj">MJ</span>' : '<span class="adv-role adv-role--joueur">Joueur</span>'}
        <span class="adv-members">👥 ${members}</span>
        ${adv.status === 'archived' ? '<span class="adv-archived">Archivée</span>' : ''}
      </div>
      ${adv.description ? `<div class="adv-card-desc">${adv.description}</div>` : ''}
    </div>
    <span class="adv-card-arrow">›</span>
  </div>`;
}

function _renderCreateFirst() {
  return `
    <div class="adv-empty">
      <div class="adv-empty-icon">🗺️</div>
      <div class="adv-empty-title">Aucune aventure</div>
      <p class="adv-empty-text">Crée ta première aventure pour commencer.</p>
      <button class="btn btn-gold" onclick="openCreateAdventureModal()">✨ Créer une aventure</button>
    </div>
  `;
}

function _renderWaiting(pseudo) {
  return `
    <div class="adv-empty">
      <div class="adv-empty-icon">⏳</div>
      <div class="adv-empty-title">En attente d'invitation</div>
      <p class="adv-empty-text">
        Bonjour ${pseudo} ! Tu n'es encore invité·e dans aucune aventure.<br>
        Demande à ton Maître de Jeu de t'y ajouter.
      </p>
      <button class="btn btn-outline btn-sm" onclick="window.doLogout?.()">Se déconnecter</button>
    </div>
  `;
}
