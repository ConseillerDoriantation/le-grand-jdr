import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { addToCol, updateInCol, deleteFromCol, loadCollectionWhere, loadCollection } from '../../data/firestore.js';
import { trySave } from '../../shared/crud.js';
import { openModal, closeModal, confirmModal, modalSection } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { calcDeckMax, calcPVMax, calcPMMax, pct } from '../../shared/char-stats.js';
import { loadAllUsers } from '../../core/adventure.js';
import { _esc } from '../../shared/html.js';
import { makeSortable } from '../../shared/sortable-helper.js';
import PAGES from '../pages.js';

import { getCharacterById } from '../../shared/character-state.js';
let _newCharOwners = [];
let _editTitres = [];
let _titresSortable = null;
function _renderFormsChar(c, tab) {
  charSession.renderSheet(c, tab || charSession.getCurrentCharTab() || 'combat');
}

// ══════════════════════════════════════════════
// STAT ADJUST (PV/PM actuel)
// ══════════════════════════════════════════════
function flashEl(el) {
  if (!el) return;
  el.classList.remove('cs-save-flash');
  void el.offsetWidth;
  el.classList.add('cs-save-flash');
}

export async function adjustStat(stat, delta, charId) {
  const c = getCharacterById(charId);
  if (!c) return;
  const maxVal = stat==='pvActuel' ? calcPVMax(c) : calcPMMax(c);
  const cur = c[stat]??maxVal;
  const newVal = Math.max(0, Math.min(maxVal, cur+delta));
  c[stat] = newVal;
  await trySave('characters', c.id, {[stat]: newVal});

  const p = pct(newVal, maxVal);
  if (stat==='pvActuel') {
    const valEl=document.getElementById('pv-val'), barEl=document.getElementById('pv-bar');
    if(valEl){valEl.textContent=newVal;valEl.style.color=p<25?'var(--crimson-light)':p<50?'#f59e0b':'var(--green)';flashEl(valEl);}
    if(barEl){barEl.style.width=p+'%';barEl.className='cs-bar-fill cs-bar-hp-fill '+(p>50?'high':p>25?'mid':'');}
  } else {
    const valEl=document.getElementById('pm-val'), barEl=document.getElementById('pm-bar');
    if(valEl){valEl.textContent=newVal;flashEl(valEl);}
    if(barEl) barEl.style.width=p+'%';
  }
}

// ══════════════════════════════════════════════
// NOTES LIBRES
// ══════════════════════════════════════════════
export async function saveNotes() {
  const c = STATE.activeChar; if(!c) return;
  const notes = document.getElementById('char-notes-area')?.value||'';
  c.notes = notes;
  if (await trySave('characters', c.id, {notes})) showNotif('Notes sauvegardées !','success');
}

