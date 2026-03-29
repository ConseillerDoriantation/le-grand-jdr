import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

const PLAYER_STAGE_STORE = {
  items: [],
  activeId: '',
  presentations: [],
  characters: [],
};

const PLAYER_STAT_META = [
  { key: 'force', label: 'Force', short: 'FO' },
  { key: 'dexterite', label: 'Dextérité', short: 'DEX' },
  { key: 'intelligence', label: 'Intelligence', short: 'INT' },
  { key: 'sagesse', label: 'Sagesse', short: 'SAG' },
  { key: 'constitution', label: 'Constitution', short: 'CON' },
  { key: 'charisme', label: 'Charisme', short: 'CHA' },
];

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function nl2br(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function normalizeKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function initialsFromName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'PJ';
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('');
}

function truncateText(value = '', max = 220) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max).trimEnd()}…`;
}

function getCharacterStat(char = {}, key = '') {
  const base = (char.stats || {})[key] || 8;
  const bonus = (char.statsBonus || {})[key] || 0;
  return Math.min(22, base + bonus);
}

function getCharacterMod(char = {}, key = '') {
  return Math.floor((getCharacterStat(char, key) - 10) / 2);
}

function calcCharacterPVMax(char = {}) {
  const mod = getCharacterMod(char, 'constitution');
  const level = char.niveau || 1;
  const progression = mod > 0 ? Math.floor(mod * (level - 1)) : mod;
  return Math.max(1, (char.pvBase || 10) + progression);
}

function calcCharacterPMMax(char = {}) {
  const mod = getCharacterMod(char, 'sagesse');
  const level = char.niveau || 1;
  const progression = mod > 0 ? Math.floor(mod * (level - 1)) : mod;
  return Math.max(0, (char.pmBase || 10) + progression);
}

function calcCharacterCA(char = {}) {
  const equip = char.equipement || {};
  const torse = equip['Torse']?.typeArmure || '';
  let base = 8;
  if (torse === 'Légère') base = 10;
  else if (torse === 'Intermédiaire') base = 12;
  else if (torse === 'Lourde') base = 14;
  const caEquip = Object.values(equip).reduce((sum, item) => sum + (item?.ca || 0), 0);
  return base + getCharacterMod(char, 'dexterite') + caEquip;
}

function calcCharacterVitesse(char = {}) {
  return 3 + getCharacterMod(char, 'force');
}

function calcCharacterDeckMax(char = {}) {
  const mod = getCharacterMod(char, 'intelligence');
  const level = char.niveau || 1;
  return 3 + Math.min(0, mod) + Math.floor(Math.max(0, mod) * Math.pow(Math.max(0, level - 1), 0.75));
}

function calcCharacterGold(char = {}) {
  const compte = char.compte || { recettes: [], depenses: [] };
  const recettes = (compte.recettes || []).reduce((sum, row) => sum + (parseFloat(row?.montant) || 0), 0);
  const depenses = (compte.depenses || []).reduce((sum, row) => sum + (parseFloat(row?.montant) || 0), 0);
  return Math.round((recettes - depenses) * 100) / 100;
}

function getCharacterEquipmentList(char = {}) {
  return Object.entries(char.equipement || {})
    .filter(([, item]) => item?.nom)
    .map(([slot, item]) => ({ slot, nom: item.nom, detail: item.typeArmure || item.type || item.particularite || '' }));
}

function getCharacterNotesPreview(char = {}) {
  const lastNote = (char.notesList || []).slice().reverse().find(note => note?.contenu?.trim());
  return truncateText(lastNote?.contenu || char.notes || '', 260);
}

function buildPlayerRecord(character = null, presentation = null) {
  const level = presentation?.niveau || character?.niveau || 1;
  const titles = character?.titres || [];
  const equipment = getCharacterEquipmentList(character);
  const imageUrl = presentation?.imageUrl || character?.photo || '';
  const bio = presentation?.bio?.trim() || getCharacterNotesPreview(character) || 'Aucune présentation narrative n\'est encore renseignée pour ce personnage.';
  const playerName = presentation?.joueur?.trim() || character?.ownerPseudo || '';
  const classe = presentation?.classe?.trim() || '';
  const race = presentation?.race?.trim() || '';
  const subtitle = [classe, race].filter(Boolean).join(' · ');
  const statRows = PLAYER_STAT_META.map(stat => ({
    ...stat,
    value: character ? getCharacterStat(character, stat.key) : null,
  })).filter(row => row.value !== null);

  const hasCharacterSheet = Boolean(character);
  const hasPresentation = Boolean(presentation);

  return {
    id: presentation?.id || `char:${character?.id || Math.random().toString(36).slice(2)}`,
    presentationId: presentation?.id || '',
    charId: presentation?.charId || character?.id || '',
    nom: presentation?.nom?.trim() || character?.nom || 'Personnage',
    classe,
    race,
    subtitle,
    niveau: level,
    joueur: playerName,
    bio,
    imageUrl,
    emoji: presentation?.emoji?.trim() || '',
    initials: initialsFromName(presentation?.nom || character?.nom || 'PJ'),
    titles,
    stats: statRows,
    hasCharacterSheet,
    hasPresentation,
    sourceLabel: hasCharacterSheet && hasPresentation
      ? 'Fiche liée'
      : hasCharacterSheet
        ? 'Depuis la base'
        : 'Présentation',
    pvActuel: character?.pvActuel ?? null,
    pvMax: hasCharacterSheet ? calcCharacterPVMax(character) : null,
    pmActuel: character?.pmActuel ?? null,
    pmMax: hasCharacterSheet ? calcCharacterPMMax(character) : null,
    ca: hasCharacterSheet ? calcCharacterCA(character) : null,
    vitesse: hasCharacterSheet ? calcCharacterVitesse(character) : null,
    deckActif: character?.deck_sorts?.length ?? null,
    deckMax: hasCharacterSheet ? calcCharacterDeckMax(character) : null,
    xp: character?.exp ?? null,
    gold: hasCharacterSheet ? calcCharacterGold(character) : null,
    quests: character?.quetes?.length ?? 0,
    spells: character?.deck_sorts?.length ?? 0,
    inventoryCount: character?.inventaire?.length ?? 0,
    equipment,
    photoZoom: character?.photoZoom || 1,
    photoX: character?.photoX || 0,
    photoY: character?.photoY || 0,
    notePreview: getCharacterNotesPreview(character),
    character,
  };
}

function buildPlayerDataset(presentations = [], characters = []) {
  const usedPresentationIds = new Set();
  const presentationsByCharId = new Map();
  const presentationsByName = new Map();

  presentations.forEach(entry => {
    if (entry?.charId) presentationsByCharId.set(entry.charId, entry);
    const key = normalizeKey(entry?.nom);
    if (!key) return;
    const bucket = presentationsByName.get(key) || [];
    bucket.push(entry);
    presentationsByName.set(key, bucket);
  });

  const items = characters.map(char => {
    let linkedPresentation = presentationsByCharId.get(char.id) || null;
    if (!linkedPresentation) {
      const nameMatches = presentationsByName.get(normalizeKey(char.nom)) || [];
      linkedPresentation = nameMatches.find(entry => !usedPresentationIds.has(entry.id)) || null;
    }
    if (linkedPresentation?.id) usedPresentationIds.add(linkedPresentation.id);
    return buildPlayerRecord(char, linkedPresentation);
  });

  presentations
    .filter(entry => !usedPresentationIds.has(entry.id))
    .forEach(entry => items.push(buildPlayerRecord(null, entry)));

  return items.sort((a, b) => {
    if ((b.niveau || 0) !== (a.niveau || 0)) return (b.niveau || 0) - (a.niveau || 0);
    return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
  });
}

function summarizePlayers(items = []) {
  const total = items.length;
  const linkedCount = items.filter(item => item.hasCharacterSheet).length;
  const enrichedCount = items.filter(item => item.hasPresentation).length;
  const withPortraitCount = items.filter(item => item.imageUrl).length;
  const averageLevel = total ? (items.reduce((sum, item) => sum + (item.niveau || 0), 0) / total) : 0;
  return {
    total,
    linkedCount,
    enrichedCount,
    withPortraitCount,
    averageLevel: averageLevel ? averageLevel.toFixed(1).replace('.0', '') : '0',
  };
}

function getActivePlayerRecord() {
  return PLAYER_STAGE_STORE.items.find(item => item.id === PLAYER_STAGE_STORE.activeId) || PLAYER_STAGE_STORE.items[0] || null;
}

function getPlayerMediaMarkup(item, variant = 'cover') {
  const source = item?.imageUrl || '';
  if (source) {
    const transformStyle = item?.character?.photo && source === item.character.photo
      ? ` style="transform:scale(${item.photoZoom || 1}) translate(${item.photoX || 0}px, ${item.photoY || 0}px);transform-origin:center center;"`
      : '';
    return `<img src="${escapeHtml(source)}" alt="${escapeHtml(item.nom)}" class="players-showcase-media players-showcase-media--${variant}"${transformStyle}>`;
  }
  if (item?.emoji) {
    return `<span class="players-showcase-fallback players-showcase-fallback--emoji">${escapeHtml(item.emoji)}</span>`;
  }
  return `<span class="players-showcase-fallback">${escapeHtml(item?.initials || 'PJ')}</span>`;
}

function renderRosterCard(item, active = false) {
  const subline = [item.subtitle, `Niv. ${item.niveau || 1}`].filter(Boolean).join(' · ');
  return `
    <button type="button" class="players-showcase-roster-card${active ? ' is-active' : ''}" data-player-id="${escapeHtml(item.id)}" onclick='selectPlayerShowcase(${JSON.stringify(item.id)})'>
      <span class="players-showcase-roster-card__avatar">${getPlayerMediaMarkup(item, 'thumb')}</span>
      <span class="players-showcase-roster-card__body">
        <span class="players-showcase-roster-card__top">
          <strong>${escapeHtml(item.nom)}</strong>
          <em>${escapeHtml(item.sourceLabel)}</em>
        </span>
        <span class="players-showcase-roster-card__sub">${escapeHtml(subline || 'Profil de campagne')}</span>
        <span class="players-showcase-roster-card__meta">
          ${item.joueur ? `<span>${escapeHtml(item.joueur)}</span>` : '<span>Compagnie</span>'}
          <span>${item.hasCharacterSheet ? 'Fiche active' : 'Présentation seule'}</span>
        </span>
      </span>
    </button>`;
}

function renderStatsPanel(item) {
  if (!item?.stats?.length) {
    return `
      <article class="players-showcase-panel players-showcase-panel--empty">
        <span class="players-showcase-panel__label">Statistiques</span>
        <p>Les statistiques détaillées apparaissent automatiquement dès qu'une fiche personnage est liée à cette présentation.</p>
      </article>`;
  }

  return `
    <article class="players-showcase-panel">
      <span class="players-showcase-panel__label">Statistiques</span>
      <div class="players-showcase-stat-list">
        ${item.stats.map(stat => {
          const pct = Math.max(10, Math.min(100, Math.round((stat.value / 22) * 100)));
          return `
            <div class="players-showcase-stat-row">
              <div class="players-showcase-stat-row__head">
                <span>${escapeHtml(stat.label)}</span>
                <strong>${stat.value}</strong>
              </div>
              <div class="players-showcase-stat-row__bar"><i style="width:${pct}%"></i></div>
            </div>`;
        }).join('')}
      </div>
    </article>`;
}

function renderEquipmentPanel(item) {
  const equipment = item?.equipment || [];
  if (!equipment.length) {
    return `
      <article class="players-showcase-panel players-showcase-panel--empty">
        <span class="players-showcase-panel__label">Équipement</span>
        <p>Aucun équipement majeur n'est encore remonté depuis la fiche.</p>
      </article>`;
  }

  return `
    <article class="players-showcase-panel">
      <span class="players-showcase-panel__label">Équipement</span>
      <div class="players-showcase-list">
        ${equipment.slice(0, 6).map(entry => `
          <div class="players-showcase-list__item">
            <div>
              <strong>${escapeHtml(entry.slot)}</strong>
              <span>${escapeHtml(entry.nom)}</span>
            </div>
            ${entry.detail ? `<em>${escapeHtml(entry.detail)}</em>` : '<em>—</em>'}
          </div>`).join('')}
      </div>
    </article>`;
}

function renderDataPanel(item) {
  const rows = [
    { label: 'Joueur', value: item.joueur || '—' },
    { label: 'Niveau', value: `Niv. ${item.niveau || 1}` },
    { label: 'Titres', value: item.titles?.length ? item.titles.join(' · ') : 'Aucun titre' },
    { label: 'Quêtes', value: item.quests ? String(item.quests) : '0' },
    { label: 'Inventaire', value: item.inventoryCount ? `${item.inventoryCount} objets` : 'Aucun objet' },
  ];

  return `
    <article class="players-showcase-panel">
      <span class="players-showcase-panel__label">Repères</span>
      <div class="players-showcase-data-list">
        ${rows.map(row => `
          <div class="players-showcase-data-list__row">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
          </div>`).join('')}
      </div>
    </article>`;
}

function renderProgressPanel(item) {
  const chips = [
    item.pvMax !== null ? `<div class="players-showcase-chip"><span>PV</span><strong>${item.pvActuel ?? item.pvMax} / ${item.pvMax}</strong></div>` : '',
    item.pmMax !== null ? `<div class="players-showcase-chip"><span>PM</span><strong>${item.pmActuel ?? item.pmMax} / ${item.pmMax}</strong></div>` : '',
    item.ca !== null ? `<div class="players-showcase-chip"><span>CA</span><strong>${item.ca}</strong></div>` : '',
    item.vitesse !== null ? `<div class="players-showcase-chip"><span>Vitesse</span><strong>${item.vitesse} m</strong></div>` : '',
    item.deckMax !== null ? `<div class="players-showcase-chip"><span>Deck</span><strong>${item.deckActif ?? 0} / ${item.deckMax}</strong></div>` : '',
    item.gold !== null ? `<div class="players-showcase-chip"><span>Or</span><strong>${item.gold}</strong></div>` : '',
  ].filter(Boolean);

  return `
    <article class="players-showcase-panel${chips.length ? '' : ' players-showcase-panel--empty'}">
      <span class="players-showcase-panel__label">Ressources</span>
      ${chips.length
        ? `<div class="players-showcase-chip-grid">${chips.join('')}</div>`
        : '<p>Les ressources de jeu apparaissent automatiquement lorsque la fiche personnage est complète.</p>'}
    </article>`;
}

function renderStageActions(item) {
  const adminActions = STATE.isAdmin
    ? `
      <div class="players-showcase-actions">
        <button class="btn btn-outline btn-sm" type="button" onclick='openLinkedPlayerPresent(${JSON.stringify(item.charId || '')}, ${JSON.stringify(item.presentationId || '')})'>
          ${item.presentationId ? 'Modifier la présentation' : 'Créer une présentation'}
        </button>
        ${item.presentationId ? `<button class="btn btn-danger btn-sm" type="button" onclick='deletePlayerPresent(${JSON.stringify(item.presentationId)})'>Supprimer</button>` : ''}
      </div>`
    : '';

  const sheetAction = item.charId
    ? `<button class="btn btn-gold btn-sm" type="button" onclick='openCharacterSheetFromShowcase(${JSON.stringify(item.charId)})'>Ouvrir la fiche complète</button>`
    : '';

  if (!sheetAction && !adminActions) return '';

  return `
    <div class="players-showcase-stage__footer">
      <div class="players-showcase-actions">
        ${sheetAction}
      </div>
      ${adminActions}
    </div>`;
}

function renderStage(item) {
  if (!item) {
    return '<div class="players-showcase-empty">Aucun personnage disponible.</div>';
  }

  const subtitle = [item.subtitle, `Niv. ${item.niveau || 1}`].filter(Boolean).join(' · ');
  const tags = [
    item.joueur ? `<span class="players-showcase-tag">${escapeHtml(item.joueur)}</span>` : '',
    ...((item.titles || []).slice(0, 4).map(title => `<span class="players-showcase-tag">${escapeHtml(title)}</span>`)),
  ].filter(Boolean).join('');

  return `
    <div class="players-showcase-stage-shell">
      <div class="players-showcase-stage__hero">
        <div class="players-showcase-stage__media">
          <div class="players-showcase-stage__glow"></div>
          <div class="players-showcase-stage__frame">${getPlayerMediaMarkup(item, 'cover')}</div>
          <div class="players-showcase-stage__source">${escapeHtml(item.sourceLabel)}</div>
        </div>
        <div class="players-showcase-stage__body">
          <span class="players-showcase-stage__eyebrow">Compagnie active</span>
          <h2>${escapeHtml(item.nom)}</h2>
          <p class="players-showcase-stage__subtitle">${escapeHtml(subtitle || 'Profil de personnage')}</p>
          ${tags ? `<div class="players-showcase-stage__tags">${tags}</div>` : ''}
          <div class="players-showcase-stage__bio">${nl2br(item.bio)}</div>
          ${renderStageActions(item)}
        </div>
      </div>
      <div class="players-showcase-stage__grid">
        ${renderDataPanel(item)}
        ${renderProgressPanel(item)}
        ${renderStatsPanel(item)}
        ${renderEquipmentPanel(item)}
      </div>
    </div>`;
}

function renderPlayersShowcase(items = []) {
  const summary = summarizePlayers(items);
  const active = getActivePlayerRecord() || items[0] || null;

  return `
    <div class="page-header">
      <div class="page-title"><span class="page-title-accent">⚔️ Présentation des Joueurs</span></div>
      <div class="page-subtitle">Une galerie connectée aux fiches existantes de la campagne</div>
    </div>

    <section class="players-showcase-page">
      <div class="players-showcase-hero">
        <div class="players-showcase-hero__copy">
          <span class="players-showcase-hero__kicker">Compagnie</span>
          <h1>Les personnages de la campagne</h1>
          <p>Cette page fusionne les présentations éditoriales et les fiches existantes de la base afin d'afficher un roster plus riche, plus lisible et directement relié aux données du jeu.</p>
        </div>
        <div class="players-showcase-hero__stats">
          <div class="players-showcase-hero-card"><span>Personnages</span><strong>${summary.total}</strong><small>visibles sur le site</small></div>
          <div class="players-showcase-hero-card"><span>Fiches liées</span><strong>${summary.linkedCount}</strong><small>alimentées depuis la base</small></div>
          <div class="players-showcase-hero-card"><span>Présentations enrichies</span><strong>${summary.enrichedCount}</strong><small>texte ou image dédiée</small></div>
          <div class="players-showcase-hero-card"><span>Niveau moyen</span><strong>${summary.averageLevel}</strong><small>moyenne du roster</small></div>
        </div>
      </div>

      ${STATE.isAdmin ? `
        <div class="admin-section" style="margin-bottom:1.2rem">
          <div class="admin-label">Gestion Admin</div>
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center">
            <button class="btn btn-gold btn-sm" type="button" onclick="openPlayerPresentModal()">+ Ajouter une présentation</button>
            <span style="font-size:0.78rem;color:var(--text-dim)">Les personnages existants sont remontés automatiquement depuis la collection <code>characters</code>.</span>
          </div>
        </div>` : ''}

      <div class="players-showcase-layout">
        <aside class="players-showcase-roster">
          <div class="players-showcase-roster__header">
            <div>
              <span class="players-showcase-roster__eyebrow">Roster</span>
              <h2>Compagnie active</h2>
            </div>
            <span class="players-showcase-roster__count">${items.length}</span>
          </div>
          <div class="players-showcase-roster__list">
            ${items.map(item => renderRosterCard(item, active?.id === item.id)).join('')}
          </div>
        </aside>
        <section class="players-showcase-stage" id="players-showcase-stage">
          ${renderStage(active)}
        </section>
      </div>
    </section>`;
}

async function loadPlayerShowcaseItems() {
  const [presentations, characters] = await Promise.all([
    loadCollection('players'),
    loadCollection('characters'),
  ]);

  PLAYER_STAGE_STORE.presentations = presentations;
  PLAYER_STAGE_STORE.characters = characters;
  PLAYER_STAGE_STORE.items = buildPlayerDataset(presentations, characters);
  if (!PLAYER_STAGE_STORE.items.some(item => item.id === PLAYER_STAGE_STORE.activeId)) {
    PLAYER_STAGE_STORE.activeId = PLAYER_STAGE_STORE.items[0]?.id || '';
  }
  return PLAYER_STAGE_STORE.items;
}

async function renderPlayersPage() {
  const items = await loadPlayerShowcaseItems();
  const content = document.getElementById('main-content');

  if (!items.length) {
    content.innerHTML = `
      <div class="page-header">
        <div class="page-title"><span class="page-title-accent">⚔️ Présentation des Joueurs</span></div>
        <div class="page-subtitle">Les héros de cette aventure</div>
      </div>
      ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Gestion Admin</div><button class="btn btn-gold btn-sm" onclick="openPlayerPresentModal()">+ Ajouter une présentation</button></div>` : ''}
      <div class="empty-state"><div class="icon">⚔️</div><p>Aucun personnage ou présentation n'est encore disponible.</p></div>`;
    return;
  }

  content.innerHTML = renderPlayersShowcase(items);
}

