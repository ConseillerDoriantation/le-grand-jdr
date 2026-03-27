// ══════════════════════════════════════════════════════════════════════════════
// STORY.JS — La Trame
// Timeline horizontale par acte · Axes narratifs · Modal détail riche
// Admin : CRUD complet avec image, participants, axe, réussite
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ── Palette des axes narratifs ────────────────────────────────────────────────
const AXE_COLORS = [
  '#4f8cff', '#e8b84b', '#22c38e', '#ff6b6b',
  '#b47fff', '#ff9f43', '#54a0ff', '#ff6b9d',
];

// ── Couleurs de statut ────────────────────────────────────────────────────────
const STATUT_CONFIG = {
  'Terminée':   { color: '#22c38e', bg: 'rgba(34,195,142,0.12)',  border: 'rgba(34,195,142,0.30)',  icon: '✓' },
  'En cours':   { color: '#4f8cff', bg: 'rgba(79,140,255,0.12)',  border: 'rgba(79,140,255,0.30)',  icon: '▶' },
  'Échouée':    { color: '#ff6b6b', bg: 'rgba(255,107,107,0.12)', border: 'rgba(255,107,107,0.30)', icon: '✗' },
  'En attente': { color: '#888',    bg: 'rgba(128,128,128,0.10)', border: 'rgba(128,128,128,0.25)', icon: '◷' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getStatut(item) {
  return STATUT_CONFIG[item.statut] || STATUT_CONFIG['En attente'];
}

function getAxeColor(axe, axeMap) {
  if (!axe) return '#555';
  if (!axeMap[axe]) {
    const idx = Object.keys(axeMap).length % AXE_COLORS.length;
    axeMap[axe] = AXE_COLORS[idx];
  }
  return axeMap[axe];
}

// ── Rendu de la page ──────────────────────────────────────────────────────────
async function renderStory() {
  const content = document.getElementById('main-content');
  const items   = await loadCollection('story');

  // Actes disponibles
  const actesSet = new Set(items.map(i => i.acte || 'Acte I').filter(Boolean));
  const actes    = [...actesSet].sort();
  if (!actes.length) actes.push('Acte I');

  const activeActe = window._storyActe || actes[0];
  window._storyActe = activeActe;

  // Items de l'acte actif
  const acteItems = items
    .filter(i => (i.acte || 'Acte I') === activeActe)
    .sort((a, b) => (a.ordre || 0) - (b.ordre || 0) || (a.date || '').localeCompare(b.date || ''));

  // Construire la map des axes narratifs
  const axeMap = {};
  acteItems.forEach(i => { if (i.axe) getAxeColor(i.axe, axeMap); });
  const axes = Object.keys(axeMap);

  content.innerHTML = `
  <style>
    .story-node {
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .story-node:hover {
      transform: translateY(-3px);
      z-index: 10;
    }
    .story-node:hover .story-node-inner {
      box-shadow: 0 8px 28px rgba(0,0,0,0.4);
    }
    .story-node-inner {
      transition: box-shadow 0.15s;
    }
    .axe-line {
      position: absolute;
      height: 2px;
      pointer-events: none;
      border-radius: 1px;
    }
    .story-timeline-scroll {
      overflow-x: auto;
      overflow-y: visible;
      padding-bottom: 1.5rem;
      scrollbar-width: thin;
    }
    .story-timeline-scroll::-webkit-scrollbar { height: 4px; }
    .story-timeline-scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 2px; }
  </style>

  <!-- ═══ HEADER ══════════════════════════════════════════════════ -->
  <div style="
    background:linear-gradient(135deg,rgba(79,140,255,0.05),rgba(232,184,75,0.04));
    border:1px solid var(--border);border-radius:var(--radius-lg);
    padding:1.4rem 1.8rem;margin-bottom:1.4rem;
    display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;
  ">
    <div>
      <div style="font-size:0.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:0.3rem">Chroniques de la Compagnie</div>
      <h1 style="font-family:'Cinzel',serif;font-size:1.8rem;color:var(--gold);letter-spacing:2px;line-height:1;margin:0">La Trame</h1>
    </div>
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" onclick="openStoryModal()">+ Ajouter</button>` : ''}
      <div style="display:flex;gap:0.4rem;font-size:0.75rem;color:var(--text-dim);flex-wrap:wrap">
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#22c38e;display:inline-block"></span>Terminée</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#4f8cff;display:inline-block"></span>En cours</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#ff6b6b;display:inline-block"></span>Échouée</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#555;display:inline-block"></span>En attente</span>
      </div>
    </div>
  </div>

  <!-- ═══ SÉLECTEUR D'ACTES ═══════════════════════════════════════ -->
  <div style="display:flex;gap:0.5rem;margin-bottom:1.6rem;flex-wrap:wrap">
    ${actes.map((acte, i) => {
      const active  = acte === activeActe;
      const nItems  = items.filter(it => (it.acte || 'Acte I') === acte).length;
      return `<button
        onclick="window._storyActe='${acte}';navigate('story')"
        style="
          display:flex;align-items:center;gap:0.5rem;
          padding:0.55rem 1.2rem;border-radius:999px;cursor:pointer;
          font-family:'Cinzel',serif;font-size:0.82rem;
          border:1px solid ${active ? 'var(--gold)' : 'var(--border)'};
          background:${active ? 'rgba(232,184,75,0.1)' : 'transparent'};
          color:${active ? 'var(--gold)' : 'var(--text-muted)'};
          transition:all 0.15s;
        ">
        ${acte}
        <span style="
          font-size:0.68rem;border-radius:999px;padding:1px 6px;font-family:sans-serif;
          background:${active ? 'var(--gold)' : 'var(--bg-elevated)'};
          color:${active ? '#0b1118' : 'var(--text-dim)'};
        ">${nItems}</span>
      </button>`;
    }).join('')}
    ${STATE.isAdmin ? `
    <button onclick="openNewActeModal()" style="
      padding:0.55rem 1rem;border-radius:999px;cursor:pointer;
      border:1px dashed var(--border);background:transparent;
      color:var(--text-dim);font-size:0.8rem;transition:all 0.15s;
    ">+ Acte</button>` : ''}
  </div>

  <!-- ═══ LÉGENDE DES AXES ══════════════════════════════════════════ -->
  ${axes.length > 0 ? `
  <div style="display:flex;gap:0.6rem;margin-bottom:1.2rem;flex-wrap:wrap;align-items:center">
    <span style="font-size:0.72rem;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">Axes :</span>
    ${axes.map(axe => `
      <span style="
        display:flex;align-items:center;gap:5px;
        font-size:0.75rem;color:var(--text-muted);
        background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:999px;padding:3px 10px;
      ">
        <span style="width:8px;height:3px;border-radius:1px;background:${axeMap[axe]};display:inline-block;flex-shrink:0"></span>
        ${axe}
      </span>`).join('')}
  </div>` : ''}

  <!-- ═══ TIMELINE ═════════════════════════════════════════════════ -->
  ${acteItems.length === 0 ? `
    <div style="text-align:center;padding:5rem 2rem;color:var(--text-dim)">
      <div style="font-size:3rem;margin-bottom:1rem;opacity:0.3">📜</div>
      <p style="font-style:italic">Aucune mission pour ${activeActe}.</p>
      ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="openStoryModal()">+ Ajouter la première</button>` : ''}
    </div>
  ` : `
    <div class="story-timeline-scroll">
      <div id="story-timeline" style="position:relative;min-width:max-content;padding:1rem 1.5rem 2rem">
        ${_renderTimeline(acteItems, axeMap)}
      </div>
    </div>
  `}
  `;
}

// ── Rendu timeline ────────────────────────────────────────────────────────────
function _renderTimeline(items, axeMap) {
  // Regrouper par axe
  const axeGroups = {};
  const noAxe     = [];

  items.forEach(item => {
    if (item.axe) {
      if (!axeGroups[item.axe]) axeGroups[item.axe] = [];
      axeGroups[item.axe].push(item);
    } else {
      noAxe.push(item);
    }
  });

  // Toutes les lignes à afficher
  const allAxes = [
    ...(noAxe.length ? [{ axe: null, items: noAxe }] : []),
    ...Object.entries(axeGroups).map(([axe, items]) => ({ axe, items })),
  ];

  const CARD_W    = 160;  // largeur d'une card
  const CARD_GAP  = 24;   // gap entre cards
  const ROW_H     = 200;  // hauteur d'une ligne
  const ROW_GAP   = 32;   // gap entre lignes
  const OFFSET_X  = 20;   // marge gauche

  // Calculer la largeur totale basée sur l'axe le plus long
  const maxItems  = Math.max(...allAxes.map(a => a.items.length));
  const totalW    = OFFSET_X + maxItems * (CARD_W + CARD_GAP) + CARD_GAP;
  const totalH    = allAxes.length * (ROW_H + ROW_GAP) + ROW_GAP;

  let html = `<svg style="position:absolute;top:0;left:0;width:${totalW}px;height:${totalH}px;pointer-events:none;overflow:visible">`;

  // Dessiner les lignes de connexion par axe
  allAxes.forEach((group, rowIdx) => {
    const y       = ROW_GAP + rowIdx * (ROW_H + ROW_GAP) + ROW_H / 2;
    const color   = group.axe ? axeMap[group.axe] : '#444';
    const xStart  = OFFSET_X + (CARD_W / 2);
    const xEnd    = OFFSET_X + (group.items.length - 1) * (CARD_W + CARD_GAP) + CARD_W / 2;

    if (group.items.length > 1) {
      html += `<line x1="${xStart}" y1="${y}" x2="${xEnd}" y2="${y}"
        stroke="${color}" stroke-width="2" stroke-dasharray="none" opacity="0.4"/>`;
    }

    // Points de connexion sur chaque nœud
    group.items.forEach((_, colIdx) => {
      const cx = OFFSET_X + colIdx * (CARD_W + CARD_GAP) + CARD_W / 2;
      html += `<circle cx="${cx}" cy="${y}" r="4" fill="${color}" opacity="0.7"/>`;
    });
  });

  html += `</svg>`;

  // Cards
  allAxes.forEach((group, rowIdx) => {
    const color = group.axe ? axeMap[group.axe] : '#555';
    const top   = ROW_GAP + rowIdx * (ROW_H + ROW_GAP);

    // Label de l'axe à gauche
    if (group.axe) {
      html += `<div style="
        position:absolute;
        left:0;top:${top + ROW_H / 2 - 10}px;
        writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);
        font-size:0.62rem;color:${color};
        opacity:0.7;letter-spacing:1px;text-transform:uppercase;
        white-space:nowrap;
      ">${group.axe}</div>`;
    }

    group.items.forEach((item, colIdx) => {
      const left   = OFFSET_X + colIdx * (CARD_W + CARD_GAP);
      const st     = getStatut(item);

      html += `
      <div class="story-node" data-id="${item.id}"
        style="position:absolute;left:${left}px;top:${top}px;width:${CARD_W}px;"
        onclick="openStoryDetail('${item.id}')">
        <div class="story-node-inner" style="
          background:var(--bg-card);
          border:1px solid ${st.border};
          border-radius:12px;overflow:hidden;
        ">
          <!-- Image -->
          <div style="width:100%;height:90px;background:var(--bg-panel);position:relative;overflow:hidden;flex-shrink:0">
            ${item.imageUrl
              ? `<img src="${item.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" draggable="false">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
                   font-size:1.8rem;background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel))">
                   ${item.type === 'combat' ? '⚔️' : item.type === 'mission' ? '🎯' : '📖'}
                 </div>`
            }
            <!-- Statut badge -->
            <div style="
              position:absolute;top:5px;right:5px;
              background:rgba(11,17,24,0.82);
              border:1px solid ${st.border};
              border-radius:999px;padding:1px 6px;
              font-size:0.6rem;color:${st.color};
            ">${st.icon} ${item.statut || 'En attente'}</div>
            <!-- Axe color bar -->
            <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:${color};opacity:0.8"></div>
          </div>

          <!-- Titre -->
          <div style="padding:0.5rem 0.6rem">
            <div style="font-family:'Cinzel',serif;font-size:0.72rem;color:var(--text);line-height:1.3;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.titre || ''}">
              ${item.titre || 'Mission'}
            </div>
            ${item.date ? `<div style="font-size:0.62rem;color:var(--text-dim);margin-top:2px">${item.date}</div>` : ''}
          </div>
        </div>

        <!-- Boutons admin sous la card -->
        ${STATE.isAdmin ? `
        <div style="display:flex;gap:3px;margin-top:4px;justify-content:center">
          <button class="btn-icon" style="font-size:0.7rem;padding:2px 6px"
            onclick="event.stopPropagation();editStory('${item.id}')">✏️</button>
          <button class="btn-icon" style="font-size:0.7rem;padding:2px 6px;color:#ff6b6b"
            onclick="event.stopPropagation();deleteStory('${item.id}')">🗑️</button>
        </div>` : ''}
      </div>`;
    });
  });

  return `<div style="position:relative;width:${totalW}px;height:${totalH}px">${html}</div>`;
}

