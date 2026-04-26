// ══════════════════════════════════════════════════════════════════════════════
// HISTOIRE.JS — Éditeur de mission intégré
// Éditeur rich-text contenteditable avec tags @mention colorés,
// marqueurs de scène, références de jet de dé, export handout joueur
// Admin uniquement — chaque mission a son histoire attachée
// ══════════════════════════════════════════════════════════════════════════════

import { getDocData, saveDoc, loadCollection, invalidateCache } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { showNotif } from '../shared/notifications.js';
import {
  bindRichTextEditorControls,
  countRichTextWords,
  execRichTextCommand,
  richTextEditableHtml,
  richTextInlineChipElement,
  richTextToolbarHtml,
  replaceRichTextRangeWithNode,
  selectRichTextNodeContents,
} from '../shared/rich-text.js';
import PAGES from './pages.js';

// ── Config des types de tags ──────────────────────────────────────────────────
const TAG_TYPES = {
  pnj:          { label: 'PNJ',          color: '#4f8cff', bg: 'rgba(79,140,255,.18)',  emoji: '👤', col: 'npcs'          },
  personnage:   { label: 'Personnage',   color: '#a855f7', bg: 'rgba(168,85,247,.18)', emoji: '📜', col: 'characters'    },
  lieu:         { label: 'Lieu',         color: '#22c38e', bg: 'rgba(34,195,142,.18)', emoji: '📍', col: 'places'        },
  objet:        { label: 'Objet',        color: '#f59e0b', bg: 'rgba(245,158,11,.18)', emoji: '⚔️', col: 'shop'          },
  organisation: { label: 'Organisation', color: '#ef4444', bg: 'rgba(239,68,68,.18)',  emoji: '🏛️', col: 'organizations' },
  joueur:       { label: 'Joueur',       color: '#ec4899', bg: 'rgba(236,72,153,.18)', emoji: '🎮', col: 'users'         },
};

// ── Compétences par défaut (modifiables via le panneau de gestion) ────────────
const DICE_SKILLS_DEFAULT = [
  { name: 'Acrobaties',     stat: 'DEX' }, { name: 'Arcanes',        stat: 'INT' },
  { name: 'Athlétisme',     stat: 'FOR' }, { name: 'Charisme',       stat: 'CHA' },
  { name: 'Combat',         stat: ''    }, { name: 'Constitution',   stat: 'CON' },
  { name: 'Dextérité',      stat: 'DEX' }, { name: 'Discrétion',     stat: 'DEX' },
  { name: 'Dressage',       stat: 'SAG' }, { name: 'Force',          stat: 'FOR' },
  { name: 'Histoire',       stat: 'INT' }, { name: 'Intimidation',   stat: 'CHA' },
  { name: 'Investigation',  stat: 'INT' }, { name: 'Intelligence',   stat: 'INT' },
  { name: 'Médecine',       stat: 'SAG' }, { name: 'Nature',         stat: 'INT' },
  { name: 'Perception',     stat: 'SAG' }, { name: 'Perspicacité',   stat: 'SAG' },
  { name: 'Persuasion',     stat: 'CHA' }, { name: 'Religion',       stat: 'INT' },
  { name: 'Représentation', stat: 'CHA' }, { name: 'Sagesse',        stat: 'SAG' },
  { name: 'Survie',         stat: 'SAG' }, { name: 'Tromperie',      stat: 'CHA' },
];

const STAT_COLORS = {
  FOR: '#ef4444', DEX: '#22c38e', CON: '#f97316',
  INT: '#4f8cff', SAG: '#a78bfa', CHA: '#ec4899',
  '': 'var(--text-dim)',
};
let _diceSkillsCache = null;

function _getDiceSkills() {
  if (_diceSkillsCache) return _diceSkillsCache;
  try {
    const s = localStorage.getItem('hist_dice_skills');
    if (s) return JSON.parse(s);
  } catch {}
  return DICE_SKILLS_DEFAULT;
}

