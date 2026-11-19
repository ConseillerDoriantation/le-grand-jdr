// ==============================================================================
// VTT — Inspecteur de token (panneau de détails de la sélection)
// ------------------------------------------------------------------------------
// Rend le panneau du token sélectionné (stats, PV/PM, CA, états, buffs, actions,
// équipement, sorts, inventaire). Lecture seule + boutons data-vtt-fn (résolus au
// clic). Extrait de vtt.js (cf. docs/vtt-decomposition.md). Imports circulaires
// runtime vers vtt.js (helpers combat/contrôle).
// ==============================================================================
import { VS } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { _esc, _searchIncludes } from '../../shared/html.js';
import { computeEquipSkillBonus, statShort, calcCA, calcGardeMax } from '../../shared/char-stats.js';
import { normalizeCharacterBuilds } from '../../shared/character-builds.js';
import { getCharacterDelegates } from '../../shared/character-state.js';
import { hpColor, TYPE_COLOR, _STAT_COLOR, _STAT_KEY, _MS_BONUS_BUFF, _VTT_RUNE_META } from './vtt-constants.js';
import { DAMAGE_INTERACTIONS } from '../../shared/damage-profile.js';
import { getDamageTypeById } from '../../shared/damage-types.js';
import { runeBadges, spellTypeBadges } from '../../shared/spell-action-card.js';
import { explainTokenStat, summarizeTokenEffects, tokenEffectTone } from '../../shared/token-effects-summary.js';
import { _live } from './vtt-effective.js';
import { _renderDicePanel } from './vtt-dice.js';
import { _vttPanelError } from './vtt-utils.js';
import { controlledCharacterTokens, invocableCharacterTokens, resolveControlledTokenId } from './vtt-token-control.js';
import {
  _canControlToken, _npcCombat, _tokenStatMod, _manualBuffVal, _signed,
  CONDITION_BY_ID, _resolveUidName, _getCombatMoveOrigin, _vttClearBuffs,
} from './vtt.js'; // circ. (runtime)

let _insTab = null;             // bulle ouverte : stats | effets | gerer | bestiaire | notes
// (Le panneau « Jets » a été fusionné dans le lanceur de dés du dock — vtt-dice.js.)
let _inspectorDirty = false;    // coalescing des rafales de snapshots → 1 render/tick
let _skillFilter = '';          // filtre live du panneau « Jets de compétences »
let _openResourceKey = null;    // PV / PM / Garde : reste ouvert pendant une série de réglages
let _resourceOutsideBound = false;
let _inspectorPopoverBound = false;
let _conditionPickerOpen = false;
let _manageSendOpen = false;
let _manageDelegateOpen = false;
let _purgeArmedUntil = 0;
let _purgeTimer = null;
let _lastAnimatedPopover = null;
// Regroupement des compétences par caractéristique (scan plus rapide pour le joueur).
const _SK_STAT_ORDER = ['FOR', 'DEX', 'CON', 'INT', 'SAG', 'CHA', ''];
const _SK_STAT_LABEL = { FOR:'Force', DEX:'Dextérité', CON:'Constitution', INT:'Intelligence', SAG:'Sagesse', CHA:'Charisme', '':'Autres' };

const _INS_ICONS = {
  stats: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  effects: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  manage: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  move: '<path d="M13 4a1.6 1.6 0 110 .01M9 20l2.5-6 3 2.5V21M8 11l3-3 3.5 2 2.5 3.5M11.5 8L9.5 13"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.3-3 7.7-7 9.5-4-1.8-7-5.2-7-9.5V6z"/>',
  range: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  sword: '<path d="M14.5 4H20v5.5L10 19.5 4.5 14z"/><path d="M7 16.5L3.5 20M5 12.5l6.5 6.5"/>',
  pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  reset: '<path d="M4 12a8 8 0 108-8H9"/><path d="M11 1L8 4l3 3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M4 20.5A2.5 2.5 0 016.5 18H20v3H6.5"/>',
  sheet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0112 5c6.4 0 10 7 10 7a17.4 17.4 0 01-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  wand: '<path d="M4 20L15 9M14 4v2M18 6l-1.4 1.4M20 10h-2M12 8l4 4"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  paw: '<circle cx="7" cy="10" r="2"/><circle cx="17" cy="10" r="2"/><circle cx="10" cy="5.5" r="1.8"/><circle cx="14" cy="5.5" r="1.8"/><path d="M8 17c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5-1.8 3-4 3-4-.5-4-3z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  turn: '<path d="M20 12a8 8 0 11-3-6.2"/><path d="M20 4v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  dots: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
};

function _insIcon(name, className = '') {
  return `<svg class="vtt-ins-icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${_INS_ICONS[name] || ''}</svg>`;
}

function _buildTokenBuildSwitcher(t) {
  if (!t?.characterId) return '';
  const c = VS.characters[t.characterId];
  if (!c) return '';
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  if (builds.length <= 1) return '';
  const canSwitch = _canControlToken(t);
  const buildButtons = builds.map(b =>
    `<button type="button" class="vtt-ins-build-option ${b.id === activeBuildId ? 'active' : ''}"
      data-vtt-fn="_vttSwitchCharacterBuild" data-vtt-args="${_esc(t.characterId)}|${_esc(b.id)}"
      aria-pressed="${b.id === activeBuildId}" ${canSwitch ? '' : 'disabled'}>${_esc(b.name || 'Build')}</button>`
  ).join('');
  return `<section class="vtt-ins-drawer-section vtt-ins-build-section">
    <div class="vtt-ins-section-heading"><span>Build actif</span></div>
    <div class="vtt-ins-build-switch" role="group" aria-label="Build actif">${buildButtons}</div>
  </section>`;
}

export function _renderInspectorSoon() {
  if (_inspectorDirty) return;
  _inspectorDirty = true;
  queueMicrotask(() => {
    _inspectorDirty = false;
    // Ne pas reconstruire le panneau pendant que le joueur tape dans le filtre de
    // compétences (perte de focus + reset). On diffère le rendu tant qu'il a le focus.
    if (document.activeElement?.matches?.('.vtt-skill-filter-input, .vtt-vital-input')) {
      setTimeout(_renderInspectorSoon, 400);
      return;
    }
    // Pour un joueur, le panneau peut présenter son personnage même avant une
    // sélection explicite. Le MJ reste piloté uniquement par la sélection.
    const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
    _renderInspector(t);
    // L'ouverture du HUD d'actions est volontairement explicite via le bouton Actions.
  });
}

// ── Frontière d'erreur par panneau VTT → vtt-utils.js (importé en haut) ───────

// Suit la dernière sélection rendue pour n'animer l'entrée de l'inspecteur QU'au
// changement de token (pas à chaque re-render dû à un +/- de PV, un tour, etc.).
let _insLastSelKey = null;

function _defaultInspectorToken(t) {
  if (t) return t;
  if (STATE.isAdmin) return null;              // MJ : panneau piloté par la sélection
  const uid = STATE.user?.uid; if (!uid) return null;
  const pageId = VS.activePage?.id;
  const controlled = controlledCharacterTokens(VS.tokens, token => _canControlToken(token, uid));
  const onPage = pageId ? controlled.filter(token => token.pageId === pageId) : [];
  // Un token en réserve ne doit pas apparaître comme s'il était déjà posé :
  // l'état vide du pupitre propose alors explicitement de l'invoquer.
  return onPage.find(token => {
    const character = VS.characters[token.characterId];
    return character?.uid === uid && character?.isDefault;
  }) || onPage.find(token => VS.characters[token.characterId]?.uid === uid)
    || onPage.find(token => VS.characters[token.characterId]?.isDefault)
    || onPage[0] || null;
}

function _wireResourceEditors(el) {
  const editors = [...el.querySelectorAll('details.vtt-resource[data-resource]')];
  editors.forEach(editor => editor.addEventListener('toggle', () => {
    const key = editor.dataset.resource || null;
    if (editor.open) {
      _openResourceKey = key;
      editors.forEach(other => { if (other !== editor) other.open = false; });
    } else if (_openResourceKey === key) {
      _openResourceKey = null;
    }
  }));

  if (_resourceOutsideBound) return;
  _resourceOutsideBound = true;
  document.addEventListener('pointerdown', event => {
    const openEditor = document.querySelector('#vtt-inspector details.vtt-resource[open]');
    if (!openEditor || openEditor.contains(event.target)) return;
    _openResourceKey = null;
    openEditor.open = false;
  }, true);
}

function _syncInspectorPopoverGeometry() {
  const panel = document.querySelector('#vtt-inspector .vtt-fiche-panel');
  const fiche = document.querySelector('#vtt-inspector .vtt-fiche');
  const dock = document.querySelector('.vtt-fiche-dock');
  const anchor = document.querySelector(`#vtt-inspector [data-ins-anchor="${_insTab || ''}"]`);
  if (!panel || !fiche || !dock || !anchor) return;
  const topbar = document.querySelector('.vtt-band, .vtt-toolbar, .vtt-topbar, .vtt-session-bar');
  const usefulTop = Math.max(8, topbar?.getBoundingClientRect?.().bottom || 8);
  const widths = { stats:340, effets:340, gerer:310, bestiaire:360, notes:340 };
  const width = Math.min(widths[_insTab] || 340, window.innerWidth - 16);
  panel.style.width = `${width}px`;
  const ficheRect = fiche.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const viewportLeft = Math.max(8, Math.min(window.innerWidth - width - 8, anchorCenter - width / 2));
  panel.style.left = `${Math.round(viewportLeft - dockRect.left)}px`;
  panel.style.bottom = `${Math.round(dockRect.bottom - ficheRect.top + 12)}px`;
  panel.style.maxHeight = `${Math.max(180, Math.round(ficheRect.top - usefulTop - 12))}px`;
  panel.style.setProperty('--ax', `${Math.max(18, Math.min(width - 18, anchorCenter - viewportLeft))}px`);
}

function _closeInspectorPopoverDom() {
  _insTab = null;
  _conditionPickerOpen = false;
  _manageSendOpen = false;
  _manageDelegateOpen = false;
  _lastAnimatedPopover = null;
  document.querySelector('#vtt-inspector .vtt-fiche-panel')?.remove();
  document.querySelectorAll('#vtt-inspector [data-ins-anchor].active').forEach(anchor => {
    anchor.classList.remove('active');
    anchor.setAttribute('aria-expanded', 'false');
  });
}

