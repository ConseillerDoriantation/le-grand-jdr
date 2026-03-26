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
    const pseudo      = STATE.profile?.pseudo || 'Aventurier';
    const charCount   = await countUserChars();
    const roleLabel   = STATE.isAdmin ? 'Maître de Jeu' : 'Joueur';
    const accessLabel = STATE.isAdmin ? 'Pilotage MJ' : 'Espace joueur';
    const primaryLabel = charCount > 0 ? 'Ouvrir mes personnages' : 'Créer un personnage';
    syncHeaderAdminButton();
    const content = document.getElementById('main-content');
    content.innerHTML = `
      <div class="dashboard-workspace">
        <section class="dashboard-hero">
          <div class="dashboard-hero__main">
            <div class="dashboard-label-row">
              <span class="dashboard-kicker">Workspace</span>
              <span class="dashboard-status"><i></i> En ligne</span>
            </div>
            <h1 class="dashboard-heading">Tableau de campagne</h1>
            <p class="dashboard-copy">Un point d'entrée plus direct, avec une hiérarchie de produit et des boutons explicites pour accéder aux modules utiles.</p>
            <div class="dashboard-cta-row">
              <button class="dashboard-cta dashboard-cta--primary" type="button" onclick="navigate('characters')">${primaryLabel}</button>
              <button class="dashboard-cta dashboard-cta--secondary" type="button" onclick="navigate('story')">Ouvrir la trame</button>
            </div>
          </div>
          <aside class="dashboard-hero__meta">
            <div class="dashboard-meta-card"><span>Compte</span><strong>${pseudo}</strong><small>${accessLabel}</small></div>
            <div class="dashboard-meta-card"><span>Rôle</span><strong>${roleLabel}</strong><small>Droits de navigation actifs</small></div>
            <div class="dashboard-meta-card"><span>Personnages</span><strong>${charCount}</strong><small>Fiche${charCount > 1 ? 's' : ''} disponible${charCount > 1 ? 's' : ''}</small></div>
          </aside>
        </section>
        <section class="dashboard-button-grid">
          <button class="dashboard-app-button" type="button" onclick="navigate('characters')">
            <div class="dashboard-app-button__top"><span class="dashboard-app-button__icon">PJ</span><div class="dashboard-app-button__label"><strong>Personnages</strong><small>Créer, modifier et consulter les fiches de personnage.</small></div></div>
            <div class="dashboard-app-button__action">Entrer dans le module <em>→</em></div>
          </button>
          <button class="dashboard-app-button" type="button" onclick="navigate('story')">
            <div class="dashboard-app-button__top"><span class="dashboard-app-button__icon">TR</span><div class="dashboard-app-button__label"><strong>Trame</strong><small>Suivre l'avancement de la campagne et les éléments narratifs.</small></div></div>
            <div class="dashboard-app-button__action">Voir la campagne <em>→</em></div>
          </button>
          <button class="dashboard-app-button" type="button" onclick="navigate('bastion')">
            <div class="dashboard-app-button__top"><span class="dashboard-app-button__icon">BS</span><div class="dashboard-app-button__label"><strong>Bastion</strong><small>Centraliser la base, ses ressources et sa progression.</small></div></div>
            <div class="dashboard-app-button__action">Gérer le bastion <em>→</em></div>
          </button>
          <button class="dashboard-app-button" type="button" onclick="navigate('shop')">
            <div class="dashboard-app-button__top"><span class="dashboard-app-button__icon">EQ</span><div class="dashboard-app-button__label"><strong>Boutique</strong><small>Accéder aux objets, équipements et achats du groupe.</small></div></div>
            <div class="dashboard-app-button__action">Parcourir la boutique <em>→</em></div>
          </button>
        </section>
        <section class="dashboard-panel-grid">
          <article class="card dashboard-panel dashboard-panel--full">
            <div class="dashboard-section-head"><div><span class="dashboard-eyebrow">Monde</span><h2>Ressources de consultation</h2><p>Accès directs aux pages d'information et d'exploration utiles aux joueurs.</p></div></div>
            <div class="dashboard-list">
              <button class="dashboard-list-button" type="button" onclick="navigate('world')"><span class="dashboard-list-button__icon">Lore</span><span class="dashboard-list-button__body"><strong>Informations générales</strong><span>Contexte du monde, histoire et points de repère.</span></span><span class="dashboard-list-button__arrow">→</span></button>
              <button class="dashboard-list-button" type="button" onclick="navigate('map')"><span class="dashboard-list-button__icon">Map</span><span class="dashboard-list-button__body"><strong>Carte de la région</strong><span>Vue géographique, lieux importants et orientation.</span></span><span class="dashboard-list-button__arrow">→</span></button>
              <button class="dashboard-list-button" type="button" onclick="navigate('npcs')"><span class="dashboard-list-button__icon">PNJ</span><span class="dashboard-list-button__body"><strong>PNJ rencontrés</strong><span>Retrouver les personnages déjà croisés pendant la campagne.</span></span><span class="dashboard-list-button__arrow">→</span></button>
              <button class="dashboard-list-button" type="button" onclick="navigate('tutorial')"><span class="dashboard-list-button__icon">Aide</span><span class="dashboard-list-button__body"><strong>Tutoriel</strong><span>Règles, fonctionnement et prise en main du jeu.</span></span><span class="dashboard-list-button__arrow">→</span></button>
            </div>
          </article>
        </section>
      </div>`;
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
    const doc = await getDocData('world', 'map');
    const content = document.getElementById('main-content');
    content.innerHTML = `<div class="page-header"><div class="page-title"><span class="page-title-accent">🗺️ Carte de la Région</div><div class="page-subtitle">Explorer le monde</div></div>
      ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Gestion Admin</div><div style="display:flex;gap:0.5rem;align-items:center"><input type="text" class="input-sm" id="map-url-input" placeholder="URL de l'image de la carte" value="${doc?.imageUrl || ''}" style="max-width:400px"><button class="btn btn-gold btn-sm" onclick="saveMapUrl()">Enregistrer</button></div></div>` : ''}
      <div class="map-container">${doc?.imageUrl ? `<img src="${doc.imageUrl}" class="map-img" alt="Carte">` : `<div style="text-align:center;color:var(--text-muted)"><div style="font-size:4rem;margin-bottom:1rem">🗺️</div><p style="font-style:italic">La carte sera ajoutée par le Maître de Jeu.</p></div>`}</div>`;
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

    // Helpers exposés par bastion.js via window
    const AMELIORATIONS  = window.BASTION_AMELIORATIONS || [];
    const EVENTS         = window.BASTION_EVENTS || [];
    const calcRevenu     = window.calculerRevenuBastion;

    const { brut, fondateurs: partFondateurs, reinvesti, base, nbAmelios, evt } =
      calcRevenu
        ? calcRevenu(data)
        : { brut: 100, fondateurs: 10, reinvesti: 90, base: 100, nbAmelios: 0, evt: { id: 'calme', nom: 'Calme', emoji: '☁️', description: '', badgeClass: 'badge-blue', badgeText: '±0', couleur: 'neutral', modificateur: 1, bonus: 0 } };

    const amelios          = data.ameliorations || {};
    const niveau           = 1 + Object.values(amelios).filter(Boolean).length;
    const fondateursList   = data.fondateurs || [];
    const partParFondateur = fondateursList.length > 0 ? Math.round(partFondateurs / fondateursList.length) : 0;
    const historique       = data.historique || [];

    // Couleur du bandeau événement
    const evtColors = {
      vol:        { bg: 'rgba(201,50,50,0.08)',    border: 'rgba(201,50,50,0.28)',    val: '#ff6b6b' },
      inspection: { bg: 'rgba(255,255,255,0.03)',  border: 'var(--border)',            val: 'var(--text-muted)' },
      calme:      { bg: 'rgba(255,255,255,0.03)',  border: 'var(--border)',            val: 'var(--text-muted)' },
      riche:      { bg: 'rgba(79,140,255,0.07)',   border: 'rgba(79,140,255,0.22)',   val: 'var(--gold)' },
      rumeur:     { bg: 'rgba(34,195,142,0.07)',   border: 'rgba(34,195,142,0.22)',  val: '#22c38e' },
      succes:     { bg: 'rgba(34,195,142,0.11)',   border: 'rgba(34,195,142,0.32)',  val: '#22c38e' },
    };
    const ec = evtColors[evt?.id] || evtColors.calme;

    // Sparkline SVG inline
    function sparkline(hist) {
      if (!hist.length) return `<p style="font-size:0.78rem;color:var(--text-dim);font-style:italic;text-align:center;padding:0.5rem 0">Aucune donnée pour l'instant.</p>`;
      const vals = hist.map(h => h.brut || 0);
      const max  = Math.max(...vals, 1);
      const W = 100, H = 40;
      const pts = vals.map((v, i) => {
        const x = (i / Math.max(vals.length - 1, 1)) * W;
        const y = H - (v / max) * (H - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const lx = ((vals.length - 1) / Math.max(vals.length - 1, 1)) * W;
      const ly = H - (vals[vals.length - 1] / max) * (H - 4);
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:52px" preserveAspectRatio="none">
        <polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" fill="var(--gold)"/>
      </svg>`;
    }

    const content = document.getElementById('main-content');
    content.innerHTML = `

    <!-- ═══ HEADER ══════════════════════════════════════════ -->
    <div style="
      background:linear-gradient(180deg,rgba(255,255,255,0.03),transparent);
      border:1px solid var(--border);border-radius:var(--radius-lg);
      padding:1.4rem 1.6rem;margin-bottom:1.4rem;
      display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;
    ">
      <div>
        <h1 style="font-family:'Cinzel',serif;font-size:1.7rem;color:var(--gold);letter-spacing:2px;line-height:1;margin-bottom:0.4rem">
          ${data.nom || 'Le Bastion'}
        </h1>
        <p style="font-size:0.82rem;color:var(--text-dim);margin:0">
          ${data.activite ? `<span style="margin-right:1.2rem">⚙️ ${data.activite}</span>` : ''}
          ${data.pnj     ? `<span>👤 ${data.pnj}</span>` : ''}
          ${!data.activite && !data.pnj ? '<span style="font-style:italic">Forteresse de la compagnie</span>' : ''}
        </p>
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
        <div style="background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:12px;padding:0.5rem 1rem;text-align:center">
          <div style="font-family:'Cinzel',serif;font-size:1.5rem;color:var(--gold);line-height:1">${niveau}</div>
          <div style="font-size:0.65rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-top:1px">Niveau</div>
        </div>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:0.5rem 1rem;text-align:center">
          <div style="font-family:'Cinzel',serif;font-size:1.5rem;color:var(--text);line-height:1">${data.tresor || 0}</div>
          <div style="font-size:0.65rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-top:1px">Or</div>
        </div>
        ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" onclick="editBastion()">✏️ Modifier</button>` : ''}
      </div>
    </div>

    <!-- ═══ GRILLE 2 COLONNES ═══════════════════════════════ -->
    <div style="display:grid;grid-template-columns:1fr 290px;gap:1.2rem;align-items:start">

    <!-- ── COLONNE PRINCIPALE ──────────────────────────────── -->
    <div style="display:flex;flex-direction:column;gap:1.2rem;min-width:0">

      <!-- REVENUS ──────────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          💰 Génération d'or
          <span style="font-size:0.72rem;color:var(--text-dim);font-weight:400;margin-left:auto">par session · +100 or / amélioration</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:1rem">
          <div class="stat-box" style="text-align:center">
            <div class="stat-label">Revenu brut</div>
            <div class="stat-value" style="color:var(--gold);font-size:1.7rem">${brut}</div>
            <div style="font-size:0.68rem;color:var(--text-dim)">or</div>
          </div>
          <div class="stat-box" style="text-align:center">
            <div class="stat-label">Fondateurs (10%)</div>
            <div class="stat-value" style="color:var(--text-muted);font-size:1.7rem">${partFondateurs}</div>
            <div style="font-size:0.68rem;color:var(--text-dim)">or distribués</div>
          </div>
          <div class="stat-box" style="text-align:center;border-color:var(--border-accent)">
            <div class="stat-label">Réinvesti (90%)</div>
            <div class="stat-value" style="color:var(--green);font-size:1.7rem">${reinvesti}</div>
            <div style="font-size:0.68rem;color:var(--text-dim)">or → trésor</div>
          </div>
        </div>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:0.7rem 1rem;display:flex;flex-wrap:wrap;gap:0.5rem 1.5rem;font-size:0.8rem;color:var(--text-muted)">
          <span>Base <strong style="color:var(--text)">100</strong></span>
          <span>+ ${nbAmelios} amélios <strong style="color:var(--text)">${nbAmelios * 100}</strong></span>
          <span>= Sous-total <strong style="color:var(--gold)">${base} or</strong></span>
          ${evt?.id === 'vol'     ? `<span>× Événement <strong style="color:#ff6b6b">×0.8</strong></span>` : ''}
          ${evt?.bonus > 0       ? `<span>+ Événement <strong style="color:var(--green)">+${evt.bonus}</strong></span>` : ''}
        </div>
      </div>

      <!-- ÉVÉNEMENT DU CYCLE ────────────────────────────────── -->
      <div class="card">
        <div class="card-header">🎲 Événement du cycle</div>

        <!-- Bandeau événement actif -->
        <div style="background:${ec.bg};border:1px solid ${ec.border};border-radius:12px;padding:0.9rem 1.1rem;display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
          <span style="font-size:1.8rem;flex-shrink:0">${evt?.emoji || '☁️'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-family:'Cinzel',serif;font-size:0.9rem;color:var(--text);margin-bottom:2px">${evt?.nom || 'Calme'}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${evt?.description || ''}</div>
          </div>
          <span class="badge ${evt?.badgeClass || 'badge-blue'}" style="flex-shrink:0">${evt?.badgeText || '±0'}</span>
        </div>

        <!-- Table des 6 possibilités -->
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:1rem">
          <table style="width:100%;border-collapse:collapse;font-size:0.8rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                <th style="padding:0.4rem 0.7rem;color:var(--text-dim);font-weight:400;text-align:center;width:36px">D6</th>
                <th style="padding:0.4rem 0.7rem;color:var(--text-dim);font-weight:400;text-align:left">Événement</th>
                <th style="padding:0.4rem 0.7rem;color:var(--text-dim);font-weight:400;text-align:right">Effet</th>
              </tr>
            </thead>
            <tbody>
              ${EVENTS.map((e, i) => `
              <tr style="border-bottom:${i < EVENTS.length - 1 ? '1px solid var(--border)' : 'none'};${e.id === evt?.id ? 'background:rgba(79,140,255,0.05)' : ''}">
                <td style="padding:0.45rem 0.7rem;color:var(--text-dim);font-family:'Cinzel',serif;text-align:center">${i + 1}</td>
                <td style="padding:0.45rem 0.7rem">
                  ${e.emoji}&nbsp;<span style="color:${e.id === evt?.id ? 'var(--gold)' : 'var(--text)'}">${e.nom}</span>
                  ${e.id === evt?.id ? '<span style="font-size:0.68rem;color:var(--gold);margin-left:0.4rem">← actuel</span>' : ''}
                </td>
                <td style="padding:0.45rem 0.7rem;text-align:right;color:${e.couleur === 'green' ? 'var(--green)' : e.couleur === 'gold' ? 'var(--gold)' : e.couleur === 'crimson' ? '#ff6b6b' : 'var(--text-muted)'}">${e.effet}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        ${STATE.isAdmin
          ? `<button class="btn btn-gold" style="width:100%" onclick="tirerEvenement()">🎲 Tirer l'événement du cycle</button>`
          : `<p style="font-size:0.78rem;color:var(--text-dim);text-align:center;font-style:italic;margin:0">L'événement est tiré par le MJ en début de cycle.</p>`}
      </div>

      <!-- AMÉLIORATIONS ─────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          🏗️ Améliorations permanentes
          <span style="font-size:0.72rem;color:var(--text-dim);font-weight:400;margin-left:auto">+1 niveau · +100 or/session chacune</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.85rem">
          ${AMELIORATIONS.map(a => {
            const debloquee = !!amelios[a.id];
            const canBuy    = STATE.isAdmin && !debloquee && (data.tresor || 0) >= a.cout;
            return `
            <div style="
              background:${debloquee ? 'rgba(34,195,142,0.05)' : 'var(--bg-elevated)'};
              border:1px solid ${debloquee ? 'rgba(34,195,142,0.22)' : 'var(--border)'};
              border-radius:12px;padding:1rem;display:flex;flex-direction:column;gap:0.5rem;
            ">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem">
                <div style="display:flex;align-items:center;gap:0.45rem">
                  <span style="font-size:1.1rem">${a.emoji}</span>
                  <span style="font-family:'Cinzel',serif;font-size:0.82rem;color:${debloquee ? '#22c38e' : 'var(--text)'};line-height:1.3">${a.nom}</span>
                </div>
                ${debloquee
                  ? `<span style="font-size:0.7rem;background:rgba(34,195,142,0.12);color:#22c38e;border:1px solid rgba(34,195,142,0.22);border-radius:6px;padding:1px 7px;flex-shrink:0">Active</span>`
                  : `<span style="font-family:'Cinzel',serif;font-size:0.78rem;color:var(--gold);flex-shrink:0">${a.cout} or</span>`}
              </div>
              <p style="font-size:0.76rem;color:var(--text-muted);line-height:1.5;margin:0">${a.description}</p>
              ${!debloquee && STATE.isAdmin ? `
                <button class="btn btn-outline btn-sm" style="margin-top:2px;font-size:0.73rem"
                  onclick="${canBuy ? `debloquerAmelioration('${a.id}')` : ''}"
                  ${!canBuy ? 'disabled style="opacity:0.38;cursor:not-allowed"' : ''}>
                  Investir ${a.cout} or
                </button>` : ''}
              ${debloquee ? `<div style="height:2px;background:rgba(34,195,142,0.25);border-radius:1px;margin-top:auto"></div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- HISTORIQUE ────────────────────────────────────────── -->
      ${historique.length > 0 ? `
      <div class="card">
        <div class="card-header">📈 Historique des revenus</div>
        <div style="margin-bottom:0.75rem">${sparkline(historique)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.5rem">
          ${historique.slice(-6).reverse().map(h => `
            <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.55rem 0.7rem">
              <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:2px">Session ${h.session || '?'}</div>
              <div style="font-family:'Cinzel',serif;font-size:0.95rem;color:var(--gold)">${h.brut || 0} or</div>
              <div style="font-size:0.7rem;color:var(--text-muted)">${h.evenement || '—'}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

    </div><!-- /colonne principale -->

    <!-- ── SIDEBAR ──────────────────────────────────────────── -->
    <div style="display:flex;flex-direction:column;gap:1rem;min-width:0">

      <!-- Description -->
      ${data.description ? `
      <div class="card" style="padding:1rem">
        <p style="font-size:0.82rem;color:var(--text-muted);font-style:italic;line-height:1.7;margin:0">${data.description}</p>
      </div>` : ''}

      <!-- Fondateurs -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:0.8rem;margin-bottom:0.8rem">
          👑 Fondateurs
          <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400;margin-left:auto">10% du brut</span>
        </div>
        ${fondateursList.length === 0
          ? `<p style="font-size:0.78rem;color:var(--text-dim);font-style:italic;margin:0">Aucun fondateur enregistré.</p>`
          : fondateursList.map(f => `
              <div style="display:flex;justify-content:space-between;padding:0.45rem 0;border-bottom:1px solid var(--border);font-size:0.83rem">
                <span style="color:var(--text)">${f}</span>
                <span style="font-family:'Cinzel',serif;color:var(--gold);font-size:0.8rem">${partParFondateur} or</span>
              </div>`).join('') +
            `<div style="display:flex;justify-content:space-between;padding-top:0.5rem;font-size:0.75rem;color:var(--text-dim)">
               <span>Total</span><span>${partFondateurs} or</span>
             </div>`
        }
      </div>

      <!-- Missions spéciales -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:0.8rem;margin-bottom:0.8rem">⚔️ Missions spéciales</div>
        <p style="font-size:0.78rem;color:var(--text-dim);font-style:italic;line-height:1.55;margin-bottom:0.75rem">
          Missions spécifiques au Bastion permettant de débloquer des avantages temporaires ou permanents.
        </p>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.6rem 0.75rem;font-size:0.78rem;color:var(--text-dim);text-align:center;font-style:italic">
          Aucune mission active
        </div>
      </div>

      <!-- Journal -->
      <div class="card" style="padding:1rem">
        <div class="card-header" style="font-size:0.8rem;margin-bottom:0.8rem">
          📖 Journal
          ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;font-size:0.7rem" onclick="addBastionLog()">+ Entrée</button>` : ''}
        </div>
        ${(data.journal || []).length === 0
          ? `<p style="font-size:0.78rem;color:var(--text-dim);font-style:italic;margin:0">Aucune entrée pour l'instant.</p>`
          : (data.journal || []).slice(0, 5).map(j => `
              <div style="padding:0.5rem 0;border-bottom:1px solid var(--border)">
                <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:2px">${j.date || ''}</div>
                <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5">${j.texte || ''}</div>
              </div>`).join('')
        }
        ${(data.journal || []).length > 5 ? `<p style="font-size:0.72rem;color:var(--text-dim);margin-top:0.5rem;text-align:center">${(data.journal || []).length - 5} entrée(s) plus anciennes</p>` : ''}
      </div>

    </div><!-- /sidebar -->
    </div><!-- /grille -->
    `;
  },

  // ─── STORY ──────────────────────────────────────────────────────────────────
  async story() {
    const items = await loadCollectionOrdered('story', 'date');
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">📚 La Trame</div><div class="page-subtitle">L'histoire de votre aventure</div></div>`;
    if (STATE.isAdmin) html += `<div class="admin-section"><div class="admin-label">Gestion Admin</div><button class="btn btn-gold btn-sm" onclick="openStoryModal()">+ Ajouter un événement</button></div>`;
    if (items.length === 0) {
      html += `<div class="empty-state"><div class="icon">📚</div><p>L'aventure n'a pas encore commencé...</p></div>`;
    } else {
      html += `<div class="grid-2" style="gap:2rem"><div>`;
      const events   = items.filter(i => i.type !== 'mission');
      const missions = items.filter(i => i.type === 'mission');
      html += `<div class="card-header" style="margin-bottom:1rem">⚔️ Chronique</div><div class="timeline">`;
      events.forEach(e => {
        html += `<div class="timeline-item"><div class="timeline-dot" style="${e.type === 'combat' ? 'background:var(--crimson);border-color:var(--crimson-light)' : ''}"></div><div class="timeline-date">${e.date || ''} ${e.acte ? `— ${e.acte}` : ''}</div><div class="timeline-title">${e.titre || 'Événement'}</div><div class="timeline-desc">${e.description || ''}</div>${STATE.isAdmin ? `<div style="margin-top:0.4rem"><button class="btn-icon" onclick="editStory('${e.id}')">✏️</button><button class="btn-icon" onclick="deleteStory('${e.id}')">🗑️</button></div>` : ''}</div>`;
      });
      html += `</div></div><div><div class="card-header" style="margin-bottom:1rem">🎯 Missions</div>`;
      missions.forEach(m => {
        html += `<div class="card" style="margin-bottom:1rem;padding:1rem"><div style="display:flex;justify-content:space-between;align-items:start"><div><div style="font-family:'Cinzel',serif;font-size:0.9rem;color:var(--text);margin-bottom:0.3rem">${m.titre || 'Mission'}</div><div style="font-size:0.82rem;color:var(--text-muted);font-style:italic">${m.description || ''}</div></div><div style="display:flex;gap:0.4rem;align-items:center"><span class="badge badge-${m.statut === 'Terminée' ? 'green' : m.statut === 'En cours' ? 'gold' : 'blue'}">${m.statut || 'En cours'}</span>${STATE.isAdmin ? `<button class="btn-icon" onclick="editStory('${m.id}')">✏️</button><button class="btn-icon" onclick="deleteStory('${m.id}')">🗑️</button>` : ''}</div></div>${m.recompense ? `<div style="margin-top:0.4rem;font-size:0.78rem;color:var(--gold)">💰 Récompense: ${m.recompense}</div>` : ''}</div>`;
      });
      if (missions.length === 0) html += `<div style="color:var(--text-dim);font-style:italic;font-size:0.85rem">Aucune mission active.</div>`;
      html += `</div></div>`;
    }
    content.innerHTML = html;
  },

  // ─── PLAYERS ────────────────────────────────────────────────────────────────
  async players() {
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
    const items = await loadCollection('achievements');
    const content = document.getElementById('main-content');
    let html = `<div class="page-header"><div class="page-title"><span class="page-title-accent">🏆 Hauts-Faits</div><div class="page-subtitle">Les exploits légendaires du groupe</div></div>`;
    if (STATE.isAdmin) html += `<div class="admin-section"><div class="admin-label">Gestion Admin (seul l'admin peut gérer les hauts-faits)</div><button class="btn btn-gold btn-sm" onclick="openAchievementModal()">+ Ajouter un Haut-Fait</button></div>`;
    if (items.length === 0) {
      html += `<div class="empty-state"><div class="icon">🏆</div><p>Aucun haut-fait accompli pour l'instant...</p></div>`;
    } else {
      html += `<div class="achievement-grid">`;
      items.forEach(a => {
        html += `<div class="achievement-card"><div class="achievement-img" style="background:var(--bg-panel)">${a.imageUrl ? `<img src="${a.imageUrl}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:3rem">${a.emoji || '🏆'}</span>`}</div><div class="achievement-body"><div class="achievement-title">${a.titre || 'Haut-Fait'}</div><div class="achievement-text">${a.description || ''}</div>${a.date ? `<div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-dim)">${a.date}</div>` : ''}${STATE.isAdmin ? `<div style="margin-top:0.8rem;display:flex;gap:0.3rem"><button class="btn btn-outline btn-sm" onclick="editAchievement('${a.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="deleteAchievement('${a.id}')">🗑️</button></div>` : ''}</div></div>`;
      });
      html += '</div>';
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
