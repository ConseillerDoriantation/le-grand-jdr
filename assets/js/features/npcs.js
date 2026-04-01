// ══════════════════════════════════════════════════════════════════════════════
// NPCS.JS — PNJ & Affinités
// ✓ Fiches PNJ complètes (nom, rôle, lieu, description, image)
// ✓ Affinité groupe   : jauge 5 niveaux + note + historique — MJ gère, tous lisent
// ✓ Affinité perso    : exceptions individuelles par PJ (MJ → joueur concerné)
// ✓ Firestore :
//     npcs/{id}                         → fiche PNJ + affinité groupe
//     npc_affinites/{npcId_charId}      → affinité individuelle
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── Config affinité ───────────────────────────────────────────────────────────
const AFFINITE = [
  { niveau: 0, label: 'Hostile',  couleur: '#ff4757', bg: 'rgba(255,71,87,.12)',   border: 'rgba(255,71,87,.3)',   icon: '💢', desc: 'Cherche activement à nuire au groupe' },
  { niveau: 1, label: 'Méfiant',  couleur: '#ff9f43', bg: 'rgba(255,159,67,.1)',   border: 'rgba(255,159,67,.28)', icon: '👁️', desc: 'Prudent, peu coopératif' },
  { niveau: 2, label: 'Neutre',   couleur: '#a0aec0', bg: 'rgba(160,174,192,.08)', border: 'rgba(160,174,192,.22)',icon: '😐', desc: 'Ni ami ni ennemi' },
  { niveau: 3, label: 'Ami',      couleur: '#4f8cff', bg: 'rgba(79,140,255,.1)',   border: 'rgba(79,140,255,.28)', icon: '🤝', desc: 'Bienveillant, prêt à aider' },
  { niveau: 4, label: 'Allié',    couleur: '#22c38e', bg: 'rgba(34,195,142,.1)',   border: 'rgba(34,195,142,.28)', icon: '⚔️', desc: 'Loyal, combattra aux côtés du groupe' },
];

const afx = (n) => AFFINITE[Math.max(0, Math.min(4, n ?? 2))];

// ── État local ────────────────────────────────────────────────────────────────
let _npcs         = [];
let _affiPerso    = [];   // [{id, npcId, charId, charNom, niveau, note}]
let _activeId     = null;
let _filterDisp   = null;
let _filterSearch = '';

// ── Chargement ────────────────────────────────────────────────────────────────
async function _load() {
  const [npcs, affi] = await Promise.all([
    loadCollection('npcs'),
    loadCollection('npc_affinites'),
  ]);
  _npcs      = npcs  || [];
  _affiPerso = affi  || [];
}

