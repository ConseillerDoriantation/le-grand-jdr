// Règles pures du catalogue d'émotes. Aucun DOM/Firebase : ce module sert à la
// modale MJ, au rendu du chat et aux tests de compatibilité des alias.

export const EMOTE_NAME_MAX = 32;
export const EMOTE_NAME_RE = /^[a-z0-9_]{1,32}$/;

export function sanitizeEmoteName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s.\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, EMOTE_NAME_MAX);
}

export function emoteAliases(emote) {
  const name = sanitizeEmoteName(emote?.name);
  return [...new Set((Array.isArray(emote?.aliases) ? emote.aliases : [])
    .map(sanitizeEmoteName)
    .filter(alias => alias && alias !== name))];
}

export function normalizeEmote(emote = {}, index = 0) {
  return {
    ...emote,
    id: String(emote.id || `emote_${index}_${Date.now().toString(36)}`),
    name: sanitizeEmoteName(emote.name),
    aliases: emoteAliases(emote),
  };
}

export function emoteKeys(emote) {
  const item = normalizeEmote(emote);
  return [item.name, ...item.aliases].filter(Boolean);
}

export function createEmoteLookup(emotes = []) {
  const lookup = new Map();
  for (const raw of emotes) {
    const emote = normalizeEmote(raw);
    for (const key of emoteKeys(emote)) if (!lookup.has(key)) lookup.set(key, emote);
  }
  return lookup;
}

export function resolveEmoteNames(names = [], emotes = []) {
  const lookup = createEmoteLookup(emotes);
  const resolved = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const emote = lookup.get(sanitizeEmoteName(raw));
    if (emote?.name && !resolved.includes(emote.name)) resolved.push(emote.name);
  }
  return resolved;
}

export function uniqueEmoteName(base, emotes = [], exceptId = '') {
  const taken = new Set(emotes
    .filter(emote => String(emote?.id || '') !== String(exceptId || ''))
    .flatMap(emoteKeys));
  const root = sanitizeEmoteName(base) || 'emote';
  if (!taken.has(root)) return root;
  let suffix = 2;
  let candidate = `${root}_${suffix}`.slice(0, EMOTE_NAME_MAX);
  while (taken.has(candidate)) {
    suffix += 1;
    const tail = `_${suffix}`;
    candidate = `${root.slice(0, EMOTE_NAME_MAX - tail.length)}${tail}`;
  }
  return candidate;
}

export function emoteCatalogIssues(emotes = []) {
  const normalized = emotes.map(normalizeEmote);
  const owners = new Map();
  for (const emote of normalized) {
    for (const key of emoteKeys(emote)) {
      const list = owners.get(key) || [];
      list.push(emote.id);
      owners.set(key, list);
    }
  }
  const issues = new Map();
  for (const emote of normalized) {
    let message = '';
    if (!EMOTE_NAME_RE.test(emote.name)) message = 'Nom requis';
    else {
      const duplicate = emoteKeys(emote).find(key => (owners.get(key) || []).some(id => id !== emote.id));
      if (duplicate) message = duplicate === emote.name
        ? `Le nom :${duplicate}: est déjà pris`
        : `L’alias :${duplicate}: est déjà pris`;
    }
    if (message) issues.set(emote.id, message);
  }
  return issues;
}

export function finalizeEmoteDraft(draft = [], saved = []) {
  const previous = new Map(saved.map((emote, index) => {
    const normalized = normalizeEmote(emote, index);
    return [normalized.id, normalized];
  }));
  return draft.map((raw, index) => {
    const emote = normalizeEmote(raw, index);
    const before = previous.get(emote.id);
    const aliases = [...emote.aliases];
    if (before && before.name !== emote.name && raw.keepOldName !== false && before.name && !aliases.includes(before.name)) {
      aliases.push(before.name);
    }
    return { id: emote.id, name: emote.name, url: String(emote.url || ''), ...(aliases.length ? { aliases } : {}) };
  });
}

export function dedupeEmoteImports(files = [], emotes = [], {
  slugOf = file => sanitizeEmoteName(String(file?.name || '').replace(/\.[a-z0-9]+$/i, '')),
  fileKeyOf = file => String(file?.url || ''),
} = {}) {
  const names = new Set(emotes.flatMap(emoteKeys));
  const filesSeen = new Set(emotes.map(emote => fileKeyOf({ url: emote?.url || '' })).filter(Boolean));
  const added = [];
  let skipped = 0;
  for (const file of files) {
    const name = sanitizeEmoteName(slugOf(file));
    const key = fileKeyOf(file);
    if (!name || names.has(name) || (key && filesSeen.has(key))) { skipped += 1; continue; }
    names.add(name);
    if (key) filesSeen.add(key);
    added.push({ name, url: String(file?.url || '') });
  }
  return { added, skipped };
}

export function dataUrlBytes(url = '') {
  const value = String(url || '');
  if (!value.startsWith('data:')) return 0;
  const payload = value.split(',', 2)[1] || '';
  return Math.max(0, Math.floor(payload.length * 3 / 4) - ((payload.match(/=*$/)?.[0]?.length) || 0));
}
