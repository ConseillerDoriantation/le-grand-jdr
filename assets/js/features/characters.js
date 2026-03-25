import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

// ══════════════════════════════════════════════
// COMPUTED STATS
// ══════════════════════════════════════════════
function getMod(c, key) {
  const base = (c.stats||{})[key]||8;
  const bonus = (c.statsBonus||{})[key]||0;
  return Math.floor(((base+bonus)-10)/2);
}
function modStr(v) { return v >= 0 ? '+'+v : String(v); }
function calcCA(c) {
  const equip = c.equipement||{};
  const torse = equip['Torse']?.typeArmure||'';
  let caBase = 8;
  if (torse==='Légère') caBase=10;
  else if (torse==='Intermédiaire') caBase=12;
  else if (torse==='Lourde') caBase=14;
  const caEquip = Object.values(equip).reduce((s,it)=>s+(it.ca||0),0);
  return caBase + getMod(c,'dexterite') + caEquip;
}
function calcVitesse(c) { return 3 + getMod(c,'force'); }
function calcDeckMax(c) {
  const modIn = getMod(c,'intelligence');
  const niveau = c.niveau||1;
  return 3 + Math.min(0,modIn) + Math.floor(Math.max(0,modIn) * Math.pow(Math.max(0,niveau-1),0.75));
}
function calcPVMax(c) {
  const modCo = getMod(c,'constitution');
  const niv = c.niveau||1;
  return (c.pvBase||10) + (modCo > 0 ? Math.floor(modCo*(niv-1)) : modCo*(niv-1));
}
function calcPMMax(c) {
  const modSa = getMod(c,'sagesse');
  const niv = c.niveau||1;
  return (c.pmBase||10) + (modSa > 0 ? Math.floor(modSa*(niv-1)) : modSa*(niv-1));
}
function pct(cur,max) { return max>0 ? Math.max(0,Math.min(100,Math.round(cur/max*100))) : 0; }

