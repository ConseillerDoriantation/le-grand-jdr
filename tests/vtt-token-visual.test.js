import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  tokenActiveEffects,
  tokenDeltaMeta,
  tokenDetailLevel,
  tokenEffectsSignature,
  tokenHealthMeta,
  tokenVisibleHealthMeta,
  tokenFootprintMeta,
  tokenFootprintIntersectsZone,
  tokenMovementMeta,
  tokenEffectTint,
  tokenNameParts,
  tokenOrdinal,
  tokenPlateFit,
  tokenRelationTone,
  tokenHiddenHealthRatio,
  tokenResourceArcs,
  normalizeTokenTurnOrder,
} from '../assets/js/features/vtt/vtt-token-visual.js';
import { characterPortraitSrc } from '../assets/js/shared/portraits.js';

const vttSource = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const renderSource = readFileSync(new URL('../assets/js/features/vtt/vtt-render.js', import.meta.url), 'utf8');
const effectiveSource = readFileSync(new URL('../assets/js/features/vtt/vtt-effective.js', import.meta.url), 'utf8');
const vttCss = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('les doublons conservent leur base, leur premier mot et leur ordinal', () => {
  assert.deepEqual(tokenNameParts('Gobelin archer 3'), {
    full:'Gobelin archer 3', base:'Gobelin archer', first:'Gobelin', ordinal:3,
  });
  assert.deepEqual(tokenNameParts("Aelys Vent-d'Or"), {
    full:"Aelys Vent-d'Or", base:"Aelys Vent-d'Or", first:'Aelys', ordinal:null,
  });
  assert.equal(tokenOrdinal('Gobelin', ['Gobelin 2']), 1);
  assert.equal(tokenOrdinal('Gobelin', ['Gobelin archer']), null);
  assert.equal(tokenOrdinal('Gobelin 3', ['Gobelin']), 3);
});

test('la plaque replie le nom puis la valeur sans jamais dépasser sa case', () => {
  const measure = text => String(text || '').length * 5;
  const common = { names:['Gobelin archer', 'Gobelin'], value:'Critique', maxWidth:100, left:8, right:8, gap:4, measure };
  const full = tokenPlateFit({ ...common, maxWidth:130 });
  const first = tokenPlateFit(common);
  const droppedFull = tokenPlateFit({ ...common, maxWidth:86, dropValue:true });
  const truncated = tokenPlateFit({ ...common, maxWidth:43 });
  assert.equal(full.name, 'Gobelin archer');
  assert.equal(full.value, 'Critique');
  assert.equal(first.name, 'Gobelin');
  assert.equal(first.value, 'Critique');
  assert.equal(droppedFull.name, 'Gobelin archer');
  assert.equal(droppedFull.value, '');
  assert.equal(droppedFull.dropped, true);
  assert.match(truncated.name, /…$/);
  [full, first, droppedFull, truncated].forEach(result => assert.ok(result.width <= (result === full ? 130 : result === droppedFull ? 86 : result === truncated ? 43 : 100)));
});

test('la teinte d’effet reste sombre même à partir d’un rouge vif', () => {
  const tint = tokenEffectTint('#dc2626');
  const rgb = tint.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  assert.ok(luminance < .08, `${tint} doit rester sombre`);
});

test('le médaillon v2 conserve la géométrie compacte du handoff', () => {
  assert.match(renderSource, /radius=6\.1\*scale, gap=14\.6\*scale/);
  assert.match(renderSource, /centerX=size>=2\?0:-6\.5, y=-ringRadius\+\.5/);
  assert.match(renderSource, /fill:tokenEffectTint\(effect\.color\),stroke,strokeWidth:1\.4/);
  assert.match(renderSource, /fontSize:8\.4\*scale[\s\S]*?fill:'#f8fafc'/);
  assert.match(renderSource, /counters\.forEach\(node=>rail\.add\(node\)\)/);
  assert.match(renderSource, /counterX=_caX\+_caW-2\.5\*scale, counterY=_caY\+_caH-3\.5\*scale/);
  assert.match(renderSource, /radius:4\.6\*scale/);
  assert.match(renderSource, /fontSize:6\.4\*scale/);
});

