import { STATE } from '../core/state.js';
import { loadCollection } from '../data/firestore.js';
import { confirmDelete, trySave, tryUpsert } from '../shared/crud.js';
import { registerActions } from '../core/actions.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, _nl2br, _trunc } from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { uploadJpeg } from '../shared/image-upload.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import { makeSortable } from '../shared/sortable-helper.js';

// ── État local ───────────────────────────────────────────────────────────────
const STORE = {
  cards: [],
  templateUrl: '',   // dos de carte historique / fallback
  backImages: [],
};
let _sortable = null;
let _cardImageCropper = null;

function normalizeBackImages(rawBackImages, templateUrl = '', backImagesById = null, backImageOrder = []) {
  if (backImagesById && typeof backImagesById === 'object') {
    const orderedIds = Array.isArray(backImageOrder) ? backImageOrder : [];
    const ordered = orderedIds
      .map(id => backImagesById[id] ? { id, url: backImagesById[id] } : null)
      .filter(Boolean);
    const missing = Object.entries(backImagesById)
      .filter(([id, url]) => url && !orderedIds.includes(id))
      .map(([id, url]) => ({ id, url }));
    const images = [...ordered, ...missing];
    return images.length ? images : (templateUrl ? [{ id: 'legacy_template', url: templateUrl }] : []);
  }

  const images = (Array.isArray(rawBackImages) ? rawBackImages : [])
    .map((item, index) => {
      if (typeof item === 'string') return item ? { id: `back_${index}`, url: item } : null;
      if (item?.url) return { id: item.id || `back_${index}`, url: item.url };
      return null;
    })
    .filter(Boolean);
  return images.length ? images : (templateUrl ? [{ id: 'legacy_template', url: templateUrl }] : []);
}

async function loadSettings() {
  const settings = await loadCollection('collectionSettings');
  const doc = settings[0] || {};
  const backImages = normalizeBackImages(
    doc.backImages,
    doc.templateUrl || '',
    doc.backImagesById,
    doc.backImageOrder
  );
  STORE.templateUrl = doc.templateUrl || backImages[0]?.url || '';
  STORE.backImages = backImages;
}

function getCardBackImage(card) {
  return STORE.backImages.find(back => back.id === card?.backImageId)?.url
    || card?.backImageUrl
    || STORE.templateUrl
    || '';
}

// Un joueur ne voit le visuel + les infos que si la carte est débloquée.
// Le MJ voit tout. Le défi peut être masqué (descMasquee) même débloqué.
const _canSeeFace      = (c) => STATE.isAdmin || !!c.unlocked;
const _challengeMasked = (c) => !!c.descMasquee && !STATE.isAdmin;

// ── Rendu principal ──────────────────────────────────────────────────────────
export async function renderCollectionPage() {
  const [cards] = await Promise.all([
    loadCollection('collection'),
    loadSettings(),
  ]);

  STORE.cards = [...cards].sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999));

  const content = document.getElementById('main-content');
  const total = STORE.cards.length;
  const unlocked = STORE.cards.filter(c => c.unlocked).length;

  let html = `<section class="coll-page${STATE.isAdmin ? ' coll-page--admin' : ''}">${_collectionHeaderHtml(unlocked, total)}`;

  if (STATE.isAdmin) html += _collectionAdminPanelHtml(unlocked, total);

  if (STORE.cards.length === 0) {
    html += emptyStateHtml('🃏', 'La collection est vide.');
    content.innerHTML = `${html}</section>`;
    return;
  }

  html += STATE.isAdmin
    ? `<div class="coll-admin-grid" aria-label="Gestion MJ des cartes de collection">${STORE.cards.map(_adminCardHtml).join('')}</div>`
    : `<div class="collection-grid">${STORE.cards.map(_cardHtml).join('')}</div>`;
  content.innerHTML = `${html}</section>`;

  // Drag & drop (MJ) → réordonne et persiste l'ordre partagé.
  const grid = content.querySelector('.coll-admin-grid');
  if (grid && STATE.isAdmin) {
    _sortable = makeSortable(grid, {
      prefix: 'coll',
      draggable: '.coll-admin-card',
      handle: '.coll-admin-drag',
      onEnd: () => _persistOrder('.coll-admin-grid .coll-admin-card'),
    });
  }
}

