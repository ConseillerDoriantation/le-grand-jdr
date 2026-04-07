// ══════════════════════════════════════════════════════════════════════════════
// PLAYERS.JS — Présentation des Personnages
// Sommaire avec portraits + fiches narratives complètes
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

// ── Crop image ────────────────────────────────────────────────────────────────
let _ppCrop = {
  img:null, cropX:0,cropY:0,cropW:0,cropH:0,
  startX:0,startY:0,isDragging:false,isResizing:false,handle:null,
  natW:0,natH:0,dispScale:1, base64:null,
};
const _ppc = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

// ── État ──────────────────────────────────────────────────────────────────────
const STORE = {
  items:         [],
  activeId:      '',
  presentations: [],
  characters:    [],
};

const STAT_META = [
  { key:'force',        label:'Force',        color:'#ff6b6b' },
  { key:'dexterite',    label:'Dextérité',    color:'#22c38e' },
  { key:'intelligence', label:'Intelligence', color:'#4f8cff' },
  { key:'constitution', label:'Constitution', color:'#f59e0b' },
  { key:'sagesse',      label:'Sagesse',      color:'#b47fff' },
  { key:'charisme',     label:'Charisme',     color:'#fd6c9e' },
];

// ── Helpers data ──────────────────────────────────────────────────────────────
const _esc  = (v='') => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const _nl2br = (v='') => _esc(v).replace(/\n/g,'<br>');
const _norm = (v='') => String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const _trunc = (v='',n=280) => { const s=String(v||'').replace(/\s+/g,' ').trim(); return s.length<=n?s:s.slice(0,n).trimEnd()+'…'; };

function _getStat(c,k){ return Math.min(22,(c?.stats?.[k]||8)+(c?.statsBonus?.[k]||0)); }
function _getMod(c,k){ return Math.floor((_getStat(c,k)-10)/2); }
function _pvMax(c){ const m=_getMod(c,'constitution'),n=c?.niveau||1,p=m>0?Math.floor(m*(n-1)):m; return Math.max(1,(c?.pvBase||10)+p); }
function _pmMax(c){ const m=_getMod(c,'sagesse'),n=c?.niveau||1,p=m>0?Math.floor(m*(n-1)):m; return Math.max(0,(c?.pmBase||10)+p); }
function _ca(c){
  const e=c?.equipement||{},t=e['Torse']?.typeArmure||'';
  let b=8;
  if(t==='Légère')b=10;
  else if(t==='Intermédiaire')b=12;
  else if(t==='Lourde')b=14;
  const caEquip=Object.values(e).reduce((s,i)=>s+(i?.ca||0),0);
  // +2 CA si bouclier en main secondaire (même logique que calcCA dans characters.js)
  const mainS=e['Main secondaire'];
  const stypeS=(mainS?.sousType||mainS?.nom||'').toLowerCase();
  const bouclierBonus=(stypeS.includes('bouclier')||stypeS.includes('shield'))?2:0;
  return b+_getMod(c,'dexterite')+caEquip+bouclierBonus;
}
function _gold(c){ const co=c?.compte||{}; return Math.round(((co.recettes||[]).reduce((s,r)=>s+(parseFloat(r?.montant)||0),0)-((co.depenses||[]).reduce((s,r)=>s+(parseFloat(r?.montant)||0),0)))*100)/100; }
function _initials(n=''){ const p=String(n).trim().split(/\s+/).filter(Boolean); return p.length?p.slice(0,2).map(w=>w[0]?.toUpperCase()||'').join(''):'?'; }

function _buildRecord(char=null, pres=null) {
  const level  = pres?.niveau   || char?.niveau   || 1;
  const nom    = pres?.nom?.trim() || char?.nom    || 'Personnage';
  const classe = pres?.classe?.trim() || '';
  const race   = pres?.race?.trim()   || '';
  const joueur = pres?.joueur?.trim() || char?.ownerPseudo || '';
  const imageUrl     = pres?.imageUrl || char?.photo || '';  // illustration narrative (fiche)
  const portraitUrl  = char?.photo || pres?.imageUrl || '';  // portrait fiche (sommaire)
  const bio    = pres?.bio?.trim() || '';
  const archive= pres?.archive?.trim() || '';  // Fragment d'archive narratif
  const source = pres?.archiveSource?.trim() || '';
  const chap   = pres?.chapitre?.trim() || '';  // "Chapitre I : Khaarys"

  const stats = char ? STAT_META.map(m=>({ ...m, value: _getStat(char,m.key) })) : [];

  // Confidentialité — true par défaut, false si explicitement désactivé
  const show = (key, def=true) => pres?.[key] !== undefined ? Boolean(pres[key]) : def;

  return {
    id:             pres?.id || `c:${char?.id||Math.random().toString(36).slice(2)}`,
    presentationId: pres?.id || '',
    charId:         pres?.charId || char?.id || '',
    nom, classe, race, joueur, imageUrl, portraitUrl, bio, archive, source, chap, level,
    subtitle:       [classe,race].filter(Boolean).join(' · '),
    titles:         char?.titres || [],
    emoji:          pres?.emoji?.trim() || '',
    initials:       _initials(nom),
    stats,
    hasFiche:       Boolean(char),
    visible:        show('visible', true),       // afficher dans le sommaire
    ordre:          pres?.ordre ?? 999,          // ordre d'affichage
    afficherPV:     show('afficherPV', true),
    afficherPM:     show('afficherPM', true),
    afficherCA:     show('afficherCA', true),
    afficherOr:     show('afficherOr', false),   // Or masqué par défaut
    afficherStats:  show('afficherStats', true),
    pvActuel:       char?.pvActuel ?? null,
    pvMax:          char ? _pvMax(char) : null,
    pmActuel:       char?.pmActuel ?? null,
    pmMax:          char ? _pmMax(char) : null,
    ca:             char ? _ca(char) : null,
    gold:           char ? _gold(char) : null,
    deckActif:      char?.deck_sorts?.length ?? null,
    deckMax:        char ? (3+Math.min(0,_getMod(char,'intelligence'))+Math.floor(Math.max(0,_getMod(char,'intelligence'))*Math.pow(Math.max(0,(char?.niveau||1)-1),.75))) : null,
    quests:         char?.quetes?.length ?? 0,
    inventoryCount: char?.inventaire?.length ?? 0,
    photoZoom:      char?.photoZoom || 1,
    photoX:         char?.photoX   || 0,
    photoY:         char?.photoY   || 0,
    char,
  };
}