test('les plaques v2 restent dans l’emprise et ne réaffichent pas une valeur abandonnée', () => {
  assert.match(renderSource, /measureText\(value\)\.width \+ \.75/);
  assert.match(renderSource, /fontSize=8\.7\*scale, plateH=12\.5\*scale, maxW=footprintW-3/);
  assert.match(renderSource, /plateY=Math\.min\(footprintH\/2-plateH-1,ringRadius-plateH\/2\+1\.5\*size\)/);
  assert.match(renderSource, /const reserve=!value \? \[\] : level==='standard' \|\| isDown/);
  assert.match(renderSource, /tokenPlateFit\(\{/);
  assert.match(renderSource, /setAttr\('plateValueDropped',true\)/);
  assert.match(vttSource, /shape\.getAttr\('plateValueDropped'\)/);
  assert.doesNotMatch(renderSource, /token-footprint-size/);
  assert.doesNotMatch(renderSource, /plate\.add\(new K\.Circle/);
});

test('les pairs d’un doublon sont repatchés à son ajout ou à sa suppression', () => {
  assert.match(vttSource, /const ordinalPeerKeys = new Set\(\)/);
  assert.match(vttSource, /ch\.type==='added' \|\| ch\.type==='removed'/);
  assert.match(vttSource, /ordinalPeerKeys\.has\(_tokenOrdinalKey\(entry\.data\)\)/);
  assert.match(vttSource, /ordinalMismatch/);
});

test('la plaque est reconstruite quand une réserve structurelle change', () => {
  assert.match(renderSource, /setAttr\('movementMaximumSnapshot', movementMaximum\)/);
  assert.match(renderSource, /canMoveInCombat && Number\.isFinite\(Number\(ld\.displayMovement\)\)/);
  assert.match(vttSource, /_buildTokenVisual\(t, ld, CONDITION_BY_ID, _tokenPeerNames\(t\), _canControlToken\(t\)\)/);
  assert.match(vttSource, /const downMismatch=/);
  assert.match(vttSource, /const hpMaxMismatch=/);
  assert.match(vttSource, /const movementMaximumMismatch=/);
  assert.match(vttSource, /downMismatch \|\| hpMaxMismatch \|\| movementMaximumMismatch/);
});

test('le portrait actif de la fiche remplace immédiatement les anciennes images VTT', () => {
  assert.equal(characterPortraitSrc({ photo:'nouveau', photoURL:'ancien', avatar:'avatar' }), 'nouveau');
  assert.equal(characterPortraitSrc({ photoURL:'ancien', avatar:'avatar' }), 'ancien');
  assert.match(effectiveSource, /characterPortraitSrc\(c\) \|\| t\.imageUrl/);
  assert.match(vttSource, /const changed = _changedEntityIds\(prev, next\)[\s\S]*?_patchShape\(id\)/);
  assert.match(vttSource, /if \(changed\.size\) \{[\s\S]*?_renderCombatTrackerSoon\(\)[\s\S]*?_renderPresenceCol\(\)/);
});

test('l’empreinte tactique distingue un portrait rond d’un token 3×3', () => {
  assert.deepEqual(tokenFootprintMeta(3, 3), {
    width: 3, height: 3, isLarge: true, label: '3×3',
  });
  assert.equal(tokenFootprintMeta(1, 1).isLarge, false);
  assert.deepEqual(tokenFootprintMeta(99, 0), {
    width: 5, height: 1, isLarge: true, label: '5×1',
  });
});

test('la santé d’un token distingue état inconnu, blessure et mise à terre', () => {
  assert.equal(tokenHealthMeta(null, null).tone, 'unknown');
  assert.equal(tokenHealthMeta(80, 100).tone, 'healthy');
  assert.equal(tokenHealthMeta(50, 100).tone, 'wounded');
  assert.equal(tokenHealthMeta(20, 100).tone, 'critical');
  assert.deepEqual(
    { label: tokenHealthMeta(0, 100).label, down: tokenHealthMeta(0, 100).isDown },
    { label: 'À terre', down: true },
  );
});

test('une estimation joueur à zéro ne tue jamais une créature encore vivante', () => {
  const wrongEstimate=tokenVisibleHealthMeta(0,20,{hidden:true,actualDown:false});
  assert.equal(wrongEstimate.current,0);
  assert.equal(wrongEstimate.isDown,false);
  assert.equal(wrongEstimate.label,'Critique');
  assert.equal(tokenVisibleHealthMeta(8,20,{hidden:true,actualDown:true}).isDown,true);
  assert.equal(tokenVisibleHealthMeta(0,20,{hidden:false,actualDown:false}).isDown,true);
});

test('le rail fusionne états et effets actifs avec leur durée restante', () => {
  const token = {
    conditions: [
      { id: 'ralenti', expiresAtRound: 4 },
      { id: 'expire', expiresAtRound: 2 },
    ],
    buffs: [{ type: 'regen', sortLabel: 'Sève vitale', expiresAtRound: 5 }],
  };
  const effects = tokenActiveEffects(token, {
    ralenti: { icon: '🐌', color: '#38bdf8', label: 'Ralenti' },
    expire: { icon: '×', label: 'Expiré' },
  }, 3);

  assert.deepEqual(effects.map(effect => effect.label), ['Ralenti', 'Régénération']);
  assert.deepEqual(effects.map(effect => effect.turnsLeft), [2, 3]);
  assert.match(tokenEffectsSignature(effects), /condition:ralenti/);
  assert.match(tokenEffectsSignature(effects), /buff:regen/);
  assert.deepEqual(effects.map(effect => effect.tone), ['negative', 'positive']);
});

test('le niveau de détail suit le zoom sans masquer les ressources graphiques', () => {
  assert.equal(tokenDetailLevel(0.45), 'compact');
  assert.equal(tokenDetailLevel(0.7), 'standard');
  assert.equal(tokenDetailLevel(0.85), 'detailed');
  assert.equal(tokenDetailLevel(1), 'detailed');
});

test('les PV ennemis masqués utilisent des paliers sans révéler leur valeur exacte', () => {
  assert.equal(tokenHiddenHealthRatio('critical'), 0.18);
  assert.equal(tokenHiddenHealthRatio('wounded'), 0.42);
  assert.equal(tokenHiddenHealthRatio('hurt'), 0.66);
  assert.equal(tokenHiddenHealthRatio('healthy'), 1);
  assert.equal(tokenHiddenHealthRatio('down'), 0);
  assert.equal(tokenHiddenHealthRatio('inconnu'), 0.5);
});

test('les arcs PV et PM suivent la géométrie du médaillon et se remplissent depuis le bas', () => {
  assert.deepEqual(tokenResourceArcs({ hpRatio:0.5 }), {
    hpTrack:{ start:198, span:324 }, hpFill:{ start:198, span:162 }, pmTrack:null, pmFill:null,
  });
  assert.deepEqual(tokenResourceArcs({ hasMana:true, hpRatio:0.5, pmRatio:0.4 }), {
    hpTrack:{ start:198, span:155 }, hpFill:{ start:198, span:77.5 },
    pmTrack:{ start:7, span:155 }, pmFill:{ start:100, span:62 },
  });
  assert.equal(tokenResourceArcs({ hpRatio:1, down:true }).hpFill.span, 0);
});

test('le survol d’un token affiche une infobulle détaillée et réactive', () => {
  assert.match(vttSource, /className='vtt-token-tooltip'/);
  assert.match(vttSource, /tokenFootprintMeta[^\n]*from '\.\/vtt-token-visual\.js'/);
  assert.match(vttSource, /g\.on\('mouseenter pointerenter',e=>_showTokenTooltip/);
  assert.match(vttSource, /_refreshTokenTooltipIfOpen\(id\)/);
  assert.match(vttCss, /\.vtt-token-tooltip\s*\{/);
  assert.match(vttCss, /\.vtt-token-tip-meter\s*\{/);
  assert.match(vttCss, /@media \(any-hover: none\) and \(any-pointer: coarse\)/);
});

test('une attaque joueur patche immédiatement son estimation avant Firestore', () => {
  assert.match(vttSource, /_patchEnemyHpEstimateOptimistically\(curTgtData,newEst,estimateMax\)/);
  const attackPatch=vttSource.match(/const previousEstimate=_patchEnemyHpEstimateOptimistically[\s\S]*?targetWrite = updateDoc/)?.[0]||'';
  assert.ok(attackPatch.indexOf('_patchEnemyHpEstimateOptimistically') < attackPatch.indexOf('_patchHpOptimistically'));
  assert.ok(attackPatch.indexOf('_patchHpOptimistically') < attackPatch.indexOf('updateDoc'));
  assert.match(vttSource, /hiddenHealth&&!health\.known\?tokenHiddenHealthRatio/);
});

test('le flash de dégâts ne bloque jamais l’application des ressources', () => {
  assert.doesNotMatch(vttSource, /flash\.stop\(/);
  assert.match(vttSource, /flash\.to\(\{opacity:0,duration:\.45/);
});

test('la mini-fiche patche PV et PM avant l’acquittement Firestore', () => {
  const hpSetter=vttSource.match(/async function _vttMsSetHp[\s\S]*?\n\}/)?.[0]||'';
  const pmSetter=vttSource.match(/async function _vttMsSetPm[\s\S]*?\n\}/)?.[0]||'';
  assert.ok(hpSetter.indexOf('c.hp = val') < hpSetter.indexOf('await updateDoc'));
  assert.ok(pmSetter.indexOf('Object.assign(c, _charPmPatch(val))') < pmSetter.indexOf('await updateDoc'));
  assert.match(hpSetter, /_patchEntityTokenShapes\('characterId', charId\)/);
  assert.match(pmSetter, /_patchEntityTokenShapes\('characterId', charId\)/);
});

test('le ciblage distingue allié, adversaire et action amicale', () => {
  const player = { type: 'player' };
  assert.equal(tokenRelationTone(player, { type: 'npc' }), 'friendly');
  assert.equal(tokenRelationTone(player, { type: 'enemy' }), 'hostile');
  assert.equal(tokenRelationTone(player, { type: 'enemy' }, true), 'friendly');
});

test('les variations de ressources produisent un libellé court et cohérent', () => {
  assert.deepEqual(
    { label:tokenDeltaMeta(-12, 'hp').label, color:tokenDeltaMeta(-12, 'hp').color },
    { label:'−12 PV', color:'#fb7185' },
  );
  assert.equal(tokenDeltaMeta(3, 'pm').label, '+3 PM');
  assert.equal(tokenDeltaMeta(0, 'hp'), null);
});

test('une AoE utilise toute l’empreinte des tokens, y compris sur ses bords', () => {
  const zone = { x:2.5, y:2.5, width:3, height:3, shape:'rect', cellSize:1 };
  assert.equal(tokenFootprintIntersectsZone({ col:1, row:1, width:1, height:1 }, zone), true);
  assert.equal(tokenFootprintIntersectsZone({ col:3, row:2, width:2, height:2 }, zone), true);
  assert.equal(tokenFootprintIntersectsZone({ col:0, row:2, width:1, height:1 }, zone), false);
  assert.equal(tokenFootprintIntersectsZone({ col:5, row:2, width:1, height:1 }, zone), false);
});

test('une AoE 3×3 détecte bien neuf tokens occupant ses neuf cases', () => {
  const zone = { x:1.5, y:1.5, width:3, height:3, shape:'rect', cellSize:1 };
  const targets = Array.from({ length:9 }, (_, index) => ({
    col:index % 3, row:Math.floor(index / 3), width:1, height:1,
  }));
  assert.equal(targets.filter(token => tokenFootprintIntersectsZone(token, zone)).length, 9);
});

test('le mouvement restant tient compte de la course et ne devient jamais négatif', () => {
  assert.deepEqual(tokenMovementMeta(6, 6, 8), { maximum:12, used:8, remaining:4, exhausted:false });
  assert.deepEqual(tokenMovementMeta(6, 0, 9), { maximum:6, used:9, remaining:0, exhausted:true });
});

test('l’ordre de passage reste stable, élimine les doublons et ajoute les nouveaux tokens', () => {
  const tokens=[
    {id:'enemy',type:'enemy',name:'Ogre'},
    {id:'alice',type:'player',name:'Alice'},
    {id:'bob',type:'player',name:'Bob'},
  ];
  assert.deepEqual(normalizeTokenTurnOrder(['bob','missing','bob'],tokens), ['bob','alice','enemy']);
  assert.deepEqual(normalizeTokenTurnOrder([],tokens), ['alice','bob','enemy']);
});
