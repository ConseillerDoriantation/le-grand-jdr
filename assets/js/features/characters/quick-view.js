// ══════════════════════════════════════════════════════════════════════════════
// quick-view.js — Aperçu de table d'un personnage, sans lecture Firestore.
// Les données viennent exclusivement des caches déjà alimentés de la session.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { registerActions } from '../../core/actions.js';
import { openModal, closeModalDirect } from '../../shared/modal.js';
import { _esc } from '../../shared/html.js';
import { characterPortraitContent } from '../../shared/portraits.js';
import {
  getMod, calcCA, calcVitesse, calcPVMax, calcPMMax, calcPalier, pct,
  STAT_META, modStr, getItemEffectText,
} from '../../shared/char-stats.js';
import {
  getMainWeapon, getArmorSetData, getArmorTypeMeta, getArmorSetChipText,
  getWeaponToucherParts, getWeaponDegatsParts, _getTraits,
} from './data.js';
import { spellVM, noyauTypesFor } from './spells-calc.js';
import { getDashboardPartyChars } from '../../shared/dashboard-session.js';
import { setTargetCharacter } from '../../shared/character-navigation.js';
import { getEquipmentSlots, getPrimaryWeaponSlotId } from '../../shared/equipment-slots.js';
import { canControlCharacter, isCharacterOwner } from '../../shared/character-state.js';
import { getDamageTypes } from '../../shared/damage-types.js';
import { getRarities } from '../../shared/rarity.js';

const AURA_PALETTE = Object.freeze({
  blue: '#4f8cff', arcane: '#9d6fff', crimson: '#ff5a7e',
  gold: '#e8b84b', emerald: '#22c38e', ember: '#ff9544',
});
const DAMAGE_FALLBACK = Object.freeze({
  physique: ['Physique', '#9ca3af'], tranchant: ['Tranchant', '#94a3b8'],
  perforant: ['Perforant', '#cbd5e1'], contondant: ['Contondant', '#a3a3a3'],
  feu: ['Feu', '#f97316'], froid: ['Froid', '#38bdf8'], foudre: ['Foudre', '#facc15'],
  poison: ['Poison', '#22c55e'], psychique: ['Psychique', '#ec4899'],
  necrotique: ['Nécrotique', '#64748b'], radiant: ['Radiant', '#f9d71c'],
  lumiere: ['Lumière', '#f9d71c'], arcane: ['Arcane', '#9d6fff'],
});
const ICONS = Object.freeze({
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
  eye: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
});

const _qvState = { currentId: '', ids: [], hasList: false };

function _findChar(id) {
  return (STATE.characters || []).find(c => c.id === id)
    || getDashboardPartyChars().find(c => c.id === id)
    || null;
}

function _safeColor(value, fallback = '#7a8fa8') {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback;
}

function _aura(c) {
  return _safeColor(c?.auraColor, AURA_PALETTE[c?.aura] || AURA_PALETTE.blue);
}

function _ownerName(c) {
  const raw = String(c?.ownerPseudo || c?.joueur || c?.playerName || '').trim();
  return raw && !raw.includes('@') ? raw : 'un joueur';
}

function _formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Number(value) || 0);
}

function _statBand(c) {
  return STAT_META.map(stat => {
    const base = Number(c.stats?.[stat.key]) || 8;
    const bonus = Number(c.statsBonus?.[stat.key]) || 0;
    const total = base + bonus;
    const mod = getMod(c, stat.key);
    const tone = mod > 0 ? 'pos' : mod < 0 ? 'neg' : 'zero';
    return `<div class="qv-s" title="${_esc(`${stat.label} ${total}${bonus ? `, bonus ${modStr(bonus)}` : ''}`)}">
      <small>${_esc(stat.label.slice(0, 3).toUpperCase())}</small>
      <b class="${tone}">${_esc(modStr(mod))}</b>
      <span>${total}${bonus ? ` <em>${_esc(modStr(bonus))}</em>` : ''}</span>
    </div>`;
  }).join('');
}

