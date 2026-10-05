// One power model for a calculated plan (#1064): what a phase needs, and the whole generators,
// augmenters and spare power that give it.
//
// The planner sizes it once per phase (stageGrid, from readStage in planner/stage.ts), carries an
// earlier phase's generators forward (carryGenerators, from calculate()), and stores it on the
// stage as `grid`. Every page reads a stage's power through powerView: the Resources page's bar,
// the headroom notice over the plan, the build plan's summary and "Power available now" step,
// the wizard's Review and estimate, the build status and ADA. A plan made before #1064 has no
// `grid`; powerView then reads the figures it was stored with (requiredMW, availableMW,
// additionalHeadroomMW), exactly as the pages read them before, so a stored plan keeps its numbers
// until the user recalculates.
//
// The model:
// - Need: each production line at its clocked power (every machine at 100% but the last, which
//   draws clock^1.321929 of its power), times the consumption multiplier; a Particle
//   Accelerator, Converter or Quantum Encoder at its peak (its average is shown beside it); plus
//   the utility allowance on those lines; plus the miners and extractors for the raw resources
//   the phase draws (extractionMWPerUnit in preferences/extraction.ts).
// - Have: whole generators at 100% (each generator line's machines, which burn fuel only for the
//   power drawn), with Phase 5's augmenter boost; what the augmenters add; the entered spare
//   existing power. A generator building the phase before ran and this phase still fuels is kept:
//   the phase runs at least as many of it.
// The planner's power constraint charges every line at its full linear power (never less than
// its clocked power) and the extraction at the same rate, so a plan that fits needs no more than
// its whole generators give.
import { DEFAULT_EXTRACTION, extractionMWPerUnit } from './preferences.ts';
import { listNames, powerAmount } from './wording.ts';
import type {
  CalcRow,
  GridGenerator,
  ItemRates,
  StageGrid,
  StoredSettings,
  StoredStage,
} from './types/index.ts';

// The clock power exponent every building shares in the game data (powerConsumptionExponent),
// as WATER_EXTRACTOR.exponent in preferences/extraction.ts has it (a test keeps them equal). A
// literal, because the VM interface tests load this module without the shared preferences.
export const CLOCK_EXPONENT = 1.321929;
// The machines whose draw follows the recipe over its cycle (#935), from minPower to power.
export const VARIABLE_POWER = ['Particle Accelerator', 'Converter', 'Quantum Encoder'];
// Below this a shortfall or a remainder is rounding dust, in MW.
const POWER_DUST = 0.01;

type LoadRow = Pick<CalcRow, 'power' | 'machine' | 'machines' | 'lastClock'> & {
  minPower?: number;
};

// A production line's draw in MW at 100% consumption: every machine at full power but the last,
// which runs at `lastClock` and draws clock^1.321929 of it. `peak` takes a variable-power
// machine at the top of its range, `average` at the middle; any other machine's are the same.
// A generator draws nothing.
export function lineLoad(row: LoadRow): { peak: number; average: number } {
  if (!(row.power > 0) || !(row.machines > 0)) return { peak: 0, average: 0 };
  const last = Math.min(1, Math.max(0, (row.lastClock ?? 100) / 100));
  const running = row.machines - 1 + last ** CLOCK_EXPONENT;
  const peak = row.power * running;
  if (!VARIABLE_POWER.includes(row.machine)) return { peak, average: peak };
  return { peak, average: (((row.minPower ?? row.power) + row.power) / 2) * running };
}

// The equipment extraction is costed at: the profile's node survey, else Miner Mk.3 at 250%.
export const extractionEquipment = (settings: Pick<StoredSettings, 'extraction'>) => ({
  mark: settings.extraction?.mark ?? DEFAULT_EXTRACTION.mark,
  clock: settings.extraction?.clock ?? DEFAULT_EXTRACTION.clock,
});

