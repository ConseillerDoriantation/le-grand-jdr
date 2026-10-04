// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD-WALL-FEED — Mur du Bastion sur le tableau de bord, en flux bornés
// ──────────────────────────────────────────────────────────────────────────────
// La page d'accueil n'affiche que 4 publications et le nombre de non-lus, mais
// relisait les 80 dernières à chaque chargement à froid. Trois flux bornés
// donnent exactement le même rendu :
//   • les WALL_FEED_RECENT plus récentes ;
//   • les non lues (ts > seenAt) — 1 lecture si aucune ;
//   • les épinglées (filtre seul, sans tri serveur → aucun index composite),
//     que sortBastionWallPosts place en tête.
// Si une requête ciblée est refusée ou indisponible (ou si un client garde un
// module data/ périmé juste après un déploiement), le flux se rabat sur
// l'ancienne fenêtre des 80 dernières.
//
// Module FEUILLE (cf. cache ESM au déploiement) et pur : les abonnements sont
// injectés (subscribeRecentCollection / subscribeRecentWhere de data/).
// ══════════════════════════════════════════════════════════════════════════════
import { bastionWallUnreadCount, sortBastionWallPosts } from './bastion-wall.js';

export const WALL_FEED_COLLECTION = 'bastionAnnonces';
export const WALL_FEED_RECENT = 12;
export const WALL_FEED_PINNED_MAX = 20;
export const WALL_FEED_UNREAD_MAX = 80;
export const WALL_FEED_LEGACY_MAX = 80;
export const DASHBOARD_WALL_SHOWN = 4;

// Un document livré par plusieurs flux n'apparaît qu'une fois.
export function mergeWallFeeds(...feeds) {
  const byId = new Map();
  for (const feed of feeds) for (const doc of feed || []) if (doc?.id) byId.set(doc.id, doc);
  return [...byId.values()];
}

// Ce que montre le panneau : les non-lus des autres d'abord, puis l'ordre du mur
// (épinglés, puis plus récents), et le nombre de non-lus.
export function dashboardWallView({ docs = [], legacyItems = [], seenAt = 0, uid = '' } = {}) {
  const posts = sortBastionWallPosts([
    ...docs.filter(doc => doc.id !== 'main' && (doc.kind === 'post' || doc.text)),
    ...legacyItems.map((post, index) => ({ ...post, id: post.id || `legacy_${index}`, legacy: true })),
  ]);
  const unread = bastionWallUnreadCount(posts, seenAt, uid);
  const highlighted = posts.filter(post => post.ts > seenAt && post.uid !== uid);
  const shown = [...highlighted, ...posts.filter(post => !highlighted.includes(post))].slice(0, DASHBOARD_WALL_SHOWN);
  return { unread, shown };
}

export function createDashboardWallFeed({ subscribeRecent, subscribeWhere }, onDocs) {
  let recent = [], pinned = [], unread = [], legacy = null;
  let seenAt = 0;
  let stopped = false;
  const unsubs = new Map();   // nom du flux → désabonnement

  const drop = name => {
    try { unsubs.get(name)?.(); } catch { /* listener déjà détaché */ }
    unsubs.delete(name);
  };
  const emit = () => {
    if (!stopped) onDocs(legacy ?? mergeWallFeeds(pinned, recent, unread));
  };
  // Une requête invalide lève de façon synchrone (ex. module data/ périmé) :
  // même traitement qu'une requête indisponible.
  const _guard = subscribe => {
    try { return subscribe(); }
    catch (error) { console.debug('[dashboard] mur : requête ciblée indisponible', error?.code || error); fallBack(); return () => {}; }
  };
  const fallBack = () => {
    if (stopped || legacy) return;
    ['recent', 'pinned', 'unread'].forEach(drop);
    legacy = [];
    unsubs.set('legacy', subscribeRecent(WALL_FEED_COLLECTION, docs => { legacy = docs || []; emit(); },
      { field: 'ts', max: WALL_FEED_LEGACY_MAX }));
  };
  const subscribeUnread = () => {
    drop('unread');
    unread = [];
    const unsub = _guard(() => subscribeWhere(WALL_FEED_COLLECTION, { field: 'ts', op: '>', value: seenAt },
      { orderField: 'ts', max: WALL_FEED_UNREAD_MAX },
      docs => { unread = docs; emit(); }, { onUnavailable: fallBack }));
    if (!legacy) unsubs.set('unread', unsub);
  };

  return {
    start(initialSeenAt = 0) {
      seenAt = Math.max(0, Number(initialSeenAt) || 0);
      unsubs.set('recent', subscribeRecent(WALL_FEED_COLLECTION, docs => { recent = docs || []; emit(); },
        { field: 'ts', max: WALL_FEED_RECENT }));
      const unsubPinned = _guard(() => subscribeWhere(WALL_FEED_COLLECTION, { field: 'pinned', op: '==', value: true },
        { orderField: null, max: WALL_FEED_PINNED_MAX },
        docs => { pinned = docs; emit(); }, { onUnavailable: fallBack }));
      if (!legacy) unsubs.set('pinned', unsubPinned);
      if (!legacy) subscribeUnread();
    },
    // Lecture du mur confirmée ailleurs (bastionWallReads) : seuil relevé, les
    // anciens non-lus sortent du flux. Le seuil ne fait que monter.
    setSeenAt(next) {
      const value = Math.max(0, Number(next) || 0);
      if (stopped || legacy || value <= seenAt) return;
      seenAt = value;
      subscribeUnread();
    },
    stop() {
      stopped = true;
      [...unsubs.keys()].forEach(drop);
    },
  };
}
