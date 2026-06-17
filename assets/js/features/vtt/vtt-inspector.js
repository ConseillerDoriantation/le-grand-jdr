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
import { computeEquipSkillBonus } from '../../shared/char-stats.js';
import { hpColor, _STAT_COLOR, _STAT_KEY, _MS_BONUS_BUFF, _VTT_RUNE_META } from './vtt-constants.js';
import { DAMAGE_INTERACTIONS } from '../../shared/damage-profile.js';
import { runeBadges, spellTypeBadges } from '../../shared/spell-action-card.js';
import { _live } from './vtt-effective.js';
import { _vttPanelError } from './vtt-utils.js';
import {
  _canControlToken, _npcCombat, _tokenStatMod, _manualBuffVal, _showActBar, _signed,
  _aimOpt, CONDITION_BY_ID, _resolveUidName,
} from './vtt.js'; // circ. (runtime)

let _insTab = 'stats';          // onglet actif de l'inspecteur token
let _inspectorDirty = false;    // coalescing des rafales de snapshots → 1 render/tick

export function _renderInspectorSoon() {
  if (_inspectorDirty) return;
  _inspectorDirty = true;
  queueMicrotask(() => {
    _inspectorDirty = false;
    const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : null;
    _renderInspector(t);
    // HUD d'action : (ré)affiché pour le token sélectionné contrôlable, avec PM
    // et options à jour. On ne reconstruit PAS pendant une visée (_aimOpt), tant
    // qu'une modale est ouverte, ni si l'utilisateur tape dans la recherche.
    const modalOpen = document.getElementById('modal-overlay')?.classList.contains('show');
    if (t && _canControlToken(t) && !_aimOpt && !modalOpen
        && !document.activeElement?.classList?.contains('vtt-aopt-search-input')) {
      _showActBar(VS.selected);
    }
  });
}

// ── Frontière d'erreur par panneau VTT → vtt-utils.js (importé en haut) ───────

