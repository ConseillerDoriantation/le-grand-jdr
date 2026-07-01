// ══════════════════════════════════════════════════════════════════════════════
// CHARACTERS / LEDGER.JS — Onglet « Compte » (livret du trésor)
//
// Extrait de characters.js. Lit le schéma existant c.compte = { recettes:[],
// depenses:[] } et fusionne les deux flux en une timeline triée chronologiquement
// décroissante. Re-render via le seam charSession.renderTab('compte', …)
// (équivalent à _renderTabV3('compte', …) — 'compte' ∈ V3_TABS).
//
// Exporte renderCharLedger (routeur d'onglet) + les handlers câblés par
// characters.js (registre data-action / data-input / data-blur).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { updateInCol } from '../../data/firestore.js';
import { _esc, _norm } from '../../shared/html.js';
import { calcOr } from '../../shared/char-stats.js';
import { getCharacterById } from '../../shared/character-state.js';
import { showNotif } from '../../shared/notifications.js';

// État module-local (préservé au re-render, comme dans characters.js)
let _csV3LedgerFilter = { kind: 'all', search: '', limit: 25 };
let _csV3LedgerAddKind = 'recettes';

// ── Dates du livret : un seul parseur tolérant pour TOUTES les origines ───────
// Sources possibles : ISO "AAAA-MM-JJ" (ajout manuel via <input type=date>),
// FR "JJ/MM/AAAA" (ventes / economy.js), FR court "JJ/MM/AA", sinon texte libre
// (édition inline). Retourne {y, mo, d} ou null si non reconnue.
const _LEDGER_MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
function _parseLedgerDate(s) {
  const v = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);      // ISO AAAA-MM-JJ
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);        // FR JJ/MM/AAAA
  if (m) return { y: +m[3], mo: +m[2], d: +m[1] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(v);        // FR court JJ/MM/AA
  if (m) return { y: 2000 + (+m[3]), mo: +m[2], d: +m[1] };
  return null;
}
const _2d = (n) => String(n).padStart(2, '0');
// Clé numérique AAAAMMJJ pour le tri chronologique (0 = inconnue → en bas).
function _ledgerDateKey(s) {
  const p = _parseLedgerDate(s);
  return p ? p.y * 10000 + p.mo * 100 + p.d : 0;
}
// Affichage homogène "JJ/MM/AAAA" quelle que soit l'origine.
// Date non reconnue → on renvoie le texte brut (édition libre) ou « — ».
function _ledgerDateDisplay(s) {
  const p = _parseLedgerDate(s);
  if (!p) return String(s || '').trim() || '—';
  return `${_2d(p.d)}/${_2d(p.mo)}/${p.y}`;
}
// En-tête de groupe « Mois AAAA ». Non reconnue → « Sans date ».
function _ledgerMonthLabel(s) {
  const p = _parseLedgerDate(s);
  if (!p || p.mo < 1 || p.mo > 12) return 'Sans date';
  return `${_LEDGER_MOIS_FR[p.mo - 1]} ${p.y}`;
}

