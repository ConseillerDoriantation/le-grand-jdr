import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');

test('l’image d’un article passe par le cadreur partagé en ratio 4:3', () => {
  assert.match(source, /import \{ panZoomCropHTML, attachPanZoomCrop \} from '\.\.\/shared\/image-crop\.js'/);
  const start = source.indexOf('function _siOpenImageCropper');
  const end = source.indexOf('\nfunction previewUpload', start);
  const block = source.slice(start, end);
  assert.match(block, /panZoomCropHTML\(\{ idPrefix: 'si-image-crop', viewW: 320, viewH: 240 \}\)/);
  assert.match(block, /attachPanZoomCrop\(\{[\s\S]*outputW: 640, outputH: 480,[\s\S]*constrainCover: true/);
});

test('le cadreur se superpose à l’éditeur sans perdre son brouillon', () => {
  const start = source.indexOf('function _siOpenImageCropper');
  const end = source.indexOf('\nfunction previewUpload', start);
  const block = source.slice(start, end);
  assert.match(block, /_siReadDraftFromDom\(\)/);
  assert.match(block, /pushModal\('Cadrer l’image'/);
  assert.match(block, /onDismiss: _siDestroyImageCropper/);
  assert.match(source, /popModal\(\);\s*_siApplyCroppedImage/);
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

test('l’ancien redimensionnement direct sans choix de cadrage a disparu', () => {
  const start = source.indexOf('function previewUpload');
  const end = source.indexOf('\nasync function saveShopItem', start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /drawImage\(/);
  assert.doesNotMatch(block, /toDataURL\(/);
  assert.match(block, /_siOpenImageCropper\(reader\.result, previewId, hiddenId\)/);
});
