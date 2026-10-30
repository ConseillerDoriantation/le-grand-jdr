// Éditeur MJ de la bibliothèque d’états : brouillon local, aperçu vivant et
// écriture unique dans world/conditions au clic sur Enregistrer.
import { STATE } from '../../core/state.js';
import { saveDoc } from '../../data/firestore.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import {
  CONDITION_DEFAULT_LIBRARY, CONDITION_BALANCE_VERSION,
  clearConditionLibraryCache,
} from '../../shared/conditions.js';
import {
  CONDITION_ADMIN_STATS, CONDITION_ADMIN_PALETTE, CONDITION_ADMIN_MIRRORS,
  CONDITION_EFFECT_CATALOG, CONDITION_EFFECT_GROUPS, CONDITION_EFFECT_LINKED,
  cloneConditionAdmin, cloneConditionAdminList, conditionAdminIsCustom,
  conditionAdminIsAdjusted, conditionAdminActiveEffects, conditionAdminOtherEffects,
  conditionAdminIssue, conditionAdminWarnings, conditionAdminEffectPhrase,
  conditionAdminGroup, conditionAdminPersistedLibrary, conditionAdminDefault,
  conditionAdminKey, conditionAdminDiceValid,
} from '../../shared/condition-admin.js';
import {
  openModal, closeModalDirect, setModalCloseGuard, clearModalCloseGuard,
} from '../../shared/modal.js';
import { VS } from './vtt-state.js';
import { _renderInspectorSoon } from './vtt-inspector.js';
import {
  CONDITION_LIBRARY, _setConditionLibrary, _rebuildConditionIndex,
  _loadConditionsOverrides, _renderAllTokens,
} from './vtt.js';

const GROUPS = Object.freeze({
  affliction: ['Afflictions', 'sur un ennemi'],
  enchantment: ['Enchantements', 'sur un allié'],
  both: ['Afflictions et enchantements', 'ennemi ou allié'],
  none: ['Hors sorts', 'actions, capacités, pose MJ'],
});
const EFFECT_BY_KEY = Object.fromEntries(CONDITION_EFFECT_CATALOG.map(effect => [effect.key, effect]));
const STAT_LABELS = Object.fromEntries(CONDITION_ADMIN_STATS);
let _state = null;
let _destroyActive = null;

const _plural = (count, singular, plural = `${singular}s`) => `${count} ${count > 1 ? plural : singular}`;
const _fold = value => String(value || '').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const _icon = name => {
  const paths = {
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
  };
  return `<svg class="vtt-cc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
};

const _root = () => document.getElementById('vtt-condition-admin');
const _current = () => _state?.draft.find(condition => condition.id === _state.selectedId) || null;
const _savedById = () => new Map((_state?.saved || []).map(condition => [condition.id, condition]));
const _isUnsaved = condition => {
  const before = _savedById().get(condition.id);
  return !before || conditionAdminKey(before) !== conditionAdminKey(condition);
};
const _removed = () => (_state?.saved || []).filter(saved => !_state.draft.some(condition => condition.id === saved.id));
const _changes = () => (_state?.draft || []).filter(_isUnsaved).length + _removed().length;
const _issues = () => new Map((_state?.draft || []).map(condition => [condition.id, conditionAdminIssue(condition, _state.draft)]).filter(([, issue]) => issue));

function _snapshot() {
  if (!_state) return;
  _state.history.push({ draft: cloneConditionAdminList(_state.draft), selectedId: _state.selectedId });
  if (_state.history.length > 80) _state.history.shift();
}

function _mutate(change, { render = true } = {}) {
  if (!_state) return;
  _snapshot();
  _state.softTag = '';
  change();
  if (render) _render();
}

function _softSnapshot(tag) {
  if (!_state || _state.softTag === tag) return;
  _snapshot();
  _state.softTag = tag;
}

function _undo() {
  const previous = _state?.history.pop();
  if (!previous) return;
  _state.draft = cloneConditionAdminList(previous.draft);
  _state.selectedId = _state.draft.some(condition => condition.id === previous.selectedId)
    ? previous.selectedId : _state.draft[0]?.id || '';
  _state.softTag = '';
  _state.askClose = false;
  _state.deleteId = '';
  _render();
  _toast('Modification annulée');
}

function _toast(message, undoable = false) {
  if (!_state) return;
  _state.toast = { message, undoable };
  _renderToast();
  clearTimeout(_state.toastTimer);
  _state.toastTimer = setTimeout(() => {
    if (!_state) return;
    _state.toast = null;
    _renderToast();
  }, undoable ? 4200 : 2400);
}

function _renderToast() {
  const host = _root()?.querySelector('[data-cc-toast]');
  if (!host || !_state) return;
  const toast = _state.toast;
  host.classList.toggle('is-visible', !!toast);
  host.innerHTML = toast
    ? `<span>${_esc(toast.message)}</span>${toast.undoable ? '<button type="button" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="undo">Annuler</button>' : ''}`
    : '';
}

function _visible() {
  if (!_state) return [];
  const issues = _issues();
  const query = _fold(_state.query.trim());
  return _state.draft.filter(condition => {
    if (query && !_fold(`${condition.label} ${condition.desc}`).includes(query)) return false;
    if (_state.filter === 'adjusted') return conditionAdminIsAdjusted(condition);
    if (_state.filter === 'custom') return conditionAdminIsCustom(condition);
    if (_state.filter === 'issues') return issues.has(condition.id);
    return true;
  });
}

function _renderTools() {
  const host = _root()?.querySelector('[data-cc-tools]');
  if (!host || !_state) return;
  const adjusted = _state.draft.filter(conditionAdminIsAdjusted).length;
  const custom = _state.draft.filter(conditionAdminIsCustom).length;
  const issueCount = _issues().size;
  if ((_state.filter === 'adjusted' && !adjusted)
    || (_state.filter === 'custom' && !custom)
    || (_state.filter === 'issues' && !issueCount)) _state.filter = 'all';
  const filter = (key, label, count, tone = '') => count == null || count > 0
    ? `<button type="button" class="vtt-cc-filter${_state.filter === key ? ' is-active' : ''}${tone ? ` ${tone}` : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="filter|${key}">${label} <b>${count}</b></button>` : '';
  host.innerHTML = `<div class="vtt-cc-tools-row">
      <label class="vtt-cc-search">${_icon('search')}<input value="${_esc(_state.query)}" placeholder="Rechercher un état…" autocomplete="off" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="search|$this"></label>
      <button type="button" class="vtt-cc-btn primary small" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="new">${_icon('plus')}Nouvel état</button>
    </div><div class="vtt-cc-tools-row filters">
      ${filter('all', 'Tous', _state.draft.length)}${filter('adjusted', 'Ajustés', adjusted, 'adjusted')}${filter('custom', 'Personnalisés', custom, 'custom')}${filter('issues', 'À corriger', issueCount, 'danger')}
    </div>`;
}

