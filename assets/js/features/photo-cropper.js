import { updateInCol } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { showNotif } from '../shared/notifications.js';

export async function openPhotoCropper(charId) {
  const url = prompt('Colle l'URL de l'image du personnage :', STATE.activeChar?.photo || '');
  if (!url) return;
  await updateInCol('characters', charId, { photo: url, photoZoom: 1, photoX: 0, photoY: 0 });
  if (STATE.activeChar?.id === charId) STATE.activeChar.photo = url;
  showNotif('Photo mise à jour.', 'success');
  window.navigate?.('characters');
}

export async function deleteCharPhoto(charId) {
  if (!confirm('Supprimer la photo ?')) return;
  await updateInCol('characters', charId, { photo: '', photoZoom: 1, photoX: 0, photoY: 0 });
  if (STATE.activeChar?.id === charId) STATE.activeChar.photo = '';
  showNotif('Photo supprimée.', 'success');
  window.navigate?.('characters');
}

Object.assign(window, { openPhotoCropper, deleteCharPhoto });
