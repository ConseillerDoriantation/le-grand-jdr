// ══════════════════════════════════════════════════════════════════════════════
// BUMP ASSETS — incrémente la version de cache-busting des CSS, PARTOUT d'un coup.
//
//   node tools/bump-assets.mjs            → version du jour (AAAAMMJJ, suffixe b/c… si déjà prise)
//   node tools/bump-assets.mjs 20260801   → version explicite
//
// Met à jour (source de vérité = assets/js/core/version.js) :
//   1. ASSET_VERSION dans assets/js/core/version.js  (liens lazy de navigation.js + quill)
//   2. tous les `?v=` des <link rel="stylesheet"> d'index.html (liens eager)
// Ne touche JAMAIS aux imports JS : un module ne doit exister que sous UNE URL
// (deux URLs = deux instances chargées — bug réel eu avec vtt-inspector.js).
// Outil dev uniquement (comme les tests) — jamais chargé par le navigateur.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = join(root, 'assets/js/core/version.js');
const INDEX_FILE = join(root, 'index.html');

const versionSrc = readFileSync(VERSION_FILE, 'utf8');
const current = versionSrc.match(/ASSET_VERSION = '([^']+)'/)?.[1];
if (!current) { console.error('ASSET_VERSION introuvable dans core/version.js'); process.exit(1); }

// Version cible : argument explicite, sinon date du jour (suffixe si déjà utilisée).
let next = process.argv[2];
if (!next) {
  const d = new Date();
  const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  next = today;
  if (current === next) next = `${today}b`;
  else if (current.startsWith(today)) {
    const sfx = current.slice(today.length) || 'a';
    next = today + String.fromCharCode(sfx.charCodeAt(0) + 1);
  }
}
if (next === current) { console.log(`Déjà en ${current} — rien à faire.`); process.exit(0); }

writeFileSync(VERSION_FILE, versionSrc.replace(/ASSET_VERSION = '[^']+'/, `ASSET_VERSION = '${next}'`));

const indexSrc = readFileSync(INDEX_FILE, 'utf8');
let count = 0;
const updated = indexSrc.replace(
  /(href="\.\/assets\/css\/[\w-]+\.css)(\?v=[^"]*)?"/g,
  (_m, base) => { count++; return `${base}?v=${next}"`; },
);
writeFileSync(INDEX_FILE, updated);

console.log(`ASSET_VERSION : ${current} → ${next}`);
console.log(`index.html    : ${count} lien(s) CSS mis à jour.`);
