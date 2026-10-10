import { getPrimaryWeaponSlotId, getSecondaryWeaponSlotId } from './equipment-slots.js';
import { weaponFamilyLabels, weaponHands } from './weapon-family.js';

const OPPORTUNITY_MODES = new Set(['inherit', 'allow', 'forbid']);
const CONTACT_MODES = new Set(['none', 'advantage', 'disadvantage']);
const CONTACT_SCOPES = new Set(['ranged', 'all']);

export function defaultCombatStyles() {
  return [
    { id:'baguette', label:'🪄 Baguette magique', condPrincipale:['Arme 1M CaC Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.',''], condSecondaire:['Baguette'], condSousTypeS:[], description:"Baguette en main secondaire : dégâts de l'arme passent de 1d6 à 1d10. Accès à la magie.", couleur:'#b47fff', rules:{ opportunityAttack:'inherit', contactAttackMode:'disadvantage', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'bouclier', label:'🛡️ Bouclier', condPrincipale:['Arme 1M CaC Phy.','Arme 2M CaC Phy.',''], condSecondaire:['Bouclier'], condSousTypeS:[], description:"+2 CA passive. Pas d'attaque d'opportunité avec la main secondaire.", couleur:'#22c38e', rules:{ opportunityAttack:'inherit', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'deux_mains', label:'⚔️⚔️ Deux armes', condPrincipale:['Arme 1M CaC Phy.'], condSecondaire:['Arme 1M CaC Phy.'], condSousTypeS:[], description:"Attaque bonus avec l'arme secondaire (dégâts seulement, pas de mod). Désavantage si armes lourdes.", couleur:'#ff6b6b', rules:{ opportunityAttack:'inherit', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'main_libre', label:'🤜 Main libre', condPrincipale:['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 1M CaC Phy.'], condSecondaire:['Main Libre',''], condSousTypeS:[], description:'Main secondaire libre (torche, objet…). Peut parer (+1 CA si en garde).', couleur:'#4f8cff', rules:{ opportunityAttack:'allow', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'arme_2m', label:'🗡️ Arme à 2 mains', condPrincipale:[], condMains:'2', condSecondaire:[''], condSousTypeS:[], description:'Arme à 2 mains : dégâts maximisés (relancer les 1 et 2).', couleur:'#e8b84b', rules:{ opportunityAttack:'forbid', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'mains_nues', label:'🤛 Mains nues', condPrincipale:[''], condSecondaire:[''], condSousTypeS:[], description:'Aucune arme équipée. Dégâts 1d4 + Force. Attaque bonus possible chaque tour.', couleur:'#9ca3af', rules:{ opportunityAttack:'allow', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
  ];
}

function _plain(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function _legacyOpportunityMode(style) {
  const text = _plain(style?.description);
  if (/attaque d.opportunite possible|peut.+attaque d.opportunite/.test(text)) return 'allow';
  if (/pas de reaction d.attaque|aucune attaque d.opportunite/.test(text)) return 'forbid';
  return 'inherit';
}

function _legacyContactMode(style) {
  const text = _plain(style?.description);
  return /desavantage.+(cac|contact)|(?:cac|contact).+desavantage/.test(text)
    ? 'disadvantage'
    : 'none';
}

/**
 * Normalise les règles structurées d'un style sans casser les anciens documents.
 * Les deux anciennes formulations explicites sont reconnues une seule fois comme
 * valeur de repli ; dès qu'un réglage est enregistré, il devient la source fiable.
 */
export function normalizeCombatStyle(style = {}) {
  const rawRules = style.rules && typeof style.rules === 'object' ? style.rules : {};
  const opportunityAttack = OPPORTUNITY_MODES.has(rawRules.opportunityAttack)
    ? rawRules.opportunityAttack
    : _legacyOpportunityMode(style);
  const contactAttackMode = CONTACT_MODES.has(rawRules.contactAttackMode)
    ? rawRules.contactAttackMode
    : _legacyContactMode(style);
  const contactAttackScope = CONTACT_SCOPES.has(rawRules.contactAttackScope)
    ? rawRules.contactAttackScope
    : 'ranged';
  const parsedDistance = parseInt(rawRules.contactDistance, 10);

  return {
    ...style,
    rules: {
      ...rawRules,
      opportunityAttack,
      opportunityTrigger: 'leave-reach',
      contactAttackMode,
      contactAttackScope,
      contactDistance: Number.isFinite(parsedDistance) ? Math.max(1, Math.min(12, parsedDistance)) : 1,
    },
  };
}

export function normalizeCombatStyles(styles = []) {
  return (Array.isArray(styles) ? styles : []).map(normalizeCombatStyle);
}

/** Distance du plus proche adversaire autour du lanceur, indépendamment de la
 * cible choisie. `distanceBetween` garde la géométrie propre au VTT hors de ce
 * module de règles. */
export function nearestHostileDistance(source, tokens = [], distanceBetween, isActive = () => true) {
  if (!source || typeof distanceBetween !== 'function') return null;
  const sourceIsEnemy = source.type === 'enemy';
  const distances = (Array.isArray(tokens) ? tokens : [])
    .filter(token => token
      && token.id !== source.id
      && token.pageId === source.pageId
      && (token.type === 'enemy') !== sourceIsEnemy
      && isActive(token))
    .map(token => Number(distanceBetween(source, token)))
    .filter(Number.isFinite);
  return distances.length ? Math.min(...distances) : null;
}

/**
 * Détecte le premier style correspondant à l'équipement actif.
 * Conditions par main : types d'arme (ou anciens libellés de format), « '' » =
 * main vide. `condMains` ('1' | '2') exige en plus ce maniement pour l'arme principale.
 */
export function detectCombatStyle(character, styles = [], formats = []) {
  const equip = character?.equipement || {};
  const main = equip[getPrimaryWeaponSlotId()];
  const secondary = equip[getSecondaryWeaponSlotId()];
  const mainLabels = weaponFamilyLabels(formats, main?.nom || main?.format ? main : null);
  const secondaryLabels = weaponFamilyLabels(formats, secondary?.nom || secondary?.format ? secondary : null);
  const secondarySubtype = String(secondary?.sousType || secondary?.nom || '').toLowerCase();
  // '*' = n'importe quelle arme, '' = main vide, sinon type (ou ancien libellé).
  const matchesHand = (conditions, labels) => conditions.length === 0
    || conditions.some(value => value === '*' ? labels.length > 0 : value ? labels.includes(value) : labels.length === 0);

  for (const rawStyle of styles) {
    const style = normalizeCombatStyle(rawStyle);
    const subtypeConditions = (style.condSousTypeS || []).map(value => String(value).toLowerCase());
    const requiredHands = parseInt(style.condMains, 10);
    const matchesHands = !(requiredHands === 1 || requiredHands === 2)
      || (mainLabels.length > 0 && weaponHands(main) === requiredHands);
    const matchesSubtype = subtypeConditions.length === 0
      || subtypeConditions.some(value => secondarySubtype.includes(value));
    if (matchesHand(style.condPrincipale || [], mainLabels)
      && matchesHand(style.condSecondaire || [], secondaryLabels)
      && matchesHands && matchesSubtype) return style;
  }
  return null;
}

// '*' = n'importe quelle arme, '' = main vide, sinon type (ou ancien libellé).
function _matchesHand(conditions, labels) {
  return conditions.length === 0
    || conditions.some(value => value === '*' ? labels.length > 0 : value ? labels.includes(value) : labels.length === 0);
}
const _realWeapon = w => (w?.nom || w?.format) ? w : null;

/**
 * Pourquoi un style ne s'applique PAS à une paire d'armes (ou null s'il s'applique).
 * Reflète EXACTEMENT detectCombatStyle, dans le même ordre de vérification.
 */
export function explainCombatStyle(style, mainWeapon, secondaryWeapon, formats = []) {
  const s = normalizeCombatStyle(style);
  const main = _realWeapon(mainWeapon), secondary = _realWeapon(secondaryWeapon);
  const mainLabels = weaponFamilyLabels(formats, main);
  const secondaryLabels = weaponFamilyLabels(formats, secondary);
  const secondarySubtype = String(secondary?.sousType || secondary?.nom || '').toLowerCase();
  const requiredHands = parseInt(s.condMains, 10);
  const subtypeConditions = (s.condSousTypeS || []).map(v => String(v).toLowerCase());
  if (!_matchesHand(s.condPrincipale || [], mainLabels)) return 'main principale';
  if ((requiredHands === 1 || requiredHands === 2) && !(mainLabels.length > 0 && weaponHands(main) === requiredHands)) return 'maniement';
  if (!_matchesHand(s.condSecondaire || [], secondaryLabels)) return 'main secondaire';
  if (subtypeConditions.length && !subtypeConditions.some(v => secondarySubtype.includes(v))) return 'sous-type secondaire';
  return null;
}

// Un style « attrape-tout » : aucune condition → correspond à toute combinaison.
function _isCatchAll(style) {
  const s = normalizeCombatStyle(style);
  return !(s.condPrincipale || []).length && !(s.condSecondaire || []).length
    && !(parseInt(s.condMains, 10) === 1 || parseInt(s.condMains, 10) === 2)
    && !(s.condSousTypeS || []).length;
}

/**
 * Matrice de couverture types × types (+ main vide). Pour chaque combinaison
 * possible, le style gagnant (premier qui correspond). Une arme à 2 mains occupe
 * les deux mains : toute combinaison avec une 2M et une autre arme est impossible.
 */
export function combatStyleCoverage(styles = [], formats = []) {
  const list = (Array.isArray(formats) ? formats : []).filter(f => f && f.label);
  const slots = [null, ...list]; // null = main vide
  const toWeapon = f => f ? { format: f.label, mains: f.defaults?.mains || '' } : null;
  const is2h = w => !!w && weaponHands(w) === 2;
  const wins = {}, matches = {}, capturedBy = {};
  (styles || []).forEach(s => { wins[s.id] = 0; matches[s.id] = 0; capturedBy[s.id] = {}; });
  let gaps = 0;
  const grid = slots.map(mf => {
    const mainW = toWeapon(mf);
    return slots.map(sf => {
      const secW = toWeapon(sf);
      if ((is2h(mainW) && secW) || (is2h(secW) && mainW)) return { impossible: true };
      const matching = (styles || []).filter(s => explainCombatStyle(s, mainW, secW, formats) === null);
      matching.forEach(s => { matches[s.id]++; });
      const winner = matching[0] || null;
      if (winner) {
        wins[winner.id]++;
        matching.slice(1).forEach(s => { capturedBy[s.id][winner.id] = (capturedBy[s.id][winner.id] || 0) + 1; });
      } else gaps++;
      return { winner: winner?.id || null, color: winner?.couleur || null, matching: matching.map(s => s.id) };
    });
  });
  return { grid, slots: slots.map(f => (f ? f.label : '')), wins, matches, capturedBy, gaps };
}

/** Tri suggéré : du plus spécifique (moins de correspondances) au plus général ;
 * les styles sans aucune condition (attrape-tout) en dernier. Stable. */
export function autoOrderCombatStyles(styles = [], formats = []) {
  const { matches } = combatStyleCoverage(styles, formats);
  const idx = new Map((styles || []).map((s, i) => [s, i]));
  const score = s => (_isCatchAll(s) ? Infinity : (matches[s.id] ?? Infinity));
  return [...(styles || [])].sort((a, b) => (score(a) - score(b)) || (idx.get(a) - idx.get(b)));
}

// Libellé stocké = « emoji nom » : séparer / recomposer le 1er graphème emoji.
const _GRAPH_SEG = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('fr', { granularity: 'grapheme' }) : null;
export function splitStyleLabel(label) {
  const raw = String(label || '').trim();
  const first = _GRAPH_SEG ? [..._GRAPH_SEG.segment(raw)][0]?.segment || '' : (Array.from(raw)[0] || '');
  if (first && /\p{Extended_Pictographic}/u.test(first)) return { icon: first, name: raw.slice(first.length).trim() };
  return { icon: '', name: raw };
}
export const joinStyleLabel = (icon, name) => [icon, name].filter(Boolean).join(' ').trim();

/** Anciens libellés de format → types d'arme canoniques (pour « Convertir »). */
export const LEGACY_FORMAT_MAP = {
  'Arme 1M CaC Phy.': ['Épée', 'Dague', 'Hache', 'Marteau'],
  'Arme 2M CaC Phy.': ['Lance'],
  'Arme 2M Dist Phy.': ['Arc', 'Arbalète'],
  'Arme 2M CaC Mag.': ['Bâton de mage'],
};

/** Modificateur automatique d'un style pour un jet d'attaque donné. */
export function combatStyleAttackModifiers(style, { distance, isMeleeAttack = false, isHealingAction = false } = {}) {
  const rules = normalizeCombatStyle(style).rules;
  // `nearestHostileDistance` renvoie null quand aucun adversaire actif n'est
  // présent autour du lanceur. Number(null) vaut 0 : sans cette garde, l'absence
  // d'ennemi était interprétée comme un ennemi sur la même case et imposait le
  // désavantage en permanence.
  const hasDistance = distance !== null && distance !== undefined && distance !== '';
  const numericDistance = hasDistance ? Number(distance) : Number.NaN;
  const inContact = Number.isFinite(numericDistance)
    && numericDistance >= 0
    && numericDistance <= rules.contactDistance;
  const appliesToAttack = rules.contactAttackScope === 'all' || !isMeleeAttack;
  if (!inContact || !appliesToAttack || rules.contactAttackMode === 'none') {
    return { hasAdv: false, hasDis: false, reasons: [] };
  }
  const scope = isHealingAction
    ? 'soin avec ennemi au contact'
    : rules.contactAttackScope === 'all' ? 'attaque' : 'attaque à distance';
  const reason = `${rules.contactAttackMode === 'advantage' ? '+adv' : '+dis'} (${scope} au contact · ${style?.label || 'style'})`;
  return {
    hasAdv: rules.contactAttackMode === 'advantage',
    hasDis: rules.contactAttackMode === 'disadvantage',
    reasons: [reason],
  };
}

export function combatStyleRuleLabels(style) {
  const rules = normalizeCombatStyle(style).rules;
  const labels = [];
  if (rules.opportunityAttack === 'allow') labels.push({ tone: 'reaction', icon: '↪', label: 'Opportunité', detail: 'quand une cible quitte la portée' });
  if (rules.opportunityAttack === 'forbid') labels.push({ tone: 'muted', icon: '⊘', label: 'Pas d’opportunité', detail: 'réaction indisponible' });
  if (rules.contactAttackMode !== 'none') {
    labels.push({
      tone: rules.contactAttackMode === 'advantage' ? 'positive' : 'warning',
      icon: rules.contactAttackMode === 'advantage' ? '↗' : '↘',
      label: rules.contactAttackMode === 'advantage' ? 'Avantage au contact' : 'Désavantage au contact',
      detail: `${rules.contactAttackScope === 'all' ? 'toutes les actions ciblées' : 'attaques et soins à distance'} · ennemi à ${rules.contactDistance}c`,
    });
  }
  return labels;
}
