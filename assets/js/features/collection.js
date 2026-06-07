import { STATE } from '../core/state.js';
import { loadCollection } from '../data/firestore.js';
import { confirmDelete, trySave, tryUpsert } from '../shared/crud.js';
import { registerActions } from '../core/actions.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, _nl2br, pageHeaderHtml } from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { uploadPng } from '../shared/image-upload.js';
import { makeSortable } from '../shared/sortable-helper.js';

// ── État local ───────────────────────────────────────────────────────────────
const STORE = {
  cards: [],
  templateUrl: '',   // dos de carte (image template partagée)
};
let _sortable = null;

async function loadSettings() {
  const settings = await loadCollection('collectionSettings');
  STORE.templateUrl = settings[0]?.templateUrl || '';
}

// Un joueur ne voit le visuel + les infos que si la carte est débloquée.
// Le MJ voit tout. Le défi peut être masqué (descMasquee) même débloqué.
const _canSeeFace      = (c) => STATE.isAdmin || !!c.unlocked;
const _challengeMasked = (c) => !!c.descMasquee && !STATE.isAdmin;

// ── Rendu principal ──────────────────────────────────────────────────────────
export async function renderCollectionPage() {
  const [cards] = await Promise.all([
    loadCollection('collection'),
    loadSettings(),
  ]);

  STORE.cards = [...cards].sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999));

  const content = document.getElementById('main-content');
  const unlocked = STORE.cards.filter(c => c.unlocked).length;

  let html = pageHeaderHtml(
    '🃏 Collection',
    STORE.cards.length
      ? `${unlocked}/${STORE.cards.length} carte${STORE.cards.length > 1 ? 's' : ''} débloquée${unlocked > 1 ? 's' : ''}`
      : 'Cartes à collectionner'
  );

  if (STATE.isAdmin) {
    html += `
      <div class="admin-section">
        <div class="admin-label">Gestion Admin</div>
        <button class="btn btn-gold btn-sm" data-action="openCollectionModal">+ Ajouter une carte</button>
        <button class="btn btn-outline btn-sm" data-action="openTemplateModal">🖼️ Dos de carte</button>
        <span class="coll-hint">↔ Glisse-dépose une carte pour la réordonner</span>
      </div>`;
  }

  if (STORE.cards.length === 0) {
    html += emptyStateHtml('🃏', 'La collection est vide.');
    content.innerHTML = html;
    return;
  }

  html += `<div class="collection-grid">${STORE.cards.map(_cardHtml).join('')}</div>`;
  content.innerHTML = html;

  // Drag & drop (MJ) → réordonne et persiste l'ordre partagé
  const grid = content.querySelector('.collection-grid');
  if (grid && STATE.isAdmin) {
    _sortable = makeSortable(grid, {
      prefix: 'coll',
      draggable: '.coll-card-wrapper',
      handle: '.coll-card',
      onEnd: () => _persistOrder(),
    });
  }
}

// ── HTML d'une carte (recto = visuel, verso = nom + défi) ────────────────────
function _cardHtml(c) {
  const seeFace = _canSeeFace(c);
  const masked  = _challengeMasked(c);
  const back    = STORE.templateUrl || '';

  // Recto
  let front;
  if (seeFace) {
    front = c.imageUrl
      ? `<img src="${_esc(c.imageUrl)}" loading="lazy" decoding="async" alt="${_esc(c.nom || '')}">`
      : `<span class="coll-emoji">${_esc(c.emoji || '🃏')}</span>`;
  } else {
    front = back
      ? `<img src="${_esc(back)}" loading="lazy" decoding="async" alt="Carte à débloquer">`
      : `<span class="coll-emoji coll-emoji--locked">🔒</span>`;
  }

  // Verso (infos)
  let back2;
  if (!seeFace) {
    back2 = `<div class="coll-back-info coll-back-info--mystery">
      <div class="coll-back-ic">🔒</div>
      <div class="coll-back-title">À débloquer</div>
      <div class="coll-back-sub">Relève le défi pour la révéler</div>
    </div>`;
  } else {
    const defi = masked
      ? `<div class="coll-defi coll-defi--masked">🔒 Défi gardé secret</div>`
      : (c.description
          ? `<div class="coll-defi">${_nl2br(_esc(c.description))}</div>`
          : `<div class="coll-defi coll-defi--empty">Aucun défi renseigné.</div>`);
    back2 = `<div class="coll-back-info">
      <div class="coll-back-title">${_esc(c.nom || 'Carte')}</div>
      <div class="coll-back-label">Défi à relever</div>
      ${defi}
    </div>`;
  }

  const badges = STATE.isAdmin ? `
    ${c.unlocked ? '' : '<span class="coll-badge coll-badge--locked">🔒</span>'}
    ${c.descMasquee ? '<span class="coll-badge coll-badge--masked">🙈</span>' : ''}` : '';

  const adminBtns = STATE.isAdmin ? `
    <div class="coll-admin-btns">
      <button class="btn-icon" data-action="editCard" data-id="${c.id}" data-stop-propagation title="Modifier">✏️</button>
      <button class="btn-icon" data-action="toggleUnlock" data-id="${c.id}" data-stop-propagation title="${c.unlocked ? 'Verrouiller' : 'Débloquer'}">${c.unlocked ? '🔓' : '🔒'}</button>
      <button class="btn-icon" data-action="deleteCard" data-id="${c.id}" data-stop-propagation title="Supprimer">🗑️</button>
    </div>` : '';

  return `
    <div class="coll-card-wrapper" data-id="${c.id}">
      <div class="coll-card ${c.unlocked ? 'unlocked' : 'locked'}" data-action="viewCard" data-id="${c.id}">
        <div class="coll-card-inner">
          <div class="coll-card-front">${front}<span class="coll-shine"></span></div>
          <div class="coll-card-back">${back2}</div>
        </div>
        ${badges}
      </div>
      <div class="coll-card-foot">
        <span class="coll-name" title="${_esc(c.nom || '')}">${seeFace ? _esc(c.nom || 'Carte') : '???'}</span>
        <button class="coll-present-btn" data-action="presentCard" data-id="${c.id}" data-stop-propagation
          title="Présenter en grand" aria-label="Présenter ${_esc(c.nom || 'la carte')} en grand">⛶</button>
      </div>
      ${adminBtns}
    </div>`;
}

