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
  const total = Math.min(22, base+bonus); // modificateur plafonné à +6 (score max 22)
  return Math.floor((total-10)/2);
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
  // Si modCo = -1 au niv 1, le personnage a pvBase - 1
  const progression = modCo > 0 ? Math.floor(modCo*(niv-1)) : modCo*(niv-1);
  const baseBonus = modCo === -1 ? -1 : 0; // -1 PV base si mod Co = -1
  return (c.pvBase||10) + baseBonus + progression;
}
function calcPMMax(c) {
  const modSa = getMod(c,'sagesse');
  const niv = c.niveau||1;
  // Si modSa = -1 au niv 1, le personnage a pmBase - 1
  const progression = modSa > 0 ? Math.floor(modSa*(niv-1)) : modSa*(niv-1);
  const baseBonus = modSa === -1 ? -1 : 0; // -1 PM base si mod Sa = -1
  return (c.pmBase||10) + baseBonus + progression;
}

function calcOr(c) {
  const compte = c.compte||{recettes:[],depenses:[]};
  const totalR = (compte.recettes||[]).reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = (compte.depenses||[]).reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  return Math.round((totalR - totalD) * 100) / 100;
}

function normalizeArmorSetType(type = '') {
  const raw = String(type || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('lég') || raw.startsWith('leg')) return 'leger';
  if (raw.startsWith('inter')) return 'inter';
  if (raw.startsWith('lourd')) return 'lourd';
  return '';
}

function getArmorSetInfo(equip = {}) {
  const headType  = normalizeArmorSetType(equip?.['Tête']?.typeArmure);
  const torsoType = normalizeArmorSetType(equip?.['Torse']?.typeArmure);
  const feetType  = normalizeArmorSetType(equip?.['Bottes']?.typeArmure);

  if (!headType || !torsoType || !feetType) return null;
  if (!(headType === torsoType && torsoType === feetType)) return null;

  const SET_META = {
    leger: {
      key: 'leger',
      badge: 'Set léger',
      title: 'Effet de set léger',
      description: 'Tête + Torse + Bottes en armure légère.'
    },
    inter: {
      key: 'inter',
      badge: 'Set intermédiaire',
      title: 'Effet de set intermédiaire',
      description: 'Tête + Torse + Bottes en armure intermédiaire.'
    },
    lourd: {
      key: 'lourd',
      badge: 'Set lourd',
      title: 'Effet de set lourd',
      description: 'Tête + Torse + Bottes en armure lourde.'
    },
  };

  return SET_META[headType] || null;
}


