// ══════════════════════════════════════════════════════════════════════════════
// SPELL-SHEET-LINES.JS — état d'un sort → lignes ORDONNÉES de la fiche (forge)
// ══════════════════════════════════════════════════════════════════════════════
// Fonction PURE (aucune dépendance DOM/Firebase) extraite de
// `_refreshConditionalSections` (features/characters/spells.js), pour la refonte
// « lire = régler » de la modal de sorts. Elle décide QUELLES lignes apparaissent,
// dans quel ORDRE, et quels contrôles chaque ligne porte — pas les VALEURS, qui
// restent calculées au rendu par _calcSortDegats/_getSortCA/… (impurs, contexte
// personnage). Testée dans tests/spell-sheet-lines.test.js.
//
// L'ORDRE est CANONIQUE et fixe : une ligne qui apparaît ne décale JAMAIS celles
// du dessus (sinon on recliquerait au mauvais endroit). Les inclusions/exclusions
// se font par prédicat, jamais par réordonnancement.
// ══════════════════════════════════════════════════════════════════════════════

export const ACTION_RUNE = 'Déclenchement';

/**
 * @typedef {Object} SheetLineState
 * @property {string[]|Set<string>} types      - 'offensif' | 'defensif' | 'utilitaire'
 * @property {Record<string,number>} counts    - { nomRune: nombre }
 * @property {string} [protMode]   - 'ca' | 'soin' | 'mana'  (défaut 'ca')
 * @property {string} [ampMode]    - 'zone' | 'deplacement'  (défaut 'zone')
 * @property {string} [afflMode]   - 'dot' | 'etat' | 'laceration' (défaut 'dot')
 * @property {string} [enchMode]   - 'dmg' | 'etat'          (défaut 'etat')
 * @property {string} [zoneShape]  - 'rect' | 'cross'        (défaut 'rect')
 * @property {string} [actionMode] - 'reaction' | 'action_bonus' (défaut 'reaction')
 */

/**
 * @typedef {Object} SheetLine
 * @property {string} slot   - regroupement canonique ('attack','prot','regen','ench','affl','zone','inv','trig','mods')
 * @property {string} id     - id stable de la ligne ('hit','dmg','prot','soin','regen','ench','affl','amp','shape','disp','inv','trig','mods')
 * @property {string} icon
 * @property {{key:string,hiddenId:string,opts:Array<[string,string]>}} [segment] - contrôle de mode inline (écrit un input caché)
 * @property {{fieldId?:string,statId?:string,statOnly?:boolean}} [override]       - tiroir « régler » (_autoValHtml)
 * @property {{hiddenId:string,label:string,saveStatId?:string}} [select]          - sélecteur d'état
 * @property {boolean} [sub]   - sous-ligne (rendue sous son parent, ex. forme de zone)
 * @property {boolean} [drain] - combo Drain (indicateur % au lieu du montant)
 * @property {boolean} [reactiveShield] - combo Bouclier réactif (« bloque 1 attaque », pas d'override)
 * @property {boolean} [sentinelle]      - Affliction portée par la sentinelle (pas de segment/override)
 * @property {boolean} [invocationConfig]- ligne d'invocation générique (config via modale)
 * @property {boolean} [portedNote]      - note « Lacération portée »
 * @property {boolean} [enchant]         - ligne Enchantement (slots supplémentaires gérés au rendu)
 * @property {'damage'|'heal'} [mastery] - place le toggle de maîtrise sur cette ligne
 * @property {string[]} [chips]          - modificateurs read-only (Chance/Concentration)
 */

/**
 * @param {SheetLineState} state
 * @returns {SheetLine[]} lignes ordonnées (vide = aucun effet → état vide côté rendu)
 */
