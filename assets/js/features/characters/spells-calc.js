// ════════════════════════════════════════════════════════════════════════════
// spells-calc.js — Fonctions de calcul pures pour les sorts
// Utilisé par spells.js (deck + modale) et potentiellement shop/bestiary.
// Pas de DOM, pas d'état d'UI. Seul état : caches Firestore chargés par la
// modale via setSpellCaches().
// ════════════════════════════════════════════════════════════════════════════

import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { getMaitriseBonus as getSharedMaitriseBonus, statShort } from '../../shared/char-stats.js';
import { getProtectionCAOverride, getComboConfig, getInvokedArm } from '../../shared/spell-matrices.js';
import { getMainWeapon } from './data.js';
import { calcSpellDuration, calcSpellTargets } from '../../shared/spell-runes.js';
// Cœurs purs extraits (testables à froid). Ré-exportés plus bas pour l'API publique.
import {
  _calcAfflictionDot, _autoSourceAfflictionDot, _calcEnchantDegats,
  _hasLaceration, _calcLaceration, _calcChance, _calcDrainPct, _calcConcentrationDD,
} from '../../shared/spell-math.js';
export {
  _calcAfflictionDot, _autoSourceAfflictionDot, _calcEnchantDegats,
  _hasLaceration, _calcLaceration, _calcDrainPct,
};

// ── Caches chargés depuis openSortModal ───────────────────────────────────────
let _spellMatricesCache = null;
let _damageTypesCache   = [];
// Bibliothèque d'états (conditions) — injectée depuis spells.js. Sans ça,
// _buildSortResume référençait un _conditionsLibCache inexistant ici (ReferenceError
// au split spells.js → spells-calc.js) dès qu'un sort affichait un état.
let _conditionsLibCache = [];

const ACTION_RUNE = 'Déclenchement';

function _spellActionMode(s) {
  const runes = s?.runes || [];
  if (runes.includes(ACTION_RUNE) && (s?.actionMode === 'reaction' || s?.actionMode === 'action_bonus')) return s.actionMode;
  if (runes.includes('Réaction')) return 'reaction';
  if (runes.includes('Action Bonus')) return 'action_bonus';
  return 'action';
}

function _isReactionSpell(s) {
  return _spellActionMode(s) === 'reaction'
    && ((s?.runes || []).includes(ACTION_RUNE) || (s?.runes || []).includes('Réaction'));
}

export function setSpellCaches(matrices, damageTypes) {
  _spellMatricesCache = matrices;
  _damageTypesCache   = damageTypes;
}
export function setConditionsLibCache(lib) {
  _conditionsLibCache = Array.isArray(lib) ? lib : [];
}
export function getSpellMatricesCache() { return _spellMatricesCache; }

// ── Helpers calcul sorts ─────────────────────────────────────────────────────

/**
 * TYPES d'un sort : tableau ['offensif','defensif','utilitaire']
 * Stocké explicitement dans s.types[]
 * Fallback legacy : typeSoin → defensif, noyau → offensif, sinon utilitaire
 */
export function _getSortTypes(s) {
  if (Array.isArray(s.types) && s.types.length) return s.types;
  // Legacy
  if (s.typeSoin) return ['defensif'];
  if (s.noyau)   return ['offensif'];
  return ['utilitaire'];
}

/** Type d'action : 'action' | 'action_bonus' | 'reaction'
 *  + concentration : boolean
 *  Type d'action 100% déterminé par les runes : Réaction > Action Bonus > Action.
 */
export function _getSortAction(s) {
  const runes = s.runes || [];
  const mode = _spellActionMode(s);
  const action        = mode === 'reaction'     ? 'reaction'
                      : mode === 'action_bonus' ? 'action_bonus'
                      : 'action';
  const concentration = runes.includes('Concentration');
  return { action, concentration };
}

/**
 * Dégâts effectifs d'un sort offensif.
 * - Base = dégâts de l'arme principale si degats vide
 * - Chaque rune Puissance : +1 dé
 */
export function _calcSortDegats(s, c) {
  // Un sort en mode déplacement (rune Amplification → Déplacement) n'inflige jamais de dégâts.
  if (s.ampMode === 'deplacement') return '';
  const mainP   = getMainWeapon(c);
  // Garde-fou : une arme sans champ `degats` (objet incomplet) ne doit pas faire
  // planter le calcul → repli sur les Poings (2d4). base est toujours une string.
  const armeDeg = (mainP && mainP.degats) ? String(mainP.degats) : '2d4';

  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;
  base = String(base || '2d4');

  const runes   = s.runes || [];
  const nbPuiss = runes.filter(r => r === 'Puissance').length;

  // Bonus de maîtrise de l'arme principale (toujours appliqué)
  const maitrise = getSharedMaitriseBonus(c, mainP);

  const match = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (match) {
    let result = `${parseInt(match[1]) + nbPuiss}${match[2]}${match[3]}`;
    if (maitrise > 0) result += ` +${maitrise}`;
    else if (maitrise < 0) result += ` ${maitrise}`;
    return result;
  }
  let result = base;
  if (nbPuiss > 0) result += ` +${nbPuiss}d6`;
  if (maitrise > 0) result += ` +${maitrise}`;
  else if (maitrise < 0) result += ` ${maitrise}`;
  return result;
}

/**
 * Soin effectif.
 * - Base 1d4 (visible dès que le sort est de type "défensif")
 * - Chaque rune Protection : +1d4
 * - Modificateur de stat selon nature du noyau :
 *    - Noyau MAGIQUE → modificateur de la stat de l'arme principale (Int/Sag/Cha…)
 *    - Noyau PHYSIQUE / sans noyau → modificateur de Constitution
 * - Maîtrise de l'arme principale ajoutée (uniquement si noyau magique)
 * - Format texte libre (ex: "moitié des dégâts") → affiché tel quel, rien ajouté
 */
export function _calcSortSoin(s, c) {
  const runes  = s.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const base   = (s.soin || '').trim();

  // Stat de soin : 'none' = aucun modificateur (potion flat, etc.)
  const isMagic = _isNoyauMagic(s);
  const statKey = _getSortSoinStatKey(s, c);
  const noMod   = statKey === 'none';
  const statVal = noMod ? 10 : ((c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0));
  const statMod = noMod ? 0 : Math.floor((Math.min(22, statVal) - 10) / 2);
  const statStr = statMod > 0 ? ` +${statMod}` : statMod < 0 ? ` ${statMod}` : '';

  // Maîtrise de l'arme : pertinente uniquement pour les sorts magiques (l'arme est le focus)
  const mainP   = getMainWeapon(c);
  const maitrise = isMagic ? getSharedMaitriseBonus(c, mainP) : 0;
  const maitriseStr = maitrise > 0 ? ` +${maitrise}` : maitrise < 0 ? ` ${maitrise}` : '';

  const buildDefault = (diceCount) => {
    return `${diceCount}d4${statStr}${maitriseStr}`;
  };

  if (!base || base.toLowerCase() === '= base') {
    return buildDefault(1 + nbProt);
  }
  if (nbProt > 0) {
    const match = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (match) {
      // Format XdY reconnu → on ajoute les dés Protection + stat + maîtrise.
      return `${parseInt(match[1]) + nbProt}${match[2]}${match[3]}${statStr}${maitriseStr}`;
    }
    // Texte libre → on n'ajoute rien, on respecte ce qui est écrit
    return base;
  }
  if (maitriseStr || statStr) return `${base}${statStr}${maitriseStr}`;
  return base;
}

function _fmtSigned(n) {
  const v = parseInt(n) || 0;
  return v >= 0 ? `+${v}` : `${v}`;
}

function _splitDiceBase(formula = '') {
  const raw = String(formula || '').trim();
  const m = raw.match(/^(\d+d\d+)(.*)$/i);
  if (!m) return { dice: raw, tail: '' };
  return { dice: m[1], tail: (m[2] || '').trim() };
}

function _isFlatTail(tail = '') {
  return /^[+-]\s*\d+(?:\s*[+-]\s*\d+)*$/.test(String(tail || '').trim());
}

function _scaleDiceFormulaDice(formula, extraDice = 0) {
  const raw = String(formula || '').trim();
  const m = raw.match(/^(\d+)(d\d+)(.*)$/i);
  if (!m) return raw;
  return `${parseInt(m[1]) + (parseInt(extraDice) || 0)}${m[2]}`;
}

