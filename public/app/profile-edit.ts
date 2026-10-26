// Profile names and Edit settings (#1071). A profile the wizard creates without a typed name is
// named after what it is: its goal, what differs from the settings it started from (the profile
// it carries from, or a new save's defaults) and the day, "Minimal construction · whole machines
// · Oct 7" (defaultProfileName), so several profiles of one save no longer share the goal's
// name. Only new profiles are named this way; a stored name is never changed, but a profile still
// named after its goal alone is offered such a name on its card (renameOffers). Edit settings
// recalculates a profile in place and keeps its previous version as a profile named
// "<name> (before edit, Oct 7, 2:05 PM)" (backupName), which "Restore this version" can swap back
// (app/restore-version.ts). Review lists what the edit changes
// (settingsChanges, phaseChanges), both read from the plans and nothing stored.
import {
  distributions,
  driveCapWords,
  objectiveWords,
  phaseCapWords,
  purities,
  recipeCostOf,
} from '../preferences.ts';
import { ALLOWANCE_SETTING, powerView } from '../power.ts';
import { num, plural } from './format.ts';
import { listNames } from '../wording.ts';
import { leftOutNote, leftOutWords } from '../mining.ts';
import type { MiningSettings } from '../preferences/mining.ts';
import type { NodeExclusions, SloopPins } from '../types/index.ts';
import { power } from './wizard/fields.ts';
import type {
  Choice,
  PhaseCaps,
  PlanObjective,
  StoredCalculatedPlan,
  StoredStage,
} from '../types/index.ts';

// The settings a name compares, as the planner reads them; any other field is left out.
type NameSettings = Record<string, unknown> & { goal?: string };

// A profile name may have at most 80 characters (save-routes.ts, browser-api.ts).
const NAME_LIMIT = 80;

// What a new save's first plan starts with (freshSettings in wizard/wizard.ts), for the fields a
// name mentions: a first profile is named after what it changed from these.
const FRESH: NameSettings = {
  phase: '1',
  purity: 'vanilla',
  multiplier: 1,
  powerFactor: 1,
  recipeCost: 1,
  recipes: 'standard',
  wholeMachines: true,
};

const labelOf = (choices: Choice[], id: unknown) =>
  choices.find(([value]) => value === id)?.[1] ?? String(id);

const RECIPES: Record<string, string> = {
  standard: 'standard recipes',
  all: 'all alternates',
  custom: 'picked alternates',
};

// The short words a name gives a changed field, in the order a name lists them.
const NAME_PARTS: [key: string, words: (value: unknown) => string][] = [
  ['wholeMachines', value => (value === false ? 'exact ratios' : 'whole machines')],
  ['phase', value => `from Phase ${value}`],
  ['recipes', value => RECIPES[String(value)] ?? String(value)],
  ['purity', value => `${labelOf(purities, value)} purity`],
  ['multiplier', value => `${num(Number(value))}× elevator`],
  ['powerFactor', value => `${num(Number(value))}× power`],
  // Present in settings only when not 1× (#1161).
  ['recipeCost', value => `${num(Number(value))}× recipe parts`],
  // Present in settings only when not the fewest buildings (#1180).
  ['objective', value => objectiveWords(value as PlanObjective, true)],
];

// A profile card's line of the game settings its plan was calculated with (Saves & profiles):
// "vanilla purity · 1× elevator · 1× power", the recipe part cost when not 1× (#1161), "build
// costs counted" when it counts them (#1229) and the objective when not the fewest buildings
// (#1180).
export function profileSummary(settings: {
  purity: string;
  multiplier: number;
  powerFactor: number;
  // The node survey (#1183): its left-out nodes are named.
  extraction?: MiningSettings['extraction'];
  recipeCost?: number;
  buildCost?: true;
  objective?: PlanObjective;
}): string {
  const cost = recipeCostOf(settings);
  const leftOut = leftOutNote(settings.extraction);
  return [
    `${settings.purity} purity`,
    `${num(settings.multiplier)}× elevator`,
    `${num(settings.powerFactor)}× power`,
    ...(leftOut ? [leftOut] : []),
    ...(cost === 1 ? [] : [`${num(cost)}× recipe parts`]),
    ...(settings.buildCost ? ['build costs counted'] : []),
    ...(settings.objective === undefined ? [] : [objectiveWords(settings.objective, true)]),
  ].join(' · ');
}