// ══════════════════════════════════════════════
// SÉLECTION
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
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  const canEdit = STATE.isAdmin || c.uid === STATE.user?.uid;
  const currentTab = keepTab || window._currentCharTab || 'combat';

  window._currentChar = c;
  window._canEditChar = canEdit;
  window._currentCharTab = currentTab;

  const pvMax = calcPVMax(c);
  const pmMax = calcPMMax(c);
  const pvCur = c.pvActuel ?? pvMax;
  const pmCur = c.pmActuel ?? pmMax;
  const pvPct = pct(pvCur, pvMax);
  const pmPct = pct(pmCur, pmMax);
  const xpPct = pct(c.exp||0, c.palier||100);
  const deckActifs = (c.deck_sorts||[]).filter(s=>s.actif).length;
  const deckMax = calcDeckMax(c);
  const pvColor = pvPct < 25 ? 'var(--crimson-light)' : pvPct < 50 ? '#f59e0b' : 'var(--green)';

  const titres = c.titres||[];
  const titreHtml = titres.map(t=>`<span class="badge badge-gold" style="font-size:0.65rem">${t}</span>`).join('');

  // Stats inline
  const STATS = [
    {key:'force',abbr:'Fo'},
    {key:'dexterite',abbr:'Dex'},
    {key:'constitution',abbr:'Co'},
    {key:'intelligence',abbr:'Int'},
    {key:'sagesse',abbr:'Sag'},
    {key:'charisme',abbr:'Cha'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  const caracHtml = STATS.map(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    const mStr = m >= 0 ? '+'+m : String(m);
    const mClass = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    return `<div class="cs-carac-card">
      <div class="cs-carac-abbr">${st.abbr}</div>
      <div class="cs-carac-val ${canEdit?'cs-editable':''}"
           ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Cliquer pour modifier"`:''}
      >${total}</div>
      <div class="cs-carac-mod ${mClass}">${mStr}</div>
      <div class="cs-carac-base">${bonus?'Base '+base+' +'+bonus:''}</div>
    </div>`;
  }).join('');

  area.innerHTML = `
<div class="cs-shell">

  <!-- ═══ LIGNE HAUTE : 2 blocs côte à côte ═══ -->
  <div class="cs-top">

    <!-- BLOC GAUCHE : Identité & Vitaux -->
    <div class="cs-identity-panel">

      <!-- Photo + Nom -->
      <div class="cs-id-header">
        <div class="cs-photo-wrap" id="char-photo-wrap">
          <div class="cs-photo" id="char-photo"
               onclick="${canEdit?`openPhotoCropper('${c.id}')`:''}"
               style="cursor:${canEdit?'pointer':'default'}">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;
                   transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);
                   transform-origin:center center;">`
              : `<div class="cs-photo-placeholder">
                   ${canEdit?'<span style="font-size:1.5rem">📷</span>':'<span style="font-size:1.8rem;opacity:0.3">⚔️</span>'}
                 </div>`}
          </div>
          ${canEdit&&c.photo?`<button class="cs-photo-del" onclick="deleteCharPhoto('${c.id}')" title="Supprimer">✕</button>`:''}
        </div>
        <div class="cs-id-info">
          <div class="cs-name-row">
            ${canEdit
              ? `<span class="cs-name cs-editable" onclick="inlineEditText('${c.id}','nom',this)" title="Cliquer pour modifier">${c.nom||'Nouveau personnage'}</span>`
              : `<span class="cs-name">${c.nom||'Nouveau personnage'}</span>`}
            ${canEdit?`<button class="cs-delete-btn" onclick="deleteChar('${c.id}')" title="Supprimer le personnage">🗑️</button>`:''}
          </div>
          <div class="cs-titres">
            ${titreHtml}
            ${canEdit?`<button class="cs-add-titre" onclick="manageTitres('${c.id}')">＋ titre</button>`:''}
          </div>
        </div>
      </div>

      <!-- Niveau + XP + Or -->
      <div class="cs-meta-row">
        <span class="cs-level-badge">
          ${canEdit
            ? `<span class="cs-editable-num" onclick="inlineEditNum('${c.id}','niveau',this,1,20)" title="Modifier">Niv. ${c.niveau||1}</span>`
            : `Niv. ${c.niveau||1}`}
        </span>
        <div class="cs-xp-wrap">
          <div class="cs-xp-bar"><div class="cs-xp-fill" style="width:${xpPct}%"></div></div>
          <span class="cs-xp-label">
            ${canEdit
              ? `<span class="cs-editable-num" onclick="inlineEditNum('${c.id}','exp',this,0,99999)" title="Modifier">${c.exp||0}</span>`
              : (c.exp||0)} / ${c.palier||100} XP
          </span>
        </div>
        ${canEdit
          ? `<span class="cs-or cs-editable-num" onclick="inlineEditNum('${c.id}','or',this,0,999999)" title="Modifier">💰 ${c.or||0}</span>`
          : `<span class="cs-or">💰 ${c.or||0}</span>`}
      </div>

      <div class="cs-divider"></div>

      <!-- PV / PM -->
      <div class="cs-vitals-row">
        <div class="cs-vital-block">
          <div class="cs-vital-label">❤️ PV</div>
          <div class="cs-vital-controls">
            ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pvActuel',-1,'${c.id}')">−</button>`:''}
            <span class="cs-vital-val" id="pv-val" style="color:${pvColor}">${pvCur}</span>
            ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pvActuel',1,'${c.id}')">+</button>`:''}
          </div>
          <div class="cs-bar-bg cs-bar-hp"><div class="cs-bar-fill cs-bar-hp-fill ${pvPct>50?'high':pvPct>25?'mid':''}" id="pv-bar" style="width:${pvPct}%"></div></div>
          <div class="cs-vital-sub">max <span id="pv-max">${pvMax}</span></div>
        </div>
        <div class="cs-vital-block">
          <div class="cs-vital-label">🔵 PM</div>
          <div class="cs-vital-controls">
            ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pmActuel',-1,'${c.id}')">−</button>`:''}
            <span class="cs-vital-val" id="pm-val" style="color:var(--blue)">${pmCur}</span>
            ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pmActuel',1,'${c.id}')">+</button>`:''}
          </div>
          <div class="cs-bar-bg cs-bar-pm"><div class="cs-bar-fill cs-bar-pm-fill" id="pm-bar" style="width:${pmPct}%"></div></div>
          <div class="cs-vital-sub">max <span id="pm-max">${pmMax}</span></div>
        </div>
      </div>

      <!-- CA / Vit / Deck -->
      <div class="cs-secondary-row">
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🛡️ CA</span>
          <span class="cs-chip-val">${calcCA(c)}</span>
        </div>
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🏃 Vit</span>
          <span class="cs-chip-val">${calcVitesse(c)}m</span>
        </div>
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🃏 Deck</span>
          <span class="cs-chip-val">${deckActifs}/${deckMax}</span>
        </div>
      </div>

    </div><!-- /cs-identity-panel -->

    <!-- BLOC DROIT : Caractéristiques -->
    <div class="cs-carac-panel">
      <div class="cs-carac-panel-title">
        Caractéristiques
        ${canEdit?'<span class="cs-hint">cliquer sur une valeur pour modifier</span>':''}
      </div>

      <!-- Grille 3×2 des stats -->
      <div class="cs-carac-grid">
        ${caracHtml}
      </div>

      <!-- PV base / PM base / Palier -->
      <div class="cs-base-row">
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">PV base</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Modifier"`:''}
          >${c.pvBase||10}</div>
          <div class="cs-base-chip-sub">→ max ${pvMax}</div>
        </div>
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">PM base</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Modifier"`:''}
          >${c.pmBase||10}</div>
          <div class="cs-base-chip-sub">→ max ${pmMax}</div>
        </div>
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">Palier XP</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','palier',this,1,99999)" title="Modifier"`:''}
          >${c.palier||100}</div>
          <div class="cs-base-chip-sub">${c.exp||0} acquis</div>
        </div>
      </div>

    </div><!-- /cs-carac-panel -->

  </div><!-- /cs-top -->

  <!-- ═══ ONGLETS ═══ -->
  <div class="cs-tabs" id="char-tabs">
    ${['combat','sorts','inventaire','quetes','notes'].map((tab,i)=>{
      const labels = ['Combat','Sorts & Runes','Inventaire','Quêtes','Notes'];
      return `<button class="cs-tab ${currentTab===tab?'active':''}" onclick="showCharTab('${tab}',this)">${labels[i]}</button>`;
    }).join('')}
  </div>

  <!-- ═══ CONTENU ONGLET ═══ -->
  <div id="char-tab-content" class="cs-tab-body"></div>

</div>`;

  _renderTab(currentTab, c, canEdit);
}

