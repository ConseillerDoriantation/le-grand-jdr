// ══════════════════════════════════════════════════════════════════════════════
// VTT-SPELL-EFFECTS.JS — Application des effets de sorts sur les cibles
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (découpage, voir docs/vtt-decomposition.md).
// Appliqués en fin de résolution d'attaque/sort (_vttRollAttack) :
//   • _vttApplyEnchantBuffs  — buffs d'enchantement (dégâts arme ou état sur allié)
//   • _vttApplyAfflictions   — affliction (jet de sauvegarde de la cible, buff si échec)
//   • _vttApplyRegeneration  — régénération (soin sur la durée)
// Couplage runtime vers vtt.js (helpers combat hoisted) : _buffShared,
// _consumeLuckyReroll, _rollDiceDetailed, _setHp, _tokenStatMod, _STAT_SHORT,
// CONDITION_BY_ID. Le déclenchement vit dans _vttRollAttack (reste vtt.js).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { updateDoc, addDoc, serverTimestamp } from '../../config/firebase.js';
import { showNotif } from '../../shared/notifications.js';
import { _tokRef, _logCol } from './vtt-refs.js';
import { _live, _scaledEnchantConditionFields } from './vtt-effective.js';
import { bumpHeal } from '../../shared/stats.js';
import {
  CONDITION_BY_ID, _STAT_SHORT, _buffShared, _consumeLuckyReroll,
  _rollDiceDetailed, _setHp, _tokenStatMod, _vttLogSourceFields, _vttLogTargetFields, _vttLogSingleTargetFields,
} from './vtt.js';

/** Applique les buffs d'enchantement (mode Dégâts arme OU mode État sur allié). */
export async function _vttApplyEnchantBuffs(srcId, targetIds, opt) {
  const shared = _buffShared(opt, srcId);

  // Mode "État" : applique 1..N états choisis (1 par rune Enchantement) à chaque
  // allié ciblé. Pas de JS (effet bénéfique consenti). Le 1er état garde ses
  // réglages fins ; tous sont modulés par Puissance/Amplification (global).
  const etatIds = (opt.mods?.enchantEtatIds?.length
    ? opt.mods.enchantEtatIds
    : (opt.mods?.enchantEtatId ? [opt.mods.enchantEtatId] : []))
    .filter(id => id && CONDITION_BY_ID[id]);
  if (etatIds.length) {
    const round = VS.session?.combat?.round ?? 0;
    // Construit la condition pour un état donné (idx 0 = réglages fins manuels).
    const buildCond = (etatId, idx) => {
      const lib = CONDITION_BY_ID[etatId];
      const isConsumed = !!lib.effects?.consumedByAttackAgainst;
      const dur = opt.mods?.concentration ? 10 : (opt.classicDuration > 0
        ? opt.classicDuration : (
        Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0 ? lib.defaultDuration : 2
      ));
      const expiresAtRound = (round > 0 && !isConsumed && dur > 0) ? round + dur - 1 : null;
      const pendingDuration = (round === 0 && !isConsumed && dur > 0) ? dur : null;
      const scaledFields = _scaledEnchantConditionFields(
        lib,
        opt.mods?.enchantStatePower || 0,
        opt.mods?.enchantStateAmplification || 0,
        idx === 0 ? {
          movementBonus: opt.mods?.enchantStateMoveBonus,
          dmgFormula: opt.mods?.enchantStateDmgFormula,
        } : {},
        opt.mods?.enchantStateChance || 0
      );
      return {
        id: etatId, appliedAt: Date.now(), appliedBy: srcId || null,
        source: opt.label || '',
        saveDC: lib.defaultSaveStat ? (lib.defaultDC || 11) : null,
        saveStat: lib.defaultSaveStat || null,
        expiresAtRound,
        ...(pendingDuration != null ? { pendingDuration } : {}),
        ...scaledFields,
      };
    };
    for (const tid of targetIds) {
      const td = VS.tokens[tid]?.data; if (!td) continue;
      let conds = (td.conditions || []).filter(c => c.source !== opt.label);
      const applied = [];
      etatIds.forEach((etatId, idx) => {
        if (conds.some(c => c.id === etatId)) return;   // pas de doublon d'état
        conds = [...conds, buildCond(etatId, idx)];
        applied.push(CONDITION_BY_ID[etatId]);
      });
      if (!applied.length) continue;
      await updateDoc(_tokRef(tid), { conditions: conds }).catch(() => {});
      const name = _live(td).displayName ?? td.name;
      showNotif(`${applied.map(l => l.icon).join('')} ${name} : ${applied.map(l => l.label).join(', ')}`, 'success');
    }
    return;
  }

  // Mode "Dégâts" (par défaut) : buffs slot-based legacy
  const buffs = [];
  if (opt.mods?.enchantArmeDmg) {
    buffs.push({ ...shared, type: 'dmg_bonus', slot: 'arme', icon: '⚔️',
      formula: opt.mods.enchantArmeDmg.formula, element: opt.mods.enchantArmeDmg.element });
  }
  if (opt.mods?.enchantPieds) {
    buffs.push({ ...shared, type: 'move_bonus', slot: 'pieds', icon: '👢',
      bonus: opt.mods.enchantPieds.bonusCells });
  }
  if (opt.mods?.enchantGeneric) {
    buffs.push({ ...shared, type: 'enchantment',
      slot: opt.mods.enchantGeneric.slot, effect: opt.mods.enchantGeneric.effect,
      icon: opt.mods.enchantGeneric.slot === 'tete' ? '👁️' : '👕' });
  }
  // Nouveaux enchantements chiffrés (mode-based) sur l'allié
  if (opt.mods?.enchantToucher) {
    buffs.push({ ...shared, type: 'toucher_bonus', icon: '🎯', bonus: opt.mods.enchantToucher.bonus });
  }
  if (opt.mods?.enchantMove) {
    buffs.push({ ...shared, type: 'move_bonus', slot: 'pieds', icon: '👢', bonus: opt.mods.enchantMove.bonusCells });
  }
  if (!buffs.length) return;
  // ── Anti-stack global : un buff dmg_bonus arme remplace TOUS les anciens dmg_bonus arme.
  // Les autres types (move_bonus, range_bonus, enchantment) se filtrent par sort label
  // pour permettre des effets différents de sources différentes.
  for (const tid of targetIds) {
    const td = VS.tokens[tid]?.data; if (!td) continue;
    const existing = (td.buffs || []).filter(b => {
      // Retire tout buff dmg_bonus arme : non cumulable, le dernier en vigueur l'emporte
      if (b.type === 'dmg_bonus' && b.slot === 'arme') return false;
      // Autres types : retire seulement les buffs du même sort (par label)
      return !(b.type !== 'dmg_bonus' && b.sortLabel === opt.label);
    });
    await updateDoc(_tokRef(tid), { buffs: [...existing, ...buffs] }).catch(() => {});
  }
}

