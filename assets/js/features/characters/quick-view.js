// ══════════════════════════════════════════════════════════════════════════════
// quick-view.js — Aperçu condensé d'un personnage en modal
// Accessible depuis le dashboard, VTT, etc. — sans naviguer hors page.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { openModal, closeModal } from '../../shared/modal.js';
import { _esc } from '../../shared/html.js';
import {
  getMod, calcCA, calcVitesse, calcPVMax, calcPMMax, calcPalier, pct,
  STAT_META,
} from '../../shared/char-stats.js';
import { getMainWeapon, getArmorSetData, getWeaponToucherParts, getWeaponDegatsParts } from './data.js';

// Cherche le perso dans plusieurs sources : ses propres persos, le cache du
// groupe (rempli par le dashboard) — permet de quick-view les autres joueurs
// sans avoir accès à leur fiche complète.
function _findChar(id) {
  const own = (STATE.characters || []).find(c => c.id === id);
  if (own) return own;
  const partyCache = window._partyCharsCache || [];
  return partyCache.find(c => c.id === id) || null;
}

function _statRow(c) {
  return STAT_META.map(st => {
    const base = (c.stats?.[st.key]) || 8;
    const bonus = (c.statsBonus?.[st.key]) || 0;
    const total = base + bonus;
    const mod = getMod(c, st.key);
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    const cls = mod > 0 ? 'pos' : mod < 0 ? 'neg' : 'zero';
    return `
      <div class="qv-stat">
        <div class="qv-stat-name">${st.label.slice(0,3)}</div>
        <div class="qv-stat-mod qv-stat-mod--${cls}">${modStr}</div>
        <div class="qv-stat-total">${total}${bonus?` <span class="qv-stat-bonus">${bonus>0?'+':''}${bonus}</span>`:''}</div>
      </div>`;
  }).join('');
}

function _weaponsBlock(c) {
  const equip = c.equipement || {};
  const slots = ['Main principale', 'Main secondaire'];
  const rows = slots.map(slot => {
    const raw = equip[slot] || {};
    const item = (slot === 'Main principale' && !raw.nom) ? getMainWeapon(c) : raw;
    if (!item || !item.nom) return null;
    const statKey = item.statAttaque === 'dexterite' ? 'dexterite'
                  : item.statAttaque === 'intelligence' ? 'intelligence' : 'force';
    let tStr = '—', dStr = '—';
    try { const tp = getWeaponToucherParts(c, item, statKey); if (tp?.roll) tStr = tp.roll; } catch {}
    try { const dp = getWeaponDegatsParts(c, item, statKey); if (dp?.roll) dStr = dp.roll; } catch {}
    return `
      <div class="qv-weapon">
        <div class="qv-weapon-slot">${slot.replace('Main ', '')}</div>
        <div class="qv-weapon-body">
          <div class="qv-weapon-name">${_esc(item.nom)}</div>
          <div class="qv-weapon-stats">
            <span title="Toucher"><strong>${_esc(tStr)}</strong></span>
            <span title="Dégâts" style="color:var(--crimson, #ff5a7e)"><strong>${_esc(dStr)}</strong></span>
          </div>
        </div>
      </div>`;
  }).filter(Boolean).join('');
  if (!rows) return '';
  return `<div class="qv-block">
    <div class="qv-block-title">⚔️ Armement</div>
    <div class="qv-weapons">${rows}</div>
  </div>`;
}

function _armorBlock(c) {
  const equip = c.equipement || {};
  const slots = ['Casque', 'Torse', 'Pieds', 'Bouclier', 'Cape', 'Accessoire 1', 'Accessoire 2'];
  const items = slots
    .map(s => ({ slot: s, item: equip[s] }))
    .filter(({ item }) => item && item.nom);
  const setData = getArmorSetData(c);
  const setName = setData?.name && setData.completion >= 2
    ? `${setData.name} (${setData.completion}/${setData.totalPieces || '?'})` : null;
  if (!items.length && !setName) return '';
  return `<div class="qv-block">
    <div class="qv-block-title">🛡️ Équipement${setName ? ` <span class="qv-set">· ⚜ ${_esc(setName)}</span>` : ''}</div>
    <div class="qv-armor-list">
      ${items.map(({ slot, item }) => `
        <div class="qv-armor-row">
          <span class="qv-armor-slot">${_esc(slot)}</span>
          <span class="qv-armor-name">${_esc(item.nom)}</span>
        </div>`).join('')}
    </div>
  </div>`;
}

function _spellsBlock(c) {
  const actives = (c.deck_sorts || []).filter(s => s.actif);
  if (!actives.length) return '';
  return `<div class="qv-block">
    <div class="qv-block-title">✨ Sorts actifs <span class="qv-count">${actives.length}</span></div>
    <div class="qv-spells">
      ${actives.map(s => `<span class="qv-spell" title="${_esc(s.description || '')}">${_esc(s.icone || '✨')} ${_esc(s.nom || '?')}${s.cout != null ? ` <span class="qv-spell-cost">${s.cout}PM</span>` : ''}</span>`).join('')}
    </div>
  </div>`;
}

