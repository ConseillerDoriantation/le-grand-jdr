// ══════════════════════════════════════════════════════════════════════════════
// HISTOIRE.JS — Éditeur de mission intégré
// Éditeur rich-text contenteditable avec tags @mention colorés,
// marqueurs de scène, références de jet de dé, export handout joueur
// Admin uniquement — chaque mission a son histoire attachée
// ══════════════════════════════════════════════════════════════════════════════

import { getDocData, saveDoc, loadCollection, batchSaveInCol } from '../data/firestore.js';
import { openModal, closeModalDirect, setModalCloseGuard } from '../shared/modal.js';
import { STATE } from '../core/state.js';
import { _esc, _norm, loadingHtml } from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { showNotif } from '../shared/notifications.js';
import { copyText } from '../shared/clipboard.js';
import { lsJson } from '../shared/local-storage.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../shared/dice-skills.js';
import {
  DICE_SKILL_STATS,
  buildDiceSkillMigrations,
  characteristicForSkillName,
  diceSkillKey,
  migrateSkillBonusesInEquipment,
  migrateSkillBonusesInItem,
  migrateSkillBonusesInItems,
  migrateSkillMap,
  sortDiceSkills,
  suggestDiceSkillStat,
} from '../shared/dice-skills-admin.js';
import {
  bindRichTextEditorControls,
  countRichTextWords,
  execRichTextCommand,
  richTextEditableHtml,
  richTextInlineChipElement,
  richTextToolbarHtml,
  replaceRichTextRangeWithNode,
  selectRichTextNodeContents,
  sanitizeRichTextHtml,
} from '../shared/rich-text.js';
import PAGES from './pages.js';
import { getHistoireCtx, setHistoireCtx } from '../shared/histoire-ctx.js';
import { registerActions } from '../core/actions.js';

// ── Config des types de tags ──────────────────────────────────────────────────
const TAG_TYPES = {
  pnj:          { label: 'PNJ',          color: '#4f8cff', bg: 'rgba(79,140,255,.18)',  emoji: '👤', col: 'npcs'          },
  personnage:   { label: 'Personnage',   color: '#a855f7', bg: 'rgba(168,85,247,.18)', emoji: '📜', col: 'characters'    },
  lieu:         { label: 'Lieu',         color: '#22c38e', bg: 'rgba(34,195,142,.18)', emoji: '📍', col: 'places'        },
  objet:        { label: 'Objet',        color: '#f59e0b', bg: 'rgba(245,158,11,.18)', emoji: '⚔️', col: 'shop'          },
  organisation: { label: 'Organisation', color: '#ef4444', bg: 'rgba(239,68,68,.18)',  emoji: '🏛️', col: 'organizations' },
  joueur:       { label: 'Joueur',       color: '#ec4899', bg: 'rgba(236,72,153,.18)', emoji: '🎮', col: 'users'         },
};

const STAT_COLORS = {
  FOR: '#ef4444', DEX: '#22c38e', CON: '#f97316',
  INT: '#4f8cff', SAG: '#a78bfa', CHA: '#ec4899',
  '': 'var(--text-dim)',
};
let _diceSkillsCache = null;

function _getDiceSkills() {
  if (_diceSkillsCache) return _diceSkillsCache;
  return lsJson.get(DICE_SKILLS_STORAGE_KEY, DICE_SKILLS_DEFAULT);
}

async function _loadDiceSkills() {
  try {
    const doc = await getDocData('world', 'dice_skills');
    _diceSkillsCache = doc?.skills || null;
    if (!_diceSkillsCache) {
      // Pas encore en base : migrer depuis localStorage ou utiliser les défauts
      _diceSkillsCache = lsJson.get(DICE_SKILLS_STORAGE_KEY, DICE_SKILLS_DEFAULT);
    }
  } catch {
    _diceSkillsCache = _getDiceSkills();
  }
  return _diceSkillsCache;
}

// ── État du module ────────────────────────────────────────────────────────────
let _missionId    = null;
let _missionTitre = '';
let _missionActe  = '';
let _saveTimer    = null;
let _allMissions  = [];      // toutes les missions de l'aventure
let _sidebarOpen  = true;
let _editorAbort = null;
let _toolbarControls = null;

// Picker commun
let _pickerActive = false;
let _pickerIdx    = 0;
let _pickerFlat   = [];
let _pickerMode   = 'tag'; // 'tag' | 'dice'

// Picker @ tag
let _atStart     = null;
let _pickerQuery = '';
let _pickerData  = {};

// Picker [ dé
let _bracketStart = null;
let _bracketQuery = '';
let _bracketEnd   = 0;   // offset de fin sauvegardé avant que le focus quitte l'éditeur
let _diceSel      = null; // { name, stat } de la compétence sélectionnée (step 2)

// Brouillon de la modale de gestion des compétences
let _desAdmin = null;
let _desAdminAbort = null;
let _desAdminUid = 0;

