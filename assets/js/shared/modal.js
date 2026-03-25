// MODALS
// ══════════════════════════════════════════════
function openModal(title, bodyHtml) {
  document.getElementById('modal-title').querySelector('span').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(e) {
  if (!e || e.target===document.getElementById('modal-overlay') || e.target.textContent==='✕')
    document.getElementById('modal-overlay').classList.remove('show');
}

document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
