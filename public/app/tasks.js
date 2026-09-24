// Build-plan checklist steps: per-profile edits, links, icons and rendering.
// Used by views/plan.js (handbook) and views/calculated.js (calculated profiles).
// A step's id is its checklist key in state.checks; edits (rename, reorder, remove,
// link) are stored separately in state.taskEdits keyed by that id, so they never
// change the id or lose its checkmark.
import { itemIcon } from './format.js';
import { html, raw } from './html.js';
import {
  calcStage,
  calculated,
  checked,
  doneAttr,
  editingTask,
  hideDone,
  phase,
  plan,
  planEditing,
  query,
  stage,
  state,
} from './session.js';
import { calcTasks } from './views/calculated.js';

// The profile's step edits with every part defaulted, so callers can read them freely.
// order is per phase; titles, bodies and links are keyed by step id.
export function taskEditsState() {
  const e = state?.taskEdits || {};
  return {
    order: e.order || {},
    removed: e.removed || [],
    titles: e.titles || {},
    bodies: e.bodies || {},
    links: e.links || {},
  };
}

// Applies the user's edits to the generated steps: drops removed ones, swaps in edited
// wording and sorts by the saved order for this phase. Steps missing from the saved
// order (new in a later release, or added since) keep their place after the ordered ones.
function applyTaskEdits(base) {
  const e = taskEditsState(),
    removed = new Set(e.removed);
  const visible = base
    .filter(t => !removed.has(t.id))
    .map(t => ({ ...t, title: e.titles[t.id] || t.title, body: e.bodies[t.id] || t.body }));
  const ord = e.order[phase()];
  if (!ord?.length) return visible;
  const pos = new Map(ord.map((id, i) => [id, i]));
  return [
    ...visible.filter(t => pos.has(t.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)),
    ...visible.filter(t => !pos.has(t.id)),
  ];
}

// The current phase's steps before edits: calculated steps or handbook steps, plus the
// user's personal (custom-...) tasks for this phase.
export function basePlanTasks() {
  return calculated
    ? [...calcTasks(), ...state.customTasks.filter(t => t.phase === phase())]
    : tasks();
}

// The steps as the user sees them in the build plan (edits applied, no search filter).
export function planTasks() {
  return applyTaskEdits(basePlanTasks());
}

// A calculated production step (calc-<phase>-<rowId>) links to its own factory row.
// Returns that row id, or '' for any other step.
export const autoTaskLink = id => id.match(/^calc-(?:[1-5]|post)-(.+)$/)?.[1] || '';

// HTML for the "Open factory" button of a linked step, or '' when the step has no link
// or the linked factory is not part of the current phase.
function taskLinkHtml(t) {
  const linked = taskEditsState().links[t.id] || autoTaskLink(t.id);
  if (!linked) return '';
  if (calculated) {
    const row = (calcStage().rows || []).find(r => r.id === linked);
    return row
      ? html`<button class="btn quiet task-link" data-calc-factory="${row.id}">
          Open factory: ${row.name} ↗
        </button>`
      : '';
  }
  const f = plan.factories.find(x => x.id === linked && x.stages[stage()]);
  return f
    ? html`<button class="btn quiet task-link" data-factory="${f.id}">
        Open factory: ${f.name} ↗
      </button>`
    : '';
}

