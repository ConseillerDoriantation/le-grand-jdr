// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { getCurrentAdventureId } from '../data/firestore.js';
import {
  db, doc, collection, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, serverTimestamp, writeBatch,
} from '../config/firebase.js';
import { getMod, calcVitesse, calcCA, calcPVMax } from '../shared/char-stats.js';
import { showNotif } from '../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import PAGES from './pages.js';

// ── Constantes ──────────────────────────────────────────────────────
const CELL        = 70;
const MIN_SCALE   = 0.15;
const MAX_SCALE   = 4;
const THROTTLE_MS = 100;

const TYPE_COLOR  = { player:'#4f8cff', enemy:'#ef4444', npc:'#a78bfa' };
const hpColor     = r => r > 0.5 ? '#22c38e' : r > 0.25 ? '#f59e0b' : '#ef4444';

// ── État module ─────────────────────────────────────────────────────
let _stage   = null, _layers = {}, _unsubs = [], _resizeObs = null;
let _session = {}, _pages = {}, _tokens = {};
let _characters = {};   // characterId → character doc
let _npcs       = {};   // npcId → npc doc
let _activePage = null;
let _tool       = 'select';
let _selected   = null, _attackSrc = null, _moveHL = [], _lastDrag = 0;
let _autoSyncDone = false;   // empêche la double-création de tokens

// ── Refs Firestore ──────────────────────────────────────────────────
const _aid     = ()   => getCurrentAdventureId();
const _sesRef  = ()   => doc(db,  `adventures/${_aid()}/vtt/session`);
const _pgsCol  = ()   => collection(db, `adventures/${_aid()}/vttPages`);
const _toksCol = ()   => collection(db, `adventures/${_aid()}/vttTokens`);
const _chrsCol = ()   => collection(db, `adventures/${_aid()}/characters`);
const _npcsCol = ()   => collection(db, `adventures/${_aid()}/npcs`);
const _pgRef   = (id) => doc(db, `adventures/${_aid()}/vttPages/${id}`);
const _tokRef  = (id) => doc(db, `adventures/${_aid()}/vttTokens/${id}`);
const _chrRef  = (id) => doc(db, `adventures/${_aid()}/characters/${id}`);
const _npcRef  = (id) => doc(db, `adventures/${_aid()}/npcs/${id}`);

// ═══════════════════════════════════════════════════════════════════
// DONNÉES EFFECTIVES — fusion token + entité liée
// C'est ici que la sync temps réel prend tout son sens :
// HP/nom/image viennent toujours de la fiche source.
// ═══════════════════════════════════════════════════════════════════
function _live(t) {
  if (!t) return null;
  const c = t.characterId ? _characters[t.characterId] : null;
  const n = t.npcId       ? _npcs[t.npcId]             : null;
  const e = c || n;

  if (!e) return {
    ...t,
    displayName:     t.name,
    displayImage:    t.imageUrl ?? null,
    displayHp:       t.hp    ?? 20,
    displayHpMax:    t.hpMax ?? 20,
    displayMovement: t.movement ?? 6,
    displayAttack:   t.attack   ?? 5,
    displayDefense:  t.defense  ?? 0,
    displayRange:    t.range    ?? 1,
  };

  const hpMax = c
    ? (calcPVMax(c) || c.pvBase || 20)
    : (e.hpMax || e.pvMax || e.pv || 20);

  return {
    ...t,
    displayName:     e.nom    || t.name,
    displayImage:    e.photoURL || e.photo || e.avatar || e.imageUrl || t.imageUrl || null,
    displayHp:       e.hp  ?? t.hp  ?? hpMax,
    displayHpMax:    hpMax,
    displayMovement: t.movement ?? (c ? calcVitesse(c) : (e.vitesse || e.deplacement || 6)),
    displayAttack:   t.attack   ?? (c ? 5 + getMod(c,'force')  : (e.bonusAttaque || e.attack || 5)),
    displayDefense:  t.defense  ?? (c ? calcCA(c)              : (e.ca || e.defense || 0)),
    displayRange:    t.range    ?? 1,
  };
}

// HP écrit sur la fiche source (bidirectionnel)
async function _setHp(t, newHp) {
  const v = Math.max(0, newHp);
  if (t.characterId) await updateDoc(_chrRef(t.characterId), { hp: v });
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),       { hp: v });
  else               await updateDoc(_tokRef(t.id),          { hp: v });
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SYNC TOKENS — crée les tokens manquants pour persos et PNJ
// ═══════════════════════════════════════════════════════════════════
let _charsReady = false, _npcsReady = false, _toksReady = false;

function _maybeSyncAutoTokens() {
  if (!STATE.isAdmin || _autoSyncDone) return;
  if (!_charsReady || !_npcsReady || !_toksReady) return;
  _autoSyncDone = true;
  _syncAutoTokens();
}

