// Logique pure du livre de compte des personnages.
// Aucun accès DOM / Firestore : ce module peut être testé directement sous Node.

const SOURCE_LABELS = {
  shop: 'Boutique',
  artisan: 'Artisan',
  bastion: 'Bastion',
  loot: 'Butin',
  transfer: 'Échanges',
  spell: 'Sorts',
  manual: 'Manuel',
  start: 'Départ',
};

const _round = value => Math.round((Number(value) || 0) * 100) / 100;
const _amount = value => Math.abs(Number.parseFloat(value) || 0);
const _normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, '')
  .toLowerCase();
const _capitalize = value => value ? value[0].toUpperCase() + value.slice(1) : value;
const _de = name => /^[aeiouyhàâäéèêëîïôöûü]/i.test(name) ? `d'${name}` : `de ${name}`;

export function parseLedgerDate(value) {
  const text = String(value || '').trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  let parts = match ? { y: +match[1], mo: +match[2], d: +match[3] } : null;
  if (!parts) {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    parts = match ? { y: +match[3], mo: +match[2], d: +match[1] } : null;
  }
  if (!parts) {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(text);
    parts = match ? { y: 2000 + (+match[3]), mo: +match[2], d: +match[1] } : null;
  }
  if (!parts) return null;
  const date = new Date(parts.y, parts.mo - 1, parts.d);
  return date.getFullYear() === parts.y && date.getMonth() === parts.mo - 1 && date.getDate() === parts.d
    ? parts
    : null;
}

export function ledgerDateKey(value) {
  const parts = parseLedgerDate(value);
  return parts ? parts.y * 10000 + parts.mo * 100 + parts.d : 0;
}

function _artisanLabel(value) {
  let match;
  if ((match = /^ajout du trait (.+?) sur (.+)$/i.exec(value))) {
    return { title: `Trait « ${match[1]} » sur ${match[2]}`, sub: 'Artisan · trait posé' };
  }
  if ((match = /^écrasement (.+?) → (.+?) sur (.+)$/i.exec(value))) {
    return { title: `« ${match[1]} » → « ${match[2]} » sur ${match[3]}`, sub: 'Artisan · trait remplacé' };
  }
  if ((match = /^reforge (.+?) → (.+)$/i.exec(value))) {
    return { title: `${match[1]} → ${match[2]}`, sub: 'Artisan · reforge' };
  }
  if ((match = /^destruction de (.+)$/i.exec(value))) {
    return { title: match[1], sub: 'Artisan · démontage' };
  }
  if ((match = /^(?:arme|amulette) (.+?) \+1 (\S+)$/i.exec(value))) {
    return { title: `+1 ${match[2]} sur ${match[1]}`, sub: 'Artisan · stats' };
  }
  if ((match = /^anneau (.+?) stat (\S+) \+(\d+)$/i.exec(value))) {
    return { title: `${match[2]} +${match[3]} sur ${match[1]}`, sub: 'Artisan · anneau' };
  }
  if ((match = /^anneau (.+?) effet \+(\d+)$/i.exec(value))) {
    return { title: `Effet +${match[2]} sur ${match[1]}`, sub: 'Artisan · anneau' };
  }
  return { title: _capitalize(value), sub: 'Artisan' };
}