// HTML for the inline edit form that replaces a step while it is being edited. Submitted
// as data-task-edit and handled in events/views.js, which stores only what differs from
// the generated step.
function taskEditForm(t) {
  const options = calculated
    ? (calcStage().rows || []).map(r => [r.id, r.name])
    : plan.factories.filter(f => f.stages[stage()]).map(f => [f.id, f.name]);
  const current = taskEditsState().links[t.id] || autoTaskLink(t.id);
  return html`<form class="task task-edit" data-task-edit="${t.id}">
    <label class="field"
      >Step title<input name="title" maxlength="240" required value="${t.title}"
    /></label>
    <label class="field"
      >Details<textarea name="body" class="notes" maxlength="6000">${t.body || ''}</textarea>
    </label>
    <label class="field"
      >Linked factory<select name="link">
        <option value="">No linked factory</option>
        ${options.map(
          ([v, l]) => html`<option value="${v}" ${v === current && raw('selected')}>${l}</option>`,
        )}
      </select></label
    >
    <div class="task-edit-actions">
      <button class="btn primary" type="submit">Save step</button>
      <button class="btn" type="button" data-cancel-task-edit>Cancel</button>
    </div>
    <p class="small muted">
      Restore the original text by clearing a field. The step keeps its checkmark either way.
    </p>
  </form>`;
}

// A step's icon says what kind of work it is at a glance: a linked or calculated
// production line shows the part it makes, every other step a category glyph.
const TASK_GLYPHS = {
  production:
    '<path d="M3 20.5h18M5.5 20.5v-9l4 2.6v-2.6l4 2.6v-2.6l4 2.6v6.4M17.5 9.2V4h2.2v5.2"/>',
  build: '<path d="M3.5 3.5h17v17h-17zM3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>',
  power: '<path d="M13.4 2.5 4.8 13.6h5.3l-.9 7.9 8.6-11.1h-5.3z"/>',
  biomass:
    '<path d="M20.5 3.5C9.5 3.5 4 8.8 4 14.8a5.2 5.2 0 0 0 5.2 5.2c6 0 11.3-5.5 11.3-16.5Z"/><path d="M5.5 19C9 13 13.2 9.7 18.5 7.4"/>',
  nuclear:
    '<circle cx="12" cy="12" r="1.9"/><ellipse cx="12" cy="12" rx="9.2" ry="3.7"/><ellipse cx="12" cy="12" rx="9.2" ry="3.7" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.2" ry="3.7" transform="rotate(120 12 12)"/>',
  fluid: '<path d="M12 3.2c4 5 6.4 8.1 6.4 11a6.4 6.4 0 1 1-12.8 0c0-2.9 2.4-6 6.4-11Z"/>',
  milestone:
    '<rect x="4" y="10.4" width="16" height="10.6" rx="1.4"/><path d="M8.2 10.4V7.2A3.9 3.9 0 0 1 16 6.6"/><path d="M12 14.3v3"/>',
  research:
    '<path d="M9.4 3.2v6.4l-4.8 8.6A2 2 0 0 0 6.3 21.2h11.4a2 2 0 0 0 1.7-3L14.6 9.6V3.2"/><path d="M7.9 3.2h8.2M7.3 15.2h9.4"/>',
  harddrive:
    '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="12" cy="12" r="3.3"/><circle cx="12" cy="12" r=".5"/>',
  storage:
    '<rect x="3.2" y="5.6" width="17.6" height="13.4" rx="1.2"/><path d="M3.2 10.4h17.6M12 10.4V19M7.6 5.6v4.8M16.4 5.6v4.8"/>',
  delivery:
    '<path d="M12 2.4c3 2.7 4.7 6.4 4.7 10.5v3H7.3v-3C7.3 8.8 9 5.1 12 2.4Z"/><path d="M7.3 12.8 4 15.6v3.6l3.3-1.7M16.7 12.8 20 15.6v3.6l-3.3-1.7M10.4 21.3h3.2"/><circle cx="12" cy="9.4" r="1.6"/>',
  logistics:
    '<path d="M3.5 17.5h5.2a4.2 4.2 0 0 0 4.2-4.2v-2.6a4.2 4.2 0 0 1 4.2-4.2h3.4"/><path d="m17.4 3.4 3.1 3.1-3.1 3.1"/>',
  portal:
    '<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="4.4"/><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6"/>',
  survey: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m15.4 15.4 5.1 5.1"/>',
  retire: '<circle cx="12" cy="12" r="8.8"/><path d="m5.8 5.8 12.4 12.4"/>',
  note: '<path d="m4 20.2.9-4.2L16 4.9l3.3 3.3L8.2 19.3z"/><path d="m14.4 6.5 3.3 3.3"/>',
};

