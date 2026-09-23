import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const layoutSource = fs.readFileSync(new URL('../assets/js/core/layout.js', import.meta.url), 'utf8');
const presenceSource = fs.readFileSync(new URL('../assets/js/features/vtt/vtt-presence.js', import.meta.url), 'utf8');
const layoutCss = fs.readFileSync(new URL('../assets/css/layout.css', import.meta.url), 'utf8');

test('la navigation distingue une session déclarée live de la simple présence', () => {
  assert.match(layoutSource, /dot\.classList\.toggle\('is-session-live', _sessionLive\)/);
  assert.match(layoutSource, /playBtn\?\.classList\.toggle\('is-session-live', _sessionLive\)/);
  assert.match(layoutSource, /mobileBtn\?\.classList\.toggle\('is-session-live', _sessionLive\)/);
  assert.match(layoutCss, /\.sidebar-play-dot\.is-session-live[\s\S]*background:\s*#ef4444/);
});

test('le bouton VTT expose des états clairs et protège la fin de session', () => {
  assert.match(presenceSource, /<strong>Démarrer la session<\/strong>/);
  assert.match(presenceSource, /<strong>Session en direct<\/strong>/);
  assert.match(presenceSource, /Terminer la session \?/);
  assert.match(presenceSource, /_sessionUpdating/);
});
