// AVENTURES — hub de campagnes, invitations et configuration.

import { STATE, setAdventures } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { navigate } from '../core/navigation.js';
import { openModal, closeModal, confirmModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { avatarSrcOf, resolveAvatarUrl } from '../shared/avatar.js';
import { getDefaultCharForUser } from '../shared/char-stats.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import {
  createAdventure, updateAdventureMeta, deleteAdventure,
  removePlayerFromAdventure, removeSelfFromAdventure, loadMyCharacters,
  promoteToAdmin, relinkPlayerAccount, setAdventureFeatures,
  inviteByEmail, cancelInvite, loadAllUsers, loadUserAdventures,
  loadUserInvitations, acceptInvitation, declineInvitation, selectAdventure,
} from '../core/adventure.js';
import { exportAdventure, getCachedCollection, importAdventure } from '../data/firestore.js';
import { unwatchAll, watchPageDoc } from '../shared/realtime.js';
import { agendaSessionsFromDoc, isAgendaSessionUpcoming } from '../shared/agenda-sessions.js';
import {
  TOGGLEABLE_FEATURES, enabledFeaturesOf, isPremiumFeature, isFeatureAllowedByPlan,
} from '../shared/features.js';
import { hasAdventurePremiumAccess, hasPremiumAccess } from '../shared/premium.js';

const COLORS = ['#4f8cff', '#22c38e', '#a970ff', '#ff9544', '#ff5a7e', '#f4c430', '#62c6e8', '#9ca3af'];
const FALLBACK_COLOR = '#4f8cff';
const ARTICLES = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'd', 'l', 'au', 'aux']);
const MANAGE_TABS = [
  ['presentation', 'Présentation'],
  ['members', 'Membres'],
  ['pages', 'Pages'],
  ['backup', 'Sauvegarde'],
  ['danger', 'Zone sensible'],
];

const _hub = {
  filter: 'all',
  query: '',
  sort: 'recent',
  selectedId: '',
  detailClosed: false,
  leaveId: '',
  invitations: null,
  invitationsPromise: null,
  agendaAdventureId: '',
  agendaSession: undefined,
};

const _manage = {
  id: '',
  tab: 'presentation',
  usersByAdventure: new Map(),
};

const _email = () => STATE.profile?.email || STATE.user?.email || '';
const _isAdventureAdmin = adv => !!adv?.admins?.includes(STATE.user?.uid);
const _canManage = adv => !!(STATE.isSuperAdmin || _isAdventureAdmin(adv));
const _isArchived = adv => adv?.status === 'archived';

function _role(adv) {
  const uid = STATE.user?.uid;
  if (adv?.createdBy === uid) return 'Créateur';
  return adv?.admins?.includes(uid) ? 'MJ' : 'Joueur';
}

function _members(adv) {
  return [...new Set([
    ...(adv?.admins || []),
    ...(adv?.players || []),
    ...(adv?.accessList || []),
  ].filter(Boolean))];
}

function _profileOf(adv, uid) {
  const profile = adv?.memberProfiles?.[uid];
  const normalized = typeof profile === 'string' ? { pseudo: profile } : (profile || {});
  if (uid !== STATE.user?.uid || normalized.avatarIcon) return normalized;
  return { ...normalized, avatarIcon: STATE.profile?.avatarIcon || '' };
}

function _nameOf(adv, uid) {
  const profile = _profileOf(adv, uid);
  return profile.pseudo || profile.displayName || profile.name || profile.email || ('Joueur ' + String(uid || '').slice(0, 6));
}

function _characterOf(adv, uid) {
  const profile = _profileOf(adv, uid);
  const denorm = profile.character || profile.personnage || profile.characterName || profile.personnageNom;
  const cachedCharacters = getCachedCollection('characters') || STATE.characters || [];
  const local = adv?.id === STATE.adventure?.id
    ? getDefaultCharForUser(cachedCharacters, uid)
    : null;
  const char = local || (typeof denorm === 'object' ? denorm : null);
  if (char) {
    return {
      name: char.nom || char.name || 'Personnage',
      detail: [char.classe || char.class, char.niveau || char.level ? 'niv. ' + (char.niveau || char.level) : ''].filter(Boolean).join(' · '),
      photo: char.photo || char.portrait || char.portraitUrl || char.imageUrl || '',
      photoX: char.photoX,
      photoY: char.photoY,
    };
  }
  return denorm ? { name: String(denorm), detail: '' } : null;
}

function _characterAvatar(char) {
  return characterAvatarHtml({ ...char, nom: char?.name }, {
    size: 30,
    className: 'av-character-avatar',
    border: '1px solid rgba(139, 164, 196, .28)',
    background: '#17263a',
  });
}

function _monogram(name) {
  const words = String(name || '').trim().split(/[\s'’\-]+/).filter(Boolean);
  const significant = words.filter(word => !ARTICLES.has(word.toLocaleLowerCase('fr-FR')));
  const selected = (significant.length ? significant : words).slice(0, 2);
  return selected.map(word => word.charAt(0).toLocaleUpperCase('fr-FR')).join('') || '?';
}

function _hashColor(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length] || FALLBACK_COLOR;
}

function _colorOf(adv) {
  return adv?.color || _hashColor(adv?.id || adv?.nom);
}

function _toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'object') return _toDate(value.date || value.at || value.start || value.startsAt || value.datetime);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return new Date(String(value) + 'T12:00:00');
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function _todayIso() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function _agendaSessionFor(adv) {
  if (!adv?.id || adv.id !== STATE.adventure?.id || _hub.agendaAdventureId !== adv.id) return null;
  const uid = STATE.user?.uid;
  return agendaSessionsFromDoc(_hub.agendaSession)
    .filter(session => STATE.isAdmin || !Array.isArray(session?.participantUids) || !session.participantUids.length || session.participantUids.includes(uid))
    .filter(session => isAgendaSessionUpcoming(session, _todayIso()))
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')) || String(a?.slot || '').localeCompare(String(b?.slot || '')))[0] || null;
}

function _nextSession(adv) {
  const agendaSession = _agendaSessionFor(adv);
  const raw = agendaSession || adv?.nextSession || adv?.nextSessionAt || adv?.prochaineSession || null;
  const source = raw && typeof raw === 'object' ? raw : {};
  const slotLabel = { m: 'Matin', a: 'Après-midi', s: 'Soir' }[source.slot] || source.timeLabel || '';
  return {
    date: _toDate(raw),
    title: source.title || source.nom || source.label || source.questTitle || '',
    slotLabel,
  };
}

