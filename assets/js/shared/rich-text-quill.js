// Éditeur enrichi partagé basé sur Quill 2.
// L'API publique est stable : les appelants manipulent toujours du HTML.
import { _esc } from './html.js';
import { sanitizeRichTextHtml } from './rich-text.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal } from './upload-cloudinary.js';
import { showNotif } from './notifications.js';
import { STATE } from '../core/state.js';
import { ASSET_VERSION } from '../core/version.js';
import { loadCollection } from '../data/firestore.js';

const _instances = new Map();
const _states = new WeakMap();
let _loading = null;
let _formatsRegistered = false;
let _guardBound = false;
let _mentionCatalog = null;
let _mentionCatalogLoading = null;
if (typeof document !== 'undefined') document.addEventListener('app:adventure-changed', () => {
  _mentionCatalog = null;
  _mentionCatalogLoading = null;
});

const COLORS = ['#f4c430', '#7eb0ff', '#6fe0b8', '#ff7a95', '#ec4899', '#b9a2ff', '#8497b0'];
const HIGHLIGHTS = ['rgba(244,196,48,.28)', 'rgba(79,140,255,.30)', 'rgba(34,195,142,.28)', 'rgba(255,90,126,.28)', 'rgba(236,72,153,.30)', 'rgba(169,139,255,.30)', 'rgba(132,151,176,.28)'];
const DICE_RE = /^\d{1,2}d\d{1,3}(?:[+-]\d{1,3})?$/i;
const CALLOUTS = { voix: 'À lire à voix haute', note: 'Note', danger: 'Danger', secret: 'Secret MJ' };
const MENTION_TYPES = {
  personnage: { label: 'Personnages', mark: 'P' },
  joueur: { label: 'Joueurs', mark: 'J' },
  pnj: { label: 'PNJ', mark: 'N' },
  objet: { label: 'Objets', mark: 'O' },
  lieu: { label: 'Lieux', mark: 'L' },
};

