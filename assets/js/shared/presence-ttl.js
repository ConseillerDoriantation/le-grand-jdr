// Expiration côté lecture d'une présence VTT (presence/{uid}.lastSeen).
// Module feuille séparé de presence.js : les lecteurs (VTT, chat, dashboard) en
// dépendent sans importer le heartbeat, et un déploiement ne peut pas associer
// un nouveau lecteur à une ancienne copie en cache de presence.js.
// Doit rester > HEARTBEAT_MS de presence.js (marge d'un battement manqué).
export const PRESENCE_TTL_MS = 300_000;
