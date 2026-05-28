// ══════════════════════════════════════════════════════════════════════════════
// STORY.JS — La Trame v2
// ✓ Actes persistés en Firestore (visibles même vides)
// ✓ Upload + recadrage d'image canvas 4:3 (identique aux hauts-faits)
// ✓ Liens inter-missions (flèches SVG entre axes différents)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { openModal, closeModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { _esc, _nl2br } from '../shared/html.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function stCfg(item){ return STATUT_CFG[item.statut] || STATUT_CFG['En attente']; }

let _stCropper   = null;
let _axeMap      = {};
let _modalGroupes   = [];   // groupes du modal ouvert (mission courante)
let _modalStoryId   = '';   // id de la mission en édition ('' = nouvelle)
let _editingGroupId = null; // id du groupe en cours de modification (null = création)

// ── Préférences persistées (handoff STORY.md §11) ─────────────────────────────
const STORY_PREFS_KEY = 'story-prefs-v2';
const STORY_PREFS_DEFAULT = { view: 'carte', search: '', statut: '', zoom: 1, panX: 0, panY: 0 };
function getStoryPrefs() {
  try { return { ...STORY_PREFS_DEFAULT, ...(JSON.parse(localStorage.getItem(STORY_PREFS_KEY)) || {}) }; }
  catch { return { ...STORY_PREFS_DEFAULT }; }
}
function setStoryPrefs(patch) {
  try { localStorage.setItem(STORY_PREFS_KEY, JSON.stringify({ ...getStoryPrefs(), ...patch })); }
  catch {}
}

// Avancement d'une mission : 100 si Terminée, 0 si Échouée, sinon moyenne des
// réussites des groupes, sinon 50 si En cours, sinon 0.
function itemProgress(item) {
  if (item.statut === 'Terminée') return 100;
  if (item.statut === 'Échouée')  return 0;
  const groupes = item.groupes || [];
  if (groupes.length) {
    const vals = groupes.map(g => parseInt(g.reussite) || 0);
    return Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
  }
  return item.statut === 'En cours' ? 50 : 0;
}

// Cache des items pour les handlers (tooltips, etc.)
let _mapItemsCache = [];

// Normalisation pour recherche : minuscules + sans accents
// "Étoile" → "etoile", "Mystères" → "mysteres", "œuf" → "œuf" (non transformé mais OK)
function _normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
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
  try {
    await saveDoc('story_meta','actes',{ list });
  } catch (e) { notifySaveError(e); }
}

