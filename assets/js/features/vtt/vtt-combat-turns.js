// ══════════════════════════════════════════════════════════════════════════════
// VTT-COMBAT-TURNS.JS — Cycle de combat : démarrer/terminer, tours, round suivant
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (découpage, voir docs/vtt-decomposition.md).
// Gère l'état de combat (VS.session.combat) : démarrer/terminer (reset des flags
// de tour + conversion des durées différées), réinitialiser le tour d'un token,
// basculer action bonus/réaction, et _vttNextRound (effets périodiques DoT/regen,
// expiration buffs/états/summons, sauvegardes de concentration).
// Couplage runtime vers vtt.js (helpers combat, hoisted) : _rollDiceDetailed,
// _setHp, _persistInvocationState, _vttTriggerConcentrationSave,
// _vttBreakConcentrationEffects. L'overlay d'ordre de combat = vtt-combat-tracker.js.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { db, updateDoc, setDoc, addDoc, serverTimestamp, writeBatch } from '../../config/firebase.js';
import { showNotif } from '../../shared/notifications.js';
import { _sesRef, _tokRef, _logCol } from './vtt-refs.js';
import { _live } from './vtt-effective.js';
import { bumpHeal } from '../../shared/stats.js';
import {
  CONDITION_BY_ID, _rollDiceDetailed, _setHp, _persistInvocationState,
  _vttTriggerConcentrationSave, _vttBreakConcentrationEffects, _vttExpireSpellZones,
} from './vtt.js';

export async function _vttResetTurn(id) {
  if (!STATE.isAdmin) return;
  await updateDoc(_tokRef(id), { movedThisTurn: false, movedCells: 0, bonusMvt: 0, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false })
    .catch(() => showNotif('Erreur reset tour', 'error'));
  showNotif('Tour réinitialisé', 'success');
}

export async function _vttToggleTurnFlag(id, field) {
  if (!STATE.isAdmin || !["bonusActionThisTurn", "reactionThisTurn"].includes(field)) return;
  const token = VS.tokens[id]?.data;
  if (!token) return;
  await updateDoc(_tokRef(id), { [field]: !token[field] })
    .catch(() => showNotif("Erreur de suivi du tour", "error"));
}

