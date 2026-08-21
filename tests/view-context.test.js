import test from 'node:test';
import assert from 'node:assert/strict';

import { captureViewContext, restoreViewContext } from '../assets/js/shared/view-context.js';

function fakeField({
  id = '', name = '', tagName = 'INPUT', type = 'text', value = '', checked = false,
  multiple = false, options = [], contentEditable = false, html = '',
} = {}) {
  return {
    id,
    dataset: {},
    tagName,
    type,
    value,
    checked,
    indeterminate: false,
    multiple,
    options,
    isContentEditable: contentEditable,
    innerHTML: html,
    getAttribute(attr) { return attr === 'name' ? name || null : null; },
  };
}

function fakeRoot(fields) {
  return {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select, [contenteditable="true"]') return fields;
      return [];
    },
  };
}

test('le contexte de modale conserve tous les types de champs éditables', () => {
  const text = fakeField({ id: 'si-nom', value: 'Brouillon' });
  const hidden = fakeField({ id: 'si-img-b64', type: 'hidden', value: 'data:image/test' });
  const check = fakeField({ id: 'si-consommable', type: 'checkbox', checked: true });
  const select = fakeField({ id: 'si-template', tagName: 'SELECT', value: 'arme' });
  const multi = fakeField({
    id: 'si-tags', tagName: 'SELECT', multiple: true,
    options: [{ value: 'a', selected: true }, { value: 'b', selected: false }],
  });
  const rich = fakeField({ id: 'si-description', tagName: 'DIV', contentEditable: true, html: '<b>Texte</b>' });
  const root = fakeRoot([text, hidden, check, select, multi, rich]);
  const context = captureViewContext(root, { includeFields: true });

  text.value = '';
  hidden.value = '';
  check.checked = false;
  select.value = 'libre';
  multi.options[0].selected = false;
  multi.options[1].selected = true;
  rich.innerHTML = '';

  restoreViewContext(root, context, { includeFields: true });

  assert.equal(text.value, 'Brouillon');
  assert.equal(hidden.value, 'data:image/test');
  assert.equal(check.checked, true);
  assert.equal(select.value, 'arme');
  assert.deepEqual(multi.options.map(option => option.selected), [true, false]);
  assert.equal(rich.innerHTML, '<b>Texte</b>');
});

test('les valeurs ne sont pas capturées hors d’un empilement de modales', () => {
  const text = fakeField({ id: 'field', value: 'Avant' });
  const root = fakeRoot([text]);
  const context = captureViewContext(root);
  text.value = 'Après';
  restoreViewContext(root, context);
  assert.equal(text.value, 'Après');
});
