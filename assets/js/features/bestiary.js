import { STATE }                                          from '../core/state.js';
import { loadCollection, addToCol, updateInCol,
         deleteFromCol }                                  from '../data/firestore.js';
import { openModal, closeModalDirect }                    from '../shared/modal.js';
import { showNotif }                                      from '../shared/notifications.js';

// ══════════════════════════════════════════════
// CRÉATURES MJ — données statiques extraites du Google Sheet
// Chaque joueur peut remplir ses propres observations
// ══════════════════════════════════════════════
const CREATURES_MJ = [
  {id:'loup',nom:'Loup',pv:11,pm:0,ca:13,vit:8,xp:30,
   attaques:[{nom:'Morsure',allonge:'CaC',toucher:'+2',degats:'2d4+2 Phy.',effet:''}],
   traits:['Tact. de meute : Sur une cible commune +2 au toucher.','Sens affûtés : Gagne +5 à la perception.','Lune rouge : Sous cet effet, les loups frappent 2 fois'],
   butins:['Matériaux bestiaux','Matériaux tannés']},
  {id:'loup_alpha',nom:'Loup Alpha',pv:75,pm:0,ca:15,vit:8,xp:250,
   attaques:[{nom:'Morsure',allonge:'CaC',toucher:'+6',degats:'2d6+4 Phy.',effet:'Marque lunaire : les loups gagnent +2 au toucher contre elle.'}],
   traits:['Lien lunaire : Régénère 5 PV /tr lorsqu\'il est exposé à la lumière de la lune.','Pacte de loup : à 0 PV, il dévore un loup proche et soigne 15 PV','Lune rouge : Sous cet effet, les loups frappent 2 fois'],
   butins:['Matériaux bestiaux','Matériaux tannés']},
  {id:'sanglier',nom:'Sanglier',pv:11,pm:0,ca:11,vit:8,xp:40,
   attaques:[{nom:'Charge (à 6m)',allonge:'CaC',toucher:'',degats:'1d6 Phy.',effet:'Renverse si touché (JS Dex DD 11)'},{nom:'Défenses',allonge:'CaC',toucher:'+3',degats:'1d6+1 Phy.',effet:''}],
   traits:['Implacable : Si une atq. à ≤7 dgts le réduit à 0 PV, il tombe à 1 PV à la place.'],
   butins:['Matériaux bestiaux','Matériaux tannés']},
  {id:'araignee_cristal',nom:'Araignée Cristal',pv:10,pm:4,ca:13,vit:5,xp:60,
   attaques:[{nom:'Morsure',allonge:'CaC',toucher:'+2',degats:'1d6 Phy.',effet:'Poison (JS Co DD 11)(DoT : 1d4+2) 2 tr'},{nom:'Jet de soie (2 PM)',allonge:'Dist',toucher:'/',degats:'/',effet:'Entrave (JS Co DD 11) 2 tr'}],
   traits:['Habitat Cristal : Désavantage au J. Per tant qu\'elle est immobile.','Rés. physique : Réduit de moitié les dégâts physiques.','Chitine Réfléct. : (Reaction; lumière) JS Sa DD11 ou Cécité 3m autour d\'elle.'],
   butins:['Matériaux résistant','Matériaux précieux']},
  {id:'cockatrice',nom:'Cockatrice',pv:27,pm:0,ca:11,vit:'6 (Vol)',xp:120,
   attaques:[{nom:'Bec venimeux',allonge:'CaC',toucher:'+3',degats:'1d4+1 Phy.',effet:'Pétrification partielle (JS Con DD 11) 2 tr'}],
   traits:['Pétrification totale : 3 ratés consécutifs → pétrification complète 1h'],
   butins:['Matériaux bestiaux','Matériaux souples']},
  {id:'ours_hibou',nom:'Ours Hibou',pv:60,pm:0,ca:14,vit:8,xp:180,
   attaques:[{nom:'Serres',allonge:'CaC',toucher:'+5',degats:'2d6+3 Phy.',effet:'Étreinte (JS Fo DD 13) → immobilisé'},{nom:'Bec tranchant',allonge:'CaC',toucher:'+5',degats:'1d10+3 Phy.',effet:''}],
   traits:['Vision nocturne : Voit dans le noir total à 18m.','Flair : Avantage aux jets de Perception basés sur l\'odorat.'],
   butins:['Matériaux bestiaux','Matériaux tannés']},
  {id:'squelette',nom:'Squelette',pv:13,pm:0,ca:13,vit:8,xp:30,
   attaques:[{nom:'Épée courte',allonge:'CaC',toucher:'+4',degats:'1d6+2 Trn.',effet:''},{nom:'Arc court',allonge:'Dist (18m)',toucher:'+4',degats:'1d6+2 Prc.',effet:''}],
   traits:['Imm. empoisonnement, épuisement, effroi.','Vulnérable aux dégâts contondants.'],
   butins:['Matériaux bestiaux','Matériaux mystiques']},
  {id:'gardien_selandra',nom:'Gardien de Sélandra',pv:85,pm:0,ca:'16+5 (21)',vit:6,xp:250,
   attaques:[{nom:'Épée longue (2M)',allonge:'CaC',toucher:'+6',degats:'2d8+4 Trn.',effet:''}],
   traits:['Bénédiction de Sélandra : Régénère 5 PV/tr la nuit.','Imm. charme, peur.'],
   butins:['Matériaux résistants','Matériaux mystiques']},
  {id:'ombre',nom:'Ombre',pv:16,pm:0,ca:12,vit:8,xp:120,
   attaques:[{nom:'Contact de l\'ombre',allonge:'CaC',toucher:'+4',degats:'2d6 Nec.',effet:'Réduit la Force (JS Con DD 11)'}],
   traits:['Fuite dans les ombres : Peut se cacher en action bonus dans pénombre/noirceur.','Insubstantielle : Résistance aux dégâts physiques (non-magiques).','Sensible à la lumière : Désavantage aux jets d\'attaque à la lumière vive.'],
   butins:['Matériaux légers','Matériaux mystiques']},
  {id:'goule',nom:'Goule',pv:24,pm:0,ca:12,vit:8,xp:100,
   attaques:[{nom:'Griffes + Morsure',allonge:'CaC',toucher:'+3',degats:'2d6+1 Phy.',effet:'Paralysie (JS Con DD 10) 1 min (pas sur Elfes)'}],
   traits:['Imm. charme, épuisement, empoisonnement.','Résistance aux dégâts non magiques.'],
   butins:['Matériaux légers','Matériaux souples']},
  {id:'armure_animee',nom:'Armure animée',pv:33,pm:0,ca:18,vit:6,xp:160,
   attaques:[{nom:'Coup de poing en acier',allonge:'CaC',toucher:'+5',degats:'2d6+3 Ctn.',effet:''}],
   traits:['Forme antimagique : Si elle se retrouve dans un champ antimagique, elle est paralysée.','Imm. empoisonnement, psychique, charme, épuisement, effroi.','Sens aveugle à 18m.','Trépidante : Avantage aux jets de sauvegarde contre éjection.'],
   butins:['Matériaux résistants','Matériaux mystiques']},
  {id:'elem_terre',nom:'Élémentaire de Terre',pv:42,pm:0,ca:15,vit:6,xp:120,
   attaques:[{nom:'Coup de poing',allonge:'CaC',toucher:'+5',degats:'2d8+4 Ctn.',effet:''},{nom:'Tremblement (rechargement)',allonge:'Zone',toucher:'/',degats:'2d6 Ctn.',effet:'Renversé (JS Dex DD 13)'}],
   traits:['Marche terrestre : Traverser le sol et la roche à pleine vitesse.','Imm. acide, foudre, empoisonnement.','Résistance aux dégâts non magiques.'],
   butins:['Matériaux résistant','Matériaux précieux']},
  {id:'elem_eau',nom:'Élémentaire d\'Eau',pv:36,pm:0,ca:13,vit:8,xp:120,
   attaques:[{nom:'Coup de jet d\'eau',allonge:'CaC/Dist 9m',toucher:'+5',degats:'2d6+3 Ctn.',effet:''},{nom:'Tourbillon (rechargement)',allonge:'Zone',toucher:'/',degats:'2d8',effet:'Emprisonné (JS Fo DD 13)'}],
   traits:['Forme d\'eau : peut passer par tout espace non hermétique.','Imm. acide, empoisonnement.','Résistance aux dégâts non magiques.'],
   butins:['Matériaux légers','Matériaux mystiques']},
  {id:'elem_feu',nom:'Élémentaire de Feu',pv:28,pm:0,ca:12,vit:10,xp:120,
   attaques:[{nom:'Toucher enflammé',allonge:'CaC',toucher:'+5',degats:'2d6+3 Feu',effet:'Brûlure (1d6/tr, JS Dex DD 13 pour éteindre)'},{nom:'Explosion de flammes',allonge:'Zone 3m',toucher:'/',degats:'2d6 Feu',effet:'(JS Dex DD 13 demi)'}],
   traits:['Illumination : Diffuse une lumière vive sur 6m.','Imm. feu, empoisonnement.','Vulnérable à l\'eau/froid.'],
   butins:['Matériaux mystiques','Matériaux résistant']},
  {id:'elem_vent',nom:'Élémentaire de Vent',pv:30,pm:0,ca:14,vit:12,xp:120,
   attaques:[{nom:'Coup de rafale',allonge:'CaC/Dist 6m',toucher:'+5',degats:'2d6+3 Ctn.',effet:'Repoussé de 3m'},{nom:'Bourrasque (rechargement)',allonge:'Ligne 9m',toucher:'/',degats:'2d8',effet:'Repoussé de 6m (JS Fo DD 13)'}],
   traits:['Vol : Vitesse de vol 12m.','Imm. foudre, tonnerre, empoisonnement.','Résistance aux dégâts non magiques.'],
   butins:['Matériaux mystiques','Matériaux précieux']},
  {id:'mimique',nom:'Mimique',pv:58,pm:0,ca:12,vit:5,xp:120,
   attaques:[{nom:'Pseudopode',allonge:'CaC',toucher:'+5',degats:'2d8+3 Ctn.',effet:'Collé (JS Fo DD 13)'},{nom:'Morsure',allonge:'CaC',toucher:'+5',degats:'3d6+3 Prc.',effet:'Auto si collé'}],
   traits:['Forme de coffre : Avantage à Discrétion quand immobile.','Adhésif : Créature touchée collée jusqu\'à réussite JS Fo DD 13 (action).'],
   butins:['Bourse d\'or','Matériaux mystiques']},
  {id:'gobelin',nom:'Gobelin',pv:10,pm:0,ca:15,vit:9,xp:60,
   attaques:[{nom:'Cimeterre',allonge:'CaC',toucher:'+4',degats:'1d6+2 Trn.',effet:''},{nom:'Arc court',allonge:'Dist (18m)',toucher:'+4',degats:'1d6+2 Prc.',effet:''},{nom:'Fuite vicieuse (AB)',allonge:'',toucher:'',degats:'',effet:'Se désengage et se cache sans AO'}],
   traits:['Évasion agile : Peut se désengager ou se cacher en action bonus.','Embuscade : +2d6 aux dégâts si avantage au toucher.'],
   butins:['Bourse d\'or','Matériaux légers']},
  {id:'ogre',nom:'Ogre',pv:60,pm:0,ca:11,vit:8,xp:300,
   attaques:[{nom:'Massue',allonge:'CaC',toucher:'+5',degats:'2d8+4 Ctn.',effet:'Renversé (JS Fo DD 13)'}],
   traits:['Berserk : En dessous de 30 PV, gagne +2 aux attaques et +1d4 aux dégâts.','Grand corps : Peut attaquer 2 cibles adjacentes en 1 action.'],
   butins:['Matériaux bestiaux','Matériaux tannés']},
  {id:'diablotin',nom:'Diablotin',pv:10,pm:8,ca:13,vit:8,xp:50,
   attaques:[{nom:'Aiguillon (queue)',allonge:'CaC',toucher:'+4',degats:'1d4+2 Prc.',effet:'Poison (JS Con DD 11 : 2d6 poison)'}],
   traits:['Résistance magique : Avantage aux JS contre sorts et effets magiques.','Invisibilité (2 PM) : Devient invisible jusqu\'à ce qu\'il attaque.','Changeforme : Peut prendre l\'apparence d\'une bête de taille Petite ou Moyenne.'],
   butins:['Matériaux légers','Matériaux souples']},
  {id:'treant',nom:'Tréant',pv:140,pm:0,ca:16,vit:5,xp:0,
   attaques:[{nom:'Coup de branche',allonge:'CaC (3m)',toucher:'+7',degats:'3d6+5 Ctn.',effet:''},{nom:'Lancer de rocher',allonge:'Dist (18m)',toucher:'+7',degats:'4d8+5 Ctn.',effet:'Renversé'}],
   traits:['Éveil végétal : Peut animer 2 arbres ordinaires (AB), stats Arbre éveillé.','Régénération : Récupère 5 PV/tr sauf si feu/acide ce tour.','Imm. froid. Vulnérable au feu.','Résistance : Dégâts Phy non-magiques réduits de moitié.'],
   butins:['Produits végétaux','Matériaux souples']},
  {id:'arbre_eveille',nom:'Arbre éveillé',pv:60,pm:0,ca:13,vit:5,xp:0,
   attaques:[{nom:'Coup de branche',allonge:'CaC',toucher:'+5',degats:'2d6+3 Ctn.',effet:''}],
   traits:['Pas de conscience propre : Suit les ordres du Tréant.'],
   butins:['Produits végétaux','Matériaux souples']},
];

