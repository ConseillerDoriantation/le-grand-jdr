import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

// CHARACTER SHEET
// ══════════════════════════════════════════════
function selectChar(id, el) {
  document.querySelectorAll('#char-pills .char-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const c = STATE.characters.find(x=>x.id===id);
  if (c) { STATE.activeChar=c; renderCharSheet(c, window._currentCharTab||'carac'); }
}

function filterAdminChars(pseudo, el) {
  document.querySelectorAll('#admin-player-filter .char-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const pills = document.querySelector('#char-pills');
  if (!pills) return;
  const chars = pseudo ? STATE.characters.filter(c=>c.ownerPseudo===pseudo) : STATE.characters;
  pills.innerHTML = chars.map((c,i)=>`<div class="char-pill ${i===0?'active':''}" onclick="selectChar('${c.id}',this)">${c.nom||'Sans nom'}</div>`).join('');
  if (chars.length > 0) { STATE.activeChar=chars[0]; renderCharSheet(chars[0]); }
}

// ══════════════════════════════════════════════
// COMPUTED STATS
// ══════════════════════════════════════════════
function getMod(c, key) {
  const base = (c.stats||{})[key]||8;
  const bonus = (c.statsBonus||{})[key]||0;
  return Math.floor(((base+bonus)-10)/2);
}

function calcCA(c) {
  // Base 8, torse: legere=10, inter=12, lourde=14, +mod Dex
  const equip = c.equipement||{};
  const torse = equip['Torse']?.typeArmure||'';
  let caBase = 8;
  if (torse==='Légère') caBase=10;
  else if (torse==='Intermédiaire') caBase=12;
  else if (torse==='Lourde') caBase=14;
  const modDex = getMod(c,'dexterite');
  // Also add any equipment CA bonuses
  const caEquip = Object.values(equip).reduce((s,it)=>s+(it.ca||0),0);
  return caBase + modDex + caEquip;
}

function calcVitesse(c) {
  // 3 + mod Force
  return 3 + getMod(c,'force');
}

function calcDeck(c) {
  // Active sorts count / (3 + mod In bonus)
  const sorts = c.deck_sorts||[];
  const actifs = sorts.filter(s=>s.actif).length;
  const modIn = getMod(c,'intelligence');
  const niveau = c.niveau||1;
  // Formula: 3 + floor(max(0,modIn) * (niveau-1)^0.75) + min(0,modIn)
  const maxDeck = 3 + Math.min(0,modIn) + Math.floor(Math.max(0,modIn) * Math.pow(Math.max(0,niveau-1),0.75));
  return actifs+'/'+maxDeck;
}

function calcPVMax(c) {
  const pvBase = c.pvBase||10;
  const modCo = getMod(c,'constitution');
  const niveau = c.niveau||1;
  if (modCo > 0) return pvBase + Math.floor(modCo*(niveau-1));
  return pvBase + modCo*(niveau-1);
}

function calcPMMax(c) {
  const pmBase = c.pmBase||10;
  const modSa = getMod(c,'sagesse');
  const niveau = c.niveau||1;
  if (modSa > 0) return pmBase + Math.floor(modSa*(niveau-1));
  return pmBase + modSa*(niveau-1);
}

function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  const canEdit = STATE.isAdmin || c.uid === STATE.user.uid;

  const mod = v => { const m=Math.floor((v-10)/2); return m>=0?'+'+m:String(m); };
  const pct = (cur,max) => Math.max(0,Math.min(100,Math.round(cur/max*100)));
  const hpPct = pct(c.pvActuel??c.pvBase??10, c.pvBase??10);
  const pmPct = pct(c.pmActuel??c.pmBase??10, c.pmBase??10);
  const xpPct = pct(c.exp??0, c.palier??100);

  const titres = c.titres||[];
  const titreDisplay = titres.length>0
    ? titres.map(t=>`<span class="badge badge-gold" style="margin-left:0.3rem">${t}</span>`).join('')
    : c.titre ? `<span class="badge badge-gold" style="margin-left:0.3rem">${c.titre}</span>` : '';

  const currentTab = keepTab || window._currentCharTab || 'carac';

  // Photo area
  const photoHtml = `
    <div class="char-photo-wrap" id="char-photo-wrap">
      <div class="char-photo" id="char-photo" onclick="${canEdit?`openPhotoCropper('${c.id}')`:''}"
           style="cursor:${canEdit?'pointer':'default'}">
        ${c.photo
          ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;
               transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);
               transform-origin:center center;">`
          : `<div class="char-photo-placeholder">
               ${canEdit?'<span style="font-size:1.5rem">📷</span><span style="font-size:0.7rem;margin-top:0.3rem">Photo</span>':'<span style="font-size:2rem;opacity:0.3">⚔️</span>'}
             </div>`
        }
      </div>
      ${canEdit&&c.photo?`<button class="char-photo-delete" onclick="deleteCharPhoto('${c.id}')" title="Supprimer la photo">✕</button>`:''}
    </div>`;

  area.innerHTML = `
  <div class="card" style="margin-bottom:1rem">
    <div class="card-header">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.4rem">
        <span style="font-weight:700">⚔️ ${c.nom||'Nouveau personnage'}</span>
        ${titreDisplay}
      </div>
      <div style="display:flex;gap:0.5rem">
        ${canEdit?`<button class="btn btn-gold btn-sm" onclick="editCharInfo()">✏️ Modifier</button>`:''}
        ${canEdit?`<button class="btn btn-danger btn-sm" onclick="deleteChar('${c.id}')">🗑️</button>`:''}
      </div>
    </div>

    <!-- Photo + Vitals -->
    <div class="char-header-layout">
      ${photoHtml}
      <div class="char-vitals-col">
        <div class="char-vitals" id="char-vitals">
          <div class="vital-box">
            <div class="stat-label">Niveau</div>
            <div class="stat-value">${c.niveau||1}</div>
            <div class="xp-bar-bg"><div class="xp-bar-fill" style="width:${xpPct}%"></div></div>
            <div class="stat-sub">${c.exp||0} / ${c.palier||100} XP</div>
          </div>
          <div class="vital-box">
            <div class="stat-label">❤️ PV</div>
            <div class="vital-controls">
              ${canEdit?`<button class="vital-btn minus" onclick="adjustStat('pvActuel',-1,'${c.id}')">−</button>`:''}
              <span class="vital-val" style="color:${hpPct<25?'var(--crimson-light)':hpPct<50?'#e67e22':'#2ecc71'}" id="pv-val">${c.pvActuel??c.pvBase??10}</span>
              ${canEdit?`<button class="vital-btn plus" onclick="adjustStat('pvActuel',1,'${c.id}')">+</button>`:''}
            </div>
            <div class="hp-bar-bg"><div class="hp-bar-fill ${hpPct>50?'high':hpPct>25?'mid':''}" style="width:${hpPct}%" id="pv-bar"></div></div>
            <div class="stat-sub">max ${c.pvBase||10}</div>
          </div>
          <div class="vital-box">
            <div class="stat-label">🔵 PM</div>
            <div class="vital-controls">
              ${canEdit?`<button class="vital-btn minus" onclick="adjustStat('pmActuel',-1,'${c.id}')">−</button>`:''}
              <span class="vital-val" style="color:var(--blue)" id="pm-val">${c.pmActuel??c.pmBase??10}</span>
              ${canEdit?`<button class="vital-btn plus" onclick="adjustStat('pmActuel',1,'${c.id}')">+</button>`:''}
            </div>
            <div class="pm-bar-bg"><div class="pm-bar-fill" style="width:${pmPct}%" id="pm-bar"></div></div>
            <div class="stat-sub">max ${c.pmBase||10}</div>
          </div>
          <div class="vital-box vital-box-secondary">
            <div class="vital-secondary-row">
              <div class="vital-secondary-item">
                <div class="stat-label">🛡️ CA</div>
                <div class="vital-secondary-val">${calcCA(c)}</div>
              </div>
              <div class="vital-secondary-item">
                <div class="stat-label">🏃 Vit.</div>
                <div class="vital-secondary-val">${calcVitesse(c)}m</div>
              </div>
              <div class="vital-secondary-item">
                <div class="stat-label">🃏 Deck</div>
                <div class="vital-secondary-val">${calcDeck(c)}</div>
              </div>
            </div>
            <div class="stat-sub" style="margin-top:0.3rem">💰 Or : ${c.or||0}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs" id="char-tabs">
      <button class="tab ${currentTab==='carac'?'active':''}" onclick="showCharTab('carac',this)">Caractéristiques</button>
      <button class="tab ${currentTab==='equip'?'active':''}" onclick="showCharTab('equip',this)">Équipement & Combat</button>
      <button class="tab ${currentTab==='deck'?'active':''}" onclick="showCharTab('deck',this)">Sorts & Runes</button>
      <button class="tab ${currentTab==='inventaire'?'active':''}" onclick="showCharTab('inventaire',this)">Inventaire</button>
      <button class="tab ${currentTab==='quetes'?'active':''}" onclick="showCharTab('quetes',this)">Quêtes</button>
      <button class="tab ${currentTab==='notes'?'active':''}" onclick="showCharTab('notes',this)">Notes</button>
    </div>
    <div id="char-tab-content"></div>
  </div>`;

  window._currentChar = c;
  window._canEditChar = canEdit;
  window._currentCharTab = currentTab;

  const renders = {
    carac: ()=>renderCharCarac(c,canEdit),
    equip: ()=>renderCharEquip(c,canEdit),
    deck: ()=>renderCharDeck(c,canEdit),
    inventaire: ()=>renderCharInventaire(c,canEdit),
    quetes: ()=>renderCharQuetes(c,canEdit),
    notes: ()=>renderCharNotes(c,canEdit),
  };
  document.getElementById('char-tab-content').innerHTML = renders[currentTab]?.() || '';
}

function showCharTab(tab, el) {
  document.querySelectorAll('#char-tabs .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  window._currentCharTab = tab;
  const c = window._currentChar;
  const canEdit = window._canEditChar;
  const area = document.getElementById('char-tab-content');
  const renders = {
    carac: ()=>renderCharCarac(c,canEdit),
    equip: ()=>renderCharEquip(c,canEdit),
    deck: ()=>renderCharDeck(c,canEdit),
    inventaire: ()=>renderCharInventaire(c,canEdit),
    quetes: ()=>renderCharQuetes(c,canEdit),
    notes: ()=>renderCharNotes(c,canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
}

function renderCharCarac(c, canEdit) {
  const stats = [
    {key:'force',label:'Force',abbr:'Fo'},
    {key:'dexterite',label:'Dextérité',abbr:'Dex'},
    {key:'intelligence',label:'Intelligence',abbr:'In'},
    {key:'sagesse',label:'Sagesse',abbr:'Sa'},
    {key:'constitution',label:'Constitution',abbr:'Co'},
    {key:'charisme',label:'Charisme',abbr:'Ch'},
  ];
  const mod = v=>{ const m=Math.floor((v-10)/2); return m>=0?'+'+m:String(m); };
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};

  let html = `<div class="char-section">
    <div class="char-section-title">📊 Caractéristiques</div>
    <div class="char-grid">`;
  stats.forEach(st => {
    const base = s[st.key]||8;
    const bonus = (c.statsBonus||{})[st.key]||0;
    const total = base+bonus;
    html += `<div class="carac-box">
      <div class="carac-name">${st.abbr}</div>
      <div class="carac-val">${total}</div>
      <div class="carac-mod">${mod(total)}</div>
      ${bonus?`<div class="carac-bonus">Base:${base} +${bonus}</div>`:`<div class="carac-bonus">Base:${base}</div>`}
    </div>`;
  });
  html += `</div>`;
  if (canEdit) html += `<button class="btn btn-outline btn-sm" style="margin-top:0.8rem" onclick="editCharStats()">✏️ Modifier les stats</button>`;
  html += `</div>`;

  // Set bonus
  if (c.setBonusActif) {
    html += `<div class="char-section">
      <div class="char-section-title">✨ Bonus de Set</div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-style:italic">${c.setBonusActif}</div>
    </div>`;
  }
  return html;
}

function renderCharCombat(c, canEdit) {
  const stats = c.stats||{force:10,dexterite:8};
  const bonus = c.statsBonus||{};
  const fo = (stats.force||10)+(bonus.force||0);
  const modFo = Math.floor((fo-10)/2);
  const modStr = modFo>=0?'+'+modFo:String(modFo);

  return `<div class="char-section">
    <div class="char-section-title">🎯 Armes</div>
    <div style="margin-bottom:1rem">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;gap:0.5rem;padding:0.5rem;background:var(--bg-panel);border-radius:4px;font-family:'Cinzel',serif;font-size:0.7rem;color:var(--text-muted)">
        <span>Arme</span><span>Toucher</span><span>Dégâts</span><span>Type</span>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;gap:0.5rem;padding:0.5rem;border-bottom:1px solid var(--border)">
        <span style="font-size:0.85rem">${c.arme1nom||'Main principale'}</span>
        <span style="color:var(--gold);font-size:0.85rem">1d20${modStr}</span>
        <span style="color:var(--crimson-light);font-size:0.85rem">${c.arme1degats||'1D10'}${modStr}</span>
        <span style="font-size:0.78rem;color:var(--text-muted)">${c.arme1type||'Arme 1M CaC'}</span>
      </div>
      ${c.arme2nom?`<div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;gap:0.5rem;padding:0.5rem;border-bottom:1px solid var(--border)">
        <span style="font-size:0.85rem">${c.arme2nom}</span>
        <span style="color:var(--gold);font-size:0.85rem">${c.arme2toucher||'—'}</span>
        <span style="color:var(--crimson-light);font-size:0.85rem">${c.arme2degats||'—'}</span>
        <span style="font-size:0.78rem;color:var(--text-muted)">${c.arme2type||''}</span>
      </div>`:''}
      <div style="font-size:0.78rem;color:var(--text-dim);margin-top:0.5rem;font-style:italic">
        🎲 Critique : Max de la somme totale + relance les dés dégâts.
      </div>
    </div>
    ${canEdit?`<button class="btn btn-outline btn-sm" onclick="editCharCombat()">✏️ Modifier les armes</button>`:''}
  </div>
  <div class="char-section">
    <div class="char-section-title">📋 Actions de Combat</div>
    <div style="font-size:0.83rem;line-height:1.8;color:var(--text-muted)">
      <div>⚡ <strong style="color:var(--text)">(Action)</strong> Frappe simple / Sort / Compétence</div>
      <div>🏃 <strong style="color:var(--text)">(Action)</strong> Courir (double la vitesse de base)</div>
      <div>🛡️ <strong style="color:var(--text)">(Action)</strong> Se désengager (ignore att. d'opportunité)</div>
      <div>👁️ <strong style="color:var(--text)">(Action)</strong> Se cacher</div>
      <div>🤝 <strong style="color:var(--text)">(Action)</strong> Aider (retire un état d'un allié CaC)</div>
      <div>⚔️ <strong style="color:var(--text)">(Action)</strong> Changer d'arme</div>
      <div style="margin-top:0.5rem;color:var(--text-dim);font-style:italic">💡 1 Action + 1 Action Bonus + 1 Réaction + Déplacement / tour</div>
    </div>
  </div>`;
}

function renderCharDeck(c, canEdit) {
  const sorts = c.deck_sorts || [];
  const NOYAUX = ['Feu 🔥','Eau 💧','Terre 🪨','Vent 🌬️','Foudre ⚡','Ombre 🌑','Lumière ✨','Physique 💪','Arcane 🔮'];
  const RUNES = ['Puissance','Soin','Zone','Rapide','Lent','Drain','Bouclier','Chaîne','Silence','Poison','Gel','Brûlure','Renverse','Téléport','Invocation'];

  let html = `<div class="char-section">
    <div class="char-section-title">✨ Sorts & Compétences
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addSort()">+ Créer un Sort</button>`:''}
    </div>
    <div style="background:rgba(226,185,111,0.05);border:1px solid rgba(226,185,111,0.15);border-radius:8px;padding:0.8rem;margin-bottom:1rem;font-size:0.8rem;color:var(--text-muted)">
      <strong style="color:var(--gold)">Système de sorts maison</strong> — Chaque sort combine un <em>Noyau élémentaire</em> et une ou plusieurs <em>Runes d'effet</em>. Les dégâts sont basés sur l'arme équipée. Le soin de base commence à 1d4 sauf indication contraire.
    </div>`;

  if (sorts.length===0) {
    html += `<div class="empty-state" style="padding:2rem"><span class="icon">🔮</span><p>Aucun sort. Commence par choisir un noyau élémentaire !</p></div>`;
  } else {
    sorts.forEach((s,i) => {
      const runesHtml = (s.runes||[]).map(r=>`<span class="badge badge-blue" style="font-size:0.65rem">${r}</span>`).join(' ');
      html += `<div style="background:rgba(255,255,255,0.03);border:1px solid ${s.actif?'rgba(226,185,111,0.3)':'var(--border)'};border-radius:8px;padding:1rem;margin-bottom:0.6rem;transition:all 0.2s">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem">
          <div style="display:flex;align-items:center;gap:0.6rem">
            <div class="toggle ${s.actif?'on':''}" onclick="${canEdit?`toggleSort(${i})`:''}" style="flex-shrink:0"></div>
            <div>
              <div style="font-weight:700;font-size:0.92rem;color:var(--text)">${s.nom||'Sort sans nom'}</div>
              <div style="display:flex;gap:0.4rem;margin-top:0.2rem;flex-wrap:wrap;align-items:center">
                ${s.noyau?`<span class="badge badge-gold" style="font-size:0.65rem">${s.noyau}</span>`:''}
                ${runesHtml}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:0.3rem;align-items:center">
            <span class="badge badge-blue">${s.pm||0} PM</span>
            ${canEdit?`<button class="btn-icon" onclick="editSort(${i})">✏️</button><button class="btn-icon" onclick="deleteSort(${i})">🗑️</button>`:''}
          </div>
        </div>
        ${s.effet?`<div style="font-size:0.82rem;color:var(--text-muted);padding-left:2.4rem;font-style:italic">${s.effet}</div>`:''}
        ${s.degats?`<div style="font-size:0.82rem;color:var(--crimson-light);padding-left:2.4rem">⚔️ ${s.degats} (basé sur arme)</div>`:''}
        ${s.soin?`<div style="font-size:0.82rem;color:#2ecc71;padding-left:2.4rem">💚 Soin : ${s.soin}</div>`:''}
      </div>`;
    });
  }
  html += `<div style="margin-top:0.8rem;font-size:0.75rem;color:var(--text-dim);font-style:italic">✨ Magie à mains nues : +2 PM, pas d'effet de set.</div>`;
  html += '</div>';
  return html;
}

function renderCharEquip(c, canEdit) {
  const equip = c.equipement || {};
  const armorSlots = ['Tête','Torse','Bottes','Amulette','Anneau','Objet magique'];
  const weaponSlots = ['Main principale','Main secondaire'];
  const mod = v=>{ const m=Math.floor((v-10)/2); return m>=0?'+'+m:String(m); };
  const stats = c.stats||{}; const bonus = c.statsBonus||{};
  const fo = (stats.force||10)+(bonus.force||0);
  const dex = (stats.dexterite||8)+(bonus.dexterite||0);

  let html = `<div class="char-section">
    <div class="char-section-title">⚔️ Armes & Combat</div>`;

  // Weapons
  weaponSlots.forEach(slot => {
    const item = equip[slot]||{};
    const statKey = item.statAttaque||'force';
    const statVal = statKey==='dexterite'?dex:fo;
    const modVal = mod(statVal);
    html += `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:0.8rem">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.6rem">
        <div>
          <div style="font-size:0.62rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.2rem">${slot}</div>
          <div style="font-weight:700;font-size:0.95rem;color:var(--text)">${item.nom||'— Vide —'}</div>
          ${item.trait?`<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.1rem">${item.trait}</div>`:''}
        </div>
        ${canEdit?`<button class="btn btn-outline btn-sm" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
      </div>
      ${item.nom?`<div style="display:flex;gap:1rem;flex-wrap:wrap">
        <div style="text-align:center">
          <div style="font-size:0.62rem;color:var(--text-dim);text-transform:uppercase;margin-bottom:0.2rem">Toucher</div>
          <div style="color:var(--gold);font-weight:700">1d20 ${modVal}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:0.62rem;color:var(--text-dim);text-transform:uppercase;margin-bottom:0.2rem">Dégâts</div>
          <div style="color:var(--crimson-light);font-weight:700">${item.degats||'—'} ${modVal}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:0.62rem;color:var(--text-dim);text-transform:uppercase;margin-bottom:0.2rem">Type</div>
          <div style="font-size:0.82rem;color:var(--text-muted)">${item.typeArme||'—'}</div>
        </div>
        ${item.portee?`<div style="text-align:center">
          <div style="font-size:0.62rem;color:var(--text-dim);text-transform:uppercase;margin-bottom:0.2rem">Portée</div>
          <div style="font-size:0.82rem;color:var(--text-muted)">${item.portee}</div>
        </div>`:''}
        ${item.particularite?`<div style="flex:1;min-width:150px">
          <div style="font-size:0.62rem;color:var(--text-dim);text-transform:uppercase;margin-bottom:0.2rem">Particularité</div>
          <div style="font-size:0.8rem;color:var(--text-muted);font-style:italic">${item.particularite}</div>
        </div>`:''}
      </div>`:'<div style="font-size:0.82rem;color:var(--text-dim);font-style:italic">Aucune arme équipée</div>'}
    </div>`;
  });

  html += `<div style="font-size:0.78rem;color:var(--text-dim);font-style:italic;margin-bottom:1rem">🎲 Critique : Maximum des dés + relance les dés de dégâts.</div>`;
  html += `</div>`;

  // Actions rapides
  html += `<div class="char-section">
    <div class="char-section-title">📋 Actions de Combat</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.4rem">
      ${[
        ['⚡','Action','Frappe / Sort / Compétence'],
        ['🏃','Action','Courir (×2 vitesse)'],
        ['🛡️','Action','Se désengager'],
        ['👁️','Action','Se cacher'],
        ['🤝','Action','Aider (retire état allié CaC)'],
        ['🔄','Action','Changer d\'arme'],
      ].map(([icon,type,desc])=>`<div style="display:flex;gap:0.5rem;padding:0.4rem;background:rgba(255,255,255,0.02);border-radius:6px">
        <span style="font-size:1rem">${icon}</span>
        <div><span style="font-size:0.68rem;color:var(--text-dim);text-transform:uppercase;font-weight:700">${type}</span>
        <div style="font-size:0.8rem;color:var(--text-muted)">${desc}</div></div>
      </div>`).join('')}
    </div>
    <div style="margin-top:0.6rem;font-size:0.75rem;color:var(--text-dim);font-style:italic">1 Action + 1 Action Bonus + 1 Réaction + Déplacement / tour</div>
  </div>`;

  // Armor
  html += `<div class="char-section">
    <div class="char-section-title">🛡️ Armures & Accessoires</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.6rem">`;
  armorSlots.forEach(slot => {
    const item = equip[slot]||{};
    const hasBonus = ['fo','dex','in','sa','co','ch','ca'].some(k=>item[k]);
    html += `<div style="background:rgba(255,255,255,0.02);border:1px solid ${item.nom?'rgba(226,185,111,0.2)':'var(--border)'};border-radius:8px;padding:0.8rem">
      <div style="font-size:0.6rem;color:var(--text-dim);text-transform:uppercase;font-weight:700;margin-bottom:0.3rem">${slot}</div>
      <div style="font-weight:600;font-size:0.85rem;color:${item.nom?'var(--text)':'var(--text-dim)'}">${item.nom||'—'}</div>
      ${item.trait?`<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;font-style:italic">${item.trait}</div>`:''}
      ${hasBonus?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:0.4rem">
        ${['fo','dex','in','sa','co','ch'].filter(k=>item[k]).map(k=>`<span class="badge badge-gold" style="font-size:0.6rem">${k.toUpperCase()} ${item[k]>0?'+'+item[k]:item[k]}</span>`).join('')}
        ${item.ca?`<span class="badge badge-blue" style="font-size:0.6rem">CA +${item.ca}</span>`:''}
      </div>`:''}
      ${canEdit?`<button class="btn-icon" style="margin-top:0.4rem;font-size:0.75rem" onclick="editEquipSlot('${slot}')">✏️ Équiper</button>`:''}
    </div>`;
  });

  const totals = {fo:0,dex:0,in:0,sa:0,co:0,ch:0,ca:0};
  Object.values(equip).forEach(item=>{['fo','dex','in','sa','co','ch','ca'].forEach(s=>{totals[s]+=(item[s]||0);});});
  const totalStr = Object.entries(totals).filter(([,v])=>v!==0).map(([k,v])=>`${k.toUpperCase()} ${v>0?'+'+v:v}`).join(' · ');
  if (totalStr) html += `<div style="margin-top:0.6rem;padding:0.5rem;background:rgba(226,185,111,0.06);border-radius:6px;font-size:0.78rem;color:var(--gold)">Bonus total : ${totalStr}</div>`;
  html += `</div></div>`;
  return html;
}

function renderCharInventaire(c, canEdit) {
  const inv = c.inventaire||[];
  let html = `<div class="char-section">
    <div class="char-section-title">🎒 Inventaire
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addInvItem()">+ Ajouter</button>`:''}
    </div>
    <table class="data-table"><thead><tr>
      <th>Objet</th><th>Type</th><th>Qté</th><th>Description</th>${canEdit?'<th></th>':''}
    </tr></thead><tbody>`;
  if (inv.length===0) {
    html += `<tr><td colspan="${canEdit?5:4}" style="color:var(--text-dim);font-style:italic;text-align:center">Inventaire vide.</td></tr>`;
  } else {
    inv.forEach((item,i) => {
      html += `<tr>
        <td style="font-size:0.88rem">${item.nom||'?'}</td>
        <td><span class="badge badge-gold" style="font-size:0.68rem">${item.type||''}</span></td>
        <td style="text-align:center">${item.qte||'-'}</td>
        <td style="font-size:0.82rem;color:var(--text-muted);font-style:italic">${item.description||''}</td>
        ${canEdit?`<td><div style="display:flex;gap:0.2rem">
          <button class="btn-icon" onclick="editInvItem(${i})">✏️</button>
          <button class="btn-icon" onclick="deleteInvItem(${i})">🗑️</button>
        </div></td>`:''}
      </tr>`;
    });
  }
  html += '</tbody></table></div>';
  return html;
}

function renderCharQuetes(c, canEdit) {
  const quetes = c.quetes||[];
  let html = `<div class="char-section">
    <div class="char-section-title">📜 Journal de Quête
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addQuete()">+ Ajouter</button>`:''}
    </div>`;
  if (quetes.length===0) {
    html += `<div style="color:var(--text-dim);font-style:italic">Aucune quête.</div>`;
  } else {
    quetes.forEach((q,i) => {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:0.85rem;color:var(--text)">${q.nom||'?'}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);font-style:italic">${q.type||''} — ${q.description||''}</div>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center">
          <span class="badge badge-${q.valide?'green':'blue'}">${q.valide?'Validée':'En cours'}</span>
          ${canEdit?`<button class="btn-icon" onclick="toggleQuete(${i})">✔️</button>
          <button class="btn-icon" onclick="deleteQuete(${i})">🗑️</button>`:''}
        </div>
      </div>`;
    });
  }
  html += '</div>';
  return html;
}

