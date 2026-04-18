import { STATE } from '../../core/state.js';
import { updateInCol } from '../../data/firestore.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc, _nl2br } from '../../shared/html.js';
import { getMod, calcPMMax } from '../../shared/char-stats.js';
import { getArmorSetData } from './data.js';

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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
 * - Chaînage PP : totalPP > 1 → +(totalPP-1)*2 bonus fixe
 */
function _calcSortDegats(s, c) {
  const equip   = c?.equipement || {};
  const mainP   = equip['Main principale'];
  const armeDeg = mainP?.degats || '1d6';

  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;

  const runes   = s.runes || [];
  const nbPuiss = runes.filter(r => r === 'Puissance').length;
  const nbProt  = runes.filter(r => r === 'Protection').length;
  const totalPP = nbPuiss + nbProt;
  const bonusVal = totalPP > 1 ? (totalPP - 1) * 2 : 0;

  // Bonus de maîtrise de l'arme principale
  const maitrise = _getMaitriseBonus(c, mainP || {});

  const match = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (match) {
    let result = `${parseInt(match[1]) + totalPP}${match[2]}${match[3]}`;
    const totalBonus = bonusVal + maitrise;
    if (totalBonus > 0) result += ` +${totalBonus}`;
    else if (totalBonus < 0) result += ` ${totalBonus}`;
    return result;
  }
  let result = base;
  if (totalPP > 0) result += ` +${totalPP}d6`;
  const totalBonus = bonusVal + maitrise;
  if (totalBonus > 0) result += ` +${totalBonus}`;
  else if (totalBonus < 0) result += ` ${totalBonus}`;
  return result;
}

/**
 * Soin effectif.
 * - Base 1d4 + Protection chaîné : +1d4 par rune, +2 soin fixe par paire (chaînage)
 * - Format texte libre (ex: "moitié des dégâts") → affiché tel quel, rien ajouté
 */
function _calcSortSoin(s, c) {
  const runes  = s.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const chainSoin = nbProt > 1 ? nbProt - 1 : 0;
  const base   = (s.soin || '').trim();

  const buildDefault = (diceCount) => {
    let r = `${diceCount}d4`;
    if (chainSoin > 0) r += ` +${chainSoin * 2}`;
    return r;
  };

  // Bonus de maîtrise de l'arme principale (s'applique aussi aux soins)
  const mainP   = (c?.equipement || {})['Main principale'];
  const maitrise = _getMaitriseBonus(c, mainP || {});
  const maitriseStr = maitrise > 0 ? ` +${maitrise}` : maitrise < 0 ? ` ${maitrise}` : '';

  if (!base || base.toLowerCase() === '= base') {
    let r = buildDefault(1 + nbProt);
    return r + maitriseStr;
  }
  if (nbProt > 0) {
    const match = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (match) {
      // Format XdY reconnu → on ajoute les dés Protection + chaînage + maîtrise
      let r = `${parseInt(match[1]) + nbProt}${match[2]}${match[3]}`;
      if (chainSoin > 0) r += ` +${chainSoin * 2}`;
      return r + maitriseStr;
    }
    // Texte libre → on n'ajoute rien, on respecte ce qui est écrit
    return base;
  }
  if (maitriseStr) return base + maitriseStr;
  return base;
}

/** Mode de la rune Protection : 'soin' | 'ca' — stocké dans s.protectionMode */
function _getSortProtectionMode(s) {
  return s?.protectionMode || 'ca'; // défaut CA si non précisé
}

/** Valeur CA libre (rune Protection mode CA) — saisie directement par le joueur */
function _getSortCA(s) {
  return (s?.ca || '').trim() || 'CA +2 (2 tours)';
}

/**
 * Nombre de cibles — règle Dispersion :
 * 0 rune  → 1 cible
 * N runes → 1 (base) + N (runes) + (N-1) (chaînage) = 2N cibles
 * Ex: 1 rune → 2 cibles, 2 runes → 4 cibles, 3 runes → 6 cibles
 * Les cibles doivent toutes être DIFFÉRENTES.
 */
function _calcSortCibles(s) {
  const n = (s.runes||[]).filter(r => r === 'Dispersion').length;
  if (n === 0) return 1;
  return 1 + n + (n - 1); // 1 base + N runes + (N-1) chaînage = 2N
}

