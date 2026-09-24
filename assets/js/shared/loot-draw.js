// ══════════════════════════════════════════════════════════════════════════════
// loot-draw.js — Tirage de butin de créature (logique pure, sans DOM ni Firestore)
// ──────────────────────────────────────────────────────────────────────────────
// Réutilisé par le bestiaire (tirage d'essai) et le VTT (panier « Créatures de la
// scène »). Sépare la logique de jet du rendu pour éviter la duplication.
// ══════════════════════════════════════════════════════════════════════════════

// Résout une formule de quantité/or : nombre brut ("3"), fourchette ("1-3"),
// ou dés ("2d4", "1d6+2"). Retourne un entier ≥ 0.
export function rollLootFormula(str) {
  const s = String(str ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const range = s.match(/^(\d+)-(\d+)$/);
  if (range) {
    const lo = Math.min(+range[1], +range[2]);
    const hi = Math.max(+range[1], +range[2]);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  const dice = s.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (dice) {
    const n = Math.min(100, parseInt(dice[1] || '1', 10) || 1);
    const f = Math.max(1, parseInt(dice[2], 10) || 1);
    const bonus = dice[3] ? parseInt(dice[3], 10) : 0;
    let total = 0;
    for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * f);
    return Math.max(0, total + bonus);
  }
  const first = s.match(/\d+/);
  return first ? parseInt(first[0], 10) : 0;
}

// Le drop tombe-t-il ? `chance` = "100%", "50%", "50"… (défaut : sûr).
export function lootChanceHits(chance) {
  const c = String(chance ?? '100%').trim();
  const p = c === '100%' ? 100 : (parseInt(c, 10) || 0);
  return Math.random() * 100 < p;
}

// Tire le butin d'une créature.
//   creature : { butins:[{itemId,nom,chance,quantite}], or }
//   opts.draw  : true = applique chance + quantité aléatoire (tirage réel) ;
//                false = prend tout, quantité = borne basse × count, sans chance.
//   opts.count : nombre d'exemplaires (tokens groupés). L'or est jeté une fois.
// Retourne { items:[{itemId,nom,qty}], gold }.
export function drawCreatureLoot(creature, { draw = true, count = 1 } = {}) {
  const items = [];
  const push = (itemId, nom, qty) => {
    if (!itemId || qty <= 0) return;
    const ex = items.find(x => x.itemId === itemId);
    if (ex) ex.qty += qty; else items.push({ itemId, nom: nom || 'Objet', qty });
  };
  const butins = Array.isArray(creature?.butins) ? creature.butins : [];
  if (draw) {
    for (let k = 0; k < count; k++) {
      butins.forEach(b => {
        if (!b?.itemId || !lootChanceHits(b.chance)) return;
        push(b.itemId, b.nom, Math.max(1, rollLootFormula(b.quantite)));
      });
    }
  } else {
    butins.forEach(b => {
      if (!b?.itemId) return;
      push(b.itemId, b.nom, (Math.max(1, parseInt(b.quantite, 10) || 1)) * count);
    });
  }
  const gold = creature?.or ? rollLootFormula(creature.or) : 0;
  return { items, gold };
}
