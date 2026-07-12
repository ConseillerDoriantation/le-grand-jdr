// ══════════════════════════════════════════════
// GitHub — liste les fichiers d'un dossier du repo (API Contents).
// Sert aux « bibliothèques » (émotes, avatars, images VTT) : un bouton importe
// d'un coup tous les fichiers d'un dossier du repo (hébergé sur GitHub Pages),
// sans doublon.
//
// On stocke le CHEMIN RELATIF (`images/…`), pas l'URL raw : même origine que le
// site Pages → compatible CSP `img-src 'self'`, pas de souci CORS canvas (VTT),
// et cohérent avec le catalogue d'avatars (qui stocke déjà des chemins relatifs,
// résolus par `resolveAvatarUrl`). `api.github.com` est autorisé par la CSP.
// ══════════════════════════════════════════════
export const GH_DEFAULT_REPO = 'ConseillerDoriantation/le-grand-jdr';
export const GH_IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

// Liste les fichiers d'un dossier du repo. `path` = chemin repo (ex: 'images/avatar').
// Retourne [{ name, path, url }] trié par nom (url === path = chemin relatif).
// Lève une erreur lisible si le dossier est introuvable / le chemin n'en est pas un.
export async function listGithubFolder(path, { repo = GH_DEFAULT_REPO, exts = null } = {}) {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '');
  if (!clean) throw new Error('Chemin de dossier vide');
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${clean}`);
  if (res.status === 404) throw new Error(`Dossier introuvable : ${clean}`);
  if (!res.ok) throw new Error(`Erreur GitHub (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Ce chemin n’est pas un dossier');
  return data
    .filter(e => e.type === 'file' && (!exts || exts.test(e.name)))
    .map(e => ({ name: e.name, path: e.path, url: e.path }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// Nom lisible depuis un nom de fichier : retire l'extension, remplace _-. par des
// espaces, trim. (Ex: 'Avatar_Corbeau.png' → 'Avatar Corbeau'.)
export function prettyNameFromFile(filename) {
  return String(filename).replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();
}

// Slug d'émote depuis un nom de fichier : minuscules, alphanum, séparés par _.
// (Ex: 'Gros Rire!.png' → 'gros_rire'.)
export function slugFromFile(filename) {
  return String(filename).replace(/\.[^.]+$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
