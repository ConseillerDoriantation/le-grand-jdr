// ==============================================================================
// VTT — Données effectives (fusion token ↔ entité liée)
// ------------------------------------------------------------------------------
// _live(token) fusionne un token avec sa fiche source (perso / PNJ / créature)
// pour produire les valeurs affichées (HP/PM/CA/nom/image/portée…), en lisant
// TOUJOURS la donnée fraîche. Calcul pur (lecture seule de VS). Extrait de vtt.js
// (cf. docs/vtt-decomposition.md). Quelques imports circulaires runtime vers vtt.js
// (_numOr, _activeConditionsOf, _npcStatMod, _npcCombat).
// ==============================================================================
import { VS } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { _norm } from '../../shared/html.js';
import { getMod, calcPVMax, calcPMMax, calcCA, calcVitesse } from '../../shared/char-stats.js';
import { getMainWeapon, getArmorSetData } from '../../shared/equipment-utils.js';
import { getEquipmentSlots, getPrimaryWeaponSlotId } from '../../shared/equipment-slots.js';
import { _numOr, _activeConditionsOf, _npcStatMod, _npcCombat } from './vtt.js'; // circ. (runtime)

/** Somme des bonus de toucher actifs (enchantement mode Toucher) sur un token.
 *  Lu FRAIS au moment du jet / de l'affichage HUD (jamais figé dans l'option). */
export function _touchBuffOf(tok) {
  const round = VS.session?.combat?.round ?? 0;
  return (tok?.buffs || [])
    .filter(b => b.type === 'toucher_bonus' && (b.expiresAtRound == null || round === 0 || round <= b.expiresAtRound))
    .reduce((s, b) => s + (parseInt(b.bonus) || 0), 0);
}

export function _conditionMoveBonusOf(tok) {
  return _activeConditionsOf(tok)
    .reduce((sum, { cond, lib }) => {
      const raw = cond.movementBonus ?? lib.effects?.movementBonus;
      const bonus = Number.isFinite(parseInt(raw)) ? parseInt(raw) : 0;
      return sum + bonus;
    }, 0);
}

// Bonus de portée d'attaque apporté par les états actifs (état « Allonge »).
export function _conditionRangeBonusOf(tok) {
  return _activeConditionsOf(tok)
    .reduce((sum, { cond, lib }) => {
      const raw = cond.rangeBonus ?? lib.effects?.rangeBonus;
      const bonus = Number.isFinite(parseInt(raw)) ? parseInt(raw) : 0;
      return sum + bonus;
    }, 0);
}

// Réduction du seuil critique apportée par les états actifs (état « Chanceux »).
// Ex. 1 → l'attaquant critique sur 19-20 au lieu de 20.
export function _conditionCritRangeBonusOf(tok) {
  return _activeConditionsOf(tok)
    .reduce((sum, { cond, lib }) => {
      const raw = cond.critRangeBonus ?? lib.effects?.critRangeBonus;
      const bonus = Number.isFinite(parseInt(raw)) ? parseInt(raw) : 0;
      return sum + bonus;
    }, 0);
}

export function _conditionDmgBonusOf(tok) {
  const active = _activeConditionsOf(tok)
    .map(({ cond, lib }) => ({
      cond,
      lib,
      formula: (cond.dmgDealtBonusFormula || lib.effects?.dmgDealtBonus || '').trim(),
    }))
    .filter(x => !!x.formula);
  return active[0] || null;
}

export function _scaledEnchantConditionFields(lib, power = 0, amplification = 0, overrides = {}, chance = 0) {
  const eff = lib?.effects || {};
  const fields = { enchantPower: Math.max(0, parseInt(power) || 0) };
  const amp = Math.max(0, parseInt(amplification) || 0);
  // Chanceux : RC de la cible abaissée de 1 par rune Chance du sort (plancher RC 17
  // → réduction max 3). Sans rune Chance = aucun effet.
  if (eff.critRangeBonus != null) {
    fields.critRangeBonus = Math.min(3, Math.max(0, parseInt(chance) || 0));
  }

  if (eff.movementBonus != null) {
    const base = Number.isFinite(parseInt(eff.movementBonus)) ? parseInt(eff.movementBonus) : 0;
    fields.movementBonus = Number.isFinite(parseInt(overrides.movementBonus))
      ? parseInt(overrides.movementBonus)
      : base + amp;
  }
  // Allonge (portée) : +base, +1 par rune Amplification (symétrique du déplacement).
  if (eff.rangeBonus != null) {
    const base = Number.isFinite(parseInt(eff.rangeBonus)) ? parseInt(eff.rangeBonus) : 0;
    fields.rangeBonus = base + amp;
  }
  if (eff.dmgDealtBonus) {
    fields.dmgDealtBonusFormula = (overrides.dmgFormula || '').trim() || `${1 + fields.enchantPower}d4 +2`;
  }
  return fields;
}

