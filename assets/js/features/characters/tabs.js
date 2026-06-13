import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { updateInCol, loadCollection, loadCollectionWhere, addToCol, saveDoc } from '../../data/firestore.js';
import { trySave } from '../../shared/crud.js';
import { openModal, closeModal, confirmModal, promptModal } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { modStr, _esc } from '../../shared/html.js';
import { getMod, calcPVMax, calcPMMax, calcOr, calcPalier } from '../../shared/char-stats.js';
import { richTextEditorHtml, getRichTextHtml, richTextContentHtml } from '../../shared/rich-text.js';
import { uploadJpeg } from '../../shared/image-upload.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal } from '../../shared/upload-cloudinary.js';

import { getCharacterById } from '../../shared/character-state.js';
// ══════════════════════════════════════════════
// TAB : CARACTÉRISTIQUES
// ══════════════════════════════════════════════
export const STATS_KEYS = ['force','dexterite','intelligence','constitution','sagesse','charisme'];
let _openNote = null;

// Calcule l'état des points de niveau pour un personnage
function _computeLevelPoints(c) {
  const sLvl = c?.statsLevelUps || {};
  const earned = Math.max(0, (c?.niveau || 1) - 1);
  const spent  = STATS_KEYS.reduce((sum, k) => sum + (parseInt(sLvl[k]) || 0), 0);
  return { earned, spent, remaining: earned - spent };
}