const ICONS = {
  down: '<path d="m5 6 3 3 3-3"/>', color: '<path d="M3 13h10M5 10l3-8 3 8M6 7h4"/>',
  list: '<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="3" cy="4" r=".7"/><circle cx="3" cy="8" r=".7"/><circle cx="3" cy="12" r=".7"/>',
  ordered: '<path d="M6 4h8M6 8h8M6 12h8M2 3h1v2M2 7h1l-1 2h1M2 11h1v2H2"/>',
  check: '<path d="m2 4 1 1 2-2M7 4h7m-12 4 1 1 2-2M7 8h7m-12 4 1 1 2-2M7 12h7"/>',
  align: '<path d="M2 3h12M4 6h8M2 9h12M5 12h6"/>', link: '<path d="M6 10 4 12a2.2 2.2 0 0 1-3-3l2-2a2.2 2.2 0 0 1 3 0m4-1 2-2a2.2 2.2 0 0 1 3 3l-2 2a2.2 2.2 0 0 1-3 0M5 11l6-6"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5" cy="6" r="1"/><path d="m3 12 3-3 2 2 2-2 3 3"/>',
  table: '<rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.4"/><path d="M1.75 6h12.5M5.9 6v7.75M10.1 6v7.75"/><path d="M1.75 6h12.5V2.25H1.75z" fill="currentColor" stroke="none" opacity=".22"/>',
  undo: '<path d="M5 4 2 7l3 3M2 7h7a4 4 0 0 1 4 4"/>', redo: '<path d="m11 4 3 3-3 3M14 7H7a4 4 0 0 0-4 4"/>',
  find: '<circle cx="7" cy="7" r="4"/><path d="m10 10 4 4"/>', more: '<circle cx="3" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="13" cy="8" r=".8"/>',
  plus: '<path d="M8 2v12M2 8h12"/>',
  focus: '<path d="M2 6V2h4m4 0h4v4m0 4v4h-4m-4 0H2v-4"/>', quote: '<path d="M3 5h4v4H4l-1 3m6-7h4v4h-3l-1 3"/>',
  clean: '<path d="m3 11 6-8 4 3-5 7H4zM2 14h12"/>', close: '<path d="m4 4 8 8m0-8-8 8"/>', help: '<circle cx="8" cy="8" r="6"/><path d="M6.5 6a1.7 1.7 0 1 1 2.3 1.6c-.8.4-.8.8-.8 1.4M8 12h.01"/>',
};
const icon = name => `<svg class="rtq-ico" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const tool = (attrs, title, body) => {
  const classMatch = String(attrs || '').match(/\bclass="([^"]*)"/);
  const classes = classMatch ? ` ${classMatch[1]}` : '';
  const cleanAttrs = String(attrs || '').replace(/\s*\bclass="[^"]*"/, '');
  return `<button type="button" class="rtq-tool${classes}" ${cleanAttrs} title="${title}" aria-label="${title}">${body}</button>`;
};

export function loadQuill() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (_loading) return _loading;
  const addCss = (id, href) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; link.href = href; document.head.appendChild(link);
  };
  _loading = new Promise((resolve, reject) => {
    addCss('quill-snow-css', './assets/css/vendor/quill.snow.css');
    addCss('quill-dark-css', `./assets/css/rich-text-quill.css?v=${ASSET_VERSION}`);
    const script = document.createElement('script'); script.src = './assets/js/vendor/quill-2.0.3.min.js';
    script.onload = () => resolve(window.Quill); script.onerror = () => reject(new Error('Quill introuvable')); document.head.appendChild(script);
  });
  return _loading;
}

function registerFormats(Quill) {
  if (_formatsRegistered) return;
  _formatsRegistered = true;
  const Embed = Quill.import('blots/embed');
  const Block = Quill.import('blots/block');
  const Parchment = Quill.import('parchment');
  class Dice extends Embed {
    static blotName = 'dice'; static tagName = 'SPAN'; static className = 'rt-dice';
    static create(value) { const n = super.create(); const f = String(value || '1d20').replace(/\s/g, '').toLowerCase(); n.classList.add('rt-chip'); n.dataset.dice = f; n.contentEditable = 'false'; n.textContent = f; return n; }
    static value(n) { return n.dataset.dice || n.textContent; }
  }
  class Mention extends Embed {
    static blotName = 'mention'; static tagName = 'SPAN'; static className = 'rt-mention';
    static create(value = {}) { const n = super.create(); n.classList.add('rt-chip'); n.dataset.kind = value.kind || 'personnage'; n.dataset.ref = value.ref || value.label || ''; n.contentEditable = 'false'; n.textContent = `@${value.label || value.ref || 'Mention'}`; return n; }
    static value(n) { return { kind: n.dataset.kind, ref: n.dataset.ref, label: n.textContent.replace(/^@/, '') }; }
  }
  class Divider extends Embed { static blotName = 'divider'; static tagName = 'HR'; }
  class Callout extends Block {
    static blotName = 'callout'; static tagName = 'DIV'; static className = 'rt-callout';
    static create(value) { const n = super.create(); const k = value || 'note'; n.dataset.kind = k; n.dataset.label = CALLOUTS[k] || 'Note'; return n; }
    static formats(n) { return n.dataset.kind || 'note'; }
    format(name, value) { if (name === 'callout' && value) { this.domNode.dataset.kind = value; this.domNode.dataset.label = CALLOUTS[value] || 'Note'; } else super.format(name, value); }
  }
  Quill.register(Dice, true); Quill.register(Mention, true); Quill.register(Divider, true); Quill.register(Callout, true);
  Quill.register(new Parchment.ClassAttributor('rt-size', 'rt', { scope: Parchment.Scope.INLINE, whitelist: ['sm', 'lg'] }), true);
}

function toolbarHtml(canImage) {
  return `<div class="rtq-toolbar ql-toolbar ql-snow" role="toolbar" aria-label="Mise en forme">
    <button type="button" class="rtq-style" data-rtq-menu="style"><span class="rtq-style-label" data-rtq-style-label>Paragraphe</span>${icon('down')}</button><span class="rtq-sep"></span>
    <span class="rtq-group">${tool('class="ql-bold"', 'Gras · Ctrl+B', '<b>B</b>')}${tool('data-rtq-command="italic"', 'Italique · Ctrl+I', '<i>I</i>')}${tool('class="ql-underline"', 'Souligné · Ctrl+U', '<u>U</u>')}${tool('class="ql-strike rtq-secondary"', 'Barré · Ctrl+Maj+X', '<s>S</s>')}
    ${tool('data-rtq-menu="color"', 'Couleur et surlignage', '<span class="rtq-color-letter">A<i></i></span>')}${tool('data-rtq-menu="format" class="rtq-secondary rtq-aa"', 'Autres formats', '<b>Aa</b>' + icon('down'))}</span><span class="rtq-sep"></span>
    <span class="rtq-group">${tool('class="ql-list" value="bullet"', 'Liste à puces · Ctrl+Maj+8', icon('list'))}${tool('class="ql-list rtq-secondary" value="ordered"', 'Liste numérotée · Ctrl+Maj+7', icon('ordered'))}${tool('class="ql-list rtq-secondary" value="check"', 'Liste à cocher · Ctrl+Maj+9', icon('check'))}${tool('data-rtq-menu="align" class="rtq-secondary"', 'Alignement et retrait', icon('align') + icon('down'))}</span><span class="rtq-sep rtq-secondary"></span>
    <span class="rtq-group">${tool('data-rtq-action="link"', 'Lien · Ctrl+K', icon('link'))}${canImage ? tool('data-rtq-action="image"', 'Image · MJ', icon('image')) : ''}${tool('data-rtq-menu="table" class="rtq-secondary"', 'Tableau', icon('table'))}${tool('data-rtq-menu="insert" class="rtq-insert"', 'Insérer · /', icon('plus') + '<span class="rtq-insert-label">Insérer</span>')}</span><span class="rtq-spacer"></span>
    <span class="rtq-group">${tool('data-rtq-action="undo" class="rtq-wide"', 'Annuler · Ctrl+Z', icon('undo'))}${tool('data-rtq-action="redo" class="rtq-wide"', 'Rétablir · Ctrl+Maj+Z', icon('redo'))}${tool('data-rtq-action="find" class="rtq-wide"', 'Rechercher et remplacer · Ctrl+F', icon('find'))}${tool('data-rtq-menu="more" class="rtq-more"', 'Plus d’outils', icon('more'))}${tool('data-rtq-action="focus"', 'Mode concentration · Ctrl+Maj+F', icon('focus'))}</span>
  </div>`;
}

function swatches(values, attr) {
  return `<div class="rtq-swatches">${values.map(c => `<button type="button" data-rtq-${attr}="${c}" style="--swatch:${c}" aria-label="Couleur"></button>`).join('')}<button type="button" class="is-clear" data-rtq-${attr}="" aria-label="Effacer">×</button></div>`;
}

function popoversHtml(canImage) {
  const tableGrid = Array.from({ length: 48 }, (_, i) => `<button type="button" data-rtq-table-size="${Math.floor(i / 8) + 1}x${i % 8 + 1}"></button>`).join('');
  const menuItem = (attrs, mark, label, detail = '') => `<button type="button" class="rtq-menu-item" ${attrs}><span class="rtq-menu-mark">${mark}</span><span><b>${label}</b>${detail ? `<small>${detail}</small>` : ''}</span></button>`;
  return `<div class="rtq-pop" data-rtq-pop="style" hidden>
      <button class="rtq-menu-item" data-rtq-line="paragraph"><span>Paragraphe</span><kbd>Ctrl Alt 0</kbd></button>
      <button class="rtq-menu-item" data-rtq-line="2"><span class="rtq-preview-h2">Titre</span><kbd>Ctrl Alt 1</kbd></button>
      <button class="rtq-menu-item" data-rtq-line="3"><span class="rtq-preview-h3">Sous-titre</span><kbd>Ctrl Alt 2</kbd></button>
      <button class="rtq-menu-item" data-rtq-line="blockquote"><span>« Citation »</span><kbd>&gt;</kbd></button></div>
    <div class="rtq-pop" data-rtq-pop="color" hidden><h4>Texte</h4>${swatches(COLORS, 'color')}<h4>Surlignage</h4>${swatches(HIGHLIGHTS, 'background')}<button class="rtq-menu-item" data-rtq-action="clean">${icon('clean')}<span>Effacer la mise en forme</span></button></div>
    <div class="rtq-pop" data-rtq-pop="format" hidden><h4>Taille du texte</h4><div class="rtq-segment"><button data-rtq-size="sm">Petit</button><button data-rtq-size="">Normal</button><button data-rtq-size="lg">Grand</button></div>${menuItem('data-rtq-script="super"', 'x²', 'Exposant')}${menuItem('data-rtq-script="sub"', 'H₂', 'Indice')}${menuItem('data-rtq-code', '&lt;/&gt;', 'Code en ligne')}</div>
    <div class="rtq-pop" data-rtq-pop="align" hidden><h4>Alignement</h4><div class="rtq-row">${['', 'center', 'right', 'justify'].map(v => tool(`data-rtq-align="${v}"`, v || 'Gauche', icon('align'))).join('')}</div><h4>Retrait</h4><button class="rtq-menu-item" data-rtq-indent="1"><span>Augmenter le retrait</span><kbd>Tab</kbd></button><button class="rtq-menu-item" data-rtq-indent="-1"><span>Diminuer le retrait</span><kbd>Maj Tab</kbd></button></div>
    <div class="rtq-pop rtq-pop--table" data-rtq-pop="table" hidden><h4>Tableau</h4><div class="rtq-table-grid">${tableGrid}</div><div class="rtq-table-options"><b class="rtq-table-caption">Choisis la taille</b><label><input type="checkbox" data-rtq-table-head> En-tête</label></div></div>
    <div class="rtq-pop rtq-pop--insert" data-rtq-pop="insert" hidden><h4>Blocs</h4>
      ${menuItem('data-rtq-insert="divider" data-rtq-tone="neutral"', '•••', 'Séparateur', 'Pause, changement de scène')}
      ${menuItem('data-rtq-menu="table" data-rtq-tone="table"', icon('table'), 'Tableau', 'Rencontres, butin, tables aléatoires')}
      ${menuItem('data-rtq-callout="voix" data-rtq-tone="voice"', icon('quote'), CALLOUTS.voix, 'Texte d’ambiance à lire aux joueurs')}
      ${menuItem('data-rtq-callout="note" data-rtq-tone="note"', icon('quote'), CALLOUTS.note, 'Rappel, règle, information')}
      ${menuItem('data-rtq-callout="danger" data-rtq-tone="danger"', icon('quote'), CALLOUTS.danger, 'Piège, menace')}
      ${canImage ? menuItem('data-rtq-callout="secret" data-rtq-tone="secret"', icon('quote'), CALLOUTS.secret, 'Invisible pour les joueurs') : ''}
      <h4 class="rtq-insert-section">En jeu</h4>
      ${menuItem('data-rtq-action="dice" data-rtq-tone="dice"', '🎲', 'Jet de dés', 'Cliquable : lance le jet')}
      ${menuItem('data-rtq-action="mention" data-rtq-tone="mention"', '@', 'Mention', 'Personnage, joueur, PNJ, objet ou lieu')}
      ${canImage ? menuItem('data-rtq-action="image" data-rtq-tone="image"', icon('image'), 'Image', 'Depuis l’ordinateur, ou glisser-déposer') : ''}
    </div>
    <div class="rtq-pop" data-rtq-pop="more" hidden><h4>Mise en forme</h4>${menuItem('data-rtq-command="strike"', '<s>S</s>', 'Barré')}${menuItem('data-rtq-command="ordered"', icon('ordered'), 'Liste numérotée')}${menuItem('data-rtq-command="check"', icon('check'), 'Liste à cocher')}${menuItem('data-rtq-menu="format"', 'Aa', 'Formats avancés')}${menuItem('data-rtq-menu="align"', icon('align'), 'Alignement et retrait')}<h4>Outils</h4>${menuItem('data-rtq-action="find"', icon('find'), 'Rechercher et remplacer', 'Ctrl+F')}${menuItem('data-rtq-action="undo"', icon('undo'), 'Annuler')}${menuItem('data-rtq-action="redo"', icon('redo'), 'Rétablir')}</div>
    <div class="rtq-pop rtq-pop--form" data-rtq-pop="link" hidden><label>Adresse du lien<input type="url" data-rtq-link-input placeholder="https://…"></label><div><button data-rtq-link-remove>Retirer</button><button class="is-primary" data-rtq-link-apply>Appliquer</button></div></div>
    <div class="rtq-pop rtq-pop--form" data-rtq-pop="dice" hidden><label>Formule du jet<input data-rtq-dice-input value="1d20"></label><button class="is-primary" data-rtq-dice-apply>Insérer le jet</button></div>
    <div class="rtq-pop rtq-pop--results" data-rtq-pop="slash" hidden></div><div class="rtq-pop rtq-pop--results" data-rtq-pop="mention" hidden></div>`;
}

function chromeHtml() {
  return `<div class="rtq-find" data-rtq-find hidden><div class="rtq-find-field">${icon('find')}<input data-rtq-find-input placeholder="Rechercher"><span data-rtq-find-count>0 / 0</span><button data-rtq-find-case title="Respecter la casse">Aa</button></div><button data-rtq-find-prev title="Précédent · Maj+Entrée">↑</button><button data-rtq-find-next title="Suivant · Entrée">↓</button><div class="rtq-find-field"><input data-rtq-replace-input placeholder="Remplacer par"></div><button class="rtq-find-text" data-rtq-replace>Remplacer</button><button class="rtq-find-text" data-rtq-replace-all>Tout</button><button data-rtq-find-close title="Fermer">${icon('close')}</button></div>
    <div class="rtq-bubble" data-rtq-bubble hidden><button data-rtq-line="2">H</button><button data-rtq-command="bold"><b>B</b></button><button data-rtq-command="italic"><i>I</i></button><button data-rtq-command="underline"><u>U</u></button><button data-rtq-command="strike"><s>S</s></button><button data-rtq-menu="color">${icon('color')}</button><button data-rtq-action="link">${icon('link')}</button><button data-rtq-action="clean">${icon('clean')}</button></div>
    <div class="rtq-context rtq-context--table" data-rtq-table-tools hidden><span>Sélection</span><button data-rtq-table-select="row">Ligne</button><button data-rtq-table-select="column">Colonne</button><button data-rtq-table-select="table">Tout</button><i></i><button data-rtq-table-op="insertRowAbove">+ ligne ↑</button><button data-rtq-table-op="insertRowBelow">+ ligne ↓</button><button data-rtq-table-op="insertColumnLeft">+ colonne ←</button><button data-rtq-table-op="insertColumnRight">+ colonne →</button><button data-rtq-table-op="deleteRow">− ligne</button><button data-rtq-table-op="deleteColumn">− colonne</button><button class="is-danger" data-rtq-table-op="deleteTable">Supprimer</button></div>
    <div class="rtq-context" data-rtq-image-tools hidden><span>Taille</span><button data-rtq-image-size="s">S</button><button data-rtq-image-size="m">M</button><button data-rtq-image-size="l">L</button><button data-rtq-image-align="left">Gauche</button><button data-rtq-image-align="center">Centre</button><button data-rtq-image-align="right">Droite</button><button data-rtq-image-alt>Alt</button><button class="is-danger" data-rtq-image-delete>${icon('close')}</button></div>`;
}

function prepareHtmlForQuill(html) {
  const safe = sanitizeRichTextHtml(html || '');
  try {
    const doc = new DOMParser().parseFromString(`<div>${safe}</div>`, 'text/html');
    const root = doc.body.firstChild;
    root.querySelectorAll('table').forEach(table => {
      const headRows = [...table.querySelectorAll(':scope > thead > tr')];
      if (!headRows.length) return;
      const body = table.querySelector(':scope > tbody') || table.appendChild(doc.createElement('tbody'));
      headRows.reverse().forEach(row => {
        [...row.children].forEach(cell => {
          const td = doc.createElement('td');
          td.innerHTML = cell.innerHTML;
          [...cell.attributes].forEach(attr => td.setAttribute(attr.name, attr.value));
          cell.replaceWith(td);
        });
        body.prepend(row);
      });
      table.querySelector(':scope > thead')?.remove();
      table.classList.add('rt-table--header');
    });
    root.querySelectorAll('ul.rt-check').forEach(list => {
      const ordered = doc.createElement('ol');
      [...list.children].forEach(item => {
        item.setAttribute('data-list', item.dataset.checked === 'true' ? 'checked' : 'unchecked');
        item.removeAttribute('data-checked');
        ordered.appendChild(item);
      });
      list.replaceWith(ordered);
    });
    root.querySelectorAll('[data-rtq-selected-cell]').forEach(cell => cell.removeAttribute('data-rtq-selected-cell'));
    return root.innerHTML;
  } catch {
    return safe;
  }
}

export function quillEditorHtml({ id, html = '', placeholder = '', minHeight = 200 }) {
  const safe = prepareHtmlForQuill(html); const canImage = !!STATE.isAdmin;
  return `<div class="rtq-wrap" data-rtq-wrap="${_esc(id)}" style="--rtq-min-h:${parseInt(minHeight, 10) || 200}px">
    ${toolbarHtml(canImage)}${chromeHtml()}<div class="rtq rtc" data-rtq-id="${_esc(id)}" data-rtq-placeholder="${_esc(placeholder)}">${safe}</div>
    <footer class="rtq-footer"><span class="rtq-save-state"><i></i><span data-rtq-status>Enregistré</span></span><span data-rtq-count>0 mot</span><span data-rtq-reading></span><span class="rtq-footer-hints"><kbd>/</kbd> insérer · <kbd>@</kbd> mentionner <button data-rtq-menu="keys" title="Raccourcis · Ctrl+/">${icon('help')}</button></span></footer>
    ${popoversHtml(canImage)}<div class="rtq-pop rtq-pop--keys" data-rtq-pop="keys" hidden><h4>Raccourcis</h4><dl><dt>Gras / italique / souligné</dt><dd><kbd>Ctrl B / I / U</kbd></dd><dt>Lien</dt><dd><kbd>Ctrl K</kbd></dd><dt>Rechercher</dt><dd><kbd>Ctrl F</kbd></dd><dt>Menu des blocs</dt><dd><kbd>/</kbd></dd><dt>Mention</dt><dd><kbd>@</kbd></dd><dt>Jet de dés</dt><dd><kbd>[1d20+3]</kbd></dd><dt>Concentration</dt><dd><kbd>Ctrl Maj F</kbd></dd></dl></div>
    <input type="file" data-rtq-file accept="image/*" hidden></div>`;
}

const rangeOf = s => s.quill.getSelection() || s.lastRange || { index: Math.max(0, s.quill.getLength() - 1), length: 0 };
function closePops(s, except = '') { s.wrap.querySelectorAll('[data-rtq-pop]').forEach(p => { if (p.dataset.rtqPop !== except) p.hidden = true; }); s.wrap.querySelectorAll('[data-rtq-menu]').forEach(b => b.classList.toggle('is-active', b.dataset.rtqMenu === except)); }
function position(pop, anchor, wrap) {
  if (!pop || !anchor) return; pop.hidden = false;
  const wr = wrap.getBoundingClientRect(); const ar = anchor.left == null ? anchor.getBoundingClientRect() : anchor;
  pop.style.left = `${Math.min(Math.max(8, ar.left - wr.left), Math.max(8, wr.width - pop.offsetWidth - 8))}px`;
  let top = ar.bottom - wr.top + 7; if (top + pop.offsetHeight > wrap.clientHeight && ar.top - wr.top > pop.offsetHeight) top = ar.top - wr.top - pop.offsetHeight - 7;
  pop.style.top = `${Math.max(8, top)}px`;
}
function openMenu(s, name, anchor) { const pop = s.wrap.querySelector(`[data-rtq-pop="${name}"]`); if (!pop) return; const open = !pop.hidden; s.lastRange = s.quill.getSelection() || s.lastRange; closePops(s); if (!open) { position(pop, anchor, s.wrap); anchor.classList.add('is-active'); } }
function markDirty(s) { s.wrap.dataset.quillDirty = 'true'; const el = s.wrap.querySelector('[data-rtq-status]'); if (el) el.textContent = 'Modifications non enregistrées'; updateCount(s); }
function updateCount(s) { const text = s.quill.getText().trim(); const words = text ? text.split(/\s+/u).length : 0; s.wrap.querySelector('[data-rtq-count]').textContent = `${words} mot${words > 1 ? 's' : ''}`; const reading = s.wrap.querySelector('[data-rtq-reading]'); if (reading) reading.textContent = words > 60 ? `~${Math.max(1, Math.ceil(words / 220))} min de lecture` : ''; }

function lineFormat(s, value) {
  const r = rangeOf(s); const q = s.quill;
  if (value === 'paragraph') q.formatLine(r.index, Math.max(1, r.length), { header: false, blockquote: false, callout: false }, 'user');
  else if (value === 'blockquote') q.formatLine(r.index, Math.max(1, r.length), 'blockquote', true, 'user');
  else q.formatLine(r.index, Math.max(1, r.length), 'header', Number(value), 'user');
  q.setSelection(r.index, r.length, 'silent');
}
function openLink(s, anchor) { s.lastRange = rangeOf(s); const pop = s.wrap.querySelector('[data-rtq-pop="link"]'); pop.querySelector('input').value = s.quill.getFormat(s.lastRange).link || ''; closePops(s, 'link'); position(pop, anchor, s.wrap); setTimeout(() => pop.querySelector('input').focus(), 0); }
function applyLink(s) { const pop = s.wrap.querySelector('[data-rtq-pop="link"]'); let url = pop.querySelector('input').value.trim(); if (url && !/^(?:https?:|mailto:|#|\/)/i.test(url)) url = `https://${url}`; const r = rangeOf(s); if (!r.length && url) { s.quill.insertText(r.index, url, { link: url }, 'user'); s.quill.setSelection(r.index + url.length, 0, 'silent'); } else s.quill.formatText(r.index, r.length, 'link', url || false, 'user'); closePops(s); s.quill.focus(); }
function openDice(s, anchor) { s.lastRange = rangeOf(s); const pop = s.wrap.querySelector('[data-rtq-pop="dice"]'); closePops(s, 'dice'); position(pop, anchor, s.wrap); setTimeout(() => { pop.querySelector('input').focus(); pop.querySelector('input').select(); }, 0); }
function insertDice(s) { const input = s.wrap.querySelector('[data-rtq-dice-input]'); const f = input.value.replace(/\s/g, '').toLowerCase(); if (!DICE_RE.test(f)) return showNotif('Formule invalide (ex. 1d20+4)', 'error'); const r = rangeOf(s); if (r.length) s.quill.deleteText(r.index, r.length, 'user'); s.quill.insertEmbed(r.index, 'dice', f, 'user'); s.quill.insertText(r.index + 1, ' ', 'user'); s.quill.setSelection(r.index + 2, 0, 'silent'); closePops(s); }

