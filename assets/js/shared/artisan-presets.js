// Presets d'économie appliqués à une copie de la vue fusionnée. Les recettes,
// l'affectation des disciplines et les plafonds restent intacts.

import { mergeArtisanSettings, DEFAULT_ARTISAN_UPGRADE } from './artisan-settings-model.js';
import { DEFAULT_CRAFT_CONFIG } from './craft-engine.js';

export const ARTISAN_PRESETS = [
  { id: 'genereux', label: 'Généreuse', hint: 'Tarifs −40 %, DD −2, pertes réduites', factor: .6, dd: -2, fail: 50, dis: 75, resale: 40, reforge: 30 },
  { id: 'standard', label: 'Standard', hint: 'Valeurs de référence du jeu', factor: 1, dd: 0, fail: 0, dis: 50, resale: 20, reforge: 50 },
  { id: 'rare', label: 'Rare', hint: 'Tarifs +50 %, DD +2, ressources exigeantes', factor: 1.5, dd: 2, fail: 0, dis: 25, resale: 0, reforge: 75 },
];

const clone = value => JSON.parse(JSON.stringify(value));
const round10 = value => Math.round((Number(value) || 0) / 10) * 10;

export function applyEconomyPreset(merged, id) {
  const preset = ARTISAN_PRESETS.find(entry => entry.id === id);
  if (!preset) return clone(merged);
  const next = clone(merged);
  const defaults = mergeArtisanSettings(DEFAULT_CRAFT_CONFIG, DEFAULT_ARTISAN_UPGRADE);
  for (const tier of [1, 2, 3]) next.craft.dd[tier] = Math.max(1, defaults.craft.dd[tier] + preset.dd);
  next.craft.fail = preset.fail;
  next.dis.pct = preset.dis;
  next.resale.pct = preset.resale;
  next.reforge.pct = preset.reforge;
  next.up.traitAdd = round10(defaults.up.traitAdd * preset.factor);
  next.up.traitRep = round10(defaults.up.traitRep * preset.factor);
  for (const key of Object.keys(next.up.grids)) {
    const grid = next.up.grids[key], baseGrid = defaults.up.grids[key];
    grid.base = round10(baseGrid.base * preset.factor);
    grid.prices = grid.prices.map((_, index) => {
      const fallback = baseGrid.prices.at(-1) * (index + 1) / baseGrid.prices.length;
      return round10((baseGrid.prices[index] ?? fallback) * preset.factor);
    });
  }
  for (const rarity of [2, 3, 4, 5]) next.reforge.gold[rarity] = round10((defaults.reforge.gold[rarity] || 0) * preset.factor);
  return next;
}
