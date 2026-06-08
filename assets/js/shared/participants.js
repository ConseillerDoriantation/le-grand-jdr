import { sortCharactersForDisplay } from './char-stats.js';

export function questParticipantFromChar(char = {}, uid = char?.uid || '') {
  return {
    uid,
    charId: char.id,
    nom: char.nom || '?',
    photo: char.photo || null,
    photoX: char.photoX || 0,
    photoY: char.photoY || 0,
  };
}

export function toggleQuestParticipant(participants = [], { uid = '', char = null, uidAliases = [] } = {}) {
  const aliases = new Set([uid, ...(Array.isArray(uidAliases) ? uidAliases : [])].filter(Boolean));
  const parts = (Array.isArray(participants) ? participants : [])
    .filter(p => !aliases.has(p?.uid));
  const hadParticipant = (Array.isArray(participants) ? participants : [])
    .some(p => aliases.has(p?.uid));
  if (hadParticipant && !char) {
    return { participants: parts, joined: false, leaving: true };
  }
  if (hadParticipant && char) {
    parts.push(questParticipantFromChar(char, uid));
    return { participants: parts, joined: true, leaving: false };
  }
  const idx = parts.findIndex(p => p?.uid === uid);
  if (idx >= 0) {
    parts.splice(idx, 1);
    return { participants: parts, joined: false, leaving: true };
  }
  if (char) parts.push(questParticipantFromChar(char, uid));
  return { participants: parts, joined: Boolean(char), leaving: false };
}

export function storyParticipantsFromGroups(groups = [], characters = []) {
  const chars = sortCharactersForDisplay(characters || []);
  const byId = new Map(chars.map(c => [c.id, c]));
  const seen = new Set();
  const out = [];
  groups.forEach(g => (g?.membres || []).forEach(id => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = byId.get(id);
    if (!c) return;
    out.push({
      id: c.id, nom: c.nom || "", photo: c.photo || '',
      photoX: c.photoX || 0, photoY: c.photoY || 0, photoZoom: c.photoZoom || 1,
    });
  }));
  return out;
}
