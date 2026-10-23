// What a plan keeps lowest (#1180, `settings.objective`): the fewest buildings (absent, the
// default and every plan made before the setting), the least power, the least raw resources, or a
// weighted mix of the three. The goal sets how fast each phase delivers; the objective sets what
// the LP minimises while it does (lineCost and sourceCost in planner/model.ts). settings() in
// planner/settings.ts keeps a valid choice and refuses anything else. The caps per phase (#1221) sit
// beside it at the end: the most buildings and MW a phase may plan with.
import type {
  ObjectiveKind,
  ObjectiveWeights,
  PhaseCapKey,
  PhaseCaps,
  PlanObjective,
} from '../types/index.ts';

// The choices All settings step 3 offers, in order: [id, label, what it does]. 'buildings' is
// stored as no field, 'weighted' as the weights themselves.
export const OBJECTIVES: [id: ObjectiveKind, label: string, line: string][] = [
  [
    'buildings',
    'Fewest buildings (default)',
    'The fewest machines and generators that meet the goal; less power breaks a tie.',
  ],
  [
    'power',
    'Least power',
    'The least power for the production lines, miners and extractors; fewer buildings break a tie.',
  ],
  [
    'raw',
    'Least raw resources',
    'The least ore, oil and gas mined per minute (Water does not count: it never runs out); fewer buildings break a tie.',
  ],
  [
    'weighted',
    'Weighted mix',
    'Your own weights from 0 to 10: one building counts as much as 10 MW of power or 10 raw resources per minute, each times its weight.',
  ],
];
// The largest weight of a weighted mix; each is a whole number from 0, at least one above 0.
export const OBJECTIVE_WEIGHT_MAX = 10;
// What one building weighs against power and raw resources in the LP's cost: 10 MW, and 10 raw
// resources per minute. Measured on a default plan, a building averages about that much of each.
export const OBJECTIVE_EXCHANGE = { mw: 10, raw: 10 } as const;
// The names of the weights, in the order the wizard and the words give them.
export const OBJECTIVE_WEIGHTS = ['buildings', 'power', 'raw'] as const;

// Which choice a plan's objective is: absent is the fewest buildings.
export const objectiveKind = (objective: PlanObjective | undefined): ObjectiveKind =>
  objective === undefined ? 'buildings' : typeof objective === 'string' ? objective : 'weighted';

// The weights the LP prices a plan's objective with, or null for the fewest buildings, which
// keeps the costs every plan was calculated with before the setting.
export function objectiveWeights(objective: PlanObjective | undefined): ObjectiveWeights | null {
  if (objective === undefined) return null;
  if (objective === 'power') return { buildings: 0, power: 1, raw: 0 };
  if (objective === 'raw') return { buildings: 0, power: 0, raw: 1 };
  return objective;
}

// "buildings 2, power 1, raw 0".
const weightWords = (weights: ObjectiveWeights) =>
  OBJECTIVE_WEIGHTS.map(name => `${name} ${weights[name]}`).join(', ');

// The objective in words, as a label ("Least power", "Weighted mix (buildings 2, power 1, raw
// 0)"); `short` gives the lower-case words a profile card and a name use ("least power").
export function objectiveWords(objective: PlanObjective | undefined, short = false): string {
  const kind = objectiveKind(objective);
  const label =
    kind === 'buildings'
      ? 'Fewest buildings'
      : (OBJECTIVES.find(([id]) => id === kind)?.[1] ?? kind);
  const words = typeof objective === 'object' ? `${label} (${weightWords(objective)})` : label;
  return short ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

// The caps per phase (#1221, `settings.phaseCaps`): the most buildings and MW a phase may plan
// with, beside what it keeps lowest. Each is a whole number from 1 to its most; settings() in
// planner/settings.ts refuses anything else, and absent means no cap.
export const PHASE_CAP_LIMITS = { buildings: 100000, mw: 10000000 } as const;
// The names of the caps, in the order the wizard and the words give them.
export const PHASE_CAP_KEYS = ['buildings', 'mw'] as const;

// One cap in words: "120 buildings", "250 MW" (en-US grouping, as the planner's sentences).
export const phaseCapAmount = (name: PhaseCapKey, amount: number): string =>
  `${amount.toLocaleString('en-US')} ${name === 'mw' ? 'MW' : amount === 1 ? 'building' : 'buildings'}`;

// The caps in words: "at most 120 buildings and 250 MW per phase", or '' without one.
export function phaseCapWords(caps: PhaseCaps | undefined): string {
  const amounts = PHASE_CAP_KEYS.filter(name => caps?.[name] !== undefined).map(name =>
    phaseCapAmount(name, caps![name]!),
  );
  return amounts.length ? `at most ${amounts.join(' and ')} per phase` : '';
}
