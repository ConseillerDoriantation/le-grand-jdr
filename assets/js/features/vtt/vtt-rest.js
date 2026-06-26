// ══════════════════════════════════════════════════════════════════════════════
// VTT-REST.JS — Court repos du groupe (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// Pas d'état local : tout vit dans VS.session.shortRest (Firestore).
// Vote du groupe → régénère ½ PV / ½ PM aux persos placés. MJ force/règle/reset.
// ══════════════════════════════════════════════════════════════════════════════

import { setDoc, updateDoc } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc } from '../../shared/html.js';
import { calcPVMax, calcPMMax } from '../../shared/char-stats.js';
import { showNotif } from '../../shared/notifications.js';
import { _sesRef, _chrRef } from './vtt-refs.js';   // refs Firestore (leaf)

// ══════════════════════════════════════════════════════════════════════════
// COURT REPOS — Vote du groupe, régénère ½ PV / ½ PM (arrondi sup.)
// ──────────────────────────────────────────────────────────────────────────
// Stockage session.shortRest = { max, count, vote: { votes: {uid:true} } | null }
// Vote complet (tous les owners de player tokens placés ont voté) → MJ applique.
// MJ peut forcer / annuler / régler max / reset compteur.
// ══════════════════════════════════════════════════════════════════════════
// Présent = joueur RÉELLEMENT connecté au VTT (VS.presence / pings, fenêtre 120 s,
// même critère que la liste de présence et vtt-tray) ET dont un token est posé sur
// la map active. Sans ça, des joueurs déconnectés — ou des tokens oubliés sur
// d'autres pages — restaient comptés dans le quorum et bloquaient le vote à
// l'unanimité indéfiniment.
// Page active GLOBALE (VS.session.activePageId) plutôt que VS.activePage (locale,
// car un joueur peut être épinglé ailleurs via playerPages) → quorum identique sur
// tous les clients. Tout est déjà en mémoire : zéro lecture/écriture Firestore.
const _SR_TTL = 120_000;
function _srOnline(uid) {
  const p = uid && VS.presence?.[uid];
  return !!(p && Date.now() - (p.lastSeen || 0) < _SR_TTL);
}
function _srActivePage() {
  return VS.session?.activePageId || VS.activePage?.id || null;
}
function _shortRestPresentUids() {
  const ap = _srActivePage(); if (!ap) return [];
  const uids = new Set();
  for (const e of Object.values(VS.tokens)) {
    const t = e?.data;
    if (t?.type === 'player' && t.pageId === ap && t.ownerId && _srOnline(t.ownerId)) uids.add(t.ownerId);
  }
  return [...uids];
}
function _shortRestPresentChars() {
  const ap = _srActivePage(); if (!ap) return [];
  const seen = new Set(), chars = [];
  for (const e of Object.values(VS.tokens)) {
    const t = e?.data;
    if (t?.type === 'player' && t.pageId === ap && t.characterId && _srOnline(t.ownerId) && !seen.has(t.characterId)) {
      seen.add(t.characterId);
      const c = VS.characters[t.characterId];
      if (c) chars.push(c);
    }
  }
  return chars;
}
function _shortRestPresentNames() {
  // ownerId → nom à afficher (perso le plus récemment vu sur la map active)
  const ap = _srActivePage(); if (!ap) return {};
  const out = {};
  for (const e of Object.values(VS.tokens)) {
    const t = e?.data;
    if (t?.type === 'player' && t.pageId === ap && t.ownerId && _srOnline(t.ownerId) && !out[t.ownerId]) {
      const c = t.characterId ? VS.characters[t.characterId] : null;
      out[t.ownerId] = c?.nom || t.name || t.ownerId.slice(0, 6);
    }
  }
  return out;
}

async function _vttShortRestVote() {
  const uid = STATE.user?.uid; if (!uid) return;
  const sr  = VS.session?.shortRest || { max: 0, count: 0, vote: null };
  if ((sr.count || 0) >= (sr.max ?? 0)) {
    showNotif('Plus de court repos disponible', 'error'); return;
  }
  const votes = { ...(sr.vote?.votes || {}), [uid]: true };
  await setDoc(_sesRef(), { shortRest: { ...sr, vote: { votes } } }, { merge: true })
    .catch(() => showNotif('Erreur vote', 'error'));
}

