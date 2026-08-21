import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
}

function fakeElement() {
  return {
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: new FakeClassList(),
    style: {
      setProperty() {},
      removeProperty() {},
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    contains() { return false; },
  };
}

const overlay = fakeElement();
const body = fakeElement();
const titleBar = fakeElement();
const titleText = fakeElement();

global.document = {
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
  contains() { return false; },
  getElementById(id) {
    return {
      'modal-overlay': overlay,
      'modal-body': body,
      'modal-title': titleBar,
    }[id] || null;
  },
  querySelector(selector) {
    return selector === '#modal-title span' ? titleText : null;
  },
};
global.requestAnimationFrame = (callback) => callback();

const {
  allowAutomaticModalCloseOnce,
  cancelAutomaticModalCloseOnce,
  clearAutomaticModalCloseGuard,
  openModal,
  pushModal,
  confirmModal,
  promptModal,
  closeModalDirect,
  setModalCloseGuard,
  setAutomaticModalCloseGuard,
  clearModalCloseGuard,
} = await import('../assets/js/shared/modal.js');

test('fermer une confirmation empilée ne déclenche pas la garde de la modale de fond', () => {
  openModal('Forge', '<form>sort modifié</form>');
  let guardCalls = 0;
  setModalCloseGuard(() => {
    guardCalls += 1;
    return true;
  });

  pushModal('Confirmation', '<button>Supprimer</button>');
  closeModalDirect();

  assert.equal(guardCalls, 0);
  assert.equal(body.innerHTML, '<form>sort modifié</form>');
  assert.equal(overlay.classList.contains('show'), true);

  closeModalDirect();
  assert.equal(guardCalls, 1);
  assert.equal(overlay.classList.contains('show'), true);

  clearModalCloseGuard();
  closeModalDirect();
});

test('une fermeture réelle nettoie la garde avant la prochaine confirmation autonome', () => {
  openModal('Forge', '<form>sort</form>');
  let guardCalls = 0;
  setModalCloseGuard(() => {
    guardCalls += 1;
    return false;
  });
  closeModalDirect();
  assert.equal(guardCalls, 1);

  pushModal('Confirmation', '<button>Annuler</button>');
  closeModalDirect();

  assert.equal(guardCalls, 1);
  assert.equal(overlay.classList.contains('show'), false);
});

test('fermer une couche notifie son annulation puis restaure la modale précédente', () => {
  openModal('Forge', '<form>sort</form>');
  let dismissed = 0;
  pushModal('Confirmation', '<button>Annuler</button>', null, {
    onDismiss: () => { dismissed += 1; },
  });

  closeModalDirect();

  assert.equal(dismissed, 1);
  assert.equal(body.innerHTML, '<form>sort</form>');
  closeModalDirect();
});

test('la croix d’une confirmation vaut annulation et laisse la modale de fond ouverte', async () => {
  openModal('Forge', '<form>sort</form>');
  const answer = confirmModal('Supprimer ce sort ?');

  closeModalDirect();

  assert.equal(await answer, false);
  assert.equal(body.innerHTML, '<form>sort</form>');
  assert.equal(overlay.classList.contains('show'), true);
  closeModalDirect();
});

test('un prompt destructif rend son action principale explicitement dangereuse', async () => {
  openModal('Statistiques', '<div>Données</div>');
  const answer = promptModal('Tape EFFACER', {
    confirmLabel: 'Effacer définitivement',
    danger: true,
  });

  assert.match(body.innerHTML, /Effacer définitivement/);
  assert.match(body.innerHTML, /rgba\(255,107,107,.12\)/);

  closeModalDirect();
  assert.equal(await answer, null);
  assert.equal(body.innerHTML, '<div>Données</div>');
  closeModalDirect();
});

test('une sous-modale restaure les valeurs saisies dans le formulaire de fond', async () => {
  const field = {
    id: 'si-nom',
    dataset: {},
    tagName: 'INPUT',
    type: 'text',
    value: 'Épée enregistrée',
    isContentEditable: false,
    getAttribute() { return null; },
  };
  const originalQuerySelectorAll = body.querySelectorAll;
  body.querySelectorAll = (selector) => selector === 'input, textarea, select, [contenteditable="true"]' ? [field] : [];

  openModal('Article', '<input id="si-nom" value="Épée enregistrée">');
  field.value = 'Épée du brouillon';
  pushModal('Action', '<input id="s-nom">');
  field.value = 'Valeur de la sous-modale';

  closeModalDirect();
  await new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));

  assert.equal(field.value, 'Épée du brouillon');
  body.querySelectorAll = originalQuerySelectorAll;
  closeModalDirect();
});

test('un enregistrement autorise une seule fermeture sans déclencher la garde automatique', () => {
  openModal('Bastion', '<form>identité modifiée</form>');
  let guardCalls = 0;
  setAutomaticModalCloseGuard(() => {
    guardCalls += 1;
    return true;
  });

  allowAutomaticModalCloseOnce();
  closeModalDirect();

  assert.equal(guardCalls, 0);
  assert.equal(overlay.classList.contains('show'), false);
});

test('un échec d’enregistrement annule l’autorisation et conserve la garde', () => {
  openModal('Bastion', '<form>identité modifiée</form>');
  let guardCalls = 0;
  setAutomaticModalCloseGuard(() => {
    guardCalls += 1;
    return true;
  });

  allowAutomaticModalCloseOnce();
  cancelAutomaticModalCloseOnce();
  closeModalDirect();

  assert.equal(guardCalls, 1);
  assert.equal(overlay.classList.contains('show'), true);
  clearAutomaticModalCloseGuard();
  closeModalDirect();
});

test('une garde métier remplace la garde automatique au lieu de confirmer deux fois', () => {
  openModal('Forge de sorts', '<form>sort modifié</form>');
  let automaticCalls = 0;
  let explicitCalls = 0;

  setAutomaticModalCloseGuard(() => {
    automaticCalls += 1;
    return true;
  });
  setModalCloseGuard(() => {
    explicitCalls += 1;
    return true;
  });
  // Une tentative tardive de réarmement QoL doit aussi être ignorée.
  setAutomaticModalCloseGuard(() => {
    automaticCalls += 1;
    return true;
  });

  closeModalDirect();

  assert.equal(explicitCalls, 1);
  assert.equal(automaticCalls, 0);
  assert.equal(overlay.classList.contains('show'), true);
  clearModalCloseGuard();
  closeModalDirect();
});
