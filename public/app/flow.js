// Production flow of a factory: belts, pipes, inputs, outputs and lane advice.
import { esc, itemIcon, num, num3 } from './format.js';
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

const BELT_LANES = [
  { mark: 'Mk.1', cap: 60, entry: 'Schematic_1-2_C' },
  { mark: 'Mk.2', cap: 120, entry: 'Schematic_3-2_C' },
  { mark: 'Mk.3', cap: 270, entry: 'Schematic_5-3_C' },
  { mark: 'Mk.4', cap: 480, entry: 'Schematic_6-1_C' },
  { mark: 'Mk.5', cap: 780, entry: 'Schematic_7-2_C' },
  { mark: 'Mk.6', cap: 1200, entry: 'Schematic_9-5_C' },
];

const PIPE_LANES = [
  { mark: 'Mk.1', cap: 300, entry: 'Schematic_3-1_C' },
  { mark: 'Mk.2', cap: 600, entry: 'Schematic_6-5_C' },
];

// Oil-campus recipes per machine at 100%, per minute; values from the bundled recipes.json dataset.
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

const phaseForLaneTier = t => (t <= 2 ? 1 : t <= 4 ? 2 : t <= 6 ? 3 : t <= 8 ? 4 : 5);

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

export const machinesLabel = (count, machine) =>
  count > 1 ? `1 of the ${num(count)} ${esc(machine.replace(/y$/, 'ie'))}s` : `1 × ${esc(machine)}`;

export function recipeCell([n, q, link], out) {
  const inner = `${n === 'MW' ? '' : itemIcon(n)}<span class="rail-main"><b>${num3(q)}${FLUIDS.has(n) ? ' m³' : n === 'MW' ? ' MW' : ''}</b><small>${n === 'MW' ? 'Power generation' : esc(n)}</small></span>`;
  return link
    ? `<button class="rail-cell${out ? ' out' : ''}" ${link}>${inner}</button>`
    : `<div class="rail-cell${out ? ' out' : ''}">${inner}</div>`;
}

export function recipePanelHtml(m) {
  const rc = m.recipe;
  if (!rc) return '';
  return `<div class="rail-recipe"><div class="rail-recipe-head"><span>Recipe · ${esc(rc.name)}</span><span>what ${machinesLabel(m.machineCount, rc.machine)} makes @ 100% · per minute</span></div><div class="rail-recipe-body"><div class="rail-recipe-ins">${rc.ins.map(x => recipeCell(x)).join('') || '<div class="rail-cell"><span class="rail-main"><small>No belt or pipe inputs</small></span></div>'}</div><span class="rail-recipe-arrow">→</span><div class="rail-recipe-outs">${rc.outs.map(x => recipeCell(x, true)).join('')}</div></div></div>`;
}

export function flowHtml(m) {
  if (!m || (!m.inputs.length && !m.outputs.length)) return '';
  const inTile = i => {
    const p = i.plan,
      load = Math.round((i.rate / (p.count * p.lane.cap)) * 100);
    const inner = `${itemIcon(i.name)}<span class="rail-main"><b>${esc(i.name)}</b><small${load >= 70 ? ' class="hot"' : ''}>${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''} · ${load}% load</small></span><span class="rail-rate">${num(i.rate)}<small>${p.lane.unit}</small></span>`;
    return i.link
      ? `<button class="rail-tile" ${i.link}>${inner}</button>`
      : `<div class="rail-tile">${inner}</div>`;
  };
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
      ? `<button class="rail-link" ${o.link}>${esc(o.label)} ↗</button>`
      : `<b class="${o.kind === 'sink' || o.kind === 'more' ? 'dim' : ''}">${esc(o.label)}</b>`;
    const machCol =
      o.mach === undefined
        ? '<span class="rail-mach"></span>'
        : `<span class="rail-mach"><b>≈ ${o.mach < 0.5 ? '<1' : num(Math.ceil(o.mach - 1e-9))}</b> × ${esc(m.machineName)}<small>${num(o.mach)} at 100% · ${m.local ? 'build beside it' : 'round up'}</small></span>`;
    const rate =
      o.rateTxt ?? (o.rate !== undefined ? `${num(o.rate)}<small>${o.unit || '/min'}</small>` : '');
    return `<div class="rail-row ${o.kind}">${o.icon ? itemIcon(o.icon) : '<span class="rail-noicon"></span>'}<span class="rail-main">${name}<small>${o.pre ? esc(o.pre) + ' · ' : ''}${subs[o.kind] || ''}</small></span>${machCol}<span class="rail-rate">${rate}</span></div>`;
  };
  const bar = m.bar
    ? `${m.inputs.length ? '<div class="rail-arrow">↓</div>' : ''}<div class="rail-machine"><div class="rail-machine-main"><b>${num(m.machineCount)} × ${esc(m.machineName)}</b><small>${m.bar.sub}</small></div><div class="rail-machine-out"><b>${m.bar.outTxt}</b><small>${m.bar.outSub}</small></div></div>${m.outputs.length ? '<div class="rail-arrow">↓</div>' : ''}`
    : '';
  return `<h3>Flow at ${phaseLabel(m.stage)}</h3>${recipePanelHtml(m)}${m.inputs.length ? `<div class="rail-cap">Inputs · ${m.inputs.length} line${m.inputs.length > 1 ? 's' : ''} in</div><div class="rail-grid">${m.inputs.map(inTile).join('')}</div>` : ''}${bar}${m.outputs.length ? `<div class="rail-caps"><span class="rail-cap">Delivers · ${phaseLabel(m.stage)}</span>${m.outputs.some(o => o.mach !== undefined) ? `<span class="rail-cap">Machines per delivery · ${num(m.machineCount)} total</span>` : ''}</div><div class="rail-rows">${m.outputs.map(outRow).join('')}</div>${m.bankNote || ''}` : ''}`;
}