function _vital(label, current, max, color) {
  const ratio = pct(current, max);
  const isHealth = label === 'PV';
  const low = isHealth && ratio < 25;
  const fill = isHealth
    ? (ratio < 25 ? 'var(--crimson)' : ratio < 50 ? 'var(--ember)' : 'var(--emerald)')
    : color;
  return `<div class="qv-v${low ? ' low' : ''}">
    <div class="qv-v-h"><small>${label}</small><b>${_formatNumber(current)}<i>/${_formatNumber(max)}</i></b></div>
    <div class="qv-bar"><u style="width:${ratio}%;--qv-fill:${fill}"></u></div>
  </div>`;
}

function _rarity(item = {}) {
  const raw = item.rarete ?? item.rare ?? 0;
  const rarities = getRarities();
  const found = rarities.find(r => String(r.value) === String(raw))
    || rarities.find(r => String(r.name).toLowerCase() === String(raw).toLowerCase());
  return { label: found?.name || 'Objet', color: _safeColor(found?.color, '#56667c') };
}

function _damageType(item = {}) {
  const types = getDamageTypes();
  const raw = String(item.damageTypeId || item.elementId || item.noyauTypeId || item.typeDegats || item.typeDegat || '').trim();
  const key = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const type = types.find(entry => entry.id === raw || String(entry.label || entry.nom || '').toLowerCase() === raw.toLowerCase());
  if (type) return { label: type.label || type.nom || raw, color: _safeColor(type.color, '#7a8fa8') };
  if (DAMAGE_FALLBACK[key]) return { label: DAMAGE_FALLBACK[key][0], color: DAMAGE_FALLBACK[key][1] };
  if (item.nature === 'magique') return { label: 'Magique', color: '#9d6fff' };
  return { label: raw || 'Physique', color: '#9ca3af' };
}

function _attackStat(item = {}) {
  const value = item.statAttaque || item.toucherStat || item.degatsStat || 'force';
  return STAT_META.some(stat => stat.key === value) ? value : 'force';
}

function _weaponCard(c, slotDef, item) {
  if (!item?.nom) {
    return `<div class="qv-w empty"><span class="qv-w-n"><small>${_esc(slotDef.label)}</small><b>Vide</b></span></div>`;
  }
  const rarity = _rarity(item);
  const damage = _damageType(item);
  const traits = _getTraits(item) || [];
  const effect = item.particularite || getItemEffectText(item) || item.effet || item.description || '';
  let hit = null;
  let dmg = null;
  try { hit = getWeaponToucherParts(c, item, _attackStat(item)); } catch { /* donnée historique incomplète */ }
  try { dmg = getWeaponDegatsParts(c, item, _attackStat(item)); } catch { /* idem */ }
  const offensive = Boolean(dmg?.roll || item.degats);
  return `<div class="qv-w" style="--qv-rarity:${rarity.color};--qv-damage:${damage.color}">
    <span class="qv-w-n"><small>${_esc(slotDef.label)} · ${_esc(rarity.label)}</small><b>${_esc(item.nom)}</b></span>
    ${offensive ? `<span class="qv-w-r"><span class="qv-roll"><small>Toucher</small><b>${_esc(hit?.roll || '—')}</b></span><span class="qv-roll dmg"><small>Dégâts</small><b>${_esc(dmg?.roll || item.degats || '—')}</b></span></span>` : '<span></span>'}
    <span class="qv-w-t">${offensive ? `<span class="qv-dt"><i></i>${_esc(damage.label)}</span>` : ''}${traits.map(trait => `<span>· ${_esc(trait)}</span>`).join('')}${!offensive && effect ? `<span>${_esc(effect)}</span>` : ''}</span>
  </div>`;
}

