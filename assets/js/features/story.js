// ══════════════════════════════════════════════════════════════════════════════
// STORY.JS — La Trame v2
// ✓ Actes persistés en Firestore (visibles même vides)
// ✓ Upload + recadrage d'image canvas 4:3 (identique aux hauts-faits)
// ✓ Liens inter-missions (flèches SVG entre axes différents)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, saveDoc, deleteFromCol, getDocData, getCachedCollection } from '../data/firestore.js';
import { confirmDelete, tryDoc } from '../shared/crud.js';
import { navigate } from '../core/navigation.js';
import { openModal, pushModal, popModal, closeModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { _esc, _nl2br } from '../shared/html.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import PAGES, { requestStatsScope } from './pages.js';
import { sortCharactersForDisplay, getMyCharacters } from '../shared/char-stats.js';
import { setHistoireCtx } from '../shared/histoire-ctx.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import { storyParticipantsFromGroups, toggleQuestParticipant, dedupeQuestParticipants, questParticipantFromChar } from '../shared/participants.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { removeQuestAgendaSessions } from '../shared/agenda-sessions.js';
import { watchPageCollection } from '../shared/realtime.js';

// ── Palettes ──────────────────────────────────────────────────────────────────
// Palette d'axes distincte des couleurs de statut (En cours / Terminée / Échouée)
// pour ne pas confondre la teinte d'une ligne d'axe et celle d'un nœud. Handoff §4.2.
const AXE_COLORS = [
  '#9d6fff','#f4c430','#ff9544','#38bdf8','#ff6b9d','#a3e635',
];
const AXE_COLOR_NAMES = ['Violet', 'Or', 'Orange', 'Bleu', 'Rose', 'Vert'];

const STATUT_CFG = {
  'Terminée':   { color:'#22c38e', border:'rgba(34,195,142,0.35)',  icon:'✓' },
  'En cours':   { color:'#4f8cff', border:'rgba(79,140,255,0.35)',  icon:'▶' },
  'Échouée':    { color:'#ff6b6b', border:'rgba(255,107,107,0.35)', icon:'✗' },
  'En attente': { color:'#666',    border:'rgba(128,128,128,0.25)', icon:'◷' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function stCfg(item){ return STATUT_CFG[item.statut] || STATUT_CFG['En attente']; }

// Issue d'un groupe, dérivée de sa réussite (%). Permet d'afficher clairement
// quand des groupes divergent (l'un réussit, l'autre échoue) là où le statut
// global de la mission ne le montre pas.
function groupOutcome(g){
  const raw = g?.reussite;
  if (raw == null || raw === '' || isNaN(parseInt(raw)))
    return { key:'attente',   label:'En attente', icon:'◷', color:'#8a93a3' };
  const v = parseInt(raw);
  if (v >= 70) return { key:'reussie',   label:'Réussie',   icon:'✓', color:'#22c38e' };
  if (v >= 30) return { key:'partielle', label:'Partielle', icon:'◑', color:'#e8b84b' };
  return        { key:'echec',     label:'Échouée',   icon:'✗', color:'#ff6b6b' };
}
// Pastilles compactes d'issue par groupe (≥2 groupes). `is-mixed` si divergence.
function _groupsDotsHtml(item){
  const gs = item.groupes || [];
  if (gs.length < 2) return '';
  const outs = gs.map(groupOutcome);
  const mixed = new Set(outs.map(o => o.key)).size > 1;
  const dots = gs.map((g,i) => `<span class="grp-dot" style="--oc:${outs[i].color}" title="${_esc(g.nom||'Groupe')} · ${outs[i].label}"></span>`).join('');
  return `<span class="grp-dots${mixed?' is-mixed':''}" title="${mixed?'Résultats divergents selon les groupes':'Résultats homogènes'}">${dots}</span>`;
}


const STORE = {
  axeMap:         {},   // couleurs réellement utilisées dans l'acte affiché
  axeColors:      {},   // couleurs personnalisées persistées par nom d'axe
  modalGroupes:   [],   // groupes du modal ouvert (mission courante)
  modalStoryId:   '',   // id de la mission en édition ('' = nouvelle)
  editingGroupId: null, // id du groupe en cours de modification (null = création)
  storyActe:      '',   // acte filtré dans la sidebar
  mapItemsCache:  [],   // cache items de la carte (PNJ, lieux…)
};

let _stCropper   = null;

// ── Préférences persistées (handoff STORY.md §11) ─────────────────────────────
const STORY_PREFS_KEY = 'story-prefs-v2';
const STORY_PREFS_DEFAULT = { view: 'carte', search: '', statut: '', playerScope: 'all', mapDensity: 1, mapX: null, listSort: { k: 'ch', d: 1 }, listGroup: 'none' };
function getStoryPrefs() {
  let p;
  try { p = { ...STORY_PREFS_DEFAULT, ...(JSON.parse(localStorage.getItem(STORY_PREFS_KEY)) || {}) }; }
  catch { p = { ...STORY_PREFS_DEFAULT }; }
  if (p.view === 'chronique') p.view = 'saga';   // vue Chronique retirée (handoff v2)
  return p;
}
function setStoryPrefs(patch) {
  try { localStorage.setItem(STORY_PREFS_KEY, JSON.stringify({ ...getStoryPrefs(), ...patch })); }
  catch {}
}

// Abonnement live de la Trame : re-render quand une mission change (statut,
// ordre, récit, participants…) sans attendre une actualisation manuelle.
// Garde par signature : l'émission initiale (asynchrone) de subscribeCollection
// renvoie les données déjà affichées → signature identique → aucun re-render,
// donc pas de boucle. Collection session-live : zéro lecture facturée en plus.
let _storySig = null;
function _storySignature(items = []) {
  return (items || []).map(m =>
    `${m.id}:${m.statut || ''}:${m.ordre ?? ''}:${m.acte || ''}:${m.axe || ''}:${m.date || ''}:${m.lieu || ''}:${m.type || ''}` +
    `:${m.titre || ''}:${m.visibleJoueurs === false ? 0 : 1}:${m.imageUrl ? 1 : 0}:${(m.description || '').length}` +
    `:${(Array.isArray(m.participants) ? m.participants.length : 0)}` +
    `:${(Array.isArray(m.groupes) ? m.groupes.map(g => `${g.nom || ''}=${g.reussite ?? ''}`).join('~') : '')}`
  ).join('|');
}

function _storyMissionIdsForPlayer(items = [], groups = []) {
  const uid = STATE.user?.uid || '';
  const chars = getMyCharacters(getCachedCollection('characters') || STATE.characters || [], uid);
  const charIds = new Set(chars.map(char => char.id).filter(Boolean));
  const missionIds = new Set();

  (groups || []).forEach(group => {
    const belongsToPlayer = dedupeQuestParticipants(group?.participants || []).some(participant =>
      (uid && participant?.uid === uid) || (participant?.charId && charIds.has(participant.charId))
    );
    if (belongsToPlayer && group?.missionId) missionIds.add(group.missionId);
  });

  (items || []).forEach(item => {
    const belongsToPlayer = (Array.isArray(item?.participants) ? item.participants : []).some(participant => {
      const charId = typeof participant === 'string' ? participant : participant?.id || participant?.charId;
      return (uid && participant?.uid === uid) || (charId && charIds.has(charId));
    });
    const belongsToLegacyGroup = (Array.isArray(item?.groupes) ? item.groupes : []).some(group => {
      const memberIds = Array.isArray(group?.membres) ? group.membres : [];
      const participants = Array.isArray(group?.participants) ? group.participants : [];
      return memberIds.some(charId => charIds.has(charId)) || participants.some(participant =>
        (uid && participant?.uid === uid) || (participant?.charId && charIds.has(participant.charId))
      );
    });
    if ((belongsToPlayer || belongsToLegacyGroup) && item?.id) missionIds.add(item.id);
  });

  return missionIds;
}

// Avancement d'une mission : 100 si Terminée, 0 si Échouée, sinon moyenne des
// réussites des groupes, sinon 50 si En cours, sinon 0.
function itemProgress(item) {
  if (item.statut === 'Terminée') return 100;
  if (item.statut === 'Échouée')  return 0;
  const groupes = item.groupes || [];
  if (groupes.length) {
    const vals = groupes.map(g => parseInt(g.reussite) || 0);
    return Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
  }
  return item.statut === 'En cours' ? 50 : 0;
}

// Cache des items pour les handlers (tooltips, etc.)

// Normalisation pour recherche : minuscules + sans accents
// "Étoile" → "etoile", "Mystères" → "mysteres", "œuf" → "œuf" (non transformé mais OK)
function _normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const STORY_SLOT_LABELS = {
  m: { label: 'Matin', icon: '☀️', hours: '9h-13h' },
  a: { label: 'Aprem', icon: '🌤️', hours: '14h-18h' },
  s: { label: 'Soir', icon: '🌙', hours: '19h-23h' },
};

function _storyDateFr(iso = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _storyMissionSessions(nextSession, groups = []) {
  const groupIds = new Set((groups || []).map(g => g.id).filter(Boolean));
  const sessions = Array.isArray(nextSession?.sessions)
    ? nextSession.sessions
    : (nextSession?.date && nextSession?.slot ? [nextSession] : []);
  return sessions
    .filter(s => s?.date && groupIds.has(s.questId))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.slot || '').localeCompare(b.slot || ''));
}

function _storyMissionSessionHtml(sessions = [], groups = []) {
  if (!sessions.length) {
    return `<div class="mv-rel-empty">Aucune séance validée pour cette mission.</div>`;
  }
  const byGroup = new Map((groups || []).map(g => [g.id, g]));
  return `<div class="mv-rel-sessions">${sessions.slice(0, 3).map(s => {
    const slot = STORY_SLOT_LABELS[s.slot] || { label: 'Créneau', icon: '•', hours: '' };
    const group = byGroup.get(s.questId);
    return `<div class="mv-rel-session">
      <span class="mv-rel-date">${_esc(_storyDateFr(s.date))}</span>
      <span class="mv-rel-slot">${slot.icon} ${_esc(slot.label)}${slot.hours ? ` <small>${_esc(slot.hours)}</small>` : ''}</span>
      <span class="mv-rel-group">${_esc(group?.titre || group?.nom || s.questTitle || 'Groupe')}</span>
    </div>`;
  }).join('')}${sessions.length > 3 ? `<div class="mv-rel-more">+${sessions.length - 3} autre${sessions.length > 4 ? 's' : ''}</div>` : ''}</div>`;
}

function _storyOpenMissionStats(missionId) {
  requestStatsScope(missionId ? `mission:${missionId}` : null);
  navigate('statistiques');
}

function _normalizeAxeColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '';
}
function _previewAxeColor(row, color) {
  const safeColor = _normalizeAxeColor(color);
  if (!row || !safeColor) return;
  row.style.setProperty('--axe-color', safeColor);
  const customInput = row.querySelector('[data-axe-color]');
  if (customInput && customInput.value.toLowerCase() !== safeColor) customInput.value = safeColor;
  let presetSelected = false;
  row.querySelectorAll('[data-axe-preset]').forEach(button => {
    const selected = _normalizeAxeColor(button.dataset.color) === safeColor;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
    presetSelected ||= selected;
  });
  row.querySelector('.axe-order-custom-wrap')?.classList.toggle('is-active', !presetSelected);
}
function axeColor(axe){
  if(!axe) return '#555';
  if(!Object.prototype.hasOwnProperty.call(STORE.axeMap, axe)){
    STORE.axeMap[axe] = _normalizeAxeColor(STORE.axeColors?.[axe])
      || AXE_COLORS[Object.keys(STORE.axeMap).length % AXE_COLORS.length];
  }
  return STORE.axeMap[axe];
}
// Rang d'un axe pour l'ordre d'affichage (défini par le MJ via story_meta/axes).
// Axes non listés → juste avant « Hors axe » (qui est toujours en dernier).
function _axeRank(axe){
  if (axe === '__none__') return Number.MAX_SAFE_INTEGER;
  const i = (STORE.axeOrder || []).indexOf(axe);
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER - 1;
}

// ── Gestion des actes (Firestore) ─────────────────────────────────────────────
async function loadActes() {
  const doc = await getDocData('story_meta','actes');
  return Array.isArray(doc?.list) ? doc.list : [];
}
const saveActes = (list) => tryDoc('story_meta', 'actes', { list });

// ── Groupes de mission (modèle unique) ────────────────────────────────────────
// Un groupe = une quête liée à la mission (`quests.missionId`). La modale
// d'édition et la fiche mission affichent EXACTEMENT les mêmes cartes
// (`_storyGroupCardHtml`) : statut, réussite, récompense, membres, notes.
// L'ancien modèle `story.groupes` (nom + membres seulement) n'est plus édité ;
// il reste lisible pour la migration one-click (`_stMigrateGroups`).
function _missionQuestGroups(missionId) {
  if (!missionId) return [];
  return (getCachedCollection('quests') || [])
    .filter(q => q.missionId === missionId)
    .sort((a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'));
}

// Corps du panneau « Groupes » — identique à la section Groupes de la fiche.
function _renderGroupsPanel(missionId) {
  if (!missionId) {
    return `<div class="st-groups-empty">
      <span class="st-groups-empty-icon">👥</span>
      <strong>Enregistre d'abord la mission</strong>
      <span>Les groupes se rattachent à une mission existante. Enregistre, puis rouvre « Modifier » pour les gérer.</span>
    </div>`;
  }
  const groups = _missionQuestGroups(missionId);
  if (!groups.length) {
    return `<div class="st-groups-empty">
      <span class="st-groups-empty-icon">👥</span>
      <strong>Aucun groupe pour cette mission</strong>
      <span>Crée un groupe pour rattacher les personnages et suivre leur réussite séparément.</span>
    </div>`;
  }
  return `<div class="mv-groups">${groups.map(g => _storyGroupCardHtml(g, missionId)).join('')}</div>`;
}

// Après une écriture sur un groupe : rafraîchir le panneau de la modale
// d'édition s'il est ouvert, sinon rouvrir la fiche mission (comportement
// d'origine quand l'action vient de la fiche).
function _stRefreshGroups(missionId) {
  const list = document.getElementById('st-groups-list');
  if (!list) { openStoryDetail(missionId); return; }
  const groups = _missionQuestGroups(missionId);
  list.innerHTML = _renderGroupsPanel(missionId);
  const summary = document.getElementById('st-groups-summary');
  if (summary) summary.innerHTML = _renderMissionGroupSummary(groups);
  const count = document.getElementById('mn-tab-count-groupes');
  if (count) count.textContent = groups.length || '';
}

// ── Groupes de mission = quêtes liées (missionId) ─────────────────────────────
// Les joueurs rejoignent (champ participants, autorisé par les règles Firestore) ;
// le MJ crée / assigne des joueurs / édite en inline / supprime.
const _grpQuest = (id) => (getCachedCollection('quests') || []).find(q => q.id === id) || null;

// Carte d'un groupe (MJ = édition inline · joueur = lecture + rejoindre).
function _storyGroupCardHtml(g, missionId) {
  const isAdmin = STATE.isAdmin;
  const uid     = STATE.user?.uid;
  const parts   = dedupeQuestParticipants(g.participants || []);
  const o       = groupOutcome(g);
  const gr      = parseInt(g.reussite) || 0;
  const statut  = g.statut || 'active';
  const allChars = getCachedCollection('characters') || [];
  const av = (p) => characterAvatarHtml(p, { size: 28, className: 'mv-avatar', border: 'none', background: 'rgba(79,140,255,.18)', color: 'var(--gold)' });
  const notes = (g.notesReussite || '').split('\n').map(l => l.trim()).filter(Boolean);
  const notesHtml = notes.length
    ? `<ul class="mv-group-notes">${notes.map(n => `<li>${_esc(n)}</li>`).join('')}</ul>`
    : '';

  const membersHtml = parts.length
    ? parts.map(p => `<div class="mv-group-member">
        ${av(p)}
        <span class="mv-group-member-name">${_esc(p.nom || '')}</span>
        ${isAdmin ? `<button class="mv-group-memx" data-action="_stGroupRemoveMember" data-id="${g.id}" data-mission="${missionId}" data-char="${_esc(p.charId || '')}" data-uid="${_esc(p.uid || '')}" title="Retirer">×</button>` : ''}
      </div>`).join('')
    : `<div class="mv-empty-small">Aucun membre.</div>`;

  if (isAdmin) {
    const presentIds = new Set(parts.map(p => p.charId).filter(Boolean));
    const availableCount = allChars.filter(c => !presentIds.has(c.id)).length;
    const dc = (field, extra = '') => `data-change="_stGroupFieldSave" data-id="${g.id}" data-mission="${missionId}" data-field="${field}" ${extra}`;
    return `<article class="mv-group mv-group--edit" data-gid="${g.id}" style="--gr-color:${o.color}">
      <header class="mv-group-head">
        <input class="mv-group-name-inp" value="${_esc(g.titre || '')}" placeholder="Nom du groupe" ${dc('titre')}>
        <span class="mv-group-outcome" style="--oc:${o.color}">${o.icon} ${o.label}</span>
        <button class="mv-group-iconbtn mv-group-iconbtn--del" data-action="_stGroupDelete" data-id="${g.id}" data-mission="${missionId}" title="Supprimer le groupe">🗑️</button>
      </header>
      <div class="mv-group-editrow">
        <label>Statut<select class="mv-group-sel" ${dc('statut')}>
          ${[['active', 'En cours'], ['terminee', 'Terminée'], ['echouee', 'Échouée']].map(([v, l]) => `<option value="${v}"${statut === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <label>Réussite %<input class="mv-group-num" type="number" min="0" max="100" step="1" value="${g.reussite != null && g.reussite !== '' ? gr : ''}" placeholder="—" ${dc('reussite')}></label>
        <label>Récompense<input class="mv-group-inp" value="${_esc(g.recompense || '')}" placeholder="ex: 300 XP + 50 or" ${dc('recompense')}></label>
      </div>
      <div class="mv-group-bar"><div class="mv-group-bar-fill" style="width:${gr}%"></div></div>
      <div class="mv-group-members">${membersHtml}</div>
      <button type="button" class="mv-group-addbtn" data-action="_stGroupOpenMemberPicker" data-id="${g.id}" data-mission="${missionId}" ${availableCount ? '' : 'disabled'}>
        <span>＋ Ajouter un personnage</span>
        <small>${availableCount ? `${availableCount} disponible${availableCount > 1 ? 's' : ''}` : 'Groupe complet'}</small>
      </button>
      <textarea class="mv-group-notesinp" rows="${Math.max(2, Math.min(6, notes.length || 2))}" placeholder="Notes de réussite (une par ligne)..." ${dc('notesReussite')}>${_esc(g.notesReussite || '')}</textarea>
      ${notesHtml ? `<div class="mv-group-notes-preview">${notesHtml}</div>` : ''}
    </article>`;
  }

  // Carte joueur — lecture seule + rejoindre
  const joined  = !!uid && parts.some(p => p?.uid === uid);
  const myChars = getMyCharacters(allChars, uid);
  const canJoin = myChars.length > 0 && statut === 'active';
  const requis  = parseInt(g.participantsRequis) || 0;
  return `<article class="mv-group" data-gid="${g.id}" style="--gr-color:${o.color}">
    <header class="mv-group-head">
      <h4 class="mv-group-name">${_esc(g.titre || 'Groupe')}</h4>
      <span class="mv-group-outcome" style="--oc:${o.color}">${o.icon} ${o.label}</span>
      ${gr > 0 ? `<div class="mv-group-pct">${gr}<small>%</small></div>` : ''}
    </header>
    ${parts.length ? `<div class="mv-group-members">${membersHtml}</div>` : `<div class="mv-empty-small">Aucun membre${requis ? ` · ${requis} requis` : ''}.</div>`}
    ${gr > 0 ? `<div class="mv-group-bar"><div class="mv-group-bar-fill" style="width:${gr}%"></div></div>` : ''}
    ${notesHtml}
    ${g.recompense ? `<div class="mv-group-reward"><span class="mv-group-reward-icon">🏆</span><span>${_esc(g.recompense)}</span></div>` : ''}
    ${canJoin ? `<button class="btn btn-sm ${joined ? 'btn-outline' : 'btn-gold'} mv-group-join" data-action="_stGroupJoin" data-id="${g.id}" data-mission="${missionId}">${joined ? '✓ Quitter' : '＋ Rejoindre'}</button>` : ''}
  </article>`;
}

// Remplace une carte groupe in-place (sans re-render complet) — membres.
function _stReplaceGroupCard(questId, missionId) {
  const q = _grpQuest(questId);
  const el = document.querySelector(`.mv-group[data-gid="${questId}"]`);
  if (!q || !el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = _storyGroupCardHtml(q, missionId).trim();
  if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
}

// Patch léger de l'issue (badge + barre) sans toucher aux champs en édition.
function _stPatchGroupOutcome(questId) {
  const q = _grpQuest(questId);
  const card = document.querySelector(`.mv-group[data-gid="${questId}"]`);
  if (!q || !card) return;
  const o = groupOutcome(q);
  const gr = parseInt(q.reussite) || 0;
  card.style.setProperty('--gr-color', o.color);
  const badge = card.querySelector('.mv-group-outcome');
  if (badge) { badge.style.setProperty('--oc', o.color); badge.textContent = `${o.icon} ${o.label}`; }
  const fill = card.querySelector('.mv-group-bar-fill');
  if (fill) fill.style.width = `${gr}%`;
}

async function _stGroupNew(missionId) {
  if (!STATE.isAdmin || !missionId) return;
  try {
    await addToCol('quests', {
      missionId, titre: 'Nouveau groupe', statut: 'active',
      participants: [], participantsRequis: 0, difficulte: 'moyen',
    });
    showNotif('Groupe créé. Les joueurs peuvent le rejoindre.', 'success');
    _stRefreshGroups(missionId);
  } catch (e) { notifySaveError(e); }
}

async function _stGroupDelete(questId, missionId) {
  if (!STATE.isAdmin) return;
  const q = _grpQuest(questId);
  if (!await confirmModal(`Supprimer le groupe « ${q?.titre || 'Groupe'} » ?`)) return;
  try {
    await deleteFromCol('quests', questId);
    let removedSessions=0;
    let cleanupFailed=false;
    try {
      const agendaDoc=await getDocData('agenda_session','next').catch(()=>null);
      const cleaned=removeQuestAgendaSessions(agendaDoc,questId);
      removedSessions=cleaned.removed;
      if (removedSessions) {
        if (cleaned.sessions.length) await saveDoc('agenda_session','next',{ sessions:cleaned.sessions });
        else await deleteFromCol('agenda_session','next');
      }
    } catch (cleanupError) {
      cleanupFailed=true;
      console.warn('[story] nettoyage séances du groupe',questId,cleanupError);
      showNotif('Groupe supprimé, mais une date planifiée devra être retirée depuis le tableau de bord.', 'error');
    }
    if (!cleanupFailed) showNotif(removedSessions
      ? `Groupe supprimé · ${removedSessions} séance${removedSessions>1?'s':''} planifiée${removedSessions>1?'s':''} retirée${removedSessions>1?'s':''}.`
      : 'Groupe supprimé.', 'info');
    _stRefreshGroups(missionId);
  } catch (e) { notifySaveError(e); }
}

async function _stGroupJoin(questId, missionId) {
  const q = _grpQuest(questId); if (!q) return;
  const uid = STATE.user?.uid;
  const cur = toggleQuestParticipant(q.participants, { uid });
  if (cur.leaving) {
    await _stGroupSaveParts(questId, cur.participants, missionId, true);
    return;
  }
  const myChars = getMyCharacters(getCachedCollection('characters') || [], uid);
  if (!myChars.length) { showNotif('Aucun personnage à inscrire.', 'error'); return; }
  if (myChars.length > 1) { _stGroupPickCharModal(questId, missionId, myChars); return; }
  const { participants } = toggleQuestParticipant(q.participants, { uid, char: myChars[0] });
  await _stGroupSaveParts(questId, participants, missionId, false);
}

function _stGroupPickCharModal(questId, missionId, charList) {
  const rows = charList.map(c => {
    const av = characterAvatarHtml(c, { size: 38, border: 'none', background: 'rgba(79,140,255,.18)', color: 'var(--gold)' });
    const sub = [c.classe, c.race].filter(Boolean).join(' · ');
    return `<button class="btn btn-outline" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .9rem;text-align:left;width:100%"
        data-action="_stGroupPickChar" data-id="${_esc(questId)}" data-mission="${_esc(missionId)}" data-char="${_esc(c.id)}">
        ${av}
        <div style="min-width:0">
          <div style="font-weight:700;font-size:.88rem;color:var(--text)">${_esc(c.nom || '?')}</div>
          ${sub ? `<div style="font-size:.72rem;color:var(--text-dim)">${_esc(sub)}</div>` : ''}
        </div>
      </button>`;
  }).join('');
  openModal('Quel personnage rejoint ce groupe ?', `
    <div style="display:flex;flex-direction:column;gap:.45rem">${rows}</div>
    <div style="margin-top:.75rem;text-align:right">
      <button class="btn btn-outline btn-sm" data-action="_stOpenAfterClose" data-id="${_esc(missionId)}">Annuler</button>
    </div>`);
}

async function _stGroupPickChar(questId, missionId, charId) {
  const q = _grpQuest(questId); if (!q) return;
  const char = (getCachedCollection('characters') || []).find(c => c.id === charId);
  if (!char) return;
  const { participants } = toggleQuestParticipant(q.participants, { uid: STATE.user?.uid, char });
  await _stGroupSaveParts(questId, participants, missionId, false);
}

async function _stGroupSaveParts(questId, parts, missionId, leaving) {
  try {
    await saveDoc('quests', questId, { participants: parts });
    showNotif(leaving ? 'Tu as quitté ce groupe.' : 'Tu as rejoint ce groupe !', leaving ? 'info' : 'success');
    _stRefreshGroups(missionId);
  } catch (e) {
    if (e?.code === 'permission-denied') showNotif('Action non autorisée.', 'error');
    else notifySaveError(e);
  }
}

// Édition inline d'un champ de groupe (MJ) — sauvegarde silencieuse, sans modal.
async function _stGroupFieldSave(el) {
  if (!STATE.isAdmin) return;
  const id = el.dataset.id, field = el.dataset.field;
  if (!id || !field) return;
  let value = el.value;
  if (field === 'reussite') {
    value = String(value).trim() === '' ? null : Math.max(0, Math.min(100, parseInt(value) || 0));
  } else if (field === 'titre' || field === 'recompense') {
    value = String(value).trim();
  }
  try {
    await saveDoc('quests', id, { [field]: value });
    const q = _grpQuest(id);
    if (q) q[field] = value;
    if (field === 'reussite' || field === 'statut') _stPatchGroupOutcome(id);
    if (field === 'notesReussite') _stReplaceGroupCard(id, el.dataset.mission);
  } catch (e) { notifySaveError(e); }
}

function _stGroupOpenMemberPicker(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const missionId = btn.dataset.mission;
  const q = _grpQuest(id);
  if (!q) return;
  const presentIds = new Set(dedupeQuestParticipants(q.participants || []).map(p => p.charId).filter(Boolean));
  const chars = sortCharactersForDisplay(getCachedCollection('characters') || [])
    .filter(c => !presentIds.has(c.id));
  const rows = chars.map(c => {
    const sub = [c.ownerPseudo || c.ownerEmail, c.classe, c.race].filter(Boolean).join(' · ');
    const search = [c.nom, c.ownerPseudo, c.ownerEmail, c.classe, c.race].filter(Boolean).join(' ').toLowerCase();
    return `<button type="button" class="mv-picker-member" data-action="_stGroupAddMember" data-layer="picker"
        data-id="${_esc(id)}" data-mission="${_esc(missionId)}" data-char="${_esc(c.id)}" data-search="${_esc(search)}">
        ${characterAvatarHtml(c, { size: 42, className: 'mv-avatar', border: 'none', background: 'rgba(34,195,142,.16)', color: '#22c38e' })}
        <span class="mv-picker-member-main">
          <b>${_esc(c.nom || '?')}</b>
          ${sub ? `<small>${_esc(sub)}</small>` : ''}
        </span>
        <span class="mv-picker-member-add">Ajouter</span>
      </button>`;
  }).join('');
  pushModal('Ajouter au groupe', `
    <div class="mv-picker">
      <div class="mv-picker-head">
        <div>
          <strong>${_esc(q.titre || 'Groupe')}</strong>
          <span>${chars.length} personnage${chars.length > 1 ? 's' : ''} disponible${chars.length > 1 ? 's' : ''}</span>
        </div>
        <input class="mv-picker-search" type="search" placeholder="Rechercher un personnage ou un joueur..." data-input="_stGroupMemberFilter" autofocus>
      </div>
      <div class="mv-picker-list">
        ${rows || `<div class="mv-picker-empty">Tous les personnages sont déjà dans ce groupe.</div>`}
      </div>
      <div class="mv-picker-empty mv-picker-empty--filtered" hidden>Aucun personnage ne correspond à cette recherche.</div>
      <div class="mv-picker-actions">
        <button type="button" class="btn btn-outline btn-sm" data-action="closeModalDirect">Retour</button>
      </div>
    </div>`, () => {}, {
      icon: '👥',
      subtitle: 'Choisir un participant sans encombrer la carte du groupe',
      accent: '#22c38e',
    });
}

function _stGroupMemberFilter(input) {
  const root = input.closest('.mv-picker');
  if (!root) return;
  const needle = String(input.value || '').trim().toLowerCase();
  let visible = 0;
  root.querySelectorAll('.mv-picker-member').forEach(btn => {
    const ok = !needle || String(btn.dataset.search || '').includes(needle);
    btn.hidden = !ok;
    if (ok) visible += 1;
  });
  const empty = root.querySelector('.mv-picker-empty--filtered');
  if (empty) empty.hidden = visible > 0;
}

// MJ : assigner un personnage d'office au groupe (clic sur un portrait).
async function _stGroupAddMember(el) {
  if (!STATE.isAdmin) return;
  const id = el.dataset.id, missionId = el.dataset.mission, charId = el.dataset.char || el.value;
  if (!charId) return;
  const q = _grpQuest(id); if (!q) return;
  const char = (getCachedCollection('characters') || []).find(c => c.id === charId);
  if (!char) return;
  const parts = dedupeQuestParticipants([...(q.participants || []), questParticipantFromChar(char, char.uid || '')]);
  try {
    await saveDoc('quests', id, { participants: parts });
    q.participants = parts;
    if (el.dataset.layer === 'picker') popModal();
    _stReplaceGroupCard(id, missionId);
    showNotif(`${char.nom || 'Personnage'} ajouté au groupe.`, 'success');
  } catch (e) { notifySaveError(e); }
}

// MJ : retirer un membre du groupe.
async function _stGroupRemoveMember(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id, missionId = btn.dataset.mission;
  const charId = btn.dataset.char, uid = btn.dataset.uid;
  const q = _grpQuest(id); if (!q) return;
  const parts = (q.participants || []).filter(p => charId ? p.charId !== charId : p.uid !== uid);
  try {
    await saveDoc('quests', id, { participants: parts });
    q.participants = parts;
    _stReplaceGroupCard(id, missionId);
  } catch (e) { notifySaveError(e); }
}

// MJ : migration one-click des anciens groupes (story.groupes) → quêtes-groupes.
// Idempotente : marque chaque mission migrée (groupesMigrated) + saute les doublons.
async function _stMigrateGroups() {
  if (!STATE.isAdmin) return;
  if (!await confirmModal('Convertir tous tes anciens groupes (et leurs joueurs) en groupes rejoignables ? Les joueurs déjà associés resteront membres.', { title: '⟳ Migrer les anciens groupes', okLabel: 'Migrer', cancelLabel: 'Annuler' })) return;
  try {
    const stories = getCachedCollection('story') || await loadCollection('story');
    const chars   = getCachedCollection('characters') || await loadCollection('characters') || [];
    const byId    = new Map(chars.map(c => [c.id, c]));
    const existing = getCachedCollection('quests') || await loadCollection('quests') || [];
    let created = 0, missions = 0;
    for (const m of stories) {
      const groupes = Array.isArray(m.groupes) ? m.groupes : [];
      if (!groupes.length || m.groupesMigrated) continue;
      for (const g of groupes) {
        const titre = g.nom || 'Groupe';
        if (existing.some(q => q.missionId === m.id && (q.titre || '') === titre)) continue; // doublon
        const participants = (g.membres || [])
          .map(cid => { const c = byId.get(cid); return c ? questParticipantFromChar(c, c.uid || '') : null; })
          .filter(Boolean);
        const reussite = (g.reussite != null && g.reussite !== '')
          ? Math.max(0, Math.min(100, parseInt(g.reussite) || 0)) : null;
        const statut = reussite == null ? 'active' : (reussite >= 50 ? 'terminee' : 'echouee');
        await addToCol('quests', {
          missionId: m.id, titre, statut, participants, reussite,
          recompense: g.recompense || '', notesReussite: g.notesReussite || '',
          participantsRequis: 0, difficulte: 'moyen',
        });
        created++;
      }
      await updateInCol('story', m.id, { groupesMigrated: true });
      missions++;
    }
    showNotif(created
      ? `✓ ${created} groupe(s) migré(s) sur ${missions} mission(s).`
      : 'Rien à migrer (déjà fait).', 'success');
    renderStory();
  } catch (e) { notifySaveError(e); }
}

// ── Bindings de la nouvelle modale mission : tabs, segments, live preview ────
function _initMissionModalUI(item) {
  const shell = document.querySelector('.mn-shell');
  if (!shell) return;

  // Tabs
  shell.querySelectorAll('.mn-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      shell.querySelectorAll('.mn-tab').forEach((t) => {
        const active = t === btn;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      shell.querySelectorAll('.mn-panel').forEach((p) => {
        const active = p.dataset.panel === tab;
        p.classList.toggle('is-active', active);
        p.hidden = !active;
      });
    });
  });

  // Type segmented control → met à jour input caché + preview hero
  const typeSeg = shell.querySelector('#mn-type-seg');
  const typeInp = shell.querySelector('#st-type');
  const typeLbl = shell.querySelector('#mn-type-preview');
  typeSeg?.querySelectorAll('.mn-seg').forEach(b => {
    b.addEventListener('click', () => {
      const v = b.dataset.type;
      typeSeg.querySelectorAll('.mn-seg').forEach((x) => {
        const active = x === b;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      if (typeInp) typeInp.value = v;
      if (typeLbl) typeLbl.textContent = v === 'event' ? 'Événement' : 'Mission';
    });
  });

  // Statut pills cliquables → met à jour input caché + preview hero
  const statutPills = shell.querySelector('#mn-statut-pills');
  const statutInp = shell.querySelector('#st-statut');
  const statutPreview = shell.querySelector('#mn-statut-preview');
  statutPills?.querySelectorAll('.mn-statut-pill').forEach(p => {
    p.addEventListener('click', () => {
      const v = p.dataset.statut;
      statutPills.querySelectorAll('.mn-statut-pill').forEach((x) => {
        const active = x === p;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      if (statutInp) statutInp.value = v;
      if (statutPreview) {
        const cfg = stCfg({ statut: v });
        statutPreview.style.color = cfg.color;
        statutPreview.style.borderColor = cfg.border;
        statutPreview.innerHTML = `${cfg.icon} <span>${_esc(v)}</span>`;
      }
    });
  });

  // Live preview : titre, acte, axe
  const acteInp = shell.querySelector('#st-acte');
  const actePreview = shell.querySelector('#mn-acte-preview');
  acteInp?.addEventListener('input', () => {
    if (actePreview) actePreview.textContent = acteInp.value || 'Acte I';
  });

  const axeInp = shell.querySelector('#st-axe');
  const axePreview = shell.querySelector('#mn-axe-preview');
  axeInp?.addEventListener('input', () => {
    if (axePreview) {
      const v = axeInp.value.trim();
      if (v) {
        axePreview.style.color = STORE.axeMap[v] || 'var(--text-muted)';
        axePreview.textContent = `● ${v}`;
      } else {
        axePreview.textContent = '';
      }
    }
  });

  // Filtre live des liens
  const liensSearch = shell.querySelector('#mn-liens-search');
  liensSearch?.addEventListener('input', () => {
    const q = _normalize(liensSearch.value);
    shell.querySelectorAll('[id^="lien-card-"]').forEach(el => {
      const text = _normalize(el.textContent || '');
      el.style.display = !q || text.includes(q) ? '' : 'none';
    });
  });

  // Raccourcis clavier : Ctrl+S = sauver, Escape = fermer (Escape déjà géré globalement)
  if (!shell._kbBound) {
    shell._kbBound = true;
    const id = item?.id || '';
    const onKey = (e) => {
      if (!document.querySelector('.mn-shell')) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const btn = document.getElementById('mn-save-btn');
        btn?.click();
      }
    };
    document.addEventListener('keydown', onKey);
  }
}

function _renderMissionGroupSummary(groups) {
  const chars = getCachedCollection('characters') || [];
  const selected = new Set();
  groups.forEach(g => dedupeQuestParticipants(g.participants || [])
    .forEach(p => { const k = p.charId || p.uid || p.nom; if (k) selected.add(k); }));
  const reussites = groups
    .map(g => parseInt(g.reussite))
    .filter(Number.isFinite);
  const avg = reussites.length ? Math.round(reussites.reduce((a, b) => a + b, 0) / reussites.length) : 0;
  const rewards = groups.filter(g => (g.recompense || '').trim()).length;
  const unassigned = Math.max(0, chars.length - selected.size);
  return `<div class="st-groups-summary">
    <div class="st-groups-summary-card">
      <span class="st-groups-summary-k">Groupes</span>
      <strong>${groups.length}</strong>
    </div>
    <div class="st-groups-summary-card">
      <span class="st-groups-summary-k">Personnages</span>
      <strong>${selected.size}</strong>
      ${unassigned ? `<em>${unassigned} non assigné${unassigned > 1 ? 's' : ''}</em>` : ''}
    </div>
    <div class="st-groups-summary-card">
      <span class="st-groups-summary-k">Réussite moy.</span>
      <strong>${avg}<small>%</small></strong>
    </div>
    <div class="st-groups-summary-card">
      <span class="st-groups-summary-k">Récompenses</span>
      <strong>${rewards}</strong>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL — orchestrateur conforme handoff STORY.md
// Bannière cinéma · Cockpit (anneau + minis + prochaine) · Acts · Controls · View
// ══════════════════════════════════════════════════════════════════════════════
async function renderStory() {
  const content = document.getElementById('main-content');
  STORE.axeMap = {};

  const [items, savedActes, axesDoc, questGroups] = await Promise.all([
    loadCollection('story'),
    loadActes(),
    getDocData('story_meta', 'axes'),
    STATE.isAdmin ? Promise.resolve([]) : loadCollection('quests').catch(() => []),
  ]);
  // Ordre des axes défini par le MJ (story_meta/axes.order). Les axes absents de
  // la liste sont placés après, dans leur ordre d'apparition.
  STORE.axeOrder = Array.isArray(axesDoc?.order) ? axesDoc.order : [];
  STORE.axeColors = Object.fromEntries(Object.entries(axesDoc?.colors || {})
    .map(([axe, color]) => [axe, _normalizeAxeColor(color)])
    .filter(([, color]) => color));

  // Live : re-render dès qu'une mission change (unwatchAll() nettoie à la
  // navigation, donc on ré-arme l'abonnement à chaque rendu). Voir _storySignature.
  _storySig = _storySignature(items);
  watchPageCollection('story-live', 'story', 'story', data => {
    if (_storySignature(data) === _storySig) return;   // émission initiale ou faux positif
    renderStory();
  });

  const prefs = getStoryPrefs();
  const visibleItems = items.filter(i => STATE.isAdmin || i.visibleJoueurs !== false);
  const playerMissionIds = STATE.isAdmin ? new Set() : _storyMissionIdsForPlayer(visibleItems, questGroups);
  const personalScope = !STATE.isAdmin && prefs.playerScope === 'mine';
  const scopedItems = personalScope
    ? visibleItems.filter(item => playerMissionIds.has(item.id))
    : visibleItems;

  const fromItems = [...new Set(scopedItems.map(i => i.acte).filter(Boolean))];
  const allActes = [...new Set([...(STATE.isAdmin ? savedActes : []), ...fromItems])].sort();
  if (!allActes.length) allActes.push('Acte I');

  const activeActe = STORE.storyActe && allActes.includes(STORE.storyActe)
    ? STORE.storyActe
    : allActes[0];
  STORE.storyActe = activeActe;

  // Items de l'acte courant, visibles selon rôle
  const acteItems = scopedItems.filter(i => (i.acte || 'Acte I') === activeActe);

  // Filtres recherche (insensible aux accents) + statut
  const qNorm = _normalize((prefs.search || '').trim());
  const filteredItems = acteItems.filter(i => {
    if (prefs.statut && (i.statut || 'En attente') !== prefs.statut) return false;
    if (!qNorm) return true;
    const hay = _normalize([i.titre, i.axe, i.lieu, i.description, i.date].join(' '));
    return hay.includes(qNorm);
  }).sort((a,b) => (a.ordre||0)-(b.ordre||0) || (a.date||'').localeCompare(b.date||''));

  // Palette d'axes : à partir de TOUS les items de l'acte (pas seulement filtrés)
  acteItems.forEach(i => { if (i.axe) axeColor(i.axe); });
  const axes = Object.keys(STORE.axeMap);

  // Reste-t-il d'anciens groupes (story.groupes) non migrés vers les quêtes ?
  const _legacyGroups = STATE.isAdmin && items.some(i => Array.isArray(i.groupes) && i.groupes.length && !i.groupesMigrated);

  // Statistiques de cockpit
  const counts = { total: acteItems.length, term: 0, cours: 0, attente: 0, echec: 0 };
  acteItems.forEach(i => {
    const s = i.statut || 'En attente';
    if (s === 'Terminée') counts.term++;
    else if (s === 'En cours') counts.cours++;
    else if (s === 'Échouée') counts.echec++;
    else counts.attente++;
  });
  const progPct = counts.total ? Math.round((counts.term / counts.total) * 100) : 0;

  // Mission hero pour la bannière : En cours avec image, sinon dernière Terminée
  // avec image, sinon première avec image.
  const heroMission = acteItems.find(i => i.statut === 'En cours' && i.imageUrl)
    || [...acteItems].reverse().find(i => i.statut === 'Terminée' && i.imageUrl)
    || acteItems.find(i => i.imageUrl)
    || acteItems[0] || null;

  // Prochaine étape (mission En cours sinon première En attente)
  const nextMission = acteItems.find(i => i.statut === 'En cours')
    || acteItems.find(i => i.statut === 'En attente')
    || null;

  // Stroke-dasharray pour l'anneau de progression (r=26 → C=2πr≈163.36)
  const ringC = 2 * Math.PI * 26;
  const ringFill = (progPct / 100) * ringC;

  content.innerHTML = `
  <div class="trame-root">

    <!-- ── EN-TÊTE COLLANT : marque · scope · actions · actes en onglets ── -->
    <div class="top"><div class="top-in">
      <div class="top-row">
        <div class="brand"><h1>La Trame</h1><small>${_esc(activeActe)}</small></div>
        <div class="spacer"></div>
        ${!STATE.isAdmin ? `<div class="scope" role="group" aria-label="Missions affichées">
          <button class="${!personalScope ? 'on' : ''}" data-action="_stSetPlayerScope" data-scope="all" aria-pressed="${!personalScope}"><span aria-hidden="true">&#9776;</span> Toute la trame</button>
          <button class="${personalScope ? 'on' : ''}" data-action="_stSetPlayerScope" data-scope="mine" aria-pressed="${personalScope}"><span aria-hidden="true">&#9673;</span> Mes missions <em>${playerMissionIds.size}</em></button>
        </div>` : ''}
        ${STATE.isAdmin && axes.length ? `<button class="pill" data-action="openAxeOrder" title="Personnaliser les couleurs et l'ordre des axes narratifs">◉ Axes</button>` : ''}
        ${_legacyGroups ? `<button class="pill" data-action="_stMigrateGroups" title="Convertir les anciens groupes (membres) en groupes rejoignables">⟳ Migrer</button>` : ''}
        ${STATE.isAdmin ? `<button class="pill primary" data-action="openStoryModal">＋ Nouvelle mission</button>` : ''}
      </div>
      <div class="tabs" role="tablist" aria-label="Actes">
        ${allActes.map(acte => {
          const active = acte === activeActe;
          const n = scopedItems.filter(i => (i.acte || 'Acte I') === acte).length;
          // data-acte + délégation : robuste aux apostrophes / guillemets dans le nom
          return `<button class="tab ${active ? 'active' : ''}" role="tab" aria-selected="${active}"
            data-acte="${_esc(acte)}" data-action="_stSwitchActe">${_esc(acte)}<span class="tab-badge">${n}</span></button>`;
        }).join('')}
        ${STATE.isAdmin ? `<button class="tab-new" data-action="openNewActeModal">＋ Acte</button>` : ''}
      </div>
    </div></div>

    <div class="wrap">

      <!-- ── BANDEAU HÉROS + COCKPIT (fusionnés) ── -->
      ${_renderHero(heroMission, activeActe, counts, progPct, ringFill, ringC, nextMission)}

      <!-- ── CONTRÔLES : recherche · statut · vues ── -->
      <div class="controls">
        <label class="search">
          <input type="text" id="st-search" placeholder="Rechercher un titre, un axe, un lieu… (sans accents OK)"
            value="${_esc(prefs.search)}" data-input="_stOnSearch" aria-label="Rechercher une mission">
          ${prefs.search ? `<span class="search-clear" data-action="_stSetFilter" data-key="search" data-val="" title="Effacer">✕</span>` : ''}
        </label>
        <select class="statut-select" data-change="_stSetStatut" aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          ${Object.keys(STATUT_CFG).map(s => `<option value="${s}" ${prefs.statut===s?'selected':''}>${STATUT_CFG[s].icon} ${s}</option>`).join('')}
        </select>
        <span class="count">${filteredItems.length} mission${filteredItems.length>1?'s':''}</span>
        <div class="views" role="tablist" aria-label="Mode d'affichage de la trame">
          <button class="${prefs.view==='carte'?'on':''}" data-action="_stSetView" data-view="carte" role="tab" aria-selected="${prefs.view === 'carte'}">Carte</button>
          <button class="${prefs.view==='saga'?'on':''}" data-action="_stSetView" data-view="saga" role="tab" aria-selected="${prefs.view === 'saga'}">Saga</button>
          <button class="${prefs.view==='list'?'on':''}" data-action="_stSetView" data-view="list" role="tab" aria-selected="${prefs.view === 'list'}">Liste</button>
        </div>
      </div>

      <!-- ── CONTENU ── -->
      <div id="st-body">
        ${filteredItems.length === 0 ? `
          <div class="empty">
            <div class="empty-ico">📜</div>
            <b>${qNorm || prefs.statut
              ? 'Aucune mission ne correspond aux filtres.'
              : personalScope
                ? "Tu n'as participé à aucune mission de cet acte."
                : `Aucune mission pour ${_esc(activeActe)}.`}</b>
            ${qNorm || prefs.statut
              ? `<button class="pill" data-action="_stResetFilters">↺ Réinitialiser</button>`
              : (STATE.isAdmin ? `<button class="pill primary" data-action="openStoryModal">＋ Ajouter la première</button>` : '')}
          </div>` :
          (() => {
            // Wrap chaque vue : si UNE mission corrompue plante le renderer, on
            // affiche un message clair plutôt qu'une "Erreur de chargement" globale.
            const view = prefs.view || 'carte';
            const fn = view === 'saga' ? _renderSagaView
                     : view === 'list' ? _renderListView
                     : _renderMapView;
            try {
              return fn(filteredItems);
            } catch (err) {
              console.error('[story] vue', view, 'a planté :', err, filteredItems);
              return `<div class="empty">
                <div class="empty-ico">⚠️</div>
                <b>Impossible d'afficher cette vue</b>
                <p style="font-size:.82rem;color:var(--text-dim);max-width:380px;margin:0 auto;line-height:1.5">
                  Une mission de <b>${_esc(activeActe)}</b> contient des données invalides.
                  Essaie une autre vue ou contacte le MJ.
                </p>
                <p style="font-size:.7rem;color:var(--text-dim);opacity:.6;margin-top:.25rem;font-family:monospace">${_esc(err?.message || String(err))}</p>
                <div style="display:flex;gap:.4rem;justify-content:center;margin-top:.5rem;flex-wrap:wrap">
                  <button class="pill" data-action="_stSetView" data-view="list">📋 Vue Liste</button>
                  <button class="pill" data-action="_stResetFilters">↺ Réinitialiser filtres</button>
                </div>
              </div>`;
            }
          })()
        }
      </div>
    </div>
  </div>
  `;

  const _initView = prefs.view === 'saga' ? _initSaga : prefs.view === 'list' ? _initList : _initMapInteractions;
  requestAnimationFrame(() => _initView());
}

function _stSetFilter(key, val) { setStoryPrefs({ [key]: val }); PAGES.story?.(); }
function _stSetView(view) { setStoryPrefs({ view }); PAGES.story?.(); }
function _stResetFilters() { setStoryPrefs({ search:'', statut:'' }); PAGES.story?.(); }
function _stSetPlayerScope(scope) {
  setStoryPrefs({ playerScope: scope === 'mine' ? 'mine' : 'all' });
  PAGES.story?.();
}
// Bascule entre actes — passe par data-attribute pour être immunisé aux
// caractères spéciaux (apostrophes, guillemets) dans les noms d'acte.
function _stSwitchActe(acte) {
  if (!acte) return;
  STORE.storyActe = String(acte);
  PAGES.story?.();
}

// Recherche : préserve le focus et la position du curseur après le re-render
// complet de la page (sinon l'input perd le focus à chaque caractère tapé)
function _stOnSearch(el) {
  const caret = el.selectionStart;
  setStoryPrefs({ search: el.value });
  PAGES.story?.().then(() => {
    const next = document.getElementById('st-search');
    if (next) {
      next.focus();
      try { next.setSelectionRange(caret, caret); } catch {}
    }
  });
}

// ── Bandeau héros + cockpit fusionnés (handoff §4.1) ───────────────────────────
function _renderHero(hero, activeActe, counts, progPct, ringFill, ringC, nextMission) {
  const cfg = STATUT_CFG;
  const artColor = hero && hero.axe ? (STORE.axeMap[hero.axe] || cfg['En cours'].color)
    : (hero ? cfg['En cours'].color : 'var(--gold)');
  const glyph = hero ? (hero.type === 'mission' ? '🎯' : '📖') : '📜';
  const eyebrow = !hero ? 'Chroniques de la Compagnie'
    : hero.statut === 'En cours' ? `${activeActe} · Mission en cours`
    : hero.statut === 'Terminée' ? `${activeActe} · Dernière victoire`
    : `${activeActe} · ${hero.statut || ''}`;
  const st = hero ? stCfg(hero) : null;
  const heroClick = hero ? `data-action="openStoryDetail" data-id="${hero.id}"` : '';
  return `<div class="hero">
    <div class="hero-art" style="--art:${artColor}" ${heroClick}>
      ${hero && hero.imageUrl
        ? `<img src="${_esc(hero.imageUrl)}" alt="" loading="lazy">`
        : `<span>${glyph}</span>`}
    </div>
    <div class="hero-copy">
      <div class="hero-eyebrow">${_esc(eyebrow)}</div>
      <h1 class="hero-title">${_esc(hero ? (hero.titre || 'Sans titre') : 'La Trame')}</h1>
      ${hero ? `<div class="hero-meta">
        ${hero.date ? `<span>📅 ${_esc(hero.date)}</span>` : ''}
        ${hero.lieu ? `<span>📍 ${_esc(hero.lieu)}</span>` : ''}
        <span style="color:${st.color}">${st.icon} ${_esc(hero.statut || 'En attente')}</span>
      </div>
      <button class="hero-open" data-action="openStoryDetail" data-id="${hero.id}">Ouvrir la mission →</button>` : ''}
    </div>
    <div class="cockpit">
      <div class="ring-wrap" title="${counts.term}/${counts.total} terminées">
        <svg class="ring" viewBox="0 0 60 60">
          <circle class="ring-bg" cx="30" cy="30" r="26"/>
          <circle class="ring-fill" cx="30" cy="30" r="26"
            stroke-dasharray="${ringFill.toFixed(2)} ${ringC.toFixed(2)}"/>
        </svg>
        <div class="ring-val">${progPct}%</div>
      </div>
      <div class="cockpit-counts"><b>${counts.term}<i>/</i>${counts.total}</b><span>Accomplies</span></div>
      <div class="cockpit-minis">
        <div class="mini"><i style="background:${cfg['En cours'].color}"></i>${counts.cours} En cours</div>
        <div class="mini"><i style="background:${cfg['En attente'].color}"></i>${counts.attente} À venir</div>
        <div class="mini"><i style="background:${cfg['Terminée'].color}"></i>${counts.term} Réussies</div>
        ${counts.echec ? `<div class="mini"><i style="background:${cfg['Échouée'].color}"></i>${counts.echec} Échouées</div>` : ''}
      </div>
      ${nextMission ? `<button class="cockpit-next" data-action="openStoryDetail" data-id="${nextMission.id}">
        <div class="cockpit-next-ico">⇒</div>
        <div class="cockpit-next-copy">
          <em>Prochaine étape</em>
          <b>${_esc(nextMission.titre || 'Sans titre')}</b>
          ${nextMission.axe ? `<i style="color:${STORE.axeMap[nextMission.axe] || 'var(--text-muted)'}">● ${_esc(nextMission.axe)}</i>` : ''}
        </div>
      </button>` : ''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE CARTE v2 — Plan de métro lisible (handoff TrameCarte)
// • Rendu 1:1 : le conteneur défile nativement ; le zoom change l'espacement des
//   colonnes (densité), jamais la taille du texte.
// • HTML + SVG : le SVG ne trace que les lignes d'axe et les correspondances ;
//   stations, étiquettes, règle des chapitres et noms d'axes sont en HTML.
// • En-têtes collants (chapitres en haut + axes à gauche), colonne « En jeu ».
// ══════════════════════════════════════════════════════════════════════════════
const TM = { TOP: 44, BOT: 74, ROW: 100, R: 14, BASE_COL: 184 };
const TM_DENS = [0.7, 0.85, 1, 1.2, 1.45];
let TM_POS = {}, TM_LINKS = [], TM_KEEP = null;

// Statut → clé courte de rendu.
const _tmKey = m => ({ 'Terminée':'done', 'En cours':'live', 'Échouée':'fail' })[m.statut] || 'todo';

// Ids des personnages POSSÉDÉS par le joueur connecté (pastille « Toi »).
// On n'utilise pas getMyCharacters : il inclut les `controlDelegates` (le MJ qui
// peut piloter les jetons des joueurs), ce qui marquerait à tort « Toi » sur les
// missions des autres. La propriété « Toi » = possession réelle (c.uid === uid).
function _tmMyCharIds() {
  const uid = STATE.user?.uid || '';
  if (!uid) return new Set();
  const chars = getCachedCollection('characters') || STATE.characters || [];
  return new Set(chars.filter(c => c?.uid === uid).map(c => c.id).filter(Boolean));
}
// Participants d'une mission → [{ id, nom, me }] (chaînes = charId, ou objets).
function _tmParticipants(m, myIds, charById) {
  const uid = STATE.user?.uid || '';
  return (Array.isArray(m.participants) ? m.participants : []).map(p => {
    const id = typeof p === 'string' ? p : (p?.charId || p?.id || '');
    const pUid = typeof p === 'object' ? p?.uid : '';
    const nom = (typeof p === 'object' && (p?.nom || p?.name)) || charById.get(id)?.nom || id;
    return { id, nom, me: (id && myIds.has(id)) || (uid && pUid === uid) };
  }).filter(p => p.id || p.nom);
}
// La mission concerne-t-elle un personnage du joueur connecté ?
const _tmMine = (m, myIds) => {
  const uid = STATE.user?.uid || '';
  return (Array.isArray(m.participants) ? m.participants : []).some(p => {
    const id = typeof p === 'string' ? p : (p?.charId || p?.id || '');
    const pUid = typeof p === 'object' ? p?.uid : '';
    return (id && myIds.has(id)) || (uid && pUid === uid);
  });
};

function _renderMapView(missions) {
  STORE.mapItemsCache = missions;
  const prefs = getStoryPrefs();
  const d = prefs.mapDensity || 1, COL = Math.round(TM.BASE_COL * d);
  const myIds = _tmMyCharIds();

  // 1) Grouper par axe, trier par ordre puis date.
  const byAxe = new Map();
  missions.forEach(m => { const k = m.axe || '__none__'; if (!byAxe.has(k)) byAxe.set(k, []); byAxe.get(k).push(m); });
  byAxe.forEach(l => l.sort((a, b) => (a.ordre||0) - (b.ordre||0) || (a.date||'').localeCompare(b.date||'')));

  // 2) Colonnes = valeurs distinctes d'ordre, tous axes confondus.
  const ordres = [...new Set(missions.map(m => m.ordre||0))].sort((a,b) => a-b);
  if (!ordres.length) ordres.push(0);
  const o2c = new Map(ordres.map((o,i) => [o,i]));

  // 3) Une rangée par axe ; empilement si plusieurs missions au même chapitre.
  let y = 0;
  const lanes = [...byAxe.entries()].sort((A,B) => _axeRank(A[0]) - _axeRank(B[0])).map(([axe, list], i) => {
    const byCol = new Map();
    list.forEach(m => { const c = o2c.get(m.ordre||0) ?? 0; if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(m); });
    const maxSubs = Math.max(1, ...[...byCol.values()].map(a => a.length));
    const h = TM.TOP + (maxSubs-1)*TM.ROW + TM.BOT;
    const l = { i, axe, list, byCol, cols:[...byCol.keys()].sort((a,b)=>a-b), top:y, y0:y+TM.TOP, h,
      color: axe === '__none__' ? 'var(--text-muted)' : axeColor(axe),
      label: axe === '__none__' ? 'Hors axe' : axe,
      done: list.filter(m => m.statut === 'Terminée').length };
    y += h;
    return l;
  });
  const H = y, W = ordres.length*COL + 24;

  // 4) Position de chaque station.
  TM_POS = {};
  lanes.forEach(l => l.byCol.forEach((subs, c) => subs.forEach((m, s) => {
    TM_POS[m.id] = { x: c*COL + COL/2, y: l.y0 + s*TM.ROW, lane: l.i, col: c, sub: s };
  })));

  // Colonne « En jeu » = la plus à droite contenant une mission En cours.
  let nowCol = -1;
  missions.forEach(m => { if (m.statut === 'En cours' && TM_POS[m.id]) nowCol = Math.max(nowCol, TM_POS[m.id].col); });

  // 5) Lignes d'axe : plein jusqu'aux stations jouées, pointillé vers les à-venir.
  const seg = (dPath, m, lane) => `<path class="tm-ln ${_tmKey(m)==='todo'?'fut':'run'}" data-lane="${lane}" style="--axe:${lanes[lane].color}" d="${dPath}"/>`;
  const linesSvg = lanes.map(l => {
    const out = [];
    l.cols.forEach((c, idx) => {
      const subs = l.byCol.get(c), x = c*COL + COL/2;
      if (idx > 0) {
        const xp = l.cols[idx-1]*COL + COL/2;
        out.push(seg(`M${xp} ${l.y0}L${x} ${l.y0}`, subs[0], l.i));
      }
      subs.slice(1).forEach((m, k) => {
        const yk = l.y0 + (k+1)*TM.ROW;
        const prev = idx > 0 ? l.cols[idx-1]*COL + COL/2 : null;
        const next = idx < l.cols.length-1 ? l.cols[idx+1]*COL + COL/2 : null;
        if (prev === null) out.push(seg(`M${x} ${l.y0}L${x} ${yk}`, m, l.i));
        else out.push(seg(`M${prev} ${l.y0}C${prev+(x-prev)*.55} ${l.y0} ${x-(x-prev)*.55} ${yk} ${x} ${yk}`, m, l.i));
        if (next !== null) out.push(seg(`M${x} ${yk}C${x+(next-x)*.45} ${yk} ${next-(next-x)*.55} ${l.y0} ${next} ${l.y0}`, l.byCol.get(l.cols[idx+1])[0], l.i));
      });
    });
    return out.join('');
  }).join('');

  // 6) Correspondances (liens) — hors enchaînement direct sur la même ligne.
  TM_LINKS = [];
  const R = TM.R;
  const linksSvg = missions.flatMap(m => (m.liens||[]).map(tid => {
    const a = TM_POS[m.id], b = TM_POS[tid];
    if (!a || !b) return '';
    const lane = lanes[a.lane];
    if (a.lane === b.lane && a.sub === 0 && b.sub === 0 && Math.abs(lane.cols.indexOf(a.col) - lane.cols.indexOf(b.col)) === 1) return '';
    TM_LINKS.push([m.id, tid]);
    let dPath;
    if (Math.abs(a.x-b.x) < 4) {
      const s = Math.sign(b.y-a.y) || 1, fy = a.y + s*(R+4), ty = b.y - s*(R+9), bow = COL*.3;
      dPath = `M${a.x+R*.7} ${fy}C${a.x+bow} ${fy+s*20} ${b.x+bow} ${ty-s*20} ${b.x+R*.7} ${ty}`;
    } else {
      const s = Math.sign(b.x-a.x), fx = a.x + s*(R+4), tx = b.x - s*(R+9), mid = (fx+tx)/2;
      dPath = `M${fx} ${a.y}C${mid} ${a.y} ${mid} ${b.y} ${tx} ${b.y}`;
    }
    return `<path class="tm-lk" data-a="${_esc(m.id)}" data-b="${_esc(tid)}" d="${dPath}" marker-end="url(#tmArrow)"/>`;
  })).join('');

  // 7) Règle des chapitres (sticky top).
  const ruler = ordres.map((o, c) => {
    const date = missions.find(m => TM_POS[m.id]?.col === c && m.date)?.date || '';
    return `<div class="tm-rc${c===nowCol?' now':''}" style="left:${c*COL}px;width:${COL}px">
      <b>Ch. ${String(c+1).padStart(2,'0')}</b>${c===nowCol ? '<em>En jeu</em>' : date ? `<span>${_esc(date)}</span>` : ''}</div>`;
  }).join('');

  // 8) Colonne des axes (sticky left).
  const laneLabels = lanes.map(l => `<div class="tm-lane" data-lane="${l.i}" style="height:${l.h}px;--axe:${l.color}">
      <div class="tm-lane-h"><i></i><b title="${_esc(l.label)}">${_esc(l.label)}</b></div>
      <div class="tm-pips">${l.list.map(m => `<span class="p-${_tmKey(m)}" title="${_esc(m.titre||'')}"></span>`).join('')}</div>
      <small>${l.done} / ${l.list.length} terminée${l.done>1?'s':''}</small>
    </div>`).join('');

  const bands = lanes.map(l => `<div class="tm-band" style="top:${l.top}px;height:${l.h}px"></div>`).join('');

  // 9) Stations (bouton HTML centré sur la position).
  const stations = missions.map(m => {
    const p = TM_POS[m.id]; if (!p) return '';
    const k = _tmKey(m), l = lanes[p.lane];
    const mine = _tmMine(m, myIds);
    const arc = k === 'live' ? `<svg class="tm-arc" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><circle cx="24" cy="24" r="21" pathLength="100" stroke-dasharray="${itemProgress(m)} 100"/></svg>` : '';
    return `<button class="tm-st k-${k}${m.type==='event'?' ev':''}${mine?' me':''}" data-id="${_esc(m.id)}" data-lane="${p.lane}" style="left:${p.x}px;top:${p.y}px;--axe:${l.color}" aria-label="${_esc(m.titre||'Sans titre')} — ${_esc(m.statut||'En attente')}">
      <span class="tm-dot">${arc}<i>${k==='done'?'✓':k==='fail'?'✕':''}</i></span>
      <span class="tm-lab" style="width:${COL-22}px"><b>${_esc(m.titre||'Sans titre')}</b>${m.date?`<small>${_esc(m.date)}</small>`:''}</span>
    </button>`;
  }).join('');

  const zi = TM_DENS.indexOf(d);
  return `<div class="tm" style="--col:${COL}px">
    <div class="tm-bar">
      <div class="tm-zoom">
        <button data-tmz="-1" title="Resserrer" ${zi===0?'disabled':''}>−</button>
        <span>${Math.round(d*100)}%</span>
        <button data-tmz="1" title="Espacer" ${zi===TM_DENS.length-1?'disabled':''}>+</button>
      </div>
      <button class="tm-btn" data-tmfit>Ajuster</button>
      ${nowCol >= 0 ? `<button class="tm-btn" data-tmnow>Aller à l'en-jeu</button>` : ''}
      <span class="tm-sp"></span>
      <div class="tm-legend">
        <span><i class="lg k-done"></i>Terminée</span>
        <span><i class="lg k-live"></i>En cours</span>
        <span><i class="lg k-fail"></i>Échouée</span>
        <span><i class="lg k-todo"></i>À venir</span>
        <span><i class="lg ev"></i>Événement</span>
        <span><i class="lg me"></i>Toi</span>
        <span><i class="lg lk"></i>Correspondance</span>
      </div>
    </div>
    <div class="tm-vp" tabindex="-1">
      <div class="tm-grid" style="grid-template-columns:var(--lw) minmax(${W}px,1fr)">
        <div class="tm-corner">Axes <span>→ Chapitres</span></div>
        <div class="tm-ruler">${ruler}</div>
        <div class="tm-lanes">${laneLabels}</div>
        <div class="tm-track" style="height:${H}px">
          ${bands}
          ${nowCol >= 0 ? `<div class="tm-now" style="left:${nowCol*COL}px;width:${COL}px"></div>` : ''}
          <svg class="tm-svg" width="${W}" height="${H}" aria-hidden="true">
            <defs><marker id="tmArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
            ${linesSvg}${linksSvg}
          </svg>
          ${stations}
        </div>
      </div>
    </div>
    <div class="tm-card" hidden></div>
  </div>`;
}

// Interactions carte : densité (boutons / Ctrl+molette), glisser-déplacer,
// survol/focus (met en évidence la ligne + ses liens, affiche la fiche), clavier
// (flèches entre stations), clic → openStoryDetail. Densité et position de
// défilement persistées dans les prefs (mapDensity / mapX).
function _initMapInteractions() {
  const root = document.querySelector('.tm'); if (!root) return;
  const vp = root.querySelector('.tm-vp'), card = root.querySelector('.tm-card');
  const missions = STORE.mapItemsCache || [];
  const myIds = _tmMyCharIds();
  const charById = new Map((getCachedCollection('characters') || STATE.characters || []).map(c => [c.id, c]));
  const lw = () => root.querySelector('.tm-lanes').offsetWidth;
  const COL = Math.round(TM.BASE_COL * (getStoryPrefs().mapDensity || 1));
  const nowEl = root.querySelector('.tm-now');
  const centerNow = smooth => { if (nowEl) vp.scrollTo({ left: nowEl.offsetLeft + COL/2 - (vp.clientWidth - lw())/2, behavior: smooth ? 'smooth' : 'auto' }); };

  // Position initiale : conservée après un changement de densité, sinon mapX,
  // sinon centrée sur la colonne « En jeu ».
  if (TM_KEEP) { vp.scrollLeft = TM_KEEP.ratio * (vp.scrollWidth - vp.clientWidth); vp.scrollTop = TM_KEEP.top; TM_KEEP = null; }
  else if (getStoryPrefs().mapX != null) vp.scrollLeft = getStoryPrefs().mapX;
  else centerNow(false);
  let st; vp.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => setStoryPrefs({ mapX: vp.scrollLeft }), 200); hideCard(); });

  const rerender = dens => {
    const max = vp.scrollWidth - vp.clientWidth;
    TM_KEEP = { ratio: max > 0 ? vp.scrollLeft/max : 0, top: vp.scrollTop };
    setStoryPrefs({ mapDensity: dens });
    root.outerHTML = _renderMapView(missions);
    _initMapInteractions();
  };
  const step = dir => {
    const cur = getStoryPrefs().mapDensity || 1;
    const i = TM_DENS.indexOf(cur);
    const n = Math.max(0, Math.min(TM_DENS.length-1, (i < 0 ? 2 : i) + dir));
    if (TM_DENS[n] !== cur) rerender(TM_DENS[n]);
  };
  root.querySelectorAll('[data-tmz]').forEach(b => b.onclick = () => step(+b.dataset.tmz));
  const fit = root.querySelector('[data-tmfit]');
  if (fit) fit.onclick = () => {
    const cols = root.querySelectorAll('.tm-rc').length || 1;
    const ideal = (vp.clientWidth - lw() - 24) / (cols*TM.BASE_COL);
    const best = TM_DENS.reduce((a,b) => (b <= ideal && b > a) ? b : a, TM_DENS[0]);
    rerender(best);
  };
  const nowBtn = root.querySelector('[data-tmnow]');
  if (nowBtn) nowBtn.onclick = () => centerNow(true);

  vp.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); }, { passive:false });

  // Glisser pour se déplacer (souris) ; le tactile garde le défilement natif.
  let drag = null;
  vp.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.tm-st,.tm-lane,.tm-ruler,.tm-corner')) return;
    drag = { x:e.clientX, y:e.clientY, l:vp.scrollLeft, t:vp.scrollTop };
    vp.classList.add('grab'); vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener('pointermove', e => { if (!drag) return; vp.scrollLeft = drag.l-(e.clientX-drag.x); vp.scrollTop = drag.t-(e.clientY-drag.y); });
  const end = () => { drag = null; vp.classList.remove('grab'); };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);

  // Mise en évidence : la ligne survolée + ses correspondances.
  const clear = () => { root.classList.remove('hl'); root.querySelectorAll('.on').forEach(el => el.classList.remove('on')); };
  const hlLane = lane => {
    root.classList.add('hl');
    root.querySelectorAll('[data-lane]').forEach(el => el.classList.toggle('on', +el.dataset.lane === lane));
    root.querySelectorAll('.tm-lk').forEach(el => el.classList.toggle('on', TM_POS[el.dataset.a]?.lane === lane || TM_POS[el.dataset.b]?.lane === lane));
  };
  const hlStation = id => {
    const p = TM_POS[id]; if (!p) return;
    const linked = new Set([id]);
    TM_LINKS.forEach(([a,b]) => { if (a === id) linked.add(b); if (b === id) linked.add(a); });
    root.classList.add('hl');
    root.querySelectorAll('[data-lane]').forEach(el => el.classList.toggle('on', +el.dataset.lane === p.lane || linked.has(el.dataset.id)));
    root.querySelectorAll('.tm-lk').forEach(el => el.classList.toggle('on', el.dataset.a === id || el.dataset.b === id));
  };

  function hideCard(){ card.hidden = true; }
  function showCard(el){
    const m = missions.find(x => x.id === el.dataset.id); if (!m) return;
    const s = stCfg(m), prog = itemProgress(m), gs = m.groupes || [];
    const parts = _tmParticipants(m, myIds, charById);
    const axeCol = m.axe ? axeColor(m.axe) : 'var(--text-muted)';
    card.innerHTML = `
      <div class="tc-axe" style="--axe:${axeCol}"><i></i>${_esc(m.axe||'Hors axe')}${m.type==='event'?' · Événement':''}</div>
      <div class="tc-t">${_esc(m.titre||'Sans titre')}</div>
      <div class="tc-m"><span style="color:${s.color}">${s.icon} ${_esc(m.statut||'En attente')}${m.statut==='En cours'?` · ${prog}%`:''}</span>${m.date?`<span>${_esc(m.date)}</span>`:''}${m.lieu?`<span>${_esc(m.lieu)}</span>`:''}</div>
      ${gs.length ? `<div class="tc-g">${gs.map(g => { const v = parseInt(g.reussite); return `<div><span>${_esc(g.nom||'Groupe')}</span><em><i style="width:${isNaN(v)?0:Math.max(0,Math.min(100,v))}%"></i></em><b>${isNaN(v)?'—':v+'%'}</b></div>`; }).join('')}</div>` : ''}
      ${parts.length ? `<div class="tc-p">${parts.map(p => `<span class="${p.me?'me':''}">${_esc(p.nom)}</span>`).join('')}</div>` : ''}
      <div class="tc-h">Clique pour ouvrir la mission</div>`;
    card.hidden = false;
    const rr = root.getBoundingClientRect(), dr = el.querySelector('.tm-dot').getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = dr.right - rr.left + 14;
    if (left + cw > rr.width - 8) left = dr.left - rr.left - cw - 14;
    let top = dr.top - rr.top - 12;
    top = Math.max(8, Math.min(top, rr.height - ch - 8));
    card.style.left = Math.max(8, left) + 'px'; card.style.top = top + 'px';
  }

  const stations = [...root.querySelectorAll('.tm-st')];
  const ensureVisible = el => {
    const p = TM_POS[el.dataset.id]; if (!p) return;
    const left = vp.scrollLeft, w = vp.clientWidth - lw();
    if (p.x - COL/2 < left) vp.scrollLeft = p.x - COL/2;
    else if (p.x + COL/2 > left + w) vp.scrollLeft = p.x + COL/2 - w;
  };
  stations.forEach(el => {
    el.onclick = () => { hideCard(); openStoryDetail(el.dataset.id); };
    el.addEventListener('pointerenter', () => { hlStation(el.dataset.id); showCard(el); });
    el.addEventListener('pointerleave', () => { clear(); hideCard(); });
    el.addEventListener('focus', () => { ensureVisible(el); hlStation(el.dataset.id); requestAnimationFrame(() => showCard(el)); });
    el.addEventListener('blur', () => { clear(); hideCard(); });
    el.addEventListener('keydown', e => {
      const dir = { ArrowRight:[1,0], ArrowLeft:[-1,0], ArrowDown:[0,1], ArrowUp:[0,-1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const c = TM_POS[el.dataset.id];
      const cand = stations.map(s => ({ s, p:TM_POS[s.dataset.id] })).filter(({p}) =>
        dir[0] ? (p.lane === c.lane && Math.sign(p.x-c.x) === dir[0]) : Math.sign(p.y-c.y) === dir[1]);
      const best = cand.sort((A,B) => {
        const da = dir[0] ? Math.abs(A.p.x-c.x)*2 + Math.abs(A.p.y-c.y) : Math.abs(A.p.y-c.y) + Math.abs(A.p.x-c.x)*1.5;
        const db = dir[0] ? Math.abs(B.p.x-c.x)*2 + Math.abs(B.p.y-c.y) : Math.abs(B.p.y-c.y) + Math.abs(B.p.x-c.x)*1.5;
        return da - db;
      })[0];
      if (best) best.s.focus();
    });
  });
  root.querySelectorAll('.tm-lane').forEach(el => {
    el.addEventListener('pointerenter', () => hlLane(+el.dataset.lane));
    el.addEventListener('pointerleave', clear);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VUES SAGA & LISTE v2 (handoff Trame v2 — Chronique retirée)
// Mêmes données filtrées que la Carte, numérotation de chapitres commune (_chMap).
// ══════════════════════════════════════════════════════════════════════════════
const _pad2 = n => String(n).padStart(2, '0');

// Numérotation commune aux 3 vues : une valeur d'`ordre` = un chapitre.
function _chMap(missions) {
  const o = [...new Set(missions.map(m => m.ordre || 0))].sort((a, b) => a - b);
  return new Map(o.map((x, i) => [x, i + 1]));
}
// Regroupe par axe (triés par rang), missions triées par ordre puis date.
function _axeLanes(missions) {
  const by = new Map();
  missions.forEach(m => { const k = m.axe || '__none__'; if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  return [...by.entries()].sort((A, B) => _axeRank(A[0]) - _axeRank(B[0])).map(([key, list]) => {
    list.sort((a, b) => (a.ordre || 0) - (b.ordre || 0) || (a.date || '').localeCompare(b.date || ''));
    return { key, list,
      color: key === '__none__' ? 'var(--text-muted)' : axeColor(key),
      label: key === '__none__' ? 'Hors axe' : key,
      done: list.filter(m => m.statut === 'Terminée').length };
  });
}
const _cover = (m, n) => m.imageUrl ? `<img src="${_esc(m.imageUrl)}" alt="" loading="lazy">` : `<span class="sg-cov-n">${_pad2(n)}</span>`;
function _charByIdMap() {
  return new Map((getCachedCollection('characters') || STATE.characters || []).map(c => [c.id, c]));
}
// Avatars empilés (max N) + « +n ».
function _tvAvatars(parts, max) {
  const list = Array.isArray(parts) ? parts : [];
  const shown = list.slice(0, max).map(p => characterAvatarHtml(p, { tag: 'span', className: 'av', border: 'none', background: 'transparent' })).join('');
  return shown + (list.length > max ? `<span class="av more">+${list.length - max}</span>` : '');
}
// Participants → [{ entry, nom, me }] (chaînes = charId, ou objets).
function _tvParts(m, myIds, charById) {
  const uid = STATE.user?.uid || '';
  return (Array.isArray(m.participants) ? m.participants : []).filter(p => p != null).map(p => {
    const id = typeof p === 'string' ? p : (p?.charId || p?.id || '');
    const pUid = typeof p === 'object' ? p?.uid : '';
    const nom = (typeof p === 'object' && (p?.nom || p?.name)) || charById.get(id)?.nom || id;
    return { entry: p, nom, me: (id && myIds.has(id)) || (uid && pUid === uid) };
  });
}

// ─── SAGA ──────────────────────────────────────────────────────────────────
const _SAGA_OPEN = {};
let _SAGA_LAST = [], _sgEscBound = false;

function _renderSagaView(missions) {
  _SAGA_LAST = missions;
  const ch = _chMap(missions);
  return `<div class="sg">${_axeLanes(missions).map(l => _sgSection(l, ch)).join('')}</div>`;
}

function _sgSection(l, ch) {
  const open = l.list.find(m => m.id === _SAGA_OPEN[l.key]);
  const pct = l.list.length ? Math.round(l.done / l.list.length * 100) : 0;
  const myIds = _tmMyCharIds(), charById = _charByIdMap();
  // Missions à venir consécutives empilées par 3 dans une même colonne.
  const items = []; let stack = null;
  l.list.forEach(m => {
    if (_tmKey(m) === 'todo') {
      if (!stack || stack.length === 3) { stack = []; items.push(stack); }
      stack.push(m);
    } else { stack = null; items.push(m); }
  });
  return `<section class="sg-axe" data-axe="${_esc(l.key)}" style="--axe:${l.color}">
    <header class="sg-h">
      <i class="sg-sw"></i>
      <h2>${_esc(l.label)}</h2>
      <span class="sg-n">${l.done} / ${l.list.length} terminée${l.done > 1 ? 's' : ''}</span>
      <span class="sg-bar"><i style="width:${pct}%"></i></span>
      <div class="sg-nav"><button data-sgs="-1" aria-label="Défiler vers la gauche">‹</button><button data-sgs="1" aria-label="Défiler vers la droite">›</button></div>
    </header>
    <div class="sg-rail">${items.map(it => Array.isArray(it)
      ? `<div class="sg-later">${it.map(m => _sgCard(m, ch, open, myIds, charById)).join('')}</div>`
      : _sgCard(it, ch, open, myIds, charById)).join('')}</div>
    ${open ? _sgReader(open, l, ch, myIds, charById) : ''}
  </section>`;
}

function _sgCard(m, ch, open, myIds, charById) {
  const k = _tmKey(m), n = ch.get(m.ordre || 0), s = stCfg(m), on = open && open.id === m.id ? ' open' : '';
  const ev = m.type === 'event' ? ' · Événement' : '';
  if (k === 'todo') return `<button class="sg-c todo${on}" data-sg="${_esc(m.id)}" aria-expanded="${!!on}">
      <span class="sg-ch">Ch. ${_pad2(n)}${ev}</span><b>${_esc(m.titre || 'Sans titre')}</b>
    </button>`;
  const prog = itemProgress(m), mine = _tmMine(m, myIds);
  return `<button class="sg-c k-${k}${on}" data-sg="${_esc(m.id)}" style="--st:${s.color}" aria-expanded="${!!on}">
    <span class="sg-cov">${_cover(m, n)}
      <span class="sg-tag">${s.icon} ${_esc(m.statut || 'En attente')}${k === 'live' ? ` · ${prog}%` : ''}</span>
      ${mine ? '<span class="sg-me">Toi</span>' : ''}
      ${k === 'live' ? `<span class="sg-pr"><i style="width:${prog}%"></i></span>` : ''}
    </span>
    <span class="sg-body">
      <span class="sg-ch">Ch. ${_pad2(n)}${ev}</span>
      <b>${_esc(m.titre || 'Sans titre')}</b>
      <small>${[m.date, m.lieu].filter(Boolean).map(_esc).join(' · ') || '&nbsp;'}</small>
      ${(m.participants || []).length ? `<span class="sg-av">${_tvAvatars(m.participants, 4)}</span>` : ''}
    </span>
  </button>`;
}

function _sgReader(m, l, ch, myIds, charById) {
  const i = l.list.indexOf(m), prev = l.list[i - 1], next = l.list[i + 1];
  const n = ch.get(m.ordre || 0), s = stCfg(m), gs = m.groupes || [], parts = _tvParts(m, myIds, charById);
  const meta = [m.date, m.lieu].filter(Boolean).map(_esc);
  return `<article class="sg-rd" aria-label="${_esc(m.titre || 'Sans titre')}">
    <div class="sg-rd-cov">${_cover(m, n)}</div>
    <div class="sg-rd-main">
      <div class="sg-rd-eye"><span>Ch. ${_pad2(n)}${m.type === 'event' ? ' · Événement' : ''}</span><span style="color:${s.color}">${s.icon} ${_esc(m.statut || 'En attente')}${m.statut === 'En cours' ? ` · ${itemProgress(m)}%` : ''}</span>${meta.map(x => `<span>${x}</span>`).join('')}</div>
      <h3>${_esc(m.titre || 'Sans titre')}</h3>
      ${m.description ? `<p class="sg-rd-txt">${_nl2br(m.description)}</p>` : `<p class="sg-rd-txt empty">${_tmKey(m) === 'todo' ? 'Cette mission n’a pas encore été jouée.' : 'Pas encore de récit pour cette mission.'}</p>`}
      ${gs.length || parts.length ? `<div class="sg-rd-cols">
        ${gs.length ? `<div class="sg-rd-g"><h4>Groupes</h4>${gs.map(g => {
          const o = groupOutcome(g), v = parseInt(g.reussite);
          return `<div><span>${_esc(g.nom || 'Groupe')}</span><em><i style="width:${isNaN(v) ? 0 : Math.max(0, Math.min(100, v))}%;background:${o.color}"></i></em><b style="color:${o.color}">${isNaN(v) ? '—' : v + '%'}</b></div>`;
        }).join('')}</div>` : ''}
        ${parts.length ? `<div class="sg-rd-p"><h4>Ont participé</h4><div>${parts.map(p =>
          `<span class="sg-pp${p.me ? ' me' : ''}">${characterAvatarHtml(p.entry, { tag: 'span', className: 'av', border: 'none', background: 'transparent' })}${_esc(p.nom)}${p.me ? ' <em>toi</em>' : ''}</span>`).join('')}</div></div>` : ''}
      </div>` : ''}
    </div>
    <div class="sg-rd-act">
      <button class="sg-rd-x" data-sgclose aria-label="Replier">×</button>
      <span class="sg-sp"></span>
      <div class="sg-rd-step">
        <button data-sg="${prev ? _esc(prev.id) : ''}" ${prev ? '' : 'disabled'} title="${prev ? _esc(prev.titre || '') : ''}">‹ Précédente</button>
        <button data-sg="${next ? _esc(next.id) : ''}" ${next ? '' : 'disabled'} title="${next ? _esc(next.titre || '') : ''}">Suivante ›</button>
      </div>
      <button class="sg-rd-open" data-sgopen="${_esc(m.id)}">Ouvrir la fiche</button>
    </div>
  </article>`;
}

function _initSaga() {
  const root = document.querySelector('.sg'); if (!root) return;
  const ch = () => _chMap(_SAGA_LAST);
  const placeRail = (sec, smooth) => {
    const rail = sec.querySelector('.sg-rail');
    const target = sec.querySelector('.sg-c.open') || sec.querySelector('.sg-c.k-live') || [...sec.querySelectorAll('.sg-c:not(.todo)')].pop();
    if (!target) return;
    const el = target.closest('.sg-later') || target;
    const left = el.offsetLeft, right = left + el.offsetWidth;
    if (smooth) {
      if (left < rail.scrollLeft) rail.scrollTo({ left: left - 24, behavior: 'smooth' });
      else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollTo({ left: right - rail.clientWidth + 24, behavior: 'smooth' });
    } else rail.scrollLeft = Math.max(0, left - 232);
  };
  root.querySelectorAll('.sg-axe').forEach(sec => placeRail(sec, false));

  const redraw = (sec, focusId) => {
    const lane = _axeLanes(_SAGA_LAST).find(l => l.key === sec.dataset.axe); if (!lane) return;
    const sl = sec.querySelector('.sg-rail').scrollLeft;
    const tmp = document.createElement('div'); tmp.innerHTML = _sgSection(lane, ch());
    const fresh = tmp.firstElementChild; sec.replaceWith(fresh);
    fresh.querySelector('.sg-rail').scrollLeft = sl;
    placeRail(fresh, true);
    if (focusId) fresh.querySelector(`.sg-rail [data-sg="${focusId}"]`)?.focus({ preventScroll: true });
  };

  root.onclick = e => {
    const sec = e.target.closest('.sg-axe'); if (!sec) return;
    const nav = e.target.closest('[data-sgs]');
    if (nav) { const r = sec.querySelector('.sg-rail'); r.scrollBy({ left: +nav.dataset.sgs * r.clientWidth * .8, behavior: 'smooth' }); return; }
    const op = e.target.closest('[data-sgopen]');
    if (op) { openStoryDetail(op.dataset.sgopen); return; }
    if (e.target.closest('[data-sgclose]')) { const id = _SAGA_OPEN[sec.dataset.axe]; delete _SAGA_OPEN[sec.dataset.axe]; redraw(sec, id); return; }
    const c = e.target.closest('[data-sg]');
    if (!c || !c.dataset.sg) return;
    const id = c.dataset.sg;
    if (c.classList.contains('sg-c') && _SAGA_OPEN[sec.dataset.axe] === id) { openStoryDetail(id); return; }
    _SAGA_OPEN[sec.dataset.axe] = id;
    redraw(sec, c.classList.contains('sg-c') ? id : null);
  };

  if (!_sgEscBound) {
    _sgEscBound = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Ne pas replier si une fiche mission (modale) est ouverte.
      if (document.getElementById('modal-overlay')?.classList.contains('show')) return;
      const root2 = document.querySelector('.sg'); if (!root2) return;
      const sec = document.activeElement?.closest?.('.sg-axe') || [...root2.querySelectorAll('.sg-axe')].find(s => s.querySelector('.sg-rd'));
      if (!sec || !_SAGA_OPEN[sec.dataset.axe]) return;
      const id = _SAGA_OPEN[sec.dataset.axe]; delete _SAGA_OPEN[sec.dataset.axe];
      const lane = _axeLanes(_SAGA_LAST).find(l => l.key === sec.dataset.axe); if (!lane) return;
      const sl = sec.querySelector('.sg-rail').scrollLeft;
      const tmp = document.createElement('div'); tmp.innerHTML = _sgSection(lane, _chMap(_SAGA_LAST));
      const fresh = tmp.firstElementChild; sec.replaceWith(fresh);
      fresh.querySelector('.sg-rail').scrollLeft = sl;
      fresh.querySelector(`[data-sg="${id}"]`)?.focus({ preventScroll: true });
    });
  }
}

// ─── LISTE ─────────────────────────────────────────────────────────────────
const _LS_COLS = [['ch', 'Ch.'], ['titre', 'Mission'], ['axe', 'Axe'], ['statut', 'Statut'], ['grp', 'Groupes'], ['parts', 'Joueurs'], ['prog', 'Avancement'], ['date', 'Date']];
const _LS_ST = ['En cours', 'Terminée', 'Échouée', 'En attente'];
const _LS_GROUPS = [['none', 'Aucun'], ['axe', 'Axe'], ['ch', 'Chapitre'], ['statut', 'Statut']];
let _LIST_LAST = [];

function _renderListView(missions) {
  _LIST_LAST = missions;
  const ch = _chMap(missions);
  const prefs = getStoryPrefs();
  const sort = prefs.listSort || { k: 'ch', d: 1 }, grp = prefs.listGroup || 'none';
  const val = {
    ch: m => ch.get(m.ordre || 0),
    titre: m => _normalize(m.titre),
    axe: m => m.axe ? _axeRank(m.axe) : 999,
    statut: m => _LS_ST.indexOf(m.statut || 'En attente'),
    grp: m => (m.groupes || []).length,
    parts: m => (m.participants || []).length,
    prog: m => itemProgress(m),
    date: m => m.date ? ch.get(m.ordre || 0) : 9999,
  }[sort.k] || (() => 0);
  const rows = [...missions].sort((a, b) => {
    const A = val(a), B = val(b);
    return (A < B ? -1 : A > B ? 1 : 0) * sort.d || (a.ordre || 0) - (b.ordre || 0);
  });

  let blocks;
  if (grp === 'none') blocks = [{ rows }];
  else {
    const keyOf = { axe: m => m.axe || '__none__', ch: m => ch.get(m.ordre || 0), statut: m => m.statut || 'En attente' }[grp];
    const map = new Map();
    rows.forEach(m => { const k = keyOf(m); if (!map.has(k)) map.set(k, []); map.get(k).push(m); });
    const keys = [...map.keys()].sort((a, b) => grp === 'axe' ? ((a === '__none__' ? 999 : _axeRank(a)) - (b === '__none__' ? 999 : _axeRank(b)))
      : grp === 'ch' ? a - b : _LS_ST.indexOf(a) - _LS_ST.indexOf(b));
    blocks = keys.map(k => ({ rows: map.get(k),
      label: grp === 'axe' ? (k === '__none__' ? 'Hors axe' : k) : grp === 'ch' ? `Chapitre ${_pad2(k)}` : k,
      sw: grp === 'axe' ? (k === '__none__' ? 'var(--text-muted)' : axeColor(k)) : grp === 'statut' ? (STATUT_CFG[k]?.color) : null }));
  }

  const head = _LS_COLS.map(([k, l]) => {
    const on = sort.k === k;
    return `<button class="c-${k}${on ? ' on' : ''}" data-lsort="${k}" aria-sort="${on ? (sort.d > 0 ? 'ascending' : 'descending') : 'none'}">${l}<i>${on ? (sort.d > 0 ? '↑' : '↓') : ''}</i></button>`;
  }).join('');

  const row = m => {
    const s = stCfg(m), prog = itemProgress(m), gs = m.groupes || [], n = ch.get(m.ordre || 0);
    const outs = gs.map(groupOutcome), mixed = new Set(outs.map(o => o.label)).size > 1;
    return `<div class="ls-r" role="row" tabindex="0" data-lsopen="${_esc(m.id)}" style="--st:${s.color}">
      <span class="c-ch">${_pad2(n)}</span>
      <span class="c-titre"><b>${_esc(m.titre || 'Sans titre')}</b>${m.type === 'event' || m.lieu ? `<small>${[m.type === 'event' ? 'Événement' : '', _esc(m.lieu || '')].filter(Boolean).join(' · ')}</small>` : ''}</span>
      <span class="c-axe">${m.axe ? `<i style="background:${axeColor(m.axe)}"></i><span>${_esc(m.axe)}</span>` : '<span class="dim">—</span>'}</span>
      <span class="c-statut"><em>${s.icon} ${_esc(m.statut || 'En attente')}</em></span>
      <span class="c-grp">${gs.length ? `<span class="ls-dots${mixed ? ' mixed' : ''}" title="${gs.map((g, i) => `${_esc(g.nom || 'Groupe')} : ${outs[i].label}`).join(' · ')}${mixed ? ' (issues différentes)' : ''}">${outs.map(o => `<i style="background:${o.color}"></i>`).join('')}</span>` : '<span class="dim">—</span>'}</span>
      <span class="c-parts">${(m.participants || []).length ? `<span class="ls-av">${_tvAvatars(m.participants, 3)}</span>` : '<span class="dim">—</span>'}</span>
      <span class="c-prog"><span class="ls-bar"><i style="width:${prog}%"></i></span><b>${prog}%</b></span>
      <span class="c-date">${m.date ? _esc(m.date) : '<span class="dim">—</span>'}</span>
    </div>`;
  };

  return `<div class="ls">
    <div class="ls-tools"><span>Regrouper par</span><div class="ls-seg">${_LS_GROUPS.map(([k, l]) => `<button class="${grp === k ? 'on' : ''}" data-lgrp="${k}">${l}</button>`).join('')}</div></div>
    <div class="ls-t" role="table"><div class="ls-in">
      <div class="ls-r ls-hd" role="row">${head}</div>
      ${blocks.map(b => `${b.label ? `<div class="ls-gh">${b.sw ? `<i style="background:${b.sw}"></i>` : ''}${_esc(b.label)}<span>${b.rows.length}</span></div>` : ''}${b.rows.map(row).join('')}`).join('')}
    </div></div>
  </div>`;
}

function _initList() {
  const root = document.querySelector('.ls'); if (!root) return;
  const redraw = () => { const x = root.querySelector('.ls-t').scrollLeft; root.outerHTML = _renderListView(_LIST_LAST); _initList(); const t = document.querySelector('.ls .ls-t'); if (t) t.scrollLeft = x; };
  root.onclick = e => {
    const so = e.target.closest('[data-lsort]');
    if (so) {
      const cur = getStoryPrefs().listSort || { k: 'ch', d: 1 }, k = so.dataset.lsort;
      setStoryPrefs({ listSort: { k, d: cur.k === k ? -cur.d : (k === 'prog' || k === 'parts' || k === 'grp' ? -1 : 1) } });
      redraw(); return;
    }
    const g = e.target.closest('[data-lgrp]');
    if (g) { setStoryPrefs({ listGroup: g.dataset.lgrp }); redraw(); return; }
    const r = e.target.closest('[data-lsopen]');
    if (r) openStoryDetail(r.dataset.lsopen);
  };
  root.onkeydown = e => {
    const r = e.target.closest('[data-lsopen]'); if (!r) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStoryDetail(r.dataset.lsopen); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...root.querySelectorAll('[data-lsopen]')], i = all.indexOf(r);
      all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };
}

// ── RENDU TIMELINE ────────────────────────────────────────────────────────────
// • Ordre global : même valeur d'ordre = même colonne chronologique
// • Split de ligne : si 2+ missions du même axe ont le même ordre,
//   la ligne se divise en sous-lignes verticalement, puis se remerge.
function _renderTimeline(items) {
  const CARD_W  = 160;
  const CARD_GAP = 28;
  const CARD_H  = 140; // hauteur d'une card (image + texte)
  const SUB_GAP =  20; // espace entre sous-lignes d'un même axe
  const ROW_GAP =  44; // espace entre deux axes différents
  const PAD_L   =  28;

  // ── 1. Regrouper par axe ──────────────────────────────────────────────────
  const axeOrder = [], axeGroups = {};
  items.forEach(item => {
    const key = item.axe || '__none__';
    if (!axeGroups[key]) { axeGroups[key] = []; axeOrder.push(key); }
    axeGroups[key].push(item);
  });

  // ── 2. Colonnes globales (ordre → colIdx) ─────────────────────────────────
  const allOrdres  = [...new Set(items.map(i => i.ordre || 0))].sort((a, b) => a - b);
  const ordreToCol = {};
  allOrdres.forEach((o, i) => { ordreToCol[o] = i; });
  const totalCols  = allOrdres.length || 1;

  // ── 3. Calculer la géométrie de chaque axe ────────────────────────────────
  // Pour chaque axe, trouver les "slots" : groupes d'items qui partagent le même ordre.
  // Un slot avec N items crée N sous-lignes pendant cette colonne.
  //
  // Résultat par axe : { subRows: [{ item, subRow }], rowHeight, centerY (relatif au top de l'axe) }
  const axeLayout = {}; // key → { slots, nSubRowsMax, rowH, centerY, items: [{item, subRow, col}] }

  axeOrder.forEach(key => {
    const group   = axeGroups[key];
    // Grouper par colonne
    const byCol   = {};
    group.forEach(item => {
      const col = ordreToCol[item.ordre || 0] ?? 0;
      if (!byCol[col]) byCol[col] = [];
      byCol[col].push(item);
    });

    // Nombre max de sous-lignes simultanées dans cet axe
    const maxSubs = Math.max(...Object.values(byCol).map(a => a.length));

    // Hauteur totale de la rangée pour cet axe
    const rowH  = maxSubs * CARD_H + (maxSubs - 1) * SUB_GAP;
    // Y central de la ligne principale (milieu de la rangée)
    const centerY = rowH / 2;

    // Assigner un sous-index à chaque item dans sa colonne
    const layoutItems = [];
    group.forEach(item => {
      const col     = ordreToCol[item.ordre || 0] ?? 0;
      const siblings = byCol[col];
      const subRow  = siblings.indexOf(item); // 0..N-1
      // Y de cette sous-ligne, centré autour du centre de l'axe
      // Pour N sous-lignes : y0 = centerY - (N-1)/2 * (CARD_H+SUB_GAP)
      const N    = siblings.length;
      const subY = centerY - (N - 1) / 2 * (CARD_H + SUB_GAP) + subRow * (CARD_H + SUB_GAP);
      layoutItems.push({ item, col, subRow, subY, N, siblings });
    });

    axeLayout[key] = { rowH, centerY, maxSubs, byCol, layoutItems };
  });

  // ── 4. Positions absolues (top de chaque axe) ─────────────────────────────
  const axeTop = {}; // key → y absolu du top de la rangée
  let curY = ROW_GAP;
  axeOrder.forEach(key => {
    axeTop[key] = curY;
    curY += axeLayout[key].rowH + ROW_GAP;
  });
  const totalH = curY;
  const totalW = PAD_L + totalCols * (CARD_W + CARD_GAP) + PAD_L;

  // ── 5. posMap pour les flèches inter-axes ────────────────────────────────
  const posMap = {};
  axeOrder.forEach(key => {
    const layout = axeLayout[key];
    const top    = axeTop[key];
    layout.layoutItems.forEach(({ item, col, subY }) => {
      const cx = PAD_L + col * (CARD_W + CARD_GAP) + CARD_W / 2;
      const cy = top + subY + CARD_H / 2;
      posMap[item.id] = { cx, cy };
    });
  });

  // ── 6. SVG ────────────────────────────────────────────────────────────────
  let svgLines = '';
  const defsHtml = [];

  axeOrder.forEach(key => {
    const color   = key === '__none__' ? '#555' : (STORE.axeMap[key] || '#555');
    const layout  = axeLayout[key];
    const top     = axeTop[key];
    const centerY = top + layout.centerY;

    // Trier les items par colonne
    const sorted = [...layout.layoutItems].sort((a, b) => a.col - b.col);
    if (sorted.length === 0) return;

    // Construire les segments de la ligne principale + splits/merges
    // On parcourt les colonnes dans l'ordre :
    //   - Avant un split : ligne principale vers x de split
    //   - Pendant un split : branches vers chaque sous-ligne, puis retour
    //   - Après un merge : depuis x de merge vers la suite
    const colsSorted = [...new Set(sorted.map(s => s.col))].sort((a, b) => a - b);

    for (let ci = 0; ci < colsSorted.length; ci++) {
      const col     = colsSorted[ci];
      const colItems = sorted.filter(s => s.col === col);
      const N       = colItems.length;
      const cx      = PAD_L + col * (CARD_W + CARD_GAP) + CARD_W / 2;

      if (N === 1) {
        // Pas de split : point sur la ligne principale
        const itemCy = top + colItems[0].subY + CARD_H / 2;
        svgLines += `<circle cx="${cx}" cy="${itemCy}" r="4" fill="${color}" opacity=".75"/>`;

        // Segment depuis la colonne précédente
        if (ci > 0) {
          const prevCol  = colsSorted[ci - 1];
          const prevItems = sorted.filter(s => s.col === prevCol);
          const prevCx   = PAD_L + prevCol * (CARD_W + CARD_GAP) + CARD_W / 2;
          const prevN    = prevItems.length;

          if (prevN === 1) {
            // Ligne directe d'un point à l'autre
            const prevCy = top + prevItems[0].subY + CARD_H / 2;
            svgLines += `<line x1="${prevCx}" y1="${prevCy}" x2="${cx}" y2="${itemCy}"
              stroke="${color}" stroke-width="2" opacity=".35"/>`;
          } else {
            // Merge : convergence de N branches vers ce point
            prevItems.forEach(prev => {
              const prevCy = top + prev.subY + CARD_H / 2;
              // Courbe de Bézier douce pour le merge
              const mpx = prevCx + (cx - prevCx) * 0.5;
              svgLines += `<path d="M${prevCx} ${prevCy} C${mpx} ${prevCy} ${mpx} ${itemCy} ${cx} ${itemCy}"
                fill="none" stroke="${color}" stroke-width="1.5" opacity=".35"/>`;
            });
          }
        }
      } else {
        // Split : N branches depuis le point précédent
        colItems.forEach(ci2 => {
          const branchCy = top + ci2.subY + CARD_H / 2;
          svgLines += `<circle cx="${cx}" cy="${branchCy}" r="4" fill="${color}" opacity=".75"/>`;

          if (ci > 0) {
            const prevCol   = colsSorted[ci - 1];
            const prevItems = sorted.filter(s => s.col === prevCol);
            const prevCx    = PAD_L + prevCol * (CARD_W + CARD_GAP) + CARD_W / 2;
            const prevN     = prevItems.length;

            if (prevN === 1) {
              // Divergence depuis un seul point
              const prevCy = top + prevItems[0].subY + CARD_H / 2;
              const mpx    = prevCx + (cx - prevCx) * 0.5;
              svgLines += `<path d="M${prevCx} ${prevCy} C${mpx} ${prevCy} ${mpx} ${branchCy} ${cx} ${branchCy}"
                fill="none" stroke="${color}" stroke-width="1.5" opacity=".35"/>`;
            } else {
              // Split-à-split : chaque branche relie son homologue si possible, sinon la 1ère
              const prevMatch = prevItems.find(p => p.subRow === ci2.subRow) || prevItems[0];
              const prevCy    = top + prevMatch.subY + CARD_H / 2;
              const mpx       = prevCx + (cx - prevCx) * 0.5;
              svgLines += `<path d="M${prevCx} ${prevCy} C${mpx} ${prevCy} ${mpx} ${branchCy} ${cx} ${branchCy}"
                fill="none" stroke="${color}" stroke-width="1.5" opacity=".35"/>`;
            }
          }
        });
      }
    }
  });

  // Flèches inter-axes (Bézier cubique)
  items.forEach(item => {
    if (!item.liens?.length) return;
    const from = posMap[item.id]; if (!from) return;
    item.liens.forEach(tid => {
      const to = posMap[tid]; if (!to) return;
      const { cx: x1, cy: y1 } = from, { cx: x2, cy: y2 } = to;
      const markId = `arr-${item.id.slice(-4)}-${tid.slice(-4)}`;
      defsHtml.push(`<marker id="${markId}" viewBox="0 0 10 10" refX="8" refY="5"
        markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M2 1L8 5L2 9" fill="none" stroke="rgba(232,184,75,.8)"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>`);
      const cp1x = x1 + (x2 - x1) * .5, cp2x = x2 - (x2 - x1) * .5;
      svgLines += `<path d="M${x1} ${y1} C${cp1x} ${y1} ${cp2x} ${y2} ${x2} ${y2}"
        fill="none" stroke="rgba(232,184,75,.45)" stroke-width="1.5" stroke-dasharray="6 3"
        marker-end="url(#${markId})"/>`;
    });
  });

  let html = `<svg style="position:absolute;top:0;left:0;overflow:visible;pointer-events:none"
    width="${totalW}" height="${totalH}">
    <defs>${defsHtml.join('')}</defs>${svgLines}
  </svg>`;

  // ── 7. Cards ──────────────────────────────────────────────────────────────
  axeOrder.forEach(key => {
    const color  = key === '__none__' ? '#555' : (STORE.axeMap[key] || '#555');
    const layout = axeLayout[key];
    const top    = axeTop[key];

    if (key !== '__none__') {
      const midY = top + layout.centerY;
      html += `<div style="position:absolute;left:0;top:${midY - 8}px;
        writing-mode:vertical-rl;transform:rotate(180deg);
        font-size:.6rem;color:${color};opacity:.6;letter-spacing:1px;text-transform:uppercase;white-space:nowrap">${key}</div>`;
    }

    layout.layoutItems.forEach(({ item, col, subY }) => {
      const left   = PAD_L + col * (CARD_W + CARD_GAP);
      const cardTop = top + subY;
      const st     = stCfg(item);
      const hasLiens = item.liens?.length > 0;

      html += `
      <div class="sn" data-id="${item.id}"
        style="position:absolute;left:${left}px;top:${cardTop}px;width:${CARD_W}px"
        data-action="openStoryDetail" data-id="${item.id}">
        <div class="sn-inner" style="background:var(--bg-card);border:1px solid ${st.border};border-radius:12px;overflow:hidden">
          <div style="width:100%;height:88px;background:var(--bg-panel);position:relative;overflow:hidden;flex-shrink:0">
            ${item.imageUrl
              ? `<img src="${item.imageUrl}" alt="${_esc(item.nom || item.titre || '')}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" draggable="false">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel))">
                   ${item.type === 'mission' ? '🎯' : '📖'}</div>`
            }
            <div style="position:absolute;top:5px;right:5px;background:rgba(11,17,24,.85);
              border:1px solid ${st.border};border-radius:999px;padding:1px 6px;
              font-size:.6rem;color:${st.color}">${st.icon} ${item.statut || 'En attente'}</div>
            ${hasLiens ? `<div style="position:absolute;top:5px;left:5px;background:rgba(11,17,24,.85);
              border:1px solid rgba(232,184,75,.4);border-radius:999px;padding:1px 6px;
              font-size:.6rem;color:var(--gold)">↝ ${item.liens.length}</div>` : ''}
            ${STATE.isAdmin && item.visibleJoueurs === false ? `<div style="position:absolute;bottom:26px;left:5px;background:rgba(11,17,24,.85);
              border:1px solid rgba(255,107,107,.3);border-radius:999px;padding:1px 6px;
              font-size:.6rem;color:#ff6b6b">🔒</div>` : ''}
            <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:${color};opacity:.8"></div>
          </div>
          <div style="padding:.5rem .6rem">
            <div style="font-family:'Cinzel',serif;font-size:.71rem;color:var(--text);line-height:1.3;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.titre || ''}">
              ${item.titre || 'Mission'}
            </div>
            ${item.date ? `<div style="font-size:.6rem;color:var(--text-dim);margin-top:2px">${item.date}</div>` : ''}
          </div>
        </div>
        ${STATE.isAdmin ? `
        <div style="display:flex;gap:3px;margin-top:4px;justify-content:center;flex-wrap:wrap">
          <button class="sn-histoire-btn"
            data-action="_ouvrirHistoire" data-id="${item.id}" data-titre="${_esc(item.titre||'')}" data-acte="${_esc(item.acte||'')}" data-stop-propagation>
            ✍️ Histoire
          </button>
          <button class="btn-icon" style="font-size:.7rem;padding:2px 6px"
            data-action="editStory" data-id="${item.id}" data-stop-propagation>✏️</button>
          <button class="btn-icon" style="font-size:.7rem;padding:2px 6px;color:#ff6b6b"
            data-action="deleteStory" data-id="${item.id}" data-stop-propagation>🗑️</button>
        </div>` : ''}
      </div>`;
    });
  });

  return `<div style="position:relative;width:${totalW}px;height:${totalH}px">${html}</div>`;
}

// ── MODAL DÉTAIL ──────────────────────────────────────────────────────────────
async function openStoryDetail(id) {
  const items = getCachedCollection('story') || await loadCollection('story');
  const item = items.find(i => i.id === id); if (!item) return;
  const st = stCfg(item);
  // Groupes = quêtes liées à cette mission (collection session-live → 0 lecture en plus).
  // Les joueurs les rejoignent via `participants` (règle Firestore : update participants only).
  const groups = ((getCachedCollection('quests') || await loadCollection('quests').catch(() => []) || [])
    .filter(q => q.missionId === item.id))
    .map(q => ({ ...q, _parts: dedupeQuestParticipants(q.participants || []) }))
    .sort((a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'));
  const liensItems = (item.liens || []).map(lid => items.find(i => i.id === lid)).filter(Boolean);
  const parentItems = items
    .filter(m => m.id !== item.id && Array.isArray(m.liens) && m.liens.includes(item.id))
    .sort((a, b) => (a.acte || '').localeCompare(b.acte || '') || (a.ordre || 0) - (b.ordre || 0));
  const relationCount = liensItems.length + parentItems.length;
  const relationCardHtml = (l, direction) => {
    const lst = stCfg(l);
    const lAxeCol = l.axe ? (STORE.axeMap[l.axe] || 'var(--text-muted)') : 'var(--text-muted)';
    const directionLabel = direction === 'from' ? 'Origine' : 'Suite';
    return `<button class="mv-lien mv-lien--${direction}" data-action="_stOpenLien" data-id="${l.id}">
      <div class="mv-lien-art">
        ${l.imageUrl
          ? `<img src="${_esc(l.imageUrl)}" alt="" loading="lazy">`
          : `<div class="mv-lien-fallback">${l.type === 'mission' ? '🎯' : '📖'}</div>`}
        <div class="mv-lien-statut" style="color:${lst.color};border-color:${lst.border}">${lst.icon}</div>
      </div>
      <div class="mv-lien-body">
        <div class="mv-lien-kind">${direction === 'from' ? '← mène ici' : 'mène vers →'}</div>
        <div class="mv-lien-title">${_esc(l.titre || 'Sans titre')}</div>
        <div class="mv-lien-meta">
          <span>${directionLabel}</span>
          ${l.axe ? `<span style="color:${lAxeCol}">● ${_esc(l.axe)}</span>` : ''}
        </div>
      </div>
    </button>`;
  };
  // Hauts-Faits rattachés à cette mission (collection session-live → 0 lecture en plus).
  const achItems = (getCachedCollection('achievements') || await loadCollection('achievements').catch(() => []) || [])
    .filter(a => a.missionId === item.id);
  const totalMembers = (() => {
    const s = new Set();
    groups.forEach(g => (g._parts || []).forEach(p => p?.uid && s.add(p.uid)));
    return s.size;
  })();
  // Issue divergente entre groupes (pastilles) — dérivée de la réussite saisie par le MJ
  const _grpDots = (() => {
    if (groups.length < 2) return '';
    const outs = groups.map(groupOutcome);
    const mixed = new Set(outs.map(o => o.key)).size > 1;
    const dots = groups.map((g, i) => `<span class="grp-dot" style="--oc:${outs[i].color}" title="${_esc(g.titre || 'Groupe')} · ${outs[i].label}"></span>`).join('');
    return `<span class="grp-dots${mixed ? ' is-mixed' : ''}">${dots}</span>`;
  })();
  const _grpMixed = groups.length >= 2 && new Set(groups.map(g => groupOutcome(g).key)).size > 1;
  const _myUid = STATE.user?.uid;
  const prog = itemProgress(item);
  const axeCol = item.axe ? (STORE.axeMap[item.axe] || 'var(--text-muted)') : 'var(--text-muted)';
  const bgUrl = (item.imageUrl || '').replace(/'/g, "%27");

  // Helper avatar
  const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  // NB : STATE.characters est filtré sur les persos du joueur côté joueur.
  // Pour afficher TOUS les membres des groupes, on prend la collection complète
  // (session-live → 0 lecture supplémentaire).
  const allChars = getCachedCollection('characters') || await loadCollection('characters');
  const chars = sortCharactersForDisplay(allChars || []);
  // Personnages du joueur courant (pour rejoindre un groupe)
  const _myChars = STATE.isAdmin ? [] : getMyCharacters(allChars || [], _myUid);
  const avatar = (c, size = 36) => {
    if (!c) return '';
    const col = PCOLS[c.nom?.charCodeAt(0) % 6 || 0];
    return characterAvatarHtml(c, {
      size,
      className: 'mv-avatar',
      border: 'none',
      background: `${col}18`,
      color: col,
      style: `--col:${col}`,
    });
  };
  const avgGroupSuccess = groups.length
    ? Math.round(groups.reduce((sum, g) => sum + (parseInt(g.reussite) || 0), 0) / groups.length)
    : 0;
  const rewardedGroups = groups.filter(g => (g.recompense || '').trim()).length;
  const synthProgress = groups.length ? avgGroupSuccess : prog;
  const synthColor = groups.length ? groupOutcome({ reussite: avgGroupSuccess }).color : st.color;
  const nextSession = await getDocData('agenda_session', 'next').catch(() => null);
  const missionSessions = _storyMissionSessions(nextSession, groups);
  const trophyIcon = '\u{1F3C6}';
  const achCardsHtml = achItems.map(a => `
    <button type="button" class="mv-ach" data-action="_stOpenAch" data-id="${a.id}">
      <span class="mv-ach-art">${a.imageUrl
        ? `<img src="${_esc(a.imageUrl)}" alt="">`
        : `<span class="mv-ach-emoji">${_esc(a.emoji || trophyIcon)}</span>`}</span>
      <span class="mv-ach-body">
        <span class="mv-ach-title">${_esc(a.titre || 'Haut-Fait')}</span>
        ${a.description ? `<span class="mv-ach-desc">${_esc(a.description)}</span>` : ''}
      </span>
    </button>`).join('');
  const missionAchievementsHtml = achItems.length || STATE.isAdmin ? `
      <section class="mv-section">
        <h3 class="mv-section-title">
          ${trophyIcon} Hauts-Faits
          <span class="mv-section-count">${achItems.length}</span>
          <span class="mv-section-actions">
            <button type="button" class="btn btn-outline btn-sm" data-action="_stMissionAchievements" data-id="${_esc(item.id)}">Voir la galerie</button>
            ${STATE.isAdmin ? `<button type="button" class="btn btn-gold btn-sm" data-action="_stCreateMissionAchievement" data-id="${_esc(item.id)}">+ Ajouter un haut-fait</button>` : ''}
          </span>
        </h3>
        ${achItems.length
          ? `<div class="mv-achs">${achCardsHtml}</div>`
          : `<div class="mv-empty"><span>${trophyIcon}</span><span>Aucun haut-fait n'est encore lie a cette mission.</span></div>`}
      </section>` : '';

  openModal('', `
  <div class="mv-shell">

    <!-- ── Hero ───────────────────────────────────────────────── -->
    <div class="mv-hero">
      <div class="mv-hero-bg" ${item.imageUrl ? `style="background-image:url('${_esc(bgUrl)}')"` : ''}></div>
      <div class="mv-hero-fade"></div>
      <div class="mv-hero-content">
        <div class="mv-hero-eyebrow">
          <span>${_esc(item.acte || 'Acte I')}</span>
          <span class="mv-hero-eyebrow-sep">·</span>
          <span>${item.type === 'event' ? 'Événement' : 'Mission'}</span>
        </div>
        <h1 class="mv-hero-title">${_esc(item.titre || 'Sans titre')}</h1>
        <div class="mv-hero-meta">
          <span class="mv-hero-statut" style="color:${st.color};border-color:${st.border}">
            ${st.icon} <span>${_esc(item.statut || 'En attente')}</span>
          </span>
          ${_grpMixed
            ? `<span class="mv-hero-diverge">⚠ Résultats divergents ${_grpDots}</span>` : ''}
          ${item.axe ? `<span class="mv-hero-axe" style="color:${axeCol}">● ${_esc(item.axe)}</span>` : ''}
          ${item.date ? `<span class="mv-hero-meta-item">📅 ${_esc(item.date)}</span>` : ''}
          ${item.lieu ? `<span class="mv-hero-meta-item">📍 ${_esc(item.lieu)}</span>` : ''}
        </div>
      </div>
      ${prog > 0 ? `<div class="mv-hero-prog">
        <div class="mv-hero-prog-fill" style="width:${prog}%;background:${st.color}"></div>
      </div>` : ''}
    </div>

    <!-- ── Stats bar ──────────────────────────────────────────── -->
    <div class="mv-stats">
      <div class="mv-stat">
        <div class="mv-stat-num" style="color:${st.color}">${prog}<small>%</small></div>
        <div class="mv-stat-lbl">Avancement</div>
      </div>
      <div class="mv-stat">
        <div class="mv-stat-num">${groups.length}</div>
        <div class="mv-stat-lbl">Groupe${groups.length > 1 ? 's' : ''}</div>
      </div>
      <div class="mv-stat">
        <div class="mv-stat-num">${totalMembers}</div>
        <div class="mv-stat-lbl">Personnage${totalMembers > 1 ? 's' : ''}</div>
      </div>
      ${achItems.length ? `<div class="mv-stat">
        <div class="mv-stat-num">🏆 ${achItems.length}</div>
        <div class="mv-stat-lbl">Haut${achItems.length > 1 ? 's' : ''}-Fait${achItems.length > 1 ? 's' : ''}</div>
      </div>` : ''}
      ${relationCount ? `<div class="mv-stat">
        <div class="mv-stat-num">${relationCount}</div>
        <div class="mv-stat-lbl">Lien${relationCount > 1 ? 's' : ''}</div>
      </div>` : ''}
    </div>

    <!-- ── Body : sections ────────────────────────────────────── -->
    <div class="mv-body">
      <div class="mv-layout">
        <main class="mv-main">

      <!-- Récit -->
      ${item.description ? `
      <section class="mv-section">
        <h3 class="mv-section-title">📜 Récit</h3>
        <div class="mv-recit">${_nl2br(item.description)}</div>
      </section>` : `
      <section class="mv-section">
        <div class="mv-empty">
          <span>📜</span>
          <span>Aucun récit n'a encore été écrit pour cette mission.</span>
        </div>
      </section>`}

      <!-- Groupes (quêtes liées) — les joueurs rejoignent, le MJ gère -->
      ${`
      <section class="mv-section">
        <h3 class="mv-section-title">
          👥 Groupes
          <span class="mv-section-count">${groups.length}</span>
          ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm mv-group-add" data-action="_stGroupNew" data-mission="${item.id}">＋ Nouveau groupe</button>` : ''}
        </h3>
        ${groups.length ? `<div class="mv-groups">
          ${groups.map(g => _storyGroupCardHtml(g, item.id)).join('')}
        </div>` : `<div class="mv-empty"><span>👥</span><span>${STATE.isAdmin ? 'Aucun groupe. Crée-en un pour que les joueurs le rejoignent.' : 'Aucun groupe ouvert pour cette mission pour le moment.'}</span></div>`}
      </section>`}

        </main>

        <aside class="mv-side">
          <section class="mv-side-card mv-side-card--relations">
            <div class="mv-side-title">Accès rapides</div>
            <div class="mv-rel-actions">
              <button type="button" class="mv-rel-action" data-action="_stGoAgenda">
                <span>📅</span><b>Agenda</b><small>planifier</small>
              </button>
              <button type="button" class="mv-rel-action" data-action="_stMissionStats" data-id="${_esc(item.id)}">
                <span>📊</span><b>Stats</b><small>mission</small>
              </button>
              <button type="button" class="mv-rel-action" data-action="_stMissionAchievements" data-id="${_esc(item.id)}">
                <span>🏆</span><b>Hauts-faits</b><small>${achItems.length || 0} lié${achItems.length > 1 ? 's' : ''}</small>
              </button>
            </div>
            <div class="mv-rel-subtitle">Séances liées</div>
            ${_storyMissionSessionHtml(missionSessions, groups)}
          </section>
          <section class="mv-side-card">
            <div class="mv-side-title">Synthèse</div>
            <div class="mv-side-progress" style="--mv-prog:${synthColor}">
              <span>${synthProgress}<small>%</small></span>
              <div><i style="width:${synthProgress}%"></i></div>
            </div>
            <div class="mv-side-grid">
              <span><b>${groups.length}</b><small>groupes</small></span>
              <span><b>${totalMembers}</b><small>persos</small></span>
              <span><b>${avgGroupSuccess}</b><small>réussite moy.</small></span>
              <span><b>${rewardedGroups}</b><small>récompenses</small></span>
            </div>
          </section>
          <section class="mv-side-card">
            <div class="mv-side-title">Repères</div>
            <dl class="mv-side-list">
              <div><dt>Statut</dt><dd style="color:${st.color}">${st.icon} ${_esc(item.statut || 'En attente')}</dd></div>
              ${item.axe ? `<div><dt>Axe</dt><dd style="color:${axeCol}">● ${_esc(item.axe)}</dd></div>` : ''}
              ${item.date ? `<div><dt>Date</dt><dd>${_esc(item.date)}</dd></div>` : ''}
              ${item.lieu ? `<div><dt>Lieu</dt><dd>${_esc(item.lieu)}</dd></div>` : ''}
              <div><dt>Visibilité</dt><dd>${item.visibleJoueurs === false ? 'MJ uniquement' : 'Joueurs'}</dd></div>
            </dl>
          </section>

          ${STATE.isAdmin ? `<section class="mv-side-card mv-side-card--actions">
            <button class="btn btn-gold" data-action="_stEditAfterClose" data-id="${item.id}">✏️ Modifier</button>
            <button class="btn btn-outline btn-sm" data-action="_ouvrirHistoire" data-id="${item.id}" data-titre="${_esc(item.titre||'')}" data-acte="${_esc(item.acte||'')}">✍️ Ouvrir l'histoire</button>
          </section>` : ''}
        </aside>
      </div>

      <!-- Hauts-Faits issus de cette mission -->
      ${missionAchievementsHtml}

      <!-- Relations de mission -->
      ${relationCount ? `
      <section class="mv-section">
        <h3 class="mv-section-title">
          ↝ Relations de mission
          <span class="mv-section-count">${relationCount}</span>
        </h3>
        ${parentItems.length ? `<div class="mv-relation-block">
          <div class="mv-relation-label">Origines</div>
          <div class="mv-liens">${parentItems.map(l => relationCardHtml(l, 'from')).join('')}</div>
        </div>` : ''}
        ${liensItems.length ? `<div class="mv-relation-block">
          <div class="mv-relation-label">Suites ouvertes</div>
          <div class="mv-liens">${liensItems.map(l => relationCardHtml(l, 'to')).join('')}</div>
        </div>` : ''}
      </section>` : ''}

    </div><!-- /mv-body -->

    <!-- ── Footer ─────────────────────────────────────────────── -->
    <div class="mv-footer">
      <button class="btn btn-outline btn-sm" data-action="closeModalDirect">Fermer</button>
      ${STATE.isAdmin ? `
        <button class="btn btn-outline btn-sm mv-footer-danger" data-action="_stDeleteAfterClose" data-id="${item.id}">🗑️ Supprimer</button>
        <button class="btn btn-gold" data-action="_stEditAfterClose" data-id="${item.id}">✏️ Modifier</button>
      ` : ''}
    </div>

  </div><!-- /mv-shell -->
  `);
}

// ── MODAL AJOUT / ÉDITION ─────────────────────────────────────────────────────
async function openStoryModal(item = null) {
  _stCropper?.destroy(); _stCropper = null;
  const acteActif   = STORE.storyActe || 'Acte I';
  const allItems    = await loadCollection('story');
  const autresItems = allItems.filter(i => i.id !== item?.id);
  STORE.modalGroupes = [...(item?.groupes || [])];
  STORE.modalStoryId = item?.id || '';

  // Statuts disponibles + config visuelle pour les pills
  const STATUTS = [
    { v: 'En cours',   c: 'var(--st-cours)',    i: '▶' },
    { v: 'Terminée',   c: 'var(--st-terminee)', i: '✓' },
    { v: 'En attente', c: 'var(--st-attente)',  i: '◷' },
    { v: 'Échouée',    c: 'var(--st-echec)',    i: '✗' },
  ];
  const curStatut = item?.statut || 'En cours';

  // Liste des axes existants (autocomplete)
  const knownAxes = [...new Set(allItems.map(i => i.axe).filter(Boolean))].sort();

  openModal('', `
  <div class="mn-shell">

    <!-- ════ HERO BANNER — preview live + image drop integré ═══════ -->
    <div class="mn-hero" id="mn-hero">
      <div class="mn-hero-bg" id="mn-hero-bg"
        style="${item?.imageUrl ? `background-image:url('${_esc(item.imageUrl).replace(/'/g,"%27")}')` : ''}"></div>
      <div class="mn-hero-fade"></div>

      <!-- Drop zone overlay (cropper rattaché) -->
      <div id="st-drop-zone" class="mn-hero-drop" title="Cliquer ou déposer une image">
        <div id="st-drop-preview"></div>
        <div class="mn-hero-drop-hint">
          <span class="mn-hero-drop-icon">🖼️</span>
          <span>Glisser une image ou cliquer pour ouvrir</span>
        </div>
      </div>

      <!-- Contenu hero : eyebrow + titre + meta -->
      <div class="mn-hero-content">
        <div class="mn-hero-eyebrow">
          <span id="mn-acte-preview">${_esc(item?.acte || acteActif)}</span>
          <span class="mn-hero-eyebrow-sep">·</span>
          <span id="mn-type-preview">${(item?.type || 'mission') === 'event' ? 'Événement' : 'Mission'}</span>
        </div>
        <input type="text" class="mn-hero-title" id="st-titre"
          value="${_esc(item?.titre||'')}"
          placeholder="${item ? _esc(item.titre || '') : 'Donne un nom à ta mission…'}"
          autocomplete="off" autofocus>
        <div class="mn-hero-meta">
          <span class="mn-hero-statut" id="mn-statut-preview"
            style="color:${stCfg({statut:curStatut}).color};border-color:${stCfg({statut:curStatut}).border}">
            ${stCfg({statut:curStatut}).icon} <span>${_esc(curStatut)}</span>
          </span>
          <span class="mn-hero-axe" id="mn-axe-preview"
            style="${item?.axe ? `color:${STORE.axeMap[item.axe] || 'var(--text-muted)'}` : ''}">
            ${item?.axe ? `● ${_esc(item.axe)}` : ''}
          </span>
        </div>
      </div>

      <!-- Cropper inline (apparaît quand on upload une image) -->
      <div id="st-crop-wrap" class="mn-crop-wrap" style="display:none">
        <canvas id="st-crop-canvas"></canvas>
        <div class="mn-crop-bar">
          <span class="mn-crop-hint">Recadre · ratio 4:3</span>
          <button type="button" class="btn btn-gold btn-sm" id="st-crop-confirm">✂️ Confirmer</button>
          <div id="st-crop-ok" style="display:none;font-size:.75rem"></div>
        </div>
      </div>
    </div>

    <!-- ════ TABS ════════════════════════════════════════════════ -->
    <div class="mn-tabs" role="tablist" aria-label="Sections de la mission">
      <button type="button" id="mn-tab-histoire" class="mn-tab is-active" data-tab="histoire" role="tab" aria-selected="true" aria-controls="mn-panel-histoire">📜 Histoire</button>
      <button type="button" id="mn-tab-groupes" class="mn-tab" data-tab="groupes" role="tab" aria-selected="false" aria-controls="mn-panel-groupes">👥 Groupes <span class="mn-tab-count" id="mn-tab-count-groupes">${_missionQuestGroups(item?.id).length || ''}</span></button>
      ${autresItems.length ? `<button type="button" id="mn-tab-liens" class="mn-tab" data-tab="liens" role="tab" aria-selected="false" aria-controls="mn-panel-liens">↝ Liens <span class="mn-tab-count" id="mn-tab-count-liens">${(item?.liens||[]).length || ''}</span></button>` : ''}
      <button type="button" id="mn-tab-reglages" class="mn-tab" data-tab="reglages" role="tab" aria-selected="false" aria-controls="mn-panel-reglages">⚙️ Réglages</button>
    </div>

    <!-- ════ TAB CONTENT ═════════════════════════════════════════ -->
    <div class="mn-body">

      <!-- ── ONGLET HISTOIRE ────────────────────────────────────── -->
      <section id="mn-panel-histoire" class="mn-panel is-active" data-panel="histoire" role="tabpanel" aria-labelledby="mn-tab-histoire">

        <!-- Type segmented control -->
        <div class="mn-row">
          <label class="mn-label">Type</label>
          <div class="mn-segmented" id="mn-type-seg" role="group" aria-label="Type de récit">
            <button type="button" class="mn-seg ${(item?.type||'mission')==='mission'?'is-active':''}" data-type="mission" aria-pressed="${(item?.type || 'mission') === 'mission'}">🎯 Mission</button>
            <button type="button" class="mn-seg ${item?.type==='event'?'is-active':''}" data-type="event" aria-pressed="${item?.type === 'event'}">📖 Événement</button>
          </div>
          <input type="hidden" id="st-type" value="${item?.type || 'mission'}">
        </div>

        <!-- Statut en pills cliquables -->
        <div class="mn-row">
          <label class="mn-label">Statut</label>
          <div class="mn-statut-pills" id="mn-statut-pills" role="group" aria-label="Statut de la mission">
            ${STATUTS.map(s => `<button type="button"
              class="mn-statut-pill ${s.v===curStatut?'is-active':''}"
              data-statut="${s.v}"
              aria-pressed="${s.v === curStatut}"
              style="--c:${s.c}">
              <span class="mn-statut-pill-icon">${s.i}</span>${s.v}
            </button>`).join('')}
          </div>
          <input type="hidden" id="st-statut" value="${curStatut}">
        </div>

        <!-- Grille axe + date + lieu -->
        <div class="mn-grid-2">
          <div class="mn-field">
            <label class="mn-label">Axe narratif</label>
            <div class="mn-axe-wrap">
              <input type="text" class="mn-input" id="st-axe"
                value="${_esc(item?.axe||'')}" placeholder="ex: Mystères de Granlac"
                list="st-axe-list" autocomplete="off">
              <datalist id="st-axe-list">
                ${knownAxes.map(a => `<option value="${_esc(a)}">`).join('')}
              </datalist>
            </div>
            ${knownAxes.length ? `<div class="mn-axe-chips">
              ${knownAxes.slice(0, 5).map(a => `<button type="button" class="mn-axe-chip"
                style="color:${STORE.axeMap[a] || 'var(--text-muted)'};border-color:${STORE.axeMap[a] ? STORE.axeMap[a] + '55' : 'var(--border)'}"
                data-action="_stPickAxe" data-axe="${_esc(a)}">
                ● ${_esc(a)}
              </button>`).join('')}
            </div>` : ''}
          </div>
          <div class="mn-field">
            <label class="mn-label">Date / Session</label>
            <input type="text" class="mn-input" id="st-date"
              value="${_esc(item?.date||'')}" placeholder="Session 1, 27 Mars 1247…">
          </div>
        </div>

        <div class="mn-field">
          <label class="mn-label">Lieu</label>
          <input type="text" class="mn-input" id="st-lieu"
            value="${_esc(item?.lieu||'')}" placeholder="Forêt du Cap d'Espérance">
        </div>

        <!-- Description : large -->
        <div class="mn-field">
          <label class="mn-label">Description <span class="mn-label-hint">— ce que le récit raconte</span></label>
          <textarea class="mn-input mn-textarea" id="st-desc" rows="5"
            placeholder="Quelques lignes pour camper la mission, ses enjeux, ses lieux clés…">${_esc(item?.description||'')}</textarea>
        </div>
      </section>

      <!-- ── ONGLET GROUPES ─────────────────────────────────────── -->
      <section id="mn-panel-groupes" class="mn-panel" data-panel="groupes" role="tabpanel" aria-labelledby="mn-tab-groupes" hidden>
        <div class="mn-panel-intro">
          Les personnages sont rattachés à un <strong>groupe</strong>. Plusieurs groupes peuvent
          mener la même mission en parallèle, chacun avec sa propre réussite et récompense.
          Ce sont les mêmes groupes que sur la fiche de la mission.
        </div>
        <div id="st-groups-summary">
          ${_renderMissionGroupSummary(_missionQuestGroups(item?.id))}
        </div>
        <div id="st-groups-list" class="st-groups-list">
          ${_renderGroupsPanel(item?.id)}
        </div>
        ${item?.id && STATE.isAdmin ? `<button type="button" class="st-group-add" data-action="_stGroupNew" data-mission="${_esc(item.id)}">+ Nouveau groupe</button>` : ''}
      </section>

    ${autresItems.length?`
      <!-- ── ONGLET LIENS ───────────────────────────────────────── -->
      <section id="mn-panel-liens" class="mn-panel" data-panel="liens" role="tabpanel" aria-labelledby="mn-tab-liens" hidden>
        <div class="mn-panel-intro">
          Sélectionne les missions qui se déclenchent <strong>après</strong> celle-ci.
          Si elles sont sur un axe différent, un trait pointillé doré les reliera sur la carte.
        </div>
        <div class="mn-liens-search-wrap">
          <span>🔍</span>
          <input type="text" id="mn-liens-search" placeholder="Filtrer les missions…">
        </div>
      <div id="st-liens-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.55rem;margin-top:.4rem">
        ${autresItems.map(other => {
          const checked=(item?.liens||[]).includes(other.id);
          const axeCol=other.axe?(STORE.axeMap[other.axe]||'var(--text-dim)'):'var(--text-dim)';
          const stOther=stCfg(other);
          return `
          <div id="lien-card-${other.id}"
            data-action="_toggleLien" data-id="${other.id}"
            style="position:relative;cursor:pointer;border-radius:10px;overflow:hidden;
              border:2px solid ${checked?'var(--gold)':'var(--border)'};
              background:${checked?'rgba(232,184,75,.08)':'var(--bg-elevated)'};
              transition:all .15s;user-select:none;">
            <div style="height:52px;background:var(--bg-panel);overflow:hidden;position:relative">
              ${other.imageUrl
                ?`<img src="${other.imageUrl}" alt="${_esc(other.nom || other.titre || '')}" style="width:100%;height:100%;object-fit:cover;display:block">`
                :`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.2rem">${other.type==='mission'?'🎯':'📖'}</div>`
              }
              <div id="lien-tick-${other.id}" style="
                position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;
                background:${checked?'var(--gold)':'rgba(11,17,24,.75)'};
                border:1.5px solid ${checked?'var(--gold)':'rgba(255,255,255,.2)'};
                display:flex;align-items:center;justify-content:center;
                font-size:.65rem;color:#0b1118;font-weight:700;transition:all .15s;">
                ${checked?'✓':''}
              </div>
              <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:${axeCol};opacity:.8"></div>
            </div>
            <div style="padding:.35rem .45rem">
              <div style="font-family:'Cinzel',serif;font-size:.65rem;color:var(--text);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3"
                title="${other.titre||''}">${other.titre||'Mission'}</div>
              ${other.axe?`<div style="font-size:.6rem;color:${axeCol};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${other.axe}</div>`:''}
              <div style="font-size:.58rem;color:${stOther.color};margin-top:1px">${stOther.icon} ${other.statut||'En attente'}</div>
            </div>
            <input type="checkbox" id="lien-${other.id}" ${checked?'checked':''} style="display:none">
          </div>`;
        }).join('')}
        </div>
      </section>`:``}

      <!-- ── ONGLET RÉGLAGES ────────────────────────────────────── -->
      <section id="mn-panel-reglages" class="mn-panel" data-panel="reglages" role="tabpanel" aria-labelledby="mn-tab-reglages" hidden>
        <div class="mn-grid-2">
          <div class="mn-field">
            <label class="mn-label">Acte <span class="mn-label-hint">— quel chapitre de la trame</span></label>
            <input type="text" class="mn-input" id="st-acte"
              value="${_esc(item?.acte||acteActif)}" placeholder="Acte I">
          </div>
          <div class="mn-field">
            <label class="mn-label">Ordre <span class="mn-label-hint">— position dans la frise temporelle</span></label>
            <input type="number" class="mn-input" id="st-ordre" value="${item?.ordre||0}" min="0">
          </div>
        </div>

        <label class="mn-toggle">
          <input type="checkbox" id="st-visible" ${item?.visibleJoueurs===false?'':'checked'}>
          <span class="mn-toggle-track"><span class="mn-toggle-thumb"></span></span>
          <span class="mn-toggle-text">
            <strong>Visible aux joueurs</strong>
            <span class="mn-label-hint">décoche pour préparer en secret</span>
          </span>
        </label>

        ${item?.id ? `
        <div class="mn-danger-zone">
          <div class="mn-danger-title">⚠️ Zone dangereuse</div>
          <button type="button" class="mn-btn-danger"
            data-action="_stDeleteAfterCloseModal" data-id="${item.id}">🗑️ Supprimer cette mission</button>
        </div>` : ''}
      </section>
    </div><!-- /mn-body -->

    <!-- ════ FOOTER STICKY ═══════════════════════════════════════ -->
    <div class="mn-footer">
      <div class="mn-footer-hint">
        <kbd>Ctrl</kbd>+<kbd>S</kbd> pour enregistrer · <kbd>Esc</kbd> pour fermer
      </div>
      <div class="mn-footer-actions">
        <button class="btn btn-outline btn-sm" data-action="closeModalDirect">Annuler</button>
        <button class="btn btn-gold" id="mn-save-btn" data-action="saveStory" data-id="${item?.id||''}">
          ${item?'💾 Enregistrer':'＋ Créer la mission'}
        </button>
      </div>
    </div>

  </div><!-- /mn-shell -->
  `);

  // ── Bindings UI : tabs, segmented, statut pills, live preview, raccourcis ──
  _initMissionModalUI(item);

  // (Anciens handlers participants individuels supprimés — modèle "groupes only")

  // ── Upload + crop image (4:3 verrouillé) ──────────────────────────────────
  _stCropper?.destroy();
  _stCropper = attachDropAndCrop({
    dropEl:        document.getElementById('st-drop-zone'),
    previewEl:     document.getElementById('st-drop-preview'),
    cropWrapEl:    document.getElementById('st-crop-wrap'),
    canvasId:      'st-crop-canvas',
    statusEl:      document.getElementById('st-crop-ok'),
    confirmBtnEl:  document.getElementById('st-crop-confirm'),
    initialUrl:    item?.imageUrl || '',
    ratio:         { w: 4, h: 3 },
    previewMaxH:   70,
    output:        { maxW: 800, target: 700_000 },
    onResult: (b64) => {
      // Sync live le fond du hero avec l'image confirmée
      const hero = document.getElementById('mn-hero-bg');
      if (!hero) return;
      if (b64) hero.style.backgroundImage = `url("${String(b64).replace(/"/g,'%22')}")`;
      else hero.style.backgroundImage = '';
    },
  });
}

