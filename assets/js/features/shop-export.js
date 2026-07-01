// ══════════════════════════════════════════════════════════════════════════════
// SHOP-EXPORT.JS — Export / Import de la boutique (JSON / CSV / Markdown)
//
// Extrait de shop.js. Module leaf : ne connaît pas l'état privé de shop.js, il
// reçoit un contexte injecté à l'ouverture de la modale :
//   openShopExport({ getCats, getItems, formatStatBonuses, onImported })
// Les handlers (tab/export/import) réutilisent ce contexte mémorisé.
// ══════════════════════════════════════════════════════════════════════════════
import { openModal, closeModalDirect } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { RARETE_NAMES } from '../shared/rarity.js';
import { statShort as _statShort } from '../shared/char-stats.js';
import { addToCol } from '../data/firestore.js';
import { _formatStatBonuses } from './shop-item-stats.js';

// Contexte injecté par shop.js (getters live + callback de re-render).
// Mémorisé pour les handlers déclenchés après l'ouverture.
let _ctx = { getCats: () => [], getItems: () => [], onImported: () => {} };
let _importData = null;

// Texte de stock (∞ / épuisé / n dispo) — utilisé uniquement par l'export Markdown.
function _getItemStockText(dispo) {
  if (dispo === null || dispo < 0) return '∞ Illimité';
  if (dispo === 0) return 'Épuisé';
  return `${dispo} dispo`;
}

export function openShopExport(ctx) {
  _ctx = ctx || _ctx;
  const cats = _ctx.getCats();
  const items = _ctx.getItems();
  const catRows = cats.map(cat => {
    const count = items.filter(i => i.categorieId === cat.id).length;
    return `<label class="sh-export-cat-row">
      <input type="checkbox" class="sh-export-cat-cb" value="${_esc(cat.id)}" checked>
      <span class="sh-export-cat-label">${_esc((cat.emoji || '') + ' ' + cat.nom)}</span>
      <span class="sh-export-cat-count">${count} article${count !== 1 ? 's' : ''}</span>
    </label>`;
  }).join('');

  openModal('', `
  <div class="sh-admin-modal is-upgrades">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">📦</div>
      <div class="sh-admin-head-title">
        <h2>Export / Import boutique</h2>
        <small>Sauvegarde ou restauration des catégories et articles</small>
      </div>
      <button class="sh-admin-close" data-sh-action="closeModal" title="Fermer">✕</button>
    </div>

    <!-- Onglets style propre -->
    <div class="sh-export-tabs">
      <button class="sh-export-tab sh-export-tab--active" id="sh-etab-export"
        data-sh-action="tabSwitch" data-tab="export">📤 Exporter</button>
      <button class="sh-export-tab" id="sh-etab-import"
        data-sh-action="tabSwitch" data-tab="import">📥 Importer</button>
    </div>

    <div class="sh-admin-body">
      <!-- ── Tab Export ───────────────────────────────────────── -->
      <div id="sh-tab-export">
        <div class="sh-admin-section">
          <div class="sh-admin-section-title">📚 Catégories à exporter</div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button class="btn btn-outline btn-sm" type="button"
              data-sh-action="exportSelectAll" data-all="true">✓ Tout cocher</button>
            <button class="btn btn-outline btn-sm" type="button"
              data-sh-action="exportSelectAll" data-all="false">✕ Tout décocher</button>
          </div>
          <div class="sh-export-cat-list">
            ${catRows || '<div style="text-align:center;padding:1rem;color:var(--text-dim);font-style:italic">Aucune catégorie.</div>'}
          </div>
        </div>

        <div class="sh-admin-section">
          <div class="sh-admin-section-title">📄 Format de sortie</div>
          <div class="sh-export-format-row">
            <label><input type="radio" name="sh-export-fmt" value="json" checked> <b>JSON</b> <small style="color:var(--text-dim)">(import réversible)</small></label>
            <label><input type="radio" name="sh-export-fmt" value="csv"> <b>CSV</b> <small style="color:var(--text-dim)">(tableur)</small></label>
            <label><input type="radio" name="sh-export-fmt" value="md"> <b>Markdown</b> <small style="color:var(--text-dim)">(documentation)</small></label>
          </div>
        </div>
      </div>

      <!-- ── Tab Import ───────────────────────────────────────── -->
      <div id="sh-tab-import" style="display:none">
        <div class="sh-admin-section">
          <div class="sh-admin-section-title">📥 Importer un export JSON</div>
          <p class="sh-admin-section-hint">
            Les catégories et articles seront <b>ajoutés sans écraser</b> l'existant. Tu pourras choisir quelles catégories importer.
          </p>
          <label style="display:block;margin-top:8px">
            <input type="file" id="sh-import-file" accept=".json"
              style="font-size:.82rem;color:var(--text);width:100%"
              data-sh-action="previewImport" data-sh-on="change">
          </label>
        </div>
        <div id="sh-import-preview"></div>
      </div>
    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-sh-action="closeModal">Fermer</button>
      <div class="sh-admin-footer-spacer"></div>
      <span id="sh-tab-export-actions">
        <button class="btn btn-gold btn-sm" data-sh-action="doExport">⬇️ Télécharger</button>
      </span>
      <span id="sh-tab-import-actions" style="display:none">
        <button class="btn btn-gold btn-sm" id="sh-import-confirm-btn"
          data-sh-action="doImport" disabled>📥 Importer</button>
      </span>
    </div>
  </div>
  `);
}

