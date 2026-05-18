// ══════════════════════════════════════════════════════════════════════════════
// vtt-spectator.js — Vue VTT mobile : lecture seule pour suivre la partie
//
// Affiche : chat, combat tracker, timer. Pas de canvas (Konva trop lourd).
// Peut envoyer un message dans le chat (lecture + écriture textuelle uniquement).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import {
  db, doc, collection, addDoc, serverTimestamp,
} from '../config/firebase.js';
import { _esc, appSplashHtml } from '../shared/html.js';
import { showNotif } from '../shared/notifications.js';
import { getCurrentAdventureId } from '../data/firestore.js';
import { watch, watchDoc } from '../shared/realtime.js';

const SLOTS = [
  { id: 'm', emoji: '🌞', label: 'Matin' },
  { id: 'a', emoji: '☀️', label: 'Aprem' },
  { id: 's', emoji: '🌙', label: 'Soir' },
];

let _session = null;
let _logMessages = [];
let _tokens = {};
let _characters = {};
let _npcs = {};
let _timerTick = null;

const _aid     = () => getCurrentAdventureId();
const _sesRef  = () => doc(db, `adventures/${_aid()}/vtt/session`);
const _logCol  = () => collection(db, `adventures/${_aid()}/vttLog`);
const _toksCol = () => collection(db, `adventures/${_aid()}/vttTokens`);
const _chrsCol = () => collection(db, `adventures/${_aid()}/characters`);
const _npcsCol = () => collection(db, `adventures/${_aid()}/npcs`);

function _cleanup() {
  // Les listeners realtime sont gérés par watchDoc/watch — unwatchAll() les
  // tue à chaque navigate. On nettoie juste l'état local.
  if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
  _session = null; _logMessages = []; _tokens = {}; _characters = {}; _npcs = {};
}

// ─── Helpers timer ─────────────────────────────────────────────────────────
function _timerElapsedMs() {
  const t = _session?.timer;
  if (!t) return 0;
  const acc = +t.accumulated || 0;
  if (t.running && t.startedAt) return acc + Math.max(0, Date.now() - (+t.startedAt));
  return acc;
}
function _timerFmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// ─── Rendu ─────────────────────────────────────────────────────────────────
function _renderTimerBlock() {
  const t = _session?.timer;
  if (!t || (!t.running && !(t.accumulated > 0) && !t.label)) return '';
  const running = !!t.running;
  const ms = _timerElapsedMs();
  return `
    <div class="vsp-timer ${running ? 'vsp-timer--on' : 'vsp-timer--paused'}">
      <span class="vsp-timer-ico">${running ? '⏱️' : '⏸️'}</span>
      <span class="vsp-timer-val">${_timerFmt(ms)}</span>
      ${t.label ? `<span class="vsp-timer-label">${_esc(t.label)}</span>` : ''}
    </div>`;
}

function _renderCombatTracker() {
  if (!_session?.combat?.active) return '';
  const round = _session.combat.round ?? 1;
  // Tous tokens d'alliés visibles (filtre simple)
  const allies = Object.values(_tokens)
    .map(t => t?.data || t)
    .filter(t => t && (t.type === 'player' || t.type === 'npc'));

  if (!allies.length) return `
    <div class="vsp-tracker">
      <div class="vsp-tracker-hd">⚔️ Combat · Tour ${round}</div>
      <div class="vsp-tracker-empty">En attente des participants…</div>
    </div>`;

  return `
    <div class="vsp-tracker">
      <div class="vsp-tracker-hd">⚔️ Combat · Tour ${round}</div>
      ${allies.map(t => {
        const moved = !!t.movedThisTurn || (t.movedCells || 0) > 0;
        const acted = !!t.attackedThisTurn;
        const done  = moved && acted;
        const cls = done ? 'done' : (moved !== acted ? 'partial' : 'todo');
        const nom = t.characterId
          ? _characters[t.characterId]?.nom
          : (t.npcId ? _npcs[t.npcId]?.nom : null);
        const displayNom = nom || t.name || '?';
        const photo = t.characterId
          ? _characters[t.characterId]?.photo
          : (t.npcId ? _npcs[t.npcId]?.imageUrl : null);
        return `<div class="vsp-tracker-row vsp-tracker-row--${cls}">
          ${photo
            ? `<img class="vsp-tracker-av" src="${_esc(photo)}">`
            : `<div class="vsp-tracker-av vsp-tracker-av-init">${(displayNom||'?')[0].toUpperCase()}</div>`}
          <div class="vsp-tracker-name">${_esc(displayNom)}</div>
          <span class="vsp-tracker-flag${moved ? ' on' : ''}" title="Déplacement">🏃</span>
          <span class="vsp-tracker-flag${acted ? ' on' : ''}" title="Action">⚔</span>
        </div>`;
      }).join('')}
    </div>`;
}

