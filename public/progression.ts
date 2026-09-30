import type {
  CalcRow,
  Progression,
  ProgressionEntry,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from './types/index.ts';

// A generated guidance step: its checklist key, title and text.
export interface GuideTask {
  id: string;
  title: string;
  body: string;
}

// What every task list of one phase's guide reads, built once by guideContext. `plan` is the
// profile's calculation snapshot, `checks` its ticked checklist keys, `data` progression.json,
// `stage` the phase planned (1-5) and `rows` that stage's production rows.
export interface GuideContext {
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>;
  checks: Record<string, boolean>;
  data: Progression;
  stage: number;
  rows: CalcRow[];
  // The plan's stage for a phase number (stage keys are its digits).
  stageOf: (phase: number) => StoredStage | undefined;
  byName: (name: string) => ProgressionEntry | undefined;
  // An unlock counts as done only when the user ticked its step, never by guessing from phase.
  unlocked: (entry: ProgressionEntry) => boolean;
  // Rows up to this phase that make an item, and whether their factory is ticked as running;
  // used to say where a milestone's cost can come from.
  sources: (item: string) => { row: CalcRow; running: boolean }[];
  // A milestone's cost, each item with where it can come from.
  funding: (entry: ProgressionEntry) => string;
}

// The power unlocks the user has ticked; the power advice follows these, not the phase's
// target generation.
interface UnlockedPower {
  coal: boolean;
  petroleum: boolean;
  nuclear: boolean;
  solid: boolean;
}

// Collectibles (hard drives, slugs, somersloops...) are gathered, not produced, so they never
// hold back when a MAM node can be researched.
const COLLECTIBLES = [
  'Hard Drive',
  'Power Shard',
  'Blue Power Slug',
  'Yellow Power Slug',
  'Purple Power Slug',
  'Mercer Sphere',
  'Somersloop',
];

// The Space Elevator phase in which a HUB tier becomes available: tiers 1-2 in Phase 1, 3-4 in
// Phase 2 and so on, with 9 in Phase 5.
const phaseForTier = (tier: number) =>
  tier <= 2 ? 1 : tier <= 4 ? 2 : tier <= 6 ? 3 : tier <= 8 ? 4 : 5;
const formatNumber = (value: unknown) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

// The generated guidance steps of a calculated profile for one phase, called by calcTasks in
// app/views/calculated.ts. `plan` is the profile's calculation snapshot, `state` its
// progress (only `checks` is read), `data` is progression.json and `phase` '1'-'5' or
// 'post' (planned as Phase 5). Returns task lists of { id, title, body }; ids are checklist
// keys, so they must stay stable. Nothing here changes the plan or the progress.
// progression.json: `entries` are HUB milestones and MAM nodes ({ id, name, tier, mam,
// alternate, cost, recipes, requires }), `buildings` maps a machine name to the recipe that
// builds it and `availability` gives the first phase in which an item can be made.
export function progression(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: { checks: Record<string, boolean> },
  data: Progression,
  phase: string,
): {
  baseTasks: GuideTask[];
  powerTasks: GuideTask[];
  milestoneTasks: GuideTask[];
  hardDrives: GuideTask[];
  retire: GuideTask[];
} {
  const context = guideContext(plan, state, data, phase);
  return {
    baseTasks: baseTasks(context),
    powerTasks: powerTasks(context),
    milestoneTasks: milestoneTasks(context, requiredMilestones(context)),
    hardDrives: hardDriveTasks(context),
    retire: retireTasks(context),
  };
}

// The context the task lists share, for `phase` '1'-'5' or 'post' (planned as Phase 5).
export function guideContext(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: { checks: Record<string, boolean> },
  data: Progression,
  phase: string,
): GuideContext {
  const stageOf = (phaseNumber: number): StoredStage | undefined =>
    plan.stages[String(phaseNumber) as StageKey];
  const stage = Number(phase === 'post' ? 5 : phase),
    checks = state.checks;
  const sources = (item: string) =>
    (Object.entries(plan.stages) as [string, StoredStage][])
      .filter(([key]) => Number(key) <= stage)
      .flatMap(([key, planned]) =>
        (planned.rows || [])
          .filter(row => row.outputs[item])
          .map(row => ({ row, running: !!checks['calc-' + key + '-' + row.id] })),
      );
  const status = (item: string) =>
    sources(item).some(source => source.running)
      ? 'already producing (marked running; reserve a batch)'
      : sources(item).length
        ? 'production planned, not yet marked running'
        : 'gather, handcraft, or build a starter supply';
  return {
    plan,
    checks,
    data,
    stage,
    rows: stageOf(stage)?.rows || [],
    stageOf,
    byName: name => data.entries.find(entry => entry.name === name),
    unlocked: entry => !!checks['unlock-' + entry.id],
    sources,
    funding: entry =>
      Object.entries(entry.cost)
        .map(([item, quantity]) => `${formatNumber(quantity)} ${item}: ${status(item)}`)
        .join('; '),
  };
}

// Milestones this phase needs: those unlocking a recipe or machine its rows use, a fixed set
// of basics, and phase-specific power and logistics unlocks, each with its prerequisites.
// In the order they were first added; milestoneTasks decides the order shown.
export function requiredMilestones(context: GuideContext): ProgressionEntry[] {
  const { plan, data, stage, rows, byName } = context;
  const required = new Map<string, ProgressionEntry>();
  function add(entry: ProgressionEntry | undefined) {
    if (!entry || required.has(entry.id)) return;
    required.set(entry.id, entry);
    for (const id of entry.requires) add(data.entries.find(prerequisite => prerequisite.id === id));
  }
  const wanted = new Set(rows.map(r => r.id));
  for (const row of rows) {
    const building = data.buildings[row.machine];
    if (building) wanted.add(building);
  }
  for (const entry of data.entries) if (entry.recipes.some(r => wanted.has(r))) add(entry);
  for (const name of [
    'Logistics',
    'Base Building',
    'Field Research',
    'Resource Sink Bonus Program',
  ])
    add(byName(name));
  if (stage === 1) {
    add(byName('HUB Upgrade 6'));
    add(byName('Obstacle Clearing'));
    add(byName('Logistics Mk.2'));
  }
  if (stage >= 2) add(byName('Coal Power'));
  if (stage >= 4 && plan.settings.droneFuel && plan.settings.droneFuel !== 'none')
    add(byName('Aeronautical Engineering'));
  if (rows.some(r => r.machine === 'Fuel Generator')) add(byName('Petroleum Power'));
  if (rows.some(r => r.machine === 'Nuclear Power Plant')) add(byName('Nuclear Power'));
  // Useful early research is reachable through Field Research; its dataset tier is not a HUB gate.
  for (const name of ['Blue Power Slugs', 'Overclock Production']) add(byName(name));
  if (rows.some(r => Object.keys(r.inputs).some(item => /Caterium|Quickwire/.test(item))))
    for (const name of ['Caterium', 'Caterium Ingots', 'Caterium Electronics']) add(byName(name));
  if (
    rows.some(row =>
      Object.keys(row.inputs).some(item => /Quartz|Silica|Crystal Oscillator/.test(item)),
    )
  )
    for (const name of ['Quartz', 'Quartz Crystals', 'Silica']) add(byName(name));
  return [...required.values()];
}

// Whether an unlock can be researched by `stage`: a HUB milestone by its tier, a MAM node by
// the latest first-available phase of its cost items, collectibles aside.
function researchable(entry: ProgressionEntry, data: Progression, stage: number): boolean {
  if (!entry.mam) return phaseForTier(entry.tier) <= stage;
  const phases = Object.keys(entry.cost)
    .filter(item => !COLLECTIBLES.includes(item))
    .map(item => data.availability[item] || 1);
  return Math.max(1, ...phases) <= stage;
}

// Depth-first, so every prerequisite in the list comes before what needs it; otherwise keeps
// the order of `milestones`.
function prerequisitesFirst(milestones: ProgressionEntry[]): ProgressionEntry[] {
  const ordered: ProgressionEntry[] = [],
    seen = new Set<string>();
  function visit(entry: ProgressionEntry) {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    for (const id of entry.requires) {
      const prerequisite = milestones.find(m => m.id === id);
      if (prerequisite) visit(prerequisite);
    }
    ordered.push(entry);
  }
  milestones.forEach(visit);
  return ordered;
}

// One unlock step per required milestone this phase can research. Alternate recipes are left
// out: they come from hard drives (hardDriveTasks). Prerequisites come before dependents;
// among otherwise independent unlocks, costs with running supply come first.
export function milestoneTasks(context: GuideContext, required: ProgressionEntry[]): GuideTask[] {
  const { data, stage, sources, funding } = context;
  const milestones = required.filter(entry => !entry.alternate && researchable(entry, data, stage));
  const readiness = (entry: ProgressionEntry) =>
    Object.keys(entry.cost).filter(item => sources(item).some(source => source.running)).length /
    Math.max(1, Object.keys(entry.cost).length);
  milestones.sort(
    (first, second) =>
      Number(first.mam) - Number(second.mam) ||
      first.tier - second.tier ||
      readiness(second) - readiness(first) ||
      first.name.localeCompare(second.name),
  );
  return prerequisitesFirst(milestones).map(
    (entry): GuideTask => ({
      id: 'unlock-' + entry.id,
      title: `${entry.mam ? 'MAM' : 'Tier ' + entry.tier}: ${entry.name}`,
      body: `${entry.mam ? 'Follow this MAM branch and complete its parent research nodes first.' : 'Unlock at the HUB before using its machines or recipes.'} ${entry.requires.length ? 'Prerequisites: ' + entry.requires.map(id => data.entries.find(prerequisite => prerequisite.id === id)?.name || id).join(', ') + '. ' : ''}Cost (base game; adjust if your milestone-cost settings differ): ${funding(entry) || 'No item cost listed'}. Production checkmarks do not confirm inventory or spare capacity.`,
    }),
  );
}

// One hard-drive step plus one unlock step per alternate recipe this phase's rows use.
export function hardDriveTasks(context: GuideContext): GuideTask[] {
  const { checks, data, stage, rows } = context;
  const alternates = rows.filter(r => r.alternate);
  if (!alternates.length) return [];
  const missing = alternates.filter(r => !checks['recipe-unlock-' + r.id]);
  return [
    {
      id: 'hard-drives-' + stage,
      title: 'Collect and scan hard drives for the selected alternates',
      body: `${missing.length} selected recipe unlocks remain unconfirmed. Complete Field Research and build the MAM. Take materials and portable power for crash sites, collect hard drives, and run 10-minute scans while building. Choices are random: this is not a guaranteed drive count. Finish each recipe’s prerequisite milestones/research first.`,
    },
    ...alternates.map(row => {
      const alternate = data.entries.find(
        entry => entry.alternate && entry.recipes.includes(row.id),
      );
      return {
        id: 'recipe-unlock-' + row.id,
        title: 'Unlock ' + row.name,
        body: `Required by this profile’s ${row.machine} line. ${alternate?.requires.length ? 'First unlock: ' + alternate.requires.map(id => data.entries.find(entry => entry.id === id)?.name || id).join(', ') + '. ' : ''}Choose it when offered by hard-drive research. Confirm here only after unlocking it in game; selecting “all alternates” in the profile is a planning allowance, not an in-game unlock.`,
      };
    }),
  ];
}

// The power, fuel and endgame steps of the phase. calcTasks interleaves Phase 1's lists by
// position, so the order of the first steps (power review, biomass, Solid Biofuel, burner bank)
// matters.
export function powerTasks(context: GuideContext): GuideTask[] {
  const power = unlockedPower(context);
  return [
    powerReviewTask(context.stage, power),
    ...biomassStartupTasks(context, power),
    ...generationTasks(context, power),
    ...endgameTasks(context),
    ...sloopTasks(context),
    ...droneFuelTasks(context),
  ];
}

function unlockedPower({ byName, unlocked }: GuideContext): UnlockedPower {
  const known = (name: string) => {
    const entry = byName(name);
    return !!entry && unlocked(entry);
  };
  return {
    coal: known('Coal Power'),
    petroleum: known('Petroleum Power'),
    nuclear: known('Nuclear Power'),
    solid: known('Obstacle Clearing'),
  };
}

function powerReviewTask(
  stage: number,
  { coal, petroleum, nuclear, solid }: UnlockedPower,
): GuideTask {
  const powerNow =
    nuclear && stage >= 4
      ? 'Nuclear power is marked unlocked. Commission all waste processing before loading fuel rods.'
      : petroleum && stage >= 3
        ? 'Fuel generators are marked unlocked. Use only the fuel recipes you have researched and connect their byproduct handling.'
        : coal && stage >= 2
          ? 'Coal Power is marked unlocked. Build coal extraction, water and generators, then verify sustained output.'
          : solid
            ? 'Use belt-fed Biomass Burners with Solid Biofuel; keep gathering leaves and wood.'
            : 'Use HUB/built Biomass Burners with gathered fuel or Biomass. Unlock Obstacle Clearing for Solid Biofuel.';
  return {
    id: 'startup-' + stage + '-power-review',
    title: 'Power available now',
    body:
      powerNow +
      ' Full-phase generation shown in the calculator is a future target, not power already unlocked. Tick the relevant HUB/MAM unlocks to update this advice.',
  };
}

// Biomass start-up guidance: Phase 1, or any phase with no power unlock ticked yet.
function biomassStartupTasks(
  { plan, stage, stageOf }: GuideContext,
  { coal, petroleum, nuclear }: UnlockedPower,
): GuideTask[] {
  if (!(stage === 1 || (!coal && !petroleum && !nuclear))) return [];
  const need = Math.max(
      0,
      (stageOf(stage)?.requiredMW || 0) - plan.settings.availablePowerGW * 1000,
    ),
    factor = plan.settings.powerFactor ?? 1;
  // Three starter constructors have their own draw; this is a manually supplied startup estimate.
  const burners = Math.ceil((need + 12 * factor) / 30);
  return [
    {
      id: 'startup-biomass',
      title: 'Turn leaves and wood into Biomass',
      body: 'After HUB Upgrade 6, feed two separate containers into two Constructors: Leaves uses 120 Leaves/min → 60 Biomass/min; Wood uses 60 Wood/min → 300 Biomass/min at 100%. Merge outputs into a buffer. Gathering remains manual; start smaller or underclock until fuel and power are stable.',
    },
    {
      id: 'startup-solid-biofuel',
      title: 'Unlock Obstacle Clearing, then automate Solid Biofuel',
      body: 'Tier 2 Obstacle Clearing unlocks the Chainsaw and Solid Biofuel. One Constructor consumes 120 Biomass/min → 60 Solid Biofuel/min at 100%. Start with one, fed by the Biomass buffer; retain fuel for the chainsaw. With a Mk.1 input belt, limit it to 60 Biomass/min → 30 Solid Biofuel/min; unlock Logistics Mk.2 for a 120/min input and the full 60/min output. A full 360 Biomass/min from both source Constructors can supply three Solid Biofuel Constructors, making 180/min. Split the merge across belts as needed: Mk.1 carries 60/min and Mk.2 120/min, so do not try to put 360/min on one early belt.',
    },
    {
      id: 'startup-burner-bank-' + stage,
      title: 'Size and feed the biomass burner bank',
      body: `Standalone Biomass Burners provide 30 MW each; HUB burners provide 20 MW each. Ignoring any HUB capacity not entered as spare power, allow about ${formatNumber(burners)} standalone burners for ${formatNumber(need)} MW of planned additional load plus three fuel-processing Constructors. At full load each standalone burner consumes 4 Solid Biofuel/min; this bank needs up to ${formatNumber(burners * 4)}/min. One 60/min Solid Biofuel Constructor can fuel 15 such burners; a Mk.1-fed 30/min line supports 7.5 burners at full load. This is a startup estimate, not part of the continuous resource model: add processing capacity/power if needed, keep a reserve, and build gradually until coal is unlocked.`,
    },
  ];
}

// Moving to the generators the plan builds: coal, fuel, the preferred main power, aluminum
// water recycling and nuclear.
function generationTasks(context: GuideContext, { coal }: UnlockedPower): GuideTask[] {
  const { stage, rows } = context;
  const tasks: GuideTask[] = [];
  if (stage >= 2 && !coal)
    tasks.push({
      id: 'startup-coal-unlock',
      title: 'Unlock Coal Power before switching to coal',
      body: 'After Phase 1, prioritize Tier 3 Coal Power. Use existing reinforced-plate, rotor and cable production to fund it; see the HUB cost checklist. Keep biomass online while priming water and starting the coal supply. Only retire burners after stable generation is proven.',
    });
  if (stage >= 3 && rows.some(r => r.machine === 'Fuel Generator'))
    tasks.push({
      id: 'startup-fuel-' + stage,
      title: 'Unlock and commission the planned fuel power',
      body:
        'Complete Oil Processing and Petroleum Power first. For turbofuel, complete its Sulfur MAM research; ' +
        (stage >= 4
          ? 'Rocket fuel additionally needs its own MAM node, nitrogen supply and Blender access. '
          : '') +
        ' Confirm any fuel alternates in the hard-drive checklist. Start with an unlocked fuel recipe and upgrade only after the full new chain is ready.',
    });
  tasks.push(...preferredPowerTasks(context));
  if (stage >= 4 && rows.some(r => r.inputs['Alumina Solution'] || r.outputs['Alumina Solution']))
    tasks.push({
      id: 'startup-aluminum-' + stage,
      title: 'Commission aluminum water recycling',
      body: 'Unlock Bauxite Refinement before commissioning the aluminum chain. Seed the system, prioritize returned water and handle silica/byproducts so the line cannot block.',
    });
  if (stage >= 4 && rows.some(r => r.machine === 'Nuclear Power Plant'))
    tasks.push({
      id: 'startup-nuclear-' + stage,
      title: 'Unlock nuclear and finish downstream waste processing first',
      body:
        stage === 4
          ? 'Complete Nuclear Power and the needed enrichment unlocks. Build uranium-waste processing and sink the resulting plutonium rods before starting reactors. Ficsonium recycling is a Phase 5 upgrade.'
          : 'Complete the required Tier 9 conversion/quantum unlocks. Commission the full uranium → plutonium → Ficsonium waste chain before burning plutonium. Match underclocks and verify power for recycling during startup.',
    });
  return tasks;
}

// From Phase 3, when the profile chose a main power source: expand it before the next block.
function preferredPowerTasks({ plan, stage }: GuideContext): GuideTask[] {
  const preferred = plan.settings.mainPower;
  if (!(stage >= 3 && preferred && preferred !== 'auto')) return [];
  const rocket = preferred.startsWith('rocket'),
    source =
      preferred === 'coal'
        ? 'coal'
        : preferred === 'nuclear' && stage >= 4
          ? 'nuclear'
          : rocket && stage >= 4
            ? 'rocket fuel'
            : preferred === 'fuel'
              ? 'fuel'
              : 'turbofuel';
  return [
    {
      id: 'preferred-power-' + stage,
      title: 'Expand ' + source + ' power before the next production block',
      body:
        (source === 'coal'
          ? 'Keep expanding coal extraction, water and generators after Coal Power is unlocked. '
          : source === 'nuclear'
            ? 'Complete Nuclear Power and commission fuel supply plus all waste processing before starting reactors. '
            : rocket && stage >= 4
              ? 'Upgrade the turbofuel bridge after unlocking Blender access, nitrogen and Rocket Fuel in the Sulfur MAM tree. Build and prime the new chain before switching generators. '
              : preferred === 'fuel'
                ? 'Use Fuel after Oil Processing and Petroleum Power. '
                : 'Use coal until Oil Processing, Petroleum Power and Sulfur MAM Turbofuel research are complete. Commission compacted coal and all byproduct handling. ') +
        (preferred.endsWith('-nuclear') && stage >= 4
          ? 'Add the planned nuclear fleet only after its entire waste-processing chain is ready. '
          : '') +
        'Build the generator quantities listed in this phase, check the actual maximum consumption with the utility allowance, and commission more capacity before connecting the next factory. Keep the previous plant online until the replacement is stable.',
    },
  ];
}

// Phase 5: the portals' Singularity Cell supply and the Alien Power Augmenters.
function endgameTasks({ plan, stage }: GuideContext): GuideTask[] {
  if (stage !== 5) return [];
  const tasks: GuideTask[] = [];
  const cells = plan.settings.cellsPerMinute;
  if (cells > 0)
    tasks.push({
      id: 'portal-supply',
      title: 'Protect the continuous Singularity Cell supply for portals',
      body: `Unlock Tier 9 Spatial Energy Regulation. Each Main Portal consumes 2 Singularity Cells/min while maintaining its connection; the Satellite Portal needs no cells. Your dedicated ${formatNumber(cells)}/min contract supports ${Math.floor(cells / 2)} continuously connected Main Portals. The standard manufacturing recipe produces 10/min, enough for five connections. Feed portals before storage or the sink, add a buffer, and reserve their operating and startup electrical demand separately from the production calculation.`,
    });
  // Plans frozen before the augmenter settings existed have none.
  const count = plan.settings.augmenters ?? 0;
  if (count > 0) {
    const fueled = plan.settings.fueledAugmenters || 0;
    tasks.push({
      id: 'alien-power-augmenter',
      title: `Build ${count} Alien Power Augmenter${count > 1 ? 's' : ''}`,
      body: `Research Alien Power Augmentation in the MAM (Alien Technology), then build ${count} Augmenter${count > 1 ? 's' : ''} at ${formatNumber(10)} Somersloops each — ${formatNumber(10 * count)} in total, and they are not recoverable. Each one generates 500 MW by itself and raises the whole connected grid's base production, so keep ${count > 1 ? 'them' : 'it'} on the main grid rather than an island. ${fueled ? `Feed ${fueled} of them ${formatNumber(5 * fueled)} Alien Power Matrix/min in total (5/min each) to take ${fueled > 1 ? 'those' : 'that one'} from a 10% to a 30% boost; the fuel line is in this phase's factory plan. An augmenter that runs dry falls back to 10%.` : 'Left unfueled each gives 10%. Feeding one 5 Alien Power Matrix/min raises it to 30%, which is worth doing only once your base production is large enough to repay the fuel line.'}`,
    });
  }
  return tasks;
}

// The somersloops reserved for hand-fed constructors, shown only in the profile's starting phase.
function sloopTasks({ plan, stage }: GuideContext): GuideTask[] {
  const reserved = plan.settings.sloopReserved || [];
  if (!(stage === Number(plan.settings.phase || 1) && reserved.length)) return [];
  const labels: Record<string, string> = {
    shards:
      'a Constructor making Power Shards from power slugs — the world holds a fixed number of slugs, so an amplified Constructor is the difference between 2,650 and 5,301 shards for the whole save',
    dna: 'a Constructor chain turning creature remains into Alien Protein and then Alien DNA Capsules, doubling what finite remains are worth',
    biofuel:
      'a Constructor making Solid Biofuel from biomass, doubling what each trip of gathered leaves and wood is worth',
  };
  const picked = reserved.map(id => labels[id]).filter(Boolean);
  return [
    {
      id: 'sloop-hand-fed',
      title: 'Park somersloops in the hand-fed constructors',
      body: `Reserve ${formatNumber(picked.length)} Somersloop${picked.length > 1 ? 's' : ''} for ${picked.join('; ')}. Insert the Somersloop in the Constructor, not the Crafting Bench: hand-crafting cannot be amplified, so anything you craft by hand is worth half. These lines are fed by hand and are deliberately left out of the continuous production balance — they reserve a somersloop and nothing else.`,
    },
  ];
}

// From Phase 4, when the profile runs drones: their protected fuel supply.
function droneFuelTasks({ plan, stage, stageOf }: GuideContext): GuideTask[] {
  if (!(stage >= 4 && plan.settings.droneFuel && plan.settings.droneFuel !== 'none')) return [];
  const fuel = Object.entries(stageOf(stage)?.drone || {})
    .map(([item, quantity]) => formatNumber(quantity) + ' ' + item + '/min')
    .join(', ');
  return [
    {
      id: 'drone-fuel-' + stage,
      title: 'Unlock Aeronautical Engineering and commission drone fuel',
      body: `Complete Tier 8 Aeronautical Engineering (see milestone materials), then build and buffer the dedicated ${fuel} supply before launching routes. ${stage === 4 && plan.settings.droneFuel === 'Packaged Ionized Fuel' ? 'Use batteries now; upgrade to packaged ionized fuel after its Phase 5 unlocks. ' : ''}Route this protected supply to a fuel depot before general storage or sinking. Packaging inputs are included in the factory plan. Measure total fleet consumption at the ports, including fuel-delivery flights, and increase the supply target if necessary. Drone-port electricity shares the ${plan.settings.utilityPercent ?? 20}% utilities allowance with trains, miners and pumps; fuel production power is already calculated. Fuel rods belong at the dedicated fuel depot, outside general storage.`,
    },
  ];
}

// Phase 1 only: the starter base, which calcTasks spreads around the power and milestone
// steps.
export function baseTasks({ stage }: GuideContext): GuideTask[] {
  if (stage !== 1) return [];
  return [
    {
      id: 'early-base-hub',
      title: 'Finish the HUB tutorial and establish a small powered base',
      body: 'Gather enough iron, copper, limestone, leaves and wood to finish HUB Upgrades 1–6. Use Portable Miners and handcraft the first building materials. Start the HUB burners and one small smelting line before connecting more machines. Leave space for a construction-stock area, separate fuel inputs and later expansion.',
    },
    {
      id: 'early-base-iron',
      title: 'Secure iron plates and rods for construction',
      body: 'Build a Miner and Smelters, then separate plate and rod Constructors with their own storage containers. A useful starter target is 20 Iron Plates/min plus 15 Iron Rods/min: 45 Iron Ingots/min from 45 ore/min using the standard recipes. Use two Smelters (one at 100%, one at 50%) and one Constructor for each part. Before clock control is researched, use full-clock capacity with limited inputs; output will be intermittent. Keep these supplies available for machines, belts and power poles.',
    },
    {
      id: 'early-base-concrete',
      title: 'Keep concrete available for foundations',
      body: 'Start with one Concrete Constructor: 45 Limestone/min → 15 Concrete/min. Expand to two for 90 Limestone/min → 30 Concrete/min when extraction and power permit. Give concrete its own container beside the building-material supplies. Check node/miner throughput before adding the second Constructor.',
    },
    {
      id: 'early-base-copper',
      title: 'Build separate wire and cable reserves',
      body: 'Using standard recipes, one Copper Smelter supplies 30 ingots/min to two Wire Constructors, producing 60 Wire/min. Reserve 30 Wire/min for building and feed the other 30 into one Cable Constructor at 50%, producing 15 Cable/min. Before clock control, limit its input instead. Store wire and cable separately; do not consume the whole wire output in cable production.',
    },
    {
      id: 'early-base-logistics',
      title: 'Organize a construction-stock area and simple production lanes',
      body: 'Prioritize Tier 1 Logistics for splitters and mergers, then Base Building for foundations. Put labelled containers for plates, rods, concrete, wire and cable near the HUB. Keep fuel and construction supplies separate from elevator feeds. Reserve walking space and straight belt routes; Mk.1 belts carry 60/min. This is a practical starter base, not the final storage hall.',
    },
    {
      id: 'early-base-components',
      title: 'Add screws, reinforced plates and rotors as unlock supplies',
      body: 'Feed a dedicated screw line from rods: 10 Rods/min → 40 Screws/min per Constructor. Use these and plate stock for starter reinforced plates; after Part Assembly, automate reinforced plates and rotors in Assemblers. Check the selected recipe before sizing supply. Reserve batches for miners, Assemblers, Mk.2 belts and the next milestones before sending surplus to Smart Plating.',
    },
    {
      id: 'early-base-reserves',
      title: 'Protect building stock before scaling elevator production',
      body: 'Keep at least one clearly labelled container per construction material, then add a separate elevator branch. If stock falls, pause or reduce elevator feed and refill it. Early splitters do not provide priority by themselves: use separate production or controlled feeds until Smart Splitters are unlocked in the Caterium MAM tree. These starter rates and milestone batches are guidance, not extra outputs included in the profile’s steady-state resource budget.',
    },
  ];
}

// Lines an earlier phase built that this phase's plan drops. Its resource and power budgets do
// not include them, and a replacement is usually a different machine rather than an upgrade in
// place, so say what becomes of them. Only what the previous phase ran: each line is retired
// once, in the phase straight after the last one that needed it.
export function retireTasks({ plan, stage, stageOf }: GuideContext): GuideTask[] {
  const start = Number(plan.settings.phase || 1),
    previous = stage - 1,
    retired = new Map<string, { name: string; machine: string; machines: number }>();
  if (previous >= start)
    for (const row of stageOf(previous)?.rows || [])
      retired.set(row.id, { name: row.name, machine: row.machine, machines: row.machines });
  for (let later = stage; later <= 5; later++)
    for (const row of stageOf(later)?.rows || []) retired.delete(row.id);
  const all = [...retired.values()].sort((a, b) => b.machines - a.machines),
    listed = all.slice(0, 10),
    rest = all.length - listed.length;
  if (!listed.length) return [];
  return [
    {
      id: 'retire-' + stage,
      title: 'Retire the lines this phase no longer uses',
      body: `Phase ${stage} does not run ${listed.map(line => `${formatNumber(line.machines)} × ${line.name} (${line.machine})`).join('; ')}${rest ? ` and ${rest} more line${rest > 1 ? 's' : ''}` : ''}, all last needed in Phase ${previous}. Its resource and power budgets do not include them. Commission and prove the replacement chain first: a replacement is usually a different machine, so expect to dismantle or repurpose rather than upgrade in place. Leaving them running is not harmful where ore and power are spare — the output reaches storage and then the sink — but it is production this phase does not count.`,
    },
  ];
}
