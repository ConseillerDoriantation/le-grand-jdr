// ══════════════════════════════════════════════════════════════════════════════
// CHARACTERS / JOURNAL.JS — Onglet « Journal » (Notes / Quêtes / Relations)
//
// Extrait de characters.js. Trois sous-onglets partageant le même conteneur.
// Re-render via le seam charSession.renderTab('journal', …) (équivalent à
// _renderTabV3('journal', …) — 'journal' ∈ V3_TABS ; le routeur lit le sous-onglet
// courant via getCurrentJournalSub()).
//
// Exporte : renderCharJournal (routeur), _bindNotesDnd / _bindQuetesDnd (appelés
// par le routeur après rendu), getCurrentJournalSub, et les handlers câblés par
// characters.js (registre data-action / data-change / data-blur).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { updateInCol } from '../../data/firestore.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import {
  openModal, closeModalDirect, confirmModal,
  setModalCloseGuard, clearModalCloseGuard,
} from '../../shared/modal.js';
import { makeSortable } from '../../shared/sortable-helper.js';
import { quillEditorHtml, bindQuillEditors } from '../../shared/rich-text-quill.js';
import { saveNote, scheduleNoteAutosave } from './tabs.js';
import { richTextContentHtml } from '../../shared/rich-text.js';
// Échelle partagée Relations / PNJ (clés historiques conservées) :
// {k:'ennemi',lbl:'Hostile'}, {k:'mefiance',lbl:'Méfiant'}, {k:'neutre',lbl:'Neutre'},
// {k:'allie',lbl:'Amical'}, {k:'lien',lbl:'Allié'}.
import {
  renderCharRelations, relationPendingCount, bindRelationKeyboard,
  _csV3AddRelation, _csRelCloseAdd, _csRelSearch, _csRelAddSearch, _csRelLinkSearch,
  _csRelClearSearch, _csRelReset, _csRelFilter, _csRelSort, _csRelToggle,
  _csRelSetLevel, _csRelSuggestion, _csRelFieldInput, _csRelFieldBlur,
  _csRelDelete, _csRelPick, _csRelRespond, _csRelPickFree, _csRelLink,
} from './relations.js';

// État module-local (préservé au re-render, comme dans characters.js)
let _currentJournalSub = 'notes';
let _openNote = null;
let _closingNoteModal = false;
bindRelationKeyboard();

// Sous-onglet Journal courant — lu par le routeur d'onglets de characters.js.
export function getCurrentJournalSub() { return _currentJournalSub; }

// Catégories de note (puce colorée façon maquette). Cycle au clic.
const _NOTE_CATS = {
  notes: { lbl: 'NOTES', cls: '' },
  lore:  { lbl: 'LORE',  cls: 'lore' },
  pnj:   { lbl: 'PNJ',   cls: 'pnj' },
  lieu:  { lbl: 'LIEU',  cls: 'lieu' },
  objet: { lbl: 'OBJET', cls: 'objet' },
};
const _NOTE_CAT_CYCLE = ['', 'notes', 'lore', 'pnj', 'lieu', 'objet'];

async function _csV3CycleNoteCat(idx) {
  await _flushOpenNote();
  const c = charSession.getCurrentChar(); if (!c) return;
  const notes = Array.isArray(c.notesList) ? [...c.notesList] : [];
  const n = notes[idx]; if (!n) return;
  const cur = n.categorie || '';
  notes[idx] = { ...n, categorie: _NOTE_CAT_CYCLE[(_NOTE_CAT_CYCLE.indexOf(cur) + 1) % _NOTE_CAT_CYCLE.length] };
  c.notesList = notes;
  _currentJournalSub = 'notes';
  charSession.renderTab('journal', c, charSession.getCanEditChar());
  try { await updateInCol('characters', c.id, { notesList: notes }); }
  catch (e) { console.error('[note cat]', e); showNotif('Erreur d\'enregistrement.', 'error'); }
}