function loadedEntities() {
  const chars = (STATE.characters || []).map(c => ({ label: c.nom || c.name || c.pseudo || 'Personnage', ref: c.id || c.uid || c.nom || '', kind: 'personnage', detail: c.classe || c.race || 'Personnage' }));
  const places = (STATE.adventure?.locations || STATE.adventure?.lieux || []).map(p => ({ label: p.nom || p.name || String(p), ref: p.id || p.nom || String(p), kind: 'lieu', detail: 'Lieu' }));
  const memberProfiles = Object.entries(STATE.adventure?.memberProfiles || {}).map(([uid, p]) => ({ ...p, uid }));
  const players = [...(STATE.adventureMembers || []), ...memberProfiles].map(p => ({ label: p.pseudo || p.displayName || p.nom || '', ref: p.uid || p.id || '', kind: 'joueur', detail: 'Joueur' }));
  return [...chars, ...places, ...players, ...(_mentionCatalog || [])]
    .filter((x, index, all) => x.label && all.findIndex(y => y.kind === x.kind && (
      x.kind === 'joueur'
        ? y.label.trim().toLocaleLowerCase('fr') === x.label.trim().toLocaleLowerCase('fr')
        : (y.ref || y.label) === (x.ref || x.label)
    )) === index);
}
async function ensureMentionCatalog() {
  if (_mentionCatalog) return _mentionCatalog;
  if (_mentionCatalogLoading) return _mentionCatalogLoading;
  // Chargement uniquement à la première saisie @. `loadCollection` réutilise
  // les caches session-live/TTL, sans ouvrir de listener ni relire à chaque frappe.
  _mentionCatalogLoading = Promise.all([
    loadCollection('npcs').catch(() => []),
    loadCollection('places').catch(() => []),
    loadCollection('characters').catch(() => []),
    loadCollection('shop').catch(() => []),
    loadCollection('players').catch(() => []),
  ]).then(([npcs, places, characters, items, presentations]) => {
    const characterPlayers = characters.map(c => ({
      label: c.ownerPseudo || c.joueur || '', ref: c.uid || c.ownerUid || c.ownerPseudo || '', kind: 'joueur', detail: 'Joueur',
    }));
    const presentationPlayers = presentations.map(p => ({
      label: p.joueur || p.pseudo || p.displayName || '', ref: p.uid || p.userId || p.joueur || '', kind: 'joueur', detail: 'Joueur',
    }));
    _mentionCatalog = [
      ...npcs.map(n => ({ label: n.nom || n.name || '', ref: n.id || n.nom || '', kind: 'pnj', detail: 'PNJ' })),
      ...places.map(p => ({ label: p.nom || p.name || '', ref: p.id || p.nom || '', kind: 'lieu', detail: 'Lieu' })),
      ...characters.map(c => ({ label: c.nom || c.name || '', ref: c.id || c.nom || '', kind: 'personnage', detail: c.classe || c.race || 'Personnage' })),
      ...items.map(item => ({ label: item.nom || item.name || '', ref: item.id || item.nom || '', kind: 'objet', detail: item.categorie || item.type || 'Objet' })),
      ...characterPlayers,
      ...presentationPlayers,
    ].filter(x => x.label);
    return _mentionCatalog;
  }).finally(() => { _mentionCatalogLoading = null; });
  return _mentionCatalogLoading;
}
function caretAnchor(s) { const r = rangeOf(s), b = s.quill.getBounds(r.index), er = s.quill.root.getBoundingClientRect(); return { left: er.left + b.left, right: er.left + b.right, top: er.top + b.top, bottom: er.top + b.bottom }; }
function renderMention(s, query) {
  const pop = s.wrap.querySelector('[data-rtq-pop="mention"]');
  const needle = query.toLowerCase();
  const kind = s.mentionKind || '';
  const values = loadedEntities()
    .filter(x => (!kind || x.kind === kind) && `${x.label} ${x.detail || ''} ${MENTION_TYPES[x.kind]?.label || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => Object.keys(MENTION_TYPES).indexOf(a.kind) - Object.keys(MENTION_TYPES).indexOf(b.kind) || a.label.localeCompare(b.label, 'fr'))
    .slice(0, 24);
  const filters = `<div class="rtq-mention-types"><button class="${kind ? '' : 'is-active'}" data-rtq-mention-kind="">Tous</button>${Object.entries(MENTION_TYPES).map(([key, cfg]) => `<button class="${kind === key ? 'is-active' : ''}" data-rtq-mention-kind="${key}">${cfg.label}</button>`).join('')}</div>`;
  const results = values.length
    ? values.map((x, i) => `<button class="rtq-menu-item${i ? '' : ' is-selected'}" data-rtq-mention-index="${i}"><span class="rtq-avatar" data-kind="${_esc(x.kind)}">${MENTION_TYPES[x.kind]?.mark || _esc(x.label[0])}</span><span><b>@${_esc(x.label)}</b><small>${_esc(x.detail)}</small></span></button>`).join('')
    : `<div class="rtq-mention-empty">Aucun résultat dans cette catégorie.</div>`;
  pop.innerHTML = `<h4>Mentionner</h4>${filters}<div class="rtq-mention-results">${results}</div>`;
  s.mentionValues = values; s.mentionQuery = query; closePops(s, 'mention'); position(pop, caretAnchor(s), s.wrap);
}
function showMention(s, query = '') {
  s.mentionRequest = (s.mentionRequest || 0) + 1;
  const request = s.mentionRequest;
  renderMention(s, query);
  if (!_mentionCatalog) ensureMentionCatalog().then(() => {
    if (s.wrap.isConnected && s.mentionRequest === request) renderMention(s, query);
  });
}
function insertMention(s, index) { const x = s.mentionValues?.[index]; if (!x) return; const r = rangeOf(s), remove = s.mentionQuery == null ? 0 : s.mentionQuery.length + 1, start = Math.max(0, r.index - remove); if (remove) s.quill.deleteText(start, remove, 'user'); s.quill.insertEmbed(start, 'mention', x, 'user'); s.quill.insertText(start + 1, ' ', 'user'); s.quill.setSelection(start + 2, 0, 'silent'); s.mentionQuery = null; s.mentionKind = ''; closePops(s); }

const SLASH = [['paragraph', 'Texte', 'Paragraphe simple'], ['2', 'Titre', 'Grand titre de section'], ['3', 'Sous-titre', 'Intertitre'], ['bullet', 'Liste à puces', 'Liste simple'], ['ordered', 'Liste numérotée', 'Étapes ordonnées'], ['check', 'Liste à cocher', 'Objectifs et quêtes'], ['blockquote', 'Citation', 'Inscription ou réplique'], ['divider', 'Séparateur', 'Changement de scène'], ['table', 'Tableau', 'Rencontres et butin'], ['callout:voix', 'À lire à voix haute', 'Texte pour les joueurs'], ['callout:note', 'Encart note', 'Rappel ou règle'], ['callout:danger', 'Encart danger', 'Piège ou menace'], ['dice', 'Jet de dés', 'Jet cliquable'], ['mention', 'Mention', 'Personnage, joueur, PNJ, objet ou lieu']];
function showSlash(s, query) { const items = SLASH.filter(x => `${x[1]} ${x[2]}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10); const pop = s.wrap.querySelector('[data-rtq-pop="slash"]'); if (!items.length) { pop.hidden = true; return; } pop.innerHTML = `<h4>${query ? 'Résultats' : 'Insérer un bloc'}</h4>${items.map((x, i) => `<button class="rtq-menu-item${i ? '' : ' is-selected'}" data-rtq-slash-index="${i}"><span class="rtq-menu-mark">${x[0] === '2' ? 'H1' : x[0] === '3' ? 'H2' : '+'}</span><span><b>${x[1]}</b><small>${x[2]}</small></span></button>`).join('')}`; s.slashItems = items; s.slashQuery = query; closePops(s, 'slash'); position(pop, caretAnchor(s), s.wrap); }
function runInsert(s, action) { const q = s.quill, r = rangeOf(s); if (action === 'divider') { q.insertEmbed(r.index, 'divider', true, 'user'); q.insertText(r.index + 1, '\n', 'user'); } else if (['bullet', 'ordered', 'check'].includes(action)) { if (s.activeTableCell || tableCellFromRange(s)) showNotif('Les listes ne peuvent pas être appliquées dans une cellule de tableau.', 'info'); else q.formatLine(r.index, 1, 'list', action, 'user'); } else if (['blockquote', 'paragraph', '2', '3'].includes(action)) lineFormat(s, action); else if (action === 'table') openMenu(s, 'table', s.wrap.querySelector('[data-rtq-menu="table"]')); else if (action === 'dice') openDice(s, q.root); else if (action === 'mention') { s.mentionQuery = null; s.mentionKind = ''; showMention(s); } else if (action.startsWith('callout:')) q.formatLine(r.index, Math.max(1, r.length), 'callout', action.slice(8), 'user'); }
function runSlash(s, index) { const x = s.slashItems?.[index]; if (!x) return; const r = rangeOf(s), n = s.slashQuery.length + 1, start = Math.max(0, r.index - n); s.quill.deleteText(start, n, 'user'); s.quill.setSelection(start, 0, 'silent'); closePops(s); runInsert(s, x[0]); }

