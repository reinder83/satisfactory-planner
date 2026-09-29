// Retiring the handbook profile type (#387): the original handbook (plan.json, or the copy an
// imported profile carries) transcribed into an ordinary calculated snapshot, without solving
// anything (#394, #486). A fresh solve would pick other recipes and counts and drop progress, so
// every stage row comes from the handbook's own figures, and its narrative goes into the plan's
// guide (#466) with every check id unchanged. Pure: nothing here reads or writes a store; part 4
// (#395) runs it. The recipes come in as an argument, so both editions can call it.
//
// It is generic: a handbook an older release exported may have other factory ids or a recipe
// this recipes.json no longer has. Such a factory is left out and reported in `skipped`, never
// guessed; the state migration (#487) keeps its progress in handbookOrigin.unmapped.
import { validateState } from './state.ts';
import type {
  CalcRow,
  GuideStep,
  Handbook,
  HandbookFactory,
  HandbookFactoryStage,
  HandbookOrigin,
  ItemRates,
  OilLine,
  PlanGuide,
  ProgressState,
  Recipe,
  SavedState,
  StageKey,
  StoredCalculatedPlan,
  StoredSettings,
  StoredProfile,
  StoredStage,
} from './types/index.ts';

// The recipe the handbook gives its Plastic and Rubber factories where one shared oil campus
// makes both (Phases 4 and 5). It is no recipe of the game: the campus's own lines
// (plans[stage].oil) become the rows instead, and those factories' ticks are not guessed
// (decision 6B on #387).
export const OIL_CAMPUS = 'Recycled petrochemical campus';

// Whether a plan is a transcribed handbook (#486): its engine names the handbook, not a solver.
export const isTranscribed = (plan: { engine?: string } | null | undefined): boolean =>
  !!plan?.engine?.startsWith('handbook-');

// What Recalculate, round-up and the payoff ranking say before they solve a transcribed plan
// afresh (decision 7B on #387, #480). Naming the source is the point here, so it names the handbook.
export const RESOLVE_WARNING =
  'This plan was transcribed from the original handbook, not solved by this planner, so solving it afresh can change its recipes and machine counts.';

// The warning on every transcribed snapshot. No "handbook" in user-facing copy (decision 8).
export const TRANSCRIBED = 'Transcribed from the original plan; not solved by this planner.';

// The handbook's own assumptions, as the wizard has long started a new profile from an original
// one (app/wizard/wizard.ts): Phase 3, pure nodes, 50× elevator parts, half power, pure ingots,
// whole machines. The resource budgets are the handbook's capacities.
const SETTINGS: Omit<StoredSettings, 'limits'> = {
  phase: '3',
  purity: 'pure',
  distribution: 'randomized',
  multiplier: 50,
  powerFactor: 0.5,
  availablePowerGW: 0,
  recipes: 'all',
  pureIngots: true,
  sam: 'needed',
  nuclear: 'recycle',
  uraniumReactors: 1,
  storage: 'all',
  storageRate: 1,
  cellsPerMinute: 20,
  goal: 'timed',
  hours: 8,
  roundRates: true,
  wholeMachines: true,
  limitsConfirmed: false,
  modNotes: '',
};

// The handbook's power commissioning checklist (ResourcesPage.vue draws it from here): saved
// check key, label.
export const POWER_CHECKS: { id: string; label: string }[] = [
  { id: 'power-retained', label: 'Retained turbofuel: 44.425 GW' },
  { id: 'power-rocket-1', label: 'Rocket-fuel block 1: +72 GW' },
  { id: 'power-rocket-2', label: 'Rocket-fuel block 2: +72 GW' },
  { id: 'power-u4', label: 'Phase 4 uranium: +125 GW' },
  ...[3, 4, 5, 6].map(n => ({ id: 'power-rocket-' + n, label: `Rocket-fuel block ${n}: +72 GW` })),
  { id: 'power-nuclear-final', label: 'Complete nuclear fleet: 437.5 GW total' },
];