function renderCharJournal(c, canEdit, sub = 'notes') {
  const subTab = ['notes','quetes','relations'].includes(sub) ? sub : 'notes';
  const pendingCount = relationPendingCount(c, canEdit);
  const counts = {
    notes:     (c.notesList || []).length,
    quetes:    (c.quetes || []).length,
    relations: (c.relations || []).length,
  };
  const bodyHtml = subTab === 'notes'     ? renderCharNotesV3(c, canEdit)
                : subTab === 'quetes'    ? renderJournalQuetes(c, canEdit)
                : renderCharRelations(c, canEdit);
  const actionHtml = !canEdit ? ''
    : subTab === 'notes'
      ? `<button type="button" class="section-action journal-add" data-action="csV3AddNote"><span>＋</span> Nouvelle note</button>`
      : subTab === 'quetes'
        ? `<button type="button" class="section-action journal-add" data-action="addQuete"><span>＋</span> Nouvelle quête</button>`
        : `<button type="button" class="section-action journal-add" data-action="csV3AddRelation" data-id="${c.id}"><span>＋</span> Nouvelle relation</button>`;

  return `<section class="journal-shell">
    <header class="journal-toolbar">
      <nav class="journal-tabs" aria-label="Sections du journal">
        <button type="button" class="journal-tab ${subTab==='notes'?'on':''}" ${subTab==='notes'?'aria-current="page"':''} data-action="csV3JournalSub" data-sub="notes">
          <span class="journal-tab-icon">📝</span><span>Notes</span><span class="journal-tab-count">${counts.notes}</span>
        </button>
        <button type="button" class="journal-tab ${subTab==='quetes'?'on':''}" ${subTab==='quetes'?'aria-current="page"':''} data-action="csV3JournalSub" data-sub="quetes">
          <span class="journal-tab-icon">📜</span><span>Quêtes</span><span class="journal-tab-count">${counts.quetes}</span>
        </button>
        <button type="button" class="journal-tab ${subTab==='relations'?'on':''}" ${subTab==='relations'?'aria-current="page"':''} data-action="csV3JournalSub" data-sub="relations">
          <span class="journal-tab-icon">👥</span><span>Relations</span><span class="journal-tab-count">${counts.relations}</span>${pendingCount ? `<span class="journal-tab-pending" title="${pendingCount} lien${pendingCount > 1 ? 's' : ''} sans réponse">${pendingCount}</span>` : ''}
        </button>
      </nav>
      ${actionHtml}
    </header>
    <div id="journal-body" class="journal-body">${bodyHtml}</div>
  </section>`;
}

async function _csV3JournalSub(sub) {
  if (_currentJournalSub === 'notes' && sub !== 'notes') await _flushOpenNote();
  _currentJournalSub = sub;
  const c = charSession.getCurrentChar(); const canEdit = charSession.getCanEditChar();
  if (!c) return;
  // Rebuild juste l'onglet Journal sans recharger toute la fiche
  const area = document.getElementById('char-tab-content');
  if (area) {
    area.innerHTML = renderCharJournal(c, canEdit, sub);
    if (sub === 'notes') { bindQuillEditors(area, { onUserEdit: scheduleNoteAutosave }); _bindNotesDnd(c, canEdit); }
    if (sub === 'quetes') _bindQuetesDnd(c, canEdit);
    area.querySelector(`.journal-tab[data-sub="${sub}"]`)?.focus({ preventScroll: true });
  }
}