function calcPalier(niveau) {
  return 100 * niveau * niveau; // 100, 400, 900, 1600...
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
  const xpPct = pct(c.exp||0, calcPalier(c.niveau||1));
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
           ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Modifier"`:''}
      >${total}</div>
      <div class="cs-carac-mod ${mClass}">${mStr}</div>
    </div>`;
  }).join('');

  area.innerHTML = `
<div class="cs-shell">

  <!-- ═══ LIGNE HAUTE : 2 blocs côte à côte ═══ -->
  <div class="cs-top">

    <!-- BLOC IDENTITÉ + VITAUX + CARAC -->
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

      <!-- Niveau + Or -->
      <div class="cs-meta-row">
        <span class="cs-level-badge">
          ${canEdit
            ? `<span class="cs-editable-num" onclick="inlineEditNum('${c.id}','niveau',this,1,20)" title="Modifier">Niv. ${c.niveau||1}</span>`
            : `Niv. ${c.niveau||1}`}
        </span>
        <span class="cs-or" title="Solde du Livret de Compte">💰 ${calcOr(c)} or</span>
      </div>

      <!-- Bloc XP explicite -->
      <div class="cs-xp-block">
        <div class="cs-xp-header">
          <span class="cs-xp-title">✨ Expérience</span>
          <span class="cs-xp-palier">Palier : ${calcPalier(c.niveau||1)} XP</span>
        </div>
        <div class="cs-xp-bar-wrap">
          <div class="cs-xp-bar" id="xp-bar-bg">
            <div class="cs-xp-fill" id="xp-bar-fill" style="width:${xpPct}%"></div>
          </div>
          <span class="cs-xp-pct" id="xp-pct">${xpPct}%</span>
        </div>
        ${canEdit
          ? `<div class="cs-xp-input-row">
               <label class="cs-xp-input-label">XP actuel</label>
               <input type="number" class="cs-xp-input cs-inline-num"
                      id="xp-direct-input"
                      value="${c.exp||0}" min="0"
                      max="${calcPalier(c.niveau||1)}"
                      onchange="saveXpDirect('${c.id}',this)"
                      oninput="previewXpBar(this,${calcPalier(c.niveau||1)})">
             </div>`
          : `<div class="cs-xp-readonly">${c.exp||0} / ${calcPalier(c.niveau||1)} XP</div>`
        }
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

    <!-- BLOC DROIT : Caractéristiques compactes -->
    <div class="cs-carac-panel">
      <div class="cs-carac-panel-title">
        Caractéristiques
        ${canEdit?'<span class="cs-hint">cliquer pour modifier</span>':''}
      </div>
      <div class="cs-carac-grid">
        ${caracHtml}
      </div>
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
          <div class="cs-base-chip-val">${calcPalier(c.niveau||1)}</div>
          <div class="cs-base-chip-sub">100 × niv²</div>
        </div>
      </div>
    </div><!-- /cs-carac-panel -->

  </div><!-- /cs-top -->

  <!-- ═══ COLONNE DROITE : Onglets + Contenu ═══ -->
  <div class="cs-right-col">
    <div class="cs-tabs" id="char-tabs">
      ${['combat','sorts','inventaire','quetes','compte','notes'].map((tab,i)=>{
        const labels = ['Combat','Sorts & Runes','Inventaire','Quêtes','Compte','Notes'];
        return `<button class="cs-tab ${currentTab===tab?'active':''}" onclick="showCharTab('${tab}',this)">${labels[i]}</button>`;
      }).join('')}
    </div>
    <div id="char-tab-content" class="cs-tab-body"></div>
  </div>

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
    compte:     ()=>renderCharCompte(c,canEdit),
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
  const STATS_TAB = [
    {key:'force',label:'Force',abbr:'Fo'},
    {key:'dexterite',label:'Dextérité',abbr:'Dex'},
    {key:'constitution',label:'Constitution',abbr:'Co'},
    {key:'intelligence',label:'Intelligence',abbr:'Int'},
    {key:'sagesse',label:'Sagesse',abbr:'Sag'},
    {key:'charisme',label:'Charisme',abbr:'Cha'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  // Onglet Carac : version détaillée avec base + bonus équipement
  let html = `<div class="cs-section">
    <div class="cs-section-title">📊 Caractéristiques
      ${canEdit?'<span class="cs-hint">cliquer sur la valeur pour modifier</span>':''}
    </div>
    <div class="cs-carac-detail-grid">`;

  STATS_TAB.forEach(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    html += `<div class="cs-carac-detail-row">
      <span class="cs-carac-detail-label">${st.label}</span>
      <span class="cs-carac-detail-base">${base}</span>
      ${bonus?`<span class="cs-carac-detail-bonus">+${bonus} éq.</span>`:'<span class="cs-carac-detail-bonus cs-carac-detail-bonus--empty"></span>'}
      <span class="cs-carac-detail-total ${canEdit?'cs-editable':''}"
            ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Modifier"`:''}>
        ${total}
      </span>
      <span class="cs-carac-detail-mod ${m>=0?'pos':'neg'}">${modStr(m)}</span>
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
  const armorSetInfo = getArmorSetInfo(c.equipement || {});
  if (armorSetInfo) {
    html += `<div class="cs-section">
      <div class="cs-section-title">✨ Bonus de Set</div>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
        <span class="badge badge-gold" style="font-size:.72rem">${armorSetInfo.badge}</span>
        <span style="font-size:0.85rem;color:var(--text-muted);font-style:italic">${armorSetInfo.description}</span>
      </div>
    </div>`;
  }
  return html;
}

// ══════════════════════════════════════════════
// TAB : COMBAT
// ══════════════════════════════════════════════
function renderCharEquip(c, canEdit) {
  const equip = c.equipement||{};
  const armorSetInfo = getArmorSetInfo(equip);
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
    ${armorSetInfo ? `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap;
        margin:.2rem 0 1rem;padding:.8rem .95rem;border:1px solid rgba(232,184,75,.22);border-radius:14px;
        background:linear-gradient(180deg, rgba(232,184,75,.08), rgba(232,184,75,.03));">
        <div style="display:flex;flex-direction:column;gap:.2rem">
          <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
            <span class="badge badge-gold" style="font-size:.68rem">${armorSetInfo.badge}</span>
            <span style="font-size:.82rem;font-weight:700;color:var(--text)">${armorSetInfo.title}</span>
          </div>
          <div style="font-size:.78rem;color:var(--text-muted)">${armorSetInfo.description}</div>
        </div>
        <div style="font-size:.72rem;color:var(--text-dim)">Tête + Torse + Bottes</div>
      </div>` : ''}
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
// ── Drag and Drop sorts ──────────────────────
let _dragSortIdx = null;

function sortDragStart(e, idx) {
  _dragSortIdx = idx;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}
function sortDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cs-sort-row').forEach(el => {
    el.classList.remove('cs-drop-before', 'cs-drop-after');
  });
  const rect = e.currentTarget.getBoundingClientRect();
  const mid  = rect.top + rect.height / 2;
  if (e.clientY < mid) {
    e.currentTarget.classList.add('cs-drop-before');
  } else {
    e.currentTarget.classList.add('cs-drop-after');
  }
}
function sortDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.cs-sort-row').forEach(el => {
    el.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  });
}
async function sortDrop(e, toIdx) {
  e.preventDefault();
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const insertAfter = e.clientY >= rect.top + rect.height / 2;
  const actualIdx   = insertAfter ? toIdx + 1 : toIdx;
  card.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  document.querySelectorAll('.cs-sort-row').forEach(el =>
    el.classList.remove('cs-drop-before', 'cs-drop-after'));
  const fromIdx = _dragSortIdx;
  _dragSortIdx = null;
  if (fromIdx === null) return;
  const c = STATE.activeChar; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  if (fromIdx === actualIdx || fromIdx === actualIdx - 1) return;
  const [moved] = sorts.splice(fromIdx, 1);
  const insertAt = actualIdx > fromIdx ? actualIdx - 1 : actualIdx;
  sorts.splice(insertAt, 0, moved);
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, {deck_sorts: sorts});
  renderCharSheet(c, 'sorts');
}


