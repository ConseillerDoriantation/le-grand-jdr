// ══════════════════════════════════════════════
// RICH-TEXT — coeur partagé des éditeurs contenteditable
// Briques publiques :
//   - rendu : richTextEditorHtml, richTextEditableHtml, richTextContentHtml,
//             richTextToolbarHtml, richTextColorPickerHtml,
//             richTextFontPickerHtml, richTextTextSizePickerHtml
//   - binding : bindRichTextEditors, bindRichTextEditorControls
//   - commandes/helpers : execRichTextCommand, getRichTextHtml, sanitizeRichTextHtml
// ══════════════════════════════════════════════

import { _esc } from './html.js';

const COLORS = [
  { name: 'Défaut', value: 'initial' },
  { name: 'Or',     value: '#e2b96f' },
  { name: 'Rouge',  value: '#ce3333' },
  { name: 'Vert',   value: '#22c38e' },
  { name: 'Bleu',   value: '#6aa7ff' },
  { name: 'Violet', value: '#c084fc' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Jaune',  value: '#facc15' },
  { name: 'Rose',   value: '#f472b6' }
];

const HIGHLIGHTS = [
  { name: 'Jaune',  value: 'rgba(250,204,21,.32)' },
  { name: 'Orange', value: 'rgba(251,146,60,.30)' },
  { name: 'Rouge',  value: 'rgba(239,68,68,.28)' },
  { name: 'Vert',   value: 'rgba(34,195,142,.28)' },
  { name: 'Bleu',   value: 'rgba(79,140,255,.28)' },
  { name: 'Violet', value: 'rgba(192,132,252,.28)' },
  { name: 'Rose',   value: 'rgba(244,114,182,.28)' },
  { name: 'Gris',   value: 'rgba(148,163,184,.28)' },
];

const FONTS = [
  { name: 'Défaut',  value: 'inherit' },
  { name: 'Outfit',  value: "'Outfit', sans-serif" },
  { name: 'Cinzel',  value: "'Cinzel', serif" },
  { name: 'Georgia', value: "Georgia, serif" },
  { name: 'Courier', value: "'Courier New', monospace" },
];

const TEXT_SIZES = [
  { name: 'Défaut', value: '1em', label: 'Taille' },
  { name: 'Petit',  value: '.85em', label: 'Petit' },
  { name: 'Normal', value: '1em', label: 'Normal' },
  { name: 'Grand',  value: '1.2em', label: 'Grand' },
  { name: 'Très grand', value: '1.45em', label: 'Très grand' },
];

const DEFAULT_FONT_SENTINEL = 'rte-default-font';
const DEFAULT_COMMAND_ATTR = 'data-rte-cmd';
const POPUP_OFFSET = 4;
const BLOCK_COMMAND_TAGS = {
  blockquote: 'blockquote',
  h2: 'h2',
  h3: 'h3',
};
const RICH_TEXT_TABLE_INLINE_COMMANDS = new Set([
  'bold', 'italic', 'underline', 'strikeThrough', 'removeFormat',
]);
const RICH_TEXT_COMMAND_META = {
  bold: { title: 'Gras', html: '<b>G</b>', stateful: true },
  italic: { title: 'Italique', html: '<i>I</i>', stateful: true },
  underline: { title: 'Souligné', html: '<u>S</u>', stateful: true },
  strikeThrough: { title: 'Barré', html: '<s>B</s>', stateful: true },
  insertUnorderedList: { title: 'Liste à puces', html: '•', stateful: true },
  insertOrderedList: { title: 'Liste numérotée', html: '1.', stateful: true },
  blockquote: { title: 'Citation', html: '❝', stateful: true },
  h2: { title: 'Titre H2', html: 'H2', stateful: true },
  h3: { title: 'Titre H3', html: 'H3', stateful: true },
  insertTable: { title: 'Insérer un tableau', html: '▦', stateful: false },
  insertHorizontalRule: { title: 'Séparateur horizontal', html: '—', stateful: false },
  removeFormat: { title: 'Effacer la mise en forme', html: '⊘', stateful: false },
};
const DEFAULT_RICH_TEXT_TOOLBAR_GROUPS = [
  ['bold', 'italic', 'underline', 'strikeThrough'],
  ['insertUnorderedList', 'insertOrderedList', 'blockquote', 'insertTable', 'insertHorizontalRule'],
  ['removeFormat'],
];
export const RICH_TEXT_COMMANDS = new Set([
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'insertUnorderedList',
  'insertOrderedList',
  'blockquote',
  'h2',
  'h3',
  'insertTable',
  'insertHorizontalRule',
  'removeFormat',
]);
export const RICH_TEXT_STATEFUL_COMMANDS = new Set([
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'insertUnorderedList',
  'insertOrderedList',
  'blockquote',
  'h2',
  'h3',
]);

// ── Rendu HTML ───────────────────────────────────────────────────────────────

export function richTextCommandToolbarHtml({
  editorId = '',
  groups = DEFAULT_RICH_TEXT_TOOLBAR_GROUPS,
  commandAttr = DEFAULT_COMMAND_ATTR,
  buttonClass = 'rte-btn',
  groupClass = '',
  separatorClass = 'rte-sep',
  commandMeta = {},
} = {}) {
  const meta = { ...RICH_TEXT_COMMAND_META, ...commandMeta };
  return groups.map((group) => richTextToolbarGroupHtml(group, {
    editorId,
    commandAttr,
    buttonClass,
    groupClass,
    meta,
  })).join(
    separatorClass ? `<span class="${_esc(separatorClass)}"></span>` : ''
  );
}

export const richTextToolbarHtml = richTextCommandToolbarHtml;

export function richTextColorPickerHtml({
  id,
  buttonClass = 'rte-btn',
} = {}) {
  const safeId = _esc(id);
  const swatches = COLORS.map(c => {
    const isDefault = c.value === 'initial';
    const cls = `rte-color-swatch${isDefault ? ' rte-color-swatch--default' : ''}`;
    const style = isDefault ? '' : ` style="background:${c.value}"`;
    return `<button type="button" class="${cls}" data-rte-color="${c.value}" title="${c.name}"${style}></button>`;
  }).join('');
  return `
    <div class="rte-color">
      <button type="button" class="${_esc(buttonClass)} rte-color-toggle" title="Couleur du texte" aria-label="Couleur du texte">
        <span class="rte-color-letter">A</span>
        <span class="rte-color-bar"></span>
        <span class="rte-color-caret">▾</span>
      </button>
      <div class="rte-color-pop" data-rte-pop="${safeId}">${swatches}</div>
    </div>
  `;
}

export function richTextHighlightPickerHtml({
  id,
  buttonClass = 'rte-btn',
} = {}) {
  const swatches = HIGHLIGHTS.map((highlight) =>
    `<button type="button" class="rte-highlight-swatch" data-rte-highlight="${_esc(highlight.value)}" title="${_esc(highlight.name)}" aria-label="Surligner en ${_esc(highlight.name.toLowerCase())}" style="background:${_esc(highlight.value)}"></button>`
  ).join('');
  return `
    <div class="rte-highlight">
      <button type="button" class="${_esc(buttonClass)} rte-highlight-toggle" title="Surlignage" aria-label="Surlignage">
        <span class="rte-highlight-letter">A</span>
        <span class="rte-highlight-bar"></span>
        <span class="rte-color-caret">▾</span>
      </button>
      <div class="rte-highlight-pop" data-rte-pop="${_esc(id)}">
        <button type="button" class="rte-highlight-none" data-rte-highlight="initial">× Aucun surlignage</button>
        <div class="rte-highlight-grid">${swatches}</div>
      </div>
    </div>`;
}

export function richTextEditableHtml({
  id,
  html = '',
  placeholder = '',
  className = 'rte-editor input-field',
  minHeight = null,
  attrs = {},
  sanitize = true,
} = {}) {
  const safeHtml = sanitize ? sanitizeRichTextHtml(html || '') : String(html || '');
  const attrHtml = attrsHtml({
    id,
    class: className,
    contenteditable: 'true',
    'data-placeholder': placeholder,
    ...attrs,
  });
  const style = minHeight == null ? '' : ` style="min-height:${Number(minHeight) || 200}px"`;
  return `<div ${attrHtml}${style}>${safeHtml}</div>`;
}

// Rendu read-only d'un contenu RTE : <div class="rte-content [extra]">…</div>.
// Sanitise par défaut, injecte un fallback si vide, et accepte des attrs additionnels.
export function richTextContentHtml({
  html = '',
  className = '',
  fallback = '',
  attrs = {},
  sanitize = true,
} = {}) {
  const safe = sanitize ? sanitizeRichTextHtml(html || '') : String(html || '');
  const content = safe || fallback;
  const cls = ['rte-content', className].filter(Boolean).join(' ');
  const attrHtml = attrsHtml({ class: cls, ...attrs });
  return `<div ${attrHtml}>${content}</div>`;
}

export function richTextEditorHtml({ id, html = '', placeholder = '', minHeight = 200 }) {
  const safeId = _esc(id);
  const safeMinHeight = Number(minHeight) || 200;
  const safeHtml = sanitizeRichTextHtml(html || '');
  return `
    <div class="rte" data-rte-id="${safeId}">
      <div class="rte-toolbar" id="${safeId}-toolbar">
        ${richTextCommandToolbarHtml({ groups: DEFAULT_RICH_TEXT_TOOLBAR_GROUPS.slice(0, 2) })}
        <span class="rte-sep"></span>
        ${richTextCommandToolbarHtml({ editorId: id, groups: [[{ type: 'color' }]], separatorClass: '' })}
        ${richTextHighlightPickerHtml({ id })}
        ${richTextFontPickerHtml({ id })}
        ${richTextTextSizePickerHtml({ id })}
        <span class="rte-sep"></span>
        ${richTextCommandToolbarHtml({ groups: [['removeFormat']], separatorClass: '' })}
      </div>
      ${richTextEditableHtml({
        id,
        html: safeHtml,
        placeholder,
        minHeight: safeMinHeight,
        sanitize: false,
      })}
    </div>
  `;
}

function richTextToolbarGroupHtml(group, { editorId, commandAttr, buttonClass, groupClass, meta }) {
  const html = group.map((entry) => richTextToolbarEntryHtml(entry, {
    editorId,
    commandAttr,
    buttonClass,
    meta,
  })).join('');
  return groupClass ? `<div class="${_esc(groupClass)}">${html}</div>` : html;
}

function richTextToolbarEntryHtml(entry, { editorId, commandAttr, buttonClass, meta }) {
  const spec = typeof entry === 'string' ? { cmd: entry } : (entry || {});
  if (spec.rawHtml) return spec.rawHtml;
  if (spec.type === 'color') {
    return richTextColorPickerHtml({
      id: spec.editorId || editorId,
      buttonClass: spec.buttonClass || buttonClass,
    });
  }
  if (spec.type === 'highlight') {
    return richTextHighlightPickerHtml({
      id: spec.editorId || editorId,
      buttonClass: spec.buttonClass || buttonClass,
    });
  }
  if (spec.type === 'font') {
    return richTextFontPickerHtml({
      id: spec.editorId || editorId,
      buttonClass: spec.buttonClass || buttonClass,
    });
  }
  if (spec.type === 'size') {
    return richTextTextSizePickerHtml({
      id: spec.editorId || editorId,
      buttonClass: spec.buttonClass || buttonClass,
    });
  }

  const cfg = { ...(meta[spec.cmd] || {}), ...spec };
  const isTablePicker = cfg.cmd === 'insertTable';
  const attrs = attrsHtml({
    type: 'button',
    class: [buttonClass, cfg.className].filter(Boolean).join(' '),
    [commandAttr]: isTablePicker ? null : cfg.cmd,
    'data-rte-table-toggle': isTablePicker ? editorId : null,
    title: cfg.title || null,
    'aria-label': cfg.title || null,
    'aria-pressed': cfg.stateful === false ? null : 'false',
  });

  return `<button ${attrs}>${cfg.html || _esc(cfg.label || cfg.cmd)}</button>`;
}

export function richTextFontPickerHtml({
  id,
  buttonClass = 'rte-btn',
} = {}) {
  const fontItems = FONTS.map((font) =>
    `<button type="button" class="rte-font-item" data-rte-font="${_esc(font.value)}" style="font-family:${_esc(font.value)}">${_esc(font.name)}</button>`
  ).join('');

  return `
    <div class="rte-font">
      <button type="button" class="${_esc(buttonClass)} rte-font-toggle" title="Police d'écriture" aria-label="Police d'écriture">
        <span>Aa</span>
        <span class="rte-color-caret">▾</span>
      </button>
      <div class="rte-font-pop" data-rte-pop="${_esc(id)}">${fontItems}</div>
    </div>
  `;
}

export function richTextTextSizePickerHtml({
  id,
  buttonClass = 'rte-btn',
} = {}) {
  const sizeItems = TEXT_SIZES.map((size) =>
    `<button type="button" class="rte-size-item" data-rte-size="${_esc(size.value)}" style="font-size:${_esc(size.value)}">${_esc(size.name)}</button>`
  ).join('');

  return `
    <div class="rte-size">
      <button type="button" class="${_esc(buttonClass)} rte-size-toggle" title="Taille du texte" aria-label="Taille du texte">
        <span>Tt</span>
        <span class="rte-color-caret">▾</span>
      </button>
      <div class="rte-size-pop" data-rte-pop="${_esc(id)}">${sizeItems}</div>
    </div>
  `;
}

function attrsHtml(attrs) {
  return Object.entries(attrs)
    .map(([name, value]) => {
      if (value === false || value === null || value === undefined) return '';
      if (value === true) return _esc(name);
      return `${_esc(name)}="${_esc(value)}"`;
    })
    .filter(Boolean)
    .join(' ');
}

// ── Popups et sélection ──────────────────────────────────────────────────────

function toggleRichTextPopup(pop, anchor) {
  if (!pop) return;
  if (!pop.classList.contains('show')) {
    const rect = anchor.getBoundingClientRect();
    pop.style.top  = `${rect.bottom + POPUP_OFFSET}px`;
    pop.style.left = `${rect.left}px`;
  }
  pop.classList.toggle('show');
}

function closeRichTextPopups(root, editorId = null, { remove = false } = {}) {
  const popups = [
    ...Array.from(root?.querySelectorAll?.('.rte-color-pop, .rte-highlight-pop, .rte-font-pop, .rte-size-pop') || []),
    ...detachedRichTextPopups(editorId),
  ];

  new Set(popups).forEach((pop) => {
    pop.classList.remove('show');
    if (remove) pop.remove();
  });
}

function detachRichTextPopup(pop) {
  if (!pop) return null;
  if (pop.parentNode !== document.body) document.body.appendChild(pop);
  return pop;
}

function cleanupDetachedPopups(editorId) {
  detachedRichTextPopups(editorId).forEach((pop) => pop.remove());
}

function removeDuplicateDetachedPopups(pop) {
  const id = pop?.dataset?.rtePop;
  if (!id) return;
  const popupClass = richTextPopupClass(pop);
  if (!popupClass) return;
  detachedRichTextPopups(id).forEach((other) => {
    if (other !== pop && other.classList.contains(popupClass)) other.remove();
  });
}

function richTextPopupClass(pop) {
  if (pop.classList.contains('rte-color-pop')) return 'rte-color-pop';
  if (pop.classList.contains('rte-highlight-pop')) return 'rte-highlight-pop';
  if (pop.classList.contains('rte-font-pop')) return 'rte-font-pop';
  if (pop.classList.contains('rte-size-pop')) return 'rte-size-pop';
  return '';
}

function detachedRichTextPopups(editorId = null) {
  const selector = editorId
    ? `body > [data-rte-pop="${CSS.escape(editorId)}"]`
    : 'body > .rte-color-pop, body > .rte-highlight-pop, body > .rte-font-pop, body > .rte-size-pop';
  return Array.from(document.querySelectorAll(selector));
}

function setDefaultParagraphSeparator() {
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {
    console.debug('[rte] defaultParagraphSeparator non supporté', e);
  }
}

function applyRichTextFont(editor, font) {
  const apply = () => {
    if (font === 'inherit') document.execCommand('fontName', false, DEFAULT_FONT_SENTINEL);
    else document.execCommand('fontName', false, font);
  };
  const grouped = applyRichTextToSelectedCells(editor, apply, 'formatFontName');
  if (!grouped) apply();
  if (font === 'inherit') clearDefaultFontMarkers(editor);
}

function applyRichTextTextSize(editor, size) {
  const apply = () => document.execCommand('fontSize', false, '7');
  const grouped = applyRichTextToSelectedCells(editor, apply, 'formatFontSize');
  if (!grouped) apply();
  normalizeFontSizeMarkers(editor, size);
}

function createRichTextSelectionMemory(editor) {
  let savedRange = null;

  const save = () => {
    const range = getSelectionRange();
    if (range && nodeBelongsToEditor(editor, range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
    }
  };

  const restore = () => {
    if (document.activeElement !== editor) editor.focus({ preventScroll: true });
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  };

  const bind = (signal) => {
    ['keyup', 'mouseup', 'focus', 'click'].forEach((type) => {
      editor.addEventListener(type, save, { signal });
    });
  };

  return { save, restore, bind };
}

// ── Binding des contrôles ────────────────────────────────────────────────────

export function bindRichTextColorPicker({
  editor,
  root,
  signal,
  colorPop = null,
  colorBar = null,
  selection = null,
  closePopups = null,
  syncToolbarState = null,
  onAfterColor = null,
  isConnected = null,
  onDisconnect = null,
} = {}) {
  if (!editor || !root) return;

  const pop = detachRichTextPopup(colorPop || root.querySelector('.rte-color-pop'));
  const bar = colorBar || root.querySelector('.rte-color-bar');
  if (!pop) return;

  removeDuplicateDetachedPopups(pop);

  const selectionMemory = selection || createRichTextSelectionMemory(editor);
  if (!selection) selectionMemory.bind(signal);

  root.addEventListener('mousedown', (e) => {
    const toggle = e.target.closest('.rte-color-toggle');
    if (!toggle || !root.contains(toggle)) return;
    selectionMemory.save();
    e.preventDefault();
    closePopups?.();
    toggleRichTextPopup(pop, toggle);
  }, { signal });

  pop.addEventListener('mousedown', (e) => {
    const swatch = e.target.closest('[data-rte-color]');
    if (!swatch) return;
    e.preventDefault();
    selectionMemory.restore();
    const color = swatch.dataset.rteColor;
    const applyColor = () => {
      if (color === 'initial') clearRichTextColor(editor);
      else document.execCommand('foreColor', false, color);
    };
    const grouped = applyRichTextToSelectedCells(editor, applyColor, 'formatForeColor');
    if (!grouped) {
      applyColor();
      colorSelectedLists(editor, color);
    }
    if (bar) bar.style.background = color === 'initial' ? '' : color;
    selectionMemory.save();
    syncToolbarState?.();
    onAfterColor?.(color);
  }, { signal });
  pop.addEventListener('click', (event) => {
    if (!event.target.closest('[data-rte-color]')) return;
    event.preventDefault();
    pop.classList.remove('show');
  }, { signal });

  document.addEventListener('mousedown', (e) => {
    if (isConnected && !isConnected()) {
      pop.remove();
      onDisconnect?.();
      return;
    }
    if (root.contains(e.target) || pop.contains(e.target)) return;
    pop.classList.remove('show');
  }, { signal });
}

export function bindRichTextHighlightPicker({
  editor,
  root,
  signal,
  selection = null,
  closePopups = null,
  syncToolbarState = null,
  onAfterHighlight = null,
  isConnected = null,
  onDisconnect = null,
} = {}) {
  if (!editor || !root) return;
  const pop = detachRichTextPopup(root.querySelector('.rte-highlight-pop'));
  const bar = root.querySelector('.rte-highlight-bar');
  if (!pop) return;
  removeDuplicateDetachedPopups(pop);

  const selectionMemory = selection || createRichTextSelectionMemory(editor);
  if (!selection) selectionMemory.bind(signal);

  root.addEventListener('mousedown', (event) => {
    const toggle = event.target.closest('.rte-highlight-toggle');
    if (!toggle || !root.contains(toggle)) return;
    selectionMemory.save();
    event.preventDefault();
    closePopups?.();
    toggleRichTextPopup(pop, toggle);
  }, { signal });

  pop.addEventListener('mousedown', (event) => {
    const swatch = event.target.closest('[data-rte-highlight]');
    if (!swatch) return;
    event.preventDefault();
    selectionMemory.restore();
    const color = swatch.dataset.rteHighlight;
    applyRichTextHighlight(editor, color);
    if (bar) bar.style.background = color === 'initial' ? '' : color;
    selectionMemory.save();
    syncToolbarState?.();
    onAfterHighlight?.(color);
  }, { signal });
  pop.addEventListener('click', (event) => {
    if (!event.target.closest('[data-rte-highlight]')) return;
    event.preventDefault();
    pop.classList.remove('show');
  }, { signal });

  document.addEventListener('mousedown', (event) => {
    if (isConnected && !isConnected()) {
      pop.remove();
      onDisconnect?.();
      return;
    }
    if (root.contains(event.target) || pop.contains(event.target)) return;
    pop.classList.remove('show');
  }, { signal });
}

export function bindRichTextToolbar(id) {
  const root = document.querySelector(`.rte[data-rte-id="${CSS.escape(id)}"]`);
  if (!root || root.dataset.rteBound === '1') return null;
  root.dataset.rteBound = '1';

  const editor   = document.getElementById(id);
  const toolbar  = document.getElementById(`${id}-toolbar`) || root.querySelector('.rte-toolbar');
  if (!editor || !toolbar) return null;

  cleanupDetachedPopups(id);
  setDefaultParagraphSeparator();

  const controls = bindRichTextEditorControls({
    editorId: id,
    toolbarId: toolbar.id,
    enableColor: true,
    enableHighlight: true,
    enableFont: true,
    enableSize: true,
  });

  bindRichTextListIndentation(editor, controls.signal);
  bindRichTextBlockquoteEscape(editor, controls.signal);
  controls.syncToolbarState();
  return controls;
}

// ── Toolbar complète avec police, couleur et indentation ─────────────────────

function bindRichTextFontPicker({
  root,
  toolbar,
  editor,
  signal,
  selection,
  syncToolbarState,
  editorId,
  onAfterFont = null,
}) {
  const fontPop = detachRichTextPopup(root.querySelector('.rte-font-pop'));
  if (!fontPop) return;

  removeDuplicateDetachedPopups(fontPop);

  toolbar.addEventListener('mousedown', (e) => {
    const fontToggle = e.target.closest('.rte-font-toggle');
    if (!fontToggle) return;
    selection.save();
    e.preventDefault();
    closeRichTextPopups(root, editorId);
    toggleRichTextPopup(fontPop, fontToggle);
  }, { signal });

  fontPop.addEventListener('mousedown', (e) => {
    const item = e.target.closest('[data-rte-font]');
    if (!item) return;
    e.preventDefault();

    const font = item.dataset.rteFont;
    selection.restore();
    applyRichTextFont(editor, font);
    selection.save();
    syncToolbarState?.();
    onAfterFont?.(font);
  }, { signal });
  fontPop.addEventListener('click', (event) => {
    if (!event.target.closest('[data-rte-font]')) return;
    event.preventDefault();
    fontPop.classList.remove('show');
  }, { signal });

  bindRichTextPopupOutsideClose({
    root,
    pop: fontPop,
    signal,
    isConnected: () => root.isConnected && toolbar.isConnected && editor.isConnected,
  });
}

function bindRichTextTextSizePicker({
  root,
  toolbar,
  editor,
  signal,
  selection,
  syncToolbarState,
  editorId,
  onAfterSize = null,
}) {
  const sizePop = detachRichTextPopup(root.querySelector('.rte-size-pop'));
  if (!sizePop) return;

  removeDuplicateDetachedPopups(sizePop);

  toolbar.addEventListener('mousedown', (e) => {
    const sizeToggle = e.target.closest('.rte-size-toggle');
    if (!sizeToggle) return;
    selection.save();
    e.preventDefault();
    closeRichTextPopups(root, editorId);
    toggleRichTextPopup(sizePop, sizeToggle);
  }, { signal });

  sizePop.addEventListener('mousedown', (e) => {
    const item = e.target.closest('[data-rte-size]');
    if (!item) return;
    e.preventDefault();

    const size = item.dataset.rteSize;
    selection.restore();
    applyRichTextTextSize(editor, size);
    selection.save();
    syncToolbarState?.();
    onAfterSize?.(size);
  }, { signal });
  sizePop.addEventListener('click', (event) => {
    if (!event.target.closest('[data-rte-size]')) return;
    event.preventDefault();
    sizePop.classList.remove('show');
  }, { signal });

  bindRichTextPopupOutsideClose({
    root,
    pop: sizePop,
    signal,
    isConnected: () => root.isConnected && toolbar.isConnected && editor.isConnected,
  });
}

function bindRichTextPopupOutsideClose({
  root,
  pop,
  signal,
  isConnected = null,
  onDisconnect = null,
}) {
  document.addEventListener('mousedown', (e) => {
    if (isConnected && !isConnected()) {
      pop.remove();
      onDisconnect?.();
      return;
    }
    if (root.contains(e.target) || pop.contains(e.target)) return;
    pop.classList.remove('show');
  }, { signal });
}

function bindRichTextListIndentation(editor, signal) {
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (elementFromNode(window.getSelection()?.anchorNode)?.closest?.('li')) {
      document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
    }
  }, { signal });
}

