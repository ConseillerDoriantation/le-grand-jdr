// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// ✓ Upload + redimensionnement image (ratio libre, max 1400px, fond flou à l'affichage)
// ✓ Hauts-faits sans image affichés correctement (emoji + fond)
// ✓ Drag & drop SortableJS pour réordonner, ordre persisté dans Firestore
// ✓ Ordre partagé pour tous les utilisateurs
// ══════════════════════════════════════════════════════════════════════════════
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { confirmDelete, tryDoc } from '../shared/crud.js';
import { loadCollection, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { watchPageCollection, watchPageDoc } from '../shared/realtime.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { STATE } from '../core/state.js';
import { attachDropAndResize } from '../shared/image-crop.js';
import { sortCharactersForDisplay } from '../shared/char-stats.js';
import { characterAvatarHtml, characterPortraitContent } from '../shared/portraits.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const CATS = [
  { id: 'epique',   label: '⚔️ Épique',   color: '#4f8cff', glow: 'rgba(79,140,255,0.14)'  },
  { id: 'comique',  label: '🎭 Comique',  color: '#e8b84b', glow: 'rgba(232,184,75,0.14)'  },
  { id: 'histoire', label: '📖 Histoire', color: '#22c38e', glow: 'rgba(34,195,142,0.14)'  },
];


const STORE = {
  items:         [],        // hauts-faits affichés (public + secret fusionnés, MJ)
  publicItems:   [],        // miroir de la collection `achievements` (lue par tous)
  secretItems:   [],        // sous-collection `achievements_secret` (MJ-only), [] côté joueur
  missions:      [],        // missions de la Trame disponibles pour les liaisons
  lightboxItems: {},        // { [catId]: item[] } cache lightbox
  filter:        'all',     // 'all' | 'epique' | 'comique' | 'histoire'
  charFilter:    'all',     // 'all' | charId
  view:          'galerie', // 'galerie' | 'timeline'
  search:        '',
  timelineDesc:  false,     // true = plus récent en haut
  order:         [],        // miroir de l'ordre Firestore
};

let _achRowSortables = [];
let _achDragBlockClick = false;
let _achClickGuardInstalled = false;
let _achUploader = null;

let _achSelectCat = () => {};
let _achToggleContrib = () => {};

export function getAchievementsShellState() {
  return { items: STORE.items, filter: STORE.filter, view: STORE.view, search: STORE.search };
}

function _missionFor(item) {
  return item?.missionId ? (STORE.missions || []).find(m => m.id === item.missionId) : null;
}

// Icône selon le type d'élément de Trame
function _trameIco(m) { return m?.type === 'event' ? '📖' : '🎯'; }
// Méta discrète (acte · date) d'un élément de Trame
function _trameMeta(m) {
  return [m?.acte || 'Acte I', m?.date].filter(Boolean).join(' · ');
}

function _missionLinkHtml(item, className = 'ach-mission-link') {
  const mission = _missionFor(item);
  if (!mission) return '';
  return "<button type=\"button\" class=\"" + className + "\" data-action=\"_achOpenMission\" data-id=\"" + mission.id + "\" data-stop-propagation>" + _trameIco(mission) + " " + _esc(mission.titre || 'Mission') + "</button>";
}

// Normalisation recherche : minuscules sans accents
function _normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Sélecteur custom d'élément de Trame (vignette + titre + méta) ─────────────
let _achPickItems = [];   // éléments de Trame proposés (missions + événements)
let _achTogglePick = () => {};
let _achPickSelect = () => {};
let _achPickSearch = () => {};

function _achPickArt(m, size = 34) {
  return m?.imageUrl
    ? `<span class="achm-pick-art"><img src="${_esc(m.imageUrl)}" alt=""></span>`
    : `<span class="achm-pick-art achm-pick-art--ph">${_trameIco(m)}</span>`;
}
function _achPickTriggerHtml(m) {
  if (!m) return `<span class="achm-pick-empty">Aucun élément lié — cliquer pour choisir</span>`;
  return `${_achPickArt(m)}
    <span class="achm-pick-txt">
      <span class="achm-pick-title">${_esc(m.titre || 'Sans titre')}</span>
      <span class="achm-pick-meta">${_trameIco(m)} ${m.type === 'event' ? 'Événement' : 'Mission'} · ${_esc(_trameMeta(m))}</span>
    </span>
    <span class="achm-pick-caret">▾</span>`;
}
function _achPickOptionHtml(m, selectedId) {
  return `<button type="button" class="achm-pick-opt ${m.id === selectedId ? 'is-active' : ''}"
    data-action="_achPickSelect" data-id="${m.id}">
    ${_achPickArt(m)}
    <span class="achm-pick-txt">
      <span class="achm-pick-title">${_esc(m.titre || 'Sans titre')}</span>
      <span class="achm-pick-meta">${_trameIco(m)} ${m.type === 'event' ? 'Événement' : 'Mission'} · ${_esc(_trameMeta(m))}</span>
    </span>
  </button>`;
}

async function _achOpenMission(id) {
  document.getElementById('ach-lightbox')?.remove();
  const { openStoryDetail } = await import('./story.js');
  openStoryDetail(id);
}