function renderCharDeck(c, canEdit) {
  const sorts = c.deck_sorts||[];
  const openIdx = window._openSortIdx ?? null;

  let html = `<div class="cs-section">
    <div class="cs-section-title">✨ Sorts & Compétences
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addSort()">+ Nouveau sort</button>`:''}
    </div>
    <div class="cs-sort-info">
      <strong>Système maison</strong> — Noyau + Runes. PM = 2 × runes.
      <span style="color:var(--text-dim);font-size:0.7rem;margin-left:0.5rem">✨ Mains nues : +2 PM, pas d'effet de set.</span>
    </div>`;

  if (sorts.length===0) {
    html += `<div class="cs-empty">🔮 Aucun sort créé</div>`;
  } else {
    html += `<div class="cs-sort-list">`;
    sorts.forEach((s,i) => {
      const isOpen    = openIdx === i;
      const runesAll  = s.runes||[];
      // Aperçu rapide : concaténer effet + dégâts + soin sur une ligne
      const apercu = [
        s.effet   ? s.effet   : null,
        s.degats  ? `⚔️ ${s.degats}` : null,
        s.soin    ? `💚 ${s.soin}`   : null,
      ].filter(Boolean).join(' · ');

      html += `<div class="cs-sort-row ${s.actif?'actif':''}"
        draggable="true"
        data-sort-idx="${i}"
        ondragstart="sortDragStart(event,${i})"
        ondragover="sortDragOver(event)"
        ondrop="sortDrop(event,${i})"
        ondragend="sortDragEnd(event)">
        <div class="cs-sort-row-main" onclick="toggleSortDetail(${i})" style="cursor:pointer">
          <div class="toggle ${s.actif?'on':''}"
               onclick="event.stopPropagation();${canEdit?`toggleSort(${i})`:''}"
               title="${s.actif?'Désactiver':'Activer'}"></div>
          <div class="cs-sort-row-info">
            <div class="cs-sort-row-top">
              <span class="cs-sort-row-name">${s.nom||'Sans nom'}</span>
              <div class="cs-sort-row-badges">
                ${s.noyau?`<span class="cs-sort-badge gold">${s.noyau}</span>`:''}
                ${runesAll.slice(0,3).map(r=>`<span class="cs-sort-badge blue">${r}</span>`).join('')}
                ${runesAll.length>3?`<span class="cs-sort-badge muted">+${runesAll.length-3}</span>`:''}
              </div>
              <span class="cs-sort-row-pm">${s.pm||0} PM</span>
              <span class="cs-sort-row-chevron">${isOpen?'▲':'▼'}</span>
            </div>
            ${apercu?`<div class="cs-sort-row-apercu">${apercu}</div>`:''}
          </div>
          ${canEdit?`<span class="cs-sort-row-actions" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="editSort(${i})">✏️</button>
            <button class="btn-icon" onclick="deleteSort(${i})">🗑️</button>
          </span>`:''}
        </div>
        ${isOpen?`<div class="cs-sort-row-detail">
          ${s.noyau?`<div class="cs-sort-dl"><span class="cs-sort-dl-label">Noyau</span>${s.noyau}</div>`:''}
          ${runesAll.length?`<div class="cs-sort-dl"><span class="cs-sort-dl-label">Runes (${runesAll.length})</span>${runesAll.join(' · ')}</div>`:''}
          ${s.effet?`<div class="cs-sort-dl"><span class="cs-sort-dl-label">Effet</span>${s.effet}</div>`:''}
          ${s.degats?`<div class="cs-sort-dl" style="color:var(--crimson-light)"><span class="cs-sort-dl-label">Dégâts</span>⚔️ ${s.degats}</div>`:''}
          ${s.soin?`<div class="cs-sort-dl" style="color:var(--green)"><span class="cs-sort-dl-label">Soin</span>💚 ${s.soin}</div>`:''}
        </div>`:''}
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}


function toggleSortDetail(idx) {
  window._openSortIdx = window._openSortIdx === idx ? null : idx;
  _renderTab('sorts', window._currentChar, window._canEditChar);
}