function renderCharNotes(c, canEdit) {
  const notes = c.notes||'';
  return `<div class="char-section">
    <div class="char-section-title">📝 Notes de Session</div>
    ${canEdit
      ? `<textarea class="input-field" id="char-notes-area" rows="10" placeholder="Tes notes personnelles...">${notes}</textarea>
         <button class="btn btn-gold btn-sm" style="margin-top:0.8rem" onclick="saveNotes()">💾 Enregistrer</button>`
      : `<div style="font-size:0.88rem;line-height:1.7;white-space:pre-wrap;color:var(--text-muted)">${notes||'Aucune note.'}</div>`
    }
  </div>`;
}

// ══════════════════════════════════════════════
// CHARACTER ACTIONS
// ══════════════════════════════════════════════
async function adjustStat(stat, delta, charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  const base = stat==='pvActuel'?'pvBase':'pmBase';
  const maxVal = c[base]||10;
  const cur = c[stat]??maxVal;
  const newVal = Math.max(0,Math.min(maxVal,cur+delta));
  c[stat] = newVal;
  await updateInCol('characters',c.id,{[stat]:newVal});

  // Update only the vital display — do NOT re-render the whole sheet
  const pct = Math.max(0,Math.min(100,Math.round(newVal/maxVal*100)));
  if (stat==='pvActuel') {
    const valEl = document.getElementById('pv-val');
    const barEl = document.getElementById('pv-bar');
    if (valEl) { valEl.textContent=newVal; valEl.style.color=pct<25?'var(--crimson-light)':pct<50?'#e67e22':'#2ecc71'; }
    if (barEl) { barEl.style.width=pct+'%'; barEl.className='hp-bar-fill '+(pct>50?'high':pct>25?'mid':''); }
  } else {
    const valEl = document.getElementById('pm-val');
    const barEl = document.getElementById('pm-bar');
    if (valEl) valEl.textContent=newVal;
    if (barEl) barEl.style.width=pct+'%';
  }
}

