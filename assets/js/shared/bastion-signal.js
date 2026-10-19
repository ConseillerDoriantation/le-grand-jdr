// ══════════════════════════════════════════════════════════════════════════════
// SIGNAL « Mur du Bastion » — pastille de non-lus sur la navigation
//
// Problème : les joueurs vont peu sur la page Bastion, donc les publications du
// mur passent inaperçues. Solution légère : une pastille (point) sur l'entrée
// « Bastion » de la navigation, visible sur TOUTES les pages, tant qu'il y a de
// l'activité plus récente que la dernière visite du mur.
//
// Quota : un seul doc `bastionWall/meta.lastActivityAt` (1 écriture par
// publication/réponse) + 1 abonnement session-live. La comparaison « vu » se fait
// en local (bastionWallSeenKey), remise à zéro par _wallMarkSeen quand le joueur
// ouvre le Mur.
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { saveDoc, subscribeCollection, subscribeDoc } from '../data/firestore.js';
import { isFeatureEnabled } from './features.js';
import { bastionWallSeenKey } from './bastion-wall.js';
import { bastionRoomProjects } from './bastion-investments.js';

let _lastActivityAt = 0;
let _unsubActivity = null;
let _unsubBastion = null;
let _unsubInvestments = null;
let _bastion = null;
let _investments = [];

// Marque une nouvelle activité du mur (appelé à chaque publication / réponse).
export function touchBastionWallActivity() {
  const now = Date.now();
  _lastActivityAt = Math.max(_lastActivityAt, now);
  void saveDoc('bastionWall', 'meta', { lastActivityAt: now }, { silent: true });
  refreshBastionWallDot();
}

function _seenAt() {
  try { return Number(localStorage.getItem(bastionWallSeenKey(STATE.adventure?.id, STATE.user?.uid))) || 0; }
  catch { return 0; }
}

export function bastionWallHasUnread() {
  return _lastActivityAt > 0 && _lastActivityAt > _seenAt();
}

export function bastionSignalSnapshot() {
  return { bastion: _bastion, investments: _investments, projects: bastionRoomProjects(_bastion || {}, _investments) };
}

// Affiche/masque la pastille sur les entrées de navigation « Bastion ».
export function refreshBastionWallDot() {
  const has = bastionWallHasUnread();
  document.querySelectorAll('.bastion-nav-dot').forEach((el) => { el.hidden = !has; });
  const count = bastionRoomProjects(_bastion || {}, _investments).length;
  document.querySelectorAll('.bastion-nav-count').forEach((el) => {
    el.textContent = String(count);
    el.hidden = has || count < 1;
    el.setAttribute('aria-label', `${count} chantier${count > 1 ? 's' : ''} ouvert${count > 1 ? 's' : ''}`);
  });
  document.dispatchEvent(new CustomEvent('app:bastion-signal-changed'));
}

// Abonnement au doc d'activité pour toute la session, ré-armé à chaque
// changement d'aventure. Il passe par subscribeDoc (doc session-live, cf.
// _LAZY_SESSION_DOCS de firestore.js) et NON par watchDoc : realtime.js coupe
// ses abonnements à chaque navigation, ce qui figeait la pastille dès le premier
// changement de page. Bastion désactivé → aucun abonnement (pastille masquée,
// pas de lecture refusée facturée).
export function initBastionWallSignal() {
  _unsubActivity?.();
  _unsubBastion?.();
  _unsubInvestments?.();
  _unsubActivity = null;
  _unsubBastion = null;
  _unsubInvestments = null;
  _lastActivityAt = 0;
  _bastion = null;
  _investments = [];
  refreshBastionWallDot();
  if (!isFeatureEnabled('bastion')) return;
  _unsubActivity = subscribeDoc('bastionWall', 'meta', (data) => {
    _lastActivityAt = Number(data?.lastActivityAt) || 0;
    refreshBastionWallDot();
  }, { silent: true });
  _unsubBastion = subscribeDoc('bastion', 'main', data => {
    _bastion = data || null;
    refreshBastionWallDot();
  }, { silent: true });
  _unsubInvestments = subscribeCollection('bastionInvestments', data => {
    _investments = data || [];
    refreshBastionWallDot();
  });
}
