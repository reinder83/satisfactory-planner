// The flow of a factory group in the phase on screen (groupFlow in group-flow.ts), with the words
// the pages use: the build plan's line names, the belts or pipes at that phase, and each link in
// or out as the Logistics page has it (#1067). The group's flow page (GroupFlowPage.vue) and its
// flow graph (ui/detail/FlowGraphDialog.vue, #1192) both read it, so the two never disagree.
// Null without a calculated plan, a stage, or a group of that id. `stageKey` (#1317) is another
// phase's, for the phase tabs of the build order page and the flow graph: the same figures for that
// phase, to look at only.
import { FLUIDS, itemBelts, lanePlan } from './flow.ts';
import { groupFlow, type GroupFlow } from './group-flow.ts';
import { linkItemWords } from './logistics.ts';
import { calculated, milestoneOnly, stage } from './session.ts';
import type { StageKey, StoredStage } from '../types/index.ts';
import { buildRowName } from './views/calculated.ts';
import { factoryGroupsState } from './views/factories.ts';

// The stored stage of phase `key`: none for a milestone-only phase (calcStage in session.ts is
// the phase on screen's).
export const storedStageOf = (key: StageKey): StoredStage | undefined =>
  !calculated || milestoneOnly(key) ? undefined : calculated.stages[key];

export function shownGroupFlow(groupId: string, stageKey: StageKey = stage()): GroupFlow | null {
  const storedStage = storedStageOf(stageKey);
  if (!calculated || !storedStage) return null;
  const groups = factoryGroupsState();
  const belts = (item: string, rate: number) => itemBelts(item, rate, stageKey);
  return groupFlow(
    storedStage,
    groups,
    groupId,
    belts,
    row => buildRowName(row.id, storedStage),
    calculated.settings.onSite,
    // Each link in or out as the Logistics page has it (#1067): its vehicle, Water
    // Extractors at the site, or its belts with the trickle items on a mixed belt.
    link =>
      linkItemWords(
        link,
        groups.links,
        FLUIDS,
        (rate, fluid) => lanePlan(rate, fluid, stageKey),
        belts,
      ),
  );
}