// The date a name ends with, in the user's own way of writing it: "Oct 7".
export const nameDate = (date = new Date()) =>
  date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// "<goal> · <what changed> · <date>", at most two changes, cut to the 80 characters a name may
// have. `base` is the settings the profile starts from (null for a new save), `goals` the
// catalog's.
export function defaultProfileName(
  settings: NameSettings,
  base: NameSettings | null | undefined,
  goals: { id: string; name: string }[],
  date = new Date(),
): string {
  const from = base ?? FRESH;
  const goal = (goals || []).find(entry => entry.id === settings.goal)?.name ?? 'Profile';
  const changes = NAME_PARTS.filter(
    ([key]) => settings[key] !== undefined && differs(settings[key], from[key] ?? FRESH[key]),
  )
    .slice(0, 2)
    .map(([key, words]) => words(settings[key]));
  return [goal, ...changes, nameDate(date)].join(' · ').slice(0, NAME_LIMIT);
}

// The "Rename to …" offer (#1071) for profiles made before these names: a profile created
// without a typed name used to be named after its goal and nothing else ("Balanced progression",
// the catalog goal's name, which a goal's name in the wizard filled in), so a save could hold four
// cards of that one name. Such a card (a profile whose name is a goal's, of any goal, since an
// edit in place can change the goal and keep the name) is offered the name a new profile gets:
// its goal and up to two changes from a new save's defaults (an old profile records no profile
// it carried from), then the day its plan was made (today without one). Two offers that would be
// the same, or match another profile's name in the save, are numbered " · 2", " · 3" in card
// order, as an import's copies are (labelImport). A dismissed offer (renameOfferDismissed, the
// summary's) and a profile without settings get none. Returns profile id → offered name; nothing
// is stored until the user accepts, which renames the profile.
export function renameOffers(
  profiles: readonly {
    id: string;
    name: string;
    settings?: object | undefined;
    planCreatedAt?: string | undefined;
    renameOfferDismissed?: true | undefined;
  }[],
  goals: { id: string; name: string }[],
): Map<string, string> {
  const goalNames = new Set((goals || []).map(goal => goal.name));
  const taken = new Set(profiles.map(profile => profile.name));
  const offers = new Map<string, string>();
  for (const profile of profiles) {
    if (profile.renameOfferDismissed || !profile.settings || !goalNames.has(profile.name.trim()))
      continue;
    const made = new Date(profile.planCreatedAt ?? '');
    const name = defaultProfileName(
      profile.settings as NameSettings,
      null,
      goals,
      Number.isNaN(made.getTime()) ? new Date() : made,
    );
    let offered = name;
    for (let count = 2; taken.has(offered); count++) {
      const end = ' · ' + count;
      offered = name.slice(0, NAME_LIMIT - end.length).trimEnd() + end;
    }
    taken.add(offered);
    offers.set(profile.id, offered);
  }
  return offers;
}

// The name the previous version of an edited profile is kept under: "<name> (before edit, Oct
// 7, 2:05 PM)", the name cut so the whole fits in 80 characters. A second edit within the same
// minute, whose backup would get a name one of `taken` (the save's profile names) has, is
// numbered: "<name> (before edit 2, Oct 7, 2:05 PM)". The version a restore replaces is kept the
// same way with `reason` 'restore': "<name> (before restore, Oct 7, 2:05 PM)".
export function backupName(
  name: string,
  date = new Date(),
  taken: readonly string[] = [],
  reason: 'edit' | 'restore' = 'edit',
): string {
  const when = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  for (let count = 1; ; count++) {
    const suffix = ` (before ${reason}${count > 1 ? ' ' + count : ''}, ${when})`;
    const named = name.slice(0, Math.max(1, NAME_LIMIT - suffix.length)).trimEnd() + suffix;
    if (!taken.includes(named)) return named;
  }
}

