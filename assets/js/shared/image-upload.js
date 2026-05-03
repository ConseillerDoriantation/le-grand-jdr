// ══════════════════════════════════════════════════════════════════════════════
// SHARED / IMAGE-UPLOAD.JS — Upload d'image
//
// Helpers purs :
//   readImageFileAsDataUrl / createImageFileInput / bindImageUploadDropZone
//      → sélection ou drop d'image, sans logique de crop.
//
// Usage upload pur :
//   bindImageUploadDropZone(dropEl, { onImage: ({ dataUrl }) => ... });
// Le crop canvas historique vit dans shared/image-crop.js.
// ══════════════════════════════════════════════════════════════════════════════

// ── Upload pur ───────────────────────────────────────────────────────────────

export function readImageFileAsDataUrl(file) {
  if (!file?.type?.startsWith('image/')) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error || new Error('Lecture image impossible.'));
    reader.readAsDataURL(file);
  });
}

export function createImageFileInput({ onImage = null, accept = 'image/*' } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.cssText = 'position:absolute;opacity:0;width:0;height:0';
  document.body.appendChild(input);

  const handleChange = async () => {
    const file = input.files?.[0];
    const dataUrl = await readImageFileAsDataUrl(file);
    input.value = '';
    if (dataUrl) onImage?.({ file, dataUrl });
  };

  input.addEventListener('change', handleChange);
  return {
    input,
    open: () => input.click(),
    destroy: () => {
      input.removeEventListener('change', handleChange);
      input.remove();
    },
  };
}

export function pickImageFile({ onImage = null, accept = 'image/*' } = {}) {
  let picker = null;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    picker?.destroy();
  };

  picker = createImageFileInput({
    accept,
    onImage: (payload) => {
      cleanup();
      onImage?.(payload);
    },
  });
  picker.input.addEventListener('cancel', cleanup, { once: true });
  picker.open();
  return { destroy: cleanup };
}

export function bindImageUploadDropZone(dropEl, {
  onImage = null,
  accept = 'image/*',
  activeBorderColor = 'var(--gold)',
  idleBorderColor = 'var(--border-strong)',
} = {}) {
  if (!dropEl) return { destroy: () => {} };

  const picker = createImageFileInput({ accept, onImage });
  const handleDropFile = async (file) => {
    const dataUrl = await readImageFileAsDataUrl(file);
    if (dataUrl) onImage?.({ file, dataUrl });
  };
  const onClick = () => picker.open();
  const onDragover = (e) => { e.preventDefault(); dropEl.style.borderColor = activeBorderColor; };
  const onDragleave = () => { dropEl.style.borderColor = idleBorderColor; };
  const onDrop = (e) => {
    e.preventDefault();
    dropEl.style.borderColor = idleBorderColor;
    handleDropFile(e.dataTransfer.files[0]);
  };

  dropEl.addEventListener('click', onClick);
  dropEl.addEventListener('dragover', onDragover);
  dropEl.addEventListener('dragleave', onDragleave);
  dropEl.addEventListener('drop', onDrop);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    dropEl.removeEventListener('click', onClick);
    dropEl.removeEventListener('dragover', onDragover);
    dropEl.removeEventListener('dragleave', onDragleave);
    dropEl.removeEventListener('drop', onDrop);
    picker.destroy();
    obs.disconnect();
  };

  const obs = new MutationObserver(() => {
    if (!document.body.contains(dropEl)) destroy();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return { destroy };
}

// ── Utilitaire : simple upload JPEG/PNG sans crop (uploadImage.js) ────────────

function _resizeDimensions(w, h, max = 400) {
  if (w <= max && h <= max) return { w, h };
  if (w > h) return { w: max, h: Math.round(h * max / w) };
  return { w: Math.round(w * max / h), h: max };
}

function _imageToBase64(img, w, h, format = 'image/jpeg', quality = 0.72) {
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(format, quality);
}

/**
 * Lit un fichier image et appelle onLoad(img).
 */
export async function readImageFile(file, onLoad) {
  const dataUrl = await readImageFileAsDataUrl(file);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => onLoad(img);
  img.src = dataUrl;
}

/**
 * Upload simple avec compression JPEG (pour avatars, bannières).
 * @param {File} file
 * @param {{ previewId, hiddenId, max, quality }} opts
 * @returns {string} base64
 */
export function uploadJpeg(file, { previewId = null, hiddenId = null, max = 400, quality = 0.72 } = {}) {
  return new Promise(resolve => {
    readImageFile(file, img => {
      const { w, h } = _resizeDimensions(img.width, img.height, max);
      const b64 = _imageToBase64(img, w, h, 'image/jpeg', quality);
      if (hiddenId)  { const el = document.getElementById(hiddenId);  if (el) el.value = b64; }
      if (previewId) { const el = document.getElementById(previewId); if (el) el.innerHTML = `<img src="${b64}" style="max-height:80px;margin-top:.4rem;display:block;border-radius:6px">`; }
      resolve(b64);
    });
  });
}

/**
 * Upload simple avec PNG (transparence conservée, pour cartes/icônes).
 */
export function uploadPng(file, { previewId = null, hiddenId = null, max = 400 } = {}) {
  return new Promise(resolve => {
    readImageFile(file, img => {
      const { w, h } = _resizeDimensions(img.width, img.height, max);
      const b64 = _imageToBase64(img, w, h, 'image/png', 1);
      if (hiddenId)  { const el = document.getElementById(hiddenId);  if (el) el.value = b64; }
      if (previewId) { const el = document.getElementById(previewId); if (el) el.innerHTML = `<img src="${b64}" style="max-height:80px;margin-top:.4rem;display:block;border-radius:6px">`; }
      resolve(b64);
    });
  });
}

// ── Exposition globale (pour compatibilité avec les anciens appels window) ────
// Chaque feature expose ses propres wrappers window ; ceux-ci sont les fallbacks.
Object.assign(window, { previewUploadPng: (fi, pi, hi) => { const f = document.getElementById(fi)?.files?.[0]; if (f) uploadPng(f, { previewId: pi, hiddenId: hi }); }, previewUploadJpeg: (fi, pi, hi) => { const f = document.getElementById(fi)?.files?.[0]; if (f) uploadJpeg(f, { previewId: pi, hiddenId: hi }); }, });