function openFind(s) { closePops(s); const bar = s.wrap.querySelector('[data-rtq-find]'); bar.hidden = false; s.findIndex = 0; const selected = s.quill.getText(rangeOf(s).index, rangeOf(s).length).trim(); if (selected && selected.length < 80) bar.querySelector('[data-rtq-find-input]').value = selected; doFind(s); setTimeout(() => bar.querySelector('[data-rtq-find-input]').focus(), 0); }
function doFind(s, direction = 0) { const bar = s.wrap.querySelector('[data-rtq-find]'), query = bar.querySelector('[data-rtq-find-input]').value; s.findMatches = []; if (query) { const raw = s.quill.getText(), text = s.findCase ? raw : raw.toLowerCase(), needle = s.findCase ? query : query.toLowerCase(); let at = 0; while ((at = text.indexOf(needle, at)) !== -1 && s.findMatches.length < 500) { s.findMatches.push(at); at += Math.max(1, needle.length); } } if (direction && s.findMatches.length) s.findIndex = (s.findIndex + direction + s.findMatches.length) % s.findMatches.length; else s.findIndex = Math.min(s.findIndex || 0, Math.max(0, s.findMatches.length - 1)); bar.querySelector('[data-rtq-find-count]').textContent = s.findMatches.length ? `${s.findIndex + 1} / ${s.findMatches.length}` : '0 / 0'; if (s.findMatches.length) s.quill.setSelection(s.findMatches[s.findIndex], query.length, 'silent'); }
function replaceFound(s, all) { const bar = s.wrap.querySelector('[data-rtq-find]'), query = bar.querySelector('[data-rtq-find-input]').value, value = bar.querySelector('[data-rtq-replace-input]').value; if (!query || !s.findMatches?.length) return; const indexes = all ? [...s.findMatches].reverse() : [s.findMatches[s.findIndex]]; indexes.forEach(at => { s.quill.deleteText(at, query.length, 'user'); s.quill.insertText(at, value, 'user'); }); doFind(s); }

