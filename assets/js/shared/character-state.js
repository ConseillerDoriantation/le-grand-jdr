import { STATE } from '../core/state.js';
import { sortCharactersForDisplay } from './char-stats.js';

export function getCharacterById(charId, fallback = STATE.activeChar) {
  return (STATE.characters || []).find(c => c.id === charId) || fallback || null;
}

export function getVisibleCharacters({ sorted = true } = {}) {
  const chars = Array.isArray(STATE.characters) ? STATE.characters : [];
  const visible = STATE.isAdmin ? chars : chars.filter(c => c.uid === STATE.user?.uid);
  return sorted ? sortCharactersForDisplay(visible) : visible;
}
