document.querySelectorAll('#best-cats .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.bestiary-card').forEach(c=>{
    c.style.display = !cat||c.dataset.cat===cat?'':'none';
  });
}

function openBestiaryModal(item) {
  openModal(item?'✏️ Modifier':'🐉 Nouvelle Créature', `
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Nom</label><input class="input-field" id="bs-nom" value="${item?.nom||''}"></div>
      <div class="form-group"><label>Emoji</label><input class="input-field" id="bs-emoji" value="${item?.emoji||'🐉'}"></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Catégorie</label><input class="input-field" id="bs-cat" value="${item?.categorie||''}" placeholder="Bête, Mort-vivant, Élémentaire..."></div>
      <div class="form-group"><label>XP</label><input type="number" class="input-field" id="bs-xp" value="${item?.xp||0}"></div>
    </div>
    <div class="grid-4" style="gap:0.5rem">
      <div class="form-group"><label>PV</label><input type="number" class="input-field" id="bs-pv" value="${item?.pv||10}"></div>
      <div class="form-group"><label>PM</label><input type="number" class="input-field" id="bs-pm" value="${item?.pm||0}"></div>
      <div class="form-group"><label>CA</label><input type="number" class="input-field" id="bs-ca" value="${item?.ca||10}"></div>
      <div class="form-group"><label>Vit.</label><input type="number" class="input-field" id="bs-vit" value="${item?.vitesse||3}"></div>
    </div>
    <div class="form-group"><label>Attaques (une par ligne: Nom|Dégâts|Effet)</label>
      <textarea class="input-field" id="bs-attaques" rows="4" placeholder="Morsure|1d6+Fo|Poison&#10;Griffe|1d4|—">${(item?.attaques||[]).map(a=>`${a.nom}|${a.degats}|${a.effet}`).join('\n')}</textarea>
    </div>
    <div class="form-group"><label>Traits spéciaux</label><textarea class="input-field" id="bs-traits" rows="2">${item?.traits||''}</textarea></div>
    <div class="form-group"><label>Butins</label><input class="input-field" id="bs-butins" value="${item?.butins||''}"></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveBestiary('${item?.id||''}')">Enregistrer</button>
  `);
}

async function saveBestiary(id) {
  const attaquesRaw = document.getElementById('bs-attaques')?.value||'';
  const attaques = attaquesRaw.split('\n').filter(Boolean).map(line=>{
    const [nom,degats,effet] = line.split('|');
    return {nom:nom?.trim()||'?', degats:degats?.trim()||'?', effet:effet?.trim()||''};
  });
  const data = {
    nom: document.getElementById('bs-nom')?.value||'?',
    emoji: document.getElementById('bs-emoji')?.value||'🐉',
    categorie: document.getElementById('bs-cat')?.value||'Créature',
    xp: parseInt(document.getElementById('bs-xp')?.value)||0,
    pv: parseInt(document.getElementById('bs-pv')?.value)||10,
    pm: parseInt(document.getElementById('bs-pm')?.value)||0,
    ca: parseInt(document.getElementById('bs-ca')?.value)||10,
    vitesse: parseInt(document.getElementById('bs-vit')?.value)||3,
    attaques,
    traits: document.getElementById('bs-traits')?.value||'',
    butins: document.getElementById('bs-butins')?.value||'',
  };
  if (id) await updateInCol('bestiaire',id,data);
  else await addToCol('bestiaire',data);
  closeModal(); showNotif('Créature enregistrée !','success'); PAGES.bestiaire();
}

async function editBestiary(id) {
  const items = await loadCollection('bestiaire');
  const item = items.find(x=>x.id===id);
  if (item) openBestiaryModal(item);
}
async function deleteBestiary(id) {
  if (!confirm('Supprimer cette créature ?')) return;
  await deleteFromCol('bestiaire',id); showNotif('Supprimé.','success'); PAGES.bestiaire();
}

// ══════════════════════════════════════════════
// PHOTO PERSONNAGE — UPLOAD & CROPPER
// ══════════════════════════════════════════════
function openPhotoCropper(charId) {
  const input = document.createElement('input');
  input.type = 'file';