// ══════════════════════════════════════════════
// SORTS (toggle / delete)
// ══════════════════════════════════════════════
export async function toggleSort(idx, btn = null) {
  const c=STATE.activeChar; if(!c) return;
  const sorts=c.deck_sorts||[];
  const s = sorts[idx]; if (!s) return;
  // Un joueur ne peut mettre dans son Deck qu'un sort VALIDÉ par le MJ.
  // Rétro-compat : un sort créé AVANT la validation MJ (aucun champ) = validé
  // (sinon tous les sorts existants seraient bloqués hors du deck).
  const vState = s.mjValidation
    || (typeof s.mjValidated === 'boolean' ? (s.mjValidated ? 'ok' : 'pending') : 'ok');
  const isValidated = vState === 'ok';
  if (!s.actif && !isValidated && !STATE.isAdmin) {
    showNotif('Ce sort doit être validé par le MJ avant d\'entrer dans le Deck.', 'error');
    return;
  }
  const deckMax = calcDeckMax(c);
  const deckCount = sorts.filter(x => x?.actif).length;
  if (!s.actif && deckCount >= deckMax) {
    showNotif(`Deck plein (${deckCount}/${deckMax}) — retire un sort avant d'en ajouter un.`, 'error');
    return;
  }

  const prevActif = !!s.actif;
  const nextActif = !prevActif;
  const paint = (active) => {
    if (!btn) return;
    btn.classList.toggle('on', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.closest('.cs-spellcard')?.classList.toggle('is-actif', active);
  };

  s.actif=nextActif;
  c.deck_sorts=sorts;
  paint(nextActif);
  if (charSession.getCurrentChar()?.id === c.id)
    charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;

  if (await trySave('characters',c.id,{deck_sorts:sorts})) {
    _renderFormsChar(c, 'sorts');
  } else {
    s.actif = prevActif;
    c.deck_sorts = sorts;
    paint(prevActif);
    if (charSession.getCurrentChar()?.id === c.id)
      charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  }
}

// ══════════════════════════════════════════════
// QUÊTES
// ══════════════════════════════════════════════
export async function toggleQuete(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.quetes[idx].valide=!c.quetes[idx].valide;
  if (await trySave('characters',c.id,{quetes:c.quetes})) _renderFormsChar(c, 'quetes');
}

export async function deleteQuete(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.quetes.splice(idx,1);
  if (await trySave('characters',c.id,{quetes:c.quetes})) _renderFormsChar(c, 'quetes');
}

export function addQuete() {
  openQueteModal();
}

export function editQuete(idx) {
  openQueteModal(idx);
}

function openQueteModal(idx = null) {
  const c = STATE.activeChar; if (!c) return;
  const editIdx = Number.isInteger(idx) ? idx : null;
  const q = editIdx != null ? (c.quetes || [])[editIdx] : null;
  if (editIdx != null && !q) {
    showNotif('Quête introuvable.', 'error');
    return;
  }
  openModal(q ? '✏️ Modifier la quête' : '📜 Ajouter une quête', `
    ${modalSection('📜 Détails de la quête', `
      <div class="form-group" style="margin:0 0 .6rem"><label>Nom</label><input class="input-field" id="q-nom" value="${_esc(q?.nom || '')}" placeholder="La Crypte Maudite..."></div>
      <div class="form-group" style="margin:0 0 .6rem"><label>Type</label><input class="input-field" id="q-type" value="${_esc(q?.type || '')}" placeholder="Principale, Secondaire..."></div>
      <div class="form-group" style="margin:0"><label>Description</label><textarea class="input-field" id="q-desc" rows="3" placeholder="Objectif...">${_esc(q?.description || '')}</textarea></div>`)}
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveQuete" data-idx="${editIdx ?? ''}">${q ? 'Enregistrer' : 'Ajouter'}</button>
  `, { subtitle: q ? 'Mise à jour de l’objectif' : 'Nouvel objectif pour le personnage' });
}

export async function saveQuete(idx = null) {
  const c = STATE.activeChar; if(!c) return;
  const editIdx = Number.isInteger(idx) ? idx : null;
  const quetes = Array.isArray(c.quetes) ? [...c.quetes] : [];
  const prev = editIdx != null ? quetes[editIdx] : null;
  if (editIdx != null && !prev) {
    showNotif('Quête introuvable.', 'error');
    return;
  }
  const next = {
    nom: document.getElementById('q-nom')?.value||'?',
    type: document.getElementById('q-type')?.value||'',
    description: document.getElementById('q-desc')?.value||'',
    valide: !!prev?.valide,
  };
  if (editIdx != null) quetes[editIdx] = { ...prev, ...next };
  else quetes.push(next);
  c.quetes=quetes;
  if (await trySave('characters',c.id,{quetes})) {
    closeModal();
    showNotif(editIdx != null ? 'Quête modifiée !' : 'Quête ajoutée !','success');
    _renderFormsChar(c, 'quetes');
  }
}

// ══════════════════════════════════════════════
// INVENTAIRE — suppression legacy
// ══════════════════════════════════════════════
export async function deleteSort(idx) {
  const c=STATE.activeChar; if(!c) return;
  const nom = (c.deck_sorts||[])[idx]?.nom || 'ce sort';
  if (!await confirmModal(`Supprimer <b>${_esc(nom)}</b> ?`, {
    title: 'Confirmation', confirmLabel: 'Supprimer', icon: '🗑️',
  })) return;
  c.deck_sorts.splice(idx,1);
  if (await trySave('characters',c.id,{deck_sorts:c.deck_sorts})) _renderFormsChar(c, 'sorts');
}

export async function duplicateSort(idx) {
  const c=STATE.activeChar; if(!c) return;
  const sorts = [...(c.deck_sorts||[])];
  const src = sorts[idx]; if (!src) return;
  const clone = (typeof structuredClone === 'function')
    ? structuredClone(src)
    : JSON.parse(JSON.stringify(src));
  clone.id = `s${Date.now().toString(36)}`;
  clone.nom = `${(src.nom || 'Sort').trim() || 'Sort'} (copie)`;
  clone.actif = false;
  clone.mjValidation = 'pending';
  clone.mjValidated = false;
  sorts.splice(idx + 1, 0, clone);
  c.deck_sorts = sorts;
  if (await trySave('characters', c.id, {deck_sorts: sorts})) {
    showNotif('Sort dupliqué — à valider par le MJ.', 'success');
    _renderFormsChar(c, 'sorts');
  }
}

export async function setSortValidation(idx, status) {
  if (!STATE.isAdmin) return;
  const c=STATE.activeChar; if(!c) return;
  const sorts = [...(c.deck_sorts||[])];
  const s = sorts[idx]; if (!s) return;
  const nextStatus = ['ok', 'pending', 'no'].includes(status) ? status : 'pending';
  const next = { ...s, mjValidation: nextStatus, mjValidated: nextStatus === 'ok' };
  if (nextStatus !== 'ok') next.actif = false;
  sorts[idx] = next;
  c.deck_sorts = sorts;
  if (charSession.getCurrentChar()?.id === c.id)
    charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (await trySave('characters', c.id, {deck_sorts: sorts})) {
    const label = nextStatus === 'ok' ? 'validé' : nextStatus === 'no' ? 'refusé' : 'remis à valider';
    showNotif(`Sort ${label}.`, nextStatus === 'no' ? 'info' : 'success');
    _renderFormsChar(c, 'sorts');
  }
}

export async function deleteInvItem(idx) {
  const c=STATE.activeChar; if(!c) return;
  c.inventaire.splice(idx,1);
  if (await trySave('characters',c.id,{inventaire:c.inventaire})) _renderFormsChar(c, 'inventaire');
}

// ══════════════════════════════════════════════
// LIFECYCLE — création / suppression
// ══════════════════════════════════════════════
export async function deleteChar(id) {
  if (!await confirmModal('Supprimer ce personnage ? Toutes ses références (trame, hauts-faits, PNJ, quêtes, bastion) seront également nettoyées.')) return;

  // Suppression + cascades factorisées dans purgeCharacter (réutilisé par « Quitter
  // l'aventure »). La suppression principale peut échouer (règles/réseau) → on stoppe.
  try {
    await purgeCharacter(id);
  } catch (e) {
    notifySaveError(e);
    showNotif("Suppression refusée — vérifie les règles Firestore (suppression autorisée au propriétaire et au MJ).", 'error');
    return;
  }

  // ── Reset de l'état actif si on vient de supprimer le perso affiché ────────
  // Évite un « ghost » : la fiche supprimée pointée par STATE.activeChar.
  if (STATE.activeChar?.id === id)   STATE.activeChar = null;
  if (charSession.getCurrentChar()?.id === id) charSession.set(null, false, charSession.getCurrentCharTab());
  if (Array.isArray(STATE.characters)) {
    STATE.characters = STATE.characters.filter(c => c.id !== id);
  }

  showNotif('Personnage supprimé.', 'success');
  PAGES.characters();
}

// Suppression du perso + cascades de nettoyage (best-effort), sans UI ni confirm.
// Réutilisé par deleteChar (confirm/refresh) et par « Quitter l'aventure ». La
// suppression principale laisse remonter son erreur ; les cascades sont non bloquantes.
export async function purgeCharacter(id) {
  await deleteFromCol('characters', id);

  // ── Cascades de nettoyage (best-effort, non bloquantes) ───────────────────
  // Chaque bloc est isolé : un refus de règle (ex: joueur sans droit sur une
  // collection MJ) ne doit pas empêcher les autres nettoyages ni la réussite
  // globale, le document personnage étant déjà supprimé.
  try {
    // ── players ──────────────────────────────────────────────────────────────
    try {
      const linked = await loadCollectionWhere('players', 'charId', '==', id);
      await Promise.all(linked.map(p => deleteFromCol('players', p.id)));
    } catch (e2) { console.warn('[deleteChar] cascade players :', e2); }

    // ── quests — retirer des participants ─────────────────────────────────────
    try {
      const quests = await loadCollection('quests');
      await Promise.all(quests.map(q => {
        const parts = q.participants || [];
        if (!parts.includes(id)) return;
        return updateInCol('quests', q.id, { participants: parts.filter(x => x !== id) });
      }));
    } catch (e2) { console.warn('[deleteChar] cascade quests :', e2); }

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
    } catch (e2) { console.warn('[purgeCharacter] cascade bastion :', e2); }
  } catch (cascadeErr) {
    // Le document personnage est déjà supprimé : une cascade interrompue ne
    // doit pas masquer le succès ni bloquer le rafraîchissement de la page.
    console.warn('[purgeCharacter] cascade interrompue :', cascadeErr);
  }
}