function _collectionHeaderHtml(unlocked, total) {
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const counter = total > 0 ? `
    <div class="coll-head-counter" aria-label="Progression de la collection : ${unlocked} carte${unlocked === 1 ? '' : 's'} débloquée${unlocked === 1 ? '' : 's'} sur ${total}, ${pct}%">
      <span class="coll-head-count"><strong>${unlocked}</strong><span>/${total}</span></span>
      <span class="coll-head-label">débloquée${unlocked === 1 ? '' : 's'}</span>
    </div>` : '';

  return `<header class="page-header coll-page-header">
    <div class="coll-title-line">
      <span class="coll-title-glyph" aria-hidden="true"><span></span></span>
      <div class="coll-title-copy">
        <div class="page-title"><span class="page-title-accent">Collection</span></div>
        <div class="page-subtitle">Cartes à collectionner</div>
      </div>
      ${counter}
    </div>
  </header>`;
}

function _collectionAdminPanelHtml(unlocked, total) {
  const locked = Math.max(total - unlocked, 0);
  const missingArt = STORE.cards.filter(c => !c.imageUrl).length;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return `
    <section class="coll-admin-panel" aria-label="Pilotage MJ de la collection">
      <div class="coll-admin-panel-copy">
        <div class="coll-admin-kicker">Mode MJ</div>
        <h2>Atelier de collection</h2>
        <p>Visuels, défis et révélations.</p>
      </div>
      <div class="coll-admin-stats" aria-label="Résumé de la collection">
        <span><strong>${unlocked}</strong> débloquée${unlocked === 1 ? '' : 's'}</span>
        <span><strong>${locked}</strong> verrouillée${locked === 1 ? '' : 's'}</span>
        <span><strong>${pct}%</strong> progression</span>
        ${missingArt ? `<span class="is-warn"><strong>${missingArt}</strong> sans image</span>` : ''}
      </div>
      <div class="coll-admin-actions" aria-label="Actions de gestion">
        <button class="btn btn-gold btn-sm" data-action="openCollectionModal">+ Ajouter</button>
        <button class="btn btn-outline btn-sm" data-action="openTemplateModal">Dos de carte</button>
      </div>
    </section>`;
}

function _adminCardHtml(c, index) {
  const title = c.nom || 'Carte';
  const desc = c.description ? _trunc(c.description, 118) : 'Aucun défi renseigné.';
  const hasFront = !!c.imageUrl;
  const backImage = getCardBackImage(c);
  const hasTemplate = !!backImage;
  const art = hasFront
    ? `<img src="${_esc(c.imageUrl)}" loading="lazy" decoding="async" alt="${_esc(title)}">`
    : hasTemplate
      ? `<img src="${_esc(backImage)}" loading="lazy" decoding="async" alt="Dos de carte"><span class="coll-admin-art-note">Recto manquant</span>`
      : `<div class="coll-admin-empty-art"><span>${_esc(c.emoji || '🃏')}</span><small>Recto manquant</small></div>`;
  const artClass = `coll-admin-art${hasFront ? '' : ' coll-admin-art--template'}`;
  const unlockLabel = c.unlocked ? 'Débloquée' : 'Verrouillée';
  const unlockAction = c.unlocked ? 'Verrouiller' : 'Débloquer';

  return `
    <article class="coll-admin-card ${c.unlocked ? 'is-unlocked' : 'is-locked'}${c.imageUrl ? '' : ' is-missing-art'}" data-id="${c.id}" data-collection-id="${c.id}">
      <span class="coll-admin-drag" title="Réordonner" aria-hidden="true">↕</span>
      <button class="${artClass}" type="button" data-action="presentCard" data-id="${c.id}" data-stop-propagation aria-label="Présenter ${_esc(title)} en grand">
        ${art}
      </button>
      <div class="coll-admin-body">
        <div class="coll-admin-row">
          <span class="coll-admin-order">#${String(index + 1).padStart(2, '0')}</span>
          <span class="coll-admin-status ${c.unlocked ? 'is-on' : 'is-off'}">${unlockLabel}</span>
          ${c.descMasquee ? '<span class="coll-admin-status is-secret">Défi secret</span>' : ''}
        </div>
        <h3 title="${_esc(title)}">${_esc(title)}</h3>
        <p class="coll-admin-desc ${c.description ? '' : 'is-empty'}">${_esc(desc)}</p>
        <div class="coll-admin-card-actions">
          <button class="btn btn-outline btn-sm" data-action="presentCard" data-id="${c.id}" data-stop-propagation>Présenter</button>
          <button class="btn btn-outline btn-sm" data-action="editCard" data-id="${c.id}" data-stop-propagation>Modifier</button>
          <button class="btn btn-outline btn-sm" data-action="toggleUnlock" data-id="${c.id}" data-stop-propagation>${unlockAction}</button>
          <button class="btn-icon coll-admin-delete" data-action="deleteCard" data-id="${c.id}" data-stop-propagation title="Supprimer" aria-label="Supprimer ${_esc(title)}">×</button>
        </div>
      </div>
    </article>`;
}

