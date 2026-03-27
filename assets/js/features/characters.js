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
const ITEM_STAT_META = [
  { full:'force', store:'fo', short:'Fo', label:'Force' },
  { full:'dexterite', store:'dex', short:'Dex', label:'Dextérité' },
  { full:'intelligence', store:'in', short:'Int', label:'Intelligence' },
  { full:'sagesse', store:'sa', short:'Sag', label:'Sagesse' },
  { full:'constitution', store:'co', short:'Con', label:'Constitution' },
  { full:'charisme', store:'ch', short:'Cha', label:'Charisme' },
];
const ITEM_STAT_BY_FULL = Object.fromEntries(ITEM_STAT_META.map(s => [s.full, s]));
const ITEM_STAT_BY_STORE = Object.fromEntries(ITEM_STAT_META.map(s => [s.store, s]));

function statShort(key) {
  return ITEM_STAT_BY_FULL[key]?.short || '';
}

function collectItemBonusEntries(item = {}) {
  return ITEM_STAT_META
    .map(stat => ({ ...stat, value: parseInt(item?.[stat.store]) || 0 }))
    .filter(stat => stat.value);
}

function formatItemBonusText(item = {}) {
  const entries = collectItemBonusEntries(item);
  if (entries.length) return entries.map(stat => `${stat.short} ${stat.value > 0 ? '+' : ''}${stat.value}`).join(' · ');
  return item?.stats || '';
}

function getToucherDisplay(c, item = {}, fallbackKey = 'force') {
  const statKey = item.toucherStat || fallbackKey;
  if (item.toucherStat) return `1d20 ${modStr(getMod(c, statKey))}`;
  if (item.toucher) return item.toucher;
  return `1d20 ${modStr(getMod(c, fallbackKey))}`;
}

function getDegatsDisplay(c, item = {}, fallbackKey = 'force') {
  if (!item.degats) return '—';
  const statKey = item.degatsStat || fallbackKey;
  return `${item.degats} ${modStr(getMod(c, statKey))}`;
}

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
  // Bonus positif : +modCo PV par niveau gagné (scalable)
  // Malus négatif  : appliqué UNE SEULE FOIS (pas multiplié par niveau)
  // Ex: modCo=-1, niv=10 → pvBase-1 (et non pvBase-10)
  const progression = modCo > 0 ? Math.floor(modCo*(niv-1)) : modCo;
  return Math.max(1, (c.pvBase||10) + progression);
}
function calcPMMax(c) {
  const modSa = getMod(c,'sagesse');
  const niv = c.niveau||1;
  // Même logique : malus fixe une seule fois, bonus scalable par niveau
  const progression = modSa > 0 ? Math.floor(modSa*(niv-1)) : modSa;
  return Math.max(0, (c.pmBase||10) + progression);
}

function calcOr(c) {
  const compte = c.compte||{recettes:[],depenses:[]};
  const totalR = (compte.recettes||[]).reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD = (compte.depenses||[]).reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  return Math.round((totalR - totalD) * 100) / 100;
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
    const bonusStr = bonus >= 0 ? `+${bonus}` : String(bonus);
    return `<div class="cs-carac-card">
      <div class="cs-carac-abbr">${st.abbr}</div>
      <div class="cs-carac-val">${total}</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.68rem;line-height:1.2;color:var(--text-dim)">
        <span>Base
          <span class="${canEdit?'cs-editable':''}"
                ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Modifier la base"`:''}
                style="font-weight:700;color:var(--text)">${base}</span>
        </span>
        <span>Équip. ${bonusStr}</span>
      </div>
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
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  const cur = parseInt((c?.stats||{})[statKey]) || 8;
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

  let html = `<div class="cs-section">
    <div class="cs-section-title">📊 Caractéristiques
      ${canEdit?'<span class="cs-hint">cliquer sur la valeur de base pour modifier</span>':''}
    </div>
    <div style="display:grid;gap:.5rem">
      <div style="display:grid;grid-template-columns:minmax(120px,1.3fr) repeat(4,minmax(62px,.7fr));gap:.5rem;align-items:center;padding:0 .75rem;color:var(--text-dim);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em">
        <span>Stat</span>
        <span style="text-align:center">Base</span>
        <span style="text-align:center">Équip.</span>
        <span style="text-align:center">Total</span>
        <span style="text-align:center">Mod</span>
      </div>`;

  STATS_TAB.forEach(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    const bonusStr = bonus > 0 ? `+${bonus}` : String(bonus);
    const modClass = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    html += `<div style="display:grid;grid-template-columns:minmax(120px,1.3fr) repeat(4,minmax(62px,.7fr));gap:.5rem;align-items:center;padding:.75rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated)">
      <div>
        <div style="font-weight:700;color:var(--text)">${st.label}</div>
        <div style="font-size:.72rem;color:var(--text-dim)">${st.abbr}</div>
      </div>
      <div style="text-align:center">
        <span class="${canEdit?'cs-editable':''}"
              ${canEdit?`onclick="inlineEditStat('${c.id}','${st.key}',this)" title="Modifier la base"`:''}
              style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);font-weight:700;color:var(--text)">
          ${base}
        </span>
      </div>
      <div style="text-align:center">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:${bonus ? 'rgba(79,140,255,.10)' : 'var(--bg-card)'};font-weight:700;color:${bonus ? '#7fb0ff' : 'var(--text-dim)'}">
          ${bonusStr}
        </span>
      </div>
      <div style="text-align:center">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);font-weight:800;color:var(--text)">
          ${total}
        </span>
      </div>
      <div style="text-align:center">
        <span class="cs-carac-detail-mod ${modClass}" style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:.32rem .55rem;border-radius:10px">
          ${modStr(m)}
        </span>
      </div>
    </div>`;
  });
  html += `</div>
    <div style="margin-top:.65rem;font-size:.76rem;color:var(--text-dim)">
      Total = Base + bonus d'équipement. Le modificateur est calculé à partir du total.
    </div>
  </div>`;

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

  if (c.setBonusActif) {
    html += `<div class="cs-section">
      <div class="cs-section-title">✨ Bonus de Set</div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-style:italic">${c.setBonusActif}</div>
    </div>`;
  }
  return html;
}