// The copy the handbook's resources page shows beside that checklist, as plain text blocks: a
// paragraph per blank line (CalculatedResourcesPage.vue, #469).
export const POWER_BLOCKS: { title: string; body: string }[] = [
  {
    title: 'One 72 GW rocket-fuel block',
    body: [
      'Inputs/min: 300 m³ Crude, 800 Sulfur, 400 Coal, 600 m³ Nitrogen and 1,000 m³ Water.',
      '10 Heavy Oil Residue refineries → 8 Diluted Fuel blenders → 8 Nitro Rocket Fuel blenders. Add 5 Residual Rubber refineries and 288 Fuel Generators at 100%.',
      'Produces 1,200 Rocket Fuel, 200 Compacted Coal and 100 Rubber/min. These byproducts are not credited against other factory contracts.',
      'At Phase 5: (579.231 × 1.2 + 20) ÷ 0.8 ≈ 894 GW preliminary requirement. Planned gross capacity: 913.925 GW. Replace the 20 GW existing-load allowance with your measured load.',
    ].join('\n\n'),
  },
  {
    title: 'Nuclear sequence',
    body: [
      'Phase 4: 50 uranium reactors generate 500 waste/min. Process it into 2.5 Plutonium Fuel Rods/min and sink those rods.',
      'Phase 5: 100 uranium reactors → 1,000 Uranium Waste/min → 5 Plutonium Fuel Rods/min → 50 plutonium reactors → 50 Plutonium Waste/min → 25 Ficsonium Fuel Rods/min → 25 Ficsonium reactors.',
      'Build downstream processing and burning capacity first. Final reactor cooling needs 42,000 m³ Water/min, already included in the resource table. Keep radioactive buffers at the nuclear site.',
    ].join('\n\n'),
  },
];

// A handbook factory the transcription could not turn into a row, per stage: its recipe is the
// oil campus (its lines are rows instead), not in recipes.json, or one another factory of the
// stage already makes (a row id is unique within its stage).
export interface SkippedFactory {
  stage: string;
  factory: string;
  recipe: string;
  why: 'oil-campus' | 'unknown-recipe' | 'duplicate-recipe';
}

export interface HandbookConversion {
  plan: StoredCalculatedPlan;
  // Per stage, each handbook factory id's row id: what factory-<stage>-<id> ticks become
  // (calc-<stage>-<row id>, #487). A skipped factory has none.
  rows: Record<string, Record<string, string>>;
  skipped: SkippedFactory[];
}

const scale = (rates: ItemRates, k: number): ItemRates =>
  Object.fromEntries(Object.entries(rates).map(([n, q]) => [n, q * k]));
// The last machine's clock in % for `equivalent` machine-equivalents on `machines` buildings.
const lastClock = (equivalent: number, machines: number) =>
  Math.round((equivalent - (machines - 1)) * 100 * 1000) / 1000;
// A row's name is what it makes, as a calculated row's is: the recipe without "Alternate: ".
const productName = (r: Recipe) => r.name.replace(/^Alternate:\s*/, '');

// One handbook factory at one stage as a calculated row: the handbook's machines, rates, inputs
// and peak power; outputs are the recipe's scaled to the handbook's machine-equivalents, with the
// main product at the handbook's own rate. A factory the stage's oil campus makes (Phase 3's
// Plastic and Rubber, which the handbook lists with 0 machines and no inputs) takes its machines,
// power and inputs from that campus line, and keeps its own name and output.
function factoryRow(
  f: HandbookFactory,
  s: HandbookFactoryStage,
  r: Recipe,
  line?: OilLine,
): CalcRow {
  const equivalent = line?.equivalent ?? s.equivalent ?? s.machines;
  const outputs = scale(r.outputs, equivalent);
  outputs[f.name] = s.output;
  return {
    id: r.id,
    name: f.name,
    alternate: r.alternate,
    phase: r.phase,
    machine: line?.machine ?? s.machine,
    power: r.power,
    inputs: line ? scale(r.inputs, line.equivalent) : { ...s.inputs },
    outputs,
    equivalent,
    machines: line?.machines ?? s.machines,
    lastClock: line ? lastClock(line.equivalent, line.machines) : (s.lastClock ?? 100),
    peakMW: line?.peakMW ?? s.peakMW,
    generationMW: 0,
  };
}

