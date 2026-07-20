import { _esc } from './html.js';
import { sanitizeRichTextHtml } from './rich-text.js';
import { compressDataUrl, pickImageFile } from './image-upload.js';
import { showNotif } from './notifications.js';

const PAGE_WIDTH = 1000;
const DEFAULT_HEIGHT = 650;
const MAX_BLOCKS = 30;
const MAX_IMAGES = 20;
const MAX_SLIDES = 18;
const MAX_HISTORY = 50;
const BLOCK_TYPES = new Set(['text', 'image', 'table', 'chart', 'shape']);
const TEXT_COLORS = new Set(['default', 'gold', 'blue', 'green', 'red', 'violet']);
const TEXT_SURFACES = new Set(['none', 'soft', 'dark']);
const SHAPE_TYPES = new Set(['rectangle', 'circle', 'diamond', 'triangle', 'pentagon', 'hexagon', 'star', 'arrow', 'chevron', 'line']);
const CHART_TYPES = new Set(['bar', 'horizontal-bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'polar', 'scatter', 'lollipop', 'progress']);
const INTERACTION_TYPES = new Set(['none', 'popup', 'label', 'audio', 'link', 'page']);
const CHART_COLUMNS = ['color', 'label', 'value', 'note'];
const CHART_PALETTES = {
  arcane: ['#6aa7ff', '#9b7bff', '#57d7b0', '#e8c66a', '#ff8fa6', '#5ed6ff'],
  ember: ['#ff795e', '#ffad5c', '#ffd166', '#ef476f', '#d85bff', '#8f72ff'],
  nature: ['#3ddc97', '#8bd450', '#d8e35b', '#42c6a5', '#4aa8d8', '#93a8ff'],
  royal: ['#e8c66a', '#c7a6ff', '#78a7ff', '#ff9bae', '#75d7c0', '#f0e7c2'],
  mono: ['#dce9ff', '#b8c9e5', '#91a9ce', '#6f89b3', '#506b94', '#344d72'],
};
const CHART_PALETTE_NAMES = new Set(Object.keys(CHART_PALETTES));
const INLINE_TEXT_COLORS = [
  { name: 'Or', value: '#e8c66a' },
  { name: 'Bleu', value: '#9ec2ff' },
  { name: 'Vert', value: '#69dbb5' },
  { name: 'Rouge', value: '#ff9bae' },
  { name: 'Violet', value: '#c7a6ff' },
  { name: 'Blanc', value: '#eef2fb' },
];
const TEXT_COLOR_PRESETS = INLINE_TEXT_COLORS;
const TEXT_SWATCH_COLUMNS = [
  ['#111827', '#27272a', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8', '#f8fafc'],
  ['#fecdd3', '#fed7aa', '#fef3c7', '#dcfce7', '#bae6fd', '#ddd6fe', '#e9d5ff', '#fbcfe8'],
  ['#fb7185', '#fb923c', '#facc15', '#86efac', '#38bdf8', '#8b5cf6', '#c084fc', '#f472b6'],
  ['#ef4444', '#ea580c', '#ca8a04', '#65a30d', '#0284c7', '#4f46e5', '#9333ea', '#db2777'],
  ['#991b1b', '#9a3412', '#854d0e', '#3f6212', '#075985', '#312e81', '#581c87', '#831843'],
];
const TEXT_RECENT_COLORS = ['#000000', '#eef2fb', '#9ec2ff', '#c8d4e8', '#6aa7ff', '#ffffff', '#dc2626', '#991b1b', '#7f1d1d', '#111827', '#0f172a', '#94a3b8', '#a3a328', '#6f6f1f', '#3f3f16'];
const TEXT_FONTS = [
  { name: 'Cormorant', value: "'Cormorant Garamond', 'Palatino Linotype', serif" },
  { name: 'Outfit', value: "'Outfit', sans-serif" },
  { name: 'Cinzel', value: "'Cinzel', serif" },
  { name: 'Georgia', value: "Georgia, serif" },
  { name: 'Garamond', value: "Garamond, 'Times New Roman', serif" },
  { name: 'Merriweather', value: "'Merriweather', Georgia, serif" },
  { name: 'Arial', value: "Arial, sans-serif" },
  { name: 'Trebuchet', value: "'Trebuchet MS', Arial, sans-serif" },
  { name: 'Verdana', value: "Verdana, sans-serif" },
  { name: 'Tahoma', value: "Tahoma, Geneva, sans-serif" },
  { name: 'Impact', value: "Impact, Haettenschweiler, sans-serif" },
  { name: 'Times', value: "'Times New Roman', Times, serif" },
  { name: 'Palatino', value: "'Palatino Linotype', Palatino, serif" },
  { name: 'Courier', value: "'Courier New', monospace" },
  { name: 'Lucida', value: "'Lucida Console', Monaco, monospace" },
];
const TEXT_FONT_VALUES = new Set(TEXT_FONTS.map((font) => font.value));
const SHAPE_COLOR_PRESETS = [
  { name: 'Bleu nuit', value: '#263957' },
  { name: 'Or', value: '#6f5620' },
  { name: 'Vert', value: '#1f5a49' },
  { name: 'Rouge', value: '#713044' },
  { name: 'Violet', value: '#4a3475' },
  { name: 'Clair', value: '#dce9ff' },
];
const DEFAULT_CHART_ITEMS = [
  { label: 'Force', value: 12, color: '#6aa7ff', note: '' },
  { label: 'Sagesse', value: 8, color: '#57d7b0', note: '' },
  { label: 'Chance', value: 5, color: '#e8c66a', note: '' },
];
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const DEFAULT_SHAPE_FILL = '#263957';
const DEFAULT_SHAPE_STROKE = '#6aa7ff';
const DEFAULT_PAGE_BG = '#0b121d';
const GRID_SIZES = [5, 10, 20, 25, 50];
const EDITOR_ZOOMS = [60, 75, 90, 100, 125];
const PAGE_BACKGROUND_PRESETS = [
  { name: 'Nuit', value: '#0b121d' },
  { name: 'Encre', value: '#07101b' },
  { name: 'Ardoise', value: '#111827' },
  { name: 'Violet', value: '#17112a' },
  { name: 'Foret', value: '#0c1d18' },
  { name: 'Parchemin', value: '#241f18' },
  { name: 'Bordeaux', value: '#24111a' },
  { name: 'Ocean', value: '#071b24' },
  { name: 'Emeraude', value: '#082019' },
  { name: 'Noir', value: '#05070c' },
];
const POPUP_TEMPLATE_IDS = new Set(['center', 'left', 'right', 'round', 'triple', 'blank', 'side-image', 'notice', 'table', 'quote', 'dark']);
const POPUP_LAYOUTS = new Set(['center', 'left', 'right', 'round', 'triple']);
const NAV_STYLES = new Set(['bar', 'menu']);
const NAV_BLOCK_ID = '__free-page-nav__';
const POPUP_FRAME_MIN_W = 240;
const POPUP_FRAME_MIN_H = 170;
const FREE_PAGE_UNLOCK_PREFIX = 'grimorium:free-page:unlock:';
const ROTATION_SNAP_ANGLES = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
const ROTATION_SNAP_THRESHOLD = 5;
const DEFAULT_PASSWORD_MESSAGE = 'Cette diapo est protégée.';
const DEFAULT_PASSWORD_PLACEHOLDER = 'Mot de passe';

let activeFreePageEditor = null;
let documentShortcutsBound = false;
let readerInteractionsBound = false;
let activeReaderTooltip = null;
let sharedFreePageClipboard = null;
let sharedFreePageSlideClipboard = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const normalizeRotation = (value) => {
  let angle = Number(value) || 0;
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return Math.round(angle);
};
const rotationDelta = (angle, target) => Math.abs(normalizeRotation(angle - target));
function snapRotation(value, { forceStep = 0 } = {}) {
  const normalized = normalizeRotation(forceStep ? Math.round((Number(value) || 0) / forceStep) * forceStep : value);
  const snap = ROTATION_SNAP_ANGLES.find((target) => rotationDelta(normalized, target) <= ROTATION_SNAP_THRESHOLD);
  return {
    angle: snap === undefined ? normalized : normalizeRotation(snap),
    snapped: snap !== undefined,
  };
}
const uid = () => `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function safeColor(value, fallback = '#6aa7ff') {
  const raw = String(value || '').trim();
  return HEX_COLOR_RE.test(raw) ? raw : fallback;
}

function safeTextFont(value) {
  const raw = String(value || '').trim();
  return TEXT_FONT_VALUES.has(raw) ? raw : TEXT_FONTS[0].value;
}

function chartColor(value, index = 0, paletteName = 'arcane') {
  const palette = CHART_PALETTES[paletteName] || CHART_PALETTES.arcane;
  return safeColor(value, palette[index % palette.length]);
}

function normalizeRows(rows) {
  const source = Array.isArray(rows) && rows.length ? rows : [
    ['Nom', 'Valeur', 'Note'],
    ['Exemple', '10', ''],
    ['', '', ''],
  ];
  const normalized = source.slice(0, 12).map((row) => {
    const cells = Array.isArray(row) ? row
      : Array.isArray(row?.cells) ? row.cells
        : (row?.cells && typeof row.cells === 'object') ? Object.keys(row.cells)
          .sort((a, b) => Number(String(a).replace(/\D/g, '')) - Number(String(b).replace(/\D/g, '')))
          .map((key) => row.cells[key])
          : [];
    return cells.slice(0, 6).map((cell) => String(cell || '').slice(0, 160));
  }).filter((row) => row.length);
  const width = Math.max(1, Math.min(6, ...normalized.map((row) => row.length)));
  return normalized.map((row) => Array.from({ length: width }, (_, index) => row[index] || ''));
}

function storageSafeRows(rows) {
  return normalizeRows(rows).map((cells) => ({
    cells: cells.reduce((acc, cell, index) => {
      acc[`c${index}`] = cell;
      return acc;
    }, {}),
  }));
}

function normalizeItems(items, paletteName = 'arcane') {
  const source = Array.isArray(items) && items.length ? items : DEFAULT_CHART_ITEMS;
  return source.slice(0, 12).map((item, index) => ({
    label: String(item?.label || `Donnee ${index + 1}`).slice(0, 34),
    value: clamp(item?.value ?? 0, 0, 999),
    color: chartColor(item?.color, index, paletteName),
    note: String(item?.note || '').slice(0, 90),
  }));
}

function normalizeInteraction(raw) {
  const type = INTERACTION_TYPES.has(raw?.type) ? raw.type : 'none';
  const layout = POPUP_LAYOUTS.has(raw?.layout) ? raw.layout : 'center';
  return {
    type,
    title: String(raw?.title || '').slice(0, 80),
    text: sanitizeRichTextHtml(raw?.text || ''),
    target: String(raw?.target || '').slice(0, 420),
    layout,
    frame: normalizePopupFrame(raw?.frame, layout),
    page: hasSingleFreePage(raw?.page) ? normalizeSingleFreePage(raw.page) : null,
  };
}

function normalizeSlide(raw, index = 0, { legacyHtml = '', assets = null } = {}) {
  const pageSource = hasSingleFreePage(raw?.page) ? raw.page : hasSingleFreePage(raw) ? raw : raw?.page;
  const password = String(raw?.password || '').slice(0, 80);
  const requirePassword = raw?.requirePassword === undefined ? Boolean(password) : Boolean(raw?.requirePassword);
  return {
    id: String(raw?.id || uid()),
    title: String(raw?.title || `Diapo ${index + 1}`).slice(0, 64),
    hidden: Boolean(raw?.hidden),
    requirePassword,
    password,
    passwordMessage: String(raw?.passwordMessage || DEFAULT_PASSWORD_MESSAGE).slice(0, 140),
    passwordPlaceholder: String(raw?.passwordPlaceholder || DEFAULT_PASSWORD_PLACEHOLDER).slice(0, 80),
    page: normalizeSingleFreePage(pageSource, { legacyHtml: index === 0 ? legacyHtml : '', assets }),
  };
}

function normalizeFreePageDeck(raw, { legacyHtml = '' } = {}) {
  if (raw?.version === 2 && Array.isArray(raw.slides)) {
    const assets = normalizeFreePageAssets(raw.assets);
    const slides = raw.slides.slice(0, MAX_SLIDES).map((slide, index) => normalizeSlide(slide, index, { assets })).filter(Boolean);
    const safeSlides = slides.length ? slides : [normalizeSlide(null, 0, { legacyHtml, assets })];
    safeSlides.forEach((slide) => hydratePageAssets(slide.page, assets));
    const activeSlideId = safeSlides.some((slide) => slide.id === raw.activeSlideId) ? raw.activeSlideId : safeSlides[0].id;
    return {
      version: 2,
      id: String(raw.id || uid()),
      activeSlideId,
      canBrowse: raw.canBrowse !== false,
      grid: normalizeDeckGrid(raw.grid),
      nav: normalizeDeckNav(raw.nav, safeSlides),
      assets,
      slides: safeSlides,
    };
  }
  const slide = normalizeSlide({ id: 'slide-1', title: 'Diapo 1', page: raw }, 0, { legacyHtml });
  return { version: 2, id: String(raw?.id || uid()), activeSlideId: slide.id, canBrowse: true, grid: normalizeDeckGrid(null), nav: normalizeDeckNav(null, [slide]), assets: {}, slides: [slide] };
}

function normalizeFreePageAssets(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.entries(raw).slice(0, 80).forEach(([key, value]) => {
    const id = String(key || '').slice(0, 48);
    const src = safeImageUrl(value);
    if (id && src) out[id] = src;
  });
  return out;
}

function hydratePageAssets(page, assets) {
  if (!page?.blocks?.length || !assets) return page;
  page.blocks.forEach((block) => {
    if (block?.type === 'image' && !block.src && block.assetId && assets[block.assetId]) {
      block.src = safeImageUrl(assets[block.assetId]);
    }
    const interactionPage = block?.interaction?.page;
    if (interactionPage) hydratePageAssets(interactionPage, assets);
  });
  return page;
}

function normalizeDeckGrid(raw) {
  const size = GRID_SIZES.includes(Number(raw?.size)) ? Number(raw.size) : 10;
  return {
    show: Boolean(raw?.show),
    safe: Boolean(raw?.safe),
    snap: raw?.snap !== false,
    size,
  };
}

function normalizeDeckNav(raw, slides = []) {
  const ids = slides.map((slide) => slide.id);
  const style = NAV_STYLES.has(raw?.style) ? raw.style : 'bar';
  const fallback = style === 'menu'
    ? { x: 928, y: DEFAULT_HEIGHT - 64, w: 44, h: 44 }
    : { x: 170, y: DEFAULT_HEIGHT - 58, w: 660, h: 42 };
  const w = clamp(raw?.w ?? fallback.w, style === 'menu' ? 44 : 220, PAGE_WIDTH);
  const h = clamp(raw?.h ?? fallback.h, 34, 180);
  const filterIds = (values, fallback) => {
    const source = Array.isArray(values) ? values.map(String) : fallback;
    return source.filter((id, index, list) => ids.includes(id) && list.indexOf(id) === index);
  };
  return {
    enabled: Boolean(raw?.enabled),
    style,
    label: String(raw?.label || 'Menu').slice(0, 40),
    x: Math.round(clamp(raw?.x ?? fallback.x, 0, PAGE_WIDTH - w)),
    y: Math.round(clamp(raw?.y ?? fallback.y, 0, DEFAULT_HEIGHT - h)),
    w: Math.round(w),
    h: Math.round(h),
    z: clamp(raw?.z ?? 1200, 0, 1400),
    targetSlideIds: filterIds(raw?.targetSlideIds, ids),
    visibleSlideIds: filterIds(raw?.visibleSlideIds, ids),
  };
}

function hasDeck(raw) {
  return raw?.version === 2 && Array.isArray(raw.slides);
}

function hasSingleFreePage(raw) {
  return raw?.version === 1 && Array.isArray(raw.blocks);
}

function defaultPopupFrame(layout = 'center') {
  if (layout === 'left') return { x: 0, y: 0, w: 380, h: DEFAULT_HEIGHT, locked: true };
  if (layout === 'right') return { x: 620, y: 0, w: 380, h: DEFAULT_HEIGHT, locked: true };
  if (layout === 'round') return { x: 230, y: 45, w: 540, h: 540, locked: true };
  if (layout === 'triple') return { x: 40, y: 315, w: 920, h: 295, locked: true };
  return { x: 140, y: 54, w: 720, h: 420, locked: true };
}

function normalizePopupFrame(raw, layout = 'center') {
  const fallback = defaultPopupFrame(layout);
  const w = clamp(raw?.w ?? fallback.w, POPUP_FRAME_MIN_W, PAGE_WIDTH);
  const h = clamp(raw?.h ?? fallback.h, POPUP_FRAME_MIN_H, DEFAULT_HEIGHT);
  return {
    x: Math.round(clamp(raw?.x ?? fallback.x, 0, PAGE_WIDTH - w)),
    y: Math.round(clamp(raw?.y ?? fallback.y, 0, DEFAULT_HEIGHT - h)),
    w: Math.round(w),
    h: Math.round(h),
    locked: raw?.locked !== false,
  };
}

function defaultPopupPage(template = 'blank') {
  const safeTemplate = POPUP_TEMPLATE_IDS.has(template) ? template : 'blank';
  if (['center', 'left', 'right'].includes(safeTemplate)) {
    const isPanel = safeTemplate === 'left' || safeTemplate === 'right';
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: DEFAULT_HEIGHT,
      blocks: [
        isPanel
          ? popupShape(0, 0, 1000, DEFAULT_HEIGHT, '#101a2a', '#6aa7ff', 1, 0)
          : popupShape(50, 45, 900, 345, '#101a2a', '#6aa7ff', 1, 18),
        popupText(isPanel ? 90 : 115, isPanel ? 90 : 105, isPanel ? 820 : 770, isPanel ? 420 : 210, `<h3>${safeTemplate === 'center' ? 'Fenetre centree' : safeTemplate === 'left' ? 'Panneau gauche' : 'Panneau droit'}</h3><p>Compose le contenu de cette fenetre comme une diapo autonome.</p>`, 23, '#eef2fb', 'none'),
      ],
    };
  }
  if (safeTemplate === 'round') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: DEFAULT_HEIGHT,
      blocks: [
        popupShape(190, 55, 620, 510, '#101a2a', '#e8c66a', 2, 80),
        popupText(285, 190, 430, 180, '<h3>Fenetre ronde</h3><p>Parfaite pour un focus, un indice ou une revelation courte.</p>', 24, '#f3d879', 'none'),
      ],
    };
  }
  if (safeTemplate === 'triple') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: DEFAULT_HEIGHT,
      blocks: [
        popupShape(45, 70, 280, 270, '#101a2a', '#6aa7ff', 1, 16),
        popupShape(360, 70, 280, 270, '#101a2a', '#9b7bff', 1, 16),
        popupShape(675, 70, 280, 270, '#101a2a', '#57d7b0', 1, 16),
        popupText(82, 142, 205, 115, '<h3>Choix 1</h3><p>Premier bloc.</p>', 19, '#eef2fb', 'none'),
        popupText(397, 142, 205, 115, '<h3>Choix 2</h3><p>Deuxieme bloc.</p>', 19, '#eef2fb', 'none'),
        popupText(712, 142, 205, 115, '<h3>Choix 3</h3><p>Troisieme bloc.</p>', 19, '#eef2fb', 'none'),
      ],
    };
  }
  if (safeTemplate === 'side-image') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: 520,
      blocks: [
        popupShape(46, 42, 908, 436, '#111a29', '#6aa7ff', 1, 14),
        popupShape(86, 95, 300, 285, '#dce4f2', '#b9c4d8', 1, 10),
        popupText(150, 205, 170, 70, '<p style="text-align:center;color:#5d6677">Image</p>', 20, '#5d6677', 'none'),
        popupText(430, 96, 455, 285, '<h3>Titre de la fenetre</h3><p>Place ici le contenu detaille, les notes ou les consignes.</p><ul><li>Point important</li><li>Information secondaire</li></ul>', 19, '#eef2fb', 'none'),
      ],
    };
  }
  if (safeTemplate === 'notice') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: 420,
      blocks: [
        popupShape(145, 78, 710, 260, '#18233a', '#e8c66a', 2, 18),
        popupText(205, 128, 590, 155, '<h3>Information importante</h3><p>Une fenetre courte pour annoncer une revelation, une recompense ou une consequence.</p>', 22, '#f3d879', 'none'),
      ],
    };
  }
  if (safeTemplate === 'table') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: 520,
      blocks: [
        popupText(72, 60, 850, 70, '<h3>Tableau de suivi</h3>', 24, '#e8c66a', 'none'),
        popupTable(100, 150, 800, 240),
      ],
    };
  }
  if (safeTemplate === 'quote') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: 420,
      blocks: [
        popupShape(120, 95, 760, 210, '#101923', '#6aa7ff', 1, 12),
        popupText(175, 143, 650, 110, '<blockquote>Une phrase, une rumeur, une vision ou un fragment d\'archive.</blockquote>', 23, '#c8d4e8', 'none'),
      ],
    };
  }
  if (safeTemplate === 'dark') {
    return {
      version: 1,
      width: PAGE_WIDTH,
      height: 520,
      blocks: [
        popupShape(0, 0, 1000, 520, '#070b13', '#070b13', 0, 0),
        popupShape(86, 76, 828, 346, '#101826', '#9b7bff', 1, 10),
        popupText(135, 118, 730, 210, '<h3>Fenetre dramatique</h3><p>Un format sombre pour une scene, un secret ou une consequence majeure.</p>', 22, '#eef2fb', 'none'),
      ],
    };
  }
  return {
    version: 1,
    width: PAGE_WIDTH,
    height: 420,
    blocks: [{
      id: uid(),
      type: 'text',
      x: 80,
      y: 70,
      w: 840,
      h: 190,
      z: 1,
      opacity: 100,
      groupId: '',
      interaction: { type: 'none', title: '', text: '', target: '' },
      content: '<h3>Nouvelle fenetre</h3><p>Compose ici le contenu de la fenetre.</p>',
      align: 'left',
      fontSize: 20,
      color: 'default',
      textColor: '#eef2fb',
      surface: 'soft',
    }],
  };
}

function popupText(x, y, w, h, content, fontSize = 20, textColor = '#eef2fb', surface = 'soft') {
  return {
    id: uid(), type: 'text', x, y, w, h, z: 2, opacity: 100, groupId: '',
    interaction: { type: 'none', title: '', text: '', target: '' },
    content, align: 'left', fontSize, color: 'default', textColor, surface,
  };
}

function popupShape(x, y, w, h, fill, stroke, strokeWidth = 1, radius = 12) {
  return {
    id: uid(), type: 'shape', x, y, w, h, z: 1, opacity: 100, groupId: '',
    interaction: { type: 'none', title: '', text: '', target: '' },
    shape: 'rectangle', fill, stroke, strokeWidth, radius,
  };
}

function popupTable(x, y, w, h) {
  return {
    id: uid(), type: 'table', x, y, w, h, z: 2, opacity: 100, groupId: '',
    interaction: { type: 'none', title: '', text: '', target: '' },
    rows: [['Nom', 'Valeur', 'Note'], ['Exemple', '10', ''], ['', '', '']], header: true,
  };
}

function normalizeBlock(raw, index, pageHeight) {
  if (!raw || !BLOCK_TYPES.has(raw.type)) return null;
  const type = raw.type;
  const minW = type === 'image' ? 120 : type === 'chart' ? 260 : type === 'shape' ? 40 : 180;
  const minH = type === 'image' ? 100 : type === 'chart' ? 170 : type === 'shape' ? 20 : 90;
  const w = clamp(raw.w, minW, PAGE_WIDTH);
  const h = clamp(raw.h, minH, pageHeight);
  const block = {
    id: String(raw.id || uid()),
    type,
    x: Math.round(clamp(raw.x, 0, PAGE_WIDTH - w)),
    y: Math.round(clamp(raw.y, 0, pageHeight - h)),
    w: Math.round(w),
    h: Math.round(h),
    z: clamp(raw.z ?? index + 1, 1, 999),
    rotation: Math.round(clamp(raw.rotation ?? 0, -180, 180)),
    opacity: clamp(raw.opacity ?? 100, 15, 100),
    locked: Boolean(raw.locked),
    hidden: Boolean(raw.hidden),
    groupId: raw.groupId ? String(raw.groupId).slice(0, 40) : '',
    interaction: normalizeInteraction(raw.interaction),
  };
  if (type === 'text') {
    block.content = sanitizeRichTextHtml(raw.content || '');
    block.align = ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'left';
    block.fontSize = clamp(raw.fontSize || 18, 1, 96);
    block.color = TEXT_COLORS.has(raw.color) ? raw.color : 'default';
    block.textColor = safeColor(raw.textColor, legacyTextColor(block.color));
    block.fontFamily = safeTextFont(raw.fontFamily);
    block.textTransform = raw.textTransform === 'uppercase' ? 'uppercase' : 'none';
    block.surface = TEXT_SURFACES.has(raw.surface) ? raw.surface : 'none';
  } else if (type === 'image') {
    block.assetId = raw.assetId ? String(raw.assetId).slice(0, 48) : '';
    block.src = safeImageUrl(raw.src) || (block.assetId && raw.__assets ? safeImageUrl(raw.__assets[block.assetId]) : '');
    block.fit = raw.fit === 'cover' ? 'cover' : 'contain';
    block.alt = String(raw.alt || '').slice(0, 140);
    block.cropX = clamp(raw.cropX ?? 50, 0, 100);
    block.cropY = clamp(raw.cropY ?? 50, 0, 100);
    block.zoom = clamp(raw.zoom ?? 100, 100, 220);
    block.imageAspect = clamp(raw.imageAspect ?? raw.aspect ?? 1, .05, 20);
    block.cropModel = raw.cropModel === 'rect' ? 'rect' : '';
    const imageW = clamp(raw.imageW ?? block.zoom, 1, 900);
    const imageH = clamp(raw.imageH ?? block.zoom, 1, 900);
    block.imageW = Math.round(imageW);
    block.imageH = Math.round(imageH);
    block.imageX = Math.round(clamp(raw.imageX ?? ((100 - imageW) * block.cropX / 100), -260, 260));
    block.imageY = Math.round(clamp(raw.imageY ?? ((100 - imageH) * block.cropY / 100), -260, 260));
  } else if (type === 'table') {
    block.rows = normalizeRows(raw.rows);
    block.header = raw.header !== false;
    block.fontSize = clamp(raw.fontSize || 14, 10, 28);
    block.textColor = safeColor(raw.textColor, '#c8d4e8');
    block.headerColor = safeColor(raw.headerColor, '#e8c66a');
    block.borderColor = safeColor(raw.borderColor, '#263957');
  } else if (type === 'chart') {
    block.title = String(raw.title ?? 'Graphique').slice(0, 80);
    block.chartType = CHART_TYPES.has(raw.chartType) ? raw.chartType : 'bar';
    block.chartPalette = CHART_PALETTE_NAMES.has(raw.chartPalette) ? raw.chartPalette : 'arcane';
    block.showChartBackground = raw.showChartBackground !== false;
    block.showChartFrame = raw.showChartFrame !== false;
    block.showLegend = raw.showLegend !== false;
    block.showLabels = raw.showLabels !== false;
    block.showTooltips = raw.showTooltips !== false;
    block.showValues = raw.showValues !== false;
    block.chartColumnCount = clamp(raw.chartColumnCount || CHART_COLUMNS.length, 2, CHART_COLUMNS.length);
    block.items = normalizeItems(raw.items, block.chartPalette);
  } else if (type === 'shape') {
    block.shape = raw.shape === 'rounded' || raw.shape === 'pill' ? 'rectangle' : SHAPE_TYPES.has(raw.shape) ? raw.shape : 'rectangle';
    block.fill = safeColor(raw.fill, DEFAULT_SHAPE_FILL);
    block.stroke = safeColor(raw.stroke, DEFAULT_SHAPE_STROKE);
    block.strokeWidth = clamp(raw.strokeWidth ?? 2, 0, 12);
    block.radius = clamp(raw.radius ?? (raw.shape === 'rounded' || raw.shape === 'pill' ? 28 : 12), 0, 80);
    block.shadow = Boolean(raw.shadow);
    block.shadowDepth = clamp(raw.shadowDepth ?? 22, 4, 80);
  }
  return block;
}

function normalizeSingleFreePage(raw, { legacyHtml = '', assets = null } = {}) {
  const sourceHeight = clamp(raw?.height || DEFAULT_HEIGHT, 420, 1400);
  const height = DEFAULT_HEIGHT;
  const background = safeColor(raw?.background, DEFAULT_PAGE_BG);
  let blocks = Array.isArray(raw?.blocks)
    ? raw.blocks.map((block, index) => {
      const normalized = normalizeBlock(block && assets ? { ...block, __assets: assets } : block, index, sourceHeight);
      if (!normalized || sourceHeight === height) return normalized;
      const ratio = height / sourceHeight;
      normalized.y = Math.round(normalized.y * ratio);
      normalized.h = Math.round(Math.max(20, normalized.h * ratio));
      normalized.y = Math.min(normalized.y, Math.max(0, height - normalized.h));
      normalized.h = Math.min(normalized.h, height);
      return normalized;
    }).filter(Boolean)
    : [];
  if (!blocks.length && legacyHtml) {
    blocks = [{
      id: uid(), type: 'text', x: 55, y: 45, w: 890, h: Math.min(520, height - 90), z: 1,
      opacity: 100, groupId: '', interaction: normalizeInteraction(),
      content: sanitizeRichTextHtml(legacyHtml), align: 'left', fontSize: 18, color: 'default', textColor: '#eef2fb', surface: 'none',
    }];
  }
  return { version: 1, width: PAGE_WIDTH, height, background, blocks: blocks.slice(0, MAX_BLOCKS) };
}

export function normalizeFreePage(raw, { legacyHtml = '' } = {}) {
  return hasDeck(raw) ? normalizeFreePageDeck(raw, { legacyHtml }) : normalizeSingleFreePage(raw, { legacyHtml });
}

export function hasFreePage(raw) {
  return hasSingleFreePage(raw) || hasDeck(raw);
}

export function freePageToLegacyHtml(raw) {
  const deck = normalizeFreePageDeck(raw);
  return (deck.slides[0]?.page || normalizeSingleFreePage(raw)).blocks
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)
    .map((block) => block.type === 'text' ? block.content : '')
    .join('');
}

function visibleSlides(deck) {
  return normalizeFreePageDeck(deck).slides.filter((slide) => !slide.hidden);
}

function defaultReaderSlide(deck) {
  return visibleSlides(deck)[0] || normalizeFreePageDeck(deck).slides[0];
}

function slideRequiresPassword(slide) {
  return Boolean(slide?.requirePassword && slide.password);
}

function slidePasswordHash(value) {
  const raw = String(value || '');
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function slideUnlockKey(deck, slide) {
  return `${FREE_PAGE_UNLOCK_PREFIX}${String(deck?.id || 'deck')}:${String(slide?.id || 'slide')}:${slidePasswordHash(slide?.password)}`;
}

function isSlideUnlocked(deck, slide) {
  if (!slideRequiresPassword(slide)) return true;
  try { return localStorage.getItem(slideUnlockKey(deck, slide)) === '1'; } catch { return false; }
}

function unlockSlide(deck, slide) {
  if (!slideRequiresPassword(slide)) return;
  try { localStorage.setItem(slideUnlockKey(deck, slide), '1'); } catch { /* localStorage peut etre indisponible */ }
}

function readerStageHtml(deck, slide, previousId = '') {
  const normalized = normalizeSingleFreePage(slide.page);
  const locked = !isSlideUnlocked(deck, slide);
  return `<div class="free-page-stage free-page-stage--reader ${locked ? 'is-locked-slide' : ''}" style="${stageStyle(normalized)}">
    ${locked ? readerLockedSlideHtml(slide, previousId) : normalized.blocks.map((block) => blockHtml(block, normalized.height, false)).join('')}
    ${locked ? '' : deckNavHtml(deck, slide.id)}
  </div>`;
}

function readerLockedSlideHtml(slide, previousId = '') {
  return `<form class="free-page-reader-lock" data-fpe-reader-unlock>
    <div class="free-page-reader-lock-icon">Verrou</div>
    <h3>${_esc(slide.title || 'Diapo protégée')}</h3>
    <p>${_esc(slide.passwordMessage || DEFAULT_PASSWORD_MESSAGE)}</p>
    <div class="free-page-reader-lock-row">
      <input type="password" data-fpe-reader-password autocomplete="off" placeholder="${_esc(slide.passwordPlaceholder || DEFAULT_PASSWORD_PLACEHOLDER)}">
      <button type="submit">Déverrouiller</button>
    </div>
    <small data-fpe-reader-lock-error hidden>Mot de passe incorrect.</small>
    ${previousId ? `<button type="button" class="free-page-reader-back" data-fpe-reader-slide="${_esc(previousId)}">Revenir à la diapo précédente</button>` : ''}
  </form>`;
}

function readerNavHtml(deck, currentId, previousId = '') {
  const slides = visibleSlides(deck);
  if (deck.canBrowse === false || slides.length <= 1) return '';
  const index = Math.max(0, slides.findIndex((slide) => slide.id === currentId));
  const prev = slides[index - 1] || null;
  const next = slides[index + 1] || null;
  return `<div class="free-page-reader-nav" data-fpe-reader-nav>
    <button type="button" data-fpe-reader-slide="${_esc(prev?.id || '')}" ${prev ? '' : 'disabled'} aria-label="Diapo precedente">‹</button>
    <div class="free-page-reader-dots">
      ${slides.map((slide, dotIndex) => `<button type="button" class="${slide.id === currentId ? 'is-active' : ''}" data-fpe-reader-slide="${_esc(slide.id)}" title="${_esc(slide.title || `Diapo ${dotIndex + 1}`)}">${dotIndex + 1}</button>`).join('')}
    </div>
    <button type="button" data-fpe-reader-slide="${_esc(next?.id || '')}" ${next ? '' : 'disabled'} aria-label="Diapo suivante">›</button>
    ${previousId && !slides.some((slide) => slide.id === previousId) ? `<button type="button" data-fpe-reader-slide="${_esc(previousId)}">Retour</button>` : ''}
  </div>`;
}

export function renderFreePageHtml({ page, legacyHtml = '', className = '', keyboard = false } = {}) {
  if (!hasFreePage(page)) return '';
  ensureReaderInteractions();
  const deck = normalizeFreePageDeck(page, { legacyHtml });
  const slide = defaultReaderSlide(deck);
  const normalized = slide.page;
  return `<div class="free-page-reader ${_esc(className)}" data-free-page-reader ${keyboard ? 'data-free-page-keyboard' : ''} data-free-page-current-slide="${_esc(slide.id)}" data-free-page-previous-slide="" data-free-page-deck="${_esc(JSON.stringify(deck))}" style="--free-page-ratio:${PAGE_WIDTH}/${normalized.height}">
    ${readerStageHtml(deck, slide)}
    ${readerNavHtml(deck, slide.id)}
  </div>`;
}

export function freePageEditorHtml({ id = 'free-page-editor', page, legacyHtml = '' } = {}) {
  const deck = normalizeFreePageDeck(page, { legacyHtml });
  const normalized = deck.slides.find((slide) => slide.id === deck.activeSlideId)?.page || deck.slides[0].page;
  const grid = normalizeDeckGrid(deck.grid);
  return `<div class="free-page-editor" id="${_esc(id)}" data-free-page-editor tabindex="-1" style="--free-page-ratio:${PAGE_WIDTH}/${normalized.height};--free-page-editor-zoom:1">
    <textarea data-fpe-initial hidden>${_esc(JSON.stringify(deck))}</textarea>
    <div class="free-page-toolbar" role="toolbar" aria-label="Outils de composition">
      <div class="free-page-toolbar-group">
        <button type="button" class="free-page-tool free-page-tool--primary" data-fpe-action="add-text">+ Texte</button>
        <button type="button" class="free-page-tool" data-fpe-action="add-image">Image</button>
        <button type="button" class="free-page-tool" data-fpe-action="add-table">Tableau</button>
        <button type="button" class="free-page-tool" data-fpe-action="add-chart">Graphique</button>
        <button type="button" class="free-page-tool free-page-tool--shape" data-fpe-action="toggle-shape-popover" title="Formes" aria-label="Formes">&#9633;</button>
        <button type="button" class="free-page-tool" data-fpe-action="add-nav">Menu</button>
      </div>
      <div class="free-page-toolbar-group free-page-toolbar-group--text" data-fpe-text-toolbar>
        <select class="free-page-toolbar-font" data-fpe-inspector-field="fontFamily" title="Police">${fontOptionsHtml()}</select>
        <input class="free-page-toolbar-size" type="number" min="1" max="96" value="18" data-fpe-inspector-field="fontSize" title="Taille du texte">
        <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="bold" title="Gras"><b>G</b></button>
        <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="italic" title="Italique"><i>I</i></button>
        <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="underline" title="Souligner"><u>S</u></button>
        <button type="button" class="free-page-tool free-page-tool--icon free-page-text-case" data-fpe-inspector-field="textTransform" value="toggle" title="Majuscules / normal">Tt</button>
        <button type="button" class="free-page-tool free-page-tool--icon free-page-toolbar-color-button" data-fpe-action="toggle-text-color-popover" title="Couleur du texte"><span>A</span><i style="--fpe-active-color:#eef2fb"></i></button>
      </div>
      <div class="free-page-toolbar-group">
        <button type="button" class="free-page-tool free-page-tool--position" data-fpe-action="toggle-position-popover" title="Placer sur la diapo" aria-label="Placer sur la diapo"><span></span></button>
        <button type="button" class="free-page-tool" data-fpe-action="undo" title="Annuler">Annuler</button>
        <button type="button" class="free-page-tool" data-fpe-action="redo" title="Retablir">Retablir</button>
      </div>
      <div class="free-page-toolbar-group free-page-toolbar-group--view">
        <label class="free-page-toggle">Grille <input type="checkbox" data-fpe-grid-field="show" ${grid.show ? 'checked' : ''}></label>
        <label class="free-page-toggle" title="Affiche une marge de securite pour eviter les bords trop charges">Zone sure <input type="checkbox" data-fpe-grid-field="safe" ${grid.safe ? 'checked' : ''}></label>
        <label class="free-page-toggle" title="Colle les blocs aux pas de la grille pendant les déplacements et redimensionnements">Aligner sur grille <input type="checkbox" data-fpe-grid-field="snap" ${grid.snap ? 'checked' : ''}></label>
        <select class="free-page-select free-page-select--compact" data-fpe-grid-field="size" title="Taille de grille">
          ${GRID_SIZES.map((size) => `<option value="${size}" ${grid.size === size ? 'selected' : ''}>${size}px</option>`).join('')}
        </select>
        <select class="free-page-select free-page-select--compact" data-fpe-editor-field="zoom" title="Zoom d'edition">
          ${EDITOR_ZOOMS.map((zoom) => `<option value="${zoom}" ${zoom === 100 ? 'selected' : ''}>${zoom}%</option>`).join('')}
        </select>
        <button type="button" class="free-page-tool" data-fpe-action="fit-zoom" title="Adapter la diapo a l'espace disponible">Adapter</button>
      </div>
      <div class="free-page-shape-popover" data-fpe-shape-popover hidden>${shapePopoverHtml()}</div>
      <div class="free-page-position-popover" data-fpe-position-popover hidden>${positionPopoverHtml()}</div>
      <div class="free-page-text-color-popover" data-fpe-text-color-popover hidden>${textColorPopoverHtml()}</div>
      <div class="free-page-toolbar-spacer"></div>
      <button type="button" class="free-page-tool free-page-tool--primary" data-fpe-action="preview-deck" title="Tester le rendu et les interactions">Apercu</button>
      <span class="free-page-slide-size">Diapo 1000 x ${DEFAULT_HEIGHT}</span>
    </div>
    <div class="free-page-body">
      <aside class="free-page-slidebar" data-fpe-slides></aside>
      <div class="free-page-workspace">
        <div class="free-page-ruler"><span>Zone de composition</span><small>Deplace et redimensionne les blocs</small></div>
        <div class="free-page-stage" data-fpe-stage data-fpe-composition style="${stageStyle(normalized)}"></div>
      </div>
      <aside class="free-page-inspector" data-fpe-inspector></aside>
    </div>
    <div class="free-page-context-menu" data-fpe-context-menu hidden></div>
  </div>`;
}

export function bindFreePageEditor(root) {
  const editors = root?.matches?.('[data-free-page-editor]')
    ? [root]
    : [...(root?.querySelectorAll?.('[data-free-page-editor]') || [])];
  editors.forEach(bindSingleFreePageEditor);
}

function bindSingleFreePageEditor(editor) {
  if (!editor || editor.__freePageBound) return;
  editor.__freePageBound = true;
  let initial = null;
  try { initial = JSON.parse(editor.querySelector('[data-fpe-initial]')?.value || '{}'); } catch { initial = {}; }
  editor.__freePageDeck = normalizeFreePageDeck(initial);
  editor.__freePageSlideId = editor.__freePageDeck.activeSlideId;
  editor.__freePageState = currentSlide(editor)?.page || normalizeSingleFreePage();
  editor.__freePageSelected = null;
  editor.__freePageSelectedIds = [];
  editor.__freePageClipboard = null;
  editor.__freePageUndo = [];
  editor.__freePageRedo = [];
  editor.__freePageHistoryTimer = null;
  editor.__freePageInspectorTab = 'content';
  editor.__freePageFoldState = {};
  editor.__freePageCropBlockId = null;
  ensureDocumentShortcuts();
  activateFreePageEditor(editor);
  editor.addEventListener('pointerdown', (event) => {
    if (!isOwnEditorEvent(editor, event)) return;
    activateFreePageEditor(editor);
    if (event.target.closest('[data-fpe-inspector], [data-fpe-text-toolbar]')) saveEditorTextSelection(editor, { paint: true });
    if (!event.target.closest('[contenteditable="true"], input, textarea, select, button')) editor.focus({ preventScroll: true });
  }, true);
  editor.addEventListener('focusin', (event) => { if (isOwnEditorEvent(editor, event)) activateFreePageEditor(editor); });
  editor.addEventListener('click', (event) => { if (isOwnEditorEvent(editor, event)) handleEditorClick(editor, event); });
  editor.addEventListener('dblclick', (event) => { if (isOwnEditorEvent(editor, event)) handleEditorDoubleClick(editor, event); });
  editor.addEventListener('change', (event) => { if (isOwnEditorEvent(editor, event)) handleEditorChange(editor, event); });
  editor.addEventListener('input', (event) => { if (isOwnEditorEvent(editor, event)) handleEditorInput(editor, event); });
  editor.addEventListener('keyup', (event) => { if (isOwnEditorEvent(editor, event)) saveEditorTextSelection(editor); });
  editor.addEventListener('mouseup', (event) => { if (isOwnEditorEvent(editor, event)) saveEditorTextSelection(editor); });
  editor.addEventListener('focusout', (event) => { if (isOwnEditorEvent(editor, event)) handleEditorFocusOut(editor, event); });
  editor.addEventListener('contextmenu', (event) => { if (isOwnEditorEvent(editor, event)) handleContextMenu(editor, event); });
  editor.addEventListener('pointerdown', (event) => { if (isOwnEditorEvent(editor, event)) handlePointerDown(editor, event); });
  editor.addEventListener('dragstart', (event) => { if (isOwnEditorEvent(editor, event)) handleSlideDragStart(editor, event); });
  editor.addEventListener('dragover', (event) => { if (isOwnEditorEvent(editor, event)) handleSlideDragOver(editor, event); });
  editor.addEventListener('drop', (event) => { if (isOwnEditorEvent(editor, event)) handleSlideDrop(editor, event); });
  editor.addEventListener('dragend', (event) => { if (isOwnEditorEvent(editor, event)) clearSlideDragState(editor); });
  editor.addEventListener('mousedown', (event) => {
    if (!isOwnEditorEvent(editor, event)) return;
    if (event.target.closest('[data-fpe-inspector], [data-fpe-text-toolbar]')) saveEditorTextSelection(editor, { paint: true });
    if (event.target.closest('[data-fpe-command], [data-fpe-text-color]')) event.preventDefault();
  });
  renderBlocks(editor, null);
}

function handleEditorDoubleClick(editor, event) {
  const imageBlock = event.target.closest('.free-page-block--image[data-fpe-block]');
  if (!imageBlock) return;
  event.preventDefault();
  setSelected(editor, imageBlock.dataset.fpeBlock);
  runAction(editor, 'crop-image', event);
}

function isOwnEditorEvent(editor, event) {
  return event.target?.closest?.('[data-free-page-editor]') === editor;
}

export function getFreePageData(root) {
  const editor = root?.matches?.('[data-free-page-editor]') ? root : root?.querySelector?.('[data-free-page-editor]');
  if (!editor?.__freePageState) return null;
  syncLiveBlock(editor);
  syncInteractionPageEditor(editor);
  if (editor.__freePagePopupEdit?.rootState) {
    const session = editor.__freePagePopupEdit;
    const deck = structuredClone(session.rootDeck || editor.__freePageDeck || normalizeFreePageDeck(session.rootState));
    const slide = deck.slides.find((item) => item.id === session.rootSlideId);
    if (slide) slide.page = normalizeSingleFreePage(session.rootState);
    return serializeFreePageForStorage(normalizeFreePageDeck(deck));
  }
  syncCurrentSlide(editor);
  return serializeFreePageForStorage(normalizeFreePageDeck(structuredClone(editor.__freePageDeck)));
}

function serializeFreePageForStorage(deck) {
  const safeDeck = normalizeFreePageDeck(deck);
  const assets = {};
  const srcToAssetId = new Map();
  safeDeck.slides = safeDeck.slides.map((slide) => ({
    ...slide,
    page: serializeSinglePageForStorage(slide.page, assets, srcToAssetId),
  }));
  if (Object.keys(assets).length) safeDeck.assets = assets;
  else delete safeDeck.assets;
  return safeDeck;
}

function serializeSinglePageForStorage(page, assets = {}, srcToAssetId = new Map()) {
  const safePage = normalizeSingleFreePage(page);
  safePage.blocks = safePage.blocks.map((block) => serializeBlockForStorage(block, assets, srcToAssetId));
  return safePage;
}

function serializeBlockForStorage(block, assets = {}, srcToAssetId = new Map()) {
  const safeBlock = { ...block };
  if (safeBlock.type === 'table') safeBlock.rows = storageSafeRows(safeBlock.rows);
  if (safeBlock.type === 'image') packImageBlockForStorage(safeBlock, assets, srcToAssetId);
  const interaction = normalizeInteraction(safeBlock.interaction);
  safeBlock.interaction = {
    ...interaction,
    page: interaction.page ? serializeSinglePageForStorage(interaction.page, assets, srcToAssetId) : null,
  };
  return safeBlock;
}

function packImageBlockForStorage(block, assets, srcToAssetId) {
  const src = safeImageUrl(block.src);
  if (!src) {
    delete block.src;
    return;
  }
  if (!isDataImageUrl(src)) {
    block.src = src;
    return;
  }
  let assetId = block.assetId && assets[block.assetId] === src ? block.assetId : srcToAssetId.get(src);
  if (!assetId) {
    const baseId = block.assetId || `img_${hashString(src).toString(36)}`;
    assetId = baseId;
    let suffix = 1;
    while (assets[assetId] && assets[assetId] !== src) {
      assetId = `${baseId}_${suffix}`;
      suffix += 1;
    }
    assets[assetId] = src;
    srcToAssetId.set(src, assetId);
  }
  block.assetId = assetId;
  delete block.src;
}

// Recompresse toutes les images base64 d'un deck (elles vivent dans deck.assets
// après sérialisation) pour faire tenir la page sous la limite Firestore (1 Mo/
// doc). Dernier recours au moment d'enregistrer : mieux vaut une image un peu
// plus compressée qu'un échec d'écriture. Renvoie un NOUVEAU deck (l'original
// n'est pas muté). Les URLs distantes et data:SVG sont laissées intactes.
export async function compressFreePageImages(deck, { max = 900, quality = 0.6 } = {}) {
  if (!deck || typeof deck !== 'object' || !deck.assets || typeof deck.assets !== 'object') return deck;
  const out = structuredClone(deck);
  for (const [id, src] of Object.entries(out.assets)) {
    if (typeof src !== 'string' || !/^data:image\/(?:png|jpe?g|gif|webp|avif)/i.test(src)) continue;
    try {
      // Transparence PRÉSERVÉE : les images à alpha passent par le WebP lossy
      // (compressTransparentDataUrl) au lieu du JPEG (compressDataUrl) qui
      // aplatirait le fond → sinon le garde-fou de taille détruisait l'alpha.
      const smaller = await imageHasTransparency(src)
        ? await compressTransparentDataUrl(src, max, quality)
        : await compressDataUrl(src, { max, quality });
      if (smaller && smaller.length < src.length) out.assets[id] = smaller;
    } catch { /* on garde l'original si la recompression échoue */ }
  }
  return out;
}

function activateFreePageEditor(editor) {
  if (editor?.isConnected) activeFreePageEditor = editor;
}

function ensureDocumentShortcuts() {
  if (documentShortcutsBound) return;
  documentShortcutsBound = true;
  document.addEventListener('keydown', handleDocumentShortcut, true);
  document.addEventListener('copy', handleDocumentCopy, true);
  document.addEventListener('cut', handleDocumentCut, true);
  document.addEventListener('paste', handleDocumentPaste, true);
  document.addEventListener('selectionchange', () => {
    if (activeFreePageEditor?.isConnected) saveEditorTextSelection(activeFreePageEditor);
  });
}

function handleDocumentCopy(event) {
  const editor = activeFreePageEditor;
  const target = event.target instanceof Element ? event.target : null;
  if (!editor?.isConnected) return;
  const slideThumb = target?.closest('[data-fpe-slide-id]');
  if (slideThumb && editor.__freePageDeck && !isNativeEditingContext(target)) {
    const slide = editor.__freePageDeck.slides.find((item) => item.id === slideThumb.dataset.fpeSlideId);
    const payload = copySlideToClipboard(slide);
    if (!payload) return;
    try {
      event.clipboardData?.setData('application/x-grimorium-slide', JSON.stringify(payload));
      event.clipboardData?.setData('text/plain', `[Diapo ${payload.slide.title || ''} Grimorium]`);
    } catch { /* clipboard fallback interne */ }
    event.preventDefault();
    return;
  }
  const markedText = selectedMarkedText(editor);
  if (markedText && selectedBlocks(editor).length <= 1) {
    try { event.clipboardData?.setData('text/plain', markedText); } catch { /* ignore */ }
    event.preventDefault();
    return;
  }
  const selection = selectedBlocks(editor);
  if (!selection.length || hasNativeTextSelection(target)) return;
  const payload = createBlocksClipboard(selection, editor);
  editor.__freePageClipboard = payload;
  sharedFreePageClipboard = structuredClone(payload);
  try {
    event.clipboardData?.setData('application/x-grimorium-blocks', JSON.stringify(payload));
    if (payload.blocks.length === 1) event.clipboardData?.setData('application/x-grimorium-block', JSON.stringify(payload.blocks[0]));
    event.clipboardData?.setData('text/plain', `[${payload.blocks.length} bloc${payload.blocks.length > 1 ? 's' : ''} Grimorium]`);
  } catch { /* clipboard fallback interne */ }
  event.preventDefault();
  syncToolbar(editor);
}

function handleDocumentCut(event) {
  const editor = activeFreePageEditor;
  if (editor?.isConnected && selectedMarkedText(editor) && selectedBlocks(editor).length <= 1) {
    handleDocumentCopy(event);
    deleteSavedTextSelection(editor);
    return;
  }
  const before = editor?.__freePageClipboard;
  handleDocumentCopy(event);
  if (editor?.__freePageClipboard && editor.__freePageClipboard !== before) mutateSelection(editor, 'delete');
}

function handleDocumentPaste(event) {
  const editor = activeFreePageEditor;
  const target = event.target instanceof Element ? event.target : null;
  if (!editor?.isConnected) return;
  const markedText = selectedMarkedText(editor);
  const plainText = event.clipboardData?.getData('text/plain') || '';
  if (markedText && selectedBlocks(editor).length <= 1 && plainText) {
    event.preventDefault();
    replaceSavedTextSelection(editor, plainText);
    return;
  }
  const rawSlide = event.clipboardData?.getData('application/x-grimorium-slide');
  const rawBlocks = event.clipboardData?.getData('application/x-grimorium-blocks');
  const rawBlock = event.clipboardData?.getData('application/x-grimorium-block');
  const trimmedText = plainText.trim();
  const blockMarker = trimmedText?.startsWith('[') && trimmedText.includes(' Grimorium]');
  if (isNativeEditingContext(target) && !rawBlocks && !rawBlock && !blockMarker) return;
  if (rawSlide) {
    try { sharedFreePageSlideClipboard = normalizeSlideClipboard(JSON.parse(rawSlide)); } catch { /* ignore */ }
  }
  if ((rawSlide || (!rawBlocks && !rawBlock && sharedFreePageSlideClipboard && blockMarker)) && !isNativeEditingContext(target)) {
    event.preventDefault();
    pasteSlideFromClipboard(editor);
    return;
  }
  if (rawBlocks) {
    try { editor.__freePageClipboard = normalizeBlocksClipboard(JSON.parse(rawBlocks)); } catch { /* ignore */ }
  } else if (rawBlock) {
    try { editor.__freePageClipboard = createBlocksClipboard([normalizeBlock(JSON.parse(rawBlock), 0, editor.__freePageState.height)]); } catch { /* ignore */ }
  }
  if (editor.__freePageClipboard) sharedFreePageClipboard = structuredClone(editor.__freePageClipboard);
  if (!editor.__freePageClipboard && sharedFreePageClipboard) editor.__freePageClipboard = structuredClone(sharedFreePageClipboard);
  if (canPasteBlock(editor)) {
    event.preventDefault();
    pasteCopiedBlock(editor);
    return;
  }
  if (!rawBlock && trimmedText && !isNativeEditingContext(target)) {
    event.preventDefault();
    addTextBlock(editor, { content: `<p>${_esc(trimmedText).replace(/\n/g, '<br>')}</p>` });
  }
}

function handleDocumentShortcut(event) {
  const editor = activeFreePageEditor;
  if (!editor?.isConnected || !editor.__freePageState) return;
  const target = event.target instanceof Element ? event.target : null;
  const editing = target?.closest('[contenteditable="true"], input, textarea, select');
  const key = event.key.toLowerCase();
  const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (handleUndoRedoShortcut(editor, event, target, key, shortcut)) return;
  if (shortcut && key === 's') {
    const save = editor.closest('form, [data-free-page-shell], .profil-bio-edit')?.querySelector('[data-free-page-save]');
    if (save) { event.preventDefault(); save.click(); }
    return;
  }
  if (shortcut && key === 'a' && !editing) {
    event.preventDefault();
    setMultiSelected(editor, editor.__freePageState.blocks.filter((block) => !block.hidden).map((block) => block.id));
    return;
  }
  if (shortcut && key === 'enter') {
    event.preventDefault();
    openFreePagePreview(editor);
    return;
  }
  if (editing) {
    const content = target?.closest('[data-fpe-content]');
    const block = selectedBlock(editor);
    if (content && block?.type === 'text' && editor.__freePageTextRange?.blockId === block.id && hasPaintedTextSelection(content)) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSavedTextSelection(editor);
        return;
      }
      if (!shortcut && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
        event.preventDefault();
        replaceSavedTextSelection(editor, event.key);
        return;
      }
      if (!shortcut && event.key === 'Enter') {
        event.preventDefault();
        replaceSavedTextSelection(editor, '<br>', { html: true });
        return;
      }
    }
    const emptyText = content && block?.type === 'text' && !String(content.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (emptyText && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      mutateSelection(editor, 'delete');
    }
    return;
  }
  if (shortcut && key === 'd') {
    event.preventDefault();
    if (selectedBlocks(editor).length) mutateSelection(editor, 'duplicate');
    else duplicateCurrentSlide(editor);
    return;
  }
  if (['PageUp', 'PageDown', 'Home', 'End'].includes(event.key) && editor.__freePageDeck && !editor.__freePagePopupEdit) {
    event.preventDefault();
    navigateEditorSlide(editor, event.key);
    return;
  }
  if (shortcut && (key === '[' || key === ']')) { event.preventDefault(); mutateSelection(editor, key === ']' ? 'layer-up' : 'layer-down'); return; }
  if (event.key === 'Escape') { setSelected(editor, null); return; }
  if (editor.__freePageSelected === NAV_BLOCK_ID) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (editor.__freePageDeck?.nav) editor.__freePageDeck.nav.enabled = false;
      renderBlocks(editor, null);
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const nav = editor.__freePageDeck.nav = normalizeDeckNav(editor.__freePageDeck.nav, editor.__freePageDeck.slides);
      const d = event.shiftKey ? snapUnit(editor) * 4 : snapUnit(editor);
      nav.x = Math.round(clamp(snapValue(editor, nav.x + (event.key === 'ArrowLeft' ? -d : event.key === 'ArrowRight' ? d : 0)), 0, PAGE_WIDTH - nav.w));
      nav.y = Math.round(clamp(snapValue(editor, nav.y + (event.key === 'ArrowUp' ? -d : event.key === 'ArrowDown' ? d : 0)), 0, DEFAULT_HEIGHT - nav.h));
      renderBlocks(editor, NAV_BLOCK_ID);
      return;
    }
  }
  if (!selectedBlocks(editor).length) return;
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); mutateSelection(editor, 'delete'); return; }
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    rotateSelectedBlocks(editor, event.key === 'ArrowRight' ? 1 : -1, event.shiftKey ? 15 : 1);
    return;
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const d = event.shiftKey ? snapUnit(editor) * 4 : snapUnit(editor);
    const dx = event.key === 'ArrowLeft' ? -d : event.key === 'ArrowRight' ? d : 0;
    const dy = event.key === 'ArrowUp' ? -d : event.key === 'ArrowDown' ? d : 0;
    pushHistory(editor);
    selectedBlocks(editor).filter((block) => !block.locked).forEach((block) => moveBlockGroup(editor, block, dx, dy));
    renderBlocks(editor, editor.__freePageSelected);
  }
}

function handleUndoRedoShortcut(editor, event, target, key, shortcut) {
  if (!shortcut || (key !== 'z' && key !== 'y')) return false;
  if (shouldKeepNativeUndo(target)) {
    window.setTimeout(() => {
      syncLiveBlock(editor);
      syncToolbar(editor);
    }, 0);
    return false;
  }
  event.preventDefault();
  syncLiveBlock(editor);
  (key === 'y' || event.shiftKey) ? redo(editor) : undo(editor);
  return true;
}

function shouldKeepNativeUndo(target) {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (el.closest('[data-fpe-content], [data-fpe-table-cell]')) return true;
  if (el.matches('textarea')) return true;
  if (!el.closest('[data-free-page-editor]')) return false;
  if (!el.matches('input')) return false;
  const type = String(el.getAttribute('type') || 'text').toLowerCase();
  return ['text', 'search', 'password', 'email', 'url', 'tel'].includes(type)
    && !el.matches('[data-fpe-inspector-field], [data-fpe-page-field], [data-fpe-nav-field], [data-fpe-grid-field], [data-fpe-editor-field]');
}

function isNativeEditingContext(target) {
  const active = document.activeElement instanceof Element ? document.activeElement : null;
  return Boolean(target?.closest('[contenteditable="true"], input, textarea') || active?.closest('[contenteditable="true"], input, textarea'));
}

function hasNativeTextSelection(target) {
  const selection = document.getSelection?.();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode;
  const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
  return Boolean(element?.closest?.('[contenteditable="true"], input, textarea') || target?.closest?.('[contenteditable="true"], input, textarea'));
}

function handleEditorClick(editor, event) {
  const contextAction = event.target.closest('[data-fpe-context-action]')?.dataset.fpeContextAction;
  if (contextAction) { closeContextMenu(editor); runAction(editor, contextAction, event); return; }
  const layerButton = event.target.closest('[data-fpe-layer-action]');
  if (layerButton) { runLayerAction(editor, layerButton.dataset.fpeLayerAction, layerButton.dataset.layerId); return; }
  const slideAction = event.target.closest('[data-fpe-slide-action]')?.dataset.fpeSlideAction;
  if (slideAction) {
    const trigger = event.target.closest('[data-fpe-slide-action]');
    runSlideAction(editor, slideAction, event.target.closest('[data-fpe-slide-id]')?.dataset.fpeSlideId || trigger?.dataset.slideId);
    return;
  }
  const tab = event.target.closest('[data-fpe-inspector-tab]')?.dataset.fpeInspectorTab;
  if (tab) { editor.__freePageFocusPanel = null; editor.__freePageInspectorTab = tab === 'config' ? 'config' : 'content'; renderInspector(editor); return; }
  const colorTab = event.target.closest('[data-fpe-color-tab]')?.dataset.fpeColorTab;
  if (colorTab) { switchTextColorPopoverTab(editor, colorTab); return; }
  const inspectorButton = event.target.closest('button[data-fpe-inspector-field]');
  if (inspectorButton) { handleInspectorInput(editor, { target: inspectorButton }, { commit: true }); return; }
  const pageButton = event.target.closest('button[data-fpe-page-field]');
  if (pageButton) { handlePageField(editor, pageButton); return; }
  const popupTemplate = event.target.closest('[data-fpe-popup-template]')?.dataset.fpePopupTemplate;
  if (popupTemplate) { choosePopupTemplate(editor, popupTemplate); return; }
  const popupAction = event.target.closest('[data-fpe-popup-action]')?.dataset.fpePopupAction;
  if (popupAction) { runPopupModalAction(editor, popupAction); return; }
  if (!event.target.closest('[data-fpe-shape-popover], [data-fpe-action="toggle-shape-popover"]')) editor.querySelector('[data-fpe-shape-popover]').hidden = true;
  if (!event.target.closest('[data-fpe-position-popover], [data-fpe-action="toggle-position-popover"]')) editor.querySelector('[data-fpe-position-popover]').hidden = true;
  if (!event.target.closest('[data-fpe-text-color-popover], [data-fpe-action="toggle-text-color-popover"]')) {
    const colorPopover = editor.querySelector('[data-fpe-text-color-popover]');
    if (colorPopover) colorPopover.hidden = true;
  }
  closeContextMenu(editor);

  const blockEl = event.target.closest('[data-fpe-block]');
  const navEl = event.target.closest('[data-fpe-nav-block]');
  const action = event.target.closest('[data-fpe-action]')?.dataset.fpeAction;
  const command = event.target.closest('[data-fpe-command]');
  const textColor = event.target.closest('[data-fpe-text-color]')?.dataset.fpeTextColor;
  if (blockEl) {
    const block = editor.__freePageState.blocks.find((item) => item.id === blockEl.dataset.fpeBlock);
    if (!event.target.closest('[data-fpe-content]')) {
      editor.__freePageTextRange = null;
      editor.__freePageInlineTarget = null;
    }
    event.ctrlKey || event.metaKey ? toggleSelected(editor, blockEl.dataset.fpeBlock) : setSelected(editor, blockEl.dataset.fpeBlock);
  }
  else if (navEl) setSelected(editor, NAV_BLOCK_ID);
  else if (event.target.closest('[data-fpe-composition]') && !action) setSelected(editor, null);
  if (command) return runTextCommand(editor, command);
  if (textColor) return applyInlineTextColor(editor, textColor);
  if (action) runAction(editor, action, event);
}

function handleEditorChange(editor, event) {
  if (event.target.matches('[data-fpe-deck-field]')) { handleDeckField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-grid-field]')) { handleGridField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-editor-field]')) { handleEditorField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-slide-field]')) { handleSlideField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-page-field]')) { handlePageField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-nav-field], [data-fpe-nav-slide]')) { handleNavField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-inspector-field]')) { handleInspectorInput(editor, event, { commit: true }); return; }
  if (event.target.closest('[data-fpe-inspector]')) { handleInspectorInput(editor, event, { commit: true }); return; }
}

function handleEditorInput(editor, event) {
  if (event.target.matches('[data-fpe-deck-field]')) { handleDeckField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-grid-field]')) { handleGridField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-editor-field]')) { handleEditorField(editor, event.target); return; }
  if (event.target.matches('[data-fpe-slide-field]')) { handleSlideField(editor, event.target, { live: true }); return; }
  if (event.target.matches('[data-fpe-page-field]')) { handlePageField(editor, event.target, { live: true }); return; }
  if (event.target.matches('[data-fpe-nav-field], [data-fpe-nav-slide]')) { handleNavField(editor, event.target, { live: true }); return; }
  if (event.target.matches('[data-fpe-inspector-field]')) { handleInspectorInput(editor, event); return; }
  if (event.target.closest('[data-fpe-inspector]')) { handleInspectorInput(editor, event); return; }
  const block = selectedBlock(editor);
  const content = event.target.closest('[data-fpe-content]');
  if (content && block?.type === 'text') {
    scheduleHistory(editor);
    if (!hasPaintedTextSelection(content)) {
      editor.__freePageTextRange = null;
      editor.__freePageInlineTarget = null;
    }
    block.content = cleanFreePageTextHtml(content.innerHTML);
    return;
  }
  const cell = event.target.closest('[data-fpe-table-cell]');
  if (cell && block?.type === 'table') {
    scheduleHistory(editor);
    const rows = normalizeRows(block.rows);
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    if (rows[r]) rows[r][c] = String(cell.textContent || '').slice(0, 160);
    block.rows = rows;
  }
}

function handleEditorFocusOut(editor, event) {
  const content = event.target.closest?.('[data-fpe-content]');
  if (!content) return;
  const blockEl = content.closest('[data-fpe-block]');
  const block = editor.__freePageState.blocks.find((item) => item.id === blockEl?.dataset.fpeBlock);
  if (block?.type !== 'text') return;
  const plain = String(content.textContent || '').replace(/\u00a0/g, ' ').trim();
  const media = content.querySelector('img, table, iframe, video, audio');
  if (plain || media) return;
  pushHistory(editor);
  editor.__freePageState.blocks = editor.__freePageState.blocks.filter((item) => item.id !== block.id);
  renderBlocks(editor, null);
}

function runTextCommand(editor, button) {
  const content = selectedElement(editor)?.querySelector('[data-fpe-content]');
  const block = selectedBlock(editor);
  if (!content || block?.type !== 'text') return;
  pushHistory(editor);
  content.focus({ preventScroll: true });
  restoreEditorTextSelection(editor, content, block);
  document.execCommand(button.dataset.fpeCommand, false, button.dataset.fpeCommandValue || null);
  block.content = cleanFreePageTextHtml(content.innerHTML);
}

function applyInlineTextColor(editor, color) {
  if (!INLINE_TEXT_COLORS.some((item) => item.value === color)) return;
  const content = selectedElement(editor)?.querySelector('[data-fpe-content]');
  const block = selectedBlock(editor);
  if (!content || block?.type !== 'text') return;
  pushHistory(editor);
  content.focus({ preventScroll: true });
  restoreEditorTextSelection(editor, content, block);
  document.execCommand('foreColor', false, color);
  block.content = cleanFreePageTextHtml(content.innerHTML);
}

function handleContextMenu(editor, event) {
  const stage = event.target.closest('[data-fpe-composition]');
  const blockEl = event.target.closest('[data-fpe-block]');
  const navEl = event.target.closest('[data-fpe-nav-block]');
  if (!stage && !blockEl) return;
  event.preventDefault();
  const block = editor.__freePageState.blocks.find((item) => item.id === blockEl?.dataset.fpeBlock);
  if (blockEl) {
    const selectedIds = new Set(editor.__freePageSelectedIds || []);
    if (!selectedIds.has(blockEl.dataset.fpeBlock)) setSelected(editor, blockEl.dataset.fpeBlock);
  }
  else if (navEl) setSelected(editor, NAV_BLOCK_ID);
  else setSelected(editor, null);
  openContextMenu(editor, event.clientX, event.clientY, Boolean(blockEl), Boolean(navEl));
}

function openContextMenu(editor, clientX, clientY, hasBlock, hasNav = false) {
  const menu = editor.querySelector('[data-fpe-context-menu]');
  const block = selectedBlock(editor);
  const multiCount = selectedBlocks(editor).length;
  const tableActions = block?.type === 'table'
    ? [['table-row', 'Ajouter une ligne'], ['table-row-remove', 'Retirer une ligne'], ['table-col', 'Ajouter une colonne'], ['table-col-remove', 'Retirer une colonne'], ['table-header', block.header ? "Masquer l'en-tete" : "Afficher l'en-tete"]]
    : [];
  const actions = hasNav
    ? [['select-nav', 'Configurer le menu'], ['hide-nav', 'Masquer le menu']]
    : hasBlock
    ? [['copy', multiCount > 1 ? `Copier ${multiCount} blocs` : 'Copier le bloc'], ['duplicate', multiCount > 1 ? 'Dupliquer la selection' : 'Dupliquer'], ...(block?.type === 'image' && multiCount <= 1 ? [['crop-image', "Rogner l'image"], ['replace-image', "Remplacer l'image"]] : []), ...(multiCount <= 1 ? tableActions : []), ['reset-rotation', 'Remettre droit'], ['toggle-hidden-block', block?.hidden ? 'Afficher le bloc' : 'Masquer le bloc'], ['layer-up', 'Mettre devant'], ['layer-down', 'Mettre derriere'], ['toggle-lock', block?.locked ? 'Deverrouiller' : 'Verrouiller'], ['delete', multiCount > 1 ? 'Supprimer la selection' : 'Supprimer']]
    : [['add-text', 'Ajouter texte'], ['add-image', 'Ajouter image'], ['add-table', 'Ajouter tableau'], ['add-chart', 'Ajouter graphique'], ['add-shape', 'Ajouter forme'], ['paste', 'Coller', !canPasteBlock(editor)], ['unlock-all', 'Deverrouiller tout', !editor.__freePageState.blocks.some((item) => item.locked)]];
  menu.innerHTML = actions.map(([action, label, disabled]) => `<button type="button" data-fpe-context-action="${_esc(action)}" ${disabled ? 'disabled' : ''}>${_esc(label)}</button>`).join('');
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${clamp(clientX, 8, Math.max(8, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${clamp(clientY, 8, Math.max(8, window.innerHeight - rect.height - 8))}px`;
}

function closeContextMenu(editor) {
  const menu = editor.querySelector('[data-fpe-context-menu]');
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = '';
}

function runAction(editor, action, event) {
  if (action === 'toggle-shape-popover') { toggleShapePopover(editor, event); return; }
  if (action === 'toggle-position-popover') { togglePositionPopover(editor, event); return; }
  if (action === 'toggle-text-color-popover') { toggleTextColorPopover(editor, event); return; }
  if (action.startsWith('position-')) return positionSelectionOnPage(editor, action.replace('position-', ''));
  if (action === 'add-text') return addTextBlock(editor);
  if (action === 'add-image') return addImageBlock(editor);
  if (action === 'add-table') return addTableBlock(editor);
  if (action === 'add-chart') return addChartBlock(editor);
  if (action === 'add-nav') return activateNavComponent(editor);
  if (action === 'add-shape') {
    addShapeBlock(editor, event?.target?.closest?.('[data-shape]')?.dataset.shape || 'rectangle');
    editor.querySelector('[data-fpe-shape-popover]').hidden = true;
    return;
  }
  if (action === 'open-interaction') {
    const block = selectedBlock(editor);
    if (normalizeInteraction(block?.interaction).type === 'popup') {
      startInlinePopupEdit(editor, block);
      return;
    }
    editor.__freePageInspectorTab = 'config';
    editor.__freePageFocusPanel = 'interaction';
    renderInspector(editor);
    return;
  }
  if (action === 'finish-popup-edit') return finishInlinePopupEdit(editor);
  if (action === 'toggle-popup-frame-lock') return togglePopupFrameLock(editor);
  if (action === 'close-interaction-panel') {
    syncInteractionPageEditor(editor);
    editor.__freePageFocusPanel = null;
    renderInspector(editor);
    return;
  }
  if (action === 'crop-image') {
    const block = selectedBlock(editor);
    if (block?.type === 'image') {
      pushHistory(editor);
      editor.__freePageCropBlockId = block.id;
      block.cropX = clamp(block.cropX ?? 50, 0, 100);
      block.cropY = clamp(block.cropY ?? 50, 0, 100);
      block.zoom = clamp(block.zoom ?? 100, 100, 220);
      block.imageW = clamp(block.imageW ?? block.zoom, 1, 900);
      block.imageH = clamp(block.imageH ?? block.zoom, 1, 900);
      block.imageX = clamp(block.imageX ?? ((100 - block.imageW) * block.cropX / 100), -260, 260);
      block.imageY = clamp(block.imageY ?? ((100 - block.imageH) * block.cropY / 100), -260, 260);
      syncImageAspectFromDom(editor, block);
      normalizeImageCropRect(block);
      renderBlocks(editor, block.id);
    }
    editor.__freePageInspectorTab = 'config';
    editor.__freePageFocusPanel = 'crop';
    renderInspector(editor);
    return;
  }
  if (action === 'finish-crop') {
    editor.__freePageCropBlockId = null;
    renderBlocks(editor, editor.__freePageSelected);
    return;
  }
  if (action === 'replace-image') return replaceImageBlock(editor);
  if (action === 'nav-target-all') return setNavSlideSelection(editor, 'targetSlideIds', 'all');
  if (action === 'nav-target-none') return setNavSlideSelection(editor, 'targetSlideIds', 'none');
  if (action === 'nav-visible-all') return setNavSlideSelection(editor, 'visibleSlideIds', 'all');
  if (action === 'nav-visible-current') return setNavSlideSelection(editor, 'visibleSlideIds', 'current');
  if (action === 'select-nav') { setSelected(editor, NAV_BLOCK_ID); return; }
  if (action === 'hide-nav') {
    if (editor.__freePageDeck?.nav) editor.__freePageDeck.nav.enabled = false;
    renderBlocks(editor, null);
    return;
  }
  if (action === 'show-all-blocks') return showAllLayers(editor);
  if (action === 'fit-zoom') return fitEditorZoom(editor);
  if (action === 'preview-deck') return openFreePagePreview(editor);
  if (action === 'duplicate-current-slide') return duplicateCurrentSlide(editor);
  if (action === 'undo') return undo(editor);
  if (action === 'redo') return redo(editor);
  mutateSelection(editor, action);
}

function toggleShapePopover(editor, event) {
  const popover = editor.querySelector('[data-fpe-shape-popover]');
  const button = event?.target?.closest?.('[data-fpe-action="toggle-shape-popover"]');
  if (!popover) return;
  const shouldOpen = popover.hidden;
  popover.hidden = !shouldOpen;
  const color = editor.querySelector('[data-fpe-text-color-popover]');
  if (color) color.hidden = true;
  const position = editor.querySelector('[data-fpe-position-popover]');
  if (position) position.hidden = true;
  if (!shouldOpen || !button) return;
  const editorRect = editor.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  popover.style.left = `${Math.max(8, buttonRect.left - editorRect.left)}px`;
  popover.style.top = `${buttonRect.bottom - editorRect.top + 6}px`;
}

function togglePositionPopover(editor, event) {
  const popover = editor.querySelector('[data-fpe-position-popover]');
  const button = event?.target?.closest?.('[data-fpe-action="toggle-position-popover"]');
  if (!popover) return;
  const shouldOpen = popover.hidden;
  popover.hidden = !shouldOpen;
  const shape = editor.querySelector('[data-fpe-shape-popover]');
  if (shape) shape.hidden = true;
  const color = editor.querySelector('[data-fpe-text-color-popover]');
  if (color) color.hidden = true;
  if (!shouldOpen || !button) return;
  const editorRect = editor.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  popover.style.left = `${Math.max(8, buttonRect.left - editorRect.left)}px`;
  popover.style.top = `${buttonRect.bottom - editorRect.top + 6}px`;
}

function toggleTextColorPopover(editor, event) {
  saveEditorTextSelection(editor, { paint: true });
  const popover = editor.querySelector('[data-fpe-text-color-popover]');
  const button = event?.target?.closest?.('[data-fpe-action="toggle-text-color-popover"]');
  if (!popover) return;
  const shouldOpen = popover.hidden;
  popover.hidden = !shouldOpen;
  const shape = editor.querySelector('[data-fpe-shape-popover]');
  if (shape) shape.hidden = true;
  const position = editor.querySelector('[data-fpe-position-popover]');
  if (position) position.hidden = true;
  if (!shouldOpen || !button) return;
  const editorRect = editor.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(buttonRect.left - editorRect.left - 28, editorRect.width - 306))}px`;
  popover.style.top = `${buttonRect.bottom - editorRect.top + 6}px`;
}

function switchTextColorPopoverTab(editor, tab) {
  const popover = editor.querySelector('[data-fpe-text-color-popover]');
  if (!popover) return;
  const safeTab = tab === 'advanced' ? 'advanced' : 'samples';
  popover.querySelectorAll('[data-fpe-color-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.fpeColorTab === safeTab));
  popover.querySelectorAll('[data-fpe-color-panel]').forEach((panel) => { panel.hidden = panel.dataset.fpeColorPanel !== safeTab; });
}

function runSlideAction(editor, action, slideId) {
  if (!editor.__freePageDeck || editor.__freePagePopupEdit) return;
  syncCurrentSlide(editor);
  const slides = editor.__freePageDeck.slides;
  const slide = slides.find((item) => item.id === slideId);
  if (action === 'add') {
    if (slides.length >= MAX_SLIDES) return showNotif('Nombre maximum de diapos atteint.', 'info');
    const next = normalizeSlide({ title: `Diapo ${slides.length + 1}`, page: { version: 1, blocks: [] } }, slides.length);
    slides.push(next);
    switchSlide(editor, next.id);
    return;
  }
  if (action === 'paste') return pasteSlideFromClipboard(editor);
  if (!slide) return;
  if (action === 'select') return switchSlide(editor, slide.id);
  if (action === 'copy') {
    copySlideToClipboard(slide);
    showNotif('Diapo copiee. Tu peux la coller dans un autre diaporama.', 'success');
    renderSlides(editor);
    return;
  }
  if (action === 'toggle-hidden') {
    slide.hidden = !slide.hidden;
    renderSlides(editor);
    return;
  }
  if (action === 'toggle-password-visible') {
    slide.__passwordVisible = !slide.__passwordVisible;
    renderSlides(editor);
    renderInspector(editor);
    return;
  }
  if (action === 'duplicate') {
    if (slides.length >= MAX_SLIDES) return showNotif('Nombre maximum de diapos atteint.', 'info');
    copySlideToClipboard(slide);
    const index = slides.indexOf(slide);
    const copy = normalizeSlide({ ...structuredClone(slide), id: uid(), title: `${slide.title || 'Diapo'} copie` }, index + 1);
    slides.splice(index + 1, 0, copy);
    switchSlide(editor, copy.id);
    return;
  }
  if (action === 'delete') {
    if (slides.length <= 1) return showNotif('Il faut garder au moins une diapo.', 'info');
    const index = slides.indexOf(slide);
    slides.splice(index, 1);
    switchSlide(editor, slides[Math.max(0, index - 1)]?.id || slides[0].id);
  }
}

function duplicateCurrentSlide(editor) {
  if (!editor.__freePageDeck || editor.__freePagePopupEdit) return;
  syncCurrentSlide(editor);
  const slides = editor.__freePageDeck.slides;
  if (slides.length >= MAX_SLIDES) return showNotif('Nombre maximum de diapos atteint.', 'info');
  const slide = currentSlide(editor);
  if (!slide) return;
  copySlideToClipboard(slide);
  const index = slides.indexOf(slide);
  const copy = normalizeSlide({ ...structuredClone(slide), id: uid(), title: `${slide.title || 'Diapo'} copie` }, index + 1);
  slides.splice(index + 1, 0, copy);
  switchSlide(editor, copy.id);
}

function copySlideToClipboard(slide) {
  if (!slide) return null;
  const normalized = normalizeSlide(structuredClone(slide));
  const payload = {
    kind: 'grimorium-slide',
    version: 1,
    slide: normalized,
    copiedAt: Date.now(),
  };
  sharedFreePageSlideClipboard = payload;
  return payload;
}

function pasteSlideFromClipboard(editor) {
  if (!editor.__freePageDeck || editor.__freePagePopupEdit) return;
  syncCurrentSlide(editor);
  const slides = editor.__freePageDeck.slides;
  if (slides.length >= MAX_SLIDES) return showNotif('Nombre maximum de diapos atteint.', 'info');
  const payload = normalizeSlideClipboard(sharedFreePageSlideClipboard);
  if (!payload?.slide) return showNotif('Aucune diapo a coller.', 'info');
  const currentIndex = Math.max(0, slides.findIndex((slide) => slide.id === editor.__freePageSlideId));
  const copy = cloneSlideForPaste(payload.slide, currentIndex + 1);
  slides.splice(currentIndex + 1, 0, copy);
  switchSlide(editor, copy.id);
  showNotif('Diapo collee.', 'success');
}

function normalizeSlideClipboard(value) {
  if (!value?.slide) return null;
  return { kind: 'grimorium-slide', version: 1, slide: normalizeSlide(structuredClone(value.slide)) };
}

function cloneSlideForPaste(slide, index = 0) {
  const copy = normalizeSlide({ ...structuredClone(slide), id: uid(), title: slide.title || `Diapo ${index + 1}` }, index);
  copy.page = clonePageForPaste(copy.page);
  return copy;
}

function clonePageForPaste(page) {
  const safePage = normalizeSingleFreePage(page);
  const groupMap = new Map();
  const blocks = safePage.blocks.map((block, index) => cloneBlockForPaste(block, index, safePage.height, groupMap)).filter(Boolean);
  return { ...safePage, blocks };
}

function cloneBlockForPaste(block, index, pageHeight, groupMap) {
  const copy = normalizeBlock({ ...structuredClone(block), id: uid() }, index, pageHeight);
  if (!copy) return null;
  if (copy.groupId) {
    if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, `grp-${Date.now().toString(36)}-${groupMap.size}`);
    copy.groupId = groupMap.get(copy.groupId);
  }
  const interaction = normalizeInteraction(copy.interaction);
  copy.interaction = {
    ...interaction,
    page: interaction.page ? clonePageForPaste(interaction.page) : null,
  };
  return copy;
}

function navigateEditorSlide(editor, key) {
  const slides = editor.__freePageDeck?.slides || [];
  if (slides.length <= 1) return;
  const currentIndex = Math.max(0, slides.findIndex((slide) => slide.id === editor.__freePageSlideId));
  const nextIndex = key === 'Home'
    ? 0
    : key === 'End'
      ? slides.length - 1
      : clamp(currentIndex + (key === 'PageDown' ? 1 : -1), 0, slides.length - 1);
  if (nextIndex !== currentIndex) switchSlide(editor, slides[nextIndex].id);
}

function handleSlideField(editor, target, { live = false } = {}) {
  const slide = editor.__freePageDeck?.slides?.find((item) => item.id === target.dataset.slideId);
  if (!slide) return;
  if (target.dataset.fpeSlideField === 'title') slide.title = String(target.value || '').slice(0, 64);
  if (target.dataset.fpeSlideField === 'requirePassword') {
    slide.requirePassword = Boolean(target.checked);
    if (!slide.password && slide.requirePassword) slide.password = '';
    renderSlides(editor);
    renderInspector(editor);
    return;
  }
  if (target.dataset.fpeSlideField === 'password') slide.password = String(target.value || '').slice(0, 80);
  if (target.dataset.fpeSlideField === 'passwordMessage') slide.passwordMessage = String(target.value || DEFAULT_PASSWORD_MESSAGE).slice(0, 140);
  if (target.dataset.fpeSlideField === 'passwordPlaceholder') slide.passwordPlaceholder = String(target.value || DEFAULT_PASSWORD_PLACEHOLDER).slice(0, 80);
  // Pendant la frappe (live), NE PAS re-rendre l'inspecteur : recréer l'input
  // ferait sauter le focus à chaque caractère. Le rendu se fait au blur/change.
  if (!live) renderInspector(editor);
}

function handleDeckField(editor, target) {
  if (!editor.__freePageDeck) return;
  if (target.dataset.fpeDeckField === 'canBrowse') {
    editor.__freePageDeck.canBrowse = Boolean(target.checked);
    renderSlides(editor);
  }
}

function handleGridField(editor, target) {
  if (!editor.__freePageDeck) return;
  editor.__freePageDeck.grid = normalizeDeckGrid(editor.__freePageDeck.grid);
  const field = target.dataset.fpeGridField;
  if (field === 'show') editor.__freePageDeck.grid.show = Boolean(target.checked);
  if (field === 'safe') editor.__freePageDeck.grid.safe = Boolean(target.checked);
  if (field === 'snap') editor.__freePageDeck.grid.snap = Boolean(target.checked);
  if (field === 'size') editor.__freePageDeck.grid.size = GRID_SIZES.includes(Number(target.value)) ? Number(target.value) : 10;
  renderBlocks(editor, editor.__freePageSelected);
}

function handleEditorField(editor, target) {
  if (target.dataset.fpeEditorField !== 'zoom') return;
  const zoom = EDITOR_ZOOMS.includes(Number(target.value)) ? Number(target.value) : 100;
  editor.style.setProperty('--free-page-editor-zoom', String(zoom / 100));
}

function fitEditorZoom(editor) {
  const workspace = editor.querySelector('.free-page-workspace');
  const page = normalizeSingleFreePage(editor.__freePageState);
  if (!workspace) return;
  const rect = workspace.getBoundingClientRect();
  const availableW = Math.max(320, rect.width - 22);
  const availableH = Math.max(260, window.innerHeight - rect.top - 74);
  const rawZoom = Math.min(availableW / PAGE_WIDTH, availableH / page.height) * 100;
  const zoom = EDITOR_ZOOMS.reduce((best, value) => Math.abs(value - rawZoom) < Math.abs(best - rawZoom) ? value : best, 100);
  editor.style.setProperty('--free-page-editor-zoom', String(zoom / 100));
  const select = editor.querySelector('[data-fpe-editor-field="zoom"]');
  if (select) select.value = String(zoom);
}

function handlePageField(editor, target) {
  if (!editor.__freePageState) return;
  pushHistory(editor);
  if (target.dataset.fpePageField === 'background') editor.__freePageState.background = safeColor(target.value, DEFAULT_PAGE_BG);
  syncCurrentSlide(editor);
  renderBlocks(editor, editor.__freePageSelected);
}

function handleNavField(editor, target, { live = false } = {}) {
  if (!editor.__freePageDeck) return;
  const deck = editor.__freePageDeck;
  deck.nav = normalizeDeckNav(deck.nav, deck.slides);
  const field = target.dataset.fpeNavField;
  if (field === 'enabled') deck.nav.enabled = Boolean(target.checked);
  if (field === 'style') deck.nav.style = NAV_STYLES.has(target.value) ? target.value : 'bar';
  if (field === 'label') deck.nav.label = String(target.value || 'Menu').slice(0, 40);
  if (field === 'x') deck.nav.x = clamp(target.value, 0, PAGE_WIDTH - deck.nav.w);
  if (field === 'y') deck.nav.y = clamp(target.value, 0, DEFAULT_HEIGHT - deck.nav.h);
  if (field === 'w') deck.nav.w = clamp(target.value, deck.nav.style === 'menu' ? 44 : 220, PAGE_WIDTH - deck.nav.x);
  if (field === 'h') deck.nav.h = clamp(target.value, 34, DEFAULT_HEIGHT - deck.nav.y);
  const slideField = target.dataset.fpeNavSlide;
  if (slideField) {
    const key = slideField === 'visible' ? 'visibleSlideIds' : 'targetSlideIds';
    const set = new Set(deck.nav[key] || []);
    if (target.checked) set.add(target.dataset.slideId);
    else set.delete(target.dataset.slideId);
    deck.nav[key] = deck.slides.map((slide) => slide.id).filter((id) => set.has(id));
  }
  deck.nav = normalizeDeckNav(deck.nav, deck.slides);
  renderBlocks(editor, editor.__freePageSelected === NAV_BLOCK_ID ? NAV_BLOCK_ID : editor.__freePageSelected);
  if (!live) renderInspector(editor);
}

function setNavSlideSelection(editor, key, mode) {
  if (!editor.__freePageDeck) return;
  const deck = editor.__freePageDeck;
  deck.nav = normalizeDeckNav(deck.nav, deck.slides);
  const all = deck.slides.map((slide) => slide.id);
  deck.nav[key] = mode === 'all' ? all : mode === 'current' ? [editor.__freePageSlideId].filter(Boolean) : [];
  deck.nav = normalizeDeckNav(deck.nav, deck.slides);
  renderBlocks(editor, editor.__freePageSelected);
  renderInspector(editor);
}

function activateNavComponent(editor) {
  if (!editor.__freePageDeck) return;
  const deck = editor.__freePageDeck;
  deck.nav = normalizeDeckNav({ ...deck.nav, enabled: true }, deck.slides);
  if (!deck.nav.visibleSlideIds.includes(editor.__freePageSlideId)) {
    deck.nav.visibleSlideIds = deck.slides.map((slide) => slide.id);
  }
  if (!deck.nav.targetSlideIds.length) deck.nav.targetSlideIds = deck.slides.map((slide) => slide.id);
  renderBlocks(editor, NAV_BLOCK_ID);
}

function handleSlideDragStart(editor, event) {
  const layerRow = event.target.closest?.('.free-page-layer-row[draggable="true"]');
  if (layerRow && !editor.__freePagePopupEdit) {
    editor.__freePageDraggedLayer = layerRow.dataset.layerId;
    layerRow.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-grimorium-layer', layerRow.dataset.layerId);
    return;
  }
  const thumb = event.target.closest?.('[data-fpe-slide-id]');
  if (!thumb || !event.target.closest?.('[data-fpe-slide-drag]') || editor.__freePagePopupEdit) {
    event.preventDefault();
    return;
  }
  syncCurrentSlide(editor);
  editor.__freePageDraggedSlide = thumb.dataset.fpeSlideId;
  thumb.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', thumb.dataset.fpeSlideId);
}

function handleSlideDragOver(editor, event) {
  const layerRow = event.target.closest?.('.free-page-layer-row[draggable="true"]');
  if (layerRow && editor.__freePageDraggedLayer && !editor.__freePagePopupEdit) {
    event.preventDefault();
    editor.querySelectorAll('.free-page-layer-row.is-drop-target').forEach((item) => item.classList.remove('is-drop-target'));
    layerRow.classList.add('is-drop-target');
    event.dataTransfer.dropEffect = 'move';
    return;
  }
  const thumb = event.target.closest?.('[data-fpe-slide-id]');
  if (!thumb || !editor.__freePageDraggedSlide || editor.__freePagePopupEdit) return;
  event.preventDefault();
  editor.querySelectorAll('.free-page-slide-thumb.is-drop-target').forEach((item) => item.classList.remove('is-drop-target'));
  thumb.classList.add('is-drop-target');
  event.dataTransfer.dropEffect = 'move';
}

function handleSlideDrop(editor, event) {
  const targetLayer = event.target.closest?.('.free-page-layer-row[draggable="true"]');
  const sourceLayerId = editor.__freePageDraggedLayer || event.dataTransfer?.getData('application/x-grimorium-layer');
  if (targetLayer && sourceLayerId && !editor.__freePagePopupEdit) {
    event.preventDefault();
    reorderLayer(editor, sourceLayerId, targetLayer.dataset.layerId);
    clearSlideDragState(editor);
    return;
  }
  const targetThumb = event.target.closest?.('[data-fpe-slide-id]');
  const sourceId = editor.__freePageDraggedSlide || event.dataTransfer?.getData('text/plain');
  const targetId = targetThumb?.dataset.fpeSlideId;
  if (!sourceId || !targetId || sourceId === targetId || editor.__freePagePopupEdit) return clearSlideDragState(editor);
  event.preventDefault();
  const slides = editor.__freePageDeck?.slides || [];
  const from = slides.findIndex((slide) => slide.id === sourceId);
  const to = slides.findIndex((slide) => slide.id === targetId);
  if (from < 0 || to < 0) return clearSlideDragState(editor);
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved);
  clearSlideDragState(editor);
  renderSlides(editor);
}

function clearSlideDragState(editor) {
  editor.__freePageDraggedSlide = null;
  editor.__freePageDraggedLayer = null;
  editor.querySelectorAll('.free-page-slide-thumb.is-dragging, .free-page-slide-thumb.is-drop-target')
    .forEach((item) => item.classList.remove('is-dragging', 'is-drop-target'));
  editor.querySelectorAll('.free-page-layer-row.is-dragging, .free-page-layer-row.is-drop-target')
    .forEach((item) => item.classList.remove('is-dragging', 'is-drop-target'));
}

function reorderLayer(editor, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const blocks = editor.__freePageState?.blocks || [];
  const ordered = [...blocks].sort((a, b) => (b.z || 0) - (a.z || 0));
  const from = ordered.findIndex((block) => block.id === sourceId);
  const to = ordered.findIndex((block) => block.id === targetId);
  if (from < 0 || to < 0) return;
  pushHistory(editor);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  const maxZ = ordered.length;
  ordered.forEach((block, index) => { block.z = maxZ - index; });
  renderBlocks(editor, sourceId);
}

function switchSlide(editor, slideId) {
  if (editor.__freePagePopupEdit) return;
  syncLiveBlock(editor);
  syncCurrentSlide(editor);
  const slide = editor.__freePageDeck.slides.find((item) => item.id === slideId) || editor.__freePageDeck.slides[0];
  editor.__freePageSlideId = slide.id;
  editor.__freePageDeck.activeSlideId = slide.id;
  editor.__freePageState = normalizeSingleFreePage(slide.page);
  editor.__freePageSelected = null;
  editor.__freePageSelectedIds = [];
  editor.__freePageUndo = [];
  editor.__freePageRedo = [];
  renderBlocks(editor, null);
  renderInspector(editor);
}

function addTextBlock(editor, { content = '<p>Nouveau texte</p>' } = {}) {
  if (editor.__freePageState.blocks.length >= MAX_BLOCKS) return showNotif('Nombre maximum de blocs atteint.', 'info');
  pushHistory(editor);
  const offset = (editor.__freePageState.blocks.length % 6) * 18;
  const block = normalizeBlock({ type: 'text', x: 70 + offset, y: 55 + offset, w: 540, h: 180, z: nextZ(editor), content }, 0, editor.__freePageState.height);
  editor.__freePageState.blocks.push(block);
  renderBlocks(editor, block.id);
}

function addImageBlock(editor) {
  const imageCount = editor.__freePageState.blocks.filter((block) => block.type === 'image').length;
  if (imageCount >= MAX_IMAGES) return showNotif(`Maximum ${MAX_IMAGES} images par diapo.`, 'info');
  pickImageFile({ onImage: async ({ dataUrl }) => {
    showNotif("Preparation de l'image...", 'info');
    const src = await compressPageImage(dataUrl);
    if (!src) return showNotif("L'image est trop lourde. Essaie une image plus petite.", 'error');
    const aspect = await imageAspectFromDataUrl(src);
    pushHistory(editor);
    const block = normalizeBlock({ type: 'image', x: 110, y: 90, w: 420, h: 260, z: nextZ(editor), src, imageAspect: aspect }, 0, editor.__freePageState.height);
    editor.__freePageState.blocks.push(block);
    renderBlocks(editor, block.id);
  }});
}

function replaceImageBlock(editor) {
  const block = selectedBlock(editor);
  if (block?.type !== 'image') return;
  pickImageFile({ onImage: async ({ dataUrl }) => {
    showNotif("Preparation de la nouvelle image...", 'info');
    const src = await compressPageImage(dataUrl);
    if (!src) return showNotif("L'image est trop lourde. Essaie une image plus petite.", 'error');
    const aspect = await imageAspectFromDataUrl(src);
    pushHistory(editor);
    block.src = src;
    block.imageAspect = aspect;
    block.cropModel = '';
    block.cropX = 50;
    block.cropY = 50;
    block.zoom = 100;
    block.imageX = 0;
    block.imageY = 0;
    block.imageW = 100;
    block.imageH = 100;
    renderBlocks(editor, block.id);
  }});
}

function addTableBlock(editor) {
  if (editor.__freePageState.blocks.length >= MAX_BLOCKS) return showNotif('Nombre maximum de blocs atteint.', 'info');
  pushHistory(editor);
  const block = normalizeBlock({ type: 'table', x: 95, y: 85, w: 520, h: 210, z: nextZ(editor), rows: normalizeRows(), header: true }, 0, editor.__freePageState.height);
  editor.__freePageState.blocks.push(block);
  renderBlocks(editor, block.id);
}

function addChartBlock(editor) {
  if (editor.__freePageState.blocks.length >= MAX_BLOCKS) return showNotif('Nombre maximum de blocs atteint.', 'info');
  pushHistory(editor);
  const block = normalizeBlock({ type: 'chart', x: 115, y: 100, w: 450, h: 300, z: nextZ(editor), title: 'Graphique' }, 0, editor.__freePageState.height);
  editor.__freePageState.blocks.push(block);
  renderBlocks(editor, block.id);
}

function addShapeBlock(editor, shape = 'rectangle') {
  if (editor.__freePageState.blocks.length >= MAX_BLOCKS) return showNotif('Nombre maximum de blocs atteint.', 'info');
  pushHistory(editor);
  const safeShape = SHAPE_TYPES.has(shape) ? shape : 'rectangle';
  const block = normalizeBlock({
    type: 'shape', x: 135, y: 115, w: safeShape === 'line' ? 360 : 240, h: safeShape === 'line' ? 36 : 150,
    z: nextZ(editor), shape: safeShape, fill: safeShape === 'line' ? DEFAULT_SHAPE_STROKE : DEFAULT_SHAPE_FILL, stroke: DEFAULT_SHAPE_STROKE,
    strokeWidth: safeShape === 'line' ? 4 : 1, radius: 12, shadow: false, shadowDepth: 28,
  }, 0, editor.__freePageState.height);
  editor.__freePageState.blocks.push(block);
  renderBlocks(editor, block.id);
}

async function compressPageImage(dataUrl) {
  if (await imageHasTransparency(dataUrl)) {
    // WebP lossy : conserve l'alpha ET compresse fortement (le PNG sans perte
    // faisait exploser la taille → rejet). On dégrade taille/qualité au besoin.
    for (const { max, quality } of [{ max: 1200, quality: .82 }, { max: 1000, quality: .74 }, { max: 820, quality: .64 }, { max: 680, quality: .54 }]) {
      const compressed = await compressTransparentDataUrl(dataUrl, max, quality);
      if (compressed && compressed.length <= 220000) return compressed;
    }
    return dataUrl.length <= 260000 ? dataUrl : null;
  }
  for (const options of [{ max: 1000, quality: .76 }, { max: 820, quality: .64 }, { max: 680, quality: .54 }]) {
    const compressed = await compressDataUrl(dataUrl, options);
    if (compressed.length <= 140000) return compressed;
  }
  return null;
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function imageAspectFromDataUrl(dataUrl) {
  const img = await loadImageFromDataUrl(dataUrl);
  return img?.width && img?.height ? clamp(img.width / img.height, .05, 20) : 1;
}

async function imageHasTransparency(dataUrl) {
  if (!/^data:image\/(?:png|webp|gif|avif);/i.test(String(dataUrl || ''))) return false;
  const img = await loadImageFromDataUrl(dataUrl);
  if (!img) return false;
  const canvas = document.createElement('canvas');
  const w = Math.min(96, img.width || 1);
  const h = Math.min(96, img.height || 1);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  } catch { return /^data:image\/png;/i.test(dataUrl); }
  return false;
}

async function compressTransparentDataUrl(dataUrl, max = 900, quality = 0.82) {
  const img = await loadImageFromDataUrl(dataUrl);
  if (!img) return null;
  const ratio = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * ratio));
  const h = Math.max(1, Math.round((img.height || 1) * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  try {
    // WebP lossy PRÉSERVE la transparence tout en compressant bien plus qu'un PNG
    // sans perte. Si le navigateur ne sait pas encoder en WebP, il retombe sur un
    // PNG (préfixe différent) → on garde ce PNG en dernier recours.
    const webp = canvas.toDataURL('image/webp', quality);
    if (/^data:image\/webp/i.test(webp)) return webp;
    return canvas.toDataURL('image/png');
  } catch { return null; }
}

function mutateSelection(editor, action) {
  const block = selectedBlock(editor);
  const selection = selectedBlocks(editor);
  if (!block && action !== 'paste' && action !== 'unlock-all') return;
  const blocks = editor.__freePageState.blocks;
  if (action === 'delete') { pushHistory(editor); const ids = new Set(selection.map((item) => item.id)); editor.__freePageState.blocks = blocks.filter((item) => !ids.has(item.id)); renderBlocks(editor, null); return; }
  if (action === 'copy') {
    const payload = createBlocksClipboard(selection.length ? selection : [block], editor);
    editor.__freePageClipboard = payload;
    sharedFreePageClipboard = structuredClone(payload);
    syncToolbar(editor);
    return;
  }
  if (action === 'paste') return pasteCopiedBlock(editor);
  if (action === 'duplicate') {
    pushHistory(editor);
    // Tri stable par z croissant → la duplication préserve la superposition d'origine.
    const copies = selection.slice().sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0)).map((item, index) => normalizeBlock({ ...structuredClone(item), id: uid(), x: item.x + 25, y: item.y + 25, z: nextZ(editor) + index, locked: false }, 0, editor.__freePageState.height)).filter(Boolean);
    editor.__freePageState.blocks.push(...copies.slice(0, Math.max(0, MAX_BLOCKS - editor.__freePageState.blocks.length)));
    renderBlocks(editor, copies.at(-1)?.id || null);
    return;
  }
  if (action === 'toggle-lock') {
    pushHistory(editor);
    const shouldLock = selection.some((item) => !item.locked);
    selection.forEach((item) => { item.locked = shouldLock; });
    renderBlocks(editor, shouldLock ? null : editor.__freePageSelected);
    return;
  }
  if (action === 'toggle-hidden-block') {
    pushHistory(editor);
    const shouldHide = selection.some((item) => !item.hidden);
    selection.forEach((item) => { item.hidden = shouldHide; });
    renderBlocks(editor, shouldHide ? null : editor.__freePageSelected);
    return;
  }
  if (action === 'reset-rotation') {
    pushHistory(editor);
    selection.forEach((item) => { item.rotation = 0; });
    renderBlocks(editor, editor.__freePageSelected);
    return;
  }
  if (action === 'unlock-all') { pushHistory(editor); blocks.forEach((item) => { item.locked = false; }); renderBlocks(editor, null); return; }
  if (action === 'table-row' && block.type === 'table') { pushHistory(editor); const rows = normalizeRows(block.rows); block.rows = [...rows, Array.from({ length: rows[0]?.length || 2 }, () => '')]; renderBlocks(editor, block.id); return; }
  if (action === 'table-row-remove' && block.type === 'table') { const rows = normalizeRows(block.rows); if (rows.length <= 1) return; pushHistory(editor); block.rows = rows.slice(0, -1); renderBlocks(editor, block.id); return; }
  if (action === 'table-col' && block.type === 'table') { const rows = normalizeRows(block.rows); if ((rows[0]?.length || 0) >= 6) return; pushHistory(editor); block.rows = rows.map((row) => [...row, '']); renderBlocks(editor, block.id); return; }
  if (action === 'table-col-remove' && block.type === 'table') { const rows = normalizeRows(block.rows); if ((rows[0]?.length || 0) <= 1) return; pushHistory(editor); block.rows = rows.map((row) => row.slice(0, -1)); renderBlocks(editor, block.id); return; }
  if (action === 'table-header' && block.type === 'table') { pushHistory(editor); block.header = !block.header; renderBlocks(editor, block.id); return; }
  if ((action === 'chart-item' || action === 'chart-row-add') && block.type === 'chart') { const items = normalizeItems(block.items, block.chartPalette); if (items.length >= 12) return; pushHistory(editor); block.items = [...items, { label: `Donnee ${items.length + 1}`, value: 1, color: chartColor('', items.length, block.chartPalette), note: '' }]; renderBlocks(editor, block.id); return; }
  if ((action === 'chart-item-remove' || action === 'chart-row-remove') && block.type === 'chart') { const items = normalizeItems(block.items, block.chartPalette); if (items.length <= 1) return; pushHistory(editor); block.items = items.slice(0, -1); renderBlocks(editor, block.id); return; }
  if (action === 'chart-col-add' && block.type === 'chart') { pushHistory(editor); block.chartColumnCount = clamp((block.chartColumnCount || 2) + 1, 2, CHART_COLUMNS.length); renderInspector(editor); return; }
  if (action === 'chart-col-remove' && block.type === 'chart') { pushHistory(editor); block.chartColumnCount = clamp((block.chartColumnCount || CHART_COLUMNS.length) - 1, 2, CHART_COLUMNS.length); renderInspector(editor); return; }
  if (action.startsWith('align-')) {
    pushHistory(editor);
    alignSelectedBlocks(editor, action);
    renderBlocks(editor, editor.__freePageSelected);
    return;
  }
  if (action === 'distribute-x' || action === 'distribute-y') {
    if (selection.filter((item) => !item.locked).length < 3) return showNotif('Selectionne au moins 3 blocs non verrouilles a repartir.', 'info');
    pushHistory(editor);
    distributeSelectedBlocks(editor, action === 'distribute-x' ? 'x' : 'y');
    renderBlocks(editor, editor.__freePageSelected);
    return;
  }
  if (action === 'group-selected') {
    pushHistory(editor);
    const groupId = block.groupId || `grp-${Date.now().toString(36)}`;
    const targets = selection.length > 1 ? selection : blocks.filter((item) => item.id === block.id || blocksOverlap(block, item));
    targets.forEach((item) => { item.groupId = groupId; });
    renderBlocks(editor, block.id);
    return;
  }
  if (action === 'ungroup') { pushHistory(editor); blocks.forEach((item) => { if (!block.groupId || item.groupId === block.groupId) item.groupId = ''; }); renderBlocks(editor, block.id); return; }
  if (action === 'layer-up') { pushHistory(editor); selection.forEach((item, index) => { item.z = nextZ(editor) + index; }); renderBlocks(editor, editor.__freePageSelected); return; }
  if (action === 'layer-down') { pushHistory(editor); const min = Math.max(1, Math.min(...blocks.map((item) => item.z || 1)) - 1); selection.forEach((item, index) => { item.z = Math.max(1, min - index); }); renderBlocks(editor, editor.__freePageSelected); }
}

function pasteCopiedBlock(editor) {
  const source = normalizeBlocksClipboard(editor.__freePageClipboard || sharedFreePageClipboard);
  if (!source) return showNotif('Aucun bloc a coller.', 'info');
  if (!canPasteBlock(editor)) return;
  pushHistory(editor);
  const available = Math.max(0, MAX_BLOCKS - editor.__freePageState.blocks.length);
  const imageCount = editor.__freePageState.blocks.filter((block) => block.type === 'image').length;
  let addedImages = 0;
  const sameSlide = source.sourceDeckId
    && source.sourceDeckId === editor.__freePageDeck?.id
    && source.sourceSlideId === editor.__freePageSlideId;
  const offset = sameSlide ? (source.pasteCount || 0) * 22 : 0;
  const groupMap = new Map();
  // Réassigner les z dans l'ORDRE DE SUPERPOSITION d'origine (tri stable par z
  // croissant) → un texte devant une forme reste devant après collage. Sans ce
  // tri, l'ordre du presse-papiers (ordre de sélection) écrasait l'empilement.
  const copies = source.blocks
    .slice()
    .sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0))
    .slice(0, available)
    .filter((item) => item.type !== 'image' || imageCount + (++addedImages) <= MAX_IMAGES)
    .map((item, index) => normalizeBlock({
      ...structuredClone(item),
      id: uid(),
      x: clamp(item.x + offset, 0, PAGE_WIDTH - Math.max(1, item.w)),
      y: clamp(item.y + offset, 0, editor.__freePageState.height - Math.max(1, item.h)),
      z: nextZ(editor) + index,
      groupId: mapClipboardGroupId(item.groupId, groupMap),
    }, 0, editor.__freePageState.height));
  if (!copies.length) return showNotif('Impossible de coller ces blocs ici.', 'info');
  source.pasteCount = (source.pasteCount || 0) + 1;
  editor.__freePageClipboard = source;
  sharedFreePageClipboard = structuredClone(source);
  editor.__freePageState.blocks.push(...copies);
  renderBlocks(editor, copies.at(-1)?.id || null);
  setMultiSelected(editor, copies.map((item) => item.id));
}

function canPasteBlock(editor) {
  const source = normalizeBlocksClipboard(editor.__freePageClipboard || sharedFreePageClipboard);
  if (!source?.blocks?.length || editor.__freePageState.blocks.length >= MAX_BLOCKS) return false;
  const imageCount = editor.__freePageState.blocks.filter((block) => block.type === 'image').length;
  return source.blocks.some((block) => block.type !== 'image' || imageCount < MAX_IMAGES);
}

function createBlocksClipboard(blocks, editor = null) {
  const pageHeight = Math.max(DEFAULT_HEIGHT, ...(blocks || []).map((block) => (Number(block?.y) || 0) + (Number(block?.h) || 0) + 20));
  const normalized = (blocks || [])
    .filter((block) => block && BLOCK_TYPES.has(block.type))
    .map((block) => normalizeBlock(structuredClone(block), 0, pageHeight));
  const bounds = blocksBounds(normalized);
  return { kind: 'grimorium-blocks', version: 1, blocks: normalized, bounds, sourceDeckId: editor?.__freePageDeck?.id || '', sourceSlideId: editor?.__freePageSlideId || '', pasteCount: 0 };
}

function normalizeBlocksClipboard(value) {
  if (!value) return null;
  if (Array.isArray(value.blocks)) {
    const pageHeight = Math.max(DEFAULT_HEIGHT, ...value.blocks.map((block) => (Number(block?.y) || 0) + (Number(block?.h) || 0) + 20));
    const blocks = value.blocks
      .filter((block) => block && BLOCK_TYPES.has(block.type))
      .map((block) => normalizeBlock(structuredClone(block), 0, pageHeight));
    return blocks.length ? { kind: 'grimorium-blocks', version: 1, blocks, bounds: value.bounds || blocksBounds(blocks), sourceDeckId: String(value.sourceDeckId || ''), sourceSlideId: String(value.sourceSlideId || ''), pasteCount: Number(value.pasteCount) || 0 } : null;
  }
  if (BLOCK_TYPES.has(value.type)) return createBlocksClipboard([value]);
  return null;
}

function mapClipboardGroupId(groupId, groupMap) {
  if (!groupId) return '';
  if (!groupMap.has(groupId)) groupMap.set(groupId, `grp-${Date.now().toString(36)}-${groupMap.size}`);
  return groupMap.get(groupId);
}

function blocksBounds(blocks) {
  if (!blocks?.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...blocks.map((block) => Number(block.x) || 0));
  const minY = Math.min(...blocks.map((block) => Number(block.y) || 0));
  const maxX = Math.max(...blocks.map((block) => (Number(block.x) || 0) + (Number(block.w) || 0)));
  const maxY = Math.max(...blocks.map((block) => (Number(block.y) || 0) + (Number(block.h) || 0)));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function handlePointerDown(editor, event) {
  if (event.button !== 0) return;
  const resizeHandle = event.target.closest('[data-fpe-resize]');
  const radiusHandle = event.target.closest('[data-fpe-radius]');
  const rotateHandle = event.target.closest('[data-fpe-rotate]');
  const cropDragHandle = event.target.closest('[data-fpe-crop-drag]');
  const cropZoomHandle = event.target.closest('[data-fpe-crop-zoom]');
  const moveHandle = event.target.closest('[data-fpe-move]');
  const navEl = event.target.closest('[data-fpe-nav-block]');
  const directImageBlock = event.target.closest('.free-page-block--image[data-fpe-block]');
  const directBlock = event.target.closest('[data-fpe-block]');
  const workspace = event.target.closest('.free-page-workspace');
  const croppingId = editor.__freePageCropBlockId;
  const clickedCroppingBlock = croppingId && event.target.closest(`[data-fpe-block="${cssEscape(croppingId)}"]`);
  if (croppingId && event.target.closest('[data-fpe-composition]') && !clickedCroppingBlock && !event.target.closest('button, input, textarea, select, [contenteditable="true"]')) {
    editor.__freePageCropBlockId = null;
    renderBlocks(editor, editor.__freePageSelected);
    return;
  }
  if (event.target.closest('[data-fpe-popup-frame-move], [data-fpe-popup-frame-resize]')) return startPopupFrameDrag(editor, event);
  if (navEl) return startNavComponentDrag(editor, event, navEl, resizeHandle);
  if ((event.ctrlKey || event.metaKey) && directBlock && !resizeHandle && !radiusHandle && !rotateHandle && !cropDragHandle && !cropZoomHandle && !moveHandle) return;
  const canDirectDrag = directBlock
    && !event.target.closest('[contenteditable="true"], input, textarea, select, button, [data-fpe-resize], [data-fpe-radius], [data-fpe-rotate], [data-fpe-crop-drag], [data-fpe-crop-zoom], [data-fpe-interaction-button]');
  const directImageMoveBlock = directImageBlock && editor.__freePageCropBlockId !== directImageBlock.dataset.fpeBlock ? directImageBlock : null;
  const handle = resizeHandle || radiusHandle || rotateHandle || cropDragHandle || cropZoomHandle || moveHandle || directImageMoveBlock || (canDirectDrag ? directBlock : null);
  if (!handle) {
    if (workspace && !event.target.closest('[data-fpe-block], button, input, textarea, select, [contenteditable="true"], [data-fpe-nav-block]')) {
      startMarqueeSelection(editor, event);
    }
    return;
  }
  const blockEl = directImageBlock || handle.closest('[data-fpe-block]');
  const block = editor.__freePageState.blocks.find((item) => item.id === blockEl?.dataset.fpeBlock);
  if (!block) return;
  if (block.locked) return;
  event.preventDefault();
  const selectedIds = new Set(editor.__freePageSelectedIds || []);
  const draggingMultiSelection = selectedIds.size > 1 && selectedIds.has(block.id) && !resizeHandle && !radiusHandle && !rotateHandle && !cropDragHandle && !cropZoomHandle;
  if (!draggingMultiSelection) setSelected(editor, block.id);
  if ((cropDragHandle || cropZoomHandle) && block.type === 'image') return startImageCropDrag(editor, event, blockEl, block, { move: Boolean(cropDragHandle && !cropZoomHandle), zoomHandle: cropZoomHandle?.dataset.fpeCropZoom || '' });
  handle.setPointerCapture?.(event.pointerId);
  const stage = blockEl.closest('[data-fpe-composition]') || editor.querySelector('[data-fpe-stage]');
  const rect = stage.getBoundingClientRect();
  const blockRect = blockEl.getBoundingClientRect();
  const center = { x: blockRect.left + blockRect.width / 2, y: blockRect.top + blockRect.height / 2 };
  const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI;
  const start = { clientX: event.clientX, clientY: event.clientY, x: block.x, y: block.y, w: block.w, h: block.h, radius: block.radius || 0, rotation: block.rotation || 0, imageX: block.imageX ?? 0, imageY: block.imageY ?? 0, imageW: block.imageW ?? 100, imageH: block.imageH ?? 100 };
  const resizeDir = resizeHandle?.dataset.fpeResize || 'se';
  const moveTargets = draggingMultiSelection ? selectedBlocks(editor).filter((item) => !item.locked) : groupMembers(editor, block);
  const groupStart = moveTargets.map((item) => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h }));
  let historyCaptured = false;
  const rotationBadge = rotateHandle ? blockEl.querySelector('[data-fpe-rotation-badge]') : null;
  if (rotateHandle) {
    blockEl.classList.add('is-rotating');
    blockEl.classList.remove('is-rotation-snapped');
    if (rotationBadge) rotationBadge.textContent = `${normalizeRotation(block.rotation || 0)}\u00B0`;
  }
  const onMove = (moveEvent) => {
    if (!historyCaptured) { pushHistory(editor); historyCaptured = true; }
    const dx = (moveEvent.clientX - start.clientX) / rect.width * PAGE_WIDTH;
    const dy = (moveEvent.clientY - start.clientY) / rect.height * editor.__freePageState.height;
    if (rotateHandle) {
      const angle = Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * 180 / Math.PI;
      const next = start.rotation + angle - startAngle;
      const snapped = snapRotation(next, { forceStep: moveEvent.shiftKey ? 15 : 0 });
      block.rotation = snapped.angle;
      blockEl.classList.toggle('is-rotation-snapped', snapped.snapped);
      blockEl.setAttribute('style', blockStyle(block, editor.__freePageState.height));
      if (rotationBadge) rotationBadge.textContent = `${block.rotation}\u00B0`;
    } else if (radiusHandle) {
      block.radius = Math.round(clamp(start.radius - dx, 0, 80));
      blockEl.querySelector('.free-page-shape')?.style.setProperty('--shape-radius', `${block.radius}px`);
    } else if (resizeHandle) {
      resizeBlockFromStart(editor, block, start, dx, dy, resizeDir, editor.__freePageState.height);
      blockEl.setAttribute('style', blockStyle(block, editor.__freePageState.height));
      if (block.type === 'image' && editor.__freePageCropBlockId === block.id) {
        updateSelectedImageStyle(editor, block);
        syncImageCropInspector(editor, block);
      }
    } else {
      moveGroupFromStart(editor, groupStart, snapValue(editor, dx), snapValue(editor, dy));
      groupStart.forEach((item) => {
        const member = editor.__freePageState.blocks.find((candidate) => candidate.id === item.id);
        const memberEl = editor.querySelector(`[data-fpe-block="${cssEscape(item.id)}"]`);
        if (member && memberEl) memberEl.setAttribute('style', blockStyle(member, editor.__freePageState.height));
      });
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    blockEl.classList.remove('is-rotating');
    blockEl.classList.remove('is-rotation-snapped');
    renderInspector(editor);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function startImageCropDrag(editor, event, blockEl, block, { move = false, zoomHandle = '' } = {}) {
  event.preventDefault();
  event.stopPropagation();
  editor.__freePageCropBlockId = block.id;
  normalizeImageCropRect(block);
  const rect = blockEl.getBoundingClientRect();
  const frameW = Math.max(1, rect.width);
  const frameH = Math.max(1, rect.height);
  const imageMin = 24;
  const startPx = {
    x: frameW * (Number(block.imageX ?? 0) / 100),
    y: frameH * (Number(block.imageY ?? 0) / 100),
    w: frameW * (Number(block.imageW ?? 100) / 100),
    h: frameH * (Number(block.imageH ?? 100) / 100),
  };
  const start = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  let historyCaptured = false;
  event.target.setPointerCapture?.(event.pointerId);
  const onMove = (moveEvent) => {
    if (!historyCaptured) { pushHistory(editor); historyCaptured = true; }
    const dx = moveEvent.clientX - start.clientX;
    const dy = moveEvent.clientY - start.clientY;
    if (move) {
      block.imageX = Math.round(clamp((startPx.x + dx) / frameW * 100, -260, 260));
      block.imageY = Math.round(clamp((startPx.y + dy) / frameH * 100, -260, 260));
    } else {
      const next = resizeCropImageRect(startPx, dx, dy, zoomHandle, imageMin);
      block.imageX = Math.round(clamp(next.x / frameW * 100, -900, 900));
      block.imageY = Math.round(clamp(next.y / frameH * 100, -900, 900));
      block.imageW = Math.round(clamp(next.w / frameW * 100, imageMin / frameW * 100, 900));
      block.imageH = Math.round(clamp(next.h / frameH * 100, imageMin / frameH * 100, 900));
    }
    syncLegacyImageCropFields(block);
    updateSelectedImageStyle(editor, block);
    syncImageCropInspector(editor, block);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function resizeCropImageRect(start, dx, dy, dir, minSize) {
  if (!dir) return start;
  const ratio = Math.max(.05, start.w / Math.max(1, start.h));
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  if (dir.length === 2) {
    const rawW = dir.includes('e') ? start.w + dx : start.w - dx;
    const rawH = dir.includes('s') ? start.h + dy : start.h - dy;
    const useWidth = Math.abs(rawW - start.w) / Math.max(1, start.w) >= Math.abs(rawH - start.h) / Math.max(1, start.h);
    w = Math.max(minSize, useWidth ? rawW : rawH * ratio);
    h = Math.max(minSize, useWidth ? w / ratio : rawH);
    if (dir.includes('w')) x = start.x + start.w - w;
    if (dir.includes('n')) y = start.y + start.h - h;
    return { x, y, w, h };
  }
  if (dir === 'e') w = Math.max(minSize, start.w + dx);
  if (dir === 's') h = Math.max(minSize, start.h + dy);
  if (dir === 'w') {
    w = Math.max(minSize, start.w - dx);
    x = start.x + start.w - w;
  }
  if (dir === 'n') {
    h = Math.max(minSize, start.h - dy);
    y = start.y + start.h - h;
  }
  return { x, y, w, h };
}

function syncLegacyImageCropFields(block) {
  if (block?.type !== 'image') return;
  block.cropX = block.imageW === 100 ? 50 : clamp((0 - block.imageX) / Math.max(1, block.imageW - 100) * 100, 0, 100);
  block.cropY = block.imageH === 100 ? 50 : clamp((0 - block.imageY) / Math.max(1, block.imageH - 100) * 100, 0, 100);
  block.zoom = Math.round(Math.max(block.imageW, block.imageH));
}

function syncImageAspectFromDom(editor, block) {
  if (block?.type !== 'image') return;
  const img = editor.querySelector(`[data-fpe-block="${cssEscape(block.id)}"] .free-page-image`);
  if (img?.naturalWidth && img?.naturalHeight) block.imageAspect = clamp(img.naturalWidth / img.naturalHeight, .05, 20);
}

function normalizeImageCropRect(block) {
  if (block?.type !== 'image' || block.cropModel === 'rect') return;
  const rect = imageRenderedRect(block);
  block.imageX = Math.round(rect.x);
  block.imageY = Math.round(rect.y);
  block.imageW = Math.round(rect.w);
  block.imageH = Math.round(rect.h);
  block.cropModel = 'rect';
  syncLegacyImageCropFields(block);
}

function imageRenderedRect(block) {
  const x = Number(block.imageX ?? 0);
  const y = Number(block.imageY ?? 0);
  const w = Math.max(1, Number(block.imageW ?? 100));
  const h = Math.max(1, Number(block.imageH ?? 100));
  const fit = block.fit || 'contain';
  if (fit !== 'contain') return { x, y, w, h };
  const frameW = Math.max(1, Number(block.w) || 1);
  const frameH = Math.max(1, Number(block.h) || 1);
  const imageAspect = Math.max(.05, Number(block.imageAspect) || 1);
  const boxW = frameW * w / 100;
  const boxH = frameH * h / 100;
  if (!boxW || !boxH) return { x, y, w, h };
  const boxAspect = boxW / boxH;
  let visibleW = boxW;
  let visibleH = boxH;
  let offsetX = 0;
  let offsetY = 0;
  if (boxAspect > imageAspect) {
    visibleW = boxH * imageAspect;
    offsetX = (boxW - visibleW) / 2;
  } else if (boxAspect < imageAspect) {
    visibleH = boxW / imageAspect;
    offsetY = (boxH - visibleH) / 2;
  }
  return {
    x: x + offsetX / frameW * 100,
    y: y + offsetY / frameH * 100,
    w: visibleW / frameW * 100,
    h: visibleH / frameH * 100,
  };
}

function resizeBlockFromStart(editor, block, start, dx, dy, dir, pageHeight) {
  const minW = block.type === 'text' ? 20 : block.type === 'chart' ? 180 : block.type === 'image' ? 30 : 12;
  const minH = block.type === 'text' ? 12 : block.type === 'shape' ? 8 : block.type === 'chart' ? 120 : block.type === 'image' ? 24 : 12;
  const snap = (value) => snapValue(editor, value);
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  if (dir.includes('e')) w = clamp(start.w + dx, minW, PAGE_WIDTH - start.x);
  if (dir.includes('s')) h = clamp(start.h + dy, minH, pageHeight - start.y);
  if (dir.includes('w')) {
    const maxX = start.x + start.w - minW;
    x = clamp(start.x + dx, 0, maxX);
    w = start.x + start.w - x;
  }
  if (dir.includes('n')) {
    const maxY = start.y + start.h - minH;
    y = clamp(start.y + dy, 0, maxY);
    h = start.y + start.h - y;
  }
  block.x = clamp(snap(x), 0, PAGE_WIDTH - minW);
  block.y = clamp(snap(y), 0, pageHeight - minH);
  block.w = clamp(snap(w), minW, PAGE_WIDTH - block.x);
  block.h = clamp(snap(h), minH, pageHeight - block.y);
  if (block.type === 'image' && editor.__freePageCropBlockId === block.id) preserveCropImagePixels(block, start);
}

function preserveCropImagePixels(block, start) {
  const oldFrameW = Math.max(1, Number(start.w) || 1);
  const oldFrameH = Math.max(1, Number(start.h) || 1);
  const newFrameW = Math.max(1, Number(block.w) || 1);
  const newFrameH = Math.max(1, Number(block.h) || 1);
  const oldImageLeft = (Number(start.x) || 0) + oldFrameW * (Number(start.imageX ?? 0) / 100);
  const oldImageTop = (Number(start.y) || 0) + oldFrameH * (Number(start.imageY ?? 0) / 100);
  const oldImageW = oldFrameW * (Number(start.imageW ?? 100) / 100);
  const oldImageH = oldFrameH * (Number(start.imageH ?? 100) / 100);
  block.imageX = Math.round(clamp((oldImageLeft - block.x) / newFrameW * 100, -900, 900));
  block.imageY = Math.round(clamp((oldImageTop - block.y) / newFrameH * 100, -900, 900));
  block.imageW = Math.round(clamp(oldImageW / newFrameW * 100, 1, 900));
  block.imageH = Math.round(clamp(oldImageH / newFrameH * 100, 1, 900));
  syncLegacyImageCropFields(block);
}

function startNavComponentDrag(editor, event, navEl, resizeHandle) {
  if (!editor.__freePageDeck?.nav?.enabled || event.target.closest('button, summary')) return;
  event.preventDefault();
  setSelected(editor, NAV_BLOCK_ID);
  const nav = editor.__freePageDeck.nav = normalizeDeckNav(editor.__freePageDeck.nav, editor.__freePageDeck.slides);
  const stage = navEl.closest('[data-fpe-composition]') || editor.querySelector('[data-fpe-stage]');
  const rect = stage.getBoundingClientRect();
  const start = { clientX: event.clientX, clientY: event.clientY, x: nav.x, y: nav.y, w: nav.w, h: nav.h };
  const resizeDir = resizeHandle?.dataset.fpeResize || '';
  let historyCaptured = false;
  const onMove = (moveEvent) => {
    if (!historyCaptured) { pushHistory(editor); historyCaptured = true; }
    const dx = (moveEvent.clientX - start.clientX) / rect.width * PAGE_WIDTH;
    const dy = (moveEvent.clientY - start.clientY) / rect.height * editor.__freePageState.height;
    if (resizeDir) {
      resizeNavFromStart(editor, nav, start, dx, dy, resizeDir);
    } else {
      nav.x = Math.round(clamp(snapValue(editor, start.x + dx), 0, PAGE_WIDTH - nav.w));
      nav.y = Math.round(clamp(snapValue(editor, start.y + dy), 0, DEFAULT_HEIGHT - nav.h));
    }
    navEl.setAttribute('style', navBlockStyle(nav));
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    renderInspector(editor);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function resizeNavFromStart(editor, nav, start, dx, dy, dir) {
  const minW = nav.style === 'menu' ? 44 : 220;
  const minH = 34;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  if (dir.includes('e')) w = clamp(start.w + dx, minW, PAGE_WIDTH - start.x);
  if (dir.includes('s')) h = clamp(start.h + dy, minH, DEFAULT_HEIGHT - start.y);
  if (dir.includes('w')) {
    const maxX = start.x + start.w - minW;
    x = clamp(start.x + dx, 0, maxX);
    w = start.x + start.w - x;
  }
  if (dir.includes('n')) {
    const maxY = start.y + start.h - minH;
    y = clamp(start.y + dy, 0, maxY);
    h = start.y + start.h - y;
  }
  nav.x = Math.round(clamp(snapValue(editor, x), 0, PAGE_WIDTH - minW));
  nav.y = Math.round(clamp(snapValue(editor, y), 0, DEFAULT_HEIGHT - minH));
  nav.w = Math.round(clamp(snapValue(editor, w), minW, PAGE_WIDTH - nav.x));
  nav.h = Math.round(clamp(snapValue(editor, h), minH, DEFAULT_HEIGHT - nav.y));
}

function startMarqueeSelection(editor, event) {
  const stage = event.target.closest('[data-fpe-composition]') || editor.querySelector('[data-fpe-composition]');
  if (!stage) return;
  event.preventDefault();
  const rect = stage.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'free-page-marquee';
  stage.appendChild(box);
  const start = {
    x: clamp((event.clientX - rect.left) / rect.width * PAGE_WIDTH, 0, PAGE_WIDTH),
    y: clamp((event.clientY - rect.top) / rect.height * editor.__freePageState.height, 0, editor.__freePageState.height),
  };
  const inherited = event.ctrlKey || event.metaKey ? new Set(editor.__freePageSelectedIds || []) : new Set();
  const paint = (moveEvent) => {
    const current = {
      x: clamp((moveEvent.clientX - rect.left) / rect.width * PAGE_WIDTH, 0, PAGE_WIDTH),
      y: clamp((moveEvent.clientY - rect.top) / rect.height * editor.__freePageState.height, 0, editor.__freePageState.height),
    };
    const area = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y),
    };
    box.style.left = `${area.x / 10}%`;
    box.style.top = `${area.y / editor.__freePageState.height * 100}%`;
    box.style.width = `${area.w / 10}%`;
    box.style.height = `${area.h / editor.__freePageState.height * 100}%`;
    const picked = editor.__freePageState.blocks
      .filter((block) => blocksOverlap({ ...area, id: '__marquee__' }, block))
      .map((block) => block.id);
    setMultiSelected(editor, [...inherited, ...picked]);
  };
  const done = () => {
    window.removeEventListener('pointermove', paint);
    box.remove();
  };
  window.addEventListener('pointermove', paint);
  window.addEventListener('pointerup', done, { once: true });
}

function togglePopupFrameLock(editor) {
  const session = editor.__freePagePopupEdit;
  if (!session) return;
  session.frame = normalizePopupFrame(session.frame, session.layout);
  session.frame.locked = !session.frame.locked;
  renderBlocks(editor, editor.__freePageSelected);
}

function startPopupFrameDrag(editor, event) {
  const session = editor.__freePagePopupEdit;
  const frame = session ? normalizePopupFrame(session.frame, session.layout) : null;
  if (!session || !frame || frame.locked) return;
  const isResize = Boolean(event.target.closest('[data-fpe-popup-frame-resize]'));
  const isMove = Boolean(event.target.closest('[data-fpe-popup-frame-move]'));
  if (!isResize && !isMove) return;
  event.preventDefault();
  event.stopPropagation();
  const stage = editor.querySelector('[data-fpe-stage]');
  const windowEl = editor.querySelector('[data-fpe-inline-popup] .free-page-inline-window');
  const rect = stage.getBoundingClientRect();
  const start = { clientX: event.clientX, clientY: event.clientY, ...frame };
  const apply = () => {
    session.frame = normalizePopupFrame(frame, session.layout);
    if (windowEl) windowEl.setAttribute('style', popupFrameStyle(session.frame, editor.__freePageState.height));
  };
  const onMove = (moveEvent) => {
    const dx = (moveEvent.clientX - start.clientX) / rect.width * PAGE_WIDTH;
    const dy = (moveEvent.clientY - start.clientY) / rect.height * DEFAULT_HEIGHT;
    if (isResize) {
      frame.w = Math.round(clamp(start.w + dx, POPUP_FRAME_MIN_W, PAGE_WIDTH - frame.x));
      frame.h = Math.round(clamp(start.h + dy, POPUP_FRAME_MIN_H, DEFAULT_HEIGHT - frame.y));
    } else {
      frame.x = Math.round(clamp(start.x + dx, 0, PAGE_WIDTH - frame.w));
      frame.y = Math.round(clamp(start.y + dy, 0, DEFAULT_HEIGHT - frame.h));
    }
    apply();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    renderBlocks(editor, editor.__freePageSelected);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function handleInspectorInput(editor, event, { commit = false } = {}) {
  const target = event.target;
  const field = target.dataset.fpeInspectorField;
  const chartField = target.dataset.fpeInspectorChartField;
  const chartOption = target.dataset.fpeInspectorChartOption;
  const tableCell = target.closest?.('[data-fpe-inspector-table-cell]');
  if (!field && !chartField && !chartOption && !tableCell) return;
  let block = selectedBlock(editor);
  if (!block && ['fontSize', 'textColor', 'fontFamily', 'textTransform'].includes(field) && editor.__freePageTextRange?.blockId) {
    block = editor.__freePageState.blocks.find((item) => item.id === editor.__freePageTextRange.blockId) || null;
    if (block) {
      editor.__freePageSelected = block.id;
      editor.__freePageSelectedIds = [block.id];
      applySelectionClasses(editor);
    }
  }
  if (!block) return;
  const hadPopupPage = field === 'interactionType' ? normalizeInteraction(block.interaction).page : null;
  scheduleHistory(editor, { sync: false });
  if (tableCell && block.type === 'table') {
    const rows = normalizeRows(block.rows);
    const row = Number(tableCell.dataset.row);
    const col = Number(tableCell.dataset.col);
    if (rows[row]) rows[row][col] = String(tableCell.value || '').slice(0, 160);
    block.rows = rows;
  }
  if (chartField && block.type === 'chart') {
    const index = Number(target.dataset.index);
    const items = normalizeItems(block.items, block.chartPalette);
    if (items[index]) {
      if (chartField === 'value') items[index].value = clamp(target.value, 0, 999);
      else if (chartField === 'color') items[index].color = chartColor(target.value, index, block.chartPalette);
      else items[index][chartField] = String(target.value || '').slice(0, chartField === 'note' ? 90 : 34);
      block.items = items;
    }
  }
  if (chartOption && block.type === 'chart') block[chartOption] = target.checked;
  const toggleValue = field === 'textTransform' && target.value === 'toggle'
    ? (block.textTransform === 'uppercase' ? 'none' : 'uppercase')
    : '';
  const inlineTextApplied = field && applyInspectorTextRangeField(editor, block, field, target, toggleValue);
  if (field && !inlineTextApplied) applyInspectorField(block, field, target);
  updateSelectedElementStyle(editor, block);
  if (!inlineTextApplied) updateSelectedTextStyle(editor, block);
  updateSelectedImageStyle(editor, block);
  updateSelectedTableStyle(editor, block);
  updateSelectedChartStyle(editor, block);
  updateSelectedShapeStyle(editor, block);
  const needsRender = commit || chartOption || chartField === 'color' || ['shape', 'shadow', 'tableHeader', 'chartType', 'chartPalette', 'interactionType'].includes(field);
  if (needsRender) {
    renderBlocks(editor, block.id);
  }
  if (field === 'interactionType' && target.value === 'popup' && !hadPopupPage) openPopupTemplateModal(editor);
}

function saveEditorTextSelection(editor, { paint = false } = {}) {
  if (!editor?.isConnected) return;
  const selection = document.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const content = textContentFromRange(editor, range);
  if (!content) return;
  if (!content.contains(range.commonAncestorContainer)) return;
  const blockEl = content.closest('[data-fpe-block]');
  const block = editor.__freePageState?.blocks.find((item) => item.id === blockEl?.dataset.fpeBlock);
  if (block?.type !== 'text') return;
  const saved = serializeTextRange(content, range);
  if (!saved || saved.start === saved.end) return;
  editor.__freePageTextRange = { blockId: block.id, ...saved };
  editor.__freePageInlineTarget = null;
  if (paint) paintTextSelectionMarker(editor);
}

function applyInspectorTextRangeField(editor, block, field, target, toggleValue = '') {
  if (block?.type !== 'text' || !['fontSize', 'textColor', 'fontFamily', 'textTransform'].includes(field)) return false;
  const content = selectedElement(editor)?.querySelector('[data-fpe-content]');
  const saved = editor.__freePageTextRange;
  if (!content || saved?.blockId !== block.id || saved.start === saved.end) return false;
  paintTextSelectionMarker(editor);
  let span = editor.__freePageInlineTarget?.blockId === block.id ? editor.__freePageInlineTarget.node : null;
  if (!span?.isConnected || !content.contains(span)) {
    const range = restoreTextRange(content, saved);
    if (!range || range.collapsed) return false;
    span = document.createElement('span');
    let fragment;
    try {
      fragment = range.extractContents();
      if (!String(fragment.textContent || '').trim() && !fragment.querySelector?.('*')) return false;
      span.appendChild(fragment);
      range.insertNode(span);
    } catch {
      return false;
    }
    editor.__freePageInlineTarget = { blockId: block.id, node: span };
  }
  if (field === 'fontSize') span.style.fontSize = responsiveFontSize(clamp(target.value, 1, 96));
  if (field === 'textColor') span.style.color = safeColor(target.value, '#eef2fb');
  if (field === 'fontFamily') span.style.fontFamily = safeTextFont(target.value);
  if (field === 'textTransform') span.style.textTransform = toggleValue === 'uppercase' ? 'uppercase' : 'none';
  block.content = cleanFreePageTextHtml(content.innerHTML);
  return true;
}

function selectedMarkedText(editor) {
  const saved = editor?.__freePageTextRange;
  if (!saved?.blockId || saved.start === saved.end) return '';
  const block = editor.__freePageState?.blocks.find((item) => item.id === saved.blockId);
  if (block?.type !== 'text') return '';
  const content = editor.querySelector(`[data-fpe-block="${cssEscape(block.id)}"] [data-fpe-content]`);
  if (!content) return '';
  const marker = content.querySelector('[data-fpe-selection-marker]');
  if (marker) return String(marker.textContent || '');
  const range = restoreTextRange(content, saved);
  return range ? String(range.toString() || '') : '';
}

function hasPaintedTextSelection(content) {
  return Boolean(content?.querySelector?.('[data-fpe-selection-marker]'));
}

function deleteSavedTextSelection(editor) {
  return replaceSavedTextSelection(editor, '');
}

function replaceSavedTextSelection(editor, replacement, { html = false } = {}) {
  const saved = editor?.__freePageTextRange;
  if (!saved?.blockId || saved.start === saved.end) return false;
  const block = editor.__freePageState?.blocks.find((item) => item.id === saved.blockId);
  if (block?.type !== 'text') return false;
  const content = editor.querySelector(`[data-fpe-block="${cssEscape(block.id)}"] [data-fpe-content]`);
  if (!content) return false;
  let target = content.querySelector('[data-fpe-selection-marker]');
  if (!target) {
    const range = restoreTextRange(content, saved);
    if (!range || range.collapsed) return false;
    target = document.createElement('span');
    target.dataset.fpeSelectionMarker = '1';
    try {
      const fragment = range.extractContents();
      target.appendChild(fragment);
      range.insertNode(target);
    } catch {
      return false;
    }
  }
  scheduleHistory(editor, { sync: false });
  const markerRange = document.createRange();
  markerRange.selectNode(target);
  const selection = document.getSelection?.();
  let caretTarget = null;
  if (html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = replacement;
    caretTarget = document.createTextNode('');
    tpl.content.appendChild(caretTarget);
    target.replaceWith(tpl.content);
  } else if (replacement) {
    caretTarget = document.createTextNode(replacement);
    target.replaceWith(caretTarget);
  } else {
    caretTarget = document.createTextNode('');
    target.before(caretTarget);
    target.remove();
  }
  block.content = cleanFreePageTextHtml(content.innerHTML);
  editor.__freePageTextRange = null;
  editor.__freePageInlineTarget = null;
  content.focus({ preventScroll: true });
  if (selection) {
    selection.removeAllRanges();
    if (caretTarget?.isConnected) {
      const caret = document.createRange();
      caret.setStart(caretTarget, caretTarget.nodeValue?.length || 0);
      caret.collapse(true);
      selection.addRange(caret);
    }
    markerRange.detach?.();
  }
  syncLiveBlock(editor);
  updateSelectedTextStyle(editor, block);
  syncToolbar(editor);
  return true;
}

function paintTextSelectionMarker(editor) {
  const saved = editor?.__freePageTextRange;
  if (!saved?.blockId || saved.start === saved.end) return false;
  const block = editor.__freePageState?.blocks.find((item) => item.id === saved.blockId);
  if (block?.type !== 'text') return false;
  const content = editor.querySelector(`[data-fpe-block="${cssEscape(block.id)}"] [data-fpe-content]`);
  if (!content) return false;
  const current = editor.__freePageInlineTarget?.blockId === block.id ? editor.__freePageInlineTarget.node : null;
  if (current?.isConnected && content.contains(current)) return true;
  clearTextSelectionMarkers(editor);
  const range = restoreTextRange(content, saved);
  if (!range || range.collapsed) return false;
  const span = document.createElement('span');
  span.className = 'free-page-text-selection-marker';
  span.dataset.fpeSelectionMarker = '1';
  try {
    const fragment = range.extractContents();
    if (!String(fragment.textContent || '').trim() && !fragment.querySelector?.('*')) return false;
    span.appendChild(fragment);
    range.insertNode(span);
  } catch {
    return false;
  }
  editor.__freePageInlineTarget = { blockId: block.id, node: span };
  block.content = cleanFreePageTextHtml(content.innerHTML);
  return true;
}

function clearTextSelectionMarkers(editor) {
  editor?.querySelectorAll?.('[data-fpe-selection-marker]').forEach(cleanTextSelectionMarkerNode);
}

function cleanFreePageTextHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  tpl.content.querySelectorAll('[data-fpe-selection-marker]').forEach(cleanTextSelectionMarkerNode);
  return sanitizeRichTextHtml(tpl.innerHTML);
}

function cleanTextSelectionMarkerNode(node) {
  node.removeAttribute('data-fpe-selection-marker');
  node.classList.remove('free-page-text-selection-marker');
  if (!node.getAttribute('class')) node.removeAttribute('class');
  const hasStyle = String(node.getAttribute('style') || '').trim();
  const hasAttrs = node.attributes.length > 0;
  if (hasStyle || hasAttrs) return;
  while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
  node.remove();
}

function textContentFromRange(editor, range) {
  const nodes = [range.commonAncestorContainer, range.startContainer, range.endContainer];
  for (const node of nodes) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const content = element?.closest?.('[data-fpe-content]');
    if (content?.closest?.('[data-free-page-editor]') === editor) return content;
  }
  return null;
}

function restoreEditorTextSelection(editor, content, block) {
  const saved = editor.__freePageTextRange;
  if (!content || saved?.blockId !== block?.id) return false;
  const range = restoreTextRange(content, saved);
  if (!range) return false;
  const selection = document.getSelection?.();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function serializeTextRange(root, range) {
  const start = textOffsetIn(root, range.startContainer, range.startOffset);
  const end = textOffsetIn(root, range.endContainer, range.endOffset);
  if (start == null || end == null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function textOffsetIn(root, node, offset) {
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current === node) return total + offset;
      total += current.nodeValue?.length || 0;
    }
    return node === root ? offset : null;
  }
}

function restoreTextRange(root, saved) {
  const start = textPositionIn(root, saved.start);
  const end = textPositionIn(root, saved.end);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function textPositionIn(root, offset) {
  let remaining = Math.max(0, Number(offset) || 0);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last = null;
  while (walker.nextNode()) {
    const current = walker.currentNode;
    const length = current.nodeValue?.length || 0;
    if (remaining <= length) return { node: current, offset: remaining };
    remaining -= length;
    last = current;
  }
  return last ? { node: last, offset: last.nodeValue?.length || 0 } : null;
}

function applyInspectorField(block, field, target) {
  const value = target.type === 'checkbox' ? target.checked : target.value;
  if (['x', 'y', 'w', 'h', 'opacity'].includes(field)) { block[field] = field === 'opacity' ? clamp(value, 15, 100) : Math.round(clamp(value, field === 'w' || field === 'h' ? 1 : 0, field === 'x' || field === 'w' ? PAGE_WIDTH : 1400)); return; }
  if (field === 'rotation') { block.rotation = normalizeRotation(value); return; }
  if (field === 'groupId') { block.groupId = String(value || '').slice(0, 40); return; }
  if (field === 'fontSize' && block.type === 'text') { block.fontSize = clamp(value, 1, 96); return; }
  if (field === 'fontFamily' && block.type === 'text') { block.fontFamily = safeTextFont(value); return; }
  if (field === 'textTransform' && block.type === 'text') { block.textTransform = value === 'toggle' ? (block.textTransform === 'uppercase' ? 'none' : 'uppercase') : value === 'uppercase' ? 'uppercase' : 'none'; return; }
  if (field === 'align' && block.type === 'text') { block.align = ['left', 'center', 'right'].includes(value) ? value : 'left'; return; }
  if (field === 'color' && block.type === 'text') { block.color = TEXT_COLORS.has(value) ? value : 'default'; return; }
  if (field === 'textColor' && block.type === 'text') { block.textColor = safeColor(value, '#eef2fb'); return; }
  if (field === 'surface' && block.type === 'text') { block.surface = TEXT_SURFACES.has(value) ? value : 'none'; return; }
  if (field === 'fit' && block.type === 'image') { block.fit = value === 'cover' ? 'cover' : 'contain'; return; }
  if (['cropX', 'cropY'].includes(field) && block.type === 'image') { block[field] = clamp(value, 0, 100); return; }
  if (field === 'zoom' && block.type === 'image') { block.zoom = clamp(value, 100, 220); return; }
  if (['imageX', 'imageY'].includes(field) && block.type === 'image') { block[field] = Math.round(clamp(value, -900, 900)); return; }
  if (['imageW', 'imageH'].includes(field) && block.type === 'image') { block[field] = Math.round(clamp(value, 1, 900)); syncLegacyImageCropFields(block); return; }
  if (field === 'shape' && block.type === 'shape') { block.shape = SHAPE_TYPES.has(value) ? value : 'rectangle'; if (block.shape !== 'rectangle') block.radius = 0; return; }
  if ((field === 'fill' || field === 'stroke') && block.type === 'shape') { block[field] = safeColor(value, field === 'fill' ? DEFAULT_SHAPE_FILL : DEFAULT_SHAPE_STROKE); return; }
  if ((field === 'strokeWidth' || field === 'radius') && block.type === 'shape') { block[field] = clamp(value, 0, field === 'strokeWidth' ? 12 : 80); return; }
  if (field === 'shadow' && block.type === 'shape') { block.shadow = Boolean(value); return; }
  if (field === 'shadowDepth' && block.type === 'shape') { block.shadowDepth = clamp(value, 4, 80); return; }
  if (field === 'tableHeader' && block.type === 'table') { block.header = Boolean(value); return; }
  if (field === 'tableFontSize' && block.type === 'table') { block.fontSize = clamp(value, 10, 28); return; }
  if (field === 'tableTextColor' && block.type === 'table') { block.textColor = safeColor(value, '#c8d4e8'); return; }
  if (field === 'tableHeaderColor' && block.type === 'table') { block.headerColor = safeColor(value, '#e8c66a'); return; }
  if (field === 'tableBorderColor' && block.type === 'table') { block.borderColor = safeColor(value, '#263957'); return; }
  if (field === 'title' && block.type === 'chart') { block.title = String(value || '').slice(0, 80); return; }
  if (field === 'chartType' && block.type === 'chart') { block.chartType = CHART_TYPES.has(value) ? value : 'bar'; return; }
  if (field === 'chartPalette' && block.type === 'chart') { block.chartPalette = CHART_PALETTE_NAMES.has(value) ? value : 'arcane'; block.items = normalizeItems(block.items, block.chartPalette).map((item, index) => ({ ...item, color: chartColor('', index, block.chartPalette) })); return; }
  if (field === 'showChartBackground' && block.type === 'chart') { block.showChartBackground = Boolean(value); return; }
  if (field === 'showChartFrame' && block.type === 'chart') { block.showChartFrame = Boolean(value); return; }
  if (field === 'interactionType') {
    const nextType = INTERACTION_TYPES.has(value) ? value : 'none';
    const current = normalizeInteraction(block.interaction);
    block.interaction = { ...current, type: nextType, page: nextType === 'popup' ? current.page : current.page };
    return;
  }
  if (field === 'interactionTitle') { block.interaction = { ...normalizeInteraction(block.interaction), title: String(value || '').slice(0, 80) }; return; }
  if (field === 'interactionText') { block.interaction = { ...normalizeInteraction(block.interaction), text: sanitizeRichTextHtml(String(value || '').replace(/\n/g, '<br>')) }; return; }
  if (field === 'interactionTarget') block.interaction = { ...normalizeInteraction(block.interaction), target: String(value || '').slice(0, 420) };
}

function renderBlocks(editor, selectedId) {
  const stage = editor.querySelector('[data-fpe-stage]');
  renderSlides(editor);
  const popupEdit = editor.__freePagePopupEdit;
  const stagePage = popupEdit?.rootState || editor.__freePageState;
  const grid = normalizeDeckGrid(editor.__freePageDeck?.grid);
  stage.setAttribute('style', `${stageStyle(stagePage)};--free-page-grid-step:${grid.size / PAGE_WIDTH * 100}%`);
  stage.classList.toggle('is-grid-visible', !popupEdit && grid.show);
  stage.classList.toggle('is-safe-visible', !popupEdit && grid.safe);
  stage.classList.toggle('is-editing-popup', Boolean(popupEdit));
  stage.classList.toggle('is-crop-active', Boolean(!popupEdit && editor.__freePageCropBlockId));
  stage.innerHTML = popupEdit
    ? stagePage.blocks.map((block) => backgroundBlockHtml(block, stagePage.height)).join('') + inlinePopupEditorHtml(editor)
    : editor.__freePageState.blocks.map((block) => blockHtml(block, editor.__freePageState.height, true, { cropping: block.id === editor.__freePageCropBlockId })).join('')
      + editorDeckNavPreviewHtml(editor, selectedId)
      + `<button type="button" class="free-page-empty-add" data-fpe-action="add-text" ${editor.__freePageState.blocks.length ? 'hidden' : ''}>Ajouter un premier bloc de texte</button>`;
  const canSelectNav = selectedId === NAV_BLOCK_ID && editor.__freePageDeck?.nav?.enabled;
  setSelected(editor, canSelectNav || (selectedId && editor.__freePageState.blocks.some((block) => block.id === selectedId)) ? selectedId : null);
}

function renderSlides(editor) {
  const panel = editor.querySelector('[data-fpe-slides]');
  if (!panel || !editor.__freePageDeck) return;
  panel.innerHTML = `<div class="free-page-slidebar-head">
    <span>Diapos</span>
    <span class="free-page-slidebar-actions">
      <button type="button" data-fpe-slide-action="paste" title="Coller la diapo copiée"><span class="free-page-action-icon free-page-action-icon--paste"></span></button>
      <button type="button" data-fpe-slide-action="add" title="Ajouter une diapo">+</button>
    </span>
  </div>
  <label class="free-page-deck-toggle">Navigation visible
    <input type="checkbox" data-fpe-deck-field="canBrowse" ${editor.__freePageDeck.canBrowse !== false ? 'checked' : ''}>
  </label>
  <div class="free-page-slide-list">
    ${editor.__freePageDeck.slides.map((slide, index) => slideThumbHtml(slide, index, slide.id === editor.__freePageSlideId)).join('')}
  </div>`;
}

function slideThumbHtml(slide, index, active) {
  const page = normalizeSingleFreePage(slide.page);
  return `<article class="free-page-slide-thumb ${active ? 'is-active' : ''} ${slide.hidden ? 'is-hidden' : ''}" data-fpe-slide-id="${_esc(slide.id)}" draggable="true">
    <button type="button" class="free-page-slide-preview" data-fpe-slide-action="select" style="${stageStyle(page)}" title="Ouvrir cette diapo">
      ${page.blocks.slice().sort((a, b) => (a.z || 0) - (b.z || 0)).map((block) => slidePreviewBlockHtml(block, page.height)).join('')}
    </button>
    <div class="free-page-slide-open">
      <span data-fpe-slide-drag title="Déplacer la diapo">${index + 1}</span>
      <input value="${_esc(slide.title || '')}" data-fpe-slide-field="title" data-slide-id="${_esc(slide.id)}" placeholder="${_esc(`Diapo ${index + 1}`)}" title="Titre de la diapo">
      <small>${slide.hidden ? 'Cachée' : 'Visible'}</small>
    </div>
    <div class="free-page-slide-actions">
      <button type="button" data-fpe-slide-action="select" title="Ouvrir" aria-label="Ouvrir"><span class="free-page-action-icon free-page-action-icon--open"></span></button>
      <button type="button" data-fpe-slide-action="toggle-hidden" title="${slide.hidden ? 'Afficher' : 'Cacher'}" aria-label="${slide.hidden ? 'Afficher' : 'Cacher'}"><span class="free-page-action-icon ${slide.hidden ? 'free-page-action-icon--show' : 'free-page-action-icon--hide'}"></span></button>
      <button type="button" data-fpe-slide-action="copy" title="Copier pour un autre diaporama" aria-label="Copier"><span class="free-page-action-icon free-page-action-icon--copy"></span></button>
      <button type="button" data-fpe-slide-action="duplicate" title="Dupliquer ici" aria-label="Dupliquer"><span class="free-page-action-icon free-page-action-icon--duplicate"></span></button>
      <button type="button" data-fpe-slide-action="delete" title="Supprimer" aria-label="Supprimer" ${page.blocks.length || index === 0 ? '' : ''}><span class="free-page-action-icon free-page-action-icon--delete"></span></button>
    </div>
  </article>`;
}

function slidePreviewBlockHtml(block, pageHeight) {
  if (block.type === 'image' && !block.src) return '';
  const style = previewBlockStyle(block, pageHeight);
  if (block.type === 'image') return `<span class="free-page-slide-preview-block free-page-slide-preview-image" style="${style}"><img src="${_esc(block.src)}" alt="" style="${imageInnerStyle(block)}"></span>`;
  if (block.type === 'shape') return `<span class="free-page-slide-preview-block free-page-slide-preview-shape free-page-slide-preview-shape--${_esc(block.shape || 'rectangle')}" style="${style};--shape-fill:${_esc(block.fill || DEFAULT_SHAPE_FILL)};--shape-stroke:${_esc(block.stroke || DEFAULT_SHAPE_STROKE)};--shape-stroke-width:${Number(block.strokeWidth) || 0}px;--shape-radius:${Number(block.radius) || 0}px"></span>`;
  if (block.type === 'chart') return `<span class="free-page-slide-preview-block free-page-slide-preview-chart" style="${style}"></span>`;
  if (block.type === 'table') return `<span class="free-page-slide-preview-block free-page-slide-preview-table" style="${style}"></span>`;
  return `<span class="free-page-slide-preview-block free-page-slide-preview-text" style="${style}"></span>`;
}

function previewBlockStyle(block, pageHeight) {
  if (block.type === 'shape' && block.shape === 'diamond') {
    return `left:${block.x / 10}%;top:${block.y / pageHeight * 100}%;width:${block.w / 10}%;height:${block.h / pageHeight * 100}%;z-index:${block.z};opacity:${(block.opacity ?? 100) / 100};transform:rotate(${normalizeRotation((block.rotation || 0) + 45)}deg) scale(.78)`;
  }
  return blockStyle(block, pageHeight);
}

function inlinePopupEditorHtml(editor) {
  const session = editor.__freePagePopupEdit;
  if (!session) return '';
  const block = session.rootState?.blocks?.find((item) => item.id === session.blockId);
  if (!block) return '';
  const interaction = normalizeInteraction(block.interaction);
  const layout = POPUP_LAYOUTS.has(session.layout || interaction.layout) ? session.layout || interaction.layout : 'center';
  const page = normalizeSingleFreePage(editor.__freePageState || session.page || interaction.page || defaultPopupPage(layout));
  const frame = normalizePopupFrame(session.frame || interaction.frame, layout);
  session.frame = frame;
  return `<div class="free-page-inline-popup free-page-inline-popup--${_esc(layout)}" data-fpe-inline-popup>
    <div class="free-page-inline-backdrop" aria-hidden="true"></div>
    <button type="button" class="free-page-inline-done" data-fpe-action="finish-popup-edit">Modification terminee</button>
    <button type="button" class="free-page-popup-frame-lock ${frame.locked ? '' : 'is-unlocked'}" data-fpe-action="toggle-popup-frame-lock">${frame.locked ? 'Deverrouiller la fenetre' : 'Verrouiller la fenetre'}</button>
    <div class="free-page-inline-window ${frame.locked ? 'is-frame-locked' : 'is-frame-unlocked'}" data-fpe-composition aria-label="Fenetre en cours de modification" style="${popupFrameStyle(frame, page.height)}">
      ${!frame.locked ? '<button type="button" class="free-page-popup-frame-move" data-fpe-popup-frame-move title="Deplacer la fenetre">Deplacer</button><span class="free-page-popup-frame-resize" data-fpe-popup-frame-resize title="Redimensionner la fenetre"></span>' : ''}
      ${page.blocks.map((item) => blockHtml(item, page.height, true, { cropping: item.id === editor.__freePageCropBlockId })).join('')}
      <button type="button" class="free-page-empty-add" data-fpe-action="add-text" ${page.blocks.length ? 'hidden' : ''}>Ajouter un premier bloc de texte</button>
    </div>
  </div>`;
}

function popupFrameStyle(frame, pageHeight = DEFAULT_HEIGHT) {
  const safe = normalizePopupFrame(frame, 'center');
  return `--free-page-height:${pageHeight};left:${safe.x / 10}%;top:${safe.y / DEFAULT_HEIGHT * 100}%;width:${safe.w / 10}%;height:${safe.h / DEFAULT_HEIGHT * 100}%;right:auto;bottom:auto;transform:none;max-width:none;max-height:none`;
}

function backgroundBlockHtml(block, pageHeight) {
  return blockHtml({ ...block, interaction: { type: 'none' } }, pageHeight, false)
    .replace('class="free-page-block ', 'class="free-page-block free-page-background-block ')
    .replace('data-fpe-block=', 'data-fpe-background-block=')
    .replace(' role="button"', '')
    .replace(' tabindex="0"', '');
}

function blockHtml(block, pageHeight, editable, { cropping = false } = {}) {
  if (block.type === 'image' && !block.src) return '';
  if (block.hidden && !editable) return '';
  const interaction = normalizeInteraction(block.interaction);
  const interactionAttrs = !editable && interaction.type !== 'none'
    ? ` data-fpe-reader-action="${_esc(interaction.type)}" data-fpe-reader-title="${_esc(interaction.title)}" data-fpe-reader-text="${_esc(interaction.text)}" data-fpe-reader-target="${_esc(interaction.target)}" data-fpe-reader-layout="${_esc(interaction.layout)}" data-fpe-reader-frame="${_esc(JSON.stringify(interaction.frame || null))}" data-fpe-reader-page="${_esc(JSON.stringify(interaction.page || null))}" tabindex="0" role="button"`
    : '';
  const groupAttr = block.groupId ? ` data-fpe-group="${_esc(block.groupId)}"` : '';
  return `<div class="free-page-block free-page-block--${block.type} ${block.locked ? 'is-locked' : ''} ${block.hidden ? 'is-hidden-block' : ''} ${cropping ? 'is-cropping' : ''}" data-fpe-block="${_esc(block.id)}"${groupAttr}${interactionAttrs} style="${blockStyle(block, pageHeight)}">
    ${editable && !block.locked ? '<button type="button" class="free-page-move" data-fpe-move title="Deplacer le bloc" aria-label="Deplacer le bloc">&#8942;</button>' : ''}
    ${editable ? `<button type="button" class="free-page-interaction-button ${interaction.type !== 'none' ? 'is-active' : ''}" data-fpe-interaction-button data-fpe-action="open-interaction" title="${_esc(interactionButtonLabel(interaction.type))}">${_esc(interactionButtonLabel(interaction.type))}</button>` : ''}
    ${editable && block.locked ? '<span class="free-page-lock-badge" title="Element verrouille">Verrouille</span>' : ''}
    ${blockBodyHtml(block, editable, { cropping })}
    ${editable && !block.locked && cropping ? cropHandlesHtml(block) : ''}
    ${editable && !block.locked && block.type === 'shape' && block.shape === 'rectangle' ? '<span class="free-page-radius" data-fpe-radius title="Arrondir les angles"></span>' : ''}
    ${editable && !block.locked ? '<span class="free-page-rotate" data-fpe-rotate title="Faire tourner"></span>' : ''}
    ${editable && !block.locked ? '<span class="free-page-rotation-ticks" aria-hidden="true"></span>' : ''}
    ${editable && !block.locked ? `<span class="free-page-rotation-badge" data-fpe-rotation-badge>${normalizeRotation(block.rotation || 0)}&deg;</span>` : ''}
    ${editable && !block.locked ? resizeHandlesHtml() : ''}
  </div>`;
}

function resizeHandlesHtml() {
  return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    .map((dir) => `<span class="free-page-resize free-page-resize--${dir}" data-fpe-resize="${dir}" title="Redimensionner"></span>`)
    .join('');
}

function blockBodyHtml(block, editable, { cropping = false } = {}) {
  if (block.type === 'text') return `<div class="free-page-text free-page-text--${block.surface} free-page-text-color--${block.color}" ${editable ? 'contenteditable="true" data-fpe-content spellcheck="true"' : ''} style="text-align:${block.align};font-size:${responsiveFontSize(block.fontSize)};font-family:${_esc(safeTextFont(block.fontFamily))};text-transform:${block.textTransform === 'uppercase' ? 'uppercase' : 'none'};color:${_esc(block.textColor || legacyTextColor(block.color))}">${block.content || ''}</div>`;
  if (block.type === 'image') return `<div class="free-page-image-frame"><img class="free-page-image" ${cropping ? 'data-fpe-crop-drag title="Deplacer l image dans son cadre"' : ''} src="${_esc(block.src)}" alt="${_esc(block.alt || '')}" style="${imageInnerStyle(block)}"></div>`;
  if (block.type === 'table') return tableHtml(block, editable);
  if (block.type === 'chart') return chartHtml(block, editable);
  if (block.type === 'shape') return shapeHtml(block);
  return '';
}

function cropHandlesHtml(block) {
  return `<span class="free-page-crop-frame" aria-hidden="true"></span><span class="free-page-crop-image-outline" data-fpe-crop-drag title="Deplacer l image" style="${imageCropOverlayStyle(block)}">${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((dir) => `<span class="free-page-crop-zoom free-page-crop-zoom--${dir}" data-fpe-crop-zoom="${dir}" title="Redimensionner l image"></span>`).join('')}</span>`;
}

function tableHtml(block, editable) {
  const rows = normalizeRows(block.rows);
  const style = `--table-text:${_esc(block.textColor || '#c8d4e8')};--table-header:${_esc(block.headerColor || '#e8c66a')};--table-border:${_esc(block.borderColor || '#263957')};--table-font:${responsiveFontSize(Number(block.fontSize) || 14)}`;
  return `<div class="free-page-table-wrap" style="${style}"><table class="free-page-table"><tbody>${rows.map((row, rowIndex) => `<tr>${row.map((cell, colIndex) => {
    const tag = block.header && rowIndex === 0 ? 'th' : 'td';
    const attrs = editable ? ` contenteditable="true" spellcheck="true" data-fpe-table-cell data-row="${rowIndex}" data-col="${colIndex}"` : '';
    return `<${tag}${attrs}>${_esc(cell)}</${tag}>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function shapeHtml(block) {
  return `<div class="free-page-shape free-page-shape--${_esc(block.shape || 'rectangle')} ${block.shadow ? 'is-shadowed' : ''}" style="--shape-fill:${_esc(block.fill || DEFAULT_SHAPE_FILL)};--shape-stroke:${_esc(block.stroke || DEFAULT_SHAPE_STROKE)};--shape-stroke-width:${Number(block.strokeWidth) || 0}px;--shape-radius:${Number(block.radius) || 0}px;--shape-shadow:${Number(block.shadowDepth) || 28}px"></div>`;
}

function chartHtml(block, editable = false) {
  const items = normalizeItems(block.items, block.chartPalette);
  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
  const options = { showLegend: block.showLegend !== false, showLabels: block.showLabels !== false, showTooltips: block.showTooltips !== false, showValues: block.showValues !== false };
  const classes = `free-page-chart ${block.showChartBackground === false ? 'is-background-hidden' : ''} ${block.showChartFrame === false ? 'is-frame-hidden' : ''}`.trim();
  return `<div class="${classes}" data-chart-type="${_esc(block.chartType)}" data-chart-palette="${_esc(block.chartPalette)}">
    ${block.title || editable ? `<input class="free-page-chart-title" data-fpe-chart-title value="${_esc(block.title ?? '')}" placeholder="${editable ? 'Titre' : ''}" readonly tabindex="-1">` : ''}
    ${chartPlotHtml(block.chartType, items, max, options, block.chartPalette)}
    ${options.showLegend ? `<div class="free-page-chart-data free-page-chart-data--legend">${items.map((item, index) => `<div class="free-page-chart-row" style="--chart-color:${chartColor(item.color, index, block.chartPalette)}"><span>${_esc(item.label)}</span><strong>${_esc(item.value)}</strong></div>`).join('')}</div>` : ''}
  </div>`;
}

function chartPlotHtml(type, items, max, options, paletteName) {
  const valueOf = (item) => Math.max(0, Number(item.value) || 0);
  const pct = (item) => Math.round(valueOf(item) / max * 100);
  const colorOf = (item, index) => chartColor(item.color, index, paletteName);
  const tip = (item) => options.showTooltips ? ` title="${_esc(`${item.label} : ${item.value}${item.note ? ` - ${item.note}` : ''}`)}"` : '';
  const label = (item) => options.showLabels ? `<span>${_esc(item.label)}</span>` : '<span></span>';
  const value = (item) => options.showValues ? `<strong>${_esc(item.value)}</strong>` : '<strong></strong>';
  if (type === 'horizontal-bar' || type === 'progress') return `<div class="free-page-chart-plot free-page-chart-plot--rows">${items.map((item, index) => `<div class="free-page-chart-track-row"${tip(item)}>${label(item)}<i><b style="width:${pct(item)}%;--chart-color:${colorOf(item, index)}"></b></i>${value(item)}</div>`).join('')}</div>`;
  if (type === 'pie' || type === 'doughnut') {
    const total = Math.max(1, items.reduce((sum, item) => sum + valueOf(item), 0));
    let cursor = 0;
    const segments = items.map((item, index) => { const start = cursor; cursor += valueOf(item) / total * 360; return `${colorOf(item, index)} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`; }).join(',');
    return `<div class="free-page-chart-plot free-page-chart-plot--circular"><div class="free-page-chart-pie${type === 'doughnut' ? ' is-doughnut' : ''}" style="background:conic-gradient(${segments})"></div></div>`;
  }
  if (type === 'radar') return radarHtml(items, max, options, paletteName);
  if (type === 'polar') return `<div class="free-page-chart-plot free-page-chart-plot--polar"><div class="free-page-chart-polar-grid">${items.map((item, index) => `<i style="--polar-angle:${index * (360 / items.length)}deg;--polar-size:${Math.max(8, pct(item) * .42)}%;--chart-color:${colorOf(item, index)}"${tip(item)}></i>`).join('')}</div></div>`;
  const points = items.map((item, index) => ({ x: items.length === 1 ? 50 : 6 + index / (items.length - 1) * 88, y: 92 - valueOf(item) / max * 80, item, color: colorOf(item, index) }));
  if (type === 'line' || type === 'area' || type === 'scatter') {
    const pointList = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
    return `<div class="free-page-chart-plot free-page-chart-plot--svg"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${type === 'area' ? `<polygon class="free-page-chart-area" points="6,92 ${pointList} 94,92"></polygon>` : ''}${type !== 'scatter' ? `<polyline points="${pointList}"></polyline>` : ''}${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="${type === 'scatter' ? 3.2 : 2.2}" style="--chart-color:${point.color}">${options.showTooltips ? `<title>${_esc(point.item.label)} : ${_esc(point.item.value)}</title>` : ''}</circle>`).join('')}</svg>${options.showLabels ? `<div class="free-page-chart-axis-labels">${items.map((item) => `<span>${_esc(item.label)}</span>`).join('')}</div>` : ''}</div>`;
  }
  const lollipop = type === 'lollipop';
  return `<div class="free-page-chart-plot free-page-chart-plot--columns">${items.map((item, index) => `<div class="free-page-chart-column${lollipop ? ' is-lollipop' : ''}" style="--chart-height:${pct(item)}%;--chart-color:${colorOf(item, index)}"${tip(item)}>${value(item)}<i></i>${label(item)}</div>`).join('')}</div>`;
}

function radarHtml(items, max, options, paletteName) {
  const pointAt = (index, scale = 1) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / items.length);
    return `${(50 + Math.cos(angle) * 39 * scale).toFixed(2)},${(50 + Math.sin(angle) * 39 * scale).toFixed(2)}`;
  };
  const rings = [.25, .5, .75, 1].map((scale) => `<polygon class="free-page-chart-radar-grid" points="${items.map((_, index) => pointAt(index, scale)).join(' ')}"></polygon>`).join('');
  const axes = items.map((_, index) => `<line class="free-page-chart-radar-grid" x1="50" y1="50" x2="${pointAt(index).split(',')[0]}" y2="${pointAt(index).split(',')[1]}"></line>`).join('');
  const values = items.map((item, index) => pointAt(index, Math.max(.03, (Number(item.value) || 0) / max))).join(' ');
  return `<div class="free-page-chart-plot free-page-chart-plot--svg free-page-chart-plot--radar"><svg viewBox="0 0 100 100">${rings}${axes}<polygon class="free-page-chart-radar-value" points="${values}" style="--chart-color:${chartColor(items[0]?.color, 0, paletteName)}"></polygon></svg>${options.showLabels ? `<div class="free-page-chart-axis-labels free-page-chart-axis-labels--radar">${items.map((item) => `<span>${_esc(item.label)}</span>`).join('')}</div>` : ''}</div>`;
}

function stageStyle(page) {
  const normalized = normalizeSingleFreePage(page);
  return `--free-page-height:${normalized.height};--free-page-bg:${_esc(normalized.background || DEFAULT_PAGE_BG)}`;
}

function navBlockStyle(nav) {
  const safe = normalizeDeckNav(nav, []);
  return `left:${safe.x / 10}%;top:${safe.y / DEFAULT_HEIGHT * 100}%;width:${safe.w / 10}%;height:${safe.h / DEFAULT_HEIGHT * 100}%;z-index:${safe.z || 1200}`;
}

function deckNavHtml(deck, currentSlideId, { editor = false, selected = false } = {}) {
  const nav = normalizeDeckNav(deck?.nav, deck?.slides || []);
  if (!nav.enabled) return '';
  if (nav.visibleSlideIds.length && !nav.visibleSlideIds.includes(currentSlideId)) return '';
  const slides = visibleSlides(deck).filter((slide) => !nav.targetSlideIds.length || nav.targetSlideIds.includes(slide.id));
  if (!slides.length) return '';
  const editorAttrs = editor ? ` data-fpe-nav-block="${NAV_BLOCK_ID}"` : '';
  const classes = `free-page-stage-nav ${editor ? 'free-page-stage-nav--editor ' : ''}${selected ? 'is-selected ' : ''}`;
  const handles = editor && selected ? resizeHandlesHtml() : '';
  if (nav.style === 'menu') {
    return `<details class="${classes}free-page-stage-nav--menu"${editorAttrs} style="${navBlockStyle(nav)}">
      <summary aria-label="${_esc(nav.label || 'Menu')}" title="${_esc(nav.label || 'Menu')}"><span class="free-page-hamburger" aria-hidden="true"><i></i><i></i><i></i></span></summary>
      <div>${slides.map((slide, index) => `<button type="button" class="${slide.id === currentSlideId ? 'is-active' : ''}" data-fpe-reader-slide="${_esc(slide.id)}">${index + 1}. ${_esc(slide.title || `Diapo ${index + 1}`)}</button>`).join('')}</div>
      ${handles}
    </details>`;
  }
  return `<nav class="${classes}free-page-stage-nav--bar"${editorAttrs} style="${navBlockStyle(nav)}" aria-label="Navigation du diaporama">
    ${slides.map((slide, index) => `<button type="button" class="${slide.id === currentSlideId ? 'is-active' : ''}" data-fpe-reader-slide="${_esc(slide.id)}">${_esc(slide.title || `Diapo ${index + 1}`)}</button>`).join('')}
    ${handles}
  </nav>`;
}

function editorDeckNavPreviewHtml(editor, selectedId = editor.__freePageSelected) {
  const deck = editor.__freePageDeck;
  if (!deck?.nav?.enabled) return '';
  return deckNavHtml(deck, editor.__freePageSlideId, { editor: true, selected: selectedId === NAV_BLOCK_ID || editor.__freePageSelected === NAV_BLOCK_ID });
}

function blockStyle(block, pageHeight) {
  const rotation = normalizeRotation(block.rotation || 0);
  return `left:${block.x / 10}%;top:${block.y / pageHeight * 100}%;width:${block.w / 10}%;height:${block.h / pageHeight * 100}%;z-index:${block.z};opacity:${(block.opacity ?? 100) / 100};--block-rotation:${rotation}deg;--block-unrotation:${-rotation}deg;transform:rotate(var(--block-rotation))`;
}

function responsiveFontSize(size) {
  const px = clamp(size, 1, 96);
  return `clamp(1px, ${px / 10}cqw, ${px}px)`;
}

function imageInnerStyle(block) {
  const fit = block.cropModel === 'rect' ? 'fill' : (block.fit || 'contain');
  return `left:${Number(block.imageX ?? 0)}%;top:${Number(block.imageY ?? 0)}%;width:${Number(block.imageW ?? 100)}%;height:${Number(block.imageH ?? 100)}%;object-fit:${_esc(fit)}`;
}

function imageCropOverlayStyle(block) {
  return `left:${Number(block.imageX ?? 0)}%;top:${Number(block.imageY ?? 0)}%;width:${Number(block.imageW ?? 100)}%;height:${Number(block.imageH ?? 100)}%`;
}

function setSelected(editor, id) {
  const isNav = id === NAV_BLOCK_ID && editor.__freePageDeck?.nav?.enabled;
  const block = id && !isNav ? editor.__freePageState.blocks.find((item) => item.id === id) : null;
  const nextId = isNav ? NAV_BLOCK_ID : block ? id : null;
  if (editor.__freePageCropBlockId && editor.__freePageCropBlockId !== nextId) editor.__freePageCropBlockId = null;
  if (editor.__freePageSelected !== nextId) {
    syncLiveBlock(editor);
    syncInteractionPageEditor(editor);
  }
  if (editor.__freePageTextRange?.blockId !== nextId) {
    editor.__freePageTextRange = null;
    editor.__freePageInlineTarget = null;
  }
  editor.__freePageSelected = nextId;
  editor.__freePageSelectedIds = nextId && nextId !== NAV_BLOCK_ID ? [nextId] : [];
  applySelectionClasses(editor);
  syncToolbar(editor);
}

function toggleSelected(editor, id) {
  const block = editor.__freePageState.blocks.find((item) => item.id === id);
  if (!block) return;
  syncLiveBlock(editor);
  syncInteractionPageEditor(editor);
  const current = new Set(editor.__freePageSelectedIds?.length ? editor.__freePageSelectedIds : editor.__freePageSelected ? [editor.__freePageSelected] : []);
  current.has(id) ? current.delete(id) : current.add(id);
  editor.__freePageSelectedIds = [...current];
  editor.__freePageSelected = editor.__freePageSelectedIds.at(-1) || null;
  applySelectionClasses(editor);
  syncToolbar(editor);
}

function setMultiSelected(editor, ids) {
  const valid = [...new Set(ids)].filter((id) => editor.__freePageState.blocks.some((block) => block.id === id));
  syncLiveBlock(editor);
  syncInteractionPageEditor(editor);
  editor.__freePageSelectedIds = valid;
  editor.__freePageSelected = valid.at(-1) || null;
  applySelectionClasses(editor);
  syncToolbar(editor);
}

function applySelectionClasses(editor) {
  const selected = new Set(editor.__freePageSelectedIds || []);
  editor.querySelectorAll('[data-fpe-block]').forEach((el) => {
    const isSelected = selected.has(el.dataset.fpeBlock);
    el.classList.toggle('is-selected', el.dataset.fpeBlock === editor.__freePageSelected);
    el.classList.toggle('is-multi-selected', isSelected);
  });
  editor.querySelectorAll('[data-fpe-nav-block]').forEach((el) => {
    el.classList.toggle('is-selected', editor.__freePageSelected === NAV_BLOCK_ID);
  });
}

function syncToolbar(editor) {
  const undoBtn = editor.querySelector('[data-fpe-action="undo"]');
  const redoBtn = editor.querySelector('[data-fpe-action="redo"]');
  if (undoBtn) undoBtn.disabled = !editor.__freePageUndo.length;
  if (redoBtn) redoBtn.disabled = !editor.__freePageRedo.length;
  const block = selectedBlock(editor);
  editor.classList.toggle('is-text-active', block?.type === 'text');
  const textToolbar = editor.querySelector('[data-fpe-text-toolbar]');
  if (textToolbar && block?.type === 'text') {
    const size = textToolbar.querySelector('[data-fpe-inspector-field="fontSize"]');
    const color = textToolbar.querySelector('[data-fpe-inspector-field="textColor"]');
    const font = textToolbar.querySelector('[data-fpe-inspector-field="fontFamily"]');
    const transform = textToolbar.querySelector('[data-fpe-inspector-field="textTransform"]');
    if (size && document.activeElement !== size) size.value = String(Number(block.fontSize) || 18);
    if (color && document.activeElement !== color) color.value = safeColor(block.textColor, '#eef2fb');
    if (font && document.activeElement !== font) font.value = safeTextFont(block.fontFamily);
    if (transform) transform.classList.toggle('is-active', block.textTransform === 'uppercase');
    const colorButton = textToolbar.querySelector('[data-fpe-action="toggle-text-color-popover"] i');
    if (colorButton) colorButton.style.setProperty('--fpe-active-color', safeColor(block.textColor, '#eef2fb'));
    syncTextColorPopover(editor, safeColor(block.textColor, '#eef2fb'));
  }
  renderInspector(editor);
}

function syncTextColorPopover(editor, color) {
  const popover = editor.querySelector('[data-fpe-text-color-popover]');
  if (!popover) return;
  const safe = safeColor(color, '#eef2fb');
  popover.querySelectorAll('[data-fpe-inspector-field="textColor"]').forEach((control) => {
    if (control.matches('input') && document.activeElement !== control) control.value = safe;
    if (control.matches('button')) control.classList.toggle('is-active', String(control.value || '').toLowerCase() === safe.toLowerCase());
  });
  popover.querySelectorAll('.free-page-color-preview').forEach((preview) => preview.style.setProperty('--fpe-dot', safe));
}

function renderInspector(editor) {
  const panel = editor.querySelector('[data-fpe-inspector]');
  const block = selectedBlock(editor);
  const bulk = selectedBlocks(editor);
  if (!panel) return;
  captureInspectorFoldState(editor);
  syncInteractionPageEditor(editor);
  if (editor.__freePageSelected === NAV_BLOCK_ID) {
    const deck = editor.__freePageDeck ? normalizeFreePageDeck(editor.__freePageDeck) : null;
    if (deck) editor.__freePageDeck.nav = deck.nav;
    panel.innerHTML = deck
      ? `<div class="free-page-inspector-head"><span>Composant</span><strong>Menu</strong></div>${navInspectorHtml(deck, editor.__freePageSlideId, { selected: true })}`
      : pageInspectorHtml(editor);
    return;
  }
  if (bulk.length > 1) {
    panel.innerHTML = `<div class="free-page-inspector-head"><span>Selection multiple</span><strong>${bulk.length} blocs</strong></div>
      <div class="free-page-inspector-section"><h4>Actions</h4>
        <div class="free-page-align-grid">
          <button type="button" class="free-page-tool" data-fpe-action="align-left">Aligner gauche</button>
          <button type="button" class="free-page-tool" data-fpe-action="align-center">Centrer H</button>
          <button type="button" class="free-page-tool" data-fpe-action="align-right">Aligner droite</button>
          <button type="button" class="free-page-tool" data-fpe-action="align-top">Aligner haut</button>
          <button type="button" class="free-page-tool" data-fpe-action="align-middle">Centrer V</button>
          <button type="button" class="free-page-tool" data-fpe-action="align-bottom">Aligner bas</button>
          <button type="button" class="free-page-tool" data-fpe-action="distribute-x">Distribuer H</button>
          <button type="button" class="free-page-tool" data-fpe-action="distribute-y">Distribuer V</button>
        </div>
        <div class="free-page-inspector-actions">
          <button type="button" class="free-page-tool" data-fpe-action="group-selected">Grouper</button>
          <button type="button" class="free-page-tool" data-fpe-action="duplicate">Dupliquer</button>
          <button type="button" class="free-page-tool" data-fpe-action="layer-up">Devant</button>
          <button type="button" class="free-page-tool" data-fpe-action="layer-down">Derriere</button>
          <button type="button" class="free-page-tool" data-fpe-action="toggle-lock">Verrouiller / deverrouiller</button>
          <button type="button" class="free-page-tool free-page-tool--danger" data-fpe-action="delete">Supprimer</button>
        </div>
      </div>`;
    return;
  }
  if (!block) {
    panel.innerHTML = pageInspectorHtml(editor);
    bindFreePageEditor(panel);
    return;
  }
  if (editor.__freePageFocusPanel === 'interaction') {
    const interaction = normalizeInteraction(block.interaction);
    panel.innerHTML = `<div class="free-page-inspector-head"><span>Bloc interactif</span><strong>${blockTypeLabel(block.type)}</strong></div>
      <button type="button" class="free-page-resource free-page-resource--back" data-fpe-action="close-interaction-panel">Retour configuration</button>
      ${interactionConfigHtml(interaction, true, editor)}`;
    bindFreePageEditor(panel);
    return;
  }
  const tab = editor.__freePageInspectorTab === 'config' ? 'config' : 'content';
  panel.innerHTML = `<div class="free-page-inspector-tabs">
    <button type="button" class="${tab === 'content' ? 'is-active' : ''}" data-fpe-inspector-tab="content">Contenu</button>
    <button type="button" class="${tab === 'config' ? 'is-active' : ''}" data-fpe-inspector-tab="config">Configuration</button>
  </div>
  <div class="free-page-inspector-head"><span>Selection</span><strong>${blockTypeLabel(block.type)}</strong></div>
  ${tab === 'content' ? blockInspectorContent(block) : blockInspectorConfig(block, editor)}`;
  bindFreePageEditor(panel);
}

function captureInspectorFoldState(editor) {
  const panel = editor.querySelector('[data-fpe-inspector]');
  if (!panel) return;
  editor.__freePageFoldState ||= {};
  panel.querySelectorAll('details[data-fpe-fold]').forEach((details) => {
    editor.__freePageFoldState[details.dataset.fpeFold] = details.open;
  });
}

function foldOpenAttr(editor, key, defaultOpen = false) {
  const state = editor.__freePageFoldState || {};
  return (Object.prototype.hasOwnProperty.call(state, key) ? state[key] : defaultOpen) ? 'open' : '';
}

function pageInspectorHtml(editor) {
  const deck = editor.__freePageDeck ? normalizeFreePageDeck(editor.__freePageDeck) : null;
  if (deck) editor.__freePageDeck.nav = deck.nav;
  const page = normalizeSingleFreePage(editor.__freePageState);
  return `<div class="free-page-inspector-head"><span>Composition</span><strong>Diapo</strong></div>
    ${currentSlideInspectorHtml(editor)}
    ${layersInspectorHtml(editor)}
    <details class="free-page-inspector-section free-page-inspector-fold" data-fpe-fold="resources" ${foldOpenAttr(editor, 'resources')}>
      <summary>Ressources</summary>
      <div class="free-page-resource-grid">
        <button type="button" class="free-page-resource" data-fpe-action="add-text">Texte</button>
        <button type="button" class="free-page-resource" data-fpe-action="add-image">Image</button>
        <button type="button" class="free-page-resource" data-fpe-action="add-table">Tableau</button>
        <button type="button" class="free-page-resource" data-fpe-action="add-chart">Graphique</button>
        <button type="button" class="free-page-resource" data-fpe-action="toggle-shape-popover">Formes</button>
        <button type="button" class="free-page-resource" data-fpe-action="add-nav">Menu</button>
      </div>
    </details>
    <details class="free-page-inspector-section free-page-inspector-fold" data-fpe-fold="background" ${foldOpenAttr(editor, 'background')}>
      <summary>Fond de diapo</summary>
      <div class="free-page-control-row"><span>Couleur</span><span class="free-page-color-combo">
        ${pageColorButtonsHtml(page.background || DEFAULT_PAGE_BG)}
        <input class="free-page-color-custom" type="color" value="${_esc(page.background || DEFAULT_PAGE_BG)}" data-fpe-page-field="background">
      </span></div>
    </details>
    ${deck ? navInspectorHtml(deck, editor.__freePageSlideId, { folded: true, editor }) : ''}`;
}

function currentSlideInspectorHtml(editor) {
  const slide = currentSlide(editor);
  if (!slide) return '';
  const passwordType = slide.__passwordVisible ? 'text' : 'password';
  return `<div class="free-page-inspector-section free-page-inspector-section--current-slide">
    <div class="free-page-section-title-row">
      <h4>Diapo courante</h4>
      <span>${_esc(slide.hidden ? 'Cachee' : 'Visible')}</span>
    </div>
    <label class="free-page-inspector-check">Mot de passe <input type="checkbox" data-fpe-slide-field="requirePassword" data-slide-id="${_esc(slide.id)}" ${slide.requirePassword ? 'checked' : ''}></label>
    ${slide.requirePassword ? `<div class="free-page-password-row"><input type="${passwordType}" value="${_esc(slide.password || '')}" data-fpe-slide-field="password" data-slide-id="${_esc(slide.id)}" placeholder="Mot de passe">
      <button type="button" data-fpe-slide-action="toggle-password-visible" data-slide-id="${_esc(slide.id)}" title="${slide.__passwordVisible ? 'Masquer le mot de passe' : 'Reveler le mot de passe'}">${slide.__passwordVisible ? 'Masquer' : 'Voir'}</button></div>
      <input value="${_esc(slide.passwordMessage || DEFAULT_PASSWORD_MESSAGE)}" data-fpe-slide-field="passwordMessage" data-slide-id="${_esc(slide.id)}" placeholder="Message de verrouillage">
      <input value="${_esc(slide.passwordPlaceholder || DEFAULT_PASSWORD_PLACEHOLDER)}" data-fpe-slide-field="passwordPlaceholder" data-slide-id="${_esc(slide.id)}" placeholder="Placeholder du champ">` : ''}
  </div>`;
}

function layersInspectorHtml(editor) {
  const blocks = [...(editor.__freePageState?.blocks || [])].sort((a, b) => (b.z || 0) - (a.z || 0));
  const nav = editor.__freePageDeck?.nav?.enabled ? normalizeDeckNav(editor.__freePageDeck.nav, editor.__freePageDeck.slides) : null;
  const navRow = nav ? layerRowHtml({
    id: NAV_BLOCK_ID,
    label: nav.style === 'menu' ? `Menu : ${nav.label || 'Menu'}` : 'Barre de navigation',
    type: 'nav',
    locked: false,
    hidden: nav.visibleSlideIds.length && !nav.visibleSlideIds.includes(editor.__freePageSlideId),
  }, editor.__freePageSelected === NAV_BLOCK_ID) : '';
  const rows = blocks.map((block) => layerRowHtml({
    id: block.id,
    label: blockLayerLabel(block),
    type: block.type,
    locked: block.locked,
    hidden: block.hidden,
  }, editor.__freePageSelected === block.id)).join('');
  return `<div class="free-page-inspector-section free-page-inspector-section--layers">
    <div class="free-page-section-title-row">
      <h4>Calques</h4>
      <span>${blocks.length + (nav ? 1 : 0)}</span>
    </div>
    <div class="free-page-inspector-actions">
      <button type="button" class="free-page-tool" data-fpe-action="show-all-blocks">Tout afficher</button>
      <button type="button" class="free-page-tool" data-fpe-action="unlock-all">Tout liberer</button>
    </div>
    <div class="free-page-layer-list">
      ${navRow}${rows || '<p>Aucun bloc sur cette diapo.</p>'}
    </div>
  </div>`;
}

function layerRowHtml(layer, active) {
  const isNav = layer.id === NAV_BLOCK_ID;
  return `<div class="free-page-layer-row ${active ? 'is-active' : ''} ${layer.hidden ? 'is-hidden-layer' : ''}" data-layer-id="${_esc(layer.id)}" ${isNav ? '' : 'draggable="true"'}>
    <button type="button" class="free-page-layer-main" data-fpe-layer-action="select" data-layer-id="${_esc(layer.id)}">
      <span>${layerIcon(layer.type)}</span>
      <strong>${_esc(layer.label)}</strong>
    </button>
    <button type="button" data-fpe-layer-action="toggle-visible" data-layer-id="${_esc(layer.id)}" title="${layer.hidden ? 'Afficher' : 'Masquer'}">${layer.hidden ? 'Masq' : 'Vis'}</button>
    ${isNav ? '<span></span><span></span><span></span>' : `<button type="button" data-fpe-layer-action="toggle-lock" data-layer-id="${_esc(layer.id)}" title="${layer.locked ? 'Deverrouiller' : 'Verrouiller'}">${layer.locked ? 'Lock' : 'Libre'}</button>
      <button type="button" data-fpe-layer-action="front" data-layer-id="${_esc(layer.id)}" title="Mettre devant">Av</button>
      <button type="button" data-fpe-layer-action="back" data-layer-id="${_esc(layer.id)}" title="Mettre derriere">Ar</button>`}
  </div>`;
}

function navInspectorHtml(deck, currentSlideId, { selected = false, folded = false, editor = null } = {}) {
  const nav = normalizeDeckNav(deck.nav, deck.slides);
  const target = new Set(nav.targetSlideIds || []);
  const visible = new Set(nav.visibleSlideIds || []);
  const slideRows = (kind, set) => `<div class="free-page-nav-slide-list">
    ${deck.slides.map((slide, index) => `<label class="free-page-nav-slide">
      <span><b>${index + 1}</b>${_esc(slide.title || `Diapo ${index + 1}`)}</span>
      <input type="checkbox" data-fpe-nav-slide="${kind}" data-slide-id="${_esc(slide.id)}" ${set.has(slide.id) ? 'checked' : ''}>
    </label>`).join('')}
  </div>`;
  const tag = folded && !selected ? 'details' : 'div';
  const head = folded && !selected ? '<summary>Navigation</summary>' : '<h4>Navigation</h4>';
  const foldAttrs = folded && !selected ? ` data-fpe-fold="navigation" ${editor ? foldOpenAttr(editor, 'navigation') : ''}` : '';
  return `<${tag} class="free-page-inspector-section ${folded && !selected ? 'free-page-inspector-fold' : ''}"${foldAttrs}>
    ${head}
    <label class="free-page-inspector-check">Afficher le menu <input type="checkbox" data-fpe-nav-field="enabled" ${nav.enabled ? 'checked' : ''}></label>
    <label>Style <select class="free-page-select" data-fpe-nav-field="style">
      <option value="bar" ${nav.style === 'bar' ? 'selected' : ''}>Barre</option>
      <option value="menu" ${nav.style === 'menu' ? 'selected' : ''}>Bouton menu</option>
    </select></label>
    <label>Libelle <input value="${_esc(nav.label || 'Menu')}" data-fpe-nav-field="label" placeholder="Menu"></label>
    <div class="free-page-inspector-grid">
      <label>X <input type="number" min="0" max="${PAGE_WIDTH}" value="${Math.round(nav.x)}" data-fpe-nav-field="x"></label>
      <label>Y <input type="number" min="0" max="${DEFAULT_HEIGHT}" value="${Math.round(nav.y)}" data-fpe-nav-field="y"></label>
      <label>Largeur <input type="number" min="${nav.style === 'menu' ? 44 : 220}" max="${PAGE_WIDTH}" value="${Math.round(nav.w)}" data-fpe-nav-field="w"></label>
      <label>Hauteur <input type="number" min="34" max="${DEFAULT_HEIGHT}" value="${Math.round(nav.h)}" data-fpe-nav-field="h"></label>
    </div>
    ${selected ? '<p>Place ce composant sur la diapo : les pages cochees l afficheront exactement au meme endroit.</p>' : '<button type="button" class="free-page-resource" data-fpe-action="add-nav">Placer le menu sur la diapo</button>'}
    <div class="free-page-nav-picker">
      <div><strong>Pages dans le menu</strong><span>Choisis les destinations proposees.</span></div>
      <div class="free-page-inspector-actions">
        <button type="button" class="free-page-tool" data-fpe-action="nav-target-all">Toutes</button>
        <button type="button" class="free-page-tool" data-fpe-action="nav-target-none">Aucune</button>
      </div>
      ${slideRows('target', target)}
    </div>
    <div class="free-page-nav-picker">
      <div><strong>Pages ou il apparait</strong><span>Tu peux l'afficher partout ou seulement ici.</span></div>
      <div class="free-page-inspector-actions">
        <button type="button" class="free-page-tool" data-fpe-action="nav-visible-all">Toutes</button>
        <button type="button" class="free-page-tool" data-fpe-action="nav-visible-current">Cette page</button>
      </div>
      ${slideRows('visible', visible)}
    </div>
  </${tag}>`;
}

function blockInspectorContent(block) {
  if (block.type === 'chart') return `<div class="free-page-inspector-section"><h4>Donnees</h4>${inspectorChartSheetHtml(block)}</div>`;
  if (block.type === 'table') return `<div class="free-page-inspector-section"><h4>Tableau</h4>${inspectorTableSheetHtml(block)}</div>`;
  if (block.type === 'text') return `<div class="free-page-inspector-section"><h4>Contenu</h4><p>Edite le texte directement sur la page. La mise en forme se trouve dans Configuration.</p></div>`;
  if (block.type === 'image') return `<div class="free-page-inspector-section"><h4>Contenu</h4><p>L'image se manipule directement sur la page. Le cadrage se trouve dans Configuration.</p></div>`;
  return `<div class="free-page-inspector-section"><h4>Contenu</h4><p>Cette forme n'a pas de donnees internes. Ses couleurs, angles et interactions sont dans Configuration.</p></div>`;
}

function blockInspectorConfig(block, editor) {
  const interaction = normalizeInteraction(block.interaction);
  const interactionPanel = interactionConfigHtml(interaction, editor?.__freePageFocusPanel === 'interaction', editor);
  return `${editor?.__freePageFocusPanel === 'interaction' ? interactionPanel : ''}
  ${typeSpecificConfig(block, editor)}
  <div class="free-page-inspector-section"><h4>Disposition</h4>
    <div class="free-page-inspector-grid">
      <label>X <input type="number" min="0" max="${PAGE_WIDTH}" value="${Math.round(block.x)}" data-fpe-inspector-field="x"></label>
      <label>Y <input type="number" min="0" max="1400" value="${Math.round(block.y)}" data-fpe-inspector-field="y"></label>
      <label>Largeur <input type="number" min="1" max="${PAGE_WIDTH}" value="${Math.round(block.w)}" data-fpe-inspector-field="w"></label>
      <label>Hauteur <input type="number" min="1" max="1400" value="${Math.round(block.h)}" data-fpe-inspector-field="h"></label>
      <label>Rotation <input type="number" min="-180" max="180" value="${normalizeRotation(block.rotation || 0)}" data-fpe-inspector-field="rotation"></label>
      <label>Opacite <input type="range" min="15" max="100" value="${Math.round(block.opacity ?? 100)}" data-fpe-inspector-field="opacity"></label>
    </div>
    <label>Groupe <input value="${_esc(block.groupId || '')}" placeholder="ex: groupe-1" data-fpe-inspector-field="groupId"></label>
    <div class="free-page-inspector-actions">
      <button type="button" class="free-page-tool" data-fpe-action="layer-up">Devant</button>
      <button type="button" class="free-page-tool" data-fpe-action="layer-down">Derriere</button>
      <button type="button" class="free-page-tool" data-fpe-action="duplicate">Dupliquer</button>
      <button type="button" class="free-page-tool" data-fpe-action="toggle-lock">${block.locked ? 'Deverrouiller' : 'Verrouiller'}</button>
      <button type="button" class="free-page-tool" data-fpe-action="reset-rotation">Rotation 0</button>
      <button type="button" class="free-page-tool free-page-tool--danger" data-fpe-action="delete">Supprimer</button>
      <button type="button" class="free-page-tool" data-fpe-action="group-selected">Grouper avec chevauchement</button>
      <button type="button" class="free-page-tool" data-fpe-action="ungroup">Degrouper</button>
    </div>
  </div>
  ${block.type === 'chart' ? chartInspectorConfig(block) : ''}
  ${editor?.__freePageFocusPanel === 'interaction' ? '' : interactionPanel}`;
}

function typeSpecificConfig(block, editor = null) {
  if (block.type === 'text') return `<div class="free-page-inspector-section"><h4>Texte</h4>
    <div class="free-page-format-strip">
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="bold"><b>G</b></button>
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="italic"><i>I</i></button>
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="underline"><u>S</u></button>
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="insertUnorderedList">&#8226;</button>
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="insertOrderedList">1.</button>
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="formatBlock" data-fpe-command-value="blockquote">&#10077;</button>
      <button type="button" class="free-page-tool free-page-tool--icon" data-fpe-command="removeFormat">Tx</button>
    </div>
    <label>Taille <input type="number" min="1" max="96" value="${Number(block.fontSize) || 18}" data-fpe-inspector-field="fontSize"></label>
    <div class="free-page-control-row"><span>Alignement</span>${alignmentButtonsHtml(block.align)}</div>
    <div class="free-page-control-row"><span>Couleur</span><span class="free-page-color-combo">${colorPresetButtonsHtml('textColor', TEXT_COLOR_PRESETS, block.textColor || legacyTextColor(block.color))}<input class="free-page-color-custom" type="color" value="${_esc(block.textColor || legacyTextColor(block.color))}" data-fpe-inspector-field="textColor"></span></div>
    <label>Fond ${selectHtml('surface', ['none', 'soft', 'dark'], block.surface, surfaceLabel)}</label>
  </div>`;
  if (block.type === 'image') {
    const cropping = block.id && block.id === editor?.__freePageCropBlockId;
    return `<div class="free-page-inspector-section ${block.fit === 'cover' || cropping ? 'is-focused' : ''}"><h4>Image</h4>
    <div class="free-page-inspector-actions">
      <button type="button" class="free-page-tool" data-fpe-action="replace-image">Remplacer</button>
      <button type="button" class="free-page-tool ${cropping ? 'is-active' : ''}" data-fpe-action="${cropping ? 'finish-crop' : 'crop-image'}">${cropping ? 'Terminer rognure' : 'Rogner'}</button>
    </div>
    ${cropping ? '<p class="free-page-crop-help">Cadre pointille = zone visible. Tire l image pour la recadrer, ou les poignees violettes pour changer sa taille.</p>' : ''}
    <label>Cadrage ${selectHtml('fit', ['contain', 'cover'], block.fit, fitLabel)}</label>
    <label>Image X <input type="range" min="-900" max="900" value="${Number(block.imageX ?? 0)}" data-fpe-inspector-field="imageX"></label>
    <label>Image Y <input type="range" min="-900" max="900" value="${Number(block.imageY ?? 0)}" data-fpe-inspector-field="imageY"></label>
    <label>Largeur image <input type="range" min="1" max="900" value="${Number(block.imageW ?? 100)}" data-fpe-inspector-field="imageW"></label>
    <label>Hauteur image <input type="range" min="1" max="900" value="${Number(block.imageH ?? 100)}" data-fpe-inspector-field="imageH"></label>
    <p>Double-clic sur l'image ou clic droit > Rogner l'image pour revenir ici rapidement.</p>
  </div>`;
  }
  if (block.type === 'shape') return `<div class="free-page-inspector-section"><h4>Forme</h4>
    <label>Type ${selectHtml('shape', [...SHAPE_TYPES], block.shape, shapeLabel)}</label>
    <div class="free-page-control-row"><span>Remplissage</span><span class="free-page-color-combo">${colorPresetButtonsHtml('fill', SHAPE_COLOR_PRESETS, block.fill || DEFAULT_SHAPE_FILL)}<input class="free-page-color-custom" type="color" value="${_esc(block.fill || DEFAULT_SHAPE_FILL)}" data-fpe-inspector-field="fill"></span></div>
    <div class="free-page-control-row"><span>Contour</span><span class="free-page-color-combo">${colorPresetButtonsHtml('stroke', INLINE_TEXT_COLORS, block.stroke || DEFAULT_SHAPE_STROKE)}<input class="free-page-color-custom" type="color" value="${_esc(block.stroke || DEFAULT_SHAPE_STROKE)}" data-fpe-inspector-field="stroke"></span></div>
    <label>Epaisseur <input type="number" min="0" max="12" value="${Number(block.strokeWidth) || 0}" data-fpe-inspector-field="strokeWidth"></label>
    <label class="free-page-inspector-check">Ombre / profondeur <input type="checkbox" data-fpe-inspector-field="shadow" ${block.shadow ? 'checked' : ''}></label>
    ${block.shadow ? `<label>Profondeur <input type="range" min="4" max="80" value="${Number(block.shadowDepth) || 22}" data-fpe-inspector-field="shadowDepth"></label>` : ''}
    ${block.shape === 'rectangle' ? `<label>Arrondi <input type="number" min="0" max="80" value="${Number(block.radius) || 0}" data-fpe-inspector-field="radius"></label>` : ''}
    ${block.shape === 'line' ? '<p>Mode actuel : ligne libre. Les connecteurs attaches entre deux blocs seront geres separement pour rester fiables quand les blocs bougent.</p>' : ''}
  </div>`;
  if (block.type === 'table') return `<div class="free-page-inspector-section"><h4>Tableau</h4>
    <label class="free-page-inspector-check">Ligne d'en-tête <input type="checkbox" data-fpe-inspector-field="tableHeader" ${block.header !== false ? 'checked' : ''}></label>
    <label>Taille texte <input type="number" min="10" max="28" value="${Number(block.fontSize) || 14}" data-fpe-inspector-field="tableFontSize"></label>
    <div class="free-page-control-row"><span>Texte</span><span class="free-page-color-combo">${colorPresetButtonsHtml('tableTextColor', TEXT_COLOR_PRESETS, block.textColor || '#c8d4e8')}<input class="free-page-color-custom" type="color" value="${_esc(block.textColor || '#c8d4e8')}" data-fpe-inspector-field="tableTextColor"></span></div>
    <div class="free-page-control-row"><span>En-tête</span><span class="free-page-color-combo">${colorPresetButtonsHtml('tableHeaderColor', INLINE_TEXT_COLORS, block.headerColor || '#e8c66a')}<input class="free-page-color-custom" type="color" value="${_esc(block.headerColor || '#e8c66a')}" data-fpe-inspector-field="tableHeaderColor"></span></div>
    <div class="free-page-control-row"><span>Bordures</span><span class="free-page-color-combo">${colorPresetButtonsHtml('tableBorderColor', SHAPE_COLOR_PRESETS, block.borderColor || '#263957')}<input class="free-page-color-custom" type="color" value="${_esc(block.borderColor || '#263957')}" data-fpe-inspector-field="tableBorderColor"></span></div>
  </div>`;
  return '';
}

function interactionConfigHtml(interaction, focused = false, editor = null) {
  const choices = [
    ['none', 'Aucune', 'Bloc purement visuel'],
    ['popup', 'Ouvrir une fenetre', 'Affiche une fenetre au clic'],
    ['label', 'Voir une etiquette', 'Affiche un texte au survol'],
    ['audio', 'Lire un audio', 'Lance un fichier audio au clic'],
    ['link', 'Ouvrir un lien', 'Ouvre une page ou une adresse'],
    ['page', 'Aller a une diapo', 'Navigue dans ce diaporama'],
  ];
  const slides = editor?.__freePageDeck?.slides || [];
  const detail = interaction.type === 'audio'
    ? `<label>Fichier audio <input value="${_esc(interaction.target)}" data-fpe-inspector-field="interactionTarget" placeholder="URL ou chemin du fichier audio"></label>`
    : interaction.type === 'link'
      ? `<label>Lien <input value="${_esc(interaction.target)}" data-fpe-inspector-field="interactionTarget" placeholder="#personnage, #trame ou https://..."></label>`
    : interaction.type === 'label'
      ? `<label>Etiquette <textarea rows="5" data-fpe-inspector-field="interactionText" placeholder="Texte affiche au survol...">${_esc(interaction.text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))}</textarea></label>`
    : interaction.type === 'page'
      ? `<label>Diapo cible <select class="free-page-select" data-fpe-inspector-field="interactionTarget">
          <option value="">Choisir une diapo...</option>
          ${slides.map((slide, index) => `<option value="slide:${_esc(slide.id)}" ${interaction.target === `slide:${slide.id}` ? 'selected' : ''}>${index + 1}. ${_esc(slide.title || `Diapo ${index + 1}`)}${slide.hidden ? ' (cachee)' : ''}</option>`).join('')}
        </select></label>`
    : interaction.type === 'popup'
        ? `<div class="free-page-window-summary">
            <div>
              <strong>${interaction.page ? 'Fenetre creee' : 'Aucune fenetre choisie'}</strong>
              <span>${interaction.page ? 'Le bouton du bloc affiche maintenant Fenetre. Clique dessus pour previsualiser ou modifier.' : 'Choisis un modele de fenetre, puis edite-la comme une diapo autonome.'}</span>
            </div>
            <button type="button" class="free-page-tool free-page-tool--primary" data-fpe-popup-action="${interaction.page ? 'manage' : 'templates'}">${interaction.page ? 'Ouvrir la fenetre' : 'Choisir une fenetre'}</button>
          </div>`
        : `<p>Choisis ce que fera ce bloc lorsqu'un joueur interagit avec lui.</p>`;
  return `<div class="free-page-inspector-section ${focused ? 'is-focused' : ''}" data-fpe-interaction-panel><h4>Interactivite</h4>
    <div class="free-page-interaction-choices">
      ${choices.map(([value, label, hint]) => `<button type="button" class="free-page-interaction-choice ${interaction.type === value ? 'is-active' : ''}" data-fpe-inspector-field="interactionType" value="${_esc(value)}"><strong>${_esc(label)}</strong><small>${_esc(hint)}</small></button>`).join('')}
    </div>
    ${detail}
  </div>`;
}

function chartInspectorConfig(block) {
  return `<div class="free-page-inspector-section"><h4>Graphique</h4>
    <label>Titre <input value="${_esc(block.title ?? '')}" placeholder="Optionnel" data-fpe-inspector-field="title"></label>
    <label>Type ${selectHtml('chartType', [...CHART_TYPES], block.chartType, chartTypeLabel)}</label>
    <label>Palette ${chartPaletteHtml(block.chartPalette)}</label>
    ${toggleHtml('showChartBackground', 'Fond du graphique', block.showChartBackground !== false)}
    ${toggleHtml('showChartFrame', 'Cadre du graphique', block.showChartFrame !== false)}
    ${toggleHtml('showLegend', 'Montrer la legende', block.showLegend !== false)}
    ${toggleHtml('showLabels', 'Afficher les etiquettes', block.showLabels !== false)}
    ${toggleHtml('showValues', 'Afficher les valeurs', block.showValues !== false)}
    ${toggleHtml('showTooltips', 'Infos au survol', block.showTooltips !== false)}
  </div>`;
}

function inspectorChartSheetHtml(block) {
  const items = normalizeItems(block.items, block.chartPalette);
  const columns = CHART_COLUMNS.slice(0, clamp(block.chartColumnCount || CHART_COLUMNS.length, 2, CHART_COLUMNS.length));
  return `<div class="free-page-chart-sheet free-page-chart-sheet--inspector" role="grid" aria-label="Donnees du graphique">
    <div class="free-page-chart-sheet-actions">
      <button type="button" data-fpe-action="chart-row-add" title="Ajouter une ligne" aria-label="Ajouter une ligne">+L</button>
      <button type="button" data-fpe-action="chart-row-remove" title="Retirer la derniere ligne" aria-label="Retirer la derniere ligne">-L</button>
      <button type="button" data-fpe-action="chart-col-add" title="Ajouter une colonne" aria-label="Ajouter une colonne">+C</button>
      <button type="button" data-fpe-action="chart-col-remove" title="Retirer la derniere colonne" aria-label="Retirer la derniere colonne">-C</button>
    </div>
    <div class="free-page-chart-sheet-head" style="--sheet-cols:${columns.length}"><span></span>${columns.map((_, index) => `<span>${String.fromCharCode(65 + index)}</span>`).join('')}</div>
    ${items.map((item, index) => `<div class="free-page-chart-sheet-row" style="--chart-color:${chartColor(item.color, index, block.chartPalette)};--sheet-cols:${columns.length}">
      <span class="free-page-chart-sheet-index">${index + 1}</span>${columns.map((column) => chartCell(column, item, index, block.chartPalette)).join('')}
    </div>`).join('')}
  </div>`;
}

function chartCell(column, item, index, paletteName) {
  if (column === 'color') return `<input type="color" data-fpe-inspector-chart-field="color" data-index="${index}" value="${_esc(chartColor(item.color, index, paletteName))}">`;
  if (column === 'value') return `<input type="number" min="0" max="999" data-fpe-inspector-chart-field="value" data-index="${index}" value="${_esc(item.value)}">`;
  if (column === 'note') return `<input data-fpe-inspector-chart-field="note" data-index="${index}" value="${_esc(item.note || '')}">`;
  return `<input data-fpe-inspector-chart-field="label" data-index="${index}" value="${_esc(item.label)}">`;
}

function inspectorTableSheetHtml(block) {
  const rows = normalizeRows(block.rows);
  const width = rows[0]?.length || 2;
  return `<div class="free-page-chart-sheet free-page-chart-sheet--inspector free-page-table-sheet" role="grid">
    <div class="free-page-chart-sheet-actions"><button type="button" data-fpe-action="table-row" title="Ajouter une ligne" aria-label="Ajouter une ligne">+L</button><button type="button" data-fpe-action="table-row-remove" title="Retirer la derniere ligne" aria-label="Retirer la derniere ligne">-L</button><button type="button" data-fpe-action="table-col" title="Ajouter une colonne" aria-label="Ajouter une colonne">+C</button><button type="button" data-fpe-action="table-col-remove" title="Retirer la derniere colonne" aria-label="Retirer la derniere colonne">-C</button></div>
    <div class="free-page-chart-sheet-head" style="--sheet-cols:${width}"><span></span>${Array.from({ length: width }, (_, index) => `<span>${String.fromCharCode(65 + index)}</span>`).join('')}</div>
    ${rows.map((row, rowIndex) => `<div class="free-page-chart-sheet-row" style="--sheet-cols:${width}"><span class="free-page-chart-sheet-index">${rowIndex + 1}</span>${row.map((cell, colIndex) => `<input data-fpe-inspector-table-cell data-row="${rowIndex}" data-col="${colIndex}" value="${_esc(cell)}">`).join('')}</div>`).join('')}
  </div>`;
}

function selectHtml(field, values, selected, labeler = (v) => v) {
  return `<select class="free-page-select" data-fpe-inspector-field="${_esc(field)}">${values.map((value) => `<option value="${_esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${_esc(labeler(value))}</option>`).join('')}</select>`;
}

function fontOptionsHtml(selected = TEXT_FONTS[0].value) {
  const safeSelected = safeTextFont(selected);
  return TEXT_FONTS.map((font) => `<option value="${_esc(font.value)}" ${font.value === safeSelected ? 'selected' : ''}>${_esc(font.name)}</option>`).join('');
}

function interactionSelectHtml(selected) {
  return selectHtml('interactionType', ['none', 'popup', 'label', 'audio', 'link', 'page'], selected, interactionLabel);
}

function alignmentButtonsHtml(selected = 'left') {
  const icons = { left: '&#9776;', center: '&#8801;', right: '&#9776;' };
  return `<div class="free-page-align-buttons">${['left', 'center', 'right'].map((value) => `<button type="button" class="free-page-align-button ${value === selected ? 'is-active' : ''} free-page-align-button--${value}" data-fpe-inspector-field="align" value="${value}" title="${_esc(alignLabel(value))}" aria-label="${_esc(alignLabel(value))}">${icons[value]}</button>`).join('')}</div>`;
}

function colorPresetButtonsHtml(field, colors, selected) {
  const safeSelected = safeColor(selected, colors[0]?.value || '#eef2fb').toLowerCase();
  return `<div class="free-page-color-preset-row">${colors.map((color) => {
    const value = safeColor(color.value, '#eef2fb');
    return `<button type="button" class="free-page-color-dot ${value.toLowerCase() === safeSelected ? 'is-active' : ''}" data-fpe-inspector-field="${_esc(field)}" value="${_esc(value)}" title="${_esc(color.name)}" aria-label="${_esc(color.name)}" style="--fpe-dot:${_esc(value)}"></button>`;
  }).join('')}</div>`;
}

function pageColorButtonsHtml(selected) {
  const safeSelected = safeColor(selected, DEFAULT_PAGE_BG).toLowerCase();
  return `<div class="free-page-color-preset-row">${PAGE_BACKGROUND_PRESETS.map((color) => {
    const value = safeColor(color.value, DEFAULT_PAGE_BG);
    return `<button type="button" class="free-page-color-dot ${value.toLowerCase() === safeSelected ? 'is-active' : ''}" data-fpe-page-field="background" value="${_esc(value)}" title="${_esc(color.name)}" aria-label="${_esc(color.name)}" style="--fpe-dot:${_esc(value)}"></button>`;
  }).join('')}</div>`;
}

function chartPaletteHtml(selected) {
  return `<div class="free-page-palette-grid">${Object.entries(CHART_PALETTES).map(([name, colors]) => `<button type="button" class="free-page-palette-choice ${name === selected ? 'is-active' : ''}" data-fpe-inspector-field="chartPalette" value="${_esc(name)}" style="--palette-preview:${colors.map((color, index) => `${color} ${index * (100 / colors.length)}% ${(index + 1) * (100 / colors.length)}%`).join(',')}"><span>${_esc(paletteLabel(name))}</span><i></i></button>`).join('')}</div>`;
}

function toggleHtml(field, label, checked) {
  return `<label class="free-page-inspector-check">${_esc(label)}<input type="checkbox" data-fpe-inspector-chart-option="${_esc(field)}" ${checked ? 'checked' : ''}></label>`;
}

function shapePopoverHtml() {
  return [...SHAPE_TYPES].map((shape) => `<button type="button" class="free-page-shape-choice" data-fpe-action="add-shape" data-shape="${shape}" title="${_esc(shapeLabel(shape))}" aria-label="${_esc(shapeLabel(shape))}"><span class="free-page-shape-icon free-page-shape-icon--${shape}"></span></button>`).join('');
}

function positionPopoverHtml() {
  const anchors = [
    ['tl', 'Haut gauche'], ['tc', 'Haut centre'], ['tr', 'Haut droit'],
    ['ml', 'Centre gauche'], ['mc', 'Centre'], ['mr', 'Centre droit'],
    ['bl', 'Bas gauche'], ['bc', 'Bas centre'], ['br', 'Bas droit'],
  ];
  return anchors.map(([anchor, label]) => `<button type="button" class="free-page-position-choice free-page-position-choice--${anchor}" data-fpe-action="position-${anchor}" title="${_esc(label)}" aria-label="${_esc(label)}"><span></span></button>`).join('');
}

function textColorPopoverHtml(selected = '#eef2fb') {
  const safeSelected = safeColor(selected, '#eef2fb').toLowerCase();
  const swatches = TEXT_SWATCH_COLUMNS.map((row) => row.map((color) => {
    const safe = safeColor(color, '#eef2fb');
    return `<button type="button" class="free-page-text-swatch ${safe.toLowerCase() === safeSelected ? 'is-active' : ''}" data-fpe-inspector-field="textColor" value="${_esc(safe)}" style="--fpe-dot:${_esc(safe)}" title="${_esc(safe)}" aria-label="${_esc(safe)}"></button>`;
  }).join('')).join('');
  const recent = TEXT_RECENT_COLORS.map((color) => {
    const safe = safeColor(color, '#eef2fb');
    const none = safe === '#eef2fb' ? ' title="Blanc"' : '';
    return `<button type="button" class="free-page-color-dot ${safe.toLowerCase() === safeSelected ? 'is-active' : ''}" data-fpe-inspector-field="textColor" value="${_esc(safe)}" style="--fpe-dot:${_esc(safe)}"${none}></button>`;
  }).join('');
  return `<div class="free-page-color-tabs">
    <button type="button" class="is-active" data-fpe-color-tab="samples">Échantillons</button>
    <button type="button" data-fpe-color-tab="advanced">Avancé</button>
  </div>
  <div class="free-page-color-panel" data-fpe-color-panel="samples">
    <div class="free-page-text-swatch-grid">${swatches}</div>
    <div class="free-page-color-edit-row">
      <span class="free-page-color-preview" style="--fpe-dot:${_esc(safeColor(selected, '#eef2fb'))}"></span>
      <input type="text" value="${_esc(safeColor(selected, '#eef2fb'))}" data-fpe-inspector-field="textColor">
      <input type="color" value="${_esc(safeColor(selected, '#eef2fb'))}" data-fpe-inspector-field="textColor" title="Couleur personnalisée">
    </div>
    <span class="free-page-color-subtitle">Couleurs récentes</span>
    <div class="free-page-color-recent-row">${recent}</div>
    <span class="free-page-color-subtitle">Palette de création</span>
    <div class="free-page-color-recent-row">${TEXT_COLOR_PRESETS.slice(0, 4).map((color) => `<button type="button" class="free-page-color-dot" data-fpe-inspector-field="textColor" value="${_esc(color.value)}" style="--fpe-dot:${_esc(color.value)}" title="${_esc(color.name)}"></button>`).join('')}</div>
  </div>
  <div class="free-page-color-panel free-page-color-panel--advanced" data-fpe-color-panel="advanced" hidden>
    <div class="free-page-color-advanced-plane"></div>
    <input class="free-page-color-wide" type="color" value="${_esc(safeColor(selected, '#eef2fb'))}" data-fpe-inspector-field="textColor">
    <div class="free-page-color-edit-row">
      <span class="free-page-color-preview" style="--fpe-dot:${_esc(safeColor(selected, '#eef2fb'))}"></span>
      <input type="text" value="${_esc(safeColor(selected, '#eef2fb'))}" data-fpe-inspector-field="textColor">
    </div>
    <span class="free-page-color-subtitle">Couleurs récentes</span>
    <div class="free-page-color-recent-row">${recent}</div>
  </div>`;
}

function blockTypeLabel(type) { return ({ text: 'Texte', image: 'Image', table: 'Tableau', chart: 'Graphique', shape: 'Forme' })[type] || 'Bloc'; }
function shapeLabel(shape) {
  return ({
    rectangle: 'Rectangle',
    circle: 'Cercle / ovale',
    diamond: 'Losange',
    triangle: 'Triangle',
    pentagon: 'Pentagone',
    hexagon: 'Hexagone',
    star: 'Etoile',
    arrow: 'Fleche',
    chevron: 'Chevron',
    line: 'Ligne',
  })[shape] || 'Rectangle';
}
function chartTypeLabel(type) { return ({ bar: 'Colonnes', 'horizontal-bar': 'Barres horizontales', line: 'Courbe', area: 'Aire', pie: 'Secteurs', doughnut: 'Anneau', radar: 'Radar', polar: 'Polaire', scatter: 'Nuage de points', lollipop: 'Sucettes', progress: 'Progression' })[type] || type; }
function paletteLabel(value) { return ({ arcane: 'Arcanique', ember: 'Flamme', nature: 'Nature', royal: 'Royale', mono: 'Encre' })[value] || value; }
function textColorLabel(value) { return ({ default: 'Texte', gold: 'Or', blue: 'Bleu', green: 'Vert', red: 'Rouge', violet: 'Violet' })[value] || value; }
function surfaceLabel(value) { return ({ none: 'Sans fond', soft: 'Fond discret', dark: 'Fond sombre' })[value] || value; }
function fitLabel(value) { return value === 'cover' ? 'Remplir le cadre' : 'Image entiere'; }
function alignLabel(value) { return ({ left: 'Gauche', center: 'Centre', right: 'Droite' })[value] || value; }
function interactionLabel(value) { return ({ none: 'Aucune', popup: 'Fenetre', label: 'Etiquette', audio: 'Audio', link: 'Lien', page: 'Page' })[value] || 'Aucune'; }
function interactionButtonLabel(value) { return ({ popup: 'Fenetre', label: 'Etiquette', audio: 'Audio', link: 'Lien', page: 'Page' })[value] || 'Interactivite'; }
function legacyTextColor(value) { return ({ default: '#eef2fb', gold: '#e8c66a', blue: '#9ec2ff', green: '#69dbb5', red: '#ff9bae', violet: '#c7a6ff' })[value] || '#eef2fb'; }

function layerIcon(type) {
  return ({ text: 'T', image: 'Img', table: 'Tab', chart: 'Graph', shape: 'Forme', nav: 'Menu' })[type] || 'Bloc';
}

function blockLayerLabel(block) {
  if (block.type === 'text') return String(block.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 36) || 'Texte';
  if (block.type === 'image') return block.alt || 'Image';
  if (block.type === 'chart') return block.title || 'Graphique';
  if (block.type === 'table') return 'Tableau';
  if (block.type === 'shape') return `Forme ${block.shape || 'rectangle'}`;
  return blockTypeLabel(block.type);
}

function runLayerAction(editor, action, id) {
  if (!id) return;
  if (id === NAV_BLOCK_ID) {
    const nav = editor.__freePageDeck.nav = normalizeDeckNav(editor.__freePageDeck.nav, editor.__freePageDeck.slides);
    if (action === 'select') return setSelected(editor, NAV_BLOCK_ID);
    if (action === 'toggle-visible') {
      const allIds = editor.__freePageDeck.slides.map((slide) => slide.id);
      const set = new Set(nav.visibleSlideIds?.length ? nav.visibleSlideIds : allIds);
      set.has(editor.__freePageSlideId) ? set.delete(editor.__freePageSlideId) : set.add(editor.__freePageSlideId);
      const next = allIds.filter((slideId) => set.has(slideId));
      nav.visibleSlideIds = next.length === allIds.length ? [] : next;
      renderBlocks(editor, set.has(editor.__freePageSlideId) ? NAV_BLOCK_ID : null);
    }
    return;
  }
  const block = editor.__freePageState.blocks.find((item) => item.id === id);
  if (!block) return;
  if (action === 'select') return setSelected(editor, id);
  pushHistory(editor);
  if (action === 'toggle-visible') block.hidden = !block.hidden;
  if (action === 'toggle-lock') block.locked = !block.locked;
  if (action === 'front') block.z = nextZ(editor);
  if (action === 'back') block.z = Math.max(1, Math.min(...editor.__freePageState.blocks.map((item) => item.z || 1)) - 1);
  renderBlocks(editor, block.hidden ? null : id);
}

function showAllLayers(editor) {
  pushHistory(editor);
  (editor.__freePageState?.blocks || []).forEach((block) => { block.hidden = false; });
  if (editor.__freePageDeck?.nav?.enabled) {
    const nav = editor.__freePageDeck.nav = normalizeDeckNav(editor.__freePageDeck.nav, editor.__freePageDeck.slides);
    if (nav.visibleSlideIds.length && !nav.visibleSlideIds.includes(editor.__freePageSlideId)) nav.visibleSlideIds = [];
  }
  renderBlocks(editor, editor.__freePageSelected);
}

function selectedBlock(editor) { return editor.__freePageState?.blocks.find((block) => block.id === editor.__freePageSelected) || null; }
function selectedBlocks(editor) {
  const ids = editor.__freePageSelectedIds?.length ? editor.__freePageSelectedIds : editor.__freePageSelected ? [editor.__freePageSelected] : [];
  return ids.map((id) => editor.__freePageState?.blocks.find((block) => block.id === id)).filter(Boolean);
}
function selectedElement(editor) {
  if (editor.__freePageSelected === NAV_BLOCK_ID) return editor.querySelector('[data-fpe-nav-block]');
  return editor.__freePageSelected ? editor.querySelector(`[data-fpe-block="${cssEscape(editor.__freePageSelected)}"]`) : null;
}
function nextZ(editor) { return Math.min(999, Math.max(0, ...editor.__freePageState.blocks.map((block) => block.z || 0)) + 1); }

function currentSlide(editor) {
  return editor.__freePageDeck?.slides?.find((slide) => slide.id === editor.__freePageSlideId)
    || editor.__freePageDeck?.slides?.[0]
    || null;
}

function syncCurrentSlide(editor) {
  if (!editor.__freePageDeck || editor.__freePagePopupEdit) return;
  const slide = currentSlide(editor);
  if (!slide) return;
  slide.page = normalizeSingleFreePage(structuredClone(editor.__freePageState));
  editor.__freePageDeck.activeSlideId = slide.id;
}

function pushHistory(editor, { sync = true } = {}) {
  const snapshot = JSON.stringify(normalizeFreePage(editor.__freePageState));
  if (editor.__freePageUndo.at(-1) === snapshot) return;
  editor.__freePageUndo.push(snapshot);
  if (editor.__freePageUndo.length > MAX_HISTORY) editor.__freePageUndo.shift();
  editor.__freePageRedo = [];
  if (sync) syncToolbar(editor);
}

function scheduleHistory(editor, options = {}) {
  if (editor.__freePageHistoryTimer) return;
  pushHistory(editor, options);
  editor.__freePageHistoryTimer = window.setTimeout(() => { editor.__freePageHistoryTimer = null; }, 900);
}

function undo(editor) {
  clearHistoryTimer(editor);
  const previous = editor.__freePageUndo.pop();
  if (!previous) return;
  editor.__freePageRedo.push(JSON.stringify(normalizeFreePage(editor.__freePageState)));
  editor.__freePageState = normalizeFreePage(JSON.parse(previous));
  afterHistoryRestore(editor);
}

function redo(editor) {
  clearHistoryTimer(editor);
  const next = editor.__freePageRedo.pop();
  if (!next) return;
  editor.__freePageUndo.push(JSON.stringify(normalizeFreePage(editor.__freePageState)));
  editor.__freePageState = normalizeFreePage(JSON.parse(next));
  afterHistoryRestore(editor);
}

function afterHistoryRestore(editor) {
  editor.__freePageTextRange = null;
  editor.__freePageInlineTarget = null;
  const selected = editor.__freePageSelected;
  const keepSelected = selected && editor.__freePageState.blocks.some((block) => block.id === selected);
  renderBlocks(editor, keepSelected ? selected : null);
}

function clearHistoryTimer(editor) {
  if (!editor?.__freePageHistoryTimer) return;
  window.clearTimeout(editor.__freePageHistoryTimer);
  editor.__freePageHistoryTimer = null;
}

function updateSelectedElementStyle(editor, block) {
  const el = selectedElement(editor);
  if (!el || !block) return;
  block.x = clamp(block.x, 0, PAGE_WIDTH - block.w);
  block.y = clamp(block.y, 0, editor.__freePageState.height - block.h);
  el.setAttribute('style', blockStyle(block, editor.__freePageState.height));
}

function updateSelectedTextStyle(editor, block) {
  if (block?.type !== 'text') return;
  const text = selectedElement(editor)?.querySelector('.free-page-text');
  if (!text) return;
  text.style.textAlign = block.align || 'left';
  text.style.fontSize = responsiveFontSize(Number(block.fontSize) || 18);
  text.style.fontFamily = safeTextFont(block.fontFamily);
  text.style.textTransform = block.textTransform === 'uppercase' ? 'uppercase' : 'none';
  text.style.color = block.textColor || legacyTextColor(block.color);
  text.className = `free-page-text free-page-text--${block.surface || 'none'} free-page-text-color--${block.color || 'default'}`;
}

function updateSelectedImageStyle(editor, block) {
  if (block?.type !== 'image') return;
  const el = selectedElement(editor);
  const img = el?.querySelector('.free-page-image');
  if (!img) return;
  img.setAttribute('style', imageInnerStyle(block));
  const outline = el.querySelector('.free-page-crop-image-outline');
  if (outline) outline.setAttribute('style', imageCropOverlayStyle(block));
}

function syncImageCropInspector(editor, block) {
  if (block?.type !== 'image') return;
  ['imageX', 'imageY', 'imageW', 'imageH'].forEach((field) => {
    const input = editor.querySelector(`[data-fpe-inspector-field="${field}"]`);
    if (input) input.value = String(Math.round(block[field] ?? (field.endsWith('W') || field.endsWith('H') ? 100 : 0)));
  });
}

function updateSelectedTableStyle(editor, block) {
  if (block?.type !== 'table') return;
  const wrap = selectedElement(editor)?.querySelector('.free-page-table-wrap');
  if (!wrap) return;
  wrap.style.setProperty('--table-text', block.textColor || '#c8d4e8');
  wrap.style.setProperty('--table-header', block.headerColor || '#e8c66a');
  wrap.style.setProperty('--table-border', block.borderColor || '#263957');
  wrap.style.setProperty('--table-font', responsiveFontSize(Number(block.fontSize) || 14));
}

function updateSelectedChartStyle(editor, block) {
  if (block?.type !== 'chart') return;
  const chart = selectedElement(editor)?.querySelector('.free-page-chart');
  if (!chart) return;
  chart.classList.toggle('is-background-hidden', block.showChartBackground === false);
  chart.classList.toggle('is-frame-hidden', block.showChartFrame === false);
  const title = chart.querySelector('[data-fpe-chart-title]');
  if (title) title.value = block.title ?? '';
}

function updateSelectedShapeStyle(editor, block) {
  if (block?.type !== 'shape') return;
  const shape = selectedElement(editor)?.querySelector('.free-page-shape');
  if (!shape) return;
  shape.style.setProperty('--shape-fill', block.fill || DEFAULT_SHAPE_FILL);
  shape.style.setProperty('--shape-stroke', block.stroke || DEFAULT_SHAPE_STROKE);
  shape.style.setProperty('--shape-stroke-width', `${Number(block.strokeWidth) || 0}px`);
  shape.style.setProperty('--shape-radius', `${Number(block.radius) || 0}px`);
  shape.style.setProperty('--shape-shadow', `${Number(block.shadowDepth) || 22}px`);
}

function syncLiveBlock(editor) {
  const block = selectedBlock(editor);
  const el = selectedElement(editor);
  if (block?.type === 'text') block.content = cleanFreePageTextHtml(el?.querySelector('[data-fpe-content]')?.innerHTML || block.content || '');
}

function syncInteractionPageEditor(editor) {
  if (editor.__freePagePopupEdit?.rootState) {
    const session = editor.__freePagePopupEdit;
    const block = session.rootState.blocks.find((item) => item.id === session.blockId);
    if (!block) return;
    block.interaction = {
      ...normalizeInteraction(block.interaction),
      type: 'popup',
      layout: POPUP_LAYOUTS.has(session.layout) ? session.layout : 'center',
      frame: normalizePopupFrame(session.frame, session.layout),
      page: normalizeSingleFreePage(structuredClone(editor.__freePageState)),
    };
    return;
  }
  const block = selectedBlock(editor);
  const popupEditor = editor.querySelector('[data-fpe-popup-editor] [data-free-page-editor]');
  if (!block || !popupEditor?.__freePageState) return;
  block.interaction = { ...normalizeInteraction(block.interaction), page: getFreePageData(popupEditor) };
}

function blocksOverlap(a, b) { return a && b && a.id !== b.id && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function groupMembers(editor, block) { return (block?.groupId ? editor.__freePageState.blocks.filter((item) => item.groupId === block.groupId) : [block].filter(Boolean)).filter((item) => !item.locked); }

function snapUnit(editor) {
  const grid = normalizeDeckGrid(editor.__freePageDeck?.grid);
  return grid.snap ? grid.size : 5;
}

function snapValue(editor, value) {
  const unit = snapUnit(editor);
  return Math.round((Number(value) || 0) / unit) * unit;
}

function moveBlockGroup(editor, block, dx, dy) {
  const members = groupMembers(editor, block);
  const minX = Math.min(...members.map((item) => item.x));
  const minY = Math.min(...members.map((item) => item.y));
  const maxX = Math.max(...members.map((item) => item.x + item.w));
  const maxY = Math.max(...members.map((item) => item.y + item.h));
  const safeDx = clamp(dx, -minX, PAGE_WIDTH - maxX);
  const safeDy = clamp(dy, -minY, editor.__freePageState.height - maxY);
  members.forEach((item) => { item.x = Math.round(item.x + safeDx); item.y = Math.round(item.y + safeDy); });
}

function alignSelectedBlocks(editor, action) {
  const targets = selectedBlocks(editor).filter((item) => !item.locked);
  if (!targets.length) return;
  const minX = Math.min(...targets.map((item) => item.x));
  const maxX = Math.max(...targets.map((item) => item.x + item.w));
  const minY = Math.min(...targets.map((item) => item.y));
  const maxY = Math.max(...targets.map((item) => item.y + item.h));
  targets.forEach((item) => {
    if (action === 'align-left') item.x = minX;
    if (action === 'align-center') item.x = Math.round((minX + maxX - item.w) / 2);
    if (action === 'align-right') item.x = maxX - item.w;
    if (action === 'align-top') item.y = minY;
    if (action === 'align-middle') item.y = Math.round((minY + maxY - item.h) / 2);
    if (action === 'align-bottom') item.y = maxY - item.h;
    item.x = clamp(snapValue(editor, item.x), 0, PAGE_WIDTH - item.w);
    item.y = clamp(snapValue(editor, item.y), 0, editor.__freePageState.height - item.h);
  });
}

function positionSelectionOnPage(editor, anchor) {
  let targets = selectedBlocks(editor).filter((item) => !item.locked);
  if (!targets.length) {
    const domIds = [...editor.querySelectorAll('[data-fpe-block].is-selected')].map((el) => el.dataset.fpeBlock).filter(Boolean);
    targets = domIds.map((id) => editor.__freePageState?.blocks.find((block) => block.id === id)).filter((item) => item && !item.locked);
  }
  if (!targets.length) return showNotif('Selectionne au moins un bloc a placer.', 'info');
  const bounds = selectionBounds(targets);
  const pageHeight = editor.__freePageState.height;
  const targetX = anchor.endsWith('l') ? 0 : anchor.endsWith('r') ? PAGE_WIDTH - bounds.w : Math.round((PAGE_WIDTH - bounds.w) / 2);
  const targetY = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? pageHeight - bounds.h : Math.round((pageHeight - bounds.h) / 2);
  const dx = targetX - bounds.x;
  const dy = targetY - bounds.y;
  pushHistory(editor);
  targets.forEach((item) => {
    item.x = Math.round(clamp(item.x + dx, 0, PAGE_WIDTH - item.w));
    item.y = Math.round(clamp(item.y + dy, 0, pageHeight - item.h));
  });
  editor.querySelector('[data-fpe-position-popover]').hidden = true;
  renderBlocks(editor, editor.__freePageSelected);
}

function rotateSelectedBlocks(editor, direction, step = 1) {
  const targets = selectedBlocks(editor).filter((item) => !item.locked);
  if (!targets.length) return;
  pushHistory(editor);
  targets.forEach((item) => {
    item.rotation = step >= 15
      ? snapRotation((item.rotation || 0) + direction * step, { forceStep: 15 }).angle
      : normalizeRotation((item.rotation || 0) + direction * step);
  });
  renderBlocks(editor, editor.__freePageSelected);
}

function selectionBounds(targets) {
  const minX = Math.min(...targets.map((item) => item.x));
  const minY = Math.min(...targets.map((item) => item.y));
  const maxX = Math.max(...targets.map((item) => item.x + item.w));
  const maxY = Math.max(...targets.map((item) => item.y + item.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function distributeSelectedBlocks(editor, axis) {
  const targets = selectedBlocks(editor).filter((item) => !item.locked);
  const isX = axis === 'x';
  const sorted = [...targets].sort((a, b) => (isX ? a.x - b.x : a.y - b.y));
  if (sorted.length < 3) return;
  const start = isX ? sorted[0].x : sorted[0].y;
  const end = isX ? sorted.at(-1).x + sorted.at(-1).w : sorted.at(-1).y + sorted.at(-1).h;
  const totalSize = sorted.reduce((sum, item) => sum + (isX ? item.w : item.h), 0);
  const gap = Math.max(0, (end - start - totalSize) / (sorted.length - 1));
  let cursor = start;
  sorted.forEach((item) => {
    if (isX) {
      item.x = clamp(snapValue(editor, cursor), 0, PAGE_WIDTH - item.w);
      cursor += item.w + gap;
    } else {
      item.y = clamp(snapValue(editor, cursor), 0, editor.__freePageState.height - item.h);
      cursor += item.h + gap;
    }
  });
}

function moveGroupFromStart(editor, groupStart, dx, dy) {
  const minX = Math.min(...groupStart.map((item) => item.x));
  const minY = Math.min(...groupStart.map((item) => item.y));
  const maxX = Math.max(...groupStart.map((item) => item.x + item.w));
  const maxY = Math.max(...groupStart.map((item) => item.y + item.h));
  const safeDx = clamp(dx, -minX, PAGE_WIDTH - maxX);
  const safeDy = clamp(dy, -minY, editor.__freePageState.height - maxY);
  groupStart.forEach((start) => {
    const item = editor.__freePageState.blocks.find((candidate) => candidate.id === start.id);
    if (item?.locked) return;
    if (item) { item.x = Math.round(start.x + safeDx); item.y = Math.round(start.y + safeDy); }
  });
}

function popupTemplateDefs() {
  return [
    ['center', 'Fenetre centree', 'Une fenetre classique au centre de la composition.'],
    ['left', 'Panneau gauche', 'Une fenetre collee au cote gauche de l\'ecran.'],
    ['right', 'Panneau droit', 'Une fenetre collee au cote droit de l\'ecran.'],
    ['round', 'Fenetre ronde', 'Un focus circulaire pour indice, portrait ou revelation.'],
    ['triple', 'Trois fenetres', 'Trois petites fenetres centrees et alignees.'],
  ];
}

function popupPreviewHtml(interaction) {
  const safe = normalizeInteraction(interaction);
  const layout = POPUP_LAYOUTS.has(safe.layout) ? safe.layout : 'center';
  return `<div class="free-page-window-preview-frame free-page-window-preview-frame--${_esc(layout)}">
    <div class="free-page-popup-card free-page-popup-card--page">
      ${renderFreePageHtml({ page: safe.page, className: 'free-page-popup-reader' })}
    </div>
  </div>`;
}

function openFreePagePreview(editor) {
  if (!editor.__freePageDeck) return;
  syncLiveBlock(editor);
  syncCurrentSlide(editor);
  ensureReaderInteractions();
  const deck = normalizeFreePageDeck(structuredClone(editor.__freePageDeck));
  const slide = deck.slides.find((item) => item.id === editor.__freePageSlideId && !item.hidden) || defaultReaderSlide(deck);
  const page = normalizeSingleFreePage(slide.page);
  closeFreePageModal();
  const overlay = document.createElement('div');
  overlay.className = 'free-page-popup free-page-popup--preview';
  overlay.dataset.freePagePopup = '1';
  overlay.tabIndex = -1;
  overlay.innerHTML = `<div class="free-page-preview-card">
    <div class="free-page-preview-head">
      <div>
        <span>Apercu joueur</span>
        <strong>${_esc(slide.title || 'Diapo')}</strong>
      </div>
      <button type="button" class="free-page-popup-close" data-fpe-preview-close aria-label="Fermer">&times;</button>
    </div>
    <div class="free-page-preview-reader">
      <div class="free-page-reader free-page-reader--preview" data-free-page-reader data-free-page-current-slide="${_esc(slide.id)}" data-free-page-previous-slide="" data-free-page-deck="${_esc(JSON.stringify(deck))}" style="--free-page-ratio:${PAGE_WIDTH}/${page.height}">
        ${readerStageHtml(deck, slide)}
        ${readerNavHtml(deck, slide.id)}
      </div>
    </div>
  </div>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-fpe-preview-close]')) closeFreePageModal();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFreePageModal();
  });
  document.body.appendChild(overlay);
  overlay.focus({ preventScroll: true });
}

function openPopupTemplateModal(editor) {
  const block = selectedBlock(editor);
  if (!block) return;
  closeFreePageModal();
  const overlay = document.createElement('div');
  overlay.className = 'free-page-popup free-page-popup--designer';
  overlay.dataset.freePagePopup = '1';
  overlay.innerHTML = `<div class="free-page-designer-card free-page-template-card">
    <button type="button" class="free-page-popup-close" data-fpe-popup-action="close" aria-label="Fermer">&times;</button>
    <div class="free-page-designer-head">
      <span>Interactivite</span>
      <h3>Selectionner une fenetre</h3>
      <p>Choisis une base. Tu pourras ensuite la modifier comme une diapo autonome.</p>
    </div>
    <div class="free-page-template-grid">
      ${popupTemplateDefs().map(([id, label, hint]) => `<button type="button" class="free-page-template-choice" data-fpe-popup-template="${_esc(id)}">
        <span class="free-page-template-preview"><span class="free-page-template-mock free-page-template-mock--${_esc(id)}">${id === 'triple' ? '<i></i><i></i><i></i>' : '<i></i>'}</span></span>
        <strong>${_esc(label)}</strong>
        <small>${_esc(hint)}</small>
      </button>`).join('')}
    </div>
  </div>`;
  bindPopupOverlay(editor, overlay);
  document.body.appendChild(overlay);
}

function openPopupManageModal(editor) {
  const block = selectedBlock(editor);
  const interaction = normalizeInteraction(block?.interaction);
  if (!block || interaction.type !== 'popup') return;
  if (!interaction.page) return openPopupTemplateModal(editor);
  closeFreePageModal();
  const overlay = document.createElement('div');
  overlay.className = 'free-page-popup free-page-popup--designer';
  overlay.dataset.freePagePopup = '1';
  overlay.innerHTML = `<div class="free-page-designer-card free-page-window-card">
    <button type="button" class="free-page-popup-close" data-fpe-popup-action="close" aria-label="Fermer">&times;</button>
    <div class="free-page-designer-head">
      <span>Fenetre liee au bloc</span>
      <h3>Modifier la fenetre</h3>
      <p>Voici ce qui s'ouvrira quand on cliquera sur l'element interactif.</p>
    </div>
    <div class="free-page-window-preview">
      ${popupPreviewHtml(interaction)}
    </div>
    <div class="free-page-window-actions">
      <button type="button" class="free-page-tool" data-fpe-popup-action="templates">Changer de modele</button>
      <button type="button" class="free-page-tool free-page-tool--danger" data-fpe-popup-action="remove">Eliminer</button>
      <button type="button" class="free-page-tool free-page-tool--primary" data-fpe-popup-action="edit">Modifier la fenetre</button>
    </div>
  </div>`;
  bindPopupOverlay(editor, overlay);
  document.body.appendChild(overlay);
}

function openPopupEditModal(editor) {
  const block = selectedBlock(editor);
  const interaction = normalizeInteraction(block?.interaction);
  if (!block || interaction.type !== 'popup') return;
  startInlinePopupEdit(editor, block);
}

function startInlinePopupEdit(editor, block = selectedBlock(editor)) {
  const interaction = normalizeInteraction(block?.interaction);
  if (!block || interaction.type !== 'popup') return;
  closeFreePageModal();
  syncLiveBlock(editor);
  syncInteractionPageEditor(editor);
  const rootState = editor.__freePageState;
  editor.__freePagePopupEdit = {
    blockId: block.id,
    rootState,
    rootDeck: structuredClone(editor.__freePageDeck),
    rootSlideId: editor.__freePageSlideId,
    rootUndo: [...(editor.__freePageUndo || [])],
    rootRedo: [...(editor.__freePageRedo || [])],
    layout: POPUP_LAYOUTS.has(interaction.layout) ? interaction.layout : 'center',
    frame: normalizePopupFrame(interaction.frame, interaction.layout),
  };
  editor.__freePageState = normalizeSingleFreePage(interaction.page || defaultPopupPage(interaction.layout));
  editor.__freePageSelected = null;
  editor.__freePageUndo = [];
  editor.__freePageRedo = [];
  renderBlocks(editor, null);
  renderInspector(editor);
}

function finishInlinePopupEdit(editor) {
  const session = editor.__freePagePopupEdit;
  if (!session) return;
  syncLiveBlock(editor);
  const rootState = session.rootState;
  const block = rootState?.blocks?.find((item) => item.id === session.blockId);
  if (!block || !rootState) {
    editor.__freePagePopupEdit = null;
    renderBlocks(editor, null);
    renderInspector(editor);
    return;
  }
  const page = normalizeSingleFreePage(structuredClone(editor.__freePageState));
  const previousRoot = JSON.stringify(normalizeSingleFreePage(rootState));
  block.interaction = {
    ...normalizeInteraction(block.interaction),
    type: 'popup',
    layout: POPUP_LAYOUTS.has(session.layout) ? session.layout : 'center',
    frame: normalizePopupFrame(session.frame, session.layout),
    page,
  };
  editor.__freePageState = rootState;
  const slide = editor.__freePageDeck?.slides?.find((item) => item.id === session.rootSlideId);
  if (slide) slide.page = rootState;
  editor.__freePageSlideId = session.rootSlideId || editor.__freePageSlideId;
  editor.__freePageUndo = [...(session.rootUndo || [])];
  editor.__freePageRedo = [...(session.rootRedo || [])];
  if (editor.__freePageUndo.at(-1) !== previousRoot) {
    editor.__freePageUndo.push(previousRoot);
    if (editor.__freePageUndo.length > MAX_HISTORY) editor.__freePageUndo.shift();
  }
  editor.__freePagePopupEdit = null;
  renderBlocks(editor, block.id);
  renderInspector(editor);
}

function bindPopupOverlay(editor, overlay) {
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) return closeFreePageModal();
    const template = event.target.closest?.('[data-fpe-popup-template]')?.dataset.fpePopupTemplate;
    if (template) { choosePopupTemplate(editor, template); return; }
    const action = event.target.closest?.('[data-fpe-popup-action]')?.dataset.fpePopupAction;
    if (action) runPopupModalAction(editor, action);
  });
}

function choosePopupTemplate(editor, templateId) {
  const block = selectedBlock(editor);
  if (!block) return;
  pushHistory(editor);
  const layout = POPUP_LAYOUTS.has(templateId) ? templateId : 'center';
  block.interaction = { ...normalizeInteraction(block.interaction), type: 'popup', layout, frame: defaultPopupFrame(layout), page: defaultPopupPage(templateId) };
  closeFreePageModal();
  startInlinePopupEdit(editor, block);
}

function runPopupModalAction(editor, action) {
  const block = selectedBlock(editor);
  if (!block && action !== 'close') return;
  if (action === 'close') return closeFreePageModal();
  if (action === 'templates') return openPopupTemplateModal(editor);
  if (action === 'manage') return openPopupManageModal(editor);
  if (action === 'edit') return openPopupEditModal(editor);
  if (action === 'remove') {
    pushHistory(editor);
    block.interaction = { ...normalizeInteraction(block.interaction), type: 'none', page: null };
    closeFreePageModal();
    renderBlocks(editor, block.id);
    renderInspector(editor);
    return;
  }
  if (action === 'save-edit') {
    const modalEditor = document.querySelector('[data-free-page-popup] [data-free-page-editor]');
    const page = getFreePageData(modalEditor);
    if (!page) return showNotif('Fenetre indisponible.', 'error');
    pushHistory(editor);
    const current = normalizeInteraction(block.interaction);
    block.interaction = { ...current, type: 'popup', frame: current.frame, page };
    closeFreePageModal();
    renderBlocks(editor, block.id);
    renderInspector(editor);
    openPopupManageModal(editor);
  }
}

function closeFreePageModal() {
  document.querySelector('[data-free-page-popup]')?.remove();
}

function ensureReaderInteractions() {
  if (readerInteractionsBound || typeof document === 'undefined') return;
  readerInteractionsBound = true;
  document.addEventListener('click', (event) => {
    const slideButton = event.target.closest?.('[data-fpe-reader-slide]');
    if (slideButton) {
      const slideId = slideButton.dataset.fpeReaderSlide || '';
      if (!slideId) return;
      event.preventDefault();
      switchReaderSlide(slideButton, slideId);
      return;
    }
    const block = event.target.closest?.('[data-fpe-reader-action]');
    if (!block) return;
    if (block.dataset.fpeReaderAction === 'label') return;
    event.preventDefault();
    runReaderInteraction(block.dataset.fpeReaderAction, {
      title: block.dataset.fpeReaderTitle || '',
      text: block.dataset.fpeReaderText || '',
      target: block.dataset.fpeReaderTarget || '',
      layout: block.dataset.fpeReaderLayout || 'center',
      frame: safeJson(block.dataset.fpeReaderFrame || 'null'),
      page: safeJson(block.dataset.fpeReaderPage || 'null'),
    }, block);
  });
  document.addEventListener('submit', (event) => {
    const form = event.target.closest?.('[data-fpe-reader-unlock]');
    if (!form) return;
    event.preventDefault();
    unlockReaderSlide(form);
  });
  document.addEventListener('mouseover', (event) => {
    const block = event.target.closest?.('[data-fpe-reader-action="label"]');
    if (!block || block.contains(event.relatedTarget)) return;
    showReaderTooltip(block);
  });
  document.addEventListener('mouseout', (event) => {
    const block = event.target.closest?.('[data-fpe-reader-action="label"]');
    if (!block || block.contains(event.relatedTarget)) return;
    hideReaderTooltip();
  });
  // Navigation clavier ← → (et PageUp/Down) — pour parcourir un diaporama :
  //  • toujours si un lecteur est en plein écran,
  //  • sinon uniquement pour un lecteur ayant opté (data-free-page-keyboard) et
  //    s'il est le seul → on ne vole pas les flèches des autres pages/lecteurs.
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const forward = event.key === 'ArrowRight' || event.key === 'PageDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'PageUp';
    if (!forward && !backward) return;
    const t = event.target;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"], [data-free-page-editor]')) return;
    const fs = document.fullscreenElement;
    let reader = fs ? (fs.matches?.('[data-free-page-reader]') ? fs : fs.querySelector?.('[data-free-page-reader]')) : null;
    if (!reader) {
      const opted = [...document.querySelectorAll('[data-free-page-reader][data-free-page-keyboard]')];
      reader = opted.length === 1 ? opted[0] : null;
    }
    if (!reader) return;
    const deck = normalizeFreePageDeck(safeJson(reader.dataset.freePageDeck || 'null'));
    if (deck.canBrowse === false) return;
    const slides = visibleSlides(deck);
    if (slides.length <= 1) return;
    const idx = Math.max(0, slides.findIndex((s) => s.id === reader.dataset.freePageCurrentSlide));
    const next = slides[idx + (forward ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    switchReaderSlide(reader, next.id);
  });
}

function runReaderInteraction(type, payload, sourceBlock = null) {
  if (type === 'link' && payload.target) { const url = safeExternalUrl(payload.target); if (url) window.open(url, '_blank', 'noopener,noreferrer'); return; }
  if (type === 'page' && payload.target?.startsWith?.('slide:')) return switchReaderSlide(sourceBlock, payload.target.slice(6));
  if (type === 'page' && payload.target) { window.location.hash = payload.target.startsWith('#') ? payload.target : `#${payload.target}`; return; }
  if (type === 'audio' && payload.target) { const url = safeExternalUrl(payload.target); if (!url) return; try { new Audio(url).play(); } catch { showNotif("Impossible de lire l'audio.", 'error'); } return; }
  if (type === 'popup') return showFreePagePopupPage(payload.page, payload.layout, sourceBlock?.closest?.('.free-page-stage--reader'), payload.frame);
}

// Valide le schéma d'une cible d'interaction externe (lien/audio) avant de
// l'ouvrir : http/https/mailto/tel uniquement. Bloque javascript:/data:/etc.
// (le reste de l'app valide déjà les URLs ainsi ; les cibles internes de type
// « page » — slide:/# — ne passent pas par ici).
function safeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, document.baseURI);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol.toLowerCase()) ? raw : '';
  } catch { return ''; }
}

function switchReaderSlide(sourceBlock, slideId) {
  const reader = sourceBlock?.closest?.('[data-free-page-reader]');
  if (!reader) return;
  const deck = normalizeFreePageDeck(safeJson(reader.dataset.freePageDeck || 'null'));
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide || slide.hidden) return showNotif('Diapo indisponible.', 'error');
  const previousId = reader.dataset.freePageCurrentSlide && reader.dataset.freePageCurrentSlide !== slide.id
    ? reader.dataset.freePageCurrentSlide
    : reader.dataset.freePagePreviousSlide || '';
  renderReaderSlide(reader, deck, slide, previousId);
}

function unlockReaderSlide(form) {
  const reader = form.closest?.('[data-free-page-reader]');
  if (!reader) return;
  const deck = normalizeFreePageDeck(safeJson(reader.dataset.freePageDeck || 'null'));
  const slide = deck.slides.find((item) => item.id === reader.dataset.freePageCurrentSlide);
  if (!slide) return;
  const input = form.querySelector('[data-fpe-reader-password]');
  const error = form.querySelector('[data-fpe-reader-lock-error]');
  if (String(input?.value || '') !== slide.password) {
    if (error) error.hidden = false;
    input?.focus?.();
    return;
  }
  unlockSlide(deck, slide);
  renderReaderSlide(reader, deck, slide, reader.dataset.freePagePreviousSlide || '');
}

function renderReaderSlide(reader, deck, slide, previousId = '') {
  const page = normalizeSingleFreePage(slide.page);
  reader.dataset.freePageCurrentSlide = slide.id;
  reader.dataset.freePagePreviousSlide = previousId || '';
  reader.style.setProperty('--free-page-ratio', `${PAGE_WIDTH}/${page.height}`);
  reader.innerHTML = `${readerStageHtml(deck, slide, previousId)}${readerNavHtml(deck, slide.id, previousId)}`;
}

function showReaderTooltip(block) {
  const text = block?.dataset?.fpeReaderText || '';
  if (!text) return;
  hideReaderTooltip();
  const tooltip = document.createElement('div');
  tooltip.className = 'free-page-floating-tooltip';
  tooltip.innerHTML = sanitizeRichTextHtml(text);
  document.body.appendChild(tooltip);
  activeReaderTooltip = tooltip;
  const rect = block.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const left = clamp(rect.left + rect.width / 2 - tipRect.width / 2, 8, window.innerWidth - tipRect.width - 8);
  const top = Math.max(8, rect.top - tipRect.height - 10);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideReaderTooltip() {
  activeReaderTooltip?.remove();
  activeReaderTooltip = null;
}

function showFreePagePopupPage(page, layout = 'center', hostStage = null, frame = null) {
  document.querySelector('[data-free-page-popup]')?.remove();
  const safeLayout = POPUP_LAYOUTS.has(layout) ? layout : 'center';
  if (hostStage) {
    hostStage.querySelector('[data-free-page-reader-popup]')?.remove();
    const safeFrame = normalizePopupFrame(frame, safeLayout);
    const layer = document.createElement('div');
    layer.className = `free-page-inline-popup free-page-inline-popup--${safeLayout} free-page-reader-popup-layer`;
    layer.dataset.freePageReaderPopup = '1';
    layer.innerHTML = `<div class="free-page-inline-backdrop" aria-hidden="true"></div><div class="free-page-inline-window" style="${popupFrameStyle(safeFrame, DEFAULT_HEIGHT)}"><button type="button" class="free-page-popup-close" aria-label="Fermer">&times;</button>${renderFreePageHtml({ page: hasFreePage(page) ? page : defaultPopupPage(safeLayout), className: 'free-page-popup-reader' })}</div>`;
    layer.addEventListener('click', (event) => {
      if (event.target === layer || event.target.closest('.free-page-inline-backdrop, .free-page-popup-close')) layer.remove();
    });
    hostStage.appendChild(layer);
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = `free-page-popup free-page-popup--layout-${safeLayout}`;
  overlay.dataset.freePagePopup = '1';
  overlay.innerHTML = `<div class="free-page-popup-viewport"><div class="free-page-popup-card free-page-popup-card--page"><button type="button" class="free-page-popup-close" aria-label="Fermer">&times;</button>${renderFreePageHtml({ page: hasFreePage(page) ? page : defaultPopupPage(), className: 'free-page-popup-reader' })}</div></div>`;
  overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.closest('.free-page-popup-close')) overlay.remove(); });
  document.body.appendChild(overlay);
}

function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(raw)) return raw;
  try {
    const url = new URL(raw, document.baseURI);
    return ['http:', 'https:'].includes(url.protocol) ? raw : '';
  } catch { return ''; }
}

function isDataImageUrl(value) {
  return /^data:image\//i.test(String(value || '').trim());
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}
