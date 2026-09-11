import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarDayDiff,
  mergeRecurringPreset,
  suggestionPresentation,
  weekDatesFrom,
} from '../assets/js/features/agenda-utils.js';

test('les libellés relatifs comparent les jours et non les heures', () => {
  const today = new Date(2026, 8, 11, 0, 0, 0);
  assert.equal(calendarDayDiff(new Date(2026, 8, 11, 12, 0, 0), today), 0);
  assert.equal(calendarDayDiff(new Date(2026, 8, 12, 12, 0, 0), today), 1);
  assert.equal(calendarDayDiff(new Date(2026, 8, 13, 23, 59, 0), today), 2);
});

test('le calcul reste exact autour d’un changement d’heure', () => {
  assert.equal(
    calendarDayDiff(new Date(2026, 2, 30, 12, 0, 0), new Date(2026, 2, 29, 0, 0, 0)),
    1,
  );
});

test('un raccourci récurrent complète la semaine sans effacer les choix existants', () => {
  const source = { mon: { m: 'no' }, tue: { a: 'maybe' } };
  const result = mergeRecurringPreset(source, 'evenings');

  assert.deepEqual(result.mon, { m: 'no', s: 'ok' });
  assert.deepEqual(result.tue, { a: 'maybe', s: 'ok' });
  assert.equal(result.sun.s, 'ok');
  assert.deepEqual(source, { mon: { m: 'no' }, tue: { a: 'maybe' } });
});

test('le raccourci week-end ne modifie pas les jours de semaine', () => {
  const result = mergeRecurringPreset({ wed: { s: 'no' } }, 'weekends');
  assert.deepEqual(result.wed, { s: 'no' });
  assert.deepEqual(result.sat, { m: 'ok', a: 'ok', s: 'ok' });
  assert.deepEqual(result.sun, { m: 'ok', a: 'ok', s: 'ok' });
});

test('le libellé majorité exige une majorité réelle', () => {
  assert.deepEqual(
    suggestionPresentation({ okCount: 1, total: 4, missingCount: 3 }),
    { key: 'partial', label: 'En attente de 3' },
  );
  assert.deepEqual(
    suggestionPresentation({ okCount: 3, total: 4, missingCount: 1 }),
    { key: 'partial', label: 'Majorité' },
  );
});

test('une semaine mobile commence le lundi et respecte la navigation', () => {
  const dates = weekDatesFrom(new Date('2026-08-21T12:00:00'), 1);
  assert.equal(dates[0].getDay(), 1);
  assert.equal(dates[0].getDate(), 24);
  assert.equal(dates[6].getDate(), 30);
});
