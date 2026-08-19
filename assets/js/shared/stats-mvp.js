const AXES = {
  // Repères absolus d'une séance active. Ils restent identiques quels que soient
  // les personnages présents : personne ne gagne ou ne perd de points à cause
  // des performances d'un coéquipier ou d'un autre groupe de la mission.
  offense:    { label: 'Offense',             icon: '🗡️', reference: 100 },
  support:    { label: 'Soutien & contrôle',  icon: '✨', reference: 60 },
  protection: { label: 'Protection',          icon: '🛡️', reference: 48 },
  skill:      { label: 'Compétences & RP',    icon: '🎲', reference: 30 },
};

const AXIS_WEIGHTS = [1, 0.20, 0.05, 0];
const AXIS_SOFT_CAPS = [
  { upTo: 100, multiplier: 1 },
  { upTo: 150, multiplier: 0.50 },
  { upTo: 250, multiplier: 0.25 },
  { upTo: 500, multiplier: 0.10 },
  { upTo: Infinity, multiplier: 0.05 },
];
const num = value => Math.max(0, Number(value) || 0);
const rounded = value => Math.round((Number(value) || 0) * 10) / 10;

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function part(label, count, coef, icon) {
  return { label, count, coef, points: count * coef, icon };
}

/**
 * Rendements décroissants d'un axe, sans plafond dur : 100 % jusqu'au repère,
 * puis 50 %, 25 %, 10 % et enfin 5 %. Une spécialisation exceptionnelle reste
 * récompensée, mais un volume extrême ne redevient pas dominant linéairement.
 */
export function scoreMvpAxis(baseIndex = 0) {
  let previous = 0;
  let score = 0;
  const value = num(baseIndex);
  for (const tier of AXIS_SOFT_CAPS) {
    if (value <= previous) break;
    const width = Math.min(value, tier.upTo) - previous;
    score += width * tier.multiplier;
    previous = tier.upTo;
  }
  return rounded(score);
}

/**
 * Profil brut d'un personnage. Chaque événement n'appartient qu'à un axe :
 * les critiques, KO et records restent des distinctions, pas un second paiement
 * des dégâts déjà comptés.
 */
export function buildMvpRawProfile(row = {}) {
  const combat = row.combat || {};
  const damage = num(combat.dmgDealt);
  const heal = num(combat.heal);
  const mana = num(combat.manaHealed);
  // `tacticalSpells` historique inclut aussi les zones offensives. Le MVP ne
  // retient que les catégories qui représentent réellement une aide/entrave.
  const tacticalActions = Math.max(
    num(combat.supportSpells),
    num(combat.afflictionSpells),
    num(combat.controlSpells),
  );
  const attacksTaken = num(combat.attacksTaken);
  const attacksAvoided = Math.min(attacksTaken, num(combat.attacksAvoided));
  const attacksHeld = Math.max(0, attacksTaken - attacksAvoided);
  const damageTaken = num(combat.dmgTaken);
  const skillRolls = num(row.sRolls);

  const axis = (key, parts, evidence) => ({
    key,
    ...AXES[key],
    parts: parts.filter(item => item.count > 0 && item.points > 0),
    raw: parts.reduce((sum, item) => sum + item.points, 0),
    evidence,
  });

  return {
    id: row.id,
    name: row.name || '?',
    axes: {
      offense: axis('offense', [
        part('Dégâts infligés', damage, 1, '🗡️'),
      ], num(combat.attacks)),
      support: axis('support', [
        part('Soin réel produit', heal, 1, '💚'),
        part('PM régénérés', mana, 1, '💙'),
        part('Actions tactiques uniques', tacticalActions, 12, '✨'),
      ], tacticalActions + (heal > 0 ? 1 : 0) + (mana > 0 ? 1 : 0)),
      protection: axis('protection', [
        part('Attaques évitées', attacksAvoided, 12, '🛡️'),
        part('Ciblages tenus', attacksHeld, 3, '🧱'),
        part('Dégâts encaissés', damageTaken, 0.12, '🩸'),
      ], attacksTaken),
      skill: axis('skill', [
        part('Jets de compétence', skillRolls, 5, '🎲'),
      ], skillRolls),
    },
  };
}

function confidenceForSession(entries) {
  const primaryEvidence = entries[0]?.evidence || 0;
  if (primaryEvidence >= 3) return { level: 'high', label: 'Fiable', reason: 'activité suffisante sur l’axe principal' };
  if (primaryEvidence >= 1) return { level: 'medium', label: 'À confirmer', reason: 'peu d’actions sur l’axe principal' };
  return { level: 'low', label: 'Fragile', reason: 'données insuffisantes' };
}

function weightEntries(entries) {
  const sorted = [...entries].sort((a, b) => (b.normalized - a.normalized) || a.key.localeCompare(b.key));
  sorted.forEach((entry, index) => {
    entry.axisRank = index + 1;
    entry.dampener = AXIS_WEIGHTS[index] ?? 0;
    entry.points = rounded(entry.normalized * entry.dampener);
  });
  return sorted;
}

