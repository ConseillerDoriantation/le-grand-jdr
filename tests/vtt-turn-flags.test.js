import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TURN_EPOCH_ENABLED, TURN_FLAG_KEYS, TURN_FLAG_RESET,
  sessionTurnEpoch, nextTurnEpoch, hasTurnFlags, turnFlagsStale,
  normalizeTurnFlags, stampTurnPatch, roundTurnReset,
} from '../assets/js/features/vtt/vtt-turn-flags.js';

const moved = { id: 't', col: 3, row: 2, movedThisTurn: true, movedCells: 3, moveOrigin: { col: 0, row: 2, round: 4 }, attackedThisTurn: true };

test('livré désactivé tant que les règles n\'autorisent pas turnEpoch', () => {
  assert.equal(TURN_EPOCH_ENABLED, false);
});

test('époque de session : 0 par défaut, +1 au round suivant', () => {
  assert.equal(sessionTurnEpoch({}), 0);
  assert.equal(sessionTurnEpoch({ combat: { turnEpoch: 7 } }), 7);
  assert.equal(nextTurnEpoch(undefined), 1);
  assert.equal(nextTurnEpoch({ turnEpoch: 7 }), 8);
});

test('mécanisme désactivé (époque null) : identité stricte', () => {
  const patch = { col: 1, movedCells: 2 };
  assert.equal(stampTurnPatch({ ...moved, turnEpoch: 1 }, patch, null), patch);
  const token = { ...moved, turnEpoch: 1 };
  assert.equal(normalizeTurnFlags(token, null), token);
  assert.equal(turnFlagsStale(token, null), false);
  // Passage de round : remise à zéro des seuls drapeaux posés, comme avant.
  assert.deepEqual(roundTurnReset(moved, null, () => 'DEL'),
    { movedThisTurn: false, movedCells: 0, moveOrigin: 'DEL', attackedThisTurn: false });
  assert.deepEqual(roundTurnReset({ id: 'calme' }, null), {});
});

test('un token daté d\'une époque antérieure se lit remis à zéro, sans perdre son époque', () => {
  const token = { ...moved, turnEpoch: 4 };
  assert.equal(turnFlagsStale(token, 5), true);
  const seen = normalizeTurnFlags(token, 5);
  assert.deepEqual(
    Object.fromEntries(TURN_FLAG_KEYS.map(key => [key, seen[key]])),
    { ...TURN_FLAG_RESET },
  );
  assert.equal(seen.turnEpoch, 4);
  assert.equal(seen.col, 3);
  assert.equal(token.movedCells, 3, 'le doc brut n\'est pas modifié');
  assert.equal(hasTurnFlags(seen), false);
});

test('une époque connue en retard (cache) ne périme jamais un token daté plus récemment', () => {
  const token = { ...moved, turnEpoch: 6 };
  assert.equal(turnFlagsStale(token, 5), false);
  assert.equal(normalizeTurnFlags(token, 5), token);
  // …et une écriture ne rétrograde pas son époque.
  assert.deepEqual(stampTurnPatch(token, { attackedThisTurn: true }, 5), { attackedThisTurn: true });
});

test('écrire sur un token périmé repart de drapeaux à zéro dans la même écriture', () => {
  const token = normalizeTurnFlags({ ...moved, bonusMvt: 6, turnEpoch: 4 }, 5);
  const patch = stampTurnPatch(token, { col: 4, movedCells: (token.movedCells || 0) + 1, movedThisTurn: true }, 5);
  assert.deepEqual(patch, { ...TURN_FLAG_RESET, col: 4, movedCells: 1, movedThisTurn: true, turnEpoch: 5 });
});

test('même époque : patch inchangé ; token hérité : daté sans effacer ses drapeaux du tour', () => {
  const current = { ...moved, turnEpoch: 5 };
  assert.deepEqual(stampTurnPatch(current, { reactionThisTurn: true }, 5), { reactionThisTurn: true });
  assert.deepEqual(stampTurnPatch(moved, { reactionThisTurn: true }, 5), { reactionThisTurn: true, turnEpoch: 5 });
  // Patch sans drapeau de tour (PV, états, poussée) : rien n'est ajouté.
  const hp = { hp: 3 };
  assert.equal(stampTurnPatch({ ...moved, turnEpoch: 2 }, hp, 5), hp);
});

test('passage de round avec époque : aucun token daté écrit, les hérités sont remis à zéro et datés', () => {
  assert.deepEqual(roundTurnReset({ ...moved, turnEpoch: 4 }, 5), {});
  assert.deepEqual(roundTurnReset(moved, 5, () => 'DEL'),
    { movedThisTurn: false, movedCells: 0, moveOrigin: 'DEL', attackedThisTurn: false, turnEpoch: 5 });
  assert.deepEqual(roundTurnReset({ id: 'calme' }, 5), {}, 'hérité sans drapeau : rien à écrire');
});

