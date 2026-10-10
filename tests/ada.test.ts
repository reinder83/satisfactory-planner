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
// Every set of facts yields at least one remark (the idle lines), so the first one is there.
const first = (given: Partial<AdaFacts>) => adaRemarks(given)[0]!;
const ids = (given: Partial<AdaFacts>) => adaRemarks(given).map(r => r.id);

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
    '169,73 MW of power headroom is still unaccounted for: a 402 MW draw against 232,27 MW of planned generation and the 0 MW you listed as spare. Unpowered machines are simply very expensive furniture. Build generation beyond what the plan lists.',
  );
  assert.equal(
    text({ required: '129,6 MW', spare: '100 MW', headroom: '29,6 MW', biomass: true }, 'Phase 1'),
    '29,6 MW of power headroom is still unaccounted for: a 129,6 MW draw against the 100 MW you listed as spare. Unpowered machines are simply very expensive furniture. Phase 1 plans no generators: burn biomass, or bring existing generation.',
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
  // Lines a delivered elevator part leaves without work (#1062), dimmed in the build plan.
  assert.ok(!ids(facts()).includes('delivered-lines'));
  const idle = (count: number) =>
    adaRemarks(facts({ idleLines: count })).find(r => r.id === 'delivered-lines')!;
  assert.equal(idle(1).tone, 'calm');
  assert.match(
    idle(1).text,
    /^1 production line only made elevator parts .* dims it and says which later phase needs it/,
  );
  assert.match(
    idle(2).text,
    /^2 production lines only made elevator parts .* dims them and says which later phase needs them/,
  );
  assert.match(
    adaRemarks(facts({ retireOpen: 1 })).find(r => r.id === 'retire')!.text,
    /1 retirement step still open/,
  );
  // Storage-only lines are optional and listed last (#1061).
  assert.ok(!ids(facts()).includes('storage-lines'));
  const stock = (count: number) =>
    adaRemarks(facts({ stockLines: count })).find(r => r.id === 'storage-lines')!;
  assert.equal(stock(1).tone, 'calm');
  assert.match(
    stock(1).text,
    /^1 storage-only line at the end of this phase is optional: .* Build it last/,
  );
  assert.match(
    stock(3).text,
    /^3 storage-only lines .* are optional: .* those lines fill .* Build them last/,
  );
  // Research only a later phase needs is optional and listed last (#1070).
  assert.ok(!ids(facts()).includes('optional-research'));
  const research = (count: number, requiredOnly = false) =>
    adaRemarks(facts({ optionalResearch: count, requiredOnly })).find(
      r => r.id === 'optional-research',
    )!;
  assert.equal(research(1).tone, 'calm');
  assert.match(
    research(1).text,
    /^1 research step at the end of this phase is optional: only a later phase's lines need it\. Tick Required steps only/,
  );
  assert.match(
    research(7, true).text,
    /^7 research steps .* are optional: .* need them\. Required steps only hides them/,
  );
  // The generators the phase before built stay and count first (#1064).
  assert.ok(!ids(facts()).includes('kept-generators'));
  const kept = adaRemarks(facts({ keptGenerators: '7 Fuel Generators', keptFrom: 'Phase 3' })).find(
    r => r.id === 'kept-generators',
  )!;
  assert.equal(kept.tone, 'calm');
  assert.match(kept.text, /^This phase keeps the 7 Fuel Generators Phase 3 built and counts them/);
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
    /6 production lines for Phase 3, none marked running/,
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

test('ADA says an empty phase was emptied only when steps were removed (#646)', () => {
  const empty = (removedSteps: number) =>
    adaRemarks(facts({ steps: { done: 0, total: 0 }, next: '', removedSteps })).find(
      r => r.id === 'empty-phase',
    )!.text;
  assert.match(empty(3), /Every step of Phase 3 has been removed/);
  assert.match(empty(3), /Removed steps/);
  assert.match(empty(0), /Phase 3 has no steps yet/);
  assert.match(empty(0), /Add a task/);
  assert.doesNotMatch(empty(0), /removed|Removed steps/i);
  // No longer than the removed line, so ADA's card in the sidebar grows no taller and the
  // sidebar gets no scrollbar at 1440 × 900 where it had none.
  assert.ok(empty(0).length < empty(3).length);
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
    adaRemarks(facts({ view: 'plan', groupedSteps: true })).find(r => r.id === 'grouped-steps')!
      .text,
    /follow your factories/,
  );
  assert.ok(
    !ids(facts({ view: 'plan' })).includes('grouped-steps'),
    'only when the steps follow them',
  );
  assert.match(
    adaRemarks(facts({ groups: 3 })).find(r => r.id === 'groups-some')!.text,
    /3 factories on record/,
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
  // A milestone-only phase before the start phase (#759) says where production starts.
  assert.match(
    adaRemarks(facts({ phaseLabel: 'Phase 1', milestoneOnly: 'Phase 3' })).find(
      r => r.id === 'milestone-only',
    )!.text,
    /Phase 1 is before this profile's production plan, which starts in Phase 3/,
  );
  assert.ok(!ids(facts({ milestoneOnly: '' })).includes('milestone-only'));
});

// A profile opened on an earlier phase than its saved one, which still has open checks (#570).
test('ADA says why the build plan opened on an earlier phase', () => {
  const line = adaRemarks(facts({ phaseLabel: 'Phase 1', openedFrom: 'Phase 3' })).find(
    r => r.id === 'opened-earlier',
  )!;
  assert.equal(line.tone, 'calm');
  assert.match(line.text, /working on Phase 3, but Phase 1 still has open steps/);
  assert.ok(!ids(facts({ openedFrom: '' })).includes('opened-earlier'), 'not on the saved phase');
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
    const fault = adaFault(poke);
    assert.equal(fault.tone, 'fault');
    assert.equal(fault.name, '???', 'a corrupted transmission is not signed ADA');
    assert.ok(!/[<>]/.test(fault.text), 'no markup of its own: ' + fault.text);
    seen.add(fault.text);
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
    for (const remark of out) assert.equal(typeof remark.text, 'string');
  }
});

