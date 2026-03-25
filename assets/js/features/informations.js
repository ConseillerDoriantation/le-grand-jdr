// ══════════════════════════════════════════════
// INFORMATIONS HELPERS
// ══════════════════════════════════════════════
function showInfoSection(id, el) {
  document.querySelectorAll('.tutorial-nav-item').forEach(i=>i.classList.remove('active'));
  el?.classList.add('active');
  window._infoSection = id;
  const section = (window._infoSections||[]).find(s=>s.id===id);
  const contentEl = document.getElementById('info-content');
  if (contentEl && section) contentEl.textContent = section.content;
}

function editInfoSection(id) {
  const section = (window._infoSections||[]).find(s=>s.id===id);
  if (!section) return;
  openModal(`✏️ ${section.title}`, `
    <div class="form-group"><label>Contenu</label>
      <textarea class="input-field" id="info-edit-content" rows="15" style="font-family:monospace;font-size:0.82rem">${section.content||''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveInfoSection('${id}')">Enregistrer</button>
  `);
}

async function saveInfoSection(id) {
  const sections = window._infoSections||[];
  const idx = sections.findIndex(s=>s.id===id);
  if (idx<0) return;
  sections[idx].content = document.getElementById('info-edit-content')?.value||'';
  window._infoSections = sections;
  await saveDoc('informations','main',{sections});
  closeModal(); showNotif('Section mise à jour !','success');
  PAGES.informations();
}

// Default informations content from game document
function getInfoStats() {
  return `RACES & BONUS ÉLÉMENTAIRES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Humain     : +1 Fo, +2 Dex / +2 Fo, +1 Dex
  Elfe       : +2 Fo, +1 Dex (ou inverse)
  Nain       : +1 Dex, +2 In / +2 Dex, +1 In
  Demi-Anim. : +2 Fo, +1 Dex / autre
  Créa. Mag. : +1 Fo, +2 In / autre
  Gnome      : +2 Fo, +1 Dex / autre

ÉLÉMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Feu    : +2 Fo, +1 Dex / +1 Fo, +2 Dex
  Eau    : +1 Fo, +2 Dex / +2 Fo, +1 Dex
  Vent   : +2 Fo, +1 Dex
  Terre  : +1 Fo, +2 Dex
  Lumière: +1 Fo, +2 In / +2 Fo, +1 In
  Ombre  : +2 Fo, +1 Dex

MODIFICATEURS MAXIMUM : +6 (22 points)

STATS — FORMULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PV max  = PV Base + Mod(Co) × (Niveau-1)
  PM max  = PM Base + Mod(Sa) × (Niveau-1)
  CA      = 8 (ou 10/12/14 selon armure torse) + Mod(Dex)
  Vitesse = 3 + Mod(Fo) cases
  Deck    = 3 + f(Intelligence, Niveau)

LVL UP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  + : Ajouter +1 point de stats
  + : Lancer 2d6 → augmenter PV ou PM (meilleure valeur)`;
}

function getInfoEquipements() {
  return `EMPLACEMENTS D'ÉQUIPEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Tête         : Jusqu'à 2 points de stats
  Torse        : Jusqu'à 4 pts. Fixe la CA de base.
  Pieds        : Jusqu'à 3 points de stats
  Bague        : Jusqu'à 2 pts + bonus plats
  Amulette     : 1 pt sur 3 stats différentes + effets spéciaux
  Objet Magique: Activable en combat

ARMURES — CA DE BASE DU TORSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Légère       : CA 10 + Mod(Dex) | Set: -2 PM par sort
  Intermédiaire: CA 12 + Mod(Dex) | Set: +2 au toucher
  Lourde       : CA 14 + Mod(Dex) | Set: -2 dégâts subis (min 1)
                 ⚠️ Lourde = impossible d'utiliser la magie

ARMES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Main Libre / Gant : Attaque bonus après réussite
  2 Armes 1M        : Attaque bonus avec 2ème arme après réussite
  Baguette          : Magie possible, +4 aux dés (1d6→1d10). CaC seulement
  Bouclier          : CA +2

  1M Phy. CaC  : 1d6 — Attaque d'opportunité
  2M Phy. CaC  : 1d10 — Attaque d'opportunité
  2M Phy. Dist.: 1d10 — Portée 12m. Désavantage si ennemi au CaC
  2M Mag. CaC  : 1d8 — Dégâts réduits de moitié si toucher échoue
  2M Mag. Dist.: 1d6 — Portée 12m. Dégâts réduits si toucher échoue`;
}

function getInfoCombat() {
  return `DÉROULEMENT D'UN TOUR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Chaque tour : 1 Action + 1 Action Bonus + 1 Réaction + Déplacement

ATTAQUER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Toucher : 1d20 + Modificateur de l'arme
  → Si score > CA cible : touche
  → Si magie/compétence échoue : moitié des dégâts

CRITIQUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Joueur  : Dégâts maximum + 1 dé de l'arme (avec modificateur)
  Ennemi  : +1 dé de dégâts (1d6 → 2d6)

STAT DE TOUCHER PAR ARCHÉTYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Force (Fo)        : Arme lourde / poing (Épée, Masse, Hache, Lance)
  Dextérité (Dex)   : Arme agile / précision (Rapière, Dague, Arc)
  Intelligence (In) : Bâton / arme magique blanche
  Sagesse (Sa)      : Grimoire / arme religieuse
  Charisme (Ch)     : Chakram / instrument

PERSONNAGE À TERRE (0 PV)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  JS contre la mort DD 11 au début de son tour.
  3 réussites → stabilisé (reste à terre)
  3 échecs → mort
  Attaquer un inconscient monte son JS de 1.
  Se relever : 1 PV, pas d'action, déplacement ×½`;
}