function _maitrisesBlock(c) {
  const ms = (c.maitrises || []).filter(m => m.nom);
  if (!ms.length) return '';
  return `<div class="qv-block">
    <div class="qv-block-title">🎯 Maîtrises <span class="qv-count">${ms.length}</span></div>
    <div class="qv-tags">
      ${ms.slice(0, 8).map(m => `<span class="qv-tag" title="${_esc(m.description || '')}">${_esc(m.nom)}${m.niveau ? ` <span style="opacity:.6">Niv.${m.niveau}</span>` : ''}</span>`).join('')}
      ${ms.length > 8 ? `<span class="qv-tag-more">+${ms.length - 8}</span>` : ''}
    </div>
  </div>`;
}

export function quickViewChar(id) {
  const c = _findChar(id);
  if (!c) return;
  const isOwn = STATE.isAdmin || c.uid === STATE.user?.uid;
  const pvMax = calcPVMax(c), pmMax = calcPMMax(c);
  const pv = c.pvActuel ?? pvMax;
  const pm = c.pmActuel ?? pmMax;
  const pvPct = pct(pv, pvMax), pmPct = pct(pm, pmMax);
  const pvColor = pvPct < 25 ? '#ff5a7e' : pvPct < 50 ? '#ff9544' : '#22c38e';
  const xp = c.exp || 0;
  const xpMax = calcPalier(c.niveau || 1);
  const xpPct = pct(xp, xpMax);
  const photoPos = `${50 + (c.photoX || 0) * 50}% ${50 + (c.photoY || 0) * 50}%`;
  const titres = (c.titres || []).slice(0, 3);

  openModal('', `
    <div class="qv-root">
      <div class="qv-header">
        <div class="qv-photo-wrap">
          ${c.photo
            ? `<img class="qv-photo" src="${_esc(c.photo)}" style="object-position:${photoPos}">`
            : `<div class="qv-photo qv-photo-empty">${(c.nom||'?')[0].toUpperCase()}</div>`}
          <div class="qv-level">Niv. ${c.niveau || 1}</div>
        </div>
        <div class="qv-id">
          <div class="qv-name">${_esc(c.nom || 'Sans nom')}</div>
          <div class="qv-chips">
            ${c.classe ? `<span class="qv-chip">${_esc(c.classe)}</span>` : ''}
            ${c.race ? `<span class="qv-chip">${_esc(c.race)}</span>` : ''}
          </div>
          ${titres.length ? `<div class="qv-titres">${titres.map(t => `<span class="qv-titre">${_esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>

      <div class="qv-vitals">
        <div class="qv-vital qv-vital--pv">
          <div class="qv-vital-lbl">❤️ PV</div>
          <div class="qv-vital-val" style="color:${pvColor}">${pv}<span class="qv-vital-max">/${pvMax}</span></div>
          <div class="qv-bar"><div class="qv-bar-fill" style="width:${pvPct}%;background:${pvColor}"></div></div>
        </div>
        <div class="qv-vital qv-vital--pm">
          <div class="qv-vital-lbl">🔵 PM</div>
          <div class="qv-vital-val" style="color:#6aa7ff">${pm}<span class="qv-vital-max">/${pmMax}</span></div>
          <div class="qv-bar"><div class="qv-bar-fill" style="width:${pmPct}%;background:#6aa7ff"></div></div>
        </div>
        <div class="qv-vital qv-vital--mini">
          <div class="qv-vital-lbl">🛡️ CA</div>
          <div class="qv-vital-val qv-vital-num">${calcCA(c)}</div>
        </div>
        <div class="qv-vital qv-vital--mini">
          <div class="qv-vital-lbl">🏃 Vit.</div>
          <div class="qv-vital-val qv-vital-num">${calcVitesse(c)}m</div>
        </div>
        <div class="qv-vital qv-vital--xp">
          <div class="qv-vital-lbl">XP</div>
          <div class="qv-vital-val qv-vital-xp">${xp}<span class="qv-vital-max">/${xpMax}</span></div>
          <div class="qv-bar"><div class="qv-bar-fill" style="width:${xpPct}%;background:#b47fff"></div></div>
        </div>
      </div>

      <div class="qv-stats">${_statRow(c)}</div>

      <div class="qv-two-col">
        <div class="qv-col">
          ${_weaponsBlock(c)}
          ${_armorBlock(c)}
        </div>
        <div class="qv-col">
          ${_spellsBlock(c)}
          ${_maitrisesBlock(c)}
        </div>
      </div>

      <div class="qv-actions">
        <button class="btn btn-outline btn-sm" onclick="window.closeModalDirect?.() ?? window.closeModal?.()">Fermer</button>
        ${isOwn ? `<button class="btn btn-gold" onclick="window._quickViewGoFull('${c.id}')">Ouvrir la fiche complète →</button>` : ''}
      </div>
    </div>
  `);
}

window._quickViewChar = quickViewChar;
window._quickViewGoFull = (id) => {
  if (typeof window.closeModalDirect === 'function') window.closeModalDirect();
  else if (typeof closeModal === 'function') closeModal();
  if (typeof window._goToChar === 'function') window._goToChar(id);
  else if (typeof window.navigate === 'function') { window._targetCharId = id; window.navigate('characters'); }
};

export default quickViewChar;