export async function createNewChar() {
  // Joueur : crée pour son propre compte (comportement historique).
  if (!STATE.isAdmin) {
    return _createCharForOwner(STATE.user.uid, STATE.profile?.pseudo || '?');
  }
  // MJ : choisir le compte propriétaire parmi les membres de l'aventure.
  await _openCharOwnerPicker();
}

/** Crée un personnage rattaché au compte (uid) donné.
 *  Les règles Firestore autorisent un MJ à créer un perso pour un autre uid
 *  (allow create: ... || isAdvAdmin). */
async function _createCharForOwner(uid, ownerPseudo) {
  try {
    const data = {
      uid,
      ownerPseudo: ownerPseudo || '?',
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
  } catch (e) { notifySaveError(e); }
}

/** Membres de l'aventure courante (comptes), triés : soi d'abord puis alpha. */
async function _advMembersSorted() {
  const adv = STATE.adventure;
  const allUsers = await loadAllUsers();
  const byId     = new Map(allUsers.map(u => [u.id, u]));
  const profiles = adv?.memberProfiles || {};
  const absorbed = new Set(Object.keys(adv?.accountRelinks || {}));

  // Source de vérité = les UID membres de l'aventure, PAS la lecture des docs
  // users (qui échoue si le MJ n'est pas super-admin global → un membre pouvait
  // disparaître du sélecteur). Le nom vient du doc users si lisible, sinon de
  // memberProfiles (dénormalisé, toujours lisible), sinon fallback UID. On écarte
  // les comptes ABSORBÉS (fusionnés) et on dédoublonne par email.
  const memberUids = [...new Set([
    ...(adv?.admins || []),
    ...(adv?.players || []),
    ...(adv?.accessList || []),
    STATE.user.uid, // toujours pouvoir créer pour soi
  ])].filter(uid => uid && !absorbed.has(uid));

  const profOf = (uid) => {
    const p = profiles[uid];
    return typeof p === 'string' ? { pseudo: p } : (p || {});
  };
  let members = memberUids.map(uid => {
    const u = byId.get(uid) || {};
    const p = profOf(uid);
    return { id: uid, pseudo: u.pseudo || p.pseudo || '', email: u.email || p.email || '' };
  });

  const seenEmail = new Set();
  members = members.filter(m => {
    const email = String(m.email || '').trim().toLowerCase();
    if (!email) return true;
    if (seenEmail.has(email)) return false;
    seenEmail.add(email);
    return true;
  });
  if (!members.length) members = [{ id: STATE.user.uid, pseudo: STATE.profile?.pseudo || 'Moi' }];
  const selfId = STATE.user.uid;
  members.sort((a, b) =>
    (a.id === selfId ? -1 : b.id === selfId ? 1 : 0) ||
    (a.pseudo || a.email || '').localeCompare(b.pseudo || b.email || ''));
  return members;
}

/** MJ : sélecteur du compte propriétaire (membres de l'aventure courante). */
async function _openCharOwnerPicker() {
  const adv = STATE.adventure;
  const members = await _advMembersSorted();
  const selfId = STATE.user.uid;
  _newCharOwners = members;

  const admins = adv?.admins || [];
  const options = members.map(u => {
    const isMe = u.id === selfId;
    const isMj = admins.includes(u.id);
    const label = `${_esc(u.pseudo || u.email || u.id)}${isMe ? ' (moi)' : ''}${isMj ? ' — MJ' : ''}`;
    return `<option value="${u.id}" ${isMe ? 'selected' : ''}>${label}</option>`;
  }).join('');

  openModal('➕ Nouveau personnage', `
    <div class="form-group">
      <label>Compte propriétaire</label>
      <select class="input-field" id="new-char-owner">${options}</select>
      <div style="font-size:.72rem;color:var(--text-dim);margin-top:.4rem;line-height:1.5">
        Le personnage sera rattaché à ce compte : le joueur le verra sur sa propre fiche.
      </div>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center;margin-top:1.1rem">
      <button class="btn btn-outline btn-sm" data-action="cancelNewChar">Annuler</button>
      <div style="flex:1"></div>
      <button class="btn btn-gold" data-action="confirmNewChar">Créer le personnage</button>
    </div>
  `, { subtitle: 'Rattacher la fiche à un compte joueur', accent: '#22c38e' });
}

async function confirmNewChar() {
  const uid = document.getElementById('new-char-owner')?.value || STATE.user.uid;
  const owner = (_newCharOwners || []).find(u => u.id === uid);
  const pseudo = owner?.pseudo || owner?.email
    || (uid === STATE.user.uid ? (STATE.profile?.pseudo || '?') : '?');
  closeModal();
  await _createCharForOwner(uid, pseudo);
}

/** MJ : réassigner un personnage existant à un autre compte joueur.
 *  Corrige l'association `uid` (+ `ownerPseudo`) ; le token VTT suit via la
 *  réconciliation de `ownerId` dans _syncAutoTokens. */
async function reassignCharOwner(charId) {
  if (!STATE.isAdmin) return;
  const c = (STATE.characters || []).find(x => x.id === charId);
  if (!c) return showNotif('Personnage introuvable', 'error');
  const members = await _advMembersSorted();
  _newCharOwners = members;
  const admins = STATE.adventure?.admins || [];
  const options = members.map(u => {
    const isMj = admins.includes(u.id);
    const sel  = u.id === c.uid ? 'selected' : '';
    return `<option value="${u.id}" ${sel}>${_esc(u.pseudo || u.email || u.id)}${isMj ? ' — MJ' : ''}</option>`;
  }).join('');
  openModal(`👤 Réassigner « ${_esc(c.nom || 'Personnage')} »`, `
    <div class="form-group">
      <label>Compte propriétaire</label>
      <select class="input-field" id="reassign-char-owner">${options}</select>
      <div style="font-size:.72rem;color:var(--text-dim);margin-top:.4rem;line-height:1.5">
        Le personnage sera rattaché à ce compte (fiche, présence « en ligne »).
        Son token VTT suivra automatiquement à la prochaine ouverture de la table par le MJ.
      </div>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center;margin-top:1.1rem">
      <button class="btn btn-outline btn-sm" data-action="cancelNewChar">Annuler</button>
      <div style="flex:1"></div>
      <button class="btn btn-gold" data-action="confirmReassignChar" data-id="${charId}">Réassigner</button>
    </div>`, { subtitle: 'Changer le compte propriétaire', accent: '#4f8cff' });
}

async function confirmReassignChar(charId) {
  const uid = document.getElementById('reassign-char-owner')?.value;
  if (!uid) return;
  const owner = (_newCharOwners || []).find(u => u.id === uid);
  const pseudo = owner?.pseudo || owner?.email || '?';
  closeModal();
  try {
    await updateInCol('characters', charId, { uid, ownerPseudo: pseudo });
    showNotif(`Personnage réassigné à ${pseudo}`, 'success');
    PAGES.characters();
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════
// TITRES
// ══════════════════════════════════════════════
export function manageTitres(charId) {
  const c = getCharacterById(charId);
  if (!c) return;
  _editTitres = [...(c.titres||[])];
  openModal('', `
    <div class="cs-titres-modal">
      <div class="cs-titres-head">
        <div class="cs-titres-head-ico">🏅</div>
        <div class="cs-titres-head-txt">
          <h2 class="cs-titres-title">Titres</h2>
          <p class="cs-titres-sub">Distinctions affichées sous le nom de <b>${_esc(c.nom || 'ce personnage')}</b>.</p>
        </div>
      </div>

      <div id="titres-list" class="cs-titres-list">${_titresListHtml()}</div>

      <div class="cs-titres-add">
        <input class="input-field" id="ei-titre-new" autocomplete="off"
          placeholder="Ex : Héros de la Vallée, Tueur de dragons…">
        <button class="btn btn-outline btn-sm" data-action="addTitre">＋ Ajouter</button>
      </div>

      <div class="cs-titres-footer">
        <button class="btn btn-outline btn-sm" data-action="closeTitres">Annuler</button>
        <div style="flex:1"></div>
        <button class="btn btn-gold" data-action="saveTitres" data-id="${charId}">💾 Enregistrer</button>
      </div>
    </div>
  `);
  // Entrée = ajouter (remplace l'ancien onkeydown inline, migré en JS)
  setTimeout(() => {
    _initTitresSortable();
    const inp = document.getElementById('ei-titre-new');
    inp?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTitre(); } });
    inp?.focus();
  }, 30);
}

