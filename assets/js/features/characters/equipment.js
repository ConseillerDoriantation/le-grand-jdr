import { STATE } from '../../core/state.js';
import { registerActions } from '../../core/actions.js';
import { updateInCol } from '../../data/firestore.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { computeEquipStatsBonus, getItemStatBonus, getItemEffectText } from '../../shared/char-stats.js';
import { _esc } from '../../shared/html.js';
import { _getTraits, _getBaseTraits, _getAddedTraits } from './data.js';

// ══════════════════════════════════════════════
// HELPERS D'INFÉRENCE
// ══════════════════════════════════════════════
function inferAttackStatFromItem(item = {}) {
  if (item.toucherStat) return item.toucherStat;
  if (item.statAttaque) return item.statAttaque;
  const format = String(item.format || '');
  if (format.includes('Mag.')) return 'intelligence';
  if (format.includes('Dist.')) return 'dexterite';
  return 'force';
}

function inferArmorSlotValue(slot, item = {}) {
  if (item.slotArmure) return item.slotArmure;
  if (slot === 'Bottes') return 'Pieds';
  return slot;
}

function inferAccessorySlotValue(slot, item = {}) {
  return item.slotBijou || slot;
}

export function buildEquippedItemFromInventory(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');

  // Traits BRUTS (base + addedTraits) — pas la version transformée par effectBonus.
  // L'item équipé conserve `upgrades.effectBonus` pour que `_getTraits(equippedItem)`
  // applique la transformation à l'affichage sans double application.
  const rawTraits   = [..._getBaseTraits(item), ..._getAddedTraits(item)];
  const effectBonus = parseInt(item.upgrades?.effectBonus) || 0;
  const equipUpgrades = effectBonus > 0 ? { effectBonus } : undefined;

  if (isWeapon) {
    return {
      nom: item.nom || '',
      traits: rawTraits,
      ...(equipUpgrades ? { upgrades: equipUpgrades } : {}),
      sousType: item.sousType || '',
      degats: item.degats || '',
      degatsStat: item.degatsStat || inferAttackStatFromItem(item),
      degatsStats: Array.isArray(item.degatsStats) && item.degatsStats.length
        ? [...item.degatsStats]
        : (item.degatsStat ? [item.degatsStat] : [inferAttackStatFromItem(item)]),
      toucherStat: item.toucherStat || inferAttackStatFromItem(item),
      statAttaque: inferAttackStatFromItem(item),
      typeArme: item.typeArme || item.type || '',
      portee: item.portee || '',
      particularite: item.particularite || getItemEffectText(item) || item.description || '',
      format: item.format || '',
      toucher: item.toucher || '',
      stats: item.stats || '',
      fo: getItemStatBonus(item, 'force'),
      dex: getItemStatBonus(item, 'dexterite'),
      in: getItemStatBonus(item, 'intelligence'),
      sa: getItemStatBonus(item, 'sagesse'),
      co: getItemStatBonus(item, 'constitution'),
      ch: getItemStatBonus(item, 'charisme'),
      // Bonus dérivés (PV/PM/Vitesse/Initiative) et compétences — propagés à l'équipement
      pvMaxBonus:     parseInt(item.pvMaxBonus)     || 0,
      pmMaxBonus:     parseInt(item.pmMaxBonus)     || 0,
      vitesseBonus:   parseInt(item.vitesseBonus)   || 0,
      initiativeBonus:parseInt(item.initiativeBonus)|| 0,
      caBonus:        parseInt(item.caBonus)        || 0,
      skillBonuses:   item.skillBonuses && typeof item.skillBonuses === 'object'
                      ? { ...item.skillBonuses } : {},
      sourceInvIndex: invIndex,
      itemId: item.itemId || '',
    };
  }

  return {
    nom: item.nom || '',
    traits: rawTraits,
    ...(equipUpgrades ? { upgrades: equipUpgrades } : {}),
    fo: getItemStatBonus(item, 'force'),
    dex: getItemStatBonus(item, 'dexterite'),
    in: getItemStatBonus(item, 'intelligence'),
    sa: getItemStatBonus(item, 'sagesse'),
    co: getItemStatBonus(item, 'constitution'),
    ch: getItemStatBonus(item, 'charisme'),
    ca: parseInt(item.ca) || 0,
    typeArmure: item.typeArmure || '',
    slotArmure: item.slotArmure ? inferArmorSlotValue(slot, item) : '',
    slotBijou: item.slotBijou ? inferAccessorySlotValue(slot, item) : '',
    // Bonus dérivés (PV/PM/Vitesse/Initiative) et compétences — propagés à l'équipement
    pvMaxBonus:     parseInt(item.pvMaxBonus)     || 0,
    pmMaxBonus:     parseInt(item.pmMaxBonus)     || 0,
    vitesseBonus:   parseInt(item.vitesseBonus)   || 0,
    initiativeBonus:parseInt(item.initiativeBonus)|| 0,
    caBonus:        parseInt(item.caBonus)        || 0,
    skillBonuses:   item.skillBonuses && typeof item.skillBonuses === 'object'
                    ? { ...item.skillBonuses } : {},
    sourceInvIndex: invIndex,
    itemId: item.itemId || '',
  };
}

