import { STATE } from '../../core/state.js';
import { addToCol, updateInCol, deleteFromCol, loadCollectionWhere, loadCollection } from '../../data/firestore.js';
import { openModal, closeModal, confirmModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { calcPVMax, calcPMMax, pct } from '../../shared/char-stats.js';
import PAGES from '../pages.js';

// ══════════════════════════════════════════════
// STAT ADJUST (PV/PM actuel)
// ══════════════════════════════════════════════
export async function adjustStat(stat, delta, charId) {
  try {
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) return;
    const maxVal = stat==='pvActuel' ? calcPVMax(c) : calcPMMax(c);
    const cur = c[stat]??maxVal;
    const newVal = Math.max(0, Math.min(maxVal, cur+delta));
    c[stat] = newVal;
    await updateInCol('characters', c.id, {[stat]: newVal});

    const p = pct(newVal, maxVal);
    if (stat==='pvActuel') {
      const valEl=document.getElementById('pv-val'), barEl=document.getElementById('pv-bar');
      if(valEl){valEl.textContent=newVal;valEl.style.color=p<25?'var(--crimson-light)':p<50?'#f59e0b':'var(--green)';}
      if(barEl){barEl.style.width=p+'%';barEl.className='cs-bar-fill cs-bar-hp-fill '+(p>50?'high':p>25?'mid':'');}
    } else {
      const valEl=document.getElementById('pm-val'), barEl=document.getElementById('pm-bar');
      if(valEl) valEl.textContent=newVal;
      if(barEl) barEl.style.width=p+'%';
    }
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// NOTES LIBRES
// ══════════════════════════════════════════════
export async function saveNotes() {
  try {
    const c = STATE.activeChar; if(!c) return;
    const notes = document.getElementById('char-notes-area')?.value||'';
    c.notes = notes;
    await updateInCol('characters', c.id, {notes});
    showNotif('Notes sauvegardées !','success');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// SORTS (toggle / delete)
// ══════════════════════════════════════════════
export async function toggleSort(idx) {
  try {
    const c=STATE.activeChar; if(!c) return;
    const sorts=c.deck_sorts||[];
    sorts[idx].actif=!sorts[idx].actif;
    c.deck_sorts=sorts;
    await updateInCol('characters',c.id,{deck_sorts:sorts});
    window.renderCharSheet(c,'sorts');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// QUÊTES
// ══════════════════════════════════════════════
export async function toggleQuete(idx) {
  try {
    const c=STATE.activeChar; if(!c) return;
    c.quetes[idx].valide=!c.quetes[idx].valide;
    await updateInCol('characters',c.id,{quetes:c.quetes});
    window.renderCharSheet(c,'quetes');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export async function deleteQuete(idx) {
  try {
    const c=STATE.activeChar; if(!c) return;
    c.quetes.splice(idx,1);
    await updateInCol('characters',c.id,{quetes:c.quetes});
    window.renderCharSheet(c,'quetes');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export function addQuete() {
  openModal('📜 Ajouter une quête', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="q-nom" placeholder="La Crypte Maudite..."></div>
    <div class="form-group"><label>Type</label><input class="input-field" id="q-type" placeholder="Principale, Secondaire..."></div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="q-desc" rows="3" placeholder="Objectif..."></textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveQuete()">Ajouter</button>
  `);
}

export async function saveQuete() {
  try {
    const c = STATE.activeChar; if(!c) return;
    const quetes = c.quetes||[];
    quetes.push({
      nom: document.getElementById('q-nom')?.value||'?',
      type: document.getElementById('q-type')?.value||'',
      description: document.getElementById('q-desc')?.value||'',
      valide: false,
    });
    c.quetes=quetes;
    await updateInCol('characters',c.id,{quetes});
    closeModal();
    showNotif('Quête ajoutée !','success');
    window.renderCharSheet(c,'quetes');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// INVENTAIRE — suppression legacy
// ══════════════════════════════════════════════
export async function deleteSort(idx) {
  try {
    const c=STATE.activeChar; if(!c) return;
    c.deck_sorts.splice(idx,1);
    await updateInCol('characters',c.id,{deck_sorts:c.deck_sorts});
    window.renderCharSheet(c,'sorts');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export async function deleteInvItem(idx) {
  try {
    const c=STATE.activeChar; if(!c) return;
    c.inventaire.splice(idx,1);
    await updateInCol('characters',c.id,{inventaire:c.inventaire});
    window.renderCharSheet(c,'inventaire');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// LIFECYCLE — création / suppression
// ══════════════════════════════════════════════
export async function deleteChar(id) {
  try {
    if (!await confirmModal('Supprimer ce personnage ? Toutes ses références (trame, hauts-faits, PNJ, bastion) seront également nettoyées.')) return;
    await deleteFromCol('characters', id);

    // ── players ──────────────────────────────────────────────────────────────
    try {
      const linked = await loadCollectionWhere('players', 'charId', '==', id);
      await Promise.all(linked.map(p => deleteFromCol('players', p.id)));
    } catch (e2) { console.warn('[deleteChar] cascade players :', e2); }

    // ── story — retirer des groupes de missions ───────────────────────────────
    try {
      const stories = await loadCollection('story');
      await Promise.all(stories.map(s => {
        if (!s.groupes?.length) return;
        const updated = s.groupes.map(g => ({
          ...g,
          membres: (g.membres || []).filter(mid => mid !== id),
        }));
        const changed = updated.some((g, i) => g.membres.length !== (s.groupes[i]?.membres||[]).length);
        if (!changed) return;
        return updateInCol('story', s.id, { groupes: updated });
      }));
    } catch (e2) { console.warn('[deleteChar] cascade story :', e2); }

    // ── achievements — retirer des contributeurs ──────────────────────────────
    try {
      const achievements = await loadCollection('achievements');
      await Promise.all(achievements.map(a => {
        const contrib = a.contributeurs || [];
        if (!contrib.includes(id)) return;
        return updateInCol('achievements', a.id, { contributeurs: contrib.filter(x => x !== id) });
      }));
    } catch (e2) { console.warn('[deleteChar] cascade achievements :', e2); }

    // ── npc_affinites — supprimer les affinités du personnage ─────────────────
    try {
      const affinites = await loadCollectionWhere('npc_affinites', 'charId', '==', id);
      await Promise.all(affinites.map(a => deleteFromCol('npc_affinites', a.id)));
    } catch (e2) { console.warn('[deleteChar] cascade npc_affinites :', e2); }

    // ── bastion — retirer des fondateurs et distributions ────────────────────
    try {
      const bastions = await loadCollection('bastion');
      await Promise.all(bastions.map(b => {
        const updates = {};
        if ((b.fondateurs || []).some(f => (f.charId || f) === id)) {
          updates.fondateurs = (b.fondateurs || []).filter(f => (f.charId || f) !== id);
        }
        if ((b.historique || []).some(h =>
          h.investisseur?.charId === id ||
          (h.distributions || []).some(d => d.charId === id)
        )) {
          updates.historique = (b.historique || []).map(h => ({
            ...h,
            investisseur: h.investisseur?.charId === id ? null : h.investisseur,
            distributions: (h.distributions || []).filter(d => d.charId !== id),
          }));
        }
        if (!Object.keys(updates).length) return;
        return updateInCol('bastion', b.id, updates);
      }));
    } catch (e2) { console.warn('[deleteChar] cascade bastion :', e2); }

    showNotif('Personnage supprimé.', 'success');
    PAGES.characters();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

export async function createNewChar() {
  try {
    const data = {
      uid: STATE.user.uid,
      ownerPseudo: STATE.profile?.pseudo||'?',
      nom:'Nouveau personnage', titre:'', titres:[],
      niveau:1, or:0,
      pvBase:10, pvActuel:10, pmBase:10, pmActuel:10,
      exp:0,
      stats:{force:8,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:8},
      statsBonus:{},
      equipement:{}, inventaire:[], deck_sorts:[], quetes:[], notes:'',
    };
    await addToCol('characters', data);
    showNotif('Personnage créé !','success');
    PAGES.characters();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// TITRES
// ══════════════════════════════════════════════
export function manageTitres(charId) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  window._editTitres = [...(c.titres||[])];
  const render = () => window._editTitres.map((t,i)=>
    `<span class="cs-titre-chip">${t}<button onclick="removeTitre(${i})">✕</button></span>`
  ).join('');
  openModal('🏅 Titres', `
    <div id="titres-list" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.8rem;min-height:2rem">${render()}</div>
    <div style="display:flex;gap:0.5rem">
      <input class="input-field" id="ei-titre-new" placeholder="Nouveau titre..." style="flex:1" onkeydown="if(event.key==='Enter')addTitre()">
      <button class="btn btn-outline btn-sm" onclick="addTitre()">+ Ajouter</button>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveTitres('${charId}')">Enregistrer</button>
  `);
}

export function addTitre() {
  const input = document.getElementById('ei-titre-new');
  const val = input?.value.trim();
  if (!val) return;
  window._editTitres = window._editTitres||[];
  window._editTitres.push(val);
  input.value='';
  _refreshTitresList();
}

export function removeTitre(idx) {
  window._editTitres.splice(idx,1);
  _refreshTitresList();
}

function _refreshTitresList() {
  const list = document.getElementById('titres-list');
  if (list) list.innerHTML = window._editTitres.map((t,i)=>
    `<span class="cs-titre-chip">${t}<button onclick="removeTitre(${i})">✕</button></span>`
  ).join('');
}

export async function saveTitres(charId) {
  try {
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) return;
    c.titres = window._editTitres||[];
    await updateInCol('characters', charId, {titres: c.titres});
    closeModal();
    window.renderCharSheet(c, window._currentCharTab);
    showNotif('Titres mis à jour !','success');
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════
// PHOTO
// ══════════════════════════════════════════════
export function deleteCharPhoto(id) {
  const c = STATE.characters.find(x=>x.id===id)||STATE.activeChar;
  if (!c) return;
  c.photo=null; c.photoZoom=1; c.photoX=0; c.photoY=0;
  updateInCol('characters',id,{photo:null,photoZoom:1,photoX:0,photoY:0});
  window.renderCharSheet(c, window._currentCharTab);
}