function _calcImpactDisplayParts(s, c) {
  const mainP = getMainWeapon(c);
  const baseRaw = (s?.degats || '').trim();
  const base = (!baseRaw || baseRaw.toLowerCase() === '= arme')
    ? (mainP?.degats || '2d4')
    : baseRaw;
  const nbPuiss = (s?.runes || []).filter(r => r === 'Puissance').length;
  const statKey = s?.degatsStat || mainP.statAttaque || mainP.toucherStat || 'force';
  const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
  const statMod = Math.floor((Math.min(22, statVal) - 10) / 2);
  const statLbl = statShort(statKey) || statKey.slice(0, 3);
  const maitrise = getSharedMaitriseBonus(c, mainP);
  const { dice, tail } = _splitDiceBase(_scaleDiceFormulaDice(base, nbPuiss));
  const hasDerivedFlat = statMod !== 0 || maitrise !== 0;
  const pieces = [dice];
  if (tail && !(hasDerivedFlat && _isFlatTail(tail))) pieces.push(tail);
  if (statMod) pieces.push(`${statLbl}(${_fmtSigned(statMod)})`);
  if (maitrise) pieces.push(`Maîtrise(${_fmtSigned(maitrise)})`);
  return { label: pieces.join(' + '), statLbl, statMod, maitrise };
}

function _calcHealDisplayParts(s, c) {
  const runes = s?.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const baseRaw = (s?.soin || '').trim();
  const isDefault = !baseRaw || baseRaw.toLowerCase() === '= base';
  const base = isDefault ? '1d4' : baseRaw;
  const statKey = _getSortSoinStatKey(s, c);
  const noMod = statKey === 'none';
  const statVal = noMod ? 10 : ((c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0));
  const statMod = noMod ? 0 : Math.floor((Math.min(22, statVal) - 10) / 2);
  const statLbl = noMod ? '' : (statShort(statKey) || statKey.slice(0, 3));
  const mainP = getMainWeapon(c);
  const maitrise = (!noMod && _isNoyauMagic(s)) ? getSharedMaitriseBonus(c, mainP) : 0;
  const diceCountBonus = isDefault || nbProt > 0 ? nbProt : 0;
  const scaled = _scaleDiceFormulaDice(base, diceCountBonus);
  const { dice, tail } = _splitDiceBase(scaled);
  if (!dice || !/^\d+d\d+$/i.test(dice)) return { label: _calcSortSoin(s, c), statLbl, statMod, maitrise };
  const hasDerivedFlat = statMod !== 0 || maitrise !== 0;
  const pieces = [dice];
  if (tail && !(hasDerivedFlat && _isFlatTail(tail))) pieces.push(tail);
  if (statMod) pieces.push(`${statLbl}(${_fmtSigned(statMod)})`);
  if (maitrise) pieces.push(`Maîtrise(${_fmtSigned(maitrise)})`);
  return { label: pieces.join(' + '), statLbl, statMod, maitrise };
}

/** Mode de la rune Protection : 'soin' | 'ca' — stocké dans s.protectionMode */
export function _getSortProtectionMode(s) {
  return s?.protectionMode || 'ca'; // défaut CA si non précisé
}

// ══════════════════════════════════════════════════════════════════════════════
// COMBOS DE RUNES — Transformations spéciales
// Un combo détecté change l'EFFET PRODUIT par les runes (pas juste un libellé).
// La logique de détection + transformation est ici. Le MJ peut activer/désactiver
// et renommer chaque combo via la console (matrice `combos`).
// ══════════════════════════════════════════════════════════════════════════════
export const SORT_COMBOS = [
  {
    id: 'drain',
    icon: '🩸',
    defaultName: 'Drain personnel',
    // Drain = sort OFFENSIF (qui inflige l'attaque de base) + Protection.
    // Le soin est plafonné par la frappe de base hors Puissance : Protection
    // améliore la régénération, Puissance améliore surtout les dégâts.
    detect: (counts, s) => counts.Protection > 0 && _getSortTypes(s).includes('offensif'),
    describe: (counts) => {
      const pct = Math.round((0.25 + 0.25 * counts.Protection) * 100);
      const pPart = counts.Puissance > 0 ? `Puissance ×${counts.Puissance} + ` : '';
      return `${pPart}Protection ×${counts.Protection} (soin) · ${pct}% des dégâts · cap frappe de base hors Puissance`;
    },
  },
  {
    id: 'zone_elargie',
    icon: '🌐',
    defaultName: 'Zone élargie',
    detect: (counts) => counts.Amplification > 0 && counts.Dispersion > 0,
    describe: (counts) => {
      const size = _ampDispCircleSize(counts.Amplification, counts.Dispersion);
      return `Amp ×${counts.Amplification} + Disp ×${counts.Dispersion} · zone ${size}×${size} cases`;
    },
  },
  {
    id: 'arme_invoquee',
    icon: '⚔️',
    defaultName: 'Arme invoquée',
    detect: (counts) => counts.Enchantement > 0 && counts.Invocation > 0,
    describe: (counts, s) => {
      const arm = getInvokedArm(_spellMatricesCache, s?.noyauTypeId);
      const nbP = counts.Puissance || 0;
      if (arm) {
        const tch = statShort(arm.statToucher) || arm.statToucher;
        const dmg = statShort(arm.statDegats)  || arm.statDegats;
        const statStr = (arm.statToucher === arm.statDegats) ? tch : `Touche:${tch} / Dégâts:${dmg}`;
        const puissBonus = nbP > 0 ? ` +${nbP} dé${nbP>1?'s':''} (Puissance)` : '';
        return `${arm.weapon} · ${arm.degats}${puissBonus} · ${statStr} · portée ${arm.portee} cases · 2 tours par défaut${arm.note ? ` · ${arm.note}` : ''}`;
      }
      return `Arme générique 1d8${nbP > 0 ? ` +${nbP} dé${nbP>1?'s':''} (Puissance)` : ''} · 2 tours par défaut · ⚠️ matrice Armes invoquées vide pour cet élément`;
    },
  },
  // [Combo « Allonge magique » (Ench+Amp) retiré : remplacé par l'état d'enchantement
  //  « Allonge » — l'Amplification augmente sa portée. Voir conditions.js.]
  {
    id: 'sentinelle',
    icon: '🪤',
    defaultName: 'Sentinelle / Piège',
    // Invocation + Affliction (TOUTE branche, y compris Lacération) → Sentinelle.
    // Les branches d'Affliction ne s'appliquent pas : c'est une invocation de sentinelle.
    detect: (counts) => counts.Affliction > 0 && counts.Invocation > 0,
    describe: (counts, s) => {
      const st = _calcSentinelStats(s || {});
      const nbSent = counts.Invocation || 1;   // nombre piloté par la rune Invocation (1 par rune)
      const sentStr = nbSent > 1 ? `${nbSent} sentinelles stationnaires (placement libre dans la portée)` : 'sentinelle stationnaire';
      return `Affliction + Invocation · ${sentStr} · ${st.hp} PV · CA ${st.ca} · attaque ${st.dmg} · portée ${st.portee} cases · 2 tours par défaut`;
    },
  },
  {
    id: 'canalise_persistant',
    icon: '🧠',
    defaultName: 'Sort canalisé persistant',
    detect: (counts) => (counts.Durée || 0) > 0 && counts.Concentration > 0 && (counts.Réaction || 0) === 0,
    describe: (counts) =>
      `Durée + Concentration · le sort tient tant que la concentration est maintenue · après rupture, l'effet persiste encore 2 tours`,
  },
  {
    id: 'bouclier_reactif',
    icon: '🛡️',
    defaultName: 'Bouclier réactif',
    detect: (counts, s) => counts.Réaction > 0 && counts.Protection > 0 && (s?.protectionMode || 'ca') === 'ca',
    describe: (counts) => {
      const nbP = counts.Protection;
      const tier = nbP >= 3 ? 'Boss ou inférieur' : nbP === 2 ? 'Élite ou inférieur' : 'Mob classique';
      return `Réaction + Protection ×${nbP} · annule 1 attaque entrante en réaction (pas de bonus CA) · plafond cible : ${tier}`;
    },
  },
  {
    id: 'regeneration',
    icon: '💚',
    defaultName: 'Régénération',
    // Protection + Affliction : les deux runes perdent leur effet initial
    // et deviennent un soin sur la durée appliqué à un allié.
    detect: (counts, s) => counts.Protection > 0 && counts.Affliction > 0 && (counts.Invocation || 0) === 0 && s?.afflictionMode !== 'laceration',
    describe: (counts) => {
      const dice = (counts.Protection || 0) + (counts.Affliction || 0);
      return `Protection ×${counts.Protection} + Affliction ×${counts.Affliction} · ${dice}d4 PV/tour pendant la durée du sort`;
    },
  },
  {
    id: 'sort_suspendu',
    icon: '🔮',
    defaultName: 'Sort suspendu',
    // Concentration + Réaction : stocke un sort onHit INSTANTANÉ, déclenchement
    // manuel hors-tour. Durée prolonge le stockage (+2 tours chacune). Exclut les
    // effets sur la durée (Affliction/DoT, Régénération, Enchantement, Invocation).
    detect: (counts) => (counts.Concentration || 0) > 0 && counts.Réaction > 0
      && (counts.Affliction || 0) === 0 && (counts.Enchantement || 0) === 0
      && (counts.Invocation || 0) === 0 && (counts.Lacération || 0) === 0,
    describe: (counts) => {
      const nbDur = counts.Durée || 0;
      const turns = 2 + 2 * nbDur;
      return `Concentration + Réaction · sort onHit instantané stocké au cast (PM payé) · déclenchable hors de votre tour pendant ${turns} tours${nbDur ? ` (Durée ×${nbDur})` : ''}`;
    },
  },
  {
    id: 'coup_chance',
    icon: '🍀',
    defaultName: 'Coup de chance',
    // Chance + Réaction : les runes sont absorbées en une relance automatique.
    detect: (counts) => (counts.Chance || 0) > 0 && counts.Réaction > 0,
    describe: () =>
      `Chance + Réaction · 1 relance automatique sur le prochain jet échoué · remplace le bonus critique de Chance`,
  },
];

