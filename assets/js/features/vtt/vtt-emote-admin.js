import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { openModal, closeModalDirect, setModalCloseGuard, clearModalCloseGuard } from '../../shared/modal.js';
import { uploadPng } from '../../shared/image-upload.js';
import { uploadCloudinary, hasCloudinaryConfig, CLOUDINARY_ENABLED } from '../../shared/upload-cloudinary.js';
import { listGithubFolder, GH_IMAGE_EXTS, slugFromFile, fileKey } from '../../shared/github-folder.js';
import { loadStats, peekStats } from '../../shared/stats.js';
import {
  sanitizeEmoteName, normalizeEmote, uniqueEmoteName, emoteCatalogIssues,
  finalizeEmoteDraft, dedupeEmoteImports, dataUrlBytes,
} from '../../shared/emote-admin.js';

const LIMIT_BYTES = 1024 * 1024;
const HEAVY_BYTES = 40 * 1024;
let _destroyActive = null;

const _icon = (name) => {
  const paths = {
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  };
  return `<svg class="vtt-ea-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
};

const _clone = list => list.map(item => ({ ...item, aliases: [...(item.aliases || [])] }));
const _persisted = list => list.map(item => ({
  id: String(item.id || ''), name: sanitizeEmoteName(item.name), url: String(item.url || ''),
  ...(item.aliases?.length ? { aliases: [...item.aliases] } : {}),
}));
const _plural = (count, singular, plural = `${singular}s`) => `${count} ${count > 1 ? plural : singular}`;
const _uid = () => globalThis.crypto?.randomUUID?.() || `em_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function _emoteStatsMap(data) {
  const totals = new Map();
  for (const char of Object.values(data?.chars || {})) {
    for (const [name, count] of Object.entries(char?.emotes || {})) {
      totals.set(name, (totals.get(name) || 0) + (Number(count) || 0));
    }
  }
  return totals;
}

export async function openEmoteAdminModal({ emotes = [], save, onSaved } = {}) {
  _destroyActive?.();
  const saved = emotes.map((item, index) => normalizeEmote(item, index));
  const stats = _emoteStatsMap(peekStats() || await loadStats().catch(() => null));
  const state = {
    saved: _clone(saved), draft: _clone(saved), history: [], selected: new Set(saved[0] ? [saved[0].id] : []),
    anchor: saved[0]?.id || '', query: '', filter: 'all', menu: false, urlEditor: false,
    askClose: false, saving: false, dragId: '', dragDepth: 0, typingName: false,
    broken: new Set(), dimensions: new Map(), objectUrls: new Set(), stats,
    folder: localStorage.getItem('vtt-emote-folder') || localStorage.getItem('vtt-imgbb-emote-album') || '',
  };

  openModal('Émotes', `
    <div class="vtt-ea-shell" id="vtt-emote-admin" tabindex="-1">
      <header class="vtt-ea-head">
        <div><h2>Émotes</h2><p>Envoyées sur les tokens et tapées <code>:nom:</code> dans le chat. L’ordre ici est celui de l’onglet « Toutes » des joueurs.</p></div>
        <button type="button" class="vtt-ea-close" data-ea-action="close" aria-label="Fermer">${_icon('close')}</button>
      </header>
      <div class="vtt-ea-main">
        <section class="vtt-ea-library"><div class="vtt-ea-tools" data-ea-tools></div><div class="vtt-ea-grid" data-ea-grid aria-label="Bibliothèque d’émotes"></div></section>
        <aside class="vtt-ea-inspector" data-ea-inspector aria-label="Détails de l’émote"></aside>
      </div>
      <footer class="vtt-ea-foot" data-ea-footer></footer>
      <div class="vtt-ea-drop" data-ea-drop><div><b>Dépose tes images</b><small>Une émote par fichier, nommée d’après le fichier</small></div></div>
      <input type="file" accept="image/*" multiple hidden data-ea-files>
      <input type="file" accept="image/*" hidden data-ea-replace>
    </div>`);

  const root = document.getElementById('vtt-emote-admin');
  if (!root) return;
  const $ = selector => root.querySelector(selector);

  const savedById = () => new Map(state.saved.map(item => [item.id, item]));
  const one = () => state.selected.size === 1 ? state.draft.find(item => state.selected.has(item.id)) : null;
  const isNew = item => !state.saved.some(savedItem => savedItem.id === item.id);
  const isRenamed = item => {
    const before = savedById().get(item.id);
    return !!before && before.name !== item.name;
  };
  const isModified = item => {
    const before = savedById().get(item.id);
    return !!before && JSON.stringify(_persisted([before])) !== JSON.stringify(_persisted([item]));
  };
  const dirty = () => JSON.stringify(_persisted(state.draft)) !== JSON.stringify(_persisted(state.saved));
  const changes = () => {
    const before = savedById();
    let count = state.draft.filter(item => !before.has(item.id) || isModified(item)).length;
    count += state.saved.filter(item => !state.draft.some(current => current.id === item.id)).length;
    if (!count && dirty()) count = 1;
    return count;
  };
  const blocking = () => {
    // Le nom conservé lors d'un renommage devient réellement un alias au save :
    // on valide donc déjà cette forme finale pour éviter un échec tardif.
    const issues = emoteCatalogIssues(finalizeEmoteDraft(state.draft, state.saved));
    for (const item of state.draft) if (!item.url && !item._file) issues.set(item.id, 'Image requise');
    return issues;
  };
  const warning = item => {
    if (state.broken.has(item.id)) return 'Image introuvable';
    if (!CLOUDINARY_ENABLED && (item._bytes || dataUrlBytes(item.url)) > HEAVY_BYTES) {
      return `Image lourde (${Math.ceil((item._bytes || dataUrlBytes(item.url)) / 1024)} Ko)`;
    }
    return '';
  };
  const issue = item => blocking().get(item.id) || warning(item);
  const visible = () => {
    const query = sanitizeEmoteName(state.query);
    return state.draft.filter(item => {
      const matches = !query || item.name.includes(query) || (item.aliases || []).some(alias => alias.includes(query));
      if (!matches) return false;
      if (state.filter === 'issues') return !!issue(item);
      if (state.filter === 'new') return isNew(item);
      return true;
    });
  };
  const locked = () => !!state.query.trim() || state.filter !== 'all';
  const sentCount = item => [item.name, ...(item.aliases || [])].reduce((sum, name) => sum + (state.stats.get(name) || 0), 0);

  function snapshot() {
    state.history.push({ draft: _clone(state.draft), selected: [...state.selected], anchor: state.anchor });
    if (state.history.length > 80) state.history.shift();
  }
  function mutate(fn, { record = true } = {}) {
    if (record) snapshot();
    fn();
    render();
  }
  function undo() {
    const previous = state.history.pop();
    if (!previous) return;
    state.draft = _clone(previous.draft);
    state.selected = new Set(previous.selected.filter(id => state.draft.some(item => item.id === id)));
    state.anchor = previous.anchor;
    render();
    showNotif('Modification annulée', 'info', { history: false });
  }

  function imageHtml(item, { detail = false } = {}) {
    if (state.broken.has(item.id)) return '<span class="vtt-ea-broken">?</span>';
    return `<img src="${_esc(item.url)}" alt="" data-ea-image="${_esc(item.id)}"${detail ? ' class="is-detail"' : ''} draggable="false">`;
  }

  function renderTools() {
    const issues = state.draft.filter(item => issue(item)).length;
    const fresh = state.draft.filter(isNew).length;
    if ((state.filter === 'issues' && !issues) || (state.filter === 'new' && !fresh)) state.filter = 'all';
    $('[data-ea-tools]').innerHTML = `
      <label class="vtt-ea-search">${_icon('search')}<input value="${_esc(state.query)}" data-ea-query placeholder="Rechercher un nom ou un alias…" autocomplete="off"></label>
      <button type="button" class="vtt-ea-filter${state.filter === 'all' ? ' is-active' : ''}" data-ea-filter="all">Toutes <b>${state.draft.length}</b></button>
      ${issues ? `<button type="button" class="vtt-ea-filter is-error${state.filter === 'issues' ? ' is-active' : ''}" data-ea-filter="issues">À corriger <b>${issues}</b></button>` : ''}
      ${fresh ? `<button type="button" class="vtt-ea-filter is-new${state.filter === 'new' ? ' is-active' : ''}" data-ea-filter="new">Nouvelles <b>${fresh}</b></button>` : ''}
      <div class="vtt-ea-menu-wrap" data-ea-menu-wrap>
        <button type="button" class="vtt-ea-btn ghost small" data-ea-action="menu" aria-expanded="${state.menu}">Importer…</button>
        ${state.menu ? `<div class="vtt-ea-menu">
          <button type="button" data-ea-action="pick"><b>Images depuis l’ordinateur</b><small>Plusieurs à la fois, ou glisse-les sur la fenêtre.</small></button>
          <hr><div class="vtt-ea-menu-form"><b>Depuis une URL</b><div><input data-ea-add-url placeholder="https://…/rire.png"><button type="button" class="vtt-ea-btn ghost small" data-ea-action="add-url">Ajouter</button></div></div>
          <hr><div class="vtt-ea-menu-form"><b>Dossier GitHub du repo</b><small>Toutes les images, sans doublon de nom ni de fichier.</small><div><input data-ea-github-path value="${_esc(localStorage.getItem('vtt-emote-gh-folder') || 'images/emotes')}"><button type="button" class="vtt-ea-btn ghost small" data-ea-action="github">Importer</button></div></div>
          ${CLOUDINARY_ENABLED ? `<hr><div class="vtt-ea-menu-form"><b>Sous-dossier Cloudinary</b><small>Les nouvelles images iront dans <code>emotes/${_esc(state.folder || '…')}</code>.</small><input data-ea-folder value="${_esc(state.folder)}" placeholder="optionnel"></div>` : ''}
        </div>` : ''}
      </div>
      <button type="button" class="vtt-ea-btn primary small" data-ea-action="pick">${_icon('plus')}Ajouter</button>`;
  }

  function renderGrid() {
    const list = visible();
    $('[data-ea-grid]').innerHTML = list.map(item => {
      const problem = blocking().get(item.id);
      const warn = warning(item);
      const color = problem ? 'error' : warn ? 'warning' : isNew(item) ? 'new' : isModified(item) ? 'changed' : '';
      return `<button type="button" class="vtt-ea-tile${state.selected.has(item.id) ? ' is-selected' : ''}" data-ea-id="${_esc(item.id)}" draggable="${!locked()}" title=":${_esc(item.name)}:${problem || warn ? ` · ${_esc(problem || warn)}` : ''}">
        ${locked() ? '' : `<span class="vtt-ea-order">${state.draft.indexOf(item) + 1}</span>`}${color ? `<span class="vtt-ea-state ${color}"></span>` : ''}
        <span class="vtt-ea-thumb">${imageHtml(item)}</span><span class="vtt-ea-name">:${_esc(item.name || '…')}:</span>
      </button>`;
    }).join('') || `<p class="vtt-ea-empty">Aucune émote${state.query ? ` pour « ${_esc(state.query)} »` : ''}.</p>`;
    if (!locked()) $('[data-ea-grid]').insertAdjacentHTML('beforeend', `<button type="button" class="vtt-ea-tile add" data-ea-action="pick">${_icon('plus')}<span>Ajouter</span></button>`);
  }

  function renderInspector() {
    const panel = $('[data-ea-inspector]');
    const selected = state.draft.filter(item => state.selected.has(item.id));
    if (!selected.length) {
      panel.innerHTML = '<div class="vtt-ea-blank"><b>Aucune émote sélectionnée</b><span>Clique une émote pour la modifier. Maj ou Ctrl pour en sélectionner plusieurs.</span></div>';
      return;
    }
    if (selected.length > 1) {
      panel.innerHTML = `<span class="vtt-ea-label">${selected.length} émotes sélectionnées</span>
        <div class="vtt-ea-multi">${selected.map(item => imageHtml(item)).join('')}</div>
        <div class="vtt-ea-actions"><button type="button" class="vtt-ea-btn ghost small" data-ea-move="top">${_icon('up')}Mettre en tête</button><button type="button" class="vtt-ea-btn ghost small" data-ea-move="end">Mettre à la fin</button><span></span><button type="button" class="vtt-ea-btn danger-outline small" data-ea-action="delete">Supprimer</button></div>
        <p class="vtt-ea-help">Suppr pour supprimer · Échap pour désélectionner</p>`;
      return;
    }
    const item = selected[0];
    const before = savedById().get(item.id);
    const error = blocking().get(item.id);
    const warn = warning(item);
    const dims = state.dimensions.get(item.id);
    const bytes = item._bytes || dataUrlBytes(item.url);
    const meta = [dims ? `${dims.width}×${dims.height}` : '', bytes ? `${Math.ceil(bytes / 1024)} Ko` : '', item._file ? 'à téléverser' : ''].filter(Boolean).join(' · ');
    panel.innerHTML = `<div class="vtt-ea-stage" data-ea-stage>${imageHtml(item, { detail: true })}<span class="vtt-ea-meta${!CLOUDINARY_ENABLED && bytes > HEAVY_BYTES ? ' warning' : ''}">${_esc(meta)}</span><button type="button" class="vtt-ea-btn ghost small vtt-ea-replace" data-ea-action="replace">${_icon('image')}Remplacer</button></div>
      ${state.urlEditor ? `<div class="vtt-ea-inline"><input data-ea-replace-url value="${item.url?.startsWith('data:') || item.url?.startsWith('blob:') ? '' : _esc(item.url)}" placeholder="https://…"><button type="button" class="vtt-ea-btn ghost small" data-ea-action="replace-url">OK</button></div>` : '<button type="button" class="vtt-ea-link" data-ea-action="url-editor">Utiliser une URL à la place</button>'}
      <div class="vtt-ea-field"><span class="vtt-ea-label">Nom</span><label class="vtt-ea-name-input${error ? ' invalid' : ''}">:<input data-ea-name value="${_esc(item.name)}" maxlength="32" autocomplete="off" spellcheck="false">:</label><p class="vtt-ea-help${error ? ' error' : warn ? ' warning' : ''}" data-ea-name-help>${_esc(error || warn || 'Minuscules, chiffres et _ uniquement. Les accents et espaces sont convertis.')}</p>
        ${isRenamed(item) ? `<label class="vtt-ea-keep"><input type="checkbox" data-ea-keep-old ${item.keepOldName !== false ? 'checked' : ''}> Garder <code>:${_esc(before.name)}:</code> en alias pour les anciens messages</label>` : ''}
      </div>
      <div class="vtt-ea-field"><span class="vtt-ea-label">Alias</span><div class="vtt-ea-chips">${(item.aliases || []).map((alias, index) => `<span>:${_esc(alias)}:<button type="button" data-ea-remove-alias="${index}" aria-label="Retirer l’alias">${_icon('close')}</button></span>`).join('')}<input data-ea-alias placeholder="+ alias" maxlength="32" spellcheck="false"></div><p class="vtt-ea-help">D’autres noms qui affichent la même émote dans le chat.</p></div>
      <div class="vtt-ea-stats"><span>${before ? `Envoyée <b>${sentCount(item)}</b> fois` : 'Pas encore enregistrée'}</span><span>Position <b>${state.draft.indexOf(item) + 1}</b>/${state.draft.length}</span></div>
      <div class="vtt-ea-actions"><span></span><button type="button" class="vtt-ea-btn danger-outline small" data-ea-action="delete">Supprimer</button></div>`;
  }

  function storageGauge() {
    if (CLOUDINARY_ENABLED) return `<span class="vtt-ea-gauge">emotes/${_esc(state.folder || '')}</span>`;
    const bytes = state.draft.reduce((sum, item) => sum + dataUrlBytes(item.url), 0);
    const percent = Math.min(100, bytes / LIMIT_BYTES * 100);
    const tone = percent > 85 ? 'danger' : percent > 65 ? 'warning' : 'safe';
    return `<span class="vtt-ea-gauge" title="Images intégrées dans le document Firestore"><span><i class="${tone}" style="width:${percent}%"></i></span>${Math.ceil(bytes / 1024)} Ko / 1 Mo</span>`;
  }

  function renderFooter() {
    const footer = $('[data-ea-footer]');
    const count = changes();
    const errors = blocking().size;
    const pending = state.draft.filter(item => item._file).length;
    const renamed = state.draft.filter(isRenamed);
    if (state.askClose) {
      footer.innerHTML = `<div class="vtt-ea-question"><b>${_plural(count, 'modification non enregistrée', 'modifications non enregistrées')}</b><small>Elles seront perdues si tu fermes maintenant.</small></div><span class="vtt-ea-grow"></span><button type="button" class="vtt-ea-btn text" data-ea-action="continue">Continuer</button><button type="button" class="vtt-ea-btn ghost" data-ea-action="discard-close">Quitter sans enregistrer</button><button type="button" class="vtt-ea-btn primary" data-ea-action="save-close" ${errors || state.saving ? 'disabled' : ''}>Enregistrer et fermer</button>`;
      return;
    }
    const parts = [_plural(count, 'modification')];
    if (pending) parts.push(`${_plural(pending, 'image')} à téléverser`);
    if (renamed.length) parts.push(`${_plural(renamed.length, 'renommée')}${renamed.every(item => item.keepOldName !== false) ? ', alias gardé' + (renamed.length > 1 ? 's' : '') : ''}`);
    footer.innerHTML = `${errors ? `<span class="vtt-ea-info error">${_plural(errors, 'nom à corriger')}</span>` : count ? `<span class="vtt-ea-info"><i></i>${parts.join(' · ')}</span>` : '<span class="vtt-ea-info">Tout est enregistré</span>'}${storageGauge()}<span class="vtt-ea-grow"></span><button type="button" class="vtt-ea-btn text" data-ea-action="undo" ${state.history.length ? '' : 'disabled'}>${_icon('undo')}Annuler</button>${count ? '<button type="button" class="vtt-ea-btn text" data-ea-action="reset">Tout rétablir</button>' : ''}<button type="button" class="vtt-ea-btn ghost" data-ea-action="close">Fermer</button><button type="button" class="vtt-ea-btn primary" data-ea-action="save" ${!count || errors || state.saving ? 'disabled' : ''}>${state.saving ? 'Enregistrement…' : 'Enregistrer'}</button>`;
  }

  function render() { renderTools(); renderGrid(); renderInspector(); renderFooter(); }

  function select(id, event = {}) {
    const ids = visible().map(item => item.id);
    if (event.shiftKey && state.anchor && ids.includes(state.anchor)) {
      const from = ids.indexOf(state.anchor), to = ids.indexOf(id);
      state.selected = new Set(ids.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else if (event.ctrlKey || event.metaKey) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      state.anchor = id;
    } else {
      state.selected = new Set([id]); state.anchor = id;
    }
    state.urlEditor = false;
    renderGrid(); renderInspector(); renderFooter();
  }

  async function prepareFile(file) {
    if (CLOUDINARY_ENABLED) {
      const url = URL.createObjectURL(file); state.objectUrls.add(url);
      return { url, _file: file, _bytes: file.size };
    }
    const url = await uploadPng(file, { max: 200 });
    return { url, _bytes: dataUrlBytes(url) || file.size };
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter(file => file.type?.startsWith('image/'));
    if (!files.length) return;
    showNotif('Préparation des images…', 'info', { history: false });
    try {
      const prepared = await Promise.all(files.map(async file => ({ file, prepared: await prepareFile(file) })));
      snapshot();
      const added = prepared.map(({ file, prepared: image }) => ({ id: _uid(), name: uniqueEmoteName(slugFromFile(file.name), state.draft), aliases: [], ...image }));
      state.draft.push(...added); state.selected = new Set(added.map(item => item.id)); state.anchor = added[0].id;
      state.query = ''; state.filter = 'all'; state.menu = false;
      render(); $('[data-ea-grid]').scrollTop = 1e6;
      showNotif(`${_plural(added.length, 'émote ajoutée', 'émotes ajoutées')} · renomme-les si besoin`, 'success', { action: { label: 'Annuler', onClick: undo } });
    } catch (error) { showNotif(`Impossible de préparer l’image : ${error.message}`, 'error'); }
  }

  async function replaceFile(file) {
    const item = one(); if (!item || !file?.type?.startsWith('image/')) return;
    try {
      const image = await prepareFile(file);
      mutate(() => { Object.assign(item, image); state.broken.delete(item.id); state.dimensions.delete(item.id); });
    } catch (error) { showNotif(`Impossible de remplacer l’image : ${error.message}`, 'error'); }
  }

  function addUrl() {
    const input = $('[data-ea-add-url]'); const url = input?.value.trim() || '';
    if (!/^https?:\/\//i.test(url)) return showNotif('URL invalide', 'error');
    const filename = url.split('/').pop()?.split('?')[0] || 'emote';
    mutate(() => {
      const item = { id: _uid(), name: uniqueEmoteName(slugFromFile(filename), state.draft), url, aliases: [] };
      state.draft.push(item); state.selected = new Set([item.id]); state.anchor = item.id;
      state.query = ''; state.filter = 'all'; state.menu = false;
    });
  }

  async function importGithub() {
    const input = $('[data-ea-github-path]'); const path = input?.value.trim() || '';
    if (!path) return;
    localStorage.setItem('vtt-emote-gh-folder', path);
    try {
      const files = await listGithubFolder(path, { exts: GH_IMAGE_EXTS });
      const { added, skipped } = dedupeEmoteImports(files, state.draft, { slugOf: file => slugFromFile(file.name), fileKeyOf: file => fileKey(file.url) });
      if (!added.length) return showNotif('Toutes ces émotes sont déjà présentes', 'info');
      mutate(() => {
        const items = added.map(item => ({ id: _uid(), name: item.name, url: item.url, aliases: [] }));
        state.draft.push(...items); state.selected = new Set(items.map(item => item.id)); state.anchor = items[0].id;
        state.query = ''; state.filter = 'all'; state.menu = false;
      });
      showNotif(`${_plural(added.length, 'émote importée', 'émotes importées')}${skipped ? ` · ${skipped} ignorée${skipped > 1 ? 's' : ''}` : ''}`, 'success', { action: { label: 'Annuler', onClick: undo } });
    } catch (error) { showNotif(error.message || 'Import GitHub impossible', 'error'); }
  }

  function removeSelected() {
    const ids = [...state.selected]; if (!ids.length) return;
    const items = state.draft.filter(item => state.selected.has(item.id));
    const used = items.reduce((sum, item) => sum + sentCount(item), 0);
    const label = ids.length === 1 ? `:${items[0].name}:` : _plural(ids.length, 'émote');
    const index = state.draft.findIndex(item => state.selected.has(item.id));
    mutate(() => {
      state.draft = state.draft.filter(item => !state.selected.has(item.id));
      const next = state.draft[Math.min(index, state.draft.length - 1)];
      state.selected = new Set(next ? [next.id] : []); state.anchor = next?.id || '';
    });
    showNotif(`${label} supprimée${ids.length > 1 ? 's' : ''}${used ? ' · les anciens messages afficheront le texte' : ''}`, 'info', { action: { label: 'Annuler', onClick: undo } });
  }

  function moveSelected(where) {
    mutate(() => {
      const selected = state.draft.filter(item => state.selected.has(item.id));
      const rest = state.draft.filter(item => !state.selected.has(item.id));
      state.draft = where === 'top' ? [...selected, ...rest] : [...rest, ...selected];
    });
    $('[data-ea-grid]').scrollTop = where === 'top' ? 0 : 1e6;
  }

  async function saveDraft({ closeAfter = false } = {}) {
    if (blocking().size || state.saving) return;
    state.saving = true; renderFooter();
    const working = _clone(state.draft);
    try {
      if (CLOUDINARY_ENABLED) {
        if (working.some(item => item._file) && !hasCloudinaryConfig()) throw new Error('Configuration Cloudinary requise avant l’enregistrement.');
        for (const item of working.filter(current => current._file)) {
          const folder = state.folder.trim() ? `emotes/${state.folder.trim()}` : 'emotes';
          const uploaded = await uploadCloudinary(item._file, { folder, tags: ['emote'] });
          item.url = uploaded.url; delete item._file;
        }
      }
      const final = finalizeEmoteDraft(working, state.saved);
      if (emoteCatalogIssues(final).size) throw new Error('Corrige les noms ou alias en conflit.');
      const ok = await save?.(final);
      if (ok === false) throw new Error('La sauvegarde Firestore a échoué.');
      state.saved = _clone(final); state.draft = _clone(final); state.history = []; state.saving = false; state.askClose = false;
      onSaved?.();
      showNotif('Émotes enregistrées', 'success');
      if (closeAfter) { destroy(); clearModalCloseGuard(); closeModalDirect(); } else render();
    } catch (error) {
      state.saving = false;
      showNotif(error.message || 'Enregistrement impossible', 'error');
      render();
    }
  }

  function requestClose() { closeModalDirect(); }
  function guardClose() {
    if (!dirty()) { destroy(); return false; }
    state.askClose = true; renderFooter(); return true;
  }

  function onClick(event) {
    const tile = event.target.closest('[data-ea-id]');
    const button = event.target.closest('button');
    if (state.menu && !event.target.closest('[data-ea-menu-wrap]')) { state.menu = false; renderTools(); }
    if (tile && !event.target.closest('[data-ea-action]')) { select(tile.dataset.eaId, event); return; }
    if (!button) return;
    if (button.dataset.eaFilter) { state.filter = button.dataset.eaFilter; render(); return; }
    if (button.dataset.eaMove) { moveSelected(button.dataset.eaMove); return; }
    if (button.dataset.eaRemoveAlias != null) {
      const item = one(); if (item) mutate(() => item.aliases.splice(Number(button.dataset.eaRemoveAlias), 1)); return;
    }
    const action = button.dataset.eaAction;
    if (!action) return;
    if (action === 'close') requestClose();
    else if (action === 'menu') { state.menu = !state.menu; renderTools(); }
    else if (action === 'pick') $('[data-ea-files]').click();
    else if (action === 'add-url') addUrl();
    else if (action === 'github') void importGithub();
    else if (action === 'replace') $('[data-ea-replace]').click();
    else if (action === 'url-editor') { state.urlEditor = true; renderInspector(); $('[data-ea-replace-url]')?.focus(); }
    else if (action === 'replace-url') {
      const item = one(), url = $('[data-ea-replace-url]')?.value.trim() || '';
      if (!item || !/^https?:\/\//i.test(url)) showNotif('URL invalide', 'error');
      else mutate(() => { item.url = url; delete item._file; delete item._bytes; state.broken.delete(item.id); state.dimensions.delete(item.id); state.urlEditor = false; });
    } else if (action === 'delete') removeSelected();
    else if (action === 'undo') undo();
    else if (action === 'reset') mutate(() => { state.draft = _clone(state.saved); state.selected = new Set(state.draft[0] ? [state.draft[0].id] : []); state.anchor = state.draft[0]?.id || ''; });
    else if (action === 'save') void saveDraft();
    else if (action === 'continue') { state.askClose = false; renderFooter(); }
    else if (action === 'discard-close') { state.draft = _clone(state.saved); destroy(); clearModalCloseGuard(); closeModalDirect(); }
    else if (action === 'save-close') void saveDraft({ closeAfter: true });
  }

  function onInput(event) {
    const target = event.target;
    if (target.matches('[data-ea-query]')) { state.query = target.value; renderGrid(); return; }
    if (target.matches('[data-ea-folder]')) {
      state.folder = sanitizeEmoteName(target.value).replace(/_/g, '-');
      localStorage.setItem('vtt-emote-folder', state.folder); renderFooter(); return;
    }
    if (target.matches('[data-ea-name]')) {
      const item = one(); if (!item) return;
      const value = sanitizeEmoteName(target.value);
      if (target.value !== value) { const caret = Math.max(0, (target.selectionStart || value.length) - (target.value.length - value.length)); target.value = value; target.setSelectionRange(caret, caret); }
      item.name = value;
      renderGrid(); renderFooter();
      const problem = blocking().get(item.id), warn = warning(item);
      target.closest('.vtt-ea-name-input')?.classList.toggle('invalid', !!problem);
      const help = $('[data-ea-name-help]');
      if (help) { help.className = `vtt-ea-help${problem ? ' error' : warn ? ' warning' : ''}`; help.textContent = problem || warn || 'Minuscules, chiffres et _ uniquement. Les accents et espaces sont convertis.'; }
      return;
    }
    if (target.matches('[data-ea-alias]')) target.value = sanitizeEmoteName(target.value);
  }

  function onChange(event) {
    const target = event.target;
    if (target.matches('[data-ea-files]')) { void addFiles(target.files); target.value = ''; }
    else if (target.matches('[data-ea-replace]')) { void replaceFile(target.files?.[0]); target.value = ''; }
    else if (target.matches('[data-ea-keep-old]')) { const item = one(); if (item) mutate(() => { item.keepOldName = target.checked; }); }
  }

  function onFocusIn(event) {
    if (event.target.matches('[data-ea-name]') && !state.typingName) { snapshot(); state.typingName = true; }
  }
  function onFocusOut(event) {
    if (event.target.matches('[data-ea-name]')) { state.typingName = false; renderInspector(); renderTools(); renderFooter(); }
  }

  function onKeyDown(event) {
    const field = event.target.matches('input,textarea,select,[contenteditable="true"]');
    if (event.target.matches('[data-ea-alias]') && event.key === 'Enter') {
      event.preventDefault(); const item = one(), alias = sanitizeEmoteName(event.target.value);
      if (item && alias && alias !== item.name && !item.aliases.includes(alias)) mutate(() => item.aliases.push(alias));
      $('[data-ea-alias]')?.focus(); return;
    }
    if (event.target.matches('[data-ea-name]') && event.key === 'Enter') { event.preventDefault(); event.target.blur(); return; }
    if (event.target.matches('[data-ea-add-url]') && event.key === 'Enter') { event.preventDefault(); addUrl(); return; }
    if (event.target.matches('[data-ea-github-path]') && event.key === 'Enter') { event.preventDefault(); void importGithub(); return; }
    if (event.target.matches('[data-ea-replace-url]') && event.key === 'Enter') { event.preventDefault(); $('[data-ea-action="replace-url"]')?.click(); return; }
    if (event.target.matches('[data-ea-query]') && event.key === 'Escape' && state.query) { state.query = ''; event.target.value = ''; renderGrid(); return; }
    if (field) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); state.selected = new Set(visible().map(item => item.id)); renderGrid(); renderInspector(); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selected.size) { event.preventDefault(); removeSelected(); return; }
    if (event.key === 'Escape') {
      if (state.menu) { state.menu = false; renderTools(); }
      else if (state.askClose) { state.askClose = false; renderFooter(); }
      else if (state.selected.size) { state.selected.clear(); renderGrid(); renderInspector(); }
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const list = visible(); let index = list.findIndex(item => item.id === state.anchor);
      index = Math.max(0, Math.min(list.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      const next = list[index]; if (next) { select(next.id, event.shiftKey ? { shiftKey: true } : {}); root.querySelector(`[data-ea-id="${CSS.escape(next.id)}"]`)?.focus(); }
    }
  }

  function onDragStart(event) {
    const tile = event.target.closest('[data-ea-id]');
    if (!tile || locked()) { event.preventDefault(); return; }
    state.dragId = tile.dataset.eaId;
    if (!state.selected.has(state.dragId)) { state.selected = new Set([state.dragId]); state.anchor = state.dragId; renderInspector(); }
    tile.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', state.dragId);
  }
  function onDragOver(event) {
    const hasFiles = [...(event.dataTransfer?.types || [])].includes('Files');
    if (hasFiles) { event.preventDefault(); return; }
    if (!state.dragId) return;
    event.preventDefault();
    root.querySelectorAll('.is-over').forEach(tile => tile.classList.remove('is-over'));
    const tile = event.target.closest('[data-ea-id]');
    if (tile && !state.selected.has(tile.dataset.eaId)) tile.classList.add('is-over');
  }
  function onDrop(event) {
    const hasFiles = [...(event.dataTransfer?.types || [])].includes('Files');
    if (hasFiles) {
      event.preventDefault(); state.dragDepth = 0; $('[data-ea-drop]').classList.remove('is-visible');
      const files = event.dataTransfer.files;
      if (event.target.closest('[data-ea-stage]') && one() && files.length === 1) void replaceFile(files[0]); else void addFiles(files);
      return;
    }
    if (!state.dragId) return;
    event.preventDefault();
    const target = event.target.closest('[data-ea-id]'); state.dragId = '';
    if (!target || state.selected.has(target.dataset.eaId)) { renderGrid(); return; }
    mutate(() => {
      const selected = state.draft.filter(item => state.selected.has(item.id));
      const rest = state.draft.filter(item => !state.selected.has(item.id));
      const index = rest.findIndex(item => item.id === target.dataset.eaId);
      rest.splice(Math.max(0, index), 0, ...selected); state.draft = rest;
    });
  }
  function onDragEnd() { state.dragId = ''; root.querySelectorAll('.is-dragging,.is-over').forEach(tile => tile.classList.remove('is-dragging', 'is-over')); }
  function onDragEnter(event) {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    state.dragDepth += 1; $('[data-ea-drop]').classList.add('is-visible');
  }
  function onDragLeave(event) {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    state.dragDepth -= 1;
    if (state.dragDepth <= 0) { state.dragDepth = 0; $('[data-ea-drop]').classList.remove('is-visible'); }
  }
  function onImageLoad(event) {
    const image = event.target.closest?.('[data-ea-image]'); if (!image) return;
    const known = state.dimensions.has(image.dataset.eaImage);
    state.broken.delete(image.dataset.eaImage);
    state.dimensions.set(image.dataset.eaImage, { width: image.naturalWidth, height: image.naturalHeight });
    if (!known && state.selected.has(image.dataset.eaImage)) renderInspector();
  }
  function onImageError(event) {
    const image = event.target.closest?.('[data-ea-image]'); if (!image || state.broken.has(image.dataset.eaImage)) return;
    state.broken.add(image.dataset.eaImage); renderGrid(); renderInspector(); renderFooter();
  }

  function destroy() {
    if (_destroyActive !== destroy) return;
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('dragstart', onDragStart);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('drop', onDrop);
    root.removeEventListener('dragend', onDragEnd);
    root.removeEventListener('dragenter', onDragEnter);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('load', onImageLoad, true);
    root.removeEventListener('error', onImageError, true);
    document.removeEventListener('app:modal-closed', destroy);
    state.objectUrls.forEach(url => URL.revokeObjectURL(url));
    clearModalCloseGuard(); _destroyActive = null;
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragend', onDragEnd);
  root.addEventListener('dragenter', onDragEnter);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('load', onImageLoad, true);
  root.addEventListener('error', onImageError, true);
  document.addEventListener('app:modal-closed', destroy);
  setModalCloseGuard(guardClose); _destroyActive = destroy;
  render();
}
