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

const {
  openModal,
  pushModal,
  confirmModal,
  closeModalDirect,
  setModalCloseGuard,
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