/** Durée en tours (Durée : +2 tours par rune, chaînage : +1 supplémentaire par rune après la 1ère) */
function _calcSortDuree(s) {
  const runes = s.runes || [];
  const nbDur = runes.filter(r => r === 'Durée').length;
  if (nbDur === 0) return null;
  // 1 rune → +2, 2 runes → +2+3=+5, 3 runes → +2+3+4...
  let total = 0;
  for (let i = 0; i < nbDur; i++) total += 2 + i;
  return total;
}

/** Zone d'amplification (Amplification : +3m, chaînage : +2m par rune après la 1ère) */
function _calcSortZone(s) {
  const runes = s.runes || [];
  const nbAmp = runes.filter(r => r === 'Amplification').length;
  if (nbAmp === 0) return null;
  // 1 rune → +3m, 2 runes → +3+2=+5m total (zone 4×4), etc.
  let total = 3;
  for (let i = 1; i < nbAmp; i++) total += 2;
  return total;
}

/** Lacération : réduction CA cible */
function _calcLaceration(s) {
  const nb = (s.runes||[]).filter(r => r === 'Lacération').length;
  if (!nb) return null;
  // Chaînage : -1 CA par rune
  return { reduction: nb, max: 2, maxElite: 4 };
}

/** Chance : réduction RC */
function _calcChance(s) {
  const nb = (s.runes||[]).filter(r => r === 'Chance').length;
  if (!nb) return null;
  // RC de base 20, chaînage -1 par rune → RC = 20 - nb
  return { rc: 20 - nb };
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

  // Action
  const actionLabels = { action:'⚡ Action', action_bonus:'✴️ Action Bonus', reaction:'🔄 Réaction' };
  let actionStr = actionLabels[action] || '⚡ Action';
  if (concentration) actionStr += ' + 🧠 Concentration';
  lines.push({ icon: '', label: actionStr, detail: concentration ? 'JS Sagesse DD 11 si dégâts reçus · jusqu\'à 10 tours' : '' });

  // Dégâts (si offensif)
  if (types.includes('offensif')) {
    const equip   = c?.equipement || {};
    const mainP   = equip['Main principale'];
    const statKey = mainP?.statAttaque || mainP?.toucherStat || 'force';
    const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
    const modAtk  = Math.floor((Math.min(22, statVal) - 10) / 2);
    const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
    const maitrise = _getMaitriseBonus(c, mainP || {});
    const deg      = _calcSortDegats(s, c);
    // Label détaillé : dés + stat + maîtrise si présente
    const modAtkStr = modAtk >= 0 ? `+${modAtk}` : `${modAtk}`;
    const maitriseStr = maitrise !== 0 ? ` + Maî(${maitrise > 0 ? '+'+maitrise : maitrise})` : '';
    const detail = `Dégâts · ${statLbl}(${modAtkStr})${maitriseStr}`;
    lines.push({ icon:'⚔️', label:deg, detail });
  }

  // Protection : Soin ou CA selon protectionMode
  const hasDefensif = types.includes('defensif');
  const nbProt = runes.filter(r => r === 'Protection').length;
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    if (mode === 'soin') {
      const mainPsoin  = (c?.equipement||{})['Main principale'];
      const maitrSoin  = _getMaitriseBonus(c, mainPsoin || {});
      const maitrSoinStr = maitrSoin !== 0 ? ` + Maî(${maitrSoin > 0 ? '+'+maitrSoin : maitrSoin})` : '';
      const chainStr   = nbProt > 1 ? ` +${(nbProt-1)*2}` : '';
      lines.push({ icon:'💚', label:_calcSortSoin(s, c), detail:`Soin · +${nbProt}d4 Prot${chainStr}${maitrSoinStr}` });
    } else {
      lines.push({ icon:'🛡️', label:_getSortCA(s), detail:'' });
    }
  } else if (hasDefensif) {
    lines.push({ icon:'🛡️', label:'Effet défensif', detail:'Décris l\'effet ci-dessous' });
  }

  // Cibles
  const nbCibles = _calcSortCibles(s);
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  if (nbCibles > 1) {
    const dispDetail = nbDisp === 1
      ? '1 rune Dispersion · cibles différentes uniquement'
      : `${nbDisp} runes Dispersion · chaînage +${nbDisp - 1} · cibles différentes uniquement`;
    lines.push({ icon:'🎯', label:`${nbCibles} cibles différentes`, detail: dispDetail });
  }

  // Zone (Amplification)
  const zone = _calcSortZone(s);
  if (zone) {
    const nbAmp = runes.filter(r => r === 'Amplification').length;
    lines.push({ icon:'📐', label:`Zone +${zone}m`, detail: nbAmp > 1 ? `${nbAmp} runes (chaîné : +2m/rune supp.)` : '1 rune Amplification' });
  }

  // Durée
  const duree = _calcSortDuree(s);
  if (duree) {
    const nbDur = runes.filter(r => r === 'Durée').length;
    lines.push({ icon:'⏱️', label:`+${duree} tours`, detail: nbDur > 1 ? `Chaîné : +${nbDur} tours supp.` : 'Durée de l\'effet' });
  }

  // Lacération
  const lac = _calcLaceration(s);
  if (lac) lines.push({ icon:'🩸', label:`CA cible −${lac.reduction}`, detail:`Max −${lac.max} (−${lac.maxElite} Élites/Boss)` });

  // Chance
  const chc = _calcChance(s);
  if (chc) lines.push({ icon:'🍀', label:`RC ${chc.rc}–20`, detail:'Critique aussi max · chaîné : RC−1/rune' });

  // Enchantement / Affliction
  if (runes.includes('Enchantement')) lines.push({ icon:'✨', label:'Enchantement allié', detail:'Applique l\'élément sur équipement allié · 2 tours · Action Bonus' });
  if (runes.includes('Affliction'))   lines.push({ icon:'💀', label:'Affliction ennemi', detail:'Applique l\'élément + état sur équipement ennemi · 2 tours · Action Bonus' });

  // Invocation
  if (runes.includes('Invocation')) lines.push({ icon:'🐾', label:'Invocation', detail:'Créature liée · 10 PV · CA 10' });

  // Concentration (rappel JS si pas déjà mentionné)
  if (concentration && action !== 'action') {
    lines.push({ icon:'🧠', label:'Concentration', detail:'JS Sagesse DD 11 si dégâts reçus · jusqu\'à 10 tours' });
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
  const equip    = c?.equipement || {};
  const mainP    = equip['Main principale'];
  const armeDeg  = mainP?.degats || '1d6';
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

  // Modificateur de l'arme principale + maîtrise
  const equip   = c?.equipement || {};
  const mainP   = equip['Main principale'];
  const statKey = mainP?.statAttaque || mainP?.toucherStat || 'force';
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
      const soinBase = _calcSortSoin(s, c); // inclut maîtrise
      chips.push({ icon:'💚', val: soinBase, color:'#22c38e' });
    } else {
      chips.push({ icon:'🛡️', val:_getSortCA(s), color:'#22c38e' });
    }
  }
  if (nbCibles > 1) chips.push({ icon:'🎯', val:`×${nbCibles}`, color:'#4f8cff' });
  const zone  = _calcSortZone(s);  if (zone)  chips.push({ icon:'📐', val:`+${zone}m`, color:'#b47fff' });
  const duree = _calcSortDuree(s); if (duree) chips.push({ icon:'⏱️', val:`+${duree}t`, color:'#9ca3af' });

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
      <span class="cs-sort-compact-nom">${_esc(s.nom||'Sans nom')}</span>
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

