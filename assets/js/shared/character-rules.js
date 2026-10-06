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
    crit: 'baseRoll + critRoll + fixedBonus',
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
    crit: 'baseRoll + critRoll + fixedBonus',
  },
};

// Métadonnées d'affichage des formules : groupe (rail en 4 sections), libellé,
// description, variables, unité du résultat, `char` (expose les 12 caractéristiques)
// et `x` (axe de la courbe d'essai). Plus d'emoji.
const FORMULA_META = [
  { key: 'ca', g: 'Défense', label: "Classe d'armure", desc: 'Difficulté à toucher le personnage.', vars: ['armorBase', 'dexMod', 'equipCA', 'equipBonus', 'shieldBonus'], char: true },
  { key: 'initiative', g: 'Défense', label: 'Initiative', desc: 'Bonus ajouté au jet d’ordre de tour.', vars: ['dexMod', 'equipBonus', 'level'], char: true },
  { key: 'speed', g: 'Défense', label: 'Vitesse', desc: 'Cases de déplacement par tour.', vars: ['forceMod', 'equipBonus', 'level'], char: true, unit: ' cases' },
  { key: 'pv', g: 'Ressources', label: 'PV maximum', desc: 'Points de vie au maximum.', vars: ['pvBase', 'conMod', 'level', 'equipBonus'], char: true, unit: ' PV' },
  { key: 'pm', g: 'Ressources', label: 'PM maximum', desc: 'Points de magie au maximum.', vars: ['pmBase', 'sagMod', 'level', 'equipBonus'], char: true, unit: ' PM' },
  { key: 'deck', g: 'Ressources', label: 'Taille du deck', desc: 'Nombre de sorts préparables en même temps.', vars: ['intMod', 'sagMod', 'chaMod', 'level'], char: true, unit: ' sorts' },
  { key: 'xp', g: 'Progression', label: "Palier d'XP", desc: 'Expérience requise pour le niveau suivant.', vars: ['level'], unit: ' XP' },
  { key: 'crit', g: 'Progression', label: 'Critique dégâts / soins', desc: 'Total des dégâts ou des soins sur un coup critique.', vars: ['baseRoll', 'critRoll', 'fixedBonus', 'normalTotal', 'diceMax'] },
];

