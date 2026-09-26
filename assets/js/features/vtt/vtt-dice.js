// ══════════════════════════════════════════════════════════════════════════════
// VTT-DICE.JS — Lanceur de dés & compétences (popover du dock 🎲)
// ══════════════════════════════════════════════════════════════════════════════
// Refonte « une seule barre » : plus d'onglet Compétences ↔ Dés. Une barre de
// commande (filtre une compétence OU détecte une formule), un corps unique
// (compétences + dés + historique), une barre de jet PARTAGÉE (mode + bonus +
// visibilité MJ + Lancer). Mode/bonus fusionnés dans VS.rollMode / VS.rollBonus
// (source unique, lus par _vttRollSkill). Historique unifié dans VS.rollHistory
// (alimenté ici ET par _vttRollSkill via un évènement DOM — pas d'import croisé).
//
// Le jet est diffusé dans le log VTT (rendu local immédiat puis Firestore).
// ══════════════════════════════════════════════════════════════════════════════

import { addDoc, serverTimestamp } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { VS } from './vtt-state.js';
import { _vttPublishOptimisticLog } from './vtt-chat.js';
import { _logGmCol } from './vtt-refs.js';
import { openVttSessionDockPanel, registerVttSessionDockPanel, syncVttSessionDock } from './vtt-session-dock.js';

// ── État local (partie « dés libres » + sélection) ──────────────────
let _diceFormula = {};          // { faces→count } ex: { 20:2, 6:1 }
let _diceQuery   = '';          // texte de la barre de commande (filtre OU formule)
let _diceSel     = null;        // { name, stat } compétence sélectionnée
let _diceCloseOut = null;
let _histWired   = false;       // écouteur d'évènement d'historique posé une fois
const _ROLL_HIST_MAX = 6;
// Mode/bonus PARTAGÉS : VS.rollMode / VS.rollBonus (lus aussi par _vttRollSkill).

// Builder de compétences injecté depuis vtt.js (contrat setJetsBuilder conservé).
let _jetsBuilder = null;
export function setJetsBuilder(fn) { _jetsBuilder = fn; }

const _ALL_DICE = [4, 6, 8, 10, 12, 20, 100];
const _clampBonus = (n) => Math.max(-20, Math.min(20, n | 0));
const _sn = (n) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '±0');
const _hasDice = (formula = _diceFormula) => Object.values(formula).some(v => v > 0);

// Formule lisible d'un objet {faces→count} : "2d6 + 1d4".
function _facesStr(formula) {
  return Object.keys(formula).map(Number).sort((a, b) => b - a)
    .filter(f => formula[f] > 0).map(f => `${formula[f]}d${f === 100 ? '%' : f}`).join(' + ');
}

// Parseur de formule aligné sur _diceFormula ({faces→count} + bonus entier).
// Accepte 2d6+3, 1d20+5, 2d6+1d4+2, d100/d%. Refuse SILENCIEUSEMENT le reste
// (→ le texte reste un filtre de compétence). Dés en `+` uniquement, un seul
// bonus plat final (positif ou négatif).
function _parseFormula(raw) {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, '').replace(/d%/g, 'd100');
  if (!s || !/^\d*d\d+(\+\d*d\d+)*([+-]\d+)?$/.test(s)) return null;
  let dicePart = s, bonus = 0;
  const tail = s.match(/[+-]\d+$/);
  if (tail) { bonus = parseInt(tail[0], 10) || 0; dicePart = s.slice(0, -tail[0].length); }
  const faces = {};
  for (const term of dicePart.split('+')) {
    if (!term) continue;
    const m = term.match(/^(\d*)d(\d+)$/);
    if (!m) return null;
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const f = parseInt(m[2], 10);
    if (!count || count > 99 || f < 2 || f > 1000) return null;   // bornes de sécurité
    faces[f] = (faces[f] || 0) + count;
  }
  if (!Object.keys(faces).length) return null;
  return { faces, bonus };
}