function renderCharInventaire(c, canEdit) {
  const inv = c.inventaire||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">🎒 Inventaire
      <span class="cs-hint">Les objets s'ajoutent depuis la Boutique</span>
    </div>`;

  if (inv.length===0) {
    html += `<div class="cs-empty">Inventaire vide.</div>`;
  } else {
    html += `<div class="cs-inv-list">`;
    inv.forEach((item,i) => {
      const pv = item.prixVente || (item.prixAchat ? Math.round(item.prixAchat * 0.6) : 0);
      html += `<div class="cs-inv-row">
        <div class="cs-inv-main">
          <div class="cs-inv-name">${item.nom||'?'}</div>
          ${item.description?`<div class="cs-inv-desc">${item.description}</div>`:''}
        </div>
        <div class="cs-inv-meta">
          ${item.type?`<span class="badge badge-gold" style="font-size:0.68rem">${item.type}</span>`:''}
          <span class="cs-inv-qte">×${item.qte||1}</span>
          ${canEdit&&item.source==='boutique'?`<button class="cs-sell-btn" onclick="sellInvItem(${i},'${c.id}',${pv})" title="Vendre (${pv} or)">🔄 ${pv} or</button>`:''}
          ${canEdit?`<button class="btn-icon" onclick="deleteInvItem(${i})">🗑️</button>`:''}
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
  const notes = c.notesList||[];
  let html = `<div class="cs-section">
    <div class="cs-section-title">📝 Notes
      ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addNote()">+ Nouvelle note</button>`:''}
    </div>`;

  if (notes.length===0) {
    html += `<div class="cs-empty">Aucune note. Crée ta première note avec le bouton ci-dessus.</div>`;
  } else {
    notes.forEach((note, i) => {
      const isOpen = window._openNote === i;
      html += `<div class="cs-note-card">
        <div class="cs-note-header" onclick="toggleNote(${i})">
          <div class="cs-note-meta">
            <span class="cs-note-icon">📄</span>
            <span class="cs-note-title">${note.titre||'Note sans titre'}</span>
            ${note.date?`<span class="cs-note-date">${note.date}</span>`:''}
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center">
            ${canEdit?`<button class="btn-icon" onclick="event.stopPropagation();editNoteTitle(${i})" title="Renommer">✏️</button>
                       <button class="btn-icon" onclick="event.stopPropagation();deleteNote(${i})" title="Supprimer">🗑️</button>`:''}
            <span class="cs-note-chevron">${isOpen?'▲':'▼'}</span>
          </div>
        </div>
        ${isOpen?`<div class="cs-note-body">
          ${canEdit
            ? `<textarea class="input-field cs-note-textarea" id="note-area-${i}" rows="10"
                         placeholder="Contenu de la note...">${note.contenu||''}</textarea>
               <button class="btn btn-gold btn-sm" style="margin-top:0.6rem" onclick="saveNote(${i})">💾 Enregistrer</button>`
            : `<div class="cs-note-content">${(note.contenu||'Aucun contenu.').replace(/\n/g,'<br>')}</div>`
          }
        </div>`:''}
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}


function previewXpBar(input, palier) {
  const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
  const p = palier > 0 ? Math.round(val/palier*100) : 0;
  const bar = document.getElementById('xp-bar-fill');
  const pct = document.getElementById('xp-pct');
  if (bar) bar.style.width = p + '%';
  if (pct) pct.textContent = p + '%';
}

async function saveXpDirect(charId, input) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  const palier = calcPalier(c.niveau||1);
  const val = Math.max(0, Math.min(palier, parseInt(input.value)||0));
  c.exp = val;
  input.value = val;
  previewXpBar(input, palier);
  await updateInCol('characters', charId, {exp: val});
  showNotif('XP mis à jour !', 'success');
}

function toggleNote(idx) {
  window._openNote = window._openNote === idx ? null : idx;
  _renderTab('notes', window._currentChar, window._canEditChar);
}

function addNote() {
  const c = STATE.activeChar; if(!c) return;
  const notes = c.notesList||[];
  const now = new Date().toLocaleDateString('fr-FR');
  notes.push({ titre: 'Nouvelle note', contenu: '', date: now });
  c.notesList = notes;
  window._openNote = notes.length - 1;
  updateInCol('characters', c.id, {notesList: notes}).then(()=>{
    _renderTab('notes', c, window._canEditChar);
  });
}

function editNoteTitle(idx) {
  const c = STATE.activeChar; if(!c) return;
  const note = (c.notesList||[])[idx];
  if (!note) return;
  const cur = note.titre||'Sans titre';
  const val = prompt('Titre de la note :', cur);
  if (val === null) return;
  note.titre = val.trim()||cur;
  c.notesList[idx] = note;
  updateInCol('characters', c.id, {notesList: c.notesList}).then(()=>{
    _renderTab('notes', c, window._canEditChar);
    showNotif('Titre mis à jour !','success');
  });
}

async function saveNote(idx) {
  const c = STATE.activeChar; if(!c) return;
  const ta = document.getElementById(`note-area-${idx}`);
  if (!ta) return;
  c.notesList[idx].contenu = ta.value;
  await updateInCol('characters', c.id, {notesList: c.notesList});
  showNotif('Note enregistrée !','success');
}

async function deleteNote(idx) {
  const c = STATE.activeChar; if(!c) return;
  if (!confirm('Supprimer cette note ?')) return;
  c.notesList.splice(idx, 1);
  if (window._openNote >= c.notesList.length) window._openNote = null;
  await updateInCol('characters', c.id, {notesList: c.notesList});
  _renderTab('notes', c, window._canEditChar);
  showNotif('Note supprimée.','success');
}


