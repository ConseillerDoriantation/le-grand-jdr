// ══════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════
import { STATE, FS } from '../core/state.js';
import { countUserChars, loadChars, loadCollection, loadCollectionOrdered, getDocData } from '../data/firestore.js';

const renderCharSheet   = (...args) => window.renderCharSheet?.(...args);
const getDefaultBastion = () => window.getDefaultBastion?.() || { nom: 'Sans nom', niveau: 1, tresor: 0, defense: 0, description: '', ameliorations: {}, evenementCourant: 'calme', fondateurs: [], historique: [], salles: [], journal: [] };
const getDefaultTutorial = () => window.getDefaultTutorial?.() || [{ title: 'Introduction', content: 'Le tutoriel sera ajouté ici.' }];
const getInfoStats       = () => window.getInfoStats?.()       || 'Contenu à venir.';
const getInfoEquipements = () => window.getInfoEquipements?.() || 'Contenu à venir.';
const getInfoCombat      = () => window.getInfoCombat?.()      || 'Contenu à venir.';
const getInfoDeck        = () => window.getInfoDeck?.()        || 'Contenu à venir.';
const getInfoArtisanat   = () => window.getInfoArtisanat?.()   || 'Contenu à venir.';
const getInfoBastion     = () => window.getInfoBastion?.()     || 'Contenu à venir.';
const getInfoEtats       = () => window.getInfoEtats?.()       || 'Contenu à venir.';

const syncHeaderAdminButton = () => {
  const host = document.querySelector('.header-user');
  if (!host) return;
  let btn = document.getElementById('header-admin-link');
  if (!STATE.isAdmin) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'header-admin-link';
    btn.type = 'button';
    btn.className = 'header-admin-link';
    btn.textContent = 'Console MJ';
    btn.addEventListener('click', () => window.navigate?.('admin'));
    const logoutBtn = host.querySelector('.btn-logout');
    if (logoutBtn) host.insertBefore(btn, logoutBtn);
    else host.appendChild(btn);
  }
};

