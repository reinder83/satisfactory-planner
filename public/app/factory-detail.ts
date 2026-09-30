// Detail dialogs in the shared #detail <dialog>. The factory dialogs (handbook and calculated),
// a factory group's build order and the storage container are components in ui/detail/, opened
// by openFactory, openCalculatedFactory, openGroupChain and openSlot (views/storage.ts), as
// is the wizard's alternate recipe (openAltRecipe in wizard/recipes.ts).
import { num } from './format.ts';
import { itemRate } from './flow.ts';
import { calcStage, calculated, plan, stage } from './session.ts';
import { showDetail } from './ui/detail.ts';
import { factoryGroupsState, membershipsOf } from './views/factories.ts';
import type { FactoryLink } from './ui/actions.ts';
import type { ItemRates } from '../types/index.ts';

// A factory in a group's build order, in one shape for both profile kinds.
interface ChainNode {
  id: string;
  link: FactoryLink;
  name: string;
  machine: string;
  machines: number;
  inputs: ItemRates;
  outputs: ItemRates;
  // A calculated generator's output, MW.
  mw?: number;
  recipe?: string;
}

// One numbered stage of a group's build order (ui/detail/GroupChainDialog.vue).
export interface ChainStage {
  no: string;
  id: string;
  link: FactoryLink;
  name: string;
  machines: string;
  needs: { text: string; loop: boolean; from: string }[];
  feeds: string[];
  power: boolean;
}

// The dialog for one handbook factory (ui/detail/FactoryDialog.vue); nothing for an unknown id.
export function openFactory(id: string) {
  if (!plan.factories.some(x => x.id === id)) return;
  showDetail({ kind: 'factory', id });
}

// The dialog for one row of a calculated plan (ui/detail/CalcFactoryDialog.vue).
export function openCalculatedFactory(id: string) {
  if (!calcStage()?.rows?.some(r => r.id === id)) return;
  showDetail({ kind: 'calc', id });
}

// The build-order dialog for a factory group (ui/detail/GroupChainDialog.vue).
export function openGroupChain(groupId: string) {
  if (!factoryGroupsState().groups.some(g => g.id === groupId)) return;
  showDetail({ kind: 'group', id: groupId });
}

// The factories assigned to group `groupId` that run in the current phase, in one shape for both
// profile kinds: { id, link, name, machine, machines, inputs, outputs } with total rates.
// Calculated rows also carry generationMW as `mw`; a handbook factory has a single output,
// its own item.
function groupChainNodes(groupId: string): ChainNode[] {
  if (calculated) {
    const storedStage = calcStage();
    return (storedStage?.rows || [])
      .filter(r => membershipsOf(r.id).some(m => m.group === groupId))
      .map(row => ({
        id: row.id,
        link: { calcFactory: row.id },
        name: row.name,
        machine: row.machine,
        machines: row.machines,
        inputs: row.inputs || {},
        outputs: row.outputs || {},
        mw: row.generationMW,
      }));
  }
  const stageKey = stage();
  return plan.factories
    .filter(f => f.stages[stageKey] && membershipsOf(f.id).some(m => m.group === groupId))
    .map(factory => {
      // The filter above keeps only factories with this stage.
      const factoryStage = factory.stages[stageKey]!;
      return {
        id: factory.id,
        link: { factory: factory.id },
        name: factory.name,
        machine: factoryStage.machine,
        machines: factoryStage.machines,
        inputs: factoryStage.inputs || {},
        outputs: { [factory.name]: factoryStage.output },
        recipe: factoryStage.recipe,
      };
    });
}

