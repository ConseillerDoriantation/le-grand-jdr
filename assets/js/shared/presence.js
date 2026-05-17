// ══════════════════════════════════════════════════════════════════════════════
// PRESENCE.JS — Présence app-wide (qui est connecté sur cette aventure)
//
// Écrit un doc adventures/{advId}/presence/{uid} avec { uid, pseudo, lastSeen }
// toutes les 45 s tant qu'une aventure est sélectionnée.
// L'admin lit cette collection sur son dashboard pour voir les joueurs connectés.
// ══════════════════════════════════════════════════════════════════════════════
import { db, doc, setDoc, deleteDoc, serverTimestamp } from '../config/firebase.js';
import { STATE } from '../core/state.js';

const HEARTBEAT_MS = 45_000;
let _timer    = null;
let _ref      = null;
let _onUnload = null;

export function startPresence(advId, uid) {
  stopPresence();
  if (!advId || !uid) return;
  _ref = doc(db, `adventures/${advId}/presence/${uid}`);
  const write = () => {
    const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
    setDoc(_ref, { uid, pseudo, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
  };
  write();
  _timer = setInterval(write, HEARTBEAT_MS);
  _onUnload = () => { try { deleteDoc(_ref); } catch (e) { /* best-effort */ } };
  window.addEventListener('beforeunload', _onUnload);
}

export function stopPresence() {
  if (_timer)    { clearInterval(_timer); _timer = null; }
  if (_onUnload) { window.removeEventListener('beforeunload', _onUnload); _onUnload = null; }
  if (_ref)      { deleteDoc(_ref).catch(() => {}); _ref = null; }
}
