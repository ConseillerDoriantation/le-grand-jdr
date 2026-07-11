// ══════════════════════════════════════════════════════════════════════════════
// VTT-COMBAT-TRACKER.JS — Overlay d'ordre de combat (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// Overlay haut-gauche visible quand un combat est actif. Rendu d'après les tokens
// (VS.tokens, données effectives via _live) et l'état de combat (VS.session).
// Les contrôles MJ (démarrer/tour/flags) sont des handlers data-vtt-fn de vtt.js.
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc } from '../../shared/html.js';
import { _live } from './vtt-effective.js';   // données effectives (leaf)
import { _select } from './vtt.js';           // sélection token (transverse)

let _combatTab = 'allies'; // 'allies' (joueurs + PNJ) | 'enemies' (MJ only)
// Suit l'état "combat actif affiché" pour ne déclencher l'animation de
// déploiement du tracker QU'à l'ouverture (pas à chaque re-render de tour).
let _trackerWasActive = false;

// COMBAT TRACKER — overlay haut-gauche, visible quand combat actif
// ═══════════════════════════════════════════════════════════════════
function _trackerPortrait(ld, t) {
  // Photo prioritaire : fiche perso/PNJ via _live (champ displayImage)
  const url = ld.displayImage || null;
  if (url) return `<img class="vct-photo" src="${url}" alt="">`;
  const init = ((ld.displayName || t.name || '?').trim()[0] || '?').toUpperCase();
  return `<div class="vct-photo vct-photo-init">${init}</div>`;
}
function _trackerRow(t) {
  const ld = _live(t);
  const moved = !!t.movedThisTurn || (t.movedCells || 0) > 0;
  const acted = !!t.attackedThisTurn;
  const bonusActed = !!t.bonusActionThisTurn;
  const reacted = !!t.reactionThisTurn;
  const done  = moved && acted;
  const partial = moved !== acted;
  const cls = done ? "vct-row--done" : (partial ? "vct-row--partial" : "vct-row--todo");
  const name = _esc(ld.displayName || t.name || "—");
  const turnPill = (field, active, icon, title) => STATE.isAdmin
    ? `<button type="button" class="vct-pill vct-pill--toggle ${active ? "vct-pill--on" : ""}" data-vtt-fn="_vttToggleTurnFlag" data-vtt-args="${t.id}|${field}" title="${title} — cliquer pour modifier">${icon} ${active ? "✓" : "·"}</button>`
    : `<span class="vct-pill ${active ? "vct-pill--on" : ""}" title="${title}">${icon} ${active ? "✓" : "·"}</span>`;
  return `
    <div class="vct-row ${cls}" data-tok="${t.id}" data-vtt-fn="_vttTrackerFocus" data-vtt-args="${t.id}" title="Cliquer pour centrer sur ce token">
      ${_trackerPortrait(ld, t)}
      <div class="vct-info">
        <div class="vct-name">${name}</div>
        <div class="vct-status">
          <span class="vct-pill ${moved ? "vct-pill--on" : ""}" title="Déplacement effectué">🏃 ${moved ? "✓" : "·"}</span>
          <span class="vct-pill ${acted ? "vct-pill--on" : ""}" title="Action effectuée">⚔ ${acted ? "✓" : "·"}</span>
          ${turnPill("bonusActionThisTurn", bonusActed, "✦", "Action bonus effectuée")}
          ${turnPill("reactionThisTurn", reacted, "⚡", "Réaction effectuée")}
        </div>
      </div>
    </div>`;
}
function _renderCombatTracker() {
  const el = document.getElementById('vtt-combat-tracker');
  if (!el) return;
  const active = !!VS.session?.combat?.active;
  const mj = STATE.isAdmin;

  // Combat inactif :
  //   - MJ → carte compacte avec bouton "Démarrer le combat"
  //   - Joueur → masqué
  if (!active) {
    _trackerWasActive = false;
    if (!mj) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    const idleRound = VS.session?.combat?.round ?? 0;
    el.innerHTML = `
      <div class="vct-header vct-header--idle">
        <div class="vct-title">
          <span class="vct-title-ico">⚔️</span>
          <span class="vct-title-txt vct-title-txt--idle">Combat</span>
          ${idleRound > 0 ? `<span class="vct-round">Tour ${idleRound}</span>` : ''}
        </div>
        <div class="vct-mj-ctrls">
          <button class="vct-mj-btn" data-vtt-fn="_vttNextRound" title="Passer un tour — fait expirer les états, buffs et invocations à durée, sans lancer le combat">⏭ Tour</button>
          <button class="vct-mj-btn vct-mj-btn--start" data-vtt-fn="_vttToggleCombat" title="Démarrer le combat — reset déplacement et actions de tous les tokens">▶ Démarrer</button>
        </div>
      </div>`;
    return;
  }
  // Déploiement : joue UNIQUEMENT à la transition inactif → combat actif.
  const justOpened = !_trackerWasActive;
  _trackerWasActive = true;
  el.style.display = 'block';
  if (justOpened) {
    el.classList.remove('vct-enter');
    void el.offsetWidth;                 // reflow → permet de (re)jouer l'anim
    el.classList.add('vct-enter');
    el.addEventListener('animationend', () => el.classList.remove('vct-enter'), { once: true });
  }

  const round = VS.session?.combat?.round ?? 1;
  const pageId = VS.activePage?.id;
  const onPage = Object.values(VS.tokens).map(x => x?.data || x).filter(t => t && t.pageId === pageId);
  const allies = onPage.filter(t => t.type === 'player' || t.type === 'npc');
  const enemies = onPage.filter(t => t.type === 'enemy');

  // tab par défaut "allies" — joueurs non-MJ ne voient pas l'onglet ennemis
  const tab = (!mj && _combatTab === 'enemies') ? 'allies' : _combatTab;
  const list = tab === 'enemies' ? enemies : allies;

  // tri : joueurs d'abord, puis PNJ ; ennemis par HP% croissant
  if (tab === 'allies') {
    list.sort((a, b) => {
      const r = (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
      if (r !== 0) return r;
      const na = _live(a).displayName || a.name || '';
      const nb = _live(b).displayName || b.name || '';
      return na.localeCompare(nb);
    });
  }

  const rows = list.length
    ? list.map(_trackerRow).join('')
    : `<div class="vct-empty">${tab === 'enemies' ? 'Aucun ennemi sur la page' : 'Aucun token allié sur la page'}</div>`;

  el.innerHTML = `
    <div class="vct-header">
      <div class="vct-title">
        <span class="vct-title-ico">⚔️</span>
        <span class="vct-title-txt">Combat</span>
        <span class="vct-round">Tour ${round}</span>
      </div>
      ${mj ? `
        <div class="vct-mj-ctrls">
          <button class="vct-mj-btn" data-vtt-fn="_vttNextRound" title="Tour suivant — reset déplacement et actions">▶ Tour</button>
          <button class="vct-mj-btn vct-mj-btn--danger" data-vtt-fn="_vttToggleCombat" title="Terminer le combat">⏹</button>
        </div>` : ''}
    </div>
    ${mj ? `
      <div class="vct-tabs">
        <button class="vct-tab ${tab==='allies' ? 'active' : ''}" data-vtt-fn="_vttCombatTab" data-vtt-args="allies">👥 Joueurs &amp; PNJ <span class="vct-tab-count">${allies.length}</span></button>
        <button class="vct-tab ${tab==='enemies' ? 'active' : ''}" data-vtt-fn="_vttCombatTab" data-vtt-args="enemies">👹 Ennemis <span class="vct-tab-count">${enemies.length}</span></button>
      </div>` : ''}
    <div class="vct-list">${rows}</div>
  `;
}
// Re-render groupé via microtask (évite les multi-rerender lors d'un batch reset)
let _trackerDirty = false;
function _renderCombatTrackerSoon() {
  if (_trackerDirty) return;
  _trackerDirty = true;
  queueMicrotask(() => { _trackerDirty = false; _renderCombatTracker(); });
}

function _vttCombatTab(tab) {
  if (tab !== 'allies' && tab !== 'enemies') return;
  if (tab === 'enemies' && !STATE.isAdmin) return;
  _combatTab = tab;
  _renderCombatTracker();
}
function _vttTrackerFocus(tokId) {
  // Centrer/sélectionner le token cliqué
  const t = VS.tokens[tokId]?.data;
  if (!t) return;
  if (STATE.isAdmin || t.type !== 'enemy') {
    try { _select(tokId); } catch {}
  }
}

export {
  _renderCombatTracker,
  _renderCombatTrackerSoon,
  _trackerPortrait,
  _trackerRow,
  _vttCombatTab,
  _vttTrackerFocus,
};
