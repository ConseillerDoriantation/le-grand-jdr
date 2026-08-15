/**
 * Construit la liste complète des destinataires d'un transfert.
 *
 * STATE.characters peut ne contenir que les personnages du joueur connecté.
 * La collection de session apporte donc les autres personnages de l'aventure,
 * tandis que l'état local garde la priorité pour les données déjà actualisées.
 */
export function mergeCharacterTransferTargets(fromCharId, sessionCharacters = [], stateCharacters = []) {
  const charactersById = new Map();

  for (const character of [...sessionCharacters, ...stateCharacters]) {
    if (character?.id) charactersById.set(character.id, character);
  }

  return [...charactersById.values()]
    .filter(character => character.id !== fromCharId && character.nom)
    .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
}
