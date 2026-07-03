// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth / aventure
// ══════════════════════════════════════════════

import { STATE } from './state.js';
import { navigate } from './navigation.js';
import { appSplashHtml, _esc } from '../shared/html.js';
import { CLOUDINARY_ENABLED } from '../shared/upload-cloudinary.js';

// Masque le splash de boot dès qu'un écran principal est prêt à s'afficher.
function _hideBootSplash() {
  const el = document.getElementById('boot-splash');
  if (el) el.style.display = 'none';
}

// ── Switcher d'aventure (disponible dès le chargement) ────────────────────────
export function openAdventureSwitcher() {
  const adventures = STATE.adventures;
  if (!adventures?.length || adventures.length <= 1) return;

  // Utiliser openModal si disponible, sinon fallback natif
  if (typeof openModal === 'function') {
    openModal('🗺️ Changer d\'aventure', `
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${adventures.map(a => {
          const isCurrent = STATE.adventure?.id === a.id;
          return `<div class="adv-switch-row ${isCurrent ? 'adv-switch-row--active' : ''}"
            ${isCurrent ? '' : `data-action="_advSwitchPick" data-id="${a.id}"`}
            style="cursor:${isCurrent ? 'default' : 'pointer'}">
            <span style="font-size:1.3rem">${a.emoji || '⚔️'}</span>
            <span style="flex:1;font-size:.9rem;color:var(--text)">${a.nom}</span>
            ${isCurrent ? '<span style="font-size:.75rem;color:var(--gold)">● Actuelle</span>' : ''}
          </div>`;
        }).join('')}
        <button class="btn btn-outline btn-sm" style="margin-top:.4rem" data-action="_layoutCloseModal">Fermer</button>
      </div>
    `);
  }
}

export function showAppLoading(label = 'Chargement…') {
  const content = document.getElementById('main-content');
  if (content) content.innerHTML = appSplashHtml(label);
  showApp();
}

export function showApp() {
  _hideBootSplash();
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

  // ── Sections sidebar repliables (état persistant) ─
  _initCollapsibleSections();
  _initSidebarExpansion();

  // ── Items admin-only ────────────────────────────
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = STATE.isAdmin ? 'flex' : 'none';
  });

  // Cloudinary désactivé (mode gratuit) → masquer le bouton de config même pour
  // le MJ. Réapparaît si CLOUDINARY_ENABLED repasse à true (cf. upload-cloudinary.js).
  if (!CLOUDINARY_ENABLED) {
    const clBtn = document.querySelector('[data-action="cloudinaryConfig"]');
    if (clBtn) clBtn.style.display = 'none';
  }
}

function _initSidebarExpansion() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.expandBound) return;
  sidebar.dataset.expandBound = '1';

  let openTimer = null;
  let closeTimer = null;
  const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clearTimers = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  };

  sidebar.addEventListener('mouseenter', () => {
    if (!canHover() || sidebar.classList.contains('nav-collapse')) return;
    clearTimeout(closeTimer);
    openTimer = setTimeout(() => {
      sidebar.classList.add('is-expanded');
    }, 180);
  });

  sidebar.addEventListener('mouseleave', () => {
    clearTimeout(openTimer);
    closeTimer = setTimeout(() => {
      sidebar.classList.remove('is-expanded', 'nav-collapse');
    }, 140);
  });

  sidebar.addEventListener('focusin', () => {
    if (!canHover()) return;
    clearTimers();
    sidebar.classList.add('is-expanded');
  });

  sidebar.addEventListener('focusout', () => {
    if (sidebar.contains(document.activeElement)) return;
    closeTimer = setTimeout(() => sidebar.classList.remove('is-expanded'), 120);
  });
}

// ── Persistance du repli des sections sidebar ──────
// Stocke un objet { sectionId: bool } dans localStorage.
function _initCollapsibleSections() {
  const KEY = 'jdr-sidebar-sections';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}

  const sections = document.querySelectorAll('details.sidebar-section[data-section]');
  sections.forEach((sec) => {
    const id = sec.dataset.section;
    if (id in state) sec.open = !!state[id];
    // Évite de réattacher le listener si showApp() est rappelé
    if (sec.dataset.collapsibleBound) return;
    sec.dataset.collapsibleBound = '1';
    sec.addEventListener('toggle', () => {
      let s = {};
      try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
      s[id] = sec.open;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    });
  });
}

export function showAuth() {
  _hideBootSplash();
  const authScreen = document.getElementById('auth-screen');
  const advScreen  = document.getElementById('adventure-screen');
  const app        = document.getElementById('app');
  if (authScreen) authScreen.style.display = 'flex';
  if (advScreen)  advScreen.style.display  = 'none';
  if (app)        app.style.display        = 'none';
}