function _watchAgendaSession() {
  const adventureId = STATE.adventure?.id || '';
  if (!adventureId) return;
  if (_hub.agendaAdventureId !== adventureId) {
    _hub.agendaAdventureId = adventureId;
    _hub.agendaSession = undefined;
  }
  watchPageDoc('adventures-agenda-session', 'agenda_session', 'next', 'aventures', data => {
    if (STATE.adventure?.id !== adventureId || _hub.agendaSession === data) return;
    _hub.agendaSession = data;
    renderAventuresPage();
  });
}

function _dateLabel(date, withTime = false) {
  if (!date) return 'Non planifiée';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return new Intl.DateTimeFormat('fr-FR', opts).format(date).replace(',', ' ·');
}

function _relativeDay(date) {
  if (!date) return '';
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  if (days > 1) return 'Dans ' + days + ' j';
  return 'Il y a ' + Math.abs(days) + ' j';
}

function _lastActivity(adv) {
  const date = _toDate(adv?.lastActivityAt || adv?.updatedAt || adv?.createdAt);
  if (!date) return 'Activité non renseignée';
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return 'Dernière activité aujourd’hui';
  if (days === 1) return 'Dernière activité hier';
  return 'Dernière activité il y a ' + days + ' j';
}

function _pendingEmails(adv) {
  const byLower = new Map();
  (adv?.invitedEmails || []).forEach(email => {
    const key = String(email).toLocaleLowerCase();
    if (!byLower.has(key) || email !== key) byLower.set(key, email);
  });
  return [...byLower.values()];
}

function _avatar(adv, uid, compact = false) {
  const profile = _profileOf(adv, uid);
  const name = _nameOf(adv, uid);
  const legacyImage = profile.photoURL || profile.photo || profile.avatar || profile.image || '';
  const image = profile.avatarIcon ? avatarSrcOf(profile) : resolveAvatarUrl(legacyImage);
  const content = image
    ? '<img src="' + _esc(image) + '" alt="">'
    : _esc(name.trim().charAt(0).toLocaleUpperCase('fr-FR') || '?');
  return '<span class="av-avatar' + (compact ? ' is-compact' : '') + '" title="' + _esc(name) + '" style="--avatar-color:' + _hashColor(uid) + '">' + content + '</span>';
}

function _avatarStack(adv, limit = 4) {
  const members = _members(adv);
  const shown = members.slice(0, limit).map(uid => _avatar(adv, uid, true)).join('');
  const remaining = members.length - limit;
  return '<span class="av-avatar-stack">' + shown + (remaining > 0 ? '<span class="av-avatar-more">+' + remaining + '</span>' : '') + '</span>';
}

function _emblem(adv, className = '') {
  return '<span class="av-emblem ' + className + '" style="--adventure-color:' + _esc(_colorOf(adv)) + '">' + _esc(_monogram(adv?.nom)) + '</span>';
}

function _colorButtons(targetId, selected) {
  return '<div class="av-color-row">' + COLORS.map(color =>
    '<button type="button" class="av-color' + (color === selected ? ' is-selected' : '') + '" style="--swatch:' + color + '" aria-label="Couleur ' + color + '" data-action="_advPickColor" data-color="' + color + '" data-target-id="' + targetId + '"></button>'
  ).join('') + '<input id="' + targetId + '" type="hidden" value="' + _esc(selected) + '"></div>';
}

async function _refreshAdventures() {
  const adventures = await loadUserAdventures(STATE.user.uid, { email: _email() });
  setAdventures(adventures);
  return adventures;
}

async function _ensureInvitations() {
  if (_hub.invitations) return _hub.invitations;
  if (!_hub.invitationsPromise) {
    _hub.invitationsPromise = loadUserInvitations(_email())
      .then(items => {
        _hub.invitations = items;
        return items;
      })
      .catch(() => {
        _hub.invitations = [];
        return [];
      })
      .finally(() => { _hub.invitationsPromise = null; });
  }
  return _hub.invitationsPromise;
}

function _counts(adventures) {
  const live = adventures.filter(adv => !_isArchived(adv));
  return {
    all: live.length,
    gm: live.filter(_isAdventureAdmin).length,
    player: live.filter(adv => !_isAdventureAdmin(adv)).length,
    archived: adventures.filter(_isArchived).length,
  };
}

function _matchesSearch(adv, query) {
  if (!query) return true;
  const members = _members(adv).flatMap(uid => {
    const char = _characterOf(adv, uid);
    return [_nameOf(adv, uid), char?.name || '', char?.detail || ''];
  });
  return [adv.nom, adv.description, ...members].join(' ').toLocaleLowerCase('fr-FR').includes(query);
}

function _visibleAdventures(adventures) {
  const query = _hub.query.trim().toLocaleLowerCase('fr-FR');
  const filtered = adventures.filter(adv => {
    if (_hub.filter === 'archived' && !_isArchived(adv)) return false;
    if (_hub.filter !== 'archived' && _isArchived(adv)) return false;
    if (_hub.filter === 'gm' && !_isAdventureAdmin(adv)) return false;
    if (_hub.filter === 'player' && _isAdventureAdmin(adv)) return false;
    return _matchesSearch(adv, query);
  });
  const activeId = STATE.adventure?.id;
  return filtered.sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    if (_hub.sort === 'name') return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr');
    if (_hub.sort === 'next') {
      const ad = _nextSession(a).date?.getTime() || Number.MAX_SAFE_INTEGER;
      const bd = _nextSession(b).date?.getTime() || Number.MAX_SAFE_INTEGER;
      return ad - bd;
    }
    const ad = _toDate(a.lastActivityAt || a.updatedAt || a.createdAt)?.getTime() || 0;
    const bd = _toDate(b.lastActivityAt || b.updatedAt || b.createdAt)?.getTime() || 0;
    return bd - ad;
  });
}

function _renderInvitations() {
  const invitations = _hub.invitations || [];
  if (!invitations.length) return '';
  return '<section class="av-invitations" aria-label="Invitations en attente">' +
    '<div class="av-inv-title"><span>Invitation en attente</span><b>' + invitations.length + '</b></div>' +
    invitations.map(adv => {
      const members = _members(adv).length;
      return '<article class="av-invite">' +
        _emblem(adv, 'is-small') +
        '<div class="av-invite-copy"><strong>' + _esc(adv.nom || 'Aventure sans nom') + '</strong><span>' +
          _esc((adv.invitedByName || 'Un MJ') + ' t’invite · ' + members + ' membre' + (members > 1 ? 's' : '')) +
          (adv.description ? ' · ' + _esc(adv.description) : '') +
        '</span></div>' +
        '<div class="av-invite-actions">' +
          '<button class="av-btn is-quiet" data-action="_advDeclineInvitation" data-id="' + adv.id + '">Refuser</button>' +
          '<button class="av-btn is-primary" data-action="_advAcceptInvitation" data-id="' + adv.id + '">Rejoindre</button>' +
        '</div>' +
      '</article>';
    }).join('') +
  '</section>';
}

