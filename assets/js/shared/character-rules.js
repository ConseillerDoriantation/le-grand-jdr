// Per-adventure character calculation rules.
// Firestore: world/character_rules

const DOC_ID = 'character_rules';

export const LEGACY_CHARACTER_RULES = {
  version: 1,
  modifier: {
    formula: 'floor((score - 10) / 2)',
    min: null,
    max: 6,
  },
  armorBases: {
    none: 8,
    light: 8,
    medium: 8,
    heavy: 8,
  },
  formulas: {
    ca: 'armorBase + dexMod + equipCA + equipBonus + shieldBonus',
    speed: '3 + forceMod + equipBonus',
    initiative: 'dexMod + equipBonus',
    deck: '3 + min(0, intMod) + floor(max(0, intMod) * pow(max(0, level - 1), 0.75))',
    pv: 'pvBase + floor(max(0, conMod) * max(0, level - 1)) + min(0, conMod) + equipBonus',
    pm: 'pmBase + floor(max(0, sagMod) * max(0, level - 1)) + min(0, sagMod) + equipBonus',
    xp: '100 * level * level',
  },
};

// Default for every new adventure. D&D has no PM or spell deck, so those two
// formulas use conservative Grimorium-compatible adaptations.
export const DEFAULT_CHARACTER_RULES = {
  version: 2,
  modifier: {
    formula: 'floor((score - 10) / 2)',
    min: null,
    max: null,
  },
  armorBases: {
    none: 10,
    light: 10,
    medium: 10,
    heavy: 10,
  },
  formulas: {
    ca: 'armorBase + dexMod + equipCA + equipBonus + shieldBonus',
    speed: '6 + equipBonus',
    initiative: 'dexMod + equipBonus',
    deck: 'max(1, level + max(intMod, sagMod, chaMod))',
    pv: 'pvBase + conMod * level + equipBonus',
    pm: 'pmBase + equipBonus',
    xp: '100 * level * level',
  },
};

const FORMULA_META = [
  { key: 'ca', icon: '🛡️', label: "Classe d'armure", vars: ['armorBase', 'dexMod', 'equipCA', 'equipBonus', 'shieldBonus'] },
  { key: 'speed', icon: '🏃', label: 'Vitesse', vars: ['forceMod', 'equipBonus', 'level'] },
  { key: 'initiative', icon: '⚡', label: 'Initiative', vars: ['dexMod', 'equipBonus', 'level'] },
  { key: 'deck', icon: '✦', label: 'Taille du deck', vars: ['intMod', 'sagMod', 'chaMod', 'level'] },
  { key: 'pv', icon: '♥', label: 'PV maximum', vars: ['pvBase', 'conMod', 'level', 'equipBonus'] },
  { key: 'pm', icon: '◆', label: 'PM maximum', vars: ['pmBase', 'sagMod', 'level', 'equipBonus'] },
  { key: 'xp', icon: '★', label: "Palier d'XP", vars: ['level'] },
];

const MODIFIER_META = { key: 'modifier', icon: '±', label: 'Modificateur', vars: ['score'] };
const ALL_FORMULA_META = [MODIFIER_META, ...FORMULA_META];
const VARIABLE_LABELS = {
  score: 'Score de statistique',
  forceScore: 'Score de Force',
  dexScore: 'Score de Dextérité',
  conScore: 'Score de Constitution',
  intScore: "Score d'Intelligence",
  sagScore: 'Score de Sagesse',
  chaScore: 'Score de Charisme',
  armorBase: 'Base de CA',
  armorDexMod: 'Mod. Dex (compat ancien calcul)',
  dexMod: 'Mod. Dextérité',
  forceMod: 'Mod. Force',
  intMod: 'Mod. Intelligence',
  conMod: 'Mod. Constitution',
  sagMod: 'Mod. Sagesse',
  chaMod: 'Mod. Charisme',
  equipCA: "CA de l'équipement",
  equipBonus: "Bonus d'équipement",
  shieldBonus: 'Bonus de bouclier',
  pvBase: 'PV de base',
  pmBase: 'PM de base',
  level: 'Niveau',
};

