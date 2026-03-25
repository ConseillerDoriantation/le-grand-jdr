// ══════════════════════════════════════════════
// NOTIFICATIONS — Toast système
// ══════════════════════════════════════════════

let _timer = null;

export function showNotif(msg, type = 'success') {
  const el = document.getElementById('notif');
  if (!el) return;
  el.textContent = msg;
  el.className   = `notif ${type} show`;
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), 3000);
}
