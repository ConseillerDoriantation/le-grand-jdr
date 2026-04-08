// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD-IMAGE.JS — Compatibilité window
// Importe depuis shared/image-upload.js et expose dans window pour les
// onchange HTML inline (ex: onchange="previewUploadPng(...)")
// ══════════════════════════════════════════════════════════════════════════════
import { uploadPng, uploadJpeg } from '../shared/image-upload.js';

// Wrappers window-friendly (prennent des IDs de champs, pas des File objects)
window.previewUploadPng = (fileInputId, previewId, hiddenId) => {
  const file = document.getElementById(fileInputId)?.files?.[0];
  if (file) uploadPng(file, { previewId, hiddenId });
};

window.previewUploadJpeg = (fileInputId, previewId, hiddenId) => {
  const file = document.getElementById(fileInputId)?.files?.[0];
  if (file) uploadJpeg(file, { previewId, hiddenId });
};
