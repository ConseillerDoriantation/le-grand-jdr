// ══════════════════════════════════════════════════════════════════════════════
// SHOP-ITEM-STATS.JS — Helpers purs de stats / rareté des articles boutique
//
// Extrait de shop.js. Fonctions sans état mutable : parsing des bonus de stats
// (schéma legacy `for/dex/…` OU texte libre `stats`), texte d'affichage, rareté.
// Réutilisé par shop.js et shop-export.js.
// ══════════════════════════════════════════════════════════════════════════════
import { statShort as _statShort } from '../shared/char-stats.js';
import { _norm } from '../shared/html.js';
import { RARETE_NAMES } from '../shared/rarity.js';
import {
  formatWeaponDamageStatsText,
  getWeaponDamageStatKeys as _getDegatsStats,
  normalizeStatKey as _normalizeStatKey,
} from '../shared/equipment-utils.js';

export const ITEM_STATS = [
  { key:'force',       short:'For', store:'for',  label:'Force' },
  { key:'dexterite',   short:'Dex', store:'dex', label:'Dextérité' },
  { key:'intelligence',short:'Int', store:'in',  label:'Intelligence' },
  { key:'sagesse',     short:'Sag', store:'sa',  label:'Sagesse' },
  { key:'constitution',short:'Con', store:'co',  label:'Constitution' },
  { key:'charisme',    short:'Cha', store:'ch',  label:'Charisme' },
];
// Map clé → entrée ITEM_STATS (utilisé par _buildTagGroups pour les filtres « Stats ».)
export const ITEM_STAT_BY_KEY = Object.fromEntries(ITEM_STATS.map(s => [s.key, s]));

export function _parseLegacyStats(item = {}) {
  const out = { for:0, dex:0, in:0, sa:0, co:0, ch:0 };
  ['for','dex','in','sa','co','ch'].forEach(k => {
    const val = parseInt(item?.[k]);
    if (!Number.isNaN(val)) out[k] = val;
  });
  const txt = String(item?.stats || '');
  const aliases = {
    for:['for','force'], dex:['dex','dextérité','dexterite'], in:['in','int','intelligence'],
    sa:['sa','sag','sagesse'], co:['co','con','constitution'], ch:['ch','cha','charisme'],
  };
  Object.entries(aliases).forEach(([store, list]) => {
    if (out[store]) return;
    for (const token of list) {
      const re = new RegExp(`(?:^|[^a-z])${token}\\s*([+-]\\d+)|([+-]\\d+)\\s*${token}(?:[^a-z]|$)`, 'i');
      const m = txt.match(re);
      const picked = m?.[1] || m?.[2];
      if (picked) {
        out[store] = parseInt(picked) || 0;
        break;
      }
    }
  });
  return out;
}

export function _formatStatBonuses(item = {}) {
  const parsed = _parseLegacyStats(item);
  return ITEM_STATS
    .map(stat => ({ short: stat.short, val: parseInt(parsed[stat.store]) || 0 }))
    .filter(x => x.val)
    .map(x => `${x.short} ${x.val > 0 ? '+' : ''}${x.val}`);
}

export function _legacyStatsTextFromData(data = {}) {
  return _formatStatBonuses(data).join(' · ');
}

export function _formatDegatsStatsText(keys) {
  return formatWeaponDamageStatsText(keys, { statLabel: _statShort });
}

export function _legacyToucherTextFromData(data = {}) {
  const short = _statShort(data.toucherStat);
  return short ? `+${short}` : '';
}

export function _getRareteNum(value) {
  const direct = parseInt(value);
  if (direct > 0) return direct;

  const normalized = _norm(String(value || '').replace(/★/g, '').trim());
  const byName = RARETE_NAMES.findIndex(name => _norm(name) === normalized);
  if (byName > 0) return byName;

  const stars = String(value || '').match(/★/g)?.length || 0;
  return stars > 0 ? stars : 0;
}

export function _getItemStatFilterKeys(item = {}) {
  const keys = new Set();
  const parsed = _parseLegacyStats(item);

  ITEM_STATS.forEach(stat => {
    if (parseInt(parsed[stat.store]) || 0) keys.add(stat.key);
  });

  _getDegatsStats(item).forEach(key => keys.add(key));

  const toucherStat = _normalizeStatKey(item.toucherStat || item.toucher || item.statAttaque || '');
  if (toucherStat) keys.add(toucherStat);

  return [...keys];
}
