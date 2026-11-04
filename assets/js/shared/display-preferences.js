import { openModal, closeModal } from './modal.js';

const STORAGE_KEY = 'jdr-display-preferences';
const DEFAULTS = { text: 'normal', motion: 'system' };

function _read() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      text: ['normal', 'large'].includes(value.text) ? value.text : DEFAULTS.text,
      motion: ['system', 'reduced'].includes(value.motion) ? value.motion : DEFAULTS.motion,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function _apply(preferences) {
  document.documentElement.dataset.uiText = preferences.text;
  document.documentElement.dataset.uiMotion = preferences.motion;
}

function _save(preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  _apply(preferences);
}

export function initDisplayPreferences() {
  _apply(_read());
}

export function openDisplayPreferences() {
  const preferences = _read();
  openModal('Confort d’affichage', `
    <div class="global-display-prefs">
      <section>
        <div><strong>Taille du texte</strong><span>Agrandit les textes utilisant l’échelle de l’interface.</span></div>
        <div class="global-display-options" role="radiogroup" aria-label="Taille du texte">
          <label><input type="radio" name="global-text-size" value="normal" ${preferences.text === 'normal' ? 'checked' : ''}><span><b>Aa</b>Normale</span></label>
          <label><input type="radio" name="global-text-size" value="large" ${preferences.text === 'large' ? 'checked' : ''}><span class="is-large"><b>Aa</b>Grande</span></label>
        </div>
      </section>
      <section>
        <div><strong>Animations</strong><span>Peut neutraliser les transitions même si le système ne le demande pas.</span></div>
        <div class="global-display-options" role="radiogroup" aria-label="Animations">
          <label><input type="radio" name="global-motion" value="system" ${preferences.motion === 'system' ? 'checked' : ''}><span>Système</span></label>
          <label><input type="radio" name="global-motion" value="reduced" ${preferences.motion === 'reduced' ? 'checked' : ''}><span>Réduites</span></label>
        </div>
      </section>
      <p>Ces préférences restent sur cet appareil et ne consomment aucune opération Firebase.</p>
    </div>
    <div class="modal-footer global-display-footer"><button type="button" class="btn btn-gold" data-display-done>Terminé</button></div>
  `, { icon: '◐', subtitle: 'Préférences locales de lisibilité', accent: '#69a8ff' });

  requestAnimationFrame(() => {
    const body = document.getElementById('modal-body');
    body?.querySelectorAll('input[name="global-text-size"], input[name="global-motion"]').forEach(input => {
      input.addEventListener('change', () => {
        _save({
          text: body.querySelector('input[name="global-text-size"]:checked')?.value || DEFAULTS.text,
          motion: body.querySelector('input[name="global-motion"]:checked')?.value || DEFAULTS.motion,
        });
      });
    });
    body?.querySelector('[data-display-done]')?.addEventListener('click', closeModal);
  });
}
