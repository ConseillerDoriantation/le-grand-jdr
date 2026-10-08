// Adventure-scoped spell creation mode. Firestore: world/spell_system.
// Le fallback `runes` ne concerne que les aventures historiques sans document.

const DOC_ID = 'spell_system';

export const SPELL_COST_ROWS = [
  { key: '__noyau', label: 'Noyau', icon: '✦', family: 'base', effect: 'Base obligatoire de tout sort' },
  { key: 'Puissance', label: 'Puissance', icon: '⚔️', family: 'power', effect: '+1 dé de dégâts' },
  { key: 'Protection', label: 'Protection', icon: '💚', family: 'power', effect: '+1d4 soin ou +2 CA (2 tours)' },
  { key: 'Amplification', label: 'Amplification', icon: '🌐', family: 'range', effect: 'Zone +3 cases' },
  { key: 'Dispersion', label: 'Dispersion', icon: '🎯', family: 'range', effect: 'Touche plusieurs cibles' },
  { key: 'Enchantement', label: 'Enchantement', icon: '✨', family: 'support', effect: 'Booste un allié · 2 tours' },
  { key: 'Affliction', label: 'Affliction', icon: '💀', family: 'support', effect: 'Élément + état sur arme ennemie' },
  { key: 'Invocation', label: 'Invocation', icon: '🐾', family: 'support', effect: 'Créature liée au lanceur' },
  { key: 'Chance', label: 'Chance', icon: '🍀', family: 'support', effect: 'Seuil de critique amélioré' },
  { key: 'Durée', label: 'Durée', icon: '⏱️', family: 'meta', effect: '+2 tours' },
  { key: 'Concentration', label: 'Concentration', icon: '🧠', family: 'meta', effect: 'Maintien hors tour' },
  { key: 'Déclenchement', label: 'Déclenchement', icon: '⚡', family: 'meta', effect: 'Réaction ou Action Bonus' },
];

export const SPELL_COST_COLS = [
  { res: 'pm', label: 'PM', full: 'Points de magie', icon: '✦', def: 2, color: '#4f8cff', hint: 'Ressource standard des lanceurs.' },
  { res: 'pv', label: 'PV', full: 'Points de vie', icon: '❤️', def: 2, color: '#e0556f', hint: 'Magie du sang : le lanceur se blesse.' },
  { res: 'or', label: 'Or', full: 'Pièces d’or', icon: '🪙', def: 10, color: '#d9a441', hint: 'Composantes, parchemins et offrandes.' },
  { res: 'garde', label: 'GD', full: 'Garde', icon: '🛡️', def: 2, color: '#5fb0c8', hint: 'Ressource défensive gagnée en bloquant.' },
];

const FREE_RESOURCE = { res: 'none', label: 'Gratuit', full: 'Gratuit', icon: '🆓', color: '#7c8aa5', hint: 'Aucune ressource dépensée.' };
const ALL_RESOURCES = [...SPELL_COST_COLS, FREE_RESOURCE];
const RESOURCE_IDS = ALL_RESOURCES.map(resource => resource.res);
const COL_DEFAULTS = Object.fromEntries(SPELL_COST_COLS.map(column => [column.res, column.def]));
const RATE_DEFAULTS = Object.freeze({ pv: 1, or: 5, garde: 1 });
const RATE_STEPS = Object.freeze({
  pv: [0.5, 1, 1.5, 2, 3, 4, 5],
  garde: [0.5, 1, 1.5, 2, 3, 4, 5],
  or: [1, 2, 3, 4, 5, 6, 8, 10, 15, 20],
});
const FAMILY_LABELS = { base: 'Base', power: 'Puissance', range: 'Portée', support: 'Soutien', meta: 'Méta' };
const DEFAULT_CONFIG = Object.freeze({
  mode: 'runes', costTable: {}, enabledResources: RESOURCE_IDS,
  costRates: RATE_DEFAULTS, costLinked: true,
});

let _config = null;
let _loadPromise = null;
let _adminPromise = null;
let openModal = null;
let closeModalDirect = null;
let setModalCloseGuard = null;
let showNotif = null;
let loadCollection = null;
let updateInCol = null;
let STATE = null;

let _ssSaved = null;
let _ssDraft = null;
let _ssEntries = [];
let _ssRecalc = 'keep';
let _ssAsk = null;
let _ssSaving = false;
const _ssInvalidCells = new Set();

