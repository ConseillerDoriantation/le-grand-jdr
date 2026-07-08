import { consumeTargetEntity, setTargetEntity } from './entity-navigation.js';

let _targetChar = null;

export function setTargetCharacter(id, tab = null) {
  _targetChar = id ? { id, tab: tab || null } : null;
  setTargetEntity('char', id, { tab: tab || null });
}

export function consumeTargetCharacter() {
  const genericTarget = consumeTargetEntity('char');
  const target = _targetChar || normalizeEntityTarget(genericTarget);
  _targetChar = null;
  return target;
}

function normalizeEntityTarget(target) {
  if (!target?.id) return null;
  return { id: target.id, tab: target.meta?.tab || target.meta?.mode || null };
}
