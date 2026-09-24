// Production flow of a factory: belts, pipes, inputs, outputs and lane advice.
// A flow model is a plain object describing one factory at one phase: what comes in (with the
// belts or pipes that carry it), the machine bar, and where the output goes. It is built either
// from the original handbook (handbookFlowModel, plan.json factories) or from a calculated plan
// (calcFlowModel, planner rows), and rendered by flowHtml and laneAdviceHtml. Fields that carry markup (link, attr, local, bar.outTxt,
// bankNote) are Html; the rest are text. The factory
// dialogs in factory-detail.js and views/calculated.js are the callers.
import { itemIcon, num, num3 } from './format.js';
import { html, raw } from './html.js';
import {
  calcStage,
  calculated,
  checked,
  phaseLabel,
  plan,
  progressionData,
  stage,
} from './session.js';
import { power } from './wizard/fields.js';

// Belt/pipe logistics. Capacities are game constants; the unlocking milestone (tier, name) comes from progression.json.
// Items that travel by pipe: rates for these are m³/min instead of items/min. Matches the items
// marked fluid in recipes.json.
export const FLUIDS = new Set([
  'Fuel',
  'Rocket Fuel',
  'Nitric Acid',
  'Turbofuel',
  'Ionized Fuel',
  'Dark Matter Residue',
  'Excited Photonic Matter',
  'Heavy Oil Residue',
  'Alumina Solution',
  'Sulfuric Acid',
  'Dissolved Silica',
  'Nitrogen Gas',
  'Water',
  'Crude Oil',
  'Liquid Biofuel',
]);

// Conveyor belt marks in unlock order. cap is items/min per belt; entry is the progression.json
// milestone id that unlocks the mark.
const BELT_LANES = [
  { mark: 'Mk.1', cap: 60, entry: 'Schematic_1-2_C' },
  { mark: 'Mk.2', cap: 120, entry: 'Schematic_3-2_C' },
  { mark: 'Mk.3', cap: 270, entry: 'Schematic_5-3_C' },
  { mark: 'Mk.4', cap: 480, entry: 'Schematic_6-1_C' },
  { mark: 'Mk.5', cap: 780, entry: 'Schematic_7-2_C' },
  { mark: 'Mk.6', cap: 1200, entry: 'Schematic_9-5_C' },
];

// Pipeline marks, same shape as BELT_LANES; cap is m³/min per pipe.
const PIPE_LANES = [
  { mark: 'Mk.1', cap: 300, entry: 'Schematic_3-1_C' },
  { mark: 'Mk.2', cap: 600, entry: 'Schematic_6-5_C' },
];

// Oil-campus recipes per machine at 100%, per minute; values from the bundled recipes.json dataset.
// Keyed by the recipe names in plan.json plans[phase].oil; `in`/`out` map item to rate (fluids in
// m³/min). Only the handbook's shared oil campus (oilDetail in factory-detail.js) reads it.
export const OIL_RECIPES = {
  Plastic: { in: { 'Crude Oil': 30 }, out: { Plastic: 20, 'Heavy Oil Residue': 10 } },
  Rubber: { in: { 'Crude Oil': 30 }, out: { Rubber: 20, 'Heavy Oil Residue': 20 } },
  'Residual Fuel': { in: { 'Heavy Oil Residue': 60 }, out: { Fuel: 40 } },
  'Residual Rubber': { in: { 'Polymer Resin': 40, Water: 40 }, out: { Rubber: 20 } },
  'Alternate: Heavy Oil Residue': {
    in: { 'Crude Oil': 30 },
    out: { 'Heavy Oil Residue': 40, 'Polymer Resin': 20 },
  },
  'Alternate: Diluted Fuel': { in: { 'Heavy Oil Residue': 50, Water: 100 }, out: { Fuel: 100 } },
  'Alternate: Recycled Plastic': { in: { Rubber: 30, Fuel: 30 }, out: { Plastic: 60 } },
  'Alternate: Recycled Rubber': { in: { Plastic: 30, Fuel: 30 }, out: { Rubber: 60 } },
};

// The planner phase in which a milestone tier becomes available: Tiers 1–2 are Phase 1, 3–4
// Phase 2, 5–6 Phase 3, 7–8 Phase 4 and 9 Phase 5.
const phaseForLaneTier = t => (t <= 2 ? 1 : t <= 4 ? 2 : t <= 6 ? 3 : t <= 8 ? 4 : 5);