test('remarks stay plain text for the caller to escape', () => {
  for (const remark of adaRemarks(
    facts({ steps: { done: 0, total: 3 }, retireOpen: 1, profiles: 1 }),
  )) {
    assert.ok(!/[<>]/.test(remark.text), 'ADA writes no markup of its own: ' + remark.text);
    assert.ok(['calm', 'warn', 'praise'].includes(remark.tone), 'known tone: ' + remark.tone);
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
    /3 production lines marked running, and not one Space Elevator part moves yet[^]*Steel Beam/,
  );
  // Some flowing: the best next step and what it adds.
  const flowing = adaRemarks(facts({ build: build({ share: 40, nextGain: 20 }) }));
  assert.ok(!flowing.some(r => r.id === 'build-dry'));
  assert.match(
    flowing.find(r => r.id === 'build-next')!.text,
    /40% of Phase 3's elevator delivery is flowing\. Build Steel Beam next: on its own it adds 20%/,
  );
  // Nothing to say without a status (the handbook) or with everything built.
  for (const given of [facts({ build: null }), facts({ build: build({ next: '', share: 100 }) })])
    assert.ok(!ids(given).some(id => id.startsWith('build-')));
});

test('ADA points at the records the original plan could not place (#499)', () => {
  for (const view of ['plan', 'notes']) {
    const line = adaRemarks(facts({ view, unplaced: 3 })).find(r => r.id === 'unplaced')!;
    assert.equal(line.tone, 'calm');
    assert.match(line.text, /^3 records from the original plan .* foot of Notes/);
    assert.doesNotMatch(line.text, /handbook/i, 'no "handbook" in user-facing copy (decision 8)');
    assert.ok(!ids(facts({ view, unplaced: 0 })).includes('unplaced'));
    assert.ok(!ids(facts({ view })).includes('unplaced'), 'absent means none');
  }
  const one = adaRemarks(facts({ view: 'notes', unplaced: 1 })).find(r => r.id === 'unplaced')!;
  assert.match(one.text, /^1 record from/);
});

test('ADA points at ticks a recalculation kept for review because of lines made on site (#876)', () => {
  for (const view of ['plan', 'notes', 'factories']) {
    const line = adaRemarks(facts({ view, siteReview: 2 })).find(r => r.id === 'site-review')!;
    assert.equal(line.tone, 'calm');
    assert.match(line.text, /^2 ticks from the profile this one came from .* foot of Notes/);
    assert.ok(!ids(facts({ view, siteReview: 0 })).includes('site-review'));
    assert.ok(!ids(facts({ view })).includes('site-review'), 'absent means none');
  }
  const one = adaRemarks(facts({ view: 'notes', siteReview: 1 })).find(
    r => r.id === 'site-review',
  )!;
  assert.match(one.text, /^1 tick from/);
});

