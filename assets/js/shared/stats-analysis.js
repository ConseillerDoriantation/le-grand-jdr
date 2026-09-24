// Calculs purs pour les moyennes de la page Statistiques.
// Les champs `tracked*` séparent les nouveaux jets détaillés des anciens
// compteurs, afin de ne jamais présenter une moyenne historique inventée.

const num = (value) => Number(value) || 0;
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));

export function appliedDamageAmount({ beforeHp = null, afterHp = null, rolledDamage = 0, cancelled = false } = {}) {
  if (cancelled) return 0;
  const rolled = Math.max(0, num(rolledDamage));
  if (finite(beforeHp) && finite(afterHp)) {
    const hpLoss = Math.max(0, Number(beforeHp) - Number(afterHp));
    // Un snapshot de PV peut inclure une autre écriture concurrente. Un impact
    // ne peut cependant jamais recevoir plus que les dégâts résolus pour lui.
    return Math.min(hpLoss, rolled);
  }
  return rolled;
}

const validNaturalAggregate = (total, count) => {
  const rolls = Math.max(0, num(count));
  const sum = num(total);
  return rolls === 0 ? sum === 0 : sum >= rolls && sum <= rolls * 20;
};

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

const _COMBAT_ACTION_TYPES = new Set(['attack', 'attack-multi', 'cast', 'affliction-cast']);
const _actionFamily = type => String(type || '').startsWith('attack') ? 'attack' : 'cast';
const _actionLabel = log => String(log?.optLabel || log?.spellName || '').trim().toLocaleLowerCase('fr-FR');

function _sameHistoricalCombatAction(candidate, cluster) {
  const candidateTime = vttLogTimeMs(candidate.log?.createdAt);
  const clusterTime = cluster.lastTime;
  if (candidateTime == null || clusterTime == null) return false;
  const elapsed = Math.abs(candidateTime - clusterTime);
  const label = _actionLabel(candidate.log);
  if (!label || label !== cluster.label) return false;

  const family = _actionFamily(candidate.log?.type);
  // Un sort offensif / une affliction peut publier une annonce de cast puis sa
  // résolution d'attaque. Une famille ne peut apparaître qu'une fois dans ce
  // rapprochement : deux attaques successives restent donc deux actions.
  if (!cluster.families.has(family) && elapsed <= 45_000) return true;

  // Très anciennes AoE : une même résolution pouvait être publiée une fois par
  // cible sous forme d'attaques simples. Même d20 + même total dans une fenêtre
  // très courte identifient ces lignes comme une seule action.
  if (family !== 'attack' || elapsed > 2_500) return false;
  const previous = cluster.lastLog;
  return _actionFamily(previous?.type) === 'attack'
    && finite(candidate.log?.hitD20) && Number(candidate.log.hitD20) === Number(previous.hitD20)
    && (!finite(candidate.log?.hitTotal) || !finite(previous.hitTotal)
      || Number(candidate.log.hitTotal) === Number(previous.hitTotal));
}

