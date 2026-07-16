// ══════════════════════════════════════════════════════════════════════════════
// CHAT.JS — Chat flottant de l'aventure (style Messenger)
// ✓ Bulle flottante en bas à droite, sur toutes les pages
// ✓ Conversation « Aventure » (tous les membres) + discussions de GROUPE
//   (sous-ensemble de membres choisis) — temps réel
// ✓ Badge de non-lus (par conversation, doc chatReads/{uid} = map convoId→millis)
// ✓ Quota : 1 onSnapshot messages Aventure + 1 onSnapshot de MES groupes
//   (metadata) pour la session ; les messages d'un GROUPE ne sont écoutés que
//   quand il est ouvert. Écriture d'état de lecture ~à l'ouverture/fermeture.
//
// Données (scope aventure) :
//   adventures/{advId}/chatMessages/{id} : { convoId, text, senderId, senderName, at,
//                                            editedAt?, deleted?, reactions?:{uid:emoji} }
//   adventures/{advId}/chatConvos/{id}   : { type:'group'|'dm', name, members[], createdBy,
//                                            lastText, lastSenderName, lastSenderId, lastAt }
//     · DM : id déterministe `dm_<uidA>_<uidB>` (1 par paire), name vide (affiche l'autre).
//   adventures/{advId}/chatReads/{uid}   : { [convoId]: millis }
//
// Fonctions : chat d'aventure + groupes + DM 1-à-1 · édition/suppression de ses
// messages · réactions emoji · gestion de groupe (renommer / membres / quitter /
// supprimer). Edit/delete/réactions/gestion nécessitent les règles Firestore MAJ.
// ══════════════════════════════════════════════════════════════════════════════
import {
  db, collection, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc,
  serverTimestamp, doc, getDoc, getDocFromCache, setDoc, deleteDoc, deleteField,
} from '../config/firebase.js';
import { getCurrentAdventureId, getDocData } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showNotif } from '../shared/notifications.js';
import { confirmModal } from '../shared/modal.js';
import { avatarSrcOf } from '../shared/avatar.js';
import { uploadJpeg } from '../shared/image-upload.js';
import {
  linkify, applyEmotes, applyMentions, mentionsToTokens, dayLabel, rollDice, rollCardHtml,
} from './chat/chat-format.js';
import { _esc } from '../shared/html.js';

const ADV = 'adventure';   // id de la conversation d'aventure
const HISTORY = 40;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];   // palette de réactions
// Emoji insérables (bouton 😊), classés par catégorie pour un picker navigable.
const EMOJI_CATS = [
  { label: 'Visages', emojis: ['😀','😁','😂','🤣','😅','😊','😇','🙂','😉','😍','😘','😗','😎','🤩','🥳','😜','😝','🤪','🤔','🤨','😐','😑','😶','🙄','😴','😪','😵','🤯','😳','🥺','😢','😭','😤','😡','🤬','😱','😨','😰','😬','🤗'] },
  { label: 'Gestes', emojis: ['👍','👎','👏','🙌','🙏','💪','🤝','👀','✌️','🤞','👌','🤙','✋','👋','🤛','🤜','👊','☝️','👇','🫡'] },
  { label: 'Cœurs & symboles', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','✨','🔥','⭐','🎉','💫','⚡','💥','❓','❗','✅'] },
  { label: 'JDR & objets', emojis: ['🎲','⚔️','🛡️','🏹','🗡️','🪓','🏰','🐉','🧙','🧝','🧟','💀','☠️','👻','😈','🗝️','💰','🍺','🧪','📜','🔮','🕯️','🗺️','💎'] },
];

let _uid = null, _open = false, _view = 'list';   // 'list' | 'convo' | 'new' | 'manage'
let _openId = null;                                // conv ouverte (ADV | convoId)
let _editingId = null;                             // message en cours d'édition (id) | null
let _replyTo = null;                               // message cité { id, senderName, text } | null
let _mentionQ = null, _mentionOutside = null;      // autocomplétion @pseudo
let _searchOpen = false, _searchQ = '', _listQ = ''; // recherche dans la conv ouverte + filtre conversations
let _muted = false, _audioCtx = null, _soundReady = false;   // notif sonore (pas de bip au 1er rendu)
let _chatEmotes = [];                              // émotes custom :nom: (world/vtt_emotes)
let _lastRenderedLastId = null;                    // dernier msg rendu (scroll intelligent)
let _imgCache = new Map();                         // imageId → dataUrl (session)
let _advLimit = HISTORY, _convoLimit = HISTORY;    // pagination « charger plus »
let _advMsgs = [];                                 // messages Aventure (live session)
let _groups  = [];                                 // convos de groupe où je suis membre
let _convoMsgs = [];                               // messages du GROUPE ouvert
let _reads = {};                                   // convoId → millis lus
let _ghosts = new Set();                            // uids confirmés fantômes (compte supprimé) → masqués
let _unsubAdv = null, _unsubGroups = null, _unsubConvo = null;
let _unsubTyping = null, _unsubReads = null;       // « écrit… » (conv ouverte) + « vu » (DM ouvert)
let _unsubPresence = null, _online = new Set();    // statut en ligne (abonné quand panneau ouvert)
let _typing = [], _otherReads = 0;                 // uids en train d'écrire · millis lus par l'autre (DM)
let _typingWroteAt = 0, _typingClearTimer = null, _typingRenderTimer = null;
let _baseTitle = '';                               // titre d'onglet sans compteur
let _prevUnread = 0;                               // pour ne pulser QUE sur du neuf

// ── Refs ──────────────────────────────────────────────────────────────────────
const _adv = () => getCurrentAdventureId();
const _msgsCol  = () => { const a = _adv(); return a ? collection(db, 'adventures', a, 'chatMessages') : null; };
const _convosCol = () => { const a = _adv(); return a ? collection(db, 'adventures', a, 'chatConvos') : null; };
const _convoRef = (id) => { const a = _adv(); return a ? doc(db, 'adventures', a, 'chatConvos', id) : null; };
const _msgRef   = (id) => { const a = _adv(); return a ? doc(db, 'adventures', a, 'chatMessages', id) : null; };
const _imgsCol  = () => { const a = _adv(); return a ? collection(db, 'adventures', a, 'chatImages') : null; };
const _imgRef   = (id) => { const a = _adv(); return a ? doc(db, 'adventures', a, 'chatImages', id) : null; };
const _readRef  = () => { const a = _adv(); return (a && _uid) ? doc(db, 'adventures', a, 'chatReads', _uid) : null; };
const _readsRefOf = (u) => { const a = _adv(); return (a && u) ? doc(db, 'adventures', a, 'chatReads', u) : null; };
const _typingCol = () => { const a = _adv(); return a ? collection(db, 'adventures', a, 'chatTyping') : null; };
const _typingRef = () => { const a = _adv(); return (a && _uid) ? doc(db, 'adventures', a, 'chatTyping', _uid) : null; };
const _dmId = (a, b) => 'dm_' + [a, b].sort().join('_');   // id déterministe → 1 DM par paire
const _atMillis = (m) => (m?.at?.toMillis ? m.at.toMillis() : (Number(m?.at) || 0));
const _lastMillis = (g) => (g?.lastAt?.toMillis ? g.lastAt.toMillis() : (Number(g?.lastAt) || 0));

// ── Non-lus ───────────────────────────────────────────────────────────────────
const _advUnread = () => _advMsgs.filter(m => m.senderId !== _uid && _atMillis(m) > (_reads[ADV] || 0)).length;
const _groupUnread = (g) => (g.lastSenderId && g.lastSenderId !== _uid && _lastMillis(g) > (_reads[g.id] || 0)) ? 1 : 0;
const _totalUnread = () => _advUnread() + _groups.reduce((s, g) => s + _groupUnread(g), 0);

// ── Cycle de vie ──────────────────────────────────────────────────────────────
export async function initChat(uid) {
  _uid = uid || STATE.user?.uid || null;
  _teardownListeners();
  _advMsgs = []; _groups = []; _convoMsgs = []; _open = false; _view = 'list'; _openId = null;
  _editingId = null; _ghosts = new Set(); _replyTo = null; _searchOpen = false; _searchQ = '';
  _muted = localStorage.getItem('chat-muted') === '1'; _soundReady = false;
  _imgCache = new Map();
  _chatEmotes = [];
  _loadChatEmotes().then(() => { if (_open && _view === 'convo') _renderMessages(); });
  _baseTitle = (document.title || 'Le Grand JDR').replace(/^\(\d+\)\s*/, '');
  _prevUnread = 0;
  _mount();

  try { const s = await getDoc(_readRef()); const d = s.data() || {}; _reads = { ...d, [ADV]: Number(d[ADV] ?? d.at) || 0 }; }
  catch { _reads = {}; }

  _advLimit = HISTORY;
  _subscribeAdv();

  const ccol = _convosCol();
  if (ccol && _uid) _unsubGroups = onSnapshot(
    query(ccol, where('members', 'array-contains', _uid)),
    snap => { _groups = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).sort((a, b) => _lastMillis(b) - _lastMillis(a)); _onData('groups'); },
    err => console.warn('[chat] groups', err?.code || err),
  );
}

export function teardownChat() {
  _teardownListeners();
  document.getElementById('chat-widget')?.remove();
  if (_baseTitle) document.title = _baseTitle;
  _open = false; _advMsgs = []; _groups = []; _convoMsgs = []; _prevUnread = 0;
}

