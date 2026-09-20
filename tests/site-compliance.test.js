import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const staticPages = ['index.html', 'privacy.html', 'terms.html', '404.html', 'auth-action.html'];

test('les pages publiques et les fichiers de référencement existent', () => {
  for (const path of [...staticPages, 'robots.txt', 'sitemap.xml']) {
    assert.ok(existsSync(join(root, path)), `${path} doit exister`);
  }
});

test('la page principale expose les métadonnées de partage et le consentement', () => {
  const html = read('index.html');
  assert.match(html, /<title>Grimorium<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+">/);
  assert.match(html, /data-consent-settings/);
  assert.match(html, /assets\/js\/shared\/consent\.js/);
});

test('toutes les images statiques déclarent un texte alternatif', () => {
  for (const path of staticPages) {
    const images = read(path).match(/<img\b[^>]*>/gi) || [];
    for (const image of images) {
      assert.match(image, /\balt=("[^"]*"|'[^']*')/i, `${path}: ${image}`);
    }
  }
});

test('les liens et ressources locales des pages publiques ne sont pas cassés', () => {
  for (const path of staticPages) {
    const html = read(path);
    const directory = dirname(join(root, path));
    const refs = [...html.matchAll(/\b(?:href|src)=(?:"([^"]+)"|'([^']+)')/gi)]
      .map(match => match[1] || match[2])
      .filter(ref => ref && !/^(?:https?:|mailto:|tel:|data:|#)/i.test(ref));

    for (const ref of refs) {
      const clean = decodeURIComponent(ref.split('#')[0].split('?')[0]);
      if (!clean || clean === './') continue;
      assert.ok(existsSync(resolve(directory, clean)), `${path}: cible absente ${ref}`);
    }
  }
});

test('les formulaires de compte ont des contraintes natives et un anti-spam', () => {
  const html = read('index.html');
  const input = id => html.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`, 'i'))?.[0] || '';
  assert.match(input('login-email'), /type="email"/);
  assert.match(input('login-email'), /\brequired\b/);
  assert.match(input('reg-password'), /minlength="8"/);
  assert.match(input('reg-password'), /\brequired\b/);
  assert.match(input('reg-website'), /tabindex="-1"/);
  assert.match(input('reg-terms'), /\brequired\b/);
});

test('les textes secondaires gardent un contraste AA sur le fond sombre', () => {
  const css = read('assets/css/tokens.css');
  const color = name => css.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i'))?.[1];
  const luminance = hex => {
    const [r, g, b] = hex.match(/../g).map(v => parseInt(v, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  for (const name of ['text', 'text-soft', 'text-muted', 'text-dim']) {
    assert.ok(contrast(color(name), color('bg-dark')) >= 4.5, `${name} doit respecter WCAG AA`);
  }
});