// ── HTML d'une carte (recto = visuel, verso = nom + défi) ────────────────────
function _cardHtml(c) {
  const seeFace = _canSeeFace(c);
  const masked  = _challengeMasked(c);
  const back    = getCardBackImage(c);

  // Recto
  let front;
  if (seeFace) {
    front = c.imageUrl
      ? `<img src="${_esc(c.imageUrl)}" loading="lazy" decoding="async" alt="${_esc(c.nom || '')}">`
      : `<span class="coll-emoji">${_esc(c.emoji || '🃏')}</span>`;
  } else {
    front = back
      ? `<img src="${_esc(back)}" loading="lazy" decoding="async" alt="Carte à débloquer">`
      : `<span class="coll-emoji coll-emoji--locked">🔒</span>`;
  }

  // Verso (infos)
  let back2;
  if (!seeFace) {
    back2 = `<div class="coll-back-info coll-back-info--mystery">
      <div class="coll-back-ic">🔒</div>
      <div class="coll-back-title">À débloquer</div>
      <div class="coll-back-sub">Relève le défi pour la révéler</div>
    </div>`;
  } else {
    const defi = masked
      ? `<div class="coll-defi coll-defi--masked">🔒 Défi gardé secret</div>`
      : (c.description
          ? `<div class="coll-defi">${_nl2br(_esc(c.description))}</div>`
          : `<div class="coll-defi coll-defi--empty">Aucun défi renseigné.</div>`);
    back2 = STATE.isAdmin
      ? `<div class="coll-back-info">
        <div class="coll-back-title">${_esc(c.nom || 'Carte')}</div>
        <div class="coll-back-label">Défi à relever</div>
        ${defi}
      </div>`
      : (back
          ? `<img class="coll-back-image" src="${_esc(back)}" loading="lazy" decoding="async" alt="Dos de carte">`
          : `<div class="coll-back-info coll-back-info--mystery">
            <div class="coll-back-ic">🃏</div>
            <div class="coll-back-title">Dos de carte</div>
          </div>`);
  }

  const badges = STATE.isAdmin ? `
    ${c.unlocked ? '' : '<span class="coll-badge coll-badge--locked">🔒</span>'}
    ${c.descMasquee ? '<span class="coll-badge coll-badge--masked">🙈</span>' : ''}` : '';

  const adminBtns = STATE.isAdmin ? `
    <div class="coll-admin-btns">
      <button class="btn-icon" data-action="editCard" data-id="${c.id}" data-stop-propagation title="Modifier">✏️</button>
      <button class="btn-icon" data-action="toggleUnlock" data-id="${c.id}" data-stop-propagation title="${c.unlocked ? 'Verrouiller' : 'Débloquer'}">${c.unlocked ? '🔓' : '🔒'}</button>
      <button class="btn-icon" data-action="deleteCard" data-id="${c.id}" data-stop-propagation title="Supprimer">🗑️</button>
    </div>` : '';

  return `
    <div class="coll-card-wrapper" data-id="${c.id}">
      <div class="coll-card ${c.unlocked ? 'unlocked' : 'locked'}" data-action="viewCard" data-id="${c.id}">
        <div class="coll-card-inner">
          <div class="coll-card-front">${front}<span class="coll-shine"></span></div>
          <div class="coll-card-back">${back2}</div>
        </div>
        ${badges}
      </div>
      <div class="coll-card-foot">
        <span class="coll-name" title="${_esc(c.nom || '')}">${seeFace ? _esc(c.nom || 'Carte') : '???'}</span>
        <button class="coll-present-btn" data-action="presentCard" data-id="${c.id}" data-stop-propagation
          title="Présenter en grand" aria-label="Présenter ${_esc(c.nom || 'la carte')} en grand">⛶</button>
      </div>
      ${adminBtns}
    </div>`;
}