// ── Modal détail mission ──────────────────────────────────────────────────────
async function openStoryDetail(id) {
  const items  = await loadCollection('story');
  const item   = items.find(i => i.id === id);
  if (!item) return;

  const st      = getStatut(item);
  const reussite = parseInt(item.reussite) || 0;
  const participants = (item.participants || []);

  // Couleur barre de réussite
  const barColor = reussite >= 80 ? '#22c38e' : reussite >= 40 ? '#e8b84b' : '#ff6b6b';

  openModal('', `
  <div style="margin:-1.2rem -1.2rem 0;position:relative;overflow:hidden;border-radius:12px 12px 0 0">
    ${item.imageUrl
      ? `<img src="${item.imageUrl}" style="width:100%;height:180px;object-fit:cover;display:block">`
      : `<div style="width:100%;height:140px;
           background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel));
           display:flex;align-items:center;justify-content:center;font-size:4rem">
           ${item.type === 'combat' ? '⚔️' : item.type === 'mission' ? '🎯' : '📖'}
         </div>`
    }
    <!-- Type badge -->
    <div style="position:absolute;top:12px;right:12px;
      background:rgba(11,17,24,0.85);border:1px solid ${st.border};
      border-radius:999px;padding:3px 10px;font-size:0.72rem;color:${st.color}">
      ${item.type === 'mission' ? 'Mission' : item.type === 'combat' ? 'Combat' : 'Événement'}
    </div>
  </div>

  <div style="padding:1.2rem 0 0">
    <!-- Titre + axe -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;margin-bottom:0.25rem">
      <h2 style="font-family:'Cinzel',serif;font-size:1.25rem;color:var(--text);margin:0;line-height:1.2">
        ${item.titre || 'Mission'}
      </h2>
      ${item.axe ? `<span style="
        font-size:0.7rem;color:var(--text-dim);background:var(--bg-elevated);
        border:1px solid var(--border);border-radius:999px;
        padding:3px 10px;flex-shrink:0;white-space:nowrap
      ">${item.axe}</span>` : ''}
    </div>

    ${item.date ? `<div style="font-size:0.78rem;color:var(--text-dim);margin-bottom:0.75rem">
      📅 ${item.date}${item.acte ? ` · ${item.acte}` : ''}
    </div>` : ''}

    ${item.lieu ? `<div style="font-size:0.83rem;color:var(--text-muted);margin-bottom:0.75rem">
      <strong style="color:var(--text)">Lieu</strong> : ${item.lieu}
    </div>` : ''}

    ${item.description ? `<div style="
      font-size:0.85rem;color:var(--text-muted);line-height:1.7;
      margin-bottom:1rem;
    ">${item.description.replace(/\n/g, '<br>')}</div>` : ''}

    <div style="border-top:1px solid var(--border);padding-top:1rem;display:flex;gap:1.5rem;flex-wrap:wrap">

      <!-- Participants -->
      ${participants.length > 0 ? `
      <div style="flex:1;min-width:140px">
        <div style="font-size:0.72rem;color:var(--text-dim);letter-spacing:1px;
          text-transform:uppercase;margin-bottom:0.5rem">Participants</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${participants.map(p => `
            <div style="
              width:36px;height:36px;border-radius:50%;
              background:var(--bg-elevated);border:2px solid var(--border-bright);
              display:flex;align-items:center;justify-content:center;
              overflow:hidden;font-size:0.65rem;color:var(--text-dim);
            ">
              ${p.imageUrl
                ? `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover">`
                : `<span style="font-size:1rem">${p.emoji || '⚔️'}</span>`
              }
            </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- Réussite -->
      ${item.type === 'mission' && reussite > 0 ? `
      <div style="flex:1;min-width:160px">
        <div style="font-size:0.72rem;color:var(--text-dim);letter-spacing:1px;
          text-transform:uppercase;margin-bottom:0.5rem">Réussite</div>
        <div style="background:var(--bg-elevated);border-radius:999px;height:10px;overflow:hidden;margin-bottom:0.4rem">
          <div style="width:${reussite}%;height:100%;background:${barColor};border-radius:999px;
            transition:width 0.6s ease"></div>
        </div>
        <div style="font-family:'Cinzel',serif;font-size:0.9rem;color:${barColor}">${reussite} %</div>
        ${item.notesReussite ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.4rem;line-height:1.5">
          ${item.notesReussite.split('\n').map(l => `<div>• ${l}</div>`).join('')}
        </div>` : ''}
      </div>` : ''}

      <!-- Récompense -->
      ${item.recompense ? `
      <div style="flex:1;min-width:120px">
        <div style="font-size:0.72rem;color:var(--text-dim);letter-spacing:1px;
          text-transform:uppercase;margin-bottom:0.5rem">Récompense</div>
        <div style="font-size:0.83rem;color:var(--gold)">${item.recompense}</div>
      </div>` : ''}
    </div>

    ${STATE.isAdmin ? `
    <div style="margin-top:1rem;display:flex;gap:0.5rem">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="closeModal();editStory('${item.id}')">✏️ Modifier</button>
      <button class="btn btn-outline btn-sm" style="color:#ff6b6b;border-color:rgba(255,107,107,0.3)"
        onclick="closeModal();deleteStory('${item.id}')">🗑️</button>
    </div>` : ''}
  </div>
  `);
}

