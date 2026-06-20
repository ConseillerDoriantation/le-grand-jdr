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
const CACHE = 'grimorium-v1';

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
      const res = await fetch(req);
      // Ne met en cache que les réponses propres (200, same-origin).
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
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