async function uploadImage(s, file, range = rangeOf(s)) { if (!file?.type?.startsWith('image/') || !STATE.isAdmin) return; if (!hasCloudinaryConfig()) { showNotif('Configure Cloudinary (🔑) pour insérer des images', 'info'); try { openCloudinaryConfigModal(); } catch {} return; } try { showNotif('⏳ Upload de l’image…', 'info'); const { url } = await uploadCloudinary(file, { folder: 'rich-text', tags: ['rich-text'] }); s.quill.insertEmbed(range.index, 'image', url, 'user'); s.quill.setSelection(range.index + 1, 0, 'silent'); showNotif('Image insérée', 'success'); } catch (e) { showNotif(`Upload image échoué : ${e?.message || ''}`, 'error'); } }
function toggleFocus(s) { s.wrap.classList.toggle('is-focus'); document.documentElement.classList.toggle('rtq-focus-open', s.wrap.classList.contains('is-focus')); s.quill.focus(); closePops(s); }
function selectionUi(s, range) {
  if (range) {
    s.lastRange = range;
    const format = s.quill.getFormat(range);
    const label = s.wrap.querySelector('[data-rtq-style-label]');
    if (label) label.textContent = format.header === 2 ? 'Titre' : format.header === 3 ? 'Sous-titre' : format.blockquote ? 'Citation' : 'Paragraphe';
    const colorBar = s.wrap.querySelector('.rtq-color-letter i');
    if (colorBar) colorBar.style.background = format.color || 'var(--rtq-soft)';
    s.wrap.querySelectorAll('[data-rtq-command="italic"]').forEach(button => {
      button.classList.toggle('is-active', !!format.italic);
      button.setAttribute('aria-pressed', format.italic ? 'true' : 'false');
    });
  }
  const bubble = s.wrap.querySelector('[data-rtq-bubble]');
  if (!range?.length) { bubble.hidden = true; return; }
  position(bubble, caretAnchor(s), s.wrap);
}

function tableCellFromRange(s) {
  const range = rangeOf(s);
  const [leaf] = s.quill.getLeaf(Math.max(0, range.index));
  const found = leaf?.domNode?.closest?.('td,th');
  return found && s.quill.root.contains(found) ? found : s.activeTableCell || null;
}

function selectedTableCells(s, table = null) {
  return [...s.quill.root.querySelectorAll('[data-rtq-selected-cell]')]
    .filter(cell => !table || cell.closest('table') === table);
}

function clearTableSelection(s) {
  s.quill.root.querySelectorAll('[data-rtq-selected-cell]').forEach(cell => cell.removeAttribute('data-rtq-selected-cell'));
}

function selectTableRectangle(s, startCell, endCell = startCell) {
  const table = startCell?.closest('table');
  if (!table || endCell?.closest('table') !== table) return [];
  const rowStart = Math.min(startCell.parentElement.rowIndex, endCell.parentElement.rowIndex);
  const rowEnd = Math.max(startCell.parentElement.rowIndex, endCell.parentElement.rowIndex);
  const colStart = Math.min(startCell.cellIndex, endCell.cellIndex);
  const colEnd = Math.max(startCell.cellIndex, endCell.cellIndex);
  clearTableSelection(s);
  const selected = [];
  [...table.rows].forEach((row, rowIndex) => {
    if (rowIndex < rowStart || rowIndex > rowEnd) return;
    [...row.cells].forEach((cell, colIndex) => {
      if (colIndex < colStart || colIndex > colEnd) return;
      cell.setAttribute('data-rtq-selected-cell', 'true');
      selected.push(cell);
    });
  });
  s.activeTableCell = startCell;
  s.quill.root.focus({ preventScroll: true });
  return selected;
}

function selectTableArea(s, mode) {
  const cell = s.activeTableCell || tableCellFromRange(s);
  const table = cell?.closest('table');
  if (!table) return false;
  if (mode === 'row') {
    const row = cell.parentElement;
    selectTableRectangle(s, row.cells[0], row.cells[row.cells.length - 1]);
  } else if (mode === 'column') {
    const lastRow = table.rows[table.rows.length - 1];
    selectTableRectangle(s, table.rows[0].cells[Math.min(cell.cellIndex, table.rows[0].cells.length - 1)], lastRow.cells[Math.min(cell.cellIndex, lastRow.cells.length - 1)]);
  } else {
    const lastRow = table.rows[table.rows.length - 1];
    selectTableRectangle(s, table.rows[0].cells[0], lastRow.cells[lastRow.cells.length - 1]);
  }
  return true;
}

function tableCellRange(s, cell) {
  const Quill = window.Quill;
  const blot = Quill?.find?.(cell);
  if (!blot) return null;
  const index = s.quill.getIndex(blot);
  return { index, length: Math.max(1, blot.length() - 1) };
}

