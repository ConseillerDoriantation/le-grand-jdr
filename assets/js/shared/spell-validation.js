// ══════════════════════════════════════════════════════════════════════════════
// SHARED / SPELL-VALIDATION.JS — Ce qui renvoie un sort validé au MJ
//
// Règle : seul un changement qui modifie le sort EN JEU le renvoie « À valider ».
// Nom, icône, description, catégorie, ordre, état du Deck et réglages MJ restent
// libres.
//
// LISTE BLANCHE : seuls les champs des groupes SPELL_PLAY_GROUPS comptent. Un
// champ ajouté plus tard ne crée donc jamais de faux positif ; s'il change le
// résultat en jeu, l'ajouter ICI (sinon le joueur pourra le modifier sans
// revalidation). Valeurs normalisées : absent ≡ null ≡ '' ≡ false ≡ [] ≡ valeur
// par défaut du formulaire ; les listes d'ids se comparent sans ordre.
//
// Diff MJ : quand un changement renvoie le sort au MJ, la forge range dans le
// sort `mjReviewed = { verdict, play: spellPlaySnapshot(version relue) }` ; la
// file de validation affiche spellPlayDiff(mjReviewed.play, sort actuel). Le
// champ disparaît dès que le MJ tranche (valider / refuser).
//
// Pur (aucun DOM, aucun Firestore) — tests : tests/spell-validation.test.js.
// ══════════════════════════════════════════════════════════════════════════════

import { getAfflictionMode, usesSpellMastery } from './spell-runes.js';
import { normalizeInvocationSelection } from './invocation-stats.js';

const ACTION_LBL = { action: 'Action', action_bonus: 'Action bonus', reaction: 'Réaction' };
const TYPE_LBL = { offensif: 'Offensif', defensif: 'Soutien', utilitaire: 'Utilitaire' };
const COST_LBL = { pm: 'Points de magie', pv: 'Points de vie', or: 'Or', garde: 'Garde', none: 'Gratuit' };
const STAT_LBL = { force: 'Force', dexterite: 'Dextérité', constitution: 'Constitution', intelligence: 'Intelligence', sagesse: 'Sagesse', charisme: 'Charisme', none: 'Aucune' };
const PROT_LBL = { ca: 'CA', soin: 'Soin', mana: 'PM', reduction: 'Réduction' };
const AFFL_LBL = { dot: 'Dégâts sur la durée', etat: 'État', laceration: 'Lacération' };
const SHAPE_LBL = { rect: 'Carré', cross: 'Croix', cone: 'Cône', ring: 'Anneau', line: 'Ligne' };
const DEPL_LBL = { self: 'Lanceur', push: 'Repousse la cible', pull: 'Attire la cible' };
const EFFECT_LBL = { damage: 'Dégâts', heal: 'Soin', utility: 'Utilitaire', summon: 'Invocation' };
const TARGET_LBL = { enemy: 'Ennemi', ally: 'Allié', self: 'Lanceur', any: 'Toute cible' };

const _str = v => String(v ?? '').trim();
const _auto = v => _str(v) || 'Auto';
const _tours = n => `${n} tour${n > 1 ? 's' : ''}`;
const _stat = v => (v ? (STAT_LBL[v] || v) : 'Auto');
const _state = (id, opts) => (id ? ((opts.stateLabel && opts.stateLabel(id)) || id) : '');

// Miroir de _getSortTypes (spells-calc) : un vieux sort sans `types` garde son type implicite.
const _types = s => (Array.isArray(s.types) && s.types.length ? s.types
  : s.typeSoin ? ['defensif'] : s.noyau ? ['offensif'] : ['utilitaire']);

function _runesText(s) {
  const counts = new Map();
  (Array.isArray(s.runes) ? s.runes : []).forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    .map(([name, n]) => `${name}${n > 1 ? ` ×${n}` : ''}`)
    .join(', ') || 'Aucune';
}

function _invocationText(s) {
  if (!s.invocation) return 'Aucune';
  const sel = normalizeInvocationSelection(s.invocation);
  const scope = sel.mode === 'selected'
    ? `${sel.ids.length} créature${sel.ids.length > 1 ? 's' : ''} choisie${sel.ids.length > 1 ? 's' : ''}`
    : 'Toute la bibliothèque';
  return s.invocation.max != null ? `${scope} · ${s.invocation.max} max` : scope;
}

