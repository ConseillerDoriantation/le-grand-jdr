// ══════════════════════════════════════════════════════════════════════════════
// inventory-utils.js — Convention "1 entrée = 1 unité"
//
// Toute l'app suppose : chaque entrée de `c.inventaire` = 1 unité d'objet.
// Les actions (vendre, supprimer, envoyer, déposer) utilisent `indices.length`
// comme quantité max et splicent une entrée par unité consommée.
//
// Cette utilité **normalise** : si une entrée a `qte > 1`, on la split en
// N entrées de qte=1 pour garantir la cohérence des comptes.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Normalise un tableau d'inventaire à la convention "1 entrée = 1 unité".
 * Retourne le tableau normalisé (potentiellement plus long).
 *
 * Idempotent : si tout est déjà à qte=1, retourne le tableau d'origine inchangé.
 */
export function normalizeInventaire(inv) {
  if (!Array.isArray(inv)) return inv;
  // Détecte la nécessité de normaliser (un seul passage)
  const needsNorm = inv.some(it => (parseInt(it?.qte) || 1) > 1);
  if (!needsNorm) return inv;

  const out = [];
  for (const item of inv) {
    if (!item || typeof item !== 'object') { out.push(item); continue; }
    const qte = Math.max(1, parseInt(item.qte) || 1);
    if (qte === 1) {
      out.push(item);
      continue;
    }
    // Split en N entrées de qte=1 — préserve toutes les autres propriétés (rareté, upgrades, etc.)
    for (let i = 0; i < qte; i++) {
      out.push({ ...item, qte: 1 });
    }
  }
  return out;
}

/** True si l'inventaire contient au moins une entrée à qte > 1. */
export function inventaireNeedsNorm(inv) {
  if (!Array.isArray(inv)) return false;
  return inv.some(it => (parseInt(it?.qte) || 1) > 1);
}

function _firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === '' || value === null || value === undefined) continue;
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function getInventoryItemValue(item = {}, catalogItem = null) {
  return Math.max(0, _firstFiniteNumber(
    catalogItem?.prix,
    item?.prixAchat,
    item?.prix,
    item?.price,
  ));
}

export function getInventoryItemResaleValue(item = {}, catalogItem = null) {
  const explicit = _firstFiniteNumber(catalogItem?.prixVente, item?.prixVente);
  if (explicit > 0) return explicit;
  return Math.round(getInventoryItemValue(item, catalogItem) * 0.6);
}

export function getInventoryItemImage(item = {}, catalogItem = null) {
  return item?.image || item?.imageUrl || item?.illustration
    || catalogItem?.image || catalogItem?.imageUrl || catalogItem?.illustration
    || '';
}

/**
 * Réconcilie les deux anciens champs de description de la boutique.
 * Les articles « classique » utilisaient `effet`, les articles libres
 * `description` ; certains anciens articles ont changé de template depuis.
 */
export function getShopItemEditableText(item = {}, field = 'description') {
  if (field === 'effet') return item?.effet ?? item?.description ?? '';
  if (field === 'description') return item?.description ?? item?.effet ?? '';
  return item?.[field] ?? '';
}

/**
 * Document lisible associé à un objet possédé. Le catalogue est prioritaire
 * afin de ne pas dupliquer un livre potentiellement long dans chaque fiche.
 * Le repli sur l'entrée d'inventaire conserve la compatibilité avec d'éventuels
 * objets historiques ou personnalisés.
 */