// ── Ouverture / fermeture du popover ────────────────────────────────
function _closeDicePanel() {
  const panel = document.getElementById('vtt-dice-panel');
  const btn   = document.getElementById('vtt-dice-trigger');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; panel.setAttribute('aria-hidden', 'true'); }
  btn?.classList.remove('active');
  btn?.setAttribute('aria-expanded', 'false');
  if (_diceCloseOut) { document.removeEventListener('mousedown', _diceCloseOut, true); _diceCloseOut = null; }
  syncVttSessionDock();
}

function _vttToggleDice() {
  const panel = document.getElementById('vtt-dice-panel'); if (!panel) return;
  // Rafraîchit le panneau quand l'état de jet partagé change (jet de compétence
  // poussé dans l'historique, bascule visibilité MJ) — via évènement DOM émis par
  // vtt-emotes.js, sans import croisé (évite la dépendance circulaire).
  if (!_histWired) {
    _histWired = true;
    document.addEventListener('vtt-roll-history', () => {
      const p = document.getElementById('vtt-dice-panel');
      if (p?.dataset.open === '1') _renderDicePanel();
    });
    // ⏎ dans la barre de commande = lancer le jet courant. Écouteur au niveau
    // document (survit à un remontage du dock ; le dispatcher VTT ignore keydown
    // sur ce champ car il est en data-vtt-on="input").
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target?.id === 'vtt-dice-cmd') { e.preventDefault(); _vttDiceCmdEnter(); }
    });
    // Dés libres : clic gauche = +1 (data-vtt-fn), clic droit = −1 (ici, sans menu).
    document.addEventListener('contextmenu', (e) => {
      const die = e.target?.closest?.('#vtt-dice-panel .vtt-dice-die-btn[data-die]');
      if (die) { e.preventDefault(); _vttDiceRemoveDie(+die.dataset.die); }
    });
  }
  if (panel.dataset.open === '1') { _closeDicePanel(); return; }
  openVttSessionDockPanel('dice');
  panel.dataset.open = '1'; panel.style.display = 'flex'; panel.setAttribute('aria-hidden', 'false');
  const trigger = document.getElementById('vtt-dice-trigger');
  trigger?.classList.add('active');
  trigger?.setAttribute('aria-expanded', 'true');
  syncVttSessionDock();
  _renderDicePanel();
  _diceCloseOut = e => { const f = document.querySelector('.vtt-dice-float'); if (f && !f.contains(e.target)) _closeDicePanel(); };
  document.addEventListener('mousedown', _diceCloseOut, true);
}

registerVttSessionDockPanel('dice', 'vtt-dice-panel', '#vtt-dice-trigger', _closeDicePanel);

// ── Handlers ────────────────────────────────────────────────────────
function _vttDiceCmdInput(v) { _diceQuery = String(v || ''); if (_diceQuery) _diceSel = null; _renderDicePanel(); }
function _vttDiceCmdEnter() { document.querySelector('#vtt-dice-panel .vtt-dice-go:not([disabled])')?.click(); }
function _vttDiceSelectSkill(name, stat) {
  _diceSel = (_diceSel && _diceSel.name === name) ? null : { name, stat };
  _diceFormula = {}; _diceQuery = '';
  _renderDicePanel();
}
function _vttDiceAddDie(f) {
  // Un premier dé libre démarre un nouveau jet : il ne doit pas hériter du
  // mode avantage/désavantage de la compétence précédemment sélectionnée.
  // Les clics suivants conservent en revanche le mode choisi pour ce jet libre.
  if (!_hasDice()) VS.rollMode = 'normal';
  _diceFormula[f] = (_diceFormula[f] || 0) + 1;
  _diceSel = null;
  _renderDicePanel();
}
function _vttDiceRemoveDie(f) { if (_diceFormula[f] > 1) _diceFormula[f]--; else delete _diceFormula[f]; _renderDicePanel(); }
function _vttDiceClear() { _diceFormula = {}; _renderDicePanel(); }
function _vttDiceMode(m) { VS.rollMode = m; _renderDicePanel(); }               // PARTAGÉ
function _vttDiceBonusStep(d) { VS.rollBonus = _clampBonus((VS.rollBonus || 0) + (+d)); _renderDicePanel(); }
function _vttDiceBonusSet(v) { VS.rollBonus = _clampBonus(parseInt(v, 10) || 0); _renderDicePanel(); }

