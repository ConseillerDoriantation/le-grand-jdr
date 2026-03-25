const doc = await getDocData('world','main');
  const sections = doc?.sections||[{title:'Introduction',content:''}];
  openModal('📖 Modifier le Contenu du Monde', `
    <div id="world-sections">
      ${sections.map((s,i)=>`
        <div style="margin-bottom:1rem;background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:1rem">
          <div class="form-group"><label>Titre de la section</label><input class="input-field" id="ws-title-${i}" value="${s.title||''}"></div>
          <div class="form-group"><label>Contenu</label><textarea class="input-field" id="ws-content-${i}" rows="5">${s.content||''}</textarea></div>
          <button class="btn btn-danger btn-sm" onclick="removeWorldSection(${i})">Supprimer</button>
        </div>`).join('')}
    </div>
    <button class="btn btn-outline btn-sm" onclick="addWorldSection(${sections.length})" style="margin-bottom:1rem">+ Ajouter une section</button>
    <button class="btn btn-gold" style="width:100%" onclick="saveWorld(${sections.length})">Enregistrer</button>
  `);
  window._worldSectionCount = sections.length;
}

async function saveWorld(count) {
  const sections = [];
  for (let i=0;i<(window._worldSectionCount||count);i++) {
    const t=document.getElementById(`ws-title-${i}`), c=document.getElementById(`ws-content-${i}`);
    if(t&&c) sections.push({title:t.value,content:c.value});
  }
  await saveDoc('world','main',{sections});
  closeModal(); showNotif('Monde mis à jour !','success'); PAGES.world();
}

// ══════════════════════════════════════════════
// MAP ACTIONS
// ══════════════════════════════════════════════
async function saveMapUrl() {
  const url = document.getElementById('map-url-input')?.value||'';
  await saveDoc('world','map',{imageUrl:url});
  showNotif('Carte mise à jour !','success'); PAGES.map();
}

// ══════════════════════════════════════════════
// ACHIEVEMENTS
// ══════════════════════════════════════════════
function openAchievementModal(a) {
