// Persistance de l'avatar de compte, factorisée hors de features/account.js pour
// être réutilisable depuis la fiche personnage (galerie de portraits) sans tirer
// tout le module Compte en import statique. Écrit users/{uid}.avatarIcon puis
// propage dans le profil dénormalisé (memberProfiles) de chaque aventure → les
// autres joueurs voient le nouvel avatar sans lire users/{uid}.

import { updateInCol } from '../data/firestore.js';
import { STATE, setProfile } from '../core/state.js';
import { refreshSidebarProfile } from '../core/layout.js';
import { showNotif } from './notifications.js';

export async function persistAccountAvatar(url = '', uid = STATE.user?.uid) {
  if (!uid) return false;
  try {
    await updateInCol('users', uid, { avatarIcon: url || '' });
    setProfile({ ...(STATE.profile || {}), avatarIcon: url || '' });
    for (const a of (STATE.adventures || [])) {
      const inAdv = a?.accessList?.includes(uid) || a?.admins?.includes(uid);
      if (!a?.id || !inAdv) continue;
      updateInCol('adventures', a.id, { [`memberProfiles.${uid}.avatarIcon`]: url || '' })
        .then(() => { if (a.memberProfiles?.[uid]) a.memberProfiles[uid].avatarIcon = url || ''; })
        .catch(() => {});
    }
    refreshSidebarProfile();
    showNotif(url ? 'Avatar mis à jour !' : 'Avatar réinitialisé.', 'success');
    return true;
  } catch (err) {
    console.error('[avatar] persist:', err);
    // Cause probable : règle isUserSelfUpdate n'autorise pas encore `avatarIcon`.
    showNotif("Impossible d'enregistrer l'avatar (règles Firestore à mettre à jour ?).", 'error');
    return false;
  }
}
