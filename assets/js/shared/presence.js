// ══════════════════════════════════════════════════════════════════════════════
// PRESENCE.JS — Présence sur la table virtuelle
//
// Écrit un doc adventures/{advId}/presence/{uid} avec { uid, pseudo, lastSeen }
// toutes les 180 s uniquement tant que le joueur est réellement sur la page VTT.
// L'admin lit cette collection sur son dashboard pour voir qui est autour de la table.
//
// Économie de quota : sélectionner une aventure ne démarre plus un heartbeat global.
// Un onglet laissé sur Personnage, Boutique, Stats… toute la journée ne produit donc
// aucune écriture de présence, ni les lectures en cascade chez les autres joueurs.
// Le côté lecture (dashboard + VTT + chat) expire les entrées au-delà de
// PRESENCE_TTL_MS (presence-ttl.js, 300 s), donc un joueur en arrière-plan
// disparaît proprement et réapparaît dès qu'il revient.
// ══════════════════════════════════════════════════════════════════════════════
import { saveDoc, deleteFromCol, serverTimestampValue } from '../data/firestore.js';
import { STATE } from '../core/state.js';

// Quota : la présence est le seul coût d'écriture continu (1 écriture/joueur/
// battement pendant toute la séance). 180 s (au lieu de 90 s) divise ce coût par
// deux. L'expiration lecture (presence-ttl.js, 300 s) laisse la marge d'un battement manqué.
// Une sortie normale (autre page, déconnexion, fermeture) retire la présence tout
// de suite ; seul un onglet planté reste « présent » au plus PRESENCE_TTL_MS.
const HEARTBEAT_MS = 180_000;
let _timer        = null;
let _uid          = null;
let _onUnload     = null;
let _onVisibility = null;
let _onPageChange = null;
let _lastWriteAt  = 0;
let _announced    = false;
let _pendingWrite = Promise.resolve();

function _pauseHeartbeat() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function _withdraw() {
  if (!_uid || !_announced) return Promise.resolve();
  const uid = _uid;
  _announced = false;
  // La présence est supprimée : un retour au VTT doit la recréer tout de suite,
  // même dans les 10 s (sinon le garde-fou anti-doublon laissait le joueur
  // invisible jusqu'au battement suivant).
  _lastWriteAt = 0;
  // Une suppression lancée après l'écriture en vol évite qu'un setDoc lent ne
  // recrée la présence juste après avoir quitté le VTT.
  _pendingWrite = _pendingWrite.catch(() => {}).then(() => deleteFromCol('presence', uid).catch(() => {}));
  return _pendingWrite;
}

export function startPresence(advId, uid) {
  stopPresence();
  if (!advId || !uid) return;
  _uid = uid;
  const write = () => {
    if (!_uid || document.hidden || STATE.currentPage !== 'vtt') return;
    const now = Date.now();
    if (now - _lastWriteAt < 10_000) return;
    _lastWriteAt = now;
    const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
    _announced = true;
    _pendingWrite = _pendingWrite.catch(() => {}).then(() => saveDoc('presence', uid, {
      uid,
      pseudo,
      lastSeen: serverTimestampValue(),
    }, { silent: true })).catch(() => {});
  };
  const beat = () => { write(); _timer = setTimeout(beat, HEARTBEAT_MS); };
  const resume = () => {
    if (document.hidden || STATE.currentPage !== 'vtt' || _timer) return;
    // Retour sur l'onglet avec une présence encore fraîche (doc existant, dernier
    // battement < HEARTBEAT_MS) : aucune écriture immédiate, le battement reprend
    // à son échéance — les lecteurs voient le joueur présent sans interruption.
    const since = Date.now() - _lastWriteAt;
    if (_announced && since < HEARTBEAT_MS) _timer = setTimeout(beat, HEARTBEAT_MS - since);
    else beat();
  };
  const syncPage = () => {
    if (STATE.currentPage === 'vtt') resume();
    else { _pauseHeartbeat(); void _withdraw(); }
  };

  // En arrière-plan on suspend seulement le timer : l'entrée expirera côté
  // lecture après PRESENCE_TTL_MS, sans ajouter un delete + set à chaque changement d'onglet.
  _onVisibility = () => { document.hidden ? _pauseHeartbeat() : syncPage(); };
  document.addEventListener('visibilitychange', _onVisibility);
  _onPageChange = syncPage;
  document.addEventListener('app:page-changed', _onPageChange);
  syncPage();

  _onUnload = () => { void _withdraw(); };
  window.addEventListener('beforeunload', _onUnload);
}

export function stopPresence() {
  _pauseHeartbeat();
  if (_onVisibility) { document.removeEventListener('visibilitychange', _onVisibility); _onVisibility = null; }
  if (_onPageChange) { document.removeEventListener('app:page-changed', _onPageChange); _onPageChange = null; }
  if (_onUnload)     { window.removeEventListener('beforeunload', _onUnload); _onUnload = null; }
  const removal = _withdraw();
  _uid = null;
  _lastWriteAt = 0;
  // La déconnexion peut await cette suppression pendant que l'utilisateur est
  // encore authentifié. Les autres appelants gardent le comportement best-effort.
  return removal;
}
