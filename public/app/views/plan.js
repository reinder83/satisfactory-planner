// Build plan view (#plan) for the original handbook profile. A calculated profile gets
// renderCalculatedPlan in calculated.js instead; render() in shell.js picks one.
import { num, stat } from '../format.js';
import { html } from '../html.js';
import { checked, currentProfile, phase, phaseLabel, plan, stage, state } from '../session.js';
import { header } from '../shell.js';
import { checklistHtml, planEditToolbar, planTasks, removedStepsHtml } from '../tasks.js';
import { storageBays } from './storage.js';

// HTML for the #plan page of the original handbook: summary tiles, the phase checklist
// with its edit toolbar, phase notes, and a side column with the next step and deliveries.
// Post-game ('post') reads the Phase 5 stage of the handbook: stage() maps it to '5'.
export function renderPlan() {
  // Checklist progress: planTasks() already applies this profile's step edits.
  const ts = planTasks(),
    done = ts.filter(t => checked(t.id)).length,
    next = ts.find(t => !checked(t.id)),
    pct = ts.length ? Math.round((done / ts.length) * 100) : 100;
  // Factory and storage counters. The check keys are saved progress and must not change:
  // `factory-<stage>-<id>` is a factory's Running box, `slot-<address>-verified` the last
  // of a container's four checks (see slotKeys in storage.js).
  const fs = plan.factories.filter(f => f.stages[stage()]);
  const built = fs.filter(f => checked('factory-' + stage() + '-' + f.id)).length;
  const slots = storageBays()
      .flatMap(b => b.items)
      .filter(x => x.name),
    ready = slots.filter(x => checked('slot-' + x.id + '-verified')).length;
  // A counter tile's "done / total" value.
  const fraction = (n, total) => html`${n} <span class="fraction">/ ${total}</span>`;
  return String(
    html`${header(
        'THE NEXT BUILD',
        phaseLabel(phase()) + ' field plan',
        phase() === 'post'
          ? 'Storage first. Keep the network running, then finish the remaining items.'
          : 'Build the supply chain in order. Check off each step when it is verified in your save.',
        'YOUR SAVE · YOUR PACE',
      )}
      <div class="stats">
        ${stat('Phase checklist', fraction(done, ts.length), 'Steps completed')}
        ${stat('Factory targets', fraction(built, fs.length), 'Marked running at this phase')}
        ${stat('Storage ready', fraction(ready, slots.length), 'Item positions verified')}
        ${stat(
          'Planned power',
          html`${num(plan.power[stage()])} <span class="fraction">GW</span>`,
          'Gross capacity at this stage',
        )}
      </div>
      <div class="split">
        <section>
          <div class="section-head">
            <h2>Build sequence</h2>
            <span class="head-tools"
              ><span class="small muted">${pct}% complete</span> ${planEditToolbar()}</span
            >
          </div>
          <div class="progress-track"><span style="width:${pct}%"></span></div>
          ${checklistHtml(ts)}${removedStepsHtml()}
          <form id="add-task" class="inline-form">
            <input
              name="title"
              maxlength="240"
              required
              placeholder="Add a task for this phase…"
              aria-label="Personal task"
            /><button class="btn" type="submit">Add task</button>
          </form>
          <section class="panel">
            <h2>Phase notes</h2>
            <p class="small muted">
              Locations, train routes, things to check on your next session.
            </p>
            <textarea id="phase-note" class="notes" maxlength="6000" aria-label="Phase notes">
${state.notes['phase-' + phase()] || ''}</textarea
            >
            <div class="note-save">
              <span class="small muted">Saved only when you click Save notes.</span
              ><button class="btn" data-save-note="phase-${phase()}" data-input="phase-note">
                Save notes
              </button>
            </div>
          </section>
        </section>
        <aside class="side-panels">
          <section class="panel next-card">
            <div class="step-no">${next ? 'NEXT UNFINISHED STEP' : 'PHASE CHECKLIST COMPLETE'}</div>
            <h2>${next?.title || 'Ready for the next phase'}</h2>
            <p>
              ${next?.body ||
              'Verify the delivery, then choose your next phase using the selector above.'}
            </p>
            <a class="btn primary full" href="#factories">Open factory targets →</a>
          </section>
          <section class="panel">
            <h2>${phase() === 'post' ? 'Post-game priority' : 'Elevator delivery'}</h2>
            ${phase() === 'post'
              ? html`<p>
                    Protect the storage allowances. Reduce former elevator exports when the new
                    completion factories need those resources. Sink the remaining surplus.
                  </p>
                  <a class="btn" href="#factories">Completion modules →</a>`
              : plan.deliveries.filter(d => d.phase === phase()).map(deliveryHtml)}
          </section>
          <section class="panel accent">
            <h3>Keep the corrections together</h3>
            <p class="small">
              Resource conversion is included. The old coal and temporary fuel plants retire; 44.425
              GW of turbofuel stays. Storage includes collectables Q/R and the workshop underneath.
            </p>
            <a class="btn quiet" href="#resources">Review the resource gate →</a>
          </section>
        </aside>
      </div>`,
  );
}

// HTML for one Space Elevator delivery counter. Shared with the calculated plan, which
// passes ids shaped `<stage>-<item slug>` and initial 0. An unsaved count falls back to the
// handbook's `initial` only on the original profile. The `data-delivery` input is saved by
// the change handler in events/views.js, which rebuilds `d` to check the target.
export function deliveryHtml(d) {
  const v = state.deliveries[d.id] ?? (currentProfile.id === 'original' ? d.initial : 0);
  return html`<div class="delivery">
    <label for="delivery-${d.id}">${d.name}</label>
    <div>
      <input
        id="delivery-${d.id}"
        data-delivery="${d.id}"
        type="number"
        min="0"
        max="${d.target}"
        step="1"
        value="${v}"
      /><small>/ ${num(d.target)}</small>
    </div>
    <div class="progress-track">
      <span style="width:${Math.min(100, (v / d.target) * 100)}%"></span>
    </div>
    <span class="small muted"
      >${d.rate
        ? `${num(d.rate)}/min net · ${num(Math.max(0, d.target - v) / d.rate)} minutes remaining`
        : 'Phase 3 delivery already complete'}</span
    >
  </div>`;
}