function _titresListHtml() {
  const titres = _editTitres || [];
  if (!titres.length) {
    return `<div class="cs-titres-empty">Aucun titre pour l'instant.</div>`;
  }
  return titres.map((t,i)=>`
    <div class="cs-titre-row" data-idx="${i}">
      <span class="cs-titre-drag" title="Glisser pour réordonner">⠿</span>
      <input class="cs-titre-input" type="text" value="${_esc(t)}" placeholder="Titre…" autocomplete="off"
        data-enter="blur">
      <button class="cs-titre-del" data-action="removeTitre" title="Retirer ce titre">✕</button>
    </div>`).join('');
}

// Le DOM est la source de vérité pendant l'édition : on reconstruit _editTitres
// depuis les inputs (dans l'ordre courant, réordonnancement inclus). On ne filtre
// PAS les vides ici (positions conservées) — le nettoyage se fait à l'enregistrement.
function _syncTitresFromDom() {
  const list = document.getElementById('titres-list');
  if (!list) return;
  _editTitres = [...list.querySelectorAll('.cs-titre-input')].map(i => i.value);
}

function _initTitresSortable() {
  const list = document.getElementById('titres-list');
  if (!list) return;
  try { _titresSortable?.destroy(); } catch {}
  _titresSortable = makeSortable(list, {
    prefix: 'titre',
    handle: '.cs-titre-drag',
    onEnd: () => _syncTitresFromDom(),
  });
}