async function _syncAutoTokens() {
  // Index des entités déjà tokenisées
  const byChar = new Set();
  const byNpc  = new Set();
  for (const { data } of Object.values(_tokens)) {
    if (data.characterId) byChar.add(data.characterId);
    if (data.npcId)       byNpc.add(data.npcId);
  }

  const toCreate = [];

  for (const c of Object.values(_characters)) {
    if (!byChar.has(c.id)) toCreate.push({
      name: c.nom || 'Personnage', type: 'player',
      characterId: c.id, npcId: null, ownerId: c.uid || null,
    });
  }
  for (const n of Object.values(_npcs)) {
    if (!byNpc.has(n.id)) toCreate.push({
      name: n.nom || 'PNJ', type: 'npc',
      characterId: null, npcId: n.id, ownerId: null,
    });
  }

  if (!toCreate.length) return;

  // Batch write pour limiter les appels
  const batch = writeBatch(db);
  for (const base of toCreate) {
    const ref = doc(_toksCol());
    batch.set(ref, {
      ...base,
      pageId: null, col: 0, row: 0,
      visible: false, imageUrl: null,
      movement: null, range: 1, attack: null, defense: null,
      hp: null, hpMax: null,
      movedThisTurn: false, attackedThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(e => console.error('[vtt] auto-sync tokens:', e));
}

// ═══════════════════════════════════════════════════════════════════
// KONVA — chargement dynamique CDN
// ═══════════════════════════════════════════════════════════════════
async function _loadKonva() {
  if (window.Konva) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/konva@9.3.18/konva.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Konva.js introuvable'));
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════════════
// NETTOYAGE
// ═══════════════════════════════════════════════════════════════════
function _cleanup() {
  _unsubs.forEach(u => u?.());
  _unsubs = []; _stage?.destroy(); _stage = null; _layers = {};
  _resizeObs?.disconnect(); _resizeObs = null;
  _tokens = {}; _pages = {}; _characters = {}; _npcs = {};
  _session = {}; _activePage = null; _selected = null; _attackSrc = null;
  _moveHL = []; _autoSyncDone = false;
  _charsReady = false; _npcsReady = false; _toksReady = false;
  document.removeEventListener('keydown', _keyHandler);
  const mc = document.getElementById('main-content');
  if (mc) mc.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════════════════════════
function _initCanvas(container) {
  const K = window.Konva;
  _stage = new K.Stage({ container, width: container.clientWidth, height: container.clientHeight });
  _layers.grid  = new K.Layer({ listening: true });
  _layers.map   = new K.Layer({ listening: false });
  _layers.token = new K.Layer();
  _stage.add(_layers.grid, _layers.map, _layers.token);

  _stage.on('wheel', e => {
    e.evt.preventDefault();
    const old = _stage.scaleX();
    const dir = e.evt.deltaY < 0 ? 1 : -1;
    const sc  = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * (1 + dir * 0.1)));
    const ptr = _stage.getPointerPosition();
    _stage.scale({ x:sc, y:sc });
    _stage.position({ x: ptr.x - (ptr.x-_stage.x())*(sc/old), y: ptr.y - (ptr.y-_stage.y())*(sc/old) });
  });

  let _pan = false, _po = null;
  _stage.on('mousedown', e => {
    if (e.evt.button===1||e.evt.button===2) {
      _pan = true; _po = { x:e.evt.clientX-_stage.x(), y:e.evt.clientY-_stage.y() };
    }
  });
  _stage.on('mousemove', e => { if (_pan) _stage.position({ x:e.evt.clientX-_po.x, y:e.evt.clientY-_po.y }); });
  _stage.on('mouseup', () => { _pan = false; });
  _stage.on('contextmenu', e => e.evt.preventDefault());
  _stage.on('click', e => { if (e.target===_stage) _deselect(); });

  _resizeObs = new ResizeObserver(() => {
    if (!_stage) return;
    _stage.width(container.clientWidth); _stage.height(container.clientHeight);
  });
  _resizeObs.observe(container);
}

function _drawGrid() {
  if (!_stage||!_activePage) return;
  const K = window.Konva;
  _layers.grid.find('Line').forEach(n=>n.destroy());
  _layers.grid.find('Rect.bg').forEach(n=>n.destroy());
  const { cols, rows } = _activePage;
  const W=cols*CELL, H=rows*CELL;
  const bg = new K.Rect({ x:0,y:0,width:W,height:H,fill:'#12121f',listening:false,name:'bg' });
  _layers.grid.add(bg); bg.moveToBottom();
  const s = { stroke:'rgba(255,255,255,0.07)',strokeWidth:1,listening:false };
  for (let c=0;c<=cols;c++) _layers.grid.add(new K.Line({ points:[c*CELL,0,c*CELL,H], ...s }));
  for (let r=0;r<=rows;r++) _layers.grid.add(new K.Line({ points:[0,r*CELL,W,r*CELL], ...s }));
  _layers.grid.batchDraw();
}

function _renderMapImages() {
  if (!_activePage) return;
  const K = window.Konva;
  _layers.map.destroyChildren();
  for (const img of (_activePage.backgroundImages??[])) {
    const el = new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      const ki = new K.Image({ image:el,x:img.x*CELL,y:img.y*CELL,width:img.w*CELL,height:img.h*CELL });
      if (STATE.isAdmin) {
        ki.draggable(true);
        ki.on('dragend', () => _patchImg(img.id,{x:Math.round(ki.x()/CELL),y:Math.round(ki.y()/CELL)}));
      }
      _layers.map.add(ki); _layers.map.batchDraw();
    };
    el.src = img.url;
  }
}
async function _patchImg(imgId, patch) {
  if (!_activePage) return;
  await updateDoc(_pgRef(_activePage.id), {
    backgroundImages: (_activePage.backgroundImages??[]).map(i=>i.id===imgId?{...i,...patch}:i)
  }).catch(()=>{});
}

// ═══════════════════════════════════════════════════════════════════
// TOKENS — shapes Konva
// ═══════════════════════════════════════════════════════════════════
function _buildShape(t) {
  const K  = window.Konva;
  const ld = _live(t);
  const r  = CELL*0.42, bW = CELL*0.72;
  const hp = ld.displayHp??20, hpm = ld.displayHpMax??20;
  const rat = hpm>0 ? Math.max(0,hp/hpm) : 1;

  const g = new K.Group({ x:t.col*CELL+CELL/2, y:t.row*CELL+CELL/2, id:`tok-${t.id}` });
  g.add(new K.Circle({ radius:r, fill:TYPE_COLOR[t.type]??'#888', opacity:.9, stroke:'rgba(255,255,255,0.2)',strokeWidth:2 }));
  g.add(new K.Circle({ radius:r+7, stroke:'#fff',     strokeWidth:3, fill:'transparent',visible:false,name:'sel' }));
  g.add(new K.Circle({ radius:r+7, stroke:'#ef4444',  strokeWidth:3, dash:[5,3],fill:'transparent',visible:false,name:'atk' }));
  g.add(new K.Rect({ x:-bW/2,y:r+5,width:bW,height:6,fill:'#1e1e2e',cornerRadius:3,name:'hp-bg' }));
  g.add(new K.Rect({ x:-bW/2,y:r+5,width:bW*rat,height:6,fill:hpColor(rat),cornerRadius:3,name:'hp-fill' }));
  g.add(new K.Text({ text:ld.displayName??t.name,x:-CELL/2,y:r+13,width:CELL,align:'center',fontSize:11,fill:'#ddd',fontFamily:'Inter,sans-serif',name:'lbl' }));

  const imgSrc = ld.displayImage;
  if (imgSrc) {
    const el=new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      const ki = new K.Image({ image:el,x:-r,y:-r,width:r*2,height:r*2,listening:false,
        clipFunc(ctx){ctx.arc(0,0,r,0,Math.PI*2,false);} });
      g.add(ki); ki.zIndex(1); _layers.token.batchDraw();
    };
    el.src = imgSrc;
  }

  const canDrag = STATE.isAdmin || t.ownerId===STATE.user?.uid;
  if (canDrag) {
    g.draggable(true);
    g.on('dragmove', () => {
      const c=Math.round((g.x()-CELL/2)/CELL), r=Math.round((g.y()-CELL/2)/CELL);
      g.position({ x:c*CELL+CELL/2, y:r*CELL+CELL/2 });
    });
    g.on('dragend', async () => {
      const pg=_activePage; if (!pg) return;
      const c=Math.max(0,Math.min(pg.cols-1,Math.round((g.x()-CELL/2)/CELL)));
      const r=Math.max(0,Math.min(pg.rows-1,Math.round((g.y()-CELL/2)/CELL)));
      if (!STATE.isAdmin && _session?.combat?.active) {
        const cur=_tokens[t.id]?.data;
        if (cur) {
          const d=Math.abs(c-cur.col)+Math.abs(r-cur.row);
          if (d>(_live(cur).displayMovement??6)||cur.movedThisTurn) {
            showNotif(cur.movedThisTurn?'Déjà bougé ce tour.':'Déplacement trop loin !','error');
            g.position({ x:cur.col*CELL+CELL/2,y:cur.row*CELL+CELL/2 }); _layers.token.batchDraw(); return;
          }
        }
      }
      g.position({ x:c*CELL+CELL/2,y:r*CELL+CELL/2 }); _layers.token.batchDraw();
      const patch = { col:c,row:r };
      if (!STATE.isAdmin&&_session?.combat?.active) patch.movedThisTurn=true;
      await updateDoc(_tokRef(t.id),patch).catch(()=>showNotif('Erreur déplacement','error'));
    });
  }

  g.on('click', e => {
    e.cancelBubble=true;
    if (_tool==='attack'&&_attackSrc&&_attackSrc!==t.id) _execAttack(_attackSrc,t.id);
    else _select(t.id);
  });

  return g;
}

function _patchShape(id) {
  const e=_tokens[id]; if (!e?.shape) return;
  const ld=_live(e.data); const g=e.shape;
  g.to({ x:e.data.col*CELL+CELL/2, y:e.data.row*CELL+CELL/2, duration:0.12 });
  const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
  const rat=hpm>0?Math.max(0,hp/hpm):1, bW=CELL*0.72;
  const fill=g.findOne('.hp-fill');
  if (fill){fill.width(bW*rat);fill.fill(hpColor(rat));}
  g.findOne('.lbl')?.text(ld.displayName??e.data.name);
  g.visible(!!(e.data.visible||STATE.isAdmin));
  _layers.token?.batchDraw();
}

// ── Sélection ───────────────────────────────────────────────────────
function _select(id) {
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _selected=id;
  _tokens[id]?.shape?.findOne('.sel')?.visible(true);
  _layers.token.batchDraw();
  const data=_tokens[id]?.data;
  _renderInspector(data??null);
  if (data&&(STATE.isAdmin||data.ownerId===STATE.user?.uid)) _showMoveRange(data);
  if (_tool==='attack'&&data&&(STATE.isAdmin||data.ownerId===STATE.user?.uid)) {
    _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
    _attackSrc=id;
    _tokens[id]?.shape?.findOne('.atk')?.visible(true);
    _layers.token.batchDraw();
  }
}

function _deselect() {
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _selected=null; _attackSrc=null; _clearHL(); _renderInspector(null);
  _layers.token?.batchDraw();
}

// ── Portée de mouvement ─────────────────────────────────────────────
function _showMoveRange(t) {
  _clearHL(); if (!_activePage) return;
  const K=window.Konva, ld=_live(t), mv=ld.displayMovement??6;
  const {cols,rows}=_activePage;
  const occ=new Set(Object.values(_tokens)
    .filter(e=>e.data?.pageId===_activePage.id&&e.data.id!==t.id)
    .map(e=>`${e.data.col},${e.data.row}`));
  for (let dc=-mv;dc<=mv;dc++) for (let dr=-mv;dr<=mv;dr++) {
    if (Math.abs(dc)+Math.abs(dr)>mv) continue;
    const c=t.col+dc,r=t.row+dr;
    if (c<0||r<0||c>=cols||r>=rows||(!dc&&!dr)) continue;
    const blk=occ.has(`${c},${r}`);
    const rect=new K.Rect({ x:c*CELL,y:r*CELL,width:CELL,height:CELL,
      fill:blk?'rgba(239,68,68,0.1)':'rgba(79,140,255,0.14)',
      stroke:blk?'rgba(239,68,68,0.3)':'rgba(79,140,255,0.3)',strokeWidth:1,listening:!blk });
    if (!blk){const tc=c,tr=r;rect.on('click',async e=>{e.cancelBubble=true;if(_selected)await _moveTo(_selected,tc,tr);});}
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
function _clearHL() { _moveHL.forEach(r=>r.destroy()); _moveHL=[]; _layers.grid?.batchDraw(); }
async function _moveTo(id,col,row) {
  const patch={col,row};
  if (!STATE.isAdmin&&_session?.combat?.active) patch.movedThisTurn=true;
  await updateDoc(_tokRef(id),patch).catch(()=>showNotif('Déplacement refusé','error'));
  _clearHL();
}

// ═══════════════════════════════════════════════════════════════════
// ATTAQUE
// ═══════════════════════════════════════════════════════════════════
async function _execAttack(srcId,tgtId) {
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src),lT=_live(tgt);
  const dist=Math.max(Math.abs(src.col-tgt.col),Math.abs(src.row-tgt.row));
  if (dist>(lS.displayRange??1)) { showNotif(`Hors de portée (${dist} cases)`,'error'); return; }
  const dmg=Math.max(1,(lS.displayAttack??5)-(lT.displayDefense??0))+Math.floor(Math.random()*4);
  const curHp=lT.displayHp??20, maxHp=lT.displayHpMax??20, newHp=Math.max(0,curHp-dmg);
  const ok=await confirmModal(
    `<strong>${lS.displayName??src.name}</strong> attaque <strong>${lT.displayName??tgt.name}</strong>.<br>
     Dégâts : <strong>${dmg}</strong> — PV restants : <strong>${newHp}/${maxHp}</strong>`,
    {title:'⚔️ Attaque',confirmLabel:'Attaquer',cancelLabel:'Annuler',danger:true}
  );
  if (!ok) return;
  try {
    await _setHp(tgt,newHp);
    showNotif(newHp===0?`💀 ${lT.displayName??tgt.name} tombe à 0 PV !`
      :`⚔️ ${dmg} dégâts → ${lT.displayName??tgt.name} (${newHp}/${maxHp} PV)`,'success');
  } catch { showNotif('Erreur attaque','error'); }
  _deselect(); _setTool('select');
}

// ═══════════════════════════════════════════════════════════════════
// INSPECTOR
// ═══════════════════════════════════════════════════════════════════
function _renderInspector(t) {
  const el=document.getElementById('vtt-inspector'); if (!el) return;
  if (!t) { el.innerHTML=`<div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>`; return; }
  const ld=_live(t);
  const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
  const rat=hpm>0?Math.max(0,hp/hpm):1;
  const icon={player:'🧑',enemy:'👹',npc:'👤'}[t.type]??'🎭';
  const lbl={player:'Joueur',enemy:'Ennemi',npc:'PNJ'}[t.type]??t.type;
  const img=ld.displayImage;
  const linked=t.characterId||t.npcId;

  const pageOpts=STATE.isAdmin
    ? Object.values(_pages).filter(p=>p.id!==t.pageId)
        .map(p=>`<option value="${p.id}">${p.name}</option>`).join('') : '';

  el.innerHTML=`
    <div class="vtt-ins-header">
      ${img?`<img src="${img}" class="vtt-ins-avatar" alt="">`
           :`<div class="vtt-ins-avatar-icon" style="background:${TYPE_COLOR[t.type]??'#888'}">${icon}</div>`}
      <div style="min-width:0">
        <div class="vtt-ins-name">${ld.displayName??t.name}</div>
        <div class="vtt-ins-type">${icon} ${lbl}${linked?' · 🔗':''}</div>
      </div>
    </div>
    <div class="vtt-ins-hp-wrap">
      <div class="vtt-ins-hp-bar"><div class="vtt-ins-hp-fill" style="width:${Math.round(rat*100)}%;background:${hpColor(rat)}"></div></div>
      <span class="vtt-ins-hp-pct" style="color:${hpColor(rat)}">${Math.round(rat*100)}%</span>
    </div>
    <div class="vtt-ins-stats">
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">PV</span>
        <span class="vtt-ins-val">${STATE.isAdmin
          ?`<input class="vtt-ins-input" type="number" value="${hp}" min="0" max="${hpm}" onchange="window._vttSetHp('${t.id}',+this.value)">`
          :hp} / ${hpm}</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">🏃 Mouvement</span><span class="vtt-ins-val">${ld.displayMovement??6} cases</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">⚔️ Attaque</span>  <span class="vtt-ins-val">${ld.displayAttack??5}</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">🛡 CA / Défense</span><span class="vtt-ins-val">${ld.displayDefense??0}</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">🎯 Portée</span>   <span class="vtt-ins-val">${ld.displayRange??1} case(s)</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">📍 Position</span> <span class="vtt-ins-val">${t.pageId?`C${t.col} L${t.row}`:'Non placé'}</span></div>
      ${t.movedThisTurn    ?'<div class="vtt-ins-badge">✓ A bougé</div>'      :''}
      ${t.attackedThisTurn ?'<div class="vtt-ins-badge vtt-ins-badge-atk">✓ A attaqué</div>':''}
    </div>
    ${STATE.isAdmin&&pageOpts?`
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">Envoyer le joueur vers</div>
        <select class="vtt-ins-select" onchange="window._vttMoveTokenToPage('${t.id}',this.value);this.value=''">
          <option value="">— choisir une page —</option>${pageOpts}
        </select>
      </div>` :''}
    ${STATE.isAdmin?`
      <div class="vtt-ins-actions">
        <button class="vtt-btn-sm" onclick="window._vttEditToken('${t.id}')" title="Modifier les stats combat">⚙️ Stats</button>
        <button class="vtt-btn-sm" onclick="window._vttToggleVisible('${t.id}')" title="Visibilité joueurs">${t.visible?'👁':'🙈'}</button>
        ${t.pageId?`<button class="vtt-btn-sm" onclick="window._vttRetireToken('${t.id}')" title="Retirer de la carte">↩</button>`:''}
      </div>` :''}`;
}

// ═══════════════════════════════════════════════════════════════════
// TRAY — panneau latéral des tokens non placés (MJ uniquement)
// ═══════════════════════════════════════════════════════════════════
function _renderTray() {
  const el=document.getElementById('vtt-tray'); if (!el||!STATE.isAdmin) return;

  const all=Object.values(_tokens).map(e=>e.data);
  const unplaced=all.filter(t=>!t.pageId);
  const onPage  =all.filter(t=>t.pageId===_activePage?.id);

  const mkItem=(t,placed)=>{
    const ld=_live(t);
    const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
    const rat=hpm>0?Math.max(0,hp/hpm):1;
    return `<div class="vtt-tray-item ${_selected===t.id?'active':''}" onclick="window._vttSelectFromTray('${t.id}')">
      <div class="vtt-tray-dot" style="background:${TYPE_COLOR[t.type]??'#888'}">
        ${ld.displayImage?`<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:''}
      </div>
      <div class="vtt-tray-info">
        <div class="vtt-tray-name">${ld.displayName??t.name}</div>
        <div class="vtt-tray-hp-bar"><div style="width:${Math.round(rat*100)}%;height:100%;background:${hpColor(rat)};border-radius:2px"></div></div>
      </div>
      ${!placed
        ?`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttPlace('${t.id}')" title="Placer sur cette page">▶</button>`
        :`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttRetireToken('${t.id}')" title="Retirer de la carte">↩</button>`
      }
    </div>`;
  };

  const byType=(arr)=>{
    const players=arr.filter(t=>t.type==='player');
    const npcs   =arr.filter(t=>t.type==='npc');
    const enemies=arr.filter(t=>t.type==='enemy');
    let html='';
    if (players.length) html+=`<div class="vtt-tray-sep">🧑 Joueurs</div>${players.map(t=>mkItem(t,!!t.pageId)).join('')}`;
    if (npcs.length)    html+=`<div class="vtt-tray-sep">👤 PNJ</div>${npcs.map(t=>mkItem(t,!!t.pageId)).join('')}`;
    if (enemies.length) html+=`<div class="vtt-tray-sep">👹 Ennemis</div>${enemies.map(t=>mkItem(t,!!t.pageId)).join('')}`;
    return html;
  };

  el.innerHTML=`
    <div class="vtt-tray-header">Tokens</div>
    ${onPage.length?`<div class="vtt-tray-group"><div class="vtt-tray-group-title">Sur cette page (${onPage.length})</div>${byType(onPage)}</div>`:''}
    ${unplaced.length?`<div class="vtt-tray-group"><div class="vtt-tray-group-title">Non placés (${unplaced.length})</div>${byType(unplaced)}</div>`:''}
    ${!onPage.length&&!unplaced.length?'<div class="vtt-tray-empty">Aucun token</div>':''}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════
function _renderPageTabs() {
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  const sorted=Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0));
  const broadcastId=_session.activePageId;

  // Compte les joueurs par page (tokens placés de type player)
  const playerCount={};
  for (const {data:t} of Object.values(_tokens)) {
    if (t.type==='player'&&t.pageId) playerCount[t.pageId]=(playerCount[t.pageId]??0)+1;
  }

  el.innerHTML=sorted.map(p=>{
    const isPlayers=p.id===broadcastId;
    const isActive =p.id===_activePage?.id;
    const cnt=playerCount[p.id]??0;
    return `
    <button class="vtt-page-tab ${isActive?'active':''} ${isPlayers?'players-here':''}"
            onclick="window._vttSwitchPage('${p.id}')"
            title="${isPlayers?'👥 Page actuelle des joueurs':p.name}">
      ${isPlayers?`<span class="vtt-page-players-badge" title="Joueurs ici">👥</span>`:''}
      ${p.name}
      ${cnt>0&&!isPlayers?`<span class="vtt-page-player-cnt">${cnt}</span>`:''}
      ${STATE.isAdmin?`<span class="vtt-page-del" onclick="event.stopPropagation();window._vttDeletePage('${p.id}')">×</span>`:''}
    </button>`;
  }).join('')+
  (sorted.length===0&&STATE.isAdmin
    ? `<span style="font-size:.75rem;color:var(--text-dim);padding:.3rem .5rem;white-space:nowrap">
         ← clique <strong>＋ Page</strong> pour commencer
       </span>`
    : '');
}

async function _switchPage(pageId) {
  const page=_pages[pageId]; if (!page) return;
  _activePage=page;
  _layers.map?.destroyChildren(); _layers.token?.destroyChildren(); _clearHL();
  _drawGrid(); _renderMapImages(); _renderAllTokens();
  _renderPageTabs(); _renderTray(); _deselect();
  if (STATE.isAdmin) await setDoc(_sesRef(),{activePageId:pageId},{merge:true}).catch(()=>{});
}

function _renderAllTokens() {
  if (!_activePage) return;
  _layers.token?.destroyChildren();
  for (const e of Object.values(_tokens)) {
    const t=e.data;
    if (t.pageId!==_activePage.id) continue;
    if (!t.visible&&!STATE.isAdmin) continue;
    const shape=_buildShape(t);
    _tokens[t.id]={...e,shape}; _layers.token.add(shape);
  }
  _layers.token?.batchDraw();
}

// ═══════════════════════════════════════════════════════════════════
// SYNC FIRESTORE — onSnapshot sur 5 collections
// ═══════════════════════════════════════════════════════════════════
function _initListeners() {
  if (!_aid()) return;

  // 1. Session
  _unsubs.push(onSnapshot(_sesRef(), snap => {
    _session=snap.exists()?snap.data():{};
    _renderPageTabs();
    if (!STATE.isAdmin) {
      const uid=STATE.user?.uid;
      const target=_session.playerPages?.[uid]??_session.activePageId;
      if (target&&_pages[target]&&_activePage?.id!==target) _switchPage(target);
    }
    _renderCombatBadge();
  },()=>{}));

  // 2. Pages
  _unsubs.push(onSnapshot(_pgsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _pages[ch.doc.id];
      else {
        _pages[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
        if (_activePage?.id===ch.doc.id) { _activePage=_pages[ch.doc.id]; _renderMapImages(); }
      }
    });
    _renderPageTabs();
    if (!_activePage&&Object.keys(_pages).length>0) {
      const uid=STATE.user?.uid;
      const target=(_session.playerPages?.[uid]??_session.activePageId)
        ||Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0))[0]?.id;
      if (target&&_pages[target]) _switchPage(target);
    }
  },()=>{}));

  // 3. Personnages — source de vérité des HP joueurs
  _unsubs.push(onSnapshot(_chrsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _characters[ch.doc.id];
      else _characters[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    // Refresh des shapes liés
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.characterId&&changed.has(e.data.characterId)) {
        _patchShape(id); if (_selected===id) _renderInspector(e.data);
      }
    }
    _renderTray();
    _charsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 4. PNJ — source de vérité des HP PNJ
  _unsubs.push(onSnapshot(_npcsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _npcs[ch.doc.id];
      else _npcs[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.npcId&&changed.has(e.data.npcId)) {
        _patchShape(id); if (_selected===id) _renderInspector(e.data);
      }
    }
    _renderTray();
    _npcsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 5. Tokens
  _unsubs.push(onSnapshot(_toksCol(), snap => {
    snap.docChanges().forEach(ch => {
      const id=ch.doc.id, data={id,...ch.doc.data()};
      if (ch.type==='removed') {
        _tokens[id]?.shape?.destroy(); delete _tokens[id];
        if (_selected===id) _deselect();
        _layers.token?.batchDraw(); return;
      }
      const prev=_tokens[id];
      if (prev) {
        const changedPage=prev.data.pageId!==data.pageId;
        prev.data=data;
        if (changedPage) {
          prev.shape?.destroy(); prev.shape=null;
          if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
            const shape=_buildShape(data);
            _tokens[id]={data,shape}; _layers.token?.add(shape); _layers.token?.batchDraw();
          } else {
            _tokens[id]={data,shape:null};
          }
        } else {
          _patchShape(id);
        }
        if (_selected===id) _renderInspector(data);
      } else {
        _tokens[id]={data,shape:null};
        if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
          const shape=_buildShape(data);
          _tokens[id].shape=shape;
          _layers.token?.add(shape); _layers.token?.batchDraw();
        }
      }
    });
    _renderTray();
    _toksReady=true; _maybeSyncAutoTokens();
  },()=>{}));
}

