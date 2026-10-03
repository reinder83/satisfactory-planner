// The dialog for a calculated factory in the shared #detail <dialog>, a component in ui/detail/
// opened by openCalculatedFactory. The storage container (openSlot, views/storage.ts) and the
// wizard's alternate recipe (openAltRecipe in wizard/recipes.ts) open there too. A factory
// group's build order is a page of its own, #factories/<group>/flow (GroupFlowPage.vue, #895).
import { calcStage } from './session.ts';
import { showDetail } from './ui/detail.ts';

// The dialog for one row of a calculated plan (ui/detail/CalcFactoryDialog.vue).
export function openCalculatedFactory(id: string) {
  if (!calcStage()?.rows?.some(r => r.id === id)) return;
  showDetail({ kind: 'calc', id });
}
