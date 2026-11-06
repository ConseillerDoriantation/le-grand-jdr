import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoldAccount,
  classifyLedgerEntry,
  endOfDayBalances,
  filterLedger,
  flattenLedger,
  ledgerRawBalance,
  parseLedgerDate,
  validateLedgerDelete,
  validateLedgerEdit,
} from '../assets/js/shared/ledger-logic.js';

test('parseLedgerDate accepte les formats historiques et refuse le texte libre', () => {
  assert.deepEqual(parseLedgerDate('2026-10-31'), { y: 2026, mo: 10, d: 31 });
  assert.deepEqual(parseLedgerDate('31/10/2026'), { y: 2026, mo: 10, d: 31 });
  assert.deepEqual(parseLedgerDate('31/10/26'), { y: 2026, mo: 10, d: 31 });
  assert.equal(parseLedgerDate('fin de séance'), null);
  assert.equal(parseLedgerDate('31/02/2026'), null);
});

test('classifyLedgerEntry couvre les sources automatiques et manuelles', () => {
  const cases = [
    ['Achat : Épée', 1, 'shop', 'Épée', 'Boutique · achat'],
    ['Vente : Potion', 1, 'shop', 'Potion', 'Boutique · vente'],
    ['Reprise : Bouclier', 1, 'shop', 'Bouclier', 'Boutique · reprise'],
    ['Artisan : ajout du trait Givre sur Lame', -1, 'artisan', 'Trait « Givre » sur Lame', 'Artisan · trait posé'],
    ['Artisan : écrasement Feu → Givre sur Lame', -1, 'artisan', '« Feu » → « Givre » sur Lame', 'Artisan · trait remplacé'],
    ['Artisan : reforge Lame → Rare', -1, 'artisan', 'Lame → Rare', 'Artisan · reforge'],
    ['Artisan : destruction de Lame', -1, 'artisan', 'Lame', 'Artisan · démontage'],
    ['Artisan : arme Lame +1 DEX', -1, 'artisan', '+1 DEX sur Lame', 'Artisan · stats'],
    ['Artisan : anneau Rubis stat FOR +2', -1, 'artisan', 'FOR +2 sur Rubis', 'Artisan · anneau'],
    ['Artisan : anneau Rubis effet +3', -1, 'artisan', 'Effet +3 sur Rubis', 'Artisan · anneau'],
    ['Investissement Bastion : Forge', -1, 'bastion', 'Forge', 'Bastion · investissement'],
    ['Remboursement : forge', 1, 'bastion', 'Forge', 'Bastion · remboursement'],
    ['Butin (VTT)', 1, 'loot', 'Butin récupéré', 'Butin · table virtuelle'],
    ['Butin partagé', 1, 'loot', 'Butin partagé', 'Butin · table virtuelle'],
    ['Butin réparti', 1, 'loot', 'Butin réparti', 'Butin · table virtuelle'],
    ['Sort : Identification', -1, 'spell', 'Identification', 'Sort · coût en or'],
    ['Or envoyé à Lyriel — Part du butin', -1, 'transfer', 'Envoyé à Lyriel', 'Échange · Part du butin'],
    ['Don → Lyriel', -1, 'transfer', 'Don à Lyriel', 'Échange'],
    ["Or reçu de Aelyra", 1, 'transfer', "Reçu d'Aelyra", 'Échange'],
    ['Don ← Branton', 1, 'transfer', 'Don de Branton', 'Échange'],
    ['↻ Rollback transfert échoué', 1, 'transfer', 'Rollback transfert échoué', 'Échange · correction'],
    ['Annulation du don', 1, 'transfer', 'Annulation du don', 'Échange · correction'],
    ['Solde initial', 1, 'start', 'Solde initial', 'Départ'],
    ['Auberge', -1, 'manual', 'Auberge', 'Retrait manuel'],
  ];
  for (const [label, sign, src, title, sub] of cases) {
    assert.deepEqual(classifyLedgerEntry(label, sign), { src, title, sub }, label);
  }
});

test('flattenLedger trie par date, ts, index et place les dates libres en dernier', () => {
  const compte = {
    recettes: [
      { date: '2026-10-31', libelle: 'A', montant: 1, ts: 1 },
      { date: '2026-10-31', libelle: 'B', montant: 2, ts: 4 },
      { date: 'sans date', libelle: 'C', montant: 3, ts: 99 },
    ],
    depenses: [{ date: '01/11/2026', libelle: 'D', montant: 4, ts: 2 }],
  };
  assert.deepEqual(flattenLedger(compte).map(entry => entry.row.libelle), ['D', 'B', 'A', 'C']);
});

test('endOfDayBalances calcule le cumul chronologique indépendamment du tri affiché', () => {
  const entries = flattenLedger({
    recettes: [{ date: '01/01/2026', libelle: 'Départ', montant: 100 }, { date: '03/01/2026', libelle: 'Gain', montant: 20 }],
    depenses: [{ date: '02/01/2026', libelle: 'Dépense', montant: 30 }],
  });
  const balances = endOfDayBalances(entries);
  assert.equal(balances.get(20260101), 100);
  assert.equal(balances.get(20260102), 70);
  assert.equal(balances.get(20260103), 90);
});

test('filterLedger filtre le sens, la source et la recherche sans accents', () => {
  const entries = flattenLedger({
    recettes: [{ date: '31/10/2026', libelle: 'Vente : Épée runique', montant: 1_000 }],
    depenses: [{ date: '01/11/2026', libelle: 'Auberge', montant: 12 }],
  });
  assert.deepEqual(filterLedger(entries, { kind: 'in' }).map(entry => entry.src), ['shop']);
  assert.deepEqual(filterLedger(entries, { src: 'manual' }).map(entry => entry.row.libelle), ['Auberge']);
  assert.equal(filterLedger(entries, { q: 'epee runique' }).length, 1);
  assert.equal(filterLedger(entries, { q: '1000' }).length, 1);
  assert.equal(filterLedger(entries, { q: 'octobre' }).length, 1);
});

test('les validations bloquent les corrections invalides ou un solde négatif', () => {
  const compte = { recettes: [{ date: '2026-01-01', libelle: 'Départ', montant: 50 }], depenses: [{ date: '2026-01-02', libelle: 'Achat', montant: 20 }] };
  assert.equal(ledgerRawBalance(compte), 30);
  assert.equal(validateLedgerEdit(compte, 'recettes', 0, { sign: 1, montant: 0, libelle: 'Départ' }).ok, false);
  assert.equal(validateLedgerEdit(compte, 'recettes', 0, { sign: 1, montant: 50, libelle: '' }).ok, false);
  assert.match(validateLedgerEdit(compte, 'recettes', 0, { sign: -1, montant: 50, libelle: 'Dette' }).msg, /−70 or/);
  assert.match(validateLedgerDelete(compte, 'recettes', 0).msg, /−20 or/);
  assert.equal(validateLedgerEdit(compte, 'depenses', 0, { sign: 1, montant: 20, libelle: 'Remboursement' }).newBalance, 70);
});

test('buildGoldAccount migre c.or et horodate toutes les nouvelles lignes', () => {
  const compte = buildGoldAccount({ or: 500 }, [{ delta: -10, reason: 'Auberge', date: '2026-11-06' }], { now: 1234, date: '06/11/2026' });
  assert.deepEqual(compte.recettes[0], { date: '06/11/2026', libelle: 'Solde initial', montant: 500, ts: 1233 });
  assert.deepEqual(compte.depenses[0], { date: '2026-11-06', libelle: 'Auberge', montant: 10, ts: 1234 });
  assert.equal(ledgerRawBalance(compte), 490);
});
