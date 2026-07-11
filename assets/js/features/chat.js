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
//   adventures/{advId}/chatMessages/{id} : { convoId, text, senderId, senderName, at }
//   adventures/{advId}/chatConvos/{id}   : { type:'group', name, members[], createdBy,
//                                            lastText, lastSenderName, lastSenderId, lastAt }
//   adventures/{advId}/chatReads/{uid}   : { [convoId]: millis }
// ══════════════════════════════════════════════════════════════════════════════
import {
  db, collection, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc,
  serverTimestamp, doc, getDoc, setDoc,
} from '../config/firebase.js';
import { getCurrentAdventureId } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showNotif } from '../shared/notifications.js';
import { avatarSrcOf } from '../shared/avatar.js';
import { _esc } from '../shared/html.js';

const ADV = 'adventure';   // id de la conversation d'aventure
const HISTORY = 40;

let _uid = null, _open = false, _view = 'list';   // 'list' | 'convo' | 'new'
let _openId = null;                                // conv ouverte (ADV | groupId)
let _advMsgs = [];                                 // messages Aventure (live session)
let _groups  = [];                                 // convos de groupe où je suis membre
let _convoMsgs = [];                               // messages du GROUPE ouvert
let _reads = {};                                   // convoId → millis lus
let _unsubAdv = null, _unsubGroups = null, _unsubConvo = null;
let _baseTitle = '';                               // titre d'onglet sans compteur
let _prevUnread = 0;                               // pour ne pulser QUE sur du neuf

// ── Refs ──────────────────────────────────────────────────────────────────────
const _adv = () => getCurrentAdventureId();
const _msgsCol  = () => { const a = _adv(); return a ? collection(db, 'adventures', a, 'chatMessages') : null; };
const _convosCol = () => { const a = _adv(); return a ? collection(db, 'adventures', a, 'chatConvos') : null; };
const _convoRef = (id) => { const a = _adv(); return a ? doc(db, 'adventures', a, 'chatConvos', id) : null; };
const _readRef  = () => { const a = _adv(); return (a && _uid) ? doc(db, 'adventures', a, 'chatReads', _uid) : null; };
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
  _baseTitle = (document.title || 'Le Grand JDR').replace(/^\(\d+\)\s*/, '');
  _prevUnread = 0;
  _mount();

  try { const s = await getDoc(_readRef()); const d = s.data() || {}; _reads = { ...d, [ADV]: Number(d[ADV] ?? d.at) || 0 }; }
  catch { _reads = {}; }

  const mcol = _msgsCol();
  if (mcol) _unsubAdv = onSnapshot(
    query(mcol, where('convoId', '==', ADV), orderBy('at', 'desc'), limit(HISTORY)),
    snap => { _advMsgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse(); _onData(ADV); },
    err => console.warn('[chat] adv', err?.code || err),
  );

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
  if (n > _prevUnread) _pulseBubble();
  _prevUnread = n;
}
function _pulseBubble() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  el.classList.remove('chat-notify'); void el.offsetWidth; el.classList.add('chat-notify');
  setTimeout(() => el.classList.remove('chat-notify'), 1200);
}
function _teardownListeners() {
  [_unsubAdv, _unsubGroups, _unsubConvo].forEach(u => { if (u) try { u(); } catch {} });
  _unsubAdv = _unsubGroups = _unsubConvo = null;
}

