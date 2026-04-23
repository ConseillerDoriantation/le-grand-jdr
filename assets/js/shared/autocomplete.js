// ══════════════════════════════════════════════
// autocomplete.js — Dropdown d'autocomplete réutilisable
// Compatible tous navigateurs (desktop + mobile).
//
// Usage :
//   import { autocompleteHTML, initAutocomplete } from '../shared/autocomplete.js';
//
//   // 1) Rendu — placer dans un conteneur en position:relative
//   html += `<div class="form-group" style="position:relative">
//     <label>Type</label>
//     ${autocompleteHTML({ id:'my-field', value, placeholder:'...' })}
//   </div>`;
//
//   // 2) Après insertion dans le DOM
//   initAutocomplete('my-field', ['Épée','Lance','Dague']);
// ══════════════════════════════════════════════
import { _esc } from './html.js';

export function autocompleteHTML({ id, name, value = '', placeholder = '', className = 'input-field' }) {
  const nameAttr = name ? ` name="${_esc(name)}"` : '';
  return `
    <input type="text" class="${className}" id="${id}"${nameAttr} value="${_esc(value)}"
      placeholder="${_esc(placeholder)}" autocomplete="off">
    <div id="${id}-ac" class="ac-list"
      style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;
      background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;
      max-height:200px;overflow-y:auto;margin-top:2px;box-shadow:0 4px 16px rgba(0,0,0,.35)"></div>`;
}

export function initAutocomplete(id, options = [], { onSelect } = {}) {
  const input = document.getElementById(id);
  const list  = document.getElementById(`${id}-ac`);
  if (!input || !list) return;

  const opts = [...new Set((options || []).filter(Boolean).map(String))].sort();
  let active = -1;

  const render = () => {
    const q = input.value.toLowerCase().trim();
    const filtered = opts.filter(o => o.toLowerCase().includes(q));
    if (!filtered.length) { hide(); return; }
    active = -1;
    list.innerHTML = filtered.map(o =>
      `<div class="ac-item" data-val="${_esc(o)}"
        style="padding:.5rem .75rem;cursor:pointer;font-size:.85rem;color:var(--text)"
        >${_esc(o)}</div>`).join('');
    list.style.display = 'block';
  };
  const hide = () => { list.style.display = 'none'; active = -1; };
  const highlight = () => {
    [...list.children].forEach((el, i) => {
      el.style.background = i === active ? 'rgba(232,184,75,.2)' : '';
    });
  };
  const pick = (val) => {
    input.value = val;
    hide();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    onSelect?.(val);
  };

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (list.style.display === 'none' || !list.children.length) return;
    const items = list.children;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      highlight();
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(items[active].dataset.val);
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const it = e.target.closest('.ac-item');
    if (!it) return;
    e.preventDefault();
    pick(it.dataset.val);
  });
  list.addEventListener('mouseover', (e) => {
    const it = e.target.closest('.ac-item');
    if (!it) return;
    active = [...list.children].indexOf(it);
    highlight();
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
}