function stageOf(
  handbook: Handbook,
  st: string,
  byName: Map<string, Recipe>,
  rowsOf: Record<string, string>,
  skipped: SkippedFactory[],
  notes: NonNullable<PlanGuide['factories']>,
): StoredStage {
  const rows: CalcRow[] = [];
  const seen = new Set<string>();
  for (const f of handbook.factories) {
    const s = f.stages[st];
    if (!s) continue;
    const r = byName.get(s.recipe);
    if (s.recipe === OIL_CAMPUS || !r || seen.has(r.id)) {
      skipped.push({
        stage: st,
        factory: f.id,
        recipe: s.recipe,
        why: s.recipe === OIL_CAMPUS ? 'oil-campus' : !r ? 'unknown-recipe' : 'duplicate-recipe',
      });
      continue;
    }
    seen.add(r.id);
    rows.push(
      factoryRow(
        f,
        s,
        r,
        handbook.plans[st]?.oil?.find(l => l.recipe === s.recipe),
      ),
    );
    rowsOf[f.id] = r.id;
    // The factory's note, page and where it is built follow its row; the handbook drew its
    // Plastic and Rubber, and nuclear factories, at a shared site.
    const site = ['Plastic', 'Rubber'].includes(f.name) ? 'oil' : f.nuclear ? 'nuclear' : undefined;
    notes[r.id] ??= {
      ...(f.note ? { note: f.note } : {}),
      page: f.page,
      ...(f.local ? { local: true } : {}),
      ...(f.nuclear ? { nuclear: true } : {}),
      ...(site ? { site } : {}),
    };
  }
  // The oil campus's own lines, unless a factory row already makes the same recipe (Phase 3's
  // Plastic and Rubber factories are those lines, drawn with the line's figures above).
  for (const l of handbook.plans[st]?.oil ?? []) {
    const r = byName.get(l.recipe);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push({
      id: r.id,
      name: productName(r),
      alternate: r.alternate,
      phase: r.phase,
      machine: l.machine,
      power: r.power,
      inputs: scale(r.inputs, l.equivalent),
      outputs: scale(r.outputs, l.equivalent),
      equivalent: l.equivalent,
      machines: l.machines,
      lastClock: lastClock(l.equivalent, l.machines),
      peakMW: l.peakMW,
      generationMW: 0,
    });
    notes[r.id] ??= { site: 'oil' };
  }
  const deliveries = handbook.deliveries.filter(d => d.phase === st);
  // The handbook's power figure is the gross generation at the stage's completion; it lists no
  // generators, so there are no generator rows and generation is that figure.
  const generationMW = (handbook.power[st] ?? 0) * 1000,
    requiredMW = (handbook.plans[st]?.manufacturingPeakGW ?? 0) * 1000;
  // Hours to hand in what the handbook had not yet handed in, at its rates.
  const hours = Math.max(
    0,
    ...deliveries.filter(d => d.rate > 0).map(d => (d.target - d.initial) / d.rate / 60),
  );
  return {
    feasible: true,
    rows,
    raw: { ...(handbook.resources[st] ?? {}) },
    supplied: {},
    storage: Object.fromEntries(
      handbook.factories
        .filter(f => (f.stages[st]?.storage ?? 0) > 0)
        .map(f => [f.name, f.stages[st]!.storage]),
    ),
    drone: {},
    transport: {},
    delivery: Object.fromEntries(deliveries.map(d => [d.name, { target: d.target, rate: d.rate }])),
    surplus: {},
    plutoniumSink: 0,
    peakMW: rows.reduce((a, r) => a + r.peakMW, 0),
    generationMW,
    sloopsUsed: 0,
    augmenters: 0,
    fueledAugmenters: 0,
    boost: 0,
    augmenterMW: 0,
    matrixRate: 0,
    availableMW: generationMW,
    requiredMW,
    additionalHeadroomMW: Math.max(0, requiredMW - generationMW),
    hours,
    conversions: handbook.factories.filter(f => f.conversion && f.stages[st]).map(f => f.name),
  };
}

const steps = (ts: { id: string; title: string; body: string }[]): GuideStep[] =>
  ts.map(t => ({ id: t.id, title: t.title, body: t.body }));