function _renderFilters(counts) {
  const filters = [
    ['all', 'Toutes', counts.all],
    ['gm', 'MJ', counts.gm],
    ['player', 'Joueur', counts.player],
    ['archived', 'Archivées', counts.archived],
  ];
  return '<div class="av-tools">' +
    '<div class="av-segments" role="group" aria-label="Filtrer les aventures">' +
      filters.map(([key, label, count]) =>
        '<button class="' + (_hub.filter === key ? 'is-active' : '') + '" data-action="_advFilter" data-filter="' + key + '">' +
          _esc(label) + '<span>' + count + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<div class="av-search-sort">' +
      '<label class="av-search"><span aria-hidden="true"></span><input type="search" value="' + _esc(_hub.query) + '" placeholder="Aventure, joueur, personnage…" aria-label="Rechercher une aventure" data-input="_advSearch"></label>' +
      '<select aria-label="Trier les aventures" data-change="_advSort">' +
        '<option value="recent"' + (_hub.sort === 'recent' ? ' selected' : '') + '>Activité récente</option>' +
        '<option value="next"' + (_hub.sort === 'next' ? ' selected' : '') + '>Prochaine séance</option>' +
        '<option value="name"' + (_hub.sort === 'name' ? ' selected' : '') + '>Nom</option>' +
      '</select>' +
    '</div>' +
  '</div>';
}

function _renderAdventureList(adventures) {
  if (!adventures.length) {
    const hasAny = (STATE.adventures || []).length > 0;
    return '<div class="av-list-empty"><strong>' + (hasAny ? 'Aucun résultat' : 'Aucune aventure') + '</strong><p>' +
      (hasAny ? 'Modifie la recherche ou le filtre actif.' : 'Crée ta première aventure ou restaure une sauvegarde.') +
      '</p>' + (!hasAny ? '<button class="av-btn is-primary" data-action="openCreateAdventureModal">Créer une aventure</button>' : '') + '</div>';
  }
  return '<div class="av-table">' +
    '<div class="av-table-head"><span>Aventure</span><span>Ton rôle</span><span>Prochaine séance</span><span>Membres</span></div>' +
    '<div class="av-rows">' + adventures.map(adv => {
      const selected = _hub.selectedId === adv.id;
      const active = STATE.adventure?.id === adv.id;
      const session = _nextSession(adv);
      const char = _characterOf(adv, STATE.user?.uid);
      const role = _role(adv);
      return '<button type="button" class="av-row' + (selected ? ' is-selected' : '') + (active ? ' is-active' : '') + '" data-action="_advSelect" data-id="' + adv.id + '">' +
        '<span class="av-row-main">' + _emblem(adv, 'is-small') +
          '<span><strong>' + _esc(adv.nom || 'Aventure sans nom') + '</strong>' +
          (active ? '<em>Active</em>' : '') +
          '<small>' + _esc(adv.description || 'Aucune description renseignée.') + '</small></span>' +
        '</span>' +
        '<span class="av-row-role' + (role === 'Joueur' && char ? ' has-character' : '') + '">' +
          (role === 'Joueur' && char
            ? _characterAvatar(char) + '<span><strong>' + _esc(char.name) + '</strong><small>' + _esc(char.detail || 'Joueur') + '</small></span>'
            : '<strong>' + role + '</strong><small>' + (_isArchived(adv) ? 'Archivée' : (role === 'Joueur' ? 'Membre' : _members(adv).length + ' PJ')) + '</small>') +
        '</span>' +
        '<span class="av-row-session"><strong>' + _esc(_dateLabel(session.date)) + '</strong><small>' + _esc(_relativeDay(session.date) || 'À planifier') + '</small></span>' +
        '<span class="av-row-members">' + _avatarStack(adv) + '</span>' +
      '</button>';
    }).join('') + '</div>' +
  '</div>';
}

function _renderDetail(adv) {
  if (!adv) return '<aside class="av-detail is-empty"><div><strong>Sélectionne une aventure</strong><p>Ses membres, ses pages et sa prochaine séance apparaîtront ici.</p></div></aside>';
  const role = _role(adv);
  const members = _members(adv);
  const enabled = enabledFeaturesOf(adv);
  const session = _nextSession(adv);
  const current = STATE.adventure?.id === adv.id;
  const canManage = _canManage(adv);
  const canLeave = adv.createdBy !== STATE.user?.uid;
  const leaving = _hub.leaveId === adv.id;
  const char = _characterOf(adv, STATE.user?.uid);
  const playIcon = '<svg class="av-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const primary = current
    ? '<button class="av-btn is-primary" data-navigate="' + (enabled.includes('vtt') ? 'vtt' : 'dashboard') + '">' + playIcon + (enabled.includes('vtt') ? 'Jouer' : 'Ouvrir') + '</button>'
    : '<button class="av-btn is-primary" data-action="pickAdventure" data-id="' + adv.id + '">' + playIcon + 'Entrer</button>';
  return '<aside class="av-detail" style="--adventure-color:' + _esc(_colorOf(adv)) + '">' +
    '<button type="button" class="av-detail-close" aria-label="Fermer le détail" data-action="_advCloseDetail">Fermer</button>' +
    '<header class="av-detail-head">' + _emblem(adv) +
      '<div><span class="av-detail-role">' + _esc(role + (_isArchived(adv) ? ' · archivée' : (current ? ' · active' : ''))) + '</span>' +
      '<h2>' + _esc(adv.nom || 'Aventure sans nom') + '</h2></div>' +
    '</header>' +
    '<div class="av-detail-scroll">' +
      '<p class="av-detail-desc">' + _esc(adv.description || 'Aucune description renseignée pour cette aventure.') + '</p>' +
      (role === 'Joueur' && char ? '<section class="av-detail-card"><span>Ton personnage</span><strong>' + _esc(char.name) + '</strong><small>' + _esc(char.detail || 'Personnage joueur') + '</small></section>' : '') +
      '<section class="av-detail-section"><div class="av-detail-title"><h3>Prochaine séance</h3><span>' + _esc(_relativeDay(session.date)) + '</span></div>' +
        '<div class="av-session"><strong>' + _esc(_dateLabel(session.date) + (session.slotLabel ? ' · ' + session.slotLabel : '')) + '</strong><span>' + _esc(session.title || (session.date ? 'Séance planifiée' : 'Aucune séance planifiée')) + '</span></div>' +
        '<p class="av-activity">' + _esc(_lastActivity(adv)) + '</p>' +
      '</section>' +
      '<section class="av-detail-section"><div class="av-detail-title"><h3>Membres</h3><span>' + members.length + '</span></div>' +
        '<div class="av-detail-members">' + members.map(uid => {
          const memberRole = uid === adv.createdBy ? 'Créateur' : (adv.admins?.includes(uid) ? 'MJ' : 'Joueur');
          const memberChar = _characterOf(adv, uid);
          return '<div class="av-detail-member">' + _avatar(adv, uid) +
            '<span><strong>' + _esc(_nameOf(adv, uid)) + (uid === STATE.user?.uid ? ' (toi)' : '') + '</strong><small>' + _esc(memberChar ? memberChar.name + (memberChar.detail ? ' · ' + memberChar.detail : '') : 'Pas de personnage') + '</small></span>' +
            '<em>' + memberRole + '</em></div>';
        }).join('') + '</div>' +
        (_pendingEmails(adv).length ? '<p class="av-pending">' + _pendingEmails(adv).length + ' invitation' + (_pendingEmails(adv).length > 1 ? 's' : '') + ' en attente</p>' : '') +
      '</section>' +
      (canManage ? '<section class="av-detail-section"><div class="av-detail-title"><h3>Pages actives</h3><span>' + enabled.length + '/' + TOGGLEABLE_FEATURES.length + '</span></div>' +
        '<div class="av-page-tags">' + enabled.map(key => {
          const feature = TOGGLEABLE_FEATURES.find(item => item.key === key);
          return '<span>' + _esc(feature?.label || key) + '</span>';
        }).join('') + '</div></section>' : '') +
      (leaving ? '<section class="av-leave-confirm"><strong>Quitter ' + _esc(adv.nom || 'cette aventure') + ' ?</strong><p>Ton personnage et son contenu seront définitivement supprimés.</p><div><button class="av-btn is-danger" data-action="_advLeaveConfirm" data-id="' + adv.id + '">Quitter et supprimer</button><button class="av-btn is-quiet" data-action="_advLeaveCancel">Annuler</button></div></section>' : '') +
    '</div>' +
    '<footer class="av-detail-actions">' + primary +
      (canManage ? '<button class="av-btn is-secondary" data-action="openManageAdventureModal" data-id="' + adv.id + '">Gérer</button>' : '') +
      (canLeave && !leaving ? '<button class="av-btn is-detail-danger" data-action="_advLeaveAsk" data-id="' + adv.id + '">Quitter</button>' : '') +
    '</footer>' +
  '</aside>';
}

async function renderAventuresPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  await _ensureInvitations();
  if (STATE.currentPage !== 'aventures' || !document.getElementById('main-content')) return;
  const adventures = Array.isArray(STATE.adventures) ? STATE.adventures : [];
  const visible = _visibleAdventures([...adventures]);
  if (!_hub.detailClosed && !visible.some(adv => adv.id === _hub.selectedId)) {
    _hub.selectedId = visible.find(adv => adv.id === STATE.adventure?.id)?.id || visible[0]?.id || '';
  }
  const selected = _hub.detailClosed ? null : (adventures.find(adv => adv.id === _hub.selectedId) || null);
  content.innerHTML = '<div class="av-page">' +
    '<header class="av-header"><div><span>Campagnes</span><h1>Aventures</h1></div><div class="av-header-actions">' +
      '<button class="av-btn is-quiet" data-action="_advCreateFromBackup">Depuis un backup</button>' +
      '<button class="av-btn is-primary" data-action="openCreateAdventureModal"><b>+</b> Nouvelle aventure</button>' +
    '</div></header>' +
    _renderInvitations() + _renderFilters(_counts(adventures)) +
    '<div class="av-split"><main class="av-list-panel">' + _renderAdventureList(visible) + '</main>' + _renderDetail(selected) + '</div>' +
  '</div>';
  _watchAgendaSession();
}

