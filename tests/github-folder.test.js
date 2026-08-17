import test from 'node:test';
import assert from 'node:assert/strict';

import { githubPagesUrl } from '../assets/js/shared/github-folder.js';

test('githubPagesUrl résout un chemin de carte relatif vers GitHub Pages', () => {
  assert.equal(
    githubPagesUrl('images/maps/11 - Grand Cimetière.png'),
    'https://conseillerdoriantation.github.io/le-grand-jdr/images/maps/11%20-%20Grand%20Cimeti%C3%A8re.png',
  );
});

test('githubPagesUrl migre une ancienne URL raw sans changer le fichier', () => {
  assert.equal(
    githubPagesUrl('https://raw.githubusercontent.com/ConseillerDoriantation/le-grand-jdr/main/images/maps/Manoir.jpg'),
    'https://conseillerdoriantation.github.io/le-grand-jdr/images/maps/Manoir.jpg',
  );
});

test('githubPagesUrl convertit aussi une URL blob GitHub', () => {
  assert.equal(
    githubPagesUrl('https://github.com/ConseillerDoriantation/le-grand-jdr/blob/main/images/maps/Grande salle.webp'),
    'https://conseillerdoriantation.github.io/le-grand-jdr/images/maps/Grande%20salle.webp',
  );
});

test('githubPagesUrl préserve une URL externe', () => {
  assert.equal(githubPagesUrl('https://cdn.example.com/map.png'), 'https://cdn.example.com/map.png');
});
