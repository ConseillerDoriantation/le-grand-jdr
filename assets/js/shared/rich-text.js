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
  insertHorizontalRule: { title: 'Séparateur horizontal', html: '—', stateful: false },
  removeFormat: { title: 'Effacer la mise en forme', html: '⊘', stateful: false },
};
const DEFAULT_RICH_TEXT_TOOLBAR_GROUPS = [
  ['bold', 'italic', 'underline', 'strikeThrough'],
  ['insertUnorderedList', 'insertOrderedList', 'blockquote', 'insertHorizontalRule'],
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
  'insertHorizontalRule',
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
      <button type="button" class="${_esc(buttonClass)} rte-color-toggle" title="Couleur du texte">
        <span class="rte-color-letter">A</span>
        <span class="rte-color-bar"></span>
        <span class="rte-color-caret">▾</span>
      </button>
      <div class="rte-color-pop" data-rte-pop="${safeId}">${swatches}</div>
    </div>
  `;
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
  const attrs = attrsHtml({
    type: 'button',
    class: [buttonClass, cfg.className].filter(Boolean).join(' '),
    [commandAttr]: cfg.cmd,
    title: cfg.title || null,
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
      <button type="button" class="${_esc(buttonClass)} rte-font-toggle" title="Police d'écriture">
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
      <button type="button" class="${_esc(buttonClass)} rte-size-toggle" title="Taille du texte">
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
    ...Array.from(root?.querySelectorAll?.('.rte-color-pop, .rte-font-pop, .rte-size-pop') || []),
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
  if (pop.classList.contains('rte-font-pop')) return 'rte-font-pop';
  if (pop.classList.contains('rte-size-pop')) return 'rte-size-pop';
  return '';
}

function detachedRichTextPopups(editorId = null) {
  const selector = editorId
    ? `body > [data-rte-pop="${CSS.escape(editorId)}"]`
    : 'body > .rte-color-pop, body > .rte-font-pop, body > .rte-size-pop';
  return Array.from(document.querySelectorAll(selector));
}

function setDefaultParagraphSeparator() {
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {
    console.debug('[rte] defaultParagraphSeparator non supporté', e);
  }
}

function applyRichTextFont(editor, font) {
  if (font === 'inherit') {
    document.execCommand('fontName', false, DEFAULT_FONT_SENTINEL);
    clearDefaultFontMarkers(editor);
  } else {
    document.execCommand('fontName', false, font);
  }
}

function applyRichTextTextSize(editor, size) {
  document.execCommand('fontSize', false, '7');
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
    if (color === 'initial') {
      clearRichTextColor(editor);
    } else {
      document.execCommand('foreColor', false, color);
    }
    colorSelectedLists(editor, color);
    if (bar) bar.style.background = color === 'initial' ? '' : color;
    pop.classList.remove('show');
    selectionMemory.save();
    syncToolbarState?.();
    onAfterColor?.(color);
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
    enableFont: true,
    enableSize: true,
  });

  bindRichTextListIndentation(editor, controls.signal);
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
    fontPop.classList.remove('show');
    selection.save();
    syncToolbarState?.();
    onAfterFont?.(font);
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
    sizePop.classList.remove('show');
    selection.save();
    syncToolbarState?.();
    onAfterSize?.(size);
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
      handled = execRichTextCommand(editor, cmd);
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

  if (enableColor || enableFont || enableSize) {
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

  toolbar.querySelectorAll(`[${commandAttr}]`).forEach((btn) => {
    const cmd = btn.getAttribute(commandAttr);
    if (!statefulCommands.has(cmd)) return;

    const active = hasEditorSelection ? isRichTextCommandActive(cmd, range) : false;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
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
  if (cmd === 'blockquote') return toggleRichTextBlock(editor, 'blockquote', 'p');
  if (BLOCK_COMMAND_TAGS[cmd]) return wrapRichTextBlock(editor, BLOCK_COMMAND_TAGS[cmd]);
  if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
    const wantTag = cmd === 'insertUnorderedList' ? 'UL' : 'OL';
    if (unwrapListAtSelection(editor, wantTag)) return true;
  }
  document.execCommand(cmd, false, value);
  return true;
}

function toggleRichTextBlock(editor, tag, fallbackTag = 'p') {
  const range = getSelectionRange();
  if (!editor || !range) return false;
  const activeBlock = elementFromNode(range.startContainer)?.closest?.(tag);

  if (activeBlock && editor.contains(activeBlock)) {
    document.execCommand('formatBlock', false, fallbackTag);
    return true;
  }

  document.execCommand('formatBlock', false, tag);
  return true;
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

// Sanitisation minimale : strip <script>/<style>, attributs on*, et URLs javascript:
export function sanitizeRichTextHtml(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  tpl.content.querySelectorAll('script, style').forEach((n) => n.remove());
  tpl.content.querySelectorAll('*').forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) {
        n.removeAttribute(a.name);
      }
    });
  });
  return tpl.innerHTML;
}
