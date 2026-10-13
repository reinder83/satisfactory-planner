// "Compare profiles" on Saves & profiles (#1074): the profiles of one save side by side, from the
// figures their stored plans hold (ProfileSummary.figures, planFigures in public/state/figures.ts),
// with each figure's difference from a baseline profile, and the delivery time of every planned
// phase with the fastest profile marked. Nothing is calculated again: a figure a plan does not
// hold is "—", and so is its difference.
//
// The time is delivery time only, as the build plan gives it ("Delivery in about …"): the planner
// has no model of how long building takes, so it is not added in (see #1074).
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
// it is lower or higher. Fewer buildings, less power, ore, oil, alternates and time are the
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
export interface TimeRow {
  id: string;
  name: string;
  baseline: boolean;
  // One cell per phase of `phases`, '—' for a phase the profile does not plan.
  phases: string[];
  total: CompareCell;
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
export const METRICS: Metric[] = [
  { heading: 'Buildings', value: p => p.buildings, text: num, delta: num, dust: 0.005 },
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

// The phase table and the time table for `profiles` (a save's, in their order). The baseline is
// `baselineId` when it is one of them, else the first; the phase is `phase` when one of them plans
// it, else the baseline's first planned phase. Only profiles with figures are compared.
export function compareView(
  profiles: ComparedProfile[],
  baselineId: string,
  phase: string,
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
  // "Fastest" compares like with like: the profiles that plan the same phases as the baseline.
  const same = (profile: ComparedProfile) => profile.figures!.from === base.figures!.from;
  const totals = compared
    .filter(same)
    .map(profile => profile.figures!.totalHours)
    .filter((hours): hours is number => hours !== null);
  const best = totals.length >= 2 ? Math.min(...totals) : null;
  return {
    baselineId: base.id,
    phase: shown,
    phases,
    columns: METRICS.map(metric => metric.heading),
    rows: compared.map(profile => phaseRow(profile, base, shown)),
    time: compared.map(profile => {
      const total = profile.figures!.totalHours;
      return {
        id: profile.id,
        name: profile.name,
        baseline: profile.id === base.id,
        phases: phases.map(key => {
          const entry = phaseOf(profile, key);
          return entry?.hours != null ? durationOfHours(entry.hours) : entry?.never ? 'Never' : '—';
        }),
        total: {
          text: total === null ? '—' : durationOfHours(total),
          delta:
            profile.id === base.id || !same(profile)
              ? undefined
              : delta(total, base.figures!.totalHours, shortDuration, 1 / 120),
        },
        covers: phasesWords(profile.figures),
        fastest: best !== null && same(profile) && total !== null && total - best < 1 / 120,
      };
    }),
    otherPhases: compared.filter(profile => !same(profile)).map(profile => profile.name),
  };
}

// The fastest profiles of a save, by name, as ADA says it: with the open profile as baseline, as
// the page starts. Empty when fewer than two can be compared.
export function fastestProfiles(profiles: ComparedProfile[], baselineId: string) {
  const view = compareView(profiles, baselineId, '');
  const fastest = view?.time.filter(row => row.fastest) ?? [];
  return { names: fastest.map(row => row.name), total: fastest[0]?.total.text ?? '' };
}