export function renderCharLedger(c, canEdit) {
  // ⚠️ Toujours re-fetch la référence FRAÎCHE en cas de re-render asynchrone
  const fresh = STATE.characters.find(x => x.id === c.id) || c;
  c = fresh;
  const compte = c.compte || { recettes: [], depenses: [] };
  const recettes = (compte.recettes || []).map((r, i) => ({ ...r, sign: 1, kind: 'recettes', idx: i }));
  const depenses = (compte.depenses || []).map((d, i) => ({ ...d, sign: -1, kind: 'depenses', idx: i }));
  const tR = recettes.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0);
  const tD = depenses.reduce((s, d) => s + (parseFloat(d.montant) || 0), 0);
  const solde = tR - tD;
  const fmt = (n) => {
    const v = Math.round((parseFloat(n) || 0) * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  };
  // Tri chronologique décroissant via une clé numérique AAAAMMJJ qui gère les
  // deux formats stockés (ISO et FR). À date égale → dernière insertion en haut
  // (idx élevé = ajouté plus récemment dans son tableau).
  const all = [...recettes, ...depenses].sort((a, b) => {
    const ka = _ledgerDateKey(a.date), kb = _ledgerDateKey(b.date);
    if (ka !== kb) return kb - ka; // plus récent en haut ; date inconnue (0) en bas
    return (b.idx || 0) - (a.idx || 0);
  });

  // Filtres (état module-local pour ne pas être perdu au re-render)
  const filter = _csV3LedgerFilter;
  const q = _norm(filter.search || '');   // minuscules + sans accents
  const filtered = all.filter(e => {
    if (filter.kind === 'rcpt' && e.sign < 0) return false;
    if (filter.kind === 'dep'  && e.sign > 0) return false;
    if (!q) return true;
    return _norm(e.libelle || '').includes(q)
        || _norm(e.date || '').includes(q);
  });
  const limit = filter.limit || 25;
  const visible = filtered.slice(0, limit);
  const hasMore = filtered.length > visible.length;

  // Groupement par mois via le parseur tolérant (gère ISO et FR indifféremment).
  const groups = [];
  let curMonth = null;
  visible.forEach(e => {
    const month = _ledgerMonthLabel(e.date);
    if (month !== curMonth) {
      curMonth = month;
      groups.push({ month, items: [] });
    }
    groups[groups.length - 1].items.push(e);
  });

  const addKind = _csV3LedgerAddKind === 'depenses' ? 'depenses' : 'recettes';
  return `
  <div class="compte-summary">
    <div class="compte-tile">
      <span class="compte-tile-ico" style="color:var(--emerald)">↗</span>
      <div class="compte-tile-body">
        <span class="compte-lbl">Recettes</span>
        <span class="compte-val pos">+${fmt(tR)} <small>or</small></span>
        <span class="compte-sub">${recettes.length} entrée${recettes.length>1?'s':''}</span>
      </div>
    </div>
    <div class="compte-tile">
      <span class="compte-tile-ico" style="color:var(--crimson-light,#ff8ca7)">↘</span>
      <div class="compte-tile-body">
        <span class="compte-lbl">Dépenses</span>
        <span class="compte-val neg">−${fmt(tD)} <small>or</small></span>
        <span class="compte-sub">${depenses.length} entrée${depenses.length>1?'s':''}</span>
      </div>
    </div>
    <div class="compte-tile main">
      <span class="compte-tile-ico" style="color:var(--amber,#f4c430)">💰</span>
      <div class="compte-tile-body">
        <span class="compte-lbl">Solde — Bourse</span>
        <span class="compte-val gold">${fmt(solde)} <small>or</small></span>
        <span class="compte-sub">Disponible en jeu</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">📜</span> Journal du trésor</div>
      <span class="section-hint">${filtered.length} / ${all.length} écriture${all.length>1?'s':''}</span>
    </div>

    <!-- Filtres -->
    <div class="ledger-filters">
      <div class="ledger-filter-segs">
        <button class="${filter.kind==='all'?'on':''}" data-action="csV3LedgerSetKind" data-id="${c.id}" data-kind="all">Tout</button>
        <button class="${filter.kind==='rcpt'?'on':''}" data-action="csV3LedgerSetKind" data-id="${c.id}" data-kind="rcpt" style="color:var(--emerald)">+ Recettes</button>
        <button class="${filter.kind==='dep'?'on':''}" data-action="csV3LedgerSetKind" data-id="${c.id}" data-kind="dep" style="color:var(--crimson-light, #ff8ca7)">− Dépenses</button>
      </div>
      <input type="text" class="ledger-search" placeholder="🔍 Rechercher…"
        value="${_esc(filter.search)}"
        data-input="_csV3LedgerSetSearch" data-id="${c.id}">
    </div>

    ${canEdit ? `
    <div class="ledger-add ${addKind==='depenses'?'is-dep':'is-rcpt'}">
      <div class="ledger-add-seg">
        <button type="button" class="${addKind==='recettes'?'on rcpt':''}"
          data-action="csV3LedgerSetAddKind" data-id="${c.id}" data-kind="recettes">↗ Recette</button>
        <button type="button" class="${addKind==='depenses'?'on dep':''}"
          data-action="csV3LedgerSetAddKind" data-id="${c.id}" data-kind="depenses">↘ Dépense</button>
      </div>
      <div class="ledger-add-fields">
        <label class="ledger-add-field">
          <span>Date</span>
          <input type="date" id="ledger-date"
            value="${_csV3TodayISO()}" class="ledger-add-date"
            data-enter-click="[data-action=csV3AddLedger]">
        </label>
        <label class="ledger-add-field ledger-add-field-lib">
          <span>Libellé</span>
          <input type="text" id="ledger-lib" placeholder="${addKind==='recettes'?'Pillage du gobelin…':'Auberge du nain…'}" class="lib"
            data-enter-click="[data-action=csV3AddLedger]">
        </label>
        <label class="ledger-add-field ledger-add-field-amt">
          <span>Montant (or)</span>
          <input type="number" id="ledger-amount" placeholder="0" step="any" min="0" class="ledger-add-amount"
            data-enter-click="[data-action=csV3AddLedger]">
        </label>
      </div>
      <button class="ledger-add-btn ${addKind}" data-action="csV3AddLedger" data-id="${c.id}">
        ${addKind==='recettes'?'＋ Encaisser':'− Décaisser'}
      </button>
    </div>` : ''}

    ${filtered.length === 0 ? `<div class="q-empty">${all.length===0?"Aucune écriture pour l'instant.":"Aucun résultat avec ce filtre."}</div>` : `
    <div class="ledger-scroll">
      <ol class="ledger">
        ${groups.map(g => `
          <li class="ledger-month">${_esc(g.month)}</li>
          ${g.items.map(e => {
            const editAttr = canEdit
              ? `contenteditable="true" spellcheck="false"
                  data-blur="csV3LedgerSaveField" data-kind="${e.kind}" data-idx="${e.idx}" data-field="$FIELD$"
                  data-enter="blur" data-esc="revert-blur"`
              : '';
            return `<li class="ledger-row ${e.sign>0?'rcpt':'dep'}">
              <span class="ledger-sign" title="${e.sign>0?'Recette':'Dépense'}">${e.sign>0?'↗':'↘'}</span>
              <span class="ledger-lib" ${editAttr.replace('$FIELD$', 'libelle')}>${_esc(e.libelle || (canEdit?'Sans libellé':''))}</span>
              <span class="ledger-date" ${editAttr.replace('$FIELD$', 'date')}>${_esc(_ledgerDateDisplay(e.date))}</span>
              <span class="ledger-amount-wrap">
                <span class="ledger-sgn">${e.sign>0?'+':'−'}</span><span class="ledger-amount" ${canEdit
                  ? `contenteditable="true" spellcheck="false"
                      data-blur="csV3LedgerSaveAmount" data-kind="${e.kind}" data-idx="${e.idx}" data-sign="${e.sign}"
                      data-enter="blur" data-esc="revert-blur"`
                  : ''}>${fmt(Math.abs(parseFloat(e.montant)||0))}</span><small class="ledger-or-suffix">or</small>
              </span>
              ${canEdit?`<button class="ledger-del" title="Supprimer" data-action="csV3DeleteLedger" data-id="${c.id}" data-kind="${e.kind}" data-idx="${e.idx}">🗑</button>`:'<span></span>'}
            </li>`;
          }).join('')}
        `).join('')}
      </ol>
    </div>
    ${hasMore ? `<button class="ledger-more" data-action="csV3LedgerMore" data-id="${c.id}">↓ Charger ${Math.min(25, filtered.length - visible.length)} de plus (${filtered.length - visible.length} restantes)</button>` : ''}
    `}
  </div>`;
}

