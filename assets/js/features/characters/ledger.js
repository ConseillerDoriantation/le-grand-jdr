import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { updateInCol } from '../../data/firestore.js';
import { _esc } from '../../shared/html.js';
import { calcOr } from '../../shared/char-stats.js';
import { getCharacterById } from '../../shared/character-state.js';
import { showNotif } from '../../shared/notifications.js';
import { useGold, useGoldMulti } from '../../shared/economy.js';
import { characterAvatarHtml } from '../../shared/portraits.js';
import { _loadTransferTargets, sendGoldTo } from './inventory.js';
import {
  endOfDayBalances, filterLedger, flattenLedger, ledgerRawBalance,
  ledgerSuggestions, parseLedgerDate, validateLedgerDelete, validateLedgerEdit,
} from '../../shared/ledger-logic.js';

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', send: '<path d="M7 17 17 7M8 7h9v9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', chev: '<path d="m9 6 6 6-6 6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  artisan: '<path d="m14 10-9 9a1.8 1.8 0 0 1-2.6-2.6l9-9"/><path d="m12.5 6.5 3-3 5 5-3 3z"/>',
  bastion: '<path d="M3 21V8l3-2v3h3V6l3-2 3 2v3h3V6l3 2v13"/><path d="M3 21h18"/><path d="M10 21v-5h4v5"/>',
  loot: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="M12 21 8.5 9 12 3l3.5 6z"/>',
  transfer: '<path d="M4 8h15l-4-4"/><path d="M20 16H5l4 4"/>',
  spell: '<path d="m12 3 1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="m18.5 15.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  manual: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  start: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const icon = (name, cls = '') => `<svg class="cpt-ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const SOURCE = {
  shop: { label: 'Boutique', icon: 'shop' }, artisan: { label: 'Artisan', icon: 'artisan' }, bastion: { label: 'Bastion', icon: 'bastion' },
  loot: { label: 'Butin', icon: 'loot' }, transfer: { label: 'Échanges', icon: 'transfer' }, spell: { label: 'Sorts', icon: 'spell' },
  manual: { label: 'Manuel', icon: 'manual' }, start: { label: 'Départ', icon: 'start' },
};
const AUTOMATIC_NOTE = {
  shop: 'Inscrit automatiquement par la Boutique. Le modifier ne change pas ton inventaire.',
  artisan: "Inscrit automatiquement par l'Artisan. Le modifier n'annule pas l'amélioration.",
  bastion: "Inscrit automatiquement par le Bastion. Le modifier n'annule pas l'investissement.",
  loot: 'Inscrit automatiquement lors du partage du butin.', spell: 'Inscrit automatiquement au lancement du sort.',
  transfer: "Lié à un échange : le modifier ne change pas la bourse de l'autre personnage.", start: "Créé automatiquement à partir de l'or de départ de la fiche.",
};
const COMPOSER = {
  add: { title: "Ajouter de l'or", help: "Butin, récompense, vente à un marchand… Les ventes de la Boutique s'inscrivent toutes seules.", placeholder: 'Ex. Récompense du bourgmestre' },
  sub: { title: "Retirer de l'or", help: "Auberge, services, pots-de-vin… Les achats de la Boutique et de l'Artisan s'inscrivent tout seuls.", placeholder: 'Ex. Auberge du Pont-Levis' },
  send: { title: "Envoyer de l'or", help: "L'or quitte ta bourse et arrive aussitôt dans celle du destinataire.", placeholder: 'Ex. Part du butin' },
};
const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const formatGold = value => NUMBER_FORMAT.format(Math.round((Number(value) || 0) * 100) / 100);
const roundGold = value => Math.round((Number(value) || 0) * 100) / 100;
const parseAmount = value => { const parsed = Number.parseFloat(String(value ?? '').replace(/[\s\u202f\u00a0]/g, '').replace(',', '.')); return Number.isFinite(parsed) ? roundGold(Math.abs(parsed)) : 0; };
const cleanAmount = value => String(value || '').replace(/[^\d.,]/g, '').replace(/[.,](?=.*[.,])/g, '');
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const two = value => String(value).padStart(2, '0');
const todayIso = () => { const date = new Date(); return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`; };
const dateFromKey = key => new Date(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100);
const dateToIso = value => { const p = parseLedgerDate(value); return p ? `${p.y}-${two(p.mo)}-${two(p.d)}` : ''; };
const blankDraft = date => ({ amount: '', reason: '', date: date || todayIso(), dateOpen: false, recipient: '' });

let ui = { charId: '', mode: '', draft: blankDraft(), filter: { kind: 'all', src: 'all', q: '', limit: 25 }, open: '', edit: null, targets: [], targetsLoaded: false, loadingTargets: false, flash: '' };
function ensureUi(charId) {
  if (ui.charId === charId) return;
  ui = { charId, mode: '', draft: blankDraft(), filter: { kind: 'all', src: 'all', q: '', limit: 25 }, open: '', edit: null, targets: [], targetsLoaded: false, loadingTargets: false, flash: '' };
}
function freshCharacter(charId) {
  return (STATE.characters || []).find(c => c.id === charId) || (charSession.getCurrentChar()?.id === charId ? charSession.getCurrentChar() : null) || (STATE.activeChar?.id === charId ? STATE.activeChar : null);
}
function syncCharacter(character) {
  if (!character) return;
  if (STATE.activeChar?.id === character.id) STATE.activeChar = character;
  if (charSession.getCurrentChar()?.id === character.id) charSession.set(character, charSession.getCanEditChar(), charSession.getCurrentCharTab());
}
function refreshBalance(character) {
  const value = formatGold(calcOr(character));
  document.querySelectorAll('.cs-or-amount, .or-card-amount').forEach(el => { el.textContent = value; });
  try { charSession.refresh(character); } catch {}
}
function rerender(charId, focusId = '', animateFrom = null) {
  const character = freshCharacter(charId);
  if (!character || charSession.getCurrentCharTab() !== 'compte') return;
  charSession.renderTab('compte', character, charSession.getCanEditChar());
  requestAnimationFrame(() => {
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    if (ui.flash) { document.querySelector(`.cpt-li[data-key="${CSS.escape(ui.flash)}"]`)?.classList.add('is-flash'); ui.flash = ''; }
    if (animateFrom != null) animateBalance(animateFrom, calcOr(character));
  });
}
function animateBalance(from, to) {
  const element = document.getElementById('cptBalance');
  if (!element || from === to) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { element.textContent = formatGold(to); return; }
  const start = performance.now();
  const duration = 520;
  const integral = Number.isInteger(from) && Number.isInteger(to);
  const step = now => {
    const progress = Math.min(1, (now - start) / duration);
    const value = from + (to - from) * (1 - Math.pow(1 - progress, 3));
    element.textContent = formatGold(integral ? Math.round(value) : roundGold(value));
    if (progress < 1) requestAnimationFrame(step);
    else element.textContent = formatGold(to);
  };
  requestAnimationFrame(step);
}
const activeFilters = () => ui.filter.kind !== 'all' || ui.filter.src !== 'all' || Boolean(ui.filter.q.trim());
function relativeDay(key) {
  if (!key) return 'à une date inconnue';
  const date = dateFromKey(key); const today = new Date(); today.setHours(0, 0, 0, 0); const days = Math.round((today - date) / 86400000);
  if (days === 0) return "aujourd'hui"; if (days === 1) return 'hier'; if (days > 1 && days < 7) return `il y a ${days} jours`;
  return `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}
