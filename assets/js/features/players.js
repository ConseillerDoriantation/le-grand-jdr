// ══════════════════════════════════════════════════════════════════════════════
// PLAYERS.JS — Roster de campagne
//
// Registre maître/détail des personnages de l'aventure, complété par une
// galerie groupée par joueur et une carte des relations d'aventure.
//
// Admin : drag pour réordonner, toggle visibilité, modal de création/édition
// avec illustration cropable et confidentialité des infos de jeu.
//
// Pattern d'événements : data-pp-action="X" + handlers dans `ppHandlers`
// (cohérent avec bestiary/shop).
// ══════════════════════════════════════════════════════════════════════════════
import { makeSortable } from '../shared/sortable-helper.js';
import { confirmDelete, tryUpsert } from '../shared/crud.js';

let _ppEditingPlayer = null;
import { STATE } from '../core/state.js';
import { navigate } from '../core/navigation.js';
import { charSession } from '../shared/char-session.js';
import { bioPageFor } from '../shared/character-pages.js';
import { loadCollection, updateInCol } from '../data/firestore.js';
import { openModal, closeModalDirect, promptModal, setModalCloseGuard, clearModalCloseGuard } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';
import { _esc, _nl2br, _norm, _initials, normalizeImageUrl } from '../shared/html.js';
import {
  getMod, calcCA, calcPVMax, calcPMMax, calcOr, calcVitesse, STAT_META, statShort, getModFromScore, modStr,
} from '../shared/char-stats.js';
import { attachPanZoomCrop } from '../shared/image-crop.js';
import { bindImageUploadDropZone, uploadJpeg } from '../shared/image-upload.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal, CLOUDINARY_ENABLED } from '../shared/upload-cloudinary.js';
import { lsJson } from '../shared/local-storage.js';
import { richTextContentHtml } from '../shared/rich-text.js';
import { hasFreePage, renderFreePageHtml } from '../shared/free-page.js';
import { quillEditorHtml, getQuillHtml, bindQuillEditors } from '../shared/rich-text-quill.js';
import { bindScopedActions } from '../shared/scoped-actions.js';
import { characterPortraitContent } from '../shared/portraits.js';
import { getEquipmentSlots } from '../shared/equipment-slots.js';
import { getRouteSub, setRouteSub } from '../shared/route.js';

// ══════════════════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS (cohérent bestiary/shop, voir shared/scoped-actions.js)
// Pattern : <button data-pp-action="open" data-id="…">…</button>
// ══════════════════════════════════════════════════════════════════════════════
const ppHandlers = {};
bindScopedActions('pp', ppHandlers);

// ── Palette tags (couleur stable par hash du libellé) ─────────────────────────
const _TAG_COLORS = [
  ['rgba(79,140,255,.14)','rgba(79,140,255,.35)','#7fb0ff'],
  ['rgba(34,195,142,.14)','rgba(34,195,142,.35)','#22c38e'],
  ['rgba(232,184,75,.14)','rgba(232,184,75,.35)','#e8b84b'],
  ['rgba(180,127,255,.14)','rgba(180,127,255,.35)','#b47fff'],
  ['rgba(255,107,107,.14)','rgba(255,107,107,.35)','#ff8080'],
  ['rgba(245,158,11,.14)', 'rgba(245,158,11,.35)', '#f59e0b'],
];
function _tagColor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return _TAG_COLORS[h % _TAG_COLORS.length];
}

// Couleur d'accent stable par nom (pour le portrait fallback + accents)
const _ACCENT_COLORS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
const _accentColor = (nom = '') => _ACCENT_COLORS[(nom.charCodeAt(0) || 0) % _ACCENT_COLORS.length];

function _plainExcerpt(value = '', max = 150) {
  const text = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function _ppIcon(name, className = 'pp-icon') {
  const icons = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>',
    eyeOff: '<path d="m2 2 20 20"></path><path d="M10.6 10.6a3 3 0 0 0 3.8 3.8"></path><path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.3 3.2"></path><path d="M6.1 6.1C3.4 7.9 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.3 3.6-.8"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="m6 7 1 13h10l1-13"></path><path d="M9 7V4h6v3"></path>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
    grip: '<path d="M9 5h.01"></path><path d="M15 5h.01"></path><path d="M9 12h.01"></path><path d="M15 12h.01"></path><path d="M9 19h.01"></path><path d="M15 19h.01"></path>',
    cards: '<rect x="5" y="4" width="12" height="16" rx="2"></rect><path d="M9 8h4"></path><path d="M9 12h4"></path><path d="M7 20h10"></path>',
    relations: '<circle cx="6" cy="7" r="3"></circle><circle cx="18" cy="7" r="3"></circle><circle cx="12" cy="18" r="3"></circle><path d="m8.5 9.5 2 5"></path><path d="m15.5 9.5-2 5"></path><path d="M9 7h6"></path>',
    arrowLeft: '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    arrowRight: '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
    chevronDown: '<path d="m6 9 6 6 6-6"></path>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"></path>',
    calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path>',
    flag: '<path d="M4 22V4"></path><path d="M4 4h13l-1.5 4L17 12H4"></path>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8.5" cy="10.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path>',
    mapPin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle>',
    trophy: '<path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0Z"></path><path d="M5 6H3v2a4 4 0 0 0 4 4"></path><path d="M19 6h2v2a4 4 0 0 1-4 4"></path>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    upload: '<path d="M12 16V4"></path><path d="m6 10 6-6 6 6"></path><path d="M4 20h16"></path>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
    heart: '<path d="M20.8 8.6c0 5.1-8.8 10.4-8.8 10.4S3.2 13.7 3.2 8.6A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8.8 2.6Z"></path>',
    spark: '<path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5Z"></path>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>',
    coin: '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v8"></path><path d="M9.5 10.5c0-1.2 1.1-2 2.5-2 1.3 0 2.5.7 2.5 2 0 1.2-1 1.6-2.5 2s-2.5.8-2.5 2c0 1.3 1.2 2 2.5 2 1.4 0 2.5-.8 2.5-2"></path>',
    user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    users: '<path d="M16 21a6 6 0 0 0-12 0"></path><circle cx="10" cy="8" r="4"></circle><path d="M22 21a5 5 0 0 0-5-5"></path><path d="M17 4a4 4 0 0 1 0 8"></path>',
    list: '<path d="M9 6h11"></path><path d="M9 12h11"></path><path d="M9 18h11"></path><path d="M4 6h.01"></path><path d="M4 12h.01"></path><path d="M4 18h.01"></path>',
    external: '<path d="M14 4h6v6"></path><path d="M20 4 10 14"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>',
    star: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z"></path>',
  };
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.user}</svg>`;
}

// ── État module ───────────────────────────────────────────────────────────────
let _ppCardCropper = null;         // cropper de l'image de la card (pan-zoom 3:4)
let _ppCardCropParams = null;      // { offX, offY, imgW, imgH } après confirmation
let _ppGallery = [];               // galerie en cours d'édition (URLs externes uniquement)
let _ppModalImageUrl = '';
let _ppModalVisible = true;
let _ppModalPreview = 'card';
let _ppModalDirty = false;
let _ppModalConfirm = '';
let _ppModalCleanup = null;
const PP_GALLERY_MAX = 12;         // pas de limite stricte de taille : on stocke des URLs
const PP_GALLERY_UPLOAD = { max: 1600, quality: 0.88 }; // compression avant upload Cloudinary
const STORE = {
  items:         [],     // dataset assemblé (perso + presentation)
  activeId:      '',     // id de l'item ouvert en fiche (vide = sommaire)
  filterSearch:  '',
  sortBy:        'ordre',   // 'ordre' (custom MJ) | 'nom' | 'niveau' | 'joueur' | 'classe'
  viewMode:      'gallery', // 'register' | 'gallery' | 'relations'
  detailSection: 'presentation',
  grouped:       true,
  collapsedGroups: {},
  mobileDetail:  false,
  chroniqueExpanded: {},
  partenairesExpanded: {},
  presentations: [],
  characters:    [],
  achievements:  [],
  story:         [],     // missions / événements de trame (pour top compagnons)
  quests:        [],     // quêtes-groupes (missionId + participants) → partenaires d'aventure
  relMode:       'characters',
  relMin:        1,
  relSelectedId: '',
  relTableId:    null,
  relQuery:      '',
  relShowNever:  false,
};

// ── Groupes (quêtes liées aux missions) — source des partenaires d'aventure ───
// Chaque quête-groupe = un tableau de charIds (ses participants). Deux PJ sont
// partenaires s'ils figurent dans le MÊME groupe (même quête).
function _allGroupMemberLists() {
  const plannedMissionIds = new Set((STORE.story || [])
    .filter(mission => _missionStatus(mission)[0] === 'planned')
    .map(mission => mission.id));
  return (STORE.quests || [])
    .filter(q => !plannedMissionIds.has(q.missionId))
    .map(q => [...new Set((q.participants || []).map(p => p.charId).filter(Boolean))])
    .filter(list => list.length > 1);
}
// Groupes encore existants auxquels le personnage appartient pour une mission.
// La liste `story.participants` est un historique cumulatif : elle peut encore
// contenir les membres d'un groupe supprimé. Elle ne doit donc jamais servir à
// reconstruire la chronique ni ses compagnons.
function _missionGroupsForChar(missionId, currentCharId) {
  if (!missionId || !currentCharId) return [];
  return (STORE.quests || [])
    .filter(q => q.missionId === missionId)
    .map(q => [...new Set((q.participants || []).map(p => p.charId).filter(Boolean))])
    .filter(members => members.includes(currentCharId));
}

function _missionGroupMemberIds(missionId, currentCharId) {
  return new Set(_missionGroupsForChar(missionId, currentCharId).flat());
}

// localStorage : ordre fallback hors-ligne (admin réordonne)
const _LS_KEY = 'pp-ordre';
const _VIEW_LS_KEY = 'pp-view-state-v2';
const _getLocalOrdre = () => lsJson.get(_LS_KEY, null);
const _setLocalOrdre = ids => lsJson.set(_LS_KEY, ids);
const _savedView = lsJson.get(_VIEW_LS_KEY, {}) || {};
STORE.activeId = String(_savedView.activeId || '');
STORE.grouped = _savedView.grouped !== false;
STORE.collapsedGroups = _savedView.collapsedGroups && typeof _savedView.collapsedGroups === 'object'
  ? _savedView.collapsedGroups
  : {};
function _saveViewState() {
  lsJson.set(_VIEW_LS_KEY, {
    activeId: STORE.activeId,
    grouped: STORE.grouped,
    collapsedGroups: STORE.collapsedGroups,
  });
}

const _PLAYER_VIEWS = new Set(['register', 'gallery', 'relations']);
const _PLAYER_DETAIL_TABS = new Set(['presentation', 'chronicle', 'companions', 'gallery']);

function _playersRouteSub() {
  if (STORE.viewMode === 'gallery') return 'gallery';
  if (STORE.viewMode === 'relations') {
    const selected = STORE.relSelectedId ? `/${encodeURIComponent(STORE.relSelectedId)}` : '';
    return `relations/${STORE.relMode}${selected}`;
  }
  return STORE.activeId ? `register/${STORE.activeId}` : 'register';
}

function _restorePlayersRoute() {
  const [view, first = '', second = ''] = getRouteSub('players').split('/');
  if (!_PLAYER_VIEWS.has(view)) return false;
  STORE.viewMode = view;
  STORE.mobileDetail = false;
  if (view === 'register') {
    if (first) STORE.activeId = first;
    if (_PLAYER_DETAIL_TABS.has(second)) STORE.detailSection = second;
  } else if (view === 'relations') {
    STORE.relMode = first === 'players' ? 'players' : 'characters';
    STORE.relSelectedId = second ? decodeURIComponent(second) : '';
    STORE.relTableId = null;
  }
  return true;
}

function _syncPlayersRoute({ replace = false } = {}) {
  setRouteSub('players', _playersRouteSub(), { replace });
}

document.addEventListener('app:route-sub-changed', event => {
  if (event.detail?.page !== 'players' || !_restorePlayersRoute()) return;
  event.preventDefault();
  if (!STORE.items.some(item => item.id === STORE.activeId)) STORE.activeId = STORE.items[0]?.id || '';
  _refreshView();
});
const _chroniqueCollator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function _chroniqueDateValue(value) {
  const s = String(value || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);

  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const year = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
  return year * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

function _compareMissionsChronoDesc(a, b) {
  const dateA = String(a.date || '').trim();
  const dateB = String(b.date || '').trim();
  if (dateA && dateB) {
    const valueA = _chroniqueDateValue(dateA);
    const valueB = _chroniqueDateValue(dateB);
    if (valueA !== null && valueB !== null && valueA !== valueB) return valueB - valueA;
    const byDateLabel = _chroniqueCollator.compare(dateB, dateA);
    if (byDateLabel) return byDateLabel;
  }

  const orderA = Number.isFinite(Number(a.ordre)) ? Number(a.ordre) : 0;
  const orderB = Number.isFinite(Number(b.ordre)) ? Number(b.ordre) : 0;
  if (orderA !== orderB) return orderB - orderA;

  return _chroniqueCollator.compare(b.titre || '', a.titre || '');
}

// ══════════════════════════════════════════════════════════════════════════════
// DONNÉES — assemblage perso × présentation
// ══════════════════════════════════════════════════════════════════════════════
const _getStat = (c, k) => Math.min(22, (c?.stats?.[k] || 8) + (c?.statsBonus?.[k] || 0));

function _canManageCharacter(char) {
  const uid = STATE.user?.uid || '';
  if (STATE.isAdmin) return true;
  if (!uid || !char) return false;
  return char.uid === uid || (Array.isArray(char.controlDelegates) && char.controlDelegates.includes(uid));
}

function _canManageItem(item) {
  return STATE.isAdmin || _canManageCharacter(item?.char);
}

function _buildRecord(char = null, pres = null) {
  const nom    = char?.nom || 'Personnage';
  const classe = char?.classe?.trim() || pres?.classe?.trim() || '';
  const race   = char?.race?.trim()   || pres?.race?.trim()   || '';
  const joueur = char?.ownerPseudo    || pres?.joueur?.trim() || '';
  const show   = (key, def = true) => pres?.[key] !== undefined ? Boolean(pres[key]) : def;

  return {
    id:             pres?.id || `c:${char?.id || Math.random().toString(36).slice(2)}`,
    presentationId: pres?.id || '',
    charId:         pres?.charId || char?.id || '',
    nom, classe, race, joueur,
    ownerUid:       char?.uid || pres?.uid || '',
    level:          char?.niveau || 1,
    subtitle:       [classe, race].filter(Boolean).join(' · '),
    titles:         char?.titres || [],
    imageUrl:       pres?.imageUrl || char?.photo || '',
    portraitUrl:    char?.photo || pres?.imageUrl || '',
    photoX:         char?.photoX || 0,
    photoY:         char?.photoY || 0,
    // Position de recadrage dans la card du Roster (0-100, défaut 50/50 = centré).
    // Séparé de char?.photoX/Y pour que le PJ puisse avoir un cadrage différent
    // dans sa fiche perso vs sa card de présentation.
    initials:       _initials(nom),
    content:        pres?.content || '',         // rich text HTML
    // Traits = c.tags (source écrite par l'éditeur V3) ; pres.tags (doc players)
    // n'est qu'un fallback legacy — sinon un tags:[] périmé masquait les traits.
    tags:           Array.isArray(char?.tags) ? char.tags : (pres?.tags || []),
    stats:          char ? STAT_META.map(m => ({ ...m, value: _getStat(char, m.key) })) : [],
    // Cadrage de la card du Roster — coords du pan-zoom (4 nombres, ~50 octets).
    // Appliqué via CSS au render → précis ET léger (vs base64 qui faisait
    // dépasser la limite Firestore de 1 MiB par document).
    //   { offX, offY, imgW, imgH }  — fractions relatives au viewport 3:4
    cardCrop:       pres?.cardCrop || null,
    // Galerie unifiée : peut contenir un marqueur {portrait:true} qui sera
    // résolu via imageUrl. Si la galerie n'a jamais été éditée mais qu'il y a
    // une imageUrl, on l'affiche en premier par défaut.
    gallery: (() => {
      const raw = Array.isArray(pres?.gallery) ? pres.gallery : null;
      const imgUrl = pres?.imageUrl || char?.photo || '';
      if (raw) {
        return raw
          .map(g => g?.portrait ? (imgUrl ? { url: imgUrl, isPortrait: true } : null) : g)
          .filter(g => g && g.url);
      }
      return imgUrl ? [{ url: imgUrl, isPortrait: true }] : [];
    })(),
    // Affichage public — flags configurables par presentation
    visible:           show('visible', true),
    afficherPV:        show('afficherPV', true),
    afficherPM:        show('afficherPM', true),
    afficherCA:        show('afficherCA', true),
    afficherOr:        show('afficherOr', false),     // Or masqué par défaut
    afficherStats:     show('afficherStats', true),
    afficherNiveau:    show('afficherNiveau', true),
    afficherEquip:     show('afficherEquip', true),   // équipement
    afficherIdentite:  show('afficherIdentite', true), // Âge / Taille / Yeux…
    afficherCitation:  show('afficherCitation', true), // « citation »
    afficherBio:       show('afficherBio', true),      // biographie rich-text
    afficherTags:      show('afficherTags', true),     // traits de caractère
    // Champs nouveaux propagés depuis le character doc
    quote:    char?.quote || '',
    identity: Array.isArray(char?.identity) ? char.identity : [],
    bio:            pres?.bio?.trim() || char?.bio || '',
    bioPage:        bioPageFor(char) || char?.bioPage || pres?.bioPage || null,
    // Vitaux calculés
    pvActuel:       char?.pvActuel ?? null,
    pvMax:          char ? calcPVMax(char) : null,
    pmActuel:       char?.pmActuel ?? null,
    pmMax:          char ? calcPMMax(char) : null,
    ca:             char ? calcCA(char)    : null,
    vitesse:        char ? calcVitesse(char) : null,
    gold:           char ? calcOr(char)    : null,
    ordre:          pres?.ordre ?? 999,
    char,
  };
}

function _buildDataset(presentations = [], characters = []) {
  const usedPresIds = new Set();
  const byCharId = new Map(presentations.filter(p => p?.charId).map(p => [p.charId, p]));
  const byName   = new Map();
  presentations.forEach(p => {
    const k = _norm(p?.nom); if (!k) return;
    const b = byName.get(k) || []; b.push(p); byName.set(k, b);
  });

  const items = characters.map(c => {
    let p = byCharId.get(c.id) || null;
    if (!p) {
      const m = byName.get(_norm(c.nom)) || [];
      p = m.find(x => !usedPresIds.has(x.id)) || null;
    }
    if (p?.id) usedPresIds.add(p.id);
    return _buildRecord(c, p);
  });
  presentations.filter(p => !usedPresIds.has(p.id)).forEach(p => items.push(_buildRecord(null, p)));

  const lsOrdre = _getLocalOrdre();
  return items
    .filter(item => _canManageItem(item) || item.visible !== false)
    .sort((a, b) => {
      const ao = (a.ordre ?? 999) !== 999 ? a.ordre : (lsOrdre ? (lsOrdre.indexOf(a.id) + 1 || 999) : 999);
      const bo = (b.ordre ?? 999) !== 999 ? b.ordre : (lsOrdre ? (lsOrdre.indexOf(b.id) + 1 || 999) : 999);
      if (ao !== bo) return ao - bo;
      // À ordre égal : joueur alpha → personnage par défaut → nom alpha
      const ja = (a.joueur || '').toLowerCase(), jb = (b.joueur || '').toLowerCase();
      if (ja !== jb) return ja.localeCompare(jb, 'fr');
      const da = a.char?.isDefault ? 0 : 1;
      const db = b.char?.isDefault ? 0 : 1;
      if (da !== db) return da - db;
      return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
    });
}

function _applyFilters(items) {
  const s = _norm(STORE.filterSearch);
  const filtered = items.filter(it => {
    if (s) {
      const hay = _norm([it.nom, it.classe, it.race, it.joueur, (it.tags || []).join(' ')].join(' '));
      if (!hay.includes(s)) return false;
    }
    return true;
  });
  if (STORE.grouped) {
    filtered.sort((a, b) => {
      const aMine = a.ownerUid && a.ownerUid === STATE.user?.uid;
      const bMine = b.ownerUid && b.ownerUid === STATE.user?.uid;
      if (aMine !== bMine) return aMine ? -1 : 1;
      const byPlayer = (a.joueur || 'Sans joueur').localeCompare(b.joueur || 'Sans joueur', 'fr', { sensitivity: 'base' });
      if (byPlayer) return byPlayer;
      const byMain = Number(Boolean(b.char?.isDefault)) - Number(Boolean(a.char?.isDefault));
      if (byMain) return byMain;
      return (Number(b.level) || 0) - (Number(a.level) || 0)
        || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
    });
    return filtered;
  }

  // Hors regroupement, le tri alphabétique est le comportement normal. Le tri
  // manuel reste disponible pour le MJ afin de conserver le drag historique.
  const sortBy = STORE.sortBy;
  if (!sortBy || sortBy === 'nom') {
    filtered.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
  } else if (sortBy !== 'ordre') {
    const cmp = {
      nom:     (a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }),
      niveau:  (a, b) => (b.level || 0) - (a.level || 0) || a.nom.localeCompare(b.nom, 'fr'),
      joueur:  (a, b) => (a.joueur || '').localeCompare(b.joueur || '', 'fr') || a.nom.localeCompare(b.nom, 'fr'),
      classe:  (a, b) => (a.classe || '').localeCompare(b.classe || '', 'fr') || a.nom.localeCompare(b.nom, 'fr'),
    }[sortBy];
    if (cmp) filtered.sort(cmp);
  }
  return filtered;
}

// ── Calcul des missions du PJ (pour la chronologie de fiche) ─────────────────
function _computeRecentMissions(currentCharId, limit = 5) {
  if (!currentCharId || !STORE.story.length) return [];
  const all = STORE.story
    // Une mission n'appartient à la chronique que si un groupe encore existant
    // contient réellement le personnage. Cela écarte les anciennes affectations
    // conservées dans `story.participants` après suppression d'un groupe.
    .filter(ev => _missionGroupsForChar(ev.id, currentCharId).length > 0)
    .sort(_compareMissionsChronoDesc);
  return Number.isFinite(limit) ? all.slice(0, limit) : all;
}

// ── Calcul des partenaires d'aventure (basé sur les quêtes-groupes) ──────────
// Les partenaires sont les personnages qui partagent le MÊME groupe (même quête)
// que le PJ courant. Chaque groupe partagé compte +1.
function _computeTopAdventurers(currentCharId, items, limit = 4) {
  if (!currentCharId) return [];
  const counter = new Map();
  _allGroupMemberLists().forEach(members => {
    if (!members.includes(currentCharId)) return;
    members.forEach(id => {
      if (id === currentCharId) return;
      counter.set(id, (counter.get(id) || 0) + 1);
    });
  });
  return [...counter.entries()]
    .map(([charId, count]) => ({ count, item: items.find(it => it.charId === charId) }))
    .filter(x => x.item)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU — HERO HEADER (compteurs + filtres)
// ══════════════════════════════════════════════════════════════════════════════
function _renderHero(items, filtered, activeItem = null) {
  const joueurs = new Set(items.map(i => i.joueur).filter(Boolean));
  const joueursList = [...joueurs].sort((a, b) => a.localeCompare(b, 'fr'));
  const isFiltered = !!(STORE.filterSearch || STORE.filterJoueur);
  const visibleCount = items.filter(i => i.visible !== false).length;
  const hiddenCount = items.length - visibleCount;
  const linkedCount = items.filter(i => i.charId).length;
  const avgLevel = items.length
    ? Math.round(items.reduce((sum, it) => sum + (Number(it.level) || 0), 0) / items.length)
    : 0;

  return `
  <header class="pp-page-top">
    <div class="pp-page-top-in">
      <div class="pp-page-top-row">
        <div class="pp-page-brand">
          <h1>Joueurs</h1>
          <small>${activeItem
            ? `Profil · ${_esc(activeItem.nom)}`
            : `${items.length} personnage${items.length !== 1 ? 's' : ''} · ${joueurs.size} compte${joueurs.size !== 1 ? 's' : ''}`}</small>
        </div>
        ${activeItem ? '' : `
          <div class="pp-page-stats" aria-label="Résumé des joueurs">
            <span><b>${visibleCount}</b> publié${visibleCount !== 1 ? 's' : ''}</span>
            <span><b>${avgLevel}</b> niveau moyen</span>
            <span><b>${linkedCount}/${items.length}</b> fiche${items.length !== 1 ? 's' : ''} liée${items.length !== 1 ? 's' : ''}</span>
            ${STATE.isAdmin && hiddenCount ? `<span><b>${hiddenCount}</b> masquée${hiddenCount !== 1 ? 's' : ''}</span>` : ''}
          </div>
          ${STATE.isAdmin ? `<button class="pp-action-primary" data-pp-action="newPlayer">${_ppIcon('plus')} Présentation</button>` : ''}`}
      </div>
      ${activeItem ? '' : `<div class="pp-filters">
      <div class="pp-filter-search">
        <span class="pp-filter-icon">${_ppIcon('search')}</span>
        <input type="text" placeholder="Rechercher un nom, une classe, un trait…"
          value="${_esc(STORE.filterSearch || '')}"
          data-pp-action="search" data-pp-on="input">
        ${STORE.filterSearch ? `<button class="pp-filter-clear" data-pp-action="clearSearch" title="Effacer">${_ppIcon('x')}</button>` : ''}
      </div>
      ${joueursList.length > 1 ? `
        <select class="pp-filter-select" data-pp-action="setJoueur" data-pp-on="change" aria-label="Filtrer par joueur">
          <option value="">Tous les joueurs</option>
          ${joueursList.map(j => `<option value="${_esc(j)}" ${STORE.filterJoueur===j?'selected':''}>${_esc(j)}</option>`).join('')}
        </select>` : ''}
      <select class="pp-filter-select" data-pp-action="setSort" data-pp-on="change" aria-label="Trier par" title="Trier le sommaire">
        <option value="ordre"  ${STORE.sortBy==='ordre' ?'selected':''}>Ordre manuel</option>
        <option value="nom"    ${STORE.sortBy==='nom'   ?'selected':''}>Nom A-Z</option>
        <option value="niveau" ${STORE.sortBy==='niveau'?'selected':''}>Niveau</option>
        <option value="joueur" ${STORE.sortBy==='joueur'?'selected':''}>Joueur</option>
        <option value="classe" ${STORE.sortBy==='classe'?'selected':''}>Classe</option>
      </select>
      ${isFiltered ? `<button class="pp-filter-reset" data-pp-action="resetFilters" title="Réinitialiser tous les filtres">${_ppIcon('reset')} Réinitialiser</button>` : ''}
      <div class="pp-view-toggle" role="tablist" aria-label="Mode d'affichage">
        <button class="pp-view-tab ${STORE.viewMode==='gallery'?'is-active':''}"
          data-pp-action="setViewMode" data-mode="gallery" title="Galerie de cards" role="tab"
          aria-selected="${STORE.viewMode === 'gallery'}">${_ppIcon('cards')} Galerie</button>
        <button class="pp-view-tab ${STORE.viewMode==='relations'?'is-active':''}"
          data-pp-action="setViewMode" data-mode="relations" title="Carte des liens d'aventure" role="tab"
          aria-selected="${STORE.viewMode === 'relations'}">${_ppIcon('relations')} Relations</button>
      </div>
    </div>`}

    ${!activeItem && isFiltered ? `
      <div class="pp-filter-meta">
        ${filtered.length} résultat${filtered.length>1?'s':''} sur ${items.length}
      </div>` : ''}
    </div>
  </header>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU — CARTE IMMERSIVE DANS LA GALERIE
