// ══════════════════════════════════════════════════════════════════════════════
// DIAPO.JS — Page « Diapo » : diaporama interactif plein écran (aventures Premium).
//
// Le MJ compose un diaporama (système free-page : multi-diapos, images, formes,
// tableaux, graphiques, interactivité — liens, fenêtres, navigation, audio,
// étiquettes, diapos protégées). Les joueurs le PARCOURENT (navigation + inter-
// activité) mais ne peuvent pas le modifier.
//
// Premium : la page est togglable et hors FREE_FEATURES → isPremiumFeature =
// vrai (garde faite par core/navigation.js). Édition : STATE.isAdmin (MJ) ; la
// vraie protection = règle Firestore diapo/{id} (écriture MJ).
// Stockage : diapo/main → { page } (doc dédié, budget 1 Mo propre).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';
import { getDocData, saveDoc } from '../data/firestore.js';
import { showNotif } from '../shared/notifications.js';
import {
  freePageEditorHtml, bindFreePageEditor, getFreePageData,
  renderFreePageHtml, hasFreePage, compressFreePageImages,
} from '../shared/free-page.js';

const DOC_ID = 'main';
let _editing = false;
let _deck = null;

// Firestore plafonne un doc à 1 048 576 octets ; le diaporama a son doc dédié.
const SAFE_BYTES = 1_000_000;
const _utf8Len = (s) => new TextEncoder().encode(s).length;
async function _fitDiapo(page) {
  let bytes = _utf8Len(JSON.stringify({ page })), shrunk = false;
  if (bytes <= SAFE_BYTES) return { page, bytes, fitted: true, shrunk };
  for (const opts of [{ max: 900, quality: .6 }, { max: 720, quality: .5 }, { max: 560, quality: .42 }]) {
    page = await compressFreePageImages(page, opts); shrunk = true;
    bytes = _utf8Len(JSON.stringify({ page }));
    if (bytes <= SAFE_BYTES) return { page, bytes, fitted: true, shrunk };
  }
  return { page, bytes, fitted: false, shrunk };
}

async function renderDiapo() {
  const content = document.getElementById('main-content');
  if (!content) return;
  try { _deck = (await getDocData('diapo', DOC_ID))?.page || null; }
  catch { _deck = null; }
  if (_editing && !STATE.isAdmin) _editing = false;   // garde-fou : seul le MJ édite
  content.innerHTML = _renderShell();
  if (_editing) bindFreePageEditor(document.getElementById('diapo-root'));
}

function _renderShell() {
  const isAdmin = STATE.isAdmin;
  if (_editing && isAdmin) {
    return `<div class="diapo-shell is-editing" id="diapo-root">
      <div class="diapo-topbar">
        <div class="diapo-title"><span class="diapo-kicker">Diaporama</span><h1>Édition</h1></div>
        <div class="diapo-actions">
          <button class="btn btn-outline btn-sm" data-action="diapoCancel">Annuler</button>
          <button class="btn btn-gold btn-sm" data-action="diapoSave">Enregistrer</button>
        </div>
      </div>
      ${freePageEditorHtml({ id: 'diapo-editor', page: _deck })}
    </div>`;
  }

  const hasContent = hasFreePage(_deck);
  return `<div class="diapo-shell" id="diapo-root">
    ${isAdmin ? `<div class="diapo-topbar">
      <div class="diapo-title"><span class="diapo-kicker">Diaporama</span><h1>Diapo</h1></div>
      <div class="diapo-actions">
        <button class="btn btn-gold btn-sm" data-action="diapoEdit">${hasContent ? '🖉 Modifier' : '＋ Composer le diaporama'}</button>
      </div>
    </div>` : ''}
    <div class="diapo-stage">
      ${hasContent
        ? renderFreePageHtml({ page: _deck, className: 'diapo-reader' })
        : `<div class="diapo-empty">
            <div class="diapo-empty-ico">🎞️</div>
            <p>${isAdmin ? 'Aucun diaporama pour le moment. Clique sur « Composer le diaporama » pour le créer.' : 'Le MJ n’a pas encore publié de diaporama.'}</p>
          </div>`}
    </div>
  </div>`;
}

function diapoEdit() {
  if (!STATE.isAdmin) return;
  _editing = true;
  renderDiapo();
}

function diapoCancel() {
  _editing = false;
  renderDiapo();
}

async function diapoSave() {
  if (!STATE.isAdmin) return;
  const page = getFreePageData(document.getElementById('diapo-editor'));
  if (!page) return showNotif('Éditeur de diaporama indisponible.', 'error');
  const fit = await _fitDiapo(page);
  if (!fit.fitted) {
    return showNotif(`Ce diaporama est trop lourd (~${Math.round(fit.bytes / 1024)} Ko pour une limite de ~${Math.round(SAFE_BYTES / 1024)} Ko). Retire une image ou une diapo.`, 'error');
  }
  try {
    await saveDoc('diapo', DOC_ID, { page: fit.page, updatedAt: Date.now() });
  } catch (e) {
    console.error('[diapo save]', e);
    const denied = String(e?.code || '') === 'permission-denied' || /permission|denied|insufficient/i.test(String(e?.message || ''));
    return showNotif(denied
      ? 'Écriture refusée : déploie la règle Firestore « diapo » (voir docs/firestore-rules.md).'
      : 'Le diaporama n’a pas pu être enregistré.', 'error');
  }
  _deck = fit.page;
  _editing = false;
  if (fit.shrunk) showNotif('Images recompressées pour tenir dans la limite Firestore.', 'info');
  showNotif('Diaporama enregistré.', 'success');
  renderDiapo();
}

PAGES.diapo = renderDiapo;

registerActions({
  diapoEdit:   () => diapoEdit(),
  diapoCancel: () => diapoCancel(),
  diapoSave:   () => diapoSave(),
});