// Generated step identifiers are stable, so match those before reading the
// wording of a handbook step or a personal one.
const TASK_ID_KINDS = [
  [/^custom-/, 'note'],
  [/^recipe-unlock-|^hard-drives-/, 'harddrive'],
  [/^retire-/, 'retire'],
  [/^portal-supply/, 'portal'],
  [/^drone-fuel-/, 'logistics'],
  [/^startup-(?:biomass|solid-biofuel|burner-bank)/, 'biomass'],
  [/^startup-nuclear-/, 'nuclear'],
  [/^startup-aluminum-/, 'fluid'],
  [/^startup-\d+-power-review$|^startup-coal-unlock$|^startup-fuel-|^preferred-power-/, 'power'],
  [/^early-base-hub$/, 'build'],
  [/^early-base-logistics$/, 'logistics'],
  [/^early-base-reserves$/, 'storage'],
  [/^early-base-/, 'production'],
];

// Fallback: keywords in the id or title, first match wins, so order matters.
const TASK_TEXT_KINDS = [
  [/retire|dismantle|decommission/, 'retire'],
  [/portal/, 'portal'],
  [/nuclear|uranium|plutonium|ficsonium|radioactive/, 'nuclear'],
  [/drone/, 'logistics'],
  [/deliver|elevator/, 'delivery'],
  [/survey|verify|resilience|review|\btest\b/, 'survey'],
  [/power|generator|fuel|coal/, 'power'],
  [/storage|container/, 'storage'],
  [/unlock|milestone|research/, 'milestone'],
  [/logistic|belt|train|sorter|collectable/, 'logistics'],
  [/aluminum|water/, 'fluid'],
  [/concrete|construction|foundation|workshop|hub/, 'build'],
];

// The TASK_GLYPHS key for a step. Unlock steps are MAM research when titled "MAM: ...",
// otherwise HUB milestones; anything unmatched counts as production.
function taskKind(t) {
  const id = t.id || '';
  if (id.startsWith('unlock-')) return /^mam:/i.test(t.title || '') ? 'research' : 'milestone';
  for (const [re, kind] of TASK_ID_KINDS) if (re.test(id)) return kind;
  const text = (id + ' ' + (t.title || '')).toLowerCase();
  for (const [re, kind] of TASK_TEXT_KINDS) if (re.test(text)) return kind;
  return 'production';
}

// The part a step makes, taken from its linked factory: calculated production
// steps link themselves, a handbook or personal step uses the chosen link.
function taskIconItem(t) {
  const linked = taskEditsState().links[t.id] || autoTaskLink(t.id);
  if (!linked) return '';
  if (calculated) {
    const row = (calcStage().rows || []).find(r => r.id === linked);
    return (row && Object.keys(row.outputs || {})[0]) || '';
  }
  const f = plan.factories.find(x => x.id === linked && x.stages[stage()]);
  return f ? f.name : '';
}

// HTML for a step's icon: the made item's bundled icon, otherwise the category glyph.
function taskIconHtml(t) {
  const item = taskIconItem(t);
  if (item)
    return html`<span class="task-icon" data-kind="item" aria-hidden="true"
      >${itemIcon(item)}</span
    >`;
  const kind = taskKind(t);
  return html`<span class="task-icon" data-kind="${kind}" aria-hidden="true"
    ><svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${raw(TASK_GLYPHS[kind])}
    </svg></span
  >`;
}

