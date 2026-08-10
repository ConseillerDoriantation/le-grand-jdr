import { initPagePreferences } from './page-preferences.js';
import {
  clearAutomaticModalCloseGuard,
  closeModalDirect,
  confirmModal,
  openModal,
  setAutomaticModalCloseGuard,
} from './modal.js';
import {
  clearNotificationHistory,
  getNotificationHistory,
  getUnreadNotificationCount,
  markNotificationsRead,
} from './notifications.js';
import { STATE } from '../core/state.js';
import { lsJson } from './local-storage.js';

let _initialized = false;
let _onlineTimer = null;

function _mountNetworkStatus() {
  const status = document.createElement('div');
  status.id = 'global-network-status';
  status.className = 'global-network-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  document.body.appendChild(status);

  const render = (online, announce = true) => {
    clearTimeout(_onlineTimer);
    status.className = `global-network-status ${online ? 'is-online' : 'is-offline'} is-visible`;
    status.innerHTML = online
      ? '<span class="global-network-dot"></span><strong>Connexion rétablie</strong><span>Les sauvegardes peuvent reprendre.</span>'
      : '<span class="global-network-dot"></span><strong>Hors connexion</strong><span>Les modifications seront synchronisées au retour du réseau.</span>';
    if (!announce) status.setAttribute('aria-live', 'off');
    else status.setAttribute('aria-live', 'polite');
    if (online) _onlineTimer = setTimeout(() => status.classList.remove('is-visible'), 2600);
  };

  window.addEventListener('offline', () => render(false));
  window.addEventListener('online', () => render(true));
  if (!navigator.onLine) render(false, false);
}

function _mountBackToTop() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'global-back-top';
  button.setAttribute('aria-label', 'Revenir en haut de la page');
  button.title = 'Revenir en haut';
  button.innerHTML = '<span aria-hidden="true">↑</span>';
  document.body.appendChild(button);

  const update = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const modalOpen = document.getElementById('modal-overlay')?.classList.contains('show');
    button.classList.toggle('is-visible', y > 700 && !modalOpen);
  };
  let scheduled = false;
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  }, { passive: true });
  document.addEventListener('click', () => requestAnimationFrame(update));
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    document.getElementById('main-content')?.scrollTo?.({ top: 0, left: 0, behavior: 'smooth' });
  });
  update();
}