export function computeSheetLines(state = {}) {
  const counts    = state.counts || {};
  const types     = Array.isArray(state.types) ? state.types : [...(state.types || [])];
  const protMode  = state.protMode || 'ca';
  const ampMode   = state.ampMode  || 'zone';
  const afflMode  = state.afflMode || 'dot';
  const enchMode  = state.enchMode || 'etat';
  const zoneShape = ['cross', 'cone', 'ring'].includes(state.zoneShape) ? state.zoneShape : 'rect';
  const actionMode = state.actionMode || 'reaction';
  const has = (n) => (counts[n] || 0) > 0;

  const isOffensive = types.includes('offensif');
  const isSupport   = types.includes('defensif');
  const hasProt = has('Protection');
  const hasAmp = has('Amplification');
  const hasEnchant = has('Enchantement');
  const hasAffliction = has('Affliction');
  const anyInvoc = has('Invocation');
  const isDepl = ampMode === 'deplacement';
  const isLaceration = has('Lacération') || (hasAffliction && afflMode === 'laceration');
  // Combo Régénération : Protection + Affliction (hors mode Lacération). Il REMPLACE
  // les lignes Protection et Affliction (elles se masquent), il ne s'insère pas entre.
  const isRegen = hasProt && hasAffliction && afflMode !== 'laceration';
  const hasReac = has('Réaction') || (has(ACTION_RUNE) && actionMode === 'reaction');
  const isCoupChance = has('Chance') && hasReac;
  const hasAfflictionDebuff = hasAffliction && afflMode !== 'laceration';
  const isDrain = isOffensive && hasProt;                 // vol de vie % → masque CA/Soin
  const isAmpSupportHeal = isSupport && hasAmp && !isDepl && !hasProt;

  // Dégâts d'impact : supprimés par Affliction-debuff, Déplacement, Invocation, Coup
  // de chance ; visibles hors « offensif » en mode Lacération (frappe l'attaque de base).
  const attackVisible = (isOffensive || isLaceration)
    && !isCoupChance && !hasAfflictionDebuff && !isDepl && !anyInvoc;
  const soinBearing = !isDrain && !isRegen
    && ((hasProt && (protMode === 'soin' || protMode === 'mana')) || isAmpSupportHeal);

  /** @type {SheetLine[]} */
  const lines = [];

  // 1 · Attaque — Dégâts + Toucher (deux lignes distinctes, comme la maquette).
  // Le jet d'attaque est un 1d20 + mod. de la stat de toucher (réglable) : on ne
  // fabrique aucune formule, on expose la stat existante (s-toucher-stat).
  if (attackVisible) {
    lines.push({ slot: 'attack', id: 'dmg', icon: '⚔️', override: { fieldId: 's-degats', statId: 's-degats-stat' }, mastery: 'damage' });
    lines.push({ slot: 'attack', id: 'hit', icon: '🎯', override: { toucherId: 's-toucher-stat', statOnly: true } });
  }

  // 2 · Protection / Soin (ou Drain / Bouclier réactif) — ou Soin via Amplification
  if (hasProt && !isRegen) {
    const reactiveShield = hasReac && protMode === 'ca';
    const line = { slot: 'prot', id: 'prot', icon: protMode === 'ca' ? '🛡️' : protMode === 'soin' ? '💚' : '💙' };
    if (!isDrain) line.segment = { key: 'protMode', cur: protMode, hiddenId: 's-prot-mode', opts: [['ca', 'CA', '#4f8cff'], ['soin', 'Soin', '#22c38e'], ['mana', 'PM', '#8b5cf6']] };
    if (isDrain) line.drain = true;
    else if (reactiveShield) line.reactiveShield = true;          // pas d'override (valeur = « bloque 1 attaque »)
    else if (protMode === 'ca') line.override = { fieldId: 's-ca' };
    else line.override = { fieldId: 's-soin' };                    // soin / mana : montant réglable
    lines.push(line);
  } else if (isAmpSupportHeal && !isDrain && !isRegen) {
    lines.push({ slot: 'prot', id: 'soin', icon: '💚', override: { fieldId: 's-soin' } });
  }
  // Maîtrise de soin : uniquement s'il n'y a pas de ligne de dégâts (sinon la maîtrise
  // est portée par la ligne Dégâts). Réplique la règle « premier effet qui l'utilise ».
  if (soinBearing && !attackVisible) {
    const soinLine = lines.find((l) => l.slot === 'prot');
    if (soinLine) soinLine.mastery = 'heal';
  }

  // 3 · Régénération (combo, remplace Protection + Affliction)
  if (isRegen) lines.push({ slot: 'regen', id: 'regen', icon: '💚', override: { fieldId: 's-regeneration-formula' } });

  // 4 · Enchantement (le bloc état + les slots supplémentaires sont relocalisés
  // depuis le store dans le tiroir « régler »).
  if (hasEnchant) lines.push({ slot: 'ench', id: 'ench', icon: '✨', enchant: true, select: { hiddenId: 's-enchant-etat', label: 'État' }, slots: ['s-enchant-etat-block', 's-enchant-extra-slots'] });

  // 5 · Affliction (Sentinelle si + Invocation)
  if (hasAffliction && !isRegen) {
    const line = { slot: 'affl', id: 'affl', icon: '💀' };
    if (anyInvoc) {
      line.sentinelle = true;                                     // portée par la sentinelle : pas de réglage
    } else {
      line.segment = { key: 'afflMode', cur: afflMode, hiddenId: 's-affliction-mode', opts: [['dot', 'DoT', '#e8894b'], ['etat', 'État', '#a855f7'], ['laceration', 'Lacér.', '#ff5a7e']] };
      if (afflMode === 'etat') { line.select = { hiddenId: 's-affliction-etat', label: 'État', saveStatId: 's-affliction-save-stat' }; line.slots = ['s-affliction-etat-block']; }
      else if (afflMode === 'dot') line.override = { fieldId: 's-affliction-dot-formula' };
      // laceration : valeur calculée (CA cible −n) → pas d'override
    }
    if (hasEnchant && enchMode === 'etat' && afflMode === 'laceration' && !anyInvoc) line.portedNote = true;
    lines.push(line);
  }

  // 6 · Zone (Amplification = TAILLE, forme au choix) + Dispersion (= nombre de poses)
  if (hasAmp && !hasEnchant) {
    lines.push({ slot: 'zone', id: 'amp', icon: ampMode === 'zone' ? '🌐' : '↔️',
      segment: { key: 'ampMode', cur: ampMode, hiddenId: 's-amp-mode', opts: [['zone', 'Zone', '#4f8cff'], ['deplacement', 'Dépl.', '#f59e42']] } });
    // Forme de zone : débloquée à partir de 2 Amplification (à 1 Amp c'est toujours
    // la ligne 1×3, choisir une forme n'aurait aucun effet).
    if (ampMode === 'zone' && (counts.Amplification || 0) >= 2)
      lines.push({ slot: 'zone', id: 'shape', sub: true, icon: zoneShape === 'cross' ? '✚' : zoneShape === 'cone' ? '🔺' : zoneShape === 'ring' ? '◯' : '▭',
        segment: { key: 'zoneShape', cur: zoneShape, hiddenId: 's-zone-shape', opts: [['rect', '▭', '#4f8cff'], ['cross', '✚', '#a855f7'], ['cone', '🔺', '#f59e42'], ['ring', '◯', '#22c38e']] } });
  }
  // Dispersion : répète l'effet (1 + nDisp). Avec Amp → N zones ; seule → N cibles.
  if (has('Dispersion') && !isRegen)
    lines.push({ slot: 'zone', id: 'disp', icon: '🎯' });         // valeur calculée (poses/cibles)

  // 7 · Invocation générique (hors combos Sentinelle / Arme invoquée)
  if (anyInvoc && !hasAffliction && !hasEnchant)
    lines.push({ slot: 'inv', id: 'inv', icon: '🐾', invocationConfig: true, slots: ['s-invocation-section'] });

  // 8 · Déclenchement (mode de lancer)
  if (has(ACTION_RUNE))
    lines.push({ slot: 'trig', id: 'trig', icon: '⚡',
      segment: { key: 'actionMode', cur: actionMode, hiddenId: 's-action-mode', opts: [['reaction', 'Réac.', '#ec4899'], ['action_bonus', 'Bonus', '#22c38e']] } });

  // 9 · Modificateurs (chips read-only)
  const chips = [];
  if (has('Chance')) chips.push('Chance');
  if (has('Concentration')) chips.push('Concentration');
  if (chips.length) lines.push({ slot: 'mods', id: 'mods', icon: '✦', chips });

  return lines;
}