function _renderCreateModal() {
  const color = FALLBACK_COLOR;
  openModal('Créer une aventure', '<div class="av-create-v3">' +
    '<header class="av-modal-head"><div><span>Nouvelle campagne</span><h2>Créer une aventure</h2></div><button data-action="_advClose" aria-label="Fermer">Fermer</button></header>' +
    '<div class="av-create-body">' +
      '<div class="av-create-preview" style="--adventure-color:' + color + '">' +
        '<span class="av-emblem" id="adv-create-emblem" style="--adventure-color:' + color + '">?</span>' +
        '<div><strong id="adv-create-preview-name">Nom de l’aventure</strong><small>' + _esc(STATE.profile?.pseudo || 'Créateur') + ' · MJ</small></div>' +
      '</div>' +
      '<label class="av-field"><span>Nom</span><input id="adv-nom" data-input="_advCreatePreview" maxlength="60" placeholder="ex. La Chute des Dieux" data-modal-initial-focus></label>' +
      '<div class="av-field"><span>Couleur de l’emblème</span>' + _colorButtons('adv-color', color) + '</div>' +
      '<label class="av-field"><span>Description <small>optionnelle</small></span><textarea id="adv-desc" rows="4" placeholder="Ambiance, promesse, ton général…"></textarea></label>' +
    '</div>' +
    '<footer class="av-modal-footer"><button class="av-link-btn" data-action="_advCreateFromBackup">Depuis un backup</button><div><button class="av-btn is-quiet" data-action="_advClose">Annuler</button><button class="av-btn is-primary" data-action="_doCreateAdventure">Créer</button></div></footer>' +
  '</div>');
}

export function openCreateAdventureModal() {
  _renderCreateModal();
}

async function doCreateAdventure() {
  const nom = document.getElementById('adv-nom')?.value?.trim();
  const description = document.getElementById('adv-desc')?.value?.trim() || '';
  const color = document.getElementById('adv-color')?.value || FALLBACK_COLOR;
  if (!nom) {
    showNotif('Donne un nom à ton aventure.', 'error');
    return;
  }
  try {
    const adv = await createAdventure({ nom, emoji: '', description, color });
    await _refreshAdventures();
    _hub.selectedId = adv.id;
    _hub.detailClosed = false;
    closeModal();
    showNotif('Aventure créée.', 'success');
    renderAventuresPage();
  } catch (error) {
    showNotif(error.message || 'Erreur lors de la création.', 'error');
  }
}

