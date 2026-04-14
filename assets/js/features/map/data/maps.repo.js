// Accès aux métadonnées de la carte (image, nom) + zones de fog.
// Schéma historique conservé : world/map et world/map_fog.
import { getDocData, saveDoc } from '../../../data/firestore.js';

export async function loadMap(mapId = 'world') {
  const doc = await getDocData('world', 'map');
  return {
    id: mapId,
    imageUrl: doc?.imageUrl || '',
    regionName: doc?.regionName || '',
    ...(doc || {}),
  };
}

export async function saveMap(data) {
  await saveDoc('world', 'map', data);
}

export async function loadFogZones() {
  const fog = await getDocData('world', 'map_fog');
  // On ignore l'ancien format circulaire {x,y,r}, on ne garde que les polygones
  return (fog?.zones || []).filter(z => Array.isArray(z.pts));
}

export async function saveFogZones(zones) {
  await saveDoc('world', 'map_fog', { zones });
}
