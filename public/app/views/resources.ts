// How much of a resource budget a plan uses, for both resources pages (ui/pages/ResourcesPage.vue
// against the handbook's capacities, ui/pages/CalculatedResourcesPage.vue against a calculated
// profile's entered budgets), so they agree on the figure, the bar and when a resource is tight
// or over (SP-27, #262). Display only: it reads the numbers the page already has.
import { num } from '../format.ts';

export interface ResourceUse {
  // required / available; Infinity when something is required from a budget of 0.
  fraction: number;
  // The Use column's text: a locale percentage, "No budget" or "—" for nothing of nothing.
  use: string;
  // The bar's filled width in percent, 0–100.
  bar: number;
  // Above 90% of the budget (over budget included).
  tight: boolean;
  // More required than the budget allows.
  over: boolean;
  // How much more, per minute, when over.
  overBy: string;
  // Nothing required in this phase.
  idle: boolean;
}

export function resourceUse(required: number, available: number): ResourceUse {
  const need = Math.max(0, required || 0),
    have = Math.max(0, available || 0);
  const fraction = have > 0 ? need / have : need > 0 ? Infinity : 0;
  const over = need > have;
  return {
    fraction,
    use: have > 0 ? num(fraction * 100) + '%' : need > 0 ? 'No budget' : '—',
    bar: Math.min(100, fraction * 100),
    tight: fraction > 0.9,
    over,
    overBy: over ? num(need - have) : '',
    idle: need <= 0,
  };
}

// Tightest first: over budget and nearly used-up resources lead, nothing required goes last.
// Ties return 0, so a stable sort keeps the catalogue order among them.
export function tightestFirst(a: ResourceUse, b: ResourceUse): number {
  if (a.idle !== b.idle) return a.idle ? 1 : -1;
  if (a.fraction === b.fraction) return 0;
  return a.fraction > b.fraction ? -1 : 1;
}
