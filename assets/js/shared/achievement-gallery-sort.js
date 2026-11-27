// Le tri modifie une séquence, jamais la géométrie des tuiles de la Fresque.
export function moveGalleryCard(ids, source, target, after) {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids;
  const next = ids.filter(id => id !== source);
  next.splice(next.indexOf(target) + Number(!!after), 0, source);
  return next.every((id, i) => ids[i] === id) ? ids : next;
}

export function mergeGalleryCategoryOrder(globalOrder, allIds, categoryIds, orderedIds) {
  const full = [...new Set([...globalOrder, ...allIds])];
  const local = [...new Set([...orderedIds, ...full].filter(id => categoryIds.has(id)))];
  let i = 0;
  return full.map(id => categoryIds.has(id) ? local[i++] : id);
}

/**
 * Geste local à une Fresque : les tuiles absolues ne bougent pas sous le
 * pointeur. On marque la destination et on recompose la grille au dépôt.
 */
export function bindGallerySort(grid, { scrollHost, onMove, onCancel }) {
  const abort = new AbortController();
  const { signal } = abort;
  let drag = null, frame = 0;
  const listen = (element, type, listener) => element.addEventListener(type, listener, { signal });
  const clearMarker = () => {
    if (drag?.target) delete drag.target.dataset.achInsert;
  };
  const stop = () => {
    if (!drag) return null;
    const result = drag;
    clearMarker();
    delete drag.card.dataset.achGrabbed;
    drag.badge?.remove();
    document.body.classList.remove('ach-dragging');
    drag = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (result.handle.hasPointerCapture?.(result.pointerId)) result.handle.releasePointerCapture(result.pointerId);
    return result;
  };
  const locate = () => {
    if (!drag) return;
    const { x, y, card } = drag;
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest('.ach-item');
    const bounds = grid.getBoundingClientRect();
    let target = hit && hit !== card && hit.parentElement === grid ? hit : null;
    if (!target && (!hit || hit === card) && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      // Dans une gouttière ou une fin de rangée, viser la tuile la plus proche.
      // Ne pas substituer une cible si le pointeur est toujours sur la source,
      // ou par-dessus le bandeau / une action hors de la galerie.
      if (!hit && el && grid.contains(el)) {
        let best = Infinity;
        for (const tile of drag.tiles) {
          if (tile === card) continue;
          const r = tile.getBoundingClientRect();
          const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
          const distance = dx * dx + dy * dy;
          if (distance < best) { best = distance; target = tile; }
        }
      }
    }
    if (target) {
      const r = target.getBoundingClientRect();
      const vertical = r.width >= bounds.width * .74 || y < r.top || y > r.bottom;
      const after = vertical ? y >= (r.top + r.bottom) / 2 : x >= (r.left + r.right) / 2;
      const marker = `${vertical ? 'v' : 'h'}-${after ? 'after' : 'before'}`;
      if (drag.target !== target || target.dataset.achInsert !== marker) {
        clearMarker();
        target.dataset.achInsert = marker;
      }
      drag.target = target;
      drag.after = after;
    } else {
      clearMarker();
      drag.target = null;
    }
    if (drag.badge) drag.badge.style.transform = `translate3d(${x + 14}px,${y + 14}px,0)`;
  };
  const tick = () => {
    frame = 0;
    if (!drag?.badge || !grid.isConnected) return;
    const host = drag.host;
    const r = host === document.scrollingElement ? { top: 0, bottom: innerHeight } : host?.getBoundingClientRect();
    const band = 76;
    let step = 0;
    if (r && drag.y < r.top + band) step = -Math.min(18, (r.top + band - drag.y) / 4);
    else if (r && drag.y > r.bottom - band) step = Math.min(18, (drag.y - r.bottom + band) / 4);
    const canScroll = host && (step < 0 ? host.scrollTop > 0 : step > 0 && Math.ceil(host.scrollTop + host.clientHeight) < host.scrollHeight);
    if (canScroll) host.scrollBy({ top: step, behavior: 'instant' });
    locate();
    if (canScroll) frame = requestAnimationFrame(tick);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };
  listen(grid, 'click', event => {
    if (event.target.closest('[data-ach-drag]')) event.stopPropagation();
  });
  listen(grid, 'pointerdown', event => {
    const handle = event.target.closest('[data-ach-drag]');
    const card = handle?.closest('.ach-item');
    if (!card || event.button !== 0 || !event.isPrimary || drag) return;
    drag = { handle, card, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, tiles: [...grid.querySelectorAll('.ach-item')], host: scrollHost() };
    handle.setPointerCapture(event.pointerId);
  });
  listen(grid, 'pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.badge) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      const badge = document.createElement('span');
      badge.className = 'ach-drag-label';
      badge.textContent = drag.handle.dataset.achDrag;
      document.body.append(badge);
      drag.badge = badge;
      drag.card.dataset.achGrabbed = '';
      document.body.classList.add('ach-dragging');
    }
    schedule();
  });
  listen(grid, 'pointerup', event => {
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.badge) { drag.x = event.clientX; drag.y = event.clientY; locate(); }
    const result = stop();
    if (result.target) onMove(result.card.dataset.achId, result.target.dataset.achId, result.after);
    else if (result.badge) onCancel();
  });
  const cancel = event => {
    if (drag?.pointerId === event.pointerId && stop()?.badge) onCancel();
  };
  listen(grid, 'pointercancel', cancel);
  listen(grid, 'lostpointercapture', cancel);
  listen(grid, 'keydown', event => {
    if (event.key === 'Escape' && drag) { stop(); onCancel(); return; }
    const handle = event.target.closest('[data-ach-drag]');
    if (!handle || !['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const card = handle.closest('.ach-item');
    const after = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const other = after ? card.nextElementSibling : card.previousElementSibling;
    if (other?.dataset.achId) onMove(card.dataset.achId, other.dataset.achId, after, true);
  });
  return () => { abort.abort(); stop(); };
}