async function _loadDiceSkills() {
  try {
    const doc = await getDocData('world', 'dice_skills');
    _diceSkillsCache = doc?.skills || null;
    if (!_diceSkillsCache) {
      // Pas encore en base : migrer depuis localStorage ou utiliser les défauts
      try {
        const s = localStorage.getItem('hist_dice_skills');
        _diceSkillsCache = s ? JSON.parse(s) : DICE_SKILLS_DEFAULT;
      } catch { _diceSkillsCache = DICE_SKILLS_DEFAULT; }
    }
  } catch {
    _diceSkillsCache = _getDiceSkills();
  }
  return _diceSkillsCache;
}

async function _saveDiceSkills(skills) {
  _diceSkillsCache = skills;
  try { localStorage.setItem('hist_dice_skills', JSON.stringify(skills)); } catch {}
  try { await saveDoc('world', 'dice_skills', { skills }); } catch {}
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

// Drag & drop gestion des compétences
let _desDragIdx   = null;
let _desDragOverEl = null;

// ── Entrée principale ─────────────────────────────────────────────────────────
async function renderHistoire() {
  const ctx = window._histoireCtx || {};
  _missionId    = ctx.id    || null;
  _missionTitre = ctx.titre || 'Mission';
  _missionActe  = ctx.acte  || '';

  if (!_missionId) {
    document.getElementById('main-content').innerHTML =
      `<div class="empty-state"><div class="icon">📖</div><p>Aucune mission sélectionnée.</p></div>`;
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

  const savedContent = histDoc?.content || '';
  const wordCount    = countRichTextWords(savedContent);

  document.getElementById('main-content').innerHTML = `
    <div class="hist-shell" id="hist-shell">

      <!-- Barre de navigation -->
      <div class="hist-topbar">
        <button class="hist-back" onclick="window.navigate('story')" title="Retour à la Trame">
          <span>←</span> Trame
        </button>
        <div class="hist-topbar-center">
          ${_missionActe ? `<span class="hist-acte-pill">${_missionActe}</span>` : ''}
          <span class="hist-titre">${_missionTitre}</span>
        </div>
        <div class="hist-topbar-actions">
          <button class="hist-handout-btn-top" onclick="window._ouvrirHandout()" title="Aperçu handout joueur">📜 Handout</button>
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
            ['bold', 'italic', 'underline'],
            ['h2', 'h3', 'blockquote'],
            [
              'insertUnorderedList',
              'insertOrderedList',
              'insertHorizontalRule',
            ],
            [
              { type: 'color' },
              { type: 'font' },
              { type: 'size' },
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
            onclick="window._toggleHistSidebar()" title="${_sidebarOpen ? 'Réduire' : 'Développer'}">
            ${_sidebarOpen ? '◀' : '▶'}
          </button>
        </aside>

        <!-- Zone d'écriture -->
        <div class="hist-editor-wrap">
          ${richTextEditableHtml({
            id: 'hist-editor',
            className: 'hist-editor',
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
        <span class="hist-tip">@ tag · <kbd>[</kbd> jet de dé · ⛳ scène</span>
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
        if (_pickerMode === 'dice') window._histDiceSkillSelect(_pickerIdx);
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
    _pickerQuery = text.substring(atIdx + 1).toLowerCase();
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
      _bracketQuery = after.toLowerCase();
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
      .filter(item => !q || item.label.toLowerCase().includes(q))
      .slice(0, 6);
    if (!filtered.length) continue;

    html += `<div class="hist-picker-group">
      <div class="hist-picker-group-label" style="color:${cfg.color}">${cfg.emoji} ${cfg.label}</div>`;
    filtered.forEach(item => {
      const idx = _pickerFlat.length;
      _pickerFlat.push({ type, ...item });
      html += `<div class="hist-picker-item ${idx === _pickerIdx ? 'active' : ''}"
        data-idx="${idx}" style="--tag-color:${cfg.color};--tag-bg:${cfg.bg}"
        onmousedown="event.preventDefault();window._histPickerSelect(${idx})">
        <span class="hist-picker-dot" style="background:${cfg.color}"></span>${item.label}
      </div>`;
    });
    html += `</div>`;
  }

  if (!html) {
    html = `<div class="hist-picker-empty">Aucun résultat pour « ${_pickerQuery || '@'} »</div>`;
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
          <span style="color:#f59e0b">🎲 ${_diceSel.name}</span>
          ${_diceSel.stat ? `<span style="color:${col};font-size:.72rem;font-weight:700;padding:1px 5px;border:1px solid ${col}40;border-radius:4px;background:${col}18">${_diceSel.stat}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:.82rem;color:var(--text-muted)">DD</span>
          <input id="hist-dd-input" type="number" min="1" max="30" value="12"
            style="width:64px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-strong);
            background:var(--bg-card);color:var(--text);font-size:.9rem;outline:none;text-align:center"
            onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();window._histDiceConfirm();}"
          />
          <button onmousedown="event.preventDefault();window._histDiceConfirm()"
            style="padding:4px 12px;border-radius:6px;background:#f59e0b;color:#000;font-size:.82rem;font-weight:600;border:none;cursor:pointer">
            Insérer
          </button>
        </div>
      </div>`;
    setTimeout(() => { const i = document.getElementById('hist-dd-input'); if (i) { i.focus(); i.select(); } }, 30);
    return;
  }

  // Step 1 : liste des compétences
  const q       = _bracketQuery;
  const skills  = _getDiceSkills();
  const filtered = skills.filter(s => !q || s.name.toLowerCase().includes(q));
  _pickerFlat = filtered.map(s => ({ type: 'dice', label: s.name, stat: s.stat }));

  let rows = '';
  if (!filtered.length) {
    rows = `<div class="hist-picker-empty">Aucune compétence correspondante</div>`;
  } else {
    rows = filtered.slice(0, 9).map((s, i) => {
      const col = STAT_COLORS[s.stat] || STAT_COLORS[''];
      return `<div class="hist-picker-item ${i === _pickerIdx ? 'active' : ''}" data-idx="${i}"
        style="--tag-color:#f59e0b;--tag-bg:rgba(245,158,11,.15)"
        onmousedown="event.preventDefault();window._histDiceSkillSelect(${i})">
        <span class="hist-picker-dot" style="background:#f59e0b"></span>
        <span style="flex:1">${s.name}</span>
        ${s.stat ? `<span style="font-size:.68rem;font-weight:700;color:${col};padding:0 4px;border-radius:3px;background:${col}18">${s.stat}</span>` : ''}
      </div>`;
    }).join('');
  }

  inner.innerHTML = `
    <div class="hist-picker-group">
      <div class="hist-picker-group-label" style="color:#f59e0b;display:flex;align-items:center;justify-content:space-between">
        <span>🎲 Jet de dé</span>
        <span class="hist-picker-manage-btn" onmousedown="event.preventDefault();window._ouvrirGestionDes()">⚙️ Gérer</span>
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

// Globaux picker
window._histPickerSelect    = (idx) => _pickerSelect(_pickerFlat[idx]);
window._histDiceSkillSelect = (idx) => {
  const item = _pickerFlat[idx];
  if (!item) return;
  _diceSel    = { name: item.label, stat: item.stat ?? '' };
  // ⚠️ Sauvegarder la position de fin AVANT que le focus quitte l'éditeur
  _bracketEnd = _bracketStart
    ? _bracketStart.bracketIndex + 1 + _bracketQuery.length
    : 0;
  _renderDicePickerContent();
};
window._histDiceConfirm = () => {
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
    return `<a href="#" class="hist-toc-link"
      onclick="event.preventDefault();document.getElementById('hist-scene-${i}')?.scrollIntoView({behavior:'smooth',block:'center'})"
    >${label}</a>`;
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
        onclick="window._switchHistMission('${m.id}','${(m.titre||'').replace(/'/g,"\\'")}','${acte.replace(/'/g,"\\'")}')">
        <span class="hist-sb-item-title">${m.titre || '(sans titre)'}</span>
      </button>`;
    }).join('');

    return `<div class="hist-sb-group">
      <div class="hist-sb-acte${isCurrentActe ? ' hist-sb-acte--active' : ''}">${acte}</div>
      ${rows}
    </div>`;
  }).join('');
}

window._toggleHistSidebar = function () {
  _sidebarOpen = !_sidebarOpen;
  const sb  = document.getElementById('hist-sidebar');
  const btn = document.getElementById('hist-sidebar-toggle');
  if (!sb || !btn) return;
  sb.classList.toggle('hist-sidebar--closed', !_sidebarOpen);
  btn.textContent = _sidebarOpen ? '◀' : '▶';
  btn.title       = _sidebarOpen ? 'Réduire' : 'Développer';
};

window._switchHistMission = async function (id, titre, acte) {
  if (id === _missionId) return;
  // Sauvegarder l'histoire courante avant de changer
  clearTimeout(_saveTimer);
  await _saveNow();

  _missionId    = id;
  _missionTitre = titre;
  _missionActe  = acte;
  window._histoireCtx = { id, titre, acte };

  // Mettre à jour la topbar
  const pill  = document.querySelector('.hist-acte-pill');
  const titre_el = document.querySelector('.hist-titre');
  if (pill)    pill.textContent   = acte;
  if (titre_el) titre_el.textContent = titre;

  // Charger et afficher le nouveau contenu
  const editor = document.getElementById('hist-editor');
  if (editor) editor.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:2rem;font-size:.9rem">Chargement…</div>';

  const histDoc = await getDocData('story_histories', id).catch(() => null);
  if (editor) {
    editor.innerHTML = histDoc?.content || '';
    editor.focus();
  }

  _setSaveStatus('saved');
  _updateWordCount();
  _updateToc();

  // Mettre à jour la sidebar (surlignage)
  const sbInner = document.querySelector('.hist-sidebar-inner');
  if (sbInner) sbInner.innerHTML = _renderSidebarMissions();
};

// ── Gestion des compétences ───────────────────────────────────────────────────
window._ouvrirGestionDes = function () {
  document.getElementById('hist-des-modal')?.remove();
  _closePicker();
  _renderGestionDes();
};

// Template d'une ligne de compétence (drag + stat buttons + delete)
function _renderDesRow(s, i) {
  const STATS = ['', 'FOR', 'DEX', 'CON', 'INT', 'SAG', 'CHA'];
  const statBtns = STATS.map(st => {
    const col    = STAT_COLORS[st] || 'var(--text-dim)';
    const active = st === s.stat;
    return `<button class="hist-des-stat-btn${active ? ' active' : ''}"
      ${active ? `style="background:${col}20;color:${col};border-color:${col}60"` : ''}
      onmousedown="event.preventDefault()"
      onclick="window._gestionDesEditStat(${i},'${st}')"
    >${st || '—'}</button>`;
  }).join('');

  return `<div class="hist-des-row" draggable="true"
    ondragstart="window._desDragStart(${i})"
    ondragenter="event.preventDefault();window._desDragEnter(this)"
    ondragover="event.preventDefault()"
    ondragleave="window._desDragLeave(this,event)"
    ondrop="event.preventDefault();window._desDrop(${i})">
    <span class="hist-des-drag-handle" title="Glisser pour réordonner">⠿</span>
    <span class="hist-des-name">${s.name}</span>
    <div class="hist-des-stats">${statBtns}</div>
    <button class="hist-des-del" onclick="window._gestionDesDel(${i})" title="Supprimer">✕</button>
  </div>`;
}

function _renderGestionDes() {
  const skills  = _getDiceSkills();
  const STATS   = ['', 'FOR', 'DEX', 'CON', 'INT', 'SAG', 'CHA'];
  const statOpts = STATS.map(st => `<option value="${st}">${st || '—'}</option>`).join('');

  const modal = document.createElement('div');
  modal.id = 'hist-des-modal';
  modal.innerHTML = `
    <div class="hist-des-backdrop" onclick="document.getElementById('hist-des-modal')?.remove()"></div>
    <div class="hist-des-panel">
      <div class="hist-des-header">
        <span>🎲 Compétences &amp; caractéristiques</span>
        <div style="display:flex;gap:6px">
          <button class="hist-des-btn" onclick="window._resetDiceSkills()" title="Rétablir les compétences par défaut">↺ Réinitialiser</button>
          <button class="hist-des-btn hist-des-btn--close" onclick="document.getElementById('hist-des-modal')?.remove()">✕</button>
        </div>
      </div>
      <div class="hist-des-body">
        <div class="hist-des-list" id="hist-des-list">${skills.map(_renderDesRow).join('')}</div>
        <div class="hist-des-add">
          <input id="hist-des-new-name" class="hist-des-input" placeholder="Nouvelle compétence…" />
          <select id="hist-des-new-stat" class="hist-des-new-stat-sel">${statOpts}</select>
          <button class="hist-des-btn hist-des-btn--add" onclick="window._gestionDesAdd()">+ Ajouter</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('hist-des-visible'), 10);
}

