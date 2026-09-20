import { getPrimaryWeaponSlotId, getSecondaryWeaponSlotId } from './equipment-slots.js';

const OPPORTUNITY_MODES = new Set(['inherit', 'allow', 'forbid']);
const CONTACT_MODES = new Set(['none', 'advantage', 'disadvantage']);
const CONTACT_SCOPES = new Set(['ranged', 'all']);

export function defaultCombatStyles() {
  return [
    { id:'baguette', label:'🪄 Baguette magique', condPrincipale:['Arme 1M CaC Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.',''], condSecondaire:['Baguette'], condSousTypeS:[], description:"Baguette en main secondaire : dégâts de l'arme passent de 1d6 à 1d10. Accès à la magie.", couleur:'#b47fff', rules:{ opportunityAttack:'inherit', contactAttackMode:'disadvantage', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'bouclier', label:'🛡️ Bouclier', condPrincipale:['Arme 1M CaC Phy.','Arme 2M CaC Phy.',''], condSecondaire:['Bouclier'], condSousTypeS:[], description:"+2 CA passive. Pas d'attaque d'opportunité avec la main secondaire.", couleur:'#22c38e', rules:{ opportunityAttack:'inherit', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'deux_mains', label:'⚔️⚔️ Deux armes', condPrincipale:['Arme 1M CaC Phy.'], condSecondaire:['Arme 1M CaC Phy.'], condSousTypeS:[], description:"Attaque bonus avec l'arme secondaire (dégâts seulement, pas de mod). Désavantage si armes lourdes.", couleur:'#ff6b6b', rules:{ opportunityAttack:'inherit', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'main_libre', label:'🤜 Main libre', condPrincipale:['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 1M CaC Phy.'], condSecondaire:['Main Libre',''], condSousTypeS:[], description:'Main secondaire libre (torche, objet…). Peut parer (+1 CA si en garde).', couleur:'#4f8cff', rules:{ opportunityAttack:'allow', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
    { id:'arme_2m', label:'🗡️ Arme à 2 mains', condPrincipale:['Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.'], condSecondaire:[''], condSousTypeS:[], description:'Arme à 2 mains : dégâts maximisés (relancer les 1 et 2).', couleur:'#e8b84b', rules:{ opportunityAttack:'forbid', contactAttackMode:'none', contactAttackScope:'ranged', contactDistance:1 } },
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

/** Détecte le premier style correspondant à l'équipement actif. */
export function detectCombatStyle(character, styles = []) {
  const equip = character?.equipement || {};
  const main = equip[getPrimaryWeaponSlotId()];
  const secondary = equip[getSecondaryWeaponSlotId()];
  const mainFormat = main?.format || '';
  const secondaryFormat = secondary?.format || '';
  const secondarySubtype = String(secondary?.sousType || secondary?.nom || '').toLowerCase();

  for (const rawStyle of styles) {
    const style = normalizeCombatStyle(rawStyle);
    const mainConditions = style.condPrincipale || [];
    const secondaryConditions = style.condSecondaire || [];
    const subtypeConditions = (style.condSousTypeS || []).map(value => String(value).toLowerCase());
    const matchesMain = mainConditions.length === 0
      || mainConditions.includes(mainFormat)
      || (mainConditions.includes('') && !mainFormat);
    const matchesSecondary = secondaryConditions.length === 0
      || secondaryConditions.includes(secondaryFormat)
      || (secondaryConditions.includes('') && !secondaryFormat);
    const matchesSubtype = subtypeConditions.length === 0
      || subtypeConditions.some(value => secondarySubtype.includes(value));
    if (matchesMain && matchesSecondary && matchesSubtype) return style;
  }
  return null;
}

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
