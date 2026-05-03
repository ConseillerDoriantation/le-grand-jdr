// ══════════════════════════════════════════════════════════════════════════════
// BESTIARY.JS — Le Bestiaire
// ✓ Admin : CRUD créatures, image+crop, attaques/traits/butins dynamiques
// ✓ Joueur : galerie + suivi personnel (PV/PM live, notes)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _esc } from '../shared/html.js';
import { attachDropAndCrop } from '../shared/image-crop.js';

// ── État local ────────────────────────────────────────────────────────────────
let _bstCropper = null;
let _creatures  = [];
let _tracker    = {}; // { [creatureId]: { pvActuel, pmActuel, notes, deductions:{pv,pm,ca,for,...} } }
let _searchVal  = '';
let _filterType = ''; // filtre par type de créature
let _filterRang  = ''; // filtre par rang (classique, elite, boss)
let _activeId   = null; // créature ouverte dans le panneau
let _bestiaireId = 'main'; // id du bestiaire actif (admin peut switcher)

const RANG_STYLE = {
  classique: { label:'Classique', color:'#a0aec0',         border:'rgba(160,174,192,.45)',   bg:'rgba(160,174,192,.1)' },
  elite:     { label:'Élite',     color:'#e8b84b',         border:'rgba(232,184,75,.4)',      bg:'rgba(232,184,75,.12)' },
  boss:      { label:'Boss',      color:'#ff6b6b',         border:'rgba(255,107,107,.4)',     bg:'rgba(255,107,107,.12)' },
};

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderBestiary() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">⏳</div></div>`;

  // Admin : charger la liste des bestiaires disponibles
  if (STATE.isAdmin) {
    const meta = await getDocData('bestiary_meta', 'list');
    const list = meta?.list || [];
    if (!list.find(b => b.id === 'main')) list.unshift({ id:'main', label:'Bestiaire principal' });
    window._bstBestiaireList = list;
  }

  // Charger les créatures du bestiaire actif
  const col = _bestiaireId === 'main' ? 'bestiary' : `bestiary_${_bestiaireId}`;
  _creatures = await loadCollection(col);
  _creatures.sort((a,b) => (a.nom||'').localeCompare(b.nom||''));
  window._bstCurrentCol = col;

  const uid = STATE.user?.uid;
  if (uid) {
    const trackerDoc = await getDocData('bestiary_tracker', uid);
    _tracker = trackerDoc?.data || {};
  }

  _render();
}