function _refreshGestionDesList() {
  const list = document.getElementById('hist-des-list');
  if (!list) return;
  list.innerHTML = _getDiceSkills().map(_renderDesRow).join('');
}

window._gestionDesEditStat = (idx, stat) => {
  const skills = _getDiceSkills();
  if (!skills[idx]) return;
  skills[idx].stat = stat;
  _saveDiceSkills(skills);
  _refreshGestionDesList();
};

// Drag & drop
window._desDragStart = (idx) => { _desDragIdx = idx; };
window._desDragEnter = (el) => {
  if (_desDragOverEl) _desDragOverEl.classList.remove('hist-des-drag-over');
  _desDragOverEl = el;
  el.classList.add('hist-des-drag-over');
};
window._desDragLeave = (el, e) => {
  if (!el.contains(e.relatedTarget)) {
    el.classList.remove('hist-des-drag-over');
    if (_desDragOverEl === el) _desDragOverEl = null;
  }
};
window._desDrop = (targetIdx) => {
  if (_desDragOverEl) { _desDragOverEl.classList.remove('hist-des-drag-over'); _desDragOverEl = null; }
  if (_desDragIdx === null || _desDragIdx === targetIdx) { _desDragIdx = null; return; }
  const skills = _getDiceSkills();
  const [item] = skills.splice(_desDragIdx, 1);
  skills.splice(targetIdx, 0, item);
  _saveDiceSkills(skills);
  _desDragIdx = null;
  _refreshGestionDesList();
};

