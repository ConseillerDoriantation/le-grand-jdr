// ══════════════════════════════════════════════════════════════════════════════
// NPCS.JS — PNJ & Affinités
// ✓ Fiches PNJ : nom, rôle, lieu, description, portrait reconnaissable
// ✓ Affinité groupe   : segments cliquables (1 clic admin) + modal événement
// ✓ Affinités spécifiques : emoji + couleur + label, créées par l'admin
//     → quick add inline dans la fiche
//     → gestionnaire intégré (ajout / modif dans la même modal)
// ✓ Firestore :
//     npcs/{id}                        → fiche PNJ + affinité groupe
//     npc_affinites/{id}               → relation individuelle PNJ ↔ joueur
//     npc_affinites/npc_affinite_types → affinités spécifiques {id,label,emoji,couleur}
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal, pushModal, updateModalContent } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _esc } from '../shared/html.js';
import { listPlaces } from './map/data/places.repo.js';
import { listOrganizations } from './map/data/organizations.repo.js';
import {
  autocompleteHTML, initAutocomplete,
  multiAutocompleteHTML, initMultiAutocomplete, getMultiAutocompleteValues,
} from '../shared/autocomplete.js';
import { getModFromScore } from '../shared/char-stats.js';

// ── Stats PNJ (admin) ────────────────────────────────────────────────────────
// Schéma volontairement simple pour les PNJ : pas de formule équipement comme
// pour les persos joueurs — chaque vitale est saisie directement.
const NPC_VITALS = [
  { key: 'pv',      label: 'PV',      icon: '❤️' },
  { key: 'pm',      label: 'PM',      icon: '✨' },
  { key: 'ca',      label: 'CA',      icon: '🛡️' },
  { key: 'vitesse', label: 'Vit.',    icon: '👟' },
];
const NPC_STATS = [
  { key: 'force',        short: 'FOR' },
  { key: 'dexterite',    short: 'DEX' },
  { key: 'constitution', short: 'CON' },
  { key: 'intelligence', short: 'INT' },
  { key: 'sagesse',      short: 'SAG' },
  { key: 'charisme',     short: 'CHA' },
];

const _modStr = (v) => { const m = getModFromScore(Number(v) || 8); return m >= 0 ? `+${m}` : String(m); };
const _readNumberOrNull = (id) => {
  const raw = document.getElementById(id)?.value?.trim();
  if (!raw) return null;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : null;
};

// ── Affinité groupe — 5 niveaux fixes ────────────────────────────────────────
const AFFINITE = [
  { niveau: 0, label: "Hostile",  couleur: '#ff4757', bg: 'rgba(255,71,87,.12)',   border: 'rgba(255,71,87,.3)',   icon: '💢', desc: 'Cherche activement à nuire au groupe' },
  { niveau: 1, label: 'Méfiant',  couleur: '#ff9f43', bg: 'rgba(255,159,67,.1)',   border: 'rgba(255,159,67,.28)', icon: '👁️', desc: 'Prudent, peu coopératif' },
  { niveau: 2, label: 'Neutre',   couleur: '#a0aec0', bg: 'rgba(160,174,192,.08)', border: 'rgba(160,174,192,.22)',icon: '😐', desc: 'Ni ami ni ennemi' },
  { niveau: 3, label: 'Amical',   couleur: '#4f8cff', bg: 'rgba(79,140,255,.1)',   border: 'rgba(79,140,255,.28)', icon: '🤝', desc: 'Bienveillant, prêt à aider' },
  { niveau: 4, label: 'Allié',    couleur: '#22c38e', bg: 'rgba(34,195,142,.1)',   border: 'rgba(34,195,142,.28)', icon: '⚔️', desc: 'Loyal, combattra aux côtés du groupe' },
];

// ── Émojis et couleurs pour les affinités spécifiques ────────────────────────
const EMOJI_PRESET = [
  '🤝','❤️','🖤','💔','🫂',
  '⚔️','🗡️','🛡️','☠️','🩸','👹',
  '😈','👑','🏆','🎖️','🪖','⚖️',
  '🔮','🧙','🧛','🧝','🧟','🪄','📜',
  '👁️','🧠','🤫','🗝️','🎪',
  '🌿','🌲','🌙','⛈️','❄️',
  '🐉','🦅','🐺','🐍',
  '🎭','🎲','📖','🧭','⛓️',
  '💎','🔥','⚡'
];

const TYPE_COLORS = ['#d63031','#e74c3c','#ff6b6b','#ff7675','#ff4757','#e84393','#fd79a8','#ff6f91','#ff9ff3',
  '#e17055','#ff9f43','#ffb142','#e8b84b','#fdcb6e','#ffeaa7','#f6e58d','#6ab04c','#2ecc71','#22c38e','#00b894',
  '#55efc4','#7bed9f','#00cec9','#0abde3','#81ecec','#48dbfb','#00a8ff','#4f8cff','#0984e3','#3742fa','#6c5ce7',
  '#9c88ff','#a29bfe','#b47fff','#8e44ad','#636e72','#2d3436'
];

const afx = (n) => AFFINITE[Math.max(0, Math.min(4, n ?? 2))];
const AFFINITE_TYPES_DOC_ID = 'npc_affinite_types';

// ── État local ────────────────────────────────────────────────────────────────
let _npcs          = [];
let _affiPerso     = [];   // [{id, npcId, charId, charNom, typeId, typeLabel, note}]
let _affiniteTypes = [];   // [{id, label, emoji, couleur}]
let _places        = [];   // [{ id, name }] — alimente l'autocomplete Lieu
let _organisations = [];   // [{ id, name }] — alimente la sélection Organisations
let _activeId      = null;
let _filterSearch  = '';