const _clone = value => JSON.parse(JSON.stringify(value));
const _esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const _plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;
const _rateLabel = value => String(value).replace('.', ',');
const _resource = id => ALL_RESOURCES.find(resource => resource.res === id) || SPELL_COST_COLS[0];

function _normalizeCostTable(raw = {}) {
  const out = {};
  for (const { key } of SPELL_COST_ROWS) {
    for (const { res, def } of SPELL_COST_COLS) {
      const number = Number(raw?.[key]?.[res]);
      if (Number.isFinite(number) && number >= 0 && number !== def) {
        (out[key] ||= {})[res] = Math.min(999, Math.round(number));
      }
    }
  }
  return out;
}

function _fullCostTable(raw = {}) {
  const out = {};
  for (const { key } of SPELL_COST_ROWS) {
    out[key] = {};
    for (const { res, def } of SPELL_COST_COLS) {
      const number = Number(raw?.[key]?.[res]);
      out[key][res] = Number.isFinite(number) && number >= 0 ? Math.min(999, Math.round(number)) : def;
    }
  }
  return out;
}

function _closestRate(resource, raw) {
  const steps = RATE_STEPS[resource];
  const number = Number(raw);
  if (!steps || !Number.isFinite(number)) return RATE_DEFAULTS[resource];
  return steps.reduce((best, value) => Math.abs(value - number) < Math.abs(best - number) ? value : best, steps[0]);
}

function _normalizeRates(raw = {}) {
  return Object.fromEntries(Object.keys(RATE_DEFAULTS).map(resource => [resource, _closestRate(resource, raw?.[resource])]));
}

function _isLinked(table, rates) {
  return SPELL_COST_ROWS.every(({ key }) => SPELL_COST_COLS.every(({ res }) => (
    res === 'pm' || table[key][res] === Math.round(table[key].pm * rates[res])
  )));
}

function _normalize(raw = {}) {
  const costTable = _normalizeCostTable(raw.costTable);
  const rates = _normalizeRates(raw.costRates);
  const enabled = Array.isArray(raw.enabledResources)
    ? RESOURCE_IDS.filter(id => raw.enabledResources.includes(id))
    : [...RESOURCE_IDS];
  const enabledResources = enabled.length ? enabled : [...RESOURCE_IDS];
  return {
    mode: raw.mode === 'classic' ? 'classic' : 'runes',
    costTable,
    enabledResources,
    costRates: rates,
    costLinked: typeof raw.costLinked === 'boolean' ? raw.costLinked : _isLinked(_fullCostTable(costTable), rates),
  };
}

export function getSpellSystemMode() { return (_config || DEFAULT_CONFIG).mode; }
export function getSpellSystemConfig() { return _clone(_config || DEFAULT_CONFIG); }

/** Ressources proposées dans les forges. La ressource courante reste accessible aux anciens sorts. */
export function getEnabledSpellResources(currentResource = '') {
  const enabled = [...((_config || DEFAULT_CONFIG).enabledResources || RESOURCE_IDS)];
  if (RESOURCE_IDS.includes(currentResource) && !enabled.includes(currentResource)) enabled.push(currentResource);
  return RESOURCE_IDS.filter(id => enabled.includes(id));
}

export function spellRuneCost(key, res) {
  const stored = Number((_config || DEFAULT_CONFIG).costTable?.[key]?.[res]);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return COL_DEFAULTS[res] ?? 0;
}

export function spellSetCostDelta(pmDelta, res) {
  const delta = Number(pmDelta) || 0;
  if (!delta || res === 'none') return 0;
  const noyauPm = spellRuneCost('__noyau', 'pm') || 1;
  return Math.round(delta * spellRuneCost('__noyau', res) / noyauPm);
}

export function getSpellCostTable() { return _fullCostTable((_config || DEFAULT_CONFIG).costTable); }

export async function loadSpellSystem({ refresh = false } = {}) {
  if (_config && !refresh) return _config;
  if (_loadPromise && !refresh) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const { getDocData } = await import('../data/firestore.js');
      _config = _normalize(await getDocData('world', DOC_ID) || DEFAULT_CONFIG);
    } catch {
      _config = _normalize(DEFAULT_CONFIG);
    } finally {
      _loadPromise = null;
    }
    return _config;
  })();
  return _loadPromise;
}

