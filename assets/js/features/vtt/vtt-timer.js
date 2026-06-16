// ══════════════════════════════════════════════════════════════════════════════
// VTT-TIMER.JS — Minuteur de session (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// État partagé via VS.session.timer (Firestore) ; seul l'intervalId est local.
// MJ démarre/met en pause/réinitialise ; libellé éditable. Visible par tous.
// ══════════════════════════════════════════════════════════════════════════════

import { setDoc } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc } from '../../shared/html.js';
import { confirmModal, promptModal } from '../../shared/modal.js';
import { _sesRef } from './vtt-refs.js';   // ref Firestore session (leaf)

let _timerTick = null; // intervalId pour rafraîchir l'affichage

// ═══════════════════════════════════════════════════════════════════
// TIMER DE SESSION — partagé via VS.session.timer, visible par tous
// ═══════════════════════════════════════════════════════════════════
function _timerElapsedMs() {
  const t = VS.session?.timer;
  if (!t) return 0;
  const acc = +t.accumulated || 0;
  if (t.running && t.startedAt) return acc + Math.max(0, Date.now() - (+t.startedAt));
  return acc;
}
function _timerFmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function _renderTimer() {
  const el = document.getElementById('vtt-timer');
  if (!el) return;
  const t = VS.session?.timer || {};
  const mj = STATE.isAdmin;
  const running = !!t.running;
  const label = (t.label || '').toString().slice(0, 40);
  const ms = _timerElapsedMs();
  const idle = ms === 0 && !running && !label;

  // Joueur sans timer actif et sans label → on cache
  if (!mj && idle) { el.innerHTML = ''; el.classList.remove('vtt-timer--on'); return; }

  el.classList.toggle('vtt-timer--on', running);
  el.classList.toggle('vtt-timer--paused', !running && ms > 0);
  el.innerHTML = `
    <span class="vtt-timer-ico" title="${running ? 'En cours' : (ms > 0 ? 'En pause' : 'Arrêté')}">${running ? '⏱️' : (ms > 0 ? '⏸️' : '⏱️')}</span>
    <span class="vtt-timer-val">${_timerFmt(ms)}</span>
    ${label ? `<span class="vtt-timer-label" title="${_esc(label)}">${_esc(label)}</span>` : ''}
    ${mj ? `
      <span class="vtt-timer-ctrls">
        <button class="vtt-timer-btn" data-vtt-fn="_vttTimerToggle" title="${running ? 'Mettre en pause' : (ms > 0 ? 'Reprendre' : 'Démarrer')}">${running ? '⏸' : '▶'}</button>
        <button class="vtt-timer-btn" data-vtt-fn="_vttTimerReset" title="Réinitialiser">↺</button>
        <button class="vtt-timer-btn" data-vtt-fn="_vttTimerLabel" title="Modifier le libellé (Combat, Repos, Énigme…)">🏷</button>
      </span>` : ''}
  `;
}
function _timerStartTick() {
  if (_timerTick) return;
  _timerTick = setInterval(() => {
    if (VS.session?.timer?.running) _renderTimer();
  }, 1000);
}
function _timerStopTick() {
  if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
}

async function _vttTimerToggle() {
  if (!STATE.isAdmin) return;
  const t = VS.session?.timer || {};
  const now = Date.now();
  if (t.running && t.startedAt) {
    const acc = (+t.accumulated || 0) + Math.max(0, now - (+t.startedAt));
    await setDoc(_sesRef(), { timer: { ...t, running: false, accumulated: acc, startedAt: null } }, { merge: true }).catch(()=>{});
  } else {
    await setDoc(_sesRef(), { timer: { accumulated: +t.accumulated || 0, label: t.label || '', running: true, startedAt: now } }, { merge: true }).catch(()=>{});
  }
}
async function _vttTimerReset() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal('Réinitialiser le minuteur à 00:00 ?', { title: '↺ Reset minuteur', okLabel: 'Réinitialiser', cancelLabel: 'Annuler' }).catch(()=>false);
  if (!ok) return;
  const t = VS.session?.timer || {};
  await setDoc(_sesRef(), { timer: { running: false, accumulated: 0, startedAt: null, label: t.label || '' } }, { merge: true }).catch(()=>{});
}
async function _vttTimerLabel() {
  if (!STATE.isAdmin) return;
  const cur = VS.session?.timer?.label || '';
  const next = await promptModal('Libellé du minuteur (laisser vide pour effacer) :', { title: 'Minuteur', default: cur });
  if (next === null) return;
  const t = VS.session?.timer || {};
  await setDoc(_sesRef(), { timer: { ...t, label: next.trim().slice(0, 40) } }, { merge: true }).catch(()=>{});
}

export {
  _renderTimer,
  _timerElapsedMs,
  _timerFmt,
  _timerStartTick,
  _timerStopTick,
  _vttTimerLabel,
  _vttTimerReset,
  _vttTimerToggle,
};