function capFlowOutputs(list, unit = '/min') {
  if (list.length <= 10) return list;
  const rest = list.slice(9),
    sum = rest.reduce((s, x) => s + (x.rate || 0), 0);
  return [
    ...list.slice(0, 9),
    { kind: 'more', label: `+ ${rest.length} more destinations`, rate: sum, unit },
  ];
}

export function laneAdviceHtml(m) {
  if (!m || !m.inputs.length) return '';
  const belts = bestLane(false, m.stage),
    pipes = bestLane(true, m.stage);
  const nextNote = belts.next?.milestone
    ? ` ${belts.next.mark} belts (${num(belts.next.cap)}/min) unlock at Tier ${belts.next.milestone.tier} · ${esc(belts.next.milestone.name)} in Phase ${belts.next.milestone.phase}.`
    : '';
  const rows = m.inputs
    .map(i => {
      const p = i.plan,
        l = p.lane,
        per = i.rate / m.equivalent,
        fed = Math.floor(l.cap / per + 1e-9);
      const parts = [
        `<b>${num(i.rate)}${l.unit}</b> → <b>${p.count} × ${l.mark} ${p.word}${p.count > 1 ? 's' : ''}</b>${p.count > 1 ? ` — ${p.full} full + 1 carrying ${num(p.last)}${l.unit}` : ` (${Math.round((i.rate / l.cap) * 100)}% of ${num(l.cap)}${l.unit})`}.`,
      ];
      if (m.machineCount > 1)
        parts.push(
          fed < 1
            ? `Each machine takes ${num(per)}${l.unit} — more than one ${l.mark} ${p.word} carries, so give machines dedicated feeds.`
            : m.machineCount > fed
              ? `One full ${l.mark} ${p.word} feeds <b>${fed} of the ${num(m.machineCount)} machines</b> (${num(per)}${l.unit} each) — plan manifold rows of ${fed}.`
              : `One ${l.mark} ${p.word} feeds all ${num(m.machineCount)} machines (${num(per)}${l.unit} each).`,
        );
      if (p.count > 1 && p.spare > 0.01) {
        const merge = m.sameItemConsumers(i.name).filter(x => x.rate <= p.spare + 0.01);
        parts.push(
          `The last ${p.word} has <b>${num(p.spare)}${l.unit} spare</b> — ${
            merge.length
              ? `enough to also carry ${merge
                  .slice(0, 2)
                  .map(
                    x =>
                      `<button class="btn quiet" ${x.attr}>${esc(x.label)} (${num(x.rate)}${l.unit}) ↗</button>`,
                  )
                  .join(' or ')} from the same bus`
              : 'keep it as expansion headroom on this manifold'
          }.`,
        );
      }
      if (i.local) parts.push(i.local);
      return `<div class="logi-row">${itemIcon(i.name)}<div><b>${esc(i.name)}</b>${parts.map(t => `<p>${t}</p>`).join('')}</div></div>`;
    })
    .join('');
  return `<h3>Belts &amp; pipes</h3><p class="small muted">${phaseLabel(m.stage)} milestones give ${belts.mark} belts (${num(belts.cap)}/min) and ${pipes.mark} pipes (${num(pipes.cap)} m³/min).${nextNote} If a milestone is not unlocked in your save yet, plan with the earlier mark.</p><div class="logi">${rows}</div>`;
}

