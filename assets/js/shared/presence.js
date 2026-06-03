// ══════════════════════════════════════════════════════════════════════════════
// PRESENCE.JS — Présence app-wide (qui est connecté sur cette aventure)
//
// Écrit un doc adventures/{advId}/presence/{uid} avec { uid, pseudo, lastSeen }
// toutes les 75 s tant qu'une aventure est sélectionnée ET que l'onglet est visible.
// L'admin lit cette collection sur son dashboard pour voir les joueurs connectés.
//
// Économie de quota : on suspend le heartbeat quand l'onglet passe en arrière-plan
// (document.hidden). Un onglet laissé ouvert toute la journée n'écrit plus pour rien.
// Le côté lecture (dashboard + VTT) expire déjà les entrées au-delà de 120 s, donc
// un joueur en arrière-plan disparaît proprement et réapparaît dès qu'il revient.
// ══════════════════════════════════════════════════════════════════════════════
import { db, doc, setDoc, deleteDoc, serverTimestamp } from '../config/firebase.js';
import { STATE } from '../core/state.js';

const HEARTBEAT_MS = 75_000;
let _timer        = null;
let _ref          = null;
let _onUnload     = null;
let _onVisibility = null;
let _lastWriteAt  = 0;

export function startPresence(advId, uid) {
  stopPresence();
  if (!advId || !uid) return;
  _ref = doc(db, `adventures/${advId}/presence/${uid}`);
  const write = () => {
    const now = Date.now();
    if (now - _lastWriteAt < 10_000) return;
    _lastWriteAt = now;
    const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
    setDoc(_ref, { uid, pseudo, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
  };
  const resume = () => { if (!_timer) { write(); _timer = setInterval(write, HEARTBEAT_MS); } };
  const pause  = () => { if (_timer) { clearInterval(_timer); _timer = null; } };

  _onVisibility = () => { document.hidden ? pause() : resume(); };
  document.addEventListener('visibilitychange', _onVisibility);
  if (!document.hidden) resume();

  _onUnload = () => { try { deleteDoc(_ref); } catch (e) { /* best-effort */ } };
  window.addEventListener('beforeunload', _onUnload);
}

export function stopPresence() {
  if (_timer)        { clearInterval(_timer); _timer = null; }
  if (_onVisibility) { document.removeEventListener('visibilitychange', _onVisibility); _onVisibility = null; }
  if (_onUnload)     { window.removeEventListener('beforeunload', _onUnload); _onUnload = null; }
  if (_ref)          { deleteDoc(_ref).catch(() => {}); _ref = null; }
  _lastWriteAt = 0;
}