// ── Flip recto/verso ─────────────────────────────────────────────────────────
function viewCard(id) {
  document.querySelector(`.coll-card[data-id="${id}"]`)?.classList.toggle('flipped');
}

// ── Présentation plein cadre ─────────────────────────────────────────────────
function presentCard(id) {
  const c = STORE.cards.find(x => x.id === id);
  if (!c) return;
  const seeFace = _canSeeFace(c);
  const masked  = _challengeMasked(c);
  const back    = getCardBackImage(c);
  const img     = seeFace ? (c.imageUrl || (STATE.isAdmin ? back : '')) : back;
  const title   = seeFace ? (c.nom || 'Carte') : 'Carte mystère';

  const art = img
    ? `<img src="${_esc(img)}" alt="${_esc(title)}">`
    : `<span class="coll-emoji">${_esc(seeFace ? (c.emoji || '🃏') : '🔒')}</span>`;

  let defi;
  if (!seeFace)      defi = `<p class="coll-present-defi coll-present-defi--mystery">Relève le défi associé pour révéler cette carte et son contenu.</p>`;
  else if (masked)   defi = `<p class="coll-present-defi coll-present-defi--masked">🔒 Le MJ garde ce défi secret pour l'instant.</p>`;
  else               defi = c.description
                       ? `<p class="coll-present-defi">${_nl2br(_esc(c.description))}</p>`
                       : `<p class="coll-present-defi coll-present-defi--empty">Aucun défi renseigné.</p>`;

  const status = c.unlocked
    ? `<span class="coll-present-status is-on">✓ Débloquée</span>`
    : `<span class="coll-present-status is-off">🔒 Verrouillée</span>`;

  openModal(`🃏 ${title}`, `
    <div class="coll-present">
      <div class="coll-present-card ${c.unlocked ? 'unlocked' : 'locked'}">
        <div class="coll-present-art">${art}<span class="coll-shine"></span></div>
      </div>
      <div class="coll-present-info">
        <div class="coll-present-head">
          <h3 class="coll-present-name">${_esc(title)}</h3>
          ${STATE.isAdmin ? status : ''}
        </div>
        <div class="coll-present-label">Défi à relever</div>
        ${defi}
        ${STATE.isAdmin ? `<div class="coll-present-admin">
          <button class="btn btn-outline btn-sm" data-action="editCard" data-id="${c.id}">✏️ Modifier</button>
        </div>` : ''}
      </div>
    </div>
  `);
  document.getElementById('modal-box')?.classList.add('modal--coll-present');
}

// ── Réordonnancement (persiste l'ordre seulement pour les cartes déplacées) ──
async function _persistOrder(selector = '.collection-grid .coll-card-wrapper') {
  const ids = [...document.querySelectorAll(selector)].map(el => el.dataset.id);
  const writes = [];
  ids.forEach((id, idx) => {
    const card = STORE.cards.find(c => c.id === id);
    if (card && card.ordre !== idx) {
      card.ordre = idx;
      writes.push(trySave('collection', id, { ordre: idx }));
    }
  });
  if (writes.length) await Promise.all(writes);
  STORE.cards.sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999));
}

