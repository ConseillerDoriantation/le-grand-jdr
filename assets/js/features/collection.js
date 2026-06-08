import { STATE } from '../core/state.js';
import { loadCollection } from '../data/firestore.js';
import { confirmDelete, trySave, tryUpsert } from '../shared/crud.js';
import { registerActions } from '../core/actions.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, pageHeaderHtml} from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { uploadPng } from '../shared/image-upload.js';


// ── Settings (template) ──────────────────────────────────────────────────────

const STORE = {
  cards: [],
  templateUrl: '',
  backImages: [],
};

function normalizeBackImages(rawBackImages, templateUrl = '') {
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
  const backImages = normalizeBackImages(doc.backImages, doc.templateUrl || '');
  STORE.templateUrl = doc.templateUrl || backImages[0]?.url || '';
  STORE.backImages = backImages;
}

function getCardBackImage(card) {
  return STORE.backImages.find(back => back.id === card?.backImageId)?.url
    || card?.backImageUrl
    || STORE.templateUrl
    || '';
}

// ── Rendu principal ──────────────────────────────────────────────────────────
export async function renderCollectionPage() {
  const [cards] = await Promise.all([
    loadCollection('collection'),
    loadSettings(),
  ]);

  STORE.cards = cards;

  const content = document.getElementById('main-content');

  let html = pageHeaderHtml("🃏 Collection", "Cartes à collectionner");

  if (STATE.isAdmin) {
    html += `
      <div class="admin-section">
        <div class="admin-label">Gestion Admin</div>
        <button class="btn btn-gold btn-sm" data-action="openCollectionModal">+ Ajouter une carte</button>
        <button class="btn btn-outline btn-sm" data-action="openTemplateModal">Images dos</button>
      </div>`;
  }

  if (STORE.cards.length === 0) {
    html += emptyStateHtml('🃏', 'La collection est vide.');
  } else {
    html += `<div class="collection-grid">`;

    STORE.cards.forEach(c => {
      const isUnlocked = !!c.unlocked;
      const cardBackImage = getCardBackImage(c);
      const faceImage = isUnlocked ? (c.imageUrl || '') : cardBackImage;
      const backImage = cardBackImage;

      const frontHtml = faceImage
        ? `<img src="${faceImage}" alt="${c.nom || ''}">`
        : `<span>${c.emoji || '🃏'}</span>`;

      const backHtml = backImage
        ? `<img src="${backImage}" alt="${c.nom || ''} (dos)">`
        : `<span>${c.emoji || '🃏'}</span>`;

      const adminBtns = STATE.isAdmin ? `
        <div class="coll-admin-btns">
          <button class="btn-icon" data-action="editCard" data-id="${c.id}" data-stop-propagation>✏️</button>
          <button class="btn-icon" data-action="toggleUnlock" data-id="${c.id}" data-stop-propagation>
            ${isUnlocked ? '🔓' : '🔒'}
          </button>
          <button class="btn-icon" data-action="deleteCard" data-id="${c.id}" data-stop-propagation>🗑️</button>
        </div>
      ` : '';

      html += `
        <div class="coll-card-wrapper">
          
          <div class="coll-card ${isUnlocked ? 'unlocked' : 'locked'}" data-action="viewCard" data-id="${c.id}">
            <div class="coll-card-inner">
              <div class="coll-card-front">
                <div class="coll-img">${frontHtml}</div>
              </div>
              <div class="coll-card-back">
                <div class="coll-img">${backHtml}</div>
              </div>
            </div>
          </div>

          ${adminBtns}

        </div>`;
    });

    html += `</div>`;
  }

  content.innerHTML = html;
}

async function toggleUnlock(id) {
  const card = STORE.cards.find(c => c.id === id);
  if (!card) return;
  if (await trySave('collection', id, { unlocked: !card.unlocked })) {
    showNotif(card.unlocked ? 'Carte verrouillée.' : 'Carte débloquée.', 'success');
  }
  await renderCollectionPage();
}