const PAGES = {

  // ─── DASHBOARD ──────────────────────────────────────────────────────────────
  async dashboard() {
    syncHeaderAdminButton();
    const content = document.getElementById('main-content');

    // Afficher le squelette de chargement immédiatement
    content.innerHTML = `<div id="dash-root" style="display:flex;flex-direction:column;gap:1rem;max-width:900px;margin:0 auto">
      <div style="height:160px;background:var(--bg-card);border-radius:var(--radius-lg);
        border:1px solid var(--border);animation:pulse 1.5s ease infinite"></div>
      <div style="height:120px;background:var(--bg-card);border-radius:var(--radius-lg);
        border:1px solid var(--border);animation:pulse 1.5s ease infinite .15s"></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem">
        ${[0,1,2,3].map(i=>`<div style="height:80px;background:var(--bg-card);border-radius:16px;
          border:1px solid var(--border);animation:pulse 1.5s ease infinite ${i*.1}s"></div>`).join('')}
      </div>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style>`;

    // Charger les données en parallèle
    const uid   = STATE.isAdmin ? null : STATE.user.uid;
    const [chars, storyItems] = await Promise.all([
      loadChars(uid).catch(() => []),
      loadCollection('story').catch(() => []),
    ]);
    STATE.characters = chars;

    const pseudo   = STATE.profile?.pseudo || 'Aventurier';
    const myChar   = chars[0] || null;   // premier personnage
    const pvMax    = myChar ? (window.calcPVMax?.(myChar) || myChar.pvBase || 10) : 10;
    const pmMax    = myChar ? (window.calcPMMax?.(myChar) || myChar.pmBase || 10) : 10;
    const pvCur    = myChar ? (myChar.pvActuel ?? pvMax) : 0;
    const pmCur    = myChar ? (myChar.pmActuel ?? pmMax) : 0;
    const pvPct    = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
    const pmPct    = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
    const pvColor  = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
    const ca       = myChar ? (window.calcCA?.(myChar) || 10) : '—';
    const or       = myChar ? (window.calcOr?.(myChar) || 0) : 0;

    // Mission active la plus récente
    const mission  = storyItems
      .filter(i => i.type === 'mission' && i.statut === 'En cours')
      .sort((a,b) => (b.ordre||0) - (a.ordre||0))[0] || null;

    const STATUT_CFG = {
      'Terminée':   { color:'#22c38e', bg:'rgba(34,195,142,.12)',  icon:'✓' },
      'En cours':   { color:'#4f8cff', bg:'rgba(79,140,255,.12)',  icon:'▶' },
      'Échouée':    { color:'#ff6b6b', bg:'rgba(255,107,107,.12)', icon:'✗' },
      'En attente': { color:'#888',    bg:'rgba(128,128,128,.10)', icon:'◷' },
    };

    // Personnage sélecteur (si plusieurs)
    const charSelector = chars.length > 1
      ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem">
          ${chars.map((c, i) => `
          <button onclick="window._dashSelectChar(${i})" id="dash-char-pill-${i}"
            style="font-size:.72rem;padding:3px 10px;border-radius:999px;cursor:pointer;
            border:1px solid ${i===0?'var(--gold)':'var(--border)'};
            background:${i===0?'rgba(232,184,75,.1)':'var(--bg-elevated)'};
            color:${i===0?'var(--gold)':'var(--text-dim)'};transition:all .12s">
            ${c.nom||'?'}
          </button>`).join('')}
        </div>`
      : '';

    // Portrait
    const photoPos = myChar
      ? `${50+(myChar.photoX||0)*50}% ${50+(myChar.photoY||0)*50}%`
      : 'center';
    const charPortrait = myChar?.photo
      ? `<img src="${myChar.photo}" style="width:100%;height:100%;object-fit:cover;
          object-position:${photoPos}">`
      : `<span style="font-family:'Cinzel',serif;font-size:1.6rem;font-weight:700;
          color:var(--gold)">${(myChar?.nom||'?')[0].toUpperCase()}</span>`;

    const dash = document.getElementById('dash-root');
    if (!dash) return;
    dash.innerHTML = `

    <!-- ═══ ZONE 1 : MON PERSONNAGE ══════════════════════════════════ -->
    <div style="background:var(--bg-card);border:1px solid var(--border);
      border-radius:var(--radius-lg);overflow:hidden;
      cursor:pointer;transition:border-color .15s"
      onclick="navigate('characters')"
      onmouseover="this.style.borderColor='rgba(232,184,75,.3)'"
      onmouseout="this.style.borderColor='var(--border)'">

      ${myChar ? `
      <div style="display:flex;align-items:stretch;min-height:140px">

        <!-- Portrait -->
        <div style="width:110px;flex-shrink:0;overflow:hidden;position:relative;
          background:rgba(232,184,75,.06);">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
            ${charPortrait}
          </div>
          <!-- Gradient fondu -->
          <div style="position:absolute;inset:0;background:linear-gradient(to right,
            transparent 60%,var(--bg-card))"></div>
        </div>

        <!-- Infos -->
        <div style="flex:1;padding:1rem 1.2rem;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap">
              <span style="font-family:'Cinzel',serif;font-size:1.15rem;font-weight:700;
                color:var(--text)">${myChar.nom||'Mon personnage'}</span>
              <span style="font-size:.72rem;color:var(--text-dim);
                background:var(--bg-elevated);border:1px solid var(--border);
                border-radius:6px;padding:1px 7px">Niv. ${myChar.niveau||1}</span>
              <span style="font-size:.72rem;color:var(--gold)">💰 ${or} or</span>
            </div>
            ${myChar.titre ? `<div style="font-size:.75rem;color:var(--text-dim);
              font-style:italic;margin-top:2px">${myChar.titre}</div>` : ''}
          </div>

          <!-- PV / PM / CA -->
          <div style="display:flex;flex-direction:column;gap:.45rem">
            <div style="display:flex;align-items:center;gap:.6rem">
              <span style="font-size:.68rem;color:var(--text-dim);width:22px;
                font-weight:700;text-align:right">❤️</span>
              <div style="flex:1;height:7px;background:rgba(255,255,255,.06);
                border-radius:999px;overflow:hidden">
                <div style="width:${pvPct}%;height:100%;background:${pvColor};
                  border-radius:999px;transition:width .4s"></div>
              </div>
              <span style="font-size:.75rem;font-weight:700;color:${pvColor};
                min-width:44px;text-align:right">${pvCur}/${pvMax}</span>
            </div>
            <div style="display:flex;align-items:center;gap:.6rem">
              <span style="font-size:.68rem;color:var(--text-dim);width:22px;
                font-weight:700;text-align:right">🔵</span>
              <div style="flex:1;height:7px;background:rgba(255,255,255,.06);
                border-radius:999px;overflow:hidden">
                <div style="width:${pmPct}%;height:100%;
                  background:linear-gradient(90deg,#22c7ea,#4adbf7);
                  border-radius:999px;transition:width .4s"></div>
              </div>
              <span style="font-size:.75rem;font-weight:700;color:#4adbf7;
                min-width:44px;text-align:right">${pmCur}/${pmMax}</span>
            </div>
            <div style="display:flex;align-items:center;gap:.5rem;margin-top:.1rem">
              <span style="font-size:.72rem;color:var(--text-dim)">🛡️ CA <strong
                style="color:var(--text)">${ca}</strong></span>
            </div>
          </div>

          ${charSelector}
        </div>

        <!-- Flèche -->
        <div style="display:flex;align-items:center;padding:.75rem;color:var(--text-dim);
          font-size:.9rem">→</div>
      </div>

      ` : `
      <!-- Pas encore de personnage -->
      <div style="padding:1.5rem;display:flex;align-items:center;gap:1rem">
        <div style="width:52px;height:52px;border-radius:50%;background:rgba(232,184,75,.08);
          border:1px dashed rgba(232,184,75,.3);display:flex;align-items:center;
          justify-content:center;font-size:1.3rem;flex-shrink:0">⚔️</div>
        <div style="flex:1">
          <div style="font-family:'Cinzel',serif;font-size:.95rem;color:var(--text)">
            Créer mon personnage</div>
          <div style="font-size:.78rem;color:var(--text-dim);margin-top:2px">
            Bienvenue ${pseudo} ! Commence par créer ta fiche de héros.</div>
        </div>
        <span style="color:var(--gold);font-size:.9rem">→</span>
      </div>
      `}
    </div>

    <!-- ═══ ZONE 2 : MISSION ACTIVE ══════════════════════════════════ -->
    ${mission ? `
    <div style="background:var(--bg-card);border:1px solid var(--border);
      border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;transition:border-color .15s"
      onclick="navigate('story')"
      onmouseover="this.style.borderColor='rgba(79,140,255,.3)'"
      onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:stretch">

        ${mission.imageUrl ? `
        <div style="width:90px;flex-shrink:0;overflow:hidden">
          <img src="${mission.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block">
        </div>` : `
        <div style="width:6px;flex-shrink:0;background:${(STATUT_CFG['En cours']||{}).color||'#4f8cff'}"></div>`}

        <div style="flex:1;padding:.9rem 1.1rem;display:flex;flex-direction:column;
          justify-content:space-between;gap:.4rem">
          <div>
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
              <span style="font-size:.65rem;font-weight:700;letter-spacing:1px;
                text-transform:uppercase;color:#4f8cff">Mission active</span>
              ${mission.acte ? `<span style="font-size:.65rem;color:var(--text-dim)">
                · ${mission.acte}</span>` : ''}
            </div>
            <div style="font-family:'Cinzel',serif;font-size:.95rem;font-weight:700;
              color:var(--text);line-height:1.3">${mission.titre||'Mission'}</div>
            ${mission.lieu ? `<div style="font-size:.72rem;color:var(--text-dim);
              margin-top:2px">📍 ${mission.lieu}</div>` : ''}
          </div>
          ${mission.description ? `
          <div style="font-size:.78rem;color:var(--text-muted);line-height:1.55;
            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
            overflow:hidden">${mission.description}</div>` : ''}
        </div>

        <div style="display:flex;align-items:center;padding:.75rem;
          color:var(--text-dim);font-size:.9rem">→</div>
      </div>
    </div>` : `
    <div style="background:var(--bg-card);border:1px solid var(--border);
      border-radius:var(--radius-lg);padding:.9rem 1.1rem;cursor:pointer;
      transition:border-color .15s;display:flex;align-items:center;gap:.85rem"
      onclick="navigate('story')"
      onmouseover="this.style.borderColor='rgba(79,140,255,.25)'"
      onmouseout="this.style.borderColor='var(--border)'">
      <span style="font-size:1.4rem;opacity:.4">📚</span>
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:600;color:var(--text)">Voir la Trame</div>
        <div style="font-size:.75rem;color:var(--text-dim)">Aucune mission active pour l'instant</div>
      </div>
      <span style="color:var(--text-dim)">→</span>
    </div>`}

    <!-- ═══ ZONE 3 : RACCOURCIS RAPIDES ══════════════════════════════ -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.65rem">
      ${[
        { page:'shop',    icon:'🛍️', label:'Boutique'  },
        { page:'map',     icon:'🗺️', label:'Carte'     },
        { page:'npcs',    icon:'👥', label:'PNJ'        },
        { page:'bastion', icon:'🏰', label:'Bastion'   },
      ].map(r => `
      <button onclick="navigate('${r.page}')"
        style="background:var(--bg-card);border:1px solid var(--border);
        border-radius:14px;padding:.85rem .5rem;cursor:pointer;transition:all .15s;
        display:flex;flex-direction:column;align-items:center;gap:.4rem;
        font-family:inherit"
        onmouseover="this.style.background='rgba(255,255,255,.05)';this.style.borderColor='rgba(255,255,255,.12)';this.style.transform='translateY(-2px)'"
        onmouseout="this.style.background='var(--bg-card)';this.style.borderColor='var(--border)';this.style.transform=''">
        <span style="font-size:1.3rem">${r.icon}</span>
        <span style="font-size:.72rem;font-weight:600;color:var(--text-muted)">${r.label}</span>
      </button>`).join('')}
    </div>

    ${STATE.isAdmin ? `
    <!-- ═══ ZONE MJ ADMIN ════════════════════════════════════════════ -->
    <div style="background:rgba(79,140,255,.04);border:1px solid rgba(79,140,255,.15);
      border-radius:var(--radius-lg);padding:.85rem 1.1rem">
      <div style="font-size:.65rem;font-weight:700;letter-spacing:1.5px;
        text-transform:uppercase;color:#4f8cff;margin-bottom:.6rem">Console MJ</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${[
          { page:'story',   label:'📚 Trame' },
          { page:'shop',    label:'🛍️ Boutique' },
          { page:'npcs',    label:'👥 PNJ' },
          { page:'bestiaire',label:'🐉 Bestiaire' },
          { page:'map',     label:'🗺️ Carte' },
          { page:'admin',   label:'⚙️ Admin' },
        ].map(b => `<button onclick="navigate('${b.page}')"
          style="font-size:.75rem;padding:4px 12px;border-radius:8px;cursor:pointer;
          border:1px solid rgba(79,140,255,.2);background:rgba(79,140,255,.08);
          color:#7fb0ff;transition:all .12s"
          onmouseover="this.style.background='rgba(79,140,255,.16)'"
          onmouseout="this.style.background='rgba(79,140,255,.08)'">${b.label}</button>`).join('')}
      </div>
    </div>` : ''}
    `;

    // Sélecteur de personnage au clic
    window._dashSelectChar = (idx) => {
      STATE.activeChar = chars[idx];
      // Rerender le dashboard avec le nouveau personnage sélectionné
      chars.unshift(chars.splice(idx, 1)[0]);
      PAGES.dashboard();
    };
  },

  // ─── CHARACTERS ─────────────────────────────────────────────────────────────
  async characters() {
    const uid   = STATE.isAdmin ? null : STATE.user.uid;
    const chars = await loadChars(uid);
    STATE.characters = chars;
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">📜 ${STATE.isAdmin ? 'Tous les Personnages' : 'Mes Personnages'}</span></div><div class="page-subtitle">Gérez vos fiches de personnage</div></div>`;
    if (STATE.isAdmin && chars.length > 0) {
      const byUser = {};
      chars.forEach(c => { if (!byUser[c.ownerPseudo]) byUser[c.ownerPseudo] = []; byUser[c.ownerPseudo].push(c); });
      html += `<div class="admin-section"><div class="admin-label">Vue Admin — Tous les joueurs</div><div class="char-select-bar" id="admin-player-filter"><div class="char-pill active" onclick="filterAdminChars(null,this)">Tous</div>${Object.keys(byUser).map(p => `<div class="char-pill" onclick="filterAdminChars('${p}',this)">${p}</div>`).join('')}</div></div>`;
    }
    html += `<div style="display:flex;gap:0.8rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center"><button class="btn btn-gold" onclick="createNewChar()">+ Nouveau Personnage</button><span style="font-size:0.78rem;color:var(--text-dim)">Le personnage est créé instantanément — modifie ensuite ses infos sur la fiche.</span></div>`;
    if (chars.length === 0) {
      html += `<div class="empty-state"><div class="icon">📜</div><p>Aucun personnage. Crée ton premier héros !</p></div>`;
    } else {
      html += `<div class="char-select-bar" id="char-pills">${chars.map((c, i) => `<div class="char-pill ${i === 0 ? 'active' : ''}" onclick="selectChar('${c.id}',this)">${c.nom || 'Nouveau personnage'}</div>`).join('')}</div><div id="char-sheet-area"></div>`;
    }
    content.innerHTML = html;
    if (chars.length > 0) { STATE.activeChar = chars[0]; renderCharSheet(chars[0]); }
  },

  // ─── SHOP ───────────────────────────────────────────────────────────────────
  async shop() {
    await window.renderShop?.();
  },

  // ─── WORLD ──────────────────────────────────────────────────────────────────
  async world() {
    const doc = await getDocData('world', 'main');
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">📖 Le Monde</div><div class="page-subtitle">Lore, histoire et informations générales</div></div>`;
    if (STATE.isAdmin) html += `<div class="admin-section"><div class="admin-label">Édition Admin</div><button class="btn btn-gold btn-sm" onclick="editWorldContent()">✏️ Modifier le contenu</button></div>`;
    const sections = doc?.sections || [{ title: 'Introduction', content: 'Les informations sur le monde seront ajoutées ici par le Maître de Jeu.' }];
    sections.forEach(s => { html += `<div class="world-section"><div class="card-header" style="margin-bottom:0.8rem;padding:0.8rem;background:var(--bg-card2);border-radius:6px;border:1px solid var(--border)">${s.title}</div><div class="world-content">${s.content}</div></div>`; });
    content.innerHTML = html;
  },

  // ─── MAP ────────────────────────────────────────────────────────────────────
  async map() {
    const doc     = await getDocData('world', 'map');
    const content = document.getElementById('main-content');

    // La page map prend toute la hauteur dispo — supprimer le padding habituel
    const origPadding = content.style.padding;
    const origHeight  = content.style.height;
    content.style.padding = '0';
    content.style.height  = 'calc(100vh - var(--header-height))';

    content.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <!-- Barre titre -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:0.6rem 1.2rem;
        background:rgba(11,17,24,0.96);border-bottom:1px solid var(--border);
        flex-shrink:0;gap:1rem;
      ">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <span style="font-family:'Cinzel',serif;font-size:0.9rem;color:var(--gold)">
            🗺️ ${doc?.regionName || 'Carte de la Région'}
          </span>
          <span style="font-size:0.72rem;color:var(--text-dim)">Molette pour zoomer · Cliquer-glisser pour naviguer</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem" id="map-legend"></div>
      </div>
      <!-- Conteneur carte -->
      <div id="map-container" style="flex:1;position:relative;overflow:hidden;min-height:0"></div>
    </div>`;

    // Import et init carte interactive
    const { initMap, LIEU_TYPES } = await import('./map.js');
    await initMap(document.getElementById('map-container'));

    // Légende
    const legend = document.getElementById('map-legend');
    if (legend) {
      legend.innerHTML = LIEU_TYPES.map(t => `
        <span style="display:flex;align-items:center;gap:4px;font-size:0.72rem;color:var(--text-dim)">
          <span style="width:8px;height:8px;border-radius:50%;background:${t.color};display:inline-block;flex-shrink:0"></span>
          ${t.label}
        </span>`).join('');
    }

    // Restaurer les styles au changement de page
    const origNavigate = window.navigate;
    window.navigate = function(...args) {
      content.style.padding = origPadding;
      content.style.height  = origHeight;
      window.navigate = origNavigate;
      return origNavigate?.(...args);
    };
  },

  // ─── NPCs ───────────────────────────────────────────────────────────────────
  async npcs() {
    const items = await loadCollection('npcs');
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">👥 PNJ Rencontrés</div><div class="page-subtitle">Personnages non-joueurs et factions</div></div>`;
    if (STATE.isAdmin) html += `<div class="admin-section"><div class="admin-label">Gestion Admin</div><button class="btn btn-gold btn-sm" onclick="openNpcModal()">+ Ajouter un PNJ</button></div>`;
    if (items.length === 0) {
      html += `<div class="empty-state"><div class="icon">👥</div><p>Aucun PNJ pour l'instant.</p></div>`;
    } else {
      const filters = [...new Set(items.map(n => n.disposition || 'Inconnu'))];
      html += `<div class="tabs" id="npc-filter" style="margin-bottom:1.5rem"><button class="tab active" onclick="filterNpcs(null,this)">Tous</button>${filters.map(f => `<button class="tab" onclick="filterNpcs('${f}',this)">${f}</button>`).join('')}</div><div class="npc-grid" id="npc-grid">`;
      items.forEach(npc => {
        const dispColor = npc.disposition === 'Amical' || npc.disposition === 'Allié' ? 'green' : npc.disposition === 'Hostile' || npc.disposition === 'Ennemi' ? 'red' : 'blue';
        html += `<div class="npc-card" data-disp="${npc.disposition || 'Inconnu'}"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem"><div><div class="npc-name">${npc.nom || '?'}</div><div class="npc-role">${npc.role || ''}</div></div><div style="display:flex;gap:0.3rem;align-items:center"><span class="badge badge-${dispColor}">${npc.disposition || 'Inconnu'}</span>${STATE.isAdmin ? `<button class="btn-icon" onclick="editNpc('${npc.id}')">✏️</button><button class="btn-icon" onclick="deleteNpc('${npc.id}')">🗑️</button>` : ''}</div></div><div class="npc-desc">${npc.description || ''}</div>${npc.lieu ? `<div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-dim)">📍 ${npc.lieu}</div>` : ''}</div>`;
      });
      html += '</div>';
    }
    content.innerHTML = html;
  },

  // ─── BASTION ────────────────────────────────────────────────────────────────
  async bastion() {
    const doc  = await getDocData('bastion', 'main');
    const data = doc || getDefaultBastion();

    const AMELIORATIONS = window.BASTION_AMELIORATIONS || [];
    const EVENTS        = window.BASTION_EVENTS || [];
    const calcRevenu    = window.calculerRevenuBastion;

    const { brut, fondateurs: partFondateurs, reinvesti, base, nbAmelios, evt } =
      calcRevenu ? calcRevenu(data)
        : { brut:100, fondateurs:10, reinvesti:90, base:100, nbAmelios:0, evt:{ id:'calme', nom:'Calme', emoji:'☁️', description:'', badgeClass:'badge-blue', badgeText:'±0', couleur:'neutral', modificateur:1, bonus:0 } };

    const amelios          = data.ameliorations || {};
    const niveau           = 1 + Object.values(amelios).filter(Boolean).length;
    const fondateursList   = (data.fondateurs||[]).map(f => typeof f==='object'&&f!==null ? f : { charId:null, nom:String(f) });
    const partParFondateur = fondateursList.length > 0 ? Math.round(partFondateurs / fondateursList.length) : 0;
    const historique       = data.historique || [];
    const inventaire       = data.inventaire || [];
    const missions         = data.missions || [];
    const missionsActives  = missions.filter(m => m.statut === 'active');

    const evtColors = {
      vol:        { bg:'rgba(201,50,50,0.08)',   border:'rgba(201,50,50,0.28)',   val:'#ff6b6b' },
      inspection: { bg:'rgba(255,255,255,0.03)', border:'var(--border)',           val:'var(--text-muted)' },
      calme:      { bg:'rgba(255,255,255,0.03)', border:'var(--border)',           val:'var(--text-muted)' },
      riche:      { bg:'rgba(79,140,255,0.07)',  border:'rgba(79,140,255,0.22)',  val:'var(--gold)' },
      rumeur:     { bg:'rgba(34,195,142,0.07)',  border:'rgba(34,195,142,0.22)', val:'#22c38e' },
      succes:     { bg:'rgba(34,195,142,0.11)',  border:'rgba(34,195,142,0.32)', val:'#22c38e' },
    };
    const ec = evtColors[evt?.id] || evtColors.calme;

    // Sparkline SVG — courbe des revenus
    function sparkline(hist) {
      const cycles = hist.filter(h => !h.type || h.type !== 'investissement');
      if (!cycles.length) return `<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;text-align:center;padding:.5rem 0">Aucune donnée pour l'instant.</p>`;
      const vals = cycles.map(h => h.brut || 0);
      const invs = hist.filter(h => h.type === 'investissement').map(h => ({ session: h.session, montant: h.montant||0 }));
      const max  = Math.max(...vals, 1);
      const W = 280, H = 60;
      const pts = vals.map((v,i) => {
        const x = vals.length < 2 ? W/2 : (i/(vals.length-1))*W;
        const y = H - (v/max)*(H-8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const lx = vals.length < 2 ? W/2 : W;
      const ly = H - (vals[vals.length-1]/max)*(H-8);
      // Points d'investissement
      const invPts = invs.map(inv => {
        const idx = cycles.findIndex((_,i) => i === inv.session - 1);
        if (idx < 0) return '';
        const x = cycles.length < 2 ? W/2 : (idx/(cycles.length-1))*W;
        return `<circle cx="${x.toFixed(1)}" cy="${H}" r="3" fill="rgba(79,140,255,.7)" title="+${inv.montant} or investis"/>`;
      }).join('');
      return `<svg viewBox="0 0 ${W} ${H+10}" style="width:100%;height:70px" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spk-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--gold)" stop-opacity=".25"/>
            <stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${pts} ${lx.toFixed(1)},${H} 0,${H}" fill="url(#spk-g)"/>
        <polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="var(--gold)"/>
        ${invPts}
      </svg>`;
    }

    const uid     = STATE.user?.uid;
    const isPlayer = !STATE.isAdmin && !!uid;

    const content = document.getElementById('main-content');
    content.innerHTML = `

    <!-- ═══ HEADER ══════════════════════════════════════════ -->
    <div style="background:linear-gradient(180deg,rgba(255,255,255,0.03),transparent);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.4rem 1.6rem;margin-bottom:1.4rem;display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap">
      <div>
        <h1 style="font-family:'Cinzel',serif;font-size:1.7rem;color:var(--gold);letter-spacing:2px;line-height:1;margin-bottom:.4rem">${data.nom||'Le Bastion'}</h1>
        <p style="font-size:.82rem;color:var(--text-dim);margin:0">
          ${data.activite?`<span style="margin-right:1.2rem">⚙️ ${data.activite}</span>`:''}
          ${data.pnj?`<span>👤 ${data.pnj}</span>`:''}
          ${!data.activite&&!data.pnj?'<span style="font-style:italic">Forteresse de la compagnie</span>':''}
        </p>
      </div>
      <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
        <div style="background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:12px;padding:.5rem 1rem;text-align:center">
          <div style="font-family:'Cinzel',serif;font-size:1.5rem;color:var(--gold);line-height:1">${niveau}</div>
          <div style="font-size:.65rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-top:1px">Niveau</div>
        </div>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:.5rem 1rem;text-align:center">
          <div style="font-family:'Cinzel',serif;font-size:1.5rem;color:var(--text);line-height:1">${data.tresor||0}</div>
          <div style="font-size:.65rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-top:1px">Or</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" onclick="editBastion()">✏️ Modifier</button>` : ''}
          ${isPlayer ? `<button class="btn btn-outline btn-sm" onclick="investirOrBastion()">💰 Investir</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="ouvrirInventaireBastion()">📦 Inventaire (${inventaire.length})</button>
          <button class="btn btn-outline btn-sm" onclick="ouvrirMissionsBastion()">⚔️ Missions (${missionsActives.length})</button>
        </div>
      </div>
    </div>

    <!-- ═══ GRILLE 2 COLONNES ════════════════════════════════ -->
    <div style="display:grid;grid-template-columns:1fr 290px;gap:1.2rem;align-items:start">

    <!-- ── COLONNE PRINCIPALE ────────────────────────────────── -->
    <div style="display:flex;flex-direction:column;gap:1.2rem;min-width:0">

      <!-- REVENUS -->
      <div class="card">
        <div class="card-header">💰 Génération d'or
          <span style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:auto">par cycle · +100 or / amélioration</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1rem">
          <div class="stat-box" style="text-align:center">
            <div class="stat-label">Revenu brut</div>
            <div class="stat-value" style="color:var(--gold);font-size:1.7rem">${brut}</div>
            <div style="font-size:.68rem;color:var(--text-dim)">or</div>
          </div>
          <div class="stat-box" style="text-align:center">
            <div class="stat-label">Fondateurs (10%)</div>
            <div class="stat-value" style="color:var(--text-muted);font-size:1.7rem">${partFondateurs}</div>
            <div style="font-size:.68rem;color:var(--text-dim)">${partParFondateur > 0 ? `${partParFondateur} or chacun` : 'or distribués'}</div>
          </div>
          <div class="stat-box" style="text-align:center;border-color:var(--border-accent)">
            <div class="stat-label">Réinvesti (90%)</div>
            <div class="stat-value" style="color:var(--green);font-size:1.7rem">${reinvesti}</div>
            <div style="font-size:.68rem;color:var(--text-dim)">or → trésor</div>
          </div>
        </div>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.7rem 1rem;display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;font-size:.8rem;color:var(--text-muted)">
          <span>Base <strong style="color:var(--text)">100</strong></span>
          <span>+${nbAmelios} amélios <strong style="color:var(--text)">${nbAmelios*100}</strong></span>
          <span>= <strong style="color:var(--gold)">${base} or</strong></span>
          ${evt?.id==='vol'  ? `<span>× Événement <strong style="color:#ff6b6b">×0.8</strong></span>` : ''}
          ${evt?.bonus > 0   ? `<span>+ Événement <strong style="color:var(--green)">+${evt.bonus}</strong></span>` : ''}
        </div>
      </div>

      <!-- ÉVÉNEMENT -->
      <div class="card">
        <div class="card-header">🎲 Événement du cycle</div>
        <div style="background:${ec.bg};border:1px solid ${ec.border};border-radius:12px;padding:.9rem 1.1rem;display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
          <span style="font-size:1.8rem;flex-shrink:0">${evt?.emoji||'☁️'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-family:'Cinzel',serif;font-size:.9rem;color:var(--text);margin-bottom:2px">${evt?.nom||'Calme'}</div>
            <div style="font-size:.8rem;color:var(--text-muted)">${evt?.description||''}</div>
          </div>
          <span class="badge ${evt?.badgeClass||'badge-blue'}" style="flex-shrink:0">${evt?.badgeText||'±0'}</span>
        </div>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:1rem">
          <table style="width:100%;border-collapse:collapse;font-size:.8rem">
            <thead><tr style="border-bottom:1px solid var(--border)">
              <th style="padding:.4rem .7rem;color:var(--text-dim);font-weight:400;text-align:center;width:36px">D6</th>
              <th style="padding:.4rem .7rem;color:var(--text-dim);font-weight:400;text-align:left">Événement</th>
              <th style="padding:.4rem .7rem;color:var(--text-dim);font-weight:400;text-align:right">Effet</th>
            </tr></thead>
            <tbody>
              ${EVENTS.map((e,i) => `<tr style="border-bottom:${i<EVENTS.length-1?'1px solid var(--border)':'none'};${e.id===evt?.id?'background:rgba(79,140,255,0.05)':''}">
                <td style="padding:.45rem .7rem;color:var(--text-dim);font-family:'Cinzel',serif;text-align:center">${i+1}</td>
                <td style="padding:.45rem .7rem">${e.emoji}&nbsp;<span style="color:${e.id===evt?.id?'var(--gold)':'var(--text)'}">${e.nom}</span>${e.id===evt?.id?'<span style="font-size:.68rem;color:var(--gold);margin-left:.4rem">← actuel</span>':''}</td>
                <td style="padding:.45rem .7rem;text-align:right;color:${e.couleur==='green'?'var(--green)':e.couleur==='gold'?'var(--gold)':e.couleur==='crimson'?'#ff6b6b':'var(--text-muted)'}">${e.effet}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${STATE.isAdmin
          ? `<button class="btn btn-gold" style="width:100%" onclick="tirerEvenement()">🎲 Tirer l'événement du cycle</button>`
          : `<p style="font-size:.78rem;color:var(--text-dim);text-align:center;font-style:italic;margin:0">L'événement est tiré par le MJ en début de cycle.</p>`}
      </div>

      <!-- AMÉLIORATIONS -->
      <div class="card">
        <div class="card-header">🏗️ Améliorations permanentes
          <span style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:auto">+1 niveau · +100 or/cycle chacune</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.85rem">
          ${AMELIORATIONS.map(a => {
            const debloquee = !!amelios[a.id];
            const canBuy    = STATE.isAdmin && !debloquee && (data.tresor||0) >= a.cout;
            return `<div style="background:${debloquee?'rgba(34,195,142,0.05)':'var(--bg-elevated)'};border:1px solid ${debloquee?'rgba(34,195,142,0.22)':'var(--border)'};border-radius:12px;padding:1rem;display:flex;flex-direction:column;gap:.5rem">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
                <div style="display:flex;align-items:center;gap:.45rem">
                  <span style="font-size:1.1rem">${a.emoji}</span>
                  <span style="font-family:'Cinzel',serif;font-size:.82rem;color:${debloquee?'#22c38e':'var(--text)'};line-height:1.3">${a.nom}</span>
                </div>
                ${debloquee
                  ? `<span style="font-size:.7rem;background:rgba(34,195,142,0.12);color:#22c38e;border:1px solid rgba(34,195,142,0.22);border-radius:6px;padding:1px 7px;flex-shrink:0">Active</span>`
                  : `<span style="font-family:'Cinzel',serif;font-size:.78rem;color:var(--gold);flex-shrink:0">${a.cout} or</span>`}
              </div>
              <p style="font-size:.76rem;color:var(--text-muted);line-height:1.5;margin:0">${a.description}</p>
              ${!debloquee&&STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-top:2px;font-size:.73rem"
                onclick="${canBuy?`debloquerAmelioration('${a.id}')`:''}"
                ${!canBuy?'disabled style="opacity:.38;cursor:not-allowed"':''}>Investir ${a.cout} or</button>` : ''}
              ${debloquee ? `<div style="height:2px;background:rgba(34,195,142,0.25);border-radius:1px;margin-top:auto"></div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- HISTORIQUE -->
      ${historique.length > 0 ? `
      <div class="card">
        <div class="card-header">📈 Historique des cycles</div>
        <div style="margin-bottom:.75rem">${sparkline(historique)}</div>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          ${[...historique].reverse().slice(0,8).map(h => {
            const isInvest = h.type === 'investissement';
            return `<div style="display:flex;align-items:center;gap:.75rem;padding:.55rem .75rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px">
              <div style="font-size:1.2rem;flex-shrink:0">${isInvest?'💰':'🎲'}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:.8rem;color:var(--text);font-weight:600">
                  ${isInvest
                    ? `Investissement — ${h.investisseur?.nom||'?'}${h.message?' : <em style="color:var(--text-dim);font-weight:400">"${h.message}"</em>':''}`
                    : `Session ${h.session} — ${h.evenement||'—'}`}
                </div>
                <div style="font-size:.72rem;color:var(--text-dim)">
                  ${isInvest
                    ? `<span style="color:var(--gold)">+${h.montant} or</span> versés au trésor`
                    : `<span style="color:var(--gold)">+${h.brut} or brut</span> · trésor +${h.reinvesti} · fondateurs +${h.partFondateurs}`}
                  ${h.date?` · ${h.date}`:''}
                </div>
              </div>
              ${STATE.isAdmin&&h.id ? `<button class="btn-icon" style="color:#ff6b6b;flex-shrink:0" onclick="supprimerHistorique('${h.id}')" title="Supprimer et annuler">🗑️</button>` : ''}
            </div>`;
          }).join('')}
          ${historique.length > 8 ? `<p style="font-size:.72rem;color:var(--text-dim);text-align:center;margin:.25rem 0">${historique.length-8} entrée(s) plus anciennes</p>` : ''}
        </div>
      </div>` : ''}

    </div><!-- /colonne principale -->

    <!-- ── SIDEBAR ────────────────────────────────────────────── -->
    <div style="display:flex;flex-direction:column;gap:1rem;min-width:0">

      <!-- Description -->
      ${data.description ? `<div class="card" style="padding:1rem"><p style="font-size:.82rem;color:var(--text-muted);font-style:italic;line-height:1.7;margin:0">${data.description}</p></div>` : ''}

      <!-- Fondateurs -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:.8rem;margin-bottom:.8rem">
          👑 Fondateurs
          <span style="font-size:.7rem;color:var(--text-dim);font-weight:400;margin-left:auto">10% du brut</span>
        </div>
        ${fondateursList.length === 0
          ? `<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;margin:0">Aucun fondateur enregistré.</p>`
          : fondateursList.map(f => `
            <div style="display:flex;justify-content:space-between;padding:.45rem 0;border-bottom:1px solid var(--border);font-size:.83rem">
              <span style="color:var(--text)">${f.nom||'?'}</span>
              <span style="font-family:'Cinzel',serif;color:var(--gold);font-size:.8rem">${partParFondateur} or</span>
            </div>`).join('') +
          `<div style="display:flex;justify-content:space-between;padding-top:.5rem;font-size:.75rem;color:var(--text-dim)"><span>Total</span><span>${partFondateurs} or</span></div>`}
      </div>

      <!-- Inventaire résumé -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:.8rem;margin-bottom:.8rem">
          📦 Inventaire du Bastion
          <button class="btn btn-outline btn-sm" style="margin-left:auto;font-size:.7rem" onclick="ouvrirInventaireBastion()">Voir tout</button>
        </div>
        ${inventaire.length === 0
          ? `<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;margin:0">Inventaire vide.</p>`
          : inventaire.slice(0,4).map(item => `
            <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.8rem">
              <span style="flex:1;color:var(--text)">${item.nom||'?'}${item.quantite>1?`<span style="font-size:.7rem;color:var(--gold)"> ×${item.quantite}</span>`:''}</span>
              <span style="font-size:.68rem;color:var(--text-dim)">${item.deposePar||''}</span>
            </div>`).join('') +
          (inventaire.length > 4 ? `<p style="font-size:.72rem;color:var(--text-dim);margin:.5rem 0 0;text-align:center">+${inventaire.length-4} objet(s)</p>` : '')}
      </div>

      <!-- Missions actives résumé -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:.8rem;margin-bottom:.8rem">
          ⚔️ Missions spéciales
          ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;font-size:.7rem" onclick="ouvrirMissionsBastion()">Gérer</button>` : ''}
        </div>
        ${missionsActives.length === 0
          ? `<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;margin:0">Aucune mission active.</p>`
          : missionsActives.map(m => `
            <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
              <div style="font-size:.82rem;font-weight:600;color:var(--text)">${m.titre||'?'}</div>
              ${m.recompense?`<div style="font-size:.72rem;color:var(--gold)">🎁 ${m.recompense}</div>`:''}
            </div>`).join('')}
        ${!STATE.isAdmin && missions.length > 0 ? `<button class="btn btn-outline btn-sm" style="width:100%;margin-top:.5rem;font-size:.75rem" onclick="ouvrirMissionsBastion()">Voir toutes les missions</button>` : ''}
      </div>

      <!-- Journal -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:.8rem;margin-bottom:.8rem">
          📖 Journal
          ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;font-size:.7rem" onclick="addBastionLog()">+ Entrée</button>` : ''}
        </div>
        ${(data.journal||[]).length === 0
          ? `<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;margin:0">Aucune entrée.</p>`
          : (data.journal||[]).slice(0,4).map(j => `
            <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
              <div style="font-size:.68rem;color:var(--text-dim);margin-bottom:2px">${j.date||''}</div>
              <div style="font-size:.8rem;color:var(--text-muted);line-height:1.5">${j.texte||''}</div>
            </div>`).join('')}
        ${(data.journal||[]).length > 4 ? `<p style="font-size:.72rem;color:var(--text-dim);margin:.5rem 0 0;text-align:center">${(data.journal||[]).length-4} entrée(s) plus anciennes</p>` : ''}
      </div>

    </div><!-- /sidebar -->
    </div><!-- /grille -->
    `;
  },

  // ─── STORY ──────────────────────────────────────────────────────────────────
  async story() {
    // Délégué à story.js qui override cette méthode au chargement
    // Fallback minimal si story.js n'est pas encore chargé
    const content = document.getElementById('main-content');
    content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)">
      <div style="font-size:2rem;margin-bottom:0.5rem">⏳</div>
      <p>Chargement de la trame…</p>
    </div>`;
  },

  // ─── PLAYERS ────────────────────────────────────────────────────────────────
  async players() {
    if (typeof window.renderPlayersPage === 'function') {
      await window.renderPlayersPage();
      return;
    }

    const items = await loadCollection('players');
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">⚔️ Présentation des Joueurs</div><div class="page-subtitle">Les héros de cette aventure</div></div>`;
    if (STATE.isAdmin) html += `<div class="admin-section"><div class="admin-label">Gestion Admin</div><button class="btn btn-gold btn-sm" onclick="openPlayerPresentModal()">+ Ajouter / Modifier</button></div>`;
    if (items.length === 0) {
      html += `<div class="empty-state"><div class="icon">⚔️</div><p>Aucun joueur présenté pour l'instant.</p></div>`;
    } else {
      html += `<div class="players-grid">`;
      items.forEach(p => {
        html += `<div class="player-card" onclick="viewPlayerDetail('${p.id}')"><div class="player-avatar">${p.emoji || '⚔️'}</div><div class="player-name">${p.nom || '?'}</div><div class="player-class">${p.classe || ''} — ${p.race || ''}</div><div style="margin-top:0.5rem"><span class="badge badge-gold">Niv. ${p.niveau || 1}</span></div>${STATE.isAdmin ? `<div style="margin-top:0.5rem;display:flex;gap:0.3rem;justify-content:center"><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();editPlayerPresent('${p.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deletePlayerPresent('${p.id}')">🗑️</button></div>` : ''}</div>`;
      });
      html += '</div>';
    }
    content.innerHTML = html;
  },

  // ─── ACHIEVEMENTS ───────────────────────────────────────────────────────────
  async achievements() {
    // Utilise window._achItems si déjà chargé+ordonné par achievements.js
    const items = window._achItems || await loadCollection('achievements');
    const content = document.getElementById('main-content');

    const CATS = [
      { id: 'epique',   label: 'Épique',   emoji: '⚔️',  color: '#4f8cff', glow: 'rgba(79,140,255,0.14)', desc: 'Les grandes victoires et exploits héroïques' },
      { id: 'comique',  label: 'Comique',  emoji: '🎭',  color: '#e8b84b', glow: 'rgba(232,184,75,0.14)', desc: 'Les moments mémorables et catastrophes créatives' },
      { id: 'histoire', label: 'Histoire', emoji: '📖',  color: '#22c38e', glow: 'rgba(34,195,142,0.14)', desc: 'Les tournants narratifs qui ont forgé la légende' },
    ];

    const byCat = {};
    CATS.forEach(c => { byCat[c.id] = []; });
    items.forEach(a => {
      const catId = a.categorie || 'epique';
      if (byCat[catId]) byCat[catId].push(a);
    });

    const total     = items.length;
    const activeCat = window._achCat || CATS[0].id;
    window._achCat  = activeCat;
    const cat       = CATS.find(c => c.id === activeCat) || CATS[0];
    const catItems  = byCat[activeCat] || [];

    let html = `

    <!-- HERO -->
    <div style="
      background:linear-gradient(135deg,rgba(79,140,255,0.06) 0%,rgba(232,184,75,0.04) 50%,rgba(34,195,142,0.05) 100%);
      border:1px solid var(--border);border-radius:var(--radius-lg);
      padding:1.8rem 2rem 1.4rem;margin-bottom:1.5rem;position:relative;overflow:hidden;
    ">
      <div style="position:absolute;top:-40px;right:-40px;width:200px;height:200px;
        background:radial-gradient(circle,rgba(232,184,75,0.07) 0%,transparent 70%);pointer-events:none"></div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div>
          <div style="font-size:0.72rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:0.4rem">Livre des Légendes</div>
          <h1 style="font-family:'Cinzel',serif;font-size:1.9rem;color:var(--gold);letter-spacing:2px;line-height:1;margin:0">Hauts-Faits</h1>
          <p style="font-size:0.83rem;color:var(--text-muted);margin-top:0.5rem;margin-bottom:0">Les exploits de la compagnie, consignés pour l'éternité.</p>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
          ${CATS.map(c => `
            <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:0.6rem 1rem;text-align:center;min-width:70px">
              <div style="font-size:1.1rem">${c.emoji}</div>
              <div style="font-family:'Cinzel',serif;font-size:1rem;color:${c.color};line-height:1.2">${byCat[c.id]?.length || 0}</div>
              <div style="font-size:0.65rem;color:var(--text-dim);margin-top:1px">${c.label}</div>
            </div>`).join('')}
          <div style="background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:12px;padding:0.6rem 1rem;text-align:center;min-width:70px">
            <div style="font-size:1.1rem">🏆</div>
            <div style="font-family:'Cinzel',serif;font-size:1rem;color:var(--gold);line-height:1.2">${total}</div>
            <div style="font-size:0.65rem;color:var(--text-dim);margin-top:1px">Total</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ADMIN -->
    ${STATE.isAdmin ? `
    <div class="admin-section" style="margin-bottom:1.2rem">
      <div class="admin-label">Admin — Hauts-Faits</div>
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="openAchievementModal()">+ Ajouter un Haut-Fait</button>
        <span style="font-size:0.75rem;color:var(--text-dim)">
          ↔ Glisser-déposer les cards pour les réordonner
        </span>
      </div>
    </div>` : ''}

    <!-- ONGLETS -->
    <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;flex-wrap:wrap">
      ${CATS.map(c => {
        const active = c.id === activeCat;
        const n      = byCat[c.id]?.length || 0;
        return `<button onclick="window._achCat='${c.id}';navigate('achievements')" style="
          display:flex;align-items:center;gap:0.5rem;padding:0.5rem 1.1rem;
          border-radius:999px;cursor:pointer;transition:all 0.15s;font-family:'Cinzel',serif;font-size:0.82rem;
          border:1px solid ${active ? c.color : 'var(--border)'};
          background:${active ? c.glow : 'transparent'};
          color:${active ? c.color : 'var(--text-muted)'};
        ">${c.emoji} ${c.label}
          <span style="border-radius:999px;padding:1px 7px;font-size:0.7rem;font-family:sans-serif;
            background:${active ? c.color : 'var(--bg-elevated)'};
            color:${active ? '#0b1118' : 'var(--text-dim)'};">${n}</span>
        </button>`;
      }).join('')}
    </div>`;

    // ── Contenu catégorie active ──────────────────────────────────────────
    if (catItems.length === 0) {
      html += `
      <div style="text-align:center;padding:4rem 2rem;color:var(--text-dim)">
        <div style="font-size:3rem;margin-bottom:1rem;opacity:0.4">${cat.emoji}</div>
        <p style="font-style:italic;font-size:0.85rem">Aucun haut-fait ${cat.label.toLowerCase()} pour l'instant.</p>
        ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="openAchievementModal()">+ Ajouter le premier</button>` : ''}
      </div>`;
    } else {
      html += `
      <div style="font-size:0.8rem;color:var(--text-dim);font-style:italic;margin-bottom:1.2rem;padding-left:0.25rem">
        ${cat.emoji} ${cat.desc} — ${catItems.length} haut-fait${catItems.length > 1 ? 's' : ''}
      </div>

      <!-- GRILLE — id requis pour le drag & drop -->
      <div id="ach-grid-${cat.id}" style="
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
        gap:1rem;
      ">`;

      catItems.forEach(a => {
        html += `
        <div data-ach-id="${a.id}" style="
          background:var(--bg-card);border:1px solid var(--border);
          border-radius:var(--radius-lg);overflow:hidden;
          display:flex;flex-direction:column;
          transition:border-color 0.15s,transform 0.15s,opacity 0.15s;
          ${STATE.isAdmin ? 'cursor:grab;' : 'cursor:default;'}
        "
          onmouseenter="if(!this.getAttribute('draggable')||event.buttons===0){this.style.borderColor='${cat.color}';this.style.transform='translateY(-2px)'}"
          onmouseleave="this.style.borderColor='var(--border)';this.style.transform=''">

          <!-- Zone image — toujours présente, emoji si pas d'image -->
          <div style="width:100%;aspect-ratio:4/3;background:var(--bg-panel);position:relative;overflow:hidden;flex-shrink:0">
            ${a.imageUrl
              ? `<img src="${a.imageUrl}"
                   style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:none"
                   loading="lazy" draggable="false">`
              : `<div style="
                   width:100%;height:100%;
                   display:flex;align-items:center;justify-content:center;
                   font-size:3.5rem;
                   background:linear-gradient(135deg,var(--bg-elevated),var(--bg-panel));
                   pointer-events:none;
                 ">${a.emoji || cat.emoji}</div>`
            }
            <!-- Badge catégorie -->
            <div style="
              position:absolute;top:8px;left:8px;
              background:rgba(11,17,24,0.82);border:1px solid ${cat.color};
              border-radius:999px;padding:2px 8px;
              font-size:0.65rem;color:${cat.color};
              backdrop-filter:blur(4px);pointer-events:none;
            ">${cat.emoji} ${cat.label}</div>
            ${a.date ? `<div style="
              position:absolute;bottom:8px;right:8px;
              background:rgba(11,17,24,0.75);border-radius:6px;
              padding:2px 7px;font-size:0.65rem;color:var(--text-dim);
              pointer-events:none;
            ">${a.date}</div>` : ''}
          </div>

          <!-- Corps texte -->
          <div style="padding:0.85rem;flex:1;display:flex;flex-direction:column;gap:0.4rem">
            <div style="font-family:'Cinzel',serif;font-size:0.88rem;color:var(--text);line-height:1.3">
              ${a.titre || 'Haut-Fait'}
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.55;flex:1;font-style:italic">
              ${a.description || ''}
            </div>
            ${STATE.isAdmin ? `
            <div style="display:flex;gap:0.4rem;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border)">
              <button class="btn btn-outline btn-sm" style="flex:1;font-size:0.72rem"
                onclick="event.stopPropagation();editAchievement('${a.id}')">✏️ Modifier</button>
              <button class="btn-icon" style="color:#ff6b6b"
                onclick="event.stopPropagation();deleteAchievement('${a.id}')">🗑️</button>
            </div>` : ''}
          </div>
        </div>`;
      });

      html += `</div>`;
    }

    content.innerHTML = html;
  },

  // ─── COLLECTION ─────────────────────────────────────────────────────────────
  async collection() {
    const items = await loadCollection('collection');
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">🃏 Collection</div><div class="page-subtitle">Cartes à collectionner</div></div>`;
    if (STATE.isAdmin) html += `<div class="admin-section"><div class="admin-label">Gestion Admin</div><button class="btn btn-gold btn-sm" onclick="openCollectionModal()">+ Ajouter une carte</button></div>`;
    if (items.length === 0) {
      html += `<div class="empty-state"><div class="icon">🃏</div><p>La collection est vide.</p></div>`;
    } else {
      html += `<div class="collection-grid">`;
      items.forEach(c => {
        html += `<div class="coll-card" onclick="viewCard('${c.id}')"><div class="coll-img">${c.imageUrl ? `<img src="${c.imageUrl}" style="width:100%;height:100%;object-fit:cover">` : `<span>${c.emoji || '🃏'}</span>`}</div><div class="coll-name">${c.nom || 'Carte'}</div>${STATE.isAdmin ? `<div style="padding:0 0.5rem 0.5rem;display:flex;gap:0.3rem;justify-content:center"><button class="btn-icon" onclick="event.stopPropagation();editCard('${c.id}')">✏️</button><button class="btn-icon" onclick="event.stopPropagation();deleteCard('${c.id}')">🗑️</button></div>` : ''}</div>`;
      });
      html += '</div>';
    }
    content.innerHTML = html;
  },

  // ─── TUTORIAL ───────────────────────────────────────────────────────────────
  async tutorial() {
    const doc      = await getDocData('tutorial', 'main');
    const sections = doc?.sections || getDefaultTutorial();
    const content  = document.getElementById('main-content');
    content.innerHTML = `<div class="page-header"><div class="page-title"><span class="page-title-accent">📕 Tutoriel de Jeu</div><div class="page-subtitle">Comment jouer, règles et mécaniques</div></div>
      ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Gestion Admin</div><button class="btn btn-gold btn-sm" onclick="editTutorial()">✏️ Modifier le tutoriel</button></div>` : ''}
      <div class="grid-2 tutorial-layout-grid" style="gap:1.5rem;align-items:start">
        <div><div class="tutorial-nav" id="tut-nav">${sections.map((s, i) => `<div class="tutorial-nav-item ${i === 0 ? 'active' : ''}" onclick="showTutSection(${i},this)">${s.title}</div>`).join('')}</div></div>
        <div><div class="tutorial-content" id="tut-content">${sections[0]?.content || ''}</div></div>
      </div>`;
    window._tutSections = sections;
  },

  // ─── ADMIN ──────────────────────────────────────────────────────────────────
  async admin() {
    if (!STATE.isAdmin) { window.navigate?.('dashboard'); return; }
    const users   = await loadCollection('users');
    const content = document.getElementById('main-content');
    content.innerHTML = `<div class="page-header"><div class="page-title"><span class="page-title-accent">⚙️ Panneau Admin</div><div class="page-subtitle">Gestion complète du jeu</div></div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header">Joueurs inscrits (${users.length})</div>
          <table class="data-table">
            <thead><tr><th>Pseudo</th><th>Email</th><th>Inscrit le</th></tr></thead>
            <tbody>${users.filter(u => u.email !== FS.ADMIN_EMAIL).map(u => `<tr><td>${u.pseudo || '-'}</td><td style="font-size:0.8rem;color:var(--text-muted)">${u.email || '-'}</td><td style="font-size:0.78rem;color:var(--text-dim)">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr') : '?'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-header">Actions Rapides</div>
          <div style="display:flex;flex-direction:column;gap:0.7rem">
            <button class="btn btn-outline" onclick="navigate('shop')">🛒 Gérer la Boutique</button>
            <button class="btn btn-outline" onclick="navigate('achievements')">🏆 Gérer les Hauts-Faits</button>
            <button class="btn btn-outline" onclick="navigate('collection')">🃏 Gérer la Collection</button>
            <button class="btn btn-outline" onclick="navigate('story')">📚 Gérer la Trame</button>
            <button class="btn btn-outline" onclick="navigate('npcs')">👥 Gérer les PNJ</button>
            <button class="btn btn-outline" onclick="navigate('world')">📖 Modifier le Monde</button>
            <button class="btn btn-outline" onclick="navigate('tutorial')">📕 Modifier le Tutoriel</button>
          </div>
        </div>
      </div>`;
  },

  // ─── INFORMATIONS ───────────────────────────────────────────────────────────
  async informations() {
    const doc = await getDocData('informations', 'main');
    const content = document.getElementById('main-content');
    const defaultSections = [
      { id: 'stats',       title: '📊 Statistiques & Races',  content: getInfoStats() },
      { id: 'equipements', title: '⚔️ Équipements & Armures', content: getInfoEquipements() },
      { id: 'combat',      title: '🎯 Règles de Combat',       content: getInfoCombat() },
      { id: 'deck',        title: '🃏 Deck & Runes',           content: getInfoDeck() },
      { id: 'artisanat',   title: '🔨 Artisanat',              content: getInfoArtisanat() },
      { id: 'bastion',     title: '🏰 Le Bastion',             content: getInfoBastion() },
      { id: 'etats',       title: '💊 États',                  content: getInfoEtats() },
    ];
    const sections      = doc?.sections || defaultSections;
    const activeSection = window._infoSection || sections[0]?.id;
    window._infoSection = activeSection;
    content.innerHTML = `<div class="page-header"><div class="page-title"><span class="page-title-accent">📋 Informations du JDR</span></div><div class="page-subtitle">Règles, mécaniques et lore du monde</div></div>
      ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Admin — Modification du contenu</div><button class="btn btn-gold btn-sm" onclick="editInfoSection('${activeSection}')">✏️ Modifier cette section</button></div>` : ''}
      <div class="grid-2 tutorial-layout-grid" style="gap:1.5rem;align-items:start">
        <div><div class="tutorial-nav" id="info-nav">${sections.map(s => `<div class="tutorial-nav-item ${s.id === activeSection ? 'active' : ''}" onclick="showInfoSection('${s.id}',this)">${s.title}</div>`).join('')}</div></div>
        <div><div class="tutorial-content" id="info-content" style="white-space:pre-wrap">${sections.find(s => s.id === activeSection)?.content || ''}</div></div>
      </div>`;
    window._infoSections = sections;
  },

  // ─── RECETTES ───────────────────────────────────────────────────────────────
  async recettes() {
    const doc      = await getDocData('recettes', 'main');
    const content  = document.getElementById('main-content');
    const recettes = doc?.recettes || [];
    const potions  = doc?.potions  || [];
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">🍳 Recettes & Potions</span></div><div class="page-subtitle">Cuisine de groupe et alchimie</div></div>
      ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Gestion Admin</div><div style="display:flex;gap:0.5rem"><button class="btn btn-gold btn-sm" onclick="openRecetteModal('cuisine')">+ Recette cuisine</button><button class="btn btn-gold btn-sm" onclick="openRecetteModal('potion')">+ Potion</button></div></div>` : ''}
      <div style="background:rgba(226,185,111,0.05);border:1px solid rgba(226,185,111,0.15);border-radius:8px;padding:1rem;margin-bottom:1.5rem;font-size:0.85rem;color:var(--text-muted)">
        <strong style="color:var(--gold)">🍳 Cuisine</strong> — Avant mission ou pendant un repos. Bénéficie à tout le groupe. Max 2 plats actifs simultanément.<br>
        <strong style="color:var(--gold)">🧪 Potions</strong> — Préparées avant une mission. Effets individuels.
      </div>
      <div class="grid-2" style="gap:1.5rem">
        <div>
          <div class="card-header" style="margin-bottom:1rem">🍳 Cuisine (${recettes.length})</div>
          ${recettes.length === 0 ? `<div class="empty-state"><span class="icon">🍳</span><p>Aucune recette de cuisine.</p></div>` :
            recettes.map(r => `<div class="card" style="margin-bottom:0.8rem;padding:1rem"><div style="display:flex;justify-content:space-between"><div style="font-weight:700;font-size:0.92rem;color:var(--text)">${r.nom}</div>${STATE.isAdmin ? `<div style="display:flex;gap:0.3rem"><button class="btn-icon" onclick="editRecette('${r.id}','cuisine')">✏️</button><button class="btn-icon" onclick="deleteRecette('${r.id}')">🗑️</button></div>` : ''}</div>${r.duree ? `<div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.2rem">⏱️ ${r.duree}</div>` : ''}${r.ingredients ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">🌿 ${r.ingredients}</div>` : ''}<div style="font-size:0.82rem;color:var(--text);margin-top:0.4rem;font-style:italic">${r.effet || ''}</div></div>`).join('')}
        </div>
        <div>
          <div class="card-header" style="margin-bottom:1rem">🧪 Potions (${potions.length})</div>
          ${potions.length === 0 ? `<div class="empty-state"><span class="icon">🧪</span><p>Aucune potion.</p></div>` :
            potions.map(p => `<div class="card" style="margin-bottom:0.8rem;padding:1rem"><div style="display:flex;justify-content:space-between"><div><span style="font-weight:700;font-size:0.92rem;color:var(--text)">${p.nom}</span>${p.famille ? `<span class="badge badge-blue" style="margin-left:0.4rem;font-size:0.65rem">${p.famille}</span>` : ''}</div>${STATE.isAdmin ? `<div style="display:flex;gap:0.3rem"><button class="btn-icon" onclick="editRecette('${p.id}','potion')">✏️</button><button class="btn-icon" onclick="deleteRecette('${p.id}')">🗑️</button></div>` : ''}</div>${p.ingredients ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">🌿 ${p.ingredients}</div>` : ''}<div style="font-size:0.82rem;color:var(--text);margin-top:0.4rem;font-style:italic">${p.effet || ''}</div></div>`).join('')}
        </div>
      </div>`;
    content.innerHTML = html;
  },

  // ─── BESTIAIRE ──────────────────────────────────────────────────────────────
  async bestiaire() {
    await window.renderBestiary?.();
  },
};

export default PAGES;