// ── Entrée principale ─────────────────────────────────────────────────────────
async function renderHistoire() {
  const ctx = getHistoireCtx();
  _missionId    = ctx.id    || null;
  _missionTitre = ctx.titre || 'Mission';
  _missionActe  = ctx.acte  || '';

  if (!_missionId) {
    document.getElementById('main-content').innerHTML =
      emptyStateHtml('📖', 'Aucune mission sélectionnée.');
    return;
  }

  const [histDoc, npcs, chars, places, items, orgs, missions] = await Promise.all([
    getDocData('story_histories', _missionId).catch(() => null),
    loadCollection('npcs').catch(() => []),
    loadCollection('characters').catch(() => []),
    loadCollection('places').catch(() => []),
    loadCollection('shop').catch(() => []),
    loadCollection('organizations').catch(() => []),
    loadCollection('story').catch(() => []),
  ]);

  _allMissions = (missions || []).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));

  const users = STATE.adventureMembers || [];
  _pickerData = {
    pnj:          (npcs  || []).map(n => ({ id: n.id, label: n.nom  || n.name || '?' })),
    personnage:   (chars || []).map(c => ({ id: c.id, label: c.nom  || '?' })),
    lieu:         (places|| []).map(p => ({ id: p.id, label: p.nom  || p.name || '?' })),
    objet:        (items || []).map(i => ({ id: i.id, label: i.nom  || '?' })),
    organisation: (orgs  || []).map(o => ({ id: o.id, label: o.nom  || o.name || '?' })),
    joueur:       users.map(u => ({ id: u.uid || u.id, label: u.pseudo || u.email || '?' })),
  };

  const savedContent = sanitizeRichTextHtml(histDoc?.content || '');
  const wordCount    = countRichTextWords(savedContent);

  document.getElementById('main-content').innerHTML = `
    <div class="hist-shell" id="hist-shell">

      <!-- Barre de navigation -->
      <div class="hist-topbar">
        <button class="hist-back" data-navigate="story" title="Retour à la Trame">
          <span>←</span> Trame
        </button>
        <div class="hist-topbar-center">
          ${_missionActe ? `<span class="hist-acte-pill">${_esc(_missionActe)}</span>` : ''}
          <span class="hist-titre">${_esc(_missionTitre)}</span>
        </div>
        <div class="hist-topbar-actions">
          <button class="hist-handout-btn-top" data-action="_ouvrirHandout" title="Aperçu handout joueur">📜 Handout</button>
          <div class="hist-save-status" id="hist-save-status">
            <span class="hist-save-dot hist-save-dot--saved"></span> Sauvegardé
          </div>
        </div>
      </div>

      <!-- Barre d'outils -->
      <div class="hist-toolbar" id="hist-toolbar">
        ${richTextToolbarHtml({
          editorId: 'hist-editor',
          commandAttr: 'data-cmd',
          buttonClass: 'hist-tool',
          groupClass: 'hist-toolbar-group',
          separatorClass: 'hist-toolbar-sep',
          groups: [
            [{ type: 'block' }],
            ['bold', 'italic', 'underline', 'strikeThrough'],
            [{ type: 'color' }, { type: 'highlight' }, { type: 'size' }],
            [
              'insertUnorderedList',
              'insertOrderedList',
              { type: 'align' },
            ],
            [
              'createLink',
              'insertTable',
              'insertHorizontalRule',
            ],
            [
              { cmd: 'scene', title: 'Ajouter un marqueur de scène', html: '⛳ Scène', className: 'hist-tool--wide', stateful: false },
              { cmd: 'dice', title: 'Insérer un jet de dé (ou tapez [)', html: '🎲 Dé', className: 'hist-tool--wide', stateful: false },
            ],
          ],
          commandMeta: {
            bold: { title: 'Gras (Ctrl+B)', html: '<strong>B</strong>' },
            italic: { title: 'Italique (Ctrl+I)', html: '<em>I</em>' },
            underline: { title: 'Souligné (Ctrl+U)', html: '<u>U</u>' },
          },
        })}
        <div class="hist-toolbar-sep"></div>
        <div class="hist-toolbar-tags">
          ${Object.entries(TAG_TYPES).map(([, cfg]) =>
            `<span class="hist-tag-badge"
              style="color:${cfg.color};border-color:${cfg.color}40;background:${cfg.bg}"
              title="Tapez @ pour mentionner un·e ${cfg.label.toLowerCase()}"
            >${cfg.emoji} ${cfg.label}</span>`
          ).join('')}
        </div>
      </div>

      <!-- Table des scènes -->
      <nav class="hist-toc" id="hist-toc" style="display:none"></nav>

      <!-- Corps : sidebar + éditeur -->
      <div class="hist-body">

        <!-- Sidebar missions -->
        <aside class="hist-sidebar${_sidebarOpen ? '' : ' hist-sidebar--closed'}" id="hist-sidebar">
          <div class="hist-sidebar-inner">
            ${_renderSidebarMissions()}
          </div>
          <button class="hist-sidebar-toggle" id="hist-sidebar-toggle"
            data-action="_toggleHistSidebar" title="${_sidebarOpen ? 'Réduire' : 'Développer'}">
            ${_sidebarOpen ? '◀' : '▶'}
          </button>
        </aside>

        <!-- Zone d'écriture -->
        <div class="hist-editor-wrap">
          ${richTextEditableHtml({
            id: 'hist-editor',
            className: 'hist-editor rtc',
            html: savedContent,
            placeholder: "Commencez à écrire l'histoire de cette mission…\n\nTapez @ pour mentionner un PNJ, un lieu… · [ ou 🎲 Dé pour un jet de dé",
            attrs: { spellcheck: 'true' },
            sanitize: false,
          })}
        </div>

      </div>

      <!-- Barre de statut -->
      <div class="hist-statusbar">
        <span id="hist-wordcount">${wordCount} mot${wordCount !== 1 ? 's' : ''}</span>
        <span class="hist-tip">@ tag · <kbd>[</kbd> jet de dé · ▦ tableau · ⛳ scène</span>
      </div>

    </div>

    <!-- Picker @ / [ -->
    <div class="hist-picker" id="hist-picker" style="display:none">
      <div class="hist-picker-inner" id="hist-picker-inner"></div>
    </div>
  `;

  _bindEditor();
  _bindToolbar();
  _updateToc();

  setTimeout(() => document.getElementById('hist-editor')?.focus(), 80);
}

// ── Liaison éditeur ───────────────────────────────────────────────────────────
function _bindEditor() {
  _editorAbort?.abort();
  _editorAbort = new AbortController();
  const { signal } = _editorAbort;
  const editor = document.getElementById('hist-editor');
  if (!editor) return;

  editor.addEventListener('input', () => {
    _onInput();
    _schedSave();
    _updateWordCount();
    _updateToc();
  }, { signal });

  editor.addEventListener('keydown', (e) => {
    if (_pickerActive) {
      // Step 2 dé (focus sur l'input DD) : Escape ferme le picker
      if (_pickerMode === 'dice' && _diceSel !== null) {
        if (e.key === 'Escape') { e.preventDefault(); _closePicker(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); _pickerMove(1);  return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); _pickerMove(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (_pickerMode === 'dice') _histDiceSkillSelect(_pickerIdx);
        else                        _pickerSelect(_pickerFlat[_pickerIdx]);
        return;
      }
      if (e.key === 'Escape') { _closePicker(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); _saveNow(); }
  }, { signal });

  document.addEventListener('click', (e) => {
    if (!editor.isConnected) {
      _editorAbort?.abort();
      return;
    }
    if (!e.target.closest('#hist-picker') && !e.target.closest('#hist-editor')) {
      _closePicker();
    }
  }, { signal });

  _bindPicker();
}

function _bindPicker() {
  const picker = document.getElementById('hist-picker');
  if (!picker) return;
  picker.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('[data-pick-idx]');
    if (item) { _histPickerSelect(+item.dataset.pickIdx); return; }
    const diceItem = e.target.closest('[data-pick-dice-idx]');
    if (diceItem) { _histDiceSkillSelect(+diceItem.dataset.pickDiceIdx); return; }
    if (e.target.closest('[data-pick-confirm]')) { _histDiceConfirm(); return; }
    if (e.target.closest('[data-pick-manage]')) { _ouvrirGestionDes(); return; }
  });
}

// ── Input : détection @ et [ ──────────────────────────────────────────────────
function _onInput() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range  = sel.getRangeAt(0);
  const node   = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) { _closePicker(); return; }

  const text = node.textContent.substring(0, offset);

  // @ trigger → tag mention
  const atIdx = text.lastIndexOf('@');
  if (atIdx !== -1 && !text.substring(atIdx + 1).includes(' ')) {
    _pickerQuery = _norm(text.substring(atIdx + 1));
    _atStart     = { node, atIndex: atIdx };
    _pickerMode  = 'tag';
    _openPicker();
    return;
  }

  // [ trigger → jet de dé
  const brIdx = text.lastIndexOf('[');
  if (brIdx !== -1) {
    const after = text.substring(brIdx + 1);
    if (!after.includes(']') && !after.includes(' ')) {
      _bracketQuery = _norm(after);
      _bracketStart = { node, bracketIndex: brIdx };
      _pickerMode   = 'dice';
      _diceSel      = null;
      _openPicker();
      return;
    }
  }

  _closePicker();
}

// ── Picker : ouverture / positionnement ───────────────────────────────────────
function _openPicker() {
  const picker = document.getElementById('hist-picker');
  if (!picker) return;

  const sel = window.getSelection();
  if (sel.rangeCount) {
    const r    = sel.getRangeAt(0).cloneRange();
    r.collapse(true);
    const rect = r.getBoundingClientRect();
    const wrap = document.getElementById('hist-shell')?.getBoundingClientRect() || { top: 0, left: 0 };
    picker.style.top  = (rect.bottom - wrap.top + 4) + 'px';
    picker.style.left = Math.max(0, rect.left - wrap.left) + 'px';
  }

  _renderPickerContent();
  picker.style.display = 'block';
  _pickerActive = true;
}

function _renderPickerContent() {
  if (_pickerMode === 'dice') { _renderDicePickerContent(); return; }

  const inner = document.getElementById('hist-picker-inner');
  if (!inner) return;

  const q = _pickerQuery;
  _pickerFlat = [];
  let html = '';

  for (const [type, cfg] of Object.entries(TAG_TYPES)) {
    const filtered = (_pickerData[type] || [])
      .filter(item => !q || _norm(item.label).includes(q))
      .slice(0, 6);
    if (!filtered.length) continue;

    html += `<div class="hist-picker-group">
      <div class="hist-picker-group-label" style="color:${cfg.color}">${cfg.emoji} ${cfg.label}</div>`;
    filtered.forEach(item => {
      const idx = _pickerFlat.length;
      _pickerFlat.push({ type, ...item });
      html += `<div class="hist-picker-item ${idx === _pickerIdx ? 'active' : ''}"
        data-idx="${idx}" data-pick-idx="${idx}" style="--tag-color:${cfg.color};--tag-bg:${cfg.bg}">
        <span class="hist-picker-dot" style="background:${cfg.color}"></span>${_esc(item.label)}
      </div>`;
    });
    html += `</div>`;
  }

  if (!html) {
    html = `<div class="hist-picker-empty">Aucun résultat pour « ${_esc(_pickerQuery || '@')} »</div>`;
    _pickerFlat = [];
  }

  inner.innerHTML = html;
  _pickerIdx = Math.min(_pickerIdx, Math.max(0, _pickerFlat.length - 1));
}

