// What was left of ADA's event-triggered remarks (#1353): the button on each problem remark, the
// retirement remark trimmed to two sentences, and the triggers whose data the app already has
// (thin power headroom, stations without train lines, an unknown
// route; never backed up reads stronger from 50 ticks, inside the existing remark).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaRemarks, type AdaFacts, type AdaLine } from '../public/ada.ts';

const baseFacts = (over: Partial<AdaFacts> = {}) =>
  ({
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
  }) as Partial<AdaFacts>;
const lineOf = (over: Partial<AdaFacts>, id: string): AdaLine | undefined =>
  adaRemarks(baseFacts(over)).find(line => line.id === id);
const sentences = (text: string) => text.split(/[.!?](?:\s|$)/).filter(part => part.trim()).length;

test('each problem remark that names a fix carries one button to it', () => {
  const power = { required: '9 MW', spare: '1 MW', headroom: '2 MW', tight: true };
  const factories = { label: 'Open factories', view: 'factories' };
  const plan = { label: 'Open build plan', view: 'plan' };
  const cases: [string, Partial<AdaFacts>, { label: string; view: string }][] = [
    ['draft', { view: 'plan', feasible: false }, { label: 'Open profiles', view: 'profiles' }],
    [
      'draft-map',
      {
        view: 'plan',
        feasible: false,
        mapShort: { name: 'Iron', needed: '9', map: '5' } as AdaFacts['mapShort'],
      },
      { label: 'Open resources', view: 'resources' },
    ],
    ['power', { view: 'factories', power }, plan],
    [
      'build-waiting',
      { view: 'plan', build: { waiting: ['Coated Iron Plate'], shortOf: ['Plastic'] } as never },
      factories,
    ],
    [
      'build-dry',
      { view: 'plan', build: { built: 2, share: 0, next: 'Wire', waiting: [] } as never },
      factories,
    ],
    ['on-site-pending', { view: 'plan', onSitePending: true }, factories],
    ['exact-clocks-pending', { view: 'plan', exactClocksPending: 2 }, factories],
    ['sloop-pins-pending', { view: 'plan', sloopPinsPending: 1 }, factories],
    ['shard-pins-pending', { view: 'plan', shardPinsPending: 1 }, factories],
    [
      'sloop-pins-dropped',
      { view: 'factories', sloopPinsDropped: { count: 1, lines: 'Wire' } },
      plan,
    ],
    [
      'shard-pins-dropped',
      { view: 'factories', shardPinsDropped: { count: 1, lines: 'Wire' } },
      plan,
    ],
    ['note-conflict', { view: 'plan', noteConflicts: 1 }, { label: 'Open notes', view: 'notes' }],
  ];
  for (const [id, over, action] of cases) {
    const line = lineOf(over, id);
    assert.ok(line, id + ' applies');
    assert.deepEqual(line.action, action, id);
  }
});

test('a button that opens the page already shown is left out', () => {
  assert.equal(
    lineOf({ view: 'factories', onSitePending: true }, 'on-site-pending')!.action,
    undefined,
  );
  assert.equal(lineOf({ view: 'notes', noteConflicts: 1 }, 'note-conflict')!.action, undefined);
});

test('the backup warnings press Export all saves, and a restore says See changes', () => {
  const never = lineOf({ view: 'backup', browserMode: true, backupDays: null }, 'backup-never')!;
  assert.deepEqual(never.action, {
    label: 'Export all saves',
    view: 'backup',
    target: '[data-export-saves]',
  });
  assert.equal(
    lineOf({ view: 'backup', browserMode: true, backupDays: 20 }, 'backup-old')!.action?.label,
    'Export all saves',
  );
  for (const [good, id] of [
    [true, 'progress-restored'],
    [false, 'progress-restored-back'],
  ] as const)
    assert.deepEqual(
      lineOf({ view: 'backup', restored: { words: 'Restored.', good } }, id)!.action,
      { label: 'See changes', view: 'backup', target: '#restore-changes-title' },
    );
});

test('the retirement remark is two sentences and its button shows the first open step', () => {
  const line = lineOf({ retireOpen: 2, retireStep: 'phase-3-retire-wire' }, 'retire')!;
  assert.equal(sentences(line.text), 2, line.text);
  assert.match(line.text, /^2 retirement steps still open: /);
  assert.deepEqual(line.action, { label: 'Show step', view: 'plan', step: 'phase-3-retire-wire' });
  assert.equal(lineOf({ retireOpen: 1 }, 'retire')!.action, undefined, 'no step, no button');
});

test('power headroom under 10% is said once it is spare, with a button to the resources', () => {
  const line = lineOf({ view: 'plan', powerThin: '8%' }, 'power-thin')!;
  assert.equal(line.text, 'Headroom is down to 8%. Somewhere a fuse is preparing a dramatic exit.');
  assert.equal(line.essential, false);
  assert.equal(line.action?.view, 'resources');
  assert.equal(lineOf({ view: 'resources', powerThin: '8%' }, 'power-thin')!.action, undefined);
  assert.equal(lineOf({ view: 'plan' }, 'power-thin'), undefined);
});