export function addTitre() {
  const input = document.getElementById('ei-titre-new');
  const val = input?.value.trim();
  if (!val) return;
  _syncTitresFromDom();            // capture les éditions des lignes existantes
  _editTitres.push(val);
  input.value='';
  _refreshTitresList();
  input.focus();
}

// Suppression par ÉLÉMENT DOM (pas par index) : après un drag, les data-idx sont
// périmés — retirer la ligne cliquée puis resynchroniser est robuste.
export function removeTitre(btn) {
  btn?.closest?.('.cs-titre-row')?.remove();
  _syncTitresFromDom();
  _refreshTitresList();
}

function _refreshTitresList() {
  const list = document.getElementById('titres-list');
  if (!list) return;
  list.innerHTML = _titresListHtml();
  _initTitresSortable();
}

export async function saveTitres(charId) {
  const c = getCharacterById(charId);
  if (!c) return;
  _syncTitresFromDom();
  c.titres = (_editTitres || []).map(t => (t || '').trim()).filter(Boolean);
  if (await trySave('characters', charId, {titres: c.titres})) {
    closeModal();
    showNotif('Titres mis à jour !','success');
  }
  _renderFormsChar(c);
}

// ══════════════════════════════════════════════
// PHOTO

registerActions({
  saveQuete:      (btn) => saveQuete(btn.dataset.idx === '' ? null : Number(btn.dataset.idx)),
  editQuete:      (btn) => editQuete(Number(btn.dataset.idx)),
  addTitre:       ()    => addTitre(),
  removeTitre:    (btn) => removeTitre(btn),
  saveTitres:     (btn) => saveTitres(btn.dataset.id),
  confirmNewChar: ()    => confirmNewChar(),
  cancelNewChar:  ()    => closeModal(),
  closeTitres:    ()    => closeModal(),
  reassignCharOwner:   (btn) => reassignCharOwner(btn.dataset.id),
  confirmReassignChar: (btn) => confirmReassignChar(btn.dataset.id),
});
