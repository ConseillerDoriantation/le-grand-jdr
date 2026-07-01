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
import { openModal, closeModalDirect, confirmModal } from '../../shared/modal.js';
import { makeSortable } from '../../shared/sortable-helper.js';
import { quillEditorHtml, bindQuillEditors } from '../../shared/rich-text-quill.js';
import { richTextContentHtml } from '../../shared/rich-text.js';

// État module-local (préservé au re-render, comme dans characters.js)
let _currentJournalSub = 'notes';
let _openNote = null;

// Sous-onglet Journal courant — lu par le routeur d'onglets de characters.js.
export function getCurrentJournalSub() { return _currentJournalSub; }

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

  return `<div class="journal-tabs">
    <span class="journal-tab ${subTab==='notes'?'on':''}" data-action="csV3JournalSub" data-sub="notes">📝 Notes (${counts.notes})</span>
    <span class="journal-tab ${subTab==='quetes'?'on':''}" data-action="csV3JournalSub" data-sub="quetes">📜 Quêtes (${counts.quetes})</span>
    <span class="journal-tab ${subTab==='relations'?'on':''}" data-action="csV3JournalSub" data-sub="relations">👥 Relations (${counts.relations})</span>
    ${canEdit && subTab==='notes' ? `<button class="section-action" style="margin-left:auto" data-action="addNote">＋ Note</button>` : ''}
    ${canEdit && subTab==='quetes' ? `<button class="section-action" style="margin-left:auto" data-action="addQuete">＋ Quête</button>` : ''}
    ${canEdit && subTab==='relations' ? `<button class="section-action" style="margin-left:auto" data-action="csV3AddRelation" data-id="${c.id}">＋ Relation</button>` : ''}
  </div>
  <div id="journal-body">${bodyHtml}</div>`;
}

function _csV3JournalSub(sub) {
  _currentJournalSub = sub;
  const c = charSession.getCurrentChar(); const canEdit = charSession.getCanEditChar();
  if (!c) return;
  // Rebuild juste l'onglet Journal sans recharger toute la fiche
  const area = document.getElementById('char-tab-content');
  if (area) {
    area.innerHTML = renderCharJournal(c, canEdit, sub);
    if (sub === 'notes') { bindQuillEditors(area); _bindNotesDnd(c, canEdit); }
    if (sub === 'quetes') _bindQuetesDnd(c, canEdit);
  }
}