function _renderChat() {
  const msgs = _logMessages.slice(-50); // 50 derniers
  const items = msgs.map(m => {
    const isRoll = m.type === 'roll' || m.dice;
    const cls = isRoll ? 'vsp-chat-roll' : 'vsp-chat-msg';
    const author = _esc(m.author || m.pseudo || '?');
    const text = _esc(m.text || m.message || '');
    const dice = m.dice ? `<span class="vsp-chat-dice">🎲 ${_esc(m.dice)}</span>` : '';
    const result = (m.result != null) ? `<strong class="vsp-chat-result">${_esc(m.result)}</strong>` : '';
    return `<div class="${cls}">
      <span class="vsp-chat-author">${author}</span>
      <span class="vsp-chat-text">${text} ${dice} ${result}</span>
    </div>`;
  }).join('');
  return `
    <div class="vsp-chat">
      <div class="vsp-chat-hd">💬 Chat &amp; Dés</div>
      <div class="vsp-chat-log" id="vsp-chat-log">${items || '<div class="vsp-chat-empty">Aucun message pour l\'instant.</div>'}</div>
      <div class="vsp-chat-input-row">
        <input type="text" id="vsp-chat-input" class="vsp-chat-input" placeholder="Message…"
          autocomplete="off" onkeydown="if(event.key==='Enter')window._vspSendChat()">
        <button onclick="window._vspSendChat()" class="vsp-chat-send" title="Envoyer">↵</button>
      </div>
    </div>`;
}

function _renderAll() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = `
    <div class="vsp-root">
      <div class="vsp-header">
        <div class="vsp-header-ico">📺</div>
        <div class="vsp-header-body">
          <div class="vsp-header-title">Table virtuelle — mode spectateur</div>
          <div class="vsp-header-sub">Suis la partie, envoie un message. Plateau & jets sur ordinateur.</div>
        </div>
      </div>
      ${_renderTimerBlock()}
      ${_renderCombatTracker()}
      ${_renderChat()}
    </div>
  `;
  // Scroll auto au bas du chat à chaque re-render
  requestAnimationFrame(() => {
    const log = document.getElementById('vsp-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  });
}

// ─── Envoi de message ──────────────────────────────────────────────────────
window._vspSendChat = async () => {
  const input = document.getElementById('vsp-chat-input');
  const text = input?.value?.trim();
  if (!text) return;
  try {
    await addDoc(_logCol(), {
      type: 'message',
      text,
      author: STATE.profile?.pseudo || STATE.user?.email || 'Anonyme',
      uid: STATE.user?.uid || null,
      createdAt: serverTimestamp(),
    });
    input.value = '';
  } catch (e) {
    console.error('[vsp] send chat', e);
    showNotif('Erreur envoi message', 'error');
  }
};

// ─── Point d'entrée ────────────────────────────────────────────────────────
export async function renderVttSpectator() {
  _cleanup();
  const content = document.getElementById('main-content');
  if (!content) return;
  if (!_aid()) {
    content.innerHTML = `<div class="vsp-root"><div class="vsp-header">
      <div class="vsp-header-ico">📺</div>
      <div class="vsp-header-body">
        <div class="vsp-header-title">Aucune aventure active</div>
      </div>
    </div></div>`;
    return;
  }

  content.innerHTML = appSplashHtml('Connexion à la table…');

  // Abonnements realtime — gérés par watch/watchDoc, nettoyés par unwatchAll()
  watchDoc('vsp-session', 'vtt', 'session', (data) => {
    _session = data || {};
    _renderAll();
  });

  watch('vsp-log', 'vttLog', (msgs) => {
    _logMessages = (msgs || [])
      .slice()
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
      .slice(-60);
    _renderAll();
  });

  watch('vsp-tokens', 'vttTokens', (toks) => {
    _tokens = {};
    (toks || []).forEach(t => { _tokens[t.id] = { id: t.id, data: t }; });
    _renderAll();
  });

  watch('vsp-chars', 'characters', (chars) => {
    _characters = {};
    (chars || []).forEach(c => { _characters[c.id] = c; });
    _renderAll();
  });

  watch('vsp-npcs', 'npcs', (npcs) => {
    _npcs = {};
    (npcs || []).forEach(n => { _npcs[n.id] = n; });
    _renderAll();
  });

  // Tick local pour rafraîchir l'affichage du timer
  _timerTick = setInterval(() => {
    if (_session?.timer?.running) {
      const el = document.querySelector('.vsp-timer-val');
      if (el) el.textContent = _timerFmt(_timerElapsedMs());
    }
  }, 1000);
}

export default renderVttSpectator;
