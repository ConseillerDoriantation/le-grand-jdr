// ══════════════════════════════════════════════════════════════════════════════
// VTT-CONDITIONS-CONFIG.JS — Modal « Réglages des états » (éditeur de la librairie)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (découpage, voir docs/vtt-decomposition.md).
// Éditeur MJ de la bibliothèque de conditions (world/conditions) : liste, détails,
// effets, création/suppression d'états personnalisés, reset aux défauts.
// L'ÉTAT (CONDITION_LIBRARY / CONDITION_BY_ID) reste dans vtt.js (lu par tout le
// combat) ; ce module le lit en live-binding et le mute via _setConditionLibrary()
// + _rebuildConditionIndex(). Couplage runtime vers vtt.js uniquement (pas au load).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { saveDoc } from '../../data/firestore.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { loadConditionLibrary } from '../../shared/conditions.js';
import { openModal, confirmModal, closeModalDirect } from '../../shared/modal.js';
import {
  CONDITION_LIBRARY, _setConditionLibrary, _rebuildConditionIndex,
  _isCustomCondition, _loadConditionsOverrides, _conditionSpellUsage,
} from './vtt.js';

export function _vttCcTriSet(btn, value) {
  const w = btn.parentElement;
  w.dataset.ccTriValue = value;
  w.querySelectorAll('.vtt-cc-tri-opt').forEach(b => b.classList.remove('is-on'));
  btn.classList.add('is-on');
}
export function _vttCcFlagToggle(btn) {
  btn.classList.toggle('is-on');
  btn.dataset.ccFlagOn = btn.classList.contains('is-on') ? '1' : '';
}

