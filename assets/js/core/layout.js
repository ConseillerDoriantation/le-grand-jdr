// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth / aventure
// ══════════════════════════════════════════════

import { STATE } from './state.js';
import { navigate } from './navigation.js';
import { appSplashHtml, _esc } from '../shared/html.js';
import { CLOUDINARY_ENABLED } from '../shared/upload-cloudinary.js';
import { isToggleable, isFeatureEnabled } from '../shared/features.js';
import { avatarSrcOf } from '../shared/avatar.js';
import { routeUrl } from '../shared/route.js';
import { subscribeCollection } from '../data/firestore.js';

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

  // ── Sidebar : rail persistant, épinglés, menus, CTA de séance ─
  _initSidebar();

  // ── Items admin-only ────────────────────────────
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = STATE.isAdmin ? 'flex' : 'none';
  });

  // ── Fonctionnalités activées par aventure (masque la nav des features off) ──
  applyFeatureVisibility();

  // Cloudinary désactivé (mode gratuit) → masquer le bouton de config même pour
  // le MJ. Réapparaît si CLOUDINARY_ENABLED repasse à true (cf. upload-cloudinary.js).
  if (!CLOUDINARY_ENABLED) {
    const clBtn = document.querySelector('[data-action="cloudinaryConfig"]');
    if (clBtn) clBtn.style.display = 'none';
  }
}

// Masque/affiche les items de nav selon les fonctionnalités activées de l'aventure
// courante. Togglables seulement (les pages fixes/admin-only ne sont pas touchées,
// sauf pour ne pas ré-afficher un item admin-only à un non-admin). Ré-appelée après
// un changement de toggles. Couvre sidebar + more-menu (tous les [data-navigate]).
export function applyFeatureVisibility() {
  document.querySelectorAll('[data-navigate]').forEach((el) => {
    const page = el.getAttribute('data-navigate');
    if (!isToggleable(page)) return;                 // page fixe → laissée telle quelle
    if (!isFeatureEnabled(page)) { el.style.display = 'none'; return; }
    // Feature activée : réafficher, sauf si masquée par admin-only pour un non-admin.
    const adminHidden = el.classList.contains('admin-only') && !STATE.isAdmin;
    el.style.display = adminHidden ? 'none' : '';
  });
  // Sections de sidebar dont tous les items sont cachés → masquer le titre orphelin.
  document.querySelectorAll('.sidebar-section').forEach((sec) => {
    const items = sec.querySelectorAll('.nav-item');
    if (!items.length) return;
    sec.style.display = [...items].every(i => i.style.display === 'none') ? 'none' : '';
  });
  // Les épinglés peuvent référencer une feature (dés)activée → re-rendre le bloc.
  if (document.getElementById('sidebar-pins')) _renderSidebarPins();
}

function _initSidebarExpansion() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.expandBound) return;
  sidebar.dataset.expandBound = '1';
  sidebar.classList.remove('is-expanded', 'nav-collapse');
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
    // Toujours une image : icône choisie sinon image de base (silhouette).
    avatarEl.innerHTML = `<img src="${_esc(avatarSrcOf(STATE.profile))}" alt="" class="sidebar-avatar-img">`;
    avatarEl.classList.add('has-avatar-img');
    // Le clic sur le profil ouvre le menu (dont « Mon compte ») — pas de nav directe.
  }
  if (pseudoEl) pseudoEl.textContent = pseudo;
  if (roleEl) {
    roleEl.style.display = STATE.isAdmin ? 'block' : 'none';
  }
}

// Re-render du profil sidebar (avatar + pseudo) après une modif côté compte.
export function refreshSidebarProfile() { _updateSidebarProfile(); }

