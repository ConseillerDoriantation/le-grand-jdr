import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

function openPhotoCropper(charId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      showCropperModal(ev.target?.result, charId);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function showCropperModal(dataUrl, charId) {
  openModal('📷 Photo du personnage', `
    <div style="text-align:center;margin-bottom:1rem">
      <img id="crop-preview" src="${dataUrl}" style="max-width:100%;max-height:320px;border-radius:10px;border:1px solid var(--border)">
    </div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button class="btn btn-outline" onclick="closeModal()">Annuler</button>
      <button class="btn btn-gold" onclick="saveCroppedPhoto('${charId}')">Enregistrer</button>
    </div>
  `);
  window._cropperState = { dataUrl };
}

async function saveCroppedPhoto(charId) {
  const dataUrl = window._cropperState?.dataUrl;
  if (!dataUrl) return;
  const current = STATE.characters.find((entry) => entry.id === charId) || STATE.activeChar;
  if (!current) return;
  current.photo = dataUrl;
  await updateInCol('characters', charId, { photo: dataUrl });
  closeModal();
  showNotif('Photo enregistrée.', 'success');
  window.renderCharSheet?.(current, window._currentCharTab || 'carac');
}

async function deleteCharPhoto(charId) {
  if (!confirm('Supprimer la photo ?')) return;
  const current = STATE.characters.find((entry) => entry.id === charId) || STATE.activeChar;
  if (!current) return;
  delete current.photo;
  await updateInCol('characters', charId, { photo: null });
  showNotif('Photo supprimée.', 'success');
  window.renderCharSheet?.(current, window._currentCharTab || 'carac');
}

Object.assign(window, { openPhotoCropper, saveCroppedPhoto, deleteCharPhoto });