async function _vttShortRestUnvote() {
  const uid = STATE.user?.uid; if (!uid) return;
  const sr  = VS.session?.shortRest; if (!sr?.vote) return;
  const votes = { ...sr.vote.votes };
  delete votes[uid];
  // ⚠️ setDoc(..., {merge:true}) FUSIONNE les maps → il ne supprimerait jamais la
  // clé retirée (le vote resterait collé). updateDoc avec un field-path REMPLACE
  // la valeur à ce chemin → le retrait fonctionne réellement.
  const patch = Object.keys(votes).length
    ? { 'shortRest.vote': { votes } }
    : { 'shortRest.vote': null };
  await updateDoc(_sesRef(), patch).catch(() => {});
}

async function _vttShortRestCancel() {
  if (!STATE.isAdmin) return;
  const sr = VS.session?.shortRest; if (!sr) return;
  await setDoc(_sesRef(), { shortRest: { ...sr, vote: null } }, { merge: true });
}

async function _vttShortRestForce() {
  if (!STATE.isAdmin) return;
  await _applyShortRest({ forced: true });
}

async function _vttShortRestSetMax(val) {
  if (!STATE.isAdmin) return;
  const max = Math.max(0, Math.min(20, parseInt(val) || 0));
  const sr  = VS.session?.shortRest || { count: 0, vote: null };
  await setDoc(_sesRef(), { shortRest: { ...sr, max } }, { merge: true });
}

async function _vttShortRestResetCount() {
  if (!STATE.isAdmin) return;
  const sr = VS.session?.shortRest || { max: 0 };
  await setDoc(_sesRef(), { shortRest: { ...sr, count: 0, vote: null } }, { merge: true });
}

async function _applyShortRest({ forced = false } = {}) {
  const sr = VS.session?.shortRest || { max: 0, count: 0, vote: null };
  if ((sr.count || 0) >= (sr.max ?? 0)) {
    showNotif('Plus de court repos disponible', 'error'); return;
  }
  const chars = _shortRestPresentChars();
  await Promise.all(chars.map(c => {
    const maxHp = calcPVMax(c);
    const maxPm = calcPMMax(c);
    const curHp = Math.max(0, Number(c.hp) || 0);
    const curPm = Math.max(0, Number(c.pm) || 0);
    const newHp = Math.min(maxHp, curHp + Math.ceil(maxHp / 2));
    const newPm = Math.min(maxPm, curPm + Math.ceil(maxPm / 2));
    return updateDoc(_chrRef(c.id), { hp: newHp, pm: newPm }).catch(() => {});
  }));
  const newCount = (sr.count || 0) + 1;
  await setDoc(_sesRef(), { shortRest: { ...sr, count: newCount, vote: null } }, { merge: true });
  const tag = forced ? ' (forcé par le MJ)' : '';
  showNotif(`💤 Court repos pris${tag} — ${chars.length} perso(s) régénéré(s) · ${newCount}/${sr.max ?? 0}`, 'success');
}

// Auto-apply : seul le MJ déclenche pour éviter les races.
function _checkShortRestAutoApply() {
  if (!STATE.isAdmin) return;
  const sr = VS.session?.shortRest;
  if (!sr?.vote) return;
  if ((sr.count || 0) >= (sr.max ?? 0)) return;
  const present = _shortRestPresentUids();
  if (!present.length) return;
  const voted = Object.keys(sr.vote.votes || {});
  if (!present.every(u => voted.includes(u))) return;
  _applyShortRest({ forced: false });
}

