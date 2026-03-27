import { getDocData, saveDoc, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

const WORLD_SETTINGS_PATH = { col: 'world', id: 'main' };
const WORLD_MISSIONS_COL = 'world_missions';

const DEFAULT_WORLD_SETTINGS = {
  heroTitle: 'Tableau des missions',
  heroSubtitle: 'Les quêtes, contrats et missions actuellement proposés aux aventuriers.',
  intro:
    'Consultez ici les opportunités en cours, les contrats ouverts et les missions en préparation. Le Maître de Jeu peut modifier le tableau en temps réel.',
  boardNote:
    'Les missions privées ou archivées restent visibles uniquement côté admin.',
  emptyStateTitle: 'Aucune mission visible pour le moment',
  emptyStateText:
    'Le tableau est vide. Revenez plus tard ou demandez au Maître de Jeu de publier une nouvelle mission.',
};

const STATUS_META = {
  disponible: { label: 'Disponible', className: 'badge-green' },
  limitee: { label: 'Limitée', className: 'badge-gold' },
  bientot: { label: 'Bientôt', className: 'badge-blue' },
  complete: { label: 'Complète', className: 'badge-red' },
  archivee: { label: 'Archivée', className: 'badge-red' },
};

const DIFFICULTY_META = {
  faible: { label: 'Faible', className: 'badge-blue' },
  moyenne: { label: 'Moyenne', className: 'badge-green' },
  elevee: { label: 'Élevée', className: 'badge-gold' },
  critique: { label: 'Critique', className: 'badge-red' },
};

const TYPE_OPTIONS = ['Quête', 'Mission', 'Contrat', 'Exploration', 'Événement'];
const STATUS_OPTIONS = ['disponible', 'limitee', 'bientot', 'complete', 'archivee'];
const DIFFICULTY_OPTIONS = ['faible', 'moyenne', 'elevee', 'critique'];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeStatus(value = '') {
  const map = {
    ouverte: 'disponible',
    ouvert: 'disponible',
    disponible: 'disponible',
    limitee: 'limitee',
    limitée: 'limitee',
    bientot: 'bientot',
    bientôt: 'bientot',
    complete: 'complete',
    completee: 'complete',
    complétée: 'complete',
    complète: 'complete',
    archivee: 'archivee',
    archivée: 'archivee',
  };
  return map[normalizeText(value)] || 'disponible';
}

function normalizeDifficulty(value = '') {
  const map = {
    facile: 'faible',
    faible: 'faible',
    moyenne: 'moyenne',
    moyen: 'moyenne',
    elevee: 'elevee',
    élevée: 'elevee',
    difficile: 'elevee',
    critique: 'critique',
  };
  return map[normalizeText(value)] || 'moyenne';
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function coerceBoolean(value, defaultValue = true) {
  if (typeof value === 'boolean') return value;
  if (value === 'false' || value === '0' || value === 0) return false;
  if (value === 'true' || value === '1' || value === 1) return true;
  return defaultValue;
}

function getWorldSettings(doc) {
  const settings = doc?.settings || {};
  const legacyIntro = Array.isArray(doc?.sections)
    ? doc.sections
        .map((section) => [section?.title, section?.content].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n\n')
    : '';
  return {
    ...DEFAULT_WORLD_SETTINGS,
    ...settings,
    intro: settings.intro || legacyIntro || DEFAULT_WORLD_SETTINGS.intro,
  };
}

function normalizeMission(raw = {}, index = 0) {
  const title = String(raw.title || raw.titre || 'Mission sans titre').trim();
  const summary = String(raw.summary || raw.resume || raw.descriptionCourte || '').trim();
  const description = String(raw.description || raw.details || '').trim();
  const type = String(raw.type || raw.category || 'Mission').trim() || 'Mission';
  const status = normalizeStatus(raw.status || raw.availability || raw.etat);
  const difficulty = normalizeDifficulty(raw.difficulty || raw.difficulte || raw.difficultyLevel);
  const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1;
  const isPublic = coerceBoolean(raw.isPublic ?? raw.public ?? raw.visible, true);
  const featured = coerceBoolean(raw.featured ?? raw.isFeatured, false);
  const tags = parseTags(raw.tags);

  return {
    id: raw.id,
    title,
    summary,
    description,
    type,
    location: String(raw.location || raw.lieu || '').trim(),
    objective: String(raw.objective || raw.objectif || '').trim(),
    reward: String(raw.reward || raw.recompense || '').trim(),
    duration: String(raw.duration || raw.duree || '').trim(),
    level: String(raw.level || raw.niveau || '').trim(),
    groupSize: String(raw.groupSize || raw.tailleGroupe || '').trim(),
    prerequisites: String(raw.prerequisites || raw.prerequis || '').trim(),
    contact: String(raw.contact || raw.commanditaire || '').trim(),
    tags,
    status,
    difficulty,
    order,
    isPublic,
    featured,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.disponible;
}

function getDifficultyMeta(difficulty) {
  return DIFFICULTY_META[difficulty] || DIFFICULTY_META.moyenne;
}

function sortMissions(list = []) {
  return [...list].sort((a, b) => {
    if (Number(b.featured) !== Number(a.featured)) return Number(b.featured) - Number(a.featured);
    if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
    return String(a.title || '').localeCompare(String(b.title || ''), 'fr');
  });
}

function ensureWorldFilters(isAdmin = false) {
  const prev = window.__worldFilters || {};
  const next = {
    search: prev.search || '',
    status: prev.status || 'actives',
    type: prev.type || 'all',
    difficulty: prev.difficulty || 'all',
    visibility: isAdmin ? (prev.visibility || 'all') : 'public',
  };
  window.__worldFilters = next;
  return next;
}

function filterMission(mission, filters, isAdmin) {
  if (!isAdmin && !mission.isPublic) return false;

  if (filters.visibility === 'public' && !mission.isPublic) return false;
  if (filters.visibility === 'hidden' && mission.isPublic) return false;

  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'actives') {
      if (!['disponible', 'limitee', 'bientot'].includes(mission.status)) return false;
    } else if (mission.status !== filters.status) {
      return false;
    }
  }

  if (filters.type && filters.type !== 'all' && normalizeText(mission.type) !== normalizeText(filters.type)) {
    return false;
  }

  if (filters.difficulty && filters.difficulty !== 'all' && mission.difficulty !== filters.difficulty) {
    return false;
  }

  if (filters.search) {
    const haystack = normalizeText([
      mission.title,
      mission.summary,
      mission.description,
      mission.location,
      mission.objective,
      mission.reward,
      mission.contact,
      ...(mission.tags || []),
    ].join(' '));
    if (!haystack.includes(normalizeText(filters.search))) return false;
  }

  return true;
}

function getVisibleWorldMissions(missions = [], isAdmin = false) {
  const filters = ensureWorldFilters(isAdmin);
  return sortMissions(missions).filter((mission) => filterMission(mission, filters, isAdmin));
}

function missionMetaLine(label, value) {
  if (!value) return '';
  return `<div class="world-mission-card__meta-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderMissionCard(mission, isAdmin = false) {
  const statusMeta = getStatusMeta(mission.status);
  const difficultyMeta = getDifficultyMeta(mission.difficulty);
  return `
    <article class="world-mission-card card ${mission.featured ? 'is-featured' : ''} ${!mission.isPublic ? 'is-hidden' : ''}">
      <div class="world-mission-card__head">
        <div>
          <div class="world-mission-card__eyebrow">${escapeHtml(mission.type)}${mission.location ? ` · ${escapeHtml(mission.location)}` : ''}</div>
          <h3 class="world-mission-card__title">${escapeHtml(mission.title)}</h3>
        </div>
        <div class="world-mission-card__badges">
          <span class="badge ${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>
          <span class="badge ${difficultyMeta.className}">${escapeHtml(difficultyMeta.label)}</span>
          ${mission.featured ? '<span class="badge badge-gold">Prioritaire</span>' : ''}
          ${!mission.isPublic ? '<span class="badge badge-red">Privée</span>' : ''}
        </div>
      </div>
      <p class="world-mission-card__summary">${escapeHtml(mission.summary || 'Aucun résumé disponible.')}</p>
      <div class="world-mission-card__meta">
        ${missionMetaLine('Objectif', mission.objective)}
        ${missionMetaLine('Récompense', mission.reward)}
        ${missionMetaLine('Durée', mission.duration)}
        ${missionMetaLine('Niveau', mission.level)}
        ${missionMetaLine('Groupe', mission.groupSize)}
        ${missionMetaLine('Contact', mission.contact)}
      </div>
      ${mission.tags?.length ? `<div class="world-mission-card__tags">${mission.tags.map((tag) => `<span class="char-pill">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div class="world-mission-card__footer">
        <button class="btn btn-outline btn-sm" type="button" onclick="openWorldMissionDetails('${mission.id}')">Voir la fiche</button>
        ${isAdmin ? `
          <div class="world-mission-card__admin-actions">
            <button class="btn-icon" type="button" onclick="openWorldMissionModal('${mission.id}')" title="Modifier">✏️</button>
            <button class="btn-icon" type="button" onclick="deleteWorldMission('${mission.id}')" title="Supprimer">🗑️</button>
          </div>
        ` : ''}
      </div>
    </article>
  `;
}

function renderWorldPage({ settingsDoc, missions = [], isAdmin = false } = {}) {
  const settings = getWorldSettings(settingsDoc);
  const normalized = sortMissions((missions || []).map((mission, index) => normalizeMission(mission, index)));
  const filters = ensureWorldFilters(isAdmin);
  const visibleMissions = getVisibleWorldMissions(normalized, isAdmin);
  const playerVisibleMissions = normalized.filter((mission) => mission.isPublic);
  const activePlayerMissions = playerVisibleMissions.filter((mission) => ['disponible', 'limitee', 'bientot'].includes(mission.status));
  const featuredCount = normalized.filter((mission) => mission.featured).length;
  const hiddenCount = normalized.filter((mission) => !mission.isPublic).length;
  const uniqueTypes = [...new Set(normalized.map((mission) => mission.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

  window.__worldSettings = settings;
  window.__worldMissions = normalized;

  return `
    <div class="page-header">
      <div class="page-title"><span class="page-title-accent">📖 Monde</span></div>
      <div class="page-subtitle">${escapeHtml(settings.heroSubtitle)}</div>
    </div>

    <section class="world-hero card">
      <div class="world-hero__main">
        <div class="world-hero__kicker">Tableau de campagne</div>
        <h2 class="world-hero__title">${escapeHtml(settings.heroTitle)}</h2>
        <p class="world-hero__copy">${nl2br(settings.intro)}</p>
        ${settings.boardNote ? `<div class="world-hero__note">${escapeHtml(settings.boardNote)}</div>` : ''}
      </div>
      <div class="world-hero__stats grid-3">
        <div class="stat-box">
          <div class="stat-label">Missions publiques</div>
          <div class="stat-value">${playerVisibleMissions.length}</div>
          <div class="stat-sub">Total visible côté joueur</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Actives</div>
          <div class="stat-value">${activePlayerMissions.length}</div>
          <div class="stat-sub">Disponibles, limitées ou bientôt ouvertes</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Prioritaires</div>
          <div class="stat-value">${featuredCount}</div>
          <div class="stat-sub">Missions mises en avant par le MJ${isAdmin ? ` · ${hiddenCount} privées` : ''}</div>
        </div>
      </div>
    </section>

    ${isAdmin ? `
      <div class="admin-section world-admin-bar">
        <div>
          <div class="admin-label">Console Monde</div>
          <div class="world-admin-bar__text">Crée, trie et publie les missions du tableau. Les cartes marquées “Privée” restent cachées pour les joueurs.</div>
        </div>
        <div class="world-admin-bar__actions">
          <button class="btn btn-outline btn-sm" type="button" onclick="openWorldSettingsModal()">⚙️ Paramètres</button>
          <button class="btn btn-gold btn-sm" type="button" onclick="openWorldMissionModal()">+ Ajouter une mission</button>
        </div>
      </div>
    ` : ''}

    <section class="world-toolbar card">
      <div class="world-toolbar__top">
        <div>
          <div class="card-header" style="margin-bottom:0.65rem">Filtrer les missions</div>
          <div class="world-toolbar__hint">Le tableau se met à jour instantanément selon vos critères.</div>
        </div>
        <button class="btn btn-outline btn-sm" type="button" onclick="resetWorldFilters()">Réinitialiser</button>
      </div>
      <div class="world-toolbar__grid">
        <div class="form-group world-toolbar__search">
          <label>Recherche</label>
          <input class="input-field" type="text" placeholder="Titre, lieu, récompense, tag…" value="${escapeHtml(filters.search)}" onchange="setWorldSearch(this.value)" onkeyup="if(event.key==='Enter'){setWorldSearch(this.value)}">
        </div>
        <div class="form-group">
          <label>Statut</label>
          <select class="input-field" onchange="setWorldFilter('status', this.value)">
            <option value="actives" ${filters.status === 'actives' ? 'selected' : ''}>Actives</option>
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Tous les statuts</option>
            ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${filters.status === status ? 'selected' : ''}>${escapeHtml(getStatusMeta(status).label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Type</label>
          <select class="input-field" onchange="setWorldFilter('type', this.value)">
            <option value="all" ${filters.type === 'all' ? 'selected' : ''}>Tous les types</option>
            ${uniqueTypes.length ? uniqueTypes : TYPE_OPTIONS}.map((type) => `<option value="${escapeHtml(type)}" ${filters.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')
          </select>
        </div>
        <div class="form-group">
          <label>Difficulté</label>
          <select class="input-field" onchange="setWorldFilter('difficulty', this.value)">
            <option value="all" ${filters.difficulty === 'all' ? 'selected' : ''}>Toutes</option>
            ${DIFFICULTY_OPTIONS.map((difficulty) => `<option value="${difficulty}" ${filters.difficulty === difficulty ? 'selected' : ''}>${escapeHtml(getDifficultyMeta(difficulty).label)}</option>`).join('')}
          </select>
        </div>
        ${isAdmin ? `
          <div class="form-group">
            <label>Visibilité</label>
            <select class="input-field" onchange="setWorldFilter('visibility', this.value)">
              <option value="all" ${filters.visibility === 'all' ? 'selected' : ''}>Tout afficher</option>
              <option value="public" ${filters.visibility === 'public' ? 'selected' : ''}>Publiées</option>
              <option value="hidden" ${filters.visibility === 'hidden' ? 'selected' : ''}>Privées</option>
            </select>
          </div>
        ` : ''}
      </div>
    </section>

    ${visibleMissions.length === 0 ? `
      <div class="empty-state card world-empty-state">
        <span class="icon">📭</span>
        <p class="world-empty-state__title">${escapeHtml(settings.emptyStateTitle)}</p>
        <p>${escapeHtml(settings.emptyStateText)}</p>
        ${isAdmin ? '<button class="btn btn-gold btn-sm" type="button" onclick="openWorldMissionModal()">Créer la première mission</button>' : ''}
      </div>
    ` : `
      <div class="world-results-row">
        <div class="world-results-count">${visibleMissions.length} mission${visibleMissions.length > 1 ? 's' : ''} affichée${visibleMissions.length > 1 ? 's' : ''}</div>
      </div>
      <div class="world-mission-grid">
        ${visibleMissions.map((mission) => renderMissionCard(mission, isAdmin)).join('')}
      </div>
    `}
  `;
}

async function openWorldSettingsModal() {
  const doc = await getDocData(WORLD_SETTINGS_PATH.col, WORLD_SETTINGS_PATH.id);
  const settings = getWorldSettings(doc);
  openModal('⚙️ Paramètres de la page Monde', `
    <div class="form-group"><label>Titre principal</label><input class="input-field" id="world-settings-title" value="${escapeHtml(settings.heroTitle)}"></div>
    <div class="form-group"><label>Sous-titre</label><input class="input-field" id="world-settings-subtitle" value="${escapeHtml(settings.heroSubtitle)}"></div>
    <div class="form-group"><label>Introduction</label><textarea class="input-field" id="world-settings-intro" rows="6">${escapeHtml(settings.intro)}</textarea></div>
    <div class="form-group"><label>Note de tableau</label><textarea class="input-field" id="world-settings-note" rows="3">${escapeHtml(settings.boardNote)}</textarea></div>
    <div class="grid-2" style="gap:0.9rem">
      <div class="form-group"><label>Titre état vide</label><input class="input-field" id="world-settings-empty-title" value="${escapeHtml(settings.emptyStateTitle)}"></div>
      <div class="form-group"><label>Texte état vide</label><textarea class="input-field" id="world-settings-empty-text" rows="3">${escapeHtml(settings.emptyStateText)}</textarea></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-outline" type="button" onclick="closeModalDirect()">Annuler</button>
      <button class="btn btn-gold" type="button" onclick="saveWorldSettings()">Enregistrer</button>
    </div>
  `);
}

async function saveWorldSettings() {
  const settings = {
    heroTitle: document.getElementById('world-settings-title')?.value?.trim() || DEFAULT_WORLD_SETTINGS.heroTitle,
    heroSubtitle: document.getElementById('world-settings-subtitle')?.value?.trim() || DEFAULT_WORLD_SETTINGS.heroSubtitle,
    intro: document.getElementById('world-settings-intro')?.value?.trim() || DEFAULT_WORLD_SETTINGS.intro,
    boardNote: document.getElementById('world-settings-note')?.value?.trim() || '',
    emptyStateTitle: document.getElementById('world-settings-empty-title')?.value?.trim() || DEFAULT_WORLD_SETTINGS.emptyStateTitle,
    emptyStateText: document.getElementById('world-settings-empty-text')?.value?.trim() || DEFAULT_WORLD_SETTINGS.emptyStateText,
  };
  await saveDoc(WORLD_SETTINGS_PATH.col, WORLD_SETTINGS_PATH.id, {
    pageType: 'missions',
    settings,
    updatedAt: new Date().toISOString(),
  });
  closeModal();
  showNotif('Paramètres du Monde mis à jour.', 'success');
  await PAGES.world();
}

function findWorldMissionById(id) {
  return (window.__worldMissions || []).find((mission) => mission.id === id) || null;
}

async function openWorldMissionModal(id = null) {
  const mission = id ? findWorldMissionById(id) : null;
  openModal(mission ? `✏️ Modifier — ${mission.title}` : '📜 Nouvelle mission', `
    <input type="hidden" id="world-mission-id" value="${escapeHtml(mission?.id || '')}">
    <div class="grid-2 world-modal-grid">
      <div class="form-group"><label>Titre</label><input class="input-field" id="world-mission-title" value="${escapeHtml(mission?.title || '')}" placeholder="Ex. Récupérer le grimoire perdu"></div>
      <div class="form-group"><label>Type</label><select class="input-field" id="world-mission-type">${TYPE_OPTIONS.map((type) => `<option value="${escapeHtml(type)}" ${mission?.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Résumé</label><textarea class="input-field" id="world-mission-summary" rows="3" placeholder="Texte court affiché sur la carte">${escapeHtml(mission?.summary || '')}</textarea></div>
      <div class="form-group"><label>Description détaillée</label><textarea class="input-field" id="world-mission-description" rows="5" placeholder="Contexte, enjeux, risques, informations utiles…">${escapeHtml(mission?.description || '')}</textarea></div>
      <div class="form-group"><label>Lieu</label><input class="input-field" id="world-mission-location" value="${escapeHtml(mission?.location || '')}"></div>
      <div class="form-group"><label>Objectif</label><input class="input-field" id="world-mission-objective" value="${escapeHtml(mission?.objective || '')}"></div>
      <div class="form-group"><label>Récompense</label><input class="input-field" id="world-mission-reward" value="${escapeHtml(mission?.reward || '')}"></div>
      <div class="form-group"><label>Durée estimée</label><input class="input-field" id="world-mission-duration" value="${escapeHtml(mission?.duration || '')}" placeholder="1 session, 3 jours, etc."></div>
      <div class="form-group"><label>Niveau conseillé</label><input class="input-field" id="world-mission-level" value="${escapeHtml(mission?.level || '')}" placeholder="Niv. 2 à 4"></div>
      <div class="form-group"><label>Taille du groupe</label><input class="input-field" id="world-mission-group" value="${escapeHtml(mission?.groupSize || '')}" placeholder="2 à 5 aventuriers"></div>
      <div class="form-group"><label>Contact / Commanditaire</label><input class="input-field" id="world-mission-contact" value="${escapeHtml(mission?.contact || '')}"></div>
      <div class="form-group"><label>Prérequis</label><input class="input-field" id="world-mission-prerequisites" value="${escapeHtml(mission?.prerequisites || '')}" placeholder="Objet, accès, réputation…"></div>
      <div class="form-group"><label>Statut</label><select class="input-field" id="world-mission-status">${STATUS_OPTIONS.map((status) => `<option value="${status}" ${mission?.status === status ? 'selected' : ''}>${escapeHtml(getStatusMeta(status).label)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Difficulté</label><select class="input-field" id="world-mission-difficulty">${DIFFICULTY_OPTIONS.map((difficulty) => `<option value="${difficulty}" ${mission?.difficulty === difficulty ? 'selected' : ''}>${escapeHtml(getDifficultyMeta(difficulty).label)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Ordre d'affichage</label><input class="input-field" id="world-mission-order" type="number" value="${escapeHtml(String(mission?.order ?? (window.__worldMissions?.length || 0) + 1))}"></div>
      <div class="form-group"><label>Tags</label><input class="input-field" id="world-mission-tags" value="${escapeHtml((mission?.tags || []).join(', '))}" placeholder="forêt, relique, infiltration"></div>
    </div>
    <div class="world-modal-toggles">
      <label class="world-toggle-option"><input type="checkbox" id="world-mission-public" ${mission ? (mission.isPublic ? 'checked' : '') : 'checked'}> <span>Visible pour les joueurs</span></label>
      <label class="world-toggle-option"><input type="checkbox" id="world-mission-featured" ${mission?.featured ? 'checked' : ''}> <span>Mission prioritaire</span></label>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;flex-wrap:wrap">
      <button class="btn btn-outline" type="button" onclick="closeModalDirect()">Annuler</button>
      <button class="btn btn-gold" type="button" onclick="saveWorldMission()">${mission ? 'Mettre à jour' : 'Créer la mission'}</button>
    </div>
  `);
}

async function saveWorldMission() {
  const id = document.getElementById('world-mission-id')?.value?.trim() || '';
  const title = document.getElementById('world-mission-title')?.value?.trim() || '';
  if (!title) {
    showNotif('Le titre est requis.', 'error');
    return;
  }

  const payload = {
    title,
    type: document.getElementById('world-mission-type')?.value || 'Mission',
    summary: document.getElementById('world-mission-summary')?.value?.trim() || '',
    description: document.getElementById('world-mission-description')?.value?.trim() || '',
    location: document.getElementById('world-mission-location')?.value?.trim() || '',
    objective: document.getElementById('world-mission-objective')?.value?.trim() || '',
    reward: document.getElementById('world-mission-reward')?.value?.trim() || '',
    duration: document.getElementById('world-mission-duration')?.value?.trim() || '',
    level: document.getElementById('world-mission-level')?.value?.trim() || '',
    groupSize: document.getElementById('world-mission-group')?.value?.trim() || '',
    contact: document.getElementById('world-mission-contact')?.value?.trim() || '',
    prerequisites: document.getElementById('world-mission-prerequisites')?.value?.trim() || '',
    status: document.getElementById('world-mission-status')?.value || 'disponible',
    difficulty: document.getElementById('world-mission-difficulty')?.value || 'moyenne',
    order: Number(document.getElementById('world-mission-order')?.value || 0) || 0,
    tags: parseTags(document.getElementById('world-mission-tags')?.value || ''),
    isPublic: !!document.getElementById('world-mission-public')?.checked,
    featured: !!document.getElementById('world-mission-featured')?.checked,
    updatedAt: new Date().toISOString(),
  };

  if (id) await updateInCol(WORLD_MISSIONS_COL, id, payload);
  else await addToCol(WORLD_MISSIONS_COL, payload);

  closeModal();
  showNotif(id ? 'Mission mise à jour.' : 'Mission créée.', 'success');
  await PAGES.world();
}

async function deleteWorldMission(id) {
  const mission = findWorldMissionById(id);
  if (!mission) return;
  if (!window.confirm(`Supprimer définitivement "${mission.title}" ?`)) return;
  await deleteFromCol(WORLD_MISSIONS_COL, id);
  showNotif('Mission supprimée.', 'success');
  await PAGES.world();
}

function openWorldMissionDetails(id) {
  const mission = findWorldMissionById(id);
  if (!mission) return;
  const statusMeta = getStatusMeta(mission.status);
  const difficultyMeta = getDifficultyMeta(mission.difficulty);
  openModal(`📜 ${mission.title}`, `
    <div class="world-detail-modal">
      <div class="world-detail-modal__badges">
        <span class="badge ${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>
        <span class="badge ${difficultyMeta.className}">${escapeHtml(difficultyMeta.label)}</span>
        <span class="badge badge-blue">${escapeHtml(mission.type)}</span>
        ${mission.featured ? '<span class="badge badge-gold">Prioritaire</span>' : ''}
        ${!mission.isPublic ? '<span class="badge badge-red">Privée</span>' : ''}
      </div>
      ${mission.summary ? `<p class="world-detail-modal__summary">${escapeHtml(mission.summary)}</p>` : ''}
      ${mission.description ? `<div class="world-detail-modal__section"><div class="card-header" style="margin-bottom:0.6rem">Description</div><div class="world-detail-modal__text">${nl2br(mission.description)}</div></div>` : ''}
      <div class="world-detail-modal__meta grid-2">
        ${missionMetaLine('Lieu', mission.location)}
        ${missionMetaLine('Objectif', mission.objective)}
        ${missionMetaLine('Récompense', mission.reward)}
        ${missionMetaLine('Durée', mission.duration)}
        ${missionMetaLine('Niveau conseillé', mission.level)}
        ${missionMetaLine('Taille du groupe', mission.groupSize)}
        ${missionMetaLine('Contact', mission.contact)}
        ${missionMetaLine('Prérequis', mission.prerequisites)}
      </div>
      ${mission.tags?.length ? `<div class="world-detail-modal__tags">${mission.tags.map((tag) => `<span class="char-pill">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div style="display:flex;justify-content:flex-end;margin-top:1rem">
        <button class="btn btn-outline" type="button" onclick="closeModalDirect()">Fermer</button>
      </div>
    </div>
  `);
}

function setWorldFilter(key, value) {
  const filters = ensureWorldFilters(true);
  filters[key] = value;
  window.__worldFilters = filters;
  PAGES.world();
}

function setWorldSearch(value) {
  const filters = ensureWorldFilters(true);
  filters.search = value;
  window.__worldFilters = filters;
  PAGES.world();
}

function resetWorldFilters() {
  window.__worldFilters = null;
  PAGES.world();
}

async function saveMapUrl() {
  const imageUrl = document.getElementById('map-url-input')?.value?.trim() || '';
  await saveDoc('world', 'map', { imageUrl });
  showNotif('Carte mise à jour.', 'success');
  await PAGES.map();
}

Object.assign(window, {
  renderWorldPage,
  openWorldSettingsModal,
  saveWorldSettings,
  openWorldMissionModal,
  saveWorldMission,
  deleteWorldMission,
  openWorldMissionDetails,
  setWorldFilter,
  setWorldSearch,
  resetWorldFilters,
  saveMapUrl,
});