// Two setting values differ: compared as JSON with the object keys sorted, so a map saved in
// another order is the same value.
function differs(a: unknown, b: unknown): boolean {
  return stable(a) !== stable(b);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'undefined';
}

const onOff = (value: unknown) => (value ? 'On' : 'Off');
// The nodes a plan's node survey leaves out of it (#1183) in words, "None" when it leaves none
// out, as every plan made before them.
const leftOutChange = (settings: NameSettings): string =>
  leftOutWords(settings.extraction as MiningSettings['extraction']) || 'None';
// The node survey without the nodes it leaves out, so a change of only those is not counted again
// among the other settings Review counts.
const surveyCounts = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const { excludedNodes: _nodes, excludedWells: _wells, ...rest } = value as NodeExclusions;
  return rest;
};
// The recipe part cost (#1161) in words, absent as 1×: a plan made before the setting was planned
// at 1×, so an edit to 2× is named, and a draft that keeps 1× is no change.
const recipeCostWords = (settings: NameSettings): string =>
  `${num(recipeCostOf(settings as { recipeCost?: number }))}×`;

// The objective (#1180) in words, absent as the fewest buildings: a plan made before the setting
// was planned for them, so an edit to least power is named, and a draft that keeps them is not.
const objectiveChange = (settings: NameSettings): string =>
  objectiveWords(settings.objective as PlanObjective | undefined);

// The caps per phase (#1221) in words, absent as none: a plan made before them had no cap, so
// setting one is named, and a draft that sets none is no change.
const phaseCapsChange = (settings: NameSettings): string => {
  const words = phaseCapWords(settings.phaseCaps as PhaseCaps | undefined);
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'None';
};

// The somersloop pins (#1235) in words, absent as none: a plan made before them had none, so
// pinning a line is named. "2 lines, 8 somersloops".
const pinsReviewWords = (settings: NameSettings): string => {
  const counts = Object.values((settings.sloopPins ?? {}) as SloopPins).flatMap(lines =>
    Object.values(lines ?? {}),
  );
  const total = counts.reduce((sum, sloops) => sum + sloops, 0);
  return counts.length
    ? `${plural(counts.length, 'line')}, ${plural(total, 'somersloop')}`
    : 'None';
};