// ── Bottom nav mobile dynamique ─────────────────
function _updateMobileBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;

  // Même barre pour tous : Jouer est l'action principale, le reste passe par « Plus ».
  // Filtrée selon les fonctionnalités activées de l'aventure (ex : VTT off → retiré).
  const items = [
    { page: 'dashboard',  icon: 'home',   label: 'Accueil', aria: 'Ouvrir le tableau de bord' },
    { page: 'characters', icon: 'scroll', label: 'Personnage', aria: 'Ouvrir ma fiche personnage' },
    { page: 'vtt',        icon: 'dice',   label: 'Jouer', primary: true, aria: 'Jouer maintenant, ouvrir la table virtuelle' },
    { page: 'story',      icon: 'book',   label: 'Trame', aria: 'Ouvrir la Trame' },
  ].filter(i => isFeatureEnabled(i.page));
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

// ══════════════════════════════════════════════════════════════════════════
// SIDEBAR — rail persistant, épinglés, menus, info-bulle, CTA de séance.
// Le markup de nav est en dur dans index.html ; ce module ne pilote que l'état.
// ══════════════════════════════════════════════════════════════════════════
const LS_RAIL = 'jdr-sidebar-rail';
const LS_PINS = 'jdr-sidebar-pins';
// Le tableau de bord a désormais un lien permanent (nav-item--home) → hors défaut.
const PINS_DEFAULT = ['agenda', 'npcs', 'map'];
// Pages adressables absentes des groupes de nav (sigil / CTA) : libellé + icône.
const PIN_EXTRA = {
  dashboard: { label: 'Tableau de bord', icon: 'home' },
  vtt:       { label: 'Table virtuelle', icon: 'dice' },
};
const ICONS = './assets/img/icons.svg';

function _readPins() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_PINS));
    return Array.isArray(a) ? a.filter(x => typeof x === 'string') : PINS_DEFAULT.slice();
  } catch { return PINS_DEFAULT.slice(); }
}
function _writePins(a) { try { localStorage.setItem(LS_PINS, JSON.stringify(a)); } catch {} }

// Registre id → { label, iconHref, section } construit depuis le markup réel
// (source unique de vérité) + les deux pages spéciales (sigil / CTA).
function _navRegistry() {
  const reg = {};
  document.querySelectorAll('#sidebar .sidebar-nav-group > .nav-item[data-navigate]').forEach((it) => {
    const id = it.dataset.navigate;
    reg[id] = {
      id,
      label: it.querySelector('.nav-label')?.textContent.trim() || id,
      iconHref: it.querySelector('.nav-icon use')?.getAttribute('href') || `${ICONS}#icon-scroll`,
      section: it.closest('.sidebar-section')?.querySelector('.sl-text')?.textContent.trim() || '',
    };
  });
  for (const [id, v] of Object.entries(PIN_EXTRA)) {
    if (!reg[id]) reg[id] = { id, label: v.label, iconHref: `${ICONS}#icon-${v.icon}`, section: '' };
  }
  return reg;
}

// Étoile d'épinglage injectée à droite de chaque item de section (idempotent).
function _injectStars() {
  document.querySelectorAll('#sidebar .sidebar-nav-group > .nav-item[data-navigate]').forEach((it) => {
    if (it.querySelector('.pin')) return;
    const star = document.createElement('span');
    star.className = 'pin';
    star.dataset.pin = it.dataset.navigate;
    star.setAttribute('role', 'button');
    star.tabIndex = 0;
    star.innerHTML = `<svg class="nav-icon" aria-hidden="true"><use href="${ICONS}#icon-star"/></svg>`;
    it.appendChild(star);
  });
}

// Synchronise l'apparence de toutes les étoiles avec l'état épinglé.
function _refreshStars(pins) {
  const set = new Set(pins || _readPins());
  document.querySelectorAll('#sidebar .pin[data-pin]').forEach((st) => {
    const on = set.has(st.dataset.pin);
    st.classList.toggle('is-pinned', on);
    st.querySelector('use')?.setAttribute('href', `${ICONS}#icon-${on ? 'star-fill' : 'star'}`);
    st.title = on ? 'Détacher des épinglés' : 'Épingler en haut';
  });
}

