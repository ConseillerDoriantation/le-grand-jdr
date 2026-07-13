// ==============================================================================
// VTT — Bibliothèque de cartes (catalogue MJ : dossiers + images de carte)
// ------------------------------------------------------------------------------
// Catalogue MJ persistant (world/mapLibrary via _mapLibRef). Permet de classer
// des images de carte en dossiers et de les poser sur la page active. État local
// au module. Extrait de vtt.js (cf. docs/vtt-decomposition.md).
// ==============================================================================
import { VS, aid } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { _esc, normalizeImageUrl } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { promptModal } from '../../shared/modal.js';
import { db, doc, setDoc, updateDoc } from '../../config/firebase.js';
import { _pgRef } from './vtt-refs.js';
import { listGithubFolder, GH_IMAGE_EXTS, prettyNameFromFile, fileKey, githubRawUrl } from '../../shared/github-folder.js';

export let _libFolder = null;   // null = racine, string = folderId ouvert
let _libOpen   = true;   // section collapsible dans le tray
let _libSearch = '';
export const _mapLibRef = () => doc(db, `adventures/${aid()}/vtt/mapLibrary`);
const _libCanWrite = () => !!STATE.isAdmin;

function _resolveMapImageUrl(url) {
  const raw = String(url || '').trim();
  if (/^\.?\/?images\/maps\//i.test(raw)) return githubRawUrl(raw);
  return normalizeImageUrl(raw);
}

// Reset au teardown / changement d'aventure (appelé par vtt.js).
export function _resetMapLib() { _libFolder = null; }

export async function _saveMapLib() {
  if (!_libCanWrite()) return;
  await setDoc(_mapLibRef(), { folders: VS.mapLib.folders, images: VS.mapLib.images });
}

export function _renderLibSection() {
  const el = document.getElementById('vtt-tray-library');
  if (!el) return;

  if (!_libOpen) { el.innerHTML = ''; return; }

  const folders = VS.mapLib.folders || [];
  const images  = VS.mapLib.images  || [];
  const curFolder = _libFolder ? folders.find(f => f.id === _libFolder) : null;
  const folderImages = _libFolder
    ? images.filter(i => i.folderId === _libFolder)
    : images.filter(i => !i.folderId);
  const query = _libSearch.trim().toLowerCase();
  const visible = folderImages
    .filter(i => !query || [i.name, i.sourcePath, i.url].some(v => String(v || '').toLowerCase().includes(query)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));

  const folderChips = folders.map(f => {
    const cnt = images.filter(i => i.folderId === f.id).length;
    return `<div class="vtt-lib-folder-chip ${_libFolder === f.id ? 'active' : ''}" role="button" tabindex="0" data-vtt-fn="_vttLibOpenFolder" data-vtt-args="${f.id}" title="${_esc(f.name)}">
      <span>📁</span>
      <strong>${_esc(f.name)}</strong>
      <span class="vtt-lib-chip-cnt">${cnt}</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttLibDelFolder" data-vtt-args="${f.id}" title="Supprimer le dossier">✕</button>
    </div>`;
  }).join('');
  const rootCount = images.filter(i => !i.folderId).length;
  const curLabel = _libFolder ? (curFolder?.name || 'Dossier') : 'Racine';
  const clearBtn = _libSearch ? `<button class="vtt-tray-search-clr" data-vtt-fn="_vttLibSearchClear" title="Effacer">✕</button>` : '';

  const imgGrid = visible.length
    ? `<div class="vtt-lib-grid">${visible.map(img => `
        <div class="vtt-lib-card" role="button" tabindex="0" draggable="true" data-vtt-drag="image:${img.id}" data-vtt-fn="_vttLibPlace" data-vtt-args="${img.id}" title="${_esc(img.name||'Image')} · clic = pleine carte · glisser = placement précis">
          <div class="vtt-lib-card-thumb">
            <img src="${_esc(_resolveMapImageUrl(img.url))}" alt="${_esc(img.name||'')}" loading="lazy" data-img-err="mark-parent" data-img-err-class="vtt-lib-card--err">
          </div>
          <div class="vtt-lib-card-meta">
            <div class="vtt-lib-card-name">${_esc(img.name||'image')}</div>
            ${img.sourcePath ? `<div class="vtt-lib-card-src">${_esc(String(img.sourcePath).split('/').slice(-2).join('/'))}</div>` : ''}
          </div>
          <div class="vtt-lib-card-actions">
            <button class="vtt-lib-card-action primary" data-vtt-fn="_vttLibPlace" data-vtt-args="${img.id}" title="Placer en pleine carte">▶</button>
            ${folders.length && !_libFolder ? `<button class="vtt-lib-card-action" data-vtt-fn="_vttLibMoveMenu" data-vtt-args="${img.id}|event" title="Déplacer dans un dossier">📁</button>` : ''}
            ${_libFolder ? `<button class="vtt-lib-card-action" data-vtt-fn="_vttLibMoveRoot" data-vtt-args="${img.id}" title="Retirer du dossier">↩</button>` : ''}
            <button class="vtt-lib-card-action danger" data-vtt-fn="_vttLibDelImg" data-vtt-args="${img.id}" title="Supprimer">🗑</button>
          </div>
        </div>`).join('')}</div>`
    : `<div class="vtt-tray-empty">${query ? 'Aucune image ne correspond' : `Aucune image${_libFolder ? ' dans ce dossier' : ''}`}</div>`;

  el.innerHTML = `
    <div class="vtt-lib-command">
      <div class="vtt-lib-head">
        <div>
          <strong>${_esc(curLabel)}</strong>
          <span>${visible.length}/${folderImages.length} images · ${images.length} au total</span>
        </div>
        <div class="vtt-lib-actions">
          <button class="vtt-lib-action" data-vtt-fn="_vttLibImportGithub" title="Importer un dossier GitHub">📥</button>
          <button class="vtt-lib-action" data-vtt-fn="_vttLibNewFolder" title="Nouveau dossier">📁</button>
        </div>
      </div>
      <div class="vtt-tray-search">
        <span class="vtt-tray-search-ic">🔍</span>
        <input type="text" class="vtt-tray-search-input" data-search="maplib" placeholder="Rechercher une image…"
          value="${_esc(_libSearch)}" data-vtt-fn="_vttLibSearch" data-vtt-on="input" data-vtt-args="$value">
        ${clearBtn}
      </div>
      <div class="vtt-lib-folder-row">
        <div class="vtt-lib-folder-chip ${!_libFolder ? 'active' : ''}" role="button" tabindex="0" data-vtt-fn="_vttLibOpenFolder" data-vtt-args="null">
          <span>⌂</span><strong>Racine</strong><span class="vtt-lib-chip-cnt">${rootCount}</span>
        </div>
        ${folderChips}
      </div>
    </div>
    ${imgGrid}`;
}

export function _vttLibOpenFolder(id) {
  _libFolder = !id || id === 'null' ? null : id;
  _renderLibSection();
}
export function _vttLibToggle() { _libOpen = !_libOpen; _renderLibSection();
  document.getElementById('vtt-lib-toggle')?.classList.toggle('open', _libOpen); }
export function _vttLibSearch(v) { _libSearch = String(v || ''); _renderLibSection(); }
export function _vttLibSearchClear() { _libSearch = ''; _renderLibSection(); }

export async function _vttLibNewFolder() {
  if (!_libCanWrite()) return;
  const name = (await promptModal('Nom du dossier :', { title: 'Bibliothèque de cartes', required: true }))?.trim();
  if (!name) return;
  VS.mapLib.folders.push({ id: crypto.randomUUID(), name });
  _saveMapLib();
}

// Importe toutes les images d'un dossier du repo GitHub dans la bibliothèque
// (dédup par URL). Ajoutées dans le dossier courant (_libFolder) ou en racine.
// Chemin mémorisé en localStorage.
export async function _vttLibImportGithub() {
  if (!_libCanWrite()) return;
  const KEY = 'vtt-maplib-gh-folder';
  const def = localStorage.getItem(KEY) || 'images/maps';
  const path = (await promptModal('Dossier du repo à importer (ex : images/maps) :',
    { title: 'Importer des images', default: def, placeholder: 'images/maps' }))?.trim();
  if (!path) return;
  localStorage.setItem(KEY, path);
  showNotif('Lecture du dossier…', 'info');
  let files;
  try { files = await listGithubFolder(path, { exts: GH_IMAGE_EXTS, urlMode: 'raw' }); }
  catch (e) { showNotif(e.message, 'error'); return; }
  if (!files.length) { showNotif('Aucune image dans ce dossier', 'info'); return; }
  const seen = new Set((VS.mapLib.images || []).map(i => fileKey(i.url)));
  const added = [];
  for (const f of files) {
    const k = fileKey(f.url);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push({ id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, url: f.url, sourcePath: f.path, name: prettyNameFromFile(f.name), folderId: _libFolder || null });
  }
  if (!added.length) { showNotif('Toutes ces images sont déjà présentes', 'info'); return; }
  VS.mapLib.images = [...(VS.mapLib.images || []), ...added];
  await _saveMapLib();
  _renderLibSection();
  showNotif(`✅ ${added.length} image(s) importée(s)`, 'success');
}

export function _vttLibDelFolder(id) {
  if (!_libCanWrite()) return;
  // Retirer les images du dossier (les remettre en racine)
  VS.mapLib.images  = VS.mapLib.images.map(i => i.folderId === id ? { ...i, folderId: null } : i);
  VS.mapLib.folders = VS.mapLib.folders.filter(f => f.id !== id);
  if (_libFolder === id) _libFolder = null;
  _saveMapLib();
}

export function _vttLibDelImg(id) {
  if (!_libCanWrite()) return;
  VS.mapLib.images = VS.mapLib.images.filter(i => i.id !== id);
  _saveMapLib();
}

export function _vttLibMoveRoot(id) {
  if (!_libCanWrite()) return;
  VS.mapLib.images = VS.mapLib.images.map(i => i.id === id ? { ...i, folderId: null } : i);
  _saveMapLib();
  _renderLibSection();
}

export function _vttLibMoveMenu(imgId, evt) {
  if (!_libCanWrite()) return;
  evt.stopPropagation();
  // Mini popup de sélection de dossier
  const existing = document.getElementById('vtt-lib-move-popup');
  if (existing) { existing.remove(); return; }
  const popup = document.createElement('div');
  popup.id = 'vtt-lib-move-popup';
  popup.className = 'vtt-lib-move-popup';
  popup.innerHTML = VS.mapLib.folders.map(f =>
    `<div class="vtt-lib-move-opt" data-vtt-fn="_vttLibMoveToAndClose" data-vtt-args="${imgId}|${f.id}">📁 ${_esc(f.name)}</div>`
  ).join('') || '<div style="padding:.4rem;font-size:.75rem;color:var(--text-dim)">Aucun dossier</div>';
  const rect = evt.currentTarget.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 4) + 'px';
  popup.style.left = rect.left + 'px';
  document.body.appendChild(popup);
  const close = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', close, true); } };
  requestAnimationFrame(() => document.addEventListener('mousedown', close, true));
}

