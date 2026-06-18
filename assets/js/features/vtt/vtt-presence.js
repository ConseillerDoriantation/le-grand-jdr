// ══════════════════════════════════════════════════════════════════════════════
// VTT-PRESENCE.JS — Présence des joueurs sur la Table de Jeu Virtuelle
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// Heartbeat Firestore espacé (quota : suspendu onglet masqué, expire à 120s côté
// lecture) + colonne des joueurs actifs. État partagé presence/miniUid via VS.
// ══════════════════════════════════════════════════════════════════════════════

import { setDoc, deleteDoc, serverTimestamp } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { confirmModal } from '../../shared/modal.js';
import { sortCharactersForDisplay } from '../../shared/char-stats.js';
import { _sesRef, _pingRef } from './vtt-refs.js';   // refs Firestore (leaf)
import { _renderTraySoon } from './vtt-tray.js';
import { _renderMiniSheet, _vttToggleMiniSheet } from './vtt-mini-fiche.js';

// 90 s : aligné sur la présence app-wide, sous l'expiration lecture de 120 s.
const VTT_PRESENCE_HEARTBEAT_MS = 90_000;

// ── État local (intervalIds + listeners) ────────────────────────────
let _presHeartbeat= null; // intervalId du heartbeat
let _presLastWriteAt = 0;
let _presVisibility = null; // listener visibilitychange (pause heartbeat onglet masqué)
let _presUnload = null; // listener beforeunload VTT
let _presRefresh  = null; // intervalId du rafraîchissement présence

// Démarre le heartbeat de présence (appelé au montage de la table).
function _startPresence() {
  const _presUid = STATE.user?.uid;
  if (_presUid) {
    const _presWrite = () => {
      // Onglet en arrière-plan : on ne dépense pas de write (la présence expire
      // à 120 s côté lecture, le joueur réapparaît dès qu'il revient sur l'onglet).
      if (document.hidden) return;
      const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
      const now = Date.now();
      if (now - _presLastWriteAt < 10_000) return;
      _presLastWriteAt = now;
      setDoc(_pingRef(_presUid), { pres: { pseudo, lastSeen: serverTimestamp() } }, { merge: true }).catch(() => {});
    };
    _presWrite();
    _presHeartbeat = setInterval(_presWrite, VTT_PRESENCE_HEARTBEAT_MS);
    // Retour au premier plan : ré-annoncer immédiatement sans attendre le prochain tick.
    _presVisibility = () => { if (!document.hidden) _presWrite(); };
    document.addEventListener('visibilitychange', _presVisibility);
    // Fermeture navigateur : tentative de suppression (best-effort)
    _presUnload = () => { deleteDoc(_pingRef(_presUid)).catch(()=>{}); };
    window.addEventListener('beforeunload', _presUnload);
  }
  // Filet de sécurité : re-rendre la présence toutes les 30s pour expirer les entrants inactifs
  _presRefresh = setInterval(_renderPresenceCol, 30_000);
}

// Arrête le heartbeat + nettoie les listeners (appelé au teardown).
function _resetPresence() {
  if (_presHeartbeat) {
    clearInterval(_presHeartbeat); _presHeartbeat = null;
    // Supprimer le doc de présence immédiatement pour que les autres voient le départ
    const _uid = STATE.user?.uid;
    if (_uid) { try { deleteDoc(_pingRef(_uid)).catch(()=>{}); } catch(e){} }
  }
  if (_presVisibility)   { document.removeEventListener('visibilitychange', _presVisibility); _presVisibility = null; }
  if (_presUnload)       { window.removeEventListener('beforeunload', _presUnload); _presUnload = null; }
  if (_presRefresh)      { clearInterval(_presRefresh);    _presRefresh   = null; }
  _presLastWriteAt = 0;
}

// MJ : retire un joueur de la présence du VTT en supprimant son doc ping/présence.
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
  btn.innerHTML = live ? '🔴 Session en cours' : '⚪ Démarrer la session';
  btn.title = live
    ? 'Session déclarée en cours — clique pour la terminer'
    : 'Démarrer la session (prévient les joueurs qui rejoignent)';
}
async function _vttToggleSessionLive() {
  if (!STATE.isAdmin) return;
  const live = !VS.session?.live;
  try {
    await setDoc(_sesRef(), live ? { live: true, liveSince: serverTimestamp() } : { live: false }, { merge: true });
    showNotif(live ? '🔴 Session déclarée en cours.' : '⏹ Session terminée.', 'success');
  } catch { showNotif('Erreur d\'enregistrement de la session.', 'error'); }
}

async function _vttKickPresence(uid) {
  if (!STATE.isAdmin || !uid) return;
  const pseudo = VS.presence[uid]?.pseudo || 'ce joueur';
  if (!await confirmModal(`Retirer <b>${_esc(pseudo)}</b> de la présence du VTT ?<br><span style="opacity:.75;font-size:.85em">Réapparaîtra automatiquement s'il est toujours actif sur la table.</span>`, { title: 'Présence', confirmLabel: 'Retirer', icon: '👋' })) return;
  try {
    await deleteDoc(_pingRef(uid));
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