export async function _vttConditionConfig(opts = {}) {
  if (!STATE.isAdmin) return;
  // S'assure que les overrides MJ sont chargés (utile quand on l'appelle depuis
  // la Console MJ sans avoir encore ouvert le VTT cette session).
  // skipReload : utilisé après un ajout/édition local en mémoire pour ne pas
  // écraser les changements non encore persistés avec les données de Firestore.
  if (!opts.skipReload) {
    await _loadConditionsOverrides().catch(() => {});
  }

  const STATS = [
    ['', '—'], ['force','For'], ['dexterite','Dex'],
    ['constitution','Con'], ['intelligence','Int'],
    ['sagesse','Sag'], ['charisme','Cha'],
  ];
  // Pill toggle 3 options : —/Avantage/Désavantage
  const advTriToggle = (id, current) => {
    const opts = [
      ['',    '—',    'none'],
      ['adv', '⬆ Adv', 'adv'],
      ['dis', '⬇ Dis', 'dis'],
    ];
    return `<div class="vtt-cc-tri" data-cc-tri-id="${id}" data-cc-tri-value="${current||''}">
      ${opts.map(([v, lbl, cls]) => `
        <button type="button" class="vtt-cc-tri-opt vtt-cc-tri-${cls} ${(current||'')===v?'is-on':''}"
          data-vtt-fn="_vttCcTriSet" data-vtt-args="$this|${v}">${lbl}</button>
      `).join('')}
    </div>`;
  };
  // Pill bool toggle (flag)
  const boolToggle = (id, label, on) =>
    `<button type="button" class="vtt-cc-flag-pill ${on?'is-on':''}" data-cc-flag-id="${id}"
       data-vtt-fn="_vttCcFlagToggle" data-vtt-args="$this">
       <span class="vtt-cc-flag-check">${on?'✓':'○'}</span><span>${label}</span>
     </button>`;

  // Compte les effets actifs (pour le badge dans la liste)
  const _countActiveEffects = (eff = {}) =>
    [eff.attackBy, eff.attackAgainst, eff.attackAgainstMelee, eff.attackAgainstRanged]
      .filter(v => v === 'adv' || v === 'dis').length
    + (eff.movementMod === 0 ? 1 : 0)
    + (eff.cantAct ? 1 : 0) + (eff.failsStrSaves ? 1 : 0)
    + (eff.failsDexSaves ? 1 : 0) + (eff.meleeCritOnHit ? 1 : 0);

  // Liste à gauche (compacte, scrollable) + bouton création
  const addBtn = `<button type="button" class="vtt-cc-list-add"
      data-vtt-fn="_vttConditionConfigAddNew">＋ Nouvel état</button>`;
  const listItems = addBtn + CONDITION_LIBRARY.map((c, idx) => {
    const count = _countActiveEffects(c.effects || {});
    const isCustom = _isCustomCondition(c.id);
    return `<button type="button" class="vtt-cc-list-item ${idx === 0 ? 'is-active' : ''} ${isCustom ? 'is-custom' : ''}"
        style="--cond-c:${c.color}"
        data-vtt-fn="_vttConditionConfigSelect" data-vtt-args="${idx}"
        title="${isCustom ? 'État personnalisé' : ''}">
      <span class="vtt-cc-list-ic">${c.icon}</span>
      <span class="vtt-cc-list-nom">${_esc(c.label)}</span>
      ${count ? `<span class="vtt-cc-list-cnt">${count}</span>` : ''}
    </button>`;
  }).join('');

  // Détails à droite (tous rendus, seul l'index 0 visible)
  const details = CONDITION_LIBRARY.map((c, idx) => {
    const eff = c.effects || {};
    const usage = _conditionSpellUsage(c);
    const statOpts = STATS.map(([v, l]) =>
      `<option value="${v}" ${(c.defaultSaveStat||'')===v?'selected':''}>${l}</option>`).join('');
    const isCustom = _isCustomCondition(c.id);
    return `<div class="vtt-cc-detail ${idx === 0 ? 'is-active' : ''}"
        id="vtt-cc-detail-${idx}" style="--cond-c:${c.color}">
      <div class="vtt-cc-detail-hd">
        <input type="text" class="input-field vtt-cc-detail-icon"
          id="cc-${idx}-icon" value="${_esc(c.icon || '')}" maxlength="3"
          title="Emoji ou caractère affiché sur le token"
          style="width:46px;text-align:center;font-size:1.3rem;padding:.3rem">
        <div class="vtt-cc-detail-titles">
          <input type="text" class="input-field vtt-cc-detail-label"
            id="cc-${idx}-label" value="${_esc(c.label)}" placeholder="Nom de l'état">
          <span class="vtt-cc-detail-id">id : <code>${c.id}</code>${isCustom ? ' · personnalisé' : ''}</span>
        </div>
        <input type="color" class="vtt-cc-color-pick" id="cc-${idx}-color"
          value="${c.color}" title="Couleur de l'état">
        ${isCustom ? `<button type="button" class="vtt-cc-detail-del"
          data-vtt-fn="_vttConditionConfigDelete" data-vtt-args="${idx}"
          title="Supprimer cet état personnalisé">🗑</button>` : ''}
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">📖 Description / règles narratives</div>
        <textarea class="input-field" id="cc-${idx}-desc" rows="3"
          placeholder="Effet narratif et règles racontées au joueur…">${_esc(c.desc||'')}</textarea>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">✨ Utilisation dans les sorts</div>
        <div class="vtt-cc-grp-hint">Détermine dans quels sélecteurs de la modal de sort cet état apparaît.</div>
        <div class="vtt-cc-flags-pills">
          ${boolToggle(`cc-${idx}-useEnchant`, '✨ Enchantement', usage.enchantment)}
          ${boolToggle(`cc-${idx}-useAffliction`, '💀 Affliction', usage.affliction)}
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">🎲 Jet de sauvegarde par défaut</div>
        <div class="vtt-cc-grp-hint">Pré-rempli quand le MJ applique l'état. Modifiable au cas par cas.</div>
        <div class="vtt-cc-save-grid">
          <label><span>Caractéristique du jet</span>
            <select class="input-field" id="cc-${idx}-stat">${statOpts}</select>
          </label>
          <label><span>DD par défaut</span>
            <input type="number" class="input-field" id="cc-${idx}-dc"
              value="${c.defaultDC ?? ''}" min="0" max="30" placeholder="—">
          </label>
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">⏱ Durée par défaut</div>
        <div class="vtt-cc-grp-hint">Nombre de tours en combat à l'application. Vide / 0 = jusqu'à dissipation manuelle. Ignoré si l'état se consomme au 1er coup.</div>
        <input type="number" class="input-field" id="cc-${idx}-duration"
          value="${c.defaultDuration ?? ''}" min="0" max="100" placeholder="ex: 2"
          style="max-width:140px">
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">⚔️ Effets sur les jets d'attaque</div>
        <div class="vtt-cc-grp-hint">Avantage / Désavantage automatique appliqué en combat.</div>
        <div class="vtt-cc-adv-grid">
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Quand <strong>il attaque</strong></span>
            ${advTriToggle(`cc-${idx}-atkBy`, eff.attackBy)}
          </div>
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Quand <strong>on l'attaque</strong></span>
            ${advTriToggle(`cc-${idx}-atkAg`, eff.attackAgainst)}
          </div>
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Attaque <strong>CaC</strong> contre <small>(≤1,5m)</small></span>
            ${advTriToggle(`cc-${idx}-atkAgM`, eff.attackAgainstMelee)}
          </div>
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Attaque <strong>à distance</strong> contre</span>
            ${advTriToggle(`cc-${idx}-atkAgR`, eff.attackAgainstRanged)}
          </div>
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">🚷 Restrictions & effets spéciaux</div>
        <div class="vtt-cc-grp-hint">Clique pour activer / désactiver. Plusieurs peuvent être cumulés.</div>
        <div class="vtt-cc-flags-pills">
          ${boolToggle(`cc-${idx}-movementZero`, '🚷 Vitesse 0',           eff.movementMod === 0)}
          ${boolToggle(`cc-${idx}-cantAct`,      '💤 Ne peut pas agir',   !!eff.cantAct)}
          ${boolToggle(`cc-${idx}-cantCast`,     '🤐 Ne peut pas lancer de sort', !!eff.cantCastSpells)}
          ${boolToggle(`cc-${idx}-failsStr`,     '❌ Échec JS Force',     !!eff.failsStrSaves)}
          ${boolToggle(`cc-${idx}-failsDex`,     '❌ Échec JS Dextérité', !!eff.failsDexSaves)}
          ${boolToggle(`cc-${idx}-meleeCrit`,    '💥 CaC ≤1,5m = critique', !!eff.meleeCritOnHit)}
          ${boolToggle(`cc-${idx}-consumed`,     '🎯 Se consomme au 1er coup encaissé', !!eff.consumedByAttackAgainst)}
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">💢 Dégâts subis bonus</div>
        <div class="vtt-cc-grp-hint">Dés/valeur ajoutés aux dégâts reçus par la cible portant l'état (ex: <code>1d6</code> ou <code>4</code>).</div>
        <input type="text" class="input-field" id="cc-${idx}-dmgTaken"
          value="${_esc(eff.dmgTakenBonus || '')}" placeholder="—" maxlength="20"
          style="max-width:160px">
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">🛡 Réduction des dégâts subis</div>
        <div class="vtt-cc-grp-hint">Pourcentage des dégâts reçus annulé (0 = aucun effet, 50 = demi-dégâts, 100 = immunité totale).</div>
        <input type="number" class="input-field" id="cc-${idx}-dmgReduc"
          value="${eff.dmgReductionPct ?? ''}" min="0" max="100" placeholder="—"
          style="max-width:140px">
      </div>
    </div>`;
  }).join('');

  openModal('🎭 Réglages des états', `
    <div class="vtt-cc-modal vtt-cc-modal--master">
      <div class="vtt-cc-intro">
        Chaque état appliqué utilise ces réglages par défaut. Tu peux les ajuster au cas par cas via ✏️ dans l'inspector. Sélectionne un état dans la liste pour configurer ses effets.
      </div>
      <div class="vtt-cc-layout">
        <aside class="vtt-cc-list">${listItems}</aside>
        <section class="vtt-cc-details">${details}</section>
      </div>
      <div class="vtt-cc-footer">
        <button class="btn btn-outline" data-vtt-fn="_vttConditionConfigReset">↺ Réinitialiser aux défauts</button>
        <button class="btn btn-gold" data-vtt-fn="_vttConditionConfigSave">💾 Enregistrer</button>
      </div>
    </div>
  `);
}

