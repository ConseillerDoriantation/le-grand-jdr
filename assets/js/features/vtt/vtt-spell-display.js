// ══════════════════════════════════════════════════════════════════════════════
// VTT — Affichage & formules de sorts (calcul pur, sans canvas ni Firestore)
// ──────────────────────────────────────────────────────────────────────────────
// Module LEAF : ne dépend que de helpers partagés (équipement, stats) et des
// caches de règles dans VS (damageTypes/weaponFormats). Importé par vtt.js ET
// vtt-mini-fiche.js → la mini-fiche n'a plus AUCUN import depuis vtt.js.
// Miroirs locaux de _calcSortDegats / _calcSortSoin (spells.js) pour éviter le
// cross-import features/characters.
// ══════════════════════════════════════════════════════════════════════════════
import { getMainWeapon, DEFAULT_UNARMED } from '../../shared/equipment-utils.js';
import { getMaitriseBonus, getMod } from '../../shared/char-stats.js';
import { VS } from './vtt-state.js';

// Rune virtuelle d'action (Réaction / Action Bonus condensées à l'affichage).
export const VTT_ACTION_RUNE = 'Déclenchement';

// Parse "NdM[+K]" ou nombre fixe → { n, sides, mod } ou null si non-formule.
export function _parseDice(formula) {
  if (!formula) return null;
  // Tolère les espaces autour du +/- (ex: "1d4 +2", "2d6 + 3", "1d4-2")
  const cleaned = String(formula).replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+)[dD](\d+)([+-]\d+)?$/);
  return m ? { n:+m[1], sides:+m[2], mod:+(m[3]||0) } : null;
}

/** Valeur maximale possible d'une formule de dés (ex: "2d6+3" → 15). */
export function _maxDice(formula) {
  const p = _parseDice(formula);
  return p ? p.n * p.sides + p.mod : Math.max(1, parseInt(formula)||1);
}

export function _maxEffectDisplay(formula, fixed = 0) {
  const str = String(formula || '').trim();
  if (!str) return '';
  const diceMatch = str.match(/(\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)/i);
  const base = diceMatch ? _maxDice(diceMatch[1]) : parseInt(str);
  if (!Number.isFinite(base)) return str;
  const suffix = /\/\s*(tour|t)\b/i.test(str) ? '/tour' : '';
  return `${base + (parseInt(fixed) || 0)}${suffix}`;
}

export function _effectDisplay(opt, formula, fixed = 0) {
  return opt?.mjAlwaysMax ? _maxEffectDisplay(formula, fixed) : String(formula || '');
}

/**
 * Formule de dégâts calculée d'un sort offensif.
 * Miroir local de _calcSortDegats (spells.js) — évite le cross-import.
 * Inclut : dés de base + runes Puissance + maîtrise arme principale.
 */
export function _vttSortDmgFormula(s, c, opts = {}) {
  // ⚠️ Utiliser getMainWeapon(c) pour récupérer le Poings (2d4) par défaut
  // si aucune arme principale équipée — aligne avec _calcSortDegats du sheet.
  const mainP   = c ? getMainWeapon(c) : null;
  const armeDeg = mainP?.degats || DEFAULT_UNARMED.degats;
  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;
  const runes    = s.runes || [];
  const nbPuiss  = opts.includePower === false ? 0 : runes.filter(r => r === 'Puissance').length;
  // Seule la Puissance ajoute des dés. La Protection ne sert qu'au drain % — elle
  // NE double PAS les dégâts (bug : le combo Drain affichait 2d10 au lieu de 1d10).
  // Aligne strictement avec _calcSortDegats du sheet.
  const maitrise = getMaitriseBonus(c, mainP || {});
  const m = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (m) {
    let r = `${parseInt(m[1]) + nbPuiss}${m[2]}${m[3]}`;
    if (maitrise > 0) r += ` +${maitrise}`; else if (maitrise < 0) r += ` ${maitrise}`;
    return r;
  }
  let r = base;
  if (nbPuiss > 0) r += ` +${nbPuiss}d6`;
  if (maitrise > 0) r += ` +${maitrise}`; else if (maitrise < 0) r += ` ${maitrise}`;
  return r;
}

