import { _esc } from './html.js';

export function spellTypeBadges(types = [], { className = '', stylePrefix = '' } = {}) {
  return types.map(t => {
    const col = t === 'offensif' ? '#ff6b6b' : t === 'defensif' ? '#22c38e' : '#b47fff';
    return className
      ? '<span class="' + className + '" style="' + stylePrefix + col + '">' + _esc(t) + '</span>'
      : '<span style="font-size:.6rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;color:' + col + ';background:' + col + '1a;border:1px solid ' + col + '55">' + _esc(t) + '</span>';
  }).join(' ');
}

export function runeBadges(runes = [], { className = '' } = {}) {
  const counts = {};
  runes.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return Object.entries(counts).map(([r, n]) =>
    className
      ? '<span class="' + className + '">' + _esc(r) + (n > 1 ? `×${n}` : '') + '</span>'
      : '<span style="font-size:.62rem;font-weight:600;padding:.1rem .4rem;border-radius:5px;background:rgba(168,127,255,.12);color:#c4b5fd;border:1px solid rgba(168,127,255,.3)">' + _esc(r) + (n > 1 ? `×${n}` : '') + '</span>'
  ).join(' ');
}

export function spellActionCardHtml(act, idx, { className, actionAttr, style = '' } = {}) {
  const a = act || {};
  const typeBadges = spellTypeBadges(a.types || []);
  const runes = runeBadges(a.runes || []);
  const editAttr = `${actionAttr}="editAction"`;
  const removeAttr = `${actionAttr}="removeAction"`;
  return `
    <div class="${className}"${style ? ` style="${style}"` : ''}>
      <span style="font-size:1.3rem;flex-shrink:0">${_esc(a.icon || '🔮')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.85rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(a.nom || 'Sans nom')}</div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.2rem">
          ${typeBadges}${runes}
          ${a.noyau ? `<span style="font-size:.62rem;color:var(--text-dim)">⚛ ${_esc(a.noyau)}</span>` : ''}
          <span style="font-size:.62rem;color:#b47fff">${a.pmOverride ?? a.pm ?? '?'} PM</span>
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" ${editAttr} data-idx="${idx}" title="Modifier">✏️</button>
      <button type="button" class="btn-icon" ${removeAttr} data-idx="${idx}" title="Supprimer" style="color:#ef4444">🗑</button>
    </div>`;
}
