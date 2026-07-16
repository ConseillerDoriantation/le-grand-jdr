import { STATE } from '../core/state.js';

export const ACCOUNT_PLANS = Object.freeze({
  FREE: 'free',
  PREMIUM: 'premium',
});

export const PREMIUM_LIMITS = Object.freeze({
  free: {
    imageStorageMb: 100,
    musicStorageMb: 25,
    maxAdminAdventures: Infinity,
  },
  premium: {
    imageStorageMb: 2048,
    musicStorageMb: 512,
    maxAdminAdventures: Infinity,
  },
});

function _subscriptionActive(subscription = {}) {
  const status = String(subscription.status || '').toLowerCase();
  return ['active', 'trialing', 'paid', 'manual'].includes(status);
}

function _futureDateLike(value) {
  if (!value) return false;
  const ms = value?.seconds ? value.seconds * 1000 : new Date(value).getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

export function accountPlanOf(profile = STATE.profile) {
  if (profile?.isAdmin === true) return ACCOUNT_PLANS.PREMIUM;
  if (_futureDateLike(profile?.premiumUntil)) return ACCOUNT_PLANS.PREMIUM;
  if (profile?.premium === true) return ACCOUNT_PLANS.PREMIUM;
  if (String(profile?.plan || '').toLowerCase() === ACCOUNT_PLANS.PREMIUM) return ACCOUNT_PLANS.PREMIUM;
  if (_subscriptionActive(profile?.subscription)) return ACCOUNT_PLANS.PREMIUM;
  return ACCOUNT_PLANS.FREE;
}

export function hasPremiumAccess(profile = STATE.profile) {
  return accountPlanOf(profile) === ACCOUNT_PLANS.PREMIUM;
}

export function hasAdventurePremiumAccess(adv = STATE.adventure, profile = STATE.profile) {
  if (hasPremiumAccess(profile)) return true;
  if (!adv) return false;
  if (adv.premiumAccess === true) return true;
  if (adv.premium === true) return true;
  if (String(adv.plan || '').toLowerCase() === ACCOUNT_PLANS.PREMIUM) return true;
  if (adv.createdBy && adv.createdBy === STATE.user?.uid && hasPremiumAccess(profile)) return true;
  return false;
}

export function adminAdventureCount(adventures = STATE.adventures, uid = STATE.user?.uid) {
  if (!uid || !Array.isArray(adventures)) return 0;
  return adventures.filter(adv => adv?.createdBy === uid || (adv?.admins || []).includes(uid)).length;
}

export function canCreateAdventure(profile = STATE.profile, adventures = STATE.adventures, uid = STATE.user?.uid) {
  if (hasPremiumAccess(profile)) return true;
  return adminAdventureCount(adventures, uid) < PREMIUM_LIMITS.free.maxAdminAdventures;
}

export function planLabel(profile = STATE.profile) {
  return hasPremiumAccess(profile) ? 'Premium' : 'Gratuit';
}

export function planLimits(profile = STATE.profile) {
  return PREMIUM_LIMITS[accountPlanOf(profile)] || PREMIUM_LIMITS.free;
}
