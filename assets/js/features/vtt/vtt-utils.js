// ══════════════════════════════════════════════════════════════════════════════
// VTT — Utilitaires transverses sans état (frontière d'erreur de panneau, …)
// ──────────────────────────────────────────────────────────────────────────────
// Module LEAF : ne dépend que de helpers partagés (notifications, html). Importé
// par vtt.js ET ses sous-modules → évite l'import circulaire vers vtt.js.
// ══════════════════════════════════════════════════════════════════════════════
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';

// Frontière d'erreur par panneau : un rendu qui plante n'abat pas toute la table.
// Loggue, notifie une seule fois par panneau, et remplit le conteneur d'un message.
const _vttPanelErrSeen = new Set();
export function _vttPanelError(label, e, elId) {
  console.error(`[vtt] panneau « ${label} » : rendu échoué`, e);
  if (!_vttPanelErrSeen.has(label)) {
    _vttPanelErrSeen.add(label);
    try { showNotif(`⚠ Panneau « ${label} » en erreur — le reste de la table continue (détail en console).`, 'error'); } catch {}
  }
  if (elId) {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = `<div class="vtt-panel-err">⚠ Erreur d'affichage de ce panneau.<br><small>${_esc(String(e?.message ?? e))}</small></div>`;
  }
}