// The milestone that unlocks a belt or pipe mark: its name, tier, the phase it belongs to and
// whether the user has ticked its `unlock-<id>` step. Null when progression.json lacks the entry.
function laneMilestone(l) {
  const e = progressionData?.entries.find(x => x.id === l.entry);
  return e
    ? {
        name: e.name,
        tier: e.tier,
        phase: phaseForLaneTier(e.tier),
        marked: checked('unlock-' + e.id),
      }
    : null;
}

// The highest belt (or pipe) mark available at phase `st` (default: the current stage). A mark
// counts as available when its milestone is ticked, belongs to this phase or earlier, or is
// unknown; Mk.1 is the fallback. Returns the lane with its display unit, its milestone and the
// next mark up (with that mark's milestone), which laneAdviceHtml mentions as the next upgrade.
function bestLane(fluid, st) {
  const lanes = fluid ? PIPE_LANES : BELT_LANES;
  const stageNo = Number(st ?? stage());
  let best = lanes[0],
    ms = laneMilestone(lanes[0]);
  for (const l of lanes) {
    const m = laneMilestone(l);
    if (!m || m.marked || m.phase <= stageNo) {
      best = l;
      ms = m;
    }
  }
  const next = lanes[lanes.indexOf(best) + 1];
  return {
    ...best,
    fluid,
    unit: fluid ? ' m³/min' : '/min',
    milestone: ms,
    next: next ? { ...next, milestone: laneMilestone(next) } : null,
  };
}

// How many belts or pipes of the best available mark carry `rate`. Returns the lane, the lane
// count (at least 1), the rate on the last lane, how many lanes run full, the unused capacity
// (all of it on the last lane) and the word to print. The 1e-9 keeps an exact multiple of the
// capacity from rounding up to an extra lane through floating-point noise.
export function lanePlan(rate, fluid, st) {
  const lane = bestLane(fluid, st);
  const count = Math.max(1, Math.ceil(rate / lane.cap - 1e-9));
  const last = rate - (count - 1) * lane.cap;
  return {
    lane,
    count,
    last,
    full: count - (last < lane.cap - 1e-9 ? 1 : 0),
    spare: count * lane.cap - rate,
    word: fluid ? 'pipe' : 'belt',
  };
}

// "1 of the 12 Refineries" or "1 × Refinery": the recipe panel's rates are for one machine.
// The y→ie swap pluralises Refinery and Foundry.
export const machinesLabel = (count, machine) =>
  count > 1 ? `1 of the ${num(count)} ${machine.replace(/y$/, 'ie')}s` : `1 × ${machine}`;

// One item cell of a recipe panel: [item name, rate, optional data-* attribute (Html)]. The
// attribute turns the cell into a button that opens the factory making that item. The pseudo item
// 'MW' is a generator's power output. `out` styles it as an output.
export function recipeCell([n, q, link], out) {
  const inner = html`${n !== 'MW' && itemIcon(n)}<span class="rail-main"
      ><b>${num3(q)}${FLUIDS.has(n) ? ' m³' : n === 'MW' ? ' MW' : ''}</b
      ><small>${n === 'MW' ? 'Power generation' : n}</small></span
    >`;
  return link
    ? html`<button class="rail-cell${out ? ' out' : ''}" ${link}>${inner}</button>`
    : html`<div class="rail-cell${out ? ' out' : ''}">${inner}</div>`;
}

// The "Recipe · …" panel: per-machine inputs → outputs at 100%. Reads m.recipe ({name, machine,
// ins, outs}, with ins/outs as recipeCell tuples) and m.machineCount. Also used by the alternate
// recipe dialog in wizard/recipes.js, which passes a minimal model of just those two fields.
export function recipePanelHtml(m) {
  const rc = m.recipe;
  if (!rc) return '';
  return html`<div class="rail-recipe">
    <div class="rail-recipe-head">
      <span>Recipe · ${rc.name}</span
      ><span>what ${machinesLabel(m.machineCount, rc.machine)} makes @ 100% · per minute</span>
    </div>
    <div class="rail-recipe-body">
      <div class="rail-recipe-ins">
        ${rc.ins.length
          ? rc.ins.map(x => recipeCell(x))
          : html`<div class="rail-cell">
              <span class="rail-main"><small>No belt or pipe inputs</small></span>
            </div>`}
      </div>
      <span class="rail-recipe-arrow">→</span>
      <div class="rail-recipe-outs">${rc.outs.map(x => recipeCell(x, true))}</div>
    </div>
  </div>`;
}

