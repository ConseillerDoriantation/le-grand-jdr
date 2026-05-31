// ══════════════════════════════════════════════════════════════════════════════
// WORLD.JS — Le Monde
// ✓ Sections de lore libres (texte riche, image optionnelle)
// ✓ MJ : CRUD sections, réorganisation par drag & drop
// ✓ Joueur : lecture seule, navigation par ancres
// ✓ Firestore : world/main → { sections:[{id,titre,contenu,imageUrl,icone,visible}] }
// ══════════════════════════════════════════════════════════════════════════════
import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc, _nl2br, _norm } from '../shared/html.js';
import { richTextEditorHtml, bindRichTextEditors, getRichTextHtml, richTextContentHtml } from '../shared/rich-text.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import { STATE } from '../core/state.js';
import Sortable from '../vendor/sortable.esm.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';

// Rétro-compat : le contenu legacy est du texte brut (avec retours ligne) ;
// le nouveau contenu est du HTML rich-text. On détecte la présence d'une balise
// pour décider : texte brut → échappé + <br> ; HTML → tel quel (sanitisé en aval).
function _contentToHtml(raw) {
  const s = String(raw || '');
  if (!s) return '';
  return /<[a-z][\s\S]*?>/i.test(s) ? s : _nl2br(_esc(s));
}

// ── État local ────────────────────────────────────────────────────────────────
let _categories   = [];     // [{ id, nom, icone, visible }] — conteneurs de sections
let _sections     = [];     // [{ id, titre, contenu, imageUrl, icone, visible, categoryId }]
let _activeId     = null;   // id de la section affichée
let _sortables    = [];     // instances SortableJS (une par liste de catégorie)
let _wiCropper    = null;

// Catégorie par défaut : accueille les sections sans catégorie (legacy / orphelines)
const DEFAULT_CAT = { id: 'general', nom: 'Général', icone: '📖', visible: true };

// ── Icônes disponibles ────────────────────────────────────────────────────────
const ICONES = [
  '📖','🌍','🏔️','🌊','🏙️','🌲','⚔️','🛡️','🔮','💀',
  '👑','⚙️','🌑','☀️','🐉','🗝️','📜','🗺️','🏛️','✨',
];

// ── Chargement ────────────────────────────────────────────────────────────────
async function _load() {
  const doc = await getDocData('world', 'main');
  _categories = Array.isArray(doc?.categories) ? doc.categories.filter(c => c?.id) : [];
  _sections   = (doc?.sections || []).filter(s => s?.id);

  // ── Migration en mémoire (persistée au prochain save admin) ────────────────
  // Garantit au moins une catégorie et rattache toute section orpheline
  // (sans categoryId ou pointant vers une catégorie supprimée) à « Général ».
  const catIds = new Set(_categories.map(c => c.id));
  const hasOrphans = _sections.some(s => !s.categoryId || !catIds.has(s.categoryId));
  if (!_categories.length && (_sections.length || STATE.isAdmin)) {
    _categories = [{ ...DEFAULT_CAT }];
    catIds.add(DEFAULT_CAT.id);
  }
  if (hasOrphans) {
    if (!catIds.has(DEFAULT_CAT.id)) { _categories.unshift({ ...DEFAULT_CAT }); catIds.add(DEFAULT_CAT.id); }
    _sections = _sections.map(s =>
      (s.categoryId && catIds.has(s.categoryId)) ? s : { ...s, categoryId: DEFAULT_CAT.id });
  }

  // Section par défaut si tout est vide (admin only)
  if (!_sections.length && STATE.isAdmin) {
    if (!_categories.length) _categories = [{ ...DEFAULT_CAT }];
    _sections = [{
      id: 'intro', titre: 'Introduction', icone: '📖',
      contenu: 'Les informations sur le monde seront ajoutées ici par le Maître de Jeu.',
      imageUrl: '', visible: true, categoryId: _categories[0].id,
    }];
  }
}

async function _save() {
  try {
    await saveDoc('world', 'main', { categories: _categories, sections: _sections });
  } catch (e) { notifySaveError(e); }
}

