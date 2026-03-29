import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';
import { STATE } from '../core/state.js';

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(value = '') {
  return esc(value).replace(/`/g, '&#96;');
}

function formatMultiline(value = '') {
  return esc(value).replace(/\n+/g, '<br><br>');
}

function getAccent(player = {}) {
  const raw = String(player.accent || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : 'var(--gold)';
}

function sortPlayers(items = []) {
  return [...items].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.ordre)) ? Number(a.ordre) : 999;
    const orderB = Number.isFinite(Number(b.ordre)) ? Number(b.ordre) : 999;
    if (orderA !== orderB) return orderA - orderB;

    const lvlA = Number.isFinite(Number(a.niveau)) ? Number(a.niveau) : 0;
    const lvlB = Number.isFinite(Number(b.niveau)) ? Number(b.niveau) : 0;
    if (lvlA !== lvlB) return lvlB - lvlA;

    return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' });
  });
}

function getFocusPlayer(items = []) {
  if (!items.length) return null;
  const focused = items.find((entry) => entry.id === window._playersFocusId);
  return focused || items[0];
}

function getPlayerMeta(player = {}) {
  return [player.classe, player.race].filter(Boolean).join(' • ');
}

function getPlayerTitle(player = {}) {
  return player.titre || player.surnom || getPlayerMeta(player) || 'Aventurier de la compagnie';
}

function getPlayerExcerpt(player = {}) {
  const source = String(player.bio || '').trim();
  if (!source) return 'Les archives ne contiennent pas encore de description détaillée pour ce personnage.';
  if (source.length <= 180) return source;
  return `${source.slice(0, 177).trimEnd()}…`;
}

function renderPlayerPortrait(player = {}, variant = 'card') {
  const accent = getAccent(player);
  const img = String(player.imageUrl || '').trim();
  const emoji = esc(player.emoji || '⚔️');
  const initials = esc((player.nom || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?');

  if (img) {
    return `
      <div class="players-portrait players-portrait--${variant}" style="--player-accent:${accent}">
        <img src="${escAttr(img)}" alt="${escAttr(player.nom || 'Portrait')}" loading="lazy">
      </div>`;
  }

  return `
    <div class="players-portrait players-portrait--${variant} is-fallback" style="--player-accent:${accent}">
      <span class="players-portrait__emoji">${emoji}</span>
      <span class="players-portrait__initials">${initials}</span>
    </div>`;
}

function renderAdminActions(player = {}) {
  if (!STATE.isAdmin) return '';
  return `
    <div class="players-admin-row">
      <button class="btn btn-outline btn-sm" type="button" onclick="event.stopPropagation();editPlayerPresent('${player.id}')">✏️ Modifier</button>
      <button class="btn btn-danger btn-sm" type="button" onclick="event.stopPropagation();deletePlayerPresent('${player.id}')">🗑️ Supprimer</button>
    </div>`;
}

function renderPlayersHero(player = {}, items = []) {
  const accent = getAccent(player);
  const total = items.length;
  const averageLevel = Math.round(items.reduce((sum, entry) => sum + (parseInt(entry.niveau, 10) || 0), 0) / Math.max(total, 1));
  const illustrated = items.filter((entry) => String(entry.imageUrl || '').trim()).length;
  const playerMeta = getPlayerMeta(player);

  return `
    <section class="players-hero" style="--player-accent:${accent}">
      <div class="players-hero__ambient"></div>

      <div class="players-hero__summary card">
        <div class="players-kicker">Compagnie active</div>
        <div class="players-summary-grid">
          <div class="players-summary-card">
            <span class="players-summary-card__label">Héros</span>
            <strong>${total}</strong>
          </div>
          <div class="players-summary-card">
            <span class="players-summary-card__label">Niveau moyen</span>
            <strong>${averageLevel || 1}</strong>
          </div>
          <div class="players-summary-card">
            <span class="players-summary-card__label">Illustrés</span>
            <strong>${illustrated}</strong>
          </div>
        </div>
      </div>

      <div class="players-hero__visual card">
        <div class="players-hero__halo"></div>
        ${renderPlayerPortrait(player, 'hero')}
        <div class="players-hero__medallion">Niveau ${esc(player.niveau || 1)}</div>
      </div>

      <div class="players-hero__content card">
        <div class="players-kicker">Fiche de présentation</div>
        <div class="players-hero__headline">
          <div>
            <h1 class="players-hero__name">${esc(player.nom || 'Personnage')}</h1>
            <div class="players-hero__title">${esc(getPlayerTitle(player))}</div>
          </div>
          <button class="players-hero__inspect" type="button" onclick="viewPlayerDetail('${player.id}')">Ouvrir la fiche</button>
        </div>

        <div class="players-pill-row">
          ${playerMeta ? `<span class="players-pill">${esc(playerMeta)}</span>` : ''}
          <span class="players-pill">Joué par ${esc(player.joueur || '—')}</span>
          ${player.citation ? `<span class="players-pill">Archive</span>` : ''}
        </div>

        <div class="players-hero__body">
          <div class="players-hero__bio">
            <div class="players-section-label">Portrait narratif</div>
            <p>${formatMultiline(player.bio || '') || 'Aucune biographie enregistrée.'}</p>
          </div>

          <aside class="players-hero__aside">
            <div class="players-aside-card">
              <div class="players-section-label">Statut</div>
              <div class="players-aside-card__value">${esc(player.classe || 'Classe non définie')}</div>
              <div class="players-aside-card__meta">${esc(player.race || 'Race non définie')}</div>
            </div>
            <div class="players-aside-card">
              <div class="players-section-label">Présence</div>
              <div class="players-aside-card__value">Niv. ${esc(player.niveau || 1)}</div>
              <div class="players-aside-card__meta">Accent visuel synchronisé au thème du site</div>
            </div>
          </aside>
        </div>

        ${player.citation ? `
          <blockquote class="players-quote">
            <span class="players-section-label">Fragment d'archive</span>
            <p>${formatMultiline(player.citation)}</p>
          </blockquote>` : ''}

        ${renderAdminActions(player)}
      </div>
    </section>`;
}

function renderPlayersRoster(items = [], focusId = '') {
  return `
    <section class="players-roster-section">
      <div class="players-section-head">
        <div>
          <div class="players-kicker">Compagnie complète</div>
          <h2 class="players-section-title">Choisir le héros mis en avant</h2>
        </div>
        <div class="players-section-note">Le visuel principal change sans quitter la page.</div>
      </div>

      <div class="players-roster-grid">
        ${items.map((player) => {
          const active = player.id === focusId;
          const accent = getAccent(player);
          return `
            <article class="players-roster-card ${active ? 'is-active' : ''}" style="--player-accent:${accent}" onclick="setPlayersFocus('${player.id}')">
              <div class="players-roster-card__frame">
                ${renderPlayerPortrait(player, 'thumb')}
              </div>
              <div class="players-roster-card__body">
                <div class="players-roster-card__topline">
                  <span class="players-roster-card__status">${active ? 'En vitrine' : 'Disponible'}</span>
                  <span class="players-roster-card__level">Niv. ${esc(player.niveau || 1)}</span>
                </div>
                <h3 class="players-roster-card__name">${esc(player.nom || 'Personnage')}</h3>
                <div class="players-roster-card__title">${esc(getPlayerTitle(player))}</div>
                <p class="players-roster-card__excerpt">${esc(getPlayerExcerpt(player))}</p>
                ${renderAdminActions(player)}
              </div>
            </article>`;
        }).join('')}
      </div>
    </section>`;
}

function openPlayerPresentModal(player = null) {
  openModal(player ? '✏️ Modifier le joueur' : '⚔️ Présenter un joueur', `
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Nom du personnage</label><input class="input-field" id="pp-nom" value="${escAttr(player?.nom || '')}"></div>
      <div class="form-group"><label>Joueur</label><input class="input-field" id="pp-joueur" value="${escAttr(player?.joueur || '')}"></div>
    </div>

    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Classe</label><input class="input-field" id="pp-classe" value="${escAttr(player?.classe || '')}"></div>
      <div class="form-group"><label>Race</label><input class="input-field" id="pp-race" value="${escAttr(player?.race || '')}"></div>
    </div>

    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Niveau</label><input type="number" class="input-field" id="pp-niveau" value="${escAttr(player?.niveau || 1)}"></div>
      <div class="form-group"><label>Ordre d'affichage</label><input type="number" class="input-field" id="pp-ordre" value="${escAttr(player?.ordre || '')}" placeholder="1, 2, 3..."></div>
    </div>

    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Emoji</label><input class="input-field" id="pp-emoji" value="${escAttr(player?.emoji || '⚔️')}"></div>
      <div class="form-group"><label>Couleur d'accent</label><input class="input-field" id="pp-accent" value="${escAttr(player?.accent || '')}" placeholder="#4f8cff"></div>
    </div>

    <div class="form-group"><label>Titre / accroche</label><input class="input-field" id="pp-titre" value="${escAttr(player?.titre || player?.surnom || '')}" placeholder="Ex. : Le veilleur du rivage"></div>
    <div class="form-group"><label>Présentation</label><textarea class="input-field" id="pp-bio" rows="6">${esc(player?.bio || '')}</textarea></div>
    <div class="form-group"><label>Fragment d'archive / citation</label><textarea class="input-field" id="pp-citation" rows="4" placeholder="Extrait, devise, archive...">${esc(player?.citation || '')}</textarea></div>
    <div class="form-group"><label>URL image</label><input class="input-field" id="pp-img" value="${escAttr(player?.imageUrl || '')}"></div>

    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="savePlayerPresent('${player?.id || ''}')">Enregistrer</button>
  `);
}

async function savePlayerPresent(id = '') {
  const niveau = parseInt(document.getElementById('pp-niveau')?.value, 10);
  const ordreRaw = document.getElementById('pp-ordre')?.value;
  const ordre = parseInt(ordreRaw, 10);

  const data = {
    nom: document.getElementById('pp-nom')?.value?.trim() || 'Personnage',
    classe: document.getElementById('pp-classe')?.value?.trim() || '',
    race: document.getElementById('pp-race')?.value?.trim() || '',
    niveau: Number.isFinite(niveau) ? niveau : 1,
    ordre: Number.isFinite(ordre) ? ordre : null,
    emoji: document.getElementById('pp-emoji')?.value?.trim() || '⚔️',
    joueur: document.getElementById('pp-joueur')?.value?.trim() || '',
    titre: document.getElementById('pp-titre')?.value?.trim() || '',
    bio: document.getElementById('pp-bio')?.value || '',
    citation: document.getElementById('pp-citation')?.value || '',
    imageUrl: document.getElementById('pp-img')?.value?.trim() || '',
    accent: document.getElementById('pp-accent')?.value?.trim() || '',
  };

  if (id) await updateInCol('players', id, data);
  else await addToCol('players', data);

  closeModal();
  showNotif('Présentation enregistrée.', 'success');
  await PAGES.players();
}

function renderPlayerDetail(player = {}) {
  const accent = getAccent(player);
  return `
    <div class="players-modal" style="--player-accent:${accent}">
      <div class="players-modal__visual">
        ${renderPlayerPortrait(player, 'modal')}
      </div>
      <div class="players-modal__content">
        <div class="players-kicker">Fiche complète</div>
        <h2 class="players-modal__name">${esc(player.nom || 'Joueur')}</h2>
        <div class="players-modal__title">${esc(getPlayerTitle(player))}</div>
        <div class="players-pill-row">
          ${player.classe ? `<span class="players-pill">${esc(player.classe)}</span>` : ''}
          ${player.race ? `<span class="players-pill">${esc(player.race)}</span>` : ''}
          <span class="players-pill">Niv. ${esc(player.niveau || 1)}</span>
          <span class="players-pill">Joueur : ${esc(player.joueur || '—')}</span>
        </div>
        <div class="players-modal__bio">${formatMultiline(player.bio || '') || 'Aucune description enregistrée.'}</div>
        ${player.citation ? `<blockquote class="players-quote"><span class="players-section-label">Fragment d'archive</span><p>${formatMultiline(player.citation)}</p></blockquote>` : ''}
      </div>
    </div>`;
}

function viewPlayerDetail(id) {
  const cache = Array.isArray(window._playersCache) ? window._playersCache : null;
  const resolve = cache ? Promise.resolve(cache) : loadCollection('players');

  resolve.then((items) => {
    const player = items.find((entry) => entry.id === id);
    if (!player) return;
    openModal(`⚔️ ${player.nom || 'Joueur'}`, renderPlayerDetail(player));
  });
}

async function editPlayerPresent(id) {
  const items = await loadCollection('players');
  const player = items.find((entry) => entry.id === id);
  if (player) openPlayerPresentModal(player);
}

async function deletePlayerPresent(id) {
  if (!confirm('Supprimer cette présentation ?')) return;
  await deleteFromCol('players', id);
  showNotif('Présentation supprimée.', 'success');
  if (window._playersFocusId === id) delete window._playersFocusId;
  await PAGES.players();
}

async function setPlayersFocus(id) {
  window._playersFocusId = id;
  await PAGES.players();
}

PAGES.players = async function renderPlayersPage() {
  const content = document.getElementById('main-content');
  const items = sortPlayers(await loadCollection('players'));
  window._playersCache = items;

  let html = `
    <div class="players-page-shell">
      <div class="page-header players-page-header">
        <div class="page-title">
          <span class="page-title-accent">⚔️ Présentation des Joueurs</span>
        </div>
        <div class="page-subtitle">Une mise en scène plus éditoriale, cohérente avec la structure actuelle du site.</div>
      </div>`;

  if (STATE.isAdmin) {
    html += `
      <div class="admin-section" style="margin-bottom:1.2rem">
        <div class="admin-label">Gestion Admin</div>
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
          <button class="btn btn-gold btn-sm" type="button" onclick="openPlayerPresentModal()">+ Ajouter un joueur</button>
          <span style="font-size:0.75rem;color:var(--text-dim)">Les champs titre, citation, ordre et accent sont optionnels mais améliorent fortement le rendu.</span>
        </div>
      </div>`;
  }

  if (!items.length) {
    html += `
      <div class="empty-state">
        <div class="icon">⚔️</div>
        <p>Aucun joueur présenté pour l'instant.</p>
      </div>
    </div>`;
    content.innerHTML = html;
    return;
  }

  const focus = getFocusPlayer(items);
  window._playersFocusId = focus.id;

  html += `
      ${renderPlayersHero(focus, items)}
      ${renderPlayersRoster(items, focus.id)}
    </div>`;

  content.innerHTML = html;
};

Object.assign(window, {
  openPlayerPresentModal,
  savePlayerPresent,
  viewPlayerDetail,
  editPlayerPresent,
  deletePlayerPresent,
  setPlayersFocus,
});
