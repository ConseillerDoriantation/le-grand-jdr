// Normalisation pure des libellés de mentions Quill.
// Les embeds Quill ajoutent des gardes invisibles (notamment U+FEFF) autour de
// leur contenu. Elles ne doivent jamais devenir une partie du libellé sauvegardé.
const MENTION_GUARDS_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

export function normalizeRichTextMentionLabel(value, fallback = 'Mention') {
  const label = String(value ?? '')
    .replace(MENTION_GUARDS_RE, '')
    .trim()
    .replace(/^@+\s*/, '')
    .trim();
  return label || fallback;
}

export function richTextMentionText(value, fallback = 'Mention') {
  return `@${normalizeRichTextMentionLabel(value, fallback)}`;
}
