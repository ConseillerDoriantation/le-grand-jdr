// ══════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════
export const PAGES = {
// ─── DASHBOARD ────────────────────────────────
async dashboard() {
  const pseudo = STATE.profile?.pseudo || 'Aventurier';
  const charCount = await countUserChars();
  const content = document.getElementById('main-content');
  content.innerHTML = `
    <div class="dashboard-hero">
      <h1>Bienvenue, ${pseudo}</h1>
      <p>Que ton épée reste affûtée et ta magie, vive.</p>
    </div>
    <div class="grid-3" style="margin-bottom:1.5rem">
      <div class="stat-box"><div class="stat-label">Personnages</div><div class="stat-value">${charCount}</div></div>
      <div class="stat-box"><div class="stat-label">Statut</div><div class="stat-value" style="font-size:1rem;color:var(--green)">En ligne</div></div>
      <div class="stat-box"><div class="stat-label">Rôle</div><div class="stat-value" style="font-size:0.85rem;color:var(--gold)">${STATE.isAdmin?'Maître de Jeu':'Joueur'}</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header">Accès Rapides</div>
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          <button class="quick-btn" onclick="navigate('characters')"><span class="qicon">📜</span> Ma Fiche de Personnage</button>
          <button class="quick-btn" onclick="navigate('shop')"><span class="qicon">🛒</span> Boutique</button>
          <button class="quick-btn" onclick="navigate('story')"><span class="qicon">📚</span> La Trame</button>
          <button class="quick-btn" onclick="navigate('bastion')"><span class="qicon">🏰</span> Le Bastion</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Le Monde</div>
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          <button class="quick-btn" onclick="navigate('world')"><span class="qicon">📖</span> Informations Générales</button>
          <button class="quick-btn" onclick="navigate('map')"><span class="qicon">🗺️</span> Carte de la Région</button>
          <button class="quick-btn" onclick="navigate('npcs')"><span class="qicon">👥</span> PNJ Rencontrés</button>
          <button class="quick-btn" onclick="navigate('tutorial')"><span class="qicon">📕</span> Tutoriel de Jeu</button>
        </div>
      </div>
    </div>`;
},

// ─── CHARACTERS ───────────────────────────────
async characters() {
  const uid = STATE.isAdmin ? null : STATE.user.uid;
  const chars = await loadChars(uid);
  STATE.characters = chars;
  const content = document.getElementById('main-content');

  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">📜 ${STATE.isAdmin ? 'Tous les Personnages' : 'Mes Personnages'}</span></div>
    <div class="page-subtitle">Gérez vos fiches de personnage</div>
  </div>`;

  if (STATE.isAdmin && chars.length > 0) {
    const byUser = {};
    chars.forEach(c => { if(!byUser[c.ownerPseudo]) byUser[c.ownerPseudo]=[]; byUser[c.ownerPseudo].push(c); });
    html += `<div class="admin-section"><div class="admin-label">Vue Admin — Tous les joueurs</div>
    <div class="char-select-bar" id="admin-player-filter">
      <div class="char-pill active" onclick="filterAdminChars(null,this)">Tous</div>
      ${Object.keys(byUser).map(p=>`<div class="char-pill" onclick="filterAdminChars('${p}',this)">${p}</div>`).join('')}
    </div></div>`;
  }

  html += `<div style="display:flex;gap:0.8rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center">
    <button class="btn btn-gold" onclick="createNewChar()">+ Nouveau Personnage</button>
    <span style="font-size:0.78rem;color:var(--text-dim)">Le personnage est créé instantanément — modifie ensuite ses infos sur la fiche.</span>
  </div>`;

  if (chars.length === 0) {
    html += `<div class="empty-state"><div class="icon">📜</div><p>Aucun personnage. Crée ton premier héros !</p></div>`;
  } else {
    html += `<div class="char-select-bar" id="char-pills">
      ${chars.map((c,i)=>`<div class="char-pill ${i===0?'active':''}" onclick="selectChar('${c.id}',this)">${c.nom||'Nouveau personnage'}</div>`).join('')}
    </div>
    <div id="char-sheet-area"></div>`;
  }

  content.innerHTML = html;
  if (chars.length > 0) {
    STATE.activeChar = chars[0];
    renderCharSheet(chars[0]);
  }
},

// ─── SHOP ─────────────────────────────────────
async shop() {
  const items = await loadCollection('shop');
  const content = document.getElementById('main-content');
  const cats = [...new Set(items.map(i=>i.categorie||'Divers'))].sort();

  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🛒 Boutique</div>
    <div class="page-subtitle">Équipements, consommables et merveilles</div>
  </div>`;

  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <button class="btn btn-gold btn-sm" onclick="openShopItemModal()">+ Ajouter un article</button>
    </div>`;
  }

  if (items.length === 0) {
    html += `<div class="empty-state"><div class="icon">🛒</div><p>La boutique est vide pour l'instant.</p></div>`;
  } else {
    const catFilter = `<div class="tabs" style="margin-bottom:1.5rem" id="shop-cats">
      <button class="tab active" onclick="filterShop(null,this)">Tout</button>
      ${cats.map(c=>`<button class="tab" onclick="filterShop('${c}',this)">${c}</button>`).join('')}
    </div>`;
    html += catFilter;
    html += `<div class="shop-grid" id="shop-grid">`;
    items.forEach(item => {
      html += `<div class="shop-item" data-cat="${item.categorie||'Divers'}">
        <div class="shop-category">${item.categorie||'Divers'}</div>
        <div class="shop-item-name">${item.nom||'?'}</div>
        <div class="shop-item-desc">${item.description||''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="shop-item-price">💰 ${item.prix||'?'} Or</div>
          ${STATE.isAdmin?`<div style="display:flex;gap:0.3rem">
            <button class="btn-icon" onclick="editShopItem('${item.id}')">✏️</button>
            <button class="btn-icon" onclick="deleteShopItem('${item.id}')">🗑️</button>
          </div>`:''}
        </div>
      </div>`;
    });
    html += '</div>';
  }
  content.innerHTML = html;
},

