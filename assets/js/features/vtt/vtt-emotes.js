// ==============================================================================
// VTT — Émotes (picker, favoris, gestion) + dés libres (mode de jet, compétences)
// ------------------------------------------------------------------------------
// Sous-système extrait de vtt.js (cf. docs/vtt-decomposition.md). État local au
// module ; vtt.js importe les handlers (data-vtt-fn) et les loaders (montage).
// Imports circulaires ciblés vers vtt.js : _renderInspector (re-render après
// changement de mode de jet) et _showEmoteBubble (bulle canvas) — runtime → sûr.
// ==============================================================================
import { VS } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { _esc, _norm, _searchIncludes, normalizeImageUrl } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { showNotif } from '../../shared/notifications.js';
import { getDocData, saveDoc } from '../../data/firestore.js';
import { db, doc, getDoc, addDoc, setDoc, serverTimestamp } from '../../config/firebase.js';
import { computeEquipSkillBonus } from '../../shared/char-stats.js';
import { getArmorSetData } from '../../shared/equipment-utils.js';
import { combineArmorRollMode, getArmorSetRollModeFor } from '../../shared/armor-set-settings.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../../shared/dice-skills.js';
import { bumpSkill, bumpEmote } from '../../shared/stats.js';
import { _logGmCol, _reactionRef } from './vtt-refs.js';
import { _STAT_KEY } from './vtt-constants.js';
import { sanitizeEmoteName, createEmoteLookup, resolveEmoteNames } from '../../shared/emote-admin.js';
import { resolveControlledTokenId } from './vtt-token-control.js';
import { _live } from './vtt-effective.js';
import { _vttPublishOptimisticLog } from './vtt-chat.js';
import {
  VTT_ACTIONS, _showEmoteBubble, _canControlToken, _conditionStatRollMode,
  _tokenStatMod, _vttLogTargetFields, _vttTokenIdAtClient, _vttEmoteDropHalo,
} from './vtt.js'; // circ. (runtime)
import { _renderInspector } from './vtt-inspector.js'; // re-render après changement de mode de jet
import { openVttSessionDockPanel, registerVttSessionDockPanel, syncVttSessionDock } from './vtt-session-dock.js';
import { normalizeSimulatedNatural, simulatedDiceSlots, validateSimulatedValues } from './vtt-dice-simulation.js';

// État émotes (déplacé de vtt.js). _emotes exporté : préchargé au montage côté vtt.js.
export let _emotes = [];        // [{id, name, url}] chargées depuis world/vtt_emotes
let _emoteCloseOutside = null;

export async function _loadEmotes() {
  // 1. Tenter le path scopé à l'aventure (path normal)
  try {
    const data = await getDocData('world', 'vtt_emotes');
    if (Array.isArray(data?.emotes)) { _emotes = data.emotes; return; }
  } catch(e) { console.warn('[vtt] emotes (adventure path) :', e.message); }

  // 2. Fallback : path global world/vtt_emotes (migration ancien stockage)
  try {
    const snap = await getDoc(doc(db, 'world', 'vtt_emotes'));
    _emotes = snap.data()?.emotes || [];
    if (_emotes.length) console.info('[vtt] emotes chargées depuis le path global (migration)');
  } catch(e) {
    console.warn('[vtt] emotes (global path) :', e.message);
    _emotes = [];
  }
}

// Initialiser immédiatement : localStorage (ordre perso) > défauts
VS.diceSkills = lsJson.get(DICE_SKILLS_STORAGE_KEY, [...DICE_SKILLS_DEFAULT]);

export async function _loadDiceSkills() {
  try {
    const data = await getDocData('world', 'dice_skills');
    if (data?.skills?.length) VS.diceSkills = data.skills;
  } catch { /* garde le cache local */ }
  // Re-render l'inspector si un token est déjà sélectionné.
  if (VS.selected) _renderInspector(VS.tokens[VS.selected]?.data ?? null);
  // Le lanceur MJ expose aussi les compétences sans token sélectionné.
  document.dispatchEvent(new CustomEvent('vtt-roll-history'));
}

