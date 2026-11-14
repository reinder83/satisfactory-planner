// ADA's chatter setting, moods and event remarks (#1353): the setting's stored values and what an
// old Mute switch becomes, which remarks are essential, the lines of each event and what a saved
// change tells her.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADA_CHATTERS,
  adaChatterFrom,
  adaChatterStored,
  adaEventLine,
  adaHeldBack,
  adaMood,
  adaRemarks,
  adaRuleLevels,
  adaStamp,
  type AdaEventKind,
  type AdaFacts,
} from '../public/ada.ts';
import { adaEventsOf, adaPhaseEvents } from '../public/app/ada-events.ts';
import type { ProgressState, UpdateOp } from '../public/types/index.ts';

test('an old Mute switch becomes Off, an old Unmute Chatty, and nothing stored Essential', () => {
  assert.equal(adaChatterFrom('muted'), 'off');
  assert.equal(adaChatterFrom('on'), 'chatty');
  assert.equal(adaChatterFrom(null), 'essential');
  assert.equal(adaChatterFrom(undefined), 'essential');
  assert.equal(adaChatterFrom('loud'), 'essential');
  assert.equal(adaChatterFrom(''), 'essential');
});

test('every setting round-trips through what is stored, and the old reading still follows it', () => {
  for (const chatter of ADA_CHATTERS)
    assert.equal(adaChatterFrom(adaChatterStored(chatter)), chatter);
  // Before #1353 a build read only `=== 'muted'`: going back to it keeps Off muted and the others on.
  const oldReading = (stored: string) => stored === 'muted';
  assert.equal(oldReading(adaChatterStored('off')), true);
  assert.equal(oldReading(adaChatterStored('essential')), false);
  assert.equal(oldReading(adaChatterStored('chatty')), false);
});

const facts = (over: Partial<AdaFacts> = {}) => ({
  view: 'plan',
  phaseLabel: 'Phase 3',
  kind: 'calculated',
  save: 'World',
  profile: 'Balanced',
  steps: { done: 4, total: 10 },
  next: 'Steel',
  retireOpen: 0,
  factories: { done: 2, total: 6 },
  storage: { done: 8, total: 8 },
  deliveries: { open: 0, total: 2 },
  hasPhaseNote: true,
  customTasks: 0,
  removedSteps: 0,
  groups: 1,
  groupedSteps: false,
  feasible: true,
  reason: '',
  short: [],
  power: null,
  hours: '',
  profiles: 2,
  browserMode: false,
  backupDays: null,
  planEditing: false,
  ...over,
});

test('problems, milestones and data loss are essential; plain observations and idle lines are not', () => {
  const problem = adaRemarks(facts({ feasible: false, reason: 'Iron Ore budget exceeded.' }));
  assert.equal(problem[0]!.id, 'draft');
  assert.equal(problem[0]!.essential, true);
  const never = adaRemarks(facts({ view: 'backup', browserMode: true, backupDays: null }));
  assert.equal(never.find(r => r.id === 'backup-never')?.essential, true);
  const done = adaRemarks(
    facts({ steps: { done: 10, total: 10 }, factories: { done: 6, total: 6 } }),
  );
  assert.equal(done.find(r => r.id === 'flawless')?.essential, true);
  const calm = adaRemarks(facts());
  assert.equal(calm.find(r => r.id === 'next')?.essential, false);
  assert.ok(calm.filter(r => r.id.startsWith('idle-')).every(r => !r.essential));
  assert.equal(adaRemarks(facts({ kind: 'none' })).find(r => r.id === 'no-save')?.essential, true);
});

// The calm lines Essential still says (#1353): a new calm line is said at Chatty only unless it is
// added here, on purpose. Warnings and praise are always essential.
const ESSENTIAL_CALM = [
  'no-save',
  'build-dry',
  'unplaced',
  'site-review',
  'sloop-pins-pending',
  'shard-pins-pending',
  'backup-old',
  'progress-restored-back',
  'imported',
];

