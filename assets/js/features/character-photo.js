import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { pickImageFile } from '../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../shared/image-crop.js';

// ══════════════════════════════════════════════════════════════════════════════
// CHARACTER PHOTO — upload → crop pan/zoom → persistance Firestore.
// La logique de crop est centralisée dans shared/image-crop.js.
// ══════════════════════════════════════════════════════════════════════════════

const VIEW_SIZE   = 300;
const OUTPUT_SIZE = 300;

let _activePhotoCrop = null;
let _unbindModalCleanup = null;

function _destroyCharacterPhotoCrop() {
  _activePhotoCrop?.destroy();
  _activePhotoCrop = null;
  _unbindModalCleanup?.();
  _unbindModalCleanup = null;
}

function _bindModalCleanup() {
  _unbindModalCleanup?.();
  const overlay = document.getElementById('modal-overlay');
  const obs = new MutationObserver(() => {
    if (!overlay?.classList.contains('show')) _destroyCharacterPhotoCrop();
  });
  if (overlay) obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  _unbindModalCleanup = () => {
    obs.disconnect();
  };
}

function openCharacterPhotoPicker(charId) {
  pickImageFile({ onImage: ({ dataUrl }) => _showCropModal(dataUrl, charId) });
}

function _showCropModal(dataUrl, charId) {
  openModal('📷 Cadrer la photo', `
    ${panZoomCropHTML({ idPrefix: 'crop', viewSize: VIEW_SIZE })}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;
      width:${VIEW_SIZE}px;margin:.8rem auto 0">
      <button class="btn btn-outline" id="char-photo-cancel">Annuler</button>
      <button class="btn btn-gold" id="char-photo-save">✅ Enregistrer</button>
    </div>
  `);

  // L'image et le slider doivent être présents dans le DOM avant le binding.
  requestAnimationFrame(() => {
    _destroyCharacterPhotoCrop();
    _activePhotoCrop = attachPanZoomCrop({
      idPrefix: 'crop', dataUrl,
      viewSize: VIEW_SIZE, outputSize: OUTPUT_SIZE,
    });
    document.getElementById('char-photo-cancel')?.addEventListener('click', cancelCharacterPhotoCrop, { once: true });
    document.getElementById('char-photo-save')?.addEventListener('click', () => saveCroppedCharacterPhoto(charId));
    _bindModalCleanup();
  });
}

function cancelCharacterPhotoCrop() {
  _destroyCharacterPhotoCrop();
  closeModal();
}

async function saveCroppedCharacterPhoto(charId) {
  try {
    const dataUrl = _activePhotoCrop?.getBase64();
    if (!dataUrl) { showNotif('Erreur : cropper non initialisé.', 'error'); return; }

    const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
    if (!c) { showNotif('Personnage introuvable.', 'error'); return; }

    c.photo = dataUrl; c.photoZoom = 1; c.photoX = 0; c.photoY = 0; // legacy reset
    await updateInCol('characters', charId, { photo: dataUrl, photoZoom: 1, photoX: 0, photoY: 0 });

    _destroyCharacterPhotoCrop();
    closeModal();
    showNotif('Photo enregistrée !', 'success');
    window.renderCharSheet?.(c, window._currentCharTab || 'combat');
  } catch (e) {
    console.error('[saveCroppedCharacterPhoto]', e);
    showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

async function deleteCharPhoto(charId) {
  try {
    const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
    if (!c) return;
    c.photo = null; c.photoZoom = 1; c.photoX = 0; c.photoY = 0;
    await updateInCol('characters', charId, { photo: null, photoZoom: 1, photoX: 0, photoY: 0 });
    showNotif('Photo supprimée.', 'success');
    window.renderCharSheet?.(c, window._currentCharTab || 'combat');
  } catch (e) {
    console.error('[deleteCharPhoto]', e);
    showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

document.addEventListener('click', (e) => {
  const photoEl = e.target.closest('[data-action="open-character-photo"]');
  if (photoEl) {
    openCharacterPhotoPicker(photoEl.dataset.charid);
    return;
  }
  const deleteEl = e.target.closest('[data-action="delete-character-photo"]');
  if (deleteEl) {
    e.stopPropagation();
    deleteCharPhoto(deleteEl.dataset.charid);
  }
});
