import { STATE } from '../../core/state.js';
import { getCachedCollection, loadCollection, updateInCol } from '../../data/firestore.js';
import { charSession } from '../../shared/char-session.js';
import { getCharacterById } from '../../shared/character-state.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { characterPortraitSrc } from '../../shared/portraits.js';
import {
  RELATION_LEVELS, cleanRelationLabel, normalizeRelationText, pendingRelations,
  reciprocalRelation, relationKind, relationLevel, relationNameMatch, sortRelations,
} from './relations-utils.js';

const SUGGESTIONS = ['Ami fidèle', 'Famille', 'Mentor', 'Rival', 'Dette', 'Pacte'];
const COLORS = ['#9d6fff', '#4f8cff', '#ff9544', '#22c38e', '#ff5a7e', '#7dd3fc', '#f4c430', '#bca0ff'];
const UI = new Map();
const SAVE_TIMERS = new Map();
let _npcCandidates = null;
let _npcCandidatesPromise = null;

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  net: '<circle cx="6" cy="7" r="3"/><circle cx="18" cy="7" r="3"/><circle cx="12" cy="18" r="3"/><path d="m8.5 9.5 2 5"/><path d="m15.5 9.5-2 5"/><path d="M9 7h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14a5 5 0 0 1 5 5"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  feather: '<path d="M20 4a7 7 0 0 0-10 0L5 9v10h10l5-5a7 7 0 0 0 0-10z"/><path d="M15 9 3 21"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>',
};