function _notificationTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function _mountNotificationHistory() {
  const profile = document.getElementById('sidebar-profile');
  if (!profile || document.getElementById('global-notification-toggle')) return;

  const button = document.createElement('button');
  button.id = 'global-notification-toggle';
  button.type = 'button';
  button.className = 'btn-theme sidebar-theme-btn global-notification-toggle';
  button.title = 'Notifications récentes';
  button.setAttribute('aria-label', 'Afficher les notifications récentes');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span aria-hidden="true">🔔</span><span class="global-notification-count" hidden></span>';
  const logout = profile.querySelector('.sidebar-profile-logout');
  profile.insertBefore(button, logout);

  const panel = document.createElement('aside');
  panel.id = 'global-notification-panel';
  panel.className = 'global-notification-panel';
  panel.setAttribute('aria-label', 'Notifications récentes');
  document.body.appendChild(panel);

  const render = () => {
    const history = getNotificationHistory();
    const unread = getUnreadNotificationCount();
    const count = button.querySelector('.global-notification-count');
    if (count) {
      count.textContent = String(Math.min(unread, 99));
      count.hidden = unread === 0;
    }
    button.title = unread ? `Notifications récentes — ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications récentes';
    panel.replaceChildren();

    const header = document.createElement('header');
    header.className = 'global-notification-head';
    const title = document.createElement('div');
    title.innerHTML = '<strong>Notifications</strong><small>Activité récente de cette aventure</small>';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'global-notification-clear';
    clear.textContent = 'Tout effacer';
    clear.hidden = history.length === 0;
    clear.addEventListener('click', clearNotificationHistory);
    header.append(title, clear);
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'global-notification-list';
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'global-notification-empty';
      empty.innerHTML = '<span aria-hidden="true">✓</span><strong>Rien à signaler</strong><small>Les prochains retours utiles apparaîtront ici.</small>';
      list.appendChild(empty);
    } else {
      for (const item of history) {
        const row = document.createElement('article');
        row.className = `global-notification-item is-${item.type || 'info'}`;
        const marker = document.createElement('span');
        marker.className = 'global-notification-marker';
        marker.textContent = item.type === 'error' ? '!' : item.type === 'warning' ? '⚠' : item.type === 'success' ? '✓' : 'i';
        const content = document.createElement('div');
        const message = document.createElement('p');
        message.textContent = item.message;
        const time = document.createElement('time');
        time.dateTime = new Date(item.at).toISOString();
        time.textContent = _notificationTime(item.at);
        content.append(message, time);
        row.append(marker, content);
        list.appendChild(row);
      }
    }
    panel.appendChild(list);
  };

  const close = () => {
    panel.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = panel.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      markNotificationsRead();
    }
  });
  panel.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  document.addEventListener('app:notifications-changed', render);
  document.addEventListener('app:adventure-changed', () => {
    close();
    render();
  });
  render();
}

function _isVisible(el) {
  return !!(el && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
}

function _modalSaveTarget(modal) {
  const explicit = [...modal.querySelectorAll('[data-free-page-save], [data-modal-save], [data-action]')]
    .find(el => _isVisible(el) && /save|enregistr|sauvegard/i.test(`${el.dataset.action || ''} ${el.textContent || ''}`));
  if (explicit) return explicit;
  return [...modal.querySelectorAll('button[type="submit"], input[type="submit"]')].find(_isVisible) || null;
}

function _modalStatusElement() {
  const title = document.getElementById('modal-title');
  if (!title) return null;
  let status = title.querySelector('.global-modal-edit-status');
  if (!status) {
    status = document.createElement('span');
    status.className = 'global-modal-edit-status';
    status.setAttribute('role', 'status');
    title.insertBefore(status, title.querySelector('.btn-icon, button:last-child'));
  }
  return status;
}

function _setModalEditStatus(state, label) {
  const status = _modalStatusElement();
  if (!status) return;
  status.className = `global-modal-edit-status${state ? ` is-${state}` : ''}`;
  status.textContent = label || '';
  status.hidden = !label;
}

function _initModalDirtyGuard() {
  let dirty = false;
  let confirming = false;
  let pendingSaveElement = null;

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  const clear = () => {
    dirty = false;
    confirming = false;
    clearAutomaticModalCloseGuard();
    _setModalEditStatus('', '');
  };

  const arm = () => {
    if (dirty) return;
    dirty = true;
    _setModalEditStatus('dirty', 'À enregistrer');
    setAutomaticModalCloseGuard(() => {
      if (!dirty || confirming) return confirming;
      confirming = true;
      confirmModal(
        'Des modifications ne sont pas enregistrées. Voulez-vous vraiment fermer cette fenêtre ?',
        {
          title: 'Modifications non enregistrées',
          confirmLabel: 'Fermer sans enregistrer',
          cancelLabel: 'Continuer la modification',
          danger: true,
          icon: '⚠️',
        }
      ).then((leave) => {
        confirming = false;
        if (!leave) return;
        document.dispatchEvent(new CustomEvent('app:modal-draft-discard'));
        clear();
        closeModalDirect();
      });
      return true;
    });
  };

  document.addEventListener('input', (event) => {
    const overlay = document.getElementById('modal-overlay');
    const target = event.target;
    if (!event.isTrusted || !overlay?.classList.contains('show') || !target?.closest?.('#modal-body')) return;
    if (target.matches?.(LOCAL_SEARCH_SELECTOR) || target.dataset.noDirtyGuard !== undefined) return;
    if (!_modalSaveTarget(overlay)) return;
    arm();
  }, true);

  document.addEventListener('change', (event) => {
    const overlay = document.getElementById('modal-overlay');
    const target = event.target;
    if (!event.isTrusted || !overlay?.classList.contains('show') || !target?.closest?.('#modal-body')) return;
    if (target.matches?.(LOCAL_SEARCH_SELECTOR) || target.dataset.noDirtyGuard !== undefined) return;
    if (!_modalSaveTarget(overlay)) return;
    arm();
  }, true);

  document.addEventListener('click', (event) => {
    const overlay = document.getElementById('modal-overlay');
    if (!dirty || !overlay?.classList.contains('show')) return;
    const save = _modalSaveTarget(overlay);
    if (!save || !event.target.closest?.('button, input[type="submit"]')?.isSameNode(save)) return;
    pendingSaveElement = save;
    _setModalEditStatus('saving', 'Enregistrement…');
  }, true);

  document.addEventListener('app:action-settled', (event) => {
    if (!pendingSaveElement || event.detail?.element !== pendingSaveElement) return;
    if (!event.detail?.ok) {
      pendingSaveElement = null;
      _setModalEditStatus('dirty', 'Échec — à enregistrer');
      return;
    }
    pendingSaveElement = null;
    dirty = false;
    clearAutomaticModalCloseGuard();
    _setModalEditStatus('saved', 'Enregistré');
    document.dispatchEvent(new CustomEvent('app:modal-save-succeeded'));
    setTimeout(() => _setModalEditStatus('', ''), 1800);
  });

  document.addEventListener('app:modal-draft-restored', arm);

  const overlay = document.getElementById('modal-overlay');
  document.addEventListener('app:modal-opened', clear);
  document.addEventListener('app:modal-closed', clear);
  new MutationObserver(() => {
    if (!overlay?.classList.contains('show')) clear();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

const MODAL_DRAFT_TTL = 14 * 24 * 60 * 60 * 1000;
const MODAL_DRAFT_MAX_CHARS = 200000;
let _activeDraftKey = '';
let _draftTimer = null;

function _draftFields(modal) {
  return [...modal.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
    .filter((el) => {
      if (el.closest('[data-free-page-editor]') || el.dataset.noDraft !== undefined) return false;
      if (el.matches(LOCAL_SEARCH_SELECTOR) || el.dataset.noDirtyGuard !== undefined) return false;
      if (el instanceof HTMLInputElement && ['password', 'file', 'hidden', 'submit', 'button'].includes(el.type)) return false;
      return !el.disabled;
    });
}

function _draftFieldKey(el, index) {
  return el.dataset.draftKey || el.id || el.getAttribute('name') || el.dataset.field || `field-${index}`;
}

function _modalDraftKey(modal) {
  const title = document.getElementById('modal-title-text')?.textContent?.trim() || 'modal';
  const save = _modalSaveTarget(modal);
  const action = save?.dataset.action || save?.dataset.shAction || save?.dataset.bstAction || save?.textContent?.trim() || 'save';
  const signature = _draftFields(modal).slice(0, 12).map((el, index) => _draftFieldKey(el, index)).join('|');
  const slug = `${title}|${action}|${signature}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
  return `jdr-modal-draft:v1:${STATE.user?.uid || 'anonymous'}:${STATE.adventure?.id || 'global'}:${slug}`;
}

function _captureModalDraft(modal) {
  const fields = _draftFields(modal);
  const values = fields.map((el, index) => ({
    key: _draftFieldKey(el, index),
    value: el.isContentEditable ? el.innerHTML : el.value,
    checked: el.matches?.('input[type="checkbox"], input[type="radio"]') ? Boolean(el.checked) : null,
    contentEditable: Boolean(el.isContentEditable),
  }));
  const payload = { savedAt: Date.now(), values };
  if (JSON.stringify(payload).length <= MODAL_DRAFT_MAX_CHARS) lsJson.set(_activeDraftKey, payload);
}

function _clearModalDraft() {
  clearTimeout(_draftTimer);
  if (_activeDraftKey) lsJson.remove(_activeDraftKey);
}

function _restoreModalDraft(modal, draft) {
  const fields = _draftFields(modal);
  for (const saved of draft.values || []) {
    const el = fields.find((field, index) => _draftFieldKey(field, index) === saved.key);
    if (!el) continue;
    if (saved.contentEditable && el.isContentEditable) el.innerHTML = saved.value || '';
    else el.value = saved.value ?? '';
    if (saved.checked != null && 'checked' in el) el.checked = Boolean(saved.checked);
    const changeLike = el.tagName === 'SELECT' || el.matches?.('input[type="checkbox"], input[type="radio"]');
    el.dispatchEvent(new Event(changeLike ? 'change' : 'input', { bubbles: true }));
  }
  document.dispatchEvent(new CustomEvent('app:modal-draft-restored'));
}

function _offerModalDraft(modal) {
  _activeDraftKey = _modalDraftKey(modal);
  const draft = lsJson.get(_activeDraftKey, null);
  if (!draft || Date.now() - Number(draft.savedAt || 0) > MODAL_DRAFT_TTL || !draft.values?.length) {
    if (draft) _clearModalDraft();
    return;
  }
  const banner = document.createElement('div');
  banner.className = 'global-draft-recovery';
  banner.innerHTML = '<div><strong>Brouillon récupéré</strong><span>Des modifications locales non enregistrées sont disponibles.</span></div>';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'btn btn-gold btn-sm';
  restore.textContent = 'Restaurer';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'btn btn-outline btn-sm';
  dismiss.textContent = 'Ignorer';
  restore.addEventListener('click', () => {
    _restoreModalDraft(modal, draft);
    banner.remove();
  });
  dismiss.addEventListener('click', () => {
    _clearModalDraft();
    banner.remove();
  });
  banner.append(restore, dismiss);
  document.getElementById('modal-body')?.prepend(banner);
}

function _initModalDrafts() {
  document.addEventListener('app:modal-opened', () => {
    clearTimeout(_draftTimer);
    _activeDraftKey = '';
    requestAnimationFrame(() => {
      const modal = document.getElementById('modal-overlay');
      if (modal?.classList.contains('show') && _modalSaveTarget(modal) && _draftFields(modal).length) _offerModalDraft(modal);
    });
  });

  const schedule = (event) => {
    const modal = document.getElementById('modal-overlay');
    if (!event.isTrusted || !modal?.classList.contains('show') || !event.target?.closest?.('#modal-body')) return;
    if (!_activeDraftKey || !_draftFields(modal).includes(event.target)) return;
    clearTimeout(_draftTimer);
    _draftTimer = setTimeout(() => _captureModalDraft(modal), 450);
  };
  document.addEventListener('input', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('app:modal-save-succeeded', _clearModalDraft);
  document.addEventListener('app:modal-draft-discard', _clearModalDraft);
  window.addEventListener('pagehide', () => {
    const modal = document.getElementById('modal-overlay');
    if (_activeDraftKey && modal?.classList.contains('show')) _captureModalDraft(modal);
  });
}

function _openKeyboardHelp() {
  openModal('Raccourcis clavier', `
    <div class="global-shortcuts-intro">
      <strong>Aller plus vite, sans quitter ce que vous faites</strong>
      <span>Les raccourcis s'adaptent à la page ou à la fenêtre ouverte.</span>
    </div>
    <div class="global-shortcuts-grid">
      <section>
        <h3>Navigation</h3>
        <div><span>Recherche globale</span><kbd>Ctrl</kbd><kbd>K</kbd></div>
        <div><span>Rechercher dans la page</span><kbd>/</kbd></div>
        <div><span>Créer sur la page courante</span><kbd>N</kbd></div>
        <div><span>Page précédente</span><kbd>Alt</kbd><kbd>←</kbd></div>
        <div><span>Parcourir les onglets</span><kbd>←</kbd><kbd>→</kbd></div>
        <div><span>Premier / dernier onglet</span><kbd>Début</kbd><kbd>Fin</kbd></div>
      </section>
      <section>
        <h3>Fenêtres et formulaires</h3>
        <div><span>Enregistrer</span><kbd>Ctrl</kbd><kbd>S</kbd></div>
        <div><span>Valider</span><kbd>Ctrl</kbd><kbd>Entrée</kbd></div>
        <div><span>Fermer ou effacer une recherche</span><kbd>Échap</kbd></div>
        <div><span>Afficher cette aide</span><kbd>?</kbd></div>
      </section>
    </div>
    <p class="global-shortcuts-note">Sur macOS, utilisez <kbd>⌘</kbd> à la place de <kbd>Ctrl</kbd>.</p>
  `, {
    icon: '⌨️',
    subtitle: 'Les commandes utiles de Grimorium',
    accent: '#69a8ff',
  });
}

function _initKeyboardHelp() {
  document.addEventListener('app:open-keyboard-help', _openKeyboardHelp);
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target?.isContentEditable;
    const questionMark = event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey;
    const slashShortcut = (event.ctrlKey || event.metaKey) && event.key === '/';
    if (editing || (!questionMark && !slashShortcut)) return;
    event.preventDefault();
    _openKeyboardHelp();
  });
}