// ── Rendu principal ───────────────────────────────────────────────────────────
async function renderNpcs() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)">
    <div style="font-size:1.5rem">⏳</div><p>Chargement…</p></div>`;

  await _load();
  if (!_activeId && _npcs.length) _activeId = _npcs[0].id;

  _renderPage(content);
}

function _renderPage(content) {
  const filtered = _getFiltered();
  const active   = _npcs.find(n => n.id === _activeId) || filtered[0] || null;

  // Dispositions disponibles pour le filtre
  const disps = [...new Set(_npcs.map(n => n.disposition).filter(Boolean))];

  content.innerHTML = `
  <div style="display:grid;grid-template-columns:280px 1fr;gap:1rem;
    align-items:start;max-width:1200px;margin:0 auto">

    <!-- ═══ SIDEBAR ══════════════════════════════════════════════════════ -->
    <div style="position:sticky;top:1rem;display:flex;flex-direction:column;gap:.6rem">

      <!-- Header -->
      <div style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:var(--radius-lg);padding:.9rem 1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:.65rem">
          <div>
            <div style="font-family:'Cinzel',serif;font-size:.9rem;color:var(--gold)">
              👥 PNJ</div>
            <div style="font-size:.68rem;color:var(--text-dim);margin-top:1px">
              ${_npcs.length} personnage${_npcs.length>1?'s':''}</div>
          </div>
          ${STATE.isAdmin ? `
          <button onclick="openNpcModal()"
            style="width:30px;height:30px;border-radius:8px;border:1px solid rgba(232,184,75,.3);
            background:rgba(232,184,75,.08);color:var(--gold);cursor:pointer;font-size:1.1rem;
            display:flex;align-items:center;justify-content:center">+</button>` : ''}
        </div>

        <!-- Recherche -->
        <input id="npc-search" class="input-field" placeholder="🔍 Rechercher…"
          value="${_filterSearch}"
          oninput="window._npcSearch(this.value)"
          style="font-size:.8rem;padding:.4rem .6rem;margin-bottom:.5rem">

        <!-- Filtres disposition -->
        <div style="display:flex;flex-wrap:wrap;gap:.3rem">
          <button onclick="window._npcFilter(null)"
            style="${!_filterDisp?'background:rgba(232,184,75,.15);border-color:var(--gold);color:var(--gold)':'background:transparent;border-color:var(--border);color:var(--text-dim)'}
            ;border:1px solid;border-radius:999px;padding:2px 9px;cursor:pointer;font-size:.68rem;transition:all .12s">
            Tous
          </button>
          ${disps.map(d => {
            const cfg = _dispCfg(d);
            const active = _filterDisp === d;
            return `<button onclick="window._npcFilter('${d}')"
              style="border:1px solid ${active?cfg.color:'var(--border)'};border-radius:999px;
              padding:2px 9px;cursor:pointer;font-size:.68rem;
              background:${active?cfg.color+'20':'transparent'};
              color:${active?cfg.color:'var(--text-dim)'};transition:all .12s">${d}</button>`;
          }).join('')}
        </div>
      </div>

      <!-- Liste PNJ -->
      <div style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:var(--radius-lg);overflow:hidden;max-height:calc(100vh - 280px);
        overflow-y:auto">
        ${filtered.length === 0
          ? `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);
              font-size:.8rem;font-style:italic">Aucun PNJ trouvé</div>`
          : filtered.map(n => _renderNavItem(n)).join('')}
      </div>
    </div>

    <!-- ═══ FICHE PRINCIPALE ══════════════════════════════════════════════ -->
    <div id="npc-detail-panel">
      ${active ? _renderFiche(active) : _renderEmpty()}
    </div>
  </div>`;
}

// ── Nav item PNJ ─────────────────────────────────────────────────────────────
function _renderNavItem(n) {
  const isActive = n.id === _activeId;
  const af       = afx(n.affinite?.niveau ?? 2);
  return `<div onclick="window.selectNpc('${n.id}')" data-npc-id="${n.id}"
    style="display:flex;align-items:center;gap:.6rem;padding:.55rem .85rem;
    cursor:pointer;transition:all .1s;
    background:${isActive?'rgba(232,184,75,.07)':'transparent'};
    border-left:3px solid ${isActive?'var(--gold)':'transparent'}"
    onmouseover="if(!this.style.background.includes('184'))this.style.background='rgba(255,255,255,.03)'"
    onmouseout="if(!this.style.background.includes('184'))this.style.background='transparent'">

    <!-- Portrait circulaire coloré par l'affinité -->
    <div style="width:38px;height:38px;border-radius:50%;flex-shrink:0;overflow:hidden;
      background:linear-gradient(135deg,${af.couleur}22,${af.couleur}08);
      border:2px solid ${isActive?'var(--gold)':af.border};
      display:flex;align-items:center;justify-content:center;transition:border-color .1s">
      ${n.imageUrl
        ? `<img src="${n.imageUrl}" style="width:100%;height:100%;object-fit:cover;object-position:top">`
        : `<span style="font-family:'Cinzel',serif;font-weight:700;
            font-size:.95rem;color:${af.couleur}">${(n.nom||'?')[0].toUpperCase()}</span>`}
    </div>

    <div style="flex:1;min-width:0">
      <div style="font-size:.84rem;font-weight:${isActive?'700':'500'};
        color:${isActive?'var(--gold)':'var(--text)'};
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.nom||'?'}</div>
      <div style="display:flex;align-items:center;gap:.4rem;margin-top:2px">
        <div style="display:flex;gap:2px">
          ${AFFINITE.map((a,i) => `<div style="width:6px;height:6px;border-radius:50%;
            background:${i<=(n.affinite?.niveau??2)?a.couleur:'rgba(255,255,255,.08)'}"></div>`).join('')}
        </div>
        <span style="font-size:.65rem;color:${af.couleur}">${af.label}</span>
      </div>
    </div>
  </div>`;
}

// ── Fiche PNJ détaillée ───────────────────────────────────────────────────────
function _renderFiche(n) {
  const af       = afx(n.affinite?.niveau ?? 2);
  const niv      = n.affinite?.niveau ?? 2;
  const histo    = n.affinite?.historique || [];
  const dispCfg  = _dispCfg(n.disposition);
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars   = (STATE.characters || []).filter(c => c.uid === STATE.user?.uid);
  const myAffi    = persoList.filter(a => myChars.some(c => c.id === a.charId));

  // Affinités perso groupées pour affichage simplifié
  const apprecies    = persoList.filter(a => a.niveau > niv).map(a => a.charNom).filter(Boolean);
  const nAppreciePas = persoList.filter(a => a.niveau < niv).map(a => a.charNom).filter(Boolean);

  // Jauge premium — inspirée du screenshot, avec labels et indicateur animé
  const jauge = AFFINITE.map((a, i) => {
    const filled    = i < niv;
    const isCurrent = i === niv;
    return `<div style="flex:1;position:relative">
      <div style="height:18px;border-radius:${i===0?'999px 0 0 999px':i===4?'0 999px 999px 0':'0'};
        background:${isCurrent ? a.couleur : filled ? a.couleur+'88' : 'rgba(255,255,255,.06)'};
        border:1px solid ${isCurrent ? a.couleur : filled ? a.couleur+'44' : 'rgba(255,255,255,.08)'};
        transition:all .3s;position:relative;overflow:${isCurrent?'visible':'hidden'}">
        ${isCurrent ? `
        <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);
          width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;
          border-top:7px solid ${a.couleur};filter:drop-shadow(0 0 4px ${a.couleur}99)"></div>
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);
          animation:shimmer 2s infinite"></div>` : ''}
      </div>
      <div style="text-align:center;font-size:.58rem;color:${isCurrent?a.couleur:'var(--text-dim)'};
        font-weight:${isCurrent?'700':'400'};margin-top:4px;letter-spacing:.3px">${a.label}</div>
    </div>`;
  }).join('');

  return `
  <style>
    @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
  </style>

  <!-- ═══ LAYOUT PRINCIPAL : image gauche + info droite ════════════════ -->
  <div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);overflow:hidden;
    display:grid;grid-template-columns:${n.imageUrl?'260px 1fr':'1fr'};min-height:320px">

    <!-- ── Portrait illustration ──────────────────────────────────────── -->
    ${n.imageUrl ? `
    <div style="position:relative;overflow:hidden;background:linear-gradient(135deg,
      ${af.couleur}18 0%,var(--bg-panel) 100%)">
      <img src="${n.imageUrl}"
        style="width:100%;height:100%;object-fit:cover;object-position:top center;
        display:block;min-height:320px">
      <!-- Dégradé de fondu vers la droite -->
      <div style="position:absolute;inset:0;background:linear-gradient(to right,
        transparent 55%,var(--bg-card) 100%)"></div>
      <!-- Dégradé de fondu en bas -->
      <div style="position:absolute;bottom:0;left:0;right:0;height:40%;
        background:linear-gradient(to top,var(--bg-card),transparent)"></div>
    </div>` : ''}

    <!-- ── Infos + Affinité ────────────────────────────────────────────── -->
    <div style="padding:1.4rem 1.6rem;display:flex;flex-direction:column;gap:1.1rem;
      ${n.imageUrl?'margin-left:-2rem;position:relative;z-index:1':''}">

      <!-- Nom + méta -->
      <div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem">
          <div>
            <h2 style="font-family:'Cinzel',serif;font-size:1.35rem;color:var(--text);
              margin:0 0 .3rem;letter-spacing:.5px;line-height:1.2">${n.nom||'?'}</h2>
            <div style="font-size:.82rem;color:var(--text-muted);font-style:italic;
              margin-bottom:.5rem">${n.role||''}</div>
            <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
              ${n.disposition ? `<span style="font-size:.7rem;padding:2px 9px;border-radius:999px;
                background:${dispCfg.bg};color:${dispCfg.color};
                border:1px solid ${dispCfg.border};font-weight:600">${n.disposition}</span>` : ''}
              ${n.lieu ? `<span style="font-size:.72rem;color:var(--text-dim)">📍 ${n.lieu}</span>` : ''}
            </div>
          </div>
          ${STATE.isAdmin ? `
          <div style="display:flex;gap:.3rem;flex-shrink:0">
            <button onclick="openNpcModal('${n.id}')"
              style="background:rgba(255,255,255,.06);border:1px solid var(--border);
              border-radius:8px;padding:4px 10px;cursor:pointer;font-size:.72rem;
              color:var(--text-dim);transition:all .12s"
              onmouseover="this.style.background='rgba(255,255,255,.1)'"
              onmouseout="this.style.background='rgba(255,255,255,.06)'">✏️ Modifier</button>
            <button onclick="deleteNpc('${n.id}')"
              style="background:transparent;border:1px solid rgba(255,107,107,.25);
              border-radius:8px;padding:4px 8px;cursor:pointer;font-size:.75rem;color:#ff6b6b">🗑️</button>
          </div>` : ''}
        </div>

        ${n.description ? `
        <div style="margin-top:.65rem;font-size:.83rem;color:var(--text-muted);
          line-height:1.75;padding:.75rem;background:rgba(255,255,255,.02);
          border-radius:8px;border-left:2px solid ${af.couleur}44">${n.description}</div>` : ''}
      </div>

      <!-- ── JAUGE D'AFFINITÉ ──────────────────────────────────────────── -->
      <div style="background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:12px;padding:1rem 1.1rem">

        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:.85rem">
          <div style="font-size:.72rem;font-weight:700;color:var(--text-dim);
            letter-spacing:1.5px;text-transform:uppercase">Affinité du groupe</div>
          ${STATE.isAdmin ? `
          <button onclick="openAffiniteGroupeModal('${n.id}')"
            style="font-size:.7rem;background:rgba(232,184,75,.08);
            border:1px solid rgba(232,184,75,.25);border-radius:6px;
            padding:2px 9px;cursor:pointer;color:var(--gold);transition:all .12s">
            ⚙️ Modifier</button>` : ''}
        </div>

        <!-- Jauge colorée avec labels -->
        <div style="display:flex;gap:3px;margin-bottom:8px">${jauge}</div>

        <!-- Niveau actuel en clair -->
        <div style="display:flex;align-items:center;gap:.65rem;
          padding:.5rem .75rem;background:${af.bg};border:1px solid ${af.border};
          border-radius:8px">
          <span style="font-size:1.1rem">${af.icon}</span>
          <div style="flex:1">
            <span style="font-size:.88rem;font-weight:700;color:${af.couleur}">${af.label}</span>
            <span style="font-size:.74rem;color:var(--text-dim);margin-left:.4rem">— ${af.desc}</span>
          </div>
        </div>

        <!-- Note courte -->
        ${n.affinite?.note ? `
        <div style="margin-top:.6rem;font-size:.78rem;color:var(--text-muted);
          font-style:italic;padding:.45rem .65rem;
          border-left:2px solid ${af.couleur}55;line-height:1.6">
          « ${n.affinite.note} »
        </div>` : ''}
      </div>

      <!-- ── RELATIONS SPÉCIALES ───────────────────────────────────────── -->
      ${(apprecies.length || nAppreciePas.length || (STATE.isAdmin && persoList.length > 0)) ? `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:12px;padding:.9rem 1.1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:.7rem">
          <div style="font-size:.72rem;font-weight:700;color:var(--text-dim);
            letter-spacing:1.5px;text-transform:uppercase">Relations spéciales</div>
          ${STATE.isAdmin ? `
          <button onclick="openAffinitePersoModal('${n.id}')"
            style="font-size:.7rem;background:rgba(79,140,255,.08);
            border:1px solid rgba(79,140,255,.25);border-radius:6px;
            padding:2px 9px;cursor:pointer;color:#4f8cff">+ Ajouter</button>` : ''}
        </div>

        ${STATE.isAdmin ? `
        <!-- Vue admin : liste complète avec badges -->
        <div style="display:flex;flex-direction:column;gap:.4rem">
          ${persoList.map(a => {
            const aa = afx(a.niveau ?? 2);
            return `<div style="display:flex;align-items:center;gap:.6rem;
              padding:.4rem .65rem;background:${aa.bg};border:1px solid ${aa.border};
              border-radius:8px">
              <span style="font-size:.85rem">${aa.icon}</span>
              <div style="flex:1;min-width:0">
                <span style="font-size:.8rem;font-weight:600;color:${aa.couleur}">${aa.label}</span>
                <span style="font-size:.75rem;color:var(--text-dim);margin-left:.3rem">→ ${a.charNom||'?'}</span>
                ${a.note ? `<div style="font-size:.72rem;color:var(--text-muted);
                  font-style:italic;margin-top:1px">${a.note}</div>` : ''}
              </div>
              <div style="display:flex;gap:.25rem;flex-shrink:0">
                <button onclick="openAffinitePersoModal('${n.id}','${a.id}')"
                  style="background:none;border:none;cursor:pointer;
                  color:var(--text-dim);font-size:.75rem;padding:1px 3px">✏️</button>
                <button onclick="deleteAffinitePerso('${a.id}')"
                  style="background:none;border:none;cursor:pointer;
                  color:#ff6b6b;font-size:.75rem;padding:1px 3px">🗑️</button>
              </div>
            </div>`;
          }).join('')}
        </div>` : `
        <!-- Vue joueur : simplifié, style Genially -->
        <div style="display:flex;flex-direction:column;gap:.3rem;font-size:.82rem">
          ${apprecies.length ? `
          <div style="display:flex;align-items:baseline;gap:.4rem">
            <span style="font-weight:700;color:#22c38e;flex-shrink:0">Apprécie :</span>
            <span style="color:var(--text-muted);font-style:italic">${apprecies.join(', ')}</span>
          </div>` : ''}
          ${nAppreciePas.length ? `
          <div style="display:flex;align-items:baseline;gap:.4rem">
            <span style="font-weight:700;color:#ff6b6b;flex-shrink:0">N'apprécie pas :</span>
            <span style="color:var(--text-muted);font-style:italic">${nAppreciePas.join(', ')}</span>
          </div>` : ''}
        </div>`}
      </div>` : `
      ${STATE.isAdmin ? `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:12px;padding:.75rem 1.1rem;
        display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:.75rem;font-weight:700;color:var(--text-dim);
          letter-spacing:1.5px;text-transform:uppercase">Relations spéciales</span>
        <button onclick="openAffinitePersoModal('${n.id}')"
          style="font-size:.7rem;background:rgba(79,140,255,.08);
          border:1px solid rgba(79,140,255,.25);border-radius:6px;
          padding:2px 9px;cursor:pointer;color:#4f8cff">+ Ajouter</button>
      </div>` : ''}`}

      <!-- ── HISTORIQUE ────────────────────────────────────────────────── -->
      ${histo.length ? `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:12px;padding:.9rem 1.1rem">
        <div style="font-size:.72rem;font-weight:700;color:var(--text-dim);
          letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.65rem">Historique</div>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          ${histo.slice(-5).reverse().map(h => {
            const d = h.delta||0;
            const col = d>0?'#22c38e':d<0?'#ff6b6b':'#a0aec0';
            const bg  = d>0?'rgba(34,195,142,.1)':d<0?'rgba(255,107,107,.1)':'rgba(255,255,255,.04)';
            return `<div style="display:flex;align-items:flex-start;gap:.55rem;
              padding:.4rem .6rem;background:${bg};border-radius:7px">
              <span style="width:22px;height:22px;border-radius:50%;background:${col}20;
                border:1px solid ${col}44;display:flex;align-items:center;
                justify-content:center;font-size:.7rem;font-weight:800;
                color:${col};flex-shrink:0">${d>0?'+'+d:d<0?d:'~'}</span>
              <span style="flex:1;font-size:.77rem;color:var(--text-muted);
                line-height:1.5">${h.texte||''}</span>
              ${h.date?`<span style="font-size:.68rem;color:var(--text-dim);
                flex-shrink:0;white-space:nowrap">${h.date}</span>`:''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Affinité personnelle du joueur connecté -->
      ${!STATE.isAdmin && myAffi.length ? `
      <div style="background:rgba(232,184,75,.06);border:1px solid rgba(232,184,75,.2);
        border-radius:12px;padding:.9rem 1.1rem">
        <div style="font-size:.72rem;font-weight:700;color:var(--gold);
          letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.6rem">
          ✨ Ta relation personnelle</div>
        ${myAffi.map(a => _renderPersoChip(a)).join('')}
      </div>` : ''}

    </div><!-- /infos -->
  </div>`;
}

// ── Bloc affinités individuelles ──────────────────────────────────────────────
function _renderAffinitePerso(n, persoList, myAffi) {
  // Joueur : voit seulement ses propres exceptions
  if (!STATE.isAdmin) {
    if (!myAffi.length) return ''; // Pas d'exception pour ce joueur
    return `<div style="background:var(--bg-card);border:1px solid var(--border);
      border-radius:var(--radius-lg);padding:1.1rem 1.3rem">
      <div style="font-size:.75rem;font-weight:700;color:var(--text-dim);
        letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.75rem">
        Ta relation personnelle</div>
      ${myAffi.map(a => _renderPersoChip(a)).join('')}
    </div>`;
  }

  // Admin : voit tout + peut ajouter/modifier
  return `<div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);padding:1.1rem 1.3rem">
    <div style="display:flex;align-items:center;justify-content:space-between;
      margin-bottom:.75rem">
      <div>
        <div style="font-size:.75rem;font-weight:700;color:var(--text-dim);
          letter-spacing:1.5px;text-transform:uppercase">Relations individuelles</div>
        <div style="font-size:.7rem;color:var(--text-dim);margin-top:2px">
          Exceptions notables — visible uniquement par le PJ concerné</div>
      </div>
      <button onclick="openAffinitePersoModal('${n.id}')"
        class="btn btn-outline btn-sm" style="font-size:.7rem">+ Ajouter</button>
    </div>

    ${persoList.length === 0
      ? `<div style="font-size:.8rem;color:var(--text-dim);font-style:italic;
          text-align:center;padding:.75rem">Aucune exception individuelle</div>`
      : `<div style="display:flex;flex-direction:column;gap:.45rem">
          ${persoList.map(a => _renderPersoChipAdmin(a, n.id)).join('')}
        </div>`}
  </div>`;
}

function _renderPersoChip(a) {
  const af = afx(a.niveau ?? 2);
  return `<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .75rem;
    background:${af.bg};border:1px solid ${af.border};border-radius:10px">
    <span style="font-size:1rem">${af.icon}</span>
    <div style="flex:1">
      <div style="font-size:.83rem;font-weight:600;color:${af.couleur}">${af.label}</div>
      ${a.note ? `<div style="font-size:.74rem;color:var(--text-muted);
        font-style:italic;margin-top:1px">${a.note}</div>` : ''}
    </div>
  </div>`;
}

function _renderPersoChipAdmin(a, npcId) {
  const af = afx(a.niveau ?? 2);
  return `<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .75rem;
    background:${af.bg};border:1px solid ${af.border};border-radius:10px">
    <span style="font-size:1rem">${af.icon}</span>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:.4rem">
        <span style="font-size:.82rem;font-weight:600;color:${af.couleur}">${af.label}</span>
        <span style="font-size:.7rem;color:var(--text-dim)">→ ${a.charNom||'?'}</span>
      </div>
      ${a.note ? `<div style="font-size:.73rem;color:var(--text-muted);
        font-style:italic;margin-top:1px;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis">${a.note}</div>` : ''}
    </div>
    <div style="display:flex;gap:.25rem;flex-shrink:0">
      <button onclick="openAffinitePersoModal('${npcId}','${a.id}')"
        style="background:none;border:none;cursor:pointer;color:var(--text-dim);
        font-size:.75rem;padding:2px 4px">✏️</button>
      <button onclick="deleteAffinitePerso('${a.id}')"
        style="background:none;border:none;cursor:pointer;color:#ff6b6b;
        font-size:.75rem;padding:2px 4px">🗑️</button>
    </div>
  </div>`;
}

function _renderEmpty() {
  return `<div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);padding:4rem 2rem;text-align:center">
    <div style="font-size:3rem;margin-bottom:1rem;opacity:.3">👥</div>
    <p style="color:var(--text-dim);font-style:italic">
      ${STATE.isAdmin ? 'Aucun PNJ. Cliquez sur + pour en créer un.' : 'Aucun PNJ disponible.'}
    </p>
    ${STATE.isAdmin ? `<button onclick="openNpcModal()"
      class="btn btn-gold btn-sm" style="margin-top:1rem">+ Créer le premier PNJ</button>` : ''}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _dispCfg(d) {
  const MAP = {
    'Amical':    { color:'#22c38e', bg:'rgba(34,195,142,.08)',  border:'rgba(34,195,142,.25)' },
    'Allié':     { color:'#4f8cff', bg:'rgba(79,140,255,.08)',  border:'rgba(79,140,255,.25)' },
    'Neutre':    { color:'#a0aec0', bg:'rgba(160,174,192,.07)', border:'rgba(160,174,192,.2)' },
    'Mystérieux':{ color:'#b47fff', bg:'rgba(180,127,255,.08)', border:'rgba(180,127,255,.22)' },
    'Hostile':   { color:'#ff6b6b', bg:'rgba(255,107,107,.08)', border:'rgba(255,107,107,.25)' },
    'Ennemi':    { color:'#ff4757', bg:'rgba(255,71,87,.1)',    border:'rgba(255,71,87,.28)' },
  };
  return MAP[d] || { color:'var(--text-dim)', bg:'rgba(255,255,255,.04)', border:'var(--border)' };
}

