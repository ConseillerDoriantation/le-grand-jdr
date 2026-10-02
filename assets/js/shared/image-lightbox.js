// Visionneuse plein écran commune : clic pour zoomer sur un point, puis glisser
// pour explorer l'image. Le balisage reprend le composant déjà utilisé par la
// galerie des joueurs et les interactions de la lightbox des Hauts-Faits.
export function openImageLightbox({ src, alt = 'Image', hint = 'Cliquer pour zoomer · glisser pour déplacer' } = {}) {
  if (!src) return;
  document.getElementById('shared-image-lightbox')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'shared-image-lightbox';
  overlay.className = 'pp-lightbox shared-image-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', alt);
  overlay.innerHTML = `
    <div class="pp-lightbox-media">
      <img class="pp-lightbox-img" alt="" title="Cliquer pour zoomer">
    </div>
    <div class="pp-lightbox-counter shared-image-lightbox-hint"></div>
    <button type="button" class="pp-lightbox-close" aria-label="Fermer">✕</button>`;
  document.body.appendChild(overlay);

  const media = overlay.querySelector('.pp-lightbox-media');
  const image = overlay.querySelector('.pp-lightbox-img');
  const hintNode = overlay.querySelector('.shared-image-lightbox-hint');
  image.src = src;
  image.alt = alt;
  hintNode.textContent = hint;

  const resetZoom = () => {
    media.classList.remove('is-zoomed', 'is-panning');
    image.style.removeProperty('width');
    image.style.removeProperty('height');
    image.title = 'Cliquer pour zoomer';
    media.scrollTo({ left: 0, top: 0 });
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 180);
  };
  const onKey = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || (event.target === media && !media.classList.contains('is-zoomed'))) close();
  });
  overlay.querySelector('.pp-lightbox-close').addEventListener('click', close);

  const PAN_THRESHOLD = 4;
  let panActive = false;
  let panMoved = false;
  let panX = 0;
  let panY = 0;
  let panLeft = 0;
  let panTop = 0;

  image.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0 || !media.classList.contains('is-zoomed')) return;
    panActive = true;
    panMoved = false;
    panX = event.clientX;
    panY = event.clientY;
    panLeft = media.scrollLeft;
    panTop = media.scrollTop;
    image.setPointerCapture?.(event.pointerId);
    media.classList.add('is-panning');
    event.preventDefault();
  });
  image.addEventListener('pointermove', event => {
    if (!panActive) return;
    const dx = event.clientX - panX;
    const dy = event.clientY - panY;
    if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) panMoved = true;
    media.scrollLeft = panLeft - dx;
    media.scrollTop = panTop - dy;
  });
  const endPan = event => {
    if (!panActive) return;
    panActive = false;
    media.classList.remove('is-panning');
    image.releasePointerCapture?.(event.pointerId);
  };
  image.addEventListener('pointerup', endPan);
  image.addEventListener('pointercancel', endPan);

  image.addEventListener('click', event => {
    event.stopPropagation();
    if (panMoved) { panMoved = false; return; }
    if (media.classList.contains('is-zoomed')) { resetZoom(); return; }

    const bounds = media.getBoundingClientRect();
    const imageRatio = image.naturalWidth / image.naturalHeight;
    if (!Number.isFinite(imageRatio) || imageRatio <= 0 || !bounds.width || !bounds.height) return;
    const frameRatio = bounds.width / bounds.height;
    const fittedWidth = imageRatio >= frameRatio ? bounds.width : bounds.height * imageRatio;
    const fittedHeight = imageRatio >= frameRatio ? bounds.width / imageRatio : bounds.height;
    const focusX = (event.clientX - bounds.left) / bounds.width;
    const focusY = (event.clientY - bounds.top) / bounds.height;

    media.classList.add('is-zoomed');
    image.title = 'Cliquer pour dézoomer';
    image.style.width = `${Math.round(fittedWidth * 2)}px`;
    image.style.height = `${Math.round(fittedHeight * 2)}px`;
    requestAnimationFrame(() => {
      media.scrollLeft = Math.max(0, focusX * image.scrollWidth - bounds.width / 2);
      media.scrollTop = Math.max(0, focusY * image.scrollHeight - bounds.height / 2);
    });
  });
}