// ══════════════════════════════════════════════════════════════════════════════
function _renderCard(item, idx) {
  const col = _accentColor(item.nom);
  const locked = !item.content && !item.bio && !item.portraitUrl && !item.imageUrl;
  const hidden = item.visible === false;
  const isAdmin = STATE.isAdmin;
  const canManage = _canManageItem(item);

  // Image affichée dans la card : utilise imageUrl avec un crop CSS optionnel.
  // Le cadrage admin (pan-zoom) génère { offX, offY, imgW } qu'on applique en CSS.
  const cardImg = item.imageUrl || '';
  const cc = item.cardCrop;
  // Style positionnement de l'image dans la card. Si pas de cardCrop : cover.
  const cardImgStyle = cc
    ? `position:absolute;left:${(cc.offX*100).toFixed(2)}%;top:${(cc.offY*100).toFixed(2)}%;width:${(cc.imgW*100).toFixed(2)}%;height:auto;max-width:none`
    : 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';

  // Vitaux exacts : visibles uniquement par le MJ sur cette page publique.
  const vitaux = STATE.isAdmin ? [
    item.afficherPV && item.pvMax !== null
      ? `<span class="pp-card-vital pp-card-vital--pv">${_ppIcon('heart')} <b>${item.pvActuel ?? item.pvMax}</b><small>/${item.pvMax} PV</small></span>` : '',
    item.afficherPM && item.pmMax !== null
      ? `<span class="pp-card-vital pp-card-vital--pm">${_ppIcon('spark')} <b>${item.pmActuel ?? item.pmMax}</b><small>/${item.pmMax} PM</small></span>` : '',
    item.afficherCA && item.ca !== null
      ? `<span class="pp-card-vital pp-card-vital--ca">${_ppIcon('shield')} <b>${item.ca}</b><small>CA</small></span>` : '',
    item.afficherOr && item.gold !== null
      ? `<span class="pp-card-vital pp-card-vital--or">${_ppIcon('coin')} <b>${item.gold}</b><small>or</small></span>` : '',
  ].filter(Boolean) : [];

  // Tags max 2 visibles (gain de place — détaillés sur la fiche)
  const tagsHtml = (item.tags || []).slice(0, 2).map(t => {
    const [bg, bc, c] = _tagColor(t);
    return `<span class="pp-card-tag" style="background:${bg};border-color:${bc};color:${c}">${_esc(t)}</span>`;
  }).join('') + ((item.tags || []).length > 2
    ? `<span class="pp-card-tag pp-card-tag--more">+${(item.tags || []).length - 2}</span>` : '');

  return `
  <article class="pp-card${hidden?' is-hidden':''}${locked?' is-locked':''}" data-pp-id="${_esc(item.id)}"
    style="--card-accent:${col}">
    ${isAdmin ? `<div class="pp-card-drag" title="Réordonner">${_ppIcon('grip')}</div>` : ''}
    ${canManage ? `
      <div class="pp-card-admin">
        <button class="pp-card-admin-btn" title="${hidden?'Afficher':'Masquer'} aux joueurs"
          data-pp-action="toggleVisible" data-id="${_esc(item.id)}">${_ppIcon(hidden ? 'eyeOff' : 'eye')}</button>
        <button class="pp-card-admin-btn" title="Modifier"
          data-pp-action="editItem" data-id="${_esc(item.id)}">${_ppIcon('edit')}</button>
      </div>` : ''}

    <button class="pp-card-clickarea" data-pp-action="openFiche" data-id="${_esc(item.id)}">
      <!-- Image — prend tout l'espace de la card (ratio 3:4).
           Le cadrage admin (pan-zoom) sauvegarde les coords dans cardCrop
           qu'on applique en CSS inline. Aucun stockage de base64 dupliqué. -->
      <div class="pp-card-image-wrap">
        ${cardImg
          ? `<img class="pp-card-image" src="${_esc(cardImg)}" alt="Portrait de ${_esc(item.nom || 'ce personnage')}" style="${cardImgStyle}"
              loading="lazy" decoding="async" referrerpolicy="no-referrer">`
          : `<div class="pp-card-image-empty">${item.initials}</div>`}
        <!-- Badges flottants -->
        ${item.afficherNiveau ? `<span class="pp-card-level">Niv. ${item.level}</span>` : ''}
        ${hidden ? `<span class="pp-card-hidden-badge">${_ppIcon('lock')} Masqué</span>` : ''}
      </div>

      <!-- Panneau info net en bas (style trading card) -->
      <div class="pp-card-panel">
        <h3 class="pp-card-name" title="${_esc(item.nom)}">${_esc(item.nom)}</h3>
        ${item.subtitle ? `<div class="pp-card-subtitle">${_esc(item.subtitle)}</div>` : ''}
        ${item.joueur ? `<div class="pp-card-joueur">${_esc(item.joueur)}</div>` : ''}
        ${vitaux.length ? `<div class="pp-card-vitals">${vitaux.join('')}</div>` : ''}
        ${tagsHtml ? `<div class="pp-card-tags">${tagsHtml}</div>` : ''}
      </div>
    </button>
  </article>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU — SOMMAIRE (galerie de cards filtrables)
// ══════════════════════════════════════════════════════════════════════════════
function _renderSommaire(items) {
  const filtered = _applyFilters(items);

  if (!filtered.length) {
    return `
      <div class="pp-empty">
        <div class="pp-empty-icon">${_ppIcon('search')}</div>
        <p class="pp-empty-title">Aucun personnage ne correspond à ta recherche.</p>
        <p class="pp-empty-sub">Essaie de modifier les filtres ou de les réinitialiser.</p>
      </div>`;
  }

  if (STORE.viewMode === 'relations') {
    return _renderRelationsScreen(filtered);
  }

  return `
    <div id="pp-gallery" class="pp-gallery">
      ${filtered.map((it, idx) => _renderCard(it, idx)).join('')}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RELATIONS — graphe pur, tablées et layout déterministe
// ══════════════════════════════════════════════════════════════════════════════
const RELATION_TABLE_COLORS = [
  'oklch(.72 .13 250)', 'oklch(.74 .14 160)', 'oklch(.8 .13 80)',
  'oklch(.7 .15 20)', 'oklch(.72 .13 310)',
];
const _relationLayoutCache = new Map();
const _relationViewports = new Map();
let _relationPanSuppressUntil = 0;

function _relationViewport(mode = STORE.relMode) {
  if (!_relationViewports.has(mode)) _relationViewports.set(mode, { x: 0, y: 0, width: 1000, height: 680 });
  return _relationViewports.get(mode);
}

function _clampRelationViewport(viewport) {
  const width = Math.max(280, Math.min(1250, Number(viewport.width) || 1000));
  const height = width * .68;
  return {
    x: Math.max(-250, Math.min(1250 - width, Number(viewport.x) || 0)),
    y: Math.max(-170, Math.min(850 - height, Number(viewport.y) || 0)),
    width,
    height,
  };
}

function _applyRelationViewport() {
  const svg = document.getElementById('pp-rel-net');
  if (!svg) return;
  const viewport = _relationViewport();
  svg.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
  _fitRelationText();
}

function _zoomRelation(factor, focus = null) {
  const current = _relationViewport();
  const nextWidth = Math.max(280, Math.min(1250, current.width * factor));
  const nextHeight = nextWidth * .68;
  const point = focus || { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  const ratioX = (point.x - current.x) / current.width;
  const ratioY = (point.y - current.y) / current.height;
  _relationViewports.set(STORE.relMode, _clampRelationViewport({
    x: point.x - ratioX * nextWidth,
    y: point.y - ratioY * nextHeight,
    width: nextWidth,
  }));
  _applyRelationViewport();
}

export function _relationGraph(items = [], mode = 'characters', groupLists = _allGroupMemberLists()) {
  const visibleItems = items.filter(item => item?.charId);
  const byCharId = new Map(visibleItems.map(item => [item.charId, item]));
  const primaryByPlayer = new Map();
  visibleItems.forEach(item => {
    const key = _playerKey(item);
    const current = primaryByPlayer.get(key);
    if (!current || item.char?.isDefault) primaryByPlayer.set(key, item);
  });

  const nodesById = new Map();
  if (mode === 'players') {
    visibleItems.forEach(item => {
      const id = _playerKey(item);
      if (!nodesById.has(id)) {
        nodesById.set(id, {
          id,
          label: item.joueur || 'Sans joueur',
          sub: '',
          accent: _accentColor(item.joueur || item.nom),
          items: [],
          item: null,
          deg: 0,
          w: 0,
          adv: 0,
        });
      }
      nodesById.get(id).items.push(item);
    });
    nodesById.forEach(node => {
      node.items.sort((a, b) => Number(Boolean(b.char?.isDefault)) - Number(Boolean(a.char?.isDefault))
        || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
      node.item = node.items.find(item => item.char?.isDefault) || node.items[0] || null;
      node.sub = node.items.map(item => item.nom).join(', ');
    });
  } else {
    visibleItems.forEach(item => {
      const playerKey = _playerKey(item);
      nodesById.set(item.charId, {
        id: item.charId,
        label: item.nom,
        sub: [item.classe, item.joueur].filter(Boolean).join(' · '),
        accent: _accentColor(item.nom),
        item,
        items: [item],
        secondary: primaryByPlayer.get(playerKey)?.charId !== item.charId,
        deg: 0,
        w: 0,
        adv: 0,
      });
    });
  }

  const edgeWeights = new Map();
  const keyForChar = charId => {
    const item = byCharId.get(charId);
    return item ? (mode === 'players' ? _playerKey(item) : charId) : '';
  };
  for (const members of groupLists) {
    const ids = [...new Set(members.map(keyForChar).filter(id => id && nodesById.has(id)))].sort();
    ids.forEach(id => { nodesById.get(id).adv += 1; });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}\u0000${ids[j]}`;
        edgeWeights.set(key, (edgeWeights.get(key) || 0) + 1);
      }
    }
  }

  const edges = [...edgeWeights.entries()].map(([key, n]) => {
    const [a, b] = key.split('\u0000');
    return { a, b, n };
  }).sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
  edges.forEach(edge => {
    const a = nodesById.get(edge.a);
    const b = nodesById.get(edge.b);
    if (!a || !b) return;
    a.deg += 1; b.deg += 1;
    a.w += edge.n; b.w += edge.n;
  });
  const nodes = [...nodesById.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  return {
    mode,
    nodes,
    edges,
    nodeById: new Map(nodes.map(node => [node.id, node])),
    total: nodes.length * (nodes.length - 1) / 2,
  };
}

export function _detectTables(graph) {
  const nodes = graph?.nodes || [];
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const labels = nodes.map((_, i) => i);
  const neighbours = nodes.map(() => []);
  (graph?.edges || []).forEach(edge => {
    const a = index.get(edge.a), b = index.get(edge.b);
    if (a === undefined || b === undefined) return;
    neighbours[a].push([b, edge.n]);
    neighbours[b].push([a, edge.n]);
  });
  for (let iteration = 0; iteration < 12; iteration++) {
    nodes.forEach((_, i) => {
      const scores = new Map();
      neighbours[i].forEach(([other, weight]) => scores.set(labels[other], (scores.get(labels[other]) || 0) + weight));
      let best = labels[i], bestWeight = -1;
      [...scores.entries()].sort((a, b) => a[0] - b[0]).forEach(([label, weight]) => {
        if (weight > bestWeight || (weight === bestWeight && label < best)) {
          best = label;
          bestWeight = weight;
        }
      });
      labels[i] = best;
    });
  }
  const groups = new Map();
  labels.forEach((label, i) => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(nodes[i]);
  });
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .map(([, members], id) => {
      const memberIds = members.map(member => member.id);
      const memberSet = new Set(memberIds);
      const core = [...members].sort((a, b) => b.w - a.w || a.label.localeCompare(b.label, 'fr'))[0];
      const internal = (graph.edges || []).filter(edge => memberSet.has(edge.a) && memberSet.has(edge.b))
        .reduce((sum, edge) => sum + edge.n, 0);
      return { id, color: RELATION_TABLE_COLORS[id % RELATION_TABLE_COLORS.length], memberIds, coreId: core.id, internal };
    });
}

export function _bridgeNodes(graph, tables = graph?.tables || _detectTables(graph)) {
  const tableByNode = new Map();
  tables.forEach(table => table.memberIds.forEach(id => tableByNode.set(id, table.id)));
  return (graph?.nodes || []).map(node => {
    const own = tableByNode.get(node.id);
    const otherTables = new Set();
    (graph.edges || []).forEach(edge => {
      const otherId = edge.a === node.id ? edge.b : edge.b === node.id ? edge.a : '';
      if (!otherId) return;
      const tableId = tableByNode.get(otherId);
      if (tableId !== undefined && tableId !== own) otherTables.add(tableId);
    });
    return { id: node.id, tableIds: [...otherTables].sort((a, b) => a - b), count: otherTables.size };
  }).filter(bridge => bridge.count >= 2);
}

function _relationLayout(graph) {
  const signature = `${graph.mode}|${graph.nodes.map(node => node.id).join(',')}|${graph.edges.map(edge => `${edge.a}:${edge.b}:${edge.n}`).join(',')}`;
  const cached = _relationLayoutCache.get(signature);
  if (cached) return cached;
  if (!graph.nodes.length) return new Map();
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const width = 1000, height = 680, count = graph.nodes.length;
  const k = Math.sqrt(width * height / count) * .78;
  const points = graph.nodes.map((node, i) => {
    const angle = i / count * Math.PI * 2 + Math.max(0, node.tableId ?? 0);
    return { id: node.id, x: width / 2 + Math.cos(angle) * 260 + (random() - .5) * 80, y: height / 2 + Math.sin(angle) * 200 + (random() - .5) * 80 };
  });
  const pointById = new Map(points.map((point, i) => [point.id, i]));
  for (let iteration = 0, temperature = 60; iteration < 420; iteration++, temperature *= .992) {
    const delta = points.map(() => [0, 0]);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
        const length = Math.hypot(dx, dy) || .01, force = k * k / length;
        dx /= length; dy /= length;
        delta[i][0] += dx * force; delta[i][1] += dy * force;
        delta[j][0] -= dx * force; delta[j][1] -= dy * force;
      }
    }
    graph.edges.forEach(edge => {
      const i = pointById.get(edge.a), j = pointById.get(edge.b);
      if (i === undefined || j === undefined) return;
      let dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
      const length = Math.hypot(dx, dy) || .01;
      const force = length * length / k * (.2 + Math.min(edge.n, 6) * .1);
      dx /= length; dy /= length;
      delta[i][0] -= dx * force; delta[i][1] -= dy * force;
      delta[j][0] += dx * force; delta[j][1] += dy * force;
    });
    points.forEach((point, i) => {
      delta[i][0] += (width / 2 - point.x) * .55;
      delta[i][1] += (height / 2 - point.y) * .75;
      const length = Math.hypot(delta[i][0], delta[i][1]) || .01;
      point.x += delta[i][0] / length * Math.min(length, temperature);
      point.y += delta[i][1] / length * Math.min(length, temperature);
    });
  }
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 120) / (maxX - minX || 1), (height - 110) / (maxY - minY || 1));
  points.forEach(point => {
    point.x = 60 + (point.x - minX) * scale + ((width - 120) - (maxX - minX) * scale) / 2;
    point.y = 45 + (point.y - minY) * scale + ((height - 110) - (maxY - minY) * scale) / 2;
  });

  // La simulation de forces rapproche volontairement les partenaires, mais ne
  // connaît ni les portraits ni la largeur des noms. Cette seconde passe traite
  // chaque nœud comme une ellipse et garantit une vraie zone de lecture.
  for (let iteration = 0; iteration < 150; iteration++) {
    let moved = false;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
        const labelA = graph.nodes[i]?.label?.length || 1;
        const labelB = graph.nodes[j]?.label?.length || 1;
        const minDx = Math.max(92, Math.min(142, 48 + (labelA + labelB) * 3.1));
        const minDy = 72;
        let distance = Math.hypot(dx / minDx, dy / minDy);
        if (distance >= 1) continue;
        if (distance < .001) {
          const angle = ((i * 37 + j * 61) % 360) * Math.PI / 180;
          dx = Math.cos(angle) * .01;
          dy = Math.sin(angle) * .01;
          distance = .001;
        }
        const angle = Math.atan2(dy / minDy, dx / minDx);
        const overlap = (1 - distance) * .52;
        const pushX = Math.cos(angle) * minDx * overlap;
        const pushY = Math.sin(angle) * minDy * overlap;
        points[i].x += pushX; points[i].y += pushY;
        points[j].x -= pushX; points[j].y -= pushY;
        moved = true;
      }
    }
    points.forEach(point => {
      point.x = Math.max(48, Math.min(width - 48, point.x));
      point.y = Math.max(38, Math.min(height - 62, point.y));
    });
    if (!moved) break;
  }
  const result = new Map(points.map(point => [point.id, { x: point.x, y: point.y }]));
  _relationLayoutCache.set(signature, result);
  return result;
}

function _prepareRelationGraph(items) {
  const graph = _relationGraph(items, STORE.relMode, _allGroupMemberLists());
  graph.tables = _detectTables(graph);
  const tableByNode = new Map();
  graph.tables.forEach(table => table.memberIds.forEach(id => tableByNode.set(id, table.id)));
  const bridgeByNode = new Map(_bridgeNodes(graph, graph.tables).map(bridge => [bridge.id, bridge]));
  graph.nodes.forEach(node => {
    node.tableId = tableByNode.has(node.id) ? tableByNode.get(node.id) : -1;
    node.bridge = bridgeByNode.get(node.id) || null;
  });
  graph.layout = _relationLayout(graph);
  return graph;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU — FICHE NARRATIVE DÉTAILLÉE (hero immersif + 2 colonnes)
// ══════════════════════════════════════════════════════════════════════════════
function _renderFiche(item, items) {
  const col = _accentColor(item.nom);

  // ── Strip de navigation : portrait + nom pour chaque PJ (style Bestiaire) ─
  const stripHtml = `
    <div class="pp-fiche-strip" role="tablist" aria-label="Naviguer entre les personnages">
      ${items.map(it => {
        const active = it.id === item.id;
        const c = it.char || {};
        const photo = c.photo || it.imageUrl || '';
        const accent = _accentColor(it.nom);
        const portrait = characterPortraitContent({ ...c, photo, nom: it.nom }, {
          fallbackTag: 'div',
          fallbackClass: 'pp-strip-portrait-empty',
          fallbackStyle: `--accent:${accent}`,
        });
        return `<button type="button" class="pp-strip-item ${active ? 'is-active' : ''}"
          data-pp-action="openFiche" data-id="${_esc(it.id)}"
          style="--accent:${accent}" role="tab" aria-selected="${active}"
          title="${_esc(it.nom)}">
          <div class="pp-strip-portrait">${portrait}</div>
          <div class="pp-strip-name">${_esc(it.nom)}</div>
        </button>`;
      }).join('')}
    </div>`;

  // ── Vitaux affichés sous l'image ─────────────────────────────────────
  const vitaux = STATE.isAdmin ? [
    item.afficherPV && item.pvMax !== null
      ? `<div class="pp-vital pp-vital--pv"><div class="pp-vital-lbl">PV</div><div class="pp-vital-val">${item.pvActuel ?? item.pvMax}<small>/${item.pvMax}</small></div></div>` : '',
    item.afficherPM && item.pmMax !== null
      ? `<div class="pp-vital pp-vital--pm"><div class="pp-vital-lbl">PM</div><div class="pp-vital-val">${item.pmActuel ?? item.pmMax}<small>/${item.pmMax}</small></div></div>` : '',
    item.afficherCA && item.ca !== null
      ? `<div class="pp-vital pp-vital--ca"><div class="pp-vital-lbl">CA</div><div class="pp-vital-val">${item.ca}</div></div>` : '',
    item.afficherOr && item.gold !== null
      ? `<div class="pp-vital pp-vital--or"><div class="pp-vital-lbl">Or</div><div class="pp-vital-val">${item.gold}</div></div>` : '',
  ].filter(Boolean) : [];

  // ── Tags purement informatifs ────────────────────────────────────────
  const tagsHtml = (item.tags || []).length
    ? (item.afficherTags ? `<div class="pp-fiche-tags">
        ${item.tags.map(t => {
          const [bg, bc, c] = _tagColor(t);
          return `<span class="pp-tag-chip pp-tag-chip--view"
            style="background:${bg};border-color:${bc};color:${c}">${_esc(t)}</span>`;
        }).join('')}
      </div>` : '') : '';

  // Citation (item.afficherCitation)
  const citationHtml = item.afficherCitation && item.quote
    ? `<div class="pp-fiche-quote">« ${_esc(item.quote)} »</div>`
    : '';

  // Identité (Âge / Taille / Yeux / etc.) — accepte legacy [[k,v]] et [{k,v}]
  const identityNorm = (item.identity || []).map(e => {
    if (Array.isArray(e)) return { k: String(e[0] || ''), v: String(e[1] || '') };
    if (e && typeof e === 'object' && e.k) return { k: String(e.k), v: String(e.v || '') };
    return null;
  }).filter(e => e && e.v);
  const identityHtml = item.afficherIdentite && identityNorm.length
    ? `<section class="pp-fiche-card">
        <h3 class="pp-fiche-card-title">${_ppIcon('user')} Identité</h3>
        <div class="pp-fiche-identity-list">
          ${identityNorm.map(({ k, v }) => `<div class="pp-fiche-identity-row">
            <span class="pp-fiche-identity-k">${_esc(k)}</span>
            <span class="pp-fiche-identity-v">${_esc(v)}</span>
          </div>`).join('')}
        </div>
      </section>` : '';

  const titlesHtml = item.titles.length
    ? `<div class="pp-fiche-titles">
        ${item.titles.slice(0, 6).map(t => `<span class="pp-fiche-title">${_esc(t)}</span>`).join('')}
      </div>` : '';

  const narrative = item.afficherBio
    ? (hasFreePage(item.bioPage)
        ? renderFreePageHtml({ page: item.bioPage, className: 'pp-free-page' })
        : item.content
        ? richTextContentHtml({ html: item.content, className: 'pp-rich-content' })
        : item.bio
          ? `<div class="pp-bio-legacy">${_nl2br(item.bio)}</div>`
          : `<div class="pp-narrative-empty">Aucune présentation pour ce personnage pour l'instant.</div>`)
    : `<div class="pp-narrative-empty">Biographie masquée par le PJ.</div>`;

  // ── Sections sidebar (stats / équipement / hauts-faits / partenaires) ─
  const statsHtml = item.afficherStats && item.stats.length
    ? `<section class="pp-fiche-card">
        <h3 class="pp-fiche-card-title">${_ppIcon('spark')} Profil de stats</h3>
        ${_renderStatsHexagon(item.stats)}
      </section>` : '';

  const equipHtml = item.afficherEquip && item.char ? _renderEquipBlock(item.char) : '';
  const achievementsHtml = _renderAchievementsBlock(item);
  const partenairesHtml = _renderTopAdventurersBlock(item, items);
  const chroniqueHtml = _renderChroniqueBlock(item);
  const galleryHtml = _renderGalleryBlock(item);

  // ── Image entière à gauche : ratio NATUREL préservé (pas de crop).
  //    L'image affiche le personnage de haut en bas en entier comme une affiche.
  const imageBlockHtml = item.imageUrl
    ? `<img class="pp-fiche-portrait" src="${_esc(item.imageUrl)}" alt="${_esc(item.nom)}">`
    : `<div class="pp-fiche-portrait pp-fiche-portrait-empty">${item.initials}</div>`;
  const profileCharId = item.char?.id || item.charId;
  const profileMissionCount = profileCharId ? _computeRecentMissions(profileCharId, Infinity).length : 0;
  const profileAchievementCount = profileCharId
    ? STORE.achievements.filter(a => (a.contributeurs || []).includes(profileCharId)).length
    : 0;
  const profilePartnerCount = profileCharId ? _computeTopAdventurers(profileCharId, items, 99).length : 0;
  const overviewHtml = `
    <div class="pp-profile-overview">
      <div class="pp-profile-overview-item">
        <strong>${profileMissionCount}</strong>
        <span>Aventure${profileMissionCount>1?'s':''}</span>
      </div>
      <div class="pp-profile-overview-item">
        <strong>${profileAchievementCount}</strong>
        <span>Haut${profileAchievementCount>1?'s':''}-fait${profileAchievementCount>1?'s':''}</span>
      </div>
      <div class="pp-profile-overview-item">
        <strong>${profilePartnerCount}</strong>
        <span>Partenaire${profilePartnerCount>1?'s':''}</span>
      </div>
    </div>`;

  return `
  <div class="pp-fiche" style="--fiche-accent:${col}">

    <!-- Toolbar sticky : retour + édition admin + strip de navigation -->
    <nav class="pp-fiche-toolbar">
      <button class="pp-toolbar-back" data-pp-action="back">
        ${_ppIcon('arrowLeft')}
        <span class="pp-toolbar-back-text">Roster</span>
      </button>
      ${stripHtml}
      ${_canManageItem(item)
        ? `<button class="pp-toolbar-edit" data-pp-action="editItem" data-id="${_esc(item.id)}">${_ppIcon('edit')} Modifier</button>`
        : ''}
    </nav>

    <!-- Badge masqué (admin) -->
    ${STATE.isAdmin && !item.visible
      ? `<div class="pp-fiche-hidden-banner">${_ppIcon('lock')} Cette présentation est masquée aux joueurs</div>`
      : ''}

    <!-- Layout principal 2 colonnes -->
    <div class="pp-fiche-layout">

      <!-- Colonne gauche : portrait entier + meta sous l'image -->
      <div class="pp-fiche-left">
        <div class="pp-fiche-portrait-frame">
          ${imageBlockHtml}
        </div>

        <!-- Bloc identité sous le portrait -->
        <div class="pp-fiche-identity">
          <h1 class="pp-fiche-name">${_esc(item.nom)}</h1>
          ${item.subtitle ? `<div class="pp-fiche-subtitle">${_esc(item.subtitle)}</div>` : ''}
          <div class="pp-fiche-meta">
            ${item.joueur ? `<span class="pp-fiche-meta-item">${_ppIcon('user')} ${_esc(item.joueur)}</span>` : ''}
            ${profileCharId ? `<span class="pp-fiche-meta-item">${_ppIcon('cards')} Fiche liée</span>` : ''}
            ${item.visible === false
              ? `<span class="pp-fiche-meta-item pp-fiche-meta-item--hidden">${_ppIcon('eyeOff')} Masquée</span>`
              : `<span class="pp-fiche-meta-item">${_ppIcon('eye')} Publiée</span>`}
            ${item.afficherNiveau ? `<span class="pp-fiche-level">Niv. ${item.level}</span>` : ''}
          </div>
          ${titlesHtml}
          ${tagsHtml}
          ${citationHtml}
          ${overviewHtml}
          ${vitaux.length ? `<div class="pp-fiche-vitals">${vitaux.join('')}</div>` : ''}
        </div>
      </div>

      <!-- Colonne centrale : narratif principal -->
      <div class="pp-fiche-narrative-col">
        ${item.afficherBio ? `<section class="pp-fiche-card pp-fiche-narrative">
          <h3 class="pp-fiche-card-title">${_ppIcon('book')} Présentation</h3>
          ${narrative}
        </section>` : ''}

        ${galleryHtml}
        ${chroniqueHtml}
        ${partenairesHtml}
      </div>

      <!-- Colonne droite (ou en dessous sur petit écran) : sidebar stats -->
      <aside class="pp-fiche-sidebar-col">
        ${statsHtml}
        ${identityHtml}
        ${equipHtml}
        ${achievementsHtml}
      </aside>
    </div>
  </div>`;
}

// ── Hexagone des stats (SVG radar) ───────────────────────────────────────────
// Présentation classique RPG : 6 axes (FOR DEX CON INT SAG CHA), polygone des
// valeurs superposé sur la grille hexagonale. Plus visuel et lisible que les
// barres horizontales.
function _renderStatsHexagon(stats, opts = {}) {
  const STAT_MAX = 22;
  const statList = (stats || []).map(s => ({
    ...s,
    value: Number(s.value) || 0,
    mod: getModFromScore(Number(s.value) || 0),
  }));
  if (!statList.length) return '';

  const orderedStats = [...statList].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'fr'));
  const strongest = orderedStats[0];
  const weakest = orderedStats[orderedStats.length - 1];
  const average = Math.round(statList.reduce((sum, s) => sum + s.value, 0) / statList.length);
  const averageMod = getModFromScore(average);

  return `
    <div class="pp-stat-profile">
      <div class="pp-stat-profile-top">
        <div class="pp-stat-focus" style="--stat-color:${strongest.color}">
          <span>Point fort</span>
          <strong>${_esc(strongest.label)}</strong>
          <em>${strongest.value} · ${modStr(strongest.mod)}</em>
        </div>
        <div class="pp-stat-focus pp-stat-focus--quiet" style="--stat-color:${weakest.color}">
          <span>Moyenne</span>
          <strong>${average}</strong>
          <em>${modStr(averageMod)}</em>
        </div>
      </div>
      <div class="pp-stat-lines">
        ${statList.map(s => {
          const pct = Math.max(0, Math.min(100, Math.round((s.value / STAT_MAX) * 100)));
          return `<div class="pp-stat-line" style="--stat-color:${s.color};--stat-pct:${pct}%">
            <div class="pp-stat-line-head">
              <span class="pp-stat-name">${_esc(s.label)}</span>
              <span class="pp-stat-score">${s.value}</span>
              <span class="pp-stat-mod">${modStr(s.mod)}</span>
            </div>
            <div class="pp-stat-track" aria-hidden="true"><span></span></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  const size = opts.size || 260;
  const cx = size / 2, cy = size / 2;
  const R  = size * 0.36;          // rayon des axes
  const RL = size * 0.40;          // rayon labels (garde la valeur CON dans le SVG)
  const MAX = 22;                   // valeur max d'une stat (cap)
  const n = stats.length || 6;
  const angleAt = (i) => (-Math.PI / 2) + (i * 2 * Math.PI / n);

  // Grille hexagonale (4 niveaux : 25/50/75/100% de MAX)
  const gridLevels = [0.25, 0.5, 0.75, 1];
  const gridPolys = gridLevels.map((lvl, lvlIdx) => {
    const pts = stats.map((_, i) => {
      const a = angleAt(i);
      return `${cx + R * lvl * Math.cos(a)},${cy + R * lvl * Math.sin(a)}`;
    }).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="var(--border)" stroke-width="1" opacity="${0.18 + lvl * 0.15}" class="pp-hex-grid-${lvlIdx}"/>`;
  }).join('');

  // Axes (lignes du centre vers chaque sommet)
  const axes = stats.map((_, i) => {
    const a = angleAt(i);
    const x = cx + R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--border)" stroke-width="1" opacity=".3"/>`;
  }).join('');

  // Polygone des valeurs — pré-calculé
  const points = stats.map((s, i) => {
    const a = angleAt(i);
    const r = R * Math.min(1, (s.value || 0) / MAX);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), s, i };
  });
  const dataPtsStr = points.map(p => `${p.x},${p.y}`).join(' ');

  // Approxime le périmètre du polygone pour l'animation stroke-dashoffset
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    perimeter += Math.hypot(next.x - points[i].x, next.y - points[i].y);
  }

  // Sommets interactifs : cercle invisible large pour faciliter le hover
  const dataDots = points.map((p, i) => {
    const s = p.s;
    return `<g class="pp-hex-point" data-stat-idx="${i}">
      <!-- hit area étendue pour faciliter le hover -->
      <circle cx="${p.x}" cy="${p.y}" r="14" fill="transparent" pointer-events="all"/>
      <!-- point visible -->
      <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${s.color}" stroke="var(--bg-card)" stroke-width="2.5"
        class="pp-hex-dot" style="--dot-color:${s.color}"/>
    </g>`;
  }).join('');

  // Labels aux sommets
  const labels = stats.map((s, i) => {
    const a = angleAt(i);
    const x = cx + RL * Math.cos(a);
    const y = cy + RL * Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle'
                 : Math.cos(a) > 0 ? 'start' : 'end';
    const dy = Math.sin(a) > 0.5 ? '.85em' : Math.sin(a) < -0.5 ? '-.1em' : '.3em';
    return `<g class="pp-hex-label" data-stat-idx="${i}">
      <text x="${x}" y="${y}" dy="${dy}" text-anchor="${anchor}"
        font-family="Cinzel, serif" font-size="11" font-weight="700"
        fill="${s.color}">${s.label.slice(0,3).toUpperCase()}</text>
      <text x="${x}" y="${y}" dy="${dy}" text-anchor="${anchor}"
        font-size="10" font-weight="600" opacity=".75"
        transform="translate(0,13)" fill="var(--text-muted)"
        class="pp-hex-label-val">${s.value}</text>
    </g>`;
  }).join('');

  // Gradient or atténué
  const grad = `<defs>
    <radialGradient id="pp-hex-grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--gold)" stop-opacity=".40"/>
      <stop offset="100%" stop-color="var(--gold)" stop-opacity=".12"/>
    </radialGradient>
  </defs>`;

  // Données sérialisées pour le tooltip JS
  const statsJson = JSON.stringify(stats.map(s => ({ label: s.label, value: s.value, color: s.color })));

  return `
    <div class="pp-stats-hex-wrap" data-pp-hex-stats='${_esc(statsJson)}'>
      <svg viewBox="0 0 ${size} ${size}" class="pp-stats-hex" preserveAspectRatio="xMidYMid meet">
        ${grad}
        ${gridPolys}
        ${axes}
        <polygon points="${dataPtsStr}"
          fill="url(#pp-hex-grad)"
          stroke="var(--gold)" stroke-width="2.5" stroke-linejoin="round"
          class="pp-hex-poly"
          style="--hex-perim:${perimeter.toFixed(1)}"/>
        ${dataDots}
        ${labels}
      </svg>
      <div class="pp-hex-tooltip" data-pp-hex-tooltip></div>
    </div>`;
}

