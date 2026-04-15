import { STATE } from '../../core/state.js';
import { updateInCol } from '../../data/firestore.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { RARETE_NAMES, _rareteColor } from '../../shared/rarity.js';
import { statShort, formatItemBonusText } from '../../shared/char-stats.js';
import {
  _getTraits,
  getEquippedInventoryIndexMap,
  syncEquipmentAfterInventoryMutation,
} from './data.js';

function _itemDegatsStatsShorts(item) {
  const arr = Array.isArray(item.degatsStats) && item.degatsStats.length
    ? item.degatsStats
    : (item.degatsStat ? [item.degatsStat] : []);
  return arr.map(statShort).filter(Boolean);
}

// ══════════════════════════════════════════════
// INVENTAIRE BOUTIQUE (section dans renderCharSheet)
// ══════════════════════════════════════════════
export function _renderInventaireBoutique(char) {
  const invRaw = (char.inventaire || []).map((item, i) => ({ item, i })).filter(({ item }) => item.source === 'boutique');
  if (!invRaw.length) return '';

  const canEdit = window._canEditChar ?? STATE.isAdmin;

  // ── Regrouper par itemId + nom ──────────────────────────────────────────
  const grouped = [];
  invRaw.forEach(({ item, i }) => {
    const key = (item.itemId||'') + '||' + (item.nom||'');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte)||1;
      existing.indices.push(i);
    } else {
      grouped.push({ key, item: {...item}, qte: parseInt(item.qte)||1, indices: [i] });
    }
  });

  const cards = grouped.map(g => {
    const item = g.item;
    const indicesB64 = btoa(JSON.stringify(g.indices));
    const rareteN  = parseInt(item.rarete) || 0;
    const rareteL  = RARETE_NAMES[rareteN] || '';
    const rareteC  = _rareteColor(rareteL) || '#555';
    const prixAchat = parseFloat(item.prixAchat) || 0;
    const prixVente = parseFloat(item.prixVente) || Math.round(prixAchat * 0.6);

    const infos = [];
    const bonusText = formatItemBonusText(item);
    if (item.format)      infos.push({ label: 'Format',    val: item.format });
    if (item.slotArmure)  infos.push({ label: 'Slot',      val: item.slotArmure });
    if (item.slotBijou)   infos.push({ label: 'Slot',      val: item.slotBijou });
    if (item.typeArmure)  infos.push({ label: 'Type',      val: item.typeArmure });
    if (item.degats) {
      const shs = _itemDegatsStatsShorts(item);
      infos.push({ label: '⚔️ Dégâts', val: `${item.degats}${shs.length ? ` + ${shs.join(' + ')}` : ''}`, color: '#ff6b6b' });
    }
    if (item.toucherStat) infos.push({ label: 'Toucher',    val: statShort(item.toucherStat), color: '#e8b84b' });
    else if (item.toucher) infos.push({ label: 'Toucher',   val: item.toucher, color: '#e8b84b' });
    if (item.ca || item.ca === 0) infos.push({ label: '🛡️ CA', val: item.ca });
    if (bonusText)        infos.push({ label: 'Stats',      val: bonusText,   color: '#4f8cff' });
    _getTraits(item).forEach(t => infos.push({ label: 'Trait', val: t, color: '#b47fff', italic: true }));
    if (item.type)        infos.push({ label: 'Type',       val: item.type });
    if (item.effet)       infos.push({ label: 'Effet',      val: item.effet });
    if (item.description) infos.push({ label: 'Desc.',      val: item.description, muted: true });

    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      padding:.85rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-left:3px solid ${rareteC}">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600;line-height:1.2">
            ${item.nom || '?'}
          </div>
          ${rareteL ? `<div style="font-size:.68rem;color:${rareteC};margin-top:1px">${'★'.repeat(rareteN)+'☆'.repeat(4-rareteN)} ${rareteL}</div>` : ''}
        </div>
        <span style="font-size:.72rem;background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:999px;padding:2px 8px;color:var(--text-muted);flex-shrink:0">×${g.qte}</span>
      </div>

      ${infos.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem .75rem">
        ${infos.map(info => `
          <div style="display:flex;align-items:baseline;gap:.3rem;font-size:.78rem">
            <span style="color:var(--text-dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.5px">${info.label}</span>
            <span style="color:${info.color||'var(--text-muted)'};${info.italic?'font-style:italic':''};font-weight:${info.color?'600':'400'}">${info.val}</span>
          </div>`).join('')}
      </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.25rem;
        padding-top:.5rem;border-top:1px solid var(--border)">
        <div style="font-size:.72rem;color:var(--text-dim)">
          <span title="Prix d'achat">💰 ${prixAchat} or</span>
          <span style="margin:0 .3rem;opacity:.4">·</span>
          <span title="Prix de revente" style="color:var(--gold)">🔄 ${prixVente} or/u</span>
        </div>
        ${canEdit ? `
        <div style="display:flex;gap:.4rem;align-items:center">
          <button onclick="openSellInvModal('${char.id}','${indicesB64}',${prixVente},'${item.nom||''}')"
            style="background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:var(--gold);transition:all .15s"
            onmouseover="this.style.background='rgba(232,184,75,.15)'"
            onmouseout="this.style.background='rgba(232,184,75,.08)'">
            🔄 Vendre
          </button>
          ${(STATE.characters||[]).filter(x=>x.id!==char.id).length ? `
          <button onclick="openSendInvModal('${char.id}','${indicesB64}','${item.nom||''}')"
            style="background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:#4f8cff;transition:all .15s"
            onmouseover="this.style.background='rgba(79,140,255,.15)'"
            onmouseout="this.style.background='rgba(79,140,255,.08)'"
            title="Envoyer">
            📤 Envoyer
          </button>` : ''}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div style="margin-bottom:1.5rem">
    <div style="font-size:.72rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;
      margin-bottom:.75rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)">
      🛒 Inventaire Boutique
      <span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:999px;padding:1px 7px;margin-left:.4rem;color:var(--text-dim)">${grouped.reduce((s,g)=>s+g.qte,0)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:.6rem">${cards}</div>
  </div>`;
}

// ══════════════════════════════════════════════
// INVENTAIRE PRINCIPAL
// ══════════════════════════════════════════════

// ── Catégorisation ────────────────────────────
function _invCategory(item) {
  const tpl = (item.template || '').toLowerCase();
  const hay = [item.type, item.categorie, item.nom, item.sousType, item.sousCategorie]
    .filter(Boolean).join(' ').toLowerCase();
  if (tpl === 'arme' || item.degats || item.toucherStat || item.toucher) return 'armes';
  if (tpl === 'armure' || item.slotArmure || item.typeArmure || (item.ca != null && item.ca !== '')) return 'armures';
  if (tpl === 'bijou' || item.slotBijou ||
    ['anneau','amulette','bijou','talisman','pendentif','bague'].some(k => hay.includes(k)))
    return 'bijoux';
  if (['potion','consommable','parchemin','scroll','nourriture','herbe','ingrédient','ressource']
    .some(k => hay.includes(k)))
    return 'consommables';
  return 'divers';
}

// ── Chips compactes pour une ligne (max 3) ────
function _invRowChips(item) {
  const chips = [];
  if (item.degats) {
    const shs = _itemDegatsStatsShorts(item);
    chips.push({ val: shs.length ? `${item.degats}+${shs.join('+')}` : item.degats, color: '#ff6b6b' });
  }
  if (item.toucherStat || (item.toucher && !item.degats))
    chips.push({ val: item.toucherStat ? statShort(item.toucherStat) : item.toucher, color: '#e8b84b' });
  if (item.ca != null && item.ca !== '')
    chips.push({ val: `CA+${parseInt(item.ca)||0}`, color: '#4f8cff' });
  if (item.slotArmure)       chips.push({ val: item.slotArmure, color: '#4f8cff' });
  else if (item.slotBijou)   chips.push({ val: item.slotBijou,  color: '#c084fc' });
  if (item.typeArmure)       chips.push({ val: item.typeArmure, color: '#22c38e' });
  const bonus = formatItemBonusText(item);
  if (bonus) chips.push({ val: bonus, color: '#4f8cff' });
  if (chips.length < 2 && item.sousType) chips.push({ val: item.sousType, color: '#a0aec0' });
  if (chips.length < 2 && item.format)   chips.push({ val: item.format,   color: '#a0aec0' });
  if (chips.length === 0 && item.effet)
    chips.push({ val: item.effet.length > 42 ? item.effet.slice(0,42)+'…' : item.effet, color: 'var(--text-muted)' });
  if (chips.length === 0 && item.type)
    chips.push({ val: item.type, color: 'var(--text-dim)' });
  return chips.slice(0, 3);
}

export function renderCharInventaire(c, canEdit) {
  const invRaw = c.inventaire || [];
  const q = (window._charInvSearch || '').toLowerCase().trim();

  // ── Regrouper par itemId + nom ──
  const grouped = [];
  invRaw.forEach((item, realIdx) => {
    const key = (item.itemId || '') + '||' + (item.nom || '');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte) || 1;
      existing.indices.push(realIdx);
    } else {
      grouped.push({ key, item: { ...item }, qte: parseInt(item.qte) || 1, indices: [realIdx] });
    }
  });

  const otherChars = STATE.characters?.filter(x => x.id !== c.id) || [];
  const equippedMap = getEquippedInventoryIndexMap(c);

  // ── 5 catégories ──
  const CATS = [
    { id: 'armes',        icon: '⚔️',  label: 'Armes',               items: [] },
    { id: 'armures',      icon: '🛡️',  label: 'Armures',             items: [] },
    { id: 'bijoux',       icon: '💍',  label: 'Bijoux & Accessoires', items: [] },
    { id: 'consommables', icon: '🧪',  label: 'Consommables',         items: [] },
    { id: 'divers',       icon: '📦',  label: 'Divers',               items: [] },
  ];
  grouped.forEach(g => {
    const catId = _invCategory(g.item);
    CATS.find(cat => cat.id === catId)?.items.push(g);
  });

  // ── Rendu d'une ligne compacte ──
  const _renderRow = (g) => {
    const item = g.item;
    const nomLower = (item.nom || '').toLowerCase();
    const hidden = q && !nomLower.includes(q);
    const rareteN = parseInt(item.rarete) || 0;
    const rareteL = RARETE_NAMES[rareteN] || '';
    const rareteC = _rareteColor(rareteL) || 'var(--border)';
    const pv = parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat)||0)*0.6);
    const indicesB64 = btoa(JSON.stringify(g.indices));
    const equippedSlots = [...new Set(g.indices.flatMap(idx => equippedMap.get(idx)||[]))];
    const isEquipped = equippedSlots.length > 0;
    const chips = _invRowChips(item);
    const nomEsc = _esc(item.nom || '?');
    const nomSafe = (item.nom || '').replace(/'/g, "\\'");

    return `<div class="inv-row${hidden ? ' inv-row--hidden' : ''}" data-nom="${_esc(nomLower)}" style="--rc:${rareteC}">
      <div class="inv-row-body">
        <span class="inv-row-nom">${nomEsc}</span>
        ${isEquipped ? `<span class="inv-row-eq" title="${equippedSlots.join(', ')}">✓ Équipé</span>` : ''}
        ${chips.length ? `<div class="inv-row-chips">${chips.map(ch => `<span class="inv-row-chip" style="color:${ch.color}">${_esc(ch.val)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="inv-row-aside">
        ${g.qte > 1 ? `<span class="inv-row-qte">×${g.qte}</span>` : ''}
        <div class="inv-row-btns">
          ${canEdit && item.source === 'boutique' ? `<button class="inv-rbtn inv-rbtn--sell" title="Vendre" onclick="openSellInvModal('${c.id}','${indicesB64}',${pv},'${nomSafe}')">🔄</button>` : ''}
          ${otherChars.length ? `<button class="inv-rbtn inv-rbtn--send" title="Envoyer" onclick="openSendInvModal('${c.id}','${indicesB64}','${nomSafe}')">↗</button>` : ''}
          ${canEdit ? `<button class="inv-rbtn inv-rbtn--del" title="Supprimer" onclick="openDeleteInvModal('${c.id}','${indicesB64}','${nomSafe}')">✕</button>` : ''}
        </div>
      </div>
    </div>`;
  };

  const totalItems = invRaw.length;

  let html = `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">🎒 Inventaire</span>
      <span class="cs-hint">${totalItems} objet${totalItems !== 1 ? 's' : ''}</span>
      ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="addInvItem()" style="margin-left:auto">🎁 Butin</button>` : ''}
    </div>`;

  if (grouped.length === 0) {
    html += `<div class="cs-empty-state">
      <div class="cs-empty-icon">🎒</div>
      <div class="cs-empty-msg">Inventaire vide.</div>
      <div class="cs-empty-sub">Achetez des objets depuis la Boutique.</div>
    </div>`;
  } else {
    // Barre de recherche
    html += `<div class="inv-search-wrap">
      <span class="inv-search-icon">🔍</span>
      <input class="inv-search-input" type="text" placeholder="Rechercher un objet…"
        value="${_esc(window._charInvSearch || '')}"
        oninput="window._charInvSearch=this.value;filterInvRows(this.value)">
      ${q ? `<button class="inv-search-clear" onclick="window._charInvSearch='';filterInvRows('');this.closest('.inv-search-wrap').querySelector('input').value=''">✕</button>` : ''}
    </div>`;

    // Groupes par catégorie
    for (const cat of CATS) {
      if (!cat.items.length) continue;
      const allHidden = q && cat.items.every(g => !((g.item.nom || '').toLowerCase().includes(q)));
      const openState = window[`_invCat_${cat.id}`] !== false;
      html += `<details class="inv-cat${allHidden ? ' inv-cat--hidden' : ''}" id="inv-cat-${cat.id}"
        ${openState ? 'open' : ''} ontoggle="window['_invCat_${cat.id}']=this.open">
        <summary class="inv-cat-head">
          <div class="inv-cat-title-row">
            <span class="inv-cat-icon">${cat.icon}</span>
            <span class="inv-cat-title">${cat.label}</span>
          </div>
          <div class="inv-cat-right">
            <span class="inv-cat-count">${cat.items.reduce((s, g) => s + (parseInt(g.qte) || 0), 0)}</span>
            <span class="inv-cat-chev">▶</span>
          </div>
        </summary>
        <div class="inv-cat-body">
          ${cat.items.map(_renderRow).join('')}
        </div>
      </details>`;
    }
  }

  html += `</div>`;
  return html;
}

// ── Filtrage live par recherche ───────────────
export function filterInvRows(val) {
  const q = (val || '').toLowerCase().trim();
  document.querySelectorAll('.inv-row').forEach(r => {
    r.classList.toggle('inv-row--hidden', !!(q && !(r.dataset.nom || '').includes(q)));
  });
  document.querySelectorAll('.inv-cat').forEach(cat => {
    const anyVisible = [...cat.querySelectorAll('.inv-row')].some(r => !r.classList.contains('inv-row--hidden'));
    cat.classList.toggle('inv-cat--hidden', !anyVisible);
  });
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function _decodeIndices(b64) {
  try { return JSON.parse(atob(b64)); } catch { return []; }
}

// ══════════════════════════════════════════════
// VENTE
// ══════════════════════════════════════════════
export function openSellInvModal(charId, indicesB64, prixVente, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  if (maxQte === 0) return;

  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  const equippedMap = c ? getEquippedInventoryIndexMap(c) : new Map();
  const equippedSlots = [...new Set(indices.flatMap(idx => equippedMap.get(idx) || []))];
  const hasEquipped = equippedSlots.length > 0;

  openModal(`🔄 Vendre — ${nom}`, `
    ${hasEquipped ? `
    <div style="background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.3);
      border-radius:10px;padding:.65rem .9rem;margin-bottom:.85rem;
      display:flex;align-items:flex-start;gap:.5rem;font-size:.82rem">
      <span style="font-size:1rem;flex-shrink:0">⚠️</span>
      <div>
        <strong style="color:#ff6b6b;display:block;margin-bottom:.2rem">Objet actuellement équipé !</strong>
        <span style="color:var(--text-muted)">Slot${equippedSlots.length>1?'s':''} : ${equippedSlots.join(', ')}.
        Il sera automatiquement déséquipé si tu le vends.</span>
      </div>
    </div>` : ''}
    <div style="margin-bottom:1rem;font-size:.85rem;color:var(--text-muted)">
      <strong style="color:var(--gold)">${prixVente} or</strong> par unité · ${maxQte} en stock
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown();this.nextElementSibling.dispatchEvent(new Event('input'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">−</button>
        <input type="number" id="sell-qty" min="1" max="${maxQte}" value="1"
          style="width:60px;text-align:center" class="input-field"
          oninput="document.getElementById('sell-total').textContent=(Math.min(Math.max(1,parseInt(this.value)||1),${maxQte})*${prixVente})+' or'">
        <button type="button" onclick="this.previousElementSibling.stepUp();this.previousElementSibling.dispatchEvent(new Event('input'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">+</button>
      </div>
      <span style="font-size:.8rem;color:var(--text-dim)">→ <strong id="sell-total" style="color:var(--gold)">${prixVente} or</strong></span>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="sellInvItemBulk('${charId}','${indicesB64}',${prixVente})">
        🔄 Vendre${hasEquipped?' (déséquiper et vendre)':''}
      </button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

export async function sellInvItemBulk(charId, indicesB64, prixVente) {
  try {
    const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
    if (!c) return;

    const allIndices = _decodeIndices(indicesB64);
    const qty = Math.min(Math.max(1, parseInt(document.getElementById('sell-qty')?.value)||1), allIndices.length);
    const equippedMap = getEquippedInventoryIndexMap(c);
    const unequippedIndices = allIndices.filter(idx => !(equippedMap.get(idx) || []).length);
    const equippedIndices = allIndices.filter(idx => (equippedMap.get(idx) || []).length);
    const indicesToSell = [...unequippedIndices, ...equippedIndices].slice(0, qty);

    const inv      = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const item     = inv[indicesToSell[0]];
    if (!item) return;
    const itemNom  = item.nom || 'objet';
    const totalPrix = prixVente * qty;

    const sorted = [...indicesToSell].sort((a,b)=>b-a);
    sorted.forEach(idx => inv.splice(idx, 1));

    const compte   = c.compte || { recettes:[], depenses:[] };
    const recettes = [...(compte.recettes||[])];
    recettes.push({
      date:    new Date().toLocaleDateString('fr-FR'),
      libelle: qty > 1 ? `Vente ×${qty} : ${itemNom}` : `Vente : ${itemNom}`,
      montant: totalPrix,
    });

    if (item.itemId && window.sellInvItemFromShop) {
      for (let i = 0; i < qty; i++) {
        await window._restockShopItem?.(item.itemId);
      }
    }

    const equipSync = syncEquipmentAfterInventoryMutation(c, indicesToSell);
    const payload = {
      inventaire: inv,
      compte: { ...compte, recettes },
    };
    if (equipSync.changed) {
      payload.equipement = equipSync.equipement;
      payload.statsBonus = equipSync.statsBonus;
    }

    await updateInCol('characters', charId, payload);
    c.inventaire = inv;
    c.compte     = { ...compte, recettes };
    if (equipSync.changed) {
      c.equipement = equipSync.equipement;
      c.statsBonus = equipSync.statsBonus;
    }

    closeModal();
    const unequipMsg = equipSync.removedSlots.length
      ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
      : '';
    showNotif(`💰 ×${qty} "${itemNom}" vendu${qty>1?'s':''} pour ${totalPrix} or !${unequipMsg}`, 'success');
    window.refreshOrDisplay?.(c);
    window.renderCharSheet(c, window._currentCharTab || 'inventaire');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export async function sellInvItem(charId, invIndex) {
  const b64 = btoa(JSON.stringify([invIndex]));
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  const item = (c?.inventaire||[])[invIndex];
  const pv = parseFloat(item?.prixVente) || Math.round((parseFloat(item?.prixAchat)||0)*0.6);
  openSellInvModal(charId, b64, pv, item?.nom||'objet');
}

// ══════════════════════════════════════════════
// SUPPRESSION
// ══════════════════════════════════════════════
export function openDeleteInvModal(charId, indicesB64, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  openModal(`🗑️ Supprimer — ${nom}`, `
    <div style="margin-bottom:1rem;font-size:.85rem;color:var(--text-muted)">
      ${maxQte} exemplaire${maxQte>1?'s':''} dans l'inventaire
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">−</button>
        <input type="number" id="del-qty" min="1" max="${maxQte}" value="1" style="width:60px;text-align:center" class="input-field">
        <button type="button" onclick="this.previousElementSibling.stepUp()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">+</button>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-outline btn-sm" style="flex:1;color:#ff6b6b;border-color:rgba(255,107,107,.35)"
        onclick="deleteInvItemBulk('${charId}','${indicesB64}')">🗑️ Supprimer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

export async function deleteInvItemBulk(charId, indicesB64) {
  try {
    const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
    if (!c) return;
    const allIndices = _decodeIndices(indicesB64);
    const qty = Math.min(Math.max(1, parseInt(document.getElementById('del-qty')?.value)||1), allIndices.length);
    const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const removedIndices = allIndices.slice(0, qty);
    const sorted = [...removedIndices].sort((a,b)=>b-a);
    sorted.forEach(idx => inv.splice(idx, 1));
    const equipSync = syncEquipmentAfterInventoryMutation(c, removedIndices);
    const payload = { inventaire: inv };
    if (equipSync.changed) {
      payload.equipement = equipSync.equipement;
      payload.statsBonus = equipSync.statsBonus;
    }
    await updateInCol('characters', charId, payload);
    c.inventaire = inv;
    if (equipSync.changed) {
      c.equipement = equipSync.equipement;
      c.statsBonus = equipSync.statsBonus;
    }
    closeModal();
    const deleteMsg = equipSync.removedSlots.length
      ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
      : '';
    showNotif(`Objet(s) supprimé(s).${deleteMsg}`, 'success');
    window.renderCharSheet(c, window._currentCharTab || 'inventaire');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// ENVOI
// ══════════════════════════════════════════════
export function openSendInvModal(charId, indicesB64OrIndex, nomOrUnused) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;

  let indices;
  if (typeof indicesB64OrIndex === 'number') {
    indices = [indicesB64OrIndex];
  } else {
    indices = _decodeIndices(indicesB64OrIndex);
  }
  if (!indices.length) return;

  const item    = (c.inventaire||[])[indices[0]];
  if (!item) return;
  const nom     = nomOrUnused || item.nom || 'Objet';
  const maxQte  = indices.length;
  const b64     = btoa(JSON.stringify(indices));

  const otherChars = STATE.characters?.filter(x => x.id !== charId) || [];
  if (!otherChars.length) { showNotif('Aucun autre personnage disponible.','error'); return; }

  const rareteN   = parseInt(item.rarete) || 0;
  const itemColor = _rareteColor(RARETE_NAMES[rareteN]) || 'var(--border)';

  const itemPreview = `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;
      background:var(--bg-elevated);border-radius:10px;border-left:3px solid ${itemColor};
      border:1px solid var(--border);margin-bottom:.85rem">
      <div style="flex:1;min-width:0">
        <div style="font-family:'Cinzel',serif;font-size:.88rem;font-weight:700;color:var(--text)">${nom}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">
          ${item.format||item.slotArmure||item.type||''}${maxQte>1?` · ${maxQte} disponible${maxQte>1?'s':''}`:' · 1 exemplaire'}
        </div>
      </div>
      ${maxQte > 1 ? `
      <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">
        <button type="button" id="send-dec"
          style="width:26px;height:26px;border-radius:6px;border:1px solid var(--border);
          background:var(--bg-card);cursor:pointer;font-size:1rem;color:var(--text);
          display:flex;align-items:center;justify-content:center;line-height:1"
          onclick="const i=document.getElementById('send-qty');i.value=Math.max(1,parseInt(i.value||1)-1)">−</button>
        <input type="number" id="send-qty" min="1" max="${maxQte}" value="1"
          style="width:44px;text-align:center;font-size:.85rem;font-weight:700;
          background:var(--bg-card);border:1px solid var(--border);border-radius:6px;
          color:var(--text);padding:3px 0">
        <button type="button" id="send-inc"
          style="width:26px;height:26px;border-radius:6px;border:1px solid var(--border);
          background:var(--bg-card);cursor:pointer;font-size:1rem;color:var(--text);
          display:flex;align-items:center;justify-content:center;line-height:1"
          onclick="const i=document.getElementById('send-qty');i.value=Math.min(${maxQte},parseInt(i.value||1)+1)">+</button>
      </div>` : ''}
    </div>`;

  const targetCards = otherChars.map(target => {
    const initiale  = (target.nom||'?')[0].toUpperCase();
    const colors    = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
    const couleur   = colors[(target.nom||'').charCodeAt(0) % colors.length];
    const photoPos  = `${50+(target.photoX||0)*50}% ${50+(target.photoY||0)*50}%`;
    return `<label style="display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;
      border-radius:10px;border:2px solid var(--border);background:var(--bg-elevated);
      cursor:pointer;transition:all .12s"
      onmouseover="this.style.borderColor='${couleur}';this.style.background='${couleur}0f'"
      onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg-elevated)'">
      <input type="radio" name="send-target" value="${target.id}"
        style="accent-color:${couleur};flex-shrink:0;width:14px;height:14px">
      <div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;overflow:hidden;
        border:2px solid ${couleur};background:${couleur}18;
        display:flex;align-items:center;justify-content:center">
        ${target.photo
          ? `<img src="${target.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
          : `<span style="font-family:'Cinzel',serif;font-size:.95rem;font-weight:700;color:${couleur}">${initiale}</span>`}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:var(--text);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${target.nom||'?'}</div>
        ${target.ownerPseudo ? `<div style="font-size:.68rem;color:var(--text-dim)">${target.ownerPseudo}</div>` : ''}
      </div>
    </label>`;
  }).join('');

  openModal(`📤 Envoyer`, `
    ${itemPreview}
    <div style="font-size:.72rem;color:var(--text-dim);font-weight:600;
      text-transform:uppercase;letter-spacing:.8px;margin-bottom:.4rem">Destinataire</div>
    <div style="display:flex;flex-direction:column;gap:.35rem;
      max-height:260px;overflow-y:auto">${targetCards}</div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" onclick="sendInvItem('${charId}','${b64}')">📤 Envoyer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

export async function sendInvItem(fromCharId, indicesB64) {
  const fromChar = STATE.characters?.find(x => x.id === fromCharId) || STATE.activeChar;
  if (!fromChar) return;

  const targetId = document.querySelector('input[name="send-target"]:checked')?.value;
  if (!targetId) { showNotif('Sélectionne un personnage cible.','error'); return; }

  const toChar = STATE.characters?.find(x => x.id === targetId);
  if (!toChar) { showNotif('Personnage introuvable.','error'); return; }

  const allIndices = _decodeIndices(indicesB64);
  const maxQte  = allIndices.length;
  const qtyEl   = document.getElementById('send-qty');
  const qty     = qtyEl ? Math.min(Math.max(1, parseInt(qtyEl.value)||1), maxQte) : 1;
  const equippedMap = getEquippedInventoryIndexMap(fromChar);
  const unequippedIndices = allIndices.filter(idx => !(equippedMap.get(idx) || []).length);
  const equippedIndices = allIndices.filter(idx => (equippedMap.get(idx) || []).length);
  const toSend  = [...unequippedIndices, ...equippedIndices].slice(0, qty);

  const fromInv = Array.isArray(fromChar.inventaire) ? [...fromChar.inventaire] : [];
  const firstItem = fromInv[toSend[0]];
  if (!firstItem) return;

  const itemsToTransfer = toSend.map(idx => ({...fromInv[idx]}));
  [...toSend].sort((a,b)=>b-a).forEach(idx => fromInv.splice(idx, 1));

  const toInv = Array.isArray(toChar.inventaire) ? [...toChar.inventaire] : [];
  itemsToTransfer.forEach(it => toInv.push(it));

  const equipSync = syncEquipmentAfterInventoryMutation(fromChar, toSend);
  const fromPayload = { inventaire: fromInv };
  if (equipSync.changed) {
    fromPayload.equipement = equipSync.equipement;
    fromPayload.statsBonus = equipSync.statsBonus;
  }

  await Promise.all([
    updateInCol('characters', fromCharId, fromPayload),
    updateInCol('characters', targetId,   { inventaire: toInv }),
  ]);
  fromChar.inventaire = fromInv;
  if (equipSync.changed) {
    fromChar.equipement = equipSync.equipement;
    fromChar.statsBonus = equipSync.statsBonus;
  }
  toChar.inventaire   = toInv;

  closeModal();
  const sendMsg = equipSync.removedSlots.length
    ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
    : '';
  showNotif(`📤 ×${qty} "${firstItem.nom||'objet'}" envoyé${qty>1?'s':''} à ${toChar.nom||'?'} !${sendMsg}`, 'success');
  window.renderCharSheet(fromChar, window._currentCharTab || 'inventaire');
}

// ══════════════════════════════════════════════
// BUTIN — Picker
// ══════════════════════════════════════════════
export async function addInvItem() {
  const c = STATE.activeChar; if (!c) return;

  const { loadCollection: _lc } = await import('../../data/firestore.js');
  let shopItems = window._shopItemsCache;
  let shopCats  = window._shopCatsCache;
  try {
    const toLoad = [];
    if (!shopItems) toLoad.push(_lc('shop').then(r => { shopItems = r; window._shopItemsCache = r; }));
    if (!shopCats)  toLoad.push(_lc('shopCategories').then(r => { shopCats = r; window._shopCatsCache = r; }));
    if (toLoad.length) await Promise.all(toLoad);
  } catch(e) { /* silent */ }
  shopItems = (shopItems || []).filter(i => i.nom);
  shopCats  = [...(shopCats || [])].sort((a,b) => (a.ordre||0)-(b.ordre||0));

  window._lootItems  = shopItems;
  window._lootSelId  = null;
  window._lootCurCat = null;

  const RC = ['','#9ca3af','#4f8cff','#b47fff','#e8b84b'];

  const getRecents = () => { try { return JSON.parse(localStorage.getItem('jdr_loot_recent')||'[]'); } catch { return []; } };
  window._lootSaveRecent = (id) => {
    const r = getRecents().filter(x => x !== id);
    r.unshift(id);
    localStorage.setItem('jdr_loot_recent', JSON.stringify(r.slice(0, 8)));
  };

  const renderItems = (catId, search) => {
    const q = (search || '').toLowerCase().trim();
    let items;
    if (q) {
      items = shopItems.filter(i =>
        i.nom.toLowerCase().includes(q) ||
        (i.description || i.effet || '').toLowerCase().includes(q)
      );
    } else if (catId === '__recent__') {
      items = getRecents().map(id => shopItems.find(i => i.id === id)).filter(Boolean);
    } else if (catId) {
      items = shopItems.filter(i => i.categorieId === catId);
    } else {
      const recentItems = getRecents().map(id => shopItems.find(i => i.id === id)).filter(Boolean);
      if (recentItems.length) return _lootRenderSection('⏱️ Récents', recentItems, RC);
      return `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic;font-size:.82rem">
        Sélectionne une catégorie ou tape un nom pour rechercher
      </div>`;
    }
    if (!items.length) return `<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun résultat.</div>`;
    return items.map(item => _lootItemCard(item, RC, q ? shopCats.find(cat => cat.id === item.categorieId)?.nom : null)).join('');
  };

  const _lootItemCard = (item, rc_arr, catLabel) => {
    const r  = parseInt(item.rarete) || 0;
    const rc = rc_arr[r] || 'var(--border)';
    const sel = window._lootSelId === item.id;
    const desc = item.description || item.effet || '';
    return `<button onclick="window._lootSelect('${item.id}')" id="loot-card-${item.id}"
      style="display:flex;flex-direction:column;gap:2px;text-align:left;padding:.5rem .65rem;
        border-radius:8px;border:1px solid ${sel ? rc : 'var(--border)'};
        background:${sel ? `${rc}20` : 'var(--bg-elevated)'};cursor:pointer;transition:all .12s;width:100%">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem">
        <span style="font-size:.82rem;font-weight:600;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.nom)}</span>
        <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">
          ${catLabel ? `<span style="font-size:.62rem;color:var(--text-dim);background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:1px 5px;white-space:nowrap">${_esc(catLabel)}</span>` : ''}
          ${r ? `<span style="color:${rc};font-size:.7rem">${'★'.repeat(r)}</span>` : ''}
        </div>
      </div>
      ${desc ? `<span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${desc.slice(0,70)}${desc.length>70?'…':''}</span>` : ''}
    </button>`;
  };

  const _lootRenderSection = (title, items, rc_arr) =>
    `<div style="font-size:.68rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.6px;padding:.2rem .1rem .35rem">${title}</div>` +
    items.map(item => _lootItemCard(item, rc_arr, null)).join('');

  window._lootRenderGrid = (catId, search) => {
    const grid = document.getElementById('loot-grid');
    if (grid) grid.innerHTML = renderItems(catId, search || '');
  };

  const hasRecents = getRecents().some(id => shopItems.find(i => i.id === id));
  const pillStyle = (active) =>
    `font-size:.72rem;padding:3px 11px;border-radius:999px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .12s;
     border:1px solid ${active ? 'var(--gold)' : 'var(--border)'};
     background:${active ? 'rgba(232,184,75,.14)' : 'var(--bg-elevated)'};
     color:${active ? 'var(--gold)' : 'var(--text-muted)'}`;

  const recentPill = hasRecents
    ? `<button id="loot-pill-__recent__" onclick="window._lootSetCat('__recent__')" style="${pillStyle(false)}">⏱️ Récents</button>`
    : '';
  const catPills = shopCats
    .filter(cat => shopItems.some(i => i.categorieId === cat.id))
    .map(cat => `<button id="loot-pill-${cat.id}" onclick="window._lootSetCat('${cat.id}')" style="${pillStyle(false)}">${_esc(cat.nom)}</button>`)
    .join('');

  openModal('🎁 Butin — Ajouter un objet', `
    <input class="input-field" id="loot-search" placeholder="🔍 Rechercher dans tous les objets…"
      oninput="window._lootFilter()" style="margin-bottom:.45rem">
    <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.45rem">
      ${recentPill}${catPills}
    </div>
    <div id="loot-grid" style="display:flex;flex-direction:column;gap:.28rem;
      max-height:38vh;overflow-y:auto;padding-right:2px;margin-bottom:.5rem">
      ${renderItems(null, '')}
    </div>
    <div id="loot-qty-panel" style="display:none;background:var(--bg-elevated);
      border:1px solid var(--gold);border-radius:10px;padding:.55rem .85rem;margin-bottom:.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem">
        <div id="loot-sel-nom" style="font-weight:700;font-size:.86rem;color:var(--text);
          min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">
          <button onclick="const i=document.getElementById('loot-qte');i.value=Math.max(1,parseInt(i.value||1)-1)"
            style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);cursor:pointer;font-size:1.1rem;color:var(--text);line-height:1">−</button>
          <input type="number" id="loot-qte" value="1" min="1"
            style="width:48px;text-align:center;font-size:.9rem;font-weight:700;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 0">
          <button onclick="const i=document.getElementById('loot-qte');i.value=parseInt(i.value||1)+1"
            style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);cursor:pointer;font-size:1.1rem;color:var(--text);line-height:1">+</button>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:.4rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveInvItemFromShop()">✓ Ajouter</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Fermer</button>
    </div>
  `);
  setTimeout(() => document.getElementById('loot-search')?.focus(), 60);

  window._lootSetCat = (catId) => {
    const next = window._lootCurCat === catId ? null : catId;
    window._lootCurCat = next;
    window._lootSelId  = null;
    if (hasRecents) _lootPillStyle('__recent__', next === '__recent__');
    shopCats.forEach(cat => _lootPillStyle(cat.id, next === cat.id));
    const searchEl = document.getElementById('loot-search');
    if (searchEl) searchEl.value = '';
    const panel = document.getElementById('loot-qty-panel');
    if (panel) panel.style.display = 'none';
    window._lootRenderGrid(next, '');
  };

  window._lootFilter = () => {
    const q = document.getElementById('loot-search')?.value || '';
    if (q) {
      if (hasRecents) _lootPillStyle('__recent__', false);
      shopCats.forEach(cat => _lootPillStyle(cat.id, false));
    } else {
      if (hasRecents) _lootPillStyle('__recent__', window._lootCurCat === '__recent__');
      shopCats.forEach(cat => _lootPillStyle(cat.id, window._lootCurCat === cat.id));
    }
    window._lootRenderGrid(q ? null : window._lootCurCat, q);
  };

  window._lootSelect = (id) => {
    if (window._lootSelId && window._lootSelId !== id) {
      const old = document.getElementById(`loot-card-${window._lootSelId}`);
      if (old) { old.style.background = 'var(--bg-elevated)'; old.style.borderColor = 'var(--border)'; }
    }
    window._lootSelId = id;
    const item = shopItems.find(i => i.id === id);
    if (!item) return;
    const r  = parseInt(item.rarete) || 0;
    const rc = RC[r] || 'var(--gold)';
    const card = document.getElementById(`loot-card-${id}`);
    if (card) { card.style.background = `${rc}20`; card.style.borderColor = rc; }
    const panel = document.getElementById('loot-qty-panel');
    if (panel) panel.style.display = 'block';
    const nomEl = document.getElementById('loot-sel-nom');
    if (nomEl) nomEl.textContent = item.nom;
    const qteEl = document.getElementById('loot-qte');
    if (qteEl) { qteEl.value = '1'; qteEl.focus(); }
  };
}

export function _lootPillStyle(id, active) {
  const el = document.getElementById(`loot-pill-${id}`);
  if (!el) return;
  el.style.borderColor = active ? 'var(--gold)' : 'var(--border)';
  el.style.background  = active ? 'rgba(232,184,75,.14)' : 'var(--bg-elevated)';
  el.style.color       = active ? 'var(--gold)' : 'var(--text-muted)';
}

export async function saveInvItemFromShop() {
  try {
    const c = STATE.activeChar; if (!c) return;
    const selId = window._lootSelId;
    if (!selId) { showNotif('Sélectionne un objet.', 'error'); return; }
    const item = (window._lootItems || []).find(i => i.id === selId);
    if (!item) { showNotif('Objet introuvable.', 'error'); return; }
    const qte = Math.max(1, parseInt(document.getElementById('loot-qte')?.value) || 1);
    const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    for (let i = 0; i < qte; i++) {
      inv.push({ ...item, qte: '1', quantite: 1, source: 'boutique', itemId: item.id });
    }
    c.inventaire = inv;
    if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
    const stChar = (STATE.characters || []).find(x => x.id === c.id);
    if (stChar) stChar.inventaire = inv;
    await updateInCol('characters', c.id, { inventaire: inv });
    if (window._lootSaveRecent) window._lootSaveRecent(item.id);
    window._lootSelId = null;
    showNotif(`${item.nom} ×${qte} ajouté !`, 'success');
    window.renderCharSheet(c, 'inventaire');
    const panel = document.getElementById('loot-qty-panel');
    if (panel) panel.style.display = 'none';
    window._lootRenderGrid?.(window._lootCurCat, document.getElementById('loot-search')?.value || '');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export function editInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.inventaire||[])[idx];
  openModal('✏️ Modifier', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" value="${item.nom||''}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" value="${item.type||''}"></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="${item.qte||1}"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="inv-desc" rows="3">${item.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInvItem(${idx})">Enregistrer</button>
  `);
}

export async function saveInvItem(idx) {
  try {
    const c = STATE.activeChar; if(!c) return;
    const inv = c.inventaire||[];
    const newItem = {
      nom: document.getElementById('inv-nom')?.value||'?',
      type: document.getElementById('inv-type')?.value||'',
      qte: document.getElementById('inv-qte')?.value||'1',
      description: document.getElementById('inv-desc')?.value||'',
    };
    if (idx>=0) inv[idx]=newItem; else inv.push(newItem);
    c.inventaire=inv;
    await updateInCol('characters',c.id,{inventaire:inv});
    closeModal();
    showNotif('Inventaire mis à jour !','success');
    window.renderCharSheet(c,'inventaire');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}