// A factory group's build order at the current phase: its factories as numbered stages,
// suppliers before consumers, each with what it needs (and from which stage) and what it feeds.
// Returns null for an unknown group, otherwise { name, stages, split }; `stages` is empty when
// no factory of the group produces anything in this phase. Each stage is { no, link, name,
// machines, needs: [{ text, from, loop }], feeds: [text], power }.
export function groupChain(
  groupId: string,
): { name: string; stages: ChainStage[]; split: boolean } | null {
  const group = factoryGroupsState().groups.find(g => g.id === groupId);
  if (!group) return null;
  const nodes = groupChainNodes(groupId);
  // Topological ordering. Each round places the first pending node whose in-group suppliers are
  // all placed (making its own input does not count). When none qualifies there is a loop: place
  // the node with the fewest unplaced suppliers and record those inputs in loopSeeds, which the
  // stage text shows as "seed a starter batch".
  const makers = (item: string) => nodes.filter(node => node.outputs[item]);
  const placed: ChainNode[] = [],
    placedSet = new Set<string>(),
    loopSeeds = new Map<string, string[]>(),
    pending = [...nodes];
  while (pending.length) {
    let index = pending.findIndex(node =>
      Object.keys(node.inputs).every(item =>
        makers(item).every(maker => placedSet.has(maker.id) || maker === node),
      ),
    );
    let loop = false;
    if (index < 0) {
      let bestCount = Infinity;
      index = 0;
      pending.forEach((node, i) => {
        const unplaced = Object.keys(node.inputs).filter(item =>
          makers(item).some(maker => !placedSet.has(maker.id) && maker !== node),
        ).length;
        if (unplaced < bestCount) {
          bestCount = unplaced;
          index = i;
        }
      });
      loop = true;
    }
    // pending is not empty inside the loop, and idx is one of its indexes.
    const node = pending.splice(index, 1)[0]!;
    if (loop)
      loopSeeds.set(
        node.id,
        Object.keys(node.inputs).filter(item =>
          makers(item).some(maker => !placedSet.has(maker.id) && maker !== node),
        ),
      );
    placed.push(node);
    placedSet.add(node.id);
  }
  // Stage numbers by node id (every node is placed, so each has one), and every factory in the
  // phase, to count consumers outside the group.
  const stageNo = new Map(placed.map((node, i) => [node.id, i + 1]));
  const others: { id: string; inputs?: ItemRates }[] = calculated
    ? calcStage()?.rows || []
    : plan.factories
        .filter(f => f.stages[stage()])
        .map(f => ({ id: f.id, name: f.name, inputs: f.stages[stage()]!.inputs || {} }));
  const stages = placed.map((node, i): ChainStage => {
    // Needs: each input with the earliest in-group stage making it, "outside the group" when
    // none does, or the loop marker.
    const loopIns = loopSeeds.get(node.id) || [];
    const needs = Object.entries(node.inputs).map(([item, rate]) => {
      const from = makers(item).filter(maker => maker !== node);
      return {
        text: `${item} ${itemRate(item, rate)}`,
        loop: loopIns.includes(item),
        from: from.length
          ? 'stage ' + Math.min(...from.map(maker => stageNo.get(maker.id)!))
          : 'outside the group',
      };
    });
    // Feeds: in-group consumers by stage, plus a count of consuming factories outside the group.
    const feeds = Object.keys(node.outputs).map(item => {
      const inGroup = nodes
        .filter(consumer => consumer !== node && consumer.inputs[item])
        .map(consumer => `stage ${stageNo.get(consumer.id)} · ${consumer.name}`);
      const outside = others.filter(
        other =>
          other.id !== node.id &&
          other.inputs?.[item] &&
          !nodes.some(member => member.id === other.id),
      ).length;
      const parts = [...inGroup];
      if (outside)
        parts.push(`${outside} ${outside === 1 ? 'factory' : 'factories'} outside the group`);
      return `${item} → ${parts.join(' · ') || 'storage, export or sink'}`;
    });
    return {
      no: String(i + 1).padStart(2, '0'),
      id: node.id,
      link: node.link,
      name: node.name,
      machines: `${num(node.machines)} × ${node.machine}`,
      needs,
      feeds,
      power: !!node.mw,
    };
  });
  // A membership with an explicit rate is a production split; the chain still shows full totals.
  const split = nodes.some(node =>
    membershipsOf(node.id).some(m => m.group === groupId && m.rate != null),
  );
  return { name: group.name, stages, split };
}
