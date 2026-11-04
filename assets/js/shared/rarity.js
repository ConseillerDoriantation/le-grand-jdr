import { registerActions } from '../core/actions.js';
import { STATE } from '../core/state.js';
import { batchSaveInCol, getDocData, loadCollection, saveDoc } from '../data/firestore.js';
import { openCatalogAdmin } from './catalog-admin.js';
import { catalogReplacementFor } from './catalog-admin-utils.js';
import { _esc } from './html.js';
import { notifySaveError } from './notifications.js';

const RARITY_DOC_ID = 'rarities';
const RARITY_VERSION = 1;

export const DEFAULT_RARITIES = [
    { value: 1, name: 'Commun',     color: '#9ca3af' },
    { value: 2, name: 'Singulier',  color: '#4ade80' },
    { value: 3, name: 'Rare',       color: '#60a5fa' },
    { value: 4, name: 'Mythique',   color: '#c084fc' },
    { value: 5, name: 'Légendaire', color: '#f97316' },
];

const rareteColors = {};

export const RARETE_NAMES = [''];
export const _RARETE_LABELS = [''];

let _rarities = [];
let _raritiesLoaded = false;
let _raritiesLoadPromise = null;

function _normalizeRarity(entry = {}, index = 0) {
    const value = Math.max(1, parseInt(entry.value ?? entry.niveau ?? entry.rank ?? (index + 1)) || (index + 1));
    return {
        value,
        name: String(entry.name || entry.label || entry.nom || `Rareté ${value}`).trim(),
        color: entry.color || entry.couleur || '#9ca3af',
    };
}

function _applyRarities(list = []) {
    _rarities = (Array.isArray(list) ? list : [])
        .map(_normalizeRarity)
        .filter(r => r.name)
        .sort((a, b) => a.value - b.value);

    RARETE_NAMES.splice(0, RARETE_NAMES.length, '');
    _RARETE_LABELS.splice(0, _RARETE_LABELS.length, '');
    Object.keys(rareteColors).forEach(k => delete rareteColors[k]);

    _rarities.forEach(r => {
        RARETE_NAMES[r.value] = r.name;
        _RARETE_LABELS[r.value] = `${'★'.repeat(r.value)} ${r.name}`;
        rareteColors[r.name] = r.color;
    });
}

_applyRarities(DEFAULT_RARITIES);

export function getRarities() {
    return _rarities.map(r => ({ ...r }));
}

export async function loadRarities({ refresh = false } = {}) {
    if (_raritiesLoaded && !refresh) return getRarities();
    if (_raritiesLoadPromise && !refresh) return _raritiesLoadPromise;

    _raritiesLoadPromise = (async () => {
        try {
            const doc = await getDocData('world', RARITY_DOC_ID);
            if (Array.isArray(doc?.rarities)) {
                _applyRarities(doc.rarities);
            } else {
                _applyRarities(DEFAULT_RARITIES);
            }
        } catch {
            _applyRarities(DEFAULT_RARITIES);
        } finally {
            _raritiesLoaded = true;
            _raritiesLoadPromise = null;
        }
        return getRarities();
    })();

    return _raritiesLoadPromise;
}

export function invalidateRaritiesCache() {
    _raritiesLoaded = false;
    _raritiesLoadPromise = null;
    _applyRarities(DEFAULT_RARITIES);
}

export async function saveRarities(rarities = [], { relatedUpdates = [] } = {}) {
    const clean = rarities.map(_normalizeRarity).filter(r => r.name).sort((a, b) => a.value - b.value);
    const payload = { version: RARITY_VERSION, rarities: clean };
    if (relatedUpdates.length) {
        const operations = [...relatedUpdates, { col: 'world', id: RARITY_DOC_ID, data: payload }];
        for (let index = 0; index < operations.length; index += 450) {
            await batchSaveInCol(operations.slice(index, index + 450));
        }
    } else {
        await saveDoc('world', RARITY_DOC_ID, payload);
    }
    _applyRarities(clean);
    _raritiesLoaded = true;
}

export function _rareteLabel(val) {
    return _RARETE_LABELS[parseInt(val) || 0] || '';
}

export function _rareteColor(r) {
    return rareteColors[r] || 'var(--text-dim)';
}

