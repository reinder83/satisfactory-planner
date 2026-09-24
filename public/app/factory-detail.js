// Detail dialogs for a factory, a factory group chain and the oil campus.
import {
  flowHtml,
  FLUIDS,
  handbookFlowModel,
  laneAdviceHtml,
  lanePlan,
  machinesLabel,
  OIL_RECIPES,
  recipeCell,
} from './flow.js';
import { $, esc, itemIcon, num, stat } from './format.js';
import {
  calcStage,
  calculated,
  doneAttr,
  phase,
  phaseLabel,
  plan,
  setActiveDetail,
  stage,
  state,
} from './session.js';
import { factoryGroupsState, membershipsOf } from './views/factories.js';

export function dialog(title, subtitle, body, icon = '') {
  const d = $('#detail');
  d.innerHTML = `<header class="dialog-head"><div class="dialog-title">${icon ? `<span class="dialog-icon">${itemIcon(icon)}</span>` : ''}<div><div class="eyebrow">${subtitle}</div><h2>${esc(title)}</h2></div></div><button class="close" aria-label="Close details" data-close>×</button></header><div class="dialog-body">${body}</div>`;
  if (!d.open) d.showModal();
}

export function openFactory(id) {
  const f = plan.factories.find(x => x.id === id);
  if (!f) return;
  setActiveDetail({ type: 'factory', id });
  const r = f.stages[stage()] || Object.values(f.stages)[0];
  const oil = ['Plastic', 'Rubber'].includes(f.name);
  let installed = {};
  const history = Object.entries(f.stages)
    .map(([ph, x]) => {
      const campus = oil ? (plan.plans[ph]?.oil || []).reduce((a, c) => a + c.machines, 0) : 0;
      const machines = oil ? campus : x.machines,
        label = oil ? 'shared campus buildings' : esc(x.machine);
      const old = installed[label] || 0;
      const added = Math.max(0, machines - old);
      installed[label] = Math.max(old, machines);
      return `<tr><td>${ph}</td><td>${num(x.output)}</td><td>${num(x.storage)}</td><td>${num(machines)} ${label}</td><td>${added ? `+${num(added)}` : 'Keep capacity'}</td></tr>`;
    })
    .join('');
  const st = f.stages[stage()] ? stage() : Object.keys(f.stages)[0];
  const localInput = n => plan.factories.find(x => x.local && x.name === n && x.stages[st]);
  const flow = handbookFlowModel(f, st, r, localInput, oil);
  dialog(
    f.name,
    `${phaseLabel(st)} · Handbook page ${f.page}`,
    `
 <span class="badge orange">${esc(r.recipe)}</span><div class="stats">${stat('Output', num(r.output) + '/min', 'Total production')}${stat('Storage', num(r.storage) + '/min', 'Protected allowance')}${stat('Machines', oil ? 'Campus' : num(r.machines), oil ? 'Shared oil processes' : esc(r.machine))}</div>
 ${f.note ? `<div class="notice blue">${esc(f.note)}</div>` : ''}${f.local ? '<div class="notice">Distributed production budget: build these machines beside the consumers listed below, plus the storage refill module. Independent site rounding can require additional machines.</div>' : ''}${flowHtml(flow)}${usageNotesHtml(f, st)}${f.nuclear ? '<div class="notice">Process buffer at the nuclear site. Keep radioactive recycling flows balanced; do not apply a generic storage surplus.</div>' : ''}
 ${oil ? oilDetail(st) : laneAdviceHtml(flow) + `<p class="small muted">${num(r.machines)} whole buildings. All at 100%, except the last at ${num(r.lastClock)}%. Peak production load ${num(r.peakMW)} MW; upstream factories and logistics are separate.${Object.keys(r.inputs).some(localInput) ? ' Local inputs are produced beside this factory; their machines are part of the shared distributed budget.' : ''}</p>`}
 <h3>Expansion across phases</h3><div class="table-wrap"><table><thead><tr><th>Phase</th><th>Output/min</th><th>Storage/min</th><th>Required</th><th>Add</th></tr></thead><tbody>${history}</tbody></table></div><p class="small muted">Keep larger earlier installed capacity. Recipe changes need their new input routes. Counts are running requirements, not a demolition instruction.${oil ? ' Campus buildings are shared with the other polymer export and produce both together; the shared oil campus stages above list machines per recipe. Phase 4 replaces the simple Phase 3 refineries with the recycled loops.' : ''}</p>
 <div class="detail-actions"><label class="check-row"><input type="checkbox" data-check="factory-${st}-${f.id}" ${doneAttr('factory-' + st + '-' + f.id)}>Running at Phase ${st} target</label></div>
 <h3>Factory notes</h3><textarea id="detail-note" class="notes" maxlength="6000" aria-label="Factory notes">${esc(state.notes['factory-' + f.id] || '')}</textarea><div class="note-save"><span class="small muted">Location, transport, next expansion.</span><button class="btn" data-save-note="factory-${f.id}" data-input="detail-note">Save notes</button></div>`,
    f.name,
  );
}