// The handbook as a calculated snapshot (#486). Phases 1 and 2, which the handbook never
// planned, are empty phases a profile can still select (decision 4 on #387). `baseLimits` are
// the budgets for resources the handbook gives no capacity (Water, Nitrogen Gas): the catalog's
// all-pure limits, as the wizard used for a profile started from the handbook. Without them
// those resources read as having no budget.
export function handbookToPlan(
  handbook: Handbook,
  recipes: Recipe[],
  baseLimits: ItemRates = {},
): HandbookConversion {
  const byName = new Map(recipes.map(r => [r.name, r]));
  const rows: Record<string, Record<string, string>> = {};
  const skipped: SkippedFactory[] = [];
  const notes: NonNullable<PlanGuide['factories']> = {};
  const stage = (st: StageKey): StoredStage =>
    st === '1' || st === '2'
      ? { feasible: true, rows: [] }
      : stageOf(handbook, st, byName, (rows[st] = {}), skipped, notes);
  const phases: PlanGuide['phases'] = {};
  for (const [ph, ts] of Object.entries(handbook.phases)) if (ts?.length) phases[ph] = steps(ts);
  const guide: PlanGuide = {
    phases,
    // A part the handbook does not have is left out, not written empty (#473 review).
    ...(handbook.storageTasks?.length ? { storageTasks: steps(handbook.storageTasks) } : {}),
    ...(handbook.completion?.length ? { completion: structuredClone(handbook.completion) } : {}),
    power: { checks: structuredClone(POWER_CHECKS), blocks: structuredClone(POWER_BLOCKS) },
    ...(handbook.sources?.length ? { sources: structuredClone(handbook.sources) } : {}),
  };
  const stages = {
    '1': stage('1'),
    '2': stage('2'),
    '3': stage('3'),
    '4': stage('4'),
    '5': stage('5'),
  };
  if (Object.keys(notes).length) guide.factories = notes;
  // A dated handbook stamps the snapshot with its own date, so the conversion is repeatable.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(handbook.version) ? handbook.version : '1970-01-01';
  return {
    plan: {
      engine: 'handbook-' + handbook.version,
      settings: { ...SETTINGS, limits: { ...baseLimits, ...handbook.capacities } },
      stages,
      warnings: [TRANSCRIBED],
      createdAt: date + 'T00:00:00.000Z',
      guide,
    },
    rows,
    skipped,
  };
}