// ── Afficher le sélecteur d'aventure ──────────
export function showAdventurePicker(adventures = [], invitations = []) {
  _hideBootSplash();
  const authScreen = document.getElementById('auth-screen');
  const advScreen  = document.getElementById('adventure-screen');
  const app        = document.getElementById('app');

  if (authScreen) authScreen.style.display = 'none';
  if (app)        app.style.display        = 'none';
  if (!advScreen) return;

  advScreen.style.display = 'flex';
  _renderAdventurePicker(adventures, invitations);
}

// ── Masquer le sélecteur après sélection ──────
export function hideAdventurePicker() {
  const advScreen = document.getElementById('adventure-screen');
  if (advScreen) advScreen.style.display = 'none';
}

// ── Échec de chargement des aventures (réseau / token) ──────
// Affiché à la place du faux "En attente d'invitation" quand la lecture a
// échoué : le joueur est peut-être bien membre. `onRetry` relance la tentative.
export function showAdventureLoadError(onRetry) {
  _hideBootSplash();
  const authScreen = document.getElementById('auth-screen');
  const advScreen  = document.getElementById('adventure-screen');
  const app        = document.getElementById('app');
  if (authScreen) authScreen.style.display = 'none';
  if (app)        app.style.display        = 'none';
  if (!advScreen) return;

  advScreen.style.display = 'flex';
  const body = document.getElementById('adventure-picker-body');
  if (!body) return;
  body.innerHTML = `
    <div class="adv-empty">
      <div class="adv-empty-icon">📡</div>
      <div class="adv-empty-title">Connexion impossible</div>
      <p class="adv-empty-text">
        Impossible de charger tes aventures pour le moment.<br>
        Vérifie ta connexion — tes aventures sont sûrement toujours là.
      </p>
      <button class="btn btn-gold" id="adv-retry-btn">🔄 Réessayer</button>
      <button class="btn btn-outline btn-sm" data-action="logout" style="margin-top:8px">Se déconnecter</button>
    </div>`;
  const btn = document.getElementById('adv-retry-btn');
  if (btn && onRetry) {
    btn.addEventListener('click', () => { btn.disabled = true; btn.textContent = '⏳ …'; onRetry(); }, { once: true });
  }
}