function _icon(name, cls = '') {
  return `<svg class="rl-ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function _state(c, canEdit) {
  let ui = UI.get(c.id);
  if (!ui) {
    ui = { q: '', level: 'all', sort: 'proximity', open: null, order: null, add: false, addQ: '', linkQ: '', flash: null };
    UI.set(c.id, ui);
  }
  ui.canEdit = canEdit;
  return ui;
}

function _char() {
  return charSession.getCurrentChar();
}

function _syncCharacter(c) {
  const active = charSession.getCurrentChar();
  if (active?.id === c.id && active !== c) active.relations = c.relations;
  const cached = (STATE.characters || []).find(item => item.id === c.id);
  if (cached && cached !== c) cached.relations = c.relations;
}

function _playerName(c) {
  return c?.playerName || c?.joueur || c?.ownerPseudo || c?.pseudo || 'joueur';
}

function _color(name) {
  let hash = 0;
  for (const char of normalizeRelationText(name)) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function _initial(name) {
  const clean = String(name || '?').replace(/^(?:(?:maître|maitre|dame|capitaine|mère|sœur|sire|le|la)\s+|l’)/i, '').trim();
  return (clean[0] || '?').toUpperCase();
}

function _view(c, rel, index) {
  const getChar = id => getCharacterById(id, null);
  const kind = relationKind(rel, getChar);
  const target = kind === 'pc' ? getChar(rel.charId) : null;
  const name = target?.nom || rel.nom || 'Sans nom';
  const sub = kind === 'pc'
    ? [rel.role || target?.classe, _playerName(target)].filter(Boolean).join(' · ')
    : (rel.role || (kind === 'npc' ? 'PNJ' : 'Sans fiche'));
  return {
    c, rel, index, kind, target, name, sub,
    level: relationLevel(rel.sent),
    label: cleanRelationLabel(rel.sentiment, rel.sent),
  };
}

function _reciprocal(c, view) {
  if (view.kind !== 'pc') return null;
  const rel = reciprocalRelation(view.target, c);
  if (!rel) return null;
  return { rel, level: relationLevel(rel.sent), label: cleanRelationLabel(rel.sentiment, rel.sent) };
}

function _highlight(value, query) {
  const text = String(value || '');
  const normalized = normalizeRelationText(text);
  const q = normalizeRelationText(query);
  if (!q) return _esc(text);
  const at = normalized.indexOf(q);
  if (at < 0) return _esc(text);
  return `${_esc(text.slice(0, at))}<mark class="rl-mk">${_esc(text.slice(at, at + q.length))}</mark>${_esc(text.slice(at + q.length))}`;
}

function _chip(level) {
  if (level == null) return '<span class="rl-lv none">Pas d’avis</span>';
  const item = RELATION_LEVELS[level];
  return `<span class="rl-lv" style="--lc:${item.color}"><i></i>${item.label}</span>`;
}

function _avatar(view) {
  const image = view.kind === 'pc' ? characterPortraitSrc(view.target) : view.rel.img;
  const color = view.kind === 'pc' ? (view.target?.auraColor || _color(view.name)) : _color(view.name);
  const classes = ['rl-av', view.kind === 'npc' ? 'npc' : '', view.kind === 'free' ? 'free' : '', image ? 'img' : ''].filter(Boolean).join(' ');
  return `<span class="${classes}" style="--c:${_esc(color)}${image ? `;--img:url('${_esc(image)}')` : ''}" role="img" aria-label="${_esc(view.name)}">${image ? '' : _esc(_initial(view.name))}</span>`;
}

function _theirsCell(value) {
  if (!value) return '<span class="rl-none">Rien noté</span>';
  return `${_chip(value.level)}${value.label ? `<span class="rl-etq">${_esc(value.label)}</span>` : ''}`;
}

function _rowButton(c, view, ui) {
  const reciprocal = _reciprocal(c, view);
  return `<button type="button" class="rl-row" data-action="csRelToggle" data-idx="${view.index}" aria-expanded="${ui.open === view.index}">
    <span class="rl-who">${_avatar(view)}<span><b>${_highlight(view.name, ui.q)}</b><small><span class="t">${_highlight(view.sub, ui.q)}</span></small></span></span>
    <span class="rl-mine"><span class="rl-l1">${_chip(view.level)}${view.label ? `<span class="rl-etq">${_highlight(view.label, ui.q)}</span>` : ''}</span>${view.rel.note ? `<span class="rl-nt">${_highlight(view.rel.note, ui.q)}</span>` : ''}</span>
    ${view.kind === 'pc' ? `<span class="rl-theirs">${_theirsCell(reciprocal)}</span>` : ''}${_icon('chev', 'rl-chev')}
  </button>`;
}

function _source(c, view) {
  if (view.kind === 'pc') return `${_icon('user')}<span>Personnage de ${_esc(_playerName(view.target))}</span> · <button type="button" class="rl-src-link" data-nav-page="characters" data-nav-sub="${_esc(`${view.target.id}/journal`)}">Ouvrir la fiche</button>`;
  if (view.kind === 'npc') return `${_icon('book')}<span>Fiche PNJ</span> · <button type="button" class="rl-src-link" data-nav-page="npcs" data-nav-sub="${_esc(`${view.rel.npcId}/fiche`)}">Ouvrir</button><span>· son avis sur ${_esc(c.nom || 'ce personnage')} y figure</span>`;
  return `${_icon('feather')}<span>Sans fiche</span>`;
}

function _mineEditor(c, view, ui) {
  const disabled = ui.canEdit ? '' : ' disabled';
  if (!ui.canEdit) {
    return `<div class="rl-eh"><span class="rl-k">${_esc(c.nom)} envers ${_esc(view.name)}</span></div>
      <div class="rl-l1">${_chip(view.level)}${view.label ? `<span class="rl-etq">${_esc(view.label)}</span>` : ''}</div>
      ${view.rel.role ? `<p class="rl-kv">Pour ${_esc(c.nom)} : <b>${_esc(view.rel.role)}</b></p>` : ''}
      ${view.rel.note ? `<p class="rl-quote">${_esc(view.rel.note)}</p>` : '<p class="rl-dim">Aucune note.</p>'}
      <div class="rl-eb"><span class="rl-src">${_source(c, view)}</span></div>`;
  }
  return `<div class="rl-eh"><span class="rl-k">${_esc(c.nom)} envers ${_esc(view.name)}</span><span class="rl-ok" data-rel-saved aria-live="polite">${_icon('check')} Enregistré</span></div>
    <div class="rl-scale" role="group" aria-label="Avis de ${_esc(c.nom)}">
      <button type="button" class="rl-sc none" data-action="csRelSetLevel" data-idx="${view.index}" data-level="" aria-pressed="${view.level == null}"${disabled}>Pas d’avis</button>
      ${RELATION_LEVELS.map((level, index) => `<button type="button" class="rl-sc" style="--lc:${level.color}" data-action="csRelSetLevel" data-idx="${view.index}" data-level="${level.key}" aria-pressed="${view.level === index}" title="${_esc(level.description)}"${disabled}><i></i>${level.label}</button>`).join('')}
    </div>
    ${view.kind === 'free' ? `<label class="rl-fld"><span class="rl-lb">Nom</span><input class="rl-in" value="${_esc(view.rel.nom)}" data-input="csRelFieldInput" data-blur="csRelFieldBlur" data-idx="${view.index}" data-field="nom" autocomplete="off"></label>` : ''}
    <div class="rl-ff">
      <label class="rl-fld"><span class="rl-lb">Qui est-ce pour ${_esc(c.nom)} ? <em>facultatif</em></span><input class="rl-in" value="${_esc(view.rel.role || '')}" data-input="csRelFieldInput" data-blur="csRelFieldBlur" data-idx="${view.index}" data-field="role" placeholder="Sœur, mentor, créancier…" autocomplete="off"></label>
      <label class="rl-fld"><span class="rl-lb">En un mot <em>facultatif</em></span><input class="rl-in" value="${_esc(view.label)}" data-input="csRelFieldInput" data-blur="csRelFieldBlur" data-idx="${view.index}" data-field="sentiment" placeholder="Pacte, dette, ami fidèle…" autocomplete="off"><span class="rl-sugs">${SUGGESTIONS.map(suggestion => `<button type="button" class="rl-sug" data-action="csRelSuggestion" data-idx="${view.index}" data-value="${_esc(suggestion)}">${_esc(suggestion)}</button>`).join('')}</span></label>
    </div>
    <label class="rl-fld"><span class="rl-lb">Note <em>· visible du groupe et du MJ</em></span><textarea class="rl-ta" rows="3" data-input="csRelFieldInput" data-blur="csRelFieldBlur" data-idx="${view.index}" data-field="note" placeholder="Histoire, dette, secret, dernière rencontre…">${_esc(view.rel.note || '')}</textarea></label>
    <div class="rl-eb"><span class="rl-src">${_source(c, view)}</span><button type="button" class="rl-btn dng" data-action="csRelDelete" data-idx="${view.index}">${_icon('trash')} Supprimer</button></div>`;
}

function _theirsEditor(c, view) {
  const value = _reciprocal(c, view);
  const heading = `<div class="rl-eh"><span class="rl-k">${_esc(view.name)} envers ${_esc(c.nom)}</span>${value ? `<span class="rl-hint">noté par ${_esc(_playerName(view.target))}</span>` : ''}</div>`;
  if (!value) return `${heading}<p class="rl-dim">${_esc(view.name)} n’a encore rien noté sur ${_esc(c.nom)}. Son avis apparaîtra ici dès qu’il sera ajouté sur sa fiche.</p>`;
  return `${heading}<div class="rl-l1">${_chip(value.level)}${value.label ? `<span class="rl-etq">${_esc(value.label)}</span>` : ''}</div>${value.rel.role ? `<p class="rl-kv">Pour ${_esc(view.name)} : <b>${_esc(value.rel.role)}</b></p>` : ''}${value.rel.note ? `<p class="rl-quote">${_esc(value.rel.note)}</p>` : ''}`;
}

function _candidateView(kind, item) {
  return _view(_char(), kind === 'pc' ? { charId: item.id } : { npcId: item.id, nom: item.nom, img: item.imageUrl || '', role: item.role || '' }, -1);
}

function _candidateButton(c, ui, kind, item, action, done = false) {
  const view = _candidateView(kind, item);
  const query = action === 'csRelPick' ? ui.addQ : ui.linkQ;
  const sub = kind === 'pc' ? [item.classe, _playerName(item)].filter(Boolean).join(' · ') : [item.role, item.lieu].filter(Boolean).join(' · ');
  return `<button type="button" class="rl-to${done ? ' done' : ''}" data-action="${action}" data-kind="${kind}" data-target-id="${_esc(item.id)}">${_avatar(view)}<span><b>${_highlight(view.name, query)}</b><small>${done ? 'Déjà dans la liste · ouvrir' : _esc(sub || (kind === 'npc' ? 'PNJ' : 'Personnage'))}</small></span>${action === 'csRelLink' ? `<span class="go">${_icon('link')} Lier</span>` : ''}</button>`;
}

function _allCandidates(c) {
  const pcs = (STATE.characters || []).filter(item => item?.id && item.id !== c.id);
  const npcs = (_npcCandidates || []).filter(item => STATE.isAdmin || item.embauchable !== false);
  return { pcs, npcs };
}

function _linkEditor(c, view, ui) {
  const candidates = _allCandidates(c);
  const all = [
    ...candidates.pcs.map(item => ({ kind: 'pc', item })),
    ...candidates.npcs.map(item => ({ kind: 'npc', item })),
  ];
  const linkedIds = new Set((c.relations || []).flatMap(rel => [rel.charId, rel.npcId]).filter(Boolean));
  const match = relationNameMatch(view.rel, all.filter(candidate => !linkedIds.has(candidate.item.id)).map(candidate => candidate.item));
  const matched = match ? all.find(candidate => candidate.item.id === match.id) : null;
  const q = normalizeRelationText(ui.linkQ);
  const results = q ? all.filter(candidate => !linkedIds.has(candidate.item.id)
    && normalizeRelationText(`${candidate.item.nom} ${candidate.item.role || ''} ${candidate.item.classe || ''} ${_playerName(candidate.item)}`).includes(q)).slice(0, 5) : [];
  return `<div class="rl-eh"><span class="rl-k">Lier à une fiche</span></div>
    ${matched ? `<p class="rl-dim">Une fiche porte ce nom :</p><div class="rl-tos col">${_candidateButton(c, ui, matched.kind, matched.item, 'csRelLink')}</div>` : `<p class="rl-dim">Lie cette relation à une fiche pour suivre son portrait et, pour un personnage, afficher son avis en retour.</p>`}
    <label class="rl-q sm">${_icon('search')}<input type="search" value="${_esc(ui.linkQ)}" placeholder="Chercher un PNJ ou un compagnon…" data-input="csRelLinkSearch" autocomplete="off"></label>
    ${results.length ? `<div class="rl-tos col">${results.map(candidate => _candidateButton(c, ui, candidate.kind, candidate.item, 'csRelLink')).join('')}</div>` : q ? '<p class="rl-dim">Aucune fiche ne correspond.</p>' : ''}`;
}

function _editor(c, view, ui) {
  const twoColumns = view.kind === 'pc' || (view.kind === 'free' && ui.canEdit);
  return `<div class="rl-ed${twoColumns ? '' : ' one'}"><div class="rl-ec">${_mineEditor(c, view, ui)}</div>${twoColumns ? `<div class="rl-ec">${view.kind === 'pc' ? _theirsEditor(c, view) : _linkEditor(c, view, ui)}</div>` : ''}</div>`;
}

function _relationRows(c, ui) {
  const query = normalizeRelationText(ui.q);
  const seenTargets = new Set();
  const views = (c.relations || []).map((rel, index) => _view(c, rel, index)).filter(view => {
    const targetKey = view.kind === 'pc' ? `pc:${view.rel.charId}` : view.kind === 'npc' ? `npc:${view.rel.npcId}` : '';
    if (!targetKey) return true;
    if (seenTargets.has(targetKey)) return false;
    seenTargets.add(targetKey);
    return true;
  });
  const filtered = views.filter(view => {
    const matchesQuery = !query || [view.name, view.sub, view.rel.sentiment, view.rel.note].some(value => normalizeRelationText(value).includes(query));
    const matchesLevel = ui.level === 'all' || (ui.level === 'none' ? view.level == null : view.level === Number(ui.level));
    return matchesQuery && matchesLevel;
  });
  const orderIndex = index => ui.order ? ui.order.indexOf(index) : -1;
  const sort = list => ui.order
    ? [...list].sort((a, b) => (orderIndex(a.index) - orderIndex(b.index)) || 0)
    : sortRelations(list.map(view => ({ ...view, nom: view.name, sent: view.rel.sent })), ui.sort === 'az' ? 'az' : 'proximity');
  return {
    all: views,
    pc: sort(filtered.filter(view => view.kind === 'pc')),
    npc: sort(filtered.filter(view => view.kind === 'npc')),
    free: sort(filtered.filter(view => view.kind === 'free')),
  };
}

function _ghost(c, target, ui) {
  const view = _view(c, { charId: target.id }, -1);
  return `<li class="rl-li ghost"><div class="rl-row"><span class="rl-who">${_avatar(view)}<span><b>${_highlight(view.name, ui.q)}</b><small><span class="t">${_esc(view.sub)}</span></small></span></span><span class="rl-mine">${ui.canEdit ? `<button type="button" class="rl-btn gh rl-rep" data-action="csRelRespond" data-target-id="${_esc(target.id)}">${_icon('reply')} Répondre</button>` : ''}</span><span class="rl-theirs">${_theirsCell(_reciprocal(c, view))}</span><span></span></div></li>`;
}

function _section(c, ui, kind, visible, pending) {
  const labels = {
    pc: ['Le groupe', ''], npc: ['PNJ', ''], free: ['Autres liens', 'Sans fiche : famille, passé, contacts…'],
  };
  const targets = new Set();
  const total = (c.relations || []).filter(rel => {
    const relKind = relationKind(rel, id => getCharacterById(id, null));
    if (relKind !== kind) return false;
    const target = relKind === 'pc' ? `pc:${rel.charId}` : relKind === 'npc' ? `npc:${rel.npcId}` : '';
    if (!target) return true;
    if (targets.has(target)) return false;
    targets.add(target);
    return true;
  }).length;
  const filtered = Boolean(ui.q || ui.level !== 'all');
  const solo = kind !== 'pc';
  return `<section class="rl-sec${solo ? ' solo' : ''}"><header class="rl-sh"><h3>${labels[kind][0]}</h3><span class="n">${filtered && total ? `${visible.length} / ${total}` : total || ''}</span>${labels[kind][1] ? `<small>${labels[kind][1]}</small>` : ''}${kind === 'pc' ? `<button type="button" class="lnk" data-nav-page="players" data-nav-sub="relations/characters/${encodeURIComponent(c.id)}/declared">${_icon('net')} Réseau du groupe</button>` : ''}</header>
    <ul class="rl-list"><li class="rl-hd" aria-hidden="true"><span>Qui</span><span>Avis de ${_esc(c.nom)}</span>${solo ? '' : '<span>En retour</span>'}<span></span></li>
      ${visible.map(view => `<li class="rl-li${ui.open === view.index ? ' open' : ''}${ui.flash === view.index ? ' fl' : ''}" data-rel-idx="${view.index}">${_rowButton(c, view, ui)}${ui.open === view.index ? _editor(c, view, ui) : ''}</li>`).join('')}
      ${pending.length ? `<li class="rl-pd">${_icon('reply')}${pending.length === 1 ? `${_esc(pending[0].nom)} a` : 'Ils ont'} noté un lien avec ${_esc(c.nom)} — sans réponse</li>${pending.map(target => _ghost(c, target, ui)).join('')}` : ''}
    </ul></section>`;
}

function _toolbar(c, ui) {
  const counts = key => (c.relations || []).filter(rel => key === 'none' ? relationLevel(rel.sent) == null : relationLevel(rel.sent) === key).length;
  const filter = (value, label, count, color = '', cls = '') => `<button type="button" class="rl-f${cls}" data-action="csRelFilter" data-level="${value}" aria-pressed="${String(ui.level) === String(value)}"${color ? ` style="--lc:${color}"` : ''}${count || value === 'all' ? '' : ' disabled'}>${color || cls ? '<i></i>' : ''}${label} <em>${count}</em></button>`;
  const noOpinion = counts('none');
  return `<div class="rl-bar"><label class="rl-q">${_icon('search')}<input type="search" value="${_esc(ui.q)}" placeholder="Nom, rôle, note…" data-input="csRelSearch" autocomplete="off" aria-label="Chercher dans les relations"><button type="button" class="rl-qx" data-action="csRelClearSearch" aria-label="Effacer">${_icon('x')}</button></label>
    <div class="rl-lvf" role="group" aria-label="Filtrer par avis">${filter('all', 'Tous', (c.relations || []).length)}${RELATION_LEVELS.map((level, index) => filter(index, level.label, counts(index), level.color)).join('')}${noOpinion ? filter('none', 'Pas d’avis', noOpinion, '', ' none') : ''}</div>
    <div class="rl-seg" role="group" aria-label="Trier"><button type="button" data-action="csRelSort" data-sort="proximity" aria-pressed="${ui.sort === 'proximity'}">Proximité</button><button type="button" data-action="csRelSort" data-sort="az" aria-pressed="${ui.sort === 'az'}">A → Z</button></div></div>`;
}

function _addPanel(c, ui) {
  if (!_npcCandidates) return `<div class="rl-add"><div class="rl-ah"><div><b>Nouvelle relation</b><small>Chargement des fiches disponibles…</small></div><button type="button" class="rl-x" data-action="csRelCloseAdd" aria-label="Fermer">${_icon('x')}</button></div></div>`;
  const q = normalizeRelationText(ui.addQ);
  const { pcs, npcs } = _allCandidates(c);
  const has = (kind, id) => (c.relations || []).some(rel => kind === 'pc' ? rel.charId === id : rel.npcId === id);
  const match = item => !q || normalizeRelationText(`${item.nom} ${item.role || ''} ${item.classe || ''} ${item.lieu || ''} ${_playerName(item)}`).includes(q);
  let visiblePcs = pcs.filter(match);
  let visibleNpcs = npcs.filter(match);
  if (!q) {
    visiblePcs = visiblePcs.filter(item => !has('pc', item.id));
    visibleNpcs = visibleNpcs.filter(item => !has('npc', item.id));
  }
  visibleNpcs = sortRelations(visibleNpcs, 'az');
  const max = q ? 8 : 6;
  return `<div class="rl-add" role="dialog" aria-label="Nouvelle relation"><div class="rl-ah"><div><b>Nouvelle relation</b><small>Un compagnon, un PNJ, ou quelqu’un qui n’a pas de fiche.</small></div><button type="button" class="rl-x" data-action="csRelCloseAdd" aria-label="Fermer">${_icon('x')}</button></div>
    <label class="rl-q lg">${_icon('search')}<input type="search" value="${_esc(ui.addQ)}" placeholder="Chercher un nom…" data-input="csRelAddSearch" autocomplete="off" aria-label="Avec qui ?"></label>
    ${visiblePcs.length ? `<div class="rl-ag"><span class="rl-k">Le groupe</span><div class="rl-tos">${visiblePcs.map(item => _candidateButton(c, ui, 'pc', item, 'csRelPick', has('pc', item.id))).join('')}</div></div>` : ''}
    ${visibleNpcs.length ? `<div class="rl-ag"><span class="rl-k">PNJ</span><div class="rl-tos">${visibleNpcs.slice(0, max).map(item => _candidateButton(c, ui, 'npc', item, 'csRelPick', has('npc', item.id))).join('')}</div>${visibleNpcs.length > max ? `<p class="rl-dim">+ ${visibleNpcs.length - max} autres — affine la recherche.</p>` : ''}</div>` : ''}
    ${q ? `${!visiblePcs.length && !visibleNpcs.length ? '<p class="rl-dim">Aucune fiche ne porte ce nom.</p>' : ''}<button type="button" class="rl-freeb" data-action="csRelPickFree">${_icon('plus')} Ajouter « ${_esc(ui.addQ.trim())} » sans fiche</button>` : '<p class="rl-dim">Quelqu’un sans fiche — une sœur, un ancien maître ? Tape son nom.</p>'}</div>`;
}

function _empty(c, ui) {
  return `<div class="rl-empty">${_icon('users')}<b>${ui.canEdit ? 'Aucune relation notée' : `${_esc(c.nom)} n’a noté aucune relation`}</b><p>${ui.canEdit ? `Note ce que ${_esc(c.nom)} pense de ses compagnons, des PNJ croisés et de ses proches.` : 'Ses liens avec le groupe, les PNJ et ses proches apparaîtront ici.'}</p>${ui.canEdit ? `<button type="button" class="rl-btn pri" data-action="csRelOpenAdd">${_icon('plus')} Noter une relation</button>` : ''}</div>`;
}

function _inner(c, canEdit) {
  const ui = _state(c, canEdit);
  const pending = canEdit ? pendingRelations(c, STATE.characters || []) : [];
  const query = normalizeRelationText(ui.q);
  const visiblePending = ui.level === 'all' ? pending.filter(target => !query || normalizeRelationText(target.nom).includes(query)) : [];
  const rows = _relationRows(c, ui);
  const add = ui.add ? _addPanel(c, ui) : '';
  if (!(c.relations || []).length) return `${add}${_empty(c, ui)}${visiblePending.length ? _section(c, ui, 'pc', [], visiblePending) : ''}`;
  const sections = [
    ['pc', rows.pc, visiblePending], ['npc', rows.npc, []], ['free', rows.free, []],
  ].filter(([, visible, ghosts]) => visible.length || ghosts.length);
  return `${add}${_toolbar(c, ui)}${sections.length ? sections.map(([kind, visible, ghosts]) => _section(c, ui, kind, visible, ghosts)).join('') : `<div class="rl-empty sm"><b>Aucune relation ne correspond</b><p>Modifie la recherche ou le palier sélectionné.</p><button type="button" class="rl-btn gh" data-action="csRelReset">Tout afficher</button></div>`}`;
}

export function renderCharRelations(c, canEdit) {
  return `<div class="rl" id="char-relations" data-char-id="${_esc(c.id)}">${_inner(c, canEdit)}</div>`;
}

export function relationPendingCount(c, canEdit) {
  return canEdit ? pendingRelations(c, STATE.characters || []).length : 0;
}

function _syncJournalTab(c, canEdit) {
  const tab = document.querySelector('.journal-tab[data-sub="relations"]');
  if (!tab) return;
  const count = tab.querySelector('.journal-tab-count');
  if (count) count.textContent = String((c.relations || []).length);
  const pending = relationPendingCount(c, canEdit);
  let badge = tab.querySelector('.journal-tab-pending');
  if (!pending) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'journal-tab-pending';
    tab.appendChild(badge);
  }
  badge.textContent = String(pending);
  badge.title = `${pending} lien${pending > 1 ? 's' : ''} sans réponse`;
}

function _rerender({ focus = '', preserveSelection = false, scrollIndex = null } = {}) {
  const c = _char();
  const root = document.getElementById('char-relations');
  if (!c || !root) return;
  const active = document.activeElement;
  const selector = focus || (active && root.contains(active) ? active.dataset.input || active.dataset.blur || '' : '');
  const start = preserveSelection && active?.selectionStart;
  const end = preserveSelection && active?.selectionEnd;
  root.innerHTML = _inner(c, charSession.getCanEditChar());
  _syncJournalTab(c, charSession.getCanEditChar());
  let next = null;
  if (focus) next = root.querySelector(focus);
  else if (selector) next = root.querySelector(`[data-input="${selector}"], [data-blur="${selector}"]`);
  next?.focus({ preventScroll: true });
  if (next && start != null && next.setSelectionRange) next.setSelectionRange(start, end);
  if (scrollIndex != null) requestAnimationFrame(() => {
    root.querySelector(`.rl-li[data-rel-idx="${scrollIndex}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  const ui = _state(c, charSession.getCanEditChar());
  if (ui.flash != null) {
    const flashed = ui.flash;
    setTimeout(() => { if (ui.flash === flashed) ui.flash = null; }, 1700);
  }
}

function _patchOpenRow(c, index, { toolbar = false } = {}) {
  const ui = _state(c, charSession.getCanEditChar());
  const row = document.querySelector(`#char-relations .rl-li[data-rel-idx="${index}"] > .rl-row`);
  if (row && c.relations?.[index]) {
    const template = document.createElement('template');
    template.innerHTML = _rowButton(c, _view(c, c.relations[index], index), ui).trim();
    row.replaceWith(template.content.firstElementChild);
  }
  if (toolbar) {
    const bar = document.querySelector('#char-relations .rl-bar');
    if (bar) {
      const template = document.createElement('template');
      template.innerHTML = _toolbar(c, ui).trim();
      bar.replaceWith(template.content.firstElementChild);
    }
  }
  _syncJournalTab(c, charSession.getCanEditChar());
}

function _pin(c, ui) {
  ui.order = sortRelations(
    _relationRows(c, { ...ui, order: null }).all.map(view => ({ ...view, nom: view.name, sent: view.rel.sent })),
    ui.sort === 'az' ? 'az' : 'proximity',
  )
    .map(view => view.index);
}

async function _ensureCandidates() {
  if (_npcCandidates) return _npcCandidates;
  const cached = getCachedCollection('npcs');
  if (cached) { _npcCandidates = cached; return cached; }
  if (!_npcCandidatesPromise) _npcCandidatesPromise = loadCollection('npcs').then(items => (_npcCandidates = items || [])).finally(() => { _npcCandidatesPromise = null; });
  return _npcCandidatesPromise;
}

async function _persist(c, before, { quiet = false } = {}) {
  const payload = (c.relations || []).map(rel => ({ ...rel }));
  _syncCharacter(c);
  try {
    await updateInCol('characters', c.id, { relations: payload });
    const saved = document.querySelector('#char-relations [data-rel-saved]');
    if (saved) {
      saved.classList.add('on');
      setTimeout(() => saved.classList.remove('on'), 1600);
    }
    return true;
  } catch (error) {
    console.error('[relations]', error);
    c.relations = before;
    _syncCharacter(c);
    _rerender();
    if (!quiet) showNotif('Impossible d’enregistrer la relation.', 'error');
    return false;
  }
}

async function _persistTextFields(c, index, originals) {
  const relation = c.relations?.[index];
  if (!relation) return;
  const attempted = Object.fromEntries(Object.keys(originals).map(field => [field, relation[field] ?? '']));
  const payload = (c.relations || []).map(rel => ({ ...rel }));
  try {
    await updateInCol('characters', c.id, { relations: payload });
    const saved = document.querySelector('#char-relations [data-rel-saved]');
    if (saved) {
      saved.classList.add('on');
      setTimeout(() => saved.classList.remove('on'), 1600);
    }
  } catch (error) {
    console.error('[relations text]', error);
    const current = c.relations?.[index];
    if (current) {
      const rollback = {};
      Object.entries(originals).forEach(([field, value]) => {
        if ((current[field] ?? '') === attempted[field]) rollback[field] = value;
      });
      if (Object.keys(rollback).length) c.relations[index] = { ...current, ...rollback };
    }
    _syncCharacter(c);
    _rerender();
    showNotif('Impossible d’enregistrer la relation.', 'error');
  }
}

function _mutate(index, patch) {
  const c = _char();
  if (!c?.relations?.[index]) return null;
  const before = c.relations.map(rel => ({ ...rel }));
  c.relations = c.relations.map((rel, i) => i === index ? { ...rel, ...patch } : rel);
  _syncCharacter(c);
  return { c, before };
}

function _scheduleFieldSave(index, before, field) {
  const c = _char();
  if (!c) return;
  const key = `${c.id}:${index}`;
  const previous = SAVE_TIMERS.get(key);
  if (previous) clearTimeout(previous.timer);
  const originals = { ...(previous?.originals || {}) };
  if (!Object.hasOwn(originals, field)) originals[field] = before[index]?.[field] ?? '';
  SAVE_TIMERS.set(key, { originals, timer: setTimeout(() => {
    SAVE_TIMERS.delete(key);
    _persistTextFields(c, index, originals);
  }, 600) });
}

function _flushFieldSave(index) {
  const c = _char();
  if (!c) return;
  const key = `${c.id}:${index}`;
  const pending = SAVE_TIMERS.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  SAVE_TIMERS.delete(key);
  return _persistTextFields(c, index, pending.originals);
}

function _cancelCharacterFieldSaves(c) {
  [...SAVE_TIMERS.entries()].filter(([key]) => key.startsWith(`${c.id}:`)).forEach(([key, value]) => {
    clearTimeout(value.timer);
    SAVE_TIMERS.delete(key);
  });
}

export async function _csV3AddRelation() {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar());
  ui.add = true; ui.addQ = ''; ui.open = null; ui.order = null;
  _rerender();
  await _ensureCandidates();
  _rerender({ focus: '.rl-add input[type="search"]' });
}

