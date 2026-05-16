// ══════════════════════════════════════════════
// export.js — Export d'une fiche personnage
//   - JSON : backup restaurable (en cas de perte Firebase)
//   - PDF  : feuille dédiée print + window.print()
// ══════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc, _nl2br } from '../../shared/html.js';
import {
  getMod, calcCA, calcVitesse, calcPVMax, calcPMMax, calcOr, calcPalier,
  formatItemBonusText, STAT_META,
} from '../../shared/char-stats.js';
import { getArmorSetData, getMainWeapon, getWeaponToucherParts, getWeaponDegatsParts } from './data.js';

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

// ─── Builders de la feuille print ──────────────────────────────────────────

function _pctBar(cur, max, color = '#222') {
  const pct = Math.max(0, Math.min(100, max > 0 ? Math.round((cur / max) * 100) : 0));
  return `<div class="ps-bar"><div class="ps-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

function _modStr(m) { return (m >= 0 ? '+' : '') + m; }

function _buildHeader(c) {
  const titres = (c.titres || []).slice(0, 6);
  const photoBlock = c.photo
    ? `<img class="ps-photo" src="${c.photo}" style="object-position:${50+(c.photoX||0)*50}% ${50+(c.photoY||0)*50}%">`
    : `<div class="ps-photo ps-photo-empty">${(c.nom || '?')[0].toUpperCase()}</div>`;
  return `
    <header class="ps-header">
      ${photoBlock}
      <div class="ps-hd-body">
        <div class="ps-hd-name">${_esc(c.nom || 'Sans nom')}</div>
        <div class="ps-hd-meta">
          <span class="ps-chip ps-chip-niveau">Niveau ${c.niveau || 1}</span>
          ${c.classe ? `<span class="ps-chip">${_esc(c.classe)}</span>` : ''}
          ${c.race   ? `<span class="ps-chip">${_esc(c.race)}</span>` : ''}
        </div>
        ${titres.length ? `<div class="ps-hd-titles">${titres.map(t => `<span class="ps-title">${_esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </header>`;
}

function _buildVitals(c) {
  const pvMax = calcPVMax(c), pmMax = calcPMMax(c);
  const pv    = c.pvActuel ?? pvMax;
  const pm    = c.pmActuel ?? pmMax;
  const xp    = c.exp || 0;
  const xpMax = calcPalier(c.niveau || 1);
  const or    = calcOr(c);
  return `
    <section class="ps-vitals">
      <div class="ps-vital ps-vital--pv">
        <div class="ps-vital-lbl">Points de Vie</div>
        <div class="ps-vital-val">${pv} <span class="ps-vital-max">/ ${pvMax}</span></div>
        ${_pctBar(pv, pvMax, '#b33')}
      </div>
      <div class="ps-vital ps-vital--pm">
        <div class="ps-vital-lbl">Points de Mana</div>
        <div class="ps-vital-val">${pm} <span class="ps-vital-max">/ ${pmMax}</span></div>
        ${_pctBar(pm, pmMax, '#3a6db5')}
      </div>
      <div class="ps-vital ps-vital--ca">
        <div class="ps-vital-lbl">Classe d'Armure</div>
        <div class="ps-vital-val ps-vital-num">${calcCA(c)}</div>
      </div>
      <div class="ps-vital ps-vital--vit">
        <div class="ps-vital-lbl">Vitesse</div>
        <div class="ps-vital-val ps-vital-num">${calcVitesse(c)}<span class="ps-vital-unit">m</span></div>
      </div>
      <div class="ps-vital ps-vital--or">
        <div class="ps-vital-lbl">Or</div>
        <div class="ps-vital-val ps-vital-num">${or}</div>
      </div>
      <div class="ps-vital ps-vital--xp">
        <div class="ps-vital-lbl">Expérience</div>
        <div class="ps-vital-val ps-vital-xp">${xp} <span class="ps-vital-max">/ ${xpMax}</span></div>
        ${_pctBar(xp, xpMax, '#888')}
      </div>
    </section>`;
}

function _buildStats(c) {
  const s  = c.stats || {};
  const sb = c.statsBonus || {};
  return `
    <section class="ps-section">
      <h2 class="ps-section-title">Caractéristiques</h2>
      <div class="ps-stats-grid">
        ${STAT_META.map(st => {
          const base = s[st.key] || 8;
          const bonus = sb[st.key] || 0;
          const total = base + bonus;
          const mod = getMod(c, st.key);
          return `<div class="ps-stat">
            <div class="ps-stat-name">${st.label}</div>
            <div class="ps-stat-mod">${_modStr(mod)}</div>
            <div class="ps-stat-total">${total}${bonus ? ` <span class="ps-stat-bonus">(${base}${bonus>0?'+':''}${bonus})</span>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

function _buildWeapons(c) {
  const equip = c.equipement || {};
  const slots = ['Main principale', 'Main secondaire'];
  const items = slots.map(slot => {
    const raw = equip[slot] || {};
    const item = (slot === 'Main principale' && !raw.nom) ? getMainWeapon(c) : raw;
    return { slot, item };
  }).filter(({ item }) => item && item.nom);

  if (!items.length) return '';
  return `
    <section class="ps-section">
      <h2 class="ps-section-title">Armement</h2>
      <table class="ps-table">
        <thead>
          <tr><th>Slot</th><th>Arme</th><th>Toucher</th><th>Dégâts</th></tr>
        </thead>
        <tbody>
          ${items.map(({ slot, item }) => {
            const statKey = item.statAttaque === 'dexterite' ? 'dexterite'
                          : item.statAttaque === 'intelligence' ? 'intelligence' : 'force';
            let tStr = '—', dStr = '—';
            try { const tp = getWeaponToucherParts(c, item, statKey); if (tp?.roll) tStr = tp.roll; } catch {}
            try { const dp = getWeaponDegatsParts(c, item, statKey); if (dp?.roll) dStr = dp.roll; } catch {}
            return `<tr>
              <td class="ps-td-muted">${_esc(slot)}</td>
              <td><strong>${_esc(item.nom)}</strong>${item.degatsType ? ` <span class="ps-td-muted">· ${_esc(item.degatsType)}</span>` : ''}</td>
              <td class="ps-td-num">${_esc(tStr)}</td>
              <td class="ps-td-num">${_esc(dStr)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>`;
}

function _buildArmor(c) {
  const equip = c.equipement || {};
  const slots = ['Casque', 'Torse', 'Pieds', 'Bouclier', 'Cape', 'Accessoire 1', 'Accessoire 2'];
  const items = slots
    .map(slot => ({ slot, item: equip[slot] }))
    .filter(({ item }) => item && item.nom);

  const setData = getArmorSetData(c);
  const setName = setData?.name && setData.completion >= 2
    ? `${setData.name} (${setData.completion} pièces)` : null;

  if (!items.length && !setName) return '';
  return `
    <section class="ps-section">
      <h2 class="ps-section-title">Équipement</h2>
      ${setName ? `<div class="ps-armor-set">⚜ Set : ${_esc(setName)}</div>` : ''}
      <table class="ps-table">
        <tbody>
          ${items.map(({ slot, item }) => {
            const bonus = formatItemBonusText(item);
            return `<tr>
              <td class="ps-td-muted" style="width:32%">${_esc(slot)}</td>
              <td><strong>${_esc(item.nom)}</strong>${bonus ? ` <span class="ps-td-muted">· ${_esc(bonus)}</span>` : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>`;
}

function _buildSpells(c) {
  const sorts = (c.deck_sorts || []).filter(s => s.actif);
  if (!sorts.length) return '';
  return `
    <section class="ps-section ps-section--spells">
      <h2 class="ps-section-title">Sorts actifs <span class="ps-section-count">${sorts.length}</span></h2>
      <div class="ps-spells">
        ${sorts.map(s => {
          const cost = s.cout != null ? `${s.cout} PM` : '';
          const noyau = s.noyauNom || s.noyau || '';
          return `<div class="ps-spell">
            <div class="ps-spell-hd">
              <span class="ps-spell-ico">${s.icone || '✨'}</span>
              <span class="ps-spell-name">${_esc(s.nom || 'Sort sans nom')}</span>
              ${cost ? `<span class="ps-spell-cost">${cost}</span>` : ''}
            </div>
            ${noyau ? `<div class="ps-spell-noyau">${_esc(noyau)}</div>` : ''}
            ${s.description ? `<div class="ps-spell-desc">${_esc(s.description)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

function _buildMaitrises(c) {
  const ms = c.maitrises || [];
  if (!ms.length) return '';
  return `
    <section class="ps-section">
      <h2 class="ps-section-title">Maîtrises <span class="ps-section-count">${ms.length}</span></h2>
      <ul class="ps-maitrises">
        ${ms.map(m => {
          const niv = m.niveau ? ` <span class="ps-td-muted">· Niv. ${m.niveau}</span>` : '';
          return `<li><strong>${_esc(m.nom || '—')}</strong>${niv}${m.description ? ` — ${_esc(m.description)}` : ''}</li>`;
        }).join('')}
      </ul>
    </section>`;
}

function _buildNotes(c) {
  const profil = c.profil || {};
  const bio = profil.biographie || profil.bio || c.bio || '';
  const traits = profil.traits || [];
  if (!bio && !traits.length) return '';
  return `
    <section class="ps-section">
      <h2 class="ps-section-title">Présentation</h2>
      ${traits.length ? `<div class="ps-traits">${traits.slice(0, 12).map(t => `<span class="ps-trait">${_esc(t)}</span>`).join('')}</div>` : ''}
      ${bio ? `<div class="ps-bio">${_nl2br(_esc(bio))}</div>` : ''}
    </section>`;
}

function _buildPrintSheet(c) {
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `
    <div class="ps-page">
      ${_buildHeader(c)}
      ${_buildVitals(c)}
      ${_buildStats(c)}
      <div class="ps-two-col">
        <div class="ps-col">
          ${_buildWeapons(c)}
          ${_buildArmor(c)}
        </div>
        <div class="ps-col">
          ${_buildMaitrises(c)}
        </div>
      </div>
      ${_buildSpells(c)}
      ${_buildNotes(c)}
      <footer class="ps-footer">
        <span>Le Grand JDR</span>
        <span>Fiche imprimée le ${today}</span>
      </footer>
    </div>`;
}

/** Export PDF — ouvre une fenêtre dédiée propre, sans interférence avec l'app. */
export function exportCharPDF(charId) {
  const c = _findChar(charId);
  if (!c) { showNotif('Personnage introuvable', 'error'); return; }

  let body = '';
  try { body = _buildPrintSheet(c); }
  catch (e) {
    console.error('[export PDF] build error:', e);
    showNotif('Erreur génération PDF : ' + (e?.message || e), 'error');
    return;
  }
  if (!body || !body.trim()) { showNotif('Erreur : feuille vide', 'error'); return; }

  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) {
    showNotif('Impossible d\'ouvrir la fenêtre d\'impression (popup bloquée ?)', 'error');
    return;
  }

  const title = `Fiche — ${c.nom || 'Personnage'}`;
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${_esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
${_printSheetCSS()}
</style>
</head>
<body>
${body}
<script>
window.addEventListener('load', () => setTimeout(() => { window.focus(); window.print(); }, 300));
window.addEventListener('afterprint', () => setTimeout(() => window.close(), 100));
</`+`script>
</body>
</html>`);
  win.document.close();
}

/** Renvoie toute la CSS de la feuille print, inlinée dans la fenêtre dédiée. */
function _printSheetCSS() {
  return `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: #fff; color: #14110b;
  font-family: 'Inter', 'Helvetica', sans-serif;
  font-size: 10.5pt;
  line-height: 1.4;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.ps-page { max-width: 100%; padding: 14pt; color: #14110b; }

/* HEADER */
.ps-header {
  display: flex; gap: 14pt; align-items: stretch;
  border-bottom: 2.5pt solid #c9a85b;
  padding-bottom: 10pt; margin-bottom: 12pt;
  page-break-inside: avoid; break-inside: avoid;
}
.ps-photo {
  width: 86pt; height: 86pt; border-radius: 6pt;
  object-fit: cover; border: 1.5pt solid #c9a85b;
  background: #f3ead3; flex-shrink: 0;
}
.ps-photo-empty {
  display: flex; align-items: center; justify-content: center;
  font-family: 'Cinzel', serif; font-size: 42pt; font-weight: 700; color: #c9a85b;
}
.ps-hd-body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 5pt; }
.ps-hd-name {
  font-family: 'Cinzel', serif; font-size: 26pt; font-weight: 700;
  line-height: 1.05; color: #2a1d05; letter-spacing: 0.5pt; margin: 0;
}
.ps-hd-meta { display: flex; flex-wrap: wrap; gap: 5pt; align-items: center; }
.ps-chip {
  font-size: 9pt; font-weight: 600; padding: 2pt 9pt;
  border-radius: 999pt; border: 0.8pt solid #9d8350;
  color: #5c4720; background: #faf5e6;
}
.ps-chip-niveau { background: #c9a85b; color: #fff; border-color: #9d8350; }
.ps-hd-titles { display: flex; flex-wrap: wrap; gap: 4pt; }
.ps-title {
  font-size: 8pt; font-style: italic; padding: 2pt 7pt;
  border-radius: 3pt; background: #f3ead3; color: #7a5a17;
  border-left: 2pt solid #c9a85b;
}

/* VITALS */
.ps-vitals {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 6pt;
  margin-bottom: 12pt; page-break-inside: avoid; break-inside: avoid;
}
.ps-vital {
  border: 0.8pt solid #b89c5a; border-radius: 5pt;
  padding: 6pt 7pt 7pt; background: #fefcf6;
  text-align: center; display: flex; flex-direction: column; gap: 3pt;
}
.ps-vital-lbl {
  font-size: 7pt; text-transform: uppercase; letter-spacing: 0.6pt;
  color: #7a5a17; font-weight: 700;
}
.ps-vital-val {
  font-family: 'Cinzel', serif; font-size: 14pt; font-weight: 700;
  color: #2a1d05; line-height: 1;
}
.ps-vital-num { font-size: 18pt; }
.ps-vital-max { font-size: 9pt; font-weight: 500; color: #8a7340; }
.ps-vital-unit { font-size: 9pt; font-weight: 500; color: #8a7340; }
.ps-vital-xp { font-size: 12pt; }
.ps-vital--pv { background: #fdf4f4; border-color: #c87a7a; }
.ps-vital--pv .ps-vital-lbl { color: #8e3a3a; }
.ps-vital--pv .ps-vital-val { color: #6b1f1f; }
.ps-vital--pm { background: #f3f6fc; border-color: #7a99cf; }
.ps-vital--pm .ps-vital-lbl { color: #2a4a7a; }
.ps-vital--pm .ps-vital-val { color: #1c3458; }
.ps-vital--ca { background: #f6f1e6; }
.ps-vital--or .ps-vital-val { color: #8a5d1a; }

.ps-bar {
  height: 5pt; background: #ebe1c6; border-radius: 2pt;
  overflow: hidden; border: 0.4pt solid rgba(0,0,0,0.08);
}
.ps-bar-fill { height: 100%; }

/* SECTIONS */
.ps-section { margin-bottom: 12pt; page-break-inside: avoid; break-inside: avoid; }
.ps-section-title {
  font-family: 'Cinzel', serif; font-size: 13pt; font-weight: 700;
  color: #5c4720; margin: 0 0 6pt 0; padding-bottom: 3pt;
  border-bottom: 1pt solid #c9a85b; letter-spacing: 0.5pt;
  text-transform: uppercase; display: flex; align-items: baseline; gap: 6pt;
}
.ps-section-count {
  font-family: 'Inter', sans-serif; font-size: 8.5pt; font-weight: 500;
  color: #9a7e3a; text-transform: none; letter-spacing: 0;
}

/* STATS */
.ps-stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6pt; }
.ps-stat {
  border: 0.8pt solid #b89c5a; border-radius: 5pt;
  padding: 6pt; text-align: center; background: #fefcf6;
}
.ps-stat-name {
  font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.5pt;
  color: #7a5a17; font-weight: 700;
}
.ps-stat-mod {
  font-family: 'Cinzel', serif; font-size: 20pt; font-weight: 700;
  line-height: 1; color: #2a1d05; margin: 5pt 0 2pt;
}
.ps-stat-total { font-size: 8.5pt; color: #7a5a17; }
.ps-stat-bonus { font-size: 7.5pt; color: #9a7e3a; }

/* TABLES */
.ps-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.ps-table thead th {
  text-align: left; font-size: 8pt; text-transform: uppercase;
  letter-spacing: 0.4pt; color: #7a5a17;
  border-bottom: 0.8pt solid #c9a85b;
  padding: 4pt 5pt 3pt; font-weight: 700;
}
.ps-table tbody td {
  padding: 5pt; border-bottom: 0.4pt solid #e8dcb5; vertical-align: top;
  color: #2a1d05;
}
.ps-table tbody tr:last-child td { border-bottom: none; }
.ps-td-muted { color: #7a5a17; font-size: 9pt; }
.ps-td-num {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-weight: 600; text-align: right; white-space: nowrap;
}
.ps-armor-set {
  font-style: italic; color: #7a5a17; font-size: 9.5pt;
  margin-bottom: 5pt; padding: 4pt 7pt;
  background: #f3ead3; border-left: 2pt solid #c9a85b; border-radius: 2pt;
}

/* TWO COLUMNS */
.ps-two-col {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; margin-bottom: 6pt;
}
.ps-col { display: flex; flex-direction: column; }
.ps-col .ps-section { margin-bottom: 10pt; }

/* SPELLS */
.ps-spells { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6pt; }
.ps-spell {
  border: 0.6pt solid #b89c5a; border-radius: 5pt;
  padding: 6pt 8pt; background: #fefcf6;
  page-break-inside: avoid; break-inside: avoid;
}
.ps-spell-hd { display: flex; align-items: baseline; gap: 5pt; margin-bottom: 3pt; }
.ps-spell-ico { font-size: 11pt; }
.ps-spell-name {
  font-family: 'Cinzel', serif; font-size: 10.5pt; font-weight: 700;
  color: #2a1d05; flex: 1;
}
.ps-spell-cost {
  font-family: 'JetBrains Mono', monospace; font-size: 8pt; font-weight: 700;
  padding: 1pt 6pt; border-radius: 2pt; background: #3a6db5; color: #fff;
}
.ps-spell-noyau { font-size: 8pt; color: #7a5a17; font-style: italic; margin-bottom: 3pt; }
.ps-spell-desc { font-size: 8.5pt; color: #3a2c10; line-height: 1.4; }

/* MAITRISES */
.ps-maitrises {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 3pt;
}
.ps-maitrises li {
  font-size: 9.5pt; padding: 3pt 0;
  border-bottom: 0.4pt dotted #c9a85b; line-height: 1.4;
  color: #2a1d05;
}
.ps-maitrises li:last-child { border-bottom: none; }
.ps-maitrises strong { color: #2a1d05; }

/* NOTES */
.ps-traits { display: flex; flex-wrap: wrap; gap: 4pt; margin-bottom: 6pt; }
.ps-trait {
  font-size: 8pt; padding: 2pt 7pt;
  background: #f3ead3; border-radius: 999pt; color: #5c4720;
}
.ps-bio {
  font-size: 9.5pt; line-height: 1.5; color: #3a2c10; text-align: justify;
}

/* FOOTER */
.ps-footer {
  margin-top: 14pt; padding-top: 6pt; border-top: 0.6pt solid #c9a85b;
  display: flex; justify-content: space-between;
  font-size: 8pt; color: #9a7e3a; font-style: italic;
}
`;
}

/** Affiche un mini-menu Export (JSON / PDF) ancré au bouton. */
export function openCharExportMenu(charId, btn) {
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
        <small>feuille complète mise en page</small>
      </span>
    </button>
  `;

  const wrap = btn.parentNode;
  if (wrap && getComputedStyle(wrap).position === 'static') {
    wrap.style.position = 'relative';
  }
  wrap.appendChild(menu);

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