function _renderTab(tab, c, canEdit) {
  const area = document.getElementById('char-tab-content');
  if (!area) return;
  const renders = {
    combat:     ()=>renderCharEquip(c,canEdit),
    sorts:      ()=>renderCharDeck(c,canEdit),
    inventaire: ()=>renderCharInventaire(c,canEdit),
    quetes:     ()=>renderCharQuetes(c,canEdit),
    notes:      ()=>renderCharNotes(c,canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
}

function showCharTab(tab, el) {
  document.querySelectorAll('#char-tabs .cs-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  window._currentCharTab = tab;
  _renderTab(tab, window._currentChar, window._canEditChar);
}

// ══════════════════════════════════════════════
// INLINE EDIT HELPERS — clic direct sur la valeur
// ══════════════════════════════════════════════
function inlineEditText(charId, field, el) {
  const cur = el.textContent.trim();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = cur;
  input.className = 'cs-inline-input';
  input.style.cssText = 'width:100%;font-size:inherit;font-weight:inherit;font-family:inherit;color:inherit;';

  const save = async () => {
    const val = input.value.trim() || cur;
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c || val === cur) { el.textContent = cur; input.replaceWith(el); return; }
    c[field] = val;
    await updateInCol('characters', charId, {[field]: val});
    el.textContent = val;
    input.replaceWith(el);
    // Update pill if name changed
    if (field === 'nom') {
      document.querySelectorAll('#char-pills .char-pill.active').forEach(p=>p.textContent=val);
    }
    showNotif('Mis à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.value=cur;input.blur();} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

function inlineEditNum(charId, field, el, min=0, max=99999) {
  const cur = el.textContent.replace(/[^\d-]/g,'').trim();
  const input = document.createElement('input');
  input.type = 'number';
  input.value = cur;
  input.min = min; input.max = max;
  input.className = 'cs-inline-input cs-inline-num';
  input.style.cssText += ';-moz-appearance:textfield;';

  const save = async () => {
    const val = Math.max(min, Math.min(max, parseInt(input.value)||0));
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) { input.replaceWith(el); return; }
    c[field] = val;
    await updateInCol('characters', charId, {[field]: val});
    el.textContent = field==='niveau' ? `Niv. ${val}` : field==='or' ? `💰 ${val} or` : val;
    input.replaceWith(el);
    // Recompute if niveau changed (affects pvMax, pmMax, deck)
    if (['niveau','pvBase','pmBase'].includes(field)) renderCharSheet(c, window._currentCharTab);
    else showNotif('Mis à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.replaceWith(el);} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

// Inline stat edit — click on carac box value
function inlineEditStat(charId, statKey, el) {
  const cur = parseInt(el.textContent)||8;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = cur;
  input.min = 1; input.max = 30;
  input.className = 'cs-inline-input cs-inline-num';
  input.style.cssText = 'width:52px;font-size:1.3rem;font-weight:700;text-align:center;-moz-appearance:textfield;';

  const save = async () => {
    const val = Math.max(1, Math.min(30, parseInt(input.value)||cur));
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) { input.replaceWith(el); return; }
    c.stats = c.stats||{};
    c.stats[statKey] = val;
    await updateInCol('characters', charId, {stats: c.stats});
    input.replaceWith(el);
    renderCharSheet(c, window._currentCharTab);
    showNotif('Stat mise à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.replaceWith(el);} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

// ══════════════════════════════════════════════
// TAB : CARACTÉRISTIQUES
// ══════════════════════════════════════════════
function renderCharCarac(c, canEdit) {
  const STATS = [
    {key:'force',label:'Force',abbr:'Fo'},
    {key:'dexterite',label:'Dextérité',abbr:'Dex'},
    {key:'constitution',label:'Constitution',abbr:'Co'},
    {key:'intelligence',label:'Intelligence',abbr:'Int'},
    {key:'sagesse',label:'Sagesse',abbr:'Sag'},
    {key:'charisme',label:'Charisme',abbr:'Cha'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  let html = `<div class="cs-section">
    <div class="cs-section-title">📊 Caractéristiques
      ${canEdit?'<span class="cs-hint">cliquer sur une valeur pour modifier</span>':''}
    </div>
    <div class="cs-carac-grid">`;

  STATS.forEach(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    html += `<div class="cs-carac-card">
      <div class="cs-carac-abbr">${st.abbr}</div>
      <div class="cs-carac-val ${canEdit?'cs-editable':''}"
           ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Cliquer pour modifier"`:''}>
        ${total}
      </div>
      <div class="cs-carac-mod ${m>=0?'pos':'neg'}">${modStr(m)}</div>
      ${bonus?`<div class="cs-carac-bonus">Base ${base} +${bonus}</div>`:`<div class="cs-carac-bonus">${st.label}</div>`}
    </div>`;
  });
  html += `</div></div>`;

  // PV/PM base editables
  html += `<div class="cs-section">
    <div class="cs-section-title">⚙️ Base PV & PM
      ${canEdit?'<span class="cs-hint">cliquer pour modifier — les max sont recalculés</span>':''}
    </div>
    <div class="cs-base-grid">
      <div class="cs-base-card">
        <div class="cs-base-label">PV Base (niv.1)</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Cliquer pour modifier"`:''}>
          ${c.pvBase||10}
        </div>
        <div class="cs-base-formula">PV max actuel : ${calcPVMax(c)}</div>
        <div class="cs-base-sub">PV max = Base + Mod(Co) × (Niv−1)</div>
      </div>
      <div class="cs-base-card">
        <div class="cs-base-label">PM Base (niv.1)</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Cliquer pour modifier"`:''}>
          ${c.pmBase||10}
        </div>
        <div class="cs-base-formula">PM max actuel : ${calcPMMax(c)}</div>
        <div class="cs-base-sub">PM max = Base + Mod(Sa) × (Niv−1)</div>
      </div>
      <div class="cs-base-card">
        <div class="cs-base-label">Palier XP suivant</div>
        <div class="cs-base-val ${canEdit?'cs-editable':''}"
             ${canEdit?`onclick="inlineEditNum('${c.id}','palier',this,1,99999)" title="Cliquer pour modifier"`:''}>
          ${c.palier||100}
        </div>
        <div class="cs-base-sub">XP actuel : ${c.exp||0}</div>
      </div>
    </div>
  </div>`;

  // Set bonus
  if (c.setBonusActif) {
    html += `<div class="cs-section">
      <div class="cs-section-title">✨ Bonus de Set</div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-style:italic">${c.setBonusActif}</div>
    </div>`;
  }
  return html;
}

// ══════════════════════════════════════════════
// TAB : COMBAT
// ══════════════════════════════════════════════
function renderCharEquip(c, canEdit) {
  const equip = c.equipement||{};
  const weaponSlots = ['Main principale','Main secondaire'];
  const armorSlots = ['Tête','Torse','Bottes','Amulette','Anneau','Objet magique'];
  const s = c.stats||{}; const sb = c.statsBonus||{};
  const fo = (s.force||10)+(sb.force||0);
  const dex = (s.dexterite||8)+(sb.dexterite||0);

  let html = `<div class="cs-section">
    <div class="cs-section-title">⚔️ Armes
      ${canEdit?'<span class="cs-hint">cliquer sur ✏️ pour modifier</span>':''}
    </div>`;

  weaponSlots.forEach(slot => {
    const item = equip[slot]||{};
    const statVal = item.statAttaque==='dexterite'?dex:fo;
    const m = modStr(Math.floor((statVal-10)/2));
    html += `<div class="cs-weapon-row">
      <div class="cs-weapon-slot-label">${slot}</div>
      <div class="cs-weapon-body">
        ${item.nom
          ? `<div class="cs-weapon-name">${item.nom}</div>
             ${item.trait?`<div class="cs-weapon-trait">${item.trait}</div>`:''}
             <div class="cs-weapon-stats">
               <span class="cs-ws"><span class="cs-ws-label">Toucher</span><span class="cs-ws-val gold">1d20 ${m}</span></span>
               <span class="cs-ws"><span class="cs-ws-label">Dégâts</span><span class="cs-ws-val red">${item.degats||'—'} ${m}</span></span>
               <span class="cs-ws"><span class="cs-ws-label">Type</span><span class="cs-ws-val">${item.typeArme||'—'}</span></span>
               ${item.portee?`<span class="cs-ws"><span class="cs-ws-label">Portée</span><span class="cs-ws-val">${item.portee}</span></span>`:''}
               ${item.particularite?`<span class="cs-ws cs-ws-wide"><span class="cs-ws-label">Particularité</span><span class="cs-ws-val muted">${item.particularite}</span></span>`:''}
             </div>`
          : `<div class="cs-weapon-empty">— Vide —</div>`}
      </div>
      ${canEdit?`<button class="cs-equip-btn" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
    </div>`;
  });

  html += `<div class="cs-combat-info">
    🎲 Critique : Maximum des dés + relance les dés de dégâts.
  </div></div>`;

  // Actions
  html += `<div class="cs-section">
    <div class="cs-section-title">📋 Actions</div>
    <div class="cs-actions-grid">
      ${[
        ['⚡','Action','Frappe / Sort / Compétence'],
        ['🏃','Action','Courir (×2 vitesse)'],
        ['🛡️','Action','Se désengager'],
        ['👁️','Action','Se cacher'],
        ['🤝','Action','Aider (retire état allié)'],
        ['🔄','Action','Changer d\'arme'],
      ].map(([icon,type,desc])=>`
        <div class="cs-action-chip">
          <span class="cs-action-icon">${icon}</span>
          <div><div class="cs-action-type">${type}</div><div class="cs-action-desc">${desc}</div></div>
        </div>`).join('')}
    </div>
    <div class="cs-action-footer">1 Action + 1 Action Bonus + 1 Réaction + Déplacement par tour</div>
  </div>`;

  // Armures
  html += `<div class="cs-section">
    <div class="cs-section-title">🛡️ Armures & Accessoires</div>
    <div class="cs-armor-grid">`;
  armorSlots.forEach(slot => {
    const item = equip[slot]||{};
    const bonuses = ['fo','dex','in','sa','co','ch','ca'].filter(k=>item[k]);
    html += `<div class="cs-armor-card ${item.nom?'equipped':''}">
      <div class="cs-armor-slot">${slot}</div>
      <div class="cs-armor-name">${item.nom||'—'}</div>
      ${item.trait?`<div class="cs-armor-trait">${item.trait}</div>`:''}
      ${bonuses.length?`<div class="cs-armor-bonuses">${bonuses.map(k=>`<span class="badge badge-gold" style="font-size:0.6rem">${k.toUpperCase()} ${item[k]>0?'+'+item[k]:item[k]}</span>`).join('')}</div>`:''}
      ${canEdit?`<button class="cs-equip-btn-sm" onclick="editEquipSlot('${slot}')">✏️</button>`:''}
    </div>`;
  });

  const totals = {fo:0,dex:0,in:0,sa:0,co:0,ch:0,ca:0};
  Object.values(equip).forEach(it=>Object.keys(totals).forEach(k=>{totals[k]+=(it[k]||0);}));
  const totalStr = Object.entries(totals).filter(([,v])=>v!==0).map(([k,v])=>`${k.toUpperCase()} ${v>0?'+'+v:v}`).join(' · ');
  if (totalStr) html += `<div class="cs-bonus-total">Bonus total : ${totalStr}</div>`;
  html += `</div></div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : SORTS
// ══════════════════════════════════════════════
function renderCharDeck(c, canEdit) {
  const sorts = c.deck_sorts||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">✨ Sorts & Compétences
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addSort()">+ Nouveau sort</button>`:''}
    </div>
    <div class="cs-sort-info">
      <strong>Système maison</strong> — Noyau + Runes. Coût PM = 2 × nombre de runes.
    </div>`;

  if (sorts.length===0) {
    html += `<div class="cs-empty">🔮 Aucun sort — commence par choisir un noyau élémentaire</div>`;
  } else {
    sorts.forEach((s,i) => {
      html += `<div class="cs-sort-card ${s.actif?'active':''}">
        <div class="cs-sort-header">
          <div class="cs-sort-toggle-wrap">
            <div class="toggle ${s.actif?'on':''}" onclick="${canEdit?`toggleSort(${i})`:''}" title="${s.actif?'Désactiver':'Activer'}"></div>
            <div>
              <div class="cs-sort-name">${s.nom||'Sort sans nom'}</div>
              <div class="cs-sort-badges">
                ${s.noyau?`<span class="badge badge-gold" style="font-size:0.65rem">${s.noyau}</span>`:''}
                ${(s.runes||[]).map(r=>`<span class="badge badge-blue" style="font-size:0.65rem">${r}</span>`).join('')}
              </div>
            </div>
          </div>
          <div class="cs-sort-right">
            <span class="badge badge-blue">${s.pm||0} PM</span>
            ${canEdit?`<button class="btn-icon" onclick="editSort(${i})">✏️</button>
                       <button class="btn-icon" onclick="deleteSort(${i})">🗑️</button>`:''}
          </div>
        </div>
        ${s.effet||s.degats||s.soin?`<div class="cs-sort-body">
          ${s.effet?`<div class="cs-sort-effet">${s.effet}</div>`:''}
          ${s.degats?`<div class="cs-sort-degats">⚔️ ${s.degats}</div>`:''}
          ${s.soin?`<div class="cs-sort-soin">💚 Soin : ${s.soin}</div>`:''}
        </div>`:''}
      </div>`;
    });
  }
  html += `<div class="cs-sort-footer">✨ Magie à mains nues : +2 PM, pas d'effet de set.</div>`;
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : INVENTAIRE
// ══════════════════════════════════════════════
function renderCharInventaire(c, canEdit) {
  const inv = c.inventaire||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">🎒 Inventaire
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addInvItem()">+ Ajouter</button>`:''}
    </div>`;

  if (inv.length===0) {
    html += `<div class="cs-empty">Inventaire vide.</div>`;
  } else {
    html += `<div class="cs-inv-list">`;
    inv.forEach((item,i) => {
      html += `<div class="cs-inv-row">
        <div class="cs-inv-main">
          <div class="cs-inv-name">${item.nom||'?'}</div>
          ${item.description?`<div class="cs-inv-desc">${item.description}</div>`:''}
        </div>
        <div class="cs-inv-meta">
          ${item.type?`<span class="badge badge-gold" style="font-size:0.68rem">${item.type}</span>`:''}
          <span class="cs-inv-qte">×${item.qte||1}</span>
          ${canEdit?`<button class="btn-icon" onclick="editInvItem(${i})">✏️</button>
                     <button class="btn-icon" onclick="deleteInvItem(${i})">🗑️</button>`:''}
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : QUÊTES
// ══════════════════════════════════════════════
function renderCharQuetes(c, canEdit) {
  const quetes = c.quetes||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📜 Journal de Quête
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addQuete()">+ Ajouter</button>`:''}
    </div>`;

  if (quetes.length===0) {
    html += `<div class="cs-empty">Aucune quête.</div>`;
  } else {
    quetes.forEach((q,i) => {
      html += `<div class="cs-quest-row">
        <div class="cs-quest-info">
          <div class="cs-quest-name">${q.nom||'?'}</div>
          <div class="cs-quest-meta">${q.type||''} ${q.description?'— '+q.description:''}</div>
        </div>
        <div class="cs-quest-right">
          <span class="badge badge-${q.valide?'green':'blue'}">${q.valide?'Validée':'En cours'}</span>
          ${canEdit?`<button class="btn-icon" onclick="toggleQuete(${i})" title="${q.valide?'Rouvrir':'Valider'}">✔️</button>
                     <button class="btn-icon" onclick="deleteQuete(${i})">🗑️</button>`:''}
        </div>
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// TAB : NOTES
// ══════════════════════════════════════════════
function renderCharNotes(c, canEdit) {
  return `<div class="cs-section">
    <div class="cs-section-title">📝 Notes de Session</div>
    ${canEdit
      ? `<textarea class="input-field" id="char-notes-area" rows="12" placeholder="Tes notes personnelles...">${c.notes||''}</textarea>
         <button class="btn btn-gold btn-sm" style="margin-top:0.8rem" onclick="saveNotes()">💾 Enregistrer</button>`
      : `<div style="font-size:0.88rem;line-height:1.8;white-space:pre-wrap;color:var(--text-muted)">${c.notes||'Aucune note.'}</div>`
    }
  </div>`;
}

// ══════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════
async function adjustStat(stat, delta, charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  const base = stat==='pvActuel'?'pvBase':'pmBase';
  const maxVal = stat==='pvActuel' ? calcPVMax(c) : calcPMMax(c);
  const cur = c[stat]??maxVal;
  const newVal = Math.max(0, Math.min(maxVal, cur+delta));
  c[stat] = newVal;
  await updateInCol('characters', c.id, {[stat]: newVal});

  const p = pct(newVal, maxVal);
  if (stat==='pvActuel') {
    const valEl=document.getElementById('pv-val'), barEl=document.getElementById('pv-bar');
    if(valEl){valEl.textContent=newVal;valEl.style.color=p<25?'var(--crimson-light)':p<50?'#f59e0b':'var(--green)';}
    if(barEl){barEl.style.width=p+'%';barEl.className='cs-bar-fill cs-bar-hp-fill '+(p>50?'high':p>25?'mid':'');}
  } else {
    const valEl=document.getElementById('pm-val'), barEl=document.getElementById('pm-bar');
    if(valEl) valEl.textContent=newVal;
    if(barEl) barEl.style.width=p+'%';
  }
}

async function saveNotes() {
  const c = STATE.activeChar; if(!c) return;
  const notes = document.getElementById('char-notes-area')?.value||'';
  c.notes = notes;
  await updateInCol('characters', c.id, {notes});
  showNotif('Notes sauvegardées !','success');
}

async function toggleSort(idx) {
  const c=STATE.activeChar; if(!c) return;
  const sorts=c.deck_sorts||[];
  sorts[idx].actif=!sorts[idx].actif;
  c.deck_sorts=sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  renderCharSheet(c,'sorts');
}

async function toggleQuete(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.quetes[idx].valide=!c.quetes[idx].valide;
  await updateInCol('characters',c.id,{quetes:c.quetes});
  renderCharSheet(c,'quetes');
}

async function deleteQuete(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.quetes.splice(idx,1);
  await updateInCol('characters',c.id,{quetes:c.quetes});
  renderCharSheet(c,'quetes');
}

async function deleteSort(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.deck_sorts.splice(idx,1);
  await updateInCol('characters',c.id,{deck_sorts:c.deck_sorts});
  renderCharSheet(c,'sorts');
}

async function deleteInvItem(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.inventaire.splice(idx,1);
  await updateInCol('characters',c.id,{inventaire:c.inventaire});
  renderCharSheet(c,'inventaire');
}

async function deleteChar(id) {
  if (!confirm('Supprimer ce personnage ?')) return;
  await deleteFromCol('characters',id);
  showNotif('Personnage supprimé.','success');
  PAGES.characters();
}

async function createNewChar() {
  const data = {
    uid: STATE.user.uid,
    ownerPseudo: STATE.profile?.pseudo||'?',
    nom:'Nouveau personnage', titre:'', titres:[],
    niveau:1, or:0,
    pvBase:10, pvActuel:10, pmBase:10, pmActuel:10,
    exp:0, palier:100,
    stats:{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10},
    statsBonus:{},
    equipement:{}, inventaire:[], deck_sorts:[], quetes:[], notes:'',
  };
  await addToCol('characters', data);
  showNotif('Personnage créé !','success');
  PAGES.characters();
}

// Gestion des titres via modal compact
function manageTitres(charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  window._editTitres = [...(c.titres||[])];
  const render = () => window._editTitres.map((t,i)=>
    `<span class="cs-titre-chip">${t}<button onclick="removeTitre(${i})">✕</button></span>`
  ).join('');
  openModal('🏅 Titres', `
    <div id="titres-list" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.8rem;min-height:2rem">${render()}</div>
    <div style="display:flex;gap:0.5rem">
      <input class="input-field" id="ei-titre-new" placeholder="Nouveau titre..." style="flex:1" onkeydown="if(event.key==='Enter')addTitre()">
      <button class="btn btn-outline btn-sm" onclick="addTitre()">+ Ajouter</button>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveTitres('${charId}')">Enregistrer</button>
  `);
}

function addTitre() {
  const input = document.getElementById('ei-titre-new');
  const val = input?.value.trim();
  if (!val) return;
  window._editTitres = window._editTitres||[];
  window._editTitres.push(val);
  input.value='';
  _refreshTitresList();
}

function removeTitre(idx) {
  window._editTitres.splice(idx,1);
  _refreshTitresList();
}

function _refreshTitresList() {
  const list = document.getElementById('titres-list');
  if (list) list.innerHTML = window._editTitres.map((t,i)=>
    `<span class="cs-titre-chip">${t}<button onclick="removeTitre(${i})">✕</button></span>`
  ).join('');
}

async function saveTitres(charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  c.titres = window._editTitres||[];
  await updateInCol('characters', charId, {titres: c.titres});
  closeModal();
  renderCharSheet(c, window._currentCharTab);
  showNotif('Titres mis à jour !','success');
}

// Sorts
function addSort() { openSortModal(-1, {}); }
function editSort(idx) { openSortModal(idx, (STATE.activeChar?.deck_sorts||[])[idx]); }

function openSortModal(idx, s) {
  const NOYAUX = ['Feu 🔥','Eau 💧','Terre 🪨','Vent 🌬️','Ombre 🌑','Lumière ✨','Physique 💪'];
  const RUNES = [
    {nom:'Puissance',effet:'+ 1 dé de dégâts'},
    {nom:'Protection',effet:'+2 CA (2 tr) ou +1 dé soin'},
    {nom:'Amplification',effet:'Zone +3m'},
    {nom:'Enchantement',effet:'(AB) Élément sur équip. allié 2 tr'},
    {nom:'Affliction',effet:'Élément + État sur équip. ennemi 2 tr'},
    {nom:'Invocation',effet:'Créature liée. 10 PV, CA 10'},
    {nom:'Dispersion',effet:'+1 cible'},
    {nom:'Lacération',effet:'CA cible −1 (−2 max, −4 élites)'},
    {nom:'Chance',effet:'RC 19–20. Critique aussi max'},
    {nom:'Durée',effet:'+2 tours'},
    {nom:'Concentration',effet:'Actif hors tour. JS Sa DD11'},
    {nom:'Réaction',effet:'Lance hors de son tour'},
  ];
  const runesSel = s?.runes||[];
  openModal(idx>=0?'✏️ Modifier le Sort':'✨ Nouveau Sort', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu..."></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Noyau (2 PM)</label>
        <select class="input-field" id="s-noyau" onchange="updateSortPM()">
          <option value="">— Choisir —</option>
          ${NOYAUX.map(n=>`<option value="${n}" ${s?.noyau===n?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>PM (auto)</label>
        <input type="number" class="input-field" id="s-pm" value="${s?.pm||2}" readonly style="opacity:0.7">
      </div>
    </div>
    <div class="form-group">
      <label>Runes (+2 PM chacune)</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.25rem;max-height:200px;overflow-y:auto;padding:0.4rem;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px">
        ${RUNES.map(r=>`<div onclick="toggleRune(this,'${r.nom}')" class="cs-rune-chip ${runesSel.includes(r.nom)?'selected':''}">
          <span class="cs-rune-name">${r.nom}</span>
          <span class="cs-rune-effet">${r.effet}</span>
        </div>`).join('')}
      </div>
      <input type="hidden" id="s-runes" value="${runesSel.join(',')}">
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts</label><input class="input-field" id="s-degats" value="${s?.degats||''}" placeholder="= arme, +1D4..."></div>
      <div class="form-group"><label>Soin</label><input class="input-field" id="s-soin" value="${s?.soin||''}" placeholder="1d4..."></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="s-effet" rows="3">${s?.effet||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="saveSort(${idx})">Enregistrer</button>
  `);
}

function toggleRune(el, rune) {
  const input = document.getElementById('s-runes');
  let runes = input.value ? input.value.split(',').filter(Boolean) : [];
  if (runes.includes(rune)) { runes=runes.filter(r=>r!==rune); el.classList.remove('selected'); }
  else { runes.push(rune); el.classList.add('selected'); }
  input.value = runes.join(',');
  updateSortPM();
}

function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const runes = (document.getElementById('s-runes')?.value||'').split(',').filter(Boolean);
  const pmEl = document.getElementById('s-pm');
  if (pmEl) pmEl.value = ((noyau?1:0)+runes.length)*2 || 2;
}

async function saveSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  const sorts = c.deck_sorts||[];
  const noyau = document.getElementById('s-noyau')?.value||'';
  const runes = (document.getElementById('s-runes')?.value||'').split(',').filter(Boolean);
  const newSort = {
    nom: document.getElementById('s-nom')?.value||'Sort',
    pm: ((noyau?1:0)+runes.length)*2||2,
    noyau, runes,
    degats: document.getElementById('s-degats')?.value||'',
    soin: document.getElementById('s-soin')?.value||'',
    effet: document.getElementById('s-effet')?.value||'',
    actif: idx>=0 ? sorts[idx].actif : false,
  };
  if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
  c.deck_sorts=sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  closeModal();
  showNotif(`Sort enregistré — ${newSort.pm} PM`,'success');
  renderCharSheet(c,'sorts');
}

// Équipement
function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');
  openModal(`${isWeapon?'⚔️':'🛡️'} ${slot}`, `
    <div class="form-group"><label>Nom</label><input class="input-field" id="eq-nom" value="${item.nom||''}" placeholder="${isWeapon?'Épée longue...':'Heaume de fer...'}"></div>
    <div class="form-group"><label>Trait</label><input class="input-field" id="eq-trait" value="${item.trait||''}" placeholder="Lourd, Polyvalent..."></div>
    ${isWeapon?`
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts</label><input class="input-field" id="eq-degats" value="${item.degats||'1D10'}"></div>
      <div class="form-group"><label>Stat attaque</label>
        <select class="input-field" id="eq-stat-attaque">
          <option value="force" ${(item.statAttaque||'force')==='force'?'selected':''}>Force</option>
          <option value="dexterite" ${item.statAttaque==='dexterite'?'selected':''}>Dextérité</option>
          <option value="intelligence" ${item.statAttaque==='intelligence'?'selected':''}>Intelligence</option>
        </select>
      </div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="eq-type-arme" value="${item.typeArme||''}"></div>
      <div class="form-group"><label>Portée</label><input class="input-field" id="eq-portee" value="${item.portee||''}"></div>
    </div>
    <div class="form-group"><label>Particularité</label><input class="input-field" id="eq-particularite" value="${item.particularite||''}"></div>
    `:`
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
  if (slot.startsWith('Main')) {
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
  const bonus={force:0,dexterite:0,intelligence:0,sagesse:0,constitution:0,charisme:0};
  Object.values(equip).forEach(it=>{
    bonus.force+=(it.fo||0); bonus.dexterite+=(it.dex||0); bonus.intelligence+=(it.in||0);
    bonus.sagesse+=(it.sa||0); bonus.constitution+=(it.co||0); bonus.charisme+=(it.ch||0);
  });
  c.statsBonus = bonus;
  await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
  closeModal();
  showNotif('Équipement mis à jour !','success');
  renderCharSheet(c,'combat');
}

async function clearEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equip = c.equipement||{};
  delete equip[slot];
  c.equipement = equip;
  const bonus={force:0,dexterite:0,intelligence:0,sagesse:0,constitution:0,charisme:0};
  Object.values(equip).forEach(it=>{
    bonus.force+=(it.fo||0); bonus.dexterite+=(it.dex||0); bonus.intelligence+=(it.in||0);
    bonus.sagesse+=(it.sa||0); bonus.constitution+=(it.co||0); bonus.charisme+=(it.ch||0);
  });
  c.statsBonus = bonus;
  await updateInCol('characters', c.id, {equipement:equip, statsBonus:bonus});
  closeModal();
  showNotif('Emplacement libéré.','success');
  renderCharSheet(c,'combat');
}

// Inventaire
function addInvItem() {
  openModal('🎒 Ajouter un objet', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" placeholder="Potion de soin..."></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" placeholder="Consommable..."></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="1"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="inv-desc" rows="3" placeholder="(Action) Rend 10 PV..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInvItem(-1)">Ajouter</button>
  `);
}

function editInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.inventaire||[])[idx];
  openModal('✏️ Modifier', `
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
  closeModal();
  showNotif('Inventaire mis à jour !','success');
  renderCharSheet(c,'inventaire');
}

// Quêtes
function addQuete() {
  openModal('📜 Ajouter une quête', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="q-nom" placeholder="La Crypte Maudite..."></div>
    <div class="form-group"><label>Type</label><input class="input-field" id="q-type" placeholder="Principale, Secondaire..."></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="q-desc" rows="3" placeholder="Objectif..."></textarea></div>
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
  closeModal();
  showNotif('Quête ajoutée !','success');
  renderCharSheet(c,'quetes');
}

// Photo
function deleteCharPhoto(id) {
  const c = STATE.characters.find(x=>x.id===id)||STATE.activeChar;
  if (!c) return;
  c.photo=null; c.photoZoom=1; c.photoX=0; c.photoY=0;
  updateInCol('characters',id,{photo:null,photoZoom:1,photoX:0,photoY:0});
  renderCharSheet(c, window._currentCharTab);
}

// ══════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════
Object.assign(window, {
  selectChar, filterAdminChars,
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  renderCharSheet, showCharTab,
  renderCharCarac, renderCharEquip, renderCharDeck,
  renderCharInventaire, renderCharQuetes, renderCharNotes,
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete, deleteSort, deleteInvItem, deleteChar,
  createNewChar,
  inlineEditText, inlineEditNum, inlineEditStat,
  manageTitres, addTitre, removeTitre, saveTitres,
  addSort, editSort, openSortModal, toggleRune, updateSortPM, saveSort,
  editEquipSlot, saveEquipSlot, clearEquipSlot,
  addInvItem, editInvItem, saveInvItem,
  addQuete, saveQuete,
  deleteCharPhoto,
});