test("ADA counts the phase's byproducts on the factories page, calmly, and points at the dialogs (#1022)", () => {
  const line = adaRemarks(facts({ view: 'factories', byproducts: 3 })).find(
    r => r.id === 'recycle-byproducts',
  )!;
  assert.equal(line.tone, 'calm');
  assert.match(line.text, /^3 byproducts to recycle in Phase 3\. Each line's dialog says where/);
  assert.match(line.text, /build plan's step says the same/);
  const one = adaRemarks(facts({ view: 'factories', byproducts: 1 })).find(
    r => r.id === 'recycle-byproducts',
  )!;
  assert.match(one.text, /^1 byproduct to recycle/);
  assert.ok(!ids(facts({ view: 'factories', byproducts: 0 })).includes('recycle-byproducts'));
  assert.ok(!ids(facts({ view: 'factories' })).includes('recycle-byproducts'), 'absent means none');
});

test("ADA says how much Water the phase extracts and points at the lines' extractor counts (#1024)", () => {
  const line = adaRemarks(facts({ view: 'factories', waterExtracted: '1,234.5' })).find(
    r => r.id === 'water-extractors',
  )!;
  assert.equal(line.tone, 'calm');
  assert.match(
    line.text,
    /^Phase 3 extracts 1,234.5 m³ of Water a minute. Each line that takes it says how many Water Extractors to build, at 100% or with Power Shards/,
  );
  assert.ok(!ids(facts({ view: 'factories' })).includes('water-extractors'), 'absent means none');
});

test("ADA counts the lines kept from the phase before and points at each factory's Handover (#1069)", () => {
  const remark = (handover: AdaFacts['handover']) =>
    adaRemarks(facts({ view: 'factories', handover })).find(r => r.id === 'factory-handover');
  const line = remark({ from: '2', kept: 13, changed: 4 })!;
  assert.equal(line.tone, 'calm');
  assert.equal(
    line.text,
    "Phase 3 keeps 13 lines running since Phase 2, 4 of them with machines to add or a clock to change. Each factory's Handover says which, and what is new or retired. Reuse beats rebuilding. I checked.",
  );
  assert.match(
    remark({ from: '2', kept: 1, changed: 0 })!.text,
    /^Phase 3 keeps 1 line running since Phase 2\. Each/,
  );
  assert.equal(remark({ from: '2', kept: 0, changed: 0 }), undefined, 'nothing kept, nothing said');
  assert.equal(remark(undefined), undefined, 'absent means no handover');
});

test("ADA names the phase's miner and the nodes its draw taps (#1065)", () => {
  const mining = { miner: 'Miner Mk.2 at 100%', nodes: '13 nodes', mw: '195 MW' };
  for (const view of ['resources', 'plan']) {
    const line = adaRemarks(facts({ view, mining })).find(r => r.id === 'phase-mining')!;
    assert.equal(line.tone, 'calm');
    assert.match(
      line.text,
      /^Phase 3 mines with Miner Mk\.2 at 100%: 13 nodes for 195 MW, best nodes first\. The budgets follow what this phase can build and carry/,
    );
  }
  assert.ok(!ids(facts({ view: 'resources' })).includes('phase-mining'), 'absent means none');
});

test('ADA says when a phase carries its nodes on belts you already have (#1068)', () => {
  for (const view of ['resources', 'logistics']) {
    const line = adaRemarks(facts({ view, ownedBelt: 'Mk.6 belts (1,200/min)' })).find(
      r => r.id === 'owned-belt',
    )!;
    assert.equal(line.tone, 'calm');
    assert.match(
      line.text,
      /^Phase 3 carries its nodes on the Mk\.6 belts \(1,200\/min\) you already have, better than its milestones give: its budgets and the belt advice count on them\./,
    );
  }
  assert.ok(!ids(facts({ view: 'resources' })).includes('owned-belt'), 'absent means none');
});

test('ADA counts the generators you already have, or says the phase does not (#1068)', () => {
  for (const view of ['plan', 'resources']) {
    const line = (over: Partial<AdaFacts>) =>
      adaRemarks(facts({ view, ...over })).find(r => r.id === 'owned-generators')!;
    const counted = line({ ownedGenerators: '4 Coal Generators' });
    assert.equal(counted.tone, 'calm');
    assert.match(
      counted.text,
      /^This phase counts the 4 Coal Generators you already have before it builds any\. Their fuel still comes out of your budgets/,
    );
    assert.doesNotMatch(counted.text, /plans none/);
    const idle = line({ idleGenerators: '8 Coal Generators' }).text;
    assert.match(
      idle,
      /^This phase plans none of your 8 Coal Generators, so it does not count them\. Keep them fed outside the plan and they are spare power/,
    );
    const both = line({
      ownedGenerators: '3 Fuel Generators',
      idleGenerators: '8 Coal Generators',
    });
    assert.match(
      both.text,
      /^This phase counts the 3 Fuel Generators .* plans none of your 8 Coal/,
    );
    assert.ok(!ids(facts({ view })).includes('owned-generators'), 'absent means none');
  }
});

test('ADA says a change to the items made on site waits for a recalculation (#877)', () => {
  for (const view of ['factories', 'plan', 'logistics']) {
    const line = adaRemarks(facts({ view, onSitePending: true })).find(
      r => r.id === 'on-site-pending',
    )!;
    assert.equal(line.tone, 'warn');
    assert.match(line.text, /Nothing recalculates by itself/);
    assert.match(line.text, /Recalculate in place with items made on site/);
    assert.match(line.text, /keeps this version as a backup/);
    assert.ok(!ids(facts({ view, onSitePending: false })).includes('on-site-pending'));
    assert.ok(!ids(facts({ view })).includes('on-site-pending'), 'absent means none');
  }
});

test("ADA words a pending recalculation for a group's lines, not its marks, as the notice does (#985)", () => {
  const remark = (over: Partial<AdaFacts>) =>
    adaRemarks(facts({ view: 'factories', onSitePending: true, ...over })).find(
      r => r.id === 'on-site-pending',
    )!.text;
  const lines = remark({ onSiteLinesOnly: true });
  assert.match(lines, /^What your factories' lines use changed/);
  assert.doesNotMatch(lines, /differs from this plan/);
  assert.match(lines, /Nothing recalculates by itself/);
  assert.match(remark({ onSiteLinesOnly: false }), /^What your factories make on site differs/);
  assert.match(remark({}), /^What your factories make on site differs/);
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
  for (const remark of adaRemarks(facts({ save: 'My World', phaseLabel: 'Phase 4' })))
    assert.ok(!/[<>]/.test(remark.text), remark.text);
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

// A plan guide's checklists (#393, #470): each gets a line while any of it is open, with the
// guide's own counts, ranked first on the page that holds it; none without a guide or once it is
// all ticked. Completion modules belong to Post Phase 5.
test("ADA names a plan guide's open commissioning, storage tasks and completion modules", () => {
  const guide = {
    power: { done: 2, total: 9 },
    storageTasks: { done: 3, total: 5 },
    completion: { done: 0, total: 1 },
  };
  const guideIds = (view: string, over: Partial<AdaFacts> = {}) =>
    ids({ ...facts({ view, guide }), ...over }).filter(id => id.startsWith('guide-'));
  const text = (id: string, over: Partial<AdaFacts> = {}) =>
    adaRemarks(facts({ guide, post: true, ...over })).find(r => r.id === id)!.text;
  assert.match(text('guide-power'), /^2 of 9 power commissioning steps ticked\./);
  assert.match(text('guide-storage-tasks'), /^2 storage build steps still open/);
  assert.match(text('guide-completion'), /^1 completion module still to build/);
  assert.equal(guideIds('resources')[0], 'guide-power');
  assert.equal(guideIds('storage')[0], 'guide-storage-tasks');
  assert.equal(guideIds('factories', { post: true })[0], 'guide-completion');
  assert.ok(!guideIds('factories').includes('guide-completion'), 'only in Post Phase 5');
  const done = {
    power: { done: 9, total: 9 },
    storageTasks: { done: 5, total: 5 },
    completion: { done: 1, total: 1 },
  };
  for (const finishedGuide of [done, null])
    assert.deepEqual(
      ids(facts({ post: true, guide: finishedGuide })).filter(id => id.startsWith('guide-')),
      [],
    );
});

test('ADA says when a phase was rounded after its whole-machine search stopped (#593)', () => {
  const find = (given: Partial<AdaFacts>) =>
    adaRemarks(facts(given)).find(r => r.id === 'rounded-after-stop');
  assert.equal(find({}), undefined, 'a finished search says nothing');
  const longer = find({ hours: '11.9 h', rounded: { target: '8 h', longer: true } });
  assert.ok(longer);
  assert.match(longer.text, /stopped before it could prove the best plan/);
  assert.match(longer.text, /takes 11\.9 h instead of 8 h/);
  const onTime = find({ hours: '7.9 h', rounded: { target: '8 h', longer: false } });
  assert.ok(onTime);
  assert.doesNotMatch(onTime.text, /instead of/);
});

test('ADA says when a phase got easy clocks after its whole-machine search stopped (#694)', () => {
  const find = (given: Partial<AdaFacts>) =>
    adaRemarks(facts(given)).find(r => r.id === 'fractional-after-stop');
  assert.equal(find({}), undefined, 'a finished search says nothing');
  const easy = find({
    hours: '8.75 h',
    fractional: { target: '8 h', longer: true, clocks: 'easy' },
  });
  assert.ok(easy);
  assert.equal(easy.tone, 'warn');
  assert.match(easy.text, /stopped before it could prove the best plan/);
  assert.match(easy.text, /not whole machines/);
  assert.match(easy.text, /at 25%, 50% or 75%, and it takes 8\.75 h instead of 8 h\./);
  const rate = find({ hours: '8 h', fractional: { target: '8 h', longer: false, clocks: 'rate' } });
  assert.ok(rate);
  assert.match(rate.text, /or at a whole number per minute/);
  assert.doesNotMatch(rate.text, /instead of/);
  const precise = find({
    hours: '2.5 h',
    fractional: { target: '2.5 h', longer: false, clocks: 'precise' },
  });
  assert.ok(precise);
  assert.match(precise.text, /the exact plan with its precise clocks/);
});

test('ADA says when a phase makes its on-site items centrally (#875)', () => {
  const find = (given: Partial<AdaFacts>) =>
    adaRemarks(facts(given)).find(r => r.id === 'on-site-dropped');
  assert.equal(find({}), undefined, 'a phase with its group lines says nothing');
  assert.equal(find({ onSiteDropped: null }), undefined);
  const dropped = find({ onSiteDropped: { items: 'Wire and Screws', groups: 'Alpha and Beta' } });
  assert.ok(dropped);
  assert.equal(dropped.tone, 'warn');
  assert.match(
    dropped.text,
    /^Phase 3 makes Wire and Screws centrally: the whole-machine lines of Alpha and Beta need more than your budgets allow/,
  );
  assert.ok(
    adaRemarks(
      facts({ view: 'factories', onSiteDropped: { items: 'Wire', groups: 'Alpha' } }),
    ).some(r => r.id === 'on-site-dropped'),
    'also on the Factories page',
  );
});

test("ADA says when a factory's own lines also feed the rest of the plan (#1063)", () => {
  const find = (given: Partial<AdaFacts>) =>
    adaRemarks(facts({ view: 'factories', ...given })).find(r => r.id === 'on-site-overflow');
  assert.equal(find({}), undefined, 'a phase without it says nothing');
  assert.equal(find({ onSiteOverflow: null }), undefined);
  const line = find({ onSiteOverflow: { items: 'Quickwire', groups: 'Alpha' } });
  assert.ok(line);
  assert.equal(line.tone, 'calm');
  assert.match(
    line.text,
    /^In Phase 3 the own lines of Alpha also send the rest of the plan the Quickwire they make beyond their own needs: a central line would have sunk almost all it made./,
  );
  assert.ok(
    adaRemarks(
      facts({ view: 'logistics', onSiteOverflow: { items: 'Quickwire', groups: 'Alpha' } }),
    ).some(r => r.id === 'on-site-overflow'),
    'also on the Logistics page',
  );
});

test('ADA points at a note changed elsewhere that waits for a choice (#1052)', () => {
  for (const view of ['notes', 'plan', 'factories', 'storage']) {
    const line = adaRemarks(facts({ view, noteConflicts: 1 })).find(r => r.id === 'note-conflict')!;
    assert.equal(line.tone, 'warn');
    assert.match(line.text, /^A note was changed in another tab or on another device/);
    assert.match(line.text, /keep yours, theirs or both/);
    assert.ok(!ids(facts({ view, noteConflicts: 0 })).includes('note-conflict'));
    assert.ok(!ids(facts({ view })).includes('note-conflict'), 'absent means none');
  }
  assert.match(
    adaRemarks(facts({ view: 'notes', noteConflicts: 2 })).find(r => r.id === 'note-conflict')!
      .text,
    /^2 notes were changed/,
  );
});

test('ADA says an imported copy left the open profile alone (#1052)', () => {
  const line = adaRemarks(
    facts({ view: 'profiles', imported: '“Coop world (from anna.json)”' }),
  ).find(r => r.id === 'imported')!;
  assert.equal(line.tone, 'calm');
  assert.match(
    line.text,
    /^The import added “Coop world \(from anna\.json\)” as a copy of its own\./,
  );
  assert.match(line.text, /You are still on “Balanced”, so your next ticks land there/);
  assert.ok(!ids(facts({ view: 'profiles', imported: '' })).includes('imported'));
  assert.ok(!ids(facts({ view: 'profiles' })).includes('imported'), 'absent means none');
});

test('ADA warns on every page when the others moved to another profile (#1052)', () => {
  for (const view of ['plan', 'factories', 'notes', 'profiles']) {
    const remarks = adaRemarks(facts({ view, groupMoved: '“Main · copy”' }));
    const line = remarks.find(r => r.id === 'group-moved')!;
    assert.equal(line.tone, 'warn');
    assert.match(line.text, /^Another tab or player moved to “Main · copy”\./);
    assert.match(
      line.text,
      /This tab stays on “Balanced”, and everything you tick here is saved there/,
    );
    assert.ok(!ids(facts({ view, groupMoved: '' })).includes('group-moved'));
    assert.ok(!ids(facts({ view })).includes('group-moved'), 'absent means none');
  }
});

test('ADA says the clocks asked for wait for a recalculation, and what whole machines cost (#1066)', () => {
  for (const view of ['factories', 'plan']) {
    const line = adaRemarks(facts({ view, exactClocksPending: 2 })).find(
      r => r.id === 'exact-clocks-pending',
    )!;
    assert.equal(line.tone, 'warn');
    assert.match(line.text, /^You changed the clocks of 2 production lines/);
    assert.match(
      line.text,
      /Nothing recalculates by itself: Recalculate in place with exact clocks/,
    );
    assert.match(line.text, /plans them and keeps this version as a backup\./);
    assert.ok(!ids(facts({ view })).includes('exact-clocks-pending'), 'absent means none');
  }
  assert.match(
    adaRemarks(facts({ view: 'plan', exactClocksPending: 1 })).find(
      r => r.id === 'exact-clocks-pending',
    )!.text,
    /^You changed the clocks of 1 production line,.* plans it and keeps/,
  );
  const cost = adaRemarks(
    facts({ view: 'plan', roundingCost: { buildings: '1,226 buildings', power: '33.4 GW' } }),
  ).find(r => r.id === 'rounding-cost')!;
  assert.equal(cost.tone, 'calm');
  assert.match(
    cost.text,
    /^Whole machines at 100% cost this phase 1,226 buildings and 33.4 GW more/,
  );
  assert.match(cost.text, /dialog can set that one line to exact clocks/);
  assert.ok(!ids(facts({ view: 'plan' })).includes('rounding-cost'), 'absent without the record');
});

test('a completed Post Phase 5 points to no Phase 6 (#1069)', () => {
  const done = (phaseLabel: string) =>
    first(
      facts({
        phaseLabel,
        steps: { done: 10, total: 10 },
        next: '',
        factories: { done: 3, total: 6 },
      }),
    );
  assert.equal(done('Post Phase 5').id, 'complete');
  assert.match(
    done('Post Phase 5').text,
    /There is no Phase 6, pioneer: keep the lines running\.$/,
  );
  assert.doesNotMatch(done('Post Phase 5').text, /phase selector/);
  assert.match(
    done('Phase 3').text,
    /Move the phase selector at the top once the delivery is in\.$/,
  );
});

test('ADA speaks on the guided start’s "What you already have" screen only (#1068)', () => {
  const on = facts({
    view: 'wizard',
    guided: true,
    guidedStep: 2,
    guidedTotal: 8,
    guidedHave: true,
  });
  const line = adaRemarks(on).find(remark => remark.id === 'guided-have');
  assert.ok(line);
  assert.equal(line.tone, 'calm');
  assert.match(line.text, /I stop sending you to unlock it/);
  assert.ok(!ids({ ...on, guidedHave: false }).includes('guided-have'));
  assert.ok(!ids(facts({ view: 'wizard' })).includes('guided-have'));
});