/** Sélectionne un état dans la modal de réglages (left list → swap right detail). */
export function _vttConditionConfigSelect(idx) {
  document.querySelectorAll('.vtt-cc-list-item').forEach((b, i) => {
    b.classList.toggle('is-active', i === idx);
  });
  document.querySelectorAll('.vtt-cc-detail').forEach((d, i) => {
    d.classList.toggle('is-active', i === idx);
  });
  // Scroll top du détail
  document.querySelector('.vtt-cc-details')?.scrollTo({ top: 0, behavior: 'smooth' });
}

export function _vttReadConditionConfigEntry(c, idx) {
  const get = (k) => document.getElementById(`cc-${idx}-${k}`);
  const triVal = (id) => document.querySelector(`[data-cc-tri-id="${id}"]`)?.dataset.ccTriValue || '';
  const flagOn = (id) => document.querySelector(`[data-cc-flag-id="${id}"]`)?.classList.contains('is-on');
  const eff = {};
  const atkBy  = triVal(`cc-${idx}-atkBy`);  if (atkBy)  eff.attackBy = atkBy;
  const atkAg  = triVal(`cc-${idx}-atkAg`);  if (atkAg)  eff.attackAgainst = atkAg;
  const atkAgM = triVal(`cc-${idx}-atkAgM`); if (atkAgM) eff.attackAgainstMelee  = atkAgM;
  const atkAgR = triVal(`cc-${idx}-atkAgR`); if (atkAgR) eff.attackAgainstRanged = atkAgR;
  if (flagOn(`cc-${idx}-movementZero`)) eff.movementMod = 0;
  if (flagOn(`cc-${idx}-cantAct`))      eff.cantAct = true;
  if (flagOn(`cc-${idx}-cantCast`))     eff.cantCastSpells = true;
  if (flagOn(`cc-${idx}-failsStr`))     eff.failsStrSaves = true;
  if (flagOn(`cc-${idx}-failsDex`))     eff.failsDexSaves = true;
  if (flagOn(`cc-${idx}-meleeCrit`))    eff.meleeCritOnHit = true;
  if (flagOn(`cc-${idx}-consumed`))     eff.consumedByAttackAgainst = true;
  const dmgTaken = get('dmgTaken')?.value?.trim();
  if (dmgTaken) eff.dmgTakenBonus = dmgTaken;
  const dmgReduc = parseInt(get('dmgReduc')?.value);
  if (Number.isFinite(dmgReduc) && dmgReduc > 0) eff.dmgReductionPct = Math.min(100, dmgReduc);
  const dc = parseInt(get('dc')?.value);
  const stat = get('stat')?.value || null;
  const dur = parseInt(get('duration')?.value);
  return {
    ...c,
    label: get('label')?.value?.trim() || c.label,
    icon:  get('icon')?.value?.trim() || c.icon,
    color: get('color')?.value?.trim() || c.color,
    desc:  get('desc')?.value ?? c.desc,
    defaultSaveStat: stat,
    defaultDC: Number.isFinite(dc) && dc > 0 ? dc : null,
    defaultDuration: Number.isFinite(dur) && dur > 0 ? dur : null,
    spellUsage: {
      enchantment: !!flagOn(`cc-${idx}-useEnchant`),
      affliction: !!flagOn(`cc-${idx}-useAffliction`),
    },
    effects: eff,
  };
}
export async function _vttConditionConfigSave() {
  if (!STATE.isAdmin) return;
  const newLib = CONDITION_LIBRARY.map((c, idx) => _vttReadConditionConfigEntry(c, idx));
  try {
    await saveDoc('world', 'conditions', { library: newLib });
    _setConditionLibrary(newLib);
    _rebuildConditionIndex();
    showNotif('✅ Réglages des états enregistrés', 'success');
    closeModalDirect();
  } catch (e) {
    showNotif('Erreur sauvegarde : ' + (e?.message || e), 'error');
  }
}