export function _rangeVal(value, fallback = 1) {
  const n = parseInt(value);
  return Number.isFinite(n) ? n : fallback;
}

export function _vttEquippedWeapons(c) {
  const equip = c?.equipement || {};
  const entries = getEquipmentSlots().filter(slot => slot.kind === 'weapon').map(slot => slot.id)
    .map(slot => ({ slot, item: equip[slot] || null }))
    .filter(entry => entry.item?.nom);
  return entries.length ? entries : [{ slot: getPrimaryWeaponSlotId(), item: getMainWeapon(c) }];
}

export function _vttBestWeaponRange(c) {
  return Math.max(1, ..._vttEquippedWeapons(c).map(entry => _rangeVal(entry.item?.portee, 1)));
}

export function _vttPrimaryWeapon(c) {
  return _vttEquippedWeapons(c)
    .sort((a, b) => _rangeVal(b.item?.portee, 1) - _rangeVal(a.item?.portee, 1))[0]?.item
    || getMainWeapon(c);
}

export function _characterForToken(t) {
  if (!t) return null;
  if (t.characterId && VS.characters[t.characterId]) return VS.characters[t.characterId];
  if (!t.ownerId) return null;
  const owned = Object.values(VS.characters || {}).filter(c => c?.uid === t.ownerId);
  const tokenName = _norm(t.name || '');
  const byName = tokenName ? owned.find(c => _norm(c?.nom || '') === tokenName) : null;
  if (byName) return byName;
  return owned.length === 1 ? owned[0] : null;
}

