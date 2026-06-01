// ══════════════════════════════════════════════════════════════════════════════
// SHARED / ENUMS.JS — Constantes métier partagées
// Couleurs sémantiques + énumérations de domaine (quêtes, …).
// Importer depuis n'importe quel feature :
//   import { STATUS_COLORS, QUEST_DIFF, QUEST_STATUT } from '../shared/enums.js';
// ══════════════════════════════════════════════════════════════════════════════

// ── Palette sémantique ────────────────────────────────────────────────────────
// Source unique des couleurs de statut utilisées dans quests, story, npcs, etc.
export const STATUS_COLORS = {
  success: '#22c38e',
  info:    '#4f8cff',
  warning: '#e8b84b',
  danger:  '#ff6b6b',
  muted:   '#a0aec0',
};

// ── Quêtes — Difficulté ───────────────────────────────────────────────────────
export const QUEST_DIFF = [
  { id: 'facile',    label: 'Facile',    color: STATUS_COLORS.success },
  { id: 'moyen',     label: 'Moyen',     color: STATUS_COLORS.info    },
  { id: 'difficile', label: 'Difficile', color: STATUS_COLORS.warning  },
  { id: 'extreme',   label: 'Extrême',   color: STATUS_COLORS.danger  },
];

// ── Quêtes — Statut ───────────────────────────────────────────────────────────
export const QUEST_STATUT = [
  { id: 'active',   label: 'Active',   color: STATUS_COLORS.info    },
  { id: 'terminee', label: 'Terminée', color: STATUS_COLORS.success },
  { id: 'echouee',  label: 'Échouée',  color: STATUS_COLORS.danger  },
];
