const CONSENT_KEY = 'grimorium.consent.v1';
const CONSENT_VERSION = 1;
const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
let analyticsLoaded = false;

function analyticsId() {
  return document.querySelector('meta[name="grimorium-analytics-id"]')?.content?.trim() || '';
}

function readConsent() {
  try {
    const value = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    if (!value || value.version !== CONSENT_VERSION || !value.savedAt) return null;
    if (Date.now() - new Date(value.savedAt).getTime() > CONSENT_MAX_AGE) return null;
    return { analytics: value.analytics === true, savedAt:value.savedAt, version:value.version };
  } catch { return null; }
}

function deleteAnalyticsCookies() {
  document.cookie.split(';').forEach(raw => {
    const name = raw.split('=')[0].trim();
    if (!/^_ga(?:_|$)|^_gid$|^_gat/.test(name)) return;
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax; Secure`;
  });
}

function loadAnalytics() {
  const id = analyticsId();
  if (analyticsLoaded || !/^G-[A-Z0-9]+$/i.test(id)) return;
  analyticsLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(){ window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', id, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: 15_552_000,
    cookie_flags: 'SameSite=Lax;Secure',
    send_page_view: true,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  script.dataset.grimoriumAnalytics = 'true';
  document.head.appendChild(script);
}

function applyConsent(value) {
  document.documentElement.dataset.analyticsConsent = value?.analytics ? 'granted' : 'denied';
  if (value?.analytics) {
    loadAnalytics();
    window.gtag?.('consent', 'update', { analytics_storage:'granted' });
  } else {
    window.gtag?.('consent', 'update', { analytics_storage:'denied' });
    deleteAnalyticsCookies();
  }
}

function saveConsent(analytics) {
  const value = { version:CONSENT_VERSION, analytics:analytics === true, savedAt:new Date().toISOString() };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(value)); } catch {}
  applyConsent(value);
  document.getElementById('consent-banner')?.remove();
  document.getElementById('consent-settings')?.remove();
  document.dispatchEvent(new CustomEvent('app:consent-changed', { detail:value }));
}

function bannerHtml() {
  return `<aside class="consent-banner" id="consent-banner" aria-labelledby="consent-title" aria-describedby="consent-copy">
    <div class="consent-banner__copy">
      <strong id="consent-title">Vos choix de confidentialité</strong>
      <p id="consent-copy">Grimorium utilise un stockage indispensable à la connexion et à vos préférences. La mesure d’audience reste désactivée sans votre accord.</p>
      <a href="./privacy.html#cookies">En savoir plus</a>
    </div>
    <div class="consent-banner__actions">
      <button type="button" class="consent-btn" data-consent-choice="deny">Tout refuser</button>
      <button type="button" class="consent-btn consent-btn--primary" data-consent-choice="allow">Tout accepter</button>
    </div>
  </aside>`;
}

function settingsHtml(current) {
  return `<div class="consent-settings" id="consent-settings" role="dialog" aria-modal="true" aria-labelledby="consent-settings-title">
    <div class="consent-settings__panel">
      <div class="consent-settings__head"><div><small>CONFIDENTIALITÉ</small><h2 id="consent-settings-title">Préférences de cookies</h2></div><button type="button" data-consent-close aria-label="Fermer">×</button></div>
      <div class="consent-setting"><div><strong>Fonctionnement essentiel</strong><p>Connexion, sécurité, préférences et fonctionnement hors ligne.</p></div><span class="consent-required">Toujours actif</span></div>
      <label class="consent-setting"><div><strong>Mesure d’audience</strong><p>Google Analytics, avec signaux publicitaires désactivés. Aucun chargement avant votre accord.</p></div><input type="checkbox" id="consent-analytics" ${current?.analytics ? 'checked' : ''}></label>
      <div class="consent-settings__actions"><button type="button" class="consent-btn" data-consent-choice="deny">Tout refuser</button><button type="button" class="consent-btn consent-btn--primary" data-consent-save>Enregistrer mes choix</button></div>
    </div>
  </div>`;
}

function showBanner() {
  if (document.getElementById('consent-banner')) return;
  document.body.insertAdjacentHTML('beforeend', bannerHtml());
}

function showSettings() {
  document.getElementById('consent-settings')?.remove();
  document.body.insertAdjacentHTML('beforeend', settingsHtml(readConsent()));
  document.querySelector('#consent-settings [data-consent-close]')?.focus();
}

document.addEventListener('click', event => {
  const choice = event.target.closest('[data-consent-choice]')?.dataset.consentChoice;
  if (choice) { saveConsent(choice === 'allow'); return; }
  if (event.target.closest('[data-consent-settings]')) { event.preventDefault(); showSettings(); return; }
  if (event.target.closest('[data-consent-close]')) { document.getElementById('consent-settings')?.remove(); return; }
  if (event.target.closest('[data-consent-save]')) saveConsent(document.getElementById('consent-analytics')?.checked);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.getElementById('consent-settings')?.remove();
});

document.addEventListener('app:page-changed', event => {
  if (!readConsent()?.analytics || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_title: `Grimorium — ${event.detail?.page || 'Application'}`,
    page_location: window.location.href,
  });
});

const consent = readConsent();
applyConsent(consent);
if (!consent) showBanner();

export { readConsent, saveConsent, showSettings };