// ══════════════════════════════════════════════
// RENDER — Vue MJ vs Vue Joueur
// ══════════════════════════════════════════════

async function renderBestiary() {
  const content = document.getElementById('main-content');
  if (!content) return;

  // Charger les observations du joueur actuel
  const uid = STATE.user?.uid || 'anon';
  let playerObs = {};
  try {
    const allObs = await loadCollection('bestiary_observations');
    allObs.filter(o => o.uid === uid).forEach(o => { playerObs[o.creatureId] = o; });
  } catch(e) {}

  const isMJ = STATE.isAdmin;

  let html = `
  <div class="page-header">
    <div class="page-title"><span class="page-title-accent">📖</span> Bestiaire</div>
    <div class="page-subtitle">${isMJ ? 'Vue Maître de Jeu — toutes les créatures' : 'Complète ta connaissance des créatures rencontrées'}</div>
  </div>`;

  // Barre de recherche
  html += `<div class="best-search-bar">
    <input type="text" class="sh-search-input" id="best-search"
           placeholder="🔍 Rechercher une créature..."
           oninput="bestFilterSearch(this.value)"
           style="max-width:340px">
  </div>`;

  html += `<div class="best-grid" id="best-grid">`;

  CREATURES_MJ.forEach(creature => {
    const obs = playerObs[creature.id] || {};
    const discovered = isMJ || obs.discovered;
    const notes = obs.notes || '';

    html += _renderCreatureCard(creature, obs, isMJ);
  });

  html += `</div>`;
  content.innerHTML = html;
}

