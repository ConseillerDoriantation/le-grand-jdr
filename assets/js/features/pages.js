// ══════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { registerActions, dispatchAction } from '../core/actions.js';
import { loadChars, loadCollection, getCachedCollection, getDocData } from '../data/firestore.js';
import { _esc, appSplashHtml, pageHeaderHtml, loadingHtml} from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { isFeatureEnabled } from '../shared/features.js';
import { calcPalier, calcPVMax, calcPMMax, calcCA, calcOr, getDefaultCharForUser, sortCharactersForDisplay } from '../shared/char-stats.js';
import { loadStats, resetStats, deleteCharStats } from '../shared/stats.js';
import { showNotif } from '../shared/notifications.js';
import { confirmModal, openModal } from '../shared/modal.js';
import { watch, watchDoc } from '../shared/realtime.js';
import { setDashboardPartyChars, setDashboardQuests } from '../shared/dashboard-session.js';
import { setTargetCharacter, consumeTargetCharacter } from '../shared/character-navigation.js';
import { characterAvatarHtml, characterPortraitContent } from '../shared/portraits.js';
import { dedupeQuestParticipants } from '../shared/participants.js';

import { charSession } from '../shared/char-session.js';
import { openAdventureSwitcher } from '../core/layout.js';
import { loadAllUsers } from '../core/adventure.js';
const renderCharSheet   = (...args) => charSession.renderSheet(...args);

// Masque les blocs du dashboard liés à une fonctionnalité désactivée pour l'aventure
// courante, puis les sections/labels devenus orphelins (plus aucun contenu visible).
// Appelé après le rendu (vue joueur ET MJ partagent #dash-root).
function _hideDisabledDashboardBlocks(root) {
  if (!root) return;
  // 1. Cartes/CTA/boutons ciblant une feature off (la plupart ont data-navigate racine).
  root.querySelectorAll('[data-navigate]').forEach(el => {
    if (!isFeatureEnabled(el.getAttribute('data-navigate'))) el.style.display = 'none';
  });
  // 2. Wrappers connus sans titre (action/héros) devenus vides → masqués.
  const _visibleContent = (el, skipLabel = false) => [...el.children].some(c =>
    (!skipLabel || !c.classList.contains('dv2-section-label')) &&
    c.style.display !== 'none' &&
    (c.children.length > 0 || c.textContent.trim() !== ''));
  root.querySelectorAll('.dv2-player-action, .dv2-player-hero').forEach(w => {
    if (w.children.length && !_visibleContent(w)) w.style.display = 'none';
  });
  // 3. Sections à titre (dv2-section-label) sans plus aucun contenu visible → masquées.
  root.querySelectorAll('.dv2-section-label').forEach(label => {
    const section = label.parentElement;
    if (section && !_visibleContent(section, true)) section.style.display = 'none';
  });
}

// ── Statistiques : état léger pour la vue « par séance » (évite une relecture) ──
let _statsData = null;                 // dernier doc stats chargé (pour la modale par date)
let _statsEmoteUrl = new Map();        // name → url (affichage de l'émote réelle)
let _statsScope = null;                // null = toute la campagne ; sinon clé date YYYY-MM-DD
let _statsLastSummary = '';            // récap texte du scope courant (export Discord)

const _statsNum = (v) => Number(v) || 0;
function _statsEmoteHtml(name, cls = 'stats-emote') {
  if (!name) return '—';
  const url = _statsEmoteUrl.get(name);
  return url ? `<img class="${cls}" src="${url}" alt="${_esc(name)}" title="${_esc(name)}">` : _esc(name);
}
function _statsNormCombat(cm = {}) {
  const n = _statsNum;
  return {
    attacks: n(cm.attacks), hits: n(cm.hits), crits: n(cm.crits), fumbles: n(cm.fumbles),
    dmgDealt: n(cm.dmgDealt), dmgTaken: n(cm.dmgTaken), kosDealt: n(cm.kosDealt), kosTaken: n(cm.kosTaken),
    spellsCast: n(cm.spellsCast), pmSpent: n(cm.pmSpent), heal: n(cm.heal),
    biggestHit: n(cm.biggestHit), biggestTaken: n(cm.biggestTaken),
  };
}
function _statsTop(map = {}) {
  const e = Object.entries(map).map(([n, v]) => ({ n, c: _statsNum(v) })).sort((a, b) => b.c - a.c)[0];
  return e && e.c > 0 ? e : null;
}
// Bandeau de chips combat (réutilisé par carte perso ET vue par séance).
function _statsCombatGrid(cm, { topSpell, topEmote } = {}) {
  const hr = cm.attacks ? Math.round((cm.hits / cm.attacks) * 100) : 0;
  // Grille label → valeur : lisible, jamais de débordement (valeur alignée à droite).
  const rows = [];
  const row = (ic, lbl, val) => rows.push(
    `<div class="stats-crow"><span class="stats-clbl">${ic} ${lbl}</span><span class="stats-cval">${val}</span></div>`);
  if (cm.attacks > 0)      { row('⚔️', 'Attaques', cm.attacks); row('🎯', 'Taux de réussite', `${hr}%`); }
  if (cm.crits > 0)        row('💥', 'Réussites critiques', cm.crits);
  if (cm.fumbles > 0)      row('💔', 'Échecs critiques', cm.fumbles);
  if (cm.dmgDealt > 0)     row('🗡️', 'Dégâts infligés', cm.dmgDealt);
  if (cm.biggestHit > 0)   row('💢', 'Plus gros coup infligé', cm.biggestHit);
  if (cm.dmgTaken > 0)     row('🛡️', 'Dégâts subis', cm.dmgTaken);
  if (cm.biggestTaken > 0) row('🩸', 'Plus gros coup reçu', cm.biggestTaken);
  if (cm.kosDealt > 0)     row('☠️', 'KO infligés', cm.kosDealt);
  if (cm.kosTaken > 0)     row('💀', 'Fois mis KO', cm.kosTaken);
  if (cm.spellsCast > 0)   row('🔮', 'Sorts lancés', cm.spellsCast);
  if (cm.pmSpent > 0)      row('🔋', 'PM dépensés', cm.pmSpent);
  if (cm.heal > 0)         row('💚', 'PV soignés', cm.heal);
  const favs = [];
  if (topSpell) favs.push(`<div class="stats-cfav"><span class="stats-clbl">⭐ Sort fétiche</span><span class="stats-cfav-v">${_esc(topSpell.n)} <small>×${topSpell.c}</small></span></div>`);
  if (topEmote) favs.push(`<div class="stats-cfav"><span class="stats-clbl">😄 Émote fétiche</span><span class="stats-cfav-v">${_statsEmoteHtml(topEmote.n, 'stats-emote')} <small>×${topEmote.c}</small></span></div>`);
  return (rows.length ? `<div class="stats-cgrid">${rows.join('')}</div>` : '')
       + (favs.length ? `<div class="stats-cfavs">${favs.join('')}</div>` : '');
}

const _statsFmtDate = (d) => { const [y, m, da] = d.split('-'); return `${da}/${m}/${y}`; };

// Jauge circulaire (donut) — pct 0-100 + couleur d'accent. Optionnellement un
// sous-label. Utilisée pour le taux de réussite (héro + carte perso).
function _statsGauge(pct, color = '#22c38e', size = 92, stroke = 9, sub = '') {
  const r = size / 2 - stroke, cx = size / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, _statsNum(pct))) / 100);
  const big = Math.round(size * 0.24);
  return `<svg class="stats-gauge" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})"/>
    <text x="${cx}" y="${sub ? cx - big * 0.28 : cx}" text-anchor="middle" dominant-baseline="central"
      class="stats-gauge-val" style="font-size:${big}px">${_statsNum(pct)}%</text>
    ${sub ? `<text x="${cx}" y="${cx + big * 0.62}" text-anchor="middle" dominant-baseline="central" class="stats-gauge-sub" style="font-size:${Math.round(size * 0.1)}px">${sub}</text>` : ''}
  </svg>`;
}

// Construit les lignes/cartes de stats pour un scope donné (dateKey null = campagne).
function _statsRowsFor(dateKey) {
  const num = _statsNum;
  return Object.entries(_statsData?.chars || {}).map(([id, c]) => {
    const src = dateKey ? (c.byDate?.[dateKey] || {}) : c;   // même forme : combat/skills/spells/emotes
    const skills = src.skills || {};
    let sRolls = 0, sCrits = 0, sFumbles = 0;
    const perSkill = Object.entries(skills).map(([sk, v]) => {
      sRolls += num(v.rolls); sCrits += num(v.crits); sFumbles += num(v.fumbles);
      return { sk, rolls: num(v.rolls), crits: num(v.crits), fumbles: num(v.fumbles) };
    }).sort((a, b) => b.rolls - a.rolls);
    const combat = _statsNormCombat(src.combat);
    const spells = Object.entries(src.spells || {}).map(([n, v]) => ({ n, c: num(v) })).sort((a, b) => b.c - a.c);
    const emotes = Object.entries(src.emotes || {}).map(([n, v]) => ({ n, c: num(v) })).sort((a, b) => b.c - a.c);
    const emoteTotal = emotes.reduce((s, e) => s + e.c, 0);
    const hasDates = !!c.byDate && Object.keys(c.byDate).length > 0;
    return { id, name: c.name || '?', sRolls, sCrits, sFumbles, perSkill, combat, spells, emotes, emoteTotal, hasDates };
  }).filter(r => r.sRolls > 0 || r.combat.attacks > 0 || r.combat.dmgTaken > 0 || r.combat.spellsCast > 0 || r.emotes.length);
}

// Mini-podium top 3 (sorts / compétences / émotes). render(label) → html (défaut _esc).
function _statsPodium(title, entries, render) {
  const medals = ['🥇', '🥈', '🥉'];
  const rdr = render || ((l) => _esc(l));
  const body = entries.length
    ? entries.slice(0, 3).map((e, i) => `<div class="stats-pod-row"><span class="stats-pod-rank">${medals[i]}</span><span class="stats-pod-name">${rdr(e[0])}</span><span class="stats-pod-n">×${e[1]}</span></div>`).join('')
    : '<div class="stats-pod-empty">—</div>';
  return `<div class="stats-pod"><div class="stats-pod-title">${title}</div>${body}</div>`;
}

