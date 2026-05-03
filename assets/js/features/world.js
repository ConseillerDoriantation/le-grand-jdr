// ══════════════════════════════════════════════════════════════════════════════
// WORLD.JS — Le Monde
// ✓ Sections de lore libres (texte riche, image optionnelle)
// ✓ MJ : CRUD sections, réorganisation par drag & drop
// ✓ Joueur : lecture seule, navigation par ancres
// ✓ Firestore : world/main → { sections:[{id,titre,contenu,imageUrl,icone,visible}] }
// ══════════════════════════════════════════════════════════════════════════════
import { getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, _nl2br, _norm } from '../shared/html.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── État local ────────────────────────────────────────────────────────────────
let _sections     = [];
let _activeId     = null;
let _dragIdx      = null;
let _wiCropper    = null;

// ── Icônes disponibles ────────────────────────────────────────────────────────
const ICONES = [
  '📖','🌍','🏔️','🌊','🏙️','🌲','⚔️','🛡️','🔮','💀',
  '👑','⚙️','🌑','☀️','🐉','🗝️','📜','🗺️','🏛️','✨',
];

// ── Chargement ────────────────────────────────────────────────────────────────
async function _load() {
  const doc = await getDocData('world', 'main');
  _sections = (doc?.sections || []).filter(s => s?.id);
  if (!_sections.length && STATE.isAdmin) {
    // Section par défaut si vide
    _sections = [{
      id: 'intro', titre: 'Introduction', icone: '📖',
      contenu: 'Les informations sur le monde seront ajoutées ici par le Maître de Jeu.',
      imageUrl: '', visible: true,
    }];
  }
}