// What sizes a stage's grid: its rows and raw draw, the profile's consumption multiplier,
// utility allowance and extraction equipment, Phase 5's augmenter boost, the entered spare power
// and what the augmenters add to it (phasePower in planner/model.ts).
export interface GridInput {
  rows: CalcRow[];
  raw: ItemRates;
  powerFactor: number;
  utilityPercent: number;
  extractionAt: { mark: number; clock: number };
  // The MW of each raw resource's miners and extractors, when the plan works them out itself
  // (mining per phase, #1065: the nodes the draw taps); else the draw at extractionAt's
  // equipment on normal nodes.
  extractionMW?: ItemRates;
  boost: number;
  spareMW: number;
  augmenterMW: number;
}

// The phase's power, sized by the plan (see the header). The one place that does it.
export function stageGrid(input: GridInput): StageGrid {
  const { rows, raw, powerFactor, utilityPercent, extractionAt } = input;
  let loadMW = 0,
    variablePeakMW = 0,
    variableAverageMW = 0;
  for (const row of rows) {
    const { peak, average } = lineLoad(row);
    loadMW += peak * powerFactor;
    if (VARIABLE_POWER.includes(row.machine)) {
      variablePeakMW += peak * powerFactor;
      variableAverageMW += average * powerFactor;
    }
  }
  const extraction: ItemRates = {};
  for (const [resource, rate] of Object.entries(raw))
    if (rate > 1e-6)
      extraction[resource] =
        (input.extractionMW
          ? (input.extractionMW[resource] ?? 0)
          : rate * extractionMWPerUnit(resource, extractionAt)) * powerFactor;
  const extractionMW = Object.values(extraction).reduce((sum, mw) => sum + mw, 0);
  const allowanceMW = (loadMW * utilityPercent) / 100;
  return withSupply(
    {
      loadMW,
      variablePeakMW,
      variableAverageMW,
      extraction,
      extractionMW,
      extractionAt: { ...extractionAt },
      allowanceMW,
      needMW: loadMW + allowanceMW + extractionMW,
      generators: ownGenerators(rows),
      generationMW: 0,
      augmenterMW: input.augmenterMW,
      spareMW: input.spareMW,
      availableMW: 0,
    },
    input.boost,
  );
}

// Whole generators per building, from the generator lines: each line's machines (whole, at
// 100%), in the order the lines come.
function ownGenerators(rows: CalcRow[]): GridGenerator[] {
  const byMachine = new Map<string, GridGenerator>();
  for (const row of rows) {
    if (!(row.power < 0)) continue;
    const entry = byMachine.get(row.machine) ?? {
      machine: row.machine,
      machines: 0,
      own: 0,
      kept: 0,
      unitMW: -row.power,
    };
    entry.own += row.machines;
    entry.machines = entry.own;
    byMachine.set(row.machine, entry);
  }
  return [...byMachine.values()];
}

// The grid's generation and available power from its generators and Phase 5's boost.
function withSupply(grid: StageGrid, boost: number): StageGrid {
  const generationMW =
    grid.generators.reduce((sum, generator) => sum + generator.machines * generator.unitMW, 0) *
    (1 + boost);
  return {
    ...grid,
    generationMW,
    availableMW: generationMW + grid.augmenterMW + grid.spareMW,
  };
}

// Carries each phase's generators into the next (#1064): from the phase after `start` (the
// profile's start phase; earlier phases are milestone-only) to Phase 5, a generator building the
// phase before ran and this phase still fuels (it has a generator line of its own in that
// building) keeps every one of them, so the phase runs at least as many and counts their
// capacity. A building the phase no longer fuels is retired as before. Only feasible phases with
// a grid take part. Changes the stages in place.
type CarryStage = { feasible: boolean; grid?: StageGrid; boost?: number };
export function carryGenerators(stages: Record<number, CarryStage | undefined>, start: number) {
  for (let phase = start + 1; phase <= 5; phase++) {
    const before = stages[phase - 1],
      stage = stages[phase];
    if (!before?.feasible || !before.grid || !stage?.feasible || !stage.grid) continue;
    const earlier = new Map(before.grid.generators.map(entry => [entry.machine, entry.machines]));
    const generators = stage.grid.generators.map(entry => {
      const kept = earlier.get(entry.machine) ?? 0;
      return { ...entry, kept, machines: Math.max(entry.own, kept) };
    });
    stage.grid = withSupply({ ...stage.grid, generators }, stage.boost ?? 0);
  }
}

// --- Reading a stage's power ---

