import { STATE } from '../../core/state.js';
import { updateInCol } from '../../data/firestore.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { computeEquipStatsBonus } from '../../shared/char-stats.js';
import { _getTraits } from './data.js';

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

function buildEquippedItemFromInventory(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');

  if (isWeapon) {
    return {
      nom: item.nom || '',
      traits: Array.isArray(item.traits) ? [...item.traits] : [],
      sousType: item.sousType || '',
      degats: item.degats || '',
      degatsStat: item.degatsStat || inferAttackStatFromItem(item),
      toucherStat: item.toucherStat || inferAttackStatFromItem(item),
      statAttaque: inferAttackStatFromItem(item),
      typeArme: item.typeArme || item.type || '',
      portee: item.portee || '',
      particularite: item.particularite || item.effet || item.description || '',
      format: item.format || '',
      toucher: item.toucher || '',
      stats: item.stats || '',
      fo: parseInt(item.fo) || 0,
      dex: parseInt(item.dex) || 0,
      in: parseInt(item.in) || 0,
      sa: parseInt(item.sa) || 0,
      co: parseInt(item.co) || 0,
      ch: parseInt(item.ch) || 0,
      sourceInvIndex: invIndex,
      itemId: item.itemId || '',
    };
  }

  return {
    nom: item.nom || '',
    traits: Array.isArray(item.traits) ? [...item.traits] : [],
    fo: parseInt(item.fo) || 0,
    dex: parseInt(item.dex) || 0,
    in: parseInt(item.in) || 0,
    sa: parseInt(item.sa) || 0,
    co: parseInt(item.co) || 0,
    ch: parseInt(item.ch) || 0,
    ca: parseInt(item.ca) || 0,
    typeArmure: item.typeArmure || '',
    slotArmure: item.slotArmure ? inferArmorSlotValue(slot, item) : '',
    slotBijou: item.slotBijou ? inferAccessorySlotValue(slot, item) : '',
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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// MODAL D'ÉDITION D'UN SLOT
// ══════════════════════════════════════════════
export function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equipped = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');

  const ARMES_1M_CAC    = ['Arme 1M CaC Phy.'];
  const ARME_SECONDAIRE = ['Arme Secondaire (Bouclier, Torche...)'];
  const TOUTES_ARMES    = ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)'];

  const SLOT_ARME_FORMATS = {
    'Main principale': ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.'],
    'Main secondaire': [...ARMES_1M_CAC, ...ARME_SECONDAIRE],
  };

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
        const formats = SLOT_ARME_FORMATS[slot] || TOUTES_ARMES;
        if (tpl === 'arme' || item.format) {
          if (!item.format && tpl === 'arme') return true;
          return formats.includes(item.format);
        }
        const t = (item.type||'').toLowerCase();
        return ['arme','weapon','épée','lance','hache','arc','dague','baguette','baton'].some(k => t.includes(k));
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

  openModal(`${isWeapon?'⚔️':isBijou?'💍':'🛡️'} Équiper — ${slot}`, `
    ${hasCompat
      ? `<div class="form-group">
          <label>Choisir depuis l'inventaire <span style="font-size:0.72rem;color:var(--text-dim)">· équipe immédiatement</span></label>
          <select class="input-field sh-modal-select" id="eq-inv-sel" data-equip-slot="${slot}" onchange="equipSlotFromInv(this.value, this.dataset.equipSlot)">
            <option value="">— Sélectionner un objet —</option>
            ${invOptions}
          </select>
        </div>`
      : `<div class="cs-equip-empty-inv">
          <span>⚠️ Aucun objet compatible dans l'inventaire.</span>
          <span style="font-size:0.72rem;color:var(--text-dim)">Achète des objets à la boutique pour les équiper ici.</span>
        </div>`
    }

    ${!isWeapon ? (isBijou ? `
    <!-- ── Bijou ── -->
    <div class="form-group"><label>Description / effet</label>
      <input class="input-field" id="eq-particularite" value="${equipped.particularite||''}" placeholder="ex: +1 à tous les jets de sauvegarde">
    </div>
    <div class="form-group"><label>Traits <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">séparés par des virgules</span></label>
      <input class="input-field" id="eq-traits" value="${(Array.isArray(equipped.traits)?equipped.traits:equipped.trait?[equipped.trait]:[]).join(', ')}" placeholder="ex: Résistance feu, Vision nocturne...">
    </div>
    <div class="form-group"><label>Bonus de statistiques</label>
      <div class="grid-4" style="gap:.5rem">
        ${[['fo','For'],['dex','Dex'],['in','Int'],['sa','Sag'],['co','Con'],['ch','Cha'],['ca','CA']].map(([k,l])=>`
          <div class="form-group" style="margin:0"><label style="font-size:.68rem">${l}</label>
            <input type="number" class="input-field" id="eq-${k}" value="${equipped[k]||''}" placeholder="0">
          </div>`).join('')}
      </div>
    </div>
    `
    : `
    <!-- ── Armure ── -->
    <div class="form-group">
      <label>Type d'armure
        ${slot==='Torse' ? `<span style="font-size:.68rem;font-weight:400;color:var(--text-dim)">
          · Légère +2 CA · Intermédiaire +4 CA · Lourde +6 CA</span>` : ''}
      </label>
      <select class="input-field sh-modal-select" id="eq-type-armure">
        <option value="">— Aucun —</option>
          ${['Légère','Intermédiaire','Lourde'].map(t=>`<option value="${t}" ${(equipped.typeArmure||'')=== t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>CA apportée <span style="font-size:.68rem;font-weight:400;color:var(--text-dim)">· uniquement pour armures à bonus spécifique · laisser vide en général</span></label>
      <input type="number" class="input-field" id="eq-ca" value="${equipped.ca||''}" placeholder="vide">
    </div>
    <div class="form-group"><label>Traits <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">séparés par des virgules</span></label>
      <input class="input-field" id="eq-traits" value="${(Array.isArray(equipped.traits)?equipped.traits:equipped.trait?[equipped.trait]:[]).join(', ')}" placeholder="ex: Résistance, Discrétion désavantage...">
    </div>
    <div class="form-group"><label>Bonus de statistiques</label>
      <div class="grid-4" style="gap:.5rem">
        ${[['fo','For'],['dex','Dex'],['in','Int'],['sa','Sag'],['co','Con'],['ch','Cha']].map(([k,l])=>`
          <div class="form-group" style="margin:0"><label style="font-size:.68rem">${l}</label>
            <input type="number" class="input-field" id="eq-${k}" value="${equipped[k]||''}" placeholder="0">
          </div>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>Particularité</label>
      <input class="input-field" id="eq-particularite" value="${equipped.particularite||''}" placeholder="ex: Résistance aux dégâts de feu...">
    </div>
    `):''}

    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveEquipSlot('${slot}')">Équiper</button>
      <button class="btn btn-danger" onclick="clearEquipSlot('${slot}')">Retirer</button>
    </div>
  `);

  window._equipCompatibles  = compatibles;
  window._equipSelectedMeta = {
    format: equipped.format || '',
    toucher: equipped.toucher || '',
    toucherStat: equipped.toucherStat || inferAttackStatFromItem(equipped),
    degatsStat: equipped.degatsStat || equipped.statAttaque || '',
    stats: equipped.stats || '',
    fo: parseInt(equipped.fo) || 0,
    dex: parseInt(equipped.dex) || 0,
    in: parseInt(equipped.in) || 0,
    sa: parseInt(equipped.sa) || 0,
    co: parseInt(equipped.co) || 0,
    ch: parseInt(equipped.ch) || 0,
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
      window._equipSelectedMeta.typeArme      = item.typeArme      || item.sousType || '';
      window._equipSelectedMeta.portee        = item.portee        || '';
      window._equipSelectedMeta.particularite = item.particularite || item.effet || '';
      window._equipSelectedMeta.format        = item.format        || '';
      window._equipSelectedMeta.toucher       = item.toucher       || '';
      window._equipSelectedMeta.stats         = item.stats         || '';
      window._equipSelectedMeta.traits        = Array.isArray(item.traits) ? [...item.traits] : (item.trait ? [item.trait] : []);
      window._equipSelectedMeta.sousType      = item.sousType      || '';
      window._equipSelectedMeta.sourceInvIndex = Number.isInteger(compat?.invIndex) ? compat.invIndex : -1;
    }
  } else {
    window._equipSelTypeArmure = item.typeArmure||'';
    window._equipSelSlotArmure = item.slotArmure||'';
    if (window._equipSelectedMeta) {
      window._equipSelectedMeta.typeArmure = item.typeArmure || '';
      window._equipSelectedMeta.slotArmure = item.slotArmure || '';
      window._equipSelectedMeta.traits     = Array.isArray(item.traits) ? [...item.traits] : [];
    }
    const traitsElA = document.getElementById('eq-traits');
    if (traitsElA) {
      const t = Array.isArray(item.traits) ? item.traits : (item.trait ? [item.trait] : []);
      traitsElA.value = t.join(', ');
    }
    const typeArmureEl = document.getElementById('eq-type-armure');
    if (typeArmureEl && item.typeArmure) typeArmureEl.value = item.typeArmure;
    ['fo','dex','in','sa','co','ch'].forEach(k => {
      const el = document.getElementById('eq-'+k);
      if (el && item[k] !== undefined) el.value = item[k];
    });
    const caEl = document.getElementById('eq-ca');
    if (caEl && item.ca) caEl.value = parseInt(item.ca)||0;
  }

  const preview = document.getElementById('eq-inv-preview');
  if (preview) {
    const tags = [
      item.format && `<span class="badge badge-gold" style="font-size:.65rem">${item.format}</span>`,
      item.slotArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.slotArmure}</span>`,
      item.typeArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.typeArmure}</span>`,
      item.degats && `<span style="font-size:.75rem;color:#ff6b6b">⚔️ ${item.degats}</span>`,
      item.toucher && `<span style="font-size:.75rem;color:#e8b84b">🎯 ${item.toucher}</span>`,
      item.ca && `<span style="font-size:.75rem;color:#4f8cff">🛡️ CA +${item.ca}</span>`,
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

    const readTraits = () => {
      const raw = document.getElementById('eq-traits')?.value || '';
      return raw.split(',').map(t => t.trim()).filter(Boolean);
    };

    if (slot.startsWith('Main')) {
      equip[slot] = {
        nom:           meta.nom           || '',
        degats:        meta.degats        || '',
        degatsStat:    meta.degatsStat    || meta.statAttaque || 'force',
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
    } else if (isBijou) {
      equip[slot] = {
        nom:           document.getElementById('eq-nom')?.value||'',
        particularite: document.getElementById('eq-particularite')?.value||'',
        traits:        readTraits(),
        fo:  parseInt(document.getElementById('eq-fo')?.value)||0,
        dex: parseInt(document.getElementById('eq-dex')?.value)||0,
        in:  parseInt(document.getElementById('eq-in')?.value)||0,
        sa:  parseInt(document.getElementById('eq-sa')?.value)||0,
        co:  parseInt(document.getElementById('eq-co')?.value)||0,
        ch:  parseInt(document.getElementById('eq-ch')?.value)||0,
        ca:  parseInt(document.getElementById('eq-ca')?.value)||0,
        slotBijou:  slot,
        typeArmure: meta.typeArmure||'',
        slotArmure: meta.slotArmure||'',
      };
    } else {
      equip[slot] = {
        nom:           document.getElementById('eq-nom')?.value||'',
        typeArmure:    document.getElementById('eq-type-armure')?.value || meta.typeArmure||'',
        ca:            parseInt(document.getElementById('eq-ca')?.value)||0,
        traits:        readTraits(),
        particularite: document.getElementById('eq-particularite')?.value||'',
        fo:  parseInt(document.getElementById('eq-fo')?.value)||0,
        dex: parseInt(document.getElementById('eq-dex')?.value)||0,
        in:  parseInt(document.getElementById('eq-in')?.value)||0,
        sa:  parseInt(document.getElementById('eq-sa')?.value)||0,
        co:  parseInt(document.getElementById('eq-co')?.value)||0,
        ch:  parseInt(document.getElementById('eq-ch')?.value)||0,
        slotArmure: meta.slotArmure||'',
      };
    }
    c.equipement = equip;
    const bonus = computeEquipStatsBonus(equip);
    c.statsBonus = bonus;
    await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
    closeModal();
    showNotif('Équipement mis à jour !','success');
    window.renderCharSheet(c,'combat');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}
