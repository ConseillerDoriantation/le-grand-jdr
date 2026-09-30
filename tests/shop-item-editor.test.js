import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  damageProfileToRelations,
  parseShopItemQuickEntry,
  relationsToDamageProfile,
} from '../assets/js/shared/shop-item-editor.js';

const context = {
  rarities: [{ value: 3, name: 'Rare' }, { value: 5, name: 'Légendaire' }],
  weaponFormats: [{ label: 'Épée longue', defaults: { degats: '1d8' } }],
  damageTypes: [{ id: 'feu', label: 'Feu' }, { id: 'froid', label: 'Froid' }],
  template: 'arme',
};

test('la saisie rapide reconnaît les champs principaux d’un article', () => {
  const parsed = parseShopItemQuickEntry('Lame solaire, épée longue, 2d6 + FOR, rare, DEX +2, CA +1, résistance feu, 420 or, stock 2, magique', context);
  assert.equal(parsed.some(entry => entry.bad), false);
  assert.deepEqual(parsed[0].patch, { nom: 'Lame solaire' });
  assert.equal(parsed.find(entry => entry.weapon)?.patch.template, 'arme');
  assert.deepEqual(parsed.find(entry => entry.patch?.degats)?.patch.degatsStats, ['force']);
  assert.equal(parsed.find(entry => entry.patch?.dexteriteBonus)?.patch.dexteriteBonus, 2);
  assert.equal(parsed.find(entry => entry.damage)?.damage.relation, 'resistances');
  assert.equal(parsed.find(entry => entry.patch?.prix)?.patch.prix, 420);
  assert.equal(parsed.find(entry => entry.patch?.dispo)?.patch.dispo, 2);
});

test('le profil de dégâts conserve une relation unique par type', () => {
  const relations = damageProfileToRelations({ resistances: ['feu'], immunites: ['froid'] });
  relations.feu = 'absorptions';
  assert.deepEqual(relationsToDamageProfile(relations), {
    resistances: [], immunites: ['froid'], absorptions: ['feu'], faiblesses: [],
  });
});

test('l’éditeur remplace les onglets par une page structurée et un aperçu live', () => {
  const shop = fs.readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../assets/css/shop.css', import.meta.url), 'utf8');
  assert.match(shop, /const _SI_SECTIONS =/);
  assert.match(shop, /class="si-quick"/);
  assert.match(shop, /id="si-editor-preview"/);
  assert.match(shop, /data-sh-action="saveItemNew"/);
  assert.match(shop, /current === clicked \? 0 : clicked/);
  assert.match(shop, /function _siWeaponCombatHtml/);
  assert.match(shop, /function _siBonusHtml/);
  assert.match(shop, /const _SHOP_EDITOR_RELATION_COLORS/);
  assert.match(shop, /id="si-trait-new"/);
  assert.match(shop, /class="si-action-new"/);
  assert.match(shop, /class="si-action-edit"[^>]*>[\s\S]*?<svg/);
  assert.match(shop, /class="si-action-remove"[^>]*aria-label="Supprimer l’action"/);
  assert.match(shop, /title="Ctrl\+Maj\+Entrée">Enregistrer &amp; nouveau/);
  assert.match(shop, /label: 'Vente & visibilité'/);
  assert.match(shop, /label: 'Texte à lire'/);
  assert.match(shop, /lastFiniteStock/);
  assert.match(shop, /damageProfileToRelations\(item\?\.damageProfile/);
  assert.match(shop, /Object\.entries\(item\?\.skillBonuses/);
  assert.match(shop, /class="si-preview-rarity"/);
  assert.match(shop, /class="si-preview-meta"/);
  assert.match(shop, /class="si-preview-badge is-new"/);
  assert.match(shop, /id="si-editor-subtitle"/);
  assert.match(shop, /Saisie rapide ou champ par champ — tout est sur une seule page/);
  assert.match(shop, /aria-labelledby', 'si-editor-title'/);
  assert.match(shop, /<kbd>1–\$\{sections\.length\}<\/kbd> Aller à une section/);
  assert.match(shop, /<kbd>Alt<\/kbd><i>\+<\/i><kbd>Q<\/kbd> Saisie rapide/);
  assert.match(shop, /<kbd>Ctrl<\/kbd><i>\+<\/i><kbd>↵<\/kbd> Enregistrer/);
  assert.match(shop, /event\.altKey && !event\.ctrlKey && !event\.metaKey && event\.key\.toLowerCase\(\) === 'q'/);
  assert.doesNotMatch(shop, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.doesNotMatch(shop, /input\.value='5'/);
  assert.doesNotMatch(shop, /const _SI_TABS =/);
  assert.match(css, /\.si-editor-grid\s*\{[^}]*grid-template-columns:\s*196px minmax\(0, 1fr\) 300px/s);
  assert.match(css, /\.si-flag\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.si-section-summary\[hidden\], \.si-section-state\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.si-editor \.si-section-head > \.si-section-add\s*\{[^}]*width:\s*84px !important[^}]*height:\s*28px !important[^}]*margin:\s*0 0 0 auto !important/s);
  assert.match(css, /\.si-editor-footer button\.primary\s*\{[^}]*background:\s*var\(--gold/s);
  assert.match(css, /\.si-dmgprof-type \.sh-dmgprof-chips\s*\{[^}]*grid-template-columns:\s*repeat\(4, 1fr\)/s);
  assert.match(css, /\.si-dmgprof-type:has\(\.sh-dmgprof-chip\.is-on\)\s*\{[^}]*border-color:\s*var\(--row-rel\)/s);
  assert.match(css, /\.si-preview-body\s*\{[^}]*display:\s*flex[^}]*gap:\s*6px/s);
  assert.match(css, /\.si-preview-chips span\s*\{[^}]*color-mix\(in srgb, var\(--si-chip\) 13%, transparent\)/s);
  assert.match(css, /\.si-preview-badge\.is-new\s*\{[^}]*background:\s*var\(--si-green\)/s);
  assert.match(css, /\.si-preview-img\s*\{[^}]*height:\s*88px/s);
  assert.match(css, /\.si-editor-library > button\s*\{[^}]*height:\s*28px/s);
  assert.match(css, /\.si-action-card\s*\{[^}]*background:\s*var\(--surface-sunken/s);
  assert.match(css, /\.si-action-edit\s*\{[^}]*border-radius:\s*999px/s);
  assert.match(css, /\.si-action-edit\s*\{[^}]*height:\s*28px[^}]*font-size:\s*12px !important/s);
  assert.match(css, /\.si-action-new\s*\{[^}]*height:\s*38px[^}]*font-size:\s*12\.5px !important/s);
  assert.match(css, /\.si-consumable-toggle\s*\{[^}]*height:\s*34px[^}]*font-size:\s*12\.5px !important/s);
  assert.match(css, /@media \(max-width: 1120px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
});
