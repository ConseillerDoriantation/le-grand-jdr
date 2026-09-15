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

/** Ressource estimée, strictement bornée par ce que le joueur a renseigné. */
export function trackedCombatResourceValues({ tracker = null, token = null, isMana = false } = {}) {
  const maxRaw = isMana ? tracker?.pmActuel : tracker?.pvActuel;
  if (maxRaw === undefined || maxRaw === null || maxRaw === '') return { current:null, max:null };
  const parsedMax = Number.parseInt(maxRaw, 10);
  if (!Number.isFinite(parsedMax) || parsedMax < 0 || (!isMana && parsedMax === 0)) {
    return { current:null, max:null };
  }
  // `pvCombatHp` historique n'a pas de provenance et a parfois été initialisé
  // depuis les PV réels par le MJ. Il n'est fiable côté joueur que si le VTT l'a
  // explicitement marqué comme estimation.
  const currentRaw = isMana
    ? token?.pmCombat
    : token?.pvCombatHpEstimated === true ? token?.pvCombatHp : null;
  const parsedCurrent = currentRaw === undefined || currentRaw === null || currentRaw === ''
    ? parsedMax
    : Number.parseInt(currentRaw, 10);
  const current = Number.isFinite(parsedCurrent)
    ? Math.max(0, Math.min(parsedCurrent, parsedMax))
    : parsedMax;
  return { current, max:parsedMax };
}