function _renderList() {
  const host = _root()?.querySelector('[data-cc-list]');
  if (!host || !_state) return;
  const issues = _issues();
  const rows = [];
  for (const group of ['affliction', 'enchantment', 'both', 'none']) {
    const conditions = _visible().filter(condition => conditionAdminGroup(condition) === group);
    if (!conditions.length) continue;
    rows.push(`<div class="vtt-cc-group"><span>${GROUPS[group][0]}</span><small>${GROUPS[group][1]}</small><b>${conditions.length}</b></div>`);
    for (const condition of conditions) {
      const phrases = conditionAdminActiveEffects(condition).map(effect => conditionAdminEffectPhrase(effect, condition));
      const issue = issues.get(condition.id);
      rows.push(`<button type="button" class="vtt-cc-row${condition.id === _state.selectedId ? ' is-selected' : ''}" style="--condition-color:${_esc(condition.color || '#94a3b8')}" data-condition-id="${_esc(condition.id)}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="select|${_esc(condition.id)}">
        <span class="vtt-cc-row-icon">${_esc(condition.icon || '?')}</span><span class="vtt-cc-row-copy"><b>${_esc(condition.label || 'Sans nom')}</b><small>${_esc(phrases.slice(0, 2).join(' · ') || 'Narratif')}${phrases.length > 2 ? ` · +${phrases.length - 2}` : ''}</small></span>
        <span class="vtt-cc-row-meta">${conditionAdminIsCustom(condition) ? '<i class="custom">perso</i>' : conditionAdminIsAdjusted(condition) ? '<i>ajusté</i>' : ''}${issue ? `<span class="vtt-cc-dot danger" title="${_esc(issue)}"></span>` : _isUnsaved(condition) ? '<span class="vtt-cc-dot" title="Non enregistré"></span>' : ''}</span>
      </button>`);
    }
  }
  host.innerHTML = rows.join('') || `<p class="vtt-cc-empty">Aucun état${_state.query ? ` pour « ${_esc(_state.query)} »` : ''}.</p>`;
}

const _stepper = (field, value, placeholder = '—', disabled = false) => `<span class="vtt-cc-stepper${disabled ? ' is-disabled' : ''}"><button type="button" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="step|${field}|-1"${disabled ? ' disabled' : ''}>−</button><input type="number" value="${value ?? ''}" placeholder="${placeholder}" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="${field}|$this"${disabled ? ' disabled' : ''}><button type="button" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="step|${field}|1"${disabled ? ' disabled' : ''}>+</button></span>`;

function _saveText(condition) {
  return condition.defaultSaveStat
    ? `JS ${STAT_LABELS[condition.defaultSaveStat] || condition.defaultSaveStat}${condition.defaultDC ? ` DD ${condition.defaultDC}` : ''}`
    : 'Aucun jet';
}