export function _vttLibMoveTo(imgId, folderId) {
  if (!_libCanWrite()) return;
  VS.mapLib.images = VS.mapLib.images.map(i => i.id === imgId ? { ...i, folderId } : i);
  _saveMapLib();
  _renderLibSection();
}

export function _vttLibPlace(imgId, cell = null) {
  if (!_libCanWrite()) return;
  if (!VS.activePage) { showNotif('Aucune page active', 'error'); return; }
  const img = VS.mapLib.images.find(i => i.id === imgId);
  if (!img) return;
  const isDrop = cell && Number.isFinite(cell.col) && Number.isFinite(cell.row);
  const w = isDrop ? Math.max(1, Math.min(8, VS.activePage.cols)) : VS.activePage.cols;
  const h = isDrop ? Math.max(1, Math.min(5, VS.activePage.rows)) : VS.activePage.rows;
  const x = isDrop ? Math.max(0, Math.min(VS.activePage.cols - w, cell.col - Math.floor(w / 2))) : 0;
  const y = isDrop ? Math.max(0, Math.min(VS.activePage.rows - h, cell.row - Math.floor(h / 2))) : 0;
  const imgs = [...(VS.activePage.backgroundImages??[]), {
    id: Date.now().toString(), url: _resolveMapImageUrl(img.url), sourcePath: img.sourcePath || null, x, y, w, h,
  }];
  updateDoc(_pgRef(VS.activePage.id), { backgroundImages: imgs })
    .then(() => showNotif('Image placée sur la carte', 'success'))
    .catch(() => showNotif('Erreur lors du placement', 'error'));
}

export function _vttLibMoveToAndClose(imgId, folderId) {
  _vttLibMoveTo(imgId, folderId);
  document.getElementById('vtt-lib-move-popup')?.remove();
}
