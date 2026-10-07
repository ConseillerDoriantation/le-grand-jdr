// Fiche mission unifiée : lecture et édition inline dans une seule modale.
// Les collections sont lues depuis le cache live de la session. Les seuls
// accès réseau explicites sont le repli à froid et les écritures utilisateur.
import {
  loadCollection, getCachedCollection, getDocData,
  addToCol, updateInCol, saveDoc, deleteFromCol,
} from '../data/firestore.js';
import {
  openModal, pushModal, popModal, closeModalDirect,
  setModalCloseGuard, clearModalCloseGuard,
} from '../shared/modal.js';
import { bindScopedActions } from '../shared/scoped-actions.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { _esc } from '../shared/html.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import { getMyCharacters } from '../shared/char-stats.js';
import {
  dedupeQuestParticipants, questParticipantFromChar, storyParticipantsFromGroups,
} from '../shared/participants.js';
import { removeQuestAgendaSessions } from '../shared/agenda-sessions.js';

const COLORS = ['#9d6fff', '#f4c430', '#ff9544', '#38bdf8', '#ff6b9d', '#a3e635'];
const STATUS = {
  'En cours':   { color: '#4f8cff', icon: '▶' },
  'Terminée':   { color: '#22c38e', icon: '✓' },
  'En attente': { color: '#7a8fa8', icon: '◷' },
  'Échouée':    { color: '#ff5a7e', icon: '✕' },
};
const GROUP_STATUS = {
  active:   { label: 'En cours', color: '#4f8cff' },
  terminee: { label: 'Terminée', color: '#22c38e' },
  echouee:  { label: 'Échouée', color: '#ff5a7e' },
};
const ICONS = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  down: '<path d="M6 9l6 6 6-6"/>', back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
};
const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const initials = (value = '') => value.trim().charAt(0).toUpperCase() || 'M';
const norm = (value = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plural = (n, one, many = `${one}s`) => n > 1 ? many : one;

const MM = {
  id: null, item: null, draft: false, stack: [], menu: null, query: '',
  editDescription: false, confirm: '', save: 'idle', saveTimer: 0,
  agenda: null, acts: [], openToken: 0, onDeleted: null,
};

const handlers = {};
bindScopedActions('mm', handlers);
document.addEventListener('click', event => {
  if (!MM.menu || !document.querySelector('.mm')) return;
  if (!event.target.closest('.mm-pop, [data-mm-action="menu"]')) closeMenu();
}, true);

const stories = () => getCachedCollection('story') || [];
const quests = () => getCachedCollection('quests') || [];
const characters = () => getCachedCollection('characters') || STATE.characters || [];
const achievements = () => getCachedCollection('achievements') || [];
const groupsOf = (id) => quests().filter(q => q.missionId === id)
  .sort((a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'));
const current = () => MM.item;
const storyById = id => stories().find(item => item.id === id) || null;
const groupById = id => quests().find(item => item.id === id) || null;

function knownAxes() {
  return [...new Set(stories().map(item => item.axe).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
}
function axisColor(axis) {
  if (!axis) return '#7a8fa8';
  const axes = knownAxes();
  return COLORS[Math.max(0, axes.indexOf(axis)) % COLORS.length];
}
function statusConfig(item) { return STATUS[item?.statut] || STATUS['En attente']; }
function progressOf(item) {
  const values = groupsOf(item?.id).map(g => Number(g.reussite)).filter(Number.isFinite);
  if (values.length) return { value: Math.round(values.reduce((sum, n) => sum + n, 0) / values.length), count: values.length };
  if (item?.statut === 'Terminée') return { value: 100, count: 0 };
  if (item?.statut === 'Échouée') return { value: 0, count: 0 };
  return { value: item?.statut === 'En cours' ? 50 : 0, count: 0 };
}
function visibleStories() {
  return stories().filter(item => STATE.isAdmin || item.visibleJoueurs !== false);
}
function navList(item) {
  return visibleStories().filter(other => other.acte === item.acte)
    .sort((a, b) => (Number(a.ordre) || 0) - (Number(b.ordre) || 0)
      || knownAxes().indexOf(a.axe) - knownAxes().indexOf(b.axe));
}
function saveState(next) {
  MM.save = next;
  const el = document.getElementById('mm-save');
  if (!el) return;
  el.dataset.state = next;
  el.innerHTML = next === 'saved' ? `${icon('check', 13)} Enregistré` : next === 'saving' ? 'Enregistrement…' : 'Modifications enregistrées automatiquement';
}
function saving() {
  if (MM.draft) return;
  clearTimeout(MM.saveTimer);
  saveState('saving');
  MM.saveTimer = setTimeout(() => saveState('saved'), 420);
}

async function ensureData() {
  const names = ['story', 'quests', 'characters', 'achievements'];
  await Promise.all(names.map(name => getCachedCollection(name) ? null : loadCollection(name)));
  const actsDoc = await getDocData('story_meta', 'actes').catch(() => null);
  MM.acts = [...new Set([
    ...(Array.isArray(actsDoc?.list) ? actsDoc.list : []),
    ...stories().map(item => item.acte).filter(Boolean),
    'Acte I',
  ])].sort((a, b) => a.localeCompare(b, 'fr'));
  MM.agenda = await getDocData('agenda_session', 'next').catch(() => null);
}

function preserveView() {
  const root = document.querySelector('.mm');
  return {
    main: root?.querySelector('.mm-main')?.scrollTop || 0,
    side: root?.querySelector('.mm-side')?.scrollTop || 0,
    body: root?.querySelector('.mm-body')?.scrollTop || 0,
  };
}
function render({ resetScroll = false, focus = '' } = {}) {
  const host = document.getElementById('mission-modal-host');
  if (!host || !current()) return;
  const scroll = resetScroll ? { main: 0, side: 0, body: 0 } : preserveView();
  host.innerHTML = sheetHtml(current());
  const root = host.querySelector('.mm');
  const main = root?.querySelector('.mm-main');
  const side = root?.querySelector('.mm-side');
  const body = root?.querySelector('.mm-body');
  if (main) main.scrollTop = scroll.main;
  if (side) side.scrollTop = scroll.side;
  if (body) body.scrollTop = scroll.body;
  if (focus) requestAnimationFrame(() => host.querySelector(focus)?.focus());
  paintMenu();
  paintSave();
  installKeyboard();
}
function paintSave() { saveState(MM.save); }

function headerHtml(item) {
  const status = statusConfig(item);
  const progress = progressOf(item).value;
  const list = MM.draft ? [] : navList(item);
  const index = list.findIndex(entry => entry.id === item.id);
  const previous = MM.stack.length ? storyById(MM.stack.at(-1)) : null;
  return `<header class="mm-head">
    <div class="mm-cover">
      ${item.imageUrl ? `<img src="${_esc(item.imageUrl)}" alt="">` : `<span>${_esc(initials(item.titre))}</span>`}
      ${STATE.isAdmin ? `<button class="mm-cover-edit" data-mm-action="image">${icon('image', 18)}<span>${item.imageUrl ? "Changer l'image" : 'Ajouter une image'}</span></button>` : ''}
    </div>
    <div class="mm-id">
      ${previous ? `<button class="mm-back" data-mm-action="back">${icon('back', 13)} ${_esc(previous.titre || 'Mission précédente')}</button>` : ''}
      <div class="mm-eyebrow"><span>${_esc(item.acte || 'Acte I')}</span><span>·</span><span>${item.type === 'event' ? 'Événement' : 'Mission'}</span>${item.axe ? `<span>·</span><span style="color:${axisColor(item.axe)}">● ${_esc(item.axe)}</span>` : ''}</div>
      ${STATE.isAdmin ? `<input class="mm-title ed-in" value="${_esc(item.titre || '')}" placeholder="Nom de la mission…" data-mm-action="commit" data-mm-on="change" data-field="titre" aria-label="Titre de la mission">` : `<h2 class="mm-title">${_esc(item.titre || 'Sans titre')}</h2>`}
      <div class="mm-meta"><span class="mm-badge" style="--c:${status.color}">${status.icon} ${_esc(item.statut || 'En attente')}</span>${item.date ? `<span>${icon('calendar', 13)}${_esc(item.date)}</span>` : ''}${item.lieu ? `<span>${icon('pin', 13)}${_esc(item.lieu)}</span>` : ''}${item.visibleJoueurs === false ? `<span class="mm-secret">${icon('eyeOff', 13)}Cachée aux joueurs</span>` : ''}</div>
    </div>
    <div class="mm-tools">
      <div class="mm-tools-row">${list.length > 1 ? `<div class="mm-nav"><button class="mm-icon" data-mm-action="nav" data-delta="-1" aria-label="Mission précédente">${icon('left')}</button><span>${index + 1} / ${list.length}</span><button class="mm-icon" data-mm-action="nav" data-delta="1" aria-label="Mission suivante">${icon('right')}</button></div>` : ''}<button class="mm-icon" data-mm-action="close" aria-label="Fermer">${icon('x', 18)}</button></div>
      ${MM.draft ? `<button class="mm-btn primary" data-mm-action="create" ${item.titre?.trim() ? '' : 'disabled'}>Créer la mission</button>` : STATE.isAdmin ? `<div class="mm-save" id="mm-save" data-state="${MM.save}"></div>` : ''}
    </div>
    <div class="mm-progress"><i style="width:${progress}%;--status:${status.color}"></i></div>
  </header>${MM.confirm === 'draft' ? `<div class="mm-warning-bar">${icon('warning', 15)}<span>Cette mission n'est pas encore créée.</span><span class="mm-spacer"></span><button class="mm-btn small" data-mm-action="discard">Abandonner</button><button class="mm-btn small primary" data-mm-action="create">Créer la mission</button></div>` : ''}`;
}

function descriptionHtml(item) {
  let body = '';
  if (MM.editDescription) body = `<textarea class="ed-in mm-recit-input" data-mm-action="description" data-mm-on="change" placeholder="Enjeux, lieux, personnages…">${_esc(item.description || '')}</textarea><div class="mm-edit-hint"><span>Ctrl + Entrée pour valider</span><span>Échap pour annuler</span></div>`;
  else if (item.description) body = STATE.isAdmin ? `<button class="mm-recit editable" data-mm-action="edit-description">${_esc(item.description)}</button>` : `<div class="mm-recit">${_esc(item.description)}</div>`;
  else body = STATE.isAdmin ? `<button class="mm-empty-action" data-mm-action="edit-description">${icon('pen', 15)} Écrire le récit de la mission…</button>` : `<p class="mm-none">Le récit de cette mission n'a pas encore été écrit.</p>`;
  return `<section class="mm-section"><div class="mm-section-head"><h3>Récit</h3><span class="mm-spacer"></span>${!MM.draft && STATE.isAdmin ? `<button class="mm-link" data-action="_ouvrirHistoire" data-id="${_esc(item.id)}" data-titre="${_esc(item.titre || '')}" data-acte="${_esc(item.acte || '')}">Ouvrir l'histoire →</button>` : ''}</div>${body}</section>`;
}

function participantChip(participant, groupId) {
  const uid = STATE.user?.uid || '';
  const mine = !STATE.isAdmin && participant.uid === uid;
  return `<span class="mm-member${mine ? ' mine' : ''}">${characterAvatarHtml(participant, { size: 24, className: 'mm-avatar', border: 'none' })}<span>${_esc(participant.nom || 'Personnage')}</span>${mine ? '<em>toi</em>' : ''}${STATE.isAdmin ? `<button data-mm-action="member-remove" data-group="${groupId}" data-char="${_esc(participant.charId || '')}" data-uid="${_esc(participant.uid || '')}" aria-label="Retirer">×</button>` : ''}</span>`;
}
function groupHtml(group, missionId) {
  const parts = dedupeQuestParticipants(group.participants || []);
  const status = GROUP_STATUS[group.statut] || GROUP_STATUS.active;
  const success = group.reussite === '' || group.reussite == null ? null : Math.max(0, Math.min(100, Number(group.reussite) || 0));
  if (STATE.isAdmin && MM.confirm === `group:${group.id}`) return `<div class="mm-group-confirm"><span>Supprimer le groupe <b>« ${_esc(group.titre || 'Groupe')} »</b> ?</span><small>Ses séances planifiées seront retirées de l'agenda.</small><div><button class="mm-btn small" data-mm-action="confirm-cancel">Annuler</button><button class="mm-btn small danger" data-mm-action="group-delete-confirm" data-group="${group.id}">Supprimer</button></div></div>`;
  if (STATE.isAdmin) return `<article class="mm-group" style="--outcome:${status.color}">
    <div class="mm-group-top"><input class="mm-group-name ed-in" value="${_esc(group.titre || '')}" data-mm-action="group-commit" data-mm-on="change" data-group="${group.id}" data-field="titre" aria-label="Nom du groupe"><div class="mm-segment">${Object.entries(GROUP_STATUS).map(([key, cfg]) => `<button class="${group.statut === key ? 'on' : ''}" data-mm-action="group-status" data-group="${group.id}" data-value="${key}">${cfg.label}</button>`).join('')}</div><button class="mm-icon danger" data-mm-action="group-delete" data-group="${group.id}" aria-label="Supprimer le groupe">${icon('trash', 15)}</button></div>
    <div class="mm-group-range"><span>Réussite</span><input type="range" min="0" max="100" step="5" value="${success ?? 0}" class="mm-range${success == null ? ' nil' : ''}" style="--value:${success ?? 0}%" data-mm-action="group-range" data-group="${group.id}"><output>${success == null ? '—' : `${success} %`}</output></div>
    <div class="mm-members">${parts.map(p => participantChip(p, group.id)).join('')}<button class="mm-member-add" data-mm-action="menu" data-menu="member" data-group="${group.id}" data-anchor="members-${group.id}">${icon('plus', 13)} Ajouter</button></div>
    <div class="mm-group-fields"><span>Récompense</span><input class="ed-in" value="${_esc(group.recompense || '')}" placeholder="ex. 300 XP + 50 or" data-mm-action="group-commit" data-mm-on="change" data-group="${group.id}" data-field="recompense"><span>Notes</span><textarea class="ed-in" rows="1" placeholder="Une ligne par fait accompli" data-mm-action="group-commit" data-mm-on="change" data-group="${group.id}" data-field="notesReussite">${_esc(group.notesReussite || '')}</textarea></div>
  </article>`;

  const notes = (group.notesReussite || '').split('\n').map(v => v.trim()).filter(Boolean);
  const myChars = getMyCharacters(characters(), STATE.user?.uid || '');
  const myParticipants = parts.filter(p => p.uid === STATE.user?.uid || myChars.some(c => c.id === p.charId));
  const canJoin = group.statut === 'active' && myChars.length;
  let action = '';
  if (canJoin && myParticipants.length) action = `<button class="mm-btn small" data-mm-action="leave" data-group="${group.id}">Quitter le groupe</button>`;
  else if (canJoin && myChars.length === 1) action = `<button class="mm-btn small primary" data-mm-action="join" data-group="${group.id}" data-char="${myChars[0].id}">Rejoindre avec ${_esc(myChars[0].nom)}</button>`;
  else if (canJoin) action = `<button class="mm-btn small primary" data-mm-action="menu" data-menu="join" data-group="${group.id}" data-anchor="join-${group.id}">Rejoindre ${icon('down', 13)}</button>`;
  return `<article class="mm-group" style="--outcome:${status.color}"><div class="mm-group-top"><h4>${_esc(group.titre || 'Groupe')}</h4><span class="mm-badge" style="--c:${status.color}">${status.label}</span>${success != null ? `<b class="mm-group-percent">${success}<small>%</small></b>` : ''}</div>${success != null ? `<div class="mm-group-bar"><i style="width:${success}%"></i></div>` : ''}<div class="mm-members">${parts.length ? parts.map(p => participantChip(p, group.id)).join('') : '<span class="mm-none">Aucun membre.</span>'}</div>${notes.length ? `<ul class="mm-group-notes">${notes.map(note => `<li>${_esc(note)}</li>`).join('')}</ul>` : ''}${group.recompense ? `<div class="mm-group-reward"><span>Récompense</span><b>${_esc(group.recompense)}</b></div>` : ''}${action ? `<div class="mm-group-footer">${action}</div>` : ''}</article>`;
}
function groupsHtml(item) {
  if (MM.draft) return `<div class="mm-locked">🔒 Crée d'abord la mission pour ajouter des groupes et permettre aux joueurs de la rejoindre.</div>`;
  const groups = groupsOf(item.id);
  const mixed = groups.length > 1 && new Set(groups.map(g => g.statut)).size > 1;
  return `<section class="mm-section"><div class="mm-section-head"><h3>Groupes</h3><span class="mm-count">${groups.length}</span>${mixed ? '<span class="mm-warn">⚠ Issues différentes</span>' : ''}<span class="mm-spacer"></span>${STATE.isAdmin && groups.length ? `<button class="mm-btn small" data-mm-action="group-new">${icon('plus', 13)} Nouveau groupe</button>` : ''}</div>${groups.length ? `<div class="mm-groups">${groups.map(group => groupHtml(group, item.id)).join('')}</div>` : STATE.isAdmin ? `<button class="mm-empty-action" data-mm-action="group-new">${icon('plus', 15)} Créer un premier groupe — les joueurs pourront le rejoindre</button>` : '<p class="mm-none">Aucun groupe ouvert pour cette mission.</p>'}</section>`;
}
function achievementsHtml(item) {
  if (MM.draft) return '';
  const list = achievements().filter(entry => entry.missionId === item.id);
  if (!list.length && !STATE.isAdmin) return '';
  return `<section class="mm-section"><div class="mm-section-head"><h3>Hauts-faits</h3><span class="mm-count">${list.length}</span><span class="mm-spacer"></span>${list.length ? `<button class="mm-link" data-action="_stMissionAchievements" data-id="${item.id}">Galerie →</button>` : ''}${STATE.isAdmin ? `<button class="mm-btn small" data-action="_stCreateMissionAchievement" data-id="${item.id}">${icon('plus', 13)} Haut-fait</button>` : ''}</div>${list.length ? `<div class="mm-achievements">${list.map(entry => `<button class="mm-achievement" data-action="_stOpenAch" data-id="${entry.id}"><span>${entry.imageUrl ? `<img src="${_esc(entry.imageUrl)}" alt="">` : _esc(entry.emoji || '🏆')}</span><span><b>${_esc(entry.titre || 'Haut-fait')}</b><small>${_esc(entry.description || '')}</small></span></button>`).join('')}</div>` : '<p class="mm-none">Aucun haut-fait lié à cette mission.</p>'}</section>`;
}

function progressHtml(item) {
  const progress = progressOf(item);
  const groups = groupsOf(item.id);
  const people = new Set(groups.flatMap(g => dedupeQuestParticipants(g.participants || []).map(p => p.charId || p.uid))).size;
  const status = statusConfig(item);
  return `<section class="mm-side-card"><div class="mm-progress-summary"><div class="mm-ring"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="24"/><circle class="value" cx="28" cy="28" r="24" style="stroke:${status.color};stroke-dasharray:${(progress.value * 1.508).toFixed(1)} 151"/></svg><b>${progress.value}<small>%</small></b></div><div><strong>${progress.count ? `Moyenne de ${progress.count} ${plural(progress.count, 'groupe')}` : 'Avancement'}</strong><span>${groups.length} ${plural(groups.length, 'groupe')} · ${people} ${plural(people, 'personnage')}</span>${!MM.draft ? `<button class="mm-link" data-action="_stMissionStats" data-id="${item.id}">Statistiques →</button>` : ''}</div></div>${STATE.isAdmin ? `<div class="mm-status-grid">${Object.entries(STATUS).map(([name, cfg]) => `<button class="${item.statut === name ? 'on' : ''}" style="--c:${cfg.color}" data-mm-action="status" data-value="${name}"><i>${cfg.icon}</i>${name}</button>`).join('')}</div>` : ''}</section>`;
}
function propertyRow(label, content) { return `<div class="mm-property"><span>${label}</span>${content}</div>`; }
function propertiesHtml(item) {
  const editable = STATE.isAdmin;
  const valueButton = (menu, value, placeholder) => editable ? `<button class="mm-property-value" data-mm-action="menu" data-menu="${menu}" data-anchor="prop-${menu}"><span>${value || `<em>${placeholder}</em>`}</span>${icon('down', 14)}</button>` : `<span class="mm-property-value"><span>${value}</span></span>`;
  return `<section class="mm-side-card"><div class="mm-side-title">Repères</div><div class="mm-properties">
    ${editable ? propertyRow('Type', `<div class="mm-segment"><button class="${item.type !== 'event' ? 'on' : ''}" data-mm-action="type" data-value="mission">Mission</button><button class="${item.type === 'event' ? 'on' : ''}" data-mm-action="type" data-value="event">Événement</button></div>`) : ''}
    ${propertyRow('Axe', valueButton('axis', item.axe ? `<i class="mm-dot" style="background:${axisColor(item.axe)}"></i>${_esc(item.axe)}` : '', 'Aucun axe'))}
    ${propertyRow('Acte', valueButton('act', _esc(item.acte || 'Acte I'), 'Acte I'))}
    ${editable ? propertyRow('Ordre', `<div class="mm-step"><button data-mm-action="order" data-delta="-1">−</button><b>${Number(item.ordre) || 0}</b><button data-mm-action="order" data-delta="1">+</button></div>`) : ''}
    ${propertyRow('Date', editable ? `<input class="ed-in" value="${_esc(item.date || '')}" placeholder="Session, date…" data-mm-action="commit" data-mm-on="change" data-field="date">` : `<span class="mm-property-value"><span>${_esc(item.date || '—')}</span></span>`)}
    ${propertyRow('Lieu', editable ? `<input class="ed-in" value="${_esc(item.lieu || '')}" placeholder="Où ça se passe" data-mm-action="commit" data-mm-on="change" data-field="lieu">` : `<span class="mm-property-value"><span>${_esc(item.lieu || '—')}</span></span>`)}
    ${editable ? propertyRow('Visibilité', `<button class="mm-switch-wrap" data-mm-action="visibility"><span class="mm-switch${item.visibleJoueurs !== false ? ' on' : ''}"><i></i></span>${item.visibleJoueurs !== false ? 'Joueurs' : 'MJ seulement'}</button>`) : ''}
  </div></section>`;
}
function linkRow(link, removable = false) {
  const cfg = statusConfig(link);
  return `<div class="mm-link-row"><button data-mm-action="open-link" data-id="${link.id}"><span class="mm-link-thumb" style="--axis:${axisColor(link.axe)}">${_esc(initials(link.titre))}</span><span><b>${_esc(link.titre || 'Mission')}</b><small><i class="mm-dot" style="background:${cfg.color}"></i>${_esc(link.statut || 'En attente')}${link.axe ? ` · ${_esc(link.axe)}` : ''}</small></span></button>${removable ? `<button class="remove" data-mm-action="unlink" data-id="${link.id}" aria-label="Retirer ce lien">×</button>` : ''}</div>`;
}
function linksHtml(item) {
  if (MM.draft) return '';
  const visible = visibleStories();
  const from = visible.filter(entry => (entry.liens || []).includes(item.id));
  const to = (item.liens || []).map(id => visible.find(entry => entry.id === id)).filter(Boolean);
  if (!STATE.isAdmin && !from.length && !to.length) return '';
  return `<section class="mm-side-card"><div class="mm-side-title">Enchaînements</div>${from.length ? `<div class="mm-link-label">Découle de</div>${from.map(link => linkRow(link)).join('')}` : ''}<div class="mm-link-label">Mène à</div>${to.map(link => linkRow(link, STATE.isAdmin)).join('')}${!to.length ? '<span class="mm-none">Aucune suite liée.</span>' : ''}${STATE.isAdmin ? `<button class="mm-member-add" data-mm-action="menu" data-menu="link" data-anchor="link">${icon('plus', 13)} Lier une suite</button>` : ''}</section>`;
}
function sessionsHtml(item) {
  if (MM.draft) return '';
  const ids = new Set(groupsOf(item.id).map(g => g.id));
  const sessions = (Array.isArray(MM.agenda?.sessions) ? MM.agenda.sessions : (MM.agenda?.date ? [MM.agenda] : []))
    .filter(session => ids.has(session.questId)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!sessions.length && !STATE.isAdmin) return '';
  return `<section class="mm-side-card"><div class="mm-side-title">Séances <span class="mm-spacer"></span><button class="mm-link" data-action="_stGoAgenda">Agenda →</button></div>${sessions.length ? sessions.slice(0, 3).map(session => { const date = new Date(`${session.date}T12:00:00`); return `<div class="mm-session"><span><b>${String(date.getDate()).padStart(2, '0')}</b><small>${date.toLocaleDateString('fr-FR', { month: 'short' })}</small></span><span><b>${_esc(groupById(session.questId)?.titre || 'Groupe')}</b><small>${_esc(session.slot || 'Créneau planifié')}</small></span></div>`; }).join('') : '<span class="mm-none">Aucune séance planifiée.</span>'}</section>`;
}
function dangerHtml(item) {
  if (!STATE.isAdmin || MM.draft) return '';
  if (MM.confirm === 'mission') return `<section class="mm-side-card mm-delete-confirm"><b>Supprimer cette mission ?</b><small>Les groupes liés ne seront pas supprimés automatiquement.</small><div><button class="mm-btn small" data-mm-action="confirm-cancel">Annuler</button><button class="mm-btn small danger" data-mm-action="mission-delete-confirm">Supprimer</button></div></section>`;
  return `<div class="mm-danger"><button data-mm-action="mission-delete">${icon('trash', 13)} Supprimer la mission</button></div>`;
}
function sheetHtml(item) {
  return `<div class="mm" style="--axis:${axisColor(item.axe)}">${headerHtml(item)}<div class="mm-body"><main class="mm-main">${descriptionHtml(item)}${groupsHtml(item)}${achievementsHtml(item)}</main><aside class="mm-side">${progressHtml(item)}${propertiesHtml(item)}${linksHtml(item)}${sessionsHtml(item)}${dangerHtml(item)}</aside></div><div class="mm-pop-layer" aria-live="polite"></div></div>`;
}

function menuOptionsHtml() {
  const item = current();
  const query = norm(MM.query);
  if (!MM.menu) return '';
  const search = `<label class="mm-pop-search">${icon('search', 14)}<input value="${_esc(MM.query)}" placeholder="Rechercher…" data-mm-action="menu-search" data-mm-on="input"></label>`;
  if (MM.menu.type === 'axis') {
    const axes = knownAxes().filter(axis => norm(axis).includes(query));
    return `<div class="mm-pop"><div class="mm-pop-title">Choisir un axe</div>${search}<div class="mm-pop-list"><button data-mm-action="axis-select" data-value="" class="mm-pop-option"><span>Aucun axe</span></button>${axes.map(axis => `<button data-mm-action="axis-select" data-value="${_esc(axis)}" class="mm-pop-option"><i class="mm-dot" style="background:${axisColor(axis)}"></i><span>${_esc(axis)}</span>${item.axe === axis ? icon('check', 14) : ''}</button>`).join('')}${MM.query.trim() && !knownAxes().some(axis => norm(axis) === query) ? `<button data-mm-action="axis-select" data-value="${_esc(MM.query.trim())}" class="mm-pop-option new">${icon('plus', 13)}<span>Créer « ${_esc(MM.query.trim())} »</span></button>` : ''}</div></div>`;
  }
  if (MM.menu.type === 'act') {
    const acts = MM.acts.filter(act => norm(act).includes(query));
    return `<div class="mm-pop"><div class="mm-pop-title">Choisir un acte</div>${search}<div class="mm-pop-list">${acts.map(act => `<button data-mm-action="act-select" data-value="${_esc(act)}" class="mm-pop-option"><span>${_esc(act)}</span>${item.acte === act ? icon('check', 14) : ''}</button>`).join('')}${MM.query.trim() && !MM.acts.some(act => norm(act) === query) ? `<button data-mm-action="act-select" data-value="${_esc(MM.query.trim())}" class="mm-pop-option new">${icon('plus', 13)}<span>Créer « ${_esc(MM.query.trim())} »</span></button>` : ''}</div></div>`;
  }
  if (MM.menu.type === 'link') {
    const linked = new Set(item.liens || []);
    const list = visibleStories().filter(entry => entry.id !== item.id && norm(entry.titre).includes(query));
    return `<div class="mm-pop"><div class="mm-pop-title">Lier une mission</div>${search}<div class="mm-pop-list">${list.map(entry => `<button data-mm-action="link-toggle" data-id="${entry.id}" class="mm-pop-option"><span class="mm-check${linked.has(entry.id) ? ' on' : ''}">${linked.has(entry.id) ? icon('check', 12) : ''}</span><span><b>${_esc(entry.titre)}</b><small>${_esc(entry.acte || '')}${entry.axe ? ` · ${_esc(entry.axe)}` : ''}</small></span></button>`).join('') || '<div class="mm-pop-empty">Aucune mission trouvée.</div>'}</div></div>`;
  }
  const group = groupById(MM.menu.groupId);
  const participants = dedupeQuestParticipants(group?.participants || []);
  const present = new Set(participants.map(p => p.charId).filter(Boolean));
  const list = (MM.menu.type === 'join' ? getMyCharacters(characters(), STATE.user?.uid || '') : characters())
    .filter(char => !present.has(char.id) && norm(`${char.nom || ''} ${char.classe || ''}`).includes(query));
  return `<div class="mm-pop"><div class="mm-pop-title">${MM.menu.type === 'join' ? 'Rejoindre avec…' : 'Ajouter un personnage'}</div>${search}<div class="mm-pop-list">${list.map(char => `<button data-mm-action="${MM.menu.type === 'join' ? 'join' : 'member-add'}" data-group="${group?.id || ''}" data-char="${char.id}" class="mm-pop-option">${characterAvatarHtml(char, { size: 28, className: 'mm-avatar', border: 'none' })}<span><b>${_esc(char.nom || 'Personnage')}</b><small>${_esc([char.classe, char.race].filter(Boolean).join(' · '))}</small></span></button>`).join('') || '<div class="mm-pop-empty">Aucun personnage disponible.</div>'}</div></div>`;
}
function paintMenu() {
  const layer = document.querySelector('.mm-pop-layer');
  if (!layer) return;
  layer.innerHTML = menuOptionsHtml();
  layer.classList.toggle('open', !!MM.menu);
  if (MM.menu) requestAnimationFrame(() => layer.querySelector('input')?.focus());
}

async function saveField(field, value, { rerender = true } = {}) {
  const item = current();
  if (!item || !STATE.isAdmin) return;
  item[field] = value;
  if (MM.draft) { if (rerender) render(); return; }
  saving();
  try {
    await updateInCol('story', item.id, { [field]: value });
    if (rerender) render();
  } catch (error) { notifySaveError(error); }
}
async function syncParticipants(missionId) {
  const participants = storyParticipantsFromGroups(groupsOf(missionId).map(group => ({
    membres: dedupeQuestParticipants(group.participants || []).map(p => p.charId).filter(Boolean),
  })), characters());
  await updateInCol('story', missionId, { participants });
  if (current()?.id === missionId) current().participants = participants;
}
async function saveGroup(groupId, patch, { members = false } = {}) {
  saving();
  await updateInCol('quests', groupId, patch);
  if (members) await syncParticipants(current().id);
  render();
}
function closeMenu() { MM.menu = null; MM.query = ''; paintMenu(); }

Object.assign(handlers, {
  close: () => closeModalDirect(),
  nav: el => navigateMission(Number(el.dataset.delta) || 1),
  back: () => { const id = MM.stack.pop(); if (id) selectMission(id); },
  commit: el => saveField(el.dataset.field, el.value.trim()),
  description: el => { MM.editDescription = false; return saveField('description', el.value, { rerender: true }); },
  'edit-description': () => { MM.editDescription = true; render({ focus: '.mm-recit-input' }); },
  status: el => saveField('statut', el.dataset.value),
  type: el => saveField('type', el.dataset.value),
  visibility: () => saveField('visibleJoueurs', current().visibleJoueurs === false),
  order: el => saveField('ordre', Math.max(0, (Number(current().ordre) || 0) + (Number(el.dataset.delta) || 0))),
  menu: el => { MM.menu = { type: el.dataset.menu, groupId: el.dataset.group || '', anchor: el.dataset.anchor || '' }; MM.query = ''; paintMenu(); },
  'menu-search': el => { MM.query = el.value; paintMenu(); },
  'axis-select': el => { closeMenu(); return saveField('axe', el.dataset.value || ''); },
  'act-select': async el => {
    const value = el.dataset.value || 'Acte I'; closeMenu();
    if (!MM.acts.includes(value)) { MM.acts.push(value); MM.acts.sort((a, b) => a.localeCompare(b, 'fr')); await saveDoc('story_meta', 'actes', { list: MM.acts }); }
    return saveField('acte', value);
  },
  'link-toggle': async el => {
    const set = new Set(current().liens || []);
    set.has(el.dataset.id) ? set.delete(el.dataset.id) : set.add(el.dataset.id);
    await saveField('liens', [...set], { rerender: false }); paintMenu();
  },
  unlink: el => saveField('liens', (current().liens || []).filter(id => id !== el.dataset.id)),
  'open-link': el => { MM.stack.push(current().id); selectMission(el.dataset.id); },
  'group-new': async () => {
    const id = await addToCol('quests', { missionId: current().id, titre: 'Nouveau groupe', statut: 'active', reussite: null, participants: [], participantsRequis: 0, difficulte: 'moyen', recompense: '', notesReussite: '' });
    showNotif('Groupe créé.', 'success'); render({ focus: `.mm-group [data-group="${id}"][data-field="titre"]` });
  },
  'group-status': el => saveGroup(el.dataset.group, { statut: el.dataset.value }),
  'group-commit': el => saveGroup(el.dataset.group, { [el.dataset.field]: el.value }),
  'group-range': (el, event) => {
    el.style.setProperty('--value', `${el.value}%`); el.classList.remove('nil');
    const output = el.parentElement?.querySelector('output'); if (output) output.textContent = `${el.value} %`;
    if (event.type === 'change') return saveGroup(el.dataset.group, { reussite: Number(el.value) });
  },
  'member-add': async el => {
    const group = groupById(el.dataset.group); const char = characters().find(c => c.id === el.dataset.char);
    if (!group || !char) return;
    const next = [...dedupeQuestParticipants(group.participants || []), questParticipantFromChar(char)];
    await saveGroup(group.id, { participants: dedupeQuestParticipants(next) }, { members: true });
    MM.menu = { type: 'member', groupId: group.id, anchor: `members-${group.id}` }; paintMenu();
  },
  'member-remove': async el => {
    const group = groupById(el.dataset.group); if (!group) return;
    const next = dedupeQuestParticipants(group.participants || []).filter(p => !(el.dataset.char && p.charId === el.dataset.char) && !(el.dataset.uid && p.uid === el.dataset.uid && !el.dataset.char));
    await saveGroup(group.id, { participants: next }, { members: true });
  },
  join: async el => {
    const group = groupById(el.dataset.group); const char = characters().find(c => c.id === el.dataset.char);
    if (!group || !char) return;
    closeMenu();
    await saveGroup(group.id, { participants: dedupeQuestParticipants([...(group.participants || []), questParticipantFromChar(char)]) }, { members: true });
  },
  leave: async el => {
    const group = groupById(el.dataset.group); if (!group) return;
    const myIds = new Set(getMyCharacters(characters(), STATE.user?.uid || '').map(c => c.id));
    const next = dedupeQuestParticipants(group.participants || []).filter(p => p.uid !== STATE.user?.uid && !myIds.has(p.charId));
    await saveGroup(group.id, { participants: next }, { members: true });
  },
  'group-delete': el => { MM.confirm = `group:${el.dataset.group}`; render(); },
  'confirm-cancel': () => { MM.confirm = ''; render(); },
  'group-delete-confirm': async el => {
    const id = el.dataset.group;
    await deleteFromCol('quests', id);
    const cleaned = removeQuestAgendaSessions(MM.agenda, id);
    if (cleaned.removed) { MM.agenda = { ...(MM.agenda || {}), sessions: cleaned.sessions }; await saveDoc('agenda_session', 'next', { sessions: cleaned.sessions }); }
    await syncParticipants(current().id); MM.confirm = ''; showNotif('Groupe supprimé.', 'success'); render();
  },
  'mission-delete': () => { MM.confirm = 'mission'; render(); },
  'mission-delete-confirm': async () => {
    const id = current().id; await deleteFromCol('story', id); clearModalCloseGuard(); closeModalDirect(); showNotif('Mission supprimée.', 'success'); MM.onDeleted?.();
  },
  image: () => openImageEditor(),
  create: () => createDraft(),
  discard: () => { clearModalCloseGuard(); closeModalDirect(); },
});

function selectMission(id) {
  const item = storyById(id); if (!item) return;
  MM.id = id; MM.item = { ...item, liens: [...(item.liens || [])] }; MM.draft = false; MM.menu = null; MM.editDescription = false; MM.confirm = ''; MM.save = 'idle'; render({ resetScroll: true });
}
function navigateMission(delta) {
  const list = navList(current()); if (list.length < 2) return;
  const index = list.findIndex(item => item.id === current().id);
  selectMission(list[(index + delta + list.length) % list.length].id);
}
async function createDraft() {
  const item = current();
  if (!item.titre?.trim()) { showNotif('Le titre est requis.', 'error'); return; }
  try {
    const { id: _draftId, ...payload } = item;
    const id = await addToCol('story', { ...payload, titre: item.titre.trim() });
    MM.id = id; MM.item = { ...item, id, titre: item.titre.trim() }; MM.draft = false; MM.confirm = ''; clearModalCloseGuard(); showNotif(`« ${item.titre.trim()} » ajoutée !`, 'success'); render({ resetScroll: true });
  } catch (error) { notifySaveError(error); }
}

function openImageEditor() {
  let cropper = null;
  pushModal('Image de la mission', `<div class="mm-crop"><div class="mm-crop-drop" id="mm-crop-drop"><div id="mm-crop-preview"></div></div><div id="mm-crop-wrap" style="display:none"><canvas id="mm-crop-canvas"></canvas></div><p id="mm-crop-status"></p><div class="mm-crop-actions"><button class="mm-btn" id="mm-crop-clear">Retirer</button><span></span><button class="mm-btn" data-action="popModal">Annuler</button><button class="mm-btn primary" id="mm-crop-confirm">Enregistrer</button></div></div>`, () => render());
  const confirm = document.getElementById('mm-crop-confirm');
  cropper = attachDropAndCrop({
    dropEl: document.getElementById('mm-crop-drop'), previewEl: document.getElementById('mm-crop-preview'), cropWrapEl: document.getElementById('mm-crop-wrap'), canvasId: 'mm-crop-canvas', statusEl: document.getElementById('mm-crop-status'), confirmBtnEl: confirm, clearBtnEl: document.getElementById('mm-crop-clear'), initialUrl: current().imageUrl || '', ratio: { w: 4, h: 3 }, output: { maxW: 1200, target: 700_000 },
  });
  document.querySelector('.mm-crop [data-action="popModal"]')?.addEventListener('click', () => popModal());
  confirm?.addEventListener('click', async () => {
    const result = cropper?.getResult();
    if (result === undefined) { popModal(); return; }
    await saveField('imageUrl', result || '', { rerender: false }); popModal(); setTimeout(() => render(), 0);
  });
}

function installKeyboard() {
  const root = document.querySelector('.mm');
  if (!root || root.dataset.keysBound) return;
  root.dataset.keysBound = 'true';
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && MM.menu) { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
    if (event.key === 'Escape' && MM.editDescription) { event.preventDefault(); event.stopPropagation(); MM.editDescription = false; render(); return; }
    if (event.key === 'Enter' && event.ctrlKey && event.target.matches('.mm-recit-input')) { event.preventDefault(); event.target.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.target.matches('input, textarea, select')) navigateMission(event.key === 'ArrowLeft' ? -1 : 1);
  }, true);
}

export async function openMissionSheet(id = null, { onDeleted = null } = {}) {
  const token = ++MM.openToken;
  await ensureData();
  if (token !== MM.openToken) return;
  MM.onDeleted = onDeleted;
  MM.stack = []; MM.menu = null; MM.query = ''; MM.editDescription = false; MM.confirm = ''; MM.save = 'idle';
  if (id) {
    const item = storyById(id); if (!item) { showNotif('Mission introuvable.', 'error'); return; }
    MM.id = id; MM.item = { ...item, liens: [...(item.liens || [])] }; MM.draft = false;
  } else {
    const activeAct = MM.acts.includes('Acte I') ? 'Acte I' : (MM.acts[0] || 'Acte I');
    const maxOrder = Math.max(0, ...stories().filter(item => item.acte === activeAct).map(item => Number(item.ordre) || 0));
    MM.id = null; MM.draft = true; MM.item = { id: '', type: 'mission', titre: '', acte: activeAct, axe: '', date: '', lieu: '', description: '', imageUrl: '', statut: 'En cours', visibleJoueurs: true, liens: [], ordre: maxOrder + 1, participants: [] };
  }
  openModal('', '<div id="mission-modal-host"></div>');
  if (MM.draft) setModalCloseGuard(() => { MM.confirm = 'draft'; render(); return true; });
  else clearModalCloseGuard();
  render({ resetScroll: true, focus: MM.draft ? '.mm-title' : '' });
}