export function invalidateSpellSystemCache() { _config = null; _loadPromise = null; }

/** Accepte la nouvelle config complète et l'ancienne signature (mode, costTable). */
export async function saveSpellSystem(configOrMode, legacyCostTable) {
  const input = typeof configOrMode === 'string'
    ? { ...(_config || DEFAULT_CONFIG), mode: configOrMode, costTable: legacyCostTable ?? _config?.costTable }
    : configOrMode;
  const next = _normalize(input || DEFAULT_CONFIG);
  const { saveDoc } = await import('../data/firestore.js');
  await saveDoc('world', DOC_ID, { version: 1, ...next });
  _config = next;
  return next;
}

export function setSpellSystemForTests(value) {
  _config = _normalize(typeof value === 'object' ? value : { mode: value });
}

function _spellRuneCounts(spell = {}) {
  const counts = {};
  for (const raw of spell.runes || []) {
    const rune = raw === 'Réaction' || raw === 'Action Bonus' ? 'Déclenchement' : raw;
    if (SPELL_COST_ROWS.some(row => row.key === rune)) counts[rune] = (counts[rune] || 0) + 1;
  }
  return counts;
}

function _spellHasCore(spell = {}) {
  return Boolean(spell.noyau || spell.noyauTypeId || spell.noyauTypeIds?.length);
}

function _spellCost(table, spell, resourceId = spell?.costResource || 'pm') {
  if (resourceId === 'none') return 0;
  let total = _spellHasCore(spell) ? table.__noyau[resourceId] : 0;
  for (const [rune, count] of Object.entries(_spellRuneCounts(spell))) total += (table[rune]?.[resourceId] || 0) * count;
  return total;
}

async function _loadSpellEntries() {
  const [characters, shopItems] = await Promise.all([loadCollection('characters'), loadCollection('shop')]);
  const entries = [];
  const append = (hostCollection, host, field) => {
    (host?.[field] || []).forEach((spell, index) => {
      if (spell && typeof spell === 'object') entries.push({ hostCollection, hostId: host.id, host, field, index, spell });
    });
  };
  characters.forEach(character => append('characters', character, 'deck_sorts'));
  shopItems.forEach(item => append('shop', item, 'actions'));
  return entries;
}

function _draftFromConfig(config) {
  return { mode: config.mode, enabled: [...config.enabledResources], table: _fullCostTable(config.costTable), rates: { ...config.costRates }, linked: config.costLinked };
}
function _draftConfig(draft) {
  return { mode: draft.mode, enabledResources: draft.enabled, costTable: draft.table, costRates: draft.rates, costLinked: draft.linked };
}
function _ssDirty() { return JSON.stringify(_ssDraft) !== JSON.stringify(_ssSaved); }
function _ssErrors() {
  const errors = [];
  if (!_ssDraft?.enabled?.length) errors.push('Active au moins une ressource.');
  if (_ssInvalidCells.size) errors.push('Corrige les valeurs invalides du barème.');
  return errors;
}
function _ssCounts() {
  return _ssEntries.reduce((out, entry) => {
    const mode = entry.spell.designMode === 'classic' ? 'classic' : 'runes';
    out.mode[mode]++;
    const resource = entry.spell.costResource || 'pm';
    out.resource[resource] = (out.resource[resource] || 0) + 1;
    return out;
  }, { mode: { runes: 0, classic: 0 }, resource: {} });
}
function _ssImpacts() {
  if (!_ssDraft || _ssDraft.mode !== 'runes') return [];
  return _ssEntries.filter(entry => entry.spell.designMode !== 'classic')
    .map(entry => ({ ...entry, nextCost: _spellCost(_ssDraft.table, entry.spell) }))
    .filter(entry => Number(entry.spell.pm) !== entry.nextCost);
}
function _ssApplyLink() {
  for (const { key } of SPELL_COST_ROWS) for (const { res } of SPELL_COST_COLS) {
    if (res !== 'pm') _ssDraft.table[key][res] = Math.min(999, Math.round(_ssDraft.table[key].pm * _ssDraft.rates[res]));
  }
}
function _ssRunesLabel(spell) {
  return Object.entries(_spellRuneCounts(spell)).map(([key, count]) => {
    const row = SPELL_COST_ROWS.find(item => item.key === key);
    return `${row?.icon || '•'}${count > 1 ? `×${count}` : ''}`;
  }).join(' ') || 'Noyau seul';
}