const CHARACTER_VARIABLES = [
  'forceScore', 'dexScore', 'conScore', 'intScore', 'sagScore', 'chaScore',
  'forceMod', 'dexMod', 'conMod', 'intMod', 'sagMod', 'chaMod',
];

const CHARACTER_SAMPLE = {
  forceScore: 14, dexScore: 14, conScore: 14, intScore: 16, sagScore: 12, chaScore: 10,
  forceMod: 2, dexMod: 2, conMod: 2, intMod: 3, sagMod: 1, chaMod: 0,
};

const SAMPLE_CONTEXTS = {
  modifier: { score: 14 },
  ca: { ...CHARACTER_SAMPLE, armorBase: 10, armorDexMod: 2, equipCA: 0, equipBonus: 0, shieldBonus: 0, level: 5 },
  speed: { ...CHARACTER_SAMPLE, equipBonus: 1, level: 5 },
  initiative: { ...CHARACTER_SAMPLE, equipBonus: 1, level: 5 },
  deck: { ...CHARACTER_SAMPLE, level: 5 },
  pv: { ...CHARACTER_SAMPLE, pvBase: 10, level: 5, equipBonus: 3 },
  pm: { ...CHARACTER_SAMPLE, pmBase: 10, level: 5, equipBonus: 3 },
  xp: { ...CHARACTER_SAMPLE, level: 5 },
};

let _rules = null;
let _loadPromise = null;
let _draft = null;
let _baseRules = DEFAULT_CHARACTER_RULES;
let _activeFormulaPath = 'modifier.formula';
let _adminUiPromise = null;
let _esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let openModal = null;
let closeModalDirect = null;
let confirmModal = null;
let showNotif = null;

const _clone = value => JSON.parse(JSON.stringify(value));
const _finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const _limitOrNull = value => value === '' || value == null ? null : _finiteOr(value, null);

function _mergeDefaults(stored = {}, defaults = DEFAULT_CHARACTER_RULES) {
  const d = defaults;
  return {
    version: d.version,
    modifier: {
      formula: String(stored.modifier?.formula || d.modifier.formula),
      min: _limitOrNull(stored.modifier?.min),
      max: stored.modifier?.max === null ? null : _finiteOr(stored.modifier?.max, d.modifier.max),
    },
    armorBases: {
      none: _finiteOr(stored.armorBases?.none, d.armorBases.none),
      light: _finiteOr(stored.armorBases?.light, d.armorBases.light),
      medium: _finiteOr(stored.armorBases?.medium, d.armorBases.medium),
      heavy: _finiteOr(stored.armorBases?.heavy, d.armorBases.heavy),
    },
    formulas: Object.fromEntries(
      Object.entries(d.formulas).map(([key, formula]) => [key, String(stored.formulas?.[key] || formula)])
    ),
  };
}

export function getCharacterRules() {
  return _rules || DEFAULT_CHARACTER_RULES;
}

export async function loadCharacterRules({ refresh = false } = {}) {
  if (_rules && !refresh) return _rules;
  if (_loadPromise && !refresh) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const { getDocData, getCurrentAdventureId } = await import('../data/firestore.js');
      _baseRules = getCurrentAdventureId() === 'le-grand-jdr'
        ? LEGACY_CHARACTER_RULES
        : DEFAULT_CHARACTER_RULES;
      _rules = _mergeDefaults(await getDocData('world', DOC_ID) || {}, _baseRules);
    } catch {
      _rules = _mergeDefaults({}, _baseRules);
    } finally {
      _loadPromise = null;
    }
    return _rules;
  })();
  return _loadPromise;
}