/** Construit le compteur des runes depuis un sort. */
export function _runeCounts(s) {
  const counts = {};
  (s?.runes || []).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  if ((counts[ACTION_RUNE] || 0) > 0) {
    if (_spellActionMode(s) === 'reaction') counts.Réaction = Math.max(counts.Réaction || 0, counts[ACTION_RUNE]);
    if (_spellActionMode(s) === 'action_bonus') counts['Action Bonus'] = Math.max(counts['Action Bonus'] || 0, counts[ACTION_RUNE]);
  }
  return counts;
}

/** Renvoie les combos actifs pour un sort (filtre selon config MJ enabled/disabled). */
export function _activeCombos(s) {
  const counts = _runeCounts(s);
  const matrices = _spellMatricesCache;
  return SORT_COMBOS.filter(combo => {
    const cfg = getComboConfig(matrices, combo.id);
    if (!cfg.enabled) return false;
    try { return !!combo.detect(counts, s); } catch { return false; }
  }).map(combo => {
    const cfg = getComboConfig(matrices, combo.id);
    return { ...combo, name: cfg.name, detail: combo.describe(counts, s) };
  });
}

function _comboResumeLines(activeCombos, comboIds, counts, s) {
  const lines = [];
  const combo = id => activeCombos.find(c => c.id === id);
  if (comboIds.has('zone_elargie')) {
    const size = _ampDispCircleSize(counts.Amplification || 0, counts.Dispersion || 0);
    lines.push({
      icon: '📐',
      label: `${combo('zone_elargie')?.name || 'Zone élargie'} · ${size}×${size} cases`,
      detail: 'Zone plaçable · remplace les cibles multiples de Dispersion',
      isCombo: true,
    });
  }
  if (comboIds.has('regeneration')) {
    const dice = (counts.Protection || 0) + (counts.Affliction || 0);
    const formula = (s.regenerationFormula || '').trim() || `${dice}d4`;
    lines.push({
      icon: '💚',
      label: `${combo('regeneration')?.name || 'Régénération'} · ${formula}/tour`,
      detail: 'Soin sur la durée · remplace Protection classique et Affliction classique · aucun dégât direct',
      isCombo: true,
    });
  }
  if (comboIds.has('arme_invoquee')) {
    lines.push({
      icon: '⚔️',
      label: combo('arme_invoquee')?.name || 'Arme invoquée',
      detail: combo('arme_invoquee')?.detail || 'Remplace Enchantement classique et Invocation générique',
      isCombo: true,
    });
  }
  if (comboIds.has('sentinelle')) {
    lines.push({
      icon: '🪤',
      label: combo('sentinelle')?.name || 'Sentinelle',
      detail: combo('sentinelle')?.detail || 'Remplace Affliction classique et Invocation générique',
      isCombo: true,
    });
  }
  if (comboIds.has('coup_chance')) {
    lines.push({
      icon: '🍀',
      label: combo('coup_chance')?.name || 'Coup de chance',
      detail: 'Prochain jet échoué relancé automatiquement · remplace Chance classique et Réaction classique · aucun dégât direct',
      isCombo: true,
    });
  }
  return lines;
}

// ── Auto-value : chip lecture seule + bouton "✏️ Custom" / "↺ Auto" ──────────
// Évite l'effet "input vide qui invite à taper". Le joueur voit la valeur
// calculée par défaut, et ne saisit que s'il veut explicitement override.
export function _autoSourceDegats(s, c) {
  const mainP   = getMainWeapon(c);
  // Override du sort sur la stat de dégâts (override sort > arme principale)
  const statKey = s?.degatsStat || mainP.statAttaque || 'force';
  const statLbl = statShort(statKey) || 'For';
  const nbP     = (s.runes||[]).filter(r => r === 'Puissance').length;
  const srcLbl  = s?.degatsStat ? `stat sort (${statLbl})` : statLbl;
  const parts   = [mainP.isDefault ? `Poings ${mainP.degats}` : (mainP.nom || 'arme'), srcLbl];
  if (nbP > 0) parts.push(`Puissance ×${nbP}`);
  return `auto · ${parts.join(' + ')}`;
}
export function _autoSourceSoin(s, c) {
  const nbProt = (s.runes||[]).filter(r => r === 'Protection').length;
  const isMagic = _isNoyauMagic(s);
  const statKey = _getSortSoinStatKey(s, c);
  const statLbl = statShort(statKey) || statKey.slice(0,3);
  // Le label reflète si la stat vient d'un override de sort ou de l'auto-dérivation arme/noyau
  const natureStr = s?.degatsStat
    ? `stat sort (${statLbl})`
    : (isMagic ? `magique · stat arme (${statLbl})` : `physique · Constitution (${statLbl})`);
  return nbProt > 0
    ? `auto · base 1d4 +${nbProt}d4 (Protection) · ${natureStr}`
    : `auto · base 1d4 · ${natureStr}`;
}
export function _autoSourceCA(s) {
  const nbProt = (s.runes||[]).filter(r => r === 'Protection').length;
  const ov = getProtectionCAOverride(_spellMatricesCache, s?.noyauTypeId);
  if (nbProt === 0) return 'auto · CA +2 (2 tours)';
  // Combo Bouclier réactif : pas de bonus CA — source informe
  const hasReaction = _isReactionSpell(s);
  if (hasReaction && (s.protectionMode || 'ca') === 'ca') {
    const cfg = getComboConfig(_spellMatricesCache, 'bouclier_reactif');
    if (cfg.enabled) return `combo Bouclier réactif · annule 1 attaque en réaction · Protection ×${nbProt}`;
  }
  const modStr = ov ? `mod ×${ov.mod}` : 'mod ×2';
  const noteStr = ov?.note ? ` · ${ov.note}` : '';
  return `auto · Protection ×${nbProt} · ${modStr} (2 tours)${noteStr}`;
}
export function _autoSourceEnchantDeg(s) {
  const nbP = (s.runes||[]).filter(r => r === 'Puissance').length;
  return nbP > 0 ? `auto · (1+${nbP} Puissance)d4 +2` : 'auto · 1d4 +2';
}

// Lit la valeur d'un <select> seulement s'il est RÉELLEMENT visible (aucun
// ancêtre en display:none). Évite de lire la valeur d'un sélecteur de stat
// caché qui aurait conservé sa valeur initiale et qui écraserait la sélection
// utilisateur sur la section visible.
export function _readVisibleStatOverride(...ids) {
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue;
    let n = el, visible = true;
    while (n && n !== document.body) {
      if (n.style?.display === 'none') { visible = false; break; }
      n = n.parentElement;
    }
    if (visible && el.value) return el.value;
  }
  return '';
}

// Helper : options HTML pour les select de stat de sort.
// Utilisé à plusieurs endroits (Toucher, Dégâts, Soin) — single source of truth.
export function _SPELL_STAT_OPTIONS(selected = '') {
  return [
    ['',           'Auto (arme)'],
    ['none',       'Aucune (pas de modificateur)'],
    ['force',       'Force'],
    ['dexterite',   'Dextérité'],
    ['intelligence','Intelligence'],
    ['sagesse',     'Sagesse'],
    ['constitution','Constitution'],
    ['charisme',    'Charisme'],
  ].map(([v, lbl]) => `<option value="${v}" ${selected===v?'selected':''}>${lbl}</option>`).join('');
}