/**
 * Formule de soin calculée d'un sort défensif (mode soin).
 * Miroir local de _calcSortSoin (spells.js).
 * Inclut : 1d4 base + runes Protection + maîtrise + mod de stat.
 * Stat utilisée :
 *  - Noyau magique avec arme magique équipée → stat d'attaque de l'arme
 *  - Noyau magique sans arme magique (Poings) → Intelligence
 *  - Noyau physique / pas de noyau → Constitution
 */
export function _vttSortSoinFormula(s, c) {
  // Aligne sur le sheet : getMainWeapon retourne Poings par défaut si vide.
  const mainP    = c ? getMainWeapon(c) : null;
  const maitrise = getMaitriseBonus(c, mainP || {});
  const runes    = s.runes || [];
  const nbProt   = runes.filter(r => r === 'Protection').length;
  const base     = (s.soin || '').trim();

  // Détermine la stat de soin :
  //  - Override explicite du sort (s.degatsStat) → priorité absolue
  //  - Sinon auto selon la nature du noyau (magique vs physique)
  let statKey;
  if (s?.degatsStat) {
    statKey = s.degatsStat;
  } else {
    const dmgTypes = VS.damageTypes;
    const noyauTypeId = s?.noyauTypeId;
    const isMagic = !!(dmgTypes && noyauTypeId && dmgTypes.find(x => x.id === noyauTypeId)?.isMagic);
    statKey = 'constitution';
    if (isMagic) {
      const fmt = VS.weaponFormats?.find(f => f.label === mainP?.format);
      // Les Poings par défaut (isDefault) ne sont pas une arme magique
      const isMagicWeapon = fmt?.isMagic === true && mainP?.nom && !mainP?.isDefault;
      statKey = isMagicWeapon ? (mainP.statAttaque || mainP.toucherStat || 'intelligence') : 'intelligence';
    }
  }
  // Stat 'none' : aucun modificateur de carac (potion à valeur fixe, etc.)
  // Dans ce cas on n'ajoute NI la stat NI la maîtrise → effet 100% fixe.
  const noStatMod = statKey === 'none';
  const statMod = noStatMod ? 0 : (c ? getMod(c, statKey) : 0);
  const effectiveMaitrise = noStatMod ? 0 : maitrise;

  const totalFlat = effectiveMaitrise + statMod;
  const flatStr = totalFlat > 0 ? ` +${totalFlat}` : totalFlat < 0 ? ` ${totalFlat}` : '';
  if (!base || base.toLowerCase() === '= base') {
    return `${1 + nbProt}d4${flatStr}`;
  }
  if (nbProt > 0) {
    const m = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (m) {
      return `${parseInt(m[1]) + nbProt}${m[2]}${m[3]}${flatStr}`;
    }
    return base;
  }
  return flatStr ? base + flatStr : base;
}

export function _vttAmpDispCircleSize(nbAmp, nbDisp) {
  const rank = Math.min(parseInt(nbAmp) || 0, parseInt(nbDisp) || 0);
  return rank >= 1 ? (4 * rank - 1) : 0;
}

export function _vttSpellActionMode(s) {
  const runes = s?.runes || [];
  // actionMode explicite (sort/objet) honoré tel quel — il n'est jamais
  // positionné sans intention, donc pas de faux positif sur un sort normal.
  if (s?.actionMode === 'reaction' || s?.actionMode === 'action_bonus') return s.actionMode;
  if (runes.includes('Réaction')) return 'reaction';
  if (runes.includes('Action Bonus')) return 'action_bonus';
  return 'action';
}

export function _vttDisplayRunes(runes = []) {
  let hasActionRune = false;
  const out = [];
  runes.forEach(r => {
    if (r === 'Réaction' || r === 'Action Bonus' || r === VTT_ACTION_RUNE) {
      if (!hasActionRune) out.push(VTT_ACTION_RUNE);
      hasActionRune = true;
      return;
    }
    out.push(r);
  });
  return out;
}
