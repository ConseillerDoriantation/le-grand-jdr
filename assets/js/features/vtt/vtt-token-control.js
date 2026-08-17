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
