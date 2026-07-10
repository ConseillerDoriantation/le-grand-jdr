// ══════════════════════════════════════════════════════════════════════════════
// SHARED / AVATAR.JS
// Avatar par défaut (silhouette) affiché tant que le joueur n'a pas choisi d'icône.
// SVG inline en data URI → aucun hébergement requis, rendu identique partout.
// ══════════════════════════════════════════════════════════════════════════════
export const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#9d6fff"/>
    </linearGradient></defs>
    <rect width="64" height="64" fill="url(#g)"/>
    <circle cx="32" cy="25" r="12" fill="rgba(255,255,255,.92)"/>
    <path d="M12 57c0-11 9-19 20-19s20 8 20 19z" fill="rgba(255,255,255,.92)"/>
  </svg>`
);

/** Source d'image de l'avatar d'un profil : icône choisie sinon image de base. */
export const avatarSrcOf = (profile) => profile?.avatarIcon || DEFAULT_AVATAR;
