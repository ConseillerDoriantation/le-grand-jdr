let _targetChar = null;

export function setTargetCharacter(id, tab = null) {
  _targetChar = id ? { id, tab: tab || null } : null;
}

export function consumeTargetCharacter() {
  const target = _targetChar;
  _targetChar = null;
  return target;
}