// Cible du jet courant (ce que « Lancer » va lancer) : formule tapée > compétence
// sélectionnée > dés du plateau. `go` porte le data-vtt-fn délégué du bouton.
function _currentRoll(skills) {
  const p = _parseFormula(_diceQuery);
  if (p) {
    const fstr = _facesStr(p.faces) + (p.bonus ? ` ${p.bonus > 0 ? '+' : ''}${p.bonus}` : '');
    return { kind: 'free', source: 'Dés libres', label: fstr, ico: '🧮', color: 'var(--arcane)',
             formula: fstr, d20: p.faces[20] === 1, go: { fn: '_vttDiceRollTyped', args: '' } };
  }
  if (_diceSel) {
    const sk = (skills || []).find(s => s.name === _diceSel.name);
    return { kind: 'skill', source: 'Compétence', label: _diceSel.name, ico: '🎯',
             color: sk ? sk.statColor : 'var(--gold)', formula: `1d20 ${sk ? sk.modStr : ''}`.trim(),
             d20: true, go: { fn: '_vttRollSkill', args: `${_diceSel.name}|${_diceSel.stat}` } };
  }
  if (_hasDice()) {
    return { kind: 'free', source: 'Dés libres', label: 'Jet libre', ico: '🎲', color: 'var(--arcane)',
             formula: _facesStr(_diceFormula) || '—', d20: _diceFormula[20] === 1, go: { fn: '_vttDiceRoll', args: 'keep' } };
  }
  return null;
}