function formatSelectedTableCells(s, name, value) {
  const cells = selectedTableCells(s);
  if (!cells.length) return false;
  const ranges = cells.map(cell => tableCellRange(s, cell)).filter(Boolean);
  if (!ranges.length) return false;
  const next = value === undefined
    ? !ranges.every(range => !!s.quill.getFormat(range)[name])
    : value;
  ranges.forEach(range => s.quill.formatText(range.index, range.length, name, next || false, 'user'));
  cells.forEach(cell => cell.isConnected && cell.setAttribute('data-rtq-selected-cell', 'true'));
  markDirty(s);
  return true;
}

function tableSelectionMatrix(s) {
  const cells = selectedTableCells(s);
  if (!cells.length) return null;
  const table = cells[0].closest('table');
  const sameTable = cells.filter(cell => cell.closest('table') === table);
  const rows = sameTable.map(cell => cell.parentElement.rowIndex);
  const cols = sameTable.map(cell => cell.cellIndex);
  const rowStart = Math.min(...rows), rowEnd = Math.max(...rows);
  const colStart = Math.min(...cols), colEnd = Math.max(...cols);
  const selected = new Set(sameTable);
  return Array.from({ length: rowEnd - rowStart + 1 }, (_, rowOffset) =>
    Array.from({ length: colEnd - colStart + 1 }, (_, colOffset) => {
      const cell = table.rows[rowStart + rowOffset]?.cells[colStart + colOffset];
      return cell && selected.has(cell) ? cell : null;
    }));
}

function copyTableSelection(s, event, cut = false) {
  const matrix = tableSelectionMatrix(s);
  if (!matrix || !event.clipboardData) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  event.clipboardData.setData('text/plain', matrix.map(row => row.map(cell => cell?.innerText?.trim() || '').join('\t')).join('\n'));
  event.clipboardData.setData('text/html', `<table>${matrix.map(row => `<tr>${row.map(cell => `<td>${cell?.innerHTML || ''}</td>`).join('')}</tr>`).join('')}</table>`);
  if (cut) {
    matrix.flat().filter(Boolean)
      .map(cell => tableCellRange(s, cell)).filter(Boolean)
      .sort((a, b) => b.index - a.index)
      .forEach(range => s.quill.deleteText(range.index, range.length, 'user'));
    markDirty(s);
  }
  return true;
}

function clipboardTableMatrix(event) {
  const html = event.clipboardData?.getData('text/html') || '';
  if (html && /<table[\s>]/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    const rows = table ? [...table.rows].map(row => [...row.cells].map(cell => cell.innerHTML)) : [];
    if (rows.length) return rows;
  }
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!/[\t\r\n]/.test(text)) return null;
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(row => row.split('\t').map(value => `<p>${_esc(value) || '<br>'}</p>`));
}

function ensureTableSpace(s, table, rowCount, colCount) {
  const module = s.quill.getModule('table');
  if (!module) return table;
  while (table.rows.length < rowCount) {
    const lastCell = table.rows[table.rows.length - 1]?.cells[0];
    const range = tableCellRange(s, lastCell);
    if (!range || !module.insertRowBelow) break;
    s.quill.setSelection(range.index, 0, 'silent');
    module.insertRowBelow();
  }
  while (Math.max(...[...table.rows].map(row => row.cells.length)) < colCount) {
    const firstRow = table.rows[0];
    const lastCell = firstRow?.cells[firstRow.cells.length - 1];
    const range = tableCellRange(s, lastCell);
    if (!range || !module.insertColumnRight) break;
    s.quill.setSelection(range.index, 0, 'silent');
    module.insertColumnRight();
  }
  return table;
}

function tableCellText(html) {
  const doc = new DOMParser().parseFromString(sanitizeRichTextHtml(html || ''), 'text/html');
  doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  return (doc.body.textContent || '').replace(/\s*\n\s*/g, ' ').trim();
}

function pasteTableMatrix(s, event) {
  const matrix = clipboardTableMatrix(event);
  const active = event.target?.closest?.('td,th') || tableCellFromRange(s);
  const table = active?.closest('table');
  if (!matrix || !table || !matrix.length) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const startRow = active.parentElement.rowIndex;
  const startCol = active.cellIndex;
  ensureTableSpace(s, table, startRow + matrix.length, startCol + Math.max(...matrix.map(row => row.length)));
  const replacements = [];
  matrix.forEach((row, rowOffset) => row.forEach((html, colOffset) => {
    const cell = table.rows[startRow + rowOffset]?.cells[startCol + colOffset];
    const range = cell && tableCellRange(s, cell);
    if (range) replacements.push({ ...range, text: tableCellText(html) });
  }));
  replacements.sort((a, b) => b.index - a.index).forEach(({ index, length, text }) => {
    if (length) s.quill.deleteText(index, length, 'user');
    if (text) s.quill.insertText(index, text, 'user');
  });
  const endRow = table.rows[Math.min(table.rows.length - 1, startRow + matrix.length - 1)];
  const endCell = endRow?.cells[Math.min(endRow.cells.length - 1, startCol + Math.max(...matrix.map(row => row.length)) - 1)];
  if (endCell) selectTableRectangle(s, table.rows[startRow].cells[startCol], endCell);
  markDirty(s);
  return true;
}

function updateContext(s, target) {
  const tools = s.wrap.querySelector('[data-rtq-table-tools]'), imageTools = s.wrap.querySelector('[data-rtq-image-tools]'), image = target?.closest?.('img');
  if (image) { s.activeImage = image; s.activeTableCell = null; tools.hidden = true; position(imageTools, image, s.wrap); return; }
  imageTools.hidden = true; s.activeImage = null;
  const cell = target?.closest?.('td,th');
  if (cell) { s.activeTableCell = cell; position(tools, cell, s.wrap); }
  else { s.activeTableCell = null; tools.hidden = true; }
}

function handleAction(s, action, anchor) { const q = s.quill; if (action === 'undo') q.history.undo(); else if (action === 'redo') q.history.redo(); else if (action === 'find') openFind(s); else if (action === 'focus') toggleFocus(s); else if (action === 'link') openLink(s, anchor); else if (action === 'clean') { const r = rangeOf(s); q.removeFormat(r.index, r.length || 1, 'user'); closePops(s); } else if (action === 'image') s.wrap.querySelector('[data-rtq-file]').click(); else if (action === 'dice') openDice(s, anchor); else if (action === 'mention') { s.mentionQuery = null; s.mentionKind = ''; showMention(s); } }

