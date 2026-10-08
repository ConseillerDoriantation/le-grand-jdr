import { registerActions } from '../core/actions.js';
import { openModal, closeModalDirect, setModalCloseGuard } from './modal.js';
import { showNotif } from './notifications.js';
import { _esc } from './html.js';
import { makeSortable } from './sortable-helper.js';
import { catalogAutoPlural, catalogCloseColors, catalogItemErrors } from './catalog-admin-utils.js';

let _state = null;
let _sortable = null;
let _idCounter = 0;

const _clone = value => JSON.parse(JSON.stringify(value));
const _countLabel = (count, words) => `${count} ${count > 1 ? words[1] : words[0]}`;
function _firstGrapheme(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)][0]?.segment || '';
  } catch {
    return [...text][0] || '';
  }
}

function _current() {
  return _state?.draft.find(item => item.id === _state.selected) || _state?.draft[0] || null;
}

function _isDirty() {
  return Boolean(_state) && JSON.stringify(_state.draft) !== JSON.stringify(_state.saved);
}

function _allErrors() {
  if (!_state?.draft.length) return [{ empty: true }];
  return _state.draft.filter(item => catalogItemErrors(_state.draft, item).length);
}

function _fieldStatus(item, index) {
  const errors = catalogItemErrors(_state.draft, item);
  if (errors.includes('name')) return ['Nom requis', 'error'];
  if (errors.includes('duplicate')) return ['Nom déjà pris', 'error'];
  if (index === 0) return ['Par défaut', 'default'];
  return ['', ''];
}

function _derivedColor(item, color) {
  item.color = color;
  _state.config.setColor?.(item, color);
}

function _destroySortable() {
  try { _sortable?.destroy?.(); } catch {}
  _sortable = null;
}

function _mountSortable() {
  _destroySortable();
  const list = document.getElementById('rka-list');
  if (!list) return;
  _sortable = makeSortable(list, {
    prefix: 'rka',
    draggable: '.rka-row',
    handle: '.rka-grip',
    filter: 'button, input, select',
    onEnd: () => {
      const ids = [...list.querySelectorAll('.rka-row[data-id]')].map(row => row.dataset.id);
      if (ids.length !== _state.draft.length) return _render();
      const byId = new Map(_state.draft.map(item => [item.id, item]));
      _state.draft = ids.map(id => byId.get(id)).filter(Boolean);
      _render();
    },
  });
}

function _popoverHtml(item) {
  const config = _state.config;
  const emoji = config.emoji ? `
    <div class="rka-pop-row"><input class="rka-emoji-input" data-input="_rkaEmojiInput" placeholder="Colle un emoji…" aria-label="Coller un emoji"></div>
    <div class="rka-emojis">${(config.emojis || []).map(value => `<button type="button" class="${value === item.emoji ? 'on' : ''}" data-action="_rkaEmoji" data-value="${_esc(value)}">${_esc(value)}</button>`).join('')}</div>
    <span class="rka-mini-label">Couleur</span>` : '';
  const current = String(item.color || '').toLowerCase();
  const inPalette = config.palette.some(color => color.toLowerCase() === current);
  return `<div class="rka-pop">${emoji}<div class="rka-palette">${config.palette.map(color => `
    <button type="button" class="rka-swatch${color.toLowerCase() === current ? ' on' : ''}" style="--c:${color}" data-action="_rkaColor" data-color="${color}" aria-label="Couleur ${color}"></button>`).join('')}
    <label class="rka-swatch custom${inPalette ? '' : ' on'}" style="--c:${_esc(item.color)}" title="Couleur personnalisée"><input type="color" value="${_esc(item.color)}" data-input="_rkaCustomColor" data-change="_rkaCustomColorCommit" aria-label="Couleur personnalisée"></label>
  </div></div>`;
}