export function openSortModal(idx, s) {
  const NOYAUX = ['Feu 🔥','Eau 💧','Terre 🪨','Vent 🌬️','Ombre 🌑','Lumière ✨','Physique 💪'];
  const RUNES = [
    {nom:'Puissance',     effet:'+ 1 dé de dégâts · chaîné : +2 fixe/paire'},
    {nom:'Protection',    effet:'+1d4 soin ou +2 CA (2 tr) · chaîné : soin+2 & CA+1'},
    {nom:'Amplification', effet:'Zone +3m · chaîné : +2m/rune supp.'},
    {nom:'Enchantement',  effet:'Élément sur équip. allié 2 tr → Action Bonus'},
    {nom:'Affliction',    effet:'Élément + état sur équip. ennemi 2 tr → Action Bonus'},
    {nom:'Invocation',    effet:'Créature liée · 10 PV, CA 10'},
    {nom:'Dispersion',    effet:'1 rune = 2 cibles · 2 runes = 4 cibles · N runes = 2N cibles (chaîné) · cibles différentes uniquement'},
    {nom:'Lacération',    effet:'CA cible −1 · chaîné : −1/rune (max −2, Élites −4)'},
    {nom:'Chance',        effet:'RC 19–20, critique max · chaîné : RC−1/rune'},
    {nom:'Durée',         effet:'+2 tours · chaîné : +1 supp./rune'},
    {nom:'Concentration', effet:'Actif jusqu\'à 10 tours · JS Sa DD11 si dégâts'},
    {nom:'Réaction',      effet:'Lance hors de son tour → Réaction'},
  ];

  const runesSrc = s?.runes||[];
  const runeCounts = {};
  runesSrc.forEach(r => { runeCounts[r] = (runeCounts[r]||0) + 1; });
  window._runeCountsEdit = {...runeCounts};

  const noyauSel  = s?.noyau||'';
  // Types existants (multi)
  const typesInit = Array.isArray(s?.types) && s.types.length ? s.types
    : (s?.typeSoin ? ['defensif'] : (s?.noyau ? ['offensif'] : ['utilitaire']));

  window._sortTypesEdit = new Set(typesInit);

  // Action override (Auto / Action / Action Bonus uniquement — Réaction = rune)
  window._sortActionEdit = s?.actionOverride || null;  // null = auto

  const runesHtml = RUNES.map(r => {
    const cnt = window._runeCountsEdit[r.nom]||0;
    const key = r.nom.replace(/\s/g,'_');
    return `<div class="cs-rune-counter" id="rune-row-${key}">
      <div class="cs-rune-counter-info">
        <span class="cs-rune-counter-name ${cnt>0?'selected':''}" id="rune-name-${key}">${r.nom}</span>
        <span class="cs-rune-counter-effet">${r.effet}</span>
      </div>
      <div class="cs-rune-counter-ctrl">
        <button type="button" class="cs-rune-btn minus" onclick="runeDecrement('${r.nom}')" ${cnt===0?'disabled':''}>−</button>
        <span class="cs-rune-count-val" id="rune-cnt-${key}">${cnt}</span>
        <button type="button" class="cs-rune-btn plus" onclick="runeIncrement('${r.nom}')">+</button>
      </div>
    </div>`;
  }).join('');

  const TYPE_CFG = [
    { v:'offensif',   label:'⚔️ Offensif',   color:'#ff6b6b' },
    { v:'defensif',   label:'🛡️ Défensif',   color:'#22c38e' },
    { v:'utilitaire', label:'✨ Utilitaire', color:'#b47fff' },
  ];
  const typeBtnsHtml = TYPE_CFG.map(t => {
    const isSel = typesInit.includes(t.v);
    return `<button type="button" id="s-type-${t.v}" data-type="${t.v}"
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
    return `<button type="button" id="s-action-${a.v??'auto'}" data-action="${a.v??'auto'}"
      onclick="window._selectSortAction(${a.v===null?'null':`'${a.v}'`})"
      style="flex:1;padding:.35rem .2rem;border-radius:7px;font-size:.7rem;cursor:pointer;
      border:2px solid ${isSel?a.color:'var(--border)'};
      background:${isSel?a.color+'20':'var(--bg-elevated)'};
      color:${isSel?a.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${a.label}</button>`;
  }).join('');

  openModal(idx>=0?'✏️ Modifier le Sort':'✨ Nouveau Sort', `
    <div class="grid-2" style="gap:.6rem;margin-bottom:.5rem">
      <div class="form-group" style="margin:0"><label>Nom</label>
        <input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu...">
      </div>
      <div class="form-group" style="margin:0"><label>Catégorie</label>
        <select class="input-field" id="s-catid">
          <option value="">— Aucune —</option>
          ${(STATE.activeChar?.sort_cats||[]).map(cat =>
            `<option value="${cat.id}" ${s?.catId===cat.id?'selected':''}>${cat.nom}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    <!-- Types (multi-sélection) -->
    <div class="form-group">
      <label>Type(s) <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">— plusieurs possibles</span></label>
      <div style="display:flex;gap:.4rem">${typeBtnsHtml}</div>
    </div>

    <!-- Type d'action -->
    <div class="form-group">
      <label>Action <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">— Auto = déduit des runes · Réaction/Concentration = rune</span></label>
      <div style="display:flex;gap:.3rem" id="s-action-btns">${actionBtnsHtml}</div>
    </div>

    <!-- Noyau -->
    <div class="form-group">
      <label>Noyau élémentaire <span style="color:var(--text-dim);font-weight:400">(2 PM)</span></label>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.map(n => `<div class="cs-noyau-btn ${noyauSel===n?'selected':''}"
             onclick="selectNoyau(this,'${n.replace(/'/g,"\\'")}')">${n}</div>`).join('')}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
    </div>

    <!-- Runes -->
    <div class="form-group">
      <label>Runes <span style="color:var(--text-dim);font-weight:400">(+2 PM chacune, cumulables)</span></label>
      <div class="cs-rune-list">${runesHtml}</div>
    </div>

    <div class="cs-sort-pm-display">
      Coût total : <strong id="s-pm-display">0</strong> PM
      <input type="hidden" id="s-pm" value="${s?.pm||2}">
    </div>

    <!-- Dégâts (si offensif) -->
    <div id="s-degats-section" style="${typesInit.includes('offensif')?'':'display:none'}">
      <div class="form-group"><label>Dégâts <span style="color:var(--text-dim);font-weight:400">(vide = dégâts de l'arme)</span></label>
        <input class="input-field" id="s-degats" value="${s?.degats||''}" placeholder="= arme automatiquement">
      </div>
    </div>

    <!-- Protection : Soin ou CA (visible si rune Protection présente) -->
    <div id="s-prot-section" style="${(s?.runes||[]).includes('Protection') ? '' : 'display:none'}">
      <div class="form-group">
        <label>Rune Protection — effet <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">que fait-elle ?</span></label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'ca',   label:'🛡️ Augmente la CA',  color:'#22c38e', detail:'+2 CA · 2 tours' },
            { v:'soin', label:'💚 Soigne',            color:'#4f8cff', detail:'+1d4 par rune'   },
          ].map(opt => {
            const sel = (s?.protectionMode || 'ca') === opt.v;
            return `<button type="button" id="s-prot-${opt.v}" onclick="window._selectProtMode('${opt.v}')"
              style="flex:1;padding:.5rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.8rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.68rem;color:var(--text-dim);margin-top:.1rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-prot-mode" value="${s?.protectionMode||'ca'}">
      </div>
      <!-- CA custom (visible si mode CA) -->
      <div id="s-ca-section" style="${(s?.protectionMode||'ca')==='ca'?'':'display:none'}">
        <div class="form-group"><label>Effet CA <span style="color:var(--text-dim);font-weight:400">(libre — ex: CA +2 (2 tours))</span></label>
          <input class="input-field" id="s-ca" value="${s?.ca||''}" placeholder="CA +2 (2 tours)">
        </div>
      </div>
      <!-- Soin custom (visible si mode soin) -->
      <div id="s-soin-section" style="${(s?.protectionMode||'ca')==='soin'?'':'display:none'}">
        <div class="form-group"><label>Soin <span style="color:var(--text-dim);font-weight:400">(vide = 1d4 base · XdY = calcul auto)</span></label>
          <input class="input-field" id="s-soin" value="${s?.soin||''}" placeholder="= 1d4 automatiquement">
        </div>
      </div>
    </div>

    <div class="form-group"><label>Description / Effet libre</label>
      <textarea class="input-field" id="s-effet" rows="2">${s?.effet||''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="saveSort(${idx})">Enregistrer</button>
  `);

  setTimeout(() => {
    updateSortPM();
    window._updateSortActionDisplay();

  }, 50);
}

window._toggleSortType = (type) => {
  const TYPE_CFG = {
    offensif:   '#ff6b6b',
    defensif:   '#22c38e',
    utilitaire: '#b47fff',
  };
  if (window._sortTypesEdit.has(type)) {
    if (window._sortTypesEdit.size === 1) return; // garder au moins 1
    window._sortTypesEdit.delete(type);
  } else {
    window._sortTypesEdit.add(type);
  }
  // Mettre à jour visuellement
  Object.entries(TYPE_CFG).forEach(([t, color]) => {
    const btn = document.getElementById(`s-type-${t}`);
    if (!btn) return;
    const active = window._sortTypesEdit.has(t);
    btn.style.borderColor  = active ? color : 'var(--border)';
    btn.style.background   = active ? color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
  // Afficher/masquer sections
  const dSec = document.getElementById('s-degats-section');
  const sSec = document.getElementById('s-soin-section');
  if (dSec) dSec.style.display = window._sortTypesEdit.has('offensif') ? '' : 'none';
  if (sSec) sSec.style.display = window._sortTypesEdit.has('defensif') ? '' : 'none';
};

window._selectSortAction = (val) => {
  window._sortActionEdit = val === 'auto' ? null : val;
  window._updateSortActionDisplay();
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

window._selectProtMode = (mode) => {
  const hidden  = document.getElementById('s-prot-mode');
  const caSec   = document.getElementById('s-ca-section');
  const soinSec = document.getElementById('s-soin-section');
  if (hidden)  hidden.value = mode;
  if (caSec)   caSec.style.display   = mode === 'ca'   ? '' : 'none';
  if (soinSec) soinSec.style.display = mode === 'soin' ? '' : 'none';
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
};

export function runeIncrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  window._runeCountsEdit[nom] = (window._runeCountsEdit[nom]||0) + 1;
  _updateRuneDisplay(nom);
  updateSortPM();
}

export function runeDecrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  if ((window._runeCountsEdit[nom]||0) <= 0) return;
  window._runeCountsEdit[nom]--;
  if (window._runeCountsEdit[nom] === 0) delete window._runeCountsEdit[nom];
  _updateRuneDisplay(nom);
  updateSortPM();
}

function _updateRuneDisplay(nom) {
  const key = nom.replace(/\s/g,'_');
  const cnt = window._runeCountsEdit[nom]||0;
  const valEl  = document.getElementById(`rune-cnt-${key}`);
  const nameEl = document.getElementById(`rune-name-${key}`);
  const minBtn = document.querySelector(`#rune-row-${key} .cs-rune-btn.minus`);
  if (valEl)   valEl.textContent = cnt;
  if (nameEl)  nameEl.classList.toggle('selected', cnt > 0);
  if (minBtn)  minBtn.disabled = cnt === 0;
  // Afficher/masquer la section Protection si rune Protection modifiée
  if (nom === 'Protection') {
    const protSec = document.getElementById('s-prot-section');
    if (protSec) protSec.style.display = cnt > 0 ? '' : 'none';
  }
}

export function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(window._runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
  const pm = total * 2 || 2;
  const pmEl = document.getElementById('s-pm');
  const dispEl = document.getElementById('s-pm-display');
  if (pmEl)   pmEl.value = pm;
  if (dispEl) dispEl.textContent = pm;
}

export function selectNoyau(el, noyau) {
  document.querySelectorAll('.cs-noyau-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  const input = document.getElementById('s-noyau');
  if (input) { input.value = noyau; updateSortPM(); }
}


export async function saveSort(idx) {
  try {
    const c = STATE.activeChar; if(!c) return;
    const sorts = c.deck_sorts||[];
    const noyau = document.getElementById('s-noyau')?.value||'';

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

    const newSort = {
      nom:      document.getElementById('s-nom')?.value||'Sort',
      pm:       autoPm,
      noyau,
      runes,
      types,
      degats:   document.getElementById('s-degats')?.value||'',
      soin:     document.getElementById('s-soin')?.value||'',
      ca:       document.getElementById('s-ca')?.value||'',
      effet:    document.getElementById('s-effet')?.value||'',
      protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
      // Legacy compat : typeSoin si defensif sans offensif + mode soin
      typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
      catId:    document.getElementById('s-catid')?.value || '',
      actif:    idx>=0 ? sorts[idx].actif : false,
      actionOverride,
    };
    if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
    c.deck_sorts=sorts;
    await updateInCol('characters',c.id,{deck_sorts:sorts});
    closeModal();
    showNotif(`Sort enregistré — ${newSort.pm} PM`, 'success');
    window.renderCharSheet(c,'sorts');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── Exports pour VTT ─────────────────────────────────────────────────────────
/** Dégâts calculés d'un sort offensif (runes Puissance + chaînage + maîtrise). */
export function calcSortDegats(s, c) { return _calcSortDegats(s, c); }
/** Soin calculé d'un sort défensif (runes Protection + chaînage + maîtrise). */
export function calcSortSoin(s, c)   { return _calcSortSoin(s, c);   }