function _initModalShortcuts() {
  document.addEventListener('keydown', (event) => {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay?.classList.contains('show') || event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    const saveShortcut = (event.ctrlKey || event.metaKey) && key === 's';
    const confirmShortcut = (event.ctrlKey || event.metaKey) && key === 'enter';
    if (!saveShortcut && !confirmShortcut) return;

    const target = _modalSaveTarget(overlay);
    if (!target) return;
    event.preventDefault();
    if (target.form && typeof target.form.requestSubmit === 'function' && target.type === 'submit') {
      target.form.requestSubmit(target);
    } else {
      target.click();
    }
  });
}

function _initTabKeyboardNavigation() {
  document.addEventListener('keydown', (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    if (!tab) return;
    const tablist = tab.closest('[role="tablist"]') || tab.parentElement;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')].filter(_isVisible);
    const index = tabs.indexOf(tab);
    if (index < 0 || tabs.length < 2) return;

    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;

    event.preventDefault();
    tabs[next].focus({ preventScroll: true });
    tabs[next].click();
    tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

const LOCAL_SEARCH_SELECTOR = [
  'input[type="search"]',
  'input[placeholder*="Rechercher" i]',
  'input[placeholder*="Filtrer" i]',
  'input[aria-label*="Rechercher" i]',
  'input[aria-label*="Filtrer" i]',
].join(',');

function _visibleLocalSearch() {
  const modal = document.getElementById('modal-overlay');
  const scope = modal?.classList.contains('show') ? modal : document.getElementById('main-content');
  return [...(scope?.querySelectorAll(LOCAL_SEARCH_SELECTOR) || [])].find(_isVisible) || null;
}

function _initSearchShortcuts() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target?.isContentEditable;

    if (event.key === '/' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const search = _visibleLocalSearch();
      if (!search) return;
      event.preventDefault();
      search.focus({ preventScroll: true });
      search.select?.();
      search.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }

    if (event.key !== 'Escape' || !target?.matches?.(LOCAL_SEARCH_SELECTOR) || !target.value) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);
}

const QUICK_CREATE_SELECTORS = {
  characters: '[data-action="createNewChar"]',
  npcs: '[data-action="npcCreate"]',
  story: '[data-action="openStoryModal"]',
  achievements: '[data-action="openAchievementModal"]',
  bestiaire: '[data-bst-action="createDraft"]',
  shop: '[data-sh-action="openItemModal"]',
  players: '[data-pp-action="newPlayer"]',
};

function _quickCreateTarget() {
  const selector = QUICK_CREATE_SELECTORS[STATE.currentPage];
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find(_isVisible) || null;
}

function _hintContextualShortcuts(root = document) {
  for (const selector of Object.values(QUICK_CREATE_SELECTORS)) {
    const buttons = [
      ...(root.matches?.(selector) ? [root] : []),
      ...(root.querySelectorAll?.(selector) || []),
    ];
    buttons.forEach((button) => {
      if (button.dataset.qolShortcutHinted === 'true') return;
      button.dataset.qolShortcutHinted = 'true';
      const current = button.title?.trim();
      button.title = current ? `${current} (N)` : 'Créer (N)';
    });
  }
  const modal = document.getElementById('modal-overlay');
  if (modal?.classList.contains('show')) {
    const save = _modalSaveTarget(modal);
    if (save && save.dataset.qolShortcutHinted !== 'true') {
      save.dataset.qolShortcutHinted = 'true';
      const current = save.title?.trim();
      save.title = current ? `${current} (Ctrl+S)` : 'Enregistrer (Ctrl+S)';
    }
  }
}

function _initContextualShortcuts() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    const modalOpen = document.getElementById('modal-overlay')?.classList.contains('show');
    if (!editing && !modalOpen && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
      const create = _quickCreateTarget();
      if (!create) return;
      event.preventDefault();
      create.click();
      return;
    }
    const back = (event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[');
    if (!editing && !modalOpen && back) {
      event.preventDefault();
      history.back();
    }
  });
  document.addEventListener('app:modal-opened', () => requestAnimationFrame(() => _hintContextualShortcuts()));
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) _hintContextualShortcuts(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  _hintContextualShortcuts();
}

