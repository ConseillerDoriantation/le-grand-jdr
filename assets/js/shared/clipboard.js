/** Copie du texte avec repli pour les contextes où l'API Clipboard est refusée. */
export async function copyText(value) {
  const text = String(value ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Certains navigateurs exposent l'API mais la refusent selon les permissions.
  }

  const textarea = document.createElement('textarea');
  const active = document.activeElement;
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();

  let copied = false;
  try { copied = Boolean(document.execCommand?.('copy')); }
  finally {
    textarea.remove();
    active?.focus?.({ preventScroll: true });
  }
  if (!copied) throw new Error('Clipboard unavailable');
  return true;
}
