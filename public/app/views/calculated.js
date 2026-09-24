// Views for a calculated profile: plan, factories and resources.
import { progression } from '../../progression.js';
import { dialog } from '../factory-detail.js';
import { calcFlowModel, flowHtml, laneAdviceHtml } from '../flow.js';
import { esc, itemIcon, num, slug, stat } from '../format.js';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  doneAttr,
  factoryEditing,
  fromStart,
  phase,
  phaseLabel,
  progressionData,
  query,
  stage,
  state,
  workspace,
} from '../session.js';
import { header } from '../shell.js';
import { checklistHtml, planEditToolbar, planTasks, removedStepsHtml } from '../tasks.js';
import {
  allocationHtml,
  assignEditor,
  factoryEditToolbar,
  groupEditPanel,
  groupSections,
  membershipsOf,
} from './factories.js';
import { deliveryHtml } from './plan.js';
import { inputText } from './storage.js';
import { power } from '../wizard/fields.js';

export function calculatedDelivery(id) {
  const d = Object.entries(calcStage().delivery || {}).find(
    ([n]) => id === stage() + '-' + slug(n),
  );
  return d ? { id, name: d[0], ...d[1], initial: 0 } : null;
}

export function calcTasks() {
  const p = calcStage(),
    g = progression(calculated, state, progressionData, phase());
  const startup =
    stage() === '1'
      ? [
          g.baseTasks[0],
          ...g.powerTasks.slice(0, 2),
          ...g.baseTasks.slice(1, 5),
          ...g.milestoneTasks,
          ...g.powerTasks.slice(2),
          ...g.baseTasks.slice(5),
        ]
      : [...g.powerTasks, ...g.milestoneTasks];
  return [
    ...startup,
    ...g.hardDrives,
    ...(p.rows || []).map(r => ({
      id: 'calc-' + stage() + '-' + r.id,
      title: r.name,
      body: `${machineSetup(r).summary} ${machineSetup(r).partial ? 'Adjustable machine: ≈ ' + num(machineSetup(r).clock) + '% → ≈ ' + machineSetup(r).lastOutput + '. Open factory details for an easier rounded option.' : 'Each machine: ' + machineSetup(r).fullOutput + '.'} ${r.amplified ? `Insert ${r.slots} somersloop${r.slots > 1 ? 's' : ''} in each machine — ${r.sloops} in total — for double output from the same inputs at four times the power. ` : ''}Inputs /min: ${
        Object.entries(r.inputs)
          .map(([n, q]) => n + ' ' + num(q))
          .join(', ') || 'none'
      }. Outputs /min: ${
        Object.entries(r.outputs)
          .map(([n, q]) => n + ' ' + num(q))
          .join(', ') || power(r.generationMW)
      }.`,
    })),
    {
      id: 'calc-' + stage() + '-storage',
      title: 'Connect protected storage and overflow',
      body: 'Reserve the listed storage refill rates before elevator exports. Handle every liquid byproduct; send surplus sinkable solids to the AWESOME Sink after unlocking it.',
    },
    ...(g.retire || []),
  ];
}

// Older snapshots carry only a reason sentence; shortfalls/minHours render as concrete options when present.
export function draftOptions(x, s) {
  const fixes = [];
  if (x.shortfalls?.length)
    fixes.push(
      `Raise the short budget${x.shortfalls.length > 1 ? 's' : ''} (Resources): ${x.shortfalls.map(f => `${esc(f.name)} to about ${num(f.needed)}/min (entered: ${num(f.budget)}/min)`).join('; ')}.`,
    );
  if (x.wholeMachinesOnly)
    fixes.push(
      'Keep these budgets instead: untick “Run solid-part machines at 100%” (Goals). Precise balancing fits, with one adjustable machine per production line.',
    );
  if (x.minHours)
    fixes.push(
      s?.goal === 'timed'
        ? `Raise “Hours per phase” (Goals) to at least ${num(x.minHours)} h.`
        : `Switch the goal (Goals) to “Target completion time” with at least ${num(x.minHours)} hours per phase.`,
    );
  else if (x.shortfalls?.length && !x.wholeMachinesOnly)
    fixes.push(
      s?.goal === 'maximum'
        ? 'Lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences).'
        : `More time alone will not fit: lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences)${s?.roundRates ? ', or untick delivery-rate rounding (Goals)' : ''}.`,
    );
  if (x.shortfalls?.length && s?.recipes === 'standard')
    fixes.push('Allow alternate recipes (Preferences) to cut raw resource use.');
  if (x.shortfalls?.length && s?.sam === 'avoid')
    fixes.push(
      'Allow SAM resource conversion (Preferences) to turn plentiful resources into the short ones.',
    );
  return fixes.length
    ? `<p><b>Options</b></p><ul>${fixes.map(f => `<li>${f}</li>`).join('')}</ul>`
    : '';
}

