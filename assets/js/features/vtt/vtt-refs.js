// ══════════════════════════════════════════════════════════════════════════════
// VTT — Refs Firestore (constructeurs de chemins)
// ──────────────────────────────────────────────────────────────────────────────
// Module LEAF : ne dépend que de `db` (config) et `aid()` (vtt-state). Aucun
// import du cœur vtt.js → les sous-modules (dice, loot, rest, timer, présence,
// mini-fiche) importent leurs refs ICI plutôt que circulairement depuis vtt.js.
// Chaque ref est une fonction pure de l'id d'aventure courant.
// (Les refs musique vivent dans vtt-music.js.)
// ══════════════════════════════════════════════════════════════════════════════
import { db, doc, collection } from '../../config/firebase.js';
import { aid } from './vtt-state.js';

export const _sesRef        = ()    => doc(db,  `adventures/${aid()}/vtt/session`);
export const _pgsCol        = ()    => collection(db, `adventures/${aid()}/vttPages`);
export const _toksCol       = ()    => collection(db, `adventures/${aid()}/vttTokens`);
export const _pgRef         = (id)  => doc(db, `adventures/${aid()}/vttPages/${id}`);
export const _tokRef        = (id)  => doc(db, `adventures/${aid()}/vttTokens/${id}`);
export const _chrRef        = (id)  => doc(db, `adventures/${aid()}/characters/${id}`);
export const _npcRef        = (id)  => doc(db, `adventures/${aid()}/npcs/${id}`);
export const _bstTrackerRef = (uid) => doc(db, `adventures/${aid()}/bestiary_tracker/${uid}`);
export const _logCol        = ()    => collection(db, `adventures/${aid()}/vttLog`);
// Jets cachés du MJ : sous-collection séparée, lisible/écrivable par le seul MJ
// (règles Firestore isAdvAdmin) → secret réel, pas un filtre client.
export const _logGmCol      = ()    => collection(db, `adventures/${aid()}/vttLogGm`);
export const _castingCol    = ()    => collection(db, `adventures/${aid()}/vttCasting`);
export const _castingRef    = (uid) => doc(db, `adventures/${aid()}/vttCasting/${uid}`);
export const _pingsCol      = ()    => collection(db, `adventures/${aid()}/vttPings`);
export const _pingRef       = (uid) => doc(db, `adventures/${aid()}/vttPings/${uid}`);
export const _reactionsCol  = ()    => collection(db, `adventures/${aid()}/vttEmoteReactions`);
export const _reactionRef   = (uid) => doc(db, `adventures/${aid()}/vttEmoteReactions/${uid}`);
export const _annotCol      = ()    => collection(db, `adventures/${aid()}/vttAnnotations`);
export const _annotRef      = (id)  => doc(db, `adventures/${aid()}/vttAnnotations/${id}`);
