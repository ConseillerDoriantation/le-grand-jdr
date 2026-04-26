// ══════════════════════════════════════════════
// autocomplete.js — Dropdown d'autocomplete réutilisable
// Compatible tous navigateurs (desktop + mobile).
//
// Single-value :
//   import { autocompleteHTML, initAutocomplete } from '../shared/autocomplete.js';
//   html += `<div class="form-group">
//     <label>Type</label>
//     ${autocompleteHTML({ id:'my-field', value, placeholder:'...' })}
//   </div>`;
//   initAutocomplete('my-field', ['Épée','Lance','Dague']);
//
// Multi-tags (chips) :
//   import { multiAutocompleteHTML, initMultiAutocomplete, getMultiAutocompleteValues } from '../shared/autocomplete.js';
//   html += `<div class="form-group">
//     <label>Tags</label>
//     ${multiAutocompleteHTML({ id:'tags', placeholder:'Ajouter…' })}
//   </div>`;
//   initMultiAutocomplete('tags', ['A','B','C'], { initialValues: ['B'] });
//   // Au save : getMultiAutocompleteValues('tags') → string[]
//
// Le wrapper interne est en position:relative — pas besoin de l'ajouter au caller.
// ══════════════════════════════════════════════
import { _esc } from './html.js';

const HIGHLIGHT_BG = 'rgba(232,184,75,.2)';
const DROPDOWN_STYLE = 'display:none;position:absolute;top:100%;left:0;right:0;z-index:50;'
  + 'background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;'
  + 'max-height:200px;overflow-y:auto;margin-top:4px;box-shadow:0 4px 16px rgba(0,0,0,.35)';
const ITEM_STYLE = 'padding:.5rem .75rem;cursor:pointer;font-size:.85rem;color:var(--text)';
const _lower = (v) => String(v).toLowerCase();
const _normalize = (arr) => [...new Set((arr || []).filter(Boolean).map(String))];

// Styles statiques injectés une fois pour le focus-within du multi (mimique
// .input-field:focus tel qu'overridé par darkforge-overrides.css).
if (typeof document !== 'undefined' && !document.getElementById('ac-multi-styles')) {
  const style = document.createElement('style');
  style.id = 'ac-multi-styles';
  style.textContent = `
    .ac-multi:focus-within {
      border-color: rgba(232,184,75,0.40) !important;
      background: rgba(232,184,75,0.05) !important;
      box-shadow: 0 0 0 3px rgba(232,184,75,0.08) !important;
    }
    .ac-chip-x:hover { opacity: 1 !important; }
  `;
  document.head.appendChild(style);
}

// ── Single-value ─────────────────────────────────────────────────────────────

export function autocompleteHTML({ id, name, value = '', placeholder = '', className = 'input-field' }) {
  const nameAttr = name ? ` name="${_esc(name)}"` : '';
  return `
    <div id="${id}-wrap" style="position:relative">
      <input type="text" class="${className}" id="${id}"${nameAttr} value="${_esc(value)}"
        placeholder="${_esc(placeholder)}" autocomplete="off">
      <div id="${id}-ac" class="ac-list" style="${DROPDOWN_STYLE}"></div>
    </div>`;
}

export function initAutocomplete(id, options = [], { onSelect } = {}) {
  const input = document.getElementById(id);
  const list  = document.getElementById(`${id}-ac`);
  if (!input || !list) return;

  const opts = _normalize(options).sort();

  const { hide } = _attachDropdown({
    input, list,
    getOptions: () => {
      const q = _lower(input.value).trim();
      return opts.filter(o => _lower(o).includes(q));
    },
    onPick: (val) => {
      input.value = val;
      hide();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      onSelect?.(val);
    },
  });
}

// ── Multi-tags ───────────────────────────────────────────────────────────────

export function multiAutocompleteHTML({ id, placeholder = '' }) {
  const safeId = _esc(id);
  return `
    <div id="${safeId}-wrap" class="ac-multi" style="display:flex;flex-wrap:wrap;
      align-items:center;gap:.35rem;padding:.55rem .7rem;width:100%;
      color:var(--text);font-family:'Inter',sans-serif;
      background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);
      border-radius:14px;transition:all .18s ease;
      min-height:calc(0.92rem + 1.64rem + 2px);cursor:text;position:relative">
      <span id="${safeId}-chips" style="display:contents"></span>
      <input type="text" id="${safeId}" placeholder="${_esc(placeholder)}" autocomplete="off"
        style="flex:1;min-width:140px;background:transparent;border:none;outline:none;
        color:var(--text);font-family:inherit;font-size:.92rem;padding:.1rem 0">
      <div id="${safeId}-ac" class="ac-list" style="${DROPDOWN_STYLE}"></div>
    </div>`;
}

