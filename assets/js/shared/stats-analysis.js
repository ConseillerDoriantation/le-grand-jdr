// Calculs purs pour les moyennes de la page Statistiques.
// Les champs `tracked*` séparent les nouveaux jets détaillés des anciens
// compteurs, afin de ne jamais présenter une moyenne historique inventée.

const num = (value) => Number(value) || 0;
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));

export function vttLogDateKey(value) {
  let date = null;
  if (value?.toDate instanceof Function) date = value.toDate();
  else if (finite(value?.seconds)) date = new Date(Number(value.seconds) * 1000);
  else if (value instanceof Date) date = value;
  else if (finite(value)) date = new Date(Number(value));
  else if (typeof value === 'string') date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Reconstruit les sommes absentes de l'ancien document `stats/main` à partir du
// journal VTT. Le journal reste la source détaillée ; les compteurs stats restent
// la source du nombre total de jets, critiques et échecs.
export function aggregateVttRollDetails(logs = [], { dateKeys = null, resolveCharacterId = null } = {}) {
  const dates = dateKeys ? new Set(dateKeys) : null;
  const byCharacter = {};
  let relevantLogs = 0;
  const resolve = (log, kind) => resolveCharacterId?.(log, kind)
    || (kind === 'attack' ? log?.sourceCharacterId : log?.characterId)
    || '';
  const entryFor = id => (byCharacter[id] ??= {
    skills: {},
    combat: { attackRolls: 0, attackRollTotal: 0, damageEvents: 0, damageTotal: 0 },
  });

  for (const log of logs || []) {
    if (!log || log.actionUndone) continue;
    if (dates && !dates.has(vttLogDateKey(log.createdAt))) continue;

    if (log.type === 'roll' || log.type === 'craft') {
      const id = resolve(log, 'skill');
      const natural = log.type === 'craft' ? log.d20 : log.rollRaw;
      const total = log.type === 'craft' ? log.total : log.rollResult;
      const skill = String(log.type === 'craft' ? 'Artisanat' : (log.rollSkill || '')).trim();
      if (!id || !skill || !finite(natural) || !finite(total)) continue;
      const target = entryFor(id).skills[skill] ??= {
        trackedRolls: 0, naturalTotal: 0, resultTotal: 0,
      };
      target.trackedRolls += 1;
      target.naturalTotal += Number(natural);
      target.resultTotal += Number(total);
      relevantLogs += 1;
      continue;
    }

    if ((log.type === 'attack' || log.type === 'attack-multi') && !log.isHeal && finite(log.hitD20)) {
      const id = resolve(log, 'attack');
      if (!id) continue;
      const targets = log.type === 'attack-multi'
        ? (Array.isArray(log.targets) ? log.targets : [])
        : [log];
      if (!targets.length) continue;
      const combat = entryFor(id).combat;
      combat.attackRolls += targets.length;
      combat.attackRollTotal += Number(log.hitD20) * targets.length;
      if (!log.shieldCancelled) {
        for (const target of targets) {
          const damage = num(target?.dmgTotal);
          if (damage > 0 && (target?.hit || target?.halfDmg)) {
            combat.damageEvents += 1;
            combat.damageTotal += damage;
          }
        }
      }
      relevantLogs += 1;
    }
  }

  return { byCharacter, relevantLogs };
}

export function mergeTrackedSkillStats(current = {}, fromLog = {}) {
  const logRolls = num(fromLog.trackedRolls);
  const trackedRolls = num(current.rolls) ? Math.min(num(current.rolls), logRolls) : logRolls;
  if (trackedRolls <= num(current.trackedRolls) || !logRolls) return { ...current };
  const ratio = trackedRolls / logRolls;
  return {
    ...current,
    trackedRolls,
    naturalTotal: num(fromLog.naturalTotal) * ratio,
    resultTotal: num(fromLog.resultTotal) * ratio,
  };
}

export function mergeTrackedCombatStats(current = {}, fromLog = {}) {
  const merged = { ...current };
  const logAttackRolls = num(fromLog.attackRolls);
  const attackRolls = num(current.attacks) ? Math.min(num(current.attacks), logAttackRolls) : logAttackRolls;
  if (attackRolls > num(current.attackRolls) && logAttackRolls) {
    merged.attackRolls = attackRolls;
    merged.attackRollTotal = num(fromLog.attackRollTotal) * (attackRolls / logAttackRolls);
  }
  if (num(fromLog.damageEvents) > num(current.damageEvents)) {
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

export function combatAverages(combat = {}) {
  const damageEvents = num(combat.damageEvents);
  const damageTakenEvents = num(combat.damageTakenEvents);
  const attackRolls = num(combat.attackRolls);
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
  };
}