function _manageContext(adv, allUsers) {
  const admins = adv.admins || [];
  const members = _members(adv);
  const profiles = adv.memberProfiles || {};
  const absorbed = new Set(Object.keys(adv.accountRelinks || {}));
  const memberSet = new Set(members);
  const charCount = new Map();
  (STATE.characters || []).forEach(char => {
    if (char?.uid) charCount.set(char.uid, (charCount.get(char.uid) || 0) + 1);
  });
  const emailByUid = new Map();
  allUsers.forEach(user => {
    if (user?.id && user?.email) emailByUid.set(user.id, String(user.email).trim().toLocaleLowerCase());
  });
  const emailOf = uid => {
    const profile = profiles[uid];
    return emailByUid.get(uid) || String(typeof profile === 'object' ? profile?.email || '' : '').trim().toLocaleLowerCase();
  };
  const replacementFor = uid => {
    if (absorbed.has(uid)) return '';
    const email = emailOf(uid);
    if (!email) return '';
    const candidates = allUsers.filter(user =>
      user.id !== uid && !memberSet.has(user.id) && String(user.email || '').toLocaleLowerCase() === email
    ).map(user => user.id);
    if (candidates.length) return candidates[0];
    const duplicates = members.filter(other => other !== uid && !absorbed.has(other) && emailOf(other) === email);
    if (!duplicates.length) return '';
    const target = duplicates.sort((a, b) => (charCount.get(a) || 0) - (charCount.get(b) || 0))[0];
    return (charCount.get(uid) || 0) > (charCount.get(target) || 0) ? target : '';
  };
  return { admins, members, replacementFor };
}

function _managePresentation(adv) {
  const color = _colorOf(adv);
  return '<section class="av-manage-pane">' +
    '<div class="av-manage-preview" style="--adventure-color:' + _esc(color) + '">' + _emblem(adv) +
      '<div><strong id="adv-edit-preview-name">' + _esc(adv.nom || 'Aventure sans nom') + '</strong><small>' + _members(adv).length + ' membres</small></div>' +
    '</div>' +
    '<label class="av-field"><span>Nom</span><input id="adv-edit-nom" value="' + _esc(adv.nom || '') + '" maxlength="60" data-input="_advEditPreview"></label>' +
    '<div class="av-field"><span>Couleur de l’emblème</span>' + _colorButtons('adv-edit-color', color) + '</div>' +
    '<label class="av-field"><span>Description</span><textarea id="adv-edit-desc" rows="5">' + _esc(adv.description || '') + '</textarea></label>' +
    '<div class="av-pane-actions"><button class="av-btn is-primary" data-action="_advSaveMeta" data-id="' + adv.id + '">Enregistrer</button></div>' +
  '</section>';
}

function _manageMembers(adv, context) {
  const memberRows = context.members.map(uid => {
    const creator = uid === adv.createdBy;
    const admin = context.admins.includes(uid);
    const replacement = context.replacementFor(uid);
    return '<div class="av-manage-member">' + _avatar(adv, uid) +
      '<div><strong>' + _esc(_nameOf(adv, uid)) + '</strong><small>' + (creator ? 'Créateur' : (admin ? 'MJ' : 'Joueur')) + '</small></div>' +
      '<div class="av-member-buttons">' +
        (replacement && !creator ? '<button data-action="_advRelink" data-adv-id="' + adv.id + '" data-old-uid="' + uid + '" data-new-uid="' + replacement + '">Réassocier</button>' : '') +
        (!admin && !creator ? '<button data-action="_advPromote" data-adv-id="' + adv.id + '" data-uid="' + uid + '">Nommer MJ</button>' : '') +
        (!creator ? '<button class="is-danger" data-action="_advRemove" data-adv-id="' + adv.id + '" data-uid="' + uid + '">Retirer</button>' : '') +
      '</div></div>';
  }).join('');
  const pending = _pendingEmails(adv);
  return '<section class="av-manage-pane">' +
    '<div class="av-pane-title"><div><span>Membres</span><h3>Accès à l’aventure</h3></div><b>' + context.members.length + '</b></div>' +
    '<div class="av-members-list">' + (memberRows || '<p class="av-muted">Aucun membre.</p>') + '</div>' +
    '<div class="av-invite-form"><label class="av-field"><span>Inviter par email</span><div><input type="email" id="adv-invite-email" placeholder="email@exemple.com" inputmode="email" autocomplete="email"><button class="av-btn is-primary" data-action="_advInvite" data-id="' + adv.id + '">Inviter</button></div></label></div>' +
    (pending.length ? '<div class="av-pending-list"><h4>Invitations en attente</h4>' + pending.map(email =>
      '<div><span>' + _esc(email) + '</span><button data-action="_advCancelInvite" data-adv-id="' + adv.id + '" data-email="' + _esc(email) + '">Annuler</button></div>'
    ).join('') + '</div>' : '') +
  '</section>';
}

function _managePages(adv) {
  const enabled = new Set(enabledFeaturesOf(adv));
  return '<section class="av-manage-pane">' +
    '<div class="av-pane-title"><div><span>Pages</span><h3>Fonctionnalités actives</h3></div><b>' + enabled.size + '</b></div>' +
    '<p class="av-pane-intro">Choisis les sections accessibles dans cette aventure. Chaque changement est enregistré immédiatement.</p>' +
    '<div class="av-feature-grid">' + TOGGLEABLE_FEATURES.map(feature => {
      const locked = isPremiumFeature(feature.key) && !isFeatureAllowedByPlan(feature.key, STATE.profile, adv);
      return '<button type="button" class="av-feature-toggle' + (enabled.has(feature.key) ? ' is-on' : '') + (locked ? ' is-premium-locked' : '') + '" data-action="_advToggleFeature" data-adv-id="' + adv.id + '" data-feature="' + feature.key + '" aria-pressed="' + enabled.has(feature.key) + '"' + (locked ? ' aria-disabled="true"' : '') + '>' +
        '<span class="av-feature-mark">' + _esc(String(feature.label || feature.key).charAt(0)) + '</span><strong>' + _esc(feature.label) + '</strong>' +
        (locked ? '<small>Premium</small>' : '') + '<i aria-hidden="true"></i>' +
      '</button>';
    }).join('') + '</div></section>';
}