function _durationText(condition) {
  if (condition.effects?.consumedByAttackAgainst) return 'jusqu’au premier coup';
  return condition.defaultDuration ? _plural(condition.defaultDuration, 'tour') : 'jusqu’à dissipation';
}

function _previewHtml(condition) {
  const phrases = conditionAdminActiveEffects(condition).map(effect => conditionAdminEffectPhrase(effect, condition));
  const warnings = conditionAdminWarnings(condition);
  const usage = condition.spellUsage || {};
  return `<div class="vtt-cc-token" style="--condition-color:${_esc(condition.color || '#94a3b8')}"><div class="vtt-cc-token-medal">A<span>${_esc(condition.icon || '?')}</span></div><div class="vtt-cc-token-chip"><i>${_esc(condition.icon || '?')}</i>${_esc(condition.label || 'Sans nom')}${condition.defaultDuration && !condition.effects?.consumedByAttackAgainst ? `<em>${condition.defaultDuration}</em>` : ''}</div></div>
    <div class="vtt-cc-play-copy"><p class="vtt-cc-label">En jeu</p>${phrases.length ? `<ul>${phrases.map(phrase => `<li>${_esc(phrase)}</li>`).join('')}</ul>` : '<p class="vtt-cc-narrative">Aucun effet automatique. Le MJ arbitre cet état d’après sa description.</p>'}<div class="vtt-cc-play-pills"><span>${_esc(_saveText(condition))}</span><span>${_esc(_durationText(condition))}</span>${usage.affliction || usage.enchantment ? `<span>${_plural(condition.spellRunes || 1, 'rune')} · ${[usage.affliction && 'Affliction', usage.enchantment && 'Enchantement'].filter(Boolean).join(' / ')}</span>` : ''}</div>${warnings.map(warning => `<p class="vtt-cc-warning">${_esc(warning)}</p>`).join('')}</div>`;
}

function _damageTypes() {
  const live = Array.isArray(VS.damageTypes) ? VS.damageTypes.map(type => ({ id: String(type.id), label: type.label || type.id })) : [];
  return live.length ? live : ['physique', 'contondant', 'perforant', 'tranchant', 'feu', 'froid', 'foudre', 'acide', 'poison', 'nécrotique', 'radiant', 'psychique', 'tonnerre', 'force'].map(id => ({ id, label: id }));
}

function _effectRow(effect, condition) {
  const value = condition.effects?.[effect.key];
  let control = '';
  if (effect.type === 'tri') {
    control = `<div class="vtt-cc-segment">${[['adv', 'Avantage'], ['dis', 'Désavantage']].map(([mode, label]) => `<button type="button" class="${value === mode ? `is-active ${mode}` : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="tri|${effect.key}|${mode}">${label}</button>`).join('')}</div>`;
  } else if (effect.type === 'number' || effect.type === 'percent') {
    control = `${_stepper(`effect:${effect.key}`, value)}<span class="vtt-cc-unit">${effect.type === 'percent' ? '%' : effect.unit || ''}</span>`;
  } else if (effect.type === 'dice') {
    control = `<input class="vtt-cc-input dice${conditionAdminDiceValid(value) ? '' : ' is-invalid'}" value="${_esc(value)}" maxlength="20" placeholder="1d6" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="effect:${effect.key}|$this">`;
  } else if (effect.type === 'stats') {
    const selected = Array.isArray(value) ? value : [];
    control = `<div class="vtt-cc-stats">${CONDITION_ADMIN_STATS.map(([stat, label]) => `<button type="button" class="${selected.includes(stat) ? 'is-active' : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="effect-stat|${effect.key}|${stat}">${label}</button>`).join('')}</div>`;
  }
  let sub = '';
  if (effect.key === 'dmgReductionPct') {
    const selected = Array.isArray(condition.effects?.dmgReductionTypes) ? condition.effects.dmgReductionTypes : [];
    sub = `<div class="vtt-cc-effect-sub"><span>${selected.length ? 'Seulement ces types' : 'Tous les types'}</span><div class="vtt-cc-stats types">${_damageTypes().map(type => `<button type="button" class="${selected.includes(type.id) ? 'is-active' : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="damage-type|${_esc(type.id)}">${_esc(type.label)}</button>`).join('')}</div></div>`;
  }
  if (effect.key === 'dmgDealtBonus') {
    const advanced = [
      condition.effects?.dmgDealtMeleeOnly && 'mêlée', condition.effects?.dmgDealtWeaponOnly && 'arme',
      condition.effects?.dmgDealtRequiredStat && `utilisant ${STAT_LABELS[condition.effects.dmgDealtRequiredStat] || condition.effects.dmgDealtRequiredStat}`,
      ...(condition.effects?.dmgDealtBonusByLevel || []).map(row => `+${row.formula} dès niv. ${row.minLevel}`),
      condition.effects?.dmgDealtBonusScalesWithPower === false && 'fixe (ignore Puissance)',
    ].filter(Boolean);
    if (advanced.length) sub = `<div class="vtt-cc-effect-sub"><span>Conditions avancées conservées : ${_esc(advanced.join(' · '))}</span></div>`;
  }
  return `<div class="vtt-cc-effect"><span class="vtt-cc-effect-group">${_esc(CONDITION_EFFECT_GROUPS[effect.group])}</span><span class="vtt-cc-effect-label">${_esc(effect.label)}${effect.hint ? `<small>${_esc(effect.hint)}</small>` : ''}</span><span class="vtt-cc-effect-control">${control}</span><button type="button" class="vtt-cc-remove" aria-label="Retirer l’effet" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="remove-effect|${effect.key}">${_icon('close')}</button>${sub}</div>`;
}