// ── Débloquer / verrouiller ──────────────────────────────────────────────────
async function toggleUnlock(id) {
  const card = STORE.cards.find(c => c.id === id);
  if (!card) return;
  if (await trySave('collection', id, { unlocked: !card.unlocked })) {
    showNotif(card.unlocked ? 'Carte verrouillée.' : '🎉 Carte débloquée !', 'success');
  }
  closeModal();
  await renderCollectionPage();
}

// ── Dos de carte (template) ──────────────────────────────────────────────────
function getBackImagesInput() {
  const raw = document.getElementById('tpl-img-b64')?.value || '[]';
  try {
    const parsed = JSON.parse(raw);
    return normalizeBackImages(parsed);
  } catch (_) {
    return raw ? normalizeBackImages([raw]) : [];
  }
}

function setBackImagesInput(images) {
  const el = document.getElementById('tpl-img-b64');
  if (el) el.value = JSON.stringify(normalizeBackImages(images));
}

function renderBackImagesPreview() {
  const preview = document.getElementById('tpl-img-preview');
  if (!preview) return;
  const images = getBackImagesInput();
  preview.innerHTML = images.length
    ? images.map((back, index) => `
      <div class="coll-back-thumb">
        <img src="${_esc(back.url)}" alt="Dos ${index + 1}">
        <button class="btn-icon coll-back-remove" data-action="removeBackImage" data-index="${index}" data-stop-propagation title="Retirer">×</button>
      </div>
    `).join('')
    : '<div class="muted">Aucun dos ajouté.</div>';
}

function openTemplateModal() {
  openModal('🖼️ Dos de carte', `
    <p class="coll-modal-hint">Images affichées au dos des cartes et sur les cartes non encore débloquées.</p>
    <div class="form-group"><label>Images du dos</label>
      <div class="sh-upload-simple">
        <input type="file" id="tpl-img-file" accept="image/*" multiple data-change="previewUploadBackImages">
        <input type="hidden" id="tpl-img-b64">
      </div>
      <div id="tpl-img-preview" class="coll-back-list"></div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveTemplate">Enregistrer</button>
  `);
  setBackImagesInput(STORE.backImages);
  renderBackImagesPreview();
}

async function saveTemplate() {
  const backImages = getBackImagesInput();
  const backImagesById = Object.fromEntries(backImages.map(back => [back.id, back.url]));
  const backImageOrder = backImages.map(back => back.id);
  const payload = { templateUrl: '', backImagesById, backImageOrder };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (payloadBytes > 900_000) {
    showNotif("Trop d'images dos dans un seul enregistrement. Supprime-en ou utilise des images plus legeres.", 'error');
    return;
  }
  const settings = await loadCollection('collectionSettings');
  if (await tryUpsert('collectionSettings', settings[0]?.id || null, payload)) {
    STORE.templateUrl = backImages[0]?.url || '';
    STORE.backImages = backImages;
    closeModal();
    showNotif('Dos de carte mis à jour.', 'success');
    await renderCollectionPage();
  }
}

function renderCardBackPicker(selectedId = '', selectedUrl = '') {
  if (!STORE.backImages.length) {
    return '<div class="muted">Ajoute d’abord des images dos dans la gestion admin.</div>';
  }
  const selected = selectedId || STORE.backImages.find(back => back.url === selectedUrl)?.id || STORE.backImages[0]?.id || '';
  return `
    <div class="coll-back-picker">
      ${STORE.backImages.map((back, index) => `
        <label class="coll-back-choice ${back.id === selected ? 'is-selected' : ''}">
          <input type="radio" name="cc-back-image" value="${_esc(back.id)}" ${back.id === selected ? 'checked' : ''}>
          <img src="${_esc(back.url)}" alt="Dos ${index + 1}">
        </label>
      `).join('')}
    </div>`;
}

