// ══════════════════════════════════════════════════════════════════════════════
// VTT — Drapeaux de tour datés par une époque (pur, testable)
// ──────────────────────────────────────────────────────────────────────────────
// Quota : chaque round (et chaque démarrage de combat) réécrivait tous les
// tokens qui avaient bougé ou agi, juste pour remettre leurs drapeaux à zéro,
// soit une dizaine d'écritures relues par chaque client. Les drapeaux sont
// désormais datés : le MJ incrémente `session.combat.turnEpoch` dans l'écriture
// de session qu'il fait déjà, et un token dont `turnEpoch` est PLUS ANCIEN se
// lit « remis à zéro ». Plus aucune écriture de token au passage de round.
//
// Sûreté :
//   • l'époque ne fait que monter : une époque connue en retard (cache) ne fait
//     jamais passer pour périmé un token daté plus récemment (comparaison <) ;
//   • on ne rétrograde jamais l'époque d'un token en écrivant ;
//   • un token hérité (sans époque) garde ses drapeaux tels quels : le MJ les
//     remet à zéro au round suivant comme avant, et le date au passage.
// `epoch` null = mécanisme désactivé : toutes les fonctions sont l'identité.
// ══════════════════════════════════════════════════════════════════════════════

// Bascule de livraison : actif depuis le déploiement des règles qui autorisent
// `turnEpoch` (vttTokens, liste hasOnly propriétaire/délégué). Sans elles, les
// déplacements des joueurs seraient refusés : repasser à false en cas de retour
// arrière des règles.
export const TURN_EPOCH_ENABLED = true;

export const TURN_FLAG_KEYS = Object.freeze([
  'movedThisTurn', 'movedCells', 'bonusMvt', 'moveOrigin',
  'attackedThisTurn', 'bonusActionThisTurn', 'reactionThisTurn',
]);

export const TURN_FLAG_RESET = Object.freeze({
  movedThisTurn: false, movedCells: 0, bonusMvt: 0, moveOrigin: null,
  attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
});

const _epochOf = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Époque de tour portée par la session (0 tant que le MJ n'en a jamais posé).
export function sessionTurnEpoch(session) {
  return _epochOf(session?.combat?.turnEpoch) ?? 0;
}

// Époque à écrire au round suivant / au démarrage d'un combat.
export function nextTurnEpoch(combat) {
  return (_epochOf(combat?.turnEpoch) ?? 0) + 1;
}

export function hasTurnFlags(token) {
  return !!(token && (token.movedThisTurn || token.movedCells || token.bonusMvt || token.moveOrigin != null
    || token.attackedThisTurn || token.bonusActionThisTurn || token.reactionThisTurn));
}

// Drapeaux datés d'une époque antérieure : ils ne valent plus.
export function turnFlagsStale(token, epoch) {
  const own = _epochOf(token?.turnEpoch);
  return epoch != null && own != null && own < epoch;
}

// Projection lue par le VTT : drapeaux périmés remis à zéro, `turnEpoch` brut
// conservé (les écrivains en ont besoin).
export function normalizeTurnFlags(token, epoch) {
  return turnFlagsStale(token, epoch) ? { ...token, ...TURN_FLAG_RESET } : token;
}

// Patch d'écriture daté. `raw` = token tel que connu localement (normalisé ou non).
export function stampTurnPatch(raw, patch, epoch) {
  if (epoch == null || !patch || !TURN_FLAG_KEYS.some(key => Object.hasOwn(patch, key))) return patch;
  const own = _epochOf(raw?.turnEpoch);
  if (own != null && own >= epoch) return patch;                           // déjà de cette époque
  if (own != null) return { ...TURN_FLAG_RESET, ...patch, turnEpoch: epoch }; // périmé : repart de zéro
  return { ...patch, turnEpoch: epoch };                                    // hérité : drapeaux du tour en cours
}

// Remise à zéro au passage de round / démarrage du combat. `epoch` = nouvelle
// époque (null si désactivé). Un token daté n'a rien à écrire ; un token hérité
// est remis à zéro comme avant (seulement les drapeaux posés) et daté.
export function roundTurnReset(token, epoch, deleteMoveOrigin = () => null) {
  if (epoch != null && _epochOf(token?.turnEpoch) != null) return {};
  const updates = {};
  if (token.movedThisTurn)       updates.movedThisTurn = false;
  if (token.movedCells)          updates.movedCells = 0;
  if (token.bonusMvt)            updates.bonusMvt = 0;
  if (token.moveOrigin != null)  updates.moveOrigin = deleteMoveOrigin();
  if (token.attackedThisTurn)    updates.attackedThisTurn = false;
  if (token.bonusActionThisTurn) updates.bonusActionThisTurn = false;
  if (token.reactionThisTurn)    updates.reactionThisTurn = false;
  if (epoch != null && Object.keys(updates).length) updates.turnEpoch = epoch;
  return updates;
}