// Quêtes — schéma réel : { nom, type, description, valide }
function renderJournalQuetes(c, canEdit) {
  const quetes = c.quetes || [];
  if (!quetes.length) {
    return `<div class="journal-empty">
      <span class="journal-empty-icon">📜</span>
      <h3>Aucune quête dans ce journal</h3>
      <p>${canEdit ? 'Ajoute un objectif, une piste ou une mission pour commencer le suivi.' : 'Les quêtes de ce personnage apparaîtront ici.'}</p>
      ${canEdit ? '<button type="button" class="section-action" data-action="addQuete">＋ Ajouter une quête</button>' : ''}
    </div>`;
  }
  const enCours  = quetes.filter(q => !q.valide);
  const validees = quetes.filter(q => q.valide);
  const card = (q) => {
    const idx = quetes.indexOf(q);
    const validee = !!q.valide;
    const urgent = !!q.urgent && !validee;
    const stateIco = validee
      ? `<span class="quest-state done" title="Validée">✓</span>`
      : urgent
        ? `<span class="quest-state urgent" title="Urgente">⚠</span>`
        : `<span class="quest-state open" title="En cours">⚔</span>`;
    return `<article class="quest ${validee?'done':''}${urgent?' is-urgent':''}${canEdit?' is-draggable':''}" data-quest-idx="${idx}">
      <header class="quest-head">
        <div class="quest-name-wrap">
          ${stateIco}
          <div class="quest-body">
            <h4 class="quest-name">${_esc(q.nom || 'Quête sans nom')}</h4>
            ${q.type || q.contexte ? `<div class="quest-meta-row">
              ${q.type ? `<span class="quest-type">${_esc(q.type)}</span>` : ''}
              ${q.contexte ? `<span class="quest-context">${_esc(q.contexte)}</span>` : ''}
            </div>` : ''}
          </div>
        </div>
        <div class="quest-head-right">
          ${canEdit ? `<div class="quest-actions">
            <button class="btn-icon" data-action="toggleQuete" data-idx="${idx}" title="${validee?'Rouvrir':'Marquer comme validée'}">${validee?'↺':'✔️'}</button>
            <button class="btn-icon" data-action="editQuete" data-idx="${idx}" title="Modifier">✏️</button>
            <button class="btn-icon" data-action="deleteQuete" data-idx="${idx}" title="Supprimer" style="color:#ff8ca7">🗑️</button>
          </div>` : ''}
        </div>
      </header>
      ${q.description ? `<p class="quest-desc">${_esc(q.description)}</p>` : ''}
      <footer class="quest-footer">
        <span class="quest-status-text ${validee ? 'done' : urgent ? 'urgent' : 'open'}">${validee ? 'Quête accomplie' : urgent ? 'Priorité urgente' : 'Objectif en cours'}</span>
        ${q.recompense ? `<span class="quest-reward"><span>Récompense</span> 🎁 ${_esc(q.recompense)}</span>` : ''}
      </footer>
    </article>`;
  };
  return `<div class="quest-board">
    <section class="quest-block quest-block--active">
      <header class="quest-section-head">
        <span class="quest-section-icon">⚔️</span>
        <span class="quest-section-copy"><span class="q-lbl">En cours</span><small>Objectifs suivis par le personnage</small></span>
        <span class="q-count">${enCours.length}</span>
      </header>
      <div class="quest-list" data-quest-list="open">
        ${enCours.length ? enCours.map(card).join('') : '<div class="quest-column-empty"><span>✓</span><p>Aucune quête en cours.</p></div>'}
      </div>
    </section>
    <section class="quest-block quest-block--done">
      <header class="quest-section-head">
        <span class="quest-section-icon is-done">✓</span>
        <span class="quest-section-copy"><span class="q-lbl done">Accomplies</span><small>Étapes terminées de l'aventure</small></span>
        <span class="q-count">${validees.length}</span>
      </header>
      <div class="quest-list" data-quest-list="done">
        ${validees.length ? validees.map(card).join('') : '<div class="quest-column-empty"><span>◇</span><p>Aucune quête accomplie.</p></div>'}
      </div>
    </section>
  </div>`;
}

// Pendant un tri, coupe le survol (translateY) des cartes croisées : il entrait en
// conflit avec l'animation de Sortable et faisait tressauter la liste.
function _markSorting(evt, on = true) {
  evt.from?.closest('.quest-board, .notes-stack')?.classList.toggle('is-sorting', on);
}

