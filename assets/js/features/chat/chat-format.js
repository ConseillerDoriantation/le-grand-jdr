// ══════════════════════════════════════════════════════════════════════════════
// CHAT / FORMAT — logique PURE du chat (rendu de texte + jets de dés).
//
// Aucun import Firebase ni DOM : ce module est chargeable sous `node --test`
// (cf. tests/chat-format.test.js). `chat.js` garde des wrappers qui injectent
// l'état du module (émotes chargées, uid courant, résolution des pseudos).
//
// ⚠ ORDRE D'APPLICATION IMPOSÉ (régression déjà rencontrée en prod) :
//     _esc → linkify → applyEmotes → applyMentions
//   `linkify` DOIT s'appliquer sur le TEXTE échappé, avant toute injection de
//   HTML : sinon il capture l'URL du `src` des <img> d'émote et casse la balise
//   (le src devenait « <a href= » → 404). Les tests verrouillent cet ordre.
// ══════════════════════════════════════════════════════════════════════════════
import { _esc } from '../../shared/html.js';

/** URLs http(s) → liens cliquables. À appliquer sur du texte échappé uniquement. */
export function linkify(html) {
  return String(html ?? '').replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const t = m.match(/[)\].,!?;:]+$/);
    const tail = t ? t[0] : '';
    const url = tail ? m.slice(0, -tail.length) : m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  });
}

/** Balises :nom: → <img> d'émote. `emotes` = [{ name, url }]. */
export function applyEmotes(escaped, emotes = []) {
  let out = String(escaped ?? '');
  if (!emotes || !emotes.length) return out;
  for (const em of emotes) {
    if (!em || !em.name || !em.url) continue;
    const key = `:${em.name}:`;
    if (out.indexOf(key) === -1) continue;
    out = out.split(key).join(
      `<img class="chat-emote-inline" data-emote="${_esc(key)}" src="${_esc(em.url)}" alt="${_esc(key)}" title="${_esc(key)}">`);
  }
  return out;
}

/** Mentions @[uid] → @pseudo surligné (celle de `meUid` mise en évidence). */
export function applyMentions(escaped, meUid = '', nameOf = (u) => u) {
  return String(escaped ?? '').replace(/@\[([\w-]+)\]/g, (_m, uid) =>
    `<span class="chat-mention${uid === meUid ? ' chat-mention--me' : ''}">@${_esc(nameOf(uid))}</span>`);
}

/** Variante composer : jetons ré-sérialisables (data-uid, non éditables). */
export function mentionsToTokens(escaped, nameOf = (u) => u) {
  return String(escaped ?? '').replace(/@\[([\w-]+)\]/g, (_m, uid) =>
    `<span class="chat-mention" contenteditable="false" data-uid="${_esc(uid)}">@${_esc(nameOf(uid))}</span>`);
}

/** Libellé de jour pour les séparateurs de date. `now` injectable (tests). */
export function dayLabel(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(n) - day0(d)) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Jet de dés : parse « 2d6+3 », « d20 », « 1d20+1d4-1 » → { expr, total, parts }.
 * Retourne null si l'expression est invalide. `rng` injectable (tests).
 */
export function rollDice(expr, rng = Math.random) {
  const clean = String(expr || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!clean || !/^[0-9d+-]+$/.test(clean)) return null;
  // Opérateur pendant ou doublé (« 1d20+ », « +1d20 », « 1d20++3 ») → faute de
  // frappe : on refuse plutôt que de lancer silencieusement une expression tronquée.
  if (/^[+-]|[+-]$|[+-]{2}/.test(clean)) return null;
  const terms = clean.match(/[+-]?[^+-]+/g); if (!terms) return null;
  let total = 0; const parts = [];
  for (let t of terms) {
    let sign = 1;
    if (t[0] === '+') t = t.slice(1);
    else if (t[0] === '-') { sign = -1; t = t.slice(1); }
    const dm = t.match(/^(\d*)d(\d+)$/);
    if (dm) {
      const n = parseInt(dm[1] || '1', 10), faces = parseInt(dm[2], 10);
      if (!faces || n < 1 || n > 100 || faces > 1000) return null;
      const rolls = [];
      for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(rng() * faces));
      total += sign * rolls.reduce((a, b) => a + b, 0);
      parts.push({ type: 'dice', label: `${n}d${faces}`, rolls, sign });
    } else if (/^\d+$/.test(t)) {
      total += sign * parseInt(t, 10);
      parts.push({ type: 'mod', value: parseInt(t, 10), sign });
    } else return null;
  }
  return { expr: clean, total, parts };
}

/** Carte de rendu d'un jet (total + détail des dés). */
export function rollCardHtml(roll) {
  const detail = (roll?.parts || []).map(p => p.type === 'dice'
    ? `${p.sign < 0 ? '−' : ''}${p.label} [${p.rolls.join(', ')}]`
    : `${p.sign < 0 ? '−' : '+'}${p.value}`).join(' ');
  return `<span class="chat-roll"><span class="chat-roll-total">🎲 ${_esc(String(roll?.total ?? ''))}</span><span class="chat-roll-detail">${_esc(roll?.expr ?? '')} · ${_esc(detail)}</span></span>`;
}
