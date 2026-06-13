// ══════════════════════════════════════════════════════════════════════════════
// VTT-DICE.JS — Lanceur de dés libre (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// État local (formule en cours, bonus, mode). Le jet est diffusé dans le log VTT
// (collection vttLog via _logCol importé de vtt.js).
// ══════════════════════════════════════════════════════════════════════════════

import { addDoc, serverTimestamp } from '../config/firebase.js';
import { STATE } from '../core/state.js';
import { showNotif } from '../shared/notifications.js';
import { _logCol } from './vtt.js';   // ref Firestore du log VTT (transverse)

// ── État local (lanceur libre) ──────────────────────────────────────
let _diceFormula   = {};        // { faces→count } ex: { 20:2, 6:1 }
let _diceFreeBonus = 0;
let _diceFreeMode  = 'normal';  // 'advantage'|'normal'|'disadvantage'
let _diceCloseOut  = null;
// Historique des derniers jets libres (mémoire de session, le plus récent en fin).
// Chaque entrée : { formula:{faces→count}, bonus, mode, formulaStr, total }
let _diceHistory   = [];
const _DICE_HIST_MAX = 6;

// LANCEUR DE DÉS LIBRE
// ═══════════════════════════════════════════════════════════════════
const _ALL_DICE = [4, 6, 8, 10, 12, 20, 100];

function _closeDicePanel() {
  const panel = document.getElementById('vtt-dice-panel');
  const btn   = document.getElementById('vtt-dice-trigger');
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; }
  btn?.classList.remove('active');
  if (_diceCloseOut) { document.removeEventListener('mousedown', _diceCloseOut, true); _diceCloseOut=null; }
}

function _vttToggleDice() {
  const panel = document.getElementById('vtt-dice-panel'); if (!panel) return;
  if (panel.dataset.open==='1') { _closeDicePanel(); return; }
  panel.dataset.open='1'; panel.style.display='flex';
  document.getElementById('vtt-dice-trigger')?.classList.add('active');
  _renderDicePanel();
  _diceCloseOut = e => { const f=document.querySelector('.vtt-dice-float'); if(f&&!f.contains(e.target)) _closeDicePanel(); };
  document.addEventListener('mousedown', _diceCloseOut, true);
}

function _vttDiceAddDie(f) { _diceFormula[f]=(_diceFormula[f]||0)+1; _renderDicePanel(); }
function _vttDiceRemoveDie(f) { if(_diceFormula[f]>1) _diceFormula[f]--; else delete _diceFormula[f]; _renderDicePanel(); }
function _vttDiceClear() { _diceFormula={}; _diceFreeBonus=0; _renderDicePanel(); }
function _vttDiceBonusStep(d) { _diceFreeBonus=(_diceFreeBonus||0)+d; _renderDicePanel(); }
function _vttDiceBonusSet(v) { _diceFreeBonus=isNaN(v)?0:+v; }
function _vttDiceMode(m) { _diceFreeMode=m; _renderDicePanel(); }

function _renderDicePanel() {
  const el = document.getElementById('vtt-dice-panel'); if (!el) return;
  const faces = Object.keys(_diceFormula).map(Number).sort((a,b)=>b-a);
  const hasDice = faces.some(f => _diceFormula[f]>0);
  const hasD20single = _diceFormula[20]===1;

  // Formule lisible
  const fmtParts = faces.map(f=>`${_diceFormula[f]}d${f===100?'%':f}`);
  if (_diceFreeBonus>0) fmtParts.push(`+${_diceFreeBonus}`);
  else if (_diceFreeBonus<0) fmtParts.push(String(_diceFreeBonus));
  const formulaStr = fmtParts.join(' + ') || '—';

  el.innerHTML = `
    <div class="vtt-dice-hd">
      <span>🎲 Lancer des dés</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttToggleDice" title="Fermer">✕</button>
    </div>
    <div class="vtt-dice-grid">
      ${_ALL_DICE.map(f => {
        const cnt = _diceFormula[f]||0;
        const lbl = f===100?'%':f;
        return `<button class="vtt-dice-die-btn${cnt?' active':''}"
          data-vtt-fn="_vttDiceAddDie" data-vtt-args="${f}"
          title="Clic : +1 d${lbl}${cnt?` · clic sur ×${cnt} : −1`:''}">
          d${lbl}${cnt?`<span class="vtt-dice-die-cnt" data-vtt-fn="_vttDiceRemoveDie" data-vtt-args="${f}" title="Retirer un d${lbl}">×${cnt}</span>`:''}
        </button>`;
      }).join('')}
    </div>
    <div class="vtt-dice-formula-row">
      <code class="vtt-dice-formula-str">${formulaStr}</code>
      ${hasDice?`<button class="vtt-dice-clear-btn" data-vtt-fn="_vttDiceClear">✕</button>`:''}
    </div>
    <div class="vtt-dice-bonus-row">
      <span class="vtt-dice-bonus-lbl">Bonus</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttDiceBonusStep" data-vtt-args="-1">−</button>
      <input id="vtt-dice-bonus-inp" type="number" class="vtt-dice-bonus-inp" value="${_diceFreeBonus}"
        data-vtt-fn="_vttDiceBonusSet" data-vtt-on="input" data-vtt-args="$value">
      <button class="vtt-icon-btn" data-vtt-fn="_vttDiceBonusStep" data-vtt-args="+1">＋</button>
    </div>
    ${hasD20single ? `<div class="vtt-dice-mode-row">
      <button class="vtt-roll-mode-btn${_diceFreeMode==='disadvantage'?' active':''}" data-vtt-fn="_vttDiceMode" data-vtt-args="disadvantage">⬇ Désav.</button>
      <button class="vtt-roll-mode-btn${_diceFreeMode==='normal'?' active':''}" data-vtt-fn="_vttDiceMode" data-vtt-args="normal">⚪ Normal</button>
      <button class="vtt-roll-mode-btn${_diceFreeMode==='advantage'?' active':''}" data-vtt-fn="_vttDiceMode" data-vtt-args="advantage">⬆ Avantage</button>
    </div>` : ''}
    <button class="vtt-dice-roll-btn" data-vtt-fn="_vttDiceRoll"
      ${!hasDice&&!_diceFreeBonus?'disabled':''}>
      🎲 Lancer !
    </button>
    ${_diceHistory.length ? `
      <div class="vtt-dice-hist">
        <div class="vtt-dice-hist-hd">
          <span>Derniers jets</span>
          <button class="vtt-dice-reroll-btn" data-vtt-fn="_vttDiceRerollLast" title="Relancer le dernier jet (mêmes dés)">🔁 Relancer</button>
        </div>
        <div class="vtt-dice-hist-list">
          ${_diceHistory.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => `
            <button class="vtt-dice-hist-item" data-vtt-fn="_vttDiceUseHistory" data-vtt-args="${i}" title="Réutiliser ${h.formulaStr}">
              <span class="vtt-dice-hist-formula">${h.formulaStr}</span>
              <span class="vtt-dice-hist-eq">=</span>
              <span class="vtt-dice-hist-total">${h.total}</span>
            </button>`).join('')}
        </div>
      </div>` : ''}`;
}