function _weaponsBlock(c) {
  const equipment = c.equipement || {};
  const primary = getPrimaryWeaponSlotId();
  const mainWeapon = getMainWeapon(c);
  const slots = getEquipmentSlots().filter(slot => slot.kind === 'weapon');
  return `<section class="qv-sec"><div class="qv-sh">En main</div>
    ${slots.map(slot => _weaponCard(c, slot, equipment[slot.id]?.nom ? equipment[slot.id] : (slot.id === primary ? mainWeapon : null))).join('') || '<div class="qv-none">Aucun emplacement de main</div>'}
  </section>`;
}

function _armorBlock(c) {
  const equipment = c.equipement || {};
  const slots = getEquipmentSlots().filter(slot => slot.kind !== 'weapon');
  const set = getArmorSetData(c);
  const dominant = set.dominantType ? getArmorTypeMeta(set.dominantType) : null;
  const setName = set.activeEffect?.set?.label || dominant?.set?.label || set.fullType || set.dominantType || 'Set de protection';
  const setEffect = set.isActive ? (getArmorSetChipText(set) || set.activeEffect?.chipText || 'Bonus de set actif') : 'Set incomplet, aucun bonus';
  const pips = (set.slots || []).map(entry => {
    const color = set.isActive ? 'var(--amber)' : _safeColor(getArmorTypeMeta(entry.type)?.color, '#56667c');
    return `<i class="${entry.equipped ? 'f' : ''}" style="--qv-pip:${color}" title="${_esc(entry.slot)}"></i>`;
  }).join('');
  return `<section class="qv-sec"><div class="qv-sh">Protection</div><div class="qv-ar">
    <div class="qv-set${set.isActive ? ' on' : ''}"><span class="qv-pips">${pips}</span><span><b>${_esc(setName)} · ${set.equippedCount}/${set.trackedSlots.length || 0}</b><small>${_esc(setEffect)}</small></span></div>
    ${slots.map(slot => {
      const item = equipment[slot.id];
      return `<div class="qv-ai"><small>${_esc(slot.label)}</small><span class="${item?.nom ? '' : 'no'}">${item?.nom ? _esc(item.nom) : '—'}</span></div>`;
    }).join('') || '<div class="qv-ai"><small>Équipement</small><span class="no">—</span></div>'}
  </div></section>`;
}

function _spellType(spell = {}) {
  const resolved = noyauTypesFor(spell)[0];
  if (resolved) return { label: resolved.label || resolved.nom || '', color: _safeColor(resolved.color, '#7a8fa8') };
  const type = getDamageTypes().find(entry => entry.id === spell.noyauTypeId);
  return type ? { label: type.label || type.nom || '', color: _safeColor(type.color, '#7a8fa8') } : { label: '', color: '#56667c' };
}

function _spellsBlock(c) {
  const spells = (c.deck_sorts || []).filter(spell => spell?.actif);
  const pmDelta = getArmorSetData(c)?.modifiers?.spellPmDelta || 0;
  return `<section class="qv-sec"><div class="qv-sh">Sorts préparés <i>${spells.length}</i></div>
    ${spells.length ? `<div class="qv-sp">${spells.map(spell => {
      const vm = spellVM(spell, pmDelta);
      const type = _spellType(spell);
      const free = Boolean(spell.alwaysPrepared);
      const cost = free ? '∞' : (vm.pm != null && vm.resource !== 'none' ? `${vm.pm} ${vm.resLabel}` : '—');
      return `<div class="qv-spl" style="--qv-element:${type.color}" title="${_esc(vm.effet || type.label)}"><i></i><span>${_esc(vm.nom)}</span><b class="${free ? 'free' : ''}">${_esc(cost)}</b></div>`;
    }).join('')}</div>` : '<div class="qv-none">Aucun sort préparé</div>'}
  </section>`;
}

