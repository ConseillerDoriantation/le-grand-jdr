// ══════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { registerActions, dispatchAction } from '../core/actions.js';
import { loadChars, loadCollection, getCachedCollection, getDocData, saveDoc, updateInCol, deleteFromCol } from '../data/firestore.js';
import { _esc, _norm, appSplashHtml, pageHeaderHtml, loadingHtml} from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { isFeatureEnabled } from '../shared/features.js';
import { calcPalier, calcPVMax, calcPMMax, calcCA, calcOr, getDefaultCharForUser, sortCharactersForDisplay } from '../shared/char-stats.js';
import { loadStats, resetStats, deleteCharStats, deleteDateStats, deleteMissionStats, setSessionMission } from '../shared/stats.js';
import { showNotif } from '../shared/notifications.js';
import { confirmModal, openModal, promptModal, closeModalDirect } from '../shared/modal.js';
import { watch, watchDoc } from '../shared/realtime.js';
import { setDashboardPartyChars, setDashboardQuests } from '../shared/dashboard-session.js';
import { setTargetCharacter, consumeTargetCharacter } from '../shared/character-navigation.js';
import { characterAvatarHtml, characterPortraitContent } from '../shared/portraits.js';
import { dedupeQuestParticipants, questParticipantFromChar } from '../shared/participants.js';

import { charSession } from '../shared/char-session.js';
import { openAdventureSwitcher } from '../core/layout.js';
import { loadAllUsers, relinkPlayerAccount } from '../core/adventure.js';
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
let _statsPlayerSel = null;            // Set d'ids ciblés (null = tous les joueurs)
let _statsGroupSel = null;             // Set de groupes ciblés pour une mission (null = tous)
let _statsGroupMissionId = '';         // mission associée au filtre groupes
let _statsHiddenAwards = new Set();    // distinctions masquées localement par l'utilisateur
let _statsVisualSummary = null;        // données du dernier rendu pour export image
let _statsCmpMetric = 'dmgDealt';      // métrique du graphique comparatif (par perso)
let _statsCmpType   = 'bars';          // type du comparatif : 'bars' | 'pie'
let _statsEvoMetric = 'dmgDealt';      // métrique du graphique d'évolution (par séance)
let _statsQuests    = [];              // groupes de mission (collection quests) pour libellés/portraits
let _statsStory     = [];              // missions de la Trame pour ordre/titres du sélecteur stats

// Avatar (rond) d'un perso par id — devant son nom dans les chips/graphiques.
const _statsAvatar = (id, name, size = 18) =>
  characterAvatarHtml(STATE.characters?.find(x => x.id === id) || { nom: name }, { size, className: 'stats-av-xs', title: name });
// Mission d'une séance (libellé MJ), ou '' si non renseignée.
const _statsMissionOf = (dateKey) => (dateKey && _statsData?.sessions?.[dateKey]?.mission) || '';
const _statsGroupOf   = (dateKey) => {
  const session = dateKey ? _statsData?.sessions?.[dateKey] : null;
  if (!session) return '';
  const current = session.groupId ? (_statsQuests || []).find(q => q.id === session.groupId) : null;
  if (current) return _statsGroupName(current);
  const group = session.group || '';
  return (group && group !== 'Groupe') ? group : '';
};
// Dates liées à une mission (via sessions.{date}.missionId).
const _statsMissionDates = (mid) => Object.entries(_statsData?.sessions || {}).filter(([, s]) => s?.missionId === mid).map(([dk]) => dk);
const _statsGroupKeyOf = (dateKey) => {
  const session = dateKey ? _statsData?.sessions?.[dateKey] : null;
  if (!session) return '__nogroup';
  if (session.groupId) return `id:${session.groupId}`;
  const group = _statsGroupOf(dateKey);
  return group ? `name:${_norm(group)}` : '__nogroup';
};
// Missions distinctes ayant ≥1 séance liée (pour la frise).
function _statsStoryOrderCompare(a = {}, b = {}) {
  const ao = Number.isFinite(Number(a.ordre)) ? Number(a.ordre) : Number.MAX_SAFE_INTEGER;
  const bo = Number.isFinite(Number(b.ordre)) ? Number(b.ordre) : Number.MAX_SAFE_INTEGER;
  return (a.acte || '').localeCompare(b.acte || '', 'fr')
    || ao - bo
    || (a.date || '').localeCompare(b.date || '', 'fr')
    || (a.titre || a.name || '').localeCompare(b.titre || b.name || '', 'fr');
}
function _statsMissionList() {
  const sessionNames = new Map();
  for (const s of Object.values(_statsData?.sessions || {})) {
    if (s?.missionId && !sessionNames.has(s.missionId)) sessionNames.set(s.missionId, s.mission || 'Mission');
  }
  const storyById = new Map((_statsStory || []).map(m => [m.id, m]));
  return [...sessionNames.entries()]
    .map(([id, name]) => {
      const story = storyById.get(id);
      return { id, name: story?.titre || name, story };
    })
    .sort((a, b) => {
      if (a.story && b.story) return _statsStoryOrderCompare(a.story, b.story);
      if (a.story) return -1;
      if (b.story) return 1;
      return a.name.localeCompare(b.name, 'fr');
    });
}
function _statsGroupName(g = {}, idx = 0) {
  return (g.titre || g.nom || g.name || '').trim() || `Groupe ${idx + 1}`;
}
function _statsGroupsForMission(story = [], quests = [], missionId = '') {
  const linked = (quests || [])
    .filter(q => q?.missionId === missionId)
    .sort((a, b) => (_statsGroupName(a)).localeCompare(_statsGroupName(b), 'fr'));
  if (linked.length) return linked;
  const legacyGroups = (story || []).find(x => x.id === missionId)?.groupes || [];
  return Array.isArray(legacyGroups) ? legacyGroups : [];
}
function _statsGroupMembersHtml(g = {}) {
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const parts = dedupeQuestParticipants(g.participants || []);
  if (!parts.length) return `<span class="stats-mp-empty-members">Aucun membre</span>`;
  return parts.map(p => {
    const char = p.charId ? charById.get(p.charId) : null;
    const avatarData = char || p;
    return characterAvatarHtml(avatarData, {
      size: 24,
      className: 'stats-mp-avatar',
      title: avatarData.nom || p.nom || '?',
      border: '1px solid rgba(255,255,255,.12)',
      background: 'rgba(79,140,255,.16)',
    });
  }).join('');
}
function _statsGroupMembersMiniHtml(g = {}) {
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const parts = dedupeQuestParticipants(g.participants || []);
  return parts.slice(0, 5).map(p => {
    const char = p.charId ? charById.get(p.charId) : null;
    const avatarData = char || p;
    return characterAvatarHtml(avatarData, {
      size: 18,
      className: 'stats-chip-group-avatar',
      title: avatarData.nom || p.nom || '?',
      border: '1px solid rgba(255,255,255,.16)',
      background: 'rgba(79,140,255,.16)',
    });
  }).join('');
}
function _statsGroupOptionsForDates(dates = []) {
  const map = new Map();
  dates.forEach(d => {
    const session = _statsData?.sessions?.[d] || {};
    const key = _statsGroupKeyOf(d);
    const label = _statsGroupOf(d) || 'Sans groupe';
    const current = map.get(key) || { key, label, groupId: session.groupId || '', count: 0, dates: [] };
    current.count += 1;
    current.dates.push(d);
    if (!current.groupId && session.groupId) current.groupId = session.groupId;
    map.set(key, current);
  });
  return [...map.values()].map(g => ({
    ...g,
    quest: g.groupId ? (_statsQuests || []).find(q => q.id === g.groupId) : null,
  })).sort((a, b) => {
    if (a.key === '__nogroup') return 1;
    if (b.key === '__nogroup') return -1;
    return a.label.localeCompare(b.label, 'fr');
  });
}
// Étape 2 du sélecteur : choisir le GROUPE de la mission ayant joué la séance.
function _statsGroupStep(dk, mid, mission, groupes) {
  const curG = _statsData?.sessions?.[dk]?.groupId || '';
  const opt = (g, idx, active) => {
    const gid = g.id || '';
    const name = _statsGroupName(g, idx);
    return (
    `<button type="button" class="stats-mp-opt${active ? ' active' : ''}"
      data-action="_statsPickGroup" data-scope="${dk}" data-mission-id="${_esc(mid)}" data-mission="${_esc(mission)}" data-group-id="${_esc(gid)}" data-group="${_esc(name)}">
      <span class="stats-mp-ico">👥</span>
      <span class="stats-mp-body">
        <span class="stats-mp-tt">${_esc(name)}</span>
        <span class="stats-mp-members">${_statsGroupMembersHtml(g)}</span>
      </span>
      ${active ? '<span class="stats-mp-check">✓</span>' : ''}</button>`
    );
  };
  openModal(`🎯 ${_esc(mission)}`, `
    <div class="stats-mp">
      <div class="stats-mp-hint">Quel groupe a joué cette séance ?</div>
      <div class="stats-mp-list">
        <button type="button" class="stats-mp-opt stats-mp-none${!curG ? ' active' : ''}" data-action="_statsPickGroup" data-scope="${dk}" data-mission-id="${_esc(mid)}" data-mission="${_esc(mission)}" data-group-id="" data-group=""><span class="stats-mp-ico">—</span><span class="stats-mp-tt">Sans groupe précis</span></button>
        ${groupes.map((g, idx) => opt(g, idx, g.id === curG)).join('')}
      </div>
    </div>`, { subtitle: 'Groupe de la mission', accent: '#4f8cff' });
}

// Métriques graphables : clé → { libellé, couleur }. La valeur se lit sur la
// ligne (combat, ou sRolls pour les jets de compétence).
const _STATS_METRICS = {
  dmgDealt:   { lbl: 'Dégâts infligés',     color: '#c9b6ff' },
  attacks:    { lbl: 'Attaques',            color: '#ff9d7a' },
  heal:       { lbl: 'Soin prodigué',       color: '#4fd3a6' },
  spellsCast: { lbl: 'Sorts lancés',        color: '#bca0ff' },
  tacticalSpells: { lbl: 'Sorts tactiques', color: '#d8c7ff' },
  supportSpells: { lbl: 'Soutien',          color: '#4fd3a6' },
  afflictionSpells: { lbl: 'Afflictions',   color: '#c084fc' },
  kosDealt:   { lbl: 'KO infligés',         color: '#ef4444' },
  dmgTaken:   { lbl: 'Dégâts subis',        color: '#9aa0aa' },
  attacksTaken: { lbl: 'Attaques subies',   color: '#a7b4c4' },
  attacksAvoided: { lbl: 'Attaques évitées', color: '#7fb0ff' },
  rolls:      { lbl: 'Jets de compétence',  color: '#7fb0ff' },
};
const _statsMetricVal = (r, key) => key === 'rolls' ? r.sRolls : (r.combat[key] || 0);
const _STATS_AWARD_PREF_KEY = 'lgj.stats.hiddenAwards';
const _STATS_AWARD_CATALOG = [
  ['dmg', 'Plus gros frappeur'],
  ['bigHit', 'Plus gros coup'],
  ['hitRate', 'Meilleur taux'],
  ['ko', 'Bourreau'],
  ['heal', 'Plus grand soigneur'],
  ['mage', 'Lanceur le + actif'],
  ['tank', "L'Increvable"],
  ['emotes', 'Le Bavard'],
  ['rolls', 'Le Joueur'],
  ['fumble', 'Le plus malchanceux'],
];

const _statsNum = (v) => Number(v) || 0;
function _statsEmoteHtml(name, cls = 'stats-emote') {
  if (!name) return '—';
  const url = _statsEmoteUrl.get(name);
  return url ? `<img class="${cls}" src="${url}" alt="${_esc(name)}" title="${_esc(name)}">` : _esc(name);
}
function _statsLoadAwardPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(_STATS_AWARD_PREF_KEY) || '[]');
    _statsHiddenAwards = new Set(Array.isArray(raw) ? raw : []);
  } catch { _statsHiddenAwards = new Set(); }
}
function _statsSaveAwardPrefs() {
  try { localStorage.setItem(_STATS_AWARD_PREF_KEY, JSON.stringify([..._statsHiddenAwards])); } catch {}
}

async function _adminRelinkPlayer(oldUid, newUid, name = '') {
  if (!STATE.adventure?.id || !oldUid || !newUid || oldUid === newUid) {
    showNotif('Aventure ou joueur introuvable.', 'error');
    return;
  }
  const ok = await confirmModal(
    `Réassocier automatiquement <b>${_esc(name || newUid)}</b> ?<br><br><span style="opacity:.8;font-size:.88em">Cette action transfère l'accès à l'aventure et les personnages de l'ancien compte détecté vers ce compte.</span>`,
    { title: 'Réassocier le joueur', confirmLabel: 'Réassocier', danger: false, icon: '🔗' }
  );
  if (!ok) return;
  try {
    const { migrated } = await relinkPlayerAccount(STATE.adventure.id, oldUid, newUid);
    showNotif(`Compte réassocié — ${migrated} personnage(s) transféré(s).`, 'success');
    await PAGES.admin();
  } catch (e) {
    showNotif(e.message || 'Échec de la réassociation.', 'error');
  }
}