async function _save() {
  try {
    await saveDoc('world', 'main', { sections: _sections });
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── Rendu principal ───────────────────────────────────────────────────────────
async function renderWorld() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)">
    <div style="font-size:1.5rem;margin-bottom:.5rem">⏳</div><p>Chargement…</p></div>`;

  await _load();

  // Sélection de la section active
  const visible = _sections.filter(s => s.visible !== false || STATE.isAdmin);
  if (!_activeId || !visible.find(s => s.id === _activeId)) {
    _activeId = visible[0]?.id || null;
  }
  const activeSection = visible.find(s => s.id === _activeId) || null;

  content.innerHTML = `
  <div style="display:grid;grid-template-columns:240px 1fr;gap:1.2rem;align-items:start;
    max-width:1100px;margin:0 auto">

    <!-- ── SIDEBAR NAVIGATION ───────────────────────────────────────────── -->
    <div style="position:sticky;top:1rem">
      <div style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:var(--radius-lg);overflow:hidden">

        <!-- Header sidebar -->
        <div style="padding:.85rem 1rem;border-bottom:1px solid var(--border);
          background:linear-gradient(135deg,rgba(255,255,255,.02),transparent);
          display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--gold);
              letter-spacing:1px">📖 Le Monde</div>
            <div style="font-size:.68rem;color:var(--text-dim);margin-top:1px">
              ${visible.length} section${visible.length>1?'s':''}
            </div>
          </div>
          ${STATE.isAdmin ? `
          <button onclick="openWorldSectionModal()"
            style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(232,184,75,.3);
            background:rgba(232,184,75,.08);color:var(--gold);cursor:pointer;font-size:1rem;
            display:flex;align-items:center;justify-content:center;transition:all .15s"
            title="Nouvelle section">+</button>` : ''}
        </div>

        <!-- Liste sections -->
        <div id="world-nav-list" style="padding:.4rem 0">
          ${visible.map((s, i) => _renderNavItem(s, i)).join('')}
          ${visible.length === 0 ? `
          <div style="padding:1.5rem 1rem;text-align:center;color:var(--text-dim);
            font-size:.78rem;font-style:italic">Aucune section</div>` : ''}
        </div>
      </div>

      <!-- Actions admin en bas de la sidebar -->
      ${STATE.isAdmin ? `
      <div style="margin-top:.6rem;display:flex;flex-direction:column;gap:.35rem">
        <button onclick="openWorldSectionModal()"
          class="btn btn-gold btn-sm" style="width:100%;font-size:.75rem">
          + Ajouter une section
        </button>
      </div>` : ''}
    </div>

    <!-- ── CONTENU PRINCIPAL ─────────────────────────────────────────────── -->
    <div id="world-main-content">
      ${activeSection ? _renderSection(activeSection) : _renderEmpty()}
    </div>

  </div>`;

  // Bind drag & drop des items nav (admin)
  if (STATE.isAdmin) _bindNavDrag();
}

// ── Nav item ─────────────────────────────────────────────────────────────────
function _renderNavItem(s, i) {
  const isActive = s.id === _activeId;
  const isHidden = s.visible === false;
  return `<div
    data-nav-id="${s.id}" data-nav-idx="${i}"
    ${STATE.isAdmin ? 'draggable="true"' : ''}
    onclick="selectWorldSection('${s.id}')"
    style="display:flex;align-items:center;gap:.55rem;padding:.55rem 1rem;
      cursor:pointer;transition:all .12s;position:relative;
      background:${isActive ? 'rgba(232,184,75,.07)' : 'transparent'};
      border-left:3px solid ${isActive ? 'var(--gold)' : 'transparent'};
      opacity:${isHidden ? '.45' : '1'}"
    onmouseover="if(!this.style.background.includes('184')){this.style.background='rgba(255,255,255,.03)'}"
    onmouseout="if(!this.style.background.includes('184')){this.style.background='transparent'}">
    <span style="font-size:1rem;flex-shrink:0">${s.icone||'📖'}</span>
    <span style="font-size:.83rem;color:${isActive?'var(--gold)':'var(--text)'};
      font-weight:${isActive?'600':'400'};flex:1;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis">${s.titre||'Section'}</span>
    ${isHidden ? `<span style="font-size:.6rem;color:#ff6b6b;flex-shrink:0">●</span>` : ''}
    ${STATE.isAdmin ? `
    <div class="world-nav-actions" style="display:none;gap:.2rem;flex-shrink:0">
      <button onclick="event.stopPropagation();openWorldSectionModal('${s.id}')"
        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.78rem;
        padding:1px 3px" title="Modifier">✏️</button>
      <button onclick="event.stopPropagation();deleteWorldSection('${s.id}')"
        style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.78rem;
        padding:1px 3px" title="Supprimer">🗑️</button>
    </div>` : ''}
  </div>`;
}

// ── Contenu d'une section ─────────────────────────────────────────────────────
function _renderSection(s) {
  const isHidden = s.visible === false;
  return `<div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);overflow:hidden;
    ${isHidden ? 'border-style:dashed;opacity:.75' : ''}">

    <!-- Image bannière -->
    ${s.imageUrl ? `
    <div style="width:100%;aspect-ratio:16/6;overflow:hidden;position:relative">
      <img src="${s.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 50%,rgba(11,17,24,.85))"></div>
    </div>` : ''}

    <!-- Header section -->
    <div style="padding:1.4rem 1.6rem ${s.imageUrl ? '.75rem' : '1rem'};
      ${s.imageUrl ? 'margin-top:-4rem;position:relative;z-index:1' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
        <div>
          <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.4rem">
            <span style="font-size:1.4rem">${s.icone||'📖'}</span>
            <h1 style="font-family:'Cinzel',serif;font-size:1.4rem;color:var(--gold);
              letter-spacing:1.5px;margin:0;line-height:1.2">${s.titre||'Section'}</h1>
          </div>
          ${isHidden ? `<span style="font-size:.7rem;color:#ff6b6b;
            background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);
            border-radius:4px;padding:1px 7px">🔒 Masquée aux joueurs</span>` : ''}
        </div>
        ${STATE.isAdmin ? `
        <div style="display:flex;gap:.4rem;flex-shrink:0">
          <button onclick="openWorldSectionModal('${s.id}')"
            class="btn btn-outline btn-sm" style="font-size:.72rem">✏️ Modifier</button>
          <button onclick="deleteWorldSection('${s.id}')"
            class="btn btn-outline btn-sm" style="font-size:.72rem;color:#ff6b6b;
            border-color:rgba(255,107,107,.3)">🗑️</button>
        </div>` : ''}
      </div>
    </div>

    <!-- Séparateur -->
    <div style="height:1px;background:var(--border);margin:0 1.6rem"></div>

    <!-- Contenu -->
    <div style="padding:1.2rem 1.6rem 1.6rem">
      ${s.contenu
        ? `<div style="font-size:.88rem;color:var(--text-muted);line-height:1.85;
            white-space:pre-wrap">${_esc(s.contenu)}</div>`
        : `<div style="color:var(--text-dim);font-style:italic;font-size:.85rem">
            Aucun contenu. ${STATE.isAdmin ? '<span style="color:var(--gold)">Cliquez sur Modifier pour ajouter du texte.</span>' : ''}</div>`}
    </div>
  </div>`;
}

function _renderEmpty() {
  return `<div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);padding:4rem 2rem;text-align:center">
    <div style="font-size:3rem;margin-bottom:1rem;opacity:.3">📖</div>
    <p style="color:var(--text-dim);font-style:italic;font-size:.85rem">
      ${STATE.isAdmin ? 'Aucune section. Ajoutez du lore depuis le bouton +.' : 'Aucun contenu disponible pour l\'instant.'}
    </p>
    ${STATE.isAdmin ? `<button onclick="openWorldSectionModal()" class="btn btn-gold btn-sm" style="margin-top:1rem">
      + Créer la première section</button>` : ''}
  </div>`;
}

// ── Sélection section ─────────────────────────────────────────────────────────
window.selectWorldSection = (id) => {
  _activeId = id;
  // Mettre à jour la nav
  document.querySelectorAll('[data-nav-id]').forEach(el => {
    const active = el.dataset.navId === id;
    el.style.background    = active ? 'rgba(232,184,75,.07)' : 'transparent';
    el.style.borderLeft    = `3px solid ${active ? 'var(--gold)' : 'transparent'}`;
    const span = el.querySelector('span:nth-child(2)');
    if (span) { span.style.color = active ? 'var(--gold)' : 'var(--text)'; span.style.fontWeight = active ? '600' : '400'; }
  });
  // Mettre à jour le contenu
  const section = _sections.find(s => s.id === id);
  const main = document.getElementById('world-main-content');
  if (main && section) main.innerHTML = _renderSection(section);
};

// ── Drag & drop nav (admin) ───────────────────────────────────────────────────
function _bindNavDrag() {
  const list = document.getElementById('world-nav-list');
  if (!list) return;

  list.addEventListener('dragstart', e => {
    const item = e.target.closest('[data-nav-idx]');
    if (!item) return;
    _dragIdx = parseInt(item.dataset.navIdx);
    e.dataTransfer.effectAllowed = 'move';
    item.style.opacity = '.4';
  });

  list.addEventListener('dragend', e => {
    const item = e.target.closest('[data-nav-idx]');
    if (item) item.style.opacity = '';
  });

  list.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    const target = e.target.closest('[data-nav-idx]');
    if (!target || _dragIdx === null) return;
    const toIdx = parseInt(target.dataset.navIdx);
    if (_dragIdx === toIdx) return;
    const [moved] = _sections.splice(_dragIdx, 1);
    _sections.splice(toIdx, 0, moved);
    await _save();
    showNotif('Ordre mis à jour.', 'success');
    renderWorld();
  });

  // Afficher/masquer boutons ✏️ 🗑️ au survol
  list.addEventListener('mouseover', e => {
    const item = e.target.closest('[data-nav-id]');
    if (!item) return;
    const actions = item.querySelector('.world-nav-actions');
    if (actions) actions.style.display = 'flex';
  });
  list.addEventListener('mouseout', e => {
    const item = e.target.closest('[data-nav-id]');
    if (!item) return;
    const actions = item.querySelector('.world-nav-actions');
    if (actions) actions.style.display = 'none';
  });
}

// ── Modal création / édition section ─────────────────────────────────────────
window.openWorldSectionModal = (id = null) => {
  const s = id ? _sections.find(sec => sec.id === id) : null;

  const iconGrid = ICONES.map(ic => `
    <button type="button" id="wi-icon-${ic}" onclick="window._selectWorldIcon('${ic}')"
      style="width:34px;height:34px;border-radius:8px;font-size:1.1rem;cursor:pointer;
      border:2px solid ${(s?.icone||'📖')===ic?'var(--gold)':'var(--border)'};
      background:${(s?.icone||'📖')===ic?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
      transition:all .1s;display:flex;align-items:center;justify-content:center">${ic}</button>
  `).join('');

  openModal(s ? `✏️ Modifier — ${s.titre||'Section'}` : '+ Nouvelle section', `
    <input type="hidden" id="wi-id" value="${s?.id||''}">
    <input type="hidden" id="wi-icon" value="${s?.icone||'📖'}">

    <div class="form-group">
      <label>Icône</label>
      <div style="display:flex;flex-wrap:wrap;gap:.3rem">${iconGrid}</div>
    </div>

    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="wi-titre" value="${_esc(s?.titre||'')}"
        placeholder="Histoire du monde…">
    </div>

    <div class="form-group">
      <label>Contenu <span style="color:var(--text-dim);font-weight:400">(texte libre)</span></label>
      <textarea class="input-field" id="wi-contenu" rows="8"
        placeholder="Décris ce chapitre du lore…">${_esc(s?.contenu||'')}</textarea>
    </div>

    <div class="form-group">
      <label>Image bannière <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
      <div id="wi-img-drop" style="border:2px dashed var(--border-strong);border-radius:10px;
        padding:.85rem;text-align:center;cursor:pointer;background:var(--bg-elevated);
        transition:border-color .15s">
        <div id="wi-img-preview"></div>
      </div>
      <div id="wi-crop-wrap" style="display:none;margin-top:.6rem">
        <canvas id="wi-crop-canvas" style="display:block;width:100%;border-radius:8px;
          cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" id="wi-crop-confirm" style="width:100%;margin-top:.4rem">✂️ Confirmer</button>
        <div id="wi-crop-ok" style="display:none;font-size:.73rem;text-align:center;margin-top:3px"></div>
      </div>
      ${s?.imageUrl ? `<button type="button" id="wi-img-clear"
        style="margin-top:.3rem;font-size:.72rem;background:none;border:none;
        cursor:pointer;color:#ff6b6b">✕ Retirer l'image</button>` : ''}
    </div>

    <label style="display:flex;align-items:center;gap:.6rem;margin-bottom:1rem;
      padding:.55rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);
      border-radius:8px;cursor:pointer;font-size:.84rem;color:var(--text-muted)">
      <input type="checkbox" id="wi-hidden" ${s?.visible===false?'checked':''}
        style="accent-color:#ff6b6b">
      <span>🔒 Masquée aux joueurs</span>
    </label>

    <div style="display:flex;gap:.5rem">
      <button class="btn btn-gold" style="flex:1" onclick="window.saveWorldSection()">
        ${s ? 'Enregistrer' : 'Créer la section'}
      </button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);

  // Upload + crop bannière (ratio libre, cadrage initial 16:6)
  _wiCropper?.destroy();
  _wiCropper = attachDropAndCrop({
    dropEl:        document.getElementById('wi-img-drop'),
    previewEl:     document.getElementById('wi-img-preview'),
    cropWrapEl:    document.getElementById('wi-crop-wrap'),
    canvasId:      'wi-crop-canvas',
    statusEl:      document.getElementById('wi-crop-ok'),
    confirmBtnEl:  document.getElementById('wi-crop-confirm'),
    clearBtnEl:    document.getElementById('wi-img-clear'),
    initialUrl:    s?.imageUrl || '',
    initialRatio:  { w: 16, h: 6 },
    maxDisplayW:   460,
    previewMaxH:   70,
    output:        { qualities: [0.82, 0.72, 0.60, 0.50] },
  });
};