export function _vttSetRollMode(mode) {
  VS.rollMode = mode;
  // Mise à jour visuelle sans re-render (segments façon modal d'action).
  document.querySelectorAll('.vtt-skill-mode .vtt-atk-mode-btn').forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export function _vttAdjBonus(delta, reset = false) {
  VS.rollBonus = reset ? 0 : Math.max(-20, Math.min(20, VS.rollBonus + delta));
  const el = document.getElementById('vtt-bonus-val');
  if (el) {
    if (el.tagName === 'INPUT') el.value = VS.rollBonus;
    else {
      el.textContent = VS.rollBonus > 0 ? `+${VS.rollBonus}` : `${VS.rollBonus}`;
      el.classList.toggle('nonzero', VS.rollBonus !== 0);
    }
  }
  document.querySelector('.vtt-roll-bonus-reset')?.classList.toggle('hide', VS.rollBonus === 0);
}

// Saisie directe du bonus de jet (champ numérique façon modal d'action).
export function _vttSetBonus(v) {
  const n = parseInt(v, 10);
  VS.rollBonus = Number.isFinite(n) ? Math.max(-20, Math.min(20, n)) : 0;
}

export function _vttToggleRollHidden() {
  if (!STATE.isAdmin) return;
  if (VS.rollSimulated) {
    VS.rollHidden = false;
    showNotif('Un dé simulé est toujours public.', 'info');
    return;
  }
  VS.rollHidden = !VS.rollHidden;
  lsJson.set('vtt-roll-hidden', VS.rollHidden);
  // Le bouton 👁/🕶 vit désormais dans le lanceur (vtt-dice.js) : on le laisse se
  // re-rendre via l'évènement partagé (pas d'import croisé) plutôt que de le muter.
  document.dispatchEvent(new CustomEvent('vtt-roll-history'));
}

export async function _vttRollSkill(skillName, stat) {
  // Pas besoin de cliquer son pion : on retombe sur le token contrôlé de la scène
  // (propriétaire ou délégation), comme pour les émotes. La sélection ne prime que
  // si elle vise un token qu'on contrôle réellement.
  const uid = STATE.user?.uid;
  // Le MJ sans sélection ne doit jamais hériter silencieusement d'un token
  // arbitraire : son jet est un jet neutre, auquel il peut ajouter le bonus du lanceur.
  const tokenId = STATE.isAdmin
    ? (() => {
        const selected = VS.selected ? VS.tokens[VS.selected]?.data : null;
        const onPage = selected && (!VS.activePage?.id || selected.pageId === VS.activePage.id);
        return onPage && _canControlToken(selected, uid) ? selected.id : null;
      })()
    : resolveControlledTokenId(
        VS.selected, VS.tokens, VS.activePage?.id || null,
        token => _canControlToken(token, uid),
      );
  const t = tokenId ? VS.tokens[tokenId]?.data : null;
  const genericMjRoll = STATE.isAdmin && !t;
  if (!genericMjRoll && (!t || !_canControlToken(t))) return; // joueur : token propre ou délégué uniquement
  const c = t?.characterId ? VS.characters[t.characterId] : null;
  const n = t?.npcId ? VS.npcs[t.npcId] : null;
  const b = t?.beastId ? VS.bestiary[t.beastId] : null; // créature du bestiaire
  const statKey = _STAT_KEY[stat] || '';
  const mod = genericMjRoll ? 0 : _tokenStatMod(t, statKey);
  // Bonus de compétence depuis les items équipés (pour les PJ)
  const equipSkillBonus = c ? computeEquipSkillBonus(c.equipement || {}, skillName) : 0;
  const armorRollMode = c
    ? getArmorSetRollModeFor(getArmorSetData(c), { stat: statKey, skill: skillName })
    : '';
  const conditionRollMode = t ? _conditionStatRollMode(t, statKey, 'check') : '';
  // Niveau de compétence de la fiche (onglet Capacités, c.competences[skill]) :
  // formée = +2 · expertise = +2 & avantage. Non formée (absent) = jet normal.
  const _skillLvl = (c?.competences && !Array.isArray(c.competences)) ? c.competences[skillName] : null;
  const skillProfBonus = (_skillLvl === 'forme' || _skillLvl === 'expert') ? 2 : 0;
  const skillRollMode = _skillLvl === 'expert' ? 'advantage' : '';
  const effectiveRollMode = combineArmorRollMode(
    combineArmorRollMode(
      combineArmorRollMode(VS.rollMode || 'normal', armorRollMode),
      conditionRollMode,
    ),
    skillRollMode,
  );
  const simulated = !!(STATE.isAdmin && VS.rollSimulated);
  let simulatedNaturals = null;
  if (simulated) {
    const slots = simulatedDiceSlots({ 20: 1 }, effectiveRollMode);
    simulatedNaturals = validateSimulatedValues(slots, VS.rollSimValues);
    // Une expertise/condition peut ajouter l'avantage après le rendu du lanceur.
    // Dans ce cas, la valeur naturelle choisie reste la valeur des deux d20.
    if (!simulatedNaturals && slots.length === 2 && VS.rollSimValues.length === 1) {
      const natural = normalizeSimulatedNatural(VS.rollSimValues[0], 20);
      if (natural != null) simulatedNaturals = [natural, natural];
    }
    // À l'inverse, un avantage choisi dans le lanceur peut être annulé par un
    // désavantage d'armure/condition : seul le premier d20 saisi est alors joué.
    if (!simulatedNaturals && slots.length === 1 && VS.rollSimValues.length >= 1) {
      const natural = normalizeSimulatedNatural(VS.rollSimValues[0], 20);
      if (natural != null) simulatedNaturals = [natural];
    }
    if (!simulatedNaturals) {
      showNotif('Renseigne une valeur naturelle valide pour chaque d20 simulé.', 'error');
      return;
    }
  }
  const d20 = () => Math.floor(Math.random() * 20) + 1;

  let simulatedCursor = 0;
  const nextD20 = () => simulated ? simulatedNaturals[simulatedCursor++] : d20();
  let d1 = nextD20(), d2, roll;
  if (effectiveRollMode === 'advantage')    { d2 = nextD20(); roll = Math.max(d1, d2); }
  else if (effectiveRollMode === 'disadvantage') { d2 = nextD20(); roll = Math.min(d1, d2); }
  else                              { roll = d1; }

  const total   = roll + mod + VS.rollBonus + equipSkillBonus + skillProfBonus;
  const isCrit  = roll === 20, isFumble = roll === 1;
  const authorName    = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const characterName = genericMjRoll ? 'Maître du jeu' : (c?.nom || n?.nom || b?.nom || t?.name || null);
  const characterImage = (genericMjRoll
    ? (STATE.profile?.photoURL || STATE.profile?.photo || STATE.profile?.avatar || null)
    : (c?.photoURL || c?.photo || c?.avatar
    || n?.photoURL || n?.photo || n?.avatar || n?.imageUrl
    || b?.photoURL || b?.photo || b?.avatar || b?.imageUrl
    || t?.imageUrl || null));
  const gmOnly = simulated ? false : STATE.isAdmin && VS.rollHidden;
  try {
    // Jet caché → sous-collection MJ (secret serveur) ; sinon log public.
    const payload = {
      type: 'roll',
      authorId: STATE.user?.uid || null,
      authorName, characterName, characterImage,
      ..._vttLogTargetFields(t),
      rollMode: effectiveRollMode,
      rollModeRequested: VS.rollMode || 'normal',
      rollArmorMode: armorRollMode || null,
      rollConditionMode: conditionRollMode || null,
      rollDice: d2 !== undefined ? [d1, d2] : [d1],
      rollRaw: roll, rollMod: mod, rollBonus: VS.rollBonus || 0,
      rollResult: total,
      rollSkill: skillName, rollStat: stat,
      rollEquipBonus: equipSkillBonus || 0,
      rollSkillBonus: skillProfBonus || 0,
      rollSkillLevel: _skillLvl || null,
      isCrit, isFumble,
      gmOnly, simulated,
      statsExcluded: simulated,
      createdAt: serverTimestamp(),
    };
    if (gmOnly) await addDoc(_logGmCol(), payload);
    else await _vttPublishOptimisticLog(payload);
    if (simulated) showNotif(`🧪 Jet simulé public : ${skillName} = ${total}`, 'success');
    else if (gmOnly) showNotif('Jet caché — visible uniquement par le MJ', 'success');
  } catch(e) { showNotif('Erreur jet : ' + e.message, 'error'); }
  // Statistiques : compte le jet de compétence (PJ uniquement) + crit/échec.
  // t.characterId = id fiable (VS.characters[...] ne porte pas forcément .id).
  if (c && t.characterId && !simulated) bumpSkill(t.characterId, characterName, skillName, {
    crit: isCrit,
    fumble: isFumble,
    natural: roll,
    total,
  });

  // Historique UNIFIÉ du lanceur (état partagé VS.rollHistory pour éviter un import
  // croisé vtt-emotes ↔ vtt-dice). On notifie le panneau par un évènement DOM ; s'il
  // est ouvert, vtt-dice.js le re-render. Jamais un historique factice : vrai résultat.
  const _modSigned = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '±0';
  VS.rollHistory.unshift({
    kind: 'skill', label: skillName, skillName, stat,
    mod, mode: effectiveRollMode, bonus: VS.rollBonus || 0,
    formulaStr: `1d20 ${_modSigned}`, total, crit: isCrit, fail: isFumble, simulated,
  });
  if (VS.rollHistory.length > 6) VS.rollHistory.length = 6;
  if (simulated) {
    VS.rollSimulated = false;
    VS.rollSimValues = [];
  }
  document.dispatchEvent(new CustomEvent('vtt-roll-history'));
}

export async function _saveEmotes(list) {
  try {
    await saveDoc('world', 'vtt_emotes', { emotes: list });
    _emotes = list;
    return true;
  } catch(e) {
    showNotif('Erreur sauvegarde émotes : ' + e.message, 'error');
    return false;
  }
}

// Convertit les balises :nom: en <img> dans un texte déjà échappé
export function _applyEmotes(escaped) {
  for (const [name, em] of createEmoteLookup(_emotes)) {
    const key = `:${_esc(name)}:`;
    const img = `<img class="vtt-emote-inline" src="${_esc(em.url)}" alt="${key}" title="${key}">`;
    escaped = escaped.split(key).join(img);
  }
  return escaped;
}

// Favoris (« Roue ») + récents — stockés en localStorage (clés inchangées).
export const _getFavs = () => resolveEmoteNames(lsJson.get('vtt-emote-favs', []), _emotes);
export const _setFavs = v => lsJson.set('vtt-emote-favs', v);
export const _getRecents = () => resolveEmoteNames(lsJson.get('vtt-emote-recents', []), _emotes);
export function _pushRecent(name) {
  const canonical = createEmoteLookup(_emotes).get(sanitizeEmoteName(name))?.name || sanitizeEmoteName(name);
  const r = _getRecents().filter(n => n !== canonical);
  r.unshift(canonical);
  lsJson.set('vtt-emote-recents', r.slice(0, 12));   // portée 8 → 12
}

// ── État UI du picker ───────────────────────────────────────────────
let _emoteTab   = 'fav';     // 'fav' (Roue) | 'rec' (Récents) | 'all' (Toutes)
let _emoteQuery = '';
let _emoteMenu  = false;     // dropdown « depuis [token] » ouvert
let _emoteHover = null;      // émote survolée (aperçu du pied)
let _emoteLast  = null;      // dernière émote envoyée (badge du bouton de session)
let _emoteJustOpened = false; // auto-focus recherche à l'ouverture uniquement
// Combo côté émetteur : compteur cumulé écrit dans Firestore (robuste à la
// fusion d'écritures par onSnapshot — cf. handoff §4).
let _emoteCombo = { key: null, count: 0, ts: 0 };

// Couleur stable par token (anneau des bulles / avatar émetteur) — pas de champ
// couleur sur les tokens, on dérive d'un hash de l'identité.
const _EMOTE_COLORS = ['#4f8cff', '#9d6fff', '#22c38e', '#f4c430', '#ff5a7e', '#ff9544', '#38bdf8', '#a3e635'];
export function _emoteTokenColor(t) {
  const seed = String(t?.ownerId || t?.characterId || t?.id || t?.name || '?');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return _EMOTE_COLORS[h % _EMOTE_COLORS.length];
}

function _emoteAvatar(t) {
  const live = _live(t);
  const name = live?.displayName || t?.name || '?';
  const image = normalizeImageUrl(live?.displayImage || t?.imageUrl || '');
  return `<span class="vtt-emote-av" style="--c:${_emoteTokenColor(t)}">
    <span class="vtt-emote-av-initial">${_esc(name[0] || '?')}</span>
    ${image ? `<img src="${_esc(image)}" alt="" loading="lazy" draggable="false">` : ''}
  </span>`;
}

// ── Émetteur (token qui envoie) ─────────────────────────────────────
function _emoteControllable() {
  const uid = STATE.user?.uid;
  const pid = VS.activePage?.id || null;
  return Object.entries(VS.tokens || {})
    .filter(([, e]) => e?.data && e.data.pageId === pid && _canControlToken(e.data, uid))
    .map(([id, e]) => ({ id, data: e.data }));
}
function _emoteIsMine(t) {
  const uid = STATE.user?.uid;
  if (!uid) return false;
  if (t.ownerId === uid) return true;
  return Array.isArray(t.controlDelegates) && t.controlDelegates.includes(uid);
}
// Émetteur courant : mémorisé (VS.emoteEmitterId) s'il reste contrôlable sur la
// page, sinon résolu depuis la sélection (resolveControlledTokenId).
export function _emoteEmitterId() {
  const uid = STATE.user?.uid;
  const pid = VS.activePage?.id || null;
  const cur = VS.emoteEmitterId;
  if (cur && VS.tokens[cur]?.data?.pageId === pid && _canControlToken(VS.tokens[cur].data, uid)) return cur;
  const id = resolveControlledTokenId(VS.selected, VS.tokens, pid, t => _canControlToken(t, uid)) || null;
  VS.emoteEmitterId = id;
  return id;
}
// Appelé depuis vtt.js quand on clique un token qu'on contrôle.
export function _vttSetEmoteEmitter(tokenId) {
  const uid = STATE.user?.uid;
  const t = VS.tokens[tokenId]?.data;
  if (!t || !_canControlToken(t, uid)) return;
  if (VS.emoteEmitterId === tokenId) return;
  VS.emoteEmitterId = tokenId;
  if (document.getElementById('vtt-emote-picker')?.classList.contains('open')) _renderEmotePicker();
}

// ── Tuiles ──────────────────────────────────────────────────────────
function _emoteTiles(list, favs) {
  if (!list.length) return '';
  return list.map(em => {
    const safe = _esc(em.name);
    const fi = favs.indexOf(em.name);
    const isFav = fi >= 0;
    const kbd = isFav && fi < 8 ? `<kbd>${fi + 1}</kbd>` : '';
    return `<div class="vtt-emote-tile${isFav ? ' is-favorite' : ''}" data-emote="${safe}" title=":${safe}:">
      <img src="${em.url}" alt=":${safe}:" loading="lazy" draggable="false">${kbd}
      <button class="vtt-emote-star${isFav ? ' on' : ''}" data-vtt-fn="_vttToggleFav" data-vtt-args="${safe}" title="${isFav ? 'Retirer de la roue' : 'Ajouter à la roue'}" aria-label="${isFav ? 'Retirer cette émote des favoris' : 'Ajouter cette émote aux favoris'}" aria-pressed="${isFav}">${isFav ? '★' : '☆'}</button>
    </div>`;
  }).join('');
}

function _emoteListFor() {
  const q = _emoteQuery.trim();
  if (q) return _emotes.filter(e => _searchIncludes(e.name, q) || (e.aliases || []).some(alias => _searchIncludes(alias, q)));
  const byName = new Map(_emotes.map(e => [e.name, e]));
  if (_emoteTab === 'fav') return _getFavs().map(n => byName.get(n)).filter(Boolean);
  if (_emoteTab === 'rec') return _getRecents().map(n => byName.get(n)).filter(Boolean);
  return _emotes;
}

export function _renderEmotePicker() {
  const el = document.getElementById('vtt-emote-picker');
  if (!el) return;
  if (!_emotes.length) {
    el.innerHTML = `<div class="vtt-emote-hd"><h3>Émotes</h3><span class="vtt-emote-grow"></span><button class="vtt-emote-x" data-vtt-fn="_vttToggleEmotePicker" title="Fermer">✕</button></div>
      <div class="vtt-emote-empty"><b>Aucune émote</b>À configurer dans la Console MJ.</div>`;
    return;
  }
  const favs = _getFavs();
  const q = _emoteQuery.trim();
  const list = _emoteListFor();

  // En-tête : titre + sélecteur d'émetteur + fermer.
  const emitterId = _emoteEmitterId();
  const emitter = emitterId ? VS.tokens[emitterId]?.data : null;
  const ctrl = _emoteControllable();
  const emitterBtn = emitter
    ? `<button class="vtt-emote-emitter" data-vtt-fn="_vttEmoteMenu" title="Token qui envoie l'émote">${_emoteAvatar(emitter)}<small>depuis</small><b>${_esc(emitter.name || 'Token')}</b>${ctrl.length > 1 ? '<i>▾</i>' : ''}</button>`
    : `<button class="vtt-emote-emitter" data-vtt-fn="_vttEmoteMenu" title="Aucun token contrôlable"><small>depuis</small><b>—</b></button>`;
  const item = (x) => `<button class="${x.id === emitterId ? 'on' : ''}" data-vtt-fn="_vttEmotePickEmitter" data-vtt-args="${x.id}">${_emoteAvatar(x.data)}<span>${_esc(x.data.name || 'Token')}</span></button>`;
  const mine = ctrl.filter(x => _emoteIsMine(x.data));
  const others = ctrl.filter(x => !_emoteIsMine(x.data));
  const menu = (_emoteMenu && ctrl.length > 1)
    ? `<div class="vtt-emote-emenu">${mine.length ? `<div class="vtt-emote-emenu-lbl">${STATE.isAdmin ? 'Mes tokens' : 'Mes tokens'}</div>` + mine.map(item).join('') : ''}${others.length ? `<div class="vtt-emote-emenu-lbl">Sur la scène</div>` + others.map(item).join('') : ''}</div>`
    : '';

  // Onglets ou « Résultats N ».
  const tabs = q
    ? `<span class="vtt-emote-tab on">Résultats <small>${list.length}</small></span>`
    : [['fav', '★ Roue', favs.length], ['rec', 'Récents', _getRecents().length], ['all', 'Toutes', _emotes.length]]
        .map(([k, l, n]) => `<button class="vtt-emote-tab${_emoteTab === k ? ' on' : ''}" data-vtt-fn="_vttEmoteTab" data-vtt-args="${k}">${l} <small>${n}</small></button>`).join('');

  // Corps.
  let body;
  if (!list.length) {
    body = q
      ? `<div class="vtt-emote-empty"><b>Aucune émote</b>pour « ${_esc(_emoteQuery)} »</div>`
      : _emoteTab === 'fav'
        ? `<div class="vtt-emote-empty"><b>Ta roue est vide</b>Clique sur ☆ en coin d'une émote dans « Toutes » pour l'ajouter à la roue (touche E) et aux touches 1–8.</div>`
        : `<div class="vtt-emote-empty"><b>Rien d'envoyé pour l'instant</b></div>`;
  } else {
    body = `<div class="vtt-emote-grid2">${_emoteTiles(list, favs)}</div>`;
  }

  // Pied fixe (hauteur constante) : aperçu au survol, sinon rappel des gestes.
  const foot = _emoteFootHtml();

  el.innerHTML = `
    <div class="vtt-emote-hd"><h3>Émotes</h3><div class="vtt-emote-emitwrap">${emitterBtn}${menu}</div><span class="vtt-emote-grow"></span><button class="vtt-emote-x" data-vtt-fn="_vttToggleEmotePicker" title="Fermer · Échap">✕</button></div>
    <div class="vtt-emote-search"><input id="vtt-emote-q" type="text" placeholder="Rechercher une émote…  (Entrée pour envoyer)" autocomplete="off" value="${_esc(_emoteQuery)}"></div>
    <div class="vtt-emote-tabs">${tabs}</div>
    <div class="vtt-emote-body"><div id="vtt-emote-grid">${body}</div></div>
    <div class="vtt-emote-foot" id="vtt-emote-foot">${foot}</div>`;

  _bindEmoteInputs();
}

function _emoteFootHtml() {
  const em = _emoteHover ? _emotes.find(e => e.name === _emoteHover) : null;
  if (em) {
    return `<span class="vtt-emote-pv"><img src="${em.url}" alt=""></span><div class="vtt-emote-pv-b"><b>:${_esc(em.name)}:</b><div class="vtt-emote-hints"><span><em>Clic</em> envoyer</span><span><em>Maintenir</em> amplifier</span><span><em>Glisser</em> viser</span><span><em>☆</em> roue</span></div></div>`;
  }
  return `<div class="vtt-emote-pv-b"><b>Roue : maintiens <kbd>E</kbd></b><div class="vtt-emote-hints"><span><em>☆</em> sur une émote pour l'y ajouter</span><span><kbd>1</kbd>–<kbd>8</kbd> envoi direct</span></div></div>`;
}

// Liaisons (recherche + survol du pied) — préserve le focus/caret.
function _bindEmoteInputs() {
  document.querySelectorAll('.vtt-emote-av img').forEach(img => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
  const q = document.getElementById('vtt-emote-q');
  if (q) {
    q.oninput = e => { _emoteQuery = e.target.value; _renderEmotePicker(); };
    q.onkeydown = e => {
      if (e.key === 'Enter') { const f = _emoteListFor()[0]; if (f) _vttSendEmote(f.name); }
      else if (e.key === 'Escape') { if (_emoteQuery) { _emoteQuery = ''; _renderEmotePicker(); } else _closeEmotePicker(); e.stopPropagation(); }
    };
    if (_emoteJustOpened) { _emoteJustOpened = false; setTimeout(() => document.getElementById('vtt-emote-q')?.focus(), 30); }
  }
  const grid = document.getElementById('vtt-emote-grid');
  if (grid) {
    grid.onmouseover = e => { const t = e.target.closest('.vtt-emote-tile'); const n = t?.dataset.emote || null; if (n !== _emoteHover) { _emoteHover = n; _refreshEmoteFoot(); } };
    grid.onmouseleave = () => { if (_emoteHover) { _emoteHover = null; _refreshEmoteFoot(); } };
  }
}
function _refreshEmoteFoot() { const f = document.getElementById('vtt-emote-foot'); if (f) f.innerHTML = _emoteFootHtml(); }
function _renderEmotePickerIfOpen() { if (document.getElementById('vtt-emote-picker')?.classList.contains('open')) _renderEmotePicker(); }

// ── Onglets / émetteur / favoris ────────────────────────────────────
export function _vttEmoteTab(tab) { _emoteTab = tab; _emoteMenu = false; _renderEmotePicker(); }
export function _vttEmoteMenu() { _emoteMenu = !_emoteMenu; _renderEmotePicker(); }
export function _vttEmotePickEmitter(tokenId) { VS.emoteEmitterId = tokenId; _emoteMenu = false; _renderEmotePicker(); }

export function _vttToggleFav(name) {
  const favs = _getFavs();
  const idx = favs.indexOf(name);
  const had = idx >= 0;
  if (had) favs.splice(idx, 1); else favs.push(name);
  _setFavs(favs);
  showNotif(had ? 'Retirée de la roue' : (favs.length > 8 ? 'Ajoutée — la roue affiche les 8 premières' : `Ajoutée à la roue · touche ${favs.length}`), 'info');
  _renderEmotePicker();
}

// ── Ouverture / fermeture. Le glisser démarre dans le panneau, donc la fermeture
// au clic extérieur reste compatible avec le dépôt d'une émote sur la carte. ──
export function _closeEmotePicker() {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  el?.classList.remove('open');
  el?.setAttribute('aria-hidden', 'true');
  btn?.classList.remove('open');
  btn?.setAttribute('aria-expanded', 'false');
  _emoteMenu = false;
  if (_emoteCloseOutside) {
    document.removeEventListener('mousedown', _emoteCloseOutside, true);
    _emoteCloseOutside = null;
  }
  syncVttSessionDock();
}

export function _vttToggleEmotePicker() {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  if (!el) return;
  const willOpen = !el.classList.contains('open');
  if (willOpen) openVttSessionDockPanel('emote');
  const open = el.classList.toggle('open', willOpen);
  btn?.classList.toggle('open', open);
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    _emoteMenu = false; _emoteJustOpened = true; _renderEmotePicker(); syncVttSessionDock();
    const closeOutside = event => {
      const float = document.querySelector('.vtt-emote-float');
      if (float && !float.contains(event.target)) _closeEmotePicker();
    };
    _emoteCloseOutside = closeOutside;
    requestAnimationFrame(() => {
      if (_emoteCloseOutside === closeOutside) document.addEventListener('mousedown', closeOutside, true);
    });
  }
  else _closeEmotePicker();
}

// Reflet de la dernière émote sur le bouton de la barre de session.
export function _updateEmoteTrigger(name) {
  if (name) _emoteLast = name;
  const btn = document.querySelector('.vtt-emote-trigger');
  if (!btn) return;
  const em = _emoteLast ? _emotes.find(e => e.name === _emoteLast) : null;
  btn.dataset.lastEmote = em?.name || '';
}

registerVttSessionDockPanel('emote', 'vtt-emote-picker', '.vtt-emote-trigger', _closeEmotePicker, 'open');

// ── Envoi (clic / roue / touche / geste) ────────────────────────────
// opts : { big, targetTokenId }
export async function _vttSendEmote(name, opts = {}) {
  const uid = STATE.user?.uid; if (!uid) return;
  const em = _emotes.find(e => e.name === name); if (!em) return;
  const tokenId = _emoteEmitterId();
  const token = tokenId ? VS.tokens[tokenId]?.data : null;
  if (!token || !_canControlToken(token, uid)) {
    showNotif('Sélectionne un token que tu contrôles pour envoyer une émote.', 'info');
    return;
  }
  const big = !!opts.big;
  const targetTokenId = (opts.targetTokenId && opts.targetTokenId !== tokenId) ? opts.targetTokenId : null;

  // Combo : même émote + émetteur + cible, non amplifié, fenêtre courte.
  const comboKey = `${tokenId}|${name}|${targetTokenId || ''}`;
  const now = Date.now();
  if (!big && _emoteCombo.key === comboKey && now - _emoteCombo.ts < 2600) _emoteCombo.count++;
  else _emoteCombo = { key: comboKey, count: 1, ts: now };
  _emoteCombo.ts = now;
  const count = _emoteCombo.count;

  _pushRecent(name);
  const ts = now;
  const key = `${uid}_${ts}`;
  // Affichage local immédiat (ancré au token émetteur).
  _showEmoteBubble(tokenId, em.url, name, key, { big, targetTokenId, remote: false, count });

  // Propagation temps réel. Une réaction n'embarque aucune identité textuelle :
  // le token d'origine suffit et aucune adresse de compte ne doit être exposée.
  _broadcastReaction(uid, {
    tokenId, emoteName: name, emoteUrl: em.url,
    pageId: VS.activePage?.id ?? null,
    createdAt: ts,
    big, targetTokenId: targetTokenId || null, count,
  });

  // Statistiques : compte l'émote (attribuée au personnage du token émetteur), chaque envoi.
  if (token.characterId) bumpEmote(token.characterId, VS.characters[token.characterId]?.nom || token.name, name);

  _emoteLast = name;
  if (_emoteTab === 'rec') _renderEmotePickerIfOpen();
}

// Quota : un combo (clics rapides) écrivait le doc de réaction à chaque clic,
// relu par chaque client. Le 1er clic part tout de suite, les suivants au plus
// toutes les 500 ms avec le compteur courant (les autres voient ×1 puis ×N).
const _REACTION_THROTTLE_MS = 500;
let _reactionLastWrite = 0, _reactionTimer = null, _reactionPending = null;
function _writeReaction(uid, payload) {
  _reactionLastWrite = Date.now();
  setDoc(_reactionRef(uid), payload).catch(err => {
    console.error('[vtt] émote temps réel — écriture refusée. Vérifier vttEmoteReactions dans Firestore.', err);
  });
}
function _broadcastReaction(uid, payload) {
  const wait = _REACTION_THROTTLE_MS - (Date.now() - _reactionLastWrite);
  if (wait <= 0 && !_reactionTimer) { _writeReaction(uid, payload); return; }
  _reactionPending = { uid, payload };
  if (_reactionTimer) return;
  _reactionTimer = setTimeout(() => {
    _reactionTimer = null;
    const pending = _reactionPending; _reactionPending = null;
    if (pending) _writeReaction(pending.uid, pending.payload);
  }, Math.max(0, wait));
}

// Compat : ancien handler de clic sur une tuile → envoi normal.
export const _vttPickEmote = (name) => _vttSendEmote(name);

// ══════════════════════════════════════════════════════════════════════
// GESTES : clic / maintien (amplifié) / glisser (ciblé) + roue E + touches 1-8
// ══════════════════════════════════════════════════════════════════════
let _emoteGesturesInit = false;
let _EP = null;                                   // geste pointeur en cours (tuile)
let _EW = null;                                   // roue rapide (E) en cours
let _emoteMouse = { x: innerWidth / 2, y: innerHeight / 2 };

const _emoteTyping = (e) => {
  const el = e.target;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};
const _emoteInCanvas = () => !!document.getElementById('vtt-canvas-wrap')
  && !document.getElementById('modal-overlay')?.classList.contains('show');

function _emoteEndDrag() {
  if (!_EP) return;
  clearTimeout(_EP.timer);
  _EP.ghost?.remove();
  _EP.el?.classList.remove('charging', 'charged');
  try { _vttEmoteDropHalo(null); } catch { /* stage absent */ }
  _EP = null;
}

export function _initEmoteGestures() {
  if (_emoteGesturesInit) return;
  _emoteGesturesInit = true;

  // ── Pointerdown sur une tuile (délégué, scopé au picker ouvert) ──
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.vtt-emote-star')) return;
    const picker = document.getElementById('vtt-emote-picker');
    if (!picker?.classList.contains('open')) return;
    const tile = e.target.closest('.vtt-emote-tile');
    if (!tile || !picker.contains(tile)) return;
    e.preventDefault();
    _EP = { name: tile.dataset.emote, el: tile, x: e.clientX, y: e.clientY, big: false, drag: false, ghost: null, over: null };
    tile.classList.add('charging');
    _EP.timer = setTimeout(() => { if (!_EP) return; _EP.big = true; _EP.el.classList.add('charged'); _EP.ghost?.classList.add('big'); }, 450);
  }, true);

  // ── Déplacement : fantôme + hit-test Konva de la cible ──
  document.addEventListener('pointermove', (e) => {
    _emoteMouse = { x: e.clientX, y: e.clientY };
    if (_EW) _emoteWheelSelect(e.clientX, e.clientY);
    if (!_EP) return;
    if (!_EP.drag && Math.hypot(e.clientX - _EP.x, e.clientY - _EP.y) > 7) {
      _EP.drag = true;
      if (!_EP.big) { clearTimeout(_EP.timer); _EP.el.classList.remove('charging'); }
      const em = _emotes.find(x => x.name === _EP.name);
      _EP.ghost = document.createElement('div');
      _EP.ghost.className = 'vtt-emote-ghost' + (_EP.big ? ' big' : '');
      _EP.ghost.innerHTML = `<img src="${em?.url || ''}" alt=""><small>Lâche sur un token</small>`;
      document.body.appendChild(_EP.ghost);
    }
    if (!_EP.drag) return;
    _EP.ghost.style.left = e.clientX + 'px';
    _EP.ghost.style.top = e.clientY + 'px';
    const emitterId = _emoteEmitterId();
    const id = _vttTokenIdAtClient(e.clientX, e.clientY);
    const tgt = (id && id !== emitterId) ? id : null;
    if (tgt !== _EP.over) {
      _EP.over = tgt;
      _EP.ghost.classList.toggle('hit', !!tgt);
      try { _vttEmoteDropHalo(tgt); } catch { /* stage absent */ }
      const small = _EP.ghost.querySelector('small');
      if (small) small.textContent = tgt ? `→ ${VS.tokens[tgt]?.data?.name || '?'}` : 'Lâche sur un token';
    }
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!_EP) return;
    const { name, big, drag, over } = _EP;
    _emoteEndDrag();
    if (drag) {
      if (over) _vttSendEmote(name, { big, targetTokenId: over });
      else showNotif('Glisse l\'émote sur un token pour le viser', 'info');
    } else {
      _vttSendEmote(name, { big });
    }
  }, true);

  // ── Suivi souris (position de la roue) ──
  document.addEventListener('mousemove', (e) => { _emoteMouse = { x: e.clientX, y: e.clientY }; });

  // ── Roue (E maintenu) + touches 1-8 ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (_EW) _emoteCloseWheel(false); return; }
    if (_emoteTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'e' || e.key === 'E') && !e.repeat && !_EW) {
      if (!_emoteInCanvas()) return;
      e.preventDefault(); _emoteOpenWheel();
    } else if (/^[1-8]$/.test(e.key)) {
      if (!_emoteInCanvas()) return;
      const n = _getFavs()[+e.key - 1];
      if (n) { e.preventDefault(); _vttSendEmote(n); }
    }
  });
  document.addEventListener('keyup', (e) => { if ((e.key === 'e' || e.key === 'E') && _EW) _emoteCloseWheel(true); });
  window.addEventListener('blur', () => { _emoteCloseWheel(false); _emoteEndDrag(); });
}

