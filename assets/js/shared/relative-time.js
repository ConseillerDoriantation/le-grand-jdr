// ══════════════════════════════════════════════════════════════════════════════
// RELATIVE-TIME — libellé « il y a X » compact et robuste, partagé
// ══════════════════════════════════════════════════════════════════════════════
// Accepte un Timestamp Firestore (.toMillis()), un nombre de millisecondes ou une
// chaîne ISO. Une valeur absente, nulle ou invalide renvoie le libellé de repli
// (« récemment » par défaut) plutôt que « NaN min » : plusieurs écrans
// réimplémentaient cette logique et oubliaient que `Date.parse(...)` renvoie NaN
// (que `?? 0` ne rattrape pas) pour une date illisible.

/** Convertit une entrée hétérogène en millisecondes finies et positives, ou NaN. */
export function toMillis(raw) {
  const ms = typeof raw === 'number' ? raw : (raw?.toMillis?.() ?? Date.parse(raw || ''));
  return Number.isFinite(ms) && ms > 0 ? ms : NaN;
}

/**
 * Libellé compact : « à l'instant », « 5 min », « 3 h », « 2 j ».
 * @param {number|string|{toMillis:()=>number}} raw  Instant source.
 * @param {{ invalid?: string }} [opts]  Libellé de repli si la date est illisible.
 */
export function timeAgo(raw, { invalid = 'récemment' } = {}) {
  const ms = toMillis(raw);
  if (Number.isNaN(ms)) return invalid;
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (mins < 1) return 'à l’instant';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} j`;
}