// ══════════════════════════════════════════════
// TAB : LIVRET DE COMPTE
// ══════════════════════════════════════════════
function renderCharCompte(c, canEdit) {
  const compte = c.compte||{recettes:[], depenses:[]};
  const recettes = compte.recettes||[];
  const depenses = compte.depenses||[];

  const totalR = recettes.reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = depenses.reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  const solde = totalR - totalD;

  const renderRows = (list, type, canEdit) => {
    if (list.length===0) return `<tr><td colspan="4" class="cs-compte-empty">Aucune entrée.</td></tr>`;
    return list.map((row,i)=>`
      <tr class="cs-compte-row">
        <td>${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'date',this)">${row.date||'—'}</span>`
          : (row.date||'—')}</td>
        <td>${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'libelle',this)">${row.libelle||'—'}</span>`
          : (row.libelle||'—')}</td>
        <td class="${type==='recettes'?'cs-montant-pos':'cs-montant-neg'}">${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditCompteField('${type}',${i},'montant',this)">${row.montant||0}</span>`
          : (row.montant||0)} or</td>
        ${canEdit?`<td><button class="btn-icon" onclick="deleteCompteRow('${type}',${i})">🗑️</button></td>`:''  }
      </tr>`).join('');
  };

  return `<div class="cs-section">
    <div class="cs-section-title">💰 Livret de Compte</div>

    <!-- Solde global -->
    <div class="cs-solde-bar">
      <div class="cs-solde-item">
        <span class="cs-solde-label">Recettes</span>
        <span class="cs-solde-val pos">+${totalR} or</span>
      </div>
      <div class="cs-solde-sep">−</div>
      <div class="cs-solde-item">
        <span class="cs-solde-label">Dépenses</span>
        <span class="cs-solde-val neg">−${totalD} or</span>
      </div>
      <div class="cs-solde-sep">=</div>
      <div class="cs-solde-item cs-solde-main">
        <span class="cs-solde-label">SOLDE</span>
        <span class="cs-solde-val ${solde>=0?'pos':'neg'}">${solde>=0?'+':''}${solde} or</span>
      </div>
    </div>

    <!-- Double tableau -->
    <div class="cs-compte-grid">

      <!-- Recettes -->
      <div class="cs-compte-col">
        <div class="cs-compte-col-header">
          <span class="cs-compte-col-title pos">📈 Recettes</span>
          ${canEdit?`<button class="btn btn-gold btn-sm" onclick="addCompteRow('recettes')">+ Ajouter</button>`:''}
        </div>
        <table class="cs-compte-table">
          <thead><tr>
            <th>Date / Mission</th><th>Libellé</th><th>Montant</th>
            ${canEdit?'<th></th>':''}
          </tr></thead>
          <tbody>${renderRows(recettes,'recettes',canEdit)}</tbody>
          <tfoot><tr>
            <td colspan="${canEdit?3:2}" style="text-align:right;font-size:0.72rem;color:var(--text-muted);font-weight:700;padding-top:0.5rem">Total</td>
            <td class="cs-montant-pos" style="font-weight:800;padding-top:0.5rem">+${totalR} or</td>
            ${canEdit?'<td></td>':''}
          </tr></tfoot>
        </table>
      </div>

      <!-- Dépenses -->
      <div class="cs-compte-col">
        <div class="cs-compte-col-header">
          <span class="cs-compte-col-title neg">📉 Dépenses</span>
          ${canEdit?`<button class="btn btn-danger btn-sm" style="font-size:0.72rem" onclick="addCompteRow('depenses')">+ Ajouter</button>`:''}
        </div>
        <table class="cs-compte-table">
          <thead><tr>
            <th>Date / Mission</th><th>Libellé</th><th>Montant</th>
            ${canEdit?'<th></th>':''}
          </tr></thead>
          <tbody>${renderRows(depenses,'depenses',canEdit)}</tbody>
          <tfoot><tr>
            <td colspan="${canEdit?3:2}" style="text-align:right;font-size:0.72rem;color:var(--text-muted);font-weight:700;padding-top:0.5rem">Total</td>
            <td class="cs-montant-neg" style="font-weight:800;padding-top:0.5rem">−${totalD} or</td>
            ${canEdit?'<td></td>':''}
          </tr></tfoot>
        </table>
      </div>

    </div>
  </div>`;
}


function refreshOrDisplay(c) {
  const el = document.querySelector('.cs-or');
  if (el) el.textContent = '💰 ' + calcOr(c) + ' or';
}

function addCompteRow(type) {
  const c = STATE.activeChar; if(!c) return;
  const compte = c.compte||{recettes:[],depenses:[]};
  compte[type] = compte[type]||[];
  compte[type].push({ date: new Date().toLocaleDateString('fr-FR'), libelle: '', montant: 0 });
  c.compte = compte;
  updateInCol('characters', c.id, {compte}).then(()=>{
    _renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  });
}

async function deleteCompteRow(type, idx) {
  const c = STATE.activeChar; if(!c) return;
  (c.compte||{})[type]?.splice(idx,1);
  await updateInCol('characters', c.id, {compte: c.compte});
  _renderTab('compte', c, window._canEditChar);
  refreshOrDisplay(c);
}

function inlineEditCompteField(type, idx, field, el) {
  const c = STATE.activeChar; if(!c) return;
  const cur = el.textContent.replace(/ or$/,'').trim();
  const isNum = field === 'montant';
  const input = document.createElement('input');
  input.type = isNum ? 'number' : 'text';
  input.value = cur;
  input.className = 'cs-inline-input' + (isNum ? ' cs-inline-num' : '');
  input.style.cssText = 'width:' + (isNum ? '70px' : '120px') + ';font-size:inherit;';

  const save = async () => {
    const val = isNum ? (parseFloat(input.value)||0) : (input.value.trim()||cur);
    c.compte = c.compte||{recettes:[],depenses:[]};
    c.compte[type][idx][field] = val;
    await updateInCol('characters', c.id, {compte: c.compte});
    _renderTab('compte', c, window._canEditChar);
    refreshOrDisplay(c);
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape') input.replaceWith(el); });
  el.replaceWith(input);
  input.focus(); input.select();
}


async function sellInvItem(idx, charId, prixVente) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  const item = (c.inventaire||[])[idx];
  if (!item) return;
  if (!confirm(`Vendre "${item.nom}" pour ${prixVente} or ?`)) return;

  // 1. Retirer de l'inventaire
  c.inventaire.splice(idx, 1);

  // 2. Ajouter au livret de compte (recettes)
  const compte   = c.compte||{recettes:[],depenses:[]};
  const recettes = compte.recettes||[];
  recettes.push({
    date:    new Date().toLocaleDateString('fr-FR'),
    libelle: `Vente : ${item.nom}`,
    montant: prixVente,
  });
  c.compte = { ...compte, recettes };

  // 3. Remettre le stock en boutique (si l'article existe encore)
  if (item.itemId) {
    const { updateInCol: _upd, loadCollection: _load } = await import('./firestore.js').catch(()=>({}));
    // Approche simple : incrémenter le dispo dans Firestore
    try {
      const shopItems = await import('../data/firestore.js').then(m => m.loadCollection('shop'));
      const shopItem  = shopItems.find(s => s.id === item.itemId);
      if (shopItem && shopItem.dispo !== undefined && shopItem.dispo !== '') {
        const newDispo = parseInt(shopItem.dispo) + 1;
        await import('../data/firestore.js').then(m => m.updateInCol('shop', item.itemId, {dispo: newDispo}));
      }
    } catch(e) { /* article supprimé de la boutique, on ignore */ }
  }

  await updateInCol('characters', charId, { inventaire: c.inventaire, compte: c.compte });
  showNotif(`Vendu ! +${prixVente} or ajouté au livret de compte.`, 'success');
  renderCharSheet(c, 'inventaire');
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
    exp:0,
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
    {nom:'Puissance',  effet:'+ 1 dé de dégâts'},
    {nom:'Protection', effet:'+2 CA (2 tr) ou +1 dé soin'},
    {nom:'Amplification',effet:'Zone +3m'},
    {nom:'Enchantement',effet:'(AB) Élément sur équip. allié 2 tr'},
    {nom:'Affliction', effet:'Élément + État sur équip. ennemi 2 tr'},
    {nom:'Invocation',  effet:'Créature liée. 10 PV, CA 10'},
    {nom:'Dispersion',  effet:'+1 cible'},
    {nom:'Lacération',  effet:'CA cible −1 (−2 max)'},
    {nom:'Chance',      effet:'RC 19–20. Critique aussi max'},
    {nom:'Durée',       effet:'+2 tours'},
    {nom:'Concentration',effet:'Actif hors tour. JS Sa DD11'},
    {nom:'Réaction',    effet:'Lance hors de son tour'},
  ];

  // Compter les occurrences de chaque rune (tableau avec doublons)
  const runesSrc = s?.runes||[];
  const runeCounts = {}; // {nom: count}
  runesSrc.forEach(r => { runeCounts[r] = (runeCounts[r]||0) + 1; });

  // Stocker les counts dans un objet global modifiable
  window._runeCountsEdit = {...runeCounts};

  const noyauSel = s?.noyau||'';

  const runesHtml = RUNES.map(r => {
    const cnt = window._runeCountsEdit[r.nom]||0;
    return `<div class="cs-rune-counter" id="rune-row-${r.nom.replace(/\s/g,'_')}">
      <div class="cs-rune-counter-info">
        <span class="cs-rune-counter-name ${cnt>0?'selected':''}" id="rune-name-${r.nom.replace(/\s/g,'_')}">${r.nom}</span>
        <span class="cs-rune-counter-effet">${r.effet}</span>
      </div>
      <div class="cs-rune-counter-ctrl">
        <button type="button" class="cs-rune-btn minus" onclick="runeDecrement('${r.nom}')" ${cnt===0?'disabled':''}>−</button>
        <span class="cs-rune-count-val" id="rune-cnt-${r.nom.replace(/\s/g,'_')}">${cnt}</span>
        <button type="button" class="cs-rune-btn plus" onclick="runeIncrement('${r.nom}')">+</button>
      </div>
    </div>`;
  }).join('');

  openModal(idx>=0?'✏️ Modifier le Sort':'✨ Nouveau Sort', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu..."></div>

    <div class="form-group">
      <label>Noyau élémentaire <span style="color:var(--text-dim);font-weight:400">(2 PM)</span></label>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.map(n => `<div class="cs-noyau-btn ${noyauSel===n?'selected':''}"
             onclick="selectNoyau(this,'${n.replace(/'/g,"\\'")}')">${n}</div>`).join('')}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
    </div>

    <div class="form-group">
      <label>Runes <span style="color:var(--text-dim);font-weight:400">(+2 PM chacune, cumulables)</span></label>
      <div class="cs-rune-list">${runesHtml}</div>
    </div>

    <div class="cs-sort-pm-display">
      Coût total : <strong id="s-pm-display">0</strong> PM
      <input type="hidden" id="s-pm" value="${s?.pm||2}">
    </div>

    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts</label><input class="input-field" id="s-degats" value="${s?.degats||''}" placeholder="= arme, +1D4..."></div>
      <div class="form-group"><label>Soin</label><input class="input-field" id="s-soin" value="${s?.soin||''}" placeholder="1d4..."></div>
    </div>
    <div class="form-group"><label>Description / Effet</label><textarea class="input-field" id="s-effet" rows="3">${s?.effet||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:0.5rem" onclick="saveSort(${idx})">Enregistrer</button>
  `);

  // Initialiser le PM display
  setTimeout(() => updateSortPM(), 50);
}

function runeIncrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  window._runeCountsEdit[nom] = (window._runeCountsEdit[nom]||0) + 1;
  _updateRuneDisplay(nom);
  updateSortPM();
}

function runeDecrement(nom) {
  window._runeCountsEdit = window._runeCountsEdit||{};
  if ((window._runeCountsEdit[nom]||0) <= 0) return;
  window._runeCountsEdit[nom]--;
  if (window._runeCountsEdit[nom] === 0) delete window._runeCountsEdit[nom];
  _updateRuneDisplay(nom);
  updateSortPM();
}

function _updateRuneDisplay(nom) {
  const key = nom.replace(/\s/g,'_');
  const cnt = window._runeCountsEdit[nom]||0;
  const valEl  = document.getElementById(`rune-cnt-${key}`);
  const nameEl = document.getElementById(`rune-name-${key}`);
  const minBtn = document.querySelector(`#rune-row-${key} .cs-rune-btn.minus`);
  if (valEl)   valEl.textContent = cnt;
  if (nameEl)  nameEl.classList.toggle('selected', cnt > 0);
  if (minBtn)  minBtn.disabled = cnt === 0;
}

