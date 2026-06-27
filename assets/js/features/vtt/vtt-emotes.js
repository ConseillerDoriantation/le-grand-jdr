// ==============================================================================
// VTT — Émotes (picker, favoris, gestion) + dés libres (mode de jet, compétences)
// ------------------------------------------------------------------------------
// Sous-système extrait de vtt.js (cf. docs/vtt-decomposition.md). État local au
// module ; vtt.js importe les handlers (data-vtt-fn) et les loaders (montage).
// Imports circulaires ciblés vers vtt.js : _renderInspector (re-render après
// changement de mode de jet) et _showEmoteBubble (bulle canvas) — runtime → sûr.
// ==============================================================================
import { VS } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { _esc, _norm, _searchIncludes } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { showNotif } from '../../shared/notifications.js';
import { getDocData, saveDoc } from '../../data/firestore.js';
import { db, doc, getDoc, addDoc, setDoc, serverTimestamp } from '../../config/firebase.js';
import { computeEquipSkillBonus } from '../../shared/char-stats.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal, CLOUDINARY_ENABLED } from '../../shared/upload-cloudinary.js';
import { uploadPng } from '../../shared/image-upload.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../../shared/dice-skills.js';
import { bumpSkill, bumpEmote } from '../../shared/stats.js';
import { _logCol, _logGmCol, _reactionRef } from './vtt-refs.js';
import { _STAT_KEY } from './vtt-constants.js';
import { openModal, closeModalDirect, confirmModal } from '../../shared/modal.js';
import { VTT_ACTIONS, _showEmoteBubble, _canControlToken, _tokenStatMod } from './vtt.js'; // circ. (runtime)
import { _renderInspector } from './vtt-inspector.js'; // re-render après changement de mode de jet

// État émotes (déplacé de vtt.js). _emotes exporté : préchargé au montage côté vtt.js.
export let _emotes = [];        // [{id, name, url}] chargées depuis world/vtt_emotes
let _emoteCloseOutside = null;  // listener mousedown fermeture picker émotes

export async function _loadEmotes() {
  // 1. Tenter le path scopé à l'aventure (path normal)
  try {
    const data = await getDocData('world', 'vtt_emotes');
    if (Array.isArray(data?.emotes)) { _emotes = data.emotes; return; }
  } catch(e) { console.warn('[vtt] emotes (adventure path) :', e.message); }

  // 2. Fallback : path global world/vtt_emotes (migration ancien stockage)
  try {
    const snap = await getDoc(doc(db, 'world', 'vtt_emotes'));
    _emotes = snap.data()?.emotes || [];
    if (_emotes.length) console.info('[vtt] emotes chargées depuis le path global (migration)');
  } catch(e) {
    console.warn('[vtt] emotes (global path) :', e.message);
    _emotes = [];
  }
}

// Initialiser immédiatement : localStorage (ordre perso) > défauts
VS.diceSkills = lsJson.get(DICE_SKILLS_STORAGE_KEY, [...DICE_SKILLS_DEFAULT]);

export async function _loadDiceSkills() {
  try {
    const data = await getDocData('world', 'dice_skills');
    if (data?.skills?.length) VS.diceSkills = data.skills;
  } catch { /* garde le cache local */ }
  // Re-render l'inspector si un token est déjà sélectionné
  if (VS.selected) _renderInspector(VS.tokens[VS.selected]?.data ?? null);
}

