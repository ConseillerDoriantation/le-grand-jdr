import { getDocData, saveDoc, loadCollection, updateInCol } from '../data/firestore.js';
import { openModal, closeModal, closeModalDirect } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';

// ══════════════════════════════════════════════════════════════════════════════
// DONNÉES STATIQUES
// ══════════════════════════════════════════════════════════════════════════════

export const BASTION_AMELIORATIONS = [
  { id:'cuisine',    nom:'Cuisine',               emoji:'🍳', cout:500,
    description:'Cuisiner avant une mission sans marmite ni pierre de feu.',
    detail:'Permet à tout le groupe de préparer des repas avant de partir en mission. Aucun équipement requis.' },
  { id:'alchimie',   nom:"Atelier d'Alchimie",    emoji:'⚗️', cout:500,
    description:'Préparer des potions avant mission sans alambic ni feu.',
    detail:'Permet de préparer des potions avant une mission. Aucun alambic ni pierre de feu requis.' },
  { id:'forge',      nom:'Forge',                 emoji:'⚒️', cout:500,
    description:'Crafter armes physiques et armures lourdes avec recette.',
    detail:'Permet de fabriquer des armes physiques et armures lourdes, à condition de posséder la recette.' },
  { id:'confection', nom:'Atelier de Confection',  emoji:'🧵', cout:500,
    description:'Crafter armes à dist., armures légères et intermédiaires.',
    detail:'Permet de fabriquer des armes à distance physiques, armures légères et intermédiaires.' },
  { id:'orfevrerie', nom:"Atelier d'Orfèvre",      emoji:'💎', cout:500,
    description:'Crafter armes magiques et bijoux avec recette connue.',
    detail:'Permet de fabriquer des armes magiques et des bijoux. Chaque pièce nécessite la recette et les matériaux.' },
  { id:'stockage',   nom:'Extension Stockage',     emoji:'📦', cout:200,
    description:'+10 emplacements de stockage permanent au Bastion.',
    detail:'Augmente la capacité de stockage du Bastion de 10 emplacements. Peut être achetée plusieurs fois.' },
];

export const BASTION_EVENTS = [
  { id:'vol',        nom:'Vol',               emoji:'🗡️', description:'Des voleurs ont sévi cette nuit.',
    effet:'-20% des revenus totaux',    modificateur:0.80, bonus:0,  couleur:'crimson', badgeClass:'badge-red',   badgeText:'−20%' },
  { id:'inspection', nom:'Inspection',        emoji:'📜', description:'Les autorités ont inspecté les lieux. Tout est en ordre.',
    effet:'Revenu normal',              modificateur:1.0,  bonus:0,  couleur:'neutral', badgeClass:'badge-blue',  badgeText:'±0' },
  { id:'calme',      nom:'Calme',             emoji:'☁️', description:'Une période tranquille, sans événement notable.',
    effet:'Revenu normal',              modificateur:1.0,  bonus:0,  couleur:'neutral', badgeClass:'badge-blue',  badgeText:'±0' },
  { id:'riche',      nom:'Clientèle riche',   emoji:'💰', description:'Des clients fortunés ont fait une commande exceptionnelle.',
    effet:'+10 or ce cycle',            modificateur:1.0,  bonus:10, couleur:'gold',    badgeClass:'badge-gold',  badgeText:'+10 or' },
  { id:'rumeur',     nom:'Rumeur favorable',  emoji:'📣', description:'Une bonne réputation court dans toute la région.',
    effet:'+20 or ce cycle',            modificateur:1.0,  bonus:20, couleur:'gold',    badgeClass:'badge-gold',  badgeText:'+20 or' },
  { id:'succes',     nom:'Succès commercial', emoji:'⭐', description:'Une période exceptionnellement faste pour les affaires.',
    effet:'+30 or ce cycle',            modificateur:1.0,  bonus:30, couleur:'green',   badgeClass:'badge-green', badgeText:'+30 or' },
];

// ══════════════════════════════════════════════════════════════════════════════
// CALCULS
// ══════════════════════════════════════════════════════════════════════════════

export function calculerRevenuBastion(data) {
  const amelios   = data.ameliorations || {};
  const nbAmelios = Object.values(amelios).filter(Boolean).length;
  const base      = 100 + nbAmelios * 100;
  const evtId     = data.evenementCourant || 'calme';
  const evt       = BASTION_EVENTS.find(e => e.id === evtId) || BASTION_EVENTS[2];
  const brut      = Math.round(base * evt.modificateur) + (evt.bonus || 0);
  const fondateurs= Math.round(brut * 0.1);
  const reinvesti = brut - fondateurs;
  return { brut, fondateurs, reinvesti, base, nbAmelios, evt };
}