// Vrai si la citation n'a aucun contenu visible : ni image, ni texte une fois
// retirés les espaces ET les caractères de largeur nulle (U+200B..U+200D, U+FEFF)
// que d'anciens éditeurs/navigateurs laissaient — invisibles mais non retirés
// par .trim(), ce qui faisait persister la bordure des anciennes citations.
function _isEmptyBlockquote(bq) {
  if (!bq || bq.querySelector('img')) return false;
  return !(bq.textContent || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').length;
}

/**
 * Permet de SORTIR d'un blockquote vide :
 * - Backspace au début d'un blockquote vide → unwrap
 * - Enter sur une ligne vide à l'intérieur d'un blockquote → unwrap (comportement standard)
 */
function bindRichTextBlockquoteEscape(editor, signal) {
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Enter') return;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed) return;  // ignore les sélections étendues
    const node = sel.anchorNode;
    const bq = elementFromNode(node)?.closest?.('blockquote');
    if (!bq || !editor.contains(bq)) return;

    // Backspace au tout début du blockquote OU sur un blockquote vide → unwrap
    if (e.key === 'Backspace') {
      const isAtStart = sel.anchorOffset === 0 && _isFirstTextOfBlock(node, bq);
      if (isAtStart || _isEmptyBlockquote(bq)) {
        e.preventDefault();
        _unwrapBlock(bq, 'p');
        // Repositionne le curseur sur le 1er bloc résultant
        const newP = editor.querySelector('p') || editor;
        _placeCaretAtStart(newP);
      }
      return;
    }

    // Enter sur une ligne vide dans un blockquote → sort du blockquote
    if (e.key === 'Enter' && !e.shiftKey) {
      const block = elementFromNode(node)?.closest?.('p,div') || node;
      const text = (block.textContent || '').trim();
      if (!text) {
        e.preventDefault();
        // Retire le bloc vide, puis sort du blockquote en créant un <p> après
        block.remove?.();
        const newP = document.createElement('p');
        newP.appendChild(document.createElement('br'));
        bq.parentNode?.insertBefore(newP, bq.nextSibling);
        _placeCaretAtStart(newP);
        // Si le blockquote est maintenant vide, on le supprime aussi
        if (_isEmptyBlockquote(bq)) bq.remove();
      }
    }
  }, { signal });

  // Nettoyage après édition : une citation vidée (sélection supprimée, Couper,
  // touche Suppr, ancienne citation au contenu invisible…) laissait un
  // <blockquote> vide → bordure bleue orpheline. On retire toute citation vide :
  //  - sans curseur dedans → on l'enlève toujours (nettoie aussi les anciennes
  //    citances orphelines dès qu'on touche à la note) ;
  //  - avec le curseur dedans → seulement si ça vient d'une suppression, sinon
  //    c'est une citation fraîche qu'on s'apprête à remplir (on n'y touche pas).
  editor.addEventListener('input', (e) => {
    const isDelete = !!e.inputType && e.inputType.startsWith('delete');
    const empties = [...editor.querySelectorAll('blockquote')].filter(_isEmptyBlockquote);
    if (!empties.length) return;
    const sel = window.getSelection();
    const caretBq = sel?.anchorNode
      ? elementFromNode(sel.anchorNode)?.closest?.('blockquote')
      : null;
    let caretUnwrapped = false;
    empties.forEach((bq) => {
      if (bq === caretBq) {
        if (isDelete) { _unwrapBlock(bq, 'p'); caretUnwrapped = true; }
      } else {
        bq.remove();
      }
    });
    // Curseur dans la citation vidée → transformée en <p> : on y replace le curseur.
    if (caretUnwrapped) _placeCaretAtStart(editor.querySelector('p') || editor);
  }, { signal });
}