// HTML for one checklist step: checkbox (data-check=<step id>, the saved checklist key),
// icon, expandable text and link. In edit mode it adds move/edit/remove tools, or shows
// the edit form for the step being edited. Also used by views/storage.js.
export function taskHtml(t) {
  if (planEditing && editingTask === t.id) return taskEditForm(t);
  const tools =
    planEditing &&
    html`<span class="task-tools"
      ><button
        class="btn quiet"
        data-move-task="${t.id}"
        data-dir="-1"
        aria-label="Move up: ${t.title}"
      >
        ↑</button
      ><button
        class="btn quiet"
        data-move-task="${t.id}"
        data-dir="1"
        aria-label="Move down: ${t.title}"
      >
        ↓</button
      ><button class="btn quiet" data-edit-task="${t.id}">Edit</button
      ><button class="btn quiet danger" data-remove-step="${t.id}">Remove</button></span
    >`;
  return html`<article class="task ${planEditing ? 'is-editing' : ''}">
    <input
      type="checkbox"
      data-check="${t.id}"
      aria-label="Complete: ${t.title}"
      ${raw(doneAttr(t.id))}
    />${taskIconHtml(t)}
    <details data-task="${t.id}">
      <summary>${t.title}</summary>
      <p>${t.body || 'Your own task for this phase.'}</p>
      ${taskLinkHtml(t)}${t.id.startsWith('custom-') &&
      !planEditing &&
      html`<button class="delete-task" data-remove="${t.id}">Delete personal task</button>`}
    </details>
    ${tools}
  </article>`;
}

// HTML for the "Edit steps" / "Done editing" toggle (data-toggle-plan-edit).
export function planEditToolbar() {
  return html`<button class="btn ${planEditing ? 'primary' : ''}" data-toggle-plan-edit>
    ${planEditing ? 'Done editing' : 'Edit steps'}
  </button>`;
}

// Applies the "Hide completed" toggle and the step search to a list of steps.
function filteredPlanTasks(ts) {
  const q = query.trim().toLowerCase();
  return ts.filter(
    t =>
      (!hideDone || !checked(t.id)) &&
      (!q || (t.title + ' ' + (t.body || '')).toLowerCase().includes(q)),
  );
}

// HTML for the build-plan checklist: search/hide-completed tools, the filtered steps,
// or an empty-state message that says why nothing is shown.
export function checklistHtml(ts) {
  const shown = filteredPlanTasks(ts);
  const empty = !ts.length
    ? 'Every step of this phase is removed. Use Removed steps below to restore them.'
    : query.trim()
      ? 'No steps match this search.'
      : 'Every step of this phase is completed. Untick “Hide completed” to review them.';
  return html`${ts.length > 0 &&
    html`<div class="checklist-tools">
      <input
        id="plan-search"
        class="search"
        placeholder="Find a step…"
        aria-label="Find a step"
        value="${query}"
      /><label class="check-row small"
        ><input type="checkbox" id="hide-done" ${hideDone && raw('checked')} />Hide completed</label
      ><span class="small muted"
        >${shown.length !== ts.length && shown.length + ' of ' + ts.length + ' steps'}</span
      >
    </div>`}
    <div class="checklist">
      ${shown.length ? shown.map(taskHtml) : html`<div class="empty-state">${empty}</div>`}
    </div>`;
}

// HTML for the "Removed steps" panel shown while editing, with a Restore button per
// step. Removed steps keep their checklist key and checkmark, so restoring loses nothing.
export function removedStepsHtml() {
  if (!planEditing) return '';
  const removed = new Set(taskEditsState().removed);
  const list = basePlanTasks().filter(t => removed.has(t.id));
  if (!list.length) return '';
  return html`<details class="panel removed-steps">
    <summary>Removed steps in this phase (${list.length})</summary>
    ${list.map(
      t =>
        html`<div class="removed-step">
          <span>${taskIconHtml(t)}${t.title}</span
          ><button class="btn quiet" data-restore-task="${t.id}">Restore</button>
        </div>`,
    )}
  </details>`;
}

// Handbook steps for the current phase from plan.json, plus personal tasks.
function tasks() {
  return [...plan.phases[phase()], ...state.customTasks.filter(t => t.phase === phase())];
}