// ── Rendu principal ───────────────────────────────────────────────────────────
async function renderWorld() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)">
    <div style="font-size:1.5rem;margin-bottom:.5rem">⏳</div><p>Chargement…</p></div>`;

  await _load();

  // Catégories + section active visibles. Pour un joueur, une section dans une
  // catégorie masquée est elle aussi masquée (cohérence nav ↔ contenu).
  const visibleCats   = _categories.filter(c => c.visible !== false || STATE.isAdmin);
  const visibleCatIds = new Set(visibleCats.map(c => c.id));
  const visibleSections = _sections.filter(s =>
    (s.visible !== false && visibleCatIds.has(s.categoryId)) || STATE.isAdmin);
  if (!_activeId || !visibleSections.find(s => s.id === _activeId)) {
    _activeId = visibleSections[0]?.id || null;
  }
  const activeSection = visibleSections.find(s => s.id === _activeId) || null;

  content.innerHTML = `
  <div class="world-shell" style="display:grid;grid-template-columns:250px 1fr;gap:1.2rem;align-items:start;margin:0 auto">

    <!-- ── SIDEBAR NAVIGATION ───────────────────────────────────────────── -->
    <div style="position:sticky;top:1rem">
      <div style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:var(--radius-lg);overflow:hidden">

        <!-- Header sidebar -->
        <div style="padding:.85rem 1rem;border-bottom:1px solid var(--border);
          background:linear-gradient(135deg,rgba(255,255,255,.02),transparent);
          display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--gold);
              letter-spacing:1px">📖 Le Monde</div>
            <div style="font-size:.68rem;color:var(--text-dim);margin-top:1px">
              ${visibleCats.length} catégorie${visibleCats.length>1?'s':''} · ${visibleSections.length} section${visibleSections.length>1?'s':''}
            </div>
          </div>
          ${STATE.isAdmin ? `
          <button data-action="openWorldCategoryModal"
            style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(232,184,75,.3);
            background:rgba(232,184,75,.08);color:var(--gold);cursor:pointer;font-size:1rem;
            display:flex;align-items:center;justify-content:center;transition:all .15s"
            title="Nouvelle catégorie">+</button>` : ''}
        </div>

        <!-- Catégories + sections -->
        <div id="world-nav-list" style="padding:.3rem 0">
          ${visibleCats.map(cat => _renderCategoryGroup(cat)).join('')}
          ${visibleCats.length === 0 ? `
          <div style="padding:1.5rem 1rem;text-align:center;color:var(--text-dim);
            font-size:.78rem;font-style:italic">Aucune catégorie</div>` : ''}
        </div>
      </div>

      <!-- Actions admin en bas de la sidebar -->
      ${STATE.isAdmin ? `
      <div style="margin-top:.6rem;display:flex;flex-direction:column;gap:.35rem">
        <button data-action="openWorldCategoryModal"
          class="btn btn-outline btn-sm" style="width:100%;font-size:.75rem">
          + Ajouter une catégorie
        </button>
      </div>` : ''}
    </div>

    <!-- ── CONTENU PRINCIPAL ─────────────────────────────────────────────── -->
    <div id="world-main-content">
      ${activeSection ? _renderSection(activeSection) : _renderEmpty()}
    </div>

  </div>`;

  // Bind drag & drop des items nav (admin)
  if (STATE.isAdmin) _bindNavDrag();
}

// ── Groupe catégorie : en-tête + ses sections ─────────────────────────────────
function _renderCategoryGroup(cat) {
  const isHidden = cat.visible === false;
  const secs = _sections.filter(s => s.categoryId === cat.id && (s.visible !== false || STATE.isAdmin));
  return `<div class="world-cat-group" data-cat-id="${cat.id}" style="margin-bottom:.15rem">
    <div class="world-cat-head" style="display:flex;align-items:center;gap:.5rem;
      padding:.5rem 1rem .35rem;${isHidden?'opacity:.5;':''}">
      <span style="font-size:.92rem;flex-shrink:0">${cat.icone||'📁'}</span>
      <span style="flex:1;font-family:'Cinzel',serif;font-size:.72rem;letter-spacing:.06em;
        text-transform:uppercase;color:var(--text-dim);font-weight:700;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis">${_esc(cat.nom||'Catégorie')}</span>
      ${isHidden ? `<span style="font-size:.58rem;color:#ff6b6b;flex-shrink:0">●</span>` : ''}
      ${STATE.isAdmin ? `
      <div class="world-cat-actions" style="display:flex;gap:.1rem;flex-shrink:0">
        <button data-action="openWorldSectionModal" data-cat-id="${cat.id}" data-stop-propagation
          style="background:none;border:none;cursor:pointer;color:var(--gold);font-size:.82rem;
          padding:0 3px" title="Ajouter une section ici">＋</button>
        <button data-action="openWorldCategoryModal" data-id="${cat.id}" data-stop-propagation
          style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.72rem;
          padding:0 3px" title="Modifier la catégorie">✏️</button>
        <button data-action="deleteWorldCategory" data-id="${cat.id}" data-stop-propagation
          style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.72rem;
          padding:0 3px" title="Supprimer la catégorie">🗑️</button>
      </div>` : ''}
    </div>
    <div class="world-cat-sections">
      ${secs.map(s => _renderNavItem(s)).join('')}
      ${secs.length === 0 ? `<div style="padding:.3rem 1rem .5rem 2.1rem;color:var(--text-dim);
        font-size:.72rem;font-style:italic">${STATE.isAdmin?'Vide — ＋ pour ajouter':'—'}</div>` : ''}
    </div>
  </div>`;
}

// ── Nav item ─────────────────────────────────────────────────────────────────
function _renderNavItem(s) {
  const isActive = s.id === _activeId;
  const isHidden = s.visible === false;
  return `<div
    data-nav-id="${s.id}" data-sec-id="${s.id}"
    data-action="selectWorldSection" data-id="${s.id}"
    style="display:flex;align-items:center;gap:.5rem;padding:.42rem 1rem .42rem 1.9rem;
      cursor:pointer;transition:all .12s;position:relative;
      background:${isActive ? 'rgba(232,184,75,.07)' : 'transparent'};
      border-left:3px solid ${isActive ? 'var(--gold)' : 'transparent'};
      opacity:${isHidden ? '.45' : '1'}"
    onmouseover="if(!this.style.background.includes('184')){this.style.background='rgba(255,255,255,.03)'}"
    onmouseout="if(!this.style.background.includes('184')){this.style.background='transparent'}">
    <span style="font-size:1rem;flex-shrink:0">${s.icone||'📖'}</span>
    <span style="font-size:.83rem;color:${isActive?'var(--gold)':'var(--text)'};
      font-weight:${isActive?'600':'400'};flex:1;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis">${s.titre||'Section'}</span>
    ${isHidden ? `<span style="font-size:.6rem;color:#ff6b6b;flex-shrink:0">●</span>` : ''}
    ${STATE.isAdmin ? `
    <div class="world-nav-actions" style="display:flex;gap:.2rem;flex-shrink:0">
      <button data-action="openWorldSectionModal" data-id="${s.id}" data-stop-propagation
        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.78rem;
        padding:1px 3px" title="Modifier">✏️</button>
      <button data-action="deleteWorldSection" data-id="${s.id}" data-stop-propagation
        style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.78rem;
        padding:1px 3px" title="Supprimer">🗑️</button>
    </div>` : ''}
  </div>`;
}

// ── Contenu d'une section ─────────────────────────────────────────────────────
function _renderSection(s) {
  const isHidden = s.visible === false;
  return `<div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);overflow:hidden;
    ${isHidden ? 'border-style:dashed;opacity:.75' : ''}">

    <!-- Image bannière -->
    ${s.imageUrl ? `
    <div style="width:100%;aspect-ratio:16/6;overflow:hidden;position:relative">
      <img src="${s.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 50%,rgba(11,17,24,.85))"></div>
    </div>` : ''}

    <!-- Header section -->
    <div style="padding:1.4rem 1.6rem ${s.imageUrl ? '.75rem' : '1rem'};
      ${s.imageUrl ? 'margin-top:-4rem;position:relative;z-index:1' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
        <div>
          <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.4rem">
            <span style="font-size:1.4rem">${s.icone||'📖'}</span>
            <h1 style="font-family:'Cinzel',serif;font-size:1.4rem;color:var(--gold);
              letter-spacing:1.5px;margin:0;line-height:1.2">${s.titre||'Section'}</h1>
          </div>
          ${isHidden ? `<span style="font-size:.7rem;color:#ff6b6b;
            background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);
            border-radius:4px;padding:1px 7px">🔒 Masquée aux joueurs</span>` : ''}
        </div>
        ${STATE.isAdmin ? `
        <div style="display:flex;gap:.4rem;flex-shrink:0">
          <button data-action="openWorldSectionModal" data-id="${s.id}"
            class="btn btn-outline btn-sm" style="font-size:.72rem">✏️ Modifier</button>
          <button data-action="deleteWorldSection" data-id="${s.id}"
            class="btn btn-outline btn-sm" style="font-size:.72rem;color:#ff6b6b;
            border-color:rgba(255,107,107,.3)">🗑️</button>
        </div>` : ''}
      </div>
    </div>

    <!-- Séparateur -->
    <div style="height:1px;background:var(--border);margin:0 1.6rem"></div>

    <!-- Contenu -->
    <div style="padding:1.2rem 1.6rem 1.6rem">
      ${s.contenu
        ? richTextContentHtml({
            html: _contentToHtml(s.contenu),
            className: 'world-section-content',
            attrs: { style: 'font-size:.88rem;color:var(--text-muted);line-height:1.85' },
          })
        : `<div style="color:var(--text-dim);font-style:italic;font-size:.85rem">
            Aucun contenu. ${STATE.isAdmin ? '<span style="color:var(--gold)">Cliquez sur Modifier pour ajouter du texte.</span>' : ''}</div>`}
    </div>
  </div>`;
}

function _renderEmpty() {
  return `<div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);padding:4rem 2rem;text-align:center">
    <div style="font-size:3rem;margin-bottom:1rem;opacity:.3">📖</div>
    <p style="color:var(--text-dim);font-style:italic;font-size:.85rem">
      ${STATE.isAdmin ? 'Aucune section. Ajoutez du lore depuis le bouton +.' : 'Aucun contenu disponible pour l\'instant.'}
    </p>
    ${STATE.isAdmin ? `<button data-action="openWorldSectionModal" class="btn btn-gold btn-sm" style="margin-top:1rem">
      + Créer la première section</button>` : ''}
  </div>`;
}

// ── Sélection section ─────────────────────────────────────────────────────────
window.selectWorldSection = (id) => {
  _activeId = id;
  // Mettre à jour la nav
  document.querySelectorAll('[data-nav-id]').forEach(el => {
    const active = el.dataset.navId === id;
    el.style.background    = active ? 'rgba(232,184,75,.07)' : 'transparent';
    el.style.borderLeft    = `3px solid ${active ? 'var(--gold)' : 'transparent'}`;
    const span = el.querySelector('span:nth-child(2)');
    if (span) { span.style.color = active ? 'var(--gold)' : 'var(--text)'; span.style.fontWeight = active ? '600' : '400'; }
  });
  // Mettre à jour le contenu
  const section = _sections.find(s => s.id === id);
  const main = document.getElementById('world-main-content');
  if (main && section) main.innerHTML = _renderSection(section);
};

// ── Drag & drop des sections (SortableJS, cross-catégorie) ────────────────────
// Une instance Sortable par liste de catégorie, toutes dans le même `group` →
// permet de réordonner ET de déplacer une section d'une catégorie à l'autre.
function _bindNavDrag() {
  _destroySortables();
  if (!STATE.isAdmin) return;
  document.querySelectorAll('.world-cat-sections').forEach(list => {
    _sortables.push(new Sortable(list, {
      group: 'world-sections',
      animation: 160,
      handle: '[data-sec-id]',
      draggable: '[data-sec-id]',
      ghostClass: 'world-drag-ghost',
      chosenClass: 'world-drag-chosen',
      forceFallback: true,
      fallbackOnBody: true,
      onEnd: _onSectionsReordered,
    }));
  });
}

function _destroySortables() {
  _sortables.forEach(s => { try { s.destroy(); } catch {} });
  _sortables = [];
}

// Reconstruit l'ordre + la catégorie de chaque section depuis le DOM après un drop.
async function _onSectionsReordered() {
  const byId = new Map(_sections.map(s => [s.id, s]));
  const next = [];
  document.querySelectorAll('.world-cat-group[data-cat-id]').forEach(group => {
    const catId = group.dataset.catId;
    group.querySelectorAll('.world-cat-sections [data-sec-id]').forEach(el => {
      const s = byId.get(el.dataset.secId);
      if (s) next.push({ ...s, categoryId: catId });
    });
  });
  // Sécurité : conserver d'éventuelles sections non rendues (catégorie masquée côté admin = improbable)
  _sections.forEach(s => { if (!next.find(n => n.id === s.id)) next.push(s); });
  _sections = next;
  await _save();
  renderWorld();
}

// ── Modal création / édition section ─────────────────────────────────────────
window.openWorldSectionModal = (id = null, presetCatId = null) => {
  const s = id ? _sections.find(sec => sec.id === id) : null;
  if (!_categories.length) { showNotif('Crée d\'abord une catégorie.', 'error'); return; }
  const selCatId = s?.categoryId || presetCatId || _categories[0]?.id;
  const catOptions = _categories.map(c =>
    `<option value="${c.id}" ${c.id===selCatId?'selected':''}>${_esc(c.icone||'📁')} ${_esc(c.nom||'Catégorie')}</option>`
  ).join('');

  const iconGrid = ICONES.map(ic => `
    <button type="button" id="wi-icon-${ic}" data-action="_selectWorldIcon" data-id="${ic}"
      style="width:34px;height:34px;border-radius:8px;font-size:1.1rem;cursor:pointer;
      border:2px solid ${(s?.icone||'📖')===ic?'var(--gold)':'var(--border)'};
      background:${(s?.icone||'📖')===ic?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
      transition:all .1s;display:flex;align-items:center;justify-content:center">${ic}</button>
  `).join('');

  const selCat  = _categories.find(c => c.id === selCatId);
  const bgStyle = s?.imageUrl ? `background-image:url('${_esc(s.imageUrl).replace(/'/g,'%27')}')` : '';

  openModal('', `
  <div class="mn-shell">

    <!-- ════ HERO : bannière image + titre + eyebrow catégorie ════ -->
    <div class="mn-hero" id="wi-hero">
      <div class="mn-hero-bg" id="wi-hero-bg" style="${bgStyle}"></div>
      <div class="mn-hero-fade"></div>

      <div id="wi-img-drop" class="mn-hero-drop" title="Cliquer ou déposer une image">
        <div id="wi-img-preview" style="display:none"></div>
        <div class="mn-hero-drop-hint">
          <span class="mn-hero-drop-icon">🖼️</span>
          <span>Glisser une image ou cliquer</span>
          ${s?.imageUrl ? `<button type="button" id="wi-img-clear"
            style="background:none;border:none;cursor:pointer;color:#ff8ca7;font-size:.78rem;padding:0 2px"
            title="Retirer l'image">✕</button>` : '<span id="wi-img-clear" hidden></span>'}
        </div>
      </div>

      <div class="mn-hero-content">
        <div class="mn-hero-eyebrow">
          <span id="wi-cat-eyebrow">${_esc(selCat?.icone || '📁')} ${_esc(selCat?.nom || 'Catégorie')}</span>
        </div>
        <input type="text" class="mn-hero-title" id="wi-titre" value="${_esc(s?.titre||'')}"
          placeholder="${s ? 'Titre de la section…' : 'Donne un nom à ta section…'}" autocomplete="off">
      </div>

      <div id="wi-crop-wrap" class="mn-crop-wrap" style="display:none">
        <canvas id="wi-crop-canvas"></canvas>
        <div class="mn-crop-bar">
          <span class="mn-crop-hint">Recadre la bannière</span>
          <button type="button" class="btn btn-gold btn-sm" id="wi-crop-confirm">✂️ Confirmer</button>
          <div id="wi-crop-ok" style="display:none;font-size:.75rem"></div>
        </div>
      </div>
    </div>

    <!-- ════ BODY ════ -->
    <div class="mn-body">
      <input type="hidden" id="wi-id" value="${s?.id||''}">
      <input type="hidden" id="wi-icon" value="${s?.icone||'📖'}">

      <div class="mn-row">
        <label class="mn-label" for="wi-categorie">Catégorie</label>
        <select class="input-field" id="wi-categorie" data-change="_worldSyncEyebrow" style="flex:1">${catOptions}</select>
      </div>

      <div class="mn-field">
        <label class="mn-label">Icône <span class="mn-label-hint">affichée dans la navigation</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:.3rem">${iconGrid}</div>
      </div>

      <div class="mn-field">
        <label class="mn-label">Contenu <span class="mn-label-hint">texte enrichi</span></label>
        ${richTextEditorHtml({ id: 'wi-contenu', html: _contentToHtml(s?.contenu || ''), placeholder: 'Décris ce chapitre du lore…', minHeight: 240 })}
      </div>

      <label style="display:flex;align-items:center;gap:.6rem;
        padding:.55rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);
        border-radius:8px;cursor:pointer;font-size:.84rem;color:var(--text-muted)">
        <input type="checkbox" id="wi-hidden" ${s?.visible===false?'checked':''} style="accent-color:#ff6b6b">
        <span>🔒 Masquée aux joueurs</span>
      </label>
    </div>

    <!-- ════ FOOTER ════ -->
    <div class="mn-footer">
      <span class="mn-footer-hint">📖 Visible par tous les membres de l'aventure</span>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-outline btn-sm" data-action="_worldClose">Annuler</button>
        <button class="btn btn-gold" data-action="saveWorldSection">${s ? 'Enregistrer' : 'Créer la section'}</button>
      </div>
    </div>

  </div>
  `);

  // Éditeur rich-text du contenu (toolbar gras/listes/couleur…)
  bindRichTextEditors();

  // Upload + crop bannière → met à jour le fond du hero en live (onResult).
  _wiCropper?.destroy();
  _wiCropper = attachDropAndCrop({
    dropEl:        document.getElementById('wi-img-drop'),
    previewEl:     document.getElementById('wi-img-preview'),
    cropWrapEl:    document.getElementById('wi-crop-wrap'),
    canvasId:      'wi-crop-canvas',
    statusEl:      document.getElementById('wi-crop-ok'),
    confirmBtnEl:  document.getElementById('wi-crop-confirm'),
    clearBtnEl:    document.getElementById('wi-img-clear'),
    initialUrl:    s?.imageUrl || '',
    initialRatio:  { w: 16, h: 6 },
    maxDisplayW:   460,
    previewMaxH:   70,
    output:        { qualities: [0.82, 0.72, 0.60, 0.50] },
    onResult: (b64) => {
      const hero = document.getElementById('wi-hero-bg');
      if (!hero) return;
      hero.style.backgroundImage = b64 ? `url("${String(b64).replace(/"/g,'%22')}")` : '';
    },
  });
};

