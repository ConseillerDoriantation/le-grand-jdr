// Politique d'hébergement des médias, sans dépendance DOM.
// Importable par les helpers purs et les tests Node.
export const CLOUDINARY_ENABLED = false;

export function isCloudinaryUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'cloudinary.com' || host.endsWith('.cloudinary.com');
  } catch {
    return /(?:^|\.)cloudinary\.com(?:\/|$)/i.test(raw);
  }
}
