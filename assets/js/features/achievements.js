// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// ✓ Upload + redimensionnement image (ratio libre, max 1400px, fond flou à l'affichage)
// ✓ Hauts-faits sans image affichés correctement (emoji + fond)
// ✓ Drag & drop précis pour réordonner, ordre persisté dans Firestore
// ✓ Ordre partagé pour tous les utilisateurs
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { _crop } from '../shared/image-upload.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const CATS = [
  { id: 'epique',   label: '⚔️ Épique',   color: '#4f8cff', glow: 'rgba(79,140,255,0.14)'  },
  { id: 'comique',  label: '🎭 Comique',  color: '#e8b84b', glow: 'rgba(232,184,75,0.14)'  },
  { id: 'histoire', label: '📖 Histoire', color: '#22c38e', glow: 'rgba(34,195,142,0.14)'  },
];

// _crop → géré par shared/image-upload.js

// ── MODAL PRINCIPAL ──────────────────────────────────────────────────────────
function openAchievementModal(id = null) {
  const ex = id ? (window._achItems || []).find(a => a.id === id) : null;
  _crop.base64 = null;

  openModal(
    id ? `✏️ Modifier — ${ex?.titre || 'Haut-Fait'}` : '🏆 Nouveau Haut-Fait',
    `
    <div class="form-group">
      <label>Catégorie</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${CATS.map(c => `
          <button type="button" id="ach-cat-${c.id}" onclick="window._achSelectCat('${c.id}')"
            style="padding:0.4rem 0.9rem;border-radius:999px;font-size:0.8rem;cursor:pointer;
                   border:1px solid var(--border);background:transparent;
                   color:var(--text-muted);transition:all 0.15s;">
            ${c.label}
          </button>`).join('')}
      </div>
      <input type="hidden" id="ach-categorie" value="${ex?.categorie || 'epique'}">
    </div>

    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="ach-titre"
        value="${ex?.titre || ''}" placeholder="ex: L'œuf de Dragon">
    </div>

    <div class="form-group">
      <label>Description <span style="font-size:0.75rem;color:var(--text-dim)">(visible par les joueurs)</span></label>
      <textarea class="input-field" id="ach-desc" rows="3"
        placeholder="Ce qui s'est passé...">${ex?.description || ''}</textarea>
    </div>

    <div class="form-group">
      <label>Image</label>

      <!-- Zone de drop -->
      <div id="ach-drop-zone" style="
        border:2px dashed var(--border-strong);border-radius:12px;
        padding:1.2rem;text-align:center;cursor:pointer;
        transition:border-color 0.15s;background:var(--bg-elevated);
      "
        onclick="document.getElementById('ach-file').click()"
        ondragover="event.preventDefault();this.style.borderColor='var(--gold)'"
        ondragleave="this.style.borderColor='var(--border-strong)'"
        ondrop="event.preventDefault();this.style.borderColor='var(--border-strong)';window._achFile(event.dataTransfer.files[0])">
        <div id="ach-drop-preview">
          ${ex?.imageUrl
            ? `<img src="${ex.imageUrl}" style="max-height:80px;border-radius:8px;max-width:100%">`
            : `<div style="font-size:2rem;margin-bottom:4px">🖼️</div>`}
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">
          Glisser une image ou <span style="color:var(--gold)">cliquer pour choisir</span>
        </div>
        <div style="font-size:0.7rem;color:var(--text-dim);margin-top:2px">JPG · PNG · WebP — max 5 Mo</div>
      </div>

      <div id="ach-img-ready" style="display:none;font-size:0.75rem;color:var(--green);text-align:center;margin-top:6px">
        ✓ Image prête
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
      <div class="form-group">
        <label>Emoji (si pas d'image)</label>
        <input class="input-field" id="ach-emoji"
          value="${ex?.emoji || '🏆'}" style="font-size:1.2rem">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="input-field" id="ach-date"
          value="${ex?.date || new Date().toLocaleDateString('fr-FR')}">
      </div>
    </div>

    ${(() => {
      const chars = STATE.characters || [];
      if (!chars.length) return '';
      const contrib = ex?.contributeurs || [];
      const COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
      return `<div class="form-group">
        <label>Personnages contributeurs <span style="font-size:.73rem;color:var(--text-dim);font-weight:400">(optionnel)</span></label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:.5rem;margin-top:.3rem">
          ${chars.map(c => {
            const isOn = contrib.includes(c.id);
            const col  = COLS[c.nom?.charCodeAt(0)%6||0];
            const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
            return `<div onclick="window._achToggleContrib('${c.id}')"
              id="ach-contrib-${c.id}"
              data-contrib-nom="${(c.nom||'?').replace(/"/g,'&quot;')}"
              style="display:flex;flex-direction:column;align-items:center;gap:.3rem;
                padding:.5rem .3rem;border-radius:10px;cursor:pointer;transition:all .15s;
                border:2px solid ${isOn?col:'var(--border)'};
                background:${isOn?col+'18':'var(--bg-elevated)'}">
              <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;
                border:2px solid ${isOn?col:'rgba(255,255,255,.1)'};
                background:${col}18;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                ${c.photo
                  ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
                  : `<span style="font-family:'Cinzel',serif;font-weight:700;font-size:.95rem;color:${col}">${(c.nom||'?')[0].toUpperCase()}</span>`}
              </div>
              <span style="font-size:.65rem;text-align:center;
                color:${isOn?col:'var(--text-dim)'};font-weight:${isOn?'700':'400'};
                line-height:1.2;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(c.nom||'?')}</span>
              ${isOn?`<div class="ach-dot" style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></div>`:''}
            </div>`;
          }).join('')}
        </div>
        <input type="hidden" id="ach-contributeurs" value="${contrib.join(',')}">
      </div>`;
    })()}

    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem"
      onclick="window.saveAchievement('${id || ''}')">
      ${id ? 'Enregistrer les modifications' : 'Créer le Haut-Fait'}
    </button>
    `
  );

  // Sélecteur catégorie
  window._achSelectCat = (catId) => {
    document.getElementById('ach-categorie').value = catId;
    CATS.forEach(c => {
      const btn    = document.getElementById(`ach-cat-${c.id}`);
      const active = c.id === catId;
      if (!btn) return;
      btn.style.borderColor = active ? c.color : 'var(--border)';
      btn.style.background  = active ? c.glow  : 'transparent';
      btn.style.color       = active ? c.color  : 'var(--text-muted)';
    });
  };
  window._achSelectCat(ex?.categorie || 'epique');

  window._achToggleContrib = (charId) => {
    const hidden = document.getElementById('ach-contributeurs');
    if (!hidden) return;
    const current = hidden.value ? hidden.value.split(',') : [];
    const idx     = current.indexOf(charId);
    const next    = idx >= 0 ? current.filter(x => x !== charId) : [...current, charId];
    hidden.value  = next.join(',');
    const card    = document.getElementById(`ach-contrib-${charId}`);
    if (!card) return;
    const active  = next.includes(charId);
    const COLS    = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
    const nom     = card.dataset.contribNom || '';
    const col     = COLS[nom.charCodeAt(0) % 6];
    card.style.borderColor = active ? col : 'var(--border)';
    card.style.background  = active ? col + '18' : 'var(--bg-elevated)';
    // Cercle portrait
    const circle = card.querySelector('div');
    if (circle) circle.style.borderColor = active ? col : 'rgba(255,255,255,.1)';
    // Nom
    const nameEl = card.querySelector('span');
    if (nameEl) { nameEl.style.color = active ? col : 'var(--text-dim)'; nameEl.style.fontWeight = active ? '700' : '400'; }
    // Point indicateur
    const dotEl  = card.querySelector('.ach-dot');
    if (active && !dotEl) {
      const dot = document.createElement('div');
      dot.className = 'ach-dot';
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0`;
      card.appendChild(dot);
    } else if (!active && dotEl) dotEl.remove();
  };

  // ── Input file créé en JS (évite l'orphelin DOM via innerHTML) ────────────
  const achFileInput = document.createElement('input');
  achFileInput.type   = 'file';
  achFileInput.id     = 'ach-file';
  achFileInput.accept = 'image/*';
  achFileInput.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none';
  document.body.appendChild(achFileInput);

  const handleAchFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { showNotif('Image trop lourde (max 5 Mo).', 'error'); return; }
    const r = new FileReader();
    r.onload = (e) => _resizeAndPreview(e.target.result);
    r.readAsDataURL(file);
  };

  achFileInput.addEventListener('change', () => handleAchFile(achFileInput.files[0]));
  window._achFile = handleAchFile;

  // Rebind la drop zone avec addEventListener (pas onclick inline)
  const achDropZone = document.getElementById('ach-drop-zone');
  if (achDropZone) {
    achDropZone.onclick     = () => achFileInput.click();
    achDropZone.ondragover  = (e) => { e.preventDefault(); achDropZone.style.borderColor = 'var(--gold)'; };
    achDropZone.ondragleave = ()  => { achDropZone.style.borderColor = 'var(--border-strong)'; };
    achDropZone.ondrop      = (e) => { e.preventDefault(); achDropZone.style.borderColor = 'var(--border-strong)'; handleAchFile(e.dataTransfer.files[0]); };
  }

  // Nettoyer quand le modal se ferme
  const achObs = new MutationObserver(() => {
    if (!document.getElementById('ach-drop-zone')) { achFileInput.remove(); achObs.disconnect(); }
  });
  achObs.observe(document.body, { childList: true, subtree: true });
}

// ── TRAITEMENT IMAGE — redimensionnement sans crop forcé ──────────────────────
function _resizeAndPreview(dataUrl) {
  _crop.base64 = null;
  const img = new Image();
  img.onload = () => {
    const MAX = 1400;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX || h > MAX) {
      if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
      else        { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    _crop.base64 = canvas.toDataURL('image/jpeg', 0.88);

    const preview = document.getElementById('ach-drop-preview');
    if (preview) preview.innerHTML = `<img src="${_crop.base64}" style="max-height:80px;border-radius:8px;max-width:100%">`;
    const ready = document.getElementById('ach-img-ready');
    if (ready) ready.style.display = 'block';
  };
  img.src = dataUrl;
}

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveAchievement(id = '') {
  try {
    const titre = document.getElementById('ach-titre')?.value?.trim();
    if (!titre) { showNotif('Le titre est requis.', 'error'); return; }

    let imageUrl = '';
    if (_crop.base64) {
      imageUrl = _crop.base64;
    } else {
      const ex = id ? (window._achItems || []).find(a => a.id === id) : null;
      imageUrl  = ex?.imageUrl || '';
    }

    const contribRaw = document.getElementById('ach-contributeurs')?.value || '';
    const contributeurs = contribRaw ? contribRaw.split(',').filter(Boolean) : [];
    const payload = {
      titre,
      categorie:    document.getElementById('ach-categorie')?.value || 'epique',
      description:  document.getElementById('ach-desc')?.value?.trim()  || '',
      imageUrl,
      emoji:        document.getElementById('ach-emoji')?.value?.trim() || '🏆',
      date:         document.getElementById('ach-date')?.value?.trim()  || '',
      contributeurs,
    };

    let docId = id;
    if (!id) {
      docId = `ach_${Date.now()}`;
      await saveDoc('achievements', docId, payload);
      const order = await _loadOrder();
      order.push(docId);
      await _saveOrder(order);
      if (window._achItems) window._achItems.push({ id: docId, ...payload });
    } else {
      await saveDoc('achievements', docId, payload);
      if (window._achItems) {
        window._achItems = window._achItems.map(a => a.id === id ? { id, ...payload } : a);
      }
    }

    _crop.base64 = null;
    closeModal();
    showNotif(id ? 'Haut-Fait mis à jour.' : `"${titre}" ajouté !`, 'success');
    await PAGES.achievements();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── ÉDITER ────────────────────────────────────────────────────────────────────
async function editAchievement(id) {
  if (!window._achItems) window._achItems = await loadCollection('achievements');
  openAchievementModal(id);
}

// ── SUPPRIMER ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  try {
    if (!await confirmModal('Supprimer ce haut-fait définitivement ?')) return;
    await deleteFromCol('achievements', id);
    if (window._achItems) window._achItems = window._achItems.filter(a => a.id !== id);
    const order = (await _loadOrder()).filter(oid => oid !== id);
    await _saveOrder(order);
    showNotif('Haut-Fait supprimé.', 'success');
    await PAGES.achievements();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── ORDRE ─────────────────────────────────────────────────────────────────────
async function _loadOrder() {
  const doc = await getDocData('achievements_meta', 'order');
  return Array.isArray(doc?.order) ? doc.order : [];
}
async function _saveOrder(order) {
  try {
    await saveDoc('achievements_meta', 'order', { order });
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}
function _applyOrder(items, order) {
  if (!order.length) return items;
  const map     = Object.fromEntries(items.map(a => [a.id, a]));
  const ordered = order.filter(id => map[id]).map(id => map[id]);
  const rest    = items.filter(a => !order.includes(a.id));
  return [...ordered, ...rest];
}

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupAchievementsDnd(catId) {
  if (!STATE.isAdmin) return;
  const grid = document.getElementById(`ach-grid-${catId}`);
  if (!grid) return;

  let dragged = null;

  grid.querySelectorAll('[data-ach-id]').forEach(card => {
    card.setAttribute('draggable', 'true');

    card.addEventListener('dragstart', (e) => {
      dragged = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.achId);
      requestAnimationFrame(() => card.classList.add('ach-dragging'));
    });

    card.addEventListener('dragend', async () => {
      card.classList.remove('ach-dragging');
      dragged = null;

      // Lire l'ordre depuis le DOM (traverse toutes les rangées)
      const domOrder = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);

      const catIds      = new Set((window._achItems || [])
        .filter(a => (a.categorie || 'epique') === catId).map(a => a.id));
      const globalOrder = await _loadOrder();
      const otherIds    = globalOrder.filter(id => !catIds.has(id));
      const firstOther  = globalOrder.find(id => !catIds.has(id) &&
        globalOrder.indexOf(id) > Math.max(-1, ...globalOrder.map((v, i) => catIds.has(v) ? i : -1)));

      const merged = firstOther
        ? [...otherIds.slice(0, otherIds.indexOf(firstOther)), ...domOrder, ...otherIds.slice(otherIds.indexOf(firstOther))]
        : [...otherIds, ...domOrder];

      await _saveOrder(merged);
      showNotif('Ordre sauvegardé.', 'success');
      // Reconstruire le justified layout avec le nouvel ordre DOM
      await _achRebuildJustified(catId);
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged || card === dragged) return;
      // Comparer position horizontale au sein d'une rangée
      const rect  = card.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      if (after) card.after(dragged);
      else       card.before(dragged);
    });

    card.addEventListener('dragenter', (e) => e.preventDefault());
  });
}

// ── LIGHTBOX IMAGE ────────────────────────────────────────────────────────────
function _achOpenImage(url) {
  // Overlay plein écran avec l'image agrandie, clic ou Escape pour fermer
  const existing = document.getElementById('ach-lightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.92)',
    'display:flex;align-items:center;justify-content:center',
    'cursor:zoom-out',
    'animation:achLbFade .18s ease',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes achLbFade { from { opacity:0 } to { opacity:1 } }
      @keyframes achLbScale { from { transform:scale(.92) } to { transform:scale(1) } }
    </style>
    <img src="${url}"
      style="max-width:92vw;max-height:90vh;object-fit:contain;border-radius:12px;
             box-shadow:0 24px 80px rgba(0,0,0,.8);
             animation:achLbScale .18s ease;pointer-events:none;display:block">
    <button style="position:absolute;top:20px;right:24px;background:rgba(255,255,255,.1);
      border:1px solid rgba(255,255,255,.2);border-radius:999px;
      color:#fff;font-size:1.2rem;width:40px;height:40px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:background .15s">✕</button>
  `;

  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 160); };
  overlay.addEventListener('click', close);
  overlay.querySelector('button').addEventListener('click', close);

  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

// ── JUSTIFIED LAYOUT ENGINE ───────────────────────────────────────────────────

const ACH_CATS = [
  { id:'epique',   label:'Épique',   emoji:'⚔️',  color:'#4f8cff', glow:'rgba(79,140,255,0.14)' },
  { id:'comique',  label:'Comique',  emoji:'🎭',  color:'#e8b84b', glow:'rgba(232,184,75,0.14)' },
  { id:'histoire', label:'Histoire', emoji:'📖',  color:'#22c38e', glow:'rgba(34,195,142,0.14)' },
];

// Mesure les aspect-ratios manquants en chargeant les images
async function _achMeasureRatios(items) {
  return Promise.all(items.map(item => {
    if (item.aspectRatio)  return Promise.resolve(item);
    if (!item.imageUrl)    return Promise.resolve({ ...item, aspectRatio: 1 });
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve({ ...item, aspectRatio: img.naturalWidth / img.naturalHeight });
      img.onerror = () => resolve({ ...item, aspectRatio: 4 / 3 });
      img.src = item.imageUrl;
    });
  }));
}

