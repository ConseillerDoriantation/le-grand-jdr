// ══════════════════════════════════════════════════════════════════════════════
// VTT-PRESENCE.JS — Présence des joueurs sur la Table de Jeu Virtuelle
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// Colonne des joueurs actifs, alimentée par la présence app-wide. Le heartbeat
// unique vit dans shared/presence.js : le VTT ne double plus ses écritures.
// ══════════════════════════════════════════════════════════════════════════════

import { setDoc, deleteDoc, serverTimestamp } from '../../config/firebase.js';
import { subscribeCollection } from '../../data/firestore.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { confirmModal } from '../../shared/modal.js';
import { sortCharactersForDisplay } from '../../shared/char-stats.js';
import { makeStatsSessionKey, registerStatsSession, setActiveStatsSession, statsDateKey } from '../../shared/stats.js';
import { _sesRef, _presenceRef } from './vtt-refs.js';   // refs Firestore (leaf)
import { _renderTraySoon } from './vtt-tray.js';
import { _renderMiniSheet, _vttToggleMiniSheet } from './vtt-mini-fiche.js';
import { _renderShortRest, _checkShortRestAutoApply } from './vtt-rest.js';

// ── État local (intervalIds + listeners) ────────────────────────────
let _presUnsub = null;   // observer du listener session-live partagé
let _presRefresh  = null; // intervalId du rafraîchissement présence
let _sessionUpdating = false;

function _refreshPresenceConsumers() {
  _renderPresenceCol();
  if (STATE.isAdmin) _renderTraySoon();
  _renderShortRest();
  _checkShortRestAutoApply();
}

// Réutilise le listener session-live de la présence app-wide. Il n'y a donc
// ni second heartbeat, ni seconde lecture Firestore pour le VTT.
function _startPresence() {
  if (_presUnsub) return;
  _presUnsub = subscribeCollection('presence', rows => {
    const now = Date.now();
    VS.presence = {};
    rows.forEach(p => {
      const ts = p.lastSeen?.toMillis?.() ?? (typeof p.lastSeen === 'number' ? p.lastSeen : 0);
      if (ts > 0 && now - ts < 120_000) {
        VS.presence[p.id] = { uid: p.id, pseudo: p.pseudo || '?', lastSeen: ts };
      }
    });
    _refreshPresenceConsumers();
  });
  // Filet de sécurité : re-rendre la présence toutes les 30s pour expirer les entrants inactifs
  _presRefresh = setInterval(_refreshPresenceConsumers, 30_000);
}

// Détache seulement cet observer : le listener session-live peut continuer à
// servir le bandeau et le chat sans nouvelle lecture.
function _resetPresence() {
  if (_presUnsub)        { _presUnsub(); _presUnsub = null; }
  if (_presRefresh)      { clearInterval(_presRefresh);    _presRefresh   = null; }
}

// MJ : retire un joueur de la présence du VTT en supprimant sa présence app-wide.
// Effet : il disparaît de la colonne pour tout le monde, et son doc cesse d'être
// relu à chaque ouverture du VTT (utile pour les entrées fantômes). Un joueur
// encore actif se ré-annonce à son prochain heartbeat (≤90 s) — c'est voulu.
// MJ : déclare / termine une session de jeu en cours (vtt/session.live).
// Les joueurs qui ouvrent le VTT voient alors un message dans le sas d'entrée.
function _renderSessionBtn() {
  const btn = document.getElementById('vtt-session-btn');
  if (!btn) return;
  const live = !!VS.session?.live;
  btn.classList.toggle('is-live', live);
  btn.classList.toggle('is-pending', _sessionUpdating);
  btn.disabled = _sessionUpdating;
  btn.setAttribute('aria-busy', String(_sessionUpdating));
  btn.innerHTML = _sessionUpdating
    ? '<span class="vtt-session-spinner" aria-hidden="true"></span><span class="vtt-canvas-ctl-copy"><strong>Mise à jour…</strong><small>Un instant</small></span>'
    : live
      ? '<span class="vtt-live-status" aria-hidden="true"><i></i><b>LIVE</b></span><span class="vtt-canvas-ctl-copy"><strong>Session en direct</strong><small>Cliquer pour terminer</small></span>'
      : '<span class="vtt-session-play" aria-hidden="true">▶</span><span class="vtt-canvas-ctl-copy"><strong>Démarrer la session</strong><small>Prévenir les joueurs</small></span>';
  btn.setAttribute('aria-label', live ? 'Terminer la session en cours' : 'Démarrer la session et prévenir les joueurs');
  btn.title = live
    ? 'Session en direct — cliquer pour la terminer'
    : 'Démarrer la session (prévient les joueurs qui rejoignent)';
}
async function _vttToggleSessionLive() {
  if (!STATE.isAdmin || _sessionUpdating) return;
  const wasLive = !!VS.session?.live;
  if (wasLive && !await confirmModal(
    'Les joueurs ne verront plus la session comme étant en direct. La table et ses données resteront intactes.',
    { title: 'Terminer la session ?', confirmLabel: 'Terminer', cancelLabel: 'Continuer à jouer', icon: '⏹️' },
  )) return;
  const live = !wasLive;
  const startedAt = live ? Date.now() : null;
  const techniqueSessionKey = live ? startedAt : (VS.session?.techniqueSessionKey || null);
  const statsSessionDate = live ? statsDateKey(new Date(startedAt)) : (VS.session?.statsSessionDate || '');
  const statsSessionKey = live ? makeStatsSessionKey(statsSessionDate, startedAt) : (VS.session?.statsSessionKey || '');
  const previous = { ...VS.session };
  _sessionUpdating = true;
  VS.session = { ...VS.session, live, ...(live ? { techniqueSessionKey, statsSessionKey, statsSessionDate } : {}) };
  setActiveStatsSession(live ? { key: statsSessionKey, date: statsSessionDate } : null);
  _renderSessionBtn();
  try {
    if (live) {
      await setDoc(_sesRef(), {
        live: true,
        liveSince: serverTimestamp(),
        techniqueSessionKey,
        statsSessionKey,
        statsSessionDate,
      }, { merge: true });
      // Le descriptif améliore les libellés de la page Stats. Les compteurs et
      // les logs portent déjà la clé, donc un échec isolé reste récupérable.
      await registerStatsSession({ key: statsSessionKey, date: statsSessionDate, startedAt });
    } else {
      await setDoc(_sesRef(), { live: false }, { merge: true });
    }
    showNotif(live ? '🔴 Session déclarée en cours.' : '⏹ Session terminée.', 'success');
  } catch {
    VS.session = previous;
    setActiveStatsSession(previous.live && previous.statsSessionKey
      ? { key: previous.statsSessionKey, date: previous.statsSessionDate }
      : null);
    showNotif('Erreur d\'enregistrement de la session.', 'error');
  } finally {
    _sessionUpdating = false;
    _renderSessionBtn();
  }
}