// ── Ajout / édition d'une carte ──────────────────────────────────────────────
function openCollectionModal(card = null) {
  _cardImageCropper?.destroy();
  _cardImageCropper = null;
  const imageStyle = card?.imageUrl ? `background-image:url('${_esc(card.imageUrl).replace(/'/g, "%27")}')` : '';

  openModal('', `
    <div class="mn-shell coll-card-editor">
      <div class="mn-hero coll-card-editor-hero">
        <div class="mn-hero-bg coll-card-editor-bg" id="cc-hero-bg" style="${imageStyle}"></div>
        <div class="mn-hero-fade"></div>

        <div id="cc-drop-zone" class="mn-hero-drop" title="Cliquer ou déposer une image">
          <div id="cc-drop-preview" class="coll-card-upload-preview"></div>
          <div class="mn-hero-drop-hint">
            <span class="mn-hero-drop-icon">Image</span>
            <span>Glisser ou choisir un recto</span>
          </div>
        </div>

        <div class="mn-hero-content">
          <div class="mn-hero-eyebrow">
            <span>${card ? 'Modifier la carte' : 'Nouvelle carte'}</span>
            <span class="mn-hero-eyebrow-sep">·</span>
            <span id="cc-mask-preview">${card?.descMasquee ? 'Défi masqué' : 'Défi visible'}</span>
          </div>
          <input type="text" class="mn-hero-title" id="cc-nom"
            value="${_esc(card?.nom || '')}"
            placeholder="Nom de la carte"
            autocomplete="off" autofocus>
          <div class="mn-hero-meta">
            <span class="mn-hero-statut coll-card-editor-pill">${STORE.backImages.length || 0} dos disponible${STORE.backImages.length > 1 ? 's' : ''}</span>
            <button type="button" class="mn-hero-statut coll-card-editor-clear" id="cc-img-clear">Retirer l'image</button>
          </div>
        </div>

        <div id="cc-crop-wrap" class="mn-crop-wrap coll-card-crop-wrap" style="display:none">
          <canvas id="cc-crop-canvas"></canvas>
          <div class="mn-crop-bar">
            <span class="mn-crop-hint">Recadre le recto · ratio carte</span>
            <button type="button" class="btn btn-outline btn-sm" id="cc-crop-clear">Retirer</button>
            <button type="button" class="btn btn-gold btn-sm" id="cc-crop-confirm">Confirmer</button>
            <div id="cc-crop-ok" style="display:none;font-size:.75rem"></div>
          </div>
        </div>
      </div>

      <div class="mn-body coll-card-editor-body">
        <section class="mn-panel is-active">
          <div class="mn-field">
            <label class="mn-label">Description / défi à relever</label>
            <textarea class="mn-input mn-textarea" id="cc-desc" rows="5"
              placeholder="Ex : Vaincre le dragon de cendres sans tomber au combat...">${_esc(card?.description || '')}</textarea>
          </div>

          <label class="mn-toggle">
            <input type="checkbox" id="cc-masque" ${card?.descMasquee ? 'checked' : ''}>
            <span class="mn-toggle-track"><span class="mn-toggle-thumb"></span></span>
            <span class="mn-toggle-text">
              <strong>Masquer le défi aux joueurs</strong>
              <span class="mn-label-hint">le nom reste visible, le défi s'affiche comme secret</span>
            </span>
          </label>

          <div class="mn-field">
            <label class="mn-label">Image dos associée</label>
            ${renderCardBackPicker(card?.backImageId || '', card?.backImageUrl || '')}
          </div>
        </section>
      </div>

      <div class="mn-footer">
        <div class="mn-footer-hint">Recto optionnel · dos obligatoire si plusieurs modèles existent</div>
        <div class="mn-footer-actions">
          <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
          <button class="btn btn-gold" data-action="saveCard" data-id="${card?.id || ''}">
            ${card ? 'Enregistrer' : 'Créer la carte'}
          </button>
        </div>
      </div>
    </div>
  `);

  const maskToggle = document.getElementById('cc-masque');
  const maskPreview = document.getElementById('cc-mask-preview');
  maskToggle?.addEventListener('change', () => {
    if (maskPreview) maskPreview.textContent = maskToggle.checked ? 'Défi masqué' : 'Défi visible';
  });

  _cardImageCropper = attachDropAndCrop({
    dropEl: document.getElementById('cc-drop-zone'),
    previewEl: document.getElementById('cc-drop-preview'),
    cropWrapEl: document.getElementById('cc-crop-wrap'),
    canvasId: 'cc-crop-canvas',
    statusEl: document.getElementById('cc-crop-ok'),
    confirmBtnEl: document.getElementById('cc-crop-confirm'),
    clearBtnEl: document.getElementById('cc-crop-clear'),
    initialUrl: card?.imageUrl || '',
    ratio: { w: 5, h: 7 },
    previewMaxH: 76,
    output: { maxW: 700, target: 700_000 },
    cropHintText: 'Recadre puis confirme',
    onResult: (b64) => {
      const bg = document.getElementById('cc-hero-bg');
      if (!bg) return;
      bg.style.backgroundImage = b64 ? `url("${String(b64).replace(/"/g, '%22')}")` : '';
    },
  });

  document.getElementById('cc-img-clear')?.addEventListener('click', (event) => {
    event.preventDefault();
    _cardImageCropper?.reset();
  });
}