// Algorithme justified : même hauteur par rangée, largeurs proportionnelles au ratio
// Résultat garanti : conteneur W/H = ratio image → object-fit:cover sans aucun recadrage
function _achBuildRows(items, containerW, targetH, gap) {
  const rows = [];
  let row = [], naturalW = 0;

  const flush = (partial) => {
    const n      = row.length;
    const availW = containerW - (n - 1) * gap;
    const scale  = partial ? 1 : availW / naturalW;
    const h      = Math.round(targetH * scale);
    rows.push({ h, items: row.map(i => ({ ...i, w: Math.round(i._ratio * targetH * scale) })) });
    row = []; naturalW = 0;
  };

  for (const item of items) {
    const ratio = item.aspectRatio || 4 / 3;
    row.push({ ...item, _ratio: ratio });
    naturalW += ratio * targetH;
    if (naturalW + (row.length - 1) * gap >= containerW) flush(false);
  }
  if (row.length) flush(true); // dernière rangée partielle

  return rows;
}

// HTML d'une carte dans le justified layout
function _achCardHTML(item, cat, isAdmin) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = STATE.characters || [];
  const contribs  = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);

  const contribsHtml = contribs.length ? `
    <div class="ach-contribs">
      ${contribs.map(c => {
        const col      = CHAR_COLS[c.nom?.charCodeAt(0) % 6 || 0];
        const photoPos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
        return `<div class="ach-contrib-pill" style="border-color:${col}50">
          <div class="ach-contrib-avatar" style="background:${col}22;color:${col}">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
              : (c.nom || '?')[0].toUpperCase()}
          </div>
          <span class="ach-contrib-name">${_esc(c.nom || '?')}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const adminHtml = isAdmin ? `
    <div class="ach-admin-btns">
      <button class="btn btn-outline btn-sm" style="flex:1;font-size:.7rem"
        onclick="event.stopPropagation();editAchievement('${item.id}')">✏️ Modifier</button>
      <button class="btn-icon" style="color:#ff6b6b"
        onclick="event.stopPropagation();deleteAchievement('${item.id}')">🗑️</button>
    </div>` : '';

  const imageHtml = item.imageUrl
    ? `<img src="${item.imageUrl}" loading="lazy" draggable="false">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
         font-size:3.5rem;background:linear-gradient(135deg,${cat.glow},var(--bg-panel))">${item.emoji || cat.emoji}</div>`;

  return `
    <div class="ach-badge-cat" style="color:${cat.color};border-color:${cat.color}55">${cat.emoji} ${cat.label}</div>
    ${item.date ? `<div class="ach-badge-date">${item.date}</div>` : ''}
    ${imageHtml}
    <div class="ach-meta">
      <div class="ach-meta-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-meta-desc">${_esc(item.description)}</div>` : ''}
      ${contribsHtml}
      ${adminHtml}
    </div>`;
}

// Rendu justified dans le conteneur
async function _achRenderJustified(catId, items, cat, container) {
  const withRatios = await _achMeasureRatios(items);

  // Stocker les ratios mesurés pour les rebuilds DnD
  withRatios.forEach(item => {
    const idx = (window._achItems || []).findIndex(a => a.id === item.id);
    if (idx >= 0) window._achItems[idx] = { ...window._achItems[idx], aspectRatio: item.aspectRatio };
  });

  const containerW = container.clientWidth || 900;
  const targetH    = window.innerWidth < 1024 ? (window.innerWidth < 600 ? 150 : 220) : 340;
  const gap        = 10;
  const rows       = _achBuildRows(withRatios, containerW, targetH, gap);
  const isAdmin    = STATE.isAdmin;

  container.innerHTML = rows.map(row => `
    <div class="ach-row" style="height:${row.h}px">
      ${row.items.map(item => `
        <div class="ach-item" data-ach-id="${item.id}"
          style="width:${item.w}px;height:${row.h}px;${isAdmin ? 'cursor:grab' : ''}"
          ${item.imageUrl ? `onclick="window._achOpenImage('${item.imageUrl.replace(/'/g, "\\'")}')"` : ''}>
          ${_achCardHTML(item, cat, isAdmin)}
        </div>`).join('')}
    </div>`).join('');
}

