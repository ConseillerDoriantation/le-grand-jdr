openModal(a?'✏️ Modifier':'🏆 Nouveau Haut-Fait', `
    <div class="form-group"><label>Titre</label><input class="input-field" id="ach-titre" value="${a?.titre||''}"></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="ach-desc" rows="4">${a?.description||''}</textarea></div>
    <div class="form-group"><label>URL de l'image</label><input class="input-field" id="ach-img" value="${a?.imageUrl||''}" placeholder="https://..."></div>
    <div class="form-group"><label>Emoji (si pas d'image)</label><input class="input-field" id="ach-emoji" value="${a?.emoji||'🏆'}"></div>
    <div class="form-group"><label>Date</label><input class="input-field" id="ach-date" value="${a?.date||new Date().toLocaleDateString('fr')}"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveAchievement('${a?.id||''}')">Enregistrer</button>
  `);
}

async function saveAchievement(id) {
  const data = {
    titre:document.getElementById('ach-titre')?.value||'?',
    description:document.getElementById('ach-desc')?.value||'',
    imageUrl:document.getElementById('ach-img')?.value||'',
    emoji:document.getElementById('ach-emoji')?.value||'🏆',
    date:document.getElementById('ach-date')?.value||'',
  };
  if(id) await updateInCol('achievements',id,data);
  else await addToCol('achievements',data);
  closeModal(); showNotif('Haut-fait enregistré !','success'); PAGES.achievements();
}

async function editAchievement(id) {
  const items = await loadCollection('achievements');
  const a = items.find(x=>x.id===id);
  if(a) openAchievementModal(a);
}
async function deleteAchievement(id) {
  if(!confirm('Supprimer ce haut-fait ?')) return;
  await deleteFromCol('achievements',id); showNotif('Supprimé.','success'); PAGES.achievements();
}

// ══════════════════════════════════════════════
// COLLECTION
// ══════════════════════════════════════════════
function openCollectionModal(card) {
