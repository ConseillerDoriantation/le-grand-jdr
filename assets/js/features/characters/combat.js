import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { updateInCol } from '../../data/firestore.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { formatItemBonusText, getItemStatBonus } from '../../shared/char-stats.js';
import { loadDamageTypes, getMagicTypes } from '../../shared/damage-types.js';
import { criticalEffectFormulaLabel } from '../../shared/character-rules.js';
import {
  loadCombatStyles, detectCombatStyle,
  openCombatStylesAdmin, openWeaponFormatsAdmin,
  _getTraits, getArmorTypeMeta, getArmorSetChipText, getArmorSetData,
  getWeaponToucherParts, getWeaponDegatsParts, getMainWeapon,
} from './data.js';
import { getEquipmentSlots, getPrimaryWeaponSlotId, getSecondaryWeaponSlotId } from '../../shared/equipment-slots.js';

// ── renderCharEquip ───────────────────────────────────────────────────────────

function _renderElementAccessHtml(c, magicTypes, canManageElements) {
  const charElems = c.elements || [];
  const chips = magicTypes.map(t => {
    const active = charElems.includes(t.id);
    const cls = `cs-elem-chip ${active ? 'cs-elem-chip--on' : ''} ${canManageElements ? '' : 'cs-elem-chip--readonly'}`;
    const attrs = canManageElements
      ? `data-action="toggleCharElement" data-id="${c.id}" data-elem="${t.id}" title="${active ? 'Retirer' : 'Ajouter'} ${t.label}"`
      : `title="${active ? 'Accessible' : 'Non accessible'}"`;
    return '<span class="' + cls + '" style="--elem-col:' + (t.color || '#9ca3af') + '" ' + attrs + '>' + (t.icon || '') + ' ' + t.label + '</span>';
  }).join('');

  const empty = charElems.length === 0
    ? `<span class="cs-elem-empty">${canManageElements ? 'Aucun élément accordé.' : 'Aucun élément débloqué par le MJ.'}</span>`
    : '';
  const hint = canManageElements
    ? 'Clique pour accorder ou retirer un noyau magique à ce personnage.'
    : 'Noyaux magiques débloqués par le MJ pour la forge de sorts.';

  return `<div class="cs-elem-access">
    <div class="cs-elem-access-head">
      <span>🌀 Runes noyaux accessibles</span>
      <small>${hint}</small>
    </div>
    <div class="cs-elem-grid">${chips}${empty}</div>
  </div>`;
}
export function renderCharEquip(c, canEdit) {
  const equip      = c.equipement||{};
  const slotDefs = getEquipmentSlots();
  const weaponSlots = slotDefs.filter(slot => slot.kind === 'weapon');
  const armorSlots = slotDefs.filter(slot => slot.kind !== 'weapon');
  const primaryWeaponSlot = getPrimaryWeaponSlotId();
  const armorSet    = getArmorSetData(c);
  const armorSetChipText = getArmorSetChipText(armorSet);

  let html = '';

  // ── 1. Armes + Style de combat ───────────────────────────────────────────
  const styleId = `cs-combat-style-${c.id||'x'}`;

  html += `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">⚔️ Armes</span>
      ${canEdit ? '<span class="cs-hint">✏️ pour modifier</span>' : ''}
    </div>
    <div class="cs-weap-grid">`;

  weaponSlots.forEach(slotDef => {
    const slot = slotDef.id;
    // Main principale vide → poings par défaut. Main secondaire vide reste vide.
    const rawItem = equip[slot] || {};
    const item    = (slot === primaryWeaponSlot && !rawItem.nom) ? getMainWeapon(c) : rawItem;
    const statKey = item.statAttaque==='dexterite' ? 'dexterite'
                  : item.statAttaque==='intelligence' ? 'intelligence' : 'force';
    const traits       = item.nom ? _getTraits(item) : [];
    const bonusDisplay = item.nom ? formatItemBonusText(item) : null;

    html += `<div class="cs-weap-card${item.isDefault ? ' cs-weap-card--default' : ''}">
      <div class="cs-weap-card-hdr">
        <span class="cs-weap-slot-lbl">${slotDef.icon} ${slotDef.label}</span>
        ${canEdit ? `<button class="cs-weap-edit" data-action="editEquipSlot" data-slot="${slot}">✏️</button>` : ''}
      </div>`;

    if (item.nom) {
      const tp = getWeaponToucherParts(c, item, statKey);
      const dp = getWeaponDegatsParts(c, item, statKey);

      // Sous-label toucher : stat + éventuel bonus de set
      const toucherSub = [
        tp.statLabel,
        tp.setBonus ? `Set ${tp.setBonus > 0 ? '+' : ''}${tp.setBonus}` : null,
      ].filter(Boolean).join(' · ');

      // Sous-label dégâts : stat + éventuel bonus de maîtrise
      const degatsSub = dp ? [
        dp.statLabel,
        dp.maitriseBonus > 0 ? `Maîtrise +${dp.maitriseBonus}` : null,
      ].filter(Boolean).join(' · ') : null;

      html += `
      <div class="cs-weap-card-nom">
        <span class="cs-weap-nom">${item.isDefault ? `${item.icon} ` : ''}${item.nom}</span>
        ${item.isDefault ? '<span class="cs-cbadge cs-cbadge--dim">Par défaut</span>' : (item.format ? `<span class="cs-cbadge cs-cbadge--dim">${item.format}</span>` : '')}
      </div>
      <div class="cs-weap-rolls">
        <div class="cs-weap-roll-block">
          <span class="cs-weap-roll-lbl">Toucher</span>
          <button class="cs-weap-roll-val cs-weap-toucher cs-calc-link" data-action="openCharCalculation"
            data-calc="weapon-touch" data-slot="${slot}" data-id="${c.id}" title="Voir le calcul du toucher">${tp.roll}</button>
          ${toucherSub ? `<span class="cs-weap-roll-sub">${toucherSub}</span>` : ''}
        </div>
        <div class="cs-weap-roll-sep"></div>
        <div class="cs-weap-roll-block">
          <span class="cs-weap-roll-lbl">Dégâts</span>
          <button class="cs-weap-roll-val cs-weap-dmg cs-calc-link" data-action="openCharCalculation"
            data-calc="weapon-damage" data-slot="${slot}" data-id="${c.id}" title="Voir le calcul des dégâts">${dp ? dp.roll : '—'}</button>
          ${degatsSub ? `<span class="cs-weap-roll-sub">${degatsSub}</span>` : ''}
        </div>
      </div>
      ${item.portee || bonusDisplay ? `<div class="cs-weap-meta">
        ${item.portee ? `<button class="cs-weap-portee cs-calc-link" data-action="openCharCalculation"
          data-calc="weapon-range" data-slot="${slot}" data-id="${c.id}" title="Voir l’origine de la portée">↗ ${item.portee}</button>` : ''}
        ${bonusDisplay ? `<span class="cs-cbadge cs-cbadge--blue">${bonusDisplay}</span>` : ''}
      </div>` : ''}
      ${traits.length ? `<div class="cs-weap-traits">${traits.map(t=>`<span class="cs-trait">${t}</span>`).join('')}</div>` : ''}`;
    } else {
      html += `<div class="cs-weap-vide">— Vide —</div>`;
    }

    html += `</div>`;
  });

  // ── Placeholder éléments magiques (juste sous les armes) ────────────────
  const elemPlaceholderId = `cs-elements-${c.id||'x'}`;
  html += `</div>
    <p class="cs-rule-note">🎲 Critique = ${_esc(criticalEffectFormulaLabel())}.</p>
    <div id="${elemPlaceholderId}"></div>
    <div id="${styleId}"></div>
  </div>`;

  // Éléments magiques — rendu async dans le placeholder
  setTimeout(async () => {
    const el = document.getElementById(elemPlaceholderId);
    if (!el) return;
    const allTypes   = await loadDamageTypes();
    const magicTypes = getMagicTypes(allTypes);
    el.innerHTML = _renderElementAccessHtml(c, magicTypes, STATE.isAdmin);
  }, 0);

  // Style de combat — rendu async dans le placeholder
  setTimeout(async () => {
    const el = document.getElementById(styleId);
    if (!el) return;
    const styles = await loadCombatStyles();
    const style  = detectCombatStyle(c, styles);
    if (!style) {
      el.innerHTML = STATE.isAdmin ? `<div class="cs-admin-row" style="margin:.3rem 0 0">
        <button data-action="openCombatStylesAdmin" class="btn btn-outline btn-sm">⚙️ Styles</button>
        <button data-action="openWeaponFormatsAdmin" class="btn btn-outline btn-sm">⚙️ Formats</button>
      </div>` : '';
      return;
    }
    el.innerHTML = `
      <div class="cs-style-block" style="--style-col:${style.couleur};margin-top:.5rem">
        <div class="cs-style-block-hdr">
          <div class="cs-style-block-labels">
            <span class="cs-style-tag">Style de combat</span>
            <span class="cs-style-label">${style.label}</span>
          </div>
          ${STATE.isAdmin ? `<div class="cs-admin-row">
            <button data-action="openCombatStylesAdmin" class="btn btn-outline btn-sm">⚙️ Styles</button>
            <button data-action="openWeaponFormatsAdmin" class="btn btn-outline btn-sm">⚙️ Formats</button>
          </div>` : ''}
        </div>
        <p class="cs-style-desc">${style.description}</p>
      </div>`;
  }, 0);

  // ── 2. Armures & Accessoires + Set d'armure ──────────────────────────────
  const totals = {fo:0,dex:0,in:0,sa:0,co:0,ch:0,ca:0};
  const statByStore = { fo:'force', dex:'dexterite', in:'intelligence', sa:'sagesse', co:'constitution', ch:'charisme' };
  const statDisplay = { fo:'FOR', dex:'DEX', in:'IN', sa:'SA', co:'CO', ch:'CH', ca:'CA' };
  Object.values(equip).forEach(it => {
    Object.entries(statByStore).forEach(([store, full]) => { totals[store] += getItemStatBonus(it, full); });
    totals.ca += (parseInt(it?.ca) || 0) + (parseInt(it?.caBonus) || 0);
  });
  const totalStr = Object.entries(totals).filter(([,v])=>v!==0).map(([k,v])=>`${statDisplay[k] || k.toUpperCase()} ${v>0?'+'+v:v}`).join(' · ');

  const _armorCard = (slotDef) => {
    const slot = slotDef.id;
    const item          = equip[slot]||{};
    const statBonuses   = Object.entries(statByStore)
      .map(([store, full]) => [store, getItemStatBonus(item, full)])
      .filter(([, val]) => val);
    const caBonus       = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
    const armorTypeMeta = getArmorTypeMeta(item.typeArmure || '');
    const traits        = _getTraits(item);
    return `<div class="cs-armor-card${item.nom?' cs-armor-card--on':''}">
      <div class="cs-armor-card-hdr">
        <span class="cs-armor-card-slot">${slotDef.icon} ${slotDef.label}</span>
        ${canEdit?`<button class="cs-weap-edit" data-action="editEquipSlot" data-slot="${slot}">✏️</button>`:''}
      </div>
      <span class="cs-armor-card-nom">${item.nom||'—'}</span>
      ${armorTypeMeta.label||statBonuses.length||caBonus?`<div class="cs-armor-card-badges">
        ${armorTypeMeta.label?`<span class="cs-cbadge cs-cbadge--${armorTypeMeta.tone||'dim'}">${armorTypeMeta.label}</span>`:''}
        ${statBonuses.map(([k, v])=>`<span class="cs-cbadge cs-cbadge--gold">${statDisplay[k] || k.toUpperCase()} ${v>0?'+'+v:v}</span>`).join('')}
        ${caBonus ? `<span class="cs-cbadge cs-cbadge--gold">CA ${caBonus>0?'+'+caBonus:caBonus}</span>` : ''}
      </div>`:''}
      ${traits.length?`<div class="cs-armor-card-traits">${traits.map(t=>`<span class="cs-trait">${t}</span>`).join('')}</div>`:''}
    </div>`;
  };

  // Effet de set — calculé avant de l'afficher sous les armures
  const mainS  = equip[getSecondaryWeaponSlotId()];
  const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();
  const hasShield = stypeS.includes('bouclier') || stypeS.includes('shield');

  let setHtml = '';
  if (armorSet.isActive) {
    const mod     = armorSet.modifiers;
    const tone    = armorSet.activeEffect?.tone || 'neutral';
    const TONE    = { light:'#22c38e', medium:'#4f8cff', heavy:'#e8b84b', neutral:'var(--text-dim)' };
    const col     = TONE[tone] || 'var(--text-dim)';
    const effects = [];
    if (mod.spellPmDelta)        effects.push({ icon:'🧙', txt:`Sorts ${mod.spellPmDelta > 0 ? '+' : '−'}${Math.abs(mod.spellPmDelta)} PM` });
    if (mod.toucherBonus)        effects.push({ icon:'🎯', txt:`Toucher ${mod.toucherBonus > 0 ? '+' : ''}${mod.toucherBonus}` });
    if (mod.damageReduction > 0) effects.push({ icon:'🛡️', txt:`Réduction ${mod.damageReduction}` });
    if (hasShield)               effects.push({ icon:'🛡️', txt:'CA +2' });
    setHtml = `<div class="cs-set-row" style="--set-col:${col}">
      <span class="cs-set-row-label">✨ Set</span>
      <span class="cs-set-row-name">${armorSetChipText}</span>
      <span class="cs-set-row-sep">·</span>
      ${effects.map(e=>`<span class="cs-set-row-fx">${e.icon} ${e.txt}</span>`).join('')}
    </div>`;
  } else if (hasShield) {
    setHtml = `<div class="cs-set-row" style="--set-col:#4f8cff">
      <span class="cs-set-row-label">🛡️ Bouclier</span>
      <span class="cs-set-row-fx">CA +2</span>
    </div>`;
  }

  html += `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">🛡️ Armures & Accessoires</span>
      ${STATE.isAdmin ? '<button class="btn btn-outline btn-sm" data-action="openArmorSetsAdmin">🧩 Sets</button>' : ''}
      ${totalStr?`<span class="cs-hint">${totalStr}</span>`:''}
    </div>
    <div class="cs-armor-grid3">
      ${armorSlots.map(_armorCard).join('')}
    </div>
    ${setHtml}
  </div>`;

  // ── 3. Actions ────────────────────────────────────────────────────────────
  html += `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">📋 Actions</span>
    </div>
    <div class="cs-actions-row">
      ${[
        ['⚡','Action','Frappe / Sort / Compétence'],
        ['🏃','Action','Courir (×2 vitesse)'],
        ['🛡️','Action','Se désengager'],
        ['👁️','Action','Se cacher'],
        ['🤝','Action','Aider (allié)'],
        ['🔄','Action','Changer d\'arme'],
      ].map(([icon,type,desc])=>`<div class="cs-action-chip">
        <span class="cs-action-icon">${icon}</span>
        <div class="cs-action-body"><div class="cs-action-type">${type}</div><div class="cs-action-desc">${desc}</div></div>
      </div>`).join('')}
    </div>
    <p class="cs-rule-note">1 Action · 1 Action Bonus · 1 Réaction · Déplacement par tour</p>
  </div>`;

  return html;
}