// ─── WORLD ────────────────────────────────────
async world() {
  const doc = await getDocData('world','main');
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">📖 Le Monde</div>
    <div class="page-subtitle">Lore, histoire et informations générales</div>
  </div>`;
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Édition Admin</div>
      <button class="btn btn-gold btn-sm" onclick="editWorldContent()">✏️ Modifier le contenu</button>
    </div>`;
  }
  const sections = doc?.sections || [{ title:'Introduction', content:'Les informations sur le monde seront ajoutées ici par le Maître de Jeu.' }];
  sections.forEach(s => {
    html += `<div class="world-section">
      <div class="card-header" style="margin-bottom:0.8rem;padding:0.8rem;background:var(--bg-card2);border-radius:6px;border:1px solid var(--border)">${s.title}</div>
      <div class="world-content">${s.content}</div>
    </div>`;
  });
  content.innerHTML = html;
},

// ─── MAP ──────────────────────────────────────
async map() {
  const doc = await getDocData('world','map');
  const content = document.getElementById('main-content');
  content.innerHTML = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🗺️ Carte de la Région</div>
    <div class="page-subtitle">Explorer le monde</div>
  </div>
  ${STATE.isAdmin?`<div class="admin-section">
    <div class="admin-label">Gestion Admin</div>
    <div style="display:flex;gap:0.5rem;align-items:center">
      <input type="text" class="input-sm" id="map-url-input" placeholder="URL de l'image de la carte" value="${doc?.imageUrl||''}" style="max-width:400px">
      <button class="btn btn-gold btn-sm" onclick="saveMapUrl()">Enregistrer</button>
    </div>
  </div>`:''}
  <div class="map-container">
    ${doc?.imageUrl
      ? `<img src="${doc.imageUrl}" class="map-img" alt="Carte">`
      : `<div style="text-align:center;color:var(--text-muted)"><div style="font-size:4rem;margin-bottom:1rem">🗺️</div><p style="font-style:italic">La carte sera ajoutée par le Maître de Jeu.</p></div>`
    }
  </div>`;
},

// ─── NPCs ─────────────────────────────────────
async npcs() {
  const items = await loadCollection('npcs');
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">👥 PNJ Rencontrés</div>
    <div class="page-subtitle">Personnages non-joueurs et factions</div>
  </div>`;
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <button class="btn btn-gold btn-sm" onclick="openNpcModal()">+ Ajouter un PNJ</button>
    </div>`;
  }
  if (items.length===0) {
    html += `<div class="empty-state"><div class="icon">👥</div><p>Aucun PNJ pour l'instant.</p></div>`;
  } else {
    const dispositions = ['Amical','Neutre','Hostile','Mystérieux','Allié','Ennemi'];
    const filters = [...new Set(items.map(n=>n.disposition||'Inconnu'))];
    html += `<div class="tabs" id="npc-filter" style="margin-bottom:1.5rem">
      <button class="tab active" onclick="filterNpcs(null,this)">Tous</button>
      ${filters.map(f=>`<button class="tab" onclick="filterNpcs('${f}',this)">${f}</button>`).join('')}
    </div>
    <div class="npc-grid" id="npc-grid">`;
    items.forEach(npc => {
      const dispColor = npc.disposition==='Amical'||npc.disposition==='Allié'?'green':npc.disposition==='Hostile'||npc.disposition==='Ennemi'?'red':'blue';
      html += `<div class="npc-card" data-disp="${npc.disposition||'Inconnu'}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem">
          <div>
            <div class="npc-name">${npc.nom||'?'}</div>
            <div class="npc-role">${npc.role||''}</div>
          </div>
          <div style="display:flex;gap:0.3rem;align-items:center">
            <span class="badge badge-${dispColor}">${npc.disposition||'Inconnu'}</span>
            ${STATE.isAdmin?`<button class="btn-icon" onclick="editNpc('${npc.id}')">✏️</button><button class="btn-icon" onclick="deleteNpc('${npc.id}')">🗑️</button>`:''}
          </div>
        </div>
        <div class="npc-desc">${npc.description||''}</div>
        ${npc.lieu?`<div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-dim)">📍 ${npc.lieu}</div>`:''}
      </div>`;
    });
    html += '</div>';
  }
  content.innerHTML = html;
},

// ─── BASTION ──────────────────────────────────
async bastion() {
  const doc = await getDocData('bastion','main');
  const data = doc || getDefaultBastion();
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🏰 Le Bastion</div>
    <div class="page-subtitle">Votre forteresse, gérée par les joueurs</div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-header">Informations<button class="btn btn-gold btn-sm" onclick="editBastion()">✏️ Modifier</button></div>
      <div style="margin-bottom:1rem">
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Nom du Bastion</div>
        <div style="font-size:1.2rem;color:var(--gold);font-family:'Cinzel',serif">${data.nom||'Sans nom'}</div>
      </div>
      <div class="grid-3" style="gap:0.5rem;margin-bottom:1rem">
        <div class="stat-box"><div class="stat-label">Niveau</div><div class="stat-value">${data.niveau||1}</div></div>
        <div class="stat-box"><div class="stat-label">Trésor</div><div class="stat-value" style="font-size:1.1rem">💰${data.tresor||0}</div></div>
        <div class="stat-box"><div class="stat-label">Défense</div><div class="stat-value">${data.defense||0}</div></div>
      </div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-style:italic;line-height:1.6">${data.description||'Votre bastion attend sa description...'}</div>
    </div>
    <div class="card">
      <div class="card-header">Salles & Améliorations</div>
      ${(data.salles||[]).map(s=>`
        <div class="bastion-room">
          <div>
            <div style="font-size:0.9rem;color:var(--text)">${s.nom}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);font-style:italic">${s.effet||''}</div>
          </div>
          <div class="room-level">
            ${[1,2,3].map(l=>`<span class="${l<=s.niveau?'filled':''}"></span>`).join('')}
          </div>
        </div>`).join('')}
      ${(data.salles||[]).length===0?'<div style="color:var(--text-dim);font-style:italic;font-size:0.85rem">Aucune salle construite.</div>':''}
    </div>
  </div>
  <div class="card" style="margin-top:1.5rem">
    <div class="card-header">Journal du Bastion</div>
    ${(data.journal||[]).length===0
      ? '<div style="color:var(--text-dim);font-style:italic">Aucune entrée.</div>'
      : (data.journal||[]).map(j=>`<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem"><span style="color:var(--text-dim);font-size:0.75rem">${j.date||''}</span> — ${j.texte||''}</div>`).join('')
    }
    <button class="btn btn-outline btn-sm" style="margin-top:0.8rem" onclick="addBastionLog()">+ Ajouter une entrée</button>
  </div>`;
  content.innerHTML = html;
},

// ─── STORY ────────────────────────────────────
async story() {
  const items = await loadCollectionOrdered('story','date');
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">📚 La Trame</div>
    <div class="page-subtitle">L'histoire de votre aventure</div>
  </div>`;
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <button class="btn btn-gold btn-sm" onclick="openStoryModal()">+ Ajouter un événement</button>
    </div>`;
  }
  if (items.length===0) {
    html += `<div class="empty-state"><div class="icon">📚</div><p>L'aventure n'a pas encore commencé...</p></div>`;
  } else {
    html += `<div class="grid-2" style="gap:2rem"><div>`;
    // Filter: events and missions
    const events = items.filter(i=>i.type!=='mission');
    const missions = items.filter(i=>i.type==='mission');
    html += `<div class="card-header" style="margin-bottom:1rem">⚔️ Chronique</div><div class="timeline">`;
    events.forEach(e => {
      html += `<div class="timeline-item">
        <div class="timeline-dot" style="${e.type==='combat'?'background:var(--crimson);border-color:var(--crimson-light)':''}"></div>
        <div class="timeline-date">${e.date||''} ${e.acte?`— ${e.acte}`:''}</div>
        <div class="timeline-title">${e.titre||'Événement'}</div>
        <div class="timeline-desc">${e.description||''}</div>
        ${STATE.isAdmin?`<div style="margin-top:0.4rem"><button class="btn-icon" onclick="editStory('${e.id}')">✏️</button><button class="btn-icon" onclick="deleteStory('${e.id}')">🗑️</button></div>`:''}
      </div>`;
    });
    html += `</div></div><div>
      <div class="card-header" style="margin-bottom:1rem">🎯 Missions</div>`;
    missions.forEach(m => {
      html += `<div class="card" style="margin-bottom:1rem;padding:1rem">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <div style="font-family:'Cinzel',serif;font-size:0.9rem;color:var(--text);margin-bottom:0.3rem">${m.titre||'Mission'}</div>
            <div style="font-size:0.82rem;color:var(--text-muted);font-style:italic">${m.description||''}</div>
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center">
            <span class="badge badge-${m.statut==='Terminée'?'green':m.statut==='En cours'?'gold':'blue'}">${m.statut||'En cours'}</span>
            ${STATE.isAdmin?`<button class="btn-icon" onclick="editStory('${m.id}')">✏️</button><button class="btn-icon" onclick="deleteStory('${m.id}')">🗑️</button>`:''}
          </div>
        </div>
        ${m.recompense?`<div style="margin-top:0.4rem;font-size:0.78rem;color:var(--gold)">💰 Récompense: ${m.recompense}</div>`:''}
      </div>`;
    });
    if (missions.length===0) html += `<div style="color:var(--text-dim);font-style:italic;font-size:0.85rem">Aucune mission active.</div>`;
    html += `</div></div>`;
  }
  content.innerHTML = html;
},

// ─── PLAYERS ──────────────────────────────────
async players() {
  const items = await loadCollection('players');
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">⚔️ Présentation des Joueurs</div>
    <div class="page-subtitle">Les héros de cette aventure</div>
  </div>`;
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <button class="btn btn-gold btn-sm" onclick="openPlayerPresentModal()">+ Ajouter / Modifier</button>
    </div>`;
  }
  if (items.length===0) {
    html += `<div class="empty-state"><div class="icon">⚔️</div><p>Aucun joueur présenté pour l'instant.</p></div>`;
  } else {
    html += `<div class="players-grid">`;
    items.forEach(p => {
      html += `<div class="player-card" onclick="viewPlayerDetail('${p.id}')">
        <div class="player-avatar">${p.emoji||'⚔️'}</div>
        <div class="player-name">${p.nom||'?'}</div>
        <div class="player-class">${p.classe||''} — ${p.race||''}</div>
        <div style="margin-top:0.5rem"><span class="badge badge-gold">Niv. ${p.niveau||1}</span></div>
        ${STATE.isAdmin?`<div style="margin-top:0.5rem;display:flex;gap:0.3rem;justify-content:center">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();editPlayerPresent('${p.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deletePlayerPresent('${p.id}')">🗑️</button>
        </div>`:''}
      </div>`;
    });
    html += '</div>';
  }
  content.innerHTML = html;
},