// ── Badge aventure dans le header ──────────────
function _updateAdventureBadge() {
  const canSwitchAdventure = (STATE.adventures?.length || 0) > 1;

  // Header badge (mobile)
  const badge = document.getElementById("adventure-badge");
  if (badge) {
    if (STATE.adventure) {
      badge.textContent = (STATE.adventure.emoji || "⚔️") + " " + (STATE.adventure.nom || "");
      badge.style.display = "inline";
      badge.disabled = !canSwitchAdventure;
      badge.title = canSwitchAdventure ? "Changer d\x27aventure" : "Aventure active";
      badge.setAttribute("aria-label", badge.title);
      badge.onclick = canSwitchAdventure ? () => openAdventureSwitcher() : null;
    } else {
      badge.style.display = "none";
      badge.onclick = null;
    }
  }

  // Sidebar chip (desktop)
  const chip      = document.getElementById("sidebar-adv-chip");
  const chipEmoji = document.getElementById('sidebar-adv-emoji');
  const chipName  = document.getElementById('sidebar-adv-name');
  if (chip) {
    if (STATE.adventure) {
      if (chipEmoji) chipEmoji.textContent = STATE.adventure.emoji || "⚔️";
      if (chipName)  chipName.textContent  = STATE.adventure.nom || "";
      chip.style.display = "flex";
      chip.classList.toggle("sidebar-adv-chip--static", !canSwitchAdventure);
      chip.title = canSwitchAdventure ? "Changer d\x27aventure" : "Aventure active";
      chip.setAttribute("aria-label", chip.title);
      if (canSwitchAdventure) {
        chip.dataset.action = "openAdventureSwitcher";
        chip.setAttribute("aria-haspopup", "dialog");
        chip.setAttribute("role", "button");
        chip.tabIndex = 0;
      } else {
        delete chip.dataset.action;
        chip.removeAttribute("aria-haspopup");
        chip.removeAttribute("role");
        chip.removeAttribute("tabindex");
      }
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
    avatarEl.onclick = () => navigate('account');
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

  // Même barre pour tous : Jouer est l'action principale, le reste passe par « Plus ».
  const items = [
    { page: 'dashboard',  icon: 'home',   label: 'Accueil', aria: 'Ouvrir le tableau de bord' },
    { page: 'characters', icon: 'scroll', label: 'Personnage', aria: 'Ouvrir ma fiche personnage' },
    { page: 'vtt',        icon: 'dice',   label: 'Jouer', primary: true, aria: 'Jouer maintenant, ouvrir la table virtuelle' },
    { page: 'story',      icon: 'book',   label: 'Trame', aria: 'Ouvrir la Trame' },
  ];
  const currentPage = STATE.currentPage || document.querySelector('.nav-item.active')?.dataset?.navigate || 'dashboard';

  const moreActive = !items.some(i => i.page === currentPage);

  nav.innerHTML = items.map(i => {
    const active = currentPage === i.page;
    return `
    <button class="bottom-nav-item${i.primary ? ' bottom-nav-item--primary' : ''}${active ? ' active' : ''}"
      type="button" data-navigate="${i.page}" data-page="${i.page}" aria-label="${i.aria}"${active ? ' aria-current="page"' : ''}>
      <svg class="bn-icon" aria-hidden="true"><use href="./assets/img/icons.svg#icon-${i.icon}"/></svg>
      <span>${i.label}</span>
    </button>`;
  }).join('') + `
    <button class="bottom-nav-item${moreActive ? ' active' : ''}" type="button" data-toggle-more aria-label="Afficher toutes les pages"
      aria-expanded="false" aria-controls="more-menu" aria-haspopup="true">
      <svg class="bn-icon" aria-hidden="true"><use href="./assets/img/icons.svg#icon-more"/></svg>
      <span>Plus</span>
    </button>`;
}

// ── Rendu de l'écran sélecteur ─────────────────
function _renderAdventurePicker(adventures, invitations = []) {
  const body = document.getElementById('adventure-picker-body');
  if (!body) return;

  const pseudo      = STATE.profile?.pseudo || 'Aventurier';
  const invitesHtml = _renderInvitations(invitations);

  if (adventures.length === 0) {
    // Aucune aventure : d'abord les invitations à traiter, sinon création (ouverte à tous).
    body.innerHTML = invitesHtml
      ? `${invitesHtml}<div class="adv-picker-footer">
           <button class="btn btn-outline btn-sm" data-action="openCreateAdventureModal">+ Nouvelle aventure</button>
         </div>`
      : _renderWaiting(pseudo);
    return;
  }

  body.innerHTML = `
    ${invitesHtml}
    <p class="adv-picker-subtitle">Choisis une aventure pour continuer, ${pseudo}.</p>
    <div class="adv-list">
      ${adventures.map(a => _renderAdvCard(a)).join('')}
    </div>
    <div class="adv-picker-footer">
      <button class="btn btn-outline btn-sm" data-action="openCreateAdventureModal">+ Nouvelle aventure</button>
    </div>
  `;
}

// Invitations en attente : carte par aventure avec Accepter / Refuser.
function _renderInvitations(invitations = []) {
  if (!invitations?.length) return '';
  return `
    <div class="adv-invites">
      <p class="adv-picker-subtitle">📩 Invitation${invitations.length > 1 ? 's' : ''} en attente</p>
      <div class="adv-list">
        ${invitations.map(inv => `
          <div class="adv-card adv-card--invite">
            <div class="adv-card-emoji">${inv.emoji || '⚔️'}</div>
            <div class="adv-card-info">
              <div class="adv-card-nom">${_esc(inv.nom || 'Aventure')}</div>
              ${inv.description ? `<div class="adv-card-desc">${_esc(inv.description)}</div>` : ''}
            </div>
            <div class="adv-invite-actions">
              <button class="btn btn-gold btn-sm" data-action="acceptInvitation" data-id="${inv.id}">Accepter</button>
              <button class="btn btn-outline btn-sm" data-action="declineInvitation" data-id="${inv.id}">Refuser</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
  `;
}

function _renderAdvCard(adv) {
  const isAdmin    = Array.isArray(adv.admins) && adv.admins.includes(STATE.user?.uid);
  const members    = (adv.accessList || []).length;
  const statusCls  = adv.status === 'archived' ? 'adv-card--archived' : '';
  return `<div class="adv-card ${statusCls}" data-action="pickAdventure" data-id="${adv.id}">
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
      <button class="btn btn-gold" data-action="openCreateAdventureModal">✨ Créer une aventure</button>
    </div>
  `;
}

function _renderWaiting(pseudo) {
  return `
    <div class="adv-empty">
      <div class="adv-empty-icon adv-empty-icon--brand"><img class="brand-logo" src="./assets/img/grimorium-logo.png" alt=""></div>
      <div class="adv-empty-title">En attente d'invitation</div>
      <p class="adv-empty-text">
        Bonjour ${pseudo} ! Tu n'es encore invité·e dans aucune aventure.<br>
        Demande à ton Maître de Jeu de t'y ajouter.
      </p>
      <button class="btn btn-outline btn-sm" data-action="logout">Se déconnecter</button>
    </div>
  `;
}