export function classifyLedgerEntry(libelle, sign = 1) {
  const text = String(libelle || '').trim();
  const splitReason = value => {
    const index = value.indexOf(' — ');
    return index > 0 ? [value.slice(0, index), value.slice(index + 3)] : [value, ''];
  };
  let match;
  if ((match = /^achat\s*:\s*(.+)$/i.exec(text))) return { src: 'shop', title: match[1], sub: 'Boutique · achat' };
  if ((match = /^vente(?:\s*×\d+)?\s*:\s*(.+)$/i.exec(text))) return { src: 'shop', title: match[1], sub: 'Boutique · vente' };
  if ((match = /^reprise\b\s*:?\s*(.*)$/i.exec(text))) return { src: 'shop', title: match[1] || 'Reprise', sub: 'Boutique · reprise' };
  if ((match = /^boutique\s*·\s*(.+)$/i.exec(text))) return { src: 'shop', title: _capitalize(match[1]), sub: 'Boutique · achat' };
  if ((match = /^artisan\s*:\s*(.+)$/i.exec(text))) return { src: 'artisan', ..._artisanLabel(match[1]) };
  if ((match = /^investissement bastion\s*:\s*(.+)$/i.exec(text))) return { src: 'bastion', title: match[1], sub: 'Bastion · investissement' };
  if ((match = /^remboursement\s*:\s*(.+)$/i.exec(text))) return { src: 'bastion', title: _capitalize(match[1]), sub: 'Bastion · remboursement' };
  if ((match = /^butin\s*(partagé|réparti)?\s*(\(vtt\))?/i.exec(text))) {
    return {
      src: 'loot',
      title: match[1] ? `Butin ${match[1].toLowerCase()}` : 'Butin récupéré',
      sub: match[1] || match[2] ? 'Butin · table virtuelle' : 'Butin',
    };
  }
  if ((match = /^sort\s*:\s*(.+)$/i.exec(text))) return { src: 'spell', title: match[1], sub: 'Sort · coût en or' };
  if ((match = /^(or envoyé à|don →)\s*(.+)$/i.exec(text))) {
    const [name, reason] = splitReason(match[2]);
    return { src: 'transfer', title: `${/^don/i.test(match[1]) ? 'Don à ' : 'Envoyé à '}${name}`, sub: `Échange${reason ? ` · ${reason}` : ''}` };
  }
  if ((match = /^(or reçu de|don ←)\s*(.+)$/i.exec(text))) {
    const [name, reason] = splitReason(match[2]);
    return { src: 'transfer', title: `${/^don/i.test(match[1]) ? 'Don ' : 'Reçu '}${_de(name)}`, sub: `Échange${reason ? ` · ${reason}` : ''}` };
  }
  if (/^(↻|annulation du don)/i.test(text)) return { src: 'transfer', title: text.replace(/^↻\s*/, ''), sub: 'Échange · correction' };
  if (/^solde initial/i.test(text)) return { src: 'start', title: 'Solde initial', sub: 'Départ' };
  return { src: 'manual', title: text || 'Sans motif', sub: sign > 0 ? 'Ajout manuel' : 'Retrait manuel' };
}

export function flattenLedger(compte = {}) {
  const entries = [];
  for (const kind of ['recettes', 'depenses']) {
    const sign = kind === 'recettes' ? 1 : -1;
    for (const [idx, row] of (compte[kind] || []).entries()) {
      const amount = _amount(row?.montant);
      const key = ledgerDateKey(row?.date);
      const classification = classifyLedgerEntry(row?.libelle, sign);
      const dateText = key
        ? new Date(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100)
          .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : String(row?.date || '');
      entries.push({
        kind,
        idx,
        sign,
        amount,
        row,
        key,
        ts: Number(row?.ts) || 0,
        ...classification,
        haystack: _normalize([
          row?.libelle,
          classification.title,
          classification.sub,
          SOURCE_LABELS[classification.src],
          new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount),
          dateText,
        ].join(' ')),
      });
    }
  }
  return entries.sort((a, b) => b.key - a.key || b.ts - a.ts || b.idx - a.idx || a.sign - b.sign);
}

export function ledgerRawBalance(compte = {}) {
  const sum = kind => (compte[kind] || []).reduce((total, row) => total + _amount(row?.montant), 0);
  return _round(sum('recettes') - sum('depenses'));
}

export function endOfDayBalances(entries = []) {
  const dailyNet = new Map();
  for (const entry of entries) {
    dailyNet.set(entry.key, _round((dailyNet.get(entry.key) || 0) + entry.sign * entry.amount));
  }
  const balances = new Map();
  let running = 0;
  [...dailyNet.keys()].sort((a, b) => a - b).forEach(key => {
    running = _round(running + dailyNet.get(key));
    balances.set(key, running);
  });
  return balances;
}