/**
 * Génère le HTML d'un champ auto-calculé avec toggle Custom / Auto.
 * fieldId = id de l'input override (ex: 's-degats')
 * Le wrapper contient deux modes : display (chip lecture seule) et edit (input).
 */
export function _autoValHtml({ fieldId, label, autoValue, autoSource, currentValue, placeholder, extraEdit }) {
  // Mode Custom = toggle pour overrider la FORMULE.
  // Les sélecteurs de STAT (extraEdit) sont TOUJOURS visibles : changer la stat
  // ne nécessite pas de passer en mode Custom de la formule (ce sont des overrides
  // indépendants). Cela évite que l'override de stat ne soit jamais saisi.
  const hasOverride = !!(currentValue && String(currentValue).trim());
  const extraHtml   = extraEdit?.html || '';
  return `
    <div class="cs-spell-autoval ${hasOverride ? 'is-custom' : ''}">
      <div class="cs-spell-autoval-label">${label}</div>
      <div class="cs-spell-autoval-display" id="${fieldId}-display" style="${hasOverride?'display:none':''}">
        <span class="cs-spell-autoval-val"    id="${fieldId}-autoval">${autoValue || '—'}</span>
        <span class="cs-spell-autoval-source" id="${fieldId}-source">${autoSource || ''}</span>
        <button type="button" class="cs-spell-autoval-btn" data-action="_enableSortCustom" data-field="${fieldId}">✏️ Custom</button>
      </div>
      <div class="cs-spell-autoval-edit" id="${fieldId}-edit" style="${hasOverride?'':'display:none'}">
        <div class="cs-spell-autoval-edit-row">
          <input class="input-field" id="${fieldId}" value="${currentValue||''}" placeholder="${placeholder||''}">
          <button type="button" class="cs-spell-autoval-btn" data-action="_disableSortCustom" data-field="${fieldId}">↺ Auto</button>
        </div>
      </div>
      ${extraHtml}
    </div>
  `;
}

// Slots possibles pour Enchantement / Affliction (élément × slot = effet thématique)
export const SPELL_SLOTS = [
  { v:'arme',  label:'⚔️ Arme',   short:'Arme',  icon:'⚔️' },
  { v:'tete',  label:'👁️ Tête',   short:'Tête',  icon:'👁️' },
  { v:'torse', label:'👕 Torse',  short:'Torse', icon:'👕' },
  { v:'pieds', label:'👢 Pieds',  short:'Pieds', icon:'👢' },
];
export const SLOT_LABEL = { arme:'⚔️ Arme', tete:'👁️ Tête', torse:'👕 Torse', pieds:'👢 Pieds' };

/**
 * Dégâts du DoT d'affliction (mode 'dot') effectifs (auto si vide).
 * Formule : (1 + nbPuissance)d4 +2
 * → 0 Puiss : 1d4 +2 · 1 Puiss : 2d4 +2 · 2 Puiss : 3d4 +2
 */
/** Mapping legacy slot → stat de sauvegarde (rétro-compat sorts existants). */
function _legacySlotToStat(slot) {
  if (slot === 'torse') return 'constitution';
  if (slot === 'pieds') return 'force';
  if (slot === 'tete')  return 'sagesse';
  if (slot === 'arme')  return 'dexterite';
  return 'constitution';
}

/** Valeur CA (rune Protection mode CA) :
 *  - Saisie manuelle si fournie
 *  - Sinon auto : mod par rune selon élément ou 2 par défaut
 *  - Le mod par élément vient de la matrice MJ : _spellMatricesCache (Protection×CA)
 */
export function _getSortCA(s) {
  const manual = (s?.ca || '').trim();
  if (manual) return manual;
  const nbProt = (s.runes || []).filter(r => r === 'Protection').length;
  if (nbProt === 0) return 'CA +2 (2 tours)';
  // Combo Bouclier réactif : pas de bonus CA, juste un blocage en réaction
  const hasReaction = _isReactionSpell(s);
  if (hasReaction && (s.protectionMode || 'ca') === 'ca') {
    const cfg = getComboConfig(_spellMatricesCache, 'bouclier_reactif');
    if (cfg.enabled) {
      const tier = nbProt >= 3 ? 'Boss-' : nbProt === 2 ? 'Élite-' : 'Mob';
      return `Bloque 1 attaque (${tier})`;
    }
  }
  const ov  = getProtectionCAOverride(_spellMatricesCache, s?.noyauTypeId);
  const mod = ov?.mod ?? 2;
  return `CA +${nbProt * mod} (2 tours)`;
}

/**
 * Nombre de cibles — règle Dispersion solo :
 * 0 rune  → 1 cible
 * N runes → 1 + N cibles différentes
 *
 * En combo avec Amplification, Dispersion bascule en "élargissement de zone"
 * et ne génère PAS de cibles supplémentaires — la zone gère ça.
 */
export function _calcSortCibles(s) {
  return calcSpellTargets(s);
}

/** Éléments (noyaux) d'un sort, résolus en {id,label,icon,color} depuis la matrice.
 *  Supporte le multi-noyau (s.noyauTypeIds) avec repli sur le noyau unique legacy.
 */
export function noyauTypesFor(s) {
  const types = _damageTypesCache || [];
  const ids = (Array.isArray(s?.noyauTypeIds) && s.noyauTypeIds.length)
    ? s.noyauTypeIds
    : (s?.noyauTypeId ? [s.noyauTypeId] : []);
  return ids.map(id => types.find(t => t.id === id)).filter(Boolean);
}

/** Détermine si le noyau du sort est magique (depuis la matrice damage_types).
 *  Détermine la stat utilisée pour le soin (magique → arme · physique → Constitution).
 */
export function _isNoyauMagic(s) {
  const types = _damageTypesCache;
  if (!types || !s?.noyauTypeId) return false;
  const t = types.find(x => x.id === s.noyauTypeId);
  return !!t?.isMagic;
}

/** Stat utilisée pour calculer le bonus de soin :
 *   - Noyau magique avec arme magique équipée → stat de l'arme
 *   - Noyau magique sans arme (Poings) → Intelligence (fallback raisonnable)
 *   - Noyau physique / pas de noyau → Constitution
 */
function _getSortSoinStatKey(s, c) {
  // Override explicite du sort > déduction auto selon noyau
  if (s?.degatsStat) return s.degatsStat;
  if (_isNoyauMagic(s)) {
    const mainP = getMainWeapon(c);
    if (mainP.isDefault) return 'intelligence';
    return mainP.statAttaque || 'intelligence';
  }
  return 'constitution';
}

/** Vrai si le sort peut avoir une "durée de base" pertinente.
 *  Affiché conditionnellement dans le modal — Protection CA, Enchant, Affliction, ou rune Durée.
 */
export function _needsDureeBase(s) {
  const runes = s?.runes || [];
  if (!runes.length) return false;
  if (runes.includes('Durée')) return true;
  if (runes.includes('Enchantement') || runes.includes('Affliction')) return true;
  if (runes.includes('Protection') && (s?.protectionMode || 'ca') === 'ca') return true;
  // Concentration maintenue (hors combo Réaction) : sort à durée (10 tours).
  if (runes.includes('Concentration') && !runes.includes('Réaction')) return true;
  return false;
}

/** Durée totale en tours d'un sort.
 *  Base 2 tours (sort persistant) + bonus rune Durée.
 *  Bonus Durée : chaque rune ajoute +2.
 *  → 0 Durée : 2 · 1 Durée : 4 · 2 Durée : 6 · 3 Durée : 8
 *  Override : s.dureeBase remplace la base 2 si supérieur (saisie manuelle).
 */
export function _calcSortDuree(s) {
  return calcSpellDuration(s);
}
export function _autoSourceDuree(s) {
  const runes = s?.runes || [];
  const nbDur = runes.filter(r => r === 'Durée').length;
  // Concentration maintenue (hors combo Réaction) : durée longue par défaut.
  if (runes.includes('Concentration') && !runes.includes('Réaction')) {
    return nbDur
      ? `Concentration · maintenu (10 tours) · +${2 * nbDur} via Durée`
      : 'Concentration · maintenu tant que concentré (10 tours)';
  }
  if (nbDur === 0) return 'base persistante';
  if (nbDur === 1) return '+1 Durée · +2 tours';
  return `+${nbDur} Durée · +${2 * nbDur} tours`;
}