const MODIFIER_META = { key: 'modifier', g: 'Base', label: 'Modificateur', desc: 'Transforme un score de caractéristique en bonus. Toutes les autres formules utilisent ce résultat.', vars: ['score'], x: 'score' };
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
  baseRoll: 'Jet normal des dés',
  diceMax: 'Maximum des dés',
  critRoll: 'Relance des dés critiques',
  fixedBonus: 'Bonus fixe',
  normalTotal: 'Total normal',
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
  crit: { baseRoll: 4, diceMax: 8, critRoll: 5, fixedBonus: 3, normalTotal: 7 },
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
let setModalCloseGuard = null;
let clearModalCloseGuard = null;
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
      if (!match) throw new Error(`Nombre invalide près de « ${source.slice(i, i + 8)} »`);
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
    throw new Error(`Caractère interdit : « ${ch} »`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function _parseFormula(source, variables = {}) {
  const tokens = _tokenize(String(source || '').trim());
  let pos = 0;
  const peek = () => tokens[pos];
  const take = type => {
    if (peek().type !== type) throw new Error(type === ')' ? 'Parenthèse fermante manquante' : `« ${type} » attendu`);
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
        if (!fn) throw new Error(`Fonction inconnue : ${name}`);
        take('(');
        const args = [];
        if (peek().type !== ')') {
          args.push(expression());
          while (peek().type === ',') { take(','); args.push(expression()); }
        }
        take(')');
        return fn(...args);
      }
      if (!Object.prototype.hasOwnProperty.call(variables, name)) throw new Error(`Variable inconnue : ${name}`);
      return _finiteOr(variables[name], 0);
    }
    throw new Error(peek().type === 'eof' ? 'La formule s’arrête trop tôt' : 'Nombre, variable ou parenthèse attendu');
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

export function calcCriticalEffectTotal({ baseRoll = 0, diceMax = 0, critRoll = 0, fixedBonus = 0 } = {}) {
  const rules = getCharacterRules();
  const normalTotal = Number(baseRoll || 0) + Number(fixedBonus || 0);
  const fallback = Number(baseRoll || 0) + Number(critRoll || 0) + Number(fixedBonus || 0);
  return Math.max(0, Math.round(evaluateCharacterFormula(
    rules.formulas?.crit || DEFAULT_CHARACTER_RULES.formulas.crit,
    {
      baseRoll: Number(baseRoll || 0),
      diceMax: Number(diceMax || 0),
      critRoll: Number(critRoll || 0),
      fixedBonus: Number(fixedBonus || 0),
      normalTotal,
    },
    fallback
  )));
}

export function criticalEffectFormulaLabel() {
  return getCharacterRules().formulas?.crit || DEFAULT_CHARACTER_RULES.formulas.crit;
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

// ══════════════════════════════════════════════════════════════════════════════
// MODALE « RÈGLES DE PERSONNAGE » v2 — rendu + actions (moteur inchangé)
// Rail de formules (4 groupes) · éditeur coloré (textarea sur <pre>) · banc
// d'essai (courbe 1→20) · pied avec confirmations dans la barre.
// ══════════════════════════════════════════════════════════════════════════════
const _CR_FNS = [['floor', 'Arrondi bas', 'floor({x})'], ['ceil', 'Arrondi haut', 'ceil({x})'], ['round', 'Arrondi', 'round({x})'], ['min', 'Minimum', 'min({x}, 0)'], ['max', 'Maximum', 'max({x}, 0)'], ['abs', 'Valeur absolue', 'abs({x})'], ['pow', 'Puissance', 'pow({x}, 2)']];
const _CR_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="cr-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></symbol>
<symbol id="cr-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></symbol>
<symbol id="cr-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></symbol>
<symbol id="cr-undo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></symbol>
<symbol id="cr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></symbol>
</defs></svg>`;
const _crIcon = id => `<svg class="cr-ic"><use href="#cr-${id}"></use></svg>`;

// Valeurs d'essai modifiées en mémoire uniquement (jamais enregistrées), une
// entrée par formule. État de confirmation affiché dans le pied.
let _crTest = {};
let _crConfirm = null;
let _crMounted = false;

const _crFormulaOf = meta => _getDraft(_formulaPath(meta));
const _crSavedRules = () => getCharacterRules();
const _crSavedFormula = meta => (meta.key === 'modifier' ? _crSavedRules().modifier.formula : _crSavedRules().formulas[meta.key]);
const _crSample = meta => _formulaSample(meta);
// Contexte d'essai : échantillon + base de CA tirée de armorBases.none + surcharges mémoire.
const _crTestCtx = meta => ({ ..._crSample(meta), ...(meta.key === 'ca' ? { armorBase: _draft.armorBases.none } : {}), ...(_crTest[meta.key] || {}) });
const _crLimitsBad = () => { const { min, max } = _draft.modifier; return min != null && max != null && min > max; };
function _crClampMod(v) { const { min, max } = _draft.modifier; let c = v; if (min != null) c = Math.max(min, c); if (max != null) c = Math.min(max, c); return c; }
function _crRun(meta, ctx = _crTestCtx(meta)) {
  try { let v = _parseFormula(_crFormulaOf(meta), ctx); const raw = v; if (meta.key === 'modifier') v = _crClampMod(v); return { ok: true, v, raw }; }
  catch (error) { return { ok: false, err: error.message }; }
}
const _crFmt = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
const _crSign = (meta, v) => (meta.key === 'modifier' && v > 0 ? '+' + _crFmt(v) : _crFmt(v));
function _crDirty(meta) {
  if (_crFormulaOf(meta) !== _crSavedFormula(meta)) return true;
  if (meta.key === 'modifier') { const s = _crSavedRules(); return _draft.modifier.min !== s.modifier.min || _draft.modifier.max !== s.modifier.max; }
  if (meta.key === 'ca') return _draft.armorBases.none !== _crSavedRules().armorBases.none;
  return false;
}
const _crChanges = () => ALL_FORMULA_META.filter(_crDirty).length;
const _crInvalid = () => ALL_FORMULA_META.filter(m => !_crRun(m).ok).length + (_crLimitsBad() ? 1 : 0);
const _crAllDefault = () => ALL_FORMULA_META.every(m => _crFormulaOf(m) === _formulaDefault(_formulaPath(m)))
  && _draft.modifier.min === _baseRules.modifier.min && _draft.modifier.max === _baseRules.modifier.max
  && _draft.armorBases.none === _baseRules.armorBases.none;
function _crUsedNames(src) {
  try { const t = _tokenize(src); return new Set(t.filter((x, i) => x.type === 'name' && t[i + 1]?.type !== '(').map(x => x.value)); }
  catch { return new Set(); }
}
// Coloration : variable connue → bleu, nombre → ambre, fonction → violet,
// opérateurs atténués ; variable/fonction inconnue → rouge souligné.
function _crHighlight(src, meta) {
  const ok = _crSample(meta);
  let out = ''; const re = /(\s+)|(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_]\w*)|([+\-*/%^,])|([()])|([\s\S])/g; let mt;
  while ((mt = re.exec(src))) {
    const [, ws, n, name, op, par, bad] = mt;
    if (ws) out += _esc(ws);
    else if (n) out += `<span class="cr-tn">${_esc(n)}</span>`;
    else if (name) { const isFn = /^\s*\(/.test(src.slice(re.lastIndex)); const cls = isFn ? (MATH_FUNCTIONS[name] ? 'cr-tf' : 'cr-tx') : (Object.prototype.hasOwnProperty.call(ok, name) ? 'cr-tv' : 'cr-tx'); out += `<span class="${cls}">${_esc(name)}</span>`; }
    else if (op) out += `<span class="cr-to">${_esc(op)}</span>`;
    else if (par) out += `<span class="cr-tp">${par}</span>`;
    else out += `<span class="cr-tx">${_esc(bad)}</span>`;
  }
  return out + '​\n';
}

/* ── Rendu ── */
function _crRailHtml() {
  const groups = [...new Set(ALL_FORMULA_META.map(m => m.g))];
  const active = _activeFormulaPath;
  return groups.map(g => `<div class="cr-rg"><span class="cr-lbl">${_esc(g)}</span>${ALL_FORMULA_META.filter(m => m.g === g).map(m => {
    const path = _formulaPath(m), r = _crRun(m), bad = !r.ok || (m.key === 'modifier' && _crLimitsBad());
    return `<button type="button" class="cr-ri${path === active ? ' on' : ''}${bad ? ' bad' : ''}" data-cr-key="${path}" aria-current="${path === active}"><span>${_esc(m.label)}${_crDirty(m) ? '<i class="cr-dirty" title="Modifiée, non enregistrée"></i>' : ''}</span><b>${bad ? '!' : _esc(_crSign(m, r.v))}</b></button>`;
  }).join('')}</div>`).join('') + `<div class="cr-keys"><span><kbd>Alt</kbd><kbd>↑</kbd><kbd>↓</kbd> formule</span><span><kbd>Ctrl</kbd><kbd>S</kbd> enregistrer</span></div>`;
}
function _crStatusHtml(meta, r) {
  if (!r.ok) return `${_crIcon('alert')}<b>${_esc(r.err)}</b>`;
  const capped = meta.key === 'modifier' && r.v !== r.raw;
  return `${_crIcon('check')}<b>Valide</b><span>· ${capped ? `${_esc(_crSign(meta, r.raw))} ramené à ${_esc(_crSign(meta, r.v))} par la limite` : 'enregistrement possible'}</span>`;
}
function _crTestInnerHtml(meta) {
  const r = _crRun(meta), ctx = _crTestCtx(meta);
  const used = [..._crUsedNames(_crFormulaOf(meta))].filter(v => Object.prototype.hasOwnProperty.call(_crSample(meta), v) && !(meta.key === 'ca' && v === 'armorBase'));
  let curve = '';
  const xv = meta.x || (used.includes('level') ? 'level' : null);
  if (xv && r.ok) {
    const pts = Array.from({ length: 20 }, (_, i) => { const c = { ...ctx, [xv]: i + 1 }; const o = _crRun(meta, c); return o.ok ? o : { v: 0, raw: 0 }; });
    const lo = Math.min(0, ...pts.map(p => p.v)), hi = Math.max(0, ...pts.map(p => p.v)), span = hi - lo || 1;
    const z = (hi / span) * 100, cur = ctx[xv];
    curve = `<div class="cr-curve"><div class="cr-cvh"><span class="cr-lbl">${xv === 'level' ? 'Par niveau' : 'Par score'}</span><b>${_esc(_crSign(meta, pts[0].v))} → ${_esc(_crSign(meta, pts[19].v))}</b></div>
      <div class="cr-bars">${pts.map((p, i) => { const h = Math.abs(p.v) / span * 100, top = p.v >= 0 ? z - h : z; return `<button type="button" class="cr-bar${p.v < 0 ? ' neg' : ''}${i + 1 === cur ? ' on' : ''}${p.v !== p.raw ? ' cap' : ''}" data-cr-x="${xv}" data-cr-xv="${i + 1}" title="${xv === 'level' ? 'Niveau' : 'Score'} ${i + 1} : ${_esc(_crSign(meta, p.v))}${p.v !== p.raw ? ' (limité)' : ''}"><i style="top:${top}%;height:${Math.max(h, p.v === 0 ? 0 : 1.5)}%"></i></button>`; }).join('')}<span class="cr-zero" style="top:${z}%"></span></div>
      <div class="cr-axis"><span>1</span><span>${xv === 'level' ? 'Niveau' : 'Score'} ${cur}</span><span>20</span></div></div>`;
  }
  const custom = !!_crTest[meta.key] && Object.keys(_crTest[meta.key]).length;
  return `<div class="cr-res${r.ok ? '' : ' ko'}"><span class="cr-lbl">Résultat d’essai</span><strong>${r.ok ? _esc(_crSign(meta, r.v)) : '—'}</strong><small>${r.ok ? (meta.unit ? _esc(meta.unit.trim()) + ' · ' : '') + 'avec les valeurs ci-dessous' : 'corrige la formule pour voir le résultat'}</small></div>
    ${curve}
    <div class="cr-fx"><span class="cr-lbl">Valeurs d’essai</span><div class="cr-vals">${used.length ? used.map(v => `<label for="cr-tv-${v}">${_esc(VARIABLE_LABELS[v] || v)}<code>${v}</code></label><input id="cr-tv-${v}" type="number" data-cr-tv="${v}" value="${ctx[v]}">`).join('') : '<span class="cr-none">Aucune variable dans la formule.</span>'}</div>
    ${custom ? '<button type="button" class="cr-resett" data-cr-treset>Revenir aux valeurs types</button>' : ''}</div>`;
}
function _crMainHtml() {
  const meta = _formulaMeta(), src = _crFormulaOf(meta), r = _crRun(meta), used = _crUsedNames(src);
  const chip = v => `<button type="button" class="cr-chip v${used.has(v) ? ' used' : ''}" data-cr-ins="${v}" title="Insérer ${_esc(v)}">${_esc(VARIABLE_LABELS[v] || v)}<code>${v}</code></button>`;
  const others = meta.char ? CHARACTER_VARIABLES.filter(v => !meta.vars.includes(v)) : [];
  const ctxHtml = meta.key === 'modifier'
    ? `<div class="cr-ctx"><label class="cr-num${_crLimitsBad() ? ' bad' : ''}"><span>Plancher</span><input type="number" data-cr-lim="min" value="${_draft.modifier.min ?? ''}" placeholder="Aucun"></label><label class="cr-num${_crLimitsBad() ? ' bad' : ''}"><span>Plafond</span><input type="number" data-cr-lim="max" value="${_draft.modifier.max ?? ''}" placeholder="Aucun"></label><p class="${_crLimitsBad() ? 'err' : ''}">${_crLimitsBad() ? 'Le plancher doit être inférieur ou égal au plafond.' : 'Le résultat est borné entre ces deux valeurs. Laisse vide pour ne pas limiter.'}</p></div>`
    : meta.key === 'ca' ? `<div class="cr-ctx"><label class="cr-num"><span>Base de CA</span><input type="number" data-cr-base value="${_draft.armorBases.none}"></label><p>Valeur de <code>armorBase</code>. Les types d’armure ne donnent plus de CA automatique : le bonus se règle sur chaque pièce d’équipement.</p></div>` : '';
  const isDef = src === _formulaDefault(_formulaPath(meta));
  return `<div class="cr-ed">
    <div class="cr-eh"><div><h2>${_esc(meta.label)}</h2><p>${_esc(meta.desc || '')}</p></div></div>
    <div class="cr-fx"><span class="cr-lbl">Formule</span>
      <div class="cr-code${r.ok ? '' : ' bad'}" id="cr-code"><pre aria-hidden="true" id="cr-hl">${_crHighlight(src, meta)}</pre><textarea id="cr-src" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Formule ${_esc(meta.label)}" aria-invalid="${!r.ok}">${_esc(src)}</textarea></div>
      <div class="cr-status ${r.ok ? 'ok' : 'ko'}" id="cr-status">${_crStatusHtml(meta, r)}</div>
      <div class="cr-def" id="cr-def"${isDef ? ' hidden' : ''}>Par défaut <code>${_esc(_formulaDefault(_formulaPath(meta)))}</code><button type="button" data-cr-restore>Restaurer</button></div>
    </div>
    <div class="cr-pal">
      <div class="cr-pr"><span class="cr-lbl">Variables</span><div class="cr-chips">${meta.vars.map(chip).join('')}${others.length ? (_crMore ? others.map(chip).join('') : `<button type="button" class="cr-more" data-cr-more>+ ${others.length} caractéristiques ${_crIcon('chev')}</button>`) : ''}</div></div>
      <div class="cr-pr"><span class="cr-lbl">Opérations</span><div class="cr-chips">${['+', '-', '*', '/', '%', '^', '(', ')'].map(o => `<button type="button" class="cr-chip op" data-cr-ins="${o}" aria-label="Insérer ${o}">${o === '*' ? '×' : o === '/' ? '÷' : _esc(o)}</button>`).join('')}</div></div>
      <div class="cr-pr"><span class="cr-lbl">Fonctions</span><div class="cr-chips">${_CR_FNS.map(([f, l, tpl]) => `<button type="button" class="cr-chip fn" data-cr-fn="${_esc(tpl)}" title="Entoure la sélection">${_esc(l)}<code>${f}</code></button>`).join('')}</div></div>
    </div>
    ${ctxHtml}
  </div>
  <aside class="cr-test" id="cr-test" aria-label="Banc d'essai">${_crTestInnerHtml(meta)}</aside>`;
}
let _crMore = false;
function _crFootHtml() {
  const n = _crChanges(), bad = _crInvalid();
  if (_crConfirm) {
    return `<span class="cr-ask">${_crConfirm === 'reset' ? 'Remettre toutes les formules et limites par défaut ?' : `Fermer sans enregistrer ${n > 1 ? `les ${n} modifications` : 'la modification'} ?`}</span><span class="cr-sp"></span><button type="button" class="cr-btn gh" data-cr-cancel>Non, revenir</button><button type="button" class="cr-btn dg" data-cr-yes>${_crConfirm === 'reset' ? 'Tout restaurer' : 'Fermer sans enregistrer'}</button>`;
  }
  return `<button type="button" class="cr-btn tx" data-cr-resetall ${_crAllDefault() ? 'disabled' : ''}>${_crIcon('undo')}Tout restaurer</button><span class="cr-sp"></span>
    ${bad ? `<span class="cr-info ko">${_crIcon('alert')}${bad} formule${bad > 1 ? 's' : ''} à corriger</span>` : n ? `<span class="cr-info"><i class="cr-dot"></i>${n} modification${n > 1 ? 's' : ''} non enregistrée${n > 1 ? 's' : ''}</span>` : '<span class="cr-info">Tout est enregistré</span>'}
    <button type="button" class="cr-btn gh" data-cr-close>Annuler</button><button type="button" class="cr-btn pri" data-cr-save ${bad || !n ? 'disabled' : ''} title="${bad ? 'Corrige les formules signalées' : 'Ctrl + S'}">Enregistrer</button>`;
}
function _crRenderRail() { const el = document.getElementById('cr-rail'); if (el) el.innerHTML = _crRailHtml(); }
function _crRenderMain() { const el = document.getElementById('cr-main'); if (el) el.innerHTML = _crMainHtml(); }
function _crRenderFoot() { const el = document.getElementById('cr-foot'); if (el) el.innerHTML = _crFootHtml(); }
function _crFit() { const ta = document.getElementById('cr-src'), hl = document.getElementById('cr-hl'); if (ta && hl) ta.style.height = hl.offsetHeight + 'px'; }
function _crRenderAll() { _crRenderRail(); _crRenderMain(); _crRenderFoot(); _crFit(); }
function _crRefreshLive() {
  const meta = _formulaMeta(), r = _crRun(meta);
  document.getElementById('cr-code')?.classList.toggle('bad', !r.ok);
  document.getElementById('cr-src')?.setAttribute('aria-invalid', String(!r.ok));
  const hl = document.getElementById('cr-hl'); if (hl) hl.innerHTML = _crHighlight(_crFormulaOf(meta), meta);
  const st = document.getElementById('cr-status'); if (st) { st.className = 'cr-status ' + (r.ok ? 'ok' : 'ko'); st.innerHTML = _crStatusHtml(meta, r); }
  const test = document.getElementById('cr-test'); if (test) test.innerHTML = _crTestInnerHtml(meta);
  const def = document.getElementById('cr-def'); if (def) def.hidden = _crFormulaOf(meta) === _formulaDefault(_formulaPath(meta));
  document.querySelectorAll('.cr-chip.v').forEach(c => c.classList.toggle('used', _crUsedNames(_crFormulaOf(meta)).has(c.dataset.crIns)));
  _crRenderRail(); _crRenderFoot(); _crFit();
}

/* ── Actions ── */
function _crSelect(path) { _activeFormulaPath = path; _crMore = false; try { localStorage.setItem('cr-active-formula', path); } catch {} _crRenderAll(); }
function _crInsertAt(text, wrapTpl) {
  const ta = document.getElementById('cr-src'); if (!ta) return;
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s, sel = ta.value.slice(s, e);
  let ins, cs, ce;
  if (wrapTpl) { ins = wrapTpl.replace('{x}', sel || '0'); if (sel) { cs = ce = s + ins.length; } else { cs = s + ins.indexOf('0'); ce = cs + 1; } }
  else { ins = ['+', '-', '*', '/', '^', '%'].includes(text) ? ` ${text} ` : text; const before = ta.value[s - 1]; if (/[\w)]/.test(before || '') && /^\w/.test(ins)) ins = ' ' + ins; cs = ce = s + ins.length; }
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  _setDraft(_activeFormulaPath, ta.value); _crRefreshLive(); ta.focus(); ta.setSelectionRange(cs, ce);
}
async function _crSave() {
  if (_crInvalid() || !_crChanges()) return;
  try {
    clearModalCloseGuard();
    await saveCharacterRules(_draft);
    showNotif('Règles des personnages enregistrées.', 'success');
    closeModalDirect();
  } catch (error) { showNotif(error?.message || "Erreur lors de l'enregistrement.", 'error'); setModalCloseGuard(_crCloseGuard); }
}
function _crCloseGuard() {
  if (_crConfirm) return true;
  if (_crChanges()) { _crConfirm = 'close'; _crRenderFoot(); return true; }
  return false;
}
function _crClose() { if (_crChanges()) { _crConfirm = 'close'; _crRenderFoot(); return; } clearModalCloseGuard(); closeModalDirect(); }
function _crMount() {
  if (_crMounted) return; _crMounted = true;
  document.addEventListener('click', e => {
    if (!document.querySelector('.cr')) return;
    const b = e.target.closest('[data-cr-key],[data-cr-ins],[data-cr-fn],[data-cr-more],[data-cr-restore],[data-cr-xv],[data-cr-treset],[data-cr-resetall],[data-cr-cancel],[data-cr-yes],[data-cr-save],[data-cr-close]');
    if (!b) return; const d = b.dataset;
    if (d.crKey) return _crSelect(d.crKey);
    if (d.crIns) return _crInsertAt(d.crIns);
    if (d.crFn) return _crInsertAt('', d.crFn);
    if ('crMore' in d) { _crMore = true; _crRenderMain(); return _crFit(); }
    if ('crRestore' in d) { _setDraft(_activeFormulaPath, _formulaDefault(_activeFormulaPath)); return _crRenderAll(); }
    if (d.crXv) { const m = _formulaMeta(); _crTest[m.key] = { ...(_crTest[m.key] || {}), [d.crX]: +d.crXv }; return _crRefreshLive(); }
    if ('crTreset' in d) { delete _crTest[_formulaMeta().key]; return _crRefreshLive(); }
    if ('crResetall' in d) { _crConfirm = 'reset'; return _crRenderFoot(); }
    if ('crCancel' in d) { _crConfirm = null; return _crRenderFoot(); }
    if ('crYes' in d) {
      if (_crConfirm === 'reset') { _draft = _clone(_baseRules); _crConfirm = null; _crRenderAll(); showNotif('Défauts restaurés — pense à enregistrer.', 'info'); }
      else { _draft = _clone(_crSavedRules()); _crConfirm = null; clearModalCloseGuard(); closeModalDirect(); }
      return;
    }
    if ('crSave' in d) return _crSave();
    if ('crClose' in d) return _crClose();
  });
  document.addEventListener('input', e => {
    if (!document.querySelector('.cr')) return;
    const t = e.target, d = t.dataset;
    if (t.id === 'cr-src') { _setDraft(_activeFormulaPath, t.value); _crRefreshLive(); }
    else if (d.crLim) {
      _draft.modifier[d.crLim] = t.value === '' ? null : Number(t.value);
      _crRefreshLive();
      document.querySelectorAll('.cr-num').forEach(n => n.classList.toggle('bad', _crLimitsBad()));
      const p = document.querySelector('.cr-ctx p'); if (p) { p.className = _crLimitsBad() ? 'err' : ''; p.textContent = _crLimitsBad() ? 'Le plancher doit être inférieur ou égal au plafond.' : 'Le résultat est borné entre ces deux valeurs. Laisse vide pour ne pas limiter.'; }
    }
    else if ('crBase' in d) { _draft.armorBases.none = Number(t.value) || 0; _crRefreshLive(); }
    else if (d.crTv) { const m = _formulaMeta(); _crTest[m.key] = { ...(_crTest[m.key] || {}), [d.crTv]: Number(t.value) || 0 }; const id = t.id; _crRefreshLive(); const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch {} } }
  });
  document.addEventListener('keydown', e => {
    if (!document.querySelector('.cr')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return _crSave(); }
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const paths = ALL_FORMULA_META.map(m => _formulaPath(m)); const i = paths.indexOf(_activeFormulaPath); return _crSelect(paths[(i + (e.key === 'ArrowDown' ? 1 : -1) + paths.length) % paths.length]); }
    if (e.target.id === 'cr-src' && e.key === 'Enter') { e.preventDefault(); return; }
    if (e.key === 'Escape' && _crConfirm) { e.preventDefault(); e.stopPropagation(); _crConfirm = null; _crRenderFoot(); }
  }, true);
}

function _renderRulesModal() {
  const preset = _baseRules === LEGACY_CHARACTER_RULES ? 'Règles historiques' : 'Préréglage D&D';
  openModal('', `<div class="cr">${_CR_SPRITE}
    <header class="cr-head"><div><h1>Règles de personnage</h1><small>Calculs propres à cette aventure</small></div><span class="cr-preset">${_esc(preset)}</span><span class="cr-sp"></span><button type="button" class="cr-x" data-cr-close aria-label="Fermer">${_crIcon('x')}</button></header>
    <div class="cr-body"><nav class="cr-rail" id="cr-rail" aria-label="Formules"></nav><div class="cr-main" id="cr-main"></div></div>
    <footer class="cr-foot" id="cr-foot"></footer>
  </div>`);
  _crConfirm = null;
  setModalCloseGuard(_crCloseGuard);
  _crMount();
  _crRenderAll();
  requestAnimationFrame(() => { _crRenderAll(); document.getElementById('cr-src')?.focus(); });
}

export async function openCharacterRulesAdmin() {
  await _ensureAdminUi();
  await loadCharacterRules();
  _draft = _clone(getCharacterRules());
  _crTest = {};
  let stored = ''; try { stored = localStorage.getItem('cr-active-formula') || ''; } catch {}
  _activeFormulaPath = ALL_FORMULA_META.some(m => _formulaPath(m) === stored) ? stored : 'modifier.formula';
  _renderRulesModal();
}

async function _ensureAdminUi() {
  if (_adminUiPromise) return _adminUiPromise;
  _adminUiPromise = Promise.all([
    import('./html.js'),
    import('./modal.js'),
    import('./notifications.js'),
  ]).then(([html, modal, notifications]) => {
    _esc = html._esc;
    openModal = modal.openModal;
    closeModalDirect = modal.closeModalDirect;
    confirmModal = modal.confirmModal;
    setModalCloseGuard = modal.setModalCloseGuard;
    clearModalCloseGuard = modal.clearModalCloseGuard;
    showNotif = notifications.showNotif;
  });
  return _adminUiPromise;
}