export function getInventoryReadableDocument(item = {}, catalogItem = null) {
  const html = String(catalogItem?.readableContent || item?.readableContent || '').trim();
  const available = !!html || catalogItem?.hasReadableContent === true || item?.hasReadableContent === true;
  if (!available) return null;
  return {
    title: String(catalogItem?.readableTitle || item?.readableTitle || item?.nom || 'Document').trim() || 'Document',
    html,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ : item boutique → entrée d'inventaire.
//
// À utiliser à TOUS les points qui copient un item de la boutique vers
// l'inventaire d'un perso (achat, butin, cadeau MJ, conversion stash → inventaire).
// Ainsi tout nouveau champ ajouté au schéma boutique est automatiquement propagé
// — plus besoin de maintenir 3+ listes de champs synchronisées.
//
// Champs explicitement EXCLUS (méta boutique, non pertinents en inventaire) :
//   id  (devient itemId)  ·  image  ·  dispo  ·  recipeMeta  ·  prix
//   readableContent/readableTitle (lus depuis le catalogue, sans duplication)
//   categorieId est conservé.
// Tout le reste de l'item est conservé tel quel via spread.
// ══════════════════════════════════════════════════════════════════════════════
const _DEEP_CLONE_FIELDS = ['traits', 'nonRecyclableTraits', 'degatsStats', 'actions'];

const _SHOP_EQUIP_COMMON_FIELDS = [
  'for', 'fo', 'dex', 'in', 'sa', 'co', 'ch',
  'pvMaxBonus', 'pmMaxBonus', 'vitesseBonus', 'initiativeBonus', 'caBonus',
  'skillBonuses', 'traits', 'nonRecyclableTraits', 'damageProfile', 'noRecycle', 'stats',
];
const _SHOP_TEMPLATE_FIELDS = {
  arme: [
    ..._SHOP_EQUIP_COMMON_FIELDS,
    'format', 'formatId', 'sousType', 'typeArme', 'nature', 'mains', 'degats', 'degatsStats',
    'degatsStat', 'toucherStat', 'toucher', 'portee', 'statAttaque',
  ],
  armure: [..._SHOP_EQUIP_COMMON_FIELDS, 'slotArmure', 'typeArmure', 'ca'],
  bijou: [..._SHOP_EQUIP_COMMON_FIELDS, 'slotBijou'],
  classique: ['type', 'effet', 'description'],
};

// Champs dont la présence dépend du type d'article. Exporté pour que
// l'éditeur retire aussi les anciennes valeurs du document boutique.
export const SHOP_TEMPLATE_MANAGED_FIELDS = [...new Set(Object.values(_SHOP_TEMPLATE_FIELDS).flat())];

function _shopTemplateOf(item = {}) {
  if (item.template === 'libre') return 'classique';
  if (_SHOP_TEMPLATE_FIELDS[item.template]) return item.template;
  // Compatibilité avec les anciens catalogues sans champ `template`.
  if (item.slotArmure || item.typeArmure || (item.ca !== undefined && item.ca !== '')) return 'armure';
  if (item.slotBijou) return 'bijou';
  if (item.degats || item.toucher || item.toucherStat || item.format || item.mains) return 'arme';
  return 'classique';
}

/** Retire les champs d'un ancien type (ex. dégâts d'une arme devenue potion). */
export function normalizeShopItemForTemplate(item = {}) {
  const template = _shopTemplateOf(item);
  const allowed = new Set(_SHOP_TEMPLATE_FIELDS[template] || _SHOP_TEMPLATE_FIELDS.classique);
  const normalized = { ...item, template };
  SHOP_TEMPLATE_MANAGED_FIELDS.forEach(key => {
    if (!allowed.has(key)) delete normalized[key];
  });
  return normalized;
}

export function shopItemToInvEntry(item, opts = {}) {
  if (!item || typeof item !== 'object') return null;
  item = normalizeShopItemForTemplate(item);
  const source     = opts.source     ?? 'boutique';
  const template   = opts.template   ?? item.template   ?? 'classique';
  const prixAchat  = opts.prixAchat  ?? item.prix       ?? item.prixAchat  ?? 0;
  const prixVente  = opts.prixVente  ?? item.prixVente  ?? Math.round((parseFloat(prixAchat) || 0) * 0.6);

  // Spread complet de l'item — capture tous les champs présents et futurs.
  const entry = { ...item };

  // Méta boutique à ne PAS coller en inventaire
  delete entry.id;        // id Firestore boutique, on garde la trace via itemId ci-dessous
  delete entry.image;     // image de boutique (généralement gros base64) — non utilisée en inventaire
  delete entry.dispo;     // stock boutique, sans rapport
  delete entry.recipeMeta;
  delete entry.prix;      // remplacé par prixAchat
  delete entry.ordre;
  delete entry.newUntil;
  delete entry.isNew;
  delete entry.masque;
  delete entry.readableContent; // contenu potentiellement long : source unique catalogue
  delete entry.readableTitle;

  // Clone profond des champs collection pour éviter le partage de référence
  _DEEP_CLONE_FIELDS.forEach(k => {
    if (Array.isArray(item[k])) entry[k] = item[k].map(x => (x && typeof x === 'object') ? { ...x } : x);
  });

  // Surcharge avec les champs canoniques inventaire
  // Préfère `itemId` quand il existe déjà (cas d'un re-snapshot depuis loot/inventaire,
  // où `id` est un UUID local sans rapport avec la boutique).
  entry.itemId = item.itemId || item.id || '';
  entry.source = source;
  entry.template = template;
  entry.qte = '1'; // convention "1 entrée = 1 unité"
  entry.prixAchat = parseFloat(prixAchat) || 0;
  entry.prixVente = parseFloat(prixVente) || 0;

  return entry;
}

const _SHOP_INVENTORY_FIELDS = new Set([
  ...SHOP_TEMPLATE_MANAGED_FIELDS,
  'nom', 'categorieId', 'template', 'rarete', 'actions', 'consommable', 'masque',
  'prixAchat', 'prixVente', 'hasReadableContent', 'image', 'imageUrl', 'illustration',
  'ordre', 'newUntil', 'isNew', 'dispo', 'recipeMeta',
]);

function _stableInventoryValue(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(_stableInventoryValue).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_stableInventoryValue(value[key])}`).join(',')}}`;
}

/**
 * Actualise une copie d'inventaire depuis son article source sans toucher aux
 * données propres à l'exemplaire (note, améliorations, quantité, provenance…).
 */
export function syncInventoryEntryFromShop(entry = {}, shopItem = {}) {
  const linkedId = entry.itemId || entry.shopItemId || '';
  const catalogId = shopItem.id || shopItem.itemId || '';
  if (!linkedId || linkedId !== catalogId) return entry;

  const fresh = shopItemToInvEntry(shopItem, {
    source: entry.source || 'boutique',
    prixAchat: shopItem.prix ?? entry.prixAchat ?? 0,
    prixVente: shopItem.prixVente,
  });
  if (!fresh) return entry;

  const next = { ...entry };
  _SHOP_INVENTORY_FIELDS.forEach(key => delete next[key]);
  Object.assign(next, fresh, {
    itemId: linkedId,
    source: entry.source || fresh.source,
  });
  delete next.shopItemId;
  return _stableInventoryValue(next) === _stableInventoryValue(entry) ? entry : next;
}
