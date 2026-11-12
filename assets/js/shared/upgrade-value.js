// ══════════════════════════════════════════════════════════════════════════════
// UPGRADE-VALUE.JS — Valeur des améliorations d'un objet (logique pure).
//
// Valeur = prix, au TARIF ACTUEL de world/upgrade_settings (Boutique → Gérer →
// Améliorations), des améliorations que l'objet porte (`item.upgrades`). À la
// revente on en rend `refundUpgradeRatio` : 20 % d'un anneau amélioré 2 fois à
// 250 PO = +100 or. Changer un tarif ou le % vaut pour les reventes suivantes.
// On part de l'état de l'objet, pas des PO loggées dans `upgrades.history`
// (0 en mode MJ gratuit, figées à l'ancien tarif).
//
// Aucune dépendance Firestore → testable directement (cf. tests/upgrade-value.test.js).
// ══════════════════════════════════════════════════════════════════════════════

import { weaponHands } from './weapon-family.js';
import { isWeaponItem, isArmorItem } from './item-facts.js';

// Catégories de fragments : un fragment ne se pose que sur un objet de la même
// catégorie (toutes les armes partagent 'arme', peu importe le format). La
// catégorie choisit aussi la grille de tarifs des stats.
export const FRAGMENT_CATEGORIES = [
  { id: 'arme',          label: 'Arme',          icon: '⚔️' },
  { id: 'Tête',          label: 'Tête',          icon: '🪖' },
  { id: 'Torse',         label: 'Torse',         icon: '🛡️' },
  { id: 'Pieds',         label: 'Pieds',         icon: '🥾' },
  { id: 'Amulette',      label: 'Amulette',      icon: '📿' },
  { id: 'Anneau',        label: 'Anneau',        icon: '💍' },
  { id: 'Objet magique', label: 'Objet magique', icon: '🔮' },
];

// Clés interdites comme catégorie (indexation d'objet → pollution de prototype).
const _UNSAFE_CAT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const _safeSlot = value => {
  const slot = String(value ?? '').trim();
  return slot && !_UNSAFE_CAT_KEYS.has(slot) ? slot : null;
};

// Catégorie de fragment d'un objet d'inventaire = clé de son sac de fragments
// (partagée avec le craft du VTT). La catégorie EST le nom du slot : l'armure et
// les accessoires sont forgeables quel que soit le slot choisi par le MJ (slots
// personnalisables), pas seulement sur une liste figée Tête/Torse/Pieds.
// Détection de nature = classificateurs canoniques `item-facts.js` (source unique,
// robustes aux objets définis par `degats`/`ca`/`typeArmure`/`template`).
// Renvoie null si l'objet n'est pas améliorable (ex : potion, objet libre).
export function getItemFragmentCategory(item = {}) {
  if (!item) return null;
  const tpl = String(item.template || '').toLowerCase();
  // 1. Armes & boucliers d'abord (un bouclier peut porter une CA sans être une armure).
  if (isWeaponItem(item) || /arme|bouclier|baguette|main libre/i.test(item.format || '')) return 'arme';
  // 2. Bijoux explicites avant l'armure (un bijou pourrait théoriquement porter une CA).
  if (tpl === 'bijou' || item.slotBijou) return _safeSlot(item.slotBijou) || 'Objet magique';
  // 3. Armures (template, slot, type d'armure ou CA) — repli 'armure' si slot vide/non sûr.
  if (isArmorItem(item)) return _safeSlot(item.slotArmure) || 'armure';
  return null;
}

const _level = v => Math.max(0, parseInt(v) || 0);
const _po = v => Math.max(0, parseFloat(v) || 0);
const _list = v => (Array.isArray(v) ? v.filter(Boolean) : []);
// Coût cumulé des paliers 1..n d'une grille { palier: PO } (palier absent = 0, comme l'Artisan).
const _tiers = (table, n) => {
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += _po(table?.[k]);
  return sum;
};

/** Prix (PO) des améliorations portées par l'objet, au tarif des réglages donnés. */
export function upgradeTariffValue(item = {}, settings = {}) {
  const up = item?.upgrades;
  if (!up) return 0;
  const s = settings || {};
  const levels = Object.values(up.statBonus || {}).map(_level).filter(Boolean);
  const isArmorLike = (item.template || '').toLowerCase() === 'armure' || !!item.slotArmure;
  let total = 0;
  switch (getItemFragmentCategory(item)) {
    case 'Anneau':   // chaque stat proposée et l'effet ont leurs propres paliers
      total = levels.reduce((sum, level) => sum + _tiers(s.ring, level), 0) + _tiers(s.ring, _level(up.effectBonus));
      break;
    case 'Amulette': // la n-ième stat distincte coûte le n-ième palier
      total = _tiers(s.amulet, levels.length);
      break;
    case 'arme':     // le n-ième point coûte le n-ième palier (grille 1M ou 2M)
      total = _tiers(s.weapon?.[weaponHands(item) === 2 ? '2H' : '1H'], levels.reduce((sum, level) => sum + level, 0));
      break;
    default:         // armure : budget de points (grille unique s.armor)
      if (isArmorLike) total = _tiers(s.armor, levels.reduce((sum, level) => sum + level, 0));
  }
  // Traits : un trait de base remplacé = un écrasement, les autres traits posés = des ajouts.
  const added = _list(up.addedTraits).length;
  const overwritten = Math.min(added, _list(up.removedBaseTraits).length);
  return total
    + overwritten * _po(s.trait?.overwriteTrait)
    + (added - overwritten) * _po(s.trait?.addTraitFromFragment);
}

/** Part du prix des améliorations rendue à la revente (`refundUpgradeRatio`, borné à 0..100 %). */
export function upgradeResaleBonus(item = {}, settings = {}) {
  const ratio = Math.min(1, parseFloat(settings?.refundUpgradeRatio) || 0);
  return ratio > 0 ? Math.round(upgradeTariffValue(item, settings) * ratio) : 0;
}