// ── MODAL PRINCIPAL ──────────────────────────────────────────────────────────
export function openAchievementModal(id = null) {
  const ex = id ? (STORE.items || []).find(a => a.id === id) : null;
  // Éléments de Trame liables : missions ET événements
  const trame = (STORE.missions || [])
    .filter(m => m.type === 'mission' || m.type === 'event')
    .sort((a, b) =>
      (a.acte || '').localeCompare(b.acte || '') ||
      (a.ordre || 0) - (b.ordre || 0) ||
      (a.date || '').localeCompare(b.date || ''));
  _achPickItems = trame;
  const curTrame = ex?.missionId ? trame.find(m => m.id === ex.missionId) : null;
  _achUploader?.destroy(); _achUploader = null;

  const curCat = CATS.find(c => c.id === (ex?.categorie || 'epique')) || CATS[0];

  openModal('', `
    <div class="achm">

      <!-- En-tête — aperçu live (façon Trame) -->
      <div class="achm-head" style="--cc:${curCat.color}">
        <div class="achm-head-art" id="ach-head-art">
          <img id="ach-head-img" alt="" ${ex?.imageUrl ? `src="${_esc(ex.imageUrl)}"` : 'style="display:none"'}>
          <span class="achm-head-emoji" id="ach-head-emoji" ${ex?.imageUrl ? 'style="display:none"' : ''}>${_esc(ex?.emoji || '🏆')}</span>
        </div>
        <div class="achm-head-info">
          <span class="achm-head-cat" id="ach-head-cat">${curCat.label}</span>
          <span class="achm-head-title" id="ach-head-title">${_esc(ex?.titre || 'Nouveau Haut-Fait')}</span>
          <span class="achm-head-sub">${id ? '✏️ Modification' : '🏆 Nouveau Haut-Fait'}</span>
        </div>
      </div>

      <!-- ── Identité ──────────────────────────────────────────── -->
      <div class="achm-section">
        <div class="achm-section-t">Identité</div>
        <div class="form-group">
          <label>Titre</label>
          <input class="input-field" id="ach-titre"
            value="${_esc(ex?.titre || '')}" placeholder="ex: L'œuf de Dragon">
        </div>
        <div class="form-group">
          <label>Catégorie</label>
          <div class="achm-cats">
            ${CATS.map(c => `<button type="button" id="ach-cat-${c.id}" class="achm-cat"
              data-action="_achSelectCat" data-id="${c.id}" style="--cc:${c.color}">${c.label}</button>`).join('')}
          </div>
          <input type="hidden" id="ach-categorie" value="${ex?.categorie || 'epique'}">
        </div>
        <div class="achm-grid2">
          <div class="form-group">
            <label>Emoji <span class="achm-hint">(si pas d'image)</span></label>
            <input class="input-field" id="ach-emoji"
              value="${_esc(ex?.emoji || '🏆')}" style="font-size:1.2rem">
          </div>
          <div class="form-group">
            <label>Date</label>
            <input type="date" class="input-field" id="ach-date"
              value="${id ? _toISO(ex?.date) : _todayISO()}">
          </div>
        </div>
      </div>

      <!-- ── Récit & lien Trame ───────────────────────────────── -->
      <div class="achm-section">
        <div class="achm-section-t">Récit & lien</div>
        <div class="form-group">
          <label>Description <span class="achm-hint">(visible par les joueurs)</span></label>
          <textarea class="input-field" id="ach-desc" rows="3"
            placeholder="Ce qui s'est passé...">${_esc(ex?.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Élément de la Trame <span class="achm-hint">(mission ou événement, optionnel)</span></label>
          <input type="hidden" id="ach-mission-id" value="${ex?.missionId || ''}">
          <div class="achm-pick" id="ach-pick">
            <button type="button" class="achm-pick-trigger" id="ach-pick-trigger" data-action="_achTogglePick">
              ${_achPickTriggerHtml(curTrame)}
            </button>
            <div class="achm-pick-menu" id="ach-pick-menu" hidden>
              <input class="input-field achm-pick-search" id="ach-pick-search"
                placeholder="Rechercher une mission / un événement…" data-input="_achPickSearch" autocomplete="off">
              <div class="achm-pick-list" id="ach-pick-list">
                <button type="button" class="achm-pick-opt achm-pick-opt--none ${!ex?.missionId ? 'is-active' : ''}"
                  data-action="_achPickSelect" data-id="">✕ Aucun élément lié</button>
                ${trame.map(m => _achPickOptionHtml(m, ex?.missionId || '')).join('')}
              </div>
            </div>
          </div>
          <div class="achm-hint achm-hint--block">🔗 Relier ce haut-fait à une mission ou un événement le fait apparaître dans la fiche de cet élément (Trame) — et l'élément s'affiche ici. C'est ainsi qu'on relie « ce qui s'est passé » à « ce qu'on en retient ».</div>
        </div>
      </div>

      <!-- ── Illustration ─────────────────────────────────────── -->
      <div class="achm-section">
        <div class="achm-section-t">Illustration</div>
        <div id="ach-drop-zone" class="achm-drop">
          <div id="ach-drop-preview"></div>
          <div class="achm-drop-meta">JPG · PNG · WebP — max 5 Mo</div>
        </div>
        <div id="ach-img-ready" class="achm-img-ready" style="display:none"></div>
      </div>

      ${STATE.isAdmin ? `
      <div class="achm-section">
        <div class="achm-secret">
          <input type="checkbox" id="ach-secret" ${ex?.secret ? 'checked' : ''}>
          <label for="ach-secret">
            <span class="achm-secret-t">🔒 Haut-Fait secret (MJ uniquement)</span>
            <span class="achm-secret-d">Caché aux joueurs jusqu'à la révélation. Utile pour les prophéties, twists, récompenses surprise.</span>
          </label>
        </div>
      </div>` : ''}

      ${(() => {
        const chars = sortCharactersForDisplay(STATE.characters || []);
        if (!chars.length) return '';
        const contrib = ex?.contributeurs || [];
        const COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
        return `<div class="achm-section">
          <div class="achm-section-t">Personnages contributeurs <span class="achm-hint">(optionnel)</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:.5rem;margin-top:.3rem">
            ${chars.map(c => {
              const isOn = contrib.includes(c.id);
              const col  = COLS[c.nom?.charCodeAt(0)%6||0];
              return `<div data-action="_achToggleContrib" data-id="${c.id}"
                id="ach-contrib-${c.id}"
                data-contrib-nom="${(c.nom||'?').replace(/"/g,'&quot;')}"
                style="display:flex;flex-direction:column;align-items:center;gap:.3rem;
                  padding:.5rem .3rem;border-radius:10px;cursor:pointer;transition:all .15s;
                  border:2px solid ${isOn?col:'var(--border)'};
                  background:${isOn?col+'18':'var(--bg-elevated)'}">
                ${characterAvatarHtml(c, {
                  size: 44,
                  border: `2px solid ${isOn ? col : 'rgba(255,255,255,.1)'}`,
                  color: col,
                })}
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

      <button class="btn btn-gold achm-save"
        data-action="saveAchievement" data-id="${id || ''}">
        ${id ? 'Enregistrer les modifications' : 'Créer le Haut-Fait'}
      </button>
    </div>
    `
  );

  // Aperçu live de l'en-tête
  const _headTitle = document.getElementById('ach-head-title');
  const _headEmoji = document.getElementById('ach-head-emoji');
  const _headImg   = document.getElementById('ach-head-img');
  const _headCat   = document.getElementById('ach-head-cat');
  const _headWrap  = document.querySelector('.achm-head');
  document.getElementById('ach-titre')?.addEventListener('input', e => {
    if (_headTitle) _headTitle.textContent = e.target.value.trim() || 'Nouveau Haut-Fait';
  });
  document.getElementById('ach-emoji')?.addEventListener('input', e => {
    if (_headEmoji) _headEmoji.textContent = e.target.value.trim() || '🏆';
  });

  // Sélecteur d'élément de Trame (custom)
  _achTogglePick = () => {
    const menu = document.getElementById('ach-pick-menu');
    if (!menu) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    document.getElementById('ach-pick')?.classList.toggle('is-open', willOpen);
    if (willOpen) {
      const s = document.getElementById('ach-pick-search');
      if (s) { s.value = ''; _achPickSearch(''); setTimeout(() => s.focus(), 0); }
    }
  };
  _achPickSelect = (pickId) => {
    const hidden = document.getElementById('ach-mission-id');
    if (hidden) hidden.value = pickId || '';
    const trigger = document.getElementById('ach-pick-trigger');
    if (trigger) trigger.innerHTML = _achPickTriggerHtml(_achPickItems.find(m => m.id === pickId) || null);
    document.querySelectorAll('#ach-pick-list .achm-pick-opt').forEach(b =>
      b.classList.toggle('is-active', (b.dataset.id || '') === (pickId || '')));
    const menu = document.getElementById('ach-pick-menu');
    if (menu) menu.hidden = true;
    document.getElementById('ach-pick')?.classList.remove('is-open');
  };
  _achPickSearch = (raw) => {
    const q = _normalize(raw);
    document.querySelectorAll('#ach-pick-list .achm-pick-opt').forEach(b => {
      if (b.classList.contains('achm-pick-opt--none')) return;
      const m = _achPickItems.find(x => x.id === b.dataset.id);
      const hay = _normalize([m?.titre, m?.acte, m?.date].filter(Boolean).join(' '));
      b.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  };

  // Sélecteur catégorie
  _achSelectCat = (catId) => {
    document.getElementById('ach-categorie').value = catId;
    let active = null;
    CATS.forEach(c => {
      const btn = document.getElementById(`ach-cat-${c.id}`);
      const on  = c.id === catId;
      if (on) active = c;
      if (!btn) return;
      btn.classList.toggle('is-active', on);
    });
    // Sync en-tête
    if (active) {
      if (_headCat) _headCat.textContent = active.label;
      if (_headWrap) _headWrap.style.setProperty('--cc', active.color);
    }
  };
  _achSelectCat(ex?.categorie || 'epique');

  _achToggleContrib = (charId) => {
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

  // ── Upload + redimensionnement (max 1400px, JPEG .88, pas de crop) ────────
  _achUploader = attachDropAndResize({
    dropEl:       document.getElementById('ach-drop-zone'),
    previewEl:    document.getElementById('ach-drop-preview'),
    statusEl:     document.getElementById('ach-img-ready'),
    initialUrl:   ex?.imageUrl || '',
    resize:       { maxW: 1400, quality: 0.88 },
    maxFileSize:  5 * 1024 * 1024,
    onError:      (err) => showNotif(err.message || 'Image trop lourde.', 'error'),
    onResult:     (b64) => {
      // Reflète l'image (ou son retrait) dans l'aperçu d'en-tête
      if (_headImg)   { _headImg.src = b64 || ''; _headImg.style.display = b64 ? '' : 'none'; }
      if (_headEmoji) { _headEmoji.style.display = b64 ? 'none' : ''; }
    },
  });
}

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveAchievement(id = '') {
  try {
    const titre = document.getElementById('ach-titre')?.value?.trim();
    if (!titre) { showNotif('Le titre est requis.', 'error'); return; }

    const uploaded = _achUploader?.getResult();
    const ex = id ? (STORE.items || []).find(a => a.id === id) : null;
    const imageUrl = typeof uploaded === 'string' ? uploaded : (ex?.imageUrl || '');

    const contribRaw = document.getElementById('ach-contributeurs')?.value || '';
    const contributeurs = contribRaw ? contribRaw.split(',').filter(Boolean) : [];
    const payload = {
      titre,
      categorie:    document.getElementById('ach-categorie')?.value || 'epique',
      description:  document.getElementById('ach-desc')?.value?.trim()  || '',
      imageUrl,
      emoji:        document.getElementById('ach-emoji')?.value?.trim() || '🏆',
      // Date : on conserve la valeur du champ. En édition, si le champ est vide
      // alors que le haut-fait avait une date legacy non affichable (format FR),
      // on ne l'écrase pas par du vide.
      date:         (() => {
        const v = document.getElementById('ach-date')?.value?.trim() || '';
        if (v) return v;
        return (id && ex?.date && !_toISO(ex.date)) ? ex.date : '';
      })(),
      missionId:    document.getElementById('ach-mission-id')?.value || '',
      contributeurs,
      secret:       !!document.getElementById('ach-secret')?.checked,
    };

    // Un HF secret vit dans `achievements_secret` (MJ-only) ; sinon dans la
    // collection publique lue par les joueurs.
    const newCol = payload.secret ? 'achievements_secret' : 'achievements';

    let docId = id;
    if (!id) {
      docId = `ach_${Date.now()}`;
      await saveDoc(newCol, docId, payload);
      const order = await _loadOrder();
      order.push(docId);
      await _saveOrder(order);
    } else {
      const oldCol = (ex && ex.secret) ? 'achievements_secret' : 'achievements';
      await saveDoc(newCol, docId, payload);
      // Toggle secret↔public = déplacement : on a écrit la nouvelle collection,
      // on nettoie l'ancienne.
      if (oldCol !== newCol) {
        try { await deleteFromCol(oldCol, docId); }
        catch (e) { console.warn('[ach] nettoyage déplacement', docId, e); }
      }
    }
    _storeUpsert(docId, payload);

    _achUploader?.destroy(); _achUploader = null;
    closeModal();
    showNotif(id ? 'Haut-Fait mis à jour.' : `"${titre}" ajouté !`, 'success');
    await PAGES.achievements();
  } catch (e) { notifySaveError(e); }
}

// ── ÉDITER ────────────────────────────────────────────────────────────────────
async function editAchievement(id) {
  if (!STORE.items?.length) {
    STORE.publicItems = await loadCollection('achievements').catch(() => []);
    if (STATE.isAdmin) STORE.secretItems = await loadCollection('achievements_secret').catch(() => []);
    STORE.items = _composeItems();
  }
  openAchievementModal(id);
}

// ── SUPPRIMER ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  try {
    const col = (STORE.secretItems || []).some(a => a.id === id) ? 'achievements_secret' : 'achievements';
    if (!await confirmDelete(col, id, 'Supprimer ce haut-fait définitivement ?')) return;
    STORE.publicItems = (STORE.publicItems || []).filter(a => a.id !== id);
    STORE.secretItems = (STORE.secretItems || []).filter(a => a.id !== id);
    if (STORE.items) STORE.items = STORE.items.filter(a => a.id !== id);
    const order = (await _loadOrder()).filter(oid => oid !== id);
    await _saveOrder(order);
    showNotif('Haut-Fait supprimé.', 'success');
    await PAGES.achievements();
  } catch (e) { notifySaveError(e); }
}

// ── ORDRE ─────────────────────────────────────────────────────────────────────
async function _loadOrder() {
  const doc = await getDocData('achievements_meta', 'order');
  return Array.isArray(doc?.order) ? doc.order : [];
}
const _saveOrder = (order) => tryDoc('achievements_meta', 'order', { order });
function _applyOrder(items, order) {
  if (!order.length) return items;
  const map     = Object.fromEntries(items.map(a => [a.id, a]));
  const ordered = order.filter(id => map[id]).map(id => map[id]);
  const rest    = items.filter(a => !order.includes(a.id));
  return [...ordered, ...rest];
}

// Fusionne la source publique (`achievements`) et secrète (`achievements_secret`,
// MJ-only) en un seul tableau ordonné. Côté joueur, secretItems = [] → no-op.
function _composeItems() {
  return _applyOrder(
    [...(STORE.publicItems || []), ...(STORE.secretItems || [])],
    STORE.order || [],
  );
}

// Upsert local après écriture : retire l'id des deux sources, le replace dans la
// bonne selon `payload.secret`, puis recompose STORE.items.
function _storeUpsert(id, payload) {
  STORE.publicItems = (STORE.publicItems || []).filter(a => a.id !== id);
  STORE.secretItems = (STORE.secretItems || []).filter(a => a.id !== id);
  (payload.secret ? STORE.secretItems : STORE.publicItems).push({ id, ...payload });
  STORE.items = _composeItems();
}

function _sortAchievementsByDate(items, desc = false) {
  return [...items]
    .map((item, idx) => ({ item, idx, ts: parseDate(item.date) }))
    .sort((a, b) => {
      if (!a.ts && !b.ts) return a.idx - b.idx;
      if (!a.ts) return 1;
      if (!b.ts) return -1;
      return desc ? b.ts - a.ts || a.idx - b.idx : a.ts - b.ts || a.idx - b.idx;
    })
    .map(entry => entry.item);
}

function _refreshAchievementCounters() {
  const all = STORE.items || [];
  const visible = STATE.isAdmin ? all : all.filter(a => !a.secret);
  const counts = { all: visible.length };
  CATS.forEach(c => {
    counts[c.id] = visible.filter(a => (a.categorie || 'epique') === c.id).length;
  });
  document.querySelectorAll('.hall-counter[data-filter]').forEach(el => {
    const num = el.querySelector('.hall-counter-num');
    if (num) num.textContent = counts[el.dataset.filter] ?? 0;
  });
}

function _mergeCategoryOrder(catId, catOrder, globalOrder) {
  const allIds      = (STORE.items || []).map(a => a.id);
  const globalIds   = globalOrder.filter(id => allIds.includes(id));
  const missingIds  = allIds.filter(id => !globalIds.includes(id));
  const fullOrder   = [...globalIds, ...missingIds];
  const catIds     = new Set((STORE.items || [])
    .filter(a => (a.categorie || 'epique') === catId)
    .map(a => a.id));
  const cleanOrder = catOrder.filter(id => catIds.has(id));
  const others     = fullOrder.filter(id => !catIds.has(id));
  const lastCatIdx = Math.max(-1, ...fullOrder.map((id, i) => catIds.has(id) ? i : -1));
  const firstOther = fullOrder.find((id, i) => !catIds.has(id) && i > lastCatIdx);

  if (!firstOther) return [...others, ...cleanOrder];

  const idx = others.indexOf(firstOther);
  return [...others.slice(0, idx), ...cleanOrder, ...others.slice(idx)];
}

async function _persistCategoryOrder(catId, orderedIds) {
  const merged = _mergeCategoryOrder(catId, orderedIds, await _loadOrder());
  await _saveOrder(merged);
  STORE.items = _applyOrder(STORE.items || [], merged);
  return merged;
}

function _installAchievementClickGuard() {
  if (_achClickGuardInstalled) return;
  _achClickGuardInstalled = true;
  document.addEventListener('click', (e) => {
    if (!_achDragBlockClick) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function _finishAchievementDrag() {
  document.body.classList.remove('ach-dragging');
  setTimeout(() => { _achDragBlockClick = false; }, 350);
}

function _destroyAchievementSortables() {
  _achRowSortables.forEach(sortable => sortable?.destroy());
  _achRowSortables = [];
}


// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupAchievementsDnd(catId) {
  if (!STATE.isAdmin || !catId) {
    _destroyAchievementSortables();
    return;
  }
  const grid = document.getElementById('ach-gallery');
  if (!grid) return;

  _installAchievementClickGuard();
  _destroyAchievementSortables();

  grid.querySelectorAll('.ach-row').forEach(row => {
    _achRowSortables.push(makeSortable(row, {
      prefix: 'ach',
      animation: 120,
      filter: 'button, a, input, select, textarea, .btn, .btn-icon, .ach-admin-btns',
      group: `achievements-${catId}`,
      draggable: '.ach-sortable-item',
      onStart: () => { document.body.classList.add('ach-dragging'); _achDragBlockClick = true; },
      onEnd: async (evt) => {
        _finishAchievementDrag();
        if (evt.oldIndex === evt.newIndex && evt.from === evt.to) return;
        const domOrder = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
        await _persistCategoryOrder(catId, domOrder);
        showNotif('Ordre sauvegardé.', 'success');
        await _achRebuildGallery(catId);
      },
    }));
  });
}

// ── LIGHTBOX IMAGE ────────────────────────────────────────────────────────────
function _achOpenImage(url) {
  // Overlay plein écran avec l'image agrandie, clic ou Escape pour fermer
  const existing = document.getElementById('ach-lightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.className = 'ach-lightbox-basic';

  overlay.innerHTML = `
    <img class="ach-lb-image-basic" src="${url}" alt="Image agrandie">
    <button class="ach-lb-close" type="button">✕</button>
  `;

  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 160); };
  overlay.addEventListener('click', close);
  overlay.querySelector('.ach-lb-close').addEventListener('click', close);

  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

// ── JUSTIFIED LAYOUT ENGINE ───────────────────────────────────────────────────

const ACH_CATS = [
  { id:'epique',   label:'Épique',   emoji:'⚔️',  color:'#4f8cff', glow:'rgba(79,140,255,0.18)',  line:'rgba(79,140,255,0.35)'  },
  { id:'comique',  label:'Comique',  emoji:'🎭',  color:'#e8b84b', glow:'rgba(232,184,75,0.18)',  line:'rgba(232,184,75,0.35)'  },
  { id:'histoire', label:'Histoire', emoji:'📖',  color:'#22c38e', glow:'rgba(34,195,142,0.18)', line:'rgba(34,195,142,0.35)' },
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

// ── HTML d'une carte galerie ──────────────────────────────────────────────────
function _achCardHTML(item, isAdmin) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = sortCharactersForDisplay(STATE.characters || []);
  const contribs  = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);
  const cat       = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];

  const contribsHtml = contribs.length ? `
    <div class="ach-contribs">
      ${contribs.map(c => {
        const col      = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        return `<div class="ach-contrib" style="border-color:${col}55">
          ${characterAvatarHtml(c, { className: 'ach-contrib-av', border: `1px solid ${col}`, background: `${col}22`, color: col })}
          <span class="ach-contrib-name" style="color:${col}">${_esc(c.nom || '?')}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const adminHtml = isAdmin ? `
    <div class="ach-admin-btns">
      <button class="btn btn-outline btn-sm" style="flex:1;font-size:.7rem"
        data-action="editAchievement" data-id="${item.id}" data-stop-propagation>✏️ Modifier</button>
      <button class="btn-icon" style="color:#ff6b6b"
        data-action="deleteAchievement" data-id="${item.id}" data-stop-propagation>🗑️</button>
    </div>` : '';

  const imageHtml = item.imageUrl
    ? `<img class="ach-img" src="${item.imageUrl}" alt="${_esc(item.nom || item.titre || '')}" loading="lazy" draggable="false">`
    : `<div class="ach-img-empty"><div class="ach-img-empty-emoji">${item.emoji || cat.emoji}</div></div>`;

  const secretBadge = (isAdmin && item.secret)
    ? `<div class="ach-secret-badge" title="Caché aux joueurs">🔒 Secret</div>` : '';

  const dateDisplay = _formatDateFr(item.date);
  return `
    <div class="ach-cat-badge">${cat.emoji} ${cat.label}</div>
    ${dateDisplay ? `<div class="ach-date-badge">${_esc(dateDisplay)}</div>` : ''}
    ${secretBadge}
    ${imageHtml}
    <div class="ach-meta">
      <div class="ach-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-desc">${_esc(item.description)}</div>` : ''}
      ${_missionLinkHtml(item)}
      ${contribsHtml}
      ${adminHtml}
    </div>`;
}

// ── Rendu justified dans le conteneur ────────────────────────────────────────
async function _achRenderJustified(catId, items, container) {
  const withRatios = await _achMeasureRatios(items);
  withRatios.forEach(item => {
    const idx = (STORE.items || []).findIndex(a => a.id === item.id);
    if (idx >= 0) STORE.items[idx] = { ...STORE.items[idx], aspectRatio: item.aspectRatio };
  });

  const containerW = container.clientWidth || 900;
  const w = window.innerWidth;
  const targetH = w < 600 ? 150 : w < 1024 ? 220 : w < 1440 ? 300 : w < 1920 ? 380 : 440;
  const gap     = 10;
  const rows       = _achBuildRows(withRatios, containerW, targetH, gap);
  const isAdmin    = STATE.isAdmin;

  container.innerHTML = rows.map((row, rowIdx) => `
    <div class="ach-row" style="height:${row.h}px">
      ${row.items.map((item, colIdx) => {
        const icat    = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
        const noDesc  = !item.description ? ' no-desc' : '';
        const delay   = (rowIdx * 4 + colIdx) * 30;
        return `<div class="ach-item${isAdmin ? ' ach-sortable-item' : ''}${noDesc}" data-ach-id="${item.id}"
          style="width:${item.w}px;height:${row.h}px;--c:${icat.color};--c-glow:${icat.glow};--c-line:${icat.line};animation-delay:${delay}ms;${isAdmin ? 'cursor:grab' : ''}"
          data-action="_achOpenLightbox" data-id="${item.id}">
          ${_achCardHTML(item, isAdmin)}
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ── Rebuild galerie après DnD ─────────────────────────────────────────────────
async function _achRebuildGallery(catId) {
  const grid = document.getElementById('ach-gallery');
  if (!grid) return;
  const itemsById  = Object.fromEntries((STORE.items || []).map(a => [a.id, a]));
  const orderedIds = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
  const ordered    = orderedIds.map(id => itemsById[id]).filter(Boolean);
  await _achRenderJustified(catId, ordered, grid);
  setupAchievementsDnd(catId);
}

// ── parseDate helper ──────────────────────────────────────────────────────────
// Accepte plusieurs formats : "15 mars 2024", "15/03/2024", "15-03-2024",
// "2024-03-15" (ISO), "15.03.2024". Retourne le timestamp ms ou 0 si invalide.
const _MOIS = {
  janvier:0, fevrier:1, février:1, mars:2, avril:3, mai:4, juin:5,
  juillet:6, aout:7, août:7, septembre:8, octobre:9, novembre:10,
  decembre:11, décembre:11,
  // formes abrégées courantes
  janv:0, fevr:1, févr:1, juil:6, sept:8, oct:9, nov:10, dec:11, déc:11,
};
function parseDate(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (!s) return 0;

  // ISO yyyy-mm-dd (ou yyyy/mm/dd)
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime() || 0;

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (français)
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]).getTime() || 0;
  }

  // "15 mars 2024" — mois en lettres (avec ou sans accent)
  m = s.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{2,4})/);
  if (m) {
    const moisKey = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const moisIdx = _MOIS[moisKey] ?? _MOIS[m[2].toLowerCase()];
    if (moisIdx == null) return 0;
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, moisIdx, +m[1]).getTime() || 0;
  }

  return 0;
}

// ── helpers date : ISO (stockage / input) vs FR (affichage) ──────────────────
function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _toISO(str) {
  const ts = parseDate(str);
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _formatDateFr(str) {
  const ts = parseDate(str);
  if (!ts) return str ? String(str) : '';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Timeline HTML ─────────────────────────────────────────────────────────────
function _renderTimeline(items) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars   = sortCharactersForDisplay(STATE.characters || []);
  const isAdmin = STATE.isAdmin;
  // Tri chronologique. Les hauts-faits sans date valide sont relégués à la fin
  // (peu importe le sens du tri). Sens contrôlé par STORE.timelineDesc.
  const desc = !!STORE.timelineDesc;
  const sorted = [...items].sort((a, b) => {
    const da = parseDate(a.date), db = parseDate(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return desc ? db - da : da - db;
  });

  if (!sorted.length) return '';

  const groups = [];
  for (const item of sorted) {
    const dateKey = _toISO(item.date);
    const key = dateKey || `__single_${item.id}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, dateKey, items: [item] });
  }

  const cardHTML = (item) => {
    const cat     = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
    const contribs = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);
    const imgEl   = item.imageUrl
      ? `<img class="tl-card-img" src="${item.imageUrl}" alt="${_esc(item.nom || item.titre || '')}" loading="lazy">`
      : `<div class="tl-card-empty" style="--c-glow:${cat.glow}">${item.emoji || cat.emoji}</div>`;
    const contribsEl = contribs.length ? `
      <div class="tl-card-contribs">
        ${contribs.map(c => {
          const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
          return `<div class="tl-card-contrib" style="border-color:${col}55;color:${col}">
            ${characterAvatarHtml(c, { className: 'tl-card-contrib-av', border: 'none', background: `${col}22`, color: col })}
            ${_esc(c.nom || '?')}
          </div>`;
        }).join('')}
      </div>` : '';
    const adminEl = isAdmin ? `
      <div class="tl-card-admin">
        <button class="btn btn-outline btn-sm" style="flex:1;font-size:.7rem"
          data-action="editAchievement" data-id="${item.id}" data-stop-propagation>✏️ Modifier</button>
        <button class="btn-icon" style="color:#ff6b6b"
          data-action="deleteAchievement" data-id="${item.id}" data-stop-propagation>🗑️</button>
      </div>` : '';

    const secretBadge = (isAdmin && item.secret)
      ? `<div class="ach-secret-badge" style="position:absolute;top:8px;right:8px;z-index:3">🔒 Secret</div>` : '';
    return `<div class="tl-card" style="--c:${cat.color};--c-glow:${cat.glow};--c-line:${cat.line};position:relative"
      ${item.imageUrl ? `data-action="_achOpenLightbox" data-id="${item.id}"` : ''}>
      ${imgEl}
      ${secretBadge}
      <div class="tl-card-body">
        <div class="tl-card-cat" style="background:${cat.glow};border:1px solid ${cat.line};color:${cat.color}">${cat.emoji} ${cat.label}</div>
        <div class="tl-card-title">${_esc(item.titre || 'Haut-Fait')}</div>
        ${item.description ? `<div class="tl-card-desc">${_esc(item.description)}</div>` : ''}
        ${_missionLinkHtml(item, 'tl-card-mission')}
        ${contribsEl}
        ${adminEl}
      </div>
    </div>`;
  };

  const nodeHTML = (group) => {
    const datedItems = group.items.filter(item => parseDate(item.date));
    const source = datedItems[0] || group.items[0];
    const cat = ACH_CATS.find(c => c.id === (source.categorie || 'epique')) || ACH_CATS[0];
    const dateText = group.dateKey ? _formatDateFr(group.dateKey) : _formatDateFr(source.date);
    const dotText = group.items.length > 1 ? group.items.length : cat.emoji;
    return `<div class="tl-node-wrap">
      <div class="tl-node">
        <div class="tl-node-dot" style="--c:${cat.color};--c-glow:${cat.glow}" title="${group.items.length} haut-fait${group.items.length > 1 ? 's' : ''}">${dotText}</div>
        ${dateText ? `<div class="tl-node-date" style="color:${cat.color}">${_esc(dateText)}</div>` : ''}
      </div>
    </div>`;
  };

  return `<div class="timeline">
    ${groups.map((group, idx) => {
      const delay = `${idx * 60}ms`;
      if (group.items.length > 1) {
        return `<div class="tl-item tl-group--multi" style="animation-delay:${delay}">
          ${nodeHTML(group)}
          <div class="tl-group-cards">
            ${group.items.map(item => cardHTML(item)).join('')}
          </div>
        </div>`;
      }

      const item = group.items[0];
      const side  = idx % 2 === 0 ? 'left' : 'right';
      return `<div class="tl-item ${side}" style="animation-delay:${delay}">
        ${side === 'left'  ? cardHTML(item) : '<div class="tl-spacer"></div>'}
        ${nodeHTML(group)}
        ${side === 'right' ? cardHTML(item) : '<div class="tl-spacer"></div>'}
      </div>`;
    }).join('')}
  </div>`;
}

// ── Barre additionnelle : chips par perso + sens timeline ────────────────────
function _achRenderControlsExtras() {
  // On l'injecte au-dessus de #ach-content, à l'intérieur de .hall-content
  const root = document.querySelector('.hall-content');
  if (!root) return;
  let bar = document.getElementById('ach-extra-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ach-extra-bar';
    bar.className = 'ach-extra-bar';
    root.insertBefore(bar, root.firstChild);
  }

  // Chips perso : seulement ceux qui ont au moins 1 HF visible pour l'utilisateur
  const all = STORE.items || [];
  const visible = STATE.isAdmin ? all : all.filter(a => !a.secret);
  const counts = new Map();
  visible.forEach(a => (a.contributeurs || []).forEach(cid => counts.set(cid, (counts.get(cid)||0)+1)));
  const chars = (STATE.characters || []).filter(c => counts.has(c.id));
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const active = STORE.charFilter || 'all';
  const isTimeline = (STORE.view || 'galerie') === 'timeline';
  const desc = !!STORE.timelineDesc;

  const charChips = chars.length ? `
    <div class="ach-char-filter">
      <button class="ach-char-chip${active==='all'?' active':''}" data-charid="all"
        data-action="_achSetCharFilter" title="Tous les personnages">👥 Tous</button>
      ${chars.map(c => {
        const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        const isOn = active === c.id;
        return `<button class="ach-char-chip${isOn?' active':''}" data-charid="${c.id}"
          data-action="_achSetCharFilter"
          style="--c:${col}" title="${_esc(c.nom||'?')} — ${counts.get(c.id)} haut${counts.get(c.id)>1?'s':''}-fait${counts.get(c.id)>1?'s':''}">
          ${characterAvatarHtml(c, {
            tag: 'span',
            className: 'ach-char-chip-av',
            border: 'none',
            background: 'transparent',
            color: col,
            fallbackStyle: "font-family:'Cinzel',serif;font-weight:700",
          })}
          <span class="ach-char-chip-name">${_esc((c.nom||'?').slice(0,12))}</span>
          <span class="ach-char-chip-count">${counts.get(c.id)}</span>
        </button>`;
      }).join('')}
    </div>` : '';

  const sortBtn = isTimeline ? `
    <button class="ach-sort-toggle" data-action="_achToggleTimelineDir"
      title="Inverser le sens de la chronologie">
      ${desc ? '↓ Plus récent en haut' : '↑ Plus ancien en haut'}
    </button>` : '';

  bar.innerHTML = charChips + sortBtn;
  bar.style.display = (charChips || sortBtn) ? 'flex' : 'none';
}

// ── Rendu du contenu (filtre + vue) ──────────────────────────────────────────
async function _achRenderContent() {
  const contentEl = document.getElementById('ach-content');
  if (!contentEl) return;
  _refreshAchievementCounters();
  _achRenderControlsExtras();

  const all        = STORE.items || [];
  const filter     = STORE.filter || 'all';
  const charFilter = STORE.charFilter || 'all';
  const search     = _normalize(STORE.search || '');   // minuscules + sans accents
  const isAdmin    = STATE.isAdmin;

  // 1. Filtre secret (joueurs ne voient pas les HF secrets)
  let filtered = isAdmin ? all : all.filter(a => !a.secret);
  // 2. Filtre catégorie
  if (filter !== 'all') filtered = filtered.filter(a => (a.categorie || 'epique') === filter);
  // 3. Filtre par perso contributeur
  if (charFilter !== 'all') filtered = filtered.filter(a => (a.contributeurs || []).includes(charFilter));
  // 4. Recherche
  if (search) {
    filtered = filtered.filter(a =>
      _normalize(a.titre || '').includes(search) ||
      _normalize(a.description || '').includes(search)
    );
  }

  // Map lightbox (limitée aussi pour les joueurs : pas d'ouverture d'un HF secret)
  const visibleForLightbox = isAdmin ? all : all.filter(a => !a.secret);
  STORE.lightboxItems = Object.fromEntries(visibleForLightbox.map(a => [a.id, a]));

  if (!filtered.length) {
    const catDef = ACH_CATS.find(c => c.id === filter);
    const charName = charFilter !== 'all'
      ? ((STATE.characters || []).find(c => c.id === charFilter)?.nom || 'ce personnage')
      : null;
    let title = 'Aucun haut-fait';
    let sub = STATE.isAdmin ? 'Ajoutez le premier !' : '';
    if (search) { title = 'Aucun résultat'; sub = `pour « ${_esc(search)} »`; }
    else if (charName) { title = `Aucun haut-fait`; sub = `pour « ${_esc(charName)} »`; }
    contentEl.innerHTML = `
      <div class="hall-empty">
        <div class="hall-empty-icon">${catDef?.emoji || '🏆'}</div>
        <div class="hall-empty-title">${title}</div>
        <div class="hall-empty-sub">${sub}</div>
        ${STATE.isAdmin && !search ? `<button class="btn btn-gold btn-sm" style="margin-top:1rem" data-action="openAchievementModal">＋ Créer un haut-fait</button>` : ''}
      </div>`;
    return;
  }

  if ((STORE.view || 'galerie') === 'timeline') {
    contentEl.innerHTML = _renderTimeline(filtered);
    return;
  }

  if (filter === 'all') filtered = _sortAchievementsByDate(filtered);

  // Galerie justified
  const galleryEl = document.createElement('div');
  galleryEl.id        = 'ach-gallery';
  galleryEl.className = 'ach-justified';
  contentEl.innerHTML = '';
  contentEl.appendChild(galleryEl);

  await _achRenderJustified(filter, filtered, galleryEl);
  setupAchievementsDnd(filter !== 'all' ? filter : null);
}

// ── Actions état (appelées depuis les boutons HTML) ───────────────────────────
function _achSetFilter(filter) {
  STORE.filter = filter;
  document.querySelectorAll('.hall-counter').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === filter);
  });
  _achRenderContent();
};
function _achSetView(view) {
  STORE.view = view;
  document.querySelectorAll('.view-tab').forEach((btn, i) => {
    btn.classList.toggle('active', i === (view === 'timeline' ? 1 : 0));
  });
  _achRenderContent();
};
let _achSearchTimer = null;
function _achSetSearch(val) {
  STORE.search = val;
  clearTimeout(_achSearchTimer);
  _achSearchTimer = setTimeout(_achRenderContent, 240);
};
function _achSetCharFilter(charId) {
  STORE.charFilter = charId || 'all';
  document.querySelectorAll('.ach-char-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.charid === STORE.charFilter);
  });
  _achRenderContent();
};
function _achToggleTimelineDir() {
  STORE.timelineDesc = !STORE.timelineDesc;
  _achRenderContent();
};

