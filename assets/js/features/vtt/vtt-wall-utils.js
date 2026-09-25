export const VTT_STRUCTURE_STYLE = Object.freeze({
  casing:'#05080f', wall:'#b9c3d3', wood:'#c98a3a', glass:'#8fdcff', lock:'#ff5a7e',
});

export const VTT_WALL_TYPES = Object.freeze({
  wall: Object.freeze({
    type: 'wall', label: 'Mur', icon: '🧱', color: VTT_STRUCTURE_STYLE.wall, editColor: '#ef4444', width: 5.5,
    blocksVision: true, blocksMovement: true, canOpen: false,
  }),
  door: Object.freeze({
    type: 'door', label: 'Porte', icon: '🚪', color: VTT_STRUCTURE_STYLE.wood, editColor: '#fb923c', width: 9,
    blocksVision: true, blocksMovement: true, canOpen: true,
  }),
  window: Object.freeze({
    type: 'window', label: 'Vitre', icon: '◇', color: VTT_STRUCTURE_STYLE.glass, editColor: '#67e8f9', width: 8,
    blocksVision: false, blocksMovement: true, canOpen: true,
  }),
});

/** Métadonnées de lecture communes à la carte, la barre et le menu d'édition. */
export function vttWallState(wall = {}) {
  const meta = VTT_WALL_TYPES[wall.type] || VTT_WALL_TYPES.wall;
  const open = meta.canOpen && wall.open === true;
  const locked = meta.canOpen && wall.locked === true;
  return {
    ...meta,
    open,
    locked,
    stateLabel: !meta.canOpen ? 'Solide' : open ? 'Ouverte' : 'Fermée',
    stateShort: !meta.canOpen ? '' : open ? 'OUVERTE' : 'FERMÉE',
    blocksVision: meta.blocksVision && !open,
    blocksMovement: meta.blocksMovement && !open,
  };
}

/** Aperçus SVG de la légende, alimentés par les mêmes couleurs que Konva. */
export function vttStructureLegendSvg(kind) {
  const S = VTT_STRUCTURE_STYLE;
  const base = 'viewBox="0 0 64 26" aria-hidden="true"';
  const jambs = `<path d="M8 5v16M56 5v16" stroke="${S.casing}" stroke-width="7" stroke-linecap="round"/><path d="M8 5v16M56 5v16" stroke="${S.wall}" stroke-width="3.5" stroke-linecap="round"/>`;
  const lock = `<g transform="translate(32 13)"><circle r="10" fill="#0a0f18" stroke="${S.lock}" stroke-width="2"/><path d="M-3-1v-3a3 3 0 016 0v3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><rect x="-5" y="-1" width="10" height="7" rx="1.5" fill="#fff"/><circle cy="2.2" r="1" fill="#0a0f18"/></g>`;
  let shape = '';
  if (kind === 'wall') shape = `<path d="M7 13h50" stroke="${S.casing}" stroke-width="10" stroke-linecap="round"/><path d="M7 13h50" stroke="${S.wall}" stroke-width="5.5" stroke-linecap="round"/>`;
  else if (kind === 'door-closed' || kind === 'locked') shape = `${jambs}<path d="M13 13h38" stroke="${S.casing}" stroke-width="12"/><path d="M13 13h38" stroke="${S.wood}" stroke-width="9"/>${kind === 'locked' ? lock : ''}`;
  else if (kind === 'door-open') shape = `${jambs}<path d="M13 13h38" stroke="${S.wood}" stroke-width="1.5" stroke-dasharray="3 5" opacity=".55"/><path d="M13 13V2" stroke="${S.casing}" stroke-width="11"/><path d="M13 13V2" stroke="${S.wood}" stroke-width="8"/><path d="M51 13A38 38 0 0013-25" fill="none" stroke="${S.wood}" stroke-width="1.4" stroke-dasharray="3 4" opacity=".7"/>`;
  else if (kind === 'window-closed') shape = `${jambs}<rect x="13" y="9" width="38" height="8" fill="rgba(143,220,255,.28)" stroke="${S.glass}" stroke-width="1.8"/><path d="M32 9v8" stroke="${S.glass}" stroke-width="1.8"/>`;
  else if (kind === 'window-open') shape = `${jambs}<path d="M13 13h38" stroke="${S.glass}" stroke-width="1.2" stroke-dasharray="2 5" opacity=".5"/><rect x="13" y="7" width="13" height="5" fill="rgba(143,220,255,.28)" stroke="${S.glass}" stroke-width="1.5"/><rect x="38" y="14" width="13" height="5" fill="rgba(143,220,255,.28)" stroke="${S.glass}" stroke-width="1.5"/>`;
  return `<svg ${base}>${shape}</svg>`;
}