function _norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function _heldWeaponTokens(c) {
  const tokens = new Set();
  const equipment = c.equipement || {};
  const primary = getPrimaryWeaponSlotId();
  getEquipmentSlots().filter(slot => slot.kind === 'weapon').forEach(slot => {
    const item = equipment[slot.id]?.nom ? equipment[slot.id] : (slot.id === primary ? getMainWeapon(c) : null);
    [item?.sousType, item?.typeArme, item?.format].forEach(value => { if (_norm(value)) tokens.add(_norm(value)); });
  });
  return tokens;
}

function _masteriesBlock(c) {
  const held = _heldWeaponTokens(c);
  const masteries = (c.maitrises || []).map(mastery => {
    const name = mastery.typeArme || mastery.nom || '';
    const normalized = _norm(name);
    const inHand = [...held].some(value => value === normalized || value.includes(normalized) || normalized.includes(value));
    return { ...mastery, name, level: Math.max(0, Math.min(5, parseInt(mastery.niveau) || 0)), inHand };
  }).filter(mastery => mastery.name && mastery.level > 0).sort((a, b) => Number(b.inHand) - Number(a.inHand) || b.level - a.level || a.name.localeCompare(b.name, 'fr'));
  const shown = masteries.slice(0, 5);
  return `<section class="qv-sec"><div class="qv-sh">Maîtrises <i>${masteries.length}</i></div>
    ${shown.length ? `<div class="qv-ms">${shown.map(mastery => `<div class="qv-m"><span class="${mastery.inHand ? 'hand' : ''}">${_esc(mastery.name)}</span><span class="qv-lvl">${[1, 2, 3, 4, 5].map(level => `<i class="${level <= mastery.level ? 'f' : ''}"></i>`).join('')}</span><b>+${mastery.level}</b></div>`).join('')}${masteries.length > 5 ? `<div class="qv-more">+${masteries.length - 5} autres maîtrises</div>` : ''}</div>` : '<div class="qv-none">Aucune maîtrise</div>'}
  </section>`;
}

function _navigation(c) {
  if (!_qvState.hasList) return '';
  const index = _qvState.ids.indexOf(c.id);
  return `<div class="qv-tools">
    <button type="button" class="qv-ib" data-action="_qvPrev" ${index <= 0 ? 'disabled' : ''} aria-label="Personnage précédent">${ICONS.prev}</button>
    <span class="qv-pos">${index + 1}/${_qvState.ids.length}</span>
    <button type="button" class="qv-ib" data-action="_qvNext" ${index < 0 || index >= _qvState.ids.length - 1 ? 'disabled' : ''} aria-label="Personnage suivant">${ICONS.next}</button>
    <button type="button" class="qv-ib qv-close" data-action="_qvClose" aria-label="Fermer">${ICONS.close}</button>
  </div>`;
}

function _header(c, xp, xpMax) {
  const xpRatio = pct(xp, xpMax);
  const titles = (c.titres || []).filter(Boolean);
  const mine = isCharacterOwner(c);
  return `<header class="qv-hd">
    <div class="qv-pt" title="${_formatNumber(xp)} / ${_formatNumber(xpMax)} XP">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="qv-ring-bg" cx="50" cy="50" r="47"/><circle class="qv-ring" cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="${xpRatio} 100"/></svg>
      <div class="qv-pt-in">${characterPortraitContent(c, { imgClass: 'qv-photo', fallbackTag: 'span', fallbackClass: 'qv-photo-empty' })}</div>
      <span class="qv-lv">Niv. ${c.niveau || 1}</span>
    </div>
    <div class="qv-id"><span class="qv-own">${mine ? 'Ton personnage' : `Joué par ${_esc(_ownerName(c))}`}</span><h2>${_esc(c.nom || 'Sans nom')}</h2><span>${_esc([c.classe, c.race].filter(Boolean).join(' · ') || 'Personnage')}</span>${titles.length ? `<span class="qv-tt">${titles.map(_esc).join(' · ')}</span>` : ''}<span class="qv-xp">XP ${_formatNumber(xp)} / ${_formatNumber(xpMax)}</span></div>
    ${_navigation(c) || `<div class="qv-tools"><button type="button" class="qv-ib qv-close" data-action="_qvClose" aria-label="Fermer">${ICONS.close}</button></div>`}
  </header>`;
}