async function _adminRepairQuestParticipants() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(
    `Réparer les participants de quête quand c'est sûr ?<br><br><span style="opacity:.8;font-size:.88em">Remplace les anciens UID relinkés, recale les participants sur l'UID de leur personnage, retire les entrées sans compte/personnage exploitable et dédoublonne.</span>`,
    { title: 'Réparer les quêtes', confirmLabel: 'Réparer', danger: false, icon: '📌' }
  ).catch(() => false);
  if (!ok) return;

  const adv = STATE.adventure || {};
  const memberUids = new Set([...(adv.accessList || []), ...(adv.players || []), ...(adv.admins || [])]);
  const accountRelinks = adv.accountRelinks || {};
  const absorbedUids = new Set(Object.keys(accountRelinks));
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const quests = getCachedCollection('quests') || await loadCollection('quests').catch(() => []);
  let fixed = 0;

  for (const q of quests || []) {
    const before = Array.isArray(q?.participants) ? q.participants : [];
    if (!q?.id || !before.length) continue;
    const normalized = [];
    for (const raw of before) {
      const p = raw || {};
      const char = p.charId ? charById.get(p.charId) : null;
      let uid = accountRelinks[p.uid] || p.uid || '';
      if (char?.uid) uid = char.uid;
      if (!uid || absorbedUids.has(uid) || !memberUids.has(uid)) continue;
      if (p.charId && !char) continue;
      normalized.push(char
        ? questParticipantFromChar(char, uid)
        : { ...p, uid, nom: p.nom || '?' });
    }
    const after = dedupeQuestParticipants(normalized);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    await saveDoc('quests', q.id, { participants: after });
    fixed++;
  }

  showNotif(fixed ? `${fixed} groupe(s) de quête réparé(s).` : 'Aucune quête à réparer.', fixed ? 'success' : 'info');
  await PAGES.admin();
}

async function _adminRepairVttData() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(
    `Réparer les données VTT sûres ?<br><br><span style="opacity:.8;font-size:.88em">Resynchronise les propriétaires de tokens avec les personnages, retire les délégations vers des comptes invalides et supprime les doublons de tokens en réserve.</span>`,
    { title: 'Réparer le VTT', confirmLabel: 'Réparer', danger: false, icon: '🎲' }
  ).catch(() => false);
  if (!ok) return;

  const adv = STATE.adventure || {};
  const memberUids = new Set([...(adv.accessList || []), ...(adv.players || []), ...(adv.admins || [])]);
  const absorbedUids = new Set(Object.keys(adv.accountRelinks || {}));
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const tokens = await loadCollection('vttTokens').catch(() => []);
  const reserveSeen = new Map();
  const toDelete = [];
  const updates = [];

  for (const t of tokens || []) {
    if (!t?.id) continue;
    const patch = {};
    if (t.characterId) {
      const char = charById.get(t.characterId);
      if (char && (t.ownerId || null) !== (char.uid || null)) patch.ownerId = char.uid || null;
    }
    if (Array.isArray(t.controlDelegates)) {
      const next = [...new Set(t.controlDelegates.filter(uid => uid && memberUids.has(uid) && !absorbedUids.has(uid)))];
      if (JSON.stringify(next) !== JSON.stringify(t.controlDelegates)) patch.controlDelegates = next;
    }
    const reserveKey = t.characterId ? `c:${t.characterId}` : t.npcId ? `n:${t.npcId}` : '';
    if (reserveKey && !t.pageId) {
      if (reserveSeen.has(reserveKey)) toDelete.push(t.id);
      else reserveSeen.set(reserveKey, t.id);
    }
    if (Object.keys(patch).length) updates.push({ id: t.id, patch });
  }

  await Promise.all([
    ...updates.map(x => updateInCol('vttTokens', x.id, x.patch)),
    ...toDelete.map(id => deleteFromCol('vttTokens', id)),
  ]);
  const total = updates.length + toDelete.length;
  showNotif(total ? `${total} correction(s) VTT appliquée(s).` : 'Aucune donnée VTT à réparer.', total ? 'success' : 'info');
  await PAGES.admin();
}

function _statsNormCombat(cm = {}) {
  const n = _statsNum;
  return {
    attacks: n(cm.attacks), hits: n(cm.hits), crits: n(cm.crits), fumbles: n(cm.fumbles),
    dmgDealt: n(cm.dmgDealt), dmgTaken: n(cm.dmgTaken), kosDealt: n(cm.kosDealt), kosTaken: n(cm.kosTaken),
    attacksTaken: n(cm.attacksTaken), attacksAvoided: n(cm.attacksAvoided),
    spellsCast: n(cm.spellsCast), tacticalSpells: n(cm.tacticalSpells), supportSpells: n(cm.supportSpells), afflictionSpells: n(cm.afflictionSpells),
    pmSpent: n(cm.pmSpent), heal: n(cm.heal),
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
  if (cm.attacksTaken > 0) row('🧱', 'Attaques subies', cm.attacksTaken);
  if (cm.attacksAvoided > 0) row('🛡️', 'Attaques évitées', cm.attacksAvoided);
  if (cm.biggestTaken > 0) row('🩸', 'Plus gros coup reçu', cm.biggestTaken);
  if (cm.kosDealt > 0)     row('☠️', 'KO infligés', cm.kosDealt);
  if (cm.kosTaken > 0)     row('💀', 'Fois mis KO', cm.kosTaken);
  if (cm.spellsCast > 0)   row('🔮', 'Sorts lancés', cm.spellsCast);
  if (cm.tacticalSpells > 0) row('✨', 'Sorts tactiques', cm.tacticalSpells);
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

// Sélecteur de métrique (comparatif / évolution) — data-change → re-render.
function _statsMetricSelect(cur, action) {
  return `<select class="stats-chart-sel" data-change="${action}">
    ${Object.entries(_STATS_METRICS).map(([k, m]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${m.lbl}</option>`).join('')}</select>`;
}

// Graphique en barres horizontales : compare les personnages (portrait + nom).
function _statsBarChart(rows, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  const data = rows.map(r => ({ id: r.id, name: r.name, v: _statsMetricVal(r, key) }))
    .filter(d => d.v > 0).sort((a, b) => b.v - a.v).slice(0, 12);
  if (!data.length) return `<div class="stats-chart-empty">Aucune donnée pour « ${m.lbl} ».</div>`;
  const max = Math.max(...data.map(d => d.v));
  return `<div class="stats-bars">${data.map(d => `
    <div class="stats-bar-row">
      <span class="stats-bar-name" title="${_esc(d.name)}">${_statsAvatar(d.id, d.name, 18)}<span>${_esc(d.name)}</span></span>
      <span class="stats-bar-track"><span style="width:${Math.max(3, Math.round(d.v / max * 100))}%;background:${m.color}"></span></span>
      <span class="stats-bar-val" style="color:${m.color}">${d.v}</span>
    </div>`).join('')}</div>`;
}
function _statsGroupMetricChart(groups, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  const val = (g) => key === 'rolls' ? g.skills.rolls : (g.combat[key] || 0);
  const data = groups.map(g => ({ name: g.label, v: val(g), count: g.count, quest: g.quest }))
    .filter(d => d.v > 0).sort((a, b) => b.v - a.v);
  if (!data.length) return `<div class="stats-chart-empty">Aucune donnée de groupe pour « ${m.lbl} ».</div>`;
  const max = Math.max(...data.map(d => d.v));
  return `<div class="stats-bars stats-bars-groups">${data.map(d => `
    <div class="stats-bar-row stats-bar-row-group">
      <span class="stats-bar-name stats-bar-name-group" title="${_esc(d.name)}"><span>${_esc(d.name)}</span><small>${d.count} séance${d.count > 1 ? 's' : ''}</small></span>
      <span class="stats-bar-track"><span style="width:${Math.max(3, Math.round(d.v / max * 100))}%;background:${m.color}"></span></span>
      <span class="stats-bar-val" style="color:${m.color}">${d.v}</span>
    </div>`).join('')}</div>`;
}

// Camembert (donut SVG + légende) : répartition d'une métrique entre persos.
// Anneau à segments arrondis espacés (padAngle), total au centre, ombre douce.
function _statsPieChart(rows, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  let data = rows.map(r => ({ id: r.id, name: r.name, v: _statsMetricVal(r, key) }))
    .filter(d => d.v > 0).sort((a, b) => b.v - a.v);
  if (!data.length) return `<div class="stats-chart-empty">Aucune donnée pour « ${m.lbl} ».</div>`;
  const total = data.reduce((s, d) => s + d.v, 0);
  if (data.length > 7) { const rest = data.slice(6); data = data.slice(0, 6).concat([{ name: 'Autres', v: rest.reduce((s, d) => s + d.v, 0) }]); }
  const palette = ['#a78bfa', '#ff9d7a', '#22c38e', '#4f8cff', '#f4c430', '#ef4444', '#5fd0c8'];
  const cx = 60, cy = 60, R = 46, TW = 16, GAP = 0.09;   // ring radius / épaisseur / espace
  let ang = -Math.PI / 2;
  const arcs = data.map((s, i) => {
    const frac = s.v / total, sweep = frac * 2 * Math.PI;
    const a1 = ang, a2 = ang + sweep; ang = a2;
    const g = Math.min(GAP, sweep * 0.5);
    const b1 = a1 + g / 2, b2 = a2 - g / 2;
    const x1 = cx + R * Math.cos(b1), y1 = cy + R * Math.sin(b1), x2 = cx + R * Math.cos(b2), y2 = cy + R * Math.sin(b2);
    const large = (b2 - b1) > Math.PI ? 1 : 0;
    const col = palette[i % palette.length];
    const seg = frac >= 0.999
      ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="${TW}"/>`
      : `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${TW}" stroke-linecap="round"/>`;
    return { seg, col, s, pct: Math.round(frac * 100) };
  });
  const firstWord = (m.lbl || '').split(' ')[0];
  const svg = `<svg viewBox="0 0 120 120" class="stats-pie-svg" role="img">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--bg-dark)" stroke-width="${TW}"/>
    ${arcs.map(a => `<g class="stats-pie-seg"><title>${_esc(a.s.name)} · ${a.s.v} (${a.pct}%)</title>${a.seg}</g>`).join('')}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" dominant-baseline="central" class="stats-pie-total">${total}</text>
    <text x="${cx}" y="${cy + 11}" text-anchor="middle" dominant-baseline="central" class="stats-pie-sub">${_esc(firstWord)}</text>
  </svg>`;
  const legend = `<div class="stats-pie-legend">${arcs.map(a => `<div class="stats-pie-li"><span class="stats-pie-dot" style="background:${a.col}"></span><span class="stats-pie-nm" title="${_esc(a.s.name)}">${_esc(a.s.name)}</span><span class="stats-pie-vl">${a.pct}%</span></div>`).join('')}</div>`;
  return `<div class="stats-pie">${svg}${legend}</div>`;
}

// Série d'évolution : valeur de la métrique par séance (dates ascendantes),
// sommée sur les joueurs ciblés (selSet null/vide = tous).
function _statsEvoSeries(datesAsc, key, selSet) {
  const num = _statsNum;
  return datesAsc.map(d => {
    let v = 0;
    for (const [id, c] of Object.entries(_statsData?.chars || {})) {
      if (selSet && selSet.size && !selSet.has(id)) continue;
      const src = c.byDate?.[d]; if (!src) continue;
      if (key === 'rolls') v += Object.values(src.skills || {}).reduce((s, x) => s + num(x.rolls), 0);
      else v += num(_statsNormCombat(src.combat)[key]);
    }
    return { d, v };
  });
}

// Graphique en colonnes (barres verticales, bas → haut) : évolution par séance.
function _statsColChart(series, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  const max = Math.max(1, ...series.map(s => s.v));
  return `<div class="stats-cols">${series.map(s => `
    <div class="stats-col" title="${_statsFmtDate(s.d)} · ${s.v}">
      <span class="stats-col-v">${s.v || ''}</span>
      <span class="stats-col-bar"><span style="height:${s.v ? Math.max(3, Math.round(s.v / max * 100)) : 0}%;background:${m.color}"></span></span>
      <span class="stats-col-lbl">${_statsFmtDate(s.d).slice(0, 5)}</span>
    </div>`).join('')}</div>`;
}

// Somme les miroirs byDate d'un perso sur un ensemble de dates → même forme
// que le total campagne (combat/skills/spells/emotes).
function _statsSumByDates(c, dates) {
  const acc = {};
  for (const dk of dates) {
    const bd = c?.byDate?.[dk]; if (!bd) continue;
    for (const [grp, obj] of Object.entries(bd)) {
      if (!obj || typeof obj !== 'object') continue;
      const a = (acc[grp] ??= {});
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number') a[k] = (a[k] || 0) + v;
        else if (v && typeof v === 'object') { const a2 = (a[k] ??= {}); for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number') a2[k2] = (a2[k2] || 0) + v2; }
      }
    }
  }
  return acc;
}

