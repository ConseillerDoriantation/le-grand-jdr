// ══════════════════════════════════════════════════════════════════════════════
// PLAYERS.JS — Roster de campagne
//
// Présentation narrative des personnages de l'aventure. Deux vues :
//  • Sommaire (galerie immersive) : cards riches avec portrait, niveau, vitaux
//    autorisés, joueur, traits, filtrables par recherche/tag/joueur.
//  • Fiche (présentation détaillée) : hero immersif + 2 colonnes (narratif
//    + sidebar stats/équipement/compétences/hauts-faits).
//
// Admin : drag pour réordonner, toggle visibilité, modal de création/édition
// avec illustration cropable et confidentialité des infos de jeu.
//
// Pattern d'événements : data-pp-action="X" + handlers dans `ppHandlers`
// (cohérent avec bestiary/shop).
// ══════════════════════════════════════════════════════════════════════════════
import Sortable from '../vendor/sortable.esm.js';
import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import PAGES from './pages.js';
import { _esc, _nl2br, _norm, _initials } from '../shared/html.js';
import {
  getMod, calcCA, calcPVMax, calcPMMax, calcOr, calcVitesse, STAT_META,
} from '../shared/char-stats.js';
import { attachDropAndCrop, attachPanZoomCrop, panZoomCropHTML, resizeImageDataUrl } from '../shared/image-crop.js';
import { bindImageUploadDropZone, uploadJpeg } from '../shared/image-upload.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal } from '../shared/upload-cloudinary.js';
import { lsJson } from '../shared/local-storage.js';
import { richTextEditorHtml, getRichTextHtml, richTextContentHtml, bindRichTextEditors } from '../shared/rich-text.js';
import { bindScopedActions } from '../shared/scoped-actions.js';

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

// ── État module ───────────────────────────────────────────────────────────────
let _ppCropper = null;             // cropper de l'illustration de la fiche (sélection)
let _ppCardCropper = null;         // cropper de l'image de la card (pan-zoom 3:4)
let _ppCardCropParams = null;      // { offX, offY, imgW, imgH } après confirmation
let _ppGallery = [];               // galerie en cours d'édition (URLs externes uniquement)
const PP_GALLERY_MAX = 12;         // pas de limite stricte de taille : on stocke des URLs
const PP_GALLERY_UPLOAD = { max: 1600, quality: 0.88 }; // compression avant upload Cloudinary
const STORE = {
  items:         [],     // dataset assemblé (perso + presentation)
  activeId:      '',     // id de l'item ouvert en fiche (vide = sommaire)
  filterSearch:  '',
  filterJoueur:  '',
  sortBy:        'ordre',   // 'ordre' (custom MJ) | 'nom' | 'niveau' | 'joueur' | 'classe'
  viewMode:      'gallery', // 'gallery' | 'relations'
  relSelected:   null,      // Set<charId> | null (null = tous visibles)
  relPositions:  {},        // charId → {x,y} (positions custom après drag, en coords SVG)
  relPickerOpen: false,
  presentations: [],
  characters:    [],
  achievements:  [],
  story:         [],     // missions / événements de trame (pour top compagnons)
};

// localStorage : ordre fallback hors-ligne (admin réordonne)
const _LS_KEY = 'pp-ordre';
const _getLocalOrdre = () => lsJson.get(_LS_KEY, null);
const _setLocalOrdre = ids => lsJson.set(_LS_KEY, ids);

// ══════════════════════════════════════════════════════════════════════════════
// DONNÉES — assemblage perso × présentation
// ══════════════════════════════════════════════════════════════════════════════
const _getStat = (c, k) => Math.min(22, (c?.stats?.[k] || 8) + (c?.statsBonus?.[k] || 0));

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
    ownerUid:       char?.uid || pres?.uid || '',
    nom, classe, race, joueur,
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
    tags:           pres?.tags || [],
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
  const myUid = STATE.user?.uid;
  return items
    // Public : on masque les fiches non-visibles. Exceptions : le MJ voit tout,
    // et un joueur voit TOUJOURS son ou ses propres personnages (même masqués).
    .filter(item => STATE.isAdmin || item.visible !== false || (myUid && item.ownerUid === myUid))
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
  const joueur = STORE.filterJoueur;
  const filtered = items.filter(it => {
    if (s) {
      const hay = _norm([it.nom, it.classe, it.race, it.joueur, (it.tags || []).join(' ')].join(' '));
      if (!hay.includes(s)) return false;
    }
    if (joueur && it.joueur !== joueur) return false;
    return true;
  });
  // Tri secondaire (en plus du tri par ordre MJ par défaut)
  const sortBy = STORE.sortBy;
  if (sortBy && sortBy !== 'ordre') {
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
  return STORE.story
    .filter(ev => {
      // Inclut si participant direct OU membre d'un groupe
      if ((ev.participants || []).some(p => p.id === currentCharId)) return true;
      return (ev.groupes || []).some(g => (g.membres || []).includes(currentCharId));
    })
    .sort((a, b) => {
      // Trier par date desc si dispo, sinon par ordre
      const da = a.date || '', db = b.date || '';
      if (da && db) return db.localeCompare(da);
      return (b.ordre ?? 0) - (a.ordre ?? 0);
    })
    .slice(0, limit);
}