function _ssModeSection(counts) {
  const cards = [
    ['runes', 'ᚱ', 'Forge de runes', 'Noyau + runes cumulables, effets dérivés et résonances. Coût calculé par le barème.'],
    ['classic', '✦', 'Sorts classiques', 'Effets directs : dégâts ou soin, portée, zone, état et durée. Coût saisi sur chaque sort.'],
  ].map(([mode, icon, title, description]) => `<button type="button" class="ss2-mode${_ssDraft.mode === mode ? ' on' : ''}" data-action="_ssMode" data-mode="${mode}" aria-pressed="${_ssDraft.mode === mode}"><span class="ss2-mi">${icon}</span><span><b>${title}</b><small>${description}</small></span><span class="ss2-mc">${_plural(counts.mode[mode], 'sort')}</span></button>`).join('');
  return `<section class="ss2-sec"><div class="ss2-sec-h"><span class="ss2-label">Forge par défaut</span><span class="ss2-sp"></span><span class="ss2-hint">Proposée à la création d’un nouveau sort</span></div><div class="ss2-modes">${cards}</div><p class="ss2-plain-note">Aucune conversion : les sorts existants gardent leur forge et restent modifiables avec elle.</p></section>`;
}

function _ssResourceSection(counts) {
  const chips = ALL_RESOURCES.map(resource => {
    const active = _ssDraft.enabled.includes(resource.res);
    const count = counts.resource[resource.res] || 0;
    return `<button type="button" class="ss2-rc${active ? ' on' : ''}" style="--rc:${resource.color}" data-action="_ssResource" data-resource="${resource.res}" aria-pressed="${active}" title="${_esc(resource.hint)} ${count ? `${_plural(count, 'sort')} l’utilisent.` : 'Aucun sort ne l’utilise.'}"><span class="ss2-rc-icon">${resource.icon}</span>${_esc(resource.full)}<i>${count}</i></button>`;
  }).join('');
  const disabledUsed = ALL_RESOURCES.filter(resource => !_ssDraft.enabled.includes(resource.res) && counts.resource[resource.res]);
  const warning = !_ssDraft.enabled.length
    ? '<div class="ss2-warning is-error">Active au moins une ressource.</div>'
    : disabledUsed.length
      ? `<div class="ss2-warning">${disabledUsed.map(resource => `${_esc(resource.full)} : ${_plural(counts.resource[resource.res], 'sort')}`).join(' · ')} — ils restent payables ainsi ; seule la forge ne les propose plus.</div>`
      : '';
  return `<section class="ss2-sec"><div class="ss2-sec-h"><span class="ss2-label">Ressources de lancement</span><span class="ss2-sp"></span><span class="ss2-hint">Celles que le joueur peut choisir pour payer un sort</span></div><div class="ss2-resources">${chips}</div>${warning}</section>`;
}

function _ssRatesHtml() {
  if (!_ssDraft.linked) return '';
  return SPELL_COST_COLS.filter(column => column.res !== 'pm').map(column => {
    const steps = RATE_STEPS[column.res];
    const index = steps.indexOf(_ssDraft.rates[column.res]);
    return `<span class="ss2-rate" style="--rc:${column.color}"><b>${column.label}</b><span>= PM ×</span><span class="ss2-step"><button type="button" data-action="_ssRate" data-resource="${column.res}" data-delta="-1" ${index <= 0 ? 'disabled' : ''}>−</button><span>${_rateLabel(_ssDraft.rates[column.res])}</span><button type="button" data-action="_ssRate" data-resource="${column.res}" data-delta="1" ${index >= steps.length - 1 ? 'disabled' : ''}>+</button></span></span>`;
  }).join('');
}