function _isFirstTextOfBlock(node, blockEl) {
  if (!node || !blockEl) return false;
  let cur = node;
  while (cur && cur !== blockEl) {
    if (cur.previousSibling) return false;
    cur = cur.parentNode;
  }
  return true;
}

function _placeCaretAtStart(el) {
  const sel = window.getSelection();
  if (!sel || !el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function bindRichTextPopupCleanup({
  root,
  editor,
  toolbar,
  editorId,
  signal,
  abort,
}) {
  document.addEventListener('mousedown', (e) => {
    if (!root.isConnected || !editor.isConnected || !toolbar.isConnected) {
      closeRichTextPopups(root, editorId, { remove: true });
      abort?.();
      return;
    }

    const popups = detachedRichTextPopups(editorId);
    if (root.contains(e.target) || popups.some((pop) => pop.contains(e.target))) return;
    popups.forEach((pop) => pop.classList.remove('show'));
  }, { signal });
}

export function bindRichTextEditors(root = document) {
  root.querySelectorAll('.rte[data-rte-id]').forEach((el) => bindRichTextToolbar(el.dataset.rteId));
}

export function bindRichTextToolbarState({
  editor,
  toolbar,
  commands,
  signal,
  commandAttr = DEFAULT_COMMAND_ATTR,
  onEditorSelectionChange = null,
  isConnected = null,
  onDisconnect = null,
} = {}) {
  const sync = () => updateRichTextToolbarState(editor, toolbar, { commands, commandAttr });
  const syncFromEditor = () => {
    onEditorSelectionChange?.();
    sync();
  };
  const handleDocumentSelection = () => {
    if (isConnected && !isConnected()) {
      onDisconnect?.();
      return;
    }
    sync();
  };

  if (!editor || !toolbar) return sync;

  ['keyup', 'mouseup', 'focus', 'click'].forEach((type) => {
    editor.addEventListener(type, syncFromEditor, { signal });
  });
  // Drag relâché en dehors de l'éditeur : fallback sur document.
  document.addEventListener('mouseup', syncFromEditor, { signal });
  document.addEventListener('selectionchange', handleDocumentSelection, { signal });

  sync();
  return sync;
}

export function bindRichTextCommandToolbar({
  editor,
  toolbar,
  signal,
  commandAttr = DEFAULT_COMMAND_ATTR,
  commands = RICH_TEXT_COMMANDS,
  statefulCommands = RICH_TEXT_STATEFUL_COMMANDS,
  onCommand = null,
  onAfterCommand = null,
  isConnected = null,
  onDisconnect = null,
} = {}) {
  const richTextCommands = toSet(commands);
  const syncToolbarState = bindRichTextToolbarState({
    editor,
    toolbar,
    signal,
    commands: statefulCommands,
    commandAttr,
    isConnected,
    onDisconnect,
  });

  if (!editor || !toolbar) return syncToolbarState;

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest(`[${commandAttr}]`);
    if (!btn || !toolbar.contains(btn)) return;
    e.preventDefault();

    const cmd = btn.getAttribute(commandAttr);
    editor.focus();

    let handled = false;
    if (richTextCommands.has(cmd)) {
      handled = RICH_TEXT_TABLE_INLINE_COMMANDS.has(cmd)
        && applyRichTextToSelectedCells(editor, () => document.execCommand(cmd, false, null));
      if (!handled) handled = execRichTextCommand(editor, cmd);
    } else {
      handled = onCommand?.({ cmd, editor, button: btn, event: e, syncToolbarState }) === true;
    }

    if (!handled) return;
    syncToolbarState();
    onAfterCommand?.({ cmd, editor, button: btn, event: e });
  }, { signal });

  return syncToolbarState;
}