function _renderCreatureCard(c, obs, isMJ) {
  const discovered = isMJ || obs.discovered;
  const open = obs.open;

  return `<div class="best-card ${discovered?'discovered':'undiscovered'}" data-id="${c.id}" id="best-card-${c.id}">
    <div class="best-card-header" onclick="bestToggleCard('${c.id}')">
      <div class="best-card-name-row">
        <span class="best-card-name">${discovered ? c.nom : '??? Créature inconnue'}</span>
        ${discovered ? `<div class="best-card-stats">
          <span class="best-stat">❤️ ${c.pv}</span>
          ${c.pm?`<span class="best-stat">💙 ${c.pm}</span>`:''}
          <span class="best-stat">🛡️ ${c.ca}</span>
          <span class="best-stat">⚡ ${c.vit}</span>
          ${c.xp?`<span class="best-stat xp">✨ ${c.xp} XP</span>`:''}
        </div>` : '<span class="best-unknown-hint">Rencontrer cette créature pour la découvrir</span>'}
      </div>
      <span class="best-card-chevron">${obs.open?'▲':'▼'}</span>
    </div>

    ${obs.open && discovered ? `<div class="best-card-body">

      ${isMJ ? '' : `<div class="best-discover-row">
        <span style="font-size:0.75rem;color:var(--text-dim)">Statut :</span>
        <button class="btn btn-outline btn-sm" onclick="bestToggleDiscovered('${c.id}',${!obs.discovered})">
          ${obs.discovered ? '✅ Découverte' : '🔍 Marquer comme découverte'}
        </button>
      </div>`}

      <!-- Attaques -->
      ${c.attaques?.length ? `<div class="best-section">
        <div class="best-section-title">⚔️ Attaques</div>
        <div class="best-attacks">
          ${c.attaques.map(a=>`<div class="best-attack-row">
            <span class="best-atk-nom">${a.nom}</span>
            ${a.allonge?`<span class="best-atk-badge">${a.allonge}</span>`:''}
            ${a.toucher?`<span class="best-atk-badge">${a.toucher}</span>`:''}
            ${a.degats?`<span class="best-atk-badge red">${a.degats}</span>`:''}
            ${a.effet?`<span class="best-atk-effet">${a.effet}</span>`:''}
          </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- Traits -->
      ${c.traits?.length ? `<div class="best-section">
        <div class="best-section-title">✨ Traits spéciaux</div>
        ${c.traits.map(t=>`<div class="best-trait">${t}</div>`).join('')}
      </div>` : ''}

      <!-- Butins -->
      ${c.butins?.length ? `<div class="best-section">
        <div class="best-section-title">💎 Butins</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
          ${c.butins.map(b=>`<span class="best-butin-tag">${b}</span>`).join('')}
        </div>
      </div>` : ''}

      <!-- Notes du joueur -->
      <div class="best-section">
        <div class="best-section-title">📝 Mes notes</div>
        <textarea class="input-field best-notes-input" id="best-notes-${c.id}"
                  placeholder="Ajouter des notes personnelles..."
                  rows="3">${obs.notes||''}</textarea>
        <button class="btn btn-gold btn-sm" style="margin-top:0.4rem"
                onclick="bestSaveNotes('${c.id}')">Sauvegarder</button>
      </div>

    </div>` : ''}

    ${!discovered && !isMJ ? `<div class="best-card-body best-locked">
      <div class="best-section">
        <div class="best-section-title">📝 Mes notes (même sans découverte)</div>
        <textarea class="input-field best-notes-input" id="best-notes-${c.id}"
                  placeholder="Notes sur cette créature..." rows="2">${obs.notes||''}</textarea>
        <button class="btn btn-outline btn-sm" style="margin-top:0.4rem"
                onclick="bestSaveNotes('${c.id}')">Sauvegarder</button>
      </div>
      <button class="btn btn-gold btn-sm" style="margin-top:0.4rem"
              onclick="bestToggleDiscovered('${c.id}',true)">🔍 Marquer comme découverte</button>
    </div>` : ''}
  </div>`;
}

// ══════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════

// Toggle ouverture d'une card
const _openCards = {};
function bestToggleCard(creatureId) {
  _openCards[creatureId] = !_openCards[creatureId];
  renderBestiary();
}

async function bestToggleDiscovered(creatureId, val) {
  const uid = STATE.user?.uid; if (!uid) return;
  const allObs = await loadCollection('bestiary_observations');
  const existing = allObs.find(o => o.uid === uid && o.creatureId === creatureId);
  if (existing) {
    await updateInCol('bestiary_observations', existing.id, {discovered: val});
  } else {
    await addToCol('bestiary_observations', {uid, creatureId, discovered: val, notes: ''});
  }
  showNotif(val ? '✅ Créature découverte !' : 'Créature masquée.', 'success');
  renderBestiary();
}

async function bestSaveNotes(creatureId) {
  const uid   = STATE.user?.uid; if (!uid) return;
  const notes = document.getElementById(`best-notes-${creatureId}`)?.value || '';
  const allObs = await loadCollection('bestiary_observations');
  const existing = allObs.find(o => o.uid === uid && o.creatureId === creatureId);
  if (existing) {
    await updateInCol('bestiary_observations', existing.id, {notes});
  } else {
    await addToCol('bestiary_observations', {uid, creatureId, discovered: false, notes});
  }
  showNotif('Notes sauvegardées.', 'success');
}

function bestFilterSearch(val) {
  const q = val.toLowerCase();
  document.querySelectorAll('.best-card').forEach(card => {
    const id = card.dataset.id;
    const c  = CREATURES_MJ.find(x => x.id === id);
    if (!c) return;
    const match = !q || c.nom.toLowerCase().includes(q) ||
      c.traits?.some(t => t.toLowerCase().includes(q)) ||
      c.butins?.some(b => b.toLowerCase().includes(q));
    card.style.display = match ? '' : 'none';
  });
}

// ══════════════════════════════════════════════
// COMPAT legacy
// ══════════════════════════════════════════════
function openBestiaryModal() {}
async function saveBestiary() {}
async function editBestiary() {}
async function deleteBestiary() {}
function filterBestiary() {}

Object.assign(window, {
  renderBestiary,
  bestToggleCard, bestToggleDiscovered, bestSaveNotes, bestFilterSearch,
  openBestiaryModal, saveBestiary, editBestiary, deleteBestiary, filterBestiary,
});
