// ══════════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — PWA installable + lecture hors-ligne (app shell)
// ──────────────────────────────────────────────────────────────────────────────
// Stratégie : RÉSEAU D'ABORD pour le même-origine (en ligne = toujours frais,
// aucune régression de fraîcheur), CACHE EN REPLI quand le réseau échoue
// (hors-ligne en séance). Le cross-origine (Firestore, Google, Cloudinary, fonts)
// passe en direct — Firestore a déjà son cache IndexedDB pour les données.
// Volontairement minimal : pas de précache (app sans build → liste de fichiers
// fragile), on met en cache au fil des requêtes réussies.
// ══════════════════════════════════════════════════════════════════════════════
const CACHE = 'grimorium-v2';

async function _notifyUpdateAvailable() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach(client => client.postMessage({ type: 'APP_UPDATE_AVAILABLE' }));
}

async function _responseChanged(previous, next) {
  if (!previous || !next?.ok) return false;
  const previousTag = previous.headers.get('etag');
  const nextTag = next.headers.get('etag');
  if (previousTag && nextTag && previousTag === nextTag) return false;
  try {
    const [before, after] = await Promise.all([previous.clone().text(), next.clone().text()]);
    return before !== after;
  } catch {
    return Boolean(previousTag && nextTag && previousTag !== nextTag);
  }
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purge les anciens caches (changement de version).
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  // Cross-origin → réseau direct (pas de mise en cache SW).
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const detectsDeployment = url.pathname.endsWith('/index.html');
      const previous = detectsDeployment ? await cache.match(req) : null;
      const res = await fetch(req);
      // Ne met en cache que les réponses propres (200, same-origin).
      if (res && res.ok && res.type === 'basic') {
        if (detectsDeployment && await _responseChanged(previous, res)) {
          await _notifyUpdateAvailable();
        }
        // Assets versionnés (?v=…) : purge les anciennes variantes du même
        // fichier avant d'écrire la nouvelle — sinon chaque bump accumule
        // une copie de plus (CSS ~pleins Ko) qui ne sera jamais servie en ligne.
        if (url.search.includes('v=')) {
          const stale = await cache.keys(req, { ignoreSearch: true });
          await Promise.all(stale.filter(k => k.url !== req.url).map(k => cache.delete(k)));
        }
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      // Hors-ligne : correspondance exacte, sinon (asset versionné dont le ?v a
      // bumpé depuis la dernière visite) l'ancienne variante — mieux qu'un trou.
      const cached = await caches.match(req)
        || (url.search.includes('v=') ? await caches.match(req, { ignoreSearch: true }) : null);
      if (cached) return cached;
      // Navigation hors-ligne sans entrée exacte → on sert l'app shell en cache.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html')
          || await caches.match(new URL('./', self.location).href);
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
