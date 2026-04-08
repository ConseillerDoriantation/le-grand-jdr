import { getDocData, saveDoc, loadCollection, updateInCol } from '../data/firestore.js';
import { openModal, closeModal, closeModalDirect } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ══════════════════════════════════════════════════════════════════════════════
// AMÉLIORATIONS STATIQUES (préchargées par défaut)
// Les améliorations custom sont dans data.ameliorationsCustom[]
// ══════════════════════════════════════════════════════════════════════════════

export const BASTION_AMELIORATIONS_DEFAULT = [
  { id:'cuisine',    nom:'Cuisine',              emoji:'🍳', cout:500,
    description:'Cuisiner avant mission sans marmite ni pierre de feu.',
    detail:'Permet de préparer des repas avant mission. Les bonus alimentaires s\'appliquent normalement.' },
  { id:'alchimie',   nom:"Atelier d'Alchimie",   emoji:'⚗️', cout:500,
    description:'Préparer des potions avant mission sans alambic ni feu.',
    detail:'Permet de préparer des potions avant mission. Aucun alambic requis.' },
  { id:'forge',      nom:'Forge',                emoji:'⚒️', cout:500,
    description:'Crafter armes physiques et armures lourdes avec recette.',
    detail:'Permet de fabriquer des armes physiques et armures lourdes, à condition de posséder la recette.' },
  { id:'confection', nom:'Atelier de Confection', emoji:'🧵', cout:500,
    description:'Crafter armes à dist., armures légères et intermédiaires.',
    detail:'Permet de fabriquer des armes à distance physiques, armures légères et intermédiaires.' },
  { id:'orfevrerie', nom:"Atelier d'Orfèvre",    emoji:'💎', cout:500,
    description:'Crafter armes magiques et bijoux avec recette connue.',
    detail:'Permet de fabriquer des armes magiques et bijoux. Recette et matériaux nécessaires.' },
  { id:'stockage',   nom:'Extension Stockage',   emoji:'📦', cout:200,
    description:'+10 emplacements de stockage permanent au Bastion.',
    detail:'Augmente la capacité de stockage de 10 emplacements. Peut être achetée plusieurs fois.' },
];

export const BASTION_EVENTS = [
  { id:'vol',        nom:'Vol',               emoji:'🗡️', description:'Des voleurs ont sévi cette nuit.',
    effet:'-20% des revenus totaux',    modificateur:0.80, bonus:0,  couleur:'crimson', badgeClass:'badge-red',   badgeText:'−20%' },
  { id:'inspection', nom:'Inspection',        emoji:'📜', description:'Les autorités ont inspecté les lieux.',
    effet:'Revenu normal',              modificateur:1.0,  bonus:0,  couleur:'neutral', badgeClass:'badge-blue',  badgeText:'±0' },
  { id:'calme',      nom:'Calme',             emoji:'☁️', description:'Une période tranquille, sans événement notable.',
    effet:'Revenu normal',              modificateur:1.0,  bonus:0,  couleur:'neutral', badgeClass:'badge-blue',  badgeText:'±0' },
  { id:'riche',      nom:'Clientèle riche',   emoji:'💰', description:'Des clients fortunés ont fait une commande.',
    effet:'+10 or ce cycle',            modificateur:1.0,  bonus:10, couleur:'gold',    badgeClass:'badge-gold',  badgeText:'+10 or' },
  { id:'rumeur',     nom:'Rumeur favorable',  emoji:'📣', description:'Une bonne réputation court dans la région.',
    effet:'+20 or ce cycle',            modificateur:1.0,  bonus:20, couleur:'gold',    badgeClass:'badge-gold',  badgeText:'+20 or' },
  { id:'succes',     nom:'Succès commercial', emoji:'⭐', description:'Une période exceptionnellement faste.',
    effet:'+30 or ce cycle',            modificateur:1.0,  bonus:30, couleur:'green',   badgeClass:'badge-green', badgeText:'+30 or' },
];

// ══════════════════════════════════════════════════════════════════════════════
// CALCULS
// ══════════════════════════════════════════════════════════════════════════════

export function calculerRevenuBastion(data) {
  const amelios   = data.ameliorations || {};
  const custom    = data.ameliorationsCustom || [];
  const nbStatiq  = Object.values(amelios).filter(Boolean).length;
  const nbCustom  = custom.filter(a => (a.fondsActuels||0) >= (a.cout||0) && (a.cout||0) > 0).length;
  const nbAmelios = nbStatiq + nbCustom;
  const base      = 100 + nbAmelios * 100;
  const evtId     = data.evenementCourant || 'calme';
  const evt       = BASTION_EVENTS.find(e => e.id === evtId) || BASTION_EVENTS[2];
  const brut      = Math.round(base * evt.modificateur) + (evt.bonus || 0);
  // 10% aux fondateurs, 90% disparaissent (ne vont pas au trésor)
  const fondateurs = Math.round(brut * 0.1);
  return { brut, fondateurs, base, nbAmelios, evt };
}

