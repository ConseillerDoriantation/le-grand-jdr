// Modèle de la Chronologie : aucune dépendance au DOM ou à Firestore.
export const DAY = 864e5;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function chronicleDay(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(date);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
}

function between(lo, hi, month, day) {
  for (let year = new Date(lo).getUTCFullYear(); year <= new Date(hi).getUTCFullYear(); year++) {
    const time = Date.UTC(year, month, day);
    if (time > lo && time < hi) return true;
  }
  return false;
}

function duration(days) {
  if (days < 13) return plural(days, 'jour');
  if (days < 70) return plural(Math.round(days / 7), 'semaine');
  return `${Math.round(days / 30.4)} mois`;
}

export function buildChronicle(items, missions, {
  isAdmin = false, filteredIds, desc = false, toDate = item => item.date,
} = {}) {
  const known = new Map(missions.map(m => [m.id, m]));
  const byTime = new Map();
  for (const item of items) {
    if (!isAdmin && item.secret) continue;
    const time = chronicleDay(toDate(item));
    const key = Number.isFinite(time) ? time : Infinity;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(item);
  }

  const seen = new Set();
  const sessions = [...byTime].sort(([a], [b]) => a - b).map(([time, entries], index) => {
    const votes = new Map();
    for (const item of entries) {
      const id = known.has(item.missionId) ? item.missionId : '';
      votes.set(id, (votes.get(id) || 0) + 1);
    }
    // À égalité, préférer une mission connue ; sinon garder l'ordre des entrées.
    const majority = [...votes].sort(([a, x], [b, y]) => y - x || Number(!!b) - Number(!!a))[0]?.[0];
    const contributors = [...new Set(entries.flatMap(item => item.contributeurs || []).filter(Boolean))];
    const debut = contributors.filter(id => !seen.has(id));
    contributors.forEach(id => seen.add(id));
    const date = Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '';
    return {
      key: date || 'sans-date', date, time, index, entries, contributors, debut,
      mission: known.get(majority),
      shown: filteredIds ? entries.filter(item => filteredIds.has(item.id)) : entries,
    };
  });
  const dated = sessions.filter(s => s.date);
  const intervals = dated.slice(1).map((s, i) => (s.time - dated[i].time) / DAY).sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const cadence = !intervals.length ? 14 : intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2;

  const gap = (a, b) => {
    if (!a?.date || !b?.date) return null;
    const days = Math.abs(b.time - a.time) / DAY;
    const hidden = Math.abs(b.index - a.index) - 1;
    if (!hidden && days <= Math.max(20, cadence * 1.5)) return null;
    const lo = Math.min(a.time, b.time), hi = Math.max(a.time, b.time);
    const label = hidden ? `${plural(hidden, 'séance')} masquée${hidden > 1 ? 's' : ''}`
      : between(lo, hi, 11, 25) ? 'Trêve des fêtes' : between(lo, hi, 7, 15) ? 'Pause estivale' : 'Pause';
    return { type: 'gap', label, hidden, duration: duration(days), height: hidden ? 46 : Math.min(140, Math.max(54, 34 + (days - cadence) * 1.6)) };
  };
  const pauses = dated.slice(1).flatMap((b, i) => {
    const a = dated[i], pause = gap(a, b);
    return pause ? [{ ...pause, from: a.time, to: b.time }] : [];
  });

  const chapters = [], acts = [], seenMissions = new Set();
  for (const session of sessions) {
    const mission = session.mission;
    let chapter = chapters.at(-1);
    if (!chapter || chapter.mission?.id !== mission?.id) {
      chapter = { type: 'chapter', key: session.key, mission, sessions: [], suite: !!mission && seenMissions.has(mission.id) };
      chapters.push(chapter);
      if (mission) seenMissions.add(mission.id);
    }
    chapter.sessions.push(session);
    session.chapter = chapter.key;
    if (mission?.acte && session.date) {
      if (acts.at(-1)?.label !== mission.acte) acts.push({ type: 'act', label: mission.acte, sessions: [] });
      acts.at(-1).sessions.push(session);
      session.act = acts.length - 1;
    }
  }

  const displayed = desc ? [...dated].reverse().concat(sessions.filter(s => !s.date)) : sessions;
  const visible = displayed.filter(s => s.shown.length);
  const chapterMap = new Map(chapters.map(c => [c.key, { ...c, sessions: c.sessions.filter(s => s.shown.length) }]));
  const rows = [];
  let prev, lastChapter, lastAct;
  for (const session of visible) {
    const pause = gap(prev, session);
    if (pause) rows.push(pause);
    if (session.act != null && session.act !== lastAct) {
      rows.push(acts[session.act]);
      lastAct = session.act;
    }
    if (session.chapter !== lastChapter) rows.push(chapterMap.get(session.chapter));
    rows.push({ type: 'session', session });
    prev = session;
    lastChapter = session.chapter;
  }
  const start = dated[0]?.time ?? 0, end = dated.at(-1)?.time ?? start;
  const pad = Math.max(5 * DAY, (end - start) * .02);
  const months = dated.length
    ? (Number(dated.at(-1).date.slice(0, 4)) - Number(dated[0].date.slice(0, 4))) * 12
      + Number(dated.at(-1).date.slice(5, 7)) - Number(dated[0].date.slice(5, 7)) + 1 : 0;
  return { sessions, dated, chapters, acts, rows, visible, cadence, pauses, months, start: start - pad, end: end + pad };
}

// Interpolation commune à la lentille et au glisser, y compris en ordre inverse.
export function interpolateChronicle(points, value, from, to) {
  if (!points.length) return null;
  const first = points[0], last = points.at(-1);
  const ascending = first[from] <= last[from];
  if (ascending ? value <= first[from] : value >= first[from]) return first[to];
  if (ascending ? value >= last[from] : value <= last[from]) return last[to];
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const i = (hi + lo) >> 1;
    if (ascending ? points[i][from] <= value : points[i][from] >= value) lo = i;
    else hi = i;
  }
  const a = points[lo], b = points[hi];
  return a[to] + (b[to] - a[to]) * (value - a[from]) / (b[from] - a[from]);
}