// ── Modal ajout/édition ───────────────────────────────────────────────────────
function openStoryModal(item = null) {
  // Récupérer les actes connus
  const acteActif = window._storyActe || 'Acte I';

  openModal(item ? `✏️ Modifier — ${item.titre || 'Mission'}` : '📜 Nouveau', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
      <div class="form-group">
        <label>Type</label>
        <select class="input-field" id="st-type" onchange="document.getElementById('st-mission-extra').style.display=this.value==='mission'?'block':'none'">
          <option value="mission" ${item?.type === 'mission' ? 'selected' : ''}>🎯 Mission</option>
          <option value="event"   ${item?.type === 'event'   ? 'selected' : ''}>📖 Événement</option>
          <option value="combat"  ${item?.type === 'combat'  ? 'selected' : ''}>⚔️ Combat</option>
        </select>
      </div>
      <div class="form-group">
        <label>Acte</label>
        <input class="input-field" id="st-acte" value="${item?.acte || acteActif}" placeholder="Acte I">
      </div>
    </div>

    <div class="form-group">
      <label>Titre</label>
      <input class="input-field" id="st-titre" value="${item?.titre || ''}" placeholder="Sauver les poules !">
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
      <div class="form-group">
        <label>Axe narratif</label>
        <input class="input-field" id="st-axe" value="${item?.axe || ''}" placeholder="ex: Escorte du professeur">
      </div>
      <div class="form-group">
        <label>Date / Session</label>
        <input class="input-field" id="st-date" value="${item?.date || ''}" placeholder="Session 1">
      </div>
    </div>

    <div class="form-group">
      <label>Lieu</label>
      <input class="input-field" id="st-lieu" value="${item?.lieu || ''}" placeholder="Forêt du Cap d'Espérance">
    </div>

    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="st-desc" rows="4" placeholder="Narration de la mission...">${item?.description || ''}</textarea>
    </div>

    <div class="form-group">
      <label>URL Image (bannière)</label>
      <input class="input-field" id="st-image" value="${item?.imageUrl || ''}" placeholder="https://...">
    </div>

    <div class="form-group">
      <label>Participants (URLs d'avatars, une par ligne — ou emoji:Nom)</label>
      <textarea class="input-field" id="st-participants" rows="3" placeholder="https://url-avatar.jpg\n⚔️:Kael\n🧙:Mira">${
        (item?.participants || []).map(p => p.imageUrl || (p.emoji ? `${p.emoji}:${p.nom || ''}` : '')).filter(Boolean).join('\n')
      }</textarea>
    </div>

    <!-- Extra mission -->
    <div id="st-mission-extra" style="${(item?.type || 'mission') === 'mission' ? '' : 'display:none'}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div class="form-group">
          <label>Statut</label>
          <select class="input-field" id="st-statut">
            ${['En cours','Terminée','Échouée','En attente'].map(s =>
              `<option ${s === (item?.statut || 'En cours') ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Réussite (%)</label>
          <input type="number" class="input-field" id="st-reussite" min="0" max="100"
            value="${item?.reussite || ''}" placeholder="100">
        </div>
      </div>
      <div class="form-group">
        <label>Notes de réussite (une par ligne)</label>
        <textarea class="input-field" id="st-notes-reussite" rows="3" placeholder="La mission a été réussie.\nTout a été exploré.">${item?.notesReussite || ''}</textarea>
      </div>
      <div class="form-group">
        <label>Récompense</label>
        <input class="input-field" id="st-recompense" value="${item?.recompense || ''}" placeholder="500 or, Épée légendaire">
      </div>
    </div>

    <div class="form-group">
      <label>Ordre d'affichage</label>
      <input type="number" class="input-field" id="st-ordre" value="${item?.ordre || 0}" placeholder="0">
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem"
      onclick="saveStory('${item?.id || ''}')">
      ${item ? 'Enregistrer' : 'Créer'}
    </button>
  `);
}

// ── Sauvegarder ───────────────────────────────────────────────────────────────
async function saveStory(id = '') {
  const titre = document.getElementById('st-titre')?.value?.trim();
  if (!titre) { showNotif('Le titre est requis.', 'error'); return; }

  // Parser les participants
  const participantsRaw = document.getElementById('st-participants')?.value || '';
  const participants = participantsRaw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    if (l.startsWith('http')) return { imageUrl: l, nom: '' };
    const [emoji, nom] = l.split(':');
    return { emoji: emoji?.trim() || '⚔️', nom: nom?.trim() || '' };
  });

  const data = {
    type:          document.getElementById('st-type')?.value        || 'mission',
    titre,
    acte:          document.getElementById('st-acte')?.value?.trim()  || 'Acte I',
    axe:           document.getElementById('st-axe')?.value?.trim()   || '',
    date:          document.getElementById('st-date')?.value?.trim()  || '',
    lieu:          document.getElementById('st-lieu')?.value?.trim()  || '',
    description:   document.getElementById('st-desc')?.value          || '',
    imageUrl:      document.getElementById('st-image')?.value?.trim() || '',
    participants,
    statut:        document.getElementById('st-statut')?.value        || 'En cours',
    reussite:      parseInt(document.getElementById('st-reussite')?.value) || 0,
    notesReussite: document.getElementById('st-notes-reussite')?.value?.trim() || '',
    recompense:    document.getElementById('st-recompense')?.value?.trim() || '',
    ordre:         parseInt(document.getElementById('st-ordre')?.value) || 0,
  };

  if (id) await updateInCol('story', id, data);
  else    await addToCol('story', data);

  // Mettre à jour l'acte actif au nouvel acte si changé
  window._storyActe = data.acte;

  closeModal();
  showNotif(id ? 'Mission mise à jour.' : `"${titre}" ajoutée !`, 'success');
  await PAGES.story();
}

// ── Éditer ────────────────────────────────────────────────────────────────────
async function editStory(id) {
  const items = await loadCollection('story');
  const item  = items.find(i => i.id === id);
  if (item) openStoryModal(item);
}

// ── Supprimer ─────────────────────────────────────────────────────────────────
async function deleteStory(id) {
  if (!confirm('Supprimer cet élément de la trame ?')) return;
  await deleteFromCol('story', id);
  showNotif('Élément supprimé.', 'success');
  await PAGES.story();
}

// ── Nouvel acte ───────────────────────────────────────────────────────────────
function openNewActeModal() {
  openModal('+ Nouvel Acte', `
    <div class="form-group">
      <label>Nom de l'acte</label>
      <input class="input-field" id="new-acte-name" placeholder="Acte II" autofocus>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="
      const name = document.getElementById('new-acte-name')?.value?.trim();
      if (!name) return;
      window._storyActe = name;
      closeModal();
      navigate('story');
    ">Créer l'acte</button>
  `);
}

// ── Override PAGES.story ──────────────────────────────────────────────────────
PAGES.story = renderStory;

// ── Exports globaux ───────────────────────────────────────────────────────────
Object.assign(window, {
  openStoryModal,
  openStoryDetail,
  openNewActeModal,
  saveStory,
  editStory,
  deleteStory,
});