function dayHeading(key) {
  if (!key) return '<b>Sans date</b><small>date non reconnue</small>';
  const date = dateFromKey(key); const today = new Date(); today.setHours(0, 0, 0, 0); const days = Math.round((today - date) / 86400000);
  const long = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  if (days === 0) return `<b>Aujourd'hui</b><small>${_esc(long)}</small>`; if (days === 1) return `<b>Hier</b><small>${_esc(long)}</small>`;
  return `<b>${_esc(long[0].toUpperCase() + long.slice(1))}</b>`;
}
function composerState(character) {
  const amount = parseAmount(ui.draft.amount); const balance = calcOr(character); const recipient = ui.targets.find(t => t.id === ui.draft.recipient);
  if (ui.mode === 'add') return amount > 0 ? { ok: true, label: `${icon('plus')}Ajouter ${formatGold(amount)} or`, after: roundGold(balance + amount) } : { ok: false, label: 'Ajouter' };
  if (ui.mode === 'send' && !recipient) return { ok: false, label: 'Choisis un destinataire', needsRecipient: true };
  if (!(amount > 0)) return { ok: false, label: ui.mode === 'send' ? `Envoyer à ${recipient?.nom || ''}` : 'Retirer' };
  if (amount > balance) return { ok: false, label: 'Solde insuffisant', missing: roundGold(amount - balance) };
  return { ok: true, label: ui.mode === 'send' ? `${icon('send')}Envoyer ${formatGold(amount)} or à ${_esc(recipient.nom || '')}` : `${icon('minus')}Retirer ${formatGold(amount)} or`, after: roundGold(balance - amount), recipient };
}
function previewHtml(character, state = composerState(character)) {
  const balance = calcOr(character);
  if (state.missing) return `<span class="bad">${icon('alert')}Il te manque ${formatGold(state.missing)} or</span> · ta bourse contient ${formatGold(balance)} or`;
  if (state.after != null) return `Bourse <b>${formatGold(balance)}</b> → <b class="to">${formatGold(state.after)}</b> or${state.recipient ? ` · ${_esc(state.recipient.nom)} reçoit <b>${formatGold(parseAmount(ui.draft.amount))} or</b>` : ''}`;
  if (state.needsRecipient) return 'Choisis à qui envoyer, puis le montant.';
  return `Bourse <b>${formatGold(balance)}</b> or`;
}
function targetHtml(target) {
  const subtitle = [target.ownerPseudo || target.ownerName || target.joueur, target.classe].filter(Boolean).join(' · ') || 'Personnage';
  return `<button type="button" class="cpt-to" role="radio" data-action="ledgerSetRecipient" data-id="${_esc(ui.charId)}" data-target-id="${_esc(target.id)}" aria-checked="${ui.draft.recipient === target.id}"><span class="cpt-av">${characterAvatarHtml(target, { size: 34 })}</span><span><b>${_esc(target.nom || 'Sans nom')}</b><small>${_esc(subtitle)}</small></span></button>`;
}
function composerHtml(character, entries) {
  if (!ui.mode) return '';
  const config = COMPOSER[ui.mode]; const state = composerState(character);
  const dateControl = ui.draft.dateOpen ? `<label class="cpt-date">${icon('cal')}<input type="date" id="cptDate" value="${_esc(ui.draft.date || todayIso())}" max="${todayIso()}" data-input="ledgerInputDate" data-id="${_esc(character.id)}" aria-label="Date du mouvement"></label>` : `<button type="button" class="cpt-lnk" data-action="ledgerToggleDate" data-id="${_esc(character.id)}">${icon('cal')}Aujourd'hui · <u>changer la date</u></button>`;
  const targets = ui.loadingTargets ? '<p class="cpt-loading">Chargement des destinataires…</p>' : ui.targets.length ? ui.targets.map(targetHtml).join('') : '<p class="cpt-loading">Aucun autre personnage disponible.</p>';
  const suggestions = ui.mode === 'send' ? '' : `<div class="cpt-sugs">${ledgerSuggestions(entries, ui.mode === 'add' ? 1 : -1).map(s => `<button type="button" class="cpt-sug" data-action="ledgerSetSuggestion" data-id="${_esc(character.id)}" data-value="${_esc(s)}" title="${_esc(s)}">${_esc(s)}</button>`).join('')}</div>`;
  return `<div class="cpt-cmp" data-mode="${ui.mode}" role="group" aria-label="${_esc(config.title)}"><div class="cpt-ch"><div><b>${_esc(config.title)}</b><small>${_esc(config.help)}</small></div><button type="button" class="cpt-x" data-action="ledgerSetMode" data-id="${_esc(character.id)}" data-mode="" aria-label="Fermer" title="Fermer (Échap)">${icon('x')}</button></div>${ui.mode === 'send' ? `<div class="cpt-fld"><span class="cpt-lb">Destinataire</span><div class="cpt-tos" role="radiogroup" aria-label="Destinataire">${targets}</div></div>` : ''}<div class="cpt-f"><label class="cpt-fld"><span class="cpt-lb">Montant</span><span class="cpt-amt"><input id="cptAmt" inputmode="decimal" autocomplete="off" placeholder="0" value="${_esc(ui.draft.amount)}" data-input="ledgerInputAmount" data-id="${_esc(character.id)}" aria-describedby="cptPrev"><i>or</i></span></label><div class="cpt-fld"><label class="cpt-lb" for="cptReason">Motif <em>· facultatif</em></label><input class="cpt-txt" id="cptReason" maxlength="80" autocomplete="off" placeholder="${_esc(config.placeholder)}" value="${_esc(ui.draft.reason)}" data-input="ledgerInputReason" data-id="${_esc(character.id)}">${suggestions}</div></div><div class="cpt-b">${ui.mode === 'send' ? '' : dateControl}<p class="cpt-prev" id="cptPrev" aria-live="polite">${previewHtml(character, state)}</p><button type="button" class="cpt-btn pri" id="cptCommit" data-action="ledgerCommit" data-id="${_esc(character.id)}"${state.ok ? '' : ' disabled'}>${state.label}</button></div></div>`;
}
function purseHtml(character, entries, canEdit) {
  const balance = calcOr(character); const last = entries[0];
  const action = (mode, iconName, label, disabled = false) => `<button type="button" class="cpt-act ${mode}" data-action="ledgerSetMode" data-id="${_esc(character.id)}" data-mode="${mode}" aria-pressed="${ui.mode === mode}"${disabled ? ' disabled title="Ta bourse est vide"' : ''}>${icon(iconName)}<span>${label}</span></button>`;
  return `<section class="cpt-purse"${ui.mode ? ` data-mode="${ui.mode}"` : ''} aria-label="Bourse"><div class="cpt-pt"><div><span class="cpt-k">${icon('coin')}Dans ta bourse</span><div class="cpt-num"><b id="cptBalance">${formatGold(balance)}</b><i>or</i></div><p class="cpt-last">${last ? `Dernier mouvement ${relativeDay(last.key)} · ${_esc(last.title)} <span class="${last.sign > 0 ? 'up' : ''}">${last.sign > 0 ? '+' : '−'}${formatGold(last.amount)}</span>` : "Aucun mouvement pour l'instant."}</p></div>${canEdit ? `<div class="cpt-acts">${action('add', 'plus', 'Ajouter')}${action('sub', 'minus', 'Retirer', balance <= 0)}${action('send', 'send', 'Envoyer', balance <= 0)}</div>` : `<p class="cpt-ro">${icon('lock')}Fiche d'un autre joueur : seuls son propriétaire et le MJ peuvent modifier la bourse.</p>`}</div>${canEdit ? composerHtml(character, entries) : ''}</section>`;
}
function filterSummary(entries, filtered) {
  if (!activeFilters()) return `${entries.length} mouvement${entries.length > 1 ? 's' : ''}`;
  if (!filtered.length) return `Aucun sur ${entries.length}<button type="button" class="cpt-lnk2" data-action="ledgerClearFilters" data-id="${_esc(ui.charId)}">Effacer les filtres</button>`;
  const net = roundGold(filtered.reduce((sum, e) => sum + e.sign * e.amount, 0));
  return `<b>${filtered.length}</b> sur ${entries.length} · ${net >= 0 ? '+' : '−'}${formatGold(Math.abs(net))} or au total<button type="button" class="cpt-lnk2" data-action="ledgerClearFilters" data-id="${_esc(ui.charId)}">Effacer les filtres</button>`;
}
function sourceFiltersHtml(entries) {
  const counts = entries.reduce((result, e) => ({ ...result, [e.src]: (result[e.src] || 0) + 1 }), {}); const order = ['shop', 'artisan', 'bastion', 'loot', 'transfer', 'spell', 'manual'];
  return `<div class="cpt-chips" role="group" aria-label="Filtrer par source"><button type="button" class="cpt-chip" data-action="ledgerSetSource" data-id="${_esc(ui.charId)}" data-source="all" aria-pressed="${ui.filter.src === 'all'}">Toutes <em>${entries.length}</em></button>${order.filter(s => counts[s]).map(s => `<button type="button" class="cpt-chip s-${s}" data-action="ledgerSetSource" data-id="${_esc(ui.charId)}" data-source="${s}" aria-pressed="${ui.filter.src === s}">${icon(SOURCE[s].icon)}${SOURCE[s].label} <em>${counts[s]}</em></button>`).join('')}</div>`;
}
function editState(character) {
  if (!ui.open || !ui.edit) return { ok: false, msg: '' };
  const [kind, rawIndex] = ui.open.split(':'); const row = character.compte?.[kind]?.[Number(rawIndex)];
  const validation = validateLedgerEdit(character.compte || {}, kind, Number(rawIndex), { sign: ui.edit.sign, montant: ui.edit.amount, libelle: ui.edit.reason });
  if (!validation.ok) return validation;
  const changed = parseAmount(ui.edit.amount) !== parseAmount(row?.montant) || ui.edit.sign !== (kind === 'recettes' ? 1 : -1) || ui.edit.reason.trim() !== String(row?.libelle || '') || ui.edit.date !== ui.edit.initialDate;
  return { ...validation, ok: changed, msg: '' };
}
function editorHtml(character, entry) {
  const state = editState(character); const note = AUTOMATIC_NOTE[entry.src];
  return `<div class="cpt-ed" role="group" aria-label="Corriger le mouvement"><div class="cpt-ed-f"><div class="cpt-fld"><span class="cpt-lb">Sens</span><div class="cpt-seg"><button type="button" class="g" data-action="ledgerSetEditSign" data-id="${_esc(character.id)}" data-sign="1" aria-pressed="${ui.edit.sign > 0}">Gain</button><button type="button" class="d" data-action="ledgerSetEditSign" data-id="${_esc(character.id)}" data-sign="-1" aria-pressed="${ui.edit.sign < 0}">Dépense</button></div></div><label class="cpt-fld"><span class="cpt-lb">Montant</span><span class="cpt-amt"><input id="cptEditAmount" inputmode="decimal" autocomplete="off" value="${_esc(ui.edit.amount)}" data-input="ledgerEditInput" data-field="amount" data-id="${_esc(character.id)}"><i>or</i></span></label><label class="cpt-fld grow"><span class="cpt-lb">Motif</span><input class="cpt-txt" id="cptEditReason" maxlength="100" autocomplete="off" value="${_esc(ui.edit.reason)}" data-input="ledgerEditInput" data-field="reason" data-id="${_esc(character.id)}"></label><label class="cpt-fld"><span class="cpt-lb">Date</span><input class="cpt-txt cpt-dt" id="cptEditDate" ${ui.edit.dateRecognized ? 'type="date"' : 'type="text"'} value="${_esc(ui.edit.date)}"${ui.edit.dateRecognized ? ` max="${todayIso()}"` : ''} data-input="ledgerEditInput" data-field="date" data-id="${_esc(character.id)}"></label></div>${note ? `<p class="cpt-note">${icon('info')}<span>${_esc(note)}</span></p>` : ''}<div class="cpt-ed-b"><button type="button" class="cpt-btn dng" data-action="ledgerDeleteEntry" data-id="${_esc(character.id)}">${icon('trash')}Supprimer</button><span class="msg" id="cptEditMessage" role="alert">${_esc(state.msg || '')}</span><button type="button" class="cpt-btn gh" data-action="ledgerToggleRow" data-id="${_esc(character.id)}" data-key="">Annuler</button><button type="button" class="cpt-btn pri" id="cptEditSave" data-action="ledgerSaveEntry" data-id="${_esc(character.id)}"${state.ok ? '' : ' disabled'}>Enregistrer</button></div></div>`;
}
function rowHtml(character, entry, canEdit) {
  const key = `${entry.kind}:${entry.idx}`; const open = ui.open === key;
  const body = `<span class="cpt-src s-${entry.src}" title="${_esc(SOURCE[entry.src].label)}">${icon(SOURCE[entry.src].icon)}</span><span class="cpt-rt"><b title="${_esc(entry.row?.libelle || '')}">${_esc(entry.title)}</b><small>${_esc(entry.sub)}</small></span><span class="cpt-am${entry.sign > 0 ? ' up' : ''}">${entry.sign > 0 ? '+' : '−'}${formatGold(entry.amount)}<i>or</i></span>`;
  return `<li class="cpt-li${open ? ' open' : ''}" data-key="${key}">${canEdit ? `<button type="button" class="cpt-row" data-action="ledgerToggleRow" data-id="${_esc(character.id)}" data-key="${key}" aria-expanded="${open}">${body}${icon('chev', 'cpt-chev')}</button>${open ? editorHtml(character, entry) : ''}` : `<div class="cpt-row">${body}</div>`}</li>`;
}
function historyListHtml(character, entries, filtered, canEdit) {
  if (!filtered.length) return `<div class="cpt-empty sm"><b>Aucun mouvement ne correspond</b><p>Essaie un autre mot, un montant ou une autre source.</p><button type="button" class="cpt-btn gh" data-action="ledgerClearFilters" data-id="${_esc(character.id)}">Effacer les filtres</button></div>`;
  const balances = endOfDayBalances(entries); const nets = new Map(); filtered.forEach(e => nets.set(e.key, roundGold((nets.get(e.key) || 0) + e.sign * e.amount))); const visible = filtered.slice(0, ui.filter.limit);
  let html = '', rows = '', currentKey;
  const flush = () => { if (currentKey === undefined) return; const net = nets.get(currentKey) || 0; html += `<section class="cpt-day"><header class="cpt-dh">${dayHeading(currentKey)}<span class="net${net > 0 ? ' up' : ''}">${net > 0 ? '+' : net < 0 ? '−' : ''}${formatGold(Math.abs(net))}</span>${activeFilters() ? '' : `<span class="bal" title="Solde en fin de journée">· solde <b>${formatGold(Math.max(0, balances.get(currentKey) || 0))}</b> or</span>`}</header><ul class="cpt-rows">${rows}</ul></section>`; rows = ''; };
  visible.forEach(e => { if (e.key !== currentKey) { flush(); currentKey = e.key; } rows += rowHtml(character, e, canEdit); }); flush();
  const remaining = filtered.length - visible.length;
  return `<div class="cpt-days">${html}</div>${remaining > 0 ? `<button type="button" class="cpt-more" data-action="csV3LedgerMore" data-id="${_esc(character.id)}">Afficher ${Math.min(25, remaining)} de plus<em>· ${remaining} restant${remaining > 1 ? 's' : ''}</em></button>` : ''}`;
}
function historyHtml(character, entries, canEdit) {
  if (!entries.length) return `<section class="cpt-h" aria-label="Historique"><div class="cpt-hh"><h3>Historique</h3></div><div class="cpt-empty">${icon('coin')}<b>Pas encore de mouvement</b><p>Achats, ventes, butin et échanges s'inscriront ici tout seuls.${canEdit ? " Commence par l'or de départ de ton personnage." : ''}</p>${canEdit ? `<button type="button" class="cpt-btn pri add" data-action="ledgerStartBalance" data-id="${_esc(character.id)}">${icon('plus')}Ajouter l'or de départ</button>` : ''}</div></section>`;
  const filtered = filterLedger(entries, ui.filter);
  return `<section class="cpt-h" aria-label="Historique"><div class="cpt-hh"><h3>Historique</h3><p class="cpt-sum" id="cptSummary">${filterSummary(entries, filtered)}</p></div><div class="cpt-fb"><label class="cpt-q">${icon('search')}<input id="cptSearch" placeholder="Rechercher un motif, un montant, une date…" value="${_esc(ui.filter.q)}" autocomplete="off" aria-label="Rechercher dans l'historique" data-input="_csV3LedgerSetSearch" data-id="${_esc(character.id)}"><button type="button" class="cpt-qx" data-action="ledgerClearSearch" data-id="${_esc(character.id)}" aria-label="Effacer la recherche">${icon('x')}</button></label><div class="cpt-seg" role="group" aria-label="Sens">${[['all', 'Tout'], ['in', 'Gains'], ['out', 'Dépenses']].map(([v, l]) => `<button type="button" data-action="csV3LedgerSetKind" data-id="${_esc(character.id)}" data-kind="${v}" aria-pressed="${ui.filter.kind === v}">${l}</button>`).join('')}</div></div>${sourceFiltersHtml(entries)}<div class="cpt-list-host" id="cptList">${historyListHtml(character, entries, filtered, canEdit)}</div></section>`;
}