// ── Drag & drop des quêtes (SortableJS) ───────────────────────────────────────
// Deux listes (En cours / Validées) partagent le même `group` → on réordonne ET
// on bascule l'état validé en glissant une quête d'une liste à l'autre.
let _questsSortables = [];
function _bindQuetesDnd(c, canEdit) {
  _questsSortables.forEach(s => { try { s.destroy(); } catch {} });
  _questsSortables = [];
  if (!canEdit) return;
  const area = document.getElementById('char-tab-content'); if (!area) return;
  area.querySelectorAll('.quest-list').forEach(list => {
    _questsSortables.push(makeSortable(list, {
      ghostClass: 'cs-quete-ghost',
      chosenClass: 'cs-quete-chosen',
      dragClass: 'cs-quete-drag',
      group: 'cs-quetes',
      animation: 160,
      draggable: '.quest',
      filter: '.btn-icon, .q-empty',
      // Garde le clone dans .cs-v3 : les cartes sont stylées via cet ancêtre, sinon
      // le clone (déplacé dans <body>) perd toute son apparence pendant le drag.
      fallbackOnBody: false,
      onStart: _markSorting,
      onEnd: (evt) => { _markSorting(evt, false); _onQuetesReordered(c); },
    }));
  });
}
async function _onQuetesReordered(c) {
  const area = document.getElementById('char-tab-content'); if (!area) return;
  const old = Array.isArray(c.quetes) ? c.quetes : [];
  const next = [];
  // Première liste = « En cours » (valide=false), seconde = « Validées » (valide=true).
  area.querySelectorAll('.quest-list').forEach(list => {
    const valide = list.dataset.questList === 'done';
    list.querySelectorAll('.quest[data-quest-idx]').forEach(el => {
      const q = old[parseInt(el.dataset.questIdx)];
      if (q) next.push({ ...q, valide });
    });
  });
  // Garde-fou : si on n'a pas retrouvé toutes les quêtes, on annule (re-render).
  if (next.length !== old.length) { _csV3JournalSub('quetes'); return; }
  c.quetes = next;
  try { await updateInCol('characters', c.id, { quetes: next }); }
  catch (e) { console.error('[quetes reorder]', e); showNotif('Erreur d\'enregistrement.', 'error'); }
  _csV3JournalSub('quetes');
}

