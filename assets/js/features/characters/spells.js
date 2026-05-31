import { STATE } from '../../core/state.js';
import { charSession } from '../../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { updateInCol } from '../../data/firestore.js';
import { openModal, closeModal, pushModal, popModal, closeModalDirect } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _nl2br } from '../../shared/html.js';
import { getMod, calcPMMax, calcDeckMax, getMaitriseBonus as getSharedMaitriseBonus } from '../../shared/char-stats.js';
import { loadDamageTypes } from '../../shared/damage-types.js';
import { loadConditionLibrary } from '../../shared/conditions.js';
import { loadSpellMatrices, suggestSpellEffect, getMatrixSuggestions, getProtectionCAOverride, getComboConfig, getInvokedArm } from '../../shared/spell-matrices.js';
import { getArmorSetData, getMainWeapon } from './data.js';

// ── Drag and Drop sorts ──────────────────────
let _dragSortIdx = null;
let _spellMatricesCache = null;
let _damageTypesCache = [];
let _sortsSearch = '';
let _sortsView = 'all';
let _sortsTypeFilter = '';
let _sortsCatCollapsed = {};
let _runeCountsEdit = {};
let _sortAllowedNoyauIds = null;
let _sortTypesEdit = new Set(['utilitaire']);
let _sortActionEdit = null;
let _deplModeEdit = null;
let _sortIconPickerOutsideBound = false;

export function sortDragStart(e, idx) {
  _dragSortIdx = idx;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}
export function sortDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cs-sort-row').forEach(el => {
    el.classList.remove('cs-drop-before', 'cs-drop-after');
  });
  const rect = e.currentTarget.getBoundingClientRect();
  const mid  = rect.top + rect.height / 2;
  if (e.clientY < mid) {
    e.currentTarget.classList.add('cs-drop-before');
  } else {
    e.currentTarget.classList.add('cs-drop-after');
  }
}
export function sortDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.cs-sort-row').forEach(el => {
    el.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  });
}
export async function sortDrop(e, toIdx) {
  try {
    e.preventDefault();
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;
    const actualIdx   = insertAfter ? toIdx + 1 : toIdx;
    card.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
    document.querySelectorAll('.cs-sort-row').forEach(el =>
      el.classList.remove('cs-drop-before', 'cs-drop-after'));
    const fromIdx = _dragSortIdx;
    _dragSortIdx = null;
    if (fromIdx === null) return;
    const c = STATE.activeChar; if (!c) return;
    const sorts = [...(c.deck_sorts||[])];
    if (fromIdx === actualIdx || fromIdx === actualIdx - 1) return;
    const [moved] = sorts.splice(fromIdx, 1);
    const insertAt = actualIdx > fromIdx ? actualIdx - 1 : actualIdx;
    sorts.splice(insertAt, 0, moved);
    c.deck_sorts = sorts;
    await updateInCol('characters', c.id, {deck_sorts: sorts});
    _renderSpellsTab(c);
  } catch (e) { notifySaveError(e); }
}


// ── Helpers calcul sorts ─────────────────────────────────────────────────────

/**
 * TYPES d'un sort : tableau ['offensif','defensif','utilitaire']
 * Stocké explicitement dans s.types[]
 * Fallback legacy : typeSoin → defensif, noyau → offensif, sinon utilitaire
 */
function _getSortTypes(s) {
  if (Array.isArray(s.types) && s.types.length) return s.types;
  // Legacy
  if (s.typeSoin) return ['defensif'];
  if (s.noyau)   return ['offensif'];
  return ['utilitaire'];
}

/** Type d'action : 'action' | 'action_bonus' | 'reaction'
 *  + concentration : boolean
 *  Réaction et Concentration = 100% déterminées par les runes.
 *  Action Bonus = rune Enchantement. Override manuel possible pour Action/Action Bonus uniquement.
 */
function _getSortAction(s) {
  const runes = s.runes || [];
  const action        = runes.includes('Réaction')     ? 'reaction'
                      : runes.includes('Enchantement') ? 'action_bonus'
                      : s.actionOverride               || 'action';
  const concentration = runes.includes('Concentration');
  return { action, concentration };
}

/**
 * Dégâts effectifs d'un sort offensif.
 * - Base = dégâts de l'arme principale si degats vide
 * - Chaque rune Puissance : +1 dé
 * - Chaînage Puissance : nbPuiss > 1 → +(nbPuiss-1)*2 bonus fixe
 *   (Protection n'entre PAS dans le chaînage des dégâts — chaînage par rune.)
 */
export function _calcSortDegats(s, c) {
  const mainP   = getMainWeapon(c);
  const armeDeg = mainP.degats;

  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;

  const runes   = s.runes || [];
  const nbPuiss = runes.filter(r => r === 'Puissance').length;
  const bonusVal = nbPuiss > 1 ? (nbPuiss - 1) * 2 : 0;

  // Bonus de maîtrise de l'arme principale (toujours appliqué)
  const maitrise = _getMaitriseBonus(c, mainP);

  const match = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (match) {
    let result = `${parseInt(match[1]) + nbPuiss}${match[2]}${match[3]}`;
    const totalBonus = bonusVal + maitrise;
    if (totalBonus > 0) result += ` +${totalBonus}`;
    else if (totalBonus < 0) result += ` ${totalBonus}`;
    return result;
  }
  let result = base;
  if (nbPuiss > 0) result += ` +${nbPuiss}d6`;
  const totalBonus = bonusVal + maitrise;
  if (totalBonus > 0) result += ` +${totalBonus}`;
  else if (totalBonus < 0) result += ` ${totalBonus}`;
  return result;
}

/**
 * Soin effectif.
 * - Base 1d4 (visible dès que le sort est de type "défensif")
 * - Chaque rune Protection : +1d4, chaînage +2 soin fixe par paire
 * - Modificateur de stat selon nature du noyau :
 *    - Noyau MAGIQUE → modificateur de la stat de l'arme principale (Int/Sag/Cha…)
 *    - Noyau PHYSIQUE / sans noyau → modificateur de Constitution
 * - Maîtrise de l'arme principale ajoutée (uniquement si noyau magique)
 * - Format texte libre (ex: "moitié des dégâts") → affiché tel quel, rien ajouté
 */
function _calcSortSoin(s, c) {
  const runes  = s.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const chainSoin = nbProt > 1 ? nbProt - 1 : 0;
  const base   = (s.soin || '').trim();

  // Stat de soin : 'none' = aucun modificateur (potion flat, etc.)
  const isMagic = _isNoyauMagic(s);
  const statKey = _getSortSoinStatKey(s, c);
  const noMod   = statKey === 'none';
  const statVal = noMod ? 10 : ((c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0));
  const statMod = noMod ? 0 : Math.floor((Math.min(22, statVal) - 10) / 2);
  const statStr = statMod > 0 ? ` +${statMod}` : statMod < 0 ? ` ${statMod}` : '';

  // Maîtrise de l'arme : pertinente uniquement pour les sorts magiques (l'arme est le focus)
  const mainP   = getMainWeapon(c);
  const maitrise = isMagic ? _getMaitriseBonus(c, mainP) : 0;
  const maitriseStr = maitrise > 0 ? ` +${maitrise}` : maitrise < 0 ? ` ${maitrise}` : '';

  const buildDefault = (diceCount) => {
    let r = `${diceCount}d4${statStr}`;
    if (chainSoin > 0) r += ` +${chainSoin * 2}`;
    return r + maitriseStr;
  };

  if (!base || base.toLowerCase() === '= base') {
    return buildDefault(1 + nbProt);
  }
  if (nbProt > 0) {
    const match = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (match) {
      // Format XdY reconnu → on ajoute les dés Protection + stat + chaînage + maîtrise
      let r = `${parseInt(match[1]) + nbProt}${match[2]}${match[3]}${statStr}`;
      if (chainSoin > 0) r += ` +${chainSoin * 2}`;
      return r + maitriseStr;
    }
    // Texte libre → on n'ajoute rien, on respecte ce qui est écrit
    return base;
  }
  if (maitriseStr || statStr) return `${base}${statStr}${maitriseStr}`;
  return base;
}

/** Mode de la rune Protection : 'soin' | 'ca' — stocké dans s.protectionMode */
function _getSortProtectionMode(s) {
  return s?.protectionMode || 'ca'; // défaut CA si non précisé
}

// ══════════════════════════════════════════════════════════════════════════════
// COMBOS DE RUNES — Transformations spéciales
// Un combo détecté change l'EFFET PRODUIT par les runes (pas juste un libellé).
// La logique de détection + transformation est ici. Le MJ peut activer/désactiver
// et renommer chaque combo via la console (matrice `combos`).
// ══════════════════════════════════════════════════════════════════════════════
const SORT_COMBOS = [
  {
    id: 'drain',
    icon: '🩸',
    defaultName: 'Drain personnel',
    detect: (counts) => counts.Puissance > 0 && counts.Protection > 0,
    describe: (counts) => {
      const pct = Math.round((0.25 + 0.25 * counts.Protection) * 100);
      return `Puissance ×${counts.Puissance} + Protection ×${counts.Protection} · dégâts de l'arme · ${pct}% des dégâts soigne le lanceur`;
    },
  },
  {
    id: 'zone_elargie',
    icon: '🌐',
    defaultName: 'Zone élargie',
    detect: (counts) => counts.Amplification > 0 && counts.Dispersion > 0,
    describe: (counts) => {
      const w = _ampLength(counts.Amplification);
      const h = _ampLength(counts.Dispersion);
      return `Amp ×${counts.Amplification} + Disp ×${counts.Dispersion} · zone ${w}×${h}m (la Dispersion bénéficie du chainage comme l'Amplification)`;
    },
  },
  {
    id: 'arme_invoquee',
    icon: '⚔️',
    defaultName: 'Arme invoquée',
    detect: (counts) => counts.Enchantement > 0 && counts.Invocation > 0,
    describe: (counts, s) => {
      const arm = getInvokedArm(_spellMatricesCache, s?.noyauTypeId);
      const nbP = counts.Puissance || 0;
      const STAT_LBL = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' };
      if (arm) {
        const tch = STAT_LBL[arm.statToucher] || arm.statToucher;
        const dmg = STAT_LBL[arm.statDegats]  || arm.statDegats;
        const statStr = (arm.statToucher === arm.statDegats) ? tch : `Touche:${tch} / Dégâts:${dmg}`;
        const puissBonus = nbP > 0 ? ` +${nbP} dé${nbP>1?'s':''} (Puissance)` : '';
        return `${arm.weapon} · ${arm.degats}${puissBonus} · ${statStr} · portée ${arm.portee}m · 2 tours par défaut${arm.note ? ` · ${arm.note}` : ''}`;
      }
      return `Arme générique 1d8${nbP > 0 ? ` +${nbP} dé${nbP>1?'s':''} (Puissance)` : ''} · 2 tours par défaut · ⚠️ matrice Armes invoquées vide pour cet élément`;
    },
  },
  {
    id: 'allonge_magique',
    icon: '🏹',
    defaultName: 'Allonge magique',
    detect: (counts, s) => counts.Enchantement > 0 && counts.Amplification > 0 && (s?.enchantSlot || 'arme') === 'arme',
    describe: (counts) => {
      const len = _ampLength(counts.Amplification);
      return `Enchantement (Arme) + Amplification ×${counts.Amplification} · portée d'attaque de l'arme enchantée +${len}m (au lieu d'une zone)`;
    },
  },
  {
    id: 'sentinelle',
    icon: '🪤',
    defaultName: 'Sentinelle / Piège',
    detect: (counts) => counts.Affliction > 0 && counts.Invocation > 0,
    describe: (counts, s) => {
      const st = _calcSentinelStats(s || {});
      const nbDisp = counts.Dispersion || 0;
      const nbSent = nbDisp > 0 ? 2 * nbDisp : 1;
      const sentStr = nbSent > 1 ? `${nbSent} sentinelles stationnaires (placement libre dans la portée)` : 'sentinelle stationnaire';
      return `Affliction + Invocation · ${sentStr} · ${st.hp} PV · CA ${st.ca} · attaque ${st.dmg} · portée ${st.portee}m · 2 tours par défaut`;
    },
  },
  {
    id: 'canalise_persistant',
    icon: '🧠',
    defaultName: 'Sort canalisé persistant',
    detect: (counts) => (counts.Durée || 0) > 0 && counts.Concentration > 0,
    describe: (counts) =>
      `Durée + Concentration · le sort tient tant que la concentration est maintenue · les ${(counts.Durée||0) + 1} tours de Durée s'appliquent en grâce après rupture`,
  },
  {
    id: 'bouclier_reactif',
    icon: '🛡️',
    defaultName: 'Bouclier réactif',
    detect: (counts, s) => counts.Réaction > 0 && counts.Protection > 0 && (s?.protectionMode || 'ca') === 'ca',
    describe: (counts) => {
      const nbP = counts.Protection;
      const tier = nbP >= 3 ? 'Boss ou inférieur' : nbP === 2 ? 'Élite ou inférieur' : 'Mob classique';
      return `Réaction + Protection ×${nbP} · annule 1 attaque entrante en réaction (pas de bonus CA) · plafond cible : ${tier}`;
    },
  },
  {
    id: 'aura_punitive',
    icon: '🌀',
    defaultName: 'Aura punitive',
    // Protection + Affliction (sans Puissance, sinon c'est Drain qui prime)
    detect: (counts) => counts.Protection > 0 && counts.Affliction > 0 && (counts.Puissance || 0) === 0,
    describe: (counts) => {
      const radius = counts.Protection;
      return `Protection ×${counts.Protection} + Affliction ×${counts.Affliction} · zone ${radius}c (Manhattan) autour du lanceur · tout ennemi présent au cast subit l'affliction (JS Con DD 11) · pas de bonus CA`;
    },
  },
  {
    id: 'sort_suspendu',
    icon: '🔮',
    defaultName: 'Sort suspendu',
    // Réaction + Durée : stocke le sort, déclenchement manuel hors-tour
    detect: (counts) => counts.Réaction > 0 && (counts.Durée || 0) > 0,
    describe: (counts) => {
      const turns = (counts.Durée || 0) + 1;
      return `Réaction + Durée ×${counts.Durée || 0} · le sort est stocké au cast (PM payé) · déclenchable hors de votre tour pendant ${turns} tour${turns > 1 ? 's' : ''}`;
    },
  },
  {
    id: 'coup_chance',
    icon: '🍀',
    defaultName: 'Coup de chance',
    // Chance + Réaction : relance d'attaque sur rate
    detect: (counts) => (counts.Chance || 0) > 0 && counts.Réaction > 0,
    describe: (counts) => {
      const charges = counts.Chance || 0;
      return `Chance ×${charges} + Réaction · ${charges} relance${charges > 1 ? 's' : ''} automatique${charges > 1 ? 's' : ''} d'attaque ratée pendant 2 tours`;
    },
  },
];

/** Construit le compteur des runes depuis un sort. */
function _runeCounts(s) {
  const counts = {};
  (s?.runes || []).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return counts;
}

/** Renvoie les combos actifs pour un sort (filtre selon config MJ enabled/disabled). */
function _activeCombos(s) {
  const counts = _runeCounts(s);
  const matrices = _spellMatricesCache;
  return SORT_COMBOS.filter(combo => {
    const cfg = getComboConfig(matrices, combo.id);
    if (!cfg.enabled) return false;
    try { return !!combo.detect(counts, s); } catch { return false; }
  }).map(combo => {
    const cfg = getComboConfig(matrices, combo.id);
    return { ...combo, name: cfg.name, detail: combo.describe(counts, s) };
  });
}

// ── Auto-value : chip lecture seule + bouton "✏️ Custom" / "↺ Auto" ──────────
// Évite l'effet "input vide qui invite à taper". Le joueur voit la valeur
// calculée par défaut, et ne saisit que s'il veut explicitement override.
function _autoSourceDegats(s, c) {
  const mainP   = getMainWeapon(c);
  // Override du sort sur la stat de dégâts (override sort > arme principale)
  const statKey = s?.degatsStat || mainP.statAttaque || 'force';
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || 'For';
  const nbP     = (s.runes||[]).filter(r => r === 'Puissance').length;
  const srcLbl  = s?.degatsStat ? `stat sort (${statLbl})` : statLbl;
  const parts   = [mainP.isDefault ? `Poings ${mainP.degats}` : (mainP.nom || 'arme'), srcLbl];
  if (nbP > 0) parts.push(`Puissance ×${nbP}`);
  return `auto · ${parts.join(' + ')}`;
}
function _autoSourceSoin(s) {
  const nbProt = (s.runes||[]).filter(r => r === 'Protection').length;
  const isMagic = _isNoyauMagic(s);
  const statKey = _getSortSoinStatKey(s, _modalChar());
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
  // Le label reflète si la stat vient d'un override de sort ou de l'auto-dérivation arme/noyau
  const natureStr = s?.degatsStat
    ? `stat sort (${statLbl})`
    : (isMagic ? `magique · stat arme (${statLbl})` : `physique · Constitution (${statLbl})`);
  return nbProt > 0
    ? `auto · base 1d4 +${nbProt}d4 (Protection) · ${natureStr}`
    : `auto · base 1d4 · ${natureStr}`;
}
function _autoSourceCA(s) {
  const nbProt = (s.runes||[]).filter(r => r === 'Protection').length;
  const ov = getProtectionCAOverride(_spellMatricesCache, s?.noyauTypeId);
  if (nbProt === 0) return 'auto · CA +2 (2 tours)';
  // Combo Bouclier réactif : pas de bonus CA — source informe
  const hasReaction = (s.runes || []).includes('Réaction');
  if (hasReaction && (s.protectionMode || 'ca') === 'ca') {
    const cfg = getComboConfig(_spellMatricesCache, 'bouclier_reactif');
    if (cfg.enabled) return `combo Bouclier réactif · annule 1 attaque en réaction · Protection ×${nbProt}`;
  }
  const modStr = ov ? `mod ×${ov.mod}` : 'mod ×2';
  const noteStr = ov?.note ? ` · ${ov.note}` : '';
  return `auto · Protection ×${nbProt} · ${modStr} (2 tours)${noteStr}`;
}
function _autoSourceEnchantDeg(s) {
  const nbP = (s.runes||[]).filter(r => r === 'Puissance').length;
  return nbP > 0 ? `auto · (1+${nbP} Puissance)d4 +2` : 'auto · 1d4 +2';
}

// Lit la valeur d'un <select> seulement s'il est RÉELLEMENT visible (aucun
// ancêtre en display:none). Évite de lire la valeur d'un sélecteur de stat
// caché qui aurait conservé sa valeur initiale et qui écraserait la sélection
// utilisateur sur la section visible.
function _readVisibleStatOverride(...ids) {
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue;
    let n = el, visible = true;
    while (n && n !== document.body) {
      if (n.style?.display === 'none') { visible = false; break; }
      n = n.parentElement;
    }
    if (visible && el.value) return el.value;
  }
  return '';
}

// Helper : options HTML pour les select de stat de sort.
// Utilisé à plusieurs endroits (Toucher, Dégâts, Soin) — single source of truth.
function _SPELL_STAT_OPTIONS(selected = '') {
  return [
    ['',           'Auto (arme)'],
    ['none',       'Aucune (pas de modificateur)'],
    ['force',       'Force'],
    ['dexterite',   'Dextérité'],
    ['intelligence','Intelligence'],
    ['sagesse',     'Sagesse'],
    ['constitution','Constitution'],
    ['charisme',    'Charisme'],
  ].map(([v, lbl]) => `<option value="${v}" ${selected===v?'selected':''}>${lbl}</option>`).join('');
}