/** Longueur de zone produite par N runes (Amplification OU Dispersion en combo).
 *  Chaque rune ajoute +3 cases.
 *  ×1=3, ×2=6, ×3=9, ×4=12…
 */
export function _ampLength(nbAmp) { return nbAmp >= 1 ? 3 * nbAmp : 0; }

/** Taille de zone créée par le combo Amplification + Dispersion.
 *  Chaque palier consomme une paire Amp+Disp : 1 paire = 3×3, 2 paires = 7×7,
 *  3 paires = 11×11, etc.
 */
export function _ampDispCircleSize(nbAmp, nbDisp) {
  const rank = Math.min(parseInt(nbAmp) || 0, parseInt(nbDisp) || 0);
  return rank >= 1 ? (4 * rank - 1) : 0;
}

/** Taille d'un AXE de la zone combo Amp+Disp, par nombre de runes de cet axe.
 *  1 → 3, 2 → 7, 3 → 11 (4N−1). L'Amplification pilote la HAUTEUR, la Dispersion
 *  la LARGEUR : chaque rune ajoutée agrandit son axe (pas d'effet « payé pour rien »).
 */
export function _ampDispDim(n) { const v = parseInt(n) || 0; return v >= 1 ? (4 * v - 1) : 0; }

/** Longueur d'un BRAS de la croix, par nombre de runes de cet axe : 6N−1
 *  (1 → 5, 2 → 11, 3 → 17). Plus long que le côté du carré (4N−1) : la croix
 *  échange les cases diagonales contre une PORTÉE cardinale supérieure
 *  (au 1er palier : 9 cases comme le carré 3×3, mais atteint 2 cases au lieu d'1).
 */
export function _ampCrossDim(n) { const v = parseInt(n) || 0; return v >= 1 ? (6 * v - 1) : 0; }

/** Zone calculée :
 *  - Si zoneW/H manuels saisis → ils priment (override MJ)
 *  - Sinon, calculé depuis les runes Amplification (+ Dispersion en combo) :
 *      Amplification ×N → ligne de 3N cases
 *      Combo avec Dispersion : zone 3×3, puis 7×7, 11×11...
 *      Defaut combo Amp + Disp = 3 × 3
 *  - Source: 'manual' | 'runes' | null
 */
export function _calcSortZone(s) {
  // En mode déplacement, l'Amplification produit un déplacement, pas une zone.
  if (s.ampMode === 'deplacement') return null;
  const runes  = s.runes || [];
  // Avec Enchantement (hors combo Arme invoquée), l'Amplification BOOSTE l'effet
  // de l'enchantement (portée/déplacement de l'état) → ce n'est PAS un sort de zone.
  if (runes.filter(r => r === 'Enchantement').length > 0
      && runes.filter(r => r === 'Invocation').length === 0) return null;
  const wMan = s.zoneW ? parseInt(s.zoneW) : 0;
  const hMan = s.zoneH ? parseInt(s.zoneH) : 0;
  if (wMan > 0 || hMan > 0) return { w: wMan, h: hMan, source: 'manual' };

  const nbAmp  = runes.filter(r => r === 'Amplification').length;
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  if (nbAmp === 0) return null;

  if (nbDisp >= 1) {
    // Combo : Amplification → hauteur, Dispersion → largeur (chaque rune agrandit son axe).
    // Croix = bras plus longs (6N−1) que le carré (4N−1) → portée > mais pas de diagonales.
    const shape = s.zoneShape === 'cross' ? 'cross' : 'rect';
    const dim = shape === 'cross' ? _ampCrossDim : _ampDispDim;
    return { w: dim(nbDisp), h: dim(nbAmp), shape, source: 'runes', amp: nbAmp, disp: nbDisp };
  }

  const length = _ampLength(nbAmp);
  return { w: length, h: 1, shape: 'rect', source: 'runes', amp: nbAmp, disp: nbDisp };
}

/** Déplacement (rune Amplification en mode 'deplacement').
 *  Portée dérivée du nombre de runes Amplification : 1 à _ampLength(N) cases
 *  (1 rune → 1-3 cases, 2 runes → 1-6 cases…). Sous-modes : 'self' | 'push' | 'pull'.
 *  Retourne { mode, min:1, max } ou null.
 *  Fallback legacy : ancien déplacement autonome { mode, distance } sans ampMode.
 */
export function _calcSortDeplacement(s) {
  if (s.ampMode === 'deplacement') {
    const nbAmp = (s.runes || []).filter(r => r === 'Amplification').length;
    if (nbAmp < 1) return null;
    return { mode: s.deplacement?.mode || 'self', min: 1, max: _ampLength(nbAmp) };
  }
  // Compat anciennes données (déplacement saisi à la main, hors Amplification).
  if (s.deplacement?.mode) {
    return { mode: s.deplacement.mode, distance: Math.max(1, parseInt(s.deplacement.distance) || 1) };
  }
  return null;
}

/** Lacération est désormais une BRANCHE d'Affliction (afflictionMode='laceration').
 *  Le sort présente cette branche s'il a la rune Affliction en mode Lacération,
 *  ou (legacy) l'ancienne rune autonome « Lacération ».
 */
/** Stats propres de la Sentinelle (combo Affliction + Invocation).
 *  - Dégâts : 1d4 base + Puissance
 *  - PV     : 10 + 5×nbProt
 *  - CA     : 10 + 2×nbProt
 *  - Portée : 1 case (Manhattan) sans Amp · sinon 3N cases
 */
function _calcSentinelStats(s) {
  const runes = s?.runes || [];
  const nbP    = runes.filter(r => r === 'Puissance').length;
  const nbProt = runes.filter(r => r === 'Protection').length;
  const nbAmp  = runes.filter(r => r === 'Amplification').length;
  const nbDice = 1 + nbP;
  const dmg = `${nbDice}d4`;
  const hp = 10 + 5 * nbProt;
  const ca = 10 + 2 * nbProt;
  // Portée : 1 case sans Amp, sinon longueur Amp (réutilise _ampLength)
  const portee = nbAmp === 0 ? 1 : _ampLength(nbAmp);
  return { dmg, hp, ca, portee, nbP, nbProt, nbAmp };
}

/** Stats propres de l'Arme invoquée (combo Enchantement + Invocation).
 *  Lit la matrice MJ pour l'arme de base de l'élément, puis ajoute Puissance.
 */
function _calcInvokedArmStats(s) {
  const runes = s?.runes || [];
  const nbP = runes.filter(r => r === 'Puissance').length;
  const arm = getInvokedArm(_spellMatricesCache, s?.noyauTypeId);
  const baseDmg = arm?.degats || '1d8';
  let dmg = baseDmg;
  if (nbP > 0) {
    const m = baseDmg.match(/^(\d+)(d\d+)(.*)$/i);
    dmg = m ? `${parseInt(m[1]) + nbP}${m[2]}${m[3]}` : `${baseDmg} +${nbP}d6`;
  }
  return {
    weapon: arm?.weapon || 'Arme magique',
    dmg,
    statToucher: arm?.statToucher || 'force',
    statDegats:  arm?.statDegats || 'force',
    portee: arm?.portee || 1,
    note: arm?.note || '',
    hp: 10, ca: 10, // par défaut, peuvent être enrichis ensuite
    nbP,
  };
}

/**
 * Stats d'une invocation générique (rune Invocation seule, hors combos
 * Arme invoquée / Sentinelle). Dérivées des runes, surchargeables via
 * s.invocation.stats (un override non vide remplace la valeur calculée).
 *   - Attaque     : 1d4 +2 · +1 dé par Puissance
 *   - Toucher     : +2 · +2 par Chance
 *   - PV          : 10 · +5 par Protection
 *   - Déplacement : 3 · +3 par Amplification
 *   - Durée       : 2 tours · +2 par Durée (Concentration = maintien)
 *   - CA          : 10 par défaut
 */
export function _calcInvocationStats(s) {
  const ov    = s?.invocation?.stats || {};
  const runes = s?.runes || [];
  const n = name => runes.filter(r => r === name).length;
  const nbP = n('Puissance'), nbCh = n('Chance'), nbProt = n('Protection'),
        nbAmp = n('Amplification'), nbDur = n('Durée');
  const concentration = n('Concentration') > 0;

  const _has = v => v !== undefined && v !== null && v !== '';
  const nbDice  = 1 + nbP;
  const attaque = _has(ov.attaque) ? String(ov.attaque) : `${nbDice}d4 +2`;
  const toucher = _has(ov.toucher) ? parseInt(ov.toucher) : (2 + 2 * nbCh);
  const pv      = _has(ov.pv)      ? parseInt(ov.pv)      : (10 + 5 * nbProt);
  const deplacement = _has(ov.deplacement) ? parseInt(ov.deplacement) : (3 + 3 * nbAmp);
  const duree   = _has(ov.duree)   ? parseInt(ov.duree)   : (2 + 2 * nbDur);
  const ca      = _has(ov.ca)      ? parseInt(ov.ca)      : 10;
  return { attaque, toucher, pv, deplacement, duree, ca, concentration };
}

