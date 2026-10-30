// ══════════════════════════════════════════════════════════════════════════════
// SPELL-REVIEW.JS — File de validation des sorts (MJ), toute l'aventure
//
// Les sorts « en attente » de tous les personnages, avec ce qui a changé depuis
// la dernière décision du MJ (champ mjReviewed, cf. shared/spell-validation.js) ;
// Valider / Refuser (note facultative) enchaînent sur le sort suivant.
// Quota : 0 lecture (STATE.characters est session-live), 1 écriture par décision.
// Chargé à la demande (Console MJ, onglet Sorts) — module feuille.
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../../core/state.js';
import { registerActions } from '../../core/actions.js';
import { trySave } from '../../shared/crud.js';
import { charSession } from '../../shared/char-session.js';
import { openModal, updateModalContent, closeModalDirect } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc, _nl2br } from '../../shared/html.js';
import { spellValidationState, isAlwaysPreparedSpell } from '../../shared/spell-deck.js';
import { spellPlayDiff } from '../../shared/spell-validation.js';
import { loadDamageTypes } from '../../shared/damage-types.js';
import { loadSpellMatrices } from '../../shared/spell-matrices.js';
import { loadConditionLibrary } from '../../shared/conditions.js';
import { setTargetCharacter } from '../../shared/character-navigation.js';
import { setSpellCaches, setConditionsLibCache } from './spells-calc.js';
import { spellFacts, spellEffectLines, spellCompositionTags, spellCompositionIcons } from './spell-facts.js';
import { getArmorSetData } from './data.js';

let _selKey = '';
let _conditions = [];

const _itemKey = (c, s, idx) => `${c.id}:${s?.id || `#${idx}`}`;

/** Sorts en attente de tous les personnages, dans l'ordre d'affichage des persos. */
function _pendingItems() {
  const items = [];
  (STATE.characters || []).forEach(c => {
    (c?.deck_sorts || []).forEach((s, idx) => {
      if (spellValidationState(s) === 'pending') items.push({ c, s, idx, key: _itemKey(c, s, idx) });
    });
  });
  return items;
}

function _kind(s) {
  if (s.mjReviewed?.verdict === 'no') return { label: 'Corrigé', cls: 'is-fixed' };
  if (s.mjReviewed) return { label: 'Modifié', cls: 'is-changed' };
  return { label: 'À relire', cls: 'is-new' };
}

function _stateLabel(id) {
  return _conditions.find(x => x?.id === id)?.label || '';
}

