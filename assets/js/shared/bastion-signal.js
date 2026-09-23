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
import { watchDoc } from './realtime.js';
import { saveDoc } from '../data/firestore.js';
import { bastionWallSeenKey } from './bastion-wall.js';

let _lastActivityAt = 0;

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

// Affiche/masque la pastille sur les entrées de navigation « Bastion ».
export function refreshBastionWallDot() {
  const has = bastionWallHasUnread();
  document.querySelectorAll('.bastion-nav-dot').forEach((el) => { el.hidden = !has; });
}

// Abonnement session-live au doc d'activité, ré-armé à chaque changement
// d'aventure (watchDoc remplace l'abonnement du même nom).
export function initBastionWallSignal() {
  _lastActivityAt = 0;
  refreshBastionWallDot();
  watchDoc('bastionWallMeta', 'bastionWall', 'meta', (data) => {
    _lastActivityAt = Number(data?.lastActivityAt) || 0;
    refreshBastionWallDot();
  });
}