// Synchronise l'eyebrow du hero avec la catégorie choisie dans le select
window._worldSyncEyebrow = () => {
  const sel = document.getElementById('wi-categorie');
  const eye = document.getElementById('wi-cat-eyebrow');
  if (!sel || !eye) return;
  const c = _categories.find(cat => cat.id === sel.value);
  eye.textContent = `${c?.icone || '📁'} ${c?.nom || 'Catégorie'}`;
};

window._selectWorldIcon = (ic) => {
  ICONES.forEach(i => {
    const btn = document.getElementById(`wi-icon-${i}`);
    if (!btn) return;
    btn.style.borderColor = i === ic ? 'var(--gold)' : 'var(--border)';
    btn.style.background  = i === ic ? 'rgba(232,184,75,.12)' : 'var(--bg-elevated)';
  });
  const inp = document.getElementById('wi-icon');
  if (inp) inp.value = ic;
};

window.saveWorldSection = async () => {
  const titre = document.getElementById('wi-titre')?.value?.trim();
  if (!titre) { showNotif('Un titre est requis.', 'error'); return; }

  const id        = document.getElementById('wi-id')?.value || `ws_${Date.now()}`;
  const isNew     = !document.getElementById('wi-id')?.value;
  const icone     = document.getElementById('wi-icon')?.value || '📖';
  const contenu   = getRichTextHtml('wi-contenu');
  const hidden    = document.getElementById('wi-hidden')?.checked || false;
  const categoryId = document.getElementById('wi-categorie')?.value
    || _categories[0]?.id || DEFAULT_CAT.id;

  // Résoudre l'image : nouveau crop > existante > effacée
  const existing = _sections.find(s => s.id === id);
  const cropResult = _wiCropper?.getResult();
  let imageUrl = existing?.imageUrl || '';
  if (typeof cropResult === 'string') imageUrl = cropResult;
  else if (cropResult === null)       imageUrl = '';
  _wiCropper?.destroy(); _wiCropper = null;

  const section = { id, titre, icone, contenu, imageUrl, visible: !hidden, categoryId };

  if (isNew) {
    _sections.push(section);
  } else {
    const idx = _sections.findIndex(s => s.id === id);
    if (idx >= 0) _sections[idx] = section;
  }

  await _save();
  _activeId = id;
  closeModal();
  showNotif(isNew ? 'Section créée !' : 'Section mise à jour !', 'success');
  renderWorld();
};

