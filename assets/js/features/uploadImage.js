// ── Calcule les nouvelles dimensions en conservant le ratio ──────────────────
function resizeDimensions(w, h, max = 400) {
  if (w <= max && h <= max) return { w, h };
  if (w > h) return { w: max, h: Math.round(h * max / w) };
  return { w: Math.round(w * max / h), h: max };
}

// ── Dessine l'image sur un canvas et retourne le base64 ──────────────────────
function imageToBase64(img, w, h, format = 'image/png', quality = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(format, quality);
}

// ── Stocke le base64 dans l'input hidden ─────────────────────────────────────
function setHiddenValue(hiddenId, value) {
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = value;
}

// ── Affiche la preview de l'image ────────────────────────────────────────────
function renderPreview(previewId, b64) {
  const preview = document.getElementById(previewId);
  if (preview) preview.innerHTML = `<img src="${b64}" style="max-height:80px;margin-top:0.4rem;display:block">`;
}

// ── Vérifie le poids et notifie ──────────────────────────────────────────────
function notifyImageSize(b64, maxKb = 700) {
  const kb = Math.round(b64.length * 3 / 4 / 1024);
  if (kb > maxKb) showNotif(`⚠️ Image encore lourde (${kb}KB).`, 'error');
  else showNotif(`✅ Image prête (${kb}KB)`, 'success');
}

// ── Lecture du fichier (commun) ───────────────────────────────────────────────
function readImageFile(fileInputId, onLoad) {
  const file = document.getElementById(fileInputId)?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => onLoad(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Upload PNG — transparence conservée (ex: cartes) ─────────────────────────
function previewUploadPng(fileInputId, previewId, hiddenId) {
  readImageFile(fileInputId, img => {
    const { w, h } = resizeDimensions(img.width, img.height);
    const b64 = imageToBase64(img, w, h, 'image/png');
    setHiddenValue(hiddenId, b64);
    renderPreview(previewId, b64);
    notifyImageSize(b64, 1500);
  });
}

// ── Upload JPEG — compressé, plus léger (ex: avatars, bannières) ──────────────
function previewUploadJpeg(fileInputId, previewId, hiddenId) {
  readImageFile(fileInputId, img => {
    const { w, h } = resizeDimensions(img.width, img.height);
    const b64 = imageToBase64(img, w, h, 'image/jpeg', 0.72);
    setHiddenValue(hiddenId, b64);
    renderPreview(previewId, b64);
    notifyImageSize(b64, 700);
  });
}

Object.assign(window, { previewUploadPng, previewUploadJpeg });