// ── Calcul des partenaires d'aventure (basé sur story.groupes) ────────────────
// Les "groupes" dans la trame sont des sous-équipes qu'on attache à une mission
// (ex: "Groupe A", "Groupe B" qui ont fait la mission ensemble). Cette fonction
// compte combien de fois chaque autre PJ a été dans le MÊME groupe que le PJ
// courant — révélateur des vrais partenaires de mission, pas juste de la
// liste de participants d'une mission.
//
// Fallback : si aucun groupe ne contient le PJ, on retombe sur les participants
// globaux de la mission (compat avec les vieilles missions sans groupes).
function _computeTopAdventurers(currentCharId, items, limit = 4) {
  if (!currentCharId || !STORE.story.length) return [];
  const counter = new Map();
  STORE.story.forEach(ev => {
    const groupes = Array.isArray(ev.groupes) ? ev.groupes : [];
    const myGroupes = groupes.filter(g => (g.membres || []).includes(currentCharId));
    if (myGroupes.length) {
      // Co-occurrences DANS les mêmes groupes
      myGroupes.forEach(g => {
        (g.membres || []).forEach(id => {
          if (id === currentCharId) return;
          counter.set(id, (counter.get(id) || 0) + 1);
        });
      });
    } else {
      // Fallback : participants globaux (anciennes missions sans groupes)
      const ids = (ev.participants || []).map(p => p.id).filter(Boolean);
      if (!ids.includes(currentCharId)) return;
      ids.forEach(id => {
        if (id === currentCharId) return;
        counter.set(id, (counter.get(id) || 0) + 1);
      });
    }
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
function _renderHero(items, filtered) {
  const joueurs = new Set(items.map(i => i.joueur).filter(Boolean));
  const classes = new Set(items.map(i => i.classe).filter(Boolean));
  const joueursList = [...joueurs].sort((a, b) => a.localeCompare(b, 'fr'));
  const isFiltered = !!(STORE.filterSearch || STORE.filterJoueur);

  return `
  <div class="pp-hero">
    <div class="pp-hero-band">
      <div class="pp-hero-title-block">
        <div class="pp-hero-eyebrow">Compagnons d'Aventure</div>
        <h1 class="pp-hero-title">✦ Roster de Campagne ✦</h1>
      </div>
      <div class="pp-hero-stats">
        <div class="pp-hero-stat"><div class="pp-hero-stat-num">${items.length}</div><div class="pp-hero-stat-lbl">Personnage${items.length>1?'s':''}</div></div>
        <div class="pp-hero-stat"><div class="pp-hero-stat-num">${joueurs.size}</div><div class="pp-hero-stat-lbl">Joueur${joueurs.size>1?'s':''}</div></div>
        <div class="pp-hero-stat"><div class="pp-hero-stat-num">${classes.size}</div><div class="pp-hero-stat-lbl">Classe${classes.size>1?'s':''}</div></div>
      </div>
    </div>

    <div class="pp-filters">
      <div class="pp-filter-search">
        <span class="pp-filter-icon">🔍</span>
        <input type="text" placeholder="Rechercher un nom, une classe, un trait…"
          value="${_esc(STORE.filterSearch || '')}"
          data-pp-action="search" data-pp-on="input">
        ${STORE.filterSearch ? `<button class="pp-filter-clear" data-pp-action="clearSearch" title="Effacer">✕</button>` : ''}
      </div>
      ${joueursList.length > 1 ? `
        <select class="pp-filter-select" data-pp-action="setJoueur" data-pp-on="change" aria-label="Filtrer par joueur">
          <option value="">Tous les joueurs</option>
          ${joueursList.map(j => `<option value="${_esc(j)}" ${STORE.filterJoueur===j?'selected':''}>${_esc(j)}</option>`).join('')}
        </select>` : ''}
      <select class="pp-filter-select" data-pp-action="setSort" data-pp-on="change" aria-label="Trier par" title="Trier le sommaire">
        <option value="ordre"  ${STORE.sortBy==='ordre' ?'selected':''}>↕ Ordre manuel</option>
        <option value="nom"    ${STORE.sortBy==='nom'   ?'selected':''}>A → Z</option>
        <option value="niveau" ${STORE.sortBy==='niveau'?'selected':''}>Niveau ↓</option>
        <option value="joueur" ${STORE.sortBy==='joueur'?'selected':''}>Joueur</option>
        <option value="classe" ${STORE.sortBy==='classe'?'selected':''}>Classe</option>
      </select>
      ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" data-pp-action="newPlayer">+ Présentation</button>` : ''}
      ${isFiltered ? `<button class="pp-filter-reset" data-pp-action="resetFilters" title="Réinitialiser tous les filtres">↺ Réinitialiser</button>` : ''}
      <div class="pp-view-toggle" role="tablist" aria-label="Mode d'affichage">
        <button class="pp-view-tab ${STORE.viewMode==='gallery'?'is-active':''}"
          data-pp-action="setViewMode" data-mode="gallery" title="Galerie de cards" role="tab">🎴 Galerie</button>
        <button class="pp-view-tab ${STORE.viewMode==='relations'?'is-active':''}"
          data-pp-action="setViewMode" data-mode="relations" title="Carte des liens d'aventure" role="tab">🕸️ Relations</button>
      </div>
    </div>

    ${isFiltered ? `
      <div class="pp-filter-meta">
        ${filtered.length} résultat${filtered.length>1?'s':''} sur ${items.length}
      </div>` : ''}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU — CARTE IMMERSIVE DANS LA GALERIE
// ══════════════════════════════════════════════════════════════════════════════
function _renderCard(item, idx) {
  const col = _accentColor(item.nom);
  const locked = !item.content && !item.bio && !item.portraitUrl && !item.imageUrl;
  const hidden = item.visible === false;
  const isAdmin = STATE.isAdmin;

  // Image affichée dans la card : utilise imageUrl avec un crop CSS optionnel.
  // Le cadrage admin (pan-zoom) génère { offX, offY, imgW } qu'on applique en CSS.
  const cardImg = item.imageUrl || '';
  const cc = item.cardCrop;
  // Style positionnement de l'image dans la card. Si pas de cardCrop : cover.
  const cardImgStyle = cc
    ? `position:absolute;left:${(cc.offX*100).toFixed(2)}%;top:${(cc.offY*100).toFixed(2)}%;width:${(cc.imgW*100).toFixed(2)}%;height:auto;max-width:none`
    : 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';

  // Vitaux mini (badges discrets sous le nom)
  const vitaux = [
    item.afficherPV && item.pvMax !== null
      ? `<span class="pp-card-vital pp-card-vital--pv">❤ ${item.pvActuel ?? item.pvMax}<small>/${item.pvMax}</small></span>` : '',
    item.afficherPM && item.pmMax !== null
      ? `<span class="pp-card-vital pp-card-vital--pm">✦ ${item.pmActuel ?? item.pmMax}<small>/${item.pmMax}</small></span>` : '',
    item.afficherCA && item.ca !== null
      ? `<span class="pp-card-vital pp-card-vital--ca">🛡 ${item.ca}</span>` : '',
    item.afficherOr && item.gold !== null
      ? `<span class="pp-card-vital pp-card-vital--or">🪙 ${item.gold}</span>` : '',
  ].filter(Boolean);

  // Tags max 2 visibles (gain de place — détaillés sur la fiche)
  const tagsHtml = (item.tags || []).slice(0, 2).map(t => {
    const [bg, bc, c] = _tagColor(t);
    return `<span class="pp-card-tag" style="background:${bg};border-color:${bc};color:${c}">${_esc(t)}</span>`;
  }).join('') + ((item.tags || []).length > 2
    ? `<span class="pp-card-tag pp-card-tag--more">+${(item.tags || []).length - 2}</span>` : '');

  return `
  <article class="pp-card${hidden?' is-hidden':''}${locked?' is-locked':''}" data-pp-id="${_esc(item.id)}"
    style="--card-accent:${col}">
    ${isAdmin ? `<div class="pp-card-drag" title="Réordonner">⠿</div>` : ''}
    ${isAdmin ? `
      <div class="pp-card-admin">
        <button class="pp-card-admin-btn" title="${hidden?'Afficher':'Masquer'} aux joueurs"
          data-pp-action="toggleVisible" data-id="${_esc(item.id)}">${hidden?'🚫':'👁'}</button>
        ${item.presentationId ? `<button class="pp-card-admin-btn" title="Modifier"
          data-pp-action="editPres" data-id="${_esc(item.presentationId)}">✏️</button>` : ''}
      </div>` : ''}

    <button class="pp-card-clickarea" data-pp-action="openFiche" data-id="${_esc(item.id)}">
      <!-- Image — prend tout l'espace de la card (ratio 3:4).
           Le cadrage admin (pan-zoom) sauvegarde les coords dans cardCrop
           qu'on applique en CSS inline. Aucun stockage de base64 dupliqué. -->
      <div class="pp-card-image-wrap">
        ${cardImg
          ? `<img class="pp-card-image" src="${_esc(cardImg)}" alt="" style="${cardImgStyle}"
              loading="lazy" decoding="async" referrerpolicy="no-referrer">`
          : `<div class="pp-card-image-empty">${item.initials}</div>`}
        <!-- Badges flottants -->
        ${item.afficherNiveau ? `<span class="pp-card-level">Niv. ${item.level}</span>` : ''}
        ${hidden ? `<span class="pp-card-hidden-badge">🔒 Masqué</span>` : ''}
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
  const heroHtml = _renderHero(items, filtered);

  if (!filtered.length) {
    return heroHtml + `
      <div class="pp-empty">
        <div class="pp-empty-icon">🕯️</div>
        <p class="pp-empty-title">Aucun personnage ne correspond à ta recherche.</p>
        <p class="pp-empty-sub">Essaie de modifier les filtres ou de les réinitialiser.</p>
      </div>`;
  }

  if (STORE.viewMode === 'relations') {
    return heroHtml + _renderRelationsView(filtered);
  }

  return heroHtml + `
    <div id="pp-gallery" class="pp-gallery">
      ${filtered.map((it, idx) => _renderCard(it, idx)).join('')}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU — VUE RELATIONS (graph SVG circulaire des co-aventures)
// ══════════════════════════════════════════════════════════════════════════════
function _computeRelationEdges(items) {
  // Map charId → item
  const byCharId = new Map();
  items.forEach(it => { if (it.charId) byCharId.set(it.charId, it); });

  // Compteur paire {a, b} (a<b alphabétique) → nb d'aventures partagées.
  // IMPORTANT : on ne lie QUE les PJ qui étaient dans le MÊME groupe d'une
  // même mission. Deux groupes différents sur la même mission ne se sont
  // pas croisés → aucune relation entre eux.
  const pairCount = new Map();
  const story = STORE.story || [];
  for (const ev of story) {
    const groupes = ev.groupes || [];
    if (!groupes.length) continue;  // pas de groupe défini → pas de relation déductible
    for (const g of groupes) {
      const present = (g.membres || []).filter(id => byCharId.has(id));
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const [a, b] = [present[i], present[j]].sort();
          const k = `${a}|${b}`;
          pairCount.set(k, (pairCount.get(k) || 0) + 1);
        }
      }
    }
  }
  return { byCharId, pairCount };
}

const REL_W = 1000, REL_H = 1000;
const REL_NODE_R = 36;

function _renderRelationsView(items) {
  const allPJ = items.filter(i => i.charId);
  if (!allPJ.length) {
    return `<div class="pp-empty"><div class="pp-empty-icon">🕸️</div>
      <p class="pp-empty-title">Pas encore de PJ lié à une fiche.</p></div>`;
  }

  // Sélection : si `relSelected` est null, tous les PJ sont visibles
  const selected = STORE.relSelected;
  const visible = selected ? allPJ.filter(p => selected.has(p.charId)) : allPJ;
  const nodes = visible.length ? visible : allPJ;   // fallback : jamais vide

  const { pairCount } = _computeRelationEdges(nodes);

  // Layout : positions stockées en priorité, sinon cercle
  const cx = REL_W / 2, cy = REL_H / 2;
  const R = Math.min(REL_W, REL_H) * 0.36;
  const n = nodes.length;
  const positioned = nodes.map((it, i) => {
    const stored = STORE.relPositions[it.charId];
    if (stored) {
      return { it, x: stored.x, y: stored.y, col: _accentColor(it.nom) };
    }
    const a = (-Math.PI / 2) + (i * 2 * Math.PI / n);
    return { it, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), col: _accentColor(it.nom) };
  });
  const posByCharId = new Map(positioned.map(p => [p.it.charId, p]));

  const maxCount = Math.max(1, ...pairCount.values());
  const edges = [...pairCount.entries()].map(([k, count]) => {
    const [a, b] = k.split('|');
    const pa = posByCharId.get(a); const pb = posByCharId.get(b);
    if (!pa || !pb) return null;
    return { pa, pb, count, strength: count / maxCount, a, b };
  }).filter(Boolean);

  // Defs : un clipPath par node pour clipper l'image en cercle
  const defsSvg = `<defs>
    ${positioned.map(p => `<clipPath id="pp-rel-clip-${_esc(p.it.charId)}">
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${REL_NODE_R}"/>
    </clipPath>`).join('')}
  </defs>`;

  const edgesSvg = edges.map(e => {
    const w = 1 + 5 * e.strength;
    const op = 0.18 + 0.6 * e.strength;
    return `<line data-edge="${_esc(e.a)}|${_esc(e.b)}"
                  x1="${e.pa.x.toFixed(1)}" y1="${e.pa.y.toFixed(1)}"
                  x2="${e.pb.x.toFixed(1)}" y2="${e.pb.y.toFixed(1)}"
                  stroke="var(--gold)" stroke-width="${w.toFixed(2)}" opacity="${op.toFixed(2)}"
                  class="pp-rel-edge"><title>${_esc(e.pa.it.nom)} ↔ ${_esc(e.pb.it.nom)} — ${e.count} aventure${e.count>1?'s':''}</title></line>`;
  }).join('');

  const nodesSvg = positioned.map(p => {
    const r = REL_NODE_R;
    const it = p.it;
    const c = it.char || {};
    // Comme les tokens VTT : on utilise char.photo avec photoX/photoY
    const photo = c.photo || it.imageUrl || '';
    const initials = _esc(it.initials || (it.nom || '?').slice(0,2).toUpperCase());

    let portraitSvg;
    if (photo) {
      // photoX/Y dans [-1, 1] : on les traduit en décalage de l'image dans le viewport circulaire
      // Pour que photoX=photoY=0 soit centré et photoX=1 décale d'un demi-rayon vers la droite
      const fx = c.photoX || 0, fy = c.photoY || 0;
      const imgSize = r * 2.4;        // image légèrement plus grande que le cercle (zoom natif)
      const imgX = p.x - imgSize/2 - fx * r;
      const imgY = p.y - imgSize/2 - fy * r;
      portraitSvg = `<image href="${_esc(photo)}"
        x="${imgX.toFixed(1)}" y="${imgY.toFixed(1)}"
        width="${imgSize.toFixed(1)}" height="${imgSize.toFixed(1)}"
        clip-path="url(#pp-rel-clip-${_esc(it.charId)})"
        preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      portraitSvg = `<text x="${p.x}" y="${p.y}" text-anchor="middle" dy=".35em"
        font-family="Cinzel, serif" font-weight="700" font-size="16"
        fill="var(--text)">${initials}</text>`;
    }

    return `<g class="pp-rel-node" data-char-id="${_esc(it.charId)}" data-id="${_esc(it.id)}"
             style="--node-col:${p.col}" tabindex="0" role="button" aria-label="${_esc(it.nom)}">
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 3}" fill="var(--bg-card)" stroke="${p.col}" stroke-width="3" class="pp-rel-ring"/>
      ${portraitSvg}
      <text x="${p.x.toFixed(1)}" y="${(p.y + r + 18).toFixed(1)}" text-anchor="middle"
        font-family="Cinzel, serif" font-size="13" font-weight="600"
        fill="var(--text)" class="pp-rel-label">${_esc(it.nom)}</text>
    </g>`;
  }).join('');

  // Picker des PJ visibles
  const isAllSelected = !selected;
  const pickerHtml = `
    <div class="pp-rel-picker ${STORE.relPickerOpen ? 'is-open' : ''}">
      <button type="button" class="pp-rel-picker-toggle" data-pp-action="relTogglePicker">
        👥 ${isAllSelected ? `Tous les PJ (${allPJ.length})` : `${selected.size} / ${allPJ.length} PJ`}
        <span class="pp-rel-picker-caret">${STORE.relPickerOpen ? '▴' : '▾'}</span>
      </button>
      ${STORE.relPickerOpen ? `
        <div class="pp-rel-picker-panel">
          <div class="pp-rel-picker-actions">
            <button type="button" class="btn btn-outline btn-sm" data-pp-action="relSelectAll">Tout sélectionner</button>
            <button type="button" class="btn btn-outline btn-sm" data-pp-action="relSelectNone">Aucun</button>
            <button type="button" class="btn btn-outline btn-sm" data-pp-action="relResetPositions" title="Remet les PJ en cercle">↺ Repositionner</button>
          </div>
          <div class="pp-rel-picker-list">
            ${allPJ.map(p => {
              const checked = !selected || selected.has(p.charId);
              const c = p.char || {};
              const photoPos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
              const photo = c.photo || p.imageUrl || '';
              return `<label class="pp-rel-picker-item">
                <input type="checkbox" data-pp-action="relToggleChar" data-pp-on="change"
                  data-char-id="${_esc(p.charId)}" ${checked ? 'checked' : ''}>
                <span class="pp-rel-picker-portrait">
                  ${photo
                    ? `<img src="${_esc(photo)}" style="object-position:${photoPos}" alt="">`
                    : `<span class="pp-rel-picker-init">${_esc((p.nom||'?')[0].toUpperCase())}</span>`}
                </span>
                <span class="pp-rel-picker-name">${_esc(p.nom)}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>`;

  return `
    <div class="pp-relations">
      <div class="pp-relations-header">
        <div class="pp-relations-hint">
          Glisse les portraits pour les déplacer · clique pour ouvrir la fiche · les traits or relient les PJ ayant aventuré dans le <strong>même groupe</strong>.
        </div>
        ${pickerHtml}
      </div>
      <div class="pp-relations-stage">
        <svg viewBox="0 0 ${REL_W} ${REL_H}" class="pp-relations-svg" preserveAspectRatio="xMidYMid meet">
          ${defsSvg}
          ${edgesSvg}
          ${nodesSvg}
        </svg>
      </div>
    </div>`;
}

// Drag des nœuds : convertit clientX/Y → coords SVG, met à jour les positions
// stockées dans STORE.relPositions, et déplace nœud + arêtes liées en live.
function _bindRelationsDrag() {
  const svg = document.querySelector('.pp-relations-svg');
  if (!svg || svg._dragBound) return;
  svg._dragBound = true;

  const clientToSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const out = pt.matrixTransform(ctm.inverse());
    return { x: out.x, y: out.y };
  };

  let dragging = null;  // { charId, node, offsetX, offsetY, moved }

  svg.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.pp-rel-node');
    if (!node) return;
    const charId = node.dataset.charId;
    if (!charId) return;
    e.preventDefault();
    const ring = node.querySelector('.pp-rel-ring');
    const cx = parseFloat(ring.getAttribute('cx'));
    const cy = parseFloat(ring.getAttribute('cy'));
    const p = clientToSvg(e.clientX, e.clientY);
    dragging = { charId, node, offsetX: p.x - cx, offsetY: p.y - cy, moved: false, startX: cx, startY: cy };
    node.setPointerCapture?.(e.pointerId);
    node.classList.add('is-dragging');
  });

  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = clientToSvg(e.clientX, e.clientY);
    const x = p.x - dragging.offsetX;
    const y = p.y - dragging.offsetY;
    if (!dragging.moved && (Math.abs(x - dragging.startX) > 2 || Math.abs(y - dragging.startY) > 2)) {
      dragging.moved = true;
    }
    _moveRelNode(dragging.node, dragging.charId, x, y);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    const { charId, node, moved, startX, startY } = dragging;
    const ring = node.querySelector('.pp-rel-ring');
    const x = parseFloat(ring.getAttribute('cx'));
    const y = parseFloat(ring.getAttribute('cy'));
    node.classList.remove('is-dragging');
    node.releasePointerCapture?.(e.pointerId);
    if (moved) {
      STORE.relPositions[charId] = { x, y };
    } else {
      // Clic simple sans drag → ouvrir la fiche
      const id = node.dataset.id;
      if (id) { STORE.activeId = id; _refreshView(); window.scrollTo(0, 0); }
    }
    dragging = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}

// Déplace en live un nœud (ring + image + label + clipPath + edges liées)
function _moveRelNode(node, charId, x, y) {
  const ring = node.querySelector('.pp-rel-ring');
  if (ring) { ring.setAttribute('cx', x); ring.setAttribute('cy', y); }
  const img = node.querySelector('image');
  if (img) {
    const w = parseFloat(img.getAttribute('width'));
    const h = parseFloat(img.getAttribute('height'));
    // Conserve l'offset photoX/Y déjà appliqué : on recalc en partant du centre
    img.setAttribute('x', x - w / 2);
    img.setAttribute('y', y - h / 2);
  }
  const label = node.querySelector('.pp-rel-label');
  if (label) {
    label.setAttribute('x', x);
    label.setAttribute('y', y + REL_NODE_R + 18);
  }
  // Le clipPath dédié à ce charId doit suivre
  const clipCircle = document.querySelector(`#pp-rel-clip-${CSS.escape(charId)} circle`);
  if (clipCircle) { clipCircle.setAttribute('cx', x); clipCircle.setAttribute('cy', y); }
  // Met à jour toutes les arêtes touchant ce charId
  document.querySelectorAll('.pp-rel-edge').forEach(line => {
    const [a, b] = (line.dataset.edge || '').split('|');
    if (a === charId) { line.setAttribute('x1', x); line.setAttribute('y1', y); }
    if (b === charId) { line.setAttribute('x2', x); line.setAttribute('y2', y); }
  });
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
        const photoPos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
        const photo = c.photo || it.imageUrl || '';
        const accent = _accentColor(it.nom);
        const portrait = photo
          ? `<img src="${_esc(photo)}" style="object-position:${photoPos}" alt="">`
          : `<div class="pp-strip-portrait-empty" style="--accent:${accent}">${_esc((it.nom||'?')[0].toUpperCase())}</div>`;
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
  const vitaux = [
    item.afficherPV && item.pvMax !== null
      ? `<div class="pp-vital pp-vital--pv"><div class="pp-vital-lbl">PV</div><div class="pp-vital-val">${item.pvActuel ?? item.pvMax}<small>/${item.pvMax}</small></div></div>` : '',
    item.afficherPM && item.pmMax !== null
      ? `<div class="pp-vital pp-vital--pm"><div class="pp-vital-lbl">PM</div><div class="pp-vital-val">${item.pmActuel ?? item.pmMax}<small>/${item.pmMax}</small></div></div>` : '',
    item.afficherCA && item.ca !== null
      ? `<div class="pp-vital pp-vital--ca"><div class="pp-vital-lbl">CA</div><div class="pp-vital-val">${item.ca}</div></div>` : '',
    item.afficherOr && item.gold !== null
      ? `<div class="pp-vital pp-vital--or"><div class="pp-vital-lbl">Or</div><div class="pp-vital-val">${item.gold}</div></div>` : '',
  ].filter(Boolean);

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
        <h3 class="pp-fiche-card-title">📜 Identité</h3>
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
    ? (item.content
        ? richTextContentHtml({ html: item.content, className: 'pp-rich-content' })
        : item.bio
          ? `<div class="pp-bio-legacy">${_nl2br(item.bio)}</div>`
          : `<div class="pp-narrative-empty">Aucune présentation pour ce personnage pour l'instant.</div>`)
    : `<div class="pp-narrative-empty">Biographie masquée par le PJ.</div>`;

  // ── Sections sidebar (stats / équipement / hauts-faits / partenaires) ─
  const statsHtml = item.afficherStats && item.stats.length
    ? `<section class="pp-fiche-card">
        <h3 class="pp-fiche-card-title">Statistiques</h3>
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

  return `
  <div class="pp-fiche" style="--fiche-accent:${col}">

    <!-- Toolbar sticky : retour + édition admin + strip de navigation -->
    <nav class="pp-fiche-toolbar">
      <button class="pp-toolbar-back" data-pp-action="back">
        <span class="pp-toolbar-back-icon">←</span>
        <span class="pp-toolbar-back-text">Roster</span>
      </button>
      ${stripHtml}
      ${STATE.isAdmin && item.presentationId
        ? `<button class="btn btn-outline btn-sm pp-toolbar-edit" data-pp-action="editPres" data-id="${_esc(item.presentationId)}">✏️ Modifier</button>`
        : ''}
    </nav>

    <!-- Badge masqué : visible par le MJ et par le propriétaire de la fiche -->
    ${!item.visible && (STATE.isAdmin || (item.ownerUid && item.ownerUid === STATE.user?.uid))
      ? `<div class="pp-fiche-hidden-banner">🔒 ${STATE.isAdmin
          ? 'Cette présentation est masquée aux joueurs'
          : 'Ta présentation est masquée — seuls toi et le MJ la voyez'}</div>`
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
            ${item.joueur ? `<span class="pp-fiche-meta-item">👤 ${_esc(item.joueur)}</span>` : ''}
            ${item.afficherNiveau ? `<span class="pp-fiche-level">Niv. ${item.level}</span>` : ''}
          </div>
          ${vitaux.length ? `<div class="pp-fiche-vitals">${vitaux.join('')}</div>` : ''}
        </div>
      </div>

      <!-- Colonne centrale : narratif principal -->
      <div class="pp-fiche-narrative-col">
        ${titlesHtml}
        ${tagsHtml}
        ${citationHtml}

        ${item.afficherBio ? `<section class="pp-fiche-card pp-fiche-narrative">
          <h3 class="pp-fiche-card-title">Présentation</h3>
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
  const size = opts.size || 260;
  const cx = size / 2, cy = size / 2;
  const R  = size * 0.36;          // rayon des axes
  const RL = size * 0.46;          // rayon labels
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
      const mod = Math.floor((Math.min(22, s.value) - 10) / 2);
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      tooltip.innerHTML = `
        <div class="pp-hex-tip-label" style="color:${s.color}">${s.label}</div>
        <div class="pp-hex-tip-val">${s.value}<span class="pp-hex-tip-mod">${modStr}</span></div>`;
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
  const main  = equip['Main principale'];
  const sec   = equip['Main secondaire'];
  const tete  = equip['Tête'];
  const torse = equip['Torse'];
  const pieds = equip['Bottes'] || equip['Pieds'];

  const rows = [
    main && main.nom ? { slot: 'Arme principale', name: main.nom, detail: main.degats || '' } : null,
    sec  && sec.nom  ? { slot: 'Main secondaire', name: sec.nom,  detail: sec.degats  || '' } : null,
    tete && tete.nom ? { slot: 'Tête',            name: tete.nom, detail: tete.typeArmure || '' } : null,
    torse && torse.nom ? { slot: 'Torse',         name: torse.nom, detail: torse.typeArmure || '' } : null,
    pieds && pieds.nom ? { slot: 'Bottes',        name: pieds.nom, detail: pieds.typeArmure || '' } : null,
  ].filter(Boolean);

  if (!rows.length) return '';

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">Équipement</h3>
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
      <h3 class="pp-fiche-card-title">Hauts-Faits <span class="pp-fiche-card-count">${total}</span></h3>
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
      <h3 class="pp-fiche-card-title">Galerie <span class="pp-fiche-card-count">${photos.length}</span></h3>
      <div class="pp-gallery-view">
        ${photos.map((g, i) => `
          <button type="button" class="pp-gallery-view-item"
                  data-pp-action="lightbox" data-pres-id="${_esc(item.presentationId)}" data-idx="${i}">
            <img src="${_esc(g.url || g.thumb)}" alt="Photo ${i+1} de ${_esc(item.nom)}"
                 loading="lazy" decoding="async" referrerpolicy="no-referrer">
            ${g.isPortrait ? '<span class="pp-gallery-view-portrait-flag">Portrait</span>' : ''}
            <span class="pp-gallery-view-zoom" aria-hidden="true">🔍</span>
          </button>`).join('')}
      </div>
    </section>`;
}

// ── Bloc Chronique des aventures (timeline des missions du PJ) ──────────────
function _renderChroniqueBlock(item) {
  const charId = item.char?.id || item.charId;
  if (!charId) return '';
  const missions = _computeRecentMissions(charId, 6);
  if (!missions.length) return '';

  // Compte le total des missions auxquelles le PJ a participé
  const totalCount = STORE.story.filter(ev => {
    if ((ev.participants || []).some(p => p.id === charId)) return true;
    return (ev.groupes || []).some(g => (g.membres || []).includes(charId));
  }).length;

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">Chronique <span class="pp-fiche-card-count">${totalCount}</span></h3>
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
// Calcul depuis `story` (trame/missions) : compte les co-occurrences dans
// `participants` et affiche les top N PJs.
function _renderTopAdventurersBlock(item, items) {
  const charId = item.char?.id || item.charId;
  const top = _computeTopAdventurers(charId, items, 4);
  if (!charId) return '';

  return `
    <section class="pp-fiche-card">
      <h3 class="pp-fiche-card-title">Partenaires d'aventure ${top.length ? `<span class="pp-fiche-card-count">${top.length}</span>` : ''}</h3>
      <p class="pp-fiche-card-sub">Compagnons les plus rencontrés en mission (trame).</p>
      ${top.length ? `
        <div class="pp-partenaires-grid">
          ${top.map(({ item: o, count }) => {
            const c = _accentColor(o.nom);
            const pos = `${50 + (o.photoX || 0) * 50}% ${50 + (o.photoY || 0) * 50}%`;
            return `<button class="pp-partenaire" data-pp-action="openFiche" data-id="${_esc(o.id)}" style="--c-accent:${c}">
              <div class="pp-partenaire-portrait">
                ${o.portraitUrl
                  ? `<img src="${_esc(o.portraitUrl)}" style="object-position:${pos}">`
                  : `<span>${o.initials}</span>`}
              </div>
              <div class="pp-partenaire-info">
                <div class="pp-partenaire-name">${_esc(o.nom)}</div>
                <div class="pp-partenaire-count">⚔ ${count} aventure${count>1?'s':''}</div>
              </div>
            </button>`;
          }).join('')}
        </div>`
      : `<div class="pp-partenaires-empty">Aucune aventure partagée enregistrée encore.</div>`}
    </section>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE PRINCIPALE — entrée + dispatch sommaire/fiche
// ══════════════════════════════════════════════════════════════════════════════
async function renderPlayersPage() {
  const content = document.getElementById('main-content');
  if (!content) return;

  // Story est utilisé pour calculer les top partenaires d'aventure.
  const [presentations, characters, achievements, story] = await Promise.all([
    loadCollection('players'),
    loadCollection('characters'),
    loadCollection('achievements'),
    loadCollection('story').catch(() => []),
  ]);
  STORE.presentations = presentations;
  STORE.characters    = characters;
  STORE.achievements  = achievements;
  STORE.story         = story;
  STORE.items         = _buildDataset(presentations, characters);

  if (!STORE.items.length) {
    content.innerHTML = `
      <div class="pp-hero">
        <div class="pp-hero-band">
          <div class="pp-hero-title-block">
            <h1 class="pp-hero-title">✦ Roster de Campagne ✦</h1>
            <p class="pp-hero-subtitle">— Aucun héros ne s'est encore présenté —</p>
          </div>
        </div>
      </div>
      ${STATE.isAdmin
        ? `<div class="pp-empty">
            <div class="pp-empty-icon">⚔️</div>
            <p class="pp-empty-title">Aucun personnage dans le roster.</p>
            <button class="btn btn-gold" data-pp-action="newPlayer" style="margin-top:.8rem">+ Ajouter le premier</button>
          </div>`
        : `<div class="pp-empty">
            <div class="pp-empty-icon">🕯️</div>
            <p class="pp-empty-title">Aucune présentation publiée.</p>
          </div>`}`;
    return;
  }

  _renderView(content);
  _initSortable();
}

function _renderView(content) {
  const activeItem = STORE.activeId ? STORE.items.find(i => i.id === STORE.activeId) : null;
  content.innerHTML = `
    <div class="pp-page">
      <div id="pp-view-area">
        ${activeItem ? _renderFiche(activeItem, STORE.items) : _renderSommaire(STORE.items)}
      </div>
    </div>`;
  if (activeItem) requestAnimationFrame(() => {
    _bindHexagonTooltips();
    document.querySelector('.pp-strip-item.is-active')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
  if (!activeItem && STORE.viewMode === 'relations') {
    requestAnimationFrame(() => _bindRelationsDrag());
  }
}

function _refreshView() {
  const content = document.getElementById('main-content');
  if (!content) return;
  _renderView(content);
  _initSortable();
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLERS — délégation data-pp-action
// ══════════════════════════════════════════════════════════════════════════════
Object.assign(ppHandlers, {
  updateVisiblePill: (el) => window._ppUpdateVisiblePill?.(el.checked),
  refreshVisCount:   ()   => window._ppRefreshVisCount?.(),
  openFiche:     (el) => { STORE.activeId = el.dataset.id; _refreshView(); window.scrollTo(0, 0); },
  back:          ()   => { STORE.activeId = ''; _refreshView(); },
  search:        (el) => {
    STORE.filterSearch = el.value;
    STORE.activeId = '';
    const caret = el.selectionStart;
    _refreshView();
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
  setJoueur:     (el) => { STORE.filterJoueur = el.value; STORE.activeId = ''; _refreshView(); },
  setSort:       (el) => { STORE.sortBy = el.value; STORE.activeId = ''; _refreshView(); },
  setViewMode:   (el) => { STORE.viewMode = el.dataset.mode || 'gallery'; STORE.activeId = ''; _refreshView(); },
  relTogglePicker: () => { STORE.relPickerOpen = !STORE.relPickerOpen; _refreshView(); },
  relToggleChar: (el) => {
    const id = el.dataset.charId; if (!id) return;
    const all = STORE.items.filter(i => i.charId).map(i => i.charId);
    // Initialise la sélection si elle est encore "tous"
    if (!STORE.relSelected) STORE.relSelected = new Set(all);
    if (el.checked) STORE.relSelected.add(id);
    else            STORE.relSelected.delete(id);
    // Si on a tout coché → revient à "tous" (état neutre)
    if (STORE.relSelected.size === all.length) STORE.relSelected = null;
    _refreshView();
  },
  relSelectAll:  () => { STORE.relSelected = null; _refreshView(); },
  relSelectNone: () => { STORE.relSelected = new Set(); _refreshView(); },
  relResetPositions: () => { STORE.relPositions = {}; _refreshView(); },
  resetFilters:  ()   => {
    STORE.filterSearch = ''; STORE.filterJoueur = '';
    _refreshView();
  },
  toggleVisible: (el) => _toggleVisible(el.dataset.id),
  lightbox:      (el) => _openLightbox(el.dataset.presId, parseInt(el.dataset.idx, 10) || 0),
  editPres:      (el) => _editPlayerPresent(el.dataset.id),
  newPlayer:     ()   => openPlayerPresentModal(),
});

async function _toggleVisible(id) {
  const item = STORE.items.find(i => i.id === id);
  if (!item?.presentationId) return;
  const newVal = !(item.visible !== false);
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
function _initSortable() {
  if (!STATE.isAdmin) return;
  const list = document.getElementById('pp-gallery');
  if (!list) return;
  _ppSortable?.destroy();
  _ppSortable = new Sortable(list, {
    animation: 150,
    handle: '.pp-card-drag',
    ghostClass: 'pp-sortable-ghost',
    chosenClass: 'pp-sortable-chosen',
    forceFallback: true,
    fallbackOnBody: true,
    delay: 100,
    delayOnTouchOnly: true,
    onEnd: async () => {
      const ids = [...list.querySelectorAll('[data-pp-id]')].map(el => el.dataset.ppId);
      ids.forEach((id, idx) => {
        const item = STORE.items.find(i => i.id === id);
        if (item) item.ordre = idx + 1;
      });
      _setLocalOrdre(ids);
      await Promise.all(ids.map((id, idx) => {
        const item = STORE.items.find(i => i.id === id);
        if (item?.presentationId) return updateInCol('players', item.presentationId, { ordre: idx + 1 });
      }).filter(Boolean));
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — création / édition (upload + crop illustration)
// ══════════════════════════════════════════════════════════════════════════════
async function openPlayerPresentModal(player = null) {
  const characters = STORE.characters.length ? STORE.characters : await loadCollection('characters');
  const curCharId = player?.charId || '';
  const existingContent = player?.content || player?.bio || '';
  _ppCardCropParams = null;
  // Galerie en édition : on travaille sur un tableau ordonné où le portrait
  // (imageUrl) est représenté par {portrait: true}. À la sauvegarde, on le
  // stocke tel quel ; au render, on le résout via imageUrl.
  const rawGal = Array.isArray(player?.gallery) ? player.gallery.slice() : null;
  const hasImg = !!(player?.imageUrl);
  if (rawGal) {
    _ppGallery = rawGal.slice();
    // Si une imageUrl existe mais aucun marqueur portrait → l'ajouter en tête
    if (hasImg && !_ppGallery.some(g => g?.portrait)) {
      _ppGallery.unshift({ portrait: true });
    }
    // Si pas d'imageUrl → purge des marqueurs portrait orphelins
    if (!hasImg) _ppGallery = _ppGallery.filter(g => !g?.portrait);
  } else {
    _ppGallery = hasImg ? [{ portrait: true }] : [];
  }
  window.__ppEditingPlayer = player;

  // ── Helpers pour le hero ──
  const linkedChar = curCharId ? characters.find(c => c.id === curCharId) : null;
  const heroNom    = player?.nom || linkedChar?.nom || (player ? 'Présentation' : 'Nouvelle présentation');
  const heroClasse = linkedChar?.classe || '';
  const heroRace   = linkedChar?.race   || '';
  const heroJoueur = linkedChar?.ownerPseudo || '';
  const heroNiveau = linkedChar?.niveau ?? null;
  const isVisible  = player?.visible !== false;
  const heroBg     = player?.imageUrl ? `background-image:url('${_esc(player.imageUrl).replace(/'/g, '%27')}')` : '';

  const visEntries = [
    { id:'pp-show-pv',       label:'PV',           key:'afficherPV',       def:true,  ico:'❤' },
    { id:'pp-show-pm',       label:'PM',           key:'afficherPM',       def:true,  ico:'✦' },
    { id:'pp-show-ca',       label:'CA',           key:'afficherCA',       def:true,  ico:'🛡' },
    { id:'pp-show-or',       label:'Or',           key:'afficherOr',       def:false, ico:'🪙' },
    { id:'pp-show-stats',    label:'Statistiques', key:'afficherStats',    def:true,  ico:'📊' },
    { id:'pp-show-lvl',      label:'Niveau',       key:'afficherNiveau',   def:true,  ico:'⭐' },
    { id:'pp-show-equip',    label:'Équipement',   key:'afficherEquip',    def:true,  ico:'⚔' },
    { id:'pp-show-identite', label:'Identité',     key:'afficherIdentite', def:true,  ico:'📜' },
    { id:'pp-show-citation', label:'Citation',     key:'afficherCitation', def:true,  ico:'💬' },
    { id:'pp-show-bio',      label:'Biographie',   key:'afficherBio',      def:true,  ico:'📖' },
    { id:'pp-show-tags',     label:'Traits',       key:'afficherTags',     def:true,  ico:'🎭' },
  ];

  openModal('', `
  <div class="pp-mn-shell">

    <!-- ════ HERO BANNER — preview image + drop zone overlay ═══════ -->
    <div class="pp-mn-hero" id="pp-mn-hero">
      <div class="pp-mn-hero-bg" id="pp-mn-hero-bg" style="${heroBg}"></div>
      <div class="pp-mn-hero-fade"></div>

      <!-- Drop zone overlay (cropper rattaché ci-dessous) -->
      <div id="pp-img-drop" class="pp-mn-hero-drop" title="Cliquer ou déposer une image">
        <div id="pp-img-preview"></div>
        <div class="pp-mn-hero-drop-hint">
          <span class="pp-mn-hero-drop-icon">🖼️</span>
          <span>${player?.imageUrl ? "Changer l'illustration" : 'Glisser une image ou cliquer pour ouvrir'}</span>
        </div>
      </div>

      <!-- Contenu hero -->
      <div class="pp-mn-hero-content">
        <div class="pp-mn-hero-eyebrow">
          <span id="pp-mn-eyebrow">${heroClasse || heroRace ? _esc([heroClasse, heroRace].filter(Boolean).join(' · ')) : 'Présentation joueurs'}</span>
          ${heroJoueur ? `<span class="pp-mn-hero-eyebrow-sep">·</span><span>${_esc(heroJoueur)}</span>` : ''}
        </div>
        <h2 class="pp-mn-hero-title" id="pp-mn-title">${_esc(heroNom)}</h2>
        <div class="pp-mn-hero-meta">
          ${heroNiveau !== null ? `<span class="pp-mn-meta-pill">⭐ Niv. <b>${heroNiveau}</b></span>` : ''}
          <span class="pp-mn-meta-pill ${isVisible?'is-on':'is-off'}" id="pp-mn-vis-pill">
            ${isVisible ? '👁 Visible' : '🚫 Masqué'}
          </span>
          ${player?.imageUrl ? `<button type="button" class="pp-mn-meta-pill pp-mn-pill-action"
            id="pp-img-clear" title="Retirer l'illustration">✕ Retirer image</button>` : ''}
        </div>
      </div>

      <!-- Cropper inline -->
      <div id="pp-crop-wrap" class="pp-mn-crop-wrap" style="display:none">
        <canvas id="pp-crop-canvas"></canvas>
        <div class="pp-mn-crop-bar">
          <span class="pp-mn-crop-hint">Recadre · ratio 3:4</span>
          <button type="button" class="btn btn-gold btn-sm" id="pp-crop-confirm">✂️ Confirmer</button>
          <div id="pp-crop-ok" style="display:none;font-size:.75rem"></div>
        </div>
      </div>
    </div>

    <!-- ════ TABS ════════════════════════════════════════════════ -->
    <div class="pp-mn-tabs" role="tablist">
      <button type="button" class="pp-mn-tab is-active" data-pp-tab="presentation">📝 Présentation</button>
      <button type="button" class="pp-mn-tab" data-pp-tab="visibilite">👁 Visibilité <span class="pp-mn-tab-count" id="pp-mn-vis-count">${visEntries.filter(f => (player?.[f.key] !== undefined ? player[f.key] : f.def)).length}</span></button>
      <button type="button" class="pp-mn-tab" data-pp-tab="galerie">🖼 Galerie <span class="pp-mn-tab-count" id="pp-mn-gal-count">${_ppGallery.length || ''}</span></button>
    </div>

    <!-- ════ TAB CONTENT ═════════════════════════════════════════ -->
    <div class="pp-mn-body">

      <!-- ── ONGLET PRÉSENTATION ────────────────────────────────── -->
      <section class="pp-mn-panel is-active" data-pp-panel="presentation">
        <div class="pp-mn-grid-2">
          <div class="pp-mn-field">
            <label class="pp-mn-label">Fiche liée <span class="pp-form-hint">(auto-remplit classe, race, joueur)</span></label>
            <select class="pp-mn-input" id="pp-char-id">
              <option value="">— Aucun lien —</option>
              ${characters.map(c => `<option value="${_esc(c.id)}" ${c.id===curCharId?'selected':''}>${_esc(c.nom||'?')}${c.classe?' — '+_esc(c.classe):''}${c.ownerPseudo?' ('+_esc(c.ownerPseudo)+')':''}</option>`).join('')}
            </select>
          </div>
          <div class="pp-mn-field">
            <label class="pp-mn-label">Ordre d'affichage</label>
            <input type="number" class="pp-mn-input" id="pp-ordre" value="${player?.ordre??''}" placeholder="Auto" min="1">
          </div>
        </div>

        <div class="pp-mn-field">
          <label class="pp-mn-label">Présentation</label>
          ${richTextEditorHtml({ id: 'pp-content', html: existingContent, minHeight: 240, placeholder: 'Décris librement ce personnage…' })}
        </div>

        <label class="pp-mn-toggle-row">
          <input type="checkbox" id="pp-visible" ${isVisible?'checked':''}
            data-pp-action="updateVisiblePill" data-pp-on="change">
          <span class="pp-mn-toggle-track"><span class="pp-mn-toggle-thumb"></span></span>
          <span class="pp-mn-toggle-lbl">
            <b>Visible dans le sommaire</b>
            <small>Désactive pour masquer ce personnage aux joueurs.</small>
          </span>
        </label>
      </section>

      <!-- ── ONGLET VISIBILITÉ ──────────────────────────────────── -->
      <section class="pp-mn-panel" data-pp-panel="visibilite">
        <div class="pp-mn-section-intro">
          🔒 Coche les informations que les joueurs verront sur la fiche.
        </div>
        <div class="pp-mn-vis-grid">
          ${visEntries.map(f => {
            const checked = player?.[f.key] !== undefined ? player[f.key] : f.def;
            return `<label class="pp-mn-vis-card ${checked?'is-on':''}">
              <input type="checkbox" id="${f.id}" ${checked?'checked':''}
                data-pp-action="refreshVisCount" data-pp-on="change">
              <span class="pp-mn-vis-ico">${f.ico}</span>
              <span class="pp-mn-vis-lbl">${f.label}</span>
              <span class="pp-mn-vis-check">✓</span>
            </label>`;
          }).join('')}
        </div>
      </section>

      <!-- ── ONGLET GALERIE ────────────────────────────────────── -->
      <section class="pp-mn-panel" data-pp-panel="galerie">
        <div class="pp-mn-section-intro">
          🖼️ Galerie photos — la première image sert d'illustration principale.
        </div>

        <!-- Cadrage de l'image dans la card du Roster -->
        ${player?.imageUrl ? `
          <div class="pp-mn-card-crop">
            <div class="pp-mn-card-crop-head">
              <span class="pp-mn-label">Cadrage dans la card</span>
              <span class="pp-form-hint">glisse · molette/pinch pour zoomer</span>
            </div>
            <div class="pp-card-crop-wrap">
              ${panZoomCropHTML({ idPrefix: 'pp-card', viewW: 240, viewH: 320, hint: false })}
              <div class="pp-card-crop-actions">
                <button type="button" class="btn btn-outline btn-sm" data-pp-action="resetCardCrop">↺ Réinitialiser</button>
                <button type="button" class="btn btn-gold btn-sm" data-pp-action="confirmCardCrop">✓ Confirmer</button>
              </div>
              <div class="pp-card-crop-status" id="pp-card-crop-status"></div>
            </div>
          </div>` : ''}

        <div class="pp-mn-field">
          <label class="pp-mn-label">Photos additionnelles <span class="pp-form-hint">(glisse pour réordonner · Cloudinary pleine qualité)</span></label>
          <div id="pp-gallery-list" class="pp-gallery-edit"></div>
          <div id="pp-gallery-drop" class="pp-form-drop pp-gallery-drop">
            <div class="pp-gallery-drop-hint">+ Glisser une photo (ou cliquer)</div>
          </div>
          <div id="pp-gallery-status" class="pp-form-hint" style="margin-top:.3rem"></div>
        </div>
      </section>
    </div>

    <!-- ════ FOOTER ACTIONS ═══════════════════════════════════════ -->
    <div class="pp-mn-footer">
      ${player?.id ? `<button class="btn btn-outline btn-sm pp-btn-danger" data-pp-action="delete" data-id="${_esc(player.id)}">🗑 Supprimer</button>` : '<span></span>'}
      <div class="pp-mn-footer-right">
        <button class="btn btn-outline btn-sm" data-pp-action="closeModal">Annuler</button>
        <button class="btn btn-gold" data-pp-action="save" data-id="${_esc(player?.id||'')}">💾 Enregistrer</button>
      </div>
    </div>
  </div>
  `);

  // ── Wiring : tabs + live updates ──
  document.querySelectorAll('[data-pp-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.ppTab;
      document.querySelectorAll('[data-pp-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.ppTab === tab));
      document.querySelectorAll('[data-pp-panel]').forEach(p => p.classList.toggle('is-active', p.dataset.ppPanel === tab));
    });
  });
  window._ppUpdateVisiblePill = (on) => {
    const pill = document.getElementById('pp-mn-vis-pill');
    if (!pill) return;
    pill.classList.toggle('is-on', !!on); pill.classList.toggle('is-off', !on);
    pill.textContent = on ? '👁 Visible' : '🚫 Masqué';
  };
  window._ppRefreshVisCount = () => {
    const n = visEntries.filter(f => document.getElementById(f.id)?.checked).length;
    const el = document.getElementById('pp-mn-vis-count');
    if (el) el.textContent = n;
    // Toggle visual state on cards
    document.querySelectorAll('.pp-mn-vis-card').forEach(card => {
      const cb = card.querySelector('input[type=checkbox]');
      if (cb) card.classList.toggle('is-on', cb.checked);
    });
  };
  // Met à jour l'eyebrow live quand on change la fiche liée
  const selCh = document.getElementById('pp-char-id');
  selCh?.addEventListener('change', () => {
    const c = characters.find(x => x.id === selCh.value);
    const eb = document.getElementById('pp-mn-eyebrow');
    if (eb) eb.textContent = c && (c.classe || c.race)
      ? [c.classe, c.race].filter(Boolean).join(' · ')
      : 'Présentation joueurs';
    const t = document.getElementById('pp-mn-title');
    if (t && c?.nom) t.textContent = c.nom;
  });

  bindRichTextEditors();
  _ppCropper?.destroy();
  _ppCropper = attachDropAndCrop({
    dropEl:        document.getElementById('pp-img-drop'),
    previewEl:     document.getElementById('pp-img-preview'),
    cropWrapEl:    document.getElementById('pp-crop-wrap'),
    canvasId:      'pp-crop-canvas',
    statusEl:      document.getElementById('pp-crop-ok'),
    confirmBtnEl:  document.getElementById('pp-crop-confirm'),
    clearBtnEl:    document.getElementById('pp-img-clear'),
    initialUrl:    player?.imageUrl || '',
    initialRatio:  { w: 3, h: 4 },
    maxDisplayW:   440,
  });

  // Cropper interactif pour la card du Roster (viewport 3:4 portrait).
  // On part TOUJOURS de l'image source (imageUrl). Les coords du cadrage existant
  // sont appliquées après initialisation pour reprendre exactement où on était.
  _ppCardCropper?.destroy(); _ppCardCropper = null;
  if (player?.imageUrl) {
    _ppCardCropper = attachPanZoomCrop({
      idPrefix:   'pp-card',
      dataUrl:    player.imageUrl,
      viewW:      240, viewH: 320,
      background: '#0b1118',
    });
    // Restaure le cadrage précédemment sauvegardé si présent
    if (player?.cardCrop && _ppCardCropper && typeof _ppCardCropper.setCropParams === 'function') {
      _ppCardCropper.setCropParams(player.cardCrop);
    }
  }

  _renderGalleryEditor();
  const galleryDrop = document.getElementById('pp-gallery-drop');
  if (galleryDrop) {
    bindImageUploadDropZone(galleryDrop, {
      onImage: async ({ file }) => {
        const status = document.getElementById('pp-gallery-status');
        if (!file) return;
        if (_ppGallery.length >= PP_GALLERY_MAX) {
          if (status) { status.textContent = `Maximum ${PP_GALLERY_MAX} photos atteint.`; status.style.color = '#ff6b6b'; }
          return;
        }
        if (!hasCloudinaryConfig()) {
          if (status) { status.textContent = 'Config Cloudinary requise — saisis-la puis relance l\'upload.'; status.style.color = '#ff6b6b'; }
          openCloudinaryConfigModal();
          return;
        }
        if (status) { status.textContent = '⏳ Upload en cours…'; status.style.color = 'var(--text-muted)'; }
        try {
          const b64full = await uploadJpeg(file, PP_GALLERY_UPLOAD);
          const up = await uploadCloudinary(b64full, { folder: 'gallery', tags: ['gallery'] });
          _ppGallery.push({ url: up.url, thumb: up.thumbUrl || '', deleteUrl: '' });
          _renderGalleryEditor();
          if (status) { status.textContent = `✓ Ajoutée (qualité d'origine, hébergée sur Cloudinary)`; status.style.color = 'var(--green)'; }
        } catch (e) {
          console.error('[players gallery]', e);
          if (status) { status.textContent = `Erreur upload : ${e?.message || '?'}`; status.style.color = '#ff6b6b'; }
        }
      },
    });
  }
}

function _renderGalleryEditor() {
  const list = document.getElementById('pp-gallery-list');
  if (!list) return;
  _ppGallerySortable?.destroy(); _ppGallerySortable = null;
  if (!_ppGallery.length) {
    list.innerHTML = '<div class="pp-gallery-empty">Aucune photo additionnelle.</div>';
    return;
  }
  const player = window.__ppEditingPlayer;
  const portraitUrl = player?.imageUrl || '';
  list.innerHTML = _ppGallery.map((g, i) => {
    const isPortrait = !!g.portrait;
    const src = isPortrait ? portraitUrl : (g.thumb || g.url);
    return `
    <div class="pp-gallery-edit-item ${isPortrait ? 'is-portrait' : ''}" data-gal-idx="${i}" title="Glisse pour réordonner">
      <span class="pp-gallery-edit-handle" aria-hidden="true">⠿</span>
      <img src="${_esc(src)}" alt="Photo ${i+1}" loading="lazy">
      ${isPortrait
        ? '<span class="pp-gallery-edit-flag" title="Image de présentation (gérée plus haut)">Portrait</span>'
        : `<button type="button" class="pp-gallery-edit-del" data-pp-action="removeGalleryPhoto" data-idx="${i}" title="Retirer">✕</button>`}
    </div>`;
  }).join('');
  _ppGallerySortable = new Sortable(list, {
    animation: 150,
    ghostClass: 'pp-sortable-ghost',
    chosenClass: 'pp-sortable-chosen',
    handle: '.pp-gallery-edit-handle',
    forceFallback: true,
    fallbackOnBody: true,
    onEnd: () => {
      const newOrder = [...list.querySelectorAll('[data-gal-idx]')]
        .map(el => parseInt(el.dataset.galIdx, 10))
        .map(i => _ppGallery[i])
        .filter(Boolean);
      _ppGallery = newOrder;
      _renderGalleryEditor();
    },
  });
}

// ── Modal handlers ────────────────────────────────────────────────────────────
Object.assign(ppHandlers, {
  save:       (el) => _savePlayerPresent(el.dataset.id || ''),
  delete:     (el) => _deletePlayerPresent(el.dataset.id),
  closeModal: ()   => closeModal(),
  // Card crop interactif (pan-zoom) — capture les COORDS du cadrage (4 nombres).
  // Aucune image n'est dupliquée → pas de problème de taille Firestore.
  confirmCardCrop: () => {
    const status = document.getElementById('pp-card-crop-status');
    const tryConfirm = (retries = 5) => {
      const params = _ppCardCropper?.getCropParams();
      if (params) {
        _ppCardCropParams = params;
        if (status) {
          status.textContent = `✓ Cadrage confirmé — sera enregistré au save`;
          status.style.color = '#22c38e';
        }
      } else if (retries > 0) {
        setTimeout(() => tryConfirm(retries - 1), 100);
      } else if (status) {
        status.textContent = '⚠ Image pas encore chargée. Réessaie dans un instant.';
        status.style.color = '#ff6b6b';
      }
    };
    tryConfirm();
  },
  removeGalleryPhoto: (el) => {
    const idx = parseInt(el.dataset.idx, 10);
    if (!Number.isInteger(idx)) return;
    if (_ppGallery[idx]?.portrait) return;   // portrait non supprimable depuis ici
    _ppGallery.splice(idx, 1);
    _renderGalleryEditor();
  },
  resetCardCrop: () => {
    _ppCardCropParams = null;
    // Re-init du cropper depuis l'image source pour repartir du centre
    _ppCardCropper?.destroy();
    const player = window.__ppEditingPlayer || null;
    const src = player?.imageUrl || document.getElementById('pp-img-b64')?.value || '';
    if (!src) return;
    _ppCardCropper = attachPanZoomCrop({
      idPrefix: 'pp-card', dataUrl: src,
      viewW: 240, viewH: 320,
      background: '#0b1118',
    });
    const status = document.getElementById('pp-card-crop-status');
    if (status) status.textContent = 'Cadrage réinitialisé';
  },
});

async function _savePlayerPresent(id = '') {
  try {
    const cropResult = _ppCropper?.getResult();
    let imageUrl = '';
    if (typeof cropResult === 'string')      imageUrl = cropResult;
    else if (cropResult === null)            imageUrl = '';
    else if (id) {
      const existing = STORE.presentations.find(p => p.id === id);
      imageUrl = existing?.imageUrl || '';
    }
    _ppCropper?.destroy(); _ppCropper = null;

    // Cadrage de la card : on stocke les COORDS (offX, offY, imgW, imgH) — pas
    // une image. ~50 octets vs ~50KB → aucun problème de taille Firestore.
    // Priorité : confirmé > auto-capture du cadrage en cours > existant.
    let cardCrop = null;
    if (_ppCardCropParams) {
      cardCrop = _ppCardCropParams;
    } else if (_ppCardCropper) {
      const autoParams = _ppCardCropper.getCropParams();
      if (autoParams) cardCrop = autoParams;
    }
    if (!cardCrop && id) {
      const existing = STORE.presentations.find(p => p.id === id);
      cardCrop = existing?.cardCrop || null;
    }
    // Si l'illustration est effacée, on efface aussi le crop card (cohérence)
    if (!imageUrl) cardCrop = null;
    _ppCardCropper?.destroy(); _ppCardCropper = null;
    _ppCardCropParams = null;
    window.__ppEditingPlayer = null;

    const data = {
      charId:         document.getElementById('pp-char-id')?.value         || '',
      content:        getRichTextHtml('pp-content'),
      imageUrl,
      cardCrop,
      ordre:          parseInt(document.getElementById('pp-ordre')?.value, 10) || 999,
      visible:        document.getElementById('pp-visible')?.checked    ?? true,
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
    _ppGallery = [];

    if (id) await updateInCol('players', id, data);
    else    await addToCol('players', data);

    closeModal();
    showNotif('Présentation enregistrée.', 'success');
    await PAGES.players();
  } catch (e) { notifySaveError(e); }
}

async function _deletePlayerPresent(id) {
  try {
    if (!await (window.confirmModal?.('Supprimer cette présentation ?'))) return;
    await deleteFromCol('players', id);
    showNotif('Présentation supprimée.', 'success');
    STORE.activeId = '';
    await PAGES.players();
  } catch (e) { notifySaveError(e); }
}

async function _editPlayerPresent(id) {
  const items = await loadCollection('players');
  const p = items.find(e => e.id === id);
  if (p) openPlayerPresentModal(p);
}

// ── Lightbox galerie (overlay plein écran, pas une modale scrollable) ──────
function _openLightbox(presId, startIdx = 0) {
  const item = STORE.items.find(i => i.presentationId === presId);
  const photos = item?.gallery || [];
  if (!photos.length) return;
  let idx = Math.max(0, Math.min(startIdx, photos.length - 1));

  // Nettoyage d'une éventuelle lightbox précédente
  document.getElementById('pp-lightbox')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pp-lightbox';
  overlay.className = 'pp-lightbox';
  overlay.innerHTML = `
    <img class="pp-lightbox-img" alt="">
    <div class="pp-lightbox-counter"></div>
    ${photos.length > 1 ? `
      <button type="button" class="pp-lightbox-nav pp-lightbox-prev" aria-label="Précédente">‹</button>
      <button type="button" class="pp-lightbox-nav pp-lightbox-next" aria-label="Suivante">›</button>
    ` : ''}
    <button type="button" class="pp-lightbox-close" aria-label="Fermer">✕</button>
  `;
  document.body.appendChild(overlay);

  const imgEl   = overlay.querySelector('.pp-lightbox-img');
  const countEl = overlay.querySelector('.pp-lightbox-counter');
  const render = () => {
    const g = photos[idx];
    imgEl.src = g.url;
    imgEl.alt = `Photo ${idx + 1} de ${item.nom}`;
    countEl.textContent = `${idx + 1} / ${photos.length}`;
  };
  const close = () => {
    overlay.classList.add('is-closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 180);
  };
  const next = () => { idx = (idx + 1) % photos.length; render(); };
  const prev = () => { idx = (idx - 1 + photos.length) % photos.length; render(); };
  const onKey = (e) => {
    if (e.key === 'Escape')    close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft')  prev();
  };
  document.addEventListener('keydown', onKey);

  // Clic sur l'overlay (mais pas sur l'image ni les contrôles) → fermer
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.pp-lightbox-close').addEventListener('click', close);
  overlay.querySelector('.pp-lightbox-prev')?.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  overlay.querySelector('.pp-lightbox-next')?.addEventListener('click', (e) => { e.stopPropagation(); next(); });
  imgEl.addEventListener('click', (e) => e.stopPropagation());

  render();
}

// ── Compat publique (anciens points d'entrée référencés ailleurs) ─────────────
async function openCharacterSheetFromShowcase(charId) {
  if (!charId) return;
  await window.navigate?.('characters');
  setTimeout(() => {
    const pill = Array.from(document.querySelectorAll('#char-pills .char-pill'))
      .find(e => e.dataset.charid === charId || e.getAttribute('onclick')?.includes(`'${charId}'`));
    if (pill) { pill.click(); return; }
    const c = window.STATE?.characters?.find(e => e.id === charId);
    if (c && window.renderCharSheet) { window.STATE.activeChar = c; window.renderCharSheet(c); }
  }, 50);
}

// ── Override + exports ────────────────────────────────────────────────────────
PAGES.players = renderPlayersPage;

Object.assign(window, {
  renderPlayersPage,
  openPlayerPresentModal,
  openCharacterSheetFromShowcase,
});
