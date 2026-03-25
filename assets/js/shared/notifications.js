// ══════════════════════════════════════════════
// NOTIFICATION
// ══════════════════════════════════════════════
let notifTimer;
function showNotif(msg, type='success') {
  const el = document.getElementById('notif');
  el.textContent = msg;
  el.className = `notif ${type} show`;
  clearTimeout(notifTimer);
  notifTimer = setTimeout(()=>el.classList.remove('show'),3000);
}