export function _rareteStars(val) {
    const n = parseInt(val) || 0;
    if (n <= 0) return '';
    const color = rareteColors[RARETE_NAMES[n]] || 'var(--text-dim)';
    const max = Math.max(5, ..._rarities.map(r => r.value));
    const stars = '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
    return `<span class="sh-rarete-stars" style="color:${color}" title="${RARETE_NAMES[n]}">${stars}</span>`;
}

// Retourne un chip coloré "★★★" avec la classe CSS fournie par l'appelant
export function _rareteTag(val, className = '') {
    const n = parseInt(val) || 0;
    if (n <= 0) return '';
    const color = rareteColors[RARETE_NAMES[n]] || 'var(--text-dim)';
    const max = Math.max(5, ..._rarities.map(r => r.value));
    const stars = '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
    return `<span${className ? ` class="${className}"` : ''} style="color:${color}">${stars}</span>`;
}

export function buildRaretePicker(idPrefix, currentVal) {
    const cur = parseInt(currentVal) || 0;
    const activeColor = rareteColors[RARETE_NAMES[cur]] || '#c084fc';
    const values = _rarities.map(r => r.value);
    if (!values.length) {
        return `
        <div class="sh-rarete-picker" id="${idPrefix}-rarete-wrap">
            <input type="hidden" id="${idPrefix}-rarete" value="">
            <span class="sh-rarete-label" id="${idPrefix}-rarete-lbl">Aucune rareté définie</span>
        </div>`;
    }
    return `
        <div class="sh-rarete-picker" id="${idPrefix}-rarete-wrap">
            ${values.map(n => `<button type="button" class="sh-rarete-star-btn" data-val="${n}"
                data-action="pickRarete" data-prefix="${idPrefix}"
                style="color:${cur >= n ? activeColor : 'var(--text-dim)'}">★</button>`).join('')}
            <input type="hidden" id="${idPrefix}-rarete" value="${currentVal || ''}">
            <span class="sh-rarete-label" id="${idPrefix}-rarete-lbl" style="color:${activeColor || 'var(--text-dim)'}">${_rareteLabel(currentVal)}</span>
        </div>`;
}

export function pickRarete(idPrefix, n) {
    const h = document.getElementById(`${idPrefix}-rarete`);
    const l = document.getElementById(`${idPrefix}-rarete-lbl`);
    const activeColor = rareteColors[RARETE_NAMES[n]] || 'var(--text-dim)';

    if (h) h.value = n;
    if (l) { l.textContent = _RARETE_LABELS[n] || ''; l.style.color = activeColor; }
    const wrap = document.getElementById(`${idPrefix}-rarete-wrap`);
    (wrap ? wrap.querySelectorAll('.sh-rarete-star-btn') : []).forEach(btn => {
        const v = parseInt(btn.dataset.val);
        btn.classList.toggle('active', v <= n);
        btn.style.color = v <= n ? activeColor : 'var(--text-dim)';
    });
}

const RARITY_PALETTE = ['#9ca3af', '#4ade80', '#60a5fa', '#c084fc', '#f97316', '#facc15', '#22d3ee', '#fb7185'];
let _rarityCatalogOriginal = [];
let _rarityCatalogUsage = [];

const _rarityCatalogId = value => `rarity_${Math.max(1, parseInt(value) || 1)}`;
const _clone = value => JSON.parse(JSON.stringify(value));

async function _loadRarityCatalog() {
    await loadRarities();
    _rarityCatalogOriginal = getRarities().map(rarity => ({
        id: _rarityCatalogId(rarity.value),
        value: rarity.value,
        label: rarity.name,
        color: rarity.color,
        enabled: true,
    }));
    return _clone(_rarityCatalogOriginal);
}