function _initOverflowNavigation() {
  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    if (tab) requestAnimationFrame(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });

  document.addEventListener('wheel', (event) => {
    const strip = event.target.closest?.('[role="tablist"], [data-horizontal-scroll]');
    if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    strip.scrollBy({ left: event.deltaY, behavior: 'auto' });
  }, { passive: false });
}

function _initFormValidationQol() {
  let scheduled = false;
  let firstInvalid = null;

  document.addEventListener('invalid', (event) => {
    const field = event.target;
    if (!field?.classList) return;
    field.classList.add('global-field-invalid');
    field.setAttribute('aria-invalid', 'true');
    if (!firstInvalid || !document.contains(firstInvalid)) firstInvalid = field;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const target = firstInvalid;
      firstInvalid = null;
      if (!target || !document.contains(target)) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      setTimeout(() => target.focus({ preventScroll: true }), 180);
    });
  }, true);

  const clearInvalid = (event) => {
    const field = event.target;
    if (!field?.classList?.contains('global-field-invalid')) return;
    if (field.validity && !field.validity.valid) return;
    field.classList.remove('global-field-invalid');
    field.removeAttribute('aria-invalid');
  };
  document.addEventListener('input', clearInvalid, true);
  document.addEventListener('change', clearInvalid, true);
}

export function initGlobalQol() {
  if (_initialized) return;
  _initialized = true;
  _mountNetworkStatus();
  _mountBackToTop();
  _mountNotificationHistory();
  _initModalShortcuts();
  _initModalDirtyGuard();
  _initModalDrafts();
  _initKeyboardHelp();
  _initTabKeyboardNavigation();
  _initSearchShortcuts();
  _initContextualShortcuts();
  _initOverflowNavigation();
  _initFormValidationQol();
  initPagePreferences();
}