function calcWarnings() {
  const x = calcStage();
  const options = x.feasible ? '' : draftOptions(x, calculated?.settings);
  return `${!x.feasible ? `<div class="notice"><b>Planning draft — resource budget exceeded or recipe combination unavailable.</b> ${esc(x.reason)}${options && options + '<p class="small">Profiles are calculated snapshots: create a new profile with adjusted settings to apply an option.</p>'}</div>` : ''}${x.additionalHeadroomMW > 0.01 ? `<div class="notice">Allow another ${power(x.additionalHeadroomMW)} for whole-building power headroom. Phase 1 needs biomass or existing generation.</div>` : ''}`;
}

export function renderCalculatedPlan() {
  const x = calcStage(),
    ts = planTasks(),
    done = ts.filter(t => checked(t.id)).length;
  return (
    header('CALCULATED BUILD SEQUENCE', phaseLabel(phase()), esc(currentProfile.name)) +
    calcWarnings() +
    `<div class="stats">${stat('Progress', done + '/' + ts.length, 'Checklist steps')}${stat('Delivery time', num(x.hours) + ' h', 'At steady state; excludes construction')}${stat('Buildings', num(x.rows?.reduce((a, r) => a + r.machines, 0)), 'Includes new power generation')}${stat('New power', power(x.generationMW), 'Existing spare power is separate')}</div>${phase() === 'post' ? '<div class="notice blue">Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former elevator exports as needed and sink spare parts.</div>' : ''}<div class="split"><section><div class="section-head"><h2>Build sequence</h2>${planEditToolbar()}</div><p class="small muted">Start with construction stock and currently available power. Mark HUB, MAM and recipe unlocks as you complete them; these carry across phases. Milestone cost guidance updates from factories marked running. Full-phase factory targets follow the startup and unlock steps.</p>${checklistHtml(ts)}${removedStepsHtml()}<form id="add-task" class="inline-form"><input name="title" maxlength="240" required placeholder="Add a task…" aria-label="Personal task"><button class="btn">Add task</button></form><h2>Phase notes</h2><textarea id="phase-note" class="notes" maxlength="6000">${esc(state.notes['phase-' + phase()] || '')}</textarea><button class="btn" data-save-note="phase-${phase()}" data-input="phase-note">Save notes</button></section><aside><section class="panel"><h2>Elevator delivery</h2>${Object.entries(
      x.delivery || {},
    )
      .map(([n, d]) => deliveryHtml({ id: stage() + '-' + slug(n), name: n, ...d, initial: 0 }))
      .join(
        '',
      )}</section><section class="panel"><h2>Profile assumptions</h2>${calculated.warnings.map(w => `<p class="small">${esc(w)}</p>`).join('')}</section></aside></div>`
  );
}

function calcFactoryCard(r, groupId = null) {
  const total = Object.values(r.outputs || {})[0] || 0;
  return `<article class="factory-card"><div class="card-top"><span class="card-icon">${itemIcon(Object.keys(r.outputs)[0])}</span><div class="card-main"><button class="name" data-calc-factory="${r.id}">${esc(r.name)}</button><div class="output">${num(r.machines)} <span>${esc(r.machine)}</span></div></div></div><p>${
    Object.entries(r.outputs)
      .map(([n, q]) => `${esc(n)}: ${num(q)}/min`)
      .join('<br>') || power(r.generationMW)
  }</p>${groupId ? allocationHtml(r.id, groupId, total || r.generationMW, r.machines, total ? '/min' : ' MW') : ''}<footer><label class="check-row"><input type="checkbox" data-check="calc-${stage()}-${r.id}" ${doneAttr('calc-' + stage() + '-' + r.id)}>Running</label><button class="btn quiet" data-calc-factory="${r.id}">Details ↗</button></footer>${factoryEditing ? assignEditor(r.id) : ''}</article>`;
}