function _effectMenu(condition) {
  return `<div class="vtt-cc-effect-menu">${Object.entries(CONDITION_EFFECT_GROUPS).map(([group, label]) => `<div><p class="vtt-cc-label">${_esc(label)}</p>${CONDITION_EFFECT_CATALOG.filter(effect => effect.group === group).map(effect => {
    const active = conditionAdminActiveEffects(condition).some(item => item.key === effect.key);
    return `<button type="button" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="add-effect|${effect.key}"${active ? ' disabled' : ''}>${_esc(effect.label)}${active ? _icon('check') : ''}</button>`;
  }).join('')}</div>`).join('')}</div>`;
}

function _mirror(condition) {
  const pair = CONDITION_ADMIN_MIRRORS.find(entry => entry.includes(condition.id));
  if (!pair) return null;
  const id = pair[0] === condition.id ? pair[1] : pair[0];
  return _state?.draft.find(item => item.id === id) || null;
}

function _usageImpact(conditionId) {
  const result = { spells: new Set(), techniques: new Set(), tokens: 0 };
  const spellKeys = new Set(['enchantEtatId', 'afflictionEtatId', 'afflictionConditionId', 'enchantStateId']);
  const techniqueKeys = new Set(['conditionId', 'missSelfConditionId', 'etatId', 'stateId']);
  const seen = new WeakSet();
  const walk = (value, inheritedLabel = '') => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const label = String(value.label || value.nom || value.titre || value.name || inheritedLabel || 'Sans nom');
    for (const [key, child] of Object.entries(value)) {
      if (String(child) === conditionId && spellKeys.has(key)) result.spells.add(label);
      else if (String(child) === conditionId && techniqueKeys.has(key)) result.techniques.add(label);
      if (child && typeof child === 'object') walk(child, label);
    }
  };
  [VS.characters, VS.npcs, VS.bestiary, STATE.characters].forEach(source => walk(source));
  result.tokens = Object.values(VS.tokens || {}).filter(entry => (entry?.data?.conditions || []).some(condition => condition.id === conditionId)).length;
  return { spells: [...result.spells], techniques: [...result.techniques], tokens: result.tokens };
}

function _deleteBanner(condition) {
  if (_state?.deleteId !== condition.id) return '';
  const impact = _usageImpact(condition.id);
  const refs = [
    impact.spells.length ? `${_plural(impact.spells.length, 'sort')} (${impact.spells.join(', ')})` : '',
    impact.techniques.length ? `${_plural(impact.techniques.length, 'technique')} (${impact.techniques.join(', ')})` : '',
    impact.tokens ? `${_plural(impact.tokens, 'token')} en scène` : '',
  ].filter(Boolean);
  return `<div class="vtt-cc-banner danger"><div><b>Supprimer « ${_esc(condition.label)} » ?</b><span>${refs.length ? `Utilisé par ${_esc(refs.join(' · '))}. Les références seront conservées mais l’état ne sera plus reconnu.` : 'Aucun sort, technique ni token actif ne l’utilise.'}</span></div><button type="button" class="vtt-cc-btn danger small" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="confirm-delete">Supprimer</button><button type="button" class="vtt-cc-btn text small" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="cancel-delete">Garder</button></div>`;
}

