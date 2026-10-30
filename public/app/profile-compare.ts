// "Compare profiles" on Saves & profiles (#1074): the profiles of one save side by side, from the
// figures their stored plans hold (ProfileSummary.figures, planFigures in public/state/figures.ts),
// with each figure's difference from a baseline profile, and the time to finish every planned
// phase with the fastest profile marked. Nothing is calculated again: a figure a plan does not
// hold is "—", and so is its difference.
//
// The time to finish keeps what is measured apart from what is estimated: the delivery time is
// the plan's own, as the build plan gives it ("Delivery in about …"), and the buildings each phase
// adds are counted from the plan, but the planner has no model of how long building takes, so the
// building time is those buildings times the minutes per building the user sets (buildMinutes in
// session.ts), which the page labels as an estimate. At 0 minutes it is the delivery time alone.
import { durationOfHours, num } from './format.ts';
import { powerAmount } from '../wording.ts';
import type { ComparedPhase, PlanFigures, StageKey } from '../types/index.ts';

// A profile as the comparison reads it.
export interface ComparedProfile {
  id: string;
  name: string;
  figures?: PlanFigures;
}

// A figure's difference from the baseline: its text with its sign ('+12', '−3 MW'), and whether
// it is lower or higher. Fewer buildings, parts, less power, ore, oil, alternates and time are the
// cheaper plan, which `lower` marks; absent when there is nothing to compare or no difference.
export interface Delta {
  text: string;
  trend: 'lower' | 'higher';
}
export interface CompareCell {
  text: string;
  delta?: Delta;
}
export interface CompareRow {
  id: string;
  name: string;
  baseline: boolean;
  // "Not planned" (the phase is before its start phase), "Does not fit", or ''.
  note: string;
  cells: CompareCell[];
}
// A time to finish, and while the building time is estimated (minutes above 0) its parts, a line
// each: ["4 h 10 min delivery", "+ est. 45 min building"].
export interface TimeCell {
  text: string;
  parts?: string[];
}
export interface TimeRow {
  id: string;
  name: string;
  baseline: boolean;
  // One cell per phase of `phases`, '—' for a phase the profile does not plan.
  phases: TimeCell[];
  // The time to finish every planned phase, with its parts as a phase's cell gives them.
  total: CompareCell & { parts?: string[] };
  // The planned phases the total covers ("Phases 3–5").
  covers: string;
  // The shortest total among the profiles that plan the same phases as the baseline.
  fastest: boolean;
}
export interface CompareView {
  baselineId: string;
  phase: StageKey;
  // The phases any of the profiles plans, for the phase picker and the time table.
  phases: StageKey[];
  columns: string[];
  rows: CompareRow[];
  time: TimeRow[];
  // The minutes per building the building time assumes; 0 is delivery time only.
  minutes: number;
  // Profiles left out of "fastest" because they plan other phases than the baseline does.
  otherPhases: string[];
}

// The figures the phase table shows, in its column order: the heading, the figure and its words.
type Metric = {
  heading: string;
  value: (phase: ComparedPhase) => number | null;
  text: (value: number) => string;
  // The difference's words without its sign.
  delta: (difference: number) => string;
  // Below this, a difference is rounding dust and not shown.
  dust: number;
};
const perMinute = (unit: string) => (value: number) => `${num(value)}${unit}`;
const METRICS: Metric[] = [
  { heading: 'Buildings', value: p => p.buildings, text: num, delta: num, dust: 0.005 },
  {
    heading: 'Buildings to add',
    value: p => p.newBuildings ?? null,
    text: num,
    delta: num,
    dust: 0.005,
  },
  {
    heading: 'Build materials',
    value: p => p.buildParts ?? null,
    text: parts => `${num(parts)} parts`,
    delta: num,
    dust: 0.005,
  },
  {
    heading: 'Power needed',
    value: p => p.powerMW,
    text: powerAmount,
    delta: powerAmount,
    dust: 0.05,
  },
  {
    heading: 'Ore mined',
    value: p => p.ore,
    text: perMinute('/min'),
    delta: perMinute('/min'),
    dust: 0.005,
  },
  {
    heading: 'Crude Oil',
    value: p => p.oil,
    text: perMinute(' m³/min'),
    delta: perMinute(' m³/min'),
    dust: 0.005,
  },
  {
    heading: 'Alternates to unlock',
    value: p => p.alternates,
    text: num,
    delta: num,
    dust: 0.5,
  },
  {
    heading: 'Delivery time',
    value: p => p.hours,
    text: durationOfHours,
    delta: hours => shortDuration(hours),
    dust: 1 / 120,
  },
];