// Notifications discrètes (aucune règle Firestore) : compteur dans le titre de
// l'onglet + pulsation de la bulle quand du NON-LU apparaît (chat fermé ou autre
// conversation). Restauré à la lecture.
function _notify() {
  const n = _totalUnread();
  if (_baseTitle) document.title = n > 0 ? `(${n}) ${_baseTitle}` : _baseTitle;
  if (n > _prevUnread) { _pulseBubble(); if (_soundReady) { _beep(); _desktopNotify(); } }
  _prevUnread = n; _soundReady = true;   // les non-lus déjà là au chargement ne sonnent pas
}
// Aperçu du message non-lu le plus récent (pour la notif desktop).
function _lastPreview() {
  let best = null, bestAt = 0;
  const a = _advMsgs[_advMsgs.length - 1];
  if (a && a.senderId !== _uid) { best = `${a.senderName || ''}: ${a.text || '📷'}`; bestAt = _atMillis(a); }
  for (const g of _groups) {
    const at = _lastMillis(g);
    if (g.lastSenderId && g.lastSenderId !== _uid && at > bestAt) { best = `${g.lastSenderName || ''}: ${g.lastText || ''}`; bestAt = at; }
  }
  return best;
}
function _maybeRequestNotifPerm() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}
// Popup navigateur : seulement onglet caché + permission accordée + son non coupé.
function _desktopNotify() {
  try {
    if (_muted || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification('Le Grand JDR — messagerie', { body: _lastPreview() || 'Nouveau message', tag: 'grandjdr-chat' });
    n.onclick = () => { try { window.focus(); } catch {} n.close(); };
  } catch { /* best-effort */ }
}
// Bip court (WebAudio, sans asset). Coupé si mute ; best-effort (autoplay).
function _beep() {
  if (_muted) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    _audioCtx = _audioCtx || new Ctx();
    const ctx = _audioCtx; if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, ctx.currentTime);
    o.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.22);
  } catch { /* autoplay bloqué → silencieux */ }
}
function _pulseBubble() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  el.classList.remove('chat-notify'); void el.offsetWidth; el.classList.add('chat-notify');
  setTimeout(() => el.classList.remove('chat-notify'), 1200);
}
function _teardownListeners() {
  [_unsubAdv, _unsubGroups, _unsubConvo, _unsubTyping, _unsubReads, _unsubPresence].forEach(u => { if (u) try { u(); } catch {} });
  _unsubAdv = _unsubGroups = _unsubConvo = _unsubTyping = _unsubReads = _unsubPresence = null;
  clearTimeout(_typingClearTimer); clearTimeout(_typingRenderTimer);
}

// ── Statut en ligne (présence) : abonné seulement quand le panneau est ouvert ──
const _isOnline = (uid) => _online.has(uid);
function _subscribePresence() {
  if (_unsubPresence) return;
  const a = _adv(); if (!a) return;
  _unsubPresence = onSnapshot(collection(db, 'adventures', a, 'presence'), snap => {
    const now = Date.now(); const on = new Set();
    snap.docs.forEach(d => {
      const ls = d.data({ serverTimestamps: 'estimate' }).lastSeen;
      const ms = ls?.toMillis ? ls.toMillis() : 0;
      if (d.id !== _uid && now - ms < 120000) on.add(d.id);   // expiration 120 s, hors moi
    });
    _online = on;
    _updateOnlineDots();
  }, err => console.warn('[chat] presence', err?.code || err));
}
function _teardownPresence() {
  if (_unsubPresence) { try { _unsubPresence(); } catch {} _unsubPresence = null; }
  _online = new Set();
}
// Bascule la pastille sur les avatars déjà rendus (sans re-render → cases cochées préservées).
function _updateOnlineDots() {
  document.querySelectorAll('#chat-widget [data-online-uid]').forEach(el => {
    el.classList.toggle('is-online', _online.has(el.getAttribute('data-online-uid')));
  });
}

// Abonnements messages (avec limite paginée). Re-souscrits par « charger plus ».
function _subscribeAdv() {
  if (_unsubAdv) { try { _unsubAdv(); } catch {} _unsubAdv = null; }
  const mcol = _msgsCol(); if (!mcol) return;
  _unsubAdv = onSnapshot(
    query(mcol, where('convoId', '==', ADV), orderBy('at', 'desc'), limit(_advLimit)),
    snap => { _advMsgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse(); _onData(ADV); },
    err => console.warn('[chat] adv', err?.code, err?.message || err),
  );
}
function _subscribeConvo(id) {
  if (_unsubConvo) { try { _unsubConvo(); } catch {} _unsubConvo = null; }
  const mcol = _msgsCol(); if (!mcol) return;
  _unsubConvo = onSnapshot(
    query(mcol, where('convoId', '==', id), orderBy('at', 'desc'), limit(_convoLimit)),
    snap => { _convoMsgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse(); _onData('convo'); },
    err => console.warn('[chat] convo', err?.code, err?.message || err),
  );
}

// Nouveau lot de données reçu (source = ADV | 'groups' | 'convo')
function _onData(source) {
  if (!_open) { _renderBubble(); _notify(); return; }
  if (_view === 'list') _renderList();
  else if (_view === 'manage' && source === 'groups') _renderManage();
  else if (_view === 'convo') {
    // Rafraîchit le fil si la conv ouverte est concernée
    if ((_openId === ADV && source === ADV) || (_openId !== ADV && source === 'convo')) { _renderMessages(); _markReadLocal(_openId); }
    else _renderConvoHeaderBadge();
  }
  _notify();
}

// ── Montage ───────────────────────────────────────────────────────────────────
function _mount() {
  let el = document.getElementById('chat-widget');
  if (!el) { el = document.createElement('div'); el.id = 'chat-widget'; (document.getElementById('app') || document.body).appendChild(el); }
  _renderBubble();
}

// ── Rendus ────────────────────────────────────────────────────────────────────
function _renderBubble() {
  const el = document.getElementById('chat-widget'); if (!el || _open) return;
  const n = _totalUnread();
  el.innerHTML = `<button class="chat-bubble" data-action="chatToggle" title="Discussions" aria-label="Ouvrir les discussions">
    <span class="chat-bubble-ico">💬</span>${n > 0 ? `<span class="chat-badge">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
}

function _panelShell(title, headLeft, body, foot = '', headRight = '', subtitle = '') {
  return `<div class="chat-panel chat-panel--${_esc(_view)}" role="dialog" aria-label="Discussions">
    <div class="chat-head">
      <span class="chat-head-left">${headLeft}<span class="chat-head-copy"><span class="chat-head-title">${_esc(title)}</span>${subtitle ? `<span class="chat-head-subtitle">${_esc(subtitle)}</span>` : ''}</span></span>
      <span class="chat-head-right">${headRight}<button class="chat-close" data-action="chatToggle" aria-label="Fermer">✕</button></span>
    </div>
    ${body}${foot}
  </div>`;
}

// Vue LISTE : Aventure + groupes
function _renderList() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const advPrev = _advMsgs.length ? `${_advMsgs[_advMsgs.length - 1].senderName || ''} : ${_advMsgs[_advMsgs.length - 1].text || ''}` : 'Aucun message';
  const advN = _advUnread();
  const queryText = _listQ.trim().toLowerCase();
  const matches = (name, preview) => !queryText
    || String(name || '').toLowerCase().includes(queryText)
    || String(preview || '').toLowerCase().includes(queryText);
  const advRow = matches('Chat de l\'aventure', advPrev)
    ? _convoRow(ADV, '💬', 'Chat de l\'aventure', advPrev, advN, {
        meta: `${_advMembers().length + 1} membres`,
        time: _advMsgs.length ? _formatTime(_atMillis(_advMsgs[_advMsgs.length - 1])) : '',
        featured: true,
      })
    : '';
  const groupRows = _groups.map(g => {
    const isDm = g.type === 'dm';
    const prev = g.lastText ? `${g.lastSenderName || ''} : ${g.lastText}` : (isDm ? 'Nouvelle discussion' : 'Nouveau groupe');
    if (!matches(_convoTitle(g), prev)) return '';
    // DM : avatar de l'autre membre ; groupe : avatar du dernier auteur.
    const avUid = isDm ? _otherDmUid(g) : g.lastSenderId;
    const ico = avUid
      ? `<img class="chat-conv-avimg${isDm && _isOnline(avUid) ? ' is-online' : ''}"${isDm ? ` data-online-uid="${_esc(avUid)}"` : ''} src="${_esc(avatarSrcOf(_profileOf(avUid)))}" alt="">`
      : (isDm ? '👤' : '👥');
    return _convoRow(g.id, ico, _convoTitle(g), prev, _groupUnread(g) ? '•' : 0, {
      meta: isDm ? (_isOnline(avUid) ? 'En ligne' : 'Message privé') : `${(g.members || []).length} membres`,
      time: _formatTime(_atMillis({ at: g.lastAt })),
      online: isDm && _isOnline(avUid),
    });
  }).join('');
  const rows = `${advRow}${groupRows}` || `<div class="chat-empty chat-empty--list">${queryText ? 'Aucune discussion trouvée.' : 'Aucune discussion pour le moment.'}</div>`;
  const unread = _totalUnread();
  el.innerHTML = _panelShell('Messages', '',
    `<div class="chat-list-tools">
       <div class="chat-list-search">
         <span class="chat-list-search-ico">🔎</span>
         <input id="chat-list-search" value="${_esc(_listQ)}" placeholder="Rechercher une discussion..." autocomplete="off">
         ${_listQ ? '<button class="chat-list-clear" data-action="chatClearListSearch" aria-label="Effacer la recherche">✕</button>' : ''}
       </div>
     </div>
     <div class="chat-convo-list">${rows}</div>`,
    `<div class="chat-list-foot"><button class="chat-newbtn" data-action="chatNew">＋ Nouvelle discussion</button></div>`,
    `<button class="chat-gear" data-action="chatToggleMute" title="${_muted ? 'Activer le son' : 'Couper le son'}" aria-label="Son des notifications">${_muted ? '🔕' : '🔔'}</button>`,
    unread ? `${unread} non lu${unread > 1 ? 's' : ''}` : 'Aventure et messages privés');
  const search = el.querySelector('#chat-list-search');
  search?.addEventListener('input', (e) => {
    _listQ = e.target.value;
    _renderList();
    const next = document.getElementById('chat-list-search');
    next?.focus();
    next?.setSelectionRange(next.value.length, next.value.length);
  });
}