// ── LIGHTBOX ENRICHIE ─────────────────────────────────────────────────────────
function _achOpenLightbox(itemId) {
  const item = (STORE.lightboxItems || {})[itemId] || (STORE.items || []).find(a => a.id === itemId);
  if (!item) return;
  const cat       = ACH_CATS.find(c => c.id === (item.categorie || 'epique')) || ACH_CATS[0];
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = sortCharactersForDisplay(STATE.characters || []);
  const contribs  = (item.contributeurs || []).map(id => chars.find(c => c.id === id)).filter(Boolean);

  const existing = document.getElementById('ach-lightbox');
  if (existing) existing.remove();

  const contribsHtml = contribs.length ? `
    <div class="ach-lb-contribs">
      ${contribs.map(c => {
        const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        return `<span style="display:flex;align-items:center;gap:4px;font-size:.68rem;color:${col}">
          <span style="width:16px;height:16px;border-radius:50%;background:${col}22;border:1px solid ${col};
            display:flex;align-items:center;justify-content:center;font-size:.55rem;font-family:'Cinzel',serif;font-weight:700">
            ${(c.nom||'?')[0]}
          </span>${_esc(c.nom || '?')}</span>`;
      }).join('')}
    </div>` : '';

  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.className = 'ach-lightbox-rich';
  overlay.innerHTML = `
    ${item.imageUrl ? `<img class="ach-lb-image-rich" src="${item.imageUrl}" alt="${_esc(item.nom || item.titre || '')}">` : ""}
    <div class="ach-lb-info${item.imageUrl ? "" : " is-empty"}">
      <div class="ach-lb-cat" style="background:${cat.glow};border-color:${cat.line};color:${cat.color}">${cat.emoji} ${cat.label}</div>
      <div class="ach-lb-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-lb-desc">${_esc(item.description)}</div>` : ''}
      ${_missionLinkHtml(item, 'ach-lb-mission')}
      ${contribsHtml}
    </div>
    <button class="ach-lb-close" type="button">✕</button>
  `;

  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 160); };
  overlay.addEventListener('click', close);
  overlay.querySelector('.ach-lb-close').addEventListener('click', e => { e.stopPropagation(); close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
// Ouverture de la lightbox depuis un autre module (ex. fiche mission de la Trame).
// Charge les hauts-faits si nécessaire (collection session-live → 0 lecture en plus).
export async function openAchievementLightbox(id) {
  if (!STORE.items || !STORE.items.length) {
    try {
      STORE.publicItems = await loadCollection('achievements');
      if (STATE.isAdmin) STORE.secretItems = await loadCollection('achievements_secret').catch(() => []);
      STORE.items = _composeItems();
    } catch {}
  }
  _achOpenLightbox(id);
}

// ── OVERRIDE PAGES.ACHIEVEMENTS ───────────────────────────────────────────────
const _origPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  let [items, order, story] = await Promise.all([
    loadCollection('achievements'),
    _loadOrder(),
    loadCollection('story').catch(() => []),
  ]);

  // Hauts-faits secrets : chargés (MJ uniquement) depuis la sous-collection MJ-only.
  // Migration douce idempotente : tout HF encore marqué secret dans la collection
  // publique est déplacé vers `achievements_secret` (copy-then-delete, ré-exécutable).
  STORE.secretItems = [];
  if (STATE.isAdmin) {
    STORE.secretItems = await loadCollection('achievements_secret').catch(() => []);
    const strays = (items || []).filter(a => a.secret === true);
    if (strays.length) {
      for (const a of strays) {
        const { id: _omit, ...data } = a;
        try {
          await saveDoc('achievements_secret', a.id, data);
          await deleteFromCol('achievements', a.id);
        } catch (e) { console.warn('[ach] migration secret', a.id, e); }
      }
      items = await loadCollection('achievements').catch(() => (items || []).filter(a => a.secret !== true));
      STORE.secretItems = await loadCollection('achievements_secret').catch(() => STORE.secretItems);
    }
  }

  STORE.order       = order;
  STORE.publicItems = items || [];
  STORE.items       = _composeItems();
  STORE.missions    = (story || []).filter(item => item.type === 'mission' || item.type === 'event');
  STORE.filter ??= 'all';
  STORE.view   ??= 'galerie';
  STORE.search ??= '';
  PAGES._achievementsShellState = getAchievementsShellState();

  await _origPage();    // génère le shell (hero + controls + #ach-content)
  await _achRenderContent();

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // On évite de re-render pendant un drag SortableJS pour ne pas casser
  // l'instance en cours ; les saves admin re-render explicitement après onEnd.
  // unwatchAll() côté navigation s'occupe du cleanup.
  watchPageCollection('ach-items', 'achievements', 'achievements', items => {
    if (document.body.classList.contains('ach-dragging')) return;
    STORE.publicItems = items || [];
    STORE.items = _composeItems();
    _achRenderContent();
  });

  watchPageCollection('ach-story', 'story', 'achievements', items => {
    STORE.missions = (items || []).filter(item => item.type === 'mission' || item.type === 'event');
    _achRenderContent();
  });

  watchPageDoc('ach-order', 'achievements_meta', 'order', 'achievements', doc => {
    if (document.body.classList.contains('ach-dragging')) return;
    STORE.order = Array.isArray(doc?.order) ? doc.order : [];
    STORE.items = _composeItems();
    _achRenderContent();
  });
};

registerActions({
  _achSetSearch:         (el)  => _achSetSearch(el.value),
  _achSetFilter:         (btn) => _achSetFilter(btn.dataset.val),
  _achSetView:           (btn) => _achSetView(btn.dataset.val),
  openAchievementModal:  ()    => openAchievementModal(),
  _achSelectCat:         (btn) => _achSelectCat(btn.dataset.id),
  _achTogglePick:        ()    => _achTogglePick(),
  _achPickSelect:        (btn) => _achPickSelect(btn.dataset.id || ''),
  _achPickSearch:        (el)  => _achPickSearch(el.value),
  _achToggleContrib:     (btn) => _achToggleContrib(btn.dataset.id),
  saveAchievement:       (btn) => saveAchievement(btn.dataset.id || ''),
  editAchievement:       (btn) => editAchievement(btn.dataset.id),
  deleteAchievement:     (btn) => deleteAchievement(btn.dataset.id),
  _achOpenLightbox:      (btn) => _achOpenLightbox(btn.dataset.id),
  _achSetCharFilter:     (btn) => _achSetCharFilter(btn.dataset.charid),
  _achToggleTimelineDir: ()    => _achToggleTimelineDir(),
  _achOpenMission:       (btn) => _achOpenMission(btn.dataset.id),
});
