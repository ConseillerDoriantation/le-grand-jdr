// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let STATE = {
  user: null,
  profile: null,
  isAdmin: false,
  currentPage: 'dashboard',
  characters: [],
  activeChar: null,
};

let DB, AUTH, FS;
