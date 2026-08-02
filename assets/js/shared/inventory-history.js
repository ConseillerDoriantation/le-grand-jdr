const INVENTORY_HISTORY_MAX = 100;

const TYPE_META = {
  add:     { label: 'Ajouté',    icon: '+',  tone: 'good' },
  receive: { label: 'Reçu',      icon: '<',  tone: 'good' },
  send:    { label: 'Envoyé',    icon: '>',  tone: 'info' },
  sell:    { label: 'Vendu',     icon: '$',  tone: 'gold' },
  delete:  { label: 'Supprimé',  icon: 'x',  tone: 'bad' },
  consume: { label: 'Consommé',  icon: '*',  tone: 'warn' },
};

function _cleanText(value = '', max = 90) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function _safeImage(item = {}) {
  const value = _cleanText(item.imageUrl || item.illustration || item.image || item.img || '', 260);
  if (!value || /^data:/i.test(value)) return '';
  return value;
}

function _actorName(opts = {}) {
  return _cleanText(opts.actorName || opts.by || opts.userName || '', 60);
}

export function inventoryHistoryTypeMeta(type) {
  return TYPE_META[type] || { label: 'Mouvement', icon: '-', tone: 'info' };
}

export function inventoryHistoryEntries(history) {
  return Array.isArray(history) ? history.filter(Boolean) : [];
}

export function makeInventoryHistoryEntry(type, item = {}, qty = 1, opts = {}) {
  const now = Number.isFinite(opts.at) ? opts.at : Date.now();
  const meta = inventoryHistoryTypeMeta(type);
  return {
    id: _cleanText(opts.id || `${now}_${type}_${Math.random().toString(36).slice(2, 8)}`, 50),
    type: TYPE_META[type] ? type : 'add',
    label: meta.label,
    itemId: _cleanText(item.itemId || item.id || opts.itemId || '', 80),
    name: _cleanText(item.nom || item.name || opts.name || 'Objet', 90),
    icon: _cleanText(item.icon || opts.icon || '', 12),
    image: _safeImage(item),
    qty: Math.max(1, parseInt(qty, 10) || 1),
    at: now,
    source: _cleanText(opts.source || '', 60),
    actorUid: _cleanText(opts.actorUid || '', 80),
    actorName: _actorName(opts),
    targetName: _cleanText(opts.targetName || '', 60),
    note: _cleanText(opts.note || '', 120),
  };
}

export function appendInventoryHistory(currentHistory, entries = []) {
  const nextEntries = (Array.isArray(entries) ? entries : [entries])
    .filter(Boolean)
    .map(entry => makeInventoryHistoryEntry(entry.type, entry, entry.qty, entry));
  if (!nextEntries.length) return inventoryHistoryEntries(currentHistory).slice(0, INVENTORY_HISTORY_MAX);
  return [
    ...nextEntries,
    ...inventoryHistoryEntries(currentHistory),
  ].slice(0, INVENTORY_HISTORY_MAX);
}

export function inventoryHistoryPayload(character, entries = []) {
  return {
    inventoryHistory: appendInventoryHistory(character?.inventoryHistory, entries),
  };
}
