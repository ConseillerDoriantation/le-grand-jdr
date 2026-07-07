// ==============================================================================
// VTT — Chat & log de dés (rendu du journal, envoi, réponses)
// ------------------------------------------------------------------------------
// Sous-système extrait de vtt.js (cf. docs/vtt-decomposition.md). État local au
// module ; vtt.js initialise les souscriptions via _initChatLogSubs() et importe
// les handlers (data-vtt-fn). Imports circulaires ciblés vers vtt.js pour 3
// fonctions de combat/émotes (appelées au runtime → sûr).
// ==============================================================================
import { VS } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { DAMAGE_INTERACTIONS } from '../../shared/damage-profile.js';
import { onSnapshot, query, orderBy, limit, addDoc, serverTimestamp } from '../../config/firebase.js';
import { _logCol, _logGmCol } from './vtt-refs.js';
import { _vttPanelError } from './vtt-utils.js';
import { _findUsableReactiveShield, _canControlToken } from './vtt.js'; // circ. (combat)
import { _applyEmotes } from './vtt-emotes.js'; // leaf émotes

// État chat (déplacé de vtt.js)
export let _chatMsgs = [];   // derniers messages rendus (lookup "répondre" + bouclier/undo côté vtt.js)
let _chatReplyTo= null; // message auquel on répond { id, authorName, text }
let _logMain    = [];   // log public (vttLog) — dernier snapshot
let _logGm      = [];   // jets cachés (vttLogGm) — uniquement abonné côté MJ

// Souscriptions Firestore au log (publiques + jets cachés MJ). Appelé par vtt.js
// dans la séquence de montage. Les unsubs sont poussés dans VS.unsubs.
export function _initChatLogSubs() {
  VS.unsubs.push(onSnapshot(
    query(_logCol(), orderBy('createdAt', 'desc'), limit(80)),
    snap => { _logMain = snap.docs.map(d => ({ id: d.id, ...d.data() })); _rebuildChatLog(); },
    e => {
      console.error('[vtt] chat listener:', e);
      const el = document.getElementById('vtt-chat-log');
      if (el) el.innerHTML = `<div class="vtt-log-entry vtt-log-roll" style="color:#ef4444">⚠ Accès refusé — ajouter <code>vttLog</code> aux règles Firestore</div>`;
    }
  ));
  if (STATE.isAdmin) {
    VS.unsubs.push(onSnapshot(
      query(_logGmCol(), orderBy('createdAt', 'desc'), limit(80)),
      snap => { _logGm = snap.docs.map(d => ({ id: d.id, ...d.data() })); _rebuildChatLog(); },
      e => { console.error('[vtt] gm chat listener:', e); }
    ));
  }
}

export function _vttToggleLogDetail(detailId) {
  // `this` est le bouton via data-vtt-fn — le dispatcher l'a comme `$this` si demandé,
  // sinon on retrouve le bouton via querySelector du detail puis previousElementSibling.
  const d = document.getElementById(detailId);
  if (!d) return;
  const open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  // Le bouton cliqué est passé par event.currentTarget — récupérable via l'élément délégué.
  // Approche pragmatique : on cherche le bouton qui matche cette action+args dans le DOM.
  const btn = document.querySelector(`[data-vtt-fn="_vttToggleLogDetail"][data-vtt-args="${detailId}"]`);
  btn?.classList.toggle('open', !open);
}

export function _rebuildChatLog() {
  const merged = _logGm.length ? _logMain.concat(_logGm) : _logMain;
  const msgs = merged
    .slice()
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
    .slice(-80);
  _renderChatLog(msgs);
}

