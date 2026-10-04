// ══════════════════════════════════════════════════════════════════════════════
// VTT — Protocole de diffusion de la règle du MJ (pur, testable)
// ──────────────────────────────────────────────────────────────────────────────
// La règle du MJ est diffusée dans vtt/session.mjRuler, relu par tous les
// clients à chaque écriture. Quota : ni écriture « longueur 0 » au départ, ni
// effacement à l'expiration. La fin de mesure part marquée `final` et chaque
// joueur la masque seul après MJ_RULER_LINGER_MS, comme la règle locale du MJ.
// ══════════════════════════════════════════════════════════════════════════════

export const MJ_RULER_LINGER_MS = 5000;         // règle figée visible 5 s (MJ et joueurs)
export const MJ_RULER_IDLE_MS = 60_000;         // filet : mesure interrompue (onglet MJ fermé)
export const MJ_RULER_MAX_AGE_MS = 10 * 60_000; // diffusion ancienne (cache) jamais réaffichée

// Scène d'une diffusion (`page` ; `pageId` pour celles d'avant ce protocole).
export const mjRulerPage = data => data?.page ?? data?.pageId ?? null;

// Diffusion de fin de mesure. `pageId`, seul champ lu par les clients d'avant ce
// protocole, est retiré : ils masquent la règle à la fin de la mesure au lieu de
// la garder affichée faute d'effacement.
export function mjRulerFinalPayload(payload, now) {
  return { ...payload, page: mjRulerPage(payload), pageId: null, final: true, at: now };
}

// Temps d'affichage restant (ms, 0 = masquée) d'une diffusion chez un joueur.
// `receivedAt` est l'horloge LOCALE de réception : aucune horloge partagée, sauf
// le garde-fou large sur `at` contre une vieille diffusion servie par le cache.
export function mjRulerRemainingMs(data, { receivedAt, now, activePageId }) {
  if (!data || !activePageId || mjRulerPage(data) !== activePageId) return 0;
  if (!Number.isFinite(receivedAt)) return 0;
  if (Number.isFinite(data.at) && Math.abs(receivedAt - data.at) > MJ_RULER_MAX_AGE_MS) return 0;
  const ttl = data.final ? MJ_RULER_LINGER_MS : MJ_RULER_IDLE_MS;
  return Math.max(0, receivedAt + ttl - now);
}
