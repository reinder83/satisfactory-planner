// The flow of a factory group in the phase on screen (groupFlow in group-flow.ts), with the words
// the pages use: the build plan's line names, the belts or pipes at that phase, and each link in
// or out as the Logistics page has it (#1067). The group's flow page (GroupFlowPage.vue) and its
// flow graph (ui/detail/FlowGraphDialog.vue, #1192) both read it, so the two never disagree.
// Null without a calculated plan, a stage, or a group of that id.
import { FLUIDS, itemBelts, lanePlan } from './flow.ts';
import { groupFlow, type GroupFlow } from './group-flow.ts';
import { linkItemWords } from './logistics.ts';
import { calcStage, calculated, stage } from './session.ts';
import { buildRowName } from './views/calculated.ts';
import { factoryGroupsState } from './views/factories.ts';

export function shownGroupFlow(groupId: string): GroupFlow | null {
  const storedStage = calcStage();
  if (!calculated || !storedStage) return null;
  const groups = factoryGroupsState();
  const stageKey = stage();
  const belts = (item: string, rate: number) => itemBelts(item, rate, stageKey);
  return groupFlow(
    storedStage,
    groups,
    groupId,
    belts,
    row => buildRowName(row.id),
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
