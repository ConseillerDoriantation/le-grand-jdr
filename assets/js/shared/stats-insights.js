// Calculs purs de présentation pour Statistiques v2.
// Aucune lecture ni écriture : les appelants fournissent les miroirs par séance.

const n = value => Number(value) || 0;
const sum = (rows, getter) => rows.reduce((total, row) => total + n(getter(row)), 0);
const average = values => values.length ? values.reduce((total, value) => total + n(value), 0) / values.length : 0;

export function withIds(sessions = [], ids = null) {
  if (!ids?.size) return sessions;
  return sessions.map(session => ({
    ...session,
    rows: (session.rows || []).filter(row => ids.has(row.id)),
  })).filter(session => session.rows.length);
}

export function statsSessionTotal(rows = []) {
  const combat = key => sum(rows, row => row.combat?.[key]);
  const naturalRolls = sum(rows, row => row.actionAverages?.trackedRolls);
  const naturalTotal = sum(rows, row => n(row.actionAverages?.naturalAvg) * n(row.actionAverages?.trackedRolls));
  return {
    dmg: combat('dmgDealt'), ko: combat('kosDealt'), heal: combat('heal'),
    taken: combat('dmgTaken'), down: combat('kosTaken'), avoided: combat('attacksAvoided'),
    attacks: combat('attacks'), hits: combat('hits'), spells: combat('spellsCast'),
    skills: sum(rows, row => row.sRolls),
    crits: sum(rows, row => n(row.sCrits) + n(row.combat?.crits)),
    naturalRolls,
    naturalAvg: naturalRolls ? naturalTotal / naturalRolls : null,
  };
}

export function statsRecords(sessions = []) {
  const bestCharacter = (id, label, icon, getter) => {
    let top = null;
    sessions.forEach(session => (session.rows || []).forEach(row => {
      const value = n(getter(row));
      if (value > 0 && (!top || value > top.value)) top = { id, label, icon, value, session, row };
    }));
    return top;
  };
  const bestTable = (id, label, icon, getter) => {
    let top = null;
    sessions.forEach(session => {
      const value = n(getter(statsSessionTotal(session.rows || [])));
      if (value > 0 && (!top || value > top.value)) top = { id, label, icon, value, session, table: true };
    });
    return top;
  };
  return [
    bestCharacter('big-hit', 'Plus gros coup', '💥', row => row.combat?.biggestHit),
    bestCharacter('offense', 'Meilleure séance offensive', '🗡️', row => row.combat?.dmgDealt),
    bestCharacter('ko', 'Plus de KO en une séance', '☠️', row => row.combat?.kosDealt),
    bestCharacter('heal', 'Plus gros soin en une séance', '💚', row => row.combat?.heal),
    bestCharacter('crits', 'Plus de critiques en une séance', '🌟', row => n(row.sCrits) + n(row.combat?.crits)),
    bestTable('intense', 'Séance la plus intense', '🔥', total => total.dmg),
    bestTable('deadly', 'Séance la plus meurtrière', '⚰️', total => total.down),
  ].filter(Boolean);
}

export function statsBalance(session, allSessions = []) {
  const total = statsSessionTotal(session?.rows || []);
  const ratios = allSessions.map(item => {
    const value = statsSessionTotal(item.rows || []);
    return value.taken > 0 ? value.dmg / value.taken : null;
  }).filter(value => value != null);
  return {
    dealt: total.dmg,
    taken: total.taken,
    ratio: total.taken > 0 ? total.dmg / total.taken : null,
    averageRatio: average(ratios),
    ko: total.ko,
    down: total.down,
    downNames: (session?.rows || []).filter(row => n(row.combat?.kosTaken) > 0).map(row => row.name),
  };
}

export function statsSpotlight(rows = []) {
  const totalActions = sum(rows, row => n(row.combat?.attacks) + n(row.combat?.spellsCast) + n(row.sRolls));
  const equalShare = rows.length ? totalActions / rows.length : 0;
  return rows.map(row => {
    const actions = n(row.combat?.attacks) + n(row.combat?.spellsCast) + n(row.sRolls);
    return { id: row.id, name: row.name, actions, share: totalActions ? actions / totalActions : 0, equalShare };
  }).sort((a, b) => b.actions - a.actions);
}

export function statsInsights(sessions = []) {
  if (!sessions.length) return [];
  const results = [];
  const totals = sessions.map(session => ({ session, total: statsSessionTotal(session.rows || []) }));
  if (sessions.length === 1) {
    const { total } = totals[0];
    if (total.dmg) results.push({ tone: 'offense', text: `${total.dmg.toLocaleString('fr-FR')} dégâts infligés pendant cette séance.` });
    if (total.down >= 2) results.push({ tone: 'danger', text: `${total.down} personnages ont été mis à terre.` });
    if (total.naturalRolls >= 15 && total.naturalAvg != null) {
      const luck = total.naturalAvg > 11.8 ? 'chanceuse' : total.naturalAvg < 9.2 ? 'difficile' : 'équilibrée';
      results.push({ tone: luck === 'difficile' ? 'danger' : 'dice', text: `Une soirée ${luck} au d20 : ${total.naturalAvg.toFixed(1).replace('.', ',')} de moyenne.` });
    }
  } else {
    const deadliest = [...totals].sort((a, b) => b.total.down - a.total.down)[0];
    if (deadliest?.total.down >= 2) results.push({ tone: 'danger', text: `La séance la plus meurtrière compte ${deadliest.total.down} personnages à terre.` });
    const tracked = totals.reduce((acc, item) => ({ rolls: acc.rolls + item.total.naturalRolls, sum: acc.sum + n(item.total.naturalAvg) * item.total.naturalRolls }), { rolls: 0, sum: 0 });
    if (tracked.rolls >= 40) {
      const avg = tracked.sum / tracked.rolls;
      const text = Math.abs(avg - 10.5) < .15 ? 'parfaitement équilibrée' : avg > 10.5 ? 'plutôt chanceuse' : 'légèrement malchanceuse';
      results.push({ tone: 'dice', text: `Table ${text} : ${avg.toFixed(1).replace('.', ',')} de moyenne au d20.` });
    }
    if (sessions.length >= 6) {
      const damages = totals.map(item => item.total.dmg);
      const recent = average(damages.slice(-3));
      const before = average(damages.slice(0, -3));
      if (before > 0 && Math.abs(recent / before - 1) >= .2) results.push({
        tone: recent > before ? 'offense' : 'protection',
        text: recent > before ? 'Les combats s’intensifient sur les trois dernières séances.' : 'Le rythme des combats s’est calmé sur les trois dernières séances.',
      });
    }
  }
  return results.slice(0, 4);
}

export function suggestStatsSessionLink(session, groups = [], sessions = []) {
  const participantIds = new Set((session?.rows || []).map(row => row.id));
  const candidates = groups.map(group => {
    const members = new Set((group?.participants || []).map(item => item.charId || item.id).filter(Boolean));
    const matches = [...participantIds].filter(id => members.has(id)).length;
    return { group, matches };
  }).sort((a, b) => b.matches - a.matches);
  const group = candidates[0]?.matches ? candidates[0].group : null;
  const previous = sessions.filter(item => item !== session && item.missionId && (!group || item.groupId === group.id));
  return { groupId: group?.id || '', missionId: previous.at(-1)?.missionId || '' };
}