function _convoRow(id, icon, name, preview, badge, opts = {}) {
  const b = badge === '•' ? '<span class="chat-conv-dot"></span>'
          : (badge > 0 ? `<span class="chat-badge chat-badge--inline">${badge > 99 ? '99+' : badge}</span>` : '');
  return `<button class="chat-conv${opts.featured ? ' chat-conv--featured' : ''}" data-action="chatOpenConvo" data-convo="${_esc(id)}">
    <span class="chat-conv-ico${opts.online ? ' is-online' : ''}">${icon}</span>
    <span class="chat-conv-body">
      <span class="chat-conv-top"><span class="chat-conv-name">${_esc(name)}</span>${opts.time ? `<span class="chat-conv-time">${_esc(opts.time)}</span>` : ''}</span>
      <span class="chat-conv-prev">${_esc(preview)}</span>
      ${opts.meta ? `<span class="chat-conv-meta">${_esc(opts.meta)}</span>` : ''}
    </span>
    ${b}</button>`;
}

// Vue CONVERSATION : fil de messages
function _renderConvo() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const g = _convoById(_openId);
  const title = _openId === ADV ? 'Chat de l\'aventure' : _convoTitle(g);
  const otherUid = g?.type === 'dm' ? _otherDmUid(g) : null;
  const subtitle = _openId === ADV
    ? `${_advMembers().length + 1} membres`
    : (g?.type === 'dm' ? (_isOnline(otherUid) ? 'En ligne' : 'Message privé') : `${(g?.members || []).length} membres`);
  const headAvatar = _openId === ADV
    ? '<span class="chat-head-avatar">💬</span>'
    : (otherUid
        ? `<img class="chat-head-avatar${_isOnline(otherUid) ? ' is-online' : ''}" data-online-uid="${_esc(otherUid)}" src="${_esc(avatarSrcOf(_profileOf(otherUid)))}" alt="">`
        : '<span class="chat-head-avatar">👥</span>');
  // ⚙️ Gérer : uniquement pour un vrai GROUPE (pas l'aventure, pas un DM).
  const gear = (g && g.type !== 'dm')
    ? '<button class="chat-gear" data-action="chatManage" title="Gérer le groupe" aria-label="Gérer le groupe">⚙️</button>' : '';
  const search = '<button class="chat-gear" data-action="chatSearchToggle" title="Rechercher" aria-label="Rechercher">🔍</button>';
  el.innerHTML = _panelShell(title,
    `<button class="chat-back" data-action="chatBack" aria-label="Retour">‹</button>${headAvatar}`,
    `<div class="chat-search" id="chat-search" ${_searchOpen ? '' : 'hidden'}>
       <input id="chat-search-inp" class="chat-input" placeholder="🔍 Rechercher dans la conversation…" value="${_esc(_searchQ)}" autocomplete="off">
     </div>
     <div class="chat-msgs" id="chat-msgs"></div>
     <button class="chat-new-pill" id="chat-new-pill" data-action="chatScrollBottom" hidden>↓ Nouveaux messages</button>
     <div class="chat-typing" id="chat-typing" hidden></div>`,
    `<form class="chat-form" id="chat-form">
       <div class="chat-edit-bar" id="chat-edit-bar" hidden>✏️ Édition — <button type="button" class="chat-edit-cancel" data-action="chatCancelEdit">annuler</button></div>
       <div class="chat-reply-bar" id="chat-reply-bar" hidden></div>
       <div class="chat-form-row">
         <button type="button" class="chat-emoji-btn" data-action="chatEmojiToggle" title="Emoji" aria-label="Insérer un emoji">😊</button>
         <button type="button" class="chat-emoji-btn" data-action="chatPickImage" title="Envoyer une image" aria-label="Envoyer une image">📎</button>
         <button type="button" class="chat-emoji-btn" data-action="chatRollHint" title="Lancer des dés (ex : /roll 1d20+3)" aria-label="Lancer des dés">🎲</button>
         <input type="file" id="chat-file" accept="image/*" hidden>
         <div id="chat-input" class="chat-input chat-input-ce" contenteditable="true" role="textbox" aria-label="Message" data-placeholder="Écris un message…"></div>
         <button type="submit" class="chat-send" aria-label="Envoyer">➤</button>
       </div>
     </form>`,
    search + gear,
    subtitle);
  el.querySelector('#chat-form')?.addEventListener('submit', (e) => { e.preventDefault(); _send(); });
  el.querySelector('#chat-search-inp')?.addEventListener('input', (e) => { _searchQ = e.target.value; _renderMessages(); });
  el.querySelector('#chat-file')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) _sendImage(f); });
  const ce = el.querySelector('#chat-input');
  ce?.addEventListener('input', _onComposerInput);
  ce?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('chat-mention-menu')) { _closeMentionMenu(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const first = document.querySelector('#chat-mention-menu [data-uid]');
      if (first) first.click(); else _send();   // menu mention ouvert → sélectionne, sinon envoie
    }
  });
  el.querySelector('#chat-msgs')?.addEventListener('scroll', (e) => {
    const l = e.target;
    if (l.scrollHeight - l.scrollTop - l.clientHeight < 60) _hideNewPill();
  });
  if (_typing.length) _renderTyping();
  if (_replyTo) _showReplyBar();
  if (!_editingId) _restoreDraft();
  _renderMessages();
  el.querySelector(_searchOpen ? '#chat-search-inp' : '#chat-input')?.focus();
}
function _renderConvoHeaderBadge() { /* pas de badge d'en-tête pour l'instant */ }

// Libellé de jour pour les séparateurs de date (logique pure → chat-format.js).
const _dayLabel = (ms) => dayLabel(ms);
function _formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(now) - day0(d)) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function _showNewPill() { document.getElementById('chat-new-pill')?.removeAttribute('hidden'); }
function _hideNewPill() { document.getElementById('chat-new-pill')?.setAttribute('hidden', ''); }

function _renderMessages() {
  const list = document.getElementById('chat-msgs'); if (!list) return;
  const all = _openId === ADV ? _advMsgs : _convoMsgs;
  const q = _searchOpen ? _searchQ.trim().toLowerCase() : '';
  const msgs = q ? all.filter(m => !m.deleted && (m.text || '').toLowerCase().includes(q)) : all;

  // Scroll intelligent : suivre le bas seulement si on y est déjà.
  const prevTop = list.scrollTop, prevHeight = list.scrollHeight;
  const nearBottom = prevHeight - prevTop - list.clientHeight < 60;
  const lastId = all.length ? all[all.length - 1].id : null;
  const isNew = lastId && lastId !== _lastRenderedLastId;

  let html = '';
  const curLimit = _openId === ADV ? _advLimit : _convoLimit;
  if (!msgs.length) {
    html = `<div class="chat-empty">${q ? 'Aucun message trouvé.' : 'Aucun message. Lance la discussion !'}</div>`;
  } else {
    // Il y a peut-être plus ancien si on a atteint la limite courante.
    if (!q && all.length >= curLimit) html += `<button class="chat-load-more" data-action="chatLoadMore">⤒ Messages plus anciens</button>`;
    let prevDay = '', prevSender = null, prevAt = 0;
    for (const m of msgs) {
      const at = _atMillis(m) || Date.now();
      const day = _dayLabel(at);
      const dayChanged = day !== prevDay;
      if (dayChanged) { html += `<div class="chat-date-sep"><span>${_esc(day)}</span></div>`; prevDay = day; prevSender = null; }
      // Regroupement : même auteur, < 5 min, même jour → on masque avatar + nom.
      const grouped = !dayChanged && !m.deleted && m.senderId === prevSender && (at - prevAt) < 300000;
      html += _msgRow(m, grouped);
      prevSender = m.deleted ? null : m.senderId; prevAt = at;
    }
  }
  // « Vu » (DM) : sous mon dernier message si l'autre l'a lu.
  if (!q && _convoById(_openId)?.type === 'dm') {
    const mine = all.filter(m => m.senderId === _uid && !m.deleted);
    const last = mine[mine.length - 1];
    if (last && _otherReads >= _atMillis(last)) html += '<div class="chat-seen">Vu</div>';
  }
  list.innerHTML = html;

  if (q) { list.scrollTop = 0; }
  else if (nearBottom) { list.scrollTop = list.scrollHeight; _hideNewPill(); }
  else {
    list.scrollTop = prevTop + (list.scrollHeight - prevHeight);   // préserve la position
    if (isNew) _showNewPill();
  }
  _lastRenderedLastId = lastId;
  _hydrateImages();   // charge les images référencées (async, cache d'abord)
}

// Profil (pour l'avatar) d'un uni : le mien via STATE, les autres via
// memberProfiles (avatar dénormalisé → aucune lecture users/{uid}).
function _profileOf(uid) {
  if (uid === _uid) return STATE.profile || {};
  const p = (STATE.adventure?.memberProfiles || {})[uid];
  return (p && typeof p === 'object') ? p : {};
}
function _nameOf(uid) { const p = _profileOf(uid); return p.pseudo || p.email || `Joueur ${String(uid || '').slice(0, 6)}…`; }