export function renderCharCarac(c, canEdit) {
  const STATS_TAB = [
    {key:'force',label:'Force',abbr:'For'},
    {key:'dexterite',label:'Dextérité',abbr:'Dex'},
    {key:'intelligence',label:'Intelligence',abbr:'Int'},
    {key:'constitution',label:'Constitution',abbr:'Co'},
    {key:'sagesse',label:'Sagesse',abbr:'Sag'},
    {key:'charisme',label:'Charisme',abbr:'Cha'},
  ];
  const s     = c.stats || {force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb    = c.statsBonus    || {};
  const sBase = c.statsBase     || {};
  const sLvl  = c.statsLevelUps || {};
  const isMJ  = STATE.isAdmin;
  const { earned, spent, remaining } = _computeLevelPoints(c);

  const bannerCls = remaining > 0 ? 'go' : remaining < 0 ? 'warn' : 'ok';
  const bannerMsg = remaining > 0
    ? `🎯 <strong>${remaining}</strong> point${remaining>1?'s':''} de niveau à dépenser`
    : remaining < 0
      ? `⚠️ <strong>${Math.abs(remaining)}</strong> point${Math.abs(remaining)>1?'s':''} en trop`
      : earned === 0
        ? `✨ Aucun point à dépenser (niveau 1)`
        : `✅ Tous les points (${spent}/${earned}) alloués`;

  let html = `<div class="cs-caracs-tab">
  <!-- ── COLONNE PRINCIPALE : caracs ─────────────────────────── -->
  <div class="cs-section cs-caracs-tab-main">
    <div class="cs-section-title">📊 Caractéristiques
      <span class="cs-hint">Base : MJ · Niveau : joueur</span>
    </div>

    <!-- Bandeau points -->
    <div class="cs-lvlpts-banner cs-lvlpts-banner--${bannerCls}">
      <div class="cs-lvlpts-msg">${bannerMsg}</div>
      <div class="cs-lvlpts-meta">
        <span>Niveau ${c.niveau||1}</span>
        <span>${spent}/${earned} dépensés</span>
      </div>
    </div>

    <div class="cs-carac-detail-grid">
      <div class="cs-carac-detail-head">
        <span>Stat</span>
        <span title="Définie par le MJ">Base ${isMJ?'✎':'🔒'}</span>
        <span title="Points alloués via niveaux">Niveau</span>
        <span>Équip.</span>
        <span>Total</span>
        <span>Mod</span>
      </div>`;

  STATS_TAB.forEach(st => {
    const total      = s[st.key] || 8;
    const lvlUp      = sLvl[st.key] || 0;
    const base       = sBase[st.key] ?? Math.max(1, total - lvlUp);
    const equip      = sb[st.key] || 0;
    const finalTotal = total + equip;
    const m          = getMod(c, st.key);
    const equipStr   = equip > 0 ? `+${equip}` : String(equip);
    const lvlStr     = lvlUp > 0 ? `+${lvlUp}` : '0';
    const modClass   = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    const minusDis   = lvlUp <= 0;
    const plusDis    = remaining <= 0;

    html += `<div class="cs-carac-detail-row">
      <div class="cs-carac-name">
        <span class="cs-carac-name-lbl">${st.label}</span>
        <span class="cs-carac-name-abbr">${st.abbr}</span>
      </div>
      <div class="cs-carac-cell">
        <span class="cs-carac-chip cs-carac-chip--base ${isMJ?'cs-editable':''}"
              ${isMJ?`data-action="inlineEditStat" data-id="${c.id}" data-key="${st.key}" title="Modifier la base (MJ)"`:''}>
          ${base}
        </span>
      </div>
      <div class="cs-carac-cell cs-lvl-controls">
        ${canEdit ? `<button class="cs-lvl-btn cs-lvl-btn--minus" ${minusDis?'disabled':''}
          data-action="_allocStatPoint" data-id="${c.id}" data-key="${st.key}" data-delta="-1" title="Retirer un point">−</button>` : ''}
        <span class="cs-carac-chip cs-carac-chip--lvl${lvlUp>0?' cs-carac-chip--lvl-pos':''}">${lvlStr}</span>
        ${canEdit ? `<button class="cs-lvl-btn cs-lvl-btn--plus" ${plusDis?'disabled':''}
          data-action="_allocStatPoint" data-id="${c.id}" data-key="${st.key}" data-delta="1" title="${plusDis?'Aucun point disponible':'Ajouter un point'}">+</button>` : ''}
      </div>
      <div class="cs-carac-cell">
        <span class="cs-carac-chip${equip?' cs-carac-chip--equip-pos':''}">${equipStr}</span>
      </div>
      <div class="cs-carac-cell">
        <span class="cs-carac-chip cs-carac-chip--total">${finalTotal}</span>
      </div>
      <div class="cs-carac-cell">
        <span class="cs-carac-mod ${modClass}">${modStr(m)}</span>
      </div>
    </div>`;
  });
  html += `</div>
    <div class="cs-carac-footnote">
      <strong>Total</strong> = Base + Niveau + Équip. — le modificateur tient compte de l'équipement (plafond 22).
      ${isMJ?' · MJ : clic sur Base pour ajuster.':''}
    </div>
  </div>`;

  // ── Vitalité (PV / PM) avec formule décomposée ─────────────────────────────
  const niv     = c.niveau || 1;
  const lvlGain = Math.max(0, niv - 1);
  const modCo   = getMod(c, 'constitution');
  const modSa   = getMod(c, 'sagesse');
  const pvBase  = c.pvBase || 10;
  const pmBase  = c.pmBase || 10;
  const pvMaxV  = calcPVMax(c);
  const pmMaxV  = calcPMMax(c);
  const pvProg  = modCo > 0 ? Math.floor(modCo * lvlGain) : modCo;
  const pmProg  = modSa > 0 ? Math.floor(modSa * lvlGain) : modSa;

  // Carte vitale (PV ou PM)
  const _vitalCard = ({cls, icon, title, base, baseField, mod, modLbl, prog, max, helpPos, helpNeg}) => {
    const isPositive = mod > 0;
    return `<div class="cs-vital-card cs-vital-card--${cls}">
      <div class="cs-vital-card-hdr">
        <span class="cs-vital-card-title">${icon} ${title}</span>
        <span class="cs-vital-card-total">${max}</span>
      </div>
      <div class="cs-vital-formula">
        <span class="cs-vital-part ${canEdit?'cs-vital-part--edit':''}"
              ${canEdit?`data-action="inlineEditNum" data-id="${c.id}" data-field="${baseField}" data-min="1" data-max="999" title="Modifier la base (niv. 1)"`:''}>
          <span class="cs-vital-part-lbl">Base</span>
          <span class="cs-vital-part-val">${base}</span>
        </span>
        <span class="cs-vital-op">+</span>
        ${isPositive
          ? `<span class="cs-vital-part">
              <span class="cs-vital-part-lbl">${modLbl}</span>
              <span class="cs-vital-part-val">${mod>0?`+${mod}`:mod}</span>
            </span>
            <span class="cs-vital-op">×</span>
            <span class="cs-vital-part">
              <span class="cs-vital-part-lbl">Niveaux</span>
              <span class="cs-vital-part-val">${lvlGain}</span>
            </span>
            <span class="cs-vital-op">=</span>
            <span class="cs-vital-part cs-vital-part--prog">
              <span class="cs-vital-part-lbl">Progression</span>
              <span class="cs-vital-part-val">${prog>0?`+${prog}`:prog}</span>
            </span>`
          : `<span class="cs-vital-part cs-vital-part--neg" title="Malus appliqué une seule fois, pas par niveau">
              <span class="cs-vital-part-lbl">${modLbl}</span>
              <span class="cs-vital-part-val">${prog}</span>
            </span>`}
        <span class="cs-vital-eq">=</span>
        <span class="cs-vital-total">${max}</span>
      </div>
      <div class="cs-vital-help">
        ${isPositive ? helpPos.replace('{mod}', `+${mod}`).replace('{niv}', lvlGain) : helpNeg.replace('{mod}', mod)}
      </div>
    </div>`;
  };

  html += `<div class="cs-section cs-caracs-tab-side">
    <div class="cs-section-title">❤️ Vitalité
      <span class="cs-hint">${canEdit?'clic sur Base pour modifier':''}</span>
    </div>
    <div class="cs-vitals-cards">
      ${_vitalCard({
        cls:'pv', icon:'❤️', title:'Points de Vie',
        base:pvBase, baseField:'pvBase',
        mod:modCo, modLbl:'Mod. Con', prog:pvProg, max:pvMaxV,
        helpPos:'Tu gagnes {mod} PV par niveau au-delà du 1er ({niv} niveaux gagnés).',
        helpNeg:'Malus de Constitution ({mod}) appliqué une seule fois, pas par niveau.',
      })}
      ${_vitalCard({
        cls:'pm', icon:'🔵', title:'Points de Magie',
        base:pmBase, baseField:'pmBase',
        mod:modSa, modLbl:'Mod. Sag', prog:pmProg, max:pmMaxV,
        helpPos:'Tu gagnes {mod} PM par niveau au-delà du 1er ({niv} niveaux gagnés).',
        helpNeg:'Malus de Sagesse ({mod}) appliqué une seule fois, pas par niveau.',
      })}
    </div>

    <!-- XP -->
    ${(() => {
      const xpCur = c.exp || 0;
      const xpPal = calcPalier(niv);
      const xpPct = Math.min(100, Math.max(0, xpPal > 0 ? Math.round((xpCur / xpPal) * 100) : 0));
      return `<div class="cs-xp-card">
        <div class="cs-xp-card-hdr">
          <span class="cs-vital-card-title">⭐ Expérience</span>
          <span class="cs-vital-card-total">${xpCur} / ${xpPal}</span>
        </div>
        <div class="cs-xp-card-progress" title="${xpPct}% du palier">
          <div class="cs-xp-card-progress-fill" style="width:${xpPct}%"></div>
        </div>
        <div class="cs-xp-card-info">
          <span>${xpPct}% du palier</span>
          <span>→ Niveau <strong>${niv+1}</strong> à ${xpPal} XP</span>
        </div>
        ${canEdit ? `<div class="cs-xp-card-add">
          <label>+ Gagner de l'XP</label>
          <div class="cs-xp-card-add-row">
            <input id="cs-xp-delta-${c.id}" class="cs-xp-delta-input" type="number" min="0" placeholder="XP" title="XP à ajouter">
            <button class="cs-xp-add-btn" data-action="_csAddXp" data-id="${c.id}">Ajouter</button>
          </div>
        </div>` : ''}
      </div>`;
    })()}

    ${c.setBonusActif ? `<div class="cs-set-bonus-box">
      <div class="cs-set-bonus-title">✨ Bonus de Set actif</div>
      <div class="cs-set-bonus-text">${c.setBonusActif}</div>
    </div>` : ''}
  </div>

</div>`; // /cs-caracs-tab
  return html;
}

// ══════════════════════════════════════════════
// TAB : QUÊTES
// ══════════════════════════════════════════════
export function renderCharQuetes(c, canEdit) {
  const quetes = c.quetes||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📜 Journal de Quête
      ${canEdit?`<button class="btn btn-gold btn-sm" data-action="addQuete">+ Ajouter</button>`:''}
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
          ${canEdit?`<button class="btn-icon" data-action="toggleQuete" data-idx="${i}" title="${q.valide?'Rouvrir':'Valider'}">✔️</button>
                     <button class="btn-icon" data-action="deleteQuete" data-idx="${i}">🗑️</button>`:''}
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
      ${canEdit?`<button class="btn btn-gold btn-sm" data-action="addNote">+ Nouvelle note</button>`:''}
    </div>`;

  if (notes.length===0) {
    html += `<div class="cs-empty">Aucune note. Crée ta première note avec le bouton ci-dessus.</div>`;
  } else {
    notes.forEach((note, i) => {
      const isOpen = _openNote === i;
      html += `<div class="cs-note-card">
        <div class="cs-note-header" data-action="toggleNote" data-idx="${i}">
          <div class="cs-note-meta">
            <span class="cs-note-icon">📄</span>
            <span class="cs-note-title">${note.titre||'Note sans titre'}</span>
            ${note.date?`<span class="cs-note-date">${note.date}</span>`:''}
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center">
            ${canEdit?`<button class="btn-icon" data-action="editNoteTitle" data-idx="${i}" data-stop-propagation title="Renommer">✏️</button>
                       <button class="btn-icon" data-action="deleteNote" data-idx="${i}" data-stop-propagation title="Supprimer">🗑️</button>`:''}
            <span class="cs-note-chevron">${isOpen?'▲':'▼'}</span>
          </div>
        </div>
        ${isOpen?`<div class="cs-note-body">
          ${canEdit
            ? `${richTextEditorHtml({ id: `note-area-${i}`, html: note.contenu || '', placeholder: 'Contenu de la note...', minHeight: 180 })}
               <button class="btn btn-gold btn-sm" style="margin-top:0.6rem" data-action="saveNote" data-idx="${i}">💾 Enregistrer</button>`
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
  _openNote = _openNote === idx ? null : idx;
  charSession.renderTab('notes', charSession.getCurrentChar(), charSession.getCanEditChar());
}

export function addNote() {
  const c = STATE.activeChar; if(!c) return;
  const notes = c.notesList||[];
  const now = new Date().toLocaleDateString('fr-FR');
  notes.push({ titre: 'Nouvelle note', contenu: '', date: now });
  c.notesList = notes;
  _openNote = notes.length - 1;
  updateInCol('characters', c.id, {notesList: notes}).then(()=>{
    charSession.renderTab('notes', c, charSession.getCanEditChar());
  });
}

export async function editNoteTitle(idx) {
  const c = STATE.activeChar; if(!c) return;
  const note = (c.notesList||[])[idx];
  if (!note) return;
  const cur = note.titre||'Sans titre';
  const val = await promptModal('Titre de la note :', { title: 'Renommer la note', default: cur });
  if (val === null) return;
  note.titre = val.trim()||cur;
  c.notesList[idx] = note;
  updateInCol('characters', c.id, {notesList: c.notesList}).then(()=>{
    charSession.renderTab('notes', c, charSession.getCanEditChar());
    showNotif('Titre mis à jour !','success');
  });
}

export async function saveNote(idx) {
  const c = STATE.activeChar; if(!c) return;
  const html = getRichTextHtml(`note-area-${idx}`);
  if (!c.notesList?.[idx]) return;
  c.notesList[idx].contenu = html;
  if (await trySave('characters', c.id, {notesList: c.notesList})) showNotif('Note enregistrée !','success');
}

export async function deleteNote(idx) {
  const c = STATE.activeChar; if(!c) return;
  if (!await confirmModal('Supprimer cette note ?')) return;
  c.notesList.splice(idx, 1);
  if (_openNote >= c.notesList.length) _openNote = null;
  if (await trySave('characters', c.id, {notesList: c.notesList})) showNotif('Note supprimée.','success');
  charSession.renderTab('notes', c, charSession.getCanEditChar());
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

  const renderRow = (row, i, type, canEdit, extraClass = '', extraStyle = '') => {
    const trOpen = `<tr class="cs-compte-row${extraClass ? ' ' + extraClass : ''}"${extraStyle ? ` style="${extraStyle}"` : ''}>`;
    const montantClass = type==='recettes'?'cs-montant-pos':'cs-montant-neg';
    if (!canEdit) {
      return `${trOpen}
        <td>${_esc(row.date||'—')}</td>
        <td>${_esc(row.libelle||'—')}</td>
        <td class="${montantClass}">${row.montant||0} or</td>
      </tr>`;
    }
    return `${trOpen}
      <td><input class="cs-compte-input cs-compte-input-date" type="text" value="${_esc(row.date||'')}" placeholder="—"
        data-change="saveCompteField" data-compte-type="${type}" data-idx="${i}" data-field="date"
        data-enter="blur"></td>
      <td><input class="cs-compte-input cs-compte-input-libelle" type="text" value="${_esc(row.libelle||'')}" placeholder="Libellé…"
        data-change="saveCompteField" data-compte-type="${type}" data-idx="${i}" data-field="libelle"
        data-enter="blur"></td>
      <td class="${montantClass}">
        <input class="cs-compte-input cs-compte-input-montant" type="number" value="${row.montant||''}" placeholder="0"
          data-change="saveCompteField" data-compte-type="${type}" data-idx="${i}" data-field="montant"
          data-enter="blur"><span class="cs-compte-or-lbl">or</span>
      </td>
      <td><button class="btn-icon" data-action="deleteCompteRow" data-compte-type="${type}" data-idx="${i}">🗑️</button></td>
    </tr>`;
  };

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
            data-action="_toggleCompteHist" data-compte-type="${type}" data-count="${hidden.length}">
            ↑ Voir les ${hidden.length} entrées précédentes
          </button>
        </td>
      </tr>
      ${visible.map((r,i) => renderRow(r, hidden.length + i, type, canEdit)).join('')}`;
  };

  const otherChars = (STATE.characters||[]).filter(x => x.id !== c.id && x.nom);

  return `<div class="cs-section">
    <div class="cs-section-title">💰 Livret de Compte
      <button class="cs-send-gold-btn" data-action="openSendGoldModal" data-id="${c.id}" title="Envoyer de l'or à un autre personnage">↗ Envoyer de l'or</button>
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
          ${canEdit?`<button class="btn btn-gold btn-sm" data-action="addCompteRow" data-compte-type="recettes">+ Ajouter</button>`:''}
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
          ${canEdit?`<button class="btn btn-danger btn-sm" style="font-size:0.72rem" data-action="addCompteRow" data-compte-type="depenses">+ Ajouter</button>`:''}
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
    charSession.renderTab('compte', c, charSession.getCanEditChar());
    refreshOrDisplay(c);
    // Focus auto sur le montant de la nouvelle ligne (dernier input de sa colonne)
    const tableIdx = type === 'recettes' ? 0 : 1;
    const table = document.querySelectorAll('.cs-compte-table')[tableIdx];
    const inputs = table?.querySelectorAll('.cs-compte-input-montant');
    const last = inputs?.[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
}

export async function deleteCompteRow(type, idx) {
  const c = STATE.activeChar; if(!c) return;
  (c.compte||{})[type]?.splice(idx,1);
  await trySave('characters', c.id, {compte: c.compte});
  charSession.renderTab('compte', c, charSession.getCanEditChar());
  refreshOrDisplay(c);
}

export async function saveCompteField(type, idx, field, value) {
  const c = STATE.activeChar; if(!c) return;
  c.compte = c.compte || {recettes:[], depenses:[]};
  const list = c.compte[type] = c.compte[type] || [];
  if (!list[idx]) return;
  const newVal = field === 'montant' ? (parseFloat(value)||0) : ((value||'').trim());
  if (list[idx][field] === newVal) return;
  list[idx][field] = newVal;
  await trySave('characters', c.id, {compte: c.compte});
  if (field === 'montant') {
    _refreshCompteTotals(c);
    refreshOrDisplay(c);
  }
}

function _refreshCompteTotals(c) {
  const compte = c.compte || {recettes:[], depenses:[]};
  const totalR = (compte.recettes||[]).reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = (compte.depenses||[]).reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  const solde  = totalR - totalD;
  const vals = document.querySelectorAll('.cs-solde-bar .cs-solde-val');
  if (vals[0]) vals[0].textContent = `+${totalR} or`;
  if (vals[1]) vals[1].textContent = `−${totalD} or`;
  if (vals[2]) {
    vals[2].textContent = `${solde>=0?'+':''}${solde} or`;
    vals[2].classList.toggle('pos', solde>=0);
    vals[2].classList.toggle('neg', solde<0);
  }
  const tables = document.querySelectorAll('.cs-compte-table');
  const recFoot = tables[0]?.querySelector('tfoot .cs-montant-pos');
  const depFoot = tables[1]?.querySelector('tfoot .cs-montant-neg');
  if (recFoot) recFoot.textContent = `+${totalR} or`;
  if (depFoot) depFoot.textContent = `−${totalD} or`;
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
      ${canEdit ? `<button class="btn btn-gold btn-sm" data-action="addMaitrise">+ Ajouter</button>` : ''}
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
          <button class="btn-icon" data-action="editMaitrise" data-idx="${i}" title="Modifier">✏️</button>
          <button class="btn-icon cs-mait-del" data-action="deleteMaitrise" data-idx="${i}" title="Supprimer">🗑️</button>
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
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" data-action="saveMaitrise" data-idx="-1">Ajouter</button>
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
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" data-action="saveMaitrise" data-idx="${idx}">Enregistrer</button>
  `);
}

