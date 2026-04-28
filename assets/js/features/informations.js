import { STATE } from '../core/state.js';
import { saveDoc, getDocData } from '../data/firestore.js';
import { openModal, closeModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { richTextEditorHtml, bindRichTextEditors, getRichTextHtml, sanitizeRichTextHtml, richTextContentHtml } from '../shared/rich-text.js';
import PAGES from './pages.js';

async function renderInformations() {
  const doc = await getDocData('informations', 'main');
  const content = document.getElementById('main-content');
  const sections = Array.isArray(doc?.sections) ? doc.sections.filter((section) => section?.id) : [];
  // Si la section mémorisée n'existe plus (suppression / changement de doc),
  // on retombe sur la première disponible.
  const wanted = window._infoSection;
  const activeSection = (wanted && sections.some(s => s.id === wanted))
    ? wanted
    : sections[0]?.id;
  window._infoSection = activeSection;
  const activeContent = sections.find(s => s.id === activeSection)?.content || '';
  const hasSections = sections.length > 0;
  const navHtml = sections.map(s => `<div class="tutorial-nav-item ${s.id === activeSection ? 'active' : ''}" onclick="showInfoSection(${jsAttrString(s.id)},this)">${_esc(s.title)}</div>`).join('');
  const emptyHtml = `<div style="text-align:center;padding:3rem 2rem;color:var(--text-dim);border:1px dashed var(--border);border-radius:var(--radius-lg);background:var(--bg-card)">
    <div style="font-size:2rem;margin-bottom:.7rem;opacity:.45">📋</div>
    <p style="font-size:.9rem;margin:0">${STATE.isAdmin ? 'Aucune section en base. Ajoute la première section pour publier les informations.' : 'Aucune information publiée pour le moment.'}</p>
  </div>`;
  content.innerHTML = `<div class="page-header"><div class="page-title"><span class="page-title-accent">📋 Informations du JDR</span></div><div class="page-subtitle">Règles, mécaniques et lore du monde</div></div>
    ${STATE.isAdmin ? `<div class="admin-section"><div class="admin-label">Admin — Modification du contenu</div><div style="display:flex;gap:0.5rem;flex-wrap:wrap">${hasSections ? `<button class="btn btn-gold btn-sm" onclick="editInfoSection(window._infoSection)">✏️ Modifier cette section</button>` : ''}<button class="btn btn-gold btn-sm" onclick="addInfoSection()">➕ Ajouter une section</button></div></div>` : ''}
    ${hasSections ? `<div class="grid-2 tutorial-layout-grid" style="gap:1.5rem;align-items:start">
      <div><div class="tutorial-nav" id="info-nav">${navHtml}</div></div>
      <div>${richTextContentHtml({ html: activeContent, className: 'tutorial-content', attrs: { id: 'info-content', style: 'white-space:pre-wrap' } })}</div>
    </div>` : emptyHtml}`;
  window._infoSections = sections;
}

function showInfoSection(id, el) {
  document.querySelectorAll('#info-nav .tutorial-nav-item').forEach((item) => item.classList.remove('active'));
  el?.classList.add('active');
  window._infoSection = id;
  const section = (window._infoSections || []).find((entry) => entry.id === id);
  const contentEl = document.getElementById('info-content');
  if (contentEl && section) contentEl.innerHTML = sanitizeRichTextHtml(section.content || '');
}

function _openSectionEditor({ title, editorId, titleId, titleLabel = 'Titre', initialTitle = '', initialContent = '', titlePlaceholder = '', actions = '' }) {
  const titlePh = titlePlaceholder ? ` placeholder="${_esc(titlePlaceholder)}"` : '';
  openModal(title, `
    <div class="form-group"><label>${titleLabel}</label>
      <input type="text" class="input-field" id="${titleId}" value="${_esc(initialTitle)}"${titlePh}>
    </div>
    <div class="form-group"><label>Contenu</label>
      ${richTextEditorHtml({ id: editorId, html: initialContent, placeholder: 'Contenu de la section…', minHeight: 280 })}
    </div>
    ${actions}
  `);
  bindRichTextEditors();
}

function editInfoSection(id) {
  const section = (window._infoSections || []).find((entry) => entry.id === id);
  if (!section) return;
  _openSectionEditor({
    title: `✏️ Modifier - ${section.title}`,
    editorId: 'info-edit-content',
    titleId: 'info-edit-title',
    initialTitle: section.title,
    initialContent: section.content || '',
    actions: `<div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveInfoSection('${id}')">Enregistrer</button>
      <button class="btn btn-danger" onclick="deleteInfoSection('${id}')">🗑️ Supprimer</button>
    </div>`,
  });
}

async function saveInfoSection(id) {
  try {
    const sections = [...(window._infoSections || [])];
    const index = sections.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const newTitle = document.getElementById('info-edit-title')?.value.trim() || sections[index].title;
    const newContent = getRichTextHtml('info-edit-content');
    sections[index] = { ...sections[index], title: newTitle, content: newContent };
    window._infoSections = sections;
    await saveDoc('informations', 'main', { sections });
    closeModal();
    showNotif('Section mise à jour.', 'success');
    await PAGES.informations();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

function addInfoSection() {
  _openSectionEditor({
    title: '➕ Nouvelle section',
    editorId: 'info-new-content',
    titleId: 'info-new-title',
    titleLabel: 'Titre (avec emoji optionnel)',
    titlePlaceholder: 'Ex: ⚡ Magie élémentaire',
    actions: `<button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="createInfoSection()">Créer</button>`,
  });
}

async function createInfoSection() {
  const title = document.getElementById('info-new-title')?.value.trim();
  const content = getRichTextHtml('info-new-content');
  if (!title) {
    showNotif('Indique un titre.', 'error');
    return;
  }
  try {
    const sections = [...(window._infoSections || [])];
    const taken = new Set(sections.map((s) => s.id));
    const id = uniqueId(slugify(title), taken);
    sections.push({ id, title, content });
    window._infoSections = sections;
    window._infoSection = id;
    await saveDoc('informations', 'main', { sections });
    closeModal();
    showNotif('Section ajoutée.', 'success');
    await PAGES.informations();
  } catch (e) {
    console.error('[create]', e);
    showNotif('Erreur lors de la création.', 'error');
  }
}

async function deleteInfoSection(id) {
  const sections = window._infoSections || [];
  if (sections.length <= 1) {
    showNotif('Impossible de supprimer la dernière section.', 'error');
    return;
  }
  const section = sections.find((s) => s.id === id);
  if (!section) return;
  const ok = await confirmModal(
    `Supprimer la section « ${section.title} » ? Cette action est définitive.`,
    { title: 'Confirmation de suppression' }
  );
  if (!ok) return;
  closeModalDirect();
  try {
    const next = sections.filter((s) => s.id !== id);
    if (window._infoSection === id) window._infoSection = next[0]?.id;
    window._infoSections = next;
    await saveDoc('informations', 'main', { sections: next });
    showNotif('Section supprimée.', 'success');
    await PAGES.informations();
  } catch (e) {
    console.error('[delete]', e);
    showNotif('Erreur de suppression.', 'error');
  }
}

function slugify(str) {
  const base = String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function jsAttrString(value) {
  return JSON.stringify(String(value)).replace(/"/g, '&quot;');
}

Object.assign(window, {
  showInfoSection,
  editInfoSection,
  saveInfoSection,
  addInfoSection,
  createInfoSection,
  deleteInfoSection
});

PAGES.informations = renderInformations;