// Membres de l'aventure (hors moi et hors fantômes confirmés). Source AUTORITAIRE :
// union de accessList/admins/players/memberProfiles → un vrai membre apparaît
// toujours, même sans profil dénormalisé (les noms/avatars, eux, viennent de
// memberProfiles, complété au besoin par _healMembers pour le super-admin).
function _advMembers() {
  const adv = STATE.adventure || {};
  const set = new Set([
    ...(adv.accessList || []), ...(adv.admins || []),
    ...(adv.players || []), ...Object.keys(adv.memberProfiles || {}),
  ]);
  return [...set].filter(u => u && u !== _uid && !_ghosts.has(u));
}

// Groupe ↔ DM : titre + autre interlocuteur. Un DM (type:'dm') affiche l'AUTRE
// membre (nom + avatar) ; un groupe affiche son nom.
const _convoById = (id) => _groups.find(g => g.id === id) || null;
function _otherDmUid(g) { return (g?.members || []).find(u => u !== _uid) || null; }
function _convoTitle(g) {
  if (!g) return 'Discussion';
  if (g.id === ADV) return 'Chat de l\'aventure';
  if (g.type === 'dm') return _nameOf(_otherDmUid(g));
  return g.name || 'Groupe';
}

// Agrège reactions {uid:emoji} → puces {emoji: count}, la mienne surlignée.
function _reactionsHtml(m) {
  const r = m.reactions || {};
  const counts = {};
  for (const u in r) { const e = r[u]; if (e) counts[e] = (counts[e] || 0) + 1; }
  const emojis = Object.keys(counts);
  if (!emojis.length) return '';
  const mine = r[_uid] || '';
  return `<span class="chat-msg-reacts">${emojis.map(e =>
    `<button class="chat-react-chip${e === mine ? ' is-mine' : ''}" data-action="chatReact" data-msg="${_esc(m.id)}" data-emo="${_esc(e)}">${e} ${counts[e]}</button>`
  ).join('')}</span>`;
}

// Émotes custom :nom: → <img> (mêmes émotes que le VTT, world/vtt_emotes).
async function _loadChatEmotes() {
  try { const d = await getDocData('world', 'vtt_emotes'); _chatEmotes = Array.isArray(d?.emotes) ? d.emotes.filter(e => e && e.name && e.url) : []; }
  catch { _chatEmotes = []; }
}
// Wrappers : la logique pure vit dans chat/chat-format.js (testée) ; ici on ne
// fait qu'injecter l'état du module (émotes chargées, uid courant, pseudos).
const _applyChatEmotes  = (s) => applyEmotes(s, _chatEmotes);
const _applyMentions    = (s) => applyMentions(s, _uid, _nameOf);
const _mentionsToTokens = (s) => mentionsToTokens(s, _nameOf);
const _linkify          = linkify;
const _rollDice         = rollDice;
const _rollCardHtml     = rollCardHtml;

function _msgRow(m, grouped = false) {
  const mine = m.senderId === _uid;
  const time = new Date(_atMillis(m) || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Message groupé (même auteur qui enchaîne) : avatar → espaceur, pas de nom.
  const av = mine ? '' : (grouped
    ? '<span class="chat-msg-av-spacer"></span>'
    : `<img class="chat-msg-av" src="${_esc(avatarSrcOf(_profileOf(m.senderId)))}" alt="" loading="lazy">`);
  const author = (mine || grouped) ? '' : `<span class="chat-msg-author">${_esc(m.senderName || '?')}</span>`;
  const grpCls = grouped ? ' chat-msg--grouped' : '';
  if (m.deleted) {
    return `<div class="chat-msg${mine ? ' chat-msg--mine' : ''}${grpCls}" data-mid="${_esc(m.id)}">${av}
      <span class="chat-msg-content">${author}
        <span class="chat-msg-bubble chat-msg-bubble--del">Message supprimé</span>
      </span></div>`;
  }
  const edited = m.editedAt ? ' <span class="chat-msg-edited">(modifié)</span>' : '';
  const quote = m.replyTo
    ? `<span class="chat-msg-quote" role="button" data-action="chatJumpTo" data-msg="${_esc(m.replyTo.id || '')}" title="Aller au message"><span class="chat-quote-name">${_esc(m.replyTo.senderName || '')}</span><span class="chat-quote-text">${_esc(m.replyTo.text || '📷 Image')}</span></span>` : '';
  const img = m.image
    ? `<img class="chat-msg-img" src="${_esc(m.image)}" alt="image" loading="lazy">`                    // legacy inline
    : (m.imageId ? `<img class="chat-msg-img chat-msg-img--loading" data-img-id="${_esc(m.imageId)}" alt="image">` : '');
  // Ordre : échappe → linkify (sur texte pur) → émotes/mentions. Linkifier en
  // dernier capturait l'URL du src des <img> d'émote (→ src cassé, 404).
  const txt = m.text ? `<span class="chat-msg-btext">${_applyMentions(_applyChatEmotes(_linkify(_esc(m.text))))}</span>` : '';
  const mentionsMe = !mine && _uid && (m.text || '').includes(`@[${_uid}]`);
  return `<div class="chat-msg${mine ? ' chat-msg--mine' : ''}${mentionsMe ? ' chat-msg--mention' : ''}${grpCls}" data-mid="${_esc(m.id)}">${av}
    <span class="chat-msg-content">${author}
      <span class="chat-msg-bubble-wrap">
        <span class="chat-msg-bubble${((m.image || m.imageId) && !m.text) || m.roll ? ' chat-msg-bubble--media' : ''}">${quote}${m.roll ? _rollCardHtml(m.roll) : `${img}${txt}`}</span>
        <button class="chat-msg-menu-btn" data-action="chatMsgMenu" data-msg="${_esc(m.id)}" title="Réagir / modifier" aria-label="Options du message">⋯</button>
      </span>
      ${_reactionsHtml(m)}
      <span class="chat-msg-time">${time}${edited}</span>
    </span></div>`;
}

// Vue NOUVELLE DISCUSSION : nom + choix des membres
function _renderNew() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const adv = STATE.adventure || {};
  const profiles = adv.memberProfiles || {};
  // Liste depuis la source autoritaire (accessList…), pas seulement memberProfiles :
  // un vrai membre ne disparaît jamais faute de profil dénormalisé. Les fantômes
  // (comptes supprimés) sont détectés puis masqués par _healMembers (super-admin).
  const members = _advMembers();
  const profOf = (u) => (typeof profiles[u] === 'string' ? { pseudo: profiles[u] } : (profiles[u] || {}));
  const rows = members.length
    ? members.map(u => {
        const p = profOf(u);
        const name = p.pseudo || p.email || `Joueur ${u.slice(0, 6)}…`;
        return `<div class="chat-member-row">
          <label class="chat-member">
            <input type="checkbox" value="${_esc(u)}">
            <img class="chat-member-av${_isOnline(u) ? ' is-online' : ''}" data-online-uid="${_esc(u)}" src="${_esc(avatarSrcOf(p))}" alt="" loading="lazy">
            <span class="chat-member-name">${_esc(name)}</span>
          </label>
          <button type="button" class="chat-mini-btn" data-action="chatStartDm" data-uid="${_esc(u)}" title="Message privé">💬</button>
        </div>`;
      }).join('')
    : `<div class="chat-empty">Aucun autre membre à ajouter.</div>`;
  el.innerHTML = _panelShell('Nouvelle discussion',
    '<button class="chat-back" data-action="chatBack" aria-label="Retour">‹</button>',
    `<div class="chat-new">
       <input id="chat-new-name" class="chat-input chat-new-name" placeholder="Nom du groupe" maxlength="40">
       <div class="chat-new-lbl">Membres <span style="font-weight:400;opacity:.7">— coche pour un groupe, ou 💬 pour un message privé</span></div>
       <div class="chat-member-list" id="chat-members">${rows}</div>
     </div>`,
    `<div class="chat-list-foot"><button class="chat-newbtn" data-action="chatCreateGroup">Créer le groupe</button></div>`);
  _healMembers(members);
}

// Super-admin uniquement : complète memberProfiles (pseudo + email + avatar) pour
// les membres au profil manquant/incomplet en lisant users/{uid} (autorisé au
// super-admin). Un compte SUPPRIMÉ (doc users absent) est marqué fantôme → masqué.
// Affichage immédiat (mémoire) + persistance best-effort (profite à tous si tu es
// admin de l'aventure). Sans ça, la liste reste correcte (source = accessList).
async function _healMembers(members) {
  if (!STATE.isSuperAdmin) return;
  const adv = STATE.adventure; if (!adv?.id) return;
  adv.memberProfiles = adv.memberProfiles || {};
  const profiles = adv.memberProfiles;
  const toCheck = members.filter(u => {
    const p = profiles[u];
    return !(p && typeof p === 'object' && p.pseudo && p.avatarIcon !== undefined);
  });
  if (!toCheck.length) return;
  const patch = {}; let changed = false, ghostFound = false;
  for (const u of toCheck) {
    try {
      const snap = await getDoc(doc(db, 'users', u));
      if (!snap.exists()) { _ghosts.add(u); ghostFound = true; continue; }   // compte supprimé
      const d = snap.data() || {};
      const entry = { pseudo: d.pseudo || d.email || '', email: d.email || '', avatarIcon: d.avatarIcon || '' };
      profiles[u] = { ...(typeof profiles[u] === 'object' && profiles[u] ? profiles[u] : {}), ...entry };
      patch[`memberProfiles.${u}`] = profiles[u];
      changed = true;
    } catch { /* accès refusé → on ignore, la liste reste bonne */ }
  }
  if (_open && _view === 'new') _renderNew();
  else if (_open && _view === 'manage') _renderManage();
  if (changed) updateDoc(doc(db, 'adventures', adv.id), patch).catch(() => {});
  void ghostFound;
}