test('train stations with no train line are amused about it', () => {
  const line = lineOf({ view: 'logistics', trainStations: 1, trainLines: 0 }, 'trains-no-lines')!;
  assert.equal(
    line.text,
    '1 train station, zero train lines. Bold of you to trust the conveyor belts this much.',
  );
  assert.equal(line.mood, 'amused');
  assert.equal(
    lineOf({ view: 'map', trainStations: 2, trainLines: 0 }, 'trains-no-lines')!.action?.view,
    'logistics',
  );
  assert.equal(
    lineOf({ view: 'logistics', trainStations: 2, trainLines: 1 }, 'trains-no-lines'),
    undefined,
  );
  assert.equal(
    lineOf({ view: 'logistics', trainStations: 0, trainLines: 0 }, 'trains-no-lines'),
    undefined,
  );
});

test('an unknown route is said on the not-found page, with a way back to the build plan', () => {
  const line = lineOf({ view: 'notfound' }, 'unknown-route')!;
  assert.match(line.text, /^That sector is not on any FICSIT map\./);
  assert.equal(sentences(line.text), 2);
  assert.deepEqual(line.action, { label: 'Go to Build plan', view: 'plan' });
  assert.equal(lineOf({ view: 'plan' }, 'unknown-route'), undefined);
});

test('lines planned and none running is one remark, factories-none, with a button off the Factories page', () => {
  const line = lineOf({ view: 'plan', factories: { done: 0, total: 73 } }, 'factories-none')!;
  assert.match(line.text, /^73 production lines for Phase 3, none marked running./);
  assert.deepEqual(line.action, { label: 'Open factories', view: 'factories' });
  assert.equal(
    lineOf({ view: 'factories', factories: { done: 0, total: 73 } }, 'factories-none')!.action,
    undefined,
  );
  // The duplicate rules are gone: one line per situation.
  const ids = adaRemarks(baseFacts({ view: 'plan', factories: { done: 0, total: 73 } })).map(
    r => r.id,
  );
  assert.ok(!ids.includes('lines-planned'));
});

test('never backed up is one remark at any tick count, stronger from 50 ticks', () => {
  const over = { view: 'plan', browserMode: true, backupDays: null } as const;
  const few = lineOf({ ...over, ticks: 10 }, 'backup-never')!;
  const many = lineOf({ ...over, ticks: 50 }, 'backup-never')!;
  assert.match(few.text, /^This browser has never exported a full backup./);
  assert.match(many.text, /^Your entire factory history lives in one browser tab/);
  assert.equal(many.essential, true);
  assert.equal(many.action?.label, 'Export all saves');
  const ids = adaRemarks(baseFacts({ ...over, ticks: 80 })).map(r => r.id);
  assert.equal(ids.filter(id => id.startsWith('backup-never')).length, 1, ids.join());
});

test('never backed up is stronger from the third session, one remark at 2 and at 3 (#1353)', () => {
  const over = { view: 'backup', browserMode: true, backupDays: null, ticks: 4 } as const;
  const strong = /^Your entire factory history lives in one browser tab/;
  assert.match(lineOf({ ...over, sessions: 1 }, 'backup-never')!.text, /^This browser has never/);
  assert.match(lineOf({ ...over, sessions: 2 }, 'backup-never')!.text, /^This browser has never/);
  const third = lineOf({ ...over, sessions: 3 }, 'backup-never')!;
  assert.match(third.text, strong);
  assert.equal(third.essential, true, 'a warning, so it is kept at Essential and Off');
  assert.match(lineOf({ ...over, sessions: 40 }, 'backup-never')!.text, strong);
  // No count (an older caller) reads as before; a backup silences it at any count.
  assert.match(lineOf({ ...over }, 'backup-never')!.text, /^This browser has never/);
  assert.equal(lineOf({ ...over, sessions: 9, backupDays: 2 }, 'backup-never'), undefined);
  const ids = adaRemarks(baseFacts({ ...over, sessions: 5 })).map(r => r.id);
  assert.equal(ids.filter(id => id.startsWith('backup-never')).length, 1, ids.join());
});

test('Plan a train line opens the Trains tab', () => {
  const action = lineOf(
    { view: 'map', trainStations: 2, trainLines: 0 },
    'trains-no-lines',
  )!.action;
  assert.deepEqual(action, { label: 'Plan a train line', view: 'logistics', tab: 'trains' });
});

test('every new line is at most two sentences', () => {
  const lines = [
    lineOf({ powerThin: '4%' }, 'power-thin'),
    lineOf({ view: 'logistics', trainStations: 3, trainLines: 0 }, 'trains-no-lines'),
    lineOf({ view: 'notfound' }, 'unknown-route'),
  ];
  for (const line of lines) assert.ok(line && sentences(line.text) <= 2, line?.id);
});