export function filterLedger(entries = [], filters = {}) {
  const kind = filters.kind || 'all';
  const src = filters.src || 'all';
  const query = _normalize(filters.q || filters.search || '').trim();
  return entries.filter(entry => {
    if (kind !== 'all' && (kind === 'in' || kind === 'rcpt' ? entry.sign < 0 : entry.sign > 0)) return false;
    if (src !== 'all' && entry.src !== src) return false;
    return !query || entry.haystack.includes(query);
  });
}

export function ledgerSuggestions(entries = [], sign = 1) {
  const defaults = sign > 0
    ? ['Récompense de quête', 'Butin', 'Vente à un marchand']
    : ['Auberge', 'Repas', 'Réparation', 'Service'];
  const recent = [];
  for (const entry of entries) {
    const label = String(entry.row?.libelle || '').trim();
    if (entry.src === 'manual' && entry.sign === Math.sign(sign) && label.length <= 28 && !recent.includes(label)) recent.push(label);
  }
  return [...new Set([...recent.slice(0, 2), ...defaults])].slice(0, 4);
}

/** Construit un compte après opération et migre les anciennes fiches `or` seules. */
export function buildGoldAccount(character = {}, entries = [], options = {}) {
  const compte = { recettes: [], depenses: [], ...(character.compte || {}) };
  const recettes = [...(compte.recettes || [])];
  const depenses = [...(compte.depenses || [])];
  const now = Number(options.now) || Date.now();
  const date = options.date || new Date().toLocaleDateString('fr-FR');
  if (!recettes.length && !depenses.length) {
    const legacyBalance = Math.max(0, Number.parseFloat(character.or) || 0);
    if (legacyBalance > 0) recettes.push({ date, libelle: 'Solde initial', montant: legacyBalance, ts: now - 1 });
  }
  (entries || []).forEach((entry, index) => {
    const delta = Number(entry?.delta) || 0;
    if (!delta) return;
    const row = {
      date: entry.date || date,
      libelle: String(entry.reason || 'Transaction').slice(0, 100),
      montant: Math.abs(delta),
      ts: now + index,
    };
    (delta > 0 ? recettes : depenses).push(row);
  });
  return { ...compte, recettes, depenses };
}

export function validateLedgerEdit(compte = {}, kind, idx, patch = {}) {
  const row = compte?.[kind]?.[idx];
  if (!row) return { ok: false, msg: 'Mouvement introuvable' };
  const amount = _amount(patch.montant);
  const libelle = String(patch.libelle || '').trim();
  const nextKind = patch.kind === 'depenses' || Number(patch.sign) < 0 ? 'depenses' : 'recettes';
  if (!(amount > 0)) return { ok: false, msg: 'Montant requis' };
  if (!libelle) return { ok: false, msg: 'Motif requis' };
  const oldSign = kind === 'recettes' ? 1 : -1;
  const nextSign = nextKind === 'recettes' ? 1 : -1;
  const newBalance = _round(ledgerRawBalance(compte) - oldSign * _amount(row.montant) + nextSign * amount);
  if (newBalance < 0) return { ok: false, msg: `Ta bourse passerait à −${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(-newBalance)} or`, newBalance };
  return { ok: true, msg: '', newBalance, kind: nextKind };
}

export function validateLedgerDelete(compte = {}, kind, idx) {
  const row = compte?.[kind]?.[idx];
  if (!row) return { ok: false, msg: 'Mouvement introuvable' };
  const sign = kind === 'recettes' ? 1 : -1;
  const newBalance = _round(ledgerRawBalance(compte) - sign * _amount(row.montant));
  if (newBalance < 0) return { ok: false, msg: `Ta bourse passerait à −${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(-newBalance)} or`, newBalance };
  return { ok: true, msg: '', newBalance };
}
