import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/shop.css', import.meta.url), 'utf8');
const sharedCrop = readFileSync(new URL('../assets/js/shared/image-crop.js', import.meta.url), 'utf8');

test('l’image d’un article passe par le cadreur partagé en ratio 4:3', () => {
  assert.match(source, /import \{ panZoomCropHTML, attachPanZoomCrop \} from '\.\.\/shared\/image-crop\.js'/);
  const start = source.indexOf('function _siOpenImageCropper');
  const end = source.indexOf('\nasync function previewUpload', start);
  const block = source.slice(start, end);
  assert.match(block, /const cropH = Math\.round\(cropW \* 0\.75\)/);
  assert.match(block, /panZoomCropHTML\(\{ idPrefix: 'si-image-crop', viewW: cropW, viewH: cropH, hint: false \}\)/);
  assert.match(block, /attachPanZoomCrop\(\{[\s\S]*viewW: cropW, viewH: cropH, outputW: 640, outputH: 480,[\s\S]*constrainCover: false,[\s\S]*initialFit: 'contain'/);
});

test('le cadreur se superpose à l’éditeur sans perdre son brouillon', () => {
  const start = source.indexOf('function _siOpenImageCropper');
  const end = source.indexOf('\nfunction previewUpload', start);
  const block = source.slice(start, end);
  assert.match(block, /_siReadDraftFromDom\(\)/);
  assert.match(block, /pushModal\('Cadrer l’image'/);
  assert.match(block, /onDismiss: _siDestroyImageCropper/);
  assert.match(source, /popModal\(\);\s*_siApplyCroppedImage/);
  assert.match(css, /modal:has\(> #modal-body > \.si-editor\)/);
  assert.match(css, /modal:has\(> #modal-body > \.si-image-crop-dialog\)/);
  assert.doesNotMatch(css, /modal:has\(\.si-editor\)/);
});

test('le chargement active la validation uniquement quand l’image est décodée', () => {
  const start = source.indexOf('function _siOpenImageCropper');
  const end = source.indexOf('\nasync function previewUpload', start);
  const block = source.slice(start, end);
  assert.match(block, /id="si-image-crop-save" disabled/);
  assert.match(block, /onReady: \(\{ width, height \}\) =>/);
  assert.match(block, /saveBtn\.disabled = false/);
  assert.match(block, /onError: \(\) =>/);
  assert.match(sharedCrop, /onReady = null/);
  assert.match(sharedCrop, /img\.onerror = \(\) =>/);
});

test('le cadreur permet de voir l’image entière ou de remplir le cadre', () => {
  assert.match(source, /id="si-image-crop-contain">Image entière/);
  assert.match(source, /id="si-image-crop-cover">Remplir le cadre/);
  assert.match(source, /_siImageCropper\?\.fitContain\?\.\(\)/);
  assert.match(source, /_siImageCropper\?\.fitCover\?\.\(\)/);
  assert.match(sharedCrop, /fitContain\(\) \{ return fitTo\('contain'\); \}/);
  assert.match(sharedCrop, /fitCover\(\) \{ return fitTo\('cover'\); \}/);
});

test('l’image cadrée est compressée puis réinjectée dans le champ et l’aperçu', () => {
  const start = source.indexOf('async function _siSaveCroppedImage');
  const end = source.indexOf('\nfunction _siOpenImageCropper', start);
  const block = source.slice(start, end);
  assert.match(block, /_siImageCropper\?\.getBase64\?\.\(\)/);
  assert.match(block, /compressDataUrl\(raw, \{[\s\S]*maxBytes: 120_000/);
  assert.match(source, /hidden\.value = b64/);
  assert.match(source, /_siEditorState\.draft\.image = b64/);
  assert.match(source, /_siRefreshLive\(\)/);
});

test('l’article enregistré remplace immédiatement sa copie locale avec la nouvelle image', () => {
  const start = source.indexOf('async function saveShopItem');
  const end = source.indexOf('\n/**\n * Après modification d’un article boutique', start);
  const block = source.slice(start, end);
  assert.match(block, /await updateInCol\('shop',itemId,data\)/);
  assert.match(block, /const persistedItem = itemId/);
  assert.match(block, /const localIndex = _items\.findIndex\(entry => entry\.id === savedItemId\)/);
  assert.match(block, /_items\[localIndex\] = persistedItem/);
  assert.match(block, /_items\.sort\(compareManualOrder\)/);
  assert.match(block, /const selectedImage = _siPendingImage !== undefined/);
  assert.match(block, /image:selectedImage/);
});

test('l’ancien redimensionnement direct sans choix de cadrage a disparu', () => {
  const start = source.indexOf('async function previewUpload');
  const end = source.indexOf('\nasync function saveShopItem', start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /drawImage\(/);
  assert.doesNotMatch(block, /toDataURL\(/);
  assert.match(block, /readImageFileAsDataUrl\(file\)/);
  assert.match(block, /_siOpenImageCropper\(dataUrl, previewId, hiddenId\)/);
});