async function _loadRarityUsage(items = _rarityCatalogOriginal) {
    _rarityCatalogUsage = await loadCollection('shop');
    const idByValue = new Map(items.map(item => [Number(item.value), item.id]));
    const counts = Object.fromEntries(items.map(item => [item.id, 0]));
    _rarityCatalogUsage.forEach(article => {
        const id = idByValue.get(Number(article.rarete));
        if (id) counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
}

function _remapRarityValue(value, nextById, reassign = []) {
    const original = _rarityCatalogOriginal.find(item => Number(item.value) === Number(value));
    if (!original) return Number(value) || 0;
    const targetId = nextById.has(original.id)
        ? original.id
        : catalogReplacementFor(original.id, reassign) || [...nextById.keys()][0];
    return nextById.get(targetId) || 0;
}

function _remapEquipmentRarity(equipement = {}, nextById, reassign) {
    let changed = false;
    const next = Object.fromEntries(Object.entries(equipement || {}).map(([slot, item]) => {
        if (!item || typeof item !== 'object') return [slot, item];
        const rarete = _remapRarityValue(item.rarete, nextById, reassign);
        if (rarete === (Number(item.rarete) || 0)) return [slot, item];
        changed = true;
        return [slot, { ...item, rarete }];
    }));
    return { changed, value: changed ? next : equipement };
}

async function _saveRarityCatalog(draft, { reassign = [] } = {}) {
    const saved = draft.map((item, index) => ({ ...item, value: index + 1 }));
    const nextById = new Map(saved.map(item => [item.id, item.value]));
    const updates = [];

    _rarityCatalogUsage.forEach(article => {
        const rarete = _remapRarityValue(article.rarete, nextById, reassign);
        if (rarete === (Number(article.rarete) || 0)) return;
        article.rarete = rarete;
        updates.push({ col: 'shop', id: article.id, data: { rarete } });
    });

    (STATE.characters || []).forEach(character => {
        let invChanged = false;
        const inventaire = (character.inventaire || []).map(item => {
            if (!item || typeof item !== 'object') return item;
            const rarete = _remapRarityValue(item.rarete, nextById, reassign);
            if (rarete === (Number(item.rarete) || 0)) return item;
            invChanged = true;
            return { ...item, rarete };
        });
        const equip = _remapEquipmentRarity(character.equipement, nextById, reassign);
        let buildsChanged = false;
        const builds = (character.builds || []).map(build => {
            const buildEquip = _remapEquipmentRarity(build?.equipement, nextById, reassign);
            if (!buildEquip.changed) return build;
            buildsChanged = true;
            return { ...build, equipement: buildEquip.value };
        });
        if (!invChanged && !equip.changed && !buildsChanged) return;
        const data = {};
        if (invChanged) { data.inventaire = inventaire; character.inventaire = inventaire; }
        if (equip.changed) { data.equipement = equip.value; character.equipement = equip.value; }
        if (buildsChanged) { data.builds = builds; character.builds = builds; }
        updates.push({ col: 'characters', id: character.id, data });
    });

    const rarities = saved.map(item => ({ value: item.value, name: item.label.trim(), color: item.color }));
    await saveRarities(rarities, { relatedUpdates: updates });
    _rarityCatalogOriginal = _clone(saved);
    return saved;
}

export async function openRaritiesAdmin() {
    if (!STATE.isAdmin) return;
    return openCatalogAdmin({
        kind: 'rarity', icon: '★', accent: '#c084fc',
        title: 'Raretés d’objets',
        sub: 'Boutique, inventaires et objets de cette aventure.',
        noun: ['rareté', 'raretés'], fem: true,
        item: ['article', 'articles'], itemFem: false, all: 'Toutes',
        emoji: false, plural: false, idPrefix: 'rarity_',
        defaultNote: 'L’ordre définit le niveau : la première rareté vaut 1 étoile.',
        palette: RARITY_PALETTE,
        load: _loadRarityCatalog,
        count: _loadRarityUsage,
        save: _saveRarityCatalog,
        reassignInSave: true,
        rowStatus: (_item, index) => [`Niveau ${index + 1}`, 'default'],
        sample: () => {
            const article = _rarityCatalogUsage.find(item => Number(item.rarete) > 0) || _rarityCatalogUsage[0] || {};
            return {
                title: article.nom || 'Objet de la boutique',
                subtitle: [article.type || article.template, article.sousType || article.format].filter(Boolean).join(' · ') || 'Article de l’aventure',
                meta: article.prix != null ? `${article.prix} or` : 'Prix · Stock · Propriétés',
            };
        },
        onError: notifySaveError,
    });
}

registerActions({
  pickRarete: (btn) => pickRarete(btn.dataset.prefix, Number(btn.dataset.val)),
});