window.deleteWorldSection = async (id) => {
  if (!await confirmModal('Supprimer cette section définitivement ?')) return;
  _sections = _sections.filter(s => s.id !== id);
  if (_activeId === id) _activeId = _sections[0]?.id || null;
  await _save();
  showNotif('Section supprimée.', 'success');
  renderWorld();
};

// ── Modal création / édition CATÉGORIE ────────────────────────────────────────
window.openWorldCategoryModal = (id = null) => {
  const c = id ? _categories.find(cat => cat.id === id) : null;

  const iconGrid = ICONES.map(ic => `
    <button type="button" id="wc-icon-${ic}" data-action="_selectWorldCatIcon" data-id="${ic}"
      style="width:34px;height:34px;border-radius:8px;font-size:1.1rem;cursor:pointer;
      border:2px solid ${(c?.icone||'📁')===ic?'var(--gold)':'var(--border)'};
      background:${(c?.icone||'📁')===ic?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
      transition:all .1s;display:flex;align-items:center;justify-content:center">${ic}</button>
  `).join('');

  openModal(c ? `✏️ Modifier la catégorie — ${c.nom||''}` : '+ Nouvelle catégorie', `
    <input type="hidden" id="wc-id" value="${c?.id||''}">
    <input type="hidden" id="wc-icon" value="${c?.icone||'📁'}">

    <div class="form-group">
      <label>Icône</label>
      <div style="display:flex;flex-wrap:wrap;gap:.3rem">${iconGrid}</div>
    </div>

    <div class="form-group">
      <label>Nom de la catégorie</label>
      <input class="input-field" id="wc-nom" value="${_esc(c?.nom||'')}"
        placeholder="Géographie, Histoire, Factions…">
    </div>

    <label style="display:flex;align-items:center;gap:.6rem;margin-bottom:1rem;
      padding:.55rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);
      border-radius:8px;cursor:pointer;font-size:.84rem;color:var(--text-muted)">
      <input type="checkbox" id="wc-hidden" ${c?.visible===false?'checked':''}
        style="accent-color:#ff6b6b">
      <span>🔒 Masquée aux joueurs (cache aussi ses sections)</span>
    </label>

    <div style="display:flex;gap:.5rem">
      <button class="btn btn-gold" style="flex:1" data-action="saveWorldCategory">
        ${c ? 'Enregistrer' : 'Créer la catégorie'}
      </button>
      <button class="btn btn-outline btn-sm" data-action="_worldClose">Annuler</button>
    </div>
  `);
};