// Helper : récupère la référence FRAÎCHE du char depuis STATE (jamais une copie stale)
function _csV3GetFreshChar(charId) {
  return STATE.characters.find(x => x.id === charId)
      || (charSession.getCurrentChar()?.id === charId ? charSession.getCurrentChar() : null)
      || STATE.activeChar;
}
function _csV3SyncCharRefs(c) {
  if (!c) return;
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (charSession.getCurrentChar()?.id === c.id) charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
}
// Met à jour le solde de la bourse partout (sans tout re-render)
function _csV3RefreshBourse(c) {
  const value = String(calcOr(c));
  // 1) Tous les spans dédiés (hero badge + side card si markup à jour)
  document.querySelectorAll('.cs-or-amount, .or-card-amount').forEach(el => { el.textContent = value; });
  // 2) Fallback robuste : tout .or-card-val (peu importe le markup interne),
  //    on reconstruit "VAL or" en préservant le <small> existant.
  document.querySelectorAll('.or-card-val').forEach(el => {
    // Si on a déjà un span .or-card-amount à l'intérieur, il est déjà à jour.
    if (el.querySelector('.or-card-amount')) return;
    const small = el.querySelector('small');
    const smallHtml = small ? small.outerHTML : '<small style="font-size:.65rem;color:var(--text-dim)">or</small>';
    el.innerHTML = `<span class="or-card-amount">${value}</span> ${smallHtml}`;
  });
  // 3) Helper legacy (anciennes sidebars éventuelles)
  try { charSession.refresh(c); } catch {}
}
// Date du jour au format ISO court YYYY-MM-DD (compatible artisan + tri propre)
function _csV3TodayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
// Sauvegarde inline d'un champ texte (date / libelle) d'une écriture
export async function _csV3LedgerSaveField(el, kind, idx, field) {
  const charId = charSession.getCurrentChar()?.id; if (!charId) return;
  const c = _csV3GetFreshChar(charId); if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  const row = (c.compte[kind] || [])[idx]; if (!row) return;
  const newVal = (el.textContent || '').trim();
  // Date affichée normalisée : ne pas réécrire si elle désigne la même date que
  // la valeur stockée (format potentiellement différent : ISO vs FR).
  if (field === 'date') {
    const pa = _parseLedgerDate(newVal), pb = _parseLedgerDate(row.date);
    if (pa && pb && pa.y === pb.y && pa.mo === pb.mo && pa.d === pb.d) return;
  }
  if ((row[field] || '') === newVal) return;
  row[field] = newVal;
  _csV3SyncCharRefs(c);
  try {
    await updateInCol('characters', c.id, { compte: c.compte });
    // Si on a modifié la date, re-render pour refléter le nouveau tri/groupement
    if (field === 'date' && charSession.getCurrentCharTab() === 'compte') {
      charSession.renderTab('compte', c, charSession.getCanEditChar());
    }
  } catch (e) {
    console.warn('[ledger field save]', e);
    el.textContent = el.dataset.original || '';
  }
}
// Sauvegarde inline du montant (gère le signe + ou −)
export async function _csV3LedgerSaveAmount(el, kind, idx, sign) {
  const charId = charSession.getCurrentChar()?.id; if (!charId) return;
  const c = _csV3GetFreshChar(charId); if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  const row = (c.compte[kind] || [])[idx]; if (!row) return;
  const txt = (el.textContent || '').replace(/[^\d.,\-]/g, '').replace(',', '.');
  const newVal = Math.abs(parseFloat(txt) || 0);
  if ((parseFloat(row.montant) || 0) === newVal) return;
  row.montant = newVal;
  _csV3SyncCharRefs(c);
  try {
    await updateInCol('characters', c.id, { compte: c.compte });
    _csV3RefreshBourse(c);
    // Re-render systématique pour actualiser les totaux/solde
    if (charSession.getCurrentCharTab() === 'compte') charSession.renderTab('compte', c, charSession.getCanEditChar());
  } catch (e) {
    console.warn('[ledger amount save]', e);
    el.textContent = el.dataset.original || '';
  }
}