// Nouveau lot de données reçu (source = ADV | 'groups' | 'convo')
function _onData(source) {
  if (!_open) { _renderBubble(); _notify(); return; }
  if (_view === 'list') _renderList();
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

function _panelShell(title, headLeft, body, foot = '') {
  return `<div class="chat-panel" role="dialog" aria-label="Discussions">
    <div class="chat-head">
      <span class="chat-head-left">${headLeft}<span class="chat-head-title">${_esc(title)}</span></span>
      <button class="chat-close" data-action="chatToggle" aria-label="Fermer">✕</button>
    </div>
    ${body}${foot}
  </div>`;
}

// Vue LISTE : Aventure + groupes
function _renderList() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const advPrev = _advMsgs.length ? `${_advMsgs[_advMsgs.length - 1].senderName || ''} : ${_advMsgs[_advMsgs.length - 1].text || ''}` : 'Aucun message';
  const advN = _advUnread();
  const advRow = _convoRow(ADV, '💬', 'Chat de l\'aventure', advPrev, advN);
  const groupRows = _groups.map(g => {
    const prev = g.lastText ? `${g.lastSenderName || ''} : ${g.lastText}` : 'Nouveau groupe';
    const ico = g.lastSenderId ? `<img class="chat-conv-avimg" src="${_esc(avatarSrcOf(_profileOf(g.lastSenderId)))}" alt="">` : '👥';
    return _convoRow(g.id, ico, g.name || 'Groupe', prev, _groupUnread(g) ? '•' : 0);
  }).join('');
  el.innerHTML = _panelShell('Discussions', '',
    `<div class="chat-convo-list">${advRow}${groupRows}</div>`,
    `<div class="chat-list-foot"><button class="chat-newbtn" data-action="chatNew">＋ Nouvelle discussion</button></div>`);
}

function _convoRow(id, icon, name, preview, badge) {
  const b = badge === '•' ? '<span class="chat-conv-dot"></span>'
          : (badge > 0 ? `<span class="chat-badge chat-badge--inline">${badge > 99 ? '99+' : badge}</span>` : '');
  return `<button class="chat-conv" data-action="chatOpenConvo" data-convo="${_esc(id)}">
    <span class="chat-conv-ico">${icon}</span>
    <span class="chat-conv-body"><span class="chat-conv-name">${_esc(name)}</span><span class="chat-conv-prev">${_esc(preview)}</span></span>
    ${b}</button>`;
}

// Vue CONVERSATION : fil de messages
function _renderConvo() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const title = _openId === ADV ? 'Chat de l\'aventure' : (_groups.find(g => g.id === _openId)?.name || 'Groupe');
  el.innerHTML = _panelShell(title,
    '<button class="chat-back" data-action="chatBack" aria-label="Retour">‹</button>',
    `<div class="chat-msgs" id="chat-msgs"></div>`,
    `<form class="chat-form" id="chat-form"><input id="chat-input" class="chat-input" placeholder="Écris un message…" autocomplete="off" maxlength="1000"><button type="submit" class="chat-send" aria-label="Envoyer">➤</button></form>`);
  el.querySelector('#chat-form')?.addEventListener('submit', (e) => { e.preventDefault(); _send(); });
  _renderMessages();
  el.querySelector('#chat-input')?.focus();
}
function _renderConvoHeaderBadge() { /* pas de badge d'en-tête pour l'instant */ }

function _renderMessages() {
  const list = document.getElementById('chat-msgs'); if (!list) return;
  const msgs = _openId === ADV ? _advMsgs : _convoMsgs;
  list.innerHTML = msgs.length ? msgs.map(_msgRow).join('') : `<div class="chat-empty">Aucun message. Lance la discussion !</div>`;
  list.scrollTop = list.scrollHeight;
}

// Profil (pour l'avatar) d'un uni : le mien via STATE, les autres via
// memberProfiles (avatar dénormalisé → aucune lecture users/{uid}).
function _profileOf(uid) {
  if (uid === _uid) return STATE.profile || {};
  const p = (STATE.adventure?.memberProfiles || {})[uid];
  return (p && typeof p === 'object') ? p : {};
}