// ── Actions ───────────────────────────────────────────────────────────────────
function chatToggle() {
  _open = !_open;
  if (_open) { _maybeRequestNotifPerm(); _subscribePresence(); _view = 'list'; _renderList(); }
  else { if (_openId) _markRead(_openId); _teardownConvo(); _teardownPresence(); _renderBubble(); }
}
function chatBack() { _teardownConvo(); _view = 'list'; _renderList(); }

function chatOpenConvo(btn) {
  const id = btn?.dataset?.convo; if (!id) return;
  _teardownConvo();
  _openId = id; _view = 'convo';
  _renderConvo();
  if (id === ADV) { _markRead(ADV); }
  else {
    _convoLimit = HISTORY;
    _subscribeConvo(id);
    _markRead(id);
  }
  _subscribeTyping(id);
  if (_convoById(id)?.type === 'dm') _subscribeReads(id);
}
function _teardownConvo() {
  if (_unsubConvo) { try { _unsubConvo(); } catch {} _unsubConvo = null; }
  if (_unsubTyping) { try { _unsubTyping(); } catch {} _unsubTyping = null; }
  if (_unsubReads) { try { _unsubReads(); } catch {} _unsubReads = null; }
  _convoMsgs = []; _typing = []; _otherReads = 0; _lastRenderedLastId = null;
  clearTimeout(_typingClearTimer); clearTimeout(_typingRenderTimer);
  if (_typingWroteAt) _clearTyping();   // signale qu'on n'écrit plus
  _editingId = null; _replyTo = null; _searchOpen = false; _searchQ = '';   // états liés à la conv
  _closeEmojiPop(); _closeMentionMenu();
}

