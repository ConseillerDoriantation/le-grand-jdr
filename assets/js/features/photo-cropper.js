input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    // Compress if > 500KB
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        // Resize to max 800px
        const maxSize = 800;
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize/w); w = maxSize; }
          else { w = Math.round(w * maxSize/h); h = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        showCropperModal(dataUrl, charId, w, h);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function showCropperModal(dataUrl, charId, imgW, imgH) {
  // State
  let scale = 1, offsetX = 0, offsetY = 0;
  let isDragging = false, startX = 0, startY = 0, startOX = 0, startOY = 0;
  let containerSize = 0;

  openModal('📷 Cadrer la photo', `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.8rem">
      Glisse pour repositionner · Molette ou curseur pour zoomer
    </div>
    <div class="cropper-container" id="cropper-box">
      <img class="cropper-img" id="cropper-img" src="${dataUrl}">
      <div class="cropper-overlay"></div>
    </div>
    <div class="cropper-controls">
      <label>🔍 Zoom</label>
      <input type="range" id="crop-zoom" min="0.5" max="4" step="0.01" value="1">
      <span id="crop-zoom-val" style="font-size:0.75rem;color:var(--gold);min-width:2.5rem;text-align:right">×1.0</span>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveCroppedPhoto('${charId}')">✅ Enregistrer</button>
      <button class="btn btn-outline" onclick="closeModal()">Annuler</button>
    </div>
  `);

  // Init after modal is shown
  requestAnimationFrame(() => {
    const box = document.getElementById('cropper-box');
    const img = document.getElementById('cropper-img');
    const zoomSlider = document.getElementById('crop-zoom');
    const zoomVal = document.getElementById('crop-zoom-val');
    if (!box || !img) return;

    containerSize = box.offsetWidth;

    // Initial scale to fill the container
    const fillScale = Math.max(containerSize/imgW, containerSize/imgH);
    scale = fillScale;
    offsetX = (containerSize - imgW*scale) / 2;
    offsetY = (containerSize - imgH*scale) / 2;
    zoomSlider.min = fillScale * 0.5;
    zoomSlider.max = fillScale * 5;
    zoomSlider.step = fillScale * 0.01;
    zoomSlider.value = scale;

    function applyTransform() {
      // Clamp so image always covers the box
      const minX = containerSize - imgW * scale;
      const minY = containerSize - imgH * scale;
      offsetX = Math.min(0, Math.max(minX, offsetX));
      offsetY = Math.min(0, Math.max(minY, offsetY));
      img.style.width = (imgW * scale) + 'px';
      img.style.height = (imgH * scale) + 'px';
      img.style.left = offsetX + 'px';
      img.style.top = offsetY + 'px';
      zoomVal.textContent = '×' + scale.toFixed(1);
    }

    applyTransform();

    // Zoom slider
    zoomSlider.addEventListener('input', () => {
      const newScale = parseFloat(zoomSlider.value);
      const cx = containerSize/2, cy = containerSize/2;
      offsetX = cx - (cx - offsetX) * (newScale/scale);
      offsetY = cy - (cy - offsetY) * (newScale/scale);
      scale = newScale;
      applyTransform();
    });

    // Mouse drag
    box.addEventListener('mousedown', e => {
      isDragging = true; startX = e.clientX; startY = e.clientY;
      startOX = offsetX; startOY = offsetY; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      offsetX = startOX + (e.clientX - startX);
      offsetY = startOY + (e.clientY - startY);
      applyTransform();
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Touch drag
    box.addEventListener('touchstart', e => {
      if (e.touches.length===1) {
        isDragging = true;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        startOX = offsetX; startOY = offsetY;
      } else if (e.touches.length===2) {
        isDragging = false;
        window._pinchDist = Math.hypot(
          e.touches[0].clientX-e.touches[1].clientX,
          e.touches[0].clientY-e.touches[1].clientY
        );
        window._pinchScale = scale;
      }
      e.preventDefault();
    }, {passive:false});
    box.addEventListener('touchmove', e => {
      if (e.touches.length===1 && isDragging) {
        offsetX = startOX + (e.touches[0].clientX - startX);
        offsetY = startOY + (e.touches[0].clientY - startY);
        applyTransform();
      } else if (e.touches.length===2) {
        const dist = Math.hypot(
          e.touches[0].clientX-e.touches[1].clientX,
          e.touches[0].clientY-e.touches[1].clientY
        );
        const newScale = window._pinchScale * (dist / window._pinchDist);
        const cx = containerSize/2, cy = containerSize/2;
        offsetX = cx - (cx - offsetX) * (newScale/scale);
        offsetY = cy - (cy - offsetY) * (newScale/scale);
        scale = Math.max(parseFloat(zoomSlider.min), Math.min(parseFloat(zoomSlider.max), newScale));
        zoomSlider.value = scale;
        applyTransform();
      }
      e.preventDefault();
    }, {passive:false});
    box.addEventListener('touchend', () => { isDragging = false; });

    // Scroll to zoom
    box.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const rect = box.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const newScale = Math.max(parseFloat(zoomSlider.min), Math.min(parseFloat(zoomSlider.max), scale*delta));
      offsetX = mx - (mx - offsetX) * (newScale/scale);
      offsetY = my - (my - offsetY) * (newScale/scale);
      scale = newScale;
      zoomSlider.value = scale;
      applyTransform();
    }, {passive:false});

    // Store for save
    window._cropperState = { dataUrl, imgW, imgH, getScale:()=>scale, getOX:()=>offsetX, getOY:()=>offsetY, getContainerSize:()=>containerSize };
  });
}

async function saveCroppedPhoto(charId) {
  const state = window._cropperState;
  if (!state) return;

  // Render cropped result to canvas
  const size = state.getContainerSize();
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = async () => {
    ctx.drawImage(img, state.getOX(), state.getOY(), state.imgW*state.getScale(), state.imgH*state.getScale());
    const finalData = canvas.toDataURL('image/jpeg', 0.88);

    // Check size — Firestore limit ~1MB per field
    if (finalData.length > 900000) {
      showNotif('Image trop grande. Essaie un fichier plus petit.', 'error');
      return;
    }

    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) return;
    c.photo = finalData;
    await updateInCol('characters', charId, {photo: finalData});
    closeModal();
    showNotif('Photo enregistrée !', 'success');
    renderCharSheet(c, window._currentCharTab||'carac');
  };
  img.src = state.dataUrl;
}

async function deleteCharPhoto(charId) {
  if (!confirm('Supprimer la photo ?')) return;
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  delete c.photo;
  await updateInCol('characters', charId, {photo: null});
  showNotif('Photo supprimée.', 'success');
  renderCharSheet(c, window._currentCharTab||'carac');
}

// Keyboard close modal
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