function _msgRow(m) {
  const mine = m.senderId === _uid;
  const time = new Date(_atMillis(m) || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const av = mine ? '' : `<img class="chat-msg-av" src="${_esc(avatarSrcOf(_profileOf(m.senderId)))}" alt="" loading="lazy">`;
  return `<div class="chat-msg${mine ? ' chat-msg--mine' : ''}">
    ${av}
    <span class="chat-msg-content">
      ${mine ? '' : `<span class="chat-msg-author">${_esc(m.senderName || '?')}</span>`}
      <span class="chat-msg-bubble">${_esc(m.text || '')}</span>
      <span class="chat-msg-time">${time}</span>
    </span></div>`;
}

// Vue NOUVELLE DISCUSSION : nom + choix des membres
function _renderNew() {
  const el = document.getElementById('chat-widget'); if (!el) return;
  const adv = STATE.adventure || {};
  const profiles = adv.memberProfiles || {};
  // On ne propose que les VRAIS membres : ceux ayant un profil dénormalisé
  // (memberProfiles). Exclut les uids fantômes (comptes retirés/supprimés) qui
  // traînent dans accessList mais n'ont plus de profil → plus de « Joueur wO9ttk… ».
  const members = Object.keys(profiles).filter(u => u && u !== _uid);
  const profOf = (u) => (typeof profiles[u] === 'string' ? { pseudo: profiles[u] } : (profiles[u] || {}));
  const rows = members.length
    ? members.map(u => {
        const p = profOf(u);
        const name = p.pseudo || p.email || `Joueur ${u.slice(0, 6)}…`;
        return `<label class="chat-member">
          <input type="checkbox" value="${_esc(u)}">
          <img class="chat-member-av" src="${_esc(avatarSrcOf(p))}" alt="" loading="lazy">
          <span class="chat-member-name">${_esc(name)}</span>
        </label>`;
      }).join('')
    : `<div class="chat-empty">Aucun autre membre à ajouter.</div>`;
  el.innerHTML = _panelShell('Nouvelle discussion',
    '<button class="chat-back" data-action="chatBack" aria-label="Retour">‹</button>',
    `<div class="chat-new">
       <input id="chat-new-name" class="chat-input chat-new-name" placeholder="Nom du groupe" maxlength="40">
       <div class="chat-new-lbl">Membres</div>
       <div class="chat-member-list" id="chat-members">${rows}</div>
     </div>`,
    `<div class="chat-list-foot"><button class="chat-newbtn" data-action="chatCreateGroup">Créer le groupe</button></div>`);
}

// ── Actions ───────────────────────────────────────────────────────────────────
function chatToggle() {
  _open = !_open;
  if (_open) { _view = 'list'; _renderList(); }
  else { if (_openId) _markRead(_openId); _teardownConvo(); _renderBubble(); }
}
function chatBack() { _teardownConvo(); _view = 'list'; _renderList(); }

function chatOpenConvo(btn) {
  const id = btn?.dataset?.convo; if (!id) return;
  _teardownConvo();
  _openId = id; _view = 'convo';
  _renderConvo();
  if (id === ADV) { _markRead(ADV); }
  else {
    const mcol = _msgsCol();
    if (mcol) _unsubConvo = onSnapshot(
      query(mcol, where('convoId', '==', id), orderBy('at', 'desc'), limit(HISTORY)),
      snap => { _convoMsgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse(); _onData('convo'); },
      err => console.warn('[chat] convo', err?.code || err),
    );
    _markRead(id);
  }
}
function _teardownConvo() { if (_unsubConvo) { try { _unsubConvo(); } catch {} _unsubConvo = null; } _convoMsgs = []; }

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

async function _send() {
  const inp = document.getElementById('chat-input');
  const text = (inp?.value || '').trim();
  if (!text || !_openId) return;
  const col = _msgsCol(); if (!col || !_uid) return;
  inp.value = '';
  const senderName = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || 'Joueur';
  try {
    await addDoc(col, { convoId: _openId, text, senderId: _uid, senderName, at: serverTimestamp() });
    // Metadata du groupe (dernier message → aperçu + non-lus des autres)
    if (_openId !== ADV) {
      const ref = _convoRef(_openId);
      if (ref) updateDoc(ref, { lastText: text, lastSenderName: senderName, lastSenderId: _uid, lastAt: serverTimestamp() }).catch(() => {});
    }
  } catch (e) {
    console.warn('[chat] send', e?.code || e);
    showNotif('Message non envoyé — règles Firestore ?', 'error');
    if (inp) inp.value = text;
  }
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

registerActions({
  chatToggle:      () => chatToggle(),
  chatBack:        () => chatBack(),
  chatOpenConvo:   (btn) => chatOpenConvo(btn),
  chatNew:         () => chatNew(),
  chatCreateGroup: () => chatCreateGroup(),
});
