export const VTT_WALL_TYPES = Object.freeze({
  wall: Object.freeze({
    type: 'wall', label: 'Mur', icon: '🧱', color: '#64748b', editColor: '#ef4444', width: 4,
    blocksVision: true, blocksMovement: true, canOpen: false,
  }),
  door: Object.freeze({
    type: 'door', label: 'Porte', icon: '🚪', color: '#f97316', editColor: '#fb923c', width: 4,
    blocksVision: true, blocksMovement: true, canOpen: true,
  }),
  window: Object.freeze({
    type: 'window', label: 'Vitre', icon: '◇', color: '#38bdf8', editColor: '#67e8f9', width: 3,
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
