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
import { safeKey, validateState } from './state.ts';
import type {
  CalcRow,
  GuideStep,
  Handbook,
  HandbookFactory,
  HandbookFactoryStage,
  HandbookMapping,
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
  UntypedHandbookFields,
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
  ...[3, 4, 5, 6].map(block => ({
    id: 'power-rocket-' + block,
    label: `Rocket-fuel block ${block}: +72 GW`,
  })),
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

const scale = (rates: ItemRates, factor: number): ItemRates =>
  Object.fromEntries(Object.entries(rates).map(([item, rate]) => [item, rate * factor]));
// The last machine's clock in % for `equivalent` machine-equivalents on `machines` buildings.
const lastClock = (equivalent: number, machines: number) =>
  Math.round((equivalent - (machines - 1)) * 100 * 1000) / 1000;
// A row's name is what it makes, as a calculated row's is: the recipe without "Alternate: ".
const productName = (recipe: Recipe) => recipe.name.replace(/^Alternate:\s*/, '');

// One handbook factory at one stage as a calculated row: the handbook's machines, rates, inputs
// and peak power; outputs are the recipe's scaled to the handbook's machine-equivalents, with the
// main product at the handbook's own rate. A factory the stage's oil campus makes (Phase 3's
// Plastic and Rubber, which the handbook lists with 0 machines and no inputs) takes its machines,
// power and inputs from that campus line, and keeps its own name and output.
function factoryRow(
  factory: HandbookFactory,
  stage: HandbookFactoryStage,
  recipe: Recipe,
  line?: OilLine,
): CalcRow {
  const equivalent = line?.equivalent ?? stage.equivalent ?? stage.machines;
  const outputs = scale(recipe.outputs, equivalent);
  outputs[factory.name] = stage.output;
  return {
    id: recipe.id,
    name: factory.name,
    alternate: recipe.alternate,
    phase: recipe.phase,
    machine: line?.machine ?? stage.machine,
    power: recipe.power,
    inputs: line ? scale(recipe.inputs, line.equivalent) : { ...stage.inputs },
    outputs,
    equivalent,
    machines: line?.machines ?? stage.machines,
    lastClock: line ? lastClock(line.equivalent, line.machines) : (stage.lastClock ?? 100),
    peakMW: line?.peakMW ?? stage.peakMW,
    generationMW: 0,
  };
}

function stageOf(
  handbook: Handbook,
  phase: string,
  byName: Map<string, Recipe>,
  rowsOf: Record<string, string>,
  skipped: SkippedFactory[],
  notes: NonNullable<PlanGuide['factories']>,
): StoredStage {
  const rows: CalcRow[] = [];
  const seen = new Set<string>();
  for (const factory of handbook.factories) {
    const stage = factory.stages[phase];
    if (!stage) continue;
    const recipe = byName.get(stage.recipe);
    if (stage.recipe === OIL_CAMPUS || !recipe || seen.has(recipe.id)) {
      skipped.push({
        stage: phase,
        factory: factory.id,
        recipe: stage.recipe,
        why:
          stage.recipe === OIL_CAMPUS
            ? 'oil-campus'
            : !recipe
              ? 'unknown-recipe'
              : 'duplicate-recipe',
      });
      continue;
    }
    seen.add(recipe.id);
    rows.push(
      factoryRow(
        factory,
        stage,
        recipe,
        handbook.plans[phase]?.oil?.find(line => line.recipe === stage.recipe),
      ),
    );
    rowsOf[factory.id] = recipe.id;
    // The factory's note, page and where it is built follow its row; the handbook drew its
    // Plastic and Rubber, and nuclear factories, at a shared site.
    const site = ['Plastic', 'Rubber'].includes(factory.name)
      ? 'oil'
      : factory.nuclear
        ? 'nuclear'
        : undefined;
    notes[recipe.id] ??= {
      ...(factory.note ? { note: factory.note } : {}),
      page: factory.page,
      ...(factory.local ? { local: true } : {}),
      ...(factory.nuclear ? { nuclear: true } : {}),
      ...(site ? { site } : {}),
    };
  }
  // The oil campus's own lines, unless a factory row already makes the same recipe (Phase 3's
  // Plastic and Rubber factories are those lines, drawn with the line's figures above).
  for (const line of handbook.plans[phase]?.oil ?? []) {
    const recipe = byName.get(line.recipe);
    if (!recipe || seen.has(recipe.id)) continue;
    seen.add(recipe.id);
    rows.push({
      id: recipe.id,
      name: productName(recipe),
      alternate: recipe.alternate,
      phase: recipe.phase,
      machine: line.machine,
      power: recipe.power,
      inputs: scale(recipe.inputs, line.equivalent),
      outputs: scale(recipe.outputs, line.equivalent),
      equivalent: line.equivalent,
      machines: line.machines,
      lastClock: lastClock(line.equivalent, line.machines),
      peakMW: line.peakMW,
      generationMW: 0,
    });
    notes[recipe.id] ??= { site: 'oil' };
  }
  const deliveries = handbook.deliveries.filter(d => d.phase === phase);
  // The handbook's power figure is the gross generation at the stage's completion; it lists no
  // generators, so there are no generator rows and generation is that figure.
  const generationMW = (handbook.power[phase] ?? 0) * 1000,
    requiredMW = (handbook.plans[phase]?.manufacturingPeakGW ?? 0) * 1000;
  // Hours to hand in what the handbook had not yet handed in, at its rates.
  const hours = Math.max(
    0,
    ...deliveries.filter(d => d.rate > 0).map(d => (d.target - d.initial) / d.rate / 60),
  );
  return {
    feasible: true,
    rows,
    raw: { ...(handbook.resources[phase] ?? {}) },
    supplied: {},
    storage: Object.fromEntries(
      handbook.factories
        .filter(f => (f.stages[phase]?.storage ?? 0) > 0)
        .map(f => [f.name, f.stages[phase]!.storage]),
    ),
    drone: {},
    transport: {},
    delivery: Object.fromEntries(deliveries.map(d => [d.name, { target: d.target, rate: d.rate }])),
    surplus: {},
    plutoniumSink: 0,
    peakMW: rows.reduce((total, row) => total + row.peakMW, 0),
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
    conversions: handbook.factories.filter(f => f.conversion && f.stages[phase]).map(f => f.name),
  };
}

const steps = (tasks: { id: string; title: string; body: string }[]): GuideStep[] =>
  tasks.map(task => ({ id: task.id, title: task.title, body: task.body }));

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
  const stage = (phase: StageKey): StoredStage =>
    phase === '1' || phase === '2'
      ? { feasible: true, rows: [] }
      : stageOf(handbook, phase, byName, (rows[phase] = {}), skipped, notes);
  const phases: PlanGuide['phases'] = {};
  for (const [phase, tasks] of Object.entries(handbook.phases))
    if (tasks?.length) phases[phase] = steps(tasks);
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

// What migrateHandbookState needs of a handbook and its conversion (#606): per stage, each
// factory id's row id; the factory ids; the knownChecks; and each delivery's starting count above
// 0 (the first, where an id repeats, as the migration has always used). The migration records it
// on the profile (handbookOrigin.mapping), so a progress backup made before the migration can be
// re-keyed later without the handbook (restoreProgress). An id that fails safeKey is left out: no
// saved record can name it.
export function handbookMapping(
  handbook: Handbook,
  conversion: HandbookConversion,
): HandbookMapping {
  const rows: HandbookMapping['rows'] = {};
  for (const stage of ['3', '4', '5'] as const) {
    const ids = conversion.rows[stage];
    if (ids)
      rows[stage] = Object.fromEntries(
        Object.entries(ids).filter(([factoryId, rowId]) => safeKey(factoryId) && safeKey(rowId)),
      );
  }
  const factories = [...new Set(handbook.factories.map(f => f.id).filter(safeKey))];
  const knownChecks = Object.fromEntries(
    Object.entries(handbook.knownChecks || {}).filter(([key]) => safeKey(key)),
  );
  const deliveries: Record<string, number> = {};
  for (const delivery of handbook.deliveries)
    if (safeKey(delivery.id) && !(delivery.id in deliveries) && delivery.initial > 0)
      deliveries[delivery.id] = delivery.initial;
  return { rows, factories, knownChecks, deliveries };
}

// A handbook profile's progress re-keyed for the plan handbookToPlan made of the same handbook
// (#487, part 3c of #394), through that handbook's mapping (handbookMapping). Every record is
// kept, moved to its new key, or kept for review in handbookOrigin.unmapped (#485); nothing is
// dropped:
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
// is, so migrating twice equals migrating once. The result records the mapping
// (handbookOrigin.mapping) when there is one; without one (a restore onto a profile whose
// handbook is unknown, restoreProgress), every handbook-keyed record goes to unmapped.
export function migrateHandbookState(
  state: SavedState,
  handbook: Handbook,
  conversion: HandbookConversion,
): ProgressState {
  return rekeyHandbookState(state, handbook.version, handbookMapping(handbook, conversion));
}

const noMapping: HandbookMapping = { rows: {}, factories: [], knownChecks: {}, deliveries: {} };

function rekeyHandbookState(
  state: SavedState,
  version: string,
  mapping?: HandbookMapping,
): ProgressState {
  const progress = validateState(structuredClone(state));
  if (progress.handbookOrigin) return progress;
  const { rows, factories, knownChecks, deliveries: startCounts } = mapping ?? noMapping;
  const stageRows = (stage: string | undefined) => rows[stage as '3' | '4' | '5'];
  // Every row a factory became, in stage order, without repeats.
  const rowsOf = (factoryId: string) => [
    ...new Set(
      (['3', '4', '5'] as const)
        .map(stage => rows[stage]?.[factoryId])
        .filter((row): row is string => !!row),
    ),
  ];
  const unmapped: HandbookOrigin['unmapped'] = { checks: {}, notes: {}, assignments: {} };
  const checks: Record<string, boolean> = {};
  const moved: [string, boolean][] = [];
  for (const [key, ticked] of Object.entries(progress.checks)) {
    const match = /^factory-([345])-(.+)$/.exec(key);
    const row = match && stageRows(match[1])?.[match[2]!];
    if (!match) checks[key] = ticked;
    else if (row) moved.push([`calc-${match[1]}-${row}`, ticked]);
    else unmapped.checks[key] = ticked;
  }
  // A moved tick never overwrites a check the state already holds under that key.
  for (const [key, ticked] of moved)
    if (key in checks) unmapped.checks[key.replace(/^calc-/, 'moved-calc-')] = ticked;
    else checks[key] = ticked;
  for (const [key, ticked] of Object.entries(knownChecks))
    if (!(key in checks)) checks[key] = ticked;
  const notes: Record<string, string> = {};
  const factoryNotes: [string, string][] = [];
  const known = new Set(factories);
  // In a handbook state every factory-<id> note names a handbook factory; one this handbook
  // no longer has (an id renamed or removed between releases) is kept for review (#493 review).
  for (const [key, note] of Object.entries(progress.notes)) {
    const factoryId = key.startsWith('factory-') ? key.slice('factory-'.length) : '';
    if (!factoryId) notes[key] = note;
    else if (known.has(factoryId)) factoryNotes.push([factoryId, note]);
    else unmapped.notes[key] = note;
  }
  for (const [factoryId, note] of factoryNotes) {
    const targets = rowsOf(factoryId);
    let clash = !targets.length;
    for (const row of targets) {
      const key = 'factory-' + row;
      if (key in notes && notes[key] !== note) clash = true;
      else notes[key] = note;
    }
    if (clash) unmapped.notes['factory-' + factoryId] = note;
  }
  const assignments: typeof progress.factoryGroups.assignments = {};
  const assign: [string, (typeof assignments)[string]][] = [];
  // Every assignment key of a handbook state is a factory id; one for no factory of this handbook
  // would name no row of the plan, and a Recalculate would drop it, so it is kept for review.
  for (const [factoryId, list] of Object.entries(progress.factoryGroups.assignments))
    if (known.has(factoryId)) assign.push([factoryId, list]);
    else unmapped.assignments[factoryId] = list;
  for (const [factoryId, list] of assign) {
    const targets = rowsOf(factoryId);
    if (!targets.length || targets.some(row => row in assignments)) {
      unmapped.assignments[factoryId] = list;
      continue;
    }
    for (const row of targets) assignments[row] = structuredClone(list);
  }
  // A saved step link names a handbook factory; it becomes that factory's row in the step's
  // phase (Post Phase 5 uses Phase 5's), or its first row when the step has no phase.
  const phaseOf = (step: string) =>
    /^phase-([345]|post)-/.exec(step)?.[1] ??
    progress.customTasks.find(task => task.id === step)?.phase;
  const links: Record<string, string> = {};
  for (const [step, factoryId] of Object.entries(progress.taskEdits.links)) {
    const phase = phaseOf(step);
    const stage = phase === 'post' ? '5' : phase;
    links[step] = stageRows(stage)?.[factoryId] || rowsOf(factoryId)[0] || factoryId;
  }
  const deliveries = { ...progress.deliveries };
  for (const [id, count] of Object.entries(startCounts))
    if (deliveries[id] === undefined) deliveries[id] = count;
  return validateState({
    ...progress,
    checks,
    notes,
    deliveries,
    taskEdits: { ...progress.taskEdits, links },
    factoryGroups: { ...progress.factoryGroups, assignments },
    handbookOrigin: {
      version,
      unmapped,
      ...(mapping ? { mapping: structuredClone(mapping) } : {}),
    },
  });
}

// The mapping of the server's frozen handbook (migrations/), for a profile migrated before
// handbookOrigin.mapping existed: it fits only a profile whose handbookOrigin.version is the same.
export interface FrozenMapping {
  version: string;
  mapping: HandbookMapping;
}

// A progress backup restored onto a profile (/api/import, both editions, #606). Onto a profile
// migrated from the handbook (one whose state has handbookOrigin), a backup made before the
// migration (one without handbookOrigin) is re-keyed as the migration re-keyed the profile: by
// the profile's recorded mapping, else by `frozen` when its version matches, else with every
// handbook-keyed record kept for review in handbookOrigin.unmapped. So nothing of the backup is
// dropped, and the profile stays marked as migrated. A backup made after the migration, and any
// backup onto another profile, restores as it is. `current` is the profile's progress, `backup`
// the validated backup; neither is changed.
export function restoreProgress(
  current: SavedState,
  backup: ProgressState,
  frozen?: FrozenMapping,
): ProgressState {
  const origin = current.handbookOrigin;
  if (!origin || backup.handbookOrigin) return backup;
  const mapping =
    origin.mapping ?? (frozen?.version === origin.version ? frozen.mapping : undefined);
  return rekeyHandbookState(backup, origin.version, mapping);
}
// Whether restoreProgress could use the frozen mapping for this restore, so the server reads its
// frozen handbook only then.
export const needsFrozenMapping = (current: SavedState, backup: ProgressState): boolean =>
  !!current.handbookOrigin && !current.handbookOrigin.mapping && !backup.handbookOrigin;

// The parts of a stored or imported handbook the conversion can read (#609). Every release
// exported a whole plan.json, but a hand-made or damaged file could carry, say, only factories,
// phases and storage, and handbookToPlan and migrateHandbookState read every field unchecked: a
// store holding such a profile could not migrate it, so the server would not start and the
// browser edition refused every transaction. Here a field the conversion reads that is missing
// or of the wrong shape becomes empty, and an entry of the wrong shape (a factory, a factory's
// stage, a delivery, an oil line, a step) is left out, so the rest still converts. Nothing of the
// progress is lost that way: a tick or note for a factory or stage left out lands in
// handbookOrigin.unmapped, like one for a factory the handbook lacks, and each store keeps the
// record as it was in its pre-migration copy. `complete` says nothing had to be left out or
// filled in; an import refuses a handbook that is not (validateTransfer), since the file is the
// user's own copy. A whole handbook comes back equal to what went in.
export function usableHandbook(raw: unknown): { handbook: Handbook; complete: boolean } {
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value: unknown): value is string => typeof value === 'string';
  const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const optionalFinite = (value: unknown) => value === undefined || finite(value);
  const rates = (value: unknown) => record(value) && Object.values(value).every(finite);
  // A saved check, note or delivery key.
  const key = safeKey;
  const task = (value: unknown) =>
    record(value) && key(value.id) && text(value.title) && text(value.body);
  // Every field unknown until the checks below narrow it; the return says what they left.
  const handbook: UntypedHandbookFields = record(raw) ? structuredClone(raw) : {};
  // A required field: kept when `valid`, otherwise the empty `fallback`.
  const field = (name: string, valid: (value: unknown) => boolean, fallback: unknown) => {
    if (!valid(handbook[name])) handbook[name] = fallback;
  };
  // Filters a list in place, keeping the entries `keep` accepts.
  const only = (list: unknown[], keep: (value: unknown) => boolean) => {
    for (let i = list.length - 1; i >= 0; i--) if (!keep(list[i])) list.splice(i, 1);
  };
  // Filters a record's values in place.
  const onlyValues = (values: Record<string, unknown>, keep: (value: unknown) => boolean) => {
    for (const [name, value] of Object.entries(values)) if (!keep(value)) delete values[name];
  };
  field('version', value => text(value) && /^[\w.:-]{1,40}$/.test(value), 'unknown');
  field('phases', record, {});
  onlyValues(handbook.phases as Record<string, unknown>, Array.isArray);
  for (const tasks of Object.values(handbook.phases as Record<string, unknown[]>))
    only(tasks, task);
  field('factories', Array.isArray, []);
  const stage = (value: unknown) =>
    record(value) &&
    text(value.recipe) &&
    text(value.machine) &&
    finite(value.machines) &&
    finite(value.output) &&
    finite(value.peakMW) &&
    rates(value.inputs) &&
    optionalFinite(value.equivalent) &&
    optionalFinite(value.lastClock) &&
    optionalFinite(value.storage);
  only(
    handbook.factories as unknown[],
    factory => record(factory) && text(factory.id) && text(factory.name),
  );
  for (const factory of handbook.factories as Record<string, unknown>[]) {
    if (!record(factory.stages)) factory.stages = {};
    onlyValues(factory.stages as Record<string, unknown>, stage);
    if (factory.note !== undefined && !text(factory.note)) delete factory.note;
    if (factory.page !== undefined && !finite(factory.page)) delete factory.page;
  }
  field('deliveries', Array.isArray, []);
  only(
    handbook.deliveries as unknown[],
    delivery =>
      record(delivery) &&
      key(delivery.id) &&
      text(delivery.phase) &&
      text(delivery.name) &&
      finite(delivery.target) &&
      finite(delivery.rate) &&
      // Written as a saved delivery count when none is saved (migrateHandbookState).
      Number.isSafeInteger(delivery.initial) &&
      (delivery.initial as number) >= 0 &&
      (delivery.initial as number) <= 1000000000,
  );
  field('resources', record, {});
  onlyValues(handbook.resources as Record<string, unknown>, rates);
  field('capacities', record, {});
  onlyValues(handbook.capacities as Record<string, unknown>, finite);
  field('power', record, {});
  onlyValues(handbook.power as Record<string, unknown>, finite);
  field('plans', record, {});
  onlyValues(handbook.plans as Record<string, unknown>, record);
  for (const plan of Object.values(handbook.plans as Record<string, Record<string, unknown>>)) {
    if (plan.oil !== undefined && !Array.isArray(plan.oil)) delete plan.oil;
    if (Array.isArray(plan.oil))
      only(
        plan.oil,
        line =>
          record(line) &&
          text(line.recipe) &&
          text(line.machine) &&
          finite(line.equivalent) &&
          finite(line.machines) &&
          finite(line.peakMW),
      );
    if (plan.manufacturingPeakGW !== undefined && !finite(plan.manufacturingPeakGW))
      delete plan.manufacturingPeakGW;
  }
  // Optional parts: left out when of the wrong shape, their entries filtered like the rest.
  if (handbook.knownChecks !== undefined && !record(handbook.knownChecks))
    delete handbook.knownChecks;
  if (record(handbook.knownChecks))
    for (const [name, value] of Object.entries(handbook.knownChecks))
      if (!key(name) || typeof value !== 'boolean') delete handbook.knownChecks[name];
  if (handbook.storageTasks !== undefined && !Array.isArray(handbook.storageTasks))
    delete handbook.storageTasks;
  if (Array.isArray(handbook.storageTasks)) only(handbook.storageTasks, task);
  if (handbook.completion !== undefined && !Array.isArray(handbook.completion))
    delete handbook.completion;
  if (Array.isArray(handbook.completion))
    only(
      handbook.completion,
      line =>
        record(line) &&
        [line.id, line.name, line.recipe, line.machine].every(text) &&
        [line.output, line.machines, line.lastClock].every(finite) &&
        rates(line.inputs) &&
        rates(line.byproducts),
    );
  if (handbook.sources !== undefined && !Array.isArray(handbook.sources)) delete handbook.sources;
  if (Array.isArray(handbook.sources))
    only(handbook.sources, source => record(source) && text(source.url));
  return {
    handbook: handbook as Handbook,
    complete: JSON.stringify(handbook) === JSON.stringify(raw),
  };
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
): P | MigratedProfile<P> {
  if (profile.kind !== 'original') return profile;
  const { handbook: own, state, ...rest } = profile;
  // Only what the conversion can read (#609); a whole handbook is used as it is.
  const { handbook } = usableHandbook(own || fallbackHandbook);
  const conversion = handbookToPlan(handbook, recipes, pureLimits);
  return {
    ...rest,
    kind: 'calculated',
    plan: conversion.plan,
    state: migrateHandbookState(state, handbook, conversion),
  };
}
// What migrateOriginalProfile needs besides the handbook: recipes.json's recipes and the
// catalog's pureLimits (the base budgets). Each edition loads them only when there is something
// to migrate: the server from its files, the browser edition by fetching them.
export interface MigrationData {
  recipes: Recipe[];
  pureLimits: Record<string, number>;
}
// A migrated original profile: the profile's other fields, as a calculated profile with no handbook.
export type MigratedProfile<P extends StoredProfile> = Omit<P, 'handbook' | 'state'> & {
  kind: 'calculated';
  plan: StoredCalculatedPlan;
  state: ProgressState;
};