export function renderCharLedger(character, canEdit) {
  const fresh = freshCharacter(character.id) || character; ensureUi(fresh.id); const entries = flattenLedger(fresh.compte || {});
  return `<div class="cpt" id="cpt" data-char-id="${_esc(fresh.id)}">${purseHtml(fresh, entries, canEdit)}${historyHtml(fresh, entries, canEdit)}</div>`;
}
export async function ledgerSetMode(buttonOrMode, charIdArg) {
  const mode = typeof buttonOrMode === 'string' ? buttonOrMode : buttonOrMode?.dataset?.mode || ''; const charId = charIdArg || buttonOrMode?.dataset?.id || ui.charId; const character = freshCharacter(charId);
  if (!character) return; ensureUi(charId);
  if (!mode || ui.mode === mode) { ui.mode = ''; ui.draft = blankDraft(ui.draft.date); rerender(charId); return; }
  if (mode !== 'add' && calcOr(character) <= 0) return;
  ui.mode = mode; ui.open = ''; ui.edit = null; if (mode !== 'send') ui.draft.recipient = ''; rerender(charId, 'cptAmt');
  if (mode === 'send' && !ui.targetsLoaded && !ui.loadingTargets) {
    ui.loadingTargets = true; rerender(charId);
    try { ui.targets = await _loadTransferTargets(charId); } catch { ui.targets = []; }
    ui.loadingTargets = false; ui.targetsLoaded = true; rerender(charId, 'cptAmt');
  }
}
async function restoreCompte(character, previous) {
  const before = calcOr(character);
  try { await updateInCol('characters', character.id, { compte: previous }); character.compte = clone(previous); syncCharacter(character); refreshBalance(character); rerender(character.id, '', before); showNotif('Annulé', 'success'); }
  catch (error) { showNotif(error?.message || "Impossible d'annuler.", 'error'); }
}
export async function ledgerCommit(button) {
  const charId = button?.dataset?.id || ui.charId; const character = freshCharacter(charId); if (!character) return; const state = composerState(character); if (!state.ok) return;
  const amount = parseAmount(ui.draft.amount); const reason = ui.draft.reason.trim(); const before = clone(character.compte || { recettes: [], depenses: [] }); const oldBalance = calcOr(character);
  if (ui.mode === 'send') {
    const target = state.recipient; const result = await sendGoldTo(character.id, target.id, amount, reason, { fromChar: character, toChar: target });
    if (!result.ok) { showNotif(result.error || 'Transfert impossible.', 'error'); return; }
    ui.flash = `depenses:${(character.compte?.depenses || []).length - 1}`; ui.draft = { ...ui.draft, amount: '', reason: '', recipient: '' }; refreshBalance(character); rerender(charId, 'cptAmt', oldBalance);
    showNotif(`Envoi de ${formatGold(amount)} or à ${target.nom || 'joueur'}`, 'success', { duration: 7000, action: { label: 'Annuler', onClick: () => undoTransfer(character, target, amount) } }); return;
  }
  const sign = ui.mode === 'add' ? 1 : -1; const fallback = sign > 0 ? "Ajout d'or" : "Retrait d'or"; const date = ui.draft.date && ui.draft.date <= todayIso() ? ui.draft.date : todayIso();
  const result = await useGoldMulti(character.id, [{ delta: sign * amount, reason: reason || fallback, date }], { charObj: character, refreshUI: false });
  if (!result.ok) { showNotif(result.error || 'Mouvement impossible.', 'error'); return; }
  const kind = sign > 0 ? 'recettes' : 'depenses'; ui.flash = `${kind}:${(character.compte?.[kind] || []).length - 1}`; ui.draft = { ...ui.draft, amount: '', reason: '' }; refreshBalance(character); rerender(charId, 'cptAmt', oldBalance);
  showNotif(`${sign > 0 ? 'Ajout' : 'Retrait'} de ${formatGold(amount)} or · bourse ${formatGold(result.newBalance ?? oldBalance + sign * amount)} or`, 'success', { duration: 7000, action: { label: 'Annuler', onClick: () => restoreCompte(character, before) } });
}
export const ledgerSend = ledgerCommit;
async function undoTransfer(fromCharacter, toCharacter, amount) {
  const oldBalance = calcOr(fromCharacter);
  const debitTarget = await useGold(toCharacter.id, -amount, 'Annulation du don', { charObj: toCharacter, refreshUI: false }); if (!debitTarget.ok) { showNotif(debitTarget.error || "Impossible d'annuler l'envoi.", 'error'); return; }
  const creditSource = await useGold(fromCharacter.id, amount, 'Annulation du don', { charObj: fromCharacter, refreshUI: false });
  if (!creditSource.ok) { await useGold(toCharacter.id, amount, '↻ Annulation impossible', { charObj: toCharacter, refreshUI: false }); showNotif(creditSource.error || "Impossible d'annuler l'envoi.", 'error'); return; }
  refreshBalance(fromCharacter); rerender(fromCharacter.id, '', oldBalance); showNotif('Annulé', 'success');
}
export function ledgerInputAmount(element) {
  const character = freshCharacter(element.dataset.id || ui.charId); if (!character) return; const raw = element.value; const negative = /^\s*[-−]/.test(raw); const positive = /^\s*\+/.test(raw); const cleaned = cleanAmount(raw); ui.draft.amount = cleaned;
  if ((negative && ui.mode === 'add' && calcOr(character) > 0) || (positive && ui.mode === 'sub')) { ui.mode = negative ? 'sub' : 'add'; rerender(character.id, 'cptAmt'); return; }
  if (cleaned !== raw) element.value = cleaned; syncComposer(character);
}
export function ledgerInputReason(element) { ui.draft.reason = element.value; }
export function ledgerInputDate(element) { ui.draft.date = element.value > todayIso() ? todayIso() : element.value; }
function syncComposer(character) { const state = composerState(character); const preview = document.getElementById('cptPrev'); const button = document.getElementById('cptCommit'); if (preview) preview.innerHTML = previewHtml(character, state); if (button) { button.disabled = !state.ok; button.innerHTML = state.label; } }
export function ledgerSetRecipient(button) { ui.draft.recipient = button.dataset.targetId || ''; rerender(button.dataset.id || ui.charId, 'cptAmt'); }
export function ledgerSetSuggestion(button) { ui.draft.reason = button.dataset.value || ''; rerender(button.dataset.id || ui.charId, parseAmount(ui.draft.amount) > 0 ? 'cptCommit' : 'cptAmt'); }
export function ledgerToggleDate(button) { ui.draft.dateOpen = true; rerender(button.dataset.id || ui.charId, 'cptDate'); }
export function ledgerStartBalance(button) { ensureUi(button.dataset.id); ui.mode = 'add'; ui.draft = { ...blankDraft(ui.draft.date), reason: 'Or de départ' }; rerender(button.dataset.id, 'cptAmt'); }
export function _csV3LedgerSetKind(charId, kind) { ensureUi(charId); ui.filter = { ...ui.filter, kind, limit: 25 }; ui.open = ''; ui.edit = null; rerender(charId); }
export function ledgerSetSource(button) { const source = button.dataset.source || 'all'; ui.filter = { ...ui.filter, src: ui.filter.src === source && source !== 'all' ? 'all' : source, limit: 25 }; ui.open = ''; ui.edit = null; rerender(button.dataset.id || ui.charId); }
export function _csV3LedgerSetSearch(charId, search) {
  ensureUi(charId); ui.filter = { ...ui.filter, q: search, limit: 25 }; ui.open = ''; ui.edit = null; const character = freshCharacter(charId); if (!character) return;
  const entries = flattenLedger(character.compte || {}); const filtered = filterLedger(entries, ui.filter); const host = document.getElementById('cptList'); const summary = document.getElementById('cptSummary');
  if (host) host.innerHTML = historyListHtml(character, entries, filtered, charSession.getCanEditChar()); if (summary) summary.innerHTML = filterSummary(entries, filtered);
}
export function ledgerClearSearch(button) { ui.filter = { ...ui.filter, q: '', limit: 25 }; rerender(button.dataset.id || ui.charId, 'cptSearch'); }
export function ledgerClearFilters(button) { ui.filter = { kind: 'all', src: 'all', q: '', limit: 25 }; ui.open = ''; ui.edit = null; rerender(button.dataset.id || ui.charId); }
export function _csV3LedgerMore(charId) { ui.filter = { ...ui.filter, limit: ui.filter.limit + 25 }; rerender(charId); }
export function ledgerToggleRow(button) {
  const key = button.dataset.key || ''; const character = freshCharacter(button.dataset.id || ui.charId); if (!character) return;
  if (!key || ui.open === key) { ui.open = ''; ui.edit = null; rerender(character.id); return; }
  const [kind, rawIndex] = key.split(':'); const row = character.compte?.[kind]?.[Number(rawIndex)]; if (!row) return; const rawDate = String(row.date || '').trim(); const recognized = Boolean(parseLedgerDate(rawDate)) || !rawDate; const normalizedDate = recognized ? dateToIso(rawDate) : rawDate;
  ui.open = key; ui.edit = { sign: kind === 'recettes' ? 1 : -1, amount: formatGold(Math.abs(Number(row.montant) || 0)).replace(/[\s\u202f]/g, ''), reason: row.libelle || '', date: normalizedDate, initialDate: normalizedDate, dateRecognized: recognized }; rerender(character.id);
}
export function ledgerSetEditSign(button) { if (!ui.edit) return; ui.edit.sign = Number(button.dataset.sign) < 0 ? -1 : 1; rerender(button.dataset.id || ui.charId); }
export function ledgerEditInput(element) {
  if (!ui.edit) return; const field = element.dataset.field;
  if (field === 'amount') { const cleaned = cleanAmount(element.value); ui.edit.amount = cleaned; if (cleaned !== element.value) element.value = cleaned; } else if (field === 'reason') ui.edit.reason = element.value; else if (field === 'date') ui.edit.date = element.value;
  const character = freshCharacter(element.dataset.id || ui.charId); const state = character ? editState(character) : { ok: false, msg: '' }; const save = document.getElementById('cptEditSave'); const message = document.getElementById('cptEditMessage'); if (save) save.disabled = !state.ok; if (message) message.textContent = state.msg || '';
}
export async function ledgerSaveEntry(button) {
  const character = freshCharacter(button.dataset.id || ui.charId); if (!character || !ui.open || !ui.edit) return; const [kind, rawIndex] = ui.open.split(':'); const index = Number(rawIndex); const state = editState(character); if (!state.ok) return;
  const oldBalance = calcOr(character); const before = clone(character.compte || { recettes: [], depenses: [] }); const next = clone(before); const row = next[kind]?.[index]; if (!row) return; const nextKind = ui.edit.sign > 0 ? 'recettes' : 'depenses'; const date = ui.edit.date === ui.edit.initialDate ? row.date : ui.edit.dateRecognized && ui.edit.date > todayIso() ? todayIso() : ui.edit.date; const updated = { ...row, date, libelle: ui.edit.reason.trim(), montant: parseAmount(ui.edit.amount) };
  if (nextKind === kind) next[kind][index] = updated; else { next[kind].splice(index, 1); next[nextKind] = [...(next[nextKind] || []), updated]; }
  try { await updateInCol('characters', character.id, { compte: next }); character.compte = next; syncCharacter(character); ui.flash = `${nextKind}:${nextKind === kind ? index : next[nextKind].length - 1}`; ui.open = ''; ui.edit = null; refreshBalance(character); rerender(character.id, '', oldBalance); showNotif('Mouvement corrigé', 'success', { duration: 7000, action: { label: 'Annuler', onClick: () => restoreCompte(character, before) } }); }
  catch (error) { showNotif(error?.message || 'Correction impossible.', 'error'); }
}
export async function ledgerDeleteEntry(button) {
  const character = freshCharacter(button.dataset.id || ui.charId); if (!character || !ui.open) return; const [kind, rawIndex] = ui.open.split(':'); const index = Number(rawIndex); const validation = validateLedgerDelete(character.compte || {}, kind, index);
  if (!validation.ok) { const message = document.getElementById('cptEditMessage'); if (message) message.textContent = validation.msg; return; }
  const oldBalance = calcOr(character); const before = clone(character.compte || { recettes: [], depenses: [] }); const next = clone(before); next[kind].splice(index, 1);
  try { await updateInCol('characters', character.id, { compte: next }); character.compte = next; syncCharacter(character); ui.open = ''; ui.edit = null; refreshBalance(character); rerender(character.id, '', oldBalance); showNotif('Mouvement supprimé', 'success', { duration: 7000, action: { label: 'Annuler', onClick: () => restoreCompte(character, before) } }); }
  catch (error) { showNotif(error?.message || 'Suppression impossible.', 'error'); }
}
export async function openLedgerMode(charId, mode) {
  const character = getCharacterById(charId) || freshCharacter(charId);
  if (!character) return;
  ensureUi(charId);
  ui.mode = mode;
  ui.open = '';
  ui.edit = null;
  if (mode === 'send' && !ui.targetsLoaded && !ui.loadingTargets) {
    ui.loadingTargets = true;
    try { ui.targets = await _loadTransferTargets(charId); } catch { ui.targets = []; }
    ui.loadingTargets = false;
    ui.targetsLoaded = true;
    rerender(charId, 'cptAmt');
  }
}
if (typeof document !== 'undefined' && !globalThis.__characterLedgerKeysBound) {
  globalThis.__characterLedgerKeysBound = true;
  document.addEventListener('keydown', event => {
    const root = document.getElementById('cpt'); if (!root) return; const active = document.activeElement; const inside = root.contains(active);
    if (event.key === 'Escape' && (inside || active === document.body)) { if (ui.open) { ui.open = ''; ui.edit = null; rerender(ui.charId); event.preventDefault(); } else if (ui.mode) { ui.mode = ''; ui.draft = blankDraft(ui.draft.date); rerender(ui.charId); event.preventDefault(); } }
    if (event.key !== 'Enter' || !inside) return;
    if (['cptAmt', 'cptReason', 'cptDate'].includes(active.id)) { event.preventDefault(); const character = freshCharacter(ui.charId); if (character && composerState(character).ok) ledgerCommit({ dataset: { id: ui.charId } }); }
    else if (['cptEditAmount', 'cptEditReason', 'cptEditDate'].includes(active.id)) { event.preventDefault(); const character = freshCharacter(ui.charId); if (character && editState(character).ok) ledgerSaveEntry({ dataset: { id: ui.charId } }); }
  });
}
export { ledgerRawBalance };