// Relations — liste éditable
// Notes V3 — édition inline du titre + cards repliables + rich-text body
function _noteExcerpt(html = '', maxLength = 180) {
  const scratch = document.createElement('div');
  scratch.innerHTML = String(html);
  const text = (scratch.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function _notePresentation(note = {}, index, canEdit) {
  const titre = note.titre || 'Note sans titre';
  const date = note.date || '';
  const catM = _NOTE_CATS[note.categorie];
  const catKey = catM ? note.categorie : 'none';
  const excerpt = _noteExcerpt(note.contenu || '');
  const marker = catKey === 'lore' ? '✦'
    : catKey === 'pnj' ? '♟'
    : catKey === 'lieu' ? '⌖'
    : catKey === 'objet' ? '◆'
    : '✎';
  const tag = canEdit
    ? `<button class="note-v3-tag ${catM ? catM.cls : 'is-empty'}" data-action="csV3CycleNoteCat" data-idx="${index}" data-stop-propagation title="Catégorie — cliquer pour changer">${catM ? catM.lbl : '＋ tag'}</button>`
    : (catM ? `<span class="note-v3-tag ${catM.cls}">${catM.lbl}</span>` : '');
  return { titre, date, catKey, excerpt, marker, tag };
}

function _renderNoteOverview(note, index, canEdit) {
  const view = _notePresentation(note, index, canEdit);
  // Titre affiché en entier (2 lignes max) dans la zone cliquable ; il s'édite
  // dans la note ouverte (modale), un <input> ne pouvant pas passer à la ligne.
  return `<article class="note-v3 note-v3--${view.catKey}${canEdit ? ' is-draggable' : ''}" data-note-idx="${index}">
    <header class="note-v3-head">
      ${canEdit ? '<span class="note-v3-drag" title="Glisser pour réordonner">⠿</span>' : ''}
      <span class="note-v3-marker" aria-hidden="true">${view.marker}</span>
      ${view.tag}
      ${view.date ? `<span class="note-v3-date">${_esc(view.date)}</span>` : ''}
      <span class="note-v3-head-acts">
        ${canEdit ? `<button class="note-v3-del" data-action="csV3DeleteNote" data-idx="${index}" data-stop-propagation title="Supprimer">🗑️</button>` : ''}
        <button class="note-v3-toggle" data-action="csV3ToggleNote" data-idx="${index}" title="Ouvrir" aria-expanded="false">⌄</button>
      </span>
    </header>
    <button type="button" class="note-v3-preview" data-action="csV3ToggleNote" data-idx="${index}">
      <span class="note-v3-titre" title="${_esc(view.titre)}">${_esc(view.titre)}</span>
      <span class="note-v3-preview-text ${view.excerpt ? '' : 'is-empty'}">${view.excerpt ? _esc(view.excerpt) : 'Cette note ne contient encore aucun texte.'}</span>
      <span class="note-v3-read">Ouvrir <span>›</span></span>
    </button>
  </article>`;
}

function _renderNoteModal(note, index, canEdit) {
  const view = _notePresentation(note, index, canEdit);
  const catM = _NOTE_CATS[note.categorie];
  return `<div class="cs-v3 note-modal-shell note-v3--${view.catKey}">
    <div class="note-modal-summary">
      <span class="note-v3-marker" aria-hidden="true">${view.marker}</span>
      <div class="note-modal-heading">
        <span class="note-modal-kicker">${catM ? catM.lbl : 'NOTE'}${view.date ? ` · ${_esc(view.date)}` : ''}</span>
        ${canEdit
          ? `<input id="note-modal-title-${index}" class="note-modal-title" type="text" value="${_esc(view.titre)}"
              data-enter="blur" data-esc="revert-blur" placeholder="Titre de la note" autocomplete="off">`
          : `<h3 class="note-modal-title-ro">${_esc(view.titre)}</h3>`}
      </div>
      ${catM ? `<span class="note-v3-tag ${catM.cls}">${catM.lbl}</span>` : ''}
    </div>
    <div class="note-modal-content">
      <div class="note-modal-content-head">
        <span>Contenu</span>
        ${canEdit ? '<small>Enregistrement automatique</small>' : ''}
      </div>
      ${canEdit
        ? quillEditorHtml({ id: `note-area-${index}`, html: note.contenu || '', placeholder: 'Écris ta note ici…', minHeight: 340 })
        : richTextContentHtml({ html: note.contenu, className: 'note-modal-reading', fallback: '<em style="opacity:.5">Aucun contenu.</em>' })}
    </div>
    <footer class="note-modal-footer">
      <span>${canEdit ? 'Les changements sont conservés en fermant la note.' : (view.date ? `Note du ${_esc(view.date)}` : '')}</span>
      <div>
        <button type="button" class="btn btn-outline btn-sm" data-action="csV3CloseNote">Fermer</button>
        ${canEdit ? `<button type="button" class="btn btn-gold btn-sm" data-action="csV3SaveOpenNote">💾 Enregistrer</button>` : ''}
      </div>
    </footer>
  </div>`;
}

function renderCharNotesV3(c, canEdit) {
  const notes = c.notesList || [];
  if (!notes.length) {
    return `<div class="journal-empty">
      <span class="journal-empty-icon">📝</span>
      <h3>Le carnet est encore vierge</h3>
      <p>${canEdit ? 'Consigne ici les indices, rencontres et souvenirs importants.' : 'Les notes de ce personnage apparaîtront ici.'}</p>
      ${canEdit ? '<button type="button" class="section-action" data-action="csV3AddNote">＋ Écrire une note</button>' : ''}
    </div>`;
  }
  return `<div class="notes-stack notes-stack--gallery">${notes.map((note, index) => _renderNoteOverview(note, index, canEdit)).join('')}</div>`;
}

// ── Drag & drop des notes (SortableJS) ────────────────────────────────────────
// Poignée ⠿ dans l'en-tête (n'interfère pas avec l'édition du titre/contenu).
let _notesSortable = null;
function _bindNotesDnd(c, canEdit) {
  try { _notesSortable?.destroy(); } catch {}
  _notesSortable = null;
  if (!canEdit) return;
  const area = document.getElementById('char-tab-content'); if (!area) return;
  const stack = area.querySelector('.notes-stack'); if (!stack) return;
  _notesSortable = makeSortable(stack, {
    ghostClass: 'cs-note-ghost',
    chosenClass: 'cs-note-chosen',
    dragClass: 'cs-note-drag',
    handle: '.note-v3-drag',
    draggable: '.note-v3',
    animation: 160,
    // Garde le clone dans .cs-v3 (cartes stylées via cet ancêtre) → conserve son
    // apparence pendant le drag au lieu de devenir un bloc nu.
    fallbackOnBody: false,
    onStart: _markSorting,
    onEnd: (evt) => { _markSorting(evt, false); _onNotesReordered(c); },
  });
}
async function _onNotesReordered(c) {
  const area = document.getElementById('char-tab-content'); if (!area) return;
  const stack = area.querySelector('.notes-stack'); if (!stack) return;
  const old = Array.isArray(c.notesList) ? c.notesList : [];
  const next = [];
  stack.querySelectorAll('.note-v3[data-note-idx]').forEach(el => {
    const n = old[parseInt(el.dataset.noteIdx)];
    if (n) next.push(n);
  });
  if (next.length !== old.length) { _currentJournalSub = 'notes'; charSession.renderTab('journal', c, charSession.getCanEditChar()); return; }
  c.notesList = next;
  _openNote = null; // les index ont changé → on replie tout
  try { await updateInCol('characters', c.id, { notesList: next }); }
  catch (e) { console.error('[notes reorder]', e); showNotif('Erreur d\'enregistrement.', 'error'); }
  _currentJournalSub = 'notes';
  charSession.renderTab('journal', c, charSession.getCanEditChar());
}

async function _flushOpenNote() {
  if (!Number.isInteger(_openNote)) return;
  const c = charSession.getCurrentChar();
  const note = c?.notesList?.[_openNote];
  const editor = document.getElementById(`note-area-${_openNote}`);
  if (!note || !editor) return;
  const titleInput = document.getElementById(`note-modal-title-${_openNote}`);
  const nextTitle = titleInput?.value.trim() || 'Note sans titre';
  const titleChanged = !!titleInput && note.titre !== nextTitle;
  const contentChanged = editor.closest('.rtq-wrap')?.dataset.quillDirty === 'true';
  if (titleChanged) {
    note.titre = nextTitle;
    _syncCharNotes(c);
  }
  if (!titleChanged && !contentChanged) return;
  await saveNote(_openNote, { silent: true });
}

function _openNoteModal(c, idx, canEdit) {
  const note = c?.notesList?.[idx];
  if (!note) return;
  _openNote = idx;
  openModal('📝 Note du journal', _renderNoteModal(note, idx, canEdit), {
    subtitle: c.nom || 'Personnage',
    accent: '#6d9fff',
  });
  setModalCloseGuard(() => {
    _csV3CloseNote();
    return true;
  });
  if (canEdit) {
    requestAnimationFrame(() => {
      const body = document.getElementById('modal-body');
      if (body) bindQuillEditors(body, { onUserEdit: scheduleNoteAutosave });
    });
  }
}

async function _csV3ToggleNote(idx) {
  await _flushOpenNote();
  const c = charSession.getCurrentChar(); if (!c) return;
  _openNoteModal(c, idx, charSession.getCanEditChar());
}

async function _csV3SaveOpenNote() {
  if (!Number.isInteger(_openNote)) return;
  await _flushOpenNote();
  showNotif('Note enregistrée.', 'success');
}

function _refreshNoteOverview(idx, note) {
  const card = document.querySelector(`#char-tab-content .note-v3[data-note-idx="${idx}"]`);
  if (!card || !note) return;
  const title = note.titre || 'Note sans titre';
  const titleEl = card.querySelector('.note-v3-titre');
  if (titleEl) { titleEl.textContent = title; titleEl.title = title; }
  const excerpt = _noteExcerpt(note.contenu || '');
  const preview = card.querySelector('.note-v3-preview-text');
  if (preview) {
    preview.textContent = excerpt || 'Cette note ne contient encore aucun texte.';
    preview.classList.toggle('is-empty', !excerpt);
  }
}

async function _csV3CloseNote() {
  if (_closingNoteModal) return;
  _closingNoteModal = true;
  const closingIdx = _openNote;
  try { await _flushOpenNote(); }
  finally {
    const c = charSession.getCurrentChar();
    _refreshNoteOverview(closingIdx, c?.notesList?.[closingIdx]);
    _openNote = null;
    clearModalCloseGuard();
    closeModalDirect();
    _closingNoteModal = false;
  }
}

async function _csV3AddNote() {
  await _flushOpenNote();
  const c = charSession.getCurrentChar(); if (!c) return;
  const notes = Array.isArray(c.notesList) ? [...c.notesList] : [];
  notes.push({ titre: 'Nouvelle note', contenu: '', date: new Date().toLocaleDateString('fr-FR') });
  c.notesList = notes;
  _syncCharNotes(c);
  _openNote = notes.length - 1;
  _currentJournalSub = 'notes';
  charSession.renderTab('journal', c, charSession.getCanEditChar());
  _openNoteModal(c, _openNote, charSession.getCanEditChar());
  try { await updateInCol('characters', c.id, { notesList: notes }); }
  catch (e) { console.error('[note add]', e); showNotif('Erreur lors de la création de la note.', 'error'); }
}

async function _csV3DeleteNote(idx) {
  const c = charSession.getCurrentChar();
  if (!c?.notesList?.[idx]) return;
  if (!await confirmModal(`Supprimer la note <b>${_esc(c.notesList[idx].titre || 'sans titre')}</b> ?`, {
    title: 'Supprimer la note', confirmLabel: 'Supprimer', icon: '🗑️', danger: true,
  })) return;
  if (_openNote !== idx) await _flushOpenNote();
  const notes = [...c.notesList];
  notes.splice(idx, 1);
  c.notesList = notes;
  _syncCharNotes(c);
  if (_openNote === idx) _openNote = null;
  else if (Number.isInteger(_openNote) && idx < _openNote) _openNote -= 1;
  _currentJournalSub = 'notes';
  charSession.renderTab('journal', c, charSession.getCanEditChar());
  try {
    await updateInCol('characters', c.id, { notesList: notes });
    showNotif('Note supprimée.', 'success');
  } catch (e) { console.error('[note delete]', e); showNotif('Erreur lors de la suppression.', 'error'); }
}
// Aligne la liste de notes sur la référence de perso que le rendu relit
// (getCurrentChar) + l'entrée du cache STATE.characters. Sans ça, un re-render
// (ouvrir/replier une note) relisait un ancien objet et le titre/contenu
// « revenait » tant qu'on n'avait pas rechargé la page.
function _syncCharNotes(c) {
  if (!c?.id) return;
  const cur = charSession.getCurrentChar();
  if (cur && cur !== c && cur.id === c.id) cur.notesList = c.notesList;
  const inList = (STATE.characters || []).find(x => x.id === c.id);
  if (inList && inList !== c) inList.notesList = c.notesList;
}

export {
  renderCharJournal,
  _bindNotesDnd, _bindQuetesDnd,
  _csV3JournalSub, _csV3ToggleNote, _csV3AddNote, _csV3DeleteNote,
  _csV3SaveOpenNote, _csV3CloseNote,
  _csV3CycleNoteCat,
};

export {
  _csV3AddRelation, _csRelCloseAdd, _csRelSearch, _csRelAddSearch, _csRelLinkSearch,
  _csRelClearSearch, _csRelReset, _csRelFilter, _csRelSort, _csRelToggle,
  _csRelSetLevel, _csRelSuggestion, _csRelFieldInput, _csRelFieldBlur,
  _csRelDelete, _csRelPick, _csRelRespond, _csRelPickFree, _csRelLink,
};
