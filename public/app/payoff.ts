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
// most negative first for dir 1 and the reverse for -1. A missing figure (hours of a phase that
// never finishes) sorts last either way, and so do alternates that failed or do not fit.
export function payoffTable(
  ranking: AlternateRanking,
  column: PayoffColumn,
  dir: 1 | -1 = 1,
): { rows: AlternatePayoff[]; same: number } {
  const failed = (p: AlternatePayoff) => p.status === 'infeasible' || p.status === 'error';
  const rows = ranking.candidates
    .filter(p => p.status !== 'same')
    .sort((a, b) => {
      if (failed(a) !== failed(b)) return failed(a) ? 1 : -1;
      const x = a[column],
        y = b[column];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (x - y) * dir || a.name.localeCompare(b.name);
    });
  return { rows, same: ranking.candidates.length - rows.length };
}

// The alternate that pays off most on `column`, or null when none pays off.
export const payoffBest = (ranking: AlternateRanking, column: PayoffColumn) =>
  payoffTable(ranking, column).rows.find(p => p.status === 'better' && (p[column] ?? 0) < 0) ??
  null;

// A delta as the table shows it: signed, with its unit; "–" when the figure is missing.
export function payoffDelta(p: AlternatePayoff, column: PayoffColumn): string {
  const x = p[column];
  if (p.status === 'infeasible' || p.status === 'error' || x === null) return '–';
  if (Math.abs(x) < 0.005) return '0';
  const sign = x > 0 ? '+' : '−';
  const size = Math.abs(x);
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