function selectPlayerShowcase(id) {
  PLAYER_STAGE_STORE.activeId = id;
  const active = getActivePlayerRecord();
  document.querySelectorAll('.players-showcase-roster-card').forEach(card => card.classList.remove('is-active'));
  const selected = Array.from(document.querySelectorAll('.players-showcase-roster-card'))
    .find(card => card.dataset.playerId === id);
  selected?.classList.add('is-active');
  const stage = document.getElementById('players-showcase-stage');
  if (stage) stage.innerHTML = renderStage(active);
}

async function openPlayerPresentModal(player = null) {
  const characters = PLAYER_STAGE_STORE.characters.length
    ? PLAYER_STAGE_STORE.characters
    : await loadCollection('characters');

  window.__playerPresentCharacters = characters;

  const currentCharId = player?.charId || '';
  const characterOptions = [`<option value="">— Aucun lien —</option>`]
    .concat(characters.map(char => `<option value="${escapeHtml(char.id)}" ${char.id === currentCharId ? 'selected' : ''}>${escapeHtml(char.nom || 'Personnage')}</option>`))
    .join('');

  openModal(player ? '✏️ Modifier la présentation' : '⚔️ Ajouter une présentation', `
    <div class="form-group">
      <label>Fiche personnage liée</label>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0.65rem;align-items:end">
        <select class="input-field" id="pp-char-id">${characterOptions}</select>
        <button class="btn btn-outline btn-sm" type="button" onclick="prefillPlayerPresentFromLinkedChar(true)">Préremplir</button>
      </div>
    </div>
    <div class="form-group"><label>Nom du personnage</label><input class="input-field" id="pp-nom" value="${escapeHtml(player?.nom || '')}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Classe</label><input class="input-field" id="pp-classe" value="${escapeHtml(player?.classe || '')}"></div>
      <div class="form-group"><label>Race</label><input class="input-field" id="pp-race" value="${escapeHtml(player?.race || '')}"></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Niveau</label><input type="number" class="input-field" id="pp-niveau" value="${escapeHtml(player?.niveau || 1)}"></div>
      <div class="form-group"><label>Emoji</label><input class="input-field" id="pp-emoji" value="${escapeHtml(player?.emoji || '⚔️')}"></div>
    </div>
    <div class="form-group"><label>Joueur</label><input class="input-field" id="pp-joueur" value="${escapeHtml(player?.joueur || '')}"></div>
    <div class="form-group"><label>Présentation</label><textarea class="input-field" id="pp-bio" rows="6">${escapeHtml(player?.bio || '')}</textarea></div>
    <div class="form-group"><label>URL image</label><input class="input-field" id="pp-img" value="${escapeHtml(player?.imageUrl || '')}"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick='savePlayerPresent(${JSON.stringify(player?.id || '')})'>Enregistrer</button>
  `);
}

