// ══════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════
import { STATE, FS } from '../core/state.js';
import { countUserChars, loadChars, loadCollection, loadCollectionOrdered, getDocData, saveDoc } from '../data/firestore.js';
import { _esc } from '../shared/html.js';
import { calcPalier } from '../shared/char-stats.js';

// TODO: mettre le code js des autres pages dans leurs fichiers respectives pour réduire la taille de ce fichier et importer comme ça:
import { renderCollectionPage } from '../features/collection.js';

const renderCharSheet   = (...args) => window.renderCharSheet?.(...args);
const getDefaultBastion = () => window.getDefaultBastion?.() || { nom: 'Sans nom', niveau: 1, tresor: 0, defense: 0, description: '', ameliorationsCustom: [], evenementCourant: 'calme', fondateurs: [], historique: [], salles: [], journal: [] };
const getDefaultTutorial = () => window.getDefaultTutorial?.() || [{ title: 'Introduction', content: 'Le tutoriel sera ajouté ici.' }];

const PAGES = {

  // ─── DASHBOARD ──────────────────────────────────────────────────────────────
  async dashboard() {
    const content = document.getElementById('main-content');

    // Squelette animé
    content.innerHTML = `
    <div class="dash-root" id="dash-root">
      <div style="height:100px;background:var(--bg-card);border-radius:var(--radius-lg);border:1px solid var(--border);animation:pulse 1.5s ease infinite"></div>
      <div style="height:80px;background:var(--bg-card);border-radius:var(--radius-lg);border:1px solid var(--border);animation:pulse 1.5s ease infinite .1s"></div>
      <div class="dash-2col">
        <div style="height:120px;background:var(--bg-card);border-radius:var(--radius-lg);border:1px solid var(--border);animation:pulse 1.5s ease infinite .15s"></div>
        <div style="height:120px;background:var(--bg-card);border-radius:var(--radius-lg);border:1px solid var(--border);animation:pulse 1.5s ease infinite .2s"></div>
      </div>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style>`;

    // Charger les données en parallèle
    const uid = STATE.isAdmin ? null : STATE.user.uid;
    const [chars, storyItems, bastionDoc, achievements, quests, collectionItems, allPartyChars] = await Promise.all([
      loadChars(uid).catch(() => []),
      loadCollection('story').catch(() => []),
      getDocData('bastion', 'main').catch(() => null),
      loadCollection('achievements').catch(() => []),
      loadCollection('quests').catch(() => []),
      loadCollection('collection').catch(() => []),
      STATE.isAdmin ? Promise.resolve([]) : loadChars(null).catch(() => []),
    ]);
    STATE.characters = chars;

    const pseudo = STATE.profile?.pseudo || 'Aventurier';

    // Mission active
    const mission = storyItems
      .filter(i => i.type === 'mission' && i.statut === 'En cours')
      .sort((a,b) => (b.ordre||0) - (a.ordre||0))[0] || null;

    // Progression trame
    const totalMissions = storyItems.filter(i => i.type === 'mission').length;
    const doneMissions  = storyItems.filter(i => i.type === 'mission' && i.statut === 'Terminée').length;

    // Bastion
    const bastionLevel  = bastionDoc ? 1 + (bastionDoc.ameliorationsCustom||[]).filter(a=>(a.fondsActuels||0)>=(a.cout||1)&&(a.cout||1)>0).length : null;
    const bastionNom    = bastionDoc?.nom || 'Le Bastion';

    // ── Carte mini personnage ─────────────────────────────────────────
    function _charMini(c) {
      const pvMax   = window.calcPVMax?.(c) || c.pvBase || 10;
      const pmMax   = window.calcPMMax?.(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const pvColor = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
      const ca      = window.calcCA?.(c) || 10;
      const or      = window.calcOr?.(c) || 0;
      const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
      const portrait = c.photo
        ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos};display:block">`
        : `<span style="font-family:'Cinzel',serif;font-size:1.3rem;font-weight:700;color:var(--gold)">${(c.nom||'?')[0].toUpperCase()}</span>`;
      return `
      <div class="dash-char-mini" onclick="window._goToChar('${c.id}')">
        <div class="dash-char-mini-portrait">
          ${portrait}
          <div class="dash-char-mini-portrait-fade"></div>
        </div>
        <div class="dash-char-mini-body">
          <div style="display:flex;align-items:baseline;gap:.4rem;flex-wrap:wrap;margin-bottom:.15rem">
            <span style="font-family:'Cinzel',serif;font-size:.92rem;font-weight:700;color:var(--text)">${_esc(c.nom||'?')}</span>
            <span class="dash-hero-badge">Niv.&nbsp;${c.niveau||1}</span>
          </div>
          ${c.classe ? `<div style="font-size:.7rem;color:var(--text-dim);margin-bottom:.35rem">${_esc(c.classe)}${c.race?` · ${_esc(c.race)}`:''}</div>` : ''}
          <div style="display:flex;flex-direction:column;gap:.28rem">
            <div class="dash-bar-row">
              <span class="dash-bar-icon" style="font-size:.62rem">❤️</span>
              <div class="dash-bar-track" style="height:7px"><div class="dash-bar-fill" style="width:${pvPct}%;background:${pvColor}"></div></div>
              <span class="dash-bar-val" style="font-size:.68rem;min-width:36px;color:${pvColor}">${pvCur}/${pvMax}</span>
            </div>
            <div class="dash-bar-row">
              <span class="dash-bar-icon" style="font-size:.62rem">🔵</span>
              <div class="dash-bar-track" style="height:7px"><div class="dash-bar-fill" style="width:${pmPct}%;background:linear-gradient(90deg,#22c7ea,#4adbf7)"></div></div>
              <span class="dash-bar-val" style="font-size:.68rem;min-width:36px;color:#4adbf7">${pmCur}/${pmMax}</span>
            </div>
          </div>
          <div style="display:flex;gap:.35rem;margin-top:.35rem">
            <span class="dash-chip" style="font-size:.66rem;padding:1px 7px">🛡️ ${ca}</span>
            <span class="dash-chip dash-chip--gold" style="font-size:.66rem;padding:1px 7px">💰 ${or}</span>
          </div>
        </div>
        <div class="dash-hero-arrow" style="font-size:.85rem;align-self:center;padding:.5rem">→</div>
      </div>`;
    }

    // ── Carte héros principale (1 seul perso joueur) ──────────────────
    function _charFeatured(c) {
      const pvMax   = window.calcPVMax?.(c) || c.pvBase || 10;
      const pmMax   = window.calcPMMax?.(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const pvColor = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
      const ca      = window.calcCA?.(c) || 10;
      const or      = window.calcOr?.(c) || 0;
      const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
      const portrait = c.photo
        ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
        : `<span style="font-family:'Cinzel',serif;font-size:1.6rem;font-weight:700;color:var(--gold)">${(c.nom||'?')[0].toUpperCase()}</span>`;
      return `
      <div class="dash-hero" onclick="window._goToChar('${c.id}')">
        <div class="dash-hero-glow"></div>
        <div class="dash-hero-portrait">
          <div class="dash-hero-portrait-inner">${portrait}</div>
          <div class="dash-hero-portrait-fade"></div>
        </div>
        <div class="dash-hero-body">
          <div>
            <div class="dash-hero-name">${_esc(c.nom||'Mon personnage')}</div>
            <div class="dash-hero-meta">
              <span class="dash-hero-badge">Niv. ${c.niveau||1}</span>
              ${c.classe ? `<span class="dash-hero-badge">${_esc(c.classe)}</span>` : ''}
            </div>
            ${c.titre ? `<div class="dash-hero-titre">${_esc(c.titre)}</div>` : ''}
          </div>
          <div>
            <div class="dash-hero-bars">
              <div class="dash-bar-row">
                <span class="dash-bar-icon">❤️</span>
                <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pvPct}%;background:${pvColor}"></div></div>
                <span class="dash-bar-val" style="color:${pvColor}">${pvCur}/${pvMax}</span>
              </div>
              <div class="dash-bar-row">
                <span class="dash-bar-icon">🔵</span>
                <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pmPct}%;background:linear-gradient(90deg,#22c7ea,#4adbf7)"></div></div>
                <span class="dash-bar-val" style="color:#4adbf7">${pmCur}/${pmMax}</span>
              </div>
            </div>
            <div class="dash-hero-chips">
              <span class="dash-chip">🛡️ CA <strong>${ca}</strong></span>
              <span class="dash-chip dash-chip--gold">💰 <strong>${or}</strong> or</span>
            </div>
          </div>
        </div>
        <div class="dash-hero-arrow">→</div>
      </div>`;
    }

    // ── Carte admin ultra-compacte (ligne de tableau) ────────────────
    function _charRow(c) {
      const pvMax   = window.calcPVMax?.(c) || c.pvBase || 10;
      const pmMax   = window.calcPMMax?.(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const pvColor = pvPct < 25 ? '#ff6b6b' : pvPct < 50 ? '#f59e0b' : '#22c38e';
      const ca      = window.calcCA?.(c) || 10;
      const or      = window.calcOr?.(c) || 0;
      const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
      const avatar = c.photo
        ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos};display:block">`
        : `<span style="font-family:'Cinzel',serif;font-size:.8rem;font-weight:700;color:var(--gold)">${(c.nom||'?')[0].toUpperCase()}</span>`;
      // Couleur par joueur (hash sur le pseudo)
      const PCOLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#22d3ee'];
      const pcol  = PCOLS[(c.ownerPseudo||'?').split('').reduce((a,x)=>a+x.charCodeAt(0),0) % PCOLS.length];
      return `
      <div onclick="window._goToChar('${c.id}')" style="
        display:flex;align-items:center;gap:.65rem;
        background:var(--bg-card);border:1px solid var(--border);
        border-left:3px solid ${pcol};
        border-radius:var(--radius-lg);padding:.5rem .7rem;
        cursor:pointer;transition:border-color .15s,transform .15s;overflow:hidden"
        onmouseover="this.style.borderColor='${pcol}';this.style.transform='translateY(-1px)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.borderLeftColor='${pcol}';this.style.transform=''">

        <!-- Avatar -->
        <div style="width:36px;height:36px;border-radius:9px;overflow:hidden;flex-shrink:0;
          background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
          display:flex;align-items:center;justify-content:center">
          ${avatar}
        </div>

        <!-- Nom + classe -->
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:.35rem;flex-wrap:wrap">
            <span style="font-family:'Cinzel',serif;font-size:.84rem;font-weight:700;
              color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">${_esc(c.nom||'?')}</span>
            <span style="font-size:.63rem;color:var(--text-dim);background:var(--bg-elevated);
              border:1px solid var(--border);border-radius:5px;padding:0 5px;flex-shrink:0">Niv.${c.niveau||1}</span>
          </div>
          <div style="font-size:.68rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">
            ${c.classe||''}${c.race?` · ${c.race}`:''}
          </div>
        </div>

        <!-- Barres PV/PM -->
        <div style="display:flex;flex-direction:column;gap:.2rem;width:72px;flex-shrink:0">
          <div style="display:flex;align-items:center;gap:.3rem">
            <div style="flex:1;height:5px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden">
              <div style="width:${pvPct}%;height:100%;background:${pvColor};border-radius:999px"></div>
            </div>
            <span style="font-size:.6rem;color:${pvColor};font-weight:700;min-width:26px;text-align:right">${pvCur}</span>
          </div>
          <div style="display:flex;align-items:center;gap:.3rem">
            <div style="flex:1;height:5px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden">
              <div style="width:${pmPct}%;height:100%;background:linear-gradient(90deg,#22c7ea,#4adbf7);border-radius:999px"></div>
            </div>
            <span style="font-size:.6rem;color:#4adbf7;font-weight:700;min-width:26px;text-align:right">${pmCur}</span>
          </div>
        </div>

        <!-- CA + Or -->
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.18rem;flex-shrink:0">
          <span style="font-size:.63rem;color:var(--text-dim);white-space:nowrap">🛡️ <strong style="color:var(--text)">${ca}</strong></span>
          <span style="font-size:.63rem;color:#c8a73a;white-space:nowrap">💰 ${or}</span>
        </div>

        <!-- Joueur tag -->
        <div style="font-size:.62rem;font-weight:700;color:${pcol};background:${pcol}18;
          border:1px solid ${pcol}44;border-radius:6px;padding:2px 7px;
          white-space:nowrap;flex-shrink:0;max-width:70px;overflow:hidden;text-overflow:ellipsis">
          ${_esc(c.ownerPseudo||'?')}
        </div>

      </div>`;
    }

    // ── Section personnages ───────────────────────────────────────────
    let charsHtml = '';
    if (STATE.isAdmin) {
      if (chars.length === 0) {
        charsHtml = `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.2rem;text-align:center;color:var(--text-dim);font-size:.85rem">
          <div style="font-size:1.5rem;margin-bottom:.4rem;opacity:.35">📜</div>Aucun personnage dans cette aventure</div>`;
      } else {
        // Tri : par joueur d'abord, puis par niveau desc
        const sorted = [...chars].sort((a,b) => {
          const pa = a.ownerPseudo||'', pb = b.ownerPseudo||'';
          return pa.localeCompare(pb) || (b.niveau||1) - (a.niveau||1);
        });
        charsHtml = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.45rem">
          ${sorted.map(c => _charRow(c)).join('')}
        </div>`;
      }
    } else {
      if (chars.length === 0) {
        charsHtml = `
        <div class="dash-hero" onclick="navigate('characters')" style="cursor:pointer">
          <div class="dash-hero-body" style="flex-direction:row;align-items:center;gap:1rem;padding:1.3rem 1.5rem">
            <div style="width:48px;height:48px;border-radius:50%;background:rgba(232,184,75,.08);
              border:1px dashed rgba(232,184,75,.3);display:flex;align-items:center;justify-content:center;
              font-size:1.3rem;flex-shrink:0">⚔️</div>
            <div style="flex:1">
              <div class="dash-hero-name" style="font-size:.95rem">Créer mon personnage</div>
              <div style="font-size:.78rem;color:var(--text-dim);margin-top:2px">Bienvenue ${_esc(pseudo)} ! Commence par créer ta fiche de héros.</div>
            </div>
            <div class="dash-hero-arrow">→</div>
          </div>
        </div>`;
      } else if (chars.length === 1) {
        charsHtml = _charFeatured(chars[0]);
      } else {
        charsHtml = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.55rem">
          ${chars.map(c => _charMini(c)).join('')}
        </div>`;
      }
    }

    // ── Render ────────────────────────────────────────────────────────
    const dash = document.getElementById('dash-root');
    if (!dash) return;

    const _myUid           = STATE.user?.uid;
    const collectionUnlocked = collectionItems.filter(c => c.unlocked).length;
    const activeQuests     = quests
      .filter(q => q.statut === 'active')
      .sort((a, b) => (b.createdAt||'') > (a.createdAt||'') ? 1 : -1);

    // Stocker pour la fonction join
    window._dashQuestData = quests;

    // Join inline depuis le dashboard (sans charger quests.js)
    window._dashQuestJoin = async function (id, el) {
      const quest  = (window._dashQuestData||[]).find(q => q.id === id);
      if (!quest) return;
      const myUid  = STATE.user?.uid;
      const myChar = (STATE.characters||[]).find(c => c.uid === myUid);
      if (!myChar) { window.showNotif?.('Aucun personnage trouvé.', 'error'); return; }
      if (el) { el.disabled = true; el.textContent = '…'; }
      const parts = Array.isArray(quest.participants) ? [...quest.participants] : [];
      const idx   = parts.findIndex(p => p.uid === myUid);
      if (idx >= 0) { parts.splice(idx, 1); }
      else { parts.push({ uid: myUid, charId: myChar.id, nom: myChar.nom||'?', photo: myChar.photo||null, photoX: myChar.photoX||0, photoY: myChar.photoY||0 }); }
      try {
        await saveDoc('quests', id, { participants: parts });
        window.showNotif?.(idx >= 0 ? 'Tu as quitté cette quête.' : 'Tu as rejoint cette quête !', idx >= 0 ? 'info' : 'success');
        await PAGES.dashboard();
      } catch { window.showNotif?.('Erreur.', 'error'); if (el) { el.disabled = false; } }
    };

    // ── Helpers ────────────────────────────────────────────────────────

    // Mini-portrait
    const _portMini = (p, size = 26) => {
      const pos = `${50+(p.photoX||0)*50}% ${50+(p.photoY||0)*50}%`;
      return p.photo
        ? `<img src="${p.photo}" title="${_esc(p.nom||'?')}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;object-position:${pos};border:2px solid var(--bg-card);flex-shrink:0">`
        : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(79,140,255,.18);border:2px solid var(--bg-card);display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:${Math.round(size*.38)}px;font-weight:700;color:var(--gold);flex-shrink:0">${(p.nom||'?')[0].toUpperCase()}</div>`;
    };

    // Carte quête (joinable en place, pas de navigation sur le conteneur)
    const QDIFF = { facile:'#22c38e', moyen:'#4f8cff', difficile:'#e8b84b', extreme:'#ff6b6b' };
    const QDLBL = { facile:'Facile',  moyen:'Moyen',   difficile:'Difficile', extreme:'Extrême' };
    const _dashQuestCard = q => {
      const col    = QDIFF[q.difficulte] || '#4f8cff';
      const dlbl   = QDLBL[q.difficulte] || 'Moyen';
      const parts  = Array.isArray(q.participants) ? q.participants : [];
      const joined = parts.some(p => p.uid === _myUid);
      const portHtml = parts.slice(0,4).map(p => _portMini(p, 24)).join('');
      const joinBtn = !STATE.isAdmin
        ? `<button class="quest-join-btn${joined?' quest-join-btn--joined':''}"
             onclick="window._dashQuestJoin('${q.id}',this)">
             ${joined ? '✓ Rejoint' : '+ Rejoindre'}
           </button>`
        : '';
      return `
      <div class="quest-card quest-card--active">
        <div class="quest-card-hd">
          <span class="quest-badge" style="background:${col}22;color:${col};border-color:${col}44">${dlbl}</span>
          <div style="margin-left:auto;display:flex;gap:.3rem;align-items:center">${joinBtn}</div>
        </div>
        <div class="quest-card-title">${_esc(q.titre||'Quête')}</div>
        ${q.description ? `<div class="quest-card-desc">${_esc(q.description)}</div>` : ''}
        ${q.recompense  ? `<div class="quest-reward">🎁 ${_esc(q.recompense)}</div>` : ''}
        ${parts.length > 0 ? `<div class="quest-parts">${portHtml}${parts.length>4?`<span class="quest-parts-count">+${parts.length-4}</span>`:''}</div>` : ''}
      </div>`;
    };

    // Bloc mission compact
    const _missionCard = () => {
      if (!mission) return null;
      return `<div class="dash-info-card" onclick="navigate('story')" style="cursor:pointer">
        <div class="dash-mission-compact">
          ${mission.imageUrl
            ? `<img src="${mission.imageUrl}" class="dash-mission-thumb">`
            : `<div class="dash-mission-thumb dash-mission-thumb--empty">⚔️</div>`}
          <div style="flex:1;min-width:0">
            <div class="dash-info-sublabel">Mission active${mission.acte ? ` · ${_esc(mission.acte)}` : ''}</div>
            <div class="dash-info-title">${_esc(mission.titre||'Mission')}</div>
            ${mission.lieu ? `<div class="dash-info-meta">📍 ${_esc(mission.lieu)}</div>` : ''}
          </div>
        </div>
      </div>`;
    };

    // Barre progression trame (v2)
    const _progBar = () => {
      if (totalMissions === 0) return '';
      const pct = Math.round(doneMissions / totalMissions * 100);
      return `
      <div class="dv2-panel-card" onclick="navigate('story')" style="cursor:pointer;padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)">📖 Progression aventure</span>
          <span style="font-size:.72rem;color:var(--arcane);font-weight:700;font-family:var(--font-display)">${doneMissions}/${totalMissions} missions</span>
        </div>
        <div class="dv2-mission-prog-track">
          <div class="dv2-mission-prog-fill" data-w="${pct}%"><div class="dv2-mission-shimmer"></div></div>
        </div>
      </div>`;
    };

    // ── Helpers joueur v2 ─────────────────────────────────────────────

    function _heroCardV2(c) {
      const pvMax   = window.calcPVMax?.(c) || c.pvBase || 10;
      const pmMax   = window.calcPMMax?.(c) || c.pmBase || 10;
      const pvCur   = c.pvActuel ?? pvMax;
      const pmCur   = c.pmActuel ?? pmMax;
      const pvPct   = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct   = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const xpCur   = c.exp || 0;
      const xpNext  = calcPalier(c.niveau || 1);
      const xpPct   = Math.min(100, Math.round(xpCur / xpNext * 100));
      const ca      = window.calcCA?.(c) || 10;
      const or      = window.calcOr?.(c) || 0;
      const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
      const portrait = c.photo
        ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
        : `<span>${(c.nom||'?')[0].toUpperCase()}</span>`;
      return `
      <div class="dv2-hero-card" onclick="window._goToChar('${c.id}')">
        <div class="dv2-hero-inner">
          <div class="dv2-portrait-wrap">
            <div class="dv2-portrait">${portrait}</div>
            <div class="dv2-portrait-level">NIV.&nbsp;${c.niveau||1}</div>
          </div>
          <div class="dv2-hero-info">
            <div>
              <div class="dv2-chips">
                ${c.classe ? `<span class="dv2-chip dv2-chip-blue">${_esc(c.classe)}</span>` : ''}
                ${c.race   ? `<span class="dv2-chip dv2-chip-purple">${_esc(c.race)}</span>` : ''}
              </div>
              <div class="dv2-hero-name">${_esc(c.nom||'Mon Héros')}</div>
              ${c.titre ? `<div class="dv2-hero-title">${_esc(c.titre)}</div>` : ''}
            </div>
            <div class="dv2-stat-bars">
              <div class="dv2-bar-row">
                <span class="dv2-bar-label" style="color:#22c38e">PV</span>
                <div class="dv2-bar-track"><div class="dv2-bar-fill dv2-bar-hp" data-w="${pvPct}%"></div></div>
                <span class="dv2-bar-val">${pvCur}/${pvMax}</span>
              </div>
              <div class="dv2-bar-row">
                <span class="dv2-bar-label" style="color:#6aa7ff">PM</span>
                <div class="dv2-bar-track"><div class="dv2-bar-fill dv2-bar-mp" data-w="${pmPct}%"></div></div>
                <span class="dv2-bar-val">${pmCur}/${pmMax}</span>
              </div>
              <div class="dv2-bar-row">
                <span class="dv2-bar-label" style="color:#c084fc">XP</span>
                <div class="dv2-bar-track"><div class="dv2-bar-fill dv2-bar-xp" data-w="${xpPct}%"><div class="dv2-bar-xp-shimmer"></div></div></div>
                <span class="dv2-bar-val">${xpCur}/${xpNext}</span>
              </div>
            </div>
            <div class="dv2-stats-row">
              <div class="dv2-stat-pill">
                <div class="dv2-stat-pill-val" style="color:#f4c430">💰 ${or}</div>
                <div class="dv2-stat-pill-lbl">Or</div>
              </div>
              <div class="dv2-stat-pill">
                <div class="dv2-stat-pill-val" style="color:var(--gold-2)">🛡️ ${ca}</div>
                <div class="dv2-stat-pill-lbl">CA</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }

    function _partyCardV2(partyChars) {
      const byPlayer = {};
      partyChars.forEach(c => {
        const key = c.uid || c.ownerPseudo || c.id;
        if (!byPlayer[key] || (c.niveau||1) > (byPlayer[key].niveau||1)) byPlayer[key] = c;
      });
      const members = Object.values(byPlayer).slice(0, 5);
      return `
      <div class="dv2-party-card">
        <div class="dv2-panel-header">
          <div class="dv2-panel-title">⚔️ Groupe <span class="dv2-panel-count">${members.length}</span></div>
        </div>
        ${members.length > 0 ? members.map(c => {
          const photoPos = `${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%`;
          const av = c.photo
            ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;object-position:${photoPos}">`
            : (c.nom||'?')[0].toUpperCase();
          return `
          <div class="dv2-party-member" onclick="window._goToChar('${c.id}')" style="cursor:pointer">
            <div class="dv2-party-avatar">${av}</div>
            <div style="flex:1;min-width:0">
              <div class="dv2-party-name">${_esc(c.nom||'?')}</div>
              <div class="dv2-party-sub">Niv.${c.niveau||1}${c.classe?` · ${_esc(c.classe)}`:''}</div>
            </div>
            <div class="dv2-party-dot"></div>
          </div>`;
        }).join('') : `<div style="padding:18px;color:var(--text-dim);font-size:.8rem">Les membres du groupe apparaîtront ici.</div>`}
        ${STATE.adventure ? `
        <div class="dv2-party-footer">
          <div class="dv2-party-session-label">Aventure en cours</div>
          <div class="dv2-party-session-chip">${STATE.adventure.emoji||'⚔️'} ${_esc(STATE.adventure.nom||'Aventure')}</div>
        </div>` : ''}
      </div>`;
    }

    function _missionCardV2() {
      if (!mission) return '';
      const pct = totalMissions > 0 ? Math.round(doneMissions / totalMissions * 100) : 0;
      return `
      <div class="dv2-mission-card" onclick="navigate('story')" style="cursor:pointer">
        <div class="dv2-mission-header">
          <div class="dv2-mission-icon">${mission.imageUrl
            ? `<img src="${mission.imageUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
            : '⚔️'}</div>
          <div class="dv2-mission-info">
            <div class="dv2-mission-type">Mission active${mission.acte ? ` · ${_esc(mission.acte)}` : ''}</div>
            <div class="dv2-mission-name">${_esc(mission.titre||'Mission')}</div>
            ${mission.lieu ? `<div style="font-size:.72rem;color:var(--text-dim);margin-top:3px">📍 ${_esc(mission.lieu)}</div>` : ''}
          </div>
          <div class="dv2-mission-status"><span style="opacity:.7">●</span>&nbsp;En cours</div>
        </div>
        ${mission.description ? `<div class="dv2-mission-desc">${_esc(mission.description)}</div>` : ''}
        ${totalMissions > 0 ? `
        <div class="dv2-mission-progress">
          <div class="dv2-mission-prog-labels">
            <span>Progression de l'aventure</span>
            <span class="dv2-mission-prog-val">${doneMissions}/${totalMissions}</span>
          </div>
          <div class="dv2-mission-prog-track">
            <div class="dv2-mission-prog-fill" data-w="${pct}%"><div class="dv2-mission-shimmer"></div></div>
          </div>
        </div>` : ''}
      </div>`;
    }

    function _statsGridV2(c) {
      const pvMax = window.calcPVMax?.(c) || c.pvBase || 10;
      const pmMax = window.calcPMMax?.(c) || c.pmBase || 10;
      const pvCur = c.pvActuel ?? pvMax;
      const pmCur = c.pmActuel ?? pmMax;
      const pvPct = pvMax > 0 ? Math.round(pvCur / pvMax * 100) : 0;
      const pmPct = pmMax > 0 ? Math.round(pmCur / pmMax * 100) : 0;
      const ca = window.calcCA?.(c) || 10;
      const or = window.calcOr?.(c) || 0;
      return `
      <div class="dv2-stats-grid">
        <div class="dv2-stat-card dv2-sc-gold" onclick="window._goToChar('${c.id}')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">💰</span>
          <div class="dv2-stat-card-val" style="color:#f4c430">${or}</div>
          <div class="dv2-stat-card-lbl">Or</div>
        </div>
        <div class="dv2-stat-card dv2-sc-shield" onclick="window._goToChar('${c.id}')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">🛡️</span>
          <div class="dv2-stat-card-val" style="color:var(--gold-2)">${ca}</div>
          <div class="dv2-stat-card-lbl">Classe d'armure</div>
        </div>
        <div class="dv2-stat-card dv2-sc-hp" onclick="window._goToChar('${c.id}')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">❤️</span>
          <div class="dv2-stat-card-val" style="color:#22c38e">${pvCur}<span style="font-size:.65em;opacity:.55">/${pvMax}</span></div>
          <div class="dv2-stat-card-lbl">Points de vie</div>
          <div class="dv2-stat-card-sub">${pvPct}% restants</div>
        </div>
        <div class="dv2-stat-card dv2-sc-mp" onclick="window._goToChar('${c.id}')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">🔮</span>
          <div class="dv2-stat-card-val" style="color:#b99fff">${pmCur}<span style="font-size:.65em;opacity:.55">/${pmMax}</span></div>
          <div class="dv2-stat-card-lbl">Points de magie</div>
          <div class="dv2-stat-card-sub">${pmPct}% restants</div>
        </div>
      </div>`;
    }

    function _shortcutsV2() {
      const S = [
        { page:'bestiaire',  icon:'🐉', label:'Bestiaire',  bg:'rgba(255,90,126,.15)',  bc:'rgba(255,90,126,.3)',  col:'#ff5a7e' },
        { page:'recettes',   icon:'🍳', label:'Recettes',   bg:'rgba(34,195,142,.15)',  bc:'rgba(34,195,142,.3)',  col:'#22c38e' },
        { page:'shop',       icon:'🛍️', label:'Boutique',   bg:'rgba(244,196,48,.15)',  bc:'rgba(244,196,48,.3)',  col:'#f4c430' },
        { page:'map',        icon:'🗺️', label:'Carte',      bg:'rgba(79,140,255,.15)',  bc:'rgba(79,140,255,.3)',  col:'#4f8cff' },
        { page:'collection', icon:'🃏', label:'Collection', bg:'rgba(34,211,238,.15)',  bc:'rgba(34,211,238,.3)',  col:'#22d3ee' },
        { page:'vtt',        icon:'🎲', label:'Table VTT',  bg:'rgba(157,111,255,.15)', bc:'rgba(157,111,255,.3)', col:'#9d6fff' },
        { page:'bastion',    icon:'🏰', label:'Bastion',    bg:'rgba(255,149,68,.15)',  bc:'rgba(255,149,68,.3)',  col:'#ff9544' },
        { page:'characters', icon:'⚔️', label:'Personnage', bg:'rgba(232,184,75,.15)',  bc:'rgba(232,184,75,.3)',  col:'#e8b84b' },
      ];
      return `<div class="dv2-shortcuts-grid">${S.map(s => `
        <button class="dv2-shortcut" onclick="navigate('${s.page}')">
          <div class="dv2-shortcut-icon" style="background:${s.bg};border-color:${s.bc};color:${s.col}">${s.icon}</div>
          <span class="dv2-shortcut-label">${s.label}</span>
        </button>`).join('')}</div>`;
    }

    function _questsPanelV2() {
      const QDIFF = { facile:'Facile', moyen:'Moyen', difficile:'Difficile', extreme:'Extrême' };
      const QDCLS = { facile:'dv2-rarity-common', moyen:'dv2-rarity-rare', difficile:'dv2-rarity-epic', extreme:'dv2-rarity-legendary' };
      const QICLS = { principale:'dv2-qi-main', secondaire:'dv2-qi-side', quotidienne:'dv2-qi-daily' };
      const QICON = { principale:'🔥', secondaire:'🗡️', quotidienne:'🌅', extreme:'☠️', difficile:'⚠️' };
      return `
      <div class="dv2-panel-card">
        <div class="dv2-panel-header">
          <div class="dv2-panel-title">🗡️ Quêtes <span class="dv2-panel-count">${activeQuests.length}</span></div>
          <button class="dv2-section-action" onclick="navigate('quests')">Voir tout →</button>
        </div>
        ${activeQuests.slice(0, 5).length > 0 ? activeQuests.slice(0, 5).map(q => {
          const icn    = QICON[q.type] || QICON[q.difficulte] || '🗡️';
          const cls    = QICLS[q.type] || 'dv2-qi-default';
          const rarity = QDCLS[q.difficulte] || 'dv2-rarity-common';
          const joined = Array.isArray(q.participants) && q.participants.some(p => p.uid === _myUid);
          return `
          <div class="dv2-quest-item" onclick="navigate('quests')">
            <div class="dv2-quest-icon ${cls}">${icn}</div>
            <div style="flex:1;min-width:0">
              <div class="dv2-quest-name">${_esc(q.titre||'Quête')}</div>
              <div class="dv2-quest-sub">${QDIFF[q.difficulte]||'—'}${joined?' · ✓ Rejointe':''}</div>
            </div>
            <div class="dv2-quest-rarity ${rarity}">${(q.difficulte||'').toUpperCase()||'—'}</div>
          </div>`;
        }).join('') : `<div style="padding:18px;color:var(--text-dim);font-size:.8rem">Aucune quête active.</div>`}
      </div>`;
    }

    function _achievementsPanelV2() {
      return `
      <div class="dv2-panel-card">
        <div class="dv2-panel-header">
          <div class="dv2-panel-title">🏆 Hauts-faits <span class="dv2-panel-count">${achievements.length}</span></div>
          <button class="dv2-section-action" onclick="navigate('achievements')">Voir tout →</button>
        </div>
        ${achievements.slice(0, 5).length > 0 ? [...achievements].sort((a,b) => { const p = d => { const [j,m,y] = (d||'').split('/'); return y&&m&&j?`${y}${m.padStart(2,'0')}${j.padStart(2,'0')}`:''; }; return p(b.date) > p(a.date) ? 1 : -1; }).slice(0, 5).map(a => `
        <div class="dv2-ach-item">
          <div class="dv2-ach-icon">${a.icone||'🏆'}</div>
          <div style="flex:1;min-width:0">
            <div class="dv2-ach-name">${_esc(a.titre||a.nom||'Haut-fait')}</div>
            <div class="dv2-ach-desc">${_esc(a.description||'')}</div>
          </div>
          ${a.xp ? `<div class="dv2-ach-xp">+${a.xp}&nbsp;XP</div>` : ''}
        </div>`).join('') : `<div style="padding:18px;color:var(--text-dim);font-size:.8rem">Aucun haut-fait.</div>`}
      </div>`;
    }

    function _bastionCardV2() {
      const salles = (bastionDoc?.salles||[]).filter(s=>s.nom).slice(0, 4);
      const ev     = bastionDoc?.evenementCourant;
      return `
      <div class="dv2-bastion-card" onclick="navigate('bastion')" style="cursor:pointer">
        <div class="dv2-bastion-header">
          <div class="dv2-bastion-icon">🏰</div>
          <div>
            <div class="dv2-bastion-name">${_esc(bastionNom)}</div>
            <div class="dv2-bastion-level">Niveau ${bastionLevel}</div>
          </div>
          <button class="dv2-section-action" style="margin-left:auto" onclick="event.stopPropagation();navigate('bastion')">Gérer →</button>
        </div>
        ${salles.length > 0 ? `
        <div class="dv2-bastion-rooms">${salles.map(s=>`
          <div class="dv2-bastion-room"><div class="dv2-bastion-room-dot"></div>${_esc(s.nom)}</div>`).join('')}
        </div>` : ''}
        ${ev && ev !== 'calme' ? `<div class="dv2-bastion-note">⚠️ ${_esc(ev)}</div>` : ''}
      </div>`;
    }

    // ── Render ──────────────────────────────────────────────────────────
    const advBanner = STATE.adventure ? `
    <div class="dash-adv-banner" onclick="window.openAdventureSwitcher?.()" style="cursor:${(STATE.adventures?.length||0)>1?'pointer':'default'}">
      <span style="font-size:1.1rem">${STATE.adventure.emoji||'⚔️'}</span>
      <span class="dash-adv-name">${_esc(STATE.adventure.nom)}</span>
      ${(STATE.adventures?.length||0)>1?`<span style="font-size:.7rem;color:var(--text-dim);border:1px solid var(--border);border-radius:6px;padding:1px 6px">⇄ Changer</span>`:''}
      <span class="dash-adv-tag">Aventure active</span>
    </div>` : '';

    if (STATE.isAdmin) {

      // ── VUE MJ v2 ─────────────────────────────────────────────────────
      dash.className = 'dv2-root';
      dash.innerHTML = `
      ${advBanner}

      <!-- En-tête MJ -->
      <div class="dv2-header">
        <div>
          <div class="dv2-greeting-label">Console Maître du Jeu</div>
          <div class="dv2-greeting-title">Bonjour, ${_esc(pseudo)}</div>
        </div>
        <div class="dv2-session-badge"><div class="dv2-session-dot"></div>Session active</div>
      </div>

      <!-- Stats 4-col -->
      <div class="dv2-stats-grid">
        <div class="dv2-stat-card dv2-sc-shield" onclick="navigate('characters')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">📜</span>
          <div class="dv2-stat-card-val" style="color:var(--gold-2)">${chars.length}</div>
          <div class="dv2-stat-card-lbl">Personnage${chars.length!==1?'s':''}</div>
        </div>
        <div class="dv2-stat-card dv2-sc-mp" onclick="navigate('quests')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">🗡️</span>
          <div class="dv2-stat-card-val" style="color:#b99fff">${activeQuests.length}</div>
          <div class="dv2-stat-card-lbl">Quête${activeQuests.length!==1?'s':''} active${activeQuests.length!==1?'s':''}</div>
        </div>
        <div class="dv2-stat-card dv2-sc-hp" onclick="navigate('achievements')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">🏆</span>
          <div class="dv2-stat-card-val" style="color:#22c38e">${achievements.length}</div>
          <div class="dv2-stat-card-lbl">Haut${achievements.length!==1?'s':''}-fait${achievements.length!==1?'s':''}</div>
        </div>
        <div class="dv2-stat-card dv2-sc-gold" onclick="navigate('collection')" style="cursor:pointer">
          <span class="dv2-stat-card-icon">🃏</span>
          <div class="dv2-stat-card-val" style="color:#f4c430">${collectionUnlocked}</div>
          <div class="dv2-stat-card-lbl">Cartes débloquées</div>
        </div>
      </div>

      <!-- Personnages -->
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Personnages</span>
          <div class="dv2-section-label-line"></div>
          <button class="dv2-section-action" onclick="navigate('characters')">Voir tous →</button>
        </div>
        <div class="dv2-panel-card">${charsHtml
          ? `<div style="padding:12px">${charsHtml}</div>`
          : `<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">Aucun personnage dans cette aventure.</div>`}
        </div>
      </div>

      <!-- Mission active -->
      ${_missionCardV2()}

      <!-- Console MJ -->
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Console MJ</span>
          <div class="dv2-section-label-line"></div>
        </div>
        <div class="dv2-shortcuts-grid" style="grid-template-columns:repeat(7,1fr)">
          ${[
            { page:'story',     icon:'📚', label:'Trame',     bg:'rgba(34,211,238,.15)',  bc:'rgba(34,211,238,.3)',  col:'#22d3ee' },
            { page:'quests',    icon:'🗡️', label:'Quêtes',    bg:'rgba(157,111,255,.15)', bc:'rgba(157,111,255,.3)', col:'#9d6fff' },
            { page:'shop',      icon:'🛍️', label:'Boutique',  bg:'rgba(244,196,48,.15)',  bc:'rgba(244,196,48,.3)',  col:'#f4c430' },
            { page:'npcs',      icon:'👥', label:'PNJ',       bg:'rgba(34,195,142,.15)',  bc:'rgba(34,195,142,.3)',  col:'#22c38e' },
            { page:'bestiaire', icon:'🐉', label:'Bestiaire', bg:'rgba(255,90,126,.15)',  bc:'rgba(255,90,126,.3)',  col:'#ff5a7e' },
            { page:'map',       icon:'🗺️', label:'Carte',     bg:'rgba(79,140,255,.15)',  bc:'rgba(79,140,255,.3)',  col:'#4f8cff' },
            { page:'admin',     icon:'⚙️', label:'Admin',     bg:'rgba(255,149,68,.15)',  bc:'rgba(255,149,68,.3)',  col:'#ff9544' },
          ].map(s => `
          <button class="dv2-shortcut" onclick="navigate('${s.page}')">
            <div class="dv2-shortcut-icon" style="background:${s.bg};border-color:${s.bc};color:${s.col}">${s.icon}</div>
            <span class="dv2-shortcut-label">${s.label}</span>
          </button>`).join('')}
        </div>
      </div>

      <!-- Quêtes actives -->
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Quêtes actives</span>
          <div class="dv2-section-label-line"></div>
          <button class="dv2-section-action" onclick="navigate('quests')">Gérer →</button>
        </div>
        ${activeQuests.length
          ? `<div class="quest-grid">${activeQuests.slice(0,4).map(_dashQuestCard).join('')}</div>${activeQuests.length > 4 ? `<button class="dv2-section-action" onclick="navigate('quests')" style="align-self:flex-end;margin-top:6px">+${activeQuests.length-4} de plus →</button>` : ''}`
          : `<div class="dv2-panel-card"><div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center"><span style="opacity:.3">🗡️</span> Aucune quête active.</div></div>`}
      </div>

      <!-- Trame progression -->
      ${totalMissions > 0 ? `
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Progression aventure</span>
          <div class="dv2-section-label-line"></div>
          <button class="dv2-section-action" onclick="navigate('story')">Ouvrir →</button>
        </div>
        ${_progBar()}
      </div>` : ''}

      <!-- Table Virtuelle -->
      <div class="dash-vtt-cta" onclick="navigate('vtt')">
        <span class="dash-vtt-icon">🎲</span>
        <div class="dash-vtt-text"><span class="dash-vtt-label">Table Virtuelle</span><span class="dash-vtt-sub">Entrer dans la session de jeu</span></div>
        <span class="dash-vtt-arrow">→</span>
      </div>`;

    } else {

      // ── VUE JOUEUR v2 ─────────────────────────────────────────────────

      // Groupe : participants des quêtes actives que j'ai rejointes
      const _joinedQuests = activeQuests.filter(q =>
        Array.isArray(q.participants) && q.participants.some(p => p.uid === _myUid)
      );
      const _missionUids = new Set(
        _joinedQuests.flatMap(q => (q.participants || []).map(p => p.uid)).filter(u => u !== _myUid)
      );
      const partyMembers = _joinedQuests.length > 0
        ? [...chars, ...allPartyChars.filter(c => _missionUids.has(c.uid))]
        : [];

      // Bloc héros : une carte par personnage du joueur + carte groupe à côté du premier
      let heroBlock = '';
      if (chars.length === 0) {
        heroBlock = `
        <div class="dv2-hero-card" onclick="navigate('characters')" style="cursor:pointer">
          <div class="dv2-hero-inner" style="padding:2rem;justify-content:center;text-align:center">
            <div>
              <div style="font-size:2rem;margin-bottom:.75rem">⚔️</div>
              <div class="dv2-hero-name" style="font-size:1.1rem;margin-bottom:.4rem">Créer mon personnage</div>
              <div style="font-size:.8rem;color:var(--text-dim)">Bienvenue ${_esc(pseudo)} ! Commence par créer ta fiche de héros.</div>
            </div>
          </div>
        </div>`;
      } else if (chars.length === 1) {
        heroBlock = `
        <div class="dv2-hero-grid">
          ${_heroCardV2(chars[0])}
          ${_partyCardV2(partyMembers)}
        </div>`;
      } else {
        // Plusieurs personnages : grille adaptative + carte groupe en dessous
        // auto-fit (vs auto-fill) étire les colonnes pour utiliser toute la largeur
        heroBlock = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.65rem">
          ${chars.map(c => _heroCardV2(c)).join('')}
        </div>
        ${_partyCardV2(partyMembers)}`;
      }

      dash.className = 'dv2-root';
      dash.innerHTML = `
      ${advBanner}

      <div class="dv2-header">
        <div>
          <div class="dv2-greeting-label">Bonjour, aventurier</div>
          <div class="dv2-greeting-title">Bienvenue, ${_esc(pseudo)}</div>
        </div>
        <div class="dv2-session-badge"><div class="dv2-session-dot"></div>Session active</div>
      </div>

      ${heroBlock}

      ${_missionCardV2()}

      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Navigation rapide</span>
          <div class="dv2-section-label-line"></div>
        </div>
        ${_shortcutsV2()}
      </div>

      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Aventure</span>
          <div class="dv2-section-label-line"></div>
        </div>
        <div class="dv2-two-col">
          ${_questsPanelV2()}
          ${_achievementsPanelV2()}
        </div>
      </div>

      ${bastionDoc ? `
      <div>
        <div class="dv2-section-label">
          <span class="dv2-section-label-text">Bastion</span>
          <div class="dv2-section-label-line"></div>
        </div>
        ${_bastionCardV2()}
      </div>` : ''}

      <div class="dash-vtt-cta" onclick="navigate('vtt')">
        <span class="dash-vtt-icon">🎲</span>
        <div class="dash-vtt-text"><span class="dash-vtt-label">Table Virtuelle</span><span class="dash-vtt-sub">Entrer dans la session de jeu</span></div>
        <span class="dash-vtt-arrow">→</span>
      </div>`;
    }

    // ── Navigation personnage ──────────────────────────────────────────
    window._goToChar = (id) => {
      window._targetCharId = id;
      navigate('characters');
    };

    // ── Toast RPG (injecter une seule fois) ───────────────────────────
    if (!document.getElementById('dv2-toast-container')) {
      const tc = document.createElement('div');
      tc.id = 'dv2-toast-container';
      tc.className = 'dv2-toast-container';
      document.body.appendChild(tc);
    }
    window._showRPGToast = (type = 'xp', title = '', sub = '', badge = '') => {
      const tc = document.getElementById('dv2-toast-container');
      if (!tc) return;
      const el = document.createElement('div');
      el.className = `dv2-toast dv2-toast-${type}`;
      const icons = { xp:'✨', gold:'💰', achievement:'🏆' };
      const cols  = { xp:'#c084fc', gold:'#f4c430', achievement:'#22c38e' };
      el.innerHTML = `<div class="dv2-toast-icon">${icons[type]||'✨'}</div><div class="dv2-toast-body"><div class="dv2-toast-title">${title}</div>${sub?`<div class="dv2-toast-sub">${sub}</div>`:''}</div>${badge?`<div class="dv2-toast-badge" style="color:${cols[type]||'#fff'}">${badge}</div>`:''}`;
      tc.appendChild(el);
      setTimeout(() => { el.classList.add('dv2-leaving'); setTimeout(() => el.remove(), 350); }, 3500);
    };

    // ── Animations d'entrée en cascade ────────────────────────────────
    const _sections = document.querySelectorAll('.dv2-root > *');
    _sections.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      setTimeout(() => {
        el.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.22,1,0.36,1)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, i * 60);
    });

    // ── Animations barres (après le délai d'entrée) ────────────────────
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.dv2-bar-fill[data-w], .dv2-mission-prog-fill[data-w]').forEach(el => {
          el.style.width = el.dataset.w;
        });
      }, 200);
    });

    // ── Particules flottantes ──────────────────────────────────────────
    document.querySelectorAll('.dv2-particle').forEach(p => p.remove());
    const _pcols = ['rgba(79,140,255,0.6)', 'rgba(157,111,255,0.5)', 'rgba(34,195,142,0.4)'];
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'dv2-particle';
      const sz = 1 + Math.random() * 2;
      p.style.cssText = `left:${Math.random()*100}%;background:${_pcols[i%3]};width:${sz}px;height:${sz}px;animation-duration:${8+Math.random()*12}s;animation-delay:${Math.random()*10}s;--drift:${(Math.random()-.5)*80}px`;
      document.body.appendChild(p);
    }
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
    if (chars.length === 0) {
      html += `<div class="empty-state"><div class="icon">📜</div><p>Aucun personnage. Crée ton premier héros !</p></div>
        <div style="margin-bottom:1.5rem"><button class="char-pill-new" onclick="createNewChar()">+ Nouveau personnage</button></div>`;
    } else {
      html += `<div class="char-select-bar" id="char-pills">
        ${chars.map((c, i) => `<div class="char-pill ${i === 0 ? 'active' : ''}" onclick="selectChar('${c.id}',this)">
          ${c.nom || '?'}<span class="char-pill-niv">Niv.${c.niveau || 1}</span>
        </div>`).join('')}
        <button class="char-pill-new" onclick="createNewChar()">+ Nouveau personnage</button>
      </div><div id="char-sheet-area"></div>`;
    }
    content.innerHTML = html;
    if (chars.length > 0) {
      // Si on vient du dashboard avec un personnage ciblé, le sélectionner directement
      const targetId  = window._targetCharId;
      window._targetCharId = null;
      const charToShow = (targetId ? chars.find(c => c.id === targetId) : null) || chars[0];
      STATE.activeChar = charToShow;
      // Mettre à jour la pill active
      document.querySelectorAll('#char-pills .char-pill').forEach(p => {
        p.classList.toggle('active', p.getAttribute('onclick')?.includes(charToShow.id));
      });
      renderCharSheet(charToShow);
    }
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
        background:var(--bg-panel);border-bottom:1px solid var(--border-strong);
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

    const EVENTS        = window.BASTION_EVENTS || [];
    const calcRevenu    = window.calculerRevenuBastion;

    // Toutes les améliorations sont créées par le MJ (ameliorationsCustom)
    function _getAllAmeliorations(d) {
      return (d.ameliorationsCustom||[]).map(a => ({
        ...a, type:'custom',
        debloquee: (a.fondsActuels||0) >= (a.cout||1) && (a.cout||1) > 0,
      }));
    }

    const { brut, fondateurs: partFondateurs, base, nbAmelios, evt } =
      calcRevenu ? calcRevenu(data)
        : { brut:100, fondateurs:10, base:100, nbAmelios:0, evt:{ id:'calme', nom:'Calme', emoji:'☁️', description:'', badgeClass:'badge-blue', badgeText:'±0', couleur:'neutral', modificateur:1, bonus:0 } };

    const niveau           = 1 + (data.ameliorationsCustom||[]).filter(a => (a.fondsActuels||0) >= (a.cout||1) && (a.cout||1) > 0).length;
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
        <div class="card-header">💰 Cycle de revenus
          <span style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:auto">+100 or de base · +100 or / amélioration</span>
        </div>

        <!-- 2 stats principales -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.85rem">
          <div class="stat-box" style="text-align:center;border-color:rgba(232,184,75,.2)">
            <div class="stat-label">Revenu du cycle</div>
            <div class="stat-value" style="color:var(--gold);font-size:2rem;line-height:1.1">${brut}</div>
            <div style="font-size:.68rem;color:var(--text-dim);margin-top:2px">or généré</div>
          </div>
          <div class="stat-box" style="text-align:center;border-color:rgba(232,184,75,.12)">
            <div class="stat-label">👑 Fondateurs (10%)</div>
            <div class="stat-value" style="color:var(--gold);font-size:2rem;line-height:1.1">${partFondateurs}</div>
            <div style="font-size:.68rem;color:var(--text-dim);margin-top:2px">
              ${partParFondateur > 0 && fondateursList.length > 1
                ? `${partParFondateur} or / personne`
                : fondateursList.length === 1 ? 'or pour le fondateur' : 'aucun fondateur'}</div>
          </div>
        </div>

        <!-- Formule de calcul -->
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.65rem 1rem;display:flex;flex-wrap:wrap;gap:.4rem .8rem;font-size:.78rem;color:var(--text-muted);align-items:center">
          <span>Base <strong style="color:var(--text)">100</strong></span>
          <span style="color:var(--border-strong)">+</span>
          <span>${nbAmelios} amélio${nbAmelios !== 1 ? 's' : ''} <strong style="color:var(--text)">×100</strong></span>
          <span style="color:var(--border-strong)">=</span>
          <span>Sous-total <strong style="color:var(--gold)">${base} or</strong></span>
          ${evt?.id === 'vol'  ? `<span style="color:var(--border-strong)">×</span><span style="color:#ff6b6b">Malus −20%</span>` : ''}
          ${(evt?.bonus||0) > 0 ? `<span style="color:var(--border-strong)">+</span><span style="color:var(--green)">Bonus +${evt.bonus}</span>` : ''}
          ${evt?.id !== 'calme' ? `<span style="color:var(--border-strong)">=</span><span style="color:var(--gold);font-weight:600">${brut} or</span>` : ''}
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
          <span style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:auto">+1 niveau · +100 or/cycle</span>
          ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-left:.5rem;font-size:.7rem" onclick="gererAmeliorations()">⚙️ Gérer</button>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem">
          ${_getAllAmeliorations(data).map(a => {
            const pct      = a.cout > 0 ? Math.min(100, Math.round((a.fondsActuels||0) / a.cout * 100)) : 100;
            const pctColor = pct >= 100 ? '#22c38e' : pct > 50 ? 'var(--gold)' : '#4f8cff';
            return `<div style="background:${a.debloquee?'rgba(34,195,142,0.05)':'var(--bg-elevated)'};border:1px solid ${a.debloquee?'rgba(34,195,142,0.22)':'var(--border)'};border-radius:12px;padding:.85rem;display:flex;flex-direction:column;gap:.4rem">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.4rem">
                <div style="display:flex;align-items:center;gap:.4rem">
                  <span style="font-size:1rem">${a.emoji||'🔧'}</span>
                  <span style="font-family:'Cinzel',serif;font-size:.8rem;color:${a.debloquee?'#22c38e':'var(--text)'};line-height:1.25">${a.nom}</span>

                </div>
                ${a.debloquee
                  ? `<span style="font-size:.68rem;background:rgba(34,195,142,0.12);color:#22c38e;border:1px solid rgba(34,195,142,.22);border-radius:6px;padding:1px 6px;flex-shrink:0">✓ Active</span>`
                  : `<span style="font-family:'Cinzel',serif;font-size:.75rem;color:var(--gold);flex-shrink:0">${a.cout} or</span>`}
              </div>
              <p style="font-size:.73rem;color:var(--text-muted);line-height:1.45;margin:0">${a.description||''}</p>
              ${!a.debloquee && a.cout > 0 ? `
              <div style="margin-top:.1rem">
                <div style="display:flex;justify-content:space-between;font-size:.67rem;color:var(--text-dim);margin-bottom:.2rem">
                  <span>Financement</span>
                  <span style="color:${pctColor};font-weight:600">${a.fondsActuels||0}/${a.cout} or (${pct}%)</span>
                </div>
                <div style="background:var(--bg-card);border-radius:999px;height:6px;overflow:hidden;border:1px solid var(--border)">
                  <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:999px;transition:width .4s"></div>
                </div>
              </div>
              <button class="btn btn-outline btn-sm" style="font-size:.72rem;margin-top:.1rem"
                onclick="investirAmelioration('${a.id}','custom')">
                💰 Contribuer
              </button>` : a.debloquee ? `<div style="height:2px;background:rgba(34,195,142,.25);border-radius:1px;margin-top:auto"></div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- HISTORIQUE -->
      ${historique.length > 0 ? `
      <div class="card">
        <div class="card-header">📈 Historique des cycles
          <span style="font-size:.7rem;color:var(--text-dim);font-weight:400;margin-left:auto">${historique.length} entrée${historique.length>1?'s':''}</span>
        </div>
        <div style="margin-bottom:.75rem">${sparkline(historique)}</div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${[...historique].reverse().slice(0,10).map(h => {
            const isInvest = h.type === 'investissement';
            const evtInfo  = isInvest ? null : EVENTS.find(e => e.id === h.evtId);
            const evtColor = evtInfo?.couleur==='crimson'?'#ff6b6b':evtInfo?.couleur==='gold'?'var(--gold)':evtInfo?.couleur==='green'?'var(--green)':'var(--text-muted)';
            return `<div style="display:flex;align-items:center;gap:.65rem;padding:.5rem .65rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:9px">
              <span style="font-size:1rem;flex-shrink:0">${isInvest?'💰':evtInfo?.emoji||'🎲'}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:.81rem;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${isInvest
                    ? `${h.investisseur?.nom||'?'}${h.message?' <span style="color:var(--text-dim);font-weight:400;font-style:italic">— ${h.message}</span>':''}`
                    : `Cycle ${h.session} <span style="color:${evtColor};font-weight:400;font-size:.75rem">· ${h.evenement||'—'}</span>`}
                </div>
                <div style="font-size:.7rem;color:var(--text-dim);display:flex;gap:.5rem;align-items:center;margin-top:1px">
                  ${isInvest
                    ? `<span style="color:var(--gold);font-weight:600">+${h.montant} or</span> <span>versés au trésor</span>`
                    : `<span style="color:var(--gold);font-weight:600">${h.brut} or</span>
                       <span>→ fondateurs</span>
                       <span style="color:var(--gold)">${h.partFondateurs} or</span>
                       ${h.distributions?.length>0?`<span style="color:var(--text-dim)">(${h.distributions.map(d=>d.nom).join(', ')})</span>`:''}`}
                  <span style="margin-left:auto;color:var(--text-dim)">${h.date||''}</span>
                </div>
              </div>
              ${STATE.isAdmin&&h.id ? `<button class="btn-icon" style="color:#ff6b6b;flex-shrink:0;font-size:.85rem" onclick="supprimerHistorique('${h.id}')" title="Supprimer ce cycle">🗑️</button>` : ''}
            </div>`;
          }).join('')}
          ${historique.length > 10 ? `<p style="font-size:.72rem;color:var(--text-dim);text-align:center;margin:.2rem 0">${historique.length-10} cycle(s) plus anciens</p>` : ''}
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
    // Structure uniquement — le rendu justified est délégué à achievements.js
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

    content.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(79,140,255,0.06) 0%,rgba(232,184,75,0.04) 50%,rgba(34,195,142,0.05) 100%);
      border:1px solid var(--border);border-radius:var(--radius-lg);
      padding:1.8rem 2rem 1.4rem;margin-bottom:1.5rem;position:relative;overflow:hidden">
      <div style="position:absolute;top:-40px;right:-40px;width:200px;height:200px;
        background:radial-gradient(circle,rgba(232,184,75,0.07) 0%,transparent 70%);pointer-events:none"></div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div>
          <div style="font-size:.72rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:.4rem">Livre des Légendes</div>
          <h1 style="font-family:'Cinzel',serif;font-size:1.9rem;color:var(--gold);letter-spacing:2px;line-height:1;margin:0">Hauts-Faits</h1>
          <p style="font-size:.83rem;color:var(--text-muted);margin-top:.5rem;margin-bottom:0">Les exploits de la compagnie, consignés pour l'éternité.</p>
        </div>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap">
          ${CATS.map(c => `<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:.6rem 1rem;text-align:center;min-width:70px">
            <div style="font-size:1.1rem">${c.emoji}</div>
            <div style="font-family:'Cinzel',serif;font-size:1rem;color:${c.color};line-height:1.2">${byCat[c.id]?.length || 0}</div>
            <div style="font-size:.65rem;color:var(--text-dim);margin-top:1px">${c.label}</div>
          </div>`).join('')}
          <div style="background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:12px;padding:.6rem 1rem;text-align:center;min-width:70px">
            <div style="font-size:1.1rem">🏆</div>
            <div style="font-family:'Cinzel',serif;font-size:1rem;color:var(--gold);line-height:1.2">${total}</div>
            <div style="font-size:.65rem;color:var(--text-dim);margin-top:1px">Total</div>
          </div>
        </div>
      </div>
    </div>

    ${STATE.isAdmin ? `<div class="admin-section" style="margin-bottom:1.2rem">
      <div class="admin-label">Admin — Hauts-Faits</div>
      <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="openAchievementModal()">+ Ajouter un Haut-Fait</button>
      </div>
    </div>` : ''}

    <div style="display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap">
      ${CATS.map(c => { const active = c.id === activeCat; const n = byCat[c.id]?.length || 0;
        return `<button onclick="window._achCat='${c.id}';navigate('achievements')" style="
          display:flex;align-items:center;gap:.5rem;padding:.5rem 1.1rem;border-radius:999px;cursor:pointer;
          transition:all .15s;font-family:'Cinzel',serif;font-size:.82rem;
          border:1px solid ${active ? c.color : 'var(--border)'};
          background:${active ? c.glow : 'transparent'};color:${active ? c.color : 'var(--text-muted)'}
        ">${c.emoji} ${c.label}
          <span style="border-radius:999px;padding:1px 7px;font-size:.7rem;font-family:sans-serif;
            background:${active ? c.color : 'var(--bg-elevated)'};
            color:${active ? '#0b1118' : 'var(--text-dim)'};">${n}</span>
        </button>`;
      }).join('')}
    </div>

    ${catItems.length === 0
      ? `<div style="text-align:center;padding:4rem 2rem;color:var(--text-dim)">
           <div style="font-size:3rem;margin-bottom:1rem;opacity:.4">${cat.emoji}</div>
           <p style="font-style:italic;font-size:.85rem">Aucun haut-fait ${cat.label.toLowerCase()} pour l'instant.</p>
           ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="openAchievementModal()">+ Ajouter le premier</button>` : ''}
         </div>`
      : `<div style="font-size:.8rem;color:var(--text-dim);font-style:italic;margin-bottom:1.2rem;padding-left:.25rem">
           ${cat.emoji} ${cat.desc} — ${catItems.length} haut-fait${catItems.length > 1 ? 's' : ''}
         </div>
         <div id="ach-grid-${cat.id}" class="ach-justified">
           <div class="loading"><div class="spinner"></div></div>
         </div>`
    }`;
    // Le justified layout est rempli après par achievements.js
  },

  // ─── COLLECTION ─────────────────────────────────────────────────────────────
  async collection() {
    await renderCollectionPage();
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
      </div>
      <div class="card" style="margin-top:1.2rem">
        <div class="card-header">⚙️ Réglages du jeu</div>
        <div style="display:flex;flex-direction:column;gap:0.7rem">
          <button class="btn btn-outline" onclick="window.openWeaponFormatsAdmin ? window.openWeaponFormatsAdmin() : import('./assets/js/features/characters.js').then(() => window.openWeaponFormatsAdmin?.())">⚔️ Formats d'arme</button>
          <button class="btn btn-outline" onclick="window.openDamageTypesAdmin ? window.openDamageTypesAdmin() : import('./assets/js/features/characters.js').then(() => window.openDamageTypesAdmin?.())">⚡ Types de dégâts</button>
          <button class="btn btn-outline" onclick="window.openCombatStylesAdmin ? window.openCombatStylesAdmin() : import('./assets/js/features/characters.js').then(() => window.openCombatStylesAdmin?.())">🗡️ Styles de combat</button>
          <button class="btn btn-outline" onclick="window._ouvrirGestionDes ? window._ouvrirGestionDes() : import('./assets/js/features/histoire.js').then(() => window._ouvrirGestionDes?.())">🎲 Compétences de dés</button>
          <button class="btn btn-outline" onclick="window._ouvrirGestionEmotes ? window._ouvrirGestionEmotes() : import('./assets/js/features/vtt.js').then(() => window._ouvrirGestionEmotes?.())">😄 Émotes VTT</button>
        </div>
      </div>`;
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
