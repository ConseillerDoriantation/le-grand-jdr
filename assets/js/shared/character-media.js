// Images originales des personnages, séparées du document `characters`.
// Firestore limite chaque document à 1 Mio : la fiche conserve uniquement le
// portrait recadré léger, tandis que l'image avant cadrage vit ici, par build.
// La lecture reste paresseuse : aucun coût tant que la visionneuse n'est pas
// ouverte, puis le cache de la couche Firestore évite les lectures répétées.

import { getDocDataSilent, saveDoc } from '../data/firestore.js';

const _cache = new Map();
const _safePart = value => encodeURIComponent(String(value || 'main')).replaceAll('%2F', '_');

export function characterMediaId(charId, buildId = 'main') {
  return `${_safePart(charId)}--${_safePart(buildId)}`;
}

export async function saveCharacterOriginalPhoto(charId, buildId, photoOriginal) {
  const id = characterMediaId(charId, buildId);
  const data = {
    charId: String(charId || ''),
    buildId: String(buildId || 'main'),
    photoOriginal: photoOriginal || null,
    updatedAt: Date.now(),
  };
  // Le stockage média est un enrichissement, jamais un prérequis pour changer
  // le portrait. Une production dont les nouvelles règles ne sont pas encore
  // déployées doit quand même pouvoir enregistrer la miniature sur `characters`.
  _cache.set(id, data);
  try {
    await saveDoc('characterMedia', id, data, { silent: true });
    return true;
  } catch (error) {
    console.warn('[character media] original conservé uniquement pour cette session', error?.code || error);
    return false;
  }
}

export async function characterOriginalPhotoFor(character) {
  if (!character) return '';
  // Compatibilité avec les anciennes fiches, migrées à leur prochain upload.
  if (character.photoOriginal) return character.photoOriginal;
  const id = characterMediaId(character.id, character.activeBuildId || 'main');
  if (_cache.has(id)) return _cache.get(id)?.photoOriginal || character.photo || '';
  const data = await getDocDataSilent('characterMedia', id);
  _cache.set(id, data || null);
  return data?.photoOriginal || character.photo || '';
}