export function bindRichTextToolbarControls({
  editor,
  toolbar,
  signal,
  commandAttr = DEFAULT_COMMAND_ATTR,
  commands = RICH_TEXT_COMMANDS,
  statefulCommands = RICH_TEXT_STATEFUL_COMMANDS,
  onCommand = null,
  onAfterCommand = null,
  enableColor = true,
  enableHighlight = true,
  colorRoot = toolbar,
  isConnected = null,
  onDisconnect = null,
  selection = null,
  closePopups = null,
} = {}) {
  const syncToolbarState = bindRichTextCommandToolbar({
    editor,
    toolbar,
    signal,
    commandAttr,
    commands,
    statefulCommands,
    onCommand,
    onAfterCommand,
    isConnected,
    onDisconnect,
  });

  if (enableColor) {
    bindRichTextColorPicker({
      editor,
      root: colorRoot,
      signal,
      selection,
      closePopups,
      syncToolbarState,
      onAfterColor: onAfterCommand,
      isConnected,
      onDisconnect,
    });
  }

  if (enableHighlight) {
    bindRichTextHighlightPicker({
      editor,
      root: colorRoot,
      signal,
      selection,
      closePopups,
      syncToolbarState,
      onAfterHighlight: onAfterCommand,
      isConnected,
      onDisconnect,
    });
  }

  return syncToolbarState;
}

export function bindRichTextEditorControls({
  editorId,
  toolbarId,
  root = document,
  commandAttr = DEFAULT_COMMAND_ATTR,
  commands = RICH_TEXT_COMMANDS,
  statefulCommands = RICH_TEXT_STATEFUL_COMMANDS,
  customCommands = {},
  onAfterCommand = null,
  enableColor = true,
  enableHighlight = true,
  enableFont = true,
  enableSize = true,
} = {}) {
  const editor = root.getElementById?.(editorId) || document.getElementById(editorId);
  const toolbar = root.getElementById?.(toolbarId) || document.getElementById(toolbarId);
  const ac = new AbortController();
  const { signal } = ac;

  if (!editor || !toolbar) {
    return { editor, toolbar, signal, abort: () => ac.abort(), syncToolbarState: () => {} };
  }

  const selection = createRichTextSelectionMemory(editor);
  selection.bind(signal);

  const runCustomCommand = ({ cmd, editor, button, event, syncToolbarState }) => {
    const fn = customCommands?.[cmd];
    if (!fn) return false;
    return fn({ editor, button, event, syncToolbarState }) === true;
  };

  const syncToolbarState = bindRichTextToolbarControls({
    editor,
    toolbar,
    signal,
    commandAttr,
    commands,
    statefulCommands,
    onCommand: runCustomCommand,
    onAfterCommand,
    enableColor,
    enableHighlight,
    selection,
    closePopups: () => closeRichTextPopups(toolbar),
    isConnected: () => toolbar.isConnected && editor.isConnected,
    onDisconnect: () => ac.abort(),
  });

  if (enableFont) {
    bindRichTextFontPicker({
      root: toolbar,
      toolbar,
      editor,
      signal,
      selection,
      syncToolbarState,
      editorId,
      onAfterFont: onAfterCommand,
    });
  }

  if (enableSize) {
    bindRichTextTextSizePicker({
      root: toolbar,
      toolbar,
      editor,
      signal,
      selection,
      syncToolbarState,
      editorId,
      onAfterSize: onAfterCommand,
    });
  }
  bindRichTextTableControls({
    editor,
    toolbar,
    signal,
    selection,
    editorId,
    onAfterCommand,
    syncToolbarState,
  });
  syncToolbarState();

  if (enableColor || enableHighlight || enableFont || enableSize) {
    bindRichTextPopupCleanup({
      root: toolbar,
      editor,
      toolbar,
      editorId,
      signal,
      abort: () => ac.abort(),
    });
  }

  return { editor, toolbar, signal, abort: () => ac.abort(), syncToolbarState };
}

// ── Commandes d'édition ──────────────────────────────────────────────────────

