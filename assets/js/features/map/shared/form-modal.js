// Factorise les modales de formulaire du module Carte :
// boucle Promise + openModal + submit/cancel + FormData -> data parsée.

import { openModal, closeModalDirect } from '../../../shared/modal.js';

/**
 * Ouvre une modale contenant un <form id={formId}>. Résout :
 *  - null si l'utilisateur annule (bouton [data-role="cancel"]) ou si le form
 *    n'est pas trouvé ;
 *  - la valeur retournée par parse(entries, formData) à la soumission.
 *
 * Si parse() renvoie une valeur falsy, la modale reste ouverte (validation échouée).
 */
export function openFormModal({ title, bodyHtml, formId, parse }) {
  return new Promise(resolve => {
    openModal(title, bodyHtml);
    const form = document.getElementById(formId);
    if (!form) return resolve(null);

    const close = result => { closeModalDirect(); resolve(result); };

    form.querySelector('[data-role="cancel"]')?.addEventListener('click', () => close(null));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const entries = Object.fromEntries(fd.entries());
      const result = parse(entries, fd);
      if (result) close(result);
    });
  });
}