/**
 * Génère le HTML d'un champ auto-calculé avec toggle Custom / Auto.
 * fieldId = id de l'input override (ex: 's-degats')
 * Le wrapper contient deux modes : display (chip lecture seule) et edit (input).
 */
function _autoValHtml({ fieldId, label, autoValue, autoSource, currentValue, placeholder, extraEdit }) {
  // Mode Custom = toggle pour overrider la FORMULE.
  // Les sélecteurs de STAT (extraEdit) sont TOUJOURS visibles : changer la stat
  // ne nécessite pas de passer en mode Custom de la formule (ce sont des overrides
  // indépendants). Cela évite que l'override de stat ne soit jamais saisi.
  const hasOverride = !!(currentValue && String(currentValue).trim());
  const extraHtml   = extraEdit?.html || '';
  return `
    <div class="cs-spell-autoval ${hasOverride ? 'is-custom' : ''}">
      <div class="cs-spell-autoval-label">${label}</div>
      <div class="cs-spell-autoval-display" id="${fieldId}-display" style="${hasOverride?'display:none':''}">
        <span class="cs-spell-autoval-val"    id="${fieldId}-autoval">${autoValue || '—'}</span>
        <span class="cs-spell-autoval-source" id="${fieldId}-source">${autoSource || ''}</span>
        <button type="button" class="cs-spell-autoval-btn" data-action="_enableSortCustom" data-field="${fieldId}">✏️ Custom</button>
      </div>
      <div class="cs-spell-autoval-edit" id="${fieldId}-edit" style="${hasOverride?'':'display:none'}">
        <div class="cs-spell-autoval-edit-row">
          <input class="input-field" id="${fieldId}" value="${currentValue||''}" placeholder="${placeholder||''}">
          <button type="button" class="cs-spell-autoval-btn" data-action="_disableSortCustom" data-field="${fieldId}">↺ Auto</button>
        </div>
      </div>
      ${extraHtml}
    </div>
  `;
}

// Slots possibles pour Enchantement / Affliction (élément × slot = effet thématique)
const SPELL_SLOTS = [
  { v:'arme',  label:'⚔️ Arme',   short:'Arme',  icon:'⚔️' },
  { v:'tete',  label:'👁️ Tête',   short:'Tête',  icon:'👁️' },
  { v:'torse', label:'👕 Torse',  short:'Torse', icon:'👕' },
  { v:'pieds', label:'👢 Pieds',  short:'Pieds', icon:'👢' },
];
const SLOT_LABEL = { arme:'⚔️ Arme', tete:'👁️ Tête', torse:'👕 Torse', pieds:'👢 Pieds' };

/**
 * Dégâts du DoT d'affliction (mode 'dot') effectifs (auto si vide).
 * Formule : (1 + nbPuissance)d4 + (2 + 2 × max(0, nbPuissance - 1))
 * → 0 Puiss : 1d4 +2 · 1 Puiss : 2d4 +2 · 2 Puiss : 3d4 +4 · 3 Puiss : 4d4 +6
 */
/** Mapping legacy slot → stat de sauvegarde (rétro-compat sorts existants). */
function _legacySlotToStat(slot) {
  if (slot === 'torse') return 'constitution';
  if (slot === 'pieds') return 'force';
  if (slot === 'tete')  return 'sagesse';
  if (slot === 'arme')  return 'dexterite';
  return 'constitution';
}

export function _calcAfflictionDot(s) {
  const manual = (s?.afflictionDotFormula || '').trim();
  if (manual) return manual;
  const nbPuiss = (s?.runes || []).filter(r => r === 'Puissance').length;
  const dice = 1 + nbPuiss;
  const mod  = 2 + 2 * Math.max(0, nbPuiss - 1);
  return `${dice}d4 +${mod}`;
}
function _autoSourceAfflictionDot(s) {
  const nbP = (s?.runes || []).filter(r => r === 'Puissance').length;
  if (nbP === 0) return '1 Affliction · base';
  if (nbP === 1) return '+1 Puiss · 1 dé bonus';
  return `+${nbP} Puiss · ${nbP} dés + chaînage`;
}

/**
 * Dégâts d'enchantement effectifs (mode Dégâts uniquement, auto si vide).
 * Formule : (1 + nbPuissance)d4 + 2 dans l'élément.
 * Le slot legacy est ignoré — seul le mode importe.
 */
function _calcEnchantDegats(s) {
  // Mode État → pas de dégâts bonus
  if ((s.enchantMode || 'dmg') === 'etat') return '';
  const manual = (s.enchantDegats || '').trim();
  if (manual) return manual;
  const nbPuiss = (s.runes || []).filter(r => r === 'Puissance').length;
  return `${1 + nbPuiss}d4 +2`;
}

/** Valeur CA (rune Protection mode CA) :
 *  - Saisie manuelle si fournie
 *  - Sinon auto : (mod par rune selon élément ou 2 par défaut) + chaînage +1 / rune au-delà de la 1ère
 *  - Le mod par élément vient de la matrice MJ : _spellMatricesCache (Protection×CA)
 */
function _getSortCA(s) {
  const manual = (s?.ca || '').trim();
  if (manual) return manual;
  const nbProt = (s.runes || []).filter(r => r === 'Protection').length;
  if (nbProt === 0) return 'CA +2 (2 tours)';
  // Combo Bouclier réactif : pas de bonus CA, juste un blocage en réaction
  const hasReaction = (s.runes || []).includes('Réaction');
  if (hasReaction && (s.protectionMode || 'ca') === 'ca') {
    const cfg = getComboConfig(_spellMatricesCache, 'bouclier_reactif');
    if (cfg.enabled) {
      const tier = nbProt >= 3 ? 'Boss-' : nbProt === 2 ? 'Élite-' : 'Mob';
      return `Bloque 1 attaque (${tier})`;
    }
  }
  const ov  = getProtectionCAOverride(_spellMatricesCache, s?.noyauTypeId);
  const mod = ov?.mod ?? 2;
  const base  = nbProt * mod;
  const chain = nbProt > 1 ? (nbProt - 1) : 0;
  return `CA +${base + chain} (2 tours)`;
}

/**
 * Nombre de cibles — règle Dispersion solo :
 * 0 rune  → 1 cible
 * N runes → 2N cibles différentes (1 base + N runes + (N-1) chaînage)
 *
 * En combo avec Amplification, Dispersion bascule en "élargissement de zone"
 * et ne génère PAS de cibles supplémentaires — la zone gère ça.
 */
function _calcSortCibles(s) {
  const runes = s.runes || [];
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  const nbAmp  = runes.filter(r => r === 'Amplification').length;
  const nbAff  = runes.filter(r => r === 'Affliction').length;
  const nbInv  = runes.filter(r => r === 'Invocation').length;
  // Combo Amp + Disp → mode zone, pas de cibles séparées
  if (nbAmp > 0 && nbDisp > 0) return 1;
  // Combo Sentinelle (Aff + Inv) + Disp → invocations multiples, pas de cibles séparées
  if (nbAff > 0 && nbInv > 0 && nbDisp > 0) return 1;
  if (nbDisp === 0) return 1;
  return 2 * nbDisp; // 2N cibles différentes
}

/** Détermine si le noyau du sort est magique (depuis la matrice damage_types).
 *  Détermine la stat utilisée pour le soin (magique → arme · physique → Constitution).
 */
function _isNoyauMagic(s) {
  const types = _damageTypesCache;
  if (!types || !s?.noyauTypeId) return false;
  const t = types.find(x => x.id === s.noyauTypeId);
  return !!t?.isMagic;
}

/** Stat utilisée pour calculer le bonus de soin :
 *   - Noyau magique avec arme magique équipée → stat de l'arme
 *   - Noyau magique sans arme (Poings) → Intelligence (fallback raisonnable)
 *   - Noyau physique / pas de noyau → Constitution
 */
function _getSortSoinStatKey(s, c) {
  // Override explicite du sort > déduction auto selon noyau
  if (s?.degatsStat) return s.degatsStat;
  if (_isNoyauMagic(s)) {
    const mainP = getMainWeapon(c);
    if (mainP.isDefault) return 'intelligence';
    return mainP.statAttaque || 'intelligence';
  }
  return 'constitution';
}

/** Vrai si le sort peut avoir une "durée de base" pertinente.
 *  Affiché conditionnellement dans le modal — Protection CA, Enchant, Affliction, ou rune Durée.
 */
function _needsDureeBase(s) {
  const runes = s?.runes || [];
  if (!runes.length) return false;
  if (runes.includes('Durée')) return true;
  if (runes.includes('Enchantement') || runes.includes('Affliction')) return true;
  if (runes.includes('Protection') && (s?.protectionMode || 'ca') === 'ca') return true;
  return false;
}

/** Durée totale en tours d'un sort.
 *  Base 2 tours (sort persistant) + bonus rune Durée.
 *  Bonus Durée : chaque rune ajoute +2, chaînage ajoute +1 supplémentaire par rune au-delà de la 1ère.
 *  → 0 Durée : 2 · 1 Durée : 4 (=2+2) · 2 Durée : 7 (=2+4+1) · 3 Durée : 10 (=2+6+2) · 4 Durée : 13
 *  Override : s.dureeBase remplace la base 2 si supérieur (saisie manuelle).
 */
function _calcSortDuree(s) {
  const runes  = s?.runes || [];
  const nbDur  = runes.filter(r => r === 'Durée').length;
  // Base : 2 tours par défaut, ou override manuel via s.dureeBase
  const base   = (s?.dureeBase && s.dureeBase >= 2) ? s.dureeBase : 2;
  // Bonus Durée scalable : 2 par rune + 1 par chaînage
  const runeBonus = nbDur > 0 ? (2 * nbDur + (nbDur - 1)) : 0;
  return base + runeBonus;
}
function _autoSourceDuree(s) {
  const nbDur = (s?.runes || []).filter(r => r === 'Durée').length;
  if (nbDur === 0) return 'base persistante';
  if (nbDur === 1) return '+1 Durée · +2 tours';
  return `+${nbDur} Durée · +${2*nbDur + (nbDur-1)} tours (chaînage)`;
}


/** Longueur de zone produite par N runes (Amplification OU Dispersion en combo).
 *  Chaque rune ajoute +3m de base, chainage +1m par rune au-delà de la 1ère.
 *  ×1=3, ×2=7, ×3=11, ×4=15… → 3N + (N-1) = 4N-1 pour N≥1
 */
function _ampLength(nbAmp) { return nbAmp >= 1 ? (4 * nbAmp - 1) : 0; }

/** Zone calculée :
 *  - Si zoneW/H manuels saisis → ils priment (override MJ)
 *  - Sinon, calculé depuis les runes Amplification (+ Dispersion en combo) :
 *      Amplification ×N → longueur = 4N-1 m  (chainage)
 *      Combo avec Dispersion ×M → largeur = 4M-1 m (même formule, symétrique)
 *      Defaut combo Amp + Disp = 3 × 3
 *  - Source: 'manual' | 'runes' | null
 */
function _calcSortZone(s) {
  const runes  = s.runes || [];
  const wMan = s.zoneW ? parseInt(s.zoneW) : 0;
  const hMan = s.zoneH ? parseInt(s.zoneH) : 0;
  if (wMan > 0 || hMan > 0) return { w: wMan, h: hMan, source: 'manual' };

  const nbAmp  = runes.filter(r => r === 'Amplification').length;
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  if (nbAmp === 0) return null;

  const length = _ampLength(nbAmp);
  // Dispersion en combo applique le MÊME chainage qu'Amplification (4M-1).
  // Sans Dispersion → largeur 1 (ligne).
  const width = nbDisp >= 1 ? _ampLength(nbDisp) : 1;
  return { w: length, h: width, source: 'runes', amp: nbAmp, disp: nbDisp };
}

/** Déplacement : { mode:'push'|'pull', distance }, ou null */
function _calcSortDeplacement(s) {
  if (!s.deplacement?.mode) return null;
  return { mode: s.deplacement.mode, distance: Math.max(1, parseInt(s.deplacement.distance) || 1) };
}

/** Lacération : réduction CA cible
 *  ×1 → -1 CA · ×N → -(2N-1) CA brut (plafonné -2 joueur / -4 Élite-Boss en jeu)
 */
function _calcLaceration(s) {
  const nb = (s.runes||[]).filter(r => r === 'Lacération').length;
  if (!nb) return null;
  return { runes: nb, reduction: 2*nb - 1, max: 2, maxElite: 4 };
}

/** Chance : réduction RC critique
 *  ×1 → RC 19-20 (-1) · ×N → RC (21-2N)-20 (-(2N-1))
 *  Bonus : le dé de critique ajouté est aussi max
 */
function _calcChance(s) {
  const nb = (s.runes||[]).filter(r => r === 'Chance').length;
  if (!nb) return null;
  const reduction = 2*nb - 1;
  return { runes: nb, rc: 20 - reduction, reduction };
}

/** Drain : pourcentage des dégâts soigné au lanceur.
 *  Formule : 25% + 25% × nbProtection → Prot×1=50, ×2=75, ×3=100, ×4=125…
 *  Le drain est piloté entièrement par les runes ; plus de soinFraction.
 */
function _calcDrainPct(s) {
  const runes = s?.runes || [];
  const nbP    = runes.filter(r => r === 'Puissance').length;
  const nbProt = runes.filter(r => r === 'Protection').length;
  if (!nbP || !nbProt) return 0;
  return 0.25 + 0.25 * nbProt;
}

/** DD du jet de Sagesse de concentration : 11 + 2×(n-1).
 *  1 rune Concentration = DD 11 · 2 = 13 · 3 = 15 · etc.
 */
function _calcConcentrationDD(s) {
  const nb = (s?.runes || []).filter(r => r === 'Concentration').length;
  if (!nb) return null;
  return 11 + 2 * (nb - 1);
}

/** Stats propres de la Sentinelle (combo Affliction + Invocation).
 *  - Dégâts : 1d4 base + Puissance avec chaînage standard (+2/rune au-delà de la 1ère)
 *  - PV     : 10 + 5×nbProt + chaînage (+1/rune au-delà de la 1ère)
 *  - CA     : 10 + 2×nbProt + chaînage (+1/rune au-delà de la 1ère)
 *  - Portée : 1m (Manhattan) sans Amp · sinon 4N-1 mètres (3, 7, 11, 15…)
 */
function _calcSentinelStats(s) {
  const runes = s?.runes || [];
  const nbP    = runes.filter(r => r === 'Puissance').length;
  const nbProt = runes.filter(r => r === 'Protection').length;
  const nbAmp  = runes.filter(r => r === 'Amplification').length;
  // Dégâts d4 : base 1d4 + 1d4 par Puissance, chaînage +2 par paire au-delà de la 1ère
  const nbDice = 1 + nbP;
  const chainDmg = nbP > 1 ? (nbP - 1) * 2 : 0;
  const dmg = chainDmg > 0 ? `${nbDice}d4 +${chainDmg}` : `${nbDice}d4`;
  // PV : chainage +1 par rune au-delà de la 1ère
  const chainProt = nbProt > 1 ? (nbProt - 1) : 0;
  const hp = 10 + 5 * nbProt + chainProt;
  const ca = 10 + 2 * nbProt + chainProt;
  // Portée : 1m sans Amp, sinon longueur Amp (réutilise _ampLength)
  const portee = nbAmp === 0 ? 1 : _ampLength(nbAmp);
  return { dmg, hp, ca, portee, nbP, nbProt, nbAmp };
}

/** Stats propres de l'Arme invoquée (combo Enchantement + Invocation).
 *  Lit la matrice MJ pour l'arme de base de l'élément, puis ajoute Puissance.
 */
function _calcInvokedArmStats(s) {
  const runes = s?.runes || [];
  const nbP = runes.filter(r => r === 'Puissance').length;
  const arm = getInvokedArm(_spellMatricesCache, s?.noyauTypeId);
  const baseDmg = arm?.degats || '1d8';
  let dmg = baseDmg;
  if (nbP > 0) {
    const m = baseDmg.match(/^(\d+)(d\d+)(.*)$/i);
    dmg = m ? `${parseInt(m[1]) + nbP}${m[2]}${m[3]}` : `${baseDmg} +${nbP}d6`;
  }
  return {
    weapon: arm?.weapon || 'Arme magique',
    dmg,
    statToucher: arm?.statToucher || 'force',
    statDegats:  arm?.statDegats || 'force',
    portee: arm?.portee || 1,
    note: arm?.note || '',
    hp: 10, ca: 10, // par défaut, peuvent être enrichis ensuite
    nbP,
  };
}

/**
 * Génère le résumé textuel complet des effets d'un sort
 * sous forme de tableau de lignes {icon, label, detail}
 */