function prefillPlayerPresentFromLinkedChar(force = false) {
  const charId = document.getElementById('pp-char-id')?.value || '';
  const characters = window.__playerPresentCharacters || [];
  const char = characters.find(entry => entry.id === charId);
  if (!char) return;

  const setIfNeeded = (id, value) => {
    const field = document.getElementById(id);
    if (!field) return;
    if (!force && String(field.value || '').trim()) return;
    field.value = value;
  };

  setIfNeeded('pp-nom', char.nom || '');
  setIfNeeded('pp-niveau', char.niveau || 1);
  setIfNeeded('pp-joueur', char.ownerPseudo || '');
  setIfNeeded('pp-img', char.photo || '');
}

async function savePlayerPresent(id = '') {
  const data = {
    charId: document.getElementById('pp-char-id')?.value || '',
    nom: document.getElementById('pp-nom')?.value?.trim() || 'Personnage',
    classe: document.getElementById('pp-classe')?.value?.trim() || '',
    race: document.getElementById('pp-race')?.value?.trim() || '',
    niveau: parseInt(document.getElementById('pp-niveau')?.value, 10) || 1,
    emoji: document.getElementById('pp-emoji')?.value?.trim() || '⚔️',
    joueur: document.getElementById('pp-joueur')?.value?.trim() || '',
    bio: document.getElementById('pp-bio')?.value || '',
    imageUrl: document.getElementById('pp-img')?.value?.trim() || '',
  };

  if (id) await updateInCol('players', id, data);
  else await addToCol('players', data);

  closeModal();
  showNotif('Présentation enregistrée.', 'success');
  await PAGES.players();
}

