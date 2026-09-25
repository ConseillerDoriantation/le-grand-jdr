// Résout le token qui peut réellement porter une interaction personnelle
// (émote, action rapide…). La sélection peut viser un ennemi pour l'attaquer ou
// l'inspecter : elle ne vaut donc jamais, à elle seule, autorisation de contrôle.
export function resolveControlledTokenId(selectedId, entries, activePageId, canControl) {
  const tokenOf = id => entries?.[id]?.data || null;
  const eligible = token => !!token
    && (!activePageId || token.pageId === activePageId)
    && canControl(token);

  const selected = tokenOf(selectedId);
  if (eligible(selected)) return selected.id;

  const fallback = Object.values(entries || {})
    .map(entry => entry?.data)
    .find(eligible);
  return fallback?.id || null;
}

/** Retourne le token personnage qui prouve un contrôle direct ou délégué. */
export function resolveCharacterControlToken(charId, entries, uid, characters = null) {
  if (!charId || !uid) return null;
  const character = characters?.[charId];
  const delegatedByCharacter = Array.isArray(character?.controlDelegates)
    && character.controlDelegates.includes(uid);
  return Object.values(entries || {})
    .map(entry => entry?.data || entry)
    .find(token => token?.characterId === charId
      && (token.ownerId === uid
        || delegatedByCharacter
        || (Array.isArray(token.controlDelegates) && token.controlDelegates.includes(uid))))
    || null;
}

/** Propriété ou délégation d'un personnage pour un UID donné, sans dépendre du
 * rôle du spectateur courant (utile au MJ qui consulte le roster d'un joueur). */
export function isCharacterGrantedToUid(character, entries, uid, characters = null) {
  if (!character || !uid) return false;
  return character.uid === uid
    || (Array.isArray(character.controlDelegates) && character.controlDelegates.includes(uid))
    || !!resolveCharacterControlToken(character.id, entries, uid, characters);
}

/** Tokens de personnages contrôlés, sans inclure PNJ, ennemis ou invocations. */
export function controlledCharacterTokens(entries, canControl) {
  if (typeof canControl !== 'function') return [];
  return Object.values(entries || {})
    .map(entry => entry?.data || entry)
    .filter(token => token?.characterId && canControl(token));
}

/** Personnages réellement absents de la scène et donc invocables. */
export function invocableCharacterTokens(entries, activePageId, canControl) {
  if (!activePageId) return [];
  const tokens = Object.values(entries || {}).map(entry => entry?.data || entry).filter(Boolean);
  const onPageCharacters = new Set(tokens
    .filter(token => token.characterId && token.pageId === activePageId)
    .map(token => token.characterId));
  return controlledCharacterTokens(entries, canControl).filter(token =>
    token.pageId !== activePageId && !onPageCharacters.has(token.characterId));
}
