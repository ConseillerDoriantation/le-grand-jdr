openModal(`${type==='cuisine'?'🍳 Recette Cuisine':'🧪 Potion'}`, `
    <div class="form-group"><label>Nom</label><input class="input-field" id="rec-nom" value="${existing?.nom||''}"></div>
    ${type==='cuisine'?`<div class="form-group"><label>Durée</label><input class="input-field" id="rec-duree" value="${existing?.duree||''}" placeholder="Avant mission..."></div>`:''}
    ${type==='potion'?`<div class="form-group"><label>Famille</label><input class="input-field" id="rec-famille" value="${existing?.famille||''}" placeholder="Soin, Combat..."></div>`:''}
    <div class="form-group"><label>Ingrédients</label><input class="input-field" id="rec-ingredients" value="${existing?.ingredients||''}" placeholder="Plante x2, Pierre de feu..."></div>
    <div class="form-group"><label>Effet</label><textarea class="input-field" id="rec-effet" rows="3">${existing?.effet||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveRecette('${type}','${existing?.id||''}')">Enregistrer</button>
  `);
}

async function saveRecette(type, id) {
  const doc = await getDocData('recettes','main') || {recettes:[],potions:[]};
  const data = {
    nom: document.getElementById('rec-nom')?.value||'?',
    duree: document.getElementById('rec-duree')?.value||'',
    famille: document.getElementById('rec-famille')?.value||'',
    ingredients: document.getElementById('rec-ingredients')?.value||'',
    effet: document.getElementById('rec-effet')?.value||'',
    type,
  };
  if (type==='cuisine') {
    if (id) { const i=doc.recettes.findIndex(r=>r.id===id); if(i>=0) doc.recettes[i]={...doc.recettes[i],...data}; }
    else doc.recettes.push({...data, id: Date.now().toString()});
  } else {
    if (id) { const i=doc.potions.findIndex(r=>r.id===id); if(i>=0) doc.potions[i]={...doc.potions[i],...data}; }
    else doc.potions.push({...data, id: Date.now().toString()});
  }
  await saveDoc('recettes','main',doc);
  closeModal(); showNotif('Recette enregistrée !','success'); PAGES.recettes();
}

async function deleteRecette(id) {
  if (!confirm('Supprimer ?')) return;
  const doc = await getDocData('recettes','main') || {recettes:[],potions:[]};
  doc.recettes = (doc.recettes||[]).filter(r=>r.id!==id);
  doc.potions = (doc.potions||[]).filter(r=>r.id!==id);
  await saveDoc('recettes','main',doc);
  showNotif('Supprimé.','success'); PAGES.recettes();
}

function filterBestiary(cat, el) {