/**
 * Stats d'une invocation de la BIBLIOTHÈQUE au lancement = stats de BASE (invDef.stats)
 * + BONUS des runes du sort (modèle "base + bonus", validé) :
 *   - Puissance : +1 dé sur l'attaque de base
 *   - Protection : +5 PV · Chance : +2 toucher · Amplification : +3 déplacement
 *   - Durée : +2 tours · Concentration : maintien
 * CA reste la valeur de base (pas de bonus de rune).
 */
export function _calcSummonStats(invDef, runes = []) {
  const base = invDef?.stats || {};
  const n = nom => (runes || []).filter(r => r === nom).length;
  const nbP = n('Puissance'), nbCh = n('Chance'), nbProt = n('Protection'),
        nbAmp = n('Amplification'), nbDur = n('Durée');
  const concentration = n('Concentration') > 0;

  const baseAtk = String(base.attaque || '1d4 +2');
  let attaque = baseAtk;
  if (nbP > 0) {
    const m = baseAtk.match(/^(\d+)(d\d+)(.*)$/i);
    attaque = m ? `${parseInt(m[1]) + nbP}${m[2]}${m[3]}` : `${baseAtk} +${nbP}d6`;
  }
  return {
    attaque,
    toucher:     (parseInt(base.toucher) || 0) + 2 * nbCh,
    pv:          (parseInt(base.pv) || 10) + 5 * nbProt,
    ca:          parseInt(base.ca) || 10,
    deplacement: (parseInt(base.deplacement) || 0) + 3 * nbAmp,
    pmMax:       parseInt(base.pmMax) || 0,
    duree:       2 + 2 * nbDur,
    concentration,
  };
}

/**
 * Génère le résumé textuel complet des effets d'un sort
 * sous forme de tableau de lignes {icon, label, detail}
 */
