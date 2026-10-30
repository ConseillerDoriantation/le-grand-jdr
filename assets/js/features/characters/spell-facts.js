// ══════════════════════════════════════════════════════════════════════════════
// SPELL-FACTS.JS — Ce que fait un sort, en clair (fiche de l'onglet Sorts et
// file de validation MJ) : faits clés + lignes d'effet calculées.
// Module feuille partagé : une seule lecture des règles pour les deux écrans.
// ══════════════════════════════════════════════════════════════════════════════

import { _buildSortResume, _calcSortCibles, _calcSortDuree, _calcSortZone, _getSortAction, _needsDureeBase, noyauTypesFor, spellCostRes, spellVM } from './spells-calc.js';
import { getMainWeapon } from './data.js';
import { _esc } from '../../shared/html.js';
import { _VTT_RUNE_META } from '../vtt/vtt-constants.js';   // icône + couleur de chaque rune (héritages compris)

const ACTION_LBL = { action: 'Action', action_bonus: 'Action bonus', reaction: 'Réaction' };
const cases = n => `${n} case${n > 1 ? 's' : ''}`;

/** Faits clés : coût, activation, portée, zone (ou cibles), durée. */
export function spellFacts(s, c, pmDelta = 0) {
  const facts = [{ k: 'Coût', v: `${spellVM(s, pmDelta).pm ?? 0} ${spellCostRes(s).label}` }];
  try {
    const { action, concentration } = _getSortAction(s);
    facts.push({ k: 'Activation', v: `${ACTION_LBL[action] || 'Action'}${concentration ? ' · concentration' : ''}` });
    // Portée forcée par le sort (0 = lanceur), sinon celle de l'arme principale.
    const portee = s.portee != null && s.portee !== ''
      ? (Number(s.portee) === 0 ? 'Lanceur' : cases(Number(s.portee)))
      : cases(parseInt(getMainWeapon(c).portee) || 1);
    facts.push({ k: 'Portée', v: portee });
    if (s.designMode === 'classic') {
      facts.push((parseInt(s.zoneW) || 0) > 0
        ? { k: 'Zone', v: `${s.zoneW}×${s.zoneH} cases` }
        : { k: 'Cible', v: { enemy: '1 ennemi', ally: '1 allié', self: 'Lanceur', any: 'Au choix' }[s.classicTarget] || '1 cible' });
      const d = parseInt(s.classicDuration) || 0;
      facts.push({ k: 'Durée', v: d ? `${d} tour${d > 1 ? 's' : ''}` : 'Instantané' });
    } else {
      const zone = _calcSortZone(s);
      facts.push(zone ? { k: 'Zone', v: `${zone.w}×${zone.h} cases` } : { k: 'Cibles', v: `${_calcSortCibles(s) || 1}` });
      const d = _needsDureeBase(s) ? _calcSortDuree(s) : 0;
      facts.push({ k: 'Durée', v: d ? `${d} tours` : 'Instantané' });
    }
  } catch { /* bibliothèques pas encore chargées : le coût suffit */ }
  return facts;
}

// Runes comptées, dans l'ordre canonique du grimoire (inconnues en fin).
const RUNE_ORDER = Object.keys(_VTT_RUNE_META);
const _rank = nom => { const i = RUNE_ORDER.indexOf(nom); return i < 0 ? RUNE_ORDER.length : i; };
function _runeCounts(s) {
  const counts = new Map();
  (Array.isArray(s.runes) ? s.runes : []).forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
  return [...counts.entries()].sort(([a], [b]) => _rank(a) - _rank(b));
}

/** Composition en pastilles colorées : éléments puis runes (comptées). */
export function spellCompositionTags(s) {
  const tag = (color, label) => `<span class="cs-grim-tag" style="--c:${color}">${label}</span>`;
  const parts = [
    s.designMode === 'classic' ? tag('#5bc0eb', 'Sort classique') : '',
    ...noyauTypesFor(s).map(t => tag(t.color || '#888', `${_esc(t.icon || '✦')} ${_esc(t.label || t.nom || 'Élément')}`)),
    ..._runeCounts(s).map(([nom, n]) => {
      const meta = _VTT_RUNE_META[nom] || {};
      return tag(meta.color || '#7c8aa5', `${meta.icon || '✦'} ${_esc(nom)}${n > 1 ? ` ×${n}` : ''}`);
    }),
  ].filter(Boolean);
  return parts.join('') || '<span class="cs-grim-tag is-warn">⚠ Élément à définir</span>';
}

/** Composition en une ligne d'icônes (« ⚡ · ⚔️×2 🎯 ») pour une liste compacte. */
export function spellCompositionIcons(s) {
  const elements = noyauTypesFor(s).map(t => t.icon || '✦').join('');
  const runes = _runeCounts(s).map(([nom, n]) => `${(_VTT_RUNE_META[nom] || {}).icon || '✦'}${n > 1 ? `×${n}` : ''}`).join(' ');
  return [elements, runes].filter(Boolean).join(' · ');
}

/** Lignes d'effet calculées, sans celles déjà dans les faits (activation, portée). */
export function spellEffectLines(s, c) {
  try {
    return _buildSortResume(s, c).filter(l => l.icon !== '📏' && !/^(⚡|✴️|🔄)/.test(l.label || ''));
  } catch {
    return [];
  }
}