export function _csRelCloseAdd() {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar()); ui.add = false; ui.addQ = ''; _rerender();
}

export function _csRelSearch(el) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar()); ui.q = el.value; ui.open = null; ui.order = null;
  _rerender({ focus: '.rl-q input[data-input="csRelSearch"]', preserveSelection: true });
}

export function _csRelAddSearch(el) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar()); ui.addQ = el.value;
  _rerender({ focus: '.rl-add input[data-input="csRelAddSearch"]', preserveSelection: true });
}

export function _csRelLinkSearch(el) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar()); ui.linkQ = el.value;
  _rerender({ focus: '.rl-ed input[data-input="csRelLinkSearch"]', preserveSelection: true });
}

export function _csRelClearSearch() { const c = _char(); if (!c) return; const ui = _state(c, charSession.getCanEditChar()); ui.q = ''; ui.open = null; ui.order = null; _rerender({ focus: '.rl-q input' }); }
export function _csRelReset() { const c = _char(); if (!c) return; const ui = _state(c, charSession.getCanEditChar()); ui.q = ''; ui.level = 'all'; ui.open = null; ui.order = null; _rerender(); }

export function _csRelFilter(el) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar());
  const value = el.dataset.level;
  ui.level = value !== 'all' && String(ui.level) === value ? 'all' : value;
  ui.open = null; ui.order = null; _rerender();
}