export function invalidateCharacterRulesCache() {
  _rules = null;
  _loadPromise = null;
  _baseRules = DEFAULT_CHARACTER_RULES;
}

export async function saveCharacterRules(rules) {
  const clean = _mergeDefaults(rules, _baseRules);
  _validateRules(clean);
  const { saveDoc } = await import('../data/firestore.js');
  await saveDoc('world', DOC_ID, clean);
  _rules = clean;
  return clean;
}

// Test hook kept explicit so tests never depend on Firestore.
export function setCharacterRulesForTests(rules = null) {
  _baseRules = DEFAULT_CHARACTER_RULES;
  _rules = rules ? _mergeDefaults(rules, DEFAULT_CHARACTER_RULES) : null;
  _loadPromise = null;
}

const MATH_FUNCTIONS = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

function _tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/\d|\./.test(ch)) {
      const match = source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw new Error(`Nombre invalide près de "${source.slice(i, i + 8)}".`);
      tokens.push({ type: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
      tokens.push({ type: 'name', value: match });
      i += match.length;
      continue;
    }
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Caractère interdit : "${ch}".`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function _parseFormula(source, variables = {}) {
  const tokens = _tokenize(String(source || '').trim());
  let pos = 0;
  const peek = () => tokens[pos];
  const take = type => {
    if (peek().type !== type) throw new Error(`"${type}" attendu.`);
    return tokens[pos++];
  };

  const primary = () => {
    if (peek().type === 'number') return take('number').value;
    if (peek().type === '(') {
      take('(');
      const value = expression();
      take(')');
      return value;
    }
    if (peek().type === 'name') {
      const name = take('name').value;
      if (peek().type === '(') {
        const fn = MATH_FUNCTIONS[name];
        if (!fn) throw new Error(`Fonction inconnue : ${name}.`);
        take('(');
        const args = [];
        if (peek().type !== ')') {
          args.push(expression());
          while (peek().type === ',') { take(','); args.push(expression()); }
        }
        take(')');
        return fn(...args);
      }
      if (!Object.prototype.hasOwnProperty.call(variables, name)) throw new Error(`Variable inconnue : ${name}.`);
      return _finiteOr(variables[name], 0);
    }
    throw new Error('Nombre, variable ou parenthèse attendu.');
  };

  const unary = () => {
    if (peek().type === '+') { take('+'); return unary(); }
    if (peek().type === '-') { take('-'); return -unary(); }
    return primary();
  };
  const power = () => {
    const left = unary();
    if (peek().type === '^') { take('^'); return Math.pow(left, power()); }
    return left;
  };
  const product = () => {
    let value = power();
    while (['*', '/', '%'].includes(peek().type)) {
      const op = tokens[pos++].type;
      const right = power();
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  };
  const expression = () => {
    let value = product();
    while (['+', '-'].includes(peek().type)) {
      const op = tokens[pos++].type;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };

  if (peek().type === 'eof') throw new Error('La formule est vide.');
  const result = expression();
  if (peek().type !== 'eof') throw new Error(`Élément inattendu : ${peek().value || peek().type}.`);
  if (!Number.isFinite(result)) throw new Error('Le résultat doit être un nombre fini.');
  return result;
}

export function evaluateCharacterFormula(formula, variables, fallback = 0) {
  try {
    return _parseFormula(formula, variables);
  } catch (error) {
    console.warn('[character-rules] formule invalide, fallback applique', error.message);
    return fallback;
  }
}

function _validateRules(rules) {
  _parseFormula(rules.modifier.formula, SAMPLE_CONTEXTS.modifier);
  FORMULA_META.forEach(meta => _parseFormula(rules.formulas[meta.key], SAMPLE_CONTEXTS[meta.key]));
  const { min, max } = rules.modifier;
  if (min != null && max != null && min > max) throw new Error('Le modificateur minimum ne peut pas dépasser le maximum.');
}

function _setDraft(path, value) {
  const parts = path.split('.');
  let target = _draft;
  for (let i = 0; i < parts.length - 1; i += 1) target = target[parts[i]];
  target[parts.at(-1)] = value;
}

function _getDraft(path) {
  return path.split('.').reduce((value, part) => value?.[part], _draft);
}

function _formulaPath(meta) {
  return meta.key === 'modifier' ? 'modifier.formula' : `formulas.${meta.key}`;
}

function _formulaMeta(path = _activeFormulaPath) {
  return ALL_FORMULA_META.find(meta => _formulaPath(meta) === path) || MODIFIER_META;
}

function _formulaDefault(path) {
  return path === 'modifier.formula'
    ? _baseRules.modifier.formula
    : _baseRules.formulas[path.split('.').at(-1)];
}

function _formulaSample(meta) {
  return meta.key === 'modifier' ? SAMPLE_CONTEXTS.modifier : SAMPLE_CONTEXTS[meta.key];
}

function _formulaResult(meta, formula = _getDraft(_formulaPath(meta))) {
  try {
    const value = _parseFormula(formula, _formulaSample(meta));
    return { valid: true, value };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function _formulaFeedbackHtml(meta, result) {
  return result.valid
    ? `<span>✓ Formule valide</span><b>Aperçu : ${result.value}</b><small>avec ${Object.entries(_formulaSample(meta)).map(([key, value]) => `${key}=${value}`).join(' · ')}</small>`
    : `<span>⚠ Formule incomplète</span><b>${_esc(result.error)}</b><small>La sauvegarde reste bloquée jusqu'à la correction.</small>`;
}

function _allDraftValid() {
  if (!_draft) return false;
  const formulasOk = ALL_FORMULA_META.every(meta => _formulaResult(meta).valid);
  const { min, max } = _draft.modifier;
  return formulasOk && !(min != null && max != null && min > max);
}

function _renderFormulaWorkbench() {
  const active = _formulaMeta();
  const path = _formulaPath(active);
  const formula = _getDraft(path);
  const result = _formulaResult(active, formula);
  const variableButtons = active.vars.map(variable => `
    <button type="button" class="cr-rule-token is-variable" data-action="_charRulesInsertToken"
      data-field="${path}" data-token="${variable}" title="Ajouter ${_esc(VARIABLE_LABELS[variable] || variable)}">
      <span>${_esc(VARIABLE_LABELS[variable] || variable)}</span><small>${variable}</small>
    </button>`).join('');
  const otherVariables = ['modifier', 'xp'].includes(active.key)
    ? []
    : CHARACTER_VARIABLES.filter(variable => !active.vars.includes(variable));
  const otherVariableButtons = otherVariables.map(variable => `
    <button type="button" class="cr-rule-token is-variable" data-action="_charRulesInsertToken"
      data-field="${path}" data-token="${variable}" title="Ajouter ${_esc(VARIABLE_LABELS[variable] || variable)}">
      <span>${_esc(VARIABLE_LABELS[variable] || variable)}</span><small>${variable}</small>
    </button>`).join('');
  const selector = ALL_FORMULA_META.map(meta => {
    const metaPath = _formulaPath(meta);
    const state = _formulaResult(meta);
    return `<button type="button" class="cr-rule-formula-nav ${metaPath === path ? 'is-active' : ''} ${state.valid ? '' : 'is-invalid'}"
      data-action="_charRulesSelectFormula" data-field="${metaPath}">
      <span>${meta.icon}</span><b>${_esc(meta.label)}</b><i>${state.valid ? '✓' : '!'}</i>
    </button>`;
  }).join('');

  return `<div class="cr-rule-workbench">
    <nav class="cr-rule-formula-navs" aria-label="Formules de personnage">${selector}</nav>
    <div class="cr-rule-studio" data-formula-card="${path}">
      <div class="cr-rule-studio-head">
        <div><small>FORMULE ACTIVE</small><h3>${active.icon} ${_esc(active.label)}</h3></div>
        <button type="button" class="cr-rule-icon-btn" data-action="_charRulesResetOne" data-field="${path}"
          title="Restaurer la formule par défaut">↻</button>
      </div>

      <div class="cr-rule-builder-group">
        <span class="cr-rule-builder-label">Données disponibles</span>
        <div class="cr-rule-tokens">${variableButtons}</div>
      </div>
      ${otherVariables.length ? `<details class="cr-rule-more-vars">
        <summary>Autres caractéristiques disponibles</summary>
        <div class="cr-rule-tokens">${otherVariableButtons}</div>
      </details>` : ''}

      <div class="cr-rule-builder-group">
        <span class="cr-rule-builder-label">Opérations</span>
        <div class="cr-rule-tokens is-operators">
          ${['+', '-', '*', '/', '%', '^', '(', ')'].map(token => `<button type="button" class="cr-rule-token is-operator"
            data-action="_charRulesInsertToken" data-field="${path}" data-token="${token}" title="Ajouter ${token}">${token}</button>`).join('')}
        </div>
      </div>

      <div class="cr-rule-builder-group">
        <span class="cr-rule-builder-label">Fonctions</span>
        <div class="cr-rule-tokens is-functions">
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="floor({x})">Arrondir bas</button>
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="round({x})">Arrondir</button>
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="ceil({x})">Arrondir haut</button>
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="abs({x})">Valeur absolue</button>
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="min({x}, 0)">Minimum</button>
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="max({x}, 0)">Maximum</button>
          <button type="button" class="cr-rule-token" data-action="_charRulesInsertFunction" data-field="${path}" data-template="pow({x}, 2)">Puissance</button>
        </div>
      </div>

      <label class="cr-rule-expression ${result.valid ? 'is-valid' : 'is-invalid'}">
        <span>Expression construite</span>
        <div class="cr-rule-expression-row">
          <input type="text" value="${_esc(formula)}" spellcheck="false" autocomplete="off"
            aria-invalid="${result.valid ? 'false' : 'true'}"
            data-input="_charRuleFormula" data-field="${path}">
          <button type="button" class="cr-rule-icon-btn" data-action="_charRulesClearFormula" data-field="${path}" title="Effacer la formule">⌫</button>
        </div>
      </label>
      <div class="cr-rule-validation ${result.valid ? 'is-valid' : 'is-invalid'}">
        ${_formulaFeedbackHtml(active, result)}
      </div>
    </div>
  </div>`;
}

function _refreshFormulaWorkbench({ focus = false } = {}) {
  const container = document.querySelector('.cr-rule-workbench-wrap');
  if (!container) return;
  container.innerHTML = _renderFormulaWorkbench();
  _syncSaveState();
  if (focus) {
    const input = container.querySelector(`[data-field="${_activeFormulaPath}"][data-input="_charRuleFormula"]`);
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

function _syncSaveState() {
  const save = document.getElementById('cr-rules-save');
  if (!save) return;
  const valid = _allDraftValid();
  save.disabled = !valid;
  save.title = valid ? 'Enregistrer les règles' : 'Corrige les formules signalées avant d’enregistrer';
}

function _handleFormulaInput(input) {
  const path = input.dataset.field;
  _setDraft(path, input.value);
  const meta = _formulaMeta(path);
  const result = _formulaResult(meta, input.value);
  const card = input.closest('.cr-rule-studio');
  const expression = input.closest('.cr-rule-expression');
  const feedback = card?.querySelector('.cr-rule-validation');
  expression?.classList.toggle('is-valid', result.valid);
  expression?.classList.toggle('is-invalid', !result.valid);
  input.setAttribute('aria-invalid', result.valid ? 'false' : 'true');
  if (feedback) {
    feedback.className = `cr-rule-validation ${result.valid ? 'is-valid' : 'is-invalid'}`;
    feedback.innerHTML = _formulaFeedbackHtml(meta, result);
  }
  const nav = document.querySelector(`.cr-rule-formula-nav[data-field="${path}"]`);
  nav?.classList.toggle('is-invalid', !result.valid);
  const marker = nav?.querySelector('i');
  if (marker) marker.textContent = result.valid ? '✓' : '!';
  _syncSaveState();
}

function _handleRuleNumber(input) {
  _setDraft(
    input.dataset.field,
    input.dataset.nullable === '1' && input.value === '' ? null : _finiteOr(input.value, 0)
  );
  const error = document.getElementById('cr-rule-limits-error');
  const { min, max } = _draft.modifier;
  const invalid = min != null && max != null && min > max;
  if (error) {
    error.hidden = !invalid;
    error.textContent = invalid ? 'La limite négative doit être inférieure ou égale à la limite positive.' : '';
  }
  _syncSaveState();
}

function _activeFormulaInput(path) {
  return document.querySelector(`.cr-rule-studio input[data-field="${path}"]`);
}

function _commitFormulaInput(input, value, selectionStart = null, selectionEnd = null) {
  input.value = value;
  _handleFormulaInput(input);
  input.focus();
  const start = selectionStart ?? value.length;
  input.setSelectionRange(start, selectionEnd ?? start);
}

function _insertFormulaToken(button) {
  const path = button.dataset.field;
  const input = _activeFormulaInput(path);
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const raw = button.dataset.token || '';
  const token = ['+', '-', '*', '/', '^'].includes(raw) ? ` ${raw} ` : raw;
  _commitFormulaInput(input, input.value.slice(0, start) + token + input.value.slice(end), start + token.length);
}

function _insertFormulaFunction(button) {
  const path = button.dataset.field;
  const input = _activeFormulaInput(path);
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const selected = input.value.slice(start, end);
  const seed = selected || '0';
  const insertion = (button.dataset.template || '{x}').replace('{x}', seed);
  const value = input.value.slice(0, start) + insertion + input.value.slice(end);
  if (selected) {
    _commitFormulaInput(input, value, start + insertion.length);
    return;
  }
  const zeroOffset = insertion.indexOf('0');
  _commitFormulaInput(input, value, start + zeroOffset, start + zeroOffset + 1);
}

function _resetOneFormula(button) {
  const path = button.dataset.field;
  _setDraft(path, _formulaDefault(path));
  _activeFormulaPath = path;
  _refreshFormulaWorkbench({ focus: true });
}

function _clearFormula(button) {
  const input = _activeFormulaInput(button.dataset.field);
  if (input) _commitFormulaInput(input, '', 0);
}

function _numberInput(label, path, value, { nullable = false } = {}) {
  return `<label class="cr-rule-number">
    <span>${_esc(label)}</span>
    <input type="number" value="${value ?? ''}" placeholder="${nullable ? 'Aucune' : ''}"
      data-input="_charRuleNumber" data-field="${path}" data-nullable="${nullable ? '1' : '0'}">
  </label>`;
}

function _renderRulesModal() {
  const r = _draft;

  openModal('', `
    <div class="sh-admin-modal is-character-rules">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">∑</div>
        <div class="sh-admin-head-title">
          <h2>Règles des personnages</h2>
          <small>Calculs propres à cette aventure uniquement</small>
        </div>
        <button class="sh-admin-close" data-action="_charRulesClose" title="Fermer">×</button>
      </div>
      <div class="sh-admin-body">
        <div class="cr-rule-preset-note">
          <span>${_baseRules === LEGACY_CHARACTER_RULES ? 'Règles historiques' : 'Préréglage D&D'}</span>
          <p>Construis chaque calcul avec les boutons proposés. L'aperçu vérifie immédiatement la formule et empêche d'enregistrer une règle incorrecte.</p>
        </div>

        <section class="sh-admin-section">
          <div class="sh-admin-section-title">Limites des modificateurs</div>
          <div class="cr-rule-number-grid">
            ${_numberInput('Limite négative', 'modifier.min', r.modifier.min, { nullable: true })}
            ${_numberInput('Limite positive', 'modifier.max', r.modifier.max, { nullable: true })}
          </div>
          <p class="sh-admin-section-hint">Laisser vide pour ne poser aucune limite. Exemple : -4 / +4 borne les modificateurs entre -4 et +4.</p>
          <p class="cr-rule-limit-error" id="cr-rule-limits-error" ${r.modifier.min != null && r.modifier.max != null && r.modifier.min > r.modifier.max ? '' : 'hidden'}>La limite négative doit être inférieure ou égale à la limite positive.</p>
        </section>

        <section class="sh-admin-section">
          <div class="sh-admin-section-title">Base de classe d'armure</div>
          <div class="cr-rule-number-grid">
            ${_numberInput('Base', 'armorBases.none', r.armorBases.none)}
          </div>
          <p class="sh-admin-section-hint">Les types d'armure ne donnent plus de CA automatique. Renseigne le bonus directement sur l'équipement.</p>
        </section>

        <section class="sh-admin-section">
          <div class="sh-admin-section-title">Atelier de formules</div>
          <div class="cr-rule-workbench-wrap">${_renderFormulaWorkbench()}</div>
        </section>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_charRulesReset">Restaurer les défauts</button>
        <div class="sh-admin-footer-spacer"></div>
        <button class="btn btn-outline btn-sm" data-action="_charRulesClose">Annuler</button>
        <button class="btn btn-gold btn-sm" id="cr-rules-save" data-action="_charRulesSave" ${_allDraftValid() ? '' : 'disabled'}>Enregistrer</button>
      </div>
    </div>`);
}

export async function openCharacterRulesAdmin() {
  await _ensureAdminUi();
  await loadCharacterRules();
  _draft = _clone(getCharacterRules());
  _activeFormulaPath = 'modifier.formula';
  _renderRulesModal();
}

async function _ensureAdminUi() {
  if (_adminUiPromise) return _adminUiPromise;
  _adminUiPromise = Promise.all([
    import('../core/actions.js'),
    import('./html.js'),
    import('./modal.js'),
    import('./notifications.js'),
  ]).then(([actions, html, modal, notifications]) => {
    _esc = html._esc;
    openModal = modal.openModal;
    closeModalDirect = modal.closeModalDirect;
    confirmModal = modal.confirmModal;
    showNotif = notifications.showNotif;
    actions.registerActions({
      _charRulesClose: () => closeModalDirect(),
      _charRulesSave: () => _saveDraft(),
      _charRulesReset: () => _resetDraft(),
      _charRuleFormula: el => _handleFormulaInput(el),
      _charRuleNumber: el => _handleRuleNumber(el),
      _charRulesSelectFormula: button => {
        _activeFormulaPath = button.dataset.field;
        _refreshFormulaWorkbench();
      },
      _charRulesInsertToken: button => _insertFormulaToken(button),
      _charRulesInsertFunction: button => _insertFormulaFunction(button),
      _charRulesResetOne: button => _resetOneFormula(button),
      _charRulesClearFormula: button => _clearFormula(button),
    });
  });
  return _adminUiPromise;
}

async function _saveDraft() {
  try {
    await saveCharacterRules(_draft);
    showNotif('Règles des personnages enregistrées.', 'success');
    closeModalDirect();
  } catch (error) {
    showNotif(error?.message || "Erreur lors de l'enregistrement.", 'error');
  }
}

async function _resetDraft() {
  const ok = await confirmModal('Restaurer toutes les formules et limites par défaut pour cette aventure ?', {
    title: 'Restaurer les règles',
  });
  if (!ok) return;
  _draft = _clone(_baseRules);
  _renderRulesModal();
}
