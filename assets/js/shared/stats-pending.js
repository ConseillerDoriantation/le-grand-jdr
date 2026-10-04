// ══════════════════════════════════════════════════════════════════════════════
// STATS-PENDING.JS — Tampon pur des statistiques en attente d'écriture
// ──────────────────────────────────────────────────────────────────────────────
// Quota : chaque jet, attaque, soin ou émote écrivait immédiatement le doc
// stats/main (une attaque = jusqu'à 3 écritures du même doc). stats.js cumule
// désormais ces événements quelques secondes puis les écrit en UNE fois.
//
// Le tampon garde des nombres BRUTS (sérialisables, testables sans Firebase) :
//   inc : arbre de compteurs sommés → increment(n) à l'écriture
//   max : arbre de records (plus gros coup…) → valeur brute, le plus grand gagne
// Les chaînes (nom du personnage) sont conservées telles quelles (dernière gagne).
// ══════════════════════════════════════════════════════════════════════════════

const _isPlain = v => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

export function createStatsPending() {
  return { inc: {}, max: {} };
}

export function isStatsPendingEmpty(pending) {
  return !pending || (!Object.keys(pending.inc).length && !Object.keys(pending.max).length);
}

// Ajoute un delta de compteurs. sign = −1 retire le delta (annulation MJ).
export function addStatsIncrement(pending, tree, sign = 1) {
  const walk = (dst, src) => {
    for (const [k, v] of Object.entries(src || {})) {
      if (typeof v === 'number') {
        if (Number.isFinite(v)) dst[k] = (typeof dst[k] === 'number' ? dst[k] : 0) + sign * v;
      } else if (typeof v === 'string') {
        dst[k] = v;
      } else if (_isPlain(v)) {
        walk(_isPlain(dst[k]) ? dst[k] : (dst[k] = {}), v);
      }
    }
  };
  walk(pending.inc, tree);
  return pending;
}

// Ajoute des records : à chemin égal, la plus grande valeur l'emporte.
export function addStatsMax(pending, tree) {
  const walk = (dst, src) => {
    for (const [k, v] of Object.entries(src || {})) {
      if (typeof v === 'number') {
        if (Number.isFinite(v)) dst[k] = typeof dst[k] === 'number' ? Math.max(dst[k], v) : v;
      } else if (typeof v === 'string') {
        dst[k] = v;
      } else if (_isPlain(v)) {
        walk(_isPlain(dst[k]) ? dst[k] : (dst[k] = {}), v);
      }
    }
  };
  walk(pending.max, tree);
  return pending;
}

// Patch Firestore unique (setDoc merge) : compteurs → toIncrement(n), records et
// noms en valeurs brutes. null si rien à écrire.
export function buildStatsPatch(pending, toIncrement = n => n) {
  if (isStatsPendingEmpty(pending)) return null;
  const build = (inc = {}, max = {}) => {
    const out = {};
    for (const k of new Set([...Object.keys(inc), ...Object.keys(max)])) {
      const a = inc[k], b = max[k];
      if (_isPlain(a) || _isPlain(b)) out[k] = build(_isPlain(a) ? a : {}, _isPlain(b) ? b : {});
      else if (b !== undefined) out[k] = b;
      else out[k] = typeof a === 'number' ? toIncrement(a) : a;
    }
    return out;
  };
  return build(pending.inc, pending.max);
}
