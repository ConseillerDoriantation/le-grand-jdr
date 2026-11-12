import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const artisan = readFileSync(new URL('assets/js/features/artisan.js', root), 'utf8');
const upg = readFileSync(new URL('assets/js/shared/upgrade-settings.js', root), 'utf8');

test('sac de fragments : agnostique au nom de slot (clés réelles, pas la liste figée)', () => {
  // Le bag itère sur les catégories RÉELLEMENT présentes dans c.traitFragments…
  assert.match(artisan, /const fragmentEntries = Object\.entries\(bag\)\.flatMap/);
  // …et une catégorie inconnue (slot par défaut/perso) garde son nom + glyphe générique.
  assert.match(artisan, /const _catMeta = id => FRAGMENT_CAT_BY_ID\[id\] \|\| \{ id, label: id, icon: '◆' \}/);
  // La détection d'armure/arme passe par les classificateurs canoniques (item-facts).
  assert.match(artisan, /import \{ isArmorItem, isJewelItem \} from '\.\.\/shared\/item-facts\.js'/);
  assert.match(artisan, /return isArmorItem\(item\) && !item\.slotBijou/);
  // Tout accessoire non-anneau = moteur amulette (stats distinctes).
  assert.match(artisan, /if \(isJewelItem\(item\)\)  return _renderAmuletStats/);
});

test('armure : cap par stat (anti-dump) côté config + enforcement', () => {
  assert.match(upg, /armorStatMax: 3/);                       // défaut
  assert.match(upg, /'caps\.armorStatMax'/);                   // admin éditable (champ passé à capRow)
  // Blocage à l'ajout + désactivation du choix dans le rendu.
  assert.match(artisan, /const perStatMax = Math\.max\(1, parseInt\(s\.caps\?\.armorStatMax\) \|\| 3\)/);
  assert.match(artisan, /if \(curStat >= perStatMax\)/);       // handler bloque
  assert.match(artisan, /getItemUpgradeStatBonus\(item, meta\.full\) >= perStatMax/); // choix désactivé
});

test('retirer un point : ne touche que les points placés, sans rembourser l’or', () => {
  // Liste des points AJOUTÉS (upgrades.statBonus) — jamais les natives/de base.
  assert.match(artisan, /function _renderRemovableStats\(item, invIndex\)/);
  assert.match(artisan, /const added = _getUpgradedStatEntries\(item\)/);
  // Handler : lit le bonus d'upgrade, décrémente statBonus.
  assert.match(artisan, /async function _artisanRemoveStatPoint\(invIndex, statFullKey\)/);
  assert.match(artisan, /getItemUpgradeStatBonus\(item, meta\.full\) <= 0/);
  assert.match(artisan, /if \(v > 0\) sb\[meta\.store\] = v; else delete sb\[meta\.store\]/);
  // L'or dépensé n'est PAS rendu lors d'un retrait (pas de _refundGold dans ce handler).
  assert.doesNotMatch(artisan, /async function _artisanRemoveStatPoint[\s\S]*?_refundGold\(/);
  assert.match(artisan, /_artisanRemoveStatPoint: \(btn\) =>/); // action enregistrée
  // Présent dans les 4 sections de stats (arme/armure/anneau/amulette) + la définition.
  const count = (artisan.match(/_renderRemovableStats\(item, invIndex\)/g) || []).length;
  assert.ok(count >= 5, `attendu ≥5 occurrences (def + 4 sections), vu ${count}`);
});