/** Groupes de champs EN JEU : libellé affiché, champs comparés, mise en texte. */
export const SPELL_PLAY_GROUPS = [
  { label: 'Système de sort', keys: ['designMode'], format: s => (s.designMode === 'classic' ? 'Classique' : 'Runique') },
  // Élément : comparé à part (ids, ou libellé pour les très vieux sorts).
  { label: 'Élément', keys: ['noyau', 'noyauTypeId', 'noyauTypeIds'], element: true,
    format: s => _str(s.noyau) || [s.noyauTypeId, ...(s.noyauTypeIds || [])].filter(Boolean).join(', ') || 'Aucun' },
  { label: 'Runes', keys: ['runes'], format: _runesText },
  { label: 'Type de sort', keys: ['types'], format: s => _types(s).map(t => TYPE_LBL[t] || t).join(' + ') },
  { label: "Type d'action", keys: ['actionMode'], format: s => ACTION_LBL[s.actionMode] || 'Action' },
  { label: 'Ressource dépensée', keys: ['costResource'], format: s => COST_LBL[s.costResource || 'pm'] || s.costResource },
  { label: 'Objet consommé', keys: ['consumable'],
    format: s => (s.consumable && (s.consumable.nom || s.consumable.itemId)
      ? `${s.consumable.nom || s.consumable.itemId} ×${Number(s.consumable.qty) || 1}${s.consumable.required ? ' (requis)' : ''}`
      : 'Aucun') },
  { label: 'Dégâts', keys: ['degats'], format: s => _auto(s.degats) },
  { label: 'Soin', keys: ['soin'], format: s => _auto(s.soin) },
  { label: 'CA', keys: ['ca'], format: s => _auto(s.ca) },
  { label: 'Maîtrise', keys: ['maitriseActive'], format: s => (usesSpellMastery(s) ? 'Active' : 'Désactivée') },
  { label: 'Protection', keys: ['protectionMode', 'protectionModes'],
    format: s => ((Array.isArray(s.protectionModes) && s.protectionModes.length) ? s.protectionModes : [s.protectionMode || 'ca'])
      .map(m => PROT_LBL[m] || m).join(' + ') },
  { label: 'Enchantement', keys: ['enchantEtatId', 'enchantEtatIds', 'enchantStateMoveBonus', 'enchantStateDmgFormula'],
    format: (s, opts) => {
      const ids = (Array.isArray(s.enchantEtatIds) && s.enchantEtatIds.length) ? s.enchantEtatIds : (s.enchantEtatId ? [s.enchantEtatId] : []);
      const parts = [ids.map(id => _state(id, opts)).join(', ') || 'Aucun état'];
      if (s.enchantStateMoveBonus != null && s.enchantStateMoveBonus !== '') parts.push(`déplacement +${s.enchantStateMoveBonus}`);
      if (_str(s.enchantStateDmgFormula)) parts.push(`dégâts ${_str(s.enchantStateDmgFormula)}`);
      return parts.join(' · ');
    } },
  { label: 'Affliction', keys: ['afflictionMode', 'afflictionSlot', 'afflictionSaveStat', 'afflictionDotFormula', 'afflictionEtatId'],
    format: (s, opts) => {
      const mode = getAfflictionMode(s);
      const parts = [AFFL_LBL[mode] || mode];
      if (s.afflictionEtatId) parts.push(_state(s.afflictionEtatId, opts));
      if (_str(s.afflictionDotFormula)) parts.push(_str(s.afflictionDotFormula));
      if (s.afflictionSaveStat) parts.push(`sauvegarde ${_stat(s.afflictionSaveStat)}`);
      return parts.join(' · ');
    } },
  { label: 'Régénération', keys: ['regenerationFormula'], format: s => _auto(s.regenerationFormula) },
  { label: 'Zone', keys: ['zoneW', 'zoneH', 'zoneShape', 'ampMode'],
    format: s => [
      SHAPE_LBL[s.zoneShape || 'rect'] || s.zoneShape,
      s.zoneW && s.zoneH ? `${s.zoneW}×${s.zoneH}` : '',
      s.ampMode === 'deplacement' ? 'Amplification en déplacement' : '',
    ].filter(Boolean).join(' · ') },
  { label: 'Durée', keys: ['dureeBase'], format: s => (s.dureeBase ? _tours(s.dureeBase) : 'Auto') },
  { label: 'Déplacement', keys: ['deplacement'],
    format: s => (s.deplacement && s.deplacement.mode
      ? `${DEPL_LBL[s.deplacement.mode] || s.deplacement.mode}${s.deplacement.swap ? ' (échange de place)' : ''}`
      : 'Aucun') },
  { label: 'Portée', keys: ['portee'],
    format: s => (s.portee == null || s.portee === '' ? "Portée de l'arme" : Number(s.portee) === 0 ? 'Lanceur' : `${s.portee} cases`) },
  { label: 'Caractéristique de toucher', keys: ['toucherStat'], format: s => _stat(s.toucherStat) },
  { label: "Caractéristique d'effet", keys: ['degatsStat'], format: s => _stat(s.degatsStat) },
  { label: 'Invocation', keys: ['invocation'], format: _invocationText },
  // Cochable par le joueur en système classique (réglage MJ en runique).
  { label: 'Réussite automatique', keys: ['mjAutoHit'], format: s => (s.mjAutoHit ? 'Oui' : 'Non') },
  // Système classique : le résultat est saisi directement, coût compris.
  { label: 'Coût', keys: ['pm'], format: s => `${Number(s.pm) || 0}` },
  { label: 'Effet', keys: ['classicEffect'], format: s => EFFECT_LBL[s.classicEffect] || _str(s.classicEffect) || 'Aucun' },
  { label: 'Cible', keys: ['classicTarget', 'targetSelf'], format: s => TARGET_LBL[s.classicTarget] || (s.targetSelf ? 'Lanceur' : 'Aucune') },
  { label: 'Durée', keys: ['classicDuration'], format: s => (Number(s.classicDuration) > 0 ? _tours(Number(s.classicDuration)) : 'Instantané') },
  { label: 'Recharge', keys: ['cooldownTurns'], format: s => (Number(s.cooldownTurns) > 0 ? _tours(Number(s.cooldownTurns)) : 'Aucune') },
  { label: 'État appliqué', keys: ['classicStateId', 'classicStateDC', 'classicStateSaveStat'],
    format: (s, opts) => (s.classicStateId
      ? [_state(s.classicStateId, opts), s.classicStateDC ? `DD ${s.classicStateDC}` : '', s.classicStateSaveStat ? _stat(s.classicStateSaveStat) : '']
        .filter(Boolean).join(' · ')
      : 'Aucun') },
];