function _manageBackup(adv) {
  const locked = !hasAdventurePremiumAccess(adv);
  return '<section class="av-manage-pane">' +
    '<div class="av-pane-title"><div><span>Sauvegarde</span><h3>Backup JSON</h3></div></div>' +
    '<p class="av-pane-intro">Exporte une copie complète de la campagne ou restaure les données d’une sauvegarde existante.</p>' +
    '<div class="av-backup-cards">' +
      '<article><strong>Exporter la campagne</strong><p>Crée un fichier JSON contenant les documents de l’aventure.</p><button class="av-btn' + (locked ? ' is-locked' : '') + '" data-action="_advExport" data-id="' + adv.id + '">' + (locked ? 'Premium requis' : 'Exporter') + '</button></article>' +
      '<article><strong>Restaurer un backup</strong><p>Réécrit les documents présents dans le fichier sans supprimer les autres.</p><button class="av-btn' + (locked ? ' is-locked' : '') + '" data-action="_advImport" data-id="' + adv.id + '">' + (locked ? 'Premium requis' : 'Restaurer') + '</button></article>' +
    '</div></section>';
}

function _manageDanger(adv) {
  return '<section class="av-manage-pane">' +
    '<div class="av-pane-title"><div><span>Zone sensible</span><h3>Archivage et suppression</h3></div></div>' +
    '<div class="av-danger-card"><div><strong>' + (_isArchived(adv) ? 'Réactiver l’aventure' : 'Archiver l’aventure') + '</strong><p>' + (_isArchived(adv) ? 'L’aventure réapparaîtra dans la liste principale.' : 'L’aventure reste accessible depuis le filtre Archivées.') + '</p></div><button class="av-btn" data-action="_advArchive" data-id="' + adv.id + '">' + (_isArchived(adv) ? 'Réactiver' : 'Archiver') + '</button></div>' +
    (STATE.isSuperAdmin ? '<div class="av-danger-card is-destructive"><div><strong>Supprimer définitivement</strong><p>Saisis exactement le nom de l’aventure pour confirmer.</p><input id="adv-delete-name" placeholder="' + _esc(adv.nom || '') + '"></div><button class="av-btn is-danger" data-action="_advDelete" data-id="' + adv.id + '">Supprimer</button></div>' : '') +
  '</section>';
}

function _renderManageModal(adv, allUsers) {
  const context = _manageContext(adv, allUsers);
  let pane = _managePresentation(adv);
  if (_manage.tab === 'members') pane = _manageMembers(adv, context);
  if (_manage.tab === 'pages') pane = _managePages(adv);
  if (_manage.tab === 'backup') pane = _manageBackup(adv);
  if (_manage.tab === 'danger') pane = _manageDanger(adv);
  const body = '<div class="adv-manage-v3">' +
    '<header class="av-modal-head is-manage">' + _emblem(adv, 'is-small') + '<div><span>Gérer</span><h2>' + _esc(adv.nom || 'Aventure sans nom') + '</h2></div><button data-action="_advClose" aria-label="Fermer">Fermer</button></header>' +
    '<div class="av-manage-layout"><nav>' + MANAGE_TABS.map(([key, label]) => {
      const count = key === 'members' ? context.members.length : (key === 'pages' ? enabledFeaturesOf(adv).length : '');
      return '<button class="' + (_manage.tab === key ? 'is-active' : '') + (key === 'danger' ? ' is-danger' : '') + '" data-action="_advManageTab" data-tab="' + key + '">' + label + (count !== '' ? '<span>' + count + '</span>' : '') + '</button>';
    }).join('') + '</nav><main>' + pane + '</main></div></div>';
  openModal('Gérer ' + (adv.nom || 'l’aventure'), body);
}

export async function openManageAdventureModal(adventureId, tab = 'presentation') {
  const adv = STATE.adventures.find(item => item.id === adventureId);
  if (!adv || !_canManage(adv)) return;
  _manage.id = adventureId;
  _manage.tab = tab;
  if (STATE.isSuperAdmin && !_manage.usersByAdventure.has(adventureId)) {
    _manage.usersByAdventure.set(adventureId, await loadAllUsers(adv));
  }
  _renderManageModal(adv, _manage.usersByAdventure.get(adventureId) || []);
}

async function saveAdventureMeta(advId) {
  const nom = document.getElementById('adv-edit-nom')?.value?.trim();
  const description = document.getElementById('adv-edit-desc')?.value?.trim() || '';
  const color = document.getElementById('adv-edit-color')?.value || FALLBACK_COLOR;
  if (!nom) {
    showNotif('Le nom ne peut pas être vide.', 'error');
    return;
  }
  try {
    await updateAdventureMeta(advId, { nom, description, color });
    await _refreshAdventures();
    showNotif('Aventure mise à jour.', 'success');
    openManageAdventureModal(advId, 'presentation');
    renderAventuresPage();
  } catch (error) {
    showNotif(error.message || 'Échec de la modification.', 'error');
  }
}

async function archiveAdventure(advId) {
  const adv = STATE.adventures.find(item => item.id === advId);
  if (!adv) return;
  try {
    await updateAdventureMeta(advId, { status: _isArchived(adv) ? 'active' : 'archived' });
    await _refreshAdventures();
    closeModal();
    _hub.filter = _isArchived(adv) ? 'all' : 'archived';
    _hub.selectedId = advId;
    _hub.detailClosed = false;
    showNotif(_isArchived(adv) ? 'Aventure réactivée.' : 'Aventure archivée.', 'success');
    renderAventuresPage();
  } catch (error) {
    showNotif(error.message || 'Échec de la modification.', 'error');
  }
}

async function acceptHubInvitation(id) {
  const invitation = (_hub.invitations || []).find(item => item.id === id);
  if (!invitation) return;
  try {
    const joined = await acceptInvitation(invitation);
    _hub.invitations = (_hub.invitations || []).filter(item => item.id !== id);
    _hub.selectedId = id;
    localStorage.setItem('jdr-last-adventure', id);
    await selectAdventure(joined);
    showNotif('Invitation acceptée.', 'success');
    await navigate('dashboard');
  } catch (error) {
    showNotif(error.message || 'Impossible d’accepter cette invitation.', 'error');
  }
}

async function declineHubInvitation(id) {
  const invitation = (_hub.invitations || []).find(item => item.id === id);
  if (!invitation) return;
  try {
    await declineInvitation(invitation);
    _hub.invitations = (_hub.invitations || []).filter(item => item.id !== id);
    showNotif('Invitation refusée.', 'success');
    renderAventuresPage();
  } catch (error) {
    showNotif(error.message || 'Impossible de refuser cette invitation.', 'error');
  }
}