export function _vttSetRollMode(mode) {
  VS.rollMode = mode;
  // Mettre à jour les boutons visuellement sans re-render complet
  document.querySelectorAll('.vtt-roll-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

export function _vttAdjBonus(delta, reset = false) {
  VS.rollBonus = reset ? 0 : Math.max(-20, Math.min(20, VS.rollBonus + delta));
  const el = document.getElementById('vtt-bonus-val');
  if (el) {
    el.textContent = VS.rollBonus > 0 ? `+${VS.rollBonus}` : `${VS.rollBonus}`;
    el.classList.toggle('nonzero', VS.rollBonus !== 0);
  }
}

export function _vttToggleRollHidden() {
  if (!STATE.isAdmin) return;
  VS.rollHidden = !VS.rollHidden;
  lsJson.set('vtt-roll-hidden', VS.rollHidden);
  const btn = document.getElementById('vtt-roll-hide-btn');
  if (btn) {
    btn.classList.toggle('active', VS.rollHidden);
    btn.textContent = VS.rollHidden ? '🕶 Jet caché MJ' : '👁 Visible joueurs';
  }
}

export async function _vttRollSkill(skillName, stat) {
  const t = VS.tokens[VS.selected]?.data;
  if (!t) return;
  if (!_canControlToken(t)) return; // joueur ne peut lancer que son propre token (ou ceux délégués)
  const c = t?.characterId ? VS.characters[t.characterId] : null;
  const n = t?.npcId ? VS.npcs[t.npcId] : null;
  const statKey = _STAT_KEY[stat] || '';
  const mod = _tokenStatMod(t, statKey);
  // Bonus de compétence depuis les items équipés (pour les PJ)
  const equipSkillBonus = c ? computeEquipSkillBonus(c.equipement || {}, skillName) : 0;
  const d20 = () => Math.floor(Math.random() * 20) + 1;

  let d1 = d20(), d2, roll;
  if (VS.rollMode === 'advantage')    { d2 = d20(); roll = Math.max(d1, d2); }
  else if (VS.rollMode === 'disadvantage') { d2 = d20(); roll = Math.min(d1, d2); }
  else                              { roll = d1; }

  const total   = roll + mod + VS.rollBonus + equipSkillBonus;
  const isCrit  = roll === 20, isFumble = roll === 1;
  const authorName    = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const characterName = c?.nom || n?.nom || t?.name || null;
  const characterImage = c?.photoURL || c?.photo || c?.avatar || n?.photoURL || n?.photo || n?.avatar || n?.imageUrl || null;
  const gmOnly = STATE.isAdmin && VS.rollHidden;
  try {
    // Jet caché → sous-collection MJ (secret serveur) ; sinon log public.
    await addDoc(gmOnly ? _logGmCol() : _logCol(), {
      type: 'roll',
      authorId: STATE.user?.uid || null,
      authorName, characterName, characterImage,
      rollMode: VS.rollMode,
      rollDice: d2 !== undefined ? [d1, d2] : [d1],
      rollRaw: roll, rollMod: mod, rollBonus: VS.rollBonus || 0,
      rollResult: total,
      rollSkill: skillName, rollStat: stat,
      rollEquipBonus: equipSkillBonus || 0,
      isCrit, isFumble,
      gmOnly,
      createdAt: serverTimestamp(),
    });
    if (gmOnly) showNotif('Jet caché — visible uniquement par le MJ', 'success');
  } catch(e) { showNotif('Erreur jet : ' + e.message, 'error'); }
  // Statistiques : compte le jet de compétence (PJ uniquement) + crit/échec.
  // t.characterId = id fiable (VS.characters[...] ne porte pas forcément .id).
  if (c && t.characterId) bumpSkill(t.characterId, characterName, skillName, { crit: isCrit, fumble: isFumble });
}

export async function _saveEmotes(list) {
  _emotes = list;
  try { await saveDoc('world', 'vtt_emotes', { emotes: list }); }
  catch(e) { showNotif('Erreur sauvegarde émotes : ' + e.message, 'error'); }
}

// Convertit les balises :nom: en <img> dans un texte déjà échappé
export function _applyEmotes(escaped) {
  for (const em of _emotes) {
    const key = `:${_esc(em.name)}:`;
    const img = `<img class="vtt-emote-inline" src="${em.url}" alt="${key}" title="${key}">`;
    escaped = escaped.split(key).join(img);
  }
  return escaped;
}

// Favoris émotes — stockés en localStorage
export const _getFavs = () => lsJson.get('vtt-emote-favs', []);
export const _setFavs = v => lsJson.set('vtt-emote-favs', v);
export const _getRecents = () => lsJson.get('vtt-emote-recents', []);
export function _pushRecent(name) {
  const r = _getRecents().filter(n => n !== name);
  r.unshift(name);
  lsJson.set('vtt-emote-recents', r.slice(0, 8));
}

export function _emoteGridHtml(list, favSet=new Set()) {
  if (!list.length) return '<div class="vtt-emote-empty-grid">Aucune émote trouvée</div>';
  return list.map(em => {
    const safe = em.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const isFav = favSet.has(em.name);
    return `<div class="vtt-emote-item-wrap">
      <button class="vtt-emote-item" data-vtt-fn="_vttPickEmote" data-vtt-args="${safe}" title=":${_esc(em.name)}:">
        <img src="${em.url}" alt="${_esc(em.name)}" loading="lazy">
        <span>${_esc(em.name)}</span>
      </button>
      <button class="vtt-emote-fav-btn${isFav?' active':''}" data-vtt-fn="_vttToggleFav" data-vtt-args="${safe}" title="${isFav?'Retirer des favoris':'Ajouter aux favoris'}">${isFav?'★':'☆'}</button>
    </div>`;
  }).join('');
}

export function _renderEmotePicker() {
  const el = document.getElementById('vtt-emote-picker');
  if (!el) return;
  if (!_emotes.length) {
    el.innerHTML = '<div class="vtt-emote-picker-search"><span style="padding:.5rem;display:block;font-size:.75rem;color:var(--text-muted)">Aucune émote — à configurer dans la Console MJ</span></div>';
    return;
  }
  const favSet = new Set(_getFavs());
  const byName = new Map(_emotes.map(e => [e.name, e]));
  const recentEmotes = _getRecents().map(n => byName.get(n)).filter(Boolean);
  const favEmotes = _emotes.filter(e => favSet.has(e.name));

  const recentBlock = recentEmotes.length
    ? `<div id="vtt-emote-recent-section">
        <div class="vtt-emote-section-lbl">🕘 Récents</div>
        <div class="vtt-emote-grid">${_emoteGridHtml(recentEmotes, favSet)}</div>
      </div>`
    : `<div id="vtt-emote-recent-section" data-empty="1" style="display:none"></div>`;
  const favBlock = favEmotes.length
    ? `<div id="vtt-emote-fav-section">
        <div class="vtt-emote-section-lbl gold">⭐ Favoris</div>
        <div class="vtt-emote-grid" id="vtt-emote-fav-grid">${_emoteGridHtml(favEmotes, favSet)}</div>
      </div>`
    : `<div id="vtt-emote-fav-section" data-empty="1" style="display:none"></div>`;
  const allLbl = (recentEmotes.length || favEmotes.length)
    ? `<div class="vtt-emote-section-lbl" id="vtt-emote-all-lbl">Toutes</div>` : '';
  el.innerHTML = `
    <div class="vtt-emote-picker-search">
      <input type="text" id="vtt-emote-search" placeholder="🔍 Rechercher…" autocomplete="off"
        data-vtt-fn="_vttFilterEmotes" data-vtt-on="input" data-vtt-args="$value">
    </div>
    <div class="vtt-emote-picker-body">
      ${recentBlock}
      ${favBlock}
      ${allLbl}
      <div class="vtt-emote-grid" id="vtt-emote-grid">${_emoteGridHtml(_emotes, favSet)}</div>
    </div>`;
  setTimeout(() => document.getElementById('vtt-emote-search')?.focus(), 40);
}

export function _vttFilterEmotes(q) {
  const favSet = new Set(_getFavs());
  const grid = document.getElementById('vtt-emote-grid'); if (!grid) return;
  const filtered = q.trim() ? _emotes.filter(e => _searchIncludes(e.name, q)) : _emotes;
  grid.innerHTML = _emoteGridHtml(filtered, favSet);
  const hide = !!q.trim();
  const recentSection = document.getElementById('vtt-emote-recent-section');
  const favSection = document.getElementById('vtt-emote-fav-section');
  const allLbl = document.getElementById('vtt-emote-all-lbl');
  if (recentSection && recentSection.dataset.empty !== '1') recentSection.style.display = hide ? 'none' : '';
  if (favSection && favSection.dataset.empty !== '1') favSection.style.display = hide ? 'none' : '';
  if (allLbl) allLbl.style.display = hide ? 'none' : '';
}

export function _vttToggleFav(name) {
  const favs = _getFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(name);
  _setFavs(favs);
  // Re-render en préservant la query de recherche
  const q = document.getElementById('vtt-emote-search')?.value || '';
  _renderEmotePicker();
  if (q) {
    const input = document.getElementById('vtt-emote-search');
    if (input) { input.value = q; _vttFilterEmotes(q); }
  }
}

export function _closeEmotePicker() {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  el?.classList.remove('open');
  btn?.classList.remove('open');
  if (_emoteCloseOutside) {
    document.removeEventListener('mousedown', _emoteCloseOutside, true);
    _emoteCloseOutside = null;
  }
}

export function _vttToggleEmotePicker() {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  if (!el) return;
  const open = el.classList.toggle('open');
  btn?.classList.toggle('open', open);
  if (open) {
    _renderEmotePicker();
    _emoteCloseOutside = (e) => {
      const float = document.querySelector('.vtt-emote-float');
      if (float && !float.contains(e.target)) _closeEmotePicker();
    };
    document.addEventListener('mousedown', _emoteCloseOutside, true);
  } else {
    _closeEmotePicker();
  }
}

export async function _vttPickEmote(name) {
  const uid = STATE.user?.uid; if (!uid) return;
  const em = _emotes.find(e => e.name === name); if (!em) return;
  // Le picker reste ouvert — l'utilisateur ferme manuellement

  _pushRecent(name);

  // Token émetteur : sélection courante, sinon le token possédé par le joueur
  let tokenId = VS.selected;
  if (!tokenId) {
    const own = Object.values(VS.tokens).find(e => e.data.ownerId === uid);
    tokenId = own?.data?.id ?? null;
  }

  // Clé partagée locale + Firestore : même timestamp → _renderedReactions évite le double affichage
  const ts = Date.now();
  const key = `${uid}_${ts}`;

  // Affichage local immédiat (ancré au token émetteur si présent)
  _showEmoteBubble(tokenId, em.url, name, key);

  // Propagation aux autres joueurs via Firestore
  setDoc(_reactionRef(uid), {
    tokenId, emoteName: name, emoteUrl: em.url,
    pageId: VS.activePage?.id ?? null,
    createdAt: ts,           // nombre (ms) — même valeur que la clé locale
  }).catch(err => {
    console.error('[vtt] émote temps réel — écriture refusée. Vérifier vttEmoteReactions dans Firestore.', err);
  });

  // Statistiques : compte l'émote (attribuée au personnage du token émetteur).
  const _et = tokenId ? VS.tokens[tokenId]?.data : null;
  if (_et?.characterId) bumpEmote(_et.characterId, VS.characters[_et.characterId]?.nom || _et.name, name);
}

export async function _ouvrirGestionEmotes() {
  await _loadEmotes();
  const { default: Sortable } = await import('../../vendor/sortable.esm.js');

  // ── Helper upload Cloudinary (avec sous-dossier optionnel pour grouper) ──
  const _getEmoteAlbum = () => localStorage.getItem('vtt-emote-folder') || localStorage.getItem('vtt-imgbb-emote-album') || '';
  const _setEmoteAlbum = v => v ? localStorage.setItem('vtt-emote-folder', v) : localStorage.removeItem('vtt-emote-folder');

  const _uploadEmote = async (file) => {
    if (CLOUDINARY_ENABLED) {
      if (!hasCloudinaryConfig()) {
        openCloudinaryConfigModal();
        if (!hasCloudinaryConfig()) throw new Error('Configuration Cloudinary requise (bouton 🔑)');
      }
      const sub = _getEmoteAlbum().trim();
      const folder = sub ? `emotes/${sub}` : 'emotes';
      const up = await uploadCloudinary(file, { folder, tags: ['emote'] });
      return up.url;
    }
    // Mode gratuit : émote = petite image → base64 PNG (transparence conservée),
    // stockée directement dans le doc des émotes (pas d'hébergeur externe).
    return await uploadPng(file, { max: 200 });
  };

  // ── Rendu de la grille de cartes ─────────────────────────────────
  const _cardsHtml = (list) => list.length
    ? `<div id="emote-cards-grid" class="vtt-emote-cards">${
        list.map((em, i) => `
          <div class="vtt-emote-card" data-i="${i}">
            <span class="vtt-emote-card-drag" title="Déplacer">⠿</span>
            <img src="${em.url}" alt="${_esc(em.name)}">
            <span class="vtt-emote-card-name" title=":${_esc(em.name)}:">:${_esc(em.name)}:</span>
            <div class="vtt-emote-card-actions">
              <button class="vtt-ec-btn vtt-ec-edit" data-vtt-fn="_vttEditEmote" data-vtt-args="${i}" title="Modifier">✏</button>
              <button class="vtt-ec-btn vtt-ec-del"  data-vtt-fn="_vttDeleteEmote" data-vtt-args="${i}" title="Supprimer">✕</button>
            </div>
          </div>`).join('')
      }</div>`
    : '<div style="color:var(--text-dim);font-size:.8rem;padding:.5rem 0">Aucune émote pour l\'instant.</div>';

  const _inpStyle = 'width:100%;box-sizing:border-box;background:var(--bg-elevated);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:.8rem;padding:.3rem .5rem';

  openModal('😄 Gestion des Émotes', `
    <div style="display:flex;flex-direction:column;gap:.85rem;padding:.3rem 0">
      <div style="font-size:.72rem;color:var(--text-muted)">Maintenez ⠿ pour réordonner par glisser-déposer. Cliquez ✏ pour modifier.</div>
      <div id="emote-manage-list">${_cardsHtml(_emotes)}</div>
      <div id="emote-edit-zone"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div style="display:flex;align-items:center;gap:.6rem">
        <label style="font-size:.75rem;color:var(--text-muted);white-space:nowrap">📁 Dossier</label>
        <input type="text" id="emote-album-id" placeholder="nom du sous-dossier Cloudinary (optionnel)" value="${_getEmoteAlbum()}" style="${_inpStyle};flex:1"
          data-vtt-fn="_vttSetEmoteAlbum" data-vtt-on="input" data-vtt-args="$value">
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div style="font-weight:600;font-size:.85rem">➕ Ajouter une émote</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Nom (ex: <code>rire</code>)</label>
          <input type="text" id="emote-add-name" placeholder="nomemote" style="${_inpStyle}">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Fichier <span style="opacity:.6">(ou URL ci-dessous)</span></label>
          <input type="file" id="emote-add-file" accept="image/*" style="font-size:.78rem;margin-top:.25rem">
        </div>
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.75rem;color:var(--text-muted)">URL directe <span style="opacity:.6">(si déjà hébergée ailleurs)</span></label>
        <input type="text" id="emote-add-url" placeholder="https://…" style="${_inpStyle}">
      </div>
      <div style="display:flex;align-items:center;gap:.7rem">
        <button class="btn btn-primary" style="flex:1" data-vtt-fn="_vttAddEmote">➕ Ajouter l'émote</button>
        <span id="emote-add-status" style="font-size:.78rem;color:var(--text-dim);flex:1;min-height:1rem"></span>
      </div>
    </div>`);

  // ── SortableJS ───────────────────────────────────────────────────
  const _initSort = () => {
    const grid = document.getElementById('emote-cards-grid'); if (!grid) return;
    new Sortable(grid, {
      animation: 180, handle: '.vtt-emote-card-drag',
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const list = [..._emotes];
        const [moved] = list.splice(evt.oldIndex, 1);
        list.splice(evt.newIndex, 0, moved);
        await _saveEmotes(list);
        showNotif('Ordre sauvegardé', 'success');
      },
    });
  };
  _initSort();

  // ── Rafraîchit la grille ─────────────────────────────────────────
  const _refresh = (clearEdit = true) => {
    const el = document.getElementById('emote-manage-list'); if (!el) return;
    el.innerHTML = _cardsHtml(_emotes); _initSort();
    if (clearEdit) { const ez = document.getElementById('emote-edit-zone'); if (ez) ez.innerHTML = ''; }
  };

  // ── Supprimer ────────────────────────────────────────────────────
  VTT_ACTIONS._vttDeleteEmote = async (i) => {
    if (!await confirmModal(`Supprimer :${_emotes[i]?.name}: ?`)) return;
    const list = [..._emotes]; list.splice(i, 1);
    await _saveEmotes(list); _refresh();
    showNotif('Émote supprimée', 'success');
  };

  // ── Ouvrir le panneau d'édition (horizontal, sous la grille) ─────
  VTT_ACTIONS._vttEditEmote = (i) => {
    const em = _emotes[i]; if (!em) return;
    // Mettre en évidence la carte sélectionnée
    document.querySelectorAll('.vtt-emote-card').forEach(c => c.classList.remove('is-editing'));
    document.querySelector(`.vtt-emote-card[data-i="${i}"]`)?.classList.add('is-editing');
    // Remplir la zone d'édition
    const ez = document.getElementById('emote-edit-zone'); if (!ez) return;
    ez.innerHTML = `
      <div class="vtt-ec-panel">
        <img class="vtt-ec-panel-preview" id="ec-preview-${i}" src="${em.url}" alt="${_esc(em.name)}">
        <div class="vtt-ec-panel-fields">
          <div class="vtt-ec-panel-title">✏ Modifier <span style="font-family:monospace">:${_esc(em.name)}:</span></div>
          <div class="vtt-ec-panel-row">
            <label>Nouveau nom</label>
            <input type="text" id="ec-name-${i}" value="${_esc(em.name)}" autocomplete="off"
              data-vtt-fn="_vttSaveEmote" data-vtt-on="keydown-enter" data-vtt-args="${i}">
          </div>
          <div class="vtt-ec-panel-row">
            <label>Nouvelle image <span style="opacity:.6">(optionnel)</span></label>
            <input type="file" id="ec-file-${i}" accept="image/*"
              data-vtt-fn="_vttPreviewEmoteFile" data-vtt-on="change" data-vtt-args="$this|ec-preview-${i}">
          </div>
          <div class="vtt-ec-panel-btns">
            <button class="vtt-ec-save"   data-vtt-fn="_vttSaveEmote" data-vtt-args="${i}">✓ Enregistrer</button>
            <button class="vtt-ec-cancel" data-vtt-fn="_vttCancelEmoteEdit">✕ Annuler</button>
          </div>
        </div>
      </div>`;
    document.getElementById(`ec-name-${i}`)?.focus();
  };

  // ── Sauvegarder l'édition ────────────────────────────────────────
  VTT_ACTIONS._vttSaveEmote = window._vttSaveEmote = async (i) => {
    const nameEl = document.getElementById(`ec-name-${i}`);
    const fileEl = document.getElementById(`ec-file-${i}`);
    const newName = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    if (!newName) { showNotif('Nom requis', 'error'); return; }
    const list = [..._emotes];
    const em = { ...list[i], name: newName };
    if (fileEl?.files?.[0]) {
      showNotif('Upload en cours…', 'info');
      try { em.url = await _uploadEmote(fileEl.files[0]); }
      catch(e) { showNotif('⚠ ' + e.message, 'error'); return; }
    }
    list[i] = em;
    await _saveEmotes(list); _refresh();
    showNotif(`✓ :${newName}: mis à jour`, 'success');
  };

  // ── Ajouter ──────────────────────────────────────────────────────
  VTT_ACTIONS._vttAddEmote = async () => {
    const nameEl   = document.getElementById('emote-add-name');
    const fileEl   = document.getElementById('emote-add-file');
    const urlEl    = document.getElementById('emote-add-url');
    const statusEl = document.getElementById('emote-add-status');
    const name = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    const file = fileEl?.files?.[0];
    const directUrl = urlEl?.value.trim();
    if (!name) { if (statusEl) statusEl.textContent = '⚠ Nom requis'; return; }
    if (!file && !directUrl) { if (statusEl) statusEl.textContent = '⚠ Fichier ou URL requis'; return; }
    let url;
    if (file) {
      if (statusEl) statusEl.textContent = '⏳ Upload…';
      try { url = await _uploadEmote(file); }
      catch(e) { if (statusEl) statusEl.textContent = '⚠ ' + e.message; return; }
    } else {
      url = directUrl;
    }
    await _saveEmotes([..._emotes, { id: Date.now().toString(), name, url }]);
    if (statusEl) statusEl.textContent = `✓ :${name}: ajoutée !`;
    if (nameEl) nameEl.value = '';
    if (fileEl) fileEl.value = '';
    if (urlEl)  urlEl.value  = '';
    _refresh();
  };
}