export function _renderInspector(t) {
  try { return _renderInspectorImpl(t); }
  catch (e) { _vttPanelError('Inspecteur', e, 'vtt-inspector'); }
}
export function _renderInspectorImpl(t) {
  const el=document.getElementById('vtt-inspector'); if (!el) return;
  // Multi-sélection active
  if (VS.selectedMulti.size>1) {
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
  if (!t) { el.innerHTML=`<div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>`; return; }
  const ld=_live(t);
  const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
  const rat=hpm>0?Math.max(0,hp/hpm):1;
  const icon={player:'🧑',enemy:'👹',npc:'👤'}[t.type]??'🎭';
  const lbl={player:'Joueur',enemy:'Ennemi',npc:'PNJ'}[t.type]??t.type;
  const img=ld.displayImage;
  const linked=t.characterId||t.npcId;

  const pageOpts=STATE.isAdmin
    ? Object.values(VS.pages).filter(p=>p.id!==t.pageId)
        .map(p=>`<option value="${p.id}">${p.name}</option>`).join('') : '';

  // ── Helpers rendu stats ──────────────────────────────────────────
  const _bar = (lbl, cur, max, col, editHtml='') => {
    const pct = max > 0 ? Math.round(Math.max(0, cur) / max * 100) : 0;
    const val = editHtml
      ? editHtml + '<span style="color:var(--text-muted)"> / '+max+'</span>'
      : '<span>'+cur+' / '+max+'</span>';
    return '<div class="vtt-ins-bar-row">' +
      '<span class="vtt-ins-bar-lbl">'+lbl+'</span>' +
      '<div class="vtt-ins-bar-track"><div class="vtt-ins-bar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>' +
      '<span class="vtt-ins-bar-val">'+val+'</span>' +
    '</div>';
  };
  const _stat = (icon, lbl, val, full=false) =>
    '<div class="vtt-ins-stat'+(full?' full':'')+'">'+
      '<span class="vtt-ins-stat-label">'+icon+' '+lbl+'</span>'+
      '<span class="vtt-ins-stat-val">'+val+'</span>'+
    '</div>';

  // Précalcul du bloc stats (évite l'imbrication de backticks dans le template)
  // vitalsHtml = barres PV/PM (épinglées sous le header) · coreStatsHtml = onglet Stats
  let vitalsHtml = '', coreStatsHtml = '';
  if (!STATE.isAdmin && t.type === 'enemy' && t.beastId) {
    const track    = VS.bstTracker[t.beastId] || {};
    const pvMax    = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
    const pvCur    = ld.displayHp !== null ? ld.displayHp : pvMax;
    const pvPct    = pvMax > 0 ? Math.round((pvCur??pvMax) / pvMax * 100) : 0;
    const pvBarCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';
    const caLabel  = track.caEstimee  !== undefined && track.caEstimee  !== '' ? String(track.caEstimee)  : '?';
    const vitLabel = track.vitEstimee !== undefined && track.vitEstimee !== '' ? String(track.vitEstimee)+' cases' : '?';
    const pos      = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    vitalsHtml =
      '<div class="vtt-ins-bars">' +
        (pvMax !== null
          ? _bar('PV', pvCur??pvMax, pvMax, pvBarCol)
          : '<div class="vtt-ins-bar-row"><span class="vtt-ins-bar-lbl">PV</span><span style="color:var(--text-muted);font-size:.75rem;grid-column:2/-1">inconnus</span></div>') +
      '</div>';
    coreStatsHtml =
      '<div class="vtt-ins-stats">' +
        _stat('🛡', 'CA est.', caLabel) +
        _stat('🏃', 'Vitesse', vitLabel) +
        _stat('📍', 'Position', pos, true) +
      '</div>' +
      '<div style="font-size:.62rem;color:var(--text-dim);font-style:italic">Valeurs issues de ton bestiaire personnel</div>';
  } else {
    const pos    = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    const pm     = ld.displayPm    ?? null;
    const pmMax  = ld.displayPmMax ?? null;
    const npcCombat = t.npcId ? _npcCombat(VS.npcs[t.npcId]) : {};
    const npcWeapon = npcCombat.weapon || {};
    const atkLabel = t.npcId
      ? (npcWeapon.nom || npcCombat.weaponName ? (npcWeapon.nom || npcCombat.weaponName) + ' · ' : '') + (ld.displayAttackDice || '1d6') + _signed(ld.displayAttack ?? 0)
      : (ld.displayAttackDice || (ld.displayAttack??5));
    const _canEditToken = _canControlToken(t);
    const _inCombat = !!VS.session?.combat?.active;
    const pvEditHtml = _canEditToken
      ? '<input class="vtt-ins-input" type="number" value="'+hp+'" min="0" max="'+hpm+'" data-vtt-fn="_vttSetHp" data-vtt-on="change" data-vtt-args="'+t.id+'|$value">'
      : null;
    const pmEditHtml = (_canEditToken && pm !== null && pmMax !== null)
      ? '<input class="vtt-ins-input" type="number" value="'+pm+'" min="0" max="'+pmMax+'" data-vtt-fn="_vttSetPm" data-vtt-on="change" data-vtt-args="'+t.id+'|$value">'
      : null;
    // Bonus manuels « du tour » via les BUFFS du token. ld.display* les inclut
    // DÉJÀ (move_bonus / ca / range_bonus) → ne pas re-additionner. Le badge
    // affiche juste la part manuelle. Éditable par qui contrôle le token.
    const _badge = (k) => { const b = _manualBuffVal(t, k); return b ? `<sup class="vtt-ins-bonus ${b>0?'pos':'neg'}">${b>0?'+':''}${b}</sup>` : ''; };
    const _steps = (k) => _canEditToken
      ? `<span class="vtt-ins-stat-steps">`+
          `<button class="vtt-ins-stat-step" data-vtt-fn="_vttTokenBonus" data-vtt-args="${t.id}|${k}|-1" title="−1">−</button>`+
          `<button class="vtt-ins-stat-step" data-vtt-fn="_vttTokenBonus" data-vtt-args="${t.id}|${k}|1" title="+1">+</button>`+
        `</span>` : '';
    const _anyBonus = ['vitesse','ca','portee'].some(k => _manualBuffVal(t, k) !== 0);

    vitalsHtml =
      '<div class="vtt-ins-bars">' +
        _bar('PV', hp, hpm, hpColor(rat), pvEditHtml) +
        (pm !== null && pmMax !== null ? _bar('PM', pm, pmMax, '#b47fff', pmEditHtml) : '') +
      '</div>';
    coreStatsHtml =
      '<div class="vtt-ins-stats">' +
        (() => {
          const baseMvt = ld.displayMovement ?? 6;   // inclut déjà le buff move_bonus manuel
          const maxMvt  = baseMvt + (t.bonusMvt||0);
          const rem     = _inCombat ? Math.max(0, maxMvt - (t.movedCells||0)) : null;
          const mvLabel = _inCombat ? `${rem} / ${maxMvt} cases` : `${baseMvt} cases`;
          const remColor = _inCombat ? (rem===0?'#f87171':rem<=2?'#f59e0b':'#4ade80') : 'inherit';
          return `<div class="vtt-ins-stat"><span class="vtt-ins-stat-icon">🏃</span>`+
            `<span class="vtt-ins-stat-lbl">Mouvement</span>`+
            `<span class="vtt-ins-stat-val" style="color:${remColor}">${mvLabel}${_badge('vitesse')}</span>${_steps('vitesse')}</div>`;
        })() +
        _stat('⚔️', 'Attaque', atkLabel) +
        `<div class="vtt-ins-stat"><span class="vtt-ins-stat-label">🛡 CA</span>`+
          `<span class="vtt-ins-stat-val">${ld.caBadge ?? (ld.displayDefense??0)}${ld.caBadge === '?' ? '' : _badge('ca')}</span>${_steps('ca')}</div>` +
        `<div class="vtt-ins-stat"><span class="vtt-ins-stat-label">🎯 Portée</span>`+
          `<span class="vtt-ins-stat-val">${ld.displayRange??1} case(s)${_badge('portee')}</span>${_steps('portee')}</div>` +
        _stat('📍', 'Position', pos, true) +
        ((_canEditToken && _anyBonus)
          ? `<div class="vtt-ins-stat full" style="justify-content:flex-end">`+
              `<button class="vtt-ins-bonus-reset" data-vtt-fn="_vttTokenResetBonus" data-vtt-args="${t.id}" title="Réinitialiser les bonus manuels">↺ Reset bonus</button>`+
            `</div>` : '') +
        (t.attackedThisTurn
          ? '<div class="vtt-ins-stat full" style="gap:.4rem;flex-wrap:wrap">'+
              '<span class="vtt-ins-badge vtt-ins-badge-atk">✓ A attaqué</span>'+
            '</div>'
          : '') +
      '</div>';
  }

  // ── Infos créature (bestiaire) ─────────────────────────────────────────
  // MJ : fiche complète (CA réelle, stats, attaques, traits, butins…)
  // Joueur : ses propres déductions sur les attaques et traits
  let _creatureHtml = '';
  if (t.type === 'enemy' && t.beastId) {
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
            return `<span class="vtt-creat-stat-pill"><b>${k.slice(0,3).toUpperCase()}</b> ${v} <span style="color:var(--text-dim)">(${ms})</span></span>`;
          }).filter(Boolean).join('');

        const _affHtml = ((arr, label, color) => {
          if (!Array.isArray(arr) || !arr.length) return '';
          return `<div class="vtt-creat-aff"><span class="vtt-creat-aff-lbl" style="color:${color}">${label}</span> ${arr.map(x => _esc(typeof x === 'object' ? (x.nom || x.type || '?') : x)).join(', ')}</div>`;
        });

        const realCaBuffed = (typeof calcCA === 'function' && ld.displayDefense !== undefined) ? ld.displayDefense : (beast.ca ?? 0);
        const rsLabel = { classique:'Classique', elite:'Élite', boss:'Boss' }[String(beast.rang||'').toLowerCase()] || 'Classique';

        _creatureHtml = `
          <div class="vtt-ins-section vtt-creat-mj">
            <div class="vtt-ins-section-title">📜 Fiche créature
              <span class="vtt-creat-rang vtt-creat-rang--${String(beast.rang||'classique').toLowerCase()}">${rsLabel}</span>
            </div>
            <div class="vtt-creat-vitals">
              <span class="vtt-creat-vital">🛡 CA <b>${beast.ca ?? '?'}</b>${realCaBuffed !== (beast.ca ?? 0) ? ` <span style="color:#a78bfa">(actuel ${realCaBuffed})</span>` : ''}</span>
              <span class="vtt-creat-vital">❤️ PV max <b>${beast.pvMax ?? '?'}</b></span>
              ${beast.pmMax ? `<span class="vtt-creat-vital">💧 PM max <b>${beast.pmMax}</b></span>` : ''}
              <span class="vtt-creat-vital">🏃 Vit. <b>${beast.vitesse ?? '?'}</b></span>
              ${beast.initiative ? `<span class="vtt-creat-vital">⚡ Init. <b>${beast.initiative}</b></span>` : ''}
              ${beast.niveau ? `<span class="vtt-creat-vital">📊 Nv. <b>${beast.niveau}</b></span>` : ''}
            </div>
            ${_stats6 ? `<div class="vtt-creat-stats6">${_stats6}</div>` : ''}
            ${_affHtml(beast.faiblesses,  'Faiblesses',   '#f87171')}
            ${_affHtml(beast.resistances, 'Résistances',  '#fbbf24')}
            ${_affHtml(beast.immunites,   'Immunités',    '#94a3b8')}
            ${_affHtml(beast.absorptions, 'Absorptions',  '#a78bfa')}
            ${beast.description ? `<div class="vtt-creat-desc">${_esc(beast.description)}</div>` : ''}
            ${_armesN.length ? `
              <div class="vtt-creat-sub-title">🦷 Armes naturelles (${_armesN.length})</div>
              ${_armesN.map(w => {
                const statShort = { force:'For', dexterite:'Dex', intelligence:'Int', sagesse:'Sag', constitution:'Con', charisme:'Cha', none:'—' };
                const dStat = statShort[w.degatsStat]  || '';
                const tStat = statShort[w.toucherStat] || '';
                const flatD = parseInt(w.degatsFlat)  || 0;
                const flatT = parseInt(w.toucherFlat) || 0;
                return `<div class="vtt-creat-atk">
                  <div class="vtt-creat-atk-name">${_esc(w.nom || 'Arme')}</div>
                  <div class="vtt-creat-atk-stats">
                    ${w.degats ? `<span class="vtt-creat-atk-stat dmg">⚔️ ${_esc(w.degats)}${dStat?` <span style="opacity:.7">(${dStat}${flatD?` ${flatD>0?'+':''}${flatD}`:''})</span>`:''}</span>` : ''}
                    ${tStat || flatT ? `<span class="vtt-creat-atk-stat touch">🎯 ${tStat}${flatT?` ${flatT>0?'+':''}${flatT}`:''}</span>` : ''}
                    ${w.portee  ? `<span class="vtt-creat-atk-stat range">📏 ${_esc(w.portee)}</span>` : ''}
                  </div>
                </div>`;
              }).join('')}` : ''}
            ${_actions.length ? `
              <div class="vtt-creat-sub-title">⚔️ Actions (${_actions.length})</div>
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
              }).join('')}` : ''}
            ${(_atk.length && !_armesN.length && !_actions.length) ? `
              <div class="vtt-creat-sub-title">🗡 Attaques (${_atk.length})</div>
              ${_atk.map(a => `
                <div class="vtt-creat-atk">
                  <div class="vtt-creat-atk-name">${_esc(a.nom || 'Attaque')}</div>
                  <div class="vtt-creat-atk-stats">
                    ${a.toucher ? `<span class="vtt-creat-atk-stat touch">🎯 ${_esc(a.toucher)}</span>` : ''}
                    ${a.degats  ? `<span class="vtt-creat-atk-stat dmg">⚔️ ${_esc(a.degats)}</span>`   : ''}
                    ${a.portee  ? `<span class="vtt-creat-atk-stat range">📏 ${_esc(a.portee)}</span>` : ''}
                  </div>
                  ${a.description ? `<div class="vtt-creat-atk-desc">${_esc(a.description)}</div>` : ''}
                </div>`).join('')}` : ''}
            ${_trt.length ? `
              <div class="vtt-creat-sub-title">✨ Traits (${_trt.length})</div>
              ${_trt.map(tr => `
                <div class="vtt-creat-trait">
                  <div class="vtt-creat-trait-name">${_esc(tr.nom || '')}</div>
                  ${tr.description ? `<div class="vtt-creat-trait-desc">${_esc(tr.description)}</div>` : ''}
                </div>`).join('')}` : ''}
            ${_btn.length ? `
              <div class="vtt-creat-sub-title">💰 Butins (${_btn.length})</div>
              <div class="vtt-creat-loots">
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
                      ? `<span class="vtt-creat-loot-add" style="opacity:.4;cursor:not-allowed" title="Objet supprimé de la boutique">＋</span>`
                      : `<button class="vtt-creat-loot-add" data-vtt-fn="_vttCreatSendLootToStash" data-vtt-args="${t.beastId}|${i}|$this" title="Envoyer à la réserve MJ">＋</button>`}
                  </div>`;
                }).join('')}
              </div>` : ''}
          </div>`;
      } else {
        // ── Vue joueur : seulement ses propres déductions ──────────────
        const track = VS.bstTracker[t.beastId] || {};
        const ded   = track.deductions || {};
        const _bid  = t.beastId;
        const _hasNotes = (track.notes || '').trim().length > 0;
        // Détermine si au moins une déduction d'attaque ou de trait est renseignée
        const _hasAnyDed = Object.values(ded).some(v => v && String(v).trim());

        _creatureHtml = `
          <div class="vtt-ins-section vtt-creat-pl">
            <div class="vtt-ins-section-title">📝 Mes observations</div>
            <div class="vtt-creat-help">Renseigne ici ce que tu as découvert sur cette créature. Sauvegardé automatiquement (visible aussi dans le Bestiaire).</div>
            ${_actions.length ? `
              <div class="vtt-creat-sub-title">⚔️ Actions observées (${_actions.length})</div>
              ${_actions.map((act, i) => {
                const k = act.id || `idx_${i}`;
                return `<div class="vtt-creat-atk-edit">
                  <input class="vtt-creat-input" placeholder="Nom de l'action…"
                    value="${_esc(ded['act_nom_'+k] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_nom_${k}|$value">
                  <div class="vtt-creat-atk-row3">
                    <input class="vtt-creat-input" placeholder="🎯 Toucher"
                      value="${_esc(ded['act_toucher_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_toucher_${k}|$value">
                    <input class="vtt-creat-input" placeholder="⚔️ Dégâts"
                      value="${_esc(ded['act_degats_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_degats_${k}|$value">
                    <input class="vtt-creat-input" placeholder="📏 Portée"
                      value="${_esc(ded['act_portee_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_portee_${k}|$value">
                  </div>
                </div>`;
              }).join('')}` : ''}
            ${_trt.length ? `
              <div class="vtt-creat-sub-title">✨ Traits observés (${_trt.length})</div>
              ${_trt.map((_, i) => `
                <div class="vtt-creat-trait-edit">
                  <input class="vtt-creat-input" placeholder="Nom du trait…"
                    value="${_esc(ded['tr_nom_'+i] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|tr_nom_${i}|$value">
                  <input class="vtt-creat-input" placeholder="Description…"
                    value="${_esc(ded['tr_desc_'+i] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|tr_desc_${i}|$value">
                </div>`).join('')}` : ''}
            <div class="vtt-creat-sub-title">📔 Notes</div>
            <textarea class="vtt-creat-input vtt-creat-notes" rows="3" placeholder="Tes notes sur cette créature…"
              data-vtt-fn="_vttBstNotes" data-vtt-on="change" data-vtt-args="${_bid}|$value">${_esc(track.notes || '')}</textarea>
            ${!_actions.length && !_trt.length && !_hasNotes && !_hasAnyDed
              ? '<div class="vtt-creat-help" style="margin-top:.4rem">Aucune action/trait recensé par le MJ pour cette créature pour le moment.</div>'
              : ''}
          </div>`;
      }
    }
  }

  // ── Effets actifs (buffs, debuffs, DoT, enchantements, afflictions…) ──
  const _r = VS.session?.combat?.round ?? 0;
  const _activeBuffs = (t.buffs || []).filter(bf =>
    bf?.expiresAtRound == null || _r === 0 || _r <= bf.expiresAtRound);
  const _buffsHtml = _activeBuffs.length ? (() => {
    const _BUFF_LABEL = {
      ca: 'Bonus CA', dot: 'Dégâts/tour', regen: 'Régénération',
      dmg_bonus: 'Dégâts bonus',
      move_bonus: 'Mouvement +', move_debuff: 'Mouvement −',
      range_bonus: 'Portée +', shield_reactive: 'Bouclier réactif',
      enchantment: 'Enchantement', affliction: 'Affliction',
    };
    const items = _activeBuffs.map((bf, i) => {
      const ic = bf.icon || '✨';
      const lbl = bf.sortLabel || _BUFF_LABEL[bf.type] || bf.type || 'Effet';
      // Calcul durée restante
      let durStr;
      if (bf.canalisePersistant) durStr = '∞ canalisé';
      else if (bf.expiresAtRound != null && _r > 0) durStr = `${bf.expiresAtRound - _r + 1}t`;
      else if (bf.totalDuration != null) durStr = `${bf.totalDuration}t`;
      else durStr = '∞';
      // Détail (bonus, formule, slot, charges)
      const detail = bf.type === 'dmg_bonus' ? `+${bf.formula}`
                   : bf.type === 'move_bonus' || bf.type === 'move_debuff' ? `${bf.bonus > 0 ? '+' : ''}${bf.bonus} c`
                   : bf.type === 'range_bonus' ? `+${bf.bonus} c`
                   : bf.type === 'ca' ? `${bf.bonus >= 0 ? '+' : ''}${bf.bonus} CA`
                   : bf.type === 'dot' || bf.type === 'regen' ? `${bf.formula} / tour`
                   : bf.type === 'shield_reactive' ? `${bf.charges || 1} charge · ${bf.tier}`
                   : bf.effect ? bf.effect.slice(0, 24) : '';
      const rmBtn = STATE.isAdmin
        ? `<button class="vtt-buff-rm" data-vtt-fn="_vttRemoveBuff" data-vtt-args="${t.id}|${i}" title="Retirer">✕</button>` : '';
      // Sort suspendu : pas de bouton — la version GRATUITE du sort est dispo
      // directement dans la liste d'actions (le buff 🔮 sert d'indicateur + minuteur).
      const suspHint = bf.type === 'suspended_spell'
        ? ' · 🎁 version gratuite dispo dans tes sorts' : '';
      return `<div class="vtt-buff-item" title="${_esc(lbl)}${detail?' · '+_esc(detail):''}${suspHint}">
        <span class="vtt-buff-ic">${ic}</span>
        <span class="vtt-buff-lbl">${_esc(lbl)}</span>
        ${detail ? `<span class="vtt-buff-detail">${_esc(detail)}</span>` : ''}
        <span class="vtt-buff-dur">${durStr}</span>
        ${rmBtn}
      </div>`;
    }).join('');
    const addBtn = STATE.isAdmin
      ? `<button class="vtt-btn-sm" data-vtt-fn="_vttAddBuffPrompt" data-vtt-args="${t.id}" title="Ajouter un effet manuel">＋</button>` : '';
    return `<div class="vtt-ins-section">
      <div class="vtt-ins-section-title">✨ Effets actifs ${addBtn}</div>
      <div class="vtt-buff-list">${items}</div>
    </div>`;
  })() : (STATE.isAdmin
    ? `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">✨ Effets actifs <button class="vtt-btn-sm" data-vtt-fn="_vttAddBuffPrompt" data-vtt-args="${t.id}">＋</button></div>
        <div style="font-size:.72rem;color:var(--text-dim);font-style:italic">Aucun effet actif</div>
      </div>` : '');

  // ── Conditions / États du token (visibles par tous, gérables par le MJ) ──
  const _conds = Array.isArray(t.conditions) ? t.conditions : [];
  const _condIsActive = c => c.expiresAtRound == null || _r === 0 || _r <= c.expiresAtRound;
  const _activeConds = _conds.filter(_condIsActive);
  const _condsHtml = (() => {
    const addBtn = STATE.isAdmin
      ? `<span class="vtt-ins-section-actions">
          <button class="vtt-btn-sm" data-vtt-fn="_vttConditionAdd" data-vtt-args="${t.id}" title="Appliquer un état">＋</button>
          <button class="vtt-btn-sm" data-vtt-fn="_vttConditionConfig" title="Réglages : ce que chaque état fait, sa stat de JS et son DD par défaut">⚙</button>
        </span>` : '';
    if (!_activeConds.length && !STATE.isAdmin) return ''; // joueurs : section cachée si vide
    const rows = _activeConds.map((cond, i) => {
      const lib = CONDITION_BY_ID[cond.id] || { label: cond.id, icon: '❓', color: '#888', desc: '' };
      const dur = cond.expiresAtRound != null && _r > 0
        ? `${cond.expiresAtRound - _r + 1}t`
        : (cond.expiresAtRound != null ? 'fin' : '∞');
      const srcLine = cond.source ? `<div class="vtt-cond-src">📝 ${_esc(cond.source)}</div>` : '';
      const saveLbl = cond.saveDC && cond.saveStat
        ? `${statShort(cond.saveStat) || cond.saveStat} DD ${cond.saveDC}` : null;
      const realIdx = _conds.indexOf(cond);
      const ctrls = STATE.isAdmin ? `
        <div class="vtt-cond-ctrls">
          ${saveLbl ? `<button class="vtt-cond-save" data-vtt-fn="_vttConditionSave" data-vtt-args="${t.id}|${realIdx}" title="Lancer le jet de sauvegarde">🎲 JS ${saveLbl}</button>` : ''}
          <button class="vtt-cond-edit" data-vtt-fn="_vttConditionEdit" data-vtt-args="${t.id}|${realIdx}" title="Modifier durée, DD, source">✏️</button>
          <button class="vtt-cond-rm" data-vtt-fn="_vttConditionRemove" data-vtt-args="${t.id}|${realIdx}" title="Retirer l'état">✕</button>
        </div>` : '';
      return `<div class="vtt-cond-item" style="--cond-c:${lib.color}">
        <div class="vtt-cond-hd">
          <span class="vtt-cond-ic">${lib.icon}</span>
          <span class="vtt-cond-nom">${lib.label}</span>
          <span class="vtt-cond-dur">${dur}</span>
        </div>
        <div class="vtt-cond-desc">${lib.desc}</div>
        ${srcLine}
        ${ctrls}
      </div>`;
    }).join('');
    return `<div class="vtt-ins-section">
      <div class="vtt-ins-section-title">⚡ États ${addBtn}</div>
      <div class="vtt-cond-list">${rows || '<div style="font-size:.72rem;color:var(--text-dim);font-style:italic">Aucun état actif</div>'}</div>
    </div>`;
  })();

  // ── Fragments par onglet (calculés puis répartis) ──────────────────────
  const _combatActionsHtml = (() => {
    const inCombat = !!VS.session?.combat?.active;
    const canEdit  = _canControlToken(t);
    if (!inCombat || !canEdit || (t.type !== 'player' && t.type !== 'npc')) return '';
    const ld2  = _live(t);
    const base = ld2.displayMovement ?? 6;
    const couru = (t.bonusMvt||0) > 0;
    return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">⚔️ Actions de combat</div>
        <div class="vtt-combat-actions">
          <button class="vtt-combat-action-btn${couru?' used':''}"
            data-vtt-fn="_vttCourir" data-vtt-args="${t.id}"
            ${couru?'disabled':''}>
            <span class="vtt-ca-icon">🏃</span>
            <span class="vtt-ca-body">
              <span class="vtt-ca-name">Courir</span>
              <span class="vtt-ca-desc">${couru?'Déjà utilisé':'Ajoute +'+base+' cases de mouvement'}</span>
            </span>
          </button>
        </div>
      </div>`;
  })();

  const _skillsHtml = ((t.type==='player'||t.type==='npc') && VS.diceSkills.length && _canControlToken(t)) ? (() => {
    const cForBonus = t?.characterId ? VS.characters[t.characterId] : null;
    const btns = VS.diceSkills.map(s => {
      const statKey = _STAT_KEY[s.stat] || '';
      const statMod = _tokenStatMod(t, statKey);
      const eqBonus = cForBonus ? computeEquipSkillBonus(cForBonus.equipement || {}, s.name) : 0;
      const mod = statMod + eqBonus;
      const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '±0';
      const col  = _STAT_COLOR[s.stat] || 'var(--text-dim)';
      const eqTitle = eqBonus !== 0 ? ` title="Inclut ${eqBonus>0?'+':''}${eqBonus} équip."` : '';
      return `<button class="vtt-skill-btn" data-vtt-fn="_vttRollSkill" data-vtt-args="${_esc(s.name)}|${s.stat}"${eqTitle}>
          <span class="vtt-sk-name">${s.name}${eqBonus!==0?' <span style="color:#22c38e;font-size:.7em">●</span>':''}</span>
          <span class="vtt-sk-mod" style="color:${col}">${s.stat ? s.stat+' '+modStr : '—'}</span>
        </button>`;
    }).join('');
    return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🎲 Jets de compétences</div>
        <div class="vtt-roll-mode-row">
          <button class="vtt-roll-mode-btn${VS.rollMode==='disadvantage'?' active':''}" data-mode="disadvantage" data-vtt-fn="_vttSetRollMode" data-vtt-args="disadvantage" title="Désavantage — prend le plus bas des 2 dés">⬇ Désav.</button>
          <button class="vtt-roll-mode-btn${VS.rollMode==='normal'?' active':''}" data-mode="normal" data-vtt-fn="_vttSetRollMode" data-vtt-args="normal" title="Jet classique — 1d20">⚪ Normal</button>
          <button class="vtt-roll-mode-btn${VS.rollMode==='advantage'?' active':''}" data-mode="advantage" data-vtt-fn="_vttSetRollMode" data-vtt-args="advantage" title="Avantage — prend le plus haut des 2 dés">⬆ Avantage</button>
        </div>
        <div class="vtt-roll-bonus-row">
          <span class="vtt-roll-bonus-lbl">Bonus contextuel</span>
          <button class="vtt-roll-bonus-adj" data-vtt-fn="_vttAdjBonus" data-vtt-args="-1">−</button>
          <span class="vtt-roll-bonus-val${VS.rollBonus!==0?' nonzero':''}" id="vtt-bonus-val">${VS.rollBonus>0?'+'+VS.rollBonus:VS.rollBonus}</span>
          <button class="vtt-roll-bonus-adj" data-vtt-fn="_vttAdjBonus" data-vtt-args="1">+</button>
          <button class="vtt-roll-bonus-reset" data-vtt-fn="_vttAdjBonus" data-vtt-args="0|true" title="Réinitialiser">↺</button>
        </div>
        ${STATE.isAdmin ? `
        <div class="vtt-roll-bonus-row">
          <span class="vtt-roll-bonus-lbl">Visibilité</span>
          <button class="vtt-roll-mode-btn vtt-roll-hide-btn${VS.rollHidden?' active':''}" id="vtt-roll-hide-btn"
            data-vtt-fn="_vttToggleRollHidden"
            title="Jet caché : seul le MJ voit le résultat dans le log">
            ${VS.rollHidden ? '🕶 Jet caché MJ' : '👁 Visible joueurs'}
          </button>
        </div>` : ''}
        <div class="vtt-ins-skills">${btns}</div>
      </div>`;
  })() : '';

  const _delegateHtml = (() => {
    // Délégation de contrôle — visible pour propriétaire OU MJ
    const uid = STATE.user?.uid;
    const isOwner = uid && t.ownerId === uid;
    if (!isOwner && !STATE.isAdmin) return '';
    const dels = Array.isArray(t.controlDelegates) ? t.controlDelegates : [];
    const lookupName = _resolveUidName;
    const chips = dels.length
      ? dels.map(u => `<span class="vtt-delegate-chip">
            <span>${_esc(lookupName(u))}</span>
            <button class="vtt-delegate-x" data-vtt-fn="_vttRemoveTokenDelegate"
              data-vtt-args="${t.id}|${u}" title="Retirer">×</button>
          </span>`).join('')
      : '<span class="vtt-delegate-empty">Personne — vous seul contrôlez ce token.</span>';
    return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🤝 Contrôle délégué</div>
        <div class="vtt-delegate-list">${chips}</div>
        <button class="vtt-btn-sm vtt-delegate-add"
          data-vtt-fn="_vttOpenTokenDelegatesModal" data-vtt-args="${t.id}"
          title="Autoriser un autre joueur à contrôler ce token">＋ Ajouter un joueur</button>
      </div>`;
  })();

  const _sendPageHtml = (STATE.isAdmin && pageOpts) ? `
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">📡 Envoyer le joueur vers</div>
        <select class="vtt-ins-select" data-vtt-fn="_vttMoveTokenAndReset" data-vtt-on="change" data-vtt-args="$this|${t.id}">
          <option value="">— choisir une page —</option>${pageOpts}
        </select>
      </div>` : '';

  const _footerHtml = STATE.isAdmin ? `
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🛠 Outils MJ</div>
        <div class="vtt-ins-actions">
          <button class="vtt-btn-sm" data-vtt-fn="_vttEditToken" data-vtt-args="${t.id}" title="Modifier les stats combat">⚙️ Stats</button>
          <button class="vtt-btn-sm" data-vtt-fn="_vttToggleVisible" data-vtt-args="${t.id}" title="Visibilité joueurs">${t.visible?'👁 Visible':'🙈 Caché'}</button>
          ${VS.session?.combat?.active?`<button class="vtt-btn-sm" data-vtt-fn="_vttResetTurn" data-vtt-args="${t.id}" title="Réinitialiser le tour de ce token">↺ Tour</button>`:''}
          ${t.pageId?`<button class="vtt-btn-sm" data-vtt-fn="_vttRetireToken" data-vtt-args="${t.id}" title="Retirer de la carte">↩ Retirer</button>`:''}
          ${(t.buffs||[]).length?`<button class="vtt-btn-sm vtt-btn-danger" data-vtt-fn="_vttClearBuffs" data-vtt-args="${t.id}" title="Supprimer tous les buffs actifs">🗑 Buffs</button>`:''}
        </div>
      </div>` : '';

  // ── Répartition en onglets ─────────────────────────────────────────────
  // Actions d'une créature invoquée (token summonKind='invocation')
  const _summonActionsHtml = (Array.isArray(t.summonActions) && t.summonActions.length)
    ? `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🎬 Actions de la créature</div>
        ${t.summonActions.map(a => {
          const det = [a.degats && `🎲 ${_esc(a.degats)}`, a.portee && `📏 ${_esc(a.portee)}`, a.pm ? `${a.pm} PM` : ''].filter(Boolean).join(' · ');
          return `<div class="vtt-creat-act">
            <div class="vtt-creat-act-name">🎬 ${_esc(a.nom || 'Action')}</div>
            ${det ? `<div style="font-size:.7rem;color:var(--text-muted);margin-top:.12rem">${det}</div>` : ''}
            ${a.effet ? `<div class="vtt-creat-atk-desc">${_esc(a.effet)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`
    : '';

  const _tabs = [
    { k:'stats',    ic:'📊', lb:'Stats',     html: coreStatsHtml },
    { k:'combat',   ic:'🎲', lb:'Jets',      html: _combatActionsHtml + _skillsHtml },
    { k:'invoc',    ic:'🐾', lb:'Actions',   html: _summonActionsHtml },
    { k:'effets',   ic:'✨', lb:'Effets',    html: _condsHtml + _buffsHtml },
    { k:'creature', ic:'📜', lb:'Bestiaire', html: _creatureHtml },
    { k:'gerer',    ic:'⚙️', lb:'Gérer',     html: _delegateHtml + _sendPageHtml + _footerHtml },
  ].filter(s => s.html && s.html.trim());

  const _active = _tabs.some(s => s.k === _insTab) ? _insTab : (_tabs[0]?.k || 'stats');
  const _tabBar = _tabs.length > 1
    ? `<div class="vtt-ins-tabbar">${_tabs.map(s =>
        `<button class="vtt-ins-tab${s.k===_active?' active':''}" data-vtt-fn="_vttInsTab" data-vtt-args="${s.k}" title="${s.lb}">
          <span class="vtt-ins-tab-ic">${s.ic}</span><span class="vtt-ins-tab-lbl">${s.lb}</span>
        </button>`).join('')}</div>`
    : '';
  const _tabBody = _tabs.find(s => s.k === _active)?.html || '';

  el.innerHTML=`
    <div class="vtt-ins-header">
      ${img?`<img src="${img}" class="vtt-ins-avatar" alt="">`
           :`<div class="vtt-ins-avatar-icon" style="background:${TYPE_COLOR[t.type]??'#888'}">${icon}</div>`}
      <div style="min-width:0">
        <div class="vtt-ins-name">${ld.displayName??t.name}</div>
        <div class="vtt-ins-type">${icon} ${lbl}${linked?' · 🔗':''}</div>
      </div>
    </div>
    ${vitalsHtml}
    ${_tabBar}
    <div class="vtt-ins-tabbody">${_tabBody}</div>`;
}

export function _vttInsTab(tab) {
  _insTab = tab;
  const t = VS.selected ? (VS.tokens[VS.selected]?.data ?? null) : null;
  if (t) _renderInspector(t);
}
