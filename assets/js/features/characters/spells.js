import { STATE } from '../../core/state.js';
import { updateInCol } from '../../data/firestore.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _nl2br } from '../../shared/html.js';
import { getMod, calcPMMax } from '../../shared/char-stats.js';
import { loadDamageTypes } from '../../shared/damage-types.js';
import { loadSpellMatrices, suggestSpellEffect, getProtectionCAOverride, getComboConfig, getInvokedArm } from '../../shared/spell-matrices.js';
import { getArmorSetData, getMainWeapon } from './data.js';

// ── Drag and Drop sorts ──────────────────────
let _dragSortIdx = null;

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
    window.renderCharSheet(c, 'sorts');
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

  // Bonus de maîtrise de l'arme principale
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

  // Stat de soin selon nature du noyau
  const isMagic = _isNoyauMagic(s);
  const statKey = _getSortSoinStatKey(s, c);
  const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
  const statMod = Math.floor((Math.min(22, statVal) - 10) / 2);
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
    describe: (counts) =>
      `Puissance ×${counts.Puissance} + Protection ×${counts.Protection} · le soin vient des dégâts (utilise les Limites MJ pour la fraction)`,
  },
  {
    id: 'zone_elargie',
    icon: '🌐',
    defaultName: 'Zone élargie',
    detect: (counts) => counts.Amplification > 0 && counts.Dispersion > 0,
    describe: (counts) =>
      `Amp ×${counts.Amplification} + Disp ×${counts.Dispersion} · la Dispersion élargit la zone Y au lieu d'ajouter des cibles`,
  },
  {
    id: 'arme_invoquee',
    icon: '⚔️',
    defaultName: 'Arme invoquée',
    detect: (counts) => counts.Enchantement > 0 && counts.Invocation > 0,
    describe: (counts, s) => {
      const arm = getInvokedArm(window._spellMatricesCache, s?.noyauTypeId);
      const nbP = counts.Puissance || 0;
      const STAT_LBL = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' };
      if (arm) {
        const tch = STAT_LBL[arm.statToucher] || arm.statToucher;
        const dmg = STAT_LBL[arm.statDegats]  || arm.statDegats;
        const statStr = (arm.statToucher === arm.statDegats) ? tch : `Touche:${tch} / Dégâts:${dmg}`;
        const puissBonus = nbP > 0 ? ` +${nbP} dé${nbP>1?'s':''} (Puissance)` : '';
        return `${arm.weapon} · ${arm.degats}${puissBonus} · ${statStr} · portée ${arm.portee}m${arm.note ? ` · ${arm.note}` : ''}`;
      }
      return `Arme générique 1d8${nbP > 0 ? ` +${nbP} dé${nbP>1?'s':''} (Puissance)` : ''} · 2 tours · ⚠️ matrice Armes invoquées vide pour cet élément`;
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
    describe: () =>
      `Affliction + Invocation · pose une sentinelle stationnaire (10 PV, CA 10) qui afflige toute cible entrant dans sa zone (au lieu d'un projectile)`,
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
  const matrices = window._spellMatricesCache;
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
  const statKey = mainP.statAttaque || 'force';
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || 'For';
  const nbP     = (s.runes||[]).filter(r => r === 'Puissance').length;
  const parts   = [mainP.isDefault ? `Poings ${mainP.degats}` : (mainP.nom || 'arme'), statLbl];
  if (nbP > 0) parts.push(`Puissance ×${nbP}`);
  return `auto · ${parts.join(' + ')}`;
}
function _autoSourceSoin(s) {
  const nbProt = (s.runes||[]).filter(r => r === 'Protection').length;
  const isMagic = _isNoyauMagic(s);
  const statKey = _getSortSoinStatKey(s, STATE.activeChar);
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
  const natureStr = isMagic ? 'magique · stat arme' : 'physique · Constitution';
  return nbProt > 0
    ? `auto · base 1d4 +${nbProt}d4 (Protection) · ${natureStr} (${statLbl})`
    : `auto · base 1d4 · ${natureStr} (${statLbl})`;
}
function _autoSourceCA(s) {
  const nbProt = (s.runes||[]).filter(r => r === 'Protection').length;
  const ov = getProtectionCAOverride(window._spellMatricesCache, s?.noyauTypeId);
  if (nbProt === 0) return 'auto · CA +2 (2 tours)';
  // Combo Bouclier réactif : pas de bonus CA — source informe
  const hasReaction = (s.runes || []).includes('Réaction');
  if (hasReaction && (s.protectionMode || 'ca') === 'ca') {
    const cfg = getComboConfig(window._spellMatricesCache, 'bouclier_reactif');
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

/**
 * Génère le HTML d'un champ auto-calculé avec toggle Custom / Auto.
 * fieldId = id de l'input override (ex: 's-degats')
 * Le wrapper contient deux modes : display (chip lecture seule) et edit (input).
 */
function _autoValHtml({ fieldId, label, autoValue, autoSource, currentValue, placeholder }) {
  const hasOverride = !!(currentValue && String(currentValue).trim());
  return `
    <div class="cs-spell-autoval ${hasOverride ? 'is-custom' : ''}">
      <div class="cs-spell-autoval-label">${label}</div>
      <div class="cs-spell-autoval-display" id="${fieldId}-display" style="${hasOverride?'display:none':''}">
        <span class="cs-spell-autoval-val"    id="${fieldId}-autoval">${autoValue || '—'}</span>
        <span class="cs-spell-autoval-source" id="${fieldId}-source">${autoSource || ''}</span>
        <button type="button" class="cs-spell-autoval-btn" onclick="window._enableSortCustom('${fieldId}')">✏️ Custom</button>
      </div>
      <div class="cs-spell-autoval-edit" id="${fieldId}-edit" style="${hasOverride?'':'display:none'}">
        <input class="input-field" id="${fieldId}" value="${currentValue||''}" placeholder="${placeholder||''}">
        <button type="button" class="cs-spell-autoval-btn" onclick="window._disableSortCustom('${fieldId}')">↺ Auto</button>
      </div>
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
 * Dégâts d'enchantement effectifs (auto si vide ET slot=arme).
 * Formule : (1 + nbPuissance)d4 + 2 dans l'élément
 */
function _calcEnchantDegats(s) {
  const slot   = s.enchantSlot || 'arme';
  if (slot !== 'arme') return '';
  const manual = (s.enchantDegats || '').trim();
  if (manual) return manual;
  const nbPuiss = (s.runes || []).filter(r => r === 'Puissance').length;
  return `${1 + nbPuiss}d4 +2`;
}

/** Valeur CA (rune Protection mode CA) :
 *  - Saisie manuelle si fournie
 *  - Sinon auto : (mod par rune selon élément ou 2 par défaut) + chaînage +1 / rune au-delà de la 1ère
 *  - Le mod par élément vient de la matrice MJ : window._spellMatricesCache (Protection×CA)
 */
function _getSortCA(s) {
  const manual = (s?.ca || '').trim();
  if (manual) return manual;
  const nbProt = (s.runes || []).filter(r => r === 'Protection').length;
  if (nbProt === 0) return 'CA +2 (2 tours)';
  // Combo Bouclier réactif : pas de bonus CA, juste un blocage en réaction
  const hasReaction = (s.runes || []).includes('Réaction');
  if (hasReaction && (s.protectionMode || 'ca') === 'ca') {
    const cfg = getComboConfig(window._spellMatricesCache, 'bouclier_reactif');
    if (cfg.enabled) {
      const tier = nbProt >= 3 ? 'Boss-' : nbProt === 2 ? 'Élite-' : 'Mob';
      return `Bloque 1 attaque (${tier})`;
    }
  }
  const ov  = getProtectionCAOverride(window._spellMatricesCache, s?.noyauTypeId);
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
  // Combo Amp + Disp → mode zone, pas de cibles séparées
  if (nbAmp > 0 && nbDisp > 0) return 1;
  if (nbDisp === 0) return 1;
  return 2 * nbDisp; // 2N cibles différentes
}

/** Détermine si le noyau du sort est magique (depuis la matrice damage_types).
 *  Détermine la stat utilisée pour le soin (magique → arme · physique → Constitution).
 */
function _isNoyauMagic(s) {
  const types = window._damageTypesCache;
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

/** Durée totale en tours = dureeBase + bonus rune Durée
 *  Durée ×1 → +2 tours · ×N → 2 + (N-1) = N+1 tours (chaînage +1 / rune)
 */
function _calcSortDuree(s) {
  const runes  = s.runes || [];
  const nbDur  = runes.filter(r => r === 'Durée').length;
  const base   = (s.dureeBase && s.dureeBase >= 2) ? s.dureeBase : 0;
  if (nbDur === 0 && base === 0) return null;
  const runeBonus = nbDur > 0 ? (nbDur + 1) : 0;
  return base + runeBonus || null;
}


/** Longueur de zone produite par N runes Amplification.
 *  Chaque rune ajoute +3m de base, chainage +1m par rune au-delà de la 1ère.
 *  ×1=3, ×2=7, ×3=11, ×4=15… → 3N + (N-1) = 4N-1 pour N≥1
 */
function _ampLength(nbAmp) { return nbAmp >= 1 ? (4 * nbAmp - 1) : 0; }

/** Zone calculée :
 *  - Si zoneW/H manuels saisis → ils priment (override MJ)
 *  - Sinon, calculé depuis les runes Amplification (+ Dispersion en combo) :
 *    Amplification : +3m / rune · chaînage +1m / rune au-delà de la 1ère
 *    Combo Amplification + Dispersion ×M = (longueur Amp) × (1+M)m
 *  - Source: 'manual' | 'runes' | null (pour l'affichage du label)
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
  const width = 1 + nbDisp;
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
  lines.push({ icon: '', label: `${actionStr} · ${natureStr}`, detail: concentration ? 'JS Sagesse DD 11 si dégâts reçus · jusqu\'à 10 tours' : '' });

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

  // Dégâts (si offensif)
  if (types.includes('offensif')) {
    const mainP   = getMainWeapon(c);
    const statKey = mainP.statAttaque || mainP.toucherStat || 'force';
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

  // Protection : Soin ou CA selon protectionMode
  const hasDefensif = types.includes('defensif');
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (mode === 'soin') {
      // Override MJ : soin = fraction des dégâts (ex : Drain)
      if (s.soinFraction && s.soinFraction > 0) {
        const pct = Math.round(s.soinFraction * 100);
        lines.push({ icon:'💚', label:`${pct}% des dégâts`, detail:`Limite MJ · scale avec Puissance${monoStr}` });
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
  const duree = _calcSortDuree(s);
  if (duree) {
    const nbDur  = runes.filter(r => r === 'Durée').length;
    const dBase  = (s.dureeBase && s.dureeBase >= 2) ? s.dureeBase : 0;
    if (comboIds.has('canalise_persistant')) {
      lines.push({
        icon:'⏱️',
        label: `Tant que concentration · +${duree - dBase} tours de grâce`,
        detail: `Sort canalisé persistant · pas de plafond 10t · les ${duree - dBase} tours s'appliquent après rupture de concentration`,
      });
    } else {
      const detail = [
        dBase > 0  ? `${dBase} tours de base` : '',
        nbDur > 0  ? `+${duree - dBase} tours (rune Durée${nbDur > 1 ? ' ×'+nbDur : ''})` : '',
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

  // Enchantement / Affliction — slot + effet libre + compteur de cibles
  // Si un combo les remplace (Arme invoquée, Sentinelle), on ne re-affiche pas la ligne classique
  const nbEnch = runes.filter(r => r === 'Enchantement').length;
  const nbAff  = runes.filter(r => r === 'Affliction').length;
  const hideEnch = comboIds.has('arme_invoquee'); // Enchant absorbé dans Arme invoquée
  const hideAff  = comboIds.has('sentinelle');    // Affliction absorbée dans Sentinelle
  if (nbEnch > 0 && !hideEnch) {
    const slot     = s.enchantSlot || 'arme';
    const slotLbl  = SLOT_LABEL[slot] || SLOT_LABEL.arme;
    const effect   = (s.enchantEffect || '').trim();
    const degAuto  = _calcEnchantDegats(s);
    const cibleStr = nbEnch === 1 ? 'sur 1 allié' : `sur ${nbEnch} alliés (chaîné +${nbEnch-1})`;
    const detailParts = [`2 tours`, 'Action Bonus'];
    if (effect) detailParts.push(effect);
    lines.push({ icon:'✨', label:`Enchantement ${slotLbl} · ${cibleStr}`, detail: detailParts.join(' · ') });
    if (slot === 'arme' && degAuto) {
      lines.push({ icon:'⚔️', label: degAuto, detail: `Dégâts bonus sur l'arme enchantée${s.enchantDegats?.trim() ? '' : ' · auto (1+Puiss)d4+2'}` });
    }
  }
  if (nbAff > 0 && !hideAff) {
    const slot     = s.afflictionSlot || 'arme';
    const slotLbl  = SLOT_LABEL[slot] || SLOT_LABEL.arme;
    const effect   = (s.afflictionEffect || '').trim();
    const cibleStr = nbAff === 1 ? 'sur 1 ennemi' : `sur ${nbAff} ennemis (chaîné +${nbAff-1})`;
    const detailParts = [`2 tours`, 'Action'];
    if (effect) detailParts.push(effect);
    else detailParts.push('effet selon élément × slot — décris ci-dessous');
    lines.push({ icon:'💀', label:`Affliction ${slotLbl} · ${cibleStr}`, detail: detailParts.join(' · ') });
  }

  // Invocation — masquée si absorbée par un combo (Arme invoquée, Sentinelle)
  const hideInvoc = comboIds.has('arme_invoquee') || comboIds.has('sentinelle');
  if (runes.includes('Invocation') && !hideInvoc) {
    lines.push({ icon:'🐾', label:'Invocation', detail:'Créature liée · 10 PV · CA 10' });
  }

  // Concentration (rappel JS si pas déjà mentionné)
  if (concentration && action !== 'action') {
    lines.push({ icon:'🧠', label:'Concentration', detail:'JS Sagesse DD 11 si dégâts reçus · jusqu\'à 10 tours' });
  }

  // Limite MJ (texte libre)
  if (s.mjNotes && s.mjNotes.trim()) {
    lines.push({ icon:'🔒', label:'Limite MJ', detail: s.mjNotes.trim() });
  }

  return lines;
}

// Placeholder — resolved at runtime via characters.js import chain
function _getMaitriseBonus(c, item) {
  if (typeof window._getMaitriseBonus === 'function') return window._getMaitriseBonus(c, item);
  // Fallback inline (never called if characters.js sets window._getMaitriseBonus)
  return 0;
}

export function renderCharDeck(c, canEdit) {
  const allSorts = c.deck_sorts || [];
  const cats     = c.sort_cats  || [];
  const mainP    = getMainWeapon(c);
  const armeDeg  = mainP.degats;
  const openIdx  = window._openSortIdx ?? null;

  const armorSet = getArmorSetData(c);
  const pmDelta  = armorSet.modifiers?.spellPmDelta || 0;

  const DEFAULT_CAT = { id: '__none', nom: 'Sans catégorie', couleur: '#4f8cff' };
  const allCats = cats.length ? [...cats, DEFAULT_CAT] : [DEFAULT_CAT];
  const sortsByCat = {};
  allCats.forEach(cat => { sortsByCat[cat.id] = []; });
  allSorts.forEach((s, globalIdx) => {
    const catId = s.catId && cats.find(cat => cat.id === s.catId) ? s.catId : '__none';
    sortsByCat[catId].push({ s, globalIdx });
  });

  let html = `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">✨ Sorts & Compétences</span>
      <div style="display:flex;gap:.35rem">
        ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="addSort()">+ Sort</button>` : ''}
        ${canEdit ? `<button class="btn btn-outline btn-sm" onclick="openSortCatEditor()">📂 Catégories</button>` : ''}
      </div>
    </div>
    <p class="cs-sort-info">
      <strong>Noyau + Runes.</strong> PM = 2 × (noyau + runes).
      Dégâts sorts = arme principale <em>(${armeDeg})</em>. Soin base = 1d4.
    </p>`;

  if (pmDelta !== 0) {
    html += `<div class="cs-sort-pm-bar">
      <span>🧙</span>
      <span class="cs-sort-pm-bar-label">Set Léger</span>
      <span class="cs-sort-pm-bar-arrow">→ coût des sorts</span>
      <span class="cs-sort-pm-bar-val">${pmDelta > 0 ? '+' : ''}${pmDelta} PM</span>
      <span class="cs-sort-pm-bar-note">(appliqué automatiquement)</span>
    </div>`;
  }

  if (allSorts.length === 0) {
    html += `<div class="cs-empty">🔮 Aucun sort créé</div>`;
  } else {
    allCats.forEach(cat => {
      const entries = sortsByCat[cat.id] || [];
      if (!entries.length) return;
      if (cats.length > 0) {
        html += `<div class="cs-sort-cat-hdr" style="--cat-col:${cat.couleur}">
          <span class="cs-sort-cat-name">${cat.nom}</span>
          <span class="cs-sort-cat-count">${entries.length} sort${entries.length>1?'s':''}</span>
        </div>`;
      }
      html += `<div class="cs-sort-list" data-cat="${cat.id}">`;
      entries.forEach(({ s, globalIdx: i }) => {
        html += _renderSortRow(s, i, openIdx, canEdit, armeDeg, c, pmDelta);
      });
      html += `</div>`;
    });
  }

  html += `</div>`;
  return html;
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

  // Chips clés pour la ligne compacte
  const chips = [];
  if (types.includes('offensif')) {
    const degBase = _calcSortDegats(s, c); // inclut chaînage + maîtrise
    let val = degBase;
    if (statMod !== 0) val += ` · ${statLbl}${statModS}`;
    chips.push({ icon:'⚔️', val, color:'#ff6b6b' });
  }
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (mode === 'soin') {
      // Override MJ : soin = fraction des dégâts
      if (s.soinFraction && s.soinFraction > 0) {
        chips.push({ icon:'💚', val: `${Math.round(s.soinFraction*100)}% dégâts`, color:'#22c38e' });
      } else {
        const soinBase = _calcSortSoin(s, c); // inclut maîtrise
        chips.push({ icon:'💚', val: soinBase, color:'#22c38e' });
      }
    } else {
      // Mode CA — sauf si combo Bouclier réactif (réaction = pas de bonus CA)
      const isReactiveShield = _activeCombos(s).some(co => co.id === 'bouclier_reactif');
      if (isReactiveShield) {
        chips.push({ icon:'🛡️', val:'Bloque 1', color:'#22c38e' });
      } else {
        chips.push({ icon:'🛡️', val:_getSortCA(s), color:'#22c38e' });
      }
    }
  }
  if (nbCibles > 1) chips.push({ icon:'🎯', val:`×${nbCibles}`, color:'#4f8cff' });
  const zone  = _calcSortZone(s);
  if (zone)  chips.push({ icon:'📐', val:`${zone.w}×${zone.h}m`, color:'#b47fff' });
  const depl  = _calcSortDeplacement(s);
  if (depl)  chips.push({ icon: depl.mode==='push' ? '↗' : '↙', val:`${depl.distance}m`, color:'#e8b84b' });
  const duree = _calcSortDuree(s);
  if (duree) chips.push({ icon:'⏱️', val:`${duree}t`, color:'#9ca3af' });
  if (runesAll.includes('Enchantement')) {
    const slot = s.enchantSlot || 'arme';
    if (slot === 'arme') {
      const degAuto = _calcEnchantDegats(s);
      if (degAuto) chips.push({ icon:'✨', val: degAuto, color:'#e8b84b' });
    } else {
      const icons = { tete:'👁️', torse:'👕', pieds:'👢' };
      chips.push({ icon: icons[slot] || '✨', val: (s.enchantEffect||'').slice(0,14) || 'Enchant', color:'#e8b84b' });
    }
  }
  if (runesAll.includes('Affliction')) {
    const slot = s.afflictionSlot || 'arme';
    const icons = { arme:'⚔️', tete:'👁️', torse:'👕', pieds:'👢' };
    chips.push({ icon: icons[slot] || '💀', val: (s.afflictionEffect||'').slice(0,14) || 'Affliction', color:'#8b5cf6' });
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
    <div class="cs-sort-compact" onclick="toggleSortDetail(${i})">
      <div class="toggle ${s.actif?'on':''}"
        onclick="event.stopPropagation();${canEdit?`toggleSort(${i})`:''}"
        title="${s.actif?'Désactiver':'Activer'}"></div>
      <span class="cs-sort-compact-nom">${s.icon ? `<span class="cs-sort-icon" title="Icône du sort">${_esc(s.icon)}</span> ` : ''}${_esc(s.nom||'Sans nom')}${s.mjValidated ? ' <span class="cs-sort-validated" title="Sort validé par le MJ">✅</span>' : ''}</span>
      <div class="cs-sort-compact-chips">
        ${chips.map(ch => `<span class="cs-sort-sstat" style="--c:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('')}
        <span class="cs-sort-sstat cs-sort-sstat--dim" style="--c:${acfg.color}">${acfg.label}</span>
        ${concentration ? `<span class="cs-sort-sstat cs-sort-sstat--dim" style="--c:#60a5fa">🧠</span>` : ''}
      </div>
      <span class="cs-sort-compact-pm">${pmVal} PM</span>
      ${canEdit ? `<div class="cs-sort-compact-acts" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="editSort(${i})">✏️</button>
        <button class="btn-icon" onclick="deleteSort(${i})">🗑️</button>
      </div>` : ''}
      <span class="cs-sort-compact-chev">${isOpen?'▲':'▼'}</span>
    </div>

    <!-- Description toujours visible (clamped 2 lignes) -->
    ${s.effet ? `<div class="cs-sort-desc-preview" onclick="toggleSortDetail(${i})">${_esc(s.effet)}</div>` : ''}

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
        <button class="btn-icon" style="font-size:.72rem" onclick="window._editSortCat(${i})">✏️</button>
        <button class="btn-icon" style="font-size:.72rem;color:#ff6b6b" onclick="window._delSortCat(${i})">🗑️</button>
      </div>`).join('')}
      ${cats.length === 0 ? `<div style="text-align:center;padding:1rem;color:var(--text-dim);font-size:.8rem;font-style:italic">Aucune catégorie</div>` : ''}
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.75rem">
      ${COLORS.map(col => `<button onclick="window._addSortCat('${col}')"
        style="width:28px;height:28px;border-radius:50%;background:${col};border:2px solid transparent;
        cursor:pointer;transition:transform .1s" onmouseover="this.style.transform='scale(1.2)'"
        onmouseout="this.style.transform=''" title="Créer une catégorie ${col}"></button>`).join('')}
      <span style="font-size:.75rem;color:var(--text-dim);align-self:center;margin-left:.25rem">← clique pour créer</span>
    </div>
    <button class="btn btn-outline btn-sm" style="width:100%;margin-top:.75rem" onclick="closeModal()">Fermer</button>
  `);
}