async function saveNotes() {
  const c = STATE.activeChar;
  if (!c) return;
  const notes = document.getElementById('char-notes-area')?.value||'';
  c.notes = notes;
  await updateInCol('characters',c.id,{notes});
  showNotif('Notes sauvegardées !','success');
  // notes don't need re-render
}

async function toggleSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  const sorts = c.deck_sorts||[];
  sorts[idx].actif = !sorts[idx].actif;
  c.deck_sorts = sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  renderCharSheet(c, 'deck');
}

async function toggleQuete(idx) {
  const c = STATE.activeChar; if(!c) return;
  c.quetes[idx].valide = !c.quetes[idx].valide;
  await updateInCol('characters',c.id,{quetes:c.quetes});
  renderCharSheet(c,'quetes');
}

async function deleteQuete(idx) {
  const c = STATE.activeChar; if(!c) return;
  c.quetes.splice(idx,1);
  await updateInCol('characters',c.id,{quetes:c.quetes});
  renderCharSheet(c,'quetes');
}

async function deleteSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  c.deck_sorts.splice(idx,1);
  await updateInCol('characters',c.id,{deck_sorts:c.deck_sorts});
  renderCharSheet(c, 'deck');
}

async function deleteInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  c.inventaire.splice(idx,1);
  await updateInCol('characters',c.id,{inventaire:c.inventaire});
  renderCharSheet(c, 'inventaire');
}