// Marque l'item épinglé actif (le bloc est re-rendu hors du cycle de navigate).
function _markPinsActive() {
  const host = document.getElementById('sidebar-pins');
  if (!host) return;
  const cur = STATE.currentPage;
  host.querySelectorAll('.nav-item[data-navigate]').forEach((el) => {
    const on = el.dataset.navigate === cur;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

function _renderSidebarPins() {
  const host = document.getElementById('sidebar-pins');
  if (!host) return;
  const reg = _navRegistry();
  const pins = _readPins().filter(id => reg[id] && (!isToggleable(id) || isFeatureEnabled(id)));
  const head = `<div class="sidebar-pinhead"><svg class="nav-icon" aria-hidden="true"><use href="${ICONS}#icon-star"/></svg><span>Épinglés</span><em>glisser pour ranger</em></div>`;
  const body = pins.length
    ? pins.map((id) => {
        const r = reg[id];
        return `<button class="nav-item" type="button" data-navigate="${r.id}" draggable="true" title="${_esc(r.label)}" data-sec="${_esc(r.section)}">
          <svg class="nav-icon" aria-hidden="true"><use href="${r.iconHref}"/></svg>
          <span class="nav-label">${_esc(r.label)}</span>
          <span class="pin is-pinned" role="button" tabindex="0" data-pin="${r.id}" title="Détacher des épinglés"><svg class="nav-icon" aria-hidden="true"><use href="${ICONS}#icon-star-fill"/></svg></span>
        </button>`;
      }).join('')
    : `<div class="sidebar-pins-empty">Clic droit sur une page → « Épingler » pour la garder à portée.</div>`;
  host.innerHTML = head + body;
  _markPinsActive();
}

function _togglePin(id) {
  const reg = _navRegistry();
  if (!reg[id]) return;
  let pins = _readPins();
  pins = pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id];
  _writePins(pins);
  _renderSidebarPins();
  _refreshStars(pins);
}

// ── Rail (toggle explicite persisté) ──────────────────────────────────────
function _applyRail(on) {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.classList.toggle('rail', !!on);
  const btn = document.getElementById('sidebar-railbtn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(!!on));
    btn.title = on ? 'Déplier la navigation — [' : 'Replier la navigation — [';
  }
}
function _toggleRail() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  const on = !sb.classList.contains('rail');
  _applyRail(on);
  try { localStorage.setItem(LS_RAIL, on ? '1' : '0'); } catch {}
}

// ── Menu de profil (s'ouvre vers le haut, accessible en rail) ─────────────
function _closeProfileMenu() {
  const m = document.getElementById('sidebar-profile-menu');
  const b = document.getElementById('sidebar-profile');
  if (m) m.hidden = true;
  if (b) b.setAttribute('aria-expanded', 'false');
}
function _toggleProfileMenu() {
  const m = document.getElementById('sidebar-profile-menu');
  const b = document.getElementById('sidebar-profile');
  if (!m) return;
  const willOpen = m.hidden;
  m.hidden = !willOpen;
  if (b) b.setAttribute('aria-expanded', String(willOpen));
}

// ── Info-bulle flottante en mode rail ─────────────────────────────────────
function _tipEl() {
  let t = document.getElementById('sidebar-tip');
  if (!t) { t = document.createElement('div'); t.id = 'sidebar-tip'; t.className = 'sidebar-tip'; document.body.appendChild(t); }
  return t;
}
function _tipOff() { document.getElementById('sidebar-tip')?.classList.remove('on'); }

// ── Menu contextuel (clic droit) ──────────────────────────────────────────
function _ctxEl() {
  let c = document.getElementById('sidebar-ctx');
  if (!c) { c = document.createElement('div'); c.id = 'sidebar-ctx'; c.className = 'sidebar-ctx'; document.body.appendChild(c); }
  return c;
}
function _closeCtx() { document.getElementById('sidebar-ctx')?.classList.remove('open'); }

// ── CTA « Jouer maintenant » : état de séance via présence temps réel ─────
let _presenceUnsub = null;
let _presenceList = [];
function _renderPlayCTA() {
  const sub = document.getElementById('sidebar-play-sub');
  const dot = document.getElementById('sidebar-play-dot');
  if (!sub) return;
  const me = STATE.user?.uid;
  const now = Date.now();
  const online = (_presenceList || []).filter((p) => {
    if (!p || !p.uid || p.uid === me) return false;
    const ts = p.lastSeen?.toMillis?.() ?? 0;
    return ts > 0 && (now - ts) < 120_000;
  }).length;
  if (online > 0) {
    sub.textContent = `Séance en cours · ${online} en ligne`;
    if (dot) dot.hidden = false;
  } else {
    sub.textContent = 'Table virtuelle';
    if (dot) dot.hidden = true;
  }
}
function _startPresenceWatch() {
  if (_presenceUnsub || !STATE.adventure) return;
  try {
    _presenceUnsub = subscribeCollection('presence', (list) => {
      _presenceList = list || [];
      _renderPlayCTA();
    });
  } catch {}
}

// ── Init (rendu idempotent ; écouteurs attachés une seule fois) ────────────
function _initSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;

  _injectStars();
  _renderSidebarPins();
  _refreshStars();
  let rail = false;
  try { rail = localStorage.getItem(LS_RAIL) === '1'; } catch {}
  _applyRail(rail);
  _startPresenceWatch();
  _renderPlayCTA();

  if (sb.dataset.sbBound) return;
  sb.dataset.sbBound = '1';

  // Clics dans la sidebar : étoile / rail / profil (le reste laisse naviguer).
  sb.addEventListener('click', (e) => {
    const pin = e.target.closest('.pin[data-pin]');
    if (pin) { e.preventDefault(); e.stopPropagation(); _togglePin(pin.dataset.pin); return; }
    if (e.target.closest('#sidebar-railbtn')) { e.preventDefault(); _toggleRail(); _tipOff(); return; }
    if (e.target.closest('#sidebar-profile')) { e.preventDefault(); _toggleProfileMenu(); return; }
    if (e.target.closest('#sidebar-profile-menu button')) _closeProfileMenu();
    if (e.target.closest('[data-navigate]')) { _closeProfileMenu(); _closeCtx(); _tipOff(); }
  });

  // Clavier : Entrée/Espace sur une étoile (span role=button).
  sb.addEventListener('keydown', (e) => {
    const pin = e.target.closest('.pin[data-pin]');
    if (pin && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); _togglePin(pin.dataset.pin); }
  });

  // Info-bulle en rail (nom + section d'origine), à droite de l'icône.
  sb.addEventListener('mouseover', (e) => {
    if (!sb.classList.contains('rail')) return;
    const t = e.target.closest('.nav-item,.sidebar-section-label,.sidebar-search,.sidebar-play,.sidebar-adv-chip,.sidebar-profile');
    if (!t || !sb.contains(t)) { _tipOff(); return; }
    let name = '', sec = '';
    if (t.classList.contains('nav-item')) {
      name = t.querySelector('.nav-label')?.textContent.trim() || t.title || '';
      sec = t.dataset.sec || t.closest('.sidebar-section')?.querySelector('.sl-text')?.textContent.trim() || '';
    } else if (t.classList.contains('sidebar-section-label')) {
      name = t.querySelector('.sl-text')?.textContent.trim() || '';
    } else if (t.classList.contains('sidebar-search')) { name = 'Rechercher'; }
    else if (t.classList.contains('sidebar-play')) { name = 'Jouer maintenant'; }
    else if (t.classList.contains('sidebar-adv-chip')) { name = document.getElementById('sidebar-adv-name')?.textContent.trim() || 'Aventure'; sec = 'Aventure'; }
    else if (t.classList.contains('sidebar-profile')) { name = document.getElementById('sidebar-pseudo')?.textContent.trim() || 'Profil'; }
    if (!name) { _tipOff(); return; }
    const tip = _tipEl();
    tip.innerHTML = (sec ? `<small>${_esc(sec)}</small>` : '') + _esc(name);
    const r = t.getBoundingClientRect();
    tip.classList.add('on');
    tip.style.left = (r.right + 10) + 'px';
    tip.style.top = (r.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
  });
  sb.addEventListener('mouseout', _tipOff);
  sb.addEventListener('mouseleave', _tipOff);

  // Clic droit → menu contextuel (Ouvrir · Épingler/Détacher · Nouvel onglet).
  sb.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.nav-item[data-navigate],.sidebar-play[data-navigate],.sidebar-sigil[data-navigate]');
    if (!t) return;
    const id = t.dataset.navigate;
    const reg = _navRegistry();
    const r = reg[id];
    if (!r) return;
    e.preventDefault();
    const pinned = _readPins().includes(id);
    const c = _ctxEl();
    c.innerHTML = `<div class="sidebar-ctx-head">${_esc(r.label)}</div>
      <button type="button" data-ctx="open"><svg class="nav-icon" aria-hidden="true"><use href="${ICONS}#icon-chevron"/></svg>Ouvrir</button>
      <button type="button" data-ctx="pin"><svg class="nav-icon" aria-hidden="true"><use href="${ICONS}#icon-${pinned ? 'star-fill' : 'star'}"/></svg>${pinned ? 'Détacher des épinglés' : 'Épingler en haut'}</button>
      <button type="button" data-ctx="newtab"><svg class="nav-icon" aria-hidden="true"><use href="${ICONS}#icon-layers"/></svg>Ouvrir dans un nouvel onglet</button>`;
    c.classList.add('open');
    c.style.left = Math.min(e.clientX, window.innerWidth - 215) + 'px';
    c.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
    c.onclick = (ev) => {
      const b = ev.target.closest('[data-ctx]');
      if (!b) return;
      const a = b.dataset.ctx;
      if (a === 'open') navigate(id);
      else if (a === 'pin') _togglePin(id);
      else if (a === 'newtab' && isFeatureEnabled(id)) window.open(routeUrl(id, ''), '_blank', 'noopener');
      _closeCtx();
    };
  });

  // Réordonner les épinglés au glisser-déposer.
  let dragId = null;
  sb.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.sidebar-pins .nav-item[draggable="true"]');
    if (!t) return;
    dragId = t.dataset.navigate;
    t.classList.add('dragging');
  });
  sb.addEventListener('dragend', () => {
    dragId = null;
    sb.querySelectorAll('.dragging,.drag-over').forEach(x => x.classList.remove('dragging', 'drag-over'));
  });
  sb.addEventListener('dragover', (e) => {
    const t = e.target.closest('.sidebar-pins .nav-item[draggable="true"]');
    if (!t || !dragId) return;
    e.preventDefault();
    sb.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    t.classList.add('drag-over');
  });
  sb.addEventListener('drop', (e) => {
    const t = e.target.closest('.sidebar-pins .nav-item[draggable="true"]');
    if (!t || !dragId) return;
    e.preventDefault();
    const pins = _readPins();
    const to = pins.indexOf(t.dataset.navigate);
    const from = pins.indexOf(dragId);
    if (to < 0 || from < 0 || to === from) return;
    pins.splice(to, 0, pins.splice(from, 1)[0]);
    _writePins(pins);
    _renderSidebarPins();
    _refreshStars(pins);
  });

  // Raccourci « [ » : replie / déplie (hors saisie).
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target?.matches?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
    if (e.key === '[') {
      const el = document.getElementById('sidebar');
      if (!el || getComputedStyle(el).display === 'none') return;
      _toggleRail(); _tipOff();
    } else if (e.key === 'Escape') {
      _closeProfileMenu(); _closeCtx();
    }
  });

  // Fermer les menus au clic extérieur.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sidebar-profile') && !e.target.closest('#sidebar-profile-menu')) _closeProfileMenu();
    if (!e.target.closest('#sidebar-ctx')) _closeCtx();
  });

  // Rafraîchit l'état de séance malgré l'absence de snapshot (présence qui périme).
  setInterval(() => { if (!document.hidden) _renderPlayCTA(); }, 60_000);
}
