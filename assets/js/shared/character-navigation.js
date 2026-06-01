let _targetCharId = null;

export function setTargetCharacter(id) {
  _targetCharId = id || null;
}

export function consumeTargetCharacter() {
  const id = _targetCharId;
  _targetCharId = null;
  return id;
}
