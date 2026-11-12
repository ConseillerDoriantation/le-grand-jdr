// Galerie de portraits d'un personnage, séparée du document `characters`.
// Un personnage peut accumuler plusieurs portraits (indépendamment des builds) ;
// chacun est réutilisable comme portrait affiché ET comme avatar de compte.
// Les images (miniatures recadrées ~70 Ko) vivent ici, pas sur la fiche, afin de
// ne jamais faire dépasser la limite Firestore de 1 Mio du document personnage.
// Lecture paresseuse + cache module : aucun coût tant que la galerie n'est pas
// ouverte, puis zéro relecture tant que la session dure.

import { getDocDataSilent, saveDoc } from '../data/firestore.js';

const COL = 'characterPortraits';
const MAX_PORTRAITS = 16;
// Marge confortable sous la limite de 1 Mio par document Firestore.
const DOC_BYTE_BUDGET = 900_000;

const _cache = new Map(); // charId normalisé -> tableau de portraits | undefined si non chargé
const _safe = (value) => encodeURIComponent(String(value || '')).replaceAll('%2F', '_');
const _newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function characterPortraitsId(charId) {
  return _safe(charId);
}

function _normalize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p.photo === 'string' && p.photo)
    .map((p, i) => ({
      id: String(p.id || `${_newId()}_${i}`),
      photo: p.photo,
      createdAt: Number(p.createdAt) || 0,
    }));
}

/** Galerie déjà en cache (rendu synchrone), ou null si pas encore chargée. */
export function getCachedCharacterPortraits(charId) {
  const v = _cache.get(characterPortraitsId(charId));
  return v === undefined ? null : v;
}

export async function loadCharacterPortraits(charId, { force = false } = {}) {
  const id = characterPortraitsId(charId);
  if (!force && _cache.has(id)) return _cache.get(id);
  const data = await getDocDataSilent(COL, id);
  const list = _normalize(data?.portraits);
  _cache.set(id, list);
  return list;
}

const _bytes = (list) => list.reduce((n, p) => n + (p.photo?.length || 0), 0);

async function _persist(charId, list) {
  const portraits = _normalize(list);
  _cache.set(characterPortraitsId(charId), portraits);
  await saveDoc(COL, characterPortraitsId(charId), {
    charId: String(charId || ''),
    portraits,
    updatedAt: Date.now(),
  }, { silent: true });
  return portraits;
}

/** Ajoute une image (déjà recadrée/compressée) à la galerie. Dédoublonne, borne
 *  le nombre et le poids total. Renvoie la galerie à jour. */
export async function addCharacterPortrait(charId, photo) {
  if (!photo) throw new Error('Image manquante.');
  const list = await loadCharacterPortraits(charId);
  if (list.some((p) => p.photo === photo)) return list; // déjà présent
  if (list.length >= MAX_PORTRAITS) throw new Error(`Maximum ${MAX_PORTRAITS} portraits par personnage.`);
  const next = [...list, { id: _newId(), photo, createdAt: Date.now() }];
  if (_bytes(next) > DOC_BYTE_BUDGET) throw new Error('Galerie trop lourde : retire un portrait avant d’en ajouter un.');
  return _persist(charId, next);
}

export async function removeCharacterPortrait(charId, portraitId) {
  const list = await loadCharacterPortraits(charId);
  const next = list.filter((p) => p.id !== portraitId);
  if (next.length === list.length) return list;
  return _persist(charId, next);
}

/** Réordonne la galerie d'après une liste d'ids (ceux absents de la liste sont
 *  conservés à la fin). N'écrit que si l'ordre change réellement. */
export async function reorderCharacterPortraits(charId, orderedIds) {
  const list = await loadCharacterPortraits(charId);
  const byId = new Map(list.map((p) => [p.id, p]));
  const order = (Array.isArray(orderedIds) ? orderedIds : []);
  const next = order.map((id) => byId.get(id)).filter(Boolean);
  for (const p of list) if (!order.includes(p.id)) next.push(p);
  if (next.length === list.length && next.every((p, i) => p.id === list[i].id)) return list;
  return _persist(charId, next);
}

export const CHARACTER_PORTRAITS_MAX = MAX_PORTRAITS;