test('scénario : 3 rounds, aucune écriture de remise à zéro une fois les tokens datés', () => {
  const doc = { id: 'j1', col: 0, row: 0 };          // token hérité, jamais daté
  let epoch = 1;
  let resetWrites = 0;
  const write = patch => Object.assign(doc, patch);
  for (let round = 1; round <= 3; round += 1) {
    const seen = normalizeTurnFlags(doc, epoch);
    // Le joueur bouge de 2 cases puis attaque, à partir de la vue normalisée.
    const move = stampTurnPatch(seen, { col: seen.col + 2, movedCells: (seen.movedCells || 0) + 2, movedThisTurn: true }, epoch);
    write(move);
    const afterMove = normalizeTurnFlags(doc, epoch);
    assert.equal(afterMove.movedCells, 2, `round ${round} : mouvement compté depuis zéro`);
    write(stampTurnPatch(afterMove, { attackedThisTurn: true }, epoch));
    assert.equal(normalizeTurnFlags(doc, epoch).movedCells, 2, 'l\'attaque n\'efface pas le mouvement du tour');
    // Le MJ passe au round suivant.
    epoch += 1;
    const reset = roundTurnReset(doc, epoch);
    if (Object.keys(reset).length) { resetWrites += 1; write(reset); }
    assert.equal(hasTurnFlags(normalizeTurnFlags(doc, epoch)), false, 'nouveau round : drapeaux remis à zéro');
  }
  assert.equal(resetWrites, 0);
});

test('vtt.js et vtt-combat-turns.js passent par l\'époque confirmée et datent chaque écrivain', () => {
  const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
  const turns = readFileSync(new URL('../assets/js/features/vtt/vtt-combat-turns.js', import.meta.url), 'utf8');
  // Époque appliquée seulement si confirmée, et monotone.
  assert.match(vtt, /if \(!snap\.metadata\.hasPendingWrites\) _applyTurnEpoch\(sessionTurnEpoch\(VS\.session\)\);/);
  assert.match(vtt, /if \(_turnEpochApplied != null && epoch <= _turnEpochApplied\) return;/);
  assert.match(vtt, /let data=normalizeTurnFlags\(\{id,\.\.\.ch\.doc\.data\(\)\}, _turnEpoch\(\)\);/);
  // Écrivains : drag groupe/seul, _moveTo, annulation, clavier, Courir, action utilisée.
  assert.match(vtt, /patch:_stampTurn\(tokenData, movePatch\)/);
  assert.match(vtt, /patch=_stampTurn\(moveCur, patch\);/);
  assert.match(vtt, /patch = _stampTurn\(cur, patch\);/);
  assert.match(vtt, /const patch = _stampTurn\(token, \{\n\s*col: Number\(origin\.col\)/);
  assert.match(vtt, /patch:_stampTurn\(move\.token, patch\)/);
  assert.match(vtt, /const patch = _stampTurn\(tok, \{ bonusMvt: bonus \}\);/);
  assert.match(vtt, /const stamped = _stampTurn\(src, patch\);/);
  // Combat : nouvelle époque écrite avec la session, appliquée après succès.
  assert.equal((turns.match(/const updates = _turnResetPatch\(tokData, epoch\);/g) || []).length, 2);
  assert.equal((turns.match(/if \(epoch != null\) _applyTurnEpoch\(epoch\);/g) || []).length, 2);
  assert.match(turns, /stampTurnPatch\(token, \{ \.\.\.TURN_FLAG_RESET \}, _turnEpoch\(\)\)/);
  assert.match(turns, /stampTurnPatch\(token, \{ \[field\]: !token\[field\] \}, _turnEpoch\(\)\)/);
  // Règle : le propriétaire/délégué peut dater ses drapeaux.
  const rules = readFileSync(new URL('../docs/firestore-rules.md', import.meta.url), 'utf8');
  assert.match(rules, /'attackedThisTurn', 'bonusActionThisTurn', 'reactionThisTurn', 'turnEpoch',/);
});

test('aucun autre écrivain ne pose un drapeau de tour sans passer par la datation', () => {
  const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
  // Toute écriture Firestore directe d'un patch littéral contenant un drapeau de tour
  // (hors créations de token, où ils valent false) est interdite.
  const offenders = [...vtt.matchAll(/updateDoc\(_tokRef\([^)]*\),\s*\{([^}]*)\}/g)]
    .filter(m => TURN_FLAG_KEYS.some(key => new RegExp(`\\b${key}\\b`).test(m[1])));
  assert.deepEqual(offenders.map(m => m[0]), []);
});