function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(window._runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
  const pm = total * 2 || 2;
  const pmEl = document.getElementById('s-pm');
  const dispEl = document.getElementById('s-pm-display');
  if (pmEl)   pmEl.value = pm;
  if (dispEl) dispEl.textContent = pm;
}

function selectNoyau(el, noyau) {
  document.querySelectorAll('.cs-noyau-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  const input = document.getElementById('s-noyau');
  if (input) { input.value = noyau; updateSortPM(); }
}


async function saveSort(idx) {
  const c = STATE.activeChar; if(!c) return;
  const sorts = c.deck_sorts||[];
  const noyau = document.getElementById('s-noyau')?.value||'';

  // Reconstruire le tableau de runes avec doublons depuis _runeCountsEdit
  const runes = [];
  Object.entries(window._runeCountsEdit||{}).forEach(([nom, cnt]) => {
    for (let i=0; i<cnt; i++) runes.push(nom);
  });

  const totalRunes = (noyau ? 1 : 0) + runes.length;
  const autoPm     = totalRunes * 2 || 2;

  const newSort = {
    nom:    document.getElementById('s-nom')?.value||'Sort',
    pm:     autoPm,
    noyau,
    runes,
    degats: document.getElementById('s-degats')?.value||'',
    soin:   document.getElementById('s-soin')?.value||'',
    effet:  document.getElementById('s-effet')?.value||'',
    actif:  idx>=0 ? sorts[idx].actif : false,
  };
  if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
  c.deck_sorts=sorts;
  await updateInCol('characters',c.id,{deck_sorts:sorts});
  closeModalDirect();
  showNotif(`Sort enregistré — ${newSort.pm} PM`, 'success');
  renderCharSheet(c,'sorts');
}


// Équipement — filtré depuis l'inventaire du personnage
function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equipped = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');

  // Déterminer les types d'items compatibles selon le slot
  const SLOT_TYPES = {
    'Main principale':  ['⚔️ Arme', 'arme', 'Arme', 'weapon', 'arme 1m', 'arme 2m', 'Épée', 'epee', 'Lance', 'Hache', 'Arc', 'Baguette', 'Dague'],
    'Main secondaire':  ['⚔️ Arme', 'arme', 'Arme', 'weapon', 'Bouclier', 'arme 1m', 'Dague', 'Baguette'],
    'Tête':             ['🛡️ Armure', 'Armure', 'armure', 'armor', 'Casque', 'Heaume', 'Chapeau', 'Cagoule'],
    'Torse':            ['🛡️ Armure', 'Armure', 'armure', 'armor', 'Cuirasse', 'Tunique', 'Robe'],
    'Bottes':           ['🛡️ Armure', 'Armure', 'armure', 'armor', 'Botte', 'Sandale'],
    'Amulette':         ['Bijou', 'Accessoire', 'Amulette', 'Collier', 'Pendentif', '📦 Libre', 'libre'],
    'Anneau':           ['Bijou', 'Accessoire', 'Anneau', 'Bague', '📦 Libre', 'libre'],
    'Objet magique':    ['Accessoire', 'Objet magique', 'Relique', '📦 Libre', 'libre', 'Rare', 'Légendaire'],
  };

  const compatibleTypes = SLOT_TYPES[slot] || [];
  const inv = c.inventaire||[];

  // Filtrer les items de l'inventaire compatibles avec ce slot
  const compatibles = inv.filter(item => {
    if (!item.nom) return false;
    if (compatibleTypes.length === 0) return true;
    const t = (item.type||'').toLowerCase();
    return compatibleTypes.some(ct => t.includes(ct.toLowerCase()) || ct.toLowerCase().includes(t));
  });

  // Options pour le select
  const invOptions = compatibles.map((item, idx) =>
    `<option value="inv:${idx}" ${equipped.nom===item.nom?'selected':''}>${item.nom}${item.type?' ('+item.type+')':''}</option>`
  ).join('');

  const hasCompat = compatibles.length > 0;

  openModal(`${isWeapon?'⚔️':'🛡️'} Équiper — ${slot}`, `
    ${hasCompat
      ? `<div class="form-group">
          <label>Choisir depuis l'inventaire</label>
          <select class="input-field sh-modal-select" id="eq-inv-sel" onchange="previewEquipFromInv(this.value,${JSON.stringify(slot)})">
            <option value="">— Sélectionner un objet —</option>
            ${invOptions}
          </select>
          <div class="cs-equip-inv-preview" id="eq-inv-preview"></div>
        </div>
        <div class="cs-equip-divider">
          <span>ou saisir manuellement</span>
        </div>`
      : `<div class="cs-equip-empty-inv">
          <span>⚠️ Aucun objet compatible dans l'inventaire.</span>
          <span style="font-size:0.72rem;color:var(--text-dim)">Achète des objets à la boutique ou saisis manuellement.</span>
        </div>`
    }
    <div class="form-group"><label>Nom</label><input class="input-field" id="eq-nom" value="${equipped.nom||''}"></div>
    <div class="form-group"><label>Trait</label><input class="input-field" id="eq-trait" value="${equipped.trait||''}"></div>
    ${isWeapon?`
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Dégâts</label><input class="input-field" id="eq-degats" value="${equipped.degats||'1D10'}"></div>
      <div class="form-group"><label>Stat attaque</label>
        <select class="input-field sh-modal-select" id="eq-stat-attaque">
          <option value="force" ${(equipped.statAttaque||'force')==='force'?'selected':''}>Force</option>
          <option value="dexterite" ${equipped.statAttaque==='dexterite'?'selected':''}>Dextérité</option>
          <option value="intelligence" ${equipped.statAttaque==='intelligence'?'selected':''}>Intelligence</option>
        </select>
      </div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="eq-type-arme" value="${equipped.typeArme||''}"></div>
      <div class="form-group"><label>Portée</label><input class="input-field" id="eq-portee" value="${equipped.portee||''}"></div>
    </div>
    <div class="form-group"><label>Particularité</label><input class="input-field" id="eq-particularite" value="${equipped.particularite||''}"></div>
    `:`
    <div class="grid-4" style="gap:0.5rem">
      ${[['fo','Force'],['dex','Dex'],['in','Int'],['sa','Sag'],['co','Con'],['ch','Cha'],['ca','CA']].map(([k,l])=>`
        <div class="form-group"><label>${l}</label><input type="number" class="input-field" id="eq-${k}" value="${equipped[k]||0}"></div>`).join('')}
    </div>`}
    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveEquipSlot('${slot}')">Équiper</button>
      <button class="btn btn-danger" onclick="clearEquipSlot('${slot}')">Retirer</button>
    </div>
  `);
  // Stocker les compatibles pour previewEquipFromInv
  window._equipCompatibles = compatibles;
}