// Rebuild après réordonnancement DnD (lit l'ordre DOM, recalcule le layout)
async function _achRebuildJustified(catId) {
  const grid = document.getElementById(`ach-grid-${catId}`);
  const cat  = ACH_CATS.find(c => c.id === catId);
  if (!grid || !cat) return;

  const itemsById  = Object.fromEntries((window._achItems || []).map(a => [a.id, a]));
  const orderedIds = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
  const ordered    = orderedIds.map(id => itemsById[id]).filter(Boolean);

  await _achRenderJustified(catId, ordered, cat, grid);
  setupAchievementsDnd(catId);
}
window._achRebuildJustified = _achRebuildJustified;

// ── RÉORDONNER (modal simple drag-and-drop vertical) ─────────────────────────
window._achOuvrirReordre = async function() {
  const catId    = window._achCat || 'epique';
  const cat      = ACH_CATS.find(c => c.id === catId);
  const catItems = (window._achItems || []).filter(a => (a.categorie || 'epique') === catId);
  if (!catItems.length || !cat) return;

  openModal(`↕️ Réordonner — ${cat.emoji} ${cat.label}`, `
    <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.8rem">Glisser les lignes pour changer l'ordre.</p>
    <div id="ach-reorder-list" style="display:flex;flex-direction:column;gap:6px">
      ${catItems.map(a => `
        <div data-reorder-id="${a.id}" draggable="true" style="
          display:flex;align-items:center;gap:10px;padding:8px 10px;
          background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;cursor:grab;
          transition:background .15s">
          <span style="color:var(--text-dim);font-size:1.1rem;flex-shrink:0">⠿</span>
          ${a.imageUrl
            ? `<img src="${a.imageUrl}" style="width:40px;height:30px;border-radius:6px;object-fit:cover;flex-shrink:0">`
            : `<span style="font-size:1.4rem;flex-shrink:0">${a.emoji || '🏆'}</span>`}
          <span style="font-size:.85rem;color:var(--text)">${_esc(a.titre || 'Haut-Fait')}</span>
        </div>`).join('')}
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:12px"
      onclick="window._achSauvegarderReordre('${catId}')">💾 Enregistrer l'ordre</button>
  `);

  // DnD vertical sur la liste modale
  let draggedRow = null;
  const list = document.getElementById('ach-reorder-list');
  list?.querySelectorAll('[data-reorder-id]').forEach(row => {
    row.addEventListener('dragstart', () => { draggedRow = row; row.style.opacity = '.4'; });
    row.addEventListener('dragend',   () => { draggedRow = null; row.style.opacity = ''; });
    row.addEventListener('dragover',  e  => {
      e.preventDefault();
      if (!draggedRow || row === draggedRow) return;
      const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      e.clientY < mid ? row.before(draggedRow) : row.after(draggedRow);
    });
  });
};