test('every warning and the important calm lines are said at Essential and held at Off', () => {
  const levels = adaRuleLevels();
  const warn = levels.filter(rule => rule.tone === 'warn');
  assert.ok(warn.length >= 15, 'the warnings are all listed');
  for (const rule of warn) {
    assert.equal(rule.essential, true, rule.id);
    assert.equal(
      adaHeldBack({ ...rule, text: '' }),
      true,
      rule.id + ' waits behind the dot at Off',
    );
  }
  assert.deepEqual(
    levels.filter(rule => rule.tone === 'calm' && rule.essential).map(rule => rule.id),
    ESSENTIAL_CALM,
  );
  for (const id of ESSENTIAL_CALM.filter(id => id !== 'no-save'))
    assert.equal(adaHeldBack({ id, tone: 'calm', text: '', essential: true }), true, id);
  // Praise is said at Essential, but a milestone does not wait behind Off's dot; nor does no-save.
  for (const rule of levels.filter(rule => rule.tone === 'praise')) {
    assert.equal(rule.essential, true, rule.id);
    assert.equal(adaHeldBack({ ...rule, text: '' }), false, rule.id);
  }
  assert.equal(adaHeldBack({ id: 'no-save', tone: 'calm', text: '', essential: true }), false);
});

test('a backup growing old, a restore that took steps back, pending pins and an import are essential', () => {
  const said = (over: Partial<AdaFacts>, id: string) =>
    adaRemarks(facts(over)).find(line => line.id === id);
  const lines = [
    said({ view: 'backup', browserMode: true, backupDays: 30 }, 'backup-old'),
    said(
      { view: 'backup', restored: { words: 'Restored, 3 steps back.', good: false } },
      'progress-restored-back',
    ),
    said({ sloopPinsPending: 2 }, 'sloop-pins-pending'),
    said({ shardPinsPending: 1 }, 'shard-pins-pending'),
    said({ view: 'profiles', imported: '“Friend”' }, 'imported'),
  ];
  for (const line of lines) {
    assert.ok(line, 'the line applies');
    assert.equal(line.essential, true, line.id);
    assert.equal(line.tone, 'calm', line.id + ' keeps its calm tone');
    assert.equal(adaHeldBack(line), true, line.id);
  }
  // A merge only adds ticks and asks nothing: Chatty only.
  const merged = said(
    { view: 'backup', merged: 3, mergedFrom: '“friend.json”' },
    'progress-merged',
  );
  assert.equal(merged?.essential, false);
});

test('a mood follows the tone and a stamp the line', () => {
  assert.equal(adaMood({ id: 'draft', tone: 'warn', text: '' }), 'concerned');
  assert.equal(adaMood({ id: 'complete', tone: 'praise', text: '' }), 'satisfied');
  assert.equal(adaMood({ id: 'next', tone: 'calm', text: '' }), 'observant');
  assert.equal(adaMood({ id: 'idle-3', tone: 'calm', text: '' }), 'idle');
  assert.equal(adaMood({ id: 'fault-1', tone: 'fault', text: '' }), 'garbled');
  assert.equal(
    adaMood({ id: 'event-late-step', tone: 'calm', mood: 'amused', text: '' }),
    'amused',
  );
  const stamp = adaStamp({ id: 'backup-never', tone: 'warn', text: '' });
  assert.match(stamp, /^LOG \d{4} · DATA INTEGRITY$/);
  assert.equal(adaStamp({ id: 'backup-never', tone: 'warn', text: '' }), stamp, 'stable');
});

const KINDS: AdaEventKind[] = [
  'backup',
  'first-step',
  'hundred-steps',
  'late-step',
  'line-running',
  'part-delivered',
  'phase-back',
  'profile-removed',
  'past-phase-four',
];
test('every event line is short, as the brief wrote it, with no hole in it', () => {
  for (const kind of KINDS) {
    const line = adaEventLine(kind, {
      name: 'Versatile Framework',
      count: '125,000 of 125,000',
      time: '02:14',
    })!;
    assert.ok(line, kind);
    // The brief's own lines run to three short sentences in places, though it also says two; they are used as written (#1353).
    const sentences = line.text.split(/(?<=[.!?])\s+(?=[A-Z“])/).filter(Boolean);
    assert.ok(sentences.length <= 3 || kind === 'past-phase-four', `${kind}: ${line.text}`);
    assert.ok(!line.text.includes('undefined'), kind);
  }
  assert.match(adaEventLine('late-step', { time: '02:14' })!.text, /^It is 02:14\./);
  // Only data loss and milestones are said at Essential.
  assert.deepEqual(
    KINDS.filter(kind => adaEventLine(kind, { name: 'x', count: 'y' })!.essential),
    ['backup', 'part-delivered'],
  );
});

