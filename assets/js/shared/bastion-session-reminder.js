import { STATE } from '../core/state.js';
import { navigate } from '../core/navigation.js';
import { calcOr, sortCharactersForDisplay } from './char-stats.js';
import { getControlledCharacters } from './character-state.js';
import { _esc } from './html.js';
import { lsJson } from './local-storage.js';
import { closeModalDirect, openModal } from './modal.js';
import { bastionEqualShare } from './bastion-investments.js';
import { bastionSignalSnapshot } from './bastion-signal.js';

const PREFIX = 'bastion-session-gold';
let _pendingSession = null;

function _sessionId(session = {}) {
  const liveSince = session.liveSince?.toMillis?.() || session.liveSince || '';
  return String(session.statsSessionKey || session.techniqueSessionKey || liveSince || '');
}

function _storageKey(kind, session = {}) {
  const aid = STATE.adventure?.id || 'adventure';
  const uid = STATE.user?.uid || 'user';
  const sid = _sessionId(session);
  return sid ? `${PREFIX}:${kind}:${aid}:${uid}:${sid}` : '';
}

function _controlled(characters = []) {
  return getControlledCharacters(characters, STATE.user?.uid, { sorted: true });
}

export function rememberBastionSessionGold(session = {}, characters = []) {
  if (!session.live || STATE.isAdmin) return;
  const key = _storageKey('start', session);
  if (!key || lsJson.get(key)) return;
  const controlled = _controlled(characters);
  if (!controlled.length) return;
  lsJson.set(key, {
    balances: Object.fromEntries(controlled.map(character => [character.id, calcOr(character)])),
    capturedAt: Date.now(),
  });
}

function _activePartyCount(characters = []) {
  const active = (characters || []).filter(character => {
    const life = String(character?.lifeStatus || 'alive').toLowerCase();
    return !!character?.uid && !['dead', 'mort', 'morte', 'decede', 'decedee'].includes(life);
  });
  return Math.max(1, active.length);
}

function _showReminder(session, characters) {
  if (STATE.isAdmin) return false;
  const startKey = _storageKey('start', session);
  const shownKey = _storageKey('shown', session);
  if (!startKey || !shownKey || lsJson.get(shownKey)) return false;
  const start = lsJson.get(startKey);
  if (!start?.balances) return false;

  const gained = sortCharactersForDisplay(_controlled(characters))
    .map(character => ({ character, balance: calcOr(character), gain: calcOr(character) - (Number(start.balances[character.id]) || 0) }))
    .filter(entry => entry.gain > 0);
  if (!gained.length) return false;

  const project = bastionSignalSnapshot().projects?.[0];
  if (!project) return false;
  const entry = gained.find(item => item.character.isDefault) || gained[0];
  const amount = Math.min(project.remaining, entry.balance);
  if (!(amount > 0)) return false;

  const share = bastionEqualShare(project.remaining, _activePartyCount(characters));
  const enough = entry.balance >= project.remaining;
  lsJson.set(shownKey, { shownAt: Date.now(), characterId: entry.character.id });
  openModal('Session terminée', `
    <section class="bs2-session-reminder">
      <p class="bs2-session-gain"><strong>${_esc(entry.character.nom || 'Ton personnage')}</strong> repart avec <b>+${entry.gain} or</b>.</p>
      <p class="bs2-session-balance">Bourse actuelle : <strong>${entry.balance} or</strong></p>
      <article class="bs2-session-project">
        <span>${_esc(project.def?.emoji || '🏠')}</span>
        <div><small>Chantier le plus proche</small><strong>${_esc(project.name)} · niveau ${project.target}</strong><p>Il manque ${project.remaining} or</p></div>
      </article>
      <p class="bs2-session-prompt">${enough
        ? `Ta bourse suffit pour finir <strong>${_esc(project.name)}</strong> seul.`
        : `Si chacun met <strong>${share} or</strong>, le chantier est financé.`}</p>
      <footer><button type="button" class="bs2-session-action" data-bs-session-later>Plus tard</button><button type="button" class="bs2-session-action is-primary" data-bs-session-contribute>Cotiser ${amount} or</button></footer>
    </section>
  `, { icon: '🏰', subtitle: 'Le Bastion avance grâce au groupe', accent: '#4f8cff' });

  document.querySelector('[data-bs-session-later]')?.addEventListener('click', closeModalDirect, { once: true });
  document.querySelector('[data-bs-session-contribute]')?.addEventListener('click', () => {
    closeModalDirect();
    void navigate('bastion', { sub: `room:${project.slug}` });
  }, { once: true });
  return true;
}

export function endBastionSessionGoldReminder(session = {}, characters = []) {
  if (STATE.isAdmin || !_sessionId(session)) return;
  _pendingSession = session;
  _showReminder(session, characters);
}

export function refreshBastionSessionGoldReminder(session = {}, characters = []) {
  if (session.live) {
    rememberBastionSessionGold(session, characters);
    return;
  }
  if (_pendingSession && _showReminder(_pendingSession, characters)) _pendingSession = null;
}