window._gestionDesDel = (idx) => {
  const skills = _getDiceSkills();
  skills.splice(idx, 1);
  _saveDiceSkills(skills);
  _refreshGestionDesList();
};

window._gestionDesAdd = () => {
  const nameInput = document.getElementById('hist-des-new-name');
  const statInput = document.getElementById('hist-des-new-stat');
  const name = nameInput?.value.trim();
  if (!name) { nameInput?.focus(); return; }
  const skills = _getDiceSkills();
  skills.push({ name, stat: statInput?.value || '' });
  _saveDiceSkills(skills);
  if (nameInput) nameInput.value = '';
  if (statInput) statInput.value = '';
  _refreshGestionDesList();
  nameInput?.focus();
};

window._resetDiceSkills = () => {
  if (!confirm('Rétablir la liste par défaut ? Les modifications seront perdues.')) return;
  _saveDiceSkills(DICE_SKILLS_DEFAULT);
  _refreshGestionDesList();
};

// ── Handout joueur ────────────────────────────────────────────────────────────
window._ouvrirHandout = function () {
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

  const content   = clone.innerHTML;
  const wordCount = countRichTextWords(content);

  document.getElementById('hist-handout-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'hist-handout-modal';
  modal.innerHTML = `
    <div class="hist-handout-backdrop" onclick="document.getElementById('hist-handout-modal')?.remove()"></div>
    <div class="hist-handout-panel">
      <div class="hist-handout-header">
        <div>
          ${_missionActe ? `<div class="hist-handout-acte">${_missionActe}</div>` : ''}
          <div class="hist-handout-title">${_missionTitre}</div>
          <div class="hist-handout-meta">${wordCount} mot${wordCount !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0">
          <button class="hist-handout-action" onclick="window._histHandoutCopy()">📋 Copier le texte</button>
          <button class="hist-handout-action hist-handout-close" onclick="document.getElementById('hist-handout-modal')?.remove()">✕</button>
        </div>
      </div>
      <div class="hist-handout-body">${content}</div>
    </div>`;

  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('hist-handout-visible'), 10);
};

window._histHandoutCopy = () => {
  const body = document.querySelector('.hist-handout-body');
  if (!body) return;
  navigator.clipboard.writeText(body.innerText)
    .then(() => showNotif('Texte copié dans le presse-papiers !', 'success'))
    .catch(()  => showNotif('Copie impossible.', 'error'));
};

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
      content:      editor.innerHTML,
      missionId:    _missionId,
      missionTitre: _missionTitre,
      updatedAt:    new Date().toISOString(),
    });
    invalidateCache('story_histories');
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

// Préchauffage du cache des compétences dès le chargement du module
_loadDiceSkills();