function _wireInspectorPopover() {
  requestAnimationFrame(_syncInspectorPopoverGeometry);
  if (_inspectorPopoverBound) return;
  _inspectorPopoverBound = true;
  window.addEventListener('resize', _syncInspectorPopoverGeometry);
  document.addEventListener('pointerdown', event => {
    if (!_insTab || event.target.closest('#vtt-inspector .vtt-fiche-panel, #vtt-inspector [data-ins-anchor]')) return;
    _closeInspectorPopoverDom();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !_insTab) return;
    if (_conditionPickerOpen) {
      _conditionPickerOpen = false;
      const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
      _renderInspector(t);
      return;
    }
    _insTab = null;
    _lastAnimatedPopover = null;
    const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
    _renderInspector(t);
  });
}

export function _vttInsFilterConditionPicker(value = '') {
  document.querySelectorAll('#vtt-inspector .vtt-condition-pick').forEach(button => {
    button.hidden = !_searchIncludes(button.dataset.search || '', value);
  });
}
export function _renderInspector(t) {
  const resolved = t ?? (!STATE.isAdmin && !VS.selected ? _defaultInspectorToken(null) : t);
  try {
    const result = _renderInspectorImpl(resolved);
    // La désélection MJ doit immédiatement remplacer les modificateurs de l'ancien
    // token par les jets neutres MJ, même si _renderInspectorImpl sort tôt.
    if (document.getElementById('vtt-dice-panel')?.dataset.open === '1') {
      try { _renderDicePanel(); } catch {}
    }
    return result;
  }
  catch (e) { _vttPanelError('Inspecteur', e, 'vtt-inspector'); }
}
export function _renderInspectorImpl(t) {
  const el=document.getElementById('vtt-inspector'); if (!el) return;
  const previousScroll = document.querySelector('#vtt-inspector .vtt-fiche-panel-body')?.scrollTop || 0;
  // Entrée animée : uniquement quand la sélection CHANGE (≠ re-render PV/tour).
  const _selKey = VS.selectedMulti.size>1 ? `multi:${VS.selectedMulti.size}` : (t?.id || null);
  if (_selKey !== _insLastSelKey) {
    _openResourceKey = null;
    _insTab = null;
    _conditionPickerOpen = false;
    _manageSendOpen = false;
    _manageDelegateOpen = false;
    _lastAnimatedPopover = null;
  }
  if (_selKey && _selKey !== _insLastSelKey) {
    el.classList.remove('vtt-ins-enter');
    void el.offsetWidth;                 // reflow → (re)joue l'anim
    el.classList.add('vtt-ins-enter');
    el.addEventListener('animationend', () => el.classList.remove('vtt-ins-enter'), { once: true });
  }
  _insLastSelKey = _selKey;
  // Multi-sélection active
  if (VS.selectedMulti.size>1) {
    delete el.dataset.tokenId;
    const types=[...VS.selectedMulti].map(id=>VS.tokens[id]?.data?.type).filter(Boolean);
    const uniq=t=>({player:'🧑 Joueurs',enemy:'👹 Ennemis',npc:'👤 PNJ'})[t]||t;
    const typeStr=[...new Set(types)].map(uniq).join(' · ');
    el.innerHTML=`<div class="vtt-ins-multi">
      <div style="font-size:2rem;text-align:center">↖↖</div>
      <div class="vtt-ins-name" style="text-align:center">${VS.selectedMulti.size} tokens</div>
      <div class="vtt-ins-type" style="text-align:center">${typeStr}</div>
      <div style="font-size:.72rem;color:var(--text-dim);text-align:center;margin-top:.5rem;line-height:1.4">
        Glisse un token pour<br>déplacer tout le groupe
      </div>
    </div>`;
    return;
  }
  if (!t) {
    delete el.dataset.tokenId;
    const canInvoke = !STATE.isAdmin && invocableCharacterTokens(
      VS.tokens,
      VS.activePage?.id,
      token => _canControlToken(token),
    ).length > 0;
    const invokeBtn = canInvoke
      ? `<button type="button" class="vtt-empty-invoke" data-vtt-fn="_vttInvokeMyToken" title="Placer un personnage contrôlé sur la carte"><span aria-hidden="true">＋</span><b>Invoquer mon token</b></button>`
      : '';
    const hint = canInvoke ? 'Choisis un token ou place ton personnage' : 'Clique sur un token du plateau';
    el.innerHTML = `<div class="vtt-fiche vtt-fiche--compact vtt-fiche--empty">
      <span class="vtt-empty-token" aria-hidden="true">◎</span>
      <span class="vtt-empty-copy"><b>Sélectionne un token</b><small>${hint}</small></span>
      ${invokeBtn}
    </div>`;
    return;
  }
  el.dataset.tokenId = t.id || '';
  const ld=_live(t);
  // PV inconnus (joueur sur un ennemi sans estimation) : « ? », jamais un 20/20 inventé.
  const hpKnown = ld.displayHp != null && ld.displayHpMax != null;
  const hp = hpKnown ? ld.displayHp : '?', hpm = hpKnown ? ld.displayHpMax : '?';
  const rat = hpKnown && hpm > 0 ? Math.max(0, hp / hpm) : (hpKnown ? 1 : 0);
  const hpCol = hpKnown ? hpColor(rat) : '#64748b';
  const icon={player:'🧑',enemy:'👹',npc:'👤'}[t.type]??'🎭';
  const lbl={player:'Joueur',enemy:'Ennemi',npc:'PNJ'}[t.type]??t.type;
  const img=ld.displayImage;
  const buildSwitcherHtml = _buildTokenBuildSwitcher(t);

  const pageTargets=STATE.isAdmin
    ? Object.values(VS.pages).filter(p=>p.id!==t.pageId)
    : [];
  const _r = VS.session?.combat?.round ?? 0;
  const _effectIsActive = effect => effect?.expiresAtRound == null || _r === 0 || _r <= effect.expiresAtRound;

  // ── Helpers rendu stats ──────────────────────────────────────────
  const _bar = (lbl, cur, max, col, editHtml='', actionHtml='') => {
    const pct = max > 0 ? Math.round(Math.max(0, cur) / max * 100) : 0;
    const val = editHtml
      ? editHtml + '<span style="color:var(--text-muted)"> / '+max+'</span>'
      : '<span>'+cur+' / '+max+'</span>';
    return '<div class="vtt-ins-bar-row'+(actionHtml?' has-action':'')+'">' +
      '<span class="vtt-ins-bar-lbl">'+lbl+'</span>' +
      '<div class="vtt-ins-bar-track"><div class="vtt-ins-bar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>' +
      '<span class="vtt-ins-bar-val">'+val+'</span>' +
      actionHtml +
    '</div>';
  };
  // Précalcul du bloc stats (évite l'imbrication de backticks dans le template)
  // vitalsHtml = barres PV/PM (épinglées sous le header) · coreStatsHtml = onglet Stats
  let vitalsHtml = '', turnStatsHtml = '', coreStatsHtml = '';
  if (!STATE.isAdmin && t.type === 'enemy' && t.beastId) {
    const track    = VS.bstTracker[t.beastId] || {};
    const pvMax    = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
    const pvCur    = ld.displayHp !== null ? ld.displayHp : pvMax;
    const pvPct    = pvMax > 0 ? Math.round((pvCur??pvMax) / pvMax * 100) : 0;
    const pvBarCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';
    const caLabel  = track.caEstimee  !== undefined && track.caEstimee  !== '' ? String(track.caEstimee)  : '?';
    const vitLabel = track.vitEstimee !== undefined && track.vitEstimee !== '' ? String(track.vitEstimee)+' cases' : '?';
    vitalsHtml =
      '<div class="vtt-ins-bars">' +
        (pvMax !== null
          ? _bar('PV', pvCur??pvMax, pvMax, pvBarCol)
          : '<div class="vtt-ins-bar-row"><span class="vtt-ins-bar-lbl">PV</span><span style="color:var(--text-muted);font-size:.75rem;grid-column:2/-1">inconnus</span></div>') +
      '</div>';
    coreStatsHtml =
      `<div class="vtt-ins-player-hint">${_insIcon('book')}<span>Ce que tu sais de cette créature. Tes estimations sont partagées avec ton Bestiaire.</span></div>` +
      '<div class="vtt-stat-grid vtt-stat-grid--estimates">' +
        `<div class="vtt-stat-card"><div class="vtt-stat-card-hd">${_insIcon('shield')}CA estimée</div><div class="vtt-stat-card-v">${_esc(caLabel)}</div></div>` +
        `<div class="vtt-stat-card"><div class="vtt-stat-card-hd">${_insIcon('move')}Vitesse est.</div><div class="vtt-stat-card-v">${_esc(vitLabel)}</div></div>` +
        `<div class="vtt-stat-card"><div class="vtt-stat-card-hd">${_insIcon('effects')}PV estimés</div><div class="vtt-stat-card-v">${pvMax !== null ? _esc(String(pvMax)) : '?'}</div></div>` +
      '</div>';
  } else {
    const pm     = ld.displayPm    ?? null;
    const pmMax  = ld.displayPmMax ?? null;
    const npcCombat = t.npcId ? _npcCombat(VS.npcs[t.npcId]) : {};
    const npcWeapon = npcCombat.weapon || {};
    const atkLabel = t.npcId
      ? (npcWeapon.nom || npcCombat.weaponName ? (npcWeapon.nom || npcCombat.weaponName) + ' · ' : '') + (ld.displayAttackDice || '1d6') + _signed(ld.displayAttack ?? 0)
      : (ld.displayAttackDice || (ld.displayAttack??5));
    const _canEditToken = _canControlToken(t);
    const _inCombat = !!VS.session?.combat?.active;
    const pvEditHtml = (_canEditToken && hpKnown)
      ? '<input class="vtt-ins-input" type="number" value="'+hp+'" min="0" max="'+hpm+'" data-vtt-fn="_vttSetHp" data-vtt-on="change" data-vtt-args="'+t.id+'|$value">'
      : null;
    const pvMaxHtml = (_canEditToken && hpKnown)
      ? '<button type="button" class="vtt-ins-max-btn" data-vtt-fn="_vttSetHp" data-vtt-args="'+t.id+'|'+hpm+'" title="Rétablir tous les PV">Max</button>'
      : '';
    const pmEditHtml = (_canEditToken && pm !== null && pmMax !== null)
      ? '<input class="vtt-ins-input" type="number" value="'+pm+'" min="0" max="'+pmMax+'" data-vtt-fn="_vttSetPm" data-vtt-on="change" data-vtt-args="'+t.id+'|$value">'
      : null;
    const pmMaxHtml = (_canEditToken && pm !== null && pmMax !== null)
      ? '<button type="button" class="vtt-ins-max-btn" data-vtt-fn="_vttSetPm" data-vtt-args="'+t.id+'|'+pmMax+'" title="Rétablir tous les PM">Max</button>'
      : '';
    // Bonus manuels « du tour » via les BUFFS du token. ld.display* les inclut
    // DÉJÀ (move_bonus / ca / range_bonus) → ne pas re-additionner. Le badge
    // affiche juste la part manuelle. Éditable par qui contrôle le token.
    const _badge = (k) => { const b = _manualBuffVal(t, k); return b ? `<sup class="vtt-ins-bonus ${b>0?'pos':'neg'}">${b>0?'+':''}${b}</sup>` : ''; };
    const _steps = (k) => _canEditToken
      ? `<span class="vtt-ins-stat-steps">`+
          `<button class="vtt-ins-stat-step" data-vtt-fn="_vttTokenBonus" data-vtt-args="${t.id}|${k}|-1" title="−1">−</button>`+
          `<button class="vtt-ins-stat-step" data-vtt-fn="_vttTokenBonus" data-vtt-args="${t.id}|${k}|1" title="+1">+</button>`+
        `</span>` : '';
    vitalsHtml =
      '<div class="vtt-ins-bars">' +
        _bar('PV', hp, hpm, hpCol, pvEditHtml, pvMaxHtml) +
        (pm !== null && pmMax !== null ? _bar('PM', pm, pmMax, '#b47fff', pmEditHtml, pmMaxHtml) : '') +
      '</div>';
    coreStatsHtml = (() => {
      const baseMvt = ld.displayMovement ?? 6;   // inclut déjà le buff move_bonus manuel
      const maxMvt  = baseMvt + (t.bonusMvt||0);
      const rem     = _inCombat ? Math.max(0, maxMvt - (t.movedCells||0)) : null;
      const mvVal   = _inCombat ? `${rem}<i class="vtt-stat-den">/${maxMvt}</i>` : `${baseMvt}`;
      const mvCol   = _inCombat ? (rem===0?'#f87171':rem<=2?'#f59e0b':'#4ade80') : 'var(--text)';
      const origin  = _getCombatMoveOrigin(t);
      const canUndo = _inCombat && _canEditToken && origin
        && origin.round === (VS.session?.combat?.round ?? 0)
        && origin.pageId === (t.pageId || VS.activePage?.id || null);
      const caVal = ld.caBadge ?? (ld.displayDefense ?? 0);
      const explainedConditions = (Array.isArray(t.conditions) ? t.conditions : []).filter(_effectIsActive).map(condition => {
        const lib = CONDITION_BY_ID[condition.id] || {};
        return { ...condition, label: lib.label || condition.label || condition.id, effects: { ...(lib.effects || {}), ...(condition.effects || {}) } };
      });
      const explain = (kind, value, manualKey) => explainTokenStat(kind, {
        value,
        conditions: explainedConditions,
        buffs: (t.buffs || []).filter(_effectIsActive),
        manual: _manualBuffVal(t, manualKey),
      });
      const why = result => {
        if (result.zeroBy) return `Vitesse 0 · ${result.zeroBy}`;
        if (result.parts.length < 2) return '';
        return result.parts.map(([delta, label], index) => index === 0
          ? `${delta} ${label}`
          : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} ${label}`).join(' · ');
      };
      const _row = (iconName, label, value, unit, manualKey, explained, color = '') => `
        <div class="vtt-stat-line">
          <span class="vtt-stat-line-icon">${_insIcon(iconName)}</span>
          <span class="vtt-stat-line-key"><b>${label}</b>${why(explained) ? `<small>${_esc(why(explained))}</small>` : ''}</span>
          <span class="vtt-stat-line-value"${color ? ` style="color:${color}"` : ''}>${_esc(value)}<i>${_esc(unit)}</i>${_badge(manualKey)}</span>
          ${_steps(manualKey)}
        </div>`;
      const movementCells = _inCombat
        ? Array.from({ length: Math.max(0, maxMvt) }, (_, index) => `<i class="${index < rem ? 'filled' : ''}"></i>`).join('')
        : '';
      const turnHtml = _inCombat ? `<section class="vtt-ins-drawer-section">
        <div class="vtt-ins-section-heading"><span>Tour</span></div>
        <div class="vtt-stat-turn">
          <div class="vtt-stat-turn-value" style="color:${mvCol}">${rem}<small>/${maxMvt}</small></div>
          <div class="vtt-stat-turn-progress"><span>cases restantes <small>${t.movedCells||0} utilisée${(t.movedCells||0)>1?'s':''} ce tour</small></span><div>${movementCells}</div></div>
          ${canUndo ? `<button class="vtt-ins-ghost" data-vtt-fn="_vttUndoMove" data-vtt-args="${_esc(t.id)}">${_insIcon('undo')}Annuler</button>` : (t.attackedThisTurn ? '<span class="vtt-ins-chip positive">A attaqué</span>' : '')}
        </div>
      </section>` : '';
      turnStatsHtml = turnHtml;
      const moveValue = ld.displayMovement ?? 6;
      const rangeValue = ld.displayRange ?? 1;
      const rows = _row('move', 'Déplacement', moveValue, 'cases', 'vitesse', explain('move', moveValue, 'vitesse'))
        + _row('shield', 'Défense', caVal, 'CA', caVal === '?' ? '' : 'ca', explain('ca', caVal === '?' ? 0 : caVal, 'ca'))
        + _row('range', 'Portée', rangeValue, 'cases', 'portee', explain('range', rangeValue, 'portee'))
        + `<div class="vtt-stat-line vtt-stat-line--readonly"><span class="vtt-stat-line-icon">${_insIcon('sword')}</span><span class="vtt-stat-line-key"><b>Attaque</b></span><span class="vtt-stat-line-attack">${_esc(atkLabel)}</span></div>`;
      const manual = [['vitesse','Dépl.'],['ca','CA'],['portee','Portée']]
        .map(([key, label]) => [label, _manualBuffVal(t, key)]).filter(([, value]) => value);
      const footer = _canEditToken && manual.length
        ? `<div class="vtt-stat-manual"><span>Bonus manuel : ${manual.map(([label, value]) => `${label} ${value > 0 ? '+' : ''}${value}`).join(' · ')}</span><button type="button" class="vtt-stat-reset" data-vtt-fn="_vttTokenResetBonus" data-vtt-args="${t.id}">${_insIcon('reset')}Réinitialiser</button></div>`
        : (_canEditToken ? '<p class="vtt-ins-help">− / + ajoutent un bonus manuel, conservé jusqu’à réinitialisation.</p>' : '');
      return `<div class="vtt-stat-lines">${rows}</div>${footer}`;
    })();
  }

  // ── Infos créature (bestiaire) ─────────────────────────────────────────
  // MJ : fiche complète (CA réelle, stats, attaques, traits, butins…)
  // Joueur : ses propres déductions sur les attaques et traits
  let _creatureHtml = '';
  if (t.beastId) {
    const beast = VS.bestiary[t.beastId];
    if (beast) {
      // Nouveau schéma : armesNaturelles + actions (spells unifiés) + butins (objets boutique)
      // Legacy : `attaques` (texte libre) — affiché en fallback si encore présent.
      const _atk     = Array.isArray(beast.attaques)        ? beast.attaques        : [];
      const _armesN  = Array.isArray(beast.armesNaturelles) ? beast.armesNaturelles : [];
      const _actions = Array.isArray(beast.actions)         ? beast.actions         : [];
      const _trt     = Array.isArray(beast.traits)          ? beast.traits          : [];
      const _btn     = Array.isArray(beast.butins)          ? beast.butins          : [];

      if (STATE.isAdmin) {
        // ── Vue MJ : tout est révélé ───────────────────────────────────
        const _stats6 = ['force','dexterite','constitution','intelligence','sagesse','charisme']
          .map(k => {
            const v = parseInt(beast[k]);
            if (!v && v !== 0) return null;
            const m = Math.floor((v - 10) / 2);
            const ms = m >= 0 ? '+'+m : m;
            return `<span class="vtt-creat-stat-pill" style="--stat-c:${_STAT_COLOR[k.slice(0,3).toUpperCase()] || 'var(--text-muted)'}"><b>${k.slice(0,3).toUpperCase()}</b><strong>${ms}</strong><small>${v}</small></span>`;
          }).filter(Boolean).join('');

        const _affHtml = ((arr, label, color) => {
          if (!Array.isArray(arr) || !arr.length) return '';
          // Résout un id de type de dégâts (natif « lumiere » ou custom « dt_… ») en libellé.
          const _lbl = (x) => {
            if (x && typeof x === 'object') return _esc(x.nom || x.label || x.type || '?');
            const dt = getDamageTypeById(VS.damageTypes, x);
            return dt ? `${dt.icon ? dt.icon + ' ' : ''}${_esc(dt.label)}` : _esc(String(x));
          };
          return `<div class="vtt-creat-aff"><span class="vtt-creat-aff-lbl" style="color:${color}">${label}</span> ${arr.map(_lbl).join(', ')}</div>`;
        });

        const realCaBuffed = (typeof calcCA === 'function' && ld.displayDefense !== undefined) ? ld.displayDefense : (beast.ca ?? 0);
        _creatureHtml = `
          <section class="vtt-ins-drawer-section vtt-creat-mj">
            <div class="vtt-creat-vitals">
              <span class="vtt-creat-vital"><small>CA</small><b>${realCaBuffed ?? '?'}</b>${realCaBuffed !== (beast.ca ?? 0) ? `<em>base ${beast.ca ?? '?'}</em>` : ''}</span>
              <span class="vtt-creat-vital"><small>PV max</small><b>${beast.pvMax ?? '?'}</b></span>
              <span class="vtt-creat-vital"><small>Vit.</small><b>${beast.vitesse ?? '?'}</b></span>
              <span class="vtt-creat-vital"><small>Init.</small><b>${beast.initiative ?? '—'}</b></span>
              <span class="vtt-creat-vital"><small>Niv.</small><b>${beast.niveau ?? '—'}</b></span>
              <span class="vtt-creat-vital"><small>XP</small><b>${beast.dangerositeXp ?? '—'}</b></span>
            </div>
            ${_stats6 ? `<div class="vtt-creat-stats6">${_stats6}</div>` : ''}
            ${_affHtml(beast.faiblesses,  'Faiblesses',   '#f87171')}
            ${_affHtml(beast.resistances, 'Résistances',  '#fbbf24')}
            ${_affHtml(beast.immunites,   'Immunités',    '#94a3b8')}
            ${_affHtml(beast.absorptions, 'Absorptions',  '#a78bfa')}
            ${beast.description ? `<div class="vtt-creat-desc">${_esc(beast.description)}</div>` : ''}
            ${_armesN.length ? `
              <details class="vtt-ins-fold" open><summary>${_insIcon('chevron')}<span>Armes naturelles</span><small>${_armesN.length}</small></summary><div class="vtt-ins-fold-body">
              ${_armesN.map(w => {
                const statShort = { force:'For', dexterite:'Dex', intelligence:'Int', sagesse:'Sag', constitution:'Con', charisme:'Cha', none:'—' };
                const dStat = statShort[w.degatsStat]  || '';
                const tStat = statShort[w.toucherStat] || '';
                const flatD = parseInt(w.degatsFlat)  || 0;
                const flatT = parseInt(w.toucherFlat) || 0;
                return `<div class="vtt-creat-atk">
                  <div class="vtt-creat-atk-name">${_esc(w.nom || 'Arme')}</div>
                  <div class="vtt-creat-atk-stats">
                    ${w.degats ? `<span class="vtt-creat-atk-stat dmg">Dégâts ${_esc(w.degats)}${dStat?` <span style="opacity:.7">(${dStat}${flatD?` ${flatD>0?'+':''}${flatD}`:''})</span>`:''}</span>` : ''}
                    ${tStat || flatT ? `<span class="vtt-creat-atk-stat touch">Toucher ${tStat}${flatT?` ${flatT>0?'+':''}${flatT}`:''}</span>` : ''}
                    ${w.portee  ? `<span class="vtt-creat-atk-stat range">Portée ${_esc(w.portee)}</span>` : ''}
                  </div>
                </div>`;
              }).join('')}</div></details>` : ''}
            ${_actions.length ? `
              <details class="vtt-ins-fold"><summary>${_insIcon('chevron')}<span>Actions</span><small>${_actions.length}</small></summary><div class="vtt-ins-fold-body">
              ${_actions.map(a => {
                const runeBadgesHtml = runeBadges(a.runes || [], { className: 'vtt-creat-rune' });
                const typeBadges = spellTypeBadges(a.types || [], { className: 'vtt-creat-act-type', stylePrefix: '--c:' });
                return `<div class="vtt-creat-act">
                  <div class="vtt-creat-act-head">
                    <span class="vtt-creat-act-ico">${_esc(a.icon||'🔮')}</span>
                    <span class="vtt-creat-act-name">${_esc(a.nom||'Action')}</span>
                    <span class="vtt-creat-act-pm">${a.pmOverride ?? a.pm ?? '?'} PM</span>
                  </div>
                  ${typeBadges || runeBadgesHtml ? `<div class="vtt-creat-act-badges">${typeBadges}${runeBadgesHtml}</div>` : ''}
                </div>`;
              }).join('')}</div></details>` : ''}
            ${(_atk.length && !_armesN.length && !_actions.length) ? `
              <div class="vtt-creat-sub-title">Attaques (${_atk.length})</div>
              ${_atk.map(a => `
                <div class="vtt-creat-atk">
                  <div class="vtt-creat-atk-name">${_esc(a.nom || 'Attaque')}</div>
                  <div class="vtt-creat-atk-stats">
                    ${a.toucher ? `<span class="vtt-creat-atk-stat touch">Toucher ${_esc(a.toucher)}</span>` : ''}
                    ${a.degats  ? `<span class="vtt-creat-atk-stat dmg">Dégâts ${_esc(a.degats)}</span>`   : ''}
                    ${a.portee  ? `<span class="vtt-creat-atk-stat range">Portée ${_esc(a.portee)}</span>` : ''}
                  </div>
                  ${a.description ? `<div class="vtt-creat-atk-desc">${_esc(a.description)}</div>` : ''}
                </div>`).join('')}` : ''}
            ${_trt.length ? `
              <details class="vtt-ins-fold"><summary>${_insIcon('chevron')}<span>Traits</span><small>${_trt.length}</small></summary><div class="vtt-ins-fold-body">
              ${_trt.map(tr => `
                <div class="vtt-creat-trait">
                  <div class="vtt-creat-trait-name">${_esc(tr.nom || '')}</div>
                  ${tr.description ? `<div class="vtt-creat-trait-desc">${_esc(tr.description)}</div>` : ''}
                </div>`).join('')}</div></details>` : ''}
            ${(_btn.length || beast.or) ? `
              <details class="vtt-ins-fold" open><summary>${_insIcon('chevron')}<span>Butin</span><small>${_btn.length}${beast.or ? ' + or' : ''}</small></summary><div class="vtt-ins-fold-body vtt-creat-loots">
                ${_btn.map((b,i) => {
                  const orphan = !b.itemId;
                  return `<div class="vtt-creat-loot" data-loot-idx="${i}">
                    ${b.image
                      ? `<img class="vtt-creat-loot-img" src="${_esc(b.image)}" alt="">`
                      : `<span class="vtt-creat-loot-img vtt-creat-loot-img--empty">📦</span>`}
                    <span class="vtt-creat-loot-name">${_esc(b.nom || 'Objet')}</span>
                    ${b.quantite ? `<span class="vtt-creat-loot-meta">${_esc(b.quantite)}</span>` : ''}
                    ${b.chance   ? `<span class="vtt-creat-loot-meta">${_esc(b.chance)}</span>`   : ''}
                    ${orphan
                      ? `<button class="vtt-creat-loot-send" disabled title="Objet supprimé de la boutique">Indisponible</button>`
                      : `<button class="vtt-creat-loot-send" data-vtt-fn="_vttCreatSendLootToStash" data-vtt-args="${t.beastId}|${i}|$this" title="Envoyer à la réserve MJ">${_insIcon('out')}Réserve</button>`}
                  </div>`;
                }).join('')}
                ${beast.or ? `<div class="vtt-creat-loot vtt-creat-loot--gold">
                  <span class="vtt-creat-loot-img vtt-creat-loot-img--gold">🪙</span>
                  <span class="vtt-creat-loot-name">Or</span>
                  <span class="vtt-creat-loot-meta">${_esc(beast.or)}</span>
                  <button class="vtt-creat-loot-send" data-vtt-fn="_vttCreatSendGoldToStash" data-vtt-args="${t.beastId}|$this" title="Lancer l'or (${_esc(beast.or)}) et l'envoyer à la réserve MJ">${_insIcon('dice')}Lancer</button>
                </div>` : ''}
              </div></details>` : ''}
          </section>`;
      } else {
        // ── Vue joueur : seulement ses propres déductions ──────────────
        const track = VS.bstTracker[t.beastId] || {};
        const ded   = track.deductions || {};
        const _bid  = t.beastId;
        const _hasNotes = (track.notes || '').trim().length > 0;
        const _estimate = value => value !== undefined && value !== null && value !== '' ? String(value) : '?';
        const _pvEstimate = _estimate(track.pvActuel);
        const _caEstimate = _estimate(track.caEstimee);
        const _speedEstimate = track.vitEstimee !== undefined && track.vitEstimee !== null && track.vitEstimee !== ''
          ? `${track.vitEstimee} cases`
          : '?';
        // Détermine si au moins une déduction d'attaque ou de trait est renseignée
        const _hasAnyDed = Object.values(ded).some(v => v && String(v).trim());

        _creatureHtml = `
          <section class="vtt-ins-drawer-section vtt-creat-pl">
            <div class="vtt-creat-help-banner">${_insIcon('book')}<span>Ce que tu sais de cette créature. Tes notes sont partagées avec ton Bestiaire.</span></div>
            <div class="vtt-creat-estimates">
              <span><small>CA estimée</small><b>${_esc(_caEstimate)}</b></span>
              <span><small>Vitesse est.</small><b>${_esc(_speedEstimate)}</b></span>
              <span><small>PV estimés</small><b>${_esc(_pvEstimate)}</b></span>
            </div>
            ${_actions.length ? `
              ${_actions.map((act, i) => {
                const k = act.id || `idx_${i}`;
                return `<details class="vtt-ins-fold"><summary>${_insIcon('chevron')}<span>${_esc(ded['act_nom_'+k] || `Attaque ${i+1}`)}</span><small>${ded['act_nom_'+k] ? 'observée' : 'non identifiée'}</small></summary><div class="vtt-ins-fold-body vtt-creat-atk-edit">
                  <input class="vtt-creat-input" placeholder="Nom de l'action…"
                    value="${_esc(ded['act_nom_'+k] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_nom_${k}|$value">
                  <div class="vtt-creat-atk-row3">
                    <input class="vtt-creat-input" placeholder="Toucher"
                      value="${_esc(ded['act_toucher_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_toucher_${k}|$value">
                    <input class="vtt-creat-input" placeholder="Dégâts"
                      value="${_esc(ded['act_degats_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_degats_${k}|$value">
                    <input class="vtt-creat-input" placeholder="Portée"
                      value="${_esc(ded['act_portee_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_portee_${k}|$value">
                  </div>
                </div></details>`;
              }).join('')}` : ''}
            ${_trt.length ? `
              ${_trt.map((_, i) => `
                <details class="vtt-ins-fold"><summary>${_insIcon('chevron')}<span>${_esc(ded['tr_nom_'+i] || `Trait ${i+1}`)}</span><small>${ded['tr_nom_'+i] ? 'observé' : 'inconnu'}</small></summary><div class="vtt-ins-fold-body vtt-creat-trait-edit">
                  <input class="vtt-creat-input" placeholder="Nom du trait…"
                    value="${_esc(ded['tr_nom_'+i] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|tr_nom_${i}|$value">
                  <input class="vtt-creat-input" placeholder="Description…"
                    value="${_esc(ded['tr_desc_'+i] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|tr_desc_${i}|$value">
                </div></details>`).join('')}` : ''}
            <div class="vtt-ins-section-heading"><span>Notes</span></div>
            <textarea class="vtt-creat-input vtt-creat-notes" rows="3" placeholder="Tes notes sur cette créature…"
              data-vtt-fn="_vttBstNotes" data-vtt-on="change" data-vtt-args="${_bid}|$value">${_esc(track.notes || '')}</textarea>
            ${!_actions.length && !_trt.length && !_hasNotes && !_hasAnyDed
              ? '<div class="vtt-creat-help" style="margin-top:.4rem">Aucune action/trait recensé par le MJ pour cette créature pour le moment.</div>'
              : ''}
          </section>`;
      }
    }
  }

  // ── États + effets : résumé tactique et liste unifiée ───────────────────
  const _activeBuffs = (t.buffs || []).map((buff, index) => ({ buff, index })).filter(({ buff }) =>
    _effectIsActive(buff));
  const _conds = Array.isArray(t.conditions) ? t.conditions : [];
  const _activeConds = _conds.map((cond, index) => ({ cond, index })).filter(({ cond }) => _effectIsActive(cond));
  const _BUFF_LABEL = {
    ca: 'Bonus CA', dot: 'Dégâts / tour', regen: 'Régénération', dmg_bonus: 'Dégâts bonus',
    move_bonus: 'Mouvement +', move_debuff: 'Mouvement −', range_bonus: 'Portée +',
    shield_reactive: 'Bouclier réactif', enchantment: 'Enchantement', affliction: 'Affliction',
    suspended_spell: 'Sort suspendu',
  };
  const _buffDetail = bf => bf.type === 'dmg_bonus' ? `+${bf.formula}`
    : bf.type === 'move_bonus' || bf.type === 'move_debuff' ? `${bf.bonus > 0 ? '+' : ''}${bf.bonus} cases`
    : bf.type === 'range_bonus' ? `+${bf.bonus} cases`
    : bf.type === 'ca' ? `${bf.bonus >= 0 ? '+' : ''}${bf.bonus} CA`
    : bf.type === 'dmg_reduction' ? `−${bf.value} dégâts par coup`
    : bf.type === 'spell_light' ? (bf.bonus ? `Éclairage +${bf.bonus} cases` : `Rayon ${bf.radius} cases`)
    : bf.type === 'dmg_weakness' ? `×2 ${(VS.damageTypes || []).find(type => type.id === bf.element)?.label || 'élément'}`
    : bf.type === 'dot' || bf.type === 'regen' ? `${bf.formula} / tour`
    : bf.type === 'shield_reactive' ? `${bf.charges || 1} charge · ${bf.tier || ''}`.trim()
    : bf.effect || '';
  const _duration = (remaining, total, infinite = false) => {
    if (infinite || remaining == null) return '<span class="vtt-effect-duration infinite">∞</span>';
    const left = Math.max(1, Number(remaining) || 1);
    const count = Math.min(12, Math.max(left, Number(total) || left));
    return `<span class="vtt-effect-duration${left === 1 ? ' last' : ''}"><b>${left === 1 ? 'Dernier tour' : `${left} tours`}</b><span>${Array.from({ length: count }, (_, index) => `<i class="${index < left ? 'filled' : ''}"></i>`).join('')}</span></span>`;
  };
  const _effectSummary = summarizeTokenEffects(
    _activeConds.map(({ cond }) => ({ ...cond, effects: { ...(CONDITION_BY_ID[cond.id]?.effects || {}), ...(cond.effects || {}) } })),
    _activeBuffs.map(({ buff }) => buff),
  );
  const _effectsHtml = (() => {
    const rows = _activeConds.map(({ cond, index }) => {
      const baseLib = CONDITION_BY_ID[cond.id] || { label: cond.id, icon: '❓', color: '#888', desc: '' };
      const lib = cond.element
        ? { ...baseLib, label: `${baseLib.label} ${getDamageTypeById(VS.damageTypes, cond.element)?.label || ''}`.trim() }
        : cond.aggroName ? { ...baseLib, label: `${baseLib.label} → ${cond.aggroName}` }
        : baseLib;
      const remaining = cond.expiresAtRound != null && _r > 0 ? cond.expiresAtRound - _r + 1 : cond.pendingDuration;
      const tone = tokenEffectTone({ kind:'condition', effects:{ ...(lib.effects || {}), ...(cond.effects || {}) } });
      const saveLbl = cond.saveDC && cond.saveStat
        ? `${statShort(cond.saveStat) || cond.saveStat} DD ${cond.saveDC}` : null;
      const ctrls = STATE.isAdmin ? `
        <div class="vtt-effect-actions">
          ${saveLbl ? `<button class="vtt-effect-save" data-vtt-fn="_vttConditionSave" data-vtt-args="${t.id}|${index}|$this" title="Lancer le jet de sauvegarde">${_insIcon('dice')}JS ${saveLbl}</button>` : ''}
          <button class="vtt-ins-ghost" data-vtt-fn="_vttConditionEdit" data-vtt-args="${t.id}|${index}">${_insIcon('edit')}Modifier</button>
          <button class="vtt-ins-ghost danger" data-vtt-fn="_vttConditionRemove" data-vtt-args="${t.id}|${index}">${_insIcon('close')}Retirer</button>
        </div>` : '';
      return `<details class="vtt-effect-item tone-${tone}" name="vtt-token-effects" style="--effect-color:${lib.color}">
        <summary><span class="vtt-effect-icon">${_esc(lib.icon)}</span><span class="vtt-effect-name"><b>${_esc(lib.label)}</b><small><i class="${tone}">État</i>${_esc(lib.desc || '')}</small></span>${_duration(remaining, cond.pendingDuration || remaining, cond.expiresAtRound == null && cond.pendingDuration == null)}</summary>
        <div class="vtt-effect-body"><p>${_esc(lib.desc || '')}</p>${cond.source ? `<span>Source : ${_esc(cond.source)}</span>` : ''}${ctrls}</div>
      </details>`;
    }).join('') + _activeBuffs.map(({ buff, index }) => {
      const label = buff.sortLabel || buff.label || _BUFF_LABEL[buff.type] || buff.type || 'Effet';
      const detail = _buffDetail(buff);
      const tone = tokenEffectTone({ ...buff, kind:'effect' });
      const color = tone === 'negative' ? '#fb7185' : tone === 'neutral' ? '#818cf8' : '#22c38e';
      const remaining = buff.expiresAtRound != null && _r > 0 ? buff.expiresAtRound - _r + 1 : buff.totalDuration;
      return `<details class="vtt-effect-item tone-${tone}" name="vtt-token-effects" style="--effect-color:${color}">
        <summary><span class="vtt-effect-icon">${_esc(buff.icon || '✨')}</span><span class="vtt-effect-name"><b>${_esc(label)}</b><small><i class="${tone}">Effet</i>${_esc(detail)}</small></span>${_duration(remaining, buff.totalDuration || remaining, buff.canalisePersistant || (buff.expiresAtRound == null && buff.totalDuration == null))}</summary>
        <div class="vtt-effect-body"><p>${_esc(detail || label)}</p>${buff.source ? `<span>Source : ${_esc(buff.source)}</span>` : ''}${buff.type === 'suspended_spell' ? '<p>La version gratuite du sort est disponible dans tes actions.</p>' : ''}${STATE.isAdmin ? `<div class="vtt-effect-actions"><button class="vtt-ins-ghost danger" data-vtt-fn="_vttRemoveBuff" data-vtt-args="${t.id}|${index}">${_insIcon('close')}Retirer</button></div>` : ''}</div>
      </details>`;
    }).join('');
    const applied = new Set(_activeConds.map(({ cond }) => cond.id));
    const picker = STATE.isAdmin && _conditionPickerOpen ? `<div class="vtt-condition-picker">
      <div class="vtt-condition-picker-body">
        <input class="vtt-ins-field" type="search" placeholder="Rechercher un état…" data-vtt-fn="_vttInsFilterConditionPicker" data-vtt-on="input" data-vtt-args="$value">
        <div class="vtt-condition-picker-grid">${Object.values(CONDITION_BY_ID).map(condition => `<button class="vtt-condition-pick" style="--effect-color:${condition.color || '#888'}" data-search="${_esc(String(condition.label || '').toLocaleLowerCase('fr'))}" data-vtt-fn="_vttConditionApply" data-vtt-args="${t.id}|${_esc(condition.id)}" ${applied.has(condition.id) ? 'disabled' : ''}><span>${_esc(condition.icon || '❓')}</span><b>${_esc(condition.label || condition.id)}</b></button>`).join('')}</div>
        <div class="vtt-condition-picker-foot"><button class="vtt-ins-ghost" data-vtt-fn="_vttAddBuffPrompt" data-vtt-args="${t.id}">${_insIcon('wand')}Effet manuel…</button><button class="vtt-ins-heading-action" data-vtt-fn="_vttConditionConfig">${_insIcon('manage')}Réglages</button></div>
      </div>
    </div>` : '';
    const empty = `<div class="vtt-effect-empty"><b>Aucun état ni effet</b><span>${STATE.isAdmin ? 'Ajoute un état depuis la liste ou applique un sort.' : 'Rien n’affecte ce token pour le moment.'}</span></div>`;
    return `${_effectSummary.length ? `<section class="vtt-ins-drawer-section"><div class="vtt-ins-section-heading"><span>Ce que ça change</span></div><div class="vtt-effect-impact">${_effectSummary.map(item => `<span class="${item.tone}">${_esc(item.label)}</span>`).join('')}</div></section>` : ''}
      ${picker}<section class="vtt-ins-drawer-section"><div class="vtt-effect-list">${rows || empty}</div></section>`;
  })();

  // NB : le corps « Jets » (compétences + actions de combat + créature) est
  // désormais construit par _vttBuildJetsBody() et rendu par le LANCEUR DE DÉS
  // du dock (vtt-dice.js) — plus de panneau « Jets » au-dessus de l'identité.

  const _delegateHtml = (() => {
    // Délégation de contrôle — visible pour propriétaire OU MJ
    const uid = STATE.user?.uid;
    const tokenOwnerUid = t.ownerId || (t.characterId ? VS.characters[t.characterId]?.uid : null);
    const isOwner = uid && tokenOwnerUid === uid;
    if (!isOwner && !STATE.isAdmin) return '';
    const linkedCharacter = t.characterId ? VS.characters[t.characterId] : null;
    const dels = getCharacterDelegates(linkedCharacter || t);
    const lookupName = _resolveUidName;
    const memberInfo = memberUid => {
      const character = Object.values(VS.characters || {}).find(entry => entry?.uid === memberUid);
      const name = lookupName(memberUid);
      return { uid:memberUid, name, photo:character?.photo || character?.portraitUrl || character?.imageUrl || '' };
    };
    const avatar = member => member.photo
      ? `<span class="vtt-delegate-avatar"><img src="${_esc(member.photo)}" alt=""></span>`
      : `<span class="vtt-delegate-avatar">${_esc(String(member.name || '?').trim().slice(0, 1).toUpperCase())}</span>`;
    const chips = dels.length
      ? dels.map(u => { const member = memberInfo(u); return `<span class="vtt-delegate-chip">
            ${avatar(member)}
            <span>${_esc(lookupName(u))}</span>
            <button class="vtt-delegate-x" data-vtt-fn="_vttRemoveTokenDelegate"
              data-vtt-args="${t.id}|${u}" title="Retirer">${_insIcon('close')}</button>
          </span>`; }).join('')
      : '';
    const adventure = STATE.adventure || {};
    const admins = new Set(adventure.admins || []);
    const candidates = [...new Set([...(adventure.players || []), ...(adventure.admins || [])])]
      .filter(memberUid => memberUid && memberUid !== tokenOwnerUid && memberUid !== uid && !dels.includes(memberUid))
      .map(memberInfo)
      .filter(member => member.name && (admins.has(member.uid) || Object.values(VS.characters || {}).some(character => character?.uid === member.uid)));
    const add = candidates.length
      ? `<button class="vtt-delegate-chip vtt-delegate-add-inline${_manageDelegateOpen ? ' active' : ''}" data-vtt-fn="_vttInsToggleManage" data-vtt-args="delegates">${_insIcon('plus')}Ajouter</button>`
      : '';
    const candidateHtml = _manageDelegateOpen && candidates.length
      ? `<div class="vtt-delegate-candidates">${candidates.map(member => `<button class="vtt-delegate-chip candidate" data-vtt-fn="_vttToggleTokenDelegate" data-vtt-args="${t.id}|${_esc(member.uid)}">${avatar(member)}<span>${_esc(member.name)}</span></button>`).join('')}</div>`
      : '';
    return `<section class="vtt-ins-drawer-section">
        <div class="vtt-ins-section-heading"><span>Contrôle partagé</span></div>
        <p class="vtt-ins-help">${tokenOwnerUid ? `Propriétaire : <b>${_esc(lookupName(tokenOwnerUid))}</b>.` : 'Contrôlé par le MJ.'} ${dels.length ? 'Peuvent aussi le déplacer :' : 'Personne d’autre ne le contrôle.'}</p>
        <div class="vtt-delegate-list">${chips}${add}</div>${candidateHtml}
      </section>`;
  })();

  const _sendPageHtml = STATE.isAdmin ? `
      <section class="vtt-ins-drawer-section">
        <div class="vtt-ins-presence-row">${_insIcon(t.visible !== false ? 'eye' : 'eyeoff')}<span><b>Visible des joueurs</b><small>${t.visible !== false ? 'Tout le monde voit ce token' : 'Seul le MJ le voit'}</small></span><button class="vtt-ins-switch${t.visible !== false ? ' active' : ''}" data-vtt-fn="_vttToggleVisible" data-vtt-args="${t.id}" role="switch" aria-checked="${t.visible !== false}" aria-label="Visible des joueurs"><i></i></button></div>
        ${pageTargets.length ? `<div class="vtt-manage-fold"><button class="vtt-manage-row" data-vtt-fn="_vttInsToggleManage" data-vtt-args="pages" aria-expanded="${_manageSendOpen}">${_insIcon('map')}<span><b>Envoyer vers une scène</b><small>Actuellement : ${_esc(VS.pages[t.pageId]?.name || 'Réserve')}</small></span>${_insIcon('chevron', _manageSendOpen ? 'rotated' : '')}</button>${_manageSendOpen ? `<div class="vtt-manage-pages">${pageTargets.map(page => `<button data-vtt-fn="_vttMoveTokenToPage" data-vtt-args="${t.id}|${_esc(page.id)}"><span>${_esc(page.name)}</span><b>Envoyer</b></button>`).join('')}</div>` : ''}</div>` : ''}
      </section>` : '';

  const _sourceLinksHtml = STATE.isAdmin ? (() => {
    const links = [];
    if (t.characterId) {
      const charId = _esc(t.characterId);
      links.push(`<button class="vtt-source-link" data-vtt-fn="_vttOpenSource" data-vtt-args="char|${charId}|combat" title="Ouvrir la fiche personnage">${_insIcon('user')}<b>Fiche</b></button>`);
      links.push(`<button class="vtt-source-link" data-vtt-fn="_vttOpenSource" data-vtt-args="char|${charId}|sorts" title="Modifier les sorts du personnage">${_insIcon('wand')}<b>Sorts</b></button>`);
      links.push(`<button class="vtt-source-link" data-vtt-fn="_vttOpenSource" data-vtt-args="char|${charId}|inv" title="Modifier l'inventaire du personnage">${_insIcon('bag')}<b>Inventaire</b></button>`);
    } else if (t.npcId) {
      links.push(`<button class="vtt-source-link" data-vtt-fn="_vttOpenSource" data-vtt-args="npc|${_esc(t.npcId)}" title="Ouvrir la page des PNJ">${_insIcon('user')}<b>Fiche PNJ</b></button>`);
    } else if (t.beastId) {
      links.push(`<button class="vtt-source-link" data-vtt-fn="_vttOpenSource" data-vtt-args="bestiary|${_esc(t.beastId)}" title="Ouvrir le bestiaire">${_insIcon('paw')}<b>Bestiaire</b></button>`);
    }
    links.push(`<button class="vtt-source-link" data-vtt-fn="_vttEditToken" data-vtt-args="${t.id}" title="Modifier les statistiques de combat">${_insIcon('edit')}<b>Stats combat</b></button>`);
    return `<section class="vtt-ins-drawer-section">
        <div class="vtt-ins-section-heading"><span>Ouvrir la source</span></div>
        <div class="vtt-source-links">${links.join('')}</div>
      </section>`;
  })() : '';

  const _purgeArmed = _purgeArmedUntil > Date.now();
  const _footerHtml = STATE.isAdmin ? `
      <section class="vtt-ins-drawer-section">
        <div class="vtt-ins-section-heading"><span>Actions MJ</span></div>
        <div class="vtt-ins-actions">
          ${VS.session?.combat?.active?`<button class="vtt-ins-ghost" data-vtt-fn="_vttResetTurn" data-vtt-args="${t.id}" title="Réinitialiser le tour de ce token">${_insIcon('turn')}Réinitialiser le tour</button>`:''}
          ${t.pageId?`<button class="vtt-ins-ghost" data-vtt-fn="_vttRetireToken" data-vtt-args="${t.id}" title="Retirer de la carte">${_insIcon('out')}Retirer de la carte</button>`:''}
          ${t.improvised ? `<button class="vtt-ins-ghost" data-vtt-fn="_vttPromoteImprovised" data-vtt-args="${t.id}|${t.type === 'enemy' ? 'bestiary' : 'npc'}" title="Conserver durablement ce figurant">★ ${t.type === 'enemy' ? 'Ajouter au bestiaire' : 'Garder dans les PNJ'}</button>` : ''}
          ${(t.buffs||[]).length?`<button class="vtt-ins-ghost danger${_purgeArmed ? ' armed' : ''}" data-vtt-fn="_vttInsPurge" data-vtt-args="${t.id}" title="Supprimer tous les effets actifs">${_insIcon('trash')}${_purgeArmed ? 'Confirmer la purge' : 'Purger les effets'} <em>${(t.buffs||[]).length}</em></button>`:''}
        </div>
      </section>` : '';

  // ── Lectures directes + bulles ancrées ────────────────────────────────
  const _ctrl = _canControlToken(t);
  const _ownerUid = t.ownerId || (t.characterId ? VS.characters[t.characterId]?.uid : null);
  const _isOwner = !!(STATE.user?.uid && _ownerUid === STATE.user.uid);
  const _canManage = STATE.isAdmin || _isOwner;
  const _effectCount = _activeConds.length + _activeBuffs.length;
  const _rankKey = ['elite', 'boss'].includes(String(t.beastId ? VS.bestiary[t.beastId]?.rang : '').toLowerCase())
    ? String(VS.bestiary[t.beastId]?.rang).toLowerCase()
    : 'classique';
  const _rankLabel = { classique:'Classique', elite:'Élite', boss:'Boss' }[_rankKey];
  const _sections = [
    { k:'stats', title:'Statistiques', sub:VS.session?.combat?.active ? `Round ${VS.session?.combat?.round || 1}` : 'Hors combat', html:turnStatsHtml + coreStatsHtml + buildSwitcherHtml, allowed:_ctrl },
    { k:'effets', title:'États', sub:_effectCount ? `${_effectCount} actif${_effectCount > 1 ? 's' : ''}` : '', html:_effectsHtml, allowed:_effectCount > 0 || STATE.isAdmin,
      actions:`<button class="vtt-ins-pop-action" data-vtt-fn="_vttConditionGlossary">${_insIcon('book')}Glossaire</button>${STATE.isAdmin ? `<button class="vtt-ins-pop-action${_conditionPickerOpen ? ' active' : ''}" data-vtt-fn="_vttInsTogglePicker">${_insIcon('plus')}Ajouter</button>` : ''}` },
    { k:'gerer', title:'Gérer', sub:_esc(ld.displayName ?? t.name), html:_sendPageHtml + (t.type !== 'enemy' ? _delegateHtml : '') + _sourceLinksHtml + _footerHtml, allowed:_canManage },
    { k:'bestiaire', title:ld.displayName ?? t.name, sub:`<span class="vtt-creat-rang vtt-creat-rang--${_rankKey}">${_rankLabel}</span>`, html:_creatureHtml, allowed:STATE.isAdmin && !!t.beastId,
      actions:`<button class="vtt-ins-pop-action" data-vtt-fn="_vttOpenSource" data-vtt-args="bestiary|${_esc(t.beastId || '')}">${_insIcon('out')}Ouvrir</button>` },
    { k:'notes', title:'Mes notes', sub:_esc(ld.displayName ?? t.name), html:_creatureHtml, allowed:!STATE.isAdmin && !!t.beastId },
  ].filter(section => section.allowed && section.html && section.html.trim());
  const _availableSections = new Set(_sections.map(section => section.k));
  const _deployed = _sections.find(section => section.k === _insTab) || null;
  // Mini-feuille disponible depuis l'identité dès que le token est lié à un
  // personnage, y compris si son joueur est momentanément hors ligne. L'id du
  // personnage est transmis pour les comptes qui en possèdent plusieurs.
  const _sheetUid = t.characterId
    ? (t.ownerId || VS.characters[t.characterId]?.uid || null)
    : null;
  const _sheetOpen = !!(_sheetUid && VS.miniUid === _sheetUid && VS.miniCharId === t.characterId);
  const _identitySheetBtn = (_sheetUid && _ctrl)
    ? `<button type="button" class="vtt-who-sheet${_sheetOpen ? ' active' : ''}" data-vtt-fn="_vttToggleMiniSheet" data-vtt-args="${_esc(_sheetUid)}|${_esc(t.characterId)}" data-mini-uid="${_esc(_sheetUid)}" data-mini-char="${_esc(t.characterId)}" title="Ouvrir la mini-feuille de ${_esc(ld.displayName ?? t.name)}" aria-label="Ouvrir la mini-feuille du personnage" aria-pressed="${_sheetOpen}">${_insIcon('sheet')}<b>Fiche</b><kbd>C</kbd></button>`
    : '';
  const _manualBadge = key => { const value = _manualBuffVal(t, key); return value ? `<sup class="${value > 0 ? 'positive' : 'negative'}">${value > 0 ? '+' : ''}${value}</sup>` : ''; };
  const _baseMovement = ld.displayMovement ?? 6;
  const _movement = VS.session?.combat?.active ? _baseMovement + (t.bonusMvt || 0) : _baseMovement;
  const _remaining = VS.session?.combat?.active ? Math.max(0, _movement - (t.movedCells || 0)) : null;
  const _movementColor = _remaining === null ? '' : (_remaining === 0 ? '#f87171' : _remaining <= 2 ? '#f59e0b' : '#4ade80');
  const _readouts = _ctrl ? `<button class="vtt-fiche-readouts${_insTab === 'stats' ? ' active' : ''}" data-ins-anchor="stats" data-vtt-fn="_vttInsTab" data-vtt-args="stats" aria-expanded="${_insTab === 'stats'}" title="Statistiques du tour">
      <span><b${_movementColor ? ` style="color:${_movementColor}"` : ''}>${_remaining === null ? _movement : `${_remaining}<small>/${_movement}</small>`}${_manualBadge('vitesse')}</b><em>Dépl.</em></span>
      <span><b>${_esc(ld.caBadge ?? ld.displayDefense ?? '?')}${_manualBadge('ca')}</b><em>CA</em></span>
      <span><b>${_esc(ld.displayRange ?? 1)}${_manualBadge('portee')}</b><em>Portée</em></span>
    </button>` : '';
  const _tileItems = [
    ..._activeConds.map(({ cond }) => { const lib = CONDITION_BY_ID[cond.id] || {}; const remaining = cond.expiresAtRound != null && _r > 0 ? cond.expiresAtRound - _r + 1 : cond.pendingDuration; return { icon:lib.icon || '❓', label:lib.label || cond.id, remaining, tone:tokenEffectTone({ kind:'condition', effects:{ ...(lib.effects || {}), ...(cond.effects || {}) } }) }; }),
    ..._activeBuffs.map(({ buff }) => ({ icon:buff.icon || '✨', label:buff.sortLabel || buff.label || _BUFF_LABEL[buff.type] || 'Effet', remaining:buff.expiresAtRound != null && _r > 0 ? buff.expiresAtRound - _r + 1 : buff.totalDuration, tone:tokenEffectTone({ ...buff, kind:'effect' }) })),
  ];
  const _shownTiles = _tileItems.length > 4 ? _tileItems.slice(0, 3) : _tileItems;
  const _tile = item => `<span class="vtt-effect-tile ${item.tone}" title="${_esc(item.label)} · ${item.remaining == null ? 'sans fin' : item.remaining === 1 ? 'dernier tour' : `${item.remaining} tours`}">${_esc(item.icon)}${item.remaining != null ? `<em class="${item.remaining === 1 ? 'last' : ''}">${Math.max(1, item.remaining)}</em>` : ''}</span>`;
  const _effectAnchor = _tileItems.length
    ? `<button class="vtt-fiche-effects${_insTab === 'effets' ? ' active' : ''}" data-ins-anchor="effets" data-vtt-fn="_vttInsTab" data-vtt-args="effets" aria-expanded="${_insTab === 'effets'}" aria-label="États et effets : ${_tileItems.length}">${_shownTiles.map(_tile).join('')}${_tileItems.length > 4 ? `<span class="vtt-effect-tile more">+${_tileItems.length - 3}</span>` : ''}</button>`
    : (STATE.isAdmin ? `<button class="vtt-fiche-effects add${_insTab === 'effets' ? ' active' : ''}" data-ins-anchor="effets" data-vtt-fn="_vttInsTab" data-vtt-args="effets" aria-expanded="${_insTab === 'effets'}" title="Ajouter un état"><span class="vtt-effect-tile add">${_insIcon('plus')}</span><b>État</b></button>` : '');
  const _tactic = _readouts || _effectAnchor ? `<div class="vtt-fiche-tactic">${_readouts}${_effectAnchor}</div>` : '';
  const _creatureAction = t.beastId && _availableSections.has(STATE.isAdmin ? 'bestiaire' : 'notes')
    ? (STATE.isAdmin
      ? `<button class="vtt-who-sheet${_insTab === 'bestiaire' ? ' active' : ''}" data-ins-anchor="bestiaire" data-vtt-fn="_vttInsTab" data-vtt-args="bestiaire" aria-expanded="${_insTab === 'bestiaire'}">${_insIcon('paw')}<b>Bestiaire</b></button>`
      : `<button class="vtt-who-sheet${_insTab === 'notes' ? ' active' : ''}" data-ins-anchor="notes" data-vtt-fn="_vttInsTab" data-vtt-args="notes" aria-expanded="${_insTab === 'notes'}">${_insIcon('book')}<b>Mes notes</b></button>`)
    : '';
  const _manageButton = _availableSections.has('gerer') ? `<button class="vtt-fiche-more${_insTab === 'gerer' ? ' active' : ''}" data-ins-anchor="gerer" data-vtt-fn="_vttInsTab" data-vtt-args="gerer" aria-expanded="${_insTab === 'gerer'}" title="Gérer le token" aria-label="Gérer le token">${_insIcon('dots')}</button>` : '';
  const _panelHtml = _deployed
    ? `<div class="vtt-fiche-panel${_lastAnimatedPopover === _deployed.k ? '' : ' is-opening'}" role="region" aria-label="${_esc(_deployed.title)}">
         <div class="vtt-fiche-panel-hd"><span><b>${_deployed.title}</b>${_deployed.sub ? `<small>${_deployed.sub}</small>` : ''}</span>${_deployed.actions || ''}<button class="vtt-fiche-panel-x" data-vtt-fn="_vttInsTab" data-vtt-args="${_deployed.k}" title="Replier" aria-label="Replier">${_insIcon('close')}</button></div>
         <div class="vtt-fiche-panel-body">${_deployed.html}</div>
       </div>`
    : '';

  // ── Bloc d'identité (présentation Claude Design) + boutons Max ──
  const _char = t.characterId ? VS.characters[t.characterId] : null;
  const _camp = t.type === 'enemy' ? 'var(--c-enemy)' : t.type === 'npc' ? 'var(--c-npc)' : 'var(--c-player)';
  const _pm = ld.displayPm ?? null, _pmMax = ld.displayPmMax ?? null;
  const _ed = _canControlToken(t);
  const _resource = (kind, label, current, max, pct, color, options = {}) => {
    const setter = options.setter || (kind === 'PV' ? '_vttSetHp' : '_vttSetPm');
    const direct = !!options.direct;
    const prefix = options.prefix || t.id;
    const setArgs = `${prefix}|$value`;
    const stepButton = (delta, disabled) => direct
      ? `<button type="button" class="vtt-resource-step" data-vtt-fn="${setter}" data-vtt-args="${prefix}|${Math.max(0, Math.min(max, current + delta))}" aria-label="${delta < 0 ? 'Retirer' : 'Ajouter'} 1 ${kind}" title="${delta < 0 ? '−' : '+'}1 ${kind}" ${disabled ? 'disabled' : ''}>${delta < 0 ? '−' : '+'}</button>`
      : `<button type="button" class="vtt-resource-step" data-vtt-fn="_vttAdjustVital" data-vtt-args="${t.id}|${kind}|${delta}" aria-label="${delta < 0 ? 'Retirer' : 'Ajouter'} 1 ${kind}" title="${delta < 0 ? '−' : '+'}1 ${kind}" ${disabled ? 'disabled' : ''}>${delta < 0 ? '−' : '+'}</button>`;
    const resourceKey = kind.toLowerCase();
    const summary = `<span class="vtt-resource-summary vtt-resource-summary--${resourceKey}">
      <span class="vtt-resource-value"><b>${kind}</b> ${current}/${max}</span>
      <span class="vtt-dbar-t" role="progressbar" aria-label="${label}" aria-valuenow="${current}" aria-valuemin="0" aria-valuemax="${max}"><b class="vtt-dbar-f" style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></b></span>
    </span>`;
    // Valeur inconnue (« ? ») : lecture seule, rien à régler.
    if (!_ed || !Number.isFinite(Number(current))) return `<div class="vtt-resource vtt-resource--${resourceKey} vtt-resource--readonly" style="--vtt-resource-color:${color}">${summary}</div>`;
    const controls = `<div class="vtt-resource-controls" aria-label="Modifier les ${label}">
           ${stepButton(-1, current <= 0)}
           <input class="vtt-ins-input vtt-vital-input" type="number" inputmode="numeric" value="${current}" min="0" max="${max}" aria-label="${label} actuels" title="Saisir la valeur puis appuyer sur Entrée ou quitter le champ" data-vtt-fn="${setter}" data-vtt-on="change" data-vtt-args="${setArgs}">
           <span class="vtt-resource-total">/ ${max}</span>
           ${stepButton(1, current >= max)}
           <button type="button" class="vtt-ins-max-btn" data-vtt-fn="${setter}" data-vtt-args="${prefix}|${max}" title="Remettre les ${label} au maximum" ${current === max ? 'disabled' : ''}>Max</button>
         </div>`;
    return `<details class="vtt-resource vtt-resource--${resourceKey}" data-resource="${resourceKey}" style="--vtt-resource-color:${color}" ${_openResourceKey === resourceKey ? 'open' : ''}>
      <summary title="Modifier les ${label}">${summary}</summary>
      <div class="vtt-resource-editor">${controls}</div>
    </details>`;
  };
  const _gardeMax = _char ? calcGardeMax(_char) : 0;
  const _gardeCur = _gardeMax > 0 ? Math.max(0, Math.min(_gardeMax, parseInt(_char?.garde, 10) || 0)) : 0;
  const _summary = `<div class="vtt-fiche-id" style="--c:${_camp}">
      <div class="vtt-who-av">${img ? `<img src="${_esc(img)}" alt="">` : `<span>${icon}</span>`}${t.visible === false ? `<i class="vtt-who-hidden" title="Masqué aux joueurs">${_insIcon('eyeoff')}</i>` : ''}</div>
      <div class="vtt-fiche-main">
        <div class="vtt-who-b"><span class="vtt-who-name">${_esc(ld.displayName ?? t.name)}</span></div>
        <div class="vtt-bars vtt-bars--compact">
          ${_resource('PV', 'points de vie', hp, hpm, Math.round(rat * 100), hpCol)}
          ${(_ctrl && _pm !== null && _pmMax !== null) ? _resource('PM', 'points de mana', _pm, _pmMax, _pmMax > 0 ? Math.round(Math.max(0, _pm) / _pmMax * 100) : 0, '#7b87f5') : ''}
          ${_ctrl && _gardeMax > 0 ? _resource('Garde', 'points de Garde', _gardeCur, _gardeMax, Math.round(_gardeCur / _gardeMax * 100), '#5fb0c8', {
            setter: '_vttMsSetGarde', direct: true, prefix: `${_char.id}|${_char.uid || _sheetUid || ''}`,
          }) : ''}
        </div>
      </div>
    </div>`;

  el.innerHTML = `
    ${_panelHtml}
    <div class="vtt-fiche vtt-fiche--compact">
      ${_summary}
      ${_tactic ? `<span class="vtt-fiche-actions-separator" aria-hidden="true"></span>${_tactic}` : ''}
      ${(_identitySheetBtn || _creatureAction || _manageButton) ? `<span class="vtt-fiche-actions-separator" aria-hidden="true"></span><div class="vtt-fiche-actions">${_identitySheetBtn}${_creatureAction}${_manageButton}</div>` : ''}
    </div>`;
  _wireResourceEditors(el);
  _wireInspectorPopover();
  const currentPanel = el.querySelector('.vtt-fiche-panel-body');
  if (currentPanel && _lastAnimatedPopover === _insTab) currentPanel.scrollTop = previousScroll;
  if (_deployed) _lastAnimatedPopover = _deployed.k;
  if (_conditionPickerOpen) requestAnimationFrame(() => el.querySelector('.vtt-condition-picker input')?.focus());

  // Le lanceur de dés du dock affiche les compétences du token courant : si son
  // panneau est ouvert, on le rafraîchit à chaque changement de sélection.
}

export function _vttInsTab(tab) {
  _insTab = (_insTab === tab) ? null : tab;   // re-clic sur l'icône = replie
  _conditionPickerOpen = _insTab === 'effets' && STATE.isAdmin
    && !(document.querySelector('#vtt-inspector .vtt-fiche-effects')?.querySelector('.vtt-effect-tile:not(.add)'));
  _manageSendOpen = false;
  _manageDelegateOpen = false;
  if (!_insTab) _lastAnimatedPopover = null;
  const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
  _renderInspector(t);
}

export function _vttInsTogglePicker() {
  _conditionPickerOpen = !_conditionPickerOpen;
  const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
  _renderInspector(t);
}

export function _vttInsToggleManage(section) {
  if (section === 'pages') _manageSendOpen = !_manageSendOpen;
  if (section === 'delegates') _manageDelegateOpen = !_manageDelegateOpen;
  const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
  _renderInspector(t);
}

export async function _vttInsPurge(tokenId) {
  if (_purgeArmedUntil > Date.now()) {
    clearTimeout(_purgeTimer);
    _purgeArmedUntil = 0;
    await _vttClearBuffs(tokenId, { confirm:false });
    _renderInspectorSoon();
    return;
  }
  _purgeArmedUntil = Date.now() + 3000;
  const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
  _renderInspector(t);
  clearTimeout(_purgeTimer);
  _purgeTimer = setTimeout(() => {
    if (_purgeArmedUntil > Date.now()) return;
    _purgeArmedUntil = 0;
    const current = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : _defaultInspectorToken(null);
    _renderInspector(current);
  }, 3050);
}

// Filtre live du panneau « Jets de compétences » : masque/affiche les boutons et
// les groupes de caractéristiques sans reconstruire le panneau (garde le focus).
export function _vttSkillFilter(raw) {
  _skillFilter = raw || '';
  let total = 0;
  document.querySelectorAll('.vtt-ins-skills .vtt-sk-group').forEach(grp => {
    let vis = 0;
    grp.querySelectorAll('.vtt-skill-btn').forEach(btn => {
      const show = _searchIncludes(btn.dataset.skill || '', _skillFilter);
      btn.style.display = show ? '' : 'none';
      if (show) vis++;
    });
    grp.style.display = vis ? '' : 'none';
    total += vis;
  });
  document.querySelector('.vtt-ins-skills .vtt-sk-empty')
    ?.style.setProperty('display', total ? 'none' : '');
  document.querySelector('.vtt-skill-filter-clr')?.classList.toggle('hide', !_skillFilter);
}

export function _vttSkillFilterClear() {
  _skillFilter = '';
  const inp = document.querySelector('.vtt-skill-filter-input');
  if (inp) { inp.value = ''; }
  _vttSkillFilter('');
  inp?.focus();
}

// ── Données « Compétences » pour le LANCEUR DE DÉS du dock (vtt-dice.js) ──
// Renvoie une LISTE STRUCTURÉE (pas du HTML) — vtt-dice.js rend la grille + la barre
// partagée. Le calcul (statMod + eqBonus + profBonus) et le title détaillé restent
// ICI, inchangés. Contrat setJetsBuilder conservé : aucun import de vtt-dice.js.
//   → { hasSkills, who:{name,initial}, skills:[{name,stat,statKey,statColor,mod,
//        modStr,level,eqBonus,title}] }.
// Sans token contrôlable, un joueur conserve seulement les dés libres ; le MJ garde
// toutes les compétences avec un modificateur neutre et le bonus contextuel du lanceur.
// Les « Actions de combat » (Courir) et « Actions de la créature »
// NE sont plus ici : elles vivent dans la modale « Action tactique ».
export function _vttBuildJetsBody(tArg) {
  let t = tArg;
  if (!t) {
    const uid = STATE.user?.uid;
    if (STATE.isAdmin) {
      // MJ : on ne s'accroche PAS à un token arbitraire (il les contrôle tous).
      // Seul un token EXPLICITEMENT sélectionné porte ses caractéristiques. Sans
      // sélection, le MJ dispose tout de même des compétences avec un bonus de base 0.
      const sel = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : null;
      const onPage = sel && (!VS.activePage?.id || sel.pageId === VS.activePage.id);
      t = (onPage && _canControlToken(sel, uid)) ? sel : null;
    } else {
      // Joueur : token contrôlé de la scène (propriétaire ou délégation) sans avoir
      // à cliquer son pion — il n'en possède qu'un.
      const id = resolveControlledTokenId(
        VS.selected, VS.tokens, VS.activePage?.id || null,
        tok => _canControlToken(tok, uid),
      );
      t = id ? (VS.tokens[id]?.data ?? null) : null;
    }
  }
  const genericMjRoll = !t && STATE.isAdmin;
  if (!t && !genericMjRoll) return { hasSkills: false };

  // Jets ouverts à tout token porteur de stats (joueur, PNJ, créature du bestiaire)
  // dès qu'on le contrôle. _tokenStatMod sait lire characterId/npcId/beastId ; le
  // contrôle (_canControlToken) empêche un joueur de lancer pour un ennemi, le MJ
  // les contrôle tous. Les dessins/zones (sans source de stats) restent exclus.
  const hasStatSource = !!(t?.characterId || t?.npcId || t?.beastId);
  const canRoll = genericMjRoll
    ? VS.diceSkills.length > 0
    : hasStatSource && VS.diceSkills.length && _canControlToken(t);
  if (!canRoll) return { hasSkills: false };

  const ld = t ? _live(t) : null;
  const name = genericMjRoll ? 'Maître du jeu' : (ld?.displayName ?? t.name ?? 'Token');
  const cForBonus = t?.characterId ? VS.characters[t.characterId] : null;
  // Portrait : _live(t).displayImage résout déjà la photo pour joueurs, PNJ ET
  // créatures (fiche liée puis image du token) ; repli sur l'image posée du token.
  const avatar = genericMjRoll
    ? (STATE.profile?.photoURL || STATE.profile?.photo || STATE.profile?.avatar || null)
    : (ld?.displayImage || t.imageUrl || null);
  const who = {
    name,
    initial: genericMjRoll ? 'MJ' : (String(name || '?').trim().slice(0, 1).toUpperCase() || '?'),
    avatar,
  };

  // Tri : par caractéristique associée (FOR, DEX, CON, INT, SAG, CHA) puis alphabétique.
  const _STAT_ORDER = { FOR: 0, DEX: 1, CON: 2, INT: 3, SAG: 4, CHA: 5 };
  const skills = VS.diceSkills
    .slice()
    .sort((a, b) => {
      const oa = _STAT_ORDER[a.stat] ?? 99, ob = _STAT_ORDER[b.stat] ?? 99;
      return oa !== ob ? oa - ob : a.name.localeCompare(b.name, 'fr');
    })
    .map((s) => {
      const statKey = _STAT_KEY[s.stat] || '';
      const statMod = genericMjRoll ? 0 : _tokenStatMod(t, statKey);
      const eqBonus = cForBonus ? computeEquipSkillBonus(cForBonus.equipement || {}, s.name) : 0;
      const level = (cForBonus?.competences && !Array.isArray(cForBonus.competences)) ? cForBonus.competences[s.name] : null;
      const profBonus = (level === 'forme' || level === 'expert') ? 2 : 0;
      const mod = statMod + eqBonus + profBonus;
      const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '±0';
      const parts = genericMjRoll
        ? ['Jet MJ sans token', 'base +0']
        : [`base ${statMod >= 0 ? '+' : ''}${statMod}`];
      if (eqBonus) parts.push(`équip. ${eqBonus > 0 ? '+' : ''}${eqBonus}`);
      if (profBonus) parts.push(`${level === 'expert' ? 'expertise' : 'maîtrise'} +${profBonus}`);
      if (level === 'expert') parts.push('avantage');
      return {
        name: s.name,
        stat: s.stat || '',
        statKey,
        statColor: _STAT_COLOR[s.stat] || 'var(--text-dim)',
        mod, modStr, level, eqBonus,
        title: parts.join(' · '),
      };
    });

  return { hasSkills: skills.length > 0, who, skills };
}
