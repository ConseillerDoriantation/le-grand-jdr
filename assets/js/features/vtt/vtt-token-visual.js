// Métadonnées visuelles pures des tokens VTT.
// Ce module ne dépend ni de Konva, ni du DOM, ni de Firestore : il peut donc
// alimenter à la fois le canvas, l'infobulle et les tests sans dupliquer les
// règles de présentation.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const NEGATIVE_BUFFS = new Set(['dot', 'move_debuff', 'affliction']);
const NEUTRAL_BUFFS = new Set(['suspended_spell']);

export const TOKEN_BUFF_VIZ = Object.freeze({
  dot:             { icon: '🩸', color: '#dc2626', label: 'Dégâts par tour' },
  regen:           { icon: '💚', color: '#22c55e', label: 'Régénération' },
  dmg_bonus:       { icon: '⚔️', color: '#f59e0b', label: 'Bonus de dégâts' },
  move_bonus:      { icon: '👢', color: '#22c55e', label: 'Déplacement augmenté' },
  move_debuff:     { icon: '👢', color: '#9a3412', label: 'Déplacement réduit' },
  range_bonus:     { icon: '🏹', color: '#0ea5e9', label: 'Portée augmentée' },
  toucher_bonus:   { icon: '🎯', color: '#e8b84b', label: 'Bonus au toucher' },
  ca:              { icon: '🛡', color: '#06b6d4', label: 'Bonus de CA' },
  shield_reactive: { icon: '🛡', color: '#a78bfa', label: 'Bouclier réactif' },
  enchantment:     { icon: '✨', color: '#e8b84b', label: 'Enchantement' },
  affliction:      { icon: '💀', color: '#8b5cf6', label: 'Affliction' },
  weapon_replace:  { icon: '🔮', color: '#a78bfa', label: 'Arme invoquée' },
  suspended_spell: { icon: '⏸', color: '#818cf8', label: 'Sort suspendu' },
  lucky_reroll:    { icon: '🍀', color: '#84cc16', label: 'Relance chanceuse' },
});

export function tokenHealthMeta(hp, hpMax) {
  const current = Number(hp);
  const maximum = Number(hpMax);
  const known = hp !== null && hp !== undefined && hpMax !== null && hpMax !== undefined
    && Number.isFinite(current) && Number.isFinite(maximum);
  if (!known) {
    return { known: false, current: null, maximum: null, ratio: 0.5, label: 'Inconnu', tone: 'unknown', color: '#64748b', isDown: false };
  }
  const ratio = maximum > 0 ? clamp(current / maximum, 0, 1) : (current > 0 ? 1 : 0);
  if (current <= 0) return { known: true, current, maximum, ratio: 0, label: 'À terre', tone: 'down', color: '#ef4444', isDown: true };
  if (ratio <= 0.25) return { known: true, current, maximum, ratio, label: 'Critique', tone: 'critical', color: '#ef4444', isDown: false };
  if (ratio <= 0.5) return { known: true, current, maximum, ratio, label: 'Blessé', tone: 'wounded', color: '#f59e0b', isDown: false };
  if (ratio <= 0.75) return { known: true, current, maximum, ratio, label: 'Entamé', tone: 'hurt', color: '#a3e635', isDown: false };
  return { known: true, current, maximum, ratio, label: 'En forme', tone: 'healthy', color: '#22c38e', isDown: false };
}

export function tokenDetailLevel(scale = 1) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value >= 0.82) return 'detailed';
  if (value >= 0.58) return 'standard';
  return 'compact';
}

export function tokenRelationTone(source, target, friendlyAction = false) {
  if (friendlyAction) return 'friendly';
  if (!source || !target) return 'selected';
  const sourceFriendly = source.type === 'player' || source.type === 'npc';
  const targetFriendly = target.type === 'player' || target.type === 'npc';
  return sourceFriendly === targetFriendly ? 'friendly' : 'hostile';
}