function updateRichTextToolbarState(editor, toolbar, {
  commands,
  commandAttr = DEFAULT_COMMAND_ATTR,
} = {}) {
  if (!editor || !toolbar) return;
  const statefulCommands = toSet(commands);
  const range = getSelectionRange();
  const hasEditorSelection = !!range && nodeBelongsToEditor(editor, range.commonAncestorContainer);

  updateRichTextColorButtonState(editor, toolbar, range, hasEditorSelection);
  updateRichTextHighlightButtonState(editor, toolbar, range, hasEditorSelection);
  toolbar.querySelectorAll(`[${commandAttr}]`).forEach((btn) => {
    const cmd = btn.getAttribute(commandAttr);
    if (!statefulCommands.has(cmd)) return;

    const active = hasEditorSelection ? isRichTextCommandActive(cmd, range) : false;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateRichTextHighlightButtonState(editor, toolbar, range, hasEditorSelection) {
  const bar = toolbar.querySelector('.rte-highlight-bar');
  if (!bar) return;
  const toggle = bar.closest('.rte-highlight-toggle');
  const color = hasEditorSelection ? getRichTextSelectionHighlight(editor, range) : '';
  if (color) {
    bar.style.background = color;
    toggle?.style.setProperty('--rte-current-highlight', color);
    toggle?.classList.add('rte-highlight-toggle--active');
    toggle?.setAttribute('title', 'Modifier ou retirer le surlignage');
  } else {
    bar.style.background = '';
    toggle?.style.removeProperty('--rte-current-highlight');
    toggle?.classList.remove('rte-highlight-toggle--active');
    toggle?.setAttribute('title', 'Surlignage');
  }
}

function updateRichTextColorButtonState(editor, toolbar, range, hasEditorSelection) {
  const bar = toolbar.querySelector('.rte-color-bar');
  if (!bar) return;

  const toggle = bar.closest('.rte-color-toggle');
  const color = hasEditorSelection ? getRichTextSelectionColor(editor, range) : '';
  if (color) {
    bar.style.background = color;
    toggle?.style.setProperty('--rte-current-color', color);
    toggle?.classList.add('rte-color-toggle--active');
    toggle?.setAttribute('title', `Couleur du texte (${color})`);
  } else {
    bar.style.background = '';
    toggle?.style.removeProperty('--rte-current-color');
    toggle?.classList.remove('rte-color-toggle--active');
    toggle?.setAttribute('title', 'Couleur du texte');
  }
}

function getRichTextSelectionColor(editor, range) {
  if (!range) return '';
  return (
    getRichTextNodeColor(editor, range.startContainer) ||
    getRichTextNodeColor(editor, range.endContainer) ||
    getRichTextNodeColor(editor, window.getSelection()?.anchorNode) ||
    ''
  );
}

// Ne renvoie que les couleurs explicitement appliquées par l'utilisateur :
// pas de fallback sur queryCommandValue / getComputedStyle, qui renverraient
// une couleur figée (ex. rgb du texte courant) ne suivant pas le thème.
function getRichTextNodeColor(editor, node) {
  let el = elementFromNode(node);
  while (el && el !== editor) {
    if (el.style?.color) return el.style.color;
    if (el.getAttribute?.('color')) return el.getAttribute('color');
    el = el.parentElement;
  }
  return '';
}

function isRichTextCommandActive(cmd, range) {
  if (BLOCK_COMMAND_TAGS[cmd]) {
    return !!elementFromNode(range.startContainer)?.closest?.(BLOCK_COMMAND_TAGS[cmd]);
  }

  try { return document.queryCommandState(cmd); } catch {}
  return false;
}

export function execRichTextCommand(editor, cmd, value = null) {
  if (!editor || !cmd) return false;
  if (cmd === 'insertTable') return insertRichTextTable(editor);
  if (cmd === 'blockquote') return toggleRichTextBlock(editor, 'blockquote', 'p');
  if (BLOCK_COMMAND_TAGS[cmd]) return wrapRichTextBlock(editor, BLOCK_COMMAND_TAGS[cmd]);
  if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
    const wantTag = cmd === 'insertUnorderedList' ? 'UL' : 'OL';
    if (unwrapListAtSelection(editor, wantTag)) return true;
  }
  document.execCommand(cmd, false, value);
  return true;
}

function getRichTextSelectionHighlight(editor, range) {
  if (!range) return '';
  const candidates = [range.startContainer, range.endContainer, window.getSelection()?.anchorNode];
  for (const node of candidates) {
    let el = elementFromNode(node);
    while (el && el !== editor) {
      const color = el.style?.backgroundColor || el.style?.background;
      if (color === 'transparent' || color === 'initial' || color === 'rgba(0, 0, 0, 0)') return '';
      if (color) return color;
      el = el.parentElement;
    }
  }
  return '';
}

/** Insère un tableau éditable avec une ligne d'en-tête et deux lignes de contenu. */
export function insertRichTextTable(editor, { columns = 3, bodyRows = 2 } = {}) {
  if (!editor) return false;
  const colCount = Math.max(1, Math.min(10, Number(columns) || 3));
  const requestedRows = Number(bodyRows);
  const rowCount = Math.max(0, Math.min(19, Number.isFinite(requestedRows) ? requestedRows : 2));
  const wrap = document.createElement('div');
  wrap.className = 'rte-table-wrap';
  const table = document.createElement('table');
  table.className = 'rte-table';
  table.style.minWidth = `${Math.max(420, colCount * 110)}px`;
  const thead = table.createTHead();
  const headRow = thead.insertRow();
  for (let col = 0; col < colCount; col++) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = `Colonne ${col + 1}`;
    headRow.appendChild(cell);
  }
  const tbody = table.createTBody();
  for (let row = 0; row < rowCount; row++) {
    const tr = tbody.insertRow();
    for (let col = 0; col < colCount; col++) tr.insertCell().appendChild(document.createElement('br'));
  }
  wrap.appendChild(table);

  const range = getSelectionRange();
  const selected = range && nodeBelongsToEditor(editor, range.commonAncestorContainer)
    ? elementFromNode(range.startContainer)
    : null;
  let topBlock = selected;
  while (topBlock?.parentElement && topBlock.parentElement !== editor) topBlock = topBlock.parentElement;
  if (topBlock && topBlock !== editor) topBlock.after(wrap);
  else editor.appendChild(wrap);

  const trailing = document.createElement('p');
  trailing.appendChild(document.createElement('br'));
  wrap.after(trailing);
  focusRichTextTableCell(headRow.cells[0]);
  notifyRichTextChange(editor, 'insertTable');
  return true;
}

function createRichTextTablePicker(editorId) {
  const picker = document.createElement('div');
  picker.className = 'rte-table-picker';
  picker.dataset.rteTablePicker = editorId;
  picker.hidden = true;
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Choisir la taille du tableau');
  picker.innerHTML = `
    <div class="rte-table-picker-title">Insérer un tableau</div>
    <div class="rte-table-picker-grid" role="grid" aria-label="Dimensions du tableau">
      ${Array.from({ length: 80 }, (_, index) => {
        const row = Math.floor(index / 10) + 1;
        const col = (index % 10) + 1;
        return `<button type="button" role="gridcell" data-rte-table-size="${col}x${row}" data-col="${col}" data-row="${row}" aria-label="${col} colonnes sur ${row} lignes"></button>`;
      }).join('')}
    </div>
    <div class="rte-table-picker-size" aria-live="polite">1 × 1</div>`;
  document.body.appendChild(picker);
  return picker;
}

function createRichTextTableMenu(editorId) {
  const menu = document.createElement('div');
  menu.className = 'rte-table-menu';
  menu.dataset.rteTableMenu = editorId;
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const item = (action, icon, label, className = '') =>
    `<button type="button" role="menuitem" class="rte-table-menu-item ${className}" data-rte-table-menu-action="${action}"><span aria-hidden="true">${icon}</span>${label}</button>`;
  menu.innerHTML = `
    <div class="rte-table-menu-section">
      ${item('header', '▰', '<span data-rte-table-header-label>Ajouter une ligne d’en-tête</span>')}
    </div>
    <div class="rte-table-menu-separator"></div>
    <div class="rte-table-menu-section">
      ${item('select-row', '↔', 'Sélectionner la ligne')}
      ${item('select-column', '↕', 'Sélectionner la colonne')}
      ${item('select-table', '▦', 'Sélectionner le tableau')}
    </div>
    <div class="rte-table-menu-separator"></div>
    <div class="rte-table-menu-section">
      ${item('row-add-above', '＋', 'Insérer une ligne au-dessus')}
      ${item('row-add-below', '＋', 'Insérer une ligne en dessous')}
      ${item('column-add-left', '＋', 'Insérer une colonne à gauche')}
      ${item('column-add-right', '＋', 'Insérer une colonne à droite')}
    </div>
    <div class="rte-table-menu-separator"></div>
    <div class="rte-table-menu-section">
      ${item('distribute-rows', '↕', 'Répartir les lignes')}
      ${item('distribute-columns', '↔', 'Répartir les colonnes')}
    </div>
    <div class="rte-table-menu-hint">Glissez une bordure de cellule pour la redimensionner.</div>
    <div class="rte-table-menu-separator"></div>
    <div class="rte-table-menu-section">
      ${item('row-remove', '⌫', 'Supprimer la ligne', 'is-danger')}
      ${item('column-remove', '⌫', 'Supprimer la colonne', 'is-danger')}
      ${item('delete', '⌫', 'Supprimer le tableau', 'is-danger')}
    </div>
    <div class="rte-table-menu-separator"></div>
    <div class="rte-table-menu-align" aria-label="Alignement de la cellule">
      <span>Aligner la cellule</span>
      <button type="button" data-rte-table-menu-action="align-left" title="Aligner à gauche" aria-label="Aligner à gauche">≡←</button>
      <button type="button" data-rte-table-menu-action="align-center" title="Centrer" aria-label="Centrer">≡</button>
      <button type="button" data-rte-table-menu-action="align-right" title="Aligner à droite" aria-label="Aligner à droite">→≡</button>
    </div>`;
  document.body.appendChild(menu);
  return menu;
}

function positionRichTextFloatingPanel(panel, left, top) {
  panel.hidden = false;
  panel.style.left = `${Math.max(8, left)}px`;
  panel.style.top = `${Math.max(8, top)}px`;
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;
}

function richTextTableCellFromRange(editor, range = getSelectionRange()) {
  if (!editor || !range || !nodeBelongsToEditor(editor, range.commonAncestorContainer)) return null;
  let cell = elementFromNode(range.startContainer)?.closest?.('th, td');
  // Dans une cellule vide, Chromium place parfois l'ancre sur le <tr> avec
  // un offset d'enfant plutôt que directement dans le <td>/<th>.
  if (!cell && range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const children = range.startContainer.childNodes;
    const child = children[Math.min(range.startOffset, children.length - 1)]
      || children[Math.max(0, range.startOffset - 1)];
    cell = elementFromNode(child)?.closest?.('th, td');
  }
  return cell && editor.contains(cell) ? cell : null;
}

function markRichTextTableCell(editor, cell) {
  editor?.querySelector?.('[data-rte-active-cell]')?.removeAttribute('data-rte-active-cell');
  if (cell && editor?.contains(cell)) cell.setAttribute('data-rte-active-cell', 'true');
}

function clearRichTextTableSelection(editor) {
  editor?.querySelectorAll?.('[data-rte-selected-cell]').forEach((cell) => {
    cell.removeAttribute('data-rte-selected-cell');
  });
}

function selectRichTextTableRectangle(editor, startCell, endCell = startCell) {
  const table = startCell?.closest('table');
  if (!table || endCell?.closest('table') !== table) return [];
  const rowStart = Math.min(startCell.parentElement.rowIndex, endCell.parentElement.rowIndex);
  const rowEnd = Math.max(startCell.parentElement.rowIndex, endCell.parentElement.rowIndex);
  const colStart = Math.min(startCell.cellIndex, endCell.cellIndex);
  const colEnd = Math.max(startCell.cellIndex, endCell.cellIndex);
  clearRichTextTableSelection(editor);
  const selected = [];
  [...table.rows].forEach((row, rowIndex) => {
    if (rowIndex < rowStart || rowIndex > rowEnd) return;
    [...row.cells].forEach((cell, colIndex) => {
      if (colIndex < colStart || colIndex > colEnd) return;
      cell.setAttribute('data-rte-selected-cell', 'true');
      selected.push(cell);
    });
  });
  editor.focus({ preventScroll: true });
  window.getSelection()?.removeAllRanges();
  return selected;
}

function richTextTableSelectedCells(editor, table = null) {
  return [...editor.querySelectorAll('[data-rte-selected-cell]')]
    .filter((cell) => !table || cell.closest('table') === table);
}

function applyRichTextToSelectedCells(editor, apply, inputType = 'formatBlock') {
  const cells = richTextTableSelectedCells(editor);
  if (!cells.length || typeof apply !== 'function') return false;
  const selection = window.getSelection();
  if (!selection) return false;

  cells.forEach((cell) => {
    if (!cell.isConnected || !editor.contains(cell)) return;
    const range = document.createRange();
    range.selectNodeContents(cell);
    selection.removeAllRanges();
    selection.addRange(range);
    apply(cell);
    cell.setAttribute('data-rte-selected-cell', 'true');
  });

  selection.removeAllRanges();
  editor.focus({ preventScroll: true });
  cells.forEach((cell) => cell.setAttribute('data-rte-selected-cell', 'true'));
  notifyRichTextChange(editor, inputType);
  return true;
}

function ensureRichTextTableColumns(table) {
  if (!table) return [];
  const count = Math.max(1, ...[...table.rows].map((row) => row.cells.length));
  let group = table.querySelector(':scope > colgroup');
  if (!group) {
    group = document.createElement('colgroup');
    table.insertBefore(group, table.firstChild);
  }
  while (group.children.length < count) group.appendChild(document.createElement('col'));
  while (group.children.length > count) group.lastElementChild.remove();
  const firstRow = table.rows[0];
  [...group.children].forEach((col, index) => {
    if (col.style.width) return;
    const measured = firstRow?.cells[index]?.getBoundingClientRect?.().width;
    col.style.width = `${Math.max(60, Math.round(measured || 110))}px`;
  });
  return [...group.children];
}

function applyRichTextTableColumnWidths(table, columns = ensureRichTextTableColumns(table)) {
  const total = columns.reduce((sum, col) => sum + (parseFloat(col.style.width) || 110), 0);
  table.style.width = `${total}px`;
  table.style.minWidth = `${total}px`;
}

function resizeRichTextTableColumn(table, index, width) {
  const columns = ensureRichTextTableColumns(table);
  if (!columns[index]) return;
  columns[index].style.width = `${Math.max(60, Math.round(width))}px`;
  applyRichTextTableColumnWidths(table, columns);
}

function resizeRichTextTableRow(row, height) {
  if (row) row.style.height = `${Math.max(32, Math.round(height))}px`;
}

function distributeRichTextTableColumns(table) {
  const columns = ensureRichTextTableColumns(table);
  const available = table.closest('.rte-table-wrap')?.clientWidth || table.getBoundingClientRect().width;
  const width = Math.max(80, Math.floor(available / columns.length));
  columns.forEach((col) => { col.style.width = `${width}px`; });
  applyRichTextTableColumnWidths(table, columns);
}

function distributeRichTextTableRows(table) {
  const rows = [...table.rows];
  const height = Math.max(32, ...rows.map((row) => Math.ceil(row.getBoundingClientRect().height)));
  rows.forEach((row) => { row.style.height = `${height}px`; });
}

function copyRichTextTableSelection(editor, event, cut = false) {
  const cells = richTextTableSelectedCells(editor);
  if (!cells.length || !event.clipboardData) return false;
  const table = cells[0].closest('table');
  const selected = new Set(cells.filter((cell) => cell.closest('table') === table));
  const rows = [...table.rows].filter((row) => [...row.cells].some((cell) => selected.has(cell)));
  const text = rows.map((row) => [...row.cells]
    .filter((cell) => selected.has(cell))
    .map((cell) => cell.innerText.trim())
    .join('\t')).join('\n');
  const html = `<table>${rows.map((row) => `<tr>${[...row.cells]
    .filter((cell) => selected.has(cell))
    .map((cell) => `<td>${cell.innerHTML}</td>`).join('')}</tr>`).join('')}</table>`;
  event.preventDefault();
  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData('text/html', html);
  if (cut) {
    cells.forEach((cell) => { cell.innerHTML = '<br>'; });
    notifyRichTextChange(editor, 'deleteByCut');
  }
  return true;
}

function focusRichTextTableCell(cell, atEnd = false) {
  if (!cell) return;
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(!atEnd);
  sel.removeAllRanges();
  sel.addRange(range);
  const editor = cell.closest('[contenteditable="true"]');
  markRichTextTableCell(editor, cell.matches?.('th, td') ? cell : null);
  editor?.focus?.({ preventScroll: true });
}

function notifyRichTextChange(editor, inputType = 'formatBlock') {
  let event;
  try { event = new InputEvent('input', { bubbles: true, inputType }); }
  catch { event = new Event('input', { bubbles: true }); }
  editor.dispatchEvent(event);
}

function removeRichTextTable(table, editor) {
  const wrap = table.closest('.rte-table-wrap');
  const anchor = wrap || table;
  let next = anchor.nextElementSibling;
  if (!next) {
    next = document.createElement('p');
    next.appendChild(document.createElement('br'));
    anchor.after(next);
  }
  anchor.remove();
  focusRichTextTableCell(next);
  notifyRichTextChange(editor, 'deleteContent');
}

function toggleRichTextTableHeader(table) {
  const head = table.tHead;
  if (head?.rows.length) {
    const body = table.tBodies[0] || table.createTBody();
    const rows = [...head.rows];
    const firstRow = rows[0];
    rows.reverse().forEach((row) => {
      [...row.cells].forEach((cell) => {
        const td = document.createElement('td');
        td.innerHTML = cell.innerHTML;
        td.style.cssText = cell.style.cssText;
        cell.replaceWith(td);
      });
      body.insertBefore(row, body.firstChild);
    });
    head.remove();
    return firstRow?.cells[0] || null;
  }
  const body = table.tBodies[0];
  const count = body?.rows[0]?.cells.length || table.rows[0]?.cells.length || 1;
  const newHead = table.createTHead();
  const row = newHead.insertRow();
  for (let index = 0; index < count; index++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = `Colonne ${index + 1}`;
    row.appendChild(th);
  }
  return row.cells[0];
}

function syncRichTextTableWidth(table) {
  const columnsGroup = table?.querySelector(':scope > colgroup');
  if (columnsGroup?.children.length) {
    applyRichTextTableColumnWidths(table, ensureRichTextTableColumns(table));
    return;
  }
  const columns = table?.rows[0]?.cells.length || 1;
  table?.style.setProperty('min-width', `${Math.max(420, columns * 110)}px`);
}

function runRichTextTableAction(editor, cell, action) {
  const table = cell?.closest('table');
  if (!table || !editor.contains(table)) return false;
  const row = cell.parentElement;
  const colIndex = cell.cellIndex;
  let focusCell = cell;

  if (action === 'select-row') {
    selectRichTextTableRectangle(editor, row.cells[0], row.cells[row.cells.length - 1]);
    return true;
  }
  if (action === 'select-column') {
    const lastRow = table.rows[table.rows.length - 1];
    selectRichTextTableRectangle(
      editor,
      table.rows[0].cells[Math.min(colIndex, table.rows[0].cells.length - 1)],
      lastRow.cells[Math.min(colIndex, lastRow.cells.length - 1)],
    );
    return true;
  }
  if (action === 'select-table') {
    const lastRow = table.rows[table.rows.length - 1];
    selectRichTextTableRectangle(editor, table.rows[0].cells[0], lastRow.cells[lastRow.cells.length - 1]);
    return true;
  }
  if (action === 'distribute-columns') {
    distributeRichTextTableColumns(table);
  } else if (action === 'distribute-rows') {
    distributeRichTextTableRows(table);
  } else if (action === 'row-add' || action === 'row-add-above' || action === 'row-add-below') {
    const above = action === 'row-add-above';
    const currentSection = row.parentElement;
    const body = table.tBodies[0] || table.createTBody();
    const section = currentSection.tagName === 'THEAD' && above ? currentSection : body;
    const targetIndex = currentSection === section
      ? row.sectionRowIndex + (above ? 0 : 1)
      : 0;
    const newRow = section.insertRow(targetIndex);
    const count = table.rows[0]?.cells.length || 1;
    for (let i = 0; i < count; i++) {
      const added = document.createElement(section.tagName === 'THEAD' ? 'th' : 'td');
      if (added.tagName === 'TH') added.scope = 'col';
      added.appendChild(document.createElement('br'));
      newRow.appendChild(added);
    }
    focusCell = newRow.cells[Math.min(colIndex, count - 1)];
  } else if (action === 'row-remove') {
    if (table.rows.length <= 1) return removeRichTextTable(table, editor), true;
    const rowIndex = row.rowIndex;
    const nextRow = table.rows[rowIndex + 1] || table.rows[rowIndex - 1];
    const section = row.parentElement;
    row.remove();
    if (!section.rows?.length && section.tagName === 'THEAD') section.remove();
    focusCell = nextRow?.cells[Math.min(colIndex, (nextRow?.cells.length || 1) - 1)];
  } else if (action === 'column-add' || action === 'column-add-left' || action === 'column-add-right') {
    const before = action === 'column-add-left';
    [...table.rows].forEach((currentRow) => {
      const source = currentRow.cells[Math.min(colIndex, currentRow.cells.length - 1)];
      const added = document.createElement(currentRow.parentElement.tagName === 'THEAD' ? 'th' : 'td');
      if (added.tagName === 'TH') added.scope = 'col';
      added.appendChild(document.createElement('br'));
      if (source) source[before ? 'before' : 'after'](added);
      else currentRow.appendChild(added);
      if (currentRow === row) focusCell = added;
    });
    syncRichTextTableWidth(table);
  } else if (action === 'column-remove') {
    if ((table.rows[0]?.cells.length || 1) <= 1) return removeRichTextTable(table, editor), true;
    [...table.rows].forEach((currentRow) => currentRow.cells[colIndex]?.remove());
    syncRichTextTableWidth(table);
    focusCell = row.cells[Math.min(colIndex, row.cells.length - 1)];
  } else if (action === 'header') {
    focusCell = toggleRichTextTableHeader(table) || cell;
  } else if (action.startsWith('align-')) {
    const selected = richTextTableSelectedCells(editor, table);
    const targets = selected.includes(cell) ? selected : [cell];
    targets.forEach((target) => { target.style.textAlign = action.slice(6); });
  } else if (action === 'delete') {
    removeRichTextTable(table, editor);
    return true;
  } else {
    return false;
  }

  focusRichTextTableCell(focusCell);
  notifyRichTextChange(editor, 'formatBlock');
  return true;
}

function bindRichTextTableControls({
  editor,
  toolbar,
  signal,
  selection,
  editorId,
  onAfterCommand,
  syncToolbarState,
}) {
  const toggle = toolbar?.querySelector('[data-rte-table-toggle]');
  if (!toggle) return;
  document.querySelectorAll(`[data-rte-table-picker="${CSS.escape(editorId)}"], [data-rte-table-menu="${CSS.escape(editorId)}"]`)
    .forEach((node) => node.remove());
  const picker = createRichTextTablePicker(editorId);
  const menu = createRichTextTableMenu(editorId);
  const pickerCells = [...picker.querySelectorAll('[data-rte-table-size]')];
  let activeCell = null;
  let rangeStartCell = null;
  let rangeSelecting = false;
  let suppressClickUntil = 0;
  let resizeState = null;

  const closePicker = () => { picker.hidden = true; };
  const closeMenu = () => { menu.hidden = true; };
  const closeAll = () => { closePicker(); closeMenu(); };
  const highlightSize = (col = 1, row = 1) => {
    pickerCells.forEach((button) => {
      button.classList.toggle('is-selected', Number(button.dataset.col) <= col && Number(button.dataset.row) <= row);
    });
    const label = picker.querySelector('.rte-table-picker-size');
    if (label) label.textContent = `${col} × ${row}`;
  };
  const rememberCell = (event) => {
    const pointedCell = event?.target?.closest?.('th, td');
    const selectedCell = richTextTableCellFromRange(editor);
    if (event?.target && editor.contains(event.target)) {
      activeCell = (pointedCell && editor.contains(pointedCell) ? pointedCell : null) || selectedCell;
    } else {
      activeCell = selectedCell || activeCell;
    }
    markRichTextTableCell(editor, activeCell);
  };
  const openMenu = (cell, x, y) => {
    activeCell = cell;
    markRichTextTableCell(editor, cell);
    closePicker();
    const hasHeader = !!cell.closest('table')?.tHead;
    const headerLabel = menu.querySelector('[data-rte-table-header-label]');
    if (headerLabel) headerLabel.textContent = hasHeader ? 'Retirer la ligne d’en-tête' : 'Ajouter une ligne d’en-tête';
    positionRichTextFloatingPanel(menu, x, y);
    menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  };
  const resizeEdge = (event, cell) => {
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    const rightDistance = Math.abs(rect.right - event.clientX);
    const bottomDistance = Math.abs(rect.bottom - event.clientY);
    if (rightDistance <= 7 && rightDistance <= bottomDistance) return 'column';
    if (bottomDistance <= 7) return 'row';
    return null;
  };
  const updateResizeCursor = (event) => {
    if (resizeState) return;
    const cell = event.target.closest?.('th, td');
    editor.querySelector('[data-rte-resize-edge]')?.removeAttribute('data-rte-resize-edge');
    const edge = cell && editor.contains(cell) ? resizeEdge(event, cell) : null;
    if (edge) cell.setAttribute('data-rte-resize-edge', edge);
  };

  toggle.addEventListener('mousedown', (event) => {
    selection?.save?.();
    event.preventDefault();
  }, { signal });
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    if (!picker.hidden) return closePicker();
    highlightSize(1, 1);
    const rect = toggle.getBoundingClientRect();
    positionRichTextFloatingPanel(picker, rect.left, rect.bottom + POPUP_OFFSET);
  }, { signal });

  picker.addEventListener('pointerover', (event) => {
    const button = event.target.closest('[data-rte-table-size]');
    if (button) highlightSize(Number(button.dataset.col), Number(button.dataset.row));
  }, { signal });
  picker.addEventListener('focusin', (event) => {
    const button = event.target.closest('[data-rte-table-size]');
    if (button) highlightSize(Number(button.dataset.col), Number(button.dataset.row));
  }, { signal });
  picker.addEventListener('mousedown', (event) => {
    if (!event.target.closest('[data-rte-table-size]')) return;
    event.preventDefault();
  }, { signal });
  picker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rte-table-size]');
    if (!button) return;
    selection?.restore?.();
    const columns = Number(button.dataset.col);
    const rows = Number(button.dataset.row);
    insertRichTextTable(editor, { columns, bodyRows: Math.max(0, rows - 1) });
    closePicker();
    syncToolbarState?.();
    onAfterCommand?.({ cmd: 'insertTable', editor, button, event });
  }, { signal });

  editor.addEventListener('mousemove', updateResizeCursor, { signal });
  editor.addEventListener('mouseleave', () => {
    if (!resizeState) editor.querySelector('[data-rte-resize-edge]')?.removeAttribute('data-rte-resize-edge');
  }, { signal });
  editor.addEventListener('mousedown', (event) => {
    const cell = event.target.closest?.('th, td');
    if (event.button !== 0 || !cell || !editor.contains(cell)) return;
    const edge = resizeEdge(event, cell);
    if (edge) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const table = cell.closest('table');
      const columns = edge === 'column' ? ensureRichTextTableColumns(table) : [];
      resizeState = {
        edge,
        editor,
        table,
        cell,
        row: cell.parentElement,
        index: cell.cellIndex,
        startX: event.clientX,
        startY: event.clientY,
        startSize: edge === 'column'
          ? (parseFloat(columns[cell.cellIndex]?.style.width) || cell.getBoundingClientRect().width)
          : cell.parentElement.getBoundingClientRect().height,
      };
      editor.classList.add('rte-table-is-resizing');
      document.body.classList.add(`rte-table-resize-${edge}`);
      return;
    }
    rangeStartCell = cell;
    rangeSelecting = false;
    if (event.shiftKey && activeCell?.closest('table') === cell.closest('table')) {
      event.preventDefault();
      selectRichTextTableRectangle(editor, activeCell, cell);
      rangeSelecting = true;
    } else if (!cell.hasAttribute('data-rte-selected-cell')) {
      clearRichTextTableSelection(editor);
    }
  }, { signal });
  document.addEventListener('mousemove', (event) => {
    if (resizeState) {
      event.preventDefault();
      if (resizeState.edge === 'column') {
        resizeRichTextTableColumn(
          resizeState.table,
          resizeState.index,
          resizeState.startSize + event.clientX - resizeState.startX,
        );
      } else {
        resizeRichTextTableRow(resizeState.row, resizeState.startSize + event.clientY - resizeState.startY);
      }
      return;
    }
    if (!rangeStartCell || !(event.buttons & 1)) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('th, td');
    if (!target || target === rangeStartCell || target.closest('table') !== rangeStartCell.closest('table')) return;
    event.preventDefault();
    rangeSelecting = true;
    editor.classList.add('rte-table-is-selecting');
    selectRichTextTableRectangle(editor, rangeStartCell, target);
  }, { signal });
  document.addEventListener('mouseup', () => {
    if (resizeState) {
      resizeState.editor.classList.remove('rte-table-is-resizing');
      document.body.classList.remove(`rte-table-resize-${resizeState.edge}`);
      resizeState.cell.removeAttribute('data-rte-resize-edge');
      notifyRichTextChange(editor, 'formatBlock');
      onAfterCommand?.({ cmd: `table:resize-${resizeState.edge}`, editor });
      resizeState = null;
    }
    if (rangeSelecting) {
      suppressClickUntil = Date.now() + 120;
      editor.classList.remove('rte-table-is-selecting');
    }
    rangeStartCell = null;
    rangeSelecting = false;
  }, { signal });
  editor.addEventListener('mousedown', rememberCell, { signal });
  editor.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    const cell = event.target.closest?.('th, td');
    if (cell && !event.shiftKey) clearRichTextTableSelection(editor);
    rememberCell(event);
  }, { signal });
  editor.addEventListener('keyup', rememberCell, { signal });
  editor.addEventListener('copy', (event) => copyRichTextTableSelection(editor, event), { signal });
  editor.addEventListener('cut', (event) => copyRichTextTableSelection(editor, event, true), { signal });
  editor.addEventListener('contextmenu', (event) => {
    const cell = event.target.closest('th, td');
    if (!cell || !editor.contains(cell)) return;
    event.preventDefault();
    openMenu(cell, event.clientX, event.clientY);
  }, { signal });
  editor.addEventListener('keydown', (event) => {
    const cell = editor.querySelector('[data-rte-active-cell]')
      || richTextTableCellFromRange(editor)
      || activeCell;
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && cell) {
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      openMenu(cell, rect.left + 12, rect.top + 12);
      return;
    }
    const selectedCells = richTextTableSelectedCells(editor);
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectedCells.length) {
      event.preventDefault();
      selectedCells.forEach((selectedCell) => { selectedCell.innerHTML = '<br>'; });
      notifyRichTextChange(editor, 'deleteContent');
      return;
    }
    if (event.key !== 'Tab' || !cell) return;
    const cells = [...cell.closest('table').querySelectorAll('th, td')];
    const index = cells.indexOf(cell);
    let target = cells[index + (event.shiftKey ? -1 : 1)];
    if (!target && !event.shiftKey) {
      runRichTextTableAction(editor, cell, 'row-add-below');
      target = [...cell.closest('table')?.querySelectorAll('th, td') || []][index + 1] || null;
    }
    if (!target) return;
    event.preventDefault();
    focusRichTextTableCell(target);
    activeCell = target;
  }, { signal });

  menu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rte-table-menu-action]');
    if (!button) return;
    event.preventDefault();
    if (!runRichTextTableAction(editor, activeCell, button.dataset.rteTableMenuAction)) return;
    closeMenu();
    syncToolbarState?.();
    onAfterCommand?.({ cmd: `table:${button.dataset.rteTableMenuAction}`, editor, button, event });
  }, { signal });

  document.addEventListener('mousedown', (event) => {
    if (picker.contains(event.target) || menu.contains(event.target) || toggle.contains(event.target)) return;
    closeAll();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  }, { signal });
  window.addEventListener('resize', closeAll, { signal });
  window.addEventListener('scroll', closeAll, { signal, capture: true });
  signal.addEventListener('abort', () => { picker.remove(); menu.remove(); }, { once: true });
}