function _renderQuickView(c) {
  const pvMax = calcPVMax(c);
  const pmMax = calcPMMax(c);
  // `hp` est la ressource courante canonique du VTT. `pvActuel` reste le
  // repli des fiches historiques qui n'ont pas encore été rejouées sur la table.
  const pv = c.hp ?? c.pvActuel ?? pvMax;
  const pm = c.pmActuel ?? pmMax;
  const xp = c.exp ?? c.xp ?? 0;
  const xpMax = calcPalier(c.niveau || 1);
  const canOpen = canControlCharacter(c);
  const owner = _ownerName(c);
  const aura = _aura(c);
  openModal(`Aperçu de ${c.nom || 'ce personnage'}`, `<div class="qv-root" style="--qv-aura:${aura}">
    ${_header(c, xp, xpMax)}
    <div class="qv-bd">
      <div class="qv-vit">${_vital('PV', pv, pvMax)}${_vital('PM', pm, pmMax, 'var(--gold)')}<div class="qv-v num"><b>${calcCA(c)}</b><small>CA</small></div><div class="qv-v num"><b>${calcVitesse(c)} m</b><small>Vitesse</small></div></div>
      <div class="qv-st">${_statBand(c)}</div>
      <div class="qv-cols"><div class="qv-col">${_weaponsBlock(c)}${_armorBlock(c)}</div><div class="qv-col">${_spellsBlock(c)}${_masteriesBlock(c)}</div></div>
    </div>
    <footer class="qv-ft">${canOpen ? `<p></p><button type="button" class="qv-btn" data-action="_qvClose">Fermer</button><button type="button" class="qv-btn pri" data-action="_quickViewGoFull" data-id="${_esc(c.id)}">Ouvrir la fiche ${ICONS.arrow}</button>` : `<p>${ICONS.eye}Lecture seule · fiche de ${_esc(owner)}</p><button type="button" class="qv-btn" data-action="_qvClose">Fermer</button>`}</footer>
  </div>`);
}

export function quickViewChar(id, { list } = {}) {
  const c = _findChar(id);
  if (!c) return;
  const hasList = Array.isArray(list);
  const ids = hasList ? [...new Set(list.map(entry => typeof entry === 'string' ? entry : entry?.id).filter(charId => charId && _findChar(charId)))] : [];
  if (hasList && !ids.includes(id)) ids.unshift(id);
  _qvState.currentId = id;
  _qvState.ids = ids;
  _qvState.hasList = hasList && ids.length > 0;
  _renderQuickView(c);
}

function _moveQuickView(delta) {
  if (!_qvState.hasList) return;
  const index = _qvState.ids.indexOf(_qvState.currentId);
  const id = _qvState.ids[index + delta];
  const c = id ? _findChar(id) : null;
  if (!c) return;
  _qvState.currentId = id;
  _renderQuickView(c);
}

function _closeQuickView() {
  _qvState.currentId = '';
  _qvState.ids = [];
  _qvState.hasList = false;
  closeModalDirect();
}

async function quickViewGoFull(id) {
  closeModalDirect();
  setTargetCharacter(id);
  const { navigate } = await import('../../core/navigation.js');
  navigate('characters');
}

document.addEventListener('keydown', event => {
  if (!document.querySelector('#modal-overlay.show .qv-root') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    _moveQuickView(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

registerActions({
  _qvClose: () => _closeQuickView(),
  _qvPrev: () => _moveQuickView(-1),
  _qvNext: () => _moveQuickView(1),
  _quickViewGoFull: btn => quickViewGoFull(btn.dataset.id),
});

export default quickViewChar;