/** Métadonnées d'empreinte tactique, indépendantes du portrait rond. */
export function tokenFootprintMeta(width = 1, height = 1) {
  const w = Math.max(1, Math.min(5, parseInt(width) || 1));
  const h = Math.max(1, Math.min(5, parseInt(height) || 1));
  return {
    width: w,
    height: h,
    isLarge: w > 1 || h > 1,
    label: `${w}×${h}`,
  };
}

export function tokenDeltaMeta(delta, resource = 'hp') {
  const value=Number(delta);
  if (!Number.isFinite(value) || value===0) return null;
  const mana=resource==='pm';
  const positive=value>0;
  return {
    value,
    resource:mana?'pm':'hp',
    label:`${positive?'+':'−'}${Math.abs(Math.round(value))} ${mana?'PM':'PV'}`,
    color:mana?(positive?'#67e8f9':'#a78bfa'):(positive?'#4ade80':'#fb7185'),
  };
}

export function tokenMovementMeta(baseMovement = 6, bonusMovement = 0, movedCells = 0) {
  const finiteOrZero = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const maximum = Math.max(0, finiteOrZero(baseMovement) + finiteOrZero(bonusMovement));
  const used = Math.max(0, finiteOrZero(movedCells));
  const remaining = Math.max(0, maximum - used);
  return { maximum, used, remaining, exhausted: maximum > 0 && remaining === 0 };
}

export function normalizeTokenTurnOrder(storedOrder = [], tokens = [], getName = token => token?.name || token?.id || '') {
  const usable = tokens.filter(token => token?.id);
  const validIds = new Set(usable.map(token => token.id));
  const seen = new Set();
  const order = [];
  for (const id of storedOrder || []) {
    if (!validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const typeRank = { player: 0, npc: 1, enemy: 2 };
  const missing = usable.filter(token => !seen.has(token.id)).sort((a, b) => {
    const type = (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9);
    if (type) return type;
    const name = String(getName(a)).localeCompare(String(getName(b)));
    return name || String(a.id).localeCompare(String(b.id));
  });
  return [...order, ...missing.map(token => token.id)];
}

function turnsLeft(effect, round) {
  if (effect?.expiresAtRound == null || round <= 0) return null;
  return Math.max(0, Number(effect.expiresAtRound) - round + 1);
}

export function tokenActiveEffects(token = {}, conditionById = {}, round = 0) {
  const active = effect => effect?.expiresAtRound == null || round === 0 || round <= effect.expiresAtRound;
  const conditions = (token.conditions || []).filter(active).map(condition => {
    const meta = conditionById[condition.id] || {};
    return {
      kind: 'condition',
      key: condition.id || 'condition',
      icon: meta.icon || condition.icon || '⛓',
      color: meta.color || condition.color || '#64748b',
      label: meta.label || condition.label || condition.id || 'État',
      tone: meta.beneficial || condition.beneficial ? 'positive' : 'negative',
      turnsLeft: turnsLeft(condition, round),
    };
  });
  const buffs = (token.buffs || []).filter(active).map(buff => {
    const meta = TOKEN_BUFF_VIZ[buff.type] || {};
    return {
      kind: 'buff',
      key: buff.type || buff.sortLabel || 'buff',
      icon: meta.icon || buff.icon || '✨',
      color: meta.color || buff.color || '#9ca3af',
      label: meta.label || buff.sortLabel || 'Effet',
      source: buff.sortLabel && meta.label ? buff.sortLabel : '',
      tone: NEGATIVE_BUFFS.has(buff.type) ? 'negative' : (NEUTRAL_BUFFS.has(buff.type) ? 'neutral' : 'positive'),
      turnsLeft: turnsLeft(buff, round),
    };
  });
  return [...conditions, ...buffs];
}

export function tokenEffectsSignature(effects = []) {
  return effects.map(effect => [effect.kind, effect.key, effect.icon, effect.color, effect.tone, effect.turnsLeft ?? '∞'].join(':')).join('|');
}