/** Applique une affliction : JS Sa de la cible, buff selon slot si échec. */
export async function _vttApplyAfflictions(srcId, targetIds, opt, { undo = null, statsDelta = null } = {}) {
  const aff = opt.mods?.affliction; if (!aff) return;
  const shared = _buffShared(opt, srcId);
  const statShortStr = _STAT_SHORT[aff.saveStat] || aff.saveStat;
  const dotFormula = aff.dotFormula || '1d4';
  const mode = aff.mode || 'dot';
  const srcTok = VS.tokens[srcId]?.data;
  const srcName = srcTok ? (_live(srcTok).displayName ?? srcTok.name) : '?';

  // ── Log d'annonce du cast (1 message global) ────────────────────────
  // « A lance Silence sur B » avant les JS individuels
  const tgtNames = targetIds.map(tid => {
    const td = VS.tokens[tid]?.data;
    return td ? (_live(td).displayName ?? td.name) : '?';
  }).join(', ');
  await addDoc(_logCol(), {
    type: 'affliction-cast',
    ...(undo ? { undo } : {}),
    ...(statsDelta ? { statsDelta } : {}),
    authorId: STATE.user?.uid || null,
    authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
    casterName: srcName, characterImage: srcTok?.image || null,
    ..._vttLogSourceFields(srcTok),
    ..._vttLogSingleTargetFields(targetIds),
    targetName: tgtNames,
    optLabel: opt.label || 'Affliction',
    mode, dd: aff.dd, statLabel: statShortStr,
    effectLbl: mode === 'etat' && aff.etatId && CONDITION_BY_ID[aff.etatId]
               ? `${CONDITION_BY_ID[aff.etatId].icon} ${CONDITION_BY_ID[aff.etatId].label}`
               : `🩸 DoT ${dotFormula}/tour`,
    createdAt: serverTimestamp(),
  }).catch(() => {});

  for (const tid of targetIds) {
    const td = VS.tokens[tid]?.data; if (!td) continue;
    const saveMod = _tokenStatMod(td, aff.saveStat);
    const initialRoll = Math.floor(Math.random() * 20) + 1;
    let roll = initialRoll;
    let tot = roll + saveMod;
    const luck = await _consumeLuckyReroll(tid, td, roll, roll === 1 || tot < aff.dd);
    if (luck) {
      roll = luck.d20;
      tot = roll + saveMod;
    }
    const success = roll === 20 || (roll !== 1 && tot >= aff.dd);
    const tgtName = _live(td).displayName ?? td.name;
    const rollStr = `JS ${statShortStr} ${roll}${saveMod>=0?'+':''}${saveMod}=${tot} vs DD${aff.dd}`;

    // ── Log du JS dans le chat ──────────────────────────────────────────
    // Permet au MJ et aux joueurs de voir le résultat du jet, le mod utilisé
    // et la résolution (résistance vs application de l'effet).
    const _effectLbl = (() => {
      if (mode === 'etat' && aff.etatId && CONDITION_BY_ID[aff.etatId]) {
        const l = CONDITION_BY_ID[aff.etatId];
        return `${l.icon} ${l.label}`;
      }
      return `🩸 DoT ${dotFormula}/tour`;
    })();
    await addDoc(_logCol(), {
      type: 'save',
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
      tokenName: tgtName,
      characterImage: _live(td).displayImage || null,
      ..._vttLogTargetFields(td),
      conditionLabel: _effectLbl,
      sortLabel: opt.label || '',
      statLabel: statShortStr, mod: saveMod, d20: roll, d20rolls: luck ? [initialRoll, luck.reroll] : null, total: tot, dd: aff.dd,
      passed: success,
      createdAt: serverTimestamp(),
    }).catch(() => {});

    if (success) {
      showNotif(`🛡️ ${tgtName} résiste${luck ? ` · 🍀 relance ${luck.reroll}` : ''} · ${rollStr}`, 'info');
      continue;
    }

    // ── Mode "État" : applique l'état choisi avec sa durée par défaut ──
    if (mode === 'etat') {
      // Diagnostic clair si l'état est mal configuré
      if (!aff.etatId) {
        showNotif(`⚠️ Sort "${opt.label}" en mode État sans état choisi — rien n'est appliqué`, 'warning');
        continue;
      }
      const lib = CONDITION_BY_ID[aff.etatId];
      if (!lib) {
        showNotif(`⚠️ État "${aff.etatId}" introuvable en BDD — vérifier les réglages`, 'error');
        continue;
      }
      const round = VS.session?.combat?.round ?? 0;
      const isConsumed = !!lib.effects?.consumedByAttackAgainst;
      const dur = opt.mods?.concentration ? 10 : (opt.classicDuration > 0
        ? opt.classicDuration : (
        Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0
          ? lib.defaultDuration : 2
      ));
      // Si combat actif (round > 0) : expiresAtRound calculé direct
      // Si combat inactif (round = 0) : on stocke pendingDuration pour reporter
      //   le calcul au démarrage du combat (sinon l'état durerait à l'infini)
      const expiresAtRound = (round > 0 && !isConsumed && dur > 0) ? round + dur - 1 : null;
      const pendingDuration = (round === 0 && !isConsumed && dur > 0) ? dur : null;
      const existingConds = td.conditions || [];
      if (existingConds.some(c => c.id === aff.etatId)) {
        showNotif(`${lib.icon} ${tgtName} portait déjà ${lib.label}`, 'info');
        continue;
      }
      const newCond = {
        id: aff.etatId,
        appliedAt: Date.now(),
        appliedBy: srcId || null,
        source: opt.label || '',
        saveDC: lib.defaultSaveStat ? (lib.defaultDC || 11) : null,
        saveStat: lib.defaultSaveStat || aff.saveStat || null,
        expiresAtRound,
        ...(pendingDuration != null ? { pendingDuration } : {}),
      };
      // Surface l'erreur si l'update Firestore échoue (permissions, etc.)
      try {
        await updateDoc(_tokRef(tid), { conditions: [...existingConds, newCond] });
        showNotif(`${lib.icon} ${tgtName} subit ${lib.label} · ${rollStr} (échec)`, 'success');
      } catch (err) {
        console.error('[VTT] État non appliqué :', err);
        showNotif(`⚠️ ${tgtName} : échec d'application de ${lib.label} (${err?.message || err})`, 'error');
      }
      continue;
    }

    // ── Mode "DoT" (par défaut) : applique un buff de type 'dot' avec la formule ──
    // ⚠️ Non cumulable : un seul DoT actif à la fois sur une cible. Le dernier
    // appliqué remplace TOUS les DoT existants (peu importe la source).
    // ✦ Proc immédiat : le DoT inflige son tick au moment du cast aussi (pas
    //   seulement aux rounds suivants).
    const newBuff = {
      ...shared, type: 'dot', slot: aff.slot, icon: '🩸',
      formula: dotFormula, element: aff.element, effect: aff.effect,
    };
    const existing = (td.buffs || []).filter(b => b.type !== 'dot');
    try {
      await updateDoc(_tokRef(tid), { buffs: [...existing, newBuff] });
    } catch (err) {
      console.error('[VTT] DoT non appliqué :', err);
      showNotif(`⚠️ ${tgtName} : échec d'application du DoT (${err?.message || err})`, 'error');
      continue;
    }

    // Roll du tick immédiat avec détail des dés
    const det = _rollDiceDetailed(dotFormula);
    if (det.total > 0) {
      const lT = _live(td);
      const curHp = lT.displayHp ?? td.hp ?? 20;
      const newHp = Math.max(0, curHp - det.total);
      let hpApplied = true;
      await _setHp(td, newHp).catch(err => {
        hpApplied = false;
        console.error('[VTT] DoT tick immédiat : HP non appliqués', err);
        showNotif(`⚠️ ${tgtName} : tick de DoT non appliqué (${err?.code || err?.message || 'permissions ?'})`, 'error');
      });
      if (!hpApplied) continue;
      // Log du tick immédiat (cohérent avec le tick de round suivant)
      await addDoc(_logCol(), {
        type: 'dot-tick',
        authorId: STATE.user?.uid || null,
        authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
        tokenName: tgtName,
        characterImage: lT.displayImage || null,
        ..._vttLogTargetFields(td),
        rolls: [{ formula: dotFormula, rolled: det.total, rolledDice: det.rolls, mod: det.mod, sides: det.sides, sortLabel: opt.label || 'DoT' }],
        total: det.total, newHp, hpMax: lT.displayHpMax ?? 20,
        immediate: true,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      showNotif(`🩸 ${tgtName} : DoT ${dotFormula} → ${det.total} dégâts (proc cast)`, 'success');
    } else {
      showNotif(`🩸 ${tgtName} : DoT ${dotFormula}/tour · ${rollStr} (échec)`, 'success');
    }
  }
}

export async function _vttApplyRegeneration(srcId, targetIds, opt) {
  const regen = opt.mods?.regeneration;
  if (!regen) return;
  const _caster = VS.tokens[srcId]?.data;   // soigneur (pour les stats de soin)
  const shared = _buffShared(opt, srcId);
  const newBuff = {
    ...shared,
    type: 'regen',
    icon: '💚',
    formula: regen.formula || '2d4',
    effect: 'Régénération',
  };
  for (const tid of targetIds) {
    const td = VS.tokens[tid]?.data; if (!td) continue;
    const existing = (td.buffs || []).filter(b => !(b.type === 'regen' && b.sortLabel === opt.label));
    await updateDoc(_tokRef(tid), { buffs: [...existing, newBuff] }).catch(() => {});
    const lT = _live(td);
    const name = lT.displayName ?? td.name;
    showNotif(`💚 ${name} : Régénération ${newBuff.formula}/tour`, 'success');

    const det = _rollDiceDetailed(newBuff.formula);
    if (det.total <= 0) continue;
    const curHp = lT.displayHp ?? td.hp ?? 20;
    const hpMax = lT.displayHpMax ?? 20;
    const newHp = Math.min(hpMax, curHp + det.total);
    const effectiveHeal = Math.max(0, newHp - curHp);
    if (effectiveHeal <= 0) continue;
    let hpApplied = true;
    await _setHp(td, newHp).catch(err => {
      hpApplied = false;
      console.error('[VTT] Régénération tick immédiat : HP non appliqués', err);
      showNotif(`⚠️ ${name} : tick de Régénération non appliqué (${err?.code || err?.message || 'permissions ?'})`, 'error');
    });
    if (!hpApplied) continue;
    // Statistiques : soin réel attribué au soigneur (proc immédiat de Régénération).
    const _healCharId = _caster?.characterId || _caster?.summonOwnerCharId || null;
    if (_healCharId) bumpHeal(_healCharId, _caster.name, effectiveHeal);
    await addDoc(_logCol(), {
      type: 'dot-tick',
      isHeal: true,
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
      tokenName: name,
      characterImage: lT.displayImage || null,
      ..._vttLogTargetFields(td),
      rolls: [{ formula: newBuff.formula, rolled: det.total, rolledDice: det.rolls, mod: det.mod, sides: det.sides, sortLabel: opt.label || 'Régénération' }],
      total: effectiveHeal, rolledTotal: det.total, newHp, hpMax,
      immediate: true,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    showNotif(`💚 ${name} : Régénération ${newBuff.formula} → +${effectiveHeal} PV (proc cast)`, 'success');
  }
}