// ── Groupes de participants (per-mission) ─────────────────────────────────────
async function _saveModalGroupes() {
  if (!_modalStoryId) return; // nouvelle mission → sauvé avec le formulaire
  try { await updateInCol('story', _modalStoryId, { groupes: _modalGroupes }); }
  catch(e) { console.error('[saveGroupes]', e); showNotif('Erreur de sauvegarde.', 'error'); }
}
function _renderGroupPills(groups) {
  if (!groups.length) return `<span style="font-size:.75rem;color:var(--text-dim);font-style:italic">Aucun groupe. Créez-en un ci-dessous.</span>`;
  const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars  = STATE.characters || [];
  return groups.map(g => {
    const membres   = (g.membres||[]).map(id => chars.find(c => c.id === id)).filter(Boolean);
    const reussite  = g.reussite != null ? g.reussite : '';
    const recompense = g.recompense || '';
    const notes     = g.notesReussite || '';
    return `<div style="display:inline-flex;flex-direction:column;gap:.3rem;
      padding:.45rem .55rem;border-radius:10px;vertical-align:top;
      border:1px solid var(--border-strong);background:var(--bg-elevated);min-width:160px">
      <div style="display:flex;align-items:center;gap:.35rem">
        <button type="button" onclick="window._stApplyGroup(${JSON.stringify(g.membres)})"
          title="Appliquer ce groupe aux participants"
          style="font-size:.75rem;color:var(--gold);font-family:'Cinzel',serif;
            background:none;border:none;cursor:pointer;padding:0;line-height:1.2;flex:1;text-align:left">
          ${g.nom}</button>
        <span onclick="window._stEditGroup('${g.id}')"
          title="Modifier ce groupe"
          style="display:flex;align-items:center;justify-content:center;
            width:15px;height:15px;border-radius:50%;background:rgba(79,140,255,.15);
            color:#4f8cff;font-size:.68rem;cursor:pointer;flex-shrink:0">✎</span>
        <span onclick="window._stDeleteGroup('${g.id}')"
          style="display:flex;align-items:center;justify-content:center;
            width:15px;height:15px;border-radius:50%;background:rgba(255,107,107,.15);
            color:#ff6b6b;font-size:.72rem;font-weight:700;cursor:pointer;flex-shrink:0">×</span>
      </div>
      ${membres.length ? `<div style="display:flex;gap:3px;flex-wrap:wrap">
        ${membres.map(c => {
          const col = PCOLS[c.nom?.charCodeAt(0)%6||0];
          const pp  = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
          return `<div title="${c.nom||''}" style="width:28px;height:28px;border-radius:50%;overflow:hidden;
            border:2px solid ${col};background:${col}18;flex-shrink:0;
            display:flex;align-items:center;justify-content:center">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${pp}">`
              : `<span style="font-family:'Cinzel',serif;font-weight:700;font-size:.62rem;color:${col}">${(c.nom||'?')[0].toUpperCase()}</span>`}
          </div>`;
        }).join('')}
      </div>` : ''}
      <div style="border-top:1px solid var(--border);padding-top:.3rem;display:flex;flex-direction:column;gap:.25rem">
        <div style="display:flex;gap:.35rem;align-items:center">
          <span style="font-size:.65rem;color:var(--text-dim);white-space:nowrap">Réussite</span>
          <input type="number" min="0" max="100" value="${reussite}" placeholder="—"
            style="width:44px;padding:.1rem .25rem;font-size:.7rem;border-radius:4px;
              border:1px solid var(--border);background:var(--bg-panel);color:var(--text)"
            oninput="window._stGroupField('${g.id}','reussite',+this.value||0)">
          <span style="font-size:.65rem;color:var(--text-dim)">%</span>
        </div>
        <input type="text" value="${_esc(recompense)}" placeholder="Récompense…"
          style="width:100%;box-sizing:border-box;padding:.1rem .25rem;font-size:.7rem;border-radius:4px;
            border:1px solid var(--border);background:var(--bg-panel);color:var(--text)"
          oninput="window._stGroupField('${g.id}','recompense',this.value)">
        <textarea placeholder="Notes de réussite…" rows="2"
          style="width:100%;box-sizing:border-box;padding:.15rem .3rem;font-size:.67rem;border-radius:4px;
            border:1px solid var(--border);background:var(--bg-panel);color:var(--text);resize:vertical"
          oninput="window._stGroupField('${g.id}','notesReussite',this.value)">${notes}</textarea>
      </div>
    </div>`;
  }).join('');
}
function _refreshStGroupsRow(groups) {
  const row = document.getElementById('st-groups-row');
  if (row) {
    row.innerHTML = _renderGroupPills(groups) + `
      <button type="button" onclick="window._stSaveGroupDialog()"
        style="padding:.3rem .65rem;border-radius:999px;border:1px dashed rgba(232,184,75,.35);
          background:transparent;color:var(--gold);font-size:.73rem;cursor:pointer;opacity:.8;
          align-self:flex-start;margin-top:.1rem;transition:all .15s"
        onmouseover="this.style.opacity='1';this.style.background='rgba(232,184,75,.06)'"
        onmouseout="this.style.opacity='.8';this.style.background='transparent'">
        + Nouveau groupe</button>`;
  }
  // Nouvelle vue par cards (modal v2)
  const list = document.getElementById('st-groups-list');
  if (list) list.innerHTML = _renderGroupCards(groups);
}

// Expose closeModalDirect aux onclick inline du footer
if (typeof window !== 'undefined' && !window.closeModalDirect) {
  window.closeModalDirect = closeModalDirect;
}

// ── Bindings de la nouvelle modale mission : tabs, segments, live preview ────
function _initMissionModalUI(item) {
  const shell = document.querySelector('.mn-shell');
  if (!shell) return;

  // Tabs
  shell.querySelectorAll('.mn-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      shell.querySelectorAll('.mn-tab').forEach(t => t.classList.toggle('is-active', t === btn));
      shell.querySelectorAll('.mn-panel').forEach(p =>
        p.classList.toggle('is-active', p.dataset.panel === tab));
    });
  });

  // Type segmented control → met à jour input caché + preview hero
  const typeSeg = shell.querySelector('#mn-type-seg');
  const typeInp = shell.querySelector('#st-type');
  const typeLbl = shell.querySelector('#mn-type-preview');
  typeSeg?.querySelectorAll('.mn-seg').forEach(b => {
    b.addEventListener('click', () => {
      const v = b.dataset.type;
      typeSeg.querySelectorAll('.mn-seg').forEach(x => x.classList.toggle('is-active', x === b));
      if (typeInp) typeInp.value = v;
      if (typeLbl) typeLbl.textContent = v === 'event' ? 'Événement' : 'Mission';
    });
  });

  // Statut pills cliquables → met à jour input caché + preview hero
  const statutPills = shell.querySelector('#mn-statut-pills');
  const statutInp = shell.querySelector('#st-statut');
  const statutPreview = shell.querySelector('#mn-statut-preview');
  statutPills?.querySelectorAll('.mn-statut-pill').forEach(p => {
    p.addEventListener('click', () => {
      const v = p.dataset.statut;
      statutPills.querySelectorAll('.mn-statut-pill').forEach(x => x.classList.toggle('is-active', x === p));
      if (statutInp) statutInp.value = v;
      if (statutPreview) {
        const cfg = stCfg({ statut: v });
        statutPreview.style.color = cfg.color;
        statutPreview.style.borderColor = cfg.border;
        statutPreview.innerHTML = `${cfg.icon} <span>${_esc(v)}</span>`;
      }
    });
  });

  // Live preview : titre, acte, axe
  const acteInp = shell.querySelector('#st-acte');
  const actePreview = shell.querySelector('#mn-acte-preview');
  acteInp?.addEventListener('input', () => {
    if (actePreview) actePreview.textContent = acteInp.value || 'Acte I';
  });

  const axeInp = shell.querySelector('#st-axe');
  const axePreview = shell.querySelector('#mn-axe-preview');
  axeInp?.addEventListener('input', () => {
    if (axePreview) {
      const v = axeInp.value.trim();
      if (v) {
        axePreview.style.color = _axeMap[v] || 'var(--text-muted)';
        axePreview.textContent = `● ${v}`;
      } else {
        axePreview.textContent = '';
      }
    }
  });

  // Filtre live du picker de groupe
  const pickerSearch = shell.querySelector('#mn-picker-search');
  pickerSearch?.addEventListener('input', () => {
    const q = _normalize(pickerSearch.value);
    shell.querySelectorAll('.st-group-pick').forEach(el => {
      const name = _normalize(el.dataset.charName || '');
      el.style.display = !q || name.includes(q) ? '' : 'none';
    });
  });

  // Filtre live des liens
  const liensSearch = shell.querySelector('#mn-liens-search');
  liensSearch?.addEventListener('input', () => {
    const q = _normalize(liensSearch.value);
    shell.querySelectorAll('[id^="lien-card-"]').forEach(el => {
      const text = _normalize(el.textContent || '');
      el.style.display = !q || text.includes(q) ? '' : 'none';
    });
  });

  // Raccourcis clavier : Ctrl+S = sauver, Escape = fermer (Escape déjà géré globalement)
  if (!shell._kbBound) {
    shell._kbBound = true;
    const id = item?.id || '';
    const onKey = (e) => {
      if (!document.querySelector('.mn-shell')) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const btn = document.getElementById('mn-save-btn');
        btn?.click();
      }
    };
    document.addEventListener('keydown', onKey);
  }
}

// Cards de groupes pour la modale v2 — chaque card affiche : nom, membres,
// réussite/récompense/notes (édition inline), boutons éditer/supprimer.
function _renderGroupCards(groups) {
  if (!groups.length) {
    return `<div class="st-groups-empty">
      Aucun groupe. Crée-en un pour rattacher des personnages.
    </div>`;
  }
  const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars = STATE.characters || [];
  return groups.map(g => {
    const membres = (g.membres||[]).map(id => chars.find(c => c.id === id)).filter(Boolean);
    const reussite = g.reussite != null ? g.reussite : '';
    const recompense = g.recompense || '';
    const notes = g.notesReussite || '';
    const reusVal = parseInt(g.reussite) || 0;
    const reusColor = reusVal>=80 ? '#22c38e' : reusVal>=40 ? '#e8b84b' : reusVal>0 ? '#ff8a4c' : 'var(--text-dim)';
    return `<div class="st-group-card">
      <div class="st-group-card-head">
        <div class="st-group-card-title">${_esc(g.nom)}</div>
        <div class="st-group-card-actions">
          <button type="button" class="st-icon-btn" title="Modifier" onclick="window._stEditGroup('${g.id}')">✎</button>
          <button type="button" class="st-icon-btn st-icon-btn--danger" title="Supprimer" onclick="window._stDeleteGroup('${g.id}')">🗑️</button>
        </div>
      </div>
      <div class="st-group-card-members">
        ${membres.length ? membres.map(c => {
          const col = PCOLS[c.nom?.charCodeAt(0)%6||0];
          const pp  = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
          return `<div class="st-group-member" title="${_esc(c.nom||'')}" style="--col:${col}">
            ${c.photo
              ? `<img src="${_esc(c.photo)}" style="object-position:${pp}">`
              : `<span>${(c.nom||'?')[0].toUpperCase()}</span>`}
            <span class="st-group-member-name">${_esc(c.nom||'')}</span>
          </div>`;
        }).join('') : '<span class="st-group-empty-members">Aucun membre — édite le groupe pour en ajouter.</span>'}
      </div>
      <div class="st-group-card-fields">
        <label class="st-group-field">
          <span class="st-group-field-lbl">Réussite</span>
          <div class="st-group-field-row">
            <input type="number" min="0" max="100" value="${reussite}" placeholder="0"
              style="border-color:${reusColor};color:${reusColor}"
              oninput="window._stGroupField('${g.id}','reussite',+this.value||0)">
            <span class="st-group-field-suffix" style="color:${reusColor}">%</span>
          </div>
        </label>
        <label class="st-group-field st-group-field--wide">
          <span class="st-group-field-lbl">🏆 Récompense</span>
          <input type="text" value="${_esc(recompense)}" placeholder="XP, butin, faveur…"
            oninput="window._stGroupField('${g.id}','recompense',this.value)">
        </label>
        <label class="st-group-field st-group-field--full">
          <span class="st-group-field-lbl">📝 Notes de réussite</span>
          <textarea rows="2" placeholder="Ce qui s'est passé, conséquences…"
            oninput="window._stGroupField('${g.id}','notesReussite',this.value)">${_esc(notes)}</textarea>
        </label>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL — orchestrateur conforme handoff STORY.md
// Bannière cinéma · Cockpit (anneau + minis + prochaine) · Acts · Controls · View
// ══════════════════════════════════════════════════════════════════════════════
async function renderStory() {
  const content = document.getElementById('main-content');
  _axeMap = {};

  const [items, savedActes] = await Promise.all([
    loadCollection('story'),
    loadActes(),
  ]);

  const prefs = getStoryPrefs();

  const fromItems = [...new Set(items.map(i => i.acte).filter(Boolean))];
  const allActes  = [...new Set([...savedActes, ...fromItems])].sort();
  if (!allActes.length) allActes.push('Acte I');

  const activeActe = window._storyActe && allActes.includes(window._storyActe)
    ? window._storyActe
    : allActes[0];
  window._storyActe = activeActe;

  // Items de l'acte courant, visibles selon rôle
  const acteItems = items
    .filter(i => (i.acte || 'Acte I') === activeActe)
    .filter(i => STATE.isAdmin || i.visibleJoueurs !== false);

  // Filtres recherche (insensible aux accents) + statut
  const qNorm = _normalize((prefs.search || '').trim());
  const filteredItems = acteItems.filter(i => {
    if (prefs.statut && (i.statut || 'En attente') !== prefs.statut) return false;
    if (!qNorm) return true;
    const hay = _normalize([i.titre, i.axe, i.lieu, i.description, i.date].join(' '));
    return hay.includes(qNorm);
  }).sort((a,b) => (a.ordre||0)-(b.ordre||0) || (a.date||'').localeCompare(b.date||''));

  // Palette d'axes : à partir de TOUS les items de l'acte (pas seulement filtrés)
  acteItems.forEach(i => { if (i.axe) axeColor(i.axe); });
  const axes = Object.keys(_axeMap);

  // Statistiques de cockpit
  const counts = { total: acteItems.length, term: 0, cours: 0, attente: 0, echec: 0 };
  acteItems.forEach(i => {
    const s = i.statut || 'En attente';
    if (s === 'Terminée') counts.term++;
    else if (s === 'En cours') counts.cours++;
    else if (s === 'Échouée') counts.echec++;
    else counts.attente++;
  });
  const progPct = counts.total ? Math.round((counts.term / counts.total) * 100) : 0;

  // Mission hero pour la bannière : En cours avec image, sinon dernière Terminée
  // avec image, sinon première avec image.
  const heroMission = acteItems.find(i => i.statut === 'En cours' && i.imageUrl)
    || [...acteItems].reverse().find(i => i.statut === 'Terminée' && i.imageUrl)
    || acteItems.find(i => i.imageUrl)
    || acteItems[0] || null;

  // Prochaine étape (mission En cours sinon première En attente)
  const nextMission = acteItems.find(i => i.statut === 'En cours')
    || acteItems.find(i => i.statut === 'En attente')
    || null;

  // Stroke-dasharray pour l'anneau de progression (r=26 → C=2πr≈163.36)
  const ringC = 2 * Math.PI * 26;
  const ringFill = (progPct / 100) * ringC;

  content.innerHTML = `
  <div class="trame-shell">

    ${_renderBanner(heroMission, activeActe)}

    <!-- ── COCKPIT ──────────────────────────────────────────── -->
    <div class="cockpit">
      <div class="cockpit-progress">
        <div class="progress-ring" title="${counts.term}/${counts.total} terminées">
          <svg viewBox="0 0 60 60">
            <defs>
              <linearGradient id="trame-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--amber)"/>
                <stop offset="100%" stop-color="var(--ember)"/>
              </linearGradient>
            </defs>
            <circle class="progress-ring-bg" cx="30" cy="30" r="26"/>
            <circle class="progress-ring-fill" cx="30" cy="30" r="26"
              stroke-dasharray="${ringFill.toFixed(2)} ${ringC.toFixed(2)}"
              stroke-dashoffset="0"/>
          </svg>
          <div class="progress-ring-val">${progPct}%</div>
        </div>
        <div class="cockpit-counts">
          <div class="cockpit-counts-num">${counts.term}<small>/</small><span style="color:var(--text-muted)">${counts.total}</span></div>
          <div class="cockpit-counts-lbl">Missions accomplies</div>
        </div>
      </div>

      <div class="cockpit-divider"></div>

      <div class="cockpit-minis">
        <div class="cockpit-mini"><span class="cockpit-mini-dot" style="background:var(--st-cours);color:var(--st-cours)"></span><span class="cockpit-mini-num" style="color:var(--st-cours)">${counts.cours}</span><span class="cockpit-mini-lbl">En cours</span></div>
        <div class="cockpit-mini"><span class="cockpit-mini-dot" style="background:var(--st-attente);color:var(--st-attente)"></span><span class="cockpit-mini-num" style="color:var(--text)">${counts.attente}</span><span class="cockpit-mini-lbl">À venir</span></div>
        <div class="cockpit-mini"><span class="cockpit-mini-dot" style="background:var(--st-terminee);color:var(--st-terminee)"></span><span class="cockpit-mini-num" style="color:var(--st-terminee)">${counts.term}</span><span class="cockpit-mini-lbl">Réussies</span></div>
        ${counts.echec ? `<div class="cockpit-mini"><span class="cockpit-mini-dot" style="background:var(--st-echec);color:var(--st-echec)"></span><span class="cockpit-mini-num" style="color:var(--st-echec)">${counts.echec}</span><span class="cockpit-mini-lbl">Échouées</span></div>` : ''}
      </div>

      ${nextMission ? `
      <div class="cockpit-next" onclick="openStoryDetail('${nextMission.id}')">
        <div class="cockpit-next-icon">⇒</div>
        <div>
          <div class="cockpit-next-lbl">Prochaine étape</div>
          <div class="cockpit-next-title">${_esc(nextMission.titre || 'Sans titre')}</div>
          ${nextMission.axe ? `<div class="cockpit-next-axe" style="color:${_axeMap[nextMission.axe] || 'var(--text-muted)'}">● ${_esc(nextMission.axe)}</div>` : ''}
        </div>
      </div>` : ''}
    </div>

    <!-- ── ACTS BAR ─────────────────────────────────────────── -->
    <div class="acts-bar">
      <div class="acts">
        ${allActes.map(acte => {
          const active = acte === activeActe;
          const n = items.filter(i => (i.acte || 'Acte I') === acte).length;
          // data-acte + délégation : robuste aux apostrophes / guillemets dans le nom
          return `<button class="act ${active ? 'active' : ''}"
            data-acte="${_esc(acte)}"
            onclick="window._stSwitchActe(this.dataset.acte)">
            ${_esc(acte)}<span class="act-count">${n}</span>
          </button>`;
        }).join('')}
        ${STATE.isAdmin ? `<button class="act-new" onclick="openNewActeModal()">+ Nouvel acte</button>` : ''}
      </div>
      ${STATE.isAdmin ? `<button class="btn-add" onclick="openStoryModal()">+ Nouvelle mission</button>` : ''}
    </div>

    <!-- ── CONTROLS (recherche + statut + view toggle) ─────── -->
    <div class="controls">
      <div class="search-wrap">
        <span style="color:var(--text-dim);font-size:.85rem">🔍</span>
        <input type="text" id="st-search" placeholder="Rechercher un titre, un axe, un lieu… (sans accents OK)"
          value="${_esc(prefs.search)}" oninput="window._stOnSearch(this)">
        ${prefs.search ? `<button onclick="window._stSetFilter('search','')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:.75rem">✕</button>` : ''}
      </div>
      <select class="statut-select" onchange="window._stSetFilter('statut', this.value)">
        <option value="">Tous les statuts</option>
        ${Object.keys(STATUT_CFG).map(s => `<option value="${s}" ${prefs.statut===s?'selected':''}>${STATUT_CFG[s].icon} ${s}</option>`).join('')}
      </select>
      <div class="view-toggle" role="tablist">
        <button class="view-tab ${prefs.view==='carte'?'active':''}" onclick="window._stSetView('carte')">🗺️ Carte</button>
        <button class="view-tab ${prefs.view==='saga'?'active':''}" onclick="window._stSetView('saga')">📚 Saga</button>
        <button class="view-tab ${prefs.view==='chronique'?'active':''}" onclick="window._stSetView('chronique')">📖 Chronique</button>
        <button class="view-tab ${prefs.view==='list'?'active':''}" onclick="window._stSetView('list')">📋 Liste</button>
      </div>
    </div>

    <!-- ── CONTENU ──────────────────────────────────────────── -->
    <div class="content-scroll">
      ${filteredItems.length === 0 ? `
        <div style="text-align:center;padding:5rem 2rem;color:var(--text-dim)">
          <div style="font-size:3rem;margin-bottom:1rem;opacity:.3">📜</div>
          <p style="font-style:italic">${qNorm || prefs.statut ? 'Aucune mission ne correspond aux filtres.' : `Aucune mission pour ${_esc(activeActe)}.`}</p>
          ${qNorm || prefs.statut
            ? `<button class="btn btn-outline btn-sm" onclick="window._stResetFilters()">↺ Réinitialiser</button>`
            : (STATE.isAdmin ? `<button class="btn btn-outline btn-sm" onclick="openStoryModal()">+ Ajouter la première</button>` : '')}
        </div>` :
        (() => {
          // Wrap chaque vue : si UNE mission corrompue plante le renderer, on
          // affiche un message clair plutôt qu'une "Erreur de chargement" globale.
          const view = prefs.view || 'carte';
          const fn = view === 'saga'      ? _renderSagaView
                   : view === 'chronique' ? _renderChroniqueView
                   : view === 'list'      ? _renderListView
                   : _renderMapView;
          try {
            return fn(filteredItems);
          } catch (err) {
            console.error('[story] vue', view, 'a planté :', err, filteredItems);
            return `<div style="text-align:center;padding:3rem 2rem;color:var(--text-soft, #c8d4e8)">
              <div style="font-size:2.5rem;margin-bottom:1rem">⚠️</div>
              <p style="font-weight:700;margin-bottom:.5rem">Impossible d'afficher cette vue</p>
              <p style="font-size:.82rem;color:var(--text-dim);max-width:380px;margin:0 auto;line-height:1.5">
                Une mission de <b>${_esc(activeActe)}</b> contient des données invalides.
                Essaie une autre vue ou contacte le MJ.
              </p>
              <p style="font-size:.7rem;color:var(--text-dim);opacity:.6;margin-top:.75rem;font-family:monospace">${_esc(err?.message || String(err))}</p>
              <div style="display:flex;gap:.4rem;justify-content:center;margin-top:1rem;flex-wrap:wrap">
                <button class="btn btn-outline btn-sm" onclick="window._stSetView('list')">📋 Vue Liste</button>
                <button class="btn btn-outline btn-sm" onclick="window._stResetFilters()">↺ Réinitialiser filtres</button>
              </div>
            </div>`;
          }
        })()
      }
    </div>
  </div>
  `;

  if (prefs.view === 'carte') requestAnimationFrame(() => _initMapInteractions());
}

// Handlers de prefs exposés à window pour les inputs inline
window._stSetFilter = (key, val) => { setStoryPrefs({ [key]: val }); PAGES.story?.(); };
window._stSetView   = (view)     => { setStoryPrefs({ view });        PAGES.story?.(); };
window._stResetFilters = () => { setStoryPrefs({ search:'', statut:'' }); PAGES.story?.(); };
// Bascule entre actes — passe par data-attribute pour être immunisé aux
// caractères spéciaux (apostrophes, guillemets) dans les noms d'acte.
window._stSwitchActe = (acte) => {
  if (!acte) return;
  window._storyActe = String(acte);
  PAGES.story?.();
};

// Recherche : préserve le focus et la position du curseur après le re-render
// complet de la page (sinon l'input perd le focus à chaque caractère tapé)
window._stOnSearch = (el) => {
  const caret = el.selectionStart;
  setStoryPrefs({ search: el.value });
  PAGES.story?.().then(() => {
    const next = document.getElementById('st-search');
    if (next) {
      next.focus();
      try { next.setSelectionRange(caret, caret); } catch {}
    }
  });
};

// ── Bannière cinématique ──────────────────────────────────────────────────────
function _renderBanner(hero, activeActe) {
  if (!hero) {
    return `<div class="trame-banner trame-banner--empty">
      <div class="trame-banner-content">
        <div class="trame-banner-eyebrow">Chroniques de la Compagnie</div>
        <h1 class="trame-banner-title">La Trame</h1>
      </div>
    </div>`;
  }
  const st = stCfg(hero);
  const eyebrow = hero.statut === 'En cours' ? `${activeActe} · Mission en cours`
    : hero.statut === 'Terminée' ? `${activeActe} · Dernière victoire`
    : `${activeActe} · ${hero.statut || ''}`;
  const bgUrl = (hero.imageUrl || '').replace(/"/g, '%22');
  return `<div class="trame-banner" onclick="openStoryDetail('${hero.id}')">
    ${hero.imageUrl ? `<div class="trame-banner-bg" style='background-image:url("${bgUrl}")'></div>` : ''}
    <div class="trame-banner-fade"></div>
    <div class="trame-banner-content">
      <div class="trame-banner-eyebrow">${_esc(eyebrow)}</div>
      <h1 class="trame-banner-title">${_esc(hero.titre || 'Sans titre')}</h1>
      ${hero.lieu || hero.date ? `<div class="trame-banner-meta">
        ${hero.date ? `<span>📅 ${_esc(hero.date)}</span>` : ''}
        ${hero.lieu ? `<span>📍 ${_esc(hero.lieu)}</span>` : ''}
        <span style="color:${st.color}">${st.icon} ${_esc(hero.statut || 'En attente')}</span>
      </div>` : ''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE CARTE — Lignes narratives (style métro) — handoff STORY.md §6 ⭐
// • 1 axe = 1 couloir horizontal avec carte d'en-tête à gauche
// • Stations = missions ordonnées par `ordre`, positions déterministes
// • Liens INTRA-axe représentés par la ligne de métro elle-même
// • Liens INTER-axes = S-curves verticales pointillées dorées
// • Grille verticale dashée subtile = repère temporel commun
// • Zoom molette + pan, pas de drag des nœuds
// ══════════════════════════════════════════════════════════════════════════════
const MAP_HEADER_W = 240;
const MAP_COL_W    = 220;
const MAP_LANE_H   = 200;
const MAP_TOP_PAD  = 70;
const MAP_BOT_PAD  = 40;
const MAP_NODE_R   = 38;

function _renderMapView(missions) {
  _mapItemsCache = missions;

  // ── 1. Grouper par axe ─────────────────────────────────────────────────
  const byAxe = new Map();
  missions.forEach(m => {
    const k = m.axe || '__none__';
    if (!byAxe.has(k)) byAxe.set(k, []);
    byAxe.get(k).push(m);
  });
  byAxe.forEach(list => list.sort((a,b) =>
    (a.ordre||0) - (b.ordre||0) || (a.date||'').localeCompare(b.date||'')));

  // ── 2. ALIGNEMENT TEMPOREL GLOBAL ──────────────────────────────────────
  // Toutes les missions partagent une grille d'ordres communs. Deux missions
  // de même `ordre` (peu importe leur axe) tombent dans la MÊME colonne X.
  // → permet de voir "ce qui se passe en même temps" entre axes parallèles.
  const allOrdres = [...new Set(missions.map(m => m.ordre || 0))].sort((a,b) => a - b);
  if (!allOrdres.length) allOrdres.push(0);
  const ordreToCol = new Map(allOrdres.map((o, i) => [o, i]));

  // ── 3. Sub-rows : si 2+ missions du même axe ont le même ordre, on les
  //    empile verticalement dans la lane (split de ligne).
  const lanes = [...byAxe.entries()].map(([axe, list], laneIdx) => {
    // Grouper par colonne (= par valeur d'ordre)
    const byCol = new Map();
    list.forEach(m => {
      const col = ordreToCol.get(m.ordre || 0) ?? 0;
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col).push(m);
    });
    const maxSubs = Math.max(1, ...[...byCol.values()].map(a => a.length));
    return {
      axe, list, byCol, maxSubs,
      color: axe === '__none__' ? '#7a8fa8' : (_axeMap[axe] || '#7a8fa8'),
      label: axe === '__none__' ? 'Hors axe' : axe,
      term: list.filter(m => m.statut === 'Terminée').length,
    };
  });

  // ── 4. Hauteur dynamique par lane (selon sub-rows max) ─────────────────
  const SUB_GAP = 22;
  const SUB_BLOCK_H = MAP_NODE_R * 2 + 60;  // place pour titre + date sous le nœud
  const laneY = []; let curY = MAP_TOP_PAD;
  lanes.forEach(l => {
    const h = Math.max(MAP_LANE_H, l.maxSubs * SUB_BLOCK_H + (l.maxSubs - 1) * SUB_GAP + 60);
    l.height = h;
    l.y = curY + h / 2;
    laneY.push(l.y);
    curY += h;
  });
  const maxCols = allOrdres.length;
  const MAP_W = MAP_HEADER_W + maxCols * MAP_COL_W + 40;
  const MAP_H = curY + MAP_BOT_PAD;

  // ── 5. Positions de chaque station ─────────────────────────────────────
  const positions = {};
  lanes.forEach(l => {
    l.byCol.forEach((subs, col) => {
      const N = subs.length;
      subs.forEach((m, subRow) => {
        const x = MAP_HEADER_W + col * MAP_COL_W + MAP_COL_W/2;
        // Centré sur la lane si N=1 ; sinon empilé symétriquement autour du centre
        const yOff = N === 1
          ? 0
          : (subRow - (N - 1) / 2) * (SUB_BLOCK_H + SUB_GAP) * 0.7;
        positions[m.id] = { x, y: l.y + yOff };
      });
    });
  });

  // ── DEFS : clipPaths + dégradés de lane + marker ──
  const clipDefs = missions.filter(m => positions[m.id]).map(m => `
    <clipPath id="st-clip-${_esc(m.id)}">
      <circle cx="${positions[m.id].x}" cy="${positions[m.id].y}" r="${MAP_NODE_R}"/>
    </clipPath>`).join('');
  const laneGrads = lanes.map((l, i) => `
    <linearGradient id="lane-grad-${i}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${l.color}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${l.color}" stop-opacity="0.02"/>
    </linearGradient>`).join('');
  const defs = `<defs>
    <marker id="trame-arrow" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="rgba(244,196,48,0.75)"/>
    </marker>
    ${clipDefs}${laneGrads}
  </defs>`;

  // ── GRILLE CHRONOLOGIQUE (lignes verticales très subtiles) ──
  const gridLines = Array.from({ length: maxCols }, (_, i) => {
    const x = MAP_HEADER_W + i * MAP_COL_W + MAP_COL_W/2;
    return `<line x1="${x}" y1="${MAP_TOP_PAD - 10}" x2="${x}" y2="${MAP_H - 20}"
      stroke="rgba(255,255,255,0.025)" stroke-width="1" stroke-dasharray="2 6"/>`;
  }).join('');

  // ── COULOIRS (bande + en-tête + ligne de métro + CH.NN) ──
  const lanesSvg = lanes.map((l, idx) => {
    const headerLabel = l.label.length > 22 ? l.label.slice(0, 21) + '…' : l.label;
    const pct = l.list.length ? Math.round(l.term / l.list.length * 100) : 0;
    const fillW = 130 * (l.list.length ? l.term / l.list.length : 0);
    // Endpoints de la ligne de métro = première et dernière colonne occupée par cet axe
    const occupiedCols = [...l.byCol.keys()];
    const firstCol = occupiedCols.length ? Math.min(...occupiedCols) : 0;
    const lastCol  = occupiedCols.length ? Math.max(...occupiedCols) : 0;
    const firstX = MAP_HEADER_W + firstCol * MAP_COL_W + MAP_COL_W/2;
    const lastX  = MAP_HEADER_W + lastCol  * MAP_COL_W + MAP_COL_W/2;
    const laneTop = l.y - l.height/2;
    const headerY = laneTop + 24;
    const headerH = l.height - 48;
    const headerLabelY = l.y - 18;
    return `<g>
      <!-- Bande de fond colorée -->
      <rect x="${MAP_HEADER_W - 8}" y="${laneTop + 18}"
        width="${MAP_W - MAP_HEADER_W}" height="${l.height - 36}"
        fill="url(#lane-grad-${idx})" rx="20"/>
      <!-- Carte d'en-tête à gauche -->
      <rect x="16" y="${headerY}"
        width="${MAP_HEADER_W - 38}" height="${headerH}"
        fill="var(--bg-card)" stroke="${l.color}" stroke-opacity="0.4" stroke-width="1.5" rx="14"/>
      <rect x="16" y="${headerY}" width="4" height="${headerH}" fill="${l.color}" rx="2"/>
      <text x="32" y="${headerLabelY}" fill="${l.color}"
        font-family="Cinzel, serif" font-size="16" font-weight="700">${_esc(headerLabel)}</text>
      <text x="32" y="${l.y + 2}" fill="var(--text-dim)" font-size="10" letter-spacing="0.14em"
        font-family="JetBrains Mono, monospace">
        ${l.list.length} CHAPITRE${l.list.length > 1 ? 'S' : ''}
      </text>
      <rect x="32" y="${l.y + 16}" width="130" height="5" fill="rgba(255,255,255,0.08)" rx="2.5"/>
      <rect x="32" y="${l.y + 16}" width="${fillW.toFixed(1)}" height="5" fill="${l.color}" rx="2.5"/>
      <text x="170" y="${l.y + 21}" fill="${l.color}" font-size="11" font-weight="700"
        font-family="JetBrains Mono, monospace">${pct}%</text>
      <!-- Ligne de métro (glow + solide) — uniquement entre première et dernière colonne -->
      ${l.list.length > 0 && firstCol !== lastCol ? `
        <line x1="${firstX}" y1="${l.y}" x2="${lastX}" y2="${l.y}"
          stroke="${l.color}" stroke-width="14" opacity="0.10" stroke-linecap="round"/>
        <line x1="${firstX}" y1="${l.y}" x2="${lastX}" y2="${l.y}"
          stroke="${l.color}" stroke-width="5" opacity="0.55" stroke-linecap="round"/>
      ` : ''}
      <!-- Pour les sub-rows : connecteur vertical entre la ligne de métro et chaque sous-station -->
      ${[...l.byCol.entries()].map(([col, subs]) => {
        if (subs.length <= 1) return '';
        const x = MAP_HEADER_W + col * MAP_COL_W + MAP_COL_W/2;
        const ys = subs.map(m => positions[m.id]?.y).filter(Number.isFinite);
        if (!ys.length) return '';
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        return `<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}"
          stroke="${l.color}" stroke-width="3" opacity="0.32" stroke-linecap="round"/>`;
      }).join('')}
      <!-- Numéros de chapitre au-dessus de chaque station, basés sur l'ordre GLOBAL -->
      ${l.list.map(m => {
        const p = positions[m.id]; if (!p) return '';
        const colIdx = ordreToCol.get(m.ordre || 0) ?? 0;
        return `<text x="${p.x}" y="${p.y - MAP_NODE_R - 22}"
          text-anchor="middle" fill="var(--text-dim)" font-size="9"
          letter-spacing="0.18em" font-weight="700"
          font-family="JetBrains Mono, monospace">CH.${String(colIdx + 1).padStart(2,'0')}</text>`;
      }).join('')}
    </g>`;
  }).join('');

  // ── LIENS INTER-AXES uniquement (S-curves verticales pointillées) ──
  const itemMap = new Map(missions.map(m => [m.id, m]));
  const crossLiens = [];
  missions.forEach(m => (m.liens || []).forEach(tid => {
    const fp = positions[m.id], tp = positions[tid];
    if (!fp || !tp || !itemMap.has(tid)) return;
    if (Math.abs(fp.y - tp.y) > 5) crossLiens.push({ fp, tp });
  }));
  const liensSvg = crossLiens.map(({ fp, tp }) => {
    const midY = (fp.y + tp.y) / 2;
    const d = `M${fp.x} ${fp.y} C${fp.x} ${midY} ${tp.x} ${midY} ${tp.x} ${tp.y}`;
    return `<g>
      <path d="${d}" stroke="rgba(244,196,48,0.10)" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="${d}" stroke="rgba(244,196,48,0.65)" stroke-width="2.2" stroke-dasharray="7 5"
        fill="none" marker-end="url(#trame-arrow)" class="map-edge"/>
    </g>`;
  }).join('');

  // ── STATIONS (nœuds illustrés) ──
  const nodesSvg = missions.map(m => {
    const p = positions[m.id]; if (!p) return '';
    const st = stCfg(m);
    const axeCol = m.axe ? (_axeMap[m.axe] || '#7a8fa8') : '#7a8fa8';
    const prog = itemProgress(m);
    const init = (m.titre || '?')[0]?.toUpperCase() || '?';
    const progR = MAP_NODE_R + 6;
    const progAng = (Math.max(0, Math.min(100, prog)) / 100) * 360;
    const endX = p.x + progR * Math.sin(progAng * Math.PI / 180);
    const endY = p.y - progR * Math.cos(progAng * Math.PI / 180);
    const largeArc = progAng > 180 ? 1 : 0;
    const progPath = progAng > 0
      ? `M${p.x} ${p.y - progR} A${progR} ${progR} 0 ${largeArc} 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`
      : '';
    return `<g class="map-node" data-id="${_esc(m.id)}"
        style="--node-color:${st.color};--axe-color:${axeCol}"
        tabindex="0" role="button" aria-label="${_esc(m.titre||'')}">
      <circle cx="${p.x}" cy="${p.y}" r="${MAP_NODE_R + 18}" fill="${axeCol}" opacity="0.10"/>
      <circle cx="${p.x}" cy="${p.y}" r="${MAP_NODE_R + 3}" fill="var(--bg-void)"/>
      <circle class="map-node-ring" cx="${p.x}" cy="${p.y}" r="${MAP_NODE_R + 2}"
        fill="var(--bg-card)" stroke="${st.color}" stroke-width="3"/>
      ${progPath ? `<path d="${progPath}" stroke="${st.color}" stroke-width="3.5"
        fill="none" stroke-linecap="round" opacity="0.9"/>` : ''}
      ${m.imageUrl
        ? `<image href="${_esc(m.imageUrl)}" x="${p.x - MAP_NODE_R}" y="${p.y - MAP_NODE_R}"
            width="${MAP_NODE_R*2}" height="${MAP_NODE_R*2}"
            clip-path="url(#st-clip-${_esc(m.id)})" preserveAspectRatio="xMidYMid slice"/>`
        : `<text x="${p.x}" y="${p.y}" text-anchor="middle" dy=".35em"
            font-family="Cinzel, serif" font-weight="700" font-size="22"
            fill="${st.color}">${_esc(init)}</text>`}
      <circle cx="${p.x + MAP_NODE_R - 4}" cy="${p.y - MAP_NODE_R + 4}"
        r="9" fill="${st.color}" stroke="var(--bg-card)" stroke-width="2"/>
      <text x="${p.x + MAP_NODE_R - 4}" y="${p.y - MAP_NODE_R + 4}"
        text-anchor="middle" dy=".34em" font-size="10" font-weight="700"
        fill="#0b0814">${st.icon}</text>
      <text class="map-node-label" x="${p.x}" y="${p.y + MAP_NODE_R + 22}"
        text-anchor="middle" font-size="13" font-weight="600" fill="var(--text)">
        ${_esc((m.titre || '').slice(0, 22))}${(m.titre||'').length > 22 ? '…' : ''}
      </text>
      ${m.date ? `<text x="${p.x}" y="${p.y + MAP_NODE_R + 38}" text-anchor="middle"
        font-size="9" fill="var(--text-dim)" font-family="JetBrains Mono, monospace">
        ${_esc(m.date)}</text>` : ''}
    </g>`;
  }).join('');

  const prefs = getStoryPrefs();
  return `
    <div class="map-shell">
      <div class="map-toolbar">
        <button class="map-tool" onclick="window._stMapZoom(0.85)" title="Dézoomer">−</button>
        <span class="map-zoom-val">${Math.round(prefs.zoom * 100)}%</span>
        <button class="map-tool" onclick="window._stMapZoom(1.18)" title="Zoomer">+</button>
        <button class="map-tool" onclick="window._stMapReset()" title="Recentrer">⊙</button>
        <span class="map-hint">Chaque ligne = un axe narratif · Stations dans l'ordre des chapitres · Pointillés dorés = liens inter-axes</span>
      </div>
      <div class="map-viewport" id="st-map-viewport">
        <svg id="st-map-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" class="map-svg"
          preserveAspectRatio="xMidYMid meet">
          ${defs}
          ${gridLines}
          ${lanesSvg}
          ${liensSvg}
          ${nodesSvg}
        </svg>
        <div class="map-tooltip" id="st-map-tooltip" style="display:none"></div>
      </div>
    </div>`;
}

// Interactions carte : zoom molette + boutons, pan, hover tooltip, clic = détail
function _initMapInteractions() {
  const viewport = document.getElementById('st-map-viewport');
  const svg = document.getElementById('st-map-svg');
  const tooltip = document.getElementById('st-map-tooltip');
  if (!viewport || !svg) return;

  const prefs = getStoryPrefs();
  let zoom = prefs.zoom || 1, panX = prefs.panX || 0, panY = prefs.panY || 0;
  const apply = () => {
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    svg.style.transformOrigin = '0 0';
    const zVal = viewport.parentElement?.querySelector('.map-zoom-val');
    if (zVal) zVal.textContent = `${Math.round(zoom*100)}%`;
  };
  apply();

  let saveTimer = null;
  const persist = (patch) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setStoryPrefs(patch), 400);
  };

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nz = Math.max(0.4, Math.min(3, zoom * delta));
    if (nz === zoom) return;
    const rect = viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    panX = cx - (cx - panX) * (nz / zoom);
    panY = cy - (cy - panY) * (nz / zoom);
    zoom = nz;
    apply();
    persist({ zoom, panX, panY });
  }, { passive: false });

  window._stMapZoom = (factor) => {
    const rect = viewport.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const nz = Math.max(0.4, Math.min(3, zoom * factor));
    panX = cx - (cx - panX) * (nz / zoom);
    panY = cy - (cy - panY) * (nz / zoom);
    zoom = nz;
    apply();
    setStoryPrefs({ zoom, panX, panY });
  };
  window._stMapReset = () => { zoom = 1; panX = 0; panY = 0; apply(); setStoryPrefs({ zoom, panX, panY }); };

  // Pan + click
  let panStart = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map-node')) return;  // clic sur nœud géré au pointerup
    panStart = { x: e.clientX, y: e.clientY, panX0: panX, panY0: panY, moved: false };
    viewport.classList.add('is-panning');
    viewport.setPointerCapture?.(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (panStart) {
      const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
      if (Math.hypot(dx, dy) > 2) panStart.moved = true;
      panX = panStart.panX0 + dx; panY = panStart.panY0 + dy;
      apply();
      return;
    }
    const node = e.target.closest?.('.map-node');
    if (node && tooltip) {
      const item = _mapItemsCache.find(i => i.id === node.dataset.id);
      if (item) {
        const st = stCfg(item);
        const axeCol = item.axe ? (_axeMap[item.axe] || '#7a8fa8') : '#7a8fa8';
        tooltip.innerHTML = `
          <div class="tip-titre" style="color:${st.color}">${st.icon} ${_esc(item.titre || 'Sans titre')}</div>
          ${item.axe ? `<div class="tip-axe" style="color:${axeCol}">● ${_esc(item.axe)}</div>` : ''}
          ${item.date ? `<div class="tip-meta">📅 ${_esc(item.date)}</div>` : ''}
          ${item.lieu ? `<div class="tip-meta">📍 ${_esc(item.lieu)}</div>` : ''}
          ${(item.participants||[]).length ? `<div class="tip-meta">👥 ${item.participants.length} participant${item.participants.length>1?'s':''}</div>` : ''}
        `;
        const rect = viewport.getBoundingClientRect();
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
        tooltip.style.top  = (e.clientY - rect.top + 14) + 'px';
      }
    } else if (tooltip) {
      tooltip.style.display = 'none';
    }
  });
  viewport.addEventListener('pointerup', (e) => {
    if (panStart) {
      const moved = panStart.moved;
      panStart = null;
      viewport.classList.remove('is-panning');
      persist({ panX, panY });
      if (moved) return;
    }
    const node = e.target.closest?.('.map-node');
    if (node) openStoryDetail(node.dataset.id);
  });
  viewport.addEventListener('pointerleave', () => { if (tooltip) tooltip.style.display = 'none'; });
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE SAGA — Étagères horizontales par axe (handoff §7)
// ══════════════════════════════════════════════════════════════════════════════
function _renderSagaView(missions) {
  const byAxe = new Map();
  missions.forEach(m => {
    const k = m.axe || '__none__';
    if (!byAxe.has(k)) byAxe.set(k, []);
    byAxe.get(k).push(m);
  });
  byAxe.forEach(list => list.sort((a,b) => (a.ordre||0) - (b.ordre||0)));

  return `<div class="saga">
    ${[...byAxe.entries()].map(([axe, list]) => {
      const color = axe === '__none__' ? '#7a8fa8' : (_axeMap[axe] || '#7a8fa8');
      const label = axe === '__none__' ? 'Hors axe' : axe;
      const term = list.filter(m => m.statut === 'Terminée').length;
      const pct = list.length ? Math.round((term / list.length) * 100) : 0;
      return `<section class="shelf" style="--axe-color:${color}">
        <header class="shelf-head">
          <span class="shelf-marker"></span>
          <h2 class="shelf-title">${_esc(label)}</h2>
          <span class="shelf-count">${list.length} CH.</span>
          <span class="shelf-rule"></span>
          <div class="shelf-prog">
            <div class="shelf-bar"><div class="shelf-fill" style="width:${pct}%"></div></div>
            <span class="shelf-pct">${pct}%</span>
          </div>
        </header>
        <div class="rail">
          ${list.map((m, i) => _renderPoster(m, i)).join('')}
        </div>
      </section>`;
    }).join('')}
  </div>`;
}

function _renderPoster(m, idx) {
  const st = stCfg(m);
  const prog = itemProgress(m);
  const parts = m.participants || [];
  return `<article class="poster" style="--st-color:${st.color}" onclick="openStoryDetail('${m.id}')">
    <div class="poster-art">
      ${m.imageUrl
        ? `<img src="${_esc(m.imageUrl)}" alt="" loading="lazy">`
        : `<div class="poster-fallback">${m.type === 'mission' ? '🎯' : '📖'}</div>`}
      <div class="poster-num">CH.${String(idx + 1).padStart(2,'0')}</div>
      <div class="poster-statut">${st.icon} ${_esc(m.statut || 'En attente')}</div>
      <div class="poster-prog"><div class="poster-prog-fill" style="width:${prog}%"></div></div>
    </div>
    <div class="poster-body">
      <h3 class="poster-title">${_esc(m.titre || 'Sans titre')}</h3>
      ${m.date ? `<div class="poster-date">${_esc(m.date)}</div>` : ''}
      ${parts.length ? `<div class="poster-parts">
        ${parts.slice(0, 4).map(p => {
          const pp = `${50+(p.photoX||0)*50}% ${50+(p.photoY||0)*50}%`;
          return p.photo
            ? `<span class="poster-part" title="${_esc(p.nom||'')}"><img src="${_esc(p.photo)}" style="object-position:${pp}"></span>`
            : `<span class="poster-part">${(p.nom||'?')[0]?.toUpperCase()}</span>`;
        }).join('')}
        ${parts.length > 4 ? `<span class="poster-part-more">+${parts.length-4}</span>` : ''}
      </div>` : ''}
    </div>
  </article>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE CHRONIQUE — Chapitres livre (handoff §8)
// ══════════════════════════════════════════════════════════════════════════════
function _renderChroniqueView(missions) {
  const sorted = [...missions].sort((a,b) => (a.ordre||0)-(b.ordre||0) || (a.date||'').localeCompare(b.date||''));
  return `<div class="chronique">
    ${sorted.map((m, i) => {
      const st = stCfg(m);
      const prog = itemProgress(m);
      const axeCol = m.axe ? (_axeMap[m.axe] || '#7a8fa8') : '#7a8fa8';
      const parts = m.participants || [];
      return `<article class="chap" style="--axe-color:${axeCol};--st-color:${st.color}">
        <div class="chap-side">
          <div class="chap-num">${String(i+1).padStart(2,'0')}</div>
          ${i < sorted.length-1 ? '<div class="chap-thread"></div>' : ''}
        </div>
        <div class="chap-body" onclick="openStoryDetail('${m.id}')">
          ${m.imageUrl ? `<div class="chap-banner"><img src="${_esc(m.imageUrl)}" alt=""></div>` : ''}
          <div class="chap-meta-top">
            ${m.axe ? `<span class="chap-axe">${_esc(m.axe)}</span>` : ''}
            <span class="chap-statut">${st.icon} ${_esc(m.statut || 'En attente')}</span>
            ${m.date ? `<span class="chap-date">📅 ${_esc(m.date)}</span>` : ''}
            ${m.lieu ? `<span class="chap-date">📍 ${_esc(m.lieu)}</span>` : ''}
          </div>
          <h2 class="chap-title">${_esc(m.titre || 'Sans titre')}</h2>
          ${m.description
            ? `<p class="chap-desc">${_nl2br(_esc(m.description))}</p>`
            : `<p class="chap-desc-empty">— La chronique ne dit rien de cette mission —</p>`}
          <div class="chap-foot">
            ${parts.length ? `<div class="chap-parts">
              ${parts.slice(0, 10).map(p => {
                const pp = `${50+(p.photoX||0)*50}% ${50+(p.photoY||0)*50}%`;
                return p.photo
                  ? `<span class="chap-part" title="${_esc(p.nom||'')}"><img src="${_esc(p.photo)}" style="object-position:${pp}"></span>`
                  : `<span class="chap-part">${(p.nom||'?')[0]?.toUpperCase()}</span>`;
              }).join('')}
            </div>` : '<div></div>'}
            <div class="chap-prog">
              <span class="chap-prog-val">${prog}%</span>
              <div class="chap-prog-bar"><div style="width:${prog}%;background:${st.color}"></div></div>
            </div>
          </div>
        </div>
      </article>`;
    }).join('')}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE LISTE — Tableau compact (handoff §9)
// ══════════════════════════════════════════════════════════════════════════════
function _renderListView(missions) {
  return `<div class="list"><div class="list-table">
    <div class="list-head">
      <div>#</div>
      <div>Mission</div>
      <div>Axe</div>
      <div>Statut</div>
      <div>Progression</div>
      <div>Date</div>
    </div>
    ${missions.map((m, i) => {
      const st = stCfg(m);
      const prog = itemProgress(m);
      const axeCol = m.axe ? (_axeMap[m.axe] || '#7a8fa8') : '#7a8fa8';
      return `<div class="list-row" style="--axe-color:${axeCol};--st-color:${st.color}"
        onclick="openStoryDetail('${m.id}')">
        <div class="list-num">${String(i+1).padStart(2,'0')}</div>
        <div class="list-titre">${_esc(m.titre || 'Sans titre')}${m.lieu ? `<span class="list-lieu"> · ${_esc(m.lieu)}</span>` : ''}</div>
        <div class="list-axe">${m.axe ? `<span class="list-axe-dot"></span><span>${_esc(m.axe)}</span>` : '<span style="color:var(--text-dim)">—</span>'}</div>
        <div class="list-statut">${st.icon} ${_esc(m.statut || 'En attente')}</div>
        <div class="list-prog">
          <div class="list-prog-bar"><div class="list-prog-fill" style="width:${prog}%"></div></div>
          <span class="list-prog-val">${prog}%</span>
        </div>
        <div class="list-date">${m.date ? _esc(m.date) : '—'}</div>
      </div>`;
    }).join('')}
  </div></div>`;
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
            ${STATE.isAdmin && item.visibleJoueurs === false ? `<div style="position:absolute;bottom:26px;left:5px;background:rgba(11,17,24,.85);
              border:1px solid rgba(255,107,107,.3);border-radius:999px;padding:1px 6px;
              font-size:.6rem;color:#ff6b6b">🔒</div>` : ''}
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
        <div style="display:flex;gap:3px;margin-top:4px;justify-content:center;flex-wrap:wrap">
          <button class="sn-histoire-btn"
            onclick="event.stopPropagation();window._ouvrirHistoire('${item.id}','${(item.titre||'').replace(/'/g,"\\'")}','${(item.acte||'').replace(/'/g,"\\'")}')">
            ✍️ Histoire
          </button>
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
  const items = await loadCollection('story');
  const item = items.find(i => i.id === id); if (!item) return;
  const st = stCfg(item);
  const groupes = item.groupes || [];
  const liensItems = (item.liens || []).map(lid => items.find(i => i.id === lid)).filter(Boolean);
  const totalMembers = (() => {
    const s = new Set();
    groupes.forEach(g => (g.membres || []).forEach(m => s.add(m)));
    return s.size;
  })();
  const prog = itemProgress(item);
  const axeCol = item.axe ? (_axeMap[item.axe] || 'var(--text-muted)') : 'var(--text-muted)';
  const bgUrl = (item.imageUrl || '').replace(/'/g, "%27");

  // Helper avatar
  const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars = STATE.characters || [];
  const avatar = (c, size = 36) => {
    if (!c) return '';
    const col = PCOLS[c.nom?.charCodeAt(0) % 6 || 0];
    const pp  = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
    return `<div class="mv-avatar" style="--col:${col};width:${size}px;height:${size}px" title="${_esc(c.nom||'')}">
      ${c.photo
        ? `<img src="${_esc(c.photo)}" style="object-position:${pp}">`
        : `<span>${_esc((c.nom||'?')[0]?.toUpperCase() || '?')}</span>`}
    </div>`;
  };

  openModal('', `
  <div class="mv-shell">

    <!-- ── Hero ───────────────────────────────────────────────── -->
    <div class="mv-hero">
      <div class="mv-hero-bg" ${item.imageUrl ? `style="background-image:url('${_esc(bgUrl)}')"` : ''}></div>
      <div class="mv-hero-fade"></div>
      <div class="mv-hero-content">
        <div class="mv-hero-eyebrow">
          <span>${_esc(item.acte || 'Acte I')}</span>
          <span class="mv-hero-eyebrow-sep">·</span>
          <span>${item.type === 'event' ? 'Événement' : 'Mission'}</span>
        </div>
        <h1 class="mv-hero-title">${_esc(item.titre || 'Sans titre')}</h1>
        <div class="mv-hero-meta">
          <span class="mv-hero-statut" style="color:${st.color};border-color:${st.border}">
            ${st.icon} <span>${_esc(item.statut || 'En attente')}</span>
          </span>
          ${item.axe ? `<span class="mv-hero-axe" style="color:${axeCol}">● ${_esc(item.axe)}</span>` : ''}
          ${item.date ? `<span class="mv-hero-meta-item">📅 ${_esc(item.date)}</span>` : ''}
          ${item.lieu ? `<span class="mv-hero-meta-item">📍 ${_esc(item.lieu)}</span>` : ''}
        </div>
      </div>
      ${prog > 0 ? `<div class="mv-hero-prog">
        <div class="mv-hero-prog-fill" style="width:${prog}%;background:${st.color}"></div>
      </div>` : ''}
    </div>

    <!-- ── Stats bar ──────────────────────────────────────────── -->
    <div class="mv-stats">
      <div class="mv-stat">
        <div class="mv-stat-num" style="color:${st.color}">${prog}<small>%</small></div>
        <div class="mv-stat-lbl">Avancement</div>
      </div>
      <div class="mv-stat">
        <div class="mv-stat-num">${groupes.length}</div>
        <div class="mv-stat-lbl">Groupe${groupes.length > 1 ? 's' : ''}</div>
      </div>
      <div class="mv-stat">
        <div class="mv-stat-num">${totalMembers}</div>
        <div class="mv-stat-lbl">Personnage${totalMembers > 1 ? 's' : ''}</div>
      </div>
      ${liensItems.length ? `<div class="mv-stat">
        <div class="mv-stat-num">${liensItems.length}</div>
        <div class="mv-stat-lbl">Suite${liensItems.length > 1 ? 's' : ''}</div>
      </div>` : ''}
    </div>

    <!-- ── Body : sections ────────────────────────────────────── -->
    <div class="mv-body">

      <!-- Récit -->
      ${item.description ? `
      <section class="mv-section">
        <h3 class="mv-section-title">📜 Récit</h3>
        <div class="mv-recit">${_nl2br(_esc(item.description))}</div>
      </section>` : `
      <section class="mv-section">
        <div class="mv-empty">
          <span>📜</span>
          <span>Aucun récit n'a encore été écrit pour cette mission.</span>
        </div>
      </section>`}

      <!-- Groupes & Réussites -->
      ${groupes.length ? `
      <section class="mv-section">
        <h3 class="mv-section-title">
          👥 Groupes & Réussites
          <span class="mv-section-count">${groupes.length}</span>
        </h3>
        <div class="mv-groups">
          ${groupes.map(g => {
            const membres = (g.membres || []).map(mid => chars.find(c => c.id === mid)).filter(Boolean);
            const gr = parseInt(g.reussite) || 0;
            const grColor = gr >= 80 ? '#22c38e' : gr >= 40 ? '#e8b84b' : gr > 0 ? '#ff8a4c' : 'var(--text-dim)';
            const notes = (g.notesReussite || '').split('\n').map(l => l.trim()).filter(Boolean);
            return `<article class="mv-group" style="--gr-color:${grColor}">
              <header class="mv-group-head">
                <h4 class="mv-group-name">${_esc(g.nom)}</h4>
                ${gr > 0 ? `<div class="mv-group-pct">${gr}<small>%</small></div>` : ''}
              </header>
              ${membres.length ? `<div class="mv-group-members">
                ${membres.map(c => `<div class="mv-group-member">
                  ${avatar(c, 38)}
                  <span class="mv-group-member-name">${_esc(c.nom || '')}</span>
                </div>`).join('')}
              </div>` : `<div class="mv-empty-small">Aucun membre rattaché.</div>`}
              ${gr > 0 ? `<div class="mv-group-bar">
                <div class="mv-group-bar-fill" style="width:${gr}%"></div>
              </div>` : ''}
              ${notes.length ? `<ul class="mv-group-notes">
                ${notes.map(n => `<li>${_esc(n)}</li>`).join('')}
              </ul>` : ''}
              ${g.recompense ? `<div class="mv-group-reward">
                <span class="mv-group-reward-icon">🏆</span>
                <span>${_esc(g.recompense)}</span>
              </div>` : ''}
            </article>`;
          }).join('')}
        </div>
      </section>` : ''}

      <!-- Suites ouvertes -->
      ${liensItems.length ? `
      <section class="mv-section">
        <h3 class="mv-section-title">
          ↝ Suites ouvertes
          <span class="mv-section-count">${liensItems.length}</span>
        </h3>
        <div class="mv-liens">
          ${liensItems.map(l => {
            const lst = stCfg(l);
            const lAxeCol = l.axe ? (_axeMap[l.axe] || 'var(--text-muted)') : 'var(--text-muted)';
            return `<button class="mv-lien" onclick="closeModalDirect();openStoryDetail('${l.id}')">
              <div class="mv-lien-art">
                ${l.imageUrl
                  ? `<img src="${_esc(l.imageUrl)}" alt="" loading="lazy">`
                  : `<div class="mv-lien-fallback">${l.type === 'mission' ? '🎯' : '📖'}</div>`}
                <div class="mv-lien-statut" style="color:${lst.color};border-color:${lst.border}">${lst.icon}</div>
              </div>
              <div class="mv-lien-body">
                <div class="mv-lien-title">${_esc(l.titre || 'Sans titre')}</div>
                ${l.axe ? `<div class="mv-lien-axe" style="color:${lAxeCol}">● ${_esc(l.axe)}</div>` : ''}
              </div>
            </button>`;
          }).join('')}
        </div>
      </section>` : ''}

    </div><!-- /mv-body -->

    <!-- ── Footer ─────────────────────────────────────────────── -->
    <div class="mv-footer">
      <button class="btn btn-outline btn-sm" onclick="closeModalDirect()">Fermer</button>
      ${STATE.isAdmin ? `
        <button class="btn btn-outline btn-sm mv-footer-danger" onclick="closeModalDirect();deleteStory('${item.id}')">🗑️ Supprimer</button>
        <button class="btn btn-gold" onclick="closeModalDirect();editStory('${item.id}')">✏️ Modifier</button>
      ` : ''}
    </div>

  </div><!-- /mv-shell -->
  `);
}

// ── MODAL AJOUT / ÉDITION ─────────────────────────────────────────────────────
async function openStoryModal(item = null) {
  _stCropper?.destroy(); _stCropper = null;
  const acteActif   = window._storyActe || 'Acte I';
  const allItems    = await loadCollection('story');
  const autresItems = allItems.filter(i => i.id !== item?.id);
  _modalGroupes = [...(item?.groupes || [])];
  _modalStoryId = item?.id || '';

  // Statuts disponibles + config visuelle pour les pills
  const STATUTS = [
    { v: 'En cours',   c: 'var(--st-cours)',    i: '▶' },
    { v: 'Terminée',   c: 'var(--st-terminee)', i: '✓' },
    { v: 'En attente', c: 'var(--st-attente)',  i: '◷' },
    { v: 'Échouée',    c: 'var(--st-echec)',    i: '✗' },
  ];
  const curStatut = item?.statut || 'En cours';

  // Liste des axes existants (autocomplete)
  const knownAxes = [...new Set(allItems.map(i => i.axe).filter(Boolean))].sort();

  openModal('', `
  <div class="mn-shell">

    <!-- ════ HERO BANNER — preview live + image drop integré ═══════ -->
    <div class="mn-hero" id="mn-hero">
      <div class="mn-hero-bg" id="mn-hero-bg"
        style="${item?.imageUrl ? `background-image:url('${_esc(item.imageUrl).replace(/'/g,"%27")}')` : ''}"></div>
      <div class="mn-hero-fade"></div>

      <!-- Drop zone overlay (cropper rattaché) -->
      <div id="st-drop-zone" class="mn-hero-drop" title="Cliquer ou déposer une image">
        <div id="st-drop-preview"></div>
        <div class="mn-hero-drop-hint">
          <span class="mn-hero-drop-icon">🖼️</span>
          <span>Glisser une image ou cliquer pour ouvrir</span>
        </div>
      </div>

      <!-- Contenu hero : eyebrow + titre + meta -->
      <div class="mn-hero-content">
        <div class="mn-hero-eyebrow">
          <span id="mn-acte-preview">${_esc(item?.acte || acteActif)}</span>
          <span class="mn-hero-eyebrow-sep">·</span>
          <span id="mn-type-preview">${(item?.type || 'mission') === 'event' ? 'Événement' : 'Mission'}</span>
        </div>
        <input type="text" class="mn-hero-title" id="st-titre"
          value="${_esc(item?.titre||'')}"
          placeholder="${item ? _esc(item.titre || '') : 'Donne un nom à ta mission…'}"
          autocomplete="off" autofocus>
        <div class="mn-hero-meta">
          <span class="mn-hero-statut" id="mn-statut-preview"
            style="color:${stCfg({statut:curStatut}).color};border-color:${stCfg({statut:curStatut}).border}">
            ${stCfg({statut:curStatut}).icon} <span>${_esc(curStatut)}</span>
          </span>
          <span class="mn-hero-axe" id="mn-axe-preview"
            style="${item?.axe ? `color:${_axeMap[item.axe] || 'var(--text-muted)'}` : ''}">
            ${item?.axe ? `● ${_esc(item.axe)}` : ''}
          </span>
        </div>
      </div>

      <!-- Cropper inline (apparaît quand on upload une image) -->
      <div id="st-crop-wrap" class="mn-crop-wrap" style="display:none">
        <canvas id="st-crop-canvas"></canvas>
        <div class="mn-crop-bar">
          <span class="mn-crop-hint">Recadre · ratio 4:3</span>
          <button type="button" class="btn btn-gold btn-sm" id="st-crop-confirm">✂️ Confirmer</button>
          <div id="st-crop-ok" style="display:none;font-size:.75rem"></div>
        </div>
      </div>
    </div>

    <!-- ════ TABS ════════════════════════════════════════════════ -->
    <div class="mn-tabs" role="tablist">
      <button type="button" class="mn-tab is-active" data-tab="histoire">📜 Histoire</button>
      <button type="button" class="mn-tab" data-tab="groupes">👥 Groupes <span class="mn-tab-count" id="mn-tab-count-groupes">${_modalGroupes.length || ''}</span></button>
      ${autresItems.length ? `<button type="button" class="mn-tab" data-tab="liens">↝ Liens <span class="mn-tab-count" id="mn-tab-count-liens">${(item?.liens||[]).length || ''}</span></button>` : ''}
      <button type="button" class="mn-tab" data-tab="reglages">⚙️ Réglages</button>
    </div>

    <!-- ════ TAB CONTENT ═════════════════════════════════════════ -->
    <div class="mn-body">

      <!-- ── ONGLET HISTOIRE ────────────────────────────────────── -->
      <section class="mn-panel is-active" data-panel="histoire">

        <!-- Type segmented control -->
        <div class="mn-row">
          <label class="mn-label">Type</label>
          <div class="mn-segmented" id="mn-type-seg">
            <button type="button" class="mn-seg ${(item?.type||'mission')==='mission'?'is-active':''}" data-type="mission">🎯 Mission</button>
            <button type="button" class="mn-seg ${item?.type==='event'?'is-active':''}" data-type="event">📖 Événement</button>
          </div>
          <input type="hidden" id="st-type" value="${item?.type || 'mission'}">
        </div>

        <!-- Statut en pills cliquables -->
        <div class="mn-row">
          <label class="mn-label">Statut</label>
          <div class="mn-statut-pills" id="mn-statut-pills">
            ${STATUTS.map(s => `<button type="button"
              class="mn-statut-pill ${s.v===curStatut?'is-active':''}"
              data-statut="${s.v}"
              style="--c:${s.c}">
              <span class="mn-statut-pill-icon">${s.i}</span>${s.v}
            </button>`).join('')}
          </div>
          <input type="hidden" id="st-statut" value="${curStatut}">
        </div>

        <!-- Grille axe + date + lieu -->
        <div class="mn-grid-2">
          <div class="mn-field">
            <label class="mn-label">Axe narratif</label>
            <div class="mn-axe-wrap">
              <input type="text" class="mn-input" id="st-axe"
                value="${_esc(item?.axe||'')}" placeholder="ex: Mystères de Granlac"
                list="st-axe-list" autocomplete="off">
              <datalist id="st-axe-list">
                ${knownAxes.map(a => `<option value="${_esc(a)}">`).join('')}
              </datalist>
            </div>
            ${knownAxes.length ? `<div class="mn-axe-chips">
              ${knownAxes.slice(0, 5).map(a => `<button type="button" class="mn-axe-chip"
                style="color:${_axeMap[a] || 'var(--text-muted)'};border-color:${_axeMap[a] ? _axeMap[a] + '55' : 'var(--border)'}"
                onclick="document.getElementById('st-axe').value='${a.replace(/'/g,"\\'")}';document.getElementById('st-axe').dispatchEvent(new Event('input'))">
                ● ${_esc(a)}
              </button>`).join('')}
            </div>` : ''}
          </div>
          <div class="mn-field">
            <label class="mn-label">Date / Session</label>
            <input type="text" class="mn-input" id="st-date"
              value="${_esc(item?.date||'')}" placeholder="Session 1, 27 Mars 1247…">
          </div>
        </div>

        <div class="mn-field">
          <label class="mn-label">Lieu</label>
          <input type="text" class="mn-input" id="st-lieu"
            value="${_esc(item?.lieu||'')}" placeholder="Forêt du Cap d'Espérance">
        </div>

        <!-- Description : large -->
        <div class="mn-field">
          <label class="mn-label">Description <span class="mn-label-hint">— ce que le récit raconte</span></label>
          <textarea class="mn-input mn-textarea" id="st-desc" rows="5"
            placeholder="Quelques lignes pour camper la mission, ses enjeux, ses lieux clés…">${_esc(item?.description||'')}</textarea>
        </div>
      </section>

      <!-- ── ONGLET GROUPES ─────────────────────────────────────── -->
      <section class="mn-panel" data-panel="groupes">
        <div class="mn-panel-intro">
          Les personnages sont rattachés à un <strong>groupe</strong>. Plusieurs groupes peuvent
          mener la même mission en parallèle, chacun avec sa propre réussite et récompense.
        </div>
        <div id="st-groups-list" class="st-groups-list">
          ${_renderGroupCards(_modalGroupes)}
        </div>
        <button type="button" class="st-group-add" onclick="window._stSaveGroupDialog()">+ Nouveau groupe</button>

        <div id="st-save-group-form" class="st-group-form" style="display:none">
          <div id="st-group-form-title" class="st-form-section-sub">Nouveau groupe</div>
          <div class="mn-field">
            <label class="mn-label">Nom du groupe</label>
            <input id="st-save-group-name" class="mn-input"
              placeholder="Avant-garde, Trio des cendres…" maxlength="40"
              onkeydown="if(event.key==='Enter')window._stConfirmSaveGroup();if(event.key==='Escape')window._stCancelGroupForm()">
          </div>
          <div class="mn-field">
            <label class="mn-label">
              Membres <span class="mn-label-hint">— clique pour cocher</span>
            </label>
            <div class="mn-picker-search-wrap">
              <span>🔍</span>
              <input type="text" id="mn-picker-search" placeholder="Filtrer un personnage…">
            </div>
            <div id="st-group-picker" class="st-group-picker">
              ${(() => {
                const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
                return (STATE.characters||[]).map(c => {
                  const col = PCOLS[c.nom?.charCodeAt(0)%6||0];
                  const pp  = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
                  return `<div onclick="window._stGroupPickToggle('${c.id}','${col}')"
                    id="st-gpick-${c.id}" data-gm-id="${c.id}" data-picked="0"
                    data-char-name="${_esc((c.nom||'').toLowerCase())}"
                    class="st-group-pick">
                    <div class="st-group-pick-avatar" style="--col:${col}">
                      ${c.photo
                        ? `<img src="${_esc(c.photo)}" style="object-position:${pp}">`
                        : `<span>${(c.nom||'?')[0].toUpperCase()}</span>`}
                    </div>
                    <span class="st-group-pick-name">${_esc(c.nom||'?')}</span>
                  </div>`;
                }).join('') || '<span style="font-size:.75rem;color:var(--text-dim)">Aucun personnage.</span>';
              })()}
            </div>
          </div>
          <div class="st-group-form-actions">
            <button type="button" class="btn btn-gold" onclick="window._stConfirmSaveGroup()">✓ Enregistrer le groupe</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="window._stCancelGroupForm()">Annuler</button>
          </div>
        </div>
      </section>

    ${autresItems.length?`
      <!-- ── ONGLET LIENS ───────────────────────────────────────── -->
      <section class="mn-panel" data-panel="liens">
        <div class="mn-panel-intro">
          Sélectionne les missions qui se déclenchent <strong>après</strong> celle-ci.
          Si elles sont sur un axe différent, un trait pointillé doré les reliera sur la carte.
        </div>
        <div class="mn-liens-search-wrap">
          <span>🔍</span>
          <input type="text" id="mn-liens-search" placeholder="Filtrer les missions…">
        </div>
      <div id="st-liens-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.55rem;margin-top:.4rem">
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
      </section>`:``}

      <!-- ── ONGLET RÉGLAGES ────────────────────────────────────── -->
      <section class="mn-panel" data-panel="reglages">
        <div class="mn-grid-2">
          <div class="mn-field">
            <label class="mn-label">Acte <span class="mn-label-hint">— quel chapitre de la trame</span></label>
            <input type="text" class="mn-input" id="st-acte"
              value="${_esc(item?.acte||acteActif)}" placeholder="Acte I">
          </div>
          <div class="mn-field">
            <label class="mn-label">Ordre <span class="mn-label-hint">— position dans la frise temporelle</span></label>
            <input type="number" class="mn-input" id="st-ordre" value="${item?.ordre||0}" min="0">
          </div>
        </div>

        <label class="mn-toggle">
          <input type="checkbox" id="st-visible" ${item?.visibleJoueurs===false?'':'checked'}>
          <span class="mn-toggle-track"><span class="mn-toggle-thumb"></span></span>
          <span class="mn-toggle-text">
            <strong>Visible aux joueurs</strong>
            <span class="mn-label-hint">décoche pour préparer en secret</span>
          </span>
        </label>

        ${item?.id ? `
        <div class="mn-danger-zone">
          <div class="mn-danger-title">⚠️ Zone dangereuse</div>
          <button type="button" class="mn-btn-danger"
            onclick="closeModal();deleteStory('${item.id}')">🗑️ Supprimer cette mission</button>
        </div>` : ''}
      </section>
    </div><!-- /mn-body -->

    <!-- ════ FOOTER STICKY ═══════════════════════════════════════ -->
    <div class="mn-footer">
      <div class="mn-footer-hint">
        <kbd>Ctrl</kbd>+<kbd>S</kbd> pour enregistrer · <kbd>Esc</kbd> pour fermer
      </div>
      <div class="mn-footer-actions">
        <button class="btn btn-outline btn-sm" onclick="closeModalDirect()">Annuler</button>
        <button class="btn btn-gold" id="mn-save-btn" onclick="saveStory('${item?.id||''}')">
          ${item?'💾 Enregistrer':'＋ Créer la mission'}
        </button>
      </div>
    </div>

  </div><!-- /mn-shell -->
  `);

  // ── Bindings UI : tabs, segmented, statut pills, live preview, raccourcis ──
  _initMissionModalUI(item);

  // Mise à jour d'un champ de résultat sur un groupe en mémoire
  window._stGroupField = (groupId, field, value) => {
    const g = _modalGroupes.find(g => g.id === groupId);
    if (g) g[field] = value;
  };

  // (Anciens handlers participants individuels supprimés — modèle "groupes only")

  window._stGroupPickToggle = (charId, col) => {
    const el = document.getElementById(`st-gpick-${charId}`);
    if (!el) return;
    const picked = el.dataset.picked !== '1';
    el.dataset.picked = picked ? '1' : '0';
    el.style.borderColor = picked ? col : 'var(--border)';
    el.style.background  = picked ? col + '18' : 'var(--bg-elevated)';
    const circle = el.querySelector('div');
    if (circle) circle.style.borderColor = picked ? col : 'rgba(255,255,255,.1)';
    const nameEl = el.querySelector('span');
    if (nameEl) { nameEl.style.color = picked ? col : 'var(--text-dim)'; nameEl.style.fontWeight = picked ? '700' : '400'; }
  };

  const _resetGroupPicker = () => {
    document.querySelectorAll('#st-group-picker [data-picked="1"]').forEach(el => {
      el.dataset.picked = '0';
      el.style.borderColor = 'var(--border)';
      el.style.background  = 'var(--bg-elevated)';
      const circle = el.querySelector('div');
      if (circle) circle.style.borderColor = 'rgba(255,255,255,.1)';
      const nameEl = el.querySelector('span');
      if (nameEl) { nameEl.style.color = 'var(--text-dim)'; nameEl.style.fontWeight = '400'; }
    });
  };

  window._stSaveGroupDialog = () => {
    const form = document.getElementById('st-save-group-form');
    if (!form) return;
    _editingGroupId = null;
    _resetGroupPicker();
    const titleEl = document.getElementById('st-group-form-title');
    if (titleEl) titleEl.textContent = 'Nouveau groupe';
    form.style.display = 'block';
    form.scrollIntoView?.({ behavior:'smooth', block:'nearest' });
    const inp = document.getElementById('st-save-group-name');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 50); }
  };
  window._stCancelGroupForm = () => {
    const form = document.getElementById('st-save-group-form');
    if (form) form.style.display = 'none';
    _editingGroupId = null;
    _resetGroupPicker();
  };

  window._stEditGroup = (groupId) => {
    const g = _modalGroupes.find(x => x.id === groupId);
    if (!g) return;
    const form = document.getElementById('st-save-group-form');
    if (!form) return;
    _editingGroupId = groupId;
    _resetGroupPicker();
    // Pré-sélectionner les membres existants
    const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
    (g.membres || []).forEach(charId => {
      const el = document.getElementById(`st-gpick-${charId}`);
      if (!el || el.dataset.picked === '1') return;
      const char = (STATE.characters||[]).find(c => c.id === charId);
      const col  = char ? PCOLS[char.nom?.charCodeAt(0)%6||0] : '#4f8cff';
      window._stGroupPickToggle(charId, col);
    });
    const titleEl = document.getElementById('st-group-form-title');
    if (titleEl) titleEl.textContent = `Modifier « ${g.nom} »`;
    form.style.display = 'block';
    form.scrollIntoView?.({ behavior:'smooth', block:'nearest' });
    const inp = document.getElementById('st-save-group-name');
    if (inp) { inp.value = g.nom || ''; setTimeout(() => inp.focus(), 50); }
  };

  window._stConfirmSaveGroup = async () => {
    const nom = document.getElementById('st-save-group-name')?.value?.trim();
    if (!nom) { showNotif('Donne un nom au groupe.', 'error'); return; }
    const membres = [...document.querySelectorAll('#st-group-picker [data-picked="1"]')]
      .map(el => el.dataset.gmId).filter(Boolean);
    if (!membres.length) { showNotif('Sélectionne au moins un membre.', 'error'); return; }
    if (_editingGroupId) {
      // Mise à jour d'un groupe existant (conserver les champs reussite/recompense/notes)
      _modalGroupes = _modalGroupes.map(g =>
        g.id === _editingGroupId ? { ...g, nom, membres } : g
      );
      _editingGroupId = null;
      showNotif(`Groupe « ${nom} » mis à jour.`, 'success');
    } else {
      _modalGroupes = [..._modalGroupes, { id: 'g' + Date.now(), nom, membres }];
      showNotif(`Groupe « ${nom} » créé.`, 'success');
    }
    await _saveModalGroupes();
    _refreshStGroupsRow(_modalGroupes);
    const form = document.getElementById('st-save-group-form');
    if (form) form.style.display = 'none';
  };

  window._stDeleteGroup = async (groupId) => {
    if (!await confirmModal('Supprimer ce groupe de participants ?')) return;
    _modalGroupes = _modalGroupes.filter(g => g.id !== groupId);
    await _saveModalGroupes();
    _refreshStGroupsRow(_modalGroupes);
  };

  // ── Upload + crop image (4:3 verrouillé) ──────────────────────────────────
  _stCropper?.destroy();
  _stCropper = attachDropAndCrop({
    dropEl:        document.getElementById('st-drop-zone'),
    previewEl:     document.getElementById('st-drop-preview'),
    cropWrapEl:    document.getElementById('st-crop-wrap'),
    canvasId:      'st-crop-canvas',
    statusEl:      document.getElementById('st-crop-ok'),
    confirmBtnEl:  document.getElementById('st-crop-confirm'),
    initialUrl:    item?.imageUrl || '',
    ratio:         { w: 4, h: 3 },
    previewMaxH:   70,
    output:        { maxW: 800, target: 700_000 },
    onResult: (b64) => {
      // Sync live le fond du hero avec l'image confirmée
      const hero = document.getElementById('mn-hero-bg');
      if (!hero) return;
      if (b64) hero.style.backgroundImage = `url("${String(b64).replace(/"/g,'%22')}")`;
      else hero.style.backgroundImage = '';
    },
  });

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

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveStory(id = '') {
  try {
    const titre=document.getElementById('st-titre')?.value?.trim();
    if(!titre){showNotif('Le titre est requis.','error');return;}

    // Image : nouveau crop > existante (pas de bouton "retirer")
    const cropResult = _stCropper?.getResult();
    let imageUrl = '';
    if (typeof cropResult === 'string') {
      imageUrl = cropResult;
    } else if (id) {
      const existing = (await loadCollection('story')).find(i => i.id === id);
      imageUrl = existing?.imageUrl || '';
    }

    // Participants = union des membres de TOUS les groupes (déduplication par id).
    // On les matérialise depuis STATE.characters pour conserver photo / photoX,Y.
    // C'est le seul moyen de rattacher des personnages à une mission désormais :
    // pas de participants individuels possibles.
    const chars = STATE.characters || [];
    const seenPartIds = new Set();
    const participants = [];
    _modalGroupes.forEach(g => (g.membres || []).forEach(id => {
      if (seenPartIds.has(id)) return;
      seenPartIds.add(id);
      const c = chars.find(x => x.id === id);
      if (c) participants.push({
        id: c.id, nom: c.nom || '', photo: c.photo || '',
        photoX: c.photoX || 0, photoY: c.photoY || 0, photoZoom: c.photoZoom || 1,
      });
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
      visibleJoueurs: document.getElementById('st-visible')?.checked !== false,
      liens,
      ordre:         parseInt(document.getElementById('st-ordre')?.value)||0,
      groupes:       _modalGroupes,
    };

    // Persister l'acte si nouveau
    const savedActes=await loadActes();
    if(!savedActes.includes(data.acte)){ savedActes.push(data.acte); savedActes.sort(); await saveActes(savedActes); }

    if(id) await updateInCol('story',id,data);
    else   await addToCol('story',data);

    window._storyActe=data.acte;
    _stCropper?.destroy(); _stCropper = null;
    closeModal();
    showNotif(id?'Mission mise à jour.':`"${titre}" ajoutée !`,'success');
    await PAGES.story();
  } catch (e) { notifySaveError(e); }
}

// ── ÉDITER / SUPPRIMER ────────────────────────────────────────────────────────
async function editStory(id){
  const items=await loadCollection('story');
  const item=items.find(i=>i.id===id);
  if(item) openStoryModal(item);
}
async function deleteStory(id){
  try {
    if (!await confirmModal('Supprimer cet élément de la trame ?'))return;
    await deleteFromCol('story',id);
    showNotif('Élément supprimé.','success');
    await PAGES.story();
  } catch (e) { notifySaveError(e); }
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

// ── OUVRIR L'ÉDITEUR D'HISTOIRE ───────────────────────────────────────────────
window._ouvrirHistoire = function(id, titre, acte) {
  window._histoireCtx = { id, titre, acte };
  window.navigate('histoire');
};

// ── OVERRIDE + EXPORTS ────────────────────────────────────────────────────────
PAGES.story = renderStory;
Object.assign(window,{openStoryModal,openStoryDetail,openNewActeModal,saveStory,editStory,deleteStory});