// A difference in time without "about": "45 min", "1 h 20 min", "3 h".
export function shortDuration(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${num(minutes)} min`;
  const rest = minutes % 60;
  return `${num(Math.floor(minutes / 60))} h` + (rest ? ` ${num(rest)} min` : '');
}

// `value` against `base`, as a Delta, or undefined when either is missing or they are the same
// to within `dust`. The minus sign is U+2212, as in print.
export function delta(
  value: number | null | undefined,
  base: number | null | undefined,
  words: (difference: number) => string,
  dust: number,
): Delta | undefined {
  if (value == null || base == null) return undefined;
  const difference = value - base;
  if (Math.abs(difference) < dust) return undefined;
  return {
    text: (difference > 0 ? '+' : '−') + words(Math.abs(difference)),
    trend: difference > 0 ? 'higher' : 'lower',
  };
}

const phaseOf = (profile: ComparedProfile, phase: StageKey) =>
  profile.figures?.phases.find(entry => entry.phase === phase);

// "Phases 3–5", "Phase 5".
const phasesWords = (figures: PlanFigures | undefined): string => {
  const planned = figures?.phases.map(entry => entry.phase) ?? [];
  if (!planned.length) return '';
  return planned.length === 1
    ? `Phase ${planned[0]}`
    : `Phases ${planned[0]}–${planned[planned.length - 1]}`;
};

// One profile's row of the phase table.
function phaseRow(profile: ComparedProfile, base: ComparedProfile, phase: StageKey): CompareRow {
  const own = phaseOf(profile, phase),
    theirs = phaseOf(base, phase);
  const isBase = profile.id === base.id;
  return {
    id: profile.id,
    name: profile.name,
    baseline: isBase,
    note: !own ? 'Not planned' : own.feasible ? '' : 'Does not fit',
    cells: METRICS.map(metric => {
      const value = own ? metric.value(own) : null;
      const never = metric.heading === 'Delivery time' && own?.never;
      return {
        text: value === null ? (never ? 'Never' : '—') : metric.text(value),
        delta: isBase
          ? undefined
          : delta(value, theirs ? metric.value(theirs) : null, metric.delta, metric.dust),
      };
    }),
  };
}

// The estimated building time of a phase in hours: its buildings to add times `minutes` each.
// 0 at 0 minutes; null when the phase's buildings to add are unknown.
function buildHoursOf(entry: ComparedPhase, minutes: number): number | null {
  if (minutes <= 0) return 0;
  return entry.newBuildings == null ? null : (entry.newBuildings * minutes) / 60;
}

// A phase's time to finish: its delivery time and its estimated building time, null when either
// is unknown.
function finishHours(entry: ComparedPhase, minutes: number): number | null {
  const building = buildHoursOf(entry, minutes);
  return entry.hours == null || building === null ? null : entry.hours + building;
}

// One phase's cell of the time table.
function timeCell(entry: ComparedPhase | undefined, minutes: number): TimeCell {
  if (!entry) return { text: '—' };
  if (entry.hours == null) return { text: entry.never ? 'Never' : '—' };
  const building = buildHoursOf(entry, minutes);
  if (minutes <= 0) return { text: durationOfHours(entry.hours) };
  if (building === null)
    return { text: durationOfHours(entry.hours), parts: ['delivery only', 'buildings unknown'] };
  return {
    text: durationOfHours(entry.hours + building),
    parts: estimateParts(entry.hours + building, building),
  };
}

// The parts of a time to finish of `hours`, `building` of them estimated, a line each.
const estimateParts = (hours: number, building: number): string[] => [
  `${shortDuration(hours - building)} delivery`,
  `+ est. ${shortDuration(building)} building`,
];

// A profile's time to finish every planned phase, and the estimated building time in it: null
// unless each planned phase fits and has a delivery time (totalHours) and its building time is
// known.
function finishTotal(
  figures: PlanFigures,
  minutes: number,
): { hours: number; building: number } | null {
  if (figures.totalHours === null) return null;
  let hours = 0,
    building = 0;
  for (const entry of figures.phases) {
    const own = buildHoursOf(entry, minutes),
      finish = finishHours(entry, minutes);
    if (own === null || finish === null) return null;
    hours += finish;
    building += own;
  }
  return { hours, building };
}

// The phase table and the time table for `profiles` (a save's, in their order), the building time
// at `minutes` per building. The baseline is `baselineId` when it is one of them, else the first;
// the phase is `phase` when one of them plans it, else the baseline's first planned phase. Only
// profiles with figures are compared.
export function compareView(
  profiles: ComparedProfile[],
  baselineId: string,
  phase: string,
  minutes: number,
): CompareView | null {
  const compared = profiles.filter(profile => profile.figures?.phases.length);
  if (compared.length < 2) return null;
  // compared holds at least two profiles, so it has a first.
  const base = compared.find(profile => profile.id === baselineId) ?? compared[0]!;
  const phases = [
    ...new Set(compared.flatMap(profile => profile.figures!.phases.map(entry => entry.phase))),
  ].sort();
  const shown = (
    phases.includes(phase as StageKey) ? phase : base.figures!.phases[0]!.phase
  ) as StageKey;
  const totalOf = new Map(
    compared.map(profile => [profile.id, finishTotal(profile.figures!, minutes)]),
  );
  // "Fastest" compares like with like: the profiles that plan the same phases as the baseline.
  const same = (profile: ComparedProfile) => profile.figures!.from === base.figures!.from;
  const totals = compared
    .filter(same)
    .map(profile => totalOf.get(profile.id)?.hours)
    .filter((hours): hours is number => hours != null);
  const best = totals.length >= 2 ? Math.min(...totals) : null;
  const baseTotal = totalOf.get(base.id)?.hours;
  return {
    baselineId: base.id,
    phase: shown,
    phases,
    columns: METRICS.map(metric => metric.heading),
    rows: compared.map(profile => phaseRow(profile, base, shown)),
    time: compared.map(profile => {
      const total = totalOf.get(profile.id) ?? null;
      return {
        id: profile.id,
        name: profile.name,
        baseline: profile.id === base.id,
        phases: phases.map(key => timeCell(phaseOf(profile, key), minutes)),
        total: {
          text: total === null ? '—' : durationOfHours(total.hours),
          ...(total && minutes > 0 ? { parts: estimateParts(total.hours, total.building) } : {}),
          delta:
            profile.id === base.id || !same(profile)
              ? undefined
              : delta(total?.hours, baseTotal, shortDuration, 1 / 120),
        },
        covers: phasesWords(profile.figures),
        fastest: best !== null && same(profile) && total !== null && total.hours - best < 1 / 120,
      };
    }),
    minutes,
    otherPhases: compared.filter(profile => !same(profile)).map(profile => profile.name),
  };
}

// The fastest profiles of a save, by name, as ADA says it: with the open profile as baseline, as
// the page starts, at `minutes` per building. Empty when fewer than two can be compared.
export function fastestProfiles(profiles: ComparedProfile[], baselineId: string, minutes: number) {
  const view = compareView(profiles, baselineId, '', minutes);
  const fastest = view?.time.filter(row => row.fastest) ?? [];
  return { names: fastest.map(row => row.name), total: fastest[0]?.total.text ?? '' };
}
