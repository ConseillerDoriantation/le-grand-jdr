// ══════════════════════════════════════════════════════════════════════════════
// ITEM-FACTS — Ce qu'est un objet et ce qu'il fait, en données (sans markup)
// ──────────────────────────────────────────────────────────────────────────────
// Partagé par la fiche objet de l'Inventaire (v11) et le Marché du Bastion :
// nature (arme / armure / bijou), famille du sac, ligne « ce que c'est », bonus
// chiffrés (paliers d'amélioration compris) et écarts « Si tu l'équipes ».
// Module FEUILLE et pur (ni DOM ni Firebase) : chaque vue garde son markup.
// ══════════════════════════════════════════════════════════════════════════════
import {
  ITEM_STAT_META, statShort, getItemStatBonus,
  computeEquipDerivedBonus, computeEquipAllSkillBonuses,
} from './char-stats.js';
import { getArmorTypeMeta, getWeaponDamageStatKeys } from './equipment-utils.js';
import {
  equipmentSlotAcceptsItem, getEquipmentSlots, getPrimaryWeaponSlotId,
  getSecondaryWeaponSlotId, resolveEquipmentSlotForItem,
} from './equipment-slots.js';
import { weaponHands, weaponHandsLabel } from './weapon-family.js';
import { _norm } from './html.js';

// Une ligne du sac = un lot d'objets identiques (même catalogue, nom et modèle).
export const itemGroupKey = (item = {}) => `${item.itemId || ''}||${item.nom || ''}||${item.template || item.type || ''}`;
export const itemSigned = n => `${n > 0 ? '+' : ''}${n}`;
// Barème réel 1-indexé (Commun = 1) ; 0 = rareté non renseignée.
export const itemRarity = item => Math.max(0, parseInt(item?.rarete ?? item?.rare ?? 0) || 0);

// ── Nature de l'objet ─────────────────────────
const _tpl = item => String(item?.template || '').toLowerCase();
export const isWeaponItem = item => _tpl(item) === 'arme' || !!(item.degats || item.toucher || item.toucherStat);
export const isArmorItem = item => _tpl(item) === 'armure' || !!(item.slotArmure || item.typeArmure) || (item.ca != null && item.ca !== '');
export const isJewelItem = item => _tpl(item) === 'bijou' || !!item.slotBijou;
const _looksJewel = item => /\b(bijou|bijoux|anneau|bague|amulette|collier|pendentif|talisman)\b/.test(_norm(`${item.nom || ''} ${item.type || ''}`));

export function isQuestItem(item = {}) {
  const hay = _norm(`${item.type || ''} ${item.categorie || ''} ${item.template || ''} ${item.tags || ''}`);
  return item.isQuest === true || item.quest === true || /\bquete\b|objet de quete|mission/.test(hay);
}

// Familles du sac : 5 rubriques FIXES (le type libre reste lu sur la ligne).
// Signaux d'équipement d'abord, puis matériaux, puis noms de bijoux : une
// armure de cuir reste une armure, « Mat. bijou » est un matériau. `readable` :
// l'objet porte un document lisible (résolu par l'appelant via le catalogue).
export const ITEM_FAMILIES = [
  { id: 'equip', label: 'Équipement' },
  { id: 'conso', label: 'Consommables' },
  { id: 'mat',   label: 'Matériaux' },
  { id: 'quest', label: 'Quête & clés' },
  { id: 'misc',  label: 'Divers' },
];
export function itemFamily(item, { readable = false } = {}) {
  const hay = _norm(`${item.type || ''} ${item.categorie || ''} ${item.sousType || ''} ${item.template || ''}`);
  if (isQuestItem(item) || readable || /\b(cle|clef|cles|clefs|document|lettre|missive)\b/.test(hay)) return 'quest';
  if (isWeaponItem(item) || isArmorItem(item) || isJewelItem(item)) return 'equip';
  if (/\bmat\b|materiau|composant|ressource|ingredient|reactif|plante|herbe|minerai|lingot|cuir|bois|tissu|metal/.test(hay)) return 'mat';
  if (_looksJewel(item)) return 'equip';
  if (/potion|consommable|elixir|antidote|parchemin|scroll|munition|fleche|carreau|nourriture|ration|repas|boisson|poison/.test(hay)) return 'conso';
  return 'misc';
}