// Renders a flow model as the "Flow at Phase N" section: recipe panel, input tiles, the machine
// bar, then one row per destination. Empty when the model has neither inputs nor outputs.
export function flowHtml(m) {
  if (!m || (!m.inputs.length && !m.outputs.length)) return '';
  // An input tile: item, lane count and mark, and how full those lanes are. 70% load or more is
  // highlighted as a line with little headroom.
  const inTile = i => {
    const p = i.plan,
      load = Math.round((i.rate / (p.count * p.lane.cap)) * 100);
    const inner = html`${itemIcon(i.name)}<span class="rail-main"
        ><b>${i.name}</b
        ><small ${load >= 70 && raw('class="hot"')}
          >${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 && 's'} · ${load}% load</small
        ></span
      ><span class="rail-rate">${num(i.rate)}<small>${p.lane.unit}</small></span>`;
    return i.link
      ? html`<button class="rail-tile" ${i.link}>${inner}</button>`
      : html`<div class="rail-tile">${inner}</div>`;
  };
  // A destination row. `kind` picks the caption: consumer (another factory), store (protected
  // storage), ship (elevator, power fleet, augmenters…), drone (fuel contract), sink (surplus to
  // the AWESOME Sink) or more (the rows capFlowOutputs folded together). `mach` is how many
  // machines' worth of output the destination takes; it is absent where that cannot be split.
  const outRow = o => {
    const subs = {
      consumer: `consumer${o.beltTxt ? ' · ' + o.beltTxt : ''}`,
      store: 'protected module',
      ship: o.shipSub || 'delivery',
      drone: 'protected supply contract',
      sink: o.subTxt || 'whole-machine rounding surplus',
      more: 'combined smaller destinations',
    };
    const name = o.link
      ? html`<button class="rail-link" ${o.link}>${o.label} ↗</button>`
      : html`<b class="${o.kind === 'sink' || o.kind === 'more' ? 'dim' : ''}">${o.label}</b>`;
    // Machines are rounded up per destination; under half a machine reads "<1".
    const machCol =
      o.mach === undefined
        ? html`<span class="rail-mach"></span>`
        : html`<span class="rail-mach"
            ><b>≈ ${o.mach < 0.5 ? '<1' : num(Math.ceil(o.mach - 1e-9))}</b> ×
            ${m.machineName}<small
              >${num(o.mach)} at 100% · ${m.local ? 'build beside it' : 'round up'}</small
            ></span
          >`;
    const rate =
      o.rateTxt ??
      (o.rate !== undefined ? html`${num(o.rate)}<small>${o.unit || '/min'}</small>` : '');
    return html`<div class="rail-row ${o.kind}">
      ${o.icon ? itemIcon(o.icon) : html`<span class="rail-noicon"></span>`}<span class="rail-main"
        >${name}<small>${o.pre && o.pre + ' · '}${subs[o.kind] || ''}</small></span
      >${machCol}<span class="rail-rate">${rate}</span>
    </div>`;
  };
  // The machine bar between inputs and outputs. m.bar's fields are Html or text.
  const bar =
    m.bar &&
    html`${m.inputs.length > 0 && html`<div class="rail-arrow">↓</div>`}
      <div class="rail-machine">
        <div class="rail-machine-main">
          <b>${num(m.machineCount)} × ${m.machineName}</b><small>${m.bar.sub}</small>
        </div>
        <div class="rail-machine-out"><b>${m.bar.outTxt}</b><small>${m.bar.outSub}</small></div>
      </div>
      ${m.outputs.length > 0 && html`<div class="rail-arrow">↓</div>`}`;
  return html`<h3>Flow at ${phaseLabel(m.stage)}</h3>
    ${recipePanelHtml(m)}
    ${m.inputs.length > 0 &&
    html`<div class="rail-cap">
        Inputs · ${m.inputs.length} line${m.inputs.length > 1 && 's'} in
      </div>
      <div class="rail-grid">${m.inputs.map(inTile)}</div>`}
    ${bar}
    ${m.outputs.length > 0 &&
    html`<div class="rail-caps">
        <span class="rail-cap">Delivers · ${phaseLabel(m.stage)}</span>${m.outputs.some(
          o => o.mach !== undefined,
        ) &&
        html`<span class="rail-cap">Machines per delivery · ${num(m.machineCount)} total</span>`}
      </div>
      <div class="rail-rows">${m.outputs.map(outRow)}</div>
      ${m.bankNote}`}`;
}

