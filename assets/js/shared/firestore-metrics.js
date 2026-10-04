// Diagnostic local des accès Firestore. Aucun compteur n'est envoyé en base :
// l'outil sert uniquement à repérer, pendant une session, une collection qui
// relit ou réécrit anormalement beaucoup de documents.

const _startedAt = Date.now();
const _totals = { reads: 0, writes: 0, cacheReads: 0, initialListenerReads: 0, listenerSnapshots: 0 };
const _paths = new Map();
let _lastBurstWarningAt = 0;
const _recent = [];

function _bucket(path = 'inconnu') {
  const key = String(path || 'inconnu');
  if (!_paths.has(key)) _paths.set(key, { reads: 0, writes: 0, cacheReads: 0, initialReads: 0, snapshots: 0 });
  return _paths.get(key);
}

function _remember(kind, path, count) {
  const now = Date.now();
  _recent.push({ kind, path, count, at: now });
  while (_recent.length && _recent[0].at < now - 60_000) _recent.shift();
  const lastMinute = _recent.reduce((sum, entry) => sum + entry.count, 0);
  if (lastMinute >= 500 && now - _lastBurstWarningAt > 60_000) {
    _lastBurstWarningAt = now;
    console.warn(`[firebase] activité élevée : ~${lastMinute} opérations observées sur la dernière minute.`, firestoreMetricsSnapshot());
  }
}

export function recordFirestoreRead(path, count = 1, { cache = false, listener = false, initial = false } = {}) {
  const safeCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (!safeCount) return;
  const bucket = _bucket(path);
  if (cache) {
    _totals.cacheReads += safeCount;
    bucket.cacheReads += safeCount;
    return;
  }
  _totals.reads += safeCount;
  bucket.reads += safeCount;
  if (listener) {
    _totals.listenerSnapshots += 1;
    bucket.snapshots += 1;
  }
  if (initial) {
    _totals.initialListenerReads += safeCount;
    bucket.initialReads += safeCount;
  } else {
    // Le premier remplissage serveur d'un listener peut légitimement charger
    // plusieurs centaines de documents à l'entrée du VTT. Il reste comptabilisé
    // dans `reads`, mais ne doit pas être diagnostiqué comme une boucle active.
    _remember('read', path, safeCount);
  }
}

export function recordFirestoreWrite(path, count = 1) {
  const safeCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (!safeCount) return;
  _totals.writes += safeCount;
  _bucket(path).writes += safeCount;
  _remember('write', path, safeCount);
}

// Nom de la collection d'un chemin Firestore (segments alternés collection/doc) :
// 'adventures/a/vttTokens/t1' → 'vttTokens', 'adventures/a/vttTokens' → 'vttTokens'.
export function metricCollectionName(path = '') {
  const segments = String(path || '').split('/').filter(Boolean);
  if (!segments.length) return 'inconnu';
  return segments[segments.length % 2 === 0 ? segments.length - 2 : segments.length - 1];
}

export function firestoreMetricsSnapshot() {
  const byPath = [..._paths.entries()]
    .map(([path, values]) => ({ path, ...values, total: values.reads + values.writes }))
    .sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));
  // Vue agrégée : les écritures sont ventilées par document (1 ligne/token…),
  // ce regroupement montre directement quelle collection consomme le quota.
  const collections = new Map();
  for (const row of byPath) {
    const name = metricCollectionName(row.path);
    const acc = collections.get(name) || { collection: name, reads: 0, writes: 0, cacheReads: 0, docs: 0 };
    acc.reads += row.reads;
    acc.writes += row.writes;
    acc.cacheReads += row.cacheReads;
    acc.docs += 1;
    collections.set(name, acc);
  }
  const byCollection = [...collections.values()]
    .sort((a, b) => (b.writes - a.writes) || (b.reads - a.reads) || a.collection.localeCompare(b.collection));
  return {
    startedAt: new Date(_startedAt).toISOString(),
    elapsedMinutes: Math.max(0, Math.round((Date.now() - _startedAt) / 6000) / 10),
    ..._totals,
    lastMinute: _recent.reduce((sum, entry) => sum + entry.count, 0),
    byCollection,
    byPath,
    note: 'Estimation client : la console Firebase reste la source de facturation officielle.',
  };
}

export function resetFirestoreMetrics() {
  _totals.reads = 0;
  _totals.writes = 0;
  _totals.cacheReads = 0;
  _totals.initialListenerReads = 0;
  _totals.listenerSnapshots = 0;
  _paths.clear();
  _recent.length = 0;
}

if (typeof window !== 'undefined') {
  // Usage console : firebaseUsage(), firebaseUsage.print() (par collection),
  // firebaseUsage.printDocs() (par document) ou firebaseUsage.reset().
  const api = () => firestoreMetricsSnapshot();
  api.reset = resetFirestoreMetrics;
  api.print = () => console.table(firestoreMetricsSnapshot().byCollection);
  api.printDocs = () => console.table(firestoreMetricsSnapshot().byPath);
  window.firebaseUsage = api;
}
