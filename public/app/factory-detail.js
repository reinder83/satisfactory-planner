// Detail dialogs in the shared #detail <dialog>. The factory dialogs (handbook and calculated)
// and a factory group's build order are components in ui/detail/, opened by openFactory,
// openCalculatedFactory and openGroupChain from the shared data-factory, data-calc-factory
// and group-header click handlers. dialog() fills #detail with HTML for the dialogs that are
// not components yet: the storage container (views/storage.js) and the wizard's alternate
// recipe (wizard/recipes.js).
import { $, itemIcon, num } from './format.js';
import { FLUIDS } from './flow.js';
import { html } from './html.js';
import { calcStage, calculated, plan, setActiveDetail, stage } from './session.js';
import { showDetail, unmountDetail } from './ui/detail.js';
import { factoryGroupsState, membershipsOf } from './views/factories.js';

// Fills the shared #detail <dialog> and opens it if it is not open yet, so following a link
// inside a dialog replaces its contents in place. Plain-string arguments are escaped: pass
// html`` for markup in `subtitle` or `body`. `icon` is an item name for the header icon.
export function dialog(title, subtitle, body, icon = '') {
  const d = $('#detail');
  unmountDetail();
  d.innerHTML = String(
    html`<header class="dialog-head">
        <div class="dialog-title">
          ${icon && html`<span class="dialog-icon">${itemIcon(icon)}</span>`}
          <div>
            <div class="eyebrow">${subtitle}</div>
            <h2>${title}</h2>
          </div>
        </div>
        <button class="close" aria-label="Close details" data-close>×</button>
      </header>
      <div class="dialog-body">${body}</div>`,
  );
  if (!d.open) d.showModal();
}

// The dialog for one handbook factory (ui/detail/FactoryDialog.vue); nothing for an unknown id.
export function openFactory(id) {
  if (!plan.factories.some(x => x.id === id)) return;
  setActiveDetail({ type: 'factory', id });
  showDetail({ kind: 'factory', id });
}

// The dialog for one row of a calculated plan (ui/detail/CalcFactoryDialog.vue).
export function openCalculatedFactory(id) {
  if (!calcStage().rows?.some(r => r.id === id)) return;
  setActiveDetail({ type: 'calc', id });
  showDetail({ kind: 'calc', id });
}

// The build-order dialog for a factory group (ui/detail/GroupChainDialog.vue).
export function openGroupChain(gid) {
  if (!factoryGroupsState().groups.some(g => g.id === gid)) return;
  setActiveDetail({ type: 'group', id: gid });
  showDetail({ kind: 'group', id: gid });
}

// The factories assigned to group `gid` that run in the current phase, in one shape for both
// profile kinds: { id, link, name, machine, machines, inputs, outputs } with total rates.
// Calculated rows also carry generationMW as `mw`; a handbook factory has a single output,
// its own item.
function groupChainNodes(gid) {
  if (calculated) {
    const x = calcStage();
    return (x.rows || [])
      .filter(r => membershipsOf(r.id).some(m => m.group === gid))
      .map(r => ({
        id: r.id,
        link: { calcFactory: r.id },
        name: r.name,
        machine: r.machine,
        machines: r.machines,
        inputs: r.inputs || {},
        outputs: r.outputs || {},
        mw: r.generationMW,
      }));
  }
  const st = stage();
  return plan.factories
    .filter(f => f.stages[st] && membershipsOf(f.id).some(m => m.group === gid))
    .map(f => {
      const r = f.stages[st];
      return {
        id: f.id,
        link: { factory: f.id },
        name: f.name,
        machine: r.machine,
        machines: r.machines,
        inputs: r.inputs || {},
        outputs: { [f.name]: r.output },
        recipe: r.recipe,
      };
    });
}