function _renderDicePanel() {
  const el = document.getElementById('vtt-dice-panel'); if (!el) return;

  const jets = _jetsBuilder ? (_jetsBuilder() || {}) : {};
  const hasSkills = !!jets.hasSkills;
  const skills = Array.isArray(jets.skills) ? jets.skills : [];
  const who = jets.who || null;
  const detected = _parseFormula(_diceQuery);
  const query = _diceQuery.trim();

  // Compétences filtrées par la barre de commande (sauf si une formule est détectée).
  const _fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nq = _fold(query);
  const visSkills = (hasSkills && !detected)
    ? skills.filter(s => !nq || _fold(s.name).includes(nq))
    : [];

  const cur = _currentRoll(skills);
  const isMj = !!STATE.isAdmin;

  // ── Barre de commande ──
  const whoAv = who
    ? (who.avatar
        ? `<img class="vtt-dice-who-av vtt-dice-who-img" src="${_esc(who.avatar)}" alt="">`
        : `<span class="vtt-dice-who-av">${_esc(who.initial)}</span>`)
    : `<span class="vtt-dice-who-av vtt-dice-who-mj">MJ</span>`;
  const whoHtml = who
    ? `<span class="vtt-dice-who">${whoAv}<b title="${_esc(who.name)}">${_esc(who.name)}</b></span>`
    : `<span class="vtt-dice-who">${whoAv}</span>`;
  const placeholder = hasSkills ? 'Compétence ou formule…' : 'Formule : 2d6+3…';
  const cmdHtml = `<div class="vtt-dice-cmd">
      ${whoHtml}
      <label class="vtt-dice-bar">${detected ? '🧮' : '🔍'}
        <input id="vtt-dice-cmd" type="text" value="${_esc(_diceQuery)}" placeholder="${placeholder}" autocomplete="off"
          data-vtt-fn="_vttDiceCmdInput" data-vtt-on="input" data-vtt-args="$value">
        ${query ? `<button type="button" title="Effacer" data-vtt-fn="_vttDiceCmdInput" data-vtt-args="">✕</button>` : ''}
      </label>
    </div>`;

  // ── Corps ──
  const detectHtml = detected ? `<div class="vtt-dice-detect">🧮<b>${_esc(_facesStr(detected.faces))}${detected.bonus ? ` ${detected.bonus > 0 ? '+' : ''}${detected.bonus}` : ''}</b><em>jet libre — ⏎ pour lancer</em></div>` : '';

  const skillsSec = (hasSkills && !detected) ? `<section class="vtt-dice-sec">
      <div class="vtt-dice-sec-hd"><span>Compétences</span>${_diceSel ? `<button type="button" class="vtt-dice-sec-btn" data-vtt-fn="_vttDiceSelectSkill" data-vtt-args="${_esc(_diceSel.name)}|${_esc(_diceSel.stat)}">Désélectionner</button>` : ''}</div>
      ${visSkills.length ? `<div class="vtt-dice-skills">${visSkills.map(s => {
        const dot = s.level === 'expert' ? ' <i style="color:var(--amber)" title="Expertise — +2 & avantage">◉</i>'
                  : s.level === 'forme'  ? ' <i style="color:var(--gold-2)" title="Maîtrisée — +2">◐</i>' : '';
        const eqDot = s.eqBonus ? ' <i style="color:var(--emerald)" title="Bonus d\'équipement">●</i>' : '';
        return `<button type="button" class="vtt-skill-btn${_diceSel && _diceSel.name === s.name ? ' on' : ''}" style="--c:${s.statColor}"
            data-vtt-fn="_vttDiceSelectSkill" data-vtt-args="${_esc(s.name)}|${_esc(s.stat)}" title="${_esc(s.title)}">
            <span class="vtt-sk-name">${_esc(s.name)}${eqDot}${dot}</span>
            <span class="vtt-sk-mod" style="color:${s.statColor}">${_esc(s.stat)} ${s.modStr}</span>
          </button>`;
      }).join('')}</div>` : `<div class="vtt-dice-empty">Aucune compétence ne correspond.</div>`}
    </section>` : '';

  const diceSec = !detected ? `<section class="vtt-dice-sec">
      <div class="vtt-dice-sec-hd"><span>Dés libres</span>${_hasDice() ? `<button type="button" class="vtt-dice-sec-btn vtt-dice-sec-btn--danger" data-vtt-fn="_vttDiceClear">Vider</button>` : ''}</div>
      <div class="vtt-dice-grid">${_ALL_DICE.map(f => {
        const cnt = _diceFormula[f] || 0; const lbl = f === 100 ? '%' : f;
        const selectedLabel = cnt ? ` · ${cnt} sélectionné${cnt > 1 ? 's' : ''}` : '';
        return `<button type="button" class="vtt-dice-die-btn${cnt ? ' active' : ''}" data-die="${f}" data-vtt-fn="_vttDiceAddDie" data-vtt-args="${f}" aria-pressed="${cnt > 0}" aria-label="d${lbl}${selectedLabel}" title="Clic gauche : +1 d${lbl} · clic droit : −1">d${lbl}${cnt ? `<span class="vtt-dice-die-cnt" aria-hidden="true">×${cnt}</span>` : ''}</button>`;
      }).join('')}</div>
    </section>` : '';

  const histSec = VS.rollHistory.length ? `<section class="vtt-dice-sec">
      <div class="vtt-dice-sec-hd"><span>Derniers jets</span></div>
      <div class="vtt-dice-hist">${VS.rollHistory.slice(0, _ROLL_HIST_MAX).map((h, i) => `
        <button type="button" class="vtt-dice-hist-item" data-vtt-fn="_vttDiceUseHistory" data-vtt-args="${i}" title="Recharger ce jet">
          <i class="vtt-hi-ico">${h.kind === 'skill' ? '🎯' : '🎲'}</i>
          <span class="vtt-hi-f">${h.kind === 'skill' ? _esc(h.label || 'Compétence') : 'Jet libre'}<b>${_esc(h.formulaStr || '')}</b></span>
          <span class="vtt-hi-t${h.crit ? ' crit' : h.fail ? ' fail' : ''}">${h.total}</span>
          <span class="vtt-hi-re" data-vtt-fn="_vttDiceRerollHistory" data-vtt-args="${i}" title="Relancer directement">🔁</span>
        </button>`).join('')}</div>
    </section>` : '';

  // ── Barre de jet partagée ──
  const modeLocked = !(cur && cur.d20);
  const bonus = VS.rollBonus || 0;
  const rollHtml = `<div class="vtt-dice-roll" style="--sc:${cur ? cur.color : 'var(--text-muted)'}">
      <div class="vtt-dice-sel${cur ? '' : ' none'}">
        <span class="vtt-dice-sel-ic">${cur ? cur.ico : '·'}</span>
        <span class="vtt-dice-sel-b"><s>${cur ? cur.source : 'Rien de sélectionné'}</s><b>${cur ? _esc(cur.label) : 'Choisis une compétence ou des dés'}</b></span>
        ${cur ? `<span class="vtt-dice-sel-f">${_esc(cur.formula)}${bonus ? ` <em>${_sn(bonus)}</em>` : ''}</span>` : ''}
      </div>
      <div class="vtt-dice-knobs">
        <div class="vtt-dice-mode${modeLocked ? ' locked' : ''}" role="group" aria-label="Mode de lancer" title="${modeLocked ? 'Disponible sur un jet à 1d20' : 'Avantage / normal / désavantage'}">
          ${[['disadvantage', '−', 'Désavantage — garde le plus bas'], ['normal', '•', 'Normal'], ['advantage', '+', 'Avantage — garde le plus haut']].map(([m, s, t]) =>
            `<button type="button" data-m="${m}" class="${VS.rollMode === m ? 'on' : ''}" data-vtt-fn="_vttDiceMode" data-vtt-args="${m}" title="${t}" aria-pressed="${VS.rollMode === m}">${s}</button>`).join('')}
        </div>
        <div class="vtt-dice-bonus${bonus ? ' set' : ''}" title="Bonus contextuel">
          <button type="button" data-vtt-fn="_vttDiceBonusStep" data-vtt-args="-1">−</button>
          <input id="vtt-bonus-val" type="number" value="${bonus}" min="-20" max="20" data-vtt-fn="_vttDiceBonusSet" data-vtt-on="input" data-vtt-args="$value">
          <button type="button" data-vtt-fn="_vttDiceBonusStep" data-vtt-args="1">＋</button>
        </div>
        ${isMj ? `<button type="button" class="vtt-dice-hide${VS.rollHidden ? ' on' : ''}" id="vtt-roll-hide-btn" data-vtt-fn="_vttToggleRollHidden" aria-pressed="${VS.rollHidden}" title="${VS.rollHidden ? 'Jet privé : seul le MJ verra le résultat' : 'Jet public : les joueurs verront le résultat'}"><span aria-hidden="true">${VS.rollHidden ? '🔒' : '👁'}</span><span>${VS.rollHidden ? 'MJ seul' : 'Public'}</span></button>` : ''}
        <button type="button" class="vtt-dice-go${cur && cur.kind !== 'skill' ? ' free' : ''}" ${cur ? `data-vtt-fn="${cur.go.fn}" data-vtt-args="${_esc(cur.go.args)}"` : 'disabled'}>${cur ? (cur.kind === 'skill' ? `Lancer ${_esc(cur.label)}` : `Lancer ${_esc(cur.formula)}`) : 'Lancer'}</button>
      </div>
    </div>`;

  // Préserve focus + curseur des champs texte ET la position de défilement du
  // corps à travers le re-rendu (l'innerHTML est remplacé → scrollTop repart à 0).
  const act = document.activeElement;
  const keepId = act && (act.id === 'vtt-dice-cmd' || act.id === 'vtt-bonus-val') ? act.id : null;
  const caret = keepId && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
  const prevScroll = el.querySelector('.vtt-dice-body')?.scrollTop || 0;

  el.innerHTML = `${cmdHtml}<div class="vtt-dice-body">${detectHtml}${skillsSec}${diceSec}${histSec}</div>${rollHtml}`;

  const newBody = el.querySelector('.vtt-dice-body');
  if (newBody && prevScroll) newBody.scrollTop = prevScroll;

  if (keepId) {
    const n = document.getElementById(keepId);
    if (n) { n.focus({ preventScroll: true }); if (caret) { try { n.setSelectionRange(caret[0], caret[1]); } catch { /* noop */ } } }
  }
}