// One part of the Resources page's bar: what it is, its MW and a caption.
export interface PowerPart {
  key: string;
  label: string;
  mw: number;
  caption: string;
}
// A stage's power as the pages show it. `modelled` is true for a plan with a grid (#1064).
// needMW and availableMW are what the phase needs and has; shortMW what is missing (0 when
// covered) and leftMW what is left over (negative when short). generationMW is the new
// generation with Phase 5's boost, augmenterMW what the augmenters add on top of the spare power
// and the new generation's boost, spareMW the entered spare power: the three add up to
// availableMW. `demand` and `supply` are the bar's parts, in order.
export interface PowerView {
  modelled: boolean;
  needMW: number;
  availableMW: number;
  shortMW: number;
  leftMW: number;
  generationMW: number;
  augmenterMW: number;
  spareMW: number;
  demand: PowerPart[];
  supply: PowerPart[];
  generators: GridGenerator[];
  // The variable-power machines' peak and average, when the phase has any.
  variable: { peakMW: number; averageMW: number; machines: string[] } | null;
}

type ViewSettings = Pick<StoredSettings, 'availablePowerGW'> &
  Partial<Pick<StoredSettings, 'utilityPercent'>>;

// The stage's power, from its grid, or as a plan made before #1064 stored it.
export function powerView(stage: StoredStage, settings: ViewSettings): PowerView {
  return stage.grid ? modelledView(stage, stage.grid, settings) : storedView(stage, settings);
}

// Whether a figure is above rounding dust.
const aboveDust = (mw: number) => mw > POWER_DUST;
// A number as the pages show one (num in app/format.ts).
const figure = (value: number | undefined) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

// A plan with a grid: the parts the plan sized.
function modelledView(stage: StoredStage, grid: StageGrid, settings: ViewSettings): PowerView {
  const left = grid.availableMW - grid.needMW;
  const machines = [
    ...new Set(
      (stage.rows || [])
        .filter(row => VARIABLE_POWER.includes(row.machine) && row.power > 0)
        .map(row => row.machine),
    ),
  ];
  const sloops = stage.sloopsUsed ?? 0;
  const variable = aboveDust(grid.variablePeakMW)
    ? { peakMW: grid.variablePeakMW, averageMW: grid.variableAverageMW, machines }
    : null;
  const percent = settings.utilityPercent ?? 20;
  return {
    modelled: true,
    needMW: grid.needMW,
    availableMW: grid.availableMW,
    shortMW: aboveDust(-left) ? -left : 0,
    leftMW: left,
    generationMW: grid.generationMW,
    augmenterMW: grid.augmenterMW,
    spareMW: grid.spareMW,
    demand: [
      {
        key: 'load',
        label: 'Production lines',
        mw: grid.loadMW,
        caption:
          'Each machine at its clock, at the selected consumption multiplier' +
          (variable
            ? ` · ${listNames(variable.machines.map(name => name + 's'))} at their ${powerAmount(variable.peakMW)} peak (${powerAmount(variable.averageMW)} on average)`
            : '') +
          (sloops > 0
            ? ` · ${figure(sloops)} somersloop${sloops > 1 ? 's' : ''} in production: amplified machines give double output at four times the power`
            : ''),
      },
      {
        key: 'utility',
        label: 'Utility allowance',
        mw: grid.allowanceMW,
        caption: `${percent}% of the production lines for transport and utilities; verify actual load`,
      },
      {
        key: 'extraction',
        label: 'Miners and extractors',
        mw: grid.extractionMW,
        // With mining per phase (#1065), the phase's miner on the nodes its draw taps.
        caption: stage.mining
          ? `Miner Mk.${grid.extractionAt.mark} at ${Math.round(grid.extractionAt.clock * 100)}% on the nodes this phase taps, best first, the last one slower; oil, water and resource-well extractors at the same clock`
          : `Miner Mk.${grid.extractionAt.mark} at ${Math.round(grid.extractionAt.clock * 100)}% on normal nodes; oil, water and resource-well extractors at the same clock`,
      },
    ],
    supply: [
      {
        key: 'generation',
        label: 'Generators',
        mw: grid.generationMW,
        caption: generatorCaption(grid),
      },
      ...((stage.augmenters ?? 0) > 0
        ? [
            {
              key: 'boost',
              label: 'Augmenter boost',
              mw: grid.augmenterMW,
              caption: augmenterCaption(stage),
            },
          ]
        : []),
      {
        key: 'spare',
        label: 'Existing spare power',
        mw: grid.spareMW,
        caption: 'Not total installed generation',
      },
    ],
    generators: grid.generators,
    variable,
  };
}