// Quêtes — schéma réel : { nom, type, description, valide }
function renderJournalQuetes(c, canEdit) {
  const quetes = c.quetes || [];
  if (!quetes.length) {
    return `<div class="q-empty">Aucune quête. ${canEdit?'Clique sur "＋ Quête" pour en ajouter.':''}</div>`;
  }
  const enCours  = quetes.filter(q => !q.valide);
  const validees = quetes.filter(q => q.valide);
  const card = (q) => {
    const idx = quetes.indexOf(q);
    const validee = !!q.valide;
    const typeLbl = q.type ? `<span class="quest-type">${_esc(q.type)}</span>` : '';
    return `<article class="quest ${validee?'done':''}${canEdit?' is-draggable':''}" data-quest-idx="${idx}">
      <header class="quest-head">
        <div class="quest-name-wrap">
          ${validee
            ? `<span class="quest-state-ico" title="Validée">✓</span>`
            : `<span class="quest-state-ico open" title="En cours">⚔</span>`}
          <h4 class="quest-name">${_esc(q.nom || 'Quête sans nom')}</h4>
          ${typeLbl}
        </div>
        ${canEdit ? `<div class="quest-actions">
          <button class="btn-icon" data-action="toggleQuete" data-idx="${idx}" title="${validee?'Rouvrir':'Marquer comme validée'}">${validee?'↺':'✔️'}</button>
          <button class="btn-icon" data-action="deleteQuete" data-idx="${idx}" title="Supprimer" style="color:#ff8ca7">🗑️</button>
        </div>` : ''}
      </header>
      ${q.description ? `<p class="quest-desc">${_esc(q.description)}</p>` : ''}
    </article>`;
  };
  return `
    <section class="quest-block">
      <div class="quest-section-head">
        <span class="q-lbl">En cours</span>
        <span class="q-count">${enCours.length}</span>
      </div>
      <div class="quest-list" data-quest-list="open">
        ${enCours.length ? enCours.map(card).join('') : '<div class="q-empty">Aucune quête en cours.</div>'}
      </div>
    </section>
    <section class="quest-block" style="margin-top:18px">
      <div class="quest-section-head">
        <span class="q-lbl done">Validées</span>
        <span class="q-count">${validees.length}</span>
      </div>
      <div class="quest-list" data-quest-list="done">
        ${validees.length ? validees.map(card).join('') : '<div class="q-empty">Aucune quête validée.</div>'}
      </div>
    </section>`;
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
function renderCharNotesV3(c, canEdit) {
  const notes = c.notesList || [];
  if (!notes.length) {
    return `<div class="q-empty">Aucune note. ${canEdit?'Clique sur "＋ Note" en haut pour en créer une.':''}</div>`;
  }
  return `<div class="notes-stack">${notes.map((n, i) => {
    const isOpen = _openNote === i;
    const titre = n.titre || 'Note sans titre';
    const date  = n.date  || '';
    return `<article class="note-v3 ${isOpen?'is-open':''}${canEdit?' is-draggable':''}" data-note-idx="${i}">
      <header class="note-v3-head">
        ${canEdit ? `<span class="note-v3-drag" title="Glisser pour réordonner">⠿</span>` : ''}
        <button class="note-v3-toggle" data-action="csV3ToggleNote" data-idx="${i}" title="${isOpen?'Replier':'Déplier'}">
          ${isOpen ? '▾' : '▸'}
        </button>
        ${canEdit
          ? `<input class="note-v3-titre" type="text" value="${_esc(titre)}"
              data-blur="csV3SaveNoteTitle" data-idx="${i}"
              data-enter="blur" data-esc="revert-blur"
              placeholder="Titre de la note">`
          : `<span class="note-v3-titre note-v3-titre-ro">${_esc(titre)}</span>`}
        ${date ? `<span class="note-v3-date">${_esc(date)}</span>` : ''}
        ${canEdit ? `<button class="note-v3-del" data-action="deleteNote" data-idx="${i}" data-stop-propagation title="Supprimer">🗑️</button>` : ''}
      </header>
      ${isOpen ? `<div class="note-v3-body">
        ${canEdit
          ? `${quillEditorHtml({ id: `note-area-${i}`, html: n.contenu || '', placeholder: 'Contenu de la note…', minHeight: 180 })}
             <div style="display:flex;gap:8px;margin-top:8px">
               <button class="btn btn-gold btn-sm" data-action="saveNote" data-idx="${i}">💾 Enregistrer</button>
             </div>`
          : richTextContentHtml({ html: n.contenu, className: 'note-v3-content', fallback: '<em style="opacity:.5">Aucun contenu.</em>' })}
      </div>` : ''}
    </article>`;
  }).join('')}</div>`;
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

function _csV3ToggleNote(idx) {
  _openNote = _openNote === idx ? null : idx;
  const c = charSession.getCurrentChar(); if (!c) return;
  // Re-render journal en gardant le sub-tab notes
  _currentJournalSub = 'notes';
  charSession.renderTab('journal', c, charSession.getCanEditChar());
}
async function _csV3SaveNoteTitle(idx, value) {
  const c = STATE.activeChar; if (!c) return;
  const note = (c.notesList || [])[idx]; if (!note) return;
  const trimmed = (value || '').trim() || 'Note sans titre';
  if (note.titre === trimmed) return;
  note.titre = trimmed;
  c.notesList[idx] = note;
  try { await updateInCol('characters', c.id, { notesList: c.notesList }); }
  catch (e) { console.warn('[note title]', e); }
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
  _csV3JournalSub, _csV3ToggleNote, _csV3SaveNoteTitle,
  _csV3AddRelation, _csV3EditRelation,
  _csV3RelSent, _csV3RelPickNpc, _csV3SaveRelation, _csV3DeleteRelation,
};