// Keeps a destination list to at most ten rows: past that, the first nine stay and the rest become
// one "+ N more destinations" row carrying their summed rate. Order is the caller's, so whatever
// sorts last is what gets folded.
function capFlowOutputs(list, unit = '/min') {
  if (list.length <= 10) return list;
  const rest = list.slice(9),
    sum = rest.reduce((s, x) => s + (x.rate || 0), 0);
  return [
    ...list.slice(0, 9),
    { kind: 'more', label: `+ ${rest.length} more destinations`, rate: sum, unit },
  ];
}

// The "Belts & pipes" section: for every input, how many lanes it needs, how many machines one
// lane can feed (manifold rows), and whether the last lane's spare capacity could also carry
// another factory's demand for the same item (m.sameItemConsumers). Empty without inputs.
export function laneAdviceHtml(m) {
  if (!m || !m.inputs.length) return '';
  const belts = bestLane(false, m.stage),
    pipes = bestLane(true, m.stage);
  const nextNote = belts.next?.milestone
    ? ` ${belts.next.mark} belts (${num(belts.next.cap)}/min) unlock at Tier ${belts.next.milestone.tier} · ${belts.next.milestone.name} in Phase ${belts.next.milestone.phase}.`
    : '';
  const row = i => {
    // per: what one machine at 100% draws; fed: how many such machines one full lane supplies.
    const p = i.plan,
      l = p.lane,
      per = i.rate / m.equivalent,
      fed = Math.floor(l.cap / per + 1e-9);
    const lanes = `${p.count} × ${l.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
    const parts = [
      html`<b>${num(i.rate)}${l.unit}</b> → <b>${lanes}</b>${p.count > 1
          ? ` — ${p.full} full + 1 carrying ${num(p.last)}${l.unit}`
          : ` (${Math.round((i.rate / l.cap) * 100)}% of ${num(l.cap)}${l.unit})`}.`,
    ];
    if (m.machineCount > 1)
      parts.push(
        fed < 1
          ? `Each machine takes ${num(per)}${l.unit} — more than one ${l.mark} ${p.word} carries, so give machines dedicated feeds.`
          : m.machineCount > fed
            ? html`One full ${l.mark} ${p.word} feeds
                <b>${fed} of the ${num(m.machineCount)} machines</b> (${num(per)}${l.unit} each) —
                plan manifold rows of ${fed}.`
            : `One ${l.mark} ${p.word} feeds all ${num(m.machineCount)} machines (${num(per)}${l.unit} each).`,
      );
    // Other factories whose whole demand for this item fits in the spare capacity; at most two
    // are offered as links, joined by " or ".
    if (p.count > 1 && p.spare > 0.01) {
      const merge = m
        .sameItemConsumers(i.name)
        .filter(x => x.rate <= p.spare + 0.01)
        .slice(0, 2)
        .map(
          x =>
            html`<button class="btn quiet" ${x.attr}>
              ${x.label} (${num(x.rate)}${l.unit}) ↗
            </button>`,
        );
      parts.push(
        html`The last ${p.word} has <b>${num(p.spare)}${l.unit} spare</b> —
          ${merge.length
            ? html`enough to also carry ${merge.flatMap((b, n) => (n ? [' or ', b] : [b]))} from the
              same bus`
            : 'keep it as expansion headroom on this manifold'}.`,
      );
    }
    if (i.local) parts.push(i.local);
    return html`<div class="logi-row">
      ${itemIcon(i.name)}
      <div><b>${i.name}</b>${parts.map(t => html`<p>${t}</p>`)}</div>
    </div>`;
  };
  return html`<h3>Belts &amp; pipes</h3>
    <p class="small muted">
      ${phaseLabel(m.stage)} milestones give ${belts.mark} belts (${num(belts.cap)}/min) and
      ${pipes.mark} pipes (${num(pipes.cap)} m³/min).${nextNote} If a milestone is not unlocked in
      your save yet, plan with the earlier mark.
    </p>
    <div class="logi">${m.inputs.map(row)}</div>`;
}

// Flow model for an original-handbook factory (plan.json). `f` is the factory, `st` the phase key,
// `r` its stage record (output, demand, storage, delivery, inputs, machines, lastClock, machine,
// recipe) and `localInput(name)` returns the local factory that makes that input on site, if any.
// A handbook factory makes one item; its destinations are the other handbook factories that list
// it as an input in the same phase, plus its storage refill, elevator delivery and any surplus.
// `bankOnly` (the oil campus products) keeps only the destinations: no inputs, recipe panel, bar
// or machine counts, because factory-detail.js draws the campus itself.
// Returns { stage, inputs, outputs, equivalent, machineCount, machineName, local, recipe, bar,
// sameItemConsumers }; links use data-factory="<handbook id>".
export function handbookFlowModel(f, st, r, localInput, bankOnly = false) {
  const fluidOut = FLUIDS.has(f.name);
  const unit = fluidOut ? ' m³/min' : '/min';
  // Machine equivalents: all at 100% except the last at lastClock. The floor keeps perOut finite
  // for the oil products, which record 0 machines.
  const eq = Math.max(r.machines - 1 + (r.lastClock ?? 100) / 100, 0.01);
  const perOut = r.output / eq;
  const beltTxt = p => `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
  const mach = q => (bankOnly ? undefined : q / perOut);
  // Destinations: every other factory consuming this item in this phase, largest first.
  const consumers = plan.factories
    .filter(o => o.id !== f.id && o.stages[st]?.inputs?.[f.name])
    .map(o => {
      const q = o.stages[st].inputs[f.name];
      return {
        kind: 'consumer',
        label: o.name,
        icon: o.name,
        link: html`data-factory="${o.id}"`,
        rate: q,
        unit,
        mach: mach(q),
        beltTxt: f.local ? 'made on site' : beltTxt(lanePlan(q, fluidOut, st)),
      };
    })
    .sort((a, b) => b.rate - a.rate);
  // Then the non-factory destinations. Nuclear parts nobody else consumes go to the power fleet,
  // which the handbook plans on the resources page rather than as a factory.
  const outputs = [...consumers];
  if (f.nuclear && !consumers.length)
    outputs.push({
      kind: 'ship',
      label: 'Nuclear power fleet',
      shipSub: 'planned in Power & resources',
      icon: f.name,
      rateTxt: '',
    });
  if (r.storage)
    outputs.push({
      kind: 'store',
      label: 'Storage refill',
      icon: f.name,
      rate: r.storage,
      unit,
      mach: mach(r.storage),
    });
  if (r.delivery)
    outputs.push({
      kind: 'ship',
      label: 'Space Elevator delivery',
      icon: f.name,
      rate: r.delivery,
      unit,
      mach: mach(r.delivery),
    });
  // Output above the stage's recorded demand is whole-machine rounding surplus, bound for the
  // sink. The 0.002/min threshold hides floating-point leftovers.
  const surplus = Math.max(0, r.output - (r.demand ?? r.output));
  if (surplus > 0.002)
    outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: f.name, rate: surplus, unit });
  // Inputs, each with its lane plan. The link prefers a local factory making it on site, otherwise
  // the handbook factory producing the item in this phase; local ones also get a button with the
  // machines to build beside this factory (stage `rate` is one local machine's output).
  const inputs = bankOnly
    ? []
    : Object.entries(r.inputs || {}).map(([n, q]) => {
        const lp = localInput(n);
        const src = lp || plan.factories.find(x => x.name === n && x.stages[st]);
        return {
          name: n,
          rate: q,
          link: src ? html`data-factory="${src.id}"` : '',
          plan: lanePlan(q, FLUIDS.has(n), st),
          local: lp
            ? html`<button class="btn quiet" data-factory="${lp.id}">
                Local: ≈ ${num(Math.ceil(q / lp.stages[st].rate))} × ${lp.stages[st].machine} at
                this site ↗
              </button>`
            : '',
        };
      });
  // With more than one destination, the bar suggests how the machines split between them.
  const capped = capFlowOutputs(outputs, unit);
  const splits = capped.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const splitTxt =
    splits.length > 1
      ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach - 1e-9))).join(' / ')} across the deliveries below`
      : '';
  // The handbook records the last machine's clock, so it is printed as a figure.
  const clock =
    (r.lastClock ?? 100) < 100 ? `@ 100% except the last at ${num(r.lastClock)}%` : '@ 100%';
  return {
    stage: st,
    inputs,
    outputs: capped,
    equivalent: eq,
    machineCount: r.machines,
    machineName: r.machine,
    local: !!f.local,
    recipe: bankOnly
      ? null
      : {
          name: String(r.recipe || '').replace('Alternate: ', ''),
          machine: r.machine,
          ins: inputs.map(i => [i.name, i.rate / eq, i.link]),
          outs: [[f.name, perOut]],
        },
    bar: bankOnly
      ? null
      : {
          sub: `${String(r.recipe || '').replace('Alternate: ', '')} · ${clock} · ${num3(perOut)} ${f.name}/min out per machine${splitTxt}${f.local ? ' · built beside the consumers' : ''}`,
          outTxt: html`${num(r.output)}<small>${unit}</small>`,
          outSub: f.local
            ? 'out · distributed'
            : 'out · ' + beltTxt(lanePlan(r.output, fluidOut, st)),
        },
    // Other factories consuming item `n` this phase, for laneAdviceHtml's spare-lane suggestion.
    sameItemConsumers: n =>
      plan.factories
        .filter(o => o.id !== f.id && o.stages[st]?.inputs?.[n])
        .map(o => ({
          label: o.name,
          rate: o.stages[st].inputs[n],
          attr: html`data-factory="${o.id}"`,
        })),
  };
}

// Flow model for a row of a calculated plan, at the current phase. `r` is a row of
// calcStage().rows from planner.mjs: inputs and outputs are totals for the whole row (per-machine
// rate × equivalent), and a row may have several outputs (byproducts) or none (a generator, with
// generationMW). Unlike the handbook, destinations come from the phase's plan-wide books:
// consuming rows, storage, delivery, drone fuel, augmenter fuel, extra cells, plutonium and
// surplus sinks. Those are totals for the item, not this row's share, when several rows make it
// (bankNote says so). Same return shape as handbookFlowModel plus bankNote; links use
// data-calc-factory="<row id>".
export function calcFlowModel(r) {
  const x = calcStage(),
    st = stage(),
    multi = Object.keys(r.outputs || {}).length > 1;
  const eq = Math.max(r.equivalent || r.machines - 1 + (r.lastClock ?? 100) / 100 || 1, 0.01);
  const beltTxt = p => `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
  const outputs = [];
  // One pass per output item. With byproducts, every row is prefixed with its item name and no
  // machine counts are given, since the same machines make all the outputs at once.
  for (const n of Object.keys(r.outputs || {})) {
    const fluid = FLUIDS.has(n),
      unit = fluid ? ' m³/min' : '/min',
      pre = multi ? n : '',
      perOut = r.outputs[n] / eq;
    const mach = q => (multi ? undefined : q / perOut);
    for (const o of (x.rows || []).filter(o => o.id !== r.id && o.inputs?.[n]))
      outputs.push({
        kind: 'consumer',
        label: o.name,
        icon: Object.keys(o.outputs || {})[0] || n,
        link: html`data-calc-factory="${o.id}"`,
        rate: o.inputs[n],
        unit,
        pre,
        mach: mach(o.inputs[n]),
        beltTxt: beltTxt(lanePlan(o.inputs[n], fluid, st)),
      });
    if (x.storage?.[n])
      outputs.push({
        kind: 'store',
        label: 'Protected storage',
        icon: n,
        rate: x.storage[n],
        unit,
        pre,
        mach: mach(x.storage[n]),
      });
    if (x.delivery?.[n]?.rate)
      outputs.push({
        kind: 'ship',
        label: 'Space Elevator delivery',
        icon: n,
        rate: x.delivery[n].rate,
        unit,
        pre,
        mach: mach(x.delivery[n].rate),
      });
    if (x.drone?.[n])
      outputs.push({
        kind: 'drone',
        label: 'Drone fuel contract',
        icon: n,
        rate: x.drone[n],
        unit,
        pre,
        mach: mach(x.drone[n]),
      });
    // Phase 5 extras the planner reserves on top of factory demand: matrix for fueled Alien Power
    // Augmenters, and the configured extra Singularity Cells.
    if (st === '5' && n === 'Alien Power Matrix' && x.matrixRate)
      outputs.push({
        kind: 'ship',
        label: 'Alien Power Augmenter fuel',
        shipSub:
          num(calculated.settings.fueledAugmenters) +
          ' fueled augmenter' +
          (calculated.settings.fueledAugmenters > 1 ? 's' : ''),
        icon: n,
        rate: x.matrixRate,
        unit,
        pre,
        mach: mach(x.matrixRate),
      });
    if (st === '5' && n === 'Singularity Cell' && calculated.settings.cellsPerMinute)
      outputs.push({
        kind: 'ship',
        label: 'Extra Singularity Cells',
        shipSub: 'configured portal supply',
        icon: n,
        rate: calculated.settings.cellsPerMinute,
        unit,
        pre,
        mach: mach(calculated.settings.cellsPerMinute),
      });
    // Plutonium rods the waste strategy sinks, then the plan's surplus for the item. The planner
    // leaves fluids, radioactive and unsinkable items out of `surplus`, so they never show here.
    if (n === 'Plutonium Fuel Rod' && x.plutoniumSink)
      outputs.push({
        kind: 'sink',
        label: 'AWESOME Sink',
        subTxt: 'waste strategy — sink these rods',
        icon: n,
        rate: x.plutoniumSink,
        unit,
        pre,
      });
    if (x.surplus?.[n] > 0.002)
      outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: n, rate: x.surplus[n], unit, pre });
  }
  // A generator row has no item outputs; its one destination is the power grid.
  outputs.sort((a, b) => (b.rate || 0) - (a.rate || 0));
  if (!outputs.length && r.generationMW)
    outputs.push({
      kind: 'ship',
      label: 'Power grid',
      shipSub: 'generation',
      rateTxt: power(r.generationMW),
    });
  // Inputs link to the first other row producing the item; there may be more than one.
  const inputs = Object.entries(r.inputs || {}).map(([n, q]) => {
    const src = (x.rows || []).find(o => o.id !== r.id && o.outputs?.[n]);
    return {
      name: n,
      rate: q,
      link: src ? html`data-calc-factory="${src.id}"` : '',
      plan: lanePlan(q, FLUIDS.has(n), st),
    };
  });
  const outName = Object.keys(r.outputs || {})[0];
  const capped = capFlowOutputs(outputs);
  const splits = capped.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const splitTxt =
    splits.length > 1
      ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach - 1e-9))).join(' / ')} across the deliveries below`
      : '';
  // A calculated row is whole machines at 100% plus, when the equivalent is fractional, one
  // adjustable machine; its clock is in the dialog's Machine setup table. `shared` is true when
  // another row makes one of the same items, which the bank note mentions.
  const clock = r.machines - eq > 1e-7 ? '@ 100% + 1 adjustable' : '@ 100%';
  const shared = Object.keys(r.outputs || {}).some(n =>
    (x.rows || []).some(o => o.id !== r.id && o.outputs?.[n]),
  );
  return {
    stage: st,
    inputs,
    outputs: capped,
    equivalent: eq,
    machineCount: r.machines,
    machineName: r.machine,
    local: false,
    // Per-machine rates for the recipe panel; a generator's single cell is its MW.
    recipe: {
      name: r.name,
      machine: r.machine,
      ins: inputs.map(i => [i.name, i.rate / eq, i.link]),
      outs: outName
        ? Object.entries(r.outputs).map(([n, q]) => [n, q / eq])
        : [['MW', r.generationMW / eq]],
    },
    bar: {
      sub: `${r.name} · ${clock}${outName && !multi ? ` · ${num3(r.outputs[outName] / eq)} ${outName}/min out per machine` : ''}${splitTxt}`,
      outTxt: outName
        ? html`${num(r.outputs[outName])}<small>${FLUIDS.has(outName) ? ' m³/min' : '/min'}</small>`
        : power(r.generationMW),
      outSub: outName
        ? multi
          ? 'out · ' + outName + ' + byproducts'
          : 'out · ' + beltTxt(lanePlan(r.outputs[outName], FLUIDS.has(outName), st))
        : 'generation',
    },
    // Consumer, storage and delivery rates are the item's plan-wide demand, not this row's share.
    bankNote: outputs.length
      ? html`<p class="small muted">
          Demand for the item across this phase's whole
          plan${shared ? ', supplied together with the other recipes producing it' : ''}.
        </p>`
      : '',
    sameItemConsumers: n =>
      (x.rows || [])
        .filter(o => o.id !== r.id && o.inputs?.[n])
        .map(o => ({ label: o.name, rate: o.inputs[n], attr: html`data-calc-factory="${o.id}"` })),
  };
}