async function _vttKickPresence(uid) {
  if (!STATE.isAdmin || !uid) return;
  const pseudo = VS.presence[uid]?.pseudo || 'ce joueur';
  if (!await confirmModal(`Retirer <b>${_esc(pseudo)}</b> de la présence du VTT ?<br><span style="opacity:.75;font-size:.85em">Réapparaîtra automatiquement s'il est toujours actif sur la table.</span>`, { title: 'Présence', confirmLabel: 'Retirer', icon: '👋' })) return;
  try {
    await deleteDoc(_presenceRef(uid));
    // Optimiste : retire localement sans attendre le snapshot.
    delete VS.presence[uid];
    if (VS.miniUid === uid) { VS.miniUid = null; _renderMiniSheet(null); }
    _renderPresenceCol();
    if (STATE.isAdmin) _renderTraySoon();
    showNotif(`${pseudo} retiré de la présence`, 'info');
  } catch (e) { console.error('[vtt] kick presence', e); showNotif('Erreur', 'error'); }
}

function _renderPresenceCol() {
  const list = document.getElementById('vtt-pres-list');
  if (!list) return;
  const now = Date.now();
  const players = Object.values(VS.presence).filter(p => now - (p.lastSeen ?? 0) < 120_000);
  if (!players.length) {
    list.innerHTML = '<div class="vtt-pres-empty">—</div>';
    return;
  }
  const myUid = STATE.user?.uid;
  list.innerHTML = players.map(p => {
    const chars = sortCharactersForDisplay(Object.values(VS.characters).filter(c => c.uid === p.uid));
    // Préfère le perso ★ par défaut comme "visage" du joueur
    const char  = chars.find(c => c.id === VS.miniCharId)
               || chars.find(c => c.isDefault)
               || chars[0];
    const img   = char?.photoURL || char?.photo || char?.avatar || null;
    const init  = (char?.nom || p.pseudo || '?')[0].toUpperCase();
    const isOpen = VS.miniUid === p.uid;
    const isSelf = p.uid === myUid;
    return `<div class="vtt-pres-entry${isOpen?' is-open':''}${isSelf?' is-self':''}"
      data-vtt-fn="_vttToggleMiniSheet" data-vtt-args="${p.uid}"
      title="${p.pseudo}${char?.nom ? ' · '+char.nom : ''}">
      <div class="vtt-pres-avatar"${img?` style="background-image:url('${img}')"`:''}>
        ${img ? '' : `<span>${init}</span>`}
        ${isSelf ? '<div class="vtt-pres-self-dot"></div>' : ''}
        ${(STATE.isAdmin && !isSelf) ? `<button class="vtt-pres-kick" data-vtt-fn="_vttKickPresence" data-vtt-args="${p.uid}" title="Retirer ${_esc(p.pseudo)} de la présence" aria-label="Retirer de la présence">✕</button>` : ''}
      </div>
      <div class="vtt-pres-name">${p.pseudo}</div>
    </div>`;
  }).join('');
}

export {
  _startPresence,
  _resetPresence,
  _renderSessionBtn,
  _vttToggleSessionLive,
  _vttKickPresence,
  _renderPresenceCol,
};