export function getDefaultBastion() {
  return {
    nom:'Le Bastion', niveau:1, tresor:0, defense:0,
    description:'Votre bastion attend sa première description.',
    ameliorations:{}, ameliorationsCustom:[],
    evenementCourant:'calme',
    fondateurs:[], historique:[],
    activite:'', pnj:'', salles:[], journal:[],
    inventaire:[], missions:[],
    invLimite:20, invHistorique:[],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ══════════════════════════════════════════════════════════════════════════════

function _normFondateurs(arr) {
  return (arr||[]).map(f => typeof f==='object'&&f!==null ? f : { charId:null, nom:String(f) });
}
function _getCharOr(char) {
  // Même logique que calcOr dans characters.js
  const compte = char?.compte || { recettes:[], depenses:[] };
  const totalR = (compte.recettes||[]).reduce((s,r) => s + (parseFloat(r?.montant)||0), 0);
  const totalD = (compte.depenses||[]).reduce((s,d) => s + (parseFloat(d?.montant)||0), 0);
  const fromCompte = Math.round((totalR - totalD) * 100) / 100;
  if (totalR > 0 || totalD > 0) return Math.max(0, fromCompte);
  // Fallback : champ or direct (ancien format)
  return Math.max(0, parseInt(char?.or) || 0);
}
async function _setCharOr(char, newOr) {
  const safe  = Math.max(0, Math.round(newOr * 100) / 100);
  const delta = safe - _getCharOr(char);
  if (delta === 0) return;
  const now = new Date().toLocaleDateString('fr-FR');
  const compte = { recettes:[], depenses:[], ...(char.compte || {}) };
  if (delta > 0) {
    compte.recettes = [...compte.recettes, { date: now, libelle: 'Or récupéré du Bastion', montant: delta }];
  } else {
    compte.depenses = [...compte.depenses, { date: now, libelle: 'Or déposé au Bastion', montant: Math.abs(delta) }];
  }
  char.compte = compte;
  await updateInCol('characters', char.id, { compte });
}

// Fusionner les améliorations statiques avec les données sauvegardées
function _getAllAmeliorations(data) {
  const amelios  = data.ameliorations || {};
  const config   = data.ameliorationsConfig || {}; // overrides MJ (coût, nom, desc...)
  const statiques = BASTION_AMELIORATIONS_DEFAULT.map(a => {
    const ov   = config[a.id] || {};
    const cout = ov.cout ?? a.cout;
    return {
      ...a,
      nom:         ov.nom         || a.nom,
      emoji:       ov.emoji       || a.emoji,
      description: ov.description || a.description,
      detail:      ov.detail      || a.detail,
      cout,
      type:        'statique',
      fondsActuels: amelios[a.id] ? cout : (data.ameliorationsFonds?.[a.id] || 0),
      debloquee:   !!amelios[a.id],
    };
  });
  const custom = (data.ameliorationsCustom || []).map(a => ({
    ...a, type:'custom',
    debloquee: (a.fondsActuels||0) >= (a.cout||1) && (a.cout||1) > 0,
  }));
  return [...statiques, ...custom];
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉDITION INFOS GÉNÉRALES
// ══════════════════════════════════════════════════════════════════════════════

export const BASTION_AMELIORATIONS = BASTION_AMELIORATIONS_DEFAULT;

async function editBastion() {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const fondateursIds = _normFondateurs(current.fondateurs).map(f=>f.charId).filter(Boolean);
  const chars = STATE.characters || [];
  openModal('🏰 Modifier le Bastion', `
    <div class="form-group"><label>Nom du Bastion</label>
      <input class="input-field" id="b-nom" value="${current.nom||''}"></div>
    <div class="grid-2" style="gap:.75rem">
      <div class="form-group"><label>Trésor (or)</label>
        <input type="number" class="input-field" id="b-tresor" value="${current.tresor||0}"></div>
      <div class="form-group"><label>Défense</label>
        <input type="number" class="input-field" id="b-defense" value="${current.defense||0}"></div>
    </div>
    <div class="form-group"><label>Activité principale</label>
      <input class="input-field" id="b-activite" value="${current.activite||''}" placeholder="ex: Commerce d'armes"></div>
    <div class="form-group"><label>PNJ en charge</label>
      <input class="input-field" id="b-pnj" value="${current.pnj||''}" placeholder="ex: Aldric le Forgeron"></div>
    <div class="form-group"><label>Limite inventaire (objets max)</label>
      <input type="number" class="input-field" id="b-invlimite" value="${current.invLimite||20}" min="1"></div>
    <div class="form-group">
      <label>Fondateurs — reçoivent 10% du brut à chaque cycle</label>
      <div style="display:flex;flex-direction:column;gap:.3rem;padding:.5rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;max-height:160px;overflow-y:auto">
        ${chars.length===0
          ? '<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;padding:.4rem">Aucun personnage.</p>'
          : chars.map(c=>`<label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;padding:.25rem .35rem;border-radius:6px">
              <input type="checkbox" id="fond-${c.id}" value="${c.id}" ${fondateursIds.includes(c.id)?'checked':''}
                style="width:15px;height:15px;accent-color:var(--gold)">
              <span style="font-size:.83rem;color:var(--text)">${c.nom||'?'}</span>
              <span style="font-size:.68rem;color:var(--text-dim);margin-left:auto">${c.classe||''}</span>
            </label>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>Description</label>
      <textarea class="input-field" id="b-description" rows="3">${current.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastionInfos()">Enregistrer</button>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
    <button class="btn btn-outline" style="width:100%;color:#ff6b6b;border-color:rgba(255,107,107,.3);font-size:.8rem"
      onclick="resetBastion()">🗑️ Remettre le Bastion à zéro</button>
  `);
}

async function saveBastionInfos() {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const chars   = STATE.characters || [];
  const fondateurs = chars
    .filter(c => document.getElementById(`fond-${c.id}`)?.checked)
    .map(c => ({ charId: c.id, nom: c.nom||'?' }));
  await saveDoc('bastion','main', {
    ...current,
    nom:         document.getElementById('b-nom')?.value?.trim()||'Le Bastion',
    tresor:      parseInt(document.getElementById('b-tresor')?.value,10)||0,
    defense:     parseInt(document.getElementById('b-defense')?.value,10)||0,
    activite:    document.getElementById('b-activite')?.value?.trim()||'',
    pnj:         document.getElementById('b-pnj')?.value?.trim()||'',
    invLimite:   parseInt(document.getElementById('b-invlimite')?.value,10)||20,
    fondateurs,
    description: document.getElementById('b-description')?.value||'',
  });
  closeModalDirect();
  showNotif('Bastion mis à jour.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// AMÉLIORATIONS — GESTION COMPLÈTE
// ══════════════════════════════════════════════════════════════════════════════

// Ouvre le modal de gestion des améliorations (MJ)
async function gererAmeliorations() {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const toutes  = _getAllAmeliorations(current);
  openModal('🏗️ Gérer les améliorations', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
      <span style="font-size:.78rem;color:var(--text-dim)">${toutes.length} amélioration${toutes.length!==1?'s':''}</span>
      <button class="btn btn-gold btn-sm" onclick="creerAmeliorationCustom()">+ Nouvelle</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:.5rem;max-height:60vh;overflow-y:auto">
      ${toutes.map(a => {
        const pct      = a.cout > 0 ? Math.min(100, Math.round((a.fondsActuels||0)/a.cout*100)) : 100;
        const pctColor = pct>=100?'#22c38e':pct>50?'var(--gold)':'#4f8cff';
        return `
        <div style="padding:.7rem .85rem;background:var(--bg-elevated);border:1px solid ${a.debloquee?'rgba(34,195,142,.3)':'var(--border)'};border-radius:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.35rem">
            <div style="display:flex;align-items:center;gap:.45rem">
              <span>${a.emoji||'🔧'}</span>
              <span style="font-family:'Cinzel',serif;font-size:.85rem;color:${a.debloquee?'#22c38e':'var(--text)'}">${a.nom}</span>
              ${a.type==='custom'?`<span style="font-size:.6rem;background:rgba(79,140,255,.12);color:#7fb0ff;border:1px solid rgba(79,140,255,.2);border-radius:4px;padding:1px 5px">Custom</span>`:''}
            </div>
            <div style="display:flex;gap:.3rem;flex-shrink:0;align-items:center">
              <button class="btn-icon" style="font-size:.8rem" onclick="modifierAmelioration('${a.id}','${a.type||'statique'}')" title="Modifier le coût et les infos">✏️</button>
              ${a.type==='custom'?`<button class="btn-icon" style="color:#ff6b6b;font-size:.8rem" onclick="supprimerAmeliorationCustom('${a.id}')">🗑️</button>`:''}
              ${!a.debloquee?`<button class="btn-icon" style="font-size:.75rem;color:var(--gold)" onclick="debloquerManuellement('${a.id}','${a.type||'statique'}')" title="Débloquer manuellement">✅</button>`:''}
            </div>
          </div>
          ${a.description?`<p style="font-size:.74rem;color:var(--text-muted);margin:0 0 .4rem">${a.description}</p>`:''}
          ${!a.debloquee&&a.cout>0?`
          <div style="display:flex;align-items:center;gap:.5rem">
            <div style="flex:1;background:var(--bg-card);border-radius:999px;height:6px;overflow:hidden;border:1px solid var(--border)">
              <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:999px;transition:width .4s"></div>
            </div>
            <span style="font-size:.7rem;color:${pctColor};white-space:nowrap;font-weight:600">${a.fondsActuels||0}/${a.cout} or (${pct}%)</span>
          </div>`:a.debloquee?`<span style="font-size:.72rem;color:#22c38e">✓ Débloquée</span>`:''}
        </div>`;
      }).join('')}
    </div>
  `);
}

// Modifier une amélioration (statique ou custom)
async function modifierAmelioration(id, type) {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  let a;
  if (type === 'statique') {
    const base   = BASTION_AMELIORATIONS_DEFAULT.find(x => x.id === id);
    if (!base) return;
    const config = (current.ameliorationsConfig||{})[id] || {};
    a = { ...base, cout: config.cout ?? base.cout, description: config.description || base.description };
  } else {
    a = (current.ameliorationsCustom||[]).find(x => x.id === id);
    if (!a) return;
  }
  openModal(`✏️ Modifier — ${a.nom}`, `
    <div class="form-group"><label>Nom</label>
      <input class="input-field" id="ma-nom" value="${a.nom||''}"></div>
    <div class="form-group"><label>Emoji</label>
      <input class="input-field" id="ma-emoji" value="${a.emoji||'🔧'}" style="max-width:80px"></div>
    <div class="form-group">
      <label>Coût total (or) <span style="font-size:.7rem;color:var(--text-dim)">— montant à atteindre pour débloquer</span></label>
      <input type="number" class="input-field" id="ma-cout" value="${a.cout||500}" min="1">
    </div>
    <div class="form-group"><label>Description courte</label>
      <input class="input-field" id="ma-desc" value="${a.description||''}"></div>
    <div class="form-group"><label>Détail complet</label>
      <textarea class="input-field" id="ma-detail" rows="3">${a.detail||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem"
      onclick="confirmerModifAmelioration('${id}','${type}')">Enregistrer</button>
  `);
}

async function confirmerModifAmelioration(id, type) {
  const nom  = document.getElementById('ma-nom')?.value?.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  const cout = parseInt(document.getElementById('ma-cout')?.value)||500;
  const desc = document.getElementById('ma-desc')?.value?.trim()||'';
  const detail = document.getElementById('ma-detail')?.value?.trim()||'';
  const emoji = document.getElementById('ma-emoji')?.value?.trim()||'🔧';
  const current = (await getDocData('bastion','main')) || getDefaultBastion();

  if (type === 'statique') {
    // Stocker l'override dans ameliorationsConfig
    const config = { ...(current.ameliorationsConfig||{}), [id]: { nom, cout, description: desc, detail, emoji } };
    // Si le coût change et que des fonds ont déjà été investis, les conserver
    await saveDoc('bastion','main', { ...current, ameliorationsConfig: config });
  } else {
    const customs = (current.ameliorationsCustom||[]).map(a =>
      a.id === id ? { ...a, nom, cout, description: desc, detail, emoji } : a);
    await saveDoc('bastion','main', { ...current, ameliorationsCustom: customs });
  }
  closeModalDirect();
  showNotif('Amélioration mise à jour.','success');
  await PAGES.bastion();
}

// Créer une amélioration custom
async function creerAmeliorationCustom() {
  openModal('🔧 Nouvelle amélioration', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="ca-nom" placeholder="Bibliothèque, Écurie..."></div>
    <div class="form-group"><label>Emoji</label><input class="input-field" id="ca-emoji" value="🔧" style="max-width:80px"></div>
    <div class="form-group"><label>Coût total (or)</label><input type="number" class="input-field" id="ca-cout" value="500" min="1"></div>
    <div class="form-group"><label>Description courte</label><input class="input-field" id="ca-desc" placeholder="Décrit l'effet de l'amélioration"></div>
    <div class="form-group"><label>Détail complet</label><textarea class="input-field" id="ca-detail" rows="3" placeholder="Détails, règles..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="sauvegarderAmeliorationCustom('')">Créer</button>
  `);
}

async function modifierAmeliorationCustom(id) {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const a = (current.ameliorationsCustom||[]).find(x=>x.id===id);
  if (!a) return;
  openModal('✏️ Modifier l\'amélioration', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="ca-nom" value="${a.nom||''}"></div>
    <div class="form-group"><label>Emoji</label><input class="input-field" id="ca-emoji" value="${a.emoji||'🔧'}" style="max-width:80px"></div>
    <div class="form-group"><label>Coût total (or)</label><input type="number" class="input-field" id="ca-cout" value="${a.cout||500}" min="1"></div>
    <div class="form-group"><label>Description courte</label><input class="input-field" id="ca-desc" value="${a.description||''}"></div>
    <div class="form-group"><label>Détail complet</label><textarea class="input-field" id="ca-detail" rows="3">${a.detail||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="sauvegarderAmeliorationCustom('${id}')">Enregistrer</button>
  `);
}

async function sauvegarderAmeliorationCustom(id) {
  const nom = document.getElementById('ca-nom')?.value?.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const customs = current.ameliorationsCustom || [];
  const data = {
    id:          id || `ca_${Date.now()}`,
    nom,
    emoji:       document.getElementById('ca-emoji')?.value?.trim()||'🔧',
    cout:        parseInt(document.getElementById('ca-cout')?.value)||500,
    description: document.getElementById('ca-desc')?.value?.trim()||'',
    detail:      document.getElementById('ca-detail')?.value?.trim()||'',
    fondsActuels: id ? (customs.find(x=>x.id===id)?.fondsActuels||0) : 0,
  };
  const newCustoms = id ? customs.map(x=>x.id===id?data:x) : [...customs, data];
  await saveDoc('bastion','main', { ...current, ameliorationsCustom: newCustoms });
  closeModalDirect();
  showNotif(id?'Amélioration mise à jour.':'Amélioration créée !','success');
  await PAGES.bastion();
}

async function supprimerAmeliorationCustom(id) {
  if (!confirm('Supprimer cette amélioration ? Les fonds investis seront perdus.')) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  await saveDoc('bastion','main', { ...current, ameliorationsCustom: (current.ameliorationsCustom||[]).filter(a=>a.id!==id) });
  closeModalDirect();
  showNotif('Amélioration supprimée.','success');
  await PAGES.bastion();
}

// Débloquer manuellement (MJ) sans retirer du trésor
async function debloquerManuellement(id, type) {
  if (!confirm('Débloquer manuellement cette amélioration ?')) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  if (type === 'statique') {
    const amelios = { ...(current.ameliorations||{}), [id]:true };
    const nb = Object.values(amelios).filter(Boolean).length + (current.ameliorationsCustom||[]).filter(a=>(a.fondsActuels||0)>=(a.cout||1)&&(a.cout||1)>0).length;
    await saveDoc('bastion','main', { ...current, ameliorations:amelios, niveau:1+nb });
  } else {
    const customs = (current.ameliorationsCustom||[]).map(a => a.id===id ? { ...a, fondsActuels: a.cout||0 } : a);
    await saveDoc('bastion','main', { ...current, ameliorationsCustom: customs });
  }
  closeModalDirect();
  showNotif('Amélioration débloquée.','success');
  await PAGES.bastion();
}

// Investir dans une amélioration spécifique (joueur ou trésor)
async function investirAmelioration(amelioId, amelioType) {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const toutes  = _getAllAmeliorations(current);
  const amelio  = toutes.find(a => a.id === amelioId);
  if (!amelio) return;
  if (amelio.debloquee) { showNotif('Cette amélioration est déjà débloquée.','error'); return; }

  const manquant = Math.max(0, (amelio.cout||0) - (amelio.fondsActuels||0));
  const uid      = STATE.user?.uid;
  const chars    = (STATE.characters||[]).filter(c => c.uid === uid);
  const hasChar  = chars.length > 0;
  const orChar   = hasChar ? _getCharOr(chars[0]) : 0;

  openModal(`${amelio.emoji} Investir — ${amelio.nom}`, `
    <div style="margin-bottom:.85rem">
      <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.3rem">
        <span style="color:var(--text-muted)">Progression</span>
        <span style="color:var(--gold);font-weight:600">${amelio.fondsActuels||0} / ${amelio.cout} or</span>
      </div>
      <div style="background:var(--bg-elevated);border-radius:999px;height:10px;overflow:hidden;border:1px solid var(--border)">
        <div style="height:100%;width:${Math.min(100,Math.round((amelio.fondsActuels||0)/(amelio.cout||1)*100))}%;
          background:linear-gradient(90deg,#4f8cff,var(--gold));border-radius:999px;transition:width .4s"></div>
      </div>
      <div style="font-size:.72rem;color:var(--text-dim);margin-top:.3rem">Reste : <strong>${manquant} or</strong></div>
    </div>
    ${hasChar?`
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.65rem 1rem;margin-bottom:.75rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted);font-size:.83rem">Ton or (${chars[0].nom||'?'})</span>
      <span style="font-family:'Cinzel',serif;color:var(--gold)">${orChar} or</span>
    </div>`:''}
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.65rem 1rem;margin-bottom:.85rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted);font-size:.83rem">Trésor du Bastion</span>
      <span style="font-family:'Cinzel',serif;color:var(--green)">${current.tresor||0} or</span>
    </div>
    <div class="form-group">
      <label>Montant à investir</label>
      <input type="number" class="input-field" id="inv-amelio-montant" min="1" max="${manquant}" value="${Math.min(manquant, hasChar?orChar:0)}" placeholder="0">
    </div>
    <div class="form-group"><label>Source des fonds</label>
      <select class="input-field" id="inv-amelio-source">
        ${hasChar?`<option value="perso">Mon personnage (${chars[0].nom||'?'})</option>`:''}
        <option value="tresor">Trésor du Bastion</option>
      </select>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.25rem"
      onclick="confirmerInvestissementAmelioration('${amelioId}','${amelioType}')">Investir</button>
  `);
}

async function confirmerInvestissementAmelioration(amelioId, amelioType) {
  const montant = parseInt(document.getElementById('inv-amelio-montant')?.value)||0;
  const source  = document.getElementById('inv-amelio-source')?.value||'tresor';
  if (montant < 1) { showNotif('Montant invalide.','error'); return; }

  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const toutes  = _getAllAmeliorations(current);
  const amelio  = toutes.find(a => a.id === amelioId);
  if (!amelio) return;
  const manquant = Math.max(0,(amelio.cout||0)-(amelio.fondsActuels||0));
  const invest   = Math.min(montant, manquant);
  if (invest < 1) { showNotif('Amélioration déjà financée.','success'); closeModalDirect(); return; }

  let nomSource = 'Trésor';
  if (source === 'perso') {
    const chars = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
    if (!chars.length) { showNotif('Personnage introuvable.','error'); return; }
    const char = chars[0];
    if (_getCharOr(char) < invest) { showNotif('Fonds insuffisants.','error'); return; }
    await _setCharOr(char, _getCharOr(char) - invest);
    nomSource = char.nom||'?';
  } else {
    if ((current.tresor||0) < invest) { showNotif('Trésor insuffisant.','error'); return; }
    await saveDoc('bastion','main', { ...current, tresor: (current.tresor||0) - invest });
  }

  // Recharger après modif trésor éventuelle
  const fresh = (await getDocData('bastion','main')) || getDefaultBastion();
  const nouveauxFonds = (amelio.fondsActuels||0) + invest;
  const estDebloque   = nouveauxFonds >= (amelio.cout||1);

  let toSave = { ...fresh };
  if (amelioType === 'statique') {
    const fonds = { ...(fresh.ameliorationsFonds||{}), [amelioId]: nouveauxFonds };
    toSave.ameliorationsFonds = fonds;
    if (estDebloque) {
      toSave.ameliorations = { ...(fresh.ameliorations||{}), [amelioId]:true };
      const nb = Object.values(toSave.ameliorations).filter(Boolean).length +
                 (fresh.ameliorationsCustom||[]).filter(a=>(a.fondsActuels||0)>=(a.cout||1)&&(a.cout||1)>0).length;
      toSave.niveau = 1 + nb;
    }
  } else {
    toSave.ameliorationsCustom = (fresh.ameliorationsCustom||[]).map(a =>
      a.id === amelioId ? { ...a, fondsActuels: nouveauxFonds } : a);
  }

  await saveDoc('bastion','main', toSave);
  closeModalDirect();
  showNotif(
    estDebloque
      ? `🎉 ${amelio.nom} débloquée grâce à l'investissement de ${nomSource} !`
      : `+${invest} or investi par ${nomSource} — ${nouveauxFonds}/${amelio.cout} or`,
    'success'
  );
  await PAGES.bastion();
}

// Rétrocompat — débloquer depuis le trésor directement (ancien flow)
async function debloquerAmelioration(id) {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const amelio  = BASTION_AMELIORATIONS_DEFAULT.find(a => a.id === id);
  if (!amelio) return;
  const fondsActuels = current.ameliorationsFonds?.[id] || 0;
  const restant = amelio.cout - fondsActuels;
  if ((current.tresor||0) < restant) {
    showNotif(`Fonds insuffisants — il manque ${restant} or.`,'error'); return;
  }
  await investirAmelioration(id, 'statique');
}

async function confirmDebloquer(id) {
  await confirmerInvestissementAmelioration(id, 'statique');
}

// ══════════════════════════════════════════════════════════════════════════════
// CYCLE — événement + distribution fondateurs
// ══════════════════════════════════════════════════════════════════════════════

async function tirerEvenement() {
  const idx     = Math.floor(Math.random() * BASTION_EVENTS.length);
  const evt     = BASTION_EVENTS[idx];
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const { brut, fondateurs: partFondateurs } = calculerRevenuBastion({ ...current, evenementCourant: evt.id });
  const fondateursList   = _normFondateurs(current.fondateurs||[]);
  const partParFondateur = fondateursList.length > 0 ? Math.round(partFondateurs / fondateursList.length) : 0;

  // Distribuer les 10% aux fondateurs
  const distributions = [];
  if (partParFondateur > 0) {
    for (const f of fondateursList) {
      if (!f.charId) continue;
      const char = (STATE.characters||[]).find(c => c.id === f.charId);
      if (!char) continue;
      await _setCharOr(char, _getCharOr(char) + partParFondateur);
      distributions.push({ charId: f.charId, nom: f.nom, montant: partParFondateur });
    }
  }

  const historique = current.historique || [];
  historique.push({
    id:              `h_${Date.now()}`,
    session:         historique.length + 1,
    date:            new Date().toLocaleDateString('fr-FR'),
    brut, partFondateurs, partParFondateur,
    evenement:       evt.nom, evtId: evt.id,
    distributions,
  });

  // Le trésor n'est PAS modifié — les 90% ne vont nulle part
  await saveDoc('bastion','main', { ...current, evenementCourant: evt.id, historique });

  const distText = distributions.length > 0
    ? ` — Fondateurs : ${distributions.map(d => `${d.nom} +${d.montant} or`).join(', ')}`
    : ' — Aucun fondateur';
  showNotif(`${evt.emoji} ${evt.nom} — ${brut} or brut, ${partFondateurs} or distribués${distText}`, 'success');
  await PAGES.bastion();
}

async function investirOrBastion() {
  const chars = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
  if (!chars.length) { showNotif('Aucun personnage trouvé.','error'); return; }
  const char = chars[0];
  openModal('💰 Investir dans le Bastion', `
    <p style="color:var(--text-muted);font-size:.84rem;margin-bottom:1rem">Verse de l'or dans le trésor du Bastion.</p>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.7rem 1rem;margin-bottom:1rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted);font-size:.84rem">Or de ${char.nom||'?'}</span>
      <span style="font-family:'Cinzel',serif;color:var(--gold)">${_getCharOr(char)} or</span>
    </div>
    <div class="form-group"><label>Montant</label>
      <input type="number" class="input-field" id="invest-montant" min="1" max="${_getCharOr(char)}" placeholder="0"></div>
    <div class="form-group"><label>Message (optionnel)</label>
      <input class="input-field" id="invest-msg" placeholder="Pour la forge !"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="confirmerInvestissement()">Investir</button>
  `);
}

async function confirmerInvestissement() {
  const montant = parseInt(document.getElementById('invest-montant')?.value)||0;
  const msg     = document.getElementById('invest-msg')?.value?.trim()||'';
  if (montant < 1) { showNotif('Montant invalide.','error'); return; }
  const chars = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
  const char  = chars[0];
  if (!char) return;
  if (_getCharOr(char) < montant) { showNotif('Fonds insuffisants.','error'); return; }
  await _setCharOr(char, _getCharOr(char) - montant);
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const historique = current.historique || [];
  historique.push({
    id:`inv_${Date.now()}`, session:historique.length+1,
    date:new Date().toLocaleDateString('fr-FR'),
    type:'investissement',
    investisseur:{ charId:char.id, nom:char.nom||'?' },
    montant, message:msg,
    brut:0, reinvesti:0, partFondateurs:0, distributions:[],
  });
  await saveDoc('bastion','main', { ...current, tresor:(current.tresor||0)+montant, historique });
  closeModalDirect();
  showNotif(`+${montant} or investis dans le Bastion !`,'success');
  await PAGES.bastion();
}

async function supprimerHistorique(entryId) {
  if (!confirm('Supprimer ce cycle ? L\'or distribué aux fondateurs sera récupéré.')) return;
  const current    = (await getDocData('bastion','main')) || getDefaultBastion();
  const historique = current.historique || [];
  const entry      = historique.find(h => h.id === entryId);
  if (!entry) { showNotif('Entrée introuvable.','error'); return; }

  const chars = STATE.characters || [];

  if (entry.type === 'investissement') {
    // Rembourser le joueur et retirer du trésor
    const tresor = (current.tresor || 0) - entry.montant;
    const char   = chars.find(c => c.id === entry.investisseur?.charId);
    if (char) await _setCharOr(char, _getCharOr(char) + entry.montant);
    const newHist = historique.filter(h => h.id !== entryId);
    newHist.filter(h=>h.session).forEach((h,i)=>{ h.session = i+1; });
    await saveDoc('bastion','main', { ...current, tresor: Math.max(0, tresor), historique: newHist });
  } else {
    // Cycle normal : reprendre uniquement les 10% distribués aux fondateurs
    // Le trésor n'a pas été modifié lors du cycle, donc on ne le touche pas
    for (const d of (entry.distributions||[])) {
      const char = chars.find(c => c.id === d.charId);
      if (char) await _setCharOr(char, Math.max(0, _getCharOr(char) - d.montant));
    }
    const newHist = historique.filter(h => h.id !== entryId);
    newHist.filter(h=>h.session).forEach((h,i)=>{ h.session = i+1; });
    await saveDoc('bastion','main', { ...current, historique: newHist });
  }

  showNotif('Cycle supprimé et distributions annulées.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// INVENTAIRE DU BASTION
// ══════════════════════════════════════════════════════════════════════════════

async function ouvrirInventaireBastion() {
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const inv      = current.inventaire || [];
  const invHisto = current.invHistorique || [];
  const limite   = current.invLimite || 20;
  const isAdmin  = STATE.isAdmin;
  const uid      = STATE.user?.uid;
  const hasChar  = (STATE.characters||[]).some(c => c.uid === uid);
  const pct      = Math.min(100, Math.round(inv.length/limite*100));
  const pctColor = pct>=90?'#ff6b6b':pct>=70?'#e8b84b':'#22c38e';

  // Onglets : Stock / Historique
  openModal('📦 Inventaire du Bastion', `
    <div style="display:flex;gap:.5rem;margin-bottom:.75rem">
      <button id="inv-tab-stock" onclick="window._bastionInvTab('stock')"
        style="flex:1;padding:.4rem .75rem;border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer;
        background:rgba(79,140,255,.12);border:1px solid rgba(79,140,255,.3);color:var(--gold)">📦 Stock</button>
      <button id="inv-tab-histo" onclick="window._bastionInvTab('histo')"
        style="flex:1;padding:.4rem .75rem;border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer;
        background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-muted)">📜 Historique</button>
    </div>

    <!-- Jauge capacité -->
    <div style="margin-bottom:.75rem">
      <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-dim);margin-bottom:.25rem">
        <span>Capacité</span>
        <span style="color:${pctColor};font-weight:600">${inv.length} / ${limite} emplacements</span>
      </div>
      <div style="background:var(--bg-elevated);border-radius:999px;height:7px;overflow:hidden;border:1px solid var(--border)">
        <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:999px;transition:width .3s"></div>
      </div>
    </div>

    <!-- Panneau Stock -->
    <div id="inv-panel-stock" style="display:flex;flex-direction:column;gap:.4rem">
      <div style="display:flex;justify-content:flex-end;gap:.4rem;margin-bottom:.35rem">
        ${hasChar||isAdmin ? `<button class="btn btn-gold btn-sm" onclick="ajouterDepuisInventaire()">📤 Depuis mon inventaire</button>` : ''}
        ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="deposerOrBastion()">💰 Or</button>` : (hasChar ? `<button class="btn btn-outline btn-sm" onclick="deposerOrBastion()">💰 Déposer de l'or</button>` : '')}
      </div>
      <div style="max-height:45vh;overflow-y:auto;display:flex;flex-direction:column;gap:.35rem">
        ${inv.length===0
          ? `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">Inventaire vide.</div>`
          : inv.map(item => {
              const isOr = item.type === 'or';
              return `<div style="display:flex;align-items:center;gap:.7rem;padding:.55rem .7rem;
                background:var(--bg-elevated);border:1px solid ${isOr?'rgba(232,184,75,.2)':'var(--border)'};border-radius:10px">
                <span style="font-size:1.1rem">${isOr?'💰':'📦'}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.85rem;font-weight:600;color:var(--text)">${item.nom||'?'}
                    ${item.quantite>1?`<span style="font-size:.7rem;color:var(--gold)"> ×${item.quantite}</span>`:''}
                  </div>
                  ${item.description?`<div style="font-size:.72rem;color:var(--text-dim)">${item.description}</div>`:''}
                  <div style="font-size:.64rem;color:var(--text-dim)">Par ${item.deposePar||'?'} · ${item.date||''}</div>
                </div>
                <div style="display:flex;gap:.25rem;flex-shrink:0">
                  ${hasChar?`<button class="btn btn-outline btn-sm" style="font-size:.7rem" onclick="recupererObjetBastion('${item.id}')">↩ Récup.</button>`:''}
                  ${isAdmin?`<button class="btn-icon" style="color:#ff6b6b;font-size:.8rem" onclick="supprimerObjetBastion('${item.id}')">🗑️</button>`:''}
                </div>
              </div>`;
            }).join('')}
      </div>
    </div>

    <!-- Panneau Historique -->
    <div id="inv-panel-histo" style="display:none;max-height:52vh;overflow-y:auto">
      ${invHisto.length===0
        ? `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">Aucun échange enregistré.</div>`
        : [...invHisto].reverse().map(h => {
            const isDepot = h.action === 'depot';
            return `<div style="display:flex;align-items:center;gap:.65rem;padding:.5rem .65rem;
              border-bottom:1px solid var(--border);font-size:.8rem">
              <span style="font-size:1rem;flex-shrink:0">${isDepot?'⬇️':'⬆️'}</span>
              <div style="flex:1;min-width:0">
                <div style="color:var(--text);font-weight:500">${h.nom||'?'}${h.quantite>1?` ×${h.quantite}`:''}</div>
                <div style="font-size:.68rem;color:var(--text-dim)">${isDepot?'Déposé':'Récupéré'} par <strong>${h.par||'?'}</strong> · ${h.date||''}</div>
              </div>
            </div>`;
          }).join('')}
    </div>
  `);
}

// Switch onglet inventaire
window._bastionInvTab = (tab) => {
  const stock = document.getElementById('inv-panel-stock');
  const histo = document.getElementById('inv-panel-histo');
  const btnS  = document.getElementById('inv-tab-stock');
  const btnH  = document.getElementById('inv-tab-histo');
  if (!stock||!histo) return;
  const isStock = tab === 'stock';
  stock.style.display = isStock ? 'flex' : 'none';
  histo.style.display = isStock ? 'none'  : 'block';
  if (btnS) { btnS.style.background = isStock?'rgba(79,140,255,.12)':'var(--bg-elevated)'; btnS.style.color=isStock?'var(--gold)':'var(--text-muted)'; btnS.style.borderColor=isStock?'rgba(79,140,255,.3)':'var(--border)'; }
  if (btnH) { btnH.style.background = isStock?'var(--bg-elevated)':'rgba(79,140,255,.12)'; btnH.style.color=isStock?'var(--text-muted)':'var(--gold)'; btnH.style.borderColor=isStock?'var(--border)':'rgba(79,140,255,.3)'; }
};

// Déposer depuis l'inventaire du personnage
async function ajouterDepuisInventaire() {
  const uid   = STATE.user?.uid;
  const chars = STATE.isAdmin
    ? (STATE.characters||[])
    : (STATE.characters||[]).filter(c => c.uid === uid);
  if (!chars.length) { showNotif('Aucun personnage trouvé.','error'); return; }

  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const limite  = current.invLimite || 20;
  const invBast = current.inventaire || [];
  if (invBast.length >= limite) { showNotif(`Inventaire plein (${limite} objets max).`,'error'); return; }

  // Toujours lire depuis Firestore pour être sûr d'avoir l'inventaire à jour
  const char = chars[0];
  const charData = await getDocData('characters', char.id);
  const invFrais = Array.isArray(charData?.inventaire) ? charData.inventaire : (char.inventaire || []);
  // Mettre à jour la mémoire
  char.inventaire = invFrais;

  const equips = new Set(Object.values(char.equipement||{}).filter(Boolean).map(e=>e.id||e.nom));
  // Stocker les items disponibles dans window pour y accéder à la confirmation
  window._depotCharId = char.id;
  window._depotInvFrais = invFrais; // référence à l'inventaire Firestore
  window._depotItems = invFrais
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !equips.has(item.id) && !equips.has(item.nom));

  openModal('📤 Déposer depuis mon inventaire', `
    <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.75rem">Sélectionne les objets à déposer au Bastion.</p>
    ${STATE.isAdmin&&chars.length>1?`
    <div class="form-group"><label>Personnage</label>
      <select class="input-field" id="dep-char-sel" onchange="window._bastionRefreshDepot()">
        ${chars.map(c=>`<option value="${c.id}">${c.nom||'?'}</option>`).join('')}
      </select></div>`:''}
    <div id="dep-inv-list" style="display:flex;flex-direction:column;gap:.35rem;max-height:50vh;overflow-y:auto">
      ${_renderDepotList(window._depotItems)}
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.75rem" onclick="confirmerDepotDepuisInventaire()">Déposer les objets cochés</button>
  `);
}

function _renderDepotList(entries) {
  if (!entries.length) return `<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun objet disponible.</div>`;
  return entries.map(({ item, idx }) => `
    <label style="display:flex;align-items:center;gap:.65rem;padding:.4rem .5rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;cursor:pointer">
      <input type="checkbox"
        data-inv-idx="${idx}"
        style="width:15px;height:15px;accent-color:var(--gold)">
      <span style="font-size:.83rem;color:var(--text)">${item.nom||'?'}</span>
      ${item.quantite>1?`<span style="font-size:.7rem;color:var(--gold)">×${item.quantite}</span>`:''}
      ${item.description?`<span style="font-size:.7rem;color:var(--text-dim);margin-left:auto;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.description}</span>`:''}
    </label>`).join('');
}

window._bastionRefreshDepot = async () => {
  const selId = document.getElementById('dep-char-sel')?.value;
  const char  = (STATE.characters||[]).find(c=>c.id===selId);
  if (!char) return;
  // Relire depuis Firestore à chaque changement de perso
  const charData = await getDocData('characters', char.id);
  const invFrais = Array.isArray(charData?.inventaire) ? charData.inventaire : (char.inventaire || []);
  char.inventaire = invFrais;
  const equips = new Set(Object.values(char.equipement||{}).filter(Boolean).map(e=>e.id||e.nom));
  window._depotCharId = char.id;
  window._depotInvFrais = invFrais;
  window._depotItems = invFrais
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !equips.has(item.id) && !equips.has(item.nom));
  const listEl = document.getElementById('dep-inv-list');
  if (listEl) listEl.innerHTML = _renderDepotList(window._depotItems);
};

async function confirmerDepotDepuisInventaire() {
  const checked = [...document.querySelectorAll('#dep-inv-list input[type="checkbox"]:checked')];
  if (!checked.length) { showNotif('Aucun objet sélectionné.','error'); return; }

  // Récupérer les indexes dans l'inventaire Firestore (stockés au moment de l'ouverture du modal)
  const invFrais = window._depotInvFrais || [];
  const charId   = window._depotCharId;
  const uid      = STATE.user?.uid;
  const chars    = STATE.isAdmin ? (STATE.characters||[]) : (STATE.characters||[]).filter(c=>c.uid===uid);
  const char     = chars.find(c=>c.id===charId) || chars[0];
  if (!char) return;

  // Vérifier capacité bastion
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const limite  = current.invLimite || 20;
  const invBast = [...(current.inventaire||[])];
  const invHisto = [...(current.invHistorique||[])];

  if (invBast.length + checked.length > limite) {
    showNotif(`Capacité insuffisante (${limite - invBast.length} places restantes).`,'error'); return;
  }

  // Récupérer les vrais indexes dans invFrais depuis data-inv-idx
  const indexesARetirer = new Set(
    checked.map(cb => parseInt(cb.dataset.invIdx)).filter(n => !isNaN(n))
  );

  const now = new Date().toLocaleDateString('fr-FR');
  let counter = 0;
  for (const cb of checked) {
    const idx  = parseInt(cb.dataset.invIdx);
    const item = invFrais[idx];
    if (!item) continue;
    const uniqueId = `bi_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2,6)}`;
    // Sauvegarder l'item COMPLET pour pouvoir le restituer fidèlement
    invBast.push({ ...item, id: uniqueId, quantite: item.quantite||item.qte||1, deposePar: char.nom||'?', date: now });
    invHisto.push({ id:`bih_${Date.now()}_${counter}`, action:'depot', nom: item.nom||'?', quantite: item.quantite||1, par: char.nom||'?', date: now });
  }

  // Retirer exactement les items aux bons indexes depuis invFrais
  const newCharInv = invFrais.filter((_, idx) => !indexesARetirer.has(idx));
  await updateInCol('characters', char.id, { inventaire: newCharInv });
  char.inventaire = newCharInv;

  await saveDoc('bastion','main', { ...current, inventaire:invBast, invHistorique:invHisto });
  closeModalDirect();
  showNotif(`${checked.length} objet${checked.length>1?'s':''} déposé${checked.length>1?'s':''} au Bastion.`,'success');
  await ouvrirInventaireBastion();
}

async function recupererObjetBastion(itemId) {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const inv     = current.inventaire || [];
  const item    = inv.find(i=>i.id===itemId);
  if (!item) return;
  const chars = (STATE.characters||[]).filter(c=>c.uid===STATE.user?.uid);
  if (!chars.length) { showNotif('Aucun personnage trouvé.','error'); return; }
  const char = chars[0];

  if (item.type === 'or') {
    // Récupérer de l'or
    await _setCharOr(char, _getCharOr(char) + item.quantite);
  } else {
    const invChar = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
    const qteRecupere = parseInt(item.quantite || item.qte || 1) || 1;
    // Chercher un item stackable identique (même itemId ou même nom+template si pas d'itemId)
    const canStack = item.itemId || (item.nom && item.template);
    const existing = canStack ? invChar.find(i =>
      (item.itemId && i.itemId === item.itemId) ||
      (!item.itemId && i.nom === item.nom && i.template === item.template && i.template !== 'arme' && i.template !== 'armure' && i.template !== 'bijou')
    ) : null;
    if (existing) {
      // Stacker — incrémenter uniquement la quantité, sans toucher aux autres champs
      const baseQte = parseInt(existing.quantite || existing.qte || 1) || 1;
      const newQte  = baseQte + qteRecupere;
      existing.quantite = newQte;
      existing.qte      = String(newQte); // conserver le type string comme les items boutique
    } else {
      // Restituer l'item complet tel qu'il était (retirer uniquement les champs propres au bastion)
      const { id: _id, deposePar: _dep, date: _date, ...itemOriginal } = item;
      invChar.push({ ...itemOriginal, quantite: qteRecupere, qte: String(qteRecupere) });
    }
    await updateInCol('characters', char.id, { inventaire:invChar });
    char.inventaire = invChar;
  }

  const invHisto = [...(current.invHistorique||[])];
  invHisto.push({ id:`bih_${Date.now()}`, action:'retrait', nom:item.nom, quantite:item.quantite, par:char.nom||'?', date:new Date().toLocaleDateString('fr-FR') });

  await saveDoc('bastion','main', { ...current, inventaire:inv.filter(i=>i.id!==itemId), invHistorique:invHisto });
  showNotif(`${item.nom} récupéré !`,'success');
  await ouvrirInventaireBastion();
}

async function supprimerObjetBastion(itemId) {
  if (!confirm("Supprimer cet objet ?")) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  await saveDoc('bastion','main', { ...current, inventaire:(current.inventaire||[]).filter(i=>i.id!==itemId) });
  showNotif('Objet supprimé.','success');
  await ouvrirInventaireBastion();
}

// Déposer de l'or dans l'inventaire
async function deposerOrBastion() {
  const uid     = STATE.user?.uid;
  const chars   = (STATE.characters||[]).filter(c=>c.uid===uid);
  const hasChar = chars.length>0;
  const char    = hasChar ? chars[0] : null;
  const orDispo = hasChar ? _getCharOr(char) : null;
  openModal('💰 Déposer de l\'or au Bastion', `
    ${hasChar?`
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.7rem 1rem;margin-bottom:.75rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted);font-size:.83rem">Or de ${char.nom||'?'}</span>
      <span style="font-family:'Cinzel',serif;color:var(--gold)">${orDispo} or</span>
    </div>`:''}
    <div class="form-group"><label>Montant</label>
      <input type="number" class="input-field" id="or-bastion-montant" min="1" ${hasChar?`max="${orDispo}"`:''}  placeholder="0"></div>
    <div class="form-group"><label>Déposé par</label>
      <input class="input-field" id="or-bastion-par" value="${char?char.nom||'?':STATE.profile?.pseudo||'MJ'}"
        ${hasChar?'readonly':''}></div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="confirmerDepotOrBastion()">Déposer</button>
  `);
}

async function confirmerDepotOrBastion() {
  const montant = parseInt(document.getElementById('or-bastion-montant')?.value)||0;
  const par     = document.getElementById('or-bastion-par')?.value?.trim()||'?';
  if (montant < 1) { showNotif('Montant invalide.','error'); return; }

  const uid   = STATE.user?.uid;
  const chars = (STATE.characters||[]).filter(c=>c.uid===uid);
  const char  = chars[0]||null;
  if (char && _getCharOr(char) < montant) { showNotif('Fonds insuffisants.','error'); return; }
  if (char) await _setCharOr(char, _getCharOr(char) - montant);

  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const limite   = current.invLimite || 20;
  const inv      = current.inventaire || [];
  // Fusionner avec un éventuel coffre d'or existant ou créer une entrée
  const existing = inv.find(i=>i.type==='or');
  let newInv;
  if (existing) {
    newInv = inv.map(i=>i.type==='or' ? { ...i, quantite:(i.quantite||0)+montant, deposePar:par, date:new Date().toLocaleDateString('fr-FR') } : i);
  } else {
    if (inv.length >= limite) { showNotif(`Inventaire plein.`,'error'); return; }
    newInv = [...inv, { id:`or_${Date.now()}`, type:'or', nom:`Or (${montant})`, quantite:montant, description:'', deposePar:par, date:new Date().toLocaleDateString('fr-FR') }];
  }
  const invHisto = [...(current.invHistorique||[])];
  invHisto.push({ id:`bih_${Date.now()}`, action:'depot', nom:`Or`, quantite:montant, par, date:new Date().toLocaleDateString('fr-FR') });

  await saveDoc('bastion','main', { ...current, inventaire:newInv, invHistorique:invHisto });
  closeModalDirect();
  showNotif(`${montant} or déposé dans l'inventaire du Bastion.`,'success');
  await ouvrirInventaireBastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// RESET COMPLET DU BASTION
// ══════════════════════════════════════════════════════════════════════════════

async function resetBastion() {
  if (!confirm('⚠️ Remettre le Bastion à zéro ?\n\nToutes les données seront effacées : historique, inventaire, améliorations, missions, journal, fondateurs.\n\nCette action est irréversible.')) return;
  await saveDoc('bastion', 'main', getDefaultBastion());
  closeModalDirect();
  showNotif('Bastion remis à zéro.', 'success');
  await PAGES.bastion();
}

async function ouvrirMissionsBastion() {
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const missions = current.missions || [];
  const isAdmin  = STATE.isAdmin;
  openModal('⚔️ Missions spéciales du Bastion', `
    <div style="margin-bottom:.75rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:.78rem;color:var(--text-dim)">${missions.length} mission${missions.length!==1?'s':''}</span>
      ${isAdmin?`<button class="btn btn-gold btn-sm" onclick="creerMissionBastion()">+ Créer</button>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:.5rem;max-height:55vh;overflow-y:auto">
      ${missions.length===0
        ? `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">Aucune mission active.</div>`
        : missions.map(m => {
          const sc = m.statut==='terminée'?'#22c38e':m.statut==='échouée'?'#ff6b6b':'var(--gold)';
          return `<div style="padding:.75rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;margin-bottom:.3rem">
              <div style="font-weight:600;font-size:.9rem;color:var(--text)">${m.titre||'Mission'}</div>
              <span style="font-size:.68rem;padding:2px 8px;border-radius:999px;background:${sc}18;color:${sc};border:1px solid ${sc}44;flex-shrink:0">${m.statut||'active'}</span>
            </div>
            ${m.description?`<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.35rem;line-height:1.5">${m.description}</div>`:''}
            ${m.recompense?`<div style="font-size:.74rem;color:var(--gold)">🎁 ${m.recompense}</div>`:''}
            ${isAdmin?`<div style="display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" style="font-size:.7rem" onclick="changerStatutMission('${m.id}','terminée')">✅ Terminée</button>
              <button class="btn btn-outline btn-sm" style="font-size:.7rem" onclick="changerStatutMission('${m.id}','échouée')">❌ Échouée</button>
              <button class="btn btn-outline btn-sm" style="font-size:.7rem" onclick="changerStatutMission('${m.id}','active')">🔄 Réactiver</button>
              <button class="btn-icon" style="color:#ff6b6b;margin-left:auto" onclick="supprimerMissionBastion('${m.id}')">🗑️</button>
            </div>`:''}
          </div>`;}).join('')}
    </div>
  `);
}

async function creerMissionBastion() {
  openModal('⚔️ Nouvelle mission du Bastion', `
    <div class="form-group"><label>Titre</label><input class="input-field" id="miss-titre" placeholder="Défense du Bastion..."></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="miss-desc" rows="3" placeholder="Objectifs, contexte..."></textarea></div>
    <div class="form-group"><label>Récompense</label><input class="input-field" id="miss-recomp" placeholder="300 or, amélioration gratuite..."></div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="sauvegarderMissionBastion()">Créer</button>
  `);
}

async function sauvegarderMissionBastion() {
  const titre = document.getElementById('miss-titre')?.value?.trim();
  if (!titre) { showNotif('Titre requis.','error'); return; }
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const missions = current.missions || [];
  missions.push({ id:`ms_${Date.now()}`, titre, description:document.getElementById('miss-desc')?.value?.trim()||'', recompense:document.getElementById('miss-recomp')?.value?.trim()||'', statut:'active', date:new Date().toLocaleDateString('fr-FR') });
  await saveDoc('bastion','main', { ...current, missions });
  closeModalDirect();
  showNotif('Mission créée !','success');
  await PAGES.bastion();
}

async function changerStatutMission(id, statut) {
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  await saveDoc('bastion','main', { ...current, missions:(current.missions||[]).map(m=>m.id===id?{...m,statut}:m) });
  closeModalDirect();
  showNotif(`Mission "${statut}".`,'success');
  await PAGES.bastion();
}

async function supprimerMissionBastion(id) {
  if (!confirm('Supprimer cette mission ?')) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  await saveDoc('bastion','main', { ...current, missions:(current.missions||[]).filter(m=>m.id!==id) });
  closeModalDirect();
  showNotif('Mission supprimée.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// JOURNAL
// ══════════════════════════════════════════════════════════════════════════════

function addBastionLog() {
  openModal('📝 Ajouter une entrée au journal', `
    <div class="form-group"><label>Date</label><input class="input-field" id="bastion-log-date" value="${new Date().toLocaleDateString('fr-FR')}"></div>
    <div class="form-group"><label>Texte</label><textarea class="input-field" id="bastion-log-text" rows="5"></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastionLog()">Ajouter</button>
  `);
}

async function saveBastionLog() {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const journal = current.journal || [];
  journal.unshift({ id:`j_${Date.now()}`, date:document.getElementById('bastion-log-date')?.value?.trim()||new Date().toLocaleDateString('fr-FR'), texte:document.getElementById('bastion-log-text')?.value?.trim()||'' });
  await saveDoc('bastion','main', { ...current, journal });
  closeModalDirect();
  showNotif('Entrée ajoutée.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

Object.assign(window, {
  BASTION_AMELIORATIONS: BASTION_AMELIORATIONS_DEFAULT,
  BASTION_EVENTS, calculerRevenuBastion, getDefaultBastion,
  editBastion, saveBastionInfos, resetBastion,
  gererAmeliorations,
  modifierAmelioration, confirmerModifAmelioration,
  creerAmeliorationCustom, modifierAmeliorationCustom,
  sauvegarderAmeliorationCustom, supprimerAmeliorationCustom, debloquerManuellement,
  investirAmelioration, confirmerInvestissementAmelioration,
  debloquerAmelioration, confirmDebloquer,
  tirerEvenement, investirOrBastion, confirmerInvestissement, supprimerHistorique,
  ouvrirInventaireBastion, ajouterDepuisInventaire,
  confirmerDepotDepuisInventaire,
  recupererObjetBastion, supprimerObjetBastion,
  deposerOrBastion, confirmerDepotOrBastion,
  ouvrirMissionsBastion, creerMissionBastion, sauvegarderMissionBastion,
  changerStatutMission, supprimerMissionBastion,
  addBastionLog, saveBastionLog,
  saveBastion: saveBastionInfos,
});