async function exportAdventureBackup(advId, button) {
  const adv = STATE.adventures.find(item => item.id === advId);
  if (!hasAdventurePremiumAccess(adv)) {
    showNotif('Les backups complets sont réservés aux aventures Premium.', 'info');
    return;
  }
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Export en cours…';
  }
  try {
    const payload = await exportAdventure(advId);
    const total = Object.values(payload.collections).reduce((count, items) => count + items.length, 0);
    const slug = (adv?.nom || 'campagne').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campagne';
    const filename = 'campagne-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.json';
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 100);
    showNotif(filename + ' — ' + total + ' document(s) sauvegardé(s).', 'success');
  } catch (error) {
    showNotif('Échec de l’export : ' + error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

function createAdventureFromBackup() {
  if (!hasPremiumAccess()) {
    showNotif('La création depuis backup est réservée aux comptes Premium.', 'info');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      showNotif('Fichier JSON invalide.', 'error');
      return;
    }
    if (payload?.type !== 'le-grand-jdr.campaign' || !payload.collections) {
      showNotif('Ce fichier n’est pas un backup de campagne.', 'error');
      return;
    }
    const meta = payload.adventure || {};
    const nom = String(meta.nom || '').trim() || 'Campagne restaurée';
    const total = Object.values(payload.collections).reduce((count, items) => count + (Array.isArray(items) ? items.length : 0), 0);
    const ok = await confirmModal(
      'Créer une nouvelle aventure « ' + _esc(nom) + ' » et restaurer <strong>' + total + '</strong> document(s) ?<br><br>Tu en seras l’unique MJ. Les anciens membres devront être invités de nouveau.',
      { title: 'Créer depuis un backup', confirmLabel: 'Créer et restaurer', danger: false, icon: '' }
    );
    if (!ok) return;
    try {
      const adv = await createAdventure({ nom, emoji: '', description: meta.description || '', color: meta.color || FALLBACK_COLOR });
      closeModal();
      const result = await importAdventure(adv.id, payload);
      await _refreshAdventures();
      _hub.selectedId = adv.id;
      renderAventuresPage();
      showNotif(result.failed.length ? 'Aventure créée avec certains échecs de restauration.' : 'Aventure restaurée.', result.failed.length ? 'error' : 'success');
    } catch (error) {
      showNotif('Échec : ' + error.message, 'error');
    }
  });
  document.body.appendChild(input);
  input.click();
}

function importAdventureBackup(advId) {
  const adv = STATE.adventures.find(item => item.id === advId);
  if (!hasAdventurePremiumAccess(adv)) {
    showNotif('La restauration est réservée aux aventures Premium.', 'info');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      showNotif('Fichier JSON invalide.', 'error');
      return;
    }
    if (payload?.type !== 'le-grand-jdr.campaign' || !payload.collections) {
      showNotif('Ce fichier n’est pas un backup de campagne.', 'error');
      return;
    }
    const total = Object.values(payload.collections).reduce((count, items) => count + (Array.isArray(items) ? items.length : 0), 0);
    const mismatch = payload.adventureId && payload.adventureId !== advId;
    const ok = await confirmModal(
      'Restaurer <strong>' + total + '</strong> document(s) dans <strong>' + _esc(adv?.nom || advId) + '</strong> ?<br><br>Les documents portant le même identifiant seront écrasés. Aucune donnée absente du backup ne sera supprimée.' + (mismatch ? '<br><br>Attention : ce backup vient d’une autre aventure.' : ''),
      { title: 'Restaurer la campagne', confirmLabel: 'Restaurer', icon: '' }
    );
    if (!ok) return;
    try {
      const result = await importAdventure(advId, payload);
      showNotif(result.failed.length ? 'Restauration partielle : ' + result.written + ' document(s).' : result.written + ' document(s) restauré(s).', result.failed.length ? 'error' : 'success');
    } catch (error) {
      showNotif('Échec de la restauration : ' + error.message, 'error');
    }
  });
  document.body.appendChild(input);
  input.click();
}

async function leaveAdventure(advId) {
  const adv = STATE.adventures.find(item => item.id === advId);
  if (!adv || adv.createdBy === STATE.user?.uid) return;
  try {
    if (STATE.adventure?.id !== advId) await selectAdventure(adv);
    const characters = await loadMyCharacters(advId);
    if (characters.length) {
      const { purgeCharacter } = await import('./characters/forms.js');
      for (const character of characters) {
        try {
          await purgeCharacter(character.id);
        } catch (error) {
          console.warn('[leaveAdventure] purge ignorée', character.id, error?.code || error);
        }
      }
    }
    await removeSelfFromAdventure(advId);
    unwatchAll();
    const adventures = await _refreshAdventures();
    _hub.leaveId = '';
    showNotif('Tu as quitté « ' + adv.nom + ' ».', 'success');
    const { showAdventurePicker } = await import('../core/layout.js');
    showAdventurePicker(adventures);
  } catch (error) {
    console.error('[leaveAdventure]', error);
    showNotif(error.message || 'Impossible de quitter cette aventure.', 'error');
  }
}

async function deleteAdventureAndRefresh(advId) {
  const adv = STATE.adventures.find(item => item.id === advId);
  const typed = document.getElementById('adv-delete-name')?.value?.trim();
  if (!adv || typed !== String(adv.nom || '').trim()) {
    showNotif('Saisis exactement le nom de l’aventure.', 'error');
    return;
  }
  try {
    await deleteAdventure(advId);
    closeModal();
    showNotif('Aventure supprimée.', 'success');
    if (!STATE.adventures.length) {
      const { showAdventurePicker } = await import('../core/layout.js');
      showAdventurePicker([]);
      return;
    }
    _hub.selectedId = STATE.adventure?.id || STATE.adventures[0]?.id || '';
    renderAventuresPage();
  } catch (error) {
    showNotif(error.message || 'Échec de la suppression.', 'error');
  }
}

async function inviteAdventurePlayer(advId) {
  const input = document.getElementById('adv-invite-email');
  const email = input?.value?.trim();
  if (!email || !input.checkValidity()) {
    input?.reportValidity();
    return;
  }
  try {
    await inviteByEmail(advId, email);
    await _refreshAdventures();
    showNotif('Invitation envoyée à ' + email + '.', 'success');
    openManageAdventureModal(advId, 'members');
  } catch (error) {
    showNotif(error.message || 'Échec de l’invitation.', 'error');
  }
}

