// ══════════════════════════════════════════════════════════════════════════════
// VTT-RUNE-SIGIL.JS — Sceau runique génératif (effet signature au lancement d'un sort)
// ══════════════════════════════════════════════════════════════════════════════
// Le sceau est DESSINÉ à partir de la composition réelle du sort : la couleur vient
// de l'élément, la géométrie des runes (Puissance = étoile à pointes, Protection =
// anneaux concentriques, Dispersion = sceau scindé, Durée = bande rotative,
// Concentration = cœur pulsant, Chance = étincelles, Affliction = anneau brisé,
// Invocation = iris de portail), la forme/mouvement de la catégorie. Deux sorts de
// compositions différentes donnent donc deux sceaux visuellement distincts.
//
// Module feuille : pur (buildSigilSvg) + un lecteur d'overlay DOM (playSigil) posé
// au-dessus du canvas. Aucune dépendance VTT — l'appelant fournit position + taille.
// ══════════════════════════════════════════════════════════════════════════════

let _sigilSeq = 0;

const _pol = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

function _starPath(cx, cy, R, r, pts) {
  let d = '';
  for (let i = 0; i < pts * 2; i++) {
    const a = Math.PI * i / pts - Math.PI / 2;
    const [x, y] = _pol(cx, cy, i % 2 ? r : R, a);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d + 'Z';
}

/**
 * Construit le SVG du sceau à partir de la composition du sort.
 * @param {{color?:string, runes?:string[], category?:string}} spell
 *   color : couleur de l'élément · runes : tableau de noms de runes (répétés selon
 *   le nombre) · category : 'attack' | 'heal' | 'buff' | 'affliction' | 'summon'.
 */
export function buildSigilSvg({ color = '#4f8cff', runes = [], category = 'attack' } = {}) {
  const r = {};
  (Array.isArray(runes) ? runes : []).forEach(n => { r[n] = (r[n] || 0) + 1; });
  const C = 110;
  const total = Object.values(r).reduce((s, n) => s + n, 0);
  const R = Math.min(94, 64 + (r.Amplification || 0) * 11);
  const uid = ++_sigilSeq;
  let g = '';

  // Flash de halo à l'apparition (présence), joué une fois — trait fin.
  g += `<circle class="sig-flash" cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="2.4"/>`;

  if (r['Durée']) {
    g += `<g class="sig-spin"><circle cx="${C}" cy="${C}" r="${R + 11}" fill="none" stroke="${color}" stroke-width="1.3" stroke-dasharray="3 9" opacity=".6"/></g>`;
  }
  const dash = r.Affliction ? `stroke-dasharray="${6 + r.Affliction * 3} ${4 + r.Affliction * 2}"` : '';
  g += `<g class="sig-spinr"><circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="2.2" opacity="1" ${dash}/>`;
  for (let i = 0; i < total; i++) {
    const a = 2 * Math.PI * i / Math.max(total, 1) - Math.PI / 2;
    const [x, y] = _pol(C, C, R, a);
    const deg = a * 180 / Math.PI + 90;
    g += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})"><line x1="0" y1="-7" x2="0" y2="7" stroke="${color}" stroke-width="2"/><rect x="-3.5" y="-3.5" width="7" height="7" transform="rotate(45)" fill="none" stroke="${color}" stroke-width="1.7"/></g>`;
  }
  g += '</g>';

  for (let k = 0; k < (r.Protection || 0); k++) {
    g += `<circle cx="${C}" cy="${C}" r="${(R * (0.78 - k * 0.16)).toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.6" opacity=".6"/>`;
  }
  if (r.Puissance) {
    const pts = 3 + r.Puissance * 2;
    g += `<g class="sig-spin"><path d="${_starPath(C, C, R * 0.5, R * 0.2, pts)}" fill="none" stroke="${color}" stroke-width="1.9" stroke-linejoin="round" opacity=".95"/></g>`;
  }
  for (let k = 1; k <= (r.Dispersion || 0); k++) {
    const a = 2 * Math.PI * k / (r.Dispersion + 1) - Math.PI / 2;
    const [x, y] = _pol(C, C, R + 22, a);
    g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="none" stroke="${color}" stroke-width="1.7" opacity=".8"/>`;
  }
  if (r.Chance) {
    g += '<g class="sig-orbit">';
    for (let k = 0; k < r.Chance + 2; k++) {
      const a = 2 * Math.PI * k / (r.Chance + 2);
      const [x, y] = _pol(C, C, R * 0.62, a);
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"/>`;
    }
    g += '</g>';
  }
  if (r.Invocation) {
    g += `<defs><radialGradient id="sig-iris-${uid}"><stop offset="0%" stop-color="${color}" stop-opacity=".95"/><stop offset="70%" stop-color="${color}" stop-opacity=".18"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>`
       + `<circle cx="${C}" cy="${C}" r="${R * 0.56}" fill="url(#sig-iris-${uid})"/>`
       + `<circle class="sig-core" cx="${C}" cy="${C}" r="${R * 0.28}" fill="none" stroke="${color}" stroke-width="2"/>`;
  } else if (r.Concentration) {
    g += `<circle class="sig-core" cx="${C}" cy="${C}" r="${(R * 0.22).toFixed(1)}" fill="${color}" opacity=".9"/>`;
  } else {
    g += `<circle cx="${C}" cy="${C}" r="4" fill="${color}"/>`;
  }

  if (category === 'attack') {
    for (let k = 0; k < 8; k++) {
      const a = 2 * Math.PI * k / 8;
      const [x1, y1] = _pol(C, C, R + 3, a);
      const [x2, y2] = _pol(C, C, R + 14, a);
      g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`;
    }
  } else if (category === 'heal') {
    for (let k = 0; k < 3; k++) {
      g += `<g class="sig-rise" style="animation-delay:${k * 0.35}s" transform="translate(${C - 20 + k * 20} ${C})"><path d="M0 -5 V5 M-5 0 H5" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/></g>`;
    }
  } else if (category === 'buff') {
    g += `<circle cx="${C}" cy="${C}" r="${R + 6}" fill="none" stroke="${color}" stroke-width="1.4" opacity=".45"/>`;
  }

  return `<svg viewBox="0 0 220 220" width="100%" height="100%" aria-hidden="true" style="filter:drop-shadow(0 0 8px ${color}) drop-shadow(0 0 2px ${color})">${g}</svg>`;
}

/**
 * Joue le sceau en overlay au-dessus du canvas, à la position écran donnée.
 * Effet transitoire (~1,5 s) auto-nettoyé. L'appelant fournit le conteneur (div du
 * stage Konva), la position en pixels (centre) et la taille.
 */
export function playSigil(container, x, y, size, spell) {
  if (!container) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let layer = container.querySelector('.vtt-sigil-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'vtt-sigil-layer';
    container.appendChild(layer);
  }
  const el = document.createElement('div');
  el.className = 'vtt-sigil-fx vtt-sigil-fx--' + (spell?.category || 'attack');
  const s = Math.max(110, Math.min(560, size || 200));
  el.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px`;
  el.innerHTML = buildSigilSvg(spell || {});
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 7000);   // filet de sécurité (> durée d'anim)
}