function _renderCombatBadge() {
  const el=document.getElementById('vtt-combat-badge'); if (!el) return;
  if (_session?.combat?.active) { el.textContent=`⚔️ Round ${_session.combat.round??1}`; el.style.display='flex'; }
  else el.style.display='none';
}

// ═══════════════════════════════════════════════════════════════════
// ACTIONS GLOBALES
// ═══════════════════════════════════════════════════════════════════
window._vttTool       = t => _setTool(t);
window._vttSwitchPage = id => _switchPage(id);

window._vttAddPage    = async () => {
  const name=prompt('Nom de la page :')?.trim(); if (!name) return;
  await addDoc(_pgsCol(),{name,cols:24,rows:18,backgroundImages:[],order:Object.keys(_pages).length,createdAt:serverTimestamp()})
    .catch(()=>showNotif('Erreur','error'));
};
window._vttDeletePage = async id => {
  if (!await confirmModal('Supprimer cette page ?',{title:'Supprimer ?',danger:true})) return;
  await deleteDoc(_pgRef(id)).catch(()=>{});
};

// Placer un token sur la page active (depuis le tray)
window._vttPlace = async tokenId => {
  if (!_activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const cC=Math.floor(_activePage.cols/2), cR=Math.floor(_activePage.rows/2);
  await updateDoc(_tokRef(tokenId),{pageId:_activePage.id,col:cC,row:cR,visible:true})
    .catch(()=>showNotif('Erreur placement','error'));
};
// Retirer un token de la carte (le remet dans le tray)
window._vttRetireToken = async tokenId => {
  await updateDoc(_tokRef(tokenId),{pageId:null,visible:false}).catch(()=>{});
  if (_selected===tokenId) _deselect();
};
// Envoyer TOUS les joueurs sur la page active
window._vttSendAllHere = async () => {
  if (!_activePage) { showNotif('Aucune page active','error'); return; }
  await setDoc(_sesRef(), { activePageId: _activePage.id }, { merge: true })
    .catch(() => showNotif('Erreur','error'));
  showNotif(`📡 Tous les joueurs → « ${_activePage.name} »`, 'success');
};

// Déplacer le token vers une autre page
window._vttMoveTokenToPage = async (tokenId,pageId) => {
  if (!pageId) return;
  await updateDoc(_tokRef(tokenId),{pageId}).catch(()=>{});
};
// Sélectionner depuis le tray (place si non placé)
window._vttSelectFromTray = id => {
  const t=_tokens[id]?.data; if (!t) return;
  if (!t.pageId&&STATE.isAdmin) { window._vttPlace(id); return; }
  if (t.pageId===_activePage?.id) _select(id);
};
window._vttToggleVisible = async id => {
  const t=_tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{visible:!t.visible}).catch(()=>{});
};
window._vttSetHp = async (tokenId,hp) => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  await _setHp(t,hp).catch(()=>{});
};
window._vttEditToken = id => _openStatsModal(_tokens[id]?.data??null);