export async function _vttToggleCombat() {
  if (!STATE.isAdmin) return;
  const active=!VS.session?.combat?.active;
  await setDoc(_sesRef(),{combat:{active,round:active?1:0}},{merge:true});
  if (active) {
    const b=writeBatch(db);
    // Au démarrage du combat (round 1), on convertit les conditions à durée
    // différée (pendingDuration, posées hors combat) en expiresAtRound réel.
    // Sinon ces états resteraient indéfiniment.
    const startRound = 1;
    Object.keys(VS.tokens).forEach(id => {
      const tokData = VS.tokens[id]?.data;
      if (!tokData) return;
      const updates = { movedThisTurn:false, movedCells:0, bonusMvt:0, attackedThisTurn:false, bonusActionThisTurn:false, reactionThisTurn:false };
      if (Array.isArray(tokData.conditions) && tokData.conditions.length) {
        let changed = false;
        const newConds = tokData.conditions.map(c => {
          if (c.pendingDuration != null && c.expiresAtRound == null) {
            changed = true;
            const dur = parseInt(c.pendingDuration) || 0;
            const { pendingDuration, ...rest } = c;
            return { ...rest, expiresAtRound: dur > 0 ? startRound + dur - 1 : null };
          }
          return c;
        });
        if (changed) updates.conditions = newConds;
      }
      b.update(_tokRef(id), updates);
    });
    await b.commit().catch(()=>{});
    showNotif('⚔️ Combat démarré !','success');
  } else showNotif('Combat terminé.','success');
}
export async function _vttNextRound() {
  if (!STATE.isAdmin||!VS.session?.combat?.active) return;
  const round=(VS.session.combat.round??1)+1;
  await setDoc(_sesRef(),{combat:{active:true,round}},{merge:true});

  // ── Application des effets périodiques en début de round (avant cleanup) ──
  // DoT : dégâts/tour · Regen : soin/tour
  const dotNotifs = [];
  for (const id of Object.keys(VS.tokens)) {
    const td = VS.tokens[id]?.data;
    const dots = (td?.buffs || []).filter(b => (b.type === 'dot' || b.type === 'regen')
      && (b.expiresAtRound == null || round <= b.expiresAtRound));
    if (!dots.length) continue;
    let totalDmg = 0;
    let totalHeal = 0;
    const dmgRolls = [];
    const healRolls = [];
    for (const dot of dots) {
      const det = _rollDiceDetailed(dot.formula || '1d4 +2');
      const entry = {
        formula: dot.formula || '1d4 +2',
        rolled: det.total, rolledDice: det.rolls, mod: det.mod, sides: det.sides,
        sortLabel: dot.sortLabel || (dot.type === 'regen' ? 'Régénération' : 'DoT'),
      };
      if (dot.type === 'regen') {
        totalHeal += det.total;
        healRolls.push(entry);
      } else {
        totalDmg += det.total;
        dmgRolls.push(entry);
      }
    }
    const lT = _live(td);
    const tgtName = lT.displayName ?? td.name;
    const curHp = lT.displayHp ?? td.hp ?? 20;
    const hpMax = lT.displayHpMax ?? 20;
    if (totalDmg > 0) {
      const newHp = Math.max(0, curHp - totalDmg);
      await _setHp(td, newHp).catch(() => {});
      dotNotifs.push(`🩸 ${totalDmg} dégâts DoT → ${tgtName}`);
      await addDoc(_logCol(), {
        type: 'dot-tick',
        authorId: STATE.user?.uid || null,
        authorName: STATE.profile?.pseudo || STATE.profile?.prenom || 'MJ',
        tokenName: tgtName,
        rolls: dmgRolls, total: totalDmg, newHp, hpMax,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      const concNotes = await _vttTriggerConcentrationSave(td, totalDmg, newHp);
      dotNotifs.push(...concNotes);
    }
    if (totalHeal > 0) {
      const afterDmg = Math.max(0, curHp - totalDmg);
      const newHp = Math.min(hpMax, afterDmg + totalHeal);
      const effectiveHeal = Math.max(0, newHp - afterDmg);
      if (effectiveHeal <= 0) continue;
      await _setHp(td, newHp).catch(() => {});
      // Statistiques : soin effectif attribué aux soigneurs (au prorata du tick).
      const _regenBuffs = dots.filter(d => d.type === 'regen');
      _regenBuffs.forEach((d, i) => {
        const share = totalHeal > 0 ? Math.round(effectiveHeal * ((healRolls[i]?.rolled || 0) / totalHeal)) : 0;
        const hc = VS.tokens[d.casterId]?.data;
        if (hc?.characterId && share > 0) bumpHeal(hc.characterId, hc.name, share);
      });
      dotNotifs.push(`💚 ${effectiveHeal} PV Régénération → ${tgtName}`);
      await addDoc(_logCol(), {
        type: 'dot-tick',
        isHeal: true,
        authorId: STATE.user?.uid || null,
        authorName: STATE.profile?.pseudo || STATE.profile?.prenom || 'MJ',
        tokenName: tgtName,
        rolls: healRolls, total: effectiveHeal, rolledTotal: totalHeal, newHp, hpMax,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  }

  const b=writeBatch(db);
  const expiredNotifs = [];
  const expiredConcentrations = [];
  Object.keys(VS.tokens).forEach(id => {
    const tokData = VS.tokens[id]?.data;
    if (!tokData) return;
    // ── Cleanup auto des tokens summons expirés (sentinelle, arme invoquée) ──
    // Les summons non-canalisés expirent à round > summonExpiresAtRound.
    // Les summons canalisés (summonCanalise: true) persistent tant que la
    // concentration tient, puis deviennent temporaires après rupture.
    if (tokData.summonExpiresAtRound != null && !tokData.summonCanalise && round > tokData.summonExpiresAtRound) {
      expiredNotifs.push(`${tokData.summonKind === 'invocation' ? '🐾' : tokData.summonKind === 'sentinelle' ? '🪤' : '⚔️'} ${tokData.name} dissipé`);
      _persistInvocationState(tokData);   // PV/PM persistants avant dissipation (invocations)
      b.delete(_tokRef(id));
      return; // skip buff cleanup pour token supprimé
    }
    const updates = { movedThisTurn: false, movedCells: 0, bonusMvt: 0, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false };
    if (tokData.buffs?.length) {
      const remaining = tokData.buffs.filter(bf => {
        const isExpired =
          // cas normal : expiresAtRound calculé
          (bf.expiresAtRound != null && round > bf.expiresAtRound) ||
          // fallback : anciens buffs (expiresAtRound null) avec totalDuration+startRound
          (bf.expiresAtRound == null && bf.totalDuration != null && bf.startRound != null &&
           round - Math.max(1, bf.startRound) >= bf.totalDuration);
        if (isExpired) {
          expiredNotifs.push(`${bf.icon ?? '✨'} ${bf.sortLabel ?? 'Buff'} expiré sur ${_live(tokData).displayName ?? tokData.name}`);
          return false;
        }
        return true;
      });
      if (remaining.length !== tokData.buffs.length) updates.buffs = remaining;
    }
    // ── Cleanup des états (conditions) expirés ────────────────────────
    // Les conditions ont aussi un expiresAtRound (posé au cast d'affliction
    // ou via l'édition manuelle). Mêmes règles d'expiration que les buffs.
    if (tokData.conditions?.length) {
      const remainingConds = tokData.conditions.filter(c => {
        if (c.expiresAtRound != null && round > c.expiresAtRound) {
          const lib = CONDITION_BY_ID[c.id];
          const icon = lib?.icon || '⛓';
          const label = lib?.label || c.id;
          expiredNotifs.push(`${icon} ${label} expiré sur ${_live(tokData).displayName ?? tokData.name}`);
          if (c.concentrationSpell) expiredConcentrations.push({ casterId: tokData.id, cond: c });
          return false;
        }
        return true;
      });
      if (remainingConds.length !== tokData.conditions.length) updates.conditions = remainingConds;
    }
    b.update(_tokRef(id), updates);
  });
  await b.commit().catch(()=>{});
  for (const item of expiredConcentrations) {
    await _vttBreakConcentrationEffects(item.casterId, item.cond);
  }
  _vttExpireSpellZones(round);   // zones de sort persistantes arrivées à expiration
  dotNotifs.forEach(msg => showNotif(msg, 'error'));
  expiredNotifs.forEach(msg => showNotif(msg, 'info'));
  showNotif(`Round ${round} !`, 'success');
}