export async function saveMaitrise(idx) {
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
  if (await trySave('characters', c.id, { maitrises })) {
    closeModal();
    showNotif(idx < 0 ? `Maîtrise "${typeArme}" ajoutée !` : 'Maîtrise mise à jour.', 'success');
  }
  charSession.renderSheet(c, 'maitrises');
}

export async function deleteMaitrise(idx) {
  const c = STATE.activeChar; if (!c) return;
  const m = (c.maitrises || [])[idx];
  if (!await confirmModal(`Supprimer la maîtrise "${m?.typeArme||'?'}" ?`)) return;
  c.maitrises = (c.maitrises || []).filter((_, i) => i !== idx);
  if (await trySave('characters', c.id, { maitrises: c.maitrises })) showNotif('Maîtrise supprimée.', 'success');
  charSession.renderSheet(c, 'maitrises');
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

// ── Allocation d'un point de niveau sur une caractéristique ──────────────────
export async function allocStatPoint(charId, key, delta) {
  const c = getCharacterById(charId);
  if (!c) return;
  c.stats         = c.stats || {};
  c.statsBase     = c.statsBase || {};
  c.statsLevelUps = c.statsLevelUps || {};

  // Migration douce : snapshot de la base lors de la 1re interaction
  if (c.statsBase[key] === undefined) {
    c.statsBase[key] = Math.max(1, (c.stats[key] || 8) - (c.statsLevelUps[key] || 0));
  }

  const curLvl = c.statsLevelUps[key] || 0;
  const newLvl = curLvl + delta;
  if (newLvl < 0) return;

  // Garde-fou : ne pas dépasser les points gagnés
  if (delta > 0) {
    const { remaining } = _computeLevelPoints(c);
    if (remaining <= 0) {
      showNotif('Aucun point de niveau disponible.', 'error');
      return;
    }
  }

  c.statsLevelUps[key] = newLvl;
  c.stats[key] = (c.statsBase[key] || 8) + newLvl;

  await trySave('characters', charId, {
    stats:         c.stats,
    statsBase:     c.statsBase,
    statsLevelUps: c.statsLevelUps,
  });

  charSession.renderSheet(c, charSession.getCurrentCharTab());
}


export async function addXpFromInput(charId) {
  const input = document.getElementById(`cs-xp-delta-${charId}`);
  if (!input) return;
  const delta = parseInt(input.value);
  if (!delta || delta <= 0) return;
  const c = getCharacterById(charId);
  if (!c) return;
  const newXp = (parseInt(c.exp) || 0) + delta;
  await updateInCol('characters', charId, { exp: newXp });
  c.exp = newXp;
  input.value = '';
  const lbl = document.getElementById(`cs-xp-val-${charId}`);
  if (lbl) lbl.textContent = newXp;
}

export function toggleCompteHist(type, count) {
  const rows = document.querySelectorAll(`.cs-hist-old-${type}`);
  const btn  = document.getElementById(`cs-hist-btn-${type}`);
  if (!rows.length || !btn) return;
  const isOpen = rows[0].style.display !== 'none';
  rows.forEach(r => { r.style.display = isOpen ? 'none' : ''; });
  btn.textContent = isOpen
    ? `↑ Voir les ${count} entrées précédentes`
    : `↓ Masquer l'historique`;
}

export async function saveXpDirect(charId, input) {
  const c = getCharacterById(charId);
  if (!c) return;
  const palier = calcPalier(c.niveau||1);
  const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
  c.exp = val;
  input.value = val;
  previewXpBar(input, palier);
  if (await trySave('characters', charId, {exp: val})) showNotif('XP mis à jour !', 'success');
}

export async function addXpDelta(charId) {
  const input = document.getElementById(`xp-add-input-${charId}`);
  if (!input) return;
  const delta = parseInt(input.value);
  if (!delta || delta <= 0) return;
  const c = getCharacterById(charId);
  if (!c) return;
  const newXp = (parseInt(c.exp)||0) + delta;
  c.exp = newXp;
  input.value = '';
  if (await trySave('characters', charId, {exp: newXp})) showNotif(`+${delta} XP !`, 'success');
  // Rafraîchit la fiche pour que la barre/% et le total reflètent le nouvel XP.
  charSession.renderSheet?.(c, charSession.getCurrentCharTab());
}

// ══════════════════════════════════════════════
// TAB : PRÉSENTATION PUBLIQUE (players page)
// ══════════════════════════════════════════════
const _profilCache = {}; // charId → doc | null
// Exporte le cache pour permettre au profil V3 (dans characters.js) de lire
// la même source que renderCharProfil. Le chargement asynchrone reste géré
// par renderCharProfil ci-dessous.
export { _profilCache as getProfilCacheRef };

export function renderCharProfil(c, canEdit) {
  // Déclencheur de chargement uniquement : le rendu visuel du Profil est assuré
  // par renderCharProfilV3 (characters.js). On précharge juste le doc players
  // (bio/image) dans _profilCache, consommé par le V3.
  if (!(c.id in _profilCache)) _loadAndRenderProfil(c, canEdit);
}

async function _loadAndRenderProfil(c, canEdit) {
  try {
    const docs = await loadCollectionWhere('players', 'charId', '==', c.id);
    _profilCache[c.id] = docs[0] || null;
  } catch { _profilCache[c.id] = null; }
  if (charSession.getCurrentCharTab() === 'profil' && charSession.getCurrentChar()?.id === c.id)
    charSession.renderTab('profil', c, canEdit);
}

export function invalidateProfilCache(charId) {
  delete _profilCache[charId];
}

export function openProfilImageUpload(charId) {
  if (!hasCloudinaryConfig()) {
    showNotif('Configuration Cloudinary requise — saisis-la puis relance l\'upload.', 'error');
    openCloudinaryConfigModal();
    return;
  }
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = 'image/*';
  fi.style.cssText = 'position:absolute;opacity:0;width:0;height:0';
  document.body.appendChild(fi);
  fi.addEventListener('change', async () => {
    const file = fi.files[0]; fi.remove();
    if (!file?.type.startsWith('image/')) return;
    showNotif('Upload en cours…', 'info');
    try {
      // Compression JPEG puis upload Cloudinary (pas de base64 en Firestore)
      const b64full = await uploadJpeg(file, { max: 1400, quality: 0.88 });
      const { url: imageUrl } = await uploadCloudinary(b64full, {
        folder: 'characters',
        tags: ['profil', charId],
      });
      const pres = _profilCache[charId];
      const data = pres
        ? { imageUrl }
        : { charId, uid: STATE.user?.uid || '', imageUrl, visible: true, ordre: 999, content: '' };
      if (pres?.id) {
        await updateInCol('players', pres.id, { imageUrl });
        _profilCache[charId] = { ...pres, imageUrl };
      } else {
        const newId = await addToCol('players', data);
        _profilCache[charId] = { id: newId, ...data };
      }
      const c = getCharacterById(charId);
      if (c && charSession.getCurrentCharTab() === 'profil') charSession.renderTab('profil', c, true);
      showNotif('Illustration mise à jour !', 'success');
    } catch (e) {
      console.error('[profilImage]', e);
      showNotif(`Erreur upload : ${e?.message || '?'}`, 'error');
    }
  });
  fi.click();
}

export async function removeProfilImage(charId) {
  const pres = _profilCache[charId];
  if (!pres?.id) return;
  await updateInCol('players', pres.id, { imageUrl: '' });
  _profilCache[charId] = { ...pres, imageUrl: '' };
  const c = getCharacterById(charId);
  if (c && charSession.getCurrentCharTab() === 'profil') charSession.renderTab('profil', c, true);
}