// ─── ACHIEVEMENTS ─────────────────────────────
async achievements() {
  const items = await loadCollection('achievements');
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🏆 Hauts-Faits</div>
    <div class="page-subtitle">Les exploits légendaires du groupe</div>
  </div>`;
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin (seul l'admin peut gérer les hauts-faits)</div>
      <button class="btn btn-gold btn-sm" onclick="openAchievementModal()">+ Ajouter un Haut-Fait</button>
    </div>`;
  }
  if (items.length===0) {
    html += `<div class="empty-state"><div class="icon">🏆</div><p>Aucun haut-fait accompli pour l'instant...</p></div>`;
  } else {
    html += `<div class="achievement-grid">`;
    items.forEach(a => {
      html += `<div class="achievement-card">
        <div class="achievement-img" style="background:var(--bg-panel)">
          ${a.imageUrl?`<img src="${a.imageUrl}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:3rem">${a.emoji||'🏆'}</span>`}
        </div>
        <div class="achievement-body">
          <div class="achievement-title">${a.titre||'Haut-Fait'}</div>
          <div class="achievement-text">${a.description||''}</div>
          ${a.date?`<div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-dim)">${a.date}</div>`:''}
          ${STATE.isAdmin?`<div style="margin-top:0.8rem;display:flex;gap:0.3rem">
            <button class="btn btn-outline btn-sm" onclick="editAchievement('${a.id}')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteAchievement('${a.id}')">🗑️</button>
          </div>`:''}
        </div>
      </div>`;
    });
    html += '</div>';
  }
  content.innerHTML = html;
},

// ─── COLLECTION ───────────────────────────────
async collection() {
  const items = await loadCollection('collection');
  const content = document.getElementById('main-content');
  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🃏 Collection</div>
    <div class="page-subtitle">Cartes à collectionner</div>
  </div>`;
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <button class="btn btn-gold btn-sm" onclick="openCollectionModal()">+ Ajouter une carte</button>
    </div>`;
  }
  if (items.length===0) {
    html += `<div class="empty-state"><div class="icon">🃏</div><p>La collection est vide.</p></div>`;
  } else {
    html += `<div class="collection-grid">`;
    items.forEach(c => {
      html += `<div class="coll-card" onclick="viewCard('${c.id}')">
        <div class="coll-img">
          ${c.imageUrl?`<img src="${c.imageUrl}" style="width:100%;height:100%;object-fit:cover">`:`<span>${c.emoji||'🃏'}</span>`}
        </div>
        <div class="coll-name">${c.nom||'Carte'}</div>
        ${STATE.isAdmin?`<div style="padding:0 0.5rem 0.5rem;display:flex;gap:0.3rem;justify-content:center">
          <button class="btn-icon" onclick="event.stopPropagation();editCard('${c.id}')">✏️</button>
          <button class="btn-icon" onclick="event.stopPropagation();deleteCard('${c.id}')">🗑️</button>
        </div>`:''}
      </div>`;
    });
    html += '</div>';
  }
  content.innerHTML = html;
},

// ─── TUTORIAL ─────────────────────────────────
async tutorial() {
  const doc = await getDocData('tutorial','main');
  const sections = doc?.sections || getDefaultTutorial();
  const content = document.getElementById('main-content');
  content.innerHTML = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">📕 Tutoriel de Jeu</div>
    <div class="page-subtitle">Comment jouer, règles et mécaniques</div>
  </div>
  ${STATE.isAdmin?`<div class="admin-section">
    <div class="admin-label">Gestion Admin</div>
    <button class="btn btn-gold btn-sm" onclick="editTutorial()">✏️ Modifier le tutoriel</button>
  </div>`:''}
  <div class="grid-2 tutorial-layout-grid" style="gap:1.5rem;align-items:start">
    <div>
      <div class="tutorial-nav" id="tut-nav">
        ${sections.map((s,i)=>`<div class="tutorial-nav-item ${i===0?'active':''}" onclick="showTutSection(${i},this)">${s.title}</div>`).join('')}
      </div>
    </div>
    <div>
      <div class="tutorial-content" id="tut-content">${sections[0]?.content||''}</div>
    </div>
  </div>`;
  window._tutSections = sections;
},

// ─── ADMIN ────────────────────────────────────
async admin() {
  if (!STATE.isAdmin) { navigate('dashboard'); return; }
  const users = await loadCollection('users');
  const content = document.getElementById('main-content');
  content.innerHTML = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">⚙️ Panneau Admin</div>
    <div class="page-subtitle">Gestion complète du jeu</div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-header">Joueurs inscrits (${users.length})</div>
      <table class="data-table">
        <thead><tr><th>Pseudo</th><th>Email</th><th>Inscrit le</th></tr></thead>
        <tbody>
          ${users.filter(u=>u.email!==FS.ADMIN_EMAIL).map(u=>`<tr>
            <td>${u.pseudo||'-'}</td>
            <td style="font-size:0.8rem;color:var(--text-muted)">${u.email||'-'}</td>
            <td style="font-size:0.78rem;color:var(--text-dim)">${u.createdAt?new Date(u.createdAt).toLocaleDateString('fr'):'?'}</td>
          </tr>`).join('')}
        </tbody>
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

// ─── INFORMATIONS ─────────────────────────────
async informations() {
  const doc = await getDocData('informations','main');
  const content = document.getElementById('main-content');
  // Default sections from game document
  const defaultSections = [
    { id:'stats', title:'📊 Statistiques & Races', content: getInfoStats() },
    { id:'equipements', title:'⚔️ Équipements & Armures', content: getInfoEquipements() },
    { id:'combat', title:'🎯 Règles de Combat', content: getInfoCombat() },
    { id:'deck', title:'🃏 Deck & Runes', content: getInfoDeck() },
    { id:'artisanat', title:'🔨 Artisanat', content: getInfoArtisanat() },
    { id:'bastion', title:'🏰 Le Bastion', content: getInfoBastion() },
    { id:'etats', title:'💊 États', content: getInfoEtats() },
  ];
  const sections = doc?.sections || defaultSections;
  const activeSection = window._infoSection || sections[0]?.id;
  window._infoSection = activeSection;

  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">📋 Informations du JDR</span></div>
    <div class="page-subtitle">Règles, mécaniques et lore du monde</div>
  </div>
  ${STATE.isAdmin?`<div class="admin-section">
    <div class="admin-label">Admin — Modification du contenu</div>
    <button class="btn btn-gold btn-sm" onclick="editInfoSection('${activeSection}')">✏️ Modifier cette section</button>
  </div>`:''}
  <div class="grid-2 tutorial-layout-grid" style="gap:1.5rem;align-items:start">
    <div>
      <div class="tutorial-nav" id="info-nav">
        ${sections.map(s=>`<div class="tutorial-nav-item ${s.id===activeSection?'active':''}" onclick="showInfoSection('${s.id}',this)">${s.title}</div>`).join('')}
      </div>
    </div>
    <div>
      <div class="tutorial-content" id="info-content" style="white-space:pre-wrap">${sections.find(s=>s.id===activeSection)?.content||''}</div>
    </div>
  </div>`;
  content.innerHTML = html;
  window._infoSections = sections;
},

// ─── RECETTES ─────────────────────────────────
async recettes() {
  const doc = await getDocData('recettes','main');
  const content = document.getElementById('main-content');
  const recettes = doc?.recettes || [];
  const potions = doc?.potions || [];

  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🍳 Recettes & Potions</span></div>
    <div class="page-subtitle">Cuisine de groupe et alchimie</div>
  </div>
  ${STATE.isAdmin?`<div class="admin-section">
    <div class="admin-label">Gestion Admin</div>
    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-gold btn-sm" onclick="openRecetteModal('cuisine')">+ Recette cuisine</button>
      <button class="btn btn-gold btn-sm" onclick="openRecetteModal('potion')">+ Potion</button>
    </div>
  </div>`:''}

  <div style="background:rgba(226,185,111,0.05);border:1px solid rgba(226,185,111,0.15);border-radius:8px;padding:1rem;margin-bottom:1.5rem;font-size:0.85rem;color:var(--text-muted)">
    <strong style="color:var(--gold)">🍳 Cuisine</strong> — Avant mission ou pendant un repos. Bénéficie à tout le groupe. Max 2 plats actifs simultanément.<br>
    <strong style="color:var(--gold)">🧪 Potions</strong> — Préparées avant une mission. Effets individuels.
  </div>

  <div class="grid-2" style="gap:1.5rem">
    <div>
      <div class="card-header" style="margin-bottom:1rem">🍳 Cuisine (${recettes.length})</div>
      ${recettes.length===0?`<div class="empty-state"><span class="icon">🍳</span><p>Aucune recette de cuisine.</p></div>`:
        recettes.map(r=>`<div class="card" style="margin-bottom:0.8rem;padding:1rem">
          <div style="display:flex;justify-content:space-between">
            <div style="font-weight:700;font-size:0.92rem;color:var(--text)">${r.nom}</div>
            ${STATE.isAdmin?`<div style="display:flex;gap:0.3rem"><button class="btn-icon" onclick="editRecette('${r.id}','cuisine')">✏️</button><button class="btn-icon" onclick="deleteRecette('${r.id}')">🗑️</button></div>`:''}
          </div>
          ${r.duree?`<div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.2rem">⏱️ ${r.duree}</div>`:''}
          ${r.ingredients?`<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">🌿 ${r.ingredients}</div>`:''}
          <div style="font-size:0.82rem;color:var(--text);margin-top:0.4rem;font-style:italic">${r.effet||''}</div>
        </div>`).join('')}
    </div>
    <div>
      <div class="card-header" style="margin-bottom:1rem">🧪 Potions (${potions.length})</div>
      ${potions.length===0?`<div class="empty-state"><span class="icon">🧪</span><p>Aucune potion.</p></div>`:
        potions.map(p=>`<div class="card" style="margin-bottom:0.8rem;padding:1rem">
          <div style="display:flex;justify-content:space-between">
            <div>
              <span style="font-weight:700;font-size:0.92rem;color:var(--text)">${p.nom}</span>
              ${p.famille?`<span class="badge badge-blue" style="margin-left:0.4rem;font-size:0.65rem">${p.famille}</span>`:''}
            </div>
            ${STATE.isAdmin?`<div style="display:flex;gap:0.3rem"><button class="btn-icon" onclick="editRecette('${p.id}','potion')">✏️</button><button class="btn-icon" onclick="deleteRecette('${p.id}')">🗑️</button></div>`:''}
          </div>
          ${p.ingredients?`<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">🌿 ${p.ingredients}</div>`:''}
          <div style="font-size:0.82rem;color:var(--text);margin-top:0.4rem;font-style:italic">${p.effet||''}</div>
        </div>`).join('')}
    </div>
  </div>`;
  content.innerHTML = html;
},

// ─── BESTIAIRE ────────────────────────────────
async bestiaire() {
  const items = await loadCollection('bestiaire');
  const content = document.getElementById('main-content');
  const cats = [...new Set(items.map(i=>i.categorie||'Créature'))].sort();

  let html = `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🐉 Bestiaire</span></div>
    <div class="page-subtitle">Créatures et monstres du monde</div>
  </div>
  ${STATE.isAdmin?`<div class="admin-section">
    <div class="admin-label">Gestion Admin</div>
    <button class="btn btn-gold btn-sm" onclick="openBestiaryModal()">+ Ajouter une créature</button>
  </div>`:''}`;

  if (items.length===0) {
    html += `<div class="empty-state"><div class="icon">🐉</div><p>Le bestiaire est vide.</p></div>`;
  } else {
    html += `<div class="tabs" id="best-cats" style="margin-bottom:1.5rem">
      <button class="tab active" onclick="filterBestiary(null,this)">Toutes</button>
      ${cats.map(c=>`<button class="tab" onclick="filterBestiary('${c}',this)">${c}</button>`).join('')}
    </div>
    <div style="display:flex;flex-direction:column;gap:1rem" id="bestiary-list">`;
    items.forEach(c => {
      html += `<div class="card bestiary-card" data-cat="${c.categorie||'Créature'}" style="padding:1.2rem">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.8rem">
          <div>
            <div style="font-weight:700;font-size:1.05rem;color:var(--text)">${c.emoji||'🐉'} ${c.nom||'Créature'}</div>
            ${c.categorie?`<span class="badge badge-gold" style="font-size:0.65rem;margin-top:0.2rem">${c.categorie}</span>`:''}
          </div>
          ${STATE.isAdmin?`<div style="display:flex;gap:0.3rem"><button class="btn-icon" onclick="editBestiary('${c.id}')">✏️</button><button class="btn-icon" onclick="deleteBestiary('${c.id}')">🗑️</button></div>`:''}
        </div>
        <div class="grid-4" style="gap:0.5rem;margin-bottom:0.8rem">
          <div class="stat-box" style="padding:0.5rem"><div class="stat-label">PV</div><div style="font-size:1rem;font-weight:700;color:#2ecc71">${c.pv||'?'}</div></div>
          <div class="stat-box" style="padding:0.5rem"><div class="stat-label">PM</div><div style="font-size:1rem;font-weight:700;color:var(--blue)">${c.pm||'?'}</div></div>
          <div class="stat-box" style="padding:0.5rem"><div class="stat-label">CA</div><div style="font-size:1rem;font-weight:700;color:var(--gold)">${c.ca||'?'}</div></div>
          <div class="stat-box" style="padding:0.5rem"><div class="stat-label">XP</div><div style="font-size:1rem;font-weight:700;color:var(--text-muted)">${c.xp||'?'}</div></div>
        </div>
        ${(c.attaques||[]).length>0?`<div style="margin-bottom:0.6rem">
          <div style="font-size:0.7rem;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.3rem">⚔️ Attaques</div>
          ${c.attaques.map(a=>`<div style="font-size:0.82rem;padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="color:var(--text);font-weight:600">${a.nom}</span>
            <span style="color:var(--text-dim);margin:0 0.3rem">·</span>
            <span style="color:var(--crimson-light)">${a.degats||'?'}</span>
            ${a.effet?`<span style="color:var(--text-muted);font-style:italic"> — ${a.effet}</span>`:''}
          </div>`).join('')}
        </div>`:''}
        ${c.traits?`<div style="font-size:0.82rem;color:var(--text-muted);font-style:italic">✨ ${c.traits}</div>`:''}
        ${c.butins?`<div style="font-size:0.78rem;color:var(--gold);margin-top:0.4rem">💎 Butin : ${c.butins}</div>`:''}
      </div>`;
    });
    html += '</div>';
  }
  content.innerHTML = html;
},

}; // end PAGES
