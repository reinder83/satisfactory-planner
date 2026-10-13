// The hard-drive payoff table (#204, part 3 of #67): what the Plan page and ADA show of a
// stored ranking (rankAlternates in planner.ts, stored by POST /api/rank-alternates, #203).
// Deltas are the alternate's plan minus the profile's own, so negative is better everywhere.
import { num } from './format.ts';
import { power } from './wizard/fields.ts';
import type { AlternatePayoff, AlternateRanking, Goal } from '../types/index.ts';

// The columns a table can be sorted by, and what each is called.
export type PayoffColumn = 'buildings' | 'rawTotal' | 'powerMW' | 'hours';
export const PAYOFF_COLUMNS: [PayoffColumn, string][] = [
  ['buildings', 'Δ Buildings'],
  ['rawTotal', 'Δ Raw /min'],
  ['powerMW', 'Δ Power'],
  ['hours', 'Δ Hours'],
];
// The same columns in words, for "No alternate changes delivery time here."
export const PAYOFF_WORDS: Record<PayoffColumn, string> = {
  buildings: 'the building count',
  rawTotal: 'raw resource use',
  powerMW: 'power',
  hours: 'delivery time',
};
export const PAYOFF_STATUS: Record<AlternatePayoff['status'], string> = {
  better: 'Pays off',
  mixed: 'Trade-off',
  worse: 'Worse',
  same: 'No change',
  infeasible: 'Does not fit',
  error: 'Failed',
};

// What the profile's goal optimises: buildings for minimal and balanced, delivery time for
// timed and maximum.
export const payoffDefaultSort = (goal: Goal | undefined): PayoffColumn =>
  goal === 'timed' || goal === 'maximum' ? 'hours' : 'buildings';

// The rows worth a line (everything but 'same', which is only counted), sorted by `column`,
// most negative first for direction 1 and the reverse for -1. A missing figure (hours of a phase
// that never finishes) sorts last either way, and so do alternates that failed or do not fit.
export function payoffTable(
  ranking: AlternateRanking,
  column: PayoffColumn,
  direction: 1 | -1 = 1,
): { rows: AlternatePayoff[]; same: number } {
  const failed = (candidate: AlternatePayoff) =>
    candidate.status === 'infeasible' || candidate.status === 'error';
  const rows = ranking.candidates
    .filter(p => p.status !== 'same')
    .sort((a, b) => {
      if (failed(a) !== failed(b)) return failed(a) ? 1 : -1;
      const valueA = a[column],
        valueB = b[column];
      if (valueA === null || valueB === null)
        return valueA === valueB ? 0 : valueA === null ? 1 : -1;
      return (valueA - valueB) * direction || a.name.localeCompare(b.name);
    });
  return { rows, same: ranking.candidates.length - rows.length };
}

// The alternate that pays off most on `column`, or null when none pays off.
export const payoffBest = (ranking: AlternateRanking, column: PayoffColumn) =>
  payoffTable(ranking, column).rows.find(p => p.status === 'better' && (p[column] ?? 0) < 0) ??
  null;

// A delta as the table shows it: signed, with its unit; "–" when the figure is missing.
export function payoffDelta(alternate: AlternatePayoff, column: PayoffColumn): string {
  const delta = alternate[column];
  if (alternate.status === 'infeasible' || alternate.status === 'error' || delta === null)
    return '–';
  if (Math.abs(delta) < 0.005) return '0';
  const sign = delta > 0 ? '+' : '−';
  const size = Math.abs(delta);
  return (
    sign +
    (column === 'powerMW'
      ? power(size)
      : column === 'hours'
        ? num(size) + ' h'
        : column === 'rawTotal'
          ? num(size) + '/min'
          : num(size))
  );
}

// The phases a ranking's figures cover, in words: "Phase 2", or "Phases 2–5" for a ranking over
// the remaining phases (#1075).
export function rankedPhases(ranking: Pick<AlternateRanking, 'phase' | 'phases'>): string {
  const phases = ranking.phases?.length ? ranking.phases : [ranking.phase];
  return phases.length === 1
    ? 'Phase ' + phases[0]
    : `Phases ${phases[0]}–${phases[phases.length - 1]}`;
}

// What the recipe picker (#1075, ui/wizard/AltPicker.vue) shows of a stored ranking, per
// alternate: its buildings delta, its status and the phases it covers.
export interface PayoffFigure {
  buildings: number;
  status: AlternatePayoff['status'];
  where: string;
}
export function payoffFigures(ranking: AlternateRanking): Map<string, PayoffFigure> {
  const where = rankedPhases(ranking);
  return new Map(
    ranking.candidates
      .filter(candidate => candidate.status !== 'error')
      .map(candidate => [
        candidate.id,
        { buildings: candidate.buildings, status: candidate.status, where },
      ]),
  );
}
// "−14 buildings in Phase 2"; without `where`, "−14 buildings".
export const payoffSaving = (figure: PayoffFigure, where = true): string =>
  `−${num(Math.abs(figure.buildings))} ${Math.abs(figure.buildings) === 1 ? 'building' : 'buildings'}` +
  (where ? ' in ' + figure.where : '');