export function _buildSortResume(s, c) {
  const lines = [];
  const runes  = s.runes || [];
  const types  = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);
  // Combos détectés (centralisés dans SORT_COMBOS) — résolus tôt car le sort
  // suspendu change l'affichage de la ligne d'action (concentration masquée).
  const activeCombos = _activeCombos(s);
  const comboIds = new Set(activeCombos.map(c => c.id));
  const isSuspended = comboIds.has('sort_suspendu');

  // Action + Nature (instantané/persistant) + Portée (de l'arme principale, fallback Poings)
  const actionLabels = { action:'⚡ Action', action_bonus:'✴️ Action Bonus', reaction:'🔄 Réaction' };
  let actionStr = actionLabels[action] || '⚡ Action';
  // Sort suspendu : la Concentration n'est qu'un déclencheur de combo, pas une
  // vraie concentration → on n'affiche ni le tag 🧠 ni le JS de concentration.
  if (concentration && !isSuspended) actionStr += ' + 🧠 Concentration';
  // Nature : instantané sauf si une durée explicite est définie ou si Enchant/Affliction/Protection CA actifs
  const isPersistent = !isSuspended && (runes.includes('Durée') || runes.includes('Enchantement') || runes.includes('Affliction')
                    || (runes.includes('Protection') && (s.protectionMode || 'ca') === 'ca' && !_isReactionSpell(s))
                    || !!(s.dureeBase && s.dureeBase >= 2));
  const natureStr = isPersistent ? '⏳ Persistant' : '⏱️ Instantané';
  const concDD = isSuspended ? 0 : _calcConcentrationDD(s);
  lines.push({ icon: '', label: `${actionStr} · ${natureStr}`, detail: concDD ? `JS Sagesse DD ${concDD} si dégâts reçus · jusqu'à 10 tours` : '' });

  // Portée du sort = portée de l'arme principale équipée (ou Poings = 1 case)
  const mainWp = getMainWeapon(c);
  const wpPortee = parseInt(mainWp.portee) || 1;
  lines.push({ icon:'📏', label:`Portée ${wpPortee} cases`, detail: mainWp.isDefault ? 'Poings (mains nues)' : `Arme : ${mainWp.nom}` });

  // Combos détectés (centralisés dans SORT_COMBOS, MJ peut activer/désactiver)
  const nbPuiss   = runes.filter(r => r === 'Puissance').length;
  const nbProt    = runes.filter(r => r === 'Protection').length;
  const nbAmp     = runes.filter(r => r === 'Amplification').length;
  const specializedComboIds = new Set(['zone_elargie', 'regeneration', 'arme_invoquee', 'sentinelle', 'coup_chance']);
  lines.push(..._comboResumeLines(activeCombos, comboIds, _runeCounts(s), s));
  activeCombos.forEach(combo => {
    if (specializedComboIds.has(combo.id)) return;
    lines.push({ icon: combo.icon, label: `Combo ${combo.name}`, detail: combo.detail, isCombo: true });
  });

  // Cibles & zone — calcul commun pour décorer les lignes mono-cible
  const nbCibles   = _calcSortCibles(s);
  const zoneCalc   = _calcSortZone(s);
  const isZone     = !!zoneCalc;
  const isMonoCib  = !isZone && nbCibles === 1;
  const monoStr    = isMonoCib ? ' · sur 1 cible' : '';

  // Dégâts (si offensif) — masque la ligne pour les sorts Soutien/Contrôle/Méta
  // qui ne font pas de dégâts d'impact (Enchantement et Affliction sont auto-suppressés).
  // Sinon, sans formule explicite, on affichait le "1d6" de l'arme par défaut, ce qui
  // donnait une impression trompeuse de dégâts directs.
  const isEnchantOnly  = runes.includes('Enchantement') && !((s.degats || '').trim());
  // Enchantement Toucher / Déplacement : buff pur, jamais de dégâts d'impact (même
  // avec un degats résiduel d'un ancien mode Dégâts).
  const isEnchantBuffOnly = runes.includes('Enchantement')
    && (s.enchantMode === 'toucher' || s.enchantMode === 'deplacement');
  // Affliction = jamais d'impact… SAUF en branche Lacération (qui frappe toujours).
  const isAfflictionSpell = runes.includes('Affliction') && s.afflictionMode !== 'laceration';
  // Invocation : le sort n'inflige pas de dégâts lui-même — c'est la créature
  // invoquée qui frappe (ses dégâts propres via _calcInvocationStats). On masque
  // donc l'attaque de base du lanceur, même si Puissance a coché « offensif »
  // (Puissance scale l'attaque de l'invocation, pas un impact direct).
  const isInvocationSpell = runes.includes('Invocation');
  const _suppressImpactDmg = comboIds.has('coup_chance') || isEnchantOnly || isEnchantBuffOnly || isAfflictionSpell || isInvocationSpell;
  // Lacération inflige TOUJOURS l'attaque de base (+ sa réduction de CA), même si
  // le type n'a pas été coché « offensif » → on affiche les dégâts dans ce cas aussi.
  const _dealsImpact = types.includes('offensif') || _hasLaceration(s);
  if (_dealsImpact && !_suppressImpactDmg) {
    const dmg = _calcImpactDisplayParts(s, c);
    const detailParts = ['Dégâts'];
    if (dmg.statMod) detailParts.push(`${dmg.statLbl} ${_fmtSigned(dmg.statMod)}`);
    if (dmg.maitrise) detailParts.push(`Maîtrise ${_fmtSigned(dmg.maitrise)}`);
    lines.push({ icon:'⚔️', label:dmg.label, detail: `${detailParts.join(' · ')}${monoStr}` });
  }

  // (Affliction / Enchantement : rendu dans le bloc unifié plus bas,
  //  qui respecte les modes et ne fait pas de fallback DoT incorrect.)

  // Protection : Drain (si sort offensif) → sinon Soin ou CA selon protectionMode
  const hasDefensif = types.includes('defensif');
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    // Combo Drain (sort offensif + Protection) : pas de CA ni de soin direct — le
    // lanceur récupère un % des dégâts infligés, fixé par le nombre de Protection.
    if (comboIds.has('regeneration')) {
      // Déjà résumé par la ligne de combo spécialisée.
    } else if (comboIds.has('drain')) {
      const pct = Math.round(_calcDrainPct(s) * 100);
      lines.push({ icon:'🩸', label:`Drain ${pct}% des dégâts`, detail:`Soigne le lanceur · cap frappe de base hors Puissance · ${nbProt} Protection` });
    } else if (mode === 'soin') {
      {
        const soin = _calcHealDisplayParts(s, c);
        const detailParts = [`Soin`, `+${nbProt}d4 Prot`];
        if (soin.statMod) detailParts.push(`${soin.statLbl} ${_fmtSigned(soin.statMod)}`);
        if (soin.maitrise) detailParts.push(`Maîtrise ${_fmtSigned(soin.maitrise)}`);
        lines.push({ icon:'💚', label:soin.label, detail:`${detailParts.join(' · ')}${monoStr}` });
      }
    } else {
      // Mode CA — sauf si combo Bouclier réactif : la réaction instantanée ne donne pas de CA
      if (comboIds.has('bouclier_reactif')) {
        const tier = nbProt >= 3 ? 'Boss ou inférieur' : nbProt === 2 ? 'Élite ou inférieur' : 'Mob classique';
        lines.push({
          icon:'🛡️',
          label: `Bloque 1 attaque entrante`,
          detail: `Protection ×${nbProt} · plafond cible : ${tier} · pas de bonus CA, l'attaque est annulée en réaction`,
        });
      } else {
        const caLbl = _getSortCA(s);
        lines.push({ icon:'🛡️', label: caLbl, detail: `Bonus de CA (2 tours)${monoStr}` });
      }
    }
  } else if (hasDefensif && nbAmp > 0 && s.ampMode !== 'deplacement') {
    const soin = _calcHealDisplayParts(s, c);
    const detailParts = ['Soin de soutien', 'base 1d4'];
    if (soin.statMod) detailParts.push(`${soin.statLbl} ${_fmtSigned(soin.statMod)}`);
    if (soin.maitrise) detailParts.push(`Maîtrise ${_fmtSigned(soin.maitrise)}`);
    lines.push({ icon:'💚', label:soin.label, detail:`${detailParts.join(' · ')}${monoStr}` });
  } else if (hasDefensif) {
    lines.push({ icon:'🛡️', label:'Effet défensif', detail:'Décris l\'effet ci-dessous' });
  }

  // Cibles (uniquement si Dispersion solo, sans combo Amp+Disp)
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  if (nbCibles > 1 && !(nbAmp > 0 && nbDisp > 0) && !comboIds.has('zone_elargie')) {
    const dispDetail = nbDisp === 1
      ? '1 rune Dispersion · cibles différentes uniquement'
      : `${nbDisp} runes Dispersion · cibles différentes`;
    lines.push({ icon:'🎯', label:`${nbCibles} cibles différentes`, detail: dispDetail });
  }

  // Zone (Amplification ou manuelle) — sauf combo zone élargie
  if (zoneCalc && !comboIds.has('zone_elargie')) {
    let zoneDetail = '';
    if (zoneCalc.source === 'runes') {
      if (zoneCalc.amp > 0 && zoneCalc.disp > 0) {
        zoneDetail = `Combo Amp ×${zoneCalc.amp} + Disp ×${zoneCalc.disp} · zone plaçable`;
      } else {
        zoneDetail = `Amplification ×${zoneCalc.amp} · ${zoneCalc.w} cases`;
      }
    } else {
      zoneDetail = 'Zone manuelle (override MJ)';
    }
    // Sort de terrain : Amplification seule (sans Puissance ni Protection) → 2 tours par défaut
    const isTerrain = zoneCalc.source === 'runes' && nbPuiss === 0 && nbProt === 0;
    if (isTerrain) zoneDetail += ' · 2 tours par défaut (sort de terrain)';
    lines.push({ icon:'📐', label:`Zone ${zoneCalc.w}×${zoneCalc.h} cases`, detail: zoneDetail });
  }

  // Déplacement (soi / pousse / attire) — portée 1 à max (legacy : distance fixe)
  const depl = _calcSortDeplacement(s);
  if (depl) {
    const range = depl.max != null ? `1 à ${depl.max} cases` : `${depl.distance} cases`;
    const D = {
      self: { icon:'🏃', label:`Déplacement — soi-même · ${range}` },
      push: { icon:'↗',  label:`Déplacement — pousse la cible · ${range}` },
      pull: { icon:'↙',  label:`Déplacement — attire la cible · ${range}` },
    }[depl.mode] || { icon:'↔', label:`Déplacement · ${range}` };
    lines.push({ icon: D.icon, label: D.label, detail: 'Aucun dégât (sort de déplacement)' });
  }

  // Durée (base + rune Durée) — combo Sort canalisé persistant : tant que la concentration tient
  // Affichée uniquement pour les sorts persistants (Enchant, Affliction, Protection CA, rune Durée)
  if (_needsDureeBase(s)) {
    const duree = _calcSortDuree(s);
    const nbDur = runes.filter(r => r === 'Durée').length;
    const hasOverride = s.dureeBase && s.dureeBase >= 2;
    const baseVal = hasOverride ? s.dureeBase : 2;
    const runeBonus = duree - baseVal;
    if (comboIds.has('canalise_persistant')) {
      lines.push({
        icon:'⏱️',
        label: 'Tant que concentration · 2 tours après rupture',
        detail: "Sort canalisé persistant · si la concentration est perdue, l'effet reste actif 2 tours puis expire",
      });
    } else {
      const baseLbl = hasOverride ? `${baseVal} base (override)` : '2 base';
      const detail = [
        baseLbl,
        nbDur > 0 ? `+${runeBonus} (Durée ×${nbDur})` : '',
      ].filter(Boolean).join(' · ');
      lines.push({ icon:'⏱️', label:`${duree} tour${duree > 1 ? 's' : ''}`, detail });
    }
  }

  // Lacération (branche d'Affliction) — réduction de CA + frappe de base.
  // Absorbée par la Sentinelle (Affliction + Invocation) → portée par la sentinelle.
  const lac = _calcLaceration(s);
  if (lac && !comboIds.has('sentinelle')) {
    lines.push({ icon:'🩸', label:`Affliction · Lacération · CA cible −${lac.reduction}${monoStr}`, detail:`Brut · plafond −${lac.max} (−${lac.maxElite} Élites/Boss) · ${lac.runes} Affliction · frappe l'attaque de base` });
  }

  // Chance
  const chc = comboIds.has('coup_chance') ? null : _calcChance(s);
  if (chc) {
    lines.push({ icon:'🍀', label:`RC ${chc.rc}–20`, detail:`Critique aussi max${chc.capped ? ' · plafond atteint' : ''}` });
  }

  // ── Enchantement (mode Dégâts ou État) ──────────────────────────────
  // Plus de slots — uniquement le mode et l'effet associé.
  // Combos absorbants (Arme invoquée) → ligne classique cachée.
  const nbEnch = runes.filter(r => r === 'Enchantement').length;
  const nbAff  = runes.filter(r => r === 'Affliction').length;
  const hideEnch = comboIds.has('arme_invoquee');
  const hideAff  = comboIds.has('sentinelle') || comboIds.has('regeneration');
  if (nbEnch > 0 && !hideEnch) {
    const mode    = s.enchantMode || 'dmg';
    // Cibles pilotées par Dispersion (pas par le nombre de runes Enchantement).
    const nbCib   = _calcSortCibles(s);
    const cibleStr = nbCib === 1 ? 'sur 1 allié' : `sur ${nbCib} alliés`;
    const detailParts = ['2 tours', cibleStr];
    // Mode décisif : si État → état affiché (jamais dégâts) ; si Dégâts → dégâts (jamais état)
    if (mode === 'etat') {
      const lib = _conditionsLibCache || [];
      const ids = (Array.isArray(s.enchantEtatIds) && s.enchantEtatIds.length)
        ? s.enchantEtatIds : (s.enchantEtatId ? [s.enchantEtatId] : []);
      const etats = ids.map(id => lib.find(c2 => c2.id === id)).filter(Boolean);
      const etat = etats[0] || null;   // le 1er porte les réglages fins (dégâts/déplacement)
      const lbl = etats.length
        ? etats.map(e => `${e.icon || ''} ${e.label}`).join(' + ')
        : '⚠ Aucun état choisi';
      const nbP = runes.filter(r => r === 'Puissance').length;
      const nbAmp = runes.filter(r => r === 'Amplification').length;
      const eff = etat?.effects || {};
      if (eff.dmgDealtBonus) {
        const auto = `${1 + nbP}d4 +2`;
        const formula = (s.enchantStateDmgFormula || '').trim() || auto;
        detailParts.push(`bonus dégâts ${formula}${formula !== auto ? ' · naturel' : ''}`);
      }
      if (eff.movementBonus != null) {
        const base = Number.isFinite(parseInt(eff.movementBonus)) ? parseInt(eff.movementBonus) : 0;
        const auto = base + nbAmp;
        const manual = Number.isFinite(parseInt(s.enchantStateMoveBonus)) ? parseInt(s.enchantStateMoveBonus) : null;
        const bonus = manual != null ? manual : auto;
        detailParts.push(`+${bonus} case${bonus > 1 ? 's' : ''} de déplacement${manual != null && manual !== auto ? ' · naturel' : ''}`);
      }
      if (eff.rangeBonus != null) {
        const base = Number.isFinite(parseInt(eff.rangeBonus)) ? parseInt(eff.rangeBonus) : 0;
        const bonus = base + nbAmp;
        detailParts.push(`+${bonus} case${bonus > 1 ? 's' : ''} de portée d'attaque`);
      }
      if (eff.attackBy === 'adv') detailParts.push('avantage aux attaques');
      if (eff.attackAgainstRanged === 'dis') detailParts.push('désavantage aux attaques à distance contre la cible');
      if (eff.attackAgainstMelee === 'dis') detailParts.push('désavantage aux attaques de mêlée contre la cible');
      if (eff.concentrationCheck) detailParts.push(`JS ${etat?.defaultSaveStat || 'sagesse'} DD ${etat?.defaultDC || 11} si dégâts`);
      lines.push({ icon:'✨', label:`Enchantement · État sur allié : ${lbl}`,
                   detail: detailParts.join(' · ') });
    } else if (mode === 'toucher' || mode === 'deplacement') {
      const nbP   = runes.filter(r => r === 'Puissance').length;
      const bonus = Number.isFinite(parseInt(s.enchantBonus)) ? parseInt(s.enchantBonus) : (2 + nbP);
      const what  = mode === 'toucher'     ? { ic:'🎯', txt:`+${bonus} au toucher` }
                  :                          { ic:'👢', txt:`+${bonus} case${bonus>1?'s':''} de déplacement` };
      const note  = (s.enchantBonus == null || s.enchantBonus === '') ? ' · auto (2 + Puissance)' : '';
      lines.push({ icon: what.ic, label:`Enchantement · ${what.txt} sur allié`,
                   detail: detailParts.join(' · ') + note });
    } else {
      const degAuto = _calcEnchantDegats(s);
      const note = s.enchantDegats?.trim() ? '' : ' · auto (1+Puiss)d4+2';
      lines.push({ icon:'✨', label:`Enchantement · Bonus arme alliée +${degAuto}`,
                   detail: detailParts.join(' · ') + note });
    }
  }

  // ── Affliction (mode DoT ou État) ── (la branche Lacération est rendue plus haut)
  if (nbAff > 0 && !hideAff && s.afflictionMode !== 'laceration') {
    const mode = s.afflictionMode || 'dot';
    // Stat de JS dérivée (comme dans le VTT)
    let saveStat = 'constitution';
    const lib = _conditionsLibCache || [];
    const etat = mode === 'etat' && s.afflictionEtatId
      ? lib.find(c2 => c2.id === s.afflictionEtatId)
      : null;
    if (mode === 'etat' && s.afflictionEtatId) {
      if (etat?.defaultSaveStat) saveStat = etat.defaultSaveStat;
    }
    if (s.afflictionSaveStat && !(mode === 'etat' && etat?.defaultSaveStat)) saveStat = s.afflictionSaveStat;
    const dd = mode === 'etat'
      ? (Number.isFinite(parseInt(etat?.defaultDC)) ? parseInt(etat.defaultDC) : 11)
      : 11 + 2 * (nbAff - 1);
    const statLbl = statShort(saveStat) || saveStat;
    // Cibles pilotées par Dispersion (le nb de runes Affliction scale le DD, pas les cibles).
    const nbCib   = _calcSortCibles(s);
    const cibleStr = nbCib === 1 ? 'sur 1 ennemi' : `sur ${nbCib} ennemis`;

    if (mode === 'etat') {
      // Mode État : on affiche l'état appliqué, PAS la formule DoT
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ Aucun état choisi';
      lines.push({ icon:'⛓', label:`Affliction · État : ${lbl}`,
                   detail: `${cibleStr} · JS ${statLbl} DD ${dd} pour résister` });
    } else {
      // Mode DoT : on affiche la formule de dégâts par tour
      const formula = _calcAfflictionDot(s);
      lines.push({ icon:'🩸', label:`Affliction · DoT ${formula} / tour`,
                   detail: `${cibleStr} · JS ${statLbl} DD ${dd} de la cible` });
    }
  }

  // Invocation — masquée si absorbée par un combo (Arme invoquée, Sentinelle)
  const hideInvoc = comboIds.has('arme_invoquee') || comboIds.has('sentinelle');
  if (runes.includes('Invocation') && !hideInvoc) {
    const iv = _calcInvocationStats(s);
    const nbAct = Array.isArray(s?.invocation?.actions) ? s.invocation.actions.length : 0;
    const dureeStr = iv.concentration ? 'maintenue (Concentration)' : `${iv.duree} tour${iv.duree>1?'s':''}`;
    lines.push({
      icon:'🐾',
      label:`Invocation · ${iv.pv} PV · CA ${iv.ca}`,
      detail:`Attaque ${iv.attaque} (toucher +${iv.toucher}) · déplacement ${iv.deplacement} · ${dureeStr}${nbAct?` · ${nbAct} action${nbAct>1?'s':''}`:''}`,
    });
  }

  // Détails Sentinelle — affichés à la place de la ligne classique Invocation/Affliction
  if (comboIds.has('sentinelle')) {
    const st = _calcSentinelStats(s);
    const nbSent = runes.filter(r => r === 'Invocation').length || 1;   // nombre piloté par la rune Invocation
    const countStr = nbSent > 1 ? ` · ×${nbSent} sentinelles` : '';
    lines.push({ icon:'🪤', label:`Sentinelle · ${st.hp} PV · CA ${st.ca}${countStr}`, detail:`Attaque ${st.dmg} · portée ${st.portee} cases · stationnaire · 2 tours par défaut` });
  }

  // Concentration (rappel JS si pas déjà mentionné)
  if (concentration && action !== 'action') {
    const dd = _calcConcentrationDD(s) ?? 11;
    lines.push({ icon:'🧠', label:'Concentration', detail:`JS Sagesse DD ${dd} si dégâts reçus · jusqu'à 10 tours` });
  }

  // Limite MJ (texte libre)
  if (s.mjNotes && s.mjNotes.trim()) {
    lines.push({ icon:'🔒', label:'Limite MJ', detail: s.mjNotes.trim() });
  }

  return lines;
}