// ── Modale ajout / édition ───────────────────────────────────────────────────
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
        <button class="btn-icon coll-back-remove" data-action="removeBackImage" data-index="${index}" data-stop-propagation title="Retirer">x</button>
      </div>
    `).join('')
    : '<div class="muted">Aucun dos ajouté.</div>';
}

function openTemplateModal() {
  openModal('Images dos des cartes', `
    <div class="form-group"><label>Images dos de carte</label>
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
  const templateUrl = backImages[0]?.url || '';
  const settings = await loadCollection('collectionSettings');
  if (await tryUpsert('collectionSettings', settings[0]?.id || null, { templateUrl, backImages })) {
    STORE.templateUrl = templateUrl;
    STORE.backImages = backImages;
    closeModal();
    showNotif('Images dos mises à jour.', 'success');
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

function openCollectionModal(card = null) {
  openModal(card ? '✏️ Modifier la carte' : '🃏 Nouvelle carte', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="cc-nom" value="${card?.nom || ''}"></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="cc-desc" rows="4">${card?.description || ''}</textarea></div>
    <div class="form-group"><label>Image <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <div class="sh-upload-simple">
        <input type="file" id="cat-img-file" accept="image/*" data-change="previewUploadPng" data-preview="sc-img-preview" data-b64="cat-img-b64">
        <input type="hidden" id="cat-img-b64" value="${card?.imageUrl || ''}">
      </div>
      <div id="sc-img-preview">${card?.imageUrl ? `<img src="${card.imageUrl}" style="max-height:80px;margin-top:0.4rem;display:block">` : ''}</div>
    </div>
    <div class="form-group"><label>Image dos associée</label>
      ${renderCardBackPicker(card?.backImageId || '', card?.backImageUrl || '')}
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveCard" data-id="${card?.id || ''}">Enregistrer</button>
  `);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function saveCard(id = '') {
  const existing = id ? STORE.cards.find(c => c.id === id) : null;
  const data = {
    nom: document.getElementById('cc-nom')?.value?.trim() || 'Carte',
    imageUrl: document.getElementById('cat-img-b64')?.value || '',
    backImageId: document.querySelector('input[name="cc-back-image"]:checked')?.value || STORE.backImages[0]?.id || '',
    description: document.getElementById('cc-desc')?.value || '',
    unlocked: existing?.unlocked || false
  };
  if (await tryUpsert('collection', id || null, data)) {
    closeModal();
    showNotif('Carte enregistrée.', 'success');
    await renderCollectionPage();
  }
}

function viewCard(id) {
  const el = document.querySelector(`.coll-card[data-id="${id}"]`);
  if (el) el.classList.toggle('flipped');
}

function editCard(id) {
  const card = STORE.cards.find(c => c.id === id);
  if (card) openCollectionModal(card);
}

async function deleteCard(id) {
  if (!await confirmDelete('collection', id, 'Supprimer cette carte ?')) return;
  showNotif('Carte supprimée.', 'success');
  await renderCollectionPage();
}

async function previewUploadBackImages(el) {
  const files = Array.from(document.getElementById(el.id)?.files || []);
  if (!files.length) return;
  const images = getBackImagesInput();
  for (const file of files) {
    const b64 = await uploadPng(file, { max: 600 });
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
  saveCard:    (btn) => saveCard(btn.dataset.id || ''),
  viewCard:    (btn) => viewCard(btn.dataset.id),
  editCard:    (btn) => editCard(btn.dataset.id),
  toggleUnlock:(btn) => toggleUnlock(btn.dataset.id),
  deleteCard:  (btn) => deleteCard(btn.dataset.id),
  previewUploadBackImages: (el) => previewUploadBackImages(el),
  removeBackImage: (btn) => removeBackImage(btn.dataset.index),
  previewUploadPng: (el) => { const f = document.getElementById(el.id)?.files?.[0]; if (f) uploadPng(f, { previewId: el.dataset.preview, hiddenId: el.dataset.b64 }); },
});
