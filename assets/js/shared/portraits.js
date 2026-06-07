import { _esc } from './html.js';

const COLORS = ['#4f8cff', '#22c38e', '#e8b84b', '#ff6b6b', '#b47fff', '#f59e0b'];

export function characterInitial(c = {}) {
  return String(c?.nom || c?.name || c?.pseudo || '?').charAt(0).toUpperCase() || '?';
}

export function characterColor(c = {}, colors = COLORS) {
  const s = String(c?.nom || c?.name || c?.pseudo || '?');
  return colors[(s.charCodeAt(0) || 0) % colors.length] || colors[0];
}

export function characterPhotoPosition(c = {}) {
  return `${50 + (Number(c?.photoX) || 0) * 50}% ${50 + (Number(c?.photoY) || 0) * 50}%`;
}

export function characterPortraitContent(c = {}, opts = {}) {
  const {
    imgClass = '', imgStyle = 'width:100%;height:100%;object-fit:cover',
    fallbackTag = 'span', fallbackClass = '', fallbackStyle = '',
    fallbackText = null, escapePhoto = true,
  } = opts;
  if (c?.photo) {
    const cls = imgClass ? ` class="${_esc(imgClass)}"` : '';
    const src = escapePhoto ? _esc(c.photo) : c.photo;
    // loading lazy + decoding async : les portraits (souvent lourds en base64) ne
    // bloquent pas le rendu/scroll → moins de « gel » à l'arrivée des données.
    return `<img src="${src}"${cls} loading="lazy" decoding="async" style="${imgStyle};object-position:${characterPhotoPosition(c)}">`;
  }
  const cls = fallbackClass ? ` class="${_esc(fallbackClass)}"` : '';
  const st = fallbackStyle ? ` style="${fallbackStyle}"` : '';
  return `<${fallbackTag}${cls}${st}>${_esc(fallbackText ?? characterInitial(c))}</${fallbackTag}>`;
}

export function characterAvatarHtml(c = {}, opts = {}) {
  const {
    size = 28, className = '', tag = 'div', title = null,
    color = null, border = '2px solid var(--bg-card)', background = null,
    style = '', imgClass = '', imgStyle = 'width:100%;height:100%;object-fit:cover',
    fallbackClass = '', fallbackStyle = '', fallbackText = null, radius = '50%',
  } = opts;
  const px = typeof size === 'number' ? `${size}px` : String(size || '28px');
  const col = color || characterColor(c);
  const cls = className ? ` class="${_esc(className)}"` : '';
  const ttl = title === false ? '' : ` title="${_esc(title ?? c?.nom ?? c?.pseudo ?? '?')}"`;
  const base = `width:${px};height:${px};border-radius:${radius};overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${background || `${col}18`};border:${border};color:${col}${style ? ';' + style : ''}`;
  const fallback = fallbackStyle || `font-family:'Cinzel',serif;font-weight:700;font-size:${Math.max(10, Math.round(parseInt(px) * 0.38))}px;color:${col}`;
  return `<${tag}${cls}${ttl} style="${base}">${characterPortraitContent(c, { imgClass, imgStyle, fallbackClass, fallbackText, fallbackStyle: fallback })}</${tag}>`;
}