window._vttAddImageUrl = async () => {
  const url=prompt('URL de l\'image :')?.trim(); if (!url||!_activePage) return;
  const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
  await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs}).catch(()=>{});
};
window._vttUploadClick = () => document.getElementById('vtt-img-input')?.click();

window._vttToggleCombat = async () => {
  if (!STATE.isAdmin) return;
  const active=!_session?.combat?.active;
  await setDoc(_sesRef(),{combat:{active,round:active?1:0}},{merge:true});
  if (active) {
    const b=writeBatch(db);
    Object.keys(_tokens).forEach(id=>b.update(_tokRef(id),{movedThisTurn:false,attackedThisTurn:false}));
    await b.commit().catch(()=>{});
    showNotif('⚔️ Combat démarré !','success');
  } else showNotif('Combat terminé.','success');
};
window._vttNextRound = async () => {
  if (!STATE.isAdmin||!_session?.combat?.active) return;
  const round=(_session.combat.round??1)+1;
  await setDoc(_sesRef(),{combat:{active:true,round}},{merge:true});
  const b=writeBatch(db);
  Object.keys(_tokens).forEach(id=>b.update(_tokRef(id),{movedThisTurn:false,attackedThisTurn:false}));
  await b.commit().catch(()=>{});
  showNotif(`Round ${round} !`,'success');
};

