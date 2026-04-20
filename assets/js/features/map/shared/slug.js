// Slug commun aux formulaires du module Carte.
// Le préfixe fallback sert uniquement quand le nom ne produit aucun caractère valide.
export function slug(name, fallbackPrefix = 'item') {
  return String(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `${fallbackPrefix}-${Date.now()}`;
}
