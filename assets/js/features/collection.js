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
};

async function loadSettings() {
  const settings = await loadCollection('collectionSettings');
  STORE.templateUrl = settings[0]?.templateUrl || '';
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
        <button class="btn btn-outline btn-sm" data-action="openTemplateModal">🖼️ Template (Image recto)</button>
      </div>`;
  }

  if (STORE.cards.length === 0) {
    html += emptyStateHtml('🃏', 'La collection est vide.');
  } else {
    html += `<div class="collection-grid">`;

    STORE.cards.forEach(c => {
      const isUnlocked = !!c.unlocked;
      const faceImage = isUnlocked ? (c.imageUrl || '') : (STORE.templateUrl || '');
      const backImage = STORE.templateUrl || '';

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

// ── Template modal ───────────────────────────────────────────────────────────
function openTemplateModal() {
  openModal('🖼️ Image template des cartes', `
    <div class="form-group"><label>Image recto (dos de carte)</label>
      <div class="sh-upload-simple">
        <input type="file" id="tpl-img-file" accept="image/*" data-change="previewUploadPng" data-preview="tpl-img-preview" data-b64="tpl-img-b64">
        <input type="hidden" id="tpl-img-b64">
      </div>
      <div id="tpl-img-preview">${STORE.templateUrl ? `<img src="${STORE.templateUrl}" style="max-height:120px;margin-top:0.4rem;display:block">` : ''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveTemplate">Enregistrer</button>
  `);

  // setter après rendu, hors du string HTML
  document.getElementById('tpl-img-b64').value = STORE.templateUrl;
}

async function saveTemplate() {
  const url = document.getElementById('tpl-img-b64')?.value || '';
  const settings = await loadCollection('collectionSettings');
  if (await tryUpsert('collectionSettings', settings[0]?.id || null, { templateUrl: url })) {
    STORE.templateUrl = url;
    closeModal();
    showNotif('Template mis à jour.', 'success');
    await renderCollectionPage();
  }
}

// ── Modale ajout / édition ───────────────────────────────────────────────────
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
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveCard" data-id="${card?.id || ''}">Enregistrer</button>
  `);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function saveCard(id = '') {
  const data = {
    nom: document.getElementById('cc-nom')?.value?.trim() || 'Carte',
    imageUrl: document.getElementById('cat-img-b64')?.value || '',
    description: document.getElementById('cc-desc')?.value || '',
    unlocked: false
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

registerActions({
  openCollectionModal: () => openCollectionModal(),
  openTemplateModal:   () => openTemplateModal(),
  saveTemplate:        () => saveTemplate(),
  saveCard:    (btn) => saveCard(btn.dataset.id || ''),
  viewCard:    (btn) => viewCard(btn.dataset.id),
  editCard:    (btn) => editCard(btn.dataset.id),
  toggleUnlock:(btn) => toggleUnlock(btn.dataset.id),
  deleteCard:  (btn) => deleteCard(btn.dataset.id),
  previewUploadPng: (el) => { const f = document.getElementById(el.id)?.files?.[0]; if (f) uploadPng(f, { previewId: el.dataset.preview, hiddenId: el.dataset.b64 }); },
});