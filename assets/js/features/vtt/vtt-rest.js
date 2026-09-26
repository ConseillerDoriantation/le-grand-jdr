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
import {
  openVttSessionDockPanel, registerVttSessionDockPanel, syncVttSessionDock, vttSessionDockIcon,
} from './vtt-session-dock.js';

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
let _shortRestFlash = null;
let _shortRestFlashTimer = null;
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
function _shortRestPresentEntries() {
  const ap = _srActivePage(); if (!ap) return [];
  const seen = new Set(), entries = [];
  for (const e of Object.values(VS.tokens)) {
    const t = e?.data;
    if (t?.type !== 'player' || t.pageId !== ap || !t.characterId || !_srOnline(t.ownerId) || seen.has(t.characterId)) continue;
    const character = VS.characters[t.characterId];
    if (!character) continue;
    seen.add(t.characterId);
    entries.push({ character, token: t, ownerId: t.ownerId || character.uid || null });
  }
  return entries;
}
function _shortRestPresentChars() {
  return _shortRestPresentEntries().map(entry => entry.character);
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
  const before = {};
  let totalHp = 0, totalPm = 0;
  chars.forEach(c => {
    const maxHp = calcPVMax(c), maxPm = calcPMMax(c);
    const hp = Math.max(0, Number(c.hp) || 0);
    const pm = Math.max(0, Number(c.pmActuel ?? c.pm) || 0);
    before[c.id] = { hp, pm };
    totalHp += Math.min(maxHp, hp + Math.ceil(maxHp / 2)) - hp;
    totalPm += Math.min(maxPm, pm + Math.ceil(maxPm / 2)) - pm;
  });
  await Promise.all(chars.map(c => {
    const maxHp = calcPVMax(c);
    const maxPm = calcPMMax(c);
    const curHp = Math.max(0, Number(c.hp) || 0);
    // PM canonique : pmActuel (fiche) > pm (legacy VTT) ; on écrit les deux.
    const curPm = Math.max(0, Number(c.pmActuel ?? c.pm) || 0);
    const newHp = Math.min(maxHp, curHp + Math.ceil(maxHp / 2));
    const newPm = Math.min(maxPm, curPm + Math.ceil(maxPm / 2));
    return updateDoc(_chrRef(c.id), { hp: newHp, pm: newPm, pmActuel: newPm }).catch(() => {});
  }));
  const newCount = (sr.count || 0) + 1;
  await setDoc(_sesRef(), { shortRest: { ...sr, count: newCount, vote: null } }, { merge: true });
  _shortRestFlash = { forced, count: chars.length, hp: totalHp, pm: totalPm, before };
  clearTimeout(_shortRestFlashTimer);
  _shortRestFlashTimer = setTimeout(() => { _shortRestFlash = null; _renderShortRest(); }, 6000);
  _renderShortRest();
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

function _restAfter(character) {
  const maxHp = calcPVMax(character), maxPm = calcPMMax(character);
  const hp = Math.max(0, Number(character.hp) || 0);
  const pm = Math.max(0, Number(character.pmActuel ?? character.pm) || 0);
  return {
    hp: Math.min(maxHp, hp + Math.ceil(maxHp / 2)), hpMax: maxHp,
    pm: Math.min(maxPm, pm + Math.ceil(maxPm / 2)), pmMax: maxPm,
  };
}

function _restMeter(label, cls, cur, max, next, fromCur = null, showGain = true) {
  const safeMax = Math.max(1, max || 0);
  const pct = value => `${Math.max(0, Math.min(100, (value / safeMax) * 100)).toFixed(1)}%`;
  const gain = showGain ? Math.max(0, next - cur) : 0;
  const initial = fromCur ?? cur;
  const target = fromCur != null && fromCur !== cur ? ` data-rest-width="${pct(cur)}"` : '';
  return `<div class="vtt-rest-meter ${cls}${cls === 'pv' && cur / safeMax < .34 ? ' low' : ''}">
    <span>${label}</span><div class="vtt-rest-track"><i class="cur" style="width:${pct(initial)}"${target}></i>${gain ? `<i class="gain" style="left:${pct(cur)};width:${pct(gain)}"></i>` : ''}</div>
    <span class="vtt-rest-meter-value">${gain ? `<b>${cur}</b> → <ins>${next}</ins>` : `<b>${cur}</b>`}<span>/${max}</span></span>
  </div>`;
}

function _restPortrait(character, token) {
  const image = character?.photoURL || character?.photo || character?.avatar || token?.imageUrl || '';
  const initial = _esc((character?.nom || token?.name || '?').slice(0, 1).toUpperCase());
  const color = _esc(character?.couleur || character?.color || token?.color || '#4f8cff');
  return `<span class="vtt-rest-avatar" style="--rest-color:${color}">${image ? `<img src="${_esc(image)}" alt="">` : initial}</span>`;
}

function _restClass(character) {
  const value = character?.classe || character?.className || character?.class || character?.role || '';
  return typeof value === 'string' ? value : '';
}

function _shortRestAbsentNames(presentIds) {
  const ap = _srActivePage();
  const seen = new Set(), names = [];
  for (const e of Object.values(VS.tokens)) {
    const t = e?.data;
    if (t?.type !== 'player' || t.pageId !== ap || !t.characterId || presentIds.has(t.characterId) || seen.has(t.characterId)) continue;
    const c = VS.characters[t.characterId];
    if (!c) continue;
    seen.add(t.characterId);
    names.push(c.nom || t.name || 'Personnage');
  }
  return names;
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

  const presentCount = _shortRestPresentUids().length;
  const votedCount = Object.keys(sr.vote?.votes || {}).length;
  const badge = trigger.querySelector('.vtt-session-dock-badge');
  if (badge) {
    badge.textContent = sr.vote ? `${votedCount}/${presentCount || '?'}` : String(rem);
    badge.className = `vtt-session-dock-badge${sr.vote ? ' vote' : rem === 0 ? ' out' : ''}`;
  }
  const tooltipTitle = trigger.querySelector('.vtt-session-tooltip b');
  const tooltipDetail = trigger.querySelector('.vtt-session-tooltip-detail');
  if (tooltipTitle) tooltipTitle.textContent = sr.vote ? 'Vote de court repos' : 'Court repos';
  if (tooltipDetail) tooltipDetail.textContent = sr.vote
    ? `${votedCount} joueur${votedCount > 1 ? 's' : ''} sur ${presentCount || '?'} ont voté`
    : rem ? `${rem} restant${rem > 1 ? 's' : ''} sur ${max}` : 'Plus aucun disponible';
  trigger.classList.toggle('dim', rem === 0 && !sr.vote);
  trigger.classList.toggle('vtt-rest-trigger--out',    rem === 0);
  trigger.classList.toggle('vtt-rest-trigger--voting', !!sr.vote);

  if (!panel || panel.dataset.open !== '1' || !body) return;

  const uid     = STATE.user?.uid;
  const entries = _shortRestPresentEntries();
  const present = _shortRestPresentUids();
  const voted   = Object.keys(sr.vote?.votes || {});
  const onPage  = present.includes(uid);
  const hasV    = voted.includes(uid);
  const showGain = rem > 0 && !_shortRestFlash;
  const totals = entries.reduce((sum, { character }) => {
    const after = _restAfter(character);
    const hp = Math.max(0, Number(character.hp) || 0);
    const pm = Math.max(0, Number(character.pmActuel ?? character.pm) || 0);
    sum.hp += after.hp - hp; sum.pm += after.pm - pm;
    return sum;
  }, { hp: 0, pm: 0 });
  const pips = max
    ? Array.from({ length: max }, (_, index) => `<span class="vtt-rest-pip${index < used ? ' used' : ''}${sr.vote && index === used ? ' pending' : ''}">${index < used ? '' : vttSessionDockIcon('rest')}</span>`).join('')
    : '<span class="vtt-rest-aside">Aucun repos prévu</span>';
  const banner = _shortRestFlash
    ? `<div class="vtt-rest-banner ok">${vttSessionDockIcon('check')}<div><b>Court repos pris${_shortRestFlash.forced ? ' · forcé par le MJ' : ''}</b><span>${_shortRestFlash.count} personnage${_shortRestFlash.count > 1 ? 's' : ''} régénéré${_shortRestFlash.count > 1 ? 's' : ''} · +${_shortRestFlash.hp} PV · +${_shortRestFlash.pm} PM au total</span></div></div>`
    : sr.vote
      ? `<div class="vtt-rest-banner vote"><div><b>Vote en cours</b><span>${voted.length} / ${present.length || '?'} · unanimité requise</span></div><div class="vtt-rest-vote-bar">${present.map(ownerId => `<i class="${voted.includes(ownerId) ? 'on' : ''}"></i>`).join('')}</div></div>`
      : rem === 0
        ? `<div class="vtt-rest-banner muted">${vttSessionDockIcon('moon')}<span>Plus de court repos pour cette aventure.${STATE.isAdmin ? ' Augmente le maximum ou réinitialise le compteur ci-dessous.' : ' Le MJ peut en accorder un de plus.'}</span></div>`
        : '';
  const rows = entries.map(({ character, token, ownerId }) => {
    const after = _restAfter(character);
    const curHp = Math.max(0, Number(character.hp) || 0);
    const curPm = Math.max(0, Number(character.pmActuel ?? character.pm) || 0);
    const before = _shortRestFlash?.before?.[character.id];
    const status = sr.vote
      ? `<span class="vtt-rest-status ${voted.includes(ownerId) ? 'yes' : 'wait'}">${voted.includes(ownerId) ? 'A voté' : 'En attente'}</span>`
      : showGain && after.hp === curHp && after.pm === curPm ? '<span class="vtt-rest-status full">Au max</span>' : '';
    const className = _restClass(character);
    return `<div class="vtt-rest-party-row${ownerId === uid ? ' me' : ''}">${_restPortrait(character, token)}<div class="vtt-rest-party-main">
      <div class="vtt-rest-name"><b>${_esc(character.nom || token.name || 'Personnage')}</b>${className ? `<small>${_esc(className)}</small>` : ''}${ownerId === uid ? '<em>Toi</em>' : ''}</div>
      ${_restMeter('PV', 'pv', curHp, after.hpMax, after.hp, before?.hp, showGain)}
      ${_restMeter('PM', 'pm', curPm, after.pmMax, after.pm, before?.pm, showGain)}
    </div>${status}</div>`;
  }).join('');
  const absent = _shortRestAbsentNames(new Set(entries.map(entry => entry.character.id)));

  body.innerHTML = `<div class="vtt-rest-scroll">
    <div class="vtt-rest-charges"><div class="vtt-rest-pips">${pips}</div><div class="vtt-rest-count"><b>${rem}</b><span>restant${rem > 1 ? 's' : ''}</span><small>sur ${max} pour l'aventure</small></div></div>
    ${banner}
    <div class="vtt-rest-section-title"><span>${_shortRestFlash ? 'Après le repos' : showGain ? 'Aperçu du repos' : 'Groupe'}</span><i></i>${showGain && (totals.hp || totals.pm) ? `<small>+${totals.hp} PV · +${totals.pm} PM</small>` : ''}</div>
    <div class="vtt-rest-party">${rows || '<p class="vtt-rest-aside">Aucun joueur connecté sur la carte.</p>'}</div>
    ${absent.length ? `<p class="vtt-rest-aside">Non concerné${absent.length > 1 ? 's' : ''} : ${_esc(absent.join(', '))} — hors ligne.</p>` : ''}
    ${STATE.isAdmin ? `<div class="vtt-rest-mj"><div class="vtt-rest-mj-title">${vttSessionDockIcon('crown')}Maître de jeu</div>
      <div class="vtt-rest-mj-row"><span>Courts repos par aventure<small>${used} déjà pris</small></span><div class="vtt-rest-stepper">
        <button data-vtt-fn="_vttShortRestSetMax" data-vtt-args="${Math.max(0, max - 1)}" aria-label="Retirer" ${max <= 0 ? 'disabled' : ''}>${vttSessionDockIcon('minus')}</button><b>${max}</b><button data-vtt-fn="_vttShortRestSetMax" data-vtt-args="${Math.min(20, max + 1)}" aria-label="Ajouter" ${max >= 20 ? 'disabled' : ''}>${vttSessionDockIcon('plus')}</button>
      </div></div><div class="vtt-rest-mj-actions">${rem > 0 ? `<button class="vtt-rest-action primary grow" data-vtt-fn="_vttShortRestForce">${vttSessionDockIcon('bolt')}Forcer le repos</button>` : ''}${sr.vote ? '<button class="vtt-rest-action ghost warn" data-vtt-fn="_vttShortRestCancel">Annuler le vote</button>' : ''}${used > 0 ? `<button class="vtt-rest-action ghost" data-vtt-fn="_vttShortRestResetCount">${vttSessionDockIcon('undo')}Réinitialiser</button>` : ''}</div></div>` : ''}
  </div>${!STATE.isAdmin && rem > 0 ? `<div class="vtt-rest-footer">${!onPage
    ? '<p>Tu n\'as aucun token sur la carte : tu ne participes pas à ce repos.</p>'
    : hasV
      ? `<button class="vtt-rest-action voted" data-vtt-fn="_vttShortRestUnvote">${vttSessionDockIcon('check')}<span>Tu as voté</span></button><p>Appliqué automatiquement dès que tous les joueurs présents ont voté.</p>`
      : `<button class="vtt-rest-action primary" data-vtt-fn="_vttShortRestVote">${vttSessionDockIcon('rest')}${sr.vote ? `Rejoindre le vote · ${voted.length}/${present.length}` : 'Voter pour un court repos'}</button><p>${sr.vote ? 'Le repos sera appliqué dès que les joueurs restants auront voté.' : `Le repos est pris quand les ${present.length} joueurs présents ont voté.`}</p>`}</div>` : ''}`;
  requestAnimationFrame(() => body.querySelectorAll('[data-rest-width]').forEach(bar => { bar.style.width = bar.dataset.restWidth; }));
}

// Ferme le panneau et détache le listener de clic extérieur.
function _closeShortRest() {
  const panel = document.getElementById('vtt-rest-panel');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; panel.setAttribute('aria-hidden', 'true'); }
  const trigger = document.getElementById('vtt-rest-trigger');
  trigger?.classList.remove('active');
  trigger?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', _shortRestOutsideClick);
  syncVttSessionDock();
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
    openVttSessionDockPanel('rest');
    panel.dataset.open = '1'; panel.style.display = 'flex'; panel.setAttribute('aria-hidden', 'false');
    const trigger = document.getElementById('vtt-rest-trigger');
    trigger?.classList.add('active');
    trigger?.setAttribute('aria-expanded', 'true');
    _renderShortRest();
    syncVttSessionDock();
    // Défère l'ajout du listener pour que le clic d'ouverture ne le ferme pas aussitôt.
    requestAnimationFrame(() => document.addEventListener('mousedown', _shortRestOutsideClick));
  }
}

registerVttSessionDockPanel('rest', 'vtt-rest-panel', '#vtt-rest-trigger', _closeShortRest);

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
