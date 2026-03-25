return {
    nom:'Le Bastion',niveau:1,tresor:0,defense:0,
    description:'Votre forteresse, gagnée de haute lutte.',
    salles:[
      {nom:'Grande Salle',niveau:1,effet:'Lieu de rassemblement'},
      {nom:'Forge',niveau:0,effet:'+1 Dégâts sur craft'},
      {nom:'Infirmerie',niveau:0,effet:'Soins entre missions'},
      {nom:'Tour de Guet',niveau:0,effet:'+2 Défense'},
      {nom:'Bibliothèque',niveau:0,effet:'+1 XP par session'},
    ],
    journal:[]
  };
}

function editBastion() {
  const d = STATE._bastionData||getDefaultBastion();
  openModal('🏰 Modifier le Bastion', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="b-nom" value="${d.nom||''}"></div>
    <div class="grid-3" style="gap:0.8rem">
      <div class="form-group"><label>Niveau</label><input type="number" class="input-field" id="b-niv" value="${d.niveau||1}" min="1"></div>
      <div class="form-group"><label>Trésor (Or)</label><input type="number" class="input-field" id="b-tresor" value="${d.tresor||0}" min="0"></div>
      <div class="form-group"><label>Défense</label><input type="number" class="input-field" id="b-def" value="${d.defense||0}" min="0"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="b-desc" rows="3">${d.description||''}</textarea></div>
    <hr class="divider">
    <div style="font-family:'Cinzel',serif;font-size:0.72rem;color:var(--gold);margin-bottom:0.8rem">SALLES (niveau 0-3)</div>
    ${(d.salles||[]).map((s,i)=>`<div class="grid-3" style="gap:0.5rem;margin-bottom:0.5rem">
      <input class="input-sm" id="b-snom-${i}" value="${s.nom||''}" placeholder="Nom de la salle">
      <input type="number" class="input-sm" id="b-sniv-${i}" value="${s.niveau||0}" min="0" max="3" placeholder="Niv">
      <input class="input-sm" id="b-seff-${i}" value="${s.effet||''}" placeholder="Effet">
    </div>`).join('')}
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBastion()">Enregistrer</button>
  `);
}

async function saveBastion() {
  const d = STATE._bastionData||getDefaultBastion();
  const salles = (d.salles||[]).map((_,i)=>({
    nom:document.getElementById(`b-snom-${i}`)?.value||'',
    niveau:parseInt(document.getElementById(`b-sniv-${i}`)?.value)||0,
    effet:document.getElementById(`b-seff-${i}`)?.value||'',
  }));
  const data = {
    nom:document.getElementById('b-nom')?.value||'',
    niveau:parseInt(document.getElementById('b-niv')?.value)||1,
    tresor:parseInt(document.getElementById('b-tresor')?.value)||0,
    defense:parseInt(document.getElementById('b-def')?.value)||0,
    description:document.getElementById('b-desc')?.value||'',
    salles, journal:d.journal||[],
  };
  STATE._bastionData = data;
  await saveDoc('bastion','main',data);
  closeModal(); showNotif('Bastion mis à jour !','success'); PAGES.bastion();
}

async function addBastionLog() {
  const texte = prompt('Entrez une note pour le journal du Bastion :');
  if (!texte) return;
  const d = await getDocData('bastion','main')||getDefaultBastion();
  d.journal = d.journal||[];
  d.journal.unshift({date:new Date().toLocaleDateString('fr'),texte});
  await saveDoc('bastion','main',d);
  showNotif('Entrée ajoutée !','success'); PAGES.bastion();
}

// ══════════════════════════════════════════════
// WORLD ACTIONS
// ══════════════════════════════════════════════
async function editWorldContent() {