// A handbook profile's progress re-keyed for the plan handbookToPlan made of the same handbook
// (#487, part 3c of #394). Every record is kept, moved to its new key, or kept for review in
// handbookOrigin.unmapped (#485); nothing is dropped:
//   check factory-<stage>-<factory id>   → calc-<stage>-<row id>; unplaceable → unmapped
//   note factory-<factory id>            → factory-<row id> for each row the factory became;
//                                          an unknown id, unplaceable or clashing → unmapped
//   factory-group assignment <factory id> → each row the factory became; an unknown id or
//                                          unplaceable → unmapped
//   step link to a factory id            → that factory's row in the step's phase; a link it
//                                          cannot place stays as it is
//   deliveries                           → ids unchanged; the handbook's own count written
//                                          where none is saved, as its page counted from
//   the handbook's knownChecks           → written where none is saved, as its page counted
//   everything else (other checks and notes, task edits, custom tasks, slot-* records,
//   storageEdits, the phase) unchanged.
// The Plastic and Rubber campus ticks are not guessed (decision 6B): the conversion skipped
// them, so they land in unmapped. A state that already carries handbookOrigin is returned as it
// is, so migrating twice equals migrating once.
export function migrateHandbookState(
  state: SavedState,
  handbook: Handbook,
  conversion: HandbookConversion,
): ProgressState {
  const s = validateState(structuredClone(state));
  if (s.handbookOrigin) return s;
  const rows = conversion.rows;
  // Every row a factory became, in stage order, without repeats.
  const rowsOf = (fid: string) => [
    ...new Set(['3', '4', '5'].map(st => rows[st]?.[fid]).filter((x): x is string => !!x)),
  ];
  const unmapped: HandbookOrigin['unmapped'] = { checks: {}, notes: {}, assignments: {} };
  const checks: Record<string, boolean> = {};
  const moved: [string, boolean][] = [];
  for (const [k, v] of Object.entries(s.checks)) {
    const m = /^factory-([345])-(.+)$/.exec(k);
    if (!m) checks[k] = v;
    else if (rows[m[1]!]?.[m[2]!]) moved.push([`calc-${m[1]}-${rows[m[1]!]![m[2]!]}`, v]);
    else unmapped.checks[k] = v;
  }
  // A moved tick never overwrites a check the state already holds under that key.
  for (const [k, v] of moved)
    if (k in checks) unmapped.checks[k.replace(/^calc-/, 'moved-calc-')] = v;
    else checks[k] = v;
  for (const [k, v] of Object.entries(handbook.knownChecks || {}))
    if (!(k in checks)) checks[k] = v;
  const notes: Record<string, string> = {};
  const factoryNotes: [string, string][] = [];
  const known = new Set(handbook.factories.map(f => f.id));
  // In a handbook state every factory-<id> note names a handbook factory; one this handbook
  // no longer has (an id renamed or removed between releases) is kept for review (#493 review).
  for (const [k, v] of Object.entries(s.notes)) {
    const fid = k.startsWith('factory-') ? k.slice('factory-'.length) : '';
    if (!fid) notes[k] = v;
    else if (known.has(fid)) factoryNotes.push([fid, v]);
    else unmapped.notes[k] = v;
  }
  for (const [fid, v] of factoryNotes) {
    const targets = rowsOf(fid);
    let clash = !targets.length;
    for (const row of targets) {
      const key = 'factory-' + row;
      if (key in notes && notes[key] !== v) clash = true;
      else notes[key] = v;
    }
    if (clash) unmapped.notes['factory-' + fid] = v;
  }
  const assignments: typeof s.factoryGroups.assignments = {};
  const assign: [string, (typeof assignments)[string]][] = [];
  // Every assignment key of a handbook state is a factory id; one for no factory of this handbook
  // would name no row of the plan, and a Recalculate would drop it, so it is kept for review.
  for (const [k, list] of Object.entries(s.factoryGroups.assignments))
    if (known.has(k)) assign.push([k, list]);
    else unmapped.assignments[k] = list;
  for (const [fid, list] of assign) {
    const targets = rowsOf(fid);
    if (!targets.length || targets.some(row => row in assignments)) {
      unmapped.assignments[fid] = list;
      continue;
    }
    for (const row of targets) assignments[row] = structuredClone(list);
  }
  // A saved step link names a handbook factory; it becomes that factory's row in the step's
  // phase (Post Phase 5 uses Phase 5's), or its first row when the step has no phase.
  const phaseOf = (step: string) =>
    /^phase-([345]|post)-/.exec(step)?.[1] ?? s.customTasks.find(t => t.id === step)?.phase;
  const links: Record<string, string> = {};
  for (const [step, fid] of Object.entries(s.taskEdits.links)) {
    const ph = phaseOf(step);
    const st = ph === 'post' ? '5' : ph;
    links[step] = (st && rows[st]?.[fid]) || rowsOf(fid)[0] || fid;
  }
  const deliveries = { ...s.deliveries };
  for (const d of handbook.deliveries)
    if (deliveries[d.id] === undefined && d.initial > 0) deliveries[d.id] = d.initial;
  return validateState({
    ...s,
    checks,
    notes,
    deliveries,
    taskEdits: { ...s.taskEdits, links },
    factoryGroups: { ...s.factoryGroups, assignments },
    handbookOrigin: { version: handbook.version, unmapped },
  });
}

// An original profile migrated whole (#495): its own handbook, or the fallback (the server's
// frozen copy of the handbook it was made with) when it carries none, transcribed with the
// catalog's pure-node limits as the base budgets, so resources the handbook gave no capacity
// (Water, Nitrogen Gas) are not shown over budget; then its progress re-keyed. The result is an
// ordinary calculated profile with the same id and name and no handbook. Anything else is
// returned as it is. The server, the browser store and imports all call this (#495, #497, #498).
export function migrateOriginalProfile<P extends StoredProfile>(
  profile: P,
  fallbackHandbook: Handbook,
  recipes: Recipe[],
  pureLimits: Record<string, number>,
): P {
  if (profile.kind !== 'original') return profile;
  const { handbook: own, state, ...rest } = profile;
  const handbook = own || fallbackHandbook;
  const conversion = handbookToPlan(handbook, recipes, pureLimits);
  return {
    ...rest,
    kind: 'calculated',
    plan: conversion.plan,
    state: migrateHandbookState(state, handbook, conversion),
  } as unknown as P;
}