async function saveCard(id = '') {
  const existing = id ? STORE.cards.find(c => c.id === id) : null;
  const imageResult = _cardImageCropper?.getResult();
  const data = {
    nom:         document.getElementById('cc-nom')?.value?.trim() || 'Carte',
    imageUrl:    imageResult === undefined ? (existing?.imageUrl || '') : (imageResult || ''),
    backImageId: document.querySelector('input[name="cc-back-image"]:checked')?.value || STORE.backImages[0]?.id || '',
    description: document.getElementById('cc-desc')?.value || '',
    descMasquee: !!document.getElementById('cc-masque')?.checked,
  };
  if (!id) {
    data.unlocked = false;
    data.ordre = STORE.cards.length;
  }
  if (await tryUpsert('collection', id || null, data)) {
    _cardImageCropper?.destroy();
    _cardImageCropper = null;
    closeModal();
    showNotif('Carte enregistrée.', 'success');
    await renderCollectionPage();
  }
}

function editCard(id) {
  const card = STORE.cards.find(c => c.id === id);
  if (card) openCollectionModal(card);
}

async function deleteCard(id) {
  if (!await confirmDelete('collection', id, 'Supprimer cette carte ?')) return;
  closeModal();
  showNotif('Carte supprimée.', 'success');
  await renderCollectionPage();
}

async function previewUploadBackImages(el) {
  const files = Array.from(document.getElementById(el.id)?.files || []);
  if (!files.length) return;
  const images = getBackImagesInput();
  for (const file of files) {
    const b64 = await uploadJpeg(file, { max: 420, quality: 0.72 });
    if (b64) images.push({ id: `back_${Date.now()}_${images.length}`, url: b64 });
  }
  setBackImagesInput(images);
  renderBackImagesPreview();
  el.value = '';
}

function removeBackImage(index) {
  const images = getBackImagesInput();
  images.splice(Number(index), 1);
  setBackImagesInput(images);
  renderBackImagesPreview();
}

registerActions({
  openCollectionModal: () => openCollectionModal(),
  openTemplateModal:   () => openTemplateModal(),
  saveTemplate:        () => saveTemplate(),
  saveCard:     (btn) => saveCard(btn.dataset.id || ''),
  viewCard:     (btn) => viewCard(btn.dataset.id),
  presentCard:  (btn) => presentCard(btn.dataset.id),
  editCard:     (btn) => editCard(btn.dataset.id),
  toggleUnlock: (btn) => toggleUnlock(btn.dataset.id),
  deleteCard:   (btn) => deleteCard(btn.dataset.id),
  previewUploadBackImages: (el) => previewUploadBackImages(el),
  removeBackImage: (btn) => removeBackImage(btn.dataset.index),
});