function _buildDataset(presentations=[], characters=[]) {
  const usedPresIds = new Set();
  const byCharId    = new Map(presentations.filter(p=>p?.charId).map(p=>[p.charId,p]));
  const byName      = new Map();
  presentations.forEach(p=>{ const k=_norm(p?.nom); if(!k)return; const b=byName.get(k)||[]; b.push(p); byName.set(k,b); });

  const items = characters.map(c=>{
    let p = byCharId.get(c.id)||null;
    if(!p){ const m=byName.get(_norm(c.nom))||[]; p=m.find(x=>!usedPresIds.has(x.id))||null; }
    if(p?.id) usedPresIds.add(p.id);
    return _buildRecord(c,p);
  });
  presentations.filter(p=>!usedPresIds.has(p.id)).forEach(p=>items.push(_buildRecord(null,p)));
  return items
    .filter(item => STATE.isAdmin || item.visible !== false)
    .sort((a,b) => (a.ordre??999)-(b.ordre??999) || a.nom.localeCompare(b.nom,'fr',{sensitivity:'base'}));
}

// ── Portrait inline ───────────────────────────────────────────────────────────
function _portrait(item, size=52, radius='50%') {
  const colors = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const col    = colors[item.nom.charCodeAt(0)%colors.length];
  const pos    = `${50+(item.photoX||0)*50}% ${50+(item.photoY||0)*50}%`;
  if (item.imageUrl) {
    return `<div style="width:${size}px;height:${size}px;border-radius:${radius};overflow:hidden;flex-shrink:0">
      <img src="${_esc(item.imageUrl)}" style="width:100%;height:100%;object-fit:cover;object-position:${pos}">
    </div>`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:${radius};overflow:hidden;flex-shrink:0;
    background:${col}18;border:2px solid ${col};
    display:flex;align-items:center;justify-content:center">
    <span style="font-family:'Cinzel',serif;font-weight:700;font-size:${Math.round(size*.35)}px;
      color:${col}">${item.initials}</span>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SOMMAIRE
// ══════════════════════════════════════════════════════════════════════════════
function _renderSommaire(items) {
  const colors = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];

  const cards = items.map((item, idx) => {
    const col   = colors[item.nom.charCodeAt(0)%colors.length];
    const pos   = `${50+(item.photoX||0)*50}% ${50+(item.photoY||0)*50}%`;
    const chap  = item.chap || `Chapitre ${_toRoman(idx+1)} : ${item.nom}`;
    const locked = !item.bio && !item.portraitUrl && !item.imageUrl;

    return `<button onclick="window._ppOpenFiche('${_esc(item.id)}')"
      style="display:flex;align-items:center;gap:.6rem;padding:.55rem .8rem;
      background:var(--bg-elevated);border:1px solid ${locked?'var(--border)':col+'44'};
      border-radius:12px;cursor:pointer;transition:all .18s;text-align:left;
      opacity:${locked?.55:1}"
      onmouseover="this.style.background='${col}10';this.style.borderColor='${col}';this.style.transform='translateX(3px)'"
      onmouseout="this.style.background='var(--bg-elevated)';this.style.borderColor='${locked?'var(--border)':col+'44'}';this.style.transform=''">

      <!-- Portrait circulaire — toujours le portrait de la fiche de personnage -->
      <div style="width:42px;height:42px;border-radius:50%;flex-shrink:0;overflow:hidden;
        background:${col}18;border:2px solid ${locked?'rgba(255,255,255,.1)':col};
        display:flex;align-items:center;justify-content:center">
        ${item.portraitUrl
          ? `<img src="${_esc(item.portraitUrl)}" style="width:100%;height:100%;object-fit:cover;object-position:${pos}">`
          : locked
            ? `<span style="font-size:1.1rem;opacity:.4">🔒</span>`
            : `<span style="font-family:'Cinzel',serif;font-weight:700;font-size:.9rem;color:${col}">${item.initials}</span>`}
      </div>

      <div style="flex:1;min-width:0">
        <div style="font-family:'Cinzel',serif;font-size:.8rem;font-weight:700;
          color:${locked?'var(--text-dim)':'var(--text)'};
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(chap)}</div>
        ${item.subtitle ? `<div style="font-size:.65rem;color:${col};margin-top:1px">${_esc(item.subtitle)}</div>` : ''}
      </div>
    </button>`;
  });

  // Répartir en 3 colonnes
  const col1 = cards.filter((_,i)=>i%3===0);
  const col2 = cards.filter((_,i)=>i%3===1);
  const col3 = cards.filter((_,i)=>i%3===2);

  return `
  <div style="text-align:center;margin-bottom:1.5rem">
    <h1 style="font-family:'Cinzel',serif;font-size:1.8rem;font-weight:900;
      color:var(--gold);letter-spacing:3px;margin:0">Sommaire</h1>
    <div style="width:60px;height:2px;background:var(--gold);
      margin:.5rem auto;border-radius:1px;opacity:.6"></div>
    <div style="font-size:.8rem;color:var(--text-dim)">${items.length} personnages</div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:2rem">
    <div style="display:flex;flex-direction:column;gap:.4rem">${col1.join('')}</div>
    <div style="display:flex;flex-direction:column;gap:.4rem">${col2.join('')}</div>
    <div style="display:flex;flex-direction:column;gap:.4rem">${col3.join('')}</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// FICHE NARRATIVE INDIVIDUELLE
// ══════════════════════════════════════════════════════════════════════════════
function _renderFiche(item, items) {
  const colors = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const col    = colors[item.nom.charCodeAt(0)%colors.length];
  const idx    = items.findIndex(i=>i.id===item.id);
  const prev   = items[idx-1]||null;
  const next   = items[idx+1]||null;

  // Barres de stats — uniquement si autorisé
  const statBars = item.stats.length && item.afficherStats ? `
  <div style="margin-top:1.2rem">
    <div style="font-family:'Cinzel',serif;font-size:.75rem;font-weight:700;
      letter-spacing:2px;color:var(--gold);text-align:center;margin-bottom:.75rem;
      text-transform:uppercase">Statistiques</div>
    <div style="display:flex;flex-direction:column;gap:.45rem">
      ${item.stats.map(st => {
        const pct = Math.max(8,Math.round((st.value/22)*100));
        return `<div style="display:flex;align-items:center;gap:.5rem">
          <span style="font-size:.65rem;color:var(--text-dim);width:70px;
            text-align:right;flex-shrink:0">${st.label}</span>
          <div style="flex:1;height:10px;background:rgba(255,255,255,.06);
            border-radius:999px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${st.color};
              border-radius:999px;transition:width .6s ease"></div>
          </div>
          <span style="font-size:.72rem;font-weight:700;color:${st.color};
            width:22px;text-align:right;flex-shrink:0">${st.value}</span>
        </div>`;
      }).join('')}
    </div>
  </div>` : '';

  // Chips vitaux — filtrés selon les permissions
  const vitaux = [
    item.afficherPV && item.pvMax!==null ? `<div style="text-align:center;padding:.5rem .75rem;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);border-radius:8px"><div style="font-size:.6rem;color:#ff6b6b;font-weight:700;text-transform:uppercase;letter-spacing:.5px">PV</div><div style="font-family:'Cinzel',serif;font-size:1rem;font-weight:800;color:#ff6b6b">${item.pvActuel??item.pvMax}/${item.pvMax}</div></div>` : '',
    item.afficherPM && item.pmMax!==null ? `<div style="text-align:center;padding:.5rem .75rem;background:rgba(79,140,255,.1);border:1px solid rgba(79,140,255,.25);border-radius:8px"><div style="font-size:.6rem;color:#4f8cff;font-weight:700;text-transform:uppercase;letter-spacing:.5px">PM</div><div style="font-family:'Cinzel',serif;font-size:1rem;font-weight:800;color:#4f8cff">${item.pmActuel??item.pmMax}/${item.pmMax}</div></div>` : '',
    item.afficherCA && item.ca!==null    ? `<div style="text-align:center;padding:.5rem .75rem;background:rgba(34,195,142,.1);border:1px solid rgba(34,195,142,.25);border-radius:8px"><div style="font-size:.6rem;color:#22c38e;font-weight:700;text-transform:uppercase;letter-spacing:.5px">CA</div><div style="font-family:'Cinzel',serif;font-size:1rem;font-weight:800;color:#22c38e">${item.ca}</div></div>` : '',
    item.afficherOr  && item.gold!==null ? `<div style="text-align:center;padding:.5rem .75rem;background:rgba(232,184,75,.1);border:1px solid rgba(232,184,75,.25);border-radius:8px"><div style="font-size:.6rem;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Or</div><div style="font-family:'Cinzel',serif;font-size:1rem;font-weight:800;color:var(--gold)">${item.gold}</div></div>` : '',
  ].filter(Boolean);

  const chap = item.chap || `Chapitre ${_toRoman(idx+1)} : ${item.nom}`;

  return `
  <!-- Breadcrumb + navigation -->
  <div style="display:flex;align-items:center;justify-content:space-between;
    margin-bottom:1.2rem;flex-wrap:wrap;gap:.5rem">
    <button onclick="window._ppBack()"
      style="display:flex;align-items:center;gap:.4rem;background:none;border:none;
      cursor:pointer;color:var(--text-dim);font-size:.8rem;transition:color .15s"
      onmouseover="this.style.color='var(--gold)'" onmouseout="this.style.color='var(--text-dim)'">
      ← Sommaire
    </button>
    <div style="display:flex;gap:.4rem">
      ${prev?`<button onclick="window._ppOpenFiche('${_esc(prev.id)}')"
        style="font-size:.72rem;padding:4px 10px;border-radius:8px;cursor:pointer;
        border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-dim);
        transition:all .12s"
        onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-dim)'">‹ ${_esc(prev.nom)}</button>`:''}
      ${next?`<button onclick="window._ppOpenFiche('${_esc(next.id)}')"
        style="font-size:.72rem;padding:4px 10px;border-radius:8px;cursor:pointer;
        border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-dim);
        transition:all .12s"
        onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-dim)'">›  ${_esc(next.nom)}</button>`:''}
    </div>
  </div>

  <!-- Carte principale -->
  <div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);overflow:hidden;
    display:grid;grid-template-columns:320px 1fr">

    <!-- Colonne gauche : illustration entière -->
    <div style="position:relative;background:linear-gradient(180deg,${col}12,var(--bg-panel));
      min-height:500px;overflow:hidden;display:flex;align-items:flex-end">

      ${item.imageUrl
        ? `<!-- Image entière — contain pour ne pas couper le personnage -->
           <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
             <img src="${_esc(item.imageUrl)}" style="width:100%;height:100%;
               object-fit:contain;display:block">
           </div>
           <!-- Fondu bas vers la carte -->
           <div style="position:absolute;bottom:0;left:0;right:0;height:35%;
             background:linear-gradient(to top,var(--bg-card),transparent)"></div>
           <!-- Fondu droite subtil -->
           <div style="position:absolute;inset:0;background:linear-gradient(to right,
             transparent 70%,var(--bg-card) 100%)"></div>`
        : `<div style="position:absolute;inset:0;display:flex;align-items:center;
             justify-content:center;font-family:'Cinzel',serif;font-size:5rem;
             font-weight:900;color:${col}22">${item.initials}</div>`}

      <!-- Badge masqué (admin seulement) -->
      ${STATE.isAdmin && !item.visible ? `
      <div style="position:absolute;top:10px;left:10px;z-index:10;
        background:rgba(255,107,107,.85);border-radius:6px;padding:2px 8px;
        font-size:.65rem;font-weight:700;color:#fff">🔒 Masqué</div>` : ''}

      <!-- Bloc nom en overlay bas -->
      <div style="position:relative;z-index:2;padding:1.2rem;width:100%">
        <div style="font-size:.68rem;font-weight:700;letter-spacing:2px;
          text-transform:uppercase;color:${col};margin-bottom:.3rem">${_esc(chap)}</div>
        <h2 style="font-family:'Cinzel',serif;font-size:1.6rem;font-weight:900;
          color:var(--text);letter-spacing:2px;margin:0 0 .2rem;
          text-shadow:0 2px 8px rgba(0,0,0,.5)">${_esc(item.nom)}</h2>
        <div style="font-size:.78rem;color:${col};font-style:italic">${_esc(item.subtitle||'')}</div>
        ${item.joueur ? `<div style="font-size:.68rem;color:var(--text-dim);margin-top:.2rem">Joué par ${_esc(item.joueur)}</div>` : ''}
        ${vitaux.length ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.65rem">${vitaux.join('')}</div>` : ''}
      </div>
    </div>

    <!-- Colonne droite : contenu narratif -->
    <div style="padding:1.8rem;display:flex;flex-direction:column;gap:1.2rem">

      <!-- Niveau + titres -->
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
        <span style="font-family:'Cinzel',serif;font-size:.75rem;font-weight:700;
          padding:3px 10px;border-radius:999px;
          background:${col}18;border:1px solid ${col}44;color:${col}">
          Niveau ${item.level||1}
        </span>
        ${item.titles.slice(0,4).map(t=>`<span style="font-size:.7rem;padding:2px 8px;
          border-radius:999px;background:rgba(232,184,75,.08);
          border:1px solid rgba(232,184,75,.2);color:var(--gold)">${_esc(t)}</span>`).join('')}
        ${STATE.isAdmin ? `
        <button onclick="openLinkedPlayerPresent('${_esc(item.charId)}','${_esc(item.presentationId)}')"
          style="margin-left:auto;font-size:.68rem;padding:2px 8px;border-radius:6px;
          border:1px solid rgba(79,140,255,.2);background:rgba(79,140,255,.08);
          color:#4f8cff;cursor:pointer">✏️ Modifier</button>` : ''}
      </div>

      <!-- Bio -->
      ${item.bio ? `
      <div>
        <div style="font-size:.7rem;color:var(--text-dim);font-weight:700;
          text-transform:uppercase;letter-spacing:1.5px;margin-bottom:.5rem">Présentation</div>
        <div style="font-size:.88rem;color:var(--text-muted);line-height:1.85">
          ${_nl2br(item.bio)}</div>
      </div>` : ''}

      <!-- Fragment d'archive -->
      ${item.archive ? `
      <div style="background:rgba(232,184,75,.04);border:1px solid rgba(232,184,75,.15);
        border-left:3px solid var(--gold);border-radius:0 10px 10px 0;
        padding:.85rem 1rem">
        <div style="font-family:'Cinzel',serif;font-size:.7rem;font-weight:700;
          color:var(--gold);letter-spacing:2px;text-transform:uppercase;
          margin-bottom:.5rem">✦ Fragment d'Archive</div>
        <div style="font-size:.82rem;color:var(--text-muted);line-height:1.8;
          font-style:italic">${_nl2br(item.archive)}</div>
        ${item.source ? `<div style="font-size:.68rem;color:var(--text-dim);
          margin-top:.4rem;text-align:right">— ${_esc(item.source)}</div>` : ''}
      </div>` : ''}

      <!-- Stats visuelles -->
      ${statBars}

      <!-- Actions -->
      ${item.charId ? `
      <div style="margin-top:auto;padding-top:.75rem;border-top:1px solid var(--border)">
        <button onclick="openCharacterSheetFromShowcase('${_esc(item.charId)}')"
          class="btn btn-gold btn-sm" style="font-size:.75rem">
          📜 Ouvrir la fiche complète
        </button>
      </div>` : ''}
    </div>

  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ══════════════════════════════════════════════════════════════════════════════
async function renderPlayersPage() {
  const content = document.getElementById('main-content');

  const [presentations, characters] = await Promise.all([
    loadCollection('players'),
    loadCollection('characters'),
  ]);
  STORE.presentations = presentations;
  STORE.characters    = characters;
  STORE.items         = _buildDataset(presentations, characters);
  if (!STORE.activeId) STORE.activeId = '';

  if (!STORE.items.length) {
    content.innerHTML = `
      <div class="page-header">
        <div class="page-title"><span class="page-title-accent">⚔️ Personnages</span></div>
      </div>
      ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Admin</div>
        <button class="btn btn-gold btn-sm" onclick="openPlayerPresentModal()">+ Ajouter</button></div>` : ''}
      <div class="empty-state"><div class="icon">⚔️</div><p>Aucun personnage disponible.</p></div>`;
    return;
  }

  _renderView(content);
}