export function switchShopExportTab(tab) {
  const isExp = tab === 'export';
  document.getElementById('sh-tab-export').style.display = isExp ? '' : 'none';
  document.getElementById('sh-tab-import').style.display = isExp ? 'none' : '';
  document.getElementById('sh-etab-export').classList.toggle('sh-export-tab--active', isExp);
  document.getElementById('sh-etab-import').classList.toggle('sh-export-tab--active', !isExp);
  // Switch les boutons footer aussi
  const expActs = document.getElementById('sh-tab-export-actions');
  const impActs = document.getElementById('sh-tab-import-actions');
  if (expActs) expActs.style.display = isExp ? '' : 'none';
  if (impActs) impActs.style.display = isExp ? 'none' : '';
}

export function selectAllShopExport(checked) {
  document.querySelectorAll('.sh-export-cat-cb').forEach(cb => { cb.checked = checked; });
}

// ── Construction des données d'export ─────────────────────────────────────────
function _shopBuildExportData(catIds) {
  const cats = _ctx.getCats();
  const items = _ctx.getItems();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: cats
      .filter(c => catIds.includes(c.id))
      .map(cat => ({
        nom:      cat.nom,
        template: cat.template || 'classique',
        emoji:    cat.emoji    || '',
        items: items
          .filter(i => i.categorieId === cat.id)
          .map(item => {
            const exp = { nom: item.nom || '' };
            // Champs communs
            const fields = [
              'rarete','prix','dispo','image',
              'type','effet','description',
              'degats','degatsStats','degatsStat','toucherStat','toucher','portee',
              'format','sousType',
              'slotArmure','typeArmure','slotBijou',
              'ca','stats','traits',
              'for','dex','in','sa','co','ch',
            ];
            fields.forEach(f => { if (item[f] !== undefined) exp[f] = item[f]; });
            return exp;
          }),
      })),
  };
}

// ── Formateurs ─────────────────────────────────────────────────────────────────
function _shopExportToJson(data) {
  return JSON.stringify(data, null, 2);
}