/** Active ou désactive un élément sur un personnage. */
export async function toggleCharElement(charId, elemId) {
  if (!STATE.isAdmin) { showNotif('Seul le MJ peut modifier les noyaux accessibles.', 'error'); return; }
  const c = STATE.activeChar;
  if (!c || c.id !== charId) return;
  const elems = [...(c.elements || [])];
  const idx   = elems.indexOf(elemId);
  if (idx >= 0) elems.splice(idx, 1);
  else          elems.push(elemId);
  c.elements = elems;
  // Synchronise les refs pour que le V3 lise la version fraîche
  if (charSession.getCurrentChar()?.id === c.id) charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  await updateInCol('characters', charId, { elements: elems });
  // ── Mise à jour immédiate de l'UI (sans attendre un re-render complet) ──
  // 1. Toggle visuel direct des chips V3 (.elem-chip[data-elem-id="..."])
  document.querySelectorAll(`.elem-chip[data-elem-id="${elemId}"]`).forEach(chip => {
    chip.classList.toggle('on', idx < 0);   // si on vient d'ajouter (idx était -1) → on
  });
  // 2. Re-render full du tab Combat V3 si on est dessus (pour rafraîchir les
  //    autres affichages dépendants : style de combat, sorts, etc.)
  if (charSession.getCurrentCharTab() === 'combat') {
    charSession.renderTab('combat', c, charSession.getCanEditChar());
  } else {
    // Fallback legacy : ancien placeholder par id
    try {
      const allTypes   = await loadDamageTypes();
      const magicTypes = getMagicTypes(allTypes);
      const el = document.getElementById(`cs-elements-${charId}`);
      if (el) el.innerHTML = _renderElementAccessHtml(c, magicTypes, true);
    } catch {}
  }
  showNotif('Éléments mis à jour.', 'success');
}