function _renderView(content) {
  const items = STORE.items;
  const activeItem = STORE.activeId ? items.find(i=>i.id===STORE.activeId) : null;

  content.innerHTML = `
  <div style="max-width:1000px;margin:0 auto">
    ${STATE.isAdmin ? `
    <div class="admin-section" style="margin-bottom:1rem">
      <div class="admin-label">Admin</div>
      <button class="btn btn-gold btn-sm" onclick="openPlayerPresentModal()">+ Ajouter une présentation</button>
    </div>` : ''}

    <div id="pp-view-area">
      ${activeItem ? _renderFiche(activeItem, items) : _renderSommaire(items)}
    </div>
  </div>`;
}

window._ppOpenFiche = (id) => {
  STORE.activeId = id;
  const el = document.getElementById('pp-view-area');
  if (el) el.innerHTML = _renderFiche(STORE.items.find(i=>i.id===id), STORE.items);
  window.scrollTo(0,0);
};

window._ppBack = () => {
  STORE.activeId = '';
  const el = document.getElementById('pp-view-area');
  if (el) el.innerHTML = _renderSommaire(STORE.items);
};

// ── Numéros romains ───────────────────────────────────────────────────────────
function _toRoman(n) {
  const v=[1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const s=['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r='';
  for(let i=0;i<v.length;i++) while(n>=v[i]){r+=s[i];n-=v[i];}
  return r;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — CRÉATION / ÉDITION (avec upload+crop)
// ══════════════════════════════════════════════════════════════════════════════
async function openPlayerPresentModal(player=null) {
  const characters = STORE.characters.length ? STORE.characters : await loadCollection('characters');
  window.__ppChars = characters;
  const curCharId = player?.charId||'';

  openModal(player?`✏️ Modifier — ${player.nom||'PJ'}`:'⚔️ Nouveau personnage', `
    <div class="form-group">
      <label>Fiche liée</label>
      <div style="display:grid;grid-template-columns:1fr auto;gap:.5rem">
        <select class="input-field" id="pp-char-id">
          <option value="">— Aucun lien —</option>
          ${characters.map(c=>`<option value="${_esc(c.id)}" ${c.id===curCharId?'selected':''}>${_esc(c.nom||'?')}</option>`).join('')}
        </select>
        <button class="btn btn-outline btn-sm" type="button" onclick="prefillPlayerPresentFromLinkedChar(true)">Préremplir</button>
      </div>
    </div>

    <div class="grid-2" style="gap:.75rem">
      <div class="form-group" style="margin:0">
        <label>Nom</label>
        <input class="input-field" id="pp-nom" value="${_esc(player?.nom||'')}">
      </div>
      <div class="form-group" style="margin:0">
        <label>Chapitre <span style="color:var(--text-dim);font-weight:400">(ex: Chapitre I : Khaarys)</span></label>
        <input class="input-field" id="pp-chap" value="${_esc(player?.chapitre||'')}" placeholder="Chapitre I : Nom">
      </div>
    </div>

    <div class="grid-2" style="gap:.75rem;margin-top:.75rem">
      <div class="form-group" style="margin:0">
        <label>Classe</label>
        <input class="input-field" id="pp-classe" value="${_esc(player?.classe||'')}">
      </div>
      <div class="form-group" style="margin:0">
        <label>Race</label>
        <input class="input-field" id="pp-race" value="${_esc(player?.race||'')}">
      </div>
    </div>

    <div class="grid-2" style="gap:.75rem;margin-top:.75rem">
      <div class="form-group" style="margin:0">
        <label>Niveau</label>
        <input type="number" class="input-field" id="pp-niveau" value="${player?.niveau||1}">
      </div>
      <div class="form-group" style="margin:0">
        <label>Joueur</label>
        <input class="input-field" id="pp-joueur" value="${_esc(player?.joueur||'')}">
      </div>
    </div>

    <div class="grid-2" style="gap:.75rem;margin-top:.75rem">
      <div class="form-group" style="margin:0">
        <label>Ordre d'affichage <span style="color:var(--text-dim);font-weight:400">(1 = premier)</span></label>
        <input type="number" class="input-field" id="pp-ordre" value="${player?.ordre??''}" placeholder="Automatique" min="1">
      </div>
      <div class="form-group" style="margin:0">
        <label style="margin-bottom:.5rem">Visibilité</label>
        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.85rem;color:var(--text-muted)">
          <input type="checkbox" id="pp-visible" ${player?.visible!==false?'checked':''} style="accent-color:var(--gold)">
          Visible dans le sommaire
        </label>
      </div>
    </div>

    <!-- Confidentialité des infos de jeu -->
    <div style="background:rgba(255,255,255,.02);border:1px solid var(--border);
      border-radius:10px;padding:.85rem 1rem;margin-top:.75rem">
      <div style="font-size:.7rem;font-weight:700;color:var(--text-dim);
        letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.65rem">
        🔒 Informations visibles par les joueurs
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">
        ${[
          {id:'pp-show-pv',   label:'Points de Vie (PV)', key:'afficherPV',    def:true },
          {id:'pp-show-pm',   label:'Points de Magie (PM)',key:'afficherPM',   def:true },
          {id:'pp-show-ca',   label:'Classe d\'Armure (CA)',key:'afficherCA',  def:true },
          {id:'pp-show-or',   label:'Or',                  key:'afficherOr',   def:false},
          {id:'pp-show-stats',label:'Statistiques',         key:'afficherStats',def:true },
        ].map(f => {
          const checked = player?.[f.key]!==undefined ? player[f.key] : f.def;
          return `<label style="display:flex;align-items:center;gap:.45rem;cursor:pointer;
            font-size:.8rem;color:var(--text-muted);padding:.2rem 0">
            <input type="checkbox" id="${f.id}" ${checked?'checked':''}
              style="accent-color:var(--gold)">
            ${f.label}
          </label>`;
        }).join('')}
      </div>
    </div>

    <div class="form-group" style="margin-top:.75rem">
      <label>Présentation narrative</label>
      <textarea class="input-field" id="pp-bio" rows="4">${_esc(player?.bio||'')}</textarea>
    </div>
      <textarea class="input-field" id="pp-archive" rows="3">${_esc(player?.archive||'')}</textarea>
    </div>

    <div class="form-group">
      <label>Source du fragment</label>
      <input class="input-field" id="pp-source" value="${_esc(player?.archiveSource||'')}" placeholder="— Recueil des voix de Granlac,">
    </div>

    <!-- Upload + crop illustration -->
    <div class="form-group">
      <label>Illustration</label>
      <div id="pp-img-drop" style="border:2px dashed var(--border-strong);border-radius:10px;
        padding:.85rem;text-align:center;cursor:pointer;background:var(--bg-elevated)">
        <div id="pp-img-preview">
          ${player?.imageUrl
            ? `<img src="${_esc(player.imageUrl)}" style="max-height:80px;border-radius:8px;max-width:100%">`
            : `<div style="font-size:1.5rem;margin-bottom:3px">🖼️</div>
               <div style="font-size:.75rem;color:var(--text-muted)">
                 <span style="color:var(--gold)">Cliquer</span> ou glisser une image</div>`}
        </div>
      </div>
      <div id="pp-crop-wrap" style="display:none;margin-top:.6rem">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.35rem">Recadrez l'illustration</div>
        <canvas id="pp-crop-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" style="width:100%;margin-top:.4rem"
          onclick="window._ppConfirmCrop()">✂️ Confirmer</button>
        <div id="pp-crop-ok" style="display:none;font-size:.72rem;text-align:center;margin-top:3px;color:var(--green)"></div>
      </div>
      ${player?.imageUrl ? `<button type="button" onclick="window._ppClearImg()"
        style="font-size:.72rem;background:none;border:none;cursor:pointer;color:#ff6b6b;margin-top:.3rem">
        ✕ Retirer l'image</button>` : ''}
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="savePlayerPresent('${_esc(player?.id||'')}')">Enregistrer</button>
      ${player?.id ? `<button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:rgba(255,107,107,.3)"
        onclick="deletePlayerPresent('${_esc(player.id)}')">🗑️</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);

  // Setup crop
  window._ppImgBase64 = null;
  window._ppImgCleared = false;

  const fi = document.createElement('input');
  fi.type='file'; fi.accept='image/*';
  fi.style.cssText='position:absolute;opacity:0;width:0;height:0';
  document.body.appendChild(fi);

  const handleFile = (file) => {
    if(!file?.type.startsWith('image/')) return;
    const r=new FileReader();
    r.onload=(e)=>_initPpCrop(e.target.result);
    r.readAsDataURL(file);
  };
  fi.addEventListener('change',()=>handleFile(fi.files[0]));
  const drop = document.getElementById('pp-img-drop');
  drop?.addEventListener('click',()=>fi.click());
  drop?.addEventListener('dragover',e=>{e.preventDefault();drop.style.borderColor='var(--gold)';});
  drop?.addEventListener('dragleave',()=>{drop.style.borderColor='var(--border-strong)';});
  drop?.addEventListener('drop',e=>{e.preventDefault();drop.style.borderColor='var(--border-strong)';handleFile(e.dataTransfer.files[0]);});

  const obs=new MutationObserver(()=>{if(!document.getElementById('pp-img-drop')){fi.remove();obs.disconnect();}});
  obs.observe(document.body,{childList:true,subtree:true});

  window._ppClearImg = () => {
    window._ppImgBase64=''; window._ppImgCleared=true;
    const prev=document.getElementById('pp-img-preview');
    if(prev) prev.innerHTML=`<div style="font-size:1.5rem;margin-bottom:3px">🖼️</div>
      <div style="font-size:.75rem;color:var(--text-muted)"><span style="color:var(--gold)">Cliquer</span> ou glisser</div>`;
    document.getElementById('pp-crop-wrap').style.display='none';
  };
}

function _initPpCrop(dataUrl) {
  const wrap=document.getElementById('pp-crop-wrap');
  const canvas=document.getElementById('pp-crop-canvas');
  if(!wrap||!canvas) return;
  wrap.style.display='block';
  document.getElementById('pp-crop-ok').style.display='none';
  const img=new Image();
  img.onload=()=>{
    _ppCrop.img=img;_ppCrop.natW=img.naturalWidth;_ppCrop.natH=img.naturalHeight;
    const maxW=Math.min(440,img.naturalWidth);
    _ppCrop.dispScale=maxW/img.naturalWidth;
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    canvas.style.width=maxW+'px';canvas.style.height=Math.round(img.naturalHeight*_ppCrop.dispScale)+'px';
    // Ratio portrait 3:4 par défaut
    const w=Math.round(Math.min(img.naturalWidth,img.naturalHeight*0.75));
    const h=Math.round(w*4/3);
    _ppCrop.cropX=Math.round((img.naturalWidth-w)/2);
    _ppCrop.cropY=Math.round((img.naturalHeight-h)/2);
    _ppCrop.cropW=w;_ppCrop.cropH=Math.min(h,img.naturalHeight);
    _drawPpCrop();_bindPpCrop(canvas);
    const prev=document.getElementById('pp-img-preview');
    if(prev) prev.innerHTML=`<img src="${dataUrl}" style="max-height:50px;border-radius:6px;opacity:.6">
      <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px">Recadrez ci-dessous</div>`;
  };
  img.src=dataUrl;
}
function _ppHandles(){const{cropX:x,cropY:y,cropW:w,cropH:h}=_ppCrop;return[{id:'nw',x,y},{id:'n',x:x+w/2,y},{id:'ne',x:x+w,y},{id:'w',x,y:y+h/2},{id:'e',x:x+w,y:y+h/2},{id:'sw',x,y:y+h},{id:'s',x:x+w/2,y:y+h},{id:'se',x:x+w,y:y+h}];}
function _ppHitH(nx,ny){const t=9/_ppCrop.dispScale;return _ppHandles().find(h=>Math.abs(h.x-nx)<t&&Math.abs(h.y-ny)<t)||null;}
function _drawPpCrop(){
  const c=document.getElementById('pp-crop-canvas');if(!c||!_ppCrop.img)return;
  const ctx=c.getContext('2d'),{img,natW,natH,cropX,cropY,cropW,cropH}=_ppCrop;
  ctx.clearRect(0,0,natW,natH);ctx.drawImage(img,0,0,natW,natH);
  ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,natW,natH);
  ctx.drawImage(img,cropX,cropY,cropW,cropH,cropX,cropY,cropW,cropH);
  ctx.strokeStyle='var(--gold)';ctx.lineWidth=2;ctx.strokeRect(cropX,cropY,cropW,cropH);
  ctx.fillStyle='var(--gold)';ctx.strokeStyle='#0b1118';ctx.lineWidth=1.5;
  _ppHandles().forEach(h=>{ctx.fillRect(h.x-5,h.y-5,10,10);ctx.strokeRect(h.x-5,h.y-5,10,10);});
}
function _ppToN(c,cx,cy){const r=c.getBoundingClientRect();return{x:(cx-r.left)/_ppCrop.dispScale,y:(cy-r.top)/_ppCrop.dispScale};}
function _bindPpCrop(canvas){
  const MIN=40;
  const onStart=(cx,cy)=>{const{x,y}=_ppToN(canvas,cx,cy),h=_ppHitH(x,y);if(h){_ppCrop.isResizing=true;_ppCrop.handle=h.id;}else{const{cropX,cropY,cropW,cropH}=_ppCrop;if(x>=cropX&&x<=cropX+cropW&&y>=cropY&&y<=cropY+cropH){_ppCrop.isDragging=true;_ppCrop.startX=x-cropX;_ppCrop.startY=y-cropY;}}};
  const onMove=(cx,cy)=>{if(!_ppCrop.isDragging&&!_ppCrop.isResizing)return;const{x,y}=_ppToN(canvas,cx,cy),{natW:W,natH:H}=_ppCrop;if(_ppCrop.isDragging){_ppCrop.cropX=Math.round(_ppc(x-_ppCrop.startX,0,W-_ppCrop.cropW));_ppCrop.cropY=Math.round(_ppc(y-_ppCrop.startY,0,H-_ppCrop.cropH));_drawPpCrop();return;}let{cropX,cropY,cropW,cropH,handle}=_ppCrop;const a={x:cropX,y:cropY,x2:cropX+cropW,y2:cropY+cropH};if(handle==='se'){cropW=_ppc(x-a.x,MIN,W-a.x);cropH=_ppc(y-a.y,MIN,H-a.y);}else if(handle==='sw'){cropW=_ppc(a.x2-x,MIN,a.x2);cropH=_ppc(y-a.y,MIN,H-a.y);cropX=a.x2-cropW;}else if(handle==='ne'){cropW=_ppc(x-a.x,MIN,W-a.x);cropH=_ppc(a.y2-y,MIN,a.y2);cropY=a.y2-cropH;}else if(handle==='nw'){cropW=_ppc(a.x2-x,MIN,a.x2);cropH=_ppc(a.y2-y,MIN,a.y2);cropX=a.x2-cropW;cropY=a.y2-cropH;}else if(handle==='e'){cropW=_ppc(x-a.x,MIN,W-a.x);}else if(handle==='w'){cropW=_ppc(a.x2-x,MIN,a.x2);cropX=a.x2-cropW;}else if(handle==='s'){cropH=_ppc(y-a.y,MIN,H-a.y);}else if(handle==='n'){cropH=_ppc(a.y2-y,MIN,a.y2);cropY=a.y2-cropH;}_ppCrop.cropX=Math.round(_ppc(cropX,0,W-MIN));_ppCrop.cropY=Math.round(_ppc(cropY,0,H-MIN));_ppCrop.cropW=Math.round(_ppc(cropW,MIN,W-_ppCrop.cropX));_ppCrop.cropH=Math.round(_ppc(cropH,MIN,H-_ppCrop.cropY));_drawPpCrop();};
  const onEnd=()=>{_ppCrop.isDragging=false;_ppCrop.isResizing=false;_ppCrop.handle=null;};
  canvas.addEventListener('mousedown',e=>{e.preventDefault();onStart(e.clientX,e.clientY);});
  window.addEventListener('mousemove',e=>onMove(e.clientX,e.clientY));
  window.addEventListener('mouseup',onEnd);
  canvas.addEventListener('touchstart',e=>{e.preventDefault();onStart(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();onMove(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  canvas.addEventListener('touchend',onEnd);
}
window._ppConfirmCrop = () => {
  const{img,cropX,cropY,cropW,cropH}=_ppCrop;if(!img)return;
  const TARGET=700_000;
  const scale=cropW>1400?1400/cropW:1;
  const out=document.createElement('canvas');out.width=Math.round(cropW*scale);out.height=Math.round(cropH*scale);
  out.getContext('2d').drawImage(img,cropX,cropY,cropW,cropH,0,0,out.width,out.height);
  let b64;
  for(const q of[.85,.75,.65,.55]){b64=out.toDataURL('image/jpeg',q);if(b64.length<=TARGET)break;}
  window._ppImgBase64=b64;
  document.getElementById('pp-crop-wrap').style.display='none';
  const ok=document.getElementById('pp-crop-ok');
  if(ok){ok.style.display='block';ok.textContent=`✓ Image prête (${Math.round(b64.length/1024)} KB)`;}
  const prev=document.getElementById('pp-img-preview');
  if(prev) prev.innerHTML=`<img src="${b64}" style="max-height:80px;border-radius:8px">`;
};

// ── Save ──────────────────────────────────────────────────────────────────────
async function savePlayerPresent(id='') {
  // Image : crop > existante > effacée
  let imageUrl='';
  if(window._ppImgBase64!=null&&window._ppImgBase64!==undefined){
    imageUrl=window._ppImgBase64;
  } else if(id && !window._ppImgCleared){
    const existing=STORE.presentations.find(p=>p.id===id);
    imageUrl=existing?.imageUrl||'';
  }
  window._ppImgBase64=null; window._ppImgCleared=false;

  const data = {
    charId:        document.getElementById('pp-char-id')?.value        || '',
    nom:           document.getElementById('pp-nom')?.value?.trim()    || 'Personnage',
    chapitre:      document.getElementById('pp-chap')?.value?.trim()   || '',
    classe:        document.getElementById('pp-classe')?.value?.trim() || '',
    race:          document.getElementById('pp-race')?.value?.trim()   || '',
    niveau:        parseInt(document.getElementById('pp-niveau')?.value,10)||1,
    joueur:        document.getElementById('pp-joueur')?.value?.trim() || '',
    bio:           document.getElementById('pp-bio')?.value            || '',
    archive:       document.getElementById('pp-archive')?.value        || '',
    archiveSource: document.getElementById('pp-source')?.value?.trim() || '',
    emoji:         '',
    imageUrl,
    // Ordre + visibilité
    ordre:         parseInt(document.getElementById('pp-ordre')?.value,10) || 999,
    visible:       document.getElementById('pp-visible')?.checked ?? true,
    // Confidentialité
    afficherPV:    document.getElementById('pp-show-pv')?.checked    ?? true,
    afficherPM:    document.getElementById('pp-show-pm')?.checked    ?? true,
    afficherCA:    document.getElementById('pp-show-ca')?.checked    ?? true,
    afficherOr:    document.getElementById('pp-show-or')?.checked    ?? false,
    afficherStats: document.getElementById('pp-show-stats')?.checked ?? true,
  };

  if(id) await updateInCol('players',id,data);
  else   await addToCol('players',data);

  closeModal();
  showNotif('Présentation enregistrée !','success');
  await PAGES.players();
}

function prefillPlayerPresentFromLinkedChar(force=false) {
  const charId=document.getElementById('pp-char-id')?.value||'';
  const char=(window.__ppChars||[]).find(c=>c.id===charId);
  if(!char) return;
  const set=(id,v)=>{const f=document.getElementById(id);if(!f)return;if(!force&&String(f.value||'').trim())return;f.value=v;};
  set('pp-nom',char.nom||'');
  set('pp-niveau',char.niveau||1);
  set('pp-joueur',char.ownerPseudo||'');
}

async function deletePlayerPresent(id) {
  if(!confirm('Supprimer cette présentation ?')) return;
  await deleteFromCol('players',id);
  showNotif('Supprimée.','success');
  STORE.activeId='';
  await PAGES.players();
}

async function editPlayerPresent(id) {
  const items=await loadCollection('players');
  const p=items.find(e=>e.id===id);
  if(p) openPlayerPresentModal(p);
}

function openLinkedPlayerPresent(charId='', presentationId='') {
  if(presentationId){ editPlayerPresent(presentationId); return; }
  const item=STORE.items.find(e=>e.charId===charId);
  openPlayerPresentModal(item?{
    charId:item.charId,nom:item.nom,classe:item.classe,race:item.race,
    niveau:item.niveau,joueur:item.joueur,
    bio:item.bio||'',archive:item.archive||'',archiveSource:item.source||'',
    chapitre:item.chap||'',imageUrl:item.imageUrl,
  }:{charId});
}

async function viewPlayerDetail(id) {
  window._ppOpenFiche?.(id);
}

async function openCharacterSheetFromShowcase(charId) {
  if(!charId) return;
  await window.navigate?.('characters');
  setTimeout(()=>{
    const pill=Array.from(document.querySelectorAll('#char-pills .char-pill'))
      .find(e=>e.getAttribute('onclick')?.includes(`'${charId}'`));
    if(pill){pill.click();return;}
    const c=window.STATE?.characters?.find(e=>e.id===charId);
    if(c&&window.renderCharSheet){window.STATE.activeChar=c;window.renderCharSheet(c);}
  },50);
}

// ── Override ──────────────────────────────────────────────────────────────────
PAGES.players = renderPlayersPage;

Object.assign(window, {
  renderPlayersPage,
  openPlayerPresentModal,
  prefillPlayerPresentFromLinkedChar,
  savePlayerPresent,
  viewPlayerDetail,
  editPlayerPresent,
  openLinkedPlayerPresent,
  deletePlayerPresent,
  openCharacterSheetFromShowcase,
});