function getInfoDeck() {
  return `LE DECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Contient tous les sorts utilisables en combat/tension.
  Hors combat : tous les sorts créés sont utilisables.
  Sorts d'éléments différents avec le même effet = 1 seule place.

CRÉER UN SORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Choisir un Noyau élémentaire (2 PM)
     Feu 🔥 · Eau 💧 · Terre 🪨 · Vent 🌬️
     Ombre 🌑 · Lumière ✨ · Physique 💪

  2. Associer des Runes d'effet (2 PM chacune)

  Coût total = 2 × (nombre de runes dont le noyau)
  Magie à mains nues : +2 PM, pas d'effet de set

RUNES DISPONIBLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Puissance    : +1 dé de dégâts. Allonge de l'arme.
  Protection   : +2 CA (2 tr) OU +1 dé de soin.
  Amplification: Zone +3m.
  Enchantement : (AB) Élément sur équip. allié 2 tr.
  Affliction   : Élément + État sur équip. ennemi 2 tr.
  Invocation   : Créature liée. 10 PV, CA 10.
  Dispersion   : Divise en projectiles. +1 cible.
  Lacération   : CA cible -1 (-2 max, -4 élites/boss)
  Chance       : RC -1 (20→19). Critique aussi max.
  Durée        : +2 tours de durée.
  Concentration: Sort actif hors tour. JS Sa DD11.
  Réaction     : Lance le sort hors de son tour.

INVOCATIONS — SERMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Apparition : Entité liée à un élément apparaît (RP)
  Serment    : Rune élément + JS Charisme DD11
  Invocation : Rune élément + Rune d'Invocation`;
}

function getInfoArtisanat() {
  return `ARTISANAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Nécessite : Outil/atelier + recette + jet d'artisanat (Fo/Dex/In)
  Recette : Une fois connue, utilisable à volonté avec les matériaux.

ATELIERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Alchimie (In)      : Alambic + plantes + pierre de feu → potion
  Cuisine (In)       : Marmite + consommables + pierre de feu → plat
  Forge (Fo)         : Forge → armes physiques + armures lourdes
  Confection (Dex)   : Atelier → armes dist., armures lég./inter.
  Orfèvrerie (In)    : Atelier d'orfèvre → armes magiques + bijoux

MATÉRIAUX PAR TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Légers    : Armures légères
  Tannés    : Armures intermédiaires
  Résistants: Armures lourdes / boucliers
  Précieux  : Bijoux
  Bestiaux  : Armes physiques / cuisine
  Souples   : Armes à distance
  Mystiques : Armes magiques

APPRENDRE UNE RECETTE D'ÉQUIPEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Détruire l'objet + réussir un Jet d'Analyse (In) DD 11`;
}

function getInfoBastion() {
  return `LE BASTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Génère de l'or à chaque session.
  10% aux fondateurs, 90% réinvestis.
  Chaque amélioration : Niveau Bastion +1, +100 or/session

AMÉLIORATIONS DISPONIBLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Cuisine              : Cuisiner sans marmite ni pierre de feu
  Atelier d'alchimie   : Potions sans alambic ni pierre de feu
  Forge                : Crafter armes phy. + armures lourdes
  Atelier de confection: Crafter armes dist. + armures lég./inter.
  Atelier d'orfèvrerie : Crafter armes magiques + bijoux

ÉVÉNEMENTS ALÉATOIRES (par cycle)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1 — Vol           : -20% revenus totaux
  2 — Inspection    : Revenus normaux
  3 — Calme         : Revenus normaux
  4 — Clientèle rich: +10 or
  5 — Rumeur fav.   : +20 or
  6 — Succès comm.  : +30 or`;
}

function getInfoEtats() {
  return `ÉTATS DE COMBAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Invisible       : Pas vu sans magie. Avantage attaque suivante.
  Endormie   (SA) : Ne peut agir/réagir. Réveil sur dégâts.
  Cécité     (SA) : Rate tout jet nécessitant la vue. Désavantage attaque.
  Charmé     (SA) : Ne peut attaquer le charmeur. Avantage social allié.
  Effrayé    (SA) : Ne peut s'approcher. Désavantage si source visible.
  Entravé    (Fo) : Déplacement ×½. Pas de bonus vitesse. Avantage ennemi.
  Étourdi    (Co) : Ne peut agir/réagir. Avantage ennemi.
  Pétrifié   (Co) : Ne peut agir/réagir. Résistance tous dégâts.
                    Immunisé DoT. Rate auto JS Fo/Dex.
  DoT        (Co) : 1d4 + In dégâts/tour pendant 2 tours.
  Provoqué   (CH) : Oblige à n'attaquer que le lanceur.
  Silence    (CH) : Plus de sorts ni de réaction. Désavantage magie.
  Inconscient(Co) : 0 PV. JS contre mort DD11 chaque tour.
                    Attaque → JS+1. Rate auto JS Fo/Dex.`;
}

// Informations edit actions
async function openRecetteModal(type, existing) {
