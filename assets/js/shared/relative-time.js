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
 * @param {object} [opts]
 * @param {string} [opts.invalid='récemment']  Repli si la date est illisible.
 * @param {string} [opts.prefix='']  Préfixe des durées (ex. 'il y a ') ; jamais
 *   appliqué à « à l'instant ».
 * @param {number} [opts.maxDays=Infinity]  Au-delà de ce nombre de jours, on
 *   affiche la date locale (fr-FR) au lieu de « N j ».
 */
export function timeAgo(raw, { invalid = 'récemment', prefix = '', maxDays = Infinity } = {}) {
  const ms = toMillis(raw);
  if (Number.isNaN(ms)) return invalid;
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (mins < 1) return 'à l’instant';
  if (mins < 60) return `${prefix}${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${prefix}${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < maxDays) return `${prefix}${days} j`;
  return new Date(ms).toLocaleDateString('fr-FR');
}
