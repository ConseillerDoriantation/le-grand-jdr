// ══════════════════════════════════════════════
// NPC ACTIONS
// ══════════════════════════════════════════════
function openNpcModal(npc) {
  openModal(npc?'✏️ Modifier le PNJ':'👥 Nouveau PNJ', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="npc-nom" value="${npc?.nom||''}"></div>
    <div class="form-group"><label>Rôle / Fonction</label><input class="input-field" id="npc-role" value="${npc?.role||''}" placeholder="Marchand, Garde, Chef de guilde..."></div>
    <div class="form-group"><label>Disposition</label>
      <select class="input-field" id="npc-disp">
        ${['Amical','Neutre','Hostile','Mystérieux','Allié','Ennemi'].map(d=>`<option ${d===(npc?.disposition||'Neutre')?'selected':''}>${d}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Lieu</label><input class="input-field" id="npc-lieu" value="${npc?.lieu||''}" placeholder="Taverne du Dragon, Forêt de Sylvar..."></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="npc-desc" rows="4">${npc?.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveNpc('${npc?.id||''}')">Enregistrer</button>
  `);
}

async function saveNpc(id) {
  const data = {
    nom: document.getElementById('npc-nom')?.value||'?',
    role: document.getElementById('npc-role')?.value||'',
    disposition: document.getElementById('npc-disp')?.value||'Neutre',
    lieu: document.getElementById('npc-lieu')?.value||'',
    description: document.getElementById('npc-desc')?.value||'',
  };
  if (id) await updateInCol('npcs',id,data);
  else await addToCol('npcs',data);
  closeModal(); showNotif('PNJ enregistré !','success'); PAGES.npcs();
}

async function editNpc(id) {
  const items = await loadCollection('npcs');
  const npc = items.find(n=>n.id===id);
  if (npc) openNpcModal(npc);
}

async function deleteNpc(id) {
  if (!confirm('Supprimer ce PNJ ?')) return;
  await deleteFromCol('npcs',id); showNotif('PNJ supprimé.','success'); PAGES.npcs();
}

function filterNpcs(disp, el) {
  document.querySelectorAll('#npc-filter .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.npc-card').forEach(c=>{
    c.style.display = !disp||c.dataset.disp===disp ? '' : 'none';
  });
}
