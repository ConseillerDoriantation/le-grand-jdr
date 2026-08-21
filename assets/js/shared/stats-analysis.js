// Calculs purs pour les moyennes de la page Statistiques.
// Les champs `tracked*` séparent les nouveaux jets détaillés des anciens
// compteurs, afin de ne jamais présenter une moyenne historique inventée.

const num = (value) => Number(value) || 0;
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));

export function appliedDamageAmount({ beforeHp = null, afterHp = null, rolledDamage = 0, cancelled = false } = {}) {
  if (cancelled) return 0;
  if (finite(beforeHp) && finite(afterHp)) return Math.max(0, Number(beforeHp) - Number(afterHp));
  return Math.max(0, num(rolledDamage));
}

export function vttLogTimeMs(value) {
  let date = null;
  if (value?.toDate instanceof Function) date = value.toDate();
  else if (finite(value?.seconds)) date = new Date(Number(value.seconds) * 1000);
  else if (value instanceof Date) date = value;
  else if (finite(value)) date = new Date(Number(value));
  else if (typeof value === 'string') date = new Date(value);
  return (!date || Number.isNaN(date.getTime())) ? null : date.getTime();
}

export function vttLogDateKey(value) {
  const time = vttLogTimeMs(value);
  const date = time == null ? null : new Date(time);
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Reconstruit les sommes absentes de l'ancien document `stats/main` à partir du
// journal VTT. Le journal reste la source détaillée ; les compteurs stats restent
// la source du nombre total de jets, critiques et échecs.
export function aggregateVttRollDetails(logs = [], {
  dateKeys = null,
  resolveCharacterId = null,
  hasManualCombatCorrection = null,
  isCharacterLogExcluded = null,
} = {}) {
  const dates = dateKeys ? new Set(dateKeys) : null;
  const byCharacter = {};
  let relevantLogs = 0;
  const resolve = (log, kind) => resolveCharacterId?.(log, kind)
    || (kind === 'attack' ? log?.sourceCharacterId : log?.characterId)
    || '';
  const entryFor = id => (byCharacter[id] ??= {
    skills: {},
    combat: {
      attackActions: 0, hits: 0, crits: 0, fumbles: 0,
      attackRolls: 0, attackRollTotal: 0,
      attackResultRolls: 0, attackResultTotal: 0,
      damageEvents: 0, damageTotal: 0,
    },
  });

  for (const log of logs || []) {
    if (!log || log.actionUndone) continue;
    const logDate = vttLogDateKey(log.createdAt);
    if (dates && !dates.has(logDate)) continue;

    if (log.type === 'roll' || log.type === 'craft') {
      const id = resolve(log, 'skill');
      if (id && isCharacterLogExcluded?.(id, logDate, log)) continue;
      const natural = log.type === 'craft' ? log.d20 : log.rollRaw;
      const total = log.type === 'craft' ? log.total : log.rollResult;
      const skill = String(log.type === 'craft' ? 'Artisanat' : (log.rollSkill || '')).trim();
      if (!id || !skill || !finite(natural) || !finite(total)) continue;
      const target = entryFor(id).skills[skill] ??= {
        trackedRolls: 0, naturalTotal: 0, resultTotal: 0, crits: 0, fumbles: 0,
      };
      target.trackedRolls += 1;
      target.naturalTotal += Number(natural);
      target.resultTotal += Number(total);
      target.crits += log.isCrit === true || (log.isCrit == null && Number(natural) === 20) ? 1 : 0;
      target.fumbles += log.isFumble === true || (log.isFumble == null && Number(natural) === 1) ? 1 : 0;
      relevantLogs += 1;
      continue;
    }

    if ((log.type === 'attack' || log.type === 'attack-multi') && !log.isHeal && finite(log.hitD20)) {
      const id = resolve(log, 'attack');
      const targets = log.type === 'attack-multi'
        ? (Array.isArray(log.targets) ? log.targets : [])
        : [log];
      if (!targets.length) continue;
      const actionHit = !log.shieldCancelled && targets.some(target => target?.hit) ? 1 : 0;
      const actionCrit = log.isCrit ? 1 : 0;
      const actionFumble = log.isFumble ? 1 : 0;
      const combat = id && !isCharacterLogExcluded?.(id, logDate, log) ? entryFor(id).combat : null;
      if (combat) {
        combat.attackActions += 1;
        combat.hits += actionHit;
        combat.crits += actionCrit;
        combat.fumbles += actionFumble;
        combat.attackRolls += 1;
        combat.attackRollTotal += Number(log.hitD20);
        if (finite(log.hitTotal)) {
          combat.attackResultRolls += 1;
          combat.attackResultTotal += Number(log.hitTotal);
        }
      }

      // Les anciennes attaques multicibles incrémentaient ces compteurs une fois
      // par cible. Le delta conservé dans le journal permet de retirer précisément
      // cet excédent, même lorsque le journal chargé n'est qu'une fenêtre récente.
      const storedCombat = id ? log.statsDelta?.chars?.[id]?.combat : null;
      if (combat && storedCombat) {
        const expected = {
          attacks: 1,
          hits: actionHit,
          crits: actionCrit,
          fumbles: actionFumble,
          attackRolls: 1,
          attackRollTotal: Number(log.hitD20),
          attackResultRolls: finite(log.hitTotal) ? 1 : 0,
          attackResultTotal: finite(log.hitTotal) ? Number(log.hitTotal) : 0,
        };
        for (const [field, canonicalValue] of Object.entries(expected)) {
          const excess = num(storedCombat[field]) - canonicalValue;
          if (excess > 0) {
            const corrections = (combat.actionOvercounts ??= {});
            corrections[field] = num(corrections[field]) + excess;
          }
        }
      }
      // Les anciens compteurs enregistraient les dégâts théoriques, même au-delà
      // des PV restants. Le journal conserve le snapshot avant l'action et les PV
      // après : on peut donc retirer précisément cet overkill, sans reconstruire
      // ni remplacer les statistiques qui ne figurent pas dans la fenêtre chargée.
      const actualTakenByCharacter = new Map();
      let actionDamage = 0;
      let actionDamageEvents = 0;
      for (const target of targets) {
        const targetId = target?.characterId || resolve(target, 'target');
        const tokenId = target?.tokenId || (log.type === 'attack' ? log.defenderTokenId : null);
        const beforeHp = tokenId ? log.undo?.tokens?.[tokenId]?.hp : null;
        const afterHp = target?.newHp;
        const appliedDamage = log.shieldCancelled
          ? 0
          : finite(target?.dmgApplied)
            ? Math.max(0, num(target.dmgApplied))
            : appliedDamageAmount({ beforeHp, afterHp, rolledDamage: target?.dmgTotal });
        actionDamage += appliedDamage;
        actionDamageEvents += appliedDamage > 0 ? 1 : 0;
        if (!targetId) continue;
        if (isCharacterLogExcluded?.(targetId, logDate, log)) continue;
        const current = actualTakenByCharacter.get(targetId) || { damage: 0, events: 0 };
        current.damage += appliedDamage;
        current.events += appliedDamage > 0 ? 1 : 0;
        actualTakenByCharacter.set(targetId, current);
      }
      for (const [targetId, actual] of actualTakenByCharacter) {
        if (hasManualCombatCorrection?.(targetId, logDate, 'taken')) continue;
        const stored = log.statsDelta?.chars?.[targetId]?.combat || {};
        const corrections = (entryFor(targetId).combat.receivedOvercounts ??= {});
        const recordedDamage = num(stored.dmgTaken);
        const recordedTotal = num(stored.damageTakenTotal);
        const recordedEvents = num(stored.damageTakenEvents);
        if (recordedDamage > actual.damage) corrections.dmgTaken = num(corrections.dmgTaken) + recordedDamage - actual.damage;
        if (recordedTotal > actual.damage) corrections.damageTakenTotal = num(corrections.damageTakenTotal) + recordedTotal - actual.damage;
        if (recordedEvents > actual.events) corrections.damageTakenEvents = num(corrections.damageTakenEvents) + recordedEvents - actual.events;
      }
      if (combat) {
        combat.damageEvents += actionDamageEvents;
        combat.damageTotal += actionDamage;
        const storedAttacker = log.statsDelta?.chars?.[id]?.combat || {};
        const dealtCorrections = (combat.dealtOvercounts ??= {});
        const recordedDealt = num(storedAttacker.dmgDealt);
        const recordedDamageTotal = num(storedAttacker.damageTotal);
        const recordedDamageEvents = num(storedAttacker.damageEvents);
        const manualDamageDealt = !!hasManualCombatCorrection?.(id, logDate, 'dealt');
        if (manualDamageDealt) combat.manualDamageDealt = true;
        if (!manualDamageDealt) {
          if (recordedDealt > actionDamage) dealtCorrections.dmgDealt = num(dealtCorrections.dmgDealt) + recordedDealt - actionDamage;
          if (recordedDamageTotal > actionDamage) dealtCorrections.damageTotal = num(dealtCorrections.damageTotal) + recordedDamageTotal - actionDamage;
          if (recordedDamageEvents > actionDamageEvents) dealtCorrections.damageEvents = num(dealtCorrections.damageEvents) + recordedDamageEvents - actionDamageEvents;
        }
        if (!Object.keys(dealtCorrections).length) delete combat.dealtOvercounts;
      }
      relevantLogs += 1;
    }
  }

  return { byCharacter, relevantLogs };
}

export function mergeTrackedSkillStats(current = {}, fromLog = {}) {
  const logRolls = num(fromLog.trackedRolls);
  const trackedRolls = num(current.rolls) ? Math.min(num(current.rolls), logRolls) : logRolls;
  const merged = { ...current };
  if (trackedRolls > num(current.trackedRolls) && logRolls) {
    const ratio = trackedRolls / logRolls;
    merged.trackedRolls = trackedRolls;
    merged.naturalTotal = num(fromLog.naturalTotal) * ratio;
    merged.resultTotal = num(fromLog.resultTotal) * ratio;
  }
  // Si chaque jet enregistré pour cette compétence existe dans le journal, ce
  // dernier est aussi la source fiable de leur attribution critique par perso.
  if (logRolls > 0 && logRolls === num(current.rolls)) {
    merged.crits = num(fromLog.crits);
    merged.fumbles = num(fromLog.fumbles);
  }
  return merged;
}

export function mergeTrackedCombatStats(current = {}, fromLog = {}) {
  const merged = { ...current };
  // On ne remplace jamais les totaux de campagne par le journal, qui peut être
  // partiel ou en cache. On retire seulement les doublons multicibles prouvés.
  for (const [field, excess] of Object.entries(fromLog.actionOvercounts || {})) {
    merged[field] = Math.max(0, num(merged[field]) - num(excess));
  }
  for (const [field, excess] of Object.entries(fromLog.receivedOvercounts || {})) {
    merged[field] = Math.max(0, num(merged[field]) - num(excess));
  }
  for (const [field, excess] of Object.entries(fromLog.dealtOvercounts || {})) {
    merged[field] = Math.max(0, num(merged[field]) - num(excess));
  }
  const damageTakenCorrection = num(fromLog.receivedOvercounts?.dmgTaken);
  const damageDealtCorrection = num(fromLog.dealtOvercounts?.dmgDealt);
  if (damageTakenCorrection > 0) merged.damageTakenCorrection = damageTakenCorrection;
  if (damageDealtCorrection > 0) merged.damageDealtCorrection = damageDealtCorrection;
  const logActions = num(fromLog.attackActions);
  if (logActions > 0 && logActions === num(merged.attacks)) {
    merged.hits = num(fromLog.hits);
    merged.crits = num(fromLog.crits);
    merged.fumbles = num(fromLog.fumbles);
  }
  const logAttackRolls = num(fromLog.attackRolls);
  const attackRolls = num(merged.attacks) ? Math.min(num(merged.attacks), logAttackRolls) : logAttackRolls;
  if (attackRolls > num(merged.attackRolls) && logAttackRolls) {
    merged.attackRolls = attackRolls;
    merged.attackRollTotal = num(fromLog.attackRollTotal) * (attackRolls / logAttackRolls);
  }
  const logResultRolls = num(fromLog.attackResultRolls);
  const attackResultRolls = num(merged.attacks) ? Math.min(num(merged.attacks), logResultRolls) : logResultRolls;
  if (attackResultRolls > num(merged.attackResultRolls) && logResultRolls) {
    merged.attackResultRolls = attackResultRolls;
    merged.attackResultTotal = num(fromLog.attackResultTotal) * (attackResultRolls / logResultRolls);
  }
  if (!fromLog.manualDamageDealt && num(fromLog.damageEvents) > num(current.damageEvents)) {
    merged.damageEvents = num(fromLog.damageEvents);
    merged.damageTotal = num(fromLog.damageTotal);
  }
  return merged;
}

export function statsAverage(total, count, digits = 1) {
  const safeCount = num(count);
  if (safeCount <= 0) return null;
  const factor = 10 ** Math.max(0, digits);
  return Math.round((num(total) / safeCount) * factor) / factor;
}

export function normalizeSkillStats(name, value = {}) {
  const rolls = num(value.rolls);
  const trackedRolls = Math.min(rolls, Math.max(0, num(value.trackedRolls)));
  const crits = num(value.crits);
  const fumbles = num(value.fumbles);
  return {
    sk: name,
    rolls,
    trackedRolls,
    crits,
    fumbles,
    naturalTotal: num(value.naturalTotal),
    resultTotal: num(value.resultTotal),
    naturalAvg: statsAverage(value.naturalTotal, trackedRolls),
    resultAvg: statsAverage(value.resultTotal, trackedRolls),
    critRate: rolls ? Math.round(crits / rolls * 100) : 0,
    fumbleRate: rolls ? Math.round(fumbles / rolls * 100) : 0,
  };
}

export function aggregateSkillAverages(rows = []) {
  const bySkill = new Map();
  let rolls = 0;
  let trackedRolls = 0;
  let naturalTotal = 0;
  let resultTotal = 0;
  let crits = 0;
  let fumbles = 0;

  rows.forEach(row => {
    (row.perSkill || []).forEach(skill => {
      const current = bySkill.get(skill.sk) || {
        sk: skill.sk, rolls: 0, trackedRolls: 0, crits: 0, fumbles: 0,
        naturalTotal: 0, resultTotal: 0,
      };
      for (const key of ['rolls', 'trackedRolls', 'crits', 'fumbles', 'naturalTotal', 'resultTotal']) {
        current[key] += num(skill[key]);
      }
      bySkill.set(skill.sk, current);
      rolls += num(skill.rolls);
      trackedRolls += num(skill.trackedRolls);
      naturalTotal += num(skill.naturalTotal);
      resultTotal += num(skill.resultTotal);
      crits += num(skill.crits);
      fumbles += num(skill.fumbles);
    });
  });

  const decorate = skill => ({
    ...skill,
    naturalAvg: statsAverage(skill.naturalTotal, skill.trackedRolls),
    resultAvg: statsAverage(skill.resultTotal, skill.trackedRolls),
    critRate: skill.rolls ? Math.round(skill.crits / skill.rolls * 100) : 0,
    fumbleRate: skill.rolls ? Math.round(skill.fumbles / skill.rolls * 100) : 0,
  });

  return {
    rolls,
    trackedRolls,
    naturalTotal,
    resultTotal,
    crits,
    fumbles,
    naturalAvg: statsAverage(naturalTotal, trackedRolls),
    resultAvg: statsAverage(resultTotal, trackedRolls),
    coverage: rolls ? Math.round(trackedRolls / rolls * 100) : 0,
    perSkill: [...bySkill.values()].map(decorate)
      .sort((a, b) => (b.trackedRolls - a.trackedRolls) || (b.rolls - a.rolls) || a.sk.localeCompare(b.sk, 'fr')),
  };
}

// Vue synthétique de toutes les actions résolues au d20. Les compétences et les
// attaques restent disponibles séparément dans leurs panneaux sources, mais ce
// résumé évite de présenter les critiques ou moyennes d'un seul type d'action.
export function aggregateActionAverages(skills = {}, combat = {}) {
  const skillRolls = num(skills.rolls);
  const combatRolls = num(combat.attacks);
  const rolls = skillRolls + combatRolls;
  const skillTrackedRolls = Math.min(skillRolls, num(skills.trackedRolls));
  const combatTrackedRolls = Math.min(combatRolls, num(combat.attackRolls));
  const combatResultRolls = Math.min(combatRolls, num(combat.attackResultRolls));
  const trackedRolls = skillTrackedRolls + combatTrackedRolls;
  const resultTrackedRolls = skillTrackedRolls + combatResultRolls;
  const naturalTotal = num(skills.naturalTotal) + num(combat.attackRollTotal);
  const resultTotal = num(skills.resultTotal) + num(combat.attackResultTotal);
  const crits = num(skills.crits) + num(combat.crits);
  const fumbles = num(skills.fumbles) + num(combat.fumbles);

  return {
    rolls,
    skillRolls,
    combatRolls,
    trackedRolls,
    resultTrackedRolls,
    naturalTotal,
    resultTotal,
    crits,
    fumbles,
    naturalAvg: statsAverage(naturalTotal, trackedRolls),
    resultAvg: statsAverage(resultTotal, resultTrackedRolls),
    critRate: rolls ? Math.round(crits / rolls * 100) : null,
    fumbleRate: rolls ? Math.round(fumbles / rolls * 100) : null,
    coverage: rolls ? Math.round(trackedRolls / rolls * 100) : 0,
    resultCoverage: rolls ? Math.round(resultTrackedRolls / rolls * 100) : 0,
  };
}

export function combatAverages(combat = {}) {
  const damageEvents = num(combat.damageEvents);
  const damageTakenEvents = num(combat.damageTakenEvents);
  const attackRolls = num(combat.attackRolls);
  const attackResultRolls = num(combat.attackResultRolls);
  const historicalDamageEvents = num(combat.hits);
  const historicalDamageTakenEvents = Math.max(0, num(combat.attacksTaken) - num(combat.attacksAvoided));
  return {
    damageEvents: damageEvents || historicalDamageEvents,
    damageAverage: damageEvents
      ? statsAverage(combat.damageTotal, damageEvents)
      : statsAverage(combat.dmgDealt, historicalDamageEvents),
    damageAverageEstimated: damageEvents <= 0 && historicalDamageEvents > 0,
    damageTakenEvents: damageTakenEvents || historicalDamageTakenEvents,
    damageTakenAverage: damageTakenEvents
      ? statsAverage(combat.damageTakenTotal, damageTakenEvents)
      : statsAverage(combat.dmgTaken, historicalDamageTakenEvents),
    damageTakenAverageEstimated: damageTakenEvents <= 0 && historicalDamageTakenEvents > 0,
    attackRolls,
    attackNaturalAverage: statsAverage(combat.attackRollTotal, attackRolls),
    attackResultRolls,
    attackResultAverage: statsAverage(combat.attackResultTotal, attackResultRolls),
  };
}