function _ssCostTableHtml() {
  let family = '';
  let rows = `<div class="ss2-grid-head"><span>Brique</span>${SPELL_COST_COLS.map(column => `<span class="${_ssDraft.enabled.includes(column.res) ? '' : 'off'}" style="--rc:${column.color}" title="${_esc(column.full)}${_ssDraft.enabled.includes(column.res) ? '' : ' · désactivée'}">${column.icon} ${column.label}</span>`).join('')}</div>`;
  for (const row of SPELL_COST_ROWS) {
    if (row.family !== family) {
      family = row.family;
      if (family !== 'base') rows += `<div class="ss2-family">${FAMILY_LABELS[family]}</div>`;
    }
    rows += `<div class="ss2-grid-row${row.key === '__noyau' ? ' is-core' : ''}"><span class="ss2-rune"><span>${row.icon}</span><span><b>${_esc(row.label)}</b><small>${_esc(row.effect)}</small></span></span>${SPELL_COST_COLS.map(column => {
      const value = _ssDraft.table[row.key][column.res];
      const inactive = _ssDraft.enabled.includes(column.res) ? '' : ' off';
      if (_ssDraft.linked && column.res !== 'pm') return `<span class="ss2-cell read-only${inactive}" style="--rc:${column.color}" data-derived="${_esc(row.key)}:${column.res}" title="PM × ${_rateLabel(_ssDraft.rates[column.res])}">${value}</span>`;
      return `<input class="ss2-cell${value !== column.def ? ' modified' : ''}${inactive}" style="--rc:${column.color}" data-input="_ssCostInput" data-change="_ssCostCommit" data-cell="${_esc(row.key)}:${column.res}" value="${value}" inputmode="numeric" maxlength="3" aria-label="${_esc(row.label)} — ${_esc(column.full)}" title="Défaut : ${column.def}">`;
    }).join('')}</div>`;
  }
  return `<div class="ss2-cost-grid">${rows}</div>`;
}

function _ssImpactHtml() {
  const impacts = _ssImpacts();
  const heading = `<div class="ss2-sec-h"><span class="ss2-label">Sorts déjà forgés</span><span class="ss2-sp"></span><span class="ss2-hint">Leur coût est figé à l’enregistrement du sort</span></div>`;
  if (!impacts.length) return `${heading}<div class="ss2-impact-list"><p class="ss2-empty">Aucun sort existant n’est affecté : leur coût enregistré correspond à ce barème.</p></div>`;
  const list = impacts.map(entry => {
    const spell = entry.spell;
    const resource = _resource(spell.costResource || 'pm');
    const oldCost = Number(spell.pm) || 0;
    const override = spell.pmOverride != null ? `<em title="Le coût ajusté par le MJ reste prioritaire">ajusté MJ : ${Number(spell.pmOverride) || 0} conservé</em>` : '';
    return `<div class="ss2-impact"><span class="ss2-impact-key"><span>${_esc(spell.icon || '✦')}</span><span><b>${_esc(spell.nom || 'Sort sans nom')}</b><small>${_esc(_ssRunesLabel(spell))} · ${_esc(resource.full)}</small></span></span><span class="ss2-impact-value"><s>${oldCost}</s>→<b class="${entry.nextCost > oldCost ? 'up' : 'down'}">${entry.nextCost}</b> ${_esc(resource.label)}${override}</span></div>`;
  }).join('');
  const total = _ssEntries.filter(entry => entry.spell.designMode !== 'classic').length;
  return `${heading}<div class="ss2-impact-list">${list}</div><div class="ss2-toolbar"><span class="ss2-hint">${_plural(impacts.length, 'sort')} sur ${total} ne correspondent plus au barème.</span><span class="ss2-sp"></span><div class="ss2-seg"><button type="button" class="${_ssRecalc === 'keep' ? 'on' : ''}" data-action="_ssRecalc" data-mode="keep">Garder leur coût</button><button type="button" class="${_ssRecalc === 'recalc' ? 'on' : ''}" data-action="_ssRecalc" data-mode="recalc">Recalculer à l’enregistrement</button></div></div>`;
}