async function ensurePlayerDataset() {
  if (!PLAYER_STAGE_STORE.items.length) await loadPlayerShowcaseItems();
}

async function viewPlayerDetail(id) {
  await ensurePlayerDataset();
  const item = PLAYER_STAGE_STORE.items.find(entry => entry.id === id || entry.presentationId === id || entry.charId === id);
  if (!item) return;

  openModal(`⚔️ ${item.nom}`, `
    <div class="players-showcase-modal">
      ${renderStage(item)}
    </div>
  `);
}

async function editPlayerPresent(id) {
  const items = await loadCollection('players');
  const player = items.find(entry => entry.id === id);
  if (player) openPlayerPresentModal(player);
}

function openLinkedPlayerPresent(charId = '', presentationId = '') {
  if (presentationId) {
    editPlayerPresent(presentationId);
    return;
  }
  const item = PLAYER_STAGE_STORE.items.find(entry => entry.charId === charId);
  if (item) {
    openPlayerPresentModal({
      charId: item.charId,
      nom: item.nom,
      classe: item.classe,
      race: item.race,
      niveau: item.niveau,
      joueur: item.joueur,
      bio: item.hasPresentation ? item.bio : '',
      imageUrl: item.imageUrl,
      emoji: item.emoji || '⚔️',
    });
    return;
  }
  openPlayerPresentModal({ charId });
}

async function deletePlayerPresent(id) {
  if (!confirm('Supprimer cette présentation ?')) return;
  await deleteFromCol('players', id);
  showNotif('Présentation supprimée.', 'success');
  await PAGES.players();
}

async function openCharacterSheetFromShowcase(charId) {
  if (!charId) return;
  await window.navigate?.('characters');
  setTimeout(() => {
    const pill = Array.from(document.querySelectorAll('#char-pills .char-pill'))
      .find(entry => entry.getAttribute('onclick')?.includes(`'${charId}'`));
    if (pill) {
      pill.click();
      return;
    }
    const character = window.STATE?.characters?.find(entry => entry.id === charId);
    if (character && window.renderCharSheet) {
      window.STATE.activeChar = character;
      window.renderCharSheet(character);
    }
  }, 50);
}

Object.assign(window, {
  renderPlayersPage,
  selectPlayerShowcase,
  openPlayerPresentModal,
  prefillPlayerPresentFromLinkedChar,
  savePlayerPresent,
  viewPlayerDetail,
  editPlayerPresent,
  openLinkedPlayerPresent,
  deletePlayerPresent,
  openCharacterSheetFromShowcase,
});
