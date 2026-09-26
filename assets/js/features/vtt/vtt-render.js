// ══════════════════════════════════════════════════════════════════════════════
// VTT — Rendu Konva (moteur de scène)
// ──────────────────────────────────────────────────────────────────────────────
// Extraction progressive du cœur de rendu hors de vtt.js (cf.
// docs/vtt-decomposition.md). Chaque renderer dessine sur les calques Konva
// partagés (VS.layers) à partir de l'état (VS) + constantes (CELL).
// Konva est chargé sur window.Konva par _loadKonva (reste dans vtt.js).
//
// Tranche 1 : la grille (renderer leaf — rien ne le rappelle).
// ══════════════════════════════════════════════════════════════════════════════
import { VS } from './vtt-state.js';
import { CELL, TYPE_COLOR } from './vtt-constants.js';
import { STATE } from '../../core/state.js';
import { updateDoc } from '../../config/firebase.js';
import { normalizeImageUrl } from '../../shared/html.js';
import { githubPagesUrl } from '../../shared/github-folder.js';
import { _pgRef } from './vtt-refs.js';
import { _showCtxMenu } from './vtt-utils.js';
import { showNotif } from '../../shared/notifications.js';
import {
  tokenActiveEffects,
  tokenEffectsSignature,
  tokenFootprintMeta,
  tokenHiddenHealthRatio,
  tokenResourceArcs,
  tokenVisibleHealthMeta,
} from './vtt-token-visual.js';
import { _cellInShape } from '../../shared/spell-zones.js';

/**
 * Surligne EN CASES une zone de forme (cône/anneau/losange/croix). Retourne un
 * tableau de K.Rect (1 par case couverte), centré sur (0,0). zw/zh = taille px de
 * la bounding-box. Même prédicat _cellInShape que le ciblage → parfaite cohérence.
 */
export function _zoneCellRects(K, zw, zh, shape, dir = 'down', style = {}) {
  const cols = Math.max(1, Math.round(zw / CELL));
  const rows = Math.max(1, Math.round(zh / CELL));
  const ox = -cols * CELL / 2, oy = -rows * CELL / 2;
  const out = [];
  for (let ri = 0; ri < rows; ri += 1) {
    for (let ci = 0; ci < cols; ci += 1) {
      if (!_cellInShape(shape, ci, ri, cols, rows, dir)) continue;
      out.push(new K.Rect({ x: ox + ci * CELL, y: oy + ri * CELL, width: CELL, height: CELL, ...style }));
    }
  }
  return out;
}
import { vttCanvasPixelRatio, vttDefaultLowFx, vttIsPhoneViewport } from './vtt-fog-performance.js';

const _tokenImageCache = new Map();

// ── Mode Performance (fluidité joueurs) ─────────────────────────────────────
// Les ombres Konva (shadowBlur) et un DPR élevé sont les coûts de rendu
// dominants sur les machines modestes (recalculés à CHAQUE redraw : déplacement,
// PV, ping, pan/zoom). Ce mode les coupe. Défaut : auto-activé sur les appareils
// détectés comme contraints ; surchargeable manuellement (persisté par client).
let _vttLowFxCache = null;
export function vttLowFx() {
  if (_vttLowFxCache !== null) return _vttLowFxCache;
  let v = null;
  try { const s = localStorage.getItem('vtt.lowFx'); if (s === '1') v = true; else if (s === '0') v = false; } catch {}
  // Défaut (aucun choix explicite stocké) : les JOUEURS et tous les téléphones
  // démarrent en Mode performance. Le MJ desktop garde le rendu complet, sauf
  // machine détectée comme faible. Le bouton ⚡ surcharge dans les deux sens.
  const phone = vttIsPhoneViewport(
    window.innerWidth, window.innerHeight,
    !!window.matchMedia?.('(pointer: coarse)')?.matches,
    navigator.maxTouchPoints,
  );
  if (v === null) v = vttDefaultLowFx({
    isAdmin: STATE.isAdmin,
    isPhone: phone,
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
  _vttLowFxCache = !!v;
  return _vttLowFxCache;
}
export function setVttLowFx(on) {
  _vttLowFxCache = !!on;
  try { localStorage.setItem('vtt.lowFx', on ? '1' : '0'); } catch {}
}

function _addTokenPortrait(portrait, fallback, src, radius) {
  const attach = image => {
    // Le token a pu être reconstruit/supprimé pendant le chargement.
    if (!portrait.getParent()) return;
    const iw=Math.max(1,image.naturalWidth||image.width||1);
    const ih=Math.max(1,image.naturalHeight||image.height||1);
    const side=Math.min(iw,ih);
    const node=new window.Konva.Image({
      image, x:-radius, y:-radius, width:radius*2, height:radius*2,
      crop:{x:(iw-side)/2,y:(ih-side)/2,width:side,height:side}, listening:false,name:'portrait-image',
    });
    portrait.add(node);
    if (portrait.getAttr('isDownPortrait') && window.Konva.Filters?.Grayscale) {
      node.cache({pixelRatio:1});
      node.filters([window.Konva.Filters.Grayscale]);
      node.setAttr('vttGrayscale',true);
    }
    fallback.visible(false);
    VS.layers.token?.batchDraw();
  };
  const cached = _tokenImageCache.get(src);
  if (cached?.complete && cached.naturalWidth) {
    attach(cached);
    return;
  }
  const image = cached || new Image();
  image.addEventListener('load', () => attach(image), { once:true });
  if (!cached) {
    image.crossOrigin = 'anonymous';
    image.addEventListener('error', () => _tokenImageCache.delete(src), { once:true });
    _tokenImageCache.set(src, image);
    image.src = src;
  }
}

function _resolveMapImageUrl(url, sourcePath = '') {
  const raw = String(sourcePath || url || '').trim();
  if (/^\.?\/?images\/maps\//i.test(raw) || /(?:raw\.githubusercontent\.com|github\.com\/[^/]+\/[^/]+\/(?:blob|tree))\//i.test(raw)) {
    return githubPagesUrl(raw);
  }
  return normalizeImageUrl(String(url || raw).trim());
}

/** Charge Konva (vendored) sur window.Konva si pas déjà présent. */
export async function _loadKonva() {
  if (!window.Konva) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './assets/js/vendor/konva-10.3.0.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Konva.js introuvable'));
      document.head.appendChild(s);
    });
  }
  // Konva multiplie sinon chaque canvas par le DPR natif (jusqu'à 3× sur
  // certains portables). Le coût GPU/mémoire est quadratique et n'apporte rien
  // de perceptible sur une battlemap. Les machines modestes restent à 1×.
  window.Konva.pixelRatio = vttLowFx() ? 1 : vttCanvasPixelRatio(
    window.devicePixelRatio,
    navigator.deviceMemory,
    navigator.hardwareConcurrency,
  );
}

