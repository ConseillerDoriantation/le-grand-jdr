// ══════════════════════════════════════════════════════════════════════════════
// VTT-WEATHER.JS — Météo de la scène (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// État partagé via VS.session.weather (Firestore, doc session — comme le timer).
// Le MJ choisit la météo via un bouton près du timer ; tous les joueurs voient le
// même effet visuel (pluie/orage/neige/brouillard) en overlay au-dessus du canvas
// (effet ÉCRAN, non ancré à la carte — il ne suit pas le pan/zoom). CSS pur, aucun
// redraw Konva. La pose de l'effet est faite sur chaque mise à jour de session.
// ══════════════════════════════════════════════════════════════════════════════

import { setDoc } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import { _sesRef } from './vtt-refs.js';

let _weatherOpen = false;   // popover inline d'icônes ouvert (MJ)

const WEATHER = [
  { id: 'clear', label: 'Dégagé',     icon: '☀️' },
  { id: 'rain',  label: 'Pluie',      icon: '🌧️' },
  { id: 'storm', label: 'Orage',      icon: '⛈️' },
  { id: 'snow',  label: 'Neige',      icon: '❄️' },
  { id: 'fog',   label: 'Brouillard', icon: '🌫️' },
];
const _wMeta = id => WEATHER.find(w => w.id === id) || WEATHER[0];
const _curWeather = () => VS.session?.weather || 'clear';

// Contrôle météo (à côté du timer) : icône seule, sans texte. MJ : clic → rangée
// d'icônes inline (pas de modale) pour choisir. Joueur : icône courante (lecture,
// masquée si dégagé).
function _renderWeatherBtn() {
  const el = document.getElementById('vtt-weather');
  if (!el) return;
  const cur = _curWeather();
  const w = _wMeta(cur);
  const mj = STATE.isAdmin;
  if (!mj) {
    el.style.display = w.id === 'clear' ? 'none' : '';
    el.innerHTML = w.id === 'clear' ? '' : `<span class="vtt-weather-ic vtt-weather-ic--ro" title="Météo : ${w.label}">${w.icon}</span>`;
    return;
  }
  el.style.display = '';
  if (!_weatherOpen) {
    el.innerHTML = `<button class="vtt-weather-ic" data-vtt-fn="_vttWeatherToggle" title="Météo : ${w.label}">${w.icon}</button>`;
    return;
  }
  // Ouvert : rangée de toutes les icônes (l'active surlignée), clic = choix.
  el.innerHTML = `<div class="vtt-weather-pop">${WEATHER.map(o =>
    `<button class="vtt-weather-ic${o.id === cur ? ' is-active' : ''}" data-vtt-fn="_vttSetWeather" data-vtt-args="${o.id}" title="${o.label}">${o.icon}</button>`
  ).join('')}</div>`;
}

function _vttWeatherToggle() {
  if (!STATE.isAdmin) return;
  _weatherOpen = !_weatherOpen;
  _renderWeatherBtn();
}

async function _vttSetWeather(id) {
  if (!STATE.isAdmin) return;
  _weatherOpen = false;
  _renderWeatherBtn();   // ferme le popover tout de suite (l'effet s'applique au snapshot)
  await setDoc(_sesRef(), { weather: id }, { merge: true }).catch(() => {});
}

// Pose / met à jour l'overlay d'effet au-dessus du canvas selon la météo courante.
function _applyWeather() {
  const wrap = VS.stage?.container();
  if (!wrap) return;
  let layer = wrap.querySelector('.vtt-weather-fx');
  const id = _curWeather();
  if (id === 'clear') { layer?.remove(); return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Effet réduit : juste un léger voile coloré, pas de particules animées.
    if (!layer) { layer = document.createElement('div'); layer.className = 'vtt-weather-fx'; wrap.appendChild(layer); }
    layer.dataset.w = id; layer.dataset.built = `static-${id}`; layer.innerHTML = '';
    return;
  }
  if (!layer) { layer = document.createElement('div'); layer.className = 'vtt-weather-fx'; wrap.appendChild(layer); }
  layer.dataset.w = id;
  if (layer.dataset.built !== id) {   // ne régénère les particules qu'au changement de type
    layer.dataset.built = id;
    layer.innerHTML = _weatherInner(id);
  }
}

function _weatherInner(id) {
  const rnd = (a, b) => (a + Math.random() * (b - a));
  if (id === 'rain' || id === 'storm') {
    const n = id === 'storm' ? 95 : 60;
    let s = '';
    for (let i = 0; i < n; i++) {
      s += `<span class="wd" style="left:${rnd(0, 100).toFixed(2)}%;animation-duration:${rnd(0.4, 0.9).toFixed(2)}s;animation-delay:-${rnd(0, 2).toFixed(2)}s;opacity:${rnd(.4, .85).toFixed(2)}"></span>`;
    }
    return s + (id === 'storm' ? '<span class="wflash"></span>' : '');
  }
  if (id === 'snow') {
    let s = '';
    for (let i = 0; i < 70; i++) {
      const sz = rnd(2, 6).toFixed(1);
      s += `<span class="ws" style="left:${rnd(0, 100).toFixed(2)}%;width:${sz}px;height:${sz}px;animation-duration:${rnd(5, 11).toFixed(2)}s;animation-delay:-${rnd(0, 8).toFixed(2)}s;opacity:${rnd(.5, .9).toFixed(2)}"></span>`;
    }
    return s;
  }
  if (id === 'fog') return '<span class="wfog"></span><span class="wfog wfog2"></span>';
  return '';
}

export { _renderWeatherBtn, _applyWeather, _vttWeatherToggle, _vttSetWeather };
