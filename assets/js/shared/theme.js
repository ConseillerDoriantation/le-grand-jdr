// ══════════════════════════════════════════════
// THEME — Mode jour / nuit
// Persistance : localStorage → clé 'jdr-theme'
// Application : attribut data-theme sur <html>
// ══════════════════════════════════════════════

const STORAGE_KEY = 'jdr-theme';
const DARK  = 'dark';
const LIGHT = 'light';

// ── Lecture / écriture ─────────────────────────
function _getStored()  { return localStorage.getItem(STORAGE_KEY) || DARK; }
function _store(theme) { localStorage.setItem(STORAGE_KEY, theme); }

// ── Application au DOM ─────────────────────────
function _apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  _updateButton(theme);
}

function _updateButton(theme) {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const isLight = theme === LIGHT;
  btn.setAttribute('aria-label', isLight ? 'Passer en mode nuit' : 'Passer en mode jour');
  btn.setAttribute('title',      isLight ? 'Mode nuit'           : 'Mode jour');
  // Icône : lune si on est en mode jour (propose de passer en nuit), soleil sinon
  btn.textContent = isLight ? '🌙' : '☀️';
}

// ── API publique ───────────────────────────────
export function initTheme() {
  const saved = _getStored();
  _apply(saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || DARK;
  const next    = current === DARK ? LIGHT : DARK;
  _store(next);
  _apply(next);
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || DARK;
}