window._selectWorldCatIcon = (ic) => {
  ICONES.forEach(i => {
    const btn = document.getElementById(`wc-icon-${i}`);
    if (!btn) return;
    btn.style.borderColor = i === ic ? 'var(--gold)' : 'var(--border)';
    btn.style.background  = i === ic ? 'rgba(232,184,75,.12)' : 'var(--bg-elevated)';
  });
  const inp = document.getElementById('wc-icon');
  if (inp) inp.value = ic;
};

window.saveWorldCategory = async () => {
  const nom = document.getElementById('wc-nom')?.value?.trim();
  if (!nom) { showNotif('Un nom est requis.', 'error'); return; }
  const id     = document.getElementById('wc-id')?.value || `wc_${Date.now()}`;
  const isNew  = !document.getElementById('wc-id')?.value;
  const icone  = document.getElementById('wc-icon')?.value || '📁';
  const hidden = document.getElementById('wc-hidden')?.checked || false;
  const category = { id, nom, icone, visible: !hidden };

  if (isNew) {
    _categories.push(category);
  } else {
    const idx = _categories.findIndex(c => c.id === id);
    if (idx >= 0) _categories[idx] = category;
  }
  await _save();
  closeModal();
  showNotif(isNew ? 'Catégorie créée !' : 'Catégorie mise à jour !', 'success');
  renderWorld();
};