export function _csV3LedgerSetAddKind(kind, charId) {
  _csV3LedgerAddKind = (kind === 'depenses') ? 'depenses' : 'recettes';
  // Préserve les valeurs déjà saisies avant le re-render
  const prevDate = document.getElementById('ledger-date')?.value || '';
  const prevLib  = document.getElementById('ledger-lib')?.value  || '';
  const prevAmt  = document.getElementById('ledger-amount')?.value || '';
  if (charId && charSession.getCurrentCharTab() === 'compte') {
    const c = _csV3GetFreshChar(charId);
    if (c) charSession.renderTab('compte', c, charSession.getCanEditChar());
  }
  // Restaure les valeurs sur les nouveaux inputs
  requestAnimationFrame(() => {
    const dEl = document.getElementById('ledger-date');
    const lEl = document.getElementById('ledger-lib');
    const aEl = document.getElementById('ledger-amount');
    if (dEl && prevDate) dEl.value = prevDate;
    if (lEl) lEl.value = prevLib;
    if (aEl) aEl.value = prevAmt;
    lEl?.focus();
  });
}

// Suppression d'une ligne (re-fetch + re-render explicite, SANS confirmation)
export async function _csV3DeleteLedger(charId, kind, idx) {
  const c = _csV3GetFreshChar(charId); if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  if (!(c.compte[kind] || [])[idx]) return;
  c.compte[kind].splice(idx, 1);
  _csV3SyncCharRefs(c);
  try {
    await updateInCol('characters', c.id, { compte: c.compte });
    _csV3RefreshBourse(c);
  } catch (e) { console.warn('[ledger del]', e); }
  if (charSession.getCurrentCharTab() === 'compte') charSession.renderTab('compte', c, charSession.getCanEditChar());
}