function _buildSortResume(s, c) {
  const lines = [];
  const runes  = s.runes || [];
  const types  = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);

  // Action + Nature (instantané/persistant) + Portée (de l'arme principale, fallback Poings)
  const actionLabels = { action:'⚡ Action', action_bonus:'✴️ Action Bonus', reaction:'🔄 Réaction' };
  let actionStr = actionLabels[action] || '⚡ Action';
  if (concentration) actionStr += ' + 🧠 Concentration';
  // Nature : instantané sauf si une durée explicite est définie ou si Enchant/Affliction/Protection CA actifs
  const isPersistent = runes.includes('Durée') || runes.includes('Enchantement') || runes.includes('Affliction')
                    || (runes.includes('Protection') && (s.protectionMode || 'ca') === 'ca' && !runes.includes('Réaction'))
                    || !!(s.dureeBase && s.dureeBase >= 2);
  const natureStr = isPersistent ? '⏳ Persistant' : '⏱️ Instantané';
  const concDD = _calcConcentrationDD(s);
  lines.push({ icon: '', label: `${actionStr} · ${natureStr}`, detail: concDD ? `JS Sagesse DD ${concDD} si dégâts reçus · jusqu'à 10 tours` : '' });

  // Portée du sort = portée de l'arme principale équipée (ou Poings = 1m)
  // Sauf si combo Allonge magique : portée étendue (voir ligne dédiée plus bas)
  const mainWp = getMainWeapon(c);
  const wpPortee = parseInt(mainWp.portee) || 1;
  lines.push({ icon:'📏', label:`Portée ${wpPortee}m`, detail: mainWp.isDefault ? 'Poings (mains nues)' : `Arme : ${mainWp.nom}` });

  // Combos détectés (centralisés dans SORT_COMBOS, MJ peut activer/désactiver)
  const nbPuiss   = runes.filter(r => r === 'Puissance').length;
  const nbProt    = runes.filter(r => r === 'Protection').length;
  const activeCombos = _activeCombos(s);
  const comboIds = new Set(activeCombos.map(c => c.id));
  activeCombos.forEach(combo => {
    lines.push({ icon: combo.icon, label: `Combo ${combo.name}`, detail: combo.detail, isCombo: true });
  });

  // Cibles & zone — calcul commun pour décorer les lignes mono-cible
  const nbCibles   = _calcSortCibles(s);
  const zoneCalc   = _calcSortZone(s);
  const isZone     = !!zoneCalc;
  const isMonoCib  = !isZone && nbCibles === 1;
  const monoStr    = isMonoCib ? ' · sur 1 cible' : '';

  // Dégâts (si offensif) — masque la ligne pour les sorts Soutien/Contrôle/Méta
  // qui ne font pas de dégâts d'impact (Enchantement et Affliction sont auto-suppressés).
  // Sinon, sans formule explicite, on affichait le "1d6" de l'arme par défaut, ce qui
  // donnait une impression trompeuse de dégâts directs.
  const isEnchantOnly  = runes.includes('Enchantement') && !((s.degats || '').trim());
  const isAfflictionSpell = runes.includes('Affliction'); // affliction = jamais d'impact
  const _suppressImpactDmg = isEnchantOnly || isAfflictionSpell;
  if (types.includes('offensif') && !_suppressImpactDmg) {
    const mainP   = getMainWeapon(c);
    // Override du sort sur la stat de dégâts > stat de l'arme principale
    const statKey = s?.degatsStat || mainP.statAttaque || mainP.toucherStat || 'force';
    const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
    const modAtk  = Math.floor((Math.min(22, statVal) - 10) / 2);
    const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
    const maitrise = _getMaitriseBonus(c, mainP);
    const deg      = _calcSortDegats(s, c);
    // Label détaillé : dés + stat + maîtrise si présente
    const modAtkStr = modAtk >= 0 ? `+${modAtk}` : `${modAtk}`;
    const maitriseStr = maitrise !== 0 ? ` + Maî(${maitrise > 0 ? '+'+maitrise : maitrise})` : '';
    const detail = `Dégâts · ${statLbl}(${modAtkStr})${maitriseStr}${monoStr}`;
    lines.push({ icon:'⚔️', label:deg, detail });
  }

  // (Affliction / Enchantement : rendu dans le bloc unifié plus bas,
  //  qui respecte les modes et ne fait pas de fallback DoT incorrect.)

  // Protection : Soin ou CA selon protectionMode
  const hasDefensif = types.includes('defensif');
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (mode === 'soin') {
      // Combo Drain (Puissance + Protection mode soin) : pas de soin direct,
      // le lanceur récupère un pourcentage des dégâts infligés (formule des runes).
      if (comboIds.has('drain')) {
        const pct = Math.round(_calcDrainPct(s) * 100);
        lines.push({ icon:'🩸', label:`Drain ${pct}% des dégâts`, detail:`Soigne le lanceur · pas de soin direct · scale avec Protection` });
      } else {
        const mainPsoin  = getMainWeapon(c);
        const maitrSoin  = _getMaitriseBonus(c, mainPsoin);
        const maitrSoinStr = maitrSoin !== 0 ? ` + Maî(${maitrSoin > 0 ? '+'+maitrSoin : maitrSoin})` : '';
        const chainStr   = nbProt > 1 ? ` +${(nbProt-1)*2}` : '';
        lines.push({ icon:'💚', label:_calcSortSoin(s, c), detail:`Soin · +${nbProt}d4 Prot${chainStr}${maitrSoinStr}${monoStr}` });
      }
    } else {
      // Mode CA — sauf si combo Bouclier réactif : la réaction instantanée ne donne pas de CA
      if (comboIds.has('bouclier_reactif')) {
        const tier = nbProt >= 3 ? 'Boss ou inférieur' : nbProt === 2 ? 'Élite ou inférieur' : 'Mob classique';
        lines.push({
          icon:'🛡️',
          label: `Bloque 1 attaque entrante`,
          detail: `Protection ×${nbProt} · plafond cible : ${tier} · pas de bonus CA, l'attaque est annulée en réaction`,
        });
      } else {
        const caLbl = _getSortCA(s);
        lines.push({ icon:'🛡️', label: caLbl, detail: `Bonus de CA (2 tours)${monoStr}` });
      }
    }
  } else if (hasDefensif) {
    lines.push({ icon:'🛡️', label:'Effet défensif', detail:'Décris l\'effet ci-dessous' });
  }

  // Cibles (uniquement si Dispersion solo, sans combo Amp+Disp)
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  const nbAmp  = runes.filter(r => r === 'Amplification').length;
  if (nbCibles > 1 && !(nbAmp > 0 && nbDisp > 0)) {
    const dispDetail = nbDisp === 1
      ? '1 rune Dispersion · cibles différentes uniquement'
      : `${nbDisp} runes Dispersion · chaînage +${nbDisp - 1} cible/rune · cibles différentes`;
    lines.push({ icon:'🎯', label:`${nbCibles} cibles différentes`, detail: dispDetail });
  }

  // Zone (Amplification ou manuelle) — sauf combo Allonge magique : devient portée d'arme
  if (zoneCalc && !comboIds.has('allonge_magique')) {
    let zoneDetail = '';
    if (zoneCalc.source === 'runes') {
      const baseMeters = 3 * zoneCalc.amp;
      const chainMeters = zoneCalc.amp > 1 ? (zoneCalc.amp - 1) : 0;
      if (zoneCalc.amp > 0 && zoneCalc.disp > 0) {
        zoneDetail = `Combo Amp ×${zoneCalc.amp} + Disp ×${zoneCalc.disp} · zone élargie`;
      } else if (zoneCalc.amp > 1) {
        zoneDetail = `Amplification ×${zoneCalc.amp} · ${baseMeters}m base + ${chainMeters}m chaînage`;
      } else {
        zoneDetail = `Amplification ×1 · 3m base`;
      }
    } else {
      zoneDetail = 'Zone manuelle (override MJ)';
    }
    // Sort de terrain : Amplification seule (sans Puissance ni Protection) → 2 tours par défaut
    const isTerrain = zoneCalc.source === 'runes' && nbPuiss === 0 && nbProt === 0;
    if (isTerrain) zoneDetail += ' · 2 tours par défaut (sort de terrain)';
    lines.push({ icon:'📐', label:`Zone ${zoneCalc.w}×${zoneCalc.h}m`, detail: zoneDetail });
  } else if (zoneCalc && comboIds.has('allonge_magique')) {
    // Allonge magique : la longueur Amp devient la portée de l'arme enchantée
    lines.push({ icon:'🏹', label:`Portée d'arme +${zoneCalc.w}m`, detail:`Allonge magique active · l'arme enchantée porte à ${zoneCalc.w}m supplémentaires` });
  }

  // Déplacement (pousse / attire)
  const depl = _calcSortDeplacement(s);
  if (depl) {
    const dIcon = depl.mode === 'push' ? '↗' : '↙';
    lines.push({ icon: dIcon, label: depl.mode === 'push' ? `Pousse ${depl.distance}m` : `Attire ${depl.distance}m`, detail:'' });
  }

  // Durée (base + rune Durée) — combo Sort canalisé persistant : tant que la concentration tient
  // Affichée uniquement pour les sorts persistants (Enchant, Affliction, Protection CA, rune Durée)
  if (_needsDureeBase(s)) {
    const duree = _calcSortDuree(s);
    const nbDur = runes.filter(r => r === 'Durée').length;
    const hasOverride = s.dureeBase && s.dureeBase >= 2;
    const baseVal = hasOverride ? s.dureeBase : 2;
    const runeBonus = duree - baseVal;
    if (comboIds.has('canalise_persistant')) {
      lines.push({
        icon:'⏱️',
        label: `Tant que concentration · +${runeBonus} tours de grâce`,
        detail: `Sort canalisé persistant · pas de plafond 10t · les ${runeBonus} tours s'appliquent après rupture de concentration`,
      });
    } else {
      const baseLbl = hasOverride ? `${baseVal} base (override)` : '2 base';
      const detail = [
        baseLbl,
        nbDur > 0 ? `+${runeBonus} (Durée ×${nbDur}${nbDur>1?' avec chaînage':''})` : '',
      ].filter(Boolean).join(' · ');
      lines.push({ icon:'⏱️', label:`${duree} tour${duree > 1 ? 's' : ''}`, detail });
    }
  }

  // Lacération
  const lac = _calcLaceration(s);
  if (lac) {
    const chainNote = lac.runes > 1 ? ` · chaîné +${lac.runes - 1}` : '';
    lines.push({ icon:'🩸', label:`CA cible −${lac.reduction}${monoStr}`, detail:`Brut · plafond −${lac.max} (−${lac.maxElite} Élites/Boss)${chainNote}` });
  }

  // Chance
  const chc = _calcChance(s);
  if (chc) {
    const chainNote = chc.runes > 1 ? ` · chaîné +${chc.runes - 1} sur la plage` : '';
    lines.push({ icon:'🍀', label:`RC ${chc.rc}–20`, detail:`Critique aussi max${chainNote}` });
  }

  // ── Enchantement (mode Dégâts ou État) ──────────────────────────────
  // Plus de slots — uniquement le mode et l'effet associé.
  // Combos absorbants (Arme invoquée) → ligne classique cachée.
  const nbEnch = runes.filter(r => r === 'Enchantement').length;
  const nbAff  = runes.filter(r => r === 'Affliction').length;
  const hideEnch = comboIds.has('arme_invoquee');
  const hideAff  = comboIds.has('sentinelle');
  if (nbEnch > 0 && !hideEnch) {
    const mode    = s.enchantMode || 'dmg';
    const cibleStr = nbEnch === 1 ? 'sur 1 allié' : `sur ${nbEnch} alliés (chaîné +${nbEnch-1})`;
    const detailParts = ['2 tours', 'Action Bonus', cibleStr];
    // Mode décisif : si État → état affiché (jamais dégâts) ; si Dégâts → dégâts (jamais état)
    if (mode === 'etat') {
      const lib = _conditionsLibCache || [];
      const etat = s.enchantEtatId ? lib.find(c2 => c2.id === s.enchantEtatId) : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ Aucun état choisi';
      lines.push({ icon:'✨', label:`Enchantement · État sur allié : ${lbl}`,
                   detail: detailParts.join(' · ') });
    } else {
      const degAuto = _calcEnchantDegats(s);
      const note = s.enchantDegats?.trim() ? '' : ' · auto (1+Puiss)d4+2';
      lines.push({ icon:'✨', label:`Enchantement · Bonus arme alliée +${degAuto}`,
                   detail: detailParts.join(' · ') + note });
    }
  }

  // ── Affliction (mode DoT ou État) ──────────────────────────────────
  if (nbAff > 0 && !hideAff) {
    const mode = s.afflictionMode || 'dot';
    const dd   = 11 + 3 * (nbAff - 1);
    // Stat de JS dérivée (comme dans le VTT)
    let saveStat = 'constitution';
    const lib = _conditionsLibCache || [];
    if (mode === 'etat' && s.afflictionEtatId) {
      const etat = lib.find(c2 => c2.id === s.afflictionEtatId);
      if (etat?.defaultSaveStat) saveStat = etat.defaultSaveStat;
    }
    if (s.afflictionSaveStat) saveStat = s.afflictionSaveStat;
    const STAT_SHORT2 = { force:'For', dexterite:'Dex', constitution:'Con',
                          intelligence:'Int', sagesse:'Sag', charisme:'Cha' };
    const statLbl = STAT_SHORT2[saveStat] || saveStat;
    const cibleStr = nbAff === 1 ? 'sur 1 ennemi' : `sur ${nbAff} ennemis (chaîné +${nbAff-1})`;

    if (mode === 'etat') {
      // Mode État : on affiche l'état appliqué, PAS la formule DoT
      const etat = s.afflictionEtatId ? lib.find(c2 => c2.id === s.afflictionEtatId) : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ Aucun état choisi';
      lines.push({ icon:'⛓', label:`Affliction · État : ${lbl}`,
                   detail: `${cibleStr} · JS ${statLbl} DD ${dd} pour résister` });
    } else {
      // Mode DoT : on affiche la formule de dégâts par tour
      const formula = _calcAfflictionDot(s);
      lines.push({ icon:'🩸', label:`Affliction · DoT ${formula} / tour`,
                   detail: `${cibleStr} · JS ${statLbl} DD ${dd} de la cible` });
    }
  }

  // Invocation — masquée si absorbée par un combo (Arme invoquée, Sentinelle)
  const hideInvoc = comboIds.has('arme_invoquee') || comboIds.has('sentinelle');
  if (runes.includes('Invocation') && !hideInvoc) {
    lines.push({ icon:'🐾', label:'Invocation', detail:'Créature liée · 10 PV · CA 10 · 2 tours par défaut' });
  }

  // Détails Sentinelle — affichés à la place de la ligne classique Invocation/Affliction
  if (comboIds.has('sentinelle')) {
    const st = _calcSentinelStats(s);
    const nbDisp = runes.filter(r => r === 'Dispersion').length;
    const nbSent = nbDisp > 0 ? 2 * nbDisp : 1;
    const countStr = nbSent > 1 ? ` · ×${nbSent} sentinelles` : '';
    lines.push({ icon:'🪤', label:`Sentinelle · ${st.hp} PV · CA ${st.ca}${countStr}`, detail:`Attaque ${st.dmg} · portée ${st.portee}m · stationnaire · 2 tours par défaut` });
  }

  // Concentration (rappel JS si pas déjà mentionné)
  if (concentration && action !== 'action') {
    const dd = _calcConcentrationDD(s) ?? 11;
    lines.push({ icon:'🧠', label:'Concentration', detail:`JS Sagesse DD ${dd} si dégâts reçus · jusqu'à 10 tours` });
  }

  // Limite MJ (texte libre)
  if (s.mjNotes && s.mjNotes.trim()) {
    lines.push({ icon:'🔒', label:'Limite MJ', detail: s.mjNotes.trim() });
  }

  return lines;
}

// Placeholder — resolved at runtime via characters.js import chain
function _getMaitriseBonus(c, item) {
  return getSharedMaitriseBonus(c, item);
}

function _getCurrentSpellChar() {
  return STATE.activeChar || charSession.getCurrentChar() || null;
}

function _renderSpellsTab(c = _getCurrentSpellChar()) {
  if (!c) return;
  if (charSession.getCurrentCharTab() === 'sorts') {
    charSession.renderTab('sorts', c, charSession.getCanEditChar());
  } else {
    charSession.renderSheet(c, 'sorts');
  }
}

export function renderCharDeck(c, canEdit) {
  const allSorts = c.deck_sorts || [];
  const cats     = c.sort_cats  || [];
  const mainP    = getMainWeapon(c);
  const armeDeg  = mainP.degats;
  const openIdx  = _openSortIdx ?? null;

  const armorSet = getArmorSetData(c);
  const pmDelta  = armorSet.modifiers?.spellPmDelta || 0;

  // ── État UI persistant (filtres / recherche / pliage) ─────────────
  const search   = (_sortsSearch || '').toLowerCase().trim();
  const view     = _sortsView || 'all';          // 'all' | 'deck'
  const typeFlt  = _sortsTypeFilter || '';        // '' | 'offensif' | 'defensif' | 'soin' | 'enchantement' | 'affliction' | 'utilitaire'
  const collapsed = _sortsCatCollapsed || {};     // { catId: true } = replié

  const DEFAULT_CAT = { id: '__none', nom: 'Sans catégorie', couleur: '#4f8cff' };
  const allCats = cats.length ? [...cats, DEFAULT_CAT] : [DEFAULT_CAT];

  // Stats globales avant filtre
  const deckCount = allSorts.filter(s => s.actif).length;
  const deckMax   = calcDeckMax(c);

  // ── Application des filtres : view + search + type ───────────────
  const matchSpell = (s) => {
    if (view === 'deck' && !s.actif) return false;
    if (search) {
      const hay = [
        s.nom || '', s.effet || '', s.noyau || '',
        ...(s.runes || []),
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (typeFlt) {
      const types = _getSortTypes(s);
      const runes = s.runes || [];
      if (typeFlt === 'soin' && !runes.includes('Protection')) return false;
      if (typeFlt === 'enchantement' && !runes.includes('Enchantement')) return false;
      if (typeFlt === 'affliction' && !runes.includes('Affliction')) return false;
      if (typeFlt === 'offensif' && !types.includes('offensif')) return false;
      if (typeFlt === 'defensif' && !types.includes('defensif')) return false;
      if (typeFlt === 'utilitaire' && !(types.includes('utilitaire') && !types.includes('offensif') && !types.includes('defensif'))) return false;
    }
    return true;
  };

  const sortsByCat = {};
  allCats.forEach(cat => { sortsByCat[cat.id] = []; });
  let visibleCount = 0;
  allSorts.forEach((s, globalIdx) => {
    const catId = s.catId && cats.find(cat => cat.id === s.catId) ? s.catId : '__none';
    const ok = matchSpell(s);
    sortsByCat[catId].push({ s, globalIdx, hidden: !ok });
    if (ok) visibleCount += 1;
  });

  // ── Header sticky : recherche + compteur Deck + actions ──────────
  const deckPct  = deckMax > 0 ? Math.min(100, (deckCount / deckMax) * 100) : 0;
  const deckOver = deckCount > deckMax;
  let html = `<div class="cs-section cs-section--compact cs-sorts-v3">

    <!-- Toolbar sticky : recherche + compteur deck + actions -->
    <div class="cs-sorts-toolbar">
      <div class="cs-sorts-search-wrap">
        <span class="cs-sorts-search-ico">🔍</span>
        <input type="text" class="cs-sorts-search" id="cs-sorts-search"
          placeholder="Rechercher (nom, effet, rune)…"
          value="${_esc(_sortsSearch || '')}"
          data-input="_sortsSearchInput">
        ${search ? `<button class="cs-sorts-search-clear" data-action="_sortsSetSearch" data-val="" title="Effacer">✕</button>` : ''}
      </div>
      <div class="cs-sorts-deck ${deckOver?'is-over':''}" title="Sorts actifs / capacité du deck (INT)">
        <span class="cs-sorts-deck-lbl">Deck</span>
        <span class="cs-sorts-deck-val">${deckCount}<small>/${deckMax}</small></span>
        <span class="cs-sorts-deck-bar"><span style="width:${deckPct}%"></span></span>
      </div>
      <div class="cs-sorts-actions">
        ${canEdit ? `<button class="btn btn-gold btn-sm" data-action="addSort" title="Créer un sort">＋ Sort</button>` : ''}
        ${canEdit ? `<button class="btn btn-outline btn-sm" data-action="openSortCatEditor" title="Gérer les catégories">📂</button>` : ''}
        ${cats.length ? `<button class="btn btn-outline btn-sm" data-action="_sortsToggleAllCats" title="Plier/déplier toutes les catégories">⇕</button>` : ''}
      </div>
    </div>

    <!-- Filtres rapides -->
    <div class="cs-sorts-filters">
      <div class="cs-sorts-filt-grp">
        <button class="cs-sorts-chip ${view==='all'?'on':''}"  data-action="_sortsSetView" data-view="all">Tous (${allSorts.length})</button>
        <button class="cs-sorts-chip ${view==='deck'?'on':''}" data-action="_sortsSetView" data-view="deck">⚡ Deck (${deckCount})</button>
      </div>
      <div class="cs-sorts-filt-grp">
        <button class="cs-sorts-chip type ${typeFlt===''?'on':''}"            data-action="_sortsSetType" data-type="">Toutes</button>
        <button class="cs-sorts-chip type off  ${typeFlt==='offensif'?'on':''}"     data-action="_sortsSetType" data-type="offensif">⚔️ Off</button>
        <button class="cs-sorts-chip type def  ${typeFlt==='defensif'?'on':''}"     data-action="_sortsSetType" data-type="defensif">🛡️ Def</button>
        <button class="cs-sorts-chip type soin ${typeFlt==='soin'?'on':''}"         data-action="_sortsSetType" data-type="soin">💚 Soin</button>
        <button class="cs-sorts-chip type ench ${typeFlt==='enchantement'?'on':''}" data-action="_sortsSetType" data-type="enchantement">✨ Ench.</button>
        <button class="cs-sorts-chip type aff  ${typeFlt==='affliction'?'on':''}"   data-action="_sortsSetType" data-type="affliction">⛓ Aff.</button>
        <button class="cs-sorts-chip type util ${typeFlt==='utilitaire'?'on':''}"   data-action="_sortsSetType" data-type="utilitaire">🔧 Util.</button>
      </div>
    </div>

    <!-- Bandeau Set Léger (PM offset) -->
    ${pmDelta !== 0 ? `<div class="cs-sort-pm-bar">
      <span>🧙</span>
      <span class="cs-sort-pm-bar-label">Set Léger</span>
      <span class="cs-sort-pm-bar-arrow">→ coût des sorts</span>
      <span class="cs-sort-pm-bar-val">${pmDelta > 0 ? '+' : ''}${pmDelta} PM</span>
      <span class="cs-sort-pm-bar-note">(appliqué automatiquement)</span>
    </div>` : ''}`;

  // ── État vide / aucun résultat ───────────────────────────────────
  if (allSorts.length === 0) {
    html += `<div class="cs-empty">🔮 Aucun sort créé</div></div>`;
    return html;
  }
  if (visibleCount === 0) {
    html += `<div class="cs-sorts-noresult">
      <span style="font-size:1.4rem">🔎</span>
      <div>
        <div style="font-weight:700">Aucun sort ne correspond</div>
        <div style="font-size:.74rem;color:var(--text-dim);margin-top:2px">
          ${search ? `« ${_esc(search)} » ${typeFlt?' · '+typeFlt:''}${view==='deck'?' · Deck uniquement':''}` : 'Essaie un autre filtre'}
        </div>
      </div>
      <button class="btn btn-outline btn-sm" data-action="_sortsResetFilters">Réinitialiser</button>
    </div></div>`;
    return html;
  }

  // ── Liste catégorisée avec catégories repliables ─────────────────
  html += `<div class="cs-sort-cats-wrap" id="cs-sort-cats-wrap">`;
  allCats.forEach(cat => {
    const entries = sortsByCat[cat.id] || [];
    const visibleEntries = entries.filter(e => !e.hidden);
    if (!visibleEntries.length) return;
    const isDefault = cat.id === '__none';
    const isCollapsed = !!collapsed[cat.id];
    const activeInCat = visibleEntries.filter(e => e.s.actif).length;

    html += `<div class="cs-sort-cat-block ${isDefault?'is-default':''} ${isCollapsed?'is-collapsed':''}" data-cat-id="${cat.id}">`;
    if (cats.length > 0) {
      html += `<div class="cs-sort-cat-hdr" style="--cat-col:${cat.couleur}"
          data-action="_sortsToggleCat" data-id="${cat.id}">
        ${(!isDefault && canEdit) ? `<span class="cs-sort-cat-drag" title="Glisser pour réordonner" data-stop-propagation>⠿</span>` : ''}
        <span class="cs-sort-cat-chev">${isCollapsed?'▸':'▾'}</span>
        <span class="cs-sort-cat-name">${_esc(cat.nom)}</span>
        <span class="cs-sort-cat-count">${visibleEntries.length} sort${visibleEntries.length>1?'s':''} · ${activeInCat} actif${activeInCat>1?'s':''}</span>
      </div>`;
    }
    if (!isCollapsed) {
      html += `<div class="cs-sort-list" data-cat="${cat.id}">`;
      visibleEntries.forEach(({ s, globalIdx: i }) => {
        html += _renderSortRow(s, i, openIdx, canEdit, armeDeg, c, pmDelta);
      });
      html += `</div>`;
    }
    html += `</div>`;  // /cat-block
  });
  html += `</div>`;  // /cats-wrap

  html += `</div>`;
  return html;
}

// ── Handlers UI (search / filtres / pliage) ─────────────────────────
function _sortsRerender() {
  _renderSpellsTab();
}
function _sortsSetSearch(v) {
  _sortsSearch = v || '';
  _sortsRerender();
  // Re-focus + caret restaurés
  requestAnimationFrame(() => {
    const el = document.getElementById('cs-sorts-search');
    if (el) {
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
    }
  });
}
function _sortsSetView(v) {
  _sortsView = (v === 'deck') ? 'deck' : 'all';
  _sortsRerender();
}
function _sortsSetType(t) {
  _sortsTypeFilter = t || '';
  _sortsRerender();
}
function _sortsToggleCat(catId) {
  _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}) };
  _sortsCatCollapsed[catId] = !_sortsCatCollapsed[catId];
  _sortsRerender();
}
function _sortsToggleAllCats() {
  const c = _getCurrentSpellChar(); if (!c) return;
  const cats = c.sort_cats || [];
  const all = [...cats.map(cat => cat.id), '__none'];
  const cur = _sortsCatCollapsed || {};
  const anyOpen = all.some(id => !cur[id]);
  const next = {};
  all.forEach(id => { next[id] = anyOpen; });   // si au moins 1 ouvert → tout plier; sinon tout déplier
  _sortsCatCollapsed = next;
  _sortsRerender();
}
function _sortsResetFilters() {
  _sortsSearch = '';
  _sortsView = 'all';
  _sortsTypeFilter = '';
  _sortsRerender();
}

