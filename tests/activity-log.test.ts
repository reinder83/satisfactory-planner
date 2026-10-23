// Co-op slice 5 (#1214, part of #1077): the activity log of who ticked what. It is built only from
// the records the ticks already carry (`tickedBy`, #1206) and the step titles the plan lists
// (app/activity-log.ts): newest first, one person's ticks when a name is picked (trimmed, any case),
// a record without a name as "Ticked", and no entry for a record whose step is not ticked any more
// or that the plan no longer lists. The page is in tests/ui/activity-log.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_PAGE,
  activityEntries,
  activityPeople,
  activityWho,
  activityWords,
  type LoggedStep,
} from '../public/app/activity-log.ts';
import { tickedAt } from '../public/app/ticked-by.ts';
import type { TickRecord } from '../public/types/index.ts';

const STEPS: LoggedStep[] = [
  { id: 'calc-3-plate', title: 'Build 4 Constructors (Iron Plate)', phase: '3' },
  { id: 'calc-3-rod', title: 'Build 2 Constructors (Iron Rod)', phase: '3' },
  { id: 'calc-3-wire', title: 'Build 3 Constructors (Wire)', phase: '3' },
  { id: 'custom-1', title: 'Build the train station', phase: '3' },
  // Post Phase 5 lists Phase 5's production steps under the same ids: the first listing names it.
  { id: 'calc-5-motor', title: 'Build 2 Assemblers (Motor)', phase: '5' },
  { id: 'calc-5-motor', title: 'Build 2 Assemblers (Motor)', phase: 'post' },
];
const at = (time: string, by?: string): TickRecord => ({
  at: `2026-10-21T${time}:00.000Z`,
  ...(by ? { by } : {}),
});
const ids = (entries: { id: string }[]) => entries.map(entry => entry.id);

test('the log lists the recorded ticks newest first, with who and when', () => {
  const progress = {
    checks: { 'calc-3-plate': true, 'calc-3-rod': true, 'custom-1': true, 'calc-5-motor': true },
    tickedBy: {
      'calc-3-plate': at('12:05', 'Anna'),
      'calc-3-rod': at('14:30', 'Bram'),
      'custom-1': at('09:00', 'Anna'),
      'calc-5-motor': at('13:00', 'Bram'),
    },
  };
  const entries = activityEntries(progress, STEPS);
  assert.deepEqual(ids(entries), ['calc-3-rod', 'calc-5-motor', 'calc-3-plate', 'custom-1']);
  assert.deepEqual(entries[0], {
    id: 'calc-3-rod',
    title: 'Build 2 Constructors (Iron Rod)',
    phase: '3',
    at: '2026-10-21T14:30:00.000Z',
    by: 'Bram',
  });
  assert.equal(entries[1]!.phase, '5', 'a step shared with Post Phase 5 is under Phase 5');
  const now = new Date('2026-10-23T10:00:00.000Z');
  assert.equal(
    activityWords(entries[2]!, now, 'en-US'),
    `Anna ticked Build 4 Constructors (Iron Plate), ${tickedAt(entries[2]!.at, now, 'en-US')}`,
  );
  // The date and time in the locale's own format, the year only when it is not this year's.
  assert.match(tickedAt('2026-10-21T12:05:00.000Z', now, 'en-US'), /^Oct 21, \d{1,2}:05\s?[AP]M$/);
  assert.match(tickedAt('2025-10-21T12:05:00.000Z', now, 'en-US'), /^Oct 21, 2025, /);
  assert.equal(tickedAt('not a time', now, 'en-US'), '');
});

test('ticks made at the same moment keep the plan’s order', () => {
  const same = at('10:00', 'Anna');
  const progress = {
    checks: { 'calc-3-wire': true, 'calc-3-plate': true, 'calc-3-rod': true },
    tickedBy: { 'calc-3-wire': same, 'calc-3-plate': same, 'calc-3-rod': same },
  };
  assert.deepEqual(ids(activityEntries(progress, STEPS)), [
    'calc-3-plate',
    'calc-3-rod',
    'calc-3-wire',
  ]);
});

test('the person filter keeps one name’s ticks, whatever its case; the names list each once', () => {
  const progress = {
    checks: { 'calc-3-plate': true, 'calc-3-rod': true, 'calc-3-wire': true, 'custom-1': true },
    tickedBy: {
      'calc-3-plate': at('12:00', 'Anna'),
      'calc-3-rod': at('13:00', 'bram'),
      'calc-3-wire': at('14:00', ' anna '),
      'custom-1': at('15:00'),
    },
  };
  const all = activityEntries(progress, STEPS);
  assert.deepEqual(activityPeople(all), ['anna', 'bram'], 'the newest spelling, trimmed, sorted');
  assert.deepEqual(ids(activityEntries(progress, STEPS, 'ANNA')), ['calc-3-wire', 'calc-3-plate']);
  assert.deepEqual(ids(activityEntries(progress, STEPS, 'Bram')), ['calc-3-rod']);
  assert.deepEqual(activityEntries(progress, STEPS, 'Carla'), []);
  assert.deepEqual(ids(activityEntries(progress, STEPS, '')), ids(all), 'no name is everyone');
});

test('a record without a name says "Ticked"', () => {
  const progress = { checks: { 'custom-1': true }, tickedBy: { 'custom-1': at('09:00') } };
  const [entry] = activityEntries(progress, STEPS);
  assert.ok(entry);
  assert.equal('by' in entry, false);
  assert.equal(activityWho(entry), 'Ticked');
  const now = new Date('2026-10-23T10:00:00.000Z');
  assert.match(activityWords(entry, now, 'en-US'), /^Ticked Build the train station, Oct 21, /);
  assert.deepEqual(activityPeople([entry]), [], 'no name to filter by');
});

test('records of steps no longer listed, or no longer ticked, are left out; nothing else changes', () => {
  const progress = {
    checks: { 'calc-3-plate': true, 'calc-3-rod': false, 'calc-2-gone': true, 'custom-1': true },
    tickedBy: {
      'calc-3-plate': at('12:00', 'Anna'),
      // Unticked since (validateState drops such a record; the log ignores it all the same).
      'calc-3-rod': at('13:00', 'Anna'),
      // A step a recalculation or a removal took out of the plan.
      'calc-2-gone': at('14:00', 'Anna'),
      'calc-3-wire': at('15:00', 'Anna'),
      // Not a time.
      'custom-1': { at: 'yesterday', by: 'Anna' },
    },
  };
  const before = structuredClone(progress);
  assert.deepEqual(ids(activityEntries(progress, STEPS)), ['calc-3-plate']);
  assert.deepEqual(progress, before, 'the log only reads');
  assert.deepEqual(activityEntries({ checks: { 'calc-3-plate': true } }, STEPS), [], 'no records');
  assert.equal(ACTIVITY_PAGE, 50);
});
