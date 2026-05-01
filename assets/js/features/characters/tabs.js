import { STATE } from '../../core/state.js';
import { updateInCol, loadCollection, loadCollectionWhere, addToCol, saveDoc } from '../../data/firestore.js';
import { openModal, closeModal, confirmModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { modStr, _esc } from '../../shared/html.js';
import { getMod, calcPVMax, calcPMMax, calcOr, calcPalier } from '../../shared/char-stats.js';
import { richTextEditorHtml, getRichTextHtml, richTextContentHtml } from '../../shared/rich-text.js';
import { uploadJpeg } from '../../shared/image-upload.js';

// ══════════════════════════════════════════════
// TAB : CARACTÉRISTIQUES
// ══════════════════════════════════════════════
export function renderCharCarac(c, canEdit) {
  const STATS_TAB = [
    {key:'force',label:'Force',abbr:'Fo'},
    {key:'dexterite',label:'Dextérité',abbr:'Dex'},
    {key:'constitution',label:'Constitution',abbr:'Co'},
    {key:'intelligence',label:'Intelligence',abbr:'Int'},
    {key:'sagesse',label:'Sagesse',abbr:'Sag'},
    {key:'charisme',label:'Charisme',abbr:'Cha'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  let html = `<div class="cs-section">
    <div class="cs-section-title">📊 Caractéristiques
      ${canEdit?'<span class="cs-hint">cliquer sur la valeur de base pour modifier</span>':''}
    </div>
    <div style="display:grid;gap:.5rem">
      <div style="display:grid;grid-template-columns:minmax(120px,1.3fr) repeat(4,minmax(62px,.7fr));gap:.5rem;align-items:center;padding:0 .75rem;color:var(--text-dim);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em">
        <span>Stat</span>
        <span style="text-align:center">Base</span>
        <span style="text-align:center">Équip.</span>
        <span style="text-align:center">Total</span>
        <span style="text-align:center">Mod</span>
      </div>`;

  STATS_TAB.forEach(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    const bonusStr = bonus > 0 ? `+${bonus}` : String(bonus);
    const modClass = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    html += `<div style="display:grid;grid-template-columns:minmax(120px,1.3fr) repeat(4,minmax(62px,.7fr));gap:.5rem;align-items:center;padding:.75rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated)">
      <div>
        <div style="font-weight:700;color:var(--text)">${st.label}</div>
        <div style="font-size:.72rem;color:var(--text-dim)">${st.abbr}</div>
      </div>
      <div style="text-align:center">
        <span class="${canEdit?'cs-editable':''}"
              ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Modifier la base"`:''}
              style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);font-weight:700;color:var(--text)">
          ${base}
        </span>
      </div>
      <div style="text-align:center">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:${bonus ? 'rgba(79,140,255,.10)' : 'var(--bg-card)'};font-weight:700;color:${bonus ? '#7fb0ff' : 'var(--text-dim)'}">
          ${bonusStr}
        </span>
      </div>
      <div style="text-align:center">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);font-weight:800;color:var(--text)">
          ${total}
        </span>
      </div>
      <div style="text-align:center">
        <span class="cs-carac-detail-mod ${modClass}" style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px">
          ${modStr(m)}
        </span>
      </div>
    </div>`;
  });
  html += `</div>
    <div style="margin-top:.65rem;font-size:.76rem;color:var(--text-dim)">
      Total = Base + bonus d'équipement. Le modificateur est calculé à partir du total.
    </div>
  </div>`;

  html += `<div class="cs-section">
    <div class="cs-section-title">⚙️ Base PV & PM
      ${canEdit?'<span class="cs-hint">cliquer pour modifier — les max sont recalculés</span>':''}
    </div>
    <div class="cs-base-grid">
      <div class="cs-base-card">
        <div class="cs-base-label">PV Base (niv.1)</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Cliquer pour modifier"`:''}>
          ${c.pvBase||10}
        </div>
        <div class="cs-base-formula">PV max actuel : ${calcPVMax(c)}</div>
        <div class="cs-base-sub">PV max = Base + Mod(Co) × (Niv−1)</div>
      </div>
      <div class="cs-base-card">
        <div class="cs-base-label">PM Base (niv.1)</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Cliquer pour modifier"`:''}>
          ${c.pmBase||10}
        </div>
        <div class="cs-base-formula">PM max actuel : ${calcPMMax(c)}</div>
        <div class="cs-base-sub">PM max = Base + Mod(Sa) × (Niv−1)</div>
      </div>
      <div class="cs-base-card">
        <div class="cs-base-label">Palier XP suivant</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','palier',this,1,99999)" title="Cliquer pour modifier"`:''}>
          ${c.palier||100}
        </div>
        <div class="cs-base-sub">XP actuel : ${c.exp||0}</div>
      </div>
    </div>
  </div>`;

  if (c.setBonusActif) {
    html += `<div class="cs-section">
      <div class="cs-section-title">✨ Bonus de Set</div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-style:italic">${c.setBonusActif}</div>
    </div>`;
  }
  return html;
}

// ══════════════════════════════════════════════
// TAB : QUÊTES
// ══════════════════════════════════════════════
export function renderCharQuetes(c, canEdit) {
  const quetes = c.quetes||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📜 Journal de Quête
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addQuete()">+ Ajouter</button>`:''}
    </div>`;

  if (quetes.length===0) {
    html += `<div class="cs-empty">Aucune quête.</div>`;
  } else {
    quetes.forEach((q,i) => {
      html += `<div class="cs-quest-row">
        <div class="cs-quest-info">
          <div class="cs-quest-name">${q.nom||'?'}</div>
          <div class="cs-quest-meta">${q.type||''} ${q.description?'— '+q.description:''}</div>
        </div>
        <div class="cs-quest-right">
          <span class="badge badge-${q.valide?'green':'blue'}">${q.valide?'Validée':'En cours'}</span>
          ${canEdit?`<button class="btn-icon" onclick="toggleQuete(${i})" title="${q.valide?'Rouvrir':'Valider'}">✔️</button>
                     <button class="btn-icon" onclick="deleteQuete(${i})">🗑️</button>`:''}
        </div>
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : NOTES
// ══════════════════════════════════════════════
export function renderCharNotes(c, canEdit) {
  const notes = c.notesList||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📝 Notes
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addNote()">+ Nouvelle note</button>`:''}
    </div>`;

  if (notes.length===0) {
    html += `<div class="cs-empty">Aucune note. Crée ta première note avec le bouton ci-dessus.</div>`;
  } else {
    notes.forEach((note, i) => {
      const isOpen = window._openNote === i;
      html += `<div class="cs-note-card">
        <div class="cs-note-header" onclick="toggleNote(${i})">
          <div class="cs-note-meta">
            <span class="cs-note-icon">📄</span>
            <span class="cs-note-title">${note.titre||'Note sans titre'}</span>
            ${note.date?`<span class="cs-note-date">${note.date}</span>`:''}
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center">
            ${canEdit?`<button class="btn-icon" onclick="event.stopPropagation();editNoteTitle(${i})" title="Renommer">✏️</button>
                       <button class="btn-icon" onclick="event.stopPropagation();deleteNote(${i})" title="Supprimer">🗑️</button>`:''}
            <span class="cs-note-chevron">${isOpen?'▲':'▼'}</span>
          </div>
        </div>
        ${isOpen?`<div class="cs-note-body">
          ${canEdit
            ? `${richTextEditorHtml({ id: `note-area-${i}`, html: note.contenu || '', placeholder: 'Contenu de la note...', minHeight: 180 })}
               <button class="btn btn-gold btn-sm" style="margin-top:0.6rem" onclick="saveNote(${i})">💾 Enregistrer</button>`
            : richTextContentHtml({ html: note.contenu, className: 'cs-note-content', fallback: '<em style="opacity:.5">Aucun contenu.</em>' })
          }
        </div>`:''}
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}

// ── Fonctions de gestion des notes ───────────────────────────────────────────

export function toggleNote(idx) {
  window._openNote = window._openNote === idx ? null : idx;
  window._renderTab('notes', window._currentChar, window._canEditChar);
}

export function addNote() {
  const c = STATE.activeChar; if(!c) return;
  const notes = c.notesList||[];
  const now = new Date().toLocaleDateString('fr-FR');
  notes.push({ titre: 'Nouvelle note', contenu: '', date: now });
  c.notesList = notes;
  window._openNote = notes.length - 1;
  updateInCol('characters', c.id, {notesList: notes}).then(()=>{
    window._renderTab('notes', c, window._canEditChar);
  });
}

export function editNoteTitle(idx) {
  const c = STATE.activeChar; if(!c) return;
  const note = (c.notesList||[])[idx];
  if (!note) return;
  const cur = note.titre||'Sans titre';
  const val = prompt('Titre de la note :', cur);
  if (val === null) return;
  note.titre = val.trim()||cur;
  c.notesList[idx] = note;
  updateInCol('characters', c.id, {notesList: c.notesList}).then(()=>{
    window._renderTab('notes', c, window._canEditChar);
    showNotif('Titre mis à jour !','success');
  });
}

export async function saveNote(idx) {
  try {
    const c = STATE.activeChar; if(!c) return;
    const html = getRichTextHtml(`note-area-${idx}`);
    if (!c.notesList?.[idx]) return;
    c.notesList[idx].contenu = html;
    await updateInCol('characters', c.id, {notesList: c.notesList});
    showNotif('Note enregistrée !','success');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export async function deleteNote(idx) {
  try {
    const c = STATE.activeChar; if(!c) return;
    if (!await confirmModal('Supprimer cette note ?')) return;
    c.notesList.splice(idx, 1);
    if (window._openNote >= c.notesList.length) window._openNote = null;
    await updateInCol('characters', c.id, {notesList: c.notesList});
    window._renderTab('notes', c, window._canEditChar);
    showNotif('Note supprimée.','success');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// TAB : LIVRET DE COMPTE
// ══════════════════════════════════════════════
export function renderCharCompte(c, canEdit) {
  const compte = c.compte||{recettes:[], depenses:[]};
  const recettes = compte.recettes||[];
  const depenses = compte.depenses||[];

  const totalR = recettes.reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = depenses.reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  const solde = totalR - totalD;

  const HIST_LIMIT = 5;

  const renderRow = (row, i, type, canEdit, extraClass = '', extraStyle = '') => `
    <tr class="cs-compte-row${extraClass ? ' ' + extraClass : ''}"${extraStyle ? ` style="${extraStyle}"` : ''}>
      <td>${canEdit
        ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'date',this)">${row.date||'—'}</span>`
        : (row.date||'—')}</td>
      <td>${canEdit
        ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'libelle',this)">${row.libelle||'—'}</span>`
        : (row.libelle||'—')}</td>
      <td class="${type==='recettes'?'cs-montant-pos':'cs-montant-neg'}">${canEdit
        ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'montant',this)">${row.montant||0}</span>`
        : (row.montant||0)} or</td>
      ${canEdit?`<td><button class="btn-icon" onclick="deleteCompteRow('${type}',${i})">🗑️</button></td>`:''}
    </tr>`;

  const renderRows = (list, type, canEdit) => {
    if (list.length === 0) return `<tr><td colspan="4" class="cs-compte-empty">Aucune entrée.</td></tr>`;
    if (list.length <= HIST_LIMIT) return list.map((r,i) => renderRow(r,i,type,canEdit)).join('');

    const hidden = list.slice(0, list.length - HIST_LIMIT);
    const visible = list.slice(-HIST_LIMIT);
    const cols = canEdit ? 4 : 3;
    return `
      ${hidden.map((r,i) => renderRow(r, i, type, canEdit, `cs-hist-old-${type}`, 'display:none')).join('')}
      <tr class="cs-hist-expand-row">
        <td colspan="${cols}">
          <button class="cs-hist-expand-btn" id="cs-hist-btn-${type}"
            onclick="window._toggleCompteHist('${type}',${hidden.length})">
            ↑ Voir les ${hidden.length} entrées précédentes
          </button>
        </td>
      </tr>
      ${visible.map((r,i) => renderRow(r, hidden.length + i, type, canEdit)).join('')}`;
  };

  const otherChars = (STATE.characters||[]).filter(x => x.id !== c.id && x.nom);

  return `<div class="cs-section">
    <div class="cs-section-title">💰 Livret de Compte
      <button class="cs-send-gold-btn" onclick="openSendGoldModal('${c.id}')" title="Envoyer de l'or à un autre personnage">↗ Envoyer de l'or</button>
    </div>

    <div class="cs-solde-bar">
      <div class="cs-solde-item">
        <span class="cs-solde-label">Recettes</span>
        <span class="cs-solde-val pos">+${totalR} or</span>
      </div>
      <div class="cs-solde-sep">−</div>
      <div class="cs-solde-item">
        <span class="cs-solde-label">Dépenses</span>
        <span class="cs-solde-val neg">−${totalD} or</span>
      </div>
      <div class="cs-solde-sep">=</div>
      <div class="cs-solde-item cs-solde-main">
        <span class="cs-solde-label">SOLDE</span>
        <span class="cs-solde-val ${solde>=0?'pos':'neg'}">${solde>=0?'+':''}${solde} or</span>
      </div>
    </div>

    <div class="cs-compte-grid">
      <div class="cs-compte-col">
        <div class="cs-compte-col-header">
          <span class="cs-compte-col-title pos">📈 Recettes</span>
          ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addCompteRow('recettes')">+ Ajouter</button>`:''}
        </div>
        <table class="cs-compte-table">
          <thead><tr>
            <th>Date / Mission</th><th>Libellé</th><th>Montant</th>
            ${canEdit?'<th></th>':''}
          </tr></thead>
          <tbody>${renderRows(recettes,'recettes',canEdit)}</tbody>
          <tfoot><tr>
            <td colspan="${canEdit?3:2}" style="text-align:right;font-size:0.72rem;color:var(--text-muted);font-weight:700;padding-top:0.5rem">Total</td>
            <td class="cs-montant-pos" style="font-weight:800;padding-top:0.5rem">+${totalR} or</td>
            ${canEdit?'<td></td>':''}
          </tr></tfoot>
        </table>
      </div>

      <div class="cs-compte-col">
        <div class="cs-compte-col-header">
          <span class="cs-compte-col-title neg">📉 Dépenses</span>
          ${canEdit?`<button class="btn btn-danger btn-sm" style="font-size:0.72rem" onclick="addCompteRow('depenses')">+ Ajouter</button>`:''}
        </div>
        <table class="cs-compte-table">
          <thead><tr>
            <th>Date / Mission</th><th>Libellé</th><th>Montant</th>
            ${canEdit?'<th></th>':''}
          </tr></thead>
          <tbody>${renderRows(depenses,'depenses',canEdit)}</tbody>
          <tfoot><tr>
            <td colspan="${canEdit?3:2}" style="text-align:right;font-size:0.72rem;color:var(--text-muted);font-weight:700;padding-top:0.5rem">Total</td>
            <td class="cs-montant-neg" style="font-weight:800;padding-top:0.5rem">−${totalD} or</td>
            ${canEdit?'<td></td>':''}
          </tr></tfoot>
        </table>
      </div>
    </div>
  </div>`;
}

export function refreshOrDisplay(c) {
  const el = document.querySelector('.cs-or');
  if (el) el.textContent = '💰 ' + calcOr(c) + ' or';
}

export function addCompteRow(type) {
  const c = STATE.activeChar; if(!c) return;
  const compte = c.compte||{recettes:[],depenses:[]};
  compte[type] = compte[type]||[];
  compte[type].push({ date: new Date().toLocaleDateString('fr-FR'), libelle: '', montant: 0 });
  c.compte = compte;
  updateInCol('characters', c.id, {compte}).then(()=>{
    window._renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  });
}

export async function deleteCompteRow(type, idx) {
  try {
    const c = STATE.activeChar; if(!c) return;
    (c.compte||{})[type]?.splice(idx,1);
    await updateInCol('characters', c.id, {compte: c.compte});
    window._renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export function inlineEditCompteField(type, idx, field, el) {
  const c = STATE.activeChar; if(!c) return;
  const cur = el.textContent.replace(/ or$/,'').trim();
  const isNum = field === 'montant';
  const input = document.createElement('input');
  input.type = isNum ? 'number' : 'text';
  input.value = cur;
  input.className = 'cs-inline-input' + (isNum ? ' cs-inline-num' : '');
  input.style.cssText = 'width:' + (isNum ? '70px' : '120px') + ';font-size:inherit;';

  const save = async () => {
    const val = isNum ? (parseFloat(input.value)||0) : (input.value.trim()||cur);
    c.compte = c.compte||{recettes:[],depenses:[]};
    c.compte[type][idx][field] = val;
    await updateInCol('characters', c.id, {compte: c.compte});
    window._renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape') input.replaceWith(el); });
  el.replaceWith(input);
  input.focus(); input.select();
}

// ══════════════════════════════════════════════
// TAB : MAÎTRISES
// ══════════════════════════════════════════════
// Charge les sousTypes distincts depuis la collection shop (cachée 5 min)
async function _loadWeaponSousTypes() {
  try {
    const items = await loadCollection('shop');
    return [...new Set(
      items.filter(i => i?.sousType).map(i => i.sousType)
    )].sort((a, b) => a.localeCompare(b, 'fr'));
  } catch {
    return [];
  }
}

// Couleur accent selon le niveau (0-5)
function _maitNiveauColor(n) {
  if (n >= 4) return { col:'#e8b84b', bg:'rgba(232,184,75,.12)', border:'rgba(232,184,75,.3)' };
  if (n >= 2) return { col:'#4f8cff', bg:'rgba(79,140,255,.10)', border:'rgba(79,140,255,.25)' };
  return { col:'var(--text-dim)', bg:'rgba(255,255,255,.04)', border:'var(--border)' };
}

// Pips de niveau (5 max)
function _niveauPips(n, col) {
  const max = 5;
  return Array.from({length: max}, (_, i) =>
    `<span class="cs-mait-pip${i < n ? ' on' : ''}" style="${i < n ? `background:${col};box-shadow:0 0 6px ${col}55` : ''}"></span>`
  ).join('');
}

export function renderCharMaitrises(c, canEdit) {
  const maitrises = c.maitrises || [];

  let html = `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">⚔️ Maîtrises d'armes</span>
      ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="addMaitrise()">+ Ajouter</button>` : ''}
    </div>`;

  if (maitrises.length === 0) {
    html += `<div class="cs-mait-empty">${canEdit
      ? '⚔️ Aucune maîtrise — clique sur <strong>+ Ajouter</strong> pour en déclarer une.'
      : 'Aucune maîtrise enregistrée.'
    }</div>`;
  } else {
    html += `<div class="cs-mait-grid">`;
    maitrises.forEach((m, i) => {
      const niveau = parseInt(m.niveau) || 0;
      const { col, bg, border } = _maitNiveauColor(niveau);
      const bonus  = niveau > 0 ? `+${niveau} dégâts` : 'Initié';
      html += `<div class="cs-mait-card" style="--mc:${col};--mb:${bg};--mbd:${border}">
        <div class="cs-mait-card-body">
          <div class="cs-mait-card-top">
            <span class="cs-mait-card-name">${m.typeArme||'?'}</span>
            <span class="cs-mait-card-bonus">${bonus}</span>
          </div>
          <div class="cs-mait-pips">${_niveauPips(niveau, col)}</div>
          ${m.note ? `<div class="cs-mait-card-note">${m.note}</div>` : ''}
        </div>
        ${canEdit ? `<div class="cs-mait-card-actions">
          <button class="btn-icon" onclick="editMaitrise(${i})" title="Modifier">✏️</button>
          <button class="btn-icon cs-mait-del" onclick="deleteMaitrise(${i})" title="Supprimer">🗑️</button>
        </div>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  html += `<p class="cs-rule-note">💡 Le bonus de dégâts s'applique si le type d'arme équipée correspond exactement.</p>`;
  html += `</div>`;
  return html;
}

function _maitriseSousTypeSelect(current, sousTypes) {
  if (!sousTypes.length) {
    return `<div class="cs-mait-load-warn">⚠️ Aucun type d'arme trouvé dans la base de données.</div>`;
  }
  const options = sousTypes.map(t =>
    `<option value="${t}" ${t === current ? 'selected' : ''}>${t}</option>`
  ).join('');
  return `<select class="input-field" id="mait-type">
    <option value="" ${!current ? 'selected' : ''} disabled>— Choisir un type —</option>
    ${options}
  </select>`;
}

export async function addMaitrise() {
  const c = STATE.activeChar; if (!c) return;
  const sousTypes = await _loadWeaponSousTypes();
  openModal('⚔️ Nouvelle maîtrise', `
    <div class="form-group"><label>Type d'arme</label>
      ${_maitriseSousTypeSelect('', sousTypes)}
    </div>
    <div class="form-group">
      <label>Niveau <span style="color:var(--text-dim);font-weight:400">(+1 aux dégâts par niveau)</span></label>
      <input type="number" class="input-field" id="mait-niveau" value="1" min="0" max="5">
    </div>
    <div class="form-group"><label>Note (optionnel)</label>
      <input class="input-field" id="mait-note" placeholder="Obtenu lors de la mission X...">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="saveMaitrise(-1)">Ajouter</button>
  `);
}

export async function editMaitrise(idx) {
  const c = STATE.activeChar; if (!c) return;
  const m = (c.maitrises || [])[idx]; if (!m) return;
  const sousTypes = await _loadWeaponSousTypes();
  openModal('✏️ Modifier la maîtrise', `
    <div class="form-group"><label>Type d'arme</label>
      ${_maitriseSousTypeSelect(m.typeArme||'', sousTypes)}
    </div>
    <div class="form-group">
      <label>Niveau</label>
      <input type="number" class="input-field" id="mait-niveau" value="${m.niveau||1}" min="0" max="5">
    </div>
    <div class="form-group"><label>Note (optionnel)</label>
      <input class="input-field" id="mait-note" value="${m.note||''}">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="saveMaitrise(${idx})">Enregistrer</button>
  `);
}

export async function saveMaitrise(idx) {
  try {
    const typeArme = document.getElementById('mait-type')?.value?.trim();
    if (!typeArme) { showNotif('Le type d\'arme est requis.', 'error'); return; }
    const niveau = parseInt(document.getElementById('mait-niveau')?.value) || 0;
    const note   = document.getElementById('mait-note')?.value?.trim() || '';
    const c = STATE.activeChar; if (!c) return;
    const maitrises = [...(c.maitrises || [])];
    const entry = { typeArme, niveau, note };
    if (idx < 0) maitrises.push(entry);
    else maitrises[idx] = entry;
    c.maitrises = maitrises;
    await updateInCol('characters', c.id, { maitrises });
    closeModal();
    showNotif(idx < 0 ? `Maîtrise "${typeArme}" ajoutée !` : 'Maîtrise mise à jour.', 'success');
    window.renderCharSheet(c, 'maitrises');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export async function deleteMaitrise(idx) {
  try {
    const c = STATE.activeChar; if (!c) return;
    const m = (c.maitrises || [])[idx];
    if (!await confirmModal(`Supprimer la maîtrise "${m?.typeArme||'?'}" ?`)) return;
    c.maitrises = (c.maitrises || []).filter((_, i) => i !== idx);
    await updateInCol('characters', c.id, { maitrises: c.maitrises });
    showNotif('Maîtrise supprimée.', 'success');
    window.renderCharSheet(c, 'maitrises');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── XP helpers (utilisés dans renderCharSheet header) ──────────────────────
export function previewXpBar(input, palier) {
  const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
  const p = palier > 0 ? Math.round(val/palier*100) : 0;
  const bar = document.getElementById('xp-bar-fill');
  const pct = document.getElementById('xp-pct');
  if (bar) bar.style.width = p + '%';
  if (pct) pct.textContent = p + '%';
}

window._toggleCompteHist = (type, count) => {
  const rows = document.querySelectorAll(`.cs-hist-old-${type}`);
  const btn  = document.getElementById(`cs-hist-btn-${type}`);
  if (!rows.length || !btn) return;
  const isOpen = rows[0].style.display !== 'none';
  rows.forEach(r => { r.style.display = isOpen ? 'none' : ''; });
  btn.textContent = isOpen
    ? `↑ Voir les ${count} entrées précédentes`
    : `↓ Masquer l'historique`;
};

export async function saveXpDirect(charId, input) {
  try {
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) return;
    const palier = calcPalier(c.niveau||1);
    const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
    c.exp = val;
    input.value = val;
    previewXpBar(input, palier);
    await updateInCol('characters', charId, {exp: val});
    showNotif('XP mis à jour !', 'success');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// TAB : PRÉSENTATION PUBLIQUE (players page)
// ══════════════════════════════════════════════
const _profilCache = {}; // charId → doc | null

const TAG_MAX = 6;
const TAG_SUGGESTIONS = [
  'Bienveillant','Vengeur','Courageux','Méfiant','Loyal','Obsessionnel',
  'Impulsif','Protecteur','Solitaire','Curieux','Ambitieux','Charismatique',
  'Prudent','Rusé','Empathique','Froid','Fervent','Téméraire',
];
// Palette de couleurs pour les tags (hash sur le texte)
const TAG_COLORS = [
  ['rgba(79,140,255,.14)','rgba(79,140,255,.35)','#7fb0ff'],   // bleu
  ['rgba(34,195,142,.14)','rgba(34,195,142,.35)','#22c38e'],   // vert
  ['rgba(232,184,75,.14)','rgba(232,184,75,.35)','#e8b84b'],   // or
  ['rgba(180,127,255,.14)','rgba(180,127,255,.35)','#b47fff'],  // violet
  ['rgba(255,107,107,.14)','rgba(255,107,107,.35)','#ff8080'],  // rouge
  ['rgba(245,158,11,.14)', 'rgba(245,158,11,.35)', '#f59e0b'],  // orange
];
function _tagColor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

function _tagChip(text, viewOnly = false) {
  const [bg, border, color] = _tagColor(text);
  const cls = viewOnly ? 'pp-tag-chip pp-tag-chip--view' : 'pp-tag-chip';
  const btn = viewOnly ? '' : `<button type="button" class="pp-tag-remove" onclick="removeProfilTag(this)" aria-label="Supprimer" style="color:${color}">×</button>`;
  return `<span class="${cls}" data-tag="${_esc(text)}" style="background:${bg};border-color:${border};color:${color}">${_esc(text)}${btn}</span>`;
}

export function addProfilTag(value) {
  const input = document.getElementById('profil-tag-input');
  const val = (value || input?.value || '').trim();
  if (!val) return;
  const container = document.getElementById('profil-tags');
  if (!container) return;
  // Dédoublonnage insensible à la casse
  const existing = [...container.querySelectorAll('.pp-tag-chip')].map(el => el.dataset.tag?.toLowerCase());
  if (existing.includes(val.toLowerCase())) { if (input) { input.value = ''; input.focus(); } return; }
  // Limite
  if (existing.length >= TAG_MAX) return;
  container.insertAdjacentHTML('beforeend', _tagChip(val));
  if (input) { input.value = ''; input.focus(); }
  _updateTagCounter(container);
}

export function removeProfilTag(btn) {
  const container = btn.closest('.pp-tags-edit');
  btn.closest('.pp-tag-chip')?.remove();
  if (container) _updateTagCounter(container);
}

function _updateTagCounter(container) {
  const chips = [...container.querySelectorAll('.pp-tag-chip')];
  const count = chips.length;
  const usedLow = chips.map(el => el.dataset.tag?.toLowerCase()).filter(Boolean);
  const full = count >= TAG_MAX;
  const counter = document.getElementById('profil-tag-count');
  if (counter) counter.textContent = `${count}/${TAG_MAX}`;
  const addBtn = document.getElementById('profil-tag-add');
  if (addBtn) addBtn.disabled = full;
  const input = document.getElementById('profil-tag-input');
  if (input) input.disabled = full;
  // Griser les suggestions déjà utilisées
  document.querySelectorAll('.pp-tag-suggest').forEach(btn => {
    const used = usedLow.includes(btn.textContent.trim().toLowerCase());
    btn.classList.toggle('pp-tag-suggest--used', used);
    btn.disabled = used || full;
  });
}

export function initProfilTagUi() {
  const container = document.getElementById('profil-tags');
  if (container) _updateTagCounter(container);
}


export function renderCharProfil(c, canEdit) {
  if (c.id in _profilCache) return _buildProfilHtml(c, canEdit, _profilCache[c.id]);
  _loadAndRenderProfil(c, canEdit);
  return `<div style="padding:2rem;text-align:center;color:var(--text-dim);font-size:.85rem;opacity:.6">⏳ Chargement…</div>`;
}

async function _loadAndRenderProfil(c, canEdit) {
  try {
    const docs = await loadCollectionWhere('players', 'charId', '==', c.id);
    _profilCache[c.id] = docs[0] || null;
  } catch { _profilCache[c.id] = null; }
  if (window._currentCharTab === 'profil' && window._currentChar?.id === c.id)
    window._renderTab('profil', c, canEdit);
}

function _buildProfilHtml(c, canEdit, pres) {
  const content   = pres?.content || pres?.bio || '';
  const chapitre  = pres?.chapitre || '';
  const imageUrl  = pres?.imageUrl || '';
  const cb = (key, def) => pres?.[key] !== undefined ? pres[key] : def;

  if (!canEdit) {
    return content
      ? richTextContentHtml({ html: content, className: 'pp-rich-content' })
      : `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);font-size:.82rem">Aucune présentation.</div>`;
  }

  const CHECKS = [
    { id:'profil-pv',    label:'Points de Vie (PV)',   key:'afficherPV',    def:true  },
    { id:'profil-pm',    label:'Points de Magie (PM)', key:'afficherPM',    def:true  },
    { id:'profil-ca',    label:"Classe d'Armure (CA)", key:'afficherCA',    def:true  },
    { id:'profil-or',    label:'Or',                   key:'afficherOr',    def:false },
    { id:'profil-stats', label:'Statistiques',          key:'afficherStats', def:true  },
    { id:'profil-lvl',   label:'Niveau',               key:'afficherNiveau',def:true  },
  ];

  return `<div class="cs-section">
    <div class="cs-section-title">👤 Présentation publique
      <span style="font-size:.7rem;color:var(--text-dim);font-weight:400;margin-left:.5rem">visible sur la page Personnages</span>
    </div>

    <div class="form-group">
      <label>Titre du chapitre <span style="color:var(--text-dim);font-size:.75rem">(optionnel)</span></label>
      <input class="input-field" id="profil-chap" value="${_esc(chapitre)}" placeholder="ex : Chapitre I · Khaarys">
    </div>

    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        <span>Traits de caractère <span style="color:var(--text-dim);font-size:.75rem">(affichés sur la page Personnages)</span></span>
        <span id="profil-tag-count" style="font-size:.7rem;color:var(--text-dim);font-weight:400">${(pres?.tags||[]).length}/${TAG_MAX}</span>
      </label>
      <div id="profil-tags" class="pp-tags-edit">
        ${(pres?.tags||[]).map(t => _tagChip(t)).join('')}
      </div>
      <div style="display:flex;gap:.4rem;margin-top:.4rem">
        <input class="input-field" id="profil-tag-input" placeholder="Ajouter un trait…"
          style="flex:1" ${(pres?.tags||[]).length >= TAG_MAX ? 'disabled' : ''}
          onkeydown="if(event.key==='Enter'){event.preventDefault();addProfilTag();}">
        <button class="btn btn-outline btn-sm" id="profil-tag-add" type="button"
          onclick="addProfilTag()" ${(pres?.tags||[]).length >= TAG_MAX ? 'disabled' : ''}>＋</button>
      </div>
      <div class="pp-tag-suggestions">
        ${TAG_SUGGESTIONS.map(s => `<button type="button" class="pp-tag-suggest" onclick="addProfilTag('${_esc(s)}')">${_esc(s)}</button>`).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>Présentation</label>
      ${richTextEditorHtml({ id: 'profil-content', html: content, minHeight: 200, placeholder: 'Décris librement ton personnage…' })}
    </div>

    <div class="form-group">
      <label>Illustration <span style="color:var(--text-dim);font-size:.75rem">(indépendante de la photo de profil)</span></label>
      <div style="display:flex;align-items:center;gap:.75rem">
        ${imageUrl
          ? `<img src="${_esc(imageUrl)}" style="width:56px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">`
          : `<div style="width:56px;height:72px;border-radius:8px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--text-dim)">🖼️</div>`}
        <div>
          <button class="btn btn-outline btn-sm" type="button" onclick="openProfilImageUpload('${_esc(c.id)}')">
            ${imageUrl ? '🔄 Changer' : '📷 Ajouter une illustration'}
          </button>
          ${imageUrl ? `<button class="btn btn-outline btn-sm" style="color:#ff6b6b;margin-left:.35rem" type="button" onclick="removeProfilImage('${_esc(c.id)}')">✕ Retirer</button>` : ''}
        </div>
      </div>
    </div>

    <div style="background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem">
      <div style="font-size:.7rem;font-weight:700;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.65rem">
        🔒 Éléments visibles par les joueurs
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem">
        ${CHECKS.map(f => `<label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.8rem;color:var(--text-muted);padding:.15rem 0">
          <input type="checkbox" id="${f.id}" ${cb(f.key, f.def)?'checked':''} style="accent-color:var(--gold)">
          ${f.label}
        </label>`).join('')}
      </div>
    </div>

    <button class="btn btn-gold btn-sm" onclick="saveCharProfil('${_esc(c.id)}')">💾 Sauvegarder</button>
  </div>`;
}

export async function saveCharProfil(charId) {
  try {
    const content = getRichTextHtml('profil-content');
    const tags = [...(document.getElementById('profil-tags')?.querySelectorAll('.pp-tag-chip') || [])]
      .map(el => el.dataset.tag).filter(Boolean);
    const data = {
      charId,
      uid:           STATE.user?.uid || '',
      chapitre:      document.getElementById('profil-chap')?.value?.trim()   || '',
      content,
      tags,
      imageUrl:      _profilCache[charId]?.imageUrl || '',
      visible:       _profilCache[charId]?.visible !== false,
      ordre:         _profilCache[charId]?.ordre ?? 999,
      afficherPV:    document.getElementById('profil-pv')?.checked    ?? true,
      afficherPM:    document.getElementById('profil-pm')?.checked    ?? true,
      afficherCA:    document.getElementById('profil-ca')?.checked    ?? true,
      afficherOr:    document.getElementById('profil-or')?.checked    ?? false,
      afficherStats: document.getElementById('profil-stats')?.checked ?? true,
      afficherNiveau:document.getElementById('profil-lvl')?.checked   ?? true,
    };
    // Utilise l'ID existant ou le charId comme fallback — saveDoc gère create ET update
    const docId = _profilCache[charId]?.id || charId;
    await saveDoc('players', docId, data);
    _profilCache[charId] = { ...(_profilCache[charId] || {}), id: docId, ...data };
    showNotif('Présentation sauvegardée !', 'success');
  } catch (e) {
    console.error('[profil]', e);
    showNotif(`Erreur de sauvegarde (${e?.code || e?.message || '?'}).`, 'error');
  }
}

export function invalidateProfilCache(charId) {
  delete _profilCache[charId];
}

export function openProfilImageUpload(charId) {
  // TODO: réutiliser le crop existant si nécessaire — pour l'instant simple input file
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = 'image/*';
  fi.style.cssText = 'position:absolute;opacity:0;width:0;height:0';
  document.body.appendChild(fi);
  fi.addEventListener('change', async () => {
    const file = fi.files[0]; fi.remove();
    if (!file?.type.startsWith('image/')) return;
    // Compression avant stockage Firestore (limite 1 MB par doc)
    const b64  = await uploadJpeg(file, { max: 600, quality: 0.82 });
    const pres = _profilCache[charId];
    const data = pres ? { imageUrl: b64 } : { charId, uid: STATE.user?.uid || '', imageUrl: b64, visible: true, ordre: 999, content: '' };
    if (pres?.id) {
      await updateInCol('players', pres.id, { imageUrl: b64 });
      _profilCache[charId] = { ...pres, imageUrl: b64 };
    } else {
      const newId = await addToCol('players', data);
      _profilCache[charId] = { id: newId, ...data };
    }
    const c = STATE.characters.find(x=>x.id===charId) || STATE.activeChar;
    if (c && window._currentCharTab === 'profil') window._renderTab('profil', c, true);
  });
  fi.click();
}

export async function removeProfilImage(charId) {
  const pres = _profilCache[charId];
  if (!pres?.id) return;
  await updateInCol('players', pres.id, { imageUrl: '' });
  _profilCache[charId] = { ...pres, imageUrl: '' };
  const c = STATE.characters.find(x=>x.id===charId) || STATE.activeChar;
  if (c && window._currentCharTab === 'profil') window._renderTab('profil', c, true);
}
