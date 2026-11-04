// Réglages MJ unifiés : Boutique → Gérer → Artisanat.

import { getDocData, loadCollection } from '../data/firestore.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { _esc } from './html.js';
import { openModal, closeModalDirect, setModalCloseGuard, clearModalCloseGuard } from './modal.js';
import { showNotif } from './notifications.js';
import { loadRarities, getRarities } from './rarity.js';
import { normalizeDiceSkills, DICE_SKILLS_DEFAULT } from './dice-skills.js';
import { loadCraftSettings, getCraftSettings, saveCraftSettings, invalidateCraftSettingsCache } from './craft-settings.js';
import { loadUpgradeSettings, getUpgradeSettings, saveUpgradeSettings, invalidateUpgradeSettingsCache } from './upgrade-settings.js';
import {
  ARTISAN_CATEGORIES, ARTISAN_DISCIPLINES, ARTISAN_FAMILIES,
  mergeArtisanSettings, splitArtisanSettings, diffArtisanSettings,
} from './artisan-settings-model.js';
import { ARTISAN_PRESETS, applyEconomyPreset } from './artisan-presets.js';
import { simulateArtisan, craftSay, failSay, refSay, disSay, resSay } from './artisan-sim.js';

const TABS = [
  { id: 'bases', number: '◆', label: 'Bases', sub: 'Disciplines et raretés', lead: 'Définis une seule fois les règles communes à tout le parcours.' },
  { id: 'fabriquer', number: '1', label: 'Fabriquer', sub: 'Recettes, DD et échecs', lead: 'Relie chaque catégorie à ses matériaux et règle la difficulté du craft.' },
  { id: 'ameliorer', number: '2', label: 'Améliorer', sub: 'Stats, traits et plafonds', lead: 'Règle les tarifs et les limites réelles de chaque objet.' },
  { id: 'reforger', number: '3', label: 'Reforger', sub: 'Rareté et Bastion', lead: 'Monte la rareté d’un objet en consommant une partie de sa recette.' },
  { id: 'demonter', number: '4', label: 'Démonter & revendre', sub: 'Récupération et reprise', lead: 'Une seule action démonte l’objet, rend ses matériaux et extrait ses traits.' },
];
const ROOM_FALLBACK = [
  { slug: 'forge', nom: 'Forge' }, { slug: 'atelier_confection', nom: 'Atelier de confection' },
  { slug: 'atelier_orfevre', nom: 'Atelier d’orfèvre' },
];
const clone = value => JSON.parse(JSON.stringify(value));
const get = (root, path) => String(path || '').split('.').reduce((value, key) => value?.[key], root);
function put(root, path, value) {
  const parts = String(path).split('.'); let cursor = root;
  parts.slice(0, -1).forEach(key => { cursor = cursor[key] ??= {}; });
  cursor[parts.at(-1)] = value;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const round10 = value => Math.round((Number(value) || 0) / 10) * 10;
const stars = value => '★'.repeat(Math.max(1, parseInt(value, 10) || 1));
const po = value => `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('fr-FR')} PO`;

let saved = null;
let draft = null;
let craftBase = null;
let upgradeBase = null;
let activeTab = 'bases';
let skills = [];
let rooms = [];
let materials = [];
let materialNames = {};
let sim = { category: 'armeCaC', format: 'w1', rarity: 2 };
let changesOpen = false;
let toastTimer = 0;

const storageKey = suffix => `artisan.settings.${STATE.adventure?.id || 'default'}.${suffix}`;
function loadLocal(tab) {
  try { sim = { ...sim, ...JSON.parse(localStorage.getItem(storageKey('sim')) || '{}') }; } catch { /* ignore */ }
  const storedTab = localStorage.getItem(storageKey('tab'));
  activeTab = TABS.some(entry => entry.id === tab) ? tab : (TABS.some(entry => entry.id === storedTab) ? storedTab : 'bases');
}
function saveLocal() {
  localStorage.setItem(storageKey('sim'), JSON.stringify(sim));
  localStorage.setItem(storageKey('tab'), activeTab);
}

function rarityList() {
  const list = getRarities();
  return list.length ? list : [
    { value: 1, name: 'Commun', color: '#8a9bb4' }, { value: 2, name: 'Peu commun', color: '#22c38e' },
    { value: 3, name: 'Rare', color: '#6aa7ff' }, { value: 4, name: 'Épique', color: '#c084fc' },
    { value: 5, name: 'Légendaire', color: '#f4c430' },
  ];
}
function rarity(value) {
  const list = rarityList();
  return list.find(entry => +entry.value === +value) || list[Math.max(0, Math.min(list.length - 1, +value - 1))];
}
function rarityTag(value, withName = true) {
  const r = rarity(value);
  return `<span class="acfg-rarity" style="--rarity:${_esc(r?.color || '#8a9bb4')}"><i>${stars(value)}</i>${withName ? `<span>${_esc(r?.name || '')}</span>` : ''}</span>`;
}
function disc(id) { return ARTISAN_DISCIPLINES.find(entry => entry.id === id); }
function categoryLabel(id) { return ARTISAN_CATEGORIES[id]?.label || id; }
function materialName(id) { return materialNames[id] || ''; }

function field(path, value, { min = 0, max = 99999, step = 1, unit = '', width = 64, optional = false, readonly = false } = {}) {
  return `<label class="acfg-field${!same(get(saved, path), get(draft, path)) ? ' is-modified' : ''}${readonly ? ' is-readonly' : ''}">
    <input type="number" value="${value ?? ''}" min="${min}" max="${max}" step="${step}" style="--field-width:${width}px"
      ${readonly ? 'readonly' : ''} data-input="_artCfgField" data-path="${_esc(path)}" ${optional ? 'data-optional="1"' : ''}>
    ${unit ? `<i>${unit}</i>` : ''}</label>`;
}
function select(path, value, options, extra = '') {
  const modified = !same(get(saved, path), get(draft, path));
  return `<select class="acfg-select${!value ? ' is-empty' : ''}${modified ? ' is-modified' : ''}" data-change="_artCfgSelect" data-path="${_esc(path)}" ${extra}>${options}</select>`;
}
function segmented(path, values, current) {
  return `<div class="acfg-seg${!same(get(saved, path), get(draft, path)) ? ' is-modified' : ''}">${values.map(([value, label]) =>
    `<button type="button" class="${same(value, current) ? 'is-active' : ''}" data-action="_artCfgSet" data-path="${_esc(path)}" data-value="${_esc(JSON.stringify(value))}">${label}</button>`).join('')}</div>`;
}
function stepper(path, value, min = 0, max = 6) {
  return `<div class="acfg-stepper${!same(get(saved, path), get(draft, path)) ? ' is-modified' : ''}"><button type="button" data-action="_artCfgStep" data-path="${path}" data-delta="-1" ${value <= min ? 'disabled' : ''}>−</button><b>${value}</b><button type="button" data-action="_artCfgStep" data-path="${path}" data-delta="1" ${value >= max ? 'disabled' : ''}>+</button></div>`;
}
function range(path, value, label) {
  return `<div class="acfg-range"><span>${label}</span><input type="range" min="0" max="100" step="5" value="${value}" data-input="_artCfgField" data-path="${path}"><output>${value} %</output></div>`;
}
function block(title, hint, body, aside = '') {
  return `<section class="acfg-block"><header><div><h3>${title}</h3>${hint ? `<p>${hint}</p>` : ''}</div>${aside}</header>${body}</section>`;
}

function skillOptions(selected) {
  return `<option value="">— Compétence —</option>${skills.map(entry => {
    const value = entry.name || entry.id || '';
    return `<option value="${_esc(value)}" ${value === selected ? 'selected' : ''}>${_esc(value)}${entry.stat ? ` (${_esc(entry.stat)})` : ''}</option>`;
  }).join('')}`;
}
function roomOptions(selected) {
  const list = rooms.length ? rooms : ROOM_FALLBACK;
  const all = selected && !list.some(entry => entry.slug === selected) ? [...list, { slug: selected, nom: selected }] : list;
  return `<option value="">— Aucune salle —</option>${all.map(entry => `<option value="${_esc(entry.slug)}" ${entry.slug === selected ? 'selected' : ''}>${_esc(entry.nom || entry.slug)}</option>`).join('')}`;
}
function materialOptions(selected, tier) {
  const target = materials.filter(item => +(item._artisanTier || item.rarete || 0) === +tier);
  const other = materials.filter(item => !target.includes(item));
  const list = (label, values) => values.length ? `<optgroup label="${label}">${values.map(item => `<option value="${_esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${_esc(item.nom)}</option>`).join('')}</optgroup>` : '';
  return `<option value="">— À lier… —</option>${list(`${stars(tier)} · même rareté`, target)}${list('Autres raretés', other)}`;
}

function warningMap() {
  const warnings = { bases: [], fabriquer: [], ameliorer: [], reforger: [], demonter: [] };
  for (const d of ARTISAN_DISCIPLINES) {
    if (Object.values(draft.cats).includes(d.id) && !draft.disc[d.id]?.skill) warnings.bases.push(`${d.label} sans compétence`);
    if (draft.reforge.on && Object.values(draft.cats).includes(d.id) && !draft.disc[d.id]?.room) warnings.bases.push(`${d.label} sans salle`);
  }
  for (const cat of Object.keys(ARTISAN_CATEGORIES)) for (let tier = 1; tier <= draft.craft.maxTier; tier++) {
    if (!draft.recipes?.[cat]?.[tier]?.mat) warnings.fabriquer.push(`${categoryLabel(cat)} ${stars(tier)}`);
  }
  if (draft.up.armorMismatch && !draft.up.armorDetailed) warnings.ameliorer.push('Armures historiques différentes');
  if (!draft.reforge.on) warnings.reforger.push('Reforge désactivée');
  return warnings;
}

function renderNav() {
  const warnings = warningMap();
  return `<nav class="acfg-nav"><div class="acfg-nav-label">Réglages communs</div>${TABS.map((entry, index) => `${index === 1 ? '<div class="acfg-nav-label">Parcours d’un objet</div>' : ''}<button type="button" class="acfg-nav-item${entry.id === activeTab ? ' is-active' : ''}${index > 1 ? ' is-flow' : ''}" data-action="_artCfgTab" data-tab="${entry.id}"><span>${entry.number}</span><b>${entry.label}</b>${warnings[entry.id].length ? `<em>${warnings[entry.id].length}</em>` : '<em class="is-ok">✓</em>'}<small>${entry.sub}</small></button>`).join('')}</nav>`;
}

function renderBases() {
  const families = ARTISAN_FAMILIES.filter(f => f.cats.length);
  const matrix = `<div class="acfg-table-wrap"><table class="acfg-matrix"><thead><tr><th>Catégorie</th>${ARTISAN_DISCIPLINES.map(d => {
    const count = Object.values(draft.cats).filter(value => value === d.id).length;
    return `<th style="--disc:${d.color}"><div class="acfg-disc-head"><b>${d.icon} ${d.label}</b><span>${count} catégorie${count > 1 ? 's' : ''}</span></div>${select(`disc.${d.id}.skill`, draft.disc[d.id].skill, skillOptions(draft.disc[d.id].skill))}${select(`disc.${d.id}.room`, draft.disc[d.id].room, roomOptions(draft.disc[d.id].room))}</th>`;
  }).join('')}</tr></thead><tbody>${families.map(family => `<tr class="acfg-family"><th colspan="4">${family.icon} ${family.label}${family.note ? `<small>${family.note}</small>` : ''}</th></tr>${family.cats.map(cat => `<tr><td><b>${categoryLabel(cat)}</b><small>${ARTISAN_CATEGORIES[cat].example}</small></td>${ARTISAN_DISCIPLINES.map(d => `<td><button type="button" class="acfg-dot${draft.cats[cat] === d.id ? ' is-active' : ''}${!same(saved.cats[cat], draft.cats[cat]) && draft.cats[cat] === d.id ? ' is-modified' : ''}" style="--disc:${d.color}" data-action="_artCfgSet" data-path="cats.${cat}" data-value="&quot;${d.id}&quot;" aria-label="${d.label}"></button></td>`).join('')}</tr>`).join('')}`).join('')}<tr class="acfg-family"><th colspan="4">✦ Objets magiques <small>Non fabricables · traits seulement</small></th></tr></tbody></table></div>`;
  const rarities = rarityList();
  const ladder = `<div class="acfg-ladder">${rarities.map(r => `<div class="acfg-rung" style="--rarity:${_esc(r.color || '#8a9bb4')}"><i>${stars(r.value)}</i><span>${_esc(r.name)}</span></div>`).join('')}<div class="acfg-lane is-craft" style="grid-column:1/${Math.min(draft.craft.maxTier, rarities.length) + 1}">Fabrication · jusqu’à ${stars(draft.craft.maxTier)}</div><div class="acfg-lane is-reforge" style="grid-column:2/${rarities.length + 1}">Reforge · ${stars(2)} → ${stars(rarities.at(-1)?.value || 5)}</div></div>`;
  return block('Matrice des disciplines', 'Une catégorie dépend d’une discipline, d’une compétence de jet et d’une salle de reforge.', matrix)
    + block('Échelle de rareté', 'Le moteur de fabrication utilise au maximum trois paliers ; les suivants passent par la reforge.', ladder, segmented('craft.maxTier', [[1, `Jusqu’à ★`], [2, `Jusqu’à ★★`], [3, `Jusqu’à ★★★`]], draft.craft.maxTier));
}

function currentResult() { return simulateArtisan(draft, { category: sim.category, format: sim.format, rarity: sim.rarity, materialNames, maxRarity: rarityList().at(-1)?.value || 5 }); }
function example(text) { return `<p class="acfg-example"><span>Exemple</span>${text}</p>`; }

function recipeAutoCandidate(cat, tier) {
  const linked = Object.values(draft.recipes?.[cat] || {}).find(recipe => recipe?.mat);
  if (!linked) return null;
  const source = materials.find(item => item.id === linked.mat);
  if (!source) return null;
  const base = String(source.nom || '').replace(/\s*[★☆]+\s*$/u, '').trim();
  return materials.find(item => {
    const itemBase = String(item.nom || '').replace(/\s*[★☆]+\s*$/u, '').trim();
    return itemBase.toLocaleLowerCase('fr') === base.toLocaleLowerCase('fr') && +(item._artisanTier || item.rarete || 0) === +tier;
  }) || null;
}
function missingRecipeCount() {
  let count = 0;
  for (const cat of Object.keys(ARTISAN_CATEGORIES)) for (let tier = 1; tier <= draft.craft.maxTier; tier++) if (!draft.recipes?.[cat]?.[tier]?.mat && recipeAutoCandidate(cat, tier)) count++;
  return count;
}
function renderFabriquer() {
  const result = currentResult();
  const tierRows = [1, 2, 3].map(tier => `<tr class="${tier > draft.craft.maxTier ? 'is-disabled' : ''}"><th>${rarityTag(tier)}</th><td>${field(`craft.dd.${tier}`, draft.craft.dd[tier], { min: 1, max: 40 })}</td><td>${field(`craft.qty.${tier}`, draft.craft.qty[tier], { min: 1, max: 99, unit: 'unités' })}</td></tr>`).join('');
  const tiers = [1, 2, 3];
  const recipes = `<div class="acfg-table-wrap"><table class="acfg-recipes"><thead><tr><th>Catégorie</th>${tiers.map(t => `<th>${rarityTag(t, false)}</th>`).join('')}</tr></thead><tbody>${ARTISAN_FAMILIES.filter(f => f.cats.length).map(family => `<tr class="acfg-family"><th colspan="4">${family.icon} ${family.label}</th></tr>${family.cats.map(cat => `<tr><td><b>${categoryLabel(cat)}</b><small>${disc(draft.cats[cat])?.label || '—'}</small>${tiers.some(t => !draft.recipes?.[cat]?.[t]?.mat && recipeAutoCandidate(cat, t)) ? `<button type="button" class="acfg-link" data-action="_artCfgFill" data-cat="${cat}">+ Compléter la ligne</button>` : ''}</td>${tiers.map(tier => {
    const recipe = draft.recipes?.[cat]?.[tier] || {};
    return `<td class="${tier > draft.craft.maxTier ? 'is-disabled' : ''}"><small class="acfg-mobile-tier">${stars(tier)}</small><div class="acfg-recipe-cell">${select(`recipes.${cat}.${tier}.mat`, recipe.mat || '', materialOptions(recipe.mat || '', tier), `data-cat="${cat}" data-tier="${tier}"`)}${field(`recipes.${cat}.${tier}.qty`, recipe.qty ?? '', { min: 1, max: 99, width: 36, optional: true })}</div></td>`;
  }).join('')}</tr>`).join('')}`).join('')}</tbody></table></div>`;
  const fillCount = missingRecipeCount();
  return block('Paliers de fabrication', 'Le DD et la quantité par défaut s’appliquent à toutes les recettes du palier.', `<div class="acfg-table-wrap"><table class="acfg-tier-table"><thead><tr><th>Rareté</th><th>DD du jet</th><th>Matériaux par défaut</th></tr></thead><tbody>${tierRows}</tbody></table></div>${example(craftSay(result))}`)
    + (fillCount ? `<div class="acfg-alert"><b>${fillCount} recette${fillCount > 1 ? 's' : ''} peut être complétée automatiquement.</b><button type="button" class="acfg-link" data-action="_artCfgFillAll">Compléter automatiquement</button></div>` : '')
    + block('Recettes', 'Même nom de base, même catégorie de matériau : les variantes de rareté sont proposées en priorité.', recipes)
    + block('En cas d’échec', 'Choisis la part des matériaux rendue au personnage.', `${range('craft.fail', draft.craft.fail, 'Matériaux rendus')}${example(failSay(result))}`);
}

const GRID_META = {
  w1: { label: 'Arme 1 main', sub: 'Bouclier, baguette et main libre', unit: 'point' },
  w2: { label: 'Arme 2 mains', sub: 'Points de stats distribuables', unit: 'point' },
  amulette: { label: 'Amulette', sub: '+1 sur une stat distincte', unit: 'stat' },
  anneau: { label: 'Anneau', sub: '+1 sur chaque stat et sur l’effet', unit: 'amélioration', fixed: true },
};
function recomputeGrid(key) {
  const grid = draft.up.grids[key];
  grid.prices = grid.prices.map((_, index) => round10(grid.base * Math.pow(grid.mult, index)));
}
function gridRow(key) {
  const grid = draft.up.grids[key], meta = GRID_META[key];
  return `<div class="acfg-grid-row"><div><b>${meta.label}</b><small>${meta.sub} · plafond ${grid.prices.length}</small></div>${meta.fixed ? '<span class="acfg-muted">Plafond fixe</span>' : segmented(`up.grids.${key}.mode`, [['manuel', 'Manuel'], ['formule', 'Progression']], grid.mode)}<div class="acfg-prices">${grid.prices.map((price, index) => `<label><small>${meta.fixed ? 'chaque +1' : `+${index + 1} ${meta.unit}`}</small>${field(`up.grids.${key}.prices.${index}`, price, { min: 0, step: 10, unit: 'PO', readonly: grid.mode === 'formule' })}</label>`).join('')}${!meta.fixed ? `<span class="acfg-cap-buttons"><button type="button" data-action="_artCfgGridCap" data-grid="${key}" data-delta="-1" ${grid.prices.length <= 1 ? 'disabled' : ''}>−</button><button type="button" data-action="_artCfgGridCap" data-grid="${key}" data-delta="1" ${grid.prices.length >= 8 ? 'disabled' : ''}>+</button></span>` : ''}</div>${grid.mode === 'formule' && !meta.fixed ? `<div class="acfg-formula"><span>Base ${field(`up.grids.${key}.base`, grid.base, { step: 10, unit: 'PO' })}</span><span>× ${field(`up.grids.${key}.mult`, grid.mult, { min: 1, max: 5, step: .1, width: 46 })}</span></div>` : ''}<div class="acfg-grid-total"><small>Tout acheter</small><b>${po(grid.prices.reduce((a, b) => a + b, 0))}</b></div></div>`;
}
function effectiveCap(familyCap, rarityCap) { return Math.min(Math.max(0, +familyCap || 0), Math.max(0, +rarityCap || 0)); }
function renderAmeliorer() {
  const rarities = rarityList();
  const slots = [['arme', 'Armes'], ['armure', 'Armures'], ['anneau', 'Anneaux'], ['amulette', 'Amulettes'], ['objmag', 'Objets magiques']];
  const result = currentResult();
  const armorWarning = draft.up.armorMismatch ? `<div class="acfg-alert"><b>Les anciennes valeurs Tête, Torse et Pieds diffèrent.</b><button type="button" class="acfg-link" data-action="_artCfgArmorDetails">${draft.up.armorDetailed ? 'Utiliser une valeur commune' : 'Détailler par emplacement'}</button></div>` : '';
  const armorDetails = draft.up.armorDetailed ? `<div class="acfg-armor-details">${['Tête', 'Torse', 'Pieds'].map(slot => `<label>${slot}${stepper(`up.armorSlots.${slot}`, draft.up.armorSlots[slot])}</label>`).join('')}</div>` : '';
  const capsHeader = rarities.map(r => `<th>${rarityTag(r.value, false)}</th>`).join('');
  const capRow = (label, path, values) => `<tr><th>${label}</th>${rarities.map(r => `<td>${field(`${path}.${r.value}`, values[r.value] ?? 0, { min: 0, max: 8, width: 34 })}</td>`).join('')}</tr>`;
  const actualRows = [
    ['Arme 1 main · stats', draft.up.grids.w1.prices.length, 'stats'], ['Arme 2 mains · stats', draft.up.grids.w2.prices.length, 'stats'], ['Amulette · stats', draft.up.grids.amulette.prices.length, 'stats'],
    ...slots.map(([id, label]) => [`${label} · traits`, draft.up.slots[id], 'traits']),
  ];
  return block('Points de stats', 'Le nombre de cases de prix est le plafond réel. Manuel fixe chaque tarif ; Progression calcule base × multiplicateur.', `<div class="acfg-grids">${Object.keys(GRID_META).map(gridRow).join('')}<div class="acfg-grid-row is-disabled"><div><b>Armures et objets magiques</b><small>Pas de points de stats</small></div></div></div>`)
    + block('Traits', 'Poser un trait consomme un emplacement libre ; remplacer écrase un trait existant.', `<div class="acfg-lines"><div><span>Poser sur un emplacement libre</span>${field('up.traitAdd', draft.up.traitAdd, { step: 10, unit: 'PO' })}</div><div><span>Remplacer un trait</span>${field('up.traitRep', draft.up.traitRep, { step: 10, unit: 'PO' })}</div></div><h4 class="acfg-subtitle">Emplacements par famille</h4><div class="acfg-slots">${slots.map(([id, label]) => `<div><span>${label}</span>${stepper(`up.slots.${id}`, draft.up.slots[id])}</div>`).join('')}</div>${armorWarning}${armorDetails}`)
    + block('Plafonds par rareté', 'Le plafond effectif est le minimum entre la famille et la rareté.', `<div class="acfg-table-wrap"><table class="acfg-caps"><thead><tr><th>Plafond configuré</th>${capsHeader}</tr></thead><tbody>${capRow('Points de stats max', 'up.rcap.stats', draft.up.rcap.stats)}${capRow('Emplacements de traits max', 'up.rcap.traits', draft.up.rcap.traits)}<tr class="acfg-separator"><th colspan="${rarities.length + 1}">Plafond réel</th></tr>${actualRows.map(([label, familyCap, kind]) => `<tr><th>${label}</th>${rarities.map(r => { const value = effectiveCap(familyCap, draft.up.rcap[kind][r.value]); const limited = +draft.up.rcap[kind][r.value] < +familyCap; return `<td><span class="acfg-effective ${limited ? 'is-rarity' : ''}">${value}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><div class="acfg-legend"><span><i></i>Limité par la famille</span><span><i class="is-rarity"></i>Limité par la rareté</span></div>${example(`Au maximum : <b>${result.statCount}</b> amélioration${result.statCount > 1 ? 's' : ''} de stats et <b>${result.traitCount}</b> trait${result.traitCount > 1 ? 's' : ''}, soit <b>${po(result.upgradeTotal)}</b>.`)}`);
}

function renderReforger() {
  const result = currentResult();
  const targets = rarityList().filter(r => +r.value >= 2);
  const table = `<div class="acfg-table-wrap"><table class="acfg-reforge-table"><thead><tr><th>Rareté visée</th><th>Niveau de salle</th><th>Or</th><th>Matériaux</th></tr></thead><tbody>${targets.map(r => {
    const sample = +r.value === +result.reforge.target && result.reforge.quantity
      ? ` · ${result.reforge.quantity} × ${_esc(result.reforge.materialName || 'matériau ?')}` : '';
    return `<tr><th>${rarityTag(r.value)}</th><td>${segmented(`reforge.level.${r.value}`, [[1, 'I'], [2, 'II'], [3, 'III']], draft.reforge.level[r.value])}</td><td>${field(`reforge.gold.${r.value}`, draft.reforge.gold[r.value] || 0, { step: 10, unit: 'PO' })}</td><td><span class="acfg-muted">${draft.reforge.pct} % de la recette ${stars(Math.min(3, r.value))}${sample}</span></td></tr>`;
  }).join('')}</tbody></table></div>`;
  const roomCards = ARTISAN_DISCIPLINES.map(d => `<div class="acfg-room" style="--disc:${d.color}"><span>${d.label}</span><b>${_esc((rooms.find(room => room.slug === draft.disc[d.id].room)?.nom) || draft.disc[d.id].room || 'Aucune salle')}</b></div>`).join('');
  return block('Reforge', 'La reforge monte définitivement la rareté d’un cran.', `<div class="acfg-toggle-row"><button type="button" class="acfg-switch${draft.reforge.on ? ' is-on' : ''}" data-action="_artCfgSet" data-path="reforge.on" data-value="${!draft.reforge.on}"><i></i>${draft.reforge.on ? 'Activée' : 'Désactivée'}</button></div><div class="${draft.reforge.on ? '' : 'acfg-inert'}">${table}${range('reforge.pct', draft.reforge.pct, 'Part de la recette consommée')}${example(refSay(result))}</div>`)
    + block('Salles par discipline', 'La salle se choisit dans Bases et s’applique à toutes les catégories de la discipline.', `<div class="acfg-rooms">${roomCards}</div><button type="button" class="acfg-link" data-action="_artCfgTab" data-tab="bases">Modifier dans Bases</button>`);
}

function renderDemonter() {
  const result = currentResult();
  return block('Démonter', 'Démontage, recyclage et extraction des traits forment désormais une seule action.', `<div class="acfg-lines"><div><span>Coût du démontage</span>${field('dis.cost', draft.dis.cost, { step: 10, unit: 'PO' })}</div></div>${range('dis.pct', draft.dis.pct, 'Matériaux récupérés')}<div class="acfg-line-control"><span>Traits récupérés</span>${segmented('dis.all', [[false, 'Le 1er seulement'], [true, 'Tous']], draft.dis.all)}</div>${example(disSay(result))}`)
    + block('Revendre', 'Le changement vaut pour les ventes suivantes et utilise les tarifs actuels.', `${range('resale.pct', draft.resale.pct, 'Reprise des améliorations')}${example(resSay(result))}`);
}

function renderTab() {
  const tab = TABS.find(entry => entry.id === activeTab) || TABS[0];
  const render = { bases: renderBases, fabriquer: renderFabriquer, ameliorer: renderAmeliorer, reforger: renderReforger, demonter: renderDemonter }[tab.id];
  const warnings = warningMap()[tab.id];
  const alert = warnings.length ? `<div class="acfg-alert"><b>${warnings.length} point${warnings.length > 1 ? 's' : ''} à régler</b><span>${_esc(warnings.slice(0, 4).join(' · '))}${warnings.length > 4 ? ` · +${warnings.length - 4}` : ''}</span></div>` : '';
  return `<div class="acfg-content-head"><span>${tab.number === '◆' ? 'Commun à tout' : `Étape ${tab.number}`}</span><h2>${tab.label}</h2><p>${tab.lead}</p></div>${alert}${render()}`;
}

function renderSimulator() {
  const result = currentResult();
  const catOptions = ARTISAN_FAMILIES.map(family => `<optgroup label="${_esc(family.label)}">${(family.cats.length ? family.cats : ['objmag']).map(cat => `<option value="${cat}" ${cat === sim.category ? 'selected' : ''}>${_esc(cat === 'objmag' ? 'Objet magique' : categoryLabel(cat))}</option>`).join('')}</optgroup>`).join('');
  const rarityButtons = rarityList().map(r => `<button type="button" class="${+sim.rarity === +r.value ? 'is-active' : ''}" style="--rarity:${_esc(r.color || '#8a9bb4')}" data-action="_artCfgSim" data-key="rarity" data-value="${r.value}">${stars(r.value)}</button>`).join('');
  const steps = [
    ['fabriquer', '1', 'Fabriquer', craftSay(result), !result.craftable],
    ['ameliorer', '2', 'Améliorer au maximum', `${result.statCount} stats · ${result.traitCount} traits · <b>${po(result.upgradeTotal)}</b>`, !result.upgradeTotal],
    ['reforger', '3', 'Reforger', refSay(result), !result.reforge.applicable],
    ['demonter', '4', 'Démonter', disSay(result), false],
    ['demonter', '5', 'Revendre', resSay(result), !result.upgradeTotal || !draft.resale.pct],
  ];
  return `<aside class="acfg-simulator"><header><div><h3>Simulateur</h3><p>Suis un objet à travers tes réglages.</p></div><button type="button" data-action="_artCfgSimToggle">✕</button></header><div class="acfg-sim-pick"><select class="acfg-select" data-change="_artCfgSimSelect" data-key="category">${catOptions}</select>${result.family === 'arme' ? segmented('sim.format', [['w1', '1 main'], ['w2', '2 mains']], sim.format).replaceAll('data-action="_artCfgSet" data-path="sim.format"', 'data-action="_artCfgSim" data-key="format"') : ''}<div class="acfg-rarity-pick">${rarityButtons}</div><p>${result.noun[0].toUpperCase()}${result.noun.slice(1)} <b>${_esc(rarity(result.rarity)?.name || '')}</b></p></div><ol class="acfg-sim-steps">${steps.map(([tab, n, label, text, disabled]) => `<li class="${tab === activeTab ? 'is-active' : ''}${disabled ? ' is-disabled' : ''}" data-action="_artCfgTab" data-tab="${tab}"><span>${n}</span><div><b>${label}</b><p>${text}</p></div></li>`).join('')}</ol><footer><div><small>Or investi</small><b>${po(result.upgradeTotal)}</b></div><div><small>Repris à la revente</small><b>+${po(result.resale)}</b></div></footer></aside>`;
}

function labelOf(path) {
  const replacements = [
    [/^disc\.(\w+)\.skill$/, (_, d) => `Compétence · ${disc(d)?.label || d}`],
    [/^disc\.(\w+)\.room$/, (_, d) => `Salle · ${disc(d)?.label || d}`],
    [/^cats\.(\w+)$/, (_, c) => `Discipline · ${categoryLabel(c)}`],
    [/^craft\.dd\.(\d)$/, (_, t) => `DD ${stars(t)}`], [/^craft\.qty\.(\d)$/, (_, t) => `Quantité ${stars(t)}`],
    [/^recipes\.(\w+)\.(\d)\.mat$/, (_, c, t) => `Recette · ${categoryLabel(c)} ${stars(t)}`],
    [/^up\.grids\.(\w+)\.prices\.\d+$/, (_, g) => `Tarifs · ${GRID_META[g]?.label || g}`],
    [/^reforge\.gold\.(\d)$/, (_, r) => `Or de reforge ${stars(r)}`],
  ];
  for (const [pattern, factory] of replacements) if (pattern.test(path)) return path.replace(pattern, factory);
  return path.replaceAll('.', ' › ');
}
function valueOf(path, value) {
  if (value === true) return 'Oui'; if (value === false) return 'Non'; if (value == null || value === '') return '—';
  if (path.endsWith('.mat')) return materialName(value) || value;
  return String(value);
}
function differences() { return diffArtisanSettings(saved, draft); }
function renderChanges() {
  const diffs = differences();
  return `<div class="acfg-change-wrap"><button type="button" class="acfg-change${diffs.length ? ' has-changes' : ''}" data-action="_artCfgChanges" ${diffs.length ? '' : 'disabled'}>${diffs.length ? `<i></i>${diffs.length} modification${diffs.length > 1 ? 's' : ''}` : 'Aucune modification'}</button><div class="acfg-change-pop${changesOpen && diffs.length ? ' is-open' : ''}"><h4>Non enregistré</h4><ul>${diffs.map(diff => `<li><span>${_esc(labelOf(diff.path))}</span><span><s>${_esc(valueOf(diff.path, diff.from))}</s> → <b>${_esc(valueOf(diff.path, diff.to))}</b></span><button type="button" data-action="_artCfgUndo" data-path="${_esc(diff.path)}">↺</button></li>`).join('')}</ul></div></div>`;
}
function renderShell() {
  return `<div class="acfg"><header class="acfg-head"><div class="acfg-head-icon">⚒</div><div><h2>Artisanat</h2><small>Boutique · Gérer · réglages de l’aventure</small></div><span class="acfg-spacer"></span><div class="acfg-preset"><button type="button" class="acfg-btn" data-action="_artCfgPresetMenu">Économie type⌄</button><div class="acfg-preset-menu"><p>Les recettes, disciplines et plafonds ne bougent pas.</p>${ARTISAN_PRESETS.map(p => `<button type="button" data-action="_artCfgPreset" data-preset="${p.id}"><b>${p.label}</b><small>${p.hint}</small></button>`).join('')}</div></div><button type="button" class="acfg-btn acfg-sim-button" data-action="_artCfgSimToggle">Simulateur</button><button type="button" class="acfg-close" data-action="_artCfgClose">✕</button></header><div class="acfg-body">${renderNav()}<main class="acfg-content">${renderTab()}</main>${renderSimulator()}</div><footer class="acfg-footer"><button type="button" class="acfg-btn is-ghost" data-action="_artCfgReset">↻ Valeurs par défaut</button><span class="acfg-spacer"></span>${renderChanges()}<button type="button" class="acfg-btn" data-action="_artCfgCancel">Annuler</button><button type="button" class="acfg-btn is-primary" data-action="_artCfgSave" ${differences().length ? '' : 'disabled'}>Enregistrer</button></footer><div class="acfg-toast"></div><div class="acfg-sim-backdrop" data-action="_artCfgSimToggle"></div></div>`;
}

function render({ preserveScroll = true } = {}) {
  const body = document.getElementById('modal-body');
  const scroll = preserveScroll ? body?.querySelector('.acfg-content')?.scrollTop || 0 : 0;
  openModal('', renderShell());
  const content = document.querySelector('.acfg-content');
  if (content) content.scrollTop = scroll;
  setModalCloseGuard(closeGuard);
}
function renderPartial() {
  const root = document.querySelector('.acfg'); if (!root) return;
  const simulator = root.querySelector('.acfg-simulator');
  if (simulator) simulator.outerHTML = renderSimulator();
  const wrap = root.querySelector('.acfg-change-wrap');
  if (wrap) wrap.outerHTML = renderChanges();
  const save = root.querySelector('[data-action="_artCfgSave"]'); if (save) save.disabled = differences().length === 0;
  root.querySelectorAll('[data-path]').forEach(el => {
    const path = el.dataset.path;
    el.closest('.acfg-field,.acfg-seg,.acfg-stepper')?.classList.toggle('is-modified', !same(get(saved, path), get(draft, path)));
    if (el.matches('.acfg-select')) el.classList.toggle('is-modified', !same(get(saved, path), get(draft, path)));
  });
}
function toast(message, undo) {
  const el = document.querySelector('.acfg-toast'); if (!el) return;
  el.innerHTML = `<span>${message}</span>${undo ? '<button type="button" data-action="_artCfgToastUndo">Annuler</button>' : ''}`;
  el.classList.add('is-open'); el._undo = undo;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-open'), 5000);
}
function closeGuard() {
  if (!differences().length) return false;
  changesOpen = true; renderPartial(); toast('Enregistre ou annule les modifications avant de fermer.'); return true;
}

async function loadDependencies() {
  await Promise.all([loadCraftSettings(), loadUpgradeSettings(), loadRarities().catch(() => null)]);
  const [skillDoc, bastion, shopItems, categories] = await Promise.all([
    getDocData('world', 'dice_skills').catch(() => null), getDocData('bastion', 'main').catch(() => null),
    loadCollection('shop').catch(() => []), loadCollection('shopCategories').catch(() => []),
  ]);
  skills = normalizeDiceSkills(skillDoc?.skills || skillDoc?.list || skillDoc, DICE_SKILLS_DEFAULT);
  rooms = Array.isArray(bastion?.roomCatalog) ? bastion.roomCatalog : [];
  const materialCategoryIds = new Set((categories || []).filter(c => /mat[ée]riau|composant/i.test(c.nom || c.name || '')).map(c => c.id));
  const all = (shopItems || []).filter(item => item?.id && item?.nom);
  materials = all.filter(item => materialCategoryIds.has(item.categorieId));
  if (!materials.length) materials = all;
  materials = materials.map(item => ({ ...item, _artisanTier: rarityList().find(r => r.id === item.rarete)?.value || Number(item.rarete) || 0 })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  materialNames = Object.fromEntries(all.map(item => [item.id, item.nom]));
}

export async function openArtisanSettings(tab = 'bases') {
  await loadDependencies();
  craftBase = clone(getCraftSettings()); upgradeBase = clone(getUpgradeSettings());
  saved = mergeArtisanSettings(craftBase, upgradeBase); draft = clone(saved);
  changesOpen = false; loadLocal(tab); render({ preserveScroll: false });
}

async function save() {
  if (!differences().length) return;
  const { craft, upgrade } = splitArtisanSettings(draft, craftBase, upgradeBase);
  try {
    await Promise.all([saveCraftSettings(craft), saveUpgradeSettings(upgrade)]);
    invalidateCraftSettingsCache(); invalidateUpgradeSettingsCache();
    // Recharge immédiatement les caches avec les documents enregistrés, sans lecture Firestore.
    craftBase = craft; upgradeBase = upgrade; saved = mergeArtisanSettings(craft, upgrade); draft = clone(saved);
    clearModalCloseGuard(); closeModalDirect(); showNotif('Réglages de l’artisanat enregistrés.', 'success');
  } catch (error) { console.error('[artisan-settings] save', error); showNotif('Impossible d’enregistrer les réglages.', 'error'); }
}

registerActions({
  _artCfgTab: el => { activeTab = el.dataset.tab; saveLocal(); render({ preserveScroll: false }); },
  _artCfgField: el => {
    if (el.type === 'range') { put(draft, el.dataset.path, +el.value); const output = el.parentElement?.querySelector('output'); if (output) output.textContent = `${el.value} %`; }
    else if (el.value === '' && el.dataset.optional) put(draft, el.dataset.path, '');
    else if (el.value !== '') put(draft, el.dataset.path, Math.max(el.min !== '' ? +el.min : -Infinity, Math.min(el.max !== '' ? +el.max : Infinity, +el.value)));
    const match = el.dataset.path.match(/^up\.grids\.(\w+)\.(base|mult)$/); if (match) recomputeGrid(match[1]);
    renderPartial();
  },
  _artCfgSelect: el => { put(draft, el.dataset.path, el.value); render(); },
  _artCfgSet: el => {
    put(draft, el.dataset.path, JSON.parse(el.dataset.value));
    const mode = el.dataset.path.match(/^up\.grids\.(\w+)\.mode$/);
    if (mode && get(draft, el.dataset.path) === 'formule') { const grid = draft.up.grids[mode[1]]; grid.base = grid.prices[0] || 0; grid.mult = grid.prices[1] && grid.prices[0] ? Math.max(1, Math.round(grid.prices[1] / grid.prices[0] * 10) / 10) : 2; recomputeGrid(mode[1]); }
    render();
  },
  _artCfgStep: el => { const path = el.dataset.path, next = Math.max(0, Math.min(8, (+get(draft, path) || 0) + +el.dataset.delta)); put(draft, path, next); if (path === 'up.slots.armure' && !draft.up.armorDetailed) for (const slot of ['Tête', 'Torse', 'Pieds']) draft.up.armorSlots[slot] = next; render(); },
  _artCfgGridCap: el => {
    const grid = draft.up.grids[el.dataset.grid], delta = +el.dataset.delta;
    if (delta < 0 && grid.prices.length > 1) grid.prices.pop();
    if (delta > 0 && grid.prices.length < 8) { const last = grid.prices.at(-1) || 0, previous = grid.prices.at(-2) ?? 0; grid.prices.push(last + Math.max(10, last - previous)); }
    if (grid.mode === 'formule') recomputeGrid(el.dataset.grid); render();
  },
  _artCfgArmorDetails: () => { draft.up.armorDetailed = !draft.up.armorDetailed; if (!draft.up.armorDetailed) for (const slot of ['Tête', 'Torse', 'Pieds']) draft.up.armorSlots[slot] = draft.up.slots.armure; render(); },
  _artCfgFill: el => { const before = clone(draft); for (let tier = 1; tier <= draft.craft.maxTier; tier++) { if (draft.recipes?.[el.dataset.cat]?.[tier]?.mat) continue; const match = recipeAutoCandidate(el.dataset.cat, tier); if (match) put(draft, `recipes.${el.dataset.cat}.${tier}.mat`, match.id); } render(); toast('Recettes de la ligne complétées.', () => { draft = before; render(); }); },
  _artCfgFillAll: () => { const before = clone(draft); let count = 0; for (const cat of Object.keys(ARTISAN_CATEGORIES)) for (let tier = 1; tier <= draft.craft.maxTier; tier++) { if (draft.recipes?.[cat]?.[tier]?.mat) continue; const match = recipeAutoCandidate(cat, tier); if (match) { put(draft, `recipes.${cat}.${tier}.mat`, match.id); count++; } } render(); toast(`${count} recette${count > 1 ? 's' : ''} complétée${count > 1 ? 's' : ''}.`, () => { draft = before; render(); }); },
  _artCfgPresetMenu: el => el.closest('.acfg-preset')?.classList.toggle('is-open'),
  _artCfgPreset: el => { const before = clone(draft); draft = applyEconomyPreset(draft, el.dataset.preset); render(); toast(`Économie « ${ARTISAN_PRESETS.find(p => p.id === el.dataset.preset)?.label} » appliquée.`, () => { draft = before; render(); }); },
  _artCfgChanges: () => { changesOpen = !changesOpen; renderPartial(); },
  _artCfgUndo: el => { const path = el.dataset.path; const gridMatch = path.match(/^up\.grids\.(\w+)\.prices\./); if (gridMatch) put(draft, `up.grids.${gridMatch[1]}.prices`, clone(get(saved, `up.grids.${gridMatch[1]}.prices`))); else put(draft, path, clone(get(saved, path))); render(); },
  _artCfgReset: () => { const before = clone(draft); draft = mergeArtisanSettings({}, {}); render(); toast('Valeurs par défaut restaurées.', () => { draft = before; render(); }); },
  _artCfgCancel: () => { draft = clone(saved); clearModalCloseGuard(); closeModalDirect(); },
  _artCfgSave: () => save(),
  _artCfgClose: () => { if (!closeGuard()) { clearModalCloseGuard(); closeModalDirect(); } },
  _artCfgSim: el => { sim[el.dataset.key] = el.dataset.key === 'rarity' ? +el.dataset.value : JSON.parse(el.dataset.value); saveLocal(); renderPartial(); },
  _artCfgSimSelect: el => { sim[el.dataset.key] = el.value; saveLocal(); renderPartial(); },
  _artCfgSimToggle: () => document.querySelector('.acfg')?.classList.toggle('is-sim-open'),
  _artCfgToastUndo: el => { const toastEl = el.closest('.acfg-toast'); toastEl?._undo?.(); toastEl?.classList.remove('is-open'); },
});

// Menus légers : un clic ailleurs les referme sans reconstruire la modale.
document.addEventListener('click', event => {
  const root = document.querySelector('.acfg');
  if (!root) return;
  if (!event.target.closest('.acfg-preset')) root.querySelector('.acfg-preset')?.classList.remove('is-open');
  if (changesOpen && !event.target.closest('.acfg-change-wrap')) {
    changesOpen = false;
    root.querySelector('.acfg-change-pop')?.classList.remove('is-open');
  }
});