function _renderDetail() {
  const host = _root()?.querySelector('[data-cc-detail]');
  if (!host || !_state) return;
  const condition = _current();
  if (!condition) {
    host.innerHTML = '<div class="vtt-cc-blank"><b>Aucun état sélectionné</b><span>Choisis un état dans la liste ou crée-en un.</span></div>';
    return;
  }
  const issue = conditionAdminIssue(condition, _state.draft);
  const usage = condition.spellUsage || {};
  const active = conditionAdminActiveEffects(condition);
  const other = conditionAdminOtherEffects(condition);
  const mirror = _mirror(condition);
  host.innerHTML = `${_deleteBanner(condition)}
    <div class="vtt-cc-identity" style="--condition-color:${_esc(condition.color || '#94a3b8')}">
      <label class="vtt-cc-icon-field"><input value="${_esc(condition.icon || '')}" maxlength="4" aria-label="Icône" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="icon|$this"></label>
      <div class="vtt-cc-name"><input class="${issue && /Nom/.test(issue) ? 'is-invalid' : ''}" value="${_esc(condition.label || '')}" placeholder="Nom de l’état" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="label|$this"><div><code>${_esc(condition.id)}</code><span>${conditionAdminIsCustom(condition) ? 'Personnalisé' : 'Par défaut'}</span>${conditionAdminIsAdjusted(condition) ? '<span class="adjusted">Ajusté</span>' : ''}</div></div>
      <div class="vtt-cc-head-actions"><button type="button" class="vtt-cc-btn ghost small" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="duplicate">${_icon('copy')}Dupliquer</button>${conditionAdminIsAdjusted(condition) && !conditionAdminIsCustom(condition) ? `<button type="button" class="vtt-cc-btn ghost small" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="default">${_icon('undo')}Défaut</button>` : ''}${conditionAdminIsCustom(condition) ? `<button type="button" class="vtt-cc-btn danger-outline icon-only" aria-label="Supprimer" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="delete">${_icon('trash')}</button>` : ''}</div>
    </div><p class="vtt-cc-issue" data-cc-issue>${_esc(issue)}</p>
    <div class="vtt-cc-colors">${CONDITION_ADMIN_PALETTE.map(color => `<button type="button" class="${color === condition.color ? 'is-active' : ''}" style="--swatch:${color}" aria-label="Couleur ${color}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="color|${color}"></button>`).join('')}<label class="vtt-cc-custom-color${CONDITION_ADMIN_PALETTE.includes(condition.color) ? '' : ' is-active'}" style="--swatch:${_esc(condition.color || '#94a3b8')}" title="Couleur libre"><input type="color" value="${_esc(condition.color || '#94a3b8')}" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="color|$this"></label></div>
    <section class="vtt-cc-preview" data-cc-preview>${_previewHtml(condition)}</section>
    <section class="vtt-cc-block"><h3>Application</h3>
      <div class="vtt-cc-form-row"><span><b>Jet de sauvegarde</b><small>Pré-rempli à l’application</small></span><div><div class="vtt-cc-segment">${[['', 'Aucun'], ...CONDITION_ADMIN_STATS].map(([stat, label]) => `<button type="button" class="${(condition.defaultSaveStat || '') === stat ? 'is-active' : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="save-stat|${stat}">${label}</button>`).join('')}</div><span class="vtt-cc-inline"><i>DD</i>${_stepper('dc', condition.defaultDC, '—', !condition.defaultSaveStat)}</span></div></div>
      <div class="vtt-cc-form-row"><span><b>Durée par défaut</b><small>En tours de combat</small></span><div>${_stepper('duration', condition.defaultDuration, '∞', !!condition.effects?.consumedByAttackAgainst)}<small>${condition.effects?.consumedByAttackAgainst ? 'Ignorée : consommé au premier coup encaissé.' : condition.defaultDuration ? '' : 'Vide = dissipation manuelle.'}</small></div></div>
      <div class="vtt-cc-form-row"><span><b>Dans les sorts</b><small>Sélecteurs de la modal de sort</small></span><div><button type="button" class="vtt-cc-toggle${usage.affliction ? ' is-active' : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="usage|affliction"><i></i>Affliction</button><button type="button" class="vtt-cc-toggle${usage.enchantment ? ' is-active' : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="usage|enchantment"><i></i>Enchantement</button>${usage.affliction || usage.enchantment ? `<span class="vtt-cc-inline"><i>Coût</i><span class="vtt-cc-segment">${[1, 2, 3].map(runes => `<button type="button" class="${(condition.spellRunes || 1) === runes ? 'is-active' : ''}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="runes|${runes}">${runes} rune${runes > 1 ? 's' : ''}</button>`).join('')}</span></span>` : ''}</div></div>
    </section>
    <section class="vtt-cc-block"><h3>Effets automatiques <b>${active.length}</b><span></span><span class="vtt-cc-menu-wrap"><button type="button" class="vtt-cc-btn ghost small" aria-expanded="${_state.effectMenu}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="effect-menu">${_icon('plus')}Ajouter un effet</button>${_state.effectMenu ? _effectMenu(condition) : ''}</span></h3>${active.length ? `<div class="vtt-cc-effects">${active.map(effect => _effectRow(effect, condition)).join('')}</div>` : '<p class="vtt-cc-narrative">Aucun effet appliqué automatiquement en combat.</p>'}${other.length ? `<p class="vtt-cc-preserved">Réglages hors éditeur conservés : ${other.map(key => `<code>${_esc(key)}</code>`).join(', ')}</p>` : ''}</section>
    <section class="vtt-cc-block"><h3>Description<span></span>${mirror ? `<button type="button" class="vtt-cc-mirror" style="--condition-color:${_esc(mirror.color)}" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="select|${_esc(mirror.id)}">Miroir : <i>${_esc(mirror.icon)}</i>${_esc(mirror.label)}</button>` : ''}</h3><textarea class="vtt-cc-input description" rows="4" placeholder="Effet narratif et règles racontées au joueur…" data-vtt-fn="_vttConditionConfigInput" data-vtt-on="input" data-vtt-args="desc|$this">${_esc(condition.desc || '')}</textarea></section>`;
}

function _renderFooter() {
  const host = _root()?.querySelector('[data-cc-footer]');
  if (!host || !_state) return;
  const count = _changes();
  const issueCount = _issues().size;
  if (_state.askClose) {
    host.innerHTML = `<div class="vtt-cc-close-question"><b>Fermer sans enregistrer ?</b><small>${_plural(count, 'modification')} seront perdues.</small></div><span></span><button type="button" class="vtt-cc-btn text" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="continue">Continuer</button><button type="button" class="vtt-cc-btn danger-outline" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="discard-close">Abandonner</button><button type="button" class="vtt-cc-btn primary" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="save-close"${issueCount ? ' disabled' : ''}>Enregistrer et fermer</button>`;
    return;
  }
  host.innerHTML = `<div class="vtt-cc-foot-status${issueCount ? ' has-error' : ''}">${issueCount ? `${_plural(issueCount, 'état')} à corriger avant d’enregistrer` : count ? `<span class="vtt-cc-dot"></span>${_plural(count, 'modification')} non enregistrée${count > 1 ? 's' : ''}` : 'Tout est enregistré'}</div><button type="button" class="vtt-cc-btn text small" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="undo"${_state.history.length ? '' : ' disabled'} title="Ctrl+Z">${_icon('undo')}Annuler</button><span></span><button type="button" class="vtt-cc-btn text" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="reset-all">Tout réinitialiser</button><button type="button" class="vtt-cc-btn primary" data-vtt-fn="_vttConditionConfigDo" data-vtt-args="save"${count && !issueCount ? '' : ' disabled'}>Enregistrer <kbd>Ctrl+S</kbd></button>`;
}

function _render() { _renderTools(); _renderList(); _renderDetail(); _renderFooter(); _renderToast(); }

function _renderSoft() {
  if (!_state) return;
  _renderList(); _renderFooter();
  const condition = _current();
  const root = _root();
  if (!condition || !root) return;
  const preview = root.querySelector('[data-cc-preview]');
  if (preview) preview.innerHTML = _previewHtml(condition);
  const issueNode = root.querySelector('[data-cc-issue]');
  if (issueNode) issueNode.textContent = conditionAdminIssue(condition, _state.draft);
  root.querySelector('.vtt-cc-identity')?.style.setProperty('--condition-color', condition.color || '#94a3b8');
}

function _newCondition(base = null) {
  const stamp = Date.now();
  let suffix = 0;
  let id = `custom_${(stamp + suffix).toString(36)}`;
  while (_state?.draft.some(condition => condition.id === id)) {
    suffix += 1;
    id = `custom_${(stamp + suffix).toString(36)}`;
  }
  const condition = base ? cloneConditionAdmin(base) : {
    id, label: 'Nouvel état', icon: '✨', color: '#94a3b8', desc: '',
    defaultSaveStat: null, defaultDC: 11, defaultDuration: 2,
    spellUsage: { enchantment: false, affliction: false }, effects: {},
    balanceVersion: CONDITION_BALANCE_VERSION,
  };
  condition.id = id;
  if (base) condition.label = `${base.label} (copie)`;
  condition.balanceVersion = CONDITION_BALANCE_VERSION;
  _mutate(() => { _state.draft.push(condition); _state.selectedId = id; _state.query = ''; _state.filter = 'all'; });
  setTimeout(() => _root()?.querySelector('.vtt-cc-name input')?.select(), 0);
}

function _effectDefault(effect) {
  if (effect.type === 'tri') return 'dis';
  if (effect.type === 'flag') return true;
  if (effect.type === 'stats') return ['force'];
  return effect.defaultValue;
}

function _step(field, delta) {
  const condition = _current();
  if (!condition) return;
  _mutate(() => {
    if (field === 'dc') condition.defaultDC = Math.max(1, Math.min(30, (Number(condition.defaultDC) || 10) + delta));
    else if (field === 'duration') {
      const value = (Number(condition.defaultDuration) || 0) + delta;
      condition.defaultDuration = value > 0 ? Math.min(100, value) : null;
    } else if (field.startsWith('effect:')) {
      const key = field.slice(7);
      const effect = EFFECT_BY_KEY[key];
      if (!effect) return;
      let value = (Number(condition.effects[key]) || 0) + delta * (effect.type === 'percent' ? 10 : 1);
      if (effect.type === 'percent') value = Math.round(value / 10) * 10;
      if (effect.type === 'number' && value === 0) value += delta;
      condition.effects[key] = Math.max(effect.min, Math.min(effect.max, value));
    }
  });
}

async function _save({ closeAfter = false } = {}) {
  if (!_state || _state.saving || _issues().size) return false;
  _state.saving = true; _renderFooter();
  try {
    const payload = conditionAdminPersistedLibrary(_state.draft);
    await saveDoc('world', 'conditions', { library: payload });
    clearConditionLibraryCache();
    const live = cloneConditionAdminList(_state.draft);
    _setConditionLibrary(live); _rebuildConditionIndex();
    _state.saved = cloneConditionAdminList(live); _state.history = []; _state.softTag = ''; _state.askClose = false;
    try { _renderAllTokens(); } catch {}
    try { _renderInspectorSoon(); } catch {}
    showNotif('Réglages des états enregistrés', 'success');
    if (closeAfter) { _destroy(); clearModalCloseGuard(); closeModalDirect(); }
    else { _state.saving = false; _render(); }
    return true;
  } catch (error) {
    _state.saving = false; _renderFooter();
    showNotif(`Erreur sauvegarde : ${error?.message || error}`, 'error');
    return false;
  }
}

function _destroy() {
  if (!_state) return;
  clearTimeout(_state.toastTimer);
  document.removeEventListener('keydown', _onKeydown);
  document.removeEventListener('pointerdown', _onPointerDown);
  _state = null; _destroyActive = null;
}
function _requestClose() { closeModalDirect(); }
function _guardClose() {
  if (!_state) return false;
  if (!_changes()) { _destroy(); return false; }
  _state.askClose = true; _state.effectMenu = false; _renderFooter(); return true;
}
function _onPointerDown(event) {
  if (!_state?.effectMenu || event.target.closest('.vtt-cc-menu-wrap')) return;
  _state.effectMenu = false; _renderDetail();
}
function _onKeydown(event) {
  if (!_state || !_root()) return;
  const field = event.target.matches?.('input,textarea,select');
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('fr') === 's') { event.preventDefault(); _save(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('fr') === 'z' && !field) { event.preventDefault(); _undo(); return; }
  if (!field && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.closest?.('[data-cc-list]')) {
    event.preventDefault();
    const rows = [..._root().querySelectorAll('[data-cc-list] [data-condition-id]')];
    const index = rows.findIndex(row => row.dataset.conditionId === _state.selectedId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    next?.click(); next?.focus();
  }
}

export async function _vttConditionConfig() {
  if (!STATE.isAdmin) return;
  _destroyActive?.();
  await _loadConditionsOverrides().catch(() => {});
  const saved = cloneConditionAdminList(CONDITION_LIBRARY);
  _state = { saved, draft: cloneConditionAdminList(saved), selectedId: saved[0]?.id || '', history: [], query: '', filter: 'all', effectMenu: false, deleteId: '', askClose: false, saving: false, softTag: '', toast: null, toastTimer: null };
  openModal('États et conditions', `<div class="vtt-cc-shell" id="vtt-condition-admin"><div class="vtt-cc-main"><aside class="vtt-cc-sidebar"><div class="vtt-cc-tools" data-cc-tools></div><div class="vtt-cc-list" data-cc-list tabindex="0" aria-label="États"></div></aside><section class="vtt-cc-detail" data-cc-detail aria-label="Réglages de l’état"></section></div><footer class="vtt-cc-footer" data-cc-footer></footer><div class="vtt-cc-toast" data-cc-toast role="status" aria-live="polite"></div></div>`, { subtitle: 'Réglages par défaut à chaque application. Ajustables au cas par cas depuis l’inspecteur du token.' });
  setModalCloseGuard(_guardClose);
  document.addEventListener('keydown', _onKeydown);
  document.addEventListener('pointerdown', _onPointerDown);
  _destroyActive = _destroy;
  _render();
}

export function _vttConditionConfigInput(field, element) {
  if (!_state || !element) return;
  if (field === 'search') { _state.query = element.value; _renderList(); return; }
  const condition = _current(); if (!condition) return;
  _softSnapshot(`${condition.id}:${field}`);
  const raw = element.value;
  if (field === 'label') condition.label = raw;
  else if (field === 'icon') condition.icon = raw.trim();
  else if (field === 'color') condition.color = raw;
  else if (field === 'desc') condition.desc = raw;
  else if (field === 'dc') condition.defaultDC = parseInt(raw, 10) > 0 ? Math.min(30, parseInt(raw, 10)) : null;
  else if (field === 'duration') condition.defaultDuration = parseInt(raw, 10) > 0 ? Math.min(100, parseInt(raw, 10)) : null;
  else if (field.startsWith('effect:')) {
    const key = field.slice(7), effect = EFFECT_BY_KEY[key]; if (!effect) return;
    if (effect.type === 'dice') { condition.effects[key] = raw.trim(); element.classList.toggle('is-invalid', !conditionAdminDiceValid(raw)); }
    else { const value = parseInt(raw, 10); if (Number.isFinite(value)) condition.effects[key] = Math.max(effect.min, Math.min(effect.max, value)); }
  }
  _renderSoft();
}

export function _vttConditionConfigDo(action, arg = '', extra = '') {
  if (!_state) return;
  const condition = _current();
  if (action === 'select') {
    if (_state.draft.some(item => item.id === arg)) { _state.selectedId = arg; _state.effectMenu = false; _state.deleteId = ''; _state.softTag = ''; _renderList(); _renderDetail(); _root()?.querySelector('[data-cc-detail]')?.scrollTo({ top: 0, behavior: 'smooth' }); }
  } else if (action === 'filter') { _state.filter = arg; _renderTools(); _renderList(); }
  else if (action === 'new') _newCondition();
  else if (action === 'duplicate' && condition) _newCondition(condition);
  else if (action === 'default' && condition) { const original = conditionAdminDefault(condition.id); if (original) _mutate(() => { _state.draft[_state.draft.indexOf(condition)] = original; }); _toast(`${condition.label} remis par défaut`, true); }
  else if (action === 'delete' && conditionAdminIsCustom(condition)) { _state.deleteId = condition.id; _renderDetail(); }
  else if (action === 'cancel-delete') { _state.deleteId = ''; _renderDetail(); }
  else if (action === 'confirm-delete' && conditionAdminIsCustom(condition)) {
    const name = condition.label;
    _mutate(() => { const index = _state.draft.indexOf(condition); _state.draft.splice(index, 1); _state.selectedId = (_state.draft[index] || _state.draft[index - 1])?.id || ''; _state.deleteId = ''; });
    _toast(`« ${name} » supprimé du brouillon`, true);
  } else if (action === 'color' && condition) _mutate(() => { condition.color = arg; });
  else if (action === 'save-stat' && condition) _mutate(() => { condition.defaultSaveStat = arg || null; if (arg && !condition.defaultDC) condition.defaultDC = 11; });
  else if (action === 'step') _step(arg, Number(extra));
  else if (action === 'usage' && condition) _mutate(() => { condition.spellUsage = { ...condition.spellUsage, [arg]: !condition.spellUsage?.[arg] }; });
  else if (action === 'runes' && condition) _mutate(() => { condition.spellRunes = Math.max(1, Math.min(3, Number(arg) || 1)); });
  else if (action === 'effect-menu') { _state.effectMenu = !_state.effectMenu; _renderDetail(); }
  else if (action === 'add-effect' && condition && EFFECT_BY_KEY[arg]) _mutate(() => { condition.effects[arg] = _effectDefault(EFFECT_BY_KEY[arg]); _state.effectMenu = false; });
  else if (action === 'remove-effect' && condition) _mutate(() => { delete condition.effects[arg]; (CONDITION_EFFECT_LINKED[arg] || []).forEach(key => delete condition.effects[key]); });
  else if (action === 'tri' && condition) _mutate(() => { condition.effects[arg] = extra; });
  else if (action === 'effect-stat' && condition) _mutate(() => { const current = Array.isArray(condition.effects[arg]) ? condition.effects[arg] : []; condition.effects[arg] = current.includes(extra) ? current.filter(stat => stat !== extra) : CONDITION_ADMIN_STATS.map(([stat]) => stat).filter(stat => current.includes(stat) || stat === extra); });
  else if (action === 'damage-type' && condition) _mutate(() => { const current = Array.isArray(condition.effects.dmgReductionTypes) ? condition.effects.dmgReductionTypes : []; const next = current.includes(arg) ? current.filter(type => type !== arg) : [...current, arg]; if (next.length) condition.effects.dmgReductionTypes = next; else delete condition.effects.dmgReductionTypes; });
  else if (action === 'undo') _undo();
  else if (action === 'reset-all') {
    const customCount = _state.draft.filter(conditionAdminIsCustom).length;
    _mutate(() => { _state.draft = CONDITION_DEFAULT_LIBRARY.map(condition => conditionAdminDefault(condition.id)); if (!_state.draft.some(item => item.id === _state.selectedId)) _state.selectedId = _state.draft[0]?.id || ''; });
    _toast(`Tous les états remis par défaut${customCount ? ` · ${_plural(customCount, 'personnalisé')} retiré${customCount > 1 ? 's' : ''}` : ''}`, true);
  } else if (action === 'save') _save();
  else if (action === 'close') _requestClose();
  else if (action === 'continue') { _state.askClose = false; _renderFooter(); }
  else if (action === 'discard-close') { _state.draft = cloneConditionAdminList(_state.saved); _destroy(); clearModalCloseGuard(); closeModalDirect(); }
  else if (action === 'save-close') _save({ closeAfter: true });
}
