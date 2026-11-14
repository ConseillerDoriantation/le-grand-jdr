import { STATE } from '../../core/state.js';
import {
  batchReplaceInCol,
  batchSaveInCol,
  deleteFromCol,
  loadCollection,
  replaceDoc,
  saveDoc,
} from '../../data/firestore.js';
import { compressDataUrl } from '../../shared/image-upload.js';

const DEFAULT_FIELD = { id: 'defi', nom: 'Défi', type: 'long', vis: 'pj' };
const VALID_MODELS = new Set(['carte', 'objet', 'document', 'image', 'fragments']);
const VALID_STATES = new Set(['cache', 'pret', 'revele']);

const cleanId = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FIRESTORE_SAFE_BYTES = 900_000;
const FIRESTORE_SAFE_BATCH_BYTES = 8_000_000;
const DATA_IMAGE_RE = /^data:image\//i;

function utf8Bytes(value) {
  const json = JSON.stringify(value);
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length * 2;
}

function chunkWrites(entries) {
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  for (const entry of entries) {
    const entryBytes = utf8Bytes(entry.data) + 512;
    if (chunk.length && (chunk.length >= 400 || bytes + entryBytes > FIRESTORE_SAFE_BATCH_BYTES)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(entry);
    bytes += entryBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

async function writeInSafeBatches(entries, writer) {
  for (const chunk of chunkWrites(entries)) await writer(chunk);
}

export function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeShelf(raw = {}, fallbackId = '') {
  const modele = VALID_MODELS.has(raw.modele) ? raw.modele : 'carte';
  const id = cleanId(raw.id || raw.shelfId || fallbackId || uid('shelf-'));
  return {
    id,
    nom: String(raw.nom || raw.name || 'Nouvelle collection'),
    emoji: String(raw.emoji || (modele === 'carte' ? '🃏' : '🖼️')),
    desc: String(raw.desc || raw.description || ''),
    modele,
    ratio: String(raw.ratio || '3:4'),
    visible: raw.visible !== false,
    ordre: Number(raw.ordre ?? 0),
    dos: String(raw.dos || raw.backImageId || ''),
    sousTitre: String(raw.sousTitre || ''),
    rec: {
      t: String(raw.rec?.t || raw.recompense || ''),
      annonce: raw.rec?.annonce !== false,
    },
    series: (Array.isArray(raw.series) ? raw.series : []).map((serie, index) => ({
      id: cleanId(serie.id || uid('serie-')),
      nom: String(serie.nom || `Série ${index + 1}`),
      dos: String(serie.dos || ''),
      rec: { t: String(serie.rec?.t || ''), annonce: serie.rec?.annonce !== false },
    })),
    champs: (Array.isArray(raw.champs) && raw.champs.length ? raw.champs : modele === 'carte' ? [DEFAULT_FIELD] : [])
      .map(field => ({
        id: cleanId(field.id || uid('field-')),
        nom: String(field.nom || 'Champ'),
        type: ['court', 'long', 'nombre', 'liste'].includes(field.type) ? field.type : 'court',
        vis: field.vis === 'mj' ? 'mj' : 'pj',
        ...(Array.isArray(field.options) ? { options: field.options.map(String) } : {}),
      })),
    ...(modele === 'fragments' ? {
      frag: {
        cols: Math.min(6, Math.max(2, Number(raw.frag?.cols || 3))),
        rows: Math.min(6, Math.max(2, Number(raw.frag?.rows || 3))),
        url: String(raw.frag?.url || ''),
        ratio: Number(raw.frag?.ratio || 4 / 3),
      },
    } : {}),
  };
}

export function normalizeItem(raw = {}, fallbackId = '', defaultShelfId = '') {
  const id = cleanId(raw.id || fallbackId || uid('item-'));
  const unlocked = raw.unlocked === true;
  const etat = VALID_STATES.has(raw.etat) ? raw.etat : (unlocked ? 'revele' : 'cache');
  return {
    id,
    shelf: cleanId(raw.shelf || raw.shelfId || defaultShelfId),
    serie: cleanId(raw.serie || raw.serieId || ''),
    nom: String(raw.nom || raw.name || ''),
    front: String(raw.front || raw.imageUrl || ''),
    // Dans l'ancien modèle, `description` était le défi de la carte. La copier
    // aussi dans `texte` doublait parfois plusieurs centaines de Ko de HTML ou
    // de base64 pendant la migration.
    texte: String(raw.texte || ''),
    dos: String(raw.dos || raw.backImageId || ''),
    dosUrl: String(raw.dosUrl || raw.backImageUrl || ''),
    etat,
    champs: raw.champs && typeof raw.champs === 'object'
      ? { ...raw.champs }
      : (raw.description ? { defi: String(raw.description) } : {}),
    masques: Array.isArray(raw.masques)
      ? [...raw.masques]
      : (raw.descMasquee ? ['defi'] : []),
    ordre: Number(raw.ordre ?? 999),
    pos: Number(raw.pos ?? 0),
    revealedAt: String(raw.revealedAt || ''),
    fresh: raw.fresh === true,
  };
}

export function publicProjection(item, shelf) {
  const revealed = item.etat === 'revele';
  const allowed = new Set((shelf?.champs || []).filter(field => field.vis === 'pj').map(field => field.id));
  const masks = (item.masques || []).filter(id => allowed.has(id));
  const projected = {
    shelfId: item.shelf,
    serieId: item.serie || '',
    etat: item.etat,
    unlocked: revealed,
    ordre: Number(item.ordre ?? 999),
    pos: Number(item.pos ?? 0),
    backImageId: item.dos || '',
    masques: masks,
  };
  if (item.dosUrl) projected.backImageUrl = item.dosUrl;
  if (!revealed) return projected;
  projected.nom = item.nom || '';
  projected.imageUrl = item.front || '';
  projected.texte = item.texte || '';
  projected.revealedAt = item.revealedAt || '';
  projected.champs = Object.fromEntries(Object.entries(item.champs || {})
    .filter(([id]) => allowed.has(id) && !masks.includes(id)));
  return projected;
}

const shelfDoc = shelf => {
  const data = clone(shelf);
  // L’image complète d’un puzzle ne doit jamais vivre dans un document lisible
  // par les joueurs. Seuls la grille et son ratio sont publics ici.
  if (data.frag) data.frag = { ...data.frag, url: '' };
  data.champs = (data.champs || []).filter(field => field.vis === 'pj');
  return { kind: 'shelf', version: 2, ...data };
};
const backDoc = back => ({ kind: 'back', version: 2, nom: back.nom || 'Dos', url: back.url || '', ordre: Number(back.ordre ?? 0) });
const secretShelfDoc = shelf => {
  const data = clone(shelf);
  if (data.frag) data.frag = { ...data.frag, url: '' };
  return { kind: 'shelf-settings', version: 2, shelfId: shelf.id, shelf: data };
};
const secretDoc = item => {
  const { id, ...data } = item;
  return { kind: 'item', version: 2, shelfId: item.shelf, serieId: item.serie, ...data };
};

function itemDocumentsFit(item, shelf) {
  return utf8Bytes(secretDoc(item)) <= FIRESTORE_SAFE_BYTES
    && utf8Bytes(publicProjection(item, shelf)) <= FIRESTORE_SAFE_BYTES;
}

async function compressItemImage(item, field, options) {
  const source = item[field];
  if (!DATA_IMAGE_RE.test(source || '')) return;
  const compressed = await compressDataUrl(source, options);
  // Un décodage impossible ne doit jamais effacer une image historique.
  if (compressed) item[field] = compressed;
}

async function prepareItemForFirestore(item, shelf) {
  const prepared = clone(item);
  if (itemDocumentsFit(prepared, shelf)) return prepared;

  await compressItemImage(prepared, 'front', {
    max: 1100, quality: .76, maxBytes: 440_000, minSide: 240,
  });
  await compressItemImage(prepared, 'dosUrl', {
    max: 900, quality: .72, maxBytes: 300_000, minSide: 220,
  });
  if (itemDocumentsFit(prepared, shelf)) return prepared;

  // Deuxième passe pour les anciennes images très détaillées ou les cartes qui
  // cumulent recto et dos propres. On garde une marge pour l'overhead Firestore.
  await compressItemImage(prepared, 'front', {
    max: 900, quality: .66, maxBytes: 300_000, minSide: 180,
  });
  await compressItemImage(prepared, 'dosUrl', {
    max: 720, quality: .64, maxBytes: 180_000, minSide: 160,
  });
  return itemDocumentsFit(prepared, shelf) ? prepared : null;
}
const fragmentSourceId = shelfId => `fragment-source--${cleanId(shelfId)}`;
const shelfSecretId = shelfId => `shelf-settings--${cleanId(shelfId)}`;

function localVisitKey(shelfId) {
  return `lgjdr:collection:last-visit:${STATE.adventure?.id || 'none'}:${shelfId}`;
}

export function readLastVisit(shelfId) {
  try { return localStorage.getItem(localVisitKey(shelfId)) || ''; } catch { return ''; }
}

export function markVisited(shelfId) {
  try { localStorage.setItem(localVisitKey(shelfId), new Date().toISOString().slice(0, 10)); } catch { /* localStorage indisponible */ }
}

function legacyBacks(settings = []) {
  const legacy = settings.find(doc => doc.kind !== 'shelf' && doc.kind !== 'back') || {};
  const byId = legacy.backImagesById && typeof legacy.backImagesById === 'object'
    ? legacy.backImagesById
    : Object.fromEntries((legacy.backImages || []).map((entry, index) => [entry?.id || `back-${index}`, typeof entry === 'string' ? entry : entry?.url]).filter(([, url]) => url));
  if (!Object.keys(byId).length && legacy.templateUrl) byId['legacy-template'] = legacy.templateUrl;
  const order = Array.isArray(legacy.backImageOrder) ? legacy.backImageOrder : Object.keys(byId);
  return order.filter(id => byId[id]).map((id, index) => ({ id: cleanId(id), nom: `Dos ${index + 1}`, url: byId[id], ordre: index }));
}

async function migrateLegacy(settings, secret, publicItems) {
  const shelves = settings.filter(doc => doc.kind === 'shelf').map(doc => normalizeShelf(doc, doc.id));
  const secretItems = secret.filter(doc => !['fragment-source', 'shelf-settings'].includes(doc.kind));
  if (shelves.length) {
    // Reprend aussi une migration interrompue après la création des étagères :
    // chaque document public absent du secret est converti, sans réécrire ceux
    // qui ont déjà réussi lors d'une visite précédente.
    const secretById = new Map(secretItems.map(item => [item.id, item]));
    const publicById = new Map(publicItems.map(item => [item.id, item]));
    const shelfById = new Map(shelves.map(shelf => [shelf.id, shelf]));
    const fallbackShelf = shelves[0];
    const migrationIds = new Set([
      ...publicItems.filter(item => !secretById.has(item.id)).map(item => item.id),
      ...secretItems.filter(item => item.kind !== 'item' || Number(item.version || 0) < 2).map(item => item.id),
    ]);
    const missing = [...migrationIds]
      .map(id => secretById.get(id) || publicById.get(id))
      .filter(Boolean)
      .map(doc => normalizeItem(doc, doc.id, fallbackShelf?.id || ''));
    const persistable = [];
    const skipped = [];
    for (const item of missing) {
      const prepared = await prepareItemForFirestore(item, shelfById.get(item.shelf) || fallbackShelf);
      if (prepared) persistable.push(prepared);
      else skipped.push(item);
    }
    if (persistable.length) {
      // Remplacement complet indispensable : une fusion conserverait les anciens
      // `imageUrl` / `description` en plus des nouveaux `front` / `champs` et
      // pourrait doubler la taille du document au-delà de la limite Firestore.
      await writeInSafeBatches(persistable.map(item => ({ col: 'collection_secret', id: item.id, data: secretDoc(item) })), batchReplaceInCol);
      await writeInSafeBatches(persistable.map(item => ({
        col: 'collection', id: item.id, data: publicProjection(item, shelfById.get(item.shelf) || fallbackShelf),
      })), batchReplaceInCol);
    }
    if (skipped.length) console.warn(`[collection] ${skipped.length} élément(s) historique(s) trop lourd(s) conservé(s) sans migration.`);
    const allItems = [...new Map([
      ...publicItems.map(doc => [doc.id, normalizeItem(doc, doc.id, fallbackShelf?.id || '')]),
      ...secretItems.map(doc => [doc.id, normalizeItem(doc, doc.id, fallbackShelf?.id || '')]),
      ...persistable.map(item => [item.id, item]),
    ]).values()];
    return { shelves, items: allItems, migrated: persistable.length > 0 };
  }
  const source = settings.find(doc => doc.kind !== 'back') || {};
  const backs = legacyBacks(settings);
  const shelf = normalizeShelf({
    ...source,
    id: source.shelfId || 'cartes',
    nom: source.nom || 'Cartes',
    emoji: source.emoji || '🃏',
    modele: 'carte',
    visible: true,
    dos: source.dos || source.backImageId || backs[0]?.id || '',
    champs: source.champs?.length ? source.champs : [DEFAULT_FIELD],
  }, 'cartes');
  await saveDoc('collectionSettings', `shelf__${shelf.id}`, shelfDoc(shelf));
  await saveDoc('collection_secret', shelfSecretId(shelf.id), secretShelfDoc(shelf));
  if (backs.length) await writeInSafeBatches(backs.map(back => ({ col: 'collectionSettings', id: `back__${back.id}`, data: backDoc(back) })), batchSaveInCol);
  const merged = secretItems.length ? secretItems : publicItems;
  const items = merged.map(doc => normalizeItem(doc, doc.id, shelf.id));
  const persistable = [];
  const skipped = [];
  for (const item of items) {
    const prepared = await prepareItemForFirestore(item, shelf);
    if (prepared) persistable.push(prepared);
    else skipped.push(item);
  }
  if (persistable.length) {
    await writeInSafeBatches(persistable.map(item => ({ col: 'collection_secret', id: item.id, data: secretDoc(item) })), batchReplaceInCol);
    await writeInSafeBatches(persistable.map(item => ({ col: 'collection', id: item.id, data: publicProjection(item, shelf) })), batchReplaceInCol);
  }
  if (skipped.length) {
    console.warn(`[collection] ${skipped.length} élément(s) historique(s) trop lourd(s) conservé(s) sans migration.`);
  }
  return { shelves: [shelf], items: [...persistable, ...skipped], migrated: true };
}

export async function loadCollectionStore({ admin = STATE.isAdmin } = {}) {
  const [settings, publicItems, secretItems] = await Promise.all([
    loadCollection('collectionSettings').catch(() => []),
    loadCollection('collection').catch(() => []),
    admin ? loadCollection('collection_secret').catch(() => []) : Promise.resolve([]),
  ]);
  const explicitShelves = settings.filter(doc => doc.kind === 'shelf').map(doc => normalizeShelf(doc, doc.id));
  const legacySettings = settings.find(doc => doc.kind !== 'shelf' && doc.kind !== 'back');
  let migration;
  if (admin) {
    try {
      migration = await migrateLegacy(settings, secretItems, publicItems);
    } catch (error) {
      // Une migration est une opération de maintenance : son échec ne doit
      // jamais empêcher le MJ d'ouvrir et de réparer sa collection.
      console.warn('[collection] migration historique différée', error?.code || error?.message || error);
      const fallbackSource = settings.find(doc => doc.kind !== 'back') || {};
      const fallbackBacks = legacyBacks(settings);
      const fallbackShelf = explicitShelves[0] || normalizeShelf({
        ...fallbackSource,
        id: fallbackSource.shelfId || 'cartes',
        nom: fallbackSource.nom || 'Cartes',
        emoji: fallbackSource.emoji || '🃏',
        modele: 'carte',
        visible: true,
        dos: fallbackSource.dos || fallbackSource.backImageId || fallbackBacks[0]?.id || '',
        champs: fallbackSource.champs?.length ? fallbackSource.champs : [DEFAULT_FIELD],
      }, 'cartes');
      migration = {
        shelves: explicitShelves.length ? explicitShelves : [fallbackShelf],
        items: [...new Map([
          ...publicItems.map(doc => [doc.id, doc]),
          ...secretItems.filter(doc => !['fragment-source', 'shelf-settings'].includes(doc.kind)).map(doc => [doc.id, doc]),
        ]).values()],
        migrated: false,
      };
    }
  } else {
    migration = {
      shelves: explicitShelves.length
        ? explicitShelves
        : (legacySettings ? [normalizeShelf({
          ...legacySettings,
          id: 'cartes',
          nom: legacySettings.nom || 'Cartes',
          modele: 'carte',
          dos: legacySettings.dos || legacySettings.backImageId || legacyBacks(settings)[0]?.id || '',
        }, 'cartes')] : []),
      migrated: false,
    };
  }
  if (admin) {
    const unsafeShelves = settings.filter(doc => doc.kind === 'shelf'
      && ((doc.champs || []).some(field => field.vis === 'mj') || !!doc.frag?.url));
    for (const raw of unsafeShelves) {
      const full = normalizeShelf(raw, raw.id);
      await saveDoc('collection_secret', shelfSecretId(full.id), secretShelfDoc(full));
      await replaceDoc('collectionSettings', `shelf__${full.id}`, shelfDoc(full));
    }
  }
  const fragmentSources = new Map(secretItems
    .filter(doc => doc.kind === 'fragment-source')
    .map(doc => [cleanId(doc.shelfId || doc.id.replace(/^fragment-source--/, '')), doc]));
  const secretShelfSettings = new Map(secretItems
    .filter(doc => doc.kind === 'shelf-settings')
    .map(doc => [cleanId(doc.shelfId || doc.id.replace(/^shelf-settings--/, '')), normalizeShelf(doc.shelf || {}, doc.shelfId)]));
  const shelves = migration.shelves
    .map(publicShelf => admin && secretShelfSettings.has(publicShelf.id) ? secretShelfSettings.get(publicShelf.id) : publicShelf)
    .map(shelf => shelf.modele === 'fragments' && fragmentSources.get(shelf.id)
      ? { ...shelf, frag: { ...shelf.frag, url: fragmentSources.get(shelf.id).url || '' } }
      : shelf)
    .sort((a, b) => a.ordre - b.ordre);
  const defaultShelf = shelves[0]?.id || '';
  const backs = settings.filter(doc => doc.kind === 'back')
    .map(doc => ({ id: cleanId(doc.id.replace(/^back__/, '')), nom: doc.nom || 'Dos', url: doc.url || '', ordre: Number(doc.ordre ?? 0) }))
    .sort((a, b) => a.ordre - b.ordre);
  if (!backs.length) backs.push(...legacyBacks(settings));
  const actualSecrets = secretItems.filter(doc => !['fragment-source', 'shelf-settings'].includes(doc.kind));
  const adminItems = migration.items || [...new Map([
    ...publicItems.map(doc => [doc.id, doc]),
    ...actualSecrets.map(doc => [doc.id, doc]),
  ]).values()];
  const rawItems = admin ? adminItems : publicItems;
  const items = rawItems.map(doc => normalizeItem(doc, doc.id, defaultShelf)).sort((a, b) => a.ordre - b.ordre);
  return { shelves, backs, items, lastVisit: defaultShelf ? readLastVisit(defaultShelf) : '' };
}

export function snapshotStore(store) {
  return clone({ shelves: store.shelves, backs: store.backs, items: store.items });
}

export async function persistStore(store, previous) {
  if (!STATE.isAdmin) return snapshotStore(store);
  const prev = previous || { shelves: [], backs: [], items: [] };
  const prevShelves = new Map(prev.shelves.map(value => [value.id, value]));
  const prevBacks = new Map(prev.backs.map(value => [value.id, value]));
  const prevItems = new Map(prev.items.map(value => [value.id, value]));
  const shelfById = new Map(store.shelves.map(value => [value.id, value]));

  const settingsWrites = [
    ...store.shelves.filter(value => !same(value, prevShelves.get(value.id))).map(value => ({ col: 'collectionSettings', id: `shelf__${value.id}`, data: shelfDoc(value) })),
    ...store.backs.filter(value => !same(value, prevBacks.get(value.id))).map(value => ({ col: 'collectionSettings', id: `back__${value.id}`, data: backDoc(value) })),
  ];
  const changedShelves = store.shelves.filter(value => !same(value, prevShelves.get(value.id)));
  const changedItems = store.items.filter(value => !same(value, prevItems.get(value.id)));
  await writeInSafeBatches(settingsWrites, batchReplaceInCol);
  await writeInSafeBatches(changedShelves.map(shelf => ({
      col: 'collection_secret',
      id: shelfSecretId(shelf.id),
      data: secretShelfDoc(shelf),
    })), batchReplaceInCol);
  const preparedItems = [];
  for (const item of changedItems) {
    const prepared = await prepareItemForFirestore(item, shelfById.get(item.shelf));
    if (!prepared) throw new Error(`L’élément « ${item.nom || item.id} » dépasse encore la limite Firestore après compression.`);
    Object.assign(item, prepared);
    preparedItems.push(prepared);
  }
  await writeInSafeBatches(preparedItems.map(item => ({ col: 'collection_secret', id: item.id, data: secretDoc(item) })), batchReplaceInCol);
  await writeInSafeBatches(preparedItems.map(item => ({ col: 'collection', id: item.id, data: publicProjection(item, shelfById.get(item.shelf)) })), batchReplaceInCol);
  const changedFragmentSources = store.shelves.filter(shelf => shelf.modele === 'fragments'
    && String(shelf.frag?.url || '') !== String(prevShelves.get(shelf.id)?.frag?.url || ''));
  for (const shelf of changedFragmentSources) {
    await replaceDoc('collection_secret', fragmentSourceId(shelf.id), {
      kind: 'fragment-source',
      version: 2,
      shelfId: shelf.id,
      url: shelf.frag?.url || '',
      ratio: Number(shelf.frag?.ratio || 1),
    });
  }
  const deletions = [
    ...prev.shelves.filter(value => !shelfById.has(value.id)).flatMap(value => [
      ['collectionSettings', `shelf__${value.id}`],
      ['collection_secret', shelfSecretId(value.id)],
      ...(value.modele === 'fragments' ? [['collection_secret', fragmentSourceId(value.id)]] : []),
    ]),
    ...prev.backs.filter(value => !store.backs.some(back => back.id === value.id)).map(value => ['collectionSettings', `back__${value.id}`]),
    ...prev.items.filter(value => !store.items.some(item => item.id === value.id)).flatMap(value => [['collection_secret', value.id], ['collection', value.id]]),
  ];
  await Promise.all(deletions.map(([col, id]) => deleteFromCol(col, id)));
  return snapshotStore(store);
}

export async function persistItem(item, shelf) {
  const prepared = await prepareItemForFirestore(item, shelf);
  if (!prepared) throw new Error(`L’élément « ${item.nom || item.id} » dépasse encore la limite Firestore après compression.`);
  Object.assign(item, prepared);
  const data = secretDoc(prepared);
  await saveDoc('collection_secret', item.id, data);
  await replaceDoc('collection', item.id, publicProjection(prepared, shelf));
}

export const collectionDataTestApi = { normalizeShelf, normalizeItem, publicProjection, utf8Bytes, itemDocumentsFit, chunkWrites };