export function handbookFlowModel(f, st, r, localInput, bankOnly = false) {
  const fluidOut = FLUIDS.has(f.name);
  const unit = fluidOut ? ' m³/min' : '/min';
  const eq = Math.max(r.machines - 1 + (r.lastClock ?? 100) / 100, 0.01);
  const perOut = r.output / eq;
  const beltTxt = p => `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
  const mach = q => (bankOnly ? undefined : q / perOut);
  const consumers = plan.factories
    .filter(o => o.id !== f.id && o.stages[st]?.inputs?.[f.name])
    .map(o => {
      const q = o.stages[st].inputs[f.name];
      return {
        kind: 'consumer',
        label: o.name,
        icon: o.name,
        link: `data-factory="${o.id}"`,
        rate: q,
        unit,
        mach: mach(q),
        beltTxt: f.local ? 'made on site' : beltTxt(lanePlan(q, fluidOut, st)),
      };
    })
    .sort((a, b) => b.rate - a.rate);
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
  const surplus = Math.max(0, r.output - (r.demand ?? r.output));
  if (surplus > 0.002)
    outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: f.name, rate: surplus, unit });
  const inputs = bankOnly
    ? []
    : Object.entries(r.inputs || {}).map(([n, q]) => {
        const lp = localInput(n);
        const src = lp || plan.factories.find(x => x.name === n && x.stages[st]);
        return {
          name: n,
          rate: q,
          link: src ? `data-factory="${src.id}"` : '',
          plan: lanePlan(q, FLUIDS.has(n), st),
          local: lp
            ? `<button class="btn quiet" data-factory="${lp.id}">Local: ≈ ${num(Math.ceil(q / lp.stages[st].rate))} × ${esc(lp.stages[st].machine)} at this site ↗</button>`
            : '',
        };
      });
  const capped = capFlowOutputs(outputs, unit);
  const splits = capped.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const splitTxt =
    splits.length > 1
      ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach - 1e-9))).join(' / ')} across the deliveries below`
      : '';
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
          sub: `${esc(String(r.recipe || '').replace('Alternate: ', ''))} · ${clock} · ${num3(perOut)} ${esc(f.name)}/min out per machine${splitTxt}${f.local ? ' · built beside the consumers' : ''}`,
          outTxt: `${num(r.output)}<small>${unit}</small>`,
          outSub: f.local
            ? 'out · distributed'
            : 'out · ' + beltTxt(lanePlan(r.output, fluidOut, st)),
        },
    sameItemConsumers: n =>
      plan.factories
        .filter(o => o.id !== f.id && o.stages[st]?.inputs?.[n])
        .map(o => ({
          label: o.name,
          rate: o.stages[st].inputs[n],
          attr: `data-factory="${o.id}"`,
        })),
  };
}

export function calcFlowModel(r) {
  const x = calcStage(),
    st = stage(),
    multi = Object.keys(r.outputs || {}).length > 1;
  const eq = Math.max(r.equivalent || r.machines - 1 + (r.lastClock ?? 100) / 100 || 1, 0.01);
  const beltTxt = p => `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
  const outputs = [];
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
        link: `data-calc-factory="${o.id}"`,
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
  outputs.sort((a, b) => (b.rate || 0) - (a.rate || 0));
  if (!outputs.length && r.generationMW)
    outputs.push({
      kind: 'ship',
      label: 'Power grid',
      shipSub: 'generation',
      rateTxt: power(r.generationMW),
    });
  const inputs = Object.entries(r.inputs || {}).map(([n, q]) => {
    const src = (x.rows || []).find(o => o.id !== r.id && o.outputs?.[n]);
    return {
      name: n,
      rate: q,
      link: src ? `data-calc-factory="${src.id}"` : '',
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
    recipe: {
      name: r.name,
      machine: r.machine,
      ins: inputs.map(i => [i.name, i.rate / eq, i.link]),
      outs: outName
        ? Object.entries(r.outputs).map(([n, q]) => [n, q / eq])
        : [['MW', r.generationMW / eq]],
    },
    bar: {
      sub: `${esc(r.name)} · ${clock}${outName && !multi ? ` · ${num3(r.outputs[outName] / eq)} ${esc(outName)}/min out per machine` : ''}${splitTxt}`,
      outTxt: outName
        ? `${num(r.outputs[outName])}<small>${FLUIDS.has(outName) ? ' m³/min' : '/min'}</small>`
        : power(r.generationMW),
      outSub: outName
        ? multi
          ? 'out · ' + esc(outName) + ' + byproducts'
          : 'out · ' + beltTxt(lanePlan(r.outputs[outName], FLUIDS.has(outName), st))
        : 'generation',
    },
    bankNote: outputs.length
      ? `<p class="small muted">Demand for the item across this phase's whole plan${shared ? ', supplied together with the other recipes producing it' : ''}.</p>`
      : '',
    sameItemConsumers: n =>
      (x.rows || [])
        .filter(o => o.id !== r.id && o.inputs?.[n])
        .map(o => ({ label: o.name, rate: o.inputs[n], attr: `data-calc-factory="${o.id}"` })),
  };
}