function bindUi(s) {
  const { wrap, quill: q } = s;
  const stopTableDrag = () => {
    wrap.classList.remove('is-table-selecting');
    s.tableDrag = null;
  };
  wrap.addEventListener('click', e => {
    const builtin = e.target.closest('.ql-bold,.ql-underline,.ql-strike,.ql-list');
    if (!builtin) return;
    const inTable = !!(s.activeTableCell || tableCellFromRange(s));
    if (builtin.classList.contains('ql-list') && inTable) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      showNotif('Les listes ne peuvent pas être appliquées dans une cellule de tableau.', 'info');
      return;
    }
    const cells = selectedTableCells(s);
    if (!cells.length) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const name = builtin.classList.contains('ql-bold') ? 'bold' : builtin.classList.contains('ql-underline') ? 'underline' : 'strike';
    formatSelectedTableCells(s, name);
  }, true);
  wrap.addEventListener('mousedown', e => { if (e.target.closest('.rtq-toolbar,.rtq-pop,.rtq-bubble,.rtq-context,.rtq-footer,.rtq-find') && !e.target.closest('input,label')) { e.preventDefault(); s.lastRange = q.getSelection() || s.lastRange; } });
  wrap.addEventListener('click', e => {
    const t = e.target, menu = t.closest('[data-rtq-menu]'); if (menu) return openMenu(s, menu.dataset.rtqMenu, menu);
    const action = t.closest('[data-rtq-action]'); if (action) return handleAction(s, action.dataset.rtqAction, action);
    const command = t.closest('[data-rtq-command]'); if (command) {
      const r = rangeOf(s), name = command.dataset.rtqCommand;
      if ((name === 'ordered' || name === 'check') && (s.activeTableCell || tableCellFromRange(s))) {
        showNotif('Les listes ne peuvent pas être appliquées dans une cellule de tableau.', 'info');
        closePops(s); return;
      }
      if (formatSelectedTableCells(s, name)) { closePops(s); return; }
      if (name === 'ordered' || name === 'check') q.formatLine(r.index, Math.max(1, r.length), 'list', name, 'user');
      else q.formatText(r.index, r.length || 1, name, !q.getFormat(r)[name], 'user');
      closePops(s); return;
    }
    const line = t.closest('[data-rtq-line]'); if (line) { lineFormat(s, line.dataset.rtqLine); closePops(s); return; }
    const color = t.closest('[data-rtq-color]'); if (color) { if (formatSelectedTableCells(s, 'color', color.dataset.rtqColor || false)) return; const r = rangeOf(s); q.formatText(r.index, r.length || 1, 'color', color.dataset.rtqColor || false, 'user'); return; }
    const bg = t.closest('[data-rtq-background]'); if (bg) { if (formatSelectedTableCells(s, 'background', bg.dataset.rtqBackground || false)) return; const r = rangeOf(s); q.formatText(r.index, r.length || 1, 'background', bg.dataset.rtqBackground || false, 'user'); return; }
    const size = t.closest('[data-rtq-size]'); if (size) { if (formatSelectedTableCells(s, 'rt-size', size.dataset.rtqSize || false)) return; const r = rangeOf(s); q.formatText(r.index, r.length || 1, 'rt-size', size.dataset.rtqSize || false, 'user'); return; }
    const script = t.closest('[data-rtq-script]'); if (script) { if (formatSelectedTableCells(s, 'script', script.dataset.rtqScript)) return; const r = rangeOf(s); q.formatText(r.index, r.length || 1, 'script', script.dataset.rtqScript, 'user'); return; }
    if (t.closest('[data-rtq-code]')) { if (formatSelectedTableCells(s, 'code', true)) return; const r = rangeOf(s); q.formatText(r.index, r.length || 1, 'code', true, 'user'); return; }
    const align = t.closest('[data-rtq-align]'); if (align) { const r = rangeOf(s); q.formatLine(r.index, Math.max(1, r.length), 'align', align.dataset.rtqAlign || false, 'user'); return; }
    const indent = t.closest('[data-rtq-indent]'); if (indent) { const r = rangeOf(s), current = Number(q.getFormat(r).indent || 0); q.formatLine(r.index, 1, 'indent', Math.max(0, current + Number(indent.dataset.rtqIndent)), 'user'); return; }
    const callout = t.closest('[data-rtq-callout]'); if (callout) { runInsert(s, `callout:${callout.dataset.rtqCallout}`); closePops(s); return; }
    const insert = t.closest('[data-rtq-insert]'); if (insert) { runInsert(s, insert.dataset.rtqInsert); closePops(s); return; }
    const tableSize = t.closest('[data-rtq-table-size]'); if (tableSize) {
      const [rows, cols] = tableSize.dataset.rtqTableSize.split('x').map(Number);
      const withHeader = !!wrap.querySelector('[data-rtq-table-head]')?.checked;
      const tableModule = q.getModule('table');
      if (tableModule?.insertTable) {
        tableModule.insertTable(rows, cols);
        if (withHeader) requestAnimationFrame(() => {
          const current = q.getSelection();
          const [leaf] = q.getLeaf(Math.max(0, (current?.index || 1) - 1));
          const tables = q.root.querySelectorAll('table');
          const created = leaf?.domNode?.closest?.('table') || tables[tables.length - 1];
          created?.classList.add('rt-table--header');
          markDirty(s);
        });
      } else showNotif('Tableaux indisponibles dans cet éditeur', 'info');
      closePops(s); return;
    }
    const slash = t.closest('[data-rtq-slash-index]'); if (slash) return runSlash(s, Number(slash.dataset.rtqSlashIndex));
    const mentionKind = t.closest('[data-rtq-mention-kind]');
    if (mentionKind) { s.mentionKind = mentionKind.dataset.rtqMentionKind || ''; renderMention(s, s.mentionQuery || ''); return; }
    const mention = t.closest('[data-rtq-mention-index]'); if (mention) return insertMention(s, Number(mention.dataset.rtqMentionIndex));
    if (t.closest('[data-rtq-link-apply]')) return applyLink(s);
    if (t.closest('[data-rtq-link-remove]')) { const r = rangeOf(s); q.formatText(r.index, r.length || 1, 'link', false, 'user'); closePops(s); return; }
    if (t.closest('[data-rtq-dice-apply]')) return insertDice(s);
    if (t.closest('[data-rtq-find-prev]')) return doFind(s, -1); if (t.closest('[data-rtq-find-next]')) return doFind(s, 1);
    if (t.closest('[data-rtq-find-case]')) { s.findCase = !s.findCase; t.closest('[data-rtq-find-case]').classList.toggle('is-active', s.findCase); return doFind(s); }
    if (t.closest('[data-rtq-replace-all]')) return replaceFound(s, true); if (t.closest('[data-rtq-replace]')) return replaceFound(s, false);
    if (t.closest('[data-rtq-find-close]')) { wrap.querySelector('[data-rtq-find]').hidden = true; q.focus(); return; }
    const tableSelect = t.closest('[data-rtq-table-select]'); if (tableSelect) { selectTableArea(s, tableSelect.dataset.rtqTableSelect); return; }
    const op = t.closest('[data-rtq-table-op]'); if (op) { clearTableSelection(s); q.getModule('table')?.[op.dataset.rtqTableOp]?.(); markDirty(s); return; }
    const imageSize = t.closest('[data-rtq-image-size]'); if (imageSize && s.activeImage) { s.activeImage.classList.remove('rt-img-s', 'rt-img-m', 'rt-img-l'); s.activeImage.classList.add(`rt-img-${imageSize.dataset.rtqImageSize}`); q.update('user'); return; }
    const imageAlign = t.closest('[data-rtq-image-align]'); if (imageAlign && s.activeImage) { s.activeImage.dataset.align = imageAlign.dataset.rtqImageAlign; q.update('user'); return; }
    if (t.closest('[data-rtq-image-alt]') && s.activeImage) { const alt = prompt('Texte alternatif', s.activeImage.alt || ''); if (alt != null) { s.activeImage.alt = alt; q.update('user'); } return; }
    if (t.closest('[data-rtq-image-delete]') && s.activeImage) { s.activeImage.remove(); q.update('user'); updateContext(s); return; }
    const dice = t.closest('.rt-dice'); if (dice) { document.dispatchEvent(new CustomEvent('app:rich-text-dice', { detail: { formula: dice.dataset.dice, source: 'rich-text' } })); return; }
    if (t.closest('.ql-editor')) { if (!t.closest('td,th')) clearTableSelection(s); closePops(s); updateContext(s, t); }
  });
  wrap.querySelector('[data-rtq-file]').addEventListener('change', e => { const file = e.target.files?.[0]; if (file) uploadImage(s, file); e.target.value = ''; });
  wrap.querySelector('[data-rtq-find-input]').addEventListener('input', () => doFind(s));
  wrap.querySelector('[data-rtq-pop="table"]').addEventListener('pointerover', e => { const cell = e.target.closest('[data-rtq-table-size]'); if (!cell) return; const [rows, cols] = cell.dataset.rtqTableSize.split('x').map(Number); wrap.querySelectorAll('[data-rtq-table-size]').forEach(x => { const [r, c] = x.dataset.rtqTableSize.split('x').map(Number); x.classList.toggle('is-hover', r <= rows && c <= cols); }); wrap.querySelector('.rtq-table-caption').textContent = `${cols} col. × ${rows} lignes`; });
  q.root.addEventListener('pointerdown', e => {
    const cell = e.target.closest('td,th');
    if (!cell) return;
    if (e.shiftKey && s.activeTableCell?.closest('table') === cell.closest('table')) {
      e.preventDefault();
      selectTableRectangle(s, s.activeTableCell, cell);
      updateContext(s, cell);
      return;
    }
    if (!cell.hasAttribute('data-rtq-selected-cell')) clearTableSelection(s);
    s.activeTableCell = cell;
  });
  q.root.addEventListener('mousedown', e => {
    const cell = e.target.closest('td,th');
    if (!cell || e.button !== 0 || e.shiftKey) return;
    s.tableDrag = { startCell: cell, lastCell: cell, active: false };
    window.addEventListener('mouseup', stopTableDrag, { once: true });
  });
  q.root.addEventListener('mousemove', e => {
    const drag = s.tableDrag;
    if (!drag || !(e.buttons & 1)) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('td,th');
    if (!cell || cell === drag.lastCell || cell.closest('table') !== drag.startCell.closest('table')) return;
    e.preventDefault();
    drag.active = true;
    drag.lastCell = cell;
    wrap.classList.add('is-table-selecting');
    document.getSelection()?.removeAllRanges();
    selectTableRectangle(s, drag.startCell, cell);
    updateContext(s, cell);
  });
  q.root.addEventListener('mouseleave', e => { if (!e.buttons) stopTableDrag(); });
  q.root.addEventListener('copy', e => copyTableSelection(s, e), true);
  q.root.addEventListener('cut', e => copyTableSelection(s, e, true), true);
  q.root.addEventListener('paste', e => pasteTableMatrix(s, e), true);
  q.root.addEventListener('keydown', e => {
    const cells = selectedTableCells(s);
    if (!cells.length || !['Backspace', 'Delete'].includes(e.key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    cells.forEach(cell => { cell.innerHTML = '<p><br></p>'; cell.setAttribute('data-rtq-selected-cell', 'true'); });
    q.update('user'); markDirty(s);
  }, true);
}

function linePrefix(s) { const range = s.quill.getSelection(); if (!range) return null; const [line] = s.quill.getLine(range.index); if (!line) return null; const start = s.quill.getIndex(line); return { range, start, text: s.quill.getText(start, range.index - start) }; }
function bindKeys(s) {
  const q = s.quill;
  q.root.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey; if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(s); return; } if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink(s, q.root); return; } if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocus(s); return; } if (e.key === 'Escape') { if (s.wrap.classList.contains('is-focus')) toggleFocus(s); else closePops(s); return; }
    const p = linePrefix(s); if (!p) return;
    const shortcuts = { '#': ['header', 2], '##': ['header', 3], '-': ['list', 'bullet'], '1.': ['list', 'ordered'], '[]': ['list', 'check'], '[ ]': ['list', 'check'], '>': ['blockquote', true] };
    if (e.key === ' ' && shortcuts[p.text]) { const [name, value] = shortcuts[p.text]; if (name === 'list' && tableCellFromRange(s)) return; e.preventDefault(); q.deleteText(p.start, p.text.length, 'user'); q.formatLine(p.start, 1, name, value, 'user'); }
    if (e.key === 'Enter' && p.text === '---') { e.preventDefault(); q.deleteText(p.start, 3, 'user'); q.insertEmbed(p.start, 'divider', true, 'user'); q.insertText(p.start + 1, '\n', 'user'); q.setSelection(p.start + 2, 0, 'silent'); }
    if (e.key === 'Enter' && p.text.startsWith('/')) { const first = s.wrap.querySelector('[data-rtq-slash-index]'); if (first && !first.closest('[hidden]')) { e.preventDefault(); runSlash(s, Number(first.dataset.rtqSlashIndex)); } }
    if (e.key === 'Enter' && /@[^\s@]*$/.test(p.text)) { const first = s.wrap.querySelector('[data-rtq-mention-index]'); if (first && !first.closest('[hidden]')) { e.preventDefault(); insertMention(s, Number(first.dataset.rtqMentionIndex)); } }
  });
  q.root.addEventListener('keyup', e => {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return; const p = linePrefix(s); if (!p) return;
    const slash = p.text.match(/^\/([\p{L}\d-]{0,24})$/u), mention = p.text.match(/@([^\s@]{0,32})$/u), dice = p.text.match(/\[([^\]]+)\]$/);
    if (dice && DICE_RE.test(dice[1].replace(/\s/g, ''))) { const f = dice[1].replace(/\s/g, ''), start = p.range.index - dice[0].length; q.deleteText(start, dice[0].length, 'user'); q.insertEmbed(start, 'dice', f, 'user'); q.insertText(start + 1, ' ', 'user'); q.setSelection(start + 2, 0, 'silent'); closePops(s); return; }
    if (slash) showSlash(s, slash[1]); else if (mention) showMention(s, mention[1]); else ['slash', 'mention'].forEach(name => { const pop = s.wrap.querySelector(`[data-rtq-pop="${name}"]`); if (pop) pop.hidden = true; });
  });
  q.root.addEventListener('paste', e => { const url = e.clipboardData?.getData('text/plain')?.trim(), r = q.getSelection(); if (r?.length && /^https?:\/\/\S+$/i.test(url || '')) { e.preventDefault(); q.formatText(r.index, r.length, 'link', url, 'user'); } });
}