function _ssRuneSection() {
  if (_ssDraft.mode !== 'runes') return `<section class="ss2-sec"><div class="ss2-sec-h"><span class="ss2-label">Barème des briques</span></div><div class="ss2-classic-note">En sorts classiques, le coût et la ressource se saisissent sur chaque sort. Le barème reste enregistré : il reprendra effet si tu reviens à la forge de runes, et le coût du noyau sert toujours à convertir les réductions de set d’armure.</div></section>`;
  return `<section class="ss2-sec"><div class="ss2-sec-h"><span class="ss2-label">Barème des briques</span><span class="ss2-sp"></span><span class="ss2-hint">Coût d’un sort = noyau + chaque rune × son nombre</span></div><div class="ss2-toolbar"><label class="ss2-link"><button type="button" class="ss2-switch${_ssDraft.linked ? ' on' : ''}" data-action="_ssLinked" role="switch" aria-checked="${_ssDraft.linked}"><i></i></button>Lier au coût en PM</label>${_ssRatesHtml()}<span class="ss2-sp"></span><button type="button" class="ss2-btn text small" data-action="_ssDefaults">Rétablir les défauts</button></div>${_ssCostTableHtml()}<p class="ss2-plain-note">Une case teintée diffère du défaut (2 PM · 2 PV · 10 Or · 2 GD). Le coût du <b>noyau</b> sert aussi à convertir les réductions de set d’armure.</p></section><section class="ss2-sec" id="ss2-impact">${_ssImpactHtml()}</section>`;
}

function _ssMainHtml() { const counts = _ssCounts(); return `${_ssModeSection(counts)}${_ssResourceSection(counts)}${_ssRuneSection()}`; }

function _ssFootHtml() {
  if (_ssAsk === 'close') return `<span class="ss2-ask">Abandonner les modifications ?</span><span class="ss2-sp"></span><button type="button" class="ss2-btn text" data-action="_ssKeep">Continuer l’édition</button><button type="button" class="ss2-btn ghost" data-action="_ssDiscard">Abandonner</button>`;
  const errors = _ssErrors();
  const dirty = _ssDirty();
  const impacts = _ssImpacts();
  const canSave = !errors.length && !_ssSaving && (dirty || (_ssRecalc === 'recalc' && impacts.length));
  const info = errors.length
    ? `<span class="ss2-info error">${_esc(errors[0])}</span>`
    : dirty
      ? `<span class="ss2-info"><i></i>Modifications non enregistrées${_ssRecalc === 'recalc' && impacts.length ? ` · ${_plural(impacts.length, 'sort')} ${impacts.length > 1 ? 'seront' : 'sera'} recalculé${impacts.length > 1 ? 's' : ''}` : ''}</span>`
      : '<span class="ss2-info">À jour</span>';
  return `${info}<span class="ss2-sp"></span><button type="button" class="ss2-btn text" data-action="_ssRevert" ${dirty ? '' : 'disabled'}>↶ Annuler les modifications</button><button type="button" class="ss2-btn primary" data-action="_ssSave" ${canSave ? '' : 'disabled'}>${_ssSaving ? 'Enregistrement…' : 'Enregistrer'}</button>`;
}

function _ssRenderMain() { const element = document.getElementById('ss2-main'); if (element) element.innerHTML = _ssMainHtml(); }
function _ssRenderImpact() { const element = document.getElementById('ss2-impact'); if (element) element.innerHTML = _ssImpactHtml(); }
function _ssRenderFoot() { const element = document.getElementById('ss2-foot'); if (element) element.innerHTML = _ssFootHtml(); }
function _ssRender() { _ssRenderMain(); _ssRenderFoot(); }

