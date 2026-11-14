import { STATE } from '../../core/state.js';
import { registerActions } from '../../core/actions.js';
import { compressDataUrl, readImageFileAsDataUrl, uploadJpeg } from '../../shared/image-upload.js';
import { attachPanZoomCrop, panZoomCropHTML } from '../../shared/image-crop.js';
import { showNotif } from '../../shared/notifications.js';
import { loadCollectionStore, markVisited, persistStore, snapshotStore } from './data.js';

let _initialized = false;
let _savedSnapshot = { shelves: [], backs: [], items: [] };
let _saveTimer = null;
let _saveBusy = Promise.resolve();

function queueStoreSave() {
  if (!STATE.isAdmin) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveBusy = _saveBusy.then(async () => {
      try {
        _savedSnapshot = await persistStore(D, _savedSnapshot);
      } catch (error) {
        console.error('[collection] persistence', error);
        showNotif('La collection n’a pas pu être enregistrée.', 'error');
      }
    });
  }, 450);
}

/* COLLECTION — refonte · cœur : état, utilitaires, rendu partagé, bandeau, onglets, lightbox, toasts, clavier */
const LS = () => `lgjdr:collection-ui:${STATE.adventure?.id || 'none'}`;
const D = { backs: [], shelves: [], items: [], lastVisit: '' };
const S = Object.assign({ view: 'mj', shelf: 'destin', size: 'm', closed: {} },
  (() => { try { return JSON.parse(localStorage.getItem(LS()) || '{}'); } catch (e) { return {}; } })(),
  { sel: [], anchor: null, q: '', flt: 'all', xp: null, drawer: null, dosPick: null, flip: {}, modal: null });
const persist = () => { try { localStorage.setItem(LS(), JSON.stringify({ view: S.view, shelf: S.shelf, size: S.size, closed: S.closed })); } catch (e) {} };
const A = {}, IN = {}, CH = {};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const uid = () => Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch (e) { return d; } };
const ROMAN = 'I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII XXIII XXIV XXV XXVI XXVII XXVIII XXIX XXX XXXI XXXII XXXIII XXXIV XXXV XXXVI'.split(' ');
const roman = n => ROMAN[n - 1] || String(n);

const IC = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  chev: '<path d="m6 9 6 6 6-6"/>', chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>', up: '<path d="m18 15-6-6-6 6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  sparkle: '<path d="m12 3 1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="m18.5 15.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  cards: '<rect x="3" y="6" width="12" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  scroll: '<path d="M8 21h11a2 2 0 0 0 2-2v-1H10v1a2 2 0 0 1-4 0V5a2 2 0 0 0-2-2h13a2 2 0 0 1 2 2v13"/><path d="M10 7h6M10 11h6"/>',
  puzzle: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ── modèles ─────────────────────────────────────────────── */
const MODELS = {
  carte: { l: 'Cartes', d: 'Recto et dos, se retournent d’un clic.', u: ['carte', 'cartes'], f: true, ic: 'cards', emo: '🃏' },
  objet: { l: 'Objets', d: 'Reliques, trophées, butins, en vitrine.', u: ['objet', 'objets'], f: false, ic: 'trophy', emo: '🏆' },
  document: { l: 'Documents', d: 'Lettres, pages, avis : le texte d’abord.', u: ['document', 'documents'], f: false, ic: 'scroll', emo: '📜' },
  image: { l: 'Images', d: 'Illustrations, souvenirs, lieux visités.', u: ['image', 'images'], f: true, ic: 'image', emo: '🖼️' },
  fragments: { l: 'Fragments', d: 'Une image découpée, à reconstituer.', u: ['fragment', 'fragments'], f: false, ic: 'puzzle', emo: '🧩' },
};
const fem = sh => MODELS[sh.modele].f;
const unit = (sh, n = 1) => MODELS[sh.modele].u[n > 1 ? 1 : 0];
const agr = (sh, w, n = 1) => w + (fem(sh) ? 'e' : '') + (n > 1 ? 's' : '');
const nouv = (sh, n = 1) => fem(sh) ? (n > 1 ? 'nouvelles' : 'nouvelle') : (n > 1 ? 'nouveaux' : 'nouveau');
const ETW = { cache: 'Caché', pret: 'Prêt', revele: 'Révélé' };
const etatL = (sh, e, n = 1) => agr(sh, ETW[e], n);
const ST = { cache: 'hid', pret: 'rdy', revele: 'rev' };
const RATIO = { '2:3': ['r23', 2 / 3], '3:4': ['r34', .75], '1:1': ['r11', 1], '4:3': ['r43', 4 / 3], '16:9': ['r169', 16 / 9] };
const rc = sh => ({ carte: 'r57', objet: 'r11', document: 'r34' })[sh.modele] || (sh.modele === 'image' ? (RATIO[sh.ratio] || RATIO['3:4'])[0] : '');
const pieceRatio = sh => sh.frag ? sh.frag.ratio * sh.frag.rows / sh.frag.cols : 1;
const arn = sh => ({ carte: 5 / 7, objet: 1, document: .75 })[sh.modele] || (sh.modele === 'image' ? (RATIO[sh.ratio] || RATIO['3:4'])[1] : pieceRatio(sh));

/* ── accès aux données ───────────────────────────────────── */
const shelf = (id = S.shelf) => D.shelves.find(s => s.id === id);
const item = id => D.items.find(i => i.id === id);
const back = id => id ? D.backs.find(b => b.id === id) : null;
const serieOf = (sh, id) => id ? sh.series.find(s => s.id === id) : null;
const itemsOf = sh => D.items.filter(i => i.shelf === sh.id).sort((a, b) => sh.modele === 'fragments' ? a.pos - b.pos : a.ordre - b.ordre);
const groupKey = (sh, it) => serieOf(sh, it.serie) ? it.serie : '';
const revCount = l => l.filter(i => i.etat === 'revele').length;
const isNew = it => it.etat === 'revele' && (it.fresh || (it.revealedAt && it.revealedAt > D.lastVisit));
function backUrl(sh, it) { if (it.dosUrl) return it.dosUrl; const s = serieOf(sh, it.serie); return back(it.dos)?.url || back(s?.dos)?.url || back(sh.dos)?.url || ''; }
function subOf(sh, it) { const f = sh.champs.find(c => c.id === sh.sousTitre); if (!f) return ''; const v = it.champs[f.id]; return v === '' || v == null ? '' : f.type === 'nombre' ? `${f.nom} ${v}` : String(v); }
function missing(sh, it) {
  const m = [];
  if (sh.modele === 'document') { if (!String(it.texte || '').trim()) m.push('Texte'); }
  else if (sh.modele !== 'fragments' && !it.front) m.push(sh.modele === 'carte' ? 'Recto' : 'Image');
  const f = sh.modele === 'carte' && sh.champs.find(c => c.vis === 'pj');
  if (f && !String(it.champs[f.id] ?? '').trim()) m.push(f.nom);
  return m;
}
function doneSet(sh) {
  const all = itemsOf(sh), out = new Set();
  sh.series.forEach(s => { const l = all.filter(i => i.serie === s.id); if (l.length && l.every(i => i.etat === 'revele')) out.add(s.id); });
  if (all.length && all.every(i => i.etat === 'revele')) out.add('__all');
  return out;
}
function newlyDone(sh, before) {
  const now = doneSet(sh), msg = [];
  now.forEach(id => { if (before.has(id)) return; if (id === '__all') msg.push(`Collection complète${sh.rec?.t ? ' : ' + sh.rec.t : ' !'}`); else { const s = serieOf(sh, id); msg.push(`Série « ${s.nom} » complète${s.rec?.t ? ' : ' + s.rec.t : ''}`); } });
  return msg.length ? ' ' + msg.join(' · ') : '';
}

/* ── rendu partagé d’un élément ──────────────────────────── */
function pieceStyle(sh, it) {
  if (it.front) return `background-image:url('${esc(it.front)}');background-size:cover;background-position:center`;
  const { cols, rows, url } = sh.frag, c = it.pos % cols, r = Math.floor(it.pos / cols);
  return `background-image:url('${esc(url)}');background-size:${cols * 100}% ${rows * 100}%;background-position:${cols > 1 ? c / (cols - 1) * 100 : 0}% ${rows > 1 ? r / (rows - 1) * 100 : 0}%`;
}
function artInner(sh, it, ctx = 'mj') {
  const m = sh.modele;
  if (ctx === 'pj' && it.etat !== 'revele') return hiddenInner(sh, it);
  if (m === 'document') { const s = subOf(sh, it); return `<div class="doc"><b>${esc(it.nom || 'Sans titre')}</b><p>${esc(it.texte || '')}</p>${s ? `<i>— ${esc(s)}</i>` : ''}</div>`; }
  if (m === 'fragments') return sh.frag?.url ? `<div class="pcs" style="${pieceStyle(sh, it)}"></div>` : '';
  const img = it.front ? `<img src="${esc(it.front)}" alt="" loading="lazy" draggable="false">`
    : ctx === 'mj' ? `<div class="ph ph-miss">${ic('image')}<span>${m === 'carte' ? 'Recto' : 'Image'}</span></div>` : `<div class="ph ph-name">${esc(it.nom)}</div>`;
  if (m === 'image') return `<div class="pic">${img}</div>${ctx !== 'mj' ? `<div class="cap">${esc(it.nom)}</div>` : ''}`;
  return img;
}
function hiddenInner(sh, it) {
  const u = backUrl(sh, it), m = sh.modele;
  if (m === 'image') return `<div class="pic">${u ? `<img src="${esc(u)}" alt="" draggable="false">` : '<div class="ph ph-q">?</div>'}</div><div class="cap">???</div>`;
  if (u) return `<img src="${esc(u)}" alt="" draggable="false">`;
  if (m === 'document') return `<div class="env"><span class="seal">${esc(sh.emoji || '✉')}</span></div>`;
  return '<div class="ph ph-q">?</div>';
}
const artBox = (sh, it, ctx, cls = '') => `<div class="art ${rc(sh)} m-${sh.modele} ${cls}"${sh.modele === 'fragments' ? ` style="aspect-ratio:${pieceRatio(sh)}"` : ''}>${artInner(sh, it, ctx)}</div>`;
function boardHTML(sh, all, ctx) {
  const f = sh.frag; if (!f?.url) return '';
  const cells = all.map(it => {
    if (ctx === 'pj') return it.etat === 'revele' ? `<div class="pc rev" style="${pieceStyle(sh, it)}">${isNew(it) ? `<span class="nb">${nouv(sh)}</span>` : ''}</div>` : `<div class="pc void"><span>${roman(it.pos + 1)}</span></div>`;
    const flag = it.etat === 'pret' ? `<span class="t-flag rdy">${ic('sparkle')}Prêt</span>` : it.etat === 'cache' ? `<span class="t-flag" title="Caché aux joueurs">${ic('eyeOff')}</span>` : '';
    return `<div class="pc ${ST[it.etat]} ${S.sel.includes(it.id) ? 'sel' : ''}" data-a="tile" data-id="${it.id}" style="${pieceStyle(sh, it)}">${flag}<span class="pc-l">${roman(it.pos + 1)}</span></div>`;
  }).join('');
  return `<div class="board ${ctx}" style="grid-template-columns:repeat(${f.cols},1fr);grid-template-rows:repeat(${f.rows},1fr);aspect-ratio:${f.ratio}">${cells}</div>`;
}

/* ── rendu global ────────────────────────────────────────── */
function render() {
  if (S.view !== 'mj') { const v = D.shelves.filter(s => s.visible && itemsOf(s).length); if (!v.some(s => s.id === S.shelf) && v[0]) S.shelf = v[0].id; }
  else if (!shelf()) S.shelf = D.shelves[0]?.id;
  renderTop(); renderShelves();
  if (S.view === 'mj') renderMJ(); else renderPJ();
  persist();
}
function renderTop() {
  const mj = S.view === 'mj';
  $('#brand-sub').textContent = mj ? `${D.shelves.length} collections · ${D.items.length} éléments` : 'Ce que le groupe a obtenu';
  $('#top-tools').innerHTML = STATE.isAdmin
    ? `${mj ? `<span class="saved" id="saved">${ic('check')} Enregistré</span>` : ''}<div class="segm" aria-label="Point de vue"><button class="${mj ? 'on' : ''}" data-a="view" data-v="mj">Vue MJ</button><button class="${!mj ? 'on' : ''}" data-a="view" data-v="pj">Aperçu joueur</button></div>`
    : '';
}
function renderShelves() {
  const mj = S.view === 'mj', list = mj ? D.shelves : D.shelves.filter(s => s.visible && itemsOf(s).length);
  $('#shelves').innerHTML = list.map(s => { const l = itemsOf(s); return `<button class="shf ${s.id === S.shelf ? 'on' : ''}" data-a="shelf" data-v="${s.id}" ${mj ? `draggable="true" data-shelf-drag="${s.id}"` : ''}><span class="shf-e">${esc(s.emoji)}</span><span class="shf-n">${esc(s.nom)}</span><span class="shf-c">${revCount(l)}/${l.length}</span>${mj && !s.visible ? `<span class="shf-h" title="Cachée aux joueurs">${ic('eyeOff')}</span>` : ''}</button>`; }).join('')
    + (mj ? `<button class="shf-add" data-a="new-shelf">${ic('plus')} Collection</button><span class="shf-tools"><button class="btn sm" data-a="settings">${ic('cog')} Réglages de la collection</button></span>` : '');
}
function keep(fn) {
  const a = document.activeElement, k = a?.dataset?.k; let s = null, e = null;
  try { s = a.selectionStart; e = a.selectionEnd; } catch (x) {}
  fn();
  if (!k) return;
  const n = document.querySelector(`[data-k="${CSS.escape(k)}"]`);
  if (n && n !== document.activeElement) { n.focus({ preventScroll: true }); try { if (s != null) n.setSelectionRange(s, e); } catch (x) {} }
}