// Setup tooltips interactifs sur les hexagones (appelé après render)
function _bindHexagonTooltips() {
  document.querySelectorAll('[data-pp-hex-stats]').forEach(wrap => {
    if (wrap._hexBound) return;
    wrap._hexBound = true;
    const stats = JSON.parse(wrap.dataset.ppHexStats || '[]');
    const tooltip = wrap.querySelector('[data-pp-hex-tooltip]');
    const showTip = (idx, x, y) => {
      const s = stats[idx]; if (!s || !tooltip) return;
      const mod = getModFromScore(s.value);
      tooltip.innerHTML = `
        <div class="pp-hex-tip-label" style="color:${s.color}">${s.label}</div>
        <div class="pp-hex-tip-val">${s.value}<span class="pp-hex-tip-mod">${modStr(mod)}</span></div>`;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = (y - 56) + 'px';
      tooltip.style.borderColor = s.color;
      tooltip.classList.add('is-visible');
    };
    const hideTip = () => tooltip?.classList.remove('is-visible');
    wrap.querySelectorAll('.pp-hex-point, .pp-hex-label').forEach(node => {
      node.addEventListener('mouseenter', (e) => {
        const idx = parseInt(node.dataset.statIdx, 10);
        const rect = wrap.getBoundingClientRect();
        const dotR = node.querySelector('circle:last-of-type');
        // Position du tooltip : au-dessus du point
        let x, y;
        if (dotR) {
          const dr = dotR.getBoundingClientRect();
          x = dr.left + dr.width / 2 - rect.left;
          y = dr.top - rect.top;
        } else {
          x = e.clientX - rect.left;
          y = e.clientY - rect.top;
        }
        showTip(idx, x, y);
      });
      node.addEventListener('mouseleave', hideTip);
    });
  });
}

// ── Bloc Équipement ──────────────────────────────────────────────────────────
function _renderEquipBlock(char) {
  const equip = char.equipement || {};
  const rows = getEquipmentSlots().map(slot => {
    const item = equip[slot.id];
    if (!item?.nom) return null;
    return { slot: slot.label, name: item.nom, detail: item.degats || item.typeArmure || '' };
  }).filter(Boolean);

  if (!rows.length) return '';

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">${_ppIcon('shield')} Équipement</h3>
      <div class="pp-side-equip">
        ${rows.map(r => `
          <div class="pp-equip-row">
            <span class="pp-equip-slot">${_esc(r.slot)}</span>
            <span class="pp-equip-name">${_esc(r.name)}</span>
            ${r.detail ? `<span class="pp-equip-detail">${_esc(r.detail)}</span>` : ''}
          </div>`).join('')}
      </div>
    </section>`;
}

// ── Bloc Hauts-Faits (compteurs par catégorie) ───────────────────────────────
function _renderAchievementsBlock(item) {
  const cid = item.char?.id || item.charId;
  if (!cid) return '';
  const charAchs = STORE.achievements.filter(a => (a.contributeurs || []).includes(cid));
  if (!charAchs.length) return '';

  const CATS = [
    { id: 'epique',   label: 'Épique',   color: '#e8b84b', icon: '⚔️' },
    { id: 'comique',  label: 'Comique',  color: '#22c38e', icon: '🎭' },
    { id: 'histoire', label: 'Histoire', color: '#4f8cff', icon: '📖' },
  ];
  const byCat = {};
  CATS.forEach(c => { byCat[c.id] = charAchs.filter(a => a.categorie === c.id).length; });
  const total = charAchs.length;

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">${_ppIcon('trophy')} Hauts-Faits <span class="pp-fiche-card-count">${total}</span></h3>
      <div class="pp-side-achievements">
        ${CATS.filter(c => byCat[c.id]).map(c => `
          <div class="pp-ach-cell" style="--ach-color:${c.color}">
            <div class="pp-ach-icon">${c.icon}</div>
            <div class="pp-ach-num">${byCat[c.id]}</div>
            <div class="pp-ach-lbl">${c.label}</div>
          </div>`).join('')}
      </div>
    </section>`;
}

// ── Bloc Galerie photos (carrousel + lightbox) ───────────────────────────────
function _renderGalleryBlock(item) {
  const photos = Array.isArray(item.gallery) ? item.gallery : [];
  if (!photos.length) return '';
  return `
    <section class="pp-fiche-card pp-fiche-card--gallery">
      <h3 class="pp-fiche-card-title">${_ppIcon('image')} Galerie <span class="pp-fiche-card-count">${photos.length}</span></h3>
      <div class="pp-gallery-view">
        ${photos.map((g, i) => `
          <button type="button" class="pp-gallery-view-item"
                  data-pp-action="lightbox" data-pres-id="${_esc(item.presentationId)}" data-idx="${i}">
            <img src="${_esc(g.url || g.thumb)}" alt="Photo ${i+1} de ${_esc(item.nom)}"
                 loading="lazy" decoding="async" referrerpolicy="no-referrer">
            ${g.isPortrait ? '<span class="pp-gallery-view-portrait-flag">Portrait</span>' : ''}
            <span class="pp-gallery-view-zoom" aria-hidden="true">${_ppIcon('search')}</span>
          </button>`).join('')}
      </div>
    </section>`;
}