// ── Actions déléguées existantes pour les segments de mode (registre VTT/actions) ──
const SEG_ACTION = {
  protMode:  '_selectProtMode',
  afflMode:  '_selectAfflictionMode',
  ampMode:   '_selectAmpMode',
  zoneShape: '_selectZoneShape',
  actionMode:'_selectActionMode',
};
const _esc = (v = '') => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Rendu PUR des lignes de la fiche « lire = régler » à partir de computeSheetLines.
 * Les VALEURS sont fournies par `ctx` (calculées au rendu par buildLineCtx, impur) :
 *   ctx[id] = { value, text?, source?, color?, current?, placeholder?, statHtml?,
 *               selectHtml?, extraHtml?, note?, chipLabels? }
 * `tuned` = Set des ids dont le tiroir « régler » est ouvert. Aucun id lu par
 * `_buildSortFromDOM` n'est inventé : les inputs d'override gardent `override.fieldId`
 * / `override.statId`, les selects gardent `select.hiddenId`.
 * @returns {string} HTML de l'intérieur du conteneur de lignes.
 */
export function renderSheetLines(lines = [], ctx = {}, tuned = new Set(), opts = {}) {
  // readonly : aperçu visuel (valeurs + segments interactifs) SANS les tiroirs
  // « régler ». Sinon (édition), les tiroirs utilisent des PROXYS (data-ovr /
  // data-statproxy) qui écrivent dans les vrais inputs cachés du store — jamais
  // d'id dupliqué — et des SLOTS (data-slot) où l'on RELOCALISE les contrôles
  // complexes (états, invocation) du store (relocation gérée au rendu, impur).
  const readonly = !!opts.readonly;
  if (!lines.length) {
    return `<div class="ln-none"><b>Choisis un élément et des runes</b>`
      + `Chaque effet apparaîtra ici, prêt à être lu et réglé sur place.</div>`;
  }
  return lines.map((l) => {
    const c = ctx[l.id] || {};
    if (l.id === 'mods') {
      const chips = (l.chips || []).map((k) => `<span data-mod="${_esc(k)}">${_esc((c.chipLabels && c.chipLabels[k]) || k)}</span>`).join('');
      return `<div class="ln mods" data-line="mods"><span class="ln-i">✦</span><div class="ln-b">${chips}</div></div>`;
    }
    const seg = l.segment
      ? `<div class="seg" role="group" aria-label="Mode">${l.segment.opts.map(([v, lbl, col]) =>
          `<button type="button" class="sg${v === l.segment.cur ? ' on' : ''}" style="--c:${col || 'var(--gold)'}" data-action="${SEG_ACTION[l.segment.key] || ''}" data-val="${_esc(v)}" aria-pressed="${v === l.segment.cur}">${_esc(lbl)}</button>`).join('')}</div>`
      : '';
    const hasDrawer = l.override || (l.slots && l.slots.length);
    const isTuned = tuned.has(l.id);
    const adj = (!readonly && hasDrawer)
      ? `<button type="button" class="adj${isTuned ? ' on' : ''}" data-action="_toggleLineTune" data-line="${_esc(l.id)}" aria-expanded="${isTuned}">${isTuned ? 'réglé' : 'régler'}</button>`
      : '';
    let tune = '';
    if (!readonly && isTuned) {
      let inner = '';
      if (l.override) {
        const o = l.override;
        if (!o.statOnly) inner += `<label>Formule</label><input class="tun-in" data-ovr="${_esc(o.fieldId)}" value="${_esc(c.current || '')}" placeholder="${_esc(c.placeholder || c.value || '')}">`;
        if (o.toucherId) inner += `<label>Toucher</label><select class="tun-sel" data-statproxy="${_esc(o.toucherId)}">${c.toucherHtml || ''}</select>`;
        if (o.statId)   inner += `<label>${o.toucherId ? 'Dégâts' : 'Stat'}</label><select class="tun-sel" data-statproxy="${_esc(o.statId)}">${c.statHtml || ''}</select>`;
        if (!o.statOnly) inner += `<button type="button" class="rst" data-action="_lineTuneAuto" data-ovr="${_esc(o.fieldId)}" data-line="${_esc(l.id)}">auto</button>`;
      }
      // Slots de relocation (états, invocation…) : conteneurs déplacés depuis le store.
      if (l.slots) for (const sid of l.slots) inner += `<span class="cs-forge-slot" data-slot="${_esc(sid)}"></span>`;
      if (inner) tune = `<div class="tun">${inner}</div>`;
    }
    const note = c.note ? `<div class="ln-note">${c.note}</div>` : '';
    return `<div class="ln${l.sub ? ' sub' : ''}" data-line="${_esc(l.id)}" style="--c:${c.color || 'var(--gold)'}">`
      + `<span class="ln-i">${l.icon}</span>`
      + `<div class="ln-b"><b class="${c.text ? 'tx' : ''}">${_esc(c.value || '—')}</b><s>${_esc(c.source || '')}</s></div>`
      + `<div class="ln-c">${seg}${adj}</div>`
      + `${tune}${note}`
      + `</div>`;
  }).join('');
}
