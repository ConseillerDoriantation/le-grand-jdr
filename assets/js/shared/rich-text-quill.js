// ════════════════════════════════════════════════════════════════════════════
// RICH-TEXT-QUILL — éditeur de texte enrichi basé sur Quill 2 (vendored).
//
// Remplace progressivement l'éditeur contenteditable maison (rich-text.js).
// • Données : HTML en entrée ET en sortie → 100% compatible avec l'existant
//   (aucune migration des contenus déjà enregistrés).
// • Chargement : Quill est vendored et injecté à la demande (comme Konva), donc
//   l'app reste statique/sans build.
//
// API :
//   quillEditorHtml({ id, html, placeholder, minHeight })  → string HTML (conteneur)
//   bindQuillEditors(root)                                  → monte Quill (async)
//   getQuillHtml(id)                                        → string HTML nettoyé
// ════════════════════════════════════════════════════════════════════════════
import { _esc } from './html.js';
import { sanitizeRichTextHtml } from './rich-text.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal } from './upload-cloudinary.js';
import { showNotif } from './notifications.js';
import { STATE } from '../core/state.js';

const _instances = new Map(); // id → instance Quill

// ── Chargement paresseux de Quill (JS + CSS snow + overrides sombres) ──────────
let _loading = null;
export function loadQuill() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (_loading) return _loading;
  const _css = (id, href) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = href;
    document.head.appendChild(link);
  };
  _loading = new Promise((res, rej) => {
    _css('quill-snow-css', './assets/css/vendor/quill.snow.css');
    _css('quill-dark-css', './assets/css/rich-text-quill.css');
    const s = document.createElement('script');
    s.src = './assets/js/vendor/quill-2.0.3.min.js';
    s.onload = () => res(window.Quill);
    s.onerror = () => rej(new Error('Quill introuvable'));
    document.head.appendChild(s);
  });
  return _loading;
}

// Barre d'outils. L'insertion d'image (upload Cloudinary) est RÉSERVÉE AU MJ :
// les joueurs n'ont ni le bouton 🖼 ni le drop/coller d'image.
const _TOOLBAR_BASE = [
  [{ header: [2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'link'],
  ['clean'],
];
const _TOOLBAR_ADMIN = [
  [{ header: [2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'link', 'image'],
  ['clean'],
];

// ── Images : upload Cloudinary (URL insérée, PAS de base64 → Firestore léger) ──
function _pickAndUploadImage(quill) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => { const f = input.files?.[0]; if (f) _uploadAndInsertImage(quill, f, quill.getSelection(true)); };
  input.click();
}

async function _uploadAndInsertImage(quill, file, range) {
  if (!file || !file.type?.startsWith('image/')) return;
  if (!hasCloudinaryConfig()) {
    showNotif('Configure Cloudinary (🔑) pour insérer des images', 'info');
    try { openCloudinaryConfigModal(); } catch {}
    return;
  }
  const idx = range ? range.index : (quill.getSelection()?.index ?? quill.getLength());
  try {
    showNotif("⏳ Upload de l'image…", 'info');
    const { url } = await uploadCloudinary(file, { folder: 'rich-text', tags: ['rich-text'] });
    quill.insertEmbed(idx, 'image', url, 'user');
    quill.setSelection(idx + 1, 0, 'silent');
    showNotif('🖼 Image insérée', 'success');
  } catch (e) {
    showNotif('Upload image échoué : ' + (e?.message || ''), 'error');
  }
}

/** Conteneur d'éditeur. Quill insère sa toolbar AVANT le `.rtq` ; on enveloppe
 *  le tout dans `.rtq-wrap` pour que la modale ne voie qu'UN seul élément
 *  (sinon la toolbar ajoutée comme frère casse la mise en forme alentour).
 *  Le HTML initial est dans le `.rtq` → Quill le reprend comme contenu. */
export function quillEditorHtml({ id, html = '', placeholder = '', minHeight = 200 }) {
  return `<div class="rtq-wrap" style="--rtq-min-h:${parseInt(minHeight) || 200}px"><div class="rtq" data-rtq-id="${_esc(id)}" data-rtq-placeholder="${_esc(placeholder)}">${html || ''}</div></div>`;
}

/** Monte Quill sur tous les conteneurs `.rtq` non encore initialisés sous `root`.
 *  Async (charge Quill au besoin) ; les sites d'appel n'ont pas à `await`. */
export async function bindQuillEditors(root = document) {
  const els = [...(root.querySelectorAll?.('.rtq[data-rtq-id]') || [])]
    .filter(el => !el.classList.contains('rtq-bound') && !el.classList.contains('ql-container'));
  if (!els.length) return;
  await loadQuill();
  const Quill = window.Quill;
  for (const el of els) {
    if (el.classList.contains('rtq-bound') || el.classList.contains('ql-container')) continue;
    el.classList.add('rtq-bound');
    const id = el.getAttribute('data-rtq-id');
    const placeholder = el.getAttribute('data-rtq-placeholder') || '';
    const canImage = !!STATE.isAdmin; // images réservées au MJ
    const q = new Quill(el, {
      theme: 'snow',
      placeholder,
      modules: {
        toolbar: {
          container: canImage ? _TOOLBAR_ADMIN : _TOOLBAR_BASE,
          handlers: canImage ? { image() { _pickAndUploadImage(this.quill); } } : {},
        },
        uploader: { mimetypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'] },
      },
    });
    // Glisser-déposer / coller une image : MJ → upload Cloudinary ; joueur → ignoré.
    const _up = q.getModule('uploader');
    if (_up) _up.upload = canImage
      ? (range, files) => { [...files].forEach(f => _uploadAndInsertImage(q, f, range)); }
      : () => {};
    if (id) _instances.set(id, q);
  }
}

// Quill 2 sort des listes au format `<ol><li data-list="bullet">` (rendu en
// puces uniquement via la CSS de Quill). Pour un HTML standard, portable et
// correctement affiché en lecture seule (sans CSS Quill), on normalise en
// <ul>/<ol> et on retire les classes ql-* (align → style).
function _normalizeQuillHtml(html) {
  try {
    const doc  = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild;
    root.querySelectorAll('ol').forEach(ol => {
      const items = [...ol.children];
      const allBullet = items.length > 0 && items.every(li => li.getAttribute('data-list') === 'bullet');
      items.forEach(li => li.removeAttribute('data-list'));
      if (allBullet) {
        const ul = doc.createElement('ul');
        while (ol.firstChild) ul.appendChild(ol.firstChild);
        ol.replaceWith(ul);
      }
    });
    root.querySelectorAll('[class]').forEach(el => {
      [...el.classList].forEach(c => {
        if (c.startsWith('ql-align-')) { el.style.textAlign = c.slice(9); el.classList.remove(c); }
        else if (c.startsWith('ql-'))  el.classList.remove(c);
      });
      if (!el.getAttribute('class')) el.removeAttribute('class');
    });
    return root.innerHTML;
  } catch { return html; }
}

/** HTML courant d'un éditeur (normalisé + nettoyé ; vide → ''). */
export function getQuillHtml(id) {
  const q = _instances.get(id);
  if (!q) return '';
  const html = q.root.innerHTML;
  if (html === '<p><br></p>' || html === '<p></p>' || html === '<br>') return '';
  const std = _normalizeQuillHtml(html);
  try { return sanitizeRichTextHtml(std); } catch { return std; }
}
