// ══════════════════════════════════════════════════════════════════════════════
// CHAT.JS — Chat flottant de l'aventure (style Messenger, MVP)
// ✓ Bulle flottante en bas à droite, sur toutes les pages
// ✓ Une conversation « aventure » (tous les membres), temps réel
// ✓ Badge de messages non-lus (par joueur, doc chatReads/{uid})
// ✓ Économe en quota : 1 seul onSnapshot (40 derniers messages) pour la session,
//   deltas uniquement ensuite. Envoi = 1 écriture. Aucun polling.
// (Étape 2 à venir : discussions de groupe entre membres choisis → convoId.)
//
// Realtime direct via config/firebase (même exception assumée que features/vtt/*).
// Données scopées à l'aventure : adventures/{advId}/chatMessages + chatReads/{uid}.
// ══════════════════════════════════════════════════════════════════════════════
import {
  db, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
  doc, getDoc, setDoc,
} from '../config/firebase.js';
import { getCurrentAdventureId } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';

const CONVO = 'adventure';   // MVP : une seule conversation par aventure
const HISTORY = 40;          // messages chargés/écoutés (borne le quota)

let _mounted = false;
let _open    = false;
let _unsub   = null;
let _msgs    = [];           // triés ascendants (ancien → récent)
let _lastRead = 0;           // millis
let _uid     = null;

// ── Refs Firestore (scope aventure) ───────────────────────────────────────────
function _msgsCol() { const a = getCurrentAdventureId(); return a ? collection(db, 'adventures', a, 'chatMessages') : null; }
function _readRef()  { const a = getCurrentAdventureId(); return (a && _uid) ? doc(db, 'adventures', a, 'chatReads', _uid) : null; }
const _atMillis = (m) => (m?.at?.toMillis ? m.at.toMillis() : (Number(m?.at) || Date.now()));
const _unread   = () => _msgs.filter(m => m.senderId !== _uid && _atMillis(m) > _lastRead).length;

// ── Cycle de vie ──────────────────────────────────────────────────────────────
export async function initChat(uid) {
  _uid = uid || STATE.user?.uid || null;
  _teardownListener();
  _msgs = []; _open = false;
  _mount();

  // lastRead persistant (badge non-lus)
  try { const s = await getDoc(_readRef()); _lastRead = Number(s.data()?.at) || 0; }
  catch { _lastRead = 0; }

  const col = _msgsCol(); if (!col) return;
  _unsub = onSnapshot(
    query(col, orderBy('at', 'desc'), limit(HISTORY)),
    snap => {
      // serverTimestamps:'estimate' → mon propre message a un `at` immédiat
      // (sinon null tant que le serveur n'a pas confirmé → il n'apparaîtrait pas).
      _msgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse();
      if (_open) { _renderMessages(); _markReadLocal(); }   // pas d'écriture par message
      else _renderBubble();
    },
    err => console.warn('[chat] onSnapshot', err?.code || err),
  );
}

export function teardownChat() {
  _teardownListener();
  document.getElementById('chat-widget')?.remove();
  _mounted = false; _open = false; _msgs = [];
}
function _teardownListener() { if (_unsub) { try { _unsub(); } catch {} _unsub = null; } }

// ── Montage du widget (une fois, dans #app → présent sur toutes les pages) ─────
function _mount() {
  let el = document.getElementById('chat-widget');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chat-widget';
    (document.getElementById('app') || document.body).appendChild(el);
  }
  _mounted = true;
  _renderBubble();
}

// ── Rendus ────────────────────────────────────────────────────────────────────
function _renderBubble() {
  const el = document.getElementById('chat-widget'); if (!el || _open) return;
  const n = _unread();
  el.innerHTML = `
    <button class="chat-bubble" data-action="chatToggle" title="Chat de l'aventure" aria-label="Ouvrir le chat">
      <span class="chat-bubble-ico">💬</span>
      ${n > 0 ? `<span class="chat-badge">${n > 99 ? '99+' : n}</span>` : ''}
    </button>`;
}

function _renderPanel() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  el.innerHTML = `
    <div class="chat-panel" role="dialog" aria-label="Chat de l'aventure">
      <div class="chat-head">
        <span class="chat-head-title">💬 Chat de l'aventure</span>
        <button class="chat-close" data-action="chatToggle" aria-label="Fermer le chat">✕</button>
      </div>
      <div class="chat-msgs" id="chat-msgs"></div>
      <form class="chat-form" id="chat-form">
        <input id="chat-input" class="chat-input" placeholder="Écris un message…" autocomplete="off" maxlength="1000">
        <button type="submit" class="chat-send" aria-label="Envoyer">➤</button>
      </form>
    </div>`;
  // Envoi via submit (bouton OU touche Entrée). Listener réattaché à chaque
  // ouverture (le form est recréé) ; les messages entrants ne re-render QUE la
  // liste, pas le champ → la saisie en cours n'est jamais perdue.
  el.querySelector('#chat-form')?.addEventListener('submit', (e) => { e.preventDefault(); _send(); });
  _renderMessages();
  el.querySelector('#chat-input')?.focus();
}

function _renderMessages() {
  const list = document.getElementById('chat-msgs'); if (!list) return;
  list.innerHTML = _msgs.length
    ? _msgs.map(_msgRow).join('')
    : `<div class="chat-empty">Aucun message. Lance la discussion !</div>`;
  list.scrollTop = list.scrollHeight;
}

function _msgRow(m) {
  const mine = m.senderId === _uid;
  const t = _atMillis(m);
  const time = new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `<div class="chat-msg${mine ? ' chat-msg--mine' : ''}">
    ${mine ? '' : `<span class="chat-msg-author">${_esc(m.senderName || '?')}</span>`}
    <span class="chat-msg-bubble">${_esc(m.text || '')}</span>
    <span class="chat-msg-time">${time}</span>
  </div>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────
function chatToggle() {
  _open = !_open;
  if (_open) { _renderPanel(); _markRead(); }
  else { _markRead(); _renderBubble(); }   // persiste l'état de lecture à la fermeture
}

async function _send() {
  const inp = document.getElementById('chat-input');
  const text = (inp?.value || '').trim();
  if (!text) return;
  const col = _msgsCol(); if (!col || !_uid) return;
  inp.value = '';
  const senderName = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || 'Joueur';
  try {
    await addDoc(col, { convoId: CONVO, text, senderId: _uid, senderName, at: serverTimestamp() });
  } catch (e) {
    console.warn('[chat] send', e?.code || e);
    showNotif('Message non envoyé — règles Firestore à déployer ?', 'error');
    if (inp) inp.value = text;   // ne perd pas le message
  }
}

// Met à jour l'état de lecture EN MÉMOIRE (badge à 0), sans écriture Firestore.
function _markReadLocal() {
  const latest = _msgs.length ? _atMillis(_msgs[_msgs.length - 1]) : 0;
  _lastRead = Math.max(_lastRead, latest, Date.now());
}
// Persiste l'état de lecture (appelé à l'ouverture/fermeture uniquement → ~2
// écritures/session au lieu d'une par message entrant).
async function _markRead() {
  _markReadLocal();
  const ref = _readRef(); if (!ref) return;
  try { await setDoc(ref, { at: _lastRead }, { merge: true }); } catch { /* non bloquant */ }
}

registerActions({
  chatToggle: () => chatToggle(),
});