function _shopExportToCsv(data) {
  const cols = [
    'categorie','template','nom','type','rarete','degats','degatsStats','toucherStat',
    'portee','format','sousType','slotArmure','typeArmure','slotBijou','ca',
    'for','dex','in','sa','co','ch','traits','effet','description','prix','dispo',
  ];
  const esc = v => {
    const s = v === undefined || v === null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [cols.join(',')];
  data.categories.forEach(cat => {
    cat.items.forEach(item => {
      rows.push(cols.map(c => {
        if (c === 'categorie') return esc(cat.nom);
        if (c === 'template')  return esc(cat.template);
        if (c === 'traits')    return esc(Array.isArray(item.traits) ? item.traits.join(' | ') : (item.traits || ''));
        if (c === 'degatsStats') return esc(Array.isArray(item.degatsStats) ? item.degatsStats.join('+') : (item.degatsStats || ''));
        return esc(item[c]);
      }).join(','));
    });
  });
  return rows.join('\n');
}

function _shopExportToMd(data) {
  const rarName = r => RARETE_NAMES[parseInt(r)] || '';
  const lines = [
    `# Export Boutique`,
    `*Exporté le ${new Date().toLocaleDateString('fr-FR')} — ${data.categories.reduce((a, c) => a + c.items.length, 0)} articles*`,
    '',
  ];
  data.categories.forEach(cat => {
    lines.push(`## ${cat.emoji || ''} ${cat.nom}`.trim(), '');
    if (!cat.items.length) { lines.push('*Aucun article.*', ''); return; }
    cat.items.forEach(item => {
      lines.push(`### ${item.nom}`);
      if (item.rarete)      lines.push(`- **Rareté** : ${rarName(item.rarete)}`);
      if (item.type)        lines.push(`- **Type** : ${item.type}`);
      if (item.degats) {
        const mods = Array.isArray(item.degatsStats) ? item.degatsStats.map(s => `+${_statShort(s)}`).join('') : '';
        lines.push(`- **Dégâts** : ${item.degats}${mods}`);
      }
      if (item.toucherStat) lines.push(`- **Toucher** : +${_statShort(item.toucherStat)}`);
      if (item.portee)      lines.push(`- **Portée** : ${item.portee}`);
      if (item.ca)          lines.push(`- **CA bonus** : ${item.ca}`);
      if (item.slotArmure)  lines.push(`- **Emplacement** : ${item.slotArmure} (${item.typeArmure || ''})`);
      if (item.slotBijou)   lines.push(`- **Slot** : ${item.slotBijou}`);
      const bonuses = _formatStatBonuses(item);
      if (bonuses.length)   lines.push(`- **Bonus** : ${bonuses.join(' · ')}`);
      const traits = Array.isArray(item.traits) ? item.traits : [];
      if (traits.length)    lines.push(`- **Traits** : ${traits.join(', ')}`);
      if (item.effet)       lines.push(`- **Effet** : ${item.effet}`);
      if (item.description) lines.push(`- **Description** : ${item.description}`);
      const dispo = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
      lines.push(`- **Prix** : ${item.prix || 0} or · **Stock** : ${_getItemStockText(dispo)}`);
      lines.push('');
    });
  });
  return lines.join('\n');
}

function _shopDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

export function doShopExport() {
  const catIds = [...document.querySelectorAll('.sh-export-cat-cb:checked')].map(cb => cb.value);
  if (!catIds.length) { showNotif('Sélectionne au moins une catégorie.', 'error'); return; }
  const fmt  = document.querySelector('input[name="sh-export-fmt"]:checked')?.value || 'json';
  const data = _shopBuildExportData(catIds);
  const date = new Date().toISOString().slice(0, 10);
  if (fmt === 'json') {
    _shopDownload(`boutique-${date}.json`, _shopExportToJson(data), 'application/json');
  } else if (fmt === 'csv') {
    _shopDownload(`boutique-${date}.csv`, _shopExportToCsv(data), 'text/csv;charset=utf-8');
  } else {
    _shopDownload(`boutique-${date}.md`, _shopExportToMd(data), 'text/markdown;charset=utf-8');
  }
  showNotif('Fichier exporté !', 'success');
}

// ── Import ─────────────────────────────────────────────────────────────────────
export function previewShopImport(input) {
  const file = input.files?.[0];
  const preview  = document.getElementById('sh-import-preview');
  const importBtn = document.getElementById('sh-import-confirm-btn');
  _importData = null;
  if (importBtn) importBtn.disabled = true;
  if (!file) { if (preview) preview.innerHTML = ''; return; }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data?.categories?.length) throw new Error('Format invalide');
      _importData = data;
      const rows = data.categories.map(cat => {
        const n = cat.items?.length || 0;
        return `<label class="sh-export-cat-row">
          <input type="checkbox" class="sh-import-cat-cb" value="${_esc(cat.nom)}" checked>
          <span class="sh-export-cat-label">${_esc((cat.emoji || '') + ' ' + cat.nom)}</span>
          <span class="sh-export-cat-count">${n} article${n !== 1 ? 's' : ''}</span>
        </label>`;
      }).join('');
      if (preview) preview.innerHTML = `
        <div class="sh-admin-section" style="margin-top:10px">
          <div class="sh-admin-section-title">
            <span style="color:var(--emerald, #22c38e)">✓ ${data.categories.length} catégorie${data.categories.length>1?'s':''} trouvée${data.categories.length>1?'s':''}</span>
          </div>
          <p class="sh-admin-section-hint">Coche celles à importer :</p>
          <div class="sh-export-cat-list">${rows}</div>
        </div>`;
      if (importBtn) importBtn.disabled = false;
    } catch {
      if (preview) preview.innerHTML = `
        <div class="sh-admin-section" style="margin-top:10px;border-color:rgba(255,90,126,.30);background:rgba(255,90,126,.06)">
          <p style="color:var(--crimson-light, #ff8ca7);font-size:.82rem;margin:0">
            ⚠️ Fichier invalide. Utilise un JSON exporté depuis cette boutique.
          </p>
        </div>`;
    }
  };
  reader.readAsText(file);
}

export async function doShopImport() {
  if (!_importData) return;
  const selected = new Set(
    [...document.querySelectorAll('.sh-import-cat-cb:checked')].map(cb => cb.value)
  );
  if (!selected.size) { showNotif('Sélectionne au moins une catégorie.', 'error'); return; }

  const toImport = _importData.categories.filter(c => selected.has(c.nom));
  const baseOrdre = _ctx.getCats().length;
  let catCount = 0, itemCount = 0;

  try {
    for (const cat of toImport) {
      const newCatId = await addToCol('shopCategories', {
        nom:      cat.nom,
        template: cat.template || 'classique',
        emoji:    cat.emoji || '',
        image:    '',
        ordre:    baseOrdre + catCount,
        sousCats: [],
      });
      catCount++;
      for (const item of (cat.items || [])) {
        await addToCol('shop', { ...item, categorieId: newCatId, ordre: itemCount });
        itemCount++;
      }
    }
    showNotif(`Import terminé : ${catCount} catégorie(s), ${itemCount} article(s).`, 'success');
    _importData = null;
    closeModalDirect();
    await _ctx.onImported();
  } catch (e) {
    console.error('[import]', e);
    showNotif('Erreur lors de l\'import.', 'error');
  }
}