function _rowHtml(item, index) {
  const config = _state.config;
  const [status, tone] = _fieldStatus(item, index);
  const selected = item.id === _state.selected;
  const pop = item.id === _state.pop;
  const count = _state.counts[item.id] || 0;
  const plural = config.plural ? `
    <span class="rka-field rka-plural"><input value="${_esc(item.plural || '')}" data-input="_rkaField" data-id="${_esc(item.id)}" data-field="plural" maxlength="32" placeholder="${_esc(catalogAutoPlural(item.label) || 'Pluriel')}" aria-label="Libellé des filtres"><small>${item.plural ? 'Filtre' : 'Filtre · auto'}</small></span>` : '';
  return `<article class="rka-row${selected ? ' on' : ''}${tone === 'error' ? ' bad' : ''}" style="--c:${_esc(item.color)}" data-action="_rkaSelect" data-id="${_esc(item.id)}">
    <button type="button" class="rka-grip" title="Glisser pour réordonner" aria-label="Réordonner">⠿</button>
    <span class="rka-pop-wrap"><button type="button" class="rka-token" data-action="_rkaPop" data-id="${_esc(item.id)}" aria-expanded="${pop}" title="${config.emoji ? 'Icône et couleur' : 'Couleur'}">${config.emoji ? (_esc(item.emoji) || '<i class="placeholder">+</i>') : '<i></i>'}</button>${pop ? _popoverHtml(item) : ''}</span>
    <span class="rka-field"><input class="${tone === 'error' ? 'bad' : ''}" value="${_esc(item.label || '')}" data-input="_rkaField" data-id="${_esc(item.id)}" data-field="label" maxlength="32" placeholder="Nom ${config.fem ? 'de la catégorie' : 'du rang'}" aria-label="Nom"><small class="${tone === 'error' ? 'error' : ''}">${status}</small></span>
    ${plural}
    <span class="rka-count" title="${_esc(_countLabel(count, config.item))}">${count}</span>
    <span class="rka-actions">
      <button type="button" data-action="_rkaMove" data-id="${_esc(item.id)}" data-dir="-1" ${index === 0 ? 'disabled' : ''} title="Monter" aria-label="Monter">↑</button>
      <button type="button" data-action="_rkaMove" data-id="${_esc(item.id)}" data-dir="1" ${index === _state.draft.length - 1 ? 'disabled' : ''} title="Descendre" aria-label="Descendre">↓</button>
      <button type="button" class="delete" data-action="_rkaDelete" data-id="${_esc(item.id)}" ${_state.draft.length <= 1 ? `disabled title="Il faut au moins ${config.fem ? 'une' : 'un'} ${config.noun[0]}"` : 'title="Supprimer"'} aria-label="Supprimer">×</button>
    </span>
  </article>`;
}

function _mainHtml() {
  const config = _state.config;
  const closePairs = catalogCloseColors(_state.draft);
  const cols = config.plural
    ? '18px 34px minmax(0,1fr) minmax(0,1fr) 44px 104px'
    : '18px 34px minmax(0,1fr) 44px 104px';
  const warning = closePairs.length
    ? `<div class="rka-warning">Couleurs très proches : ${closePairs.map(([left, right]) => `${_esc(left.label || 'Sans nom')} et ${_esc(right.label || 'Sans nom')}`).join(' · ')}. Difficile à distinguer dans les filtres.</div>`
    : '';
  return `<section class="rka-section"><div class="rka-section-head"><span class="rka-label">${_esc(config.noun[1][0].toUpperCase() + config.noun[1].slice(1))} · ${_state.draft.length}</span><span class="rka-spacer"></span><span class="rka-hint">L’ordre est celui des filtres. ${_esc(config.defaultNote)}</span></div>
    <div class="rka-list" id="rka-list" style="--cols:${cols}"><div class="rka-list-head"><span></span><span></span><span>Nom affiché</span>${config.plural ? '<span class="rka-plural-head">Libellé des filtres</span>' : ''}<span title="Nombre d’éléments">Util.</span><span></span></div>${_state.draft.map(_rowHtml).join('')}</div>
    <button type="button" class="rka-add" data-action="_rkaAdd">＋ Ajouter ${config.fem ? 'une' : 'un'} ${_esc(config.noun[0])}</button>${warning}</section>`;
}