// ── « écrit… » (typing) — quota strict : 1 doc/joueur, write throttlé à 4 s,
// suspendu si onglet caché, listener seulement quand une conv est ouverte. ──
function _subscribeTyping(convoId) {
  const col = _typingCol(); if (!col) return;
  _unsubTyping = onSnapshot(col, snap => {
    const now = Date.now();
    _typing = snap.docs
      .map(d => ({ uid: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
      .filter(t => t.uid !== _uid && t.convoId === convoId && _atMillis({ at: t.at }) > now - 6000)
      .map(t => t.uid);
    _renderTyping();
  }, err => console.warn('[chat] typing', err?.code || err));
}
function _signalTyping() {
  if (document.hidden || !_openId) return;
  const now = Date.now();
  if (now - _typingWroteAt > 4000) {   // throttle : jamais par frappe
    _typingWroteAt = now;
    const ref = _typingRef();
    if (ref) setDoc(ref, { convoId: _openId, at: serverTimestamp() }).catch(() => {});
  }
  clearTimeout(_typingClearTimer);
  _typingClearTimer = setTimeout(_clearTyping, 5000);   // arrêt de frappe → efface
}
function _clearTyping() {
  clearTimeout(_typingClearTimer);
  if (!_typingWroteAt) return;
  _typingWroteAt = 0;
  const ref = _typingRef();
  if (ref) setDoc(ref, { convoId: '', at: 0 }).catch(() => {});
}
function _renderTyping() {
  const el = document.getElementById('chat-typing'); if (!el) return;
  const names = _typing.map(_nameOf);
  if (!names.length) { el.textContent = ''; el.hidden = true; return; }
  el.textContent = '✍️ ' + (names.length === 1
    ? `${names[0]} écrit…`
    : `${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''} écrivent…`);
  el.hidden = false;
  clearTimeout(_typingRenderTimer);
  _typingRenderTimer = setTimeout(() => { _typing = []; _renderTyping(); }, 6000);
}

// ── « Vu » (DM) : on écoute le doc chatReads de l'AUTRE (1 listener). ──
function _subscribeReads(convoId) {
  const other = _otherDmUid(_convoById(convoId)); if (!other) return;
  const ref = _readsRefOf(other); if (!ref) return;
  _unsubReads = onSnapshot(ref, snap => {
    _otherReads = Number(snap.data()?.[convoId]) || 0;
    if (_view === 'convo' && _openId === convoId) _renderMessages();
  }, err => console.warn('[chat] reads', err?.code || err));
}

function chatNew() { _view = 'new'; _renderNew(); }

async function chatCreateGroup() {
  const name = (document.getElementById('chat-new-name')?.value || '').trim();
  const picked = [...document.querySelectorAll('#chat-members input:checked')].map(c => c.value);
  if (!name) { showNotif('Donne un nom au groupe.', 'error'); return; }
  if (!picked.length) { showNotif('Choisis au moins un membre.', 'error'); return; }
  const ccol = _convosCol(); if (!ccol) return;
  const members = [...new Set([_uid, ...picked])];
  try {
    const ref = await addDoc(ccol, {
      type: 'group', name, members, createdBy: _uid,
      lastText: '', lastSenderName: '', lastSenderId: '', lastAt: serverTimestamp(),
    });
    showNotif('Groupe créé.', 'success');
    // Ouvre directement le nouveau groupe (le listener le fera aussi apparaître dans la liste)
    _teardownConvo();
    chatOpenConvo({ dataset: { convo: ref.id } });
  } catch (e) { console.warn('[chat] createGroup', e?.code || e); showNotif('Création impossible (règles Firestore ?).', 'error'); }
}

function _senderName() { return STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || 'Joueur'; }
// Met à jour l'aperçu du dernier message (groupe/DM) pour la liste + non-lus.
function _bumpConvoPreview(preview, senderName) {
  if (_openId === ADV) return;
  const ref = _convoRef(_openId);
  if (ref) updateDoc(ref, { lastText: preview, lastSenderName: senderName, lastSenderId: _uid, lastAt: serverTimestamp() }).catch(() => {});
}

// Envoi d'un message texte (réutilisé pour l'envoi direct d'une émote).
async function _sendText(text, preview) {
  text = (text || '').trim();
  if (!text || !_openId) return false;
  const col = _msgsCol(); if (!col || !_uid) return false;
  const senderName = _senderName();
  const reply = _replyTo; _clearReply();
  const msg = { convoId: _openId, text, senderId: _uid, senderName, at: serverTimestamp() };
  if (reply) msg.replyTo = reply;
  _clearTyping();
  try {
    await addDoc(col, msg);
    _bumpConvoPreview(preview || text, senderName);
    return true;
  } catch (e) {
    console.warn('[chat] send', e?.code || e);
    showNotif('Message non envoyé — règles Firestore ?', 'error');
    return false;
  }
}

async function _send() {
  if (!_openId) return;
  const text = _composerText();
  if (!text) return;
  if (_editingId) { _saveEdit(text); return; }        // mode édition d'un message
  // Commande /roll (ou /r) : jet de dés → message-jet.
  const rm = text.match(/^\/(?:roll|r)\s+(.+)$/i);
  if (rm) {
    const roll = _rollDice(rm[1]);
    if (roll) { _clearComposer(); _clearDraft(); _sendRoll(roll); return; }
    showNotif('Jet invalide. Ex : /roll 1d20+3', 'error'); return;
  }
  _clearComposer();
  const ok = await _sendText(text);
  if (!ok) _setComposer(text);                         // restaure en cas d'échec
  else _clearDraft();
}
async function _sendRoll(roll) {
  const col = _msgsCol(); if (!col || !_openId || !_uid) return;
  const senderName = _senderName();
  const fallback = `🎲 ${roll.expr} = ${roll.total}`;
  const reply = _replyTo; _clearReply();
  const msg = { convoId: _openId, text: fallback, roll, senderId: _uid, senderName, at: serverTimestamp() };
  if (reply) msg.replyTo = reply;
  _clearTyping();
  try { await addDoc(col, msg); _bumpConvoPreview(fallback, senderName); }
  catch (e) { console.warn('[chat] roll', e?.code || e); showNotif('Jet non envoyé — règles Firestore ?', 'error'); }
}

// Envoi d'une image : compressée en JPEG base64 borné (reste sous la limite
// Firestore de 1 Mo). QUOTA : le binaire vit dans sa PROPRE collection
// (chatImages) et le message ne porte qu'un `imageId` → la liste des messages
// reste légère (le listener session-live du chat d'aventure ne re-télécharge
// plus les blobs), et l'image n'est chargée qu'à l'affichage, une fois par
// session (cache mémoire + IndexedDB). Compat : les anciens messages `image`
// inline restent rendus tels quels.
async function _sendImage(file) {
  if (!file || !_openId) return;
  const col = _msgsCol(), icol = _imgsCol(); if (!col || !icol || !_uid) return;
  let image;
  try { image = await uploadJpeg(file, { max: 1000, quality: 0.72 }); }
  catch { showNotif('Image invalide.', 'error'); return; }
  if (!image || image.length > 950000) { showNotif('Image trop lourde même compressée.', 'error'); return; }
  const senderName = _senderName();
  const reply = _replyTo; _clearReply();
  try {
    const imgRef = await addDoc(icol, { convoId: _openId, data: image, senderId: _uid, at: serverTimestamp() });
    _imgCache.set(imgRef.id, image);   // affichage immédiat sans relire
    const msg = { convoId: _openId, text: '', imageId: imgRef.id, senderId: _uid, senderName, at: serverTimestamp() };
    if (reply) msg.replyTo = reply;
    await addDoc(col, msg);
    _bumpConvoPreview('📷 Image', senderName);
  } catch (e) { console.warn('[chat] img', e?.code || e); showNotif('Image non envoyée — règles Firestore ?', 'error'); }
}

// Charge une image référencée : mémoire → cache IndexedDB (0 lecture facturée)
// → serveur (1 lecture, une seule fois par session).
async function _getImage(id) {
  if (_imgCache.has(id)) return _imgCache.get(id);
  const ref = _imgRef(id); if (!ref) return null;
  let snap = null;
  try { snap = await getDocFromCache(ref); } catch { /* pas encore en cache */ }
  if (!snap || !snap.exists()) { try { snap = await getDoc(ref); } catch { return null; } }
  const data = snap?.data()?.data || null;
  if (data) _imgCache.set(id, data);
  return data;
}
// Remplit les <img data-img-id> du fil après rendu (async, sans re-render).
function _hydrateImages() {
  document.querySelectorAll('#chat-msgs img[data-img-id]:not([src])').forEach(async (el) => {
    const data = await _getImage(el.getAttribute('data-img-id'));
    if (!data) { el.closest('.chat-msg-bubble')?.insertAdjacentHTML('beforeend', '<span class="chat-msg-btext" style="opacity:.6">📷 Image indisponible</span>'); el.remove(); return; }
    const list = document.getElementById('chat-msgs');
    const stick = list && (list.scrollHeight - list.scrollTop - list.clientHeight < 60);
    el.src = data;
    el.onload = () => { if (stick && list) list.scrollTop = list.scrollHeight; };
  });
}

function _markReadLocal(convoId) {
  const msgs = convoId === ADV ? _advMsgs : (_openId === convoId ? _convoMsgs : []);
  const latest = msgs.length ? _atMillis(msgs[msgs.length - 1]) : 0;
  _reads[convoId] = Math.max(_reads[convoId] || 0, latest, Date.now());
}
async function _markRead(convoId) {
  _markReadLocal(convoId);
  _notify();                       // titre d'onglet à jour après lecture
  const ref = _readRef(); if (!ref) return;
  try { await setDoc(ref, { [convoId]: _reads[convoId] }, { merge: true }); } catch { /* non bloquant */ }
}

// ── Messages privés (DM) ────────────────────────────────────────────────────
// Convo déterministe (1 par paire). Créée à la volée si absente, puis ouverte.
async function chatStartDm(btn) {
  const other = btn?.dataset?.uid; if (!other || other === _uid || !_uid) return;
  const id = _dmId(_uid, other);
  // Le DM existe déjà (déjà dans mes convos via le listener array-contains) → on ouvre.
  // On NE lit PAS le doc : lire un doc inexistant fait échouer la règle read
  // (resource == null) → permission-denied. Sinon on le CRÉE (règle create OK).
  if (_convoById(id)) { _teardownConvo(); chatOpenConvo({ dataset: { convo: id } }); return; }
  const ref = _convoRef(id); if (!ref) return;
  try {
    await setDoc(ref, {
      type: 'dm', name: '', members: [_uid, other], createdBy: _uid,
      lastText: '', lastSenderName: '', lastSenderId: '', lastAt: serverTimestamp(),
    });
    // Optimiste : présent tout de suite (le listener le confirmera).
    _groups = [{ id, type: 'dm', members: [_uid, other], name: '', lastAt: 0 }, ..._groups];
    _teardownConvo();
    chatOpenConvo({ dataset: { convo: id } });
  } catch (e) {
    console.warn('[chat] startDm', e?.code || e);
    // Cas rare : l'autre vient de créer le DM (course) → il apparaîtra via le
    // listener ; on tente une ouverture directe plutôt qu'une erreur.
    if (e?.code === 'permission-denied' || e?.code === 'already-exists') {
      _teardownConvo(); chatOpenConvo({ dataset: { convo: id } });
    } else {
      showNotif('Ouverture du DM impossible (règles Firestore ?).', 'error');
    }
  }
}

// ── Réactions emoji ─────────────────────────────────────────────────────────
async function chatReact(btn) {
  const id = btn?.dataset?.msg, emo = btn?.dataset?.emo;
  if (!id || !emo || !_uid) return;
  _closeMsgMenu();
  const msgs = _openId === ADV ? _advMsgs : _convoMsgs;
  const m = msgs.find(x => x.id === id); if (!m || m.deleted) return;
  const cur = (m.reactions || {})[_uid] || '';
  const ref = _msgRef(id); if (!ref) return;
  const field = `reactions.${_uid}`;
  try { await updateDoc(ref, { [field]: cur === emo ? deleteField() : emo }); }
  catch (e) { console.warn('[chat] react', e?.code || e); showNotif('Réaction refusée — règles Firestore ?', 'error'); }
}

// ── Édition / suppression de SES messages ───────────────────────────────────
function chatEditMsg(btn) {
  const id = btn?.dataset?.msg; if (!id) return;
  _closeMsgMenu();
  const msgs = _openId === ADV ? _advMsgs : _convoMsgs;
  const m = msgs.find(x => x.id === id); if (!m || m.senderId !== _uid || m.deleted) return;
  _editingId = id;
  _setComposer(m.text || '');
  document.getElementById('chat-edit-bar')?.removeAttribute('hidden');
}
function _cancelEditUi() { _editingId = null; document.getElementById('chat-edit-bar')?.setAttribute('hidden', ''); }
function chatCancelEdit() { _cancelEditUi(); _clearComposer(); }

async function _saveEdit(text) {
  const id = _editingId; const ref = _msgRef(id); if (!ref) return;
  try {
    await updateDoc(ref, { text, editedAt: serverTimestamp() });
    _cancelEditUi();
    _clearComposer();
    // Si c'était le dernier message d'un groupe/DM, met l'aperçu à jour.
    if (_openId !== ADV) {
      const msgs = _convoMsgs; const last = msgs[msgs.length - 1];
      if (last && last.id === id) { const r = _convoRef(_openId); if (r) updateDoc(r, { lastText: text }).catch(() => {}); }
    }
  } catch (e) { console.warn('[chat] edit', e?.code || e); showNotif('Modification refusée — règles Firestore ?', 'error'); }
}

async function chatDeleteMsg(btn) {
  const id = btn?.dataset?.msg; if (!id) return;
  _closeMsgMenu();
  const msgs = _openId === ADV ? _advMsgs : _convoMsgs;
  const m = msgs.find(x => x.id === id); if (!m || (m.senderId !== _uid && !STATE.isAdmin)) return;
  if (!await confirmModal('Supprimer ce message ?')) return;
  if (_editingId === id) chatCancelEdit();
  const ref = _msgRef(id); if (!ref) return;
  try {
    await deleteDoc(ref);   // vraie suppression : le message disparaît
    if (m.imageId) { const ir = _imgRef(m.imageId); if (ir) deleteDoc(ir).catch(() => {}); }   // blob orphelin
  }
  catch (e) { console.warn('[chat] del', e?.code || e); showNotif('Suppression refusée — règles Firestore ?', 'error'); }
}

// ── Gestion d'un groupe ─────────────────────────────────────────────────────
function chatManage() { const g = _convoById(_openId); if (!g || g.type === 'dm') return; _view = 'manage'; _renderManage(); }
function chatManageBack() { _view = 'convo'; _renderConvo(); }

function _renderManage() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const g = _convoById(_openId);
  if (!g || g.type === 'dm') { chatBack(); return; }
  const amCreator = g.createdBy === _uid;
  const members = g.members || [];
  const memberRows = members.map(u => `
    <div class="chat-member-row">
      <span class="chat-member">
        <img class="chat-member-av${_isOnline(u) ? ' is-online' : ''}" data-online-uid="${_esc(u)}" src="${_esc(avatarSrcOf(_profileOf(u)))}" alt="" loading="lazy">
        <span class="chat-member-name">${_esc(_nameOf(u))}${u === g.createdBy ? ' <span class="chat-tag">créateur</span>' : ''}</span>
      </span>
      ${(amCreator && u !== _uid) ? `<button class="chat-mini-btn" data-action="chatRemoveMember" data-uid="${_esc(u)}" title="Retirer">✕</button>` : ''}
    </div>`).join('');
  const addable = amCreator ? _advMembers().filter(u => !members.includes(u)) : [];
  const addRows = addable.map(u => `
    <div class="chat-member-row">
      <span class="chat-member">
        <img class="chat-member-av${_isOnline(u) ? ' is-online' : ''}" data-online-uid="${_esc(u)}" src="${_esc(avatarSrcOf(_profileOf(u)))}" alt="" loading="lazy">
        <span class="chat-member-name">${_esc(_nameOf(u))}</span>
      </span>
      <button class="chat-mini-btn" data-action="chatAddMember" data-uid="${_esc(u)}" title="Ajouter">＋</button>
    </div>`).join('');
  el.innerHTML = _panelShell('Gérer le groupe',
    '<button class="chat-back" data-action="chatManageBack" aria-label="Retour">‹</button>',
    `<div class="chat-new">
       ${amCreator ? `<div class="chat-new-lbl">Nom du groupe</div>
       <div class="chat-form-row">
         <input id="chat-mng-name" class="chat-input" maxlength="40" value="${_esc(g.name || '')}">
         <button class="chat-send" data-action="chatRenameGroup" title="Renommer" aria-label="Renommer">✓</button>
       </div>` : ''}
       <div class="chat-new-lbl">Membres (${members.length})</div>
       <div class="chat-member-list">${memberRows}</div>
       ${addable.length ? `<div class="chat-new-lbl">Ajouter un membre</div><div class="chat-member-list">${addRows}</div>` : ''}
     </div>`,
    `<div class="chat-list-foot chat-manage-foot">
       <button class="chat-newbtn chat-newbtn--danger" data-action="chatLeaveGroup">Quitter</button>
       ${amCreator ? '<button class="chat-newbtn chat-newbtn--danger" data-action="chatDeleteGroup">Supprimer le groupe</button>' : ''}
     </div>`);
  _healMembers([...members, ...addable]);
}

async function chatRenameGroup() {
  const name = (document.getElementById('chat-mng-name')?.value || '').trim();
  if (!name) { showNotif('Le nom ne peut pas être vide.', 'error'); return; }
  const ref = _convoRef(_openId); if (!ref) return;
  try { await updateDoc(ref, { name }); showNotif('Groupe renommé.', 'success'); }
  catch (e) { console.warn('[chat] rename', e?.code || e); showNotif('Renommage refusé — règles Firestore ?', 'error'); }
}

async function _updateMembers(members, okMsg) {
  const ref = _convoRef(_openId); if (!ref) return;
  try { await updateDoc(ref, { members }); showNotif(okMsg, 'success'); }
  catch (e) { console.warn('[chat] members', e?.code || e); showNotif('Modification refusée — règles Firestore ?', 'error'); }
}
async function chatAddMember(btn) {
  const u = btn?.dataset?.uid; const g = _convoById(_openId); if (!u || !g) return;
  await _updateMembers([...new Set([...(g.members || []), u])], 'Membre ajouté.');
}
async function chatRemoveMember(btn) {
  const u = btn?.dataset?.uid; const g = _convoById(_openId); if (!u || !g) return;
  await _updateMembers((g.members || []).filter(x => x !== u), 'Membre retiré.');
}

async function chatLeaveGroup() {
  const g = _convoById(_openId); if (!g) return;
  if (!await confirmModal('Quitter ce groupe ?')) return;
  const ref = _convoRef(_openId); if (!ref) return;
  try {
    await updateDoc(ref, { members: (g.members || []).filter(x => x !== _uid) });
    _teardownConvo(); _view = 'list'; _openId = null; _renderList();
    showNotif('Tu as quitté le groupe.', 'success');
  } catch (e) { console.warn('[chat] leave', e?.code || e); showNotif('Impossible de quitter — règles Firestore ?', 'error'); }
}
async function chatDeleteGroup() {
  const g = _convoById(_openId); if (!g || g.createdBy !== _uid) return;
  if (!await confirmModal('Supprimer définitivement ce groupe ?')) return;
  const ref = _convoRef(_openId); if (!ref) return;
  try {
    await deleteDoc(ref);
    _teardownConvo(); _view = 'list'; _openId = null; _renderList();
    showNotif('Groupe supprimé.', 'success');
  } catch (e) { console.warn('[chat] delGroup', e?.code || e); showNotif('Suppression refusée — règles Firestore ?', 'error'); }
}

// ── Menu ⋯ d'un message (réactions + modifier/supprimer) ─────────────────────
// Popover ancré au bouton, ajouté au body (échappe au clip du scroll). Découvrable
// (bouton visible) et compatible tactile — remplace les actions au survol.
let _msgMenuOutside = null;
function _closeMsgMenu() {
  document.getElementById('chat-msg-menu')?.remove();
  if (_msgMenuOutside) { document.removeEventListener('mousedown', _msgMenuOutside, true); _msgMenuOutside = null; }
}
function chatMsgMenu(btn) {
  const id = btn?.dataset?.msg;
  const already = document.getElementById('chat-msg-menu');
  _closeMsgMenu();
  if (already && already.dataset.msg === id) return;   // re-clic = fermer
  if (!id) return;
  const msgs = _openId === ADV ? _advMsgs : _convoMsgs;
  const m = msgs.find(x => x.id === id); if (!m || m.deleted) return;
  const mine = m.senderId === _uid;
  const pop = document.createElement('div');
  pop.id = 'chat-msg-menu'; pop.className = 'chat-msg-menu'; pop.dataset.msg = id;
  pop.innerHTML = `
    <div class="chat-msg-menu-reacts">${REACTIONS.map(e =>
      `<button class="chat-act-emo" data-action="chatReact" data-msg="${_esc(id)}" data-emo="${e}" title="Réagir ${e}">${e}</button>`).join('')}</div>
    <button class="chat-msg-menu-item" data-action="chatReplyMsg" data-msg="${_esc(id)}">↩︎ Répondre</button>
    ${mine ? `<button class="chat-msg-menu-item" data-action="chatEditMsg" data-msg="${_esc(id)}">✏️ Modifier</button>` : ''}
    ${(mine || STATE.isAdmin) ? `<button class="chat-msg-menu-item" data-action="chatDeleteMsg" data-msg="${_esc(id)}">🗑️ Supprimer${!mine ? ' (MJ)' : ''}</button>` : ''}`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 220, h = pop.offsetHeight || 40;
  pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  // au-dessus si pas la place en dessous
  pop.style.top = (r.bottom + h + 8 > window.innerHeight) ? `${Math.max(8, r.top - h - 4)}px` : `${r.bottom + 4}px`;
  _msgMenuOutside = (e) => { if (!pop.contains(e.target) && e.target !== btn) _closeMsgMenu(); };
  requestAnimationFrame(() => document.addEventListener('mousedown', _msgMenuOutside, true));
}

// ── Emoji dans la saisie ─────────────────────────────────────────────────────
let _emojiOutside = null;
const _emojiBtn = () => document.querySelector('[data-action="chatEmojiToggle"]');
function _closeEmojiPop() {
  document.getElementById('chat-emoji-pop')?.remove();
  _emojiBtn()?.classList.remove('is-open');
  if (_emojiOutside) { document.removeEventListener('mousedown', _emojiOutside, true); _emojiOutside = null; }
}
// Récents (localStorage) : la ligne du haut du picker.
function _emojiRecents() { try { return JSON.parse(localStorage.getItem('chat-emoji-recents') || '[]'); } catch { return []; } }
function _pushEmojiRecent(emo) {
  const r = [emo, ..._emojiRecents().filter(x => x !== emo)].slice(0, 16);
  localStorage.setItem('chat-emoji-recents', JSON.stringify(r));
}
const _emojiOptBtn = (e) => `<button type="button" class="chat-emoji-opt" data-action="chatInsertEmoji" data-emo="${e}" title="${e}">${e}</button>`;
function _emojiPickerHtml() {
  const rec = _emojiRecents();
  // Émotes custom :nom: de l'aventure (images), insérées comme balise texte.
  const emoteBlock = _chatEmotes.length
    ? `<div class="chat-emoji-cat"><div class="chat-emoji-catlbl">😄 Émotes</div><div class="chat-emoji-grid chat-emote-grid">${_chatEmotes.map(em =>
        `<button type="button" class="chat-emoji-opt chat-emote-opt" data-action="chatInsertEmote" data-emo=":${_esc(em.name)}:" title=":${_esc(em.name)}:"><img src="${_esc(em.url)}" alt=":${_esc(em.name)}:" loading="lazy"></button>`).join('')}</div></div>`
    : '';
  const recBlock = rec.length
    ? `<div class="chat-emoji-cat"><div class="chat-emoji-catlbl">🕘 Récents</div><div class="chat-emoji-grid">${rec.map(_emojiOptBtn).join('')}</div></div>` : '';
  const cats = EMOJI_CATS.map(c =>
    `<div class="chat-emoji-cat"><div class="chat-emoji-catlbl">${_esc(c.label)}</div><div class="chat-emoji-grid">${c.emojis.map(_emojiOptBtn).join('')}</div></div>`).join('');
  return emoteBlock + recBlock + cats;
}

// Popover ancré au body + positionné en JS (comme le menu ⋯) → indépendant du
// flux du formulaire : s'affiche juste au-dessus du bouton 😊, ne décale rien.
function chatEmojiToggle() {
  if (document.getElementById('chat-emoji-pop')) { _closeEmojiPop(); return; }
  const btn = _emojiBtn(); if (!btn) return;
  const pop = document.createElement('div');
  pop.id = 'chat-emoji-pop'; pop.className = 'chat-emoji-pop';
  pop.innerHTML = _emojiPickerHtml();
  document.body.appendChild(pop);
  btn.classList.add('is-open');
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 300, h = pop.offsetHeight || 300;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = `${Math.max(8, r.top - h - 8)}px`;   // au-dessus du bouton
  _emojiOutside = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) _closeEmojiPop(); };
  requestAnimationFrame(() => document.addEventListener('mousedown', _emojiOutside, true));
}
// Composer = div contenteditable : les émotes y sont des <img> (data-emote).
// Sérialisation → texte + balises :nom: (émotes) + \n (sauts de ligne).
function _composerEl() { return document.getElementById('chat-input'); }
function _composerText() {
  const el = _composerEl(); if (!el) return '';
  let out = '';
  const walk = (node) => node.childNodes.forEach(n => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeName === 'IMG') out += n.dataset.emote || '';
    else if (n.nodeName === 'BR') out += '\n';
    else if (n.nodeType === 1 && n.dataset && n.dataset.uid) out += `@[${n.dataset.uid}]`;   // mention
    else walk(n);
  });
  walk(el);
  return out.trim().slice(0, 1000);
}
function _clearComposer() { const el = _composerEl(); if (el) el.innerHTML = ''; }
function _setComposer(text) { const el = _composerEl(); if (el) { el.innerHTML = _mentionsToTokens(_applyChatEmotes(_esc(text || ''))); el.focus(); } }
function _insertNodeAtCursor(node) {
  const el = _composerEl(); if (!el) return;
  el.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents(); range.insertNode(node);
    range.setStartAfter(node); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
  } else {
    el.appendChild(node);
  }
}
function _insertText(str) { _insertNodeAtCursor(document.createTextNode(str)); }
function chatInsertEmoji(btn) {
  const emo = btn?.dataset?.emo; if (!emo) return;
  _insertText(emo);
  _pushEmojiRecent(emo);   // remonté dans « Récents » à la prochaine ouverture
}
// Clic sur une émote → l'insère dans le composer sous forme d'IMAGE (pas de texte
// :nom: visible). L'envoi se fait à la validation (Entrée / bouton ➤).
function chatInsertEmote(btn) {
  const tag = btn?.dataset?.emo; if (!tag) return;
  const em = _chatEmotes.find(e => `:${e.name}:` === tag); if (!em) return;
  const img = document.createElement('img');
  img.className = 'chat-emote-inline'; img.dataset.emote = tag; img.src = em.url; img.alt = tag;
  _insertNodeAtCursor(img);
  _signalTyping();
}