// « Ce que c'est » : une ligne courte et constante selon la nature de l'objet.
export function itemKind(item) {
  if (isWeaponItem(item)) {
    return [item.format || item.sousType || 'Arme', weaponHands(item) === 2 ? weaponHandsLabel(item) : '',
      item.portee && !/contact/i.test(item.portee) ? `portée ${item.portee}` : ''].filter(Boolean).join(' · ');
  }
  if (isArmorItem(item)) {
    const type = item.typeArmure ? (getArmorTypeMeta(item.typeArmure)?.label || item.typeArmure) : '';
    return [type ? `Armure ${String(type).toLowerCase()}` : 'Armure', item.slotArmure].filter(Boolean).join(' · ');
  }
  if (isJewelItem(item) || _looksJewel(item)) return item.slotBijou || item.type || 'Bijou';
  return item.type || item.categorie || 'Objet';
}

// « Ce que ça fait » : uniquement des nombres. Mêmes calculs que la fiche
// (paliers d'amélioration compris) ; zéros inclus, ordre fixe pour comparer.
// `cls` = classes de teinte partagées (stat-tone / derived-tone).
const _DERIVED = [
  ['pvMaxBonus', 'PV', 'derived-pv'],
  ['pmMaxBonus', 'PM', 'derived-pm'],
  ['vitesseBonus', 'Vit.', 'derived-speed'],
  ['initiativeBonus', 'Init.', 'derived-init'],
];
export function itemBonuses(item = {}) {
  const derived = computeEquipDerivedBonus({ item });
  return [
    { k: 'CA', v: (parseInt(item.ca) || 0) + derived.caBonus, cls: 'derived-tone derived-ca' },
    ...ITEM_STAT_META.map(s => ({ k: s.short.toUpperCase(), v: getItemStatBonus(item, s.full), cls: `stat-tone stat-${s.full}` })),
    ..._DERIVED.map(([key, k, tone]) => ({ k, v: derived[key], cls: `derived-tone ${tone}` })),
    ...Object.entries(computeEquipAllSkillBonuses({ item })).map(([k, v]) => ({ k, v, cls: '' })),
  ];
}

export function itemDamageText(item) {
  const stats = getWeaponDamageStatKeys(item).map(statShort).filter(Boolean);
  return stats.length ? `${item.degats} + ${stats.join(' + ')}` : String(item.degats);
}

// Pastilles de la ligne : dégâts puis bonus non nuls.
export const itemChips = item => [
  ...(item.degats ? [{ t: itemDamageText(item), cls: 'is-dmg' }] : []),
  ...itemBonuses(item).filter(b => b.v).map(b => ({ t: `${b.k} ${itemSigned(b.v)}`, cls: b.cls })),
];

// Main secondaire « prise » par une arme à 2 mains : jamais une cible d'équipement.
export const itemSlotTaken = (c, slot) => !!c?.equipement?.[slot.id]
  || (slot.id === getSecondaryWeaponSlotId() && weaponHands(c?.equipement?.[getPrimaryWeaponSlotId()]) === 2);

// Emplacement visé si `c` équipait l'objet : le premier libre parmi les
// compatibles, sinon le préféré, sinon le premier compatible (null : aucun).
export function itemCompareSlot(c, item) {
  const compatible = getEquipmentSlots().filter(slot => equipmentSlotAcceptsItem(slot, item));
  const preferred = resolveEquipmentSlotForItem(item);
  return compatible.find(slot => !itemSlotTaken(c, slot))
    || compatible.find(slot => slot.id === preferred)
    || compatible[0] || null;
}

// « Si tu l'équipes » : seuls les nombres qui changent, [libellé, avant, après].
// Sans occupant, tout bonus non nul est un gain (emplacement libre).
export function itemCompareRows(item, occupant = null) {
  const before = new Map(occupant ? itemBonuses(occupant).map(b => [b.k, b.v]) : []);
  const rows = [];
  itemBonuses(item).forEach(b => {
    const was = before.get(b.k) || 0;
    before.delete(b.k);
    if (was !== b.v) rows.push([b.k, was, b.v]);
  });
  before.forEach((was, k) => { if (was) rows.push([k, was, 0]); });
  const dmgBefore = occupant?.degats ? itemDamageText(occupant) : '—';
  const dmgAfter = item.degats ? itemDamageText(item) : '—';
  if (dmgBefore !== dmgAfter) rows.unshift(['Dégâts', dmgBefore, dmgAfter]);
  return rows;
}
