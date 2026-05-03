// ══════════════════════════════════════════════════════════════════════════════
// Modal "Paramètres de la carte" — upload/crop de l'image de fond + nom région.
// Réutilise les helpers `shared/image-crop.js` (comme l'ancien map.js).
// ══════════════════════════════════════════════════════════════════════════════

import { openModal, closeModalDirect } from '../../../shared/modal.js';
import { showNotif } from '../../../shared/notifications.js';
import { loadMap, saveMap } from '../data/maps.repo.js';
import { attachDropAndCrop } from '../../../shared/image-crop.js';

let _mapCropper = null;

export async function openMapSettingsModal(onSaved) {
  const doc = await loadMap();
  _mapCropper?.destroy(); _mapCropper = null;

  openModal('⚙️ Paramètres de la carte', `
    <div class="form-group">
      <label>Nom de la région</label>
      <input class="input-field" id="map-region-name" value="${doc?.regionName || ''}" placeholder="La Région des Brumes">
    </div>

    <div class="form-group">
      <label>URL d'image <span class="map-dim map-small">(recommandé — qualité maximale)</span></label>
      <input class="input-field" id="map-image-url" type="url" autocomplete="off"
             value="${doc?.imageUrl && doc.imageUrl.startsWith('http') ? doc.imageUrl : ''}"
             placeholder="https://i.imgur.com/ton-image.jpg">
      <p class="map-dim map-small" style="margin:.35rem 0 0">
        Héberge ta carte sur Imgur, GitHub, Cloudinary… et colle le lien direct.
        Qualité intacte, chargement plus rapide.
      </p>
    </div>

    <div class="form-group">
      <label>Ou importer un fichier <span class="map-dim map-small">(compressé automatiquement pour Firestore)</span></label>
      <div id="map-drop-zone" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated);transition:border-color .15s">
        <div id="map-drop-preview"></div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px">
          JPG · PNG · WebP — max ~1400px, compressé à 900 KB pour tenir dans Firestore
        </div>
      </div>

      <div id="map-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">
          Recadrez si nécessaire — ratio libre
        </div>
        <canvas id="map-crop-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" id="map-crop-confirm" style="margin-top:.5rem;width:100%">
          ✂️ Confirmer et compresser
        </button>
        <div id="map-crop-ok" style="display:none;font-size:.75rem;text-align:center;margin-top:4px"></div>
      </div>
    </div>

    <div class="map-form__actions">
      <button type="button" class="btn btn-outline" id="map-settings-cancel">Annuler</button>
      <button type="button" class="btn btn-gold" id="map-settings-save">Enregistrer</button>
    </div>
  `);

  // Cible 900 KB (proche de la limite Firestore 1 MB) pour maximiser la
  // qualité quand le MJ choisit l'upload plutôt que l'URL distante.
  _mapCropper = attachDropAndCrop({
    dropEl:        document.getElementById('map-drop-zone'),
    previewEl:     document.getElementById('map-drop-preview'),
    cropWrapEl:    document.getElementById('map-crop-wrap'),
    canvasId:      'map-crop-canvas',
    statusEl:      document.getElementById('map-crop-ok'),
    confirmBtnEl:  document.getElementById('map-crop-confirm'),
    initialUrl:    doc?.imageUrl && !doc.imageUrl.startsWith('http') ? doc.imageUrl : '',
    output:        { target: 900_000 },
  });

  document.getElementById('map-settings-cancel')?.addEventListener('click', () => {
    closeModalDirect();
  });

  document.getElementById('map-settings-save')?.addEventListener('click', async () => {
    const regionName = document.getElementById('map-region-name')?.value?.trim() || '';
    const urlValue = document.getElementById('map-image-url')?.value?.trim() || '';
    const cropped = _mapCropper?.getResult();

    // Priorité 1 : URL explicite (qualité maximale).
    // Priorité 2 : fichier uploadé fraîchement (compressé).
    // Sinon : on ne touche pas à imageUrl (merge Firestore conserve l'existant).
    const payload = { regionName };
    if (urlValue) payload.imageUrl = urlValue;
    else if (typeof cropped === 'string') payload.imageUrl = cropped;

    try {
      await saveMap(payload);
      showNotif('Carte mise à jour.', 'success');
      _mapCropper?.destroy(); _mapCropper = null;
      closeModalDirect();
      if (typeof onSaved === 'function') await onSaved();
    } catch (e) {
      console.error('[map.settings] save', e);
      showNotif('Erreur de sauvegarde.', 'error');
    }
  });
}