function _renderShortRest() {
  const trigger = document.getElementById('vtt-rest-trigger');
  const panel   = document.getElementById('vtt-rest-panel');
  const body    = document.getElementById('vtt-rest-body');
  if (!trigger) return;

  const sr   = VS.session?.shortRest || { max: 0, count: 0, vote: null };
  const max  = sr.max ?? 0;
  const used = sr.count || 0;
  const rem  = Math.max(0, max - used);

  trigger.textContent = `💤 ${used}/${max}`;
  trigger.classList.toggle('vtt-rest-trigger--out',    rem === 0);
  trigger.classList.toggle('vtt-rest-trigger--voting', !!sr.vote);

  if (!panel || panel.dataset.open !== '1' || !body) return;

  const uid     = STATE.user?.uid;
  const present = _shortRestPresentUids();
  const voted   = Object.keys(sr.vote?.votes || {});
  const names   = _shortRestPresentNames();
  const onPage  = present.includes(uid);
  const hasV    = voted.includes(uid);

  const voteList = sr.vote ? present.map(u => `
    <div class="vtt-rest-voter">
      <span class="vtt-rest-voter-ic ${voted.includes(u) ? 'on' : ''}">${voted.includes(u) ? '✓' : '⋯'}</span>
      <span class="vtt-rest-voter-name">${_esc(names[u] || u.slice(0,6))}</span>
    </div>`).join('') : '';

  body.innerHTML = `
    <div class="vtt-rest-counter">
      <span><b>${used}</b>/${max} utilisé(s)</span>
      <span class="vtt-rest-remaining">${rem} restant${rem>1?'s':''}</span>
    </div>
    <div class="vtt-rest-desc">Régénère <b>½ PV</b> et <b>½ PM</b> (arrondi sup.) à tous les persos placés.</div>
    ${sr.vote ? `
      <div class="vtt-rest-vote-hd">Vote en cours · ${voted.length}/${present.length || '?'}</div>
      <div class="vtt-rest-voters">${voteList || '<div class="vtt-rest-help">Aucun joueur sur la map.</div>'}</div>` : ''}
    ${rem > 0 && onPage ? `
      <div class="vtt-rest-actions">
        ${hasV
          ? `<button class="vtt-rest-btn vtt-rest-btn--voted" data-vtt-fn="_vttShortRestUnvote">✓ Voté — retirer</button>`
          : `<button class="vtt-rest-btn vtt-rest-btn--vote" data-vtt-fn="_vttShortRestVote">Voter pour un court repos</button>`}
      </div>` : ''}
    ${rem === 0 ? '<div class="vtt-rest-help">Plus de court repos disponible pour cette aventure.</div>' : ''}
    ${rem > 0 && !onPage && !STATE.isAdmin ? '<div class="vtt-rest-help">Tu n\'as aucun token placé sur la map.</div>' : ''}
    ${STATE.isAdmin ? `
      <div class="vtt-rest-mj">
        <div class="vtt-rest-mj-row">
          <label class="vtt-rest-mj-lbl">Max pour l'aventure</label>
          <input type="number" min="0" max="20" value="${max}" class="vtt-rest-mj-input"
            data-vtt-fn="_vttShortRestSetMax" data-vtt-on="change" data-vtt-args="$value">
        </div>
        <div class="vtt-rest-mj-btns">
          ${rem > 0 ? `<button class="vtt-rest-btn vtt-rest-btn--force" data-vtt-fn="_vttShortRestForce">💤 Forcer le court repos</button>` : ''}
          ${sr.vote ? `<button class="vtt-rest-btn vtt-rest-btn--cancel" data-vtt-fn="_vttShortRestCancel">✕ Annuler le vote</button>` : ''}
          ${used > 0 ? `<button class="vtt-rest-btn vtt-rest-btn--reset" data-vtt-fn="_vttShortRestResetCount">↺ Reset compteur</button>` : ''}
        </div>
      </div>` : ''}
  `;
}

// Ferme le panneau et détache le listener de clic extérieur.
function _closeShortRest() {
  const panel = document.getElementById('vtt-rest-panel');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; }
  document.getElementById('vtt-rest-trigger')?.classList.remove('active');
  document.removeEventListener('mousedown', _shortRestOutsideClick);
}
// Clic en dehors du float (panneau + déclencheur) → fermer.
function _shortRestOutsideClick(e) {
  if (e.target.closest('.vtt-rest-float')) return;
  _closeShortRest();
}
function _vttToggleShortRest() {
  const panel = document.getElementById('vtt-rest-panel'); if (!panel) return;
  const open = panel.dataset.open === '1';
  if (open) {
    _closeShortRest();
  } else {
    panel.dataset.open = '1'; panel.style.display = 'flex';
    document.getElementById('vtt-rest-trigger')?.classList.add('active');
    _renderShortRest();
    // Défère l'ajout du listener pour que le clic d'ouverture ne le ferme pas aussitôt.
    requestAnimationFrame(() => document.addEventListener('mousedown', _shortRestOutsideClick));
  }
}

export {
  _applyShortRest,
  _checkShortRestAutoApply,
  _closeShortRest,
  _renderShortRest,
  _shortRestOutsideClick,
  _shortRestPresentChars,
  _shortRestPresentNames,
  _shortRestPresentUids,
  _vttShortRestCancel,
  _vttShortRestForce,
  _vttShortRestResetCount,
  _vttShortRestSetMax,
  _vttShortRestUnvote,
  _vttShortRestVote,
  _vttToggleShortRest,
};
