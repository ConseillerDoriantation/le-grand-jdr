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
import { updateInCol, loadCollection } from '../../data/firestore.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { getCharacterById } from '../../shared/character-state.js';
import {
  openModal, closeModalDirect, confirmModal,
  setModalCloseGuard, clearModalCloseGuard,
} from '../../shared/modal.js';
import { makeSortable } from '../../shared/sortable-helper.js';
import { quillEditorHtml, bindQuillEditors } from '../../shared/rich-text-quill.js';
import { saveNote, scheduleNoteAutosave } from './tabs.js';
import { richTextContentHtml } from '../../shared/rich-text.js';

// État module-local (préservé au re-render, comme dans characters.js)
let _currentJournalSub = 'notes';
let _openNote = null;
let _closingNoteModal = false;

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
          <span class="journal-tab-icon">👥</span><span>Relations</span><span class="journal-tab-count">${counts.relations}</span>
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
      group: 'cs-quetes',
      animation: 160,
      draggable: '.quest',
      filter: '.btn-icon, .q-empty',
      // Garde le clone dans .cs-v3 : les cartes sont stylées via cet ancêtre, sinon
      // le clone (déplacé dans <body>) perd toute son apparence pendant le drag.
      fallbackOnBody: false,
      onEnd: () => _onQuetesReordered(c),
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
  return `<article class="note-v3 note-v3--${view.catKey}${canEdit ? ' is-draggable' : ''}" data-note-idx="${index}">
    <header class="note-v3-head">
      ${canEdit ? '<span class="note-v3-drag" title="Glisser pour réordonner">⠿</span>' : ''}
      <span class="note-v3-marker" aria-hidden="true">${view.marker}</span>
      ${canEdit
        ? `<input class="note-v3-titre" type="text" value="${_esc(view.titre)}"
            data-blur="csV3SaveNoteTitle" data-idx="${index}"
            data-enter="blur" data-esc="revert-blur" placeholder="Titre de la note">`
        : `<span class="note-v3-titre note-v3-titre-ro">${_esc(view.titre)}</span>`}
      ${view.tag}
      ${view.date ? `<span class="note-v3-date">${_esc(view.date)}</span>` : ''}
      ${canEdit ? `<button class="note-v3-del" data-action="csV3DeleteNote" data-idx="${index}" data-stop-propagation title="Supprimer">🗑️</button>` : ''}
      <button class="note-v3-toggle" data-action="csV3ToggleNote" data-idx="${index}" title="Ouvrir" aria-expanded="false">⌄</button>
    </header>
    <button type="button" class="note-v3-preview" data-action="csV3ToggleNote" data-idx="${index}">
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
    handle: '.note-v3-drag',
    draggable: '.note-v3',
    animation: 160,
    // Garde le clone dans .cs-v3 (cartes stylées via cet ancêtre) → conserve son
    // apparence pendant le drag au lieu de devenir un bloc nu.
    fallbackOnBody: false,
    onEnd: () => _onNotesReordered(c),
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
  if (titleEl instanceof HTMLInputElement) titleEl.value = title;
  else if (titleEl) titleEl.textContent = title;
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
async function _csV3SaveNoteTitle(idx, value) {
  const c = STATE.activeChar; if (!c) return;
  const note = (c.notesList || [])[idx]; if (!note) return;
  const trimmed = (value || '').trim() || 'Note sans titre';
  if (note.titre === trimmed) return;
  note.titre = trimmed;
  c.notesList[idx] = note;
  _syncCharNotes(c);
  try { await updateInCol('characters', c.id, { notesList: c.notesList }); }
  catch (e) { console.warn('[note title]', e); }
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

const _RELATION_PALETTE = {
  lien:     ['rgba(157,111,255,.14)','rgba(157,111,255,.4)','#c8aaff'],
  allie:    ['rgba(34,195,142,.14)','rgba(34,195,142,.4)','#5dd5a8'],
  neutre:   ['rgba(244,196,48,.14)','rgba(244,196,48,.4)','#f4c430'],
  ennemi:   ['rgba(255,90,126,.14)','rgba(255,90,126,.4)','#ff8ca7'],
  mefiance: ['rgba(255,149,68,.14)','rgba(255,149,68,.4)','#ffb070'],
};
function renderCharRelations(c, canEdit) {
  const rels = c.relations || [];
  if (!rels.length) {
    return `<div class="q-empty">
      👥 Aucune relation enregistrée.${canEdit?` Clique sur « ＋ Relation » pour noter les alliés, ennemis et PNJ croisés par ${_esc(c.nom||'ce personnage')} — avec leur sentiment et une note.`:''}
    </div>`;
  }
  return `<div class="rel-grid">
    ${rels.map((r, i) => {
      const sent = _RELATION_PALETTE[r.sent] || _RELATION_PALETTE.neutre;
      const ini = (r.ini || r.nom || '?')[0]?.toUpperCase() || '?';
      return `<div class="rel-card" style="--rel-c:${sent[2]};--rel-bg:${sent[0]};--rel-bd:${sent[1]}">
        ${r.img
          ? `<div class="rel-avatar rel-avatar--img"><img src="${r.img}" alt=""></div>`
          : `<div class="rel-avatar">${_esc(ini)}</div>`}
        <div class="rel-body">
          <div class="rel-name-row">
            <span class="rel-name">${_esc(r.nom || 'Sans nom')}</span>
            <span class="rel-sentiment">${_esc(r.sentiment || r.sent || 'neutre')}</span>
          </div>
          ${r.role ? `<span class="rel-role">${_esc(r.role)}</span>` : ''}
          ${r.note ? `<div class="rel-note">${_esc(r.note)}</div>` : ''}
          ${canEdit ? `<div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
            <button class="ledger-del" style="opacity:.6" data-action="csV3EditRelation" data-id="${c.id}" data-idx="${i}" title="Modifier">✎</button>
            <button class="ledger-del" style="opacity:.6" data-action="csV3DeleteRelation" data-id="${c.id}" data-idx="${i}" title="Supprimer">🗑️</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

const _REL_SENTS = [
  { k:'lien',     lbl:'💜 Lien' },
  { k:'allie',    lbl:'💚 Allié' },
  { k:'neutre',   lbl:'💛 Neutre' },
  { k:'mefiance', lbl:'🧡 Méfiance' },
  { k:'ennemi',   lbl:'❤️ Ennemi' },
];
const _REL_DEFAULT_LBL = { lien:'Lien', allie:'Allié', neutre:'Neutre', mefiance:'Méfiance', ennemi:'Ennemi' };

let _relNpcsCache = []; // PNJ chargés pour le sélecteur de relation (modale)
async function _openRelationModal(charId, idx) {
  const c = getCharacterById(charId); if (!c) return;
  const isEdit = Number.isInteger(idx) && idx >= 0;
  const r = isEdit ? (c.relations || [])[idx] : null;
  if (isEdit && !r) return;
  const curSent = r?.sent || 'neutre';
  // PNJ liables : tous pour le MJ, seulement les non cachés (embauchable !== false)
  // pour un joueur qui édite la fiche.
  _relNpcsCache = (await loadCollection('npcs').catch(() => []))
    .filter(n => STATE.isAdmin || n.embauchable !== false)
    .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  const npcOpts = `<option value="">— Aucun (relation libre) —</option>` + _relNpcsCache.map(n =>
    `<option value="${n.id}" ${r?.npcId === n.id ? 'selected' : ''}>${_esc(n.nom || 'PNJ')}${n.role ? ' — ' + _esc(n.role) : ''}${STATE.isAdmin && n.embauchable === false ? ' 🚫' : ''}</option>`).join('');
  const linkedImg = r?.img || '';
  const previewHtml = linkedImg
    ? `<img src="${linkedImg}" alt="">`
    : `<span>${_esc((r?.ini || r?.nom || '?')[0]?.toUpperCase() || '?')}</span>`;
  openModal('', `
    <div class="rel-modal">
      <div class="rel-modal-head">
        <div class="rel-modal-ico">👥</div>
        <div class="rel-modal-head-txt">
          <h2>${isEdit ? 'Modifier la relation' : 'Nouvelle relation'}</h2>
          <small>Allié, ennemi ou PNJ croisé par <b>${_esc(c.nom||'ce personnage')}</b>, et le lien qui les unit.</small>
        </div>
      </div>
      <div class="rel-modal-body">
        <div class="form-group">
          <label>🔗 Lier un PNJ existant <span class="rel-opt">(optionnel)</span></label>
          <div class="rel-npc-pick">
            <div class="rel-npc-preview" id="rel-npc-preview">${previewHtml}</div>
            <select class="input-field" id="rel-npc" data-change="csV3RelPickNpc">${npcOpts}</select>
          </div>
          <input type="hidden" id="rel-npcid" value="${_esc(r?.npcId||'')}">
          <input type="hidden" id="rel-img" value="${linkedImg}">
        </div>
        <div class="form-group"><label>Nom</label>
          <input class="input-field" id="rel-nom" value="${_esc(r?.nom||'')}" placeholder="Maître Aldric, Capitaine Vex…" autocomplete="off"></div>
        <div class="form-group"><label>Rôle / lien <span class="rel-opt">(optionnel)</span></label>
          <input class="input-field" id="rel-role" value="${_esc(r?.role||'')}" placeholder="Mentor, Frère, Marchand, Rival…" autocomplete="off"></div>
        <div class="form-group"><label>Sentiment</label>
          <div class="rel-sent-seg">
            ${_REL_SENTS.map(s => `<button type="button" class="rel-sent-btn rel-sent-btn--${s.k} ${s.k===curSent?'is-active':''}" data-sent="${s.k}" data-action="csV3RelSent">${s.lbl}</button>`).join('')}
          </div>
          <input type="hidden" id="rel-sent" value="${curSent}">
          <input type="text" class="input-field" id="rel-sentiment" value="${_esc(r?.sentiment||'')}" placeholder="Libellé affiché (ex : Ami fidèle, Pacte, Dette…)" style="margin-top:.4rem" autocomplete="off"></div>
        <div class="form-group"><label>Note <span class="rel-opt">(optionnel)</span></label>
          <textarea class="input-field" id="rel-note" rows="3" placeholder="Histoire, dette, secret, dernière rencontre…">${_esc(r?.note||'')}</textarea></div>
      </div>
      <div class="rel-modal-foot">
        <button class="btn btn-outline btn-sm" data-action="closeRelModal">Annuler</button>
        <div style="flex:1"></div>
        <button class="btn btn-gold" data-action="csV3SaveRelation" data-id="${charId}" data-idx="${isEdit?idx:-1}">💾 Enregistrer</button>
      </div>
    </div>
  `);
  setTimeout(() => document.getElementById('rel-nom')?.focus(), 30);
}

function _csV3AddRelation(charId)       { _openRelationModal(charId, -1); }
function _csV3EditRelation(charId, idx) { _openRelationModal(charId, idx); }

function _csV3RelSent(sent) {
  const inp = document.getElementById('rel-sent'); if (inp) inp.value = sent;
  document.querySelectorAll('.rel-sent-btn').forEach(b => b.classList.toggle('is-active', b.dataset.sent === sent));
  const lbl = document.getElementById('rel-sentiment');
  if (lbl && !lbl.value.trim()) lbl.value = _REL_DEFAULT_LBL[sent] || sent;
}

// Sélection d'un PNJ existant : préremplit nom/rôle, l'aperçu et l'image (snapshot
// du portrait cadré → reste cohérent côté joueur sans charger la collection npcs).
function _csV3RelPickNpc(el) {
  const n = el.value ? _relNpcsCache.find(x => x.id === el.value) : null;
  document.getElementById('rel-npcid').value = n ? n.id : '';
  document.getElementById('rel-img').value = n ? (n.imageUrl || '') : '';
  const prev = document.getElementById('rel-npc-preview');
  const nomEl = document.getElementById('rel-nom');
  const roleEl = document.getElementById('rel-role');
  if (n) {
    if (nomEl) nomEl.value = n.nom || nomEl.value;
    if (roleEl && n.role && !roleEl.value.trim()) roleEl.value = n.role;
    if (prev) prev.innerHTML = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${_esc((n.nom||'?')[0]?.toUpperCase()||'?')}</span>`;
  } else if (prev) {
    prev.innerHTML = `<span>${_esc((nomEl?.value || '?')[0]?.toUpperCase() || '?')}</span>`;
  }
}

async function _csV3SaveRelation(charId, idx) {
  const c = getCharacterById(charId); if (!c) return;
  const nom = document.getElementById('rel-nom')?.value.trim();
  if (!nom) { showNotif('Indique au moins un nom.', 'error'); return; }
  const sent = document.getElementById('rel-sent')?.value || 'neutre';
  const rel = {
    nom,
    role:      document.getElementById('rel-role')?.value.trim() || '',
    sent,
    sentiment: document.getElementById('rel-sentiment')?.value.trim() || (_REL_DEFAULT_LBL[sent] || sent),
    note:      document.getElementById('rel-note')?.value.trim() || '',
    npcId:     document.getElementById('rel-npcid')?.value || '',
    img:       document.getElementById('rel-img')?.value || '',
  };
  const rels = Array.isArray(c.relations) ? c.relations.slice() : [];
  if (Number.isInteger(idx) && idx >= 0 && rels[idx]) rels[idx] = { ...rels[idx], ...rel };
  else rels.push(rel);
  c.relations = rels;
  try {
    await updateInCol('characters', charId, { relations: rels });
    closeModalDirect();
    _csV3JournalSub('relations');
  } catch (e) { console.error('[relation save]', e); showNotif('Erreur d\'enregistrement.', 'error'); }
}

async function _csV3DeleteRelation(charId, idx) {
  const c = getCharacterById(charId);
  if (!c?.relations?.[idx]) return;
  const nom = c.relations[idx].nom || '?';
  if (!await confirmModal(`Supprimer la relation <b>${_esc(nom)}</b> ?`, { title:'Confirmation', confirmLabel:'Supprimer', icon:'🗑️' })) return;
  const rels = c.relations.slice(); rels.splice(idx, 1); c.relations = rels;
  await updateInCol('characters', charId, { relations: rels });
  _csV3JournalSub('relations');
}

export {
  renderCharJournal,
  _bindNotesDnd, _bindQuetesDnd,
  _csV3JournalSub, _csV3ToggleNote, _csV3AddNote, _csV3DeleteNote, _csV3SaveNoteTitle,
  _csV3SaveOpenNote, _csV3CloseNote,
  _csV3AddRelation, _csV3EditRelation,
  _csV3RelSent, _csV3RelPickNpc, _csV3SaveRelation, _csV3DeleteRelation,
  _csV3CycleNoteCat,
};
