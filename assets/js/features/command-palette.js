// ══════════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE — recherche globale Ctrl+K / Cmd+K
// PNJ, fiches PJ, quêtes, boutique, bestiaire, hauts-faits, collection, trame,
// recettes, pages app. Ouvre la fiche cible quand un détail est disponible.
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { loadCollection, loadChars } from '../data/firestore.js';
import { _esc, _norm, _searchIncludes, _trunc, loadingHtml } from '../shared/html.js';
import { charSession } from '../shared/char-session.js';
import { navigate } from '../core/navigation.js';
import { isFeatureEnabled } from '../shared/features.js';
import { getRecentNavigation, recordRecentNavigation } from '../shared/recent-navigation.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import { showNotif } from '../shared/notifications.js';

const MAX_RESULTS = 30;

// Pas de cache local : les 8 collections principales sont session-live
// (cf. firestore.js), donc loadCollection retourne instantanément du cache
// mémoire. Reconstruire l'index à chaque ouverture est suffisamment rapide
// (~5-10 ms pour ~500 entrées) et garantit des résultats toujours frais.
let _open        = false;
let _activeIndex = 0;
let _entries     = [];
let _results     = [];
let _query       = '';
let _initialized = false;
let _bestiaryEntries = null;
let _bestiaryEntriesPromise = null;
let _previousFocus = null;

// ── PAGES (raccourcis directs) ────────────────────────────────────────────────
const PAGE_SHORTCUTS = [
  { id: 'dashboard',    label: 'Tableau de bord', icon: '🏠', aliases: 'accueil home dashboard résumé resume campagne' },
  { id: 'vtt',          label: 'Jouer',           icon: '🎲', subtitle: 'Table virtuelle', aliases: 'table virtuelle vtt combat partie plateau direct session jouer maintenant' },
  { id: 'characters',   label: 'Personnage',      icon: '⚔️', aliases: 'perso fiche stats inventaire sorts équipement equipement' },
  { id: 'map',          label: 'Carte',           icon: '🗺️', aliases: 'lieux exploration map voyager voyage' },
  { id: 'shop',         label: 'Boutique',        icon: '🛒', aliases: 'acheter objets équipement equipement magasin commerce or' },
  { id: 'story',        label: 'Trame',           icon: '📖', aliases: 'histoire scénario scenario récit recit campagne intrigue' },
  { id: 'agenda',       label: 'Agenda',          icon: '🗓️', aliases: 'dispo disponibilités disponibilites calendrier date session' },
  { id: 'achievements', label: 'Hauts-Faits',     icon: '🏆', aliases: 'succès succes achievements trophées trophees accomplissements' },
  { id: 'world',        label: 'Guide',           icon: '🌍', aliases: 'guide règles regles infos lore univers encyclopédie encyclopedie histoire monde' },
  { id: 'npcs',         label: 'PNJ',             icon: '👥', aliases: 'personnages non joueurs contacts factions npc' },
  { id: 'bestiaire',    label: 'Bestiaire',       icon: '🐉', aliases: 'monstres créatures creatures ennemis bêtes betes' },
  { id: 'recettes',     label: 'Recettes',        icon: '🧪', aliases: 'craft artisanat cuisine alchimie fabriquer' },
  { id: 'collection',   label: 'Collection',      icon: '🃏', aliases: 'cartes objets collectionner' },
  { id: 'players',      label: 'Joueurs',         icon: '🎭', aliases: 'groupe membres personnages joueurs pj' },
  { id: 'bastion',      label: 'Bastion',         icon: '🏰', aliases: 'base château chateau forteresse salles' },
  { id: 'aventures',    label: 'Aventures',       icon: '🗡️', aliases: 'campagne changer aventure switch sélectionner selectionner' },
  { id: 'account',      label: 'Mon compte',      icon: '👤', aliases: 'compte profil utilisateur préférences preferences' },
  { id: 'admin',        label: 'Console MJ',      icon: '⚙️', adminOnly: true, aliases: 'mj console gestion admin configuration' },
];