export function initMultiAutocomplete(id, options = [], { initialValues = [], onChange, freeText = true } = {}) {
  const wrap    = document.getElementById(`${id}-wrap`);
  const input   = document.getElementById(id);
  const list    = document.getElementById(`${id}-ac`);
  const chipsEl = document.getElementById(`${id}-chips`);
  if (!wrap || !input || !list || !chipsEl) return null;

  let selected = _normalize(initialValues);
  const opts   = _normalize(options).sort();

  const renderChips = () => { chipsEl.innerHTML = selected.map(_chipHtml).join(''); };
  const fireChange  = () => onChange?.([...selected]);

  // add/remove sont référencés par le dropdown via closure — déclarés en `let`
  // pour que les callbacks puissent les invoquer une fois assignés ci-dessous.
  let add, remove;

  const { hide } = _attachDropdown({
    input, list,
    getOptions: () => {
      const q   = _lower(input.value).trim();
      const sel = new Set(selected.map(_lower));
      return opts.filter(o => !sel.has(_lower(o)) && (!q || _lower(o).includes(q)));
    },
    onPick: (val) => add(val),
    onKeydown: (e) => {
      if (e.key === 'Backspace' && !input.value && selected.length) {
        e.preventDefault();
        remove(selected[selected.length - 1]);
        return true;
      }
      return false;
    },
    freeTextEnter: freeText,
  });

  add = (val) => {
    const v = String(val).trim();
    input.value = '';
    hide();
    if (!v || selected.some(s => _lower(s) === _lower(v))) return;
    selected.push(v);
    renderChips();
    fireChange();
  };
  remove = (val) => {
    const before = selected.length;
    selected = selected.filter(s => _lower(s) !== _lower(val));
    if (selected.length !== before) { renderChips(); fireChange(); }
  };

  renderChips();

  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap || e.target === chipsEl) {
      e.preventDefault();
      input.focus();
    }
  });
  chipsEl.addEventListener('mousedown', (e) => {
    const x = e.target.closest('.ac-chip-x');
    if (!x) return;
    e.preventDefault();
    remove(x.dataset.val);
    input.focus();
  });

  return {
    getValues: () => [...selected],
    setValues: (vals) => {
      selected = _normalize(vals);
      renderChips();
      fireChange();
    },
    add,
    remove,
  };
}

// Lecture des valeurs sans avoir à conserver le handle d'init —
// pratique pour les flux save existants qui lisent le DOM.
export function getMultiAutocompleteValues(id) {
  const chipsEl = document.getElementById(`${id}-chips`);
  if (!chipsEl) return [];
  return Array.from(chipsEl.querySelectorAll('.ac-chip[data-val]')).map(el => el.dataset.val);
}

// ── Internes partagés ────────────────────────────────────────────────────────

function _itemHtml(value) {
  const safe = _esc(value);
  return `<div class="ac-item" data-val="${safe}" style="${ITEM_STYLE}">${safe}</div>`;
}

function _chipHtml(value) {
  const safe = _esc(value);
  return `<span class="ac-chip" data-val="${safe}"
    style="display:inline-flex;align-items:center;gap:.15rem;padding:2px 4px 2px 10px;
    background:var(--gold-glow);border:1px solid var(--border-bright);
    color:var(--gold);border-radius:999px;font-size:.8rem;line-height:1.4;
    font-weight:500">${safe}<button
    type="button" class="ac-chip-x" data-val="${safe}"
    style="background:none;border:none;color:inherit;cursor:pointer;font-size:1rem;
    line-height:1;padding:0 5px;opacity:.6;transition:opacity .12s"
    title="Retirer">×</button></span>`;
}

// Mécanique commune single + multi : rendu du dropdown, navigation clavier,
// sélection souris/clavier, masquage au blur.
// `onKeydown(e)` est optionnel et peut renvoyer true pour consommer l'événement
// avant la logique standard (utilisé par le multi pour Backspace = retirer dernier chip).
function _attachDropdown({ input, list, getOptions, onPick, onKeydown, freeTextEnter = false }) {
  let active = -1;

  const hide = () => { list.style.display = 'none'; active = -1; };
  const highlight = () => {
    [...list.children].forEach((el, i) => {
      el.style.background = i === active ? HIGHLIGHT_BG : '';
    });
  };
  const render = () => {
    const filtered = getOptions();
    if (!filtered.length) { hide(); return; }
    active = -1;
    list.innerHTML = filtered.map(_itemHtml).join('');
    list.style.display = 'block';
  };

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (onKeydown?.(e) === true) return;
    const items = list.children;
    const open  = list.style.display !== 'none' && items.length > 0;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      highlight();
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (open && active >= 0) {
        e.preventDefault();
        onPick(items[active].dataset.val);
      } else if (freeTextEnter && input.value.trim()) {
        e.preventDefault();
        onPick(input.value);
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const it = e.target.closest('.ac-item');
    if (!it) return;
    e.preventDefault();
    onPick(it.dataset.val);
  });
  list.addEventListener('mouseover', (e) => {
    const it = e.target.closest('.ac-item');
    if (!it) return;
    active = [...list.children].indexOf(it);
    highlight();
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));

  return { hide, render };
}
