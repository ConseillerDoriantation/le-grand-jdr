import { STATE } from '../../core/state.js';
import { modStr } from '../../shared/html.js';
import { formatItemBonusText } from '../../shared/char-stats.js';
import {
  loadCombatStyles, detectCombatStyle,
  openCombatStylesAdmin, openWeaponFormatsAdmin,
  _getTraits, getArmorTypeMeta, getArmorSetChipText, getArmorSetData,
  getToucherDisplay, getDegatsDisplay,
} from './data.js';

// ── renderCharEquip ───────────────────────────────────────────────────────────

export function renderCharEquip(c, canEdit) {
  const equip = c.equipement||{};
  const weaponSlots = ['Main principale','Main secondaire'];
  const armorSlots = ['Tête','Torse','Bottes','Amulette','Anneau','Objet magique'];
  const armorSet = getArmorSetData(c);
  const armorSetChipText = getArmorSetChipText(armorSet);
  const s = c.stats||{}; const sb = c.statsBonus||{};

  let html = '';

  html += `<div class="cs-section">
    <div class="cs-section-title">⚔️ Armes
      ${canEdit?'<span class="cs-hint">cliquer sur ✏️ pour modifier</span>':''}
    </div>`;

  weaponSlots.forEach(slot => {
    const item    = equip[slot]||{};
    const statKey = item.statAttaque==='dexterite' ? 'dexterite'
                  : item.statAttaque==='intelligence' ? 'intelligence'
                  : 'force';
    const statVal = (s[statKey]||8)+(sb[statKey]||0);
    const mod     = Math.floor((Math.min(22,statVal)-10)/2);
    const modS    = modStr(mod);

    const toucherDisplay = getToucherDisplay(c, item, statKey);
    const degatsDisplay = getDegatsDisplay(c, item, statKey);
    const bonusDisplay = formatItemBonusText(item);

    // Badge format
    const formatBadge = item.format
      ? `<span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
           border-radius:6px;padding:1px 6px;color:var(--text-dim)">${item.format}</span>`
      : '';

    html += `<div class="cs-weapon-row">
      <div class="cs-weapon-slot-label">${slot}</div>
      <div class="cs-weapon-body">
        ${item.nom ? `
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem">
            <div class="cs-weapon-name">${item.nom}</div>
            ${formatBadge}
          </div>
          ${_getTraits(item).map(t => `<div class="cs-weapon-trait">${t}</div>`).join('')}
          <div class="cs-weapon-stats">
            <span class="cs-ws">
              <span class="cs-ws-label">Toucher</span>
              <span class="cs-ws-val gold">${toucherDisplay}</span>
            </span>
            <span class="cs-ws">
              <span class="cs-ws-label">Dégâts</span>
              <span class="cs-ws-val red">${degatsDisplay}</span>
            </span>
            ${bonusDisplay?`<span class="cs-ws">
              <span class="cs-ws-label">Bonus</span>
              <span class="cs-ws-val" style="color:#4f8cff">${bonusDisplay}</span>
            </span>`:''}
            ${item.portee?`<span class="cs-ws">
              <span class="cs-ws-label">Portée</span>
              <span class="cs-ws-val">${item.portee}</span>
            </span>`:''}
            ${item.particularite?`<span class="cs-ws cs-ws-wide">
              <span class="cs-ws-label">Particularité</span>
              <span class="cs-ws-val muted">${item.particularite}</span>
            </span>`:''}
          </div>`
        : `<div class="cs-weapon-empty">— Vide —</div>`}
      </div>
      ${canEdit?`<button class="cs-equip-btn" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
    </div>`;
  });

  html += `<div class="cs-combat-info">
    🎲 Critique : Maximum des dés + relance les dés de dégâts.
  </div>`;

  // ── Effets actifs du set d'armure ─────────────────────────────────────────
  if (armorSet.isActive) {
    const mod   = armorSet.modifiers;
    const tone  = armorSet.activeEffect?.tone || 'neutral';
    const TONE_COLORS = { light:'#22c38e', medium:'#4f8cff', heavy:'#e8b84b', neutral:'var(--text-dim)' };
    const col   = TONE_COLORS[tone] || 'var(--text-dim)';

    const effects = [];
    if (mod.spellPmDelta < 0)   effects.push({ icon:'🧙', text:`Sorts −${Math.abs(mod.spellPmDelta)} PM`, desc:'Coût réduit' });
    if (mod.toucherBonus > 0)   effects.push({ icon:'🎯', text:`Toucher +${mod.toucherBonus}`, desc:'Sur tous les jets de toucher' });
    if (mod.damageReduction > 0)effects.push({ icon:'🛡️', text:`Réduction ${mod.damageReduction}`, desc:'Dégâts reçus réduits' });

    const mainS   = (c?.equipement||{})['Main secondaire'];
    const stypeS  = (mainS?.sousType || mainS?.nom || '').toLowerCase();
    if (stypeS.includes('bouclier') || stypeS.includes('shield')) {
      effects.push({ icon:'🛡️', text:'CA +2', desc:'Bonus bouclier' });
    }

    html += `<div style="background:${col}0c;border:1px solid ${col}33;border-radius:10px;
      padding:.65rem .85rem;margin-top:.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
        <span style="font-size:.78rem;font-weight:700;color:${col}">${armorSetChipText}</span>
        <span style="font-size:.65rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Set complet</span>
      </div>
      ${effects.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.4rem">
        ${effects.map(e => `
        <div style="display:flex;align-items:center;gap:.35rem;padding:.25rem .6rem;
          background:${col}12;border-radius:6px;border:1px solid ${col}28">
          <span style="font-size:.85rem">${e.icon}</span>
          <span style="font-size:.78rem;font-weight:700;color:${col}">${e.text}</span>
          <span style="font-size:.67rem;color:var(--text-dim)">${e.desc}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
  } else {
    const mainS  = (c?.equipement||{})['Main secondaire'];
    const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();
    if (stypeS.includes('bouclier') || stypeS.includes('shield')) {
      html += `<div style="display:inline-flex;align-items:center;gap:.4rem;margin-top:.4rem;
        padding:.25rem .65rem;background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.25);
        border-radius:6px;font-size:.75rem">
        <span>🛡️</span>
        <span style="color:#4f8cff;font-weight:700">CA +2</span>
        <span style="color:var(--text-dim)">Bouclier</span>
      </div>`;
    }
  }

  // ── Style de combat actif ─────────────────────────────────────────────────
  const styleId = `cs-combat-style-${c.id||'x'}`;
  html += `<div id="${styleId}" style="margin-top:.6rem"></div>`;
  setTimeout(async () => {
    const el = document.getElementById(styleId);
    if (!el) return;
    const styles = await loadCombatStyles();
    const style  = detectCombatStyle(c, styles);
    if (!style) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="background:${style.couleur}11;border:1px solid ${style.couleur}44;
        border-left:3px solid ${style.couleur};border-radius:10px;
        padding:.65rem .9rem;display:flex;flex-direction:column;gap:.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <span style="font-weight:700;font-size:.84rem;color:${style.couleur}">${style.label}</span>
          <span style="font-size:.65rem;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase">Style de combat</span>
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);line-height:1.55">${style.description}</div>
      </div>
      ${STATE.isAdmin ? `
        <button onclick="openCombatStylesAdmin()" class="btn btn-outline btn-sm"
          style="margin-top:.35rem;font-size:.7rem;width:100%">⚙️ Gérer les styles de combat</button>
        <button onclick="openWeaponFormatsAdmin()" class="btn btn-outline btn-sm"
          style="margin-top:.25rem;font-size:.7rem;width:100%">⚙️ Gérer les formats d'armes</button>` : ''}
    `;
  }, 0);

  html += `</div>`;

  // Actions
  html += `<div class="cs-section">
    <div class="cs-section-title">📋 Actions</div>
    <div class="cs-actions-grid">
      ${[
        ['⚡','Action','Frappe / Sort / Compétence'],
        ['🏃','Action','Courir (×2 vitesse)'],
        ['🛡️','Action','Se désengager'],
        ['👁️','Action','Se cacher'],
        ['🤝','Action','Aider (retire état allié)'],
        ['🔄','Action','Changer d\'arme'],
      ].map(([icon,type,desc])=>`
        <div class="cs-action-chip">
          <span class="cs-action-icon">${icon}</span>
          <div><div class="cs-action-type">${type}</div><div class="cs-action-desc">${desc}</div></div>
        </div>`).join('')}
    </div>
    <div class="cs-action-footer">1 Action + 1 Action Bonus + 1 Réaction + Déplacement par tour</div>
  </div>`;

  // Armures
  html += `<div class="cs-section">
    <div class="cs-section-title">🛡️ Armures & Accessoires</div>
    <div class="cs-armor-grid">`;
  armorSlots.forEach(slot => {
    const item = equip[slot]||{};
    const bonuses = ['fo','dex','in','sa','co','ch','ca'].filter(k=>item[k]);
    const armorTypeMeta = getArmorTypeMeta(item.typeArmure || '');
    html += `<div class="cs-armor-card ${item.nom?'equipped':''}">
      <div class="cs-armor-slot">${slot}</div>
      <div class="cs-armor-name">${item.nom||'—'}</div>
      ${armorTypeMeta.label ? `<div class="cs-armor-type cs-armor-type--${armorTypeMeta.tone}" data-armor-tone="${armorTypeMeta.tone}">${armorTypeMeta.label}</div>` : ''}
      ${_getTraits(item).map(t => `<div class="cs-armor-trait">${t}</div>`).join('')}
      ${bonuses.length?`<div class="cs-armor-bonuses">${bonuses.map(k=>`<span class="badge badge-gold" style="font-size:0.6rem">${k.toUpperCase()} ${item[k]>0?'+'+item[k]:item[k]}</span>`).join('')}</div>`:''}
      ${canEdit?`<button class="cs-equip-btn-sm" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
    </div>`;
  });

  const totals = {fo:0,dex:0,in:0,sa:0,co:0,ch:0,ca:0};
  Object.values(equip).forEach(it=>Object.keys(totals).forEach(k=>{totals[k]+=(it[k]||0);}));
  const totalStr = Object.entries(totals).filter(([,v])=>v!==0).map(([k,v])=>`${k.toUpperCase()} ${v>0?'+'+v:v}`).join(' · ');
  if (totalStr) html += `<div class="cs-bonus-total">Bonus total : ${totalStr}</div>`;
  html += `</div></div>`;
  return html;
}
