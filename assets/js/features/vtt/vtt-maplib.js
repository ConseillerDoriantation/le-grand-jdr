// ==============================================================================
// VTT — Bibliothèque de cartes (catalogue MJ : dossiers + images de carte)
// ------------------------------------------------------------------------------
// Catalogue MJ persistant (world/mapLibrary via _mapLibRef). Permet de classer
// des images de carte en dossiers et de les poser sur la page active. État local
// au module. Extrait de vtt.js (cf. docs/vtt-decomposition.md).
// ==============================================================================
import { VS, aid } from './vtt-state.js';
import { _esc, normalizeImageUrl } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { promptModal } from '../../shared/modal.js';
import { db, doc, setDoc, updateDoc } from '../../config/firebase.js';
import { _pgRef } from './vtt-refs.js';
import { listGithubFolder, GH_IMAGE_EXTS, prettyNameFromFile, fileKey, githubRawUrl } from '../../shared/github-folder.js';

export let _libFolder = null;   // null = racine, string = folderId ouvert
let _libOpen   = true;   // section collapsible dans le tray
export const _mapLibRef = () => doc(db, `adventures/${aid()}/vtt/mapLibrary`);

function _resolveMapImageUrl(url) {
  const raw = String(url || '').trim();
  if (/^\.?\/?images\/maps\//i.test(raw)) return githubRawUrl(raw);
  return normalizeImageUrl(raw);
}

// Reset au teardown / changement d'aventure (appelé par vtt.js).
export function _resetMapLib() { _libFolder = null; }

export async function _saveMapLib() {
  await setDoc(_mapLibRef(), { folders: VS.mapLib.folders, images: VS.mapLib.images });
}

export function _renderLibSection() {
  const el = document.getElementById('vtt-tray-library');
  if (!el) return;

  if (!_libOpen) { el.innerHTML = ''; return; }

  const folders = VS.mapLib.folders || [];
  const images  = VS.mapLib.images  || [];
  const curFolder = _libFolder ? folders.find(f => f.id === _libFolder) : null;
  const visible = _libFolder
    ? images.filter(i => i.folderId === _libFolder)
    : images.filter(i => !i.folderId);

  const folderChips = !_libFolder ? folders.map(f => {
    const cnt = images.filter(i => i.folderId === f.id).length;
    return `<div class="vtt-lib-folder-chip" data-vtt-fn="_vttLibOpenFolder" data-vtt-args="${f.id}">
      <span>📁 ${_esc(f.name)}</span>
      <span class="vtt-lib-chip-cnt">${cnt}</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttLibDelFolder" data-vtt-args="${f.id}" title="Supprimer le dossier">✕</button>
    </div>`;
  }).join('') : '';

  const imgGrid = visible.length
    ? `<div class="vtt-lib-grid">${visible.map(img => `
        <div class="vtt-lib-card" title="${_esc(img.name||'')}">
          <img src="${_esc(_resolveMapImageUrl(img.url))}" alt="${_esc(img.name||'')}" loading="lazy" data-img-err="mark-parent" data-img-err-class="vtt-lib-card--err">
          <div class="vtt-lib-card-ov">
            <button data-vtt-fn="_vttLibPlace" data-vtt-args="${img.id}" title="Placer sur la carte">▶</button>
            ${folders.length && !_libFolder ? `<button data-vtt-fn="_vttLibMoveMenu" data-vtt-args="${img.id}|event" title="Déplacer dans un dossier">📁</button>` : ''}
            ${_libFolder ? `<button data-vtt-fn="_vttLibMoveRoot" data-vtt-args="${img.id}" title="Retirer du dossier">↩</button>` : ''}
            <button data-vtt-fn="_vttLibDelImg" data-vtt-args="${img.id}" title="Supprimer">🗑</button>
          </div>
          <div class="vtt-lib-card-name">${_esc(img.name||'image')}</div>
        </div>`).join('')}</div>`
    : `<div class="vtt-tray-empty">Aucune image${_libFolder ? ' dans ce dossier' : ''}</div>`;

  el.innerHTML = `
    ${_libFolder
      ? `<button class="vtt-lib-back" data-vtt-fn="_vttLibOpenFolder" data-vtt-args="null">← ${_esc(curFolder?.name||'Racine')}</button>`
      : folderChips}
    ${imgGrid}`;
}

export function _vttLibOpenFolder(id) { _libFolder = id; _renderLibSection(); }
export function _vttLibToggle() { _libOpen = !_libOpen; _renderLibSection();
  document.getElementById('vtt-lib-toggle')?.classList.toggle('open', _libOpen); }

export async function _vttLibNewFolder() {
  const name = (await promptModal('Nom du dossier :', { title: 'Bibliothèque de cartes', required: true }))?.trim();
  if (!name) return;
  VS.mapLib.folders.push({ id: crypto.randomUUID(), name });
  _saveMapLib();
}

// Importe toutes les images d'un dossier du repo GitHub dans la bibliothèque
// (dédup par URL). Ajoutées dans le dossier courant (_libFolder) ou en racine.
// Chemin mémorisé en localStorage.
export async function _vttLibImportGithub() {
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
  // Retirer les images du dossier (les remettre en racine)
  VS.mapLib.images  = VS.mapLib.images.map(i => i.folderId === id ? { ...i, folderId: null } : i);
  VS.mapLib.folders = VS.mapLib.folders.filter(f => f.id !== id);
  if (_libFolder === id) _libFolder = null;
  _saveMapLib();
}

export function _vttLibDelImg(id) {
  VS.mapLib.images = VS.mapLib.images.filter(i => i.id !== id);
  _saveMapLib();
}

export function _vttLibMoveRoot(id) {
  VS.mapLib.images = VS.mapLib.images.map(i => i.id === id ? { ...i, folderId: null } : i);
  _saveMapLib();
}

export function _vttLibMoveMenu(imgId, evt) {
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
  VS.mapLib.images = VS.mapLib.images.map(i => i.id === imgId ? { ...i, folderId } : i);
  _saveMapLib();
}

export function _vttLibPlace(imgId) {
  if (!VS.activePage) { showNotif('Aucune page active', 'error'); return; }
  const img = VS.mapLib.images.find(i => i.id === imgId);
  if (!img) return;
  const imgs = [...(VS.activePage.backgroundImages??[]), {
    id: Date.now().toString(), url: _resolveMapImageUrl(img.url), sourcePath: img.sourcePath || null, x: 0, y: 0,
    w: VS.activePage.cols, h: VS.activePage.rows,
  }];
  updateDoc(_pgRef(VS.activePage.id), { backgroundImages: imgs })
    .then(() => showNotif('Image placée sur la carte', 'success'))
    .catch(() => showNotif('Erreur lors du placement', 'error'));
}

export function _vttLibMoveToAndClose(imgId, folderId) {
  _vttLibMoveTo(imgId, folderId);
  document.getElementById('vtt-lib-move-popup')?.remove();
}
