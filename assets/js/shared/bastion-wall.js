// Logique pure du mur du Bastion. Aucune dépendance DOM/Firebase afin de garder
// les réactions, réponses et compteurs testables indépendamment de l'UI.

export const BASTION_WALL_REACTIONS = ['❤️', '🔥', '😂', '👏', '⚔️'];
export const BASTION_WALL_MAX_COMMENTS = 80;
export const BASTION_WALL_TYPES = {
  message: {
    icon: '💬', label: 'Actualité', color: '#4f8cff',
    description: 'Nouvelle, souvenir ou information du Bastion.',
  },
  quete: {
    icon: '📜', label: 'Quête', color: '#e8b84b',
    description: 'Mission ou recherche de compagnons.',
  },
  offre: {
    icon: '🪙', label: 'Offre', color: '#22c38e',
    description: 'Objet, service ou récompense proposé.',
  },
  demande: {
    icon: '🙏', label: 'Demande', color: '#b47fff',
    description: 'Besoin d’aide, d’un objet ou d’un service.',
  },
};

export function bastionWallTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value?.toMillis) return value.toMillis();
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeBastionWallPost(raw = {}) {
  return {
    ...raw,
    id: String(raw.id || ''),
    kind: raw.kind || 'post',
    type: BASTION_WALL_TYPES[raw.type] ? raw.type : 'message',
    text: String(raw.text || '').slice(0, 4000),
    images: (Array.isArray(raw.images) ? raw.images : []).filter(Boolean).slice(0, 3),
    reactions: raw.reactions && typeof raw.reactions === 'object' && !Array.isArray(raw.reactions)
      ? raw.reactions : {},
    comments: (Array.isArray(raw.comments) ? raw.comments : []).slice(-BASTION_WALL_MAX_COMMENTS),
    ts: bastionWallTimestamp(raw.ts || raw.createdAt),
  };
}

export function sortBastionWallPosts(posts = []) {
  return posts.map(normalizeBastionWallPost).sort((a, b) => b.ts - a.ts);
}

export function toggleBastionWallReaction(post, identity, emoji, allowedReactions = BASTION_WALL_REACTIONS) {
  const current = normalizeBastionWallPost(post);
  const charId = String(identity?.charId || '');
  if (!charId || !allowedReactions.includes(emoji)) return current;
  const reactions = { ...current.reactions };
  if (reactions[charId]?.emoji === emoji) delete reactions[charId];
  else reactions[charId] = {
    emoji,
    charId,
    charName: String(identity.charName || 'Personnage').slice(0, 80),
    // Un portrait base64 du personnage ferait grossir chaque interaction.
    // L'UI résout d'abord le portrait vivant via charId ; seule une URL courte
    // peut servir de repli si le personnage a ensuite été supprimé.
    charImage: String(identity.charImage || '').slice(0, 2000),
    uid: String(identity.uid || ''),
  };
  return { ...current, reactions, updatedAt: Date.now() };
}

export function appendBastionWallComment(post, comment) {
  const current = normalizeBastionWallPost(post);
  const text = String(comment?.text || '').trim().slice(0, 1200);
  if (!text) return current;
  const next = {
    id: String(comment.id || `c_${Date.now()}`),
    uid: String(comment.uid || ''),
    charId: String(comment.charId || ''),
    charName: String(comment.charName || 'Personnage').slice(0, 80),
    charImage: String(comment.charImage || '').slice(0, 2000),
    text,
    ts: bastionWallTimestamp(comment.ts) || Date.now(),
  };
  return {
    ...current,
    comments: [...current.comments, next].slice(-BASTION_WALL_MAX_COMMENTS),
    updatedAt: Date.now(),
  };
}

export function removeBastionWallComment(post, commentId, { uid = '', isAdmin = false } = {}) {
  const current = normalizeBastionWallPost(post);
  const target = current.comments.find(comment => comment.id === commentId);
  if (!target || (!isAdmin && target.uid !== uid)) return current;
  return {
    ...current,
    comments: current.comments.filter(comment => comment.id !== commentId),
    updatedAt: Date.now(),
  };
}

export function bastionWallReactionCounts(post) {
  const counts = {};
  Object.values(normalizeBastionWallPost(post).reactions).forEach(reaction => {
    if (reaction?.emoji) counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  });
  return counts;
}

export function bastionWallUnreadCount(posts = [], seenAt = 0, uid = '') {
  return posts.map(normalizeBastionWallPost)
    .filter(post => post.ts > Number(seenAt || 0) && post.uid !== uid).length;
}

export function bastionWallSeenKey(adventureId = 'default', uid = 'anon') {
  return `bastion-wall-seen:${adventureId || 'default'}:${uid || 'anon'}`;
}
