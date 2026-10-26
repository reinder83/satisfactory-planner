// The build plan's tabs (#1243, ui/pages/CalculatedPlanPage.vue): Build sequence, the default,
// with the steps and the side column; Overview with the phase's status figures and its notices;
// Hard drives with "Best next hard drive"; Somersloops with "Where a somersloop pays off most".
// Every panel stays mounted (an inactive one is `hidden`), so a panel's own state, such as a
// ranking in progress or the payoff threshold, survives a switch, and what each panel holds is
// read from what its components drew: a tab whose panel drew nothing is left out, and a tab's
// count is the notices in it that ask for something. Nothing here is stored: the page opens on
// Build sequence every time.

export type PlanTab = 'build' | 'overview' | 'hard-drives' | 'somersloops';

export const PLAN_TABS: readonly (readonly [PlanTab, string])[] = [
  ['build', 'Build sequence'],
  ['overview', 'Overview'],
  ['hard-drives', 'Hard drives'],
  ['somersloops', 'Somersloops'],
];

// The notices that ask for something, drawn straight in a panel: a warning (a draft phase,
// power short, somersloops over-committed or planned too early, a recalculation the line
// choices need), the ticks' offer until it is dismissed or taken, and the next phase once the
// delivery is complete. Each goes once acted on (or dismissed), and the count with it.
const NEWS = '.notice.warn, [data-owned-ticks], [data-next-phase]';

export interface PlanTabContent {
  // Whether the panel drew anything; Build sequence always counts as drawn.
  filled: boolean;
  news: number;
}

// What each panel holds now. A component that draws nothing leaves only a comment node, which
// `children` skips.
export function tabContents(
  panels: Partial<Record<PlanTab, HTMLElement | null>>,
): Record<PlanTab, PlanTabContent> {
  const read = (tab: PlanTab): PlanTabContent => {
    const children = [...(panels[tab]?.children ?? [])];
    return {
      filled: tab === 'build' || children.length > 0,
      news: children.filter(child => child.matches(NEWS)).length,
    };
  };
  return {
    build: read('build'),
    overview: read('overview'),
    'hard-drives': read('hard-drives'),
    somersloops: read('somersloops'),
  };
}

// The tab a key moves to in a tab list of `count` tabs from the one at `at` (the WAI-ARIA tabs
// pattern: arrows wrap, Home and End go to the ends), or null for any other key.
export function tabKeyTarget(key: string, at: number, count: number): number | null {
  if (!count) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (at + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
