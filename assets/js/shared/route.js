// ══════════════════════════════════════════════
// SHARED / ROUTE.JS — URL de l'app : #page[/sous-route]
//
// L'app est une SPA : sans URL, un onglet ouvert au clic molette retomberait sur
// le dashboard. Le hash rend chaque page — et, si la feature le déclare, son
// onglet — adressable (nouvel onglet, rechargement, lien partagé).
//
// La sous-route est une chaîne libre, interprétée par la feature seule :
//   #characters/char_17/sorts  → fiche perso `char_17`, onglet Sorts
// Une feature à onglets :
//   1. marque ses onglets `data-nav-sub="…"` (clic molette / Ctrl+clic → nouvel onglet) ;
//   2. appelle setRouteSub() quand l'onglet change (l'URL suit l'écran) ;
//   3. lit getRouteSub() à son rendu initial (l'écran suit l'URL).
//
// Module pur, sans dépendance : importable depuis core/ comme depuis features/.
// ══════════════════════════════════════════════

const _seg = (s) => String(s ?? '').trim().replace(/[^\w.:-]/g, '');
const _sub = (s) => String(s ?? '').split('/').map(_seg).filter(Boolean).join('/');

export function parseRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  const [page = '', ...rest] = raw.split('/');
  return { page: _seg(page), sub: _sub(rest.join('/')) };
}

export function routeUrl(page, sub = '') {
  const s = _sub(sub);
  return `${location.pathname}${location.search}#${_seg(page)}${s ? `/${s}` : ''}`;
}

// Sous-route courante, UNIQUEMENT si l'URL pointe bien sur `page` : le hash d'une
// autre page ne doit jamais détourner l'écran affiché.
export function getRouteSub(page) {
  const route = parseRoute();
  return route.page === page ? route.sub : '';
}

// La feature déclare sa sous-route courante. `replaceState` : pas d'entrée
// d'historique, pas d'événement `hashchange` → aucun re-render déclenché.
export function setRouteSub(page, sub = '') {
  const route = parseRoute();
  if (route.page !== page) return; // page changée entre-temps → ne rien écraser
  const next = _sub(sub);
  if (route.sub === next) return;
  history.replaceState(null, '', routeUrl(page, next));
}