export function _csRelSort(el) { const c = _char(); if (!c) return; const ui = _state(c, charSession.getCanEditChar()); ui.sort = el.dataset.sort === 'az' ? 'az' : 'proximity'; ui.open = null; ui.order = null; _rerender(); }

export async function _csRelToggle(el) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar());
  const index = Number(el.dataset.idx);
  if (ui.open === index) { ui.open = null; ui.order = null; ui.linkQ = ''; ui.flash = index; _rerender({ focus: `[data-action="csRelToggle"][data-idx="${index}"]` }); return; }
  ui.open = index; ui.linkQ = ''; _pin(c, ui); _rerender();
  const view = _view(c, c.relations[index], index);
  if (view.kind === 'free' && ui.canEdit) { await _ensureCandidates(); if (ui.open === index) _rerender(); }
}

export async function _csRelSetLevel(el) {
  const index = Number(el.dataset.idx);
  const c = _char(); const rel = c?.relations?.[index]; if (!rel) return;
  const oldLevel = RELATION_LEVELS[relationLevel(rel.sent)];
  const patch = { sent: el.dataset.level || '' };
  if (oldLevel && normalizeRelationText(rel.sentiment) === normalizeRelationText(oldLevel.label)) patch.sentiment = '';
  const changed = _mutate(index, patch); if (!changed) return;
  document.querySelectorAll('#char-relations .rl-scale [data-action="csRelSetLevel"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.level === patch.sent)));
  if (Object.hasOwn(patch, 'sentiment')) {
    const input = document.querySelector(`#char-relations [data-input="csRelFieldInput"][data-idx="${index}"][data-field="sentiment"]`);
    if (input) input.value = '';
  }
  _patchOpenRow(changed.c, index, { toolbar: true });
  await _persist(changed.c, changed.before);
}

export async function _csRelSuggestion(el) {
  const index = Number(el.dataset.idx); const changed = _mutate(index, { sentiment: el.dataset.value || '' }); if (!changed) return;
  const input = document.querySelector(`#char-relations [data-input="csRelFieldInput"][data-idx="${index}"][data-field="sentiment"]`);
  if (input) input.value = el.dataset.value || '';
  _patchOpenRow(changed.c, index);
  await _persist(changed.c, changed.before);
}

export function _csRelFieldInput(el) {
  const index = Number(el.dataset.idx); const changed = _mutate(index, { [el.dataset.field]: el.value }); if (!changed) return;
  _patchOpenRow(changed.c, index);
  _scheduleFieldSave(index, changed.before, el.dataset.field);
}

export function _csRelFieldBlur(el) { _flushFieldSave(Number(el.dataset.idx)); }

export async function _csRelDelete(el) {
  const c = _char(); const index = Number(el.dataset.idx); const original = c?.relations?.[index]; if (!original) return;
  _cancelCharacterFieldSaves(c);
  const before = c.relations.map(rel => ({ ...rel }));
  const name = _view(c, original, index).name;
  c.relations = c.relations.filter((_, i) => i !== index); _syncCharacter(c);
  const ui = _state(c, charSession.getCanEditChar()); ui.open = null; ui.order = null; _rerender();
  if (!await _persist(c, before)) return;
  showNotif(`Relation avec ${name} supprimée.`, 'success', { duration: 6500, action: { label: 'Annuler', onClick: async () => {
    const undoBefore = c.relations.map(rel => ({ ...rel }));
    c.relations.splice(Math.min(index, c.relations.length), 0, original); _syncCharacter(c); ui.flash = index; _rerender();
    await _persist(c, undoBefore);
  } } });
}

async function _addTarget(kind, id) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar());
  const existing = (c.relations || []).findIndex(rel => kind === 'pc' ? rel.charId === id : rel.npcId === id);
  ui.add = false; ui.addQ = ''; ui.q = ''; ui.level = 'all';
  if (existing >= 0) {
    ui.open = existing; _pin(c, ui);
    _rerender({ focus: `[data-rel-idx="${existing}"] .rl-scale .rl-sc`, scrollIndex: existing });
    return;
  }
  const item = kind === 'pc' ? (STATE.characters || []).find(char => char.id === id) : (_npcCandidates || []).find(npc => npc.id === id);
  if (!item) return;
  const before = (c.relations || []).map(rel => ({ ...rel }));
  const relation = { nom: item.nom || '', role: kind === 'npc' ? (item.role || '') : '', sent: '', sentiment: '', note: '', npcId: kind === 'npc' ? id : '', charId: kind === 'pc' ? id : '', img: kind === 'npc' ? (item.imageUrl || '') : '' };
  c.relations = [...(c.relations || []), relation]; _syncCharacter(c); ui.open = c.relations.length - 1; _pin(c, ui);
  _rerender({ focus: `[data-rel-idx="${ui.open}"] .rl-scale .rl-sc`, scrollIndex: ui.open });
  await _persist(c, before);
}

