import { GH_DEFAULT_REPO, githubPagesUrl } from '../../shared/github-folder.js';
import { normalizeImageUrl } from '../../shared/html.js';
import { CLOUDINARY_ENABLED, isCloudinaryUrl } from '../../shared/media-hosting.js';

function cleanPath(value) {
  let path = String(value || '').split(/[?#]/)[0].replace(/\\/g, '/');
  try { path = decodeURIComponent(path); } catch { /* garde le chemin original */ }
  return path.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '').normalize('NFC').toLowerCase();
}

/**
 * Identité stable d'un asset GitHub, quel que soit son format d'URL : chemin
 * relatif, Raw, blob ou GitHub Pages. Le chemin complet est conservé afin que
 * deux dossiers puissent contenir des fichiers portant le même nom.
 */
export function githubAssetIdentity(value, defaultRepo = GH_DEFAULT_REPO) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:data|blob):/i.test(raw)) return null;

  const rawMatch = raw.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/i);
  const githubMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree|raw)\/[^/]+\/(.+)$/i);
  const pagesMatch = raw.match(/^https?:\/\/([^.\/]+)\.github\.io\/([^/]+)\/(.+)$/i);
  const match = rawMatch || githubMatch || pagesMatch;
  if (match) {
    const [, owner, repo, path] = match;
    return `github:${owner.toLowerCase()}/${repo.toLowerCase()}/${cleanPath(path)}`;
  }

  if (!/^https?:\/\//i.test(raw)) {
    return `github:${String(defaultRepo || '').toLowerCase()}/${cleanPath(raw)}`;
  }
  return null;
}

/**
 * Résout une carte sans jamais interroger Cloudinary lorsque l'hébergement est
 * désactivé. Un sourcePath GitHub reste prioritaire sur une ancienne URL CDN.
 */
export function resolveMapImageUrl(imageOrUrl, sourcePath = '') {
  const image = imageOrUrl && typeof imageOrUrl === 'object' ? imageOrUrl : null;
  const url = String(image?.url ?? imageOrUrl ?? '').trim();
  const source = String(image?.sourcePath ?? sourcePath ?? '').trim();
  const raw = source || url;
  if (!raw) return '';
  if (/^\.?\/?images\/maps\//i.test(raw) || githubAssetIdentity(raw)) return githubPagesUrl(raw);
  const resolved = normalizeImageUrl(url || raw);
  return !CLOUDINARY_ENABLED && isCloudinaryUrl(resolved) ? '' : resolved;
}

export function mapLibraryImageKey(image = {}) {
  const sourceKey = githubAssetIdentity(image.sourcePath);
  if (sourceKey) return sourceKey;

  const githubKey = githubAssetIdentity(image.url);
  if (githubKey) return githubKey;

  const rawUrl = String(image.url || '').trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      return `url:${url.origin.toLowerCase()}/${cleanPath(url.pathname)}`;
    } catch {
      return `url:${cleanPath(rawUrl)}`;
    }
  }
  return image.id ? `id:${String(image.id)}` : null;
}

/** Garde la première occurrence (donc son dossier et son id) et l'enrichit. */
export function dedupeMapLibraryImages(images) {
  const unique = [];
  const indexes = new Map();
  let removed = 0;

  for (const image of Array.isArray(images) ? images : []) {
    if (!image || typeof image !== 'object') continue;
    const key = mapLibraryImageKey(image) || `row:${unique.length}`;
    const existingIndex = indexes.get(key);
    if (existingIndex == null) {
      indexes.set(key, unique.length);
      unique.push({ ...image });
      continue;
    }

    const first = unique[existingIndex];
    unique[existingIndex] = {
      ...image,
      ...first,
      url: first.url || image.url || '',
      name: first.name || image.name || '',
      sourcePath: first.sourcePath || image.sourcePath || null,
      folderId: Object.prototype.hasOwnProperty.call(first, 'folderId') ? first.folderId : (image.folderId || null),
    };
    removed += 1;
  }

  return { images: unique, removed };
}