// The settings Review names when an edit changes them, with the words for their values.
const SETTING_LABELS: [key: string, label: string, words: (value: unknown) => string][] = [
  ['phase', 'Start phase', value => `Phase ${value}`],
  ['purity', 'Node purity', value => labelOf(purities, value)],
  ['distribution', 'Resource distribution', value => labelOf(distributions, value)],
  ['multiplier', 'Elevator parts', value => `${num(Number(value))}×`],
  ['powerFactor', 'Power consumption', value => `${num(Number(value))}×`],
  ['availablePowerGW', 'Power you already have', value => power(Number(value) * 1000)],
  ['recipes', 'Recipes', value => RECIPES[String(value)] ?? String(value)],
  ['pureIngots', 'Pure ingot alternates', onOff],
  // Present in settings only when on (#1229).
  ['buildCost', 'Count what buildings cost to build', onOff],
  ['wholeMachines', 'Machines', value => (value === false ? 'Exact ratios' : 'Whole machines')],
  ['roundRates', 'Round rates', onOff],
  ['hours', 'Hours per phase', value => `${num(Number(value))} h`],
  [
    'phaseTime',
    'Target time for',
    value => (value === 'final' ? 'The final phase' : 'Every phase'),
  ],
  ['storageRate', 'Storage rate', value => num(Number(value))],
  ['utilityPercent', ALLOWANCE_SETTING, value => `${num(Number(value))}%`],
  ['phaseMining', 'Mining and belts per phase', onOff],
  ['ownedMiner', 'Miners you already have', value => (value ? `Miner Mk.${value}` : 'None')],
  ['ownedBelt', 'Belts you already have', value => (value ? `Mk.${value} belts` : 'None')],
  // The belt cap (#1232), absent as no cap.
  ['beltCap', 'Best belt the plan may use', value => (value ? `Mk.${value} belts` : 'No cap')],
  // The cap on hard drives (#1233), absent as no cap; 0 is a cap ("No hard-drive alternates").
  [
    'driveCap',
    'Cap on hard drives',
    value => {
      const words = driveCapWords(value);
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'No cap';
    },
  ],
  ['overclock', 'I can overclock', onOff],
  // Which Water Extractor option the plan suggests (#1142); both are always shown.
  ['waterOverclock', 'Suggested Water Extractors', value => (value ? 'Overclocked' : 'At 100%')],
  [
    'ownedAlternates',
    'Alternates you already own',
    value => (Array.isArray(value) && value.length ? plural(value.length, 'recipe') : 'None'),
  ],
  ['ownedGenerators', 'Generators you already have', generatorWords],
];
// Settings that are absent unless chosen (#1065, #1068): absent is their "off" or "none", so a
// plan without one that the edit turns on is a change, not a setting added since the plan.
const ABSENT_IS_NONE = new Set([
  'buildCost',
  'phaseMining',
  'ownedMiner',
  'ownedBelt',
  'beltCap',
  'driveCap',
  'overclock',
  'waterOverclock',
  'ownedAlternates',
  'ownedGenerators',
]);
// The MAM recipes box (#1058) in words, as the planner reads it (mamRecipesOn in
// planner/recipes.ts): a plan made before the box has none, and planned with them under Standard
// and All, and under custom only with the ones picked.
const mamWords = (settings: NameSettings): string =>
  typeof settings.mamRecipes === 'boolean'
    ? onOff(settings.mamRecipes)
    : settings.recipes === 'custom'
      ? 'Only the ones picked'
      : 'On';
// Such a setting's value, with every way of saying none or off as null.
function noneAsNull(value: unknown): unknown {
  if (value === undefined || value === null || value === false) return null;
  if (Array.isArray(value)) return value.length ? value : null;
  if (typeof value === 'object') return Object.keys(value).length ? value : null;
  return value;
}
// "4 Coal Generators and 2 Fuel Generators", or "None".
function generatorWords(value: unknown): string {
  const counts = Object.entries(value && typeof value === 'object' ? value : {}).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0,
  );
  return counts.length
    ? listNames(
        counts.map(([machine, count]) => `${num(count)} ${machine}${count === 1 ? '' : 's'}`),
      )
    : 'None';
}

export interface SettingChange {
  label: string;
  before: string;
  after: string;
}