function _sampleHtml(item) {
  const config = _state.config;
  const sample = config.sample?.() || {};
  if (config.kind === 'bestiary') {
    const portrait = sample.image
      ? `<img src="${_esc(sample.image)}" alt="" loading="lazy">`
      : '<i>Portrait</i>';
    return `<div class="rka-card bestiary" style="--c:${_esc(item.color)}"><div class="rka-card-image">${portrait}<span class="rka-card-badge">${_esc(item.label || '…')}</span></div><div class="rka-card-body"><b>${_esc(sample.title || 'Créature du bestiaire')}</b><small>${_esc(sample.subtitle || 'Type · Environnement')}</small><small class="mono">${_esc(sample.meta || 'PV — · CA — · FP —')}</small></div></div>`;
  }
  return `<div class="rka-card achievement" style="--c:${_esc(item.color)}"><div class="rka-card-body"><span class="rka-card-badge">${_esc(item.emoji || '🏆')} ${_esc(item.label || '…')}</span><b>${_esc(sample.title || 'Un haut-fait mémorable')}</b><small>${_esc(sample.subtitle || 'Description du haut-fait.')}</small><small>${_esc(sample.meta || 'Session · Personnages')}</small></div></div>`;
}

function _previewHtml() {
  const config = _state.config;
  const current = _current();
  if (!current) return '<div class="rka-empty">Ajoute un élément pour afficher son aperçu.</div>';
  const total = Object.values(_state.counts).reduce((sum, count) => sum + count, 0);
  const filterLabel = item => config.plural ? (item.plural || catalogAutoPlural(item.label)) : item.label;
  const filters = _state.draft.map(item => `<button type="button" class="rka-filter${item.id === current.id ? ' on' : ''}" style="--c:${_esc(item.color)}" data-action="_rkaSelect" data-id="${_esc(item.id)}">${config.emoji ? `${_esc(item.emoji)} ` : '<i></i>'}${_esc(filterLabel(item) || '…')} <em>${_state.counts[item.id] || 0}</em></button>`).join('');
  const picker = _state.draft.map((item, index) => `<button type="button" class="rka-picker${item.id === current.id ? ' on' : ''}" style="--c:${_esc(item.color)}" data-action="_rkaSelect" data-id="${_esc(item.id)}">${config.emoji ? `${_esc(item.emoji)} ` : ''}${_esc(item.label || '…')}${index === 0 ? '<sup>défaut</sup>' : ''}</button>`).join('');
  return `<h3>Aperçu joueur</h3><p>Tel qu’affiché dans ${config.kind === 'bestiary' ? 'le bestiaire' : 'la galerie des hauts-faits'}. Clique sur un filtre pour le sélectionner.</p>
    <section><span class="rka-label">Filtres</span><div class="rka-filters"><span class="rka-filter all">${_esc(config.all)} <em>${total}</em></span>${filters}</div></section>
    <section><span class="rka-label">Carte</span>${_sampleHtml(current)}</section>
    <section><span class="rka-label">${config.kind === 'bestiary' ? 'Fiche créature' : 'Création d’un haut-fait'}</span><div class="rka-pickers">${picker}</div></section>`;
}