// ── Modal stats combat (override des stats auto) ────────────────────
function _openStatsModal(t) {
  if (!t) return;
  const ld=_live(t);
  openModal('⚙️ Stats de combat', `
    <div class="vtt-form">
      <div class="vtt-form-row">
        <div class="form-group"><label>🏃 Mouvement</label><input id="vsf-mv"    type="number" value="${t.movement??''}"  placeholder="${ld.displayMovement??6} (auto)"></div>
        <div class="form-group"><label>🎯 Portée</label>   <input id="vsf-range" type="number" value="${t.range??1}"       min="0"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>⚔️ Attaque</label>  <input id="vsf-atk"   type="number" value="${t.attack??''}"    placeholder="${ld.displayAttack??5} (auto)"></div>
        <div class="form-group"><label>🛡 CA/Défense</label><input id="vsf-def"  type="number" value="${t.defense??''}"   placeholder="${ld.displayDefense??0} (auto)"></div>
      </div>
      <div class="form-group"><label>URL image (optionnel)</label>
        <input id="vsf-img" type="text" value="${t.imageUrl??''}" placeholder="Remplace la photo du perso">
      </div>
      <label class="vtt-check-label"><input id="vsf-visible" type="checkbox" ${t.visible?'checked':''}> Visible par les joueurs</label>
      <small style="color:var(--text-dim);font-size:.7rem;margin-top:.25rem">
        Laisser vide pour utiliser les stats calculées depuis la fiche de personnage.
      </small>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttSaveStats('${t.id}')">💾 Enregistrer</button>
      </div>
    </div>`);
}
window._vttSaveStats = async id => {
  const mv  = document.getElementById('vsf-mv')?.value;
  const rng = document.getElementById('vsf-range')?.value;
  const atk = document.getElementById('vsf-atk')?.value;
  const def = document.getElementById('vsf-def')?.value;
  const img = document.getElementById('vsf-img')?.value.trim();
  const vis = document.getElementById('vsf-visible')?.checked;
  const patch = {
    movement: mv  ? +mv  : null,
    range:    rng ? +rng : 1,
    attack:   atk ? +atk : null,
    defense:  def ? +def : null,
    imageUrl: img || null,
    visible:  vis ?? true,
  };
  await updateDoc(_tokRef(id),patch).catch(()=>showNotif('Erreur','error'));
  closeModalDirect();
  showNotif('Stats mises à jour','success');
};