window._achSauvegarderReordre = async function(catId) {
  const list = document.getElementById('ach-reorder-list');
  if (!list) return;

  const catItems  = (window._achItems || []).filter(a => (a.categorie || 'epique') === catId);
  const catIds    = new Set(catItems.map(a => a.id));
  const newCatOrd = [...list.querySelectorAll('[data-reorder-id]')].map(el => el.dataset.reorderId);

  const globalOrder = await _loadOrder();
  const others      = globalOrder.filter(id => !catIds.has(id));
  const firstOther  = globalOrder.find(id => !catIds.has(id) &&
    globalOrder.indexOf(id) > Math.max(-1, ...globalOrder.map((v, i) => catIds.has(v) ? i : -1)));

  let merged;
  if (firstOther) {
    const idx = others.indexOf(firstOther);
    merged = [...others.slice(0, idx), ...newCatOrd, ...others.slice(idx)];
  } else {
    merged = [...others, ...newCatOrd];
  }

  await _saveOrder(merged);
  window._achItems = _applyOrder(window._achItems, merged);
  closeModal();
  showNotif('Ordre sauvegardé.', 'success');
  await _achRebuildJustified(catId);
};

// ── OVERRIDE PAGES.ACHIEVEMENTS ───────────────────────────────────────────────
const _origPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  const [items, order] = await Promise.all([
    loadCollection('achievements'),
    _loadOrder(),
  ]);
  window._achItems = _applyOrder(items, order);
  await _origPage();

  // Justified layout pour la catégorie active
  const catId  = window._achCat || 'epique';
  const cat    = ACH_CATS.find(c => c.id === catId);
  const grid   = document.getElementById(`ach-grid-${catId}`);
  const catItems = (window._achItems || []).filter(a => (a.categorie || 'epique') === catId);

  if (cat && grid && catItems.length) {
    await _achRenderJustified(catId, catItems, cat, grid);
    setupAchievementsDnd(catId);
  }
};

// ── EXPORTS ───────────────────────────────────────────────────────────────────
Object.assign(window, {
  openAchievementModal,
  saveAchievement,
  editAchievement,
  deleteAchievement,
  setupAchievementsDnd,
  _achOpenImage,
});