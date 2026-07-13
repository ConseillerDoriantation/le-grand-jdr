// ══════════════════════════════════════════════
// GitHub — liste les fichiers d'un dossier du repo (API Contents).
// Sert aux « bibliothèques » (émotes, avatars, images VTT) : un bouton importe
// d'un coup tous les fichiers d'un dossier du repo (hébergé sur GitHub Pages),
// sans doublon.
//
// Par défaut on stocke le CHEMIN RELATIF (`images/…`) : cohérent avec les
// catalogues d'avatars/émotes. Les cartes VTT peuvent demander `urlMode: 'raw'`
// pour rester affichables en local même si le fichier n'existe pas dans le
// dossier servi par localhost. `api.github.com` est autorisé par la CSP.
// ══════════════════════════════════════════════
export const GH_DEFAULT_REPO = 'ConseillerDoriantation/le-grand-jdr';
export const GH_DEFAULT_BRANCH = 'main';
export const GH_IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

function encodePath(path) {
  return String(path || '').replace(/^\.?\//, '').replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(seg => { try { return encodeURIComponent(decodeURIComponent(seg)); } catch { return encodeURIComponent(seg); } })
    .join('/');
}

export function githubRawUrl(path, { repo = GH_DEFAULT_REPO, branch = GH_DEFAULT_BRANCH } = {}) {
  const raw = String(path || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
  const clean = encodePath(raw);
  return `https://raw.githubusercontent.com/${repo}/${branch}/${clean}`;
}

// Liste les fichiers d'un dossier du repo. `path` = chemin repo (ex: 'images/avatar').
// Retourne [{ name, path, url }] trié par nom (url === path = chemin relatif).
// Lève une erreur lisible si le dossier est introuvable / le chemin n'en est pas un.
export async function listGithubFolder(path, { repo = GH_DEFAULT_REPO, exts = null, urlMode = 'relative' } = {}) {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '');
  if (!clean) throw new Error('Chemin de dossier vide');
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${clean}`);
  if (res.status === 404) throw new Error(`Dossier introuvable : ${clean}`);
  if (!res.ok) throw new Error(`Erreur GitHub (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Ce chemin n’est pas un dossier');
  return data
    .filter(e => e.type === 'file' && (!exts || exts.test(e.name)))
    .map(e => {
      const rawUrl = e.download_url || githubRawUrl(e.path, { repo });
      return { name: e.name, path: e.path, rawUrl, url: urlMode === 'raw' ? rawUrl : e.path };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// Nom lisible depuis un nom de fichier : retire l'extension, remplace _-. par des
// espaces, trim. (Ex: 'Avatar_Corbeau.png' → 'Avatar Corbeau'.)
export function prettyNameFromFile(filename) {
  return String(filename).replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();
}

// Clé d'identité d'une image = son nom de fichier (dernier segment), sans query
// ni casse. Sert au dédoublonnage robuste : `images/avatar/X.png`,
// `./images/avatars/X.png` ou `https://site/…/X.png` donnent tous la même clé.
// (Compromis : deux images de dossiers différents mais de même nom sont vues
// comme un doublon — négligeable pour des avatars/émotes.)
export function fileKey(url) {
  const s = String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
  return (s.split('/').pop() || s).trim().toLowerCase();
}

// Slug d'émote depuis un nom de fichier : minuscules, alphanum, séparés par _.
// (Ex: 'Gros Rire!.png' → 'gros_rire'.)
export function slugFromFile(filename) {
  return String(filename).replace(/\.[^.]+$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
