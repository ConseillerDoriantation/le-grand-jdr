// ══════════════════════════════════════════════════════════════════════════════
// SHARED / HTML.JS — Utilitaires HTML & chaînes communs
// Importer depuis n'importe quel feature :
//   import { _esc, _nl2br, _norm, _toRoman, modStr } from '../shared/html.js';
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Échappe les caractères spéciaux HTML.
 * Utilisé pour insérer des valeurs dans du HTML généré dynamiquement.
 */
export function _esc(v = '') {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Échappe + convertit les sauts de ligne en <br>.
 */
export function _nl2br(v = '') {
  return _esc(v).replace(/\n/g, '<br>');
}

/**
 * Normalise une chaîne pour la recherche : minuscules, sans accents.
 */
export function _norm(v = '') {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function _normLoose(v = '') {
  return _norm(v).replace(/([aeiouy])\1+/g, '$1');
}

/**
 * Recherche insensible à la casse, aux accents, aux ligatures et aux doubles voyelles.
 */
export function _searchIncludes(text = '', query = '') {
  const q = _norm(query);
  if (!q) return true;
  const hay = _norm(text);
  if (hay.includes(q)) return true;
  return _normLoose(hay).includes(_normLoose(q));
}

/**
 * Tronque une chaîne à n caractères avec ellipse.
 */
export function _trunc(v = '', n = 280) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n).trimEnd() + '…';
}

/**
 * Convertit un nombre entier en chiffres romains.
 */
export function _toRoman(n) {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { r += syms[i]; n -= vals[i]; }
  }
  return r;
}

/**
 * Formate un modificateur de stat avec signe (+3, -1, +0).
 */
export function modStr(v) {
  return v >= 0 ? '+' + v : String(v);
}

/**
 * Retourne les initiales d'un nom (2 lettres max).
 */
export function _initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') : '?';
}

/**
 * Loader inline réutilisable (emblème + spinner + label).
 * Utilise les classes `.app-splash--inline` partagées avec #boot-splash.
 */
/**
 * Header standard d'une page (titre + sous-titre optionnel).
 * @param {string} title   - Texte du titre, emoji inclus (non échappé, supposé sûr).
 * @param {string} subtitle - Sous-titre optionnel.
 */
export function pageHeaderHtml(title, subtitle = '') {
  return `<div class="page-header"><div class="page-title"><span class="page-title-accent">${title}</span></div>${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ''}</div>`;
}

export function appSplashHtml(label = 'Chargement…') {
  return `
    <div class="app-splash app-splash--inline">
      <div class="app-splash-inner">
        <span class="app-splash-sigil" aria-hidden="true"><img class="brand-logo" src="./assets/img/grimorium-logo.png" alt=""></span>
        <div class="app-splash-spinner"></div>
        ${label ? `<div class="app-splash-label">${_esc(label)}</div>` : ''}
      </div>
    </div>`;
}

/**
 * Normalise une URL d'image collée par l'utilisateur :
 *  - convertit une URL « page web » GitHub (github.com/<owner>/<repo>/tree|blob/
 *    <branche>/<chemin>) en URL d'image directe servie par GitHub Pages
 *    (https://<owner>.github.io/<repo>/<chemin>, même domaine que l'app) ;
 *  - encode les espaces / accents du chemin (sans casser protocole + host).
 * Renvoie l'URL inchangée (juste ré-encodée) si ce n'est pas une URL GitHub.
 */
export function normalizeImageUrl(url) {
  if (!url) return url;
  let u = String(url).trim();
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:tree|blob)\/[^/]+\/(.+)$/i);
  if (m) {
    const [, owner, repo, path] = m;
    u = `https://${owner.toLowerCase()}.github.io/${repo}/${path}`;
  }
  try {
    const parsed = new URL(u);
    parsed.pathname = parsed.pathname.split('/')
      .map(seg => { try { return encodeURIComponent(decodeURIComponent(seg)); } catch { return encodeURIComponent(seg); } })
      .join('/');
    return parsed.toString();
  } catch {
    return u.replace(/ /g, '%20');
  }
}
