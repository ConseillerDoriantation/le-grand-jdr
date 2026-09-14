import { STATE } from '../core/state.js';
import { sortCharactersForDisplay } from './char-stats.js';

export function getCharacterById(charId, fallback = STATE.activeChar) {
  return (STATE.characters || []).find(c => c.id === charId) || fallback || null;
}

export function getCharacterDelegates(character) {
  return [...new Set((Array.isArray(character?.controlDelegates) ? character.controlDelegates : [])
    .filter(uid => typeof uid === 'string' && uid.trim()))];
}

export function isCharacterOwner(character, uid = STATE.user?.uid) {
  return !!character && !!uid && character.uid === uid;
}

/** Autorisation UI canonique : MJ, propriétaire ou contrôleur délégué. */
export function canControlCharacter(character, uid = STATE.user?.uid) {
  if (!character || !uid) return false;
  return !!STATE.isAdmin || isCharacterOwner(character, uid)
    || getCharacterDelegates(character).includes(uid);
}

export function getControlledCharacters(chars = STATE.characters || [], uid = STATE.user?.uid, { sorted = true } = {}) {
  const controlled = STATE.isAdmin ? [...(chars || [])] : (chars || []).filter(c => canControlCharacter(c, uid));
  return sorted ? sortCharactersForDisplay(controlled) : controlled;
}

export function getVisibleCharacters({ sorted = true } = {}) {
  return getControlledCharacters(
    Array.isArray(STATE.characters) ? STATE.characters : [],
    STATE.user?.uid,
    { sorted },
  );
}