// A factory group's build order at the current phase: its factories as numbered stages,
// suppliers before consumers, each with what it needs (and from which stage) and what it feeds.
// Returns null for an unknown group, otherwise { name, stages, split }; `stages` is empty when
// no factory of the group produces anything in this phase. Each stage is { no, link, name,
// machines, needs: [{ text, from, loop }], feeds: [text], power }.
export function groupChain(gid) {
  const gr = factoryGroupsState().groups.find(g => g.id === gid);
  if (!gr) return null;
  const nodes = groupChainNodes(gid);
  // Topological ordering. Each round places the first pending node whose in-group suppliers are
  // all placed (making its own input does not count). When none qualifies there is a loop: place
  // the node with the fewest unplaced suppliers and record those inputs in loopSeeds, which the
  // stage text shows as "seed a starter batch".
  const makers = n => nodes.filter(o => o.outputs[n]);
  const placed = [],
    placedSet = new Set(),
    loopSeeds = new Map(),
    pending = [...nodes];
  while (pending.length) {
    let idx = pending.findIndex(nd =>
      Object.keys(nd.inputs).every(n => makers(n).every(m => placedSet.has(m.id) || m === nd)),
    );
    let loop = false;
    if (idx < 0) {
      let bestCount = Infinity;
      idx = 0;
      pending.forEach((nd, i) => {
        const c = Object.keys(nd.inputs).filter(n =>
          makers(n).some(m => !placedSet.has(m.id) && m !== nd),
        ).length;
        if (c < bestCount) {
          bestCount = c;
          idx = i;
        }
      });
      loop = true;
    }
    const nd = pending.splice(idx, 1)[0];
    if (loop)
      loopSeeds.set(
        nd.id,
        Object.keys(nd.inputs).filter(n => makers(n).some(m => !placedSet.has(m.id) && m !== nd)),
      );
    placed.push(nd);
    placedSet.add(nd.id);
  }
  // Stage numbers by node id, and every factory in the phase, to count consumers outside the group.
  const stageNo = new Map(placed.map((nd, i) => [nd.id, i + 1]));
  const others = calculated
    ? calcStage().rows || []
    : plan.factories
        .filter(f => f.stages[stage()])
        .map(f => ({ id: f.id, name: f.name, inputs: f.stages[stage()].inputs || {} }));
  const stages = placed.map((nd, i) => {
    // Needs: each input with the earliest in-group stage making it, "outside the group" when
    // none does, or the loop marker.
    const loopIns = loopSeeds.get(nd.id) || [];
    const needs = Object.entries(nd.inputs).map(([n, q]) => {
      const from = makers(n).filter(m => m !== nd);
      return {
        text: `${n} ${num(q)}${FLUIDS.has(n) ? ' m³' : ''}/min`,
        loop: loopIns.includes(n),
        from: from.length
          ? 'stage ' + Math.min(...from.map(m => stageNo.get(m.id)))
          : 'outside the group',
      };
    });
    // Feeds: in-group consumers by stage, plus a count of consuming factories outside the group.
    const feeds = Object.keys(nd.outputs).map(n => {
      const inGroup = nodes
        .filter(o => o !== nd && o.inputs[n])
        .map(o => `stage ${stageNo.get(o.id)} · ${o.name}`);
      const outside = others.filter(
        o => o.id !== nd.id && o.inputs?.[n] && !nodes.some(g => g.id === o.id),
      ).length;
      const parts = [...inGroup];
      if (outside)
        parts.push(`${outside} ${outside === 1 ? 'factory' : 'factories'} outside the group`);
      return `${n} → ${parts.join(' · ') || 'storage, export or sink'}`;
    });
    return {
      no: String(i + 1).padStart(2, '0'),
      id: nd.id,
      link: nd.link,
      name: nd.name,
      machines: `${num(nd.machines)} × ${nd.machine}`,
      needs,
      feeds,
      power: !!nd.mw,
    };
  });
  // A membership with an explicit rate is a production split; the chain still shows full totals.
  const split = nodes.some(nd => membershipsOf(nd.id).some(m => m.group === gid && m.rate != null));
  return { name: gr.name, stages, split };
}