// ── Chargement ────────────────────────────────────────────────────────────────
async function _load() {
  const [npcs, affi, typesDoc, places, orgs] = await Promise.all([
    loadCollection('npcs'),
    loadCollection('npc_affinites'),
    getDocData('npc_affinites', AFFINITE_TYPES_DOC_ID),
    listPlaces().catch(() => []),
    listOrganizations().catch(() => []),
  ]);
  _npcs          = npcs || [];
  _affiPerso     = (affi || []).filter(a => a.id !== AFFINITE_TYPES_DOC_ID);
  _affiniteTypes = Array.isArray(typesDoc?.types) ? typesDoc.types : [];
  _affiniteTypes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  _places        = (places || []).filter(p => p?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _organisations = (orgs   || []).filter(o => o?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// ── Helpers types ─────────────────────────────────────────────────────────────
const _getAffiniteType      = (id) => _affiniteTypes.find(t => t.id === id) || null;
const _getAffiniteTypeLabel = (id, fb = '') => _getAffiniteType(id)?.label   || fb || '';
const _getAffiniteTypeColor = (id) => _getAffiniteType(id)?.couleur || TYPE_COLORS[0];
const _getAffiniteTypeEmoji = (id) => _getAffiniteType(id)?.emoji   || '✨';

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

  content.innerHTML = `
  <div style="display:grid;grid-template-columns:280px 1fr;gap:1rem;
    align-items:start;max-width:1200px;margin:0 auto">

    <!-- ═══ SIDEBAR ═════════════════════════════════════════════════════ -->
    <div style="position:sticky;top:0;display:flex;flex-direction:column;gap:.6rem">

      <div style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:var(--radius-lg);padding:.9rem 1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.65rem">
          <div>
            <div style="font-family:'Cinzel',serif;font-size:.9rem;color:var(--gold)">👥 PNJ</div>
            <div style="font-size:.68rem;color:var(--text-dim);margin-top:1px">
              ${_npcs.length} personnage${_npcs.length > 1 ? 's' : ''}</div>
          </div>
          ${STATE.isAdmin ? `
          <button onclick="openNpcModal()"
            style="width:30px;height:30px;border-radius:8px;border:1px solid rgba(79,140,255,.3);
            background:rgba(79,140,255,.08);color:var(--gold);cursor:pointer;font-size:1.1rem;
            display:flex;align-items:center;justify-content:center">+</button>` : ''}
        </div>

        <input id="npc-search" class="input-field" placeholder="🔍 Rechercher…"
          value="${_filterSearch}" oninput="window._npcSearch(this.value)"
          style="font-size:.8rem;padding:.4rem .6rem">

        ${STATE.isAdmin ? `
        <button onclick="window._openMjStatsView()"
          style="margin-top:.5rem;width:100%;padding:.5rem .65rem;
          background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
          border-radius:8px;color:#e8b84b;cursor:pointer;font-size:.78rem;
          font-weight:600;display:flex;align-items:center;justify-content:center;gap:.4rem;
          transition:all .12s"
          onmouseover="this.style.background='rgba(232,184,75,.14)'"
          onmouseout="this.style.background='rgba(232,184,75,.08)'"
          title="Toutes les stats des PNJ en un coup d'œil — PV/PM ajustables">
          📊 Stats en un coup d'œil
        </button>` : ''}
      </div>

      <div id="npc-list-items" style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:var(--radius-lg);overflow:hidden;
        max-height:calc(51vh);overflow-y:auto">
        ${_buildListHtml(filtered)}
      </div>
    </div>

    <!-- ═══ FICHE PRINCIPALE ═════════════════════════════════════════════ -->
    <div id="npc-detail-panel">
      ${active ? _renderFiche(active) : _renderEmpty()}
    </div>
  </div>`;
}

// ── Nav item ──────────────────────────────────────────────────────────────────
function _renderNavItem(n) {
  const isActive = n.id === _activeId;
  const af       = afx(n.affinite?.niveau ?? 2);
  return `
  <div onclick="window.selectNpc('${n.id}')" data-npc-id="${n.id}"
    style="display:flex;align-items:center;gap:.6rem;padding:.55rem .85rem;cursor:pointer;
    transition:all .1s;background:${isActive ? 'rgba(79,140,255,.07)' : 'transparent'};
    border-left:3px solid ${isActive ? 'var(--gold)' : 'transparent'}"
    onmouseover="if(!this.style.background.includes('140'))this.style.background='rgba(255,255,255,.03)'"
    onmouseout="if(!this.style.background.includes('140'))this.style.background='transparent'">

    <div style="width:38px;height:38px;border-radius:50%;flex-shrink:0;overflow:hidden;
      background:linear-gradient(135deg,${af.couleur}22,${af.couleur}08);
      border:2px solid ${isActive ? 'var(--gold)' : af.border};
      display:flex;align-items:center;justify-content:center">
      ${n.imageUrl
        ? `<img src="${n.imageUrl}" style="width:100%;height:100%;object-fit:cover;object-position:top">`
        : `<span style="font-family:'Cinzel',serif;font-weight:700;font-size:.95rem;color:${af.couleur}">${(n.nom || '?')[0].toUpperCase()}</span>`}
    </div>

    <div style="flex:1;min-width:0">
      <div style="font-size:.84rem;font-weight:${isActive ? '700' : '500'};
        color:${isActive ? 'var(--gold)' : 'var(--text)'};
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(n.nom || '?')}</div>
      <div style="display:flex;align-items:center;gap:.4rem;margin-top:2px">
        <div style="display:flex;gap:2px">
          ${AFFINITE.map((a, i) => `<div style="width:6px;height:6px;border-radius:50%;
            background:${i <= (n.affinite?.niveau ?? 2) ? a.couleur : 'rgba(255,255,255,.08)'}"></div>`).join('')}
        </div>
        <span style="font-size:.65rem;color:${af.couleur}">${af.label}</span>
      </div>
    </div>

    ${STATE.isAdmin ? `
    <button onclick="event.stopPropagation();openNpcModal('${n.id}')" title="Modifier ce PNJ"
      style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;
      padding:.3rem .4rem;border-radius:6px;font-size:.85rem;flex-shrink:0;line-height:1;
      transition:all .12s"
      onmouseover="this.style.background='rgba(232,184,75,.12)';this.style.color='var(--gold)'"
      onmouseout="this.style.background='transparent';this.style.color='var(--text-dim)'">✏️</button>
    ` : ''}
  </div>`;
}

// ══ Fiche PNJ — composants ════════════════════════════════════════════════════

// Portrait + identité (portrait reconnaissable, pas de bannière dans le corps)
function _renderFicheHeader(n) {
  const af = afx(n.affinite?.niveau ?? 2);

  return `
  <div style="display:grid;grid-template-columns:${n.imageUrl ? '96px' : '0'} 1fr;
    gap:0;align-items:stretch">

    ${n.imageUrl ? `
    <!-- Portrait colonne gauche -->
    <div style="position:relative;overflow:hidden;border-radius:var(--radius-lg) 0 0 0;
      background:linear-gradient(160deg,${af.couleur}18,var(--bg-panel))">
      <img src="${n.imageUrl}" style="width:100%;height:100%;min-height:110px;
        object-fit:cover;object-position:top center;display:block">
      <div style="position:absolute;inset:0;
        background:linear-gradient(to right,transparent 60%,var(--bg-card) 100%)"></div>
    </div>` : ''}

    <!-- Identité -->
<div style="padding:1rem 1.2rem;display:flex;flex-direction:column;justify-content:center;gap:.4rem">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
    <div>
      <h2 style="font-family:'Cinzel',serif;font-size:1.2rem;color:var(--text);
        margin:0 0 .18rem;letter-spacing:.5px;line-height:1.25">${_esc(n.nom || '?')}</h2>
      ${n.role ? `<div style="font-size:.79rem;color:var(--text-muted);font-style:italic">${_esc(n.role)}</div>` : ''}
    </div>
    ${STATE.isAdmin ? `
    <div style="display:flex;gap:.3rem;flex-shrink:0">
      <button onclick="openNpcModal('${n.id}')"
        style="background:rgba(255,255,255,.06);border:1px solid var(--border);
        border-radius:8px;padding:3px 10px;cursor:pointer;font-size:.72rem;
        color:var(--text-dim);transition:all .12s"
        onmouseover="this.style.background='rgba(255,255,255,.1)'"
        onmouseout="this.style.background='rgba(255,255,255,.06)'">✏️ Modifier</button>
      <button onclick="deleteNpc('${n.id}')"
        style="background:transparent;border:1px solid rgba(255,107,107,.25);
        border-radius:8px;padding:3px 8px;cursor:pointer;font-size:.75rem;
        color:#ff6b6b">🗑️</button>
    </div>` : ''}
  </div>

  <div style="display:flex;flex-direction:column;align-items:flex-start;gap:.25rem">
    <span style="font-size:.67rem;padding:2px 8px;border-radius:999px;
      background:${af.bg};color:${af.couleur};border:1px solid ${af.border};font-weight:600">
      ${af.icon} ${af.label}
    </span>

    ${n.lieu ? `<span style="font-size:.69rem;color:var(--text-dim)">📍 ${_esc(n.lieu)}</span>` : ''}
    ${Array.isArray(n.organisations) && n.organisations.length
      ? `<span style="font-size:.69rem;color:var(--text-dim)">🏛️ ${n.organisations.map(_esc).join(', ')}</span>`
      : ''}
  </div>

  ${n.description ? `
  <div style="font-size:.81rem;color:var(--text-muted);line-height:1.75;margin-top:.1rem;
    padding:.55rem .65rem;background:rgba(255,255,255,.02);border-radius:7px;
    border-left:2px solid ${af.couleur}44">${_esc(n.description)}</div>` : ''}
</div>
  </div>`;
}

// Jauge d'affinité groupe (segments cliquables en mode admin)
function _renderAffiniteGroupe(n) {
  const af  = afx(n.affinite?.niveau ?? 2);
  const niv = n.affinite?.niveau ?? 2;

  const segments = AFFINITE.map((a, i) => {
    const filled = i < niv, isCurrent = i === niv;
    const adminAttr = STATE.isAdmin
      ? `onclick="window.npcAffiniteClick('${n.id}',${i})" style="cursor:pointer;flex:1;position:relative"`
      : `style="flex:1;position:relative"`;
    return `<div ${adminAttr}>
      <div style="height:16px;
        border-radius:${i === 0 ? '999px 0 0 999px' : i === 4 ? '0 999px 999px 0' : '0'};
        background:${isCurrent ? a.couleur : filled ? a.couleur + '88' : 'rgba(255,255,255,.06)'};
        border:1px solid ${isCurrent ? a.couleur : filled ? a.couleur + '44' : 'rgba(255,255,255,.08)'};
        transition:all .2s;position:relative;overflow:hidden">
        ${isCurrent ? `<div style="position:absolute;inset:0;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);
          animation:shimmer 2s infinite"></div>` : ''}
      </div>
      <div style="text-align:center;font-size:.55rem;
        color:${isCurrent ? a.couleur : 'var(--text-dim)'};
        font-weight:${isCurrent ? '700' : '400'};margin-top:3px">${a.label}</div>
    </div>`;
  }).join('');

  return `
  <style>
    @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
    @keyframes fadeIn  { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
  </style>
  <div style="background:var(--bg-elevated);border:1px solid var(--border);
    border-radius:12px;padding:.85rem 1rem">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.7rem">
      <div style="font-size:.67rem;font-weight:700;color:var(--text-dim);
        letter-spacing:1.5px;text-transform:uppercase">Affinité du groupe</div>
      ${STATE.isAdmin ? `
      <button onclick="openAffiniteGroupeModal('${n.id}')"
        style="font-size:.67rem;background:rgba(79,140,255,.08);
        border:1px solid rgba(79,140,255,.25);border-radius:6px;
        padding:2px 8px;cursor:pointer;color:var(--gold)">📝 Événement</button>` : ''}
    </div>

    <div style="display:flex;gap:3px;margin-bottom:.6rem">${segments}</div>

    <div style="display:flex;align-items:center;gap:.6rem;padding:.45rem .7rem;
      background:${af.bg};border:1px solid ${af.border};border-radius:8px">
      <span style="font-size:1rem">${af.icon}</span>
      <div style="flex:1">
        <span style="font-size:.84rem;font-weight:700;color:${af.couleur}">${af.label}</span>
        <span style="font-size:.72rem;color:var(--text-dim);margin-left:.4rem">— ${af.desc}</span>
      </div>
    </div>

    ${n.affinite?.note ? `
    <div style="margin-top:.5rem;font-size:.77rem;color:var(--text-muted);font-style:italic;
      padding:.4rem .6rem;border-left:2px solid ${af.couleur}55;line-height:1.6">
      « ${_esc(n.affinite.note)} »</div>` : ''}

    ${STATE.isAdmin ? `
    <div style="margin-top:.4rem;font-size:.61rem;color:var(--text-dim);font-style:italic;
      text-align:right">Clic direct sur un segment pour modifier</div>` : ''}
  </div>`;
}

// Historique des événements
function _renderHistorique(n) {
  const histo = n.affinite?.historique || [];
  if (!histo.length) return '';

  return `
  <div style="background:var(--bg-elevated);border:1px solid var(--border);
    border-radius:12px;padding:.85rem 1rem">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
      <div style="font-size:.67rem;font-weight:700;color:var(--text-dim);
        letter-spacing:1.5px;text-transform:uppercase">Historique</div>
      <span style="font-size:.64rem;color:var(--text-dim)">
        ${histo.length} événement${histo.length > 1 ? 's' : ''}</span>
    </div>

    <div style="display:flex;flex-direction:column;gap:.3rem">
      ${histo.slice(-5).reverse().map((h, reversedIndex) => {
        const realIndex = histo.length - 1 - reversedIndex;
        const d = h.delta || 0;
        const col = d > 0 ? '#22c38e' : d < 0 ? '#ff6b6b' : '#a0aec0';
        const bg  = d > 0 ? 'rgba(34,195,142,.1)' : d < 0 ? 'rgba(255,107,107,.1)' : 'rgba(255,255,255,.04)';

        return `<div style="display:flex;align-items:flex-start;gap:.5rem;
          padding:.35rem .55rem;background:${bg};border-radius:7px">
          
          <span style="width:20px;height:20px;border-radius:50%;background:${col}20;
            border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;
            font-size:.67rem;font-weight:800;color:${col};flex-shrink:0">
            ${d > 0 ? '+' + d : d < 0 ? d : '~'}
          </span>

          <span style="flex:1;font-size:.75rem;color:var(--text-muted);line-height:1.5">
            ${_esc(h.texte || '')}
          </span>

          ${h.date ? `<span style="font-size:.64rem;color:var(--text-dim);
            flex-shrink:0;white-space:nowrap">${h.date}</span>` : ''}

          ${STATE.isAdmin ? `
          <div style="display:flex;gap:.2rem;flex-shrink:0;margin-left:.2rem">
            <button onclick="editHistoriqueEntry('${n.id}', ${realIndex})"
              style="background:none;border:none;cursor:pointer;color:var(--text-dim);
              font-size:.72rem;padding:2px 4px;border-radius:5px;transition:background .1s"
              onmouseover="this.style.background='rgba(255,255,255,.08)'"
              onmouseout="this.style.background='none'">✏️</button>
            <button onclick="deleteHistoriqueEntry('${n.id}', ${realIndex})"
              style="background:none;border:none;cursor:pointer;color:#ff6b6b;
              font-size:.72rem;padding:2px 4px;border-radius:5px;transition:background .1s"
              onmouseover="this.style.background='rgba(255,107,107,.1)'"
              onmouseout="this.style.background='none'">🗑️</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// Chip affinité spécifique — vue admin
function _renderRelationChip(a, npcId) {
  const emoji = _getAffiniteTypeEmoji(a.typeId);
  const color = _getAffiniteTypeColor(a.typeId);
  const label = _getAffiniteTypeLabel(a.typeId, a.typeLabel);
  return `
  <div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;
    background:${color}12;border:1px solid ${color}30;border-radius:10px">
    <span style="font-size:1.25rem;flex-shrink:0;line-height:1">${emoji}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:.82rem;font-weight:700;color:${color}">${_esc(label) || '—'}</div>
      <div style="font-size:.73rem;color:var(--text-dim)">→ ${_esc(a.charNom || '?')}</div>
      ${a.note ? `<div style="font-size:.7rem;color:var(--text-muted);font-style:italic;
        margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${_esc(a.note)}</div>` : ''}
    </div>
    <div style="display:flex;gap:.2rem;flex-shrink:0">
      <button onclick="openAffinitePersoModal('${npcId}','${a.id}')"
        style="background:none;border:none;cursor:pointer;color:var(--text-dim);
        font-size:.72rem;padding:2px 4px;border-radius:5px;transition:background .1s"
        onmouseover="this.style.background='rgba(255,255,255,.08)'"
        onmouseout="this.style.background='none'">✏️</button>
      <button onclick="deleteAffinitePerso('${a.id}')"
        style="background:none;border:none;cursor:pointer;color:#ff6b6b;
        font-size:.72rem;padding:2px 4px;border-radius:5px;transition:background .1s"
        onmouseover="this.style.background='rgba(255,107,107,.1)'"
        onmouseout="this.style.background='none'">🗑️</button>
    </div>
  </div>`;
}

// Chip affinité spécifique — vue joueur
function _renderRelationChipPlayer(a) {
  const emoji = _getAffiniteTypeEmoji(a.typeId);
  const color = _getAffiniteTypeColor(a.typeId);
  const label = _getAffiniteTypeLabel(a.typeId, a.typeLabel);
  return `
  <div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;
    background:${color}12;border:1px solid ${color}30;border-radius:10px">
    <span style="font-size:1.25rem;flex-shrink:0;line-height:1">${emoji}</span>
    <div style="flex:1">
      <div style="font-size:.82rem;font-weight:700;color:${color}">${_esc(label) || '—'}</div>
      ${a.note ? `<div style="font-size:.71rem;color:var(--text-muted);font-style:italic;
        margin-top:1px">${_esc(a.note)}</div>` : ''}
    </div>
  </div>`;
}

// Panneau des relations (colonne droite)
function _renderRelationsPanel(n) {
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars   = (STATE.characters || []).filter(c => c.uid === STATE.user?.uid);
  const myAffi    = persoList.filter(a => myChars.some(c => c.id === a.charId));

  if (STATE.isAdmin) {
    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);
      border-radius:12px;padding:.85rem .9rem;display:flex;flex-direction:column;gap:.5rem;
      max-height:400px">

      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:.67rem;font-weight:700;color:var(--text-dim);
          letter-spacing:1.5px;text-transform:uppercase">Affinités spécifiques</div>
        <button onclick="openAffiniteTypesManager()"
          style="font-size:.63rem;background:none;border:none;cursor:pointer;
          color:var(--text-dim);padding:2px 4px">⚙️ Types</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:.38rem;
        overflow-y:auto;overflow-x:hidden;min-height:0;flex:1;padding-right:.2rem">
        ${persoList.length
          ? persoList.map(a => _renderRelationChip(a, n.id)).join('')
          : `<div style="font-size:.74rem;color:var(--text-dim);font-style:italic;
              text-align:center;padding:.35rem 0">Aucune affinité spécifique</div>`}
      </div>

      <div style="padding-top:.2rem;border-top:1px solid rgba(255,255,255,.05)">
        <button onclick="openAffinitePersoModal('${n.id}')"
          style="width:100%;padding:.55rem;background:rgba(79,140,255,.06);
          border:1px dashed rgba(79,140,255,.3);border-radius:9px;cursor:pointer;
          font-size:.74rem;color:var(--gold);transition:background .15s;text-align:center"
          onmouseover="this.style.background='rgba(79,140,255,.12)'"
          onmouseout="this.style.background='rgba(79,140,255,.06)'">
          ➕ Ajouter une affinité
        </button>
      </div>
    </div>`;
  }

  if (!myAffi.length) return '';
  return `
  <div style="background:rgba(79,140,255,.06);border:1px solid rgba(79,140,255,.2);
    border-radius:12px;padding:.85rem .9rem">
    <div style="font-size:.67rem;font-weight:700;color:var(--gold);
      letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.5rem">
      ✨ Ta relation avec ce PNJ</div>
    <div style="display:flex;flex-direction:column;gap:.38rem">
      ${myAffi.map(a => _renderRelationChipPlayer(a)).join('')}
    </div>
  </div>`;
}

// Fiche principale assemblée
function _renderFiche(n) {
  const relationsHtml = _renderRelationsPanel(n);
  const hasRightPanel = !!relationsHtml;

  return `
  <div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);overflow:hidden">

    <!-- Header : portrait (si image) + identité + description -->
    <div style="border-bottom:1px solid var(--border)">
      ${_renderFicheHeader(n)}
    </div>

    <!-- Corps -->
    <div style="display:grid;grid-template-columns:${hasRightPanel ? '1fr 300px' : '1fr'};align-items:start">

      <!-- Gauche -->
      <div style="padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.75rem;
        ${hasRightPanel ? 'border-right:1px solid var(--border);' : ''}
        min-width:0">
        ${_renderStatsPanel(n)}
        ${_renderAffiniteGroupe(n)}
        ${_renderHistorique(n)}
      </div>

      <!-- Droite -->
      ${hasRightPanel ? `
      <div style="padding:1rem .9rem;min-width:0">
        ${relationsHtml}
      </div>` : ''}
    </div>
  </div>`;
}

function _renderEmpty() {
  return `
  <div style="background:var(--bg-card);border:1px solid var(--border);
    border-radius:var(--radius-lg);padding:4rem 2rem;text-align:center">
    <div style="font-size:3rem;margin-bottom:1rem;opacity:.3">👥</div>
    <p style="color:var(--text-dim);font-style:italic">
      ${STATE.isAdmin ? 'Aucun PNJ. Cliquez sur + pour en créer un.' : 'Aucun PNJ disponible.'}</p>
    ${STATE.isAdmin ? `<button onclick="openNpcModal()" class="btn btn-gold btn-sm"
      style="margin-top:1rem">+ Créer le premier PNJ</button>` : ''}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getFiltered() {
  return _npcs.filter(n => {
    if (_filterSearch) {
      const s = _filterSearch.toLowerCase();
      return (n.nom || '').toLowerCase().includes(s) || (n.role || '').toLowerCase().includes(s);
    }
    return true;
  });
}

// ── Sélection & filtres ───────────────────────────────────────────────────────
window.selectNpc = (id) => {
  _activeId = id;

  _refreshList();
  _refreshActivePanel();
};

window._npcSearch = (val) => { _filterSearch = val; _refreshList(); };

function _refreshList() {
  const list = document.getElementById('npc-list-items');
  if (!list) { renderNpcs(); return; }
  list.innerHTML = _buildListHtml();
}

// ── Groupement par organisation (catégories repliables) ──────────────────────
let _collapsedOrgs = new Set();
const NO_ORG_KEY = '__no_org__';

function _groupNpcsByOrg(npcs) {
  // Map<orgName, npc[]> — préserve l'ordre des _organisations connues, "Sans
  // organisation" en dernier. Les NPCs avec plusieurs orgs apparaissent dans
  // chaque groupe correspondant.
  const groups = new Map();
  _organisations.forEach(o => groups.set(o.name, []));
  npcs.forEach(n => {
    const orgs = (Array.isArray(n.organisations) ? n.organisations : []).filter(Boolean);
    if (!orgs.length) return; // traité ci-dessous
    orgs.forEach(orgName => {
      if (!groups.has(orgName)) groups.set(orgName, []); // org orpheline (renommée/supprimée)
      groups.get(orgName).push(n);
    });
  });
  // "Sans organisation" toujours en dernier.
  groups.set(NO_ORG_KEY, npcs.filter(n =>
    !Array.isArray(n.organisations) || !n.organisations.filter(Boolean).length
  ));
  return groups;
}

function _renderNpcOrgGroup(orgName, npcs) {
  const isNoOrg   = orgName === NO_ORG_KEY;
  const label     = isNoOrg ? 'Sans organisation' : orgName;
  const collapsed = _collapsedOrgs.has(orgName);
  const chev      = collapsed ? '▸' : '▾';
  const safeKey   = _esc(orgName);
  const header = `<button type="button" data-org-key="${safeKey}"
    onclick="window._npcToggleOrgGroup(this)"
    style="display:flex;align-items:center;justify-content:space-between;width:100%;
    padding:.5rem .85rem;background:rgba(255,255,255,.03);border:none;
    border-top:1px solid var(--border);cursor:pointer;color:var(--text-muted);
    font-size:.74rem;text-align:left">
    <span style="display:flex;align-items:center;gap:.5rem">
      <span style="font-size:.65rem;width:10px;display:inline-block">${chev}</span>
      <span style="font-weight:600">${isNoOrg ? '👤' : '🏛️'} ${_esc(label)}</span>
    </span>
    <span style="font-size:.68rem;color:var(--text-dim);background:rgba(255,255,255,.05);
      border-radius:999px;padding:1px 8px">${npcs.length}</span>
  </button>`;
  const items = collapsed ? '' : npcs.map(n => _renderNavItem(n)).join('');
  return `<div class="npc-org-group">${header}${items}</div>`;
}

function _buildListHtml(filtered = _getFiltered()) {
  if (filtered.length === 0) {
    return `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);
        font-size:.8rem;font-style:italic">Aucun PNJ trouvé</div>`;
  }
  const groups = _groupNpcsByOrg(filtered);
  return [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([orgName, items]) => _renderNpcOrgGroup(orgName, items))
    .join('');
}

window._npcToggleOrgGroup = (btn) => {
  const key = btn?.dataset?.orgKey;
  if (key == null) return;
  if (_collapsedOrgs.has(key)) _collapsedOrgs.delete(key);
  else _collapsedOrgs.add(key);
  _refreshList();
};

// ── Interaction : segment d'affinité groupe (1 clic, admin) ──────────────────
window.npcAffiniteClick = async (npcId, niveau) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;
  const affinite = { ...n.affinite, niveau };
  await updateInCol('npcs', npcId, { affinite });
  const idx = _npcs.findIndex(x => x.id === npcId);
  if (idx >= 0) _npcs[idx] = { ..._npcs[idx], affinite };
  showNotif(`Affinité → ${afx(niveau).label}`, 'success');
  _refreshList();
  _refreshActivePanel();
};

// ── Stats : rendu (modale + fiche) ───────────────────────────────────────────
function _renderStatsForm(npc) {
  if (!STATE.isAdmin) return '';
  const stats = npc?.stats || {};
  const vitalInputs = NPC_VITALS.map(v => `
    <div>
      <label style="font-size:.66rem;color:var(--text-dim);display:block;margin-bottom:2px;
        text-align:center;font-weight:600">${v.icon} ${v.label}</label>
      <input type="number" class="input-sm" id="npc-${v.key}" value="${npc?.[v.key] ?? ''}"
        placeholder="—" style="text-align:center;padding:.35rem .25rem;width:100%">
    </div>`).join('');
  const statInputs = NPC_STATS.map(s => `
    <div>
      <label style="font-size:.62rem;color:var(--text-dim);display:block;margin-bottom:2px;
        text-align:center;font-weight:700;letter-spacing:.04em">${s.short}</label>
      <input type="number" class="input-sm" id="npc-stat-${s.key}" value="${stats[s.key] ?? ''}"
        placeholder="8" style="text-align:center;padding:.35rem .25rem;width:100%">
    </div>`).join('');
  return `
    <div class="form-group" style="margin-top:.75rem;background:rgba(255,255,255,.02);
      border:1px dashed var(--border);border-radius:10px;padding:.65rem .75rem">
      <label style="display:flex;align-items:center;gap:.4rem">
        🛡️ Combat &amp; stats
        <span style="color:var(--text-dim);font-weight:400;font-size:.78rem">(admin)</span>
      </label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;margin-top:.4rem">${vitalInputs}</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.35rem;margin-top:.5rem">${statInputs}</div>
    </div>`;
}

function _renderStatsPanel(n) {
  if (!STATE.isAdmin) return '';
  const stats = n?.stats || {};
  const hasVitals = NPC_VITALS.some(v => n?.[v.key] != null);
  const hasStats  = NPC_STATS.some(s => stats[s.key] != null);
  if (!hasVitals && !hasStats) return '';

  const vitals = NPC_VITALS.map(v => `
    <div style="background:var(--bg-elevated);border:1px solid var(--border);
      border-radius:8px;padding:.45rem .35rem;text-align:center">
      <div style="font-size:.6rem;color:var(--text-dim);font-weight:600;letter-spacing:.04em">${v.icon} ${v.label}</div>
      <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:2px">${n?.[v.key] ?? '—'}</div>
    </div>`).join('');
  const statCells = NPC_STATS.map(s => {
    const score = stats[s.key];
    return `
    <div style="background:var(--bg-elevated);border:1px solid var(--border);
      border-radius:8px;padding:.4rem .25rem;text-align:center">
      <div style="font-size:.6rem;color:var(--text-dim);font-weight:700;letter-spacing:.04em">${s.short}</div>
      <div style="font-size:.95rem;font-weight:700;color:var(--text)">${score ?? '—'}</div>
      <div style="font-size:.62rem;color:var(--text-muted)">${score != null ? _modStr(score) : ''}</div>
    </div>`;
  }).join('');

  return `
    <div style="border:1px dashed var(--border);border-radius:10px;padding:.65rem .75rem;
      background:rgba(255,255,255,.02)">
      <div style="font-size:.74rem;color:var(--text-muted);font-weight:600;margin-bottom:.5rem;
        display:flex;align-items:center;gap:.4rem">
        🛡️ Combat &amp; stats
        <span style="font-size:.62rem;color:var(--text-dim);font-weight:400">(admin)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem">${vitals}</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.35rem;margin-top:.5rem">${statCells}</div>
    </div>`;
}

// ── Vue MJ : tableau condensé de tous les PNJ avec stats ────────────────────
const _mjVitalCellInner = (v) => v == null ? '—' : String(v);
const _mjStatCellInner  = (s) => s == null ? '—'
  : `${s}<br><span style="font-size:.6rem;color:var(--text-muted)">${_modStr(s)}</span>`;

function _renderMjStatsRow(n) {
  const af    = afx(n.affinite?.niveau ?? 2);
  const stats = n.stats || {};

  const vitalCells = NPC_VITALS.map(v => `
    <td data-mj-cell="${n.id}-${v.key}"
      onclick="window._mjEditField('${n.id}','${v.key}')"
      title="Cliquer pour modifier ${v.label}"
      style="cursor:pointer;text-align:center;padding:.4rem .25rem;font-weight:700;
      color:${n[v.key] == null ? 'var(--text-dim)' : 'var(--text)'};
      background:rgba(232,184,75,.05)">${_mjVitalCellInner(n[v.key])}</td>`).join('');

  const statCells = NPC_STATS.map(s => `
    <td data-mj-cell="${n.id}-stats.${s.key}"
      onclick="window._mjEditField('${n.id}','stats.${s.key}')"
      title="Cliquer pour modifier ${s.short}"
      style="cursor:pointer;text-align:center;padding:.4rem .2rem;line-height:1.1;
      color:${stats[s.key] == null ? 'var(--text-dim)' : 'var(--text)'};
      background:rgba(232,184,75,.05)">${_mjStatCellInner(stats[s.key])}</td>`).join('');

  return `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)"
      onmouseover="this.style.background='rgba(255,255,255,.02)'"
      onmouseout="this.style.background='transparent'">
      <td style="padding:.35rem;text-align:left;cursor:pointer;color:var(--text);
        max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
        onclick="window._mjOpenNpc('${n.id}')" title="Ouvrir la fiche">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;
          background:${af.couleur};margin-right:.4rem;vertical-align:middle"></span>
        <strong>${_esc(n.nom || '?')}</strong>
      </td>
      ${vitalCells}
      ${statCells}
    </tr>`;
}

let _mjFilter = '';

function _mjFilteredNpcs() {
  const q = _mjFilter.trim().toLowerCase();
  if (!q) return _npcs;
  return _npcs.filter(n => {
    if ((n.nom || '').toLowerCase().includes(q)) return true;
    const orgs = Array.isArray(n.organisations) ? n.organisations : [];
    return orgs.some(o => (o || '').toLowerCase().includes(q));
  });
}

function _renderMjStatsTbody() {
  const list = _mjFilteredNpcs();
  if (!list.length) {
    return `<tr><td colspan="${1 + NPC_VITALS.length + NPC_STATS.length}"
      style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">
      ${_npcs.length ? `Aucun PNJ pour « ${_esc(_mjFilter)} »` : 'Aucun PNJ'}</td></tr>`;
  }
  return list.map(_renderMjStatsRow).join('');
}

window._mjStatsFilter = (val) => {
  _mjFilter = val || '';
  const tbody = document.querySelector('#mj-stats-table tbody');
  if (tbody) tbody.innerHTML = _renderMjStatsTbody();
};

function _openMjStatsView() {
  if (!STATE.isAdmin) return;
  _mjFilter = '';

  openModal('📊 Stats des PNJ', `
    <input id="mj-stats-search" class="input-field"
      placeholder="🔍 Rechercher par nom ou organisation…"
      oninput="window._mjStatsFilter(this.value)"
      style="font-size:.85rem;padding:.45rem .7rem;margin-bottom:.65rem">
    <div style="overflow-x:auto;margin:0 -.5rem">
      <table id="mj-stats-table" style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--text-muted)">
            <th style="text-align:left;padding:.4rem .35rem;font-weight:600">PNJ</th>
            ${NPC_VITALS.map(v =>
              `<th style="text-align:center;padding:.4rem .25rem;font-weight:600;width:42px"
                title="${v.label}">${v.icon}</th>`).join('')}
            ${NPC_STATS.map(s =>
              `<th style="text-align:center;padding:.4rem .2rem;font-weight:700;width:34px;
                font-size:.68rem;letter-spacing:.04em">${s.short}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${_renderMjStatsTbody()}</tbody>
      </table>
    </div>
    <div style="margin-top:.65rem;font-size:.7rem;color:var(--text-dim);font-style:italic;text-align:center">
      Clic sur n'importe quelle valeur pour la modifier (Entrée = valider, Échap = annuler) <br> • Clic sur le nom d'un PNJ pour ouvrir sa fiche
    </div>
  `);
}

function _restoreMjStatsModal() {
  const search = document.getElementById('mj-stats-search');
  if (search) search.value = _mjFilter;
  const tbody = document.querySelector('#mj-stats-table tbody');
  if (tbody) tbody.innerHTML = _renderMjStatsTbody();
}

window._openMjStatsView = _openMjStatsView;

window._mjOpenNpc = (id) => {
  openNpcModal(id, { stackedFromMjStats: true });
};

window._mjEditField = (id, field) => {
  const cell = document.querySelector(`[data-mj-cell="${id}-${field}"]`);
  if (!cell) return;

  const isStat   = field.startsWith('stats.');
  const statKey  = isStat ? field.slice(6) : null;
  const renderInner = isStat ? _mjStatCellInner : _mjVitalCellInner;
  const prevHtml = cell.innerHTML;

  const npc  = _npcs.find(n => n.id === id);
  const prev = isStat ? (npc?.stats || {})[statKey] : npc?.[field];

  const input = document.createElement('input');
  input.type  = 'number';
  input.value = prev ?? '';
  input.style.cssText = 'width:42px;text-align:center;background:var(--bg-elevated);'
    + 'border:1px solid var(--gold);color:var(--text);border-radius:4px;'
    + 'padding:1px 3px;font-size:.85rem;outline:none';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const setCellContent = (val) => {
    cell.innerHTML = renderInner(val);
    cell.style.color = val == null ? 'var(--text-dim)' : 'var(--text)';
  };

  let cancelled = false;
  const save = async () => {
    if (cancelled) return;
    cancelled = true;
    const raw = input.value.trim();
    const v   = raw === '' ? null : parseInt(raw, 10);
    const newVal = (raw === '' || !Number.isFinite(v)) ? null : v;
    try {
      await updateInCol('npcs', id, { [field]: newVal });
      const idx = _npcs.findIndex(n => n.id === id);
      if (idx >= 0) {
        if (isStat) {
          _npcs[idx] = {
            ..._npcs[idx],
            stats: { ...(_npcs[idx].stats || {}), [statKey]: newVal },
          };
        } else {
          _npcs[idx] = { ..._npcs[idx], [field]: newVal };
        }
      }
      setCellContent(newVal);
      if (_activeId === id) _refreshActivePanel();
    } catch (e) {
      console.error('[mj edit]', e);
      showNotif('Erreur de sauvegarde.', 'error');
      cell.innerHTML = prevHtml;
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { cancelled = true; cell.innerHTML = prevHtml; input.blur(); }
  });
};

// ── Modal création / édition PNJ ──────────────────────────────────────────────
function openNpcModal(id = null, { stackedFromMjStats = false } = {}) {
  const npc = id ? _npcs.find(n => n.id === id) : null;
  const open = stackedFromMjStats ? pushModal : openModal;

  open(npc ? `✏️ Modifier — ${_esc(npc.nom || 'PNJ')}` : '👥 Nouveau PNJ', `
    <div class="grid-2" style="gap:.8rem">
      <div class="form-group" style="margin:0">
        <label>Nom</label>
        <input class="input-field" id="npc-nom" value="${_esc(npc?.nom || '')}" placeholder="Aldric le Forgeron">
      </div>
      <div class="form-group" style="margin:0">
        <label>Rôle</label>
        <input class="input-field" id="npc-role" value="${_esc(npc?.role || '')}" placeholder="Forgeron, Garde…">
      </div>
    </div>
    <div class="form-group" style="margin-top:.75rem">
      <label>Lieu</label>
      ${autocompleteHTML({ id: 'npc-lieu', value: npc?.lieu || '', placeholder: 'Taverne du Dragon…' })}
    </div>
    <div class="form-group" style="margin-top:.75rem">
      <label>Organisations</label>
      ${multiAutocompleteHTML({ id: 'npc-orgs', placeholder: _organisations.length ? 'Ajouter une organisation…' : 'Aucune organisation en base — texte libre' })}
    </div>
    <div class="form-group" style="margin-top:.75rem">
      <label>Description</label>
      <textarea class="input-field" id="npc-desc" rows="4"
        placeholder="Apparence, personnalité, secrets…">${_esc(npc?.description || '')}</textarea>
    </div>
    ${_renderStatsForm(npc)}
    <div class="form-group" style="margin-top:.75rem">
      <label>Portrait <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
      <div id="npc-img-drop" style="border:2px dashed var(--border-strong);border-radius:10px;
        padding:.85rem;text-align:center;cursor:pointer;background:var(--bg-elevated)">
        <div id="npc-img-preview">
          ${npc?.imageUrl
            ? `<img src="${npc.imageUrl}" style="max-height:70px;border-radius:50%;
                aspect-ratio:1;object-fit:cover;border:2px solid var(--border-bright)">`
            : `<div style="font-size:1.5rem;margin-bottom:3px">🖼️</div>
               <div style="font-size:.75rem;color:var(--text-muted)">
                 <span style="color:var(--gold)">Cliquer</span> ou glisser une image</div>`}
        </div>
      </div>
      <div id="npc-crop-wrap" style="display:none;margin-top:.6rem">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.35rem">
          Recadrez — ratio 1:1</div>
        <canvas id="npc-crop-canvas" style="display:block;width:100%;border-radius:8px;
          cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" style="width:100%;margin-top:.4rem"
          onclick="window._npcConfirmCrop()">✂️ Confirmer</button>
        <div id="npc-crop-ok" style="display:none;font-size:.72rem;
          text-align:center;margin-top:3px;color:var(--green)"></div>
      </div>
      ${npc?.imageUrl ? `<button type="button" onclick="window._npcClearImg()"
        style="margin-top:.3rem;font-size:.72rem;background:none;border:none;
        cursor:pointer;color:#ff6b6b">✕ Retirer l'image</button>` : ''}
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1"
        onclick="saveNpc('${npc?.id || ''}')">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `, stackedFromMjStats ? _restoreMjStatsModal : null);

  // ── Autocomplete Lieu + Organisations ─────────────────────────────────────
  initAutocomplete('npc-lieu', _places.map(p => p.name));
  initMultiAutocomplete('npc-orgs', _organisations.map(o => o.name), {
    initialValues: Array.isArray(npc?.organisations) ? npc.organisations : [],
  });

  // ── Setup upload + crop portrait ──────────────────────────────────────────
  let _npcCropBase64 = null;
  const npcFileInput = document.createElement('input');
  npcFileInput.type = 'file'; npcFileInput.accept = 'image/*';
  npcFileInput.style.cssText = 'position:absolute;opacity:0;width:0;height:0';
  document.body.appendChild(npcFileInput);

  const handleNpcFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = (e) => _initNpcCrop(e.target.result);
    r.readAsDataURL(file);
  };

  npcFileInput.addEventListener('change', () => handleNpcFile(npcFileInput.files[0]));
  const npcDrop = document.getElementById('npc-img-drop');
  npcDrop?.addEventListener('click', () => npcFileInput.click());
  npcDrop?.addEventListener('dragover', e => { e.preventDefault(); npcDrop.style.borderColor = 'var(--gold)'; });
  npcDrop?.addEventListener('dragleave', () => { npcDrop.style.borderColor = 'var(--border-strong)'; });
  npcDrop?.addEventListener('drop', e => {
    e.preventDefault(); npcDrop.style.borderColor = 'var(--border-strong)';
    handleNpcFile(e.dataTransfer.files[0]);
  });

  const npcObs = new MutationObserver(() => {
    if (!document.getElementById('npc-img-drop')) { npcFileInput.remove(); npcObs.disconnect(); }
  });
  npcObs.observe(document.body, { childList: true, subtree: true });

  // Crop 1:1
  let _npcCrop = {
    img: null, cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    startX: 0, startY: 0, isDragging: false, isResizing: false,
    handle: null, natW: 0, natH: 0, dispScale: 1,
  };
  const _nc = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function _initNpcCrop(dataUrl) {
    const wrap = document.getElementById('npc-crop-wrap');
    const canvas = document.getElementById('npc-crop-canvas');
    if (!wrap || !canvas) return;
    wrap.style.display = 'block';
    document.getElementById('npc-crop-ok').style.display = 'none';
    const img = new Image();
    img.onload = () => {
      _npcCrop.img = img; _npcCrop.natW = img.naturalWidth; _npcCrop.natH = img.naturalHeight;
      const maxW = Math.min(400, img.naturalWidth);
      _npcCrop.dispScale = maxW / img.naturalWidth;
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.style.width  = maxW + 'px';
      canvas.style.height = Math.round(img.naturalHeight * _npcCrop.dispScale) + 'px';
      const sq = Math.min(img.naturalWidth, img.naturalHeight);
      _npcCrop.cropX = Math.round((img.naturalWidth  - sq) / 2);
      _npcCrop.cropY = Math.round((img.naturalHeight - sq) / 2);
      _npcCrop.cropW = sq; _npcCrop.cropH = sq;
      _drawNpcCrop(); _bindNpcCrop(canvas);
      const prev = document.getElementById('npc-img-preview');
      if (prev) prev.innerHTML = `<img src="${dataUrl}" style="max-height:50px;border-radius:50%;opacity:.6">
        <div style="font-size:.68rem;color:var(--text-dim);margin-top:3px">Recadrez ci-dessous</div>`;
    };
    img.src = dataUrl;
  }

  function _npcHandles() {
    const { cropX: x, cropY: y, cropW: w } = _npcCrop;
    return [{ id: 'nw', x, y }, { id: 'ne', x: x + w, y }, { id: 'sw', x, y: y + w }, { id: 'se', x: x + w, y: y + w }];
  }
  function _npcHitH(nx, ny) {
    const tol = 9 / _npcCrop.dispScale;
    return _npcHandles().find(h => Math.abs(h.x - nx) < tol && Math.abs(h.y - ny) < tol) || null;
  }
  function _drawNpcCrop() {
    const canvas = document.getElementById('npc-crop-canvas'); if (!canvas || !_npcCrop.img) return;
    const ctx = canvas.getContext('2d'), { img, natW, natH, cropX, cropY, cropW, cropH } = _npcCrop;
    ctx.clearRect(0, 0, natW, natH); ctx.drawImage(img, 0, 0, natW, natH);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, natW, natH);
    ctx.drawImage(img, cropX, cropY, cropW, cropH, cropX, cropY, cropW, cropH);
    ctx.save(); ctx.beginPath();
    ctx.arc(cropX + cropW / 2, cropY + cropH / 2, cropW / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'var(--gold)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'var(--gold)'; ctx.strokeStyle = '#0b1118'; ctx.lineWidth = 1.5;
    _npcHandles().forEach(h => { ctx.fillRect(h.x - 5, h.y - 5, 10, 10); ctx.strokeRect(h.x - 5, h.y - 5, 10, 10); });
  }
  function _npcToN(c, cx, cy) {
    const r = c.getBoundingClientRect();
    return { x: (cx - r.left) / _npcCrop.dispScale, y: (cy - r.top) / _npcCrop.dispScale };
  }
  function _bindNpcCrop(canvas) {
    const MIN = 40;
    const onStart = (cx, cy) => {
      const { x, y } = _npcToN(canvas, cx, cy), h = _npcHitH(x, y);
      if (h) { _npcCrop.isResizing = true; _npcCrop.handle = h.id; }
      else {
        const { cropX, cropY, cropW } = _npcCrop;
        if (x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropW) {
          _npcCrop.isDragging = true; _npcCrop.startX = x - cropX; _npcCrop.startY = y - cropY;
        }
      }
    };
    const onMove = (cx, cy) => {
      if (!_npcCrop.isDragging && !_npcCrop.isResizing) return;
      const { x, y } = _npcToN(canvas, cx, cy), { natW: W, natH: H } = _npcCrop;
      if (_npcCrop.isDragging) {
        _npcCrop.cropX = Math.round(_nc(x - _npcCrop.startX, 0, W - _npcCrop.cropW));
        _npcCrop.cropY = Math.round(_nc(y - _npcCrop.startY, 0, H - _npcCrop.cropH));
        _drawNpcCrop(); return;
      }
      const { cropX, cropY, cropW, handle } = _npcCrop;
      const a = { x: cropX, y: cropY, x2: cropX + cropW, y2: cropY + cropW };
      const newW = handle === 'se' || handle === 'ne'
        ? _nc(x - a.x, MIN, Math.min(W - a.x, H - a.y))
        : _nc(a.x2 - x, MIN, Math.min(a.x2, a.y2));
      if (handle === 'sw' || handle === 'nw') _npcCrop.cropX = Math.round(a.x2 - newW);
      if (handle === 'nw' || handle === 'ne') _npcCrop.cropY = Math.round(a.y2 - newW);
      _npcCrop.cropW = Math.round(newW); _npcCrop.cropH = Math.round(newW); _drawNpcCrop();
    };
    const onEnd = () => { _npcCrop.isDragging = false; _npcCrop.isResizing = false; _npcCrop.handle = null; };
    canvas.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    canvas.addEventListener('touchend', onEnd);
  }

  window._npcConfirmCrop = () => {
    const { img, cropX, cropY, cropW, cropH } = _npcCrop; if (!img) return;
    const sz = Math.min(400, cropW);
    const out = document.createElement('canvas'); out.width = sz; out.height = sz;
    out.getContext('2d').drawImage(img, cropX, cropY, cropW, cropH, 0, 0, sz, sz);
    _npcCropBase64 = out.toDataURL('image/jpeg', .88);
    document.getElementById('npc-crop-wrap').style.display = 'none';
    const ok = document.getElementById('npc-crop-ok');
    if (ok) { ok.style.display = 'block'; ok.textContent = `✓ Portrait prêt (${Math.round(_npcCropBase64.length / 1024)} KB)`; }
    const prev = document.getElementById('npc-img-preview');
    if (prev) prev.innerHTML = `<img src="${_npcCropBase64}" style="max-height:70px;border-radius:50%;aspect-ratio:1;object-fit:cover;border:2px solid var(--gold)">`;
    window._pendingNpcImg = _npcCropBase64;
  };

  window._npcClearImg = () => {
    window._pendingNpcImg  = '';
    window._npcImgCleared  = true;
    const prev = document.getElementById('npc-img-preview');
    if (prev) prev.innerHTML = `<div style="font-size:1.5rem;margin-bottom:3px">🖼️</div>
      <div style="font-size:.75rem;color:var(--text-muted)"><span style="color:var(--gold)">Cliquer</span> ou glisser</div>`;
    document.getElementById('npc-crop-wrap').style.display = 'none';
  };

  window._pendingNpcImg  = null;
  window._npcImgCleared  = false;
}

// ── Sauvegarde / suppression PNJ ─────────────────────────────────────────────
async function saveNpc(id) {
  try {
    let imageUrl = '';
    if (window._pendingNpcImg !== null && window._pendingNpcImg !== undefined) {
      imageUrl = window._pendingNpcImg;
    } else if (id && !window._npcImgCleared) {
      imageUrl = _npcs.find(n => n.id === id)?.imageUrl || '';
    }
    window._pendingNpcImg = null;
    window._npcImgCleared = false;

    const data = {
      nom:           document.getElementById('npc-nom')?.value?.trim()  || '?',
      role:          document.getElementById('npc-role')?.value?.trim() || '',
      lieu:          document.getElementById('npc-lieu')?.value?.trim() || '',
      organisations: getMultiAutocompleteValues('npc-orgs'),
      description:   document.getElementById('npc-desc')?.value?.trim() || '',
      imageUrl,
    };

    if (STATE.isAdmin) {
      NPC_VITALS.forEach(v => { data[v.key] = _readNumberOrNull(`npc-${v.key}`); });
      const stats = {};
      NPC_STATS.forEach(s => {
        const v = _readNumberOrNull(`npc-stat-${s.key}`);
        if (v != null) stats[s.key] = v;
      });
      data.stats = Object.keys(stats).length ? stats : null;
    }

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
    _refreshActivePanel();
    _refreshList();
  } catch (e) {
    console.error('[saveNpc]', e);
    showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

async function deleteNpc(id) {
  try {
    if (!await confirmModal('Supprimer ce PNJ et toutes ses affinités ?')) return;
    await deleteFromCol('npcs', id);
    const toDelete = _affiPerso.filter(a => a.npcId === id);
    await Promise.all(toDelete.map(a => deleteFromCol('npc_affinites', a.id)));
    _npcs      = _npcs.filter(n => n.id !== id);
    _affiPerso = _affiPerso.filter(a => a.npcId !== id);
    if (_activeId === id) _activeId = _npcs[0]?.id || null;
    showNotif('PNJ supprimé.', 'success');
    _renderPage(document.getElementById('main-content'));
  } catch (e) {
    console.error('[deleteNpc]', e);
    showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ── Modal affinité groupe (événement & note) ──────────────────────────────────
window.openAffiniteGroupeModal = (npcId) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n) return;
  const cur     = n.affinite?.niveau ?? 2;
  const curNote = n.affinite?.note   || '';

  const niveauBtns = AFFINITE.map(a => `
    <button type="button" id="afg-btn-${a.niveau}"
      onclick="window._selectAfgNiveau(${a.niveau})"
      style="flex:1;padding:.5rem .3rem;border-radius:8px;cursor:pointer;transition:all .15s;
      font-size:.78rem;font-weight:${cur === a.niveau ? '700' : '400'};
      border:2px solid ${cur === a.niveau ? a.couleur : 'var(--border)'};
      background:${cur === a.niveau ? a.bg : 'var(--bg-elevated)'};
      color:${cur === a.niveau ? a.couleur : 'var(--text-dim)'}">
      <div style="font-size:1rem;margin-bottom:2px">${a.icon}</div>${a.label}
    </button>`).join('');

  openModal(`📝 Événement & Note — ${_esc(n.nom)}`, `
    <input type="hidden" id="afg-niveau" value="${cur}">

    <div class="form-group">
      <label>Niveau d'affinité</label>
      <div style="display:flex;gap:.4rem">${niveauBtns}</div>
    </div>
    <div class="form-group">
      <label>Note <span style="color:var(--text-dim);font-weight:400">(visible par tous)</span></label>
      <textarea class="input-field" id="afg-note" rows="3"
        placeholder="Ex: A aidé lors de la défense de la ville…">${_esc(curNote)}</textarea>
    </div>
    <div class="form-group">
      <label>Événement <span style="color:var(--text-dim);font-weight:400">(ajouté à l'historique)</span></label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <div style="display:flex;gap:.25rem;flex-shrink:0">
          ${[-2, -1, 0, 1, 2].map(v => `<button type="button" id="afg-delta-${v}"
            onclick="window._selectAfgDelta(${v})"
            style="width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:.8rem;
            font-weight:700;transition:all .12s;
            border:1px solid ${v < 0 ? 'rgba(255,107,107,.3)' : v > 0 ? 'rgba(34,195,142,.3)' : 'var(--border)'};
            background:var(--bg-elevated);
            color:${v < 0 ? '#ff6b6b' : v > 0 ? '#22c38e' : 'var(--text-dim)'}">${v > 0 ? '+' + v : v}</button>`).join('')}
        </div>
        <input class="input-field" id="afg-event"
          placeholder="Ex: A trahi la compagnie lors de…" style="flex:1">
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
    btn.style.borderColor = active ? a.couleur : 'var(--border)';
    btn.style.background  = active ? a.bg      : 'var(--bg-elevated)';
    btn.style.color       = active ? a.couleur : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '700'     : '400';
  });
};

window._selectAfgDelta = (v) => {
  window._afgDelta = v;
  [-2, -1, 0, 1, 2].forEach(d => {
    const btn = document.getElementById(`afg-delta-${d}`);
    if (!btn) return;
    const active = d === v;
    btn.style.background  = active
      ? (d < 0 ? 'rgba(255,107,107,.18)' : d > 0 ? 'rgba(34,195,142,.18)' : 'rgba(255,255,255,.1)')
      : 'var(--bg-elevated)';
    btn.style.borderWidth = active ? '2px' : '1px';
  });
};

window.saveAffiniteGroupe = async (npcId) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n) return;
  const niveau   = parseInt(document.getElementById('afg-niveau')?.value) ?? 2;
  const note     = document.getElementById('afg-note')?.value?.trim()    || '';
  const event    = document.getElementById('afg-event')?.value?.trim()   || '';
  const delta    = window._afgDelta || 0;
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
  _refreshActivePanel();
  _refreshList();
};

// ══ Gestionnaire des affinités spécifiques ════════════════════════════════════
// Formulaire inline — pas de push modal enfant

function _aftEmojiGrid(selectedEmoji) {
  return EMOJI_PRESET.map(e => `
    <button type="button" data-emoji="${e}" onclick="window._aftSelectEmoji('${e}')"
      style="width:34px;height:34px;border-radius:8px;cursor:pointer;font-size:1.15rem;
      transition:all .12s;background:${e === selectedEmoji ? 'rgba(255,255,255,.15)' : 'transparent'};
      border:1px solid ${e === selectedEmoji ? 'var(--gold)' : 'transparent'};
      transform:${e === selectedEmoji ? 'scale(1.15)' : 'scale(1)'}">${e}</button>`
  ).join('');
}

function _aftColorGrid(selectedColor) {
  return TYPE_COLORS.map(hex => `
    <button type="button" data-color="${hex}" onclick="window._aftSelectColor('${hex}')"
      style="width:26px;height:26px;border-radius:7px;cursor:pointer;background:${hex};
      transition:all .12s;
      border:3px solid ${hex === selectedColor ? 'white' : 'transparent'};
      box-shadow:${hex === selectedColor ? `0 0 0 2px ${hex}` : 'none'}"></button>`
  ).join('');
}

function _getAffiniteTypesManagerHtml() {
  const s     = window._aftFormState || { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  const isEdit = !!s.editingId;

  const typesList = _affiniteTypes.length
    ? _affiniteTypes.map(t => {
        const col = t.couleur || TYPE_COLORS[0];
        const isEditing = s.editingId === t.id;
        return `
        <div style="display:flex;align-items:center;gap:.55rem;padding:.5rem .7rem;
          background:${isEditing ? col + '22' : col + '11'};
          border:1px solid ${isEditing ? col + '66' : col + '28'};border-radius:9px;
          transition:all .15s">
          <span style="font-size:1.2rem;flex-shrink:0">${t.emoji || '✨'}</span>
          <span style="flex:1;font-size:.85rem;font-weight:700;color:${col}">${_esc(t.label)}</span>
          <div style="display:flex;gap:.25rem">
            <button type="button" onclick="window._aftEditType('${t.id}')"
              style="background:${isEditing ? col + '33' : 'none'};border:1px solid ${isEditing ? col : 'var(--border)'};
              border-radius:7px;padding:.3rem .5rem;cursor:pointer;
              color:${isEditing ? col : 'var(--text-dim)'};font-size:.72rem">✏️</button>
            <button type="button" onclick="deleteAffiniteType('${t.id}')"
              style="background:none;border:1px solid rgba(255,107,107,.35);border-radius:7px;
              padding:.3rem .5rem;cursor:pointer;color:#ff6b6b;font-size:.72rem">🗑️</button>
          </div>
        </div>`;
      }).join('')
    : `<div style="padding:.75rem;color:var(--text-dim);font-size:.84rem;text-align:center;
        font-style:italic">Aucune affinité spécifique définie.</div>`;

  return `
  <div style="display:flex;flex-direction:column;gap:.85rem">

    <!-- Liste existants -->
    ${_affiniteTypes.length ? `
    <div style="display:flex;flex-direction:column;gap:.35rem;
      max-height:200px;overflow-y:auto;overflow-x:hidden;padding-right:.25rem">
      ${typesList}
    </div>
    <div style="border-top:1px solid var(--border)"></div>` : typesList}

    <!-- Formulaire inline -->
    <div>
      <div style="font-size:.72rem;font-weight:700;color:${isEdit ? 'var(--gold)' : 'var(--text-dim)'};
        text-transform:uppercase;letter-spacing:1px;margin-bottom:.65rem">
        ${isEdit ? `✏️ Modifier — ${_esc(_affiniteTypes.find(t => t.id === s.editingId)?.label || '')}` : '➕ Ajouter un type'}</div>

      <!-- Emoji -->
      <div style="margin-bottom:.55rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Emoji</div>
          <div id="aft-emoji-grid" style="display:flex;flex-wrap:wrap;gap:.25rem;
            background:var(--bg-card);border:1px solid var(--border);
            border-radius:10px;padding:.5rem;
            max-height:132px;overflow-y:auto;overflow-x:hidden">
            ${_aftEmojiGrid(s.emoji)}
          </div>
        <input type="hidden" id="aft-emoji-val" value="${s.emoji}">
      </div>

      <!-- Nom -->
      <div style="margin-bottom:.55rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Nom</div>
        <input class="input-field" id="aft-label" value="${_esc(s.label)}"
          placeholder="Ex: Confident, Rival, Chouchou…"
          style="font-size:.85rem">
      </div>

      <!-- Couleur -->
      <div style="margin-bottom:.7rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Couleur</div>
        <div id="aft-color-grid" style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${_aftColorGrid(s.couleur)}
        </div>
        <input type="hidden" id="aft-color"      value="${s.couleur}">
        <input type="hidden" id="aft-editing-id" value="${s.editingId}">
      </div>

      <!-- Boutons -->
      <div style="display:flex;gap:.4rem">
        <button onclick="window.saveAffiniteType()" class="btn btn-gold"
          style="flex:1;font-size:.8rem">
          ${isEdit ? '💾 Enregistrer' : '➕ Créer'}</button>
        ${isEdit ? `
        <button onclick="window._aftCancelEdit()"
          class="btn btn-outline btn-sm" style="font-size:.78rem">Annuler</button>` : ''}
      </div>
    </div>
  </div>`;
}

window.deleteHistoriqueEntry = async (npcId, index) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  if (!await confirmModal('Supprimer cet événement de l\'historique ?')) return;

  const historique = [...(n.affinite?.historique || [])];
  historique.splice(index, 1);

  const affinite = {
    ...(n.affinite || {}),
    historique,
  };

  await updateInCol('npcs', npcId, { affinite });

  const idx = _npcs.findIndex(x => x.id === npcId);
  if (idx >= 0) _npcs[idx] = { ..._npcs[idx], affinite };

  showNotif('Événement supprimé.', 'success');

  _refreshActivePanel();

  _refreshList();
};

// Modifier / Supprimer les entrées des historiques des NPCS
window.editHistoriqueEntry = (npcId, index) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  const historique = n.affinite?.historique || [];
  const entry = historique[index];
  if (!entry) return;

  openModal(`✏️ Modifier l'événement — ${_esc(n.nom)}`, `
    <div class="form-group">
      <label>Texte</label>
      <textarea class="input-field" id="hist-edit-text" rows="3"
        placeholder="Décris l’événement...">${_esc(entry.texte || '')}</textarea>
    </div>

    <div class="form-group">
      <label>Impact</label>
      <div style="display:flex;gap:.35rem">
        ${[-2, -1, 0, 1, 2].map(v => `
          <button type="button" id="hist-edit-delta-${v}"
            onclick="window._selectHistEditDelta(${v})"
            style="width:36px;height:36px;border-radius:8px;cursor:pointer;font-size:.8rem;
            font-weight:700;transition:all .12s;
            border:${entry.delta === v ? '2px' : '1px'} solid ${
              v < 0 ? 'rgba(255,107,107,.3)' :
              v > 0 ? 'rgba(34,195,142,.3)' :
              'var(--border)'
            };
            background:${entry.delta === v
              ? (v < 0 ? 'rgba(255,107,107,.18)' : v > 0 ? 'rgba(34,195,142,.18)' : 'rgba(255,255,255,.1)')
              : 'var(--bg-elevated)'};
            color:${v < 0 ? '#ff6b6b' : v > 0 ? '#22c38e' : 'var(--text-dim)'}">
            ${v > 0 ? '+' + v : v}
          </button>
        `).join('')}
      </div>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        onclick="window.saveHistoriqueEntry('${npcId}', ${index})">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);

  window._histEditDelta = entry.delta || 0;
};

window._selectHistEditDelta = (v) => {
  window._histEditDelta = v;

  [-2, -1, 0, 1, 2].forEach(d => {
    const btn = document.getElementById(`hist-edit-delta-${d}`);
    if (!btn) return;

    const active = d === v;
    btn.style.background = active
      ? (d < 0
          ? 'rgba(255,107,107,.18)'
          : d > 0
            ? 'rgba(34,195,142,.18)'
            : 'rgba(255,255,255,.1)')
      : 'var(--bg-elevated)';

    btn.style.borderWidth = active ? '2px' : '1px';
  });
};

window.saveHistoriqueEntry = async (npcId, index) => {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  const texte = document.getElementById('hist-edit-text')?.value?.trim() || '';
  if (!texte) {
    showNotif('Le texte de l’événement est requis.', 'error');
    return;
  }

  const historique = [...(n.affinite?.historique || [])];
  if (!historique[index]) return;

  historique[index] = {
    ...historique[index],
    texte,
    delta: window._histEditDelta || 0,
  };

  const affinite = {
    ...(n.affinite || {}),
    historique,
  };

  await updateInCol('npcs', npcId, { affinite });

  const idx = _npcs.findIndex(x => x.id === npcId);
  if (idx >= 0) _npcs[idx] = { ..._npcs[idx], affinite };

  closeModal();
  showNotif('Événement modifié.', 'success');
  _refreshActivePanel();

  _refreshList();
};

// Affinités spéciales
window.openAffiniteTypesManager = () => {
  // Initialise le formulaire à l'état "ajout"
  window._aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  const ctx = window._currentAffinitePersoContext || {};
  pushModal('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml(), () => {
    // Toujours rafraîchir la fiche principale (le contexte perso peut être périmé)
    if (_activeId) {
      _refreshActivePanel();
    }
    // Rafraîchir aussi la modal perso si elle était ouverte au-dessus
    if (ctx.npcId) {
      _refreshAffinitePersoModal(ctx.npcId, ctx.existingId);
    }
  });
};

function _refreshAffiniteTypesManager() {
  updateModalContent('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml());
}

window._aftSelectEmoji = (emoji) => {
  const inp = document.getElementById('aft-emoji-val');
  if (inp) inp.value = emoji;
  if (window._aftFormState) window._aftFormState.emoji = emoji;
  document.querySelectorAll('#aft-emoji-grid button').forEach(btn => {
    const sel = btn.dataset.emoji === emoji;
    btn.style.background  = sel ? 'rgba(255,255,255,.15)' : 'transparent';
    btn.style.borderColor = sel ? 'var(--gold)' : 'transparent';
    btn.style.transform   = sel ? 'scale(1.15)' : 'scale(1)';
  });
};

window._aftSelectColor = (hex) => {
  const inp = document.getElementById('aft-color');
  if (inp) inp.value = hex;
  if (window._aftFormState) window._aftFormState.couleur = hex;
  document.querySelectorAll('#aft-color-grid button').forEach(btn => {
    const sel = btn.dataset.color === hex;
    btn.style.borderColor = sel ? 'white' : 'transparent';
    btn.style.boxShadow   = sel ? `0 0 0 2px ${hex}` : 'none';
  });
};

window._aftEditType = (typeId) => {
  const t = _affiniteTypes.find(x => x.id === typeId);
  if (!t) return;
  window._aftFormState = {
    editingId: typeId,
    emoji:     t.emoji   || EMOJI_PRESET[0],
    couleur:   t.couleur || TYPE_COLORS[0],
    label:     t.label   || '',
  };
  _refreshAffiniteTypesManager();
};

window._aftCancelEdit = () => {
  window._aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  _refreshAffiniteTypesManager();
};

window.saveAffiniteType = async () => {
  const label     = document.getElementById('aft-label')?.value?.trim();
  const emoji     = document.getElementById('aft-emoji-val')?.value || EMOJI_PRESET[0];
  const couleur   = document.getElementById('aft-color')?.value     || TYPE_COLORS[0];
  const editingId = document.getElementById('aft-editing-id')?.value || '';

  if (!label) { showNotif('Donne un nom au type.', 'error'); return; }

  if (editingId) {
    const idx = _affiniteTypes.findIndex(t => t.id === editingId);
    if (idx >= 0) _affiniteTypes[idx] = { ..._affiniteTypes[idx], label, emoji, couleur };
  } else {
    const id = `aft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _affiniteTypes.push({ id, label, emoji, couleur });
    _affiniteTypes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }

  await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, { types: _affiniteTypes });
  window._aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  showNotif(editingId ? 'Type modifié !' : 'Type créé !', 'success');
  _refreshAffiniteTypesManager();
};

window.deleteAffiniteType = async (typeId) => {
  if (!await confirmModal('Supprimer ce type d\'affinité ?')) return;
  _affiniteTypes = _affiniteTypes.filter(t => t.id !== typeId);
  await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, { types: _affiniteTypes });
  if (window._aftFormState?.editingId === typeId) {
    window._aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  }
  showNotif('Type supprimé.', 'success');
  _refreshAffiniteTypesManager();
};

