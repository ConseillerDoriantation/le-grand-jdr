// Coquille commune du dock de session VTT.
// Les panneaux gardent leur moteur métier ; ce module ne gère que leur
// exclusivité, l'état visuel du dock et l'alignement de la flèche d'ancrage.

const _panels = new Map();

const _DOCK_ICONS = {
  rest: '<path d="M12 3.5c1.8 2.6 4 4.2 4 7.2a4 4 0 0 1-8 0c0-1.5.7-2.6 1.6-3.6.2 1.2.8 2 1.6 2.3C10.8 7.7 11.3 5.6 12 3.5z"/><path d="M4.5 20.5 19.5 17M4.5 17l15 3.5"/>',
  music: '<path d="M9 18V5.5l11-2v12.5"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  loot: '<path d="M9 7.5h6L16.5 4h-9z"/><path d="M9 7.5C5.8 10 4.5 13 4.5 15.5A4.5 4.5 0 0 0 9 20h6a4.5 4.5 0 0 0 4.5-4.5c0-2.5-1.3-5.5-4.5-8"/><path d="M13.6 11.6c-.4-.5-1-.8-1.7-.8-1 0-1.7.5-1.7 1.3 0 1.8 3.6.9 3.6 2.8 0 .8-.8 1.4-1.9 1.4-.8 0-1.5-.3-1.9-.9M12 10v1m0 5.3v1"/>',
  emote: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0"/><path d="M9.2 9.6h.01M14.8 9.6h.01" stroke-width="2.6"/>',
  dice: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z"/><path d="M12 2.8 7.6 14.8h8.8zM4 7.4l3.6 7.4M20 7.4l-3.6 7.4M7.6 14.8 12 21.2l4.4-6.4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  crown: '<path d="M4 18h16M5 15 4 7l4.5 3.5L12 5l3.5 5.5L20 7l-1 8z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l9-11h-6z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};

export function vttSessionDockIcon(name, cls = 'vtt-session-icon') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_DOCK_ICONS[name] || ''}</svg>`;
}

export function vttSessionDockButton({ key, id = '', action, label, tipTitle, tipDetail, primary = false, iconExtra = '', controls = '' }) {
  const idAttr = id ? ` id="${id}"` : '';
  const controlsId = controls || (key === 'emote' ? 'vtt-emote-picker' : `vtt-${key}-panel`);
  return `<button class="vtt-session-dock-btn vtt-${key}-trigger${primary ? ' primary' : ''}"${idAttr} data-dock-key="${key}" data-vtt-fn="${action}" aria-label="${label}" aria-expanded="false" aria-controls="${controlsId}">
    <span class="vtt-session-dock-icon">${vttSessionDockIcon(key)}${key === 'music' ? '<span class="vtt-session-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}${iconExtra}</span>
    <small>${key === 'music' ? '<i class="vtt-session-live-dot" aria-hidden="true"></i>' : ''}<span>${label}</span></small>
    <span class="vtt-session-tooltip" role="tooltip"><b>${tipTitle}</b><span class="vtt-session-tooltip-detail">${tipDetail}</span></span>
  </button>`;
}

function _isOpen(entry) {
  const panel = document.getElementById(entry.panelId);
  return entry.openClass ? panel?.classList.contains(entry.openClass) : panel?.dataset.open === '1';
}

export function registerVttSessionDockPanel(key, panelId, triggerSelector, close, openClass = '') {
  _panels.set(key, { panelId, triggerSelector, close, openClass });
}

export function openVttSessionDockPanel(key) {
  for (const [otherKey, entry] of _panels) {
    if (otherKey !== key && _isOpen(entry)) entry.close?.();
  }
}

export function syncVttSessionDock() {
  const dock = document.getElementById('vtt-session-tools');
  if (!dock) return;
  const opened = [..._panels.entries()].find(([, entry]) => _isOpen(entry));
  dock.classList.toggle('has-open', !!opened);
  dock.dataset.openPanel = opened?.[0] || '';
  dock.querySelectorAll('.vtt-session-pop-arrow').forEach(arrow => { arrow.hidden = true; });
  if (!opened) return;

  const [key, entry] = opened;
  const trigger = document.querySelector(entry.triggerSelector);
  const arrow = dock.querySelector(`.vtt-session-pop-arrow[data-for="${key}"]`);
  if (!trigger || !arrow) return;
  const rect = trigger.getBoundingClientRect();
  arrow.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
  arrow.hidden = false;
}

export function initVttSessionDock() {
  const refresh = () => requestAnimationFrame(syncVttSessionDock);
  window.addEventListener('resize', refresh);
  refresh();
  return () => window.removeEventListener('resize', refresh);
}