function _renderDetail(item) {
  const { c, s } = item;
  const pmDelta = getArmorSetData(c)?.modifiers?.spellPmDelta || 0;
  const effects = spellEffectLines(s, c);
  const facts = spellFacts(s, c, pmDelta);
  const diff = s.mjReviewed?.play ? spellPlayDiff(s.mjReviewed.play, s, { stateLabel: _stateLabel }) : [];
  const owner = [c.nom || 'Personnage', c.ownerPseudo ? `joué par ${c.ownerPseudo}` : ''].filter(Boolean).join(' · ');
  const diffBlock = s.mjReviewed?.play
    ? `<div class="cs-review-diff">
        <span class="cs-grim-h">${s.mjReviewed.verdict === 'no' ? 'Ce qui a changé depuis ton refus' : 'Ce qui a changé depuis ta validation'}</span>
        ${diff.length
          ? `<ul>${diff.map(r => `<li aria-label="${_esc(`${r.label} : avant ${r.before}, après ${r.after}`)}">
              <span>${_esc(r.label)}</span><s>${_esc(r.before)}</s><i aria-hidden="true">→</i><b>${_esc(r.after)}</b>
            </li>`).join('')}</ul>`
          : '<p>Aucun changement en jeu depuis cette version.</p>'}
      </div>`
    : `<div class="cs-review-diff is-new">
        <span class="cs-grim-h">À relire en entier</span>
        <p>Nouveau sort, ou modifié avant la mise en place du suivi : aucune version de référence à comparer.</p>
      </div>`;
  return `<section class="cs-review-detail" aria-label="Sort sélectionné">
    <header class="cs-review-head">
      <span class="cs-review-ic is-big" aria-hidden="true">${_esc(s.icon || '✦')}</span>
      <div>
        <h3>${_esc(s.nom || 'Sans nom')}</h3>
        <span>${_esc(owner)}</span>
      </div>
    </header>
    <div class="cs-grim-tags" aria-label="Composition : éléments et runes">${spellCompositionTags(s)}</div>
    ${diffBlock}
    <div class="cs-grim-facts">${facts.map(f => `<div><span>${f.k}</span><b>${_esc(f.v)}</b></div>`).join('')}</div>
    ${effects.length ? `<div class="cs-grim-sec">
      <span class="cs-grim-h">En jeu</span>
      <ul class="cs-grim-effects">${effects.map(l => `<li><i aria-hidden="true">${l.icon || '•'}</i><span><b>${_esc(l.label)}</b>${l.detail ? `<small>${_esc(l.detail)}</small>` : ''}</span></li>`).join('')}</ul>
    </div>` : ''}
    ${s.effet ? `<div class="cs-grim-sec"><span class="cs-grim-h">Description du joueur</span><p class="cs-grim-desc">${_nl2br(s.effet)}</p></div>` : ''}
    <label class="cs-grim-fld is-block"><span>Note pour le joueur (facultatif, visible sur sa fiche)</span>
      <textarea id="rv-note" rows="2" placeholder="Ex. : retire une rune Puissance, c'est trop fort à ce niveau.">${_esc(s.mjNotes || '')}</textarea>
    </label>
    <div class="cs-review-actions">
      <button type="button" class="cs-grim-btn is-no" data-action="_reviewDecide" data-val="no">✕ Refuser</button>
      <button type="button" class="cs-grim-btn" data-action="_reviewOpenChar">Voir la fiche</button>
      <span class="cs-review-spacer"></span>
      <button type="button" class="cs-grim-btn is-ok" data-action="_reviewDecide" data-val="ok">✓ Valider et passer au suivant</button>
    </div>
  </section>`;
}

function _render(first = false) {
  const items = _pendingItems();
  if (!items.some(it => it.key === _selKey)) _selKey = items[0]?.key || '';
  const current = items.find(it => it.key === _selKey) || null;
  const list = items.map(it => {
    const k = _kind(it.s);
    return `<button type="button" class="cs-review-item${it.key === _selKey ? ' is-sel' : ''}" data-action="_reviewPick" data-key="${_esc(it.key)}" aria-pressed="${it.key === _selKey}">
      <span class="cs-review-ic" aria-hidden="true">${_esc(it.s.icon || '✦')}</span>
      <span class="cs-review-item-txt"><b>${_esc(it.s.nom || 'Sans nom')}</b><small>${_esc(it.c.nom || 'Personnage')}</small><small class="cs-review-recipe" title="Éléments et runes">${_esc(spellCompositionIcons(it.s))}</small></span>
      <span class="cs-review-kind ${k.cls}">${k.label}</span>
    </button>`;
  }).join('');
  const body = current
    ? `<div class="cs-review">
        <nav class="cs-review-list" aria-label="Sorts en attente">${list}</nav>
        ${_renderDetail(current)}
      </div>`
    : `<div class="cs-review is-empty">
        <div class="cs-grim-empty">
          <span class="cs-grim-empty-ico" aria-hidden="true">✓</span>
          <b>Tout est à jour</b>
          <span>Aucun sort n'attend ta validation.</span>
          <button type="button" class="cs-grim-btn" data-action="_reviewClose">Fermer</button>
        </div>
      </div>`;
  const subtitle = items.length ? `${items.length} en attente · tous les personnages` : 'Aucun sort en attente';
  if (first) openModal('Sorts à valider', body, { subtitle });
  else updateModalContent('Sorts à valider', body, { subtitle });
}

