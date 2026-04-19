import { STATE } from '../../core/state.js';
import { loadCollectionWhere, updateInCol } from '../../data/firestore.js';
import { showNotif } from '../../shared/notifications.js';

// ══════════════════════════════════════════════
// ÉDITION INLINE — TEXTE
// ══════════════════════════════════════════════
export function inlineEditText(charId, field, el) {
  const cur = el.textContent.trim();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = cur;
  input.className = 'cs-inline-input';
  input.style.cssText = 'width:100%;font-size:inherit;font-weight:inherit;font-family:inherit;color:inherit;';

  const save = async () => {
    const val = input.value.trim() || cur;
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c || val === cur) { el.textContent = cur; input.replaceWith(el); return; }
    c[field] = val;
    await updateInCol('characters', charId, {[field]: val});
    el.textContent = val;
    input.replaceWith(el);
    if (field === 'nom') {
      document.querySelectorAll('#char-pills .char-pill.active').forEach(p=>p.textContent=val);
    }
    showNotif('Mis à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.value=cur;input.blur();} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

// ══════════════════════════════════════════════
// ÉDITION INLINE — NOMBRE
// ══════════════════════════════════════════════
async function _syncPlayerNiveau(charId, niveau) {
  if (!STATE.isAdmin) return; // joueurs sans droit d'écriture sur /players (admin-only)
  const matches = await loadCollectionWhere('players', 'charId', '==', charId);
  if (!matches.length) return;
  await updateInCol('players', matches[0].id, { niveau });
}

export function inlineEditNum(charId, field, el, min=0, max=99999) {
  const cur = el.textContent.replace(/[^\d-]/g,'').trim();
  const input = document.createElement('input');
  input.type = 'number';
  input.value = cur;
  input.min = min; input.max = max;
  input.className = 'cs-inline-input cs-inline-num';
  input.style.cssText += ';-moz-appearance:textfield;';

  const save = async () => {
    const val = Math.max(min, Math.min(max, parseInt(input.value)||0));
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) { input.replaceWith(el); return; }
    c[field] = val;
    await updateInCol('characters', charId, {[field]: val});
    if (field === 'niveau') await _syncPlayerNiveau(charId, val);
    el.textContent = field==='niveau' ? `Niv. ${val}` : field==='or' ? `💰 ${val} or` : val;
    input.replaceWith(el);
    if (['niveau','pvBase','pmBase'].includes(field)) window.renderCharSheet(c, window._currentCharTab);
    else showNotif('Mis à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.replaceWith(el);} });
  el.replaceWith(input);
  input.focus();
  input.select();
}

// ══════════════════════════════════════════════
// ÉDITION INLINE — STAT (click sur carte)
// ══════════════════════════════════════════════
export function inlineEditStatFromCard(event, charId, statKey, cardEl) {
  if (!cardEl) return;
  if (event?.target?.closest('input, button, textarea, select, a')) return;
  if (cardEl.querySelector('input.cs-inline-input')) return;
  const baseEl = cardEl.querySelector('.js-stat-base');
  if (!baseEl) return;
  inlineEditStat(charId, statKey, baseEl);
}

export function inlineEditStat(charId, statKey, el) {
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  const cur = parseInt((c?.stats||{})[statKey]) || 8;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = cur;
  input.min = 1; input.max = 30;
  input.className = 'cs-inline-input cs-inline-num';
  input.style.cssText = 'width:52px;font-size:1.3rem;font-weight:700;text-align:center;-moz-appearance:textfield;';

  const save = async () => {
    const val = Math.max(1, Math.min(30, parseInt(input.value)||cur));
    const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
    if (!c) { input.replaceWith(el); return; }
    c.stats = c.stats||{};
    c.stats[statKey] = val;
    await updateInCol('characters', charId, {stats: c.stats});
    input.replaceWith(el);
    window.renderCharSheet(c, window._currentCharTab);
    showNotif('Stat mise à jour !','success');
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){input.replaceWith(el);} });
  el.replaceWith(input);
  input.focus();
  input.select();
}
