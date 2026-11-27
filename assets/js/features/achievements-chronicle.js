import { _esc } from '../shared/html.js';
import { characterAvatarHtml, characterColor } from '../shared/portraits.js';
import { DAY, interpolateChronicle } from './achievements-chronicle-model.js';

const fmt = options => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options });
const weekday = fmt({ weekday: 'long' }), month = fmt({ month: 'short' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const short = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const long = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateRange = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const monthRange = fmt({ month: 'short', year: 'numeric' });
const formatRange = (formatter, from, to) => from === to ? formatter.format(from)
  : formatter.formatRange?.(from, to) || `${formatter.format(from)} – ${formatter.format(to)}`;
const cap = str => str.charAt(0).toUpperCase() + str.slice(1);
const count = (n, label, plural = label + 's') => `${n} ${n === 1 ? label : plural}`;
const facts = n => count(n, 'haut-fait', 'hauts-faits');
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const position = (model, time) => (time - model.start) / (model.end - model.start) * 100;
const color = value => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || '') ? value : '#7eb0ff';
const auras = { blue: '#4f8cff', arcane: '#9d6fff', crimson: '#ff5a7e', gold: '#e8b84b', emerald: '#22c38e', ember: '#ff9544' };
const focus = item => /^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/.test(item.focus || '') ? item.focus
  : Number(item.aspectRatio) < .9 ? '50% 22%' : '50% 40%';
const image = item => `<img src="${_esc(item.imageUrl)}" alt="" loading="lazy" decoding="async" draggable="false" style="object-position:${focus(item)}">`;
const fold = str => str.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const prefersStill = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function chronicleHighlight(value, search) {
  const text = String(value ?? ''), query = fold(String(search ?? '').trim());
  if (!query) return _esc(text);
  let folded = '';
  const offsets = [], ends = [];
  for (const { 0: segment, index } of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const part = fold(segment);
    for (let i = 0; i < part.length; i++) { offsets.push(index); ends.push(index + segment.length); }
    folded += part;
  }
  let result = '', last = 0;
  for (let at = folded.indexOf(query); at !== -1; at = folded.indexOf(query, at + query.length)) {
    const begin = offsets[at], end = ends[at + query.length - 1];
    if (begin < last) continue;
    result += _esc(text.slice(last, begin)) + `<mark>${_esc(text.slice(begin, end))}</mark>`;
    last = end;
  }
  return result + _esc(text.slice(last));
}

function rowDecoration() {
  return '<i class="cr-n" aria-hidden="true"></i>';
}

export function renderChronicle(model, {
  categories, categoryFor, isNew, characters, isAdmin, bulk, selected, search, hasFilters,
  desc, mode, news, bulkBar, animate,
}) {
  const summary = mode === 'sommaire';
  const byCharacter = new Map(characters.map(c => [c.id, {
    ...c, chronicleColor: color(c.auraColor || auras[c.aura] || characterColor(c)),
  }]));
  const people = ids => [...new Set(ids || [])].map(id => byCharacter.get(id)).filter(Boolean);
  const avatars = (list, size = 20) => `<span class="cr-avatars" style="--av:${size}px">${list.slice(0, 5).map(c =>
    characterAvatarHtml(c, { size, tag: 'span', className: 'cr-avatar', border: '0', background: `color-mix(in srgb,${c.chronicleColor} 20%,var(--surface-2))`, color: c.chronicleColor })
  ).join('')}</span>`;
  const addButton = (session, compact) => isAdmin && !bulk
    ? `<button type="button" class="${compact ? 'cr-c-add' : 'cr-add'}" data-action="_achChronicleAdd" data-key="${session.key}" aria-label="Ajouter un haut-fait à cette séance" title="Ajouter un haut-fait à cette séance">＋${compact ? '' : ' Ajouter'}</button>`
    : '';
  const card = item => {
    const c = categoryFor(item) || {}, fresh = isNew(item), picked = bulk && selected.has(item.id);
    const featured = item.featured && item.imageUrl && !summary;
    const who = people(item.contributeurs);
    const names = who.length > 3 ? `${who.slice(0, 2).map(p => p.nom || '?').join(', ')} et ${who.length - 2} autres` : who.map(p => p.nom || '?').join(', ');
    const thumb = item.imageUrl ? image(item) : `<span>${_esc(item.emoji || c.emoji || '✦')}</span>`;
    const title = chronicleHighlight(item.titre || 'Haut-Fait', search);
    const action = bulk ? '_achToggleBulkSelection' : '_achOpenLightbox';
    const id = _esc(item.id);
    const label = `${bulk ? (picked ? 'Désélectionner' : 'Sélectionner') : 'Ouvrir'} « ${_esc(item.titre || 'Haut-Fait')} »`;
    const star = item.featured ? `<span class="cr-star" title="À la une">★${featured ? ' À la une' : ''}</span>` : '';
    const secret = isAdmin && item.secret ? '<span class="cr-secret" title="Caché aux joueurs">Secret</span>' : '';
    const badge = fresh ? '<span class="cr-new">Nouveau</span>' : '';
    const check = bulk ? `<span class="cr-check" aria-hidden="true">${picked ? '✓' : ''}</span>` : '';
    const mainButton = `<button type="button" class="cr-hit" data-action="${action}" data-id="${id}" aria-label="${label}"${bulk ? ` aria-pressed="${picked}"` : ''}></button>`;
    const attrs = `data-ach-id="${id}" style="--c:${color(c.color)};--r:${clamp(Number(item.aspectRatio) || 1, .2, 6)}"`;
    const states = `${fresh ? ' is-new' : ''}${picked ? ' is-sel' : ''}`;
    if (summary) return `<article class="cr-e cr-c${states}" ${attrs} title="${_esc(item.description || item.titre || '')}">${mainButton}
      <span class="cr-c-m">${thumb}</span><span class="cr-c-t">${title}</span>${star}${secret}${badge}${check}</article>`;
    const featureLabel = item.featured ? 'Retirer de la une' : 'Mettre à la une';
    return `<article class="cr-e${featured ? ' feat' : ''}${states}" ${attrs}>${mainButton}
      <div class="cr-e-m${item.imageUrl ? '' : ' emp'}">${thumb}<div class="cr-badges">${badge}${secret}</div>
      ${isAdmin && !bulk ? `<div class="cr-qa">
        <button type="button" data-action="editAchievement" data-id="${id}" title="Modifier" aria-label="Modifier">✎</button>
        <button type="button" data-action="_achToggleFeatured" data-id="${id}" title="${featureLabel}" aria-label="${featureLabel}" aria-pressed="${!!item.featured}">☆</button>
      </div>` : ''}</div>
      <div class="cr-e-t"><span class="cr-e-k">${_esc(c.label || 'Haut-Fait')} ${star}</span><h3>${title}</h3>
      ${item.description ? `<p>${chronicleHighlight(item.description, search)}</p>` : ''}
      ${who.length ? `<div class="cr-e-w">${avatars(who, featured ? 24 : 20)}<span title="${_esc(names)}">${_esc(names)}</span></div>` : ''}</div>${check}
      </article>`;
  };
  const sessionRow = s => {
    const date = s.date ? new Date(s.time) : null;
    const debut = people(s.debut);
    const first = debut.length && !summary ? `<div class="cr-deb"><small>Entrée en scène</small>${debut.map(c =>
      `<span style="--ac:${c.chronicleColor}">${_esc(c.nom || '?')}</span>`).join('')}</div>` : '';
    const regular = s.shown.filter(item => !(item.featured && item.imageUrl)).length;
    const columns = Math.min(5, Math.max(1, regular));
    return `<section class="cr-row cr-ses${s.shown.some(isNew) ? ' is-new' : ''}" data-key="${s.key}" aria-label="${date ? long.format(date) : 'Sans date'}">
      <div class="cr-g"><div class="cr-when">${!date ? '<b>—</b><span>Sans date</span>'
        : summary ? `<b>${date.getUTCDate()} ${month.format(date)}</b><small>${weekday.format(date).slice(0, 3)}. · ${date.getUTCFullYear()}</small>`
          : `<small>${weekday.format(date)}</small><b>${date.getUTCDate()}</b><span>${month.format(date)} ${date.getUTCFullYear()}</span>`}${first}${summary ? '' : addButton(s, false)}</div></div>
      ${rowDecoration()}<div class="cr-main"><div class="cr-es" style="--cr-share:calc((100% - ${12 * (columns - 1)}px) / ${columns})">${s.shown.map(card).join('')}${summary
        ? addButton(s, true) + `<span class="cr-who">${avatars(people(s.shown.flatMap(it => it.contributeurs || [])), 22)}</span>` : ''}</div></div>
    </section>`;
  };
  const chapterRow = chapter => {
    const mission = chapter.mission;
    const dates = chapter.sessions.filter(s => s.date);
    const items = chapter.sessions.flatMap(s => s.shown);
    const art = mission ? mission.imageUrl : items.find(i => i.imageUrl)?.imageUrl;
    const kicker = mission ? [mission.acte, mission.type === 'event' ? 'Événement' : 'Mission', chapter.suite ? 'suite' : ''].filter(Boolean).join(' · ') : 'Interlude · Hors Trame';
    return `<section class="cr-row cr-chap${mission ? '' : ' inter'}">${rowDecoration()}<div class="cr-main"><div class="cr-card">
      ${art ? `<img class="cr-card-art" src="${_esc(art)}" alt="" loading="lazy" decoding="async">` : ''}
      <div class="cr-card-t"><small>${_esc(kicker)}</small><h2>${_esc(mission?.titre || 'Entre deux missions')}</h2>
      <p>${dates.length ? formatRange(dateRange, dates[0].time, dates.at(-1).time) + ' · ' : ''}${count(chapter.sessions.length, 'séance')} · ${facts(items.length)}</p></div>
      </div></div></section>`;
  };
  const actRow = act => {
    const missions = [...new Map(act.sessions.map(s => [s.mission.id, s.mission])).values()];
    const events = missions.filter(m => m.type === 'event').length;
    const label = String(act.label).replace(/^acte\s*/i, '').trim();
    const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const meta = [missions.length > events ? count(missions.length - events, 'mission') : '', events ? count(events, 'événement') : '',
      formatRange(monthRange, act.sessions[0].time, act.sessions.at(-1).time)].filter(Boolean).join(' · ');
    return `<div class="cr-row cr-act"><div class="cr-g"><div class="cr-act-l"><small>ACTE</small><b>${_esc(roman[Number(label)] || label)}</b></div></div>
      ${rowDecoration()}<div class="cr-main"><div class="cr-act-m">${_esc(meta)}</div></div></div>`;
  };
  const rows = model.rows.map(row => {
    if (row.type === 'session') return sessionRow(row.session);
    if (row.type === 'chapter') return chapterRow(row);
    if (row.type === 'act') return actRow(row);
    return `<div class="cr-row cr-gap${row.hidden ? '' : ' real'}" style="--gh:${row.height}px"><div class="cr-main"><span class="cr-gap-l"><span aria-hidden="true">⌛</span> ${row.label} · ${row.duration}</span></div></div>`;
  }).join('');
  const latest = model.dated.at(-1);
  const next = isAdmin && !hasFilters && !bulk ? `<div class="cr-row cr-next" data-key="next">
    <div class="cr-g"><div class="cr-when"><small>Prochaine</small><b>＋</b><span>séance</span></div></div>${rowDecoration()}
    <div class="cr-main"><button type="button" class="cr-next-b" data-action="_achChronicleAdd" data-key="next">
    <span class="cr-next-i" aria-hidden="true">▧</span><span><b>Consigner une nouvelle séance</b><small>Datée d’aujourd’hui${latest?.mission?.titre ? `, rangée dans « ${_esc(latest.mission.titre)} »` : ''} · glissez-y les images de la séance</small></span></button></div></div>` : '';
  const first = model.dated.find(s => s.shown.length);
  const seenItems = model.visible.flatMap(s => s.shown);
  const end = desc && first ? `${cap(long.format(first.time))}${first.mission?.titre ? ' · ' + _esc(first.mission.titre) : ''}`
    : `${count(model.visible.length, 'séance')} · ${facts(seenItems.length)} · ${count(new Set(seenItems.flatMap(i => i.contributeurs || [])).size, 'personnage')}`;
  const dates = model.dated;
  const range = dates.length ? formatRange(monthYear, dates[0].time, dates.at(-1).time) : '';
  const sessionSelect = model.visible.length ? `<select class="cr-session-select" aria-label="Aller à une séance">
    <option value="">Aller à une séance…</option>${model.visible.map(s => `<option value="${s.key}">${s.date ? cap(long.format(s.time)) : 'Sans date'}${s.mission?.titre ? ' · ' + _esc(s.mission.titre) : ''}</option>`).join('')}</select>` : '';
  const track = kind => `<div class="cr-track-wrap${kind === 'mini' ? ' is-mini' : ''}"><div class="fr-tr" ${dates.length ? 'role="slider" tabindex="0" aria-label="Frise des séances"' : ''}>
    ${kind === 'mini' ? model.acts.slice(1).map((a, i) => `<i class="fr-sep" style="left:${position(model, (a.sessions[0].time + model.acts[i].sessions.at(-1).time) / 2)}%"></i>`).join('') :
      model.acts.map(a => lane('fr-a', a.sessions, `<em>${_esc(a.label)}</em>`)).join('') +
      model.chapters.map(c => {
        const title = c.mission?.titre || 'Interlude';
        const art = c.mission?.imageUrl ? `<img src="${_esc(c.mission.imageUrl)}" alt="" loading="lazy" decoding="async">` : '';
        return lane(`fr-m${c.mission ? '' : ' inter'}${c.sessions.some(s => s.shown.length) ? '' : ' off'}`, c.sessions,
          `${art}<span hidden>${_esc(title)}</span>`, title);
      }).join('') +
      model.pauses.map(p => `<span class="fr-p" data-span="${position(model, p.to) - position(model, p.from)}" style="left:${position(model, (p.from + p.to) / 2)}%">${p.label}</span>`).join('')}
    <div class="fr-x"></div>${dates.map((s, i) => bars(s, i, kind)).join('')}<span class="fr-lens" hidden></span><span class="fr-cur" hidden></span>
    </div><div class="fr-tip" hidden></div></div>`;
  function lane(cls, sessions, content, title = '') {
    const dated = sessions.filter(s => s.date);
    if (!dated.length) return '';
    return `<span class="${cls}" title="${_esc(title)}" style="left:${position(model, dated[0].time) - .6}%;width:${position(model, dated.at(-1).time) - position(model, dated[0].time) + 1.2}%">${content}</span>`;
  }
  function bars(s, i, kind) {
    const totals = new Map(), shown = new Map();
    for (const [items, dest] of [[s.entries, totals], [s.shown, shown]]) for (const item of items) {
      const cat = categoryFor(item);
      dest.set(cat?.id, (dest.get(cat?.id) || 0) + 1);
    }
    const compact = kind === 'mini', max = compact ? 20 : 46;
    const segments = [false, true].flatMap(dim => categories.flatMap(c => {
      const visible = shown.get(c.id) || 0, hidden = (totals.get(c.id) || 0) - visible;
      const n = dim ? hidden : visible;
      return n ? [{ n, dim, c }] : [];
    }));
    const spacing = Math.min(1, max / (2 * Math.max(1, segments.length)));
    const unit = Math.min(compact ? 4.5 : 10, (max - spacing * Math.max(0, segments.length - 1)) / s.entries.length);
    return `<span class="fr-s${s.entries.some(isNew) ? ' is-new' : ''}" data-key="${s.key}" style="left:${position(model, s.time)}%;--d:${i * 16}ms;gap:${spacing}px">${segments.map(({ n, dim, c }) =>
      `<i${dim ? ' class="off"' : ''} style="--c:${color(c.color)};height:${n * unit}px"></i>`).join('')}</span>`;
  }
  const scale = dates.length ? `<section class="cr-fr" aria-label="Toute la campagne">
    <div class="fr-h"><b>${cap(range)}</b><span>${hasFilters ? `${facts(seenItems.length)} dans ${count(model.visible.length, 'séance')} sur ${model.sessions.length}` : `${count(model.sessions.length, 'séance')} · ${facts(seenItems.length)}`}</span>
    <div class="fr-lg">${categories.map(c => `<span style="--c:${color(c.color)}"><i></i>${_esc(c.label)}</span>`).join('')}</div>${sessionSelect}</div>${track('big')}</section>`
    : sessionSelect ? `<section class="cr-fr"><div class="fr-h"><b>Chronique sans date</b>${sessionSelect}</div></section>` : '';
  return {
    html: `<div class="cr${summary ? ' is-sm' : ''}${animate ? ' cr-anim' : ''}">${scale}${news}${bulkBar}
      <div class="cr-flow">${desc ? next : ''}${rows}${!desc ? next : ''}</div>
      ${!model.visible.length && hasFilters ? '<div class="hall-empty"><div class="hall-empty-title">Aucun résultat dans la chronique</div></div>' : ''}
      <footer class="ach-fresque-end cr-end"><span>✦</span><strong>${desc ? 'Tout a commencé ici' : 'À suivre…'}</strong><p>${end}</p><div>
        ${hasFilters ? '<button type="button" data-action="_achResetFilters">Voir toute la chronique</button>' : ''}
        <button type="button" data-action="_achScrollTop">Revenir en haut</button></div></footer></div>`,
    compact: dates.length ? track('mini') : '',
  };
}

export function bindChronicle(root, compact, model, { getScroll, getInset, categoryFor, onCurrent }) {
  const tracks = [root, compact].flatMap(el => [...el.querySelectorAll('.fr-tr')]);
  const flow = root.querySelector('.cr-flow');
  const rows = [...flow.querySelectorAll('.cr-ses')];
  const byKey = new Map(model.visible.map(s => [s.key, s]));
  const dated = model.dated.filter(s => s.shown.length);
  const listeners = new AbortController();
  const { signal } = listeners;
  const listen = (el, event, fn) => el.addEventListener(event, fn, { signal });
  const sessionSelect = root.querySelector('.cr-session-select');
  let geometry, active, points = [], viewport = {};
  const nearest = (time, sessions) => sessions.reduce((best, s) =>
    !best || Math.abs(s.time - time) < Math.abs(best.time - time) ? s : best, null);
  const rect = host => host === document.scrollingElement
    ? { top: 0, bottom: innerHeight } : host.getBoundingClientRect();
  function measure() {
    const { host, top } = getScroll();
    if (!host) return;
    if (geometry?.host === host) return;
    viewport = rect(host);
    geometry = { host };
    points = rows.map(el => {
      const bounds = el.getBoundingClientRect();
      const session = byKey.get(el.dataset.key);
      return { el, session, time: session.time, top: bounds.top - viewport.top + top, bottom: bounds.bottom - viewport.top + top };
    });
    geometry.dated = points.filter(p => p.session.date);
  }
  function scrollTo(y, smooth) {
    getScroll().host?.scrollTo({ top: Math.max(0, y), behavior: smooth && !prefersStill() ? 'smooth' : 'instant' });
  }
  function jump(key) {
    measure();
    const point = points.find(p => p.session.key === key);
    if (!point) return;
    let target = point.el;
    while (target.previousElementSibling?.matches('.cr-chap,.cr-act')) target = target.previousElementSibling;
    const { host, top } = getScroll();
    scrollTo(top + target.getBoundingClientRect().top - rect(host).top - getInset() - 6, true);
  }
  if (sessionSelect) listen(sessionSelect, 'change', () => {
    if (sessionSelect.value) jump(sessionSelect.value);
    // Laisser le même choix disponible si on remonte dans la frise.
    sessionSelect.value = '';
  });
  const bars = tracks.map(tr => new Map([...tr.querySelectorAll('.fr-s')].map(el => [el.dataset.key, el])));
  const lenses = tracks.map(tr => tr.querySelector('.fr-lens'));
  function sync() {
    if (!root.isConnected) return;
    measure();
    if (!geometry) return;
    const { host, top, height } = getScroll(), inset = getInset();
    const at = (y) => interpolateChronicle(geometry.dated, y, 'top', 'time');
    const a = at(top + inset + 12), b = at(top + Math.max(inset + 12, height - 12));
    const left = a != null ? position(model, Math.min(a, b)) : 0;
    const width = a != null ? Math.max(.8, position(model, Math.max(a, b)) - left) : 0;
    for (const lens of lenses) {
      lens.hidden = !width;
      lens.style.left = `${left}%`;
      lens.style.width = `${Math.min(100 - left, width)}%`;
    }

    let lo = 0, hi = points.length, threshold = top + inset + 60;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].bottom > threshold) hi = mid;
      else lo = mid + 1;
    }
    const atEnd = top > 0 && top + height >= host.scrollHeight - 2;
    const current = atEnd ? points.at(-1) : points[Math.min(lo, points.length - 1)];
    if (active && current?.session === active.session) return;
    active?.el?.classList.remove('cur');
    current?.el.classList.add('cur');
    const cursor = current?.session.date ? current.session : dated.at(-1);
    tracks.forEach((tr, i) => {
      if (active?.session) bars[i].get(active.session.key)?.classList.remove('cur');
      bars[i].get(current?.session.key)?.classList.add('cur');
      const index = dated.indexOf(cursor);
      tr.setAttribute('aria-valuemin', '1');
      tr.setAttribute('aria-valuemax', String(Math.max(1, dated.length)));
      tr.setAttribute('aria-valuenow', String(Math.max(1, index + 1)));
      tr.setAttribute('aria-valuetext', cursor ? long.format(cursor.time) : 'Aucune séance visible');
      tr.setAttribute('aria-disabled', String(!dated.length));
    });
    active = current || { session: null };
    const s = current?.session;
    onCurrent(s ? {
      key: s.key, day: s.date ? new Date(s.time).getUTCDate() : '—',
      month: s.date ? month.format(s.time).replace('.', '').toUpperCase() : '',
      mission: s.mission?.titre || 'Hors Trame', label: s.date ? cap(long.format(s.time)) : 'Sans date',
      position: `${model.visible.indexOf(s) + 1}/${model.visible.length}`,
    } : null);
  }
  const layoutAxis = tr => {
    const width = tr.clientWidth;
    if (!width || tr._chronicleWidth === width) return;
    tr._chronicleWidth = width;
    const axis = tr.querySelector('.fr-x');
    const origin = new Date(model.start);
    const startMonth = origin.getUTCFullYear() * 12 + origin.getUTCMonth();
    const end = new Date(model.end);
    const endMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
    const span = endMonth - startMonth;
    const byYear = span > 60;
    const initial = byYear ? String(origin.getUTCFullYear()) : `${month.format(origin)} ${origin.getUTCFullYear()}`;
    const textWidth = str => str.length * 6.2 + 10;
    const pxPerMonth = width * DAY * 30.44 / (model.end - model.start);
    const every = pxPerMonth >= 46 ? 1 : pxPerMonth >= 26 ? 2 : pxPerMonth >= 16 ? 3 : 6;
    let edge = textWidth(initial);
    let html = `<span class="fr-tl" style="left:0">${initial}</span>`;
    // Les dates archivées ou atypiques ne doivent pas créer des milliers de graduations.
    const yearStride = Math.max(1, Math.ceil(span / 12 / Math.max(1, width / 48)));
    const stride = byYear ? yearStride * 12 : 1;
    const firstTick = byYear ? (Math.floor(origin.getUTCFullYear() / yearStride) + 1) * stride : startMonth + 1;
    const base = new Date(0);
    for (let cursor = firstTick; cursor <= endMonth; cursor += stride) {
      const year = Math.floor(cursor / 12), m = cursor - year * 12;
      const time = base.setUTCFullYear(year, m, 1);
      if (time > model.end) break;
      const x = position(model, time), px = x * width / 100;
      const label = month.format(time) + (m === 0 ? ` ${year}` : '');
      html += `<i class="fr-t${m === 0 ? ' y' : ''}" style="left:${x}%"></i>`;
      if ((stride > 1 || m === 0 || m % every === 0) && px >= edge && px + textWidth(label) <= width) {
        html += `<span class="fr-tl" style="left:${x}%">${label}</span>`;
        edge = px + textWidth(label);
      }
    }
    axis.innerHTML = html;
    for (const pause of tr.querySelectorAll('.fr-p')) pause.hidden = Number(pause.dataset.span) * width / 100 < textWidth(pause.textContent) + 8;
    for (const label of tr.querySelectorAll('.fr-m > span')) label.hidden = label.parentElement.clientWidth < 68;
  };
  tracks.forEach((tr, i) => {
    const tip = tr.nextElementSibling, cursor = tr.querySelector('.fr-cur');
    let pointer, hovered, keyboardIndex, keyboardTime, dragFrame;
    const timeAt = (x, bounds) => model.start + (model.end - model.start) * clamp((x - bounds.left) / Math.max(1, bounds.width), 0, 1);
    const show = (x, bounds) => {
      const s = nearest(timeAt(x, bounds), model.dated);
      if (!s || s === hovered) return;
      bars[i].get(hovered?.key)?.classList.remove('hov');
      bars[i].get(s.key)?.classList.add('hov');
      hovered = s;
      const left = position(model, s.time);
      cursor.style.left = `${left}%`;
      cursor.hidden = false;
      const detail = !s.shown.length ? 'Masquée par les filtres'
        : s.entries.length === s.shown.length ? facts(s.entries.length) : `${s.shown.length} sur ${facts(s.entries.length)}`;
      tip.innerHTML = `<div class="fr-tip-th">${s.entries.slice(0, 4).map(it => `<span>${it.imageUrl ? image(it) : _esc(it.emoji || categoryFor(it)?.emoji || '✦')}</span>`).join('')}</div>
        <div class="fr-tip-t"><small>${long.format(s.time)}</small><b>${_esc(s.mission?.titre || 'Hors Trame')}</b><span>${detail}</span></div>`;
      tip.hidden = false;
      tip.style.left = `${clamp(bounds.width * left / 100 - tip.offsetWidth / 2, 0, Math.max(0, bounds.width - tip.offsetWidth))}px`;
    };
    const hide = () => {
      bars[i].get(hovered?.key)?.classList.remove('hov');
      hovered = null;
      tip.hidden = cursor.hidden = true;
    };
    listen(tr, 'pointerdown', e => {
      if (e.button !== 0 || !e.isPrimary || !dated.length) return;
      pointer = { id: e.pointerId, x: e.clientX, bounds: tr.getBoundingClientRect(), dragging: false };
      tr.setPointerCapture?.(e.pointerId);
    });
    const seek = (x, bounds) => {
      if (!root.isConnected) return;
      measure();
      const y = interpolateChronicle(geometry?.dated || [], timeAt(x, bounds), 'time', 'top');
      if (y != null) scrollTo(y - getInset() - 12, false);
    };
    listen(tr, 'pointermove', e => {
      const bounds = pointer?.bounds || tr.getBoundingClientRect();
      show(e.clientX, bounds);
      if (pointer?.id !== e.pointerId) return;
      if (Math.abs(e.clientX - pointer.x) > 4) pointer.dragging = true;
      if (!pointer.dragging) return;
      if (dragFrame) cancelAnimationFrame(dragFrame);
      dragFrame = requestAnimationFrame(() => seek(e.clientX, bounds));
    });
    const end = e => {
      if (pointer?.id !== e.pointerId) return;
      if (dragFrame) cancelAnimationFrame(dragFrame);
      if (e.type === 'pointerup') {
        if (pointer.dragging) seek(e.clientX, pointer.bounds);
        else jump(nearest(timeAt(e.clientX, pointer.bounds), dated)?.key);
      }
      pointer = null;
      hide();
    };
    listen(tr, 'pointerup', end);
    listen(tr, 'pointercancel', end);
    listen(tr, 'lostpointercapture', end);
    listen(tr, 'pointerleave', () => { if (!pointer) hide(); });
    listen(tr, 'keydown', e => {
      if (!dated.length || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      // Garder le pas du clavier même si le scroll précédent est encore animé.
      const index = performance.now() - keyboardTime < 650 ? keyboardIndex : Math.max(0, dated.indexOf(active?.session));
      keyboardIndex = clamp(e.key === 'Home' ? 0 : e.key === 'End' ? dated.length - 1 : index + (e.key === 'ArrowRight' ? 1 : -1), 0, dated.length - 1);
      keyboardTime = performance.now();
      jump(dated[keyboardIndex].key);
    });
  });
  const resize = () => {
    geometry = null;
    const [mainTrack, miniTrack] = tracks;
    if (mainTrack?.clientWidth && miniTrack?.clientWidth) {
      // L'ascenseur natif réduit la largeur du contenu, pas celle du bandeau fixe.
      const bounds = mainTrack.getBoundingClientRect();
      const offset = bounds.left - compact.getBoundingClientRect().left;
      compact.style.setProperty('--cr-track-width', `${bounds.width}px`);
      compact.style.setProperty('--cr-track-left', `${offset}px`);
    }
    tracks.forEach(layoutAxis);
    sync();
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(flow);
  tracks.forEach(tr => observer?.observe(tr));
  listen(window, 'resize', resize);
  resize();
  return { sync, jump, dispose: () => { listeners.abort(); observer?.disconnect(); } };
}

export function chroniclePreset(model, key, today) {
  const next = key === 'next';
  const session = next ? model?.dated.at(-1) : model?.visible.find(s => s.key === key);
  if (!next && !session) return null;
  return {
    date: next ? today : session.date,
    missionId: session?.mission?.id || '',
    context: next ? 'Nouvelle séance' : session.date ? `Séance du ${short.format(session.time)}` : 'Séance sans date',
    suggestedContributors: session?.contributors || [],
  };
}
