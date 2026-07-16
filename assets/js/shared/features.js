// ══════════════════════════════════════════════
// FEATURES — fonctionnalités activables par aventure
// Le MJ choisit quelles pages sont actives pour une aventure (doc
// adventures/{id}.enabledFeatures = tableau de clés). Champ ABSENT = legacy =
// tout activé (les aventures existantes / « Le Grand JDR » ne changent pas).
// Ce module est pur (pas d'effet de bord) et réutilisé par la nav, la garde de
// navigation, la command palette et la modale de gestion d'aventure.
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';

// Clé = valeur `data-navigate` de la page. Ordre = ordre d'affichage des toggles.
export const TOGGLEABLE_FEATURES = [
  { key: 'characters',   label: 'Personnage',   icon: '⚔️' },
  { key: 'story',        label: 'Trame',        icon: '📖' },
  { key: 'agenda',       label: 'Agenda',       icon: '🗓️' },
  { key: 'bestiaire',    label: 'Bestiaire',    icon: '🐉' },
  { key: 'shop',         label: 'Boutique',     icon: '🛒' },
  { key: 'collection',   label: 'Collection',   icon: '🃏' },
  { key: 'achievements', label: 'Hauts-Faits',  icon: '🏆' },
  { key: 'map',          label: 'Carte',        icon: '🗺️' },
  { key: 'world',        label: 'Guide',        icon: '🌍' },   // id interne 'world' conservé (données)
  { key: 'npcs',         label: 'PNJ',          icon: '👥' },
  { key: 'players',      label: 'Joueurs',      icon: '🎭' },
  { key: 'bastion',      label: 'Bastion',      icon: '🏰' },
  { key: 'recettes',     label: 'Recettes',     icon: '🧪' },
  { key: 'vtt',          label: 'VTT (Jouer)',  icon: '🎲' },
  { key: 'statistiques', label: 'Statistiques', icon: '📊' },
];

const _TOGGLEABLE_KEYS = new Set(TOGGLEABLE_FEATURES.map(f => f.key));
const _ALL_KEYS = TOGGLEABLE_FEATURES.map(f => f.key);

// Activées par défaut sur une NOUVELLE aventure : le socle d'une table classique
// (fiches, missions, séances, créatures, PNJ, table virtuelle). Le reste s'active
// via Gérer l'aventure. Décision produit 2026-07-16 (D&D-first).
export const DEFAULT_ENABLED = ['characters', 'story', 'agenda', 'bestiaire', 'npcs', 'vtt'];

// Pages toujours disponibles (jamais togglables). `admin` = Console MJ, gardée
// via son propre gating admin-only ; le reste = socle de navigation.
export const ALWAYS_ON = new Set(['dashboard', 'sessions', 'aventures', 'account', 'admin']);

export function isToggleable(page) {
  return _TOGGLEABLE_KEYS.has(page);
}

// Clés effectivement activées pour une aventure. Champ absent = legacy = tout.
export function enabledFeaturesOf(adv = STATE.adventure) {
  return Array.isArray(adv?.enabledFeatures) ? adv.enabledFeatures : _ALL_KEYS;
}

// Une page est-elle accessible pour l'aventure donnée ?
export function isFeatureEnabled(page, adv = STATE.adventure) {
  if (ALWAYS_ON.has(page)) return true;
  if (!_TOGGLEABLE_KEYS.has(page)) return true; // page non gérée par les toggles
  return enabledFeaturesOf(adv).includes(page);
}