/* ── toasts, enregistrement, annulation ──────────────────── */
let _sv;
function saved() { queueStoreSave(); const el = $('#saved'); if (!el) return; el.classList.add('on'); clearTimeout(_sv); _sv = setTimeout(() => el.classList.remove('on'), 1400); }
function toast(msg, undo) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>${ic('undo')} Annuler</button>` : ''}`;
  $('#toasts').appendChild(el); requestAnimationFrame(() => el.classList.add('on'));
  let done = false; const kill = () => { if (done) return; done = true; el.classList.remove('on'); setTimeout(() => el.remove(), 300); };
  if (undo) el.querySelector('button').onclick = () => { kill(); undo(); };
  setTimeout(kill, undo ? 7000 : 3400);
  const all = $$('#toasts .toast'); if (all.length > 3) all[0].remove();
}
const snap = () => structuredClone({ items: D.items, shelves: D.shelves, backs: D.backs });
const restore = s => { D.items = s.items; D.shelves = s.shelves; D.backs = s.backs; };
function act(fn, { undo = true } = {}) {
  const before = undo ? snap() : null, msg = fn();
  render(); if (S.drawer) renderDrawer(); saved();
  if (msg) toast(msg, before ? () => { restore(before); render(); if (S.drawer) renderDrawer(); saved(); toast('Annulé.'); } : null);
}

/* ── fichiers ────────────────────────────────────────────── */
let FT = null;
function pickFiles(target, multi = true) { FT = target; const f = $('#file'); f.multiple = multi; f.value = ''; f.click(); }
const nameFromFile = n => { const s = n.replace(/\.[a-z0-9]+$/i, '').replace(/^[\d\s._-]+(?=\D)/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : 'Sans nom'; };
async function cropCollectionFile(file, target) {
  const root = $('.collection-redesign'), dataUrl = await readImageFileAsDataUrl(file);
  if (!root || !dataUrl) return null;
  const sh = shelf();
  const ratio = target?.face === 'back' ? 5 / 7 : Math.max(.35, Math.min(2, arn(sh)));
  const viewW = ratio >= 1 ? 360 : Math.round(340 * ratio);
  const viewH = ratio >= 1 ? Math.round(360 / ratio) : 340;
  const outputW = ratio >= 1 ? 1100 : Math.round(1100 * ratio);
  const outputH = ratio >= 1 ? Math.round(1100 / ratio) : 1100;
  const host = document.createElement('div');
  host.className = 'coll-crop-host';
  host.innerHTML = `<div class="coll-crop-back"></div><div class="coll-crop-box" role="dialog" aria-modal="true" aria-label="Cadrer l’image"><div class="mhd"><h3>Cadrer l’image</h3><button class="xbtn" data-crop-cancel title="Annuler">${ic('x')}</button></div><div class="mbd">${panZoomCropHTML({ idPrefix: 'collection-crop', viewW, viewH })}<p class="hint">Glisse l’image pour la placer dans le cadre. La molette et le curseur règlent le zoom.</p><div class="mft"><button class="btn" data-crop-cancel>Annuler</button><button class="btn go" data-crop-confirm>Utiliser cette image</button></div></div></div>`;
  root.appendChild(host);
  const cropper = attachPanZoomCrop({
    idPrefix: 'collection-crop', dataUrl, viewW, viewH, outputW, outputH,
    constrainCover: true, initialFit: 'cover', jpegQuality: .8,
  });
  return new Promise(resolve => {
    const done = value => { cropper?.destroy(); host.remove(); resolve(value); };
    host.querySelectorAll('[data-crop-cancel],.coll-crop-back').forEach(button => button.addEventListener('click', () => done(null)));
    host.querySelector('[data-crop-confirm]')?.addEventListener('click', () => done(cropper?.getBase64() || null));
  });
}
const readFiles = async (files, target = null) => Promise.all(files.filter(file => /^image\//.test(file.type)).map(async file => {
  const cropped = target?.kind === 'face'
    ? await cropCollectionFile(file, target)
    : await uploadJpeg(file, { max: 1200, quality: target?.kind === 'frag' ? .76 : .8 });
  const maxBytes = target?.kind === 'frag' ? 600_000 : target?.face === 'back' ? 300_000 : 440_000;
  const url = cropped ? await compressDataUrl(cropped, {
    max: target?.kind === 'frag' ? 1200 : 1100,
    quality: target?.kind === 'frag' ? .74 : .76,
    maxBytes,
    minSide: 220,
  }) : '';
  return { url, nom: nameFromFile(file.name) };
})).then(list => list.filter(entry => entry.url));
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

/* ── lightbox (présenter / révéler) ──────────────────────── */
const LB = { ids: [], i: 0, side: 'front', mode: 'view', before: null, count: 0, board: false };
function lbOpen(ids, i = 0, mode = 'view') {
  if (!ids.length) return;
  Object.assign(LB, { ids, i: Math.max(0, i), side: 'front', mode, board: false, before: mode === 'reveal' ? snap() : null, count: 0 });
  $('#lb').classList.add('on'); lbRender();
}
function lbBoard() { Object.assign(LB, { ids: [], i: 0, mode: 'view', board: true, before: null, count: 0 }); $('#lb').classList.add('on'); lbRender(); }
function lbClose() {
  const n = LB.count, before = LB.before, sh = shelf();
  $('#lb').classList.remove('on'); $('#lb').innerHTML = ''; LB.ids = []; LB.board = false; LB.before = null; LB.count = 0;
  render();
  if (n && before) toast(`${n} ${unit(sh, n)} ${agr(sh, 'révélé', n)} au groupe.`, () => { restore(before); render(); toast('Annulé.'); });
}
function lbInfo(sh, it) {
  const shown = it.etat === 'revele', rev = LB.mode === 'reveal', ser = serieOf(sh, it.serie);
  const fields = shown ? sh.champs.filter(f => f.vis === 'pj').map(f => {
    const v = it.champs[f.id];
    if ((it.masques || []).includes(f.id)) return `<div class="lb-f"><small>${esc(f.nom)}</small><p class="masked">${ic('lock')} Gardé secret par le MJ pour l’instant.</p></div>`;
    return v === '' || v == null ? '' : `<div class="lb-f"><small>${esc(f.nom)}</small><p>${esc(v)}</p></div>`;
  }).join('') : '';
  const sides = shown && sh.modele === 'carte' ? `<div class="segm"><button class="${LB.side === 'front' ? 'on' : ''}" data-a="lb-side" data-v="front">Recto</button><button class="${LB.side === 'back' ? 'on' : ''}" data-a="lb-side" data-v="back">Dos</button></div>` : '';
  let foot = '';
  if (rev) foot = shown
    ? `<div class="lb-done">${ic('check')} ${agr(sh, 'Révélé')} au groupe</div>${LB.i < LB.ids.length - 1 ? `<button class="btn go lg" data-a="lb-nav" data-v="1">${agr(sh, 'Suivant')} <kbd>→</kbd></button>` : `<button class="btn lg" data-a="lb-close">Terminer</button>`}`
    : `<button class="btn go lg" data-a="lb-reveal">${ic('sparkle')} Révéler au groupe <kbd>Espace</kbd></button>`;
  return `<span class="kick">${esc(sh.emoji)} ${esc(ser ? ser.nom : sh.nom)}</span><h2>${shown ? esc(it.nom) : '???'}</h2>${sides}${shown ? fields : `<p class="lb-h">${rev ? 'Les joueurs ne voient encore que le dos.' : `Pas encore ${agr(sh, 'révélé')}.`}</p>`}${foot}`;
}
function lbRender() {
  const sh = shelf(), box = $('#lb');
  const close = `<div class="lb-back" data-a="lb-close"></div><button class="lb-x xbtn" data-a="lb-close" title="Fermer (Échap)">${ic('x')}</button>`;
  if (LB.board) {
    const all = itemsOf(sh), found = all.filter(i => i.etat === 'revele');
    box.innerHTML = `${close}<div class="lb-stage"><div class="lbc" style="--arn:${sh.frag.ratio}">${boardHTML(sh, all, 'pj')}</div><div class="lb-info"><span class="kick">${esc(sh.emoji)} Fragments</span><h2>${esc(sh.nom)}</h2><p class="lb-h">${found.length} / ${all.length} fragments retrouvés</p>${found.map(i => `<div class="lb-f"><small>${esc(i.nom)}</small><p>${esc(subOf(sh, i) || '—')}</p></div>`).join('')}</div></div>`;
    return;
  }
  const it = item(LB.ids[LB.i]); if (!it) return lbClose();
  const shown = it.etat === 'revele', m = sh.modele, rev = LB.mode === 'reveal', showBack = !shown || LB.side === 'back';
  const front = (shown || rev) ? artInner(sh, it, 'lb') : hiddenInner(sh, it), st = m === 'fragments' ? ` style="aspect-ratio:auto"` : '';
  box.innerHTML = `${close}${LB.ids.length > 1 ? `<button class="lb-nav prev" data-a="lb-nav" data-v="-1" ${LB.i ? '' : 'disabled'} aria-label="Précédent">${ic('chevL')}</button><button class="lb-nav next" data-a="lb-nav" data-v="1" ${LB.i < LB.ids.length - 1 ? '' : 'disabled'} aria-label="Suivant">${ic('chevR')}</button>` : ''}
    <div class="lb-stage"><div class="lbc ${m === 'carte' ? 'turn' : 'fade'} ${showBack ? 'flip' : ''}" style="--arn:${arn(sh)}"><div class="lbf lbf-f art m-${m}"${st}>${front}</div><div class="lbf lbf-b art m-${m}"${st}>${hiddenInner(sh, it)}</div></div><div class="lb-info" id="lb-info">${lbInfo(sh, it)}</div></div>
    <div class="lb-ft">${LB.ids.length > 1 ? `${LB.i + 1} / ${LB.ids.length} · ` : ''}<kbd>←</kbd> <kbd>→</kbd> parcourir · <kbd>Échap</kbd> fermer</div>`;
}
A['lb-close'] = () => lbClose();
A['lb-nav'] = t => { LB.i = Math.min(LB.ids.length - 1, Math.max(0, LB.i + Number(t.dataset.v))); LB.side = 'front'; lbRender(); };
A['lb-side'] = t => { LB.side = t.dataset.v; $('#lb .lbc')?.classList.toggle('flip', LB.side === 'back'); $('#lb-info').innerHTML = lbInfo(shelf(), item(LB.ids[LB.i])); };
A['lb-reveal'] = () => {
  const sh = shelf(), it = item(LB.ids[LB.i]); if (!it || it.etat === 'revele') return;
  const d0 = doneSet(sh);
  it.etat = 'revele'; it.revealedAt = today(); it.fresh = true; LB.count++; saved();
  $('#lb .lbc')?.classList.remove('flip'); $('#lb-info').innerHTML = lbInfo(sh, it);
  const extra = newlyDone(sh, d0); if (extra) toast(extra.trim());
};

/* ── actions génériques ──────────────────────────────────── */
A.view = t => { if (!STATE.isAdmin && t.dataset.v === 'mj') return; S.view = t.dataset.v; S.sel = []; S.xp = null; if (S.drawer) closeSettings(); render(); window.scrollTo(0, 0); };
A.shelf = t => { if (S.shelf === t.dataset.v) return; Object.assign(S, { shelf: t.dataset.v, sel: [], q: '', flt: 'all', xp: null, flip: {}, dosPick: null }); render(); if (S.drawer) renderDrawer(); };

