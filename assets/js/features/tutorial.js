document.querySelectorAll('.tutorial-nav-item').forEach(i=>i.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tut-content').textContent = (window._tutSections||[])[idx]?.content||'';
}

async function editTutorial() {
  const doc = await getDocData('tutorial','main');
  const sections = doc?.sections||getDefaultTutorial();
  openModal('📕 Modifier le Tutoriel', `
    <div id="tut-sections">
      ${sections.map((s,i)=>`
        <div style="margin-bottom:1rem;background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:1rem">
          <div class="form-group"><label>Titre</label><input class="input-field" id="ts-title-${i}" value="${s.title||''}"></div>
          <div class="form-group"><label>Contenu</label><textarea class="input-field" id="ts-content-${i}" rows="8">${s.content||''}</textarea></div>
        </div>`).join('')}
    </div>
    <button class="btn btn-gold" style="width:100%" onclick="saveTutorial(${sections.length})">Enregistrer</button>
  `);
  window._tutSectionCount = sections.length;
}

async function saveTutorial(count) {
  const sections = [];
  for(let i=0;i<(window._tutSectionCount||count);i++){
    const t=document.getElementById(`ts-title-${i}`),c=document.getElementById(`ts-content-${i}`);
    if(t&&c) sections.push({title:t.value,content:c.value});
  }
  await saveDoc('tutorial','main',{sections});
  closeModal(); showNotif('Tutoriel mis à jour !','success'); PAGES.tutorial();
}

function getDefaultTutorial() {
  return [
    {title:'Introduction',content:'Bienvenue dans Le Grand JDR !\n\nCe tutoriel t\'explique comment fonctionnent les mécaniques du jeu.'},
    {title:'Les Caractéristiques',content:'Force (Fo) : Puissance physique, attaques au corps-à-corps.\nDextérité (Dex) : Agilité, attaques à distance.\nIntelligence (In) : Aptitude magique.\nSagesse (Sa) : Perception et sorts de support.\nConstitution (Co) : Endurance, PV bonus.\nCharisme (Ch) : Persuasion, sorts de charme.\n\nLe Modificateur = (Stat - 10) / 2 (arrondi inférieur).'},
    {title:'Le Combat',content:'Chaque tour tu disposes de :\n• 1 Action\n• 1 Action Bonus\n• 1 Réaction\n• Déplacement (Vitesse en mètres)\n\nAttaque : 1d20 + Modificateur vs CA de la cible.\nCritique : Max des dés + relance les dés de dégâts.'},
    {title:'La Magie',content:'Les sorts coûtent des PM.\nLe Noyau indique quelle caractéristique est utilisée.\n\n* = Sort qui ne dépend d\'aucune stat.\n\nMagie à mains nues : +2 PM, pas d\'effet de set.'},
    {title:'L\'Équipement',content:'L\'équipement apporte des bonus à tes caractéristiques et à ta CA.\n\nEffet de Set : Equiper plusieurs pièces d\'un même set active un bonus spécial.\n\nArmes : Main principale (attaque principale) et main secondaire (réaction).'},
    {title:'Les Runes',content:'Les runes sont des améliorations que l\'on peut appliquer à l\'équipement.\n\nElles apportent des effets supplémentaires uniques.'},
  ];
}