const QUICK_COMMANDS = [
  {
    id: 'keyboard-help', label: 'Afficher les raccourcis clavier', icon: '⌨️', page: '',
    aliases: 'aide clavier commandes raccourcis touches', directAction: 'keyboard-help',
  },
  {
    id: 'copy-view-link', label: 'Copier le lien de cette vue', icon: '🔗', page: '',
    aliases: 'partager url adresse lien page onglet', directAction: 'copy-view-link',
  },
  {
    id: 'new-character', label: 'Créer un personnage', icon: '➕', page: 'characters',
    selector: '[data-action="createNewChar"]', aliases: 'nouveau personnage fiche perso pj',
  },
  {
    id: 'new-npc', label: 'Créer un PNJ', icon: '👤', page: 'npcs', adminOnly: true,
    selector: '[data-action="npcCreate"]', aliases: 'nouveau pnj npc personnage non joueur',
  },
  {
    id: 'new-mission', label: 'Créer une mission', icon: '📖', page: 'story', adminOnly: true,
    selector: '[data-action="openStoryModal"]', aliases: 'nouvelle mission trame histoire scénario',
  },
  {
    id: 'new-achievement', label: 'Créer un haut-fait', icon: '🏆', page: 'achievements', adminOnly: true,
    selector: '[data-action="openAchievementModal"]', aliases: 'nouveau haut fait souvenir trophée',
  },
  {
    id: 'new-beast', label: 'Créer une créature', icon: '🐉', page: 'bestiaire', adminOnly: true,
    selector: '[data-bst-action="createDraft"]', aliases: 'nouvelle créature monstre bestiaire',
  },
  {
    id: 'new-shop-item', label: 'Créer un article', icon: '🛒', page: 'shop', adminOnly: true,
    selector: '[data-sh-action="openItemModal"]', aliases: 'nouvel objet boutique équipement',
  },
  {
    id: 'new-adventure', label: 'Créer une aventure', icon: '🗡️', page: '',
    aliases: 'nouvelle aventure campagne', directAction: 'create-adventure',
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT + INDEXATION
// ══════════════════════════════════════════════════════════════════════════════
function _firstStr(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

async function _loadEntries() {
  const [npcs, chars, quests, shop, shopCats, achievements, collection, story, recipes] =
    await Promise.all([
      loadCollection('npcs').catch(() => []),
      loadChars(STATE.isAdmin ? null : STATE.user?.uid).catch(() => []),
      loadCollection('quests').catch(() => []),
      loadCollection('shop').catch(() => []),
      loadCollection('shopCategories').catch(() => []),
      loadCollection('achievements').catch(() => []),
      loadCollection('collection').catch(() => []),
      loadCollection('story').catch(() => []),
      loadCollection('recipes').catch(() => []),
    ]);

  // Cohérence avec le reste de l'app : on cache les hauts-faits secrets aux non-MJ.
  const achFiltered = STATE.isAdmin ? achievements : achievements.filter(a => !a.secret);

  // Cohérence avec la boutique : articles des catégories masquées cachés aux non-MJ.
  const hiddenCatIds = STATE.isAdmin
    ? new Set()
    : new Set(shopCats.filter(c => c.masquee).map(c => c.id));
  const shopFiltered = hiddenCatIds.size
    ? shop.filter(it => !hiddenCatIds.has(it.categorieId))
    : shop;

  const entries = [];

  // Already loaded during bootstrap: switching adventure adds no Firestore read.
  for (const adventure of STATE.adventures || []) {
    const title = _firstStr(adventure, ['nom', 'name']) || adventure.id;
    entries.push({
      type: 'adventure', typeLabel: 'Aventure', id: adventure.id, title,
      subtitle: adventure.id === STATE.adventure?.id ? 'Aventure active' : "Changer d'aventure",
      icon: adventure.emoji || '⚔️',
      search: _norm([title, adventure.id, 'aventure campagne changer switch'].filter(Boolean).join(' ')),
    });
  }

  for (const command of QUICK_COMMANDS) {
    if (command.adminOnly && !STATE.isAdmin) continue;
    if (command.page && !isFeatureEnabled(command.page)) continue;
    entries.push({
      type: 'command', typeLabel: 'Action', id: command.id,
      title: command.label, subtitle: 'Action rapide', icon: command.icon,
      search: _norm(`${command.label} ${command.aliases || ''}`),
      payload: command,
    });
  }

  // Pages
  for (const p of PAGE_SHORTCUTS) {
    if (p.adminOnly && !STATE.isAdmin) continue;
    if (!isFeatureEnabled(p.id)) continue; // feature désactivée pour cette aventure
    entries.push({
      type: 'page', typeLabel: 'Page', id: p.id,
      title: p.label, subtitle: p.subtitle || 'Aller à la page', icon: p.icon,
      search: _norm(`${p.label} ${p.id} ${p.aliases || ''}`),
    });
  }

  // PNJ
  for (const n of npcs) {
    const title = _firstStr(n, ['nom', 'name']);
    if (!title) continue;
    entries.push({
      type: 'npc', typeLabel: 'PNJ', id: n.id, title,
      subtitle: _firstStr(n, ['fonction', 'role', 'titre', 'description']),
      icon: '👤',
      avatarHtml: characterAvatarHtml(n, { size: 32, className: 'cmd-palette-avatar' }),
      search: _norm([title, n.fonction, n.role, n.description, n.notes].filter(Boolean).join(' ')),
    });
  }

  // Personnages
  for (const c of chars) {
    const title = _firstStr(c, ['nom']);
    if (!title) continue;
    entries.push({
      type: 'character', typeLabel: 'Personnage', id: c.id, title,
      subtitle: [c.classe, c.race, c.ownerPseudo].filter(Boolean).join(' · '),
      icon: '⚔️',
      avatarHtml: characterAvatarHtml(c, { size: 32, className: 'cmd-palette-avatar' }),
      search: _norm([title, c.classe, c.race, c.ownerPseudo].filter(Boolean).join(' ')),
      payload: c,
    });
  }

  // Groupes (quêtes liées à une mission de la Trame). Les anciennes quêtes
  // autonomes (sans missionId) ne sont plus indexées.
  for (const q of quests) {
    if (!q.missionId) continue;
    const title = _firstStr(q, ['titre', 'nom', 'name']);
    if (!title) continue;
    const mission = story.find(s => s.id === q.missionId);
    entries.push({
      type: 'group', typeLabel: 'Groupe', id: q.id, title,
      payload: { missionId: q.missionId },
      subtitle: [mission?.titre, q.statut].filter(Boolean).join(' · '),
      icon: '👥',
      search: _norm([title, mission?.titre, q.statut].filter(Boolean).join(' ')),
    });
  }

  // Boutique
  for (const it of shopFiltered) {
    const title = _firstStr(it, ['nom']);
    if (!title) continue;
    entries.push({
      type: 'shop', typeLabel: 'Article', id: it.id, title,
      subtitle: [it.sousType || it.type, it.rarete, it.prix ? `${it.prix} or` : ''].filter(Boolean).join(' · '),
      icon: '🛒',
      search: _norm([title, it.type, it.sousType, it.description, it.effet, it.format].filter(Boolean).join(' ')),
      payload: it,
    });
  }

  // Hauts-faits
  for (const a of achFiltered) {
    const title = _firstStr(a, ['titre', 'nom', 'name']);
    if (!title) continue;
    entries.push({
      type: 'achievement', typeLabel: 'Haut-fait', id: a.id, title,
      subtitle: _trunc(a.description || '', 80),
      icon: '🏆',
      search: _norm([title, a.description].filter(Boolean).join(' ')),
    });
  }

  // Collection
  for (const c of collection) {
    const title = _firstStr(c, ['nom', 'titre', 'name']);
    if (!title) continue;
    entries.push({
      type: 'collection', typeLabel: 'Collection', id: c.id, title,
      subtitle: _trunc(c.description || '', 80),
      icon: '🃏',
      search: _norm([title, c.description, c.type].filter(Boolean).join(' ')),
    });
  }

  // Trame / Histoire
  for (const s of story) {
    const title = _firstStr(s, ['titre', 'nom']);
    if (!title) continue;
    entries.push({
      type: 'story', typeLabel: 'Trame', id: s.id, title,
      subtitle: [s.type, s.statut, _trunc(s.description || '', 60)].filter(Boolean).join(' · '),
      icon: '📖',
      search: _norm([title, s.description, s.type, s.statut].filter(Boolean).join(' ')),
    });
  }

  // Recettes
  for (const r of recipes) {
    const title = _firstStr(r, ['nom', 'titre']);
    if (!title) continue;
    entries.push({
      type: 'recipe', typeLabel: 'Recette', id: r.id, title,
      subtitle: _trunc(r.description || '', 80),
      icon: '🧪',
      search: _norm([title, r.description].filter(Boolean).join(' ')),
    });
  }

  return entries;
}

function _buildBestiaryEntries(bestiary) {
  const entries = [];
  for (const b of bestiary || []) {
    const title = _firstStr(b, ['nom', 'name']);
    if (!title) continue;
    entries.push({
      type: 'beast', typeLabel: 'Bestiaire', id: b.id, title,
      subtitle: _firstStr(b, ['type', 'description', 'famille']),
      icon: '🐉',
      avatarHtml: characterAvatarHtml({
        ...b,
        photo: _firstStr(b, ['photo', 'portrait', 'image', 'illustration', 'imageUrl']),
      }, { size: 32, className: 'cmd-palette-avatar' }),
      search: _norm([title, b.type, b.famille, b.description].filter(Boolean).join(' ')),
    });
  }
  return entries;
}

async function _ensureBestiaryEntriesForQuery(query) {
  if (_norm(query).length < 2) return false;
  if (_entries.some(e => e.type === 'beast')) return false;

  if (!_bestiaryEntriesPromise) {
    _bestiaryEntriesPromise = loadCollection('bestiary')
      .catch(() => [])
      .then(all => {
        const visible = STATE.isAdmin ? all : all.filter(b => !b.hidden);
        _bestiaryEntries = _buildBestiaryEntries(visible);
        return _bestiaryEntries;
      });
  }

  const entries = await _bestiaryEntriesPromise;
  if (_entries.some(e => e.type === 'beast')) return false;
  _entries = [..._entries, ...entries];
  return entries.length > 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// RECHERCHE
// ══════════════════════════════════════════════════════════════════════════════
function _scoreEntry(entry, q) {
  if (!q) return 0;
  const title = _norm(entry.title);
  if (title.startsWith(q)) return 100;
  if (title.includes(q))   return 60;
  if (_searchIncludes(entry.search, q)) return 30;
  return 0;
}

function _filterAndSort(entries, query) {
  const q = _norm(query);
  if (!q) {
    // Vue par défaut : pages d'abord (raccourcis)
    const byKey = new Map(entries.map(entry => [`${entry.type}:${entry.id}`, entry]));
    const recent = getRecentNavigation()
      .map(item => byKey.get(`${item.type}:${item.id}`))
      .filter(Boolean)
      .map(entry => ({
        ...entry,
        groupKey: 'recent',
        groupLabel: 'Récemment ouverts',
      }));
    const recentKeys = new Set(recent.map(entry => `${entry.type}:${entry.id}`));
    const adventures = entries
      .filter(entry => entry.type === 'adventure' && !recentKeys.has(`adventure:${entry.id}`))
      .sort((a, b) => Number(b.id === STATE.adventure?.id) - Number(a.id === STATE.adventure?.id))
      .map(entry => ({ ...entry, groupKey: 'adventure', groupLabel: 'Aventures' }));
    const commands = entries
      .filter(entry => entry.type === 'command' && !recentKeys.has(`command:${entry.id}`))
      .map(entry => ({ ...entry, groupKey: 'command', groupLabel: 'Actions rapides' }));
    const pages = entries
      .filter(entry => entry.type === 'page' && !recentKeys.has(`page:${entry.id}`))
      .map(entry => ({ ...entry, groupKey: 'page', groupLabel: 'Pages' }));
    return [...recent, ...commands, ...adventures, ...pages].slice(0, MAX_RESULTS);
  }
  const scored = [];
  for (const e of entries) {
    const s = _scoreEntry(e, q);
    if (s > 0) scored.push({ e, s });
  }
  scored.sort((a, b) =>
    b.s - a.s ||
    a.e.title.localeCompare(b.e.title, 'fr', { sensitivity: 'base' })
  );
  return scored.slice(0, MAX_RESULTS).map(x => x.e);
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — ouverture du résultat sélectionné
// ══════════════════════════════════════════════════════════════════════════════
const _nextTick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function _highlight(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  el.classList.add('cmd-palette-flash');
  setTimeout(() => el.classList.remove('cmd-palette-flash'), 1800);
}

async function _executeEntry(entry) {
  closePalette();
  const go = (page) => navigate(page);
  recordRecentNavigation(entry);

  try {
    switch (entry.type) {
      case 'command': {
        const command = entry.payload;
        if (command?.directAction === 'keyboard-help') {
          document.dispatchEvent(new CustomEvent('app:open-keyboard-help'));
          return;
        }
        if (command?.directAction === 'copy-view-link') {
          await navigator.clipboard.writeText(location.href);
          showNotif('Lien de cette vue copié.', 'success');
          return;
        }
        if (command?.directAction === 'create-adventure') {
          const { openCreateAdventureModal } = await import('../core/init.js');
          await openCreateAdventureModal();
          return;
        }
        if (!command?.page || !command.selector) return;
        await go(command.page);
        await _nextTick();
        const trigger = document.querySelector(command.selector);
        if (!trigger) throw new Error(`Action rapide indisponible : ${command.id}`);
        trigger.click();
        return;
      }

      case 'adventure': {
        if (entry.id === STATE.adventure?.id) {
          await go('dashboard');
          return;
        }
        const { pickAdventure } = await import('../core/init.js');
        await pickAdventure(entry.id);
        return;
      }

      case 'page':
        await go(entry.id);
        return;

      case 'npc': {
        await go('npcs');
        await _nextTick();
        const { selectNpc } = await import('./npcs.js');
        selectNpc(entry.id);
        return;
      }

      case 'character': {
        await go('characters');
        await _nextTick();
        const c = (STATE.characters || []).find(x => x.id === entry.id) || entry.payload;
        if (c) charSession.renderSheet(c);
        return;
      }

      case 'beast': {
        await go('bestiaire');
        await _nextTick();
        const { openBestiaryEntry } = await import('./bestiary.js');
        openBestiaryEntry(entry.id);
        return;
      }

      case 'recipe':
        await go('recettes');
        await _nextTick();
        {
          const { openItemDetailModal } = await import("./recipes.js");
          openItemDetailModal(entry.id);
        }
        return;

      case 'shop': {
        await go('shop');
        await _nextTick();
        const it = entry.payload;
        const { shopGoCat, shopFilterSearch } = await import('./shop.js');
        if (it?.categorieId) shopGoCat(it.categorieId);
        await _nextTick();
        if (it?.nom) shopFilterSearch(it.nom);
        return;
      }

      case 'group': {
        await go('story');
        await _nextTick();
        const missionId = entry.payload?.missionId;
        if (missionId) {
          const { openStoryDetail } = await import('./story.js');
          openStoryDetail(missionId);
        }
        return;
      }

      case 'achievement':
        await go('achievements');
        await _nextTick();
        _highlight(`[data-ach-id="${entry.id}"]`);
        return;

      case 'collection':
        await go('collection');
        await _nextTick();
        _highlight(`[data-collection-id="${entry.id}"]`);
        return;

      case 'story':
        await go('story');
        await _nextTick();
        if (STATE.isAdmin) {
          const { editStory } = await import('./story.js');
          editStory(entry.id);
        } else {
          _highlight(`[data-story-id="${entry.id}"]`);
        }
        return;
    }
  } catch (e) {
    console.error('[cmd-palette] action failed:', e);
    showNotif("Impossible d'ouvrir ce résultat.", 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU
// ══════════════════════════════════════════════════════════════════════════════
function _renderList() {
  const list = document.getElementById('cmd-palette-list');
  if (!list) return;

  if (_results.length === 0) {
    const msg = _query.trim()
      ? `Aucun résultat pour « ${_esc(_query)} »`
      : 'Tapez pour rechercher (PNJ, perso, quête, article…)';
    list.innerHTML = `<div class="cmd-palette-empty">${msg}</div>`;
    document.getElementById('cmd-palette-input')?.removeAttribute('aria-activedescendant');
    const status = document.getElementById('cmd-palette-status');
    if (status) status.textContent = _query.trim() ? 'Aucun résultat' : '';
    return;
  }

  let html = '';
  let lastGroup = null;
  _results.forEach((e, i) => {
    const groupKey = e.groupKey || e.type;
    const groupLabel = e.groupLabel || e.typeLabel;
    if (groupKey !== lastGroup) {
      html += `<div class="cmd-palette-group">${_esc(groupLabel)}</div>`;
      lastGroup = groupKey;
    }
    const active = i === _activeIndex ? ' is-active' : '';
    html += `
      <div class="cmd-palette-row${active}" id="cmd-palette-option-${i}" data-cmd-idx="${i}" role="option" aria-selected="${i===_activeIndex}">
        ${e.avatarHtml || `<span class="cmd-palette-row-icon">${e.icon || '•'}</span>`}
        <div class="cmd-palette-row-text">
          <div class="cmd-palette-row-title">${_esc(e.title)}</div>
          ${e.subtitle ? `<div class="cmd-palette-row-sub">${_esc(e.subtitle)}</div>` : ''}
        </div>
        <span class="cmd-palette-row-tag">${_esc(e.typeLabel)}</span>
      </div>`;
  });
  list.innerHTML = html;

  const activeEl = list.querySelector('.cmd-palette-row.is-active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  const input = document.getElementById('cmd-palette-input');
  if (input && activeEl) input.setAttribute('aria-activedescendant', activeEl.id);
  const status = document.getElementById('cmd-palette-status');
  if (status) status.textContent = `${_results.length} résultat${_results.length > 1 ? 's' : ''}`;
}

function _move(delta) {
  if (!_results.length) return;
  _activeIndex = (_activeIndex + delta + _results.length) % _results.length;
  _renderList();
}

function _activate() {
  const entry = _results[_activeIndex];
  if (entry) _executeEntry(entry);
}

function _mountModal() {
  const existing = document.getElementById('cmd-palette');
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.id = 'cmd-palette';
  root.className = 'cmd-palette';
  root.innerHTML = `
    <div class="cmd-palette-backdrop" data-cmd-close></div>
    <div class="cmd-palette-box" role="dialog" aria-modal="true" aria-label="Recherche globale">
      <div class="cmd-palette-input-wrap">
        <span class="cmd-palette-icon">🔍</span>
        <input id="cmd-palette-input" class="cmd-palette-input" type="text"
          placeholder="Rechercher une page, un PNJ, une quête, un objet…"
          autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list"
          aria-controls="cmd-palette-list" aria-expanded="true">
        <kbd class="cmd-palette-kbd">Esc</kbd>
      </div>
      <div class="cmd-palette-list" id="cmd-palette-list" role="listbox"></div>
      <div class="cmd-palette-status" id="cmd-palette-status" role="status" aria-live="polite"></div>
      <div class="cmd-palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> Naviguer</span>
        <span><kbd>↵</kbd> Ouvrir</span>
        <span><kbd>Esc</kbd> Fermer</span>
      </div>
    </div>`;
  document.body.appendChild(root);

  const input = root.querySelector('#cmd-palette-input');

  input.addEventListener('input', () => {
    _query = input.value;
    _activeIndex = 0;
    _results = _filterAndSort(_entries, _query);
    _renderList();

    const requestedQuery = _query;
    _ensureBestiaryEntriesForQuery(requestedQuery).then(changed => {
      if (!_open || !changed) return;
      _results = _filterAndSort(_entries, _query);
      _renderList();
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown')    { e.preventDefault(); _move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _move(-1); }
    else if (e.key === 'Enter')   { e.preventDefault(); _activate(); }
    else if (e.key === 'Escape')  { e.preventDefault(); closePalette(); }
    else if (e.key === 'Tab')     { e.preventDefault(); input.focus(); }
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-cmd-close]')) { closePalette(); return; }
    const row = e.target.closest('[data-cmd-idx]');
    if (row) {
      _activeIndex = parseInt(row.dataset.cmdIdx, 10);
      _activate();
    }
  });

  root.addEventListener('mousemove', (e) => {
    const row = e.target.closest('[data-cmd-idx]');
    const index = Number(row?.dataset.cmdIdx);
    if (!row || !Number.isInteger(index) || index === _activeIndex) return;
    _activeIndex = index;
    root.querySelectorAll('.cmd-palette-row').forEach((item, i) => {
      const active = i === index;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    input.setAttribute('aria-activedescendant', row.id);
  });

  return input;
}

// ══════════════════════════════════════════════════════════════════════════════
// OPEN / CLOSE
// ══════════════════════════════════════════════════════════════════════════════
async function openPalette() {
  const app = document.getElementById('app');
  const appVisible = app && getComputedStyle(app).display !== 'none';
  if (_open || !appVisible || !STATE.user || !STATE.adventure?.id) return;
  _open = true;
  _query = '';
  _activeIndex = 0;
  _entries = [];
  _results = [];
  _bestiaryEntries = null;
  _bestiaryEntriesPromise = null;
  _previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const input = _mountModal();
  const list = document.getElementById('cmd-palette-list');
  if (list) list.innerHTML = loadingHtml('Chargement…', { compact: true });

  setTimeout(() => input?.focus(), 30);

  try {
    _entries = await _loadEntries();
    if (_bestiaryEntries && _norm(_query).length >= 2 && !_entries.some(e => e.type === 'beast')) {
      _entries = [..._entries, ..._bestiaryEntries];
    }
    if (!_open) return; // l'utilisateur a fermé entre-temps
    _results = _filterAndSort(_entries, _query);
    _renderList();
  } catch (e) {
    console.error('[cmd-palette] load failed:', e);
    if (list) list.innerHTML = `<div class="cmd-palette-empty">Erreur de chargement</div>`;
  }
}

function closePalette() {
  const root = document.getElementById('cmd-palette');
  if (root) root.remove();
  _open = false;
  if (_previousFocus?.isConnected) _previousFocus.focus({ preventScroll: true });
  _previousFocus = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// INIT — raccourci clavier global
// ══════════════════════════════════════════════════════════════════════════════
export function initCommandPalette() {
  if (_initialized) return;
  _initialized = true;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (_open) closePalette();
      else openPalette();
    }
  });

  // Déclencheur visible (boutons « Rechercher » de la nav desktop/mobile)
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-command-palette]')) {
      e.preventDefault();
      if (!_open) openPalette();
    }
  });
}

// Auto-init à l'import
initCommandPalette();