function _renderInventaireBoutique(char) {
  const invRaw = (char.inventaire || []).map((item, i) => ({ item, i })).filter(({ item }) => item.source === 'boutique');
  if (!invRaw.length) return '';

  const RARETE_LABELS = ['', 'Commun', 'Peu commun', 'Rare', 'Très rare'];
  const RARETE_COLORS = ['', '#9ca3af', '#4ade80', '#60a5fa', '#c084fc'];
  const canEdit = window._canEditChar ?? STATE.isAdmin;

  // ── Regrouper par itemId + nom ──────────────────────────────────────────
  const grouped = [];
  invRaw.forEach(({ item, i }) => {
    const key = (item.itemId||'') + '||' + (item.nom||'');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte)||1;
      existing.indices.push(i);
    } else {
      grouped.push({ key, item: {...item}, qte: parseInt(item.qte)||1, indices: [i] });
    }
  });

  const cards = grouped.map(g => {
    const item = g.item;
    const indicesB64 = btoa(JSON.stringify(g.indices));
    const rareteN  = parseInt(item.rarete) || 0;
    const rareteC  = RARETE_COLORS[rareteN] || '#555';
    const rareteL  = RARETE_LABELS[rareteN] || '';
    const prixAchat = parseFloat(item.prixAchat) || 0;
    const prixVente = parseFloat(item.prixVente) || Math.round(prixAchat * 0.6);

    const infos = [];
    const bonusText = formatItemBonusText(item);
    if (item.format)      infos.push({ label: 'Format',    val: item.format });
    if (item.slotArmure)  infos.push({ label: 'Slot',      val: item.slotArmure });
    if (item.slotBijou)   infos.push({ label: 'Slot',      val: item.slotBijou });
    if (item.typeArmure)  infos.push({ label: 'Type',      val: item.typeArmure });
    if (item.degats)      infos.push({ label: '⚔️ Dégâts',  val: `${item.degats}${item.degatsStat ? ` + ${statShort(item.degatsStat)}` : ''}`,  color: '#ff6b6b' });
    if (item.toucherStat) infos.push({ label: 'Toucher',    val: statShort(item.toucherStat), color: '#e8b84b' });
    else if (item.toucher) infos.push({ label: 'Toucher',   val: item.toucher, color: '#e8b84b' });
    if (item.ca || item.ca === 0) infos.push({ label: '🛡️ CA', val: item.ca });
    if (bonusText)        infos.push({ label: 'Stats',      val: bonusText,   color: '#4f8cff' });
    if (item.trait)       infos.push({ label: 'Trait',      val: item.trait,   color: '#b47fff', italic: true });
    if (item.type)        infos.push({ label: 'Type',       val: item.type });
    if (item.effet)       infos.push({ label: 'Effet',      val: item.effet });
    if (item.description) infos.push({ label: 'Desc.',      val: item.description, muted: true });

    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      padding:.85rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-left:3px solid ${rareteC}">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600;line-height:1.2">
            ${item.nom || '?'}
          </div>
          ${rareteL ? `<div style="font-size:.68rem;color:${rareteC};margin-top:1px">${'★'.repeat(rareteN)+'☆'.repeat(4-rareteN)} ${rareteL}</div>` : ''}
        </div>
        <span style="font-size:.72rem;background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:999px;padding:2px 8px;color:var(--text-muted);flex-shrink:0">×${g.qte}</span>
      </div>

      ${infos.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem .75rem">
        ${infos.map(info => `
          <div style="display:flex;align-items:baseline;gap:.3rem;font-size:.78rem">
            <span style="color:var(--text-dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.5px">${info.label}</span>
            <span style="color:${info.color||'var(--text-muted)'};${info.italic?'font-style:italic':''};font-weight:${info.color?'600':'400'}">${info.val}</span>
          </div>`).join('')}
      </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.25rem;
        padding-top:.5rem;border-top:1px solid var(--border)">
        <div style="font-size:.72rem;color:var(--text-dim)">
          <span title="Prix d'achat">💰 ${prixAchat} or</span>
          <span style="margin:0 .3rem;opacity:.4">·</span>
          <span title="Prix de revente" style="color:var(--gold)">🔄 ${prixVente} or/u</span>
        </div>
        ${canEdit ? `
        <div style="display:flex;gap:.4rem;align-items:center">
          <button onclick="openSellInvModal('${char.id}','${indicesB64}',${prixVente},'${item.nom||''}')"
            style="background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:var(--gold);transition:all .15s"
            onmouseover="this.style.background='rgba(232,184,75,.15)'"
            onmouseout="this.style.background='rgba(232,184,75,.08)'">
            🔄 Vendre
          </button>
          ${(STATE.characters||[]).filter(x=>x.id!==char.id).length ? `
          <button onclick="openSendInvModal('${char.id}','${indicesB64}','${item.nom||''}')"
            style="background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:#4f8cff;transition:all .15s"
            onmouseover="this.style.background='rgba(79,140,255,.15)'"
            onmouseout="this.style.background='rgba(79,140,255,.08)'"
            title="Envoyer">
            📤 Envoyer
          </button>` : ''}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div style="margin-bottom:1.5rem">
    <div style="font-size:.72rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;
      margin-bottom:.75rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)">
      🛒 Inventaire Boutique
      <span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:999px;padding:1px 7px;margin-left:.4rem;color:var(--text-dim)">${grouped.reduce((s,g)=>s+g.qte,0)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:.6rem">${cards}</div>
  </div>`;
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

  let html = '';

  html += `<div class="cs-section">
    <div class="cs-section-title">⚔️ Armes
      ${canEdit?'<span class="cs-hint">cliquer sur ✏️ pour modifier</span>':''}
    </div>`;

  weaponSlots.forEach(slot => {
    const item    = equip[slot]||{};
    const statKey = item.statAttaque==='dexterite' ? 'dexterite'
                  : item.statAttaque==='intelligence' ? 'intelligence'
                  : 'force';
    const statVal = (s[statKey]||8)+(sb[statKey]||0);
    const mod     = Math.floor((Math.min(22,statVal)-10)/2);
    const modS    = modStr(mod);

    const toucherDisplay = getToucherDisplay(c, item, statKey);
    const degatsDisplay = getDegatsDisplay(c, item, statKey);
    const bonusDisplay = formatItemBonusText(item);

    // Badge format
    const formatBadge = item.format
      ? `<span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
           border-radius:6px;padding:1px 6px;color:var(--text-dim)">${item.format}</span>`
      : '';

    html += `<div class="cs-weapon-row">
      <div class="cs-weapon-slot-label">${slot}</div>
      <div class="cs-weapon-body">
        ${item.nom ? `
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem">
            <div class="cs-weapon-name">${item.nom}</div>
            ${formatBadge}
          </div>
          ${item.trait?`<div class="cs-weapon-trait">${item.trait}</div>`:''}
          <div class="cs-weapon-stats">
            <span class="cs-ws">
              <span class="cs-ws-label">Toucher</span>
              <span class="cs-ws-val gold">${toucherDisplay}</span>
            </span>
            <span class="cs-ws">
              <span class="cs-ws-label">Dégâts</span>
              <span class="cs-ws-val red">${degatsDisplay}</span>
            </span>
            ${bonusDisplay?`<span class="cs-ws">
              <span class="cs-ws-label">Bonus</span>
              <span class="cs-ws-val" style="color:#4f8cff">${bonusDisplay}</span>
            </span>`:''}
            ${item.portee?`<span class="cs-ws">
              <span class="cs-ws-label">Portée</span>
              <span class="cs-ws-val">${item.portee}</span>
            </span>`:''}
            ${item.particularite?`<span class="cs-ws cs-ws-wide">
              <span class="cs-ws-label">Particularité</span>
              <span class="cs-ws-val muted">${item.particularite}</span>
            </span>`:''}
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
  const invRaw = c.inventaire||[];

  // ── Regrouper les items identiques ──────────────────────────────────────
  const grouped = [];
  invRaw.forEach((item, realIdx) => {
    const key = (item.itemId||'') + '||' + (item.nom||'');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte)||1;
      existing.indices.push(realIdx);
    } else {
      grouped.push({ key, item:{...item}, qte:parseInt(item.qte)||1, indices:[realIdx] });
    }
  });

  const otherChars = STATE.characters?.filter(x => x.id !== c.id) || [];

  const RARETE_COLORS = ['','#9ca3af','#4ade80','#60a5fa','#c084fc'];
  const RARETE_LABELS = ['','Commun','Peu commun','Rare','Très rare'];

  let html = `
  <style>
    .inv-card {
      background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      overflow:hidden;transition:box-shadow .15s;
    }
    .inv-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.35); }
    .inv-card-header {
      display:flex;align-items:flex-start;justify-content:space-between;
      padding:.75rem 1rem .5rem;gap:.5rem;
    }
    .inv-card-title {
      font-family:'Cinzel',serif;font-size:.9rem;font-weight:600;
      color:var(--text);line-height:1.2;
    }
    .inv-card-sub {
      font-size:.7rem;margin-top:2px;
    }
    .inv-card-qte {
      font-family:'Cinzel',serif;font-size:.85rem;font-weight:700;
      color:var(--text);background:var(--bg-elevated);border:1px solid var(--border);
      border-radius:8px;padding:2px 10px;flex-shrink:0;white-space:nowrap;
    }
    .inv-card-stats {
      display:flex;flex-wrap:wrap;gap:.3rem .6rem;
      padding:0 1rem .6rem;
    }
    .inv-stat-chip {
      display:flex;align-items:center;gap:.25rem;
      background:var(--bg-elevated);border-radius:6px;
      padding:2px 8px;font-size:.75rem;border:1px solid var(--border);
    }
    .inv-stat-label {
      color:var(--text-dim);font-size:.65rem;text-transform:uppercase;letter-spacing:.5px;
    }
    .inv-stat-val { font-weight:600; }
    .inv-card-desc {
      padding:0 1rem .6rem;font-size:.78rem;color:var(--text-muted);
      font-style:italic;line-height:1.5;
    }
    .inv-card-footer {
      display:flex;align-items:center;justify-content:space-between;
      padding:.5rem 1rem .65rem;border-top:1px solid var(--border);
      background:rgba(0,0,0,.15);gap:.5rem;
    }
    .inv-price-block {
      display:flex;align-items:center;gap:.5rem;font-size:.75rem;
    }
    .inv-price-buy { color:var(--text-dim); }
    .inv-price-sell { color:var(--gold); }
    .inv-actions {
      display:flex;align-items:center;gap:.4rem;flex-shrink:0;
    }
    .inv-btn {
      display:flex;align-items:center;gap:.3rem;
      border-radius:8px;padding:4px 10px;cursor:pointer;
      font-size:.73rem;font-weight:500;border:1px solid;
      transition:all .15s;line-height:1;
    }
    .inv-btn-sell {
      background:rgba(232,184,75,.08);border-color:rgba(232,184,75,.3);color:var(--gold);
    }
    .inv-btn-sell:hover { background:rgba(232,184,75,.18);border-color:rgba(232,184,75,.6); }
    .inv-btn-send {
      background:rgba(79,140,255,.08);border-color:rgba(79,140,255,.3);color:#4f8cff;
    }
    .inv-btn-send:hover { background:rgba(79,140,255,.18);border-color:rgba(79,140,255,.6); }
    .inv-btn-del {
      background:rgba(255,107,107,.06);border-color:rgba(255,107,107,.25);color:#ff6b6b;
      padding:4px 8px;
    }
    .inv-btn-del:hover { background:rgba(255,107,107,.15);border-color:rgba(255,107,107,.5); }
  </style>
  <div class="cs-section">
    <div class="cs-section-title">🎒 Inventaire
      <span class="cs-hint">${invRaw.length} objet${invRaw.length!==1?'s':''} · depuis la Boutique</span>
    </div>`;

  if (grouped.length===0) {
    html += `<div class="cs-empty" style="padding:2rem;text-align:center">
      <div style="font-size:2rem;margin-bottom:.5rem;opacity:.3">🎒</div>
      <div style="font-size:.85rem;color:var(--text-dim)">Inventaire vide.</div>
      <div style="font-size:.75rem;color:var(--text-dim);margin-top:.3rem">Achetez des objets depuis la Boutique.</div>
    </div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:.6rem">`;
    grouped.forEach(g => {
      const item = g.item;
      const pv   = parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat)||0)*0.6);
      const pa   = parseFloat(item.prixAchat) || 0;
      const indicesB64 = btoa(JSON.stringify(g.indices));

      const rareteN = parseInt(item.rarete)||0;
      const rareteC = RARETE_COLORS[rareteN] || 'var(--border)';
      const rareteL = RARETE_LABELS[rareteN] || '';

      // Construire les chips de stats dans l'ordre logique
      const chips = [];
      const bonusText = formatItemBonusText(item);
      if (item.format)  chips.push({ label:'Format', val:item.format, color:'var(--text-muted)' });
      if (item.slotArmure) chips.push({ label:'Slot', val:item.slotArmure, color:'var(--text-muted)' });
      if (item.slotBijou) chips.push({ label:'Slot', val:item.slotBijou, color:'var(--text-muted)' });
      if (item.typeArmure) chips.push({ label:'Type', val:item.typeArmure, color:'var(--text-muted)' });
      if (item.degats)  chips.push({ label:'Dégâts',  val:`${item.degats}${item.degatsStat ? ` + ${statShort(item.degatsStat)}` : ''}`,  color:'#ff6b6b' });
      if (item.toucherStat) chips.push({ label:'Toucher',  val:statShort(item.toucherStat), color:'#e8b84b' });
      else if (item.toucher) chips.push({ label:'Toucher',  val:item.toucher, color:'#e8b84b' });
      if (item.ca || item.ca === 0) chips.push({ label:'CA', val:item.ca, color:'#4f8cff' });
      if (bonusText)   chips.push({ label:'Stats',    val:bonusText,   color:'#4f8cff' });
      if (item.trait)   chips.push({ label:'Trait',    val:item.trait,   color:'#b47fff' });
      if (item.type && !item.degats && !(item.ca || item.ca===0))
                        chips.push({ label:'Type',     val:item.type,    color:'var(--text-muted)' });
      if (item.effet)   chips.push({ label:'Effet',    val:item.effet,   color:'var(--text-muted)' });

      html += `<div class="inv-card" style="border-left:3px solid ${rareteC}">
        <div class="inv-card-header">
          <div>
            <div class="inv-card-title">${item.nom||'?'}</div>
            ${rareteL?`<div class="inv-card-sub" style="color:${rareteC}">${'★'.repeat(rareteN)+'☆'.repeat(4-rareteN)} ${rareteL}</div>`:''}
          </div>
          <span class="inv-card-qte">×${g.qte}</span>
        </div>

        ${chips.length?`<div class="inv-card-stats">
          ${chips.map(ch=>`<div class="inv-stat-chip">
            <span class="inv-stat-label">${ch.label}</span>
            <span class="inv-stat-val" style="color:${ch.color}">${ch.val}</span>
          </div>`).join('')}
        </div>`:''}

        ${(!chips.length||true) && item.description?`<div class="inv-card-desc">${item.description}</div>`:''}

        <div class="inv-card-footer">
          <div class="inv-price-block">
            ${pa?`<span class="inv-price-buy" title="Prix d'achat">💰 ${pa} or</span>`:''}
            ${pa&&pv?`<span style="color:var(--border);font-size:.65rem">|</span>`:''}
            ${pv?`<span class="inv-price-sell" title="Prix de revente">🔄 ${pv} or/u</span>`:''}
          </div>
          ${canEdit?`<div class="inv-actions">
            ${item.source==='boutique'?`<button class="inv-btn inv-btn-sell"
              onclick="openSellInvModal('${c.id}','${indicesB64}',${pv},'${(item.nom||'').replace(/'/g,"\\'")}')">
              🔄 Vendre
            </button>`:''}
            ${otherChars.length?`<button class="inv-btn inv-btn-send"
              onclick="openSendInvModal('${c.id}','${indicesB64}','${(item.nom||'').replace(/'/g,"\\'")}')">
              ↗ Envoyer
            </button>`:''}
            <button class="inv-btn inv-btn-del"
              onclick="openDeleteInvModal('${c.id}','${indicesB64}','${(item.nom||'').replace(/'/g,"\\'")}')">
              🗑
            </button>
          </div>`:''}
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


// ── Décoder les indices depuis base64 ─────────────────────────────────────────
function _decodeIndices(b64) {
  try { return JSON.parse(atob(b64)); } catch { return []; }
}

// ── Modal vente avec quantité ─────────────────────────────────────────────────
function openSellInvModal(charId, indicesB64, prixVente, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  if (maxQte === 0) return;
  openModal(`🔄 Vendre — ${nom}`, `
    <div style="margin-bottom:1rem;font-size:.85rem;color:var(--text-muted)">
      <strong style="color:var(--gold)">${prixVente} or</strong> par unité · ${maxQte} en stock
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown();this.nextElementSibling.dispatchEvent(new Event('input'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">−</button>
        <input type="number" id="sell-qty" min="1" max="${maxQte}" value="1"
          style="width:60px;text-align:center" class="input-field"
          oninput="document.getElementById('sell-total').textContent=(Math.min(Math.max(1,parseInt(this.value)||1),${maxQte})*${prixVente})+' or'">
        <button type="button" onclick="this.previousElementSibling.stepUp();this.previousElementSibling.dispatchEvent(new Event('input'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">+</button>
      </div>
      <span style="font-size:.8rem;color:var(--text-dim)">→ <strong id="sell-total" style="color:var(--gold)">${prixVente} or</strong></span>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="sellInvItemBulk('${charId}','${indicesB64}',${prixVente})">
        🔄 Vendre
      </button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function sellInvItemBulk(charId, indicesB64, prixVente) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;

  const allIndices = _decodeIndices(indicesB64);
  const qty = Math.min(Math.max(1, parseInt(document.getElementById('sell-qty')?.value)||1), allIndices.length);
  const indicesToSell = allIndices.slice(0, qty); // vendre les N premiers

  const inv      = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const item     = inv[indicesToSell[0]];
  if (!item) return;
  const itemNom  = item.nom || 'objet';
  const totalPrix = prixVente * qty;

  // Retirer les items vendus (du plus grand index au plus petit pour ne pas décaler)
  const sorted = [...indicesToSell].sort((a,b)=>b-a);
  sorted.forEach(idx => inv.splice(idx, 1));

  // Créditer l'or
  const compte   = c.compte || { recettes:[], depenses:[] };
  const recettes = [...(compte.recettes||[])];
  recettes.push({
    date:    new Date().toLocaleDateString('fr-FR'),
    libelle: qty > 1 ? `Vente ×${qty} : ${itemNom}` : `Vente : ${itemNom}`,
    montant: totalPrix,
  });

  // Réincrémenter le stock boutique si besoin
  if (item.itemId && window.sellInvItemFromShop) {
    // On réincrémente N fois dans la boutique
    for (let i = 0; i < qty; i++) {
      await window._restockShopItem?.(item.itemId);
    }
  }

  await updateInCol('characters', charId, {
    inventaire: inv,
    compte: { ...compte, recettes },
  });
  c.inventaire = inv;
  c.compte     = { ...compte, recettes };

  closeModal();
  showNotif(`💰 ×${qty} "${itemNom}" vendu${qty>1?'s':''} pour ${totalPrix} or !`, 'success');
  refreshOrDisplay(c);
  renderCharSheet(c, window._currentCharTab || 'inventaire');
}

// Alias pour compatibilité avec l'ancien code
async function sellInvItem(charId, invIndex) {
  // Construire indicesB64 depuis un index unique
  const b64 = btoa(JSON.stringify([invIndex]));
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  const item = (c?.inventaire||[])[invIndex];
  const pv = parseFloat(item?.prixVente) || Math.round((parseFloat(item?.prixAchat)||0)*0.6);
  openSellInvModal(charId, b64, pv, item?.nom||'objet');
}

// ══════════════════════════════════════════════
// SUPPRIMER avec quantité
// ══════════════════════════════════════════════
function openDeleteInvModal(charId, indicesB64, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  openModal(`🗑️ Supprimer — ${nom}`, `
    <div style="margin-bottom:1rem;font-size:.85rem;color:var(--text-muted)">
      ${maxQte} exemplaire${maxQte>1?'s':''} dans l'inventaire
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">−</button>
        <input type="number" id="del-qty" min="1" max="${maxQte}" value="1" style="width:60px;text-align:center" class="input-field">
        <button type="button" onclick="this.previousElementSibling.stepUp()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">+</button>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn btn-outline btn-sm" style="flex:1;color:#ff6b6b;border-color:rgba(255,107,107,.35)"
        onclick="deleteInvItemBulk('${charId}','${indicesB64}')">🗑️ Supprimer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function deleteInvItemBulk(charId, indicesB64) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  const allIndices = _decodeIndices(indicesB64);
  const qty = Math.min(Math.max(1, parseInt(document.getElementById('del-qty')?.value)||1), allIndices.length);
  const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const sorted = allIndices.slice(0, qty).sort((a,b)=>b-a);
  sorted.forEach(idx => inv.splice(idx, 1));
  await updateInCol('characters', charId, { inventaire: inv });
  c.inventaire = inv;
  closeModal();
  showNotif('Objet(s) supprimé(s).', 'success');
  renderCharSheet(c, window._currentCharTab || 'inventaire');
}

// ══════════════════════════════════════════════
// ENVOYER UN OBJET À UN AUTRE PERSONNAGE
// ══════════════════════════════════════════════
function openSendInvModal(charId, indicesB64OrIndex, nomOrUnused) {
  const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;

  // Accepter soit un indicesB64 (nouveau) soit un index numérique (ancien)
  let indices;
  if (typeof indicesB64OrIndex === 'number') {
    indices = [indicesB64OrIndex];
  } else {
    indices = _decodeIndices(indicesB64OrIndex);
  }
  if (!indices.length) return;

  const item    = (c.inventaire||[])[indices[0]];
  if (!item) return;
  const nom     = nomOrUnused || item.nom || 'Objet';
  const maxQte  = indices.length;
  const b64     = btoa(JSON.stringify(indices));

  const otherChars = STATE.characters?.filter(x => x.id !== charId) || [];
  if (!otherChars.length) { showNotif('Aucun autre personnage disponible.','error'); return; }

  openModal(`📤 Envoyer — ${nom}`, `
    <div style="margin-bottom:.75rem;font-size:.85rem;color:var(--text-muted)">
      ${maxQte} exemplaire${maxQte>1?'s':''} disponible${maxQte>1?'s':''}
    </div>
    ${maxQte > 1 ? `
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button" onclick="this.nextElementSibling.stepDown()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">−</button>
        <input type="number" id="send-qty" min="1" max="${maxQte}" value="1"
          style="width:60px;text-align:center" class="input-field">
        <button type="button" onclick="this.previousElementSibling.stepUp()"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem">+</button>
      </div>
    </div>` : ''}
    <div class="form-group">
      <label>Envoyer à</label>
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${otherChars.map(target => `
          <label style="display:flex;align-items:center;gap:.75rem;padding:.6rem .8rem;
            border-radius:10px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;transition:all .15s"
            onmouseover="this.style.borderColor='var(--gold)';this.style.background='rgba(232,184,75,.06)'"
            onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg-elevated)'">
            <input type="radio" name="send-target" value="${target.id}" style="accent-color:var(--gold)">
            <div>
              <div style="font-family:'Cinzel',serif;font-size:.82rem;color:var(--text)">${target.nom||'?'}</div>
              ${target.ownerPseudo?`<div style="font-size:.68rem;color:var(--text-dim)">${target.ownerPseudo}</div>`:''}
            </div>
          </label>`).join('')}
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="sendInvItem('${charId}','${b64}')">📤 Envoyer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function sendInvItem(fromCharId, indicesB64) {
  const fromChar = STATE.characters?.find(x => x.id === fromCharId) || STATE.activeChar;
  if (!fromChar) return;

  const targetId = document.querySelector('input[name="send-target"]:checked')?.value;
  if (!targetId) { showNotif('Sélectionne un personnage cible.','error'); return; }

  const toChar = STATE.characters?.find(x => x.id === targetId);
  if (!toChar) { showNotif('Personnage introuvable.','error'); return; }

  const allIndices = _decodeIndices(indicesB64);
  const maxQte  = allIndices.length;
  const qtyEl   = document.getElementById('send-qty');
  const qty     = qtyEl ? Math.min(Math.max(1, parseInt(qtyEl.value)||1), maxQte) : 1;
  const toSend  = allIndices.slice(0, qty);

  const fromInv = Array.isArray(fromChar.inventaire) ? [...fromChar.inventaire] : [];
  const firstItem = fromInv[toSend[0]];
  if (!firstItem) return;

  // Objets à transférer
  const itemsToTransfer = toSend.map(idx => ({...fromInv[idx]}));

  // Retirer de la source (du plus grand au plus petit)
  [...toSend].sort((a,b)=>b-a).forEach(idx => fromInv.splice(idx, 1));

  // Ajouter à la cible
  const toInv = Array.isArray(toChar.inventaire) ? [...toChar.inventaire] : [];
  itemsToTransfer.forEach(it => toInv.push(it));

  await Promise.all([
    updateInCol('characters', fromCharId, { inventaire: fromInv }),
    updateInCol('characters', targetId,   { inventaire: toInv }),
  ]);
  fromChar.inventaire = fromInv;
  toChar.inventaire   = toInv;

  closeModal();
  showNotif(`📤 ×${qty} "${firstItem.nom||'objet'}" envoyé${qty>1?'s':''} à ${toChar.nom||'?'} !`, 'success');
  renderCharSheet(fromChar, window._currentCharTab || 'inventaire');
}
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


function computeEquipStatsBonus(equip = {}) {
  const bonus = { force:0, dexterite:0, intelligence:0, sagesse:0, constitution:0, charisme:0 };
  Object.values(equip || {}).forEach(it => {
    bonus.force        += parseInt(it?.fo)  || 0;
    bonus.dexterite    += parseInt(it?.dex) || 0;
    bonus.intelligence += parseInt(it?.in)  || 0;
    bonus.sagesse      += parseInt(it?.sa)  || 0;
    bonus.constitution += parseInt(it?.co)  || 0;
    bonus.charisme     += parseInt(it?.ch)  || 0;
  });
  return bonus;
}

function inferAttackStatFromItem(item = {}) {
  if (item.toucherStat) return item.toucherStat;
  if (item.statAttaque) return item.statAttaque;
  const format = String(item.format || '');
  if (format.includes('Mag.')) return 'intelligence';
  if (format.includes('Dist.')) return 'dexterite';
  return 'force';
}

function inferArmorSlotValue(slot, item = {}) {
  if (item.slotArmure) return item.slotArmure;
  if (slot === 'Bottes') return 'Pieds';
  return slot;
}

function inferAccessorySlotValue(slot, item = {}) {
  return item.slotBijou || slot;
}

function buildEquippedItemFromInventory(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');

  if (isWeapon) {
    return {
      nom: item.nom || '',
      trait: item.trait || '',
      degats: item.degats || '',
      degatsStat: item.degatsStat || inferAttackStatFromItem(item),
      toucherStat: item.toucherStat || inferAttackStatFromItem(item),
      statAttaque: inferAttackStatFromItem(item),
      typeArme: item.typeArme || item.type || '',
      portee: item.portee || '',
      particularite: item.particularite || item.effet || item.description || '',
      format: item.format || '',
      toucher: item.toucher || '',
      stats: item.stats || '',
      fo: parseInt(item.fo) || 0,
      dex: parseInt(item.dex) || 0,
      in: parseInt(item.in) || 0,
      sa: parseInt(item.sa) || 0,
      co: parseInt(item.co) || 0,
      ch: parseInt(item.ch) || 0,
      sourceInvIndex: invIndex,
      itemId: item.itemId || '',
    };
  }

  return {
    nom: item.nom || '',
    trait: item.trait || '',
    fo: parseInt(item.fo) || 0,
    dex: parseInt(item.dex) || 0,
    in: parseInt(item.in) || 0,
    sa: parseInt(item.sa) || 0,
    co: parseInt(item.co) || 0,
    ch: parseInt(item.ch) || 0,
    ca: parseInt(item.ca) || 0,
    typeArmure: item.typeArmure || '',
    slotArmure: item.slotArmure ? inferArmorSlotValue(slot, item) : '',
    slotBijou: item.slotBijou ? inferAccessorySlotValue(slot, item) : '',
    sourceInvIndex: invIndex,
    itemId: item.itemId || '',
  };
}

async function equipSlotFromInv(val, slot) {
  if (!val || !val.startsWith('inv:')) return;
  const c = STATE.activeChar; if (!c) return;

  const invIndex = parseInt(val.split(':')[1], 10);
  if (Number.isNaN(invIndex)) return;

  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const equip = { ...(c.equipement || {}) };

  Object.keys(equip).forEach(otherSlot => {
    if (otherSlot !== slot && equip[otherSlot]?.sourceInvIndex === invIndex) {
      delete equip[otherSlot];
    }
  });

  const equippedItem = buildEquippedItemFromInventory(slot, item, invIndex);
  if (!equippedItem) return;

  equip[slot] = equippedItem;
  const bonus = computeEquipStatsBonus(equip);

  c.equipement = equip;
  c.statsBonus = bonus;

  await updateInCol('characters', c.id, { equipement: equip, statsBonus: bonus });
  closeModal();
  showNotif(`Équipement mis à jour : ${item.nom || 'objet'} → ${slot}`, 'success');
  renderCharSheet(c, 'combat');
}

// Équipement — filtré depuis l'inventaire du personnage
function editEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equipped = (c.equipement||{})[slot]||{};
  const isWeapon = slot.startsWith('Main');

  // ── Règles de compatibilité par slot ────────────────────────────────────
  // On filtre d'abord par les champs structurés (format, slotArmure, typeArmure, template)
  // puis on accepte les items sans champ structuré comme fallback (compatibilité anciens items)

  const ARMES_1M_CAC    = ['Arme 1M CaC Phy.'];
  const ARME_SECONDAIRE = ['Arme Secondaire (Bouclier, Torche...)'];
  const TOUTES_ARMES    = ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)'];

  // Main principale : toutes les armes sauf secondaires pures
  // Main secondaire : armes 1M + armes secondaires (bouclier, torche...)
  const SLOT_ARME_FORMATS = {
    'Main principale': ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.','Arme 2M CaC Mag.','Arme 2M Dist Mag.'],
    'Main secondaire': [...ARMES_1M_CAC, ...ARME_SECONDAIRE],
  };

  // Slots d'armure → [slotArmure compatible, typeArmure compatible ou null=tous]
  const SLOT_ARMURE = {
    'Tête':    { slot: 'Tête',  types: null },
    'Torse':   { slot: 'Torse', types: null },
    'Bottes':  { slot: 'Pieds', types: null },
    'Amulette':    null, // pas d'armure, items libres
    'Anneau':      null,
    'Objet magique': null,
  };

  const inv = c.inventaire||[];
  const equippedEntries = Object.entries(c.equipement || {});
  const equippedInvIndex = Number.isInteger(equipped?.sourceInvIndex) ? equipped.sourceInvIndex : -1;

  // Filtrer les items compatibles avec ce slot
  const compatibles = inv
    .map((item, invIndex) => ({ item, invIndex }))
    .filter(({ item, invIndex }) => {
      if (!item?.nom) return false;

      const alreadyEquippedElsewhere = equippedEntries.some(([otherSlot, equippedItem]) =>
        otherSlot !== slot && equippedItem?.sourceInvIndex === invIndex
      );
      if (alreadyEquippedElsewhere) return false;

      const tpl = item.template || '';

      if (isWeapon) {
        const formats = SLOT_ARME_FORMATS[slot] || TOUTES_ARMES;
        if (tpl === 'arme' || item.format) {
          // Item structuré : filtrer par format
          return formats.includes(item.format);
        }
        // Item non structuré (ancien format) : accepter si le type ressemble à une arme
        const t = (item.type||'').toLowerCase();
        return ['arme','weapon','épée','lance','hache','arc','dague','baguette','baton'].some(k => t.includes(k));
      }

      // Slots d'armure structurés
      const armureRule = SLOT_ARMURE[slot];
      if (armureRule !== undefined) {
        if (armureRule === null) {
          if (tpl === 'bijou' || item.slotBijou) return item.slotBijou === slot;
          return tpl === 'libre' || tpl === 'classique' || (!tpl && !item.format && !item.slotArmure && !item.slotBijou);
        }
        if (tpl === 'armure' || item.slotArmure) {
          // Item structuré : vérifier slotArmure
          return item.slotArmure === armureRule.slot;
        }
        // Item non structuré : accepter si type ressemble à armure
        const t = (item.type||'').toLowerCase();
        return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
      }

      return false;
    });

  // Options pour le select
  const invOptions = compatibles.map(({ item, invIndex }) => {
    // Label enrichi avec les infos structurées
    let label = item.nom;
    if (item.format) label += ` — ${item.format}`;
    else if (item.slotArmure && item.typeArmure) label += ` — ${item.typeArmure}`;
    const isSelected = equippedInvIndex === invIndex || (equippedInvIndex < 0 && equipped.nom === item.nom);
    return `<option value="inv:${invIndex}" ${isSelected?'selected':''}>${label}</option>`;
  }).join('');

  const hasCompat = compatibles.length > 0;

  openModal(`${isWeapon?'⚔️':'🛡️'} Équiper — ${slot}`, `
    ${hasCompat
      ? `<div class="form-group">
          <label>Choisir depuis l'inventaire <span style="font-size:0.72rem;color:var(--text-dim)">· équipe immédiatement</span></label>
          <select class="input-field sh-modal-select" id="eq-inv-sel" data-equip-slot="${slot}" onchange="equipSlotFromInv(this.value, this.dataset.equipSlot)">
            <option value="">— Sélectionner un objet —</option>
            ${invOptions}
          </select>
        </div>
        <div class="cs-equip-divider">
          <span>ou saisir / ajuster manuellement</span>
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
  window._equipCompatibles  = compatibles;
  window._equipSelectedMeta = {
    format: equipped.format || '',
    toucher: equipped.toucher || '',
    toucherStat: equipped.toucherStat || inferAttackStatFromItem(equipped),
    degatsStat: equipped.degatsStat || equipped.statAttaque || '',
    stats: equipped.stats || '',
    fo: parseInt(equipped.fo) || 0,
    dex: parseInt(equipped.dex) || 0,
    in: parseInt(equipped.in) || 0,
    sa: parseInt(equipped.sa) || 0,
    co: parseInt(equipped.co) || 0,
    ch: parseInt(equipped.ch) || 0,
    typeArmure: equipped.typeArmure || '',
    slotArmure: equipped.slotArmure || '',
    slotBijou: equipped.slotBijou || '',
  };
}

// Pré-remplir les champs depuis l'item sélectionné dans l'inventaire
function previewEquipFromInv(val, slot) {
  if (!val || !val.startsWith('inv:')) return;
  const idx  = parseInt(val.split(':')[1], 10);
  const compat = (window._equipCompatibles||[]).find(entry => entry?.invIndex === idx) || (window._equipCompatibles||[])[idx];
  const item = compat?.item || compat;
  if (!item) return;

  const nomEl   = document.getElementById('eq-nom');
  const traitEl = document.getElementById('eq-trait');
  if (nomEl)   nomEl.value   = item.nom||'';
  if (traitEl) traitEl.value = item.trait||'';

  const isWeapon = slot.startsWith('Main');
  if (isWeapon) {
    if (item.degats && document.getElementById('eq-degats'))
      document.getElementById('eq-degats').value = item.degats;
    // Déduire stat d'attaque depuis le format
    if (item.format) {
      const statSel = document.getElementById('eq-stat-attaque');
      if (statSel) {
        if (item.format.includes('Mag.'))  statSel.value = 'intelligence';
        else if (item.format.includes('Dist.')) statSel.value = 'dexterite';
        else statSel.value = 'force';
      }
    }
    // Stocker format, toucher, stats pour saveEquipSlot
    window._equipSelFormat  = item.format  || '';
    window._equipSelToucher = item.toucher || '';
    window._equipSelStats   = item.stats   || '';
  } else {
    // Stocker typeArmure pour saveEquipSlot
    window._equipSelTypeArmure = item.typeArmure||'';
    window._equipSelSlotArmure = item.slotArmure||'';
    // Bonus stats depuis item boutique (valeurs numériques)
    ['fo','dex','in','sa','co','ch'].forEach(k => {
      const el = document.getElementById('eq-'+k);
      if (el && item[k] !== undefined) el.value = item[k];
    });
    // CA bonus
    const caEl = document.getElementById('eq-ca');
    if (caEl && item.ca) caEl.value = parseInt(item.ca)||0;
  }

  // Preview enrichi
  const preview = document.getElementById('eq-inv-preview');
  if (preview) {
    const tags = [
      item.format && `<span class="badge badge-gold" style="font-size:.65rem">${item.format}</span>`,
      item.slotArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.slotArmure}</span>`,
      item.typeArmure && `<span class="badge badge-gold" style="font-size:.65rem">${item.typeArmure}</span>`,
      item.degats && `<span style="font-size:.75rem;color:#ff6b6b">⚔️ ${item.degats}</span>`,
      item.toucher && `<span style="font-size:.75rem;color:#e8b84b">🎯 ${item.toucher}</span>`,
      item.ca && `<span style="font-size:.75rem;color:#4f8cff">🛡️ CA +${item.ca}</span>`,
    ].filter(Boolean).join(' ');
    preview.innerHTML = `<div class="cs-equip-inv-item" style="margin-top:.5rem;padding:.5rem .75rem;background:var(--bg-elevated);border-radius:8px;border:1px solid var(--border)">
      <strong style="font-size:.85rem">${item.nom}</strong>
      ${tags?`<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.25rem">${tags}</div>`:''}
      ${item.stats?`<div style="font-size:.72rem;color:#4f8cff;margin-top:.2rem">${item.stats}</div>`:''}
      ${item.trait?`<div style="font-size:.72rem;color:#b47fff;font-style:italic;margin-top:.1rem">${item.trait}</div>`:''}
    </div>`;
  }
}


async function saveEquipSlot(slot) {
  const c = STATE.activeChar; if(!c) return;
  const equip = c.equipement||{};
  const meta = window._equipSelectedMeta || {};
  if (slot.startsWith('Main')) {
    equip[slot] = {
      nom:         document.getElementById('eq-nom')?.value||'',
      trait:       document.getElementById('eq-trait')?.value||'',
      degats:      document.getElementById('eq-degats')?.value||'',
      degatsStat:  meta.degatsStat || document.getElementById('eq-stat-attaque')?.value || 'force',
      toucherStat: meta.toucherStat || document.getElementById('eq-stat-attaque')?.value || 'force',
      statAttaque: document.getElementById('eq-stat-attaque')?.value||'force',
      typeArme:    document.getElementById('eq-type-arme')?.value||'',
      portee:      document.getElementById('eq-portee')?.value||'',
      particularite: document.getElementById('eq-particularite')?.value||'',
      format:  meta.format || '',
      toucher: meta.toucher || '',
      stats:   meta.stats || '',
      fo: parseInt(meta.fo) || 0,
      dex: parseInt(meta.dex) || 0,
      in: parseInt(meta.in) || 0,
      sa: parseInt(meta.sa) || 0,
      co: parseInt(meta.co) || 0,
      ch: parseInt(meta.ch) || 0,
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
      typeArmure: meta.typeArmure||'',
      slotArmure: meta.slotArmure||'',
      slotBijou: meta.slotBijou || (['Amulette','Anneau','Objet magique'].includes(slot) ? slot : ''),
    };
  }
  c.equipement = equip;
  const bonus = computeEquipStatsBonus(equip);
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
  const bonus = computeEquipStatsBonus(equip);
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
  sellInvItem, openSellInvModal, sellInvItemBulk,
  openDeleteInvModal, deleteInvItemBulk,
  openSendInvModal, sendInvItem,
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
  _renderInventaireBoutique,
  renderCharInventaire, renderCharQuetes, renderCharNotes,
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete, deleteSort, deleteInvItem, deleteChar,
  createNewChar,
  inlineEditText, inlineEditNum, inlineEditStat,
  manageTitres, addTitre, removeTitre, saveTitres,
  addSort, editSort, openSortModal, runeIncrement, runeDecrement, updateSortPM, saveSort,
  editEquipSlot, saveEquipSlot, clearEquipSlot, equipSlotFromInv,
  previewEquipFromInv,
  addInvItem, editInvItem, saveInvItem,
  addQuete, saveQuete,
  deleteCharPhoto,
});