// A small progress state: only checks, deliveries and the phase matter here.
const progress = (checks: Record<string, boolean>, over: Partial<ProgressState> = {}) => {
  const partial: Partial<ProgressState> = {
    checks,
    deliveries: {},
    settings: { phase: '3' },
    ...over,
  };
  return partial as ProgressState;
};
const names = { line: (key: string) => 'Line ' + key, parts: () => [] };
const at = (hour: number) => new Date(2026, 10, 14, hour, 14);
const events = (op: UpdateOp, before: ProgressState, after: ProgressState, now = at(14)) =>
  adaEventsOf(op, before, after, now, names).map(call => call.kind);

test('the first tick, the hundredth and a tick in the small hours each have an event', () => {
  const tick: UpdateOp = { type: 'check', key: 'a', value: true };
  assert.deepEqual(events(tick, progress({}), progress({ a: true })), ['first-step']);
  assert.deepEqual(events(tick, progress({ a: true }), progress({ a: true, b: true })), []);
  const many = (count: number) =>
    Object.fromEntries([...Array(count)].map((_, i) => ['k' + i, true]));
  assert.deepEqual(events(tick, progress(many(99)), progress(many(100))), ['hundred-steps']);
  assert.deepEqual(events(tick, progress(many(100)), progress(many(101))), []);
  assert.deepEqual(events(tick, progress(many(5)), progress(many(6)), at(2)), ['late-step']);
  assert.deepEqual(events(tick, progress(many(5)), progress(many(6)), at(0)), [], 'before 01:00');
  assert.deepEqual(
    events(tick, progress(many(5)), progress(many(6)), at(5)),
    [],
    'after the night',
  );
  // Unticking is no event.
  assert.deepEqual(
    events({ type: 'check', key: 'a', value: false }, progress({ a: true }), progress({}), at(2)),
    [],
  );
});

test('a production line marked running has an event, a bulk tick of many does not', () => {
  const one = events(
    { type: 'check', key: 'calc-3-iron', value: true },
    progress({ x: true }),
    progress({ x: true, 'calc-3-iron': true }),
  );
  assert.deepEqual(one, ['line-running']);
  const bulk = events(
    { type: 'checks', keys: ['calc-3-a', 'calc-3-b'], value: true },
    progress({ x: true }),
    progress({ x: true, 'calc-3-a': true, 'calc-3-b': true }),
  );
  assert.deepEqual(bulk, []);
});

test('a part delivered in full, and a phase gone back to or past Phase 4, have events', () => {
  const parts = {
    line: () => '',
    parts: () => [{ name: 'Versatile Framework', count: '125,000 of 125,000' }],
  };
  const delivered = adaEventsOf(
    { type: 'delivery', key: 'k', value: 1 },
    progress({}),
    progress({}),
    at(14),
    parts,
  );
  assert.deepEqual(delivered, [
    {
      kind: 'part-delivered',
      params: { name: 'Versatile Framework', count: '125,000 of 125,000' },
    },
  ]);
  assert.deepEqual(
    adaPhaseEvents('3', '2').map(c => c.kind),
    ['phase-back'],
  );
  assert.deepEqual(
    adaPhaseEvents('post', '4').map(c => c.kind),
    ['phase-back'],
  );
  assert.deepEqual(adaPhaseEvents('3', '4'), []);
  assert.deepEqual(
    adaPhaseEvents('4', '5').map(c => c.kind),
    ['past-phase-four'],
  );
  assert.deepEqual(adaPhaseEvents('5', 'post'), []);
  assert.deepEqual(adaPhaseEvents('3', '3'), []);
  assert.deepEqual(
    events({ type: 'phase', value: '2' }, progress({}), progress({}, { settings: { phase: '2' } })),
    ['phase-back'],
  );
});
