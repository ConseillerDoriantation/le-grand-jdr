import { STATE } from '../core/state.js';
import { ASSET_VERSION } from '../core/version.js';
import { copyText } from './clipboard.js';

const MAX_EVENTS = 12;
const _events = [];
let _initialized = false;

function _safeLocation(value = '') {
  const text = String(value || '');
  try {
    const url = new URL(text, location.href);
    return url.pathname.split('/').filter(Boolean).slice(-3).join('/');
  } catch {
    return text.split(/[\\/]/).slice(-3).join('/');
  }
}

function _message(value) {
  return String(value?.message || value || 'Erreur inconnue')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
}

function _record(kind, value, meta = {}) {
  _events.unshift({
    at: new Date().toISOString(),
    kind,
    message: _message(value),
    code: String(value?.code || meta.code || ''),
    source: _safeLocation(meta.source),
    line: Number(meta.line) || 0,
    column: Number(meta.column) || 0,
  });
  _events.splice(MAX_EVENTS);
}

export function initDiagnostics() {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;
  window.addEventListener('error', event => {
    _record('erreur', event.error || event.message, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', event => _record('promesse rejetée', event.reason));
  document.addEventListener('app:data-write-state', event => {
    if (event.detail?.state === 'failed') _record('écriture Firestore', event.detail.error);
  });
}

export function diagnosticReport() {
  const viewport = typeof window === 'undefined' ? 'inconnu' : `${window.innerWidth}×${window.innerHeight}`;
  const pwa = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? (navigator.serviceWorker.controller ? 'active' : 'inactive')
    : 'indisponible';
  const lines = [
    'Grimorium — diagnostic technique',
    `Date : ${new Date().toISOString()}`,
    `Version : ${ASSET_VERSION}`,
    `Page : ${STATE.currentPage || 'aucune'}`,
    `Rôle : ${STATE.isAdmin ? 'MJ' : 'Joueur'}`,
    `Connexion : ${typeof navigator !== 'undefined' && navigator.onLine ? 'en ligne' : 'hors ligne'}`,
    `Onglet : ${typeof document !== 'undefined' && document.hidden ? 'arrière-plan' : 'visible'}`,
    `PWA : ${pwa}`,
    `Écran : ${viewport} @${globalThis.devicePixelRatio || 1}`,
    `Navigateur : ${typeof navigator !== 'undefined' ? navigator.userAgent : 'inconnu'}`,
    '',
    `Événements récents (${_events.length}) :`,
  ];
  if (!_events.length) lines.push('- Aucun événement technique capturé.');
  else _events.forEach(event => {
    const position = event.source ? ` — ${event.source}${event.line ? `:${event.line}${event.column ? `:${event.column}` : ''}` : ''}` : '';
    const code = event.code ? ` [${event.code}]` : '';
    lines.push(`- ${event.at} · ${event.kind}${code} : ${event.message}${position}`);
  });
  lines.push('', 'Aucun email, UID, contenu de document ou donnée de campagne n’est inclus.');
  return lines.join('\n');
}

export async function copyDiagnosticReport() {
  await copyText(diagnosticReport());
}