// ── Bloc Chronique des aventures (timeline des missions du PJ) ──────────────
function _renderChroniqueBlock(item) {
  const charId = item.char?.id || item.charId;
  if (!charId) return '';
  const allMissions = _computeRecentMissions(charId, Infinity);
  if (!allMissions.length) return '';
  const visibleLimit = 6;
  const isExpanded = Boolean(STORE.chroniqueExpanded?.[charId]);
  const missions = isExpanded ? allMissions : allMissions.slice(0, visibleLimit);
  const remainingCount = Math.max(0, allMissions.length - visibleLimit);

  // Compte uniquement les missions rattachées à un groupe encore existant.
  const totalCount = allMissions.length;
  const latest = allMissions[0];
  const missionCount = allMissions.filter(m => m.type === 'mission').length;
  const storyCount = allMissions.length - missionCount;

  return `
    <section class="pp-fiche-card pp-fiche-card--chronique">
      <h3 class="pp-fiche-card-title">${_ppIcon('book')} Chronique <span class="pp-fiche-card-count">${totalCount}</span></h3>
      <div class="pp-chronique-head">
        <div>
          <p class="pp-fiche-card-sub">Les dernières aventures auxquelles ${_esc(item.nom)} a pris part.</p>
          <div class="pp-chronique-last">
            <span>Dernière trace</span>
            <strong>${_esc(latest?.titre || 'Sans titre')}</strong>
          </div>
        </div>
        <div class="pp-chronique-kpis">
          <span><b>${missionCount}</b> mission${missionCount>1?'s':''}</span>
          <span><b>${storyCount}</b> note${storyCount>1?'s':''}</span>
        </div>
      </div>
      <div class="pp-chronique">
        ${missions.map((m, idx) => {
          const isMission = m.type === 'mission';
          const groupCount = STORE.quests.filter(q => q.missionId === m.id).length;
          const status = m.statut || m.status || '';
          return `<button type="button" class="pp-chronique-item ${idx === 0 ? 'is-latest' : ''}" data-pp-action="openChroniqueMission" data-id="${_esc(m.id || '')}">
            <div class="pp-chronique-step">
              <span>${String(idx + 1).padStart(2, '0')}</span>
            </div>
            <div class="pp-chronique-body">
              <div class="pp-chronique-row">
                <span class="pp-chronique-type">${_ppIcon(isMission ? 'flag' : 'book')} ${isMission ? 'Mission' : 'Note'}</span>
                ${m.date ? `<span class="pp-chronique-date">${_ppIcon('calendar')} ${_esc(m.date)}</span>` : ''}
              </div>
              <div class="pp-chronique-titre">${_esc(m.titre || 'Sans titre')}</div>
              <div class="pp-chronique-meta">
                ${m.acte ? `<span>${_ppIcon('cards')} ${_esc(m.acte)}</span>` : ''}
                ${m.lieu ? `<span>${_ppIcon('mapPin')} ${_esc(m.lieu)}</span>` : ''}
                ${status ? `<span>${_ppIcon('spark')} ${_esc(status)}</span>` : ''}
                ${groupCount ? `<span>${_ppIcon('users')} ${groupCount} groupe${groupCount>1?'s':''}</span>` : ''}
              </div>
              <span class="pp-chronique-open">Ouvrir ${_ppIcon('arrowRight')}</span>
            </div>
          </button>`;
        }).join('')}
      </div>
      ${remainingCount ? `<button type="button" class="pp-chronique-toggle" data-pp-action="toggleChronique" data-char-id="${_esc(charId)}">
        ${isExpanded ? `${_ppIcon('arrowLeft')} Réduire le fil` : `${_ppIcon('plus')} Afficher ${remainingCount} aventure${remainingCount>1?'s':''} plus ancienne${remainingCount>1?'s':''}`}
      </button>` : ''}
    </section>`;

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">${_ppIcon('book')} Chronique <span class="pp-fiche-card-count">${totalCount}</span></h3>
      <p class="pp-fiche-card-sub">Les dernières aventures auxquelles ${_esc(item.nom)} a pris part.</p>
      <div class="pp-chronique">
        ${missions.map(m => {
          const isMission = m.type === 'mission';
          const ico = isMission ? '🎯' : '📖';
          return `<div class="pp-chronique-item">
            <div class="pp-chronique-ico">${ico}</div>
            <div class="pp-chronique-body">
              <div class="pp-chronique-titre">${_esc(m.titre || 'Sans titre')}</div>
              <div class="pp-chronique-meta">
                ${m.date ? `<span>📅 ${_esc(m.date)}</span>` : ''}
                ${m.acte ? `<span>· ${_esc(m.acte)}</span>` : ''}
                ${m.lieu ? `<span>· ${_esc(m.lieu)}</span>` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

// ── Bloc Top partenaires d'aventure ──────────────────────────────────────────
// Calcul depuis les quêtes-groupes : compte les co-occurrences dans un même
// groupe et affiche les top N PJs.
function _renderTopAdventurersBlock(item, items) {
  const charId = item.char?.id || item.charId;
  if (!charId) return '';
  const visibleLimit = 4;
  const allPartners = _computeTopAdventurers(charId, items, Infinity);
  const isExpanded = Boolean(STORE.partenairesExpanded?.[charId]);
  const partners = isExpanded ? allPartners : allPartners.slice(0, visibleLimit);
  const remainingCount = Math.max(0, allPartners.length - visibleLimit);

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">${_ppIcon('users')} Partenaires d'aventure ${allPartners.length ? `<span class="pp-fiche-card-count">${allPartners.length}</span>` : ''}</h3>
      <p class="pp-fiche-card-sub">Compagnons les plus rencontrés en mission (trame).</p>
      ${partners.length ? `
        <div class="pp-partenaires-grid">
          ${partners.map(({ item: o, count }) => {
            const c = _accentColor(o.nom);
            return `<button class="pp-partenaire" data-pp-action="openFiche" data-id="${_esc(o.id)}" style="--c-accent:${c}">
              <div class="pp-partenaire-portrait">
                ${characterPortraitContent({ ...o, photo: o.portraitUrl, nom: o.nom }, { fallbackText: o.initials })}
              </div>
              <div class="pp-partenaire-info">
                <div class="pp-partenaire-name">${_esc(o.nom)}</div>
                <div class="pp-partenaire-count">⚔ ${count} aventure${count>1?'s':''}</div>
              </div>
            </button>`;
          }).join('')}
        </div>
        ${remainingCount ? `<button type="button" class="pp-partenaires-toggle" data-pp-action="togglePartenaires" data-char-id="${_esc(charId)}" aria-expanded="${isExpanded}">
          ${isExpanded
            ? `${_ppIcon('arrowLeft')} Réduire la liste`
            : `${_ppIcon('plus')} Voir ${remainingCount} autre${remainingCount>1?'s':''} partenaire${remainingCount>1?'s':''}`}
        </button>` : ''}`
      : `<div class="pp-partenaires-empty">Aucune aventure partagée enregistrée encore.</div>`}
    </section>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROSTER V4 — registre maître/détail, galerie et carte des relations
// ══════════════════════════════════════════════════════════════════════════════
function _playerKey(item) {
  return item.ownerUid || item.joueur || 'sans-joueur';
}

function _playerGroups(items = STORE.items) {
  const groups = new Map();
  items.forEach(item => {
    const key = _playerKey(item);
    if (!groups.has(key)) groups.set(key, { key, name: item.joueur || 'Sans joueur', items: [], online: false });
    const group = groups.get(key);
    group.items.push(item);
    // Le compte courant est forcément en ligne. La page ne crée volontairement
    // aucun listener Presence supplémentaire (quota Firestore).
    if (item.ownerUid && item.ownerUid === STATE.user?.uid) group.online = true;
  });
  return [...groups.values()]
    .map(group => ({
      ...group,
      items: group.items.sort((a, b) => Number(Boolean(b.char?.isDefault)) - Number(Boolean(a.char?.isDefault))
        || (Number(b.level) || 0) - (Number(a.level) || 0)
        || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })),
    }))
    .sort((a, b) => {
      const aMine = a.key === STATE.user?.uid;
      const bMine = b.key === STATE.user?.uid;
      if (aMine !== bMine) return aMine ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
}

function _playerGroupLabel(group) {
  return group.key === STATE.user?.uid ? 'Mes personnages' : group.name;
}

function _playerAvatar(group, cls = '') {
  return `<span class="pp-player-avatar ${cls}" data-online="${group.online}">${_esc((group.name || '?').charAt(0).toUpperCase())}</span>`;
}

function _portraitStyle(item) {
  const cc = item.cardCrop;
  return cc
    ? `position:absolute;left:${(Number(cc.offX || 0) * 100).toFixed(2)}%;top:${(Number(cc.offY || 0) * 100).toFixed(2)}%;width:${(Number(cc.imgW || 1) * 100).toFixed(2)}%;height:auto;max-width:none`
    : 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
}

function _portrait(item, className = 'pp-register-portrait') {
  const image = item.imageUrl || item.portraitUrl;
  return `<span class="${className}" style="--pp-accent:${_accentColor(item.nom)}">${image
    ? `<img src="${_esc(image)}" alt="Portrait de ${_esc(item.nom)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="${_portraitStyle(item)}">`
    : `<b>${_esc(item.initials)}</b>`}</span>`;
}

function _renderRosterTop(items) {
  const groups = _playerGroups(items);
  const views = [
    ['gallery', 'Galerie', 'cards'],
    ['register', 'Registre', 'list'],
    ['relations', 'Liens du groupe', 'relations'],
  ];
  return `<header class="pp-roster-top">
    <div class="pp-roster-title"><h1>Joueurs</h1><small>${items.length} personnage${items.length !== 1 ? 's' : ''} · ${groups.length} joueur${groups.length !== 1 ? 's' : ''}${groups.some(g => g.online) ? ` · ${groups.filter(g => g.online).length} en ligne` : ''}</small></div>
    <div class="pp-roster-views" role="tablist" aria-label="Affichage">
      ${views.map(([mode, label, icon]) => {
        const sub = mode === 'register'
          ? (STORE.activeId ? `register/${STORE.activeId}` : 'register')
          : mode === 'relations' ? `relations/${STORE.relMode}${STORE.relSelectedId ? `/${encodeURIComponent(STORE.relSelectedId)}` : ''}` : 'gallery';
        return `<button type="button" role="tab" aria-selected="${STORE.viewMode === mode}" class="${STORE.viewMode === mode ? 'is-active' : ''}" data-pp-action="setViewMode" data-mode="${mode}" data-nav-page="players" data-nav-sub="${_esc(sub)}">${_ppIcon(icon)}<span>${label}</span></button>`;
      }).join('')}
    </div>
    <span class="pp-roster-spacer"></span>
    ${STATE.isAdmin ? `<button type="button" class="pp-roster-primary" data-pp-action="newPlayer">${_ppIcon('plus')} Présentation</button>` : ''}
  </header>`;
}

function _renderRosterSearch() {
  return `<div class="pp-roster-filters">
    <label class="pp-roster-search">${_ppIcon('search')}<input type="search" placeholder="Nom, classe, trait, joueur…" value="${_esc(STORE.filterSearch)}" autocomplete="off" data-pp-action="search" data-pp-on="input"><kbd>/</kbd>${STORE.filterSearch ? `<button type="button" data-pp-action="clearSearch" aria-label="Effacer">${_ppIcon('x')}</button>` : ''}</label>
  </div>`;
}

function _renderRegisterList(items) {
  const row = item => {
    const subtitle = [item.classe, item.race, STORE.grouped ? '' : item.joueur].filter(Boolean).join(' · ');
    return `<div class="pp-register-row-wrap" data-pp-id="${_esc(item.id)}">
      <button type="button" class="pp-register-row ${item.id === STORE.activeId ? 'is-selected' : ''}" data-pp-action="selectItem" data-id="${_esc(item.id)}" aria-current="${item.id === STORE.activeId}">
        ${_portrait(item)}
        <span class="pp-register-row-text"><b>${_esc(item.nom)}</b><small>${_esc(subtitle || 'Personnage')}</small></span>
        <span class="pp-register-marks">${item.char?.isDefault ? `<span class="is-main" title="Personnage principal">${_ppIcon('star')}</span>` : ''}${item.visible === false ? `<span class="is-hidden" title="Masqué aux joueurs">${_ppIcon('lock')}</span>` : ''}<span class="pp-register-level">${Number(item.level) || 1}</span></span>
      </button>
    </div>`;
  };
  const groups = _playerGroups(items);
  const searching = Boolean(STORE.filterSearch.trim());
  const rows = groups.map(group => {
    const collapsed = !searching && Boolean(STORE.collapsedGroups[group.key]);
    return `<section class="pp-register-group-block ${collapsed ? 'is-collapsed' : ''}">
      <button type="button" class="pp-register-group ${group.key === STATE.user?.uid ? 'is-mine' : ''}" data-pp-action="togglePlayerGroup" data-group="${_esc(group.key)}" aria-expanded="${!collapsed}">
        <span class="pp-register-chevron">${_ppIcon('chevronDown')}</span>${_playerAvatar(group)}<span class="pp-register-group-name">${_esc(_playerGroupLabel(group))}</span><i>${group.online ? 'en ligne' : ''}</i><b>${group.items.length}</b>
      </button>
      ${collapsed ? '' : group.items.map(row).join('')}
    </section>`;
  }).join('');

  return `<aside class="pp-register-rail">
    <div class="pp-register-tools">${_renderRosterSearch()}<div class="pp-register-toolrow"><span>${items.length} résultat${items.length !== 1 ? 's' : ''}</span></div></div>
    <div class="pp-register-list" id="pp-register-list">${rows || `<div class="pp-roster-empty">Aucun personnage.<button type="button" data-pp-action="resetFilters">Réinitialiser les filtres</button></div>`}</div>
    <div class="pp-register-keys"><span><kbd>↑</kbd><kbd>↓</kbd> personnage</span><span><kbd>1</kbd>–<kbd>4</kbd> sections</span><span><kbd>Échap.</kbd> galerie</span></div>
  </aside>`;
}

function _renderVitalBar(label, current, max, cls) {
  const pct = max ? Math.max(0, Math.min(100, Math.round(Number(current ?? max) / Number(max) * 100))) : 0;
  return `<div class="pp-detail-vital ${cls}"><div><span>${label}</span><b>${current ?? max}<small>/${max}</small></b></div><i><span style="width:${pct}%"></span></i></div>`;
}

function _identityRows(item) {
  return (item.identity || []).map(entry => Array.isArray(entry)
    ? { key: String(entry[0] || ''), value: String(entry[1] || '') }
    : { key: String(entry?.k || entry?.key || ''), value: String(entry?.v || entry?.value || '') })
    .filter(entry => entry.key && entry.value);
}

function _presentationHtml(item) {
  const isSlideshow = item.afficherBio && hasFreePage(item.bioPage);
  const narrative = item.afficherBio
    ? (isSlideshow
      ? renderFreePageHtml({ page: item.bioPage, className: 'pp-free-page', keyboard: true })
      : item.content
        ? richTextContentHtml({ html: item.content, className: 'pp-rich-content' })
        : item.bio ? `<div class="pp-bio-legacy">${_nl2br(item.bio)}</div>` : '')
    : '';
  const identity = item.afficherIdentite ? _identityRows(item) : [];
  const stats = item.afficherStats ? item.stats : [];
  const best = stats.length ? Math.max(...stats.map(s => Number(s.value) || 0)) : 0;
  const equipment = item.afficherEquip && item.char ? getEquipmentSlots().map(slot => {
    const equipped = item.char.equipement?.[slot.id];
    return equipped?.nom ? { slot: slot.label, name: equipped.nom } : null;
  }).filter(Boolean) : [];
  return `<div class="pp-detail-columns ${isSlideshow ? 'is-slideshow' : ''}"><article class="pp-detail-bio ${isSlideshow ? 'is-slideshow' : ''}">${isSlideshow ? `<div class="pp-slideshow-toolbar"><span>Présentation</span><button type="button" data-pp-action="fullscreenPresentation">${_ppIcon('external')} Plein écran</button></div>` : ''}${narrative || `<div class="pp-roster-empty">${_ppIcon('book')}<p>${item.afficherBio ? 'Pas encore de présentation.' : 'Présentation masquée.'}</p>${_canManageItem(item) ? `<button type="button" data-pp-action="editItem" data-id="${_esc(item.id)}">Rédiger la présentation</button>` : ''}</div>`}</article>
    <aside class="pp-detail-aside">
      ${identity.length ? `<section><h3>Identité</h3><dl>${identity.map(row => `<dt>${_esc(row.key)}</dt><dd>${_esc(row.value)}</dd>`).join('')}</dl></section>` : ''}
      ${stats.length ? `<section><h3>Caractéristiques</h3><div class="pp-detail-stats">${stats.map(stat => { const mod = getModFromScore(Number(stat.value) || 0); return `<div class="${Number(stat.value) === best ? 'is-best' : ''}" style="--stat:${stat.color || _accentColor(item.nom)}"><span>${_esc(stat.label.slice(0, 3).toUpperCase())}</span><b>${stat.value}</b><em>${modStr(mod)}</em></div>`; }).join('')}</div></section>` : ''}
      ${equipment.length ? `<section><h3>Équipement</h3><ul class="pp-detail-equipment">${equipment.map(row => `<li><span>${_esc(row.slot)}</span><b>${_esc(row.name)}</b></li>`).join('')}</ul></section>` : ''}
    </aside>
  </div>`;
}

function _missionStatus(mission) {
  const raw = _norm(mission.statut || mission.status || '');
  if (raw.includes('cours') || raw === 'active') return ['active', 'En cours'];
  if (raw.includes('prev') || raw.includes('plan')) return ['planned', 'Prévue'];
  return ['done', 'Terminée'];
}

function _missionMembers(mission, currentCharId, items) {
  const ids = _missionGroupMemberIds(mission.id, currentCharId);
  ids.delete(currentCharId);
  return [...ids].map(id => items.find(it => it.charId === id)).filter(Boolean);
}

function _chronicleHtml(item, items) {
  const missions = _computeRecentMissions(item.charId, Infinity);
  const achievements = STORE.achievements.filter(a => (a.contributeurs || a.by || []).includes(item.charId));
  if (!missions.length && !achievements.length) return `<div class="pp-roster-empty">${_ppIcon('book')}<p>Aucune aventure pour l’instant.</p></div>`;
  return `<div class="pp-detail-columns"><ol class="pp-detail-timeline">${missions.map(mission => {
    const [statusClass, statusLabel] = _missionStatus(mission);
    const members = _missionMembers(mission, item.charId, items);
    return `<li class="${statusClass}"><i></i><div><header><button type="button" class="pp-mission-link" data-pp-action="openChroniqueMission" data-id="${_esc(mission.id)}">${_esc(mission.titre || 'Sans titre')}${_ppIcon('arrowRight')}</button><span>${statusLabel}</span></header>${mission.date ? `<small>${_esc(mission.date)}</small>` : ''}${members.length ? `<div class="pp-detail-chips">${members.map(member => `<button type="button" data-pp-action="selectItem" data-id="${_esc(member.id)}">${_portrait(member, 'pp-detail-chip-portrait')}${_esc(member.nom.split(' ')[0])}</button>`).join('')}</div>` : ''}</div></li>`;
  }).join('')}</ol><aside class="pp-detail-aside"><section><h3>Hauts-faits · ${achievements.length}</h3>${achievements.length ? `<ul class="pp-detail-achievements">${achievements.map(a => `<li>★ <span>${_esc(a.titre || a.nom || 'Haut-fait')}</span></li>`).join('')}</ul>` : '<p>Aucun pour l’instant.</p>'}</section></aside></div>`;
}

function _companionsHtml(item, items) {
  const partners = _computeTopAdventurers(item.charId, items, 99);
  const max = Math.max(1, ...partners.map(p => p.count));
  const met = new Set(partners.map(p => p.item.id));
  const never = items.filter(other => other.id !== item.id && !met.has(other.id));
  return `${partners.length ? `<div class="pp-detail-companions">${partners.map(({ item: other, count }) => `<button type="button" data-pp-action="selectItem" data-id="${_esc(other.id)}">${_portrait(other, 'pp-detail-companion-portrait')}<span><b>${_esc(other.nom)}</b><small>${_esc([other.classe, other.joueur].filter(Boolean).join(' · '))}</small></span><em><i><span style="width:${Math.round(count / max * 100)}%"></span></i>${count} aventure${count !== 1 ? 's' : ''}</em></button>`).join('')}</div>` : `<div class="pp-roster-empty">${_ppIcon('users')}<p>N’a encore partagé aucun groupe.</p></div>`}${never.length ? `<section class="pp-detail-never"><h3>Pas encore croisés</h3><div class="pp-detail-chips">${never.map(other => `<button type="button" data-pp-action="selectItem" data-id="${_esc(other.id)}">${_portrait(other, 'pp-detail-chip-portrait')}${_esc(other.nom)}</button>`).join('')}</div></section>` : ''}`;
}

function _galleryDetailHtml(item) {
  const photos = item.gallery || [];
  const add = _canManageItem(item) ? `<button type="button" class="pp-detail-gallery-add" data-pp-action="editItem" data-id="${_esc(item.id)}">${_ppIcon('plus')}<span>Ajouter</span></button>` : '';
  return photos.length || add ? `<div class="pp-detail-gallery">${photos.map((photo, index) => `<button type="button" data-pp-action="lightbox" data-pres-id="${_esc(item.presentationId || item.id)}" data-idx="${index}"><img src="${_esc(photo.url || photo.thumb)}" alt="Illustration ${index + 1} de ${_esc(item.nom)}" loading="lazy" decoding="async"><span>${photo.isPortrait ? 'Portrait' : `Illustration ${index + 1}`}</span></button>`).join('')}${add}</div>` : `<div class="pp-roster-empty">${_ppIcon('image')}<p>Aucune illustration.</p></div>`;
}

function _detailSectionHeader(icon, title, count, subtitle) {
  return `<header class="pp-detail-section-head"><div><h3>${_ppIcon(icon)} ${title}${count != null ? `<em>${count}</em>` : ''}</h3>${subtitle ? `<p>${subtitle}</p>` : ''}</div></header>`;
}

function _detailSectionsHtml(item, items) {
  const photos = item.gallery || [];
  const missions = _computeRecentMissions(item.charId, Infinity);
  const partners = _computeTopAdventurers(item.charId, items, 99);
  const achievements = STORE.achievements.filter(a => (a.contributeurs || a.by || []).includes(item.charId));
  return `<div class="pp-detail-stack">
    <section id="pp-section-presentation" class="pp-detail-section" data-detail-section="presentation">${_detailSectionHeader('book', 'Présentation', null, 'Identité, histoire et caractéristiques du personnage.')}${_presentationHtml(item)}</section>
    <section id="pp-section-gallery" class="pp-detail-section" data-detail-section="gallery">${_detailSectionHeader('image', 'Galerie', photos.length, 'Portraits et illustrations du personnage.')}${_galleryDetailHtml(item)}</section>
    <section id="pp-section-chronicle" class="pp-detail-section" data-detail-section="chronicle">${_detailSectionHeader('book', 'Chronique', `${missions.length} · ${achievements.length} HF`, 'Missions et hauts-faits vécus par le personnage.')}${_chronicleHtml(item, items)}</section>
    <section id="pp-section-companions" class="pp-detail-section" data-detail-section="companions">${_detailSectionHeader('users', 'Compagnons', partners.length, 'Personnages rencontrés dans ses groupes d’aventure.')}${_companionsHtml(item, items)}</section>
  </div>`;
}

function _renderRegisterDetail(item, items) {
  if (!item) return `<main class="pp-register-detail"><div class="pp-roster-empty">Sélectionne un personnage.</div></main>`;
  const index = items.findIndex(it => it.id === item.id);
  const group = _playerGroups(STORE.items).find(g => g.key === _playerKey(item));
  const siblings = group?.items.filter(it => it.id !== item.id) || [];
  const missions = _computeRecentMissions(item.charId, Infinity);
  const partners = _computeTopAdventurers(item.charId, items, 99);
  const tabs = [
    ['presentation', 'Présentation', 'user', null],
    ['gallery', 'Galerie', 'image', (item.gallery || []).length],
    ['chronicle', 'Chronique', 'book', missions.length],
    ['companions', 'Compagnons', 'users', partners.length],
  ];
  const portraitIndex = Math.max(0, (item.gallery || []).findIndex(photo => photo.isPortrait));
  const portrait = item.gallery?.length
    ? `<button type="button" class="pp-detail-portrait-button" data-pp-action="lightbox" data-pres-id="${_esc(item.presentationId || item.id)}" data-idx="${portraitIndex}" aria-label="Voir le portrait de ${_esc(item.nom)}">${_portrait(item, 'pp-detail-portrait')}</button>`
    : _portrait(item, 'pp-detail-portrait');
  const tags = item.afficherTags ? (item.tags || []) : [];
  const vitalParts = STATE.isAdmin ? [
    item.afficherPV && item.pvMax != null ? _renderVitalBar('PV', item.pvActuel, item.pvMax, 'is-pv') : '',
    item.afficherPM && item.pmMax != null ? _renderVitalBar('PM', item.pmActuel, item.pmMax, 'is-pm') : '',
    item.afficherCA && item.ca != null ? `<div class="pp-detail-simple"><span>CA</span><b>${item.ca}</b></div>` : '',
    item.afficherOr && item.gold != null ? `<div class="pp-detail-simple"><span>Or</span><b>${item.gold}</b></div>` : '',
  ].filter(Boolean) : [];
  return `<main class="pp-register-detail">
    <section class="pp-detail-head" style="--pp-accent:${_accentColor(item.nom)}">
      <button type="button" class="pp-mobile-list" data-pp-action="mobileBack">${_ppIcon('arrowLeft')} Liste</button>
      ${portrait}
      <div class="pp-detail-identity"><div class="pp-detail-name"><h2>${_esc(item.nom)}</h2>${item.visible === false ? `<span>${_ppIcon('lock')} Masqué</span>` : ''}</div><p>${_esc([item.classe, item.race].filter(Boolean).join(' · '))}${item.afficherNiveau ? ` · <b>Niv. ${item.level}</b>` : ''}</p>${group ? `<div class="pp-detail-player">${_playerAvatar(group)}<span>Joué par <b>${_esc(group.name)}</b></span>${siblings.length ? `<span class="pp-detail-siblings">${siblings.map(sibling => `<button type="button" data-pp-action="selectSibling" data-id="${_esc(sibling.id)}" title="${_esc(sibling.nom)}">${_portrait(sibling, 'pp-detail-chip-portrait')}<span>${_esc(sibling.nom)}</span></button>`).join('')}</span>` : ''}</div>` : ''}${tags.length ? `<div class="pp-detail-tags">${tags.map(tag => `<span>${_esc(tag)}</span>`).join('')}</div>` : ''}${item.afficherCitation && item.quote ? `<q>${_esc(item.quote)}</q>` : ''}</div>
      <div class="pp-detail-actions"><div class="pp-detail-nav"><button type="button" data-pp-action="stepItem" data-step="-1" ${index <= 0 ? 'disabled' : ''}>${_ppIcon('arrowLeft')}</button><span>${index + 1}<i>/</i>${items.length}</span><button type="button" data-pp-action="stepItem" data-step="1" ${index >= items.length - 1 ? 'disabled' : ''}>${_ppIcon('arrowRight')}</button></div>${_canManageItem(item) ? `<div><button type="button" class="is-primary" data-pp-action="openCharacter" data-char-id="${_esc(item.charId)}">${_ppIcon('external')} Fiche de jeu</button><button type="button" data-pp-action="editItem" data-id="${_esc(item.id)}">${_ppIcon('edit')} Modifier</button><button type="button" class="is-icon" data-pp-action="toggleVisible" data-id="${_esc(item.id)}" title="${item.visible === false ? 'Publier' : 'Masquer'}">${_ppIcon(item.visible === false ? 'eyeOff' : 'eye')}</button></div>` : ''}</div>
    </section>
    ${vitalParts.length ? `<section class="pp-detail-vitals">${vitalParts.join('')}<span class="pp-detail-mj">${_ppIcon('lock')} Visible MJ uniquement</span></section>` : ''}
    <nav class="pp-detail-tabs" aria-label="Sections de la fiche">${tabs.map(([key, label, icon, count], tabIndex) => `<button type="button" aria-current="${STORE.detailSection === key ? 'true' : 'false'}" class="${STORE.detailSection === key ? 'is-active' : ''}" data-pp-action="jumpDetailSection" data-section="${key}">${_ppIcon(icon)}${label}${count != null ? `<em>${count}</em>` : ''}<kbd>${tabIndex + 1}</kbd></button>`).join('')}</nav>
    <div class="pp-detail-panel">${_detailSectionsHtml(item, items)}</div>
  </main>`;
}

function _renderGalleryScreen(items) {
  const groupByKey = new Map(_playerGroups(STORE.items).map(group => [group.key, group]));
  const canReorder = STATE.isAdmin && !STORE.grouped;
  const card = item => {
    const group = groupByKey.get(_playerKey(item));
    const canManage = _canManageItem(item);
    return `<article class="pp-gallery-card ${item.id === STORE.activeId ? 'is-selected' : ''}" data-pp-id="${_esc(item.id)}" style="--pp-accent:${_accentColor(item.nom)}">
      <button type="button" class="pp-gallery-card-open" data-pp-action="openRegister" data-id="${_esc(item.id)}" aria-label="Ouvrir ${_esc(item.nom)}">
        <span class="pp-gallery-image">${_portrait(item, 'pp-gallery-portrait')}<em>${item.level}</em>${item.visible === false ? `<i title="Masqué">${_ppIcon('lock')}</i>` : ''}${item.char?.isDefault ? `<span class="pp-gallery-main" title="Personnage principal">${_ppIcon('star')}</span>` : ''}${canReorder ? `<span class="pp-gallery-drag" title="Réordonner" aria-label="Réordonner">${_ppIcon('grip')}</span>` : ''}</span>
        <span class="pp-gallery-copy"><b>${_esc(item.nom)}</b><small>${_esc([item.classe, item.race].filter(Boolean).join(' · '))}</small>${!STORE.grouped && group ? `<span class="pp-gallery-player">${_playerAvatar(group)}${_esc(group.name)}</span>` : ''}</span>
      </button>
      ${canManage ? `<span class="pp-gallery-quick-actions"><button type="button" data-pp-action="editItem" data-id="${_esc(item.id)}" title="Modifier ${_esc(item.nom)}" aria-label="Modifier ${_esc(item.nom)}">${_ppIcon('edit')}</button><button type="button" class="${item.visible === false ? 'is-hidden' : ''}" data-pp-action="toggleVisible" data-id="${_esc(item.id)}" title="${item.visible === false ? 'Publier' : 'Masquer'} ${_esc(item.nom)}" aria-label="${item.visible === false ? 'Publier' : 'Masquer'} ${_esc(item.nom)}">${_ppIcon(item.visible === false ? 'eyeOff' : 'eye')}</button></span>` : ''}
    </article>`;
  };
  const grouped = _playerGroups(items).map(group => `<section class="pp-gallery-group ${group.key === STATE.user?.uid ? 'is-mine' : ''}">
    <header>${_playerAvatar(group)}<div><h2>${_esc(_playerGroupLabel(group))}</h2><small>${group.items.length} personnage${group.items.length !== 1 ? 's' : ''}</small></div></header>
    <div class="pp-gallery-grid">${group.items.map(card).join('')}</div>
  </section>`).join('');
  return `<div class="pp-gallery-screen">
    <div class="pp-gallery-toolbar">${_renderRosterSearch()}<div class="pp-gallery-toolbar-row"><span>${items.length} personnage${items.length !== 1 ? 's' : ''}</span>${canReorder ? `<span class="pp-gallery-order-hint">${_ppIcon('grip')} Glisser pour réordonner</span>` : ''}<label><input type="checkbox" data-pp-action="toggleGrouped" data-pp-on="change" ${STORE.grouped ? 'checked' : ''}> Grouper par joueur</label></div></div>
    ${items.length ? (STORE.grouped ? grouped : `<div id="pp-gallery-grid" class="pp-gallery-grid pp-gallery-grid--all">${items.map(card).join('')}</div>`) : `<div class="pp-roster-empty">Aucun personnage.<button type="button" data-pp-action="resetFilters">Réinitialiser les filtres</button></div>`}
  </div>`;
}

let _relationRuntimeGraph = null;
let _relationResizeBound = false;

function _relationPartners(graph, id) {
  return graph.edges.filter(edge => edge.a === id || edge.b === id).map(edge => ({
    node: graph.nodeById.get(edge.a === id ? edge.b : edge.a),
    count: edge.n,
  })).filter(partner => partner.node).sort((a, b) => b.count - a.count || a.node.label.localeCompare(b.node.label, 'fr'));
}

function _relationNodeRadius(node) {
  return 13 + Math.min(10, node.deg * .7);
}

function _relationTable(graph, node) {
  return node?.tableId >= 0 ? graph.tables[node.tableId] : null;
}

function _relationTableColor(graph, node) {
  return _relationTable(graph, node)?.color || '#56657a';
}

function _relationAvatar(node, className = '') {
  const item = node?.item;
  const image = item?.char?.photo || '';
  const position = `${50 + (Number(item?.photoX) || 0) * 50}% ${50 + (Number(item?.photoY) || 0) * 50}%`;
  return `<span class="pp-rel-avatar ${className}" style="--rel-color:${_relationTableColor(_relationRuntimeGraph, node)}">${image
    ? `<img src="${_esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="object-position:${position}">`
    : `<b>${_esc(_initials(node?.label || '?'))}</b>`}</span>`;
}

function _relationSvg(graph) {
  const viewport = _relationViewport();
  const edges = graph.edges.filter(edge => edge.n >= STORE.relMin).sort((a, b) => a.n - b.n);
  const edgeHtml = edges.map(edge => {
    const a = graph.nodeById.get(edge.a), b = graph.nodeById.get(edge.b);
    const pa = graph.layout.get(edge.a), pb = graph.layout.get(edge.b);
    if (!a || !b || !pa || !pb) return '';
    const sameTable = a.tableId >= 0 && a.tableId === b.tableId;
    const color = sameTable ? _relationTableColor(graph, a) : 'rgba(200,212,232,.55)';
    const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;
    return `<g class="pp-rel-edge" data-a="${_esc(edge.a)}" data-b="${_esc(edge.b)}" data-n="${edge.n}">
      <line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="${color}" stroke-width="${(.8 + edge.n * 1.1).toFixed(1)}" vector-effect="non-scaling-stroke" ${sameTable ? '' : 'stroke-dasharray="4 4"'}></line>
      <g class="pp-rel-edge-label" transform="translate(${midX.toFixed(1)},${midY.toFixed(1)})"><g class="pp-rel-edge-label-visual"><rect x="-11" y="-9" width="22" height="18" rx="9"></rect><text x="0" y="0" dy=".35em">${edge.n}</text></g></g>
    </g>`;
  }).join('');
  const definitions = graph.nodes.map((node, index) => `<clipPath id="pp-rel-clip-${index}"><circle r="${_relationNodeRadius(node) - 2}"></circle></clipPath>`).join('');
  const nodes = graph.nodes.map((node, index) => {
    const point = graph.layout.get(node.id);
    if (!point) return '';
    const radius = _relationNodeRadius(node), color = _relationTableColor(graph, node);
    const image = node.item?.char?.photo || '';
    const photoX = Number(node.item?.photoX) || 0, photoY = Number(node.item?.photoY) || 0;
    const portraitAlign = `${photoX < -.18 ? 'xMin' : photoX > .18 ? 'xMax' : 'xMid'}${photoY < -.18 ? 'YMin' : photoY > .18 ? 'YMax' : 'YMid'}`;
    const selected = node.id === STORE.relSelectedId;
    return `<g class="pp-rel-node ${selected ? 'is-selected' : ''}" data-pp-action="relationSelect" data-id="${_esc(node.id)}" tabindex="0" role="button" aria-label="${_esc(`${node.label}, ${node.adv} aventures, ${node.deg} partenaires`)}" transform="translate(${point.x.toFixed(1)},${point.y.toFixed(1)})">
      <g class="pp-rel-node-visual">
        ${selected ? `<circle class="pp-rel-halo" r="${radius + 7}" stroke="${color}"></circle>` : ''}
        <circle class="pp-rel-node-disc" r="${radius}" fill="color-mix(in srgb, ${color} 26%, #111b2a)" stroke="${color}" stroke-width="${node.secondary ? 1.5 : 2.2}" ${node.secondary ? 'stroke-dasharray="3 2"' : ''}></circle>
        ${image ? `<image href="${_esc(image)}" x="${-radius + 2}" y="${-radius + 2}" width="${(radius - 2) * 2}" height="${(radius - 2) * 2}" preserveAspectRatio="${portraitAlign} slice" clip-path="url(#pp-rel-clip-${index})"></image>` : `<text class="pp-rel-node-initials" dy=".35em" style="font-size:${Math.round(radius * .72)}px">${_esc(_initials(node.label))}</text>`}
        ${node.bridge ? `<circle class="pp-rel-bridge-dot" cx="${(radius * .72).toFixed(1)}" cy="${(-radius * .72).toFixed(1)}" r="5.5"></circle>` : ''}
        <text class="pp-rel-label" y="${(radius + 14).toFixed(1)}">${_esc(node.label)}</text>
      </g>
    </g>`;
  }).join('');
  return `<svg id="pp-rel-net" class="pp-relations-svg" viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Réseau des liens du groupe"><defs>${definitions}</defs>${edgeHtml}${nodes}</svg>`;
}

function _renderRelationSide(graph) {
  const selected = graph.nodeById.get(STORE.relSelectedId);
  if (selected) {
    const partners = _relationPartners(graph, selected.id);
    const met = new Set(partners.map(partner => partner.node.id));
    const never = graph.nodes.filter(node => node.id !== selected.id && !met.has(node.id));
    const table = _relationTable(graph, selected);
    const otherTables = selected.bridge?.tableIds.map(id => graph.tables[id]).filter(Boolean) || [];
    const maxCount = Math.max(1, ...partners.map(partner => partner.count));
    return `<div class="pp-rel-side-head"><button type="button" class="pp-rel-close" data-pp-action="relationClear" aria-label="Fermer">${_ppIcon('x')}</button>${_relationAvatar(selected, 'is-large')}<div><h2>${_esc(selected.label)}</h2><small>${_esc(selected.sub || (STORE.relMode === 'players' ? 'Joueur' : 'Personnage'))}</small></div></div>
      <div class="pp-rel-kpis"><span><b>${selected.adv}</b> aventures</span><span><b>${partners.length}</b> partenaires</span><span><b>${never.length}</b> jamais croisés</span></div>
      ${table ? `<div class="pp-rel-table-banner" style="--rel-color:${table.color}"><b>Autour de ${_esc(graph.nodeById.get(table.coreId)?.label || selected.label)}</b>${otherTables.length ? `<span>${_ppIcon('relations')} fait le pont avec ${otherTables.map(other => `<button type="button" data-pp-action="relationTable" data-table="${other.id}">Autour de ${_esc(graph.nodeById.get(other.coreId)?.label || '')}</button>`).join(', ')}</span>` : ''}</div>` : ''}
      <h3>Joue le plus avec</h3>
      <div class="pp-rel-partners">${partners.map(partner => `<button type="button" class="${partner.count < STORE.relMin ? 'is-weak' : ''}" data-pp-action="relationSelect" data-id="${_esc(partner.node.id)}">${_relationAvatar(partner.node, 'is-small')}<span><b>${_esc(partner.node.label)}</b><small>${_esc(partner.node.sub)}</small></span><em><i><span style="width:${partner.count / maxCount * 100}%"></span></i>${partner.count}</em></button>`).join('') || '<p class="pp-rel-muted">Aucune aventure partagée.</p>'}</div>
      ${never.length ? `<button type="button" class="pp-rel-never-toggle" data-pp-action="relationNever">${STORE.relShowNever ? 'Masquer' : 'Voir'} les ${never.length} jamais croisés</button>${STORE.relShowNever ? `<div class="pp-rel-chips">${never.map(node => `<button type="button" data-pp-action="relationSelect" data-id="${_esc(node.id)}">${_esc(node.label)}</button>`).join('')}</div>` : ''}` : ''}
      <button type="button" class="pp-rel-open" data-pp-action="relationOpen">Ouvrir la fiche ${_ppIcon('arrowRight')}</button>`;
  }

  const links = graph.edges.filter(edge => edge.n >= STORE.relMin).length;
  const duos = [...graph.edges].sort((a, b) => b.n - a.n || a.a.localeCompare(b.a)).slice(0, 6);
  const bridges = graph.nodes.filter(node => node.bridge).sort((a, b) => b.bridge.count - a.bridge.count || b.w - a.w).slice(0, 4);
  return `<p class="pp-rel-lead"><b>${links}</b> liens sur ${graph.total} paires possibles. ${STORE.relMode === 'players' ? 'Les joueurs' : 'Les personnages'} se regroupent naturellement en tablées : chaque couleur en est une.</p>
    <h3>Tablées</h3>
    <div class="pp-rel-tables">${graph.tables.map(table => {
      const core = graph.nodeById.get(table.coreId);
      const members = table.memberIds.map(id => graph.nodeById.get(id)).filter(Boolean);
      return `<button type="button" class="${STORE.relTableId === table.id ? 'is-active' : ''}" data-pp-action="relationTable" data-table="${table.id}" style="--rel-color:${table.color}"><i></i><span><b>Autour de ${_esc(core?.label || '')}</b><small>${members.length} ${STORE.relMode === 'players' ? 'joueurs' : 'personnages'} · ${table.internal} participations communes</small></span><em>${members.slice(0, 5).map(node => `<i>${_esc(_initials(node.label))}</i>`).join('')}${members.length > 5 ? `<i>+${members.length - 5}</i>` : ''}</em></button>`;
    }).join('') || '<p class="pp-rel-muted">Pas encore assez de liens pour former une tablée.</p>'}</div>
    <h3>Duos les plus soudés</h3>
    <div class="pp-rel-duos">${duos.map(edge => `<button type="button" data-pp-action="relationSelect" data-id="${_esc(edge.a)}"><span>${_esc(graph.nodeById.get(edge.a)?.label || '')}</span><i></i><span>${_esc(graph.nodeById.get(edge.b)?.label || '')}</span><em>${edge.n} aventure${edge.n > 1 ? 's' : ''}</em></button>`).join('') || '<p class="pp-rel-muted">Aucun duo pour le moment.</p>'}</div>
    ${bridges.length ? `<h3>${_ppIcon('relations')} Ponts entre tablées</h3><div class="pp-rel-chips">${bridges.map(node => `<button type="button" data-pp-action="relationSelect" data-id="${_esc(node.id)}"><i></i>${_esc(node.label)}</button>`).join('')}</div><p class="pp-rel-muted">Ces ${STORE.relMode === 'players' ? 'joueurs' : 'personnages'} ont partagé des aventures avec plusieurs tablées.</p>` : ''}`;
}

function _renderRelationsScreen(items) {
  const graph = _prepareRelationGraph(items.filter(item => item.charId));
  _relationRuntimeGraph = graph;
  if (STORE.relSelectedId && !graph.nodeById.has(STORE.relSelectedId)) STORE.relSelectedId = '';
  if (STORE.relTableId !== null && !graph.tables[STORE.relTableId]) STORE.relTableId = null;
  return `<div class="pp-relations-screen">
    <main class="pp-relations-main">
      <div class="pp-relations-bar">
        <div class="pp-relations-segment" role="group" aria-label="Type de réseau"><button type="button" class="${STORE.relMode === 'characters' ? 'is-active' : ''}" data-pp-action="relationMode" data-mode="characters">Personnages</button><button type="button" class="${STORE.relMode === 'players' ? 'is-active' : ''}" data-pp-action="relationMode" data-mode="players">Joueurs</button></div>
        <label class="pp-relations-search">${_ppIcon('search')}<input type="search" placeholder="Trouver un ${STORE.relMode === 'players' ? 'joueur' : 'personnage'}…" value="${_esc(STORE.relQuery)}" autocomplete="off" data-pp-action="relationSearch" data-pp-on="input"></label>
        <label class="pp-relations-min"><span>Liens d’au moins</span><input type="range" min="1" max="4" step="1" value="${STORE.relMin}" data-pp-action="relationMin" data-pp-on="input"><output>${STORE.relMin} aventure${STORE.relMin > 1 ? 's' : ''}</output></label>
      </div>
      <div class="pp-relations-stage" data-pp-action="relationClear">${graph.nodes.length ? _relationSvg(graph) : '<div class="pp-roster-empty">Aucun personnage à afficher.</div>'}<div class="pp-relations-zoom" aria-label="Navigation dans le réseau"><button type="button" data-pp-action="relationZoom" data-factor="1.25" aria-label="Dézoomer">−</button><button type="button" data-pp-action="relationResetView" aria-label="Recentrer le réseau" title="Recentrer">${_ppIcon('reset')}</button><button type="button" data-pp-action="relationZoom" data-factor="0.8" aria-label="Zoomer">+</button></div><div class="pp-relations-legend"><span><i class="is-solid"></i>même tablée</span><span><i class="is-dashed"></i>entre tablées</span><span><i class="is-weight"></i>épaisseur = aventures partagées</span><span><i class="is-bridge"></i>pont</span>${STORE.relMode === 'characters' ? '<span><i class="is-secondary"></i>perso secondaire</span>' : ''}</div><div class="pp-rel-tooltip" role="tooltip"></div></div>
    </main>
    <aside class="pp-relations-side">${_renderRelationSide(graph)}</aside>
  </div>`;
}

function _fitRelationText() {
  const svg = document.getElementById('pp-rel-net');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const viewport = _relationViewport();
  const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height) || 1;
  svg.style.setProperty('--u', Math.min(2.2, Math.max(1, 1 / scale)).toFixed(3));
}

function _relationPointFromClient(svg, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const viewport = _relationViewport();
  const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height) || 1;
  const offsetX = (rect.width - viewport.width * scale) / 2;
  const offsetY = (rect.height - viewport.height * scale) / 2;
  return {
    x: viewport.x + (clientX - rect.left - offsetX) / scale,
    y: viewport.y + (clientY - rect.top - offsetY) / scale,
    scale,
  };
}

function _relationFocusIds(graph, hoverId = '') {
  const focusId = hoverId || STORE.relSelectedId;
  if (focusId) return new Set([focusId, ..._relationPartners(graph, focusId).filter(partner => partner.count >= STORE.relMin).map(partner => partner.node.id)]);
  if (STORE.relTableId !== null) return new Set(graph.tables[STORE.relTableId]?.memberIds || []);
  const query = _norm(STORE.relQuery);
  if (query) return new Set(graph.nodes.filter(node => _norm(`${node.label} ${node.sub}`).includes(query)).map(node => node.id));
  return null;
}

function _applyRelationFocus(hoverId = '') {
  const graph = _relationRuntimeGraph;
  const screen = document.querySelector('.pp-relations-screen');
  if (!graph || !screen) return;
  const focus = _relationFocusIds(graph, hoverId);
  const pivot = hoverId || STORE.relSelectedId;
  screen.querySelectorAll('.pp-rel-node').forEach(element => element.classList.toggle('is-dim', Boolean(focus && !focus.has(element.dataset.id))));
  screen.querySelectorAll('.pp-rel-edge').forEach(element => {
    const connected = pivot ? (element.dataset.a === pivot || element.dataset.b === pivot) : Boolean(focus?.has(element.dataset.a) && focus?.has(element.dataset.b));
    element.classList.toggle('is-hot', Boolean(focus && connected));
    element.classList.toggle('is-dim', Boolean(focus && !connected));
  });
}

function _bindRelationView() {
  const screen = document.querySelector('.pp-relations-screen');
  if (!screen) return;
  const stage = screen.querySelector('.pp-relations-stage');
  _fitRelationText();
  _applyRelationFocus();
  if (!_relationResizeBound) {
    _relationResizeBound = true;
    window.addEventListener('resize', _fitRelationText, { passive: true });
  }
  const tooltip = screen.querySelector('.pp-rel-tooltip');
  const showTooltip = element => {
    const node = _relationRuntimeGraph?.nodeById.get(element?.dataset.id);
    if (!node || !tooltip) return;
    const nodeRect = element.getBoundingClientRect(), stageRect = screen.querySelector('.pp-relations-stage').getBoundingClientRect();
    tooltip.innerHTML = `<b>${_esc(node.label)}</b><small>${_esc(node.sub)}</small><span>${node.adv} aventures · ${node.deg} partenaires</span>`;
    tooltip.style.left = `${nodeRect.left - stageRect.left + nodeRect.width / 2}px`;
    tooltip.style.top = `${nodeRect.top - stageRect.top}px`;
    tooltip.classList.add('is-visible');
  };
  screen.addEventListener('pointerover', event => {
    const node = event.target.closest('.pp-rel-node');
    if (!node || node.contains(event.relatedTarget)) return;
    _applyRelationFocus(node.dataset.id);
    showTooltip(node);
  });
  screen.addEventListener('pointerout', event => {
    const node = event.target.closest('.pp-rel-node');
    if (!node || node.contains(event.relatedTarget)) return;
    _applyRelationFocus();
    tooltip?.classList.remove('is-visible');
  });
  screen.addEventListener('focusin', event => {
    const node = event.target.closest('.pp-rel-node');
    if (!node) return;
    _applyRelationFocus(node.dataset.id);
    showTooltip(node);
  });
  screen.addEventListener('focusout', event => {
    const node = event.target.closest('.pp-rel-node');
    if (!node || node.contains(event.relatedTarget)) return;
    _applyRelationFocus();
    tooltip?.classList.remove('is-visible');
  });
  stage?.addEventListener('wheel', event => {
    const svg = screen.querySelector('#pp-rel-net');
    if (!svg) return;
    event.preventDefault();
    const point = _relationPointFromClient(svg, event.clientX, event.clientY);
    _zoomRelation(Math.exp(Math.max(-240, Math.min(240, event.deltaY)) * .0018), point);
  }, { passive: false });

  let drag = null;
  stage?.addEventListener('pointerdown', event => {
    const svg = screen.querySelector('#pp-rel-net');
    if (!svg || event.button !== 0 || event.target.closest('button,.pp-rel-node')) return;
    const point = _relationPointFromClient(svg, event.clientX, event.clientY);
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scale: point.scale, viewport: { ..._relationViewport() } };
    _relationPanSuppressUntil = 0;
    stage.setPointerCapture?.(event.pointerId);
    stage.classList.add('is-panning');
  });
  stage?.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) _relationPanSuppressUntil = Date.now() + 300;
    _relationViewports.set(STORE.relMode, _clampRelationViewport({
      ...drag.viewport,
      x: drag.viewport.x - dx / drag.scale,
      y: drag.viewport.y - dy / drag.scale,
    }));
    _applyRelationViewport();
  });
  const stopPan = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    stage.releasePointerCapture?.(event.pointerId);
    stage.classList.remove('is-panning');
    drag = null;
  };
  stage?.addEventListener('pointerup', stopPan);
  stage?.addEventListener('pointercancel', stopPan);
}

