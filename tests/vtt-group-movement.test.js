import test from 'node:test';
import assert from 'node:assert/strict';

import { planGroupGridStep } from '../assets/js/features/vtt/vtt-group-movement.js';

test('les flèches déplacent tout le groupe sans déformer sa formation', () => {
  const tokens=[
    { id:'a', col:2, row:3, tokenW:1, tokenH:1 },
    { id:'b', col:5, row:4, tokenW:3, tokenH:2 },
  ];
  const plan=planGroupGridStep(tokens, {
    dc:1, dr:-1, cols:12, rows:10,
    getDimensions:token=>({ w:token.tokenW, h:token.tokenH }),
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.moves.map(({token,col,row,distance})=>({id:token.id,col,row,distance})), [
    { id:'a', col:3, row:2, distance:2 },
    { id:'b', col:6, row:3, distance:2 },
  ]);
});

test('si un seul token touche le bord, aucun déplacement groupé n’est préparé', () => {
  const plan=planGroupGridStep([
    { id:'a', col:0, row:2 },
    { id:'b', col:4, row:2 },
  ], { dc:-1, dr:0, cols:8, rows:8 });
  assert.deepEqual(plan, { ok:false, reason:'bounds', tokenId:'a', moves:[] });
});
