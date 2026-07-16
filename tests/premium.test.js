import test from 'node:test';
import assert from 'node:assert/strict';

import { STATE } from '../assets/js/core/state.js';
import { accountPlanOf, adminAdventureCount, canCreateAdventure, hasAdventurePremiumAccess, hasPremiumAccess } from '../assets/js/shared/premium.js';
import { isFeatureAllowedByPlan, isFeatureEnabled, isPremiumFeature } from '../assets/js/shared/features.js';

test('premium : le compte gratuit garde le socle et verrouille les pages bonus', () => {
  STATE.profile = { uid: 'u1', plan: 'free' };
  STATE.adventure = { enabledFeatures: ['characters', 'shop', 'statistiques'] };

  assert.equal(hasPremiumAccess(), false);
  assert.equal(isPremiumFeature('characters'), false);
  assert.equal(isPremiumFeature('shop'), true);
  assert.equal(isFeatureEnabled('characters'), true);
  assert.equal(isFeatureEnabled('shop'), false);
  assert.equal(isFeatureAllowedByPlan('statistiques'), false);
});

test('premium : plan premium ou super-admin debloque les pages bonus', () => {
  STATE.profile = { uid: 'u2', plan: 'premium' };
  STATE.adventure = { enabledFeatures: ['shop'] };

  assert.equal(accountPlanOf(), 'premium');
  assert.equal(isFeatureEnabled('shop'), true);

  STATE.profile = { uid: 'admin', isAdmin: true };
  assert.equal(hasPremiumAccess(), true);
  assert.equal(isFeatureAllowedByPlan('statistiques'), true);
});

test('premium : une aventure premium debloque les pages pour ses joueurs gratuits', () => {
  STATE.user = { uid: 'player-free' };
  STATE.profile = { uid: 'player-free', plan: 'free' };
  STATE.adventure = { enabledFeatures: ['achievements'], premiumAccess: true, createdBy: 'mj-premium' };

  assert.equal(hasPremiumAccess(), false);
  assert.equal(hasAdventurePremiumAccess(), true);
  assert.equal(isFeatureEnabled('achievements'), true);
});

test('premium : premiumUntil futur debloque, premiumUntil passe ne suffit pas', () => {
  STATE.profile = { uid: 'u3', premiumUntil: new Date(Date.now() + 86400000).toISOString() };
  assert.equal(hasPremiumAccess(), true);

  STATE.profile = { uid: 'u4', premiumUntil: new Date(Date.now() - 86400000).toISOString() };
  assert.equal(hasPremiumAccess(), false);
});

test('premium : le compte gratuit peut administrer plusieurs aventures', () => {
  STATE.user = { uid: 'mj-free' };
  STATE.profile = { uid: 'mj-free', plan: 'free' };
  STATE.adventures = [
    { id: 'a1', createdBy: 'mj-free', admins: ['mj-free'] },
    { id: 'a2', createdBy: 'mj-free', admins: ['mj-free'] },
  ];

  assert.equal(adminAdventureCount(), 2);
  assert.equal(canCreateAdventure(), true);

  STATE.profile = { uid: 'mj-free', plan: 'premium' };
  assert.equal(canCreateAdventure(), true);
});