// ── Upload Firebase Storage ─────────────────────────────────────────
async function _handleUpload(file) {
  if (!file||!_activePage) return;
  showNotif('Upload en cours…','success');
  try {
    const {getStorage,ref,uploadBytes,getDownloadURL}=
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
    const stor=getStorage();
    const fRef=ref(stor,`adventures/${_aid()}/vtt/${Date.now()}_${file.name}`);
    await uploadBytes(fRef,file);
    const url=await getDownloadURL(fRef);
    const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
    await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs});
    showNotif('Image ajoutée !','success');
  } catch(e) { console.error(e); showNotif('Erreur upload','error'); }
}

// ── Outil + clavier ─────────────────────────────────────────────────
function _setTool(tool) {
  _tool=tool;
  if (tool!=='attack') { _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false); _attackSrc=null; }
  document.querySelectorAll('.vtt-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  const wrap=document.getElementById('vtt-canvas-wrap');
  if (wrap) wrap.style.cursor=tool==='attack'?'crosshair':'default';
}
function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  if (e.target.matches('input,textarea,select')) return;
  if (e.key==='s'||e.key==='S') _setTool('select');
  if (e.key==='a'||e.key==='A') _setTool('attack');
  if (e.key==='Escape') _deselect();
}

// ═══════════════════════════════════════════════════════════════════
// HTML
// ═══════════════════════════════════════════════════════════════════
function _buildHtml() {
  const mj=STATE.isAdmin;
  return `
<div class="vtt-root" id="vtt-root">
  <div class="vtt-toolbar">
    <div class="vtt-tool-group">
      <button class="vtt-tool active" data-tool="select" onclick="window._vttTool('select')" title="Sélectionner (S)">↖ Sélect.</button>
      <button class="vtt-tool"        data-tool="attack" onclick="window._vttTool('attack')" title="Attaque (A)">⚔️ Attaque</button>
    </div>
    <div id="vtt-page-tabs" class="vtt-page-tabs"></div>
    <div class="vtt-tool-group vtt-right">
      <div id="vtt-combat-badge" class="vtt-combat-badge" style="display:none"></div>
      ${mj?`
        <button class="vtt-btn-sm" onclick="window._vttAddPage()"      title="Nouvelle page">＋ Page</button>
        <button class="vtt-btn-sm" onclick="window._vttSendAllHere()"  title="Envoyer tous les joueurs sur cette page" id="vtt-btn-send-all">📡 Envoyer tous</button>
        <button class="vtt-btn-sm" onclick="window._vttAddImageUrl()"  title="Fond par URL">🖼 Image</button>
        <label  class="vtt-btn-sm vtt-upload-lbl">📁 Upload<input type="file" id="vtt-img-input" accept="image/*" hidden></label>
        <button class="vtt-btn-sm" onclick="window._vttToggleCombat()" title="Combat">⚔ Combat</button>
        <button class="vtt-btn-sm" onclick="window._vttNextRound()"    title="Tour suivant">▶ Tour</button>`:''}
    </div>
  </div>
  <div class="vtt-body">
    ${mj?`<div class="vtt-tray" id="vtt-tray"><div class="vtt-tray-empty">Chargement…</div></div>`:''}
    <div class="vtt-canvas-wrap" id="vtt-canvas-wrap"></div>
    <div class="vtt-inspector" id="vtt-inspector">
      <div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>
    </div>
  </div>
  <div class="vtt-hint">S sélect. · A attaque · Échap désélect. · Molette zoom · Clic-droit pan</div>
</div>`;
}

// ═══════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════════
export async function renderVttPage() {
  _cleanup();
  const content=document.getElementById('main-content');
  if (!content) return;
  content.innerHTML='<div class="loading"><div class="spinner"></div> Chargement de la table…</div>';
  content.style.overflow='hidden';
  try { await _loadKonva(); }
  catch {
    content.innerHTML='<div style="padding:2rem;color:var(--text-dim)">Impossible de charger Konva.js.</div>';
    content.style.overflow=''; return;
  }
  content.innerHTML=_buildHtml();
  const wrap=document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  _initCanvas(wrap);
  document.addEventListener('keydown',_keyHandler);
  document.getElementById('vtt-img-input')?.addEventListener('change',e=>{
    const f=e.target.files?.[0]; if (f) _handleUpload(f); e.target.value='';
  });
  _initListeners();
}

PAGES.vtt=renderVttPage;
