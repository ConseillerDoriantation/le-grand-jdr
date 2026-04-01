// ══════════════════════════════════════════════════════════════════════════════
// STORY.JS — La Trame v2
// ✓ Actes persistés en Firestore (visibles même vides)
// ✓ Upload + recadrage d'image canvas 4:3 (identique aux hauts-faits)
// ✓ Liens inter-missions (flèches SVG entre axes différents)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── Palettes ──────────────────────────────────────────────────────────────────
const AXE_COLORS = [
  '#4f8cff','#e8b84b','#22c38e','#ff6b6b',
  '#b47fff','#ff9f43','#54a0ff','#ff6b9d',
];

const STATUT_CFG = {
  'Terminée':   { color:'#22c38e', border:'rgba(34,195,142,0.35)',  icon:'✓' },
  'En cours':   { color:'#4f8cff', border:'rgba(79,140,255,0.35)',  icon:'▶' },
  'Échouée':    { color:'#ff6b6b', border:'rgba(255,107,107,0.35)', icon:'✗' },
  'En attente': { color:'#666',    border:'rgba(128,128,128,0.25)', icon:'◷' },
};

// ── État du cropper ───────────────────────────────────────────────────────────
let _crop = {
  img:null, cropX:0,cropY:0,cropW:0,cropH:0,
  startX:0,startY:0, isDragging:false,isResizing:false,handle:null,
  natW:0,natH:0,dispScale:1, base64:null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function stCfg(item){ return STATUT_CFG[item.statut] || STATUT_CFG['En attente']; }
const _clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

let _axeMap = {};
function axeColor(axe){
  if(!axe) return '#555';
  if(!_axeMap[axe]){ _axeMap[axe] = AXE_COLORS[Object.keys(_axeMap).length % AXE_COLORS.length]; }
  return _axeMap[axe];
}

// ── Gestion des actes (Firestore) ─────────────────────────────────────────────
async function loadActes() {
  const doc = await getDocData('story_meta','actes');
  return Array.isArray(doc?.list) ? doc.list : [];
}
async function saveActes(list) {
  await saveDoc('story_meta','actes',{ list });
}

// ── RENDU PRINCIPAL ───────────────────────────────────────────────────────────
async function renderStory() {
  const content = document.getElementById('main-content');
  _axeMap = {};

  const [items, savedActes] = await Promise.all([
    loadCollection('story'),
    loadActes(),
  ]);

  // Fusionner actes Firestore + actes déduits des items
  const fromItems = [...new Set(items.map(i => i.acte).filter(Boolean))];
  const allActes  = [...new Set([...savedActes, ...fromItems])].sort();
  if (!allActes.length) allActes.push('Acte I');

  const activeActe = window._storyActe && allActes.includes(window._storyActe)
    ? window._storyActe
    : allActes[0];
  window._storyActe = activeActe;

  const acteItems = items
    .filter(i => (i.acte || 'Acte I') === activeActe)
    .sort((a,b) => (a.ordre||0)-(b.ordre||0) || (a.date||'').localeCompare(b.date||''));

  acteItems.forEach(i => { if(i.axe) axeColor(i.axe); });
  const axes = Object.keys(_axeMap);

  content.innerHTML = `
  <style>
    .sn{cursor:pointer;transition:transform .15s;}
    .sn:hover{transform:translateY(-3px);z-index:10;}
    .sn:hover .sn-inner{box-shadow:0 8px 28px rgba(0,0,0,.45);}
    .sn-inner{transition:box-shadow .15s;}
    .stl-wrap{overflow-x:auto;overflow-y:visible;padding-bottom:1.5rem;}
    .stl-wrap::-webkit-scrollbar{height:4px;}
    .stl-wrap::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:2px;}
  </style>

  <div style="background:linear-gradient(135deg,rgba(79,140,255,.05),rgba(232,184,75,.04));
    border:1px solid var(--border);border-radius:var(--radius-lg);
    padding:1.4rem 1.8rem;margin-bottom:1.4rem;
    display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
    <div>
      <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:.3rem">Chroniques de la Compagnie</div>
      <h1 style="font-family:'Cinzel',serif;font-size:1.8rem;color:var(--gold);letter-spacing:2px;line-height:1;margin:0">La Trame</h1>
    </div>
    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
      ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" onclick="openStoryModal()">+ Ajouter</button>` : ''}
      <div style="display:flex;gap:.5rem;font-size:.72rem;color:var(--text-dim);flex-wrap:wrap">
        ${Object.entries(STATUT_CFG).map(([s,c]) =>
          `<span style="display:flex;align-items:center;gap:4px">
            <span style="width:7px;height:7px;border-radius:50%;background:${c.color};display:inline-block"></span>${s}
          </span>`).join('')}
      </div>
    </div>
  </div>

  <div style="display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center">
    ${allActes.map(acte => {
      const active = acte === activeActe;
      const n = items.filter(i => (i.acte||'Acte I') === acte).length;
      return `<button onclick="window._storyActe='${acte}';navigate('story')" style="
        display:flex;align-items:center;gap:.5rem;padding:.55rem 1.2rem;
        border-radius:999px;cursor:pointer;font-family:'Cinzel',serif;font-size:.82rem;
        border:1px solid ${active?'var(--gold)':'var(--border)'};
        background:${active?'rgba(232,184,75,.1)':'transparent'};
        color:${active?'var(--gold)':'var(--text-muted)'};transition:all .15s;">
        ${acte}
        <span style="font-size:.68rem;border-radius:999px;padding:1px 6px;
          background:${active?'var(--gold)':'var(--bg-elevated)'};
          color:${active?'#0b1118':'var(--text-dim)'};">${n}</span>
      </button>`;
    }).join('')}
    ${STATE.isAdmin ? `
    <button onclick="openNewActeModal()" style="padding:.5rem .9rem;border-radius:999px;cursor:pointer;
      border:1px dashed var(--border);background:transparent;color:var(--text-dim);font-size:.8rem">+ Acte</button>` : ''}
  </div>

  ${axes.length ? `
  <div style="display:flex;gap:.5rem;margin-bottom:1.2rem;flex-wrap:wrap;align-items:center">
    <span style="font-size:.7rem;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">Axes :</span>
    ${axes.map(a => `
      <span style="display:flex;align-items:center;gap:5px;font-size:.75rem;color:var(--text-muted);
        background:var(--bg-elevated);border:1px solid var(--border);border-radius:999px;padding:3px 10px">
        <span style="width:10px;height:3px;border-radius:1px;background:${_axeMap[a]};display:inline-block"></span>${a}
      </span>`).join('')}
  </div>` : ''}

  ${acteItems.length === 0 ? `
    <div style="text-align:center;padding:5rem 2rem;color:var(--text-dim)">
      <div style="font-size:3rem;margin-bottom:1rem;opacity:.3">📜</div>
      <p style="font-style:italic">Aucune mission pour ${activeActe}.</p>
      ${STATE.isAdmin?`<button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="openStoryModal()">+ Ajouter la première</button>`:''}
    </div>` : `
    <div class="stl-wrap">
      <div id="story-tl" style="position:relative;min-width:max-content;padding:1rem 1.5rem 2.5rem">
        ${_renderTimeline(acteItems)}
      </div>
    </div>`}
  `;
}

// ── RENDU TIMELINE ────────────────────────────────────────────────────────────
// • Ordre global : même valeur d'ordre = même colonne chronologique
// • Split de ligne : si 2+ missions du même axe ont le même ordre,
//   la ligne se divise en sous-lignes verticalement, puis se remerge.
function _renderTimeline(items) {
  const CARD_W  = 160;
  const CARD_GAP = 28;
  const CARD_H  = 140; // hauteur d'une card (image + texte)
  const SUB_GAP =  20; // espace entre sous-lignes d'un même axe
  const ROW_GAP =  44; // espace entre deux axes différents
  const PAD_L   =  28;

  // ── 1. Regrouper par axe ──────────────────────────────────────────────────
  const axeOrder = [], axeGroups = {};
  items.forEach(item => {
    const key = item.axe || '__none__';
    if (!axeGroups[key]) { axeGroups[key] = []; axeOrder.push(key); }
    axeGroups[key].push(item);
  });

  // ── 2. Colonnes globales (ordre → colIdx) ─────────────────────────────────
  const allOrdres  = [...new Set(items.map(i => i.ordre || 0))].sort((a, b) => a - b);
  const ordreToCol = {};
  allOrdres.forEach((o, i) => { ordreToCol[o] = i; });
  const totalCols  = allOrdres.length || 1;

  // ── 3. Calculer la géométrie de chaque axe ────────────────────────────────
  // Pour chaque axe, trouver les "slots" : groupes d'items qui partagent le même ordre.
  // Un slot avec N items crée N sous-lignes pendant cette colonne.
  //
  // Résultat par axe : { subRows: [{ item, subRow }], rowHeight, centerY (relatif au top de l'axe) }
  const axeLayout = {}; // key → { slots, nSubRowsMax, rowH, centerY, items: [{item, subRow, col}] }

  axeOrder.forEach(key => {
    const group   = axeGroups[key];
    // Grouper par colonne
    const byCol   = {};
    group.forEach(item => {
      const col = ordreToCol[item.ordre || 0] ?? 0;
      if (!byCol[col]) byCol[col] = [];
      byCol[col].push(item);
    });

    // Nombre max de sous-lignes simultanées dans cet axe
    const maxSubs = Math.max(...Object.values(byCol).map(a => a.length));

    // Hauteur totale de la rangée pour cet axe
    const rowH  = maxSubs * CARD_H + (maxSubs - 1) * SUB_GAP;
    // Y central de la ligne principale (milieu de la rangée)
    const centerY = rowH / 2;

    // Assigner un sous-index à chaque item dans sa colonne
    const layoutItems = [];
    group.forEach(item => {
      const col     = ordreToCol[item.ordre || 0] ?? 0;
      const siblings = byCol[col];
      const subRow  = siblings.indexOf(item); // 0..N-1
      // Y de cette sous-ligne, centré autour du centre de l'axe
      // Pour N sous-lignes : y0 = centerY - (N-1)/2 * (CARD_H+SUB_GAP)
      const N    = siblings.length;
      const subY = centerY - (N - 1) / 2 * (CARD_H + SUB_GAP) + subRow * (CARD_H + SUB_GAP);
      layoutItems.push({ item, col, subRow, subY, N, siblings });
    });

    axeLayout[key] = { rowH, centerY, maxSubs, byCol, layoutItems };
  });

  // ── 4. Positions absolues (top de chaque axe) ─────────────────────────────
  const axeTop = {}; // key → y absolu du top de la rangée
  let curY = ROW_GAP;
  axeOrder.forEach(key => {
    axeTop[key] = curY;
    curY += axeLayout[key].rowH + ROW_GAP;
  });
  const totalH = curY;
  const totalW = PAD_L + totalCols * (CARD_W + CARD_GAP) + PAD_L;

  // ── 5. posMap pour les flèches inter-axes ────────────────────────────────
  const posMap = {};
  axeOrder.forEach(key => {
    const layout = axeLayout[key];
    const top    = axeTop[key];
    layout.layoutItems.forEach(({ item, col, subY }) => {
      const cx = PAD_L + col * (CARD_W + CARD_GAP) + CARD_W / 2;
      const cy = top + subY + CARD_H / 2;
      posMap[item.id] = { cx, cy };
    });
  });

  // ── 6. SVG ────────────────────────────────────────────────────────────────
  let svgLines = '';
  const defsHtml = [];

  axeOrder.forEach(key => {
    const color   = key === '__none__' ? '#555' : (_axeMap[key] || '#555');
    const layout  = axeLayout[key];
    const top     = axeTop[key];
    const centerY = top + layout.centerY;

    // Trier les items par colonne
    const sorted = [...layout.layoutItems].sort((a, b) => a.col - b.col);
    if (sorted.length === 0) return;

    // Construire les segments de la ligne principale + splits/merges
    // On parcourt les colonnes dans l'ordre :
    //   - Avant un split : ligne principale vers x de split
    //   - Pendant un split : branches vers chaque sous-ligne, puis retour
    //   - Après un merge : depuis x de merge vers la suite
    const colsSorted = [...new Set(sorted.map(s => s.col))].sort((a, b) => a - b);

    for (let ci = 0; ci < colsSorted.length; ci++) {
      const col     = colsSorted[ci];
      const colItems = sorted.filter(s => s.col === col);
      const N       = colItems.length;
      const cx      = PAD_L + col * (CARD_W + CARD_GAP) + CARD_W / 2;

      if (N === 1) {
        // Pas de split : point sur la ligne principale
        const itemCy = top + colItems[0].subY + CARD_H / 2;
        svgLines += `<circle cx="${cx}" cy="${itemCy}" r="4" fill="${color}" opacity=".75"/>`;

        // Segment depuis la colonne précédente
        if (ci > 0) {
          const prevCol  = colsSorted[ci - 1];
          const prevItems = sorted.filter(s => s.col === prevCol);
          const prevCx   = PAD_L + prevCol * (CARD_W + CARD_GAP) + CARD_W / 2;
          const prevN    = prevItems.length;

          if (prevN === 1) {
            // Ligne directe d'un point à l'autre
            const prevCy = top + prevItems[0].subY + CARD_H / 2;
            svgLines += `<line x1="${prevCx}" y1="${prevCy}" x2="${cx}" y2="${itemCy}"
              stroke="${color}" stroke-width="2" opacity=".35"/>`;
          } else {
            // Merge : convergence de N branches vers ce point
            prevItems.forEach(prev => {
              const prevCy = top + prev.subY + CARD_H / 2;
              // Courbe de Bézier douce pour le merge
              const mpx = prevCx + (cx - prevCx) * 0.5;
              svgLines += `<path d="M${prevCx} ${prevCy} C${mpx} ${prevCy} ${mpx} ${itemCy} ${cx} ${itemCy}"
                fill="none" stroke="${color}" stroke-width="1.5" opacity=".35"/>`;
            });
          }
        }
      } else {
        // Split : N branches depuis le point précédent
        colItems.forEach(ci2 => {
          const branchCy = top + ci2.subY + CARD_H / 2;
          svgLines += `<circle cx="${cx}" cy="${branchCy}" r="4" fill="${color}" opacity=".75"/>`;

          if (ci > 0) {
            const prevCol   = colsSorted[ci - 1];
            const prevItems = sorted.filter(s => s.col === prevCol);
            const prevCx    = PAD_L + prevCol * (CARD_W + CARD_GAP) + CARD_W / 2;
            const prevN     = prevItems.length;

            if (prevN === 1) {
              // Divergence depuis un seul point
              const prevCy = top + prevItems[0].subY + CARD_H / 2;
              const mpx    = prevCx + (cx - prevCx) * 0.5;
              svgLines += `<path d="M${prevCx} ${prevCy} C${mpx} ${prevCy} ${mpx} ${branchCy} ${cx} ${branchCy}"
                fill="none" stroke="${color}" stroke-width="1.5" opacity=".35"/>`;
            } else {
              // Split-à-split : chaque branche relie son homologue si possible, sinon la 1ère
              const prevMatch = prevItems.find(p => p.subRow === ci2.subRow) || prevItems[0];
              const prevCy    = top + prevMatch.subY + CARD_H / 2;
              const mpx       = prevCx + (cx - prevCx) * 0.5;
              svgLines += `<path d="M${prevCx} ${prevCy} C${mpx} ${prevCy} ${mpx} ${branchCy} ${cx} ${branchCy}"
                fill="none" stroke="${color}" stroke-width="1.5" opacity=".35"/>`;
            }
          }
        });
      }
    }
  });

  // Flèches inter-axes (Bézier cubique)
  items.forEach(item => {
    if (!item.liens?.length) return;
    const from = posMap[item.id]; if (!from) return;
    item.liens.forEach(tid => {
      const to = posMap[tid]; if (!to) return;
      const { cx: x1, cy: y1 } = from, { cx: x2, cy: y2 } = to;
      const markId = `arr-${item.id.slice(-4)}-${tid.slice(-4)}`;
      defsHtml.push(`<marker id="${markId}" viewBox="0 0 10 10" refX="8" refY="5"
        markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M2 1L8 5L2 9" fill="none" stroke="rgba(232,184,75,.8)"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>`);
      const cp1x = x1 + (x2 - x1) * .5, cp2x = x2 - (x2 - x1) * .5;
      svgLines += `<path d="M${x1} ${y1} C${cp1x} ${y1} ${cp2x} ${y2} ${x2} ${y2}"
        fill="none" stroke="rgba(232,184,75,.45)" stroke-width="1.5" stroke-dasharray="6 3"
        marker-end="url(#${markId})"/>`;
    });
  });

  let html = `<svg style="position:absolute;top:0;left:0;overflow:visible;pointer-events:none"
    width="${totalW}" height="${totalH}">
    <defs>${defsHtml.join('')}</defs>${svgLines}
  </svg>`;

  // ── 7. Cards ──────────────────────────────────────────────────────────────
  axeOrder.forEach(key => {
    const color  = key === '__none__' ? '#555' : (_axeMap[key] || '#555');
    const layout = axeLayout[key];
    const top    = axeTop[key];

    if (key !== '__none__') {
      const midY = top + layout.centerY;
      html += `<div style="position:absolute;left:0;top:${midY - 8}px;
        writing-mode:vertical-rl;transform:rotate(180deg);
        font-size:.6rem;color:${color};opacity:.6;letter-spacing:1px;text-transform:uppercase;white-space:nowrap">${key}</div>`;
    }

    layout.layoutItems.forEach(({ item, col, subY }) => {
      const left   = PAD_L + col * (CARD_W + CARD_GAP);
      const cardTop = top + subY;
      const st     = stCfg(item);
      const hasLiens = item.liens?.length > 0;

      html += `
      <div class="sn" data-id="${item.id}"
        style="position:absolute;left:${left}px;top:${cardTop}px;width:${CARD_W}px"
        onclick="openStoryDetail('${item.id}')">
        <div class="sn-inner" style="background:var(--bg-card);border:1px solid ${st.border};border-radius:12px;overflow:hidden">
          <div style="width:100%;height:88px;background:var(--bg-panel);position:relative;overflow:hidden;flex-shrink:0">
            ${item.imageUrl
              ? `<img src="${item.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" draggable="false">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel))">
                   ${item.type === 'mission' ? '🎯' : '📖'}</div>`
            }
            <div style="position:absolute;top:5px;right:5px;background:rgba(11,17,24,.85);
              border:1px solid ${st.border};border-radius:999px;padding:1px 6px;
              font-size:.6rem;color:${st.color}">${st.icon} ${item.statut || 'En attente'}</div>
            ${hasLiens ? `<div style="position:absolute;top:5px;left:5px;background:rgba(11,17,24,.85);
              border:1px solid rgba(232,184,75,.4);border-radius:999px;padding:1px 6px;
              font-size:.6rem;color:var(--gold)">↝ ${item.liens.length}</div>` : ''}
            <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:${color};opacity:.8"></div>
          </div>
          <div style="padding:.5rem .6rem">
            <div style="font-family:'Cinzel',serif;font-size:.71rem;color:var(--text);line-height:1.3;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.titre || ''}">
              ${item.titre || 'Mission'}
            </div>
            ${item.date ? `<div style="font-size:.6rem;color:var(--text-dim);margin-top:2px">${item.date}</div>` : ''}
          </div>
        </div>
        ${STATE.isAdmin ? `
        <div style="display:flex;gap:3px;margin-top:4px;justify-content:center">
          <button class="btn-icon" style="font-size:.7rem;padding:2px 6px"
            onclick="event.stopPropagation();editStory('${item.id}')">✏️</button>
          <button class="btn-icon" style="font-size:.7rem;padding:2px 6px;color:#ff6b6b"
            onclick="event.stopPropagation();deleteStory('${item.id}')">🗑️</button>
        </div>` : ''}
      </div>`;
    });
  });

  return `<div style="position:relative;width:${totalW}px;height:${totalH}px">${html}</div>`;
}

// ── MODAL DÉTAIL ──────────────────────────────────────────────────────────────
async function openStoryDetail(id) {
  const items=await loadCollection('story');
  const item=items.find(i=>i.id===id); if(!item) return;
  const st=stCfg(item), reussite=parseInt(item.reussite)||0;
  const participants=item.participants||[];
  const barColor=reussite>=80?'#22c38e':reussite>=40?'#e8b84b':'#ff6b6b';
  const liensItems=(item.liens||[]).map(lid=>items.find(i=>i.id===lid)).filter(Boolean);

  openModal('',`
  <div style="margin:-1.2rem -1.2rem 0;position:relative;overflow:hidden;border-radius:12px 12px 0 0">
    ${item.imageUrl
      ?`<img src="${item.imageUrl}" style="width:100%;height:180px;object-fit:cover;display:block">`
      :`<div style="width:100%;height:130px;background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel));
          display:flex;align-items:center;justify-content:center;font-size:4rem">
          ${item.type==='mission'?'🎯':'📖'}</div>`}
    <div style="position:absolute;top:12px;right:12px;background:rgba(11,17,24,.85);
      border:1px solid ${st.border};border-radius:999px;padding:3px 10px;font-size:.72rem;color:${st.color}">
      ${item.type==='mission'?'Mission':'Événement'}
    </div>
  </div>
  <div style="padding:1.2rem 0 0">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.25rem">
      <h2 style="font-family:'Cinzel',serif;font-size:1.2rem;color:var(--text);margin:0;line-height:1.2">${item.titre||'Mission'}</h2>
      ${item.axe?`<span style="font-size:.7rem;color:${_axeMap[item.axe]||'var(--text-dim)'};
        background:var(--bg-elevated);border:1px solid var(--border);border-radius:999px;
        padding:3px 10px;flex-shrink:0;white-space:nowrap">${item.axe}</span>`:''}
    </div>
    ${item.date?`<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:.6rem">📅 ${item.date}${item.acte?` · ${item.acte}`:''}</div>`:''}
    ${item.lieu?`<div style="font-size:.83rem;color:var(--text-muted);margin-bottom:.7rem"><strong style="color:var(--text)">Lieu</strong> : ${item.lieu}</div>`:''}
    ${item.description?`<div style="font-size:.85rem;color:var(--text-muted);line-height:1.7;margin-bottom:1rem">${item.description.replace(/\n/g,'<br>')}</div>`:''}

    <div style="border-top:1px solid var(--border);padding-top:1rem;display:flex;gap:1.5rem;flex-wrap:wrap">
      ${participants.length?`
      <div style="flex:1;min-width:130px">
        <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:.6rem">Participants</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${participants.map(p=>{
            const col = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'][(p.nom||'').charCodeAt(0)%6||0];
            const photoPos = `${50+(p.photoX||0)*50}% ${50+(p.photoY||0)*50}%`;
            return `<div title="${p.nom||''}" style="display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="width:42px;height:42px;border-radius:50%;overflow:hidden;
                border:2px solid ${col};background:${col}18;
                display:flex;align-items:center;justify-content:center">
                ${p.photo
                  ? `<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
                  : p.imageUrl
                    ? `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover">`
                    : `<span style="font-family:'Cinzel',serif;font-weight:700;font-size:.9rem;color:${col}">${(p.nom||p.emoji||'?')[0]?.toUpperCase()}</span>`}
              </div>
              <span style="font-size:.6rem;color:var(--text-dim);max-width:44px;
                text-align:center;overflow:hidden;text-overflow:ellipsis;
                white-space:nowrap">${p.nom||''}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`:''}

      ${item.type==='mission'&&reussite>0?`
      <div style="flex:1;min-width:150px">
        <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:.5rem">Réussite</div>
        <div style="background:var(--bg-elevated);border-radius:999px;height:10px;overflow:hidden;margin-bottom:.4rem">
          <div style="width:${reussite}%;height:100%;background:${barColor};border-radius:999px"></div>
        </div>
        <div style="font-family:'Cinzel',serif;font-size:.9rem;color:${barColor}">${reussite} %</div>
        ${item.notesReussite?`<div style="font-size:.75rem;color:var(--text-muted);margin-top:.4rem;line-height:1.5">
          ${item.notesReussite.split('\n').map(l=>`<div>• ${l}</div>`).join('')}</div>`:''}
      </div>`:''}

      ${item.recompense?`
      <div style="flex:1;min-width:110px">
        <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:.5rem">Récompense</div>
        <div style="font-size:.83rem;color:var(--gold)">${item.recompense}</div>
      </div>`:''}
    </div>

    ${liensItems.length?`
    <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
      <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:.6rem">↝ Mène vers</div>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem">
        ${liensItems.map(l=>`
          <button onclick="closeModal();openStoryDetail('${l.id}')" style="
            background:var(--bg-elevated);border:1px solid rgba(232,184,75,.3);
            border-radius:8px;padding:.35rem .7rem;cursor:pointer;
            font-family:'Cinzel',serif;font-size:.75rem;color:var(--gold);transition:all .15s">
            ↝ ${l.titre||'Mission'}
          </button>`).join('')}
      </div>
    </div>`:''}

    ${STATE.isAdmin?`
    <div style="margin-top:1rem;display:flex;gap:.5rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="closeModal();editStory('${item.id}')">✏️ Modifier</button>
      <button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:rgba(255,107,107,.3)"
        onclick="closeModal();deleteStory('${item.id}')">🗑️</button>
    </div>`:''}
  </div>`);
}

// ── MODAL AJOUT / ÉDITION ─────────────────────────────────────────────────────
async function openStoryModal(item = null) {
  _crop.base64 = null;
  const acteActif = window._storyActe || 'Acte I';
  const allItems  = await loadCollection('story');
  const autresItems = allItems.filter(i => i.id !== item?.id);

  openModal(item?`✏️ Modifier — ${item.titre||'Mission'}`:'📜 Nouvelle mission',`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="form-group">
        <label>Type</label>
        <select class="input-field" id="st-type">
          <option value="mission" ${(item?.type||'mission')==='mission'?'selected':''}>🎯 Mission</option>
          <option value="event"   ${item?.type==='event'  ?'selected':''}>📖 Événement</option>
        </select>
      </div>
      <div class="form-group">
        <label>Acte</label>
        <input class="input-field" id="st-acte" value="${item?.acte||acteActif}" placeholder="Acte I">
      </div>
    </div>

    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="st-titre" value="${item?.titre||''}" placeholder="Sauver les poules !">
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="form-group">
        <label>Axe narratif</label>
        <input class="input-field" id="st-axe" value="${item?.axe||''}" placeholder="ex: Mystères de Granlac">
      </div>
      <div class="form-group">
        <label>Date / Session</label>
        <input class="input-field" id="st-date" value="${item?.date||''}" placeholder="Session 1">
      </div>
    </div>

    <div class="form-group">
      <label>Lieu</label>
      <input class="input-field" id="st-lieu" value="${item?.lieu||''}" placeholder="Forêt du Cap d'Espérance">
    </div>

    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="st-desc" rows="3">${item?.description||''}</textarea>
    </div>

    <div class="form-group">
      <label>Image (bannière)</label>
      <div id="st-drop-zone" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated);transition:border-color .15s"
        onclick="document.getElementById('st-file').click()"
        ondragover="event.preventDefault();this.style.borderColor='var(--gold)'"
        ondragleave="this.style.borderColor='var(--border-strong)'"
        ondrop="event.preventDefault();this.style.borderColor='var(--border-strong)';window._stFile(event.dataTransfer.files[0])">
        <div id="st-drop-preview">
          ${item?.imageUrl
            ?`<img src="${item.imageUrl}" style="max-height:70px;border-radius:8px;max-width:100%">`
            :`<div style="font-size:1.8rem;margin-bottom:4px">🖼️</div>`}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:4px">
          Glisser ou <span style="color:var(--gold)">cliquer pour choisir</span>
        </div>
      </div>
      <div id="st-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">Recadrez — ratio 4:3 verrouillé</div>
        <canvas id="st-crop-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" style="margin-top:.5rem;width:100%"
          onclick="window._stConfirmCrop()">✂️ Confirmer le recadrage</button>
        <div id="st-crop-ok" style="display:none;font-size:.75rem;color:var(--green);text-align:center;margin-top:4px">✓ Image recadrée</div>
      </div>
    </div>

    <div class="form-group">
      <label>Participants</label>
      <div id="st-participants-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:.5rem;margin-top:.3rem">
        ${(() => {
          const chars = STATE.characters || [];
          if (!chars.length) return `<div style="font-size:.78rem;color:var(--text-dim);
            font-style:italic;grid-column:1/-1">Aucun personnage disponible.</div>`;
          const selected = new Set((item?.participants||[]).map(p=>p.id).filter(Boolean));
          return chars.map(c => {
            const isOn = selected.has(c.id);
            const col  = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'][c.nom?.charCodeAt(0)%6||0];
            const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
            return `<div onclick="window._toggleStParticipant('${c.id}')"
              id="st-part-${c.id}"
              data-part-id="${c.id}"
              data-part-nom="${(c.nom||'?').replace(/"/g,'&quot;')}"
              data-part-photo="${c.photo||''}"
              data-part-photox="${c.photoX||0}"
              data-part-photoy="${c.photoY||0}"
              data-part-photozoom="${c.photoZoom||1}"
              style="display:flex;flex-direction:column;align-items:center;gap:.3rem;
              padding:.5rem .3rem;border-radius:10px;cursor:pointer;transition:all .15s;
              border:2px solid ${isOn?col:'var(--border)'};
              background:${isOn?col+'18':'var(--bg-elevated)'}">
              <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;
                border:2px solid ${isOn?col:'rgba(255,255,255,.1)'};
                background:${col}18;display:flex;align-items:center;justify-content:center;
                flex-shrink:0">
                ${c.photo
                  ? `<img src="${c.photo}" style="width:100%;height:100%;
                      object-fit:cover;object-position:${photoPos}">`
                  : `<span style="font-family:'Cinzel',serif;font-weight:700;
                      font-size:.95rem;color:${col}">${(c.nom||'?')[0].toUpperCase()}</span>`}
              </div>
              <span style="font-size:.65rem;text-align:center;
                color:${isOn?col:'var(--text-dim)'};font-weight:${isOn?'700':'400'};
                line-height:1.2;max-width:72px;overflow:hidden;
                text-overflow:ellipsis;white-space:nowrap">${c.nom||'?'}</span>
              ${isOn?`<div style="width:8px;height:8px;border-radius:50%;
                background:${col};flex-shrink:0"></div>`:''}
            </div>`;
          }).join('');
        })()}
      </div>
    </div>

    <div id="st-mission-extra" style="">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div class="form-group">
          <label>Statut</label>
          <select class="input-field" id="st-statut">
            ${['En cours','Terminée','Échouée','En attente'].map(s=>
              `<option ${s===(item?.statut||'En cours')?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Réussite (%)</label>
          <input type="number" class="input-field" id="st-reussite"
            min="0" max="100" value="${item?.reussite||''}" placeholder="100">
        </div>
      </div>
      <div class="form-group">
        <label>Notes de réussite (une par ligne)</label>
        <textarea class="input-field" id="st-notes-reussite" rows="2"
          placeholder="La mission a été réussie.">${item?.notesReussite||''}</textarea>
      </div>
      <div class="form-group">
        <label>Récompense</label>
        <input class="input-field" id="st-recompense" value="${item?.recompense||''}" placeholder="500 or">
      </div>
    </div>

    ${autresItems.length?`
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:.5rem">
        ↝ Mène vers
        <span style="font-size:.72rem;color:var(--text-dim);font-weight:400">— missions débloquées après celle-ci</span>
      </label>
      <div id="st-liens-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:.5rem;margin-top:.4rem">
        ${autresItems.map(other => {
          const checked=(item?.liens||[]).includes(other.id);
          const axeCol=other.axe?(_axeMap[other.axe]||'var(--text-dim)'):'var(--text-dim)';
          const stOther=stCfg(other);
          return `
          <div id="lien-card-${other.id}"
            onclick="window._toggleLien('${other.id}')"
            style="position:relative;cursor:pointer;border-radius:10px;overflow:hidden;
              border:2px solid ${checked?'var(--gold)':'var(--border)'};
              background:${checked?'rgba(232,184,75,.08)':'var(--bg-elevated)'};
              transition:all .15s;user-select:none;">
            <div style="height:52px;background:var(--bg-panel);overflow:hidden;position:relative">
              ${other.imageUrl
                ?`<img src="${other.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block">`
                :`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.2rem">${other.type==='mission'?'🎯':'📖'}</div>`
              }
              <div id="lien-tick-${other.id}" style="
                position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;
                background:${checked?'var(--gold)':'rgba(11,17,24,.75)'};
                border:1.5px solid ${checked?'var(--gold)':'rgba(255,255,255,.2)'};
                display:flex;align-items:center;justify-content:center;
                font-size:.65rem;color:#0b1118;font-weight:700;transition:all .15s;">
                ${checked?'✓':''}
              </div>
              <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:${axeCol};opacity:.8"></div>
            </div>
            <div style="padding:.35rem .45rem">
              <div style="font-family:'Cinzel',serif;font-size:.65rem;color:var(--text);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3"
                title="${other.titre||''}">${other.titre||'Mission'}</div>
              ${other.axe?`<div style="font-size:.6rem;color:${axeCol};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${other.axe}</div>`:''}
              <div style="font-size:.58rem;color:${stOther.color};margin-top:1px">${stOther.icon} ${other.statut||'En attente'}</div>
            </div>
            <input type="checkbox" id="lien-${other.id}" ${checked?'checked':''} style="display:none">
          </div>`;
        }).join('')}
      </div>
    </div>`:``}

    <div class="form-group">
      <label>Ordre d'affichage</label>
      <input type="number" class="input-field" id="st-ordre" value="${item?.ordre||0}">
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:.5rem"
      onclick="saveStory('${item?.id||''}')">
      ${item?'Enregistrer':'Créer'}
    </button>
  `);

  // Toggle participant dans la grille
  window._toggleStParticipant = (charId) => {
    const el  = document.getElementById(`st-part-${charId}`);
    if (!el) return;
    const col = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'][
      (el.dataset.partNom||'').charCodeAt(0) % 6];
    const isOn = el.dataset.selected === '1';
    el.dataset.selected = isOn ? '0' : '1';
    el.style.borderColor  = !isOn ? col : 'var(--border)';
    el.style.background   = !isOn ? col+'18' : 'var(--bg-elevated)';
    // Mettre à jour le point indicateur et la couleur du nom
    const nameEl = el.querySelector('span');
    const dotEl  = el.querySelector('[style*="border-radius:50%;background"]');
    if (nameEl) { nameEl.style.color = !isOn ? col : 'var(--text-dim)'; nameEl.style.fontWeight = !isOn ? '700' : '400'; }
    if (!isOn && !dotEl) {
      const dot = document.createElement('div');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0`;
      el.appendChild(dot);
    } else if (isOn && dotEl) dotEl.remove();
  };

  // Initialiser data-selected depuis les participants existants
  (item?.participants||[]).forEach(p => {
    if (!p.id) return;
    const el = document.getElementById(`st-part-${p.id}`);
    if (el) el.dataset.selected = '1';
  });

  // ── Input file créé en JS (évite l'orphelin DOM via innerHTML) ────────────
  const stFileInput = document.createElement('input');
  stFileInput.type   = 'file';
  stFileInput.id     = 'st-file';
  stFileInput.accept = 'image/*';
  stFileInput.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none';
  document.body.appendChild(stFileInput);

  const handleStFile = (file) => {
    if(!file?.type.startsWith('image/')) return;
    if(file.size>5*1024*1024){ showNotif('Image trop lourde (max 5 Mo).','error'); return; }
    const r=new FileReader();
    r.onload=(e)=>_initStCrop(e.target.result);
    r.readAsDataURL(file);
  };

  stFileInput.addEventListener('change', () => handleStFile(stFileInput.files[0]));
  window._stFile = handleStFile;

  // Rebind drop zone avec event listeners natifs
  const stDropZone = document.getElementById('st-drop-zone');
  if (stDropZone) {
    stDropZone.onclick     = () => stFileInput.click();
    stDropZone.ondragover  = (e) => { e.preventDefault(); stDropZone.style.borderColor = 'var(--gold)'; };
    stDropZone.ondragleave = ()  => { stDropZone.style.borderColor = 'var(--border-strong)'; };
    stDropZone.ondrop      = (e) => { e.preventDefault(); stDropZone.style.borderColor = 'var(--border-strong)'; handleStFile(e.dataTransfer.files[0]); };
  }

  // Nettoyer quand le modal se ferme
  const stObs = new MutationObserver(() => {
    if (!document.getElementById('st-drop-zone')) { stFileInput.remove(); stObs.disconnect(); }
  });
  stObs.observe(document.body, { childList: true, subtree: true });

  // Toggle visuel d'une card lien
  window._toggleLien = (id) => {
    const cb   = document.getElementById(`lien-${id}`);
    const card = document.getElementById(`lien-card-${id}`);
    const tick = document.getElementById(`lien-tick-${id}`);
    if (!cb || !card || !tick) return;
    cb.checked = !cb.checked;
    const on = cb.checked;
    card.style.borderColor = on ? 'var(--gold)' : 'var(--border)';
    card.style.background  = on ? 'rgba(232,184,75,.08)' : 'var(--bg-elevated)';
    tick.style.background  = on ? 'var(--gold)' : 'rgba(11,17,24,.75)';
    tick.style.borderColor = on ? 'var(--gold)' : 'rgba(255,255,255,.2)';
    tick.textContent       = on ? '✓' : '';
  };
}

// ── CROPPER ───────────────────────────────────────────────────────────────────
function _initStCrop(dataUrl) {
  const wrap=document.getElementById('st-crop-wrap');
  const canvas=document.getElementById('st-crop-canvas');
  const prev=document.getElementById('st-drop-preview');
  if(!wrap||!canvas) return;
  _crop.base64=null;
  document.getElementById('st-crop-ok').style.display='none';
  wrap.style.display='block';
  const img=new Image();
  img.onload=()=>{
    _crop.img=img; _crop.natW=img.naturalWidth; _crop.natH=img.naturalHeight;
    const maxW=Math.min(400,img.naturalWidth);
    _crop.dispScale=maxW/img.naturalWidth;
    canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
    canvas.style.width=maxW+'px';
    canvas.style.height=Math.round(img.naturalHeight*_crop.dispScale)+'px';
    const R=4/3; let w=img.naturalWidth*.8,h=w/R;
    if(h>img.naturalHeight*.8){h=img.naturalHeight*.8;w=h*R;}
    _crop.cropX=Math.round((img.naturalWidth-w)/2); _crop.cropY=Math.round((img.naturalHeight-h)/2);
    _crop.cropW=Math.round(w); _crop.cropH=Math.round(h);
    _drawStCrop(); _bindStCrop(canvas);
    if(prev) prev.innerHTML=`<img src="${dataUrl}" style="max-height:50px;border-radius:6px;opacity:.6">
      <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px">Recadrez ci-dessous</div>`;
  };
  img.src=dataUrl;
}

function _stHandles(){const{cropX:x,cropY:y,cropW:w,cropH:h}=_crop;return[{id:'nw',x,y},{id:'n',x:x+w/2,y},{id:'ne',x:x+w,y},{id:'w',x,y:y+h/2},{id:'e',x:x+w,y:y+h/2},{id:'sw',x,y:y+h},{id:'s',x:x+w/2,y:y+h},{id:'se',x:x+w,y:y+h}];}
function _stHitH(nx,ny){const tol=9/_crop.dispScale;return _stHandles().find(h=>Math.abs(h.x-nx)<tol&&Math.abs(h.y-ny)<tol)||null;}
function _drawStCrop(){
  const canvas=document.getElementById('st-crop-canvas');if(!canvas||!_crop.img)return;
  const ctx=canvas.getContext('2d'),{img,natW,natH,cropX,cropY,cropW,cropH}=_crop;
  ctx.clearRect(0,0,natW,natH);ctx.drawImage(img,0,0,natW,natH);
  ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(0,0,natW,natH);
  ctx.drawImage(img,cropX,cropY,cropW,cropH,cropX,cropY,cropW,cropH);
  ctx.strokeStyle='#e8b84b';ctx.lineWidth=2;ctx.strokeRect(cropX,cropY,cropW,cropH);
  ctx.strokeStyle='rgba(232,184,75,.3)';ctx.lineWidth=1;
  for(let i=1;i<=2;i++){
    ctx.beginPath();ctx.moveTo(cropX+cropW*i/3,cropY);ctx.lineTo(cropX+cropW*i/3,cropY+cropH);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cropX,cropY+cropH*i/3);ctx.lineTo(cropX+cropW,cropY+cropH*i/3);ctx.stroke();
  }
  ctx.fillStyle='#e8b84b';ctx.strokeStyle='#0b1118';ctx.lineWidth=1.5;
  _stHandles().forEach(h=>{ctx.fillRect(h.x-6,h.y-6,12,12);ctx.strokeRect(h.x-6,h.y-6,12,12);});
  ctx.fillStyle='rgba(232,184,75,.9)';ctx.font='12px monospace';
  ctx.fillText(`${cropW} × ${cropH}`,cropX+6,cropY+18);
}
function _stToN(c,cx,cy){const r=c.getBoundingClientRect();return{x:(cx-r.left)/_crop.dispScale,y:(cy-r.top)/_crop.dispScale};}
function _bindStCrop(canvas){
  const R=4/3,MIN=40;
  const onStart=(cx,cy)=>{
    const{x,y}=_stToN(canvas,cx,cy),h=_stHitH(x,y);
    if(h){_crop.isResizing=true;_crop.handle=h.id;}
    else{const{cropX,cropY,cropW,cropH}=_crop;
      if(x>=cropX&&x<=cropX+cropW&&y>=cropY&&y<=cropY+cropH)
        {_crop.isDragging=true;_crop.startX=x-cropX;_crop.startY=y-cropY;}}
  };
  const onMove=(cx,cy)=>{
    if(!_crop.isDragging&&!_crop.isResizing)return;
    const{x,y}=_stToN(canvas,cx,cy),{natW:W,natH:H}=_crop;
    if(_crop.isDragging){
      _crop.cropX=Math.round(_clamp(x-_crop.startX,0,W-_crop.cropW));
      _crop.cropY=Math.round(_clamp(y-_crop.startY,0,H-_crop.cropH));
      _drawStCrop();return;
    }
    let{cropX,cropY,cropW,cropH,handle}=_crop;
    const a={x:cropX,y:cropY,x2:cropX+cropW,y2:cropY+cropH};
    if(handle==='se'){cropW=_clamp(x-a.x,MIN,W-a.x);cropH=Math.round(cropW/R);}
    else if(handle==='sw'){cropW=_clamp(a.x2-x,MIN,a.x2);cropH=Math.round(cropW/R);cropX=a.x2-cropW;}
    else if(handle==='ne'){cropW=_clamp(x-a.x,MIN,W-a.x);cropH=Math.round(cropW/R);cropY=a.y2-cropH;}
    else if(handle==='nw'){cropW=_clamp(a.x2-x,MIN,a.x2);cropH=Math.round(cropW/R);cropX=a.x2-cropW;cropY=a.y2-cropH;}
    else if(handle==='e'){cropW=_clamp(x-a.x,MIN,W-a.x);cropH=Math.round(cropW/R);}
    else if(handle==='w'){cropW=_clamp(a.x2-x,MIN,a.x2);cropH=Math.round(cropW/R);cropX=a.x2-cropW;}
    else if(handle==='s'){cropH=_clamp(y-a.y,MIN,H-a.y);cropW=Math.round(cropH*R);}
    else if(handle==='n'){cropH=_clamp(a.y2-y,MIN,a.y2);cropW=Math.round(cropH*R);cropY=a.y2-cropH;}
    _crop.cropX=Math.round(_clamp(cropX,0,W-MIN));_crop.cropY=Math.round(_clamp(cropY,0,H-MIN));
    _crop.cropW=Math.round(_clamp(cropW,MIN,W-_crop.cropX));_crop.cropH=Math.round(_clamp(cropH,MIN,H-_crop.cropY));
    _drawStCrop();
  };
  const onEnd=()=>{_crop.isDragging=false;_crop.isResizing=false;_crop.handle=null;};
  const CM={nw:'nw-resize',ne:'ne-resize',sw:'sw-resize',se:'se-resize',n:'n-resize',s:'s-resize',e:'e-resize',w:'w-resize'};
  canvas.addEventListener('mousemove',e=>{
    if(_crop.isDragging||_crop.isResizing)return;
    const{x,y}=_stToN(canvas,e.clientX,e.clientY),h=_stHitH(x,y);
    if(h){canvas.style.cursor=CM[h.id];return;}
    const{cropX,cropY,cropW,cropH}=_crop;
    canvas.style.cursor=(x>=cropX&&x<=cropX+cropW&&y>=cropY&&y<=cropY+cropH)?'move':'crosshair';
  });
  canvas.addEventListener('mousedown',e=>{e.preventDefault();onStart(e.clientX,e.clientY);});
  window.addEventListener('mousemove',e=>onMove(e.clientX,e.clientY));
  window.addEventListener('mouseup',onEnd);
  canvas.addEventListener('touchstart',e=>{e.preventDefault();onStart(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();onMove(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  canvas.addEventListener('touchend',onEnd);
}

window._stConfirmCrop = () => {
  const{img,cropX,cropY,cropW,cropH}=_crop;if(!img)return;
  const OUT_W=Math.min(800,cropW),OUT_H=Math.round(OUT_W/(4/3));
  const out=document.createElement('canvas');out.width=OUT_W;out.height=OUT_H;
  out.getContext('2d').drawImage(img,cropX,cropY,cropW,cropH,0,0,OUT_W,OUT_H);
  _crop.base64=out.toDataURL('image/jpeg',.88);
  document.getElementById('st-crop-ok').style.display='block';
  document.getElementById('st-crop-wrap').style.display='none';
  const p=document.getElementById('st-drop-preview');
  if(p) p.innerHTML=`<img src="${_crop.base64}" style="max-height:70px;border-radius:8px">`;
};

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveStory(id = '') {
  const titre=document.getElementById('st-titre')?.value?.trim();
  if(!titre){showNotif('Le titre est requis.','error');return;}

  // Image : crop prioritaire, sinon existante en base
  let imageUrl='';
  if(_crop.base64){
    imageUrl=_crop.base64;
  } else if(id){
    const existing=(await loadCollection('story')).find(i=>i.id===id);
    imageUrl=existing?.imageUrl||'';
  }

  // Participants depuis la grille de sélection
  const participants = [...document.querySelectorAll('[id^="st-part-"]')]
    .filter(el => el.dataset.selected === '1')
    .map(el => ({
      id:        el.dataset.partId       || '',
      nom:       el.dataset.partNom      || '',
      photo:     el.dataset.partPhoto    || '',
      photoX:    parseFloat(el.dataset.partPhotox)    || 0,
      photoY:    parseFloat(el.dataset.partPhotoy)    || 0,
      photoZoom: parseFloat(el.dataset.partPhotozoom) || 1,
    }));

  const allCb=document.querySelectorAll('[id^="lien-"]');
  const liens=[...allCb].filter(cb=>cb.checked).map(cb=>cb.id.replace('lien-',''));

  const data={
    type:          document.getElementById('st-type')?.value       ||'mission',
    titre,
    acte:          document.getElementById('st-acte')?.value?.trim() ||'Acte I',
    axe:           document.getElementById('st-axe')?.value?.trim()  ||'',
    date:          document.getElementById('st-date')?.value?.trim() ||'',
    lieu:          document.getElementById('st-lieu')?.value?.trim() ||'',
    description:   document.getElementById('st-desc')?.value         ||'',
    imageUrl,
    participants,
    statut:        document.getElementById('st-statut')?.value       ||'En cours',
    reussite:      parseInt(document.getElementById('st-reussite')?.value)||0,
    notesReussite: document.getElementById('st-notes-reussite')?.value?.trim()||'',
    recompense:    document.getElementById('st-recompense')?.value?.trim()||'',
    liens,
    ordre:         parseInt(document.getElementById('st-ordre')?.value)||0,
  };

  // Persister l'acte si nouveau
  const savedActes=await loadActes();
  if(!savedActes.includes(data.acte)){ savedActes.push(data.acte); savedActes.sort(); await saveActes(savedActes); }

  if(id) await updateInCol('story',id,data);
  else   await addToCol('story',data);

  window._storyActe=data.acte;
  _crop.base64=null;
  closeModal();
  showNotif(id?'Mission mise à jour.':`"${titre}" ajoutée !`,'success');
  await PAGES.story();
}

// ── ÉDITER / SUPPRIMER ────────────────────────────────────────────────────────
async function editStory(id){
  const items=await loadCollection('story');
  const item=items.find(i=>i.id===id);
  if(item) openStoryModal(item);
}
async function deleteStory(id){
  if(!confirm('Supprimer cet élément de la trame ?'))return;
  await deleteFromCol('story',id);
  showNotif('Élément supprimé.','success');
  await PAGES.story();
}

// ── NOUVEL ACTE ───────────────────────────────────────────────────────────────
function openNewActeModal(){
  openModal('+ Nouvel Acte',`
    <div class="form-group">
      <label>Nom de l'acte</label>
      <input class="input-field" id="new-acte-name" placeholder="Acte II">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem"
      onclick="window._createNewActe()">Créer</button>
  `);
}
window._createNewActe = async () => {
  const name=document.getElementById('new-acte-name')?.value?.trim();if(!name)return;
  const list=await loadActes();
  if(!list.includes(name)){list.push(name);list.sort();await saveActes(list);}
  window._storyActe=name;
  closeModal();
  await PAGES.story();
};

// ── OVERRIDE + EXPORTS ────────────────────────────────────────────────────────
PAGES.story = renderStory;
Object.assign(window,{openStoryModal,openStoryDetail,openNewActeModal,saveStory,editStory,deleteStory});
