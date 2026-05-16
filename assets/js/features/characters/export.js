// ══════════════════════════════════════════════
// export.js — Export d'une fiche personnage
//   - JSON : backup restaurable (en cas de perte Firebase)
//   - PDF  : via window.print() + feuille de style print
// ══════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { showNotif } from '../../shared/notifications.js';

const EXPORT_VERSION = 1;

function _downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 100);
}

function _slug(s) {
  return String(s || 'sans-nom')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fiche';
}

function _findChar(charId) {
  return (STATE.characters || []).find(x => x.id === charId) || STATE.activeChar || null;
}

/** Export JSON — sauvegarde restaurable du personnage. */
export function exportCharJSON(charId) {
  const c = _findChar(charId);
  if (!c) { showNotif('Personnage introuvable', 'error'); return; }
  const payload = {
    type: 'le-grand-jdr.character',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    character: c,
  };
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${_slug(c.nom)}-${date}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  _downloadBlob(filename, blob);
  showNotif(`💾 ${filename} téléchargé`, 'success');
}

/** Export PDF — déclenche l'impression du navigateur (feuille print.css active). */
export function exportCharPDF(charId) {
  const c = _findChar(charId);
  if (!c) { showNotif('Personnage introuvable', 'error'); return; }
  document.body.classList.add('print-character');
  const cleanup = () => {
    document.body.classList.remove('print-character');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // léger délai pour laisser le DOM appliquer la classe avant le dialog
  setTimeout(() => {
    try { window.print(); }
    catch (e) { cleanup(); showNotif('Impression impossible : ' + (e?.message || e), 'error'); }
  }, 80);
}

/** Affiche un mini-menu Export (JSON / PDF) ancré au bouton. */
export function openCharExportMenu(charId, btn) {
  // ferme tout menu déjà ouvert
  document.querySelectorAll('.cs-export-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'cs-export-menu';
  menu.innerHTML = `
    <button class="cs-export-opt" onclick="exportCharJSON('${charId}'); this.closest('.cs-export-menu').remove();">
      <span class="cs-export-opt-ico">💾</span>
      <span class="cs-export-opt-txt">
        <strong>Sauvegarde JSON</strong>
        <small>fichier restaurable (backup)</small>
      </span>
    </button>
    <button class="cs-export-opt" onclick="exportCharPDF('${charId}'); this.closest('.cs-export-menu').remove();">
      <span class="cs-export-opt-ico">🖨️</span>
      <span class="cs-export-opt-txt">
        <strong>Imprimer / PDF</strong>
        <small>impression de la fiche</small>
      </span>
    </button>
  `;

  // ancrer dans le parent du bouton (qui est déjà position:relative dans cs-name-row)
  const wrap = btn.parentNode;
  if (wrap && getComputedStyle(wrap).position === 'static') {
    wrap.style.position = 'relative';
  }
  wrap.appendChild(menu);

  // fermer au clic extérieur (sur la frame suivante pour ne pas attraper le clic d'ouverture)
  setTimeout(() => {
    const off = (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', off);
      }
    };
    document.addEventListener('click', off);
  }, 0);
}