// What an edit changes in the settings, old plan against the new preview, both as the planner
// stored them: the goal first, then the settings above, and how many others changed besides.
// A field the old plan does not have is left out: it is a setting added since that plan was
// made, which the planner fills with its default, not a change the user made. A setting absent
// unless chosen (ABSENT_IS_NONE) counts from none, so turning it on is named.
export function settingsChanges(
  oldSettings: object,
  newSettings: object,
  goals: { id: string; name: string }[],
): { changes: SettingChange[]; others: number } {
  const before = oldSettings as NameSettings,
    after = newSettings as NameSettings;
  const changed = (key: string) =>
    ABSENT_IS_NONE.has(key)
      ? differs(noneAsNull(before[key]), noneAsNull(after[key]))
      : before[key] !== undefined && after[key] !== undefined && differs(before[key], after[key]);
  const goalName = (id: unknown) => (goals || []).find(goal => goal.id === id)?.name ?? String(id);
  const changes: SettingChange[] = [
    ...(changed('goal')
      ? [{ label: 'Goal', before: goalName(before.goal), after: goalName(after.goal) }]
      : []),
    ...SETTING_LABELS.filter(([key]) => changed(key)).map(([key, label, words]) => ({
      label,
      before: words(before[key]),
      after: words(after[key]),
    })),
    ...(leftOutChange(before) !== leftOutChange(after)
      ? [{ label: 'Nodes left out', before: leftOutChange(before), after: leftOutChange(after) }]
      : []),
    ...(recipeCostWords(before) !== recipeCostWords(after)
      ? [
          {
            label: 'Recipe part cost',
            before: recipeCostWords(before),
            after: recipeCostWords(after),
          },
        ]
      : []),
    ...(objectiveChange(before) !== objectiveChange(after)
      ? [{ label: 'Objective', before: objectiveChange(before), after: objectiveChange(after) }]
      : []),
    ...(phaseCapsChange(before) !== phaseCapsChange(after)
      ? [
          {
            label: 'Caps per phase',
            before: phaseCapsChange(before),
            after: phaseCapsChange(after),
          },
        ]
      : []),
    ...(stable(before.sloopPins ?? {}) !== stable(after.sloopPins ?? {})
      ? [
          {
            label: 'Somersloop pins',
            before: pinsReviewWords(before),
            after: pinsReviewWords(after),
          },
        ]
      : []),
    // Absent means what the plan did before the box (#1058), so a plan without it is compared too.
    ...(mamWords(before) !== mamWords(after)
      ? [{ label: 'MAM recipes', before: mamWords(before), after: mamWords(after) }]
      : []),
  ];
  const named = new Set([
    'goal',
    'mamRecipes',
    'recipeCost',
    'objective',
    'phaseCaps',
    'sloopPins',
    // The lines that stand (#1176) are no setting the user changed: Review says they are kept.
    'builtLines',
    ...SETTING_LABELS.map(([key]) => key),
  ]);
  const others = Object.keys(after).filter(
    key =>
      !named.has(key) &&
      (key === 'extraction'
        ? before.extraction !== undefined &&
          after.extraction !== undefined &&
          differs(surveyCounts(before.extraction), surveyCounts(after.extraction))
        : changed(key)),
  ).length;
  return { changes, others };
}

export interface PhaseChange {
  phase: string;
  lines: { before: number; after: number; added: number; removed: number };
  buildings: { before: number; after: number };
  power: { before: string; after: string; same: boolean };
}

const machines = (stage: StoredStage | undefined) =>
  (stage?.rows || []).reduce((sum, row) => sum + row.machines, 0);
const needMW = (stage: StoredStage | undefined, plan: StoredCalculatedPlan) =>
  stage?.rows ? powerView(stage, plan.settings).needMW : 0;

// Per phase from the new plan's start phase on, what the edit changes: its production lines
// (how many, and how many are new or gone, by row id: a line's tick is keyed by it), its
// buildings and the power it needs, as Review's own table gives power.
export function phaseChanges(before: StoredCalculatedPlan, after: StoredCalculatedPlan) {
  const from = Number(after.settings.phase || 1);
  const phases = [...new Set([...Object.keys(before.stages), ...Object.keys(after.stages)])].filter(
    phase => Number(phase) >= from,
  );
  phases.sort((a, b) => Number(a) - Number(b));
  return phases.map((phase): PhaseChange => {
    const old = before.stages[phase as keyof typeof before.stages],
      next = after.stages[phase as keyof typeof after.stages];
    const oldIds = new Set((old?.rows || []).map(row => row.id)),
      newIds = new Set((next?.rows || []).map(row => row.id));
    const was = needMW(old, before),
      now = needMW(next, after);
    return {
      phase,
      lines: {
        before: oldIds.size,
        after: newIds.size,
        added: [...newIds].filter(id => !oldIds.has(id)).length,
        removed: [...oldIds].filter(id => !newIds.has(id)).length,
      },
      buildings: { before: machines(old), after: machines(next) },
      power: { before: power(was), after: power(now), same: power(was) === power(now) },
    };
  });
}
