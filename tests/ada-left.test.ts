// What was left of ADA's event-triggered remarks (#1353): the button on each problem remark, the
// retirement remark trimmed to two sentences, and the triggers whose data the app already has
// (many lines and none running, thin power headroom, stations without train lines, an unknown
// route, never backed up with 50+ ticks).
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

test('many lines planned and none running is said away from Factories, with a button there', () => {
  const line = lineOf({ factories: { done: 0, total: 73 } }, 'lines-planned')!;
  assert.match(line.text, /^73 production lines planned for Phase 3, none running\./);
  assert.equal(sentences(line.text), 2);
  assert.equal(line.essential, false, 'a Chatty remark');
  assert.deepEqual(line.action, { label: 'Open factories', view: 'factories' });
  assert.equal(lineOf({ factories: { done: 0, total: 9 } }, 'lines-planned'), undefined);
  assert.equal(lineOf({ factories: { done: 1, total: 73 } }, 'lines-planned'), undefined);
  assert.equal(
    lineOf({ view: 'factories', factories: { done: 0, total: 73 } }, 'lines-planned'),
    undefined,
  );
});

test('power headroom under 10% is said once it is spare, with a button to the resources', () => {
  const line = lineOf({ view: 'plan', powerThin: 8 }, 'power-thin')!;
  assert.equal(line.text, 'Headroom is down to 8%. Somewhere a fuse is preparing a dramatic exit.');
  assert.equal(line.essential, false);
  assert.equal(line.action?.view, 'resources');
  assert.equal(lineOf({ view: 'resources', powerThin: 8 }, 'power-thin')!.action, undefined);
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

test('never backed up with 50 ticks or more is an essential data-loss line off the Backup page', () => {
  const over = { browserMode: true, backupDays: null, ticks: 50 };
  const line = lineOf({ view: 'plan', ...over }, 'backup-never-ticks')!;
  assert.equal(line.essential, true);
  assert.equal(line.mood, 'concerned');
  assert.equal(sentences(line.text), 2);
  assert.equal(line.action?.label, 'Export all saves');
  assert.equal(lineOf({ view: 'backup', ...over }, 'backup-never-ticks'), undefined);
  assert.equal(lineOf({ view: 'plan', ...over, ticks: 49 }, 'backup-never-ticks'), undefined);
  assert.equal(lineOf({ view: 'plan', ...over, backupDays: 3 }, 'backup-never-ticks'), undefined);
  assert.equal(
    lineOf({ view: 'plan', ...over, browserMode: false }, 'backup-never-ticks'),
    undefined,
  );
});

test('every new line is at most two sentences', () => {
  const lines = [
    lineOf({ factories: { done: 0, total: 20 } }, 'lines-planned'),
    lineOf({ powerThin: 4 }, 'power-thin'),
    lineOf({ view: 'logistics', trainStations: 3, trainLines: 0 }, 'trains-no-lines'),
    lineOf({ view: 'notfound' }, 'unknown-route'),
    lineOf({ browserMode: true, ticks: 80 }, 'backup-never-ticks'),
  ];
  for (const line of lines) assert.ok(line && sentences(line.text) <= 2, line?.id);
});
