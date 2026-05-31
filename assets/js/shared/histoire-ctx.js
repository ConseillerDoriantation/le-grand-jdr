// Contexte partagé entre story.js (écriture) et histoire.js (lecture).
// Remplace window._histoireCtx.

let _ctx = null;

export function setHistoireCtx(id, titre, acte) { _ctx = { id, titre, acte }; }
export function getHistoireCtx()                 { return _ctx || {}; }