export function renderCalculatedFactories() {
  const x = calcStage(),
    rows = (x.rows || []).filter(r =>
      (r.name + ' ' + Object.keys(r.outputs).join(' ')).toLowerCase().includes(query.toLowerCase()),
    );
  const ungrouped = rows.filter(r => !membershipsOf(r.id).length);
  const groupsHtml = groupSections(
    rows,
    r => r.id,
    (r, gid) => calcFactoryCard(r, gid),
  );
  return (
    header(
      'CALCULATED PRODUCTION',
      'Factory targets',
      'Each recipe line includes its inputs, whole buildings and later expansion. Multiple recipes for a part can share one site.',
    ) +
    (!calculated.settings.wholeMachines
      ? '<div class="notice blue">Prefer extra production over underclocking? <button class="btn primary" data-round-up>Round up production</button><p>Creates a recalculated profile revision. Your previous profile stays available; increased factory requirements are marked for review.</p></div>'
      : '<div class="notice blue">Whole-machine production: protect downstream supply first, refill storage, then sink surplus solids. Liquid and nuclear balances remain controlled.</div>') +
    calcWarnings() +
    `<div class="toolbar"><input id="factory-search" class="search" aria-label="Find a factory" placeholder="Find a part or recipe…" value="${esc(query)}"><span>${rows.length} production lines</span>${factoryEditToolbar()}</div>${factoryEditing ? groupEditPanel() : ''}${groupsHtml}${groupsHtml && ungrouped.length ? '<p class="eyebrow">UNGROUPED PRODUCTION LINES</p>' : ''}<div class="cards">${ungrouped.map(r => calcFactoryCard(r)).join('')}</div>`
  );
}

function machineSetup(r) {
  const equivalent = r.equivalent || r.machines - 1 + r.lastClock / 100,
    whole = Math.floor(equivalent + 1e-7),
    fraction = Math.max(0, equivalent - whole),
    partial = fraction > 1e-7;
  const rates = Object.fromEntries(
    Object.entries(r.outputs || {}).map(([n, q]) => [n, q / equivalent]),
  );
  const fullOutput =
    Object.entries(rates)
      .map(([n, q]) => `${num(q)} ${n}/min`)
      .join(' · ') || `${num(r.generationMW / equivalent)} MW`;
  const lastOutput =
    Object.entries(rates)
      .map(([n, q]) => `${num(q * fraction)} ${n}/min`)
      .join(' · ') || `${num((r.generationMW / equivalent) * fraction)} MW`;
  const summary = `${r.machines} ${r.machine} total: ${partial ? (whole ? whole + ' at 100% + ' : '') + '1 adjustable machine' : whole + ' at 100% (no underclock needed)'}.`;
  const sensitive = /uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [r.name, ...Object.keys(r.inputs || {}), ...Object.keys(r.outputs || {})].join(' '),
  );
  let easy = null;
  if (partial && !sensitive) {
    // Round the final clock upward to a whole percent, never silently underproduce.
    let clock = Math.ceil(fraction * 100 - 1e-7);
    const primary = Object.entries(rates)[0];
    if (primary) {
      const target = Math.ceil(primary[1] * fraction - 1e-7),
        candidate = (target / primary[1]) * 100;
      if (candidate <= 100 && Math.abs(candidate - Math.round(candidate)) < 1e-7)
        clock = Math.max(clock, Math.round(candidate));
    }
    const extra = clock / 100 - fraction;
    if (extra > 1e-7)
      easy = {
        clock,
        output: Object.fromEntries(Object.entries(rates).map(([n, q]) => [n, (q * clock) / 100])),
        inputs: Object.fromEntries(
          Object.entries(r.inputs || {}).map(([n, q]) => [n, (q / equivalent) * extra]),
        ),
        extraOutputs: Object.fromEntries(Object.entries(rates).map(([n, q]) => [n, q * extra])),
      };
  }
  return { summary, whole, partial, fullOutput, lastOutput, clock: fraction * 100, easy };
}

function setupHtml(r) {
  const m = machineSetup(r);
  return `<h3>Machine setup</h3><p><b>${esc(m.summary)}</b></p><table><thead><tr><th>Machines</th><th>Clock each</th><th>Output per machine</th></tr></thead><tbody>${m.whole ? `<tr><td>${m.whole} full-speed</td><td>100%</td><td>${esc(m.fullOutput)}</td></tr>` : ''}${m.partial ? `<tr><td>1 adjustable</td><td>≈ ${num(m.clock)}%</td><td>≈ ${esc(m.lastOutput)}</td></tr>` : ''}</tbody></table>${m.easy && !calculated?.settings.wholeMachines ? `<div class="notice blue"><b>Easier optional setting: set only the adjustable machine to ${m.easy.clock}%.</b><p>Its output: ${inputText(m.easy.output) || num(((r.generationMW / (r.equivalent || 1)) * m.easy.clock) / 100) + ' MW'}.</p><p>Extra inputs needed: ${inputText(m.easy.inputs)}.<br>Extra outputs/byproducts: ${inputText(m.easy.extraOutputs) || 'Additional generation'}.</p><p>This is extra capacity, not a recalculated balanced plan. Supply the extra inputs and handle every extra output before using it. The totals below remain the original calculated targets.</p></div>` : ''}${m.partial ? '<p class="small muted">Calculated percentages and outputs are displayed rounded. Keep the calculated setting for tightly balanced recycling; do not round nuclear or waste-processing lines independently.</p>' : ''}`;
}

