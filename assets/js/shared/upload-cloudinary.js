// ══════════════════════════════════════════════════════════════════════
// UPLOAD CLOUDINARY — module partagé
// ─────────────────────────────────────────────────────────────────────
// Remplace l'ancien upload ImgBB pour tous les uploads "média" de l'app
// (photos persos, galerie fiche, émotes VTT, fonds de carte VTT).
//
// Stockage gratuit pérenne (25 GB + 25 GB BW/mois) ; ne purge pas comme ImgBB.
// Pas de carte bancaire requise pour le free tier.
//
// Configuration : 2 valeurs en localStorage (saisies par l'admin une fois) :
//   cloudinary-cloud-name      — ex: "le-grand-jdr"
//   cloudinary-upload-preset   — preset UNSIGNED (Console → Settings → Upload)
//
// Les URLs ImgBB déjà stockées en Firestore restent fonctionnelles : on ne
// touche que le point d'upload, pas les données existantes.
// ══════════════════════════════════════════════════════════════════════

const LS_CLOUD  = 'cloudinary-cloud-name';
const LS_PRESET = 'cloudinary-upload-preset';

export function getCloudinaryConfig() {
  return {
    cloudName:    localStorage.getItem(LS_CLOUD)  || '',
    uploadPreset: localStorage.getItem(LS_PRESET) || '',
  };
}

export function hasCloudinaryConfig() {
  const { cloudName, uploadPreset } = getCloudinaryConfig();
  return !!(cloudName && uploadPreset);
}

export function setCloudinaryConfig({ cloudName, uploadPreset }) {
  if (cloudName)    localStorage.setItem(LS_CLOUD,  cloudName.trim());
  else              localStorage.removeItem(LS_CLOUD);
  if (uploadPreset) localStorage.setItem(LS_PRESET, uploadPreset.trim());
  else              localStorage.removeItem(LS_PRESET);
}

/**
 * Prompt l'utilisateur pour saisir/modifier la config Cloudinary.
 * Retourne true si la config est désormais complète, false sinon.
 */
export function promptCloudinaryConfig() {
  const cur = getCloudinaryConfig();
  const cn = prompt(
    'Cloudinary — Cloud name\n(Console Cloudinary → Dashboard, en haut)',
    cur.cloudName,
  );
  if (cn == null) return hasCloudinaryConfig();
  const up = prompt(
    'Cloudinary — Upload preset (UNSIGNED)\n(Settings → Upload → Upload presets → "Add preset" en mode Unsigned)',
    cur.uploadPreset,
  );
  if (up == null) return hasCloudinaryConfig();
  setCloudinaryConfig({ cloudName: cn.trim(), uploadPreset: up.trim() });
  return hasCloudinaryConfig();
}

/**
 * Upload un File (ou dataURL base64) vers Cloudinary.
 * Renvoie { url, publicId, thumbUrl, width, height, bytes }.
 *
 * Options :
 *   folder   — sous-dossier Cloudinary (ex: 'emotes', 'maps', 'characters')
 *   tags     — array de tags pour retrouver/lister facilement
 *   publicId — id forcé (sinon Cloudinary génère un id aléatoire)
 */
export async function uploadCloudinary(fileOrDataUrl, { folder, tags, publicId } = {}) {
  const { cloudName, uploadPreset } = getCloudinaryConfig();
  if (!cloudName || !uploadPreset) {
    throw new Error('Configuration Cloudinary manquante — clic 🔑 pour la saisir.');
  }
  const fd = new FormData();
  fd.append('file', fileOrDataUrl); // accepte File OU dataURL base64
  fd.append('upload_preset', uploadPreset);
  if (folder)        fd.append('folder', folder);
  if (tags?.length)  fd.append('tags', tags.join(','));
  if (publicId)      fd.append('public_id', publicId);

  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: fd },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) {
    throw new Error(json.error?.message || `Upload Cloudinary échoué (${resp.status})`);
  }
  return {
    url:      json.secure_url,
    publicId: json.public_id,
    thumbUrl: buildThumbUrl(cloudName, json.public_id, 320),
    width:    json.width,
    height:   json.height,
    bytes:    json.bytes,
  };
}

/**
 * Génère une URL transformée à la volée (resize + webp + qualité auto).
 * Gratuit, calculé côté Cloudinary, mis en cache CDN.
 *
 * Exemple : buildThumbUrl('le-grand-jdr', 'characters/abc123', 200)
 *  → https://res.cloudinary.com/le-grand-jdr/image/upload/c_fill,w_200,h_200,f_auto,q_auto/characters/abc123
 */
