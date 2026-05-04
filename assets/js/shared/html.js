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
