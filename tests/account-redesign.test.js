import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const account = readFileSync(new URL('../assets/js/features/account.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/account.css', import.meta.url), 'utf8');
const firestore = readFileSync(new URL('../assets/js/data/firestore.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../docs/firestore-rules.md', import.meta.url), 'utf8');

test('la page Compte suit le header et la navigation sticky du handoff', () => {
  assert.match(account, /class="ac-page"/);
  assert.match(account, /class="ac-header"/);
  assert.match(account, /data-section="profile"/);
  assert.match(account, /data-section="connection"/);
  assert.match(account, /data-section="plan"/);
  assert.match(account, /data-section="danger"/);
  assert.match(css, /\.ac-page\{[^}]*1040px/);
  assert.match(css, /\.ac-layout\{[^}]*grid-template-columns:190px minmax\(0,1fr\)/);
  assert.match(css, /\.ac-nav\{[^}]*position:sticky/);
  assert.doesNotMatch(account, /account-summary|account-identity-card|Repères/);
});

test('pseudo email et mot de passe se modifient en ligne', () => {
  assert.match(account, /data-editor="pseudo"/);
  assert.match(account, /id="acc-pseudo-count"/);
  assert.match(account, /class="ac-preview"/);
  assert.match(account, /data-editor="email"/);
  assert.match(account, /id="acc-check-length"/);
  assert.match(account, /data-input="validateAccountForm"/);
});

test('les deux fournisseurs peuvent être liés sans créer une autre identité', () => {
  assert.match(account, /linkWithPopup/);
  assert.match(account, /linkWithCredential/);
  assert.match(account, /data-action="linkAccountGoogle"/);
  assert.match(account, /data-editor="link-password"/);
  assert.match(account, /Google \+ email/);
});

test('le changement d email passe par le lien de confirmation Firebase', () => {
  assert.match(account, /verifyBeforeUpdateEmail\(user, newEmail\)/);
  assert.doesNotMatch(account, /\bupdateEmail\s*\(/);
  assert.match(account, /Lien de confirmation envoyé/);
});

test('les mots de passe actuels restent masqués sans bouton de révélation', () => {
  assert.match(account, /acc-email-password[\s\S]*current-password[\s\S]*reveal: false/);
  assert.match(account, /acc-old-password[\s\S]*current-password[\s\S]*reveal: false/);
  assert.match(account, /acc-delete-password[\s\S]*current-password[\s\S]*reveal: false/);
  assert.match(account, /acc-new-password[\s\S]*new-password/);
});

test('la suppression transfère une aventure avant de supprimer le compte', () => {
  assert.match(account, /function _adventureSuccessor/);
  assert.match(account, /async function _transferOwnedAdventure/);
  assert.match(account, /createdBy: successor/);
  assert.match(account, /await _transferOwnedAdventure\(adventure, successor, user\.uid\)/);
  assert.match(account, /if \(!successor\)[\s\S]*await deleteAdventure\(adventure\.id\)/);
  assert.match(account, /await deleteFromCol\('users', user\.uid\)[\s\S]*await deleteUser\(user\)/);
});

test('les mutations cross-aventure restent dans la couche Firestore', () => {
  assert.match(firestore, /export async function loadAdventureCollection/);
  assert.match(firestore, /export async function updateInAdventureCol/);
  assert.match(firestore, /export async function deleteFromAdventureCol/);
  assert.match(rules, /allow delete: if \(isLoggedIn\(\) && request\.auth\.uid == uid\) \|\| isAdmin\(\)/);
});

test('le sélecteur avatar exige une validation explicite', () => {
  assert.match(account, /class="ac-avatar-tabs"/);
  assert.match(account, /Mes personnages/);
  assert.match(account, /Avatars de l'app/);
  assert.match(account, /data-action="applyAccountAvatar"/);
  assert.match(account, /Utiliser cet avatar/);
});
