// ══════════════════════════════════════════════════════════════════════════════
// VERSION DES ASSETS — cache-busting unifié.
//
// UNE seule version pour TOUS les CSS (liens eager d'index.html + chargement
// lazy de navigation.js). À bumper à chaque déploiement qui touche du CSS :
//   node tools/bump-assets.mjs
// (met à jour cette constante ET les liens d'index.html — jamais à la main).
//
// ⚠ JS : ne JAMAIS versionner un import de module (`from './x.js?v=…'`).
// Deux URLs différentes pour le même module = deux instances chargées (bug réel
// eu avec vtt-inspector.js). GitHub Pages sert avec Cache-Control: max-age=600 :
// le JS se revalide seul sous 10 min en prod ; en dev, Ctrl+F5.
// ══════════════════════════════════════════════════════════════════════════════
export const ASSET_VERSION = '20260716c';