export function getDefaultBastion() {
  return {
    nom:'Le Bastion', niveau:1, tresor:0, defense:0,
    description:'Votre bastion attend sa première description.',
    ameliorations:{}, evenementCourant:'calme',
    fondateurs:[], historique:[],
    activite:'', pnj:'', salles:[], journal:[],
    inventaire:[], missions:[],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ══════════════════════════════════════════════════════════════════════════════

function _normFondateurs(arr) {
  return (arr||[]).map(f => typeof f === 'object' && f !== null ? f : { charId: null, nom: String(f) });
}

function _getCharOr(char) {
  return parseInt(char?.compte?.or ?? char?.or ?? 0) || 0;
}

async function _setCharOr(char, newOr) {
  const safe = Math.max(0, Math.round(newOr));
  if (char.compte !== undefined) {
    char.compte = { ...(char.compte||{}), or: safe };
    await updateInCol('characters', char.id, { compte: char.compte });
  } else {
    char.or = safe;
    await updateInCol('characters', char.id, { or: safe });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉDITION INFOS GÉNÉRALES
// ══════════════════════════════════════════════════════════════════════════════

async function editBastion() {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const fondateursIds = _normFondateurs(current.fondateurs).map(f => f.charId).filter(Boolean);
  const chars = STATE.characters || [];

  openModal('🏰 Modifier le Bastion', `
    <div class="form-group">
      <label>Nom du Bastion</label>
      <input class="input-field" id="b-nom" value="${current.nom||''}">
    </div>
    <div class="grid-2" style="gap:.75rem">
      <div class="form-group">
        <label>Trésor (or)</label>
        <input type="number" class="input-field" id="b-tresor" value="${current.tresor||0}">
      </div>
      <div class="form-group">
        <label>Défense</label>
        <input type="number" class="input-field" id="b-defense" value="${current.defense||0}">
      </div>
    </div>
    <div class="form-group">
      <label>Activité principale</label>
      <input class="input-field" id="b-activite" value="${current.activite||''}" placeholder="ex: Commerce d'armes">
    </div>
    <div class="form-group">
      <label>PNJ en charge</label>
      <input class="input-field" id="b-pnj" value="${current.pnj||''}" placeholder="ex: Aldric le Forgeron">
    </div>
    <div class="form-group">
      <label>Fondateurs — reçoivent 10% du brut à chaque cycle</label>
      <div style="display:flex;flex-direction:column;gap:.35rem;padding:.5rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;max-height:180px;overflow-y:auto">
        ${chars.length === 0
          ? '<p style="font-size:.78rem;color:var(--text-dim);font-style:italic;padding:.4rem">Aucun personnage trouvé.</p>'
          : chars.map(c => `
          <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;padding:.3rem .4rem;border-radius:8px">
            <input type="checkbox" id="fond-${c.id}" value="${c.id}" ${fondateursIds.includes(c.id)?'checked':''}
              style="width:16px;height:16px;cursor:pointer;accent-color:var(--gold)">
            <span style="font-size:.84rem;color:var(--text)">${c.nom||'?'}</span>
            <span style="font-size:.7rem;color:var(--text-dim);margin-left:auto">${c.classe||''}</span>
          </label>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="b-description" rows="3">${current.description||''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastionInfos()">Enregistrer</button>
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
    nom:         document.getElementById('b-nom')?.value?.trim() || 'Le Bastion',
    tresor:      parseInt(document.getElementById('b-tresor')?.value,10)||0,
    defense:     parseInt(document.getElementById('b-defense')?.value,10)||0,
    activite:    document.getElementById('b-activite')?.value?.trim()||'',
    pnj:         document.getElementById('b-pnj')?.value?.trim()||'',
    fondateurs,
    description: document.getElementById('b-description')?.value||'',
  });
  closeModalDirect();
  showNotif('Bastion mis à jour.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// AMÉLIORATIONS
// ══════════════════════════════════════════════════════════════════════════════

async function debloquerAmelioration(id) {
  const amelio  = BASTION_AMELIORATIONS.find(a => a.id === id);
  if (!amelio) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  if ((current.tresor||0) < amelio.cout) {
    showNotif(`Fonds insuffisants — il faut ${amelio.cout} or.`,'error'); return;
  }
  openModal(`${amelio.emoji} Débloquer — ${amelio.nom}`, `
    <p style="color:var(--text-muted);margin-bottom:1.2rem;line-height:1.6">${amelio.detail}</p>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.75rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted)">Coût</span>
      <span style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--gold)">${amelio.cout} or</span>
    </div>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:1.5rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted)">Trésor actuel</span>
      <span style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--green)">${current.tresor||0} or</span>
    </div>
    <button class="btn btn-gold" style="width:100%" onclick="confirmDebloquer('${id}')">Confirmer</button>
  `);
}

async function confirmDebloquer(id) {
  const amelio  = BASTION_AMELIORATIONS.find(a => a.id === id);
  if (!amelio) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const amelios = { ...(current.ameliorations||{}), [id]:true };
  const nb      = Object.values(amelios).filter(Boolean).length;
  await saveDoc('bastion','main', { ...current, ameliorations:amelios, tresor:(current.tresor||0)-amelio.cout, niveau:1+nb });
  closeModalDirect();
  showNotif(`${amelio.nom} débloquée ! Niveau ${1+nb}.`,'success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// CYCLE — événement + distribution fondateurs
// ══════════════════════════════════════════════════════════════════════════════

async function tirerEvenement() {
  const idx     = Math.floor(Math.random() * BASTION_EVENTS.length);
  const evt     = BASTION_EVENTS[idx];
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const { brut, fondateurs: partFondateurs, reinvesti } = calculerRevenuBastion({ ...current, evenementCourant: evt.id });

  const fondateursList   = _normFondateurs(current.fondateurs||[]);
  const partParFondateur = fondateursList.length > 0 ? Math.round(partFondateurs / fondateursList.length) : 0;

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
    brut, reinvesti, partFondateurs, partParFondateur,
    evenement:       evt.nom, evtId: evt.id,
    distributions,
  });

  await saveDoc('bastion','main', { ...current, evenementCourant: evt.id, tresor:(current.tresor||0)+reinvesti, historique });
  const distText = distributions.length > 0 ? ` — ${distributions.map(d=>`${d.nom} +${d.montant} or`).join(', ')}` : '';
  showNotif(`${evt.emoji} ${evt.nom} — +${reinvesti} or au trésor${distText}`,'success');
  await PAGES.bastion();
}

// ── Investissement joueur ─────────────────────────────────────────────────────

async function investirOrBastion() {
  const chars = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
  if (chars.length === 0) { showNotif('Aucun personnage trouvé.','error'); return; }
  const char    = chars[0];
  const orDispo = _getCharOr(char);
  openModal('💰 Investir dans le Bastion', `
    <p style="color:var(--text-muted);font-size:.84rem;margin-bottom:1rem;line-height:1.6">
      Verse de l'or dans le trésor du Bastion. L'action est historisée.
    </p>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:.75rem 1rem;margin-bottom:1rem;display:flex;justify-content:space-between">
      <span style="color:var(--text-muted);font-size:.84rem">Or disponible</span>
      <span style="font-family:'Cinzel',serif;color:var(--gold)">${orDispo} or</span>
    </div>
    <div class="form-group">
      <label>Montant à investir</label>
      <input type="number" class="input-field" id="invest-montant" min="1" max="${orDispo}" placeholder="0">
    </div>
    <div class="form-group">
      <label>Message (optionnel)</label>
      <input class="input-field" id="invest-msg" placeholder="Pour la forge !">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="confirmerInvestissement()">Investir</button>
  `);
}

async function confirmerInvestissement() {
  const montant = parseInt(document.getElementById('invest-montant')?.value)||0;
  const msg     = document.getElementById('invest-msg')?.value?.trim()||'';
  if (montant < 1) { showNotif('Montant invalide.','error'); return; }
  const chars   = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
  const char    = chars[0];
  if (!char) return;
  const orDispo = _getCharOr(char);
  if (montant > orDispo) { showNotif(`Fonds insuffisants (${orDispo} or).`,'error'); return; }
  await _setCharOr(char, orDispo - montant);
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const historique = current.historique || [];
  historique.push({
    id: `inv_${Date.now()}`, session: historique.length + 1,
    date: new Date().toLocaleDateString('fr-FR'),
    type: 'investissement',
    investisseur: { charId: char.id, nom: char.nom||'?' },
    montant, message: msg,
    brut:0, reinvesti:0, partFondateurs:0, distributions:[],
  });
  await saveDoc('bastion','main', { ...current, tresor:(current.tresor||0)+montant, historique });
  closeModalDirect();
  showNotif(`+${montant} or investis dans le Bastion !`,'success');
  await PAGES.bastion();
}

// ── Supprimer une entrée d'historique ────────────────────────────────────────

async function supprimerHistorique(entryId) {
  if (!confirm('Supprimer cette entrée ? Les effets financiers seront annulés.')) return;
  const current    = (await getDocData('bastion','main')) || getDefaultBastion();
  const historique = current.historique || [];
  const entry      = historique.find(h => h.id === entryId);
  if (!entry) { showNotif('Entrée introuvable.','error'); return; }

  let tresor = current.tresor || 0;
  const chars = STATE.characters || [];

  if (entry.type === 'investissement') {
    tresor -= entry.montant;
    const char = chars.find(c => c.id === entry.investisseur?.charId);
    if (char) await _setCharOr(char, _getCharOr(char) + entry.montant);
  } else {
    tresor -= (entry.reinvesti || 0);
    for (const d of (entry.distributions||[])) {
      const char = chars.find(c => c.id === d.charId);
      if (char) await _setCharOr(char, Math.max(0, _getCharOr(char) - d.montant));
    }
  }

  const newHist = historique.filter(h => h.id !== entryId);
  newHist.filter(h => h.session).forEach((h,i) => { h.session = i + 1; });
  await saveDoc('bastion','main', { ...current, tresor: Math.max(0,tresor), historique: newHist });
  showNotif('Entrée supprimée et effets annulés.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// INVENTAIRE DU BASTION
// ══════════════════════════════════════════════════════════════════════════════

async function ouvrirInventaireBastion() {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const inv     = current.inventaire || [];
  const isAdmin = STATE.isAdmin;
  const uid     = STATE.user?.uid;
  const hasChar = (STATE.characters||[]).some(c => c.uid === uid);

  openModal('📦 Inventaire du Bastion', `
    <div style="margin-bottom:.75rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:.78rem;color:var(--text-dim)">${inv.length} objet${inv.length!==1?'s':''} en stockage</span>
      ${isAdmin||hasChar ? `<button class="btn btn-gold btn-sm" onclick="ajouterObjetBastion()">+ Déposer un objet</button>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:.4rem;max-height:55vh;overflow-y:auto">
      ${inv.length === 0
        ? `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">L'inventaire est vide.</div>`
        : inv.map(item => `
          <div style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.86rem;color:var(--text)">${item.nom||'?'}${item.quantite>1?`<span style="font-size:.72rem;color:var(--gold);margin-left:.3rem">×${item.quantite}</span>`:''}</div>
              ${item.description?`<div style="font-size:.74rem;color:var(--text-dim)">${item.description}</div>`:''}
              <div style="font-size:.66rem;color:var(--text-dim);margin-top:2px">Par <strong>${item.deposePar||'?'}</strong> · ${item.date||''}</div>
            </div>
            <div style="display:flex;gap:.3rem;flex-shrink:0">
              ${hasChar ? `<button class="btn btn-outline btn-sm" style="font-size:.72rem" onclick="recupererObjetBastion('${item.id}')">↩ Récup.</button>` : ''}
              ${isAdmin ? `<button class="btn-icon" style="color:#ff6b6b" onclick="supprimerObjetBastion('${item.id}')">🗑️</button>` : ''}
            </div>
          </div>`).join('')}
    </div>
  `);
}

async function ajouterObjetBastion() {
  const uid      = STATE.user?.uid;
  const eligible = STATE.isAdmin ? (STATE.characters||[]) : (STATE.characters||[]).filter(c => c.uid === uid);
  openModal('📦 Déposer un objet au Bastion', `
    <div class="form-group">
      <label>Nom de l'objet</label>
      <input class="input-field" id="bav-nom" placeholder="Épée de guerre, Potion de soin...">
    </div>
    <div class="form-group">
      <label>Quantité</label>
      <input type="number" class="input-field" id="bav-qte" value="1" min="1">
    </div>
    <div class="form-group">
      <label>Description (optionnel)</label>
      <input class="input-field" id="bav-desc" placeholder="Détails, origine...">
    </div>
    <div class="form-group">
      <label>Déposé par</label>
      ${eligible.length > 0
        ? `<select class="input-field" id="bav-perso">${eligible.map(c=>`<option value="${c.nom||'?'}">${c.nom||'?'}</option>`).join('')}</select>`
        : `<input class="input-field" id="bav-perso" value="${STATE.profile?.pseudo||'Inconnu'}" readonly>`}
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:.5rem" onclick="confirmerDepotBastion()">Déposer</button>
  `);
}

async function confirmerDepotBastion() {
  const nom = document.getElementById('bav-nom')?.value?.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const inv     = current.inventaire || [];
  inv.push({
    id: `bi_${Date.now()}`, nom,
    quantite:    parseInt(document.getElementById('bav-qte')?.value)||1,
    description: document.getElementById('bav-desc')?.value?.trim()||'',
    deposePar:   document.getElementById('bav-perso')?.value||'?',
    date:        new Date().toLocaleDateString('fr-FR'),
  });
  await saveDoc('bastion','main', { ...current, inventaire: inv });
  closeModalDirect();
  showNotif(`${nom} déposé au Bastion.`,'success');
  await ouvrirInventaireBastion();
}

async function recupererObjetBastion(itemId) {
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  const inv     = current.inventaire || [];
  const item    = inv.find(i => i.id === itemId);
  if (!item) return;
  const chars = (STATE.characters||[]).filter(c => c.uid === STATE.user?.uid);
  if (chars.length === 0) { showNotif('Aucun personnage trouvé.','error'); return; }
  const char    = chars[0];
  const invChar = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
  invChar.push({ id:`rec_${Date.now()}`, nom:item.nom, quantite:item.quantite, description:item.description||'', source:'bastion' });
  await updateInCol('characters', char.id, { inventaire: invChar });
  char.inventaire = invChar;
  await saveDoc('bastion','main', { ...current, inventaire: inv.filter(i => i.id !== itemId) });
  showNotif(`${item.nom} récupéré dans l'inventaire de ${char.nom||'ton perso'}.`,'success');
  await ouvrirInventaireBastion();
}

async function supprimerObjetBastion(itemId) {
  if (!confirm("Supprimer cet objet de l'inventaire du Bastion ?")) return;
  const current = (await getDocData('bastion','main')) || getDefaultBastion();
  await saveDoc('bastion','main', { ...current, inventaire: (current.inventaire||[]).filter(i => i.id !== itemId) });
  showNotif('Objet supprimé.','success');
  await ouvrirInventaireBastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// MISSIONS SPÉCIALES
// ══════════════════════════════════════════════════════════════════════════════

async function ouvrirMissionsBastion() {
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const missions = current.missions || [];
  const isAdmin  = STATE.isAdmin;
  openModal('⚔️ Missions spéciales du Bastion', `
    <div style="margin-bottom:.75rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:.78rem;color:var(--text-dim)">${missions.length} mission${missions.length!==1?'s':''}</span>
      ${isAdmin ? `<button class="btn btn-gold btn-sm" onclick="creerMissionBastion()">+ Créer</button>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:.5rem;max-height:55vh;overflow-y:auto">
      ${missions.length === 0
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
  missions.push({
    id: `ms_${Date.now()}`, titre,
    description: document.getElementById('miss-desc')?.value?.trim()||'',
    recompense:  document.getElementById('miss-recomp')?.value?.trim()||'',
    statut: 'active', date: new Date().toLocaleDateString('fr-FR'),
  });
  await saveDoc('bastion','main', { ...current, missions });
  closeModalDirect();
  showNotif('Mission créée !','success');
  await PAGES.bastion();
}

async function changerStatutMission(id, statut) {
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  const missions = (current.missions||[]).map(m => m.id===id ? { ...m, statut } : m);
  await saveDoc('bastion','main', { ...current, missions });
  closeModalDirect();
  showNotif(`Mission "${statut}".`,'success');
  await PAGES.bastion();
}

async function supprimerMissionBastion(id) {
  if (!confirm('Supprimer cette mission ?')) return;
  const current  = (await getDocData('bastion','main')) || getDefaultBastion();
  await saveDoc('bastion','main', { ...current, missions: (current.missions||[]).filter(m => m.id!==id) });
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
  journal.unshift({
    id:    `j_${Date.now()}`,
    date:  document.getElementById('bastion-log-date')?.value?.trim() || new Date().toLocaleDateString('fr-FR'),
    texte: document.getElementById('bastion-log-text')?.value?.trim() || '',
  });
  await saveDoc('bastion','main', { ...current, journal });
  closeModalDirect();
  showNotif('Entrée ajoutée.','success');
  await PAGES.bastion();
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

Object.assign(window, {
  BASTION_AMELIORATIONS, BASTION_EVENTS, calculerRevenuBastion, getDefaultBastion,
  editBastion, saveBastionInfos,
  debloquerAmelioration, confirmDebloquer,
  tirerEvenement, investirOrBastion, confirmerInvestissement, supprimerHistorique,
  ouvrirInventaireBastion, ajouterObjetBastion, confirmerDepotBastion,
  recupererObjetBastion, supprimerObjetBastion,
  ouvrirMissionsBastion, creerMissionBastion, sauvegarderMissionBastion,
  changerStatutMission, supprimerMissionBastion,
  addBastionLog, saveBastionLog,
  saveBastion: saveBastionInfos,
});
