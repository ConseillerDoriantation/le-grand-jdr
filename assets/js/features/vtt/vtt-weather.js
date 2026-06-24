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
import { openModal, closeModalDirect } from '../../shared/modal.js';
import { _sesRef } from './vtt-refs.js';

const WEATHER = [
  { id: 'clear', label: 'Dégagé',     icon: '☀️' },
  { id: 'rain',  label: 'Pluie',      icon: '🌧️' },
  { id: 'storm', label: 'Orage',      icon: '⛈️' },
  { id: 'snow',  label: 'Neige',      icon: '❄️' },
  { id: 'fog',   label: 'Brouillard', icon: '🌫️' },
];
const _wMeta = id => WEATHER.find(w => w.id === id) || WEATHER[0];
const _curWeather = () => VS.session?.weather || 'clear';

// Bouton météo (sous le timer). MJ : ouvre le sélecteur. Joueur : icône seule
// (lecture), masqué si dégagé pour ne pas encombrer.
function _renderWeatherBtn() {
  const el = document.getElementById('vtt-weather');
  if (!el) return;
  const w = _wMeta(_curWeather());
  const mj = STATE.isAdmin;
  if (!mj && w.id === 'clear') { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<button class="vtt-weather-btn" ${mj ? 'data-vtt-fn="_vttWeatherOpen"' : 'disabled'} title="Météo : ${w.label}">
    <span class="vtt-weather-ico">${w.icon}</span>${mj ? `<span class="vtt-weather-lbl">${w.label}</span>` : ''}
  </button>`;
}

function _vttWeatherOpen() {
  if (!STATE.isAdmin) return;
  const cur = _curWeather();
  const opts = WEATHER.map(w =>
    `<button class="vtt-weather-opt${w.id === cur ? ' is-active' : ''}" data-vtt-fn="_vttSetWeather" data-vtt-args="${w.id}">
      <span class="vtt-weather-opt-ico">${w.icon}</span><span>${w.label}</span>
    </button>`).join('');
  openModal('🌦️ Météo de la scène', `<div class="vtt-weather-grid">${opts}</div>`);
}

async function _vttSetWeather(id) {
  if (!STATE.isAdmin) return;
  closeModalDirect();
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

export { _renderWeatherBtn, _applyWeather, _vttWeatherOpen, _vttSetWeather };
