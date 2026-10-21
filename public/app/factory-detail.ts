// The dialogs for a calculated factory and a factory group's flow graph in the shared #detail
// <dialog>, components in ui/detail/ opened by openCalculatedFactory and openFlowGraph. The
// storage container (openSlot, views/storage.ts) and the wizard's alternate recipe (openAltRecipe in wizard/recipes.ts) open there too. A factory
// group's build order is a page of its own, #factories/<group>/flow (GroupFlowPage.vue, #895).
import { calcStage } from './session.ts';
import { showDetail } from './ui/detail.ts';

// The dialog for one row of a calculated plan (ui/detail/CalcFactoryDialog.vue).
export function openCalculatedFactory(id: string) {
  if (!calcStage()?.rows?.some(r => r.id === id)) return;
  showDetail({ kind: 'calc', id });
}

// The flow graph of factory group `groupId` in the phase shown (ui/detail/FlowGraphDialog.vue,
// #1192): "Flow graph ↗" on the group's heading on the Factories page.
export function openFlowGraph(groupId: string) {
  showDetail({ kind: 'graph', id: groupId });
}