function _refreshRelationView({ syncRoute = true } = {}) {
  const area = document.getElementById('pp-view-area');
  if (!area) return;
  area.innerHTML = _renderRelationsScreen(_applyFilters(STORE.items));
  if (syncRoute) _syncPlayersRoute();
  _bindRelationView();
}

function _refreshRelationGraph({ syncRoute = true } = {}) {
  const graph = _relationRuntimeGraph;
  const svg = document.getElementById('pp-rel-net');
  const side = document.querySelector('.pp-relations-side');
  if (!graph || !svg || !side) return;
  svg.outerHTML = _relationSvg(graph);
  side.innerHTML = _renderRelationSide(graph);
  if (syncRoute) _syncPlayersRoute();
  _fitRelationText();
  _applyRelationFocus();
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE PRINCIPALE — entrée + dispatch sommaire/fiche
// ══════════════════════════════════════════════════════════════════════════════
export async function renderPlayersPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  _bindRosterKeyboard();

  // Story (chronique) + quests (groupes) servent aux partenaires d'aventure.
  const [presentations, characters, achievements, story, quests] = await Promise.all([
    loadCollection('players'),
    loadCollection('characters'),
    loadCollection('achievements'),
    loadCollection('story').catch(() => []),
    loadCollection('quests').catch(() => []),
  ]);
  STORE.presentations = presentations;
  STORE.characters    = characters;
  STORE.achievements  = achievements;
  STORE.story         = story;
  STORE.quests        = quests;
  STORE.items         = _buildDataset(presentations, characters);

  // Une nouvelle ouverture de #players commence toujours par la galerie. Seule
  // une sous-route explicite restaure le registre ou le réseau de liens.
  STORE.viewMode = 'gallery';
  STORE.detailSection = 'presentation';
  STORE.mobileDetail = false;
  _restorePlayersRoute();

  if (!STORE.items.some(item => item.id === STORE.activeId)) {
    STORE.activeId = STORE.items.find(item => item.ownerUid === STATE.user?.uid && item.char?.isDefault)?.id
      || STORE.items.find(item => item.ownerUid === STATE.user?.uid)?.id
      || STORE.items[0]?.id
      || '';
  }
  // Une URL de page nue (#players) devient immédiatement l'état affiché exact.
  // Ainsi, le premier Retour après plusieurs onglets retrouve aussi cette vue.
  _syncPlayersRoute({ replace: true });

  if (!STORE.items.length) {
    content.innerHTML = `
      <div class="pp-page pp-roster-page">
        ${_renderRosterTop([])}
        <div class="pp-page-body">
          ${STATE.isAdmin
            ? `<div class="pp-empty">
            <div class="pp-empty-icon">${_ppIcon('cards')}</div>
            <p class="pp-empty-title">Aucun personnage dans le roster.</p>
          </div>`
            : `<div class="pp-empty">
            <div class="pp-empty-icon">${_ppIcon('eyeOff')}</div>
            <p class="pp-empty-title">Aucune présentation publiée.</p>
          </div>`}
        </div>
      </div>`;
    return;
  }

  _renderView(content, { restoreSection: STORE.viewMode === 'register' && STORE.detailSection !== 'presentation' });
  _initSortable();
}

