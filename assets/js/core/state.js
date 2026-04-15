// ══════════════════════════════════════════════
// STATE — Source unique de vérité
// Tous les modules importent depuis ici.
// Aucune variable d'état sur window.*
// ══════════════════════════════════════════════

// ── Instances Firebase (injectées au boot) ─────
export let DB   = null;
export let AUTH = null;
export let FS   = null;   // namespace des helpers Firestore

export function setFirebase(auth, db, fsHelpers) {
  AUTH = auth;
  DB   = db;
  FS   = fsHelpers;
}

// ── État applicatif ────────────────────────────
export const STATE = {
  user:        null,
  profile:     null,
  isAdmin:     false,      // vrai si admin de l'aventure courante OU admin global
  isSuperAdmin:false,      // vrai si profile.isAdmin === true (peut créer des aventures)
  currentPage: 'dashboard',
  characters:  [],
  activeChar:  null,
  // ── Aventures ───────────────────────────────
  adventures:     [],      // liste des aventures accessibles
  adventure:      null,    // aventure courante { id, nom, emoji, admins, players, ... }
  // Fiche de personnage — anciennement sur window.*
  currentCharTab:  'carac',
  currentChar:     null,
  canEditChar:     false,
  // Modale crop photo
  cropperState:    null,
  // Informations
  infoSection:     null,
  infoSections:    [],
  // Édition inline
  editTitres:      [],
};

// ── Mutateurs typés ────────────────────────────
export function setUser(user)         { STATE.user         = user; }
export function setProfile(p)         { STATE.profile      = p;    }
export function setAdmin(v)           { STATE.isAdmin      = v;    }
export function setSuperAdmin(v)      { STATE.isSuperAdmin = v;    }
export function setPage(p)            { STATE.currentPage  = p;    }
export function setCharacters(arr)    { STATE.characters   = arr;  }
export function setActiveChar(c)      { STATE.activeChar   = c;    }
export function setAdventures(arr)    { STATE.adventures   = arr;  }
export function setAdventure(adv)     { STATE.adventure    = adv;  }

export function setCharSheetState({ tab, char, canEdit } = {}) {
  if (tab     !== undefined) STATE.currentCharTab = tab;
  if (char    !== undefined) STATE.currentChar    = char;
  if (canEdit !== undefined) STATE.canEditChar    = canEdit;
}
