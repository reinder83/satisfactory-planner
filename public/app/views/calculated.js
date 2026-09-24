// For a calculated profile: the resources page (#resources when `calculated` is set;
// render() in shell.js picks it over the handbook's), the checklist steps of its plan page
// (ui/pages/CalculatedPlanPage.vue), and the machine setup and expansion its factory dialog
// shows (ui/detail/CalcFactoryDialog.vue). Everything reads the profile's frozen calculation
// snapshot through calcStage(); nothing here recalculates.
import { progression } from '../../progression.js';
import { itemIcon, num, stat } from '../format.js';
import { html } from '../html.js';
import {
  calcStage,
  calculated,
  fromStart,
  phase,
  progressionData,
  stage,
  state,
  workspace,
} from '../session.js';
import { header } from '../shell.js';
import { inputText } from './storage.js';
import { power } from '../wizard/fields.js';

// The generated checklist for a calculated profile's current phase, before the user's step
// edits and custom tasks (tasks.js adds those). Order: startup, power and milestone steps
// from progression.js, hard drives, one step per production row, storage, then the lines
// this phase retires. Row steps use the saved key `calc-<stage>-<row id>` — the same key as
// that factory card's Running box — and must stay stable.
export function calcTasks() {
  const p = calcStage(),
    g = progression(calculated, state, progressionData, phase());
  // Phase 1 interleaves base, power and milestone steps into a starting order; later
  // phases put power first, then milestones.
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
// The options for an infeasible phase `x` under settings `s`, as sentences (none for an
// older snapshot). ui/plan/CalcWarnings.vue lists them too.
export function draftFixes(x, s) {
  const fixes = [];
  if (x.shortfalls?.length)
    fixes.push(
      `Raise the short budget${x.shortfalls.length > 1 ? 's' : ''} (Resources): ${x.shortfalls.map(f => `${f.name} to about ${num(f.needed)}/min (entered: ${num(f.budget)}/min)`).join('; ')}.`,
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
  return fixes;
}

// HTML "Options" list of draftFixes, or ''. Also used by the wizard's Review step
// (wizard/wizard.js).
export function draftOptions(x, s) {
  const fixes = draftFixes(x, s);
  return fixes.length
    ? html`<p><b>Options</b></p>
        <ul>
          ${fixes.map(f => html`<li>${f}</li>`)}
        </ul>`
    : '';
}

// HTML notices for the current phase: the infeasible-draft warning with its options, and
// extra power headroom for whole buildings, on the calculated resources page;
// ui/plan/CalcWarnings.vue shows them on the plan and factories pages.
function calcWarnings() {
  const x = calcStage();
  const options = x.feasible ? '' : draftOptions(x, calculated?.settings);
  return html`${!x.feasible &&
  html`<div class="notice">
    <b>Planning draft — resource budget exceeded or recipe combination unavailable.</b>
    ${x.reason}${options &&
    html`${options}
      <p class="small">
        Profiles are calculated snapshots: create a new profile with adjusted settings to apply an
        option.
      </p>`}
  </div>`}${x.additionalHeadroomMW > 0.01 &&
  html`<div class="notice">
    Allow another ${power(x.additionalHeadroomMW)} for whole-building power headroom. Phase 1 needs
    biomass or existing generation.
  </div>`}`;
}

// How to build row `r`: how many machines run at 100% and whether one last machine runs
// underclocked, with per-machine output text. `easy` is an optional rounded-up clock for
// that last machine and the extra inputs/outputs it causes; it is never offered for nuclear
// or waste lines, whose balance must stay exact. Used by calcTasks and
// ui/detail/CalcFactoryDialog.vue.
export function machineSetup(r) {
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

// Phases where a line is not built yet, or needs no more machines, have nothing
// to add: say so with a dash rather than claiming capacity is being kept.
// One row per phase from the profile's start phase on: { phase, required, add }, the machines
// required for row `id` and how many to add over the most installed so far.
export function calcExpansion(id) {
  let installed = 0;
  return fromStart(calculated.stages).map(([ph, p]) => {
    const required = p.rows?.find(x => x.id === id)?.machines || 0;
    const add = Math.max(0, required - installed);
    installed = Math.max(installed, required);
    return { phase: ph, required: required || '—', add: add ? '+' + add : '—' };
  });
}

// HTML for #resources on a calculated profile: power tiles (somersloop and augmenter tiles
// only when used), raw resources against the entered budgets (settings.limits), then drone
// fuel, protected storage, credited existing production, conversions and surplus.
export function renderCalculatedResources() {
  const x = calcStage(),
    s = calculated.settings;
  const conversions = x.conversions || [];
  return String(
    html`${header(
        'CHECK BEFORE EXPANDING',
        'Power & resources',
        'New production and new generator fuel are included. Existing fuel consumption must already be deducted from your entered budgets.',
      )}
      ${calcWarnings()}
      <div class="stats">
        ${stat('New generation', power(x.generationMW), 'Fuel and recycling included')}
        ${stat('Whole-machine peak', power(x.peakMW), 'At selected consumption multiplier')}
        ${stat(
          'With utility allowance',
          power(x.requiredMW),
          (s.utilityPercent ?? 20) + '% for transport and utilities; verify actual load',
        )}
        ${stat(
          'Existing spare power',
          power(s.availablePowerGW * 1000),
          'Not total installed generation',
        )}
        ${x.sloopsUsed > 0 &&
        stat(
          'Somersloops in production',
          num(x.sloopsUsed),
          'Amplified machines: double output, four times the power',
        )}
        ${x.augmenters > 0 &&
        stat(
          'With augmenter boost',
          power(x.availableMW),
          num(x.augmenters) +
            ' augmenter' +
            (x.augmenters > 1 ? 's' : '') +
            ' · ' +
            num(x.augmenterMW) +
            ' MW plus ' +
            Math.round(x.boost * 100) +
            '% of base production',
        )}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Required /min</th>
              <th>Budget /min</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            ${workspace.catalog.raw.map(
              n =>
                html`<tr>
                  <td class="resource-name">${itemIcon(n)}<span>${n}</span></td>
                  <td>${num(x.raw?.[n])}</td>
                  <td>${num(s.limits[n])}</td>
                  <td class="${(x.raw?.[n] || 0) > s.limits[n] ? 'warn' : ''}">
                    ${num(s.limits[n] - (x.raw?.[n] || 0))}
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="backup-grid">
        <section class="panel">
          <h2>Dedicated drone fuel /min</h2>
          <p>${inputText(x.drone || {}) || 'No dedicated drone fuel in this phase.'}</p>
          <h2>Protected storage /min</h2>
          <p>${inputText(x.storage || {}) || 'No storage production requested.'}</p>
          <h2>From production you already run</h2>
          <p>${inputText(x.supplied || {}) || 'None credited in this phase.'}</p>
          ${Object.keys(x.supplied || {}).length > 0 &&
          html`<p class="small muted">
            The plan does not build these lines or the chain behind them. Their extraction is
            assumed to be outside the budgets above.
          </p>`}
        </section>
        <section class="panel">
          <h2>Conversion and byproducts</h2>
          <p>
            ${conversions.length
              ? conversions.flatMap((c, i) => (i ? [html`<br />`, c] : [c]))
              : 'No raw-resource conversion required.'}
          </p>
          <p>Plutonium rods to sink: ${num(x.plutoniumSink)}/min.</p>
          <p>Surplus solids: ${inputText(x.surplus || {}) || 'None'}</p>
          <p class="small muted">
            Liquid and radioactive material balances are enforced. Do not let storage or overflow
            block recycling.
          </p>
        </section>
      </div>`,
  );
}