// ── Historique : recharger / relancer ───────────────────────────────
function _vttDiceUseHistory(idx) {
  const h = VS.rollHistory[+idx]; if (!h) return;
  if (h.kind === 'skill') { _diceSel = { name: h.skillName || h.label, stat: h.stat || '' }; _diceFormula = {}; _diceQuery = ''; }
  else { _diceQuery = (h.formulaStr || '').replace(/\s/g, ''); _diceSel = null; }
  if (h.mode) VS.rollMode = h.mode;
  _renderDicePanel();
}
function _vttDiceRerollHistory(idx) {
  _vttDiceUseHistory(idx);
  document.querySelector('#vtt-dice-panel .vtt-dice-go:not([disabled])')?.click();
}

// Formule tapée dans la barre → on remplit le plateau + bonus puis on lance,
// sans toucher à la logique de _vttDiceRoll.
function _vttDiceRollTyped() {
  const p = _parseFormula(_diceQuery); if (!p) return;
  _diceFormula = { ...p.faces };
  VS.rollBonus = _clampBonus(p.bonus);
  _diceQuery = ''; _diceSel = null;
  _vttDiceRoll(true);
}

// ── Jet de dés libre (logique INCHANGÉE ; source d'état = VS.rollMode/rollBonus) ──
function _vttDiceRoll(keepPanel) {
  const faces = Object.keys(_diceFormula).map(Number).sort((a, b) => b - a);
  if (!faces.length && !VS.rollBonus) return;
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'Joueur';
  const mode = VS.rollMode || 'normal';
  const bonus = VS.rollBonus || 0;

  const groups = [];
  let total = 0;
  for (const f of faces) {
    const count = _diceFormula[f]; if (!count) continue;
    const rolls = []; let subtotal = 0;
    let kept;
    if (f === 20 && count === 1 && mode !== 'normal') {
      const r1 = Math.floor(Math.random() * 20) + 1, r2 = Math.floor(Math.random() * 20) + 1;
      kept = mode === 'advantage' ? Math.max(r1, r2) : Math.min(r1, r2);
      rolls.push(r1, r2); subtotal = kept;
    } else {
      for (let i = 0; i < count; i++) { const r = Math.floor(Math.random() * f) + 1; rolls.push(r); subtotal += r; }
    }
    const g = { faces: f, count, rolls, subtotal };
    if (kept !== undefined) g.kept = kept;
    groups.push(g);
    total += subtotal;
  }
  total += bonus;

  const fmtParts = faces.map(f => `${_diceFormula[f]}d${f === 100 ? '%' : f}`);
  if (bonus > 0) fmtParts.push(`+${bonus}`);
  else if (bonus < 0) fmtParts.push(String(bonus));
  const formula = fmtParts.join('+');

  const gmOnly = STATE.isAdmin && VS.rollHidden;
  const payload = {
    type: 'dice-free', authorId: STATE.user?.uid || null, authorName,
    formula, groups, bonus, mode, total, gmOnly,
    createdAt: serverTimestamp(),
  };
  const publish = gmOnly ? addDoc(_logGmCol(), payload) : _vttPublishOptimisticLog(payload);
  Promise.resolve(publish).catch(error => showNotif(`Erreur jet : ${error.message}`, 'error'));
  showNotif(
    gmOnly
      ? `🔒 Jet privé MJ : ${formula} = ${total} · invisible des joueurs`
      : `🎲 ${formula} = ${total}`,
    'success',
  );

  // Historique UNIFIÉ (le plus récent en tête).
  VS.rollHistory.unshift({ kind: 'free', label: 'Jet libre', formula: { ..._diceFormula }, bonus, mode, formulaStr: formula, total });
  if (VS.rollHistory.length > _ROLL_HIST_MAX) VS.rollHistory.length = _ROLL_HIST_MAX;

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
  _vttDiceCmdEnter,
  _vttDiceCmdInput,
  _vttDiceMode,
  _vttDiceRemoveDie,
  _vttDiceRerollHistory,
  _vttDiceRoll,
  _vttDiceRollTyped,
  _vttDiceSelectSkill,
  _vttDiceUseHistory,
  _vttToggleDice,
};
