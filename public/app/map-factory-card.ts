// The facts on a factory's card on the world map (MAP-3, #1348): its status, its lines (running of
// all), its machines (built of all), its power and what it needs from other factories, from the
// plan's phase on screen. This is the pure part; ui/map-factory-card-live.ts reads the open
// profile. Nothing here is saved.
import { groupLinks, placeName } from './group-links.ts';
import { rowPlaces } from './group-order.ts';
import { localeNumber, powerAmount } from '../wording.ts';
import type { CalcRow, FactoryGroups } from '../types/index.ts';

// What the card reads of a line.
export type FactoryRow = Pick<
  CalcRow,
  'id' | 'outputs' | 'generationMW' | 'onSite' | 'power' | 'peakMW'
>;

export type FactoryStatus = 'held-back' | 'running' | 'built' | 'building' | 'not-started';
export const STATUS_TEXT: Record<FactoryStatus, string> = {
  'held-back': 'Held back',
  running: 'Running',
  built: 'Built',
  building: 'Building',
  'not-started': 'Not started',
};

export interface FactoryFacts {
  status: FactoryStatus;
  // Lines in the phase shown, and how many are ticked Running.
  lines: number;
  running: number;
  // Machines needed in the phase shown (rounded) and built.
  machines: number;
  built: number;
  powerMW: number;
  // What other factories send it: "Plastic from Oil campus".
  needs: { from: string; items: string[] }[];
}

export function factoryFacts(
  stageRows: readonly FactoryRow[],
  groups: FactoryGroups,
  groupId: string,
  options: {
    isRunning: (row: FactoryRow) => boolean;
    count: { built: number; needed: number };
    heldBack: boolean;
    links: ReturnType<typeof groupLinks>;
  },
): FactoryFacts {
  let lines = 0,
    running = 0,
    powerMW = 0;
  for (const row of stageRows) {
    const share = rowPlaces(row, groups).get(groupId) ?? 0;
    if (!share) continue;
    lines++;
    if (options.isRunning(row)) running++;
    if (row.power > 0) powerMW += row.peakMW * share;
  }
  const { built, needed } = options.count;
  const status: FactoryStatus = options.heldBack
    ? 'held-back'
    : lines > 0 && running === lines
      ? 'running'
      : needed >= 0.5 && built >= needed - 0.5
        ? 'built'
        : built > 0
          ? 'building'
          : 'not-started';
  const needs = options.links
    .filter(link => link.to === groupId && groups.groups.some(group => group.id === link.from))
    .map(link => ({
      from: placeName(link.from, groups.groups, undefined),
      items: link.items.slice(0, 3).map(entry => entry.item),
    }));
  return {
    status,
    lines,
    running,
    machines: Math.round(needed),
    built: Math.round(built),
    powerMW,
    needs,
  };
}

export const needsText = (needs: FactoryFacts['needs']): string =>
  needs.length
    ? 'Needs ' + needs.map(entry => `${entry.items.join(', ')} from ${entry.from}`).join('; ') + '.'
    : 'Needs nothing from other factories.';
export const powerText = (mw: number): string => (mw > 0 ? powerAmount(mw) : '0 MW');
export const countText = (count: number): string => localeNumber(count);