export function _csV3LedgerSetKind(charId, kind) {
  _csV3LedgerFilter = { ..._csV3LedgerFilter, kind, limit: 25 };
  const c = getCharacterById(charId);
  if (c && charSession.getCurrentCharTab() === 'compte') charSession.renderTab('compte', c, charSession.getCanEditChar());
}
export function _csV3LedgerSetSearch(charId, search) {
  _csV3LedgerFilter = { ..._csV3LedgerFilter, search, limit: 25 };
  const c = getCharacterById(charId);
  if (!c) return;
  // Re-render mais on restaure le focus + caret dans la search box
  const caret = document.querySelector('.ledger-search')?.selectionStart;
  if (charSession.getCurrentCharTab() === 'compte') charSession.renderTab('compte', c, charSession.getCanEditChar());
  requestAnimationFrame(() => {
    const inp = document.querySelector('.ledger-search');
    if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch {} }
  });
}
export function _csV3LedgerMore(charId) {
  _csV3LedgerFilter = { ..._csV3LedgerFilter, limit: (_csV3LedgerFilter.limit || 25) + 25 };
  const c = getCharacterById(charId);
  if (c && charSession.getCurrentCharTab() === 'compte') charSession.renderTab('compte', c, charSession.getCanEditChar());
}

// Ajoute une écriture au compte via le schéma existant `c.compte.{recettes,depenses}`.
export async function _csV3AddLedger(charId) {
  const dateEl = document.getElementById('ledger-date');
  const libEl  = document.getElementById('ledger-lib');
  const amtEl  = document.getElementById('ledger-amount');
  if (!libEl || !amtEl) return;
  const kind = _csV3LedgerAddKind === 'depenses' ? 'depenses' : 'recettes';
  const date = (dateEl?.value || '').trim() || _csV3TodayISO();
  const lib  = (libEl.value || '').trim();
  const amt  = Math.abs(parseFloat((amtEl.value || '').replace(',', '.')) || 0);
  if (!lib) { showNotif('Libellé requis.', 'error'); libEl.focus(); return; }
  if (!amt) { showNotif('Montant requis.', 'error'); amtEl.focus(); return; }
  const c = _csV3GetFreshChar(charId);
  if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  c.compte[kind] = c.compte[kind] || [];
  c.compte[kind].push({ date, libelle: lib, montant: amt });
  _csV3SyncCharRefs(c);
  try { await updateInCol('characters', charId, { compte: c.compte }); }
  catch (e) { showNotif('Erreur de sauvegarde.', 'error'); return; }
  _csV3RefreshBourse(c);
  // Re-render complet → totaux + tri + nouvelle ligne visibles
  if (charSession.getCurrentCharTab() === 'compte') charSession.renderTab('compte', c, charSession.getCanEditChar());
  // Focus l'input libellé pour la saisie en chaîne
  requestAnimationFrame(() => { document.getElementById('ledger-lib')?.focus(); });
}