export async function _vttConditionConfigReset() {
  if (!STATE.isAdmin) return;
  if (!await confirmModal(
    'Remettre tous les états aux valeurs par défaut ? Les overrides MJ et les états personnalisés seront effacés.',
    { title: '↺ Réinitialiser ?', confirmLabel: 'Réinitialiser', danger: true, icon: '↺' }
  )) return;
  try {
    await saveDoc('world', 'conditions', { library: [] });
    _setConditionLibrary(await loadConditionLibrary({ refresh: true }));
    _rebuildConditionIndex();
    closeModalDirect();
    showNotif('↺ Réglages remis aux défauts', 'success');
    // Réouvrir pour confirmation visuelle
    setTimeout(() => _vttConditionConfig(), 100);
  } catch {}
}

/** Ajoute un nouvel état personnalisé à la lib en mémoire et réouvre la modale dessus.
 *  La persistance se fait quand le MJ clique sur Enregistrer. */
export async function _vttConditionConfigAddNew() {
  if (!STATE.isAdmin) return;
  // Capture les modifs en cours dans la modale avant de la fermer/rouvrir
  const _capture = () => {
    _setConditionLibrary(CONDITION_LIBRARY.map((c, idx) => (
      document.getElementById(`cc-${idx}-label`) ? _vttReadConditionConfigEntry(c, idx) : c
    )));
  };
  try { _capture(); } catch {}

  const newId = `custom_${Date.now().toString(36)}`;
  CONDITION_LIBRARY.push({
    id: newId,
    label: 'Nouvel état',
    icon: '✨',
    color: '#9ca3af',
    desc: '',
    defaultSaveStat: null,
    defaultDC: 11,
    spellUsage: { enchantment: false, affliction: false },
    effects: {},
  });
  _rebuildConditionIndex();
  closeModalDirect();
  // Réouvre SANS reload Firestore (la nouvelle entrée n'est pas encore persistée,
  // un reload l'écraserait → bug "+ Nouvel état n'ajoute qu'une fois")
  setTimeout(async () => {
    await _vttConditionConfig({ skipReload: true });
    const lastIdx = CONDITION_LIBRARY.length - 1;
    _vttConditionConfigSelect(lastIdx);
    // Focus l'input label pour rename direct
    document.getElementById(`cc-${lastIdx}-label`)?.focus();
    document.getElementById(`cc-${lastIdx}-label`)?.select();
  }, 80);
}