// ── Roue rapide des 8 premiers favoris (zone morte 30 px) ──
function _emoteOpenWheel() {
  const byName = new Map(_emotes.map(e => [e.name, e]));
  const favs = _getFavs().slice(0, 8).map(n => byName.get(n)).filter(Boolean);
  if (!favs.length) { showNotif('Roue vide : clique ☆ sur une émote pour l\'ajouter', 'info'); return; }
  const x = Math.max(130, Math.min(innerWidth - 130, _emoteMouse.x));
  const y = Math.max(130, Math.min(innerHeight - 130, _emoteMouse.y));
  const w = document.createElement('div');
  w.className = 'vtt-emote-wheel';
  w.style.left = x + 'px'; w.style.top = y + 'px';
  w.innerHTML = '<div class="vtt-emote-wheel-bg"></div>' + favs.map((em, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / favs.length;
    return `<div class="vtt-emote-wslot" data-i="${i}" style="left:${Math.cos(a) * 84}px;top:${Math.sin(a) * 84}px"><img src="${em.url}" alt=""><kbd>${i + 1}</kbd></div>`;
  }).join('') + '<div class="vtt-emote-wcenter" id="vtt-emote-wc"></div>';
  document.body.appendChild(w);
  _EW = { el: w, x, y, favs, sel: null };
  _emoteWheelSelect(_emoteMouse.x, _emoteMouse.y);
}
function _emoteWheelSelect(mx, my) {
  if (!_EW) return;
  const dx = mx - _EW.x, dy = my - _EW.y, n = _EW.favs.length;
  let sel = null;
  if (Math.hypot(dx, dy) > 30) { let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += 2 * Math.PI; sel = Math.round(a / (2 * Math.PI / n)) % n; }
  _EW.sel = sel;
  _EW.el.querySelectorAll('.vtt-emote-wslot').forEach(s => s.classList.toggle('on', +s.dataset.i === sel));
  const wc = document.getElementById('vtt-emote-wc');
  if (wc) wc.innerHTML = sel == null ? 'Vise une émote<br>puis relâche E' : `<b>:${_esc(_EW.favs[sel].name)}:</b>relâche pour envoyer`;
}
function _emoteCloseWheel(go) {
  if (!_EW) return;
  const sel = _EW.sel, favs = _EW.favs;
  _EW.el.remove(); _EW = null;
  if (go && sel != null) _vttSendEmote(favs[sel].name);
}

export async function _ouvrirGestionEmotes() {
  await _loadEmotes();
  const { openEmoteAdminModal } = await import('./vtt-emote-admin.js');
  await openEmoteAdminModal({
    emotes: _emotes,
    save: _saveEmotes,
    onSaved: _renderEmotePickerIfOpen,
  });
}