// Toggle visuel d'une card lien (mission → mission). Au niveau module pour être
// accessible depuis le registre d'actions (sinon ReferenceError au clic).
function _toggleLien(id) {
  const cb   = document.getElementById(`lien-${id}`);
  const card = document.getElementById(`lien-card-${id}`);
  const tick = document.getElementById(`lien-tick-${id}`);
  if (!cb || !card || !tick) return;
  cb.checked = !cb.checked;
  const on = cb.checked;
  card.style.borderColor = on ? 'var(--gold)' : 'var(--border)';
  card.style.background  = on ? 'rgba(232,184,75,.08)' : 'var(--bg-elevated)';
  tick.style.background  = on ? 'var(--gold)' : 'rgba(11,17,24,.75)';
  tick.style.borderColor = on ? 'var(--gold)' : 'rgba(255,255,255,.2)';
  tick.textContent       = on ? '✓' : '';
}

// ── PERSONNALISATION DES AXES (MJ) ────────────────────────────────────────────
let _axeOrderSortable = null;
function openAxeOrder() {
  if (!STATE.isAdmin) return;
  const axes = Object.keys(STORE.axeMap).sort((a, b) => _axeRank(a) - _axeRank(b));
  if (!axes.length) { showNotif('Aucun axe à personnaliser.', 'info'); return; }
  openModal('◉ Gérer les axes', `
    <p class="axe-order-help">
      Choisis leur couleur. Glisse-les pour définir leur ordre dans les vues Carte et Saga.
    </p>
    <div id="axe-order-list" class="axe-order-list">
      ${axes.map(a => `
        <div class="axe-order-row" data-axe="${_esc(a)}" style="--axe-color:${axeColor(a)}">
          <span class="axe-order-grip" title="Glisser pour réordonner">⠿</span>
          <span class="axe-order-dot"></span>
          <span class="axe-order-name">${_esc(a)}</span>
          <div class="axe-order-colors" role="group" aria-label="Couleur de l'axe ${_esc(a)}">
            <div class="axe-order-palette">
              ${AXE_COLORS.map((color, index) => `<button type="button" class="axe-order-swatch${axeColor(a) === color ? ' is-active' : ''}" style="--swatch:${color}" data-action="_stPickAxeColor" data-color="${color}" data-axe-preset title="${AXE_COLOR_NAMES[index]}" aria-label="${AXE_COLOR_NAMES[index]}" aria-pressed="${axeColor(a) === color}"></button>`).join('')}
            </div>
            <label class="axe-order-custom-wrap${AXE_COLORS.includes(axeColor(a)) ? '' : ' is-active'}" title="Choisir une couleur personnalisée">
              <input class="axe-order-color" type="color" value="${axeColor(a)}" data-axe-color data-axe="${_esc(a)}" aria-label="Couleur personnalisée de l'axe ${_esc(a)}">
              <span>Libre</span>
            </label>
          </div>
        </div>`).join('')}
    </div>
    <div class="axe-order-actions">
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
      <button class="btn btn-gold btn-sm" data-action="saveAxeOrder">💾 Enregistrer les axes</button>
    </div>
  `);
  const list = document.getElementById('axe-order-list');
  if (list) {
    try { _axeOrderSortable?.destroy(); } catch {}
    _axeOrderSortable = makeSortable(list, {
      prefix: 'cs', draggable: '.axe-order-row', handle: '.axe-order-grip', delay: 60,
    });
    list.querySelectorAll('[data-axe-color]').forEach(input => {
      input.addEventListener('input', () => {
        _previewAxeColor(input.closest('.axe-order-row'), input.value);
      });
    });
  }
}
async function saveAxeOrder() {
  if (!STATE.isAdmin) return;
  const shownOrder = [...document.querySelectorAll('#axe-order-list .axe-order-row')]
    .map(r => r.dataset.axe).filter(Boolean);
  const shownAxes = new Set(shownOrder);
  const order = [...shownOrder, ...(STORE.axeOrder || []).filter(axe => !shownAxes.has(axe))];
  const colors = { ...STORE.axeColors };
  document.querySelectorAll('#axe-order-list [data-axe-color]').forEach(input => {
    const axe = input.dataset.axe;
    const color = _normalizeAxeColor(input.value);
    if (axe && color) colors[axe] = color;
  });
  STORE.axeOrder = order;
  if (await tryDoc('story_meta', 'axes', { order, colors })) {
    STORE.axeColors = colors;
    shownOrder.forEach(axe => { STORE.axeMap[axe] = colors[axe] || STORE.axeMap[axe]; });
    closeModalDirect();
    showNotif('Axes mis à jour.', 'success');
    renderStory();
  }
}

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveStory(id = '') {
  try {
    const titre=document.getElementById('st-titre')?.value?.trim();
    if(!titre){showNotif('Le titre est requis.','error');return;}

    // Image : nouveau crop > existante (pas de bouton "retirer")
    const cropResult = _stCropper?.getResult();
    let imageUrl = '';
    if (typeof cropResult === 'string') {
      imageUrl = cropResult;
    } else if (id) {
      const existing = (await loadCollection('story')).find(i => i.id === id);
      imageUrl = existing?.imageUrl || '';
    }

    // Participants = union des membres de TOUS les groupes (déduplication par id).
    // On les matérialise depuis STATE.characters pour conserver photo / photoX,Y.
    // C'est le seul moyen de rattacher des personnages à une mission désormais :
    // pas de participants individuels possibles.
    const questGroups = _missionQuestGroups(id);
    const participants = questGroups.length
      ? storyParticipantsFromGroups(
          questGroups.map(g => ({
            membres: dedupeQuestParticipants(g.participants || []).map(p => p.charId).filter(Boolean),
          })),
          STATE.characters)
      : storyParticipantsFromGroups(STORE.modalGroupes, STATE.characters);

    const allCb=document.querySelectorAll('[id^="lien-"]');
    const liens=[...allCb].filter(cb=>cb.checked).map(cb=>cb.id.replace('lien-',''));

    const data={
      type:          document.getElementById('st-type')?.value       ||'mission',
      titre,
      acte:          document.getElementById('st-acte')?.value?.trim() ||'Acte I',
      axe:           document.getElementById('st-axe')?.value?.trim()  ||'',
      date:          document.getElementById('st-date')?.value?.trim() ||'',
      lieu:          document.getElementById('st-lieu')?.value?.trim() ||'',
      description:   document.getElementById('st-desc')?.value         ||'',
      imageUrl,
      participants,
      statut:        document.getElementById('st-statut')?.value       ||'En cours',
      visibleJoueurs: document.getElementById('st-visible')?.checked !== false,
      liens,
      ordre:         parseInt(document.getElementById('st-ordre')?.value)||0,
      groupes:       STORE.modalGroupes,
    };

    // Persister l'acte si nouveau
    const savedActes=await loadActes();
    if(!savedActes.includes(data.acte)){ savedActes.push(data.acte); savedActes.sort(); await saveActes(savedActes); }

    if(id) await updateInCol('story',id,data);
    else   await addToCol('story',data);

    STORE.storyActe = data.acte;
    _stCropper?.destroy(); _stCropper = null;
    closeModal();
    showNotif(id?'Mission mise à jour.':`"${titre}" ajoutée !`,'success');
    await PAGES.story();
  } catch (e) { notifySaveError(e); }
}

