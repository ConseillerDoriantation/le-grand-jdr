import test from 'node:test';
import assert from 'node:assert/strict';

global.document ??= { addEventListener() {} };

const { normalizeFreePage } = await import('../assets/js/shared/free-page.js');

function deck(format) {
  return {
    version: 2,
    format,
    slides: [{
      id: 'slide-1',
      page: {
        version: 1,
        width: 1000,
        height: 650,
        blocks: [{
          id: 'text-1', type: 'text', x: 50, y: 50, w: 300, h: 100, z: 1,
          fontSize: 18, content: '',
        }],
      },
    }],
  };
}

test('changer le format agrandit la toile sans redimensionner ses éléments', () => {
  const normalized = normalizeFreePage(deck({ preset: 'landscape', width: 1600, height: 900 }));
  const page = normalized.slides[0].page;
  const block = page.blocks[0];

  assert.deepEqual({ width: page.width, height: page.height }, { width: 1600, height: 900 });
  assert.deepEqual(
    { x: block.x, y: block.y, width: block.w, height: block.h, fontSize: block.fontSize },
    { x: 50, y: 50, width: 300, height: 100, fontSize: 18 },
  );
});

test('revenir au format classique conserve exactement les tailles', () => {
  const landscape = normalizeFreePage(deck({ preset: 'landscape', width: 1600, height: 900 }));
  const classic = normalizeFreePage({ ...landscape, format: { preset: 'default', width: 1000, height: 650 } });
  const block = classic.slides[0].page.blocks[0];

  assert.deepEqual(
    { width: block.w, height: block.h, fontSize: block.fontSize },
    { width: 300, height: 100, fontSize: 18 },
  );
});