/** Champs connus qui ne comptent PAS : identité, rangement, Deck, réglages MJ,
 *  préférence de stats, valeurs dérivées ou recopiées, héritages sans interface
 *  (la forge écrit toujours enchantMode « etat » et vide enchantDegats/Bonus :
 *  l'enchantement se lit dans enchantEtatId(s), comparés) et la référence MJ. */
export const SPELL_FREE_FIELDS = new Set([
  'nom', 'icon', 'effet', 'catId', 'id',
  'actif', 'alwaysPrepared', 'mjValidation', 'mjValidated', 'pmOverride', 'mjNotes', 'mjAlwaysMax',
  'applyArmorSetBonuses',   // case du MJ (bonus de set du porteur)
  'countInStats', 'mjReviewed',
  'typeSoin', 'classicFormulaFinal', 'enchantMode',
  'afflictionEtatLabel', 'afflictionEtatIcon', 'classicStateLabel', 'classicStateIcon',
  'enchantSlot', 'enchantEffect', 'afflictionEffect', 'enchantDegats', 'enchantBonus',
]);

export const SPELL_PLAY_KEYS = new Set(SPELL_PLAY_GROUPS.flatMap(g => g.keys));

// Valeur écrite par le formulaire quand le sort n'a pas le champ.
const DEFAULTS = {
  costResource: 'pm', actionMode: 'action', protectionMode: 'ca',
  afflictionMode: 'dot', afflictionSlot: 'torse', zoneShape: 'rect', ampMode: 'zone',
};
const UNORDERED = new Set(['runes', 'types', 'protectionModes', 'enchantEtatIds']);