export function _live(t) {
  if (!t) return null;
  const c = _characterForToken(t);
  const n = t.npcId       ? VS.npcs[t.npcId]             : null;
  const b = t.beastId     ? VS.bestiary[t.beastId]       : null;
  const e = c || n || b;

  if (!e) {
    // Token SANS fiche liée (invocation, ennemi custom) : on applique quand même
    // les BUFFS posés sur le token (CA, portée, déplacement) + les états, sinon un
    // état « +CA / Renforcé » sur une invocation n'aurait aucun effet. Le bonus de
    // toucher/dégâts (enchantement) s'applique frais au jet (_touchBuffOf / états).
    const _r = VS.session?.combat?.round ?? 0;
    const _act = (bf, ty) => bf?.type === ty && (bf.expiresAtRound == null || _r === 0 || _r <= bf.expiresAtRound);
    const _sum = (ty) => (t.buffs || []).filter(bf => _act(bf, ty)).reduce((s, bf) => s + (bf.bonus || 0), 0);
    const _ca  = (t.defense ?? 0) + _sum('ca');
    const _mv  = (t.buffs || []).filter(bf => _act(bf, 'move_bonus') || _act(bf, 'move_debuff')).reduce((s, bf) => s + (bf.bonus || 0), 0);
    return {
      ...t,
      displayName:     t.name,
      displayImage:    t.imageUrl ?? null,
      displayHp:       t.hp    ?? 20,
      displayHpMax:    t.hpMax ?? 20,
      displayMovement: Math.max(0, (t.movement ?? 6) + _mv + _conditionMoveBonusOf(t)),
      displayAttack:   t.attack   ?? 5,
      displayAttackDice: t.attackDice || '1d6',
      displayDefense:  _ca,
      realDefense:     _ca,
      _activeCaBuff:   (t.buffs || []).find(bf => _act(bf, 'ca')) ?? null,
      // Ennemi custom (posé sur la carte, sans fiche) : pas d'estimation possible
      // → "?" pour les joueurs, jamais la CA réelle saisie par le MJ.
      caBadge:         (!STATE.isAdmin && t.type === 'enemy') ? '?' : String(_ca),
      displayRange:    (t.range ?? 1) + _sum('range_bonus') + _conditionRangeBonusOf(t),
      displayTokenW:   Math.max(1, Math.min(5, t.tokenW ?? t.tokenSize ?? 1)),
      displayTokenH:   Math.max(1, Math.min(5, t.tokenH ?? t.tokenSize ?? 1)),
    };
  }

  const npcHpMax = n ? _numOr(e.pv, _numOr(e.hpMax, _numOr(e.pvMax, 20))) : null;
  const npcPmMax = n ? _numOr(e.pmMax, _numOr(e.pm, null)) : null;
  const npcPmCur = n ? _numOr(e.pmCurrent, npcPmMax) : null;
  const npcCombat = n ? _npcCombat(e) : {};
  const npcWeapon = npcCombat.weapon || {};

  const hpMax = c ? (calcPVMax(c) || c.pvBase || 20)
              : b ? (_numOr(b.pvMax, 20))
              : n ? npcHpMax
              : (_numOr(e.hpMax, _numOr(e.pvMax, _numOr(e.pv, 20))));

  // Pour les créatures du bestiaire : HP suivi sur le TOKEN (pas sur la fiche template)
  const hpCurrent = c ? (c.hp ?? hpMax)
                  : n ? (_numOr(n.hp, hpMax))
                  : (t.hp ?? hpMax); // bestiaire + tokens custom

  // Formule de dégâts : arme équipée (incl. Poings 2d4 par défaut) > bestiary > override token
  const weapon      = c ? getMainWeapon(c) : null;
  const weapStats   = weapon?.degatsStats?.length ? weapon.degatsStats : [weapon?.degatsStat || 'force'];
  const toucherStat = (weapon?.toucherStats?.[0] || weapon?.toucherStat || weapStats[0]);
  const weapMod     = c ? weapStats.reduce((sum, s) => sum + getMod(c, s), 0) : 0;
  const toucherMod  = c ? getMod(c, toucherStat) : 0;
  const setBonus    = c ? (getArmorSetData(c).modifiers.toucherBonus || 0) : 0;
  const weapDice  = weapon?.degats
    ? (weapMod !== 0 ? `${weapon.degats}${weapMod>0?'+':''}${weapMod}` : weapon.degats)
    : null;
  const beastDice = b?.attaques?.[0]?.degats || null;
  const npcDice   = npcWeapon.degats || npcCombat.damage || e.attackDice || null;
  const atkDice   = t.attackDice || weapDice || beastDice || npcDice
    || (c ? `1d6${weapMod>=0?'+':''}${weapMod}` : null)
    || (typeof t.attack==='string' ? t.attack : null)
    || '1d6';

  // Valeurs dérivées calculées une seule fois pour éviter les recalculs dans result
  const _round   = VS.session?.combat?.round ?? 0;
  const _pmMax   = c ? calcPMMax(c) : n ? npcPmMax : (b ? _numOr(b.pmMax, 0) : null);
  const _caBase  = t.defense ?? (c ? calcCA(c) : (b ? (_numOr(b.ca, 10)) : (_numOr(e.ca, _numOr(e.defense, 0)))));
  const _caBuffs = (t.buffs || []).filter(bf => bf.type === 'ca' && (bf.expiresAtRound == null || _round === 0 || _round <= bf.expiresAtRound));
  const _ca      = _caBase + _caBuffs.reduce((sum, bf) => sum + (bf.bonus || 0), 0);
  // Attaque de base (stat). Le bonus toucher d'enchantement N'est PAS inclus ici :
  // il est appliqué frais au moment du jet (_vttRollAttack) pour ne pas dépendre
  // d'une option figée à l'ouverture du panneau (le buff peut être posé après).
  const _baseAtk = t.attack   ?? (c ? toucherMod+setBonus : (b ? (_numOr(b.attaques?.[0]?.toucher, 5)) : (_numOr(e.bonusAttaque, _numOr(e.attack, _numOr(npcWeapon.toucher, (npcWeapon.toucherStat || npcWeapon.statAttaque) ? _npcStatMod(e, npcWeapon.toucherStat || npcWeapon.statAttaque) : e.stats?.force != null ? _npcStatMod(e, 'force') : 5))))));

  const result = {
    ...t,
    // Ennemis : le nom du token (instance) prime sur le nom générique du bestiaire
    // Joueurs/PNJ : le nom de la fiche prime (toujours à jour)
    displayName:       b ? (t.name || b.nom) : (e.nom || t.name),
    displayImage:      e.photoURL || e.photo || e.avatar || e.imageUrl || t.imageUrl || null,
    displayHp:         hpCurrent,
    displayHpMax:      hpMax,
    displayPm:         c ? (c.pm ?? _pmMax) : n ? npcPmCur : (b && _pmMax > 0 ? (t.pm ?? _pmMax) : null),
    displayPmMax:      _pmMax,
    // Créature avec mana (perso, PNJ ou bestiaire pmMax>0) → jauge PM affichée.
    hasMana:           !!(c || (n && npcPmMax > 0) || (b && _pmMax > 0)),
    displayMovement: (() => {
      const baseMv = t.movement ?? (c ? calcVitesse(c) : (b ? (_numOr(b.vitesse, 4)) : (_numOr(e.vitesse, _numOr(e.deplacement, 6)))));
      const moveDelta = (t.buffs || [])
        .filter(bf => (bf.type === 'move_bonus' || bf.type === 'move_debuff')
          && (bf.expiresAtRound == null || _round === 0 || _round <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
      return Math.max(0, baseMv + moveDelta + _conditionMoveBonusOf(t));
    })(),
    displayAttack: _baseAtk,
    displayAttackDice: atkDice,
    displayDefense:    _ca,
    // VRAIE CA, JAMAIS écrasée par l'estimation joueur. Sert au calcul authoritatif
    // du hit/miss côté serveur. À ne PAS afficher aux joueurs (utiliser displayDefense
    // ou _viewCA pour le rendu UI).
    realDefense:       _ca,
    _activeCaBuff:     _caBuffs[0] ?? null,
    // Pour un perso : arme équipée > override admin (t.range > 1) > défaut 1
    // Pour bestiaire/custom : t.range > 1ère attaque bestiary > défaut 1
    // Bonus de portée temporaire (buff range_bonus = Allonge magique etc.)
    displayRange: (() => {
      const baseRange = c
        ? (t.range > 1 ? t.range : _vttBestWeaponRange(c))
        : b
          ? (t.range > 1 ? t.range : (_numOr(b.attaques?.[0]?.portee, 1)))
          : n
            ? (t.range > 1 ? t.range : (_numOr(npcCombat.range, _numOr(npcWeapon.portee, 1))))
            : (t.range ?? 1);
      const r = VS.session?.combat?.round ?? 0;
      const rangeBonus = (t.buffs || [])
        .filter(bf => bf.type === 'range_bonus' && (bf.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
      return baseRange + rangeBonus + _conditionRangeBonusOf(t);   // + état « Allonge »
    })(),
    _beast:            b,   // référence directe pour _buildAttackOptions
    displayTokenW:     Math.max(1, Math.min(5, t.tokenW ?? t.tokenSize ?? b?.tokenW ?? b?.tokenSize ?? 1)),
    displayTokenH:     Math.max(1, Math.min(5, t.tokenH ?? t.tokenSize ?? b?.tokenH ?? b?.tokenSize ?? 1)),
  };

  // Joueur sur token ennemi : remplace HP et CA par les estimations du tracker.
  // Sans estimation = null → affichage "?/?" sur le token (ne révèle pas les vraies valeurs MJ).
  if (!STATE.isAdmin && t.type === 'enemy') {
    if (b) {
      const track  = VS.bstTracker[t.beastId] || {};
      const estMax = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
      if (estMax !== null) {
        // pvCombatHp est stocké sur le token lui-même (écrit lors des attaques joueur).
        // Tous les clients le reçoivent via le onSnapshot vttTokens existant.
        // null → token frais ou jamais frappé par un joueur → afficher pleins PV estimés.
        const pvCombatHp = t.pvCombatHp != null
          ? Math.max(0, parseInt(t.pvCombatHp) || 0) : null;
        if (pvCombatHp !== null) {
          result.displayHp = pvCombatHp;           // suivi de groupe via token (prioritaire)
        } else if (t.hp !== null) {
          result.displayHp = Math.min(hpCurrent, estMax); // HP réel borné à l'estimation
        } else {
          result.displayHp = estMax;               // token frais = pleins PV estimés
        }
        result.displayHpMax = estMax;
      } else {
        result.displayHp    = null;
        result.displayHpMax = null;
      }
      if (track.caEstimee !== undefined) result.displayDefense = parseInt(track.caEstimee) || 0;
      // PM estimé : pmActuel (estimation joueur) borné par pmCombat (PM réellement
      // consommés, suivis sur le token quand la créature utilise une compétence).
      // Sans estimation → null → jauge "✨?".
      const estPmMax = track.pmActuel !== undefined ? parseInt(track.pmActuel) : null;
      if (estPmMax !== null && _pmMax > 0) {
        const pmCombat = t.pmCombat != null ? Math.max(0, parseInt(t.pmCombat) || 0) : null;
        result.displayPm    = pmCombat !== null ? Math.min(pmCombat, estPmMax) : estPmMax;
        result.displayPmMax = estPmMax;
      } else {
        result.displayPm    = null;
        result.displayPmMax = null;
      }
    } else {
      // Ennemi sans fiche bestiaire → HP toujours inconnus pour les joueurs
      result.displayHp    = null;
      result.displayHpMax = null;
    }
  }

  // ── Badge CA affiché sur le token ────────────────────────────────────────
  // • MJ : vraie CA (avec buffs) — toujours.
  // • Joueur sur N'IMPORTE quel ennemi : son estimation (tracker bestiaire) ou "?".
  //   Jamais la vraie CA du MJ — y compris pour un ennemi custom (sans beastId).
  // • Reste (son perso, allié, PNJ) : vraie CA (displayDefense).
  if (!STATE.isAdmin && t.type === 'enemy') {
    const track = t.beastId ? (VS.bstTracker[t.beastId] || {}) : null;
    result.caBadge = (track && track.caEstimee !== undefined && track.caEstimee !== '')
      ? String(parseInt(track.caEstimee) || 0)
      : '?';
  } else {
    result.caBadge = String(result.displayDefense ?? 0);
  }

  return result;
}
