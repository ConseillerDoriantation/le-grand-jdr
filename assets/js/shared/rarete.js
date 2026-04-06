const rareteColors = {
    'Commun':    '#9ca3af',
    'Peu commun':'#4ade80',
    'Rare':      '#60a5fa',
    'Très rare': '#c084fc',
    'Légendaire':'#fbbf24',
};

export const RARETE_NAMES = ['', 'Commun', 'Peu commun', 'Rare', 'Très rare'];

export const _RARETE_LABELS = ['', '★ Commun', '★★ Peu commun', '★★★ Rare', '★★★★ Très rare'];

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
    const stars = '★'.repeat(n) + '☆'.repeat(4 - n);
    return `<span class="sh-rarete-stars" style="color:${color}" title="${RARETE_NAMES[n]}">${stars}</span>`;
}

// Retourne un chip coloré "★★★" avec la classe CSS fournie par l'appelant
export function _rareteTag(val, className = '') {
    const n = parseInt(val) || 0;
    if (n <= 0) return '';
    const color = rareteColors[RARETE_NAMES[n]] || 'var(--text-dim)';
    const stars = '★'.repeat(n) + '☆'.repeat(4 - n);
    return `<span${className ? ` class="${className}"` : ''} style="color:${color}">${stars}</span>`;
}

export function buildRaretePicker(idPrefix, currentVal) {
    const cur = parseInt(currentVal) || 0;
    const activeColor = rareteColors[RARETE_NAMES[cur]] || '#c084fc';
    return `
        <div class="sh-rarete-picker" id="${idPrefix}-rarete-wrap">
            ${[1, 2, 3, 4].map(n => `<button type="button" class="sh-rarete-star-btn" data-val="${n}"
                onclick="pickRarete('${idPrefix}', ${n})"
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

window.pickRarete = pickRarete;