let _detailSectionObserver = null;

function _setActiveDetailSection(section) {
  if (!_PLAYER_DETAIL_TABS.has(section)) return;
  STORE.detailSection = section;
  document.querySelectorAll('.pp-detail-tabs [data-section]').forEach(button => {
    const active = button.dataset.section === section;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

function _detailSectionTop(detail, sectionEl) {
  const navHeight = detail.querySelector('.pp-detail-tabs')?.offsetHeight || 0;
  return sectionEl.getBoundingClientRect().top - detail.getBoundingClientRect().top + detail.scrollTop - navHeight - 6;
}

function _scrollDetailSection(section, { smooth = true } = {}) {
  const detail = document.querySelector('.pp-register-detail');
  const sectionEl = detail?.querySelector(`[data-detail-section="${section}"]`);
  if (!detail || !sectionEl) return;
  _setActiveDetailSection(section);
  detail.scrollTo({ top: _detailSectionTop(detail, sectionEl), behavior: smooth ? 'smooth' : 'auto' });
}

function _bindDetailSectionSpy() {
  _detailSectionObserver?.disconnect();
  _detailSectionObserver = null;
  const detail = document.querySelector('.pp-register-detail');
  const sections = [...(detail?.querySelectorAll('[data-detail-section]') || [])];
  if (!detail || !sections.length || !('IntersectionObserver' in window)) return;
  _detailSectionObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    const section = visible[0]?.target?.dataset?.detailSection;
    if (section) _setActiveDetailSection(section);
  }, { root: detail, rootMargin: '-90px 0px -55% 0px', threshold: [0, .01] });
  sections.forEach(section => _detailSectionObserver.observe(section));
}

function _renderView(content, { restoreSection = false } = {}) {
  const filtered = _applyFilters(STORE.items);
  if (filtered.length && !filtered.some(item => item.id === STORE.activeId)) STORE.activeId = filtered[0].id;
  const activeItem = filtered.find(item => item.id === STORE.activeId) || null;
  const body = STORE.viewMode === 'register'
    ? `<div class="pp-register-layout ${STORE.mobileDetail ? 'is-mobile-detail' : ''}">${_renderRegisterList(filtered)}${_renderRegisterDetail(activeItem, filtered)}</div>`
    : STORE.viewMode === 'relations'
      ? _renderRelationsScreen(filtered)
      : _renderGalleryScreen(filtered);
  content.innerHTML = `
    <div class="pp-page pp-roster-page">
      ${_renderRosterTop(STORE.items)}
      <div id="pp-view-area" class="pp-roster-body">${body}</div>
    </div>`;
  _saveViewState();
  _bindDetailSectionSpy();
  if (STORE.viewMode === 'relations') _bindRelationView();
  if (restoreSection && STORE.viewMode === 'register') {
    requestAnimationFrame(() => _scrollDetailSection(STORE.detailSection, { smooth: false }));
  }
}

function _refreshView(options = {}) {
  const content = document.getElementById('main-content');
  if (!content) return;
  _renderView(content, options);
  _initSortable();
}

function _visibleRegisterItems() {
  const items = _applyFilters(STORE.items);
  if (STORE.filterSearch.trim()) return _playerGroups(items).flatMap(group => group.items);
  return _playerGroups(items).flatMap(group => STORE.collapsedGroups[group.key] ? [] : group.items);
}

function _stepRoster(direction) {
  const items = STORE.viewMode === 'register' ? _visibleRegisterItems() : _applyFilters(STORE.items);
  if (!items.length || !direction) return;
  const current = items.findIndex(item => item.id === STORE.activeId);
  const next = items[Math.max(0, Math.min(items.length - 1, (current < 0 ? 0 : current) + direction))];
  if (!next) return;
  STORE.activeId = next.id;
  if (STORE.viewMode === 'register' && window.innerWidth < 860) STORE.mobileDetail = true;
  _syncPlayersRoute({ replace: true });
  _refreshView({ restoreSection: STORE.viewMode === 'register' });
  requestAnimationFrame(() => document.querySelector('.pp-register-row.is-selected')?.scrollIntoView({ block: 'nearest' }));
}

let _rosterKeyboardBound = false;
function _bindRosterKeyboard() {
  if (_rosterKeyboardBound) return;
  _rosterKeyboardBound = true;
  document.addEventListener('keydown', event => {
    if (!document.querySelector('.pp-roster-page')) return;
    // La visionneuse de galerie possède sa propre navigation. Tant qu'elle est
    // ouverte, aucune flèche ne doit changer le personnage situé en arrière-plan.
    if (document.getElementById('pp-lightbox')) return;
    // Dans une présentation en diaporama, ←/→ appartiennent aux diapos. Les
    // touches ↑/↓ et j/k restent disponibles pour changer de personnage.
    if (document.querySelector('[data-free-page-reader][data-free-page-keyboard] [data-fpe-reader-nav]')
      && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) return;
    const active = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName) || active?.isContentEditable;
    const search = document.querySelector('.pp-roster-search input, .pp-relations-search input');
    if (event.key === 'Escape' && active === search) {
      event.preventDefault();
      if (STORE.viewMode === 'relations') {
        STORE.relQuery = '';
        STORE.relSelectedId = '';
        STORE.relTableId = null;
        STORE.relShowNever = false;
        active.value = '';
        _refreshRelationGraph();
        return;
      }
      STORE.filterSearch = '';
      _refreshView();
      return;
    }
    if (event.key === '/' && !typing) {
      event.preventDefault();
      search?.focus();
      return;
    }
    if (typing) {
      if (active?.matches?.('[data-pp-action="relationSearch"]') && event.key === 'Enter') {
        const query = _norm(STORE.relQuery);
        const first = _relationRuntimeGraph?.nodes.find(node => _norm(`${node.label} ${node.sub}`).includes(query));
        if (first) {
          event.preventDefault();
          STORE.relSelectedId = first.id;
          STORE.relTableId = null;
          STORE.relQuery = '';
          active.value = '';
          _refreshRelationGraph();
        }
        return;
      }
      if (active === search && event.key === 'Enter' && STORE.viewMode === 'gallery') {
        const first = _applyFilters(STORE.items)[0];
        if (first) {
          event.preventDefault();
          STORE.activeId = first.id;
          STORE.viewMode = 'register';
          STORE.detailSection = 'presentation';
          STORE.mobileDetail = window.innerWidth < 860;
          _syncPlayersRoute();
          _refreshView();
        }
        return;
      }
      if (active === search && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        _stepRoster(event.key === 'ArrowDown' ? 1 : -1);
        requestAnimationFrame(() => document.querySelector('.pp-roster-search input')?.focus());
      }
      return;
    }
    if (STORE.viewMode === 'relations' && event.key === 'Escape') {
      event.preventDefault();
      STORE.relSelectedId = '';
      STORE.relTableId = null;
      STORE.relShowNever = false;
      _refreshRelationGraph();
      return;
    }
    if (STORE.viewMode === 'relations' && event.key === 'Enter' && active?.classList?.contains('pp-rel-node')) {
      event.preventDefault();
      STORE.relSelectedId = active.dataset.id;
      STORE.relTableId = null;
      STORE.relShowNever = false;
      _refreshRelationGraph();
      return;
    }
    if (event.key === 'Escape' && STORE.viewMode === 'register') {
      event.preventDefault();
      STORE.viewMode = 'gallery';
      STORE.mobileDetail = false;
      _syncPlayersRoute();
      _refreshView();
      return;
    }
    if (STORE.viewMode === 'register' && ['ArrowDown', 'j'].includes(event.key)) {
      event.preventDefault(); _stepRoster(1); return;
    }
    if (STORE.viewMode === 'register' && ['ArrowUp', 'k'].includes(event.key)) {
      event.preventDefault(); _stepRoster(-1); return;
    }
    if (STORE.viewMode === 'register' && /^[1-4]$/.test(event.key)) {
      const section = ['presentation', 'gallery', 'chronicle', 'companions'][Number(event.key) - 1];
      event.preventDefault();
      _scrollDetailSection(section);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLERS — délégation data-pp-action
// ══════════════════════════════════════════════════════════════════════════════
function _selectRosterItem(id, { keepSection = false, section = 'presentation' } = {}) {
  if (!id) return;
  STORE.activeId = id;
  STORE.viewMode = 'register';
  STORE.detailSection = keepSection ? STORE.detailSection : section;
  STORE.mobileDetail = window.innerWidth < 860;
  _syncPlayersRoute();
  _refreshView({ restoreSection: keepSection || section !== 'presentation' });
  requestAnimationFrame(() => document.querySelector('.pp-register-row.is-selected')?.scrollIntoView({ block: 'nearest' }));
}

Object.assign(ppHandlers, {
  openFiche:     (el) => _selectRosterItem(el.dataset.id),
  selectItem:    (el) => _selectRosterItem(el.dataset.id, { keepSection: Boolean(el.closest('.pp-register-rail')) }),
  selectSibling: (el) => _selectRosterItem(el.dataset.id),
  openRegister:  (el) => _selectRosterItem(el.dataset.id),
  relationMode: (el) => {
    const mode = el.dataset.mode === 'players' ? 'players' : 'characters';
    if (mode === STORE.relMode) return;
    STORE.relMode = mode;
    STORE.relSelectedId = '';
    STORE.relTableId = null;
    STORE.relQuery = '';
    STORE.relShowNever = false;
    _refreshRelationView();
  },
  relationSelect: (el) => {
    const id = el.dataset.id || '';
    STORE.relSelectedId = STORE.relSelectedId === id ? '' : id;
    STORE.relTableId = null;
    STORE.relShowNever = false;
    _refreshRelationGraph();
  },
  relationClear: () => {
    if (Date.now() < _relationPanSuppressUntil) return;
    if (!STORE.relSelectedId && STORE.relTableId === null) return;
    STORE.relSelectedId = '';
    STORE.relTableId = null;
    STORE.relShowNever = false;
    _refreshRelationGraph();
  },
  relationZoom: (el) => _zoomRelation(Number(el.dataset.factor) || 1),
  relationResetView: () => {
    _relationViewports.set(STORE.relMode, { x: 0, y: 0, width: 1000, height: 680 });
    _applyRelationViewport();
  },
  relationTable: (el) => {
    const id = Number(el.dataset.table);
    STORE.relSelectedId = '';
    STORE.relTableId = STORE.relTableId === id ? null : id;
    STORE.relShowNever = false;
    _refreshRelationGraph();
  },
  relationNever: () => {
    STORE.relShowNever = !STORE.relShowNever;
    const side = document.querySelector('.pp-relations-side');
    if (side && _relationRuntimeGraph) side.innerHTML = _renderRelationSide(_relationRuntimeGraph);
  },
  relationOpen: () => {
    const node = _relationRuntimeGraph?.nodeById.get(STORE.relSelectedId);
    if (node?.item) _selectRosterItem(node.item.id, { section: 'companions' });
  },
  relationSearch: (el) => {
    STORE.relQuery = el.value;
    STORE.relSelectedId = '';
    STORE.relTableId = null;
    STORE.relShowNever = false;
    _refreshRelationGraph({ syncRoute: false });
    _syncPlayersRoute({ replace: true });
  },
  relationMin: (el) => {
    STORE.relMin = Math.max(1, Math.min(4, Number(el.value) || 1));
    const output = el.nextElementSibling;
    if (output) output.textContent = `${STORE.relMin} aventure${STORE.relMin > 1 ? 's' : ''}`;
    _refreshRelationGraph({ syncRoute: false });
  },
  mobileBack:    () => { STORE.mobileDetail = false; _refreshView(); },
  back:          ()   => { STORE.mobileDetail = false; _refreshView(); },
  search:        (el) => {
    STORE.filterSearch = el.value;
    const caret = el.selectionStart;
    _refreshView({ restoreSection: STORE.viewMode === 'register' });
    // Restaure le focus + la position du curseur après re-render
    requestAnimationFrame(() => {
      const next = document.querySelector('[data-pp-action="search"]');
      if (next) {
        next.focus();
        try { next.setSelectionRange(caret, caret); } catch {}
      }
    });
  },
  clearSearch:   ()   => { STORE.filterSearch = ''; _refreshView(); },
  setSort:       (el) => { STORE.sortBy = el.value; _refreshView(); },
  setViewMode:   (el) => {
    STORE.viewMode = el.dataset.mode || 'gallery';
    if (STORE.viewMode === 'register') STORE.detailSection = 'presentation';
    if (STORE.viewMode === 'gallery' && !STORE.grouped) STORE.sortBy = 'ordre';
    STORE.mobileDetail = false;
    _syncPlayersRoute();
    _refreshView();
  },
  toggleGrouped: (el) => {
    STORE.grouped = Boolean(el.checked);
    if (!STORE.grouped) STORE.sortBy = STORE.viewMode === 'gallery' ? 'ordre' : 'nom';
    _refreshView();
  },
  togglePlayerGroup: (el) => {
    const key = el.dataset.group;
    if (!key) return;
    STORE.collapsedGroups[key] = !STORE.collapsedGroups[key];
    _saveViewState();
    _refreshView({ restoreSection: true });
  },
  jumpDetailSection: (el) => _scrollDetailSection(el.dataset.section),
  fullscreenPresentation: (el) => {
    const reader = el.closest('.pp-detail-bio')?.querySelector('[data-free-page-reader]');
    if (!reader) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    reader.requestFullscreen?.().catch(() => showNotif('Plein écran indisponible.', 'info'));
  },
  stepItem:      (el) => _stepRoster(Number(el.dataset.step) || 0),
  openCharacter: (el) => openCharacterSheetFromShowcase(el.dataset.charId),
  toggleChronique: (el) => {
    const charId = el.dataset.charId;
    if (!charId) return;
    const y = window.scrollY || 0;
    STORE.chroniqueExpanded[charId] = !STORE.chroniqueExpanded[charId];
    _refreshView({ restoreSection: true });
    requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: 'auto' }));
  },
  togglePartenaires: (el) => {
    const charId = el.dataset.charId;
    if (!charId) return;
    const y = window.scrollY || 0;
    STORE.partenairesExpanded[charId] = !STORE.partenairesExpanded[charId];
    _refreshView({ restoreSection: true });
    requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: 'auto' }));
  },
  openChroniqueMission: async (el) => {
    const id = el.dataset.id;
    if (!id) return;
    try {
      await navigate('story');
      const { openStoryDetail } = await import('./story.js');
      await openStoryDetail(id);
    } catch (err) {
      console.warn('[players] ouverture mission chronique impossible', err);
      showNotif('Impossible d’ouvrir cette mission dans la Trame.', 'error');
    }
  },
  resetFilters:  ()   => {
    STORE.filterSearch = '';
    _refreshView();
  },
  toggleVisible: (el) => _toggleVisible(el.dataset.id),
  lightbox:      (el) => _openLightbox(el.dataset.presId, parseInt(el.dataset.idx, 10) || 0),
  editPres:      (el) => _editPlayerPresent(el.dataset.id),
  editItem:      (el) => _editPlayerItem(el.dataset.id),
  newPlayer:     ()   => openPlayerPresentModal(),
});

