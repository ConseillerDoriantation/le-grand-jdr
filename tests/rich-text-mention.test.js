import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRichTextMentionLabel,
  richTextMentionText,
} from '../assets/js/shared/rich-text-mention.js';

test('une mention conserve un seul @ après plusieurs réouvertures Quill', () => {
  assert.equal(normalizeRichTextMentionLabel('@Personnage'), 'Personnage');
  assert.equal(normalizeRichTextMentionLabel('@@@@Personnage'), 'Personnage');
  assert.equal(normalizeRichTextMentionLabel('\uFEFF@\uFEFF@@Personnage\uFEFF'), 'Personnage');
  assert.equal(richTextMentionText('@@@@Personnage'), '@Personnage');
  assert.equal(richTextMentionText(richTextMentionText('Personnage')), '@Personnage');
});

test('éditeur et sanitiseur partagent la même normalisation canonique', async () => {
  const [editor, sanitizer] = await Promise.all([
    readFile(new URL('../assets/js/shared/rich-text-quill.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/js/shared/rich-text.js', import.meta.url), 'utf8'),
  ]);
  assert.match(editor, /label: normalizeRichTextMentionLabel\(n\.textContent\)/);
  assert.match(sanitizer, /querySelectorAll\('\.rt-mention'\)[\s\S]*richTextMentionText\(label\)/);
});