/** Score V2 absolu d'une séance, indépendant des autres participants. */
export function scoreMvpSession(rows = []) {
  const profiles = rows.map(buildMvpRawProfile);

  return profiles.map(profile => {
    const entries = weightEntries(Object.values(profile.axes).map(axis => {
      const baseNormalized = rounded(axis.raw / axis.reference * 100);
      return {
        ...axis,
        children: axis.parts,
        baseNormalized,
        normalized: scoreMvpAxis(baseNormalized),
      };
    }));
    const score = Math.round(entries.reduce((sum, entry) => sum + entry.points, 0));
    return {
      id: profile.id,
      name: profile.name,
      score,
      eligible: score > 0,
      details: {
        mode: 'session',
        score,
        gained: rounded(entries.reduce((sum, entry) => sum + entry.points, 0)),
        lost: 0,
        entries,
        sessionCount: 1,
        confidence: confidenceForSession(entries),
      },
    };
  }).filter(result => result.score > 0)
    .sort((a, b) => (b.score - a.score) || String(a.name).localeCompare(String(b.name), 'fr'));
}

function mergeCampaignChildren(entries = []) {
  const byLabel = new Map();
  for (const entry of entries) {
    for (const child of entry.children || entry.parts || []) {
      const current = byLabel.get(child.label) || { ...child, count: 0, points: 0 };
      current.count += num(child.count);
      current.points += num(child.points);
      byLabel.set(child.label, current);
    }
  }
  return [...byLabel.values()];
}

/**
 * Classement multi-séances : médiane de chaque axe normalisé. Le nombre de
 * séances jouées ne gonfle donc plus le score de campagne.
 */
export function scoreMvpCampaign(sessionRows = []) {
  const sessions = sessionRows
    .map(session => ({ ...session, scores: scoreMvpSession(session.rows || []) }))
    .filter(session => session.scores.length > 0);
  const byCharacter = new Map();

  for (const session of sessions) {
    for (const result of session.scores) {
      const current = byCharacter.get(result.id) || { id: result.id, name: result.name, sessions: [] };
      current.sessions.push({ date: session.date || '', details: result.details });
      byCharacter.set(result.id, current);
    }
  }

  const minimumSessions = sessions.length >= 2 ? 2 : 1;
  const results = [...byCharacter.values()].map(character => {
    const sessionCount = character.sessions.length;
    const entries = weightEntries(Object.keys(AXES).map(key => {
      const axisEntries = character.sessions
        .map(session => session.details.entries.find(entry => entry.key === key))
        .filter(Boolean);
      return {
        key,
        ...AXES[key],
        raw: rounded(median(axisEntries.map(entry => entry.raw))),
        reference: rounded(median(axisEntries.map(entry => entry.reference))),
        baseNormalized: rounded(median(axisEntries.map(entry => entry.baseNormalized))),
        normalized: rounded(median(axisEntries.map(entry => entry.normalized))),
        evidence: axisEntries.reduce((sum, entry) => sum + num(entry.evidence), 0),
        children: mergeCampaignChildren(axisEntries),
      };
    }));
    const score = Math.round(entries.reduce((sum, entry) => sum + entry.points, 0));
    const confidence = sessionCount >= 3
      ? { level: 'high', label: 'Fiable', reason: `${sessionCount} séances comparables` }
      : sessionCount >= 2
        ? { level: 'medium', label: 'À confirmer', reason: `${sessionCount} séances comparables` }
        : { level: 'low', label: 'Provisoire', reason: 'une seule séance disponible' };
    return {
      id: character.id,
      name: character.name,
      score,
      eligible: sessionCount >= minimumSessions,
      details: {
        mode: 'campaign',
        score,
        gained: rounded(entries.reduce((sum, entry) => sum + entry.points, 0)),
        lost: 0,
        entries,
        sessionCount,
        minimumSessions,
        confidence,
      },
    };
  });

  // Les profils trop récents restent consultables, mais ne passent jamais devant
  // un candidat disposant du minimum de séances comparable.
  return results.filter(result => result.score > 0).sort((a, b) =>
    (Number(b.eligible) - Number(a.eligible))
    || (b.score - a.score)
    || String(a.name).localeCompare(String(b.name), 'fr'));
}

/**
 * Calcule le MVP sur tout le périmètre statistique, puis limite uniquement les
 * résultats affichés. Les scores absolus resteraient identiques avec un autre
 * groupe, mais conserver cette séparation évite aussi tout futur effet de filtre.
 */
export function scoreMvpView({ rows = [], sessionRows = [], visibleIds = null } = {}) {
  const scores = sessionRows.length ? scoreMvpCampaign(sessionRows) : scoreMvpSession(rows);
  if (!visibleIds?.size) return scores;
  return scores.filter(result => visibleIds.has(result.id));
}