function _ssSyncGuard() {
  setModalCloseGuard(() => {
    if (_ssAsk) return true;
    if (_ssDirty()) { _ssAsk = 'close'; _ssRenderFoot(); return true; }
    return false;
  });
}
function _ssClose() {
  if (_ssDirty()) { _ssAsk = 'close'; _ssRenderFoot(); return; }
  setModalCloseGuard(null);
  closeModalDirect();
}
function _ssMode(element) { _ssDraft.mode = element.dataset.mode === 'classic' ? 'classic' : 'runes'; _ssRender(); }
function _ssToggleResource(element) {
  const id = element.dataset.resource;
  if (!RESOURCE_IDS.includes(id)) return;
  const index = _ssDraft.enabled.indexOf(id);
  if (index >= 0) _ssDraft.enabled.splice(index, 1); else _ssDraft.enabled.push(id);
  _ssDraft.enabled = RESOURCE_IDS.filter(resource => _ssDraft.enabled.includes(resource));
  _ssRender();
}
function _ssToggleLinked() {
  _ssDraft.linked = !_ssDraft.linked;
  if (_ssDraft.linked) {
    const wasLinked = _isLinked(_ssDraft.table, _ssDraft.rates);
    _ssApplyLink();
    if (!wasLinked) showNotif('PV, Or et Garde recalculés depuis les PM.', 'info');
  }
  _ssRender();
}
function _ssStepRate(element) {
  const resource = element.dataset.resource;
  const steps = RATE_STEPS[resource];
  if (!steps) return;
  const current = steps.indexOf(_ssDraft.rates[resource]);
  const next = Math.max(0, Math.min(steps.length - 1, current + Number(element.dataset.delta || 0)));
  _ssDraft.rates[resource] = steps[next];
  _ssApplyLink();
  _ssRender();
}
function _ssRestoreDefaults() {
  _ssDraft.table = _fullCostTable({});
  _ssDraft.rates = { ...RATE_DEFAULTS };
  _ssDraft.linked = true;
  _ssInvalidCells.clear();
  _ssRender();
  showNotif('Barème remis aux valeurs par défaut.', 'info');
}
function _ssReadCell(element) {
  const [key, resource] = String(element.dataset.cell || '').split(':');
  const raw = element.value.trim();
  const value = Number.parseInt(raw, 10);
  if (!/^\d{1,3}$/.test(raw) || value > 999 || !_ssDraft.table[key] || !SPELL_COST_COLS.some(column => column.res === resource)) {
    _ssInvalidCells.add(element.dataset.cell);
    element.classList.add('invalid');
    _ssRenderFoot();
    return;
  }
  _ssInvalidCells.delete(element.dataset.cell);
  element.classList.remove('invalid');
  _ssDraft.table[key][resource] = value;
  const column = SPELL_COST_COLS.find(item => item.res === resource);
  element.classList.toggle('modified', value !== column.def);
  if (_ssDraft.linked && resource === 'pm') {
    for (const derived of SPELL_COST_COLS.filter(item => item.res !== 'pm')) {
      const next = Math.min(999, Math.round(value * _ssDraft.rates[derived.res]));
      _ssDraft.table[key][derived.res] = next;
      const output = [...document.querySelectorAll('[data-derived]')]
        .find(candidate => candidate.dataset.derived === `${key}:${derived.res}`);
      if (output) output.textContent = next;
    }
  }
  _ssRenderImpact();
  _ssRenderFoot();
}
function _ssCommitCell(element) {
  if (!element.classList.contains('invalid')) return;
  const [key, resource] = String(element.dataset.cell || '').split(':');
  element.value = _ssDraft.table?.[key]?.[resource] ?? 0;
  element.classList.remove('invalid');
  _ssInvalidCells.delete(element.dataset.cell);
  _ssRenderFoot();
}

async function _ssRecalculateSpells(impacts) {
  const groups = new Map();
  for (const impact of impacts) {
    const key = `${impact.hostCollection}:${impact.hostId}:${impact.field}`;
    if (!groups.has(key)) groups.set(key, { ...impact, list: (impact.host[impact.field] || []).map(spell => ({ ...spell })) });
    groups.get(key).list[impact.index] = { ...groups.get(key).list[impact.index], pm: impact.nextCost };
  }
  await Promise.all([...groups.values()].map(group => updateInCol(group.hostCollection, group.hostId, { [group.field]: group.list })));
  for (const group of groups.values()) {
    group.host[group.field] = group.list;
    if (group.hostCollection === 'characters') {
      const stateCharacter = STATE.characters?.find(character => character.id === group.hostId);
      if (stateCharacter) stateCharacter[group.field] = group.list;
    }
  }
  // Les hôtes et leurs listes viennent d'être mis à jour localement. Réindexer
  // ces références suffit : inutile de relire deux collections Firestore.
  _ssEntries = _ssEntries.map(entry => ({
    ...entry,
    spell: entry.host?.[entry.field]?.[entry.index] || entry.spell,
  }));
}