// "12 Fuel Generators and 3 Coal Generators, whole, at 100% · 5 Fuel Generators kept from the
// phase before"; "No generators" when the phase builds none.
function generatorCaption(grid: StageGrid): string {
  if (!grid.generators.length) return 'No generators';
  const named = (count: number, machine: string) =>
    `${figure(count)} ${machine}${count === 1 ? '' : 's'}`;
  const kept = grid.generators.filter(entry => entry.kept > 0);
  return (
    listNames(grid.generators.map(entry => named(entry.machines, entry.machine))) +
    ', whole, at 100%' +
    (kept.length
      ? ` · ${listNames(kept.map(entry => named(entry.kept, entry.machine)))} kept from the phase before`
      : '')
  );
}

// "4 augmenters · 2,000 MW plus 30% of base production", as the bar always captioned it.
const augmenterCaption = (stage: StoredStage) => {
  const augmenters = stage.augmenters ?? 0;
  return `${figure(augmenters)} augmenter${augmenters > 1 ? 's' : ''} · ${figure(stage.augmenterMW)} MW plus ${Math.round((stage.boost || 0) * 100)}% of base production`;
};

// A plan made before #1064: its own figures, read as the pages read them then. The need is the
// stage's requiredMW (whole machines at full power plus the allowance), what it has its new
// generation (with the boost), what the augmenters add and the entered spare power; the bar
// splits it as it did (the augmenter part also holding the boost on new generation). What is
// missing is the need less what it has, which is the stage's additionalHeadroomMW, as the planner
// computed it then.
function storedView(stage: StoredStage, settings: ViewSettings): PowerView {
  const peak = stage.peakMW || 0,
    need = Math.max(peak, stage.requiredMW ?? peak),
    generation = stage.generationMW || 0,
    boosted = generation * (1 + (stage.boost || 0)),
    spare = (settings.availablePowerGW || 0) * 1000,
    augmenters = stage.augmenters ?? 0,
    // The bar's augmenter part: everything availableMW holds beyond the new generation and the
    // spare power, so it also holds the boost on new generation.
    barBoost = augmenters > 0 ? Math.max(0, (stage.availableMW ?? 0) - generation - spare) : 0,
    available = generation + barBoost + spare;
  const short = Math.max(0, need - available);
  const sloops = stage.sloopsUsed ?? 0;
  return {
    modelled: false,
    needMW: need,
    availableMW: available,
    shortMW: aboveDust(short) ? short : 0,
    leftMW: available - need,
    generationMW: boosted,
    augmenterMW: augmenters > 0 ? Math.max(0, available - boosted - spare) : 0,
    spareMW: spare,
    demand: [
      {
        key: 'peak',
        label: 'Whole-machine peak',
        mw: peak,
        caption:
          'At selected consumption multiplier' +
          (sloops > 0
            ? ` · ${figure(sloops)} somersloop${sloops > 1 ? 's' : ''} in production: amplified machines give double output at four times the power`
            : ''),
      },
      {
        key: 'utility',
        label: 'Utility allowance',
        mw: need - peak,
        caption:
          (settings.utilityPercent ?? 20) + '% for transport and utilities; verify actual load',
      },
    ],
    supply: [
      {
        key: 'generation',
        label: 'New generation',
        mw: generation,
        caption: 'Fuel and recycling included',
      },
      ...(augmenters > 0
        ? [
            {
              key: 'boost',
              label: 'Augmenter boost',
              mw: barBoost,
              caption: augmenterCaption(stage),
            },
          ]
        : []),
      {
        key: 'spare',
        label: 'Existing spare power',
        mw: spare,
        caption: 'Not total installed generation',
      },
    ],
    generators: [],
    variable: null,
  };
}