window._addSortCat = async (couleur) => {
  const nom = prompt('Nom de la catégorie :');
  if (!nom?.trim()) return;
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  cats.push({ id: `cat_${Date.now()}`, nom: nom.trim(), couleur });
  c.sort_cats = cats;
  await updateInCol('characters', c.id, { sort_cats: cats });
  showNotif('Catégorie créée !', 'success');
  openSortCatEditor();
  window.renderCharSheet(c, 'sorts');
};

window._editSortCat = async (idx) => {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  const nom = prompt('Renommer :', cats[idx].nom);
  if (!nom?.trim()) return;
  cats[idx].nom = nom.trim();
  c.sort_cats = cats;
  await updateInCol('characters', c.id, { sort_cats: cats });
  openSortCatEditor();
  window.renderCharSheet(c, 'sorts');
};

window._delSortCat = async (idx) => {
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
  window.renderCharSheet(c, 'sorts');
};


export function toggleSortDetail(idx) {
  window._openSortIdx = window._openSortIdx === idx ? null : idx;
  window._renderTab('sorts', window._currentChar, window._canEditChar);
}


// ── Éditeur de sorts ──────────────────────────────────────────────────────────
export function addSort() { openSortModal(-1, {}); }
export function editSort(idx) { openSortModal(idx, (STATE.activeChar?.deck_sorts||[])[idx]); }

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
      return {
        main:  `+${cnt}d4 soin OU +${cnt*2} CA · sur 1 cible (2 tours)`,
        chain: cnt > 1 ? `🔗 Chaîné +${chainSoin} soin · OU +${chainCA} CA (Protection ×${cnt})` : null,
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
        main:  cnt === 1 ? 'Arme/Tête/Torse/Pieds allié · 2 tours · Action Bonus' : `${cnt} cibles alliées · 2 tours`,
        chain: cnt > 1 ? `🔗 Chaîné +1 cible/rune (Enchantement ×${cnt})` : null,
      };
    case 'Affliction':
      return {
        main:  cnt === 1 ? 'Arme/Tête/Torse/Pieds ennemi · 2 tours · Action' : `${cnt} cibles ennemies · 2 tours`,
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
  const counts = window._runeCountsEdit || {};
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
        <button type="button" class="cs-rune-btn minus" onclick="runeDecrement('${r.nom}')">−</button>
        <button type="button" class="cs-rune-btn plus"  onclick="runeIncrement('${r.nom}')">+</button>
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
            style="--rune-c:${r.color}" onclick="runeIncrement('${r.nom}')"
            title="${r.effet}">
            <span class="cs-rune-pick-icon">${r.icon}</span>
            <span class="cs-rune-pick-nom">${r.nom}</span>
            <span class="cs-rune-pick-add">+ Ajouter</span>
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
  window._spellMatricesCache = matrices;
  window._damageTypesCache   = allTypes;
  // Tous les types de dégâts sont proposables comme noyau (y compris Physique).
  // Le MJ contrôle la liste via la console.
  const NOYAUX = allTypes;
  const RUNES = RUNE_META; // alias local pour compat ascendante

  const runesSrc = s?.runes||[];
  const runeCounts = {};
  runesSrc.forEach(r => { runeCounts[r] = (runeCounts[r]||0) + 1; });
  window._runeCountsEdit = { ...runeCounts };

  // Noyau : id de type (nouveau) ou migration depuis label (ancien)
  let noyauTypeIdSel = s?.noyauTypeId || '';
  if (!noyauTypeIdSel && s?.noyau) {
    // Migration : chercher par label ou par label partiel (ex: 'Feu 🔥' → 'feu')
    const legacy = NOYAUX.find(n =>
      n.label === s.noyau ||
      s.noyau.toLowerCase().startsWith(n.label.toLowerCase())
    );
    noyauTypeIdSel = legacy?.id || '';
  }
  const noyauSel      = noyauTypeIdSel
    ? (NOYAUX.find(n => n.id === noyauTypeIdSel)?.label || s?.noyau || '')
    : (s?.noyau || '');
  // Pas de type par défaut sur un sort nouveau — l'utilisateur choisit. Compat legacy uniquement.
  const typesInit = Array.isArray(s?.types) ? s.types
    : (s?.typeSoin ? ['defensif'] : (s?.noyau ? ['offensif'] : []));

  window._sortTypesEdit  = new Set(typesInit);
  window._sortActionEdit = s?.actionOverride || null;
  window._deplModeEdit   = s?.deplacement?.mode || null;

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
      onclick="window._toggleSortType('${t.v}')"
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
    const isSel = (window._sortActionEdit === a.v);
    return `<button type="button" id="s-action-${a.v??'auto'}"
      onclick="window._selectSortAction(${a.v===null?'null':`'${a.v}'`})"
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
      onclick="window._selectDeplMode(${opt.v===null?'null':`'${opt.v}'`})"
      style="flex:1;padding:.3rem .2rem;border-radius:7px;font-size:.7rem;cursor:pointer;transition:all .15s;
        border:2px solid ${sel?opt.col:'var(--border)'};
        background:${sel?opt.col+'20':'var(--bg-elevated)'};
        color:${sel?opt.col:'var(--text-dim)'};
        font-weight:${sel?'700':'400'}">${opt.label}</button>`;
  }).join('');

  openModal(idx>=0?'✏️ Modifier le Sort':'✨ Nouveau Sort', `
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
        <input class="input-field cs-spell-icon-input" id="s-icon" value="${s?.icon||''}" maxlength="3"
          placeholder="🔥" title="Emoji ou caractère court · vide = icône du noyau">
      </div>
      <div class="cs-spell-identity-field cs-spell-identity-field--name"><label>Nom du sort</label>
        <input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu, Vague de soin…">
      </div>
      <div class="cs-spell-identity-field"><label>Catégorie</label>
        <select class="input-field" id="s-catid">
          <option value="">— Aucune —</option>
          ${(STATE.activeChar?.sort_cats||[]).map(cat =>
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
      <div class="cs-spell-section-title">🌀 Noyau élémentaire <span class="cs-spell-section-hint">cœur du sort · 2 PM · obligatoire</span></div>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.map(n => `<div class="cs-noyau-btn ${noyauTypeIdSel===n.id?'selected':''}"
             style="${noyauTypeIdSel===n.id ? `border-color:${n.color};background:${n.color}20;color:${n.color}` : ''}"
             onclick="selectNoyau(this,'${n.id}','${n.label} ${n.icon}','${n.color}')"
             data-noyau-id="${n.id}">${n.icon} ${n.label}</div>`).join('')}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
      <input type="hidden" id="s-noyau-id" value="${noyauTypeIdSel}">
    </div>

    <!-- ④ Runes — Forge -->
    <div class="cs-spell-section cs-spell-section--runes">
      <div class="cs-spell-section-title">🔮 Runes <span class="cs-spell-section-hint">+2 PM par rune · cumulables · chaînage par même rune</span></div>
      <div id="cs-runes-section">${runesSectionHtml}</div>
    </div>

    <!-- ⑤ Champs conditionnels auto-affichés -->

    <!-- Dégâts — visible si type offensif (auto-val avec toggle Custom) -->
    <div id="s-degats-section" style="${typesInit.includes('offensif')?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-degats',
        label: '⚔️ Dégâts',
        autoValue:  _calcSortDegats(s || {}, STATE.activeChar),
        autoSource: _autoSourceDegats(s || {}, STATE.activeChar),
        currentValue: s?.degats,
        placeholder: 'ex : 3d8 +2, 2d10 Feu…',
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
            return `<button type="button" id="s-prot-${opt.v}" onclick="window._selectProtMode('${opt.v}')"
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

    <!-- Soin — visible si type Défensif sélectionné OU rune Protection en mode soin (indépendant) -->
    <div id="s-soin-section" style="${(typesInit.includes('defensif') || (hasProt && (s?.protectionMode||'ca')==='soin'))?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-soin',
        label: '💚 Soin',
        autoValue:  _calcSortSoin(s || {}, STATE.activeChar),
        autoSource: _autoSourceSoin(s || {}),
        currentValue: s?.soin,
        placeholder: 'ex : 3d6 +2, moitié des dégâts…',
      })}
    </div>

    <!-- Enchantement — visible si rune Enchantement > 0 -->
    <div id="s-enchant-section" class="cs-spell-slot-box cs-spell-slot-box--ench" style="${hasEnchant?'':'display:none'}">
      <div class="cs-spell-slot-title">✨ Enchantement <span>Cible alliée · 2 tours · Action Bonus</span></div>
      <div class="form-group">
        <label>Slot enchanté</label>
        <div class="cs-slot-grid">
          ${SPELL_SLOTS.map(opt => {
            const cur = s?.enchantSlot || 'arme';
            const sel = cur === opt.v;
            return `<button type="button" id="s-enchant-slot-${opt.v}"
              onclick="window._selectSpellSlot('enchant','${opt.v}')"
              class="cs-slot-btn ${sel?'selected':''}">${opt.label}</button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-enchant-slot" value="${s?.enchantSlot||'arme'}">
      </div>
      <div class="form-group">
        <label>Effet de l'enchantement <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">texte libre — décris l'effet thématique</span></label>
        <div id="s-enchant-suggest" class="cs-spell-suggest" style="display:none">
          <span class="cs-spell-suggest-icon">💡</span>
          <span class="cs-spell-suggest-label">Suggéré :</span>
          <span class="cs-spell-suggest-val" id="s-enchant-suggest-val"></span>
          <button type="button" class="cs-spell-suggest-btn" onclick="window._applySpellSuggest('enchant')">↓ Appliquer</button>
        </div>
        <textarea class="input-field" id="s-enchant-effect" rows="2"
          oninput="window._markSpellEffectTouched('enchant')"
          placeholder="ex : Vision Nocturne (Lumière+Tête), Vitesse +2 (Vent+Pieds)…">${s?.enchantEffect||''}</textarea>
      </div>
      <div id="s-enchant-degats-row" style="${(s?.enchantSlot||'arme')==='arme'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-enchant-degats',
          label: '⚔️ Dégâts bonus sur l\'arme enchantée',
          autoValue:  _calcEnchantDegats(s || {}),
          autoSource: _autoSourceEnchantDeg(s || {}),
          currentValue: s?.enchantDegats,
          placeholder: 'ex : +1d6 Feu, +2 Foudre, 1d8…',
        })}
      </div>
    </div>

    <!-- Affliction — visible si rune Affliction > 0 -->
    <div id="s-affliction-section" class="cs-spell-slot-box cs-spell-slot-box--aff" style="${runesSrc.includes('Affliction')?'':'display:none'}">
      <div class="cs-spell-slot-title">💀 Affliction <span>Cible ennemie · 2 tours · Action</span></div>
      <div class="form-group">
        <label>Slot affligé</label>
        <div class="cs-slot-grid">
          ${SPELL_SLOTS.map(opt => {
            const cur = s?.afflictionSlot || 'arme';
            const sel = cur === opt.v;
            return `<button type="button" id="s-affliction-slot-${opt.v}"
              onclick="window._selectSpellSlot('affliction','${opt.v}')"
              class="cs-slot-btn ${sel?'selected':''}">${opt.label}</button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-affliction-slot" value="${s?.afflictionSlot||'arme'}">
      </div>
      <div class="form-group">
        <label>Effet de l'affliction <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">texte libre — décris l'effet thématique</span></label>
        <div id="s-affliction-suggest" class="cs-spell-suggest cs-spell-suggest--aff" style="display:none">
          <span class="cs-spell-suggest-icon">💡</span>
          <span class="cs-spell-suggest-label">Suggéré :</span>
          <span class="cs-spell-suggest-val" id="s-affliction-suggest-val"></span>
          <button type="button" class="cs-spell-suggest-btn" onclick="window._applySpellSuggest('affliction')">↓ Appliquer</button>
        </div>
        <textarea class="input-field" id="s-affliction-effect" rows="2"
          oninput="window._markSpellEffectTouched('affliction')"
          placeholder="ex : Cécité (Lumière+Tête), DoT 1d4+2/tour (Feu+Torse), Entrave (Terre+Pieds)…">${s?.afflictionEffect||''}</textarea>
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

    <!-- ⑧ Durée de base — visible si rune Durée OU Protection mode CA OU rune Enchant/Affliction -->
    <div id="s-duree-base-section" class="form-group cs-duree-section" style="${_needsDureeBase(s)?'':'display:none'}">
      <label>⏳ Durée de base <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">tours (min 2) · les runes Durée s'ajoutent par-dessus</span></label>
      <div style="display:flex;gap:.4rem;align-items:center">
        <input type="number" class="input-field" id="s-duree-base" min="2" max="100"
          value="${s?.dureeBase||''}" placeholder="—" style="width:70px;text-align:center;padding:.3rem">
        <span style="font-size:.8rem;color:var(--text-dim)">tours</span>
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

      <!-- Validation MJ : toggle switch (admins) / badge lecture seule (joueurs) -->
      ${STATE.isAdmin ? `<div class="cs-mj-validation ${s?.mjValidated?'is-on':''}">
        <input type="checkbox" id="s-mj-validated" ${s?.mjValidated?'checked':''}
          onchange="this.closest('.cs-mj-validation').classList.toggle('is-on', this.checked)">
        <label for="s-mj-validated" class="cs-mj-validation-label">
          <span class="cs-mj-validation-switch"><span class="cs-mj-validation-thumb"></span></span>
          <span class="cs-mj-validation-info">
            <span class="cs-mj-validation-title">Validation MJ</span>
            <span class="cs-mj-validation-sub">Marque ce sort comme officiellement approuvé</span>
          </span>
          <span class="cs-mj-validation-state"></span>
        </label>
      </div>` : (s?.mjValidated ? '<div class="cs-mj-validation cs-mj-validation--readonly is-on"><span class="cs-mj-validation-state"></span><span class="cs-mj-validation-info"><span class="cs-mj-validation-title">Sort validé par le MJ</span></span></div>' : '')}

      <div class="form-group" style="margin-bottom:.4rem">
        <label style="font-size:.72rem">Soin = fraction des dégâts <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(override des runes Protection·soin)</span></label>
        <select class="input-field" id="s-soin-fraction" style="padding:.3rem .5rem;font-size:.78rem">
          ${[['', '— Non, utiliser les runes —'],['0.25','25% des dégâts'],['0.5','50% des dégâts'],['0.75','75% des dégâts'],['1','100% des dégâts']]
            .map(([v,lbl]) => `<option value="${v}" ${String(s?.soinFraction||'')===v?'selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>

      <div class="form-group" style="margin-bottom:.4rem">
        <label style="font-size:.72rem">Zone override (override des runes Amplification) <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">force une zone W×H spécifique</span></label>
        <div style="display:flex;gap:.35rem;align-items:center">
          <input type="number" class="input-field" id="s-zone-w" min="1" max="50"
            value="${s?.zoneW||''}" placeholder="—" style="width:55px;text-align:center;padding:.3rem">
          <span style="font-size:.85rem;color:var(--text-dim);font-weight:600">×</span>
          <input type="number" class="input-field" id="s-zone-h" min="1" max="50"
            value="${s?.zoneH||''}" placeholder="—" style="width:55px;text-align:center;padding:.3rem">
          <span style="font-size:.8rem;color:var(--text-dim)">m</span>
        </div>
      </div>

      <div class="form-group" style="margin-bottom:0">
        <label style="font-size:.72rem">Notes / restrictions <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(affichées dans la fiche)</span></label>
        <textarea class="input-field" id="s-mj-notes" rows="2" placeholder="ex : soin va uniquement au lanceur">${s?.mjNotes||''}</textarea>
      </div>
    </div>

    </div><!-- /grid-col--right -->
   </div><!-- /cs-spell-grid -->

    <button class="btn btn-gold cs-spell-save" style="width:100%" onclick="saveSort(${idx})">💾 Enregistrer le sort</button>
   </div><!-- /cs-spell-forge -->
  `);

  setTimeout(() => {
    updateSortPM();
    window._updateSortActionDisplay();
    _updateSortPreview();
    // Listeners génériques pour rafraîchir la preview à chaque saisie
    const modal = document.querySelector('.modal');
    if (modal && !modal.dataset.previewBound) {
      modal.dataset.previewBound = '1';
      modal.addEventListener('input',  _updateSortPreview);
      modal.addEventListener('change', _updateSortPreview);
    }
  }, 50);
}

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
    const active = window._sortTypesEdit.has(t);
    btn.style.borderColor  = active ? color : 'var(--border)';
    btn.style.background   = active ? color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
  _refreshConditionalSections();
  window._updateSortPreview?.();
}

/** Met à jour la visibilité des sections Dégâts/Soin selon types + runes + mode protection. */
function _refreshConditionalSections() {
  const isOffensive = window._sortTypesEdit.has('offensif');
  const isDefensive = window._sortTypesEdit.has('defensif');
  const counts      = window._runeCountsEdit || {};
  const hasProt     = (counts.Protection || 0) > 0;
  const protMode    = document.getElementById('s-prot-mode')?.value || 'ca';
  const dSec = document.getElementById('s-degats-section');
  const sSec = document.getElementById('s-soin-section');
  if (dSec) dSec.style.display = isOffensive ? '' : 'none';
  if (sSec) sSec.style.display = (isDefensive || (hasProt && protMode === 'soin')) ? '' : 'none';
}

window._toggleSortType = (type) => {
  if (window._sortTypesEdit.has(type)) window._sortTypesEdit.delete(type);
  else window._sortTypesEdit.add(type);
  _applyTypeChange();
};

window._selectSortAction = (val) => {
  window._sortActionEdit = val === 'auto' ? null : val;
  window._updateSortActionDisplay();
  window._updateSortPreview?.();
};

window._updateSortActionDisplay = () => {
  const ACTION_CFG = {
    null:         { label:'Auto',            color:'#9ca3af' },
    action:       { label:'⚡ Action',        color:'#e8b84b' },
    action_bonus: { label:'✴️ Action Bonus',  color:'#f97316' },
    reaction:     { label:'🔄 Réaction',      color:'#a78bfa' },
  };
  const cur = window._sortActionEdit;
  Object.entries(ACTION_CFG).forEach(([v, cfg]) => {
    const btn = document.getElementById(`s-action-${v === 'null' ? 'auto' : v}`);
    if (!btn) return;
    const active = (cur === null && v === 'null') || cur === v;
    btn.style.borderColor  = active ? cfg.color : 'var(--border)';
    btn.style.background   = active ? cfg.color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? cfg.color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
};

window._selectDeplMode = (mode) => {
  window._deplModeEdit = mode;
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
  window._updateSortPreview?.();
};

window._selectProtMode = (mode) => {
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
  window._updateSortPreview?.();
};

export function runeIncrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  const prevCnt = window._runeCountsEdit[nom] || 0;
  window._runeCountsEdit[nom] = prevCnt + 1;
  // Intelligence : la 1ère Puissance ajoute Offensif · la 1ère Protection ajoute Défensif
  // (l'utilisateur peut décocher ensuite, on ne force pas)
  if (prevCnt === 0 && window._sortTypesEdit) {
    if (nom === 'Puissance'  && !window._sortTypesEdit.has('offensif')) {
      window._sortTypesEdit.add('offensif');
      _applyTypeChange();
    }
    if (nom === 'Protection' && !window._sortTypesEdit.has('defensif')) {
      window._sortTypesEdit.add('defensif');
      _applyTypeChange();
    }
  }
  _refreshRunesSection(nom);
}

export function runeDecrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  if ((window._runeCountsEdit[nom]||0) <= 0) return;
  window._runeCountsEdit[nom]--;
  if (window._runeCountsEdit[nom] === 0) delete window._runeCountsEdit[nom];
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
  const cnt = window._runeCountsEdit[changedNom] || 0;
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
window._enableSortCustom = (fieldId) => {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  if (display) display.style.display = 'none';
  if (edit)    edit.style.display = '';
  if (input) { input.focus(); input.select?.(); }
};

/** Repasse en mode "Auto" — vide le champ override, revient au chip. */
window._disableSortCustom = (fieldId) => {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  if (input)   input.value = '';
  if (edit)    edit.style.display = 'none';
  if (display) display.style.display = '';
  _refreshAutoValChips();
  window._updateSortPreview?.();
};

/** Recalcule les valeurs affichées dans les chips auto (dégâts, soin, CA, enchant). */
function _refreshAutoValChips() {
  const s = _buildSortFromDOM();
  const c = STATE.activeChar;
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
}
window._refreshAutoValChips = _refreshAutoValChips;

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
  const matrices = window._spellMatricesCache;
  if (!matrices) return;
  const noyauId  = document.getElementById('s-noyau-id')?.value || '';
  const enchSlot = document.getElementById('s-enchant-slot')?.value || 'arme';
  const affSlot  = document.getElementById('s-affliction-slot')?.value || 'arme';

  const applySuggestion = (cat, suggestion) => {
    const wrap = document.getElementById(`s-${cat}-suggest`);
    const valEl = document.getElementById(`s-${cat}-suggest-val`);
    const txtEl = document.getElementById(`s-${cat}-effect`);
    if (!wrap) return;
    if (!suggestion) { wrap.style.display = 'none'; return; }
    if (valEl) valEl.textContent = suggestion;
    wrap.style.display = '';
    // Pré-remplissage agressif : textarea vide → injection automatique
    if (txtEl && !txtEl.value.trim() && !txtEl.dataset.userTouched) {
      txtEl.value = suggestion;
    }
  };

  applySuggestion('enchant',    suggestSpellEffect(matrices, 'enchant',    noyauId, enchSlot));
  applySuggestion('affliction', suggestSpellEffect(matrices, 'affliction', noyauId, affSlot));
}

// Marque la textarea comme "touchée par l'utilisateur" dès qu'il y tape :
// empêche le pré-remplissage agressif d'écraser ses changements ultérieurs.
window._markSpellEffectTouched = (cat) => {
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (txtEl) txtEl.dataset.userTouched = '1';
};
window._refreshSpellSuggestions = _refreshSpellSuggestions;

/**
 * Applique la suggestion en cours dans la textarea d'effet.
 * cat = 'enchant' | 'affliction'
 */
window._applySpellSuggest = (cat) => {
  const valEl = document.getElementById(`s-${cat}-suggest-val`);
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (!valEl || !txtEl) return;
  txtEl.value = valEl.textContent || '';
  txtEl.dispatchEvent(new Event('input', { bubbles: true })); // trigger preview update
  txtEl.focus();
};

/**
 * Sélectionne un slot pour Enchantement ou Affliction.
 * groupId : 'enchant' ou 'affliction'
 */
window._selectSpellSlot = (groupId, slotV) => {
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
  window._updateSortPreview?.();
};

export function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(window._runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
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
  Object.entries(window._runeCountsEdit||{}).forEach(([nom, cnt]) => {
    for (let i=0; i<cnt; i++) runes.push(nom);
  });
  const types = [...(window._sortTypesEdit || new Set(['utilitaire']))];
  const zoneW = parseInt(document.getElementById('s-zone-w')?.value) || 0;
  const zoneH = parseInt(document.getElementById('s-zone-h')?.value) || 0;
  const dureeBase = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = window._deplModeEdit || null;
  const deplDist = deplMode ? (parseInt(document.getElementById('s-depl-dist')?.value) || 1) : 0;
  const fracRaw  = document.getElementById('s-soin-fraction')?.value || '';
  const iconRaw  = document.getElementById('s-icon')?.value || '';
  const mjValid  = document.getElementById('s-mj-validated')?.checked || false;
  return {
    icon:        iconRaw.trim() || '',
    mjValidated: mjValid,
    noyau, noyauTypeId, runes, types,
    degats: document.getElementById('s-degats')?.value || '',
    soin:   document.getElementById('s-soin')?.value || '',
    ca:     document.getElementById('s-ca')?.value || '',
    effet:  document.getElementById('s-effet')?.value || '',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    actionOverride: window._sortActionEdit || null,
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantSlot:      document.getElementById('s-enchant-slot')?.value || 'arme',
    enchantEffect:    document.getElementById('s-enchant-effect')?.value || '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'arme',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value || '',
    zoneW: zoneW > 0 ? zoneW : null,
    zoneH: zoneH > 0 ? zoneH : null,
    dureeBase: dureeBase >= 2 ? dureeBase : null,
    deplacement: deplMode ? { mode: deplMode, distance: deplDist } : null,
    soinFraction: fracRaw ? parseFloat(fracRaw) : null,
    mjNotes: document.getElementById('s-mj-notes')?.value || '',
  };
}

/** Rafraîchit la preview live dans l'éditeur de sort */
function _updateSortPreview() {
  const body = document.getElementById('s-preview-body');
  if (!body) return;
  const c = STATE.activeChar;
  if (!c) { body.innerHTML = ''; return; }
  // Toujours rafraîchir les chips auto + suggestions matrice en même temps que la preview
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
  if (typeof _refreshSpellSuggestions === 'function') _refreshSpellSuggestions();
  const s = _buildSortFromDOM();
  const lines = _buildSortResume(s, c);
  body.innerHTML = lines.map(l => `
    <div class="cs-spell-preview-row ${l.isCombo ? 'cs-spell-preview-row--combo' : ''}">
      ${l.icon ? `<span class="cs-spell-preview-icon">${l.icon}</span>` : '<span class="cs-spell-preview-icon"></span>'}
      <span class="cs-spell-preview-label">${_esc(l.label)}</span>
      ${l.detail ? `<span class="cs-spell-preview-detail">${_esc(l.detail)}</span>` : ''}
    </div>
  `).join('');
}
window._updateSortPreview = _updateSortPreview;

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
  // Le changement de noyau affecte le calcul des soins (magique → arme · physique → Con)
  // et les suggestions matrice (Enchant/Affliction · Protection CA)
  updateSortPM();
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
}


export async function saveSort(idx) {
  try {
    const c = STATE.activeChar; if(!c) return;
    const sorts = c.deck_sorts||[];
    const noyau       = document.getElementById('s-noyau')?.value||'';
    const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';

    // Runes depuis _runeCountsEdit
    const runes = [];
    Object.entries(window._runeCountsEdit||{}).forEach(([nom, cnt]) => {
      for (let i=0; i<cnt; i++) runes.push(nom);
    });

    const totalRunes = (noyau ? 1 : 0) + runes.length;
    const autoPm     = totalRunes * 2 || 2;

    // Types (multi)
    const types = [...(window._sortTypesEdit || new Set(['utilitaire']))];

    // Action override (null = auto)
    const actionOverride = window._sortActionEdit || null;

    const zoneWRaw = parseInt(document.getElementById('s-zone-w')?.value) || 0;
    const zoneHRaw = parseInt(document.getElementById('s-zone-h')?.value) || 0;
    const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
    const deplMode = window._deplModeEdit || null;
    const deplDist = deplMode ? (parseInt(document.getElementById('s-depl-dist')?.value) || 1) : 0;

    // Validation MJ : seuls les admins peuvent la modifier ; sinon on garde la valeur existante
    const prevValidated = idx >= 0 ? !!sorts[idx]?.mjValidated : false;
    const mjValidated   = STATE.isAdmin
      ? (document.getElementById('s-mj-validated')?.checked || false)
      : prevValidated;

    const newSort = {
      icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
      mjValidated,
      nom:      document.getElementById('s-nom')?.value||'Sort',
      pm:       autoPm,
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
      enchantSlot:      document.getElementById('s-enchant-slot')?.value || 'arme',
      enchantEffect:    document.getElementById('s-enchant-effect')?.value || '',
      afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'arme',
      afflictionEffect: document.getElementById('s-affliction-effect')?.value || '',
      zoneW: zoneWRaw > 0 ? zoneWRaw : null,
      zoneH: zoneHRaw > 0 ? zoneHRaw : null,
      dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
      deplacement: deplMode ? { mode: deplMode, distance: deplDist } : null,
      soinFraction: parseFloat(document.getElementById('s-soin-fraction')?.value) || null,
      mjNotes:      document.getElementById('s-mj-notes')?.value?.trim() || '',
    };
    if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
    c.deck_sorts=sorts;
    await updateInCol('characters',c.id,{deck_sorts:sorts});
    closeModal();
    showNotif(`Sort enregistré — ${newSort.pm} PM`, 'success');
    window.renderCharSheet(c,'sorts');
  } catch (e) { notifySaveError(e); }
}
