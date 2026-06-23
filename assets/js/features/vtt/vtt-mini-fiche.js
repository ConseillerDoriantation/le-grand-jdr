// ══════════════════════════════════════════════════════════════════════════════
// VTT-MINI-FICHE.JS — Mini-fiche personnage (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// Popup 4 onglets (Combat / Équipement / Sorts / Inventaire / Notes) d'un perso
// joueur. État partagé miniUid/miniCharId via VS ; affichage de sorts réutilisé
// depuis vtt.js (helpers _vttSort*/_vttDisplayRunes, circulaires).
// ══════════════════════════════════════════════════════════════════════════════

import { db, updateDoc, writeBatch, addDoc, serverTimestamp } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _esc, _norm } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal, promptModal } from '../../shared/modal.js';
import { getArmorSetData, syncEquipmentAfterInventoryMutation } from '../../shared/equipment-utils.js';
import { calcSpellDuration, calcSpellTargets } from '../../shared/spell-runes.js';
import { getDamageTypeById } from '../../shared/damage-types.js';
import { calcCA, calcDeckMax, calcPMMax, calcPVMax, calcPalier, calcVitesse, calcOr,
         computeEquipStatsBonus, getItemStatBonus, getMaitriseBonus, getMod,
         sortCharactersForDisplay } from '../../shared/char-stats.js';
import { useGold } from '../../shared/economy.js';
import { loadCollection } from '../../data/firestore.js'; // lecture recettes/boutique (couche quota)
import { shopItemToInvEntry } from '../../shared/inventory-utils.js';
import { _chrRef, _logCol } from './vtt-refs.js'; // refs Firestore perso + log VTT (leaf)
import { _STAT_COLOR, _VTT_RUNE_META, _MS_BONUS_BUFF } from './vtt-constants.js'; // constantes pures (leaf)
import { _vttPanelError } from './vtt-utils.js'; // frontière d'erreur (leaf)
import { _effectDisplay, _vttSortDmgFormula,
         _vttSortSoinFormula, _vttAmpDispCircleSize, _vttSpellActionMode, _vttDisplayRunes,
         } from './vtt-spell-display.js'; // formules de sorts (leaf — mini-fiche découplée de vtt.js)
import { _renderPresenceCol } from './vtt-presence.js'; // circ. (toggle mini → refresh colonne)

let _miniTab = 'combat'; // onglet actif de la mini-fiche (état local)

// ── Constantes & état local ─────────────────────────────────────────
const _MS_STATS   = [
  { key:'force',        abbr:'FOR' }, { key:'dexterite',    abbr:'DEX' },
  { key:'constitution', abbr:'CON' }, { key:'intelligence', abbr:'INT' },
  { key:'sagesse',      abbr:'SAG' }, { key:'charisme',     abbr:'CHA' },
];
let _msOpenNote   = null; // index de la note dépliée (onglet Notes)
let _msInvQuery   = '', _msInvCat  = 'all';
let _msSortQuery  = '', _msSortCat = 'all';
let _msCraftQuery = '';   // filtre de recherche de l'onglet Craft

// MINI-FICHE PERSONNAGE — 4 onglets
// ═══════════════════════════════════════════════════════════════════

// Slots canoniques — mêmes clés que la vraie fiche personnage (characters/combat.js
// + characters/equipment.js). NE PAS inventer d'emplacements ici.
const _MS_SLOTS = [
  'Main principale', 'Main secondaire',
  'Tête', 'Torse', 'Bottes',
  'Anneau', 'Amulette', 'Objet magique',
];

// ─── Helpers locaux ───────────────────────────────────────────────

function _msCatItem(item) {
  const t = item?.template || '';
  if (t === 'arme'   || item?.degats)                     return 'arme';
  if (t === 'armure' || item?.slotArmure || item?.typeArmure) return 'armure';
  if (t === 'bijou'  || item?.slotBijou)                  return 'bijou';
  if (t === 'consommable')                                return 'consommable';
  return 'divers';
}

function _msBuildEquipItem(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');
  const base = {
    nom: item.nom||'',
    fo: getItemStatBonus(item, 'force'), dex: getItemStatBonus(item, 'dexterite'),
    in: getItemStatBonus(item, 'intelligence'), sa:  getItemStatBonus(item, 'sagesse'),
    co: getItemStatBonus(item, 'constitution'), ch:  getItemStatBonus(item, 'charisme'),
    sourceInvIndex: invIndex, itemId: item.itemId||'',
  };
  if (isWeapon) {
    const statAtk = item.toucherStat || item.statAttaque
      || (String(item.format||'').includes('Mag.') ? 'intelligence'
          : String(item.format||'').includes('Dist.') ? 'dexterite' : 'force');
    return { ...base,
      degats: item.degats||'', degatsStat: item.degatsStat||statAtk,
      toucherStat: statAtk, typeArme: item.typeArme||'',
      portee: item.portee||'', particularite: item.particularite||item.effet||'',
      format: item.format||'' };
  }
  return { ...base,
    ca: parseInt(item.ca)||0, typeArmure: item.typeArmure||'',
    slotArmure: item.slotArmure||'', slotBijou: item.slotBijou||'' };
}

function _msCanEdit(uid) { return STATE.isAdmin || STATE.user?.uid === uid; }

// Reproduit STRICTEMENT la logique de characters/equipment.js (editEquipSlot)
// pour que les items équipables dans la vraie fiche le soient aussi ici.
function _msItemFitsSlot(item, slot, equip, idx) {
  if (!item?.nom) return false;
  // Déjà équipé dans un autre slot → exclu
  if (Object.entries(equip).some(([s, e]) => s !== slot && e?.sourceInvIndex === idx)) return false;

  const tpl = item.template || '';

  // ── Armes (Main principale / Main secondaire) ────────────────────
  if (slot.startsWith('Main')) {
    if (tpl === 'arme') return true;
    const WFMT = new Set([
      'Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.',
      'Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)',
    ]);
    if (item.format && WFMT.has(item.format)) return true;
    const combined = [item.type, item.sousType, item.nom, item.categorie]
      .map(v => (v||'').toLowerCase()).join(' ');
    return ['arme','weapon','épée','lance','hache','arc','arbalète','dague',
      'baguette','baton','bouclier','shield','torche','masse','marteau',
      'fléau','rapière','cimeterre','sabre'].some(k => combined.includes(k));
  }

  // ── Armures (Tête / Torse / Bottes) ─────────────────────────────
  // slotArmure stocké côté item = 'Tête' | 'Torse' | 'Pieds'
  // (libellé "Bottes" pour l'affichage, mais valeur réelle "Pieds")
  const ARMOR_MAP = { 'Tête':'Tête', 'Torse':'Torse', 'Bottes':'Pieds' };
  if (ARMOR_MAP[slot] !== undefined) {
    if (tpl === 'armure' || item.slotArmure) {
      return item.slotArmure === ARMOR_MAP[slot];
    }
    const t = (item.type||'').toLowerCase();
    return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
  }

  // ── Bijoux / accessoires (Anneau / Amulette / Objet magique) ─────
  // Règle stricte = même que la vraie fiche : item.slotBijou === slot
  if (slot === 'Anneau' || slot === 'Amulette' || slot === 'Objet magique') {
    return item.slotBijou === slot;
  }

  return false;
}

// ─── Handlers exposés ────────────────────────────────────────────

