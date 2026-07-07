const _targets = new Map();

export function setTargetEntity(kind, id, meta = {}) {
  if (!kind) return;
  if (!id) {
    _targets.delete(kind);
    return;
  }
  _targets.set(kind, { id, meta: meta || {} });
}

export function consumeTargetEntity(kind) {
  const target = _targets.get(kind) || null;
  _targets.delete(kind);
  return target;
}
