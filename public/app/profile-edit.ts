// Profile names and Edit settings (#1071). A profile the wizard creates without a typed name is
// named after what it is: its goal, what differs from the settings it started from (the profile
// it carries from, or a new save's defaults) and the day, "Minimal construction · whole machines
// · Oct 7" (defaultProfileName), so several profiles of one save no longer share the goal's
// name. Only new profiles are named this way; a stored name is never changed. Edit settings
// recalculates a profile in place and keeps its previous version as a profile named
// "<name> (before edit, Oct 7, 2:05 PM)" (backupName), which "Restore this version" can swap back
// (app/restore-version.ts). Review lists what the edit changes
// (settingsChanges, phaseChanges), both read from the plans and nothing stored.
import { distributions, purities } from '../preferences.ts';
import { ALLOWANCE_SETTING, powerView } from '../power.ts';
import { num } from './format.ts';
import { power } from './wizard/fields.ts';
import type { Choice, StoredCalculatedPlan, StoredStage } from '../types/index.ts';

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
];

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
];

export interface SettingChange {
  label: string;
  before: string;
  after: string;
}

// What an edit changes in the settings, old plan against the new preview, both as the planner
// stored them: the goal first, then the settings above, and how many others changed besides.
// A field the old plan does not have is left out: it is a setting added since that plan was
// made, which the planner fills with its default, not a change the user made.
export function settingsChanges(
  oldSettings: object,
  newSettings: object,
  goals: { id: string; name: string }[],
): { changes: SettingChange[]; others: number } {
  const before = oldSettings as NameSettings,
    after = newSettings as NameSettings;
  const changed = (key: string) =>
    before[key] !== undefined && after[key] !== undefined && differs(before[key], after[key]);
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
  ];
  const named = new Set(['goal', ...SETTING_LABELS.map(([key]) => key)]);
  const others = Object.keys(after).filter(key => !named.has(key) && changed(key)).length;
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
