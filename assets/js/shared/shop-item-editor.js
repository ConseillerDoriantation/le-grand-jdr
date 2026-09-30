const STAT_ALIASES = {
  for: 'force', dex: 'dexterite', con: 'constitution',
  int: 'intelligence', sag: 'sagesse', cha: 'charisme',
};

const STAT_STORES = {
  force: 'forceBonus', dexterite: 'dexteriteBonus', constitution: 'constitutionBonus',
  intelligence: 'intelligenceBonus', sagesse: 'sagesseBonus', charisme: 'charismeBonus',
};

const DERIVED = {
  ca: 'caBonus', pv: 'pvMaxBonus', pm: 'pmMaxBonus',
  vit: 'vitesseBonus', vitesse: 'vitesseBonus', init: 'initiativeBonus', initiative: 'initiativeBonus',
};

function _plain(value = '') {
  return String(value).trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _signed(value) {
  const n = parseInt(String(value).replace(/\s/g, ''), 10) || 0;
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Analyse la saisie rapide de l'éditeur sans connaître le DOM. Chaque résultat
 * reconnu expose un petit patch à fusionner dans le brouillon courant.
 */
export function parseShopItemQuickEntry(input, {
  rarities = [], weaponFormats = [], damageTypes = [], template = 'classique',
} = {}) {
  const tokens = String(input || '').split(/[,;·|]/).map(s => s.trim()).filter(Boolean);
  return tokens.map((raw, index) => {
    const token = _plain(raw);
    let match;
    const rarity = [...rarities]
      .sort((a, b) => String(b.name || '').length - String(a.name || '').length)
      .find(r => token === _plain(r.name));
    if (rarity) return { label: `Rareté · ${rarity.name}`, patch: { rarete: rarity.value } };

    if ((match = token.match(/^(\d+)\s*(po|or|pieces?)?$/)) && (match[2] || index > 0)) {
      return { label: `Prix · ${match[1]} or`, patch: { prix: Number(match[1]) } };
    }
    if ((match = token.match(/^(\d+d\d+(?:\s*[+-]\s*\d+)?)((?:\s*\+\s*(?:for|dex|con|int|sag|cha))*)$/))) {
      const degatsStats = (match[2].match(/for|dex|con|int|sag|cha/g) || []).map(k => STAT_ALIASES[k]);
      return {
        label: `Dégâts · ${match[1].replace(/\s/g, '')}${degatsStats.length ? ` + ${degatsStats.map(k => k.slice(0, 3).toUpperCase()).join(' + ')}` : ''}`,
        patch: { degats: match[1].replace(/\s/g, ''), ...(degatsStats.length ? { degatsStats } : {}) },
      };
    }

    const weapon = weaponFormats.find(format => token === _plain(format.label));
    if (weapon) return { label: `Arme · ${weapon.label}`, weapon, patch: { template: 'arme', format: weapon.label } };

    if ((match = token.match(/^(for|dex|con|int|sag|cha)\s*([+-]\s*\d+)$/))) {
      const key = STAT_STORES[STAT_ALIASES[match[1]]];
      const value = parseInt(match[2].replace(/\s/g, ''), 10);
      return { label: `${match[1].toUpperCase()} ${_signed(value)}`, patch: { [key]: value } };
    }
    if ((match = token.match(/^(ca|pv|pm|vit(?:esse)?|init(?:iative)?)\s*([+-]?\s*\d+)$/))) {
      const key = DERIVED[match[1]];
      const value = parseInt(match[2].replace(/\s/g, ''), 10);
      return { label: `${match[1].toUpperCase()} ${_signed(value)}`, patch: template === 'armure' && key === 'caBonus' ? { ca: value } : { [key]: value } };
    }
    if ((match = token.match(/^(resist\w*|immun\w*|absor\w*|faibl\w*)\s+(.+)$/))) {
      const rel = { r: 'resistances', i: 'immunites', a: 'absorptions', f: 'faiblesses' }[match[1][0]];
      const type = damageTypes.find(entry => _plain(entry.label).startsWith(match[2].slice(0, 4)));
      if (type) return { label: `${rel} · ${type.label}`, damage: { relation: rel, typeId: type.id } };
    }
    if ((match = token.match(/^(?:stock|x|×)\s*(\d+)$/))) return { label: `Stock · ${match[1]}`, patch: { dispo: Number(match[1]) } };
    if (/^(∞|illimit\w*)$/.test(token)) return { label: 'Stock · illimité', patch: { dispo: -1 } };
    if ((match = token.match(/^([12])\s*m(ains?)?$|^(deux|une) mains?$/))) {
      const value = match[1] === '2' || match[3] === 'deux' ? '2 mains' : '1 main';
      return { label: `Maniement · ${value}`, patch: { mains: value } };
    }
    if (/^(magique|physique)$/.test(token)) {
      const value = token[0].toUpperCase() + token.slice(1);
      return { label: `Nature · ${value}`, patch: { nature: value } };
    }
    if (/^(tete|torse|pieds)$/.test(token)) {
      const value = token === 'tete' ? 'Tête' : token[0].toUpperCase() + token.slice(1);
      return { label: `Armure · ${value}`, patch: { template: 'armure', slotArmure: value } };
    }
    if (/^(amulette|anneau)$/.test(token)) {
      const value = token[0].toUpperCase() + token.slice(1);
      return { label: `Bijou · ${value}`, patch: { template: 'bijou', slotBijou: value } };
    }
    if (/^(consommable|potion)$/.test(token)) return { label: 'Consommable', patch: { consommable: true, type: 'Consommable' } };
    if (/^(masque|cache)$/.test(token)) return { label: 'Masqué', patch: { masque: true } };
    if (token.startsWith('trait ')) return { label: `Trait · ${raw.slice(6)}`, trait: raw.slice(6).trim() };
    if (index === 0) return { label: `Nom · ${raw}`, patch: { nom: raw[0]?.toUpperCase() + raw.slice(1) } };
    return { label: raw, bad: true };
  });
}

export function damageProfileToRelations(profile = {}) {
  const out = {};
  for (const relation of ['resistances', 'immunites', 'absorptions', 'faiblesses']) {
    for (const typeId of Array.isArray(profile?.[relation]) ? profile[relation] : []) out[typeId] = relation;
  }
  return out;
}

export function relationsToDamageProfile(relations = {}) {
  const out = { resistances: [], immunites: [], absorptions: [], faiblesses: [] };
  Object.entries(relations || {}).forEach(([typeId, relation]) => {
    if (out[relation] && !out[relation].includes(typeId)) out[relation].push(typeId);
  });
  return out;
}