// ── Picker dé ─────────────────────────────────────────────────────────────────
function _renderDicePickerContent() {
  const inner = document.getElementById('hist-picker-inner');
  if (!inner) return;

  // Step 2 : saisie du DD
  if (_diceSel !== null) {
    const col = STAT_COLORS[_diceSel.stat] || STAT_COLORS[''];
    inner.innerHTML = `
      <div style="padding:8px 12px">
        <div style="font-size:.78rem;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span style="color:#f59e0b">🎲 ${_esc(_diceSel.name)}</span>
          ${_diceSel.stat ? `<span style="color:${col};font-size:.72rem;font-weight:700;padding:1px 5px;border:1px solid ${col}40;border-radius:4px;background:${col}18">${_esc(_diceSel.stat)}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:.82rem;color:var(--text-muted)">DD</span>
          <input id="hist-dd-input" type="number" min="1" max="30" value="12"
            style="width:64px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-strong);
            background:var(--bg-card);color:var(--text);font-size:.9rem;outline:none;text-align:center"
          />
          <button data-pick-confirm
            style="padding:4px 12px;border-radius:6px;background:#f59e0b;color:#000;font-size:.82rem;font-weight:600;border:none;cursor:pointer">
            Insérer
          </button>
        </div>
      </div>`;
    setTimeout(() => {
      const i = document.getElementById('hist-dd-input');
      if (i) {
        i.focus(); i.select();
        i.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _histDiceConfirm(); }
        });
      }
    }, 30);
    return;
  }

  // Step 1 : liste des compétences
  const q       = _bracketQuery;
  const skills  = _getDiceSkills();
  const filtered = skills.filter(s => !q || _norm(s.name).includes(q));
  _pickerFlat = filtered.map(s => ({ type: 'dice', label: s.name, stat: s.stat }));

  let rows = '';
  if (!filtered.length) {
    rows = `<div class="hist-picker-empty">Aucune compétence correspondante</div>`;
  } else {
    rows = filtered.slice(0, 9).map((s, i) => {
      const col = STAT_COLORS[s.stat] || STAT_COLORS[''];
      return `<div class="hist-picker-item ${i === _pickerIdx ? 'active' : ''}" data-idx="${i}"
        style="--tag-color:#f59e0b;--tag-bg:rgba(245,158,11,.15)"
        data-pick-dice-idx="${i}">
        <span class="hist-picker-dot" style="background:#f59e0b"></span>
        <span style="flex:1">${_esc(s.name)}</span>
        ${s.stat ? `<span style="font-size:.68rem;font-weight:700;color:${col};padding:0 4px;border-radius:3px;background:${col}18">${_esc(s.stat)}</span>` : ''}
      </div>`;
    }).join('');
  }

  inner.innerHTML = `
    <div class="hist-picker-group">
      <div class="hist-picker-group-label" style="color:#f59e0b;display:flex;align-items:center;justify-content:space-between">
        <span>🎲 Jet de dé</span>
        <span class="hist-picker-manage-btn" data-pick-manage>⚙️ Gérer</span>
      </div>
      ${rows}
    </div>`;
  _pickerIdx = Math.min(_pickerIdx, Math.max(0, _pickerFlat.length - 1));
}

function _pickerMove(dir) {
  _pickerIdx = Math.max(0, Math.min(_pickerFlat.length - 1, _pickerIdx + dir));
  _renderPickerContent();
}

function _pickerSelect(item) {
  if (!item || !_atStart) { _closePicker(); return; }
  _insertTag(item);
  _closePicker();
}

function _closePicker() {
  const picker = document.getElementById('hist-picker');
  if (picker) picker.style.display = 'none';
  _pickerActive = false;
  _pickerIdx    = 0;
  _atStart      = null;
  _pickerQuery  = '';
  _bracketStart = null;
  _bracketQuery = '';
  _bracketEnd   = 0;
  _pickerMode   = 'tag';
  _diceSel      = null;
}

const _histPickerSelect    = (idx) => _pickerSelect(_pickerFlat[idx]);
const _histDiceSkillSelect = (idx) => {
  const item = _pickerFlat[idx];
  if (!item) return;
  _diceSel    = { name: item.label, stat: item.stat ?? '' };
  // ⚠️ Sauvegarder la position de fin AVANT que le focus quitte l'éditeur
  _bracketEnd = _bracketStart
    ? _bracketStart.bracketIndex + 1 + _bracketQuery.length
    : 0;
  _renderDicePickerContent();
};
const _histDiceConfirm = () => {
  const dd = parseInt(document.getElementById('hist-dd-input')?.value, 10) || 12;
  if (_diceSel && _bracketStart) _insertDiceTag(_diceSel, dd);
  _closePicker();
};

// ── Insertion d'un tag @ ──────────────────────────────────────────────────────
function _insertTag(item) {
  const cfg = TAG_TYPES[item.type];
  if (!cfg || !_atStart) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const span = richTextInlineChipElement({
    className: `htag htag--${item.type}`,
    dataset: { type: item.type, id: item.id, label: item.label },
    style: `color:${cfg.color};background:${cfg.bg};border:1px solid ${cfg.color}40;
      border-radius:4px;padding:1px 6px;font-size:.88em;font-weight:600;
      display:inline-block;margin:0 2px;white-space:nowrap;user-select:none;cursor:default;`,
    text: `${cfg.emoji} ${item.label}`,
  });

  const endRange = sel.getRangeAt(0);
  replaceRichTextRangeWithNode({
    startNode: _atStart.node,
    startOffset: _atStart.atIndex,
    endNode: endRange.endContainer,
    endOffset: endRange.endOffset,
    node: span,
    selection: sel,
  });
  _schedSave();
}

// ── Insertion d'un tag dé ─────────────────────────────────────────────────────
function _insertDiceTag(skill, dd) {
  if (!_bracketStart) return;

  // Construire le range depuis la position sauvegardée (sans se fier à la sélection courante)
  const endOffset = Math.min(_bracketEnd, _bracketStart.node.textContent.length);

  const col  = STAT_COLORS[skill.stat] || STAT_COLORS[''];
  const label = skill.stat
    ? `🎲 ${skill.name}\u00A0·\u00A0${skill.stat}\u00A0DD\u00A0${dd}`
    : `🎲 ${skill.name}\u00A0DD\u00A0${dd}`;

  const span = richTextInlineChipElement({
    className: 'htag htag--dice',
    dataset: { type: 'dice', skill: skill.name, stat: skill.stat, dd },
    style: `color:${col || '#d97706'};background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);
      border-radius:4px;padding:1px 6px;font-size:.88em;font-weight:600;
      display:inline-block;margin:0 2px;white-space:nowrap;user-select:none;cursor:default;`,
    text: label,
  });

  const editor = document.getElementById('hist-editor');
  replaceRichTextRangeWithNode({
    startNode: _bracketStart.node,
    startOffset: _bracketStart.bracketIndex,
    endOffset,
    node: span,
    editor,
  });
  _schedSave();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function _bindToolbar() {
  _toolbarControls?.abort();
  _toolbarControls = bindRichTextEditorControls({
    editorId: 'hist-editor',
    toolbarId: 'hist-toolbar',
    commandAttr: 'data-cmd',
    customCommands: {
      scene: () => {
        _insertScene();
        return true;
      },
      // Le bouton 🎲 insère "[" → déclenche le flux [ naturellement via _onInput
      dice: ({ editor }) => execRichTextCommand(editor, 'insertText', '['),
    },
    onAfterCommand: _schedSave,
  });
}

// ── Marqueurs de scène ────────────────────────────────────────────────────────
function _insertScene() {
  const editor = document.getElementById('hist-editor');
  if (!editor) return;

  const n = editor.querySelectorAll('.hist-scene-marker').length + 1;
  execRichTextCommand(editor, 'insertHTML', `<div class="hist-scene-marker">Scène ${n}</div><p><br></p>`);

  setTimeout(() => {
    const markers = editor.querySelectorAll('.hist-scene-marker');
    const last    = markers[markers.length - 1];
    if (last) selectRichTextNodeContents(last);
  }, 20);

  _updateToc();
  _schedSave();
}

// ── Table des scènes (TOC) ────────────────────────────────────────────────────
function _updateToc() {
  const editor = document.getElementById('hist-editor');
  const toc    = document.getElementById('hist-toc');
  if (!editor || !toc) return;

  const markers = editor.querySelectorAll('.hist-scene-marker');
  if (!markers.length) {
    toc.innerHTML = '';
    toc.style.display = 'none';
    return;
  }

  markers.forEach((m, i) => { m.id = `hist-scene-${i}`; });

  const links = Array.from(markers).map((m, i) => {
    const label = m.textContent.trim() || `Scène ${i + 1}`;
    return `<a href="#" class="hist-toc-link" data-action="_histScrollToScene" data-scene-id="${i}"
    >${_esc(label)}</a>`;
  }).join('');

  toc.innerHTML = `<span class="hist-toc-label">Scènes :</span>${links}`;
  toc.style.display = 'flex';
}

// ── Sidebar missions ──────────────────────────────────────────────────────────
function _renderSidebarMissions() {
  if (!_allMissions.length) return `<div class="hist-sb-empty">Aucune mission</div>`;

  // Grouper par acte dans l'ordre d'apparition
  const acteOrder = [];
  const byActe    = {};
  for (const m of _allMissions) {
    const acte = m.acte || 'Sans acte';
    if (!byActe[acte]) { byActe[acte] = []; acteOrder.push(acte); }
    byActe[acte].push(m);
  }

  return acteOrder.map(acte => {
    const isCurrentActe = acte === (_missionActe || 'Sans acte');
    const rows = byActe[acte].map(m => {
      const isCurrent = m.id === _missionId;
      return `<button class="hist-sb-item${isCurrent ? ' hist-sb-item--active' : ''}"
        data-action="_switchHistMission" data-id="${m.id}" data-titre="${_esc(m.titre||'')}" data-acte="${_esc(acte)}">
        <span class="hist-sb-item-title">${_esc(m.titre || '(sans titre)')}</span>
      </button>`;
    }).join('');

    return `<div class="hist-sb-group">
      <div class="hist-sb-acte${isCurrentActe ? ' hist-sb-acte--active' : ''}">${_esc(acte)}</div>
      ${rows}
    </div>`;
  }).join('');
}

function _toggleHistSidebar() {
  _sidebarOpen = !_sidebarOpen;
  const sb  = document.getElementById('hist-sidebar');
  const btn = document.getElementById('hist-sidebar-toggle');
  if (!sb || !btn) return;
  sb.classList.toggle('hist-sidebar--closed', !_sidebarOpen);
  btn.textContent = _sidebarOpen ? '◀' : '▶';
  btn.title       = _sidebarOpen ? 'Réduire' : 'Développer';
};

async function _switchHistMission(id, titre, acte) {
  if (id === _missionId) return;
  // Sauvegarder l'histoire courante avant de changer
  clearTimeout(_saveTimer);
  await _saveNow();

  _missionId    = id;
  _missionTitre = titre;
  _missionActe  = acte;
  setHistoireCtx(id, titre, acte);

  // Mettre à jour la topbar
  const pill  = document.querySelector('.hist-acte-pill');
  const titre_el = document.querySelector('.hist-titre');
  if (pill)    pill.textContent   = acte;
  if (titre_el) titre_el.textContent = titre;

  // Charger et afficher le nouveau contenu
  const editor = document.getElementById('hist-editor');
  if (editor) editor.innerHTML = loadingHtml('Chargement…');

  const histDoc = await getDocData('story_histories', id).catch(() => null);
  if (editor) {
    editor.innerHTML = sanitizeRichTextHtml(histDoc?.content || '');
    editor.focus();
  }

  _setSaveStatus('saved');
  _updateWordCount();
  _updateToc();

  // Mettre à jour la sidebar (surlignage)
  const sbInner = document.querySelector('.hist-sidebar-inner');
  if (sbInner) sbInner.innerHTML = _renderSidebarMissions();
}

// ── Gestion des compétences ───────────────────────────────────────────────────
const _desClone = value => JSON.parse(JSON.stringify(value));
const _desPlural = (count, singular, plural = `${singular}s`) => `${count} ${count > 1 ? plural : singular}`;
const _desNextId = () => `dice-skill-${++_desAdminUid}`;

function _desSavedName(skill) {
  return _desAdmin?.saved.find(saved => saved.id === skill.id)?.name ?? null;
}

function _desErrors(skill) {
  if (!String(skill?.name || '').trim()) return 'Nom requis';
  const key = diceSkillKey(skill.name);
  if (_desAdmin.draft.some(other => other !== skill && diceSkillKey(other.name) === key)) return 'Doublon';
  return '';
}

function _desDirty() {
  return !!_desAdmin && JSON.stringify(_desAdmin.draft) !== JSON.stringify(_desAdmin.saved);
}

function _desChangeCount() {
  if (!_desAdmin) return 0;
  return _desAdmin.draft.filter(skill => {
    const old = _desAdmin.saved.find(saved => saved.id === skill.id);
    return !old || old.name !== skill.name || old.stat !== skill.stat;
  }).length + _desAdmin.saved.filter(old => !_desAdmin.draft.some(skill => skill.id === old.id)).length;
}

function _desSnapshot() {
  if (!_desAdmin) return;
  _desAdmin.history.push(JSON.stringify(_desAdmin.draft));
  if (_desAdmin.history.length > 80) _desAdmin.history.shift();
}

function _desMutate(mutator) {
  _desSnapshot();
  mutator();
  _renderGestionDes();
}

function _desAddStat() {
  return _desAdmin.addStat ?? suggestDiceSkillStat(_desAdmin.addName) ?? '';
}

function _desStatSelector(current, attributes) {
  return `<div class="dsa-stat-selector" role="radiogroup">${DICE_SKILL_STATS.map(stat => `
    <button type="button" role="radio" aria-checked="${current === stat.key}" class="${current === stat.key ? 'is-active' : ''}"
      style="--dsa-stat:${stat.color}" ${attributes}="${stat.key}" title="${stat.label}">${stat.key || '—'}</button>`).join('')}</div>`;
}

function _desUsageFor(skill) {
  const originalName = _desSavedName(skill) ?? skill?.name ?? '';
  const key = diceSkillKey(originalName);
  const characters = new Set();
  const items = new Set();
  const inspectItem = item => {
    if (!item?.skillBonuses || !Object.keys(item.skillBonuses).some(name => diceSkillKey(name) === key)) return;
    items.add(item.nom || item.name || 'Objet sans nom');
  };
  (_desAdmin?.characters || []).forEach(character => {
    if (character?.competences && Object.keys(character.competences).some(name => diceSkillKey(name) === key)) {
      characters.add(character.nom || character.name || 'Personnage sans nom');
    }
    (character?.inventaire || []).forEach(inspectItem);
    Object.values(character?.equipement || {}).forEach(inspectItem);
    (character?.builds || []).forEach(build => Object.values(build?.equipement || {}).forEach(inspectItem));
  });
  (_desAdmin?.shop || []).forEach(inspectItem);
  return { characters: [...characters], items: [...items] };
}

function _desIsUsed(skill) {
  const usage = _desUsageFor(skill);
  return usage.characters.length + usage.items.length > 0;
}

function _desTags(skill) {
  const tags = [];
  const error = _desErrors(skill);
  const original = _desSavedName(skill);
  const characteristic = characteristicForSkillName(skill.name);
  if (error) tags.push(`<span class="dsa-tag is-error">${error}</span>`);
  if (original == null) tags.push('<span class="dsa-tag is-new">Nouvelle</span>');
  if (original != null && original !== String(skill.name).trim()) {
    tags.push(`<span class="dsa-tag is-renamed" title="Ancien nom : ${_esc(original)}. Les fiches et objets suivront à l’enregistrement.">Renommée · suivi auto</span>`);
  }
  if (characteristic && characteristic !== skill.stat) {
    tags.push(`<button type="button" class="dsa-tag is-warning" data-action="_desFixStat" data-id="${skill.id}" data-stat="${characteristic}">Lier à ${characteristic}</button>`);
  }
  return tags.join('');
}

function _desVisibleSkills() {
  const query = diceSkillKey(_desAdmin.addName);
  return _desAdmin.draft.filter(skill =>
    (_desAdmin.filter === 'all' || skill.stat === _desAdmin.filter)
    && (!query || diceSkillKey(skill.name).includes(query)));
}

function _desMissingDefaults() {
  const names = new Set(_desAdmin.draft.map(skill => diceSkillKey(skill.name)));
  return DICE_SKILLS_DEFAULT.filter(skill => !names.has(diceSkillKey(skill.name)));
}

function _desSortMenuHtml() {
  const missing = _desMissingDefaults();
  return `<div class="dsa-sort-menu">
    <button type="button" data-action="_desSort" data-mode="az"><b>Ordre alphabétique</b><small>A → Z, accents compris</small></button>
    <button type="button" data-action="_desSort" data-mode="stat"><b>Par caractéristique</b><small>FOR, DEX, CON… puis Libre</small></button>
    <button type="button" data-action="_desSort" data-mode="pure"><b>Caractéristiques pures d’abord</b><small>Force, Dextérité… puis les compétences</small></button>
    <hr>
    <button type="button" data-action="_desFillDefaults" ${missing.length ? '' : 'disabled'}><b>Compléter avec les jets par défaut</b><small>${missing.length ? `Ajoute ${_esc(missing.map(skill => skill.name).join(', '))}` : 'Rien ne manque'}</small></button>
    <button type="button" data-action="_desAskDefaults"><b>Revenir à la liste par défaut</b><small>Remplace toute la liste (annulable)</small></button>
  </div>`;
}

function _renderDesAddControls() {
  const host = document.getElementById('dsa-add-controls');
  if (!host || !_desAdmin) return;
  const name = _desAdmin.addName.trim();
  const duplicate = name && _desAdmin.draft.some(skill => diceSkillKey(skill.name) === diceSkillKey(name));
  const suggested = _desAdmin.addStat == null && suggestDiceSkillStat(name) != null;
  host.innerHTML = `
    <span class="dsa-add-hint${duplicate ? ' is-warning' : ''}">${duplicate ? 'Existe déjà' : suggested ? 'Carac. suggérée' : name ? '' : 'Entrée pour ajouter'}</span>
    ${_desStatSelector(_desAddStat(), 'data-action="_desSelectAddStat" data-stat')}
    <button type="button" class="dsa-btn is-primary is-small" data-action="_gestionDesAdd" ${!name || duplicate ? 'disabled' : ''}>Ajouter</button>`;
}

function _renderDesFilters() {
  const host = document.getElementById('dsa-filters');
  if (!host || !_desAdmin) return;
  const count = stat => _desAdmin.draft.filter(skill => skill.stat === stat).length;
  host.innerHTML = `
    <button type="button" class="dsa-filter${_desAdmin.filter === 'all' ? ' is-active' : ''}" data-action="_desFilter" data-stat="all">Toutes <b>${_desAdmin.draft.length}</b></button>
    ${DICE_SKILL_STATS.map(stat => {
      const total = count(stat.key);
      return `<button type="button" class="dsa-filter${_desAdmin.filter === stat.key ? ' is-active' : ''}${stat.key && total <= 1 ? ' is-low' : ''}" style="--dsa-stat:${stat.color}" data-action="_desFilter" data-stat="${stat.key}"><i></i>${stat.key || 'Libre'} <b>${total}</b></button>`;
    }).join('')}
    <span class="dsa-spacer"></span>
    <div class="dsa-sort-wrap"><button type="button" class="dsa-btn is-ghost is-small" data-action="_desToggleSort" aria-expanded="${_desAdmin.menu}"><span>⇅</span> Trier et compléter</button>${_desAdmin.menu ? _desSortMenuHtml() : ''}</div>`;
}

function _renderDesList() {
  const host = document.getElementById('dsa-list');
  if (!host || !_desAdmin) return;
  const visible = _desVisibleSkills();
  const locked = _desAdmin.filter !== 'all' || !!diceSkillKey(_desAdmin.addName);
  const count = stat => _desAdmin.draft.filter(skill => skill.stat === stat).length;
  const low = DICE_SKILL_STATS.filter(stat => stat.key && count(stat.key) <= 1).map(stat => {
    const entries = _desAdmin.draft.filter(skill => skill.stat === stat.key);
    return entries.length ? `<b>${stat.key}</b> n’a qu’un jet (${_esc(entries[0].name)})` : `<b>${stat.key}</b> n’a aucun jet`;
  });
  let html = !locked && low.length
    ? `<p class="dsa-note">${low.join(' · ')} : les personnages qui misent sur cette caractéristique auront peu d’occasions de briller.</p>`
    : '';
  html += visible.map(skill => `<div class="dsa-row${skill.id === _desAdmin.fresh ? ' is-fresh' : ''}" draggable="${!locked}" data-des-row="${skill.id}">
    <span class="dsa-handle" title="${locked ? 'Retirez le filtre pour réordonner' : 'Glisser pour réordonner'}">⠿</span>
    <input class="dsa-name${_desErrors(skill) ? ' is-invalid' : ''}" value="${_esc(skill.name)}" maxlength="40" data-input="_desNameInput" data-id="${skill.id}" aria-label="Nom de la compétence">
    <span class="dsa-tags" data-des-tags="${skill.id}">${_desTags(skill)}</span>
    ${_desStatSelector(skill.stat, `data-action="_gestionDesEditStat" data-id="${skill.id}" data-stat`)}
    <button type="button" class="dsa-remove" data-action="_gestionDesDel" data-id="${skill.id}" title="Supprimer" aria-label="Supprimer ${_esc(skill.name)}">×</button>
  </div>`).join('');
  if (!visible.length) {
    const name = _desAdmin.addName.trim();
    html = name
      ? `<div class="dsa-empty"><p>Aucune compétence « ${_esc(name)} ».</p><button type="button" class="dsa-btn is-ghost is-small" data-action="_gestionDesAdd">Ajouter « ${_esc(name)} » en ${_desAddStat() || 'Libre'}</button></div>`
      : `<div class="dsa-empty"><p>Aucun jet${_desAdmin.filter === 'all' ? '' : ` en ${_desAdmin.filter || 'Libre'}`}.</p></div>`;
  }
  host.classList.toggle('is-locked', locked);
  host.innerHTML = html;
  _desAdmin.fresh = null;
}

function _desRenames() {
  return _desAdmin.draft.filter(skill => {
    const original = _desSavedName(skill);
    return original != null && original !== String(skill.name).trim() && !_desErrors(skill);
  });
}

function _renderDesFooter() {
  const host = document.getElementById('dsa-footer');
  if (!host || !_desAdmin) return;
  const ask = _desAdmin.ask;
  if (ask?.type === 'delete') {
    const skill = _desAdmin.draft.find(entry => entry.id === ask.id);
    const usage = _desUsageFor(skill);
    const details = [
      usage.characters.length ? `${_desPlural(usage.characters.length, 'personnage')} ${usage.characters.length > 1 ? 'perdent' : 'perd'} sa formation (${_esc(usage.characters.join(', '))})` : '',
      usage.items.length ? `${_desPlural(usage.items.length, 'objet')} ${usage.items.length > 1 ? 'perdent' : 'perd'} son bonus (${_esc(usage.items.join(', '))})` : '',
    ].filter(Boolean).join(' · ');
    host.innerHTML = `<div class="dsa-footer-status"><div class="dsa-question">Supprimer « ${_esc(skill?.name || '')} » ?<small>${details}.</small></div></div><div class="dsa-footer-actions"><button class="dsa-btn is-text" data-action="_desCancelAsk">Annuler</button><button class="dsa-btn is-danger" data-action="_desConfirmAsk">Supprimer</button></div>`;
    return;
  }
  if (ask?.type === 'defaults') {
    host.innerHTML = `<div class="dsa-footer-status"><div class="dsa-question">Remplacer toute la liste par les ${DICE_SKILLS_DEFAULT.length} jets par défaut ?<small>Les ajouts disparaîtront du brouillon. Rien n’est écrit avant d’enregistrer.</small></div></div><div class="dsa-footer-actions"><button class="dsa-btn is-text" data-action="_desCancelAsk">Annuler</button><button class="dsa-btn is-primary" data-action="_desConfirmAsk">Remplacer</button></div>`;
    return;
  }
  const errors = _desAdmin.draft.filter(_desErrors);
  const changes = _desChangeCount();
  if (ask?.type === 'close') {
    host.innerHTML = `<div class="dsa-footer-status"><div class="dsa-question">${_desPlural(changes, 'modification non enregistrée', 'modifications non enregistrées')}<small>Elles seront perdues si vous fermez maintenant.</small></div></div><div class="dsa-footer-actions"><button class="dsa-btn is-text" data-action="_desCancelAsk">Continuer</button><button class="dsa-btn is-ghost" data-action="_desDiscardClose">Quitter sans enregistrer</button><button class="dsa-btn is-primary" data-action="_desSave" data-close-after="true" ${errors.length ? 'disabled' : ''}>Enregistrer et fermer</button></div>`;
    return;
  }
  const renames = _desRenames();
  const info = errors.length
    ? `<span class="dsa-info is-error">${_desPlural(errors.length, 'nom à corriger')}</span>`
    : changes
      ? `<span class="dsa-info"><i></i>${_desPlural(changes, 'modification')}${renames.length ? ` · ${renames.map(skill => `${_esc(_desSavedName(skill))} → ${_esc(skill.name.trim())}`).join(', ')} : fiches et objets suivront` : ''}</span>`
      : '<span class="dsa-info">Tout est enregistré</span>';
  host.innerHTML = `<div class="dsa-footer-status">${info}</div><div class="dsa-footer-actions"><button class="dsa-btn is-text" data-action="_desUndo" ${_desAdmin.history.length ? '' : 'disabled'} title="Ctrl+Z">↶ Annuler</button>${changes ? '<button class="dsa-btn is-text" data-action="_desResetDraft">Tout rétablir</button>' : ''}<button class="dsa-btn is-ghost" data-action="_histDesDismiss">Fermer</button><button class="dsa-btn is-primary" data-action="_desSave" ${!changes || errors.length ? 'disabled' : ''}>Enregistrer</button></div>`;
}

function _renderGestionDes() {
  if (!_desAdmin || !document.getElementById('dsa-shell')) return;
  _renderDesAddControls();
  _renderDesFilters();
  _renderDesList();
  _renderDesFooter();
}

function _desToast(message, undoable = false) {
  const toast = document.getElementById('dsa-toast');
  if (!toast) return;
  toast.innerHTML = `<span>${_esc(message)}</span>${undoable ? '<button type="button" data-action="_desUndo">Annuler</button>' : ''}`;
  toast.classList.add('is-visible');
  clearTimeout(_desAdmin.toastTimer);
  _desAdmin.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), undoable ? 4200 : 2200);
}

function _desCloseGuard() {
  if (!_desDirty()) return false;
  _desAdmin.ask = { type: 'close' };
  _renderDesFooter();
  return true;
}

function _desCleanup() {
  if (_desAdmin?.toastTimer) clearTimeout(_desAdmin.toastTimer);
  _desAdminAbort?.abort();
  _desAdminAbort = null;
  _desAdmin = null;
  setModalCloseGuard(null);
}

function _bindDesAdminDom() {
  _desAdminAbort?.abort();
  _desAdminAbort = new AbortController();
  const signal = _desAdminAbort.signal;
  const list = document.getElementById('dsa-list');
  let dragId = null;
  list?.addEventListener('dragstart', event => {
    const row = event.target.closest('[data-des-row]');
    if (!row || row.draggable === false || event.target.matches('input') || _desAdmin.filter !== 'all' || diceSkillKey(_desAdmin.addName)) {
      event.preventDefault();
      return;
    }
    dragId = row.dataset.desRow;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
  }, { signal });
  list?.addEventListener('dragover', event => {
    if (!dragId) return;
    event.preventDefault();
    const row = event.target.closest('[data-des-row]');
    list.querySelectorAll('.is-over').forEach(item => item.classList.remove('is-over'));
    if (row && row.dataset.desRow !== dragId) row.classList.add('is-over');
  }, { signal });
  list?.addEventListener('drop', event => {
    event.preventDefault();
    const target = event.target.closest('[data-des-row]');
    const id = dragId;
    dragId = null;
    if (!target || target.dataset.desRow === id) { _renderDesList(); return; }
    _desMutate(() => {
      const from = _desAdmin.draft.findIndex(skill => skill.id === id);
      const [skill] = _desAdmin.draft.splice(from, 1);
      const to = _desAdmin.draft.findIndex(entry => entry.id === target.dataset.desRow);
      _desAdmin.draft.splice(to, 0, skill);
    });
  }, { signal });
  list?.addEventListener('dragend', () => {
    dragId = null;
    list.querySelectorAll('.is-dragging,.is-over').forEach(item => item.classList.remove('is-dragging', 'is-over'));
  }, { signal });
  document.getElementById('dsa-shell')?.addEventListener('focusin', event => {
    if (event.target.matches('[data-input="_desNameInput"]') && !_desAdmin.typing) {
      _desSnapshot();
      _desAdmin.typing = true;
    }
  }, { signal });
  document.getElementById('dsa-shell')?.addEventListener('focusout', event => {
    if (event.target.matches('[data-input="_desNameInput"]')) _desAdmin.typing = false;
  }, { signal });
  document.getElementById('dsa-shell')?.addEventListener('keydown', event => {
    if (event.target.id === 'dsa-add-input' && event.key === 'Enter') { event.preventDefault(); _gestionDesAdd(); }
    else if (event.target.id === 'dsa-add-input' && event.key === 'Escape' && _desAdmin.addName) {
      event.preventDefault(); event.stopPropagation();
      _desAdmin.addName = ''; _desAdmin.addStat = null; event.target.value = ''; _renderGestionDes();
    } else if (event.target.matches('[data-input="_desNameInput"]') && event.key === 'Enter') event.target.blur();
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.matches('input')) {
      event.preventDefault(); _desUndo();
    } else if (event.key === 'Escape' && (_desAdmin.menu || _desAdmin.ask)) {
      event.preventDefault(); event.stopPropagation();
      _desAdmin.menu = false; _desAdmin.ask = null; _renderDesFilters(); _renderDesFooter();
    }
  }, { signal });
  document.addEventListener('click', event => {
    if (_desAdmin?.menu && !event.target.closest('.dsa-sort-wrap')) {
      _desAdmin.menu = false;
      _renderDesFilters();
    }
  }, { signal });
  document.addEventListener('app:modal-closed', _desCleanup, { signal, once: true });
}

async function _ouvrirGestionDes() {
  _closePicker();
  const skills = (await _loadDiceSkills()).map(skill => ({ id: _desNextId(), name: skill.name, stat: skill.stat || '' }));
  const [characters, shop] = await Promise.all([
    loadCollection('characters').catch(() => STATE.characters || []),
    loadCollection('shop').catch(() => []),
  ]);
  _desAdmin = {
    saved: _desClone(skills), draft: _desClone(skills), history: [], filter: 'all',
    menu: false, ask: null, addName: '', addStat: null, fresh: null,
    typing: false, toastTimer: null, characters, shop,
  };
  openModal('', `<section class="dsa-shell" id="dsa-shell">
    <header class="dsa-header"><div><h2>Compétences de dés</h2><p>Les jets disponibles en aventure et la caractéristique qui les modifie. Leur ordre est repris sur la fiche et dans le lanceur.</p></div><button type="button" class="dsa-close" data-action="_histDesDismiss" aria-label="Fermer">×</button></header>
    <div class="dsa-tools"><div class="dsa-add"><span class="dsa-add-icon">＋</span><input id="dsa-add-input" data-input="_desAddInput" placeholder="Ajouter ou rechercher une compétence…" autocomplete="off"><span id="dsa-add-controls" class="dsa-add-controls"></span></div><div class="dsa-filters" id="dsa-filters"></div></div>
    <div class="dsa-list" id="dsa-list" aria-label="Compétences"></div>
    <footer class="dsa-footer" id="dsa-footer"></footer>
    <div class="dsa-toast" id="dsa-toast" role="status" aria-live="polite"></div>
  </section>`);
  setModalCloseGuard(_desCloseGuard);
  _renderGestionDes();
  _bindDesAdminDom();
}

function _gestionDesEditStat(button) {
  const skill = _desAdmin?.draft.find(entry => entry.id === button.dataset.id);
  if (!skill || skill.stat === button.dataset.stat) return;
  _desMutate(() => { skill.stat = button.dataset.stat; });
}

function _gestionDesDel(id) {
  const skill = _desAdmin?.draft.find(entry => entry.id === id);
  if (!skill) return;
  if (_desIsUsed(skill)) {
    _desAdmin.ask = { type: 'delete', id };
    _renderDesFooter();
    return;
  }
  _desMutate(() => { _desAdmin.draft = _desAdmin.draft.filter(entry => entry.id !== id); });
  _desToast(`« ${skill.name || 'Sans nom'} » supprimée`, true);
}

function _gestionDesAdd() {
  if (!_desAdmin) return;
  const name = _desAdmin.addName.trim();
  if (!name || _desAdmin.draft.some(skill => diceSkillKey(skill.name) === diceSkillKey(name))) return;
  const skill = { id: _desNextId(), name, stat: _desAddStat() };
  _desMutate(() => {
    _desAdmin.draft.push(skill);
    _desAdmin.fresh = skill.id;
    if (_desAdmin.filter !== 'all' && _desAdmin.filter !== skill.stat) _desAdmin.filter = 'all';
    _desAdmin.addName = '';
    _desAdmin.addStat = null;
  });
  document.getElementById('dsa-list')?.scrollTo({ top: 99999, behavior: 'smooth' });
  document.getElementById('dsa-add-input')?.focus();
}

function _desUndo() {
  if (!_desAdmin?.history.length) return;
  _desAdmin.draft = JSON.parse(_desAdmin.history.pop());
  _desAdmin.ask = null;
  _renderGestionDes();
  _desToast('Modification annulée');
}

function _desMigrateCharacter(character, migrations) {
  const patch = {};
  const training = migrateSkillMap(character.competences, migrations);
  if (training.changed) patch.competences = training.value;
  const inventory = migrateSkillBonusesInItems(character.inventaire, migrations);
  if (inventory.changed) patch.inventaire = inventory.value;
  const equipment = migrateSkillBonusesInEquipment(character.equipement, migrations);
  if (equipment.changed) patch.equipement = equipment.value;
  if (Array.isArray(character.builds)) {
    let buildsChanged = false;
    const builds = character.builds.map(build => {
      const migrated = migrateSkillBonusesInEquipment(build?.equipement, migrations);
      if (!migrated.changed) return build;
      buildsChanged = true;
      return { ...build, equipement: migrated.value };
    });
    if (buildsChanged) patch.builds = builds;
  }
  return patch;
}

async function _desSave(closeAfter = false) {
  if (!_desAdmin || _desAdmin.draft.some(_desErrors)) return false;
  const persisted = _desAdmin.draft.map(skill => ({ name: skill.name.trim(), stat: skill.stat || '' }));
  const migrations = buildDiceSkillMigrations(_desAdmin.saved, _desAdmin.draft);
  const writes = [{ col: 'world', id: 'dice_skills', data: { skills: persisted } }];
  const characterPatches = [];
  _desAdmin.characters.forEach(character => {
    const patch = _desMigrateCharacter(character, migrations);
    if (Object.keys(patch).length) {
      characterPatches.push({ character, patch });
      writes.push({ col: 'characters', id: character.id, data: patch });
    }
  });
  const shopPatches = [];
  _desAdmin.shop.forEach(item => {
    const migrated = migrateSkillBonusesInItem(item, migrations);
    if (migrated.changed) {
      const patch = { skillBonuses: migrated.value.skillBonuses };
      shopPatches.push({ item, patch });
      writes.push({ col: 'shop', id: item.id, data: patch });
    }
  });
  if (writes.length > 500) {
    showNotif('Trop de documents à migrer en un seul enregistrement.', 'error');
    return false;
  }
  try {
    await batchSaveInCol(writes);
  } catch {
    showNotif('Erreur — compétences de dés non sauvegardées.', 'error');
    return false;
  }
  characterPatches.forEach(({ character, patch }) => Object.assign(character, patch));
  shopPatches.forEach(({ item, patch }) => Object.assign(item, patch));
  _diceSkillsCache = persisted;
  lsJson.set(DICE_SKILLS_STORAGE_KEY, persisted);
  _desAdmin.saved = _desClone(_desAdmin.draft.map(skill => ({ ...skill, name: skill.name.trim() })));
  _desAdmin.draft = _desClone(_desAdmin.saved);
  _desAdmin.history = [];
  _desAdmin.ask = null;
  document.dispatchEvent(new CustomEvent('dice-skills-updated', { detail: { skills: persisted } }));
  showNotif(migrations.length ? 'Compétences enregistrées · références mises à jour.' : 'Compétences enregistrées.', 'success');
  if (closeAfter) closeModalDirect();
  else _renderGestionDes();
  return true;
}

// ── Handout joueur ────────────────────────────────────────────────────────────
function _ouvrirHandout() {
  const editor = document.getElementById('hist-editor');
  if (!editor) return;

  const clone = editor.cloneNode(true);
  clone.removeAttribute('contenteditable');
  clone.removeAttribute('data-placeholder');
  clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

  clone.querySelectorAll('.hist-scene-marker').forEach(m => {
    const div = document.createElement('div');
    div.className   = 'hist-handout-scene-title';
    div.textContent = m.textContent.trim();
    m.replaceWith(div);
  });

  const content   = sanitizeRichTextHtml(clone.innerHTML);
  const wordCount = countRichTextWords(content);

  document.getElementById('hist-handout-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'hist-handout-modal';
  modal.innerHTML = `
    <div class="hist-handout-backdrop" data-action="_histHandoutDismiss"></div>
    <div class="hist-handout-panel">
      <div class="hist-handout-header">
        <div>
          ${_missionActe ? `<div class="hist-handout-acte">${_esc(_missionActe)}</div>` : ''}
          <div class="hist-handout-title">${_esc(_missionTitre)}</div>
          <div class="hist-handout-meta">${wordCount} mot${wordCount !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0">
          <button class="hist-handout-action" data-action="_histHandoutCopy">📋 Copier le texte</button>
          <button class="hist-handout-action hist-handout-close" data-action="_histHandoutDismiss">✕</button>
        </div>
      </div>
      <div class="hist-handout-body">${content}</div>
    </div>`;

  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('hist-handout-visible'), 10);
};

function _histHandoutCopy() {
  const body = document.querySelector('.hist-handout-body');
  if (!body) return;
  copyText(body.innerText)
    .then(() => showNotif('Texte copié dans le presse-papiers !', 'success'))
    .catch(()  => showNotif('Copie impossible.', 'error'));
}

// ── Sauvegarde ────────────────────────────────────────────────────────────────
function _schedSave() {
  _setSaveStatus('unsaved');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveNow, 1800);
}

async function _saveNow() {
  if (!_missionId) return;
  const editor = document.getElementById('hist-editor');
  if (!editor) return;

  _setSaveStatus('saving');
  try {
    await saveDoc('story_histories', _missionId, {
      content:      sanitizeRichTextHtml(editor.innerHTML),
      missionId:    _missionId,
      missionTitre: _missionTitre,
      updatedAt:    new Date().toISOString(),
    });
    // Cache patché automatiquement par saveDoc — pas besoin d'invalider.
    _setSaveStatus('saved');
  } catch (e) {
    console.error('[histoire] save failed', e);
    _setSaveStatus('unsaved');
    showNotif('Erreur de sauvegarde.', 'error');
  }
}

function _setSaveStatus(status) {
  const el = document.getElementById('hist-save-status');
  if (!el) return;
  const map = {
    saved:   { dot: 'hist-save-dot--saved',   text: 'Sauvegardé'     },
    saving:  { dot: 'hist-save-dot--saving',  text: 'Sauvegarde…'   },
    unsaved: { dot: 'hist-save-dot--unsaved', text: 'Non sauvegardé' },
  };
  const cfg = map[status] || map.saved;
  el.innerHTML = `<span class="hist-save-dot ${cfg.dot}"></span> ${cfg.text}`;
}

function _updateWordCount() {
  const editor = document.getElementById('hist-editor');
  const el     = document.getElementById('hist-wordcount');
  if (!editor || !el) return;
  const n = countRichTextWords(editor.innerHTML);
  el.textContent = `${n} mot${n !== 1 ? 's' : ''}`;
}

// ── Enregistrement de la page ─────────────────────────────────────────────────
PAGES.histoire = renderHistoire;

registerActions({
  _ouvrirGestionDes:    () => _ouvrirGestionDes(),
  _ouvrirHandout:       () => _ouvrirHandout(),
  _toggleHistSidebar:   () => _toggleHistSidebar(),
  _histScrollToScene:   (btn, e) => { e.preventDefault(); document.getElementById(`hist-scene-${btn.dataset.sceneId}`)?.scrollIntoView({behavior:'smooth',block:'center'}); },
  _switchHistMission:   (btn) => _switchHistMission(btn.dataset.id, btn.dataset.titre, btn.dataset.acte),
  _gestionDesEditStat:  (btn) => _gestionDesEditStat(btn),
  _gestionDesDel:       (btn) => _gestionDesDel(btn.dataset.id),
  _histDesDismiss:      () => closeModalDirect(),
  _gestionDesAdd:       ()    => _gestionDesAdd(),
  _desSelectAddStat:    (btn) => { if (_desAdmin) { _desAdmin.addStat = btn.dataset.stat; _renderDesAddControls(); document.getElementById('dsa-add-input')?.focus(); } },
  _desAddInput:         (input) => { if (_desAdmin) { _desAdmin.addName = input.value; if (!input.value) _desAdmin.addStat = null; _renderDesAddControls(); _renderDesList(); } },
  _desNameInput:        (input) => {
    const skill = _desAdmin?.draft.find(entry => entry.id === input.dataset.id);
    if (!skill) return;
    skill.name = input.value;
    _desAdmin.draft.forEach(entry => {
      const field = document.querySelector(`.dsa-name[data-id="${entry.id}"]`);
      const tags = document.querySelector(`[data-des-tags="${entry.id}"]`);
      field?.classList.toggle('is-invalid', !!_desErrors(entry));
      if (tags) tags.innerHTML = _desTags(entry);
    });
    _renderDesAddControls();
    _renderDesFooter();
  },
  _desFilter:           (btn) => { if (_desAdmin) { _desAdmin.filter = btn.dataset.stat; _renderGestionDes(); } },
  _desToggleSort:       () => { if (_desAdmin) { _desAdmin.menu = !_desAdmin.menu; _renderDesFilters(); } },
  _desSort:             (btn) => { if (_desAdmin) _desMutate(() => { _desAdmin.draft = sortDiceSkills(_desAdmin.draft, btn.dataset.mode); _desAdmin.menu = false; }); },
  _desFillDefaults:     () => {
    if (!_desAdmin) return;
    const missing = _desMissingDefaults();
    if (!missing.length) return;
    _desMutate(() => { _desAdmin.draft.push(...missing.map(skill => ({ id: _desNextId(), ...skill }))); _desAdmin.menu = false; });
    _desToast(`${_desPlural(missing.length, 'jet ajouté', 'jets ajoutés')}`, true);
  },
  _desAskDefaults:      () => { if (_desAdmin) { _desAdmin.menu = false; _desAdmin.ask = { type: 'defaults' }; _renderDesFilters(); _renderDesFooter(); } },
  _desFixStat:          (btn) => {
    const skill = _desAdmin?.draft.find(entry => entry.id === btn.dataset.id);
    if (skill) _desMutate(() => { skill.stat = btn.dataset.stat; });
  },
  _desCancelAsk:        () => { if (_desAdmin) { _desAdmin.ask = null; _renderDesFooter(); } },
  _desConfirmAsk:       () => {
    const ask = _desAdmin?.ask;
    if (!ask) return;
    if (ask.type === 'delete') {
      const skill = _desAdmin.draft.find(entry => entry.id === ask.id);
      _desMutate(() => { _desAdmin.draft = _desAdmin.draft.filter(entry => entry.id !== ask.id); _desAdmin.ask = null; });
      _desToast(`« ${skill?.name || 'Sans nom'} » supprimée`, true);
    } else if (ask.type === 'defaults') {
      _desMutate(() => {
        const ids = new Map(_desAdmin.draft.map(skill => [diceSkillKey(skill.name), skill.id]));
        _desAdmin.draft = DICE_SKILLS_DEFAULT.map(skill => ({ id: ids.get(diceSkillKey(skill.name)) || _desNextId(), ...skill }));
        _desAdmin.filter = 'all';
        _desAdmin.ask = null;
      });
      _desToast('Liste par défaut rétablie', true);
    }
  },
  _desUndo:             () => _desUndo(),
  _desResetDraft:       () => { if (_desAdmin) { _desSnapshot(); _desAdmin.draft = _desClone(_desAdmin.saved); _desAdmin.ask = null; _renderGestionDes(); _desToast('Modifications annulées', true); } },
  _desDiscardClose:     () => { if (_desAdmin) { _desAdmin.draft = _desClone(_desAdmin.saved); closeModalDirect(); } },
  _desSave:             (btn) => _desSave(btn.dataset.closeAfter === 'true'),
  _histHandoutDismiss:  ()    => document.getElementById('hist-handout-modal')?.remove(),
  _histHandoutCopy:     ()    => _histHandoutCopy(),
});

// Préchauffage du cache des compétences dès le chargement du module
_loadDiceSkills();