function toggleRichTextBlock(editor, tag, fallbackTag = 'p') {
  const range = getSelectionRange();
  if (!editor || !range) return false;
  const activeBlock = elementFromNode(range.startContainer)?.closest?.(tag);

  if (activeBlock && editor.contains(activeBlock)) {
    // Tentative 1 : formatBlock (rapide quand ça marche)
    document.execCommand('formatBlock', false, fallbackTag);
    // Tentative 2 : si le tag est toujours là (Chrome buggé sur <blockquote>),
    // on déplace manuellement les enfants du tag vers son parent puis on supprime.
    const stillThere = elementFromNode(getSelectionRange()?.startContainer)?.closest?.(tag);
    if (stillThere && editor.contains(stillThere)) {
      _unwrapBlock(stillThere, fallbackTag);
    }
    return true;
  }

  document.execCommand('formatBlock', false, tag);
  return true;
}

/** Déballe un bloc : déplace ses enfants au même niveau et supprime le wrapper. */
function _unwrapBlock(blockEl, fallbackTag = 'p') {
  if (!blockEl || !blockEl.parentNode) return;
  const parent = blockEl.parentNode;
  const frag = document.createDocumentFragment();
  // Si le block est vide, on insère un paragraphe vide à la place pour
  // préserver le curseur (sinon le navigateur peut perdre la sélection).
  if (!blockEl.textContent.trim() && !blockEl.querySelector('br,img')) {
    const p = document.createElement(fallbackTag);
    p.appendChild(document.createElement('br'));
    frag.appendChild(p);
  } else {
    // Si le contenu n'est pas déjà dans des blocs, on l'enveloppe dans <p>
    const hasBlocks = [...blockEl.childNodes].some(n =>
      n.nodeType === 1 && /^(P|H[1-6]|DIV|UL|OL|BLOCKQUOTE)$/i.test(n.tagName));
    if (hasBlocks) {
      while (blockEl.firstChild) frag.appendChild(blockEl.firstChild);
    } else {
      const p = document.createElement(fallbackTag);
      while (blockEl.firstChild) p.appendChild(blockEl.firstChild);
      frag.appendChild(p);
    }
  }
  parent.replaceChild(frag, blockEl);
}