export function _getCurrentSpellChar() {
  return STATE.activeChar || charSession.getCurrentChar() || null;
}

// ── Présentateur partagé : UNE seule vérité d'affichage pour un sort ─────────
// Tolérant au legacy (icone/cout/description → icon/pm/effet). `pm` = coût
// effectif : override MJ > pm calculé > cout legacy, + delta Set Léger équipé.
// Consommé par la fiche, la quick-view, l'impression (le VTT a la même règle).
export function spellVM(s, pmDelta = 0) {
  const base = Number.isFinite(parseInt(s?.pmOverride)) ? parseInt(s.pmOverride)
    : Number.isFinite(parseInt(s?.pm)) ? parseInt(s.pm)
      : Number.isFinite(parseInt(s?.cout)) ? parseInt(s.cout)
        : null;
  return {
    icon:  s?.icon || s?.icone || '✨',
    nom:   s?.nom || 'Sort sans nom',
    pm:    base == null ? null : Math.max(0, base + (parseInt(pmDelta) || 0)),
    pmBase: base,
    effet: s?.effet || s?.description || '',
  };
}

// Identifiant STABLE d'un sort (les index bougent au tri/drag ; le VTT peut
// mémoriser un sort — sort suspendu — au-delà d'un réordonnancement).
export function spellUid() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Backfill opportuniste : pose un id stable sur les sorts qui n'en ont pas,
// à chaque écriture du tableau complet. Retourne true si au moins un ajout.
export function ensureSpellIds(sorts) {
  let changed = false;
  (sorts || []).forEach(s => {
    if (s && typeof s === 'object' && !s.id) { s.id = spellUid(); changed = true; }
  });
  return changed;
}