function _getFiltered() {
  return _npcs.filter(n => {
    if (_filterDisp && n.disposition !== _filterDisp) return false;
    if (_filterSearch) {
      const s = _filterSearch.toLowerCase();
      return (n.nom||'').toLowerCase().includes(s) || (n.role||'').toLowerCase().includes(s);
    }
    return true;
  });
}

// ── Sélection PNJ ────────────────────────────────────────────────────────────
window.selectNpc = (id) => {
  _activeId = id;
  const n = _npcs.find(x => x.id === id);
  if (!n) return;
  // Update nav highlight
  document.querySelectorAll('[data-npc-id]').forEach(el => {
    const a = el.dataset.npcId === id;
    el.style.background  = a ? 'rgba(232,184,75,.07)' : 'transparent';
    el.style.borderLeft  = `3px solid ${a ? 'var(--gold)' : 'transparent'}`;
  });
  // Update panel
  const panel = document.getElementById('npc-detail-panel');
  if (panel) panel.innerHTML = _renderFiche(n);
};

window._npcSearch = (val) => {
  _filterSearch = val;
  _refreshList();
};

window._npcFilter = (disp) => {
  _filterDisp = disp;
  _refreshList();
};

function _refreshList() {
  const sidebar = document.querySelector('[style*="max-height:calc(100vh - 280px)"]');
  if (!sidebar) { renderNpcs(); return; }
  const filtered = _getFiltered();
  sidebar.innerHTML = filtered.length === 0
    ? `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);
        font-size:.8rem;font-style:italic">Aucun PNJ trouvé</div>`
    : filtered.map(n => _renderNavItem(n)).join('');
}

