// ══════════════════════════════════════════════════════════════════════════════
// SIGNATURE-TRAITS.JS — Traits « signature » = exclusifs au MJ (logique pure).
//
// Un trait signature NE PEUT PAS être recyclé en fragment transférable : il reste
// lié à l'objet que le MJ a posé dans le monde. Empêche les joueurs de récupérer
// les meilleures synergies du MJ pour les reposer sur leur propre stuff.
//
// La liste est définie PAR AVENTURE (upgrade_settings.signatureTraits) — rien en
// brut. Comparaison souple (sans casse ni accents) car les traits sont des chaînes
// libres saisies à la main. Aucune dépendance Firestore → testable.
// ══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_SIGNATURE_TRAITS = [];

// Normalise un nom de trait pour comparaison : sans casse, sans accents, trimé.
export function normalizeTraitName(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Liste de noms signature → Set de clés normalisées (sans entrées vides).
export function signatureSet(list) {
  const set = new Set();
  for (const n of (Array.isArray(list) ? list : [])) {
    const k = normalizeTraitName(n);
    if (k) set.add(k);
  }
  return set;
}

// Un nom de trait est-il signature selon la liste de l'aventure ?
export function isSignatureTrait(name, list) {
  const k = normalizeTraitName(name);
  return !!k && signatureSet(list).has(k);
}

// Sépare une liste de traits en { transferable, signature } selon la liste MJ.
export function partitionTraits(traits, list) {
  const set = signatureSet(list);
  const transferable = [];
  const signature = [];
  for (const t of (Array.isArray(traits) ? traits : [])) {
    (set.has(normalizeTraitName(t)) ? signature : transferable).push(t);
  }
  return { transferable, signature };
}

// Parse une saisie admin (multi-lignes / séparée par , ou ;) → liste propre dédupliquée.
export function parseSignatureInput(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text == null ? '' : text).split(/[\n,;]+/)) {
    const v = raw.trim();
    if (!v) continue;
    const k = normalizeTraitName(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