export function buildThumbUrl(cloudName, publicId, size = 320) {
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_${size},h_${size},f_auto,q_auto/${publicId}`;
}

// ──────────────────────────────────────────────────────────────────────
// MODALE de configuration — UX propre (remplace les prompts natifs)
// Utilise le système .sh-admin-modal commun (chargé via shop.css global).
// ──────────────────────────────────────────────────────────────────────

import { openModal, closeModalDirect } from './modal.js';
import { showNotif } from './notifications.js';

const CLOUDINARY_CONSOLE_URL = 'https://console.cloudinary.com/';
const CLOUDINARY_PRESETS_URL = 'https://console.cloudinary.com/settings/upload';

export function openCloudinaryConfigModal() {
  const { cloudName, uploadPreset } = getCloudinaryConfig();
  const isConfigured = !!(cloudName && uploadPreset);

  openModal('', `
   <div class="sh-admin-modal is-cloudinary">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">🖼️</div>
      <div class="sh-admin-head-title">
        <h2>Configuration Cloudinary</h2>
        <small>Hébergement des images de l'app (illustrations, émotes, fonds de carte…)</small>
      </div>
      <button class="sh-admin-close" onclick="closeModalDirect()" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">
      <p class="sh-admin-intro">
        Les images uploadées via l'app sont stockées sur ton compte Cloudinary.
        <b>25 Go gratuits, pérennes</b>, sans carte bancaire. La config reste sur
        ce navigateur (localStorage).
        ${isConfigured
          ? '<br><em>✓ Actuellement configuré.</em>'
          : '<br><em>⚠ Pas encore configuré — les uploads échoueront tant que ces 2 champs sont vides.</em>'}
      </p>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🔑 Identifiants</div>
        <div class="sh-admin-row">
          <div class="sh-admin-row-line">
            <label class="sh-admin-row-lbl" for="cl-cloud-name">Cloud name</label>
            <input id="cl-cloud-name" type="text" class="sh-admin-row-input" style="width:200px;text-align:left"
              placeholder="ex : dvk7jqouy" value="${_esc(cloudName)}" autocomplete="off">
          </div>
          <div class="sh-admin-section-hint" style="margin-top:6px">
            Visible en haut à gauche du dashboard Cloudinary.
          </div>
        </div>
        <div class="sh-admin-row">
          <div class="sh-admin-row-line">
            <label class="sh-admin-row-lbl" for="cl-upload-preset">Upload preset</label>
            <input id="cl-upload-preset" type="text" class="sh-admin-row-input" style="width:200px;text-align:left"
              placeholder="ex : le-grand-jdr" value="${_esc(uploadPreset)}" autocomplete="off">
          </div>
          <div class="sh-admin-section-hint" style="margin-top:6px">
            Le nom du preset <b>Unsigned</b> que tu as créé dans Settings → Upload.
          </div>
        </div>
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">💡 Aide</div>
        <ol style="margin:0;padding-left:20px;font-size:.78rem;color:var(--text-soft);line-height:1.55">
          <li>Crée un compte gratuit sur
            <a href="${CLOUDINARY_CONSOLE_URL}" target="_blank" rel="noopener" style="color:var(--admin-accent)">cloudinary.com</a></li>
          <li>Note le <b>Cloud name</b> en haut à gauche du dashboard</li>
          <li>Va dans
            <a href="${CLOUDINARY_PRESETS_URL}" target="_blank" rel="noopener" style="color:var(--admin-accent)">Settings → Upload presets</a>
            → <b>Add upload preset</b></li>
          <li>Passe le <b>Signing Mode sur "Unsigned"</b> ⚠ (obligatoire)</li>
          <li>Donne-lui un nom (ex : <code>le-grand-jdr</code>), sauvegarde</li>
          <li>Colle les 2 valeurs ci-dessus, puis Enregistrer</li>
        </ol>
      </div>
    </div>

    <div class="sh-admin-footer">
      ${isConfigured
        ? '<button class="btn btn-outline btn-sm" id="cl-reset" style="color:var(--crimson-light,#ff8ca7);border-color:rgba(255,90,126,.3)">↺ Réinitialiser</button>'
        : ''}
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-outline btn-sm" onclick="closeModalDirect()">Annuler</button>
      <button class="btn btn-gold btn-sm" id="cl-save">💾 Enregistrer</button>
    </div>
   </div>
  `);

  // Binding des actions (préfère addEventListener à du onclick inline pour la sécurité)
  setTimeout(() => {
    document.getElementById('cl-save')?.addEventListener('click', () => {
      const cn = document.getElementById('cl-cloud-name')?.value.trim() || '';
      const up = document.getElementById('cl-upload-preset')?.value.trim() || '';
      if (!cn || !up) {
        showNotif('Renseigne les 2 champs (ou utilise Réinitialiser pour effacer).', 'error');
        return;
      }
      setCloudinaryConfig({ cloudName: cn, uploadPreset: up });
      closeModalDirect();
      showNotif('Configuration Cloudinary enregistrée ✓', 'success');
    });
    document.getElementById('cl-reset')?.addEventListener('click', () => {
      setCloudinaryConfig({ cloudName: '', uploadPreset: '' });
      closeModalDirect();
      showNotif('Configuration Cloudinary effacée', 'info');
    });
    document.getElementById('cl-cloud-name')?.focus();
  }, 30);
}

// Escape minimal pour les attributs HTML (évite injection si une valeur contient des quotes).
function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[c]);
}

// Exposition window pour appels depuis attributs inline / délégation