async function deleteChar(id) {
  if (!confirm('Supprimer ce personnage ?')) return;
  await deleteFromCol('characters',id);
  showNotif('Personnage supprimé.','success');
  PAGES.characters();
}

// ══════════════════════════════════════════════

// ── Instant New Character (no modal) ──
async function createNewChar() {
  const data = {
    uid: STATE.user.uid,
    ownerPseudo: STATE.profile?.pseudo||'?',
    nom: 'Nouveau personnage',
    titre: '', titres: [],
    niveau: 1, or: 0,
    pvBase: 10, pvActuel: 10,
    pmBase: 10, pmActuel: 10,
    ca: 7, vitesse: 3, exp: 0, palier: 100,
    stats: {force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10},
    statsBonus: {},
    equipement:{}, inventaire:[], deck_sorts:[], quetes:[], notes:'',
  };
  const id = await addToCol('characters', data);
  showNotif('Personnage créé ! Modifie ses infos ci-dessous.','success');
  PAGES.characters();
}

// ── Edit Char Info — inline panel instead of modal ──
function editCharInfo() {
  const c = STATE.activeChar; if(!c) return;
  const titres = c.titres||[];
  window._editTitres = [...titres];

  // Show inline edit panel in the tab content area
  const area = document.getElementById('char-tab-content');
  if (!area) return;
  window._currentCharTab = 'edit';

  const titresHtml = () => window._editTitres.map((t,i)=>
    `<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.2rem 0.6rem;background:rgba(226,185,111,0.1);border:1px solid rgba(226,185,111,0.25);border-radius:20px;font-size:0.8rem;color:var(--gold)">${t}
    <button onclick="removeTitre(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:0.7rem;padding:0;margin-left:0.2rem">✕</button></span>`
  ).join('');

  area.innerHTML = `
  <div class="char-section" style="border-color:rgba(226,185,111,0.3)">
    <div class="char-section-title" style="justify-content:space-between">
      ✏️ Modifier le Personnage
      <button class="btn btn-outline btn-sm" onclick="cancelEditChar()">✕ Annuler</button>
    </div>

    <div class="form-group"><label>Nom du personnage</label>
      <input class="input-field" id="ei-nom" value="${c.nom||''}" placeholder="Nom...">
    </div>

    <div class="form-group">
      <label>Titres <span style="color:var(--text-dim);font-weight:400">(plusieurs)</span></label>
      <div id="titres-list" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem;min-height:1.5rem">${titresHtml()}</div>
      <div style="display:flex;gap:0.4rem">
        <input class="input-field" id="ei-titre-new" placeholder="Nouveau titre..." style="flex:1" onkeydown="if(event.key==='Enter')addTitre()">
        <button class="btn btn-outline btn-sm" onclick="addTitre()">+ Ajouter</button>
      </div>
    </div>

    <div class="grid-2" style="gap:1rem">
      <div class="form-group"><label>Niveau</label>
        <input type="number" class="input-field" id="ei-niveau" value="${c.niveau||1}" min="1" max="20">
      </div>
      <div class="form-group"><label>EXP actuelle</label>
        <input type="number" class="input-field" id="ei-exp" value="${c.exp||0}" min="0">
      </div>
    </div>

    <hr class="divider">
    <div style="font-size:0.72rem;color:var(--gold);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.8rem">
      PV & PM de base <span style="color:var(--text-dim);font-weight:400;letter-spacing:0">(les formules s'appliquent avec le niveau)</span>
    </div>
    <div class="grid-2" style="gap:1rem">
      <div class="form-group"><label>PV Base (niveau 1)</label>
        <input type="number" class="input-field" id="ei-pv" value="${c.pvBase||10}" min="1">
        <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.3rem">PV max calculé : ${calcPVMax(c)}</div>
      </div>
      <div class="form-group"><label>PM Base (niveau 1)</label>
        <input type="number" class="input-field" id="ei-pm" value="${c.pmBase||10}" min="1">
        <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.3rem">PM max calculé : ${calcPMMax(c)}</div>
      </div>
    </div>

    <hr class="divider">
    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.8rem">
      📖 CA, Vitesse et Deck sont calculés automatiquement depuis les stats et l'équipement.
    </div>
    <div class="grid-3" style="gap:0.5rem;margin-bottom:1rem">
      <div class="stat-box"><div class="stat-label">CA calculée</div><div class="stat-value" style="font-size:1.2rem">${calcCA(c)}</div><div class="stat-sub">Base torse + Mod Dex</div></div>
      <div class="stat-box"><div class="stat-label">Vitesse calculée</div><div class="stat-value" style="font-size:1.2rem">${calcVitesse(c)}m</div><div class="stat-sub">3 + Mod Force</div></div>
      <div class="stat-box"><div class="stat-label">Deck calculé</div><div class="stat-value" style="font-size:1.2rem">${calcDeck(c)}</div><div class="stat-sub">3 + f(Niv, Int)</div></div>
    </div>

    <div style="display:flex;gap:0.8rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveCharInfo()">💾 Enregistrer</button>
      <button class="btn btn-outline" onclick="cancelEditChar()">Annuler</button>
    </div>
  </div>`;
}

