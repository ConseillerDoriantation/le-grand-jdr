/**
 * Niveau de détail autorisé pour les ressources d'une cible dans le chat.
 * Les anciens PNJ hostiles ne portent pas toujours `type: enemy` : tout token
 * non contrôlé qui n'est pas un personnage connu est donc masqué par défaut.
 */
export function combatTargetResourceVisibility({ isAdmin = false, target = {}, token = null, canControl = false } = {}) {
  if (isAdmin) return 'exact';
  // Invariant absolu : un joueur ne voit jamais les PV réels d'un ennemi,
  // même si un ancien token lui donne par erreur un droit de contrôle.
  if (token?.type === 'enemy' || target.beastId || token?.beastId) return 'estimate';
  if (canControl) return 'exact';
  if (target.characterId && token?.type !== 'enemy') return 'exact';
  return 'hidden';
}

/**
 * Quantité de dégâts que le journal peut afficher sans révéler les vrais PV.
 *
 * `dmgTotal` reste le résultat public du jet et sert notamment à faire évoluer
 * l'estimation personnelle d'un ennemi. `dmgApplied` correspond, lui, aux PV
 * réellement retirés après la borne à 0. Cette seconde valeur n'est affichable
 * que lorsque le spectateur a déjà accès aux ressources exactes de la cible.
 */
export function visibleCombatDamage({ isAdmin = false, target = {}, token = null, canControl = false } = {}) {
  const rolled = Number(target?.dmgTotal);
  if (!Number.isFinite(rolled)) return 0;
  // Une absorption est encodée avec une valeur négative et n'entre pas dans
  // `dmgApplied` (qui ne mesure que les PV perdus).
  if (rolled < 0) return rolled;

  const applied = Number(target?.dmgApplied);
  const visibility = combatTargetResourceVisibility({ isAdmin, target, token, canControl });
  if (visibility !== 'exact' || !Number.isFinite(applied)) return rolled;
  return Math.max(0, Math.min(rolled, applied));
}

/** Ressource estimée, strictement bornée par ce que le joueur a renseigné. */
export function trackedCombatResourceValues({ tracker = null, token = null, estimateCurrent = null, isMana = false } = {}) {
  const maxRaw = isMana ? tracker?.pmActuel : tracker?.pvActuel;
  if (maxRaw === undefined || maxRaw === null || maxRaw === '') return { current:null, max:null };
  const parsedMax = Number.parseInt(maxRaw, 10);
  if (!Number.isFinite(parsedMax) || parsedMax < 0 || (!isMana && parsedMax === 0)) {
    return { current:null, max:null };
  }
  // `pvCombatHp` historique n'a pas de provenance et a parfois été initialisé
  // depuis les PV réels par le MJ. Pour les PV, seule l'estimation calculée dans
  // la session locale du joueur est fiable.
  const currentRaw = isMana
    ? token?.pmCombat
    : estimateCurrent;
  const parsedCurrent = currentRaw === undefined || currentRaw === null || currentRaw === ''
    ? parsedMax
    : Number.parseInt(currentRaw, 10);
  const current = Number.isFinite(parsedCurrent)
    ? Math.max(0, Math.min(parsedCurrent, parsedMax))
    : parsedMax;
  return { current, max:parsedMax };
}