function usageNotesHtml(f, st) {
  const r = f.stages[st];
  const consumers = plan.factories.some(o => o.id !== f.id && o.stages[st]?.inputs?.[f.name]);
  const completion = phase() === 'post' ? plan.completion.filter(c => c.inputs?.[f.name]) : [];
  return (
    (consumers || r.delivery
      ? ''
      : f.nuclear
        ? `<p class="small muted">${esc(f.name)} is consumed by the nuclear power fleet, which is planned in <a href="#resources">Power &amp; resources</a> rather than as a factory target. Keep its flow inside the nuclear site.</p>`
        : r.storage
          ? `<p class="small muted">No factory in this plan consumes ${esc(f.name)} directly; this capacity only refills the protected storage. The refill rate is a protected maximum, not continuous consumption — the machines idle once the container is full and only run while you take ${esc(f.name)} out.</p>`
          : '') +
    (completion.length
      ? `<p class="small muted">Additional completion modules also use ${esc(f.name)}: ${completion.map(c => esc(c.name) + ' ' + num(c.inputs[f.name]) + '/min').join(' · ')}. Allocate their supply on top of this factory's budget.</p>`
      : '')
  );
}

function oilDetail(st) {
  const p = plan.plans[st];
  const stages = p.oil.map(x => ({ ...x, rc: OIL_RECIPES[x.recipe] || { in: {}, out: {} } }));
  const pipeTxt = q => {
    const pl = lanePlan(q, true, st);
    return `${pl.count} × ${pl.lane.mark} pipe${pl.count > 1 ? 's' : ''}`;
  };
  const fuelConsumer = plan.factories.find(
    ff => !['plastic', 'rubber'].includes(ff.id) && ff.stages[st]?.inputs?.Fuel,
  );
  const bank = `<div class="rail-cap">Campus inputs</div><div class="rail-grid">${[
    ['Crude Oil', p.oilTotals.crude],
    ['Water', p.oilTotals.water],
  ]
    .filter(([, q]) => q > 0.01)
    .map(
      ([n, q]) =>
        `<div class="rail-tile">${itemIcon(n)}<span class="rail-main"><b>${esc(n)}</b><small>${pipeTxt(q)}</small></span><span class="rail-rate">${num(q)}<small> m³/min</small></span></div>`,
    )
    .join('')}</div>`;
  const stageHtml = stages
    .map(x => {
      const tot = side =>
        Object.entries(x.rc[side])
          .map(([n, q]) => `${num(q * x.equivalent)}${FLUIDS.has(n) ? ' m³' : ''} ${esc(n)}`)
          .join(' + ');
      const dest = Object.keys(x.rc.out)
        .map(n => {
          const parts = stages
            .filter(o => o !== x && o.rc.in[n])
            .map(
              o =>
                `the ${esc(o.recipe.replace('Alternate: ', ''))} ${esc(o.machine.replace(/y$/, 'ie'))}s`,
            );
          if (n === 'Plastic' || n === 'Rubber') parts.push('campus export');
          if (n === 'Fuel') {
            if (Number(p.oilTotals.generators) > 0)
              parts.push(
                `${num(p.oilTotals.generators)} Fuel Generators (${num(p.oilTotals.grossGW)} GW gross)`,
              );
            else if (p.oilTotals.fuel > 0.01)
              parts.push(
                `export ${num(p.oilTotals.fuel)}/min${fuelConsumer ? ` to <button class="btn quiet" data-factory="${fuelConsumer.id}">${esc(fuelConsumer.name)} ↗</button>` : ''}`,
              );
          }
          return parts.length ? `${esc(n)} → ${parts.join(' + ')}` : '';
        })
        .filter(Boolean)
        .join('<br>');
      const whole = Math.floor(x.equivalent + 1e-7),
        frac = x.equivalent - whole;
      const clock =
        frac > 1e-7 ? `${num(whole)} at 100% + 1 at ≈ ${num(frac * 100)}%` : `all at 100%`;
      return `<div class="rail-arrow">↓</div><div class="rail-machine"><div class="rail-machine-main"><b>${num(x.machines)} × ${esc(x.machine)}</b><small>${esc(x.recipe)} · ${clock} · in ${tot('in') || '—'} · out ${tot('out')}</small></div></div><div class="rail-recipe"><div class="rail-recipe-head"><span>Recipe · ${esc(x.recipe.replace('Alternate: ', ''))}</span><span>what ${machinesLabel(x.machines, x.machine)} makes @ 100% · per minute</span></div><div class="rail-recipe-body"><div class="rail-recipe-ins">${Object.entries(
        x.rc.in,
      )
        .map(c => recipeCell(c))
        .join(
          '',
        )}</div><span class="rail-recipe-arrow">→</span><div class="rail-recipe-outs">${Object.entries(
        x.rc.out,
      )
        .map(c => recipeCell(c, true))
        .join('')}</div></div></div>${dest ? `<p class="small muted">${dest}</p>` : ''}`;
    })
    .join('');
  return `<h3>Shared oil campus · ${phaseLabel(st)}</h3><p>One campus makes Plastic and Rubber together. Crude never feeds the polymer machines directly${st === '3' ? ': the standard refineries turn it into the polymers plus Heavy Oil Residue, which becomes generator fuel.' : ': it becomes Heavy Oil Residue and Polymer Resin first, and the polymers come out of the fuel-driven recycled loops.'} Build the stages in this order; recipe cells are per machine at 100%, per minute.</p><p class="small muted">Flow rates here stay exactly balanced instead of rounded up: unpackaged fluids cannot overflow to the AWESOME Sink, and the loops feed themselves, so surplus fluid would back the chain up. Machine counts are whole — only each stage's last machine runs underclocked.</p>${bank}${stageHtml}<p>${st === '3' ? `Burn all ${num(p.oilTotals.fuel)} Fuel/min in ${p.oilTotals.generators} generators (last underclocked), giving ${num(p.oilTotals.grossGW)} GW gross. This additional Phase 3 byproduct power is not counted in later capacity totals.` : `Export ${num(p.oilTotals.fuel)} Fuel/min; remaining fuel and recycled polymers are internal flows. <b>Seeding the loops:</b> run the Residual Rubber Refineries from resin first, feed that rubber with fuel into Recycled Plastic, then bring Recycled Rubber online — open the campus exports only once both loops are saturated.`}</p>`;
}