function cancelEditChar() {
  window._currentCharTab = 'carac';
  const c = window._currentChar;
  if (c) {
    document.getElementById('char-tab-content').innerHTML = renderCharCarac(c, window._canEditChar);
    document.querySelectorAll('#char-tabs .tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  }
}

function addTitre() {
  const input = document.getElementById('ei-titre-new');
  const val = input?.value.trim();
  if (!val) return;
  window._editTitres = window._editTitres||[];
  window._editTitres.push(val);
  input.value='';
  const list = document.getElementById('titres-list');
  if (list) list.innerHTML = window._editTitres.map((t,i)=>`<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.2rem 0.6rem;background:rgba(226,185,111,0.1);border:1px solid rgba(226,185,111,0.25);border-radius:20px;font-size:0.8rem;color:var(--gold)">${t}<button onclick="removeTitre(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:0.7rem;padding:0;margin-left:0.2rem">✕</button></span>`).join('');
}

function removeTitre(idx) {
  window._editTitres = window._editTitres||[];
  window._editTitres.splice(idx,1);
  const list = document.getElementById('titres-list');
  if (list) list.innerHTML = window._editTitres.map((t,i)=>`<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.2rem 0.6rem;background:rgba(226,185,111,0.1);border:1px solid rgba(226,185,111,0.25);border-radius:20px;font-size:0.8rem;color:var(--gold)">${t}<button onclick="removeTitre(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:0.7rem;padding:0;margin-left:0.2rem">✕</button></span>`).join('');
}

async function saveCharInfo() {
  const c = STATE.activeChar; if(!c) return;
  const pvBase = parseInt(document.getElementById('ei-pv')?.value)||10;
  const pmBase = parseInt(document.getElementById('ei-pm')?.value)||10;
  const niveau = parseInt(document.getElementById('ei-niveau')?.value)||1;

  // Temporarily update c to compute formulas
  const tempC = {...c, pvBase, pmBase, niveau, stats: c.stats||{}, statsBonus: c.statsBonus||{}, equipement: c.equipement||{}};
  const pvMax = calcPVMax(tempC);
  const pmMax = calcPMMax(tempC);

  const updates = {
    nom: document.getElementById('ei-nom')?.value.trim()||c.nom,
    titres: window._editTitres||[],
    niveau,
    pvBase, pvActuel: Math.min(c.pvActuel??pvMax, pvMax),
    pvMax,
    pmBase, pmActuel: Math.min(c.pmActuel??pmMax, pmMax),
    pmMax,
    exp: parseInt(document.getElementById('ei-exp')?.value)||0,
  };
  Object.assign(c, updates);
  await updateInCol('characters', c.id, updates);
  const pills = document.querySelectorAll('#char-pills .char-pill');
  pills.forEach(p=>{ if(p.classList.contains('active')) p.textContent=updates.nom; });
  showNotif('Personnage mis à jour !','success');
  renderCharSheet(c, 'carac');
}

// ── Edit Stats ──
function editCharStats() {
  const c = STATE.activeChar; if(!c) return;
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const keys = [['force','Force'],['dexterite','Dextérité'],['intelligence','Intelligence'],['sagesse','Sagesse'],['constitution','Constitution'],['charisme','Charisme']];
  openModal('📊 Modifier les Caractéristiques', `
    <div class="grid-2" style="gap:0.8rem">
      ${keys.map(([k,l])=>`<div class="form-group"><label>${l}</label><input type="number" class="input-field" id="st-${k}" value="${s[k]||8}" min="1" max="30"></div>`).join('')}
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCharStats()">Enregistrer</button>
  `);
}

async function saveCharStats() {
  const c = STATE.activeChar; if(!c) return;
  const keys = ['force','dexterite','intelligence','sagesse','constitution','charisme'];
  const stats = {};
  keys.forEach(k=>{ stats[k]=parseInt(document.getElementById(`st-${k}`)?.value)||8; });
  c.stats = stats;
  await updateInCol('characters',c.id,{stats});
  closeModal(); showNotif('Stats mises à jour !','success');
  renderCharSheet(c, window._currentCharTab||'carac');
}


async function saveCharCombat() {
  const c = STATE.activeChar; if(!c) return;
  const updates = {
    arme1nom: document.getElementById('cb-a1nom')?.value||'Main principale',
    arme1degats: document.getElementById('cb-a1degats')?.value||'1D10',
    arme1type: document.getElementById('cb-a1type')?.value||'Arme 1M CaC',
    arme2nom: document.getElementById('cb-a2nom')?.value||'',
    arme2toucher: document.getElementById('cb-a2toucher')?.value||'',
    arme2degats: document.getElementById('cb-a2degats')?.value||'',
    arme2type: document.getElementById('cb-a2type')?.value||'',
  };
  Object.assign(c,updates);
  await updateInCol('characters',c.id,updates);
  closeModal(); showNotif('Armes mises à jour !','success');
  renderCharSheet(c, window._currentCharTab||'equip');
}

function addSort() {
  const c = STATE.activeChar; if(!c) return;
  openSortModal(-1, {});
}

function editSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  const s = (c.deck_sorts||[])[idx];
  openSortModal(idx, s);
}

function openSortModal(idx, s) {
  const NOYAUX = ['Feu 🔥','Eau 💧','Terre 🪨','Vent 🌬️','Ombre 🌑','Lumière ✨','Physique 💪'];
  // Full runes from game document
  const RUNES = [
    {nom:'Puissance',effet:'+ 1 dé de dégâts. Allonge de l\'arme.'},
    {nom:'Protection',effet:'+2 CA (2 tr) OU +1 dé de soin.'},
    {nom:'Amplification',effet:'Zone +3m.'},
    {nom:'Enchantement',effet:'(AB) Ajoute l\'élément à équip. allié 2 tr.'},
    {nom:'Affliction',effet:'Ajoute l\'élément + État à équip. ennemi 2 tr.'},
    {nom:'Invocation',effet:'Invoque une créature liée. 10 PV, CA 10.'},
    {nom:'Dispersion',effet:'Divise en plusieurs projectiles. +1 cible.'},
    {nom:'Lacération',effet:'Réduit CA cible de 1 (-2 max, -4 élites).'},
    {nom:'Chance',effet:'RC -1 (20→19). Dé critique aussi max.'},
    {nom:'Durée',effet:'+2 tours de durée.'},
    {nom:'Concentration',effet:'Garde actif hors tour. JS Sa DD11 si dégâts.'},
    {nom:'Réaction',effet:'Lance le sort hors de son tour.'},
  ];
  const runesSel = s.runes||[];
  openModal(idx>=0?'✏️ Modifier le Sort':'✨ Nouveau Sort / Compétence', `
    <div class="form-group"><label>Nom du sort</label><input class="input-field" id="s-nom" value="${s.nom||''}" placeholder="Boule de feu, Frappe élémentaire..."></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Noyau élémentaire <span style="color:var(--text-dim)">(2 PM)</span></label>
        <select class="input-field" id="s-noyau" onchange="updateSortPM()">
          <option value="">— Choisir —</option>
          ${NOYAUX.map(n=>`<option value="${n}" ${s.noyau===n?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Coût PM <span style="color:var(--text-dim)">(auto-calculé)</span></label>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <input type="number" class="input-field" id="s-pm" value="${s.pm||2}" min="0" readonly style="background:rgba(52,152,219,0.08);border-color:rgba(52,152,219,0.3);color:var(--blue);font-weight:700">
          <span style="font-size:0.72rem;color:var(--text-dim)">= 2 × runes</span>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Runes d'effet <span style="color:var(--text-dim);font-weight:400">(+2 PM chacune)</span></label>
      <div style="display:flex;flex-direction:column;gap:0.3rem;padding:0.6rem;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;max-height:220px;overflow-y:auto" id="runes-selector">
        ${RUNES.map(r=>`<div onclick="toggleRune(this,'${r.nom}')" style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.6rem;border-radius:6px;cursor:pointer;border:1px solid ${runesSel.includes(r.nom)?'rgba(52,152,219,0.5)':'rgba(255,255,255,0.05)'};background:${runesSel.includes(r.nom)?'rgba(52,152,219,0.1)':'transparent'};transition:all 0.15s" class="rune-chip ${runesSel.includes(r.nom)?'selected':''}">
          <span style="font-weight:${runesSel.includes(r.nom)?'600':'400'};color:${runesSel.includes(r.nom)?'var(--blue)':'var(--text-muted)'};font-size:0.82rem">${r.nom}</span>
          <span style="font-size:0.72rem;color:var(--text-dim);font-style:italic;max-width:60%">${r.effet}</span>
        </div>`).join('')}
      </div>
      <input type="hidden" id="s-runes" value="${runesSel.join(',')}">
    </div>
    <hr class="divider">
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts <span style="color:var(--text-dim);font-weight:400">(basé sur arme)</span></label><input class="input-field" id="s-degats" value="${s.degats||''}" placeholder="= arme, +1D4..."></div>
      <div class="form-group"><label>Soin <span style="color:var(--text-dim);font-weight:400">(base 1d4)</span></label><input class="input-field" id="s-soin" value="${s.soin||''}" placeholder="1d4, 2d6+Sa..."></div>
    </div>
    <div class="form-group"><label>Description / Effet</label><textarea class="input-field" id="s-effet" rows="3" placeholder="Décris l'effet du sort...">${s.effet||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="saveSort(${idx})">Enregistrer</button>
  `);
}

function toggleRune(el, rune) {
  const input = document.getElementById('s-runes');
  let runes = input.value ? input.value.split(',').filter(Boolean) : [];
  if (runes.includes(rune)) {
    runes = runes.filter(r=>r!==rune);
    el.style.background='transparent'; el.style.borderColor='rgba(255,255,255,0.05)'; el.classList.remove('selected');
    el.querySelector('span:first-child').style.color='var(--text-muted)'; el.querySelector('span:first-child').style.fontWeight='400';
    el.style.borderColor='rgba(255,255,255,0.05)';
  } else {
    runes.push(rune);
    el.style.background='rgba(52,152,219,0.1)'; el.style.borderColor='rgba(52,152,219,0.5)'; el.classList.add('selected');
    el.querySelector('span:first-child').style.color='var(--blue)'; el.querySelector('span:first-child').style.fontWeight='600';
  }
  input.value = runes.join(',');
  updateSortPM();
}

function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const runesRaw = document.getElementById('s-runes')?.value||'';
  const runes = runesRaw ? runesRaw.split(',').filter(Boolean) : [];
  const total = (noyau ? 1 : 0) + runes.length;
  const pmEl = document.getElementById('s-pm');
  if (pmEl) pmEl.value = total * 2 || 2;
}

async function saveSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  const sorts = c.deck_sorts||[];
  const runesRaw = document.getElementById('s-runes')?.value||'';
  const noyau = document.getElementById('s-noyau')?.value||'';
  const runes = runesRaw ? runesRaw.split(',').filter(Boolean) : [];
  // Auto PM: 2 per rune (noyau = 1 rune + effets)
  const totalRunes = (noyau ? 1 : 0) + runes.length;
  const autoPm = totalRunes * 2;
  const newSort = {
    nom: document.getElementById('s-nom')?.value||'Sort',
    pm: autoPm || 2,
    noyau,
    runes,
    degats: document.getElementById('s-degats')?.value||'',
    soin: document.getElementById('s-soin')?.value||'',
    effet: document.getElementById('s-effet')?.value||'',
    actif: idx>=0 ? sorts[idx].actif : false,
  };
  if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
  c.deck_sorts=sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  closeModal(); showNotif(`Sort enregistré ! Coût : ${newSort.pm} PM`,'success');
  renderCharSheet(c,'deck');
}

// ── Equip Slot ──
function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');
  openModal(`${isWeapon?'⚔️':'🛡️'} ${slot}`, `
    <div class="form-group"><label>Nom</label><input class="input-field" id="eq-nom" value="${item.nom||''}" placeholder="${isWeapon?'Épée longue, Arc court...':'Heaume de Fer...'}"></div>
    <div class="form-group"><label>Trait</label><input class="input-field" id="eq-trait" value="${item.trait||''}" placeholder="${isWeapon?'Lourd, Polyvalent, Finesse...':'Lourd, Magique...'}"></div>
    ${isWeapon?`
    <hr class="divider">
    <div style="font-size:0.72rem;color:var(--gold);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.8rem">Stats de Combat</div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts (dés)</label><input class="input-field" id="eq-degats" value="${item.degats||'1D10'}" placeholder="1D10, 2D6..."></div>
      <div class="form-group"><label>Stat d'attaque</label>
        <select class="input-field" id="eq-stat-attaque">
          <option value="force" ${(item.statAttaque||'force')==='force'?'selected':''}>Force</option>
          <option value="dexterite" ${item.statAttaque==='dexterite'?'selected':''}>Dextérité</option>
          <option value="intelligence" ${item.statAttaque==='intelligence'?'selected':''}>Intelligence</option>
        </select>
      </div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type d'arme</label><input class="input-field" id="eq-type-arme" value="${item.typeArme||''}" placeholder="CaC 1M, Dist., Magique..."></div>
      <div class="form-group"><label>Portée</label><input class="input-field" id="eq-portee" value="${item.portee||''}" placeholder="CaC, 18m..."></div>
    </div>
    <div class="form-group"><label>Particularité</label><input class="input-field" id="eq-particularite" value="${item.particularite||''}" placeholder="(Réaction) Attaque d'opportunité..."></div>
    `:`
    <hr class="divider">
    <div style="font-size:0.72rem;color:var(--gold);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.8rem">Bonus de Statistiques</div>
    <div class="grid-4" style="gap:0.5rem">
      ${[['fo','Force'],['dex','Dex'],['in','Int'],['sa','Sag'],['co','Con'],['ch','Cha'],['ca','CA']].map(([k,l])=>`
        <div class="form-group"><label>${l}</label><input type="number" class="input-field" id="eq-${k}" value="${item[k]||0}"></div>`).join('')}
    </div>`}
    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveEquipSlot('${slot}')">Enregistrer</button>
      <button class="btn btn-danger" onclick="clearEquipSlot('${slot}')">Retirer</button>
    </div>
  `);
}

async function saveEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equip = c.equipement||{};
  const isWeapon = slot.startsWith('Main');
  if (isWeapon) {
    equip[slot] = {
      nom: document.getElementById('eq-nom')?.value||'',
      trait: document.getElementById('eq-trait')?.value||'',
      degats: document.getElementById('eq-degats')?.value||'1D10',
      statAttaque: document.getElementById('eq-stat-attaque')?.value||'force',
      typeArme: document.getElementById('eq-type-arme')?.value||'',
      portee: document.getElementById('eq-portee')?.value||'',
      particularite: document.getElementById('eq-particularite')?.value||'',
    };
  } else {
    equip[slot] = {
      nom: document.getElementById('eq-nom')?.value||'',
      trait: document.getElementById('eq-trait')?.value||'',
      fo: parseInt(document.getElementById('eq-fo')?.value)||0,
      dex: parseInt(document.getElementById('eq-dex')?.value)||0,
      in: parseInt(document.getElementById('eq-in')?.value)||0,
      sa: parseInt(document.getElementById('eq-sa')?.value)||0,
      co: parseInt(document.getElementById('eq-co')?.value)||0,
      ch: parseInt(document.getElementById('eq-ch')?.value)||0,
      ca: parseInt(document.getElementById('eq-ca')?.value)||0,
    };
  }
  c.equipement = equip;
  const bonus={fo:0,dex:0,in:0,sa:0,co:0,ch:0};
  Object.values(equip).forEach(it=>{ bonus.fo+=(it.fo||0);bonus.dex+=(it.dex||0);bonus.in+=(it.in||0);bonus.sa+=(it.sa||0);bonus.co+=(it.co||0);bonus.ch+=(it.ch||0); });
  c.statsBonus={force:bonus.fo,dexterite:bonus.dex,intelligence:bonus.in,sagesse:bonus.sa,constitution:bonus.co,charisme:bonus.ch};
  const caBonus=Object.values(equip).reduce((sum,it)=>sum+(it.ca||0),0);
  c.ca=7+caBonus;
  await updateInCol('characters',c.id,{equipement:equip,statsBonus:c.statsBonus,ca:c.ca});
  closeModal(); showNotif('Équipement mis à jour !','success');
  renderCharSheet(c,'equip');
}

async function clearEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equip = c.equipement||{};
  delete equip[slot];
  c.equipement=equip;
  const bonus={fo:0,dex:0,in:0,sa:0,co:0,ch:0};
  Object.values(equip).forEach(it=>{
    bonus.fo+=(it.fo||0); bonus.dex+=(it.dex||0); bonus.in+=(it.in||0);
    bonus.sa+=(it.sa||0); bonus.co+=(it.co||0); bonus.ch+=(it.ch||0);
  });
  c.statsBonus={force:bonus.fo,dexterite:bonus.dex,intelligence:bonus.in,sagesse:bonus.sa,constitution:bonus.co,charisme:bonus.ch};
  const caBonus = Object.values(equip).reduce((sum,it)=>sum+(it.ca||0),0);
  c.ca=7+caBonus;
  await updateInCol('characters',c.id,{equipement:equip,statsBonus:c.statsBonus,ca:c.ca});
  closeModal(); showNotif('Emplacement libéré.','success');
  renderCharSheet(c, 'equip');
}

// ── Add Inventory ──
function addInvItem() {
  openModal('🎒 Ajouter un objet', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" placeholder="Potion de soin..."></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" placeholder="Consommable, Matériau..."></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="1"></div>
    </div>
    <div class="form-group"><label>Description / Effet</label><textarea class="input-field" id="inv-desc" rows="3" placeholder="(Action) Rend 10 PV..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInvItem(-1)">Ajouter</button>
  `);
}

function editInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.inventaire||[])[idx];
  openModal('✏️ Modifier l\'objet', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" value="${item.nom||''}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" value="${item.type||''}"></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="${item.qte||1}"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="inv-desc" rows="3">${item.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInvItem(${idx})">Enregistrer</button>
  `);
}

async function saveInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const inv = c.inventaire||[];
  const newItem = {
    nom: document.getElementById('inv-nom')?.value||'?',
    type: document.getElementById('inv-type')?.value||'',
    qte: document.getElementById('inv-qte')?.value||'1',
    description: document.getElementById('inv-desc')?.value||'',
  };
  if (idx>=0) inv[idx]=newItem; else inv.push(newItem);
  c.inventaire=inv;
  await updateInCol('characters',c.id,{inventaire:inv});
  closeModal(); showNotif('Inventaire mis à jour !','success');
  renderCharSheet(c, 'inventaire');
}

// ── Add Quete ──
function addQuete() {
  openModal('📜 Ajouter une quête', `
    <div class="form-group"><label>Nom de la quête</label><input class="input-field" id="q-nom" placeholder="La Crypte Maudite..."></div>
    <div class="form-group"><label>Type</label><input class="input-field" id="q-type" placeholder="Principale, Secondaire, Contrat..."></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="q-desc" rows="3" placeholder="Brève description de l'objectif..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveQuete()">Ajouter</button>
  `);
}

async function saveQuete() {
  const c = STATE.activeChar; if(!c) return;
  const quetes = c.quetes||[];
  quetes.push({
    nom: document.getElementById('q-nom')?.value||'?',
    type: document.getElementById('q-type')?.value||'',
    description: document.getElementById('q-desc')?.value||'',
    valide: false,
  });
  c.quetes=quetes;
  await updateInCol('characters',c.id,{quetes});
  closeModal(); showNotif('Quête ajoutée !','success');
  renderCharSheet(c,'quetes');
}

// ══════════════════════════════════════════════


Object.assign(window, {
  selectChar,
  filterAdminChars,
  getMod,
  calcCA,
  calcVitesse,
  calcDeck,
  calcPVMax,
  calcPMMax,
  renderCharSheet,
  showCharTab,
  renderCharCarac,
  renderCharCombat,
  renderCharDeck,
  renderCharEquip,
  renderCharInventaire,
  renderCharQuetes,
  renderCharNotes,
  adjustStat,
  saveNotes,
  toggleSort,
  toggleQuete,
  deleteQuete,
  deleteSort,
  deleteInvItem,
  deleteChar,
  createNewChar,
  editCharInfo,
  cancelEditChar,
  addTitre,
  removeTitre,
  saveCharInfo,
  editCharStats,
  saveCharStats,
  saveCharCombat,
  addSort,
  editSort,
  openSortModal,
  toggleRune,
  updateSortPM,
  saveSort,
  editEquipSlot,
  saveEquipSlot,
  clearEquipSlot,
  addInvItem,
  editInvItem,
  saveInvItem,
  addQuete,
  saveQuete
});