// Relance le dernier jet (même formule/bonus/mode, nouveaux dés). Garde le
// panneau ouvert pour enchaîner les relances en séance.
function _vttDiceRerollLast() {
  const last = _diceHistory[_diceHistory.length - 1];
  if (!last) return;
  _diceFormula   = { ...last.formula };
  _diceFreeBonus = last.bonus || 0;
  _diceFreeMode  = last.mode || 'normal';
  _vttDiceRoll(true);
}

// Réutilise une formule de l'historique : la recharge dans le constructeur
// (sans lancer) pour pouvoir l'ajuster puis relancer.
function _vttDiceUseHistory(idx) {
  const h = _diceHistory[+idx];
  if (!h) return;
  _diceFormula   = { ...h.formula };
  _diceFreeBonus = h.bonus || 0;
  _diceFreeMode  = h.mode || 'normal';
  _renderDicePanel();
}

function _vttDiceRoll(keepPanel) {
  const faces = Object.keys(_diceFormula).map(Number).sort((a,b)=>b-a);
  if (!faces.length && !_diceFreeBonus) return;
  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';

  const groups = [];
  let total = 0;
  for (const f of faces) {
    const count = _diceFormula[f]; if (!count) continue;
    const rolls = []; let subtotal = 0;
    let kept;
    if (f===20 && count===1 && _diceFreeMode!=='normal') {
      const r1=Math.floor(Math.random()*20)+1, r2=Math.floor(Math.random()*20)+1;
      kept = _diceFreeMode==='advantage' ? Math.max(r1,r2) : Math.min(r1,r2);
      rolls.push(r1,r2); subtotal=kept;
    } else {
      for(let i=0;i<count;i++){ const r=Math.floor(Math.random()*f)+1; rolls.push(r); subtotal+=r; }
    }
    const g = { faces:f, count, rolls, subtotal };
    if (kept !== undefined) g.kept = kept;
    groups.push(g);
    total += subtotal;
  }
  total += (_diceFreeBonus||0);

  const fmtParts = faces.map(f=>`${_diceFormula[f]}d${f===100?'%':f}`);
  if (_diceFreeBonus>0) fmtParts.push(`+${_diceFreeBonus}`);
  else if (_diceFreeBonus<0) fmtParts.push(String(_diceFreeBonus));
  const formula = fmtParts.join('+');

  addDoc(_logCol(), {
    type:'dice-free', authorId:STATE.user?.uid||null, authorName,
    formula, groups, bonus:_diceFreeBonus||0, mode:_diceFreeMode, total,
    createdAt:serverTimestamp(),
  }).catch(()=>{});
  showNotif(`🎲 ${formula} = ${total}`, 'success');

  // Mémorise le jet (pour « relancer » / rappel des derniers).
  _diceHistory.push({ formula:{ ..._diceFormula }, bonus:_diceFreeBonus||0, mode:_diceFreeMode, formulaStr:formula, total });
  if (_diceHistory.length > _DICE_HIST_MAX) _diceHistory.shift();

  if (keepPanel) _renderDicePanel();
  else _closeDicePanel();
}

export {
  _closeDicePanel,
  _renderDicePanel,
  _vttDiceAddDie,
  _vttDiceBonusSet,
  _vttDiceBonusStep,
  _vttDiceClear,
  _vttDiceMode,
  _vttDiceRemoveDie,
  _vttDiceRoll,
  _vttDiceRerollLast,
  _vttDiceUseHistory,
  _vttToggleDice,
};