registerActions({
  collectionDispatch: (_root, event) => {
    const target = event.target.closest?.('[data-a]');
    if (!target || target.disabled) return;
    A[target.dataset.a]?.(target, event);
  },
  collectionInput: (_root, event) => {
    const target = event.target.closest?.('[data-in]');
    if (target) IN[target.dataset.in]?.(target, event);
  },
  collectionChange: (_root, event) => {
    const target = event.target.closest?.('[data-ch]');
    if (target) CH[target.dataset.ch]?.(target, event);
    else if (event.target.closest?.('[data-in]')) saved();
  },
});
document.addEventListener('keydown', e => { if (!document.querySelector('.collection-redesign')) return;
  if ($('#lb').classList.contains('on')) {
    if (e.key === 'Escape') lbClose();
    else if (e.key === 'ArrowRight' && LB.i < LB.ids.length - 1) { LB.i++; LB.side = 'front'; lbRender(); }
    else if (e.key === 'ArrowLeft' && LB.i > 0) { LB.i--; LB.side = 'front'; lbRender(); }
    else if (e.key === ' ' && LB.mode === 'reveal') { e.preventDefault(); A['lb-reveal'](); }
    return;
  }
  if (e.key === 'Escape' && S.modal) { closeModal(); return; }
  if (e.key === 'Escape' && S.drawer && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { closeSettings(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape' && e.target.id !== 'xp-in') e.target.blur(); return; }
  if (S.drawer || S.modal) return;
  if (S.view === 'mj') mjKey(e);
});

function initRuntime() {
  document.addEventListener('change', async e => {
    if (e.target.id !== 'file' || !e.target.closest('.collection-redesign')) return;
    const t = FT; FT = null;
    const fl = await readFiles([...e.target.files], t);
    if (fl.length) onFiles(fl, t);
  });
  window.addEventListener('dragover', e => { if (document.querySelector('.collection-redesign') && hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => { if (document.querySelector('.collection-redesign') && hasFiles(e)) e.preventDefault(); });
  render();
}


/* COLLECTION — vue MJ : table lumineuse, réserve « à révéler », inspecteur, glisser-déposer, création express, import */
const filtering = () => !!S.q.trim() || S.flt !== 'all';
function visibleItems(sh) {
  const q = norm(S.q.trim());
  return itemsOf(sh).filter(it => {
    if (S.flt === 'miss') { if (!missing(sh, it).length) return false; }
    else if (S.flt !== 'all' && it.etat !== S.flt) return false;
    return !q || norm([it.nom, it.texte, ...Object.values(it.champs)].join(' ')).includes(q);
  });
}
function hl(s) {
  const q = S.q.trim(); if (!q) return esc(s);
  const i = norm(s).indexOf(norm(q)); if (i < 0) return esc(s);
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
}
const navIds = () => $$('#lt [data-a="tile"][data-id]').filter(el => !el.closest('.tray')).map(el => el.dataset.id);
const cur = () => S.sel.length === 1 ? item(S.sel[0]) : null;
const NEWL = { carte: 'Nom de la nouvelle carte', objet: 'Nom du nouvel objet', document: 'Titre du nouveau document', image: 'Titre de la nouvelle image' };

function renderMJ() {
  const main = $('#main');
  if (main.dataset.v !== 'mj') { main.dataset.v = 'mj'; main.innerHTML = '<div class="work"><section class="lt" id="lt" aria-label="Table lumineuse"></section><aside class="insp" id="insp" aria-label="Inspecteur"></aside></div>'; }
  S.sel = S.sel.filter(id => item(id)?.shelf === S.shelf);
  renderTable(); renderInsp();
}

/* ── table lumineuse ─────────────────────────────────────── */
function renderTable() {
  const sh = shelf(), lt = $('#lt'); if (!sh || !lt) return;
  keep(() => {
    lt.dataset.size = S.size;
    const all = itemsOf(sh);
    let h = barHTML(sh, all) + trayHTML(sh, all);
    if (sh.modele === 'fragments') h += sh.frag?.url ? `<div class="board-w">${boardHTML(sh, all, 'mj')}</div>` : emptyHTML(sh);
    else if (!all.length) h += emptyHTML(sh);
    else { const vis = visibleItems(sh); h += vis.length ? groupsOf(sh, vis).map(g => serHTML(sh, g, all)).join('') : `<div class="lt-none"><b>Aucun élément ne correspond.</b><button class="btn sm" data-a="flt-reset">Réinitialiser</button></div>`; }
    lt.innerHTML = h + footHTML(sh);
  });
}
function groupsOf(sh, vis) {
  if (!sh.series.length) return [{ s: null, items: vis }];
  const g = sh.series.map(s => ({ s, items: vis.filter(i => i.serie === s.id) }));
  const rest = vis.filter(i => !serieOf(sh, i.serie));
  if (rest.length) g.push({ s: null, items: rest });
  return filtering() ? g.filter(x => x.items.length) : g;
}
function barHTML(sh, all) {
  if (sh.modele === 'fragments') {
    const f = sh.frag || {};
    return `<div class="lt-bar"><span class="lt-sum">${ic('puzzle')} Découpe ${f.cols || 3} × ${f.rows || 3} · <b>${revCount(all)}/${all.length}</b> révélés</span><span class="grow"></span>${f.url ? `<button class="btn sm" data-a="frag-img">${ic('upload')} Remplacer l’image</button>` : ''}<button class="btn sm" data-a="settings" data-v="mod">${ic('cog')} Découpe</button></div>`;
  }
  const c = k => all.filter(i => i.etat === k).length, miss = all.filter(i => missing(sh, i).length).length;
  const fb = (k, l, n) => `<button class="${S.flt === k ? 'on' : ''}" data-a="flt" data-v="${k}">${l}<em>${n}</em></button>`;
  return `<div class="lt-bar">
    <label class="srch sm">${ic('search')}<input type="search" data-in="q" data-k="q" value="${esc(S.q)}" placeholder="Rechercher un nom, un défi…" aria-label="Rechercher"><kbd>/</kbd></label>
    <div class="fseg">${fb('all', fem(sh) ? 'Toutes' : 'Tous', all.length)}${fb('revele', etatL(sh, 'revele', 2), c('revele'))}${fb('pret', etatL(sh, 'pret', 2), c('pret'))}${fb('cache', etatL(sh, 'cache', 2), c('cache'))}${miss || S.flt === 'miss' ? fb('miss', 'À compléter', miss) : ''}</div>
    ${filtering() ? '<span class="lt-note">Réordonner est suspendu pendant un filtre.</span>' : ''}
    <span class="grow"></span>
    ${sh.modele !== 'document' ? `<button class="btn sm" data-a="import">${ic('upload')} Importer des images</button>` : ''}
    <div class="segm sm" title="Taille des vignettes">${['s', 'm', 'l'].map(z => `<button class="${S.size === z ? 'on' : ''}" data-a="size" data-v="${z}">${z.toUpperCase()}</button>`).join('')}</div>
  </div>`;
}
function trayHTML(sh, all) {
  const r = all.filter(i => i.etat === 'pret'); if (!r.length) return '';
  return `<div class="tray"><div class="tray-t">${ic('sparkle')}<div><b>${r.length} ${unit(sh, r.length)} ${agr(sh, 'prêt', r.length)} à révéler</b><small>Toujours ${agr(sh, 'caché', r.length)} aux joueurs jusqu’à ton signal.</small></div></div>
    <div class="tray-i">${r.map(i => `<button class="tray-th" data-a="tile" data-id="${i.id}" title="${esc(i.nom)}">${artBox(sh, i, 'mj')}</button>`).join('')}</div><span class="grow"></span>
    <button class="btn" data-a="reveal-show">${ic('max')} Révéler en présentant</button><button class="btn go" data-a="reveal-all">${ic('sparkle')} Révéler ${r.length > 1 ? 'les ' + r.length : ''}</button></div>`;
}
function serHTML(sh, g, all) {
  const sid = g.s ? g.s.id : '', key = sh.id + ':' + (sid || '_');
  const inG = all.filter(i => groupKey(sh, i) === sid), rv = revCount(inG), tot = inG.length;
  const done = !!g.s && tot > 0 && rv === tot, closed = !!S.closed[key], b = g.s && back(g.s.dos);
  const hd = sh.series.length ? `<div class="ser-hd">
    <button class="ser-tg" data-a="ser-tg" data-v="${key}" aria-expanded="${!closed}">${ic('chev')}${b ? `<img class="ser-dos" src="${esc(b.url)}" alt="">` : ''}<span>${g.s ? esc(g.s.nom) : 'Hors série'}</span></button>
    <button class="ser-cnt" data-a="ser-sel" data-v="${sid}" title="Sélectionner toute la série">${rv}/${tot}</button>
    ${g.s ? `<span class="ser-bar"><i style="width:${tot ? rv / tot * 100 : 0}%"></i></span>${g.s.rec?.t ? rewMJ(g.s.rec, done) : '<button class="lnk dim" data-a="settings" data-v="ser">+ Récompense</button>'}<span class="grow"></span><button class="xbtn" data-a="settings" data-v="ser" title="Régler les séries">${ic('cog')}</button>` : ''}
  </div>` : '';
  const add = filtering() ? '' : S.xp === sid ? xpHTML(sh, sid) : addHTML(sh, sid);
  return `<section class="ser ${closed ? 'closed' : ''} ${done ? 'done' : ''}">${hd}${closed ? '' : `<div class="grid" data-serie="${sid}">${g.items.map(i => tileHTML(sh, i)).join('')}${add}</div>`}</section>`;
}
const rewMJ = (rec, done) => `<span class="rew ${done ? 'done' : ''}" title="${esc(rec.t)}">${ic(done ? 'check' : 'gift')}<b>${esc(rec.t)}</b><em>${done ? 'obtenue' : rec.annonce ? 'annoncée' : 'surprise'}</em></span>`;
function tileHTML(sh, it) {
  const sel = S.sel.includes(it.id), multi = sel && S.sel.length > 1, miss = missing(sh, it), sub = subOf(sh, it);
  const masked = sh.champs.some(f => f.vis === 'pj' && (it.masques || []).includes(f.id));
  const flag = it.etat === 'pret' ? `<span class="t-flag rdy">${ic('sparkle')}${etatL(sh, 'pret')}</span>` : it.etat === 'cache' ? `<span class="t-flag" title="${etatL(sh, 'cache')} aux joueurs">${ic('eyeOff')}</span>` : '';
  return `<div class="tile ${ST[it.etat]} ${sel ? 'sel' : ''}" data-a="tile" data-id="${it.id}" data-collection-id="${it.id}" draggable="true">${artBox(sh, it, 'mj')}${flag}${multi ? `<span class="t-chk">${ic('check')}</span>` : masked ? `<span class="t-mask" title="Un champ est masqué aux joueurs">${ic('lock')}</span>` : ''}
    <div class="t-cap"><span class="t-n">${miss.length ? `<i class="t-miss" title="À compléter : ${esc(miss.join(', '))}"></i>` : ''}<span class="t-nt">${hl(it.nom || 'Sans nom')}</span></span>${sub ? `<span class="t-s">${esc(sub)}</span>` : ''}</div></div>`;
}
const addHTML = (sh, sid) => `<button class="tile t-add" data-a="xp-open" data-v="${sid}" title="Nouvel élément (N) · ou dépose des images ici"><div class="art ${rc(sh)}">${ic('plus')}<small>${sh.modele === 'document' ? 'Nouveau document' : 'Ajouter ou déposer'}</small></div></button>`;
const xpHTML = (sh, sid) => `<div class="xp" data-serie="${sid}">${ic('plus')}<input class="inp" id="xp-in" data-k="xp" placeholder="${NEWL[sh.modele] || 'Nom'}" autocomplete="off"><small><kbd>↵</kbd> créer, le champ reste ouvert · <kbd>Échap</kbd> fermer</small><button class="xbtn" data-a="xp-close" title="Fermer">${ic('x')}</button></div>`;
function emptyHTML(sh) {
  if (sh.modele === 'fragments') return `<div class="lt-empty" data-drop="frag"><span class="le-ic">${ic('puzzle')}</span><b>Dépose l’image complète</b><span>Elle sera découpée en ${sh.frag?.cols || 3} × ${sh.frag?.rows || 3} fragments, à révéler un par un. La découpe se règle dans les réglages.</span><div class="le-row"><button class="btn go" data-a="frag-img">Choisir l’image</button></div></div>`;
  const doc = sh.modele === 'document';
  return `<div class="lt-empty" data-drop="new"><span class="le-ic">${ic(doc ? 'scroll' : 'upload')}</span><b>${doc ? 'Aucun document pour l’instant' : 'Dépose tes images ici'}</b><span>${doc ? 'Titre ↵, et le suivant : le champ reste ouvert.' : 'Un élément par image, nommé d’après le fichier. Des dizaines d’un coup si tu veux.'}</span><div class="le-row">${doc ? '' : '<button class="btn go" data-a="import">Choisir des images</button>'}<button class="btn ${doc ? 'go' : ''}" data-a="xp-open" data-v="">Créer ${doc ? 'un document' : 'sans image'} <kbd>N</kbd></button></div>${S.xp === '' ? `<div class="grid">${xpHTML(sh, '')}</div>` : ''}</div>`;
}
const footHTML = sh => `<div class="lt-ft">${sh.modele === 'fragments' ? '<span>Clic : éditer un fragment</span>' : '<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> parcourir</span><span><kbd>Maj</kbd> / <kbd>Ctrl</kbd> + clic : plusieurs</span>'}<span><kbd>R</kbd> révéler</span><span><kbd>P</kbd> préparer</span><span><kbd>Espace</kbd> présenter</span>${sh.modele === 'fragments' ? '' : '<span><kbd>N</kbd> nouveau</span><span>Glisser : réordonner ou changer de série · déposer des images : créer</span>'}</div>`;

/* ── inspecteur ──────────────────────────────────────────── */
function renderInsp() {
  const box = $('#insp'); if (!box) return;
  const sh = shelf(), st = box.scrollTop;
  keep(() => { box.innerHTML = !S.sel.length ? inspNone(sh) : S.sel.length === 1 ? inspOne(sh, item(S.sel[0])) : inspMulti(sh, S.sel.map(item).filter(Boolean)); });
  box.scrollTop = st;
}
function inspNone(sh) {
  const all = itemsOf(sh), rv = revCount(all), tot = all.length;
  const sers = sh.series.map(s => { const l = all.filter(i => i.serie === s.id), r = revCount(l), d = l.length > 0 && r === l.length; return `<div class="ov-s ${d ? 'done' : ''}"><span>${esc(s.nom)}</span><b>${r}/${l.length}</b>${s.rec?.t ? `<small>${ic(d ? 'check' : 'gift')}${esc(s.rec.t)}</small>` : ''}</div>`; }).join('');
  return `<div class="in-hd"><span class="kick">${ic(MODELS[sh.modele].ic)} ${MODELS[sh.modele].l}${sh.visible ? '' : ' · cachée aux joueurs'}</span><h3 class="in-t">${esc(sh.emoji)} ${esc(sh.nom)}</h3>
    <div class="ov-c"><b>${rv}</b><span>/ ${tot} ${etatL(sh, 'revele', 2).toLowerCase()}</span></div><div class="ov-bar"><i style="width:${tot ? rv / tot * 100 : 0}%"></i></div></div>
    ${sers ? `<div class="in-sec"><div class="lab">Séries</div><div>${sers}</div></div>` : ''}
    ${sh.rec?.t ? `<div class="in-sec"><div class="lab">Collection complète</div><span class="rew">${ic('gift')}<b>${esc(sh.rec.t)}</b><em>${sh.rec.annonce ? 'annoncée' : 'surprise'}</em></span></div>` : ''}
    <div class="in-sec"><p class="hint">Clique une vignette pour l’éditer. <kbd>Maj</kbd> ou <kbd>Ctrl</kbd> + clic pour en sélectionner plusieurs et agir d’un coup.</p><button class="btn" data-a="settings">${ic('cog')} Réglages de la collection</button></div>`;
}
function inspOne(sh, it) {
  if (!it) return inspNone(sh);
  const m = sh.modele, ser = serieOf(sh, it.serie), ids = navIds(), n = ids.indexOf(it.id) + 1;
  const hint = it.etat === 'revele' ? `Visible par tout le groupe${it.revealedAt ? ' depuis le ' + fmtDate(it.revealedAt) : ''}.` : it.etat === 'pret' ? `Toujours ${agr(sh, 'caché')} aux joueurs, en attente dans la réserve « à révéler ».` : 'Les joueurs voient le dos et « ??? ».';
  const EIC = { cache: 'eyeOff', pret: 'sparkle', revele: 'eye' }, EK = { cache: '', pret: ' (P)', revele: ' (R)' };
  return `<div class="in-hd">
    <div class="in-nav"><span class="kick">${esc(ser ? ser.nom : sh.series.length ? 'Hors série' : sh.nom)}${n ? ` · ${String(n).padStart(2, '0')}/${ids.length}` : ''}</span><span class="grow"></span><button class="xbtn" data-a="nav" data-v="-1" title="Précédent (←)">${ic('chevL')}</button><button class="xbtn" data-a="nav" data-v="1" title="Suivant (→)">${ic('chevR')}</button><button class="xbtn" data-a="desel" title="Fermer (Échap)">${ic('x')}</button></div>
    <input class="in-name" data-in="nom" data-k="nom" value="${esc(it.nom)}" placeholder="Nom" aria-label="Nom">
    <div class="etat">${['cache', 'pret', 'revele'].map(e => `<button class="e-${e} ${it.etat === e ? 'on' : ''}" data-a="etat" data-v="${e}" title="${etatL(sh, e)}${EK[e]}">${ic(EIC[e])}${etatL(sh, e)}</button>`).join('')}</div>
    <p class="etat-h">${hint}</p></div>
  <div class="in-sec">${facesHTML(sh, it)}${sh.series.length ? `<label class="lab row">Série<select class="fsel" data-ch="serie">${sh.series.map(s => `<option value="${s.id}" ${it.serie === s.id ? 'selected' : ''}>${esc(s.nom)}</option>`).join('')}<option value="" ${ser ? '' : 'selected'}>Hors série</option></select></label>` : ''}</div>
  ${fieldsHTML(sh, it)}
  <div class="in-ft"><button class="btn sm" data-a="present">${ic('max')} Présenter</button>${m !== 'fragments' ? `<button class="btn sm" data-a="dup">${ic('copy')} Dupliquer</button><span class="grow"></span><button class="ibtn danger" data-a="del" title="Supprimer (Suppr)">${ic('trash')}</button>` : ''}</div>`;
}
const defBackName = (sh, it) => { const s = serieOf(sh, it.serie); return back(s?.dos) ? `${back(s.dos).nom} (série)` : back(sh.dos) ? `${back(sh.dos).nom} (collection)` : 'aucun'; };
function facesHTML(sh, it) {
  const m = sh.modele;
  if (m === 'document') return `<label class="lab">Texte du document<textarea class="ta paper" rows="7" data-in="texte" data-k="texte" placeholder="Ce que les joueurs liront…">${esc(it.texte || '')}</textarea></label>`;
  if (m === 'fragments') return `<div class="faces one"><div class="face" style="aspect-ratio:${pieceRatio(sh)}"><div class="pcs" style="${pieceStyle(sh, it)}"></div><span class="face-l">Fragment ${roman(it.pos + 1)}</span></div></div><p class="hint">Ligne ${Math.floor(it.pos / sh.frag.cols) + 1}, colonne ${it.pos % sh.frag.cols + 1}. L’image vient de la carte complète.</p>`;
  const face = (k, url, label, x) => `<div class="face ${rc(sh)} m-${m} ${url ? '' : 'empty'}" data-a="pick" data-v="${k}" data-face="${k}" title="Cliquer ou déposer une image">${url ? `<img src="${esc(url)}" alt="">` : ic('upload')}<span class="face-l">${label}</span>${x ? `<button class="face-x" data-a="unset" data-v="${k}" title="Retirer">${ic('x')}</button>` : ''}</div>`;
  if (m !== 'carte') return `<div class="faces one">${face('front', it.front, 'Image', !!it.front)}</div>`;
  const opts = `<option value="" ${!it.dos && !it.dosUrl ? 'selected' : ''}>Par défaut · ${esc(defBackName(sh, it))}</option>${D.backs.map(b => `<option value="${b.id}" ${!it.dosUrl && it.dos === b.id ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}${it.dosUrl ? '<option value="__k" selected>Dos unique (importé)</option>' : ''}<option value="__u">Importer un dos unique…</option>`;
  return `<div class="faces">${face('front', it.front, 'Recto', !!it.front)}${face('back', backUrl(sh, it), it.dosUrl ? 'Dos unique' : 'Dos', !!it.dosUrl)}</div><label class="lab row">Dos<select class="fsel" data-ch="dos">${opts}</select></label>`;
}
function fieldsHTML(sh, it) {
  if (!sh.champs.length) return `<div class="in-sec"><button class="lnk" data-a="settings" data-v="chp">+ Ajouter des champs à cette collection</button></div>`;
  return `<div class="in-sec">${sh.champs.map(f => fieldHTML(it, f)).join('')}<button class="lnk dim" data-a="settings" data-v="chp">Gérer les champs</button></div>`;
}
function fieldHTML(it, f) {
  const v = it.champs[f.id] ?? '', mk = (it.masques || []).includes(f.id), mj = f.vis === 'mj';
  const tag = mj ? `<span class="f-mj">${ic('lock')} MJ seul</span>` : `<button class="f-eye ${mk ? 'off' : ''}" data-a="mask" data-v="${f.id}" title="${mk ? 'Masqué aux joueurs, même une fois révélé. Cliquer pour l’afficher.' : 'Visible des joueurs une fois révélé. Cliquer pour le masquer.'}">${ic(mk ? 'eyeOff' : 'eye')}${mk ? 'Masqué' : 'Visible'}</button>`;
  let input;
  if (f.type === 'long') input = `<textarea class="ta ${mj ? 'mj' : ''}" rows="3" data-in="fld" data-v="${f.id}" data-k="f-${f.id}">${esc(v)}</textarea>`;
  else if (f.type === 'liste') input = `<div class="chips">${(f.options || []).map(o => `<button class="chip ${v === o ? 'on' : ''}" data-a="fld-opt" data-v="${f.id}" data-o="${esc(o)}">${esc(o)}</button>`).join('') || '<span class="hint">Aucun choix défini.</span>'}</div>`;
  else input = `<input class="inp ${mj ? 'mj' : ''}" ${f.type === 'nombre' ? 'type="number"' : ''} data-in="fld" data-v="${f.id}" data-k="f-${f.id}" value="${esc(v)}">`;
  return `<div class="fld"><div class="f-hd"><span>${esc(f.nom)}</span>${tag}</div>${input}</div>`;
}
function inspMulti(sh, list) {
  const n = list.length, c = k => list.filter(i => i.etat === k).length, pj = sh.champs.filter(f => f.vis === 'pj');
  const counts = ['revele', 'pret', 'cache'].filter(k => c(k)).map(k => `${c(k)} ${etatL(sh, k, c(k)).toLowerCase()}`).join(' · ');
  return `<div class="in-hd"><div class="in-nav"><span class="kick">Sélection</span><span class="grow"></span><button class="xbtn" data-a="desel" title="Tout désélectionner (Échap)">${ic('x')}</button></div>
    <h3 class="in-t">${n} ${unit(sh, n)}</h3><div class="mstack">${list.slice(0, 10).map(i => `<span class="ms ${ST[i.etat]}">${artBox(sh, i, 'mj')}</span>`).join('')}${n > 10 ? `<span class="ms-more">+${n - 10}</span>` : ''}</div><p class="etat-h">${counts}</p></div>
  <div class="in-sec"><div class="lab">État</div><div class="brow"><button class="btn sm" data-a="b-etat" data-v="cache">${ic('eyeOff')} Cacher</button><button class="btn sm" data-a="b-etat" data-v="pret">${ic('sparkle')} Préparer</button><button class="btn sm go" data-a="b-etat" data-v="revele">${ic('eye')} Révéler</button></div></div>
  ${sh.series.length ? `<div class="in-sec"><label class="lab">Déplacer vers<select class="fsel" data-ch="b-serie"><option value="__">Choisir une série…</option>${sh.series.map(s => `<option value="${s.id}">${esc(s.nom)}</option>`).join('')}<option value="">Hors série</option></select></label></div>` : ''}
  ${sh.modele === 'carte' && D.backs.length ? `<div class="in-sec"><label class="lab">Dos<select class="fsel" data-ch="b-dos"><option value="__">Appliquer un dos…</option><option value="">Par défaut (série ou collection)</option>${D.backs.map(b => `<option value="${b.id}">${esc(b.nom)}</option>`).join('')}</select></label></div>` : ''}
  ${pj.length ? `<div class="in-sec"><div class="lab">Champs, une fois ${etatL(sh, 'revele', 2).toLowerCase()}</div>${pj.map(f => `<div class="mrow"><span>${esc(f.nom)}</span><button class="btn sm" data-a="b-mask" data-v="${f.id}" data-x="1">${ic('eyeOff')} Masquer</button><button class="btn sm" data-a="b-mask" data-v="${f.id}" data-x="0">${ic('eye')} Afficher</button></div>`).join('')}</div>` : ''}
  ${sh.modele !== 'fragments' ? `<div class="in-sec"><button class="btn sm danger" data-a="b-del">${ic('trash')} Supprimer les ${n}</button></div>` : ''}`;
}

/* ── données : création, déplacement, états ──────────────── */
function newItem(sh, p) { return Object.assign({ id: 'i' + uid() + uid(), shelf: sh.id, serie: '', nom: '', front: '', texte: '', dos: '', dosUrl: '', etat: 'cache', champs: {}, masques: [], ordre: 0, revealedAt: '' }, p); }
function insertItems(sh, list, sid, afterId) {
  const ord = itemsOf(sh); let at;
  if (afterId) at = ord.findIndex(i => i.id === afterId) + 1;
  else { const g = ord.filter(i => groupKey(sh, i) === sid); at = g.length ? ord.indexOf(g[g.length - 1]) + 1 : ord.length; }
  list.forEach(i => { i.serie = sid; });
  ord.splice(at, 0, ...list); ord.forEach((i, k) => { i.ordre = k; }); D.items.push(...list);
}
function moveItems(sh, ids, sid, refId, after) {
  const ord = itemsOf(sh).filter(i => !ids.includes(i.id)), mv = ids.map(item).filter(Boolean); let at;
  if (refId) { at = ord.findIndex(i => i.id === refId); if (after) at++; }
  else { const g = ord.filter(i => groupKey(sh, i) === sid); at = g.length ? ord.indexOf(g[g.length - 1]) + 1 : ord.length; }
  mv.forEach(i => { i.serie = sid; }); ord.splice(at, 0, ...mv); ord.forEach((i, k) => { i.ordre = k; });
}
function buildPieces(sh, sourceImage = null) {
  D.items = D.items.filter(i => i.shelf !== sh.id);
  const { cols, rows } = sh.frag;
  const pieceMax = 720;
  for (let p = 0; p < cols * rows; p++) {
    let front = '';
    if (sourceImage) {
      const sx = (p % cols) * sourceImage.naturalWidth / cols;
      const sy = Math.floor(p / cols) * sourceImage.naturalHeight / rows;
      const sw = sourceImage.naturalWidth / cols;
      const shh = sourceImage.naturalHeight / rows;
      const scale = Math.min(1, pieceMax / Math.max(sw, shh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(shh * scale));
      canvas.getContext('2d').drawImage(sourceImage, sx, sy, sw, shh, 0, 0, canvas.width, canvas.height);
      front = canvas.toDataURL('image/jpeg', .82);
    }
    D.items.push(newItem(sh, { nom: 'Fragment ' + roman(p + 1), pos: p, ordre: p, front }));
  }
}
function setEtat(ids, e) {
  const sh = shelf(), list = ids.map(item).filter(i => i && i.etat !== e); if (!list.length) return;
  const d0 = doneSet(sh), wasRev = list.some(i => i.etat === 'revele');
  act(() => {
    list.forEach(i => { i.etat = e; if (e === 'revele') { i.revealedAt = today(); i.fresh = true; } else if (e === 'cache') { i.revealedAt = ''; i.fresh = false; } });
    const who = list.length > 1 ? `${list.length} ${unit(sh, 2)}` : `« ${list[0].nom} »`, n = list.length;
    if (e === 'revele') return `${who} ${agr(sh, 'révélé', n)} au groupe.${newlyDone(sh, d0)}`;
    if (n > 1) return `${who} ${etatL(sh, e, n).toLowerCase()}.`;
    return wasRev ? `${who} de nouveau ${agr(sh, 'caché')}.` : null;
  });
}
function delItems(ids) {
  const sh = shelf(); if (sh.modele === 'fragments' || !ids.length) return;
  const first = item(ids[0]);
  act(() => { D.items = D.items.filter(i => !ids.includes(i.id)); S.sel = []; return ids.length > 1 ? `${ids.length} ${unit(sh, 2)} ${agr(sh, 'supprimé', 2)}.` : `« ${first.nom} » ${agr(sh, 'supprimé')}.`; });
}
function present(id) { const ids = navIds(); lbOpen(ids, Math.max(0, ids.indexOf(id)), 'view'); }
function openXp(sid) { const sh = shelf(); delete S.closed[sh.id + ':' + (sid || '_')]; S.xp = sid; S.q = ''; S.flt = 'all'; renderTable(); $('#xp-in')?.focus(); }
function onFiles(fl, t) {
  const sh = shelf(); if (!t || !fl.length) return;
  if (t.kind === 'backs') return addBacks(fl);
  if (t.kind === 'frag') return setFragImage(sh, fl[0]);
  if (t.kind === 'face') {
    const it = item(t.id); if (!it) return;
    return act(() => { if (t.face === 'back') { it.dosUrl = fl[0].url; it.dos = ''; return `Dos unique appliqué à « ${it.nom} ».`; } it.front = fl[0].url; return sh.modele === 'carte' ? `Recto de « ${it.nom} » remplacé.` : `Image de « ${it.nom} » remplacée.`; });
  }
  if (t.kind === 'new') act(() => {
    const list = fl.map(f => newItem(sh, { nom: f.nom, front: f.url }));
    insertItems(sh, list, t.serie || '', t.after || null); S.sel = list.map(i => i.id); S.anchor = list[0].id;
    const s = serieOf(sh, t.serie); return `${list.length} ${unit(sh, list.length)} ${agr(sh, 'créé', list.length)}${s ? ' dans « ' + s.nom + ' »' : ''}, ${agr(sh, 'caché', list.length)} aux joueurs.`;
  });
}
function setFragImage(sh, f) {
  const im = new Image();
  im.onload = () => act(() => {
    const had = itemsOf(sh).length;
    sh.frag = Object.assign({ cols: 3, rows: 3 }, sh.frag, { url: f.url, ratio: im.naturalWidth / im.naturalHeight });
    buildPieces(sh, im);
    return had ? 'Image et fragments de la carte remplacés.' : `${sh.frag.cols * sh.frag.rows} fragments créés, tous cachés.`;
  });
  im.src = f.url;
}

/* ── actions ─────────────────────────────────────────────── */
let lastClick = { id: null, t: 0 };
A.tile = (t, e) => {
  const id = t.dataset.id, now = Date.now();
  if (t.closest('.tray')) { S.sel = [id]; S.anchor = id; renderTable(); renderInsp(); return; }
  const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
  if (plain && lastClick.id === id && now - lastClick.t < 380) { lastClick = { id: null, t: 0 }; present(id); return; }
  lastClick = { id, t: now };
  if (e.shiftKey && S.anchor) {
    const ids = navIds(), a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    S.sel = a >= 0 && b >= 0 ? [...new Set([...(e.ctrlKey || e.metaKey ? S.sel : []), ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])] : [id];
  } else if (!plain) { S.sel = S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]; S.anchor = id; }
  else { S.sel = [id]; S.anchor = id; }
  renderTable(); renderInsp();
};
A.desel = () => { S.sel = []; renderTable(); renderInsp(); };
A.nav = t => move(t.dataset.v === '1' ? 'ArrowRight' : 'ArrowLeft');
A.etat = t => setEtat(S.sel, t.dataset.v);
A['b-etat'] = t => setEtat(S.sel, t.dataset.v);
A.flt = t => { S.flt = t.dataset.v; renderTable(); };
A['flt-reset'] = () => { S.flt = 'all'; S.q = ''; renderTable(); };
A.size = t => { S.size = t.dataset.v; persist(); renderTable(); };
IN.q = t => { S.q = t.value; renderTable(); };
A['ser-tg'] = t => { const k = t.dataset.v; if (S.closed[k]) delete S.closed[k]; else S.closed[k] = 1; persist(); renderTable(); };
A['ser-sel'] = t => { const sh = shelf(), sid = t.dataset.v; S.sel = navIds().filter(id => groupKey(sh, item(id)) === sid); S.anchor = S.sel[0] || null; renderTable(); renderInsp(); };
A['xp-open'] = t => openXp(t.dataset.v);
A['xp-close'] = () => { S.xp = null; renderTable(); };
A.import = () => { const it = cur(); pickFiles({ kind: 'new', serie: it ? groupKey(shelf(), it) : '' }); };
A['frag-img'] = () => pickFiles({ kind: 'frag' }, false);
A.pick = t => { const it = cur(); if (it) pickFiles({ kind: 'face', id: it.id, face: t.dataset.v }, false); };
A.unset = t => { const it = cur(); if (!it) return; act(() => { if (t.dataset.v === 'back') it.dosUrl = ''; else it.front = ''; return 'Image retirée.'; }); };
A.present = () => { const it = cur(); if (it) present(it.id); };
A.dup = () => { const sh = shelf(), it = cur(); if (!it) return; act(() => { const c = Object.assign(structuredClone(it), { id: 'i' + uid() + uid(), nom: it.nom + ' (copie)', etat: 'cache', revealedAt: '', fresh: false }); insertItems(sh, [c], groupKey(sh, it), it.id); S.sel = [c.id]; return `« ${it.nom} » ${agr(sh, 'dupliqué')}.`; }); };
A.del = () => delItems(S.sel);
A['b-del'] = () => delItems(S.sel);
A.mask = t => { const it = cur(), f = t.dataset.v, m = new Set(it.masques || []); m.has(f) ? m.delete(f) : m.add(f); it.masques = [...m]; saved(); renderInsp(); patchTile(it.id); };
A['b-mask'] = t => { const sh = shelf(), f = sh.champs.find(c => c.id === t.dataset.v), on = t.dataset.x === '1', list = S.sel.map(item); act(() => { list.forEach(i => { const m = new Set(i.masques || []); on ? m.add(f.id) : m.delete(f.id); i.masques = [...m]; }); return `« ${f.nom} » ${on ? 'masqué' : 'affiché'} sur ${list.length} ${unit(sh, list.length)}.`; }); };
A['fld-opt'] = t => { const it = cur(), f = t.dataset.v; it.champs[f] = it.champs[f] === t.dataset.o ? '' : t.dataset.o; saved(); renderInsp(); patchTile(it.id); };
A['reveal-all'] = () => { const sh = shelf(); setEtat(itemsOf(sh).filter(i => i.etat === 'pret').map(i => i.id), 'revele'); };
A['reveal-show'] = () => { const ids = $$('#lt .tray [data-id]').map(el => el.dataset.id); lbOpen(ids, 0, 'reveal'); };
IN.nom = t => { const it = cur(); if (!it) return; it.nom = t.value; const el = $(`#lt [data-id="${it.id}"] .t-nt`); if (el) el.textContent = t.value || 'Sans nom'; };
IN.fld = t => { const it = cur(), sh = shelf(), f = sh.champs.find(c => c.id === t.dataset.v); it.champs[f.id] = f.type === 'nombre' ? (t.value === '' ? '' : Number(t.value)) : t.value; patchTile(it.id); };
IN.texte = t => { const it = cur(); it.texte = t.value; patchTile(it.id); };
CH.dos = t => {
  const it = cur(), v = t.value; if (!it || v === '__k') return;
  if (v === '__u') { renderInsp(); pickFiles({ kind: 'face', id: it.id, face: 'back' }, false); return; }
  it.dos = v; it.dosUrl = ''; saved(); renderTable(); renderInsp();
};
CH.serie = t => { const sh = shelf(), it = cur(); if (!it) return; moveItems(sh, [it.id], t.value, null); saved(); renderTable(); renderInsp(); };
CH['b-serie'] = t => { if (t.value === '__') return; const sh = shelf(), s = serieOf(sh, t.value), ids = [...S.sel]; act(() => { moveItems(sh, ids, t.value, null); return `${ids.length} ${unit(sh, ids.length)} ${agr(sh, 'déplacé', ids.length)} ${s ? 'dans « ' + s.nom + ' »' : 'hors série'}.`; }); };
CH['b-dos'] = t => { if (t.value === '__') return; const sh = shelf(), list = S.sel.map(item); act(() => { list.forEach(i => { i.dos = t.value; i.dosUrl = ''; }); return `Dos appliqué à ${list.length} ${unit(sh, list.length)}.`; }); };
function patchTile(id) { const el = $(`#lt .tile[data-id="${id}"]`); if (el) el.outerHTML = tileHTML(shelf(), item(id)); }

/* ── clavier ─────────────────────────────────────────────── */
function move(k) {
  const els = $$('#lt [data-a="tile"][data-id]').filter(el => !el.closest('.tray')); if (!els.length) return;
  let i = els.findIndex(el => el.dataset.id === S.sel[S.sel.length - 1]);
  if (i < 0) i = 0;
  else if (k === 'ArrowLeft') i = Math.max(0, i - 1);
  else if (k === 'ArrowRight') i = Math.min(els.length - 1, i + 1);
  else {
    const r0 = els[i].getBoundingClientRect(), cx = r0.left + r0.width / 2, down = k === 'ArrowDown';
    const c = els.filter(el => { const r = el.getBoundingClientRect(); return down ? r.top >= r0.bottom - 4 : r.bottom <= r0.top + 4; });
    if (!c.length) return;
    const ys = c.map(el => el.getBoundingClientRect().top), y = down ? Math.min(...ys) : Math.max(...ys);
    let best = null, bd = Infinity;
    c.filter(el => Math.abs(el.getBoundingClientRect().top - y) < 6).forEach(el => { const r = el.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - cx); if (d < bd) { bd = d; best = el; } });
    i = els.indexOf(best);
  }
  const id = els[i].dataset.id; S.sel = [id]; S.anchor = id; renderTable(); renderInsp();
  const el = $(`#lt [data-a="tile"][data-id="${id}"]`);
  if (el) { const r = el.getBoundingClientRect(), top = 130; if (r.top < top) window.scrollBy(0, r.top - top - 8); else if (r.bottom > innerHeight - 12) window.scrollBy(0, r.bottom - innerHeight + 28); }
}
function mjKey(e) {
  const k = e.key, mod = e.ctrlKey || e.metaKey, sh = shelf();
  if (k === '/') { const q = $('[data-k="q"]'); if (q) { e.preventDefault(); q.focus(); } return; }
  if (mod && k.toLowerCase() === 'a') { e.preventDefault(); S.sel = navIds(); renderTable(); renderInsp(); return; }
  if (mod || e.altKey) return;
  if (k === 'Escape') { if (S.xp !== null) { S.xp = null; renderTable(); } else if (S.sel.length) A.desel(); return; }
  if (k.startsWith('Arrow')) { e.preventDefault(); move(k); return; }
  if ((k === 'n' || k === 'N') && sh.modele !== 'fragments') { e.preventDefault(); const it = item(S.sel[S.sel.length - 1]); openXp(it ? groupKey(sh, it) : sh.series[0]?.id || ''); return; }
  if (!S.sel.length) return;
  const list = S.sel.map(item).filter(Boolean);
  if (k === 'r' || k === 'R') setEtat(S.sel, list.every(i => i.etat === 'revele') ? 'cache' : 'revele');
  else if (k === 'p' || k === 'P') setEtat(S.sel, list.every(i => i.etat === 'pret') ? 'cache' : 'pret');
  else if (k === ' ') { e.preventDefault(); present(S.sel[S.sel.length - 1]); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); delItems(S.sel); }
}
document.addEventListener('keydown', e => { if (!document.querySelector('.collection-redesign')) return;
  if (e.target.id !== 'xp-in') return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.xp = null; renderTable(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const nom = e.target.value.trim(); if (!nom) return;
  const sh = shelf(), sid = e.target.closest('.xp').dataset.serie, it = newItem(sh, { nom });
  insertItems(sh, [it], sid, null); S.sel = [it.id]; S.anchor = it.id;
  renderShelves(); renderTable(); renderInsp(); saved();
  const inp = $('#xp-in'); if (inp) { inp.value = ''; inp.focus(); }
  toast(`« ${nom} » ${agr(sh, 'créé')}.`);
}, true);

/* ── glisser-déposer ─────────────────────────────────────── */
let DR = null;
const clearDnd = () => $$('.drop-b,.drop-a,.fdrop,.fover').forEach(el => el.classList.remove('drop-b', 'drop-a', 'fdrop', 'fover'));
const dropT = e => ({ face: e.target.closest('#insp [data-face]'), tile: e.target.closest('#lt .tile[data-id]'), grid: e.target.closest('#lt .grid[data-serie]'), empty: e.target.closest('#lt [data-drop]'), board: e.target.closest('#lt .board') });
document.addEventListener('dragstart', e => { if (!document.querySelector('.collection-redesign')) return;
  const t = e.target.closest?.('#lt .tile[data-id]'); if (!t) return;
  if (filtering()) { e.preventDefault(); toast('Réordonner est suspendu pendant une recherche ou un filtre.'); return; }
  const id = t.dataset.id; DR = S.sel.includes(id) ? navIds().filter(x => S.sel.includes(x)) : [id];
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id);
  setTimeout(() => (DR || []).forEach(x => $(`#lt .tile[data-id="${x}"]`)?.classList.add('dragging')), 0);
});
document.addEventListener('dragend', () => { if (!document.querySelector('.collection-redesign')) return; DR = null; clearDnd(); $$('.dragging').forEach(el => el.classList.remove('dragging')); });
document.addEventListener('dragover', e => { if (!document.querySelector('.collection-redesign')) return;
  if (S.view !== 'mj') return;
  const files = hasFiles(e); if (!DR && !files) return;
  const { face, tile, grid, empty, board } = dropT(e), sh = shelf();
  clearDnd();
  if (files) {
    let el = null;
    if (face && sh.modele !== 'fragments') el = face;
    else if (sh.modele === 'fragments') el = board || empty;
    else if (sh.modele !== 'document') el = tile ? tile : grid || empty;
    if (el) { el.classList.add(el === tile || el === face ? 'fdrop' : 'fover'); e.preventDefault(); }
    return;
  }
  if (tile && !DR.includes(tile.dataset.id)) { const r = tile.getBoundingClientRect(); tile.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-b' : 'drop-a'); e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  else if (grid) { grid.classList.add('fover'); e.preventDefault(); }
});
document.addEventListener('drop', async e => { if (!document.querySelector('.collection-redesign')) return;
  if (S.view !== 'mj') return;
  const files = hasFiles(e), { face, tile, grid, empty, board } = dropT(e), sh = shelf();
  const before = tile?.classList.contains('drop-b'), after = tile?.classList.contains('drop-a');
  clearDnd();
  if (files) {
    e.preventDefault();
    const cropTarget = face && sh.modele !== 'fragments' && cur()
      ? { kind: 'face', id: cur().id, face: face.dataset.face }
      : (tile && e.dataTransfer.files.length === 1 && sh.modele !== 'fragments'
        ? { kind: 'face', id: tile.dataset.id, face: 'front' }
        : null);
    const fileTarget = cropTarget || (sh.modele === 'fragments' ? { kind: 'frag' } : null);
    const fl = await readFiles([...e.dataTransfer.files], fileTarget); if (!fl.length) return;
    if (cropTarget) return onFiles(fl, cropTarget);
    if (sh.modele === 'fragments') { if (board || empty) onFiles(fl, { kind: 'frag' }); return; }
    if (sh.modele === 'document') return;
    if (tile) return onFiles(fl, { kind: 'new', serie: groupKey(sh, item(tile.dataset.id)), after: tile.dataset.id });
    if (grid) return onFiles(fl, { kind: 'new', serie: grid.dataset.serie });
    if (empty) onFiles(fl, { kind: 'new', serie: '' });
    return;
  }
  if (!DR) return;
  e.preventDefault();
  const ids = DR; DR = null;
  const target = tile && (before || after) ? groupKey(sh, item(tile.dataset.id)) : grid ? grid.dataset.serie : null;
  if (target === null) return;
  const cross = ids.some(id => groupKey(sh, item(id)) !== target), s = serieOf(sh, target);
  act(() => { moveItems(sh, ids, target, tile && (before || after) ? tile.dataset.id : null, after); return cross ? `${ids.length > 1 ? ids.length + ' ' + unit(sh, 2) : '« ' + item(ids[0]).nom + ' »'} ${agr(sh, 'déplacé', ids.length)} ${s ? 'dans « ' + s.nom + ' »' : 'hors série'}.` : null; }, { undo: cross });
});


/* COLLECTION — réglages d’une collection (tiroir) + création d’une collection (modale) */
A.settings = t => openSettings(t?.dataset?.v);
function openSettings(sec) {
  const first = !S.drawer; S.drawer = sec || 'id'; S.dosPick = null; renderDrawer();
  if (first) requestAnimationFrame(() => $('#drawer').classList.add('on'));
  if (sec) setTimeout(() => { const el = $('#sx-' + sec), bd = $('#drawer .dbd'); if (el && bd) bd.scrollTop = el.offsetTop - 8; }, 40);
}
function closeSettings() { S.drawer = null; S.dosPick = null; $('#drawer').classList.remove('on'); setTimeout(() => { if (!S.drawer) $('#drawer').innerHTML = ''; }, 300); }
A['set-close'] = () => closeSettings();
function renderDrawer() {
  const sh = shelf(), d = $('#drawer'); if (!sh) return closeSettings();
  const st = d.querySelector('.dbd')?.scrollTop || 0;
  keep(() => { d.innerHTML = `<div class="dback" data-a="set-close"></div><div class="dbox" role="dialog" aria-label="Réglages de la collection"><div class="dhd"><div><span class="kick">Réglages de la collection</span><h3>${esc(sh.emoji)} ${esc(sh.nom)}</h3></div><button class="xbtn" data-a="set-close" title="Fermer (Échap)">${ic('x')}</button></div><div class="dbd">${secId(sh)}${secMod(sh)}${secSer(sh)}${secChp(sh)}${secDos(sh)}${secDel(sh)}</div></div>`; });
  const bd = d.querySelector('.dbd'); if (bd) bd.scrollTop = st;
}
const segBtns = (a, v, cur, opts) => `<div class="segm sm">${opts.map(([x, l]) => `<button class="${String(cur) === String(x) ? 'on' : ''}" data-a="${a}" data-v="${v}" data-x="${x}">${l}</button>`).join('')}</div>`;
const modPv = k => `<span class="mpv mpv-${k}"><i></i><i></i><i></i><i></i></span>`;
const stepper = (k, v, dis) => `<span class="stp"><button data-a="s-grid" data-v="${k}" data-x="-1" ${dis || v <= 2 ? 'disabled' : ''} aria-label="Moins">−</button><b>${v}</b><button data-a="s-grid" data-v="${k}" data-x="1" ${dis || v >= 6 ? 'disabled' : ''} aria-label="Plus">+</button></span>`;

function secId(sh) {
  return `<section class="sx" id="sx-id"><h4>Identité</h4><div class="row2"><input class="inp emo" data-in="s-emoji" data-k="s-emoji" value="${esc(sh.emoji)}" aria-label="Emoji"><input class="inp" data-in="s-nom" data-k="s-nom" value="${esc(sh.nom)}" aria-label="Nom"></div>
    <textarea class="ta" rows="2" data-in="s-desc" data-k="s-desc" placeholder="Présentation vue par les joueurs">${esc(sh.desc || '')}</textarea>
    <div class="vis-row"><button class="switch ${sh.visible ? 'on' : ''}" data-a="s-vis"><i></i>${sh.visible ? 'Visible des joueurs' : 'Cachée aux joueurs'}</button><span class="hint">${sh.visible ? 'Les joueurs voient l’onglet, le compteur et ce qui est révélé.' : 'En préparation : l’onglet n’apparaît pas chez les joueurs.'}</span></div></section>`;
}
function secMod(sh) {
  const all = itemsOf(sh), has = all.length, f = sh.frag || { cols: 3, rows: 3 }, locked = all.some(i => i.etat !== 'cache');
  return `<section class="sx" id="sx-mod"><h4>Modèle</h4><div class="mods">${Object.entries(MODELS).map(([k, m]) => { const dis = has && k !== sh.modele && (k === 'fragments' || sh.modele === 'fragments'); return `<button class="mod ${k === sh.modele ? 'on' : ''}" data-a="s-mod" data-v="${k}" ${dis ? 'disabled title="Les fragments ont leur propre structure : crée une nouvelle collection."' : `title="${esc(m.d)}"`}>${modPv(k)}<b>${m.l}</b></button>`; }).join('')}</div>
    <p class="hint">${esc(MODELS[sh.modele].d)}${sh.modele !== 'fragments' && has ? ' Changer de modèle garde les éléments, leurs images et leurs champs.' : ''}</p>
    ${sh.modele === 'image' ? `<div class="lab row">Format des images ${segBtns('s-ratio', '', sh.ratio || '3:4', Object.keys(RATIO).map(r => [r, r]))}</div>` : ''}
    ${sh.modele === 'fragments' ? `<div class="lab row">Découpe <span class="steps">${stepper('cols', f.cols, locked)} colonnes × ${stepper('rows', f.rows, locked)} lignes</span></div><p class="hint">${locked ? 'Découpe verrouillée : des fragments sont déjà prêts ou révélés.' : `${f.cols * f.rows} fragments. Changer la découpe recrée les fragments.`}</p>${f.url ? `<div class="frag-pv"><img src="${esc(f.url)}" alt=""><button class="btn sm" data-a="frag-img">${ic('upload')} Remplacer l’image</button></div>` : ''}` : ''}</section>`;
}
function secSer(sh) {
  const all = itemsOf(sh), ann = r => r?.annonce !== false ? 1 : 0;
  return `<section class="sx" id="sx-ser"><h4>Séries & récompenses</h4><p class="hint">Une série complète débloque sa récompense. <b>Annoncée</b> : les joueurs savent ce qu’ils visent. <b>Surprise</b> : ils la découvrent à la complétion.</p>
    ${sh.series.map((s, i) => `<div class="srow" data-series-row="${s.id}"><div class="srow-hd"><button class="ibtn series-drag" draggable="true" data-series-drag="${s.id}" title="Glisser pour réordonner" aria-label="Réordonner la série">⋮⋮</button><button class="sdos ${S.dosPick === s.id ? 'on' : ''}" data-a="ser-dospick" data-v="${s.id}" title="Dos de la série">${back(s.dos) ? `<img src="${esc(back(s.dos).url)}" alt="">` : ic('image')}</button><input class="inp" data-in="ser-nom" data-v="${s.id}" data-k="sn-${s.id}" value="${esc(s.nom)}" aria-label="Nom de la série"><span class="dim small">${all.filter(x => x.serie === s.id).length}</span><button class="ibtn" data-a="ser-up" data-v="${s.id}" ${i ? '' : 'disabled'} title="Monter">${ic('up')}</button><button class="ibtn danger" data-a="ser-del" data-v="${s.id}" title="Supprimer la série">${ic('trash')}</button></div>
      ${S.dosPick === s.id ? `<div class="bpick"><button class="bp ${!s.dos ? 'on' : ''}" data-a="ser-dos" data-v="${s.id}" data-x=""><span>Aucun</span></button>${D.backs.map(b => `<button class="bp ${b.id === s.dos ? 'on' : ''}" data-a="ser-dos" data-v="${s.id}" data-x="${b.id}" title="${esc(b.nom)}"><img src="${esc(b.url)}" alt=""></button>`).join('')}</div>` : ''}
      <div class="srow-rw">${ic('gift')}<input class="inp sm" data-in="ser-rec" data-v="${s.id}" data-k="sr-${s.id}" value="${esc(s.rec?.t || '')}" placeholder="Récompense à la complétion (facultatif)">${segBtns('ser-ann', s.id, ann(s.rec), [[1, 'Annoncée'], [0, 'Surprise']])}</div></div>`).join('')}
    <button class="btn sm add-b" data-a="ser-add">${ic('plus')} Série</button>
    <div class="srow all"><div class="srow-hd"><b>Collection complète</b></div><div class="srow-rw">${ic('gift')}<input class="inp sm" data-in="s-rec" data-k="s-rec" value="${esc(sh.rec?.t || '')}" placeholder="Récompense quand tout est révélé (facultatif)">${segBtns('s-ann', '', ann(sh.rec), [[1, 'Annoncée'], [0, 'Surprise']])}</div></div></section>`;
}
const TYPES = [['court', 'Texte court'], ['long', 'Texte long'], ['nombre', 'Nombre'], ['liste', 'Liste de choix']];
function secChp(sh) {
  return `<section class="sx" id="sx-chp"><h4>Champs</h4><p class="hint">Ce que raconte chaque ${unit(sh)}. <b>MJ</b> : jamais montré aux joueurs. Un champ <b>Joueurs</b> peut être masqué élément par élément.</p>
    ${sh.champs.map(f => `<div class="frow"><div class="frow-hd"><input class="inp" data-in="chp-nom" data-v="${f.id}" data-k="cn-${f.id}" value="${esc(f.nom)}" aria-label="Nom du champ"><select class="fsel" data-ch="chp-type" data-v="${f.id}">${TYPES.map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${segBtns('chp-vis', f.id, f.vis, [['pj', 'Joueurs'], ['mj', 'MJ']])}<button class="ibtn danger" data-a="chp-del" data-v="${f.id}" title="Supprimer le champ">${ic('trash')}</button></div>${f.type === 'liste' ? `<input class="inp sm" data-in="chp-opt" data-v="${f.id}" data-k="co-${f.id}" value="${esc((f.options || []).join(', '))}" placeholder="Choix séparés par des virgules">` : ''}</div>`).join('')}
    <button class="btn sm add-b" data-a="chp-add">${ic('plus')} Champ</button>
    <label class="lab row">Sous-titre des vignettes<select class="fsel" data-ch="s-sub"><option value="">Aucun</option>${sh.champs.filter(f => f.vis === 'pj').map(f => `<option value="${f.id}" ${sh.sousTitre === f.id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></label></section>`;
}
function secDos(sh) {
  const use = id => D.shelves.reduce((n, s) => n + (s.dos === id ? 1 : 0) + s.series.filter(x => x.dos === id).length, 0) + D.items.filter(i => i.dos === id).length;
  return `<section class="sx" id="sx-dos"><h4>Dos</h4><p class="hint">${sh.modele === 'carte' ? 'Montré tant qu’une carte est cachée, et quand on la retourne.' : 'Facultatif : remplace un élément caché. Sans dos, un motif du modèle est utilisé.'} Bibliothèque partagée entre collections ; clic = dos par défaut de celle-ci. Une série ou un élément peut avoir le sien.</p>
    <div class="backs">${D.backs.map(b => { const u = use(b.id), on = sh.dos === b.id; return `<div class="bk ${on ? 'on' : ''}"><button class="bk-i" data-a="s-dos" data-v="${b.id}" title="${on ? 'Dos par défaut. Cliquer pour retirer.' : 'Utiliser par défaut'}"><img src="${esc(b.url)}" alt="">${on ? `<span class="bk-on">${ic('check')}</span>` : ''}</button><span class="bk-n">${esc(b.nom)}</span><small>${u} usage${u > 1 ? 's' : ''}</small><button class="bk-x" data-a="bk-del" data-v="${b.id}" title="Retirer de la bibliothèque">${ic('x')}</button></div>`; }).join('')}<button class="bk add" data-a="bk-add">${ic('upload')}<span>Importer</span></button></div></section>`;
}
const secDel = sh => `<section class="sx danger-z"><button class="btn sm danger" data-a="s-del">${ic('trash')} Supprimer la collection</button><span class="hint">${itemsOf(sh).length} éléments. Annulable quelques secondes.</span></section>`;

/* ── identité & modèle ───────────────────────────────────── */
const hdSync = () => { const sh = shelf(), h = $('#drawer .dhd h3'); if (h) h.textContent = `${sh.emoji} ${sh.nom}`; renderShelves(); if (!S.sel.length) renderInsp(); };
IN['s-emoji'] = t => { shelf().emoji = t.value; hdSync(); };
IN['s-nom'] = t => { shelf().nom = t.value; hdSync(); };
IN['s-desc'] = t => { shelf().desc = t.value; };
A['s-vis'] = () => { const sh = shelf(); sh.visible = !sh.visible; saved(); renderShelves(); renderDrawer(); renderInsp(); toast(sh.visible ? `« ${sh.nom} » est visible des joueurs.` : `« ${sh.nom} » est cachée aux joueurs.`); };
A['s-mod'] = t => { const sh = shelf(), v = t.dataset.v; if (v === sh.modele) return; act(() => { sh.modele = v; if (v === 'image' && !sh.ratio) sh.ratio = '3:4'; if (v === 'fragments' && !sh.frag) sh.frag = { cols: 3, rows: 3, url: '', ratio: 4 / 3 }; return `Modèle : ${MODELS[v].l}.`; }); };
A['s-ratio'] = t => { shelf().ratio = t.dataset.x; saved(); renderTable(); renderDrawer(); };
A['s-grid'] = t => {
  const sh = shelf(), k = t.dataset.v;
  sh.frag[k] = Math.min(6, Math.max(2, sh.frag[k] + Number(t.dataset.x)));
  if (sh.frag.url) setFragImage(sh, { url: sh.frag.url });
  else { buildPieces(sh); saved(); render(); if (S.drawer) renderDrawer(); }
};

/* ── séries ──────────────────────────────────────────────── */
const ser = t => serieOf(shelf(), t.dataset.v);
IN['ser-nom'] = t => { ser(t).nom = t.value; renderTable(); };
IN['ser-rec'] = t => { const s = ser(t); s.rec = Object.assign({ annonce: true }, s.rec, { t: t.value }); renderTable(); };
A['ser-ann'] = t => { const s = ser(t); s.rec = Object.assign({ t: '' }, s.rec, { annonce: t.dataset.x === '1' }); saved(); renderTable(); renderDrawer(); };
A['ser-dospick'] = t => { S.dosPick = S.dosPick === t.dataset.v ? null : t.dataset.v; renderDrawer(); };
A['ser-dos'] = t => { ser(t).dos = t.dataset.x; S.dosPick = null; saved(); renderTable(); renderDrawer(); renderInsp(); };
A['ser-up'] = t => { const sh = shelf(), i = sh.series.findIndex(s => s.id === t.dataset.v); if (i > 0) { [sh.series[i - 1], sh.series[i]] = [sh.series[i], sh.series[i - 1]]; saved(); renderTable(); renderDrawer(); } };
A['ser-add'] = () => { const sh = shelf(), s = { id: 's' + uid(), nom: 'Nouvelle série', dos: '', rec: { t: '', annonce: true } }; sh.series.push(s); saved(); renderTable(); renderDrawer(); const el = $(`[data-k="sn-${s.id}"]`); if (el) { el.focus(); el.select(); } };
A['ser-del'] = t => { const sh = shelf(), s = ser(t); act(() => { sh.series = sh.series.filter(x => x !== s); D.items.forEach(i => { if (i.shelf === sh.id && i.serie === s.id) i.serie = ''; }); return `Série « ${s.nom} » supprimée ; ses éléments passent hors série.`; }); };
IN['s-rec'] = t => { const sh = shelf(); sh.rec = Object.assign({ annonce: true }, sh.rec, { t: t.value }); if (!S.sel.length) renderInsp(); };
A['s-ann'] = t => { const sh = shelf(); sh.rec = Object.assign({ t: '' }, sh.rec, { annonce: t.dataset.x === '1' }); saved(); renderDrawer(); if (!S.sel.length) renderInsp(); };

/* ── champs ──────────────────────────────────────────────── */
const chp = t => shelf().champs.find(c => c.id === t.dataset.v);
IN['chp-nom'] = t => { chp(t).nom = t.value; renderInsp(); };
CH['chp-type'] = t => { const f = chp(t); f.type = t.value; if (f.type === 'liste' && !f.options) f.options = []; saved(); renderInsp(); renderDrawer(); };
A['chp-vis'] = t => { const sh = shelf(), f = chp(t); f.vis = t.dataset.x; if (f.vis === 'mj' && sh.sousTitre === f.id) sh.sousTitre = ''; saved(); renderTable(); renderInsp(); renderDrawer(); };
IN['chp-opt'] = t => { chp(t).options = t.value.split(',').map(x => x.trim()).filter(Boolean); renderInsp(); };
A['chp-add'] = () => { const sh = shelf(), f = { id: 'f' + uid(), nom: 'Nouveau champ', type: 'court', vis: 'pj' }; sh.champs.push(f); saved(); renderInsp(); renderDrawer(); const el = $(`[data-k="cn-${f.id}"]`); if (el) { el.focus(); el.select(); } };
A['chp-del'] = t => { const sh = shelf(), f = chp(t); act(() => { sh.champs = sh.champs.filter(c => c.id !== f.id); if (sh.sousTitre === f.id) sh.sousTitre = ''; return `Champ « ${f.nom} » supprimé.`; }); };
CH['s-sub'] = t => { shelf().sousTitre = t.value; saved(); renderTable(); };

/* ── dos ─────────────────────────────────────────────────── */
A['s-dos'] = t => { const sh = shelf(); sh.dos = sh.dos === t.dataset.v ? '' : t.dataset.v; saved(); renderTable(); renderDrawer(); renderInsp(); };
A['bk-add'] = () => pickFiles({ kind: 'backs' }, true);
function addBacks(fl) { act(() => { fl.forEach(f => D.backs.push({ id: 'b' + uid(), nom: f.nom, url: f.url })); return `${fl.length} dos ${fl.length > 1 ? 'ajoutés' : 'ajouté'} à la bibliothèque.`; }); }
A['bk-del'] = t => { const id = t.dataset.v, b = back(id); act(() => { D.backs = D.backs.filter(x => x.id !== id); D.shelves.forEach(s => { if (s.dos === id) s.dos = ''; s.series.forEach(x => { if (x.dos === id) x.dos = ''; }); }); D.items.forEach(i => { if (i.dos === id) i.dos = ''; }); return `Dos « ${b.nom} » retiré.`; }); };
A['s-del'] = () => { const sh = shelf(); closeSettings(); act(() => { D.shelves = D.shelves.filter(s => s.id !== sh.id); D.items = D.items.filter(i => i.shelf !== sh.id); S.shelf = D.shelves[0]?.id; S.sel = []; return `Collection « ${sh.nom} » supprimée.`; }); };

/* ── nouvelle collection ─────────────────────────────────── */
A['new-shelf'] = () => { S.modal = { nom: '', modele: 'carte' }; renderModal(); setTimeout(() => $('#nc-nom')?.focus(), 30); };
function renderModal() {
  const m = S.modal, box = $('#modal');
  if (!m) { box.classList.remove('on'); box.innerHTML = ''; return; }
  box.classList.add('on');
  box.innerHTML = `<div class="mback" data-a="m-close"></div><div class="mbox"><div class="mhd"><h3>Nouvelle collection</h3><button class="xbtn" data-a="m-close" title="Fermer">${ic('x')}</button></div><div class="mbd">
    <label class="lab">Nom<input class="inp" id="nc-nom" data-in="nc-nom" value="${esc(m.nom)}" placeholder="Ex. Trophées de guerre, Vinyles de la taverne…" autocomplete="off"></label>
    <div class="lab">Modèle</div><div class="mods big">${Object.entries(MODELS).map(([k, d]) => `<button class="mod ${k === m.modele ? 'on' : ''}" data-a="nc-mod" data-v="${k}">${modPv(k)}<b>${d.l}</b><small>${d.d}</small></button>`).join('')}</div>
    <p class="hint">Séries, champs et dos se règlent ensuite. La collection reste cachée aux joueurs tant que tu ne la rends pas visible.</p>
    <div class="mft"><button class="btn" data-a="m-close">Annuler</button><button class="btn go" data-a="nc-create">Créer la collection</button></div></div></div>`;
}
function closeModal() { S.modal = null; renderModal(); }
A['m-close'] = () => closeModal();
IN['nc-nom'] = t => { S.modal.nom = t.value; };
A['nc-mod'] = t => { S.modal.modele = t.dataset.v; renderModal(); };
const DEF_CHAMPS = { carte: [['Description', 'long']], objet: [['Origine', 'court']], document: [['Signé', 'court']], image: [['Légende', 'long']], fragments: [['Trouvé à', 'court']] };
A['nc-create'] = () => {
  const m = S.modal, nom = (m.nom || '').trim() || 'Nouvelle collection';
  const champs = DEF_CHAMPS[m.modele].map(([n, ty]) => ({ id: 'f' + uid(), nom: n, type: ty, vis: 'pj' }));
  const sh = { id: 'c' + uid(), nom, emoji: MODELS[m.modele].emo, modele: m.modele, visible: false, desc: '', dos: m.modele === 'carte' ? D.backs[0]?.id || '' : '', sousTitre: ['document', 'fragments'].includes(m.modele) ? champs[0].id : '', rec: { t: '', annonce: true }, series: [], champs };
  if (m.modele === 'image') sh.ratio = '3:4';
  if (m.modele === 'fragments') sh.frag = { cols: 3, rows: 3, url: '', ratio: 4 / 3 };
  closeModal();
  act(() => { D.shelves.push(sh); Object.assign(S, { shelf: sh.id, sel: [], q: '', flt: 'all', xp: null }); return `« ${nom} » créée, cachée aux joueurs le temps de la préparer.`; });
};

let ORDER_DRAG = null;
document.addEventListener('dragstart', event => {
  if (!document.querySelector('.collection-redesign') || !STATE.isAdmin) return;
  const shelfHandle = event.target.closest?.('[data-shelf-drag]');
  const seriesHandle = event.target.closest?.('[data-series-drag]');
  if (shelfHandle) ORDER_DRAG = { type: 'shelf', id: shelfHandle.dataset.shelfDrag };
  else if (seriesHandle) ORDER_DRAG = { type: 'series', id: seriesHandle.dataset.seriesDrag };
  else return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', ORDER_DRAG.id);
});
document.addEventListener('dragover', event => {
  if (!ORDER_DRAG) return;
  const selector = ORDER_DRAG.type === 'shelf' ? '[data-shelf-drag]' : '[data-series-row]';
  if (event.target.closest?.(selector)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
});
document.addEventListener('drop', event => {
  if (!ORDER_DRAG) return;
  const drag = ORDER_DRAG; ORDER_DRAG = null;
  if (drag.type === 'shelf') {
    const target = event.target.closest?.('[data-shelf-drag]')?.dataset.shelfDrag;
    if (!target || target === drag.id) return;
    event.preventDefault();
    const from = D.shelves.findIndex(entry => entry.id === drag.id), to = D.shelves.findIndex(entry => entry.id === target);
    if (from < 0 || to < 0) return;
    const [moved] = D.shelves.splice(from, 1); D.shelves.splice(to, 0, moved);
    D.shelves.forEach((entry, index) => { entry.ordre = index; });
    saved(); renderShelves();
    return;
  }
  const target = event.target.closest?.('[data-series-row]')?.dataset.seriesRow;
  const sh = shelf();
  if (!target || target === drag.id || !sh) return;
  event.preventDefault();
  const from = sh.series.findIndex(entry => entry.id === drag.id), to = sh.series.findIndex(entry => entry.id === target);
  if (from < 0 || to < 0) return;
  const [moved] = sh.series.splice(from, 1); sh.series.splice(to, 0, moved);
  saved(); renderTable(); renderDrawer();
});
document.addEventListener('dragend', () => { ORDER_DRAG = null; });
document.addEventListener('keydown', e => { if (e.target.id === 'nc-nom' && e.key === 'Enter') { e.preventDefault(); A['nc-create'](); } });


/* COLLECTION — vue joueur : vitrine par collection, séries et récompenses, cartes qui se retournent, présentation */
const PW = { carte: 186, objet: 168, document: 196, image: 200, fragments: 200 };
const rot = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997; return ((h % 7) - 3) * .6; };
function rewPJ(rec, done, label) {
  if (done) return `<span class="rew done">${ic('check')}${label} — <b>${esc(rec.t)}</b></span>`;
  return rec.annonce ? `<span class="rew">${ic('gift')}À la clé : <b>${esc(rec.t)}</b></span>` : `<span class="rew">${ic('gift')}<b>Récompense surprise</b></span>`;
}
function renderPJ() {
  const main = $('#main'); main.dataset.v = 'pj';
  const sh = shelf();
  if (!sh || !sh.visible) { main.innerHTML = '<div class="pv"><div class="lt-none"><b>Aucune collection n’est encore visible.</b></div></div>'; return; }
  const all = itemsOf(sh), rv = revCount(all), tot = all.length, nw = all.filter(isNew).length, m = sh.modele;
  let h = `<div class="pv" style="--pw:${PW[m]}px"><header class="pv-hd"><div class="pv-tt"><span class="kick">${ic(MODELS[m].ic)} ${MODELS[m].l}</span><h2>${esc(sh.nom)}</h2>${sh.desc ? `<p class="edito">${esc(sh.desc)}</p>` : ''}</div>
    <div class="pv-ct"><div class="pv-num"><b>${rv}</b><span>/${tot}</span></div><small>${etatL(sh, 'revele', 2)}</small><div class="pv-bar"><i style="width:${tot ? rv / tot * 100 : 0}%"></i></div>${nw ? `<span class="newc">${ic('sparkle')} ${nw} ${nouv(sh, nw)} depuis ta dernière visite</span>` : ''}</div></header>`;
  if (sh.rec?.t) h += `<div class="pv-rec">${rewPJ(sh.rec, tot > 0 && rv === tot, 'Collection complète')}</div>`;
  if (m === 'fragments') h += pvBoard(sh, all);
  else if (sh.series.length) {
    sh.series.forEach(s => { const l = all.filter(i => i.serie === s.id); if (!l.length) return; const r = revCount(l), d = r === l.length; h += `<section class="pv-ser ${d ? 'done' : ''}"><div class="pv-ser-hd"><h3>${esc(s.nom)}</h3><span class="pv-ser-c">${r}/${l.length}</span>${s.rec?.t ? rewPJ(s.rec, d, 'Série complète') : ''}</div><div class="pv-grid">${l.map(i => pvItem(sh, i)).join('')}</div></section>`; });
    const rest = all.filter(i => !serieOf(sh, i.serie));
    if (rest.length) h += `<section class="pv-ser"><div class="pv-ser-hd"><h3>Autres</h3><span class="pv-ser-c">${revCount(rest)}/${rest.length}</span></div><div class="pv-grid">${rest.map(i => pvItem(sh, i)).join('')}</div></section>`;
  } else h += `<div class="pv-grid">${all.map(i => pvItem(sh, i)).join('')}</div>`;
  main.innerHTML = h + '</div>';
}
function pvItem(sh, it) {
  const shown = it.etat === 'revele', m = sh.modele, sub = shown ? subOf(sh, it) : '';
  const nb = isNew(it) ? `<span class="nb">${nouv(sh)}</span>` : '';
  const foot = m === 'image' ? (sub ? `<div class="pc-foot"><span class="pc-s">${esc(sub)}</span></div>` : '') : `<div class="pc-foot"><span class="pc-n">${shown ? esc(it.nom) : '???'}</span>${sub ? `<span class="pc-s">${esc(sub)}</span>` : ''}</div>`;
  if (m === 'carte') return `<div class="pc-w" data-collection-id="${it.id}"><div class="pcard ${shown ? 'rev' : 'hid'} ${S.flip[it.id] ? 'flip' : ''}" data-a="pv-card" data-pid="${it.id}" role="button" tabindex="0" aria-label="${shown ? esc(it.nom) + ', retourner' : 'Carte cachée'}"><div class="pcard-in"><div class="pf art r57 m-carte">${artInner(sh, it, 'pj')}<span class="shine"></span></div><div class="pf pb art r57 m-carte">${hiddenInner(sh, it)}</div></div>${nb}${shown ? `<button class="pc-max" data-a="pv-open" data-v="${it.id}" title="Présenter en grand">${ic('max')}</button>` : ''}</div>${foot}</div>`;
  return `<div class="pc-w" data-collection-id="${it.id}"><button class="pitem ${shown ? 'rev' : 'hid'}" data-a="pv-open" data-v="${it.id}" data-pid="${it.id}" style="--rot:${m === 'image' ? rot(it.id) : 0}deg"><div class="art ${rc(sh)} m-${m}">${artInner(sh, it, 'pj')}<span class="shine"></span></div>${nb}</button>${foot}</div>`;
}
function pvBoard(sh, all) {
  const found = all.filter(i => i.etat === 'revele');
  return `<div class="pv-board"><button class="pv-bw" data-a="pv-board" title="Agrandir la carte">${boardHTML(sh, all, 'pj')}<span class="pv-zoom">${ic('max')} Agrandir</span></button>
    <div class="pv-found"><div class="kick">Fragments retrouvés</div>${found.map(i => `<div class="pv-fi"><b>${roman(i.pos + 1)}</b><span>${esc(subOf(sh, i) || '—')}</span>${isNew(i) ? `<em>${nouv(sh)}</em>` : ''}</div>`).join('') || '<p class="hint">Aucun pour l’instant.</p>'}</div></div>`;
}
const openPJ = id => { const ids = $$('#main [data-pid]').map(el => el.dataset.pid); lbOpen(ids, Math.max(0, ids.indexOf(id)), 'view'); };
A['pv-card'] = t => { const id = t.dataset.pid; if (item(id)?.etat !== 'revele') return openPJ(id); S.flip[id] = !S.flip[id]; t.classList.toggle('flip', !!S.flip[id]); };
A['pv-open'] = t => openPJ(t.dataset.v);
A['pv-board'] = () => lbBoard();



function collectionShell() {
  return `<section class="collection-redesign" data-action="collectionDispatch" data-input="collectionInput" data-change="collectionChange">
    <header class="top"><div class="top-in"><div class="brand"><h1>Collection</h1><small id="brand-sub"></small></div><div id="top-tools"></div></div></header>
    <nav class="shelves" id="shelves" aria-label="Collections"></nav>
    <div id="main"></div>
    <div id="drawer"></div><div id="modal"></div><div id="lb" role="dialog" aria-label="Présentation"></div><div id="toasts" aria-live="polite"></div>
    <input type="file" id="file" accept="image/*" hidden>
  </section>`;
}

export async function renderCollectionPage() {
  const host = document.getElementById('main-content');
  if (!host) return;
  const loaded = await loadCollectionStore({ admin: STATE.isAdmin });
  D.shelves = loaded.shelves;
  D.backs = loaded.backs;
  D.items = loaded.items;
  D.lastVisit = loaded.lastVisit;
  _savedSnapshot = snapshotStore(D);
  if (STATE.isAdmin && !D.shelves.length) {
    D.shelves.push({
      id: 'cartes', nom: 'Cartes', emoji: '🃏', desc: '', modele: 'carte', ratio: '3:4',
      visible: false, ordre: 0, dos: '', sousTitre: '', rec: { t: '', annonce: true },
      series: [], champs: [{ id: 'defi', nom: 'Défi', type: 'long', vis: 'pj' }],
    });
  }
  if (STATE.isAdmin && !loaded.shelves.length) queueStoreSave();
  S.view = STATE.isAdmin ? (S.view || 'mj') : 'pj';
  if (!STATE.isAdmin) S.view = 'pj';
  host.innerHTML = collectionShell();
  if (!_initialized) {
    _initialized = true;
    initRuntime();
  } else {
    render();
  }
  const current = shelf();
  if (!STATE.isAdmin && current) markVisited(current.id);
}

export const collectionRuntimeTestApi = { MODELS, RATIO, missing, backUrl, visibleItems };