window._selectWorldIcon = (ic) => {
  ICONES.forEach(i => {
    const btn = document.getElementById(`wi-icon-${i}`);
    if (!btn) return;
    btn.style.borderColor = i === ic ? 'var(--gold)' : 'var(--border)';
    btn.style.background  = i === ic ? 'rgba(232,184,75,.12)' : 'var(--bg-elevated)';
  });
  const inp = document.getElementById('wi-icon');
  if (inp) inp.value = ic;
};

window.saveWorldSection = async () => {
  const titre = document.getElementById('wi-titre')?.value?.trim();
  if (!titre) { showNotif('Un titre est requis.', 'error'); return; }

  const id      = document.getElementById('wi-id')?.value || `ws_${Date.now()}`;
  const isNew   = !document.getElementById('wi-id')?.value;
  const icone   = document.getElementById('wi-icon')?.value || '📖';
  const contenu = document.getElementById('wi-contenu')?.value || '';
  const hidden  = document.getElementById('wi-hidden')?.checked || false;

  // Résoudre l'image : nouveau crop > existante > effacée
  const existing = _sections.find(s => s.id === id);
  const cropResult = _wiCropper?.getResult();
  let imageUrl = existing?.imageUrl || '';
  if (typeof cropResult === 'string') imageUrl = cropResult;
  else if (cropResult === null)       imageUrl = '';
  _wiCropper?.destroy(); _wiCropper = null;

  const section = { id, titre, icone, contenu, imageUrl, visible: !hidden };

  if (isNew) {
    _sections.push(section);
  } else {
    const idx = _sections.findIndex(s => s.id === id);
    if (idx >= 0) _sections[idx] = section;
  }

  await _save();
  _activeId = id;
  closeModal();
  showNotif(isNew ? 'Section créée !' : 'Section mise à jour !', 'success');
  renderWorld();
};

window.deleteWorldSection = async (id) => {
  if (!await confirmModal('Supprimer cette section définitivement ?')) return;
  _sections = _sections.filter(s => s.id !== id);
  if (_activeId === id) _activeId = _sections[0]?.id || null;
  await _save();
  showNotif('Section supprimée.', 'success');
  renderWorld();
};

// ── Utilitaires ───────────────────────────────────────────────────────────────
// _esc → importé depuis shared/html.js (_escapeHtml supprimé)

// ── Override PAGES.world ──────────────────────────────────────────────────────
PAGES.world = renderWorld;

Object.assign(window, {
  renderWorld,
  openWorldSectionModal,
  saveWorldSection,
  deleteWorldSection,
  selectWorldSection,
});