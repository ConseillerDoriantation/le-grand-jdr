// Vrai quand la frappe part dans une zone de saisie : champ, liste déroulante ou
// zone contenteditable (messagerie flottante, éditeurs de texte riche). Tout
// raccourci clavier global doit alors laisser passer la touche, sinon le chiffre
// ou la lettre n'arrive jamais dans le champ.
export function isTypingTarget(target) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  if (!el?.closest) return false;
  return !!(el.closest('input, textarea, select, [role="textbox"]') || el.isContentEditable);
}
