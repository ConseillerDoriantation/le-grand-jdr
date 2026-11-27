import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from '../assets/js/shared/typing-target.js';

// Élément minimal : closest() remonte la chaîne de parents, isContentEditable hérité.
function el(tag, { parent = null, role = '', editable = false } = {}) {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), parentElement: parent, role, editable };
  node.isContentEditable = editable || !!parent?.isContentEditable;
  node.closest = sel => {
    const tags = sel.split(',').map(s => s.trim());
    for (let n = node; n; n = n.parentElement) {
      if (tags.includes(n.tagName.toLowerCase()) || (n.role === 'textbox' && tags.includes('[role="textbox"]'))) return n;
    }
    return null;
  };
  return node;
}

test('champs natifs = saisie', () => {
  for (const tag of ['input', 'textarea', 'select']) assert.equal(isTypingTarget(el(tag)), true, tag);
});

test('contenteditable (messagerie, éditeurs riches) = saisie, y compris un enfant', () => {
  const composer = el('div', { editable: true });
  assert.equal(isTypingTarget(composer), true);
  assert.equal(isTypingTarget(el('span', { parent: composer })), true);
  assert.equal(isTypingTarget(el('div', { role: 'textbox' })), true);
});

test('nœud texte : on remonte à son élément', () => {
  const composer = el('div', { editable: true });
  assert.equal(isTypingTarget({ nodeType: 3, parentElement: composer }), true);
});

test('page, bouton ou cible absente ≠ saisie', () => {
  assert.equal(isTypingTarget(el('div')), false);
  assert.equal(isTypingTarget(el('button')), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});