export async function bindQuillEditors(root = document, { onUserEdit } = {}) {
  const editors = [...(root.querySelectorAll?.('.rtq[data-rtq-id]') || [])].filter(el => !el.classList.contains('rtq-bound') && !el.classList.contains('ql-container'));
  if (!editors.length) return; await loadQuill(); const Quill = window.Quill; registerFormats(Quill);
  for (const el of editors) {
    if (el.classList.contains('rtq-bound') || el.classList.contains('ql-container')) continue; el.classList.add('rtq-bound');
    const wrap = el.closest('.rtq-wrap'), id = el.dataset.rtqId;
    const headerTableIndexes = [...el.querySelectorAll('table')].map((table, index) => table.classList.contains('rt-table--header') ? index : -1).filter(index => index >= 0);
    const q = new Quill(el, { theme: 'snow', placeholder: el.dataset.rtqPlaceholder || '', modules: { toolbar: wrap.querySelector('.rtq-toolbar'), history: { delay: 700, maxStack: 150, userOnly: true }, table: true, uploader: { mimetypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] } } });
    const mountedTables = q.root.querySelectorAll('table');
    headerTableIndexes.forEach(index => mountedTables[index]?.classList.add('rt-table--header'));
    const s = { id, quill: q, wrap, lastRange: { index: 0, length: 0 }, findIndex: 0, findMatches: [] }; _instances.set(id, q); _states.set(q, s);
    const uploader = q.getModule('uploader'); if (uploader) uploader.upload = STATE.isAdmin ? (r, files) => [...files].forEach(file => uploadImage(s, file, r)) : () => {};
    q.on('selection-change', r => selectionUi(s, r)); q.on('text-change', (_d, _o, source) => { if (source !== 'user') return; markDirty(s); try { onUserEdit?.(id, q); } catch (e) { console.error('[quill] onUserEdit', e); } });
    bindUi(s); bindKeys(s); updateCount(s);
  }
  ensureGuard();
}

export function markQuillSaved(id) { const wrap = _instances.get(id)?.root?.closest('.rtq-wrap'); if (!wrap) return; wrap.removeAttribute('data-quill-dirty'); const status = wrap.querySelector('[data-rtq-status]'); if (status) status.textContent = 'Enregistré à l’instant'; }
function ensureGuard() { if (_guardBound || typeof window === 'undefined') return; _guardBound = true; window.addEventListener('beforeunload', e => { if (!document.querySelector('[data-quill-dirty="true"]')) return; e.preventDefault(); e.returnValue = ''; }); }

function normalizeHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html'), root = doc.body.firstChild;
    root.querySelectorAll('[data-rtq-selected-cell]').forEach(cell => cell.removeAttribute('data-rtq-selected-cell'));
    root.querySelectorAll('table.rt-table--header').forEach(table => {
      const body = table.querySelector('tbody');
      const firstRow = body?.querySelector(':scope > tr');
      if (!firstRow) return;
      const head = doc.createElement('thead');
      [...firstRow.children].forEach(cell => {
        const th = doc.createElement('th');
        th.innerHTML = cell.innerHTML;
        [...cell.attributes].forEach(attr => th.setAttribute(attr.name, attr.value));
        cell.replaceWith(th);
      });
      head.appendChild(firstRow);
      table.insertBefore(head, body);
      table.classList.remove('rt-table--header');
    });
    root.querySelectorAll('ol').forEach(list => { const items = [...list.children], values = items.map(li => li.getAttribute('data-list')); if (!items.length) return; if (values.every(v => v === 'bullet')) { const ul = doc.createElement('ul'); items.forEach(li => { li.removeAttribute('data-list'); ul.appendChild(li); }); list.replaceWith(ul); } else if (values.every(v => v === 'checked' || v === 'unchecked')) { const ul = doc.createElement('ul'); ul.className = 'rt-check'; items.forEach(li => { if (li.getAttribute('data-list') === 'checked') li.dataset.checked = 'true'; li.removeAttribute('data-list'); ul.appendChild(li); }); list.replaceWith(ul); } else items.forEach(li => li.removeAttribute('data-list')); });
    root.querySelectorAll('[class]').forEach(node => { [...node.classList].forEach(cls => { if (cls.startsWith('ql-align-')) { node.style.textAlign = cls.slice(9); node.classList.remove(cls); } else if (cls.startsWith('ql-indent-')) { node.style.marginLeft = `${Number(cls.slice(10)) * 1.5}rem`; node.classList.remove(cls); } else if (cls.startsWith('ql-')) node.classList.remove(cls); }); if (!node.className) node.removeAttribute('class'); });
    return root.innerHTML;
  } catch { return html; }
}
export function getQuillHtml(id) { const q = _instances.get(id); if (!q) return ''; const html = q.root.innerHTML; if (['<p><br></p>', '<p></p>', '<br>'].includes(html)) return ''; const normalized = normalizeHtml(html); try { return sanitizeRichTextHtml(normalized); } catch { return normalized; } }