// Lectures canoniques (miroir des règles de spells-calc / spell-runes).
const _pick = {
  types: _types,
  maitriseActive: s => usesSpellMastery(s),
  afflictionMode: s => getAfflictionMode(s),
  // En runique le coût découle des runes (déjà comparées) : seul le classique compte.
  pm: s => (s.designMode === 'classic' ? (Number(s.pm) || 0) : null),
  invocation: s => {
    if (!s.invocation) return null;
    const sel = normalizeInvocationSelection(s.invocation);
    return { selected: sel.mode === 'selected', ids: [...sel.ids].sort(), max: s.invocation.max ?? null };
  },
  consumable: s => {
    const c = s.consumable;
    if (!c || !(c.nom || c.itemId)) return null;
    return { item: String(c.nom || '').trim().toLowerCase() || c.itemId, qty: Number(c.qty) || 1, required: !!c.required };
  },
};

function _clean(v) {
  if (v == null || v === '' || v === false) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v)) {
    const out = v.map(_clean).filter(x => x !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach(k => { const x = _clean(v[k]); if (x !== undefined) out[k] = x; });
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

function _fieldKey(s, key) {
  let v = _clean(_pick[key] ? _pick[key](s) : s[key]);
  if (v !== undefined && v === DEFAULTS[key]) v = undefined;
  if (Array.isArray(v) && UNORDERED.has(key)) v = [...v].sort();
  return JSON.stringify(v ?? null);
}

const _labelKey = v => String(v || '').normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();

function _elementIds(s) {
  const ids = [s.noyauTypeId, ...(Array.isArray(s.noyauTypeIds) ? s.noyauTypeIds : [])]
    .map(id => String(id || '').trim()).filter(Boolean);
  return ids.length ? `${ids[0]}|${[...new Set(ids)].sort().join(',')}` : null;
}

function _sameElement(a, b) {
  const ia = _elementIds(a), ib = _elementIds(b);
  if (ia && ib) return ia === ib;
  return _labelKey(a.noyau) === _labelKey(b.noyau);
}

const _groupChanged = (g, a, b) => (g.element
  ? !_sameElement(a, b)
  : g.keys.some(key => _fieldKey(a, key) !== _fieldKey(b, key)));

/** Libellés des changements EN JEU entre deux versions d'un sort ([] = rien qui
 *  justifie une revalidation). */
export function spellPlayChanges(before, after) {
  if (!before || !after) return [];
  const changes = new Set();
  SPELL_PLAY_GROUPS.forEach(g => { if (_groupChanged(g, before, after)) changes.add(g.label); });
  return [...changes];
}

/** Changements EN JEU mis en texte : [{ label, before, after }].
 *  opts.stateLabel(id) → nom lisible d'un état (sinon l'id brut). */
export function spellPlayDiff(before, after, opts = {}) {
  if (!before || !after) return [];
  const rows = [];
  const seen = new Set();
  SPELL_PLAY_GROUPS.forEach(g => {
    if (seen.has(g.label) || !_groupChanged(g, before, after)) return;
    seen.add(g.label);
    rows.push({ label: g.label, before: g.format(before, opts), after: g.format(after, opts) });
  });
  return rows;
}

/** Copie compacte des seuls champs EN JEU d'un sort (formes canoniques), à
 *  ranger dans `mjReviewed.play`. Sans undefined (Firestore), invocation réduite
 *  à sa sélection (jamais d'image ni de stats embarquées). */
export function spellPlaySnapshot(s = {}) {
  const out = {};
  SPELL_PLAY_KEYS.forEach(key => {
    const v = s[key];
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  });
  out.types = _types(s);
  out.maitriseActive = usesSpellMastery(s);
  if (s.invocation) {
    const sel = normalizeInvocationSelection(s.invocation);
    out.invocation = { mode: sel.mode, ids: sel.ids, ...(s.invocation.max != null ? { max: s.invocation.max } : {}) };
  }
  return JSON.parse(JSON.stringify(out));
}
