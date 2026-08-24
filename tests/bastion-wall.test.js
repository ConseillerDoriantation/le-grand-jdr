import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASTION_WALL_TYPES,
  appendBastionWallComment,
  bastionWallCommentsForPost,
  bastionWallMentionedCharacters,
  bastionWallNotificationTargets,
  bastionWallReactionCounts,
  bastionWallUnreadCount,
  normalizeBastionWallPost,
  removeBastionWallComment,
  toggleBastionWallReaction,
  sortBastionWallPosts,
} from '../assets/js/shared/bastion-wall.js';

const hero = { uid: 'u1', charId: 'c1', charName: 'Alysanne', charImage: 'portrait.jpg' };

test('les catégories du mur sont explicites et les anciennes annonces restent des actualités', () => {
  assert.equal(BASTION_WALL_TYPES.message.label, 'Actualité');
  assert.match(BASTION_WALL_TYPES.demande.description, /aide/i);
  assert.equal(normalizeBastionWallPost({ id: 'legacy' }).type, 'message');
  assert.equal(normalizeBastionWallPost({ id: 'q1', type: 'quete' }).type, 'quete');
});

test('un personnage ne conserve qu une réaction par publication', () => {
  const liked = toggleBastionWallReaction({ id: 'p1' }, hero, '❤️');
  const changed = toggleBastionWallReaction(liked, hero, '🔥');
  assert.deepEqual(bastionWallReactionCounts(changed), { '🔥': 1 });
  assert.equal(changed.reactions.c1.charName, 'Alysanne');
});

test('recliquer sur la même réaction la retire', () => {
  const liked = toggleBastionWallReaction({ id: 'p1' }, hero, '❤️');
  const cleared = toggleBastionWallReaction(liked, hero, '❤️');
  assert.deepEqual(cleared.reactions, {});
});

test('une émote personnalisée peut servir de réaction quand elle appartient au catalogue', () => {
  const reacted = toggleBastionWallReaction({ id: 'p1' }, hero, ':dragon:', ['❤️', ':dragon:']);
  assert.deepEqual(bastionWallReactionCounts(reacted), { ':dragon:': 1 });
  const refused = toggleBastionWallReaction({ id: 'p2' }, hero, ':inconnue:', ['❤️', ':dragon:']);
  assert.deepEqual(refused.reactions, {});
});

test('les réponses sont bornées et seul leur auteur ou le MJ peut les retirer', () => {
  let post = normalizeBastionWallPost({ id: 'p1' });
  post = appendBastionWallComment(post, { id: 'r1', uid: 'u1', charId: 'c1', text: 'Présente !' });
  assert.equal(post.comments.length, 1);
  assert.equal(removeBastionWallComment(post, 'r1', { uid: 'u2' }).comments.length, 1);
  assert.equal(removeBastionWallComment(post, 'r1', { uid: 'u1' }).comments.length, 0);
});

test('les publications personnelles ne gonflent pas le compteur non lu', () => {
  const posts = [
    { id: 'p1', uid: 'u1', ts: 300 },
    { id: 'p2', uid: 'u2', ts: 250 },
    { id: 'p3', uid: 'u3', ts: 100 },
  ];
  assert.equal(bastionWallUnreadCount(posts, 200, 'u1'), 1);
});

test('les publications épinglées restent en tête sans modifier leur date', () => {
  const posts = sortBastionWallPosts([
    { id: 'recent', ts: 300 },
    { id: 'pinned', ts: 100, pinned: true },
  ]);
  assert.deepEqual(posts.map(post => post.id), ['pinned', 'recent']);
  assert.equal(posts[0].ts, 100);
});

test('les réponses séparées restent compatibles avec les anciennes réponses intégrées', () => {
  const post = { id: 'p1', comments: [{ id: 'old', text: 'Ancienne', ts: 10 }] };
  const comments = bastionWallCommentsForPost(post, [
    { id: 'other', postId: 'p2', text: 'Hors sujet', ts: 20 },
    { id: 'new', postId: 'p1', text: 'Nouvelle', ts: 30 },
  ]);
  assert.deepEqual(comments.map(comment => comment.id), ['old', 'new']);
});

test('les mentions reconnaissent les noms complets sans confondre les préfixes', () => {
  const chars = [
    { id: 'c1', uid: 'u1', nom: 'Vik' },
    { id: 'c2', uid: 'u2', nom: 'Viktor Noir' },
  ];
  assert.deepEqual(bastionWallMentionedCharacters('Merci @Viktor Noir !', chars).map(char => char.id), ['c2']);
  assert.deepEqual(bastionWallMentionedCharacters('@Vik, à toi.', chars).map(char => char.id), ['c1']);
});

test('une réponse notifie auteur, participants et mentions une seule fois', () => {
  const targets = bastionWallNotificationTargets({
    post: { uid: 'owner' },
    comments: [{ uid: 'participant' }, { uid: 'owner' }],
    mentioned: [{ uid: 'mentioned' }, { uid: 'actor' }],
    actorUid: 'actor',
  });
  assert.deepEqual(targets.sort(), ['mentioned', 'owner', 'participant']);
});