window.deleteWorldCategory = async (id) => {
  const cat = _categories.find(c => c.id === id);
  if (!cat) return;
  const orphans = _sections.filter(s => s.categoryId === id);
  // Catégorie de repli : « Général » si elle existe (et n'est pas celle supprimée),
  // sinon la 1re autre catégorie, sinon « Général » recréée.
  let fallback = _categories.find(c => c.id !== id && c.id === DEFAULT_CAT.id)
              || _categories.find(c => c.id !== id);
  const msg = orphans.length
    ? `Supprimer « ${cat.nom} » ? Ses ${orphans.length} section${orphans.length>1?'s':''} seront déplacées vers « ${fallback?.nom || DEFAULT_CAT.nom} ».`
    : `Supprimer « ${cat.nom} » ?`;
  if (!await confirmModal(msg)) return;

  _categories = _categories.filter(c => c.id !== id);
  if (orphans.length) {
    if (!fallback) { fallback = { ...DEFAULT_CAT }; _categories.unshift(fallback); }
    _sections = _sections.map(s => s.categoryId === id ? { ...s, categoryId: fallback.id } : s);
  }
  await _save();
  showNotif('Catégorie supprimée.', 'success');
  renderWorld();
};

// ── Utilitaires ───────────────────────────────────────────────────────────────
// _esc → importé depuis shared/html.js (_escapeHtml supprimé)

