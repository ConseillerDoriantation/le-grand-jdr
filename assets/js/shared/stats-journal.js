// ══════════════════════════════════════════════════════════════════════════════
// STATS-JOURNAL.JS — Copie locale du tampon de statistiques (pur, testable)
// ──────────────────────────────────────────────────────────────────────────────
// stats.js garde les compteurs en mémoire plusieurs minutes avant d'écrire
// stats/main (quota : un joueur agit environ une fois par round, une écriture
// par action ne fusionnait presque rien). Un onglet tué sans `pagehide`
// (plantage, coupure) perdrait ce tampon : il est donc recopié dans le
// localStorage à chaque ajout, effacé juste avant l'écriture (au plus une fois),
// et rejoué par un autre onglet si son propriétaire a disparu.
//
// Propriété : une clé par instance de page (deux onglets ne s'écrasent jamais).
// Un propriétaire vivant écrit au plus `maxWaitMs` après son 1er ajout (et dès
// qu'il passe en arrière-plan) : un journal plus vieux que deux fenêtres est
// donc orphelin.
// ══════════════════════════════════════════════════════════════════════════════

const JOURNAL_VERSION = 1;
const _isPlain = v => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

export function statsJournalPrefix(uid) {
  return `stats-pending:${uid || 'anon'}:`;
}

export function statsJournalKey(uid, tabId) {
  return `${statsJournalPrefix(uid)}${tabId || ''}`;
}

export function serializeStatsJournal({ path, pending, tabId, at }) {
  return { v: JOURNAL_VERSION, path: String(path || ''), pending, tab: String(tabId || ''), at: Number(at) || 0 };
}

// Journal lu depuis le stockage → objet validé, ou null s'il est illisible.
export function parseStatsJournal(raw) {
  if (!_isPlain(raw) || raw.v !== JOURNAL_VERSION) return null;
  if (typeof raw.path !== 'string' || !raw.path || typeof raw.tab !== 'string') return null;
  if (!Number.isFinite(raw.at) || raw.at <= 0) return null;
  const pending = raw.pending;
  if (!_isPlain(pending) || !_isPlain(pending.inc) || !_isPlain(pending.max)) return null;
  return { path: raw.path, pending: { inc: pending.inc, max: pending.max }, tab: raw.tab, at: raw.at };
}

// Délai avant de pouvoir rejouer le journal d'un autre onglet (0 = tout de suite,
// null = jamais : il nous appartient ou il est absent). L'âge est compté depuis
// le dernier ajout, toujours postérieur au 1er : marge d'au moins une fenêtre.
export function statsJournalReplayDelay(journal, { tabId, now, maxWaitMs }) {
  if (!journal || journal.tab === tabId) return null;
  return Math.max(0, journal.at + 2 * maxWaitMs - now);
}
