// ══════════════════════════════════════════════════════════════════════════════
// VTT-CONDITIONS.JS — Application des états (conditions) sur les tokens en jeu
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (découpage, voir docs/vtt-decomposition.md).
// Gameplay des états posés sur un token : appliquer, retirer, jet de sauvegarde,
// éditer (source/DD/stat/durée). L'ÉTAT de la librairie (CONDITION_LIBRARY /
// CONDITION_BY_ID) vit dans vtt.js (lu en live-binding). L'éditeur de la librairie
// est dans vtt-conditions-config.js. Couplage runtime vers vtt.js : _consumeLuckyReroll.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { updateDoc, addDoc, serverTimestamp } from '../../config/firebase.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { getMod, statShort } from '../../shared/char-stats.js';
import { openModal, closeModalDirect } from '../../shared/modal.js';
import { CONDITION_DEFAULT_LIBRARY } from '../../shared/conditions.js';
import { _tokRef, _logCol } from './vtt-refs.js';
import { _live } from './vtt-effective.js';
import { _renderInspectorSoon } from './vtt-inspector.js';
import { CONDITION_LIBRARY, CONDITION_BY_ID, _loadConditionsOverrides, _consumeLuckyReroll, _vttLogTargetFields } from './vtt.js';

function getVttConditionLibrary() {
  return CONDITION_LIBRARY.map(c => ({
    id: c.id, label: c.label, icon: c.icon, color: c.color,
  }));
}

export async function _vttEnsureConditionsLoaded() {
  if (CONDITION_LIBRARY.length <= CONDITION_DEFAULT_LIBRARY.length) {
    await _loadConditionsOverrides().catch(() => {});
  }
  return getVttConditionLibrary();
}

export function _vttConditionAdd(tokenId) {
  if (!STATE.isAdmin) return;
  openModal('⚡ Appliquer un état', `
    <div class="vtt-cond-picker">
      ${CONDITION_LIBRARY.map(c => `
        <button class="vtt-cond-pick" style="--cond-c:${c.color}"
          data-vtt-fn="_vttConditionApply" data-vtt-args="${tokenId}|${c.id}">
          <span class="vtt-cond-pick-ic">${c.icon}</span>
          <div class="vtt-cond-pick-body">
            <div class="vtt-cond-pick-nom">${c.label}</div>
            <div class="vtt-cond-pick-desc">${c.desc}</div>
          </div>
        </button>
      `).join('')}
    </div>
    <div style="font-size:.7rem;color:var(--text-dim);font-style:italic;margin-top:.5rem">
      Durée par défaut : 2 tours en combat (1 coup pour les états « on hit »). Modifiable via ✏️ dans l'inspector.
    </div>
  `);
}

/** Applique l'état avec les défauts de la librairie (DC + stat préremplis),
 *  puis ouvre la modal d'édition pour ajuster source/durée si besoin. */
export async function _vttConditionApply(tokenId, condId) {
  const lib = CONDITION_BY_ID[condId]; if (!lib) return;
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  // Évite les doublons (même état déjà appliqué)
  const existing = (t.conditions || []).some(c => c.id === condId);
  if (existing) {
    showNotif(`${lib.icon} ${lib.label} déjà appliqué`, 'info');
    closeModalDirect();
    return;
  }
  // Durée par défaut : valeur définie sur l'état (defaultDuration), sinon
  // 2 tours par convention. Ignorée pour les états qui se consomment au 1er coup.
  const round = VS.session?.combat?.round ?? 0;
  const isConsumed = !!lib.effects?.consumedByAttackAgainst;
  const dur = Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0
    ? lib.defaultDuration
    : 2;
  // Hors combat (round=0) : on stocke pendingDuration pour différer le calcul
  // à l'ouverture du combat. Sinon l'état durerait à l'infini.
  const expiresAtRound = (round > 0 && !isConsumed && dur > 0) ? round + dur - 1 : null;
  const pendingDuration = (round === 0 && !isConsumed && dur > 0) ? dur : null;
  const cond = {
    id: condId,
    appliedAt: Date.now(),
    appliedBy: STATE.user?.uid || null,
    source: '',
    saveDC: lib.defaultSaveStat ? (lib.defaultDC || 11) : null,
    saveStat: lib.defaultSaveStat || null,
    expiresAtRound,
    ...(pendingDuration != null ? { pendingDuration } : {}),
  };
  const newConds = [...(t.conditions || []), cond];
  await updateDoc(_tokRef(tokenId), { conditions: newConds }).catch(() => {});
  closeModalDirect();
  const durLbl = isConsumed ? ' (1 coup)'
    : (expiresAtRound != null || pendingDuration != null) ? ` (${dur} tour${dur>1?'s':''})` : '';
  showNotif(`${lib.icon} ${lib.label} appliqué${durLbl}`, 'success');
  _renderInspectorSoon?.();
}

/** Retire un état du token (par index dans le tableau). */
export async function _vttConditionRemove(tokenId, idx) {
  if (!STATE.isAdmin) return;
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  const conds = [...(t.conditions || [])];
  const removed = conds[idx]; if (!removed) return;
  conds.splice(idx, 1);
  await updateDoc(_tokRef(tokenId), { conditions: conds }).catch(() => {});
  const lib = CONDITION_BY_ID[removed.id];
  if (lib) showNotif(`${lib.icon} ${lib.label} retiré`, 'info');
}

