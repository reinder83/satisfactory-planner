// What a production line, and a factory, grow to in the later phases of the same plan (#1299), so
// a player can leave room for them now. A line is the same in every phase by its row id; these
// only read the stored plan's stages, so nothing is stored and nothing is recalculated.
//   - lineGrowth: the machines the same line needs in each later phase, for one muted line on its
//     card, its dialog and its build-plan step ("Phase 4: 89 · Phase 5: 225 Refineries"), or that
//     later phases no longer build it ("not needed after Phase 4").
//   - groupGrowth: a factory's machines in the phase shown and each later one, with a rough
//     footprint in foundations (footprints.ts), for its heading on the Factories page.
// A later phase counts only when the plan builds lines there (a stage with rows); a plan that ends
// earlier says nothing about the phases it does not plan.
import { machineFoundations } from './footprints.ts';
import { rowPlaces, type GroupsInput } from './group-order.ts';
import { buildingName, localeNumber } from '../wording.ts';
import type { CalcRow, StageKey, StoredCalculatedPlan } from '../types/index.ts';

// The phases after `stageKey` whose plan builds any line, in order.
function laterStages(plan: StoredCalculatedPlan, stageKey: StageKey): StageKey[] {
  const later: StageKey[] = [];
  for (let next = Number(stageKey) + 1; next <= 5; next++) {
    const key = String(next) as StageKey;
    if (plan.stages[key]?.rows?.length) later.push(key);
  }
  return later;
}

// The row of line `rowId` in phase `stageKey` of `plan`, if that phase builds it.
const lineIn = (
  plan: StoredCalculatedPlan,
  stageKey: StageKey,
  rowId: string,
): CalcRow | undefined => plan.stages[stageKey]?.rows?.find(row => row.id === rowId);

// The first phase after `stageKey` whose plan builds line `rowId`, or null (a delivered part's
// idle line and a batch task, delivered.ts).
export function laterPhase(
  plan: StoredCalculatedPlan,
  stageKey: StageKey,
  rowId: string,
): StageKey | null {
  return laterStages(plan, stageKey).find(key => !!lineIn(plan, key, rowId)) ?? null;
}

// The same line in the later phases: its machines in each one up to the last that builds it (0 for
// a phase between that does not), its machine, and `droppedAfter`, the last phase that builds it
// when a later phase of the plan no longer does (the phase shown when none does).
export interface LineGrowth {
  machine: string;
  phases: { phase: StageKey; machines: number }[];
  droppedAfter: StageKey | null;
}

// Line `rowId` of `stageKey` in the later phases of `plan`, or null when there is nothing to say:
// the phase shown does not build it, the plan plans no later phase, or every later phase builds it
// with the same machines.
export function lineGrowth(
  plan: StoredCalculatedPlan | null | undefined,
  stageKey: StageKey,
  rowId: string,
): LineGrowth | null {
  const row = plan && lineIn(plan, stageKey, rowId);
  if (!plan || !row) return null;
  const later = laterStages(plan, stageKey).map(phase => ({
    phase,
    machines: lineIn(plan, phase, rowId)?.machines ?? 0,
  }));
  let last = later.length - 1;
  while (last >= 0 && !later[last]!.machines) last--;
  const phases = later.slice(0, last + 1);
  const dropped = last < later.length - 1;
  if (!dropped && phases.every(entry => entry.machines === row.machines)) return null;
  return {
    machine: row.machine,
    phases,
    droppedAfter: dropped ? (phases.at(-1)?.phase ?? stageKey) : null,
  };
}

// What the card, the dialog and the step say: "Phase 4: 89 · Phase 5: 225 Refineries", "Phase 4:
// 97 Refineries · not needed after Phase 4", "Not needed after Phase 3", and "Phase 4: none" for a
// phase between that does not build it.
export function lineGrowthText({ machine, phases, droppedAfter }: LineGrowth): string {
  const parts = phases.map(
    ({ phase, machines }) => `Phase ${phase}: ${machines ? localeNumber(machines) : 'none'}`,
  );
  const lastCount = phases.at(-1)?.machines ?? 0;
  if (parts.length) parts[parts.length - 1] += ' ' + buildingName(machine, lastCount);
  if (droppedAfter)
    parts.push((parts.length ? 'not' : 'Not') + ` needed after Phase ${droppedAfter}`);
  return parts.join(' · ');
}

// A factory's size in one phase: its machines (a line split over several factories counts its
// share, as the cards' "≈ 3 of 6 machines" do) and the foundations they stand on, both unrounded.
export interface GroupPhaseSize {
  phase: StageKey;
  machines: number;
  foundations: number;
}

// Factory group `groupId` in `stageKey` and each later phase of `plan`: the lines with a share in
// it there (rowPlaces, as the Logistics page places them; memberships are kept by row id, so a
// later phase counts the lines of that phase the factory holds). Empty when the factory has no
// machine in any of them.
export function groupGrowth(
  plan: StoredCalculatedPlan | null | undefined,
  stageKey: StageKey,
  groupId: string,
  groups: GroupsInput,
): GroupPhaseSize[] {
  if (!plan?.stages[stageKey]?.rows?.length) return [];
  const sizes = [stageKey, ...laterStages(plan, stageKey)].map(phase => {
    let machines = 0,
      foundations = 0;
    for (const row of plan.stages[phase]?.rows || []) {
      const share = rowPlaces(row, groups).get(groupId) ?? 0;
      if (!share) continue;
      machines += row.machines * share;
      foundations += machineFoundations(row.machine, row.machines * share);
    }
    return { phase, machines, foundations };
  });
  return sizes.some(size => size.machines > 0) ? sizes : [];
}

// The factory heading's line: "Phase 3: 641 machines, ≈ 1,230 foundations · Phase 4: 3,908, ≈
// 7,400 · Phase 5: 10,618, ≈ 21,000". Machines are rounded, foundations rounded up.
export function groupGrowthText(sizes: GroupPhaseSize[]): string {
  return sizes
    .map(({ phase, machines, foundations }, i) => {
      const count = Math.round(machines),
        room = Math.ceil(foundations - 1e-9);
      return i
        ? `Phase ${phase}: ${localeNumber(count)}, ≈\u00a0${localeNumber(room)}`
        : `Phase ${phase}: ${localeNumber(count)} ${count === 1 ? 'machine' : 'machines'}, ≈\u00a0${localeNumber(room)} ${room === 1 ? 'foundation' : 'foundations'}`;
    })
    .join(' · ');
}