// ── Override PAGES.world ──────────────────────────────────────────────────────
PAGES.world = renderWorld;

Object.assign(window, {
  renderWorld,
  openWorldSectionModal,
  saveWorldSection,
  deleteWorldSection,
  selectWorldSection,
  openWorldCategoryModal,
  saveWorldCategory,
  deleteWorldCategory,
});

registerActions({
  openWorldSectionModal:  (btn) => openWorldSectionModal(btn.dataset.id || undefined, btn.dataset.catId || undefined),
  selectWorldSection:     (btn) => selectWorldSection(btn.dataset.id),
  deleteWorldSection:     (btn) => deleteWorldSection(btn.dataset.id),
  saveWorldSection:       ()    => saveWorldSection(),
  _selectWorldIcon:       (btn) => window._selectWorldIcon?.(btn.dataset.id),
  openWorldCategoryModal: (btn) => openWorldCategoryModal(btn.dataset.id || undefined),
  saveWorldCategory:      ()    => saveWorldCategory(),
  deleteWorldCategory:    (btn) => deleteWorldCategory(btn.dataset.id),
  _selectWorldCatIcon:    (btn) => window._selectWorldCatIcon?.(btn.dataset.id),
  _worldSyncEyebrow:      ()    => window._worldSyncEyebrow?.(),
  _worldClose:            ()    => closeModal(),
});