// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth / aventure
// ══════════════════════════════════════════════

import { STATE } from './state.js';

export function showApp() {
  const authScreen  = document.getElementById('auth-screen');
  const advScreen   = document.getElementById('adventure-screen');
  const app         = document.getElementById('app');
  const usernameEl  = document.getElementById('header-username');
  const adminBadge  = document.getElementById('admin-badge');

  if (authScreen) authScreen.style.display = 'none';
  if (advScreen)  advScreen.style.display  = 'none';
  if (app)        app.style.display        = 'block';

  if (usernameEl) usernameEl.textContent = STATE.profile?.pseudo || STATE.user?.email || '';
  if (adminBadge) adminBadge.style.display = STATE.isAdmin ? 'inline' : 'none';

  // Mettre à jour le bandeau d'aventure dans le header
  _updateAdventureBadge();

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
  const badge = document.getElementById('adventure-badge');
  if (!badge) return;
  if (STATE.adventure) {
    badge.textContent = `${STATE.adventure.emoji || '⚔️'} ${STATE.adventure.nom}`;
    badge.style.display = 'inline';
    badge.onclick = () => window.openAdventureSwitcher?.();
  } else {
    badge.style.display = 'none';
  }
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
