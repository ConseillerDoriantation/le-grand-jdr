import { registerActions } from '../core/actions.js';
import { STATE } from '../core/state.js';
import { getDocData, saveDoc } from '../data/firestore.js';
import { _esc } from './html.js';
import { closeModalDirect, openModal } from './modal.js';
import { notifySaveError, showNotif } from './notifications.js';

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

export async function saveRarities(rarities = []) {
    const clean = rarities.map(_normalizeRarity).filter(r => r.name).sort((a, b) => a.value - b.value);
    await saveDoc('world', RARITY_DOC_ID, { version: RARITY_VERSION, rarities: clean });
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

function _rarityRowHtml(r = {}, idx = 0) {
    return `
    <div class="rar-admin-row" data-rar-row>
        <input class="input-field" data-rar-value type="number" min="1" value="${parseInt(r.value) || idx + 1}" title="Niveau">
        <input class="input-field" data-rar-name value="${_esc(r.name || '')}" placeholder="Nom de rareté">
        <input class="input-field" data-rar-color type="color" value="${_esc(r.color || '#9ca3af')}" title="Couleur">
        <button type="button" class="btn btn-outline btn-sm" data-action="rarityRemoveRow" title="Supprimer">✕</button>
    </div>`;
}

export async function openRaritiesAdmin() {
    if (!STATE.isAdmin) return;
    await loadRarities();
    const rows = getRarities();
    openModal('Raretés', `
      <div class="rar-admin">
        <p class="sh-admin-section-hint" style="margin-top:0">
          Ces raretés appartiennent à l'aventure courante. Sans personnalisation, l'aventure utilise les valeurs standards.
        </p>
        <div class="rar-admin-list" id="rar-admin-list">
          ${rows.map(_rarityRowHtml).join('') || '<div class="rar-admin-empty">Aucune rareté définie.</div>'}
        </div>
        <div class="sh-admin-footer" style="padding:12px 0 0">
          <button type="button" class="btn btn-outline btn-sm" data-action="rarityAddRow">＋ Ajouter</button>
          <div class="sh-admin-footer-spacer"></div>
          <button type="button" class="btn btn-outline btn-sm" data-action="raritySeedDefaults">Valeurs Le Grand JDR</button>
          <button type="button" class="btn btn-gold btn-sm" data-action="raritySave">Enregistrer</button>
        </div>
      </div>`, { subtitle: 'Noms, ordre et couleurs des raretés', accent: '#c084fc' });
}

function _rarityRowsFromDom() {
    return [...document.querySelectorAll('[data-rar-row]')].map((row, idx) => ({
        value: parseInt(row.querySelector('[data-rar-value]')?.value) || (idx + 1),
        name: row.querySelector('[data-rar-name]')?.value?.trim() || '',
        color: row.querySelector('[data-rar-color]')?.value || '#9ca3af',
    })).filter(r => r.name);
}

function _rarityRenderRows(rows = []) {
    const host = document.getElementById('rar-admin-list');
    if (!host) return;
    host.innerHTML = rows.length
        ? rows.map(_rarityRowHtml).join('')
        : '<div class="rar-admin-empty">Aucune rareté définie.</div>';
}

registerActions({
  pickRarete: (btn) => pickRarete(btn.dataset.prefix, Number(btn.dataset.val)),
  rarityAddRow: () => {
    const rows = _rarityRowsFromDom();
    const nextValue = rows.reduce((m, r) => Math.max(m, parseInt(r.value) || 0), 0) + 1;
    _rarityRenderRows([...rows, { value: nextValue, name: '', color: '#9ca3af' }]);
  },
  rarityRemoveRow: (btn) => {
    btn.closest('[data-rar-row]')?.remove();
    if (!document.querySelector('[data-rar-row]')) _rarityRenderRows([]);
  },
  raritySeedDefaults: () => _rarityRenderRows(DEFAULT_RARITIES),
  raritySave: async () => {
    try {
      await saveRarities(_rarityRowsFromDom());
      closeModalDirect();
      showNotif('Raretés enregistrées.', 'success');
    } catch (e) {
      notifySaveError(e);
    }
  },
});