// ── ÉDITER / SUPPRIMER ────────────────────────────────────────────────────────
function editStory(id){
  const items = getCachedCollection('story') || [];
  const item = items.find(i=>i.id===id);
  if(item) openStoryModal(item);
}
async function deleteStory(id){
  const snapshot = (getCachedCollection('story') || []).find(item => item.id === id);
  if (!await confirmDelete('story', id, 'Supprimer cet élément de la trame ?', {
    snapshot,
    successMessage: 'Élément supprimé.',
    onRestore: () => PAGES.story(),
  })) return;
  await PAGES.story();
}

// ── NOUVEL ACTE ───────────────────────────────────────────────────────────────
function openNewActeModal(){
  openModal('+ Nouvel Acte',`
    <div class="form-group">
      <label>Nom de l'acte</label>
      <input class="input-field" id="new-acte-name" placeholder="Acte II">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem"
      data-action="_createNewActe">Créer</button>
  `);
}
async function _createNewActe() {
  const name=document.getElementById('new-acte-name')?.value?.trim();if(!name)return;
  const list=await loadActes();
  if(!list.includes(name)){list.push(name);list.sort();await saveActes(list);}
  STORE.storyActe = name;
  closeModal();
  await PAGES.story();
}

// ── OUVRIR L'ÉDITEUR D'HISTOIRE ───────────────────────────────────────────────
function _ouvrirHistoire(id, titre, acte) {
  setHistoireCtx(id, titre, acte);
  navigate('histoire');
}