function _vttMsTab(tab) { _miniTab = tab; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// ── Filtres des onglets Sac / Sorts ──────────────────────────────
// Barre commune : puces de catégorie + champ de recherche. `kind` = 'inv'|'sorts'.
// `chips` = [{ key, label, color? }] ; la puce active vient de l'état module.
function _msFilterBar(kind, chips, query) {
  const activeCat = kind === 'inv' ? _msInvCat : kind === 'sorts' ? _msSortCat : 'all';
  const catFn     = kind === 'inv' ? '_vttMsInvCat' : '_vttMsSortCat';
  const searchFn  = kind === 'inv' ? '_vttMsInvSearch' : kind === 'sorts' ? '_vttMsSortSearch' : '_vttMsCraftSearch';
  const clrFn     = kind === 'inv' ? '_vttMsInvClear' : kind === 'sorts' ? '_vttMsSortClear' : '_vttMsCraftClear';
  // ch.label / ch.color viennent de noms de catégorie saisis par le joueur → échappés.
  const chipsHtml = chips.map(ch =>
    `<button class="vtt-ms-fchip${activeCat===ch.key?' active':''}"${ch.color?` style="--chip-col:${_esc(ch.color)}"`:''}
      data-vtt-fn="${catFn}" data-vtt-args="${ch.key}|$this">${_esc(ch.label)}</button>`
  ).join('');
  return `<div class="vtt-ms-filter" data-kind="${kind}">
    ${chipsHtml ? `<div class="vtt-ms-fchips">${chipsHtml}</div>` : ''}
    <div class="vtt-ms-fsearch">
      <span class="vtt-ms-fsearch-ic">🔍</span>
      <input type="text" class="vtt-ms-fsearch-input" placeholder="Rechercher…"
        value="${_esc(query)}" data-vtt-fn="${searchFn}" data-vtt-on="input" data-vtt-args="$value">
      ${query ? `<button class="vtt-ms-fsearch-clr" title="Effacer" data-vtt-fn="${clrFn}">✕</button>` : ''}
    </div>
  </div>`;
}

// Applique le filtre Sac (catégorie + recherche) par show/hide, sans re-render.
function _msApplyInvFilter() {
  const q = _norm(_msInvQuery);
  const groups = document.querySelectorAll('#vtt-mini-panel .vtt-ms-inv-group');
  let anyVisible = false;
  groups.forEach(g => {
    if (_msInvCat !== 'all' && g.dataset.cat !== _msInvCat) { g.style.display = 'none'; return; }
    let n = 0;
    g.querySelectorAll('.vtt-ms-inv-item').forEach(it => {
      const m = !q || (it.dataset.name || '').includes(q);
      it.style.display = m ? '' : 'none';
      if (m) n++;
    });
    g.style.display = n ? '' : 'none';
    if (n) anyVisible = true;
  });
  _msToggleEmpty('inv', anyVisible || !groups.length);
}

// Applique le filtre Sorts (catégorie / deck actif + recherche) sans re-render.
function _msApplySortFilter() {
  const q = _norm(_msSortQuery);
  const cards = document.querySelectorAll('#vtt-mini-panel .vtt-ms-spellgrid .cs-spellcard');
  let anyVisible = false;
  cards.forEach(card => {
    const catOk = _msSortCat === 'all'
      || (_msSortCat === '__deck' ? card.dataset.actif === '1' : card.dataset.cat === _msSortCat);
    const m = catOk && (!q || (card.dataset.name || '').includes(q));
    card.style.display = m ? '' : 'none';
    if (m) anyVisible = true;
  });
  _msToggleEmpty('sorts', anyVisible || !cards.length);
}

// Applique le filtre Craft (recherche : nom / type / effet / ingrédients) sans re-render.
function _msApplyCraftFilter() {
  const q = _norm(_msCraftQuery);
  const cards = document.querySelectorAll('#vtt-mini-panel .vtt-ms-craft .vtt-ms-craft-card');
  let anyVisible = false;
  cards.forEach(card => {
    const m = !q || (card.dataset.name || '').includes(q);
    card.style.display = m ? '' : 'none';
    if (m) anyVisible = true;
  });
  _msToggleEmpty('craft', anyVisible || !cards.length);
}

function _msToggleEmpty(kind, anyVisible) {
  const el = document.querySelector(`#vtt-mini-panel .vtt-ms-filter-empty[data-kind="${kind}"]`);
  if (el) el.style.display = anyVisible ? 'none' : '';
}

function _msSetActiveChip(kind, btn) {
  const root = document.querySelector(`#vtt-mini-panel .vtt-ms-filter[data-kind="${kind}"]`);
  root?.querySelectorAll('.vtt-ms-fchip').forEach(b => b.classList.toggle('active', b === btn));
}

function _vttMsInvSearch(val)  { _msInvQuery = val || ''; _msApplyInvFilter(); _msSyncClearBtn('inv'); }
function _vttMsInvCat(cat, btn){ _msInvCat = cat; _msSetActiveChip('inv', btn); _msApplyInvFilter(); }
function _vttMsInvClear()      { _msInvQuery = ''; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsSortSearch(val) { _msSortQuery = val || ''; _msApplySortFilter(); _msSyncClearBtn('sorts'); }
function _vttMsSortCat(cat,btn){ _msSortCat = cat; _msSetActiveChip('sorts', btn); _msApplySortFilter(); }
function _vttMsSortClear()     { _msSortQuery = ''; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }
function _vttMsCraftSearch(val){ _msCraftQuery = val || ''; _msApplyCraftFilter(); _msSyncClearBtn('craft'); }
function _vttMsCraftClear()    { _msCraftQuery = ''; if (VS.miniUid) _renderMiniSheet(VS.miniUid); }

// Affiche/masque le bouton ✕ de la recherche sans re-render complet (préserve le focus).
function _msSyncClearBtn(kind) {
  const query = kind === 'inv' ? _msInvQuery : kind === 'sorts' ? _msSortQuery : _msCraftQuery;
  const wrap  = document.querySelector(`#vtt-mini-panel .vtt-ms-filter[data-kind="${kind}"] .vtt-ms-fsearch`);
  if (!wrap) return;
  let btn = wrap.querySelector('.vtt-ms-fsearch-clr');
  if (query && !btn) {
    btn = document.createElement('button');
    btn.className = 'vtt-ms-fsearch-clr'; btn.title = 'Effacer'; btn.textContent = '✕';
    btn.dataset.vttFn = kind === 'inv' ? '_vttMsInvClear' : kind === 'sorts' ? '_vttMsSortClear' : '_vttMsCraftClear';
    wrap.appendChild(btn);
  } else if (!query && btn) {
    btn.remove();
  }
}

async function _vttMsEquip(charId, uid, slot, invIndex) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = { ...(c.equipement||{}) };
  // Libère l'item s'il était déjà équipé ailleurs
  Object.keys(equip).forEach(s => { if (s !== slot && equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const built = _msBuildEquipItem(slot, item, invIndex); if (!built) return;
  equip[slot] = built;
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${item.nom} → ${slot}`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

async function _vttMsUnequip(charId, uid, slot) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  const nom = equip[slot]?.nom || slot;
  delete equip[slot];
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${nom} retiré`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Appelé par le <select> de l'onglet Équipement
function _vttMsSlotChange(sel, charId, uid, slotIdx) {
  const slot = _MS_SLOTS[parseInt(slotIdx)]; if (!slot) return;
  const val = sel.value;
  if (val === '') _vttMsUnequip(charId, uid, slot);
  else            _vttMsEquip(charId, uid, slot, parseInt(val));
}

// Ouvre une modale pour choisir le slot cible depuis l'inventaire
function _vttMsEquipPicker(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = c.equipement||{};
  // Seuls les slots compatibles avec cet item (sans check "usedElsewhere" pour qu'on puisse déplacer)
  const slots = _MS_SLOTS.filter(s => _msItemFitsSlot(item, s, {}, invIndex));
  if (!slots.length) { showNotif('Aucun slot compatible pour cet objet', 'info'); return; }
  if (slots.length === 1) { _vttMsEquip(charId, uid, slots[0], invIndex); return; }
  openModal(`⚔️ Équiper "${item.nom}"`, `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${slots.map(s => `<button class="btn btn-outline"
        data-vtt-fn="_vttCloseAnd" data-vtt-args="_vttMsEquip|${charId}|${uid}|${s}|${invIndex}">${s}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Déséquipe un item depuis l'inventaire (tous les slots où il est équipé)
async function _vttMsUnequipAll(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = VS.characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  Object.keys(equip).forEach(s => { if (equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif('Déséquipé', 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Active / désactive un sort
async function _vttToggleMsSort(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  const s = sorts[idx]; if (!s) return;
  // Un joueur ne peut mettre dans son Deck qu'un sort VALIDÉ par le MJ (le MJ n'est pas limité).
  const isValidated = (s.mjValidation || (s.mjValidated ? 'ok' : 'pending')) === 'ok';
  if (!s.actif && !isValidated && !STATE.isAdmin) {
    showNotif('Ce sort doit être validé par le MJ avant d\'entrer dans le Deck.', 'error');
    return;
  }
  sorts[idx] = { ...s, actif: !s.actif };
  try { await updateDoc(_chrRef(charId), { deck_sorts: sorts }); }
  catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Modale pour choisir le destinataire d'un objet
function _vttMsSendPicker(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = VS.characters[charId]; if (!c) return;
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const targets = Object.entries(VS.presence)
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) =>
      Object.values(VS.characters)
        .filter(ch => ch.uid === pUid)
        .map(ch => ({ pUid, charId: ch.id, charNom: ch.nom||p.pseudo, pseudo: p.pseudo }))
    );
  if (!targets.length) { showNotif('Aucun joueur présent à qui envoyer l\'objet', 'info'); return; }
  openModal(`📦 Envoyer "${item.nom||'objet'}"`, `
    <div style="display:flex;flex-direction:column;gap:.5rem">
      <p style="margin:0;font-size:.85rem;color:var(--text-dim)">Destinataire :</p>
      ${targets.map(t => `<button class="btn btn-outline" style="text-align:left"
        data-vtt-fn="_vttCloseAnd" data-vtt-args="_vttMsConfirmSend|${charId}|${uid}|${invIndex}|${t.charId}">
        ${t.pseudo} → ${t.charNom}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Effectue le transfert d'objet entre deux personnages
async function _vttMsConfirmSend(senderCharId, senderUid, invIndex, recipCharId) {
  invIndex = parseInt(invIndex);
  const sender = VS.characters[senderCharId]; if (!sender) return;
  const recip  = VS.characters[recipCharId];  if (!recip)  return;
  const senderInv = [...(sender.inventaire||[])];
  const item = senderInv[invIndex]; if (!item) return;
  senderInv.splice(invIndex, 1);
  // Ajuste les sourceInvIndex dans l'équipement du sender
  const senderEquip = { ...(sender.equipement||{}) };
  Object.keys(senderEquip).forEach(s => {
    const e = senderEquip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete senderEquip[s];
    else if (e.sourceInvIndex > invIndex) senderEquip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const senderBonus = computeEquipStatsBonus(senderEquip);
  const recipInv = [...(recip.inventaire||[]), { ...item }];
  try {
    const batch = writeBatch(db);
    batch.update(_chrRef(senderCharId), { inventaire: senderInv, equipement: senderEquip, statsBonus: senderBonus });
    batch.update(_chrRef(recipCharId), { inventaire: recipInv });
    await batch.commit();
    showNotif(`${item.nom||'Objet'} envoyé à ${recip.nom||'joueur'}`, 'success');
  } catch(e) {
    console.error('[vtt] send item', e);
    showNotif(e?.code === 'permission-denied'
      ? "Envoi refusé : règle Firestore d'inventaire manquante (don d'objet)"
      : 'Erreur envoi', 'error');
  }
}

// Supprime définitivement un exemplaire de l'inventaire (sans destinataire).
// Même logique de réindexation de l'équipement que _vttMsConfirmSend.
async function _vttMsDeleteItem(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = VS.characters[charId]; if (!c) return;
  const inv = [...(c.inventaire||[])];
  const item = inv[invIndex]; if (!item) return;
  if (!await confirmModal(`Supprimer <b>${_esc(item.nom||'cet objet')}</b> de l'inventaire ?`, { title: 'Inventaire', confirmLabel: 'Supprimer' })) return;
  inv.splice(invIndex, 1);
  const equip = { ...(c.equipement||{}) };
  Object.keys(equip).forEach(s => {
    const e = equip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete equip[s];
    else if (e.sourceInvIndex > invIndex) equip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { inventaire: inv, equipement: equip, statsBonus: bonus });
    showNotif(`${item.nom||'Objet'} supprimé`, 'info');
  } catch(e) { console.error('[vtt] delete item', e); showNotif('Erreur suppression', 'error'); }
}

// ─── Rendus par onglet ────────────────────────────────────────────

function _msTabCombat(c, uid, canEdit) {
  const pvMax = calcPVMax(c), pmMax = calcPMMax(c);
  const pvCur = c?.hp ?? pvMax, pmCur = c?.pm ?? pmMax;
  const pvPct = pvMax > 0 ? Math.round(Math.max(0, pvCur) / pvMax * 100) : 0;
  const pmPct = pmMax > 0 ? Math.round(Math.max(0, pmCur) / pmMax * 100) : 0;
  const pvCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';

  const statsHtml = _MS_STATS.map(s => {
    const base  = (c?.stats||{})[s.key]      || 8;
    const bonus = (c?.statsBonus||{})[s.key] || 0;
    const total = Math.min(22, base + bonus);
    const mod   = getMod(c, s.key);
    const col   = _STAT_COLOR[s.abbr];
    return `<div class="vtt-ms-stat">
      <span class="vtt-ms-stat-abbr" style="color:${col}">${s.abbr}</span>
      <span class="vtt-ms-stat-val">${total}</span>
      <span class="vtt-ms-stat-mod" style="color:${col}">${mod>=0?'+'+mod:mod}</span>
    </div>`;
  }).join('');

  const weapon = c?.equipement?.['Main principale'];
  const weaponHtml = weapon?.nom ? (() => {
    const wDmgStat = weapon.degatsStat || weapon.degatStat || 'force';
    const wTchStat = weapon.toucherStat || weapon.statAttaque || 'force';
    const setBonus = getArmorSetData(c).modifiers.toucherBonus || 0;
    const maitrise = getMaitriseBonus(c, weapon);
    const dmgMod   = getMod(c, wDmgStat);
    const tchTotal = getMod(c, wTchStat) + maitrise + setBonus;
    return `<div class="vtt-ms-weapon">
      <div class="vtt-ms-weapon-nom">⚔️ ${weapon.nom}</div>
      <div class="vtt-ms-weapon-stats">
        <span>🎲 ${weapon.degats||'—'}${dmgMod!==0?' '+(dmgMod>=0?'+'+dmgMod:dmgMod):''}</span>
        <span>🎯 ${tchTotal>=0?'+'+tchTotal:tchTotal}</span>
      </div>
    </div>`;
  })() : '';

  const setData = getArmorSetData(c);
  const setHtml = setData?.active ? `<div class="vtt-ms-setbonus">✨ Set ${setData.type}</div>` : '';

  return `
    <div class="vtt-ms-bars">
      <div class="vtt-ms-bar-row">
        <span class="vtt-ms-bar-lbl">❤ PV</span>
        <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pvPct}%;background:${pvCol}"></div></div>
        <span class="vtt-ms-bar-num">${pvCur}/${pvMax}</span>
      </div>
      <div class="vtt-ms-bar-row">
        <span class="vtt-ms-bar-lbl">💧 PM</span>
        <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pmPct}%;background:#4f8cff"></div></div>
        <span class="vtt-ms-bar-num">${pmCur}/${pmMax}</span>
      </div>
    </div>
    <div class="vtt-ms-grid">${statsHtml}</div>
    <div class="vtt-ms-defenses">
      <div class="vtt-ms-def-item"><span>🛡 CA</span><strong>${calcCA(c)}</strong></div>
      <div class="vtt-ms-def-item"><span>⚡ Vit.</span><strong>${calcVitesse(c)}</strong></div>
      <div class="vtt-ms-def-item"><span>🎯 Maît.</span><strong>+${getMaitriseBonus(c)}</strong></div>
    </div>
    ${weaponHtml}${setHtml}
    ${_msXpSection(c, uid, canEdit)}`;
}

function _msXpSection(c, uid, canEdit) {
  const xp     = parseInt(c?.exp)    || 0;
  const niv    = parseInt(c?.niveau) || 1;
  const palier = calcPalier(niv);
  const pct    = palier > 0 ? Math.min(100, Math.round(xp / palier * 100)) : 0;

  if (canEdit) {
    return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <input class="vtt-ms-xp-input" type="number" value="${xp}" min="0"
          data-vtt-fn="_vttMsSetXp" data-vtt-on="change" data-vtt-args="${c.id}|${uid}|$value"
          data-enter="change-blur"
          title="XP total — Entrée pour valider">
        <span class="vtt-ms-xp-sep">/ ${palier}</span>
        <span class="vtt-ms-xp-niv">Niv.</span>
        <input class="vtt-ms-niv-input" type="number" value="${niv}" min="1" max="20"
          data-vtt-fn="_vttMsSetNiveau" data-vtt-on="change" data-vtt-args="${c.id}|${uid}|$value">
      </div>
      <div class="vtt-ms-xp-row vtt-ms-xp-add-row">
        <span class="vtt-ms-xp-add-icon">+</span>
        <input class="vtt-ms-xp-input vtt-ms-xp-delta-input" type="number" min="1" placeholder="gagné"
          id="vtt-xp-delta-${c.id}-${uid}"
          data-vtt-fn="_vttMsAddXp" data-vtt-on="keydown-enter" data-vtt-args="${c.id}|${uid}|$value"
          title="XP à ajouter — Entrée pour valider">
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
  }
  return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <span class="vtt-ms-xp-val">${xp} / ${palier}</span>
        <span class="vtt-ms-xp-badge">Niv. ${niv}</span>
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
}

function _msTabEquipement(c, uid, canEdit) {
  const equip = c?.equipement||{}, inv = c?.inventaire||[];
  return `<div class="vtt-ms-slots">${_MS_SLOTS.map((slot, slotIdx) => {
    const equipped    = equip[slot];
    const equippedIdx = equipped?.sourceInvIndex ?? -1;
    const opts = inv.map((item, i) => {
      if (!_msItemFitsSlot(item, slot, equip, i)) return '';
      return `<option value="${i}"${equippedIdx===i?' selected':''}>${item.nom}${(item.qte||1)>1?' ×'+item.qte:''}</option>`;
    }).join('');
    return `<div class="vtt-ms-slot-row">
      <span class="vtt-ms-slot-lbl">${slot}</span>
      <div class="vtt-ms-slot-ctrl">${canEdit
        ? `<select class="vtt-ms-slot-sel" data-vtt-fn="_vttMsSlotChange" data-vtt-on="change" data-vtt-args="$this|${c.id}|${uid}|${slotIdx}">
             <option value="">— vide —</option>${opts}</select>`
        : `<span class="vtt-ms-slot-val">${equipped?.nom||'—'}</span>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// Méta runes (icône/couleur) — miroir de RUNE_META (spells.js) pour un rendu de
// carte identique côté VTT, sans importer le gros module de la fiche.
// [_VTT_RUNE_META → vtt-constants.js (importé en haut)]

// Chips d'effets clés (dégâts/soin/cibles/zone/durée), calculés avec les helpers
// natifs du VTT (cache-free → cohérents avec les options d'attaque du VTT).
function _vttSpellChips(s, c) {
  const chips = [];
  const types = (Array.isArray(s.types) && s.types.length) ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const runes = s.runes || [];
  const _isLac = runes.includes('Lacération') || (s.afflictionMode === 'laceration' && runes.includes('Affliction'));
  if (types.includes('offensif') || _isLac) {
    const dmg = _vttSortDmgFormula(s, c);
    if (dmg) chips.push({ icon:'⚔️', val: _effectDisplay(s, dmg), color:'#ff6b6b' });
  }
  if (runes.includes('Protection') && runes.includes('Affliction') && !_isLac) {
    const nbProt = runes.filter(r => r === 'Protection').length;
    const nbAff = runes.filter(r => r === 'Affliction').length;
    const regenFormula = `${(s.regenerationFormula || '').trim() || `${nbProt + nbAff}d4`}/t`;
    chips.push({ icon:'💚', val:_effectDisplay(s, regenFormula), color:'#22c38e' });
  }
  const isAmpSupportHeal = types.includes('defensif')
    && runes.includes('Amplification')
    && s.ampMode !== 'deplacement'
    && !runes.includes('Protection');
  if (!(runes.includes('Protection') && runes.includes('Affliction') && !_isLac)
      && types.includes('defensif') && (s.protectionMode === 'soin' || s.typeSoin || isAmpSupportHeal)) {
    const soin = _vttSortSoinFormula(s, c);
    if (soin) chips.push({ icon:'💚', val: _effectDisplay(s, soin), color:'#22c38e' });
  }
  const nbT = calcSpellTargets(s);
  if (nbT > 1) chips.push({ icon:'🎯', val:`×${nbT}`, color:'#4f8cff' });
  const nbAmp = runes.filter(r => r === 'Amplification').length;
  if (nbAmp > 0 && s.ampMode !== 'deplacement') {
    const nbDisp = runes.filter(r => r === 'Dispersion').length;
    const zoneW = nbDisp >= 1 ? _vttAmpDispCircleSize(nbAmp, nbDisp) : 3 * nbAmp;
    const zoneH = nbDisp >= 1 ? zoneW : 1;
    chips.push({ icon:'📐', val:`${zoneW}×${zoneH} cases`, color:'#b47fff' });
  }
  if (runes.includes('Durée') || (s.dureeBase && s.dureeBase >= 2)) {
    chips.push({ icon:'⏱️', val:`${calcSpellDuration(s)}t`, color:'#9ca3af' });
  }
  return chips;
}

// Carte de sort VTT — même présentation que la fiche perso (classes .cs-spellcard,
// scope .cs-v3) avec câblage VTT (toggle deck par data-vtt-fn).
function _vttSpellCardHtml(s, i, c, uid, canEdit) {
  const runes = s.runes || [];
  const types = (Array.isArray(s.types) && s.types.length) ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const action = _vttSpellActionMode(s);
  const ACTION_CFG = {
    action:       { label:'⚡ Act.',   color:'#e8b84b' },
    action_bonus: { label:'✴️ Bonus', color:'#f97316' },
    reaction:     { label:'🔄 Réac.', color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action];
  const concentration = runes.includes('Concentration');
  const ids = (Array.isArray(s.noyauTypeIds) && s.noyauTypeIds.length) ? s.noyauTypeIds
            : (s.noyauTypeId ? [s.noyauTypeId] : []);
  const nts = ids.map(id => getDamageTypeById(VS.damageTypes, id)).filter(Boolean);
  const noyauPills = nts.map(t =>
    `<span class="cs-spellcard-noyau" style="--c:${t.color||'#888'}" title="Noyau ${_esc(t.label)}">${t.icon||''}</span>`).join('');
  const typeCol = types.includes('offensif') ? '#ff6b6b' : types.includes('defensif') ? '#22c38e' : '#b47fff';
  const vs = s.mjValidation || (s.mjValidated ? 'ok' : 'pending');
  const valBadge = vs === 'ok'
    ? `<span class="cs-spellcard-val ok" title="Sort validé par le MJ">✅ Validé</span>`
    : vs === 'no'
      ? `<span class="cs-spellcard-val no" title="Sort refusé par le MJ">❌ Refusé</span>`
      : `<span class="cs-spellcard-val wait" title="Pas encore validé par le MJ">⏳ À valider</span>`;
  const chips = _vttSpellChips(s, c);
  const counts = {}; _vttDisplayRunes(runes).forEach(r => { counts[r] = (counts[r]||0)+1; });
  const runeChips = Object.keys(counts).length ? `<div class="cs-spellcard-runes">${
    Object.entries(counts).map(([nom, n]) => {
      const m = _VTT_RUNE_META[nom] || { icon:'•', color:'#888' };
      return `<span class="cs-runechip" style="--c:${m.color}" title="${_esc(nom)}">${m.icon} ${_esc(nom)}${n>1?` ×${n}`:''}</span>`;
    }).join('')}</div>` : '';
  const canActivate = STATE.isAdmin || vs === 'ok';
  const toggle = canEdit
    ? `<div class="toggle ${s.actif?'on':''} ${(!canActivate && !s.actif)?'is-locked':''}" data-vtt-fn="_vttToggleMsSort" data-vtt-args="${c.id}|${uid}|${i}" title="${(!canActivate && !s.actif)?'Doit être validé par le MJ pour entrer dans le Deck':(s.actif?'Retirer du deck':'Ajouter au deck')}"></div>`
    : `<div class="toggle ${s.actif?'on':''}"></div>`;
  return `<article class="cs-spellcard ${s.actif?'is-actif':''}" style="--type-col:${typeCol}"
      data-name="${_esc(_norm(s.nom||''))}" data-cat="${_esc(s.catId||'__none')}" data-actif="${s.actif?1:0}">
    <header class="cs-spellcard-head">
      ${toggle}
      <span class="cs-spellcard-icon">${s.icon ? _esc(s.icon) : '✦'}</span>
      <div class="cs-spellcard-id">
        <div class="cs-spellcard-name" title="${_esc(s.nom||'Sans nom')}">${_esc(s.nom||'Sans nom')}</div>
        <div class="cs-spellcard-sub">
          <span class="cs-spellcard-act" style="--c:${acfg.color}">${acfg.label}</span>
          ${concentration ? `<span class="cs-spellcard-conc" title="Concentration">🧠</span>` : ''}
          ${noyauPills}
        </div>
      </div>
      <span class="cs-spellcard-pm" title="Coût en PM">${s.pm||0}<small>PM</small></span>
    </header>
    <div class="cs-spellcard-tags">${valBadge}${chips.map(ch => `<span class="cs-sort-sstat" style="--c:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('')}</div>
    ${s.effet ? `<p class="cs-spellcard-desc">${_esc(s.effet)}</p>` : ''}
    ${s.mjNotes ? `<div class="cs-spellcard-mjnote" title="Note / restriction du MJ"><span class="cs-spellcard-mjnote-ic">📌</span><span class="cs-spellcard-mjnote-tx">${_esc(s.mjNotes)}</span></div>` : ''}
    ${runeChips}
  </article>`;
}

function _msTabSorts(c, uid, canEdit) {
  const sorts = c?.deck_sorts || [];
  if (!sorts.length) return '<div class="vtt-ms-empty">Aucun sort</div>';
  const deckCount = sorts.filter(s => s.actif).length;
  const deckMax = calcDeckMax(c);
  const over = deckCount > deckMax;

  // Barre de filtre : Tous · ⚡ Deck actif · catégories du perso (présentes) · Sans cat.
  let filterBar = '';
  if (sorts.length >= 4) {
    const cats = (c?.sort_cats || []).filter(ct => sorts.some(s => s.catId === ct.id));
    const chips = [
      { key:'all',    label:'Tous' },
      { key:'__deck', label:`⚡ Deck (${deckCount})` },
      ...cats.map(ct => ({ key: ct.id, label: ct.nom || 'Catégorie', color: ct.couleur })),
    ];
    if (sorts.some(s => !s.catId)) chips.push({ key:'__none', label:'Sans cat.' });
    // Garde-fou : si la catégorie active n'existe plus, on retombe sur "Tous".
    if (!chips.some(ch => ch.key === _msSortCat)) _msSortCat = 'all';
    filterBar = _msFilterBar('sorts', chips, _msSortQuery);
  } else {
    _msSortCat = 'all'; _msSortQuery = '';
  }

  return `
    <div class="vtt-ms-deckbar${over ? ' is-over' : ''}">
      <span class="vtt-ms-deck-lbl">⚡ Deck</span>
      <span class="vtt-ms-deck-val">${deckCount}<small>/${deckMax}</small></span>
      ${canEdit ? `<span class="vtt-ms-deck-hint">Coche un sort pour l'ajouter / le retirer du deck</span>` : ''}
    </div>
    ${filterBar}
    <div class="cs-v3"><div class="cs-spellcard-grid vtt-ms-spellgrid">
      ${sorts.map((s, i) => _vttSpellCardHtml(s, i, c, uid, canEdit)).join('')}
    </div></div>
    <div class="vtt-ms-filter-empty" data-kind="sorts" style="display:none">Aucun sort ne correspond.</div>`;
}

// ─── Onglet Compte (or : recettes / dépenses) ─────────────────────
// Réutilise la couche economy.js (useGold) + le modèle c.compte de la fiche.
function _msTabCompte(c, uid, canEdit) {
  const compte   = c?.compte || { recettes: [], depenses: [] };
  const recettes = compte.recettes || [];
  const depenses = compte.depenses || [];
  const totalR = recettes.reduce((s, r) => s + (parseFloat(r?.montant) || 0), 0);
  const totalD = depenses.reduce((s, d) => s + (parseFloat(d?.montant) || 0), 0);
  const solde  = calcOr(c);

  const addForm = canEdit ? `
    <div class="vtt-ms-cpt-add">
      <div class="vtt-ms-cpt-fields">
        <input id="vtt-ms-cpt-lib" class="vtt-ms-cpt-lib" type="text" placeholder="Libellé (ex. Vente potion)" maxlength="60">
        <div class="vtt-ms-cpt-amt-wrap">
          <input id="vtt-ms-cpt-amt" class="vtt-ms-cpt-amt" type="number" min="0" step="1" placeholder="0" inputmode="numeric"
            onkeydown="if(event.key==='Enter')this.blur()">
          <span class="vtt-ms-cpt-amt-suffix">or</span>
        </div>
      </div>
      <div class="vtt-ms-cpt-btns">
        <button class="vtt-ms-cpt-btn pos" data-vtt-fn="_vttMsCompteAdd" data-vtt-args="${c.id}|${uid}|1"  title="Ajouter une recette">+ Recette</button>
        <button class="vtt-ms-cpt-btn neg" data-vtt-fn="_vttMsCompteAdd" data-vtt-args="${c.id}|${uid}|-1" title="Ajouter une dépense">− Dépense</button>
        ${solde > 0 ? `<button class="vtt-ms-cpt-btn gold" data-vtt-fn="_vttMsSendGoldPicker" data-vtt-args="${c.id}|${uid}" title="Envoyer de l'or à un joueur présent">💰 Envoyer</button>` : ''}
      </div>
    </div>` : '';

  // Liste compacte par type : 5 plus récentes (fin de tableau), récent en haut.
  const histList = (list, type) => {
    if (!list.length) return `<div class="vtt-ms-cpt-empty">Aucune entrée.</div>`;
    return list.map((r, i) => ({ r, i })).slice(-5).reverse().map(({ r, i }) => `
      <div class="vtt-ms-cpt-row">
        <span class="vtt-ms-cpt-row-lib" title="${_esc(r.libelle || '')}">${_esc(r.libelle || '—')}</span>
        <span class="vtt-ms-cpt-row-amt ${type === 'recettes' ? 'pos' : 'neg'}">${type === 'recettes' ? '+' : '−'}${r.montant || 0}</span>
        ${canEdit ? `<button class="vtt-ms-cpt-del" data-vtt-fn="_vttMsCompteDel" data-vtt-args="${c.id}|${uid}|${type}|${i}" title="Supprimer">🗑️</button>` : ''}
      </div>`).join('');
  };

  return `<div class="vtt-ms-cpt">
    <div class="vtt-ms-cpt-solde">
      <div class="vtt-ms-cpt-solde-main">💰 <strong>${solde}</strong><span class="vtt-ms-cpt-or">or</span></div>
      <div class="vtt-ms-cpt-solde-sub">
        <span class="pos">+${totalR}</span> · <span class="neg">−${totalD}</span>
      </div>
    </div>
    ${addForm}
    <div class="vtt-ms-cpt-cols">
      <div class="vtt-ms-cpt-col">
        <div class="vtt-ms-cpt-col-hd pos">📈 Recettes</div>
        ${histList(recettes, 'recettes')}
      </div>
      <div class="vtt-ms-cpt-col">
        <div class="vtt-ms-cpt-col-hd neg">📉 Dépenses</div>
        ${histList(depenses, 'depenses')}
      </div>
    </div>
  </div>`;
}

// Ajoute une recette (sign>0) ou dépense (sign<0). Réutilise useGold (vérifie le
// solde pour une dépense, 1 seule écriture, libellé cohérent avec la fiche).
async function _vttMsCompteAdd(charId, uid, sign) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const amtEl = document.getElementById('vtt-ms-cpt-amt');
  const libEl = document.getElementById('vtt-ms-cpt-lib');
  const montant = Math.abs(parseFloat(amtEl?.value) || 0);
  if (!montant) { showNotif('Montant invalide', 'info'); amtEl?.focus(); return; }
  const s = parseInt(sign) < 0 ? -1 : 1;
  const reason = (libEl?.value || '').trim() || (s > 0 ? 'Recette' : 'Dépense');
  const res = await useGold(charId, s * montant, reason, { charObj: c, refreshUI: false });
  if (!res.ok) { showNotif(res.error || 'Erreur', 'error'); return; }
  showNotif(`${s > 0 ? '+' : '−'}${montant} or — ${reason}`, 'success');
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

// Supprime une ligne de compte (recettes|depenses).
async function _vttMsCompteDel(charId, uid, type, idx) {
  if (!_msCanEdit(uid)) return;
  if (type !== 'recettes' && type !== 'depenses') return;
  idx = parseInt(idx);
  const c = VS.characters[charId]; if (!c) return;
  const compte = { recettes: [], depenses: [], ...(c.compte || {}) };
  const list = [...(compte[type] || [])];
  if (!list[idx]) return;
  list.splice(idx, 1);
  const newCompte = { ...compte, [type]: list };
  try {
    await updateDoc(_chrRef(charId), { compte: newCompte });
    c.compte = newCompte;
    if (VS.miniUid) _renderMiniSheet(VS.miniUid);
  } catch (e) { console.error('[vtt] compte del', e); showNotif('Erreur suppression', 'error'); }
}

// Envoyer de l'or à un joueur présent — choix du montant + destinataire (mini-fiche).
function _vttMsSendGoldPicker(charId, uid) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const solde = calcOr(c);
  if (solde <= 0) { showNotif('Solde vide', 'info'); return; }
  const targets = Object.entries(VS.presence)
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) => Object.values(VS.characters)
      .filter(ch => ch.uid === pUid)
      .map(ch => ({ charId: ch.id, charNom: ch.nom || p.pseudo, pseudo: p.pseudo })));
  if (!targets.length) { showNotif('Aucun joueur présent à qui envoyer de l\'or', 'info'); return; }
  openModal('💰 Envoyer de l\'or', `
    <div style="display:flex;flex-direction:column;gap:.55rem">
      <div style="font-size:.8rem;color:var(--text-dim)">Solde : <strong style="color:var(--gold)">${solde} or</strong></div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.75rem">Montant</label>
        <input type="number" id="vtt-ms-gold-amt" class="input-field" min="1" max="${solde}" value="1" style="max-width:140px">
      </div>
      <p style="margin:.2rem 0 0;font-size:.85rem;color:var(--text-dim)">Destinataire :</p>
      ${targets.map(t => `<button class="btn btn-outline" style="text-align:left"
        data-vtt-fn="_vttMsConfirmSendGold" data-vtt-args="${charId}|${uid}|${t.charId}">
        ${_esc(t.pseudo)} → ${_esc(t.charNom)}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Effectue le transfert d'or entre deux persos (débit + crédit, rollback si échec).
// La règle Firestore autorise un non-propriétaire à modifier le `compte` d'un
// autre perso (cf. don d'objet) ; on passe charObj car STATE.characters est vide
// côté VTT (les persos vivent dans VS.characters).
async function _vttMsConfirmSendGold(senderCharId, senderUid, recipCharId) {
  if (!_msCanEdit(senderUid)) return;
  const sender = VS.characters[senderCharId]; if (!sender) return;
  const recip  = VS.characters[recipCharId];  if (!recip)  return;
  const amtEl = document.getElementById('vtt-ms-gold-amt');
  const montant = Math.floor(Math.abs(parseFloat(amtEl?.value) || 0));
  if (!montant) { showNotif('Montant invalide', 'info'); amtEl?.focus(); return; }
  if (montant > calcOr(sender)) { showNotif('Solde insuffisant', 'error'); return; }
  const debit = await useGold(senderCharId, -montant, `Don → ${recip.nom || 'joueur'}`, { charObj: sender, refreshUI: false });
  if (!debit.ok) { showNotif(debit.error || 'Erreur', 'error'); return; }
  const credit = await useGold(recipCharId, +montant, `Don ← ${sender.nom || 'joueur'}`, { charObj: recip, refreshUI: false });
  if (!credit.ok) {
    await useGold(senderCharId, +montant, 'Annulation du don', { charObj: sender, refreshUI: false }).catch(() => {});
    showNotif(/refus|permission/i.test(credit.error || '')
      ? "Envoi refusé : règle Firestore compte manquante (don d'or)" : (credit.error || 'Erreur — don annulé'), 'error');
    return;
  }
  closeModalDirect();
  showNotif(`💰 ${montant} or envoyé à ${recip.nom || 'joueur'}`, 'success');
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

function _msTabInventaire(c, uid, canEdit) {
  const inv = c?.inventaire||[];
  if (!inv.length) return '<div class="vtt-ms-empty">Inventaire vide</div>';

  const equip = c?.equipement||{};
  const CAT_LABEL = { arme:'⚔️ Armes', armure:'🛡 Armures', bijou:'💍 Bijoux', consommable:'🧪 Consommables', divers:'📦 Divers' };
  const cats = { arme:[], armure:[], bijou:[], consommable:[], divers:[] };

  // 1) Empilage par `itemId` UNIQUEMENT (objets boutique). Les entrées sans
  //    itemId restent une ligne par exemplaire — pas de fusion sur le nom.
  const stacksById = new Map();
  const singletons = [];
  inv.forEach((item, i) => {
    if (!item?.nom) return;
    if (item.itemId) {
      if (!stacksById.has(item.itemId)) stacksById.set(item.itemId, { item, indices: [] });
      stacksById.get(item.itemId).indices.push(i);
    } else {
      singletons.push({ item, indices: [i] });
    }
  });
  // 2) Range les groupes/singletons par catégorie
  for (const g of [...stacksById.values(), ...singletons]) {
    cats[_msCatItem(g.item)].push(g);
  }

  const _rarColor = (rar) => ({
    commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff',
    tres_rare:'#b47fff', legendaire:'#f59e0b',
  })[rar] || '#9ca3af';

  // Barre de filtre dès 4 objets : recherche toujours dispo ; puces de catégorie
  // seulement s'il y en a plusieurs (inutiles sur une seule catégorie).
  const presentCats = Object.entries(cats).filter(([, g]) => g.length);
  let filterBar = '';
  if (inv.length >= 4) {
    const chips = presentCats.length > 1
      ? [{ key:'all', label:'Tous' }, ...presentCats.map(([cat]) => ({ key: cat, label: CAT_LABEL[cat] }))]
      : [];
    if (!chips.some(ch => ch.key === _msInvCat)) _msInvCat = 'all';
    filterBar = _msFilterBar('inv', chips, _msInvQuery);
  } else { _msInvCat = 'all'; _msInvQuery = ''; }

  let html = filterBar + '<div class="vtt-ms-inv">';
  for (const [cat, groups] of Object.entries(cats)) {
    if (!groups.length) continue;
    const totalUnits = groups.reduce((s,g) => s + g.indices.length, 0);
    html += `<div class="vtt-ms-inv-group" data-cat="${cat}">
      <div class="vtt-ms-inv-cat">
        <span class="vtt-ms-inv-cat-lbl">${CAT_LABEL[cat]}</span>
        <span class="vtt-ms-inv-cnt">${totalUnits}</span>
      </div>`;
    for (const g of groups) {
      const item = g.item;
      const firstIdx = g.indices[0];
      const total = g.indices.length;
      const equippedIdx = g.indices.find(idx => Object.values(equip).some(e => e?.sourceInvIndex === idx));
      const isEq = equippedIdx !== undefined;
      const idxToEquip = g.indices.find(idx => !Object.values(equip).some(e => e?.sourceInvIndex === idx)) ?? firstIdx;
      const idxToUnequip = equippedIdx ?? firstIdx;
      const detail = item.degats
        ? `${item.degats}${item.typeArme?' · '+item.typeArme:''}${item.portee?' · '+item.portee:''}`
        : (item.typeArmure ? `${item.typeArmure}${item.ca?' · CA +'+item.ca:''}` : '');
      const rarDot = item.rarete
        ? `<span class="vtt-ms-inv-rar" style="background:${_rarColor(item.rarete)}"></span>` : '';
      html += `<div class="vtt-ms-inv-item${isEq?' is-equipped':''}" data-name="${_esc(_norm(item.nom||''))}">
        ${rarDot}
        ${item.image
          ? `<img class="vtt-ms-inv-img" src="${item.image}" alt="">`
          : `<span class="vtt-ms-inv-img vtt-ms-inv-img--empty">${cat==='consommable'?'🧪':cat==='arme'?'⚔️':cat==='armure'?'🛡':cat==='bijou'?'💍':'📦'}</span>`}
        <div class="vtt-ms-inv-body">
          <div class="vtt-ms-inv-line1">
            <span class="vtt-ms-inv-nom" title="${_esc(item.nom)}">${_esc(item.nom)}</span>
            ${total>1?`<span class="vtt-ms-inv-qte">×${total}</span>`:''}
            ${isEq?'<span class="vtt-ms-inv-badge">équipé</span>':''}
          </div>
          ${detail?`<div class="vtt-ms-inv-detail">${_esc(detail)}</div>`:''}
        </div>
        ${canEdit?`<div class="vtt-ms-inv-actions">
          ${(cat==='arme'||cat==='armure'||cat==='bijou') && (!isEq || total > 1)
            ?`<button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsEquipPicker" data-vtt-args="${c.id}|${uid}|${idxToEquip}" title="Équiper">⚔️</button>`
            :''}
          ${isEq
            ?`<button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsUnequipAll" data-vtt-args="${c.id}|${uid}|${idxToUnequip}" title="Déséquiper">🔓</button>`
            :''}
          <button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsSendPicker" data-vtt-args="${c.id}|${uid}|${firstIdx}" title="Envoyer">📤</button>
          <button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsDeleteItem" data-vtt-args="${c.id}|${uid}|${firstIdx}" title="Supprimer">🗑️</button>
        </div>`:''}
      </div>`;
    }
    html += `</div>`; // .vtt-ms-inv-group
  }
  html += '</div>';
  html += `<div class="vtt-ms-filter-empty" data-kind="inv" style="display:none">Aucun objet ne correspond.</div>`;
  return html;
}

// ── Onglet Craft (recette rapide) ───────────────────────────────────────
// Liste les recettes connues du joueur (collection `recipes`, partagées via
// `acces`). Crafter consomme les ingrédients présents en sac et lance un jet
// d'Artisanat (d20 + mod INT) vs DD 11. Réussite → ajoute le résultat (objet
// boutique réel si la recette y est liée via shopItemId, sinon un consommable).
// Échec → ingrédients perdus quand même. Le jet est posté dans le log VTT.
const _MS_CRAFT_DD = 11;
const _MS_CRAFT_TYPE_ICON = { cuisine:'🍳', potion:'🧪', arme:'⚔️', armure:'🛡', bijou:'💍' };

let _msCraftRecipes = null;   // recettes chargées (array) | null = pas encore chargé
let _msCraftLoading = false;
let _msCraftShop    = null;   // items boutique (chargés à la demande pour les recettes liées)

// Charge les recettes une fois (cache session). Re-render à l'arrivée des données.
async function _msEnsureCraftRecipes() {
  if (_msCraftRecipes !== null || _msCraftLoading) return;
  _msCraftLoading = true;
  try { _msCraftRecipes = await loadCollection('recipes'); }
  catch { _msCraftRecipes = []; }
  finally {
    _msCraftLoading = false;
    if (VS.miniUid && _miniTab === 'craft') _renderMiniSheet(VS.miniUid);
  }
}

// Recettes connues du perso : MJ = toutes, joueur = celles partagées avec lui.
function _msKnownRecipes(uid) {
  const list = _msCraftRecipes || [];
  return STATE.isAdmin ? list : list.filter(r => (r.acces || []).includes(uid));
}

// Compte les unités d'inventaire par nom normalisé (convention 1 entrée = 1 unité).
function _msInvNameCounts(c) {
  const counts = new Map();
  (c?.inventaire || []).forEach(it => {
    if (!it?.nom) return;
    const k = _norm(it.nom);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return counts;
}

// État des ingrédients d'une recette vis-à-vis du sac.
function _msRecipeIngrStatus(recipe, counts) {
  const ingrs = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).filter(ig => ig?.nom);
  const rows = ingrs.map(ig => {
    const need = Math.max(1, parseInt(ig.quantite) || 1);
    const have = counts.get(_norm(ig.nom)) || 0;
    return { nom: ig.nom, need, have, ok: have >= need };
  });
  return { rows, hasIngr: ingrs.length > 0, allOk: ingrs.length > 0 && rows.every(r => r.ok) };
}

function _msTabCraft(c, uid, canEdit) {
  if (_msCraftRecipes === null) { _msEnsureCraftRecipes(); return '<div class="vtt-ms-empty">⏳ Chargement des recettes…</div>'; }

  const known = _msKnownRecipes(uid);
  if (!known.length) return '<div class="vtt-ms-empty">Aucune recette connue.</div>';

  const counts = _msInvNameCounts(c);
  const cards  = known
    .map(r => ({ r, st: _msRecipeIngrStatus(r, counts) }))
    .sort((a, b) => (b.st.allOk - a.st.allOk) || (a.r.nom || '').localeCompare(b.r.nom || ''));

  return _msFilterBar('craft', [], _msCraftQuery)
    + `<div class="vtt-ms-filter-empty" data-kind="craft" style="display:none">Aucune recette ne correspond.</div>`
    + `<div class="vtt-ms-craft">${cards.map(({ r, st }) => {
    const icon = _MS_CRAFT_TYPE_ICON[r.type] || '🔨';
    const searchTxt = _norm([r.nom, r.type, r.effet, ...((r.ingredients || []).map(ig => ig?.nom))].filter(Boolean).join(' '));
    const ingrHtml = st.hasIngr
      ? `<div class="vtt-ms-craft-ingrs">${st.rows.map(row =>
          `<span class="vtt-ms-craft-ingr ${row.ok ? 'ok' : 'ko'}">${_esc(row.nom)} <b>${row.have}/${row.need}</b></span>`).join('')}</div>`
      : `<div class="vtt-ms-craft-noingr">Pas d'ingrédients listés — non craftable ici.</div>`;
    const canCraft = canEdit && st.allOk;
    const btnTitle = !canEdit ? 'Lecture seule'
      : !st.hasIngr ? 'Recette sans ingrédients structurés'
      : !st.allOk ? 'Ingrédients manquants'
      : `Jet d'Artisanat (INT) DD ${_MS_CRAFT_DD}`;
    return `<div class="vtt-ms-craft-card${st.allOk ? ' craftable' : ''}" data-name="${_esc(searchTxt)}">
      <div class="vtt-ms-craft-hd">
        <span class="vtt-ms-craft-type" title="${_esc(r.type || '')}">${icon}</span>
        <span class="vtt-ms-craft-name" title="${_esc(r.nom || '')}">${_esc(r.nom || '?')}</span>
        ${r.shopItemId ? `<span class="vtt-ms-craft-out" title="Donne un objet à la réussite">🎁</span>` : ''}
      </div>
      ${ingrHtml}
      ${r.effet ? `<div class="vtt-ms-craft-effet">✨ ${_esc(r.effet)}</div>` : ''}
      <button class="vtt-ms-craft-btn" title="${_esc(btnTitle)}"${canCraft ? '' : ' disabled'}
        data-vtt-fn="_vttMsCraft" data-vtt-args="${c.id}|${uid}|${r.id}">
        🔨 Crafter <span class="vtt-ms-craft-dd">DD ${_MS_CRAFT_DD} · INT</span>
      </button>
    </div>`;
  }).join('')}</div>`;
}

// Objet produit par un craft réussi : l'objet boutique lié à la recette, ou
// null si la recette n'a pas d'objet associé (ex. cuisine) — dans ce cas le
// craft se limite à consommer les ingrédients (résultat ajouté à la main).
async function _msBuildCraftResult(recipe) {
  if (!recipe.shopItemId) return null;
  if (_msCraftShop === null) { try { _msCraftShop = await loadCollection('shop'); } catch { _msCraftShop = []; } }
  const shopItem = _msCraftShop.find(i => i.id === recipe.shopItemId);
  return shopItem ? shopItemToInvEntry(shopItem, { source: 'craft' }) : null;
}

// Tente le craft : jet d'Artisanat (INT) DD 11. Consomme les ingrédients
// (succès OU échec) ; ajoute le résultat uniquement si réussi.
async function _vttMsCraft(charId, uid, recipeId) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const recipe = (_msCraftRecipes || []).find(r => r.id === recipeId); if (!recipe) return;

  const status = _msRecipeIngrStatus(recipe, _msInvNameCounts(c));
  if (!status.hasIngr) { showNotif('Recette sans ingrédients structurés.', 'info'); return; }
  if (!status.allOk)   { showNotif('Ingrédients insuffisants.', 'error'); return; }

  const ingrTxt = status.rows.map(r => `${r.need}× ${r.nom}`).join(', ');
  const outTxt = recipe.shopItemId
    ? `Réussite → l'objet de la recette est ajouté au sac. `
    : `Réussite → aucun objet produit (recette sans objet lié), à ajouter à la main. `;
  if (!await confirmModal(
    `Tenter de crafter <b>${_esc(recipe.nom || '')}</b> ?<br>
     <span style="color:var(--text-dim);font-size:.85rem">Jet d'Artisanat (INT) DD ${_MS_CRAFT_DD}. ${outTxt}Les ingrédients (${_esc(ingrTxt)}) sont consommés même en cas d'échec.</span>`,
    { title: '🔨 Recette rapide', confirmLabel: 'Lancer le jet' })) return;

  // 1) Indices des entrées à consommer (les `need` premières par nom normalisé).
  const oldInv = [...(c.inventaire || [])];
  const removedSet = new Set();
  for (const row of status.rows) {
    const key = _norm(row.nom);
    let left = row.need;
    for (let i = 0; i < oldInv.length && left > 0; i++) {
      if (!removedSet.has(i) && oldInv[i]?.nom && _norm(oldInv[i].nom) === key) { removedSet.add(i); left--; }
    }
    if (left > 0) { showNotif('Ingrédients insuffisants.', 'error'); return; } // garde-fou (course)
  }

  // 2) Jet d'Artisanat INT DD 11 (nat 1 = échec auto, nat 20 = succès auto).
  const mod    = getMod(c, 'intelligence');
  const d20    = Math.floor(Math.random() * 20) + 1;
  const total  = d20 + mod;
  const passed = d20 !== 1 && (d20 === 20 || total >= _MS_CRAFT_DD);

  // 3) Nouvel inventaire (ingrédients retirés) + objet appendé si réussite & objet lié.
  const removedIdx = [...removedSet];
  const newInv = oldInv.filter((_, i) => !removedSet.has(i));
  let produced = null;
  if (passed) { produced = await _msBuildCraftResult(recipe); if (produced) newInv.push(produced); }

  // 4) Réindexe l'équipement (mêmes règles que l'artisan : indices d'origine).
  c.inventaire = newInv;
  const sync = syncEquipmentAfterInventoryMutation(c, removedIdx);

  try {
    await updateDoc(_chrRef(charId), { inventaire: newInv, equipement: sync.equipement, statsBonus: sync.statsBonus });
    c.equipement = sync.equipement; c.statsBonus = sync.statsBonus;
  } catch (e) { console.error('[vtt] craft', e); showNotif('Erreur sauvegarde', 'error'); return; }

  // 5) Log VTT (visible par toute la table).
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || c.nom || 'Joueur';
  addDoc(_logCol(), {
    type: 'craft', authorId: STATE.user?.uid || null, authorName,
    charName: c.nom || '', recipeName: recipe.nom || '',
    statLabel: 'Artisanat (INT)', mod, d20, total, dd: _MS_CRAFT_DD, passed,
    createdAt: serverTimestamp(),
  }).catch(() => {});

  const okMsg = produced ? `✅ ${produced.nom || recipe.nom} crafté !` : '✅ Réussi — ingrédients consommés';
  showNotif(
    `🔨 Artisanat : d20[${d20}]${mod >= 0 ? '+' : ''}${mod} = ${total} vs DD ${_MS_CRAFT_DD} → ` +
    (passed ? okMsg : '❌ Échec — ingrédients perdus'),
    passed ? 'success' : 'error');

  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

// ── Onglet Notes (modèle notesList partagé avec la vraie fiche) ──────────
function _msTabNotes(c, uid, canEdit) {
  const notes = c?.notesList || [];
  let html = `<div class="vtt-ms-notes">`;
  if (canEdit) {
    html += `<button class="vtt-ms-note-add" data-vtt-fn="_vttMsAddNote" data-vtt-args="${c.id}|${uid}">+ Nouvelle note</button>`;
  }
  if (!notes.length) {
    html += `<div class="vtt-ms-empty">${canEdit ? 'Aucune note. Crée-en une.' : 'Aucune note.'}</div></div>`;
    return html;
  }
  notes.forEach((note, i) => {
    const open = _msOpenNote === i;
    const body = open ? (canEdit
      ? `<div class="vtt-ms-note-body">
          <textarea class="vtt-ms-note-area" id="vtt-ms-note-${c.id}-${i}" rows="6"
            placeholder="Contenu de la note…">${_esc(_msNoteText(note.contenu))}</textarea>
          <button class="vtt-ms-note-save" data-vtt-fn="_vttMsSaveNote" data-vtt-args="${c.id}|${uid}|${i}">💾 Enregistrer</button>
        </div>`
      : `<div class="vtt-ms-note-body"><div class="vtt-ms-note-content">${note.contenu || '<em style="opacity:.5">Vide</em>'}</div></div>`)
      : '';
    html += `<div class="vtt-ms-note-card${open ? ' open' : ''}">
      <div class="vtt-ms-note-hd" data-vtt-fn="_vttMsToggleNote" data-vtt-args="${i}">
        <span class="vtt-ms-note-title">${_esc(note.titre || 'Note sans titre')}</span>
        <div class="vtt-ms-note-hd-r">
          ${canEdit ? `<button class="vtt-ms-note-ic" data-vtt-fn="_vttMsRenameNote" data-vtt-args="${c.id}|${uid}|${i}" title="Renommer">✏️</button>
                       <button class="vtt-ms-note-ic" data-vtt-fn="_vttMsDeleteNote" data-vtt-args="${c.id}|${uid}|${i}" title="Supprimer">🗑️</button>` : ''}
          <span class="vtt-ms-note-chev">${open ? '▲' : '▼'}</span>
        </div>
      </div>
      ${note.date ? `<div class="vtt-ms-note-date">${_esc(note.date)}</div>` : ''}
      ${body}
    </div>`;
  });
  html += '</div>';
  return html;
}

// Texte affiché dans le textarea : si la note vient de l'éditeur riche de la vraie
// fiche (HTML), on la convertit en texte lisible pour ne pas montrer de balises.
function _msNoteText(contenu) {
  if (!contenu) return '';
  if (!/<[a-z][\s\S]*>/i.test(contenu)) return contenu; // déjà du texte brut
  const tmp = document.createElement('div');
  tmp.innerHTML = contenu.replace(/<\/(p|div|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function _vttMsAddNote(charId, uid) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  notes.push({ titre: 'Nouvelle note', contenu: '', date: new Date().toLocaleDateString('fr-FR') });
  _msOpenNote = notes.length - 1;
  await updateDoc(_chrRef(charId), { notesList: notes }).catch(() => showNotif('Erreur sauvegarde', 'error'));
}

function _vttMsToggleNote(idx) {
  idx = parseInt(idx);
  _msOpenNote = _msOpenNote === idx ? null : idx;
  if (VS.miniUid) _renderMiniSheet(VS.miniUid);
}

async function _vttMsRenameNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = VS.characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  if (!notes[idx]) return;
  const val = await promptModal('Titre de la note :', { title: 'Renommer la note', default: notes[idx].titre || 'Note sans titre' });
  if (val === null) return;
  notes[idx] = { ...notes[idx], titre: val.trim() || notes[idx].titre || 'Note sans titre' };
  await updateDoc(_chrRef(charId), { notesList: notes }).catch(() => showNotif('Erreur sauvegarde', 'error'));
}

async function _vttMsSaveNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = VS.characters[charId]; if (!c) return;
  const ta = document.getElementById(`vtt-ms-note-${charId}-${idx}`);
  const notes = [...(c.notesList || [])];
  if (!notes[idx] || !ta) return;
  notes[idx] = { ...notes[idx], contenu: ta.value };
  if (await updateDoc(_chrRef(charId), { notesList: notes }).then(() => true).catch(() => false))
    showNotif('Note enregistrée', 'success');
  else showNotif('Erreur sauvegarde', 'error');
}

async function _vttMsDeleteNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = VS.characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  if (!notes[idx]) return;
  if (!await confirmModal('Supprimer cette note ?', { title: 'Note', confirmLabel: 'Supprimer' })) return;
  notes.splice(idx, 1);
  if (_msOpenNote === idx) _msOpenNote = null;
  else if (_msOpenNote > idx) _msOpenNote--;
  if (await updateDoc(_chrRef(charId), { notesList: notes }).then(() => true).catch(() => false))
    showNotif('Note supprimée', 'info');
}

// ─── Rendu principal ─────────────────────────────────────────────

function _renderMiniSheet(uid) {
  try { return _renderMiniSheetImpl(uid); }
  catch (e) { _vttPanelError('Mini-fiche', e, 'vtt-mini-panel'); }
}
function _renderMiniSheetImpl(uid) {
  const panel = document.getElementById('vtt-mini-panel');
  if (!panel) return;

  const pres = VS.presence[uid];
  if (!uid || !pres) { panel.classList.remove('open'); panel.innerHTML = ''; return; }

  const chars = sortCharactersForDisplay(Object.values(VS.characters).filter(c => c.uid === uid));
  if (!chars.length) {
    panel.classList.add('open');
    panel.innerHTML = `<div class="vtt-ms-empty">Aucun personnage lié pour ${_esc(pres.pseudo)}.</div>`;
    return;
  }

  const validId = chars.find(c => c.id === VS.miniCharId) ? VS.miniCharId : chars[0].id;
  VS.miniCharId = validId;
  const c = chars.find(c => c.id === validId);
  const canEdit = _msCanEdit(uid);

  const img      = c?.photoURL || c?.photo || c?.avatar || null;
  const init     = (c?.nom || '?')[0].toUpperCase();
  const subtitle = [c?.race, c?.titreActuel||c?.titre, c?.niveau ? 'Niv.'+c.niveau : ''].filter(Boolean).join(' · ');

  const selectorHtml = chars.length > 1
    ? `<div class="vtt-ms-selector">${chars.map(ch =>
        `<button class="vtt-ms-sel-btn${ch.id===validId?' active':''}"
          data-vtt-fn="_vttSelectMiniChar" data-vtt-args="${uid}|${ch.id}">${ch.nom||'Perso'}</button>`
      ).join('')}</div>`
    : '';

  const TABS = [
    { key:'combat', icon:'⚔️', label:'Combat' },
    { key:'equip',  icon:'🛡',  label:'Équip.' },
    { key:'sorts',  icon:'✨',  label:'Sorts'  },
    { key:'inv',    icon:'🎒',  label:'Sac'    },
    { key:'craft',  icon:'🔨', label:'Craft'  },
    { key:'compte', icon:'💰', label:'Or'     },
    { key:'notes',  icon:'📝', label:'Notes'  },
  ];
  const tabBarHtml = `<div class="vtt-ms-tabbar">${TABS.map(t =>
    `<button class="vtt-ms-tab${_miniTab===t.key?' active':''}" data-vtt-fn="_vttMsTab" data-vtt-args="${t.key}" title="${t.label}">
      <span class="vtt-ms-tab-ic">${t.icon}</span><span class="vtt-ms-tab-lbl">${t.label}</span>
    </button>`
  ).join('')}</div>`;

  const tabHtml =
      _miniTab === 'combat' ? _msTabCombat(c, uid, canEdit)
    : _miniTab === 'equip'  ? _msTabEquipement(c, uid, canEdit)
    : _miniTab === 'sorts'  ? _msTabSorts(c, uid, canEdit)
    : _miniTab === 'craft'  ? _msTabCraft(c, uid, canEdit)
    : _miniTab === 'compte' ? _msTabCompte(c, uid, canEdit)
    : _miniTab === 'notes'  ? _msTabNotes(c, uid, canEdit)
    :                         _msTabInventaire(c, uid, canEdit);

  panel.classList.add('open');
  panel.innerHTML = `
    <div class="vtt-ms-header">
      ${img
        ? `<img class="vtt-ms-avatar" src="${img}" alt="">`
        : `<div class="vtt-ms-avatar-init">${init}</div>`}
      <div class="vtt-ms-info">
        <div class="vtt-ms-name">${c?.nom||'Personnage'}</div>
        ${subtitle ? `<div class="vtt-ms-sub">${subtitle}</div>` : ''}
        <div class="vtt-ms-player">👤 ${pres.pseudo}</div>
      </div>
      <button class="vtt-ms-close" data-vtt-fn="_vttToggleMiniSheet" data-vtt-args="${uid}" title="Fermer">✕</button>
    </div>
    ${selectorHtml}
    ${tabBarHtml}
    <div class="vtt-ms-tab-content">${tabHtml}</div>`;

  // Applique le filtre de l'onglet actif sur le DOM fraîchement rendu.
  if (_miniTab === 'inv')        _msApplyInvFilter();
  else if (_miniTab === 'sorts') _msApplySortFilter();
}

function _vttToggleMiniSheet(uid) {
  if (VS.miniUid === uid) {
    VS.miniUid = null; VS.miniCharId = null;
    const panel = document.getElementById('vtt-mini-panel');
    if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  } else {
    VS.miniUid = uid; VS.miniCharId = null;
    _renderMiniSheet(uid);
  }
  _renderPresenceCol();
}

function _vttSelectMiniChar(uid, charId) {
  VS.miniCharId = charId;
  // Reset des filtres : l'inventaire/les sorts diffèrent d'un perso à l'autre.
  _msInvQuery = ''; _msInvCat = 'all'; _msSortQuery = ''; _msSortCat = 'all'; _msCraftQuery = '';
  _renderMiniSheet(uid);
}

export {
  _msApplyInvFilter,
  _msApplySortFilter,
  _msBuildEquipItem,
  _msCanEdit,
  _msCatItem,
  _msFilterBar,
  _msItemFitsSlot,
  _msNoteText,
  _msSetActiveChip,
  _msSyncClearBtn,
  _msTabCombat,
  _msTabCompte,
  _msTabCraft,
  _msTabEquipement,
  _msTabInventaire,
  _msTabNotes,
  _msTabSorts,
  _msToggleEmpty,
  _msXpSection,
  _renderMiniSheet,
  _vttMsAddNote,
  _vttMsCompteAdd,
  _vttMsSendGoldPicker,
  _vttMsConfirmSendGold,
  _vttMsCompteDel,
  _vttMsConfirmSend,
  _vttMsCraft,
  _vttMsCraftSearch,
  _vttMsCraftClear,
  _vttMsDeleteItem,
  _vttMsDeleteNote,
  _vttMsEquip,
  _vttMsEquipPicker,
  _vttMsInvCat,
  _vttMsInvClear,
  _vttMsInvSearch,
  _vttMsRenameNote,
  _vttMsSaveNote,
  _vttMsSendPicker,
  _vttMsSlotChange,
  _vttMsSortCat,
  _vttMsSortClear,
  _vttMsSortSearch,
  _vttMsTab,
  _vttMsToggleNote,
  _vttMsUnequip,
  _vttMsUnequipAll,
  _vttSelectMiniChar,
  _vttSpellCardHtml,
  _vttSpellChips,
  _vttToggleMiniSheet,
  _vttToggleMsSort,
};