export function _renderChatLog(msgs) {
  try { return _renderChatLogImpl(msgs); }
  catch (e) { _vttPanelError('Chat', e, 'vtt-chat-log'); }
}
// Dernier jet animé : pour n'animer QUE la nouvelle entrée à son arrivée
// (le log se re-rend en entier → on évite de tout faire rejouer).
let _chatLastNewestId = null;
export function _renderChatLogImpl(msgs) {
  const el = document.getElementById('vtt-chat-log'); if (!el) return;
  const myUid = STATE.user?.uid;
  // Défense en profondeur : les jets cachés ne parviennent déjà plus aux joueurs
  // (collection vttLogGm non abonnée + règles), ce filtre reste un garde-fou UI.
  if (!STATE.isAdmin) msgs = msgs.filter(m => !m.gmOnly);
  _chatMsgs = msgs;   // pour le lookup "Répondre"

  // Bouclier réactif : repère le DERNIER coup reçu (damageant, non annulé) par
  // chaque token → seul ce log porte le bouton « Annuler ».
  const _lastHitLogId = {};
  const _lastHitMs = {};
  for (const m of msgs) {
    if (m.type !== 'attack' || m.isHeal || !(m.dmgTotal > 0) || !m.defenderTokenId || m.shieldCancelled) continue;
    const t = m.createdAt?.toMillis?.() ?? Infinity; // timestamp en attente = le plus récent
    if (t >= (_lastHitMs[m.defenderTokenId] ?? -1)) { _lastHitMs[m.defenderTokenId] = t; _lastHitLogId[m.defenderTokenId] = m.id; }
  }

  // MJ : bouton « ↩ Annuler l'action » sur les logs portant un snapshot d'undo.
  const _undoBtn = (m) => {
    if (!STATE.isAdmin) return '';
    if (m.actionUndone) return `<div class="vtt-log-undone">↩ Action annulée par le MJ</div>`;
    if (!m.undo) return '';
    return `<button class="vtt-log-undo-btn" data-vtt-fn="_vttUndoAction" data-vtt-args="${m.id}"
      title="Annuler cette action — rend PV/PM, retire les buffs et états posés">↩ Annuler l'action</button>`;
  };

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS — composants réutilisables pour tous les types de log
  // ═══════════════════════════════════════════════════════════════════
  const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
  const sub = t => `<span style="color:var(--text-dim);font-size:.65rem">(${_esc(t||'')})</span>`;

  // Portrait 30px : image si dispo, sinon initiale colorée
  const _portrait = (url, name) => url
    ? `<img class="vtt-log-portrait-lg" src="${_esc(url)}" alt="${_esc(name||'')}" data-img-err="hide">`
    : `<div class="vtt-log-portrait-lg">${_esc((name||'?')[0].toUpperCase())}</div>`;

  // Acteur = portrait + nom
  const _actor = (image, name) => `<span class="vtt-log-actor">${_portrait(image, name)}<span class="vtt-log-name">${_esc(name||'?')}</span></span>`;
  const _sourceArgs = (m, tab = 'combat') => {
    if (!STATE.isAdmin || !m) return '';
    if (m.sourceCharacterId) return `char|${m.sourceCharacterId}|${tab}`;
    if (m.sourceNpcId) return `npc|${m.sourceNpcId}`;
    if (m.sourceBeastId) return `bestiary|${m.sourceBeastId}`;
    return '';
  };
  const _targetArgs = (m, tab = 'combat') => {
    if (!STATE.isAdmin || !m) return '';
    if (m.characterId) return `char|${m.characterId}|${tab}`;
    if (m.npcId) return `npc|${m.npcId}`;
    if (m.beastId) return `bestiary|${m.beastId}`;
    return '';
  };
  const _sourceLink = (args, title = 'Ouvrir la source') => args
    ? `<button class="vtt-log-source-btn" data-vtt-fn="_vttOpenSource" data-vtt-args="${_esc(args)}" title="${_esc(title)}">↗</button>`
    : '';

  // Header source ▸ cible avec label optionnel
  const _header = ({ srcImg, srcName, tgtImg, tgtName, label, badges = '', ts = '', sourceArgs = '', targetArgs = '' }) => {
    const arrow = tgtName ? `<span class="vtt-log-arrow">▸</span>` : '';
    const tgt = tgtName ? _actor(tgtImg, tgtName) : '';
    const lbl = label ? `<span class="vtt-log-label">${_esc(label)}</span>` : '';
    return `<div class="vtt-log-head">
      ${_actor(srcImg, srcName)}${_sourceLink(sourceArgs)}${arrow}${tgt}${_sourceLink(targetArgs, 'Ouvrir la cible')}${lbl}
      <span class="vtt-log-meta">${badges}${ts}</span>
    </div>`;
  };

  // Timestamp HH:MM
  const _ts = m => {
    const ms = m.createdAt?.toMillis?.();
    if (!ms) return '';
    const d = new Date(ms);
    return `<span class="vtt-log-time">${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span>`;
  };

  // Bouton de toggle détail (avec écouteur attaché plus bas)
  const _toggle = (id) => `<button class="vtt-log-toggle" data-detail="${id}">détail ▾</button>`;

  // Ligne de détail (formule + valeur) — finale = surlignée à la couleur du type
  const _row = (label, val, { op = '🎲', isFinal = false } = {}) => `
    <div class="vtt-log-detail-row${isFinal ? ' is-final' : ''}">
      <span class="vtt-log-detail-label"><span class="op">${op}</span>${label}</span>
      <span class="vtt-log-detail-val">${val}</span>
    </div>`;

  // Affichage d'un jet de dés : 1d6(4) ou 2d6(3,5) — gras sur les rolls individuels
  const _dice = (det, fallback = '?') => {
    if (det?.rolls?.length) {
      const rollsTxt = det.rolls.map(r => `<strong>${r}</strong>`).join(',');
      const modPart = det.mod > 0 ? ` +${det.mod}` : det.mod < 0 ? ` ${det.mod}` : '';
      return `${det.rolls.length}d${det.sides}(${rollsTxt})${modPart}`;
    }
    return String(fallback);
  };

  // d20 avec adv/dis (dé rejeté barré)
  const _d20 = (kept, allRolls) => {
    if (Array.isArray(allRolls) && allRolls.length > 1) {
      const dropped = allRolls.find(r => r !== kept) ?? allRolls[1];
      return `d20[<strong>${kept}</strong>&thinsp;<span style="text-decoration:line-through;color:var(--text-dim);font-weight:400">${dropped}</span>]`;
    }
    return `d20[<strong>${kept ?? '?'}</strong>]`;
  };

  // Estimation CA visible par le joueur (pas spoil pour les non-MJ)
  //  • MJ : voit la vraie CA enregistrée dans le log
  //  • Joueur : voit son estimation (track.caEstimee du bestiaire) ; sinon "?"
  //  • Pour un PJ allié : on montre la CA réelle (les joueurs connaissent leurs alliés)
  const _viewCA = (target, realCA) => {
    if (STATE.isAdmin) return realCA ?? '?';
    if (target.characterId) return realCA ?? '?';
    if (target.beastId) {
      const track = VS.bstTracker[target.beastId];
      if (track?.caEstimee !== undefined && track.caEstimee !== '') {
        return parseInt(track.caEstimee) || '?';
      }
      return '?';
    }
    if (target.npcId) return '?'; // PNJ : pas d'estimation, masquée
    return realCA ?? '?';
  };

  // Badges avantage / désavantage
  const _advBadge = (mode) => mode === 'adv'
    ? `<span class="vtt-log-badge vtt-log-badge--adv" title="Avantage">⬆ ADV</span>`
    : mode === 'dis'
      ? `<span class="vtt-log-badge vtt-log-badge--dis" title="Désavantage">⬇ DIS</span>`
      : '';

  // ═══════════════════════════════════════════════════════════════════
  // RENDERS — un par type de message, tous au même format
  // ═══════════════════════════════════════════════════════════════════

  /** Attaque single-target (offensive ET heal) */
  const renderAttack = (m, i, ts) => {
    const isHeal = !!m.isHeal;
    const isCrit = !!m.isCrit, isFumble = !!m.isFumble;
    const isHalf = !!m.halfDmg, isHit = !!m.hit;
    let theme = 'miss';
    if (isHeal) theme = isFumble ? 'fumble' : 'heal';
    else if (isCrit) theme = 'crit';
    else if (isFumble) theme = 'fumble';
    else if (isHit)  theme = 'hit';
    else if (isHalf) theme = 'half';

    const badges = [
      _advBadge(m.advMode),
      isCrit   ? `<span class="vtt-log-badge vtt-log-badge--crit">💥 CRIT</span>` : '',
      isFumble ? `<span class="vtt-log-badge vtt-log-badge--fumble">💀 FUMBLE</span>` : '',
    ].join('');

    const head = _header({
      srcImg: m.characterImage, srcName: m.attackerName || m.authorName || '?',
      tgtImg: m.defenderImage, tgtName: m.defenderName,
      label:  m.optLabel, badges, ts,
      sourceArgs: _sourceArgs(m, m.isHeal ? 'sorts' : 'combat'),
      targetArgs: _targetArgs(m, 'combat'),
    });

    // Headline : résultat principal
    let bodyHtml = '';
    if (isHeal) {
      if (isFumble) {
        bodyHtml = `<div class="vtt-log-body">
          <span class="vtt-log-icon">💔</span>
          <strong class="vtt-log-result">RATÉ</strong>
          <span class="vtt-log-result-sub">${m.pmCost||0} PM consommés</span>
          ${_toggle(`d${i}`)}
        </div>`;
      } else {
        bodyHtml = `<div class="vtt-log-body">
          <span class="vtt-log-icon">💚</span>
          <strong class="vtt-log-result">+${m.dmgTotal}</strong>
          <span class="vtt-log-result-sub">PV soignés</span>
          ${isCrit ? `<span class="vtt-log-result-sub" style="color:#f59e0b">(critique)</span>` : ''}
          ${_toggle(`d${i}`)}
        </div>`;
      }
    } else {
      // Attaque offensive : Toucher en premier, dégâts en second
      const dmgCol = m.interaction === 'Absorption' ? '#22c38e'
                   : isHalf                          ? '#b47fff'
                   :                                   '#ef4444';
      const dmgIcon = m.interaction === 'Absorption' ? '💚'
                    : m.interaction === 'Immunité'   ? '🚫'
                    :                                   '⚔️';
      const dmgLabel = m.interaction === 'Absorption' ? 'PV soignés'
                     : m.interaction === 'Immunité'   ? 'aucun dégât'
                     : m.newHp === 0                  ? 'KO'
                     : isHalf                         ? '½ dégâts'
                     :                                  'dégâts';
      const interTag = m.interaction && DAMAGE_INTERACTIONS[m.interaction]
        ? (() => { const im = DAMAGE_INTERACTIONS[m.interaction];
            return `<span class="vtt-log-badge" style="color:${im.color};background:${im.color}1a">${im.icon} ${_esc(m.interaction)}</span>`;
          })()
        : '';
      const dmgVal = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
      // Ligne 1 : jet de toucher — on affiche le TOTAL calculé ET le dé naturel.
      // (CA estimée pour les joueurs sur les ennemis)
      const _shownCA = _viewCA(m, m.targetCA);
      const natDie = (m.hitD20 != null)
        ? `<span class="vtt-log-nat" title="Jet naturel du dé (avant modificateurs)">${_d20(m.hitD20, m.hitD20rolls)}</span>`
        : '';
      const hitRow = m.autoHit
        ? `<div class="vtt-log-body">
        <span class="vtt-log-icon">🎯</span>
        <strong class="vtt-log-result" style="color:#22c38e">Touche auto</strong>
        <span class="vtt-log-result-sub" style="color:#22c38e;font-weight:700">✓ TOUCHE</span>
        ${_toggle(`d${i}`)}
      </div>`
        : `<div class="vtt-log-body">
        <span class="vtt-log-icon">🎯</span>
        <strong class="vtt-log-result" style="font-size:1.15rem;color:${isHit?'#22c38e':'#ef4444'}">${m.hitTotal ?? '?'}</strong>
        ${natDie}
        <span class="vtt-log-vs">vs CA ${_shownCA}</span>
        <span class="vtt-log-result-sub" style="color:${isHit?'#22c38e':'#ef4444'};font-weight:700">${isHit ? '✓ TOUCHE' : '✗ RATÉ'}</span>
        ${_toggle(`d${i}`)}
      </div>`;
      // Ligne 2 : dégâts (si applicable)
      const dmgRow = (isHit || isHalf) ? `<div class="vtt-log-body" style="padding-top:.05rem">
        <span class="vtt-log-icon">${dmgIcon}</span>
        <strong class="vtt-log-result" style="color:${dmgCol}">${dmgVal}</strong>
        <span class="vtt-log-result-sub" style="color:${dmgCol}">${dmgLabel}</span>
        ${interTag}
        ${m.dmgReduction > 0 ? `<span class="vtt-log-badge" style="color:#60a5fa;background:rgba(96,165,250,.18)">🛡 Set Lourd −${m.dmgReduction}</span>` : ''}
      </div>` : '';
      bodyHtml = hitRow + dmgRow;
    }

    // Panneau détail
    const detail = buildAttackDetail(m, isHeal);

    // ── Bouclier réactif : annulation manuelle depuis le chat ───────────────
    // Visible pour le contrôleur de la cible (ou MJ) si elle porte un bouclier
    // dont le palier couvre le rang de l'attaquant, et si l'attaque a fait des
    // dégâts non déjà annulés.
    let shieldHtml = '';
    if (m.shieldCancelled) {
      shieldHtml = `<div class="vtt-log-shield-done">🛡 Coup annulé (bouclier réactif) · +${m.dmgTotal} PV rendus</div>`;
    } else if (!isHeal && (m.dmgTotal || 0) > 0 && m.defenderTokenId
               && _lastHitLogId[m.defenderTokenId] === m.id) {
      // Seulement sur le DERNIER coup reçu par cette cible, pour son contrôleur,
      // et s'il possède un sort Bouclier réactif utilisable (palier + PM).
      const dtok = VS.tokens[m.defenderTokenId]?.data;
      if (dtok && (STATE.isAdmin || _canControlToken(dtok))
          && _findUsableReactiveShield(dtok, m.attackerRank || 'classique')) {
        shieldHtml = `<button class="vtt-log-shield-btn" data-vtt-fn="_vttShieldCancelAttack" data-vtt-args="${m.id}"
          title="Annuler ce coup avec ton bouclier réactif — rend ${m.dmgTotal} PV, consomme les PM du sort (non remboursés)">🛡 Annuler (bouclier réactif)</button>`;
      }
    }

    return `<div class="vtt-log vtt-log--${theme}">
      ${head}
      ${bodyHtml}
      ${shieldHtml}
      ${_undoBtn(m)}
      <div class="vtt-log-detail" id="d${i}">${detail}</div>
    </div>`;
  };

  /** Détail d'une attaque : toucher détaillé + dégâts détaillés (chaque dé visible) */
  const buildAttackDetail = (m, isHeal) => {
    const rows = [];
    // ── TOUCHER ──
    const d20 = _d20(m.hitD20, m.hitD20rolls);
    const touchParts = [d20];
    if (m.hitToucherMod != null && m.hitToucherStatLabel) touchParts.push(`${sn(m.hitToucherMod)}${sub(m.hitToucherStatLabel)}`);
    if (m.hitToucherSetBonus > 0) touchParts.push(`+${m.hitToucherSetBonus}${sub('Set')}`);
    if (m.hitTouchBuff > 0) touchParts.push(`+${m.hitTouchBuff}${sub('🎯 Ench')}`);
    if (m.hitBonus) touchParts.push(`${sn(m.hitBonus)}${sub('bonus')}`);
    if (m.extraHitRolls?.length) m.extraHitRolls.forEach(r => touchParts.push(`+d20[${r}]`));
    const _caShown = isHeal ? null : _viewCA(m, m.targetCA);
    rows.push(_row(touchParts.join(' '), `<strong>${m.hitTotal ?? '?'}</strong>${isHeal ? ` vs DD ${m.healDD ?? 2}` : ` vs CA ${_caShown}`}`, { op: '🎯', isFinal: false }));

    // ── DÉGÂTS / SOIN ──
    if (m.hit || m.halfDmg || isHeal) {
      const baseRoll = _dice(m.dmgRollsDetail, `${_esc(m.dmgEffectiveDice || m.dmgRawDice || m.dmgFormula || '')}(${m.dmgRaw})`);
      const critRoll = _dice(m.critRollsDetail, baseRoll);
      const mods = [];
      if (m.dmgStatMod) mods.push(`${sn(m.dmgStatMod)}${sub(m.dmgStatLabel || '')}`);
      if (m.dmgMaitriseBonus > 0) mods.push(`+${m.dmgMaitriseBonus}${sub('Maîtrise')}`);
      if (m.dmgBonus) mods.push(`${sn(m.dmgBonus)}${sub('bonus')}`);
      if (m.dmgBonusDice) mods.push(`${sn(m.dmgBonusDice)}${sub('dés')}`);
      // Bonus enchant détaillé
      if (m.buffDmgDetail) {
        const bd = m.buffDmgDetail;
        const rollsTxt = bd.rolls?.length ? bd.rolls.map(r=>`<strong>${r}</strong>`).join(',') : '';
        const modStr = bd.mod > 0 ? ` +${bd.mod}` : bd.mod < 0 ? ` ${bd.mod}` : '';
        mods.push(`+${bd.rolls?.length ? `${bd.rolls.length}d${bd.sides}(${rollsTxt})${modStr}` : bd.total}${sub(bd.sortLabel || 'Enchant')}`);
      } else if (m.buffDmgBonus) {
        mods.push(`+${m.buffDmgBonus}${sub('Enchant')}`);
      }
      const formula = m.isCrit && m.critNormalMax
        ? `max(${m.critNormalMax}) + ${critRoll} ${mods.join(' ')}`
        : `${baseRoll} ${mods.join(' ')}`;

      // Si tout droit : valeur finale = dmgFull
      const fullVal = m.dmgFull ?? m.dmgTotal;
      const halfVal = m.halfDmg ? Math.max(1, Math.floor(fullVal / 2)) : null;
      const hasReduction = m.dmgReduction > 0;
      const hasInter = m.interaction && m.dmgTotal !== (halfVal ?? fullVal);

      const isFinalBrut = !halfVal && !hasInter && !hasReduction;
      rows.push(_row(formula, `<strong>${fullVal}</strong>`, { op: isHeal ? '💚' : '⚔️', isFinal: isFinalBrut }));

      if (halfVal != null && halfVal !== fullVal) {
        rows.push(_row(`Échec ½ (sort/arme magique)`, `<strong>${halfVal}</strong>`, { op: '✦', isFinal: !hasInter && !hasReduction }));
      }
      if (hasInter) {
        const im = DAMAGE_INTERACTIONS[m.interaction];
        const fmt = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
        rows.push(_row(`${im?.icon || '✦'} ${m.interaction}`, `<strong>${fmt}</strong>`, { op: im?.icon || '✦', isFinal: !hasReduction }));
      }
      if (hasReduction) {
        const fmt = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
        rows.push(_row(`Set Lourd −${m.dmgReduction} (min. 1)`, `<strong>${fmt}</strong>`, { op: '🛡', isFinal: true }));
      }
    }
    return rows.join('');
  };

  /** Attaque multi-cibles (sort à plusieurs cibles, AoE) */
  const renderMultiAttack = (m, i, ts) => {
    const isCrit = !!m.isCrit, isFumble = !!m.isFumble;
    const theme = isCrit ? 'crit' : isFumble ? 'fumble' : (m.targets?.some(r=>r.hit) ? 'hit' : 'miss');
    const badges = [
      _advBadge(m.advMode),
      isCrit   ? `<span class="vtt-log-badge vtt-log-badge--crit">💥 CRIT</span>` : '',
      isFumble ? `<span class="vtt-log-badge vtt-log-badge--fumble">💀 FUMBLE</span>` : '',
    ].join('');

    const head = _header({
      srcImg: m.characterImage, srcName: m.attackerName || m.authorName || '?',
      tgtName: `${(m.targets||[]).length} cibles`,
      label:   m.optLabel, badges, ts, sourceArgs: _sourceArgs(m, m.isHeal ? 'sorts' : 'combat'),
    });

    // Headline : touche total (commun à toutes les cibles)
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🎯</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${m.hitTotal}</strong>
      <span class="vtt-log-vs">contre les CA</span>
      ${_toggle(`d${i}`)}
    </div>`;

    // Liste des cibles avec leur résolution individuelle
    // CA affichée selon le viewer : MJ = réelle, joueur = estimation perso
    const targets = (m.targets || []).map(r => {
      const baseCol = r.hit ? '#22c38e' : r.halfDmg ? '#b47fff' : '#6b7280';
      const icon = r.hit ? '✓' : r.halfDmg ? '✦' : '✗';
      const dmgVal = (r.hit || r.halfDmg) ? (r.dmgTotal < 0 ? `+${-r.dmgTotal}` : r.dmgTotal) : '—';
      const dmgSuffix = r.newHp === 0 ? ' 💀' : '';
      const shownCA = _viewCA(r, r.targetCA);
      // Portrait de la cible : son image si disponible (ex. invocation), sinon
      // l'icône de résolution. La pastille de couleur reste le statut hit/miss.
      const portraitInner = r.targetImage
        ? `<img src="${_esc(r.targetImage)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" data-img-err="text" data-img-err-text="${_esc(icon)}">`
        : icon;
      const targetSourceLink = _sourceLink(_targetArgs(r, 'combat'), 'Ouvrir la cible');
      return `<div class="vtt-log-target" style="--row-c:${baseCol}">
        <div class="vtt-log-target-portrait" style="background:${baseCol}">${portraitInner}</div>
        <span class="vtt-log-target-name">${_esc(r.name)}</span>${targetSourceLink}
        <span class="vtt-log-target-ca">CA ${shownCA}</span>
        <span class="vtt-log-target-dmg">${dmgVal}${dmgSuffix}</span>
      </div>`;
    }).join('');

    return `<div class="vtt-log vtt-log--${theme}">
      ${head}
      ${body}
      <div class="vtt-log-targets">${targets}</div>
      ${_undoBtn(m)}
      <div class="vtt-log-detail" id="d${i}">${buildAttackDetail(m, false)}</div>
    </div>`;
  };

  /** Cast de sort (CA, utilitaire) */
  const renderCast = (m, i, ts) => {
    const pmBadge = m.pmCost > 0
      ? `<span class="vtt-log-badge vtt-log-badge--pm">−${m.pmCost} PM</span>` : '';
    const head = _header({
      srcImg: m.characterImage, srcName: m.casterName || m.authorName || '?',
      tgtName: m.targetName, label: m.optLabel,
      badges: pmBadge, ts, sourceArgs: _sourceArgs(m, 'sorts'), targetArgs: _targetArgs(m, 'combat'),
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">${m.castEC ? '💔' : '✨'}</span>
      <span class="vtt-log-text">${_esc(m.castEffect || 'Sort activé')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--cast${m.castEC ? ' vtt-log--cast-ec' : ''}">${head}${body}${_undoBtn(m)}</div>`;
  };

  /** Annonce d'affliction : "A lance Silence sur B" */
  const renderAfflictionCast = (m, i, ts) => {
    const head = _header({
      srcImg: m.characterImage, srcName: m.casterName || m.authorName || '?',
      tgtName: m.targetName, label: m.optLabel,
      badges: `<span class="vtt-log-badge" style="color:#c4b5fd;background:rgba(180,127,255,.18)">🛡 JS ${_esc(m.statLabel||'?')} DD ${m.dd}</span>`,
      ts, sourceArgs: _sourceArgs(m, 'sorts'), targetArgs: _targetArgs(m, 'combat'),
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🪄</span>
      <span class="vtt-log-text">Tente d'appliquer ${_esc(m.effectLbl||'')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--aff">${head}${body}</div>`;
  };

  /** Jet de sauvegarde */
  const renderSave = (m, i, ts) => {
    const passed = !!m.passed;
    const theme = passed ? 'saveok' : 'savefail';
    const modStr = (m.mod >= 0 ? '+' : '') + m.mod;
    const badge = passed
      ? `<span class="vtt-log-badge vtt-log-badge--ok">✅ RÉUSSI</span>`
      : `<span class="vtt-log-badge vtt-log-badge--fail">❌ ÉCHEC</span>`;
    const head = _header({
      srcImg: m.characterImage || null, srcName: m.tokenName || '?',
      label: m.sortLabel ? `JS vs ${m.sortLabel}` : `JS ${m.statLabel||''}`,
      badges: badge, ts, sourceArgs: _targetArgs(m, 'combat'),
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🛡</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${m.total}</strong>
      <span class="vtt-log-vs">vs DD ${m.dd}</span>
      <span class="vtt-log-result-sub">d20[<strong>${m.d20}</strong>] ${modStr}${sub(m.statLabel||'')}</span>
      ${!passed && m.conditionLabel
        ? `<span class="vtt-log-result-sub" style="color:#fca5a5;font-weight:700">→ subit ${_esc(m.conditionLabel)}</span>`
        : passed
          ? `<span class="vtt-log-result-sub" style="color:#86efac;font-weight:700">→ résiste</span>`
          : ''}
    </div>`;
    return `<div class="vtt-log vtt-log--${theme}">${head}${body}</div>`;
  };

  /** Jet de concentration */
  const renderConcentrationSave = (m, i, ts) => {
    const forced = !!m.forcedBreak;
    const passed = !!m.passed && !forced;
    const theme = passed ? 'saveok' : 'savefail';
    const badge = forced
      ? `<span class="vtt-log-badge vtt-log-badge--fail">PV À 0</span>`
      : passed
        ? `<span class="vtt-log-badge vtt-log-badge--ok">✅ MAINTENU</span>`
        : `<span class="vtt-log-badge vtt-log-badge--fail">❌ ROMPU</span>`;
    const head = _header({
      srcImg: m.characterImage || null,
      srcName: m.tokenName || '?',
      label: `Concentration · ${m.sortLabel || 'Sort'}`,
      badges: badge,
      ts,
      sourceArgs: _targetArgs(m, 'combat'),
    });
    const modStr = (m.mod >= 0 ? '+' : '') + (m.mod ?? 0);
    const result = forced
      ? `<strong class="vtt-log-result" style="font-size:1.05rem;color:#ef4444">Concentration rompue</strong>
         <span class="vtt-log-result-sub">le lanceur tombe à 0 PV</span>`
      : `<strong class="vtt-log-result" style="font-size:1.15rem;color:${passed ? '#22c38e' : '#ef4444'}">${m.total}</strong>
         <span class="vtt-log-vs">vs DD ${m.dd}</span>
         <span class="vtt-log-result-sub">d20[<strong>${m.d20}</strong>] ${modStr}${sub(m.statLabel || 'Sa')}</span>`;
    const tail = passed
      ? `<span class="vtt-log-result-sub" style="color:#86efac;font-weight:700">→ sort maintenu</span>`
      : `<span class="vtt-log-result-sub" style="color:#fca5a5;font-weight:700">→ effets dissipés</span>`;
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🧠</span>
      ${result}
      ${tail}
    </div>`;
    return `<div class="vtt-log vtt-log--${theme}">${head}${body}</div>`;
  };

  /** Tick DoT */
  const renderDotTick = (m, i, ts) => {
    const isHealTick = !!m.isHeal;
    const lbl = m.immediate ? 'Proc immédiat' : (isHealTick ? 'Régénération' : 'Tick de round');
    const rollsDetail = (m.rolls || []).map(r => {
      const dicePart = r.rolledDice?.length
        ? `${r.rolledDice.length}d${r.sides}(${r.rolledDice.map(x=>`<strong>${x}</strong>`).join(',')})`
        : r.formula;
      const modPart = r.mod > 0 ? ` +${r.mod}` : r.mod < 0 ? ` ${r.mod}` : '';
      return `${_esc(r.sortLabel)}: ${dicePart}${modPart} = <strong>${r.rolled}</strong>`;
    }).join(' · ');
    const head = _header({
      srcImg: m.characterImage || null, srcName: m.tokenName || '?',
      label: lbl, badges: '', ts, sourceArgs: _targetArgs(m, 'combat'),
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">${isHealTick ? '💚' : '🩸'}</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${isHealTick ? '+' : '−'}${m.total}</strong>
      <span class="vtt-log-result-sub">PV (${isHealTick ? 'Régénération' : 'DoT'})</span>
      ${m.newHp != null && m.hpMax ? `<span class="vtt-log-vs">→ ${m.newHp}/${m.hpMax}</span>` : ''}
    </div>`;
    const detailHtml = rollsDetail
      ? `<div class="vtt-log-detail-row"><span class="vtt-log-detail-label"><span class="op">🎲</span>${rollsDetail}</span><span class="vtt-log-detail-val"><strong>${m.total}</strong></span></div>`
      : '';
    const wrapper = detailHtml
      ? `<div class="vtt-log-detail is-open">${detailHtml}</div>` : '';
    return `<div class="vtt-log vtt-log--dot">${head}${body}${wrapper}</div>`;
  };

  /** Jet libre (test de carac) */
  const renderRoll = (m, i, ts) => {
    const resultCol = m.isCrit ? '#ffd700' : m.isFumble ? '#ef4444' : 'var(--text)';
    const modStr   = m.rollMod > 0 ? `+${m.rollMod}` : m.rollMod < 0 ? `${m.rollMod}` : '';
    const bonusStr = m.rollBonus > 0 ? `+${m.rollBonus}` : m.rollBonus < 0 ? `${m.rollBonus}` : '';
    const equipStr = m.rollEquipBonus > 0 ? `+${m.rollEquipBonus}` : m.rollEquipBonus < 0 ? `${m.rollEquipBonus}` : '';
    const badges = [
      m.gmOnly ? `<span class="vtt-log-badge vtt-log-badge--hidden" title="Jet caché — invisible des joueurs">🕶 Caché</span>` : '',
      m.isCrit ? `<span class="vtt-log-badge vtt-log-badge--crit">✨ CRIT</span>` : '',
      m.isFumble ? `<span class="vtt-log-badge vtt-log-badge--fumble">💀 FUMBLE</span>` : '',
      _advBadge(m.rollMode === 'advantage' ? 'adv' : m.rollMode === 'disadvantage' ? 'dis' : null),
    ].join('');
    const head = _header({
      srcImg: m.characterImage, srcName: m.characterName || m.authorName || '?',
      label: m.rollSkill || m.rollFormula || 'Jet', badges, ts,
      sourceArgs: _targetArgs(m, 'combat'),
    });
    const diceStr = Array.isArray(m.rollDice) && m.rollDice.length === 2
      ? _d20(m.rollRaw, m.rollDice)
      : `d20[<strong>${m.rollRaw ?? '?'}</strong>]`;
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🎲</span>
      <strong class="vtt-log-result" style="color:${resultCol};font-size:1.3rem">${m.rollResult ?? '?'}</strong>
      <span class="vtt-log-result-sub">${diceStr} ${modStr ? `${modStr}${sub(m.rollStat||'')}` : ''} ${equipStr ? `${equipStr}${sub('équip.')}` : ''} ${bonusStr ? `${bonusStr}${sub('bonus')}` : ''}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--roll">${head}${body}</div>`;
  };

  /** Jet libre formule (dice-free) */
  const renderDiceFree = (m, i, ts) => {
    const totalCol = m.total >= 20 ? '#22c38e' : m.total <= 3 ? '#ef4444' : 'var(--text)';
    const detail = (m.groups || []).map(g => {
      if (g.kept != null) {
        const dropped = g.rolls.find(r=>r!==g.kept) ?? g.rolls[1];
        return `d${g.faces}[<strong>${g.kept}</strong>&thinsp;<span style="color:var(--text-dim);text-decoration:line-through">${dropped}</span>]`;
      }
      return `${g.count}d${g.faces}[${g.rolls.map(r=>`<strong>${r}</strong>`).join(',')}]`;
    });
    if (m.bonus) detail.push(m.bonus>0 ? `<span style="color:#e8b84b">+${m.bonus}</span>` : `<span style="color:#ef4444">${m.bonus}</span>`);
    const badges = m.mode === 'advantage'
      ? `<span class="vtt-log-badge vtt-log-badge--adv">⬆ ADV</span>`
      : m.mode === 'disadvantage'
        ? `<span class="vtt-log-badge vtt-log-badge--dis">⬇ DIS</span>` : '';
    const head = _header({
      srcImg: null, srcName: m.authorName || '?',
      label: m.formula || 'Jet libre', badges, ts,
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🎲</span>
      <strong class="vtt-log-result" style="color:${totalCol};font-size:1.3rem">${m.total}</strong>
      <span class="vtt-log-result-sub">${detail.join(' · ')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--roll">${head}${body}</div>`;
  };

  /** Message chat normal */
  const renderChat = (m) => {
    const isMe = m.authorId === myUid;
    const quote = m.replyTo ? `<div class="vtt-chat-quote">
        <span class="vtt-chat-quote-who">↩ ${_esc(m.replyTo.authorName||'?')}</span>
        <span class="vtt-chat-quote-text">${_esc(m.replyTo.text||'')}</span>
      </div>` : '';
    return `<div class="vtt-log vtt-log--chat">
      <div class="vtt-log-chat-msg">
        ${quote}
        <span class="vtt-log-chat-who${isMe?' me':''}">${_esc(m.authorName||'?')}</span>
        <span class="vtt-log-chat-text">${_applyEmotes(_esc(m.text||''))}</span>
        <span class="vtt-log-meta">${_ts(m)}</span>
        <button class="vtt-chat-reply-btn" data-vtt-fn="_vttChatReply" data-vtt-args="${m.id}" title="Répondre">↩</button>
      </div>
    </div>`;
  };

  /** Recette rapide craftée depuis la mini-fiche (jet d'Artisanat) */
  const renderCraft = (m, i, ts) => {
    const passed = !!m.passed;
    const theme = passed ? 'saveok' : 'savefail';
    const modStr = (m.mod >= 0 ? '+' : '') + m.mod;
    const badge = passed
      ? `<span class="vtt-log-badge vtt-log-badge--ok">✅ CRAFTÉ</span>`
      : `<span class="vtt-log-badge vtt-log-badge--fail">❌ RATÉ</span>`;
    const head = _header({
      srcImg: m.characterImage || null, srcName: m.charName || m.authorName || '?',
      label: `🔨 ${m.recipeName || 'Artisanat'}`,
      badges: badge, ts,
      sourceArgs: _targetArgs(m, 'inv'),
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🔨</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${m.total}</strong>
      <span class="vtt-log-vs">vs DD ${m.dd}</span>
      <span class="vtt-log-result-sub">d20[<strong>${m.d20}</strong>] ${modStr}${sub(m.statLabel||'')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--${theme}">${head}${body}</div>`;
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDU
  // ═══════════════════════════════════════════════════════════════════
  el.innerHTML = msgs.map((m, i) => {
    const ts = _ts(m);
    if (m.type === 'attack')          return renderAttack(m, i, ts);
    if (m.type === 'attack-multi')    return renderMultiAttack(m, i, ts);
    if (m.type === 'cast')            return renderCast(m, i, ts);
    if (m.type === 'affliction-cast') return renderAfflictionCast(m, i, ts);
    if (m.type === 'save')            return renderSave(m, i, ts);
    if (m.type === 'concentration-save') return renderConcentrationSave(m, i, ts);
    if (m.type === 'dot-tick')        return renderDotTick(m, i, ts);
    if (m.type === 'roll')            return renderRoll(m, i, ts);
    if (m.type === 'dice-free')       return renderDiceFree(m, i, ts);
    if (m.type === 'craft')           return renderCraft(m, i, ts);
    return renderChat(m);
  }).join('');

  // Anime UNIQUEMENT le dernier jet quand un NOUVEAU arrive (pas au 1er rendu,
  // pas sur une simple mise à jour). Donne de la vie à chaque résultat de dé.
  const _newestId = msgs.length ? msgs[msgs.length - 1].id : null;
  if (_newestId && _chatLastNewestId !== null && _newestId !== _chatLastNewestId) {
    const last = el.lastElementChild;
    if (last) {
      last.classList.add('vtt-log-enter');
      last.addEventListener('animationend', () => last.classList.remove('vtt-log-enter'), { once: true });
    }
  }
  _chatLastNewestId = _newestId;

  // Wire up detail toggles (clic = ouvre/ferme le panneau associé)
  el.querySelectorAll('.vtt-log-toggle').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.detail;
      const panel = document.getElementById(id);
      if (!panel) return;
      const open = panel.classList.toggle('is-open');
      btn.classList.toggle('is-open', open);
      btn.textContent = open ? 'détail ▴' : 'détail ▾';
    };
  });

  el.scrollTop = el.scrollHeight;
}

export async function _vttSendChat() {
  const input=document.getElementById('vtt-chat-input');
  const text=input?.value.trim(); if (!text) return;
  input.value='';
  const replyTo = _chatReplyTo;   // capture avant reset
  _vttChatReplyCancel();          // ferme la barre de réponse
  const authorName=STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';
  const payload = { type:'chat', authorId:STATE.user?.uid||null, authorName, text, createdAt:serverTimestamp() };
  if (replyTo) {
    // Extrait court du message cité (évite de stocker un pavé)
    payload.replyTo = {
      id: replyTo.id || '',
      authorName: replyTo.authorName || '?',
      text: (replyTo.text || '').slice(0, 140),
    };
  }
  try {
    await addDoc(_logCol(), payload);
  } catch(e) {
    if (input) input.value=text; // restaurer le texte si échec
    console.error('[vtt] chat send:', e);
    const reason=e.code==='permission-denied'
      ? 'Règles Firestore : ajouter vttLog (voir docs/firestore-rules.md)'
      : e.message;
    showNotif(`Erreur chat : ${reason}`,'error');
  }
}

// ── Répondre à un message (citation type messagerie) ──────────────────────
// Construit un extrait textuel du message cité (gère aussi les jets/attaques).
export function _chatMsgExcerpt(m) {
  if (!m) return '';
  if (m.text) return m.text;
  if (m.type === 'attack' || m.type === 'attack-multi') return `⚔️ ${m.optLabel || 'Attaque'}`;
  if (m.type === 'cast' || m.type === 'affliction-cast') return `✨ ${m.optLabel || 'Sort'}`;
  if (m.type === 'roll' || m.type === 'dice-free') return `🎲 Jet${m.total != null ? ' : '+m.total : ''}`;
  if (m.type === 'save') return `🛡 Jet de sauvegarde`;
  if (m.type === 'craft') return `🔨 ${m.recipeName || 'Craft'}`;
  return 'message';
}
export function _vttChatReply(msgId) {
  const m = _chatMsgs.find(x => x.id === msgId);
  if (!m) return;
  _chatReplyTo = { id: m.id, authorName: m.authorName || '?', text: _chatMsgExcerpt(m) };
  _renderChatReplyBar();
  document.getElementById('vtt-chat-input')?.focus();
}
export function _vttChatReplyCancel() {
  _chatReplyTo = null;
  _renderChatReplyBar();
}
export function _renderChatReplyBar() {
  const bar = document.getElementById('vtt-chat-reply-bar');
  if (!bar) return;
  if (!_chatReplyTo) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="vtt-chat-reply-bar-body">
      <span class="vtt-chat-reply-bar-who">↩ Réponse à ${_esc(_chatReplyTo.authorName)}</span>
      <span class="vtt-chat-reply-bar-text">${_esc((_chatReplyTo.text||'').slice(0,80))}</span>
    </div>
    <button class="vtt-chat-reply-bar-x" data-vtt-fn="_vttChatReplyCancel" title="Annuler">✕</button>`;
}