// ── OVERRIDE + EXPORTS ────────────────────────────────────────────────────────
PAGES.story = renderStory;

export { renderStory, openStoryModal, openStoryDetail, openNewActeModal, saveStory, editStory, deleteStory };

registerActions({
  openStoryDetail:         (btn) => openStoryDetail(btn.dataset.id),
  openStoryModal:          ()    => openStoryModal(),
  openNewActeModal:        ()    => openNewActeModal(),
  editStory:               (btn) => editStory(btn.dataset.id),
  deleteStory:             (btn) => deleteStory(btn.dataset.id),
  saveStory:               (btn) => saveStory(btn.dataset.id || ''),
  closeModalDirect:        ()    => closeModalDirect(),
  _stOpenLien:             (btn) => { closeModalDirect(); openStoryDetail(btn.dataset.id); },
  _stOpenAch:              async (btn) => { const { openAchievementLightbox } = await import('./achievements.js'); openAchievementLightbox(btn.dataset.id); },
  // Groupes de mission (quêtes liées)
  _stGroupNew:             (btn) => _stGroupNew(btn.dataset.mission),
  _stGroupJoin:            (btn) => _stGroupJoin(btn.dataset.id, btn.dataset.mission),
  _stGroupPickChar:        (btn) => _stGroupPickChar(btn.dataset.id, btn.dataset.mission, btn.dataset.char),
  _stGroupFieldSave:       (el)  => _stGroupFieldSave(el),
  _stGroupOpenMemberPicker:(btn) => _stGroupOpenMemberPicker(btn),
  _stGroupMemberFilter:    (el)  => _stGroupMemberFilter(el),
  _stGroupAddMember:       (el)  => _stGroupAddMember(el),
  _stGroupRemoveMember:    (btn) => _stGroupRemoveMember(btn),
  _stGroupDelete:          (btn) => _stGroupDelete(btn.dataset.id, btn.dataset.mission),
  _stMigrateGroups:        ()    => _stMigrateGroups(),
  _stOpenAfterClose:       (btn) => openStoryDetail(btn.dataset.id),
  _stDeleteAfterClose:     (btn) => { closeModalDirect(); deleteStory(btn.dataset.id); },
  _stEditAfterClose:       (btn) => { closeModalDirect(); editStory(btn.dataset.id); },
  _stCreateMissionAchievement: async (btn) => {
    const missionId = btn.dataset.id;
    closeModalDirect();
    const { createAchievementForMission } = await import('./achievements.js');
    createAchievementForMission(missionId);
  },
  _stMissionAchievements:  async (btn) => {
    const missionId = btn.dataset.id;
    closeModalDirect();
    const { openAchievementsForMission } = await import('./achievements.js');
    openAchievementsForMission(missionId, 'galerie');
  },
  _stGoAgenda:             ()    => { closeModalDirect(); navigate('agenda'); },
  _stGoAchievements:       ()    => { closeModalDirect(); navigate('achievements'); },
  _stMissionStats:         (btn) => { closeModalDirect(); _storyOpenMissionStats(btn.dataset.id); },
  _stDeleteAfterCloseModal:(btn) => { closeModal(); deleteStory(btn.dataset.id); },
  _stSetView:              (btn) => _stSetView(btn.dataset.view),
  _stSetFilter:            (btn) => _stSetFilter(btn.dataset.key, btn.dataset.val),
  _stOnSearch:             (el)  => _stOnSearch(el),
  _stSetStatut:            (el)  => _stSetFilter('statut', el.value),
  _stSetPlayerScope:       (btn) => _stSetPlayerScope(btn.dataset.scope),
  _stResetFilters:         ()    => _stResetFilters(),
  _stSwitchActe:           (btn) => _stSwitchActe(btn.dataset.acte),
  _toggleLien:             (btn) => _toggleLien(btn.dataset.id),
  _stPickAxeColor:         (btn) => _previewAxeColor(btn.closest('.axe-order-row'), btn.dataset.color),
  openAxeOrder:            () => openAxeOrder(),
  saveAxeOrder:            () => saveAxeOrder(),
  _ouvrirHistoire:         (btn) => _ouvrirHistoire(btn.dataset.id, btn.dataset.titre, btn.dataset.acte),
  _createNewActe:          ()    => _createNewActe(),
  _stPickAxe:              (btn) => {
    const el = document.getElementById('st-axe');
    if (el) { el.value = btn.dataset.axe; el.dispatchEvent(new Event('input')); }
  },
});