// ── Modal création / édition PNJ ──────────────────────────────────────────────
function openNpcModal(id = null) {
  const npc = id ? _npcs.find(n => n.id === id) : null;

  openModal(npc ? `✏️ Modifier — ${npc.nom||'PNJ'}` : '👥 Nouveau PNJ', `
    <div class="grid-2" style="gap:.8rem">
      <div class="form-group" style="margin:0">
        <label>Nom</label>
        <input class="input-field" id="npc-nom" value="${_esc(npc?.nom||'')}" placeholder="Aldric le Forgeron">
      </div>
      <div class="form-group" style="margin:0">
        <label>Rôle</label>
        <input class="input-field" id="npc-role" value="${_esc(npc?.role||'')}" placeholder="Forgeron, Garde…">
      </div>
    </div>
    <div class="grid-2" style="gap:.8rem;margin-top:.75rem">
      <div class="form-group" style="margin:0">
        <label>Disposition</label>
        <select class="input-field" id="npc-disp">
          ${['Amical','Neutre','Hostile','Mystérieux','Allié','Ennemi'].map(d =>
            `<option ${d===(npc?.disposition||'Neutre')?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label>Lieu</label>
        <input class="input-field" id="npc-lieu" value="${_esc(npc?.lieu||'')}" placeholder="Taverne du Dragon…">
      </div>
    </div>
    <div class="form-group" style="margin-top:.75rem">
      <label>Description</label>
      <textarea class="input-field" id="npc-desc" rows="4"
        placeholder="Apparence, personnalité, secrets…">${_esc(npc?.description||'')}</textarea>
    </div>
    <div class="form-group" style="margin-top:.75rem">
      <label>URL image <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
      <input class="input-field" id="npc-image" value="${_esc(npc?.imageUrl||'')}" placeholder="https://…">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1"
        onclick="saveNpc('${npc?.id||''}')">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function saveNpc(id) {
  const data = {
    nom:         document.getElementById('npc-nom')?.value?.trim()   || '?',
    role:        document.getElementById('npc-role')?.value?.trim()   || '',
    disposition: document.getElementById('npc-disp')?.value          || 'Neutre',
    lieu:        document.getElementById('npc-lieu')?.value?.trim()   || '',
    description: document.getElementById('npc-desc')?.value?.trim()  || '',
    imageUrl:    document.getElementById('npc-image')?.value?.trim()  || '',
  };

  if (id) {
    await updateInCol('npcs', id, data);
    const idx = _npcs.findIndex(n => n.id === id);
    if (idx >= 0) _npcs[idx] = { ..._npcs[idx], ...data };
    showNotif('PNJ mis à jour !', 'success');
  } else {
    const newId = await addToCol('npcs', data);
    _npcs.push({ id: newId || `npc_${Date.now()}`, ...data });
    _activeId = newId || _activeId;
    showNotif('PNJ créé !', 'success');
  }
  closeModal();
  // Refresh panel si c'est le PNJ actif
  if (_activeId === id || !id) {
    const n = _npcs.find(x => x.id === (id || _activeId));
    const panel = document.getElementById('npc-detail-panel');
    if (panel && n) panel.innerHTML = _renderFiche(n);
    _refreshList();
  }
}

async function deleteNpc(id) {
  if (!confirm('Supprimer ce PNJ et toutes ses affinités ?')) return;
  await deleteFromCol('npcs', id);
  // Supprimer aussi les affinités individuelles liées
  const toDelete = _affiPerso.filter(a => a.npcId === id);
  await Promise.all(toDelete.map(a => deleteFromCol('npc_affinites', a.id)));
  _npcs       = _npcs.filter(n => n.id !== id);
  _affiPerso  = _affiPerso.filter(a => a.npcId !== id);
  if (_activeId === id) _activeId = _npcs[0]?.id || null;
  showNotif('PNJ supprimé.', 'success');
  const content = document.getElementById('main-content');
  _renderPage(content);
}

// ── Modal affinité groupe ─────────────────────────────────────────────────────
window.openAffiniteGroupeModal = (npcId) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n) return;
  const cur = n.affinite?.niveau ?? 2;
  const curNote = n.affinite?.note || '';

  const niveauBtns = AFFINITE.map(a => `
    <button type="button" id="afg-btn-${a.niveau}"
      onclick="window._selectAfgNiveau(${a.niveau})"
      style="flex:1;padding:.55rem .3rem;border-radius:8px;cursor:pointer;transition:all .15s;
      font-size:.78rem;font-weight:${cur===a.niveau?'700':'400'};
      border:2px solid ${cur===a.niveau?a.couleur:'var(--border)'};
      background:${cur===a.niveau?a.bg:'var(--bg-elevated)'};
      color:${cur===a.niveau?a.couleur:'var(--text-dim)'}">
      <div style="font-size:1rem;margin-bottom:2px">${a.icon}</div>
      ${a.label}
    </button>`).join('');

  openModal(`⚙️ Affinité groupe — ${n.nom}`, `
    <input type="hidden" id="afg-niveau" value="${cur}">

    <div class="form-group">
      <label>Niveau d'affinité</label>
      <div style="display:flex;gap:.4rem">${niveauBtns}</div>
    </div>

    <div class="form-group">
      <label>Note <span style="color:var(--text-dim);font-weight:400">(visible par tous)</span></label>
      <textarea class="input-field" id="afg-note" rows="3"
        placeholder="Ex: A aidé lors de la défense de la ville...">${_esc(curNote)}</textarea>
    </div>

    <div class="form-group">
      <label>Événement à enregistrer <span style="color:var(--text-dim);font-weight:400">(optionnel — ajouté à l'historique)</span></label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <div style="display:flex;gap:.25rem;flex-shrink:0">
          ${[-2,-1,0,1,2].map(v => `<button type="button" id="afg-delta-${v}"
            onclick="window._selectAfgDelta(${v})"
            style="width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:.8rem;
            font-weight:700;transition:all .12s;
            border:1px solid ${v<0?'rgba(255,107,107,.3)':v>0?'rgba(34,195,142,.3)':'var(--border)'};
            background:var(--bg-elevated);
            color:${v<0?'#ff6b6b':v>0?'#22c38e':'var(--text-dim)'}">${v>0?'+'+v:v}</button>`).join('')}
        </div>
        <input class="input-field" id="afg-event" placeholder="Ex: A trahi la compagnie lors de…" style="flex:1">
      </div>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        onclick="window.saveAffiniteGroupe('${npcId}')">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
  window._afgDelta = 0;
};

window._selectAfgNiveau = (n) => {
  const inp = document.getElementById('afg-niveau');
  if (inp) inp.value = n;
  AFFINITE.forEach(a => {
    const btn = document.getElementById(`afg-btn-${a.niveau}`);
    if (!btn) return;
    const active = a.niveau === n;
    btn.style.borderColor  = active ? a.couleur : 'var(--border)';
    btn.style.background   = active ? a.bg      : 'var(--bg-elevated)';
    btn.style.color        = active ? a.couleur : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700'     : '400';
  });
};

window._selectAfgDelta = (v) => {
  window._afgDelta = v;
  [-2,-1,0,1,2].forEach(d => {
    const btn = document.getElementById(`afg-delta-${d}`);
    if (!btn) return;
    const active = d === v;
    btn.style.background = active
      ? (d<0?'rgba(255,107,107,.18)':d>0?'rgba(34,195,142,.18)':'rgba(255,255,255,.1)')
      : 'var(--bg-elevated)';
    btn.style.borderWidth = active ? '2px' : '1px';
  });
};

window.saveAffiniteGroupe = async (npcId) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n) return;
  const niveau = parseInt(document.getElementById('afg-niveau')?.value) ?? 2;
  const note   = document.getElementById('afg-note')?.value?.trim()    || '';
  const event  = document.getElementById('afg-event')?.value?.trim()   || '';
  const delta  = window._afgDelta || 0;

  const curHisto = n.affinite?.historique || [];
  const newHisto = event
    ? [...curHisto, { date: new Date().toLocaleDateString('fr-FR'), texte: event, delta }]
    : curHisto;

  const affinite = { niveau, note, historique: newHisto };
  await updateInCol('npcs', npcId, { affinite });
  const idx = _npcs.findIndex(x => x.id === npcId);
  if (idx >= 0) _npcs[idx] = { ..._npcs[idx], affinite };

  closeModal();
  showNotif('Affinité mise à jour !', 'success');
  const panel = document.getElementById('npc-detail-panel');
  if (panel && _activeId === npcId) panel.innerHTML = _renderFiche(_npcs[idx]);
  _refreshList();
};