function _renderSortRow(s, i, openIdx, canEdit, armeDeg, c, pmDelta = 0) {
  const isOpen   = openIdx === i;
  const runesAll = s.runes || [];
  const types    = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);
  const nbCibles = _calcSortCibles(s);
  const nbProt   = runesAll.filter(r => r === 'Protection').length;

  const ACTION_CFG = {
    action:       { label:'⚡ Act.',   color:'#e8b84b' },
    action_bonus: { label:'✴️ Bonus', color:'#f97316' },
    reaction:     { label:'🔄 Réac.', color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action] || ACTION_CFG.action;

  // Modificateur de l'arme principale + maîtrise (Poings 2d4+Force si vide)
  const mainP   = getMainWeapon(c);
  const statKey = mainP.statAttaque || mainP.toucherStat || 'force';
  const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
  const statMod = Math.floor((Math.min(22, statVal) - 10) / 2);
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
  const statModS = statMod >= 0 ? `+${statMod}` : `${statMod}`;
  const maitrise = _getMaitriseBonus(c, mainP || {});

  // ── Détection des modes "sans dégâts d'impact" ─────────────────────
  const hasEnchant    = runesAll.includes('Enchantement');
  const hasAffliction = runesAll.includes('Affliction');
  const enchantMode   = s.enchantMode || 'dmg';
  const afflictionMode = s.afflictionMode || 'dot';
  // Enchantement-only : pas de dégâts d'impact si pas de degats explicite
  const isEnchantOnly = hasEnchant && !((s.degats || '').trim());
  // Affliction = jamais d'impact (comme défini côté VTT)
  const suppressImpactDmg = isEnchantOnly || hasAffliction;

  // Chips clés pour la ligne compacte
  const chips = [];

  // ── 1. Dégâts d'impact (offensif standard) ──
  if (types.includes('offensif') && !suppressImpactDmg) {
    const degBase = _calcSortDegats(s, c);
    let val = degBase;
    if (statMod !== 0) val += ` · ${statLbl}${statModS}`;
    chips.push({ icon:'⚔️', val, color:'#ff6b6b' });
  }

  // ── 2. Affliction : mode décide, JAMAIS de fallback DoT en mode État ──
  if (hasAffliction) {
    if (afflictionMode === 'etat') {
      // Mode État : on affiche TOUJOURS un chip état, jamais DoT
      const etat = s.afflictionEtatId
        ? _conditionsLibCache?.find(c2 => c2.id === s.afflictionEtatId)
        : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ État non défini';
      chips.push({ icon:'⛓', val: lbl, color:'#8b5cf6' });
    } else {
      // Mode DoT : formule scalée
      const dot = _calcAfflictionDot(s);
      chips.push({ icon:'🩸', val: `${dot}/t`, color:'#8b5cf6' });
    }
  }

  // ── 3. Enchantement : mode décide, JAMAIS de fallback dégâts en mode État ──
  if (hasEnchant) {
    if (enchantMode === 'etat') {
      const etat = s.enchantEtatId
        ? _conditionsLibCache?.find(c2 => c2.id === s.enchantEtatId)
        : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ État non défini';
      chips.push({ icon:'✨', val: lbl, color:'#e8b84b' });
    } else {
      // Mode Dégâts : formule bonus sur arme alliée
      const degAuto = _calcEnchantDegats(s);
      if (degAuto) chips.push({ icon:'✨', val: `+${degAuto}`, color:'#e8b84b' });
    }
  }

  // ── 4. Protection (CA ou Soin) ──
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    const activeIds = new Set(_activeCombos(s).map(co => co.id));
    if (mode === 'soin') {
      if (activeIds.has('drain')) {
        const pct = Math.round(_calcDrainPct(s) * 100);
        chips.push({ icon:'🩸', val: `Drain ${pct}%`, color:'#ff6b6b' });
      } else {
        const soinBase = _calcSortSoin(s, c);
        chips.push({ icon:'💚', val: soinBase, color:'#22c38e' });
      }
    } else {
      if (activeIds.has('bouclier_reactif')) {
        chips.push({ icon:'🛡️', val:'Bloque 1', color:'#22c38e' });
      } else {
        chips.push({ icon:'🛡️', val:_getSortCA(s), color:'#22c38e' });
      }
    }
  }

  // ── 5. Cibles / zone / déplacement / durée ──
  if (nbCibles > 1) chips.push({ icon:'🎯', val:`×${nbCibles}`, color:'#4f8cff' });
  const zone  = _calcSortZone(s);
  if (zone)  chips.push({ icon:'📐', val:`${zone.w}×${zone.h}m`, color:'#b47fff' });
  const depl  = _calcSortDeplacement(s);
  if (depl)  chips.push({ icon: depl.mode==='push' ? '↗' : '↙', val:`${depl.distance}m`, color:'#e8b84b' });
  // Durée : affichée uniquement pour les sorts persistants
  if (_needsDureeBase(s)) {
    const duree = _calcSortDuree(s);
    if (duree) chips.push({ icon:'⏱️', val:`${duree}t`, color:'#9ca3af' });
  }

  // ── 6. Pill JS sauvegarde pour Affliction (info utile au combat) ──
  if (hasAffliction) {
    const nbAff = runesAll.filter(r => r === 'Affliction').length;
    const dd = 11 + 3 * (nbAff - 1);
    chips.push({ icon:'🛡', val:`DD ${dd}`, color:'#ef4444' });
  }

  const pmVal = pmDelta !== 0
    ? `<span class="cs-sort-pm-old">${s.pm||0}</span><span class="cs-sort-pm-new">${Math.max(0,(s.pm||0)+pmDelta)}</span>`
    : `${s.pm||0}`;

  const typeCol = types.includes('offensif') ? '#ff6b6b'
                : types.includes('defensif')  ? '#22c38e'
                : '#b47fff';

  return `<div class="cs-sort-row ${s.actif?'actif':''}" style="--sort-type-col:${typeCol}"
    draggable="true" data-sort-idx="${i}"
    ondragstart="sortDragStart(event,${i})"
    ondragover="sortDragOver(event)"
    ondrop="sortDrop(event,${i})"
    ondragend="sortDragEnd(event)">

    <!-- Ligne unique compacte -->
    <div class="cs-sort-compact" data-action="toggleSortDetail" data-idx="${i}">
      <div class="toggle ${s.actif?'on':''}"
        ${canEdit ? `data-action="toggleSort" data-idx="${i}" data-stop-propagation` : ''}
        title="${s.actif?'Désactiver':'Activer'}"></div>
      <span class="cs-sort-compact-nom">${s.icon ? `<span class="cs-sort-icon" title="Icône du sort">${_esc(s.icon)}</span> ` : ''}${_esc(s.nom||'Sans nom')}</span>
      ${(() => {
        const vs = s.mjValidation || (s.mjValidated ? 'ok' : 'pending');
        return vs === 'ok'
          ? `<span class="cs-sort-status cs-sort-status--ok" title="Sort validé par le Maître du Jeu">✅ Validé</span>`
          : vs === 'no'
            ? `<span class="cs-sort-status cs-sort-status--no" title="Sort refusé par le Maître du Jeu">❌ Refusé</span>`
            : `<span class="cs-sort-status cs-sort-status--wait" title="Pas encore validé par le Maître du Jeu">⏳ À valider</span>`;
      })()}
      <div class="cs-sort-compact-chips">
        ${chips.map(ch => `<span class="cs-sort-sstat" style="--c:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('')}
        <span class="cs-sort-sstat cs-sort-sstat--dim" style="--c:${acfg.color}">${acfg.label}</span>
        ${concentration ? `<span class="cs-sort-sstat cs-sort-sstat--dim" style="--c:#60a5fa">🧠</span>` : ''}
      </div>
      <span class="cs-sort-compact-pm">${pmVal} PM</span>
      ${canEdit ? `<div class="cs-sort-compact-acts" data-stop-propagation>
        <button class="btn-icon" data-action="editSort" data-idx="${i}">✏️</button>
        <button class="btn-icon" data-action="deleteSort" data-idx="${i}">🗑️</button>
      </div>` : ''}
      <span class="cs-sort-compact-chev">${isOpen?'▲':'▼'}</span>
    </div>

    <!-- Description toujours visible (clamped 2 lignes) -->
    ${s.effet ? `<div class="cs-sort-desc-preview" data-action="toggleSortDetail" data-idx="${i}">${_esc(s.effet)}</div>` : ''}

    <!-- Panneau déroulant : détails techniques complets -->
    ${isOpen ? `<div class="cs-sort-expand">
      ${s.effet ? `<div class="cs-sort-expand-desc">${_nl2br(_esc(s.effet))}</div>` : ''}
      ${s.noyau || runesAll.length ? `<div class="cs-sort-expand-meta">
        ${s.noyau ? `<span class="cs-sort-dl-label">Noyau</span><span>${_esc(s.noyau)}</span>` : ''}
        ${runesAll.length ? `<span class="cs-sort-dl-label" style="margin-left:.65rem">Runes (${runesAll.length})</span><span>${runesAll.join(' · ')}</span>` : ''}
      </div>` : ''}
      <div class="cs-sort-detail-effects">
        <div class="cs-sort-detail-effects-title">📋 Effets calculés</div>
        ${_buildSortResume(s, c).map(line => `
          <div class="cs-sort-detail-effect-row">
            <span class="cs-sort-detail-icon">${line.icon}</span>
            <span class="cs-sort-detail-label">${line.label}</span>
            ${line.detail ? `<span class="cs-sort-detail-meta">${line.detail}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

// ── Catégories de sorts ───────────────────────────────────────────────────────
export function openSortCatEditor() {
  const c    = STATE.activeChar; if (!c) return;
  const cats = c.sort_cats || [];
  const COLORS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b','#9ca3af'];

  openModal('📂 Catégories de sorts', `
    <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.75rem">
      Crée des catégories pour organiser tes sorts. Glisse les sorts d'une catégorie à l'autre depuis la liste.
    </div>
    <div id="sort-cats-list" style="display:flex;flex-direction:column;gap:.4rem">
      ${cats.map((cat, i) => `
      <div style="display:flex;align-items:center;gap:.5rem;background:var(--bg-elevated);
        border-radius:8px;padding:.5rem .7rem;border:1px solid var(--border)">
        <div style="width:12px;height:12px;border-radius:50%;background:${cat.couleur};flex-shrink:0"></div>
        <span style="flex:1;font-size:.84rem;color:var(--text)">${cat.nom}</span>
        <button class="btn-icon" style="font-size:.72rem" data-action="_editSortCat" data-idx="${i}">✏️</button>
        <button class="btn-icon" style="font-size:.72rem;color:#ff6b6b" data-action="_delSortCat" data-idx="${i}">🗑️</button>
      </div>`).join('')}
      ${cats.length === 0 ? `<div style="text-align:center;padding:1rem;color:var(--text-dim);font-size:.8rem;font-style:italic">Aucune catégorie</div>` : ''}
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.75rem">
      ${COLORS.map(col => `<button data-action="_addSortCat" data-col="${col}"
        style="width:28px;height:28px;border-radius:50%;background:${col};border:2px solid transparent;
        cursor:pointer;transition:transform .1s" onmouseover="this.style.transform='scale(1.2)'"
        onmouseout="this.style.transform=''" title="Créer une catégorie ${col}"></button>`).join('')}
      <span style="font-size:.75rem;color:var(--text-dim);align-self:center;margin-left:.25rem">← clique pour créer</span>
    </div>
    <button class="btn btn-outline btn-sm" style="width:100%;margin-top:.75rem" data-action="close-modal">Fermer</button>
  `);
}

async function _addSortCat(couleur) {
  const nom = prompt('Nom de la catégorie :');
  if (!nom?.trim()) return;
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  cats.push({ id: `cat_${Date.now()}`, nom: nom.trim(), couleur });
  c.sort_cats = cats;
  await updateInCol('characters', c.id, { sort_cats: cats });
  showNotif('Catégorie créée !', 'success');
  openSortCatEditor();
  _renderSpellsTab(c);
}

async function _editSortCat(idx) {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  const nom = prompt('Renommer :', cats[idx].nom);
  if (!nom?.trim()) return;
  cats[idx].nom = nom.trim();
  c.sort_cats = cats;
  await updateInCol('characters', c.id, { sort_cats: cats });
  openSortCatEditor();
  _renderSpellsTab(c);
}

async function _delSortCat(idx) {
  const c = STATE.activeChar; if (!c) return;
  const cats  = [...(c.sort_cats || [])];
  const catId = cats[idx].id;
  // Retirer la catégorie des sorts qui l'avaient
  const sorts = (c.deck_sorts || []).map(s => s.catId === catId ? { ...s, catId: '' } : s);
  cats.splice(idx, 1);
  c.sort_cats  = cats;
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, { sort_cats: cats, deck_sorts: sorts });
  showNotif('Catégorie supprimée.', 'success');
  openSortCatEditor();
  _renderSpellsTab(c);
}


export function toggleSortDetail(idx) {
  _openSortIdx = _openSortIdx === idx ? null : idx;
  _renderSpellsTab();
}


// ── Éditeur de sorts ──────────────────────────────────────────────────────────
// Contexte d'édition : null = sort de perso (STATE.activeChar.deck_sorts)
// sinon { item, idx, onSave } = sort embarqué dans un item de boutique.
// saveSort() lit ce contexte pour aiguiller la sauvegarde.
let _itemEditCtx = null;

export function addSort() { _itemEditCtx = null; openSortModal(-1, {}); }
export function editSort(idx) { _itemEditCtx = null; openSortModal(idx, (STATE.activeChar?.deck_sorts||[])[idx]); }

/** Ouvre la modal de sort pour éditer une action d'objet.
 *  item   : l'objet portant les actions
 *  idx    : index dans item.actions (-1 pour ajout)
 *  onSave : callback async(item) appelé après la sauvegarde — doit persister l'item
 *  charForCalc : perso optionnel pour les calculs d'aperçu (sinon null) */
export function editItemSpell(item, idx, onSave, charForCalc = null) {
  // Le perso de calcul est porté par le contexte (_itemEditCtx.charForCalc) et
  // résolu via _modalChar() : aucune mutation de STATE.activeChar.
  _itemEditCtx = { item, idx, onSave, charForCalc };
  const action = idx >= 0 ? (item.actions || [])[idx] || {} : {};
  openSortModal(idx, action);
}

/** Perso contextuel de la modale de sort en cours d'édition.
 *  - Édition d'un sort de perso : le perso actif global.
 *  - Édition d'une action d'item (boutique) : le perso de calcul passé à
 *    editItemSpell, sinon le perso actif en repli.
 *  Source unique pour tous les calculs/preview de la modale — supprime la
 *  substitution fragile de STATE.activeChar. */
function _modalChar() {
  return _itemEditCtx?.charForCalc ?? STATE.activeChar ?? null;
}
export function addItemSpell(item, onSave, charForCalc = null) {
  return editItemSpell(item, -1, onSave, charForCalc);
}

let _openSortIdx = -1;

// ── Métadonnées des runes ────────────────────────────────────────────────────
// Centralisé pour qu'un seul endroit définisse icône, couleur, effet de base et famille
const RUNE_META = [
  { nom:'Puissance',     icon:'⚔️', color:'#ef4444', family:'puissance', effet:'+1 dé de dégâts' },
  { nom:'Protection',    icon:'💚', color:'#22c38e', family:'puissance', effet:'+1d4 soin OU +2 CA (2 tours)' },
  { nom:'Amplification', icon:'🌐', color:'#4f8cff', family:'portee',    effet:'Zone +3 mètres' },
  { nom:'Dispersion',    icon:'🎯', color:'#a855f7', family:'portee',    effet:'Touche plusieurs cibles (1 → 2 → 4 → 6…)' },
  { nom:'Enchantement',  icon:'✨', color:'#e8b84b', family:'soutien',   effet:'Élément sur arme alliée · 2 tours · Action Bonus' },
  { nom:'Affliction',    icon:'💀', color:'#8b5cf6', family:'soutien',   effet:'Élément + état sur arme ennemie · 2 tours · Action Bonus' },
  { nom:'Invocation',    icon:'🐾', color:'#a16207', family:'soutien',   effet:'Créature liée · 10 PV, CA 10' },
  { nom:'Lacération',    icon:'🩸', color:'#dc2626', family:'soutien',   effet:'CA cible −1 (max −2 / −4 Élite-Boss)' },
  { nom:'Chance',        icon:'🍀', color:'#facc15', family:'soutien',   effet:'RC 19–20 (critique max)' },
  { nom:'Durée',         icon:'⏱️', color:'#06b6d4', family:'meta',      effet:'+2 tours' },
  { nom:'Concentration', icon:'🧠', color:'#6366f1', family:'meta',      effet:'Maintien hors tour · JS Sa DD 11 si touché' },
  { nom:'Réaction',      icon:'🔄', color:'#ec4899', family:'meta',      effet:'Lance hors de son tour' },
];

const RUNE_GROUPS = [
  { id:'puissance', title:'⚔️ Puissance brute',    desc:'Dégâts et défense' },
  { id:'portee',    title:'🎯 Portée & cibles',    desc:'Zone et nombre de cibles' },
  { id:'soutien',   title:'✨ Soutien & contrôle', desc:'Buffs, debuffs et invocations' },
  { id:'meta',      title:'⏱️ Méta',              desc:'Timing et durée' },
];

/**
 * Décrit la contribution actuelle d'une rune en clair, avec info de chaînage.
 * IMPORTANT : le chaînage est PAR RUNE (même nom), jamais croisé.
 *   - Puissance ×N seul → chaîné si N≥2 : +(N-1)*2 dégâts fixes
 *   - Protection ×N seul → chaîné si N≥2 : +(N-1)*2 soin ou +(N-1) CA fixes
 *   - Puissance + Protection séparés → COMBO Drain (signalé ailleurs), pas un chaînage
 */
function _runeLiveContribution(nom, counts) {
  const cnt = counts[nom] || 0;
  if (cnt === 0) return null;

  switch (nom) {
    case 'Puissance': {
      const chain = cnt > 1 ? (cnt - 1) * 2 : 0;
      return {
        main:  `+${cnt} dé${cnt>1?'s':''} de dégâts · sur 1 cible`,
        chain: chain ? `🔗 Chaîné +${chain} dégâts fixes (Puissance ×${cnt})` : null,
      };
    }
    case 'Protection': {
      const chainSoin = cnt > 1 ? (cnt - 1) * 2 : 0;
      const chainCA   = cnt > 1 ? (cnt - 1)     : 0;
      // Contexte : lit le mode et la présence de Réaction pour adapter le label
      const protMode = (typeof document !== 'undefined'
        ? document.getElementById('s-prot-mode')?.value : null) || 'ca';
      const hasReac = (counts.Réaction || 0) > 0;
      // Combo Bouclier réactif (Réa + Prot mode CA) : pas de soin, blocage 1 attaque
      if (hasReac && protMode === 'ca') {
        const tier = cnt >= 3 ? 'Boss ou inférieur' : cnt === 2 ? 'Élite ou inférieur' : 'Mob classique';
        return {
          main:  `Combo Bouclier réactif · Bloque 1 attaque entrante · plafond ${tier}`,
          chain: cnt > 1 ? `🔗 Augmente le tier d'ennemi qu'on peut bloquer (Protection ×${cnt})` : null,
        };
      }
      // Mode CA pur (sans Réaction)
      if (protMode === 'ca') {
        return {
          main:  `+${cnt*2} CA · sur 1 cible (2 tours)`,
          chain: cnt > 1 ? `🔗 Chaîné +${chainCA} CA (Protection ×${cnt})` : null,
        };
      }
      // Mode soin
      return {
        main:  `+${cnt}d4 soin · sur 1 cible`,
        chain: cnt > 1 ? `🔗 Chaîné +${chainSoin} soin (Protection ×${cnt})` : null,
      };
    }
    case 'Amplification': {
      const len = _ampLength(cnt);
      const nbDisp = counts['Dispersion'] || 0;
      const width  = 1 + nbDisp;
      const combo  = nbDisp > 0 ? ` · combo Dispersion → ${len}×${width}m` : '';
      return {
        main:  `Zone ${len}×1m${combo}`,
        chain: cnt > 1 ? `🔗 Chaîné +1m / rune au-delà de la 1ère (${3*cnt} base + ${cnt-1} chaînage)` : null,
      };
    }
    case 'Dispersion': {
      const nbAmp = counts['Amplification'] || 0;
      if (nbAmp > 0) {
        const len = _ampLength(nbAmp);
        return {
          main:  `Combo Amp+Disp → zone ${len}×${1+cnt}m (au lieu de cibles)`,
          chain: cnt > 1 ? `🔗 +1m largeur par rune Dispersion (×${cnt})` : null,
        };
      }
      return {
        main:  `${2*cnt} cibles différentes`,
        chain: cnt > 1 ? `🔗 Chaîné +1 cible/rune (Dispersion ×${cnt})` : null,
      };
    }
    case 'Lacération': {
      const red = 2*cnt - 1;
      return {
        main:  `CA cible −${red} · sur 1 cible`,
        chain: cnt > 1 ? `🔗 Chaîné +1 CA/rune · plafond −2 joueur / −4 Élite-Boss` : null,
      };
    }
    case 'Chance': {
      const rcLow = 21 - 2*cnt;
      return {
        main:  `Critique RC ${rcLow}–20 · dé de crit max`,
        chain: cnt > 1 ? `🔗 Chaîné +1 sur la plage RC (Chance ×${cnt})` : null,
      };
    }
    case 'Durée': {
      const bonus = cnt + 1; // ×1=2, ×2=3, ×3=4
      return {
        main:  `+${bonus} tour${bonus>1?'s':''} de durée`,
        chain: cnt > 1 ? `🔗 Chaîné +1 tour/rune (Durée ×${cnt})` : null,
      };
    }
    case 'Enchantement':
      return {
        main:  cnt === 1 ? 'Buff sur allié · 2 tours · Action Bonus' : `${cnt} cibles alliées · 2 tours`,
        chain: cnt > 1 ? `🔗 Chaîné +1 cible/rune (Enchantement ×${cnt})` : null,
      };
    case 'Affliction':
      return {
        main:  cnt === 1 ? 'Debuff sur ennemi · 2 tours · Action · JS pour résister' : `${cnt} cibles ennemies · 2 tours`,
        chain: cnt > 1 ? `🔗 Chaîné +1 cible/rune (Affliction ×${cnt})` : null,
      };
    case 'Invocation':
      return {
        main:  `${cnt} créature${cnt>1?'s':''} liée${cnt>1?'s':''} · 10 PV · CA 10`,
        chain: cnt > 1 ? `🔗 Chaîné +1 invocation/rune (Invocation ×${cnt})` : null,
      };
    case 'Concentration':
      return { main: 'Maintenu hors tour · JS Sa DD 11 si dégâts reçus', chain: null };
    case 'Réaction':
      return { main: 'Lancé hors de son tour', chain: null };
    default:
      return { main: `×${cnt}`, chain: null };
  }
}

/**
 * Rend la section runes complète :
 *   ① "Mes runes" — grosses cartes pour les runes actives, avec contrib live + chaînage
 *   ② "Ajouter une rune" — picker compact par famille
 * Re-appelée après chaque incrément/décrément pour rester synchro.
 */
function _renderRunesSection() {
  const counts = _runeCountsEdit || {};
  const activeMetas = RUNE_META.filter(r => (counts[r.nom] || 0) > 0);

  // ① Grosses cartes des runes actives
  const activeHtml = activeMetas.length ? activeMetas.map(r => {
    const cnt = counts[r.nom];
    const contrib = _runeLiveContribution(r.nom, counts);
    return `<div class="cs-rune-active" style="--rune-c:${r.color}">
      <div class="cs-rune-active-main">
        <div class="cs-rune-active-hdr">
          <span class="cs-rune-active-icon">${r.icon}</span>
          <span class="cs-rune-active-nom">${r.nom}</span>
          <span class="cs-rune-active-x">×${cnt}</span>
        </div>
        <div class="cs-rune-active-contrib">${contrib?.main || r.effet}</div>
        ${contrib?.chain ? `<div class="cs-rune-active-chain">${contrib.chain}</div>` : ''}
      </div>
      <div class="cs-rune-active-ctrl">
        <button type="button" class="cs-rune-btn minus" data-action="runeDecrement" data-nom="${r.nom}">−</button>
        <button type="button" class="cs-rune-btn plus"  data-action="runeIncrement" data-nom="${r.nom}">+</button>
      </div>
    </div>`;
  }).join('') : `<div class="cs-rune-active-empty">
    <span class="cs-rune-active-empty-icon">🔮</span>
    <span>Aucune rune sélectionnée. Choisis ci-dessous pour façonner ton sort.</span>
  </div>`;

  // ② Picker compact — n'affiche QUE les runes pas encore actives
  // (les actives sont gérées via leurs cartes en haut, plus de doublon = plus d'ambiguïté)
  const pickerGroups = RUNE_GROUPS.map(g => {
    const runesInGroup = RUNE_META.filter(r => r.family === g.id && !((counts[r.nom] || 0) > 0));
    if (runesInGroup.length === 0) return ''; // groupe vide = caché
    return `<div class="cs-rune-pick-group">
      <div class="cs-rune-pick-group-title">${g.title} <span>${g.desc}</span></div>
      <div class="cs-rune-pick-list">
        ${runesInGroup.map(r => `
          <button type="button" class="cs-rune-pick-item"
            style="--rune-c:${r.color}" data-action="runeIncrement" data-nom="${r.nom}"
            data-tip="${r.effet}" aria-label="Ajouter ${r.nom} — ${r.effet}">
            <span class="cs-rune-pick-icon">${r.icon}</span>
            <span class="cs-rune-pick-nom">${r.nom}</span>
            <span class="cs-rune-pick-add" aria-hidden="true">+</span>
          </button>
        `).join('')}
      </div>
    </div>`;
  }).filter(Boolean).join('');

  const pickerEmpty = pickerGroups === '';
  const pickerHtml = pickerEmpty
    ? `<div class="cs-runes-picker-empty">✓ Toutes les runes sont actives — utilise les boutons + sur les cartes ci-dessus pour empiler une même rune.</div>`
    : pickerGroups;

  return `
    <div class="cs-runes-active-list">${activeHtml}</div>
    <div class="cs-runes-picker">
      <div class="cs-runes-picker-hdr">+ Ajouter une rune <span>(les runes actives sont gérées via les cartes au-dessus)</span></div>
      ${pickerHtml}
    </div>
  `;
}

export async function openSortModal(idx, s) {
  const [allTypes, matrices] = await Promise.all([loadDamageTypes(), loadSpellMatrices()]);
  // Caches globaux utilisés par _getSortCA, _calcSortSoin, suggestions...
  _spellMatricesCache = matrices;
  _damageTypesCache   = allTypes;
  // Tous les types de dégâts restent la source globale des noyaux.
  // L'accès joueur aux noyaux magiques est ensuite filtré par personnage (c.elements).
  const RUNES = RUNE_META; // alias local pour compat ascendante

  const runesSrc = s?.runes||[];
  const runeCounts = {};
  runesSrc.forEach(r => { runeCounts[r] = (runeCounts[r]||0) + 1; });
  _runeCountsEdit = { ...runeCounts };

  // Noyau : id de type (nouveau) ou migration depuis label (ancien)
  let noyauTypeIdSel = s?.noyauTypeId || '';
  if (!noyauTypeIdSel && s?.noyau) {
    // Migration : chercher par label ou par label partiel (ex: 'Feu 🔥' → 'feu')
    const legacy = allTypes.find(n =>
      n.label === s.noyau ||
      s.noyau.toLowerCase().startsWith(n.label.toLowerCase())
    );
    noyauTypeIdSel = legacy?.id || '';
  }
  const charForAccess = _modalChar();
  const charElements  = new Set(charForAccess?.elements || []);
  const canUseAllNoyaux = STATE.isAdmin || !charForAccess;
  const allowedNoyaux = canUseAllNoyaux
    ? [...allTypes]
    : allTypes.filter(n => !n.isMagic || charElements.has(n.id));
  const selectedNoyau = noyauTypeIdSel ? allTypes.find(n => n.id === noyauTypeIdSel) : null;
  const selectedLocked = selectedNoyau && !allowedNoyaux.some(n => n.id === selectedNoyau.id);
  const NOYAUX = selectedLocked
    ? [...allowedNoyaux, { ...selectedNoyau, locked: true }]
    : allowedNoyaux;
  _sortAllowedNoyauIds = new Set(allowedNoyaux.map(n => n.id));

  const noyauSel      = noyauTypeIdSel
    ? (selectedNoyau?.label || s?.noyau || '')
    : (s?.noyau || '');
  // Pas de type par défaut sur un sort nouveau — l'utilisateur choisit. Compat legacy uniquement.
  const typesInit = Array.isArray(s?.types) ? s.types
    : (s?.typeSoin ? ['defensif'] : (s?.noyau ? ['offensif'] : []));

  _sortTypesEdit  = new Set(typesInit);
  _sortActionEdit = s?.actionOverride || null;
  _deplModeEdit   = s?.deplacement?.mode || null;

  const hasEnchant  = runesSrc.includes('Enchantement');
  const hasProt     = runesSrc.includes('Protection');

  // Le rendu réel des runes est fait par _renderRunesSection (module-level),
  // appelé au mount et après chaque incrément/décrément pour rester synchro.
  const runesSectionHtml = _renderRunesSection();

  const TYPE_CFG = [
    { v:'offensif',   label:'⚔️ Offensif',   color:'#ff6b6b' },
    { v:'defensif',   label:'🛡️ Défensif',   color:'#22c38e' },
    { v:'utilitaire', label:'✨ Utilitaire', color:'#b47fff' },
  ];
  const typeBtnsHtml = TYPE_CFG.map(t => {
    const isSel = typesInit.includes(t.v);
    return `<button type="button" id="s-type-${t.v}"
      data-action="_toggleSortType" data-type="${t.v}"
      style="flex:1;padding:.4rem .3rem;border-radius:8px;font-size:.75rem;cursor:pointer;
      border:2px solid ${isSel?t.color:'var(--border)'};
      background:${isSel?t.color+'20':'var(--bg-elevated)'};
      color:${isSel?t.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${t.label}</button>`;
  }).join('');

  const ACTION_CFG = [
    { v:null,           label:'Auto',            color:'#9ca3af' },
    { v:'action',       label:'⚡ Action',        color:'#e8b84b' },
    { v:'action_bonus', label:'✴️ Action Bonus',  color:'#f97316' },
  ];
  const actionBtnsHtml = ACTION_CFG.map(a => {
    const isSel = (_sortActionEdit === a.v);
    return `<button type="button" id="s-action-${a.v??'auto'}"
      data-action="_selectSortAction" data-val="${a.v??''}"
      style="flex:1;padding:.35rem .2rem;border-radius:7px;font-size:.7rem;cursor:pointer;
      border:2px solid ${isSel?a.color:'var(--border)'};
      background:${isSel?a.color+'20':'var(--bg-elevated)'};
      color:${isSel?a.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${a.label}</button>`;
  }).join('');

  const deplCur = s?.deplacement?.mode || null;
  const deplBtnsHtml = [
    { v:null,   label:'Aucun',    col:'#9ca3af' },
    { v:'push', label:'↗ Pousse', col:'#e8b84b' },
    { v:'pull', label:'↙ Attire', col:'#4f8cff' },
  ].map(opt => {
    const sel = deplCur === opt.v;
    return `<button type="button" id="s-depl-${opt.v??'none'}"
      data-action="_selectDeplMode" data-val="${opt.v??''}"
      style="flex:1;padding:.3rem .2rem;border-radius:7px;font-size:.7rem;cursor:pointer;transition:all .15s;
        border:2px solid ${sel?opt.col:'var(--border)'};
        background:${sel?opt.col+'20':'var(--bg-elevated)'};
        color:${sel?opt.col:'var(--text-dim)'};
        font-weight:${sel?'700':'400'}">${opt.label}</button>`;
  }).join('');

  // Si on édite une action d'item, on EMPILE la modal sur la modal du shop
  // (pushModal) pour pouvoir la restaurer après. Sinon openModal classique.
  const _modalOpen = _itemEditCtx ? pushModal : openModal;
  _modalOpen('', `
   <div class="sh-admin-modal is-spell">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">${idx>=0?'✏️':'✨'}</div>
      <div class="sh-admin-head-title">
        <h2>${idx>=0?'Modifier le sort':'Nouveau sort'}</h2>
        <small>Forge les runes, choisis le noyau élémentaire, affine les effets.</small>
      </div>
      <button class="sh-admin-close" data-action="closeModalDirect" title="Fermer">✕</button>
    </div>
    <div class="sh-admin-body">
     <div class="cs-spell-forge">
    <!-- ⓪ Aperçu live STICKY — toujours visible pendant l'édition -->
    <div class="cs-spell-preview cs-spell-preview--sticky">
      <div class="cs-spell-preview-title">📋 Aperçu — effets calculés <span class="cs-spell-preview-pm">Coût : <strong id="s-pm-display">0</strong> PM</span></div>
      <div id="s-preview-body" class="cs-spell-preview-body"></div>
      <input type="hidden" id="s-pm" value="${s?.pm||2}">
    </div>

    <!-- ① Identité — bandeau aligné (icône + nom + catégorie) -->
    <div class="cs-spell-identity">
      <div class="cs-spell-identity-field"><label>Icône</label>
        <button type="button" id="s-icon-btn" class="cs-spell-icon-btn"
          data-action="_toggleSortIconPicker"
          title="Cliquer pour choisir une icône">${s?.icon || '🔮'}</button>
        <input type="hidden" id="s-icon" value="${s?.icon||''}">
        <div id="s-icon-picker" class="cs-spell-icon-picker" style="display:none"></div>
      </div>
      <div class="cs-spell-identity-field cs-spell-identity-field--name"><label>Nom du sort</label>
        <input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu, Vague de soin…">
      </div>
      <div class="cs-spell-identity-field"><label>Catégorie</label>
        <select class="input-field" id="s-catid">
          <option value="">— Aucune —</option>
          ${(_modalChar()?.sort_cats||[]).map(cat =>
            `<option value="${cat.id}" ${s?.catId===cat.id?'selected':''}>${cat.nom}</option>`
          ).join('')}
        </select>
      </div>
    </div>

   <!-- ═══ GRILLE 2 COLONNES (desktop) — gauche: construction · droite: méta/utilitaires ═══ -->
   <div class="cs-spell-grid">
    <div class="cs-spell-grid-col cs-spell-grid-col--left">
    <!-- ② Type — bande inline (déselectable, plusieurs possibles, optionnel) -->
    <div class="cs-spell-inline-row">
      <span class="cs-spell-inline-label" title="Optionnel · plusieurs possibles · cliquer pour activer/désactiver">🏷️ Type</span>
      <div style="display:flex;gap:.25rem;flex:1">${typeBtnsHtml}</div>
    </div>

    <!-- ③ Noyau — section visuelle dédiée -->
    <div class="cs-spell-section cs-spell-section--noyau">
      <div class="cs-spell-section-title">🌀 Rune noyau élémentaire <span class="cs-spell-section-hint">cœur du sort · 2 PM · obligatoire</span></div>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.length ? NOYAUX.map(n => {
          const selected = noyauTypeIdSel === n.id;
          const locked = !!n.locked;
          const selectedStyle = selected ? `border-color:${n.color};background:${n.color}20;color:${n.color}` : '';
          const attrs = locked
            ? `title="Ce noyau n'est plus accessible à ce personnage" aria-disabled="true"`
            : `data-action="selectNoyau" data-noyau-label="${_esc(n.label+' '+n.icon)}" data-noyau-color="${n.color}" title="Choisir ${n.label}"`;
          const lockedBadge = locked ? '<span class="cs-noyau-lock">non accessible</span>' : '';
          return `<div class="cs-noyau-btn ${selected?'selected':''}${locked?' cs-noyau-btn--locked':''}" style="${selectedStyle}" ${attrs} data-noyau-id="${n.id}">${n.icon} ${n.label}${lockedBadge}</div>`;
        }).join('') : '<div class="cs-noyau-empty">Aucun noyau accessible. Demande au MJ de débloquer un élément sur ta fiche.</div>'}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
      <input type="hidden" id="s-noyau-id" value="${noyauTypeIdSel}">
      <div id="s-noyau-error" class="cs-spell-field-error" hidden>Sélectionne une rune noyau pour enregistrer ce sort.</div>
    </div>

    <!-- ④ Runes — Forge -->
    <div class="cs-spell-section cs-spell-section--runes">
      <div class="cs-spell-section-title">🔮 Runes <span class="cs-spell-section-hint">+2 PM par rune · cumulables · chaînage par même rune</span></div>
      <div id="cs-runes-section">${runesSectionHtml}</div>
    </div>

    <!-- ⑤ Champs conditionnels auto-affichés -->

    <!-- Dégâts — visible si type offensif (auto-val avec toggle Custom) ;
         masqué quand Affliction est présente (la Puissance scale le DoT à la place) -->
    <div id="s-degats-section" style="${(typesInit.includes('offensif') && !runesSrc.includes('Affliction'))?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-degats',
        label: '⚔️ Dégâts',
        autoValue:  _calcSortDegats(s || {}, _modalChar()),
        autoSource: _autoSourceDegats(s || {}, _modalChar()),
        currentValue: s?.degats,
        placeholder: 'ex : 3d8 +2, 2d10 Feu… (vide = formule auto)',
        // Mode Custom : la formule ET les stats sont éditables ensemble.
        extraEdit: {
          hasOverride: !!(s?.toucherStat || s?.degatsStat),
          html: `
            <div class="cs-spell-stats-grid">
              <div>
                <span class="cs-spell-stats-tag">🎯 Toucher</span>
                <select class="input-field" id="s-toucher-stat">
                  ${_SPELL_STAT_OPTIONS(s?.toucherStat)}
                </select>
              </div>
              <div>
                <span class="cs-spell-stats-tag">⚔️ Dégâts</span>
                <select class="input-field" id="s-degats-stat" data-change="_refreshAutoValChips">
                  ${_SPELL_STAT_OPTIONS(s?.degatsStat)}
                </select>
              </div>
            </div>`,
        },
      })}
    </div>

    <!-- Protection — visible si rune Protection > 0 -->
    <div id="s-prot-section" style="${hasProt?'':'display:none'}">
      <div class="form-group">
        <label>Rune Protection — effet</label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'ca',   label:'🛡️ Augmente la CA', color:'#22c38e', detail:'+2 CA · 2 tours' },
            { v:'soin', label:'💚 Soigne',           color:'#4f8cff', detail:'+1d4 par rune'  },
          ].map(opt => {
            const sel = (s?.protectionMode || 'ca') === opt.v;
            return `<button type="button" id="s-prot-${opt.v}" data-action="_selectProtMode" data-val="${opt.v}"
              style="flex:1;padding:.45rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.78rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.65rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-prot-mode" value="${s?.protectionMode||'ca'}">
      </div>
      <div id="s-ca-section" style="${(s?.protectionMode||'ca')==='ca'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-ca',
          label: '🛡️ Effet CA',
          autoValue:  _getSortCA(s || {}),
          autoSource: _autoSourceCA(s || {}),
          currentValue: s?.ca,
          placeholder: 'ex : CA +3, Bouclier magique +2…',
        })}
      </div>
    </div>

    <!-- Soin — visible UNIQUEMENT si Protection en mode soin (jamais en mode CA, évite la confusion avec Bouclier réactif).
         Si le sort est aussi Offensif, on n'expose PAS le sélecteur de stat ici (déjà dans Dégâts). -->
    <div id="s-soin-section" style="${(hasProt && (s?.protectionMode||'ca')==='soin')?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-soin',
        label: '💚 Soin',
        autoValue:  _calcSortSoin(s || {}, _modalChar()),
        autoSource: _autoSourceSoin(s || {}),
        currentValue: s?.soin,
        placeholder: 'ex : 3d6 +2, moitié des dégâts… (vide = formule auto)',
        extraEdit: typesInit.includes('offensif') ? null : {
          hasOverride: !!s?.degatsStat,
          html: `
            <div class="cs-spell-stats-grid one">
              <div>
                <span class="cs-spell-stats-tag">💚 Stat de soin</span>
                <select class="input-field" id="s-degats-stat-soin" data-change="_refreshAutoValChips">
                  ${_SPELL_STAT_OPTIONS(s?.degatsStat)}
                </select>
              </div>
            </div>`,
        },
      })}
    </div>

    <!-- Enchantement — visible si rune Enchantement > 0 -->
    <div id="s-enchant-section" class="cs-spell-slot-box cs-spell-slot-box--ench" style="${hasEnchant?'':'display:none'}">
      <div class="cs-spell-slot-title">✨ Enchantement <span>Cible alliée · 2 tours · Action Bonus</span></div>

      <!-- Mode toggle : Dégâts (bonus arme) vs État (buff sur allié) -->
      <div class="form-group">
        <label>Mode</label>
        <div class="cs-slot-grid" style="grid-template-columns:1fr 1fr">
          <button type="button" id="s-enchant-mode-dmg"
            data-action="_selectEnchantMode" data-val="dmg"
            class="cs-slot-btn ${(s?.enchantMode||'dmg')==='dmg'?'selected':''}">⚔️ Bonus dégâts arme</button>
          <button type="button" id="s-enchant-mode-etat"
            data-action="_selectEnchantMode" data-val="etat"
            class="cs-slot-btn ${s?.enchantMode==='etat'?'selected':''}">✨ État sur allié</button>
        </div>
        <input type="hidden" id="s-enchant-mode" value="${s?.enchantMode||'dmg'}">
      </div>

      <!-- Mode Dégâts : formule des dégâts bonus sur l'arme alliée -->
      <div id="s-enchant-dmg-block" style="${(s?.enchantMode||'dmg')==='dmg'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-enchant-degats',
          label: '⚔️ Dégâts bonus sur l\'arme enchantée',
          autoValue:  _calcEnchantDegats(s || {}),
          autoSource: _autoSourceEnchantDeg(s || {}),
          currentValue: s?.enchantDegats,
          placeholder: 'ex : +1d6 Feu, +2 Foudre, 1d8…',
        })}
      </div>

      <!-- Mode État : applique un état choisi à l'allié ciblé -->
      <div id="s-enchant-etat-block" class="form-group" style="${s?.enchantMode==='etat'?'':'display:none'}">
        <label>État appliqué à l'allié <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— buff/bénédiction ; durée selon l'état</span></label>
        <select class="input-field" id="s-enchant-etat">
          <option value="">— Aucun (effet libre uniquement) —</option>
        </select>
        <input type="hidden" id="s-enchant-etat-saved" value="${s?.enchantEtatId||''}">
      </div>
    </div>

    <!-- Affliction — visible si rune Affliction > 0 -->
    <div id="s-affliction-section" class="cs-spell-slot-box cs-spell-slot-box--aff" style="${runesSrc.includes('Affliction')?'':'display:none'}">
      <div class="cs-spell-slot-title">💀 Affliction <span>Cible ennemie · 2 tours · Action · pas de dégâts d'impact</span></div>

      <!-- Mode toggle : DoT (dégâts par tour) vs État (Entravé, Renversé, etc.) -->
      <div class="form-group">
        <label>Mode</label>
        <div class="cs-slot-grid" style="grid-template-columns:1fr 1fr">
          <button type="button" id="s-affliction-mode-dot"
            data-action="_selectAfflictionMode" data-val="dot"
            class="cs-slot-btn ${(s?.afflictionMode||'dot')==='dot'?'selected':''}">🩸 DoT (dégâts/tour)</button>
          <button type="button" id="s-affliction-mode-etat"
            data-action="_selectAfflictionMode" data-val="etat"
            class="cs-slot-btn ${s?.afflictionMode==='etat'?'selected':''}">⛓ État</button>
        </div>
        <input type="hidden" id="s-affliction-mode" value="${s?.afflictionMode||'dot'}">
      </div>

      <!-- Slot legacy conservé en hidden pour rétro-compat des sorts existants -->
      <input type="hidden" id="s-affliction-slot" value="${s?.afflictionSlot||'torse'}">
      <input type="hidden" id="s-affliction-save-stat" value="${s?.afflictionSaveStat||''}">

      <!-- DoT mode : formule de dégâts par tour (auto + custom override) -->
      <div id="s-affliction-dot-block" style="${(s?.afflictionMode||'dot')==='dot'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-affliction-dot-formula',
          label: '⚔️ Dégâts du DoT par tour',
          autoValue:  _calcAfflictionDot(s || {}),
          autoSource: _autoSourceAfflictionDot(s || {}),
          currentValue: s?.afflictionDotFormula,
          placeholder: 'ex : 1d4 +2, 3d6, 2d8 +4…',
        })}
      </div>

      <!-- État mode : liste déroulante -->
      <div id="s-affliction-etat-block" class="form-group" style="${s?.afflictionMode==='etat'?'':'display:none'}">
        <label>État infligé sur échec <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— appliqué avec sa durée par défaut</span></label>
        <select class="input-field" id="s-affliction-etat">
          <option value="">— Aucun (effet libre uniquement) —</option>
        </select>
        <input type="hidden" id="s-affliction-etat-saved" value="${s?.afflictionEtatId||''}">
      </div>
    </div>

    </div><!-- /grid-col--left -->

    <div class="cs-spell-grid-col cs-spell-grid-col--right">
    <!-- ⑥ Action — bande inline compacte -->
    <div class="cs-spell-inline-row">
      <span class="cs-spell-inline-label" title="Auto = déduit des runes (Réaction/Enchantement)">⚡ Action</span>
      <div style="display:flex;gap:.25rem;flex:1">${actionBtnsHtml}</div>
    </div>

    <!-- ⑦ Description libre -->
    <div class="form-group cs-spell-desc">
      <label>📝 Description / Effet libre <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">narration, conditions spéciales, fluff</span></label>
      <textarea class="input-field" id="s-effet" rows="2" placeholder="Décris brièvement le sort, son apparence, ses conditions particulières…">${s?.effet||''}</textarea>
    </div>

    <!-- ⑧ Durée — auto-calculée (base 2 tours + Durée scalée), override possible.
         Visible pour tous les sorts persistants (Enchant, Affliction, Protection CA, rune Durée). -->
    <div id="s-duree-base-section" class="cs-duree-section" style="${_needsDureeBase(s)?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-duree-base',
        label: '⏳ Durée (tours)',
        autoValue:  String(_calcSortDuree(s || {})),
        autoSource: _autoSourceDuree(s || {}),
        currentValue: s?.dureeBase,
        placeholder: 'ex : 5',
      })}
    </div>

    <!-- ⑧b Portée — override de la portée de l'arme (laisser vide = portée d'arme) -->
    <div class="form-group">
      <label>🎯 Portée <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">cases — laisser vide pour utiliser la portée de l'arme</span></label>
      <div style="display:flex;gap:.4rem;align-items:center">
        <input type="number" class="input-field" id="s-portee" min="0" max="50"
          value="${s?.portee != null ? s.portee : ''}" placeholder="auto (arme)" style="width:100px;text-align:center;padding:.3rem">
        <span style="font-size:.8rem;color:var(--text-dim)">cases</span>
      </div>
    </div>


    <!-- ⑨ Déplacement — bande inline compacte -->
    <div class="cs-spell-inline-row">
      <span class="cs-spell-inline-label">↔️ Déplacement</span>
      <div style="display:flex;gap:.25rem;flex:1">${deplBtnsHtml}</div>
      <div id="s-depl-dist-row" style="${deplCur?'':'display:none'};display:${deplCur?'flex':'none'};gap:.3rem;align-items:center">
        <input type="number" class="input-field" id="s-depl-dist" min="1" max="30"
          value="${s?.deplacement?.distance||1}" placeholder="1" style="width:52px;text-align:center;padding:.25rem">
        <span style="font-size:.72rem;color:var(--text-dim)">m</span>
      </div>
    </div>

    <!-- ⑩ Limites MJ (équilibrage + overrides) -->
    <div class="cs-mj-limits">
      <div class="cs-mj-limits-title">🔒 Limites MJ <span>— équilibrage des combos & overrides</span></div>

      <!-- Validation MJ : 3 états (admins) / badge lecture seule (joueurs) -->
      ${(() => {
        const vs = s?.mjValidation || (s?.mjValidated ? 'ok' : 'pending');
        if (STATE.isAdmin) {
          const seg = (val, label) => `<button type="button" class="cs-mjval-btn cs-mjval-btn--${val} ${vs===val?'is-active':''}" data-mjval="${val}" data-action="_csSetMjVal">${label}</button>`;
          return `<div class="cs-mjval-block">
            <div class="cs-mjval-block-title">Validation MJ <span>— statut de ce sort</span></div>
            <input type="hidden" id="s-mj-validation" value="${vs}">
            <div class="cs-mjval-seg">
              ${seg('ok', '✅ Validé')}
              ${seg('pending', '⏳ En attente')}
              ${seg('no', '❌ Refusé')}
            </div>
          </div>`;
        }
        const lbl = vs === 'ok' ? '✅ Sort validé par le MJ'
                  : vs === 'no' ? '❌ Sort refusé par le MJ'
                  : '⏳ En attente de validation du MJ';
        return `<div class="cs-mjval-readonly cs-mjval-readonly--${vs}">${lbl}</div>`;
      })()}

      <div class="form-group" style="margin-bottom:.5rem">
        <label style="font-size:.72rem">Notes / restrictions <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(affichées dans la fiche)</span></label>
        <textarea class="input-field" id="s-mj-notes" rows="2" placeholder="ex : soin va uniquement au lanceur">${s?.mjNotes||''}</textarea>
      </div>

      ${STATE.isAdmin ? `
      <div class="form-group" style="margin-bottom:.5rem">
        <label style="font-size:.72rem">Coût PM personnalisé <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(MJ — vide = auto selon runes ; set léger appliqué par-dessus, jamais en dessous de 0)</span></label>
        <input type="number" class="input-field" id="s-pm-override" min="0" max="50"
          value="${s?.pmOverride ?? ''}" placeholder="auto"
          style="max-width:120px">
      </div>
      <div class="cs-mj-validation cs-mj-validation--max ${s?.mjAlwaysMax?'is-on':''}">
        <input type="checkbox" id="s-mj-always-max" ${s?.mjAlwaysMax?'checked':''}
          data-change="_csMjValToggle">
        <label for="s-mj-always-max" class="cs-mj-validation-label">
          <span class="cs-mj-validation-switch"><span class="cs-mj-validation-thumb"></span></span>
          <span class="cs-mj-validation-info">
            <span class="cs-mj-validation-title">🎲 Toujours valeur maximum</span>
            <span class="cs-mj-validation-sub">Les dés tirent leur valeur max (1d6 = 6, 2d4+2 = 10) — potions, objets à effet fixe</span>
          </span>
          <span class="cs-mj-validation-state"></span>
        </label>
      </div>` : ''}
    </div>

    </div><!-- /grid-col--right -->
   </div><!-- /cs-spell-grid -->

   </div><!-- /cs-spell-forge -->
    </div><!-- /sh-admin-body -->
    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-action="closeModalDirect">Annuler</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-gold btn-sm" data-action="saveSort" data-idx="${idx}">💾 Enregistrer le sort</button>
    </div>
   </div><!-- /sh-admin-modal -->
  `);

  setTimeout(() => {
    updateSortPM();
    _updateSortActionDisplay();
    _updateSortPreview();
    // Listeners génériques pour rafraîchir la preview à chaque saisie
    const modal = document.querySelector('.modal');
    if (modal && !modal.dataset.previewBound) {
      modal.dataset.previewBound = '1';
      modal.addEventListener('input',  _updateSortPreview);
      modal.addEventListener('change', _updateSortPreview);
    }
    // Populate les listes déroulantes d'état (affliction + enchantement).
    // Au chargement initial, le dropdown n'a que l'option "— Aucun —" : la valeur
    // saved-etat-id n'est pas encore "sélectionnée" dans le <select>. Après async
    // populate, on re-render la preview pour qu'elle reflète l'état choisi.
    Promise.all([
      _populateAfflictionEtatSelect(),
      _populateEnchantEtatSelect(),
    ]).then(() => {
      _updateSortPreview();
    });
  }, 50);
}

// Cache des états en mémoire pour éviter de retaper Firestore à chaque dropdown
let _conditionsLibCache = null;

/** Source unique : lit world/conditions dans Firestore via le module partagé. */
async function _loadAllConditions() {
  if (_conditionsLibCache) return _conditionsLibCache;
  _conditionsLibCache = await loadConditionLibrary();
  return _conditionsLibCache;
}

/** Remplit un <select> d'état (Enchantement OU Affliction) depuis la BDD. */
async function _populateConditionSelect(selectId, savedHiddenId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const savedVal = document.getElementById(savedHiddenId)?.value || '';
  const lib = await _loadAllConditions();
  if (!lib.length) {
    sel.innerHTML = `<option value="">⚠️ Aucun état en BDD — ouvrir le VTT une fois pour initialiser</option>`;
    return;
  }
  sel.innerHTML = `<option value="">— Aucun —</option>`
    + lib.map(c => `<option value="${c.id}" ${c.id===savedVal?'selected':''}>${c.icon||''} ${c.label}</option>`).join('');
}

function _populateEnchantEtatSelect()    { return _populateConditionSelect('s-enchant-etat', 's-enchant-etat-saved'); }
function _populateAfflictionEtatSelect() { return _populateConditionSelect('s-affliction-etat', 's-affliction-etat-saved'); }

/** Re-style les boutons de type + ajuste la visibilité des sections conditionnelles. */
function _applyTypeChange() {
  const TYPE_CFG = {
    offensif:   '#ff6b6b',
    defensif:   '#22c38e',
    utilitaire: '#b47fff',
  };
  Object.entries(TYPE_CFG).forEach(([t, color]) => {
    const btn = document.getElementById(`s-type-${t}`);
    if (!btn) return;
    const active = _sortTypesEdit.has(t);
    btn.style.borderColor  = active ? color : 'var(--border)';
    btn.style.background   = active ? color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
  _refreshConditionalSections();
  _updateSortPreview();
}

/** Met à jour la visibilité des sections Dégâts/Soin selon types + runes + mode protection.
 *  Soin n'apparaît que si le mode Protection est explicitement 'soin' (ne s'affiche jamais
 *  en mode CA pour éviter la confusion avec le Bouclier réactif).
 */
function _refreshConditionalSections() {
  const isOffensive = _sortTypesEdit.has('offensif');
  const counts      = _runeCountsEdit || {};
  const hasProt     = (counts.Protection || 0) > 0;
  const hasAffliction = (counts.Affliction || 0) > 0;
  const protMode    = document.getElementById('s-prot-mode')?.value || 'ca';
  const dSec = document.getElementById('s-degats-section');
  const sSec = document.getElementById('s-soin-section');
  // Affliction supprime les dégâts d'impact : la rune Puissance scale le DoT
  // de l'affliction, pas un dégât direct. On cache donc la section Dégâts pour
  // éviter le piège visuel "1d6 / Puissance ajoute 1d4" sans effet réel.
  if (dSec) dSec.style.display = (isOffensive && !hasAffliction) ? '' : 'none';
  if (sSec) sSec.style.display = (hasProt && protMode === 'soin') ? '' : 'none';
}

function _toggleSortType(type) {
  if (_sortTypesEdit.has(type)) _sortTypesEdit.delete(type);
  else _sortTypesEdit.add(type);
  _applyTypeChange();
}

function _selectSortAction(val) {
  _sortActionEdit = val === 'auto' ? null : val;
  _updateSortActionDisplay();
  _updateSortPreview();
}

function _updateSortActionDisplay() {
  const ACTION_CFG = {
    null:         { label:'Auto',            color:'#9ca3af' },
    action:       { label:'⚡ Action',        color:'#e8b84b' },
    action_bonus: { label:'✴️ Action Bonus',  color:'#f97316' },
    reaction:     { label:'🔄 Réaction',      color:'#a78bfa' },
  };
  const cur = _sortActionEdit;
  Object.entries(ACTION_CFG).forEach(([v, cfg]) => {
    const btn = document.getElementById(`s-action-${v === 'null' ? 'auto' : v}`);
    if (!btn) return;
    const active = (cur === null && v === 'null') || cur === v;
    btn.style.borderColor  = active ? cfg.color : 'var(--border)';
    btn.style.background   = active ? cfg.color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? cfg.color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
}

function _selectDeplMode(mode) {
  _deplModeEdit = mode;
  const DEPL_CFG = { null:'#9ca3af', push:'#e8b84b', pull:'#4f8cff' };
  [null, 'push', 'pull'].forEach(v => {
    const btn = document.getElementById(`s-depl-${v??'none'}`);
    if (!btn) return;
    const col = DEPL_CFG[v] || '#9ca3af';
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'20' : 'var(--bg-elevated)';
    btn.style.color       = active ? col : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '700' : '400';
  });
  const distRow = document.getElementById('s-depl-dist-row');
  if (distRow) distRow.style.display = mode ? 'flex' : 'none';
  _updateSortPreview();
}

function _selectProtMode(mode) {
  const hidden  = document.getElementById('s-prot-mode');
  const caSec   = document.getElementById('s-ca-section');
  if (hidden)  hidden.value = mode;
  if (caSec)   caSec.style.display   = mode === 'ca'   ? '' : 'none';
  // La section Soin a maintenant sa propre logique (type Défensif OU Protection mode soin)
  _refreshConditionalSections();
  ['ca','soin'].forEach(v => {
    const btn = document.getElementById(`s-prot-${v}`);
    if (!btn) return;
    const colors = { ca:'#22c38e', soin:'#4f8cff' };
    const col = colors[v];
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'18' : 'var(--bg-elevated)';
    btn.querySelector('div').style.color = active ? col : 'var(--text-dim)';
  });
  // Section Durée base : visible si Protection mode CA actif
  const dureeSec = document.getElementById('s-duree-base-section');
  if (dureeSec) {
    const s = _buildSortFromDOM();
    dureeSec.style.display = _needsDureeBase(s) ? '' : 'none';
  }
  // Re-render des runes actives pour que la carte Protection reflète le mode courant
  // (CA → "+2 CA · sur 1 cible (2 tours)" / Soin → "+1d4 soin · sur 1 cible")
  _refreshRunesSection?.('Protection');
  _updateSortPreview();
}

export function runeIncrement(nom) {
  _runeCountsEdit = _runeCountsEdit||{};
  const prevCnt = _runeCountsEdit[nom] || 0;
  _runeCountsEdit[nom] = prevCnt + 1;
  // Intelligence : la 1ère Puissance ajoute Offensif · la 1ère Protection ajoute Défensif
  // (l'utilisateur peut décocher ensuite, on ne force pas)
  if (prevCnt === 0 && _sortTypesEdit) {
    if (nom === 'Puissance'  && !_sortTypesEdit.has('offensif')) {
      _sortTypesEdit.add('offensif');
      _applyTypeChange();
    }
    if (nom === 'Protection' && !_sortTypesEdit.has('defensif')) {
      _sortTypesEdit.add('defensif');
      _applyTypeChange();
    }
  }
  _refreshRunesSection(nom);
}

export function runeDecrement(nom) {
  _runeCountsEdit = _runeCountsEdit||{};
  if ((_runeCountsEdit[nom]||0) <= 0) return;
  _runeCountsEdit[nom]--;
  if (_runeCountsEdit[nom] === 0) delete _runeCountsEdit[nom];
  _refreshRunesSection(nom);
}

/**
 * Re-render la section runes complète + sync les sections conditionnelles + PM + preview.
 * Appelée après chaque incrément/décrément. Évite la désync entre carte active et picker.
 */
function _refreshRunesSection(changedNom) {
  const section = document.getElementById('cs-runes-section');
  if (section) section.innerHTML = _renderRunesSection();
  // Sections conditionnelles (rune X > 0 → section X visible)
  const cnt = _runeCountsEdit[changedNom] || 0;
  const sectionMap = {
    Protection:   's-prot-section',
    Enchantement: 's-enchant-section',
    Affliction:   's-affliction-section',
  };
  const sectionId = sectionMap[changedNom];
  if (sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.style.display = cnt > 0 ? '' : 'none';
  }
  // Section Durée de base : visible selon le contexte
  const dureeSec = document.getElementById('s-duree-base-section');
  if (dureeSec) {
    const s = _buildSortFromDOM();
    dureeSec.style.display = _needsDureeBase(s) ? '' : 'none';
  }
  // La visibilité Dégâts/Soin dépend des types ET de la rune Protection
  _refreshConditionalSections();
  updateSortPM();
}

/**
 * Active le mode "Custom" sur un champ auto-calculé.
 * fieldId : 's-degats' | 's-soin' | 's-ca' | 's-enchant-degats'
 */
function _enableSortCustom(fieldId) {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  const wrap    = display?.parentElement; // .cs-spell-autoval
  if (display) display.style.display = 'none';
  if (edit)    edit.style.display = '';
  if (wrap)    wrap.classList.add('is-custom');   // CSS gère aussi via la classe
  if (input) { input.focus(); input.select?.(); }
}

/** Repasse en mode "Auto" — vide UNIQUEMENT la formule override.
 *  Les overrides de stat sont indépendants : pour les remettre en Auto,
 *  l'utilisateur sélectionne "Auto (arme)" dans le menu déroulant.
 */
function _disableSortCustom(fieldId) {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  const wrap    = display?.parentElement; // .cs-spell-autoval
  if (input)   input.value = '';
  if (edit)    edit.style.display = 'none';
  if (display) display.style.display = '';
  if (wrap)    wrap.classList.remove('is-custom');  // sinon la chip reste cachée par CSS
  _refreshAutoValChips();
  _updateSortPreview();
}

/** Recalcule les valeurs affichées dans les chips auto (dégâts, soin, CA, enchant). */
function _refreshAutoValChips() {
  const s = _buildSortFromDOM();
  const c = _modalChar();
  if (!c) return;
  const apply = (fieldId, value, source) => {
    const v = document.getElementById(`${fieldId}-autoval`);
    const r = document.getElementById(`${fieldId}-source`);
    if (v && value !== undefined) v.textContent = value || '—';
    if (r && source !== undefined) r.textContent = source || '';
  };
  apply('s-degats',         _calcSortDegats(s, c),  _autoSourceDegats(s, c));
  apply('s-soin',           _calcSortSoin(s, c),    _autoSourceSoin(s));
  apply('s-ca',             _getSortCA(s),          _autoSourceCA(s));
  apply('s-enchant-degats', _calcEnchantDegats(s),  _autoSourceEnchantDeg(s));
  apply('s-affliction-dot-formula', _calcAfflictionDot(s), _autoSourceAfflictionDot(s));
  apply('s-duree-base', String(_calcSortDuree(s)), _autoSourceDuree(s));
}

/**
 * Met à jour les chips "💡 Suggéré : …" d'Enchantement et Affliction.
 * Lit le noyau + slot du DOM, interroge la matrice MJ.
 * Si une suggestion existe pour la combinaison, affiche le chip cliquable.
 *
 * Pré-remplissage agressif : si la textarea d'effet est encore VIDE (jamais touchée),
 * on injecte automatiquement la suggestion. Si l'utilisateur a tapé quoi que ce soit,
 * on respecte sa saisie et on n'écrase pas (juste le chip reste visible pour qu'il puisse l'appliquer manuellement).
 */
function _refreshSpellSuggestions() {
  const matrices = _spellMatricesCache;
  if (!matrices) return;
  const noyauId  = document.getElementById('s-noyau-id')?.value || '';
  const enchSlot = document.getElementById('s-enchant-slot')?.value || 'arme';
  const affSlot  = document.getElementById('s-affliction-slot')?.value || 'arme';

  const renderSuggestions = (cat, suggestions) => {
    const wrap = document.getElementById(`s-${cat}-suggest`);
    const list = document.getElementById(`s-${cat}-suggest-list`);
    const txtEl = document.getElementById(`s-${cat}-effect`);
    if (!wrap || !list) return;
    if (!suggestions.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
    wrap.style.display = '';
    // Encode chaque suggestion en base64 pour passage sans risque dans l'onclick
    list.innerHTML = suggestions.map(s => {
      const encoded = btoa(unescape(encodeURIComponent(s)));
      return `<button type="button" class="cs-spell-suggest-btn"
        data-action="_pickSpellSuggestion" data-cat="${cat}" data-encoded="${encoded}"
        title="Cliquer pour appliquer cette suggestion">↓ ${_esc(s)}</button>`;
    }).join('');
    // Pré-remplissage agressif : si la textarea est vide et jamais touchée,
    // injecte la 1ère suggestion (comportement historique)
    if (txtEl && !txtEl.value.trim() && !txtEl.dataset.userTouched) {
      txtEl.value = suggestions[0];
    }
  };

  renderSuggestions('enchant',    getMatrixSuggestions(matrices, 'enchant',    noyauId, enchSlot));
  renderSuggestions('affliction', getMatrixSuggestions(matrices, 'affliction', noyauId, affSlot));
}

/** Bibliothèque d'icônes pour les sorts (emojis sélectionnés pour le thème JdR). */
const SPELL_ICONS = [
  // Élémentaires
  '🔥','💧','🌪','🌍','⚡','❄️','☀️','🌙','⭐','✨',
  // Offensifs
  '⚔️','🗡️','🏹','💥','💣','☄️','🌋','🌊','🌩','🩸',
  // Défensifs / soin
  '🛡️','🛡','💚','💗','❤️‍🩹','✝️','🪽','🕊','🌿','🍀',
  // Contrôle / état
  '💀','☠️','🕸','🪨','🪤','🧊','🔇','😵','🥶','🥵',
  // Magie / arcanes
  '🔮','🪄','📜','📖','🎴','🌀','♾️','♾','🧿','👁️',
  // Invocations / créatures
  '🐾','🐺','🐉','🦅','🦂','🐍','🦋','🦇','🦴','🐾',
  // Divers
  '👊','👋','🫳','🫸','🤚','🪦','🗿','🎭','🃏','🎲',
];

// Ferme le picker quand on clique en dehors
function _bindSortIconPickerOutsideClose() {
  if (_sortIconPickerOutsideBound) return;
  _sortIconPickerOutsideBound = true;
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('s-icon-picker');
    const btn    = document.getElementById('s-icon-btn');
    if (!picker || picker.style.display === 'none') return;
    if (picker.contains(e.target) || btn?.contains(e.target)) return;
    picker.style.display = 'none';
  }, true);
}

function _toggleSortIconPicker() {
  _bindSortIconPickerOutsideClose();
  const picker = document.getElementById('s-icon-picker');
  if (!picker) return;
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
  // Génère la grille à l'ouverture (au cas où la sélection courante a changé)
  const current = document.getElementById('s-icon')?.value || '';
  picker.innerHTML = SPELL_ICONS.map(ic => {
    const sel = ic === current ? ' is-selected' : '';
    return `<button type="button" class="cs-spell-icon-opt${sel}"
      data-action="_pickSortIcon" data-icon="${_esc(ic)}">${ic}</button>`;
  }).join('') + `<button type="button" class="cs-spell-icon-opt cs-spell-icon-opt--clear"
      data-action="_pickSortIcon" data-icon="" title="Aucune icône — utilise celle du noyau">✕</button>`;
  picker.style.display = 'grid';
}

function _pickSortIcon(icon) {
  const hidden = document.getElementById('s-icon');
  const btn    = document.getElementById('s-icon-btn');
  const picker = document.getElementById('s-icon-picker');
  if (hidden) hidden.value = icon;
  if (btn)    btn.textContent = icon || '🔮';
  if (picker) picker.style.display = 'none';
  // Met à jour la preview live
  _updateSortPreview();
}

// Marque la textarea comme "touchée par l'utilisateur" dès qu'il y tape :
// empêche le pré-remplissage agressif d'écraser ses changements ultérieurs.
function _markSpellEffectTouched(cat) {
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (txtEl) txtEl.dataset.userTouched = '1';
}

/**
 * Applique une suggestion spécifique (base64 encodé) dans la textarea d'effet.
 * Appelé depuis les boutons générés par _refreshSpellSuggestions.
 * cat = 'enchant' | 'affliction'
 */
function _pickSpellSuggestion(cat, encoded) {
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (!txtEl) return;
  let suggestion = '';
  try { suggestion = decodeURIComponent(escape(atob(encoded))); } catch { suggestion = ''; }
  if (!suggestion) return;
  txtEl.value = suggestion;
  txtEl.dataset.userTouched = '1';                 // évite l'écrasement auto au prochain refresh
  txtEl.dispatchEvent(new Event('input', { bubbles: true })); // trigger preview update
  txtEl.focus();
}

// Compat ascendante : si du code legacy appelle encore _applySpellSuggest,
// on tente de prendre la 1ère suggestion disponible.
function _applySpellSuggest(cat) {
  const list = document.getElementById(`s-${cat}-suggest-list`);
  const firstBtn = list?.querySelector('.cs-spell-suggest-btn');
  if (firstBtn) firstBtn.click();
}

/**
 * Sélectionne un slot pour Enchantement ou Affliction.
 * groupId : 'enchant' ou 'affliction'
 */
/** Toggle Dégâts/État pour l'enchantement. */
function _selectEnchantMode(mode) {
  const hidden = document.getElementById('s-enchant-mode');
  if (hidden) hidden.value = mode;
  document.getElementById('s-enchant-mode-dmg')?.classList.toggle('selected', mode === 'dmg');
  document.getElementById('s-enchant-mode-etat')?.classList.toggle('selected', mode === 'etat');
  const dmgBlock = document.getElementById('s-enchant-dmg-block');
  const etatBlock = document.getElementById('s-enchant-etat-block');
  if (dmgBlock) dmgBlock.style.display = mode === 'dmg' ? '' : 'none';
  if (etatBlock) etatBlock.style.display = mode === 'etat' ? '' : 'none';
  _updateSortPreview();
}

/** Toggle DoT/État pour l'affliction (analogie ProtMode CA/Soin). */
function _selectAfflictionMode(mode) {
  const hidden = document.getElementById('s-affliction-mode');
  if (hidden) hidden.value = mode;
  document.getElementById('s-affliction-mode-dot')?.classList.toggle('selected', mode === 'dot');
  document.getElementById('s-affliction-mode-etat')?.classList.toggle('selected', mode === 'etat');
  const dotBlock = document.getElementById('s-affliction-dot-block');
  const etatBlock = document.getElementById('s-affliction-etat-block');
  if (dotBlock) dotBlock.style.display = mode === 'dot' ? '' : 'none';
  if (etatBlock) etatBlock.style.display = mode === 'etat' ? '' : 'none';
  _updateSortPreview();
}

function _selectSpellSlot(groupId, slotV) {
  const hidden = document.getElementById(`s-${groupId}-slot`);
  if (hidden) hidden.value = slotV;
  // Style des boutons
  SPELL_SLOTS.forEach(opt => {
    const btn = document.getElementById(`s-${groupId}-slot-${opt.v}`);
    if (!btn) return;
    btn.classList.toggle('selected', opt.v === slotV);
  });
  // Section dégâts visible UNIQUEMENT si slot=arme (Enchantement)
  if (groupId === 'enchant') {
    const row = document.getElementById('s-enchant-degats-row');
    if (row) row.style.display = slotV === 'arme' ? '' : 'none';
  }
  _updateSortPreview();
}

export function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(_runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
  const pm = total * 2 || 2;
  const pmEl = document.getElementById('s-pm');
  const dispEl = document.getElementById('s-pm-display');
  if (pmEl)   pmEl.value = pm;
  if (dispEl) dispEl.textContent = pm;
  _updateSortPreview();
}

/** Reconstruit un objet sort depuis l'état du modal (pour la preview live) */
function _buildSortFromDOM() {
  const noyau       = document.getElementById('s-noyau')?.value || '';
  const noyauTypeId = document.getElementById('s-noyau-id')?.value || '';
  const runes = [];
  Object.entries(_runeCountsEdit||{}).forEach(([nom, cnt]) => {
    for (let i=0; i<cnt; i++) runes.push(nom);
  });
  const types = [...(_sortTypesEdit || new Set(['utilitaire']))];
  const dureeBase = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = _deplModeEdit || null;
  const deplDist = deplMode ? (parseInt(document.getElementById('s-depl-dist')?.value) || 1) : 0;
  const iconRaw  = document.getElementById('s-icon')?.value || '';
  const mjVal    = document.getElementById('s-mj-validation')?.value || 'pending';
  return {
    icon:        iconRaw.trim() || '',
    mjValidation: mjVal, mjValidated: mjVal === 'ok',
    noyau, noyauTypeId, runes, types,
    degats: document.getElementById('s-degats')?.value || '',
    soin:   document.getElementById('s-soin')?.value || '',
    ca:     document.getElementById('s-ca')?.value || '',
    effet:  document.getElementById('s-effet')?.value || '',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    actionOverride: _sortActionEdit || null,
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantSlot:      'arme', // legacy compat (preview live, sera écrasé à la save par la valeur en BDD)
    enchantEffect:    document.getElementById('s-enchant-effect')?.value ?? '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'arme',
    afflictionMode:   document.getElementById('s-affliction-mode')?.value || 'dot',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value || '',
    afflictionEtatId: document.getElementById('s-affliction-etat')?.value || null,
    afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
    afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
    zoneW: null,
    zoneH: null,
    dureeBase: dureeBase >= 2 ? dureeBase : null,
    deplacement: deplMode ? { mode: deplMode, distance: deplDist } : null,
    // Portée + stats overrides : doivent être lus du DOM pour que la preview live
    // et les chips auto reflètent la sélection courante (sinon auto-dérivation kick in).
    portee:      (() => {
      // Distingue champ VIDE (→ null = auto/arme) de la valeur 0 (→ "sur soi")
      const raw = document.getElementById('s-portee')?.value;
      if (raw === '' || raw == null) return null;
      const n = parseInt(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    toucherStat: _readVisibleStatOverride('s-toucher-stat'),
    degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
    mjNotes: document.getElementById('s-mj-notes')?.value || '',
  };
}

/** Rafraîchit la preview live dans l'éditeur de sort */
/** Perso placeholder neutre pour la preview en contexte item (pas de perso actif).
 *  Stats 10 partout (mod 0), Poings (1d6 Phys, portée 1m), pas d'équipement.
 *  Permet à _buildSortResume / _calcSortDegats / etc. de calculer un aperçu générique. */
function _itemPreviewPlaceholderChar() {
  return {
    id: '__itemPreview',
    nom: 'Objet',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': null },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [],
    elements: [],
  };
}

function _updateSortPreview() {
  const body = document.getElementById('s-preview-body');
  if (!body) return;
  // En contexte item-edit : on utilise un perso virtuel pour avoir un aperçu générique
  //   (formules de base sans modificateurs perso, ce qui correspond au comportement réel
  //   de l'item — les modificateurs viennent du caster au moment de l'utilisation).
  const c = _modalChar() || (_itemEditCtx ? _itemPreviewPlaceholderChar() : null);
  if (!c) { body.innerHTML = ''; return; }
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
  if (typeof _refreshSpellSuggestions === 'function') _refreshSpellSuggestions();
  const s = _buildSortFromDOM();
  let lines = [];
  try {
    lines = _buildSortResume(s, c);
  } catch (e) {
    console.warn('[Preview item] _buildSortResume a échoué :', e);
    lines = [{ icon:'⚠️', label:'Aperçu non disponible (calcul indisponible sans perso)' }];
  }
  body.innerHTML = lines.map(l => `
    <div class="cs-spell-preview-row ${l.isCombo ? 'cs-spell-preview-row--combo' : ''}">
      ${l.icon ? `<span class="cs-spell-preview-icon">${l.icon}</span>` : '<span class="cs-spell-preview-icon"></span>'}
      <span class="cs-spell-preview-label">${_esc(l.label)}</span>
      ${l.detail ? `<span class="cs-spell-preview-detail">${_esc(l.detail)}</span>` : ''}
    </div>
  `).join('');
}

function _setNoyauRequiredError(show, message = 'Sélectionne une rune noyau pour enregistrer ce sort.') {
  const section = document.querySelector('.cs-spell-section--noyau');
  const error   = document.getElementById('s-noyau-error');
  section?.classList.toggle('is-invalid', !!show);
  document.querySelectorAll('.cs-noyau-btn').forEach(btn => {
    btn.setAttribute('aria-invalid', show ? 'true' : 'false');
  });
  if (error) {
    error.textContent = message;
    error.hidden = !show;
  }
}

function _requireNoyauSelection() {
  const noyauTypeId = (document.getElementById('s-noyau-id')?.value || '').trim();
  const noyauLabel  = (document.getElementById('s-noyau')?.value || '').trim();
  const allowedIds = _sortAllowedNoyauIds;
  const hasNoyau = !!(noyauTypeId && noyauLabel);
  const hasAccess = !allowedIds || allowedIds.has(noyauTypeId);
  const valid = hasNoyau && hasAccess;
  const message = hasNoyau && !hasAccess
    ? "Ce noyau n'est pas accessible à ce personnage. Le MJ doit lui débloquer cet élément."
    : 'Sélectionne une rune noyau pour enregistrer ce sort.';
  _setNoyauRequiredError(!valid, message);
  if (!valid) {
    showNotif(message, 'error');
    document.querySelector('.cs-spell-section--noyau')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return valid;
}

export function selectNoyau(el, noyauId, noyauLabel, noyauColor) {
  document.querySelectorAll('.cs-noyau-btn').forEach(b => {
    b.classList.remove('selected');
    b.style.borderColor = '';
    b.style.background  = '';
    b.style.color       = '';
  });
  el.classList.add('selected');
  if (noyauColor) {
    el.style.borderColor = noyauColor;
    el.style.background  = noyauColor + '20';
    el.style.color       = noyauColor;
  }
  const inputLabel = document.getElementById('s-noyau');
  const inputId    = document.getElementById('s-noyau-id');
  if (inputLabel) inputLabel.value = noyauLabel || noyauId;
  if (inputId)    inputId.value    = noyauId;
  _setNoyauRequiredError(false);
  // Le changement de noyau affecte le calcul des soins (magique → arme · physique → Con)
  // et les suggestions matrice (Enchant/Affliction · Protection CA)
  updateSortPM();
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
}


export async function saveSort(idx) {
  // Si on édite une action d'item (depuis le shop), on aiguille vers le bon save
  if (_itemEditCtx) return _saveItemSpell();
  try {
    if (!_requireNoyauSelection()) return;
    const c = STATE.activeChar; if(!c) return;
    const sorts = c.deck_sorts||[];
    const noyau       = document.getElementById('s-noyau')?.value||'';
    const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';

    // Runes depuis _runeCountsEdit
    const runes = [];
    Object.entries(_runeCountsEdit||{}).forEach(([nom, cnt]) => {
      for (let i=0; i<cnt; i++) runes.push(nom);
    });

    const totalRunes = (noyau ? 1 : 0) + runes.length;
    const autoPm     = totalRunes * 2 || 2;

    // Types (multi)
    const types = [...(_sortTypesEdit || new Set(['utilitaire']))];

    // Action override (null = auto)
    const actionOverride = _sortActionEdit || null;

    const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
    const deplMode = _deplModeEdit || null;
    const deplDist = deplMode ? (parseInt(document.getElementById('s-depl-dist')?.value) || 1) : 0;

    // Validation MJ (3 états) : seuls les admins peuvent la modifier ; sinon on garde la valeur existante
    const prevVal = idx >= 0 ? (sorts[idx]?.mjValidation || (sorts[idx]?.mjValidated ? 'ok' : 'pending')) : 'pending';
    const mjValidation = STATE.isAdmin
      ? (document.getElementById('s-mj-validation')?.value || 'pending')
      : prevVal;
    const mjValidated  = mjValidation === 'ok'; // rétro-compat booléen

    // PM override (MJ uniquement) : si vide → null (utilise autoPm). Si admin n'existe pas ce champ.
    const pmOvrRaw = STATE.isAdmin ? document.getElementById('s-pm-override')?.value : null;
    const pmOvrInt = pmOvrRaw != null && pmOvrRaw !== '' ? parseInt(pmOvrRaw) : null;
    const pmOverride = (pmOvrInt != null && Number.isFinite(pmOvrInt) && pmOvrInt >= 0)
      ? pmOvrInt
      : (STATE.isAdmin ? null : (idx >= 0 ? sorts[idx]?.pmOverride ?? null : null));
    const newSort = {
      icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
      mjValidation, mjValidated,
      mjAlwaysMax: STATE.isAdmin
        ? !!document.getElementById('s-mj-always-max')?.checked
        : (idx >= 0 ? !!sorts[idx]?.mjAlwaysMax : false),
      nom:      document.getElementById('s-nom')?.value||'Sort',
      pm:       autoPm,
      pmOverride,
      noyau,
      noyauTypeId,
      runes,
      types,
      degats:   document.getElementById('s-degats')?.value||'',
      soin:     document.getElementById('s-soin')?.value||'',
      ca:       document.getElementById('s-ca')?.value||'',
      effet:    document.getElementById('s-effet')?.value||'',
      protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
      // Legacy compat : typeSoin si defensif sans offensif + mode soin
      typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
      catId:         document.getElementById('s-catid')?.value || '',
      actif:         idx>=0 ? sorts[idx].actif : false,
      actionOverride,
      enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
      enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
      enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
      // enchantSlot legacy : conservé en BDD pour rétro-compat des combos, mais
      // l'UI n'expose plus de slot. Défaut 'arme' aligné sur le bonus dégâts.
      enchantSlot:      idx >= 0 ? (sorts[idx]?.enchantSlot || 'arme') : 'arme',
      enchantEffect:    document.getElementById('s-enchant-effect')?.value
                        ?? (idx >= 0 ? (sorts[idx]?.enchantEffect || '') : ''),
      afflictionSlot:    document.getElementById('s-affliction-slot')?.value || 'torse',
      afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || 'constitution',
      afflictionMode:    document.getElementById('s-affliction-mode')?.value || 'dot',
      afflictionEffect:  document.getElementById('s-affliction-effect')?.value
                         ?? (idx >= 0 ? (sorts[idx]?.afflictionEffect || '') : ''),
      afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
      afflictionEtatId:  document.getElementById('s-affliction-etat')?.value || null,
      zoneW: null,
      zoneH: null,
      dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
      deplacement: deplMode ? { mode: deplMode, distance: deplDist } : null,
      // Portée override : 0 ou vide = utilise la portée de l'arme par défaut (côté VTT)
      portee:     (() => {
        const raw = document.getElementById('s-portee')?.value;
        if (raw === '' || raw == null) return null;
        const n = parseInt(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      // Stats overrides : '' = suit l'arme principale (auto).
      // On lit uniquement les sélecteurs VISIBLES (helper _readVisibleStatOverride)
      // → évite que le sélecteur d'une section cachée n'écrase la sélection utilisateur.
      toucherStat: _readVisibleStatOverride('s-toucher-stat'),
      degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
      mjNotes:      document.getElementById('s-mj-notes')?.value?.trim() || '',
    };
    const isNew = idx < 0;
    if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
    c.deck_sorts=sorts;
    // Sync les références pour que les filtres / re-render lisent la version fraîche
    if (charSession.getCurrentChar()?.id === c.id) charSession.getCurrentChar() = c;
    if (STATE.activeChar?.id === c.id)    STATE.activeChar    = c;
    await updateInCol('characters',c.id,{deck_sorts:sorts});
    closeModal();
    showNotif(`Sort enregistré — ${newSort.pm} PM`, 'success');

    // ── Sur ajout : s'assure que le nouveau sort soit visible ────────
    if (isNew) {
      // Reset les filtres qui pourraient cacher le sort fraîchement créé
      _sortsSearch = '';
      _sortsTypeFilter = '';
      _sortsView = 'all';
      // Déplie la catégorie où le sort vient d'être ajouté
      const newCatId = newSort.catId
        && (c.sort_cats || []).find(cat => cat.id === newSort.catId)
        ? newSort.catId : '__none';
      _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}) };
      _sortsCatCollapsed[newCatId] = false;
    }

    // Force un re-render du tab Sorts en V3 si dispo, sinon fallback legacy
    _renderSpellsTab(c);
  } catch (e) { notifySaveError(e); }
}

/** Build d'un objet "sort" depuis le formulaire courant — réutilisable pour items. */
function _buildSortFromForm(idx, prevList = []) {
  const noyau       = document.getElementById('s-noyau')?.value||'';
  const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';
  const runes = [];
  Object.entries(_runeCountsEdit||{}).forEach(([nom, cnt]) => {
    for (let i=0; i<cnt; i++) runes.push(nom);
  });
  const totalRunes = (noyau ? 1 : 0) + runes.length;
  const autoPm     = totalRunes * 2 || 2;
  const types = [...(_sortTypesEdit || new Set(['utilitaire']))];
  const actionOverride = _sortActionEdit || null;
  const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = _deplModeEdit || null;
  const deplDist = deplMode ? (parseInt(document.getElementById('s-depl-dist')?.value) || 1) : 0;
  const prevVal = idx >= 0 ? (prevList[idx]?.mjValidation || (prevList[idx]?.mjValidated ? 'ok' : 'pending')) : 'pending';
  const mjValidation = STATE.isAdmin
    ? (document.getElementById('s-mj-validation')?.value || 'pending')
    : prevVal;
  const mjValidated  = mjValidation === 'ok'; // rétro-compat booléen
  const pmOvrRaw = STATE.isAdmin ? document.getElementById('s-pm-override')?.value : null;
  const pmOvrInt = pmOvrRaw != null && pmOvrRaw !== '' ? parseInt(pmOvrRaw) : null;
  const pmOverride = (pmOvrInt != null && Number.isFinite(pmOvrInt) && pmOvrInt >= 0)
    ? pmOvrInt
    : (STATE.isAdmin ? null : (idx >= 0 ? prevList[idx]?.pmOverride ?? null : null));
  return {
    icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
    mjValidation, mjValidated,
    nom:      document.getElementById('s-nom')?.value||'Sort',
    pm:       autoPm,
    pmOverride,
    mjAlwaysMax: STATE.isAdmin
      ? !!document.getElementById('s-mj-always-max')?.checked
      : (idx >= 0 ? !!prevList[idx]?.mjAlwaysMax : false),
    noyau, noyauTypeId, runes, types,
    degats:   document.getElementById('s-degats')?.value||'',
    soin:     document.getElementById('s-soin')?.value||'',
    ca:       document.getElementById('s-ca')?.value||'',
    effet:    document.getElementById('s-effet')?.value||'',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
    actionOverride,
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantSlot:      idx >= 0 ? (prevList[idx]?.enchantSlot || 'arme') : 'arme',
    enchantEffect:    document.getElementById('s-enchant-effect')?.value ?? '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'torse',
    afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || 'constitution',
    afflictionMode:   document.getElementById('s-affliction-mode')?.value || 'dot',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value ?? '',
    afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
    afflictionEtatId: document.getElementById('s-affliction-etat')?.value || null,
    zoneW: null, zoneH: null,
    dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
    deplacement: deplMode ? { mode: deplMode, distance: deplDist } : null,
    portee:     (() => {
      const raw = document.getElementById('s-portee')?.value;
      if (raw === '' || raw == null) return null;
      const n = parseInt(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    toucherStat: _readVisibleStatOverride('s-toucher-stat'),
    degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
    mjNotes:      document.getElementById('s-mj-notes')?.value?.trim() || '',
  };
}

/** Hook de sauvegarde aiguillée : utilisé quand on édite une action d'item.
 *  Lance _itemEditCtx.onSave avec l'item mis à jour, puis ferme. */
async function _saveItemSpell() {
  if (!_itemEditCtx) return false;
  try {
    if (!_requireNoyauSelection()) return false;
    const { item, idx, onSave } = _itemEditCtx;
    const acts = Array.isArray(item.actions) ? [...item.actions] : [];
    const newSort = _buildSortFromForm(idx, acts);
    if (!newSort.id) newSort.id = idx >= 0 ? (acts[idx]?.id || `a${Date.now().toString(36)}`) : `a${Date.now().toString(36)}`;
    if (idx >= 0) acts[idx] = { ...acts[idx], ...newSort };
    else acts.push(newSort);
    item.actions = acts;
    const cb = onSave;
    _itemEditCtx = null;
    // 1) Pop la modal de sort → la modal du shop est restaurée à l'écran
    closeModal();
    // 2) Maintenant on déclenche le callback shop pour rafraîchir la section actions
    //    (l'#si-actions-host est de nouveau dans le DOM après la restauration)
    await cb(item);
    showNotif(`Action enregistrée — ${newSort.pm} PM`, 'success');
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}

// (le check _itemEditCtx est désormais en tête de saveSort — pas de monkey-patch)

registerActions({
  _sortsSearchInput:      (el)  => _sortsSetSearch(el.value),
  _refreshAutoValChips:   ()    => _refreshAutoValChips(),
  _csMjValToggle:         (el)  => el.closest('.cs-mj-validation')?.classList.toggle('is-on', el.checked),
  _csSetMjVal:            (btn) => {
    const val = btn.dataset.mjval;
    const inp = document.getElementById('s-mj-validation');
    if (inp) inp.value = val;
    document.querySelectorAll('.cs-mjval-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mjval === val));
    window._updateSortPreview?.();
  },
  addSort:                ()    => addSort(),
  openSortCatEditor:      ()    => openSortCatEditor(),
  toggleSortDetail:       (btn) => toggleSortDetail(Number(btn.dataset.idx)),
  editSort:               (btn) => editSort(Number(btn.dataset.idx)),
  saveSort:               (btn) => saveSort(Number(btn.dataset.idx)),
  selectNoyau:            (btn) => selectNoyau(btn, btn.dataset.noyauId, btn.dataset.noyauLabel, btn.dataset.noyauColor),
  runeIncrement:          (btn) => runeIncrement(btn.dataset.nom),
  runeDecrement:          (btn) => runeDecrement(btn.dataset.nom),
  closeModalDirect:       ()    => closeModalDirect(),
  _enableSortCustom:      (btn) => _enableSortCustom(btn.dataset.field),
  _disableSortCustom:     (btn) => _disableSortCustom(btn.dataset.field),
  _sortsSetSearch:        (btn) => _sortsSetSearch(btn.dataset.val),
  _sortsSetView:          (btn) => _sortsSetView(btn.dataset.view),
  _sortsSetType:          (btn) => _sortsSetType(btn.dataset.type),
  _sortsToggleCat:        (btn) => _sortsToggleCat(btn.dataset.id),
  _sortsToggleAllCats:    ()    => _sortsToggleAllCats(),
  _sortsResetFilters:     ()    => _sortsResetFilters(),
  _editSortCat:           (btn) => _editSortCat(Number(btn.dataset.idx)),
  _delSortCat:            (btn) => _delSortCat(Number(btn.dataset.idx)),
  _addSortCat:            (btn) => _addSortCat(btn.dataset.col),
  _toggleSortType:        (btn) => _toggleSortType(btn.dataset.type),
  _selectSortAction:      (btn) => _selectSortAction(btn.dataset.val === '' ? null : btn.dataset.val),
  _selectDeplMode:        (btn) => _selectDeplMode(btn.dataset.val === '' ? null : btn.dataset.val),
  _selectProtMode:        (btn) => _selectProtMode(btn.dataset.val),
  _selectEnchantMode:     (btn) => _selectEnchantMode(btn.dataset.val),
  _selectAfflictionMode:  (btn) => _selectAfflictionMode(btn.dataset.val),
  _toggleSortIconPicker:  ()    => _toggleSortIconPicker(),
  _pickSortIcon:          (btn) => _pickSortIcon(btn.dataset.icon),
  _pickSpellSuggestion:   (btn) => _pickSpellSuggestion(btn.dataset.cat, btn.dataset.encoded),
});