function _render() {
  const content = document.getElementById('main-content');
  const search  = (_searchVal||'').toLowerCase().trim();
  const fType   = (_filterType||'').toLowerCase().trim();
  const fRang   = (_filterRang||'').toLowerCase().trim();

  // Collecter tous les types distincts pour les boutons de filtre
  const allTypes = [...new Set(_creatures.map(c => c.type||'').filter(Boolean))].sort();

  const filtered = _creatures.filter(c => {
    const matchSearch = !search ||
      (c.nom||'').toLowerCase().includes(search) ||
      (c.type||'').toLowerCase().includes(search) ||
      (c.environnement||'').toLowerCase().includes(search);
    const matchType = !fType || (c.type||'').toLowerCase() === fType;
    const matchRang = !fRang || (c.rang||'classique').toLowerCase() === fRang;
    return matchSearch && matchType && matchRang;
  });

  content.innerHTML = `
  <div class="bst-page ${_activeId ? 'has-panel' : 'no-panel'}">

  <!-- ═══ HEADER ═════════════════════════════════════════════════════════════ -->
  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem">
    <div>
      <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:.2rem">Encyclopédie</div>
      <h1 style="font-family:'Cinzel',serif;font-size:1.8rem;color:var(--gold);letter-spacing:2px;margin:0">Bestiaire</h1>
      ${STATE.isAdmin && (window._bstBestiaireList||[]).length > 1 ? `
      <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.55rem">
        ${(window._bstBestiaireList||[]).map(b => `
          <button onclick="window._bstSwitchBestiaire('${b.id}')"
            style="font-size:.72rem;padding:2px 10px;border-radius:999px;cursor:pointer;
            border:1px solid ${b.id===_bestiaireId?'var(--gold)':'var(--border)'};
            background:${b.id===_bestiaireId?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
            color:${b.id===_bestiaireId?'var(--gold)':'var(--text-dim)'};font-weight:${b.id===_bestiaireId?'700':'400'}">
            ${b.label}
          </button>`).join('')}
        <button onclick="window._bstCreateBestiaire()"
          style="font-size:.72rem;padding:2px 10px;border-radius:999px;cursor:pointer;
          border:1px dashed var(--border);background:transparent;color:var(--text-dim)">
          + Nouveau
        </button>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
      ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" onclick="openBeastModal()">+ Créature</button>` : ''}
    </div>
  </div>

  ${filtered.length === 0 ? `
    <div style="text-align:center;padding:4rem;color:var(--text-dim)">
      <div style="font-size:3rem;margin-bottom:.75rem;opacity:.3">🐉</div>
      <p style="font-style:italic">${_creatures.length === 0 ? 'Aucune créature dans le bestiaire.' : 'Aucun résultat.'}</p>
      ${STATE.isAdmin && _creatures.length === 0 ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="openBeastModal()">+ Ajouter la première créature</button>` : ''}
    </div>
  ` : `
  <!-- ═══ LAYOUT : grille + panneau ════════════════════════════════════════ -->
  <div class="bst-layout ${_activeId ? 'has-panel' : 'no-panel'}">

    <div class="bst-main">
      <div class="bst-controls">
        <!-- Filtres par type -->
        ${allTypes.length > 1 ? `
        <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.5rem">
          <button onclick="window._bstSetType('')"
            style="font-size:.72rem;padding:2px 10px;border-radius:999px;cursor:pointer;
            border:1px solid ${!_filterType?'var(--gold)':'var(--border)'};
            background:${!_filterType?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
            color:${!_filterType?'var(--gold)':'var(--text-dim)'};font-weight:${!_filterType?'700':'400'}">
            Tous
          </button>
          ${allTypes.map(t => `
          <button onclick="window._bstSetType('${t.replace(/'/g,"\\'")}')"
            style="font-size:.72rem;padding:2px 10px;border-radius:999px;cursor:pointer;
            border:1px solid ${(_filterType||'').toLowerCase()===t.toLowerCase()?'var(--gold)':'var(--border)'};
            background:${(_filterType||'').toLowerCase()===t.toLowerCase()?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
            color:${(_filterType||'').toLowerCase()===t.toLowerCase()?'var(--gold)':'var(--text-dim)'};
            font-weight:${(_filterType||'').toLowerCase()===t.toLowerCase()?'700':'400'}">
            ${t}
          </button>`).join('')}
        </div>` : ''}
        <!-- Filtres par rang -->
        <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:1rem">
          <button onclick="window._bstSetRang('')"
            style="font-size:.72rem;padding:2px 10px;border-radius:999px;cursor:pointer;
            border:1px solid ${!_filterRang?'var(--gold)':'var(--border)'};
            background:${!_filterRang?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
            color:${!_filterRang?'var(--gold)':'var(--text-dim)'};font-weight:${!_filterRang?'700':'400'}">
            Tous rangs
          </button>
          ${Object.entries(RANG_STYLE).map(([r, rst]) => {
            const active = _filterRang === r;
            return `<button onclick="window._bstSetRang('${r}')"
              style="font-size:.72rem;padding:2px 10px;border-radius:999px;cursor:pointer;
              border:1px solid ${active?rst.border:'var(--border)'};
              background:${active?rst.bg:'var(--bg-elevated)'};
              color:${active?rst.color:'var(--text-dim)'};font-weight:${active?'700':'400'}">
              ${rst.label}
            </button>`;
          }).join('')}
        </div>
        <div class="bst-tools">
          <input id="bst-search" type="text" placeholder="🔍 Rechercher..."
            class="input-field" value="${_searchVal}"
            oninput="window._bstSearchInput(this.value)">
        </div>
      </div>

      <div class="bst-grid">
        ${filtered.map(c => _renderCard(c)).join('')}
      </div>
    </div>

    <div class="bst-panel-slot">
      ${_activeId ? _renderPanel(_creatures.find(c => c.id === _activeId)) : ''}
    </div>
  </div>
  `}
  </div>
  `;
}

// ── Card créature ─────────────────────────────────────────────────────────────
function _renderCard(c) {
  const isActive  = c.id === _activeId;
  const track     = _tracker[c.id] || {};
  const rang      = c.rang || 'classique';
  const rs        = RANG_STYLE[rang] || RANG_STYLE.classique;

  // Admin uniquement : barre de PV avec max connu
  const pvMax    = STATE.isAdmin ? (parseInt(c.pvMax) || 0) : 0;
  const pvActuel = track.pvActuel !== undefined ? parseInt(track.pvActuel) : pvMax;
  const pvPct    = pvMax > 0 ? Math.max(0, Math.min(100, Math.round(pvActuel/pvMax*100))) : 0;
  const pvColor  = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#e8b84b' : '#ff6b6b';

  return `<div class="bst-card ${isActive?'active':''}" onclick="window._bstOpen('${c.id}')">
    ${c.imageUrl
      ? `<img class="bst-img" src="${c.imageUrl}" alt="${c.nom||''}" loading="lazy">`
      : `<div class="bst-img-placeholder">${c.emoji||'🐲'}</div>`
    }
    <div class="bst-card-body">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.3rem">
        <div class="bst-card-name">${c.nom||'?'}</div>
        ${rang !== 'classique' ? `<span style="flex-shrink:0;font-size:.6rem;padding:1px 5px;border-radius:999px;border:1px solid ${rs.border};color:${rs.color};background:${rs.bg};margin-top:2px">${rs.label}</span>` : ''}
      </div>
      <div class="bst-card-meta">
        ${c.type?`${c.type}`:''}${c.type&&c.environnement?' · ':''}${c.environnement||''}
      </div>
      ${STATE.isAdmin && pvMax > 0 ? `
      <div style="margin-top:.5rem">
        <div class="bst-track-bar">
          <div class="bst-track-fill" style="width:${pvPct}%;background:${pvColor}"></div>
        </div>
        <div style="font-size:.65rem;color:var(--text-dim)">${pvActuel}/${pvMax} PV</div>
      </div>` : ''}
    </div>
    ${STATE.isAdmin ? `
    <div style="display:flex;gap:3px;padding:.4rem .6rem;border-top:1px solid var(--border);justify-content:flex-end">
      <button class="btn-icon" style="font-size:.7rem" onclick="event.stopPropagation();openBeastModal('${c.id}')">✏️</button>
      <button class="btn-icon" style="font-size:.7rem;color:#ff6b6b" onclick="event.stopPropagation();deleteBeast('${c.id}')">🗑️</button>
    </div>` : ''}
  </div>`;
}

// ── Panneau détail ────────────────────────────────────────────────────────────
function _renderPanel(c) {
  if (!c) return '';
  const rang  = c.rang || 'classique';
  const rs    = RANG_STYLE[rang] || RANG_STYLE.classique;
  const track = _tracker[c.id] || {};
  const pvMax    = parseInt(c.pvMax) || 0;
  const pmMax    = parseInt(c.pmMax) || 0;
  const pvActuel  = track.pvActuel   !== undefined ? parseInt(track.pvActuel)   : 0;
  const pmActuel  = track.pmActuel   !== undefined ? parseInt(track.pmActuel)   : 0;
  const caEstimee = track.caEstimee  !== undefined ? parseInt(track.caEstimee)  : 0;
  const vitEstimee= track.vitEstimee !== undefined ? parseInt(track.vitEstimee) : 0;

  const attaques = Array.isArray(c.attaques) ? c.attaques : [];
  const traits   = Array.isArray(c.traits)   ? c.traits   : [];
  const butins   = Array.isArray(c.butins)   ? c.butins   : [];

  // ── Blocs partagés MJ + Joueur ───────────────────────────────────────────
  const headerHtml = `
    <div style="position:relative">
      ${c.imageUrl
        ? `<img class="bst-panel-img" src="${c.imageUrl}" alt="${c.nom||''}">`
        : `<div style="height:200px;background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel));display:flex;align-items:center;justify-content:center;font-size:5rem">${c.emoji||'🐲'}</div>`
      }
      <button onclick="window._bstClose()" style="position:absolute;top:10px;right:10px;background:rgba(11,17,24,.8);border:1px solid var(--border);border-radius:999px;color:var(--text-muted);padding:3px 8px;cursor:pointer;font-size:.8rem">✕</button>
      <div style="position:absolute;bottom:10px;left:12px">
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
          <div style="font-family:'Cinzel',serif;font-size:1.2rem;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.8);font-weight:700">${c.nom||'?'}</div>
          ${rang !== 'classique' ? `<span style="font-size:.65rem;padding:2px 7px;border-radius:999px;border:1px solid ${rs.border};color:${rs.color};background:rgba(0,0,0,.55)">${rs.label}</span>` : ''}
        </div>
        ${c.type||c.environnement ? `<div style="font-size:.72rem;color:rgba(255,255,255,.75)">${[c.type,c.environnement].filter(Boolean).join(' · ')}</div>` : ''}
      </div>
    </div>`;

  const attaquesHtml = attaques.length ? `
    <div class="bst-section">
      <div class="bst-section-title">⚔️ Attaques</div>
      ${attaques.map(a => `
        <div style="margin-bottom:.5rem;padding:.5rem .6rem;background:var(--bg-elevated);border-radius:8px;border-left:2px solid #ff6b6b">
          <div style="font-size:.82rem;font-weight:600;color:var(--text)">${a.nom||'Attaque'}</div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem">
            ${a.toucher ? `<span style="font-size:.72rem;color:#e8b84b">🎯 ${a.toucher}</span>` : ''}
            ${a.degats  ? `<span style="font-size:.72rem;color:#ff6b6b">⚔️ ${a.degats}</span>` : ''}
            ${a.portee  ? `<span style="font-size:.72rem;color:var(--text-dim)">📏 ${a.portee}</span>` : ''}
          </div>
          ${a.description ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:.2rem;font-style:italic">${a.description}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  const traitsHtml = traits.length ? `
    <div class="bst-section">
      <div class="bst-section-title">✨ Traits & Capacités</div>
      ${traits.map(t => `
        <div style="margin-bottom:.4rem;padding:.4rem .6rem;border-left:2px solid #b47fff;background:var(--bg-elevated);border-radius:0 8px 8px 0">
          <div style="font-size:.8rem;font-weight:600;color:var(--text)">${t.nom||''}</div>
          ${t.description ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:.1rem">${t.description}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  const butinsHtml = butins.length ? `
    <div class="bst-section">
      <div class="bst-section-title">💰 Butins</div>
      ${butins.map(b => `
        <div class="bst-row">
          <span class="bst-row-label">${b.nom||'Objet'}</span>
          <span class="bst-row-val">${b.quantite||''}${b.chance?` — ${b.chance}`:''}</span>
        </div>`).join('')}
    </div>` : '';

  const descHtml = c.description ? `
    <div class="bst-section">
      <div class="bst-section-title">📖 Description</div>
      <div style="font-size:.82rem;color:var(--text-muted);line-height:1.7">${c.description.replace(/\n/g,'<br>')}</div>
    </div>` : '';

  // ── Suivi combat (commun, adapté selon vue) ──────────────────────────────
  const suiviHtml = (showBars) => `
    <div class="bst-section">
      <div class="bst-section-title">📊 Suivi en combat</div>
      <div style="display:grid;grid-template-columns:${showBars?'1fr 1fr':'1fr 1fr 1fr'};gap:.75rem">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.25rem">
            <span style="font-size:.72rem;color:var(--text-dim)">❤️ PV</span>
            <div style="display:flex;align-items:center;gap:.3rem">
              <button onclick="window._bstAdjust('${c.id}','pv',-1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:.9rem;color:var(--text)">−</button>
              <input type="number" class="bst-input-sm" id="bst-pv-${c.id}" value="${pvActuel}" min="0"
                onchange="window._bstSetStat('${c.id}','pvActuel',this.value)">
              <button onclick="window._bstAdjust('${c.id}','pv',1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:.9rem;color:var(--text)">+</button>
            </div>
          </div>
          ${showBars ? `
          <div class="bst-track-bar"><div class="bst-track-fill" id="bst-pvbar-${c.id}" style="width:${pvMax>0?Math.round(pvActuel/pvMax*100):0}%;background:${pvMax>0&&pvActuel/pvMax>0.5?'#22c38e':pvMax>0&&pvActuel/pvMax>0.25?'#e8b84b':'#ff6b6b'}"></div></div>
          <div style="font-size:.62rem;color:var(--text-dim)">${pvActuel}/${pvMax} PV</div>` :
          `<div style="font-size:.62rem;color:var(--text-dim);font-style:italic">PV estimés</div>`}
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.25rem">
            <span style="font-size:.72rem;color:var(--text-dim)">💙 PM</span>
            <div style="display:flex;align-items:center;gap:.3rem">
              <button onclick="window._bstAdjust('${c.id}','pm',-1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:.9rem;color:var(--text)">−</button>
              <input type="number" class="bst-input-sm" id="bst-pm-${c.id}" value="${pmActuel}" min="0"
                onchange="window._bstSetStat('${c.id}','pmActuel',this.value)">
              <button onclick="window._bstAdjust('${c.id}','pm',1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:.9rem;color:var(--text)">+</button>
            </div>
          </div>
          ${showBars ? `
          <div class="bst-track-bar"><div class="bst-track-fill" id="bst-pmbar-${c.id}" style="width:${pmMax>0?Math.round(pmActuel/pmMax*100):0}%;background:#4f8cff"></div></div>
          <div style="font-size:.62rem;color:var(--text-dim)">${pmActuel}/${pmMax} PM</div>` :
          `<div style="font-size:.62rem;color:var(--text-dim);font-style:italic">PM estimés</div>`}
        </div>
        ${!showBars ? `
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.25rem">
            <span style="font-size:.72rem;color:var(--text-dim)">🛡 CA</span>
            <input type="number" class="bst-input-sm" id="bst-ca-${c.id}" value="${caEstimee}" min="0"
              onchange="window._bstSetStat('${c.id}','caEstimee',this.value)">
          </div>
          <div style="font-size:.62rem;color:var(--text-dim);font-style:italic">CA estimée</div>
        </div>` : ''}
      </div>
      ${!showBars ? `
      <div style="display:flex;align-items:center;gap:.5rem;margin-top:.5rem">
        <span style="font-size:.72rem;color:var(--text-dim);flex:1">🏃 Vitesse estimée (cases)</span>
        <input type="number" class="bst-input-sm" id="bst-vit-${c.id}" value="${vitEstimee}" min="0"
          onchange="window._bstSetStat('${c.id}','vitEstimee',this.value)">
      </div>` : ''}
      <div style="margin-top:.6rem">
        <textarea id="bst-notes-${c.id}" placeholder="Notes de combat..." rows="2"
          class="input-field" style="font-size:.78rem;resize:none"
          onchange="window._bstSetNotes('${c.id}',this.value)">${track.notes||''}</textarea>
      </div>
      <button onclick="window._bstReset('${c.id}')"
        style="font-size:.7rem;color:var(--text-dim);background:none;border:none;cursor:pointer;margin-top:.25rem;text-decoration:underline">
        Réinitialiser
      </button>
    </div>`;

  // ── VUE ADMIN ─────────────────────────────────────────────────────────────
  if (STATE.isAdmin) {
    // Calcul modificateur D&D : floor((stat - 10) / 2)
    const mod = (val) => {
      const n = parseInt(val);
      if (!val || isNaN(n)) return null;
      const m = Math.floor((n - 10) / 2);
      return m >= 0 ? `+${m}` : `${m}`;
    };
    const statCaracs = [
      ['FOR', c.force], ['DEX', c.dexterite], ['CON', c.constitution],
      ['INT', c.intelligence], ['SAG', c.sagesse], ['CHA', c.charisme],
    ];
    const statBase = [
      ['PV', c.pvMax||'—'], ['PM', c.pmMax||'—'], ['CA', c.ca||'—'],
      ['Vit.', c.vitesse ? `${c.vitesse}m` : '—'], ['Init.', c.initiative||'—'],
    ];
    return `
    <div class="bst-panel" style="position:sticky;top:1rem">
      ${headerHtml}
      <div style="position:absolute;top:10px;left:10px;background:rgba(79,140,255,.85);border-radius:6px;padding:2px 8px;font-size:.62rem;font-weight:700;color:#fff;letter-spacing:1px">MJ</div>
      <div class="bst-section">
        <div class="bst-section-title">📈 Statistiques</div>
        <!-- Stats de base : PV / PM / CA / Vit / Init -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.4rem;margin-bottom:.5rem">
          ${statBase.map(([l,v]) => `
            <div class="bst-stat">
              <div class="bst-stat-val">${v}</div>
              <div class="bst-stat-lbl">${l}</div>
            </div>`).join('')}
        </div>
        <!-- Caractéristiques avec modificateur -->
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.4rem">
          ${statCaracs.map(([l,v]) => {
            const m = mod(v);
            return `<div class="bst-stat">
              <div class="bst-stat-val" style="font-size:.82rem">${v||'—'}</div>
              ${m ? `<div style="font-size:.68rem;color:${parseInt(m)>=0?'#22c38e':'#ff6b6b'};font-weight:600">${m}</div>` : ''}
              <div class="bst-stat-lbl">${l}</div>
            </div>`;
          }).join('')}
        </div>
        ${c.niveau||c.dangerositeXp ? `
        <div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">
          ${c.niveau        ? `<span class="bst-tag">Niv. ${c.niveau}</span>` : ''}
          ${c.dangerositeXp ? `<span class="bst-tag">⭐ ${c.dangerositeXp} XP</span>` : ''}
        </div>` : ''}
      </div>
      ${suiviHtml(true)}
      ${descHtml}
      ${attaquesHtml}
      ${traitsHtml}
      ${butinsHtml}
      <div class="bst-section" style="display:flex;gap:.5rem">
        <button class="btn btn-outline btn-sm" style="flex:1" onclick="openBeastModal('${c.id}')">✏️ Modifier</button>
        <button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:rgba(255,107,107,.3)" onclick="deleteBeast('${c.id}')">🗑️</button>
      </div>
    </div>`;
  }

  // ── VUE JOUEUR ────────────────────────────────────────────────────────────
  // Lignes vides à deviner : autant de lignes que le MJ a créées,
  // mais sans aucune valeur — les joueurs remplissent eux-mêmes.
  const ded = (track.deductions || {});

  const attaquesJoueurHtml = attaques.length ? `
    <div class="bst-section">
      <div class="bst-section-title">⚔️ Attaques <span style="font-size:.62rem;color:var(--text-dim);font-weight:400;margin-left:.4rem">${attaques.length} observée${attaques.length>1?'s':''}</span></div>
      ${attaques.map((_, i) => `
        <div style="margin-bottom:.5rem;padding:.5rem .6rem;background:var(--bg-elevated);border-radius:8px;border-left:2px solid rgba(255,107,107,.35)">
          <input class="input-field" style="font-size:.8rem;font-weight:600;padding:3px 6px;margin-bottom:.25rem;width:100%"
            placeholder="Nom de l'attaque..."
            value="${(ded['att_nom_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','att_nom_${i}',this.value)">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.3rem">
            <input class="input-field" style="font-size:.72rem;padding:2px 5px"
              placeholder="🎯 Toucher"
              value="${(ded['att_toucher_'+i]||'')}"
              onchange="window._bstSetDeduction('${c.id}','att_toucher_${i}',this.value)">
            <input class="input-field" style="font-size:.72rem;padding:2px 5px"
              placeholder="⚔️ Dégâts"
              value="${(ded['att_degats_'+i]||'')}"
              onchange="window._bstSetDeduction('${c.id}','att_degats_${i}',this.value)">
            <input class="input-field" style="font-size:.72rem;padding:2px 5px"
              placeholder="📏 Portée"
              value="${(ded['att_portee_'+i]||'')}"
              onchange="window._bstSetDeduction('${c.id}','att_portee_${i}',this.value)">
          </div>
        </div>`).join('')}
    </div>` : '';

  const traitsJoueurHtml = traits.length ? `
    <div class="bst-section">
      <div class="bst-section-title">✨ Traits & Capacités <span style="font-size:.62rem;color:var(--text-dim);font-weight:400;margin-left:.4rem">${traits.length} trait${traits.length>1?'s':''}</span></div>
      ${traits.map((_, i) => `
        <div style="margin-bottom:.4rem;padding:.4rem .6rem;border-left:2px solid rgba(180,127,255,.35);background:var(--bg-elevated);border-radius:0 8px 8px 0">
          <input class="input-field" style="font-size:.8rem;font-weight:600;padding:3px 6px;margin-bottom:.2rem;width:100%"
            placeholder="Nom du trait..."
            value="${(ded['tr_nom_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','tr_nom_${i}',this.value)">
          <input class="input-field" style="font-size:.74rem;padding:2px 6px;width:100%"
            placeholder="Description..."
            value="${(ded['tr_desc_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','tr_desc_${i}',this.value)">
        </div>`).join('')}
    </div>` : '';

  const butinsJoueurHtml = butins.length ? `
    <div class="bst-section">
      <div class="bst-section-title">💰 Butins <span style="font-size:.62rem;color:var(--text-dim);font-weight:400;margin-left:.4rem">${butins.length} objet${butins.length>1?'s':''}</span></div>
      ${butins.map((_, i) => `
        <div class="bst-row" style="gap:.4rem">
          <input class="input-field" style="flex:1;font-size:.78rem;padding:3px 6px"
            placeholder="Objet..."
            value="${(ded['bu_nom_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','bu_nom_${i}',this.value)">
          <input class="input-field" style="width:80px;font-size:.78rem;padding:3px 6px"
            placeholder="Quantité"
            value="${(ded['bu_qte_'+i]||'')}"
            onchange="window._bstSetDeduction('${c.id}','bu_qte_${i}',this.value)">
        </div>`).join('')}
    </div>` : '';

  return `
  <div class="bst-panel" style="position:sticky;top:1rem">
    ${headerHtml}
    ${suiviHtml(false)}
    ${attaquesJoueurHtml}
    ${traitsJoueurHtml}
    ${butinsJoueurHtml}
  </div>`;
}
// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — Créer / Modifier une créature
// ══════════════════════════════════════════════════════════════════════════════
async function openBeastModal(id = null) {
  _bstCropper?.destroy(); _bstCropper = null;
  const c = id ? _creatures.find(x => x.id === id) : null;

  // Sérialiser les tableaux dynamiques
  const attaques = c?.attaques || [{ nom:'', toucher:'', degats:'', portee:'', description:'' }];
  const traits   = c?.traits   || [{ nom:'', description:'' }];
  const butins   = c?.butins   || [{ nom:'', quantite:'', chance:'' }];

  openModal(c ? `✏️ Modifier — ${c.nom||'Créature'}` : '🐉 Nouvelle créature', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="form-group" style="grid-column:1/-1">
        <label>Nom</label>
        <input class="input-field" id="bst-nom" value="${c?.nom||''}" placeholder="Gobelin, Dragon rouge...">
      </div>
      <div class="form-group">
        <label>Type</label>
        <input class="input-field" id="bst-type" value="${c?.type||''}" placeholder="Humanoïde, Bête, Mort-vivant...">
      </div>
      <div class="form-group">
        <label>Environnement</label>
        <input class="input-field" id="bst-env" value="${c?.environnement||''}" placeholder="Forêt, Donjon...">
      </div>
      <div class="form-group">
        <label>Niveau / FP</label>
        <input type="number" class="input-field" id="bst-niveau" value="${c?.niveau||''}" placeholder="1">
      </div>
      <div class="form-group">
        <label>XP récompense</label>
        <input type="number" class="input-field" id="bst-xp" value="${c?.dangerositeXp||''}" placeholder="100">
      </div>
      <div class="form-group">
        <label>Emoji (si pas d'image)</label>
        <input class="input-field" id="bst-emoji" value="${c?.emoji||'🐲'}" style="max-width:80px">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label>Rang</label>
        <div id="bst-rang-selector" data-rang="${c?.rang||'classique'}" style="display:flex;gap:.5rem">
          ${Object.entries(RANG_STYLE).map(([r, rst]) => {
            const active = (c?.rang||'classique') === r;
            return `<button type="button" onclick="window._bstSelectRang('${r}')" data-rang-btn="${r}"
              style="flex:1;padding:.4rem .6rem;border-radius:8px;cursor:pointer;font-size:.82rem;
              font-weight:${active?'700':'400'};
              border:1px solid ${active?rst.border:'var(--border)'};
              background:${active?rst.bg:'var(--bg-elevated)'};
              color:${active?rst.color:'var(--text-dim)'}">${rst.label}</button>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Image upload + crop -->
    <div class="form-group">
      <label>Image</label>
      <div id="bst-drop-zone" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated);transition:border-color .15s">
        <div id="bst-drop-preview"></div>
      </div>
      <div id="bst-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">Recadrez — ratio 4:3</div>
        <canvas id="bst-crop-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" id="bst-crop-confirm" style="margin-top:.5rem;width:100%">✂️ Confirmer le recadrage</button>
        <div id="bst-crop-ok" style="display:none;font-size:.75rem;text-align:center;margin-top:4px"></div>
      </div>
    </div>

    <!-- Stats -->
    <div class="form-group">
      <label>Statistiques</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
        ${[['pvMax','❤️ PV Max'],['pmMax','💙 PM Max'],['ca','🛡️ CA'],
           ['force','FOR'],['dexterite','DEX'],['constitution','CON'],
           ['intelligence','INT'],['sagesse','SAG'],['charisme','CHA'],
           ['vitesse','Vitesse (m)'],['initiative','Initiative']].map(([k,l]) => `
          <div>
            <label style="font-size:.68rem;color:var(--text-dim)">${l}</label>
            <input type="number" class="input-field" id="bst-${k}" value="${c?.[k]||''}" style="padding:4px 6px">
          </div>`).join('')}
      </div>
    </div>

    <!-- Description -->
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="bst-desc" rows="3" placeholder="Apparence, comportement...">${c?.description||''}</textarea>
    </div>

    <!-- ATTAQUES dynamiques -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        ⚔️ Attaques
        <button type="button" onclick="window._bstAddRow('attaques')"
          style="font-size:.72rem;background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
          border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--gold)">+ Ligne</button>
      </label>
      <div id="bst-attaques-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${attaques.map((a, i) => _attackRow(a, i)).join('')}
      </div>
    </div>

    <!-- TRAITS dynamiques -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        ✨ Traits & Capacités
        <button type="button" onclick="window._bstAddRow('traits')"
          style="font-size:.72rem;background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
          border-radius:6px;padding:2px 8px;cursor:pointer;color:#4f8cff">+ Ligne</button>
      </label>
      <div id="bst-traits-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${traits.map((t, i) => _traitRow(t, i)).join('')}
      </div>
    </div>

    <!-- BUTINS dynamiques -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between">
        💰 Butins
        <button type="button" onclick="window._bstAddRow('butins')"
          style="font-size:.72rem;background:rgba(34,195,142,.08);border:1px solid rgba(34,195,142,.3);
          border-radius:6px;padding:2px 8px;cursor:pointer;color:#22c38e">+ Ligne</button>
      </label>
      <div id="bst-butins-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${butins.map((b, i) => _butinRow(b, i)).join('')}
      </div>
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="saveBeast('${id||''}')">
      ${c ? 'Enregistrer' : 'Créer la créature'}
    </button>
  `);

  _bstCropper?.destroy();
  _bstCropper = attachDropAndCrop({
    dropEl:        document.getElementById('bst-drop-zone'),
    previewEl:     document.getElementById('bst-drop-preview'),
    cropWrapEl:    document.getElementById('bst-crop-wrap'),
    canvasId:      'bst-crop-canvas',
    statusEl:      document.getElementById('bst-crop-ok'),
    confirmBtnEl:  document.getElementById('bst-crop-confirm'),
    initialUrl:    c?.imageUrl || '',
    ratio:         { w: 4, h: 3 },
    output:        { maxW: 1800, target: 700_000 },
  });
}

// ── Lignes dynamiques ─────────────────────────────────────────────────────────
function _attackRow(a={}, i) {
  return `<div class="bst-dyn-row" id="bst-att-${i}" style="background:var(--bg-elevated);border-radius:8px;padding:.5rem;border:1px solid var(--border)">
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:.4rem;margin-bottom:.3rem">
      <input class="input-field" placeholder="Nom attaque" value="${a.nom||''}" id="bst-att-nom-${i}" style="font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Toucher" value="${a.toucher||''}" id="bst-att-toucher-${i}" style="font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Dégâts" value="${a.degats||''}" id="bst-att-degats-${i}" style="font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Portée" value="${a.portee||''}" id="bst-att-portee-${i}" style="font-size:.78rem;padding:4px 6px">
    </div>
    <div style="display:flex;gap:.4rem">
      <input class="input-field" placeholder="Description de l'effet..." value="${a.description||''}" id="bst-att-desc-${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
      <button type="button" onclick="window._bstRemoveRow('attaques',${i})" style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px">✕</button>
    </div>
  </div>`;
}

function _traitRow(t={}, i) {
  return `<div class="bst-dyn-row" id="bst-tr-${i}" style="background:var(--bg-elevated);border-radius:8px;padding:.5rem;border:1px solid var(--border)">
    <div style="display:flex;gap:.4rem">
      <input class="input-field" placeholder="Nom du trait" value="${t.nom||''}" id="bst-tr-nom-${i}" style="width:160px;font-size:.78rem;padding:4px 6px;flex-shrink:0">
      <input class="input-field" placeholder="Description..." value="${t.description||''}" id="bst-tr-desc-${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
      <button type="button" onclick="window._bstRemoveRow('traits',${i})" style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px">✕</button>
    </div>
  </div>`;
}

function _butinRow(b={}, i) {
  return `<div class="bst-dyn-row" id="bst-bu-${i}" style="background:var(--bg-elevated);border-radius:8px;padding:.5rem;border:1px solid var(--border)">
    <div style="display:flex;gap:.4rem">
      <input class="input-field" placeholder="Nom de l'objet" value="${b.nom||''}" id="bst-bu-nom-${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Quantité" value="${b.quantite||''}" id="bst-bu-qte-${i}" style="width:80px;font-size:.78rem;padding:4px 6px">
      <input class="input-field" placeholder="Chance %" value="${b.chance||''}" id="bst-bu-chance-${i}" style="width:80px;font-size:.78rem;padding:4px 6px">
      <button type="button" onclick="window._bstRemoveRow('butins',${i})" style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px">✕</button>
    </div>
  </div>`;
}

// ── Ajouter / supprimer une ligne dynamique ───────────────────────────────────
window._bstAddRow = (type) => {
  const container = document.getElementById(`bst-${type}-list`);
  if (!container) return;
  const i = container.querySelectorAll('.bst-dyn-row').length;
  const div = document.createElement('div');
  div.innerHTML = type==='attaques' ? _attackRow({},i) : type==='traits' ? _traitRow({},i) : _butinRow({},i);
  container.appendChild(div.firstElementChild);
};

window._bstRemoveRow = (type, i) => {
  const row = document.getElementById(`bst-${type==='attaques'?'att':type==='traits'?'tr':'bu'}-${i}`);
  row?.remove();
};

// ── Lire les lignes dynamiques depuis le DOM ──────────────────────────────────
function _readRows(type) {
  if (type === 'attaques') {
    return [...document.querySelectorAll('#bst-attaques-list .bst-dyn-row')].map((_,i) => ({
      nom:         document.getElementById(`bst-att-nom-${i}`)?.value?.trim()     || '',
      toucher:     document.getElementById(`bst-att-toucher-${i}`)?.value?.trim() || '',
      degats:      document.getElementById(`bst-att-degats-${i}`)?.value?.trim()  || '',
      portee:      document.getElementById(`bst-att-portee-${i}`)?.value?.trim()  || '',
      description: document.getElementById(`bst-att-desc-${i}`)?.value?.trim()   || '',
    })).filter(a => a.nom || a.degats);
  }
  if (type === 'traits') {
    return [...document.querySelectorAll('#bst-traits-list .bst-dyn-row')].map((_,i) => ({
      nom:         document.getElementById(`bst-tr-nom-${i}`)?.value?.trim()  || '',
      description: document.getElementById(`bst-tr-desc-${i}`)?.value?.trim() || '',
    })).filter(t => t.nom || t.description);
  }
  // butins
  return [...document.querySelectorAll('#bst-butins-list .bst-dyn-row')].map((_,i) => ({
    nom:      document.getElementById(`bst-bu-nom-${i}`)?.value?.trim()    || '',
    quantite: document.getElementById(`bst-bu-qte-${i}`)?.value?.trim()    || '',
    chance:   document.getElementById(`bst-bu-chance-${i}`)?.value?.trim() || '',
  })).filter(b => b.nom);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDER / SUPPRIMER
// ══════════════════════════════════════════════════════════════════════════════
async function saveBeast(id = '') {
  try {
    const nom = document.getElementById('bst-nom')?.value?.trim();
    if (!nom) { showNotif('Le nom est requis.','error'); return; }

    // Image : nouveau crop > existante (pas de bouton "retirer" ici)
    const cropResult = _bstCropper?.getResult();
    let imageUrl = typeof cropResult === 'string'
      ? cropResult
      : (id ? (_creatures.find(c=>c.id===id)?.imageUrl || '') : '');

    // Vérifier taille Firestore
    if (imageUrl.length > 900_000) { showNotif('Image trop grande, recadrez plus petit.','error'); return; }

    const data = {
      nom,
      type:          document.getElementById('bst-type')?.value?.trim()    || '',
      environnement: document.getElementById('bst-env')?.value?.trim()     || '',
      niveau:        parseInt(document.getElementById('bst-niveau')?.value)||0,
      dangerositeXp: parseInt(document.getElementById('bst-xp')?.value)||0,
      emoji:         document.getElementById('bst-emoji')?.value?.trim()   || '🐲',
      rang:          document.getElementById('bst-rang-selector')?.dataset?.rang || 'classique',
      imageUrl,
      description:   document.getElementById('bst-desc')?.value?.trim()   || '',
      // Stats
      pvMax:          parseInt(document.getElementById('bst-pvMax')?.value)||0,
      pmMax:          parseInt(document.getElementById('bst-pmMax')?.value)||0,
      ca:             parseInt(document.getElementById('bst-ca')?.value)||0,
      force:          parseInt(document.getElementById('bst-force')?.value)||0,
      dexterite:      parseInt(document.getElementById('bst-dexterite')?.value)||0,
      constitution:   parseInt(document.getElementById('bst-constitution')?.value)||0,
      intelligence:   parseInt(document.getElementById('bst-intelligence')?.value)||0,
      sagesse:        parseInt(document.getElementById('bst-sagesse')?.value)||0,
      charisme:       parseInt(document.getElementById('bst-charisme')?.value)||0,
      vitesse:        parseInt(document.getElementById('bst-vitesse')?.value)||0,
      initiative:     parseInt(document.getElementById('bst-initiative')?.value)||0,
      // Tableaux dynamiques
      attaques: _readRows('attaques'),
      traits:   _readRows('traits'),
      butins:   _readRows('butins'),
    };

    const col = window._bstCurrentCol || 'bestiary';

    if (id) {
      await updateInCol(col, id, data);
      const idx = _creatures.findIndex(c=>c.id===id);
      if (idx>=0) _creatures[idx] = { ...data, id };
    } else {
      const newId = await addToCol(col, data);
      if (typeof newId === 'string') _creatures.push({ ...data, id: newId });
      else _creatures = await loadCollection(col);
      _creatures.sort((a,b)=>(a.nom||'').localeCompare(b.nom||''));
    }

    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    showNotif(id ? `${nom} mis à jour !` : `${nom} ajouté au bestiaire !`, 'success');
    _render();
  } catch (e) { notifySaveError(e); }
}

async function deleteBeast(id) {
  try {
    const col = window._bstCurrentCol || 'bestiary';
    const c = _creatures.find(x=>x.id===id);
    if (!await confirmModal(`Supprimer "${c?.nom||'cette créature'}" ?`)) return;
    await deleteFromCol(col, id);
    _creatures = _creatures.filter(x=>x.id!==id);
    if (_activeId === id) _activeId = null;
    _render();
    showNotif('Créature supprimée.','success');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUIVI JOUEUR
// ══════════════════════════════════════════════════════════════════════════════
async function _saveTracker() {
  try {
    const uid = STATE.user?.uid; if (!uid) return;
    await saveDoc('bestiary_tracker', uid, { data: _tracker });
  } catch (e) { notifySaveError(e); }
}

window._bstOpen = (id) => { _activeId = _activeId === id ? null : id; _render(); };
window._bstClose = () => { _activeId = null; _render(); };
window._bstSetRang = (rang) => { _filterRang = rang; _render(); };
window._bstSelectRang = (rang) => {
  const sel = document.getElementById('bst-rang-selector');
  if (!sel) return;
  sel.dataset.rang = rang;
  sel.querySelectorAll('[data-rang-btn]').forEach(btn => {
    const r = btn.dataset.rangBtn;
    const active = r === rang;
    const rst = RANG_STYLE[r] || RANG_STYLE.classique;
    btn.style.fontWeight = active ? '700' : '400';
    btn.style.border     = `1px solid ${active ? rst.border : 'var(--border)'}`;
    btn.style.background = active ? rst.bg  : 'var(--bg-elevated)';
    btn.style.color      = active ? rst.color : 'var(--text-dim)';
  });
};
// Recherche : met à jour la valeur et filtre la grille SANS rerender complet
window._bstSearchInput = (val) => {
  _searchVal = val;
  // Filtrer en live sans reconstruire toute la page
  const search = val.toLowerCase().trim();
  const fType  = (_filterType||'').toLowerCase().trim();
  const fRang  = (_filterRang||'').toLowerCase().trim();
  document.querySelectorAll('.bst-card').forEach(card => {
    const id = card.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    const c  = _creatures.find(x => x.id === id);
    if (!c) return;
    const matchSearch = !search ||
      (c.nom||'').toLowerCase().includes(search) ||
      (c.type||'').toLowerCase().includes(search) ||
      (c.environnement||'').toLowerCase().includes(search);
    const matchType = !fType || (c.type||'').toLowerCase() === fType;
    const matchRang = !fRang || (c.rang||'classique').toLowerCase() === fRang;
    card.style.display = (matchSearch && matchType && matchRang) ? '' : 'none';
  });
};

window._bstSearch = (val) => { _searchVal = val; _render(); }; // legacy
window._bstSetType = (type) => { _filterType = type; _render(); };

// Switch de bestiaire (admin uniquement)
window._bstSwitchBestiaire = async (id) => {
  _bestiaireId = id;
  _activeId    = null;
  _searchVal   = '';
  _filterType  = '';
  _filterRang  = '';
  await renderBestiary();
};

window._bstCreateBestiaire = async () => {
  const label = prompt('Nom du nouveau bestiaire :');
  if (!label?.trim()) return;
  const id    = 'bst_' + Date.now();
  const list  = window._bstBestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  list.push({ id, label: label.trim() });
  await saveDoc('bestiary_meta', 'list', { list });
  window._bstBestiaireList = list;
  _bestiaireId = id;
  _activeId    = null;
  _filterRang  = '';
  await renderBestiary();
};

// Déductions joueur
window._bstSetDeduction = (id, key, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  if (!_tracker[id].deductions) _tracker[id].deductions = {};
  if (val === '' || val === null || val === undefined) {
    delete _tracker[id].deductions[key];
  } else {
    _tracker[id].deductions[key] = val;
  }
  _saveTracker();
};

window._bstAdjust = (id, type, delta) => {
  const c = _creatures.find(x=>x.id===id); if (!c) return;
  if (!_tracker[id]) _tracker[id] = {};
  const curKey = type==='pv'?'pvActuel':'pmActuel';
  // Admin : connaît le max et le respecte. Joueur : pas de borne max (stats masquées)
  const max    = STATE.isAdmin ? (parseInt(c[type==='pv'?'pvMax':'pmMax'])||0) : null;
  const cur    = _tracker[id][curKey] !== undefined ? parseInt(_tracker[id][curKey]) : (max ?? 0);
  const newVal = max !== null ? Math.max(0, Math.min(max, cur + delta)) : Math.max(0, cur + delta);
  _tracker[id][curKey] = newVal;

  const input = document.getElementById(`bst-${type}-${id}`);
  const bar   = document.getElementById(`bst-${type}bar-${id}`);
  if (input) input.value = newVal;
  if (bar && max) {
    const pct = Math.round(newVal/max*100);
    bar.style.width = pct+'%';
    if (type==='pv') bar.style.background = pct>50?'#22c38e':pct>25?'#e8b84b':'#ff6b6b';
  }
  if (STATE.isAdmin && max) {
    const cardBar = document.querySelector(`[onclick="window._bstOpen('${id}')"] .bst-track-fill`);
    if (cardBar && type==='pv') { const pct=Math.round(newVal/max*100); cardBar.style.width=pct+'%'; cardBar.style.background=pct>50?'#22c38e':pct>25?'#e8b84b':'#ff6b6b'; }
  }
  _saveTracker();
};

window._bstSetStat = (id, key, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  _tracker[id][key] = parseInt(val)||0;
  _saveTracker();
};

window._bstSetNotes = (id, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  _tracker[id].notes = val;
  _saveTracker();
};

window._bstReset = (id) => {
  const c = _creatures.find(x=>x.id===id); if (!c) return;
  // Admin remet les vraies valeurs, joueur remet à zéro ses déductions
  _tracker[id] = STATE.isAdmin
    ? { pvActuel: parseInt(c.pvMax)||0, pmActuel: parseInt(c.pmMax)||0, notes:'' }
    : { pvActuel: 0, pmActuel: 0, caEstimee: 0, vitEstimee: 0, pvCombat: 0, notes:'', deductions:{} };
  _saveTracker();
  _render();
};

// ── Override PAGES.bestiaire + exports ───────────────────────────────────────
PAGES.bestiaire = renderBestiary;

Object.assign(window, {
  renderBestiary,
  openBeastModal,
  saveBeast,
  deleteBeast,
});
