export function runeCount(spell = {}, runeName) {
  return (spell?.runes || []).filter(r => r === runeName).length;
}

export function calcSpellTargets(spell = {}) {
  const nbDisp = runeCount(spell, 'Dispersion');
  const nbAmp = runeCount(spell, 'Amplification');
  const nbAff = runeCount(spell, 'Affliction');
  const nbInv = runeCount(spell, 'Invocation');
  if (nbAmp > 0 && nbDisp > 0) return 1;
  if (nbAff > 0 && nbInv > 0 && nbDisp > 0) return 1;
  return nbDisp === 0 ? 1 : 1 + nbDisp;
}

export function calcSpellDuration(spell = {}) {
  const nbDur = runeCount(spell, 'Durée');
  const base = (spell?.dureeBase && spell.dureeBase >= 2) ? +spell.dureeBase : 2;
  const dur = base + (nbDur > 0 ? 2 * nbDur : 0);
  // Concentration (hors combo Réaction, qui stocke un sort instantané) : le sort
  // est maintenu tant que la concentration tient → durée longue par défaut (10
  // tours) au lieu des 2 tours persistants. Un override manuel supérieur l'emporte.
  if (runeCount(spell, 'Concentration') > 0 && runeCount(spell, 'Réaction') === 0) {
    return Math.max(10, dur);
  }
  return dur;
}