function wrapRichTextBlock(editor, tag) {
  const sel = window.getSelection();
  const range = getSelectionRange(sel);
  if (!editor || !range) return false;

  const block = closestUntil(range.commonAncestorContainer, tag, editor);
  if (block) {
    unwrapBlockAsParagraph(block);
    return true;
  }

  const el = document.createElement(tag);
  try { range.surroundContents(el); }
  catch {
    el.appendChild(range.extractContents());
    range.insertNode(el);
  }

  selectRichTextNodeContents(el, sel);
  sel.collapseToEnd();
  return true;
}

// ── Helpers DOM exposés aux éditeurs spécialisés ─────────────────────────────

export function placeCaretAfterNode(node, sel = window.getSelection()) {
  if (!node || !sel) return false;

  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  if (!node.nextSibling || (node.nextSibling.nodeType === Node.TEXT_NODE && !node.nextSibling.textContent.startsWith(' '))) {
    const space = document.createTextNode('\u00A0');
    node.after(space);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  return true;
}

export function replaceRichTextRangeWithNode({
  startNode,
  startOffset,
  endNode = startNode,
  endOffset,
  node,
  editor = null,
  selection = window.getSelection(),
  placeCaret = true,
} = {}) {
  if (!startNode || !endNode || !node) return false;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  range.deleteContents();
  range.insertNode(node);

  editor?.focus?.();
  if (placeCaret) placeCaretAfterNode(node, selection);
  return true;
}

export function selectRichTextNodeContents(node, selection = window.getSelection()) {
  if (!node || !selection) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function richTextInlineChipElement({
  className = '',
  text = '',
  dataset = {},
  style = '',
} = {}) {
  const span = document.createElement('span');
  span.className = className;
  span.contentEditable = 'false';
  Object.entries(dataset).forEach(([key, value]) => {
    span.dataset[key] = value;
  });
  if (style) span.style.cssText = style;
  span.textContent = text;
  return span;
}

export function countRichTextWords(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function colorSelectedLists(editor, color) {
  const range = getSelectionRange();
  if (!range) return;
  const items = new Set();

  const addItemFrom = (node) => {
    const li = elementFromNode(node)?.closest?.('li');
    if (li && editor.contains(li)) items.add(li);
  };

  addItemFrom(range.startContainer);
  addItemFrom(range.endContainer);

  editor.querySelectorAll('li').forEach((li) => {
    if (range.intersectsNode(li)) items.add(li);
  });

  items.forEach((li) => {
    if (color === 'initial') li.style.removeProperty('--rte-marker-color');
    else li.style.setProperty('--rte-marker-color', color);
  });
}

// Retire les couleurs explicites (style.color, font[color]) sur la sélection
// pour que le texte reprenne la couleur héritée de l'éditeur (qui suit le thème).
function clearRichTextColor(editor) {
  const range = getSelectionRange();
  if (!range) return;

  const targets = new Set();
  const collectAncestors = (node) => {
    let el = elementFromNode(node);
    while (el && el !== editor) {
      targets.add(el);
      el = el.parentElement;
    }
  };
  collectAncestors(range.startContainer);
  collectAncestors(range.endContainer);
  editor.querySelectorAll('[style*="color"], font[color]').forEach((el) => {
    if (range.intersectsNode(el)) targets.add(el);
  });

  targets.forEach((el) => {
    if (el.style?.color) el.style.color = '';
    if (el.tagName === 'FONT' && el.hasAttribute('color')) el.removeAttribute('color');
    if (el.getAttribute?.('style') === '') el.removeAttribute('style');
    if (el.tagName === 'FONT' && !el.attributes.length) unwrapElement(el);
  });
}

function clearDefaultFontMarkers(editor) {
  editor.querySelectorAll('font[face]').forEach((font) => {
    if (normalizeFontToken(font.getAttribute('face')) !== DEFAULT_FONT_SENTINEL) return;
    font.removeAttribute('face');
    if (!font.attributes.length) unwrapElement(font);
  });

  editor.querySelectorAll('[style*="font-family"]').forEach((el) => {
    if (normalizeFontToken(el.style.fontFamily) !== DEFAULT_FONT_SENTINEL) return;
    el.style.fontFamily = '';
    if (!el.getAttribute('style')) unwrapElement(el);
  });
}

function normalizeFontSizeMarkers(editor, size) {
  editor.querySelectorAll('font[size="7"]').forEach((font) => {
    font.removeAttribute('size');
    font.style.fontSize = size;
    if (!font.getAttribute('style')) unwrapElement(font);
  });
}

function normalizeFontToken(value = '') {
  return String(value).replace(/['"]/g, '').trim().toLowerCase();
}

function unwrapElement(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

// Toggle off d'une liste : si le curseur est dans une <ul>/<ol> du tag attendu,
// déballe les <li> en <p> à la place de la liste. Retourne true si une liste
// a été retirée (le caller saute alors le execCommand standard).
function unwrapListAtSelection(editor, wantTag) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const list = elementFromNode(sel.anchorNode)?.closest?.('ul, ol');
  if (!list || list.tagName !== wantTag || !editor.contains(list)) return false;

  // Si la liste contient des sous-listes, le déballage manuel produirait du HTML
  // invalide (<p><ul>...</ul></p>). On laisse `outdent` faire le travail natif,
  // qui gère correctement les niveaux imbriqués.
  if (list.querySelector('ul, ol')) {
    document.execCommand('outdent', false, null);
    return true;
  }

  const parent = list.parentNode;
  let firstP = null;
  Array.from(list.children).filter((c) => c.tagName === 'LI').forEach((li) => {
    const p = document.createElement('p');
    while (li.firstChild) p.appendChild(li.firstChild);
    if (!p.firstChild) p.appendChild(document.createElement('br'));
    parent.insertBefore(p, list);
    firstP ||= p;
  });
  list.remove();

  // Replace le curseur dans le premier <p> issu du déballage.
  if (firstP) {
    const range = document.createRange();
    range.selectNodeContents(firstP);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

function getSelectionRange(selection = window.getSelection()) {
  return selection?.rangeCount ? selection.getRangeAt(0) : null;
}

function nodeBelongsToEditor(editor, node) {
  return !!node && (editor === node || editor.contains(node));
}

function elementFromNode(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function closestUntil(node, tag, boundary) {
  let el = elementFromNode(node);
  while (el && el !== boundary) {
    if (el.tagName?.toLowerCase() === tag) return el;
    el = el.parentElement;
  }
  return null;
}

function unwrapBlockAsParagraph(block) {
  const p = document.createElement('p');
  while (block.firstChild) p.appendChild(block.firstChild);
  block.replaceWith(p);
}

function toSet(values) {
  return values instanceof Set ? values : new Set(values || []);
}

// ── Lecture, comptage, sanitisation ──────────────────────────────────────────

export function getRichTextHtml(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  return sanitizeRichTextHtml(el.innerHTML).trim();
}

const RICH_TEXT_DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta',
  'base', 'template', 'svg', 'math',
]);
const RICH_TEXT_ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'font', 'h1', 'h2',
  'h3', 'h4', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span',
  'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul', 'caption', 'colgroup', 'col',
]);
const RICH_TEXT_ALLOWED_ATTRS = new Set([
  'alt', 'class', 'color', 'contenteditable', 'face', 'height', 'href',
  'rel', 'size', 'src', 'style', 'target', 'title', 'width', 'xlink:href',
  'colspan', 'rowspan', 'scope',
]);
const RICH_TEXT_ALLOWED_STYLE_PROPS = new Set([
  'background', 'background-color', 'border', 'border-color',
  'border-bottom', 'border-bottom-color', 'border-bottom-style',
  'border-bottom-width', 'border-left', 'border-left-color',
  'border-left-style', 'border-left-width', 'border-radius', 'border-right',
  'border-right-color', 'border-right-style', 'border-right-width',
  'border-style', 'border-top', 'border-top-color', 'border-top-style',
  'border-top-width', 'border-width', 'color', 'cursor', 'display',
  'font-family', 'font-size', 'font-style', 'font-weight', 'margin',
  'margin-bottom', 'margin-left', 'margin-right', 'margin-top', 'opacity',
  'padding', 'padding-bottom', 'padding-left', 'padding-right', 'padding-top',
  'text-align', 'text-decoration', 'text-transform', 'user-select', 'vertical-align',
  'white-space', 'border-collapse', 'table-layout', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height',
]);

// Sanitisation : whitelist des tags/attributs utiles au rich-text, retrait des
// handlers inline, des contenus actifs et des URLs/CSS dangereux.
export function sanitizeRichTextHtml(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);

  tpl.content.querySelectorAll('*').forEach((n) => {
    const tag = n.tagName.toLowerCase();
    if (RICH_TEXT_DROP_CONTENT_TAGS.has(tag)) {
      n.remove();
      return;
    }
    if (!RICH_TEXT_ALLOWED_TAGS.has(tag)) {
      unwrapElement(n);
      return;
    }
    sanitizeRichTextAttributes(n, tag);
  });

  removeRichTextComments(tpl.content);

  // Retire les citations vides (héritées d'anciennes suppressions) : un
  // <blockquote> sans texte ni image laissait sa bordure bleue orpheline.
  // S'applique au chargement de l'éditeur, à l'affichage lecture seule et à
  // l'enregistrement → l'ancienne citation vide disparaît pour de bon.
  tpl.content.querySelectorAll('blockquote').forEach((bq) => {
    if (_isEmptyBlockquote(bq)) bq.remove();
  });
  tpl.content.querySelectorAll('[data-rte-active-cell], [data-rte-selected-cell], [data-rte-resize-edge]').forEach((cell) => {
    cell.removeAttribute('data-rte-active-cell');
    cell.removeAttribute('data-rte-selected-cell');
    cell.removeAttribute('data-rte-resize-edge');
  });
  // Les tableaux anciens ou collés gagnent le même conteneur responsive que
  // ceux créés par la barre d'outils, sans doubler les wrappers déjà présents.
  tpl.content.querySelectorAll('table').forEach((table) => {
    table.classList.add('rte-table');
    if (!table.style.minWidth) syncRichTextTableWidth(table);
    if (table.parentElement?.classList.contains('rte-table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'rte-table-wrap';
    table.before(wrap);
    wrap.appendChild(table);
  });
  return tpl.innerHTML;
}

function applyRichTextHighlight(editor, color) {
  const selectedCells = richTextTableSelectedCells(editor);
  if (selectedCells.length) {
    selectedCells.forEach((cell) => {
      applyRichTextCellHighlight(cell, color);
      cell.setAttribute('data-rte-selected-cell', 'true');
    });
    notifyRichTextChange(editor, 'formatBackColor');
    return;
  }

  const value = color === 'initial' ? 'transparent' : color;
  let applied = false;
  try { applied = document.execCommand('hiliteColor', false, value); } catch {}
  if (!applied) {
    try { document.execCommand('backColor', false, value); } catch {}
  }
}

function applyRichTextCellHighlight(cell, color) {
  if (color === 'initial') {
    [cell, ...cell.querySelectorAll('[style*="background"]')].forEach((element) => {
      element.style.removeProperty('background');
      element.style.removeProperty('background-color');
      if (!element.getAttribute('style')) element.removeAttribute('style');
    });
    cell.querySelectorAll('span:not([class])').forEach((span) => {
      if (!span.attributes.length) unwrapElement(span);
    });
    return;
  }

  cell.style.backgroundColor = color;
  const showText = globalThis.NodeFilter?.SHOW_TEXT || 4;
  const walker = document.createTreeWalker(cell, showText);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim()) continue;
    if (elementFromNode(node)?.closest?.('[contenteditable="false"]')) continue;
    textNodes.push(node);
  }
  textNodes.forEach((node) => {
    const parent = node.parentElement;
    if (parent?.tagName === 'SPAN' && parent.childNodes.length === 1 && !parent.className) {
      parent.style.backgroundColor = color;
      return;
    }
    const span = document.createElement('span');
    span.style.backgroundColor = color;
    node.before(span);
    span.appendChild(node);
  });
}

function sanitizeRichTextAttributes(n, tag) {
  [...n.attributes].forEach((a) => {
    const name = a.name.toLowerCase();
    const isDataAttr = /^data-[a-z0-9_-]+$/i.test(name);
    if (/^on/i.test(name) || name === 'srcdoc' ||
        (!isDataAttr && !RICH_TEXT_ALLOWED_ATTRS.has(name))) {
      n.removeAttribute(a.name);
      return;
    }

    if ((name === 'href' || name === 'xlink:href') && tag !== 'a') {
      n.removeAttribute(a.name);
      return;
    }
    if (name === 'src' && tag !== 'img') {
      n.removeAttribute(a.name);
      return;
    }
    if ((name === 'href' || name === 'src' || name === 'xlink:href') &&
        !isSafeRichTextUrl(name, a.value)) {
      n.removeAttribute(a.name);
      return;
    }
    if (name === 'style') {
      const safeStyle = sanitizeRichTextStyle(a.value);
      if (safeStyle) n.setAttribute('style', safeStyle);
      else n.removeAttribute(a.name);
      return;
    }
    if (name === 'contenteditable' && a.value.toLowerCase() !== 'false') {
      n.removeAttribute(a.name);
      return;
    }
    if (name === 'target' && !['_blank', '_self'].includes(a.value)) {
      n.removeAttribute(a.name);
      return;
    }
  });

  if (tag === 'a' && n.getAttribute('target') === '_blank') {
    n.setAttribute('rel', 'noopener noreferrer');
  }
}

function isSafeRichTextUrl(name, value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.startsWith('#')) return true;
  try {
    const base = document.baseURI || globalThis.location?.href || 'https://example.invalid/';
    const url = new URL(raw, base);
    const protocol = url.protocol.toLowerCase();
    if (name === 'src') {
      return protocol === 'http:' ||
             protocol === 'https:' ||
             /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(raw);
    }
    return protocol === 'http:' ||
           protocol === 'https:' ||
           protocol === 'mailto:' ||
           protocol === 'tel:';
  } catch {
    return false;
  }
}

function sanitizeRichTextStyle(value) {
  const probe = document.createElement('span');
  probe.setAttribute('style', value);
  const out = [];
  for (let i = 0; i < probe.style.length; i++) {
    const prop = probe.style[i];
    const name = prop.toLowerCase();
    const val = probe.style.getPropertyValue(prop).trim();
    if (!isAllowedRichTextStyleProp(name) || !isSafeRichTextCssValue(val)) continue;
    out.push(`${name}: ${val}`);
  }
  return out.join('; ');
}

function isAllowedRichTextStyleProp(name) {
  return RICH_TEXT_ALLOWED_STYLE_PROPS.has(name) || /^--rte-[a-z0-9_-]+$/i.test(name);
}

function isSafeRichTextCssValue(value) {
  return !/(?:url\s*\(|expression\s*\(|javascript:|vbscript:|data:|@import|-moz-binding)/i.test(value);
}

function removeRichTextComments(root) {
  const showComment = globalThis.NodeFilter?.SHOW_COMMENT || 128;
  const walker = document.createTreeWalker(root, showComment);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((node) => node.remove());
}