async function _toggleVisible(id) {
  const item = STORE.items.find(i => i.id === id);
  if (!item || !_canManageItem(item)) return;
  const newVal = !(item.visible !== false);
  if (!item.presentationId) {
    if (!item.charId) return;
    const created = await tryUpsert('players', null, {
      charId: item.charId,
      visible: newVal,
      ordre: item.ordre ?? 999,
      content: '',
      imageUrl: '',
    });
    if (created) await PAGES.players();
    return;
  }
  try {
    await updateInCol('players', item.presentationId, { visible: newVal });
    item.visible = newVal;
    // Refresh local pour reflet immédiat
    _refreshView();
  } catch { showNotif('Erreur lors du changement de visibilité.', 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SORTABLE (admin : drag pour réordonner)
// ══════════════════════════════════════════════════════════════════════════════
let _ppSortable = null;
let _ppGallerySortable = null;
async function _persistRosterOrder(container) {
  const movedIds = [...container.querySelectorAll('[data-pp-id]')].map(el => el.dataset.ppId).filter(Boolean);
  if (!movedIds.length) return;

  // Quand la galerie est filtrée, seules les positions occupées par le
  // sous-ensemble visible sont remplacées. Les personnages masqués par le
  // filtre gardent ainsi leur place relative.
  const localOrder = _getLocalOrdre() || [];
  const rank = item => {
    const stored = Number(item.ordre);
    if (Number.isFinite(stored) && stored !== 999) return stored;
    const localIndex = localOrder.indexOf(item.id);
    return localIndex >= 0 ? localIndex + 1 : Number.MAX_SAFE_INTEGER;
  };
  const ordered = [...STORE.items].sort((a, b) => rank(a) - rank(b)
    || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
  const movedSet = new Set(movedIds);
  const slots = ordered.map((item, index) => movedSet.has(item.id) ? index : -1).filter(index => index >= 0);
  const byId = new Map(STORE.items.map(item => [item.id, item]));
  slots.forEach((slot, index) => { ordered[slot] = byId.get(movedIds[index]); });

  const writes = [];
  ordered.forEach((item, index) => {
    if (!item) return;
    const ordre = index + 1;
    if (Number(item.ordre) !== ordre && item.presentationId) {
      writes.push(updateInCol('players', item.presentationId, { ordre }));
    }
    item.ordre = ordre;
  });
  _setLocalOrdre(ordered.filter(Boolean).map(item => item.id));
  await Promise.all(writes);
}

function _initSortable() {
  _ppSortable?.destroy();
  _ppSortable = null;
  if (!STATE.isAdmin || STORE.viewMode !== 'gallery' || STORE.grouped || STORE.sortBy !== 'ordre') return;
  const list = document.getElementById('pp-gallery-grid');
  if (!list) return;
  _ppSortable = makeSortable(list, {
    prefix: 'pp',
    draggable: '.pp-gallery-card',
    handle: '.pp-gallery-drag',
    filter: 'a, input, select, textarea, .btn, .btn-icon',
    delay: 80,
    swapThreshold: .62,
    fallbackTolerance: 4,
    onEnd: async () => {
      try {
        await _persistRosterOrder(list);
      } catch (error) {
        console.warn('[players] réorganisation impossible', error);
        showNotif('Impossible d’enregistrer ce nouvel ordre.', 'error');
      }
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — création / édition (upload + crop illustration)
// ══════════════════════════════════════════════════════════════════════════════
const _PP_VIS_GROUPS = [
  {
    label: 'Fiche publique',
    items: [
      { id:'pp-show-lvl', label:'Niveau', key:'afficherNiveau', def:true },
      { id:'pp-show-tags', label:'Traits', key:'afficherTags', def:true },
      { id:'pp-show-citation', label:'Citation', key:'afficherCitation', def:true },
      { id:'pp-show-bio', label:'Présentation', key:'afficherBio', def:true },
      { id:'pp-show-identite', label:'Identité', key:'afficherIdentite', def:true },
      { id:'pp-show-stats', label:'Caractéristiques', key:'afficherStats', def:true },
      { id:'pp-show-equip', label:'Équipement', key:'afficherEquip', def:true },
    ],
  },
  {
    label: 'Vitaux', note: 'Visibles par le MJ uniquement',
    items: [
      { id:'pp-show-pv', label:'PV', key:'afficherPV', def:true },
      { id:'pp-show-pm', label:'PM', key:'afficherPM', def:true },
      { id:'pp-show-ca', label:'CA', key:'afficherCA', def:true },
      { id:'pp-show-or', label:'Or', key:'afficherOr', def:false },
    ],
  },
];
const _PP_VIS_ENTRIES = _PP_VIS_GROUPS.flatMap(group => group.items);

function _ppModalChar() {
  const id = document.getElementById('pp-char-id')?.value || _ppEditingPlayer?.charId || '';
  return STORE.characters.find(char => char.id === id) || null;
}

function _ppModalFlag(key) {
  const entry = _PP_VIS_ENTRIES.find(item => item.key === key);
  return document.getElementById(entry?.id)?.checked ?? entry?.def ?? true;
}

function _ppModalCropParams() {
  return _ppCardCropper?.getCropParams?.() || _ppCardCropParams || null;
}

function _ppModalPreviewItem(char) {
  return {
    nom: char?.nom || _ppEditingPlayer?.nom || 'Nouvelle présentation',
    initials: _initials(char?.nom || _ppEditingPlayer?.nom || '?'),
    imageUrl: _ppModalImageUrl,
    portraitUrl: _ppModalImageUrl,
    cardCrop: _ppModalCropParams(),
  };
}

function _ppModalWordCount() {
  const text = document.querySelector('#pp-content .ql-editor')?.textContent?.trim() || '';
  const words = text ? text.split(/\s+/).length : 0;
  const target = document.getElementById('pp-mn-word-count');
  if (target) target.textContent = `${words} mot${words > 1 ? 's' : ''}`;
}

function _ppMarkModalDirty() {
  if (_ppModalDirty) return;
  _ppModalDirty = true;
  _ppRenderModalFooter();
}

function _ppRenderModalFooter() {
  const footer = document.getElementById('pp-mn-footer');
  if (!footer) return;
  if (_ppModalConfirm === 'delete') {
    footer.innerHTML = `<div class="pp-mn-confirm">Supprimer la présentation ? <button type="button" class="is-danger" data-pp-action="confirmPresentationDelete" data-id="${_esc(_ppEditingPlayer?.id || '')}">Supprimer</button><button type="button" data-pp-action="cancelPresentationConfirm">Annuler</button></div>`;
    return;
  }
  if (_ppModalConfirm === 'close') {
    footer.innerHTML = `<div class="pp-mn-confirm">Fermer sans enregistrer ? <button type="button" class="is-danger" data-pp-action="discardPresentationChanges">Fermer</button><button type="button" data-pp-action="cancelPresentationConfirm">Continuer les modifications</button></div>`;
    return;
  }
  footer.innerHTML = `${_ppEditingPlayer?.id ? `<button type="button" class="pp-mn-foot-btn is-delete" data-pp-action="askPresentationDelete">${_ppIcon('trash')} Supprimer</button>` : '<span></span>'}<span class="pp-mn-foot-space"></span><span class="pp-mn-dirty ${_ppModalDirty ? 'is-dirty' : ''}">${_ppModalDirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}</span><button type="button" class="pp-mn-foot-btn" data-pp-action="cancelPresentation">Annuler</button><button type="button" class="pp-mn-foot-btn is-primary" data-pp-action="save" data-id="${_esc(_ppEditingPlayer?.id || '')}">Enregistrer <kbd>Ctrl S</kbd></button>`;
}

function _ppUpdateModalHeader() {
  const char = _ppModalChar();
  const name = char?.nom || _ppEditingPlayer?.nom || 'Nouvelle présentation';
  const player = char?.ownerPseudo || _ppEditingPlayer?.joueur || 'Sans joueur';
  const title = document.getElementById('pp-mn-title');
  const overline = document.getElementById('pp-mn-overline');
  if (title) title.textContent = name;
  if (overline) overline.textContent = `Présentation · ${player}`;
  const sheet = document.getElementById('pp-mn-open-sheet');
  if (sheet) sheet.disabled = !char?.id;
}

function _ppRenderModalPreview() {
  const root = document.getElementById('pp-mn-preview-body');
  if (!root) return;
  const char = _ppModalChar();
  const item = _ppModalPreviewItem(char);
  const level = Number(char?.niveau) || 1;
  const tags = Array.isArray(char?.tags) ? char.tags : [];
  const identity = _identityRows({ identity: Array.isArray(char?.identity) ? char.identity : [] });
  const previewStatOrder = ['force', 'dexterite', 'constitution', 'intelligence', 'sagesse', 'charisme'];
  const stats = char ? previewStatOrder.map(key => {
    const meta = STAT_META.find(entry => entry.key === key);
    return { label: statShort(key).toUpperCase(), value: _getStat(char, key), color: meta?.color || '#7eb0ff' };
  }) : [];
  const equipment = char ? getEquipmentSlots().map(slot => {
    const equipped = char.equipement?.[slot.id];
    return equipped?.nom ? { slot: slot.label, name: equipped.nom } : null;
  }).filter(Boolean) : [];
  const plain = _plainExcerpt(getQuillHtml('pp-content') || _ppEditingPlayer?.content || '', 170);
  const card = `<div class="pp-mn-pv-card ${_ppModalVisible ? '' : 'is-hidden'}"><div class="pp-mn-pv-image">${_portrait(item, 'pp-gallery-portrait')}${_ppModalFlag('afficherNiveau') ? `<em data-v="afficherNiveau">Niv. ${level}</em>` : ''}${_ppModalVisible ? '' : `<span>${_ppIcon('lock')} Masqué</span>`}</div><div class="pp-mn-pv-copy"><b>${_esc(item.nom)}</b><small>${_esc([char?.classe, char?.race].filter(Boolean).join(' · '))}</small><i>${_esc(char?.ownerPseudo || 'Sans joueur')}</i></div></div>`;
  const vitals = [
    _ppModalFlag('afficherPV') ? `<span data-v="afficherPV"><i>PV</i><b>${char?.pvActuel ?? calcPVMax(char || {})}/${calcPVMax(char || {})}</b></span>` : '',
    _ppModalFlag('afficherPM') ? `<span data-v="afficherPM"><i>PM</i><b>${char?.pmActuel ?? calcPMMax(char || {})}/${calcPMMax(char || {})}</b></span>` : '',
    _ppModalFlag('afficherCA') ? `<span data-v="afficherCA"><i>CA</i><b>${calcCA(char || {})}</b></span>` : '',
    _ppModalFlag('afficherOr') ? `<span data-v="afficherOr"><i>OR</i><b>${calcOr(char || {})}</b></span>` : '',
  ].filter(Boolean);
  const fiche = `<div class="pp-mn-pv-sheet"><header>${_portrait(item, 'pp-mn-pv-portrait')}<div><h4>${_esc(item.nom)}</h4><p>${_esc([char?.classe, char?.race].filter(Boolean).join(' · '))}${_ppModalFlag('afficherNiveau') ? ` · <b data-v="afficherNiveau">Niv. ${level}</b>` : ''}</p>${_ppModalFlag('afficherTags') && tags.length ? `<div class="pp-mn-pv-tags" data-v="afficherTags">${tags.map(tag => `<span>${_esc(tag)}</span>`).join('')}</div>` : ''}${_ppModalFlag('afficherCitation') && char?.quote ? `<q data-v="afficherCitation">«${_esc(char.quote)}»</q>` : ''}</div></header>${vitals.length ? `<div class="pp-mn-pv-vitals">${vitals.join('')}<small>${_ppIcon('lock')} MJ</small></div>` : ''}${_ppModalFlag('afficherBio') ? `<p class="pp-mn-pv-bio" data-v="afficherBio">${plain || '<i>Pas encore de présentation.</i>'}</p>` : ''}${_ppModalFlag('afficherIdentite') && identity.length ? `<dl data-v="afficherIdentite">${identity.map(row => `<dt>${_esc(row.key)}</dt><dd>${_esc(row.value)}</dd>`).join('')}</dl>` : ''}${_ppModalFlag('afficherStats') && stats.length ? `<div class="pp-mn-pv-stats" data-v="afficherStats">${stats.map(stat => `<span style="--pp-stat:${stat.color}"><i>${_esc(stat.label)}</i><b>${stat.value}</b><em>${modStr(getModFromScore(stat.value))}</em></span>`).join('')}</div>` : ''}${_ppModalFlag('afficherEquip') && equipment.length ? `<ul data-v="afficherEquip">${equipment.map(row => `<li><span>${_esc(row.slot)}</span><b>${_esc(row.name)}</b></li>`).join('')}</ul>` : ''}</div>`;
  root.innerHTML = _ppModalPreview === 'card' ? card : fiche;
  document.querySelectorAll('[data-pp-preview]').forEach(button => button.classList.toggle('is-active', button.dataset.ppPreview === _ppModalPreview));
  const note = document.getElementById('pp-mn-preview-note');
  if (note) note.textContent = _ppModalVisible ? 'Visible par tous les joueurs dans la Galerie.' : 'Masquée : seuls toi et le MJ la voyez.';
}

async function openPlayerPresentModal(player = null) {
  const characters = STORE.characters.length ? STORE.characters : await loadCollection('characters');
  const selectableCharacters = STATE.isAdmin ? characters : characters.filter(_canManageCharacter);
  const curCharId = player?.charId || '';
  const rawGallery = Array.isArray(player?.gallery) ? player.gallery.map(photo => ({ ...photo })) : [];
  _ppEditingPlayer = player;
  _ppModalImageUrl = player?.imageUrl || '';
  _ppCardCropParams = player?.cardCrop || null;
  _ppModalVisible = player?.visible !== false;
  _ppModalPreview = globalThis.matchMedia?.('(max-width: 900px)')?.matches ? 'card' : 'sheet';
  _ppModalDirty = false;
  _ppModalConfirm = '';
  _ppGallery = rawGallery.filter(photo => _ppModalImageUrl || !photo?.portrait);
  if (_ppModalImageUrl && !_ppGallery.some(photo => photo?.portrait)) _ppGallery.unshift({ portrait: true });

  const linkedChar = characters.find(char => char.id === curCharId) || null;
  const title = linkedChar?.nom || player?.nom || 'Nouvelle présentation';
  const owner = linkedChar?.ownerPseudo || player?.joueur || 'Sans joueur';
  const visibilityHtml = _PP_VIS_GROUPS.map(group => `<div class="pp-mn-vis-group">
    <h4>${_esc(group.label)}${group.note ? `<small>${_ppIcon('lock')} ${_esc(group.note)}</small>` : ''}</h4>
    <div class="pp-mn-vis-list">${group.items.map(item => {
      const checked = player?.[item.key] !== undefined ? player[item.key] : item.def;
      return `<button type="button" class="pp-mn-vis-pill ${checked ? 'is-on' : ''}" data-vis-key="${item.key}" data-vis-input="${item.id}" aria-pressed="${checked}">
        <span class="pp-mn-vis-icons" aria-hidden="true">${_ppIcon('eye', 'pp-icon is-visible')}${_ppIcon('eyeOff', 'pp-icon is-hidden')}</span><span>${_esc(item.label)}</span>
      </button><input class="pp-mn-vis-input" type="checkbox" id="${item.id}" ${checked ? 'checked' : ''} tabindex="-1" aria-hidden="true">`;
    }).join('')}</div>
  </div>`).join('');

  openModal('', `<div class="pp-mn-shell">
    <header class="pp-mn-header">
      <div class="pp-mn-heading"><small id="pp-mn-overline">Présentation · ${_esc(owner)}</small><h2 id="pp-mn-title">${_esc(title)}</h2></div>
      <div class="pp-mn-publish" aria-label="Publication">
        <button type="button" class="${_ppModalVisible ? 'is-on' : ''}" data-pp-action="setPresentationVisibility" data-visible="true">${_ppIcon('eye')} Publiée</button>
        <button type="button" class="${!_ppModalVisible ? 'is-on is-off' : ''}" data-pp-action="setPresentationVisibility" data-visible="false">${_ppIcon('eyeOff')} Masquée</button>
      </div>
      <button type="button" class="pp-mn-close" data-pp-action="cancelPresentation" aria-label="Fermer">${_ppIcon('x')}</button>
    </header>

    <div class="pp-mn-layout">
      <main class="pp-mn-editor">
        <section class="pp-mn-block">
          <div class="pp-mn-block-head"><h3>Personnage</h3></div>
          <div class="pp-mn-link-row">
            <label class="pp-mn-select">${_ppIcon('link')}<select id="pp-char-id" ${STATE.isAdmin ? '' : 'disabled'}>
              <option value="">— Aucun personnage lié —</option>
              ${selectableCharacters.map(char => `<option value="${_esc(char.id)}" ${char.id === curCharId ? 'selected' : ''}>${_esc(char.nom || '?')}${char.classe ? ` — ${_esc(char.classe)}` : ''}${char.ownerPseudo ? ` (${_esc(char.ownerPseudo)})` : ''}</option>`).join('')}
            </select>${_ppIcon('chevronDown', 'pp-icon pp-mn-select-arrow')}</label>
            <button type="button" id="pp-mn-open-sheet" class="pp-mn-mini-link" data-pp-action="openPresentationCharacter" ${linkedChar ? '' : 'disabled'}>${_ppIcon('external')} Fiche de jeu</button>
          </div>
          <p class="pp-mn-hint pp-mn-link-hint">Classe, race, niveau, traits, citation et identité viennent de la fiche de jeu.</p>
        </section>

        <section class="pp-mn-block">
          <div class="pp-mn-block-head"><h3>Images <em id="pp-mn-image-count">${_ppGallery.length}/${PP_GALLERY_MAX}</em></h3><span class="pp-mn-hint">Glisse pour réordonner · ★ = portrait de la carte</span></div>
          <div id="pp-gallery-list" class="pp-mn-images"></div>
          <div id="pp-gallery-status" class="pp-mn-status" aria-live="polite"></div>
          <div id="pp-card-crop-host"></div>
        </section>

        <section class="pp-mn-block">
          <div class="pp-mn-block-head"><h3>Présentation</h3><span id="pp-mn-word-count" class="pp-mn-hint">0 mot</span></div>
          ${quillEditorHtml({ id: 'pp-content', html: player?.content || player?.bio || '', minHeight: 210, placeholder: 'Décris librement ce personnage…' })}
        </section>

        <section class="pp-mn-block">
          <div class="pp-mn-block-head"><h3>Ce que voient les autres joueurs</h3><span class="pp-mn-hint">Survole une option pour la repérer dans l’aperçu.</span></div>
          ${visibilityHtml}
        </section>
      </main>

      <aside class="pp-mn-preview">
        <div class="pp-mn-preview-head"><span>Aperçu</span><div class="pp-mn-segment"><button type="button" class="${_ppModalPreview === 'card' ? 'is-active' : ''}" data-pp-action="setPresentationPreview" data-pp-preview="card">Carte</button><button type="button" class="${_ppModalPreview === 'sheet' ? 'is-active' : ''}" data-pp-action="setPresentationPreview" data-pp-preview="sheet">Fiche</button></div></div>
        <div id="pp-mn-preview-body" class="pp-mn-preview-body"></div>
        <p id="pp-mn-preview-note" class="pp-mn-preview-note"></p>
      </aside>
    </div>
    <footer id="pp-mn-footer" class="pp-mn-footer"></footer>
  </div>`);

  const shell = document.querySelector('.pp-mn-shell');
  await bindQuillEditors(shell, { onUserEdit: () => {
    _ppMarkModalDirty();
    _ppModalWordCount();
    _ppRenderModalPreview();
  } });
  _renderGalleryEditor();
  _ppRenderCropEditor();
  _ppRenderModalFooter();
  _ppModalWordCount();
  _ppRenderModalPreview();

  const onChange = event => {
    if (event.target.id === 'pp-char-id') {
      _ppUpdateModalHeader();
      _ppRenderModalPreview();
      _ppMarkModalDirty();
    }
  };
  const onClick = event => {
    const pill = event.target.closest?.('.pp-mn-vis-pill');
    if (!pill || !shell?.contains(pill)) return;
    event.preventDefault();
    event.stopPropagation();
    const input = document.getElementById(pill.dataset.visInput || '');
    if (!input) return;
    input.checked = !input.checked;
    pill.classList.toggle('is-on', input.checked);
    pill.setAttribute('aria-pressed', String(input.checked));
    _ppRenderModalPreview();
    _ppMarkModalDirty();
  };
  const onOver = event => {
    const pill = event.target.closest('.pp-mn-vis-pill');
    if (!pill || pill.contains(event.relatedTarget)) return;
    _ppHighlightPreview(pill.dataset.visKey);
  };
  const onOut = event => {
    const pill = event.target.closest('.pp-mn-vis-pill');
    if (!pill || pill.contains(event.relatedTarget)) return;
    document.querySelectorAll('#pp-mn-preview-body .is-highlighted').forEach(node => node.classList.remove('is-highlighted'));
  };
  const onKeydown = event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    _savePlayerPresent(_ppEditingPlayer?.id || '');
  };
  shell?.addEventListener('change', onChange);
  shell?.addEventListener('click', onClick);
  shell?.addEventListener('mouseover', onOver);
  shell?.addEventListener('mouseout', onOut);
  document.addEventListener('keydown', onKeydown);
  const closed = () => _ppCleanupPresentationModal();
  document.addEventListener('app:modal-closed', closed, { once: true });
  _ppModalCleanup = () => {
    shell?.removeEventListener('change', onChange);
    shell?.removeEventListener('click', onClick);
    shell?.removeEventListener('mouseover', onOver);
    shell?.removeEventListener('mouseout', onOut);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('app:modal-closed', closed);
  };
  setModalCloseGuard(() => {
    if (!_ppModalDirty) return false;
    _ppModalConfirm = 'close';
    _ppRenderModalFooter();
    return true;
  });
  (player ? document.querySelector('#pp-content .ql-editor') : document.getElementById('pp-char-id'))?.focus();
}

function _renderGalleryEditor() {
  const list = document.getElementById('pp-gallery-list');
  if (!list) return;
  _ppGallerySortable?.destroy(); _ppGallerySortable = null;
  list.innerHTML = `${_ppGallery.map((photo, index) => {
    const isPortrait = !!photo?.portrait;
    const src = isPortrait ? _ppModalImageUrl : (photo?.thumb || photo?.url || '');
    return `<article class="pp-mn-thumb ${isPortrait ? 'is-portrait' : ''}" data-gal-idx="${index}">
      <img src="${_esc(src)}" alt="Photo ${index + 1}" loading="lazy">
      <span class="pp-mn-thumb-grip" title="Réordonner">${_ppIcon('grip')}</span>
      ${isPortrait
        ? `<span class="pp-mn-thumb-flag">${_ppIcon('star')} Portrait</span>`
        : `<button type="button" class="pp-mn-thumb-star" data-pp-action="setGalleryPortrait" data-idx="${index}" title="Utiliser comme portrait">${_ppIcon('star')}</button>`}
      <button type="button" class="pp-mn-thumb-delete" data-pp-action="removeGalleryPhoto" data-idx="${index}" title="Retirer">${_ppIcon('x')}</button>
    </article>`;
  }).join('')}${_ppGallery.length < PP_GALLERY_MAX ? `<button type="button" id="pp-gallery-drop" class="pp-mn-image-add">${_ppIcon('upload')}<b>Ajouter</b><small>${CLOUDINARY_ENABLED ? 'Glisser, coller ou cliquer' : 'Coller une URL'}</small></button>` : ''}`;
  const count = document.getElementById('pp-mn-image-count');
  if (count) count.textContent = `${_ppGallery.length}/${PP_GALLERY_MAX}`;
  _ppGallerySortable = makeSortable(list, {
    prefix: 'pp',
    draggable: '.pp-mn-thumb',
    handle: '.pp-mn-thumb-grip',
    filter: 'button',
    delay: 70,
    fallbackTolerance: 4,
    onEnd: () => {
      const newOrder = [...list.querySelectorAll('[data-gal-idx]')]
        .map(el => parseInt(el.dataset.galIdx, 10))
        .map(i => _ppGallery[i])
        .filter(Boolean);
      _ppGallery = newOrder;
      _ppMarkModalDirty();
      _renderGalleryEditor();
    },
  });
  _bindPlayerGalleryAdd();
}

function _ppAddGalleryPhoto(photo) {
  if (!photo?.url || _ppGallery.length >= PP_GALLERY_MAX) return;
  if (!_ppModalImageUrl) {
    _ppModalImageUrl = photo.url;
    _ppGallery.push({ portrait: true });
    _ppCardCropParams = null;
  } else {
    _ppGallery.push(photo);
  }
  _ppMarkModalDirty();
  _renderGalleryEditor();
  _ppRenderCropEditor();
  _ppRenderModalPreview();
}

function _bindPlayerGalleryAdd() {
  const drop = document.getElementById('pp-gallery-drop');
  if (!drop) return;
  if (!CLOUDINARY_ENABLED) {
    drop.addEventListener('click', async () => {
      let url = (await promptModal('Colle l’URL de la photo :', {
        title: 'Photo par URL',
        placeholder: 'https://…github.io/le-grand-jdr/images/…',
      }))?.trim();
      if (!url) return;
      url = normalizeImageUrl(url);
      _ppAddGalleryPhoto({ url, thumb: url, deleteUrl: '' });
      const status = document.getElementById('pp-gallery-status');
      if (status) status.textContent = 'Photo ajoutée.';
    });
    return;
  }
  bindImageUploadDropZone(drop, {
    onImage: async ({ file }) => {
      const status = document.getElementById('pp-gallery-status');
      if (!file || _ppGallery.length >= PP_GALLERY_MAX) return;
      if (!hasCloudinaryConfig()) {
        if (status) status.textContent = 'Configuration de l’hébergement requise.';
        openCloudinaryConfigModal();
        return;
      }
      if (status) status.textContent = 'Import en cours…';
      try {
        const encoded = await uploadJpeg(file, PP_GALLERY_UPLOAD);
        const uploaded = await uploadCloudinary(encoded, { folder: 'gallery', tags: ['gallery'] });
        _ppAddGalleryPhoto({ url: uploaded.url, thumb: uploaded.thumbUrl || '', deleteUrl: '' });
        if (status) status.textContent = 'Photo ajoutée.';
      } catch (error) {
        console.error('[players gallery]', error);
        if (status) status.textContent = `Import impossible : ${error?.message || 'erreur inconnue'}`;
      }
    },
  });
}

function _ppRenderCropEditor({ restore = true } = {}) {
  const host = document.getElementById('pp-card-crop-host');
  if (!host) return;
  _ppCardCropper?.destroy();
  _ppCardCropper = null;
  if (!_ppModalImageUrl) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `<div class="pp-mn-crop">
    <div class="pp-mn-crop-main"><div id="pp-card-zone"><img id="pp-card-img" alt="" draggable="false"><span class="pp-mn-crop-grid"></span></div></div>
    <div class="pp-mn-crop-copy"><b>Cadrage du portrait</b><p>Glisse l’image et zoome. L’aperçu à droite se met à jour en direct. Le cadrage est enregistré avec le reste, sans bouton « Confirmer ».</p><label class="pp-mn-crop-zoom"><span>Zoom</span><input type="range" id="pp-card-zoom" min="0.1" max="4" step="0.01" value="1"><output id="pp-card-zoom-output">100 %</output></label><button type="button" class="pp-mn-ghost" data-pp-action="resetCardCrop">${_ppIcon('reset')} Recentrer</button></div>
  </div>`;
  const syncZoomOutput = () => {
    const ratio = _ppCardCropper?.getZoomRatio?.();
    const output = document.getElementById('pp-card-zoom-output');
    if (output && Number.isFinite(ratio)) output.textContent = `${Math.round(ratio * 100)} %`;
  };
  _ppCardCropper = attachPanZoomCrop({
    idPrefix: 'pp-card',
    dataUrl: _ppModalImageUrl,
    viewW: 150,
    viewH: 200,
    background: '#0b1118',
    constrainCover: true,
    onChange: () => {
      _ppCardCropParams = _ppCardCropper?.getCropParams?.() || _ppCardCropParams;
      syncZoomOutput();
      _ppMarkModalDirty();
      _ppRenderModalPreview();
    },
  });
  if (restore && _ppCardCropParams) _ppCardCropper?.setCropParams?.(_ppCardCropParams);
  document.getElementById('pp-card-img')?.addEventListener('load', () => requestAnimationFrame(syncZoomOutput), { once: true });
}

function _ppSetGalleryPortrait(index) {
  const photo = _ppGallery[index];
  if (!photo || photo.portrait || !photo.url) return;
  const previousIndex = _ppGallery.findIndex(entry => entry?.portrait);
  if (previousIndex >= 0) {
    _ppGallery[previousIndex] = { url: _ppModalImageUrl, thumb: _ppModalImageUrl, deleteUrl: '' };
  }
  _ppModalImageUrl = photo.url;
  _ppGallery[index] = { portrait: true };
  _ppCardCropParams = null;
  _ppMarkModalDirty();
  _renderGalleryEditor();
  _ppRenderCropEditor({ restore: false });
  _ppRenderModalPreview();
}

function _ppRemoveGalleryPhoto(index) {
  const photo = _ppGallery[index];
  if (!photo) return;
  const wasPortrait = !!photo.portrait;
  _ppGallery.splice(index, 1);
  if (wasPortrait) {
    const replacementIndex = _ppGallery.findIndex(entry => entry?.url);
    if (replacementIndex >= 0) {
      _ppModalImageUrl = _ppGallery[replacementIndex].url;
      _ppGallery[replacementIndex] = { portrait: true };
    } else {
      _ppModalImageUrl = '';
    }
    _ppCardCropParams = null;
  }
  _ppMarkModalDirty();
  _renderGalleryEditor();
  _ppRenderCropEditor({ restore: false });
  _ppRenderModalPreview();
}

function _ppHighlightPreview(key) {
  if (key !== 'afficherNiveau' && _ppModalPreview !== 'sheet') {
    _ppModalPreview = 'sheet';
    _ppRenderModalPreview();
  }
  requestAnimationFrame(() => document.querySelectorAll(`#pp-mn-preview-body [data-v="${key}"]`).forEach(node => node.classList.add('is-highlighted')));
}

function _ppCleanupPresentationModal() {
  _ppModalCleanup?.();
  _ppModalCleanup = null;
  _ppGallerySortable?.destroy();
  _ppGallerySortable = null;
  _ppCardCropper?.destroy();
  _ppCardCropper = null;
  clearModalCloseGuard();
}

// ── Modal handlers ────────────────────────────────────────────────────────────
Object.assign(ppHandlers, {
  save: el => _savePlayerPresent(el.dataset.id || ''),
  cancelPresentation: () => closeModalDirect(),
  cancelPresentationConfirm: () => { _ppModalConfirm = ''; _ppRenderModalFooter(); },
  discardPresentationChanges: () => {
    _ppModalDirty = false;
    clearModalCloseGuard();
    closeModalDirect();
  },
  askPresentationDelete: () => { _ppModalConfirm = 'delete'; _ppRenderModalFooter(); },
  confirmPresentationDelete: el => _deletePlayerPresent(el.dataset.id, { confirmed: true }),
  setPresentationVisibility: el => {
    _ppModalVisible = el.dataset.visible === 'true';
    document.querySelectorAll('[data-pp-action="setPresentationVisibility"]').forEach(button => {
      const active = button.dataset.visible === String(_ppModalVisible);
      button.classList.toggle('is-on', active);
      button.classList.toggle('is-off', active && !_ppModalVisible);
    });
    _ppRenderModalPreview();
    _ppMarkModalDirty();
  },
  setPresentationPreview: el => {
    _ppModalPreview = el.dataset.ppPreview === 'sheet' ? 'sheet' : 'card';
    _ppRenderModalPreview();
  },
  openPresentationCharacter: async () => {
    const charId = document.getElementById('pp-char-id')?.value || '';
    if (!charId) return;
    if (_ppModalDirty) {
      _ppModalConfirm = 'close';
      _ppRenderModalFooter();
      return;
    }
    clearModalCloseGuard();
    closeModalDirect();
    await openCharacterSheetFromShowcase(charId);
  },
  setGalleryPortrait: el => _ppSetGalleryPortrait(parseInt(el.dataset.idx, 10)),
  removeGalleryPhoto: el => _ppRemoveGalleryPhoto(parseInt(el.dataset.idx, 10)),
  resetCardCrop: () => {
    _ppCardCropParams = null;
    _ppRenderCropEditor({ restore: false });
    _ppRenderModalPreview();
    _ppMarkModalDirty();
  },
});

async function _savePlayerPresent(id = '') {
  const charId = document.getElementById('pp-char-id')?.value || '';
  const linkedChar = STORE.characters.find(char => char.id === charId);
  if (!STATE.isAdmin && !_canManageCharacter(linkedChar)) {
    showNotif('Tu ne peux modifier que la présentation de ton personnage.', 'error');
    return;
  }
  const existing = id ? STORE.presentations.find(p => p.id === id) : null;
  const imageUrl = _ppModalImageUrl;
  const cardCrop = imageUrl ? (_ppModalCropParams() || existing?.cardCrop || null) : null;
  const data = {
      charId,
      content:        getQuillHtml('pp-content'),
      imageUrl,
      cardCrop,
      ordre:          existing?.ordre ?? 999,
      visible:        _ppModalVisible,
      afficherPV:     document.getElementById('pp-show-pv')?.checked    ?? true,
      afficherPM:     document.getElementById('pp-show-pm')?.checked    ?? true,
      afficherCA:     document.getElementById('pp-show-ca')?.checked    ?? true,
      afficherOr:     document.getElementById('pp-show-or')?.checked    ?? false,
      afficherStats:  document.getElementById('pp-show-stats')?.checked ?? true,
      afficherNiveau: document.getElementById('pp-show-lvl')?.checked   ?? true,
      afficherEquip:     document.getElementById('pp-show-equip')?.checked     ?? true,
      afficherIdentite:  document.getElementById('pp-show-identite')?.checked  ?? true,
      afficherCitation:  document.getElementById('pp-show-citation')?.checked  ?? true,
      afficherBio:       document.getElementById('pp-show-bio')?.checked       ?? true,
      afficherTags:      document.getElementById('pp-show-tags')?.checked      ?? true,
      gallery:        _ppGallery.slice(0, PP_GALLERY_MAX),
  };
  if (!await tryUpsert('players', id || null, data)) return;
  _ppModalDirty = false;
  clearModalCloseGuard();
  closeModalDirect();
  showNotif('Présentation enregistrée.', 'success');
  await PAGES.players();
}

async function _deletePlayerPresent(id, { confirmed = false } = {}) {
  const snapshot = STORE.presentations.find(p => p.id === id);
  if (!await confirmDelete('players', id, 'Supprimer cette présentation ?', {
    snapshot,
    successMessage: 'Présentation supprimée.',
    onRestore: () => PAGES.players(),
    confirmed,
  })) return;
  STORE.activeId = '';
  _ppModalDirty = false;
  clearModalCloseGuard();
  closeModalDirect();
  await PAGES.players();
}

async function _editPlayerPresent(id) {
  const items = await loadCollection('players');
  const p = items.find(e => e.id === id);
  if (!p) return;
  const char = STORE.characters.find(c => c.id === p.charId);
  if (_canManageCharacter(char)) openPlayerPresentModal(p);
}

async function _editPlayerItem(id) {
  const item = STORE.items.find(entry => entry.id === id);
  if (!item || !_canManageItem(item)) return;
  if (item.presentationId) {
    await _editPlayerPresent(item.presentationId);
    return;
  }
  if (item.charId) openPlayerPresentModal({ charId: item.charId, visible: item.visible });
}

// ── Lightbox galerie (overlay plein écran, pas une modale scrollable) ──────
function _openLightbox(presId, startIdx = 0) {
  const item = STORE.items.find(i => i.presentationId === presId || i.id === presId);
  const photos = item?.gallery || [];
  if (!photos.length) return;
  let idx = Math.max(0, Math.min(startIdx, photos.length - 1));

  // Nettoyage d'une éventuelle lightbox précédente
  document.getElementById('pp-lightbox')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pp-lightbox';
  overlay.className = 'pp-lightbox';
  overlay.innerHTML = `
    <div class="pp-lightbox-media">
      <img class="pp-lightbox-img" alt="" title="Cliquer pour zoomer">
    </div>
    <div class="pp-lightbox-counter"></div>
    ${photos.length > 1 ? `
      <button type="button" class="pp-lightbox-nav pp-lightbox-prev" aria-label="Précédente">‹</button>
      <button type="button" class="pp-lightbox-nav pp-lightbox-next" aria-label="Suivante">›</button>
    ` : ''}
    <button type="button" class="pp-lightbox-close" aria-label="Fermer">✕</button>
  `;
  document.body.appendChild(overlay);

  const mediaEl = overlay.querySelector('.pp-lightbox-media');
  const imgEl   = overlay.querySelector('.pp-lightbox-img');
  const countEl = overlay.querySelector('.pp-lightbox-counter');

  const resetZoom = () => {
    mediaEl.classList.remove('is-zoomed', 'is-panning');
    imgEl.style.removeProperty('width');
    imgEl.style.removeProperty('height');
    imgEl.title = 'Cliquer pour zoomer';
    mediaEl.scrollTo({ left: 0, top: 0 });
  };
  const render = () => {
    const g = photos[idx];
    resetZoom();
    imgEl.src = g.url;
    imgEl.alt = `Photo ${idx + 1} de ${item.nom}`;
    countEl.textContent = `${idx + 1} / ${photos.length}`;
  };
  const close = () => {
    overlay.classList.add('is-closing');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => overlay.remove(), 180);
  };
  const next = () => { idx = (idx + 1) % photos.length; render(); };
  const prev = () => { idx = (idx - 1 + photos.length) % photos.length; render(); };
  const onKey = (e) => {
    if (!['Escape', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else prev();
  };
  // Capture avant les raccourcis du registre et ceux du lecteur de diapos.
  document.addEventListener('keydown', onKey, true);

  // Clic sur le fond (mais pas sur l'image ni les contrôles) → fermer.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target === mediaEl && !mediaEl.classList.contains('is-zoomed'))) close();
  });
  overlay.querySelector('.pp-lightbox-close').addEventListener('click', close);
  overlay.querySelector('.pp-lightbox-prev')?.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  overlay.querySelector('.pp-lightbox-next')?.addEventListener('click', (e) => { e.stopPropagation(); next(); });

  // Même interaction que dans les Hauts-Faits : clic pour zoomer dans la
  // visionneuse, puis glisser pour explorer l'image sans ouvrir une autre vue.
  const PAN_THRESHOLD = 4;
  let panActive = false;
  let panMoved = false;
  let panX = 0;
  let panY = 0;
  let panLeft = 0;
  let panTop = 0;

  imgEl.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0 || !mediaEl.classList.contains('is-zoomed')) return;
    panActive = true;
    panMoved = false;
    panX = event.clientX;
    panY = event.clientY;
    panLeft = mediaEl.scrollLeft;
    panTop = mediaEl.scrollTop;
    imgEl.setPointerCapture?.(event.pointerId);
    mediaEl.classList.add('is-panning');
    event.preventDefault();
  });
  imgEl.addEventListener('pointermove', (event) => {
    if (!panActive) return;
    const dx = event.clientX - panX;
    const dy = event.clientY - panY;
    if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) panMoved = true;
    mediaEl.scrollLeft = panLeft - dx;
    mediaEl.scrollTop = panTop - dy;
  });
  const endPan = (event) => {
    if (!panActive) return;
    panActive = false;
    mediaEl.classList.remove('is-panning');
    imgEl.releasePointerCapture?.(event.pointerId);
  };
  imgEl.addEventListener('pointerup', endPan);
  imgEl.addEventListener('pointercancel', endPan);

  imgEl.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panMoved) {
      panMoved = false;
      return;
    }

    if (mediaEl.classList.contains('is-zoomed')) {
      resetZoom();
      return;
    }

    const bounds = mediaEl.getBoundingClientRect();
    const imageRatio = imgEl.naturalWidth / imgEl.naturalHeight;
    if (!Number.isFinite(imageRatio) || imageRatio <= 0 || !bounds.width || !bounds.height) return;
    const frameRatio = bounds.width / bounds.height;
    const fittedWidth = imageRatio >= frameRatio ? bounds.width : bounds.height * imageRatio;
    const fittedHeight = imageRatio >= frameRatio ? bounds.width / imageRatio : bounds.height;
    const focusX = (event.clientX - bounds.left) / bounds.width;
    const focusY = (event.clientY - bounds.top) / bounds.height;

    mediaEl.classList.add('is-zoomed');
    imgEl.title = 'Cliquer pour dézoomer';
    imgEl.style.width = `${Math.round(fittedWidth * 2)}px`;
    imgEl.style.height = `${Math.round(fittedHeight * 2)}px`;
    requestAnimationFrame(() => {
      mediaEl.scrollLeft = Math.max(0, focusX * imgEl.scrollWidth - bounds.width / 2);
      mediaEl.scrollTop = Math.max(0, focusY * imgEl.scrollHeight - bounds.height / 2);
    });
  });

  render();
}

// ── Compat publique (anciens points d'entrée référencés ailleurs) ─────────────
async function openCharacterSheetFromShowcase(charId) {
  if (!charId) return;
  await navigate('characters');
  setTimeout(() => {
    const pill = Array.from(document.querySelectorAll('#char-pills .char-pill'))
      .find(e => e.dataset.charid === charId || e.getAttribute('onclick')?.includes(`'${charId}'`));
    if (pill) { pill.click(); return; }
    const c = STATE.characters?.find(e => e.id === charId);
    if (c) { STATE.activeChar = c; charSession.renderSheet(c); }
  }, 50);
}

// ── Override + exports ────────────────────────────────────────────────────────
PAGES.players = renderPlayersPage;

window.openCharacterSheetFromShowcase = openCharacterSheetFromShowcase;
