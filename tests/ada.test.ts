import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaRemarks, adaEncore, adaFault } from '../public/ada.ts';
import type { AdaFacts } from '../public/ada.ts';

const facts = (over: Partial<AdaFacts> = {}) => ({
  view: 'plan',
  phaseLabel: 'Phase 3',
  kind: 'calculated',
  save: 'World',
  profile: 'Balanced',
  steps: { done: 4, total: 10 },
  next: 'Steel and structural parts',
  retireOpen: 0,
  factories: { done: 2, total: 6 },
  storage: { done: 8, total: 8 },
  deliveries: { open: 0, total: 2 },
  hasPhaseNote: true,
  customTasks: 0,
  removedSteps: 0,
  groups: 1,
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
// Every set of facts yields at least one remark (the idle lines), so the first one is there.
const first = (f: Partial<AdaFacts>) => adaRemarks(f)[0]!;
const ids = (f: Partial<AdaFacts>) => adaRemarks(f).map(r => r.id);

test('ADA leads with the thing that is actually wrong', () => {
  const draft = first(facts({ feasible: false, reason: 'Iron Ore budget exceeded.' }));
  assert.equal(draft.id, 'draft');
  assert.equal(draft.tone, 'warn');
  assert.match(
    draft.text,
    /Iron Ore budget exceeded\./,
    'the planner’s own reason is repeated, not invented',
  );
  const short = first(facts({ short: ['Iron Ore', 'Copper Ore', 'Limestone', 'Coal'] }));
  assert.equal(short.id, 'short');
  assert.match(short.text, /Iron Ore, Copper Ore, Limestone and 1 more are over the budget/);
  assert.match(
    first(facts({ short: ['Coal'] })).text,
    /Coal is over the budget/,
    'one resource reads as singular',
  );
  const power = first(
    facts({ power: { required: '1.2 GW', spare: '800 MW', headroom: '240 MW', tight: true } }),
  );
  assert.equal(power.id, 'power');
  assert.match(power.text, /240 MW[^]*800 MW/);
});

// #334: from Phase 2 on the draw was set against the listed spare power alone, leaving out the
// generators the plan builds, so the figures did not add up to the headroom.
test('ADA’s power remark sets the draw against everything the plan counts on', () => {
  const text = (power: Partial<NonNullable<AdaFacts['power']>>, phaseLabel = 'Phase 3') =>
    first(
      facts({
        phaseLabel,
        power: { required: '402 MW', spare: '0 MW', headroom: '169,73 MW', tight: true, ...power },
      }),
    ).text;
  assert.equal(
    text({ generation: '232,27 MW' }, 'Phase 2'),
    '169,73 MW of whole-building power headroom is still unaccounted for: a 402 MW draw against 232,27 MW of planned generation and the 0 MW you listed as spare. Unpowered machines are simply very expensive furniture. Build generation beyond what the plan lists.',
  );
  assert.equal(
    text({ required: '129,6 MW', spare: '100 MW', headroom: '29,6 MW', biomass: true }, 'Phase 1'),
    '29,6 MW of whole-building power headroom is still unaccounted for: a 129,6 MW draw against the 100 MW you listed as spare. Unpowered machines are simply very expensive furniture. Phase 1 plans no generators: burn biomass, or bring existing generation.',
  );
  // A later stage that builds no generators of its own.
  assert.match(
    text({ generation: '' }, 'Phase 4'),
    /a 402 MW draw against the 0 MW you listed as spare\. .* Build the generation first\.$/,
  );
  assert.match(
    text(
      {
        required: '75,57 GW',
        generation: '56,4 GW',
        spare: '3 GW',
        augmented: '6,4 GW',
        headroom: '12,77 GW',
      },
      'Phase 5',
    ),
    /a 75,57 GW draw against 56,4 GW of planned generation and the 3 GW you listed as spare \(6,4 GW with the augmenters\)\./,
  );
});

test('ADA counts the same progress the pages show', () => {
  assert.match(
    first(facts({ steps: { done: 0, total: 12 } })).text,
    /Zero of 12 steps ticked for Phase 3.*Steel and structural parts/s,
  );
  assert.match(
    first(facts({ steps: { done: 9, total: 10 } })).text,
    /90% of Phase 3.*Steel and structural parts/s,
  );
  assert.match(first(facts({ steps: { done: 4, total: 10 } })).text, /4 of 10 steps done/);
  const done = facts({
    steps: { done: 10, total: 10 },
    next: '',
    factories: { done: 3, total: 6 },
  });
  assert.equal(first(done).id, 'complete');
  assert.equal(first(done).tone, 'praise');
  assert.equal(
    first(facts({ steps: { done: 10, total: 10 }, next: '', factories: { done: 6, total: 6 } })).id,
    'flawless',
  );
  assert.ok(ids(facts({ retireOpen: 2 })).includes('retire'));
  assert.match(
    adaRemarks(facts({ retireOpen: 1 })).find(r => r.id === 'retire')!.text,
    /1 retirement step still open/,
  );
  assert.match(
    adaRemarks(facts({ storage: { done: 3, total: 12 } })).find(r => r.id === 'storage')!.text,
    /3 of 12 container positions verified/,
  );
  assert.match(
    adaRemarks(facts({ deliveries: { open: 2, total: 3 } })).find(r => r.id === 'deliveries')!.text,
    /2 elevator parts still short/,
  );
  assert.match(
    adaRemarks(facts({ factories: { done: 0, total: 6 } })).find(r => r.id === 'factories-none')!
      .text,
    /6 factory targets for Phase 3, none marked running/,
  );
});

test('ADA only raises a backup in the browser edition, and only when it is due', () => {
  assert.ok(
    !ids(facts({ backupDays: null })).includes('backup-never'),
    'the server edition keeps its own backups',
  );
  assert.ok(ids(facts({ browserMode: true, backupDays: null })).includes('backup-never'));
  assert.ok(
    !ids(facts({ browserMode: true, backupDays: 3 })).includes('backup-old'),
    'a recent export is not nagged about',
  );
  assert.match(
    adaRemarks(facts({ browserMode: true, backupDays: 30 })).find(r => r.id === 'backup-old')!.text,
    /30 days ago/,
  );
});

test('ADA leads with the page you are looking at', () => {
  assert.equal(first(facts({ view: 'factories' })).id, 'factories-part');
  assert.equal(
    first(facts({ view: 'factories', factories: { done: 0, total: 6 } })).id,
    'factories-none',
  );
  assert.equal(first(facts({ view: 'factories', groups: 0 })).id, 'factories-part');
  assert.equal(first(facts({ view: 'storage', storage: { done: 1, total: 9 } })).id, 'storage');
  assert.equal(first(facts({ view: 'profiles', profiles: 1 })).id, 'one-profile');
  assert.equal(first(facts({ view: 'wizard' })).id, 'wizard');
  assert.equal(first(facts({ view: 'resources' })).id, 'resources');
  // A real problem still outranks whatever page you happen to be on.
  assert.equal(
    first(facts({ view: 'storage', storage: { done: 1, total: 9 }, feasible: false })).id,
    'draft',
  );
  // Every remark stays reachable by cycling, wherever it sits in the order.
  assert.deepEqual(
    [...ids(facts({ view: 'storage', storage: { done: 1, total: 9 } }))].sort(),
    [...ids(facts({ view: 'plan', storage: { done: 1, total: 9 } }))].sort(),
    'the page changes the order, not which remarks apply',
  );
});

test('ADA notices the states that are not just a number', () => {
  assert.equal(
    first(facts({ kind: 'none', steps: { done: 0, total: 0 }, next: '' })).id,
    'no-save',
  );
  assert.equal(first(facts({ steps: { done: 0, total: 0 }, next: '' })).id, 'empty-phase');
  assert.ok(ids(facts({ post: true })).includes('post'));
  assert.match(
    adaRemarks(facts({ deliveries: { open: 0, total: 2 } })).find(r => r.id === 'deliveries-done')!
      .text,
    /Space Elevator has stopped waiting/,
  );
  assert.match(
    adaRemarks(facts({ storage: { done: 9, total: 9 } })).find(r => r.id === 'storage-done')!.text,
    /All 9 container positions are verified/,
  );
  assert.match(
    adaRemarks(facts({ groups: 3 })).find(r => r.id === 'groups-some')!.text,
    /3 factory groups on record/,
  );
  assert.match(
    adaRemarks(facts({ assumptions: 4 })).find(r => r.id === 'assumptions')!.text,
    /4 recorded assumptions/,
  );
  assert.match(
    adaRemarks(facts({ startPhase: '3' })).find(r => r.id === 'start-phase')!.text,
    /begins at Phase 3/,
  );
  assert.ok(
    !ids(facts({ startPhase: '1' })).includes('start-phase'),
    'a profile from the first phase has nothing to explain',
  );
  assert.ok(
    !ids(facts({ kind: 'original', startPhase: '3' })).includes('start-phase'),
    'the handbook profile is not a calculated one',
  );
});

test('a full lap of the remarks is answered, and the badge can be prodded', () => {
  assert.match(adaEncore(1, facts()).text, /everything I hold on this save/);
  assert.match(adaEncore(2, facts()).text, /twice/);
  assert.match(adaEncore(3, facts({ profile: 'Balanced' })).text, /Balanced/);
  assert.equal(
    adaEncore(9, facts()).tone,
    'calm',
    'later laps keep cycling rather than running out',
  );
  const seen = new Set();
  for (let poke = 1; poke <= 8; poke++) {
    const f = adaFault(poke);
    assert.equal(f.tone, 'fault');
    assert.equal(f.name, '???', 'a corrupted transmission is not signed ADA');
    assert.ok(!/[<>]/.test(f.text), 'no markup of its own: ' + f.text);
    seen.add(f.text);
  }
  assert.ok(seen.size >= 6, 'prodding again gives a different transmission');
  assert.match(adaFault(9).text, /Normal service resumes/, 'the last one hands the terminal back');
});

test('ADA always has something to say, and never throws', () => {
  const quiet = adaRemarks(
    facts({
      steps: { done: 0, total: 0 },
      next: '',
      factories: { done: 0, total: 0 },
      storage: { done: 0, total: 0 },
      kind: 'none',
      profiles: 0,
    }),
  );
  assert.ok(quiet.length >= 6, 'the idle lines are always available');
  assert.equal(
    new Set(quiet.map(r => r.text)).size,
    quiet.length,
    'no line is repeated in one cycle',
  );
  for (const bad of [
    undefined,
    {},
    { steps: null, short: 'not a list' },
    { phaseLabel: null, next: {} },
  ]) {
    // @ts-expect-error: deliberately malformed facts, to check ADA copes with them
    const out = adaRemarks(bad);
    // @ts-expect-error: the same malformed facts
    assert.doesNotThrow(() => adaEncore(1, bad));
    assert.doesNotThrow(() => adaFault(1));
    assert.ok(
      Array.isArray(out) && out.length,
      'garbage facts still produce remarks: ' + JSON.stringify(bad),
    );
    for (const r of out) assert.equal(typeof r.text, 'string');
  }
});

test('remarks stay plain text for the caller to escape', () => {
  for (const r of adaRemarks(facts({ steps: { done: 0, total: 3 }, retireOpen: 1, profiles: 1 }))) {
    assert.ok(!/[<>]/.test(r.text), 'ADA writes no markup of its own: ' + r.text);
    assert.ok(['calm', 'warn', 'praise'].includes(r.tone), 'known tone: ' + r.tone);
  }
  // Names and step titles are the user’s text: ADA passes them through
  // unchanged and app.ts escapes them at the point of rendering.
  const nasty = adaRemarks(
    facts({
      save: 'World <one>',
      next: 'Weld the <boat>',
      steps: { done: 0, total: 3 },
      profiles: 1,
    }),
  );
  assert.match(nasty.find(r => r.id === 'start')!.text, /Weld the <boat>/);
  assert.match(nasty.find(r => r.id === 'one-profile')!.text, /World <one>/);
});

test('ADA reads the build-so-far status: held-back rows, nothing flowing, the next step', () => {
  const build = (over: Partial<NonNullable<AdaFacts['build']>> = {}) => ({
    built: 3,
    total: 10,
    share: 0,
    next: 'Steel Beam',
    nextGain: 25,
    nextUnblocks: 0,
    waiting: [],
    shortOf: [],
    powerShort: false,
    ...over,
  });
  // A row marked running without its supplier is a problem: it leads, with the next step.
  const waiting = first(
    facts({ view: 'factories', build: build({ waiting: ['Screw'], shortOf: ['Iron Rod'] }) }),
  );
  assert.equal(waiting.id, 'build-waiting');
  assert.equal(waiting.tone, 'warn');
  assert.match(waiting.text, /Screw is marked running but short of Iron Rod\./);
  assert.match(waiting.text, /Build Steel Beam next\./);
  assert.match(
    adaRemarks(facts({ build: build({ waiting: ['A', 'B'], shortOf: ['X'] }) }))[0]!.text,
    /A, B are marked running/,
  );
  // Built but nothing reaches the elevator: the missing link.
  const dry = ids(facts({ build: build() }));
  assert.ok(dry.includes('build-dry'));
  assert.match(
    adaRemarks(facts({ build: build() })).find(r => r.id === 'build-dry')!.text,
    /3 factories marked running, and not one Space Elevator part moves yet[^]*Steel Beam/,
  );
  // Some flowing: the best next step and what it adds.
  const flowing = adaRemarks(facts({ build: build({ share: 40, nextGain: 20 }) }));
  assert.ok(!flowing.some(r => r.id === 'build-dry'));
  assert.match(
    flowing.find(r => r.id === 'build-next')!.text,
    /40% of Phase 3's elevator delivery is flowing\. Build Steel Beam next: on its own it adds 20%/,
  );
  // Nothing to say without a status (the handbook) or with everything built.
  for (const f of [facts({ build: null }), facts({ build: build({ next: '', share: 100 }) })])
    assert.ok(!ids(f).some(id => id.startsWith('build-')));
});

test('ADA notices a phase without notes on the plan and on the Notes page (#243)', () => {
  for (const view of ['plan', 'notes']) {
    const bare = adaRemarks(facts({ view, hasPhaseNote: false }));
    const notes = bare.find(r => r.id === 'notes')!;
    assert.match(notes.text, /No notes saved for Phase 3/);
    assert.ok(
      bare.findIndex(r => r.id === 'notes') < bare.findIndex(r => r.id.startsWith('idle-')),
      'it ranks as a remark for the page on screen',
    );
    assert.ok(!ids(facts({ view, hasPhaseNote: true })).includes('notes'));
  }
  // Nothing done yet, nothing to write down.
  assert.ok(
    !ids(facts({ view: 'notes', hasPhaseNote: false, steps: { done: 0, total: 9 } })).includes(
      'notes',
    ),
  );
  // With a note, the Notes page has a line of its own.
  const page = adaRemarks(facts({ view: 'notes' })).find(r => r.id === 'notes-page')!;
  assert.match(page.text, /Phase 3 has notes on record/);
  assert.ok(!ids(facts({ view: 'notes', hasPhaseNote: false })).includes('notes-page'));
  assert.ok(!ids(facts({ view: 'notes', kind: 'none' })).includes('notes-page'));
  // The assumptions are on the page now called Backup.
  assert.match(
    adaRemarks(facts({ assumptions: 2 })).find(r => r.id === 'assumptions')!.text,
    /listed under Backup\./,
  );
});

test('the storage and account pages have a line of their own, and there is more to say (#85)', () => {
  const storage = adaRemarks(facts({ view: 'storage' })).find(r => r.id === 'storage-page')!;
  assert.match(storage.text, /sign and an address/);
  assert.ok(!ids(facts({ view: 'storage', kind: 'none' })).includes('storage-page'));
  assert.match(first(facts({ view: 'account' })).text, /cannot see your password/);
  assert.notEqual(
    first(facts({ view: 'plan' })).id,
    'account',
    'it leads only on the account page',
  );
  assert.ok(
    !ids(facts({ browserMode: true })).includes('account'),
    'no accounts in the browser edition',
  );
  // The idle lines, encores and faults all got longer, and none repeats.
  const idle = adaRemarks(facts()).filter(r => r.id.startsWith('idle-'));
  assert.ok(idle.length >= 20, 'idle lines: ' + idle.length);
  assert.equal(new Set(idle.map(r => r.text)).size, idle.length);
  const encores = [1, 2, 3, 4, 5, 6].map(lap => adaEncore(lap, facts()).text);
  assert.equal(new Set(encores).size, 6, 'six different encores before they cycle');
  const faults = Array.from({ length: 9 }, (_, i) => adaFault(i + 1).text);
  assert.equal(new Set(faults).size, 9);
  assert.ok(faults.every(t => t.startsWith('— ') && t.endsWith(' — end —')));
  // Lines that name the save or phase say it as given, and carry no markup of their own.
  for (const r of adaRemarks(facts({ save: 'My World', phaseLabel: 'Phase 4' })))
    assert.ok(!/[<>]/.test(r.text), r.text);
});

test('ADA names the best hard-drive payoff once a ranking exists (#204)', () => {
  const line = adaRemarks(
    facts({ payoff: { name: 'Pure Iron Ingot', gain: '12 fewer buildings' } }),
  ).find(r => r.id === 'payoff-best')!;
  assert.match(line.text, /Allowing Pure Iron Ingot would mean 12 fewer buildings in Phase 3/);
  assert.ok(!ids(facts({ payoff: null })).includes('payoff-best'));
});

test('a storage search nothing holds gets a line on the storage page (#240)', () => {
  const miss = first(facts({ view: 'storage', storageMiss: 'Unobtainium' }));
  assert.equal(miss.id, 'storage-search-miss');
  assert.match(miss.text, /No container on any floor holds “Unobtainium”/);
  assert.ok(!ids(facts({ view: 'storage', storageMiss: '' })).includes('storage-search-miss'));
  assert.ok(!ids(facts({ view: 'plan', storageMiss: 'x' })).includes('storage-search-miss'));
});

test('the built ground floor’s open moves get a line on the storage page (SP-25, #260)', () => {
  const line = first(facts({ view: 'storage', kind: 'original', groundMoves: true }));
  assert.equal(line.id, 'storage-ground-moves');
  assert.equal(line.tone, 'calm');
  assert.match(line.text, /Gas Filters G08 → H02, Nobelisks H02 → H08/);
  assert.match(line.text, /Press Done on the ground floor/);
  assert.ok(!ids(facts({ view: 'storage', groundMoves: false })).includes('storage-ground-moves'));
});