// ══════════════════════════════════════════════
// ÉQUIPER DEPUIS L'INVENTAIRE (selection directe)
// ══════════════════════════════════════════════
export async function equipSlotFromInv(val, slot) {
  try {
    if (!val || !val.startsWith('inv:')) return;
    const c = STATE.activeChar; if (!c) return;

    const invIndex = parseInt(val.split(':')[1], 10);
    if (Number.isNaN(invIndex)) return;

    const item = (c.inventaire || [])[invIndex];
    if (!item) return;

    const equip = { ...(c.equipement || {}) };

    Object.keys(equip).forEach(otherSlot => {
      if (otherSlot !== slot && equip[otherSlot]?.sourceInvIndex === invIndex) {
        delete equip[otherSlot];
      }
    });

    const equippedItem = buildEquippedItemFromInventory(slot, item, invIndex);
    if (!equippedItem) return;

    equip[slot] = equippedItem;
    const bonus = computeEquipStatsBonus(equip);

    c.equipement = equip;
    c.statsBonus = bonus;

    await updateInCol('characters', c.id, { equipement: equip, statsBonus: bonus });
    closeModal();
    showNotif(`Équipement mis à jour : ${item.nom || 'objet'} → ${slot}`, 'success');
    window.renderCharSheet(c, 'combat');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════
// MODAL D'ÉDITION D'UN SLOT
// ══════════════════════════════════════════════
export function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equipped = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');

  // Tous les formats d'arme connus — un item ayant l'un de ces formats est une arme
  const WEAPON_FORMATS = new Set([
    'Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.',
    'Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)',
  ]);

  const SLOT_ARMURE = {
    'Tête':    { slot: 'Tête',  types: null },
    'Torse':   { slot: 'Torse', types: null },
    'Bottes':  { slot: 'Pieds', types: null },
    'Amulette':    null,
    'Anneau':      null,
    'Objet magique': null,
  };

  const inv = c.inventaire||[];
  const equippedEntries = Object.entries(c.equipement || {});
  const equippedInvIndex = Number.isInteger(equipped?.sourceInvIndex) ? equipped.sourceInvIndex : -1;

  const compatibles = inv
    .map((item, invIndex) => ({ item, invIndex }))
    .filter(({ item, invIndex }) => {
      if (!item?.nom) return false;

      const alreadyEquippedElsewhere = equippedEntries.some(([otherSlot, equippedItem]) =>
        otherSlot !== slot && equippedItem?.sourceInvIndex === invIndex
      );
      if (alreadyEquippedElsewhere) return false;

      const tpl = item.template || '';

      if (isWeapon) {
        // 1. Template explicite « arme » → OK
        if (tpl === 'arme') return true;
        // 2. Sinon, marqueurs d'arme présents peu importe le template :
        //    degats / toucher / sousType / format weapon → c'est une arme.
        //    (Permet de récupérer un Espadon depuis butin / cadeau MJ même
        //    si le template enregistré côté boutique n'était pas 'arme'.)
        if (item.degats || item.toucher || item.sousType ||
            (item.format && WEAPON_FORMATS.has(item.format))) return true;
        return false;
      }

      const armureRule = SLOT_ARMURE[slot];
      if (armureRule !== undefined) {
        if (armureRule === null) {
          return item.slotBijou === slot;
        }
        if (tpl === 'armure' || item.slotArmure) {
          return item.slotArmure === armureRule.slot;
        }
        const t = (item.type||'').toLowerCase();
        return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
      }

      return false;
    });

  const invOptions = compatibles.map(({ item, invIndex }) => {
    let label = item.nom;
    if (item.format) label += ` — ${item.format}`;
    else if (item.slotArmure && item.typeArmure) label += ` — ${item.typeArmure}`;
    const isSelected = equippedInvIndex === invIndex || (equippedInvIndex < 0 && equipped.nom === item.nom);
    return `<option value="inv:${invIndex}" ${isSelected?'selected':''}>${label}</option>`;
  }).join('');

  const hasCompat = compatibles.length > 0;
  const isBijou = ['Amulette','Anneau','Objet magique'].includes(slot);

  // Aperçu inventaire-only pour armures & bijoux : l'objet équipé est lu depuis l'inventaire,
  // plus de saisie manuelle pour ces slots. Les armes (Main…) gardent leur logique meta.
  const equippedHasItem = !!equipped?.nom;

  openModal(`${isWeapon?'⚔️':isBijou?'💍':'🛡️'} Équiper — ${slot}`, `
    ${hasCompat
      ? `<div class="form-group">
          <label>Choisir depuis l'inventaire <span style="font-size:0.72rem;color:var(--text-dim)">· équipe immédiatement</span></label>
          <select class="input-field sh-modal-select" id="eq-inv-sel" data-equip-slot="${slot}" data-change="equipSlotFromInv">
            <option value="">— Sélectionner un objet —</option>
            ${invOptions}
          </select>
        </div>`
      : `<div class="cs-equip-empty-inv">
          <span>⚠️ Aucun objet compatible dans l'inventaire.</span>
          <span style="font-size:0.72rem;color:var(--text-dim)">Achète des objets à la boutique pour les équiper ici.</span>
        </div>`
    }

    ${!isWeapon
      ? `<!-- Aperçu de l'objet équipé (lecture seule, hérité de l'inventaire) -->
         ${equippedHasItem ? `
         <div style="margin-top:.85rem;padding:.65rem .85rem;background:var(--bg-elevated);
           border:1px solid var(--border);border-radius:8px;font-size:.78rem">
           <div style="font-weight:700;color:var(--text);margin-bottom:.25rem">${_esc(equipped.nom||'')}</div>
           ${equipped.typeArmure ? `<span class="badge badge-gold" style="font-size:.65rem;margin-right:.3rem">${equipped.typeArmure}</span>` : ''}
           ${(equipped.ca || equipped.caBonus) ? `<span style="font-size:.72rem;color:#4f8cff">🛡️ CA +${(parseInt(equipped.ca)||0) + (parseInt(equipped.caBonus)||0)}</span>` : ''}
           ${equipped.particularite ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:.25rem">${_esc(equipped.particularite)}</div>` : ''}
           ${(Array.isArray(equipped.traits) ? equipped.traits : []).filter(Boolean).map(t=>
             `<div style="font-size:.7rem;color:#b47fff;font-style:italic;margin-top:.1rem">${_esc(t)}</div>`
           ).join('')}
         </div>` : ''}`
      : ''
    }

    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      ${isWeapon ? `<button class="btn btn-gold" style="flex:1" data-action="saveEquipSlot" data-slot="${slot}">Équiper</button>` : ''}
      ${equippedHasItem ? `<button class="btn btn-danger" ${isWeapon?'':'style="flex:1"'} data-action="clearEquipSlot" data-slot="${slot}">Retirer</button>` : ''}
      ${!isWeapon && !equippedHasItem ? `<button class="btn btn-outline" style="flex:1" data-action="_eqClose">Fermer</button>` : ''}
    </div>
  `);

  window._equipCompatibles  = compatibles;
  window._equipSelectedMeta = {
    format: equipped.format || '',
    toucher: equipped.toucher || '',
    toucherStat: equipped.toucherStat || inferAttackStatFromItem(equipped),
    degatsStat: equipped.degatsStat || equipped.statAttaque || '',
    degatsStats: Array.isArray(equipped.degatsStats) && equipped.degatsStats.length
      ? [...equipped.degatsStats]
      : (equipped.degatsStat ? [equipped.degatsStat] : []),
    stats: equipped.stats || '',
    fo: getItemStatBonus(equipped, 'force'),
    dex: getItemStatBonus(equipped, 'dexterite'),
    in: getItemStatBonus(equipped, 'intelligence'),
    sa: getItemStatBonus(equipped, 'sagesse'),
    co: getItemStatBonus(equipped, 'constitution'),
    ch: getItemStatBonus(equipped, 'charisme'),
    typeArmure: equipped.typeArmure || '',
    slotArmure: equipped.slotArmure || '',
    slotBijou: equipped.slotBijou || '',
    traits: Array.isArray(equipped.traits) ? [...equipped.traits] : [],
    sousType: equipped.sousType || '',
  };
}

// ══════════════════════════════════════════════
// PRÉ-REMPLIR DEPUIS INVENTAIRE
// ══════════════════════════════════════════════
export function previewEquipFromInv(val, slot) {
  if (!val || !val.startsWith('inv:')) return;
  const idx  = parseInt(val.split(':')[1], 10);
  const compat = (window._equipCompatibles||[]).find(entry => entry?.invIndex === idx) || (window._equipCompatibles||[])[idx];
  const item = compat?.item || compat;
  if (!item) return;

  const isWeapon = slot.startsWith('Main');
  if (isWeapon) {
    const inferredStat = item.statAttaque || item.toucherStat ||
      (item.format?.includes('Mag.')  ? 'intelligence' :
       item.format?.includes('Dist.') ? 'dexterite'    : 'force');

    if (window._equipSelectedMeta) {
      window._equipSelectedMeta.nom           = item.nom           || '';
      window._equipSelectedMeta.degats        = item.degats        || '';
      window._equipSelectedMeta.statAttaque   = inferredStat;
      window._equipSelectedMeta.toucherStat   = item.toucherStat   || inferredStat;
      window._equipSelectedMeta.degatsStat    = item.degatsStat    || inferredStat;
      window._equipSelectedMeta.degatsStats   = Array.isArray(item.degatsStats) && item.degatsStats.length
        ? [...item.degatsStats]
        : (item.degatsStat ? [item.degatsStat] : [inferredStat]);
      window._equipSelectedMeta.typeArme      = item.typeArme      || item.sousType || '';
      window._equipSelectedMeta.portee        = item.portee        || '';
      window._equipSelectedMeta.particularite = item.particularite || getItemEffectText(item) || '';
      window._equipSelectedMeta.format        = item.format        || '';
      window._equipSelectedMeta.toucher       = item.toucher       || '';
      window._equipSelectedMeta.stats         = item.stats         || '';
      window._equipSelectedMeta.traits        = Array.isArray(item.traits) ? [...item.traits] : (item.trait ? [item.trait] : []);
      window._equipSelectedMeta.sousType      = item.sousType      || '';
      window._equipSelectedMeta.sourceInvIndex = Number.isInteger(compat?.invIndex) ? compat.invIndex : -1;
    }
  }
  // Armures & bijoux : pas de pré-remplissage manuel — l'équipement passe directement
  // par equipSlotFromInv qui dérive l'objet équipé depuis l'inventaire.

  const preview = document.getElementById('eq-inv-preview');
  if (preview) {
    const tags = [
      item.format && `<span class="badge badge-gold" style="font-size:.65rem">${item.format}</span>`,
      item.slotArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.slotArmure}</span>`,
      item.typeArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.typeArmure}</span>`,
      item.degats && `<span style="font-size:.75rem;color:#ff6b6b">⚔️ ${item.degats}</span>`,
      item.toucher && `<span style="font-size:.75rem;color:#e8b84b">🎯 ${item.toucher}</span>`,
      (item.ca || item.caBonus) && `<span style="font-size:.75rem;color:#4f8cff">🛡️ CA +${(parseInt(item.ca)||0) + (parseInt(item.caBonus)||0)}</span>`,
    ].filter(Boolean).join(' ');
    preview.innerHTML = `<div class="cs-equip-inv-item" style="margin-top:.5rem;padding:.5rem .75rem;background:var(--bg-elevated);border-radius:8px;border:1px solid var(--border)">
      <strong style="font-size:.85rem">${item.nom}</strong>
      ${tags?`<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.25rem">${tags}</div>`:''}
      ${item.stats?`<div style="font-size:.72rem;color:#4f8cff;margin-top:.2rem">${item.stats}</div>`:''}
      ${_getTraits(item).map(t=>`<div style="font-size:.72rem;color:#b47fff;font-style:italic;margin-top:.1rem">${t}</div>`).join('')}
    </div>`;
  }
}

// ══════════════════════════════════════════════
// SAUVEGARDER UN SLOT
// ══════════════════════════════════════════════
export async function saveEquipSlot(slot) {
  try {
    const c = STATE.activeChar; if(!c) return;
    const equip = c.equipement||{};
    const meta = window._equipSelectedMeta || {};
    const isBijou = ['Amulette','Anneau','Objet magique'].includes(slot);

    if (slot.startsWith('Main')) {
      equip[slot] = {
        nom:           meta.nom           || '',
        degats:        meta.degats        || '',
        degatsStat:    meta.degatsStat    || meta.statAttaque || 'force',
        degatsStats:   Array.isArray(meta.degatsStats) && meta.degatsStats.length
          ? [...meta.degatsStats]
          : [meta.degatsStat || meta.statAttaque || 'force'],
        toucherStat:   meta.toucherStat   || meta.statAttaque || 'force',
        statAttaque:   meta.statAttaque   || 'force',
        typeArme:      meta.typeArme      || meta.sousType || '',
        portee:        meta.portee        || '',
        particularite: meta.particularite || '',
        traits:        Array.isArray(meta.traits) ? [...meta.traits] : [],
        format:        meta.format        || '',
        toucher:       meta.toucher       || '',
        stats:         meta.stats         || '',
        sousType:      meta.sousType      || '',
        sourceInvIndex: Number.isInteger(meta.sourceInvIndex) ? meta.sourceInvIndex : -1,
        fo: parseInt(meta.fo)||0, dex: parseInt(meta.dex)||0,
        in: parseInt(meta.in)||0, sa: parseInt(meta.sa)||0,
        co: parseInt(meta.co)||0, ch: parseInt(meta.ch)||0,
      };
    } else {
      // Armures & bijoux : équipés exclusivement via inventaire (equipSlotFromInv).
      // Cette branche ne devrait plus être atteinte ; on no-op proprement si appelée.
      closeModal();
      return;
    }
    c.equipement = equip;
    const bonus = computeEquipStatsBonus(equip);
    c.statsBonus = bonus;
    await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
    closeModal();
    showNotif('Équipement mis à jour !','success');
    window.renderCharSheet(c,'combat');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════
// VIDER UN SLOT
// ══════════════════════════════════════════════
export async function clearEquipSlot(slot) {
  try {
    const c = STATE.activeChar; if(!c) return;
    const equip = c.equipement||{};
    delete equip[slot];
    c.equipement = equip;
    const bonus = computeEquipStatsBonus(equip);
    c.statsBonus = bonus;
    await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
    closeModal();
    showNotif('Emplacement libéré.','success');
    window.renderCharSheet(c,'combat');
  } catch (e) { notifySaveError(e); }
}

registerActions({
  equipSlotFromInv: (el) => equipSlotFromInv(el.value, el.dataset.equipSlot),
  saveEquipSlot:  (btn) => saveEquipSlot(btn.dataset.slot),
  clearEquipSlot: (btn) => clearEquipSlot(btn.dataset.slot),
  _eqClose:       ()    => closeModal(),
});