function _footerHtml() {
  const config = _state.config;
  if (_state.ask === 'close') return `<span class="rka-ask">Abandonner les modifications ?</span><span class="rka-spacer"></span><button type="button" class="rka-btn text" data-action="_rkaKeep">Continuer l’édition</button><button type="button" class="rka-btn ghost" data-action="_rkaDiscard">Abandonner</button>`;
  if (_state.ask) {
    const item = _state.draft.find(entry => entry.id === _state.ask);
    if (!item) { _state.ask = null; return _footerHtml(); }
    const count = _state.counts[item.id] || 0;
    const others = _state.draft.filter(entry => entry.id !== item.id);
    const usage = count
      ? `${_countLabel(count, config.item)} ${count > 1 ? 'basculeront' : 'basculera'} vers :`
      : `${config.itemFem ? 'Aucune' : 'Aucun'} ${config.item[0]} ne l’utilise.`;
    return `<span class="rka-ask">Supprimer « ${_esc(item.label || 'Sans nom')} » ?<small>${usage}</small></span><span class="rka-spacer"></span>${count ? `<select class="rka-select" data-change="_rkaReplacement" aria-label="Remplacement">${others.map(entry => `<option value="${_esc(entry.id)}" ${entry.id === _state.replacement ? 'selected' : ''}>${config.emoji ? `${_esc(entry.emoji)} ` : ''}${_esc(entry.label || 'Sans nom')}</option>`).join('')}</select>` : ''}<button type="button" class="rka-btn text" data-action="_rkaKeep">Annuler</button><button type="button" class="rka-btn danger" data-action="_rkaDeleteConfirm">Supprimer</button>`;
  }
  const errors = _allErrors();
  const dirty = _isDirty();
  const info = errors.length
    ? `<span class="rka-info error">${_state.draft.length ? `${_countLabel(errors.length, config.noun)} à corriger` : `Ajoute au moins ${config.fem ? 'une' : 'un'} ${_esc(config.noun[0])}`}</span>`
    : dirty
      ? '<span class="rka-info"><i></i>Modifications non enregistrées</span>'
      : '<span class="rka-info">À jour</span>';
  return `${info}<span class="rka-spacer"></span><button type="button" class="rka-btn text" data-action="_rkaRevert" ${dirty ? '' : 'disabled'}>↶ Annuler les modifications</button><button type="button" class="rka-btn primary" data-action="_rkaSave" ${dirty && !errors.length && !_state.saving ? '' : 'disabled'}>${_state.saving ? 'Enregistrement…' : 'Enregistrer'}</button>`;
}

function _renderMain() {
  const main = document.getElementById('rka-main');
  if (main) main.innerHTML = _mainHtml();
  _mountSortable();
}
function _renderPreview() { const preview = document.getElementById('rka-preview'); if (preview) preview.innerHTML = _previewHtml(); }
function _renderFooter() { const footer = document.getElementById('rka-footer'); if (footer) footer.innerHTML = _footerHtml(); }
function _render() { _renderMain(); _renderPreview(); _renderFooter(); }

function _syncRows() {
  if (!_state) return;
  _state.draft.forEach((item, index) => {
    const row = document.querySelector(`.rka-row[data-id="${CSS.escape(item.id)}"]`);
    if (!row) return;
    const [status, tone] = _fieldStatus(item, index);
    row.classList.toggle('bad', tone === 'error');
    const input = row.querySelector('[data-field="label"]');
    const small = input?.nextElementSibling;
    input?.classList.toggle('bad', tone === 'error');
    if (small) { small.textContent = status; small.classList.toggle('error', tone === 'error'); }
    const plural = row.querySelector('[data-field="plural"]');
    if (plural) plural.placeholder = catalogAutoPlural(item.label) || 'Pluriel';
  });
  _renderPreview();
  _renderFooter();
}

function _select(id) {
  if (!_state?.draft.some(item => item.id === id)) return;
  _state.selected = id;
  document.querySelectorAll('.rka-row[data-id]').forEach(row => row.classList.toggle('on', row.dataset.id === id));
  _renderPreview();
}

