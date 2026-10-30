import { STATE } from '../core/state.js';
import { charSession } from '../shared/char-session.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { compressDataUrl, pickImageFile } from '../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../shared/image-crop.js';
import { getActiveBuild, saveBuildPatch } from '../shared/character-builds.js';
import { saveCharacterOriginalPhoto } from '../shared/character-media.js';

import { getCharacterById } from '../shared/character-state.js';
// ══════════════════════════════════════════════════════════════════════════════
// CHARACTER PHOTO — upload → crop pan/zoom → persistance Firestore.
// La logique de crop est centralisée dans shared/image-crop.js.
// ══════════════════════════════════════════════════════════════════════════════

const VIEW_SIZE   = 300;
const OUTPUT_SIZE = 300;
// Le portrait cadré est utilisé partout et reste sur le document personnage.
// L'original sert uniquement à la visionneuse et vit dans characterMedia afin
// de ne jamais faire dépasser la limite Firestore de la fiche principale.
const CROPPED_PHOTO_BUDGET = 70_000;
const ORIGINAL_PHOTO_BUDGET = 180_000;

let _activePhotoCrop = null;
let _activePhotoSource = null;
let _unbindModalCleanup = null;

function _destroyCharacterPhotoCrop() {
  _activePhotoCrop?.destroy();
  _activePhotoCrop = null;
  _activePhotoSource = null;
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

function openDroppedCharacterPhoto(file, charId) {
  if (!file?.type?.startsWith('image/')) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    if (typeof reader.result === 'string') _showCropModal(reader.result, charId);
  }, { once: true });
  reader.readAsDataURL(file);
}

function _showCropModal(dataUrl, charId) {
  openModal('📷 Cadrer la photo', `
    ${panZoomCropHTML({ idPrefix: 'crop', viewSize: VIEW_SIZE })}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;
      width:${VIEW_SIZE}px;margin:.8rem auto 0">
      <button class="btn btn-outline" id="char-photo-cancel">Annuler</button>
      <button class="btn btn-gold" id="char-photo-save">✅ Enregistrer</button>
    </div>
  `, { subtitle: 'Zoome et déplace pour cadrer', accent: '#4f8cff' });

  // L'image et le slider doivent être présents dans le DOM avant le binding.
  requestAnimationFrame(() => {
    _destroyCharacterPhotoCrop();
    _activePhotoSource = dataUrl;
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
  const rawCropped = _activePhotoCrop?.getBase64();
  const sourceDataUrl = _activePhotoSource;
  if (!rawCropped) { showNotif('Erreur : cropper non initialisé.', 'error'); return; }

  const c = getCharacterById(charId);
  if (!c) { showNotif('Personnage introuvable.', 'error'); return; }

  // `photo` reste la miniature carrée légère utilisée partout dans l'app.
  // `photoOriginal` conserve la composition complète avant cadrage, mais dans
  // son propre document média afin de ne plus gonfler la fiche personnage.
  const dataUrl = await compressDataUrl(rawCropped, {
    max: OUTPUT_SIZE, quality: 0.78, maxBytes: CROPPED_PHOTO_BUDGET, minSide: 220,
  }) || rawCropped;
  const photoOriginal = await compressDataUrl(sourceDataUrl || rawCropped, {
    max: 900, quality: 0.74, maxBytes: ORIGINAL_PHOTO_BUDGET, minSide: 420,
  }) || dataUrl;
  const activeBuildId = getActiveBuild(c)?.id || c.activeBuildId || 'main';
  const previous = {
    photo: c.photo ?? null,
    photoOriginal: c.photoOriginal ?? null,
    photoZoom: c.photoZoom ?? 1,
    photoX: c.photoX ?? 0,
    photoY: c.photoY ?? 0,
  };
  c.photo = dataUrl; c.photoOriginal = null;
  c.photoZoom = 1; c.photoX = 0; c.photoY = 0;
  try {
    await saveCharacterOriginalPhoto(charId, activeBuildId, photoOriginal);
    await saveBuildPatch(charId, c, { photo: dataUrl, photoOriginal: null, photoZoom: 1, photoX: 0, photoY: 0 });
    _destroyCharacterPhotoCrop();
    closeModal();
    showNotif('Photo enregistrée !', 'success');
    charSession.renderSheet(c, charSession.getCurrentCharTab() || 'combat');
  } catch (e) {
    Object.assign(c, previous);
    showNotif(e?.message || 'Erreur de sauvegarde.', 'error');
  }
}

async function deleteCharPhoto(charId) {
  const c = getCharacterById(charId);
  if (!c) return;
  c.photo = null; c.photoOriginal = null;
  c.photoZoom = 1; c.photoX = 0; c.photoY = 0;
  try {
    const activeBuildId = getActiveBuild(c)?.id || c.activeBuildId || 'main';
    await saveCharacterOriginalPhoto(charId, activeBuildId, null);
    await saveBuildPatch(charId, c, { photo: null, photoOriginal: null, photoZoom: 1, photoX: 0, photoY: 0 });
    showNotif('Photo supprimée.', 'success');
    charSession.renderSheet(c, charSession.getCurrentCharTab() || 'combat');
  } catch (e) {
    showNotif(e?.message || 'Erreur de sauvegarde.', 'error');
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

document.addEventListener('dragover', (e) => {
  const target = e.target.closest?.('[data-character-photo-drop]');
  if (!target || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  target.classList.add('is-dragover');
});

document.addEventListener('dragleave', (e) => {
  const target = e.target.closest?.('[data-character-photo-drop]');
  if (target && !target.contains(e.relatedTarget)) target.classList.remove('is-dragover');
});

document.addEventListener('drop', (e) => {
  const target = e.target.closest?.('[data-character-photo-drop]');
  if (!target) return;
  e.preventDefault();
  target.classList.remove('is-dragover');
  openDroppedCharacterPhoto(e.dataTransfer?.files?.[0], target.dataset.characterPhotoDrop);
});
