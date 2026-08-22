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
import { tokenActiveEffects, tokenEffectsSignature, tokenHealthMeta } from './vtt-token-visual.js';

function _resolveMapImageUrl(url, sourcePath = '') {
  const raw = String(sourcePath || url || '').trim();
  if (/^\.?\/?images\/maps\//i.test(raw) || /(?:raw\.githubusercontent\.com|github\.com\/[^/]+\/[^/]+\/(?:blob|tree))\//i.test(raw)) {
    return githubPagesUrl(raw);
  }
  return normalizeImageUrl(String(url || raw).trim());
}

/** Charge Konva (vendored) sur window.Konva si pas déjà présent. */
export async function _loadKonva() {
  if (window.Konva) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './assets/js/vendor/konva-10.3.0.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Konva.js introuvable'));
    document.head.appendChild(s);
  });
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
export function _buildTokenVisual(t, ld, condById) {
  const K  = window.Konva;
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  // Le portrait est légèrement remonté dans l'emprise de sa case. Cela réserve
  // un vrai pied de 17 px au nom et aux ressources, sans aucun débordement.
  // Un ratio identique évite l'effet de portrait aplati sur les tokens 1×1.
  // Le léger décalage vers le haut conserve le pied d'informations dans la case.
  const rx = CELL*sw*0.37, ry = CELL*sh*0.37, portraitY = -8;
  const bW = Math.max(56, Math.min(CELL*sw*0.9, 150));
  const nameW = bW;
  const typeColor = TYPE_COLOR[t.type] ?? '#94a3b8';
  const health = tokenHealthMeta(ld.displayHp, ld.displayHpMax);
  const round = VS.session?.combat?.round ?? 0;
  const effects = tokenActiveEffects(t, condById, round);
  const g = new K.Group({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2, id:`tok-${t.id}` });
  g.setAttr('tokenW', sw);
  g.setAttr('tokenH', sh);
  g.setAttr('displayImage', ld.displayImage || null);
  g.setAttr('effectSignature', tokenEffectsSignature(effects));
  g.setAttr('activeEffectsSnapshot', effects.map(({kind,key,icon,label})=>({kind,key,icon,label})));
  g.setAttr('healthTone', health.tone);
  g.setAttr('displayHpSnapshot', health.known ? health.current : null);
  g.setAttr('displayPmSnapshot', ld.displayPm == null ? null : Number(ld.displayPm));

  // Ombre au sol + fond : le token se détache même sur une battlemap chargée.
  g.add(new K.Ellipse({ x:0, y:portraitY+4, radiusX:rx+4, radiusY:ry+4, fill:'rgba(0,0,0,.48)',
    shadowColor:'#000', shadowBlur:9, shadowOpacity:.7, listening:false }));
  // Cette ellipse est aussi la zone de hit Konva du groupe. Les autres éléments
  // restent non interactifs afin que jauges, badges et libellé ne détournent pas
  // le clic, mais il faut conserver une Shape écoutable pour sélectionner/draguer.
  g.add(new K.Ellipse({ x:0, y:portraitY, radiusX:rx, radiusY:ry, fill:typeColor, opacity:.92, listening:true, name:'token-hit' }));

  // Portrait/fallback ajoutés avant les informations afin qu'aucun chargement
  // asynchrone ne repasse devant les anneaux, jauges ou badges.
  const portrait = new K.Group({
    clipFunc: ctx => { ctx.ellipse(0,0,rx,ry,0,0,Math.PI*2,false); },
    x:0, y:portraitY, listening:false, name:'portrait', opacity:health.isDown ? .46 : 1,
  });
  const summonIcon = t.summonKind === 'invocation' ? '🐾'
    : t.summonKind === 'sentinelle' ? '🪤'
      : t.summonKind === 'weapon' ? '⚔️' : '';
  const fallback = new K.Text({
    x:-rx, y:-ry, width:rx*2, height:ry*2,
    text:summonIcon || String(ld.displayName || t.name || '?').trim().slice(0,2).toUpperCase(),
    fontSize:Math.max(16, Math.min(32, ry*.72)), fontStyle:'bold', fill:'#fff',
    align:'center', verticalAlign:'middle', fontFamily:'Inter,sans-serif',
    shadowColor:'#000', shadowBlur:4, shadowOpacity:.72, listening:false,
    name:'portrait-fallback',
  });
  portrait.add(fallback);
  const imgSrc = ld.displayImage;
  if (imgSrc) {
    const el=new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      portrait.add(new K.Image({ image:el, x:-rx, y:-ry, width:rx*2, height:ry*2, listening:false }));
      fallback.visible(false);
      VS.layers.token?.batchDraw();
    };
    el.src = imgSrc;
  }
  g.add(portrait);

  g.add(new K.Ellipse({
    x:0, y:portraitY, radiusX:rx, radiusY:ry, fill:'transparent',
    stroke:health.isDown?'#ef4444':typeColor, strokeWidth:3,
    shadowColor:health.isDown?'#ef4444':'#000', shadowBlur:health.isDown?10:5,
    shadowOpacity:.72, listening:false, name:'token-ring',
  }));
  g.add(new K.Ellipse({
    x:0, y:portraitY, radiusX:rx+8, radiusY:ry+8, stroke:'#facc15', strokeWidth:3,
    dash:[3,3], shadowColor:'#f59e0b', shadowBlur:12, shadowOpacity:.9,
    fill:'transparent', visible:!!VS.session?.combat?.active && VS.session?.combat?.activeTokenId===t.id,
    listening:false, name:'turn-active',
  }));
  g.add(new K.Ellipse({
    x:0, y:portraitY, radiusX:rx+4, radiusY:ry+4, stroke:'#60a5fa', strokeWidth:3,
    shadowColor:'#2563eb', shadowBlur:12, shadowOpacity:.9,
    fill:'transparent', visible:false, listening:false, name:'sel',
  }));
  g.add(new K.Ellipse({
    x:0, y:portraitY, radiusX:rx+7, radiusY:ry+7, stroke:'#fbbf24', strokeWidth:2.5, dash:[7,4],
    shadowColor:'#f59e0b', shadowBlur:10, shadowOpacity:.75,
    fill:'transparent', visible:false, listening:false, name:'atk',
  }));
  g.add(new K.Ellipse({
    x:0, y:portraitY, radiusX:rx+5.5, radiusY:ry+5.5, stroke:'#ef4444', strokeWidth:3.5,
    shadowColor:'#ef4444', shadowBlur:12, shadowOpacity:.9,
    fill:'transparent', visible:false, listening:false, name:'target',
  }));
  g.add(new K.Ellipse({
    x:0, y:portraitY, radiusX:rx+2.5, radiusY:ry+2.5, stroke:'#4ade80', strokeWidth:1.5,
    fill:'transparent', visible:false, listening:false, name:'target-inner',
  }));

  // À 0 PV, l'état est explicite sans devoir lire la jauge.
  g.add(new K.Ellipse({ x:0, y:portraitY, radiusX:rx, radiusY:ry, fill:'rgba(5,8,14,.58)', visible:health.isDown, listening:false, name:'down-overlay' }));
  g.add(new K.Text({ x:-rx, y:portraitY-13, width:rx*2, height:26, text:'☠', fontSize:23,
    align:'center', fill:'#fecaca', shadowColor:'#000', shadowBlur:6, shadowOpacity:1,
    visible:health.isDown, listening:false, name:'down-icon' }));

  // Badge CA minimal dans l'angle : la valeur reste immédiate sans occuper tout
  // le haut du portrait.
  const _buff = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _toursLeft = _buff
    ? (_buff.expiresAtRound != null && round > 0 ? _buff.expiresAtRound - round + 1 : _buff.totalDuration ?? '∞')
    : null;
  const _caW=22, _caH=13, _caX=rx-_caW, _caY=portraitY-ry+3;
  g.add(new K.Rect({ x:_caX, y:_caY, width:_caW, height:_caH, cornerRadius:6.5,
    fill: _buffed ? 'rgba(30,27,80,0.95)' : 'rgba(15,15,25,0.9)',
    stroke: _buffed ? '#818cf8' : '#64748b',
    strokeWidth: _buffed ? 1.5 : 1,
    listening:false, name:'ca-bg' }));
  g.add(new K.Text({ x:_caX, y:_caY+2, width:_caW, height:9,
    text:`🛡${ld.caBadge ?? (ld.displayDefense??0)}`, fontSize:6.8, fontStyle:'bold',
    fill: _buffed ? '#c4b5fd' : '#e2e8f0',
    fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-lbl' }));
  if (_buffed) {
    g.add(new K.Circle({ x:_caX+_caW-1, y:_caY+1, radius:4.5, fill:'#312e81', stroke:'#a5b4fc', strokeWidth:1, listening:false }));
    g.add(new K.Text({ x:_caX+_caW-5.5, y:_caY-1.5, width:9, height:7,
      text:String(_toursLeft), fontSize:5.5, fontStyle:'bold', fill:'#e0e7ff',
      fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-buff-turns' }));
  }

  // États/effets ancrés DANS le bord gauche du portrait. Rien ne dépasse vers
  // la case du dessus, même lorsque deux tokens sont parfaitement adjacents.
  if (effects.length) {
    const slots = sw >= 2 || sh >= 2 ? 4 : 3;
    const overflow = Math.max(0, effects.length - slots);
    const shown = effects.slice(0, overflow > 0 ? slots-1 : slots);
    const x=-rx+5, startY=portraitY-ry+8, gap=14;
    shown.forEach((effect, i) => {
      const y=startY+i*gap;
      const effectStroke=effect.tone==='negative'?'#fecaca':effect.tone==='positive'?'#bbf7d0':'#bfdbfe';
      g.add(new K.Circle({ x, y, radius:7, fill:effect.color,
        stroke:effectStroke, strokeWidth:effect.tone==='neutral'?1:1.7,
        listening:false, name:`${effect.kind==='condition'?'cond-bg':'buff-bg'} effect-detail` }));
      g.add(new K.Text({ x:x-7, y:y-5.5, width:14, height:11, text:effect.icon,
        fontSize:8.5, align:'center', verticalAlign:'middle', fontFamily:'Inter,sans-serif',
        listening:false, name:`${effect.kind==='condition'?'cond-ic':'buff-ic'} effect-detail` }));
      if (effect.turnsLeft != null) {
        const expiring=effect.turnsLeft===1;
        g.add(new K.Circle({ x:x+6, y:y+5, radius:4.2,
          fill:expiring?'#f97316':'#0f172a', stroke:expiring?'#fed7aa':'#94a3b8', strokeWidth:.8,
          listening:false, name:'effect-detail effect-turn-bg' }));
        g.add(new K.Text({ x:x+2, y:y+2, width:9, height:7, text:String(effect.turnsLeft),
          fontSize:6, fontStyle:'bold', align:'center', fill:expiring?'#fff7ed':'#fff',
          shadowColor:'#000', shadowBlur:2, shadowOpacity:1, listening:false, name:'effect-detail' }));
      }
    });
    if (overflow > 0) {
      const y=startY+shown.length*gap;
      g.add(new K.Circle({ x, y, radius:7, fill:'#334155', stroke:'#94a3b8', strokeWidth:1, listening:false, name:'effect-detail' }));
      g.add(new K.Text({ x:x-7, y:y-5, width:14, height:10, text:`+${overflow}`,
        fontSize:7, fontStyle:'bold', align:'center', fill:'#fff', fontFamily:'Inter,sans-serif', listening:false, name:'effect-detail' }));
    }
  }

  // Le nom dispose de sa propre ligne SOUS le portrait. Il ne recouvre donc ni
  // le visage, ni le token de la ligne suivante.
  const portraitBottom=portraitY+ry;
  const nameH=8, nameY=portraitBottom+1;
  g.add(new K.Rect({ x:-nameW/2, y:nameY, width:nameW, height:nameH, fill:'rgba(5,8,14,.94)',
    stroke:typeColor, strokeWidth:1, cornerRadius:4, shadowColor:'#000', shadowBlur:4, shadowOpacity:.6,
    listening:false, name:'name-bg token-name' }));
  g.add(new K.Circle({ x:-nameW/2+5, y:nameY+nameH/2, radius:2, fill:typeColor, listening:false, name:'type-dot token-name' }));
  g.add(new K.Text({ text:ld.displayName??t.name, x:-nameW/2+9, y:nameY,
    width:nameW-12, height:nameH, align:'left', verticalAlign:'middle',
    fontSize:7.4, fontStyle:'bold', fill:'#f8fafc', ellipsis:true, wrap:'none',
    fontFamily:'Inter,sans-serif', name:'lbl token-name', listening:false }));

  // PV et PM partagent la dernière ligne de la case. Les valeurs restantes sont
  // toujours lisibles ; sans mana, les PV récupèrent toute la largeur.
  const _pm0=ld.displayPm;
  const hasMana=_pm0!=null || ld.hasMana;
  const RESH=7, resourceY=nameY+nameH+1;
  const hpW=hasMana?(bW-1)/2:bW;
  g.add(new K.Rect({ x:-bW/2, y:resourceY, width:bW, height:RESH, fill:'rgba(5,8,14,.96)',
    stroke:'rgba(255,255,255,.22)', strokeWidth:1, cornerRadius:3.5, listening:false, name:'resource-bg' }));
  g.add(new K.Rect({ x:-bW/2+1, y:resourceY+1, width:Math.max(2,(hpW-2)*health.ratio), height:RESH-2,
    fill:health.color, cornerRadius:2.5, listening:false, name:'hp-fill' }));
  g.add(new K.Text({ x:-bW/2, y:resourceY, width:hpW, height:RESH, align:'center', verticalAlign:'middle',
    text:health.known?`♥${health.current}/${health.maximum}`:'♥?', fontSize:5.8, fontStyle:'bold', fill:'#fff',
    shadowColor:'#000', shadowBlur:2, shadowOpacity:1,
    fontFamily:'Inter,sans-serif', listening:false, name:'hp-val resource-value' }));
  if (hasMana) {
    const _pmKnown=_pm0!=null;
    const pmMax0=Number(ld.displayPmMax);
    const pmMaxKnown=Number.isFinite(pmMax0)&&pmMax0>0;
    const pmRat0=_pmKnown&&pmMaxKnown?Math.min(1,Math.max(0,_pm0/pmMax0)):(_pmKnown?1:0);
    const pmX=-bW/2+hpW+1, pmW=bW-hpW-1;
    g.add(new K.Rect({ x:pmX, y:resourceY+1, width:Math.max(2,(pmW-2)*pmRat0), height:RESH-2,
      fill:_pmKnown?'#8b5cf6':'#475569', cornerRadius:2.5, listening:false, name:'pm-fill' }));
    g.add(new K.Line({ points:[pmX-.5,resourceY+1,pmX-.5,resourceY+RESH-1],
      stroke:'rgba(255,255,255,.3)', strokeWidth:1, listening:false }));
    g.add(new K.Text({ x:pmX, y:resourceY, width:pmW, height:RESH, align:'center', verticalAlign:'middle',
      text:_pmKnown?(pmMaxKnown?`✦${_pm0}/${pmMax0}`:`✦${_pm0}`):'✦?', fontSize:5.8, fontStyle:'bold', fill:'#fff',
      shadowColor:'#000', shadowBlur:2, shadowOpacity:1,
      fontFamily:'Inter,sans-serif', listening:false, name:'pm-val resource-value' }));
  }

  // Badges contextuels masqués par défaut : la couche interactive les active
  // seulement quand le token est empilé ou sélectionné en combat.
  const stackX=rx-18, stackY=portraitY-5;
  g.add(new K.Rect({ x:stackX, y:stackY, width:18, height:11, cornerRadius:5.5,
    fill:'rgba(15,23,42,.95)', stroke:'#cbd5e1', strokeWidth:1,
    shadowColor:'#000', shadowBlur:4, shadowOpacity:.7, visible:false, listening:false, name:'stack-badge' }));
  g.add(new K.Text({ x:stackX, y:stackY+1.5, width:18, height:8, text:'×2',
    align:'center', fontSize:6.8, fontStyle:'bold', fill:'#f8fafc',
    fontFamily:'Inter,sans-serif', visible:false, listening:false, name:'stack-count' }));

  const moveW=31, moveY=portraitY+ry-11;
  g.add(new K.Rect({ x:-moveW/2, y:moveY, width:moveW, height:10, cornerRadius:5,
    fill:'rgba(8,47,73,.94)', stroke:'#38bdf8', strokeWidth:1,
    shadowColor:'#000', shadowBlur:4, shadowOpacity:.7, visible:false, listening:false, name:'move-badge' }));
  g.add(new K.Text({ x:-moveW/2, y:moveY+1.5, width:moveW, height:7, text:'🏃 0/0',
    align:'center', fontSize:6.2, fontStyle:'bold', fill:'#e0f2fe',
    fontFamily:'Inter,sans-serif', visible:false, listening:false, name:'move-value' }));
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
          VS.tokens[VS.selected]?.shape?.findOne('.sel')?.visible(false);
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
  return shape;
}