// Phases where a line is not built yet, or needs no more machines, have nothing
// to add: say so with a dash rather than claiming capacity is being kept.
function calcExpansionRows(id) {
  let installed = 0;
  return fromStart(calculated.stages)
    .map(([ph, p]) => {
      const required = p.rows?.find(x => x.id === id)?.machines || 0;
      const add = Math.max(0, required - installed);
      installed = Math.max(installed, required);
      return `<tr><td>${ph}</td><td>${required || '—'}</td><td>${add ? '+' + add : '—'}</td></tr>`;
    })
    .join('');
}

export function openCalculatedFactory(id) {
  const r = calcStage().rows?.find(r => r.id === id);
  if (!r) return;
  const flow = calcFlowModel(r);
  const dialogIcon = Object.keys(r.outputs || {})[0] || '';
  dialog(
    r.name,
    phaseLabel(phase()),
    `${flowHtml(flow)}${setupHtml(r)}${laneAdviceHtml(flow)}<h3>Outputs per minute</h3><p>${inputText(r.outputs) || power(r.generationMW)}</p><h3>Expansion by phase</h3><table><thead><tr><th>Phase</th><th>Machines</th><th>Add</th></tr></thead><tbody>${calcExpansionRows(id)}</tbody></table><p class="small muted">The optimizer may choose a different recipe in another phase. Keep earlier buildings until the replacement chain runs. Screws and wire can be made beside consumers.</p><textarea id="detail-note" class="notes" maxlength="6000" aria-label="Factory notes">${esc(state.notes['factory-' + id] || '')}</textarea><button class="btn" data-save-note="factory-${id}" data-input="detail-note">Save notes</button>`,
    dialogIcon,
  );
}

export function renderCalculatedResources() {
  const x = calcStage();
  return (
    header(
      'CHECK BEFORE EXPANDING',
      'Power & resources',
      'New production and new generator fuel are included. Existing fuel consumption must already be deducted from your entered budgets.',
    ) +
    calcWarnings() +
    `<div class="stats">${stat('New generation', power(x.generationMW), 'Fuel and recycling included')}${stat('Whole-machine peak', power(x.peakMW), 'At selected consumption multiplier')}${stat('With utility allowance', power(x.requiredMW), (calculated.settings.utilityPercent ?? 20) + '% for transport and utilities; verify actual load')}${stat('Existing spare power', power(calculated.settings.availablePowerGW * 1000), 'Not total installed generation')}${x.sloopsUsed ? stat('Somersloops in production', num(x.sloopsUsed), 'Amplified machines: double output, four times the power') : ''}${x.augmenters ? stat('With augmenter boost', power(x.availableMW), num(x.augmenters) + ' augmenter' + (x.augmenters > 1 ? 's' : '') + ' · ' + num(x.augmenterMW) + ' MW plus ' + Math.round(x.boost * 100) + '% of base production') : ''}</div><div class="table-wrap"><table><thead><tr><th>Resource</th><th>Required /min</th><th>Budget /min</th><th>Remaining</th></tr></thead><tbody>${workspace.catalog.raw.map(n => `<tr><td class="resource-name">${itemIcon(n)}<span>${esc(n)}</span></td><td>${num(x.raw?.[n])}</td><td>${num(calculated.settings.limits[n])}</td><td class="${(x.raw?.[n] || 0) > calculated.settings.limits[n] ? 'warn' : ''}">${num(calculated.settings.limits[n] - (x.raw?.[n] || 0))}</td></tr>`).join('')}</tbody></table></div><div class="backup-grid"><section class="panel"><h2>Dedicated drone fuel /min</h2><p>${inputText(x.drone || {}) || 'No dedicated drone fuel in this phase.'}</p><h2>Protected storage /min</h2><p>${inputText(x.storage || {}) || 'No storage production requested.'}</p><h2>From production you already run</h2><p>${inputText(x.supplied || {}) || 'None credited in this phase.'}</p>${Object.keys(x.supplied || {}).length ? '<p class="small muted">The plan does not build these lines or the chain behind them. Their extraction is assumed to be outside the budgets above.</p>' : ''}</section><section class="panel"><h2>Conversion and byproducts</h2><p>${x.conversions?.map(esc).join('<br>') || 'No raw-resource conversion required.'}</p><p>Plutonium rods to sink: ${num(x.plutoniumSink)}/min.</p><p>Surplus solids: ${inputText(x.surplus || {}) || 'None'}</p><p class="small muted">Liquid and radioactive material balances are enforced. Do not let storage or overflow block recycling.</p></section></div>`
  );
}
