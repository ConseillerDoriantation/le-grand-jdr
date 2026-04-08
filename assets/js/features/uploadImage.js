// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD-IMAGE.JS — Re-export de compatibilité
// Les fonctions previewUploadPng et previewUploadJpeg sont désormais dans
// shared/image-upload.js. Ce fichier maintient la compatibilité avec l'existant.
// ══════════════════════════════════════════════════════════════════════════════
export { uploadPng as previewUploadPng, uploadJpeg as previewUploadJpeg } from '../shared/image-upload.js';