async function _ssSave() {
  if (_ssSaving || _ssErrors().length) return;
  const impacts = _ssRecalc === 'recalc' ? _ssImpacts() : [];
  if (!_ssDirty() && !impacts.length) return;
  _ssSaving = true;
  _ssRenderFoot();
  try {
    await saveSpellSystem(_draftConfig(_ssDraft));
    _ssSaved = _clone(_ssDraft);
    if (impacts.length) await _ssRecalculateSpells(impacts);
    _ssRecalc = 'keep';
    showNotif(impacts.length ? `Système enregistré · ${_plural(impacts.length, 'sort')} recalculé${impacts.length > 1 ? 's' : ''}.` : 'Système de sorts enregistré.', 'success');
    _ssRender();
  } catch (error) {
    showNotif(error?.message || 'Erreur lors de l’enregistrement.', 'error');
  } finally {
    _ssSaving = false;
    _ssRenderFoot();
  }
}
function _ssRevert() { _ssDraft = _clone(_ssSaved); _ssRecalc = 'keep'; _ssAsk = null; _ssInvalidCells.clear(); _ssRender(); }
function _ssDiscard() {
  _ssDraft = _clone(_ssSaved); _ssRecalc = 'keep'; _ssAsk = null; _ssInvalidCells.clear();
  setModalCloseGuard(null); closeModalDirect();
}

function _ssMountKeyboard() {
  if (document.documentElement.dataset.ssKeyboardMounted === '1') return;
  document.documentElement.dataset.ssKeyboardMounted = '1';
  document.addEventListener('keydown', event => {
    if (!document.querySelector('.ss2')) return;
    if (event.key === 'Escape' && _ssAsk) {
      event.preventDefault(); event.stopImmediatePropagation(); _ssAsk = null; _ssRenderFoot(); return;
    }
    const input = event.target.closest?.('.ss2-cell[data-cell]');
    if (!input || !['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const resource = input.dataset.cell.split(':')[1];
    const cells = [...document.querySelectorAll('.ss2-cell[data-cell]')].filter(cell => cell.dataset.cell.endsWith(`:${resource}`));
    const index = cells.indexOf(input);
    const next = cells[index + (event.key === 'ArrowUp' ? -1 : 1)];
    next?.focus(); next?.select();
  }, true);
  document.addEventListener('focusin', event => { if (event.target.matches?.('.ss2-cell[data-cell]')) event.target.select(); });
}

async function _ensureAdmin() {
  if (_adminPromise) return _adminPromise;
  _adminPromise = Promise.all([
    import('../core/actions.js'), import('./modal.js'), import('./notifications.js'),
    import('../data/firestore.js'), import('../core/state.js'),
  ]).then(([actions, modal, notifications, firestore, state]) => {
    openModal = modal.openModal;
    closeModalDirect = modal.closeModalDirect;
    setModalCloseGuard = modal.setModalCloseGuard;
    showNotif = notifications.showNotif;
    loadCollection = firestore.loadCollection;
    updateInCol = firestore.updateInCol;
    STATE = state.STATE;
    actions.registerActions({
      _ssClose, _ssMode, _ssResource: _ssToggleResource, _ssLinked: _ssToggleLinked,
      _ssRate: _ssStepRate, _ssDefaults: _ssRestoreDefaults,
      _ssRecalc: element => { _ssRecalc = element.dataset.mode === 'recalc' ? 'recalc' : 'keep'; _ssRenderImpact(); _ssRenderFoot(); },
      _ssRevert, _ssSave, _ssKeep: () => { _ssAsk = null; _ssRenderFoot(); }, _ssDiscard,
      _ssCostInput: _ssReadCell, _ssCostCommit: _ssCommitCell,
    });
    _ssMountKeyboard();
  });
  return _adminPromise;
}

export async function openSpellSystemAdmin() {
  await _ensureAdmin();
  await loadSpellSystem();
  try {
    _ssEntries = await _loadSpellEntries();
  } catch (error) {
    console.warn('[spell-system] index des sorts indisponible', error);
    _ssEntries = [];
    showNotif('Certains compteurs de sorts sont indisponibles.', 'warning');
  }
  _ssSaved = _draftFromConfig(_config || DEFAULT_CONFIG);
  _ssDraft = _clone(_ssSaved);
  _ssRecalc = 'keep'; _ssAsk = null; _ssSaving = false; _ssInvalidCells.clear();
  openModal('', `<div class="ss2"><header class="ss2-head"><div><h2>Système de sorts</h2><small>Forge par défaut, ressources de lancement et barème des briques.</small></div><span class="ss2-sp"></span><button type="button" class="ss2-close" data-action="_ssClose" aria-label="Fermer">×</button></header><main class="ss2-main" id="ss2-main">${_ssMainHtml()}</main><footer class="ss2-foot" id="ss2-foot">${_ssFootHtml()}</footer></div>`);
  _ssSyncGuard();
}
