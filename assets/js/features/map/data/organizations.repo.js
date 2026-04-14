// Organisations rattachées à un lieu. Un simple CRUD, pas de legacy.
import { loadCollection, saveDoc, deleteFromCol } from '../../../data/firestore.js';

const COL = 'organizations';

export async function listOrganizations() {
  const raw = await loadCollection(COL);
  return (raw || []).map(normalize);
}

export async function saveOrganization(org) {
  if (!org.placeId) throw new Error('[organizations] placeId est obligatoire');
  const payload = {
    ...org,
    updatedAt: Date.now(),
    createdAt: org.createdAt || Date.now(),
  };
  await saveDoc(COL, org.id, payload);
  return payload;
}

export async function removeOrganization(id) {
  await deleteFromCol(COL, id);
}

function normalize(doc) {
  return {
    id: doc.id,
    placeId: doc.placeId || null,
    name: doc.name || 'Sans nom',
    category: doc.category || 'other',
    summary: doc.summary || '',
    description: doc.description || '',
    imageUrl: doc.imageUrl || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    visibility: doc.visibility || 'revealed',
    meta: doc.meta || {},
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}