async function toggleAdventureFeature(button) {
  const advId = button.dataset.advId;
  const feature = button.dataset.feature;
  const adv = STATE.adventures.find(item => item.id === advId) || STATE.adventure;
  if (isPremiumFeature(feature) && !isFeatureAllowedByPlan(feature, STATE.profile, adv)) {
    showNotif('Cette page est réservée aux aventures Premium.', 'info');
    return;
  }
  const on = button.classList.toggle('is-on');
  button.setAttribute('aria-pressed', String(on));
  const keys = [...document.querySelectorAll('.av-feature-toggle.is-on[data-feature]')].map(item => item.dataset.feature);
  try {
    await setAdventureFeatures(advId, keys);
    await _refreshAdventures();
    const { applyFeatureVisibility } = await import('../core/layout.js');
    applyFeatureVisibility();
  } catch (error) {
    button.classList.toggle('is-on');
    button.setAttribute('aria-pressed', String(!on));
    showNotif(error.message || 'Échec de la modification.', 'error');
  }
}

async function cancelAdventureInvite(advId, email) {
  try {
    await cancelInvite(advId, email);
    await _refreshAdventures();
    showNotif('Invitation annulée.', 'success');
    openManageAdventureModal(advId, 'members');
  } catch (error) {
    showNotif(error.message || 'Échec de l’annulation.', 'error');
  }
}

async function removeAdventurePlayer(advId, uid) {
  try {
    await removePlayerFromAdventure(advId, uid);
    await _refreshAdventures();
    showNotif('Joueur retiré.', 'success');
    openManageAdventureModal(advId, 'members');
  } catch (error) {
    showNotif(error.message || 'Échec du retrait.', 'error');
  }
}

async function promoteAdventurePlayer(advId, uid) {
  try {
    await promoteToAdmin(advId, uid);
    await _refreshAdventures();
    showNotif('Joueur nommé MJ.', 'success');
    openManageAdventureModal(advId, 'members');
  } catch (error) {
    showNotif(error.message || 'Échec de la promotion.', 'error');
  }
}

async function relinkAdventurePlayer(advId, oldUid, newUid) {
  if (!newUid || newUid === oldUid) return;
  const ok = await confirmModal(
    'Réassocier ce joueur à son nouveau compte ? Son accès et ses personnages seront transférés.',
    { title: 'Réassocier le joueur', confirmLabel: 'Réassocier', danger: false, icon: '' }
  );
  if (!ok) return;
  try {
    const result = await relinkPlayerAccount(advId, oldUid, newUid);
    await _refreshAdventures();
    showNotif('Compte réassocié — ' + result.migrated + ' personnage(s) transféré(s).', 'success');
    openManageAdventureModal(advId, 'members');
  } catch (error) {
    showNotif(error.message || 'Échec de la réassociation.', 'error');
  }
}

import PAGES from './pages.js';
PAGES.aventures = renderAventuresPage;

registerActions({
  openCreateAdventureModal: () => openCreateAdventureModal(),
  openManageAdventureModal: button => openManageAdventureModal(button.dataset.id),
  _advClose: () => closeModal(),
  _advFilter: button => {
    _hub.filter = button.dataset.filter || 'all';
    _hub.leaveId = '';
    _hub.detailClosed = false;
    renderAventuresPage();
  },
  _advSort: select => {
    _hub.sort = select.value || 'recent';
    _hub.detailClosed = false;
    renderAventuresPage();
  },
  _advSearch: input => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    _hub.query = input.value;
    renderAventuresPage().then(() => {
      const live = document.querySelector('[data-input="_advSearch"]');
      if (!live) return;
      live.focus({ preventScroll: true });
      try { live.setSelectionRange(start, end); } catch {}
    });
  },
  _advSelect: button => {
    _hub.selectedId = button.dataset.id;
    _hub.leaveId = '';
    _hub.detailClosed = false;
    renderAventuresPage();
  },
  _advCloseDetail: () => {
    _hub.selectedId = '';
    _hub.detailClosed = true;
    renderAventuresPage();
  },
  _advLeaveAsk: button => {
    _hub.leaveId = button.dataset.id;
    renderAventuresPage();
  },
  _advLeaveCancel: () => {
    _hub.leaveId = '';
    renderAventuresPage();
  },
  _advLeaveConfirm: button => leaveAdventure(button.dataset.id),
  _advAcceptInvitation: button => acceptHubInvitation(button.dataset.id),
  _advDeclineInvitation: button => declineHubInvitation(button.dataset.id),
  _advCreatePreview: input => {
    const name = input.value.trim() || 'Nom de l’aventure';
    const label = document.getElementById('adv-create-preview-name');
    const emblem = document.getElementById('adv-create-emblem');
    if (label) label.textContent = name;
    if (emblem) emblem.textContent = _monogram(input.value);
  },
  _advEditPreview: input => {
    const label = document.getElementById('adv-edit-preview-name');
    const emblem = document.querySelector('.av-manage-preview .av-emblem');
    if (label) label.textContent = input.value.trim() || 'Aventure sans nom';
    if (emblem) emblem.textContent = _monogram(input.value);
  },
  _advPickColor: button => {
    const target = document.getElementById(button.dataset.targetId);
    if (target) target.value = button.dataset.color || FALLBACK_COLOR;
    button.parentElement?.querySelectorAll('.av-color').forEach(item => item.classList.toggle('is-selected', item === button));
    const scope = button.closest('.av-create-v3, .adv-manage-v3');
    scope?.querySelectorAll('.av-emblem, .av-create-preview, .av-manage-preview').forEach(item => item.style.setProperty('--adventure-color', button.dataset.color || FALLBACK_COLOR));
  },
  _doCreateAdventure: () => doCreateAdventure(),
  _advCreateFromBackup: () => createAdventureFromBackup(),
  _advManageTab: button => openManageAdventureModal(_manage.id, button.dataset.tab),
  _advSaveMeta: button => saveAdventureMeta(button.dataset.id),
  _advArchive: button => archiveAdventure(button.dataset.id),
  _advDelete: button => deleteAdventureAndRefresh(button.dataset.id),
  _advExport: button => exportAdventureBackup(button.dataset.id, button),
  _advImport: button => importAdventureBackup(button.dataset.id),
  _advInvite: button => inviteAdventurePlayer(button.dataset.id),
  _advCancelInvite: button => cancelAdventureInvite(button.dataset.advId, button.dataset.email),
  _advToggleFeature: button => toggleAdventureFeature(button),
  _advPromote: button => promoteAdventurePlayer(button.dataset.advId, button.dataset.uid),
  _advRemove: button => removeAdventurePlayer(button.dataset.advId, button.dataset.uid),
  _advRelink: button => relinkAdventurePlayer(button.dataset.advId, button.dataset.oldUid, button.dataset.newUid),
});