export function _csRelPick(el) { return _addTarget(el.dataset.kind, el.dataset.targetId); }
export function _csRelRespond(el) { return _addTarget('pc', el.dataset.targetId); }

export async function _csRelPickFree() {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar()); const name = ui.addQ.trim(); if (!name) return;
  const before = (c.relations || []).map(rel => ({ ...rel }));
  c.relations = [...(c.relations || []), { nom: name, role: '', sent: '', sentiment: '', note: '', npcId: '', charId: '', img: '' }];
  _syncCharacter(c); ui.add = false; ui.addQ = ''; ui.q = ''; ui.level = 'all'; ui.open = c.relations.length - 1; _pin(c, ui);
  _rerender({ focus: `[data-rel-idx="${ui.open}"] [data-field="role"]`, scrollIndex: ui.open });
  await _persist(c, before);
}

export async function _csRelLink(el) {
  const c = _char(); if (!c) return;
  const ui = _state(c, charSession.getCanEditChar()); const index = ui.open; const rel = c.relations?.[index]; if (!rel) return;
  const kind = el.dataset.kind; const id = el.dataset.targetId;
  const item = kind === 'pc' ? (STATE.characters || []).find(char => char.id === id) : (_npcCandidates || []).find(npc => npc.id === id);
  if (!item) return;
  const before = c.relations.map(entry => ({ ...entry })); const old = { ...rel };
  c.relations[index] = { ...rel, nom: item.nom || rel.nom, img: kind === 'npc' ? (item.imageUrl || '') : '', role: rel.role || (kind === 'npc' ? item.role || '' : ''), charId: kind === 'pc' ? id : '', npcId: kind === 'npc' ? id : '' };
  _syncCharacter(c); ui.linkQ = ''; ui.order = null; ui.flash = index; _rerender();
  if (!await _persist(c, before)) return;
  showNotif(`Relation liée à la fiche de ${item.nom}.`, 'success', { duration: 6500, action: { label: 'Annuler', onClick: async () => {
    const undoBefore = c.relations.map(entry => ({ ...entry })); c.relations[index] = old; _syncCharacter(c); ui.open = index; _pin(c, ui); _rerender(); await _persist(c, undoBefore);
  } } });
}

let _escapeBound = false;
export function bindRelationKeyboard() {
  if (_escapeBound) return;
  _escapeBound = true;
  document.addEventListener('keydown', event => {
    const root = document.getElementById('char-relations'); if (!root) return;
    const c = _char(); if (!c) return; const ui = _state(c, charSession.getCanEditChar());
    if (event.key === 'Escape' && ui.add) { event.preventDefault(); event.stopImmediatePropagation(); ui.add = false; ui.addQ = ''; _rerender(); return; }
    if (event.key === 'Escape' && ui.open != null && root.contains(document.activeElement)) { event.preventDefault(); event.stopImmediatePropagation(); const index = ui.open; ui.open = null; ui.order = null; ui.linkQ = ''; ui.flash = index; _rerender({ focus: `[data-action="csRelToggle"][data-idx="${index}"]` }); return; }
    if (event.key === 'Enter' && event.target?.matches('[data-input="csRelAddSearch"]')) { event.preventDefault(); root.querySelector('.rl-add [data-action="csRelPick"], .rl-add [data-action="csRelPickFree"]')?.click(); }
  }, true);
}