// ── Flip recto/verso ─────────────────────────────────────────────────────────
function viewCard(id) {
  document.querySelector(`.coll-card[data-id="${id}"]`)?.classList.toggle('flipped');
}

// ── Présentation plein cadre ─────────────────────────────────────────────────
function presentCard(id) {
  const c = STORE.cards.find(x => x.id === id);
  if (!c) return;
  const seeFace = _canSeeFace(c);
  const masked  = _challengeMasked(c);
  const img     = seeFace ? (c.imageUrl || '') : (STORE.templateUrl || '');
  const title   = seeFace ? (c.nom || 'Carte') : 'Carte mystère';

  const art = img
    ? `<img src="${_esc(img)}" alt="${_esc(title)}">`
    : `<span class="coll-emoji">${_esc(seeFace ? (c.emoji || '🃏') : '🔒')}</span>`;

  let defi;
  if (!seeFace)      defi = `<p class="coll-present-defi coll-present-defi--mystery">Relève le défi associé pour révéler cette carte et son contenu.</p>`;
  else if (masked)   defi = `<p class="coll-present-defi coll-present-defi--masked">🔒 Le MJ garde ce défi secret pour l'instant.</p>`;
  else               defi = c.description
                       ? `<p class="coll-present-defi">${_nl2br(_esc(c.description))}</p>`
                       : `<p class="coll-present-defi coll-present-defi--empty">Aucun défi renseigné.</p>`;

  const status = c.unlocked
    ? `<span class="coll-present-status is-on">✓ Débloquée</span>`
    : `<span class="coll-present-status is-off">🔒 Verrouillée</span>`;

  openModal(`🃏 ${title}`, `
    <div class="coll-present">
      <div class="coll-present-card ${c.unlocked ? 'unlocked' : 'locked'}">
        <div class="coll-present-art">${art}<span class="coll-shine"></span></div>
      </div>
      <div class="coll-present-info">
        <div class="coll-present-head">
          <h3 class="coll-present-name">${_esc(title)}</h3>
          ${STATE.isAdmin ? status : ''}
        </div>
        <div class="coll-present-label">Défi à relever</div>
        ${defi}
        ${STATE.isAdmin ? `<div class="coll-present-admin">
          <button class="btn btn-outline btn-sm" data-action="editCard" data-id="${c.id}">✏️ Modifier</button>
        </div>` : ''}
      </div>
    </div>
  `);
  document.getElementById('modal-box')?.classList.add('modal--coll-present');
}

// ── Réordonnancement (persiste l'ordre seulement pour les cartes déplacées) ──
async function _persistOrder() {
  const ids = [...document.querySelectorAll('.collection-grid .coll-card-wrapper')].map(el => el.dataset.id);
  const writes = [];
  ids.forEach((id, idx) => {
    const card = STORE.cards.find(c => c.id === id);
    if (card && card.ordre !== idx) {
      card.ordre = idx;
      writes.push(trySave('collection', id, { ordre: idx }));
    }
  });
  if (writes.length) await Promise.all(writes);
  STORE.cards.sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999));
}

// ── Débloquer / verrouiller ──────────────────────────────────────────────────
async function toggleUnlock(id) {
  const card = STORE.cards.find(c => c.id === id);
  if (!card) return;
  if (await trySave('collection', id, { unlocked: !card.unlocked })) {
    showNotif(card.unlocked ? 'Carte verrouillée.' : '🎉 Carte débloquée !', 'success');
  }
  closeModal();
  await renderCollectionPage();
}