function groupChainNodes(gid) {
  if (calculated) {
    const x = calcStage();
    return (x.rows || [])
      .filter(r => membershipsOf(r.id).some(m => m.group === gid))
      .map(r => ({
        id: r.id,
        attr: `data-calc-factory="${r.id}"`,
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
        attr: `data-factory="${f.id}"`,
        name: f.name,
        machine: r.machine,
        machines: r.machines,
        inputs: r.inputs || {},
        outputs: { [f.name]: r.output },
        recipe: r.recipe,
      };
    });
}

export function openGroupChain(gid) {
  const gr = factoryGroupsState().groups.find(g => g.id === gid);
  if (!gr) return;
  setActiveDetail({ type: 'group', id: gid });
  const nodes = groupChainNodes(gid);
  if (!nodes.length)
    return dialog(
      gr.name,
      'Factory group · build order',
      '<p class="small muted">No factories from this group produce anything in the current phase.</p>',
    );
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
  const stageNo = new Map(placed.map((nd, i) => [nd.id, i + 1]));
  const others = calculated
    ? calcStage().rows || []
    : plan.factories
        .filter(f => f.stages[stage()])
        .map(f => ({ id: f.id, name: f.name, inputs: f.stages[stage()].inputs || {} }));
  const html = placed
    .map((nd, i) => {
      const loopIns = loopSeeds.get(nd.id) || [];
      const needs = Object.entries(nd.inputs)
        .map(([n, q]) => {
          const from = makers(n).filter(m => m !== nd);
          const src = loopIns.includes(n)
            ? '<b class="chain-loop">loop — seed a starter batch</b>'
            : from.length
              ? 'stage ' + Math.min(...from.map(m => stageNo.get(m.id)))
              : 'outside the group';
          return `${esc(n)} ${num(q)}${FLUIDS.has(n) ? ' m³' : ''}/min <span class="muted">· ${src}</span>`;
        })
        .join('<br>');
      const feeds =
        Object.keys(nd.outputs)
          .map(n => {
            const inGroup = nodes
              .filter(o => o !== nd && o.inputs[n])
              .map(o => `stage ${stageNo.get(o.id)} · ${esc(o.name)}`);
            const outside = others.filter(
              o => o.id !== nd.id && o.inputs?.[n] && !nodes.some(g => g.id === o.id),
            ).length;
            const parts = [...inGroup];
            if (outside)
              parts.push(`${outside} ${outside === 1 ? 'factory' : 'factories'} outside the group`);
            return `${esc(n)} → ${parts.join(' · ') || 'storage, export or sink'}`;
          })
          .join('<br>') || (nd.mw ? 'Power grid' : '—');
      return `<div class="chain-stage"><span class="chain-no">${String(i + 1).padStart(2, '0')}</span><div class="chain-body"><div class="chain-title"><button class="rail-link" ${nd.attr}>${esc(nd.name)} ↗</button><span class="muted">${num(nd.machines)} × ${esc(nd.machine)}</span></div>${needs ? `<p class="small"><b>Needs</b><br>${needs}</p>` : '<p class="small muted">No belt or pipe inputs.</p>'}<p class="small"><b>Feeds</b><br>${feeds}</p></div></div>`;
    })
    .join('');
  const split = nodes.some(nd => membershipsOf(nd.id).some(m => m.group === gid && m.rate != null));
  dialog(
    gr.name,
    `Factory group · build order · ${phaseLabel(stage())}`,
    `<p class="small muted">Stages are ordered so suppliers come before their consumers. An input marked <b>loop</b> is produced by a later stage: run that stage from a starter batch first, then close the loop.</p><div class="chain">${html}</div>${split ? '<p class="small muted">Rates are the whole plan’s totals; this group’s production split is shown on the factory cards.</p>' : ''}`,
  );
}