// ── Modal affinité individuelle ───────────────────────────────────────────────
window.openAffinitePersoModal = (npcId, existingId = null) => {
  const n    = _npcs.find(x => x.id === npcId);
  if (!n) return;
  const existing = existingId ? _affiPerso.find(a => a.id === existingId) : null;
  const chars    = STATE.characters || [];
  const cur      = existing?.niveau ?? 2;

  const niveauBtns = AFFINITE.map(a => `
    <button type="button" id="afp-btn-${a.niveau}"
      onclick="window._selectAfpNiveau(${a.niveau})"
      style="flex:1;padding:.45rem .25rem;border-radius:8px;cursor:pointer;
      font-size:.72rem;font-weight:${cur===a.niveau?'700':'400'};transition:all .15s;
      border:2px solid ${cur===a.niveau?a.couleur:'var(--border)'};
      background:${cur===a.niveau?a.bg:'var(--bg-elevated)'};
      color:${cur===a.niveau?a.couleur:'var(--text-dim)'}">
      <div style="font-size:.9rem;margin-bottom:1px">${a.icon}</div>${a.label}
    </button>`).join('');

  openModal(`${existing?'✏️ Modifier':'+ Ajouter'} une exception — ${n.nom}`, `
    <input type="hidden" id="afp-niveau" value="${cur}">

    <div class="form-group">
      <label>Personnage concerné</label>
      <select class="input-field" id="afp-char">
        <option value="">— Choisir —</option>
        ${chars.map(c => `<option value="${c.id}|${_esc(c.nom||'?')}"
          ${existing?.charId===c.id?'selected':''}>${c.nom||'?'} (${c.ownerPseudo||'?'})</option>`).join('')}
      </select>
    </div>

    <div class="form-group">
      <label>Affinité spécifique</label>
      <div style="display:flex;gap:.35rem">${niveauBtns}</div>
    </div>

    <div class="form-group">
      <label>Note <span style="color:var(--text-dim);font-weight:400">(visible seulement par ce joueur)</span></label>
      <textarea class="input-field" id="afp-note" rows="3"
        placeholder="Ex: A rendu un service personnel…">${_esc(existing?.note||'')}</textarea>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        onclick="window.saveAffinitePerso('${npcId}','${existingId||''}')">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
  window._afpNiveau = cur;
};

window._selectAfpNiveau = (n) => {
  window._afpNiveau = n;
  const inp = document.getElementById('afp-niveau');
  if (inp) inp.value = n;
  AFFINITE.forEach(a => {
    const btn = document.getElementById(`afp-btn-${a.niveau}`);
    if (!btn) return;
    const active = a.niveau === n;
    btn.style.borderColor = active ? a.couleur : 'var(--border)';
    btn.style.background  = active ? a.bg      : 'var(--bg-elevated)';
    btn.style.color       = active ? a.couleur : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '700'     : '400';
  });
};

window.saveAffinitePerso = async (npcId, existingId) => {
  const charSel = document.getElementById('afp-char')?.value;
  if (!charSel) { showNotif('Choisis un personnage.', 'error'); return; }
  const [charId, charNom] = charSel.split('|');
  const niveau = parseInt(document.getElementById('afp-niveau')?.value) ?? 2;
  const note   = document.getElementById('afp-note')?.value?.trim() || '';

  const data = { npcId, charId, charNom, niveau, note };

  if (existingId) {
    await updateInCol('npc_affinites', existingId, data);
    const idx = _affiPerso.findIndex(a => a.id === existingId);
    if (idx >= 0) _affiPerso[idx] = { ..._affiPerso[idx], ...data };
  } else {
    const newId = await addToCol('npc_affinites', data);
    _affiPerso.push({ id: newId || `afp_${Date.now()}`, ...data });
  }

  closeModal();
  showNotif('Exception enregistrée !', 'success');
  const panel = document.getElementById('npc-detail-panel');
  const n     = _npcs.find(x => x.id === npcId);
  if (panel && n && _activeId === npcId) {
    const persoList = _affiPerso.filter(a => a.npcId === npcId);
    const myChars   = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
    const myAffi    = persoList.filter(a => myChars.some(c => c.id === a.charId));
    panel.innerHTML = _renderFiche(n);
  }
};

window.deleteAffinitePerso = async (id) => {
  if (!confirm('Supprimer cette exception ?')) return;
  await deleteFromCol('npc_affinites', id);
  _affiPerso = _affiPerso.filter(a => a.id !== id);
  showNotif('Exception supprimée.', 'success');
  const n = _npcs.find(x => x.id === _activeId);
  const panel = document.getElementById('npc-detail-panel');
  if (panel && n) panel.innerHTML = _renderFiche(n);
};

// ── Utilitaires ───────────────────────────────────────────────────────────────
function filterNpcs(disp, el) {
  document.querySelectorAll('#npc-filter .tab').forEach(t => t.classList.remove('active'));
  el?.classList.add('active');
  _filterDisp = disp;
  _refreshList();
}

function _esc(str) {
  return String(str||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Override PAGES.npcs ───────────────────────────────────────────────────────
PAGES.npcs = renderNpcs;

Object.assign(window, {
  renderNpcs,
  openNpcModal,
  saveNpc,
  deleteNpc,
  filterNpcs,
  openAffiniteGroupeModal,
  openAffinitePersoModal,
  saveAffiniteGroupe,
  saveAffinitePerso,
  deleteAffinitePerso,
});