// ── Dos de carte (template) ──────────────────────────────────────────────────
function openTemplateModal() {
  openModal('🖼️ Dos de carte', `
    <p class="coll-modal-hint">Image affichée au dos des cartes et sur les cartes non encore débloquées.</p>
    <div class="form-group"><label>Image du dos</label>
      <div class="sh-upload-simple">
        <input type="file" id="tpl-img-file" accept="image/*" data-change="previewUploadPng" data-preview="tpl-img-preview" data-b64="tpl-img-b64">
        <input type="hidden" id="tpl-img-b64">
      </div>
      <div id="tpl-img-preview">${STORE.templateUrl ? `<img src="${_esc(STORE.templateUrl)}" style="max-height:160px;margin-top:.4rem;display:block;border-radius:10px">` : ''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveTemplate">Enregistrer</button>
  `);
  const hidden = document.getElementById('tpl-img-b64');
  if (hidden) hidden.value = STORE.templateUrl;
}

async function saveTemplate() {
  const url = document.getElementById('tpl-img-b64')?.value || '';
  const settings = await loadCollection('collectionSettings');
  if (await tryUpsert('collectionSettings', settings[0]?.id || null, { templateUrl: url })) {
    STORE.templateUrl = url;
    closeModal();
    showNotif('Dos de carte mis à jour.', 'success');
    await renderCollectionPage();
  }
}

// ── Ajout / édition d'une carte ──────────────────────────────────────────────
function openCollectionModal(card = null) {
  openModal(card ? '✏️ Modifier la carte' : '🃏 Nouvelle carte', `
    <div class="form-group"><label>Nom</label>
      <input class="input-field" id="cc-nom" value="${_esc(card?.nom || '')}" placeholder="Nom de la carte">
    </div>
    <div class="form-group"><label>Description / Défi à relever</label>
      <textarea class="input-field" id="cc-desc" rows="4" placeholder="Ex : Vaincre le dragon de cendres sans tomber au combat…">${_esc(card?.description || '')}</textarea>
    </div>
    <label class="coll-check">
      <input type="checkbox" id="cc-masque" ${card?.descMasquee ? 'checked' : ''}>
      <span>🙈 Masquer le défi aux joueurs <em>(le nom reste visible, le défi s'affiche « secret »)</em></span>
    </label>
    <div class="form-group"><label>Image recto <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <div class="sh-upload-simple">
        <input type="file" id="cat-img-file" accept="image/*" data-change="previewUploadPng" data-preview="sc-img-preview" data-b64="cat-img-b64">
        <input type="hidden" id="cat-img-b64" value="${_esc(card?.imageUrl || '')}">
      </div>
      <div id="sc-img-preview">${card?.imageUrl ? `<img src="${_esc(card.imageUrl)}" style="max-height:120px;margin-top:.4rem;display:block;border-radius:8px">` : ''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveCard" data-id="${card?.id || ''}">Enregistrer</button>
  `);
}

async function saveCard(id = '') {
  // Édition = patch (merge) : on NE touche PAS unlocked/ordre (sinon on reverrouille).
  const data = {
    nom:         document.getElementById('cc-nom')?.value?.trim() || 'Carte',
    imageUrl:    document.getElementById('cat-img-b64')?.value || '',
    description: document.getElementById('cc-desc')?.value || '',
    descMasquee: !!document.getElementById('cc-masque')?.checked,
  };
  if (!id) {                       // nouvelle carte : verrouillée, ajoutée en fin
    data.unlocked = false;
    data.ordre = STORE.cards.length;
  }
  if (await tryUpsert('collection', id || null, data)) {
    closeModal();
    showNotif('Carte enregistrée.', 'success');
    await renderCollectionPage();
  }
}

function editCard(id) {
  const card = STORE.cards.find(c => c.id === id);
  if (card) openCollectionModal(card);
}

async function deleteCard(id) {
  if (!await confirmDelete('collection', id, 'Supprimer cette carte ?')) return;
  closeModal();
  showNotif('Carte supprimée.', 'success');
  await renderCollectionPage();
}

registerActions({
  openCollectionModal: () => openCollectionModal(),
  openTemplateModal:   () => openTemplateModal(),
  saveTemplate:        () => saveTemplate(),
  saveCard:     (btn) => saveCard(btn.dataset.id || ''),
  viewCard:     (btn) => viewCard(btn.dataset.id),
  presentCard:  (btn) => presentCard(btn.dataset.id),
  editCard:     (btn) => editCard(btn.dataset.id),
  toggleUnlock: (btn) => toggleUnlock(btn.dataset.id),
  deleteCard:   (btn) => deleteCard(btn.dataset.id),
  previewUploadPng: (el) => { const f = document.getElementById(el.id)?.files?.[0]; if (f) uploadPng(f, { previewId: el.dataset.preview, hiddenId: el.dataset.b64 }); },
});