function _closePopoverDom() {
  if (!_state?.pop) return;
  _state.pop = null;
  document.querySelector('.rka-pop')?.remove();
  document.querySelectorAll('.rka-token[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function _requestClose() {
  closeModalDirect();
}

function _guardClose() {
  if (!_state || !document.querySelector('.rka')) return false;
  if (_state.ask) return true;
  if (_isDirty()) {
    _state.ask = 'close';
    _renderFooter();
    return true;
  }
  return false;
}

function _cleanup() {
  _destroySortable();
  setModalCloseGuard(null);
  _state = null;
}

async function _save() {
  if (!_state || _state.saving || _allErrors().length || !_isDirty()) return;
  _state.saving = true;
  _renderFooter();
  try {
    const saved = await _state.config.save(_clone(_state.draft));
    if (_state.reassign.length) await _state.config.reassign?.(_clone(_state.reassign));
    _state.saved = _clone(saved || _state.draft);
    _state.draft = _clone(_state.saved);
    _state.reassign = [];
    _state.selected = _state.draft.some(item => item.id === _state.selected) ? _state.selected : _state.draft[0]?.id;
    const refreshedCounts = await _state.config.count(_state.saved, _state.saved[0]?.id);
    _state.counts = { ...(refreshedCounts || {}) };
    _state.countsOriginal = { ..._state.counts };
    await _state.config.afterSave?.();
    showNotif(`${_state.config.noun[1][0].toUpperCase() + _state.config.noun[1].slice(1)} enregistré${_state.config.fem ? 'e' : ''}s.`, 'success');
    _render();
  } catch (error) {
    _state.config.onError?.(error);
    if (!_state.config.onError) showNotif(error?.message || 'Erreur lors de l’enregistrement.', 'error');
  } finally {
    if (_state) { _state.saving = false; _renderFooter(); }
  }
}

function _confirmDelete() {
  const item = _state?.draft.find(entry => entry.id === _state.ask);
  if (!item || _state.draft.length <= 1) return;
  const target = _state.draft.find(entry => entry.id === _state.replacement && entry.id !== item.id)
    || _state.draft.find(entry => entry.id !== item.id);
  const count = _state.counts[item.id] || 0;
  const directCount = _state.countsOriginal[item.id] || 0;
  if (count && !target) return;
  if (target) {
    _state.reassign.forEach(change => { if (change.to === item.id) change.to = target.id; });
    if (directCount) {
      const existing = _state.reassign.find(change => change.from === item.id);
      if (existing) existing.to = target.id;
      else _state.reassign.push({ from: item.id, to: target.id });
    }
    _state.counts[target.id] = (_state.counts[target.id] || 0) + count;
  }
  delete _state.counts[item.id];
  const index = _state.draft.indexOf(item);
  _state.draft.splice(index, 1);
  _state.selected = (_state.draft[index] || _state.draft[index - 1])?.id || '';
  _state.ask = null;
  _state.replacement = '';
  _render();
  showNotif(count && target
    ? `${_countLabel(count, _state.config.item)} ${count > 1 ? 'basculeront' : 'basculera'} vers ${target.label} à l’enregistrement.`
    : `« ${item.label || 'Sans nom'} » supprimé${_state.config.fem ? 'e' : ''} du brouillon.`, 'info');
}

registerActions({
  _rkaClose: _requestClose,
  _rkaSelect: element => _select(element.dataset.id),
  _rkaPop: element => {
    const id = element.dataset.id;
    _state.selected = id;
    _state.pop = _state.pop === id ? null : id;
    _renderMain(); _renderPreview();
    if (_state.pop) document.querySelector('.rka-emoji-input')?.focus();
  },
  _rkaField: element => {
    const item = _state?.draft.find(entry => entry.id === element.dataset.id);
    if (!item || !['label', 'plural'].includes(element.dataset.field)) return;
    item[element.dataset.field] = element.value;
    _state.selected = item.id;
    if (element.dataset.field === 'plural') {
      const small = element.nextElementSibling;
      if (small) small.textContent = element.value ? 'Filtre' : 'Filtre · auto';
    }
    _syncRows();
  },
  _rkaEmojiInput: element => {
    const value = _firstGrapheme(element.value);
    const item = _current();
    if (!item || !value) return;
    item.emoji = value;
    _state.pop = null;
    _render();
  },
  _rkaEmoji: element => { const item = _current(); if (item) { item.emoji = _firstGrapheme(element.dataset.value); _state.pop = null; _render(); } },
  _rkaColor: element => { const item = _current(); if (item) { _derivedColor(item, element.dataset.color); _state.pop = null; _render(); } },
  _rkaCustomColor: element => {
    const item = _current();
    if (!item) return;
    _derivedColor(item, element.value);
    document.querySelector(`.rka-row[data-id="${CSS.escape(item.id)}"]`)?.style.setProperty('--c', item.color);
    _renderPreview(); _renderFooter();
  },
  _rkaCustomColorCommit: () => { _state.pop = null; _render(); },
  _rkaAdd: () => {
    const config = _state.config;
    const id = `${config.idPrefix}${Date.now()}_${++_idCounter}`;
    const item = { id, label: '', color: config.palette[_state.draft.length % config.palette.length], enabled: true };
    if (config.emoji) item.emoji = config.emojis[(_state.draft.length + 3) % config.emojis.length] || '🏆';
    if (config.plural) item.plural = '';
    _derivedColor(item, item.color);
    _state.draft.push(item);
    _state.counts[id] = 0;
    _state.selected = id;
    _render();
    document.querySelector(`.rka-row[data-id="${CSS.escape(id)}"] [data-field="label"]`)?.focus();
  },
  _rkaMove: element => {
    const from = _state.draft.findIndex(item => item.id === element.dataset.id);
    const to = from + Number(element.dataset.dir || 0);
    if (from < 0 || to < 0 || to >= _state.draft.length) return;
    [_state.draft[from], _state.draft[to]] = [_state.draft[to], _state.draft[from]];
    _render();
  },
  _rkaDelete: element => {
    if (_state.draft.length <= 1) return;
    _state.ask = element.dataset.id;
    _state.selected = element.dataset.id;
    _state.replacement = _state.draft.find(item => item.id !== element.dataset.id)?.id || '';
    _select(_state.selected);
    _renderFooter();
  },
  _rkaReplacement: element => { _state.replacement = element.value; },
  _rkaDeleteConfirm: _confirmDelete,
  _rkaKeep: () => { _state.ask = null; _renderFooter(); },
  _rkaRevert: () => {
    _state.draft = _clone(_state.saved);
    _state.counts = { ..._state.countsOriginal };
    _state.reassign = [];
    _state.ask = null;
    _state.pop = null;
    if (!_state.draft.some(item => item.id === _state.selected)) _state.selected = _state.draft[0]?.id || '';
    _render();
  },
  _rkaSave: _save,
  _rkaDiscard: () => {
    setModalCloseGuard(null);
    _cleanup();
    closeModalDirect();
  },
});

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', event => {
    if (_state?.pop && document.querySelector('.rka') && !event.target.closest('.rka-pop-wrap')) _closePopoverDom();
  }, true);
  document.addEventListener('keydown', event => {
    if (!_state || !document.querySelector('.rka') || event.key !== 'Escape') return;
    if (_state.pop) {
      event.preventDefault(); event.stopImmediatePropagation(); _closePopoverDom();
    } else if (_state.ask) {
      event.preventDefault(); event.stopImmediatePropagation(); _state.ask = null; _renderFooter();
    }
  }, true);
  document.addEventListener('app:modal-closed', () => {
    if (_state && !document.getElementById('modal-overlay')?.classList.contains('show')) _cleanup();
  });
}

export async function openCatalogAdmin(config) {
  _cleanup();
  const items = _clone(await config.load());
  const counts = await config.count(items, items[0]?.id);
  _state = {
    config,
    saved: items,
    draft: _clone(items),
    counts: { ...(counts || {}) },
    countsOriginal: { ...(counts || {}) },
    selected: items[0]?.id || '',
    pop: null,
    ask: null,
    replacement: '',
    reassign: [],
    saving: false,
  };
  openModal('', `<div class="rka" style="--rka-accent:${_esc(config.accent || config.palette[0])}"><header class="rka-head"><span class="rka-head-icon">${_esc(config.icon)}</span><div><h2>${_esc(config.title)}</h2><small>${_esc(config.sub)}</small></div><span class="rka-spacer"></span><button type="button" class="rka-close" data-action="_rkaClose" aria-label="Fermer">×</button></header><div class="rka-body"><main class="rka-main" id="rka-main">${_mainHtml()}</main><aside class="rka-preview" id="rka-preview">${_previewHtml()}</aside></div><footer class="rka-footer" id="rka-footer">${_footerHtml()}</footer></div>`);
  setModalCloseGuard(_guardClose);
  _mountSortable();
}