// ══ Modal affinité individuelle (édition) ════════════════════════════════════

function _getAffinitePersoModalArgs(npcId, existingId = null) {
  const n       = _npcs.find(x => x.id === npcId);
  if (!n) return null;
  const existing       = existingId ? _affiPerso.find(a => a.id === existingId) : null;
  const chars          = STATE.characters || [];
  const existingTypeId = existing?.typeId || '';

  window._selectedAfpTypeId = existingTypeId;

  const typeBtns = _affiniteTypes.map(t => {
    const col = t.couleur || TYPE_COLORS[0];
    const sel = existingTypeId === t.id;
    return `<button type="button" id="afp-type-btn-${t.id}"
      onclick="window._selectAfpType('${t.id}')"
      style="display:flex;align-items:center;gap:.3rem;padding:4px 10px;border-radius:999px;
      cursor:pointer;font-size:.72rem;font-weight:${sel ? '700' : '500'};transition:all .15s;
      border:1px solid ${sel ? col : col + '55'};background:${sel ? col + '33' : col + '11'};color:${col}">
      <span>${t.emoji || '✨'}</span><span>${_esc(t.label)}</span></button>`;
  }).join('');

  const title = `${existing ? '✏️ Modifier' : '➕ Ajouter'} une affinité — ${_esc(n.nom)}`;
  const body  = `
    <input type="hidden" id="afp-type" value="${existingTypeId}">

    <div class="form-group">
      <label>Personnage concerné</label>
      <select class="input-field" id="afp-char">
        <option value="">— Choisir —</option>
        ${chars.map(c => `<option value="${c.id}|${_esc(c.nom || '?')}"
          ${existing?.charId === c.id ? 'selected' : ''}>${_esc(c.nom || '?')} (${_esc(c.ownerPseudo || '?')})</option>`).join('')}
      </select>
    </div>

    <div class="form-group">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
        <label style="margin:0">Affinité spécifique</label>
        <button type="button" onclick="openAffiniteTypesManager()"
          class="btn btn-outline btn-sm" style="font-size:.7rem">⚙️ Gérer</button>
      </div>
      ${_affiniteTypes.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:.35rem">${typeBtns}</div>`
        : `<div style="font-size:.78rem;color:var(--text-dim);font-style:italic">
            Aucun type — ouvre le gestionnaire pour en créer.</div>`}
    </div>

    <div class="form-group">
      <label>Note <span style="color:var(--text-dim);font-weight:400">(visible par ce joueur seulement)</span></label>
      <textarea class="input-field" id="afp-note" rows="3"
        placeholder="Ex: A rendu un service personnel…">${_esc(existing?.note || '')}</textarea>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        onclick="window.saveAffinitePerso('${npcId}','${existingId || ''}')">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>`;

  return { title, body, selectedTypeId: existingTypeId };
}

function _refreshAffinitePersoModal(npcId, existingId = null) {
  const args = _getAffinitePersoModalArgs(npcId, existingId);
  if (!args) return;
  window._currentAffinitePersoContext = { npcId, existingId };
  updateModalContent(args.title, args.body);
  window._selectedAfpTypeId = args.selectedTypeId;
}

window.openAffinitePersoModal = (npcId, existingId = null) => {
  window._currentAffinitePersoContext = { npcId, existingId };
  const args = _getAffinitePersoModalArgs(npcId, existingId);
  if (!args) return;
  openModal(args.title, args.body);
  window._selectedAfpTypeId = args.selectedTypeId;
};

function _refreshActivePanel() {
  const panel = document.getElementById('npc-detail-panel');
  if (!panel) return;

  const filtered = _getFiltered();
  const active = _npcs.find(x => x.id === _activeId) || filtered[0] || null;

  if (!_npcs.find(x => x.id === _activeId)) {
    _activeId = active?.id || null;
  }

  panel.innerHTML = active ? _renderFiche(active) : _renderEmpty();
}

window._selectAfpType = (typeId) => {
  window._selectedAfpTypeId = typeId;
  const inp = document.getElementById('afp-type');
  if (inp) inp.value = typeId;
  _affiniteTypes.forEach(t => {
    const btn = document.getElementById(`afp-type-btn-${t.id}`);
    if (!btn) return;
    const col = t.couleur || TYPE_COLORS[0];
    const sel = t.id === typeId;
    btn.style.fontWeight  = sel ? '700' : '500';
    btn.style.background  = sel ? col + '33' : col + '11';
    btn.style.borderColor = sel ? col : col + '55';
  });
};

// ── Sauvegarde / suppression affinité individuelle ────────────────────────────
window.saveAffinitePerso = async (npcId, existingId) => {
  const charSel = document.getElementById('afp-char')?.value;
  if (!charSel) { showNotif('Choisis un personnage.', 'error'); return; }
  const typeId = document.getElementById('afp-type')?.value || '';
  if (!typeId) { showNotif('Choisis une affinité spécifique.', 'error'); return; }

  const [charId, charNom] = charSel.split('|');
  const type  = _getAffiniteType(typeId);
  const note  = document.getElementById('afp-note')?.value?.trim() || '';
  const data  = { npcId, charId, charNom, typeId, typeLabel: type?.label || '', note };

  if (existingId) {
    await updateInCol('npc_affinites', existingId, data);
    const idx = _affiPerso.findIndex(a => a.id === existingId);
    if (idx >= 0) _affiPerso[idx] = { ..._affiPerso[idx], ...data };
  } else {
    const newId = await addToCol('npc_affinites', data);
    _affiPerso.push({ id: newId || `afp_${Date.now()}`, ...data });
  }

  closeModal();
  showNotif('Affinité enregistrée !', 'success');
  _refreshActivePanel();
};

window.deleteAffinitePerso = async (id) => {
  if (!await confirmModal('Supprimer cette affinité ?')) return;
  await deleteFromCol('npc_affinites', id);
  _affiPerso = _affiPerso.filter(a => a.id !== id);
  showNotif('Affinité supprimée.', 'success');
  _refreshActivePanel();
};

// ── Override PAGES.npcs ───────────────────────────────────────────────────────
PAGES.npcs = renderNpcs;

Object.assign(window, {
  renderNpcs, openNpcModal, saveNpc, deleteNpc,
  openAffiniteGroupeModal, openAffinitePersoModal,
  saveAffiniteGroupe, saveAffinitePerso, deleteAffinitePerso,
  editHistoriqueEntry, deleteHistoriqueEntry, saveHistoriqueEntry,
});
