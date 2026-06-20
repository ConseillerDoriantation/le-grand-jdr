// ══════════════════════════════════════════════════════════════════════════════
// ERROR-SENSOR — Observabilité légère des erreurs côté client
// ──────────────────────────────────────────────────────────────────────────────
// Capte window 'error' + 'unhandledrejection' (et les error-boundaries via
// reportError) → écrit dans la collection Firestore `errors/`, BORNÉE :
//   • id de doc = hash de la signature → 1 doc par bug unique (la collection ne
//     gonfle pas : un bug récurrent met à jour le même doc).
//   • dedup par session : un bug donné n'écrit qu'UNE fois par session.
//   • cap MAX_PER_SESSION : au-delà, on ne fait plus que logguer en console.
//   • écriture seulement si l'utilisateur est connecté (les règles exigent l'auth).
//   • ne LÈVE jamais (sinon on bouclerait sur nos propres erreurs).
// Lecture réservée au MJ/admin (cf. règle Firestore à ajouter — voir docs).
// ══════════════════════════════════════════════════════════════════════════════
import { db, doc, setDoc, increment, serverTimestamp } from '../config/firebase.js';
import { STATE } from '../core/state.js';

const MAX_PER_SESSION = 12;      // garde-fou anti-flood (bugs DISTINCTS par session)
const _seen = new Set();         // signatures déjà remontées cette session
let _writes = 0;
let _installed = false;

// Hash FNV-1a → base36 (id de doc stable, sans caractère interdit).
function _hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function _firstFrame(stack) {
  return String(stack || '').split('\n').map(s => s.trim())
    .find(l => /\.js[:?]/.test(l) || /\.js'/.test(l)) || '';
}

// Cœur : construit la signature, dédupe, écrit le doc borné. Ne lève jamais.
function _report(kind, message, stack, context = {}) {
  try {
    message = String(message ?? 'Erreur').slice(0, 500);
    const frame = _firstFrame(stack).slice(0, 200);
    const ctxKey = context && context.boundary ? `@${context.boundary}` : '';
    const sig = `${kind}|${message}|${frame}${ctxKey}`;
    if (_seen.has(sig)) return;        // déjà vu cette session
    _seen.add(sig);
    if (_writes >= MAX_PER_SESSION) return;

    const uid = STATE?.user?.uid;
    if (!uid) return;                  // pré-login : règles refuseraient l'écriture

    _writes++;
    const id = _hash(sig);
    setDoc(doc(db, 'errors', id), {
      kind,
      message,
      frame,
      stack: String(stack || '').slice(0, 1800),
      page: STATE?.currentPage || null,
      boundary: context.boundary || null,
      adventureId: STATE?.adventure?.id || null,
      uid,
      pseudo: STATE?.profile?.pseudo || STATE?.user?.email || null,
      ua: (navigator.userAgent || '').slice(0, 200),
      count: increment(1),
      lastSeen: serverTimestamp(),
    }, { merge: true }).catch(() => {}); // échec silencieux (pas de règle, offline…)
  } catch { /* le capteur ne doit jamais casser quoi que ce soit */ }
}

// API publique pour les error-boundaries (ex. _vttPanelError) : remonte une
// erreur attrapée avec un contexte (nom du panneau, etc.).
export function reportError(err, context = {}) {
  _report('caught', err?.message ?? err, err?.stack, context);
}

export function initErrorSensor() {
  if (_installed) return;
  _installed = true;
  window.addEventListener('error', (e) => {
    // Ignore les erreurs de chargement de ressource (img/script) : e.error null,
    // e.target est l'élément → bruit (ex. hoquets CDN d'images).
    if (!e.error && !(e.message && e.filename)) return;
    _report('error', e.error?.message ?? e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    _report('promise', r?.message ?? r, r?.stack);
  });
}