// ── Autocomplétion @mention ──────────────────────────────────────────────────
function _mentionQuery() {
  const el = _composerEl(); if (!el) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3 || !el.contains(node)) return null;
  const before = node.nodeValue.slice(0, sel.anchorOffset);
  const m = before.match(/(?:^|\s)@([\p{L}0-9_]{0,20})$/u);
  if (!m) return null;
  return { q: m[1], node, from: sel.anchorOffset - m[1].length - 1, to: sel.anchorOffset };
}
function _closeMentionMenu() {
  document.getElementById('chat-mention-menu')?.remove();
  _mentionQ = null;
  if (_mentionOutside) { document.removeEventListener('mousedown', _mentionOutside, true); _mentionOutside = null; }
}
function _renderMentionMenu(mq) {
  const ql = mq.q.toLowerCase();
  // Cible : membres de la conversation (groupe/DM) ; tout le monde en chat d'aventure.
  const pool = _openId === ADV
    ? _advMembers()
    : (_convoById(_openId)?.members || []).filter(u => u && u !== _uid && !_ghosts.has(u));
  const members = pool.map(u => ({ u, name: _nameOf(u) }))
    .filter(x => !ql || x.name.toLowerCase().includes(ql)).slice(0, 6);
  _closeMentionMenu();
  if (!members.length) return;
  _mentionQ = mq;
  const el = _composerEl(); if (!el) return;
  const pop = document.createElement('div');
  pop.id = 'chat-mention-menu'; pop.className = 'chat-mention-menu';
  pop.innerHTML = members.map(x =>
    `<button type="button" class="chat-mention-item" data-action="chatPickMention" data-uid="${_esc(x.u)}">
       <img class="chat-member-av" src="${_esc(avatarSrcOf(_profileOf(x.u)))}" alt="">
       <span class="chat-member-name">${_esc(x.name)}</span>
     </button>`).join('');
  document.body.appendChild(pop);
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth || 220, h = pop.offsetHeight || 40;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = `${Math.max(8, r.top - h - 6)}px`;
  _mentionOutside = (e) => { if (!pop.contains(e.target) && !el.contains(e.target)) _closeMentionMenu(); };
  requestAnimationFrame(() => document.addEventListener('mousedown', _mentionOutside, true));
}
function chatPickMention(btn) {
  const uid = btn?.dataset?.uid, mq = _mentionQ; if (!uid || !mq) return;
  const range = document.createRange();
  try { range.setStart(mq.node, mq.from); range.setEnd(mq.node, mq.to); } catch { _closeMentionMenu(); return; }
  range.deleteContents();
  const span = document.createElement('span');
  span.className = 'chat-mention'; span.contentEditable = 'false'; span.dataset.uid = uid; span.textContent = '@' + _nameOf(uid);
  range.insertNode(span);
  const sp = document.createTextNode(' '); span.after(sp);
  const sel = window.getSelection(); const r2 = document.createRange();
  r2.setStartAfter(sp); r2.collapse(true); sel.removeAllRanges(); sel.addRange(r2);
  _closeMentionMenu();
  _composerEl()?.focus();
}
function _onComposerInput() {
  _signalTyping();
  _saveDraft();
  const mq = _mentionQuery();
  if (mq) _renderMentionMenu(mq); else _closeMentionMenu();
}