// Pré-remplir les champs depuis l'item sélectionné dans l'inventaire
function previewEquipFromInv(val, slot) {
  if (!val || !val.startsWith('inv:')) return;
  const idx = parseInt(val.split(':')[1]);
  const item = (window._equipCompatibles||[])[idx];
  if (!item) return;

  // Remplir nom et trait depuis l'inventaire
  const nomEl   = document.getElementById('eq-nom');
  const traitEl = document.getElementById('eq-trait');
  if (nomEl)   nomEl.value   = item.nom||'';
  if (traitEl) traitEl.value = item.trait||item.type||'';

  // Remplir les stats si l'item a des données de boutique
  const isWeapon = slot.startsWith('Main');
  if (isWeapon) {
    if (item.degats && document.getElementById('eq-degats'))
      document.getElementById('eq-degats').value = item.degats;
  } else {
    // Bonus stats depuis item boutique
    ['fo','dex','in','sa','co','ch','ca'].forEach(k => {
      const el = document.getElementById('eq-'+k);
      if (el && item[k] !== undefined) el.value = item[k];
    });
  }

  // Preview
  const preview = document.getElementById('eq-inv-preview');
  if (preview) {
    preview.innerHTML = `<div class="cs-equip-inv-item">
      <strong>${item.nom}</strong>
      ${item.type?`<span class="badge badge-gold" style="font-size:0.65rem">${item.type}</span>`:''}
      ${item.description?`<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem">${item.description}</div>`:''}
    </div>`;
  }
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
  sellInvItem,
  calcOr, refreshOrDisplay, calcPalier,
  selectNoyau, runeIncrement, runeDecrement,
  sortDragStart, sortDragOver, sortDragEnd, sortDrop,
  toggleSortDetail,
  previewXpBar, saveXpDirect,
  renderCharCompte,
  addCompteRow, deleteCompteRow, inlineEditCompteField,
  addNote, editNoteTitle, saveNote, deleteNote, toggleNote,
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  renderCharSheet, showCharTab,
  renderCharCarac, renderCharEquip, renderCharDeck,
  renderCharInventaire, renderCharQuetes, renderCharNotes,
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete, deleteSort, deleteInvItem, deleteChar,
  createNewChar,
  inlineEditText, inlineEditNum, inlineEditStat,
  manageTitres, addTitre, removeTitre, saveTitres,
  addSort, editSort, openSortModal, runeIncrement, runeDecrement, updateSortPM, saveSort,
  editEquipSlot, saveEquipSlot, clearEquipSlot,
  previewEquipFromInv,
  addInvItem, editInvItem, saveInvItem,
  addQuete, saveQuete,
  deleteCharPhoto,
});
