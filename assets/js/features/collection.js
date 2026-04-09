import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';

// Initialiser le namespace si app.js ne l'a pas encore fait
window.JDRApp = window.JDRApp || {};

let _cards = [];
let _templateUrl = '';

// ── Settings (template) ──────────────────────────────────────────────────────
async function loadSettings() {
  const settings = await loadCollection('collectionSettings');
  _templateUrl = settings[0]?.templateUrl || '';
}

// ── Rendu principal ──────────────────────────────────────────────────────────
export async function renderCollectionPage() {
  const [cards] = await Promise.all([
    loadCollection('collection'),
    loadSettings(),
  ]);

  _cards = cards;

  const content = document.getElementById('main-content');

  let html = `
    <div class="page-header">
      <div class="page-title"><span class="page-title-accent">🃏 Collection</span></div>
      <div class="page-subtitle">Cartes à collectionner</div>
    </div>`;

  if (STATE.isAdmin) {
    html += `
      <div class="admin-section">
        <div class="admin-label">Gestion Admin</div>
        <button class="btn btn-gold btn-sm" onclick="JDRApp.openCollectionModal()">+ Ajouter une carte</button>
        <button class="btn btn-outline btn-sm" onclick="JDRApp.openTemplateModal()">🖼️ Template (Image recto)</button>
      </div>`;
  }

  if (_cards.length === 0) {
    html += `
      <div class="empty-state">
        <div class="icon">🃏</div>
        <p>La collection est vide.</p>
      </div>`;
  } else {
    html += `<div class="collection-grid">`;

    _cards.forEach(c => {
      const isUnlocked = !!c.unlocked;
      const faceImage = isUnlocked ? (c.imageUrl || '') : (_templateUrl || '');
      const backImage = _templateUrl || '';

      const frontHtml = faceImage
        ? `<img src="${faceImage}" alt="${c.nom || ''}">`
        : `<span>${c.emoji || '🃏'}</span>`;

      const backHtml = backImage
        ? `<img src="${backImage}" alt="${c.nom || ''} (dos)">`
        : `<span>${c.emoji || '🃏'}</span>`;

      const adminBtns = STATE.isAdmin ? `
        <div class="coll-admin-btns">
          <button class="btn-icon" onclick="event.stopPropagation();editCard('${c.id}')">✏️</button>
          <button class="btn-icon" onclick="event.stopPropagation();toggleUnlock('${c.id}')">
            ${isUnlocked ? '🔓' : '🔒'}
          </button>
          <button class="btn-icon" onclick="event.stopPropagation();deleteCard('${c.id}')">🗑️</button>
        </div>
      ` : '';

      html += `
        <div class="coll-card-wrapper">
          
          <div class="coll-card ${isUnlocked ? 'unlocked' : 'locked'}" onclick="viewCard('${c.id}')">
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
  try {
    const card = _cards.find(c => c.id === id);
    if (!card) return;

    await updateInCol('collection', id, {
      unlocked: !card.unlocked
    });

    showNotif(card.unlocked ? 'Carte verrouillée.' : 'Carte débloquée.', 'success');
    await renderCollectionPage();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── Template modal ───────────────────────────────────────────────────────────
function openTemplateModal() {
  openModal('🖼️ Image template des cartes', `
    <div class="form-group"><label>Image recto (dos de carte)</label>
      <div class="sh-upload-simple">
        <input type="file" id="tpl-img-file" accept="image/*" onchange="previewUploadPng('tpl-img-file','tpl-img-preview','tpl-img-b64')">
        <input type="hidden" id="tpl-img-b64">
      </div>
      <div id="tpl-img-preview">${_templateUrl ? `<img src="${_templateUrl}" style="max-height:120px;margin-top:0.4rem;display:block">` : ''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveTemplate()">Enregistrer</button>
  `);

  // setter après rendu, hors du string HTML
  document.getElementById('tpl-img-b64').value = _templateUrl;
}

async function saveTemplate() {
  try {
    const url = document.getElementById('tpl-img-b64')?.value || '';
    const settings = await loadCollection('collectionSettings');
    if (settings[0]) await updateInCol('collectionSettings', settings[0].id, { templateUrl: url });
    else await addToCol('collectionSettings', { templateUrl: url });
    _templateUrl = url;
    closeModal();
    showNotif('Template mis à jour.', 'success');
    await renderCollectionPage();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── Modale ajout / édition ───────────────────────────────────────────────────
function openCollectionModal(card = null) {
  openModal(card ? '✏️ Modifier la carte' : '🃏 Nouvelle carte', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="cc-nom" value="${card?.nom || ''}"></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="cc-desc" rows="4">${card?.description || ''}</textarea></div>
    <div class="form-group"><label>Image <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <div class="sh-upload-simple">
        <input type="file" id="cat-img-file" accept="image/*" onchange="previewUploadPng('cat-img-file','sc-img-preview','cat-img-b64')">
        <input type="hidden" id="cat-img-b64" value="${card?.imageUrl || ''}">
      </div>
      <div id="sc-img-preview">${card?.imageUrl ? `<img src="${card.imageUrl}" style="max-height:80px;margin-top:0.4rem;display:block">` : ''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCard('${card?.id || ''}')">Enregistrer</button>
  `);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function saveCard(id = '') {
  try {
    const data = {
      nom: document.getElementById('cc-nom')?.value?.trim() || 'Carte',
      imageUrl: document.getElementById('cat-img-b64')?.value || '',
      description: document.getElementById('cc-desc')?.value || '',
      unlocked: false
    };
    if (id) await updateInCol('collection', id, data);
    else await addToCol('collection', data);
    closeModal();
    showNotif('Carte enregistrée.', 'success');
    await renderCollectionPage();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

function viewCard(id) {
  const el = document.querySelector(`.coll-card[onclick*="${id}"]`);
  if (el) el.classList.toggle('flipped');
}

function editCard(id) {
  const card = _cards.find(c => c.id === id);
  if (card) openCollectionModal(card);
}

async function deleteCard(id) {
  try {
    if (!await confirmModal('Supprimer cette carte ?')) return;
    await deleteFromCol('collection', id);
    showNotif('Carte supprimée.', 'success');
    await renderCollectionPage();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

Object.assign(window.JDRApp, {
  openCollectionModal, saveCard, viewCard, editCard, deleteCard, toggleUnlock,
  openTemplateModal, saveTemplate,
});