/** Supprime un état personnalisé (non-default). Persistance immédiate. */
export async function _vttConditionConfigDelete(idx) {
  if (!STATE.isAdmin) return;
  const c = CONDITION_LIBRARY[idx]; if (!c) return;
  if (!_isCustomCondition(c.id)) {
    showNotif('Les états par défaut ne peuvent pas être supprimés', 'warning');
    return;
  }
  if (!await confirmModal(
    `Supprimer l'état « ${c.label} » ? Les tokens qui le portent garderont la donnée mais elle ne sera plus reconnue.`,
    { title: `🗑 Supprimer ${c.label} ?`, confirmLabel: 'Supprimer', danger: true, icon: '🗑' }
  )) return;
  _setConditionLibrary(CONDITION_LIBRARY.filter((_, i) => i !== idx));
  _rebuildConditionIndex();
  try {
    // Persiste l'état actuel de la lib (sans le state supprimé)
    // On ne sauvegarde QUE les non-défauts modifiés + customs restants
    const toSave = CONDITION_LIBRARY.filter(c2 =>
      _isCustomCondition(c2.id) || true /* keep all so future loads merge correctly */);
    await saveDoc('world', 'conditions', { library: toSave });
    closeModalDirect();
    showNotif('🗑 État supprimé', 'success');
    setTimeout(() => _vttConditionConfig(), 80);
  } catch (e) {
    showNotif('Erreur suppression : ' + (e?.message || e), 'error');
  }
}