/** Convertit une position écran (pointeur) en coordonnées monde (avant grille). */
export function _stageToWorld(ptr) {
  const sc = VS.stage.scaleX(), sp = VS.stage.position();
  return { x: (ptr.x - sp.x) / sc, y: (ptr.y - sp.y) / sc };
}

// ── Construction visuelle d'un token (Konva) ─────────────────────────────────
// Partie PURE-RENDU de _buildShape : forme, anneaux sél/atk, barres HP/PM, badges
// CA/états/buffs, nom, portrait clippé. AUCUN handler d'interaction (ceux-ci
// restent dans vtt.js, attachés au groupe retourné). `ld` = données effectives
// (calculées par _live côté vtt.js), `condById` = index des conditions.
function _tokenArc(K, { x=0, y=0, radius, width, start, span, fill, name='', visible=true }) {
  return new K.Arc({
    x, y, innerRadius:Math.max(0,radius-width/2), outerRadius:radius+width/2,
    rotation:start-90, angle:Math.max(.001,span), fill, visible:visible&&span>.001,
    listening:false, name,
  });
}

function _tokenBrackets(K, width, height, color, dashed=false, name='') {
  const inset=2.5, length=Math.min(14,width*.22);
  const left=-width/2+inset, right=width/2-inset;
  const top=-height/2+inset, bottom=height/2-inset;
  return [
    [left+length,top,left,top,left,top+length],
    [right-length,top,right,top,right,top+length],
    [left,bottom-length,left,bottom,left+length,bottom],
    [right-length,bottom,right,bottom,right,bottom-length],
  ].map(points=>new K.Line({
    points,stroke:color,strokeWidth:2.5,dash:dashed?[4,3]:[],lineCap:'round',lineJoin:'round',
    listening:false,name,
  }));
}

function _tokenShieldPath(width, height) {
  return `M${width/2} 0L${width} ${height*.16}V${height*.52}`
    + `C${width} ${height*.8} ${width*.72} ${height*.93} ${width/2} ${height}`
    + `C${width*.28} ${height*.93} 0 ${height*.8} 0 ${height*.52}V${height*.16}Z`;
}