// ── Répondre / citer ─────────────────────────────────────────────────────────
function _showReplyBar() {
  const bar = document.getElementById('chat-reply-bar'); if (!bar || !_replyTo) return;
  bar.innerHTML = `↩︎ <b>${_esc(_replyTo.senderName || '')}</b> <span class="chat-reply-snippet">${_esc(_replyTo.text || '📷 Image')}</span><button type="button" class="chat-edit-cancel" data-action="chatCancelReply" aria-label="Annuler la réponse">✕</button>`;
  bar.removeAttribute('hidden');
}
function _clearReply() {
  _replyTo = null;
  const bar = document.getElementById('chat-reply-bar'); if (bar) { bar.innerHTML = ''; bar.setAttribute('hidden', ''); }
}
function chatCancelReply() { _clearReply(); }
function chatReplyMsg(btn) {
  const id = btn?.dataset?.msg; if (!id) return;
  _closeMsgMenu();
  const msgs = _openId === ADV ? _advMsgs : _convoMsgs;
  const m = msgs.find(x => x.id === id); if (!m || m.deleted) return;
  _replyTo = { id, senderName: m.senderName || _nameOf(m.senderId), text: (m.text || (m.image ? '📷 Image' : '')).slice(0, 120) };
  _showReplyBar();
  document.getElementById('chat-input')?.focus();
}

// ── Recherche / image / son ──────────────────────────────────────────────────
function chatSearchToggle() {
  _searchOpen = !_searchOpen;
  if (!_searchOpen) _searchQ = '';
  const bar = document.getElementById('chat-search');
  if (bar) { if (_searchOpen) bar.removeAttribute('hidden'); else bar.setAttribute('hidden', ''); }
  _renderMessages();
  if (_searchOpen) document.getElementById('chat-search-inp')?.focus();
}
function chatPickImage() { document.getElementById('chat-file')?.click(); }
function chatRollHint() { const el = _composerEl(); if (!el) return; el.focus(); _insertText('/roll 1d20'); }
function chatScrollBottom() {
  const list = document.getElementById('chat-msgs'); if (list) list.scrollTop = list.scrollHeight;
  _hideNewPill();
}
// Charge un lot plus ancien (re-souscription avec limite augmentée).
function chatLoadMore() {
  if (_openId === ADV) { _advLimit += HISTORY; _subscribeAdv(); }
  else if (_openId) { _convoLimit += HISTORY; _subscribeConvo(_openId); }
}
// Clic sur une citation → défile jusqu'au message d'origine + flash.
function chatJumpTo(btn) {
  const id = btn?.dataset?.msg; if (!id) return;
  let el = null;
  try { el = document.querySelector(`.chat-msg[data-mid="${CSS.escape(id)}"]`); } catch { el = null; }
  if (!el) { showNotif('Message trop ancien — charge plus haut.', 'info'); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('chat-msg--flash'); void el.offsetWidth; el.classList.add('chat-msg--flash');
  setTimeout(() => el.classList.remove('chat-msg--flash'), 1600);
}

// ── Brouillon par conversation (localStorage) ────────────────────────────────
function _draftKey() { return `chat-draft-${_adv()}-${_openId}`; }
function _saveDraft() {
  try {
    if (!_openId || _editingId) return;
    const t = _composerText();
    if (t) localStorage.setItem(_draftKey(), t); else localStorage.removeItem(_draftKey());
  } catch { /* localStorage indispo */ }
}
function _restoreDraft() { try { const d = _openId && localStorage.getItem(_draftKey()); if (d) _setComposer(d); } catch {} }
function _clearDraft() { try { localStorage.removeItem(_draftKey()); } catch {} }
function chatToggleMute() {
  _muted = !_muted;
  localStorage.setItem('chat-muted', _muted ? '1' : '0');
  if (_view === 'list') _renderList();
}
function chatClearListSearch() {
  _listQ = '';
  if (_view === 'list') _renderList();
}

registerActions({
  chatToggle:      () => chatToggle(),
  chatBack:        () => chatBack(),
  chatOpenConvo:   (btn) => chatOpenConvo(btn),
  chatNew:         () => chatNew(),
  chatCreateGroup: () => chatCreateGroup(),
  chatStartDm:     (btn) => chatStartDm(btn),
  chatMsgMenu:     (btn) => chatMsgMenu(btn),
  chatEmojiToggle: () => chatEmojiToggle(),
  chatInsertEmoji: (btn) => chatInsertEmoji(btn),
  chatInsertEmote: (btn) => chatInsertEmote(btn),
  chatPickMention: (btn) => chatPickMention(btn),
  chatReplyMsg:    (btn) => chatReplyMsg(btn),
  chatCancelReply: () => chatCancelReply(),
  chatSearchToggle:() => chatSearchToggle(),
  chatPickImage:   () => chatPickImage(),
  chatRollHint:    () => chatRollHint(),
  chatScrollBottom:() => chatScrollBottom(),
  chatLoadMore:    () => chatLoadMore(),
  chatJumpTo:      (btn) => chatJumpTo(btn),
  chatToggleMute:  () => chatToggleMute(),
  chatClearListSearch: () => chatClearListSearch(),
  chatReact:       (btn) => chatReact(btn),
  chatEditMsg:     (btn) => chatEditMsg(btn),
  chatDeleteMsg:   (btn) => chatDeleteMsg(btn),
  chatCancelEdit:  () => chatCancelEdit(),
  chatManage:      () => chatManage(),
  chatManageBack:  () => chatManageBack(),
  chatRenameGroup: () => chatRenameGroup(),
  chatAddMember:   (btn) => chatAddMember(btn),
  chatRemoveMember:(btn) => chatRemoveMember(btn),
  chatLeaveGroup:  () => chatLeaveGroup(),
  chatDeleteGroup: () => chatDeleteGroup(),
});