// Rendu complet de la page pour un scope (réutilisé au changement de séance).
function _statsRender(dateKey) {
  _statsScope = dateKey || null;
  const root = document.getElementById('stats-root');
  if (!root) return;
  const rows = _statsRowsFor(dateKey);

  // Sélecteur de séance (toujours visible si des dates existent).
  const allDates = [...new Set(Object.values(_statsData?.chars || {}).flatMap(c => Object.keys(c.byDate || {})))].sort().reverse();
  const scopeSel = allDates.length ? `
    <label class="stats-scope">Vue
      <select data-change="_statsScope">
        <option value=""${!dateKey ? ' selected' : ''}>Toute la campagne</option>
        ${allDates.map(d => `<option value="${d}"${d === dateKey ? ' selected' : ''}>📅 ${_statsFmtDate(d)}</option>`).join('')}
      </select>
    </label>` : '<span class="stats-scope-label">Toute la campagne</span>';
  const exportBtn = rows.length ? `<button class="stats-tool-btn" data-action="_statsExport" title="Copier un récap texte (Discord…)">📋 Copier le récap</button>` : '';
  const resetBtn = STATE.isAdmin ? `<button class="stats-tool-btn stats-reset-btn" data-action="_statsReset" title="Remettre toutes les statistiques à zéro">↺ Réinitialiser</button>` : '';
  const toolbar = `<div class="stats-toolbar">${scopeSel}<div class="stats-toolbar-actions">${exportBtn}${resetBtn}</div></div>`;

  if (!rows.length) {
    _statsLastSummary = '';
    root.innerHTML = `${toolbar}<div class="stats-empty">Aucune statistique pour ${dateKey ? `la séance du ${_statsFmtDate(dateKey)}` : 'le moment'}.<br>
      <span>Les jets de compétence et le combat alimenteront cette page au fil des séances.</span></div>`;
    return;
  }

  // Agrégats du scope
  const GC = rows.reduce((g, r) => { for (const k in g) g[k] += (r.combat[k] || 0); return g; },
    { attacks: 0, hits: 0, crits: 0, fumbles: 0, dmgDealt: 0, dmgTaken: 0, kosDealt: 0, kosTaken: 0, spellsCast: 0, pmSpent: 0, heal: 0 });
  const GS = rows.reduce((g, r) => { g.rolls += r.sRolls; g.crits += r.sCrits; g.fumbles += r.sFumbles; return g; }, { rolls: 0, crits: 0, fumbles: 0 });
  const hitRate = GC.attacks ? Math.round(GC.hits / GC.attacks * 100) : 0;
  const tally = (key) => { const m = {}; rows.forEach(r => r[key].forEach(x => { m[x.n] = (m[x.n] || 0) + x.c; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const skillAgg = {};
  rows.forEach(r => r.perSkill.forEach(s => { (skillAgg[s.sk] ??= 0); skillAgg[s.sk] += s.rolls; }));
  const skillTally = Object.entries(skillAgg).sort((a, b) => b[1] - a[1]);
  const topSkill = skillTally[0];
  const spellTally = tally('spells'), emoteTally = tally('emotes');
  const topSpell = spellTally[0], topEmote = emoteTally[0];

  const best = (key) => [...rows].filter(r => r.combat[key] > 0).sort((a, b) => b.combat[key] - a.combat[key])[0];
  const topDmg = best('dmgDealt'), topKo = best('kosDealt'), topHeal = best('heal'), topBig = best('biggestHit'), topTank = best('dmgTaken'), topMage = best('spellsCast');
  const topHit = [...rows].filter(r => r.combat.attacks >= 3).map(r => ({ ...r, hr: Math.round(r.combat.hits / r.combat.attacks * 100) })).sort((a, b) => b.hr - a.hr)[0];
  const topFumble = [...rows].map(r => ({ ...r, tf: r.combat.fumbles + r.sFumbles })).filter(r => r.tf > 0).sort((a, b) => b.tf - a.tf)[0];
  const topEmoter = [...rows].filter(r => r.emoteTotal > 0).sort((a, b) => b.emoteTotal - a.emoteTotal)[0];
  const topRoller = [...rows].filter(r => r.sRolls > 0).sort((a, b) => b.sRolls - a.sRolls)[0];

  const statCard = (ic, val, lbl, a) => `<div class="stats-kpi" style="--a:${a}"><span class="stats-kpi-ic">${ic}</span><span class="stats-kpi-val">${val}</span><span class="stats-kpi-lbl">${lbl}</span></div>`;
  // Award : renvoie { html, txt } pour mutualiser affichage et export.
  const awards = [];
  // Carte-trophée : icône + intitulé + gagnant · valeur, liseré coloré (--tc).
  const award = (ic, lbl, who, val, col) => { if (!who) return ''; awards.push(`${ic} ${lbl} : ${who} (${val})`);
    return `<div class="stats-trophy" style="--tc:${col}">
      <span class="stats-trophy-ic">${ic}</span>
      <div class="stats-trophy-tx">
        <span class="stats-trophy-lbl">${lbl}</span>
        <span class="stats-trophy-who">${_esc(who)}<b> · ${val}</b></span>
      </div></div>`; };

  const charBlock = (r) => {
    const cm = r.combat;
    const rhr = cm.attacks ? Math.round(cm.hits / cm.attacks * 100) : null;
    // Tuiles de stats clés (nonzero seulement) — vue d'un coup d'œil.
    const tiles = [];
    const tile = (v, l, c) => tiles.push(`<div class="stats-tile"><span class="stats-tile-v"${c ? ` style="color:${c}"` : ''}>${v}</span><span class="stats-tile-l">${l}</span></div>`);
    if (cm.attacks)    tile(cm.attacks, 'Attaques');
    if (cm.dmgDealt)   tile(cm.dmgDealt, 'Dégâts', '#c9b6ff');
    if (cm.biggestHit) tile(cm.biggestHit, 'Plus gros coup');
    if (cm.dmgTaken)   tile(cm.dmgTaken, 'Subis');
    if (cm.kosDealt)   tile(cm.kosDealt, 'KO');
    if (cm.spellsCast) tile(cm.spellsCast, 'Sorts', '#c9b6ff');
    if (cm.heal)       tile(cm.heal, 'Soin', '#4fd3a6');
    if (r.sRolls)      tile(r.sRolls, 'Jets', '#7fb0ff');
    const tilesHtml = tiles.length ? `<div class="stats-tiles">${tiles.join('')}</div>` : '';
    const skillHtml = r.perSkill.length ? `
      <div class="stats-skills">
        ${r.perSkill.slice(0, 6).map(s => `
          <div class="stats-skill-row">
            <span class="stats-skill-name">${_esc(s.sk)}</span>
            <span class="stats-skill-bar"><span style="width:${r.sRolls ? Math.round((s.rolls / r.sRolls) * 100) : 0}%"></span></span>
            <span class="stats-skill-n">${s.rolls}${s.crits ? ` · 💥${s.crits}` : ''}${s.fumbles ? ` · 💔${s.fumbles}` : ''}</span>
          </div>`).join('')}
      </div>` : '';
    const favs = [];
    if (r.spells[0]) favs.push(`<span class="stats-fav">⭐ ${_esc(r.spells[0].n)} <small>×${r.spells[0].c}</small></span>`);
    if (r.emotes[0]) favs.push(`<span class="stats-fav">${_statsEmoteHtml(r.emotes[0].n, 'stats-emote-sm')} <small>×${r.emotes[0].c}</small></span>`);
    const favsHtml = favs.length ? `<div class="stats-favs">${favs.join('')}</div>` : '';
    const dateBtn = r.hasDates
      ? `<button class="stats-char-btn" data-action="_statsCharDates" data-id="${r.id}" title="Voir les stats séance par séance">📅</button>`
      : '';
    const delBtn = STATE.isAdmin
      ? `<button class="stats-char-btn stats-char-del" data-action="_statsDelChar" data-id="${r.id}" title="Supprimer les stats de ce personnage (jets de test…)">✕</button>`
      : '';
    const char = STATE.characters?.find(x => x.id === r.id) || { nom: r.name };
    const avatar = characterAvatarHtml(char, { size: 34, className: 'stats-char-av', title: r.name });
    const ring = rhr != null
      ? `<span class="stats-char-ring" title="Taux de réussite">${_statsGauge(rhr, '#22c38e', 44, 5)}</span>` : '';
    return `<div class="stats-char">
      <div class="stats-char-hd">
        <span class="stats-char-id">${avatar}<span class="stats-char-name">${_esc(r.name)}</span></span>
        ${ring}
        <span class="stats-char-actions">${dateBtn}${delBtn}</span>
      </div>
      ${tilesHtml}${skillHtml}${favsHtml}
    </div>`;
  };

  const combatTitle = dateKey ? `⚔️ Combat — séance du ${_statsFmtDate(dateKey)}` : '⚔️ Combat (table)';
  const awardsHtml = [
    award('🏆', 'Plus gros frappeur', topDmg?.name, `${topDmg?.combat.dmgDealt} dmg`, '#f4c430'),
    award('💢', 'Plus gros coup', topBig?.name, `${topBig?.combat.biggestHit}`, '#ff8b6b'),
    award('🎯', 'Meilleur taux', topHit?.name, topHit ? `${topHit.hr}%` : '', '#22c38e'),
    award('☠️', 'Bourreau', topKo?.name, `${topKo?.combat.kosDealt} KO`, '#ef4444'),
    award('💚', 'Plus grand soigneur', topHeal?.name, `${topHeal?.combat.heal} PV`, '#4fd3a6'),
    award('🧙', 'Le Mage', topMage?.name, `${topMage?.combat.spellsCast} sorts`, '#bca0ff'),
    award('🪨', "L'Increvable", topTank?.name, `${topTank?.combat.dmgTaken} dmg subis`, '#9aa0aa'),
    award('💬', 'Le Bavard', topEmoter?.name, `${topEmoter?.emoteTotal} émotes`, '#4f8cff'),
    award('🎲', 'Le Joueur', topRoller?.name, `${topRoller?.sRolls} jets`, '#7fb0ff'),
    award('🤡', 'Le plus malchanceux', topFumble?.name, `${topFumble?.tf} échec${topFumble?.tf > 1 ? 's' : ''}`, '#ff6b6b'),
  ].join('');

  // Récap texte (export) — construit à partir du scope courant.
  const scopeLabel = dateKey ? `séance du ${_statsFmtDate(dateKey)}` : 'toute la campagne';
  const sumLines = [
    `📊 Stats — ${scopeLabel}`,
    `⚔️ ${GC.attacks} attaques (${hitRate}%) · 🗡️ ${GC.dmgDealt} dmg · ☠️ ${GC.kosDealt} KO · 💚 ${GC.heal} PV soignés · 🔮 ${GC.spellsCast} sorts`,
    `🎲 ${GS.rolls} jets de compétence (💥 ${GS.crits} · 💔 ${GS.fumbles})`,
  ];
  if (awards.length) { sumLines.push('', '— Récompenses —', ...awards); }
  sumLines.push('', '— Par personnage —');
  rows.forEach(r => {
    const p = [];
    const rhr = r.combat.attacks ? Math.round(r.combat.hits / r.combat.attacks * 100) : 0;
    if (r.combat.attacks) p.push(`⚔️${r.combat.attacks}·${rhr}%`);
    if (r.combat.dmgDealt) p.push(`🗡️${r.combat.dmgDealt}`);
    if (r.combat.biggestHit) p.push(`💢${r.combat.biggestHit}`);
    if (r.combat.spellsCast) p.push(`🔮${r.combat.spellsCast}`);
    if (r.combat.heal) p.push(`💚${r.combat.heal}`);
    if (r.sRolls) p.push(`🎲${r.sRolls}`);
    sumLines.push(`• ${r.name} : ${p.join(' · ') || '—'}`);
  });
  _statsLastSummary = sumLines.join('\n');

  const heroMetric = (v, l, c) => `<div class="stats-hm"><span class="stats-hm-v" style="color:${c}">${v}</span><span class="stats-hm-l">${l}</span></div>`;

  root.innerHTML = `
    ${toolbar}
    <section class="stats-hero">
      <div class="stats-hero-gauge">
        ${_statsGauge(hitRate, '#22c38e', 104, 10, 'réussite')}
      </div>
      <div class="stats-hero-body">
        <div class="stats-hero-title">Résumé — ${scopeLabel}</div>
        <div class="stats-hero-metrics">
          ${heroMetric(GC.attacks, 'Attaques', '#ff9d7a')}
          ${heroMetric(GC.dmgDealt, 'Dégâts infligés', '#c9b6ff')}
          ${heroMetric(GC.spellsCast, 'Sorts lancés', '#bca0ff')}
          ${heroMetric(GC.heal, 'Soin prodigué', '#4fd3a6')}
          ${heroMetric(GS.rolls, 'Jets de compétence', '#7fb0ff')}
        </div>
      </div>
    </section>

    <section class="stats-sec">
      <div class="stats-sec-hd">${combatTitle}</div>
      <div class="stats-kpis">
        ${statCard('💥', GC.crits, 'Réussites critiques', '#f4c430')}
        ${statCard('💔', GC.fumbles, 'Échecs critiques', '#ff6b6b')}
        ${statCard('🛡️', GC.dmgTaken, 'Dégâts subis', '#9aa0aa')}
        ${statCard('☠️', GC.kosDealt, 'KO infligés', '#ef4444')}
        ${statCard('💀', GC.kosTaken, 'Fois mis KO', '#b06a6a')}
        ${statCard('🔋', GC.pmSpent, 'PM dépensés', '#4f8cff')}
      </div>
    </section>

    ${awardsHtml ? `
    <section class="stats-sec">
      <div class="stats-sec-hd">🏆 Distinctions</div>
      <div class="stats-trophies">${awardsHtml}</div>
    </section>` : ''}

    <section class="stats-sec">
      <div class="stats-sec-hd">🎲 Compétences</div>
      <div class="stats-kpis">
        ${statCard('🎲', GS.rolls, 'Jets de compétence', '#4f8cff')}
        ${statCard('💥', GS.crits, 'Réussites critiques', '#22c38e')}
        ${statCard('💔', GS.fumbles, 'Échecs critiques', '#ff6b6b')}
        ${statCard('🏅', topSkill ? _esc(topSkill[0]) : '—', 'Compétence la + jouée', '#f4c430')}
      </div>
    </section>

    ${(spellTally.length || emoteTally.length || skillTally.length) ? `
    <section class="stats-sec">
      <div class="stats-sec-hd">🏅 Palmarès</div>
      <div class="stats-podiums">
        ${_statsPodium('🔮 Sorts les + lancés', spellTally)}
        ${_statsPodium('🎲 Compétences les + jouées', skillTally)}
        ${_statsPodium('😄 Émotes les + utilisées', emoteTally, (l) => _statsEmoteHtml(l, 'stats-emote-sm'))}
      </div>
    </section>` : ''}

    <section class="stats-sec">
      <div class="stats-sec-hd">👤 Par personnage</div>
      <div class="stats-chars">${rows.sort((a, b) => (b.combat.attacks + b.sRolls) - (a.combat.attacks + a.sRolls)).map(charBlock).join('')}</div>
    </section>`;
}


const PAGES = {

  // ─── DASHBOARD ──────────────────────────────────────────────────────────────
  async dashboard() {
    const content = document.getElementById('main-content');

    // Loader splash visible tant que les données ne sont pas chargées.
    // Le wrapper #dash-root est conservé : le rendu final l'utilise pour s'y injecter.
    content.innerHTML = `<div class="dash-root" id="dash-root">${appSplashHtml()}</div>`;

    const uid = STATE.isAdmin ? null : STATE.user.uid;

    // ── Données RÉACTIVES (rendu NON-bloquant) ─────────────────────────
    // Le dashboard ne bloque plus sur le réseau : 1er rendu immédiat depuis le
    // cache (instantané sur cache chaud, squelette vide sinon), puis re-rendu à
    // l'arrivée de chaque source via les abonnements en bas de fonction. Ces
    // watch() se branchent sur les listeners session-live (0 lecture en plus)
    // et sont nettoyés par unwatchAll() à la navigation.
    let allChars        = sortCharactersForDisplay(getCachedCollection('characters') || []);
    let storyItems      = getCachedCollection('story')        || [];
    let achievementsRaw = getCachedCollection('achievements') || [];
    let quests          = getCachedCollection('quests')       || [];
    let collectionItems = getCachedCollection('collection')   || [];
    let bastionDoc      = null;
    let nextSession     = null;

    let _dashDecorated   = false;  // animations d'entrée + particules : 1 seule fois
    let _presenceWatched = false;  // abonnement présence MJ : 1 seule fois
    let _paintQueued     = false;

    const paint = () => {
      _paintQueued = false;
      if (STATE.currentPage !== 'dashboard' || !document.getElementById('dash-root')) return;

      // chars = mes persos ; allPartyChars = les autres (bloc groupe côté joueur)
      const chars         = uid ? allChars.filter(c => c.uid === uid) : allChars;
      const allPartyChars = uid ? allChars.filter(c => c.uid !== uid) : [];
      // Les hauts-faits secrets restent invisibles aux joueurs partout
      const achievements = STATE.isAdmin ? achievementsRaw : achievementsRaw.filter(a => !a.secret);
      STATE.characters = chars;

    // Formate la prochaine séance pour affichage (date FR + créneau)
    const _SLOT_LABELS = { m: '🌞 Matin', a: '☀️ Aprem', s: '🌙 Soir' };
    function _formatNextSession(sess) {
      if (!sess || !sess.date) return null;
      const d = new Date(sess.date + 'T12:00:00');
      const dateFr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      return { dateFr, slotLabel: _SLOT_LABELS[sess.slot] || '', questTitle: sess.questTitle || '' };
    }
    // agenda_session/next contient une LISTE de séances validées (rétro-compat :
    // ancien doc à plat = liste de 1). On affiche la plus proche visible par le
    // joueur (membres du groupe concerné + MJ).
    const _isSessVisible = (s) => {
      const u = s?.participantUids;
      return STATE.isAdmin || !Array.isArray(u) || !u.length || u.includes(uid);
    };
    const _allSessions = Array.isArray(nextSession?.sessions)
      ? nextSession.sessions
      : (nextSession?.date ? [nextSession] : []);
    const _visibleSessions = _allSessions
      .filter(_isSessVisible)
      .sort((a, b) => (a?.date || '').localeCompare(b?.date || ''));
    const nextSessionFmt = _formatNextSession(_visibleSessions[0]);
    const _otherSessions = Math.max(0, _visibleSessions.length - 1);

    // Icône SVG inline (jeu d'icônes maison) — rendu homogène cross-OS vs émoji.
    const _svg = (id, color) => `<svg class="dv2-svg-ico"${color ? ` style="color:${color}"` : ''} aria-hidden="true"><use href="./assets/img/icons.svg#icon-${id}"/></svg>`;

    // ── Action du moment : bloc primaire promu en haut du hub (MJ & joueur) ──
    // Le « jouer » est l'action n°1 : on l'élève au-dessus du reste et on y
    // greffe la prochaine séance validée (contexte immédiatement utile).
    const primaryBlock = `
      <div class="dash-vtt-cta dash-vtt-cta--primary" data-navigate="vtt">
        <span class="dash-vtt-icon">${_svg('dice', '#6aa7ff')}</span>
        <div class="dash-vtt-text">
          <span class="dash-vtt-label">Entrer dans la table</span>
          <span class="dash-vtt-sub">${nextSessionFmt
            ? `Prochaine séance : ${_esc(nextSessionFmt.dateFr)} · ${nextSessionFmt.slotLabel}${_otherSessions ? ` · +${_otherSessions} autre${_otherSessions > 1 ? 's' : ''}` : ''}`
            : 'Lancer ou rejoindre la session de jeu'}</span>
        </div>
        <span class="dash-vtt-arrow">→</span>
      </div>`;

    const pseudo = STATE.profile?.pseudo || 'Aventurier';

    // Mission active
    const mission = storyItems
      .filter(i => i.type === 'mission' && i.statut === 'En cours')
      .sort((a,b) => (b.ordre||0) - (a.ordre||0))[0] || null;

    // Progression trame
    const totalMissions = storyItems.filter(i => i.type === 'mission').length;
    const doneMissions  = storyItems.filter(i => i.type === 'mission' && i.statut === 'Terminée').length;

    // Bastion — compatibilité ancien & nouveau modèle
    function _bastionLevel(d) {
      if (!d) return null;
      // Nouveau modèle : niveau = nb salles construites + 1
      if (d.salles && typeof d.salles === 'object' && !Array.isArray(d.salles)) {
        return 1 + Object.values(d.salles).filter(s => (s?.niveau || 0) > 0).length;
      }
      // Ancien modèle : niveau = nb améliorations débloquées + 1
      return 1 + (d.ameliorationsCustom || []).filter(a => (a.fondsActuels||0) >= (a.cout||1) && (a.cout||1) > 0).length;
    }
    function _bastionSallesArr(d) {
      if (!d?.salles) return [];
      if (Array.isArray(d.salles)) return d.salles.filter(s => s?.nom);
      // Nouveau modèle : { [slug]: {niveau, ...} }
      return Object.entries(d.salles)
        .filter(([_, s]) => (s?.niveau || 0) > 0)
        .map(([slug, s]) => ({ nom: slug.charAt(0).toUpperCase() + slug.slice(1), niveau: s.niveau }));
    }
    const bastionLevel  = _bastionLevel(bastionDoc);
    const bastionNom    = bastionDoc?.nom || 'Le Bastion';

    // ── Carte mini personnage ─────────────────────────────────────────
    function _charMini(c) {
      const pvMax   = calcPVMax(c) || c.pvBase || 10;
      const pmMax   = calcPMMax(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const pvColor = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
      const ca      = calcCA(c) || 10;
      const or      = calcOr(c) || 0;
      const portrait = characterPortraitContent(c, { imgStyle: 'width:100%;height:100%;object-fit:cover;display:block', fallbackStyle: "font-family:'Cinzel',serif;font-size:1.3rem;font-weight:700;color:var(--gold)" });
      return `
      <div class="dash-char-mini" data-action="_goToChar" data-id="${c.id}">
        <div class="dash-char-mini-portrait">
          ${portrait}
          <div class="dash-char-mini-portrait-fade"></div>
        </div>
        <div class="dash-char-mini-body">
          <div class="dash-cm-namerow">
            <span class="dash-cm-name">${_esc(c.nom||'?')}</span>
            <span class="dash-hero-badge">Niv.&nbsp;${c.niveau||1}</span>
          </div>
          ${c.classe ? `<div class="dash-cm-sub">${_esc(c.classe)}${c.race?` · ${_esc(c.race)}`:''}</div>` : ''}
          <div class="dash-cm-bars">
            <div class="dash-bar-row">
              <span class="dash-bar-icon">${_svg('heart', '#ff6b6b')}</span>
              <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pvPct}%;background:${pvColor}"></div></div>
              <span class="dash-bar-val" style="color:${pvColor}">${pvCur}/${pvMax}</span>
            </div>
            <div class="dash-bar-row">
              <span class="dash-bar-icon">${_svg('sparkles', '#4adbf7')}</span>
              <div class="dash-bar-track"><div class="dash-bar-fill dash-bar-fill--pm" style="width:${pmPct}%"></div></div>
              <span class="dash-bar-val" style="color:#4adbf7">${pmCur}/${pmMax}</span>
            </div>
          </div>
          <div class="dash-cm-chips">
            <span class="dash-chip">${_svg('shield')} ${ca}</span>
            <span class="dash-chip dash-chip--gold">${_svg('coin')} ${or}</span>
          </div>
        </div>
        <div class="dash-hero-arrow">→</div>
      </div>`;
    }

    // ── Carte héros principale (1 seul perso joueur) ──────────────────
    function _charFeatured(c) {
      const pvMax   = calcPVMax(c) || c.pvBase || 10;
      const pmMax   = calcPMMax(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const pvColor = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
      const ca      = calcCA(c) || 10;
      const or      = calcOr(c) || 0;
      const portrait = characterPortraitContent(c, { fallbackStyle: "font-family:'Cinzel',serif;font-size:1.6rem;font-weight:700;color:var(--gold)" });
      return `
      <div class="dash-hero" data-action="_goToChar" data-id="${c.id}">
        <div class="dash-hero-glow"></div>
        <div class="dash-hero-portrait">
          <div class="dash-hero-portrait-inner">${portrait}</div>
          <div class="dash-hero-portrait-fade"></div>
        </div>
        <div class="dash-hero-body">
          <div>
            <div class="dash-hero-name">${_esc(c.nom||'Mon personnage')}</div>
            <div class="dash-hero-meta">
              <span class="dash-hero-badge">Niv. ${c.niveau||1}</span>
              ${c.classe ? `<span class="dash-hero-badge">${_esc(c.classe)}</span>` : ''}
            </div>
            ${c.titre ? `<div class="dash-hero-titre">${_esc(c.titre)}</div>` : ''}
          </div>
          <div>
            <div class="dash-hero-bars">
              <div class="dash-bar-row">
                <span class="dash-bar-icon">${_svg('heart', '#ff6b6b')}</span>
                <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pvPct}%;background:${pvColor}"></div></div>
                <span class="dash-bar-val" style="color:${pvColor}">${pvCur}/${pvMax}</span>
              </div>
              <div class="dash-bar-row">
                <span class="dash-bar-icon">${_svg('sparkles', '#4adbf7')}</span>
                <div class="dash-bar-track"><div class="dash-bar-fill dash-bar-fill--pm" style="width:${pmPct}%"></div></div>
                <span class="dash-bar-val" style="color:#4adbf7">${pmCur}/${pmMax}</span>
              </div>
            </div>
            <div class="dash-hero-chips">
              <span class="dash-chip">${_svg('shield')} CA <strong>${ca}</strong></span>
              <span class="dash-chip dash-chip--gold">${_svg('coin')} <strong>${or}</strong> or</span>
            </div>
          </div>
        </div>
        <div class="dash-hero-arrow">→</div>
      </div>`;
    }

    // ── Carte admin ultra-compacte (ligne de tableau) ────────────────
    function _charRow(c) {
      const pvMax   = calcPVMax(c) || c.pvBase || 10;
      const pmMax   = calcPMMax(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const pvColor = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
      const ca      = calcCA(c) || 10;
      const or      = calcOr(c) || 0;
      const avatar = characterPortraitContent(c, { imgStyle: 'width:100%;height:100%;object-fit:cover;display:block', fallbackStyle: "font-family:'Cinzel',serif;font-size:.8rem;font-weight:700;color:var(--gold)" });
      // Couleur par joueur (hash sur le pseudo)
      const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#22d3ee'];
      const pcol  = PCOLS[(c.ownerPseudo||'?').split('').reduce((a,x)=>a+x.charCodeAt(0),0) % PCOLS.length];
      return `
      <div class="dv2-char-row" data-action="_goToChar" data-id="${c.id}" style="--pcol:${pcol}">

        <div class="dv2-cr-top">
          <div class="dv2-cr-avatar">${avatar}</div>
          <div class="dv2-flex1">
            <div class="dv2-cr-namerow">
              <span class="dv2-cr-name">${_esc(c.nom||'?')}</span>
              <span class="dv2-cr-badge">Niv.${c.niveau||1}</span>
            </div>
            <div class="dv2-cr-sub">${c.classe||''}${c.race?` · ${c.race}`:''}</div>
          </div>
          <div class="dv2-cr-tag" style="color:${pcol};background:${pcol}18;border:1px solid ${pcol}44">${_esc(c.ownerPseudo||'?')}</div>
        </div>

        <div class="dv2-cr-bottom">
          <div class="dv2-cr-bars">
            <div class="dv2-cr-barrow">
              <span class="dv2-cr-icon">${_svg('heart', '#ff6b6b')}</span>
              <div class="dv2-cr-track"><div class="dv2-cr-fill" style="width:${pvPct}%;background:${pvColor}"></div></div>
              <span class="dv2-cr-val" style="color:${pvColor}">${pvCur}/${pvMax}</span>
            </div>
            <div class="dv2-cr-barrow">
              <span class="dv2-cr-icon">${_svg('sparkles', '#4adbf7')}</span>
              <div class="dv2-cr-track"><div class="dv2-cr-fill dv2-cr-fill--pm" style="width:${pmPct}%"></div></div>
              <span class="dv2-cr-val" style="color:#4adbf7">${pmCur}/${pmMax}</span>
            </div>
          </div>
          <div class="dv2-cr-side">
            <span class="dv2-cr-side-row dv2-cr-ca">${_svg('shield')} <strong>${ca}</strong></span>
            <span class="dv2-cr-side-row dv2-cr-or">${_svg('coin')} ${or}</span>
          </div>
        </div>

      </div>`;
    }

    // ── Section personnages ───────────────────────────────────────────
    let charsHtml = '';
    if (STATE.isAdmin) {
      if (chars.length === 0) {
        charsHtml = `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.2rem;text-align:center;color:var(--text-dim);font-size:.85rem">
          <div style="font-size:1.5rem;margin-bottom:.4rem;opacity:.35">📜</div>Aucun personnage dans cette aventure</div>`;
      } else {
        // Tri : ordre alphabétique du nom du personnage (cohérent avec le reste de l'app).
        const sorted = sortCharactersForDisplay(chars);
        charsHtml = `
        <div class="dash-grid-charlist">
          ${sorted.map(c => _charRow(c)).join('')}
        </div>`;
      }
    } else {
      if (chars.length === 0) {
        charsHtml = `
        <div class="dash-hero" data-navigate="characters">
          <div class="dash-hero-body" style="flex-direction:row;align-items:center;gap:1rem;padding:1.3rem 1.5rem">
            <div style="width:48px;height:48px;border-radius:50%;background:rgba(232,184,75,.08);
              border:1px dashed rgba(232,184,75,.3);display:flex;align-items:center;justify-content:center;
              font-size:1.3rem;flex-shrink:0">⚔️</div>
            <div style="flex:1">
              <div class="dash-hero-name" style="font-size:.95rem">Créer mon personnage</div>
              <div style="font-size:.78rem;color:var(--text-dim);margin-top:2px">Bienvenue ${_esc(pseudo)} ! Commence par créer ta fiche de héros.</div>
            </div>
            <div class="dash-hero-arrow">→</div>
          </div>
        </div>`;
      } else if (chars.length === 1) {
        charsHtml = _charFeatured(chars[0]);
      } else {
        charsHtml = `
        <div class="dash-grid-charmini">
          ${chars.map(c => _charMini(c)).join('')}
        </div>`;
      }
    }

    // ── Render ────────────────────────────────────────────────────────
    const dash = document.getElementById('dash-root');
    if (!dash) return;

    const _myUid           = STATE.user?.uid;
    const _myUidAliases    = [
      _myUid,
      ...(Array.isArray(STATE.profile?.previousUids) ? STATE.profile.previousUids : []),
      ...(Array.isArray(STATE.profile?.uidAliases) ? STATE.profile.uidAliases : []),
    ].filter(Boolean);
    const collectionTotal  = collectionItems.length;
    const collectionUnlocked = collectionItems.filter(c => c.unlocked).length;
    const collectionPct    = collectionTotal > 0 ? Math.round((collectionUnlocked / collectionTotal) * 100) : 0;
    // Groupes « En cours » de la Trame (quêtes liées à une mission). L'ancien
    // modèle de quêtes autonomes est abandonné — le hub reflète la Trame.
    // Missions clôturées (Terminée/Échouée) → leurs groupes ne doivent plus
    // compter comme « en cours », même si le statut du groupe n'a pas été basculé.
    const _doneMissionIds = new Set(
      storyItems.filter(i => i.statut === 'Terminée' || i.statut === 'Échouée').map(i => i.id)
    );
    const activeGroups     = quests
      .filter(q => q.missionId && (q.statut || 'active') === 'active' && !_doneMissionIds.has(q.missionId))
      .sort((a, b) => (b.createdAt||'') > (a.createdAt||'') ? 1 : -1);
    const _missionTitleById = new Map(storyItems.map(i => [i.id, i.titre || 'Mission']));

    setDashboardQuests(quests);

    // ── Helpers ────────────────────────────────────────────────────────

    // Mini-portrait
    const _portMini = (p, size = 26) => characterAvatarHtml(p, { size, border: '2px solid var(--bg-card)', background: 'rgba(79,140,255,.18)', color: 'var(--gold)' });

    // Carte d'un groupe de la Trame (lecture seule → on rejoint/gère dans la Trame).
    const _dashGroupCard = q => {
      const parts        = dedupeQuestParticipants(q.participants, { uidAliases: _myUidAliases });
      const missionTitle = _missionTitleById.get(q.missionId) || 'Mission';
      const joined       = parts.some(p => _myUidAliases.includes(p.uid));
      const portHtml     = parts.slice(0, 5).map(p => _portMini(p, 24)).join('');
      return `
      <div class="quest-card quest-card--active" data-navigate="story">
        <div class="quest-card-hd">
          <span class="quest-badge" style="background:rgba(79,140,255,.13);color:#7aa7ff;border-color:rgba(79,140,255,.3)">🎯 ${_esc(missionTitle)}</span>
          ${joined ? `<span style="margin-left:auto;font-size:.7rem;color:#22c38e;font-weight:700">✓ Rejoint</span>` : ''}
        </div>
        <div class="quest-card-title">${_esc(q.titre || 'Groupe')}</div>
        ${q.recompense ? `<div class="quest-reward">🎁 ${_esc(q.recompense)}</div>` : ''}
        <div class="quest-parts">${portHtml}${parts.length > 5 ? `<span class="quest-parts-count">+${parts.length - 5}</span>` : ''}<span class="quest-parts-count">${parts.length} membre${parts.length > 1 ? 's' : ''}</span></div>
      </div>`;
    };

    // Barre progression trame (v2)
    const _progBar = () => {
      if (totalMissions === 0) return '';
      const pct = Math.round(doneMissions / totalMissions * 100);
      return `
      <div class="dv2-panel-card dv2-progress-card" data-navigate="story">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)">📖 Progression aventure</span>
          <span style="font-size:.72rem;color:var(--arcane);font-weight:700;font-family:var(--font-display)">${doneMissions}/${totalMissions} missions</span>
        </div>
        <div class="dv2-mission-prog-track">
          <div class="dv2-mission-prog-fill" data-w="${pct}%"><div class="dv2-mission-shimmer"></div></div>
        </div>
      </div>`;
    };

    // ── Helpers joueur v2 ─────────────────────────────────────────────

    function _heroCardV2(c) {
      const pvMax   = calcPVMax(c) || c.pvBase || 10;
      const pmMax   = calcPMMax(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const xpCur   = c.exp || 0;
      const xpNext  = calcPalier(c.niveau || 1);
      const xpPct   = Math.min(100, Math.round(xpCur / xpNext * 100));
      const ca      = calcCA(c) || 10;
      const or      = calcOr(c) || 0;
      const portrait = characterPortraitContent(c);
      return `
      <div class="dv2-hero-card" data-action="_goToChar" data-id="${c.id}">
        <div class="dv2-hero-inner">
          <div class="dv2-portrait-wrap">
            <div class="dv2-portrait">${portrait}</div>
            <div class="dv2-portrait-level">NIV.&nbsp;${c.niveau||1}</div>
          </div>
          <div class="dv2-hero-info">
            <div>
              <div class="dv2-chips">
                ${c.classe ? `<span class="dv2-chip dv2-chip-blue">${_esc(c.classe)}</span>` : ''}
                ${c.race   ? `<span class="dv2-chip dv2-chip-purple">${_esc(c.race)}</span>` : ''}
              </div>
              <div class="dv2-hero-name">${_esc(c.nom||'Mon Héros')}</div>
              ${c.titre ? `<div class="dv2-hero-title">${_esc(c.titre)}</div>` : ''}
            </div>
            <div class="dv2-stat-bars">
              <div class="dv2-bar-row">
                <span class="dv2-bar-label" style="color:#22c38e">PV</span>
                <div class="dv2-bar-track"><div class="dv2-bar-fill dv2-bar-hp" data-w="${pvPct}%"></div></div>
                <span class="dv2-bar-val">${pvCur}/${pvMax}</span>
              </div>
              <div class="dv2-bar-row">
                <span class="dv2-bar-label" style="color:#6aa7ff">PM</span>
                <div class="dv2-bar-track"><div class="dv2-bar-fill dv2-bar-mp" data-w="${pmPct}%"></div></div>
                <span class="dv2-bar-val">${pmCur}/${pmMax}</span>
              </div>
              <div class="dv2-bar-row">
                <span class="dv2-bar-label" style="color:#c084fc">XP</span>
                <div class="dv2-bar-track"><div class="dv2-bar-fill dv2-bar-xp" data-w="${xpPct}%"><div class="dv2-bar-xp-shimmer"></div></div></div>
                <span class="dv2-bar-val">${xpCur}/${xpNext}</span>
              </div>
            </div>
            <div class="dv2-stats-row">
              <div class="dv2-stat-pill">
                <div class="dv2-stat-pill-val" style="color:#f4c430">${_svg('coin')} ${or}</div>
                <div class="dv2-stat-pill-lbl">Or</div>
              </div>
              <div class="dv2-stat-pill">
                <div class="dv2-stat-pill-val" style="color:var(--gold-2)">${_svg('shield')} ${ca}</div>
                <div class="dv2-stat-pill-lbl">CA</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }

    function _partyCardV2(partyChars) {
      const byPlayer = {};
      partyChars.forEach(c => {
        const key = c.uid || c.ownerPseudo || c.id;
        if (!byPlayer[key] || (c.niveau||1) > (byPlayer[key].niveau||1)) byPlayer[key] = c;
      });
      const members = Object.values(byPlayer).slice(0, 5);
      setDashboardPartyChars(partyChars);
      return `
      <div class="dv2-party-card">
        <div class="dv2-panel-header">
          <div class="dv2-panel-title">⚔️ Groupe <span class="dv2-panel-count">${members.length}</span></div>
        </div>
        ${members.length > 0 ? members.map(c => {
          const av = characterPortraitContent(c, { fallbackTag: 'span' });
          const isOwn = STATE.isAdmin || c.uid === STATE.user?.uid;
          return `
          <div class="dv2-party-member" data-action="_openQuickView" data-id="${c.id}"
            title="Cliquer pour aperçu rapide">
            <div class="dv2-party-avatar">${av}</div>
            <div class="dv2-flex1">
              <div class="dv2-party-name">${_esc(c.nom||'?')}</div>
              <div class="dv2-party-sub">Niv.${c.niveau||1}${c.classe?` · ${_esc(c.classe)}`:''}</div>
            </div>
            ${isOwn ? `<button class="dv2-party-fullopen" data-action="_goToChar" data-id="${c.id}" data-stop-propagation
              title="Ouvrir la fiche complète">→</button>` : ''}
            <div class="dv2-party-dot"></div>
          </div>`;
        }).join('') : `<div class="dv2-empty-sm dv2-party-empty">
          <span class="dv2-presence-empty-ico">${_svg('users')}</span>
          <span>Les membres de ton groupe apparaîtront ici dès que vous partagez une aventure.</span>
        </div>`}
        ${nextSessionFmt ? `
        <div class="dv2-party-footer dv2-party-footer--session">
          <div class="dv2-party-session-label">Prochaine séance prévue pour :</div>
          <div class="dv2-party-session-chip dv2-party-session-chip--validated">
            <span class="dv2-pss-date">${_esc(nextSessionFmt.dateFr)}</span>
            <span class="dv2-pss-slot">${nextSessionFmt.slotLabel}</span>
            ${nextSessionFmt.questTitle ? `<span class="dv2-pss-quest">${_esc(nextSessionFmt.questTitle)}</span>` : ''}
          </div>
          ${_otherSessions ? `<div class="dv2-party-session-more">+${_otherSessions} autre${_otherSessions > 1 ? 's' : ''} créneau${_otherSessions > 1 ? 'x' : ''} validé${_otherSessions > 1 ? 's' : ''}</div>` : ''}
        </div>`
        : STATE.adventure ? `
        <div class="dv2-party-footer">
          <div class="dv2-party-session-label">Aventure en cours</div>
          <div class="dv2-party-session-chip">${STATE.adventure.emoji||'⚔️'} ${_esc(STATE.adventure.nom||'Aventure')}</div>
        </div>` : ''}
      </div>`;
    }

    function _missionCardV2() {
      if (!mission) return '';
      const pct = totalMissions > 0 ? Math.round(doneMissions / totalMissions * 100) : 0;
      return `
      <div class="dv2-mission-card" data-navigate="story">
        <div class="dv2-mission-header">
          <div class="dv2-mission-icon">${mission.imageUrl
            ? `<img src="${mission.imageUrl}" alt="${_esc(mission.nom || mission.titre || '')}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
            : '⚔️'}</div>
          <div class="dv2-mission-info">
            <div class="dv2-mission-type">Mission active${mission.acte ? ` · ${_esc(mission.acte)}` : ''}</div>
            <div class="dv2-mission-name">${_esc(mission.titre||'Mission')}</div>
            ${mission.lieu ? `<div style="font-size:.72rem;color:var(--text-dim);margin-top:3px">📍 ${_esc(mission.lieu)}</div>` : ''}
          </div>
          <div class="dv2-mission-status"><span style="opacity:.7">●</span>&nbsp;En cours</div>
        </div>
        ${mission.description ? `<div class="dv2-mission-desc">${_esc(mission.description)}</div>` : ''}
        ${totalMissions > 0 ? `
        <div class="dv2-mission-progress">
          <div class="dv2-mission-prog-labels">
            <span>Progression de l'aventure</span>
            <span class="dv2-mission-prog-val">${doneMissions}/${totalMissions}</span>
          </div>
          <div class="dv2-mission-prog-track">
            <div class="dv2-mission-prog-fill" data-w="${pct}%"><div class="dv2-mission-shimmer"></div></div>
          </div>
        </div>` : ''}
      </div>`;
    }

    function _statsGridV2(c) {
      const pvMax = calcPVMax(c) || c.pvBase || 10;
      const pmMax = calcPMMax(c) || c.pmBase || 10;
      const pvCur = c.pvActuel ?? pvMax;
      const pmCur = c.pmActuel ?? pmMax;
      const pvPct = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const ca = calcCA(c) || 10;
      const or = calcOr(c) || 0;
      return `
      <div class="dv2-stats-grid">
        <div class="dv2-stat-card dv2-sc-gold" data-action="_goToChar" data-id="${c.id}">
          <span class="dv2-stat-card-icon">${_svg('coin', '#f4c430')}</span>
          <div class="dv2-stat-card-val" style="color:#f4c430">${or}</div>
          <div class="dv2-stat-card-lbl">Or</div>
        </div>
        <div class="dv2-stat-card dv2-sc-shield" data-action="_goToChar" data-id="${c.id}">
          <span class="dv2-stat-card-icon">${_svg('shield', 'var(--gold-2)')}</span>
          <div class="dv2-stat-card-val" style="color:var(--gold-2)">${ca}</div>
          <div class="dv2-stat-card-lbl">Classe d'armure</div>
        </div>
        <div class="dv2-stat-card dv2-sc-hp" data-action="_goToChar" data-id="${c.id}">
          <span class="dv2-stat-card-icon">${_svg('heart', '#22c38e')}</span>
          <div class="dv2-stat-card-val" style="color:#22c38e">${pvCur}<span style="font-size:.65em;opacity:.55">/${pvMax}</span></div>
          <div class="dv2-stat-card-lbl">Points de vie</div>
          <div class="dv2-stat-card-sub">${pvPct}% restants</div>
        </div>
        <div class="dv2-stat-card dv2-sc-mp" data-action="_goToChar" data-id="${c.id}">
          <span class="dv2-stat-card-icon">${_svg('sparkles', '#b99fff')}</span>
          <div class="dv2-stat-card-val" style="color:#b99fff">${pmCur}<span style="font-size:.65em;opacity:.55">/${pmMax}</span></div>
          <div class="dv2-stat-card-lbl">Points de magie</div>
          <div class="dv2-stat-card-sub">${pmPct}% restants</div>
        </div>
      </div>`;
    }

    function _shortcutsV2() {
      const S = [
        { page:'bestiaire',  icon:'🐉', label:'Bestiaire',  bg:'rgba(255,90,126,.15)',  bc:'rgba(255,90,126,.3)',  col:'#ff5a7e' },
        { page:'recettes',   icon:'🍳', label:'Recettes',   bg:'rgba(34,195,142,.15)',  bc:'rgba(34,195,142,.3)',  col:'#22c38e' },
        { page:'shop',       icon:'🛍️', label:'Boutique',   bg:'rgba(244,196,48,.15)',  bc:'rgba(244,196,48,.3)',  col:'#f4c430' },
        { page:'map',        icon:'🗺️', label:'Carte',      bg:'rgba(79,140,255,.15)',  bc:'rgba(79,140,255,.3)',  col:'#4f8cff' },
        { page:'collection', icon:'🃏', label:'Collection', bg:'rgba(34,211,238,.15)',  bc:'rgba(34,211,238,.3)',  col:'#22d3ee' },
        { page:'vtt',        icon:'🎲', label:'Table VTT',  bg:'rgba(157,111,255,.15)', bc:'rgba(157,111,255,.3)', col:'#9d6fff' },
        { page:'bastion',    icon:'🏰', label:'Bastion',    bg:'rgba(255,149,68,.15)',  bc:'rgba(255,149,68,.3)',  col:'#ff9544' },
        { page:'characters', icon:'⚔️', label:'Personnage', bg:'rgba(232,184,75,.15)',  bc:'rgba(232,184,75,.3)',  col:'#e8b84b' },
      ].filter(s => isFeatureEnabled(s.page));
      if (!S.length) return '';
      return `<div class="dv2-shortcuts-grid">${S.map(s => `
        <button class="dv2-shortcut" data-navigate="${s.page}">
          <div class="dv2-shortcut-icon" style="background:${s.bg};border-color:${s.bc};color:${s.col}">${s.icon}</div>
          <span class="dv2-shortcut-label">${s.label}</span>
        </button>`).join('')}</div>`;
    }

    function _groupsPanelV2() {
      if (!isFeatureEnabled('story')) return ''; // Trame désactivée
      // Mes groupes « En cours » (ceux que j'ai rejoints), sinon tous les groupes actifs.
      const mine = activeGroups.filter(q => (q.participants || []).some(p => _myUidAliases.includes(p.uid)));
      const list = (mine.length ? mine : activeGroups).slice(0, 5);
      return `
      <div class="dv2-panel-card">
        <div class="dv2-panel-header">
          <div class="dv2-panel-title">👥 Mes groupes <span class="dv2-panel-count">${mine.length || activeGroups.length}</span></div>
          <button class="dv2-section-action" data-navigate="story">Trame →</button>
        </div>
        ${list.length ? list.map(q => {
          const joined = (q.participants || []).some(p => _myUidAliases.includes(p.uid));
          const missionTitle = _missionTitleById.get(q.missionId) || 'Mission';
          const count = dedupeQuestParticipants(q.participants, { uidAliases: _myUidAliases }).length;
          return `
          <div class="dv2-quest-item" data-navigate="story">
            <div class="dv2-quest-icon dv2-qi-main">🎯</div>
            <div class="dv2-flex1">
              <div class="dv2-quest-name">${_esc(q.titre || 'Groupe')}</div>
              <div class="dv2-quest-sub">${_esc(missionTitle)}${joined ? ' · ✓ Rejoint' : ''}</div>
            </div>
            <div class="dv2-quest-rarity dv2-rarity-rare">${count} 👤</div>
          </div>`;
        }).join('') : `<div class="dv2-empty-sm">Aucun groupe en cours. Rejoins-en un dans la <strong>Trame</strong>.</div>`}
      </div>`;
    }

    function _achievementsPanelV2() {
      if (!isFeatureEnabled('achievements')) return ''; // Hauts-Faits désactivés
      return `
      <div class="dv2-panel-card">
        <div class="dv2-panel-header">
          <div class="dv2-panel-title">🏆 Hauts-faits <span class="dv2-panel-count">${achievements.length}</span></div>
          <button class="dv2-section-action" data-navigate="achievements">Voir tout →</button>
        </div>
        ${achievements.slice(0, 5).length > 0 ? [...achievements].sort((a,b) => { const p = d => { const [j,m,y] = (d||'').split('/'); return y&&m&&j?`${y}${m.padStart(2,'0')}${j.padStart(2,'0')}`:''; }; return p(b.date) > p(a.date) ? 1 : -1; }).slice(0, 5).map(a => `
        <div class="dv2-ach-item">
          <div class="dv2-ach-icon">${a.icone||'🏆'}</div>
          <div class="dv2-flex1">
            <div class="dv2-ach-name">${_esc(a.titre||a.nom||'Haut-fait')}</div>
            <div class="dv2-ach-desc">${_esc(a.description||'')}</div>
          </div>
          ${a.xp ? `<div class="dv2-ach-xp">+${a.xp}&nbsp;XP</div>` : ''}
        </div>`).join('') : `<div class="dv2-empty-sm">Aucun haut-fait.</div>`}
      </div>`;
    }

    function _bastionCardV2() {
      // Détection du nouveau modèle (salles = objet) vs ancien (array)
      const isNewModel = bastionDoc?.salles && typeof bastionDoc.salles === 'object' && !Array.isArray(bastionDoc.salles);
      const emoji   = bastionDoc?.emoji || '🏰';
      const semaine = bastionDoc?.semaine;
      const or      = bastionDoc?.or || 0;
      const salles  = _bastionSallesArr(bastionDoc).slice(0, 6);

      // Constructions en cours (nouveau modèle uniquement)
      let buildingCount = 0;
      if (isNewModel) {
        buildingCount = Object.values(bastionDoc.salles || {})
          .filter(s => s?.weeksLeftToBuild > 0).length;
      }

      const ev = bastionDoc?.evenementCourant;
      return `
      <div class="dv2-bastion-card" data-navigate="bastion">
        <div class="dv2-bastion-header">
          <div class="dv2-bastion-icon">${_esc(emoji)}</div>
          <div class="dv2-flex1">
            <div class="dv2-bastion-name">${_esc(bastionNom)}</div>
            <div class="dv2-bastion-level">${semaine ? `Période ${semaine}` : `Niveau ${bastionLevel}`}${bastionDoc?.lieu ? ` · ${_esc(bastionDoc.lieu)}` : ''}</div>
          </div>
          <button class="dv2-section-action" data-navigate="bastion" data-stop-propagation>Gérer →</button>
        </div>

        ${isNewModel ? `
        <div class="dv2-bastion-stats">
          <div class="dv2-bs-stat"><span class="dv2-bs-stat-ico">💰</span><span class="dv2-bs-stat-val">${or}</span><span class="dv2-bs-stat-lbl">or</span></div>
          ${buildingCount > 0 ? `<div class="dv2-bs-stat dv2-bs-stat--build"><span class="dv2-bs-stat-ico">🏗</span><span class="dv2-bs-stat-val">${buildingCount}</span><span class="dv2-bs-stat-lbl">en construction</span></div>` : ''}
        </div>` : ''}

        ${salles.length > 0 ? `
        <div class="dv2-bastion-rooms">${salles.map(s=>`
          <div class="dv2-bastion-room"><div class="dv2-bastion-room-dot"></div>${_esc(s.nom)}${s.niveau ? ` <span style="font-size:.62rem;opacity:.7">Niv.${s.niveau}</span>` : ''}</div>`).join('')}
        </div>` : `<div class="dv2-bastion-note" style="background:none;border:none;color:var(--text-dim);font-style:italic">Aucune salle construite</div>`}
        ${ev && ev !== 'calme' ? `<div class="dv2-bastion-note">⚠️ ${_esc(ev)}</div>` : ''}
      </div>`;
    }

    // ── Render ──────────────────────────────────────────────────────────
    const advBanner = STATE.adventure ? `
    <div class="dash-adv-banner" data-action="openAdventureSwitcher" style="cursor:${(STATE.adventures?.length||0)>1?'pointer':'default'}">
      <span style="font-size:1.1rem">${STATE.adventure.emoji||'⚔️'}</span>
      <span class="dash-adv-name">${_esc(STATE.adventure.nom)}</span>
      ${(STATE.adventures?.length||0)>1?`<span style="font-size:.7rem;color:var(--text-dim);border:1px solid var(--border);border-radius:6px;padding:1px 6px">⇄ Changer</span>`:''}
      <span class="dash-adv-tag">Aventure active</span>
    </div>` : '';

    if (STATE.isAdmin) {

      // ── VUE MJ v2 ─────────────────────────────────────────────────────
      dash.className = 'dv2-root';
      dash.innerHTML = `
      ${advBanner}

      <!-- En-tête MJ -->
      <div class="dv2-header">
        <div>
          <div class="dv2-greeting-label">Console Maître du Jeu</div>
          <div class="dv2-greeting-title">Bonjour, ${_esc(pseudo)}</div>
        </div>
        <div class="dv2-session-badge"><div class="dv2-session-dot"></div>Session active</div>
      </div>

      <!-- Action du moment -->
      ${primaryBlock}

      <!-- Stats 4-col -->
      <div class="dv2-stats-grid">
        <div class="dv2-stat-card dv2-sc-shield" data-navigate="characters">
          <span class="dv2-stat-card-icon">${_svg('scroll', 'var(--gold-2)')}</span>
          <div class="dv2-stat-card-val" style="color:var(--gold-2)">${chars.length}</div>
          <div class="dv2-stat-card-lbl">Personnage${chars.length!==1?'s':''}</div>
        </div>
        <div class="dv2-stat-card dv2-sc-mp" data-navigate="story">
          <span class="dv2-stat-card-icon">${_svg('users', '#b99fff')}</span>
          <div class="dv2-stat-card-val" style="color:#b99fff">${activeGroups.length}</div>
          <div class="dv2-stat-card-lbl">Groupe${activeGroups.length!==1?'s':''} en cours</div>
        </div>
        <div class="dv2-stat-card dv2-sc-hp" data-navigate="achievements">
          <span class="dv2-stat-card-icon">${_svg('trophy', '#22c38e')}</span>
          <div class="dv2-stat-card-val" style="color:#22c38e">${achievements.length}</div>
          <div class="dv2-stat-card-lbl">Haut${achievements.length!==1?'s':''}-fait${achievements.length!==1?'s':''}</div>
        </div>
        <div class="dv2-stat-card dv2-sc-gold dv2-stat-card--collection${collectionUnlocked === 0 ? ' is-empty' : ''}" data-navigate="collection" style="--collection-progress:${collectionPct}%" aria-label="Collection, ${collectionUnlocked} cartes débloquées sur ${collectionTotal}">
          <span class="dv2-stat-card-icon">${_svg('layers', '#f4c430')}</span>
          <div class="dv2-stat-card-val dv2-collection-val" style="color:#f4c430">${collectionUnlocked}<span>/${collectionTotal}</span></div>
          <div class="dv2-stat-card-lbl">Collection</div>
          <div class="dv2-collection-meter" aria-hidden="true"><span></span></div>
          <div class="dv2-stat-card-sub">${collectionTotal ? `${collectionPct}% de progression` : 'Aucune carte'}</div>
        </div>
      </div>

      <!-- Joueurs connectés (rempli en temps réel) -->
      <div id="dash-presence"></div>

      <!-- Personnages -->
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Personnages</span>
          <div class="dv2-section-label-line"></div>
          <button class="dv2-section-action" data-navigate="characters">Voir tous →</button>
        </div>
        <div class="dv2-panel-card">${charsHtml
          ? `<div style="padding:12px">${charsHtml}</div>`
          : `<div class="dv2-empty-md">Aucun personnage dans cette aventure.</div>`}
        </div>
      </div>

      <!-- Mission active -->
      ${_missionCardV2()}

      <!-- Console MJ -->
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Console MJ</span>
          <div class="dv2-section-label-line"></div>
        </div>
        <div class="dv2-shortcuts-grid dv2-shortcuts-grid--mj">
          ${[
            { page:'story',     icon:'📚', label:'Trame',     bg:'rgba(34,211,238,.15)',  bc:'rgba(34,211,238,.3)',  col:'#22d3ee' },
            { page:'shop',      icon:'🛍️', label:'Boutique',  bg:'rgba(244,196,48,.15)',  bc:'rgba(244,196,48,.3)',  col:'#f4c430' },
            { page:'npcs',      icon:'👥', label:'PNJ',       bg:'rgba(34,195,142,.15)',  bc:'rgba(34,195,142,.3)',  col:'#22c38e' },
            { page:'bestiaire', icon:'🐉', label:'Bestiaire', bg:'rgba(255,90,126,.15)',  bc:'rgba(255,90,126,.3)',  col:'#ff5a7e' },
            { page:'map',       icon:'🗺️', label:'Carte',     bg:'rgba(79,140,255,.15)',  bc:'rgba(79,140,255,.3)',  col:'#4f8cff' },
            { page:'statistiques', icon:'📊', label:'Stats',  bg:'rgba(167,139,250,.15)', bc:'rgba(167,139,250,.3)', col:'#a78bfa' },
            { page:'admin',     icon:'⚙️', label:'Admin',     bg:'rgba(255,149,68,.15)',  bc:'rgba(255,149,68,.3)',  col:'#ff9544' },
          ].filter(s => isFeatureEnabled(s.page)).map(s => `
          <button class="dv2-shortcut" data-navigate="${s.page}">
            <div class="dv2-shortcut-icon" style="background:${s.bg};border-color:${s.bc};color:${s.col}">${s.icon}</div>
            <span class="dv2-shortcut-label">${s.label}</span>
          </button>`).join('')}
        </div>
      </div>

      <!-- Groupes en cours (issus de la Trame) -->
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Groupes en cours</span>
          <div class="dv2-section-label-line"></div>
          <button class="dv2-section-action" data-navigate="story">Gérer dans la Trame →</button>
        </div>
        ${activeGroups.length
          ? `<div class="quest-grid">${activeGroups.slice(0,4).map(_dashGroupCard).join('')}</div>${activeGroups.length > 4 ? `<button class="dv2-section-action" data-navigate="story" style="align-self:flex-end;margin-top:6px">+${activeGroups.length-4} de plus →</button>` : ''}`
          : `<div class="dv2-panel-card"><div class="dv2-empty-md"><span style="opacity:.3">👥</span> Aucun groupe en cours. Crée-en sur une mission de la Trame.</div></div>`}
      </div>

      <!-- Trame progression -->
      ${totalMissions > 0 ? `
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Progression aventure</span>
          <div class="dv2-section-label-line"></div>
          <button class="dv2-section-action" data-navigate="story">Ouvrir →</button>
        </div>
        ${_progBar()}
      </div>` : ''}`;

      // ── Présence temps réel (MJ uniquement) ─────────────────────────
      // Filtre : actif si lastSeen < 2 min (cohérent avec la présence VTT)
      // Exclut le MJ lui-même. Cleanup auto via unwatchAll au prochain navigate.
      const _renderPresence = (list) => {
        const slot = document.getElementById('dash-presence');
        if (!slot) return;
        const now = Date.now();
        const active = (list || [])
          .filter(p => p.uid && p.uid !== _myUid)
          .map(p => ({ ...p, ts: p.lastSeen?.toMillis?.() ?? 0 }))
          .filter(p => p.ts > 0 && (now - p.ts) < 120_000)
          .sort((a, b) => (a.pseudo || '').localeCompare(b.pseudo || '', 'fr'));
        if (!active.length) {
          slot.innerHTML = `
            <div class="dv2-section-label">
              <span class="dv2-section-label-text">Joueurs connectés</span>
              <div class="dv2-section-label-line"></div>
            </div>
            <div class="dv2-panel-card">
              <div class="dv2-presence-empty">
                <span class="dv2-presence-empty-ico">${_svg('users')}</span>
                <div class="dv2-presence-empty-txt">
                  <span class="dv2-presence-empty-title">Personne autour de la table</span>
                  <span class="dv2-presence-empty-sub">Les joueurs connectés apparaîtront ici en temps réel.</span>
                </div>
              </div>
            </div>`;
          return;
        }
        const pills = active.map(p => {
          const ch = (STATE.characters || []).find(c => c.uid === p.uid) || null;
          const portrait = characterAvatarHtml(ch || p, { size: 30, border: '2px solid rgba(34,195,142,.55)', background: 'rgba(34,195,142,.15)', color: 'var(--gold)' });
          return `
          <div class="dv2-presence-pill">
            ${portrait}
            <div class="dv2-presence-meta">
              <span class="dv2-presence-name">${_esc(p.pseudo||'?')}</span>
              ${ch ? `<span class="dv2-presence-char">${_esc(ch.nom||'?')}</span>` : ''}
            </div>
          </div>`;
        }).join('');
        slot.innerHTML = `
          <div class="dv2-section-label">
            <span class="dv2-section-label-text">Joueurs connectés (${active.length})</span>
            <div class="dv2-section-label-line"></div>
          </div>
          <div class="dv2-panel-card">
            <div class="dv2-presence-list">${pills}</div>
          </div>`;
      };
      // Abonnement présence une seule fois (sinon chaque paint recrée un listener
      // éphémère → lectures inutiles). _renderPresence lit STATE.characters (à jour).
      if (!_presenceWatched) { _presenceWatched = true; watch('presence', 'presence', _renderPresence); }

    } else {

      // ── VUE JOUEUR v2 ─────────────────────────────────────────────────

      // Groupe : co-membres des groupes (Trame) que j'ai rejoints
      const _joinedGroups = activeGroups.filter(q =>
        Array.isArray(q.participants) && q.participants.some(p => _myUidAliases.includes(p.uid))
      );
      const _missionUids = new Set(
        _joinedGroups.flatMap(q => (q.participants || []).map(p => p.uid)).filter(u => !_myUidAliases.includes(u))
      );
      const partyMembers = _joinedGroups.length > 0
        ? [...chars, ...allPartyChars.filter(c => _missionUids.has(c.uid))]
        : [];

      // Bloc héros : une carte par personnage du joueur + carte groupe à côté du premier
      let heroBlock = '';
      if (chars.length === 0) {
        heroBlock = `
        <div class="dv2-hero-card" data-navigate="characters">
          <div class="dv2-hero-inner" style="padding:2rem;justify-content:center;text-align:center">
            <div>
              <div style="font-size:2rem;margin-bottom:.75rem">⚔️</div>
              <div class="dv2-hero-name" style="font-size:1.1rem;margin-bottom:.4rem">Créer mon personnage</div>
              <div style="font-size:.8rem;color:var(--text-dim)">Bienvenue ${_esc(pseudo)} ! Commence par créer ta fiche de héros.</div>
            </div>
          </div>
        </div>`;
      } else if (chars.length === 1) {
        heroBlock = `
        <div class="dv2-hero-grid">
          ${_heroCardV2(chars[0])}
          ${_partyCardV2(partyMembers)}
        </div>`;
      } else {
        // Plusieurs personnages : grille adaptative + carte groupe en dessous
        // auto-fit (vs auto-fill) étire les colonnes pour utiliser toute la largeur
        heroBlock = `
        <div class="dash-grid-herocards">
          ${chars.map(c => _heroCardV2(c)).join('')}
        </div>
        ${_partyCardV2(partyMembers)}`;
      }

      dash.className = 'dv2-root';
      dash.innerHTML = `
      ${advBanner}

      <div class="dv2-header">
        <div>
          <div class="dv2-greeting-label">Bonjour, aventurier</div>
          <div class="dv2-greeting-title">Bienvenue, ${_esc(pseudo)}</div>
        </div>
        <div class="dv2-session-badge"><div class="dv2-session-dot"></div>Session active</div>
      </div>

      <div class="dv2-player-action">
        ${primaryBlock}
      </div>

      <div class="dv2-player-hero">
        ${heroBlock}
      </div>

      ${_missionCardV2()}

      <div class="dv2-player-shortcuts">
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Navigation rapide</span>
          <div class="dv2-section-label-line"></div>
        </div>
        ${_shortcutsV2()}
      </div>

      <div class="dv2-player-adventure">
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Aventure</span>
          <div class="dv2-section-label-line"></div>
        </div>
        <div class="dv2-two-col">
          ${_groupsPanelV2()}
          ${_achievementsPanelV2()}
        </div>
      </div>

      ${bastionDoc ? `
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Bastion</span>
          <div class="dv2-section-label-line"></div>
        </div>
        ${_bastionCardV2()}
      </div>` : ''}`;
    }

    // ── Fonctionnalités désactivées : masquer les blocs + sections orphelines ──
    _hideDisabledDashboardBlocks(dash);

    // ── Navigation personnage ──────────────────────────────────────────

    // ── Toast RPG (injecter une seule fois) ───────────────────────────
    if (!document.getElementById('dv2-toast-container')) {
      const tc = document.createElement('div');
      tc.id = 'dv2-toast-container';
      tc.className = 'dv2-toast-container';
      document.body.appendChild(tc);
    }
    let _showRPGToast = (type = 'xp', title = '', sub = '', badge = '') => {
      const tc = document.getElementById('dv2-toast-container');
      if (!tc) return;
      const el = document.createElement('div');
      el.className = `dv2-toast dv2-toast-${type}`;
      const icons = { xp:'✨', gold:'💰', achievement:'🏆' };
      const cols  = { xp:'#c084fc', gold:'#f4c430', achievement:'#22c38e' };
      el.innerHTML = `<div class="dv2-toast-icon">${icons[type]||'✨'}</div><div class="dv2-toast-body"><div class="dv2-toast-title">${title}</div>${sub?`<div class="dv2-toast-sub">${sub}</div>`:''}</div>${badge?`<div class="dv2-toast-badge" style="color:${cols[type]||'#fff'}">${badge}</div>`:''}`;
      tc.appendChild(el);
      setTimeout(() => { el.classList.add('dv2-leaving'); setTimeout(() => el.remove(), 350); }, 3500);
    };

      // ── Largeurs de barres — à CHAQUE paint (le DOM est reconstruit) ──
      requestAnimationFrame(() => {
        document.querySelectorAll('.dv2-bar-fill[data-w], .dv2-mission-prog-fill[data-w]').forEach(el => {
          el.style.width = el.dataset.w;
        });
      });

      // ── Décor (animations d'entrée + particules) : UNE SEULE FOIS ──────
      // (sinon re-flash à chaque re-rendu réactif)
      if (!_dashDecorated) {
        _dashDecorated = true;
        document.querySelectorAll('.dv2-root > *').forEach((el, i) => {
          el.style.opacity = '0';
          el.style.transform = 'translateY(16px)';
          setTimeout(() => {
            el.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.22,1,0.36,1)';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
          }, i * 60);
        });
        const _pcols = ['rgba(79,140,255,0.6)', 'rgba(157,111,255,0.5)', 'rgba(34,195,142,0.4)'];
        for (let i = 0; i < 12; i++) {
          const p = document.createElement('div');
          p.className = 'dv2-particle';
          const sz = 1 + Math.random() * 2;
          p.style.cssText = `left:${Math.random()*100}%;background:${_pcols[i%3]};width:${sz}px;height:${sz}px;animation-duration:${8+Math.random()*12}s;animation-delay:${Math.random()*10}s;--drift:${(Math.random()-.5)*80}px`;
          document.body.appendChild(p);
        }
      }
    }; // ── fin paint() ────────────────────────────────────────────────────

    // Coalescing : plusieurs sources qui arrivent dans la même frame → 1 paint.
    const schedulePaint = () => {
      if (_paintQueued) return;
      _paintQueued = true;
      requestAnimationFrame(paint);
    };

    // ── Rendu initial (cache / squelette) puis abonnements réactifs ────────
    // Les watch()/watchDoc() se branchent sur les listeners session-live
    // (0 lecture facturée en plus) ou lazy-priment à la demande ; tous nettoyés
    // par unwatchAll() à la navigation. Le 1er snapshot cache vide est ignoré
    // côté firestore (gate trustworthy) → pas de flash "0" figé.
    paint();
    watch('dash-characters',   'characters',   d => { allChars        = sortCharactersForDisplay(d || []); schedulePaint(); });
    watch('dash-quests',       'quests',       d => { quests          = d || []; schedulePaint(); });
    watch('dash-story',        'story',        d => { storyItems      = d || []; schedulePaint(); });
    watch('dash-achievements', 'achievements', d => { achievementsRaw = d || []; schedulePaint(); });
    watch('dash-collection',   'collection',   d => { collectionItems = d || []; schedulePaint(); });
    watchDoc('dash-bastion',   'bastion',        'main', d => { bastionDoc  = d; schedulePaint(); });
    watchDoc('dash-agenda',    'agenda_session', 'next', d => { nextSession = d; schedulePaint(); });
  },

  // ─── CHARACTERS ─────────────────────────────────────────────────────────────
  async characters() {
    const uid   = STATE.isAdmin ? null : STATE.user.uid;
    const chars = sortCharactersForDisplay(await loadChars(uid));
    STATE.characters = chars;
    const content = document.getElementById('main-content');
    // V3 : page-header standard (titre comme les autres pages) + shell de la fiche.
    let html = `${pageHeaderHtml(STATE.isAdmin ? '📜 Tous les Personnages' : '📜 Mes Personnages', 'Gérez vos fiches de personnage')}`;
    if (STATE.isAdmin && chars.length > 0) {
      const byUser = {};
      chars.forEach(c => { if (!byUser[c.ownerPseudo]) byUser[c.ownerPseudo] = []; byUser[c.ownerPseudo].push(c); });
      html += `<div class="admin-section" style="margin-bottom:.6rem">
        <div class="admin-label" style="font-size:.7rem;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:.4rem">Filtre admin :</div>
        <div class="char-select-bar" id="admin-player-filter" style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="cs-admin-filter active" data-pseudo="" data-action="filterAdminChars">Tous</button>
          ${Object.keys(byUser).map(p => `<button type="button" class="cs-admin-filter" data-pseudo="${_esc(p)}" data-action="filterAdminChars">${_esc(p)} <span style="opacity:.5">·${byUser[p].length}</span></button>`).join('')}
        </div>
      </div>`;
    }
    if (chars.length === 0) {
      html += emptyStateHtml('📜', 'Aucun personnage. Crée ton premier héros !')
        + `<div style="margin-bottom:1.5rem"><button class="char-pill-new" data-action="createNewChar">+ Nouveau personnage</button></div>`;
    } else {
      html += `<div id="char-sheet-area"></div>`;
    }
    content.innerHTML = html;
    if (chars.length > 0) {
      const targetId  = consumeTargetCharacter();
      // Sélection par défaut : la cible explicite (VTT…), sinon le perso favori
      // (★ par défaut) du joueur, sinon le premier.
      const charToShow = (targetId ? chars.find(c => c.id === targetId) : null)
        || getDefaultCharForUser(chars, STATE.user?.uid)
        || chars[0];
      STATE.activeChar = charToShow;
      renderCharSheet(charToShow);
    }

    // La collection personnages est déjà session-live : cet abonnement ne
    // crée pas de lecture supplémentaire. Il permet notamment d’afficher sans
    // rechargement un objet envoyé depuis le VTT.
    let previousChars = chars;
    watch("characters-live", "characters", data => {
      if (STATE.currentPage !== "characters") return;
      const nextChars = sortCharactersForDisplay(STATE.isAdmin ? (data || []) : (data || []).filter(c => c.uid === STATE.user.uid));
      const activeId = charSession.getCurrentChar()?.id || STATE.activeChar?.id;
      const previousActive = previousChars.find(c => c.id === activeId);
      const nextActive = nextChars.find(c => c.id === activeId);
      STATE.characters = nextChars;
      for (const c of nextChars) {
        if (c.uid !== STATE.user?.uid) continue;
        const previousInv = previousChars.find(old => old.id === c.id)?.inventaire || [];
        const currentInv = c.inventaire || [];
        if (currentInv.length <= previousInv.length) continue;
        const labels = currentInv.slice(previousInv.length).map(item => item?.nom || "Objet").join(", ");
        showNotif("📦 Inventaire de " + (c.nom || "votre personnage") + " mis à jour : " + labels, "success");
      }
      previousChars = nextChars;
      if (!nextActive) return;
      STATE.activeChar = nextActive;
      const inventoryChanged = JSON.stringify(previousActive?.inventaire || []) !== JSON.stringify(nextActive.inventaire || []);
      if (inventoryChanged && charSession.getCurrentCharTab() === "inv") {
        renderCharSheet(nextActive, "inv");
      }
    });
  },

  // ─── SHOP ───────────────────────────────────────────────────────────────────
  async shop() {
    const { renderShop } = await import('./shop.js');
    await renderShop();
  },

  // ─── MAP ────────────────────────────────────────────────────────────────────
  async map() {
    const doc     = await getDocData('world', 'map');
    const content = document.getElementById('main-content');

    // La page map prend toute la hauteur dispo ; navigation.js nettoie ces styles inline en quittant la page.
    content.style.padding = '0';
    content.style.height  = 'calc(100vh - var(--header-height))';

    content.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <!-- Barre titre -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:0.6rem 1.2rem;
        background:var(--bg-panel);border-bottom:1px solid var(--border-strong);
        flex-shrink:0;gap:1rem;
      ">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <span style="font-family:'Cinzel',serif;font-size:0.9rem;color:var(--gold)">
            🗺️ ${doc?.regionName || 'Carte de la Région'}
          </span>
          <span style="font-size:0.72rem;color:var(--text-dim)">Molette pour zoomer · Cliquer-glisser pour naviguer</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem" id="map-legend"></div>
      </div>
      <!-- Conteneur carte -->
      <div id="map-container" style="flex:1;position:relative;overflow:hidden;min-height:0"></div>
    </div>`;

    // Import et init carte interactive
    const { initMap, LIEU_TYPES } = await import('./map.js');
    await initMap(document.getElementById('map-container'));

    // Légende
    const legend = document.getElementById('map-legend');
    if (legend) {
      legend.innerHTML = LIEU_TYPES.map(t => `
        <span style="display:flex;align-items:center;gap:4px;font-size:0.72rem;color:var(--text-dim)">
          <span style="width:8px;height:8px;border-radius:50%;background:${t.color};display:inline-block;flex-shrink:0"></span>
          ${t.label}
        </span>`).join('');
    }
  },

// ─── BASTION ────────────────────────────────────────────────────────────────
  async bastion() {
    const { default: renderBastionPage } = await import('./bastion.js');
    await renderBastionPage();
  },

  // ─── ACHIEVEMENTS ───────────────────────────────────────────────────────────
  async achievements() {
    // Shell uniquement — le contenu est délégué à achievements.js (_achRenderContent)
    const achState = PAGES._achievementsShellState || { items: [], filter: 'all', view: 'galerie', search: '' };
    const allItems = achState.items.length ? achState.items : await loadCollection('achievements');
    // Les joueurs ne doivent rien voir des HF secrets, y compris dans les compteurs
    const items = STATE.isAdmin ? allItems : allItems.filter(a => !a.secret);
    const content = document.getElementById('main-content');

    const CATS = [
      { id: 'epique',   label: 'Épique',   emoji: '⚔️',  color: '#4f8cff' },
      { id: 'comique',  label: 'Comique',  emoji: '🎭',  color: '#e8b84b' },
      { id: 'histoire', label: 'Histoire', emoji: '📖',  color: '#22c38e' },
    ];
    const byCat = { epique: 0, comique: 0, histoire: 0 };
    items.forEach(a => { const c = a.categorie || 'epique'; if (c in byCat) byCat[c]++; });
    const total        = items.length;
    const activeFilter = achState.filter ?? 'all';
    const activeView   = achState.view   ?? 'galerie';

    content.innerHTML = `<div class="hall-root">
    <div class="hall-hero">
      <div class="hall-eyebrow"></div>
      <h1 class="hall-title">✦ Hauts-Faits ✦</h1>
      <p class="hall-sub">Les exploits de la compagnie, consignés pour l'éternité.</p>
      <div class="hall-counters">
        <div class="hall-counter${activeFilter === 'all' ? ' active' : ''}" style="--c:#7eb0ff" data-filter="all" data-action="_achSetFilter" data-val="all">
          <div class="hall-counter-icon">🏆</div>
          <div class="hall-counter-info"><div class="hall-counter-num">${total}</div><div class="hall-counter-lbl">Total</div></div>
        </div>
        ${CATS.map(c => `
        <div class="hall-counter${activeFilter === c.id ? ' active' : ''}" style="--c:${c.color}" data-filter="${c.id}" data-action="_achSetFilter" data-val="${c.id}">
          <div class="hall-counter-icon">${c.emoji}</div>
          <div class="hall-counter-info"><div class="hall-counter-num">${byCat[c.id] || 0}</div><div class="hall-counter-lbl">${c.label}</div></div>
        </div>`).join('')}
      </div>
    </div>
    <div class="controls-bar">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="view-toggle">
          <button class="view-tab${activeView !== 'timeline' ? ' active' : ''}" data-action="_achSetView" data-val="galerie">▦ Galerie</button>
          <button class="view-tab${activeView === 'timeline' ? ' active' : ''}" data-action="_achSetView" data-val="timeline">⋮ Chronologie</button>
        </div>
        ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" data-action="openAchievementModal">+ Ajouter</button>` : ''}
      </div>
      <div class="search-wrap">
        <span style="color:var(--text-dim);font-size:.85rem">⌕</span>
        <input type="text" placeholder="Rechercher…" id="ach-search-input"
          value="${_esc(achState.search || '')}"
          data-input="_achSetSearch">
      </div>
    </div>
    <div class="hall-content">
      <div id="ach-content">${appSplashHtml('')}</div>
    </div>
    </div>`;
  },

  // ─── COLLECTION ─────────────────────────────────────────────────────────────
  async collection() {
    const { renderCollectionPage } = await import('./collection.js');
    await renderCollectionPage();
  },

  // ─── ADMIN ──────────────────────────────────────────────────────────────────
  async admin() {
    if (!STATE.isAdmin) { const { navigate } = await import('../core/navigation.js'); navigate('dashboard'); return; }
    const users   = await loadAllUsers(STATE.adventure);
    const content = document.getElementById('main-content');

    // Réglages du jeu : seules fonctions propres à cette page (le reste — boutique,
    // trame, PNJ… — est déjà accessible via la navigation, d'où la suppression des
    // « actions rapides » redondantes). Chaque tuile ouvre sa modale (lazy CSS+JS).
    const SETTINGS = [
      { g:'combat', ic:'⚔️', t:"Formats d'arme",     s:'Physique / magique par format',   a:'#ff8b6b', fn:'openWeaponFormatsAdmin', mod:'characters' },
      { g:'combat', ic:'⚡', t:'Types de dégâts',     s:'Éléments, résistances, couleurs', a:'#f4c430', fn:'openDamageTypesAdmin',   mod:'characters' },
      { g:'combat', ic:'🗡️', t:'Styles de combat',    s:"Bonus selon l'arme équipée",      a:'#9d8cff', fn:'openCombatStylesAdmin',  mod:'characters' },
      { g:'combat', ic:'🔮', t:'Matrices de sorts',   s:'Runes, noyaux, combinaisons',     a:'#bca0ff', fn:'openSpellMatricesAdmin', mod:'characters' },
      { g:'table',  ic:'🎲', t:'Compétences de dés',  s:'Jets personnalisés',              a:'#4f8cff', fn:'_ouvrirGestionDes',      mod:'histoire' },
      { g:'table',  ic:'😄', t:'Émotes VTT',          s:'Réactions sur la table',          a:'#22c38e', fn:'_ouvrirGestionEmotes',   mod:'vtt/vtt' },
      { g:'table',  ic:'🎭', t:'États & conditions',  s:'Effets appliqués aux tokens',     a:'#f97316', fn:'_vttConditionConfig',    mod:'vtt/vtt' },
    ];
    const tile = (x) => `
      <button class="adm-tile" style="--a:${x.a}" data-action="_adminLazyOpen" data-fn="${x.fn}" data-module="${x.mod}" title="${_esc(x.t)}">
        <span class="adm-tile-ic">${x.ic}</span>
        <span class="adm-tile-txt"><span class="adm-tile-t">${_esc(x.t)}</span><span class="adm-tile-s">${_esc(x.s)}</span></span>
        <span class="adm-tile-arrow">→</span>
      </button>`;
    const grid = (g) => `<div class="adm-tiles">${SETTINGS.filter(x => x.g === g).map(tile).join('')}</div>`;

    const sortedUsers = [...users].sort((a, b) => (a.pseudo || '').localeCompare(b.pseudo || '', 'fr'));
    const pRow = (u) => {
      const initial = ((u.pseudo || '?').trim().charAt(0) || '?').toUpperCase();
      const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr') : '—';
      return `
        <div class="adm-prow">
          <span class="adm-pav">${_esc(initial)}</span>
          <span class="adm-pmeta">
            <span class="adm-pname">${_esc(u.pseudo || '-')}</span>
            <span class="adm-pmail">${_esc(u.email || '-')}</span>
          </span>
          <span class="adm-pdate">${date}</span>
        </div>`;
    };

    content.innerHTML = `
      ${pageHeaderHtml('⚙️ Console MJ', "Réglages du jeu & joueurs de l'aventure")}
      <section class="adm-block">
        <div class="adm-label">⚔️ Personnages &amp; combat</div>
        ${grid('combat')}
      </section>
      <section class="adm-block">
        <div class="adm-label">🎲 Table &amp; VTT</div>
        ${grid('table')}
      </section>
      <section class="adm-block">
        <div class="adm-label">👥 Joueurs inscrits <span class="adm-count">${users.length}</span></div>
        <div class="adm-players adm-players--grid">${sortedUsers.map(pRow).join('')}</div>
      </section>`;
  },

  // ─── STATISTIQUES ─────────────────────────────────────────────────────────────
  async statistiques() {
    const content = document.getElementById('main-content');
    content.innerHTML = `${pageHeaderHtml('📊 Statistiques', 'Jets, réussites et exploits de la table')}
      <div id="stats-root" class="stats-root">${loadingHtml('Chargement des statistiques…')}</div>`;
    const [data, emoteDoc, chars] = await Promise.all([
      loadStats(),
      getDocData('world', 'vtt_emotes').catch(() => null),
      // Charge les persos (avec leur portrait) pour les afficher à côté du nom.
      loadChars().catch(() => null),
    ]);
    if (Array.isArray(chars) && chars.length) STATE.characters = chars;
    _statsData = data;
    _statsEmoteUrl = new Map((emoteDoc?.emotes || []).filter(e => e?.name && e?.url).map(e => [e.name, e.url]));
    _statsScope = null;
    _statsRender(null);
  },

};

async function goToChar(id) {
  setTargetCharacter(id);
  const { navigate } = await import('../core/navigation.js');
  navigate('characters');
}

registerActions({
  // Dashboard
  _goToChar:             (btn) => goToChar(btn.dataset.id),
  openAdventureSwitcher: ()    => openAdventureSwitcher(),

  // Statistiques : réinitialisation (MJ)
  _statsReset: async () => {
    if (!STATE.isAdmin) return;
    const ok = await confirmModal('Remettre TOUTES les statistiques de l\'aventure à zéro ? (irréversible)', {
      title: '↺ Réinitialiser les statistiques', confirmLabel: 'Tout effacer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    const done = await resetStats();
    showNotif(done ? 'Statistiques réinitialisées.' : 'Échec de la réinitialisation.', done ? 'success' : 'error');
    if (done) PAGES.statistiques();
  },
  _statsDelChar: async (btn) => {
    if (!STATE.isAdmin) return;
    const id = btn.dataset.id; if (!id) return;
    const name = btn.closest('.stats-char')?.querySelector('.stats-char-name')?.textContent || 'ce personnage';
    const ok = await confirmModal(`Supprimer les statistiques de <b>${_esc(name)}</b> ? (utile pour des jets de test)`, {
      title: '✕ Supprimer les stats du personnage', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    const done = await deleteCharStats(id);
    showNotif(done ? 'Statistiques du personnage supprimées.' : 'Échec de la suppression.', done ? 'success' : 'error');
    if (done) PAGES.statistiques();
  },
  // Stats d'un personnage séance par séance (date) — lit le doc déjà chargé.
  _statsCharDates: (btn) => {
    const id = btn.dataset.id; if (!id) return;
    const c = _statsData?.chars?.[id]; if (!c) return;
    const byDate = c.byDate || {};
    const dates = Object.keys(byDate).sort().reverse();
    const fmt = (d) => { const [y, m, da] = d.split('-'); return `${da}/${m}/${y}`; };
    const body = dates.length ? dates.map((d) => {
      const e = byDate[d] || {};
      const grid = _statsCombatGrid(_statsNormCombat(e.combat), { topSpell: _statsTop(e.spells), topEmote: _statsTop(e.emotes) });
      const skills = Object.entries(e.skills || {}).map(([sk, v]) => ({ sk, rolls: _statsNum(v?.rolls), crits: _statsNum(v?.crits), fumbles: _statsNum(v?.fumbles) }))
        .filter(s => s.rolls > 0).sort((a, b) => b.rolls - a.rolls);
      const skillLine = skills.length
        ? `<div class="stats-date-skills">🎲 ${skills.map(s => `${_esc(s.sk)} ×${s.rolls}${s.crits ? ` 💥${s.crits}` : ''}${s.fumbles ? ` 💔${s.fumbles}` : ''}`).join(' · ')}</div>`
        : '';
      return `<div class="stats-date">
        <div class="stats-date-hd">📅 ${fmt(d)}</div>
        ${grid}
        ${skillLine || (grid ? '' : '<div class="stats-date-skills" style="opacity:.5">Aucune action ce jour.</div>')}
      </div>`;
    }).join('') : '<div class="stats-empty">Aucune séance enregistrée.</div>';
    openModal(`📅 ${_esc(c.name || 'Personnage')} — par séance`, `<div class="stats-dates">${body}</div>`);
  },
  // Changement de scope (campagne entière ↔ une séance) — re-rend sans relecture.
  _statsScope: (el) => { _statsRender(el.value || null); },
  // Export : copie le récap texte du scope courant (collable dans Discord…).
  _statsExport: async () => {
    if (!_statsLastSummary) return;
    try {
      await navigator.clipboard.writeText(_statsLastSummary);
      showNotif('Récap copié dans le presse-papier.', 'success');
    } catch {
      // Fallback si clipboard indisponible (contexte non sécurisé) → affiche dans une modale.
      openModal('📋 Récap des statistiques', `<textarea class="stats-export-ta" readonly>${_esc(_statsLastSummary)}</textarea>`);
    }
  },

  // Admin lazy-load tools
  _adminLazyOpen:        async (btn) => {
    const fn  = btn.dataset.fn;
    const mod = btn.dataset.module;
    // Les modales admin empruntent les styles de leur feature d'origine → on
    // charge la feuille correspondante AVANT d'ouvrir (sinon modale sans style).
    const cssPage = { 'characters': 'characters', 'histoire': 'histoire', 'vtt/vtt': 'vtt' }[mod];
    if (cssPage) {
      try { const { _ensureFeatureCss } = await import('../core/navigation.js'); await _ensureFeatureCss(cssPage); } catch {}
    }
    if (window[fn]) { window[fn](); return; }
    await import(`./${mod}.js`);
    if (window[fn]) { window[fn](); return; }
    const proxy = document.createElement('button');
    proxy.dataset.action = fn;
    dispatchAction(proxy, new Event('click'));
  },
});

export default PAGES;