export function _buildTokenVisual(t, ld, condById) {
  const K  = window.Konva;
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const footprint = tokenFootprintMeta(sw, sh);
  const footprintW = CELL * footprint.width;
  const footprintH = CELL * footprint.height;
  const size=Math.min(sw,sh), scale=Math.min(size,1.6);
  const ringRadius=28*size, portraitRadius=22.5*size, ringWidth=4.6*scale;
  const typeColor = TYPE_COLOR[t.type] ?? '#94a3b8';
  const hiddenHealth=!STATE.isAdmin && t.type==='enemy';
  const health = tokenVisibleHealthMeta(ld.displayHp, ld.displayHpMax, {
    hidden:hiddenHealth,
    actualDown:!!ld.isDown,
  });
  const isDown = health.isDown;
  // Une valeur connue ici est l'estimation propre au joueur : afficher sa
  // progression exacte ne révèle aucun PV MJ et rend chaque dégât visible.
  const healthRatio=isDown?0:(hiddenHealth&&!health.known?tokenHiddenHealthRatio(health.tone):health.ratio);
  const hasMana=!hiddenHealth && (ld.displayPm!=null || ld.hasMana);
  const pmMax=Number(ld.displayPmMax);
  const pmRatio=ld.displayPm!=null && Number.isFinite(pmMax) && pmMax>0
    ? Math.min(1,Math.max(0,Number(ld.displayPm)/pmMax)) : 0;
  const arcs=tokenResourceArcs({hasMana,hpRatio:healthRatio,pmRatio,down:isDown});
  const round = VS.session?.combat?.round ?? 0;
  const effects = tokenActiveEffects(t, condById, round);
  const g = new K.Group({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2, id:`tok-${t.id}` });
  g.setAttr('tokenW', sw);
  g.setAttr('tokenH', sh);
  g.setAttr('displayImage', ld.displayImage || null);
  g.setAttr('effectSignature', tokenEffectsSignature(effects));
  g.setAttr('activeEffectsSnapshot', effects.map(({kind,key,icon,label})=>({kind,key,icon,label})));
  g.setAttr('healthTone', health.tone);
  g.setAttr('healthLabel', isDown ? (size>1?'À terre':'KO') : health.label);
  g.setAttr('healthColor', health.color);
  g.setAttr('isDownSnapshot', isDown);
  g.setAttr('displayHpSnapshot', health.known ? health.current : null);
  g.setAttr('displayHpMaxSnapshot', health.known ? health.maximum : null);
  g.setAttr('displayPmSnapshot', ld.displayPm == null ? null : Number(ld.displayPm));
  g.setAttr('displayPmMaxSnapshot', Number.isFinite(Number(ld.displayPmMax)) ? Number(ld.displayPmMax) : null);
  g.setAttr('hiddenHealth', hiddenHealth);
  g.setAttr('hasManaRing', hasMana);
  g.setAttr('stackCount', 1);

  const footprintX=-footprintW/2+2, footprintY=-footprintH/2+2;
  const footprintInnerW=footprintW-4, footprintInnerH=footprintH-4;
  if (footprint.isLarge) {
    g.add(new K.Rect({
      x:footprintX, y:footprintY, width:footprintInnerW, height:footprintInnerH,
      cornerRadius:6, fill:'rgba(15,23,42,.14)', stroke:'rgba(226,232,240,.35)',
      strokeWidth:1.2, dash:[6,4], listening:true, name:'token-hit token-footprint',
    }));
    const badgeX=footprintW/2-30, badgeY=footprintH/2-17;
    g.add(new K.Rect({
      x:badgeX, y:badgeY, width:26, height:13, cornerRadius:6.5,
      fill:'rgba(5,8,14,.9)', stroke:'rgba(226,232,240,.3)', strokeWidth:1,
      listening:false, name:'token-footprint-size token-noncompact',
    }));
    g.add(new K.Text({
      x:badgeX, y:badgeY+2, width:26, height:9, text:footprint.label,
      align:'center', fontSize:8, fontStyle:'bold', fill:'#cbd5e1',
      fontFamily:'Inter,sans-serif', listening:false, name:'token-footprint-size token-noncompact',
    }));
  }

  // États tactiques sur toute l'emprise, sans modifier la hitbox.
  g.add(new K.Rect({x:-footprintW/2+1.5,y:-footprintH/2+1.5,width:footprintW-3,height:footprintH-3,
    cornerRadius:7,fill:'rgba(79,140,255,.10)',visible:false,listening:false,name:'sel-footprint'}));
  const selection=new K.Group({visible:false,listening:false,name:'sel'});
  _tokenBrackets(K,footprintW,footprintH,'#60a5fa',false,'sel-bracket').forEach(node=>selection.add(node));
  g.add(selection);
  // Alias historique conservé pour la couche d'état, sans second anneau.
  g.add(new K.Group({visible:false,listening:false,name:'sel-spin'}));
  g.add(new K.Rect({x:-footprintW/2+1.5,y:-footprintH/2+1.5,width:footprintW-3,height:footprintH-3,
    cornerRadius:7,fill:'rgba(245,158,11,.07)',visible:false,listening:false,name:'atk-footprint'}));
  const attack=new K.Group({visible:false,listening:false,name:'atk'});
  _tokenBrackets(K,footprintW,footprintH,'#fbbf24',true,'atk-bracket').forEach(node=>attack.add(node));
  g.add(attack);
  g.add(new K.Rect({x:-footprintW/2+1.5,y:-footprintH/2+1.5,width:footprintW-3,height:footprintH-3,
    cornerRadius:7,fill:'rgba(239,68,68,.10)',stroke:'#ef4444',strokeWidth:1.5,dash:[5,4],
    visible:false,listening:false,name:'target-footprint'}));
  const target=new K.Group({visible:false,listening:false,name:'target'});
  [45,135,225,315].forEach(angle=>{
    const rad=(angle-90)*Math.PI/180;
    const r0=ringRadius+ringWidth/2+1.2;
    const r1=Math.min(ringRadius+ringWidth/2+5,Math.min(footprintW,footprintH)/2-1.8);
    target.add(new K.Line({points:[Math.cos(rad)*r0,Math.sin(rad)*r0,Math.cos(rad)*r1,Math.sin(rad)*r1],
      stroke:'#ef4444',strokeWidth:2.4,lineCap:'round',listening:false,name:'target-mark'}));
  });
  g.add(target);
  g.add(new K.Group({visible:false,listening:false,name:'target-inner'}));
  g.add(new K.Rect({x:footprintX,y:footprintY,width:footprintInnerW,height:footprintInnerH,
    cornerRadius:5,stroke:'#fb7185',strokeWidth:2.5,fill:'rgba(239,68,68,.08)',
    visible:false,listening:false,name:'reachable-footprint'}));

  g.add(new K.Circle({x:0,y:0,radius:ringRadius+ringWidth/2+2.2,stroke:'#facc15',strokeWidth:2.2*scale,
    shadowColor:'#f59e0b',shadowBlur:8,shadowOpacity:.8,fill:'transparent',
    visible:!!VS.session?.combat?.active&&VS.session?.combat?.activeTokenId===t.id,
    listening:false,name:'turn-active'}));

  // Ombre et anneau de ressources du médaillon.
  g.add(new K.Ellipse({x:0,y:3*size,radiusX:ringRadius+1,radiusY:ringRadius-1,fill:'rgba(0,0,0,.42)',
    shadowColor:'#000',shadowBlur:3*scale,shadowOpacity:.72,listening:false}));
  g.add(new K.Circle({x:0,y:0,radius:ringRadius,stroke:'rgba(4,7,12,.78)',strokeWidth:ringWidth+2.4,
    fill:'transparent',listening:false,name:'token-ring-underlay'}));
  g.add(_tokenArc(K,{radius:ringRadius,width:ringWidth,...arcs.hpTrack,fill:'rgba(255,255,255,.10)',name:'hp-track'}));
  g.add(_tokenArc(K,{radius:ringRadius,width:ringWidth,...arcs.hpFill,fill:health.color,name:'hp-fill'}));
  if (hasMana) {
    g.add(_tokenArc(K,{radius:ringRadius,width:ringWidth,...arcs.pmTrack,fill:'rgba(255,255,255,.10)',name:'pm-track'}));
    g.add(_tokenArc(K,{radius:ringRadius,width:ringWidth,...arcs.pmFill,fill:'#a78bfa',name:'pm-fill'}));
  }
  if (hiddenHealth&&!isDown) {
    [.25,.5,.75].forEach(part=>{
      const angle=arcs.hpTrack.start+arcs.hpTrack.span*part;
      const rad=(angle-90)*Math.PI/180;
      const inner=ringRadius-ringWidth/2-.5, outer=ringRadius+ringWidth/2+.5;
      g.add(new K.Line({points:[Math.cos(rad)*inner,Math.sin(rad)*inner,Math.cos(rad)*outer,Math.sin(rad)*outer],
        stroke:'rgba(4,7,12,.9)',strokeWidth:1.4,listening:false,name:'hp-hidden-tick'}));
    });
  }

  // Zone interactive : le disque du portrait, plus le rectangle de l'emprise
  // déjà écoutable pour les grands tokens. Tous les badges restent transparents.
  g.add(new K.Circle({x:0,y:0,radius:portraitRadius+1,fill:typeColor,opacity:.35,listening:true,name:'token-hit'}));

  const portrait = new K.Group({
    clipFunc: ctx => { ctx.arc(0,0,portraitRadius,0,Math.PI*2,false); },
    x:0,y:0,listening:false,name:'portrait',opacity:isDown ? .42 : 1,
  });
  portrait.setAttr('isDownPortrait',isDown);
  const summonIcon = t.summonKind === 'invocation' ? '🐾'
    : t.summonKind === 'sentinelle' ? '🪤'
      : t.summonKind === 'weapon' ? '⚔️' : '';
  const initials=String(ld.displayName||t.name||'?').trim().replace(/[^A-Za-zÀ-ÿ0-9 ]/g,'')
    .split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase()||'?';
  const fallback = new K.Text({
    x:-portraitRadius, y:-portraitRadius, width:portraitRadius*2, height:portraitRadius*2,
    text:summonIcon || initials,
    fontSize:Math.max(16,18*scale), fontStyle:'bold', fill:'#fff',
    align:'center', verticalAlign:'middle', fontFamily:'Inter,sans-serif',
    shadowColor:'#000', shadowBlur:4, shadowOpacity:.72, listening:false,
    name:'portrait-fallback',
  });
  portrait.add(fallback);
  g.add(portrait);
  const imgSrc = ld.displayImage;
  if (imgSrc) _addTokenPortrait(portrait,fallback,imgSrc,portraitRadius);
  g.add(new K.Circle({x:0,y:0,radius:portraitRadius,fill:'#ef4444',opacity:0,listening:false,name:'token-flash'}));
  g.add(new K.Circle({x:0,y:0,radius:portraitRadius+1,fill:'transparent',stroke:isDown?'#ef4444':typeColor,
    strokeWidth:2*scale,listening:false,name:'token-ring'}));

  g.add(new K.Circle({x:0,y:0,radius:portraitRadius,fill:'rgba(5,8,14,.58)',visible:isDown,listening:false,name:'down-overlay'}));
  g.add(new K.Text({x:-portraitRadius,y:-11*scale,width:portraitRadius*2,height:24*scale,text:'☠',fontSize:22*scale,
    align:'center', fill:'#fecaca', shadowColor:'#000', shadowBlur:6, shadowOpacity:1,
    visible:isDown, listening:false, name:'down-icon' }));

  const _buff = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _toursLeft = _buff
    ? (_buff.expiresAtRound != null && round > 0 ? _buff.expiresAtRound - round + 1 : _buff.totalDuration ?? '∞')
    : null;
  const _caW=17*scale,_caH=19*scale,_caX=footprintW/2-18*scale-1.5,_caY=-footprintH/2+1.5;
  g.add(new K.Path({x:_caX,y:_caY,data:_tokenShieldPath(_caW,_caH),
    fill:_buffed?'#1e1b50':'rgba(8,12,20,.94)',stroke:_buffed?'#a5b4fc':'rgba(203,213,225,.55)',
    strokeWidth:1.1,listening:false,name:'ca-bg token-noncompact'}));
  g.add(new K.Text({x:_caX,y:_caY+_caH*.34,width:_caW,height:_caH*.45,
    text:String(ld.caBadge??(ld.displayDefense??0)),fontSize:8.6*scale,fontStyle:'bold',
    fill:_buffed?'#c4b5fd':'#e2e8f0',fontFamily:'Inter,sans-serif',align:'center',
    listening:false,name:'ca-lbl token-noncompact'}));
  if (_buffed) {
    g.add(new K.Circle({x:_caX+_caW-1,y:_caY+_caH-3*scale,radius:4.4*scale,fill:'#312e81',stroke:'#a5b4fc',strokeWidth:.9,
      listening:false,name:'token-noncompact'}));
    g.add(new K.Text({x:_caX+_caW-1-4.4*scale,y:_caY+_caH-5.8*scale,width:8.8*scale,height:7*scale,
      text:String(_toursLeft),fontSize:5.8*scale,fontStyle:'bold',fill:'#e0e7ff',fontFamily:'Inter,sans-serif',align:'center',
      listening:false,name:'ca-buff-turns token-noncompact'}));
  }

  if (effects.length) {
    const addEffectRail=(level,slots)=>{
      const rail=new K.Group({visible:level==='detailed',listening:false,name:`effect-${level}`});
      const overflow=effects.length>slots?effects.length-(slots-1):0;
      const shown=effects.slice(0,overflow?slots-1:slots);
      const count=shown.length+(overflow?1:0), radius=5.8*scale, gap=15*scale;
      const centerX=size>=2?0:-6, y=-ringRadius-.5, start=centerX-(count-1)*gap/2;
      shown.forEach((effect,index)=>{
        const x=start+index*gap;
        const stroke=effect.tone==='negative'?'#fecaca':effect.tone==='positive'?'#bbf7d0':'#c7d2fe';
        rail.add(new K.Circle({x,y,radius,fill:effect.color,stroke,strokeWidth:1.3,listening:false}));
        rail.add(new K.Circle({x,y,radius:radius+1.2,fill:'transparent',stroke:'rgba(4,7,12,.85)',strokeWidth:1.2,listening:false}));
        rail.add(new K.Text({x:x-radius,y:y-radius*.6,width:radius*2,height:radius*1.3,text:effect.icon,
          fontSize:7*scale,align:'center',verticalAlign:'middle',fontFamily:'Inter,sans-serif',listening:false}));
        if(level==='detailed'&&effect.turnsLeft!=null){
          const expiring=effect.turnsLeft===1, bx=x+radius*.78, by=y+radius*.78;
          rail.add(new K.Circle({x:bx,y:by,radius:3.9*scale,fill:expiring?'#f97316':'#0f172a',
            stroke:expiring?'#fed7aa':'#94a3b8',strokeWidth:.8,listening:false}));
          rail.add(new K.Text({x:bx-4*scale,y:by-2.8*scale,width:8*scale,height:6*scale,text:String(effect.turnsLeft),
            fontSize:5.6*scale,fontStyle:'bold',align:'center',fill:'#fff',listening:false}));
        }
      });
      if(overflow){
        const x=start+shown.length*gap;
        rail.add(new K.Circle({x,y,radius,fill:'#334155',stroke:'#94a3b8',strokeWidth:1,listening:false}));
        rail.add(new K.Text({x:x-radius,y:y-radius*.55,width:radius*2,height:radius*1.2,text:`+${overflow}`,
          fontSize:6.6*scale,fontStyle:'bold',align:'center',fill:'#fff',listening:false}));
      }
      g.add(rail);
    };
    addEffectRail('detailed',size>=2?5:3);
    addEffectRail('standard',2);
    const negative=effects.some(effect=>effect.tone==='negative');
    g.add(new K.Circle({x:0,y:-ringRadius,radius:4.2*scale,fill:negative?'#ef4444':'#22c55e',
      stroke:'rgba(4,7,12,.9)',strokeWidth:1.5,visible:false,listening:false,name:'effect-compact'}));
  }

  const fullName=String(ld.displayName??t.name??'?');
  const firstName=fullName.split(/[ ']/)[0]||fullName;
  const addNamePlate=(level,name,value)=>{
    const fontSize=8.3*scale, plateH=12.5*scale;
    // À fort niveau de détail, le cartouche peut dépasser légèrement de la case :
    // un nom + « Critique/Blessé » doit rester lisible au lieu d'être réduit à
    // deux fragments. Il reste non-interactif et ne gêne donc pas les tokens voisins.
    const maxW=level==='detailed'
      ? Math.max(footprintW-2,Math.min(132*scale,footprintW+72*scale))
      : Math.max(footprintW-2,74*scale);
    const reservedValue=value||(level==='standard'?'KO':'');
    const valueW=reservedValue?Math.min(maxW*.42,Math.max(12*scale,String(reservedValue).length*fontSize*.58)):0;
    const preferred=Math.max(34*scale,(name.length*fontSize*.56)+valueW+18*scale);
    const plateW=Math.min(maxW,preferred), plateY=Math.min(footprintH/2-plateH,ringRadius-plateH/2+1.5*size);
    const plate=new K.Group({x:-plateW/2,y:plateY,visible:level==='detailed',listening:false,
      name:`token-name token-name-${level}`});
    plate.add(new K.Rect({x:0,y:0,width:plateW,height:plateH,cornerRadius:plateH/2,fill:'rgba(6,9,15,.94)',
      stroke:`${typeColor}b3`,strokeWidth:1,name:level==='detailed'?'name-bg move-badge':'name-bg'}));
    plate.add(new K.Circle({x:6.5*scale,y:plateH/2,radius:2.2*scale,fill:typeColor}));
    plate.add(new K.Text({x:10*scale,y:0,width:Math.max(4,plateW-14*scale-valueW),height:plateH,text:name,
      fontSize,fontStyle:'bold',fill:isDown?'#94a3b8':'#f1f5f9',ellipsis:true,wrap:'none',verticalAlign:'middle',
      fontFamily:'Inter,sans-serif',name:`lbl lbl-${level}`}));
    if(value||level==='standard'){
      plate.add(new K.Text({x:plateW-valueW-4*scale,y:0,width:valueW,height:plateH,text:String(value),fontSize,fontStyle:'bold',
        fill:health.color,align:'right',verticalAlign:'middle',fontFamily:'Inter,sans-serif',
        name:level==='detailed'?'name-value move-value':'name-value standard-health-value'}));
    }
    g.add(plate);
  };
  const detailedValue=isDown?(size>1?'À terre':'KO'):(hiddenHealth?health.label:(health.known?String(health.current):'?'));
  addNamePlate('detailed',fullName,detailedValue);
  addNamePlate('standard',firstName,isDown?'KO':'');

  const stackX=-footprintW/2+1.5, stackY=-6.5*scale;
  g.add(new K.Rect({ x:stackX, y:stackY, width:19*scale, height:13*scale, cornerRadius:6.5*scale,
    fill:'rgba(15,23,42,.95)', stroke:'#cbd5e1', strokeWidth:1,
    visible:false, listening:false, name:'stack-badge token-noncompact' }));
  g.add(new K.Text({ x:stackX, y:stackY+2*scale, width:19*scale, height:9*scale, text:'×2',
    align:'center', fontSize:8*scale, fontStyle:'bold', fill:'#f8fafc',
    fontFamily:'Inter,sans-serif', visible:false, listening:false, name:'stack-count' }));
  if (vttLowFx()) _stripShadows(g);
  return g;
}

// ── Images BG/FG de la carte ─────────────────────────────────────────────────
// Patch Firestore d'une image (privé : utilisé seulement par _renderMapImages).
async function _patchImg(imgId, patch) {
  if (!VS.activePage) return;
  await updateDoc(_pgRef(VS.activePage.id), {
    backgroundImages: (VS.activePage.backgroundImages??[]).map(i=>i.id===imgId?{...i,...patch}:i)
  }).catch(()=>{});
}

/**
 * Rend les images de fond/avant-plan de la page active sur VS.layers.map/mapFg.
 * Les effets cross-domaine du clic de sélection (désélection token + inspecteur
 * + barre d'action) sont injectés en callbacks → le renderer reste découplé du
 * combat/inspecteur (vtt.js câble les callbacks).
 * @param {{hideActBar?:Function, clearHL?:Function, renderInspector?:Function}} deps
 */
let _lastMapImgSig = null;   // signature des images de fond réellement rendues
const _mapImgElCache = new Map(); // src résolue → HTMLImageElement déjà chargé (rebuild synchrone)

export function _renderMapImages(deps = {}) {
  const { hideActBar = () => {}, clearHL = () => {}, renderInspector = () => {} } = deps;
  if (!VS.activePage) return;
  const K = window.Konva;
  // Idempotent : si les images de fond sont inchangées ET déjà rendues, ne rien
  // détruire. Le destroy + rechargement asynchrone (new Image().onload) laissait
  // une frame « carte absente » → clignotement à chaque écriture de page (portes…).
  const bgImgs = VS.activePage.backgroundImages || [];
  const sig = `${VS.activePage.id}|${JSON.stringify(bgImgs)}`;
  const renderedCount = VS.layers.map.find('Image').length + (VS.layers.mapFg?.find('Image').length || 0);
  if (sig === _lastMapImgSig && renderedCount === bgImgs.length) return;
  _lastMapImgSig = sig;
  // Nettoyer les images des deux couches (sans détruire les transformers)
  VS.layers.map.find('Image').forEach(n=>n.destroy());
  VS.layers.mapFg?.find('Image').forEach(n=>n.destroy());
  if (VS.imgTr)   { VS.imgTr.nodes([]);   }
  if (VS.imgTrFg) { VS.imgTrFg.nodes([]); }
  VS.selImg = null;

  for (const img of (VS.activePage.backgroundImages??[])) {
    const isFg   = img.layer === 'fg';
    const tgtLyr = isFg ? VS.layers.mapFg : VS.layers.map;
    const tr     = isFg ? VS.imgTrFg      : VS.imgTr;

    const src = _resolveMapImageUrl(img.url, img.sourcePath);
    const build = (el) => {
      if (!VS.activePage) return; // page changée entre temps
      const ki = new K.Image({
        image:el, x:img.x*CELL, y:img.y*CELL,
        width:img.w*CELL, height:img.h*CELL,
        name:`img-${img.id}`,
      });

      if (STATE.isAdmin) {
        // Drag activé uniquement en mode édition carte
        ki.draggable(VS.mapMode);
        ki.on('dragmove', () => {
          ki.x(Math.round(ki.x()/CELL)*CELL);
          ki.y(Math.round(ki.y()/CELL)*CELL);
        });
        ki.on('dragend', () => {
          _patchImg(img.id, { x:Math.round(ki.x()/CELL), y:Math.round(ki.y()/CELL) });
        });

        // Clic → sélectionner l'image (seulement en mode édition carte)
        ki.on('click', e => {
          if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
          if (!VS.mapMode) return;
          e.cancelBubble = true;
          const selectedShape=VS.tokens[VS.selected]?.shape;
          selectedShape?.findOne('.sel')?.visible(false);
          selectedShape?.findOne('.sel-spin')?.visible(false);
          selectedShape?.findOne('.sel-footprint')?.visible(false);
          hideActBar();
          VS.selected=null; clearHL(); renderInspector(null); VS.layers.token.batchDraw();
          VS.selImg = img.id;
          // Vider l'autre transformer
          const otherTr = isFg ? VS.imgTr : VS.imgTrFg;
          otherTr?.nodes([]);
          if (tr?.getParent()) { tr.nodes([ki]); tr.moveToTop(); }
          tgtLyr.batchDraw();
        });

        // Fin de redimensionnement → snap + sauvegarde
        ki.on('transformend', () => {
          const w=Math.max(1,Math.round(ki.width()*ki.scaleX()/CELL));
          const h=Math.max(1,Math.round(ki.height()*ki.scaleY()/CELL));
          const x=Math.round(ki.x()/CELL), y=Math.round(ki.y()/CELL);
          ki.width(w*CELL); ki.height(h*CELL);
          ki.scaleX(1); ki.scaleY(1);
          ki.x(x*CELL); ki.y(y*CELL);
          tgtLyr.batchDraw();
          _patchImg(img.id, { x, y, w, h });
        });

        // Clic-droit → menu contextuel
        ki.on('contextmenu', e => {
          e.evt.preventDefault();
          if (!VS.mapMode) return;
          _showCtxMenu(e.evt.clientX, e.evt.clientY, [
            {
              label: isFg ? '⬇ Arrière-plan (sous les tokens)' : '⬆ Premier plan (au-dessus des tokens)',
              fn: () => _patchImg(img.id, { layer: isFg ? 'bg' : 'fg' }),
            },
            '---',
            {
              label: '🗑 Supprimer cette image',
              fn: () => {
                const imgs=(VS.activePage.backgroundImages??[]).filter(i=>i.id!==img.id);
                updateDoc(_pgRef(VS.activePage.id),{backgroundImages:imgs}).catch(e=>{ console.error('[vtt] suppr image carte', e); showNotif("Échec de la suppression de l'image de carte", 'error'); });
              },
            },
          ]);
        });
      }

      tgtLyr.add(ki);
      if (tr?.getParent()) tr.moveToTop();
      tgtLyr.batchDraw();
    };
    // Élément déjà chargé (cache) → reconstruction SYNCHRONE : aucune frame
    // « carte absente », donc plus de clignotement quand la page est réécrite
    // (ouvrir/fermer une porte, etc.). Sinon chargement asynchrone, mis en cache.
    // (URL auto-réparée pour les anciennes entrées GitHub/`images/maps/...`.)
    const cached = _mapImgElCache.get(src);
    if (cached && cached.complete && cached.naturalWidth) {
      build(cached);
    } else {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => { _mapImgElCache.set(src, el); build(el); };
      el.src = src;
    }
  }
}

/** Redessine le fond + la grille de la page active sur les calques bg/grid. */
export function _drawGrid() {
  if (!VS.stage || !VS.activePage) return;
  const K = window.Konva;
  VS.layers.bg.destroyChildren();
  VS.layers.grid.find('Line').forEach(n => n.destroy());
  const { cols, rows } = VS.activePage;
  const W = cols * CELL, H = rows * CELL;
  // Fond sur la couche bg (sous les images)
  VS.layers.bg.add(new K.Rect({ x:0, y:0, width:W, height:H, fill:'#12121f', listening:false }));
  VS.layers.bg.batchDraw();
  // Lignes de grille sur la couche grid (au-dessus des images)
  const s = { stroke:'rgba(255,255,255,0.22)', strokeWidth:1, listening:false };
  for (let c=0; c<=cols; c++) VS.layers.grid.add(new K.Line({ points:[c*CELL,0,c*CELL,H], ...s }));
  for (let r=0; r<=rows; r++) VS.layers.grid.add(new K.Line({ points:[0,r*CELL,W,r*CELL], ...s }));
  VS.layers.grid.batchDraw();
}

// ── Construction visuelle d'une annotation (dessin libre / ligne / rect / cercle) ──
// Partie PURE-RENDU : shape Konva à partir des données (K + data). Les handlers
// d'édition (sélection/drag/transform) restent dans vtt.js (cluster annotations).
export function _buildAnnotVisual(K, data) {
  const col  = data.color || '#ef4444';
  const fill = data.fill ? col + '30' : 'transparent';
  // listening sera ajusté par _updateAnnotDraggable selon l'outil et la propriété
  const base = { stroke: col, strokeWidth: data.strokeWidth || 2,
    lineCap:'round', lineJoin:'round', name:'annot', listening: false,
    // Zone de clic/gomme élargie : un trait fin (2px) reste facile à sélectionner/effacer.
    hitStrokeWidth: Math.max(16, (data.strokeWidth || 2) + 12) };
  let shape;
  if (data.type === 'freehand' || data.type === 'line') {
    shape = new K.Line({ ...base, points: data.points || [],
      x: data.offsetX||0, y: data.offsetY||0,
      tension: data.type === 'freehand' ? 0.3 : 0, fill:'transparent' });
  } else if (data.type === 'polygon') {
    // Forme tracée sommet par sommet (triangle, etc.) → ligne fermée + remplissage opt.
    shape = new K.Line({ ...base, points: data.points || [],
      x: data.offsetX||0, y: data.offsetY||0, closed: true, fill });
  } else if (data.type === 'spellzone') {
    // Zone de sort persistante (utilitaire) : rectangle pointillé teinté + label,
    // visible de tous, posé au centre (x,y). Auto-supprimé à expiration (par round).
    const zw = data.w || CELL, zh = data.h || CELL;
    const g = new K.Group({ name: 'annot', listening: false });
    const _zsw = data.strokeWidth || 2;
    if (data.shape === 'cross') {
      // Croix : barre verticale (1 case × hauteur) + barre horizontale (largeur × 1 case).
      g.add(new K.Rect({ x: -CELL / 2, y: -zh / 2, width: CELL, height: zh,
        fill: col + '24', stroke: col, strokeWidth: _zsw, dash: [10, 6], hitStrokeWidth: 0, listening: true }));
      g.add(new K.Rect({ x: -zw / 2, y: -CELL / 2, width: zw, height: CELL,
        fill: col + '24', stroke: col, strokeWidth: _zsw, dash: [10, 6], hitStrokeWidth: 0, listening: true }));
    } else if (data.shape === 'diamond') {
      g.add(new K.Line({
        points: [0, -zh / 2, zw / 2, 0, 0, zh / 2, -zw / 2, 0],
        closed: true, fill: col + '24', stroke: col, strokeWidth: _zsw,
        dash: [10, 6], hitStrokeWidth: 0, listening: true,
      }));
    } else if (data.shape === 'cone' || data.shape === 'ring' || data.shape === 'diamond' || data.shape === 'line') {
      // Formes en CASES (cône stepped 1/3/5…, anneau en losange évidé, losange plein, ligne 1×L) :
      // on surligne exactement les cases couvertes → cohérent avec le ciblage.
      for (const cell of _zoneCellRects(K, zw, zh, data.shape, data.coneDir || 'down', {
        fill: col + '5a', stroke: col, strokeWidth: 2, shadowColor: col, shadowBlur: 8, shadowOpacity: 0.6, hitStrokeWidth: 0, listening: true,
      })) g.add(cell);
    } else {
      g.add(new K.Rect({ x: 0, y: 0, width: zw, height: zh, offsetX: zw / 2, offsetY: zh / 2,
        fill: col + '24', stroke: col, strokeWidth: _zsw, dash: [10, 6], cornerRadius: 4,
        hitStrokeWidth: 0, listening: true }));
    }
    if (data.label) {
      g.add(new K.Text({ text: `${data.icon ? data.icon + ' ' : ''}${data.label}`,
        fontSize: 13, fontStyle: 'bold', fill: '#fff', align: 'center',
        width: zw, offsetX: zw / 2, offsetY: zh / 2 + 18,
        shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.9, listening: false }));
    }
    g.position({ x: data.x || 0, y: data.y || 0 });
    shape = g;
  } else if (data.type === 'rect') {
    const rw = data.w||10, rh = data.h||10;
    shape = new K.Rect({ ...base, x:data.x||0, y:data.y||0,
      width:rw, height:rh, fill, cornerRadius:3,
      // centered:true = x,y est le centre → offsetX/Y pour pivoter sur place
      ...(data.centered ? { offsetX: rw/2, offsetY: rh/2 } : {}) });
  } else if (data.type === 'circle') {
    shape = new K.Circle({ ...base, x:data.x||0, y:data.y||0, radius:data.r||10, fill });
  }
  if (!shape) return null;
  shape._annotId = data.id;
  // Restaurer rotation / scale sauvegardés
  if (data.rotation) shape.rotation(data.rotation);
  if (data.scaleX)   shape.scaleX(data.scaleX);
  if (data.scaleY)   shape.scaleY(data.scaleY);
  // Mode performance : les ombres Konva (shadowBlur) sont TRÈS coûteuses sous
  // Firefox (bien plus que sur Chromium) → on les coupe aussi sur les annotations,
  // zones de sort et dessins, pas seulement sur les tokens.
  if (vttLowFx()) _stripShadows(shape);
  return shape;
}

/** Désactive toutes les ombres d'un nœud Konva (Shape ou Group) — mode perf. */
export function _stripShadows(node) {
  if (!node) return;
  try {
    const nodes = typeof node.find === 'function' ? node.find('Shape') : [node];
    nodes.forEach(n => n.shadowEnabled && n.shadowEnabled(false));
    if (node.shadowEnabled && typeof node.find !== 'function') node.shadowEnabled(false);
  } catch {}
}