// Construit les lignes/cartes de stats pour un scope. `dateKeys` : null = campagne
// (totaux) ; sinon tableau de dates → somme des séances (une ou une mission entière).
function _statsRowsFor(dateKeys) {
  const num = _statsNum;
  return Object.entries(_statsData?.chars || {}).map(([id, c]) => {
    const src = dateKeys ? _statsSumByDates(c, dateKeys) : c;   // même forme : combat/skills/spells/emotes
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
function _statsAggregateRows(rows = []) {
  const combat = rows.reduce((g, r) => {
    for (const k in g) g[k] += (r.combat[k] || 0);
    return g;
  }, {
    attacks: 0, hits: 0, crits: 0, fumbles: 0,
    dmgDealt: 0, dmgTaken: 0, kosDealt: 0, kosTaken: 0,
    attacksTaken: 0, attacksAvoided: 0,
    spellsCast: 0, tacticalSpells: 0, supportSpells: 0, afflictionSpells: 0,
    pmSpent: 0, heal: 0, biggestHit: 0, biggestTaken: 0
  });
  combat.biggestHit = Math.max(0, ...rows.map(r => r.combat.biggestHit || 0));
  combat.biggestTaken = Math.max(0, ...rows.map(r => r.combat.biggestTaken || 0));
  const skills = rows.reduce((g, r) => {
    g.rolls += r.sRolls;
    g.crits += r.sCrits;
    g.fumbles += r.sFumbles;
    return g;
  }, { rolls: 0, crits: 0, fumbles: 0 });
  const hitRate = combat.attacks ? Math.round(combat.hits / combat.attacks * 100) : 0;
  return { combat, skills, hitRate };
}

// Mini-palmarès top 5 (sorts / compétences / émotes). render(label) → html (défaut _esc).
function _statsPodium(title, entries, render, opts = {}) {
  const ranks = ['🥇', '🥈', '🥉', '4', '5'];
  const rdr = render || ((l) => _esc(l));
  const labelOf = (e) => Array.isArray(e) ? e[0] : e?.n;
  const countOf = (e) => Array.isArray(e) ? e[1] : e?.c;
  const body = entries.length
    ? entries.slice(0, 5).map((e, i) => {
      const label = labelOf(e);
      const meta = opts.meta ? opts.meta(e, i) : '';
      return `<div class="stats-pod-row">
        <span class="stats-pod-rank${i > 2 ? ' stats-pod-rank-num' : ''}">${ranks[i]}</span>
        <span class="stats-pod-main"><span class="stats-pod-name">${rdr(label)}</span>${meta}</span>
        <span class="stats-pod-n">×${countOf(e) || 0}</span>
      </div>`;
    }).join('')
    : '<div class="stats-pod-empty">—</div>';
  return `<div class="stats-pod"><div class="stats-pod-title">${title}</div>${body}</div>`;
}

// Rendu complet de la page pour un scope (réutilisé au changement de séance).
function _statsRender(scope) {
  _statsScope = scope || null;
  const root = document.getElementById('stats-root');
  if (!root) return;
  // Scope : null (campagne) · 'YYYY-MM-DD' (une séance) · 'mission:{id}' (mission entière).
  const isMission = typeof scope === 'string' && scope.startsWith('mission:');
  const missionId = isMission ? scope.slice(8) : '';
  const dateKey   = (scope && !isMission) ? scope : null;
  const missions  = _statsMissionList();
  const allDates = [...new Set(Object.values(_statsData?.chars || {}).flatMap(c => Object.keys(c.byDate || {})))].sort().reverse();

  // Sélecteur hiérarchique : campagne/mission d'abord, séances ensuite.
  const currentSession = dateKey ? (_statsData?.sessions?.[dateKey] || {}) : null;
  const selectedMissionId = isMission ? missionId : (currentSession?.missionId || '');
  const selectedMission = selectedMissionId ? missions.find(m => m.id === selectedMissionId) : null;
  const missionName = isMission ? (selectedMission?.name || 'Mission') : '';
  const selectedMissionDates = selectedMissionId ? _statsMissionDates(selectedMissionId).sort().reverse() : [];
  const groupOptions = selectedMissionId ? _statsGroupOptionsForDates(dateKey ? [dateKey] : selectedMissionDates) : [];
  if (_statsGroupMissionId !== selectedMissionId) {
    _statsGroupMissionId = selectedMissionId;
    _statsGroupSel = null;
  }
  if (_statsGroupSel && groupOptions.length) {
    const validGroups = new Set(groupOptions.map(g => g.key));
    _statsGroupSel = new Set([..._statsGroupSel].filter(k => validGroups.has(k)));
    if (!_statsGroupSel.size) _statsGroupSel = null;
  }
  if (!selectedMissionId || !groupOptions.length) _statsGroupSel = null;
  const filteredMissionDates = (_statsGroupSel && _statsGroupSel.size)
    ? selectedMissionDates.filter(d => _statsGroupSel.has(_statsGroupKeyOf(d)))
    : selectedMissionDates;
  const displayedMissionDates = (_statsGroupSel && _statsGroupSel.size) ? filteredMissionDates : selectedMissionDates;
  const scopeDates = isMission ? filteredMissionDates : (dateKey ? [dateKey] : null);

  const allRows = _statsRowsFor(scopeDates);   // participants du scope courant
  // Filtre « joueurs ciblés » : recalcule toute la page sur le sous-ensemble choisi.
  const sel = _statsPlayerSel;
  const rows = (sel && sel.size) ? allRows.filter(r => sel.has(r.id)) : allRows;
  const missionGroupOptions = isMission && selectedMissionId ? _statsGroupOptionsForDates(selectedMissionDates) : [];
  const groupCompareOptions = isMission && missionGroupOptions.length > 1
    ? missionGroupOptions.filter(g => !_statsGroupSel || !_statsGroupSel.size || _statsGroupSel.has(g.key))
    : [];
  const groupCompare = groupCompareOptions.map(g => {
    const rawRows = _statsRowsFor(g.dates);
    const groupRows = (sel && sel.size) ? rawRows.filter(r => sel.has(r.id)) : rawRows;
    const agg = _statsAggregateRows(groupRows);
    const active = groupRows.length || agg.combat.attacks || agg.skills.rolls;
    return { ...g, rows: groupRows, ...agg, active };
  }).filter(g => g.active);

  const unlinkedDates = allDates.filter(d => !_statsData?.sessions?.[d]?.missionId);
  const showUnlinkedDates = !selectedMissionId && unlinkedDates.length > 0;
  const scopeChip = (val, label, active, sub = '', cls = '') =>
    `<button class="stats-chip ${cls}${active ? ' active' : ''}" data-action="_statsSetScope" data-scope="${val}"${sub ? ` title="${_esc(sub)}"` : ''}>
      <span class="stats-chip-date">${label}</span>${sub ? `<span class="stats-chip-mission">${_esc(sub)}</span>` : ''}
    </button>`;
  const missionDatesBar = selectedMissionId ? `<div class="stats-chips stats-sessions stats-sessions--dates">
    <span class="stats-chips-lbl">Séances</span>
    ${scopeChip('mission:' + selectedMissionId, 'Toute la mission', isMission && missionId === selectedMissionId, selectedMission?.name || '', 'stats-chip-session')}
    ${displayedMissionDates.map(d => scopeChip(d, `📅 ${_statsFmtDate(d).slice(0, 5)}`, d === dateKey, _statsGroupOf(d), 'stats-chip-session')).join('')}
  </div>` : showUnlinkedDates ? `<div class="stats-chips stats-sessions stats-sessions--dates">
    <span class="stats-chips-lbl">Sans mission</span>
    ${scopeChip('', 'Toute la campagne', !scope, '', 'stats-chip-session')}
    ${unlinkedDates.map(d => scopeChip(d, `📅 ${_statsFmtDate(d).slice(0, 5)}`, d === dateKey, 'Non reliée', 'stats-chip-session')).join('')}
  </div>` : '';
  const groupsBar = selectedMissionId && groupOptions.length && (dateKey || groupOptions.length > 1) ? `<div class="stats-chips stats-groups">
    <span class="stats-chips-lbl">Groupes</span>
    ${!dateKey && groupOptions.length > 1 ? `<button class="stats-chip${!_statsGroupSel || !_statsGroupSel.size ? ' active' : ''}" data-action="_statsToggleGroup" data-group-key="__all">Tous</button>` : ''}
    ${groupOptions.map(g => `<button class="stats-chip stats-chip-group${dateKey || _statsGroupSel?.has(g.key) ? ' active' : ''}" data-action="_statsToggleGroup" data-group-key="${_esc(g.key)}" title="${_esc(g.label)} · ${g.count} séance${g.count > 1 ? 's' : ''}">
      <span class="stats-chip-group-main"><span>${_esc(g.label)}</span><small>${g.count}</small></span>
      ${g.quest ? `<span class="stats-chip-group-members">${_statsGroupMembersMiniHtml(g.quest)}</span>` : ''}
    </button>`).join('')}
  </div>` : '';
  const missionSelect = `<label class="stats-scope-select-wrap">
    <span class="stats-chips-lbl">Mission</span>
    <select class="stats-scope-select" data-change="_statsScope">
      <option value=""${!selectedMissionId && !dateKey ? ' selected' : ''}>Toute la campagne</option>
      ${missions.map(m => `<option value="mission:${_esc(m.id)}"${selectedMissionId === m.id ? ' selected' : ''}>🎯 ${_esc(m.name)} (${_statsMissionDates(m.id).length})</option>`).join('')}
    </select>
  </label>`;
  const sessionsBar = `<div class="stats-scope-panel">
    ${missionSelect}
    ${groupsBar}
    ${missionDatesBar}
  </div>`;
  const activeGroupNames = (_statsGroupSel && _statsGroupSel.size)
    ? groupOptions.filter(g => _statsGroupSel.has(g.key)).map(g => g.label)
    : [];
  const groupScopeText = activeGroupNames.length ? activeGroupNames.join(', ') : '';

  // Chips « joueurs ciblés » : uniquement les participants du scope (portrait + nom).
  const playersBar = allRows.length ? `<div class="stats-chips stats-players">
    <span class="stats-chips-lbl">Joueurs</span>
    <button class="stats-chip${!sel || !sel.size ? ' active' : ''}" data-action="_statsTogglePlayer" data-id="__all">Tous</button>
    ${allRows.map(r => `<button class="stats-chip stats-chip-player${sel && sel.has(r.id) ? ' active' : ''}" data-action="_statsTogglePlayer" data-id="${r.id}">${_statsAvatar(r.id, r.name, 18)}<span>${_esc(r.name)}</span></button>`).join('')}
  </div>` : '';

  const viewPills = [];
  if (selectedMissionId) viewPills.push(`🎯 ${_esc(selectedMission?.name || missionName || 'Mission')}`);
  else viewPills.push('🌍 Toute la campagne');
  if (dateKey) viewPills.push(`📅 ${_statsFmtDate(dateKey)}`);
  else if (isMission) viewPills.push(`📅 ${scopeDates.length} séance${scopeDates.length > 1 ? 's' : ''}`);
  if (groupScopeText) viewPills.push(`👥 ${_esc(groupScopeText)}`);
  if (sel && sel.size) viewPills.push(`🧑 ${rows.length}/${allRows.length} joueur${rows.length > 1 ? 's' : ''}`);
  const filtersActive = !!scope || !!(sel && sel.size) || !!(_statsGroupSel && _statsGroupSel.size);
  const activeView = `<div class="stats-active-view">
    <span class="stats-active-label">Vue actuelle</span>
    <span class="stats-active-pills">${viewPills.map(p => `<span>${p}</span>`).join('')}</span>
    ${filtersActive ? '<button class="stats-active-reset" data-action="_statsResetFilters">Réinitialiser</button>' : ''}
  </div>`;

  const exportBtn = rows.length ? `<button class="stats-tool-btn" data-action="_statsExport" title="Copier un récap texte (Discord…)">📋 Copier le récap</button>` : '';
  const visualBtn = rows.length ? `<button class="stats-tool-btn" data-action="_statsExportImage" title="Télécharger un récap visuel PNG">🖼️ Récap visuel</button>` : '';
  const manageBtn = STATE.isAdmin ? `<button class="stats-tool-btn" data-action="_statsManage" title="Relier les séances aux missions · supprimer des données">⚙ Gérer les données</button>` : '';
  const controls = `<div class="stats-controls">
    <div class="stats-controls-top">${sessionsBar}<div class="stats-toolbar-actions">${exportBtn}${visualBtn}${manageBtn}</div></div>
    ${activeView}
    ${playersBar}
  </div>`;

  // Bannière : séance (mission + groupe, éditable MJ) OU mission (agrégée).
  const partsHtml = allRows.map(r => `<span class="stats-sb-part" title="${_esc(r.name)}">${_statsAvatar(r.id, r.name, 30)}</span>`).join('');
  const sessionBanner = dateKey ? (() => {
    const mission = _statsMissionOf(dateKey), group = _statsGroupOf(dateKey);
    // Lien mission/groupe : bouton EXPLICITE (le ✎ discret n'était pas trouvé).
    const linkBtn = STATE.isAdmin
      ? (mission
          ? `<button class="stats-sb-edit" data-action="_statsEditMission" data-scope="${dateKey}" title="Modifier le lien mission / groupe">✎ Modifier</button>`
          : `<button class="stats-sb-link" data-action="_statsEditMission" data-scope="${dateKey}">🔗 Relier à une mission / un groupe</button>`)
      : '';
    const missLine = mission
      ? `🎯 ${_esc(mission)}${group ? ` <span class="stats-sb-group">· 👥 ${_esc(group)}</span>` : ''} ${linkBtn}`
      : (linkBtn || '<span class="stats-sb-none">Mission non renseignée</span>');
    return `<div class="stats-session-banner">
      <div class="stats-sb-info">
        <div class="stats-sb-date">📅 Séance du ${_statsFmtDate(dateKey)}</div>
        <div class="stats-sb-mission">${missLine}</div>
      </div>
      ${partsHtml ? `<div class="stats-sb-parts" title="Participants">${partsHtml}</div>` : ''}
    </div>`;
  })() : isMission ? `<div class="stats-session-banner">
      <div class="stats-sb-info">
        <div class="stats-sb-date">🎯 Mission — ${scopeDates.length} séance${scopeDates.length > 1 ? 's' : ''} agrégée${scopeDates.length > 1 ? 's' : ''}</div>
        <div class="stats-sb-mission">${_esc(missionName)}${groupScopeText ? ` <span class="stats-sb-group">· 👥 ${_esc(groupScopeText)}</span>` : ''}</div>
      </div>
      ${partsHtml ? `<div class="stats-sb-parts" title="Participants">${partsHtml}</div>` : ''}
    </div>` : '';

  if (!rows.length) {
    _statsLastSummary = '';
    _statsVisualSummary = null;
    const why = (sel && sel.size) ? 'les joueurs ciblés'
      : dateKey ? `la séance du ${_statsFmtDate(dateKey)}`
      : isMission ? `la mission « ${missionName} »` : 'le moment';
    root.innerHTML = `${controls}<div class="stats-empty">Aucune statistique pour ${why}.<br>
      <span>Ajuste la vue ou les joueurs ciblés ci-dessus.</span></div>`;
    return;
  }

  // Agrégats du scope
  const aggregate = _statsAggregateRows(rows);
  const GC = aggregate.combat;
  const GS = aggregate.skills;
  const hitRate = aggregate.hitRate;
  const tally = (key) => { const m = {}; rows.forEach(r => r[key].forEach(x => { m[x.n] = (m[x.n] || 0) + x.c; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const spellTallyWithCaster = () => {
    const map = new Map();
    rows.forEach(r => r.spells.forEach(sp => {
      if (!sp?.n || !sp.c) return;
      const cur = map.get(sp.n) || { n: sp.n, c: 0, casters: new Map() };
      cur.c += sp.c;
      cur.casters.set(r.id, (cur.casters.get(r.id) || 0) + sp.c);
      map.set(sp.n, cur);
    }));
    return [...map.values()].sort((a, b) => b.c - a.c).map(sp => {
      const casters = [...sp.casters.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => {
        const row = rows.find(r => r.id === id);
        return row ? { id: row.id, name: row.name, count } : null;
      }).filter(Boolean);
      return { n: sp.n, c: sp.c, casters, caster: casters[0] || null };
    });
  };
  const skillAgg = {};
  rows.forEach(r => r.perSkill.forEach(s => { (skillAgg[s.sk] ??= 0); skillAgg[s.sk] += s.rolls; }));
  const skillTally = Object.entries(skillAgg).sort((a, b) => b[1] - a[1]);
  const topSkill = skillTally[0];
  const spellTally = spellTallyWithCaster(), emoteTally = tally('emotes');

  const best = (key) => [...rows].filter(r => r.combat[key] > 0).sort((a, b) => b.combat[key] - a.combat[key])[0];
  const topDmg = best('dmgDealt'), topKo = best('kosDealt'), topHeal = best('heal'), topBig = best('biggestHit'), topTank = best('dmgTaken'), topMage = best('spellsCast');
  const topHit = [...rows].filter(r => r.combat.attacks >= 3).map(r => ({ ...r, hr: Math.round(r.combat.hits / r.combat.attacks * 100) })).sort((a, b) => b.hr - a.hr)[0];
  const topFumble = [...rows].map(r => ({ ...r, tf: r.combat.fumbles + r.sFumbles })).filter(r => r.tf > 0).sort((a, b) => b.tf - a.tf)[0];
  const topEmoter = [...rows].filter(r => r.emoteTotal > 0).sort((a, b) => b.emoteTotal - a.emoteTotal)[0];
  const topRoller = [...rows].filter(r => r.sRolls > 0).sort((a, b) => b.sRolls - a.sRolls)[0];
  const impactBreakdown = (r) => {
    const cm = r.combat || {};
    const tactical = cm.tacticalSpells || 0;
    const plainCasts = Math.max(0, (cm.spellsCast || 0) - tactical);
    const entries = [];
    const add = (label, count, points, icon) => {
      if (!count || !points) return;
      entries.push({ label, count, points, icon });
    };
    add('Dégâts infligés', cm.dmgDealt, cm.dmgDealt, '🗡️');
    add('Soin prodigué', cm.heal, cm.heal * 1.15, '💚');
    add('KO infligés', cm.kosDealt, cm.kosDealt * 12, '☠️');
    add('Sorts classiques', plainCasts, plainCasts * 3, '🔮');
    add('Sorts tactiques', tactical, tactical * 5, '✨');
    add('Soutien', cm.supportSpells, cm.supportSpells * 3, '🛡️');
    add('Afflictions', cm.afflictionSpells, cm.afflictionSpells * 3, '💀');
    add('Jets de compétence', r.sRolls, r.sRolls * 2, '🎲');
    add('Critiques', (cm.crits || 0) + (r.sCrits || 0), ((cm.crits || 0) + (r.sCrits || 0)) * 6, '💥');
    add('Ciblages encaissés', cm.attacksTaken, cm.attacksTaken * 3, '🧱');
    add('Attaques évitées', cm.attacksAvoided, cm.attacksAvoided * 4, '🛡️');
    add('Dégâts encaissés', cm.dmgTaken, cm.dmgTaken * 0.35, '🩸');
    add('KO subis', cm.kosTaken, cm.kosTaken * -8, '💀');
    add('Échecs critiques', (cm.fumbles || 0) + (r.sFumbles || 0), ((cm.fumbles || 0) + (r.sFumbles || 0)) * -3, '💔');
    const raw = entries.reduce((sum, e) => sum + e.points, 0);
    return {
      entries,
      gained: entries.filter(e => e.points > 0).reduce((sum, e) => sum + e.points, 0),
      lost: Math.abs(entries.filter(e => e.points < 0).reduce((sum, e) => sum + e.points, 0)),
      score: Math.round(raw),
    };
  };
  const impactRows = [...rows]
    .map(r => {
      const impactDetails = impactBreakdown(r);
      return { ...r, impact: impactDetails.score, impactDetails };
    })
    .filter(r => r.impact > 0)
    .sort((a, b) => (b.impact - a.impact) || String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  const topImpact = impactRows[0]?.impact || 0;
  const mvps = topImpact > 0 ? impactRows.filter(r => r.impact === topImpact) : [];
  const insightItems = [];
  if (groupCompare.length > 1) {
    const byDmg = [...groupCompare].sort((a, b) => b.combat.dmgDealt - a.combat.dmgDealt)[0];
    const byHeal = [...groupCompare].sort((a, b) => b.combat.heal - a.combat.heal)[0];
    const byRolls = [...groupCompare].sort((a, b) => b.skills.rolls - a.skills.rolls)[0];
    if (byDmg?.combat.dmgDealt) insightItems.push(`Le groupe <b>${_esc(byDmg.label)}</b> domine les dégâts (${byDmg.combat.dmgDealt}).`);
    if (byHeal?.combat.heal) insightItems.push(`<b>${_esc(byHeal.label)}</b> porte le soin (${byHeal.combat.heal} PV).`);
    if (byRolls?.skills.rolls) insightItems.push(`<b>${_esc(byRolls.label)}</b> joue le plus de compétences (${byRolls.skills.rolls} jets).`);
  }
  if (topDmg?.combat.dmgDealt) insightItems.push(`<b>${_esc(topDmg.name)}</b> a porté l'offensive (${topDmg.combat.dmgDealt} dégâts).`);
  if (topHeal?.combat.heal) insightItems.push(`<b>${_esc(topHeal.name)}</b> a stabilisé le groupe (${topHeal.combat.heal} PV soignés).`);
  if (GC.attacks >= 5) insightItems.push(`La table termine à <b>${hitRate}%</b> de réussite sur ${GC.attacks} attaques.`);

  const statCard = (ic, val, lbl, a) => `<div class="stats-kpi" style="--a:${a}"><span class="stats-kpi-ic">${ic}</span><span class="stats-kpi-val">${val}</span><span class="stats-kpi-lbl">${lbl}</span></div>`;
  // Award : renvoie { html, txt } pour mutualiser affichage et export.
  const awards = [];
  let awardTotal = 0;
  // Carte-trophée : icône + intitulé + gagnant · valeur, liseré coloré (--tc).
  const award = (id, ic, lbl, row, val, col) => { if (!row?.name) return ''; awardTotal += 1; if (_statsHiddenAwards.has(id)) return ''; awards.push(`${ic} ${lbl} : ${row.name} (${val})`);
    const char = STATE.characters?.find(x => x.id === row.id) || { nom: row.name };
    return `<div class="stats-trophy" style="--tc:${col}">
      <span class="stats-trophy-ic">${ic}</span>
      ${characterAvatarHtml(char, { size: 30, className: 'stats-trophy-av', title: row.name, border: '1px solid rgba(255,255,255,.12)', background: `${col}20`, color: col })}
      <div class="stats-trophy-tx">
        <span class="stats-trophy-lbl">${lbl}</span>
        <span class="stats-trophy-line"><span class="stats-trophy-who">${_esc(row.name)}</span><b>${val}</b></span>
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

  const combatTitle = dateKey ? `⚔️ Combat — séance du ${_statsFmtDate(dateKey)}`
    : isMission ? `⚔️ Combat — ${_esc(missionName)}` : '⚔️ Combat (table)';
  const awardsHtml = [
    award('dmg', '🏆', 'Plus gros frappeur', topDmg, `${topDmg?.combat.dmgDealt} dmg`, '#f4c430'),
    award('bigHit', '💢', 'Plus gros coup', topBig, `${topBig?.combat.biggestHit}`, '#ff8b6b'),
    award('hitRate', '🎯', 'Meilleur taux', topHit, topHit ? `${topHit.hr}%` : '', '#22c38e'),
    award('ko', '☠️', 'Bourreau', topKo, `${topKo?.combat.kosDealt} KO`, '#ef4444'),
    award('heal', '💚', 'Plus grand soigneur', topHeal, `${topHeal?.combat.heal} PV`, '#4fd3a6'),
    award('mage', '🧙', 'Lanceur le + actif', topMage, `${topMage?.combat.spellsCast} sorts`, '#bca0ff'),
    award('tank', '🪨', "L'Increvable", topTank, `${topTank?.combat.dmgTaken} dmg subis`, '#9aa0aa'),
    award('emotes', '💬', 'Le Bavard', topEmoter, `${topEmoter?.emoteTotal} émotes`, '#4f8cff'),
    award('rolls', '🎲', 'Le Joueur', topRoller, `${topRoller?.sRolls} jets`, '#7fb0ff'),
    award('fumble', '🤡', 'Le plus malchanceux', topFumble, `${topFumble?.tf} échec${topFumble?.tf > 1 ? 's' : ''}`, '#ff6b6b'),
  ].join('');

  // Récap texte (export) — construit à partir du scope courant.
  const scopeLabel = dateKey ? `séance du ${_statsFmtDate(dateKey)}`
    : isMission ? `mission « ${missionName} »${groupScopeText ? ` · groupes ${groupScopeText}` : ''}` : 'toute la campagne';
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
  const insightsSec = insightItems.length ? `
    <section class="stats-sec stats-insights-sec">
      <div class="stats-sec-hd">🧭 Lecture rapide</div>
      <div class="stats-insights">${insightItems.slice(0, 5).map(x => `<div class="stats-insight">${x}</div>`).join('')}</div>
    </section>` : '';
  const mvpSec = mvps.length ? (() => {
    const mvpParts = (leader) => {
      const parts = [];
      if (leader.combat.dmgDealt) parts.push(`🗡️ ${leader.combat.dmgDealt} dégâts`);
      if (leader.combat.heal) parts.push(`💚 ${leader.combat.heal} soin`);
      if (leader.combat.spellsCast) parts.push(`🔮 ${leader.combat.spellsCast} sorts`);
      if (leader.combat.tacticalSpells) parts.push(`✨ ${leader.combat.tacticalSpells} tactique`);
      if (leader.combat.supportSpells) parts.push(`🛡️ ${leader.combat.supportSpells} soutien`);
      if (leader.combat.afflictionSpells) parts.push(`💀 ${leader.combat.afflictionSpells} affliction`);
      if (leader.combat.attacksTaken) parts.push(`🧱 ${leader.combat.attacksTaken} ciblages`);
      if (leader.combat.attacksAvoided) parts.push(`🛡️ ${leader.combat.attacksAvoided} évitées`);
      if (leader.combat.dmgTaken) parts.push(`🩸 ${leader.combat.dmgTaken} subis`);
      if (leader.sRolls) parts.push(`🎲 ${leader.sRolls} jets`);
      if (leader.combat.kosDealt) parts.push(`☠️ ${leader.combat.kosDealt} KO`);
      if (leader.combat.kosTaken) parts.push(`💀 ${leader.combat.kosTaken} à terre`);
      return parts;
    };
    const parts = [];
    if (mvps.length === 1) parts.push(...mvpParts(mvps[0]));
    else mvps.forEach(leader => parts.push(`${_esc(leader.name)} · ${mvpParts(leader).slice(0, 3).join(' · ') || 'impact équilibré'}`));
    const title = mvps.length > 1 ? "MVP d'impact ex æquo" : "MVP d'impact";
    const leadersHtml = mvps.map(leader => `<div class="stats-mvp-leader">
      ${_statsAvatar(leader.id, leader.name, 42)}
      <div><span class="stats-mvp-eyebrow">${title}</span><b>${_esc(leader.name)}</b></div>
    </div>`).join('');
    const fmtPts = (v) => {
      const abs = Math.abs(v);
      const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace(/\.0$/, '');
      return `${v >= 0 ? '+' : '-'}${txt}`;
    };
    const calcHtml = mvps.map(leader => {
      const details = leader.impactDetails || { entries: [], gained: 0, lost: 0, score: leader.impact || 0 };
      const rowsHtml = details.entries.map(e => `<div class="stats-mvp-calc-row${e.points < 0 ? ' is-loss' : ''}">
        <span><b>${e.icon}</b>${_esc(e.label)} <small>×${e.count}</small></span>
        <strong>${fmtPts(e.points)}</strong>
      </div>`).join('');
      return `<div class="stats-mvp-calc">
        ${mvps.length > 1 ? `<div class="stats-mvp-calc-name">${_esc(leader.name)}</div>` : ''}
        <div class="stats-mvp-calc-total">
          <span>Gagnés <b>${fmtPts(details.gained)}</b></span>
          <span>Perdus <b>${details.lost ? fmtPts(-details.lost) : '0'}</b></span>
          <span>Net <b>${details.score}</b></span>
        </div>
        <div class="stats-mvp-calc-rows">${rowsHtml}</div>
      </div>`;
    }).join('');
    return `<section class="stats-sec stats-mvp-sec">
      <div class="stats-mvp-card">
        <div class="stats-mvp-id stats-mvp-id--multi">${leadersHtml}</div>
        <div class="stats-mvp-score">${topImpact}<span>score</span></div>
        <div class="stats-mvp-breakdown">${parts.slice(0, 5).map(p => `<span>${p}</span>`).join('')}</div>
        <div class="stats-mvp-calcs">${calcHtml}</div>
      </div>
    </section>`;
  })() : '';
  const groupMax = {
    dmg: Math.max(1, ...groupCompare.map(g => (g.combat.dmgDealt || 0) / Math.max(1, g.count))),
    heal: Math.max(1, ...groupCompare.map(g => (g.combat.heal || 0) / Math.max(1, g.count))),
    spells: Math.max(1, ...groupCompare.map(g => (g.combat.spellsCast || 0) / Math.max(1, g.count))),
    rolls: Math.max(1, ...groupCompare.map(g => (g.skills.rolls || 0) / Math.max(1, g.count))),
    hit: Math.max(1, ...groupCompare.map(g => g.hitRate || 0)),
  };
  const groupMetricLine = (ic, lbl, val, max, col, suffix = '', sessions = 1, normalize = true) => {
    const base = normalize ? (_statsNum(val) / Math.max(1, sessions)) : _statsNum(val);
    const avg = normalize && sessions > 1 ? `<small>${Number.isInteger(base) ? base : base.toFixed(1)}/séance</small>` : '';
    return `<div class="stats-group-metric" style="--gm:${col}">
    <span class="stats-group-metric-lbl"><span>${ic}</span>${lbl}</span>
    <span class="stats-group-metric-bar"><span style="width:${Math.max(3, Math.round((base / max) * 100))}%"></span></span>
    <b>${val}${suffix}${avg}</b>
  </div>`;
  };
  const groupSessionItem = (x) => `<div class="stats-group-session">
    <div class="stats-group-session-main">
      <span class="stats-time-date">📅 ${_statsFmtDate(x.d)}</span>
      <span class="stats-time-avatars">${x.rows.slice(0, 6).map(r => _statsAvatar(r.id, r.name, 18)).join('')}</span>
    </div>
    <div class="stats-time-metrics">
      <span>🗡️ ${x.combat.dmgDealt}</span>
      <span>💚 ${x.combat.heal}</span>
      <span>🔮 ${x.combat.spellsCast}</span>
      <span>🎲 ${x.skills.rolls}</span>
    </div>
  </div>`;
  const missionGroupsSec = groupCompare.length ? `
    <section class="stats-sec">
      <div class="stats-sec-hd">👥 Groupes & séances</div>
      <div class="stats-mission-groups">
        ${groupCompare.map(g => {
          const sessions = [...g.dates].sort().map(d => {
            const dateRowsRaw = _statsRowsFor([d]);
            const dateRows = (sel && sel.size) ? dateRowsRaw.filter(r => sel.has(r.id)) : dateRowsRaw;
            const agg = _statsAggregateRows(dateRows);
            return { d, rows: dateRows, ...agg };
          }).filter(x => x.rows.length || x.combat.attacks || x.skills.rolls);
          return `<div class="stats-group-card stats-group-card--merged">
            <div class="stats-group-hd">
              <div class="stats-group-title" title="${_esc(g.label)}">👥 ${_esc(g.label)}</div>
              <span class="stats-group-count">📅 ${g.count}</span>
            </div>
            <div class="stats-group-roster">
              <span class="stats-group-roster-lbl">Participants</span>
              <span class="stats-group-members">${g.quest ? _statsGroupMembersMiniHtml(g.quest) : g.rows.slice(0, 5).map(r => _statsAvatar(r.id, r.name, 18)).join('')}</span>
            </div>
            <div class="stats-group-metrics">
              ${groupMetricLine('🗡️', 'Dégâts', g.combat.dmgDealt, groupMax.dmg, '#c9b6ff', '', g.count)}
              ${groupMetricLine('💚', 'Soin', g.combat.heal, groupMax.heal, '#4fd3a6', '', g.count)}
              ${groupMetricLine('🔮', 'Sorts', g.combat.spellsCast, groupMax.spells, '#bca0ff', '', g.count)}
              ${groupMetricLine('🎲', 'Jets', g.skills.rolls, groupMax.rolls, '#7fb0ff', '', g.count)}
              ${groupMetricLine('🎯', 'Touche', g.hitRate, groupMax.hit, '#22c38e', '%', 1, false)}
            </div>
            ${sessions.length ? `<div class="stats-group-sessions"><div class="stats-group-subtitle">Séances jouées</div>${sessions.map(groupSessionItem).join('')}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </section>` : '';
  _statsVisualSummary = {
    scopeLabel,
    hitRate,
    metrics: [
      ['Attaques', GC.attacks, '#ff9d7a'],
      ['Dégâts', GC.dmgDealt, '#c9b6ff'],
      ['Sorts', GC.spellsCast, '#bca0ff'],
      ['Soin', GC.heal, '#4fd3a6'],
      ['Jets', GS.rolls, '#7fb0ff'],
    ],
    awards: awards.slice(0, 6),
    mvp: mvps.length ? { name: mvps.map(x => x.name).join(' & '), score: topImpact } : null,
    groups: groupCompare.slice(0, 4).map(g => ({
      label: g.label,
      dmg: g.combat.dmgDealt,
      heal: g.combat.heal,
      rolls: g.skills.rolls,
      sessions: g.count,
      dmgAvg: Math.round((g.combat.dmgDealt || 0) / Math.max(1, g.count)),
    })),
  };

  // ── Graphiques (SVG/HTML, sans dépendance) ──
  const cmpChart = _statsCmpType === 'pie' ? _statsPieChart(rows, _statsCmpMetric) : _statsBarChart(rows, _statsCmpMetric);
  const typeToggle = `<div class="stats-type-toggle">
    <button class="stats-tt${_statsCmpType === 'bars' ? ' active' : ''}" data-action="_statsCmpType" data-type="bars" title="Barres">📊</button>
    <button class="stats-tt${_statsCmpType === 'pie' ? ' active' : ''}" data-action="_statsCmpType" data-type="pie" title="Camembert">🥧</button>
  </div>`;
  const evoDatesAsc = (isMission ? [...filteredMissionDates].sort() : [...allDates].reverse());  // ancienne → récente
  const evoSeries = _statsEvoSeries(evoDatesAsc, _statsEvoMetric, _statsPlayerSel);
  const evoHasData = evoDatesAsc.length >= 2 && evoSeries.some(s => s.v > 0);
  const shouldCompareGroupsInChart = isMission && groupCompare.length > 1 && (!_statsGroupSel || !_statsGroupSel.size);
  const secondaryChartHtml = shouldCompareGroupsInChart
    ? `<div class="stats-chart-card">
        <div class="stats-chart-hd"><span>Comparatif — groupes</span>${_statsMetricSelect(_statsEvoMetric, '_statsEvoMetric')}</div>
        ${_statsGroupMetricChart(groupCompare, _statsEvoMetric)}
      </div>`
    : (evoDatesAsc.length >= 2 ? `<div class="stats-chart-card">
        <div class="stats-chart-hd"><span>${isMission ? 'Évolution du groupe' : 'Évolution par séance'}</span>${_statsMetricSelect(_statsEvoMetric, '_statsEvoMetric')}</div>
        ${evoHasData ? _statsColChart(evoSeries, _statsEvoMetric) : '<div class="stats-chart-empty">Pas assez de données comparables.</div>'}
      </div>` : '');
  const chartsHtml = `
    <section class="stats-sec">
      <div class="stats-sec-hd">📈 Graphiques</div>
      <div class="stats-charts">
        <div class="stats-chart-card">
          <div class="stats-chart-hd"><span>Comparatif — personnages</span><div class="stats-chart-ctrls">${typeToggle}${_statsMetricSelect(_statsCmpMetric, '_statsCmpMetric')}</div></div>
          ${cmpChart}
        </div>
        ${secondaryChartHtml}
      </div>
    </section>`;

  // ── Sections (recomposées en colonnes plus bas) ──
  const emoteTotal = rows.reduce((s, r) => s + r.emoteTotal, 0);
  const combatSec = `
    <section class="stats-sec">
      <div class="stats-sec-hd">${combatTitle}</div>
      <div class="stats-kpis">
        ${statCard('⚔️', GC.attacks, 'Attaques', '#ff9d7a')}
        ${statCard('🎯', `${hitRate}%`, 'Taux de réussite', '#22c38e')}
        ${statCard('🗡️', GC.dmgDealt, 'Dégâts infligés', '#c9b6ff')}
        ${statCard('💥', GC.crits, 'Réussites critiques', '#f4c430')}
        ${statCard('💔', GC.fumbles, 'Échecs critiques', '#ff6b6b')}
        ${statCard('🛡️', GC.dmgTaken, 'Dégâts subis', '#9aa0aa')}
        ${statCard('🧱', GC.attacksTaken, 'Attaques subies', '#a7b4c4')}
        ${statCard('🛡️', GC.attacksAvoided, 'Attaques évitées', '#7fb0ff')}
        ${statCard('☠️', GC.kosDealt, 'KO infligés', '#ef4444')}
        ${statCard('💀', GC.kosTaken, 'Fois mis KO', '#b06a6a')}
      </div>
    </section>`;
  const magicSec = `
    <section class="stats-sec">
      <div class="stats-sec-hd">🔮 Magie & soutien</div>
      <div class="stats-kpis">
        ${statCard('🔮', GC.spellsCast, 'Sorts lancés', '#bca0ff')}
        ${statCard('✨', GC.tacticalSpells, 'Sorts tactiques', '#d8c7ff')}
        ${statCard('🛡️', GC.supportSpells, 'Soutien appliqué', '#4fd3a6')}
        ${statCard('💀', GC.afflictionSpells, 'Afflictions appliquées', '#c084fc')}
        ${statCard('🔋', GC.pmSpent, 'PM dépensés', '#4f8cff')}
        ${statCard('💚', GC.heal, 'Soin prodigué', '#4fd3a6')}
        ${statCard('🧙', topMage ? _esc(topMage.name) : '—', 'Lanceur le + actif', '#bca0ff')}
      </div>
    </section>`;
  const competencesSec = `
    <section class="stats-sec">
      <div class="stats-sec-hd">🎲 Compétences & RP</div>
      <div class="stats-kpis">
        ${statCard('🎲', GS.rolls, 'Jets de compétence', '#4f8cff')}
        ${statCard('💥', GS.crits, 'Réussites critiques', '#22c38e')}
        ${statCard('💔', GS.fumbles, 'Échecs critiques', '#ff6b6b')}
        ${statCard('💬', emoteTotal, 'Émotes utilisées', '#4f8cff')}
        ${statCard('🏅', topSkill ? _esc(topSkill[0]) : '—', 'Compétence la + jouée', '#f4c430')}
      </div>
    </section>`;
  const distinctionsSec = awardTotal ? `
    <section class="stats-sec">
      <div class="stats-sec-hd stats-sec-hd-tools"><span>🏆 Distinctions</span><button class="stats-sec-tool" data-action="_statsAwardsConfig" title="Choisir les distinctions affichées">⚙</button></div>
      ${awardsHtml ? `<div class="stats-trophies">${awardsHtml}</div>` : '<div class="stats-empty-inline">Toutes les distinctions disponibles sont masquées.</div>'}
    </section>` : '';
  const palmaresSec = (spellTally.length || emoteTally.length || skillTally.length) ? `
    <section class="stats-sec">
      <div class="stats-sec-hd">🏅 Palmarès</div>
      <div class="stats-podiums">
        ${_statsPodium('🔮 Sorts les + lancés', spellTally, null, {
          meta: (e) => e.caster ? `<span class="stats-pod-caster" title="${_esc((e.casters || []).map(c => `${c.name} ×${c.count}`).join(' · '))}">
            <span class="stats-pod-caster-avatars">${(e.casters || []).slice(0, 4).map(c => _statsAvatar(c.id, c.name, 18)).join('')}${(e.casters || []).length > 4 ? `<span class="stats-pod-more">+${(e.casters || []).length - 4}</span>` : ''}</span>
            <span>${_esc(e.caster.name)}${(e.casters || []).length > 1 ? ` +${(e.casters || []).length - 1}` : ''}</span>${e.caster.count !== e.c ? `<small>×${e.caster.count}</small>` : ''}
          </span>` : ''
        })}
        ${_statsPodium('🎲 Compétences les + jouées', skillTally)}
        ${_statsPodium('😄 Émotes les + utilisées', emoteTally, (l) => _statsEmoteHtml(l, 'stats-emote-sm'))}
      </div>
    </section>` : '';

  root.innerHTML = `
    ${controls}
    ${sessionBanner}
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
    ${insightsSec}
    ${mvpSec}
    ${missionGroupsSec}

    <div class="stats-columns">
      <div class="stats-col-group">
        ${combatSec}
        ${magicSec}
        ${competencesSec}
        ${chartsHtml}
      </div>
      <div class="stats-col-group">
        ${distinctionsSec}
        ${palmaresSec}
      </div>
    </div>

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
      const target = consumeTargetCharacter();
      const targetId = typeof target === 'string' ? target : target?.id;
      const targetTab = typeof target === 'object' ? target?.tab : null;
      // Sélection par défaut : la cible explicite (VTT…), sinon le perso favori
      // (★ par défaut) du joueur, sinon le premier.
      const charToShow = (targetId ? chars.find(c => c.id === targetId) : null)
        || getDefaultCharForUser(chars, STATE.user?.uid)
        || chars[0];
      STATE.activeChar = charToShow;
      renderCharSheet(charToShow, targetTab);
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
    const [users, quests, vttTokens] = await Promise.all([
      loadAllUsers(STATE.adventure),
      Promise.resolve(getCachedCollection('quests') || loadCollection('quests')).catch(() => []),
      loadCollection('vttTokens').catch(() => []),
    ]);
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

    const adv = STATE.adventure || {};
    const memberUids = new Set([...(adv.accessList || []), ...(adv.players || []), ...(adv.admins || [])]);
    const profiles = adv.memberProfiles || {};
    const accountRelinks = adv.accountRelinks || {};
    const absorbedUids = new Set(Object.keys(adv.accountRelinks || {}));
    const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
    const userEmailByUid = new Map();
    users.forEach(u => {
      const uid = u?.id || u?.uid || '';
      const email = String(u?.email || '').trim().toLowerCase();
      if (uid && email) userEmailByUid.set(uid, email);
    });
    const charCountByUid = new Map();
    const labelByUid = new Map();
    (STATE.characters || []).forEach(c => {
      if (!c?.uid) return;
      charCountByUid.set(c.uid, (charCountByUid.get(c.uid) || 0) + 1);
      if (c.ownerPseudo && !labelByUid.has(c.uid)) labelByUid.set(c.uid, c.ownerPseudo);
    });
    Object.entries(profiles).forEach(([uid, p]) => {
      const pseudo = typeof p === 'string' ? p : (p?.pseudo || p?.email || '');
      if (pseudo && !labelByUid.has(uid)) labelByUid.set(uid, pseudo);
    });

    const emailOfUid = (uid) => {
      const p = profiles[uid];
      return userEmailByUid.get(uid) || String(typeof p === 'string' ? '' : (p?.email || '')).trim().toLowerCase();
    };
    const pseudoOfUid = (uid) => _norm(labelByUid.get(uid) || '');
    const relinkSourceFor = (u) => {
      const newUid = u.id || u.uid || '';
      if (!newUid) return null;
      if (absorbedUids.has(newUid)) return null;
      const newCharCount = charCountByUid.get(newUid) || 0;
      if (memberUids.has(newUid) && newCharCount > 0) return null;
      if (!memberUids.has(newUid) && newCharCount === 0) {
        const curCreated = Date.parse(u.createdAt || '') || 0;
        const hasWorkingLinkedAccount = users.some(other => {
          const otherUid = other?.id || other?.uid || '';
          if (!otherUid || otherUid === newUid) return false;
          const otherCreated = Date.parse(other.createdAt || '') || 0;
          return memberUids.has(otherUid)
            && (charCountByUid.get(otherUid) || 0) > 0
            && String(other.email || '').trim().toLowerCase() === String(u.email || '').trim().toLowerCase()
            && otherCreated > curCreated;
        });
        if (hasWorkingLinkedAccount) return null;
      }

      const userEmail = String(u.email || '').trim().toLowerCase();
      const userPseudo = _norm(u.pseudo || '');
      const candidates = [...new Set([...memberUids, ...charCountByUid.keys(), ...userEmailByUid.keys()])]
        .filter(uid => uid && uid !== newUid && !absorbedUids.has(uid) && (charCountByUid.get(uid) || 0) > newCharCount);
      const byEmail = userEmail ? candidates.find(uid => emailOfUid(uid) === userEmail) : null;
      if (byEmail) return byEmail;
      const byPseudo = userPseudo ? candidates.find(uid => pseudoOfUid(uid) === userPseudo) : null;
      return byPseudo || null;
    };
    const userByUid = new Map(users.map(u => [u.id || u.uid || '', u]));
    const userLabel = (uid) => {
      const p = profiles[uid];
      const u = userByUid.get(uid);
      const denorm = typeof p === 'string' ? p : (p?.pseudo || p?.email || '');
      return denorm || u?.pseudo || u?.email || (uid ? `UID ${uid.slice(0, 6)}...` : 'Compte inconnu');
    };
    const spellValidationState = (s) => s?.mjValidation
      || (typeof s?.mjValidated === 'boolean' ? (s.mjValidated ? 'ok' : 'pending') : 'ok');

    const visibleUsers = users.filter(u => {
      const uid = u.id || u.uid || '';
      return uid && !absorbedUids.has(uid) && (memberUids.has(uid) || relinkSourceFor(u));
    });
    const sortedUsers = [...visibleUsers].sort((a, b) => (a.pseudo || '').localeCompare(b.pseudo || '', 'fr'));
    const relinkItems = visibleUsers
      .map(u => ({ user: u, uid: u.id || u.uid || '', oldUid: relinkSourceFor(u) }))
      .filter(x => x.uid && x.oldUid);
    const invalidOwnerChars = (STATE.characters || [])
      .filter(c => !c.uid || absorbedUids.has(c.uid) || !memberUids.has(c.uid));
    const playerUids = [...new Set([...(adv.players || []), ...(adv.accessList || [])])]
      .filter(uid => uid && !(adv.admins || []).includes(uid) && !absorbedUids.has(uid));
    const playersWithoutChar = playerUids
      .filter(uid => (charCountByUid.get(uid) || 0) === 0)
      .filter(uid => !relinkItems.some(x => x.uid === uid || x.oldUid === uid));
    const pendingSpells = [];
    (STATE.characters || []).forEach(c => {
      (c.deck_sorts || []).forEach((s, idx) => {
        if (spellValidationState(s) === 'pending') pendingSpells.push({ c, s, idx });
      });
    });
    const duplicateEmailGroups = [];
    const emailGroups = new Map();
    [...new Set([...memberUids, ...userEmailByUid.keys(), ...Object.keys(profiles)])]
      .filter(uid => uid && !absorbedUids.has(uid))
      .forEach(uid => {
        const email = emailOfUid(uid);
        if (!email) return;
        if (!emailGroups.has(email)) emailGroups.set(email, []);
        emailGroups.get(email).push(uid);
      });
    emailGroups.forEach((uids, email) => {
      const uniq = [...new Set(uids)];
      if (uniq.length > 1) duplicateEmailGroups.push({ email, uids: uniq });
    });
    const questParticipantIssues = [];
    (quests || []).forEach(q => {
      const parts = Array.isArray(q?.participants) ? q.participants : [];
      const deduped = dedupeQuestParticipants(parts);
      if (deduped.length < parts.length) {
        questParticipantIssues.push({
          q,
          title: 'Participants dupliqués',
          text: `${q.titre || 'Groupe'} · ${parts.length - deduped.length} doublon${parts.length - deduped.length > 1 ? 's' : ''}`,
        });
      }
      parts.forEach(p => {
        const uid = p?.uid || '';
        const char = p?.charId ? charById.get(p.charId) : null;
        if (!uid) {
          questParticipantIssues.push({ q, title: 'Participant sans compte', text: `${q.titre || 'Groupe'} · ${p?.nom || 'Inconnu'}` });
        } else if (absorbedUids.has(uid)) {
          questParticipantIssues.push({ q, title: 'Participant sur ancien compte', text: `${q.titre || 'Groupe'} · ${p?.nom || userLabel(uid)}` });
        } else if (!memberUids.has(uid)) {
          questParticipantIssues.push({ q, title: 'Participant hors aventure', text: `${q.titre || 'Groupe'} · ${p?.nom || userLabel(uid)}` });
        }
        if (p?.charId && !char) {
          questParticipantIssues.push({ q, title: 'Personnage de quête introuvable', text: `${q.titre || 'Groupe'} · ${p?.nom || p.charId}` });
        } else if (char?.uid && uid && accountRelinks[uid] !== char.uid && char.uid !== uid) {
          questParticipantIssues.push({ q, title: 'Compte/personnage incohérents', text: `${q.titre || 'Groupe'} · ${p?.nom || char.nom || userLabel(uid)}` });
        }
      });
    });
    const tokenIssues = [];
    const reserveTokenKeys = new Map();
    (vttTokens || []).forEach(t => {
      if (!t) return;
      const tokenName = t.name || t.nom || 'Token';
      if (t.characterId) {
        const c = charById.get(t.characterId);
        const owner = t.ownerId || '';
        if (!c) {
          tokenIssues.push({ t, title: 'Token sans personnage', text: `${tokenName} · personnage introuvable`, repairable: false });
        } else if ((owner || null) !== (c.uid || null)) {
          tokenIssues.push({ t, title: 'Token propriétaire désynchronisé', text: `${tokenName} · attendu ${userLabel(c.uid)}`, repairable: true });
        } else if (owner && (absorbedUids.has(owner) || !memberUids.has(owner))) {
          tokenIssues.push({ t, title: 'Token avec propriétaire invalide', text: `${tokenName} · ${userLabel(owner)}`, repairable: false, charId: c.id });
        }
      }
      (Array.isArray(t.controlDelegates) ? t.controlDelegates : []).forEach(uid => {
        if (!uid || absorbedUids.has(uid) || !memberUids.has(uid)) {
          tokenIssues.push({ t, title: 'Délégation VTT invalide', text: `${tokenName} · ${userLabel(uid)}`, repairable: true });
        }
      });
      const reserveKey = t.characterId ? `c:${t.characterId}` : t.npcId ? `n:${t.npcId}` : '';
      if (reserveKey && !t.pageId) {
        reserveTokenKeys.set(reserveKey, (reserveTokenKeys.get(reserveKey) || 0) + 1);
      }
    });
    reserveTokenKeys.forEach((count, key) => {
      if (count > 1) {
        const id = key.slice(2);
        const c = key.startsWith('c:') ? charById.get(id) : null;
        tokenIssues.push({
          title: 'Tokens en réserve dupliqués',
          text: `${c?.nom || id} · ${count} tokens hors map`,
          repairable: true,
        });
      }
    });
    const healthIssues = [
      ...duplicateEmailGroups.map(g => ({
        icon: '🪪',
        title: 'Compte doublonné probable',
        text: `${g.email} · ${g.uids.length} comptes actifs`,
        tone: 'is-warn',
        attrs: '',
      })),
      ...invalidOwnerChars.map(c => ({
        icon: '👤',
        title: 'Personnage sans propriétaire fiable',
        text: `${c.nom || 'Personnage'} · ${c.ownerPseudo || userLabel(c.uid)}`,
        tone: 'is-danger',
        attrs: `data-action="_goToChar" data-id="${_esc(c.id)}"`,
      })),
      ...questParticipantIssues.map(i => ({
        icon: '📌',
        title: i.title,
        text: i.text,
        tone: 'is-warn',
        attrs: 'data-action="_adminRepairQuestParticipants"',
        action: 'Réparer',
      })),
      ...tokenIssues.map(i => ({
        icon: '🎲',
        title: i.title,
        text: i.text,
        tone: 'is-info',
        attrs: i.repairable
          ? 'data-action="_adminRepairVttData"'
          : i.charId
            ? `data-action="_goToChar" data-id="${_esc(i.charId)}"`
            : 'data-navigate="vtt"',
        action: i.repairable ? 'Réparer' : 'Ouvrir',
      })),
    ];
    const actionTotal = relinkItems.length + invalidOwnerChars.length + playersWithoutChar.length + pendingSpells.length;
    const actionCard = (html, attrs = '', tone = '') =>
      `<button type="button" class="adm-action-card ${tone}" ${attrs}>${html}<span class="adm-action-arrow">→</span></button>`;
    const actionCenterItems = [
      ...relinkItems.slice(0, 4).map(({ user, uid, oldUid }) => actionCard(`
        <span class="adm-action-ico">🔗</span>
        <span class="adm-action-body">
          <span class="adm-action-title">Compte à relier</span>
          <span class="adm-action-text">${_esc(user.pseudo || user.email || uid)}</span>
        </span>`,
        `data-action="_adminRelinkPlayer" data-old-uid="${_esc(oldUid)}" data-new-uid="${_esc(uid)}" data-name="${_esc(user.pseudo || user.email || uid)}"`,
        'is-warn')),
      ...invalidOwnerChars.slice(0, 4).map(c => actionCard(`
        <span class="adm-action-ico">👤</span>
        <span class="adm-action-body">
          <span class="adm-action-title">Personnage sans compte actif</span>
          <span class="adm-action-text">${_esc(c.nom || 'Personnage')} · ${_esc(c.ownerPseudo || 'propriétaire inconnu')}</span>
        </span>`,
        `data-action="_goToChar" data-id="${_esc(c.id)}"`,
        'is-danger')),
      ...pendingSpells.slice(0, 4).map(({ c, s }) => actionCard(`
        <span class="adm-action-ico">✨</span>
        <span class="adm-action-body">
          <span class="adm-action-title">Sort à valider</span>
          <span class="adm-action-text">${_esc(s.nom || 'Sort')} · ${_esc(c.nom || 'Personnage')}</span>
        </span>`,
        `data-action="_goToChar" data-id="${_esc(c.id)}" data-tab="sorts"`,
        'is-info')),
      ...playersWithoutChar.slice(0, 3).map(uid => actionCard(`
        <span class="adm-action-ico">📜</span>
        <span class="adm-action-body">
          <span class="adm-action-title">Joueur sans personnage</span>
          <span class="adm-action-text">${_esc(userLabel(uid))}</span>
        </span>`,
        `data-navigate="characters"`,
        'is-muted')),
    ];
    const hiddenActionCount = Math.max(0, actionTotal - actionCenterItems.length);
    const actionCenter = `
      <section class="adm-action-center">
        <div class="adm-action-head">
          <div>
            <div class="adm-action-kicker">À traiter</div>
            <h2>Centre d'action MJ</h2>
          </div>
          <div class="adm-action-score ${actionTotal ? 'is-hot' : 'is-ok'}">
            <strong>${actionTotal}</strong>
            <span>${actionTotal > 1 ? 'points' : 'point'}</span>
          </div>
        </div>
        <div class="adm-action-metrics">
          <span><b>${relinkItems.length}</b> relink</span>
          <span><b>${invalidOwnerChars.length}</b> persos</span>
          <span><b>${pendingSpells.length}</b> sorts</span>
          <span><b>${playersWithoutChar.length}</b> joueurs</span>
        </div>
        ${actionTotal
          ? `<div class="adm-action-list">${actionCenterItems.join('')}${hiddenActionCount ? `<div class="adm-action-more">+${hiddenActionCount} autre${hiddenActionCount>1?'s':''} point${hiddenActionCount>1?'s':''}</div>` : ''}</div>`
          : `<div class="adm-action-empty"><b>Tout est propre.</b><span>Aucun compte, personnage ou sort ne demande ton attention.</span></div>`}
      </section>`;
    const healthCard = (issue) => {
      const tag = issue.attrs ? 'button' : 'div';
      const type = tag === 'button' ? ' type="button"' : '';
      return `<${tag}${type} class="adm-health-card ${issue.tone || ''}" ${issue.attrs || ''}>
        <span class="adm-health-ico">${issue.icon || '•'}</span>
        <span class="adm-health-body">
          <span class="adm-health-title">${_esc(issue.title || 'Diagnostic')}</span>
          <span class="adm-health-text">${_esc(issue.text || '')}</span>
        </span>
        ${tag === 'button' ? `<span class="adm-health-action">${_esc(issue.action || 'Ouvrir')}</span>` : ''}
      </${tag}>`;
    };
    const healthPreview = healthIssues.slice(0, 10);
    const hiddenHealthCount = Math.max(0, healthIssues.length - healthPreview.length);
    const dataHealth = `
      <section class="adm-health">
        <div class="adm-health-head">
          <div>
            <div class="adm-action-kicker">Diagnostic</div>
            <h2>Santé des données</h2>
          </div>
          <div class="adm-health-state ${healthIssues.length ? 'is-warn' : 'is-ok'}">${healthIssues.length ? `${healthIssues.length} alerte${healthIssues.length > 1 ? 's' : ''}` : 'OK'}</div>
        </div>
        <div class="adm-health-metrics">
          <span><b>${duplicateEmailGroups.length}</b> doublons</span>
          <span><b>${invalidOwnerChars.length}</b> propriétaires</span>
          <span><b>${questParticipantIssues.length}</b> quêtes</span>
          <span><b>${tokenIssues.length}</b> VTT</span>
        </div>
        ${healthIssues.length
          ? `<div class="adm-health-grid">${healthPreview.map(healthCard).join('')}${hiddenHealthCount ? `<div class="adm-action-more">+${hiddenHealthCount} autre${hiddenHealthCount > 1 ? 's' : ''} alerte${hiddenHealthCount > 1 ? 's' : ''}</div>` : ''}</div>`
          : `<div class="adm-action-empty"><b>Aucune incohérence détectée.</b><span>Comptes, personnages, quêtes et tokens semblent alignés.</span></div>`}
      </section>`;
    const pRow = (u) => {
      const uid = u.id || u.uid || '';
      const oldUid = relinkSourceFor(u);
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
          ${oldUid ? `<span class="adm-pactions">
            <button type="button" class="btn-icon adm-relink-btn"
              data-action="_adminRelinkPlayer"
              data-old-uid="${_esc(oldUid)}"
              data-new-uid="${_esc(uid)}"
              data-name="${_esc(u.pseudo || u.email || uid)}"
              title="Compte non relié détecté : réassocier automatiquement"
              aria-label="Réassocier ${_esc(u.pseudo || u.email || uid)} automatiquement">🔗</button>
          </span>` : ''}
        </div>`;
    };

    content.innerHTML = `
      ${pageHeaderHtml('⚙️ Console MJ', "Réglages du jeu & joueurs de l'aventure")}
      ${actionCenter}
      ${dataHealth}
      <section class="adm-block">
        <div class="adm-label">⚔️ Personnages &amp; combat</div>
        ${grid('combat')}
      </section>
      <section class="adm-block">
        <div class="adm-label">🎲 Table &amp; VTT</div>
        ${grid('table')}
      </section>
      <section class="adm-block">
        <div class="adm-label">👥 Joueurs inscrits <span class="adm-count">${visibleUsers.length}</span></div>
        <div class="adm-players adm-players--grid">${sortedUsers.map(pRow).join('')}</div>
      </section>`;
  },

  // ─── STATISTIQUES ─────────────────────────────────────────────────────────────
  async statistiques() {
    const content = document.getElementById('main-content');
    content.innerHTML = `${pageHeaderHtml('📊 Statistiques', 'Jets, réussites et exploits de la table')}
      <div id="stats-root" class="stats-root">${loadingHtml('Chargement des statistiques…')}</div>`;
    const [data, emoteDoc, chars, quests, story] = await Promise.all([
      loadStats(),
      getDocData('world', 'vtt_emotes').catch(() => null),
      // Charge les persos (avec leur portrait) pour les afficher à côté du nom.
      loadChars().catch(() => null),
      loadCollection('quests').catch(() => []),
      Promise.resolve(getCachedCollection('story') || loadCollection('story')).catch(() => []),
    ]);
    if (Array.isArray(chars) && chars.length) STATE.characters = chars;
    _statsQuests = Array.isArray(quests) ? quests : [];
    _statsStory = Array.isArray(story) ? story : [];
    _statsLoadAwardPrefs();
    _statsData = data;
    _statsEmoteUrl = new Map((emoteDoc?.emotes || []).filter(e => e?.name && e?.url).map(e => [e.name, e.url]));
    _statsScope = null;
    _statsPlayerSel = null;
    _statsGroupSel = null;
    _statsGroupMissionId = '';
    _statsRender(null);
  },

};

async function goToChar(id, tab = null) {
  setTargetCharacter(id, tab);
  const { navigate } = await import('../core/navigation.js');
  navigate('characters');
}

registerActions({
  // Dashboard
  _goToChar:             (btn) => goToChar(btn.dataset.id, btn.dataset.tab),
  openAdventureSwitcher: ()    => openAdventureSwitcher(),
  _adminRepairQuestParticipants: () => _adminRepairQuestParticipants(),
  _adminRepairVttData:           () => _adminRepairVttData(),

  // Statistiques : modale de gestion des données (MJ) — supprimer ciblé ou tout.
  _statsManage: () => {
    if (!STATE.isAdmin) return;
    const dates = [...new Set(Object.values(_statsData?.chars || {}).flatMap(c => Object.keys(c.byDate || {})))].sort().reverse();
    const missions = _statsMissionList();
    const missRow = (m) => `<div class="stats-mng-row"><span class="stats-mng-lbl">🎯 ${_esc(m.name)}</span><button class="stats-mng-del" data-action="_statsDelMission" data-scope="${m.id}" data-name="${_esc(m.name)}">🗑 Supprimer</button></div>`;
    const dateRow = (d) => {
      const mi = _statsMissionOf(d), gr = _statsGroupOf(d);
      const label = mi ? `🎯 ${_esc(mi)}${gr ? ` · 👥 ${_esc(gr)}` : ''}` : '<span class="stats-sb-none">Non reliée</span>';
      return `<div class="stats-mng-row">
        <span class="stats-mng-lbl">📅 ${_statsFmtDate(d)} — ${label}</span>
        <span class="stats-mng-acts">
          <button class="stats-mng-link" data-action="_statsEditMission" data-scope="${d}">🔗 ${mi ? 'Modifier' : 'Relier'}</button>
          <button class="stats-mng-del" data-action="_statsDelDate" data-scope="${d}">🗑</button>
        </span>
      </div>`;
    };
    openModal('⚙ Gérer les statistiques', `
      <div class="stats-mng">
        ${dates.length ? `<div class="stats-mng-sec"><div class="stats-mng-hd">Relier une séance à une mission / un groupe · ou la supprimer</div>${dates.map(dateRow).join('')}</div>` : ''}
        ${missions.length ? `<div class="stats-mng-sec"><div class="stats-mng-hd">Supprimer toutes les stats d'une mission</div>${missions.map(missRow).join('')}</div>` : ''}
        ${(!missions.length && !dates.length) ? '<div class="stats-mng-sec" style="color:var(--text-dim);font-size:.85rem">Aucune donnée datée pour le moment.</div>' : ''}
        <div class="stats-mng-danger">
          <div class="stats-mng-hd">⚠ Zone dangereuse</div>
          <p>Efface <b>toutes</b> les statistiques de l'aventure. Irréversible.</p>
          <button class="stats-mng-reset" data-action="_statsResetAsk">↺ Tout réinitialiser…</button>
        </div>
      </div>`, { subtitle: 'Relier les séances aux missions · supprimer des données ciblées', accent: '#4f8cff' });
  },
  // Supprime les stats d'une séance (date) — ajuste les totaux campagne.
  _statsDelDate: async (btn) => {
    if (!STATE.isAdmin) return;
    const d = btn.dataset.scope; if (!d) return;
    const ok = await confirmModal(`Supprimer toutes les stats de la séance du <b>${_statsFmtDate(d)}</b> ?<br>Les totaux de campagne seront ajustés en conséquence.`, {
      title: '🗑 Supprimer une séance', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    const done = await deleteDateStats(d);
    showNotif(done ? 'Séance supprimée.' : 'Échec de la suppression.', done ? 'success' : 'error');
    closeModalDirect();
    if (done) { if (_statsScope === d) _statsScope = null; _statsGroupSel = null; PAGES.statistiques(); }
  },
  // Supprime les stats liées à une mission (toutes ses séances).
  _statsDelMission: async (btn) => {
    if (!STATE.isAdmin) return;
    const mid = btn.dataset.scope, name = btn.dataset.name || 'cette mission';
    const ok = await confirmModal(`Supprimer toutes les stats liées à <b>${_esc(name)}</b> (toutes ses séances) ?<br>Les totaux de campagne seront ajustés.`, {
      title: '🗑 Supprimer une mission', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    const done = await deleteMissionStats(mid);
    showNotif(done ? 'Stats de la mission supprimées.' : 'Échec de la suppression.', done ? 'success' : 'error');
    closeModalDirect();
    if (done) { _statsScope = null; _statsGroupSel = null; _statsGroupMissionId = ''; PAGES.statistiques(); }
  },
  // Réinitialisation TOTALE — confirmation par saisie (« RESET »).
  _statsResetAsk: async () => {
    if (!STATE.isAdmin) return;
    const val = await promptModal('Tape RESET pour confirmer la remise à zéro TOTALE (irréversible).', {
      title: '↺ Tout réinitialiser', placeholder: 'RESET', confirmLabel: 'Confirmer', required: true,
    }).catch(() => null);
    if (val === null) return;
    if ((val || '').trim().toUpperCase() !== 'RESET') { showNotif('Confirmation incorrecte — rien n\'a été supprimé.', 'info'); return; }
    const done = await resetStats();
    showNotif(done ? 'Toutes les statistiques ont été réinitialisées.' : 'Échec de la réinitialisation.', done ? 'success' : 'error');
    closeModalDirect();
    if (done) { _statsScope = null; _statsPlayerSel = null; _statsGroupSel = null; _statsGroupMissionId = ''; PAGES.statistiques(); }
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
  // Frise de séances : clic sur une chip → change la vue (sans relecture réseau).
  _statsSetScope: (btn) => { _statsRender(btn.dataset.scope || null); },
  _statsResetFilters: () => {
    _statsScope = null;
    _statsPlayerSel = null;
    _statsGroupSel = null;
    _statsGroupMissionId = '';
    _statsRender(null);
  },
  // Filtre « joueurs ciblés » : bascule un joueur (ou « Tous ») puis recalcule tout.
  _statsTogglePlayer: (btn) => {
    const id = btn.dataset.id;
    if (id === '__all') { _statsPlayerSel = null; }
    else {
      if (!_statsPlayerSel) _statsPlayerSel = new Set();
      _statsPlayerSel.has(id) ? _statsPlayerSel.delete(id) : _statsPlayerSel.add(id);
      if (!_statsPlayerSel.size) _statsPlayerSel = null;
    }
    _statsRender(_statsScope);
  },
  // Filtre « groupes ciblés » : bascule un ou plusieurs groupes de la mission courante.
  _statsToggleGroup: (btn) => {
    const key = btn.dataset.groupKey;
    if (!key) return;
    if (key === '__all') { _statsGroupSel = null; }
    else {
      if (!_statsGroupSel) _statsGroupSel = new Set();
      _statsGroupSel.has(key) ? _statsGroupSel.delete(key) : _statsGroupSel.add(key);
      if (!_statsGroupSel.size) _statsGroupSel = null;
    }
    const missionScope = _statsGroupMissionId ? `mission:${_statsGroupMissionId}` : _statsScope;
    _statsRender(missionScope);
  },
  // Métriques des graphiques (comparatif / évolution).
  _statsCmpMetric: (el) => { _statsCmpMetric = el.value; _statsRender(_statsScope); },
  _statsEvoMetric: (el) => { _statsEvoMetric = el.value; _statsRender(_statsScope); },
  // Type du graphique comparatif : barres ↔ camembert.
  _statsCmpType: (btn) => { _statsCmpType = btn.dataset.type === 'pie' ? 'pie' : 'bars'; _statsRender(_statsScope); },
  // MJ : relie la séance à une mission de la Trame (sélecteur recherchable).
  _statsEditMission: async (btn) => {
    if (!STATE.isAdmin) return;
    const dk = btn.dataset.scope; if (!dk) return;
    let story = getCachedCollection('story');
    if (!story || !story.length) story = await loadCollection('story').catch(() => []);
    _statsStory = Array.isArray(story) ? story : [];
    const missions = (story || [])
      .filter(m => m.type === 'mission' || m.type === 'event')
      .sort(_statsStoryOrderCompare);
    const curId = _statsData?.sessions?.[dk]?.missionId || '';
    const opt = (id, ico, title, active) =>
      `<button type="button" class="stats-mp-opt${active ? ' active' : ''}" data-name="${_esc(_norm(title))}"
        data-action="_statsPickMission" data-scope="${dk}" data-mission-id="${_esc(id)}" data-mission="${_esc(title)}">
        <span class="stats-mp-ico">${ico}</span><span class="stats-mp-tt">${_esc(title)}</span>${active ? '<span class="stats-mp-check">✓</span>' : ''}</button>`;
    openModal(`📅 Séance du ${_statsFmtDate(dk)}`, `
      <div class="stats-mp">
        <input type="text" class="stats-mp-search" placeholder="🔍 Rechercher une mission / un événement…" data-input="_statsMissionSearch" autocomplete="off">
        <div class="stats-mp-list">
          <button type="button" class="stats-mp-opt stats-mp-none${!curId ? ' active' : ''}" data-action="_statsPickMission" data-scope="${dk}" data-mission-id="" data-mission="">
            <span class="stats-mp-ico">✖</span><span class="stats-mp-tt">Aucune mission</span></button>
          ${missions.map(m => opt(m.id, m.type === 'event' ? '📖' : '🎯', m.titre || 'Mission', m.id === curId)).join('')}
          ${missions.length ? '' : '<div class="stats-mp-empty">Aucune mission dans la Trame.<br><span style="font-size:.9em">Crée d\'abord une mission (et ses groupes) dans la page <b>Trame</b>.</span></div>'}
        </div>
      </div>`, { subtitle: 'Relier la séance à un élément de la Trame', accent: '#22c38e' });
  },
  // Choix d'une mission : passe à l'étape « groupe » si la mission en a, sinon enregistre.
  _statsPickMission: async (btn) => {
    if (!STATE.isAdmin) return;
    const dk = btn.dataset.scope; if (!dk) return;
    const mid = btn.dataset.missionId || '';
    const mission = btn.dataset.mission || '';
    if (!mid) { // « Aucune mission » → efface le lien
      closeModalDirect();
      await setSessionMission(dk, {});
      (_statsData.sessions ??= {})[dk] = { mission: '', missionId: '', groupId: '', group: '' };
      _statsRender(_statsScope);
      return;
    }
    const story = getCachedCollection('story') || [];
    let quests = _statsQuests?.length ? _statsQuests : getCachedCollection('quests');
    if (!quests || !quests.length) quests = await loadCollection('quests').catch(() => []);
    _statsQuests = Array.isArray(quests) ? quests : [];
    const groupes = _statsGroupsForMission(story, quests, mid);
    if (Array.isArray(groupes) && groupes.length) { _statsGroupStep(dk, mid, mission, groupes); return; }
    closeModalDirect();
    await setSessionMission(dk, { mission, missionId: mid });
    (_statsData.sessions ??= {})[dk] = { mission: mission.trim(), missionId: mid, groupId: '', group: '' };
    _statsRender(_statsScope);
  },
  // Choix du groupe (étape 2).
  _statsPickGroup: async (btn) => {
    if (!STATE.isAdmin) return;
    const dk = btn.dataset.scope; if (!dk) return;
    const mid = btn.dataset.missionId || '', mission = btn.dataset.mission || '';
    const gid = btn.dataset.groupId || '', group = btn.dataset.group || '';
    closeModalDirect();
    await setSessionMission(dk, { mission, missionId: mid, groupId: gid, group });
    (_statsData.sessions ??= {})[dk] = { mission: mission.trim(), missionId: mid, groupId: gid, group: group.trim() };
    _statsRender(_statsScope);
  },
  // Filtre live du sélecteur de missions (sans re-render).
  _statsMissionSearch: (el) => {
    const q = _norm(el.value || '');
    document.querySelectorAll('.stats-mp-list .stats-mp-opt:not(.stats-mp-none)').forEach(b => {
      b.style.display = (!q || (b.dataset.name || '').includes(q)) ? '' : 'none';
    });
  },
  _statsAwardsConfig: () => {
    const row = ([id, label]) => `<label class="stats-award-opt">
      <input type="checkbox" data-change="_statsToggleAward" data-award-id="${id}"${_statsHiddenAwards.has(id) ? '' : ' checked'}>
      <span>${_esc(label)}</span>
    </label>`;
    openModal('🏆 Distinctions', `
      <div class="stats-award-config">
        <div class="stats-mp-hint">Choisis les distinctions affichées sur la page et dans le récap copié.</div>
        <div class="stats-award-list">${_STATS_AWARD_CATALOG.map(row).join('')}</div>
        <button class="stats-mng-link stats-award-reset" data-action="_statsShowAllAwards">Tout réafficher</button>
      </div>`, { subtitle: 'Affichage local de cette page', accent: '#f4c430' });
  },
  _statsToggleAward: (el) => {
    const id = el.dataset.awardId;
    if (!id) return;
    el.checked ? _statsHiddenAwards.delete(id) : _statsHiddenAwards.add(id);
    _statsSaveAwardPrefs();
    _statsRender(_statsScope);
  },
  _statsShowAllAwards: () => {
    _statsHiddenAwards = new Set();
    _statsSaveAwardPrefs();
    closeModalDirect();
    _statsRender(_statsScope);
  },
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
  _statsExportImage: () => {
    const s = _statsVisualSummary;
    if (!s) { showNotif('Aucun récap visuel à exporter.', 'info'); return; }
    const W = 1200, H = 760, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const round = (x, y, w, h, r = 18) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    const text = (t, x, y, size = 24, color = '#e6edf7', weight = '700') => {
      ctx.fillStyle = color; ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`; ctx.fillText(String(t), x, y);
    };
    const wrap = (t, x, y, max, lh = 28) => {
      ctx.font = '700 22px Inter, Arial, sans-serif';
      const words = String(t).split(/\s+/); let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > max && line) { text(line, x, y, 22, '#d8e3f6', '700'); y += lh; line = word; }
        else line = next;
      }
      if (line) text(line, x, y, 22, '#d8e3f6', '700');
      return y + lh;
    };
    ctx.fillStyle = '#07101d'; ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(79,140,255,.22)'); grad.addColorStop(.55, 'rgba(188,160,255,.12)'); grad.addColorStop(1, 'rgba(34,195,142,.16)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    text('GRIMORIUM', 56, 64, 24, '#9cc3ff', '800');
    wrap(`Statistiques — ${s.scopeLabel}`, 56, 112, 760, 34);
    round(930, 46, 180, 180, 90); ctx.fillStyle = 'rgba(34,195,142,.18)'; ctx.fill();
    text(`${s.hitRate}%`, 974, 135, 44, '#22c38e', '900'); text('réussite', 978, 166, 19, '#9fb0c7', '700');
    let x = 56, y = 210;
    s.metrics.forEach(([label, value, color], i) => {
      const cx = x + (i % 5) * 214;
      round(cx, y, 190, 105, 16); ctx.fillStyle = 'rgba(9,18,32,.78)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.stroke();
      text(value, cx + 20, y + 44, 34, color, '900');
      text(label, cx + 20, y + 76, 18, '#9fb0c7', '700');
    });
    y = 360;
    if (s.mvp) {
      round(56, y, 500, 78, 18); ctx.fillStyle = 'rgba(244,196,48,.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,196,48,.35)'; ctx.stroke();
      text('MVP d’impact', 78, y + 30, 18, '#f4c430', '900');
      text(`${s.mvp.name} · ${s.mvp.score} pts`, 78, y + 58, 24, '#e6edf7', '900');
      y += 112;
    }
    text('Distinctions', 56, y, 26, '#f4c430', '900'); y += 44;
    (s.awards.length ? s.awards : ['Aucune distinction affichée']).slice(0, 6).forEach(a => { y = wrap(a, 72, y, 500, 30); });
    if (s.groups.length) {
      let gy = 360;
      text('Groupes', 650, gy, 26, '#c9b6ff', '900'); gy += 34;
      s.groups.forEach(g => {
        round(650, gy, 410, 72, 14); ctx.fillStyle = 'rgba(9,18,32,.7)'; ctx.fill();
        text(g.label, 670, gy + 28, 21, '#e6edf7', '800');
        text(`${g.sessions} séances · ${g.dmgAvg}/séance · ${g.heal} soin · ${g.rolls} jets`, 670, gy + 54, 17, '#9fb0c7', '700');
        gy += 86;
      });
    }
    text(new Date().toLocaleDateString('fr-FR'), 56, H - 42, 18, '#708097', '700');
    canvas.toBlob(blob => {
      if (!blob) { showNotif('Export image impossible.', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `grimorium-stats-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      showNotif('Récap visuel téléchargé.', 'success');
    }, 'image/png');
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
  _adminRelinkPlayer: (btn) => _adminRelinkPlayer(btn.dataset.oldUid, btn.dataset.newUid, btn.dataset.name),
});

export default PAGES;