function _canonicalCombatActionCounts(candidates = []) {
  const counts = new Map();
  const byCharacter = new Map();
  for (const candidate of candidates) {
    const list = byCharacter.get(candidate.id) || [];
    list.push(candidate);
    byCharacter.set(candidate.id, list);
  }

  for (const [id, entries] of byCharacter) {
    const explicitIds = new Set();
    const historical = [];
    for (const entry of entries) {
      const actionId = String(entry.log?.statsActionId || '').trim();
      if (actionId) explicitIds.add(actionId);
      else historical.push(entry);
    }

    const clusters = [];
    historical
      .sort((a, b) => (vttLogTimeMs(a.log?.createdAt) ?? 0) - (vttLogTimeMs(b.log?.createdAt) ?? 0))
      .forEach(candidate => {
        const family = _actionFamily(candidate.log?.type);
        const matching = [...clusters].reverse().find(cluster => _sameHistoricalCombatAction(candidate, cluster));
        if (matching) {
          matching.families.add(family);
          matching.lastTime = vttLogTimeMs(candidate.log?.createdAt);
          matching.lastLog = candidate.log;
          return;
        }
        clusters.push({
          label: _actionLabel(candidate.log),
          families: new Set([family]),
          lastTime: vttLogTimeMs(candidate.log?.createdAt),
          lastLog: candidate.log,
        });
      });
    counts.set(id, explicitIds.size + clusters.length);
  }
  return counts;
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
  // `dateKeys` accepte désormais aussi les identifiants de séance VTT. Les
  // anciens logs sans identifiant continuent d'être filtrés par YYYY-MM-DD.
  const sessions = dateKeys ? new Set(dateKeys) : null;
  const byCharacter = {};
  const combatActionCandidates = [];
  let relevantLogs = 0;
  const resolve = (log, kind) => resolveCharacterId?.(log, kind)
    || (kind === 'attack' ? log?.sourceCharacterId : log?.characterId)
    || '';
  const entryFor = id => (byCharacter[id] ??= {
    skills: {},
    combat: {
      canonicalActions: 0,
      attackActions: 0, hits: 0, crits: 0, fumbles: 0,
      attackRolls: 0, attackRollTotal: 0,
      attackResultRolls: 0, attackResultTotal: 0,
      supplementalRolls: 0, supplementalNaturalTotal: 0,
      supplementalResultRolls: 0, supplementalResultTotal: 0,
      supplementalCrits: 0, supplementalFumbles: 0,
      damageEvents: 0, damageTotal: 0, biggestHit: 0,
    },
  });

  for (const log of logs || []) {
    if (!log || log.actionUndone || log.statsExcluded === true) continue;
    const logDate = vttLogDateKey(log.createdAt);
    const logSessionKey = log.statsSessionKey || logDate;
    if (sessions && !sessions.has(logSessionKey)) continue;

    // Les entrées principales sont corrélées après lecture du journal : certains
    // sorts ont historiquement publié un cast puis une attaque pour la même action.
    if (_COMBAT_ACTION_TYPES.has(log.type)) {
      const id = resolve(log, 'attack');
      if (id && !isCharacterLogExcluded?.(id, logSessionKey, log)) combatActionCandidates.push({ id, log });
    }

    if (log.type === 'roll' || log.type === 'craft') {
      const id = resolve(log, 'skill');
      if (id && isCharacterLogExcluded?.(id, logSessionKey, log)) continue;
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

    // Les soins utilisent eux aussi un d20 (critique = soin renforcé, échec
    // critique = sort raté). Ils ne doivent pas devenir des « attaques » dans
    // le taux de touche, mais comptent bien dans les temps forts critiques.
    if ((log.type === 'attack' || log.type === 'attack-multi') && log.isHeal && finite(log.hitD20)) {
      const id = resolve(log, 'attack');
      if (!id || isCharacterLogExcluded?.(id, logSessionKey, log)) continue;
      const combat = entryFor(id).combat;
      combat.supplementalRolls += 1;
      combat.supplementalNaturalTotal += Number(log.hitD20);
      if (finite(log.hitTotal)) {
        combat.supplementalResultRolls += 1;
        combat.supplementalResultTotal += Number(log.hitTotal);
      }
      combat.supplementalCrits += log.isCrit === true || (log.isCrit == null && Number(log.hitD20) === 20) ? 1 : 0;
      combat.supplementalFumbles += log.isFumble === true || (log.isFumble == null && Number(log.hitD20) === 1) ? 1 : 0;
      relevantLogs += 1;
      continue;
    }

    // Les enchantements lancent un d20 sans passer par la branche attaque. Les
    // nouveaux logs portent des champs structurés ; les anciens restent lisibles
    // via leur libellé « 🎲 N 💥 RC » ou le marqueur castEC.
    if (log.type === 'cast') {
      const legacyMatch = String(log.castEffect || '').match(/^🎲\s*(\d+)/u);
      const castNatural = finite(log.castD20)
        ? Number(log.castD20)
        : legacyMatch ? Number(legacyMatch[1]) : (log.castEC === true ? 1 : null);
      if (castNatural != null) {
        const id = resolve(log, 'attack');
        if (!id || isCharacterLogExcluded?.(id, logSessionKey, log)) continue;
        const combat = entryFor(id).combat;
        combat.supplementalRolls += 1;
        combat.supplementalNaturalTotal += castNatural;
        combat.supplementalCrits += log.castIsCrit === true || (log.castIsCrit == null && castNatural === 20) || /💥\s*RC/u.test(String(log.castEffect || '')) ? 1 : 0;
        combat.supplementalFumbles += log.castIsFumble === true || log.castEC === true ? 1 : 0;
        relevantLogs += 1;
        continue;
      }
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
      const combat = id && !isCharacterLogExcluded?.(id, logSessionKey, log) ? entryFor(id).combat : null;
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
        const rolledDamage = Math.max(0, num(target?.dmgTotal));
        const appliedDamage = log.shieldCancelled
          ? 0
          : finite(target?.dmgApplied)
            ? Math.min(Math.max(0, num(target.dmgApplied)), rolledDamage)
            : appliedDamageAmount({ beforeHp, afterHp, rolledDamage });
        actionDamage += appliedDamage;
        actionDamageEvents += appliedDamage > 0 ? 1 : 0;
        if (!targetId) continue;
        if (isCharacterLogExcluded?.(targetId, logSessionKey, log)) continue;
        const current = actualTakenByCharacter.get(targetId) || { damage: 0, events: 0 };
        current.damage += appliedDamage;
        current.events += appliedDamage > 0 ? 1 : 0;
        actualTakenByCharacter.set(targetId, current);
      }
      for (const [targetId, actual] of actualTakenByCharacter) {
        if (hasManualCombatCorrection?.(targetId, logSessionKey, 'taken')) continue;
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
        combat.biggestHit = Math.max(combat.biggestHit, ...targets.map(target => {
          if (log.shieldCancelled) return 0;
          if (finite(target?.dmgApplied)) return Math.min(Math.max(0, num(target.dmgApplied)), Math.max(0, num(target?.dmgTotal)));
          const tokenId = target?.tokenId || (log.type === 'attack' ? log.defenderTokenId : null);
          return appliedDamageAmount({
            beforeHp: tokenId ? log.undo?.tokens?.[tokenId]?.hp : null,
            afterHp: target?.newHp,
            rolledDamage: target?.dmgTotal,
          });
        }));
        const storedAttacker = log.statsDelta?.chars?.[id]?.combat || {};
        const dealtCorrections = (combat.dealtOvercounts ??= {});
        const recordedDealt = num(storedAttacker.dmgDealt);
        const recordedDamageTotal = num(storedAttacker.damageTotal);
        const recordedDamageEvents = num(storedAttacker.damageEvents);
        const manualDamageDealt = !!hasManualCombatCorrection?.(id, logSessionKey, 'dealt');
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

  for (const [id, count] of _canonicalCombatActionCounts(combatActionCandidates)) {
    entryFor(id).combat.canonicalActions = count;
  }

  return { byCharacter, relevantLogs };
}

export function mergeTrackedSkillStats(current = {}, fromLog = {}) {
  const logRolls = num(fromLog.trackedRolls);
  const trackedRolls = num(current.rolls) ? Math.min(num(current.rolls), logRolls) : logRolls;
  const merged = { ...current };
  const currentTrackedRolls = Math.min(num(current.rolls) || num(current.trackedRolls), num(current.trackedRolls));
  const currentNaturalValid = validNaturalAggregate(current.naturalTotal, currentTrackedRolls);
  if (logRolls && (trackedRolls >= currentTrackedRolls || !currentNaturalValid)) {
    const ratio = trackedRolls / logRolls;
    merged.trackedRolls = trackedRolls;
    merged.naturalTotal = num(fromLog.naturalTotal) * ratio;
    merged.resultTotal = num(fromLog.resultTotal) * ratio;
  } else if (!currentNaturalValid) {
    merged.trackedRolls = 0;
    merged.naturalTotal = 0;
    merged.resultTotal = 0;
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
  const currentAttackRolls = Math.min(num(merged.attacks) || num(merged.attackRolls), num(merged.attackRolls));
  const currentAttackNaturalValid = validNaturalAggregate(merged.attackRollTotal, currentAttackRolls);
  if (logAttackRolls && (attackRolls >= currentAttackRolls || !currentAttackNaturalValid)) {
    merged.attackRolls = attackRolls;
    merged.attackRollTotal = num(fromLog.attackRollTotal) * (attackRolls / logAttackRolls);
  } else if (!currentAttackNaturalValid) {
    merged.attackRolls = 0;
    merged.attackRollTotal = 0;
  }
  const logResultRolls = num(fromLog.attackResultRolls);
  const attackResultRolls = num(merged.attacks) ? Math.min(num(merged.attacks), logResultRolls) : logResultRolls;
  if (logResultRolls && (attackResultRolls >= num(merged.attackResultRolls) || !currentAttackNaturalValid)) {
    merged.attackResultRolls = attackResultRolls;
    merged.attackResultTotal = num(fromLog.attackResultTotal) * (attackResultRolls / logResultRolls);
  } else if (!currentAttackNaturalValid) {
    merged.attackResultRolls = 0;
    merged.attackResultTotal = 0;
  }
  if (!fromLog.manualDamageDealt && num(fromLog.damageEvents) > num(current.damageEvents)) {
    merged.damageEvents = num(fromLog.damageEvents);
    merged.damageTotal = num(fromLog.damageTotal);
  }
  // Le journal complet est la preuve action par action. Il doit remplacer les
  // anciens records campagne parfois calculés sur une AoE ou un snapshot de PV.
  merged.biggestHit = num(fromLog.damageEvents) > 0
    ? num(fromLog.biggestHit)
    : num(current.biggestHit);
  const logSupplementalRolls = num(fromLog.supplementalRolls);
  const currentSupplementalRolls = num(current.supplementalRolls);
  const currentSupplementalValid = validNaturalAggregate(current.supplementalNaturalTotal, currentSupplementalRolls);
  if (logSupplementalRolls && (logSupplementalRolls >= currentSupplementalRolls || !currentSupplementalValid)) {
    for (const field of [
      'supplementalRolls', 'supplementalNaturalTotal',
      'supplementalResultRolls', 'supplementalResultTotal',
      'supplementalCrits', 'supplementalFumbles',
    ]) merged[field] = num(fromLog[field]);
  } else if (!currentSupplementalValid) {
    for (const field of [
      'supplementalRolls', 'supplementalNaturalTotal',
      'supplementalResultRolls', 'supplementalResultTotal',
      'supplementalCrits', 'supplementalFumbles',
    ]) merged[field] = 0;
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
  const rawTrackedRolls = Math.min(rolls, Math.max(0, num(value.trackedRolls)));
  const detailValid = validNaturalAggregate(value.naturalTotal, rawTrackedRolls);
  const trackedRolls = detailValid ? rawTrackedRolls : 0;
  const crits = num(value.crits);
  const fumbles = num(value.fumbles);
  return {
    sk: name,
    rolls,
    trackedRolls,
    crits,
    fumbles,
    naturalTotal: detailValid ? num(value.naturalTotal) : 0,
    resultTotal: detailValid ? num(value.resultTotal) : 0,
    naturalAvg: detailValid ? statsAverage(value.naturalTotal, trackedRolls) : null,
    resultAvg: detailValid ? statsAverage(value.resultTotal, trackedRolls) : null,
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
export function aggregateActionAverages(skills = {}, combat = {}, supplemental = {}) {
  const skillRolls = num(skills.rolls);
  const combatRolls = num(combat.attacks);
  const supplementalRolls = num(supplemental.rolls);
  const rolls = skillRolls + combatRolls + supplementalRolls;
  const skillTrackedRolls = Math.min(skillRolls, num(skills.trackedRolls));
  const combatTrackedRolls = Math.min(combatRolls, num(combat.attackRolls));
  const combatResultRolls = Math.min(combatRolls, num(combat.attackResultRolls));
  const supplementalTrackedRolls = Math.min(supplementalRolls, num(supplemental.trackedRolls ?? supplementalRolls));
  const supplementalResultRolls = Math.min(supplementalRolls, num(supplemental.resultRolls));
  const trackedRolls = skillTrackedRolls + combatTrackedRolls + supplementalTrackedRolls;
  const resultTrackedRolls = skillTrackedRolls + combatResultRolls + supplementalResultRolls;
  const naturalTotal = num(skills.naturalTotal) + num(combat.attackRollTotal) + num(supplemental.naturalTotal);
  const resultTotal = num(skills.resultTotal) + num(combat.attackResultTotal) + num(supplemental.resultTotal);
  const crits = num(skills.crits) + num(combat.crits) + num(supplemental.crits);
  const fumbles = num(skills.fumbles) + num(combat.fumbles) + num(supplemental.fumbles);

  return {
    rolls,
    skillRolls,
    combatRolls,
    supplementalRolls,
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

// Renvoie tous les premiers ex æquo d'une métrique positive. Centraliser ce
// choix évite que les cartes « Temps forts » retombent silencieusement sur le
// premier personnage après un simple sort().
export function topStatTies(rows = [], valueOf = () => 0, { minimum = 0 } = {}) {
  const scored = (rows || []).map(row => ({ row, value: num(valueOf(row)) }))
    .filter(entry => entry.value > minimum);
  const value = Math.max(0, ...scored.map(entry => entry.value));
  return {
    value,
    winners: value > minimum ? scored.filter(entry => entry.value === value).map(entry => entry.row) : [],
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