/** Ouvre la file. focus = { charId, spellId?, idx? } pour présélectionner un sort. */
export async function openSpellReview(focus = {}) {
  if (!STATE.isAdmin) return;
  try {
    const [damageTypes, matrices, conditions] = await Promise.all([loadDamageTypes(), loadSpellMatrices(), loadConditionLibrary()]);
    setSpellCaches(matrices, damageTypes);
    _conditions = Array.isArray(conditions) ? conditions : [];
    setConditionsLibCache(_conditions);
  } catch (err) {
    console.warn('[sorts] file de validation : bibliothèques indisponibles', err);
  }
  const c = (STATE.characters || []).find(x => x.id === focus.charId);
  if (c) {
    const idx = focus.spellId ? (c.deck_sorts || []).findIndex(s => s?.id === focus.spellId) : Number(focus.idx);
    const s = (c.deck_sorts || [])[idx];
    if (s) _selKey = _itemKey(c, s, idx);
  }
  _render(true);
}

// Une écriture : le deck du perso avec la décision appliquée au sort.
async function _decide(verdict) {
  const items = _pendingItems();
  const pos = items.findIndex(it => it.key === _selKey);
  const item = items[pos];
  if (!item) return;
  const { c } = item;
  const sorts = [...(c.deck_sorts || [])];
  const idx = item.s.id ? sorts.findIndex(s => s?.id === item.s.id) : item.idx;
  if (!sorts[idx]) { showNotif('Sort introuvable : il a peut-être été modifié entre-temps.', 'warning'); _render(); return; }
  const note = document.getElementById('rv-note')?.value?.trim() ?? (sorts[idx].mjNotes || '');
  const next = { ...sorts[idx], mjValidation: verdict, mjValidated: verdict === 'ok', mjNotes: note };
  delete next.mjReviewed;   // le MJ a tranché : plus de diff à montrer
  if (verdict !== 'ok') next.actif = false;
  else if (isAlwaysPreparedSpell(next)) next.actif = true;
  sorts[idx] = next;
  if (!(await trySave('characters', c.id, { deck_sorts: sorts }))) return;
  // Copies locales du perso (liste de l'aventure, fiche ouverte) : même contenu.
  c.deck_sorts = sorts;
  [STATE.activeChar, charSession.getCurrentChar()].forEach(x => { if (x && x !== c && x.id === c.id) x.deck_sorts = sorts; });
  showNotif(`${next.nom || 'Sort'} ${verdict === 'ok' ? 'validé' : 'refusé'}.`, verdict === 'ok' ? 'success' : 'info');
  // Suivant : celui qui suivait dans la file (sinon le premier restant).
  const rest = _pendingItems();
  _selKey = (rest.find((it, k) => k >= pos) || rest[0])?.key || '';
  _render();
  // La fiche ouverte derrière la modale reflète la décision.
  const cur = charSession.getCurrentChar();
  if (cur?.id === c.id && charSession.getCurrentCharTab() === 'sorts') {
    try { charSession.renderTab('sorts', cur, charSession.getCanEditChar()); } catch { /* fiche non montée */ }
  }
}

async function _openChar() {
  const item = _pendingItems().find(it => it.key === _selKey);
  if (!item) return;
  STATE.pendingSpellFocus = { charId: item.c.id, spellId: item.s.id || '', idx: item.idx };
  closeModalDirect();
  setTargetCharacter(item.c.id, 'sorts');
  const { navigate } = await import('../../core/navigation.js');
  navigate('characters');
}

registerActions({
  _reviewPick:     (btn) => { _selKey = btn.dataset.key || ''; _render(); },
  _reviewDecide:   (btn) => _decide(btn.dataset.val === 'ok' ? 'ok' : 'no'),
  _reviewOpenChar: ()    => _openChar(),
  _reviewClose:    ()    => closeModalDirect(),
});