/** Lance un jet de sauvegarde pour tenter de finir l'état. */
export async function _vttConditionSave(tokenId, idx) {
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  const cond = (t.conditions || [])[idx]; if (!cond) return;
  const lib = CONDITION_BY_ID[cond.id];
  const statKey = cond.saveStat || 'constitution';
  const DD = cond.saveDC || 11;
  const mod = c => getMod(c, statKey);
  // Récupère le perso ou NPC source des stats
  const ch = t.characterId ? VS.characters[t.characterId] : null;
  const np = t.npcId ? VS.npcs[t.npcId] : null;
  const statSrc = ch || np || { stats: {} };
  const modVal = ch || np ? mod(statSrc) : 0;
  const initialD20 = Math.floor(Math.random()*20)+1;
  let d20 = initialD20;
  let total = d20 + modVal;
  const luck = await _consumeLuckyReroll(tokenId, t, d20, d20 === 1 || total < DD);
  if (luck) {
    d20 = luck.d20;
    total = d20 + modVal;
  }
  const passed = d20 !== 1 && (d20 === 20 || total >= DD);
  const statLbl = statShort(statKey) || statKey;
  const luckTxt = luck ? ` 🍀 relance ${luck.reroll}→${d20}` : '';
  showNotif(`🎲 JS ${statLbl} : d20[${d20}]${modVal>=0?'+':''}${modVal} = ${total} vs DD ${DD}${luckTxt} → ${passed?'✅ Réussi — état retiré':'❌ Échec'}`, passed?'success':'error');
  // Log
  await addDoc(_logCol(), {
    type: 'save', authorId: STATE.user?.uid||null,
    authorName: STATE.profile?.pseudo||STATE.profile?.prenom||'?',
    tokenName: _live(t).displayName || t.name,
    characterImage: _live(t).displayImage || null,
    ..._vttLogTargetFields(t),
    conditionId: cond.id, conditionLabel: lib?.label || cond.id,
    statLabel: statLbl, mod: modVal, d20, d20rolls: luck ? [initialD20, luck.reroll] : null, total, dd: DD, passed,
    createdAt: serverTimestamp(),
  }).catch(()=>{});
  if (passed) {
    const conds = [...(t.conditions || [])]; conds.splice(idx, 1);
    await updateDoc(_tokRef(tokenId), { conditions: conds }).catch(() => {});
  }
}

/** Modal d'édition d'un état (source / DD / stat / durée). */
export function _vttConditionEdit(tokenId, idx) {
  if (!STATE.isAdmin) return;
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  const cond = (t.conditions || [])[idx]; if (!cond) return;
  const lib = CONDITION_BY_ID[cond.id] || { label: cond.id, icon: '❓' };
  const round = VS.session?.combat?.round ?? 0;
  const turnsLeft = cond.expiresAtRound != null && round > 0
    ? (cond.expiresAtRound - round + 1)
    : (cond.expiresAtRound != null ? 0 : '');
  openModal(`✏️ ${lib.icon} ${lib.label}`, `
    <div class="vtt-cond-edit">
      <div class="form-group">
        <label>Source / Origine</label>
        <input class="input-field" id="ce-source" value="${_esc(cond.source||'')}" placeholder="Ex: Lacération de l'orc, gaz toxique…">
      </div>
      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
        <div>
          <label>DD du jet de sauvegarde</label>
          <input type="number" class="input-field" id="ce-dd" value="${cond.saveDC||''}" placeholder="ex: 11">
        </div>
        <div>
          <label>Stat du jet</label>
          <select class="input-field" id="ce-stat">
            <option value="">— Aucun JS —</option>
            <option value="force"        ${cond.saveStat==='force'?'selected':''}>Force</option>
            <option value="dexterite"    ${cond.saveStat==='dexterite'?'selected':''}>Dextérité</option>
            <option value="constitution" ${cond.saveStat==='constitution'?'selected':''}>Constitution</option>
            <option value="intelligence" ${cond.saveStat==='intelligence'?'selected':''}>Intelligence</option>
            <option value="sagesse"      ${cond.saveStat==='sagesse'?'selected':''}>Sagesse</option>
            <option value="charisme"     ${cond.saveStat==='charisme'?'selected':''}>Charisme</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Durée (tours restants) <span style="font-size:.7rem;color:var(--text-dim)">— vide = jusqu'à dissipation manuelle</span></label>
        <input type="number" class="input-field" id="ce-turns" value="${turnsLeft}" min="0" max="100" placeholder="∞">
      </div>
      <button class="btn btn-gold" style="width:100%;margin-top:.5rem"
        data-vtt-fn="_vttConditionEditSave" data-vtt-args="${tokenId}|${idx}">💾 Enregistrer</button>
    </div>
  `);
}

export async function _vttConditionEditSave(tokenId, idx) {
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  const cond = (t.conditions || [])[idx]; if (!cond) return;
  const source = document.getElementById('ce-source')?.value?.trim() || '';
  const saveDC = parseInt(document.getElementById('ce-dd')?.value) || null;
  const saveStat = document.getElementById('ce-stat')?.value || null;
  const turns = parseInt(document.getElementById('ce-turns')?.value) || 0;
  const round = VS.session?.combat?.round ?? 0;
  const expiresAtRound = turns > 0 && round > 0 ? round + turns - 1 : null;
  const conds = [...(t.conditions || [])];
  conds[idx] = { ...cond, source, saveDC, saveStat: saveDC ? saveStat : null, expiresAtRound };
  await updateDoc(_tokRef(tokenId), { conditions: conds }).catch(() => {});
  closeModalDirect();
  showNotif('État mis à jour', 'success');
}
