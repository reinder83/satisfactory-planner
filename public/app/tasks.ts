// Build-plan checklist steps: per-profile edits, links and icons, read by the build plan's
// components (ui/plan/). The storage page's fixed checklists use the same step component and
// icons (ui/storage/StorageChecklist.vue).
// A step's id is its checklist key in state.checks; edits (rename, reorder, remove,
// link) are stored separately in state.taskEdits keyed by that id, so they never
// change the id or lose its checkmark.
import {
  calcStage,
  calculated,
  checked,
  hideDone,
  phase,
  plan,
  query,
  stage,
  state,
} from './session.ts';
import { calcTasks } from './views/calculated.ts';
import type { TaskEdits } from '../types/index.ts';

// A build-plan step: a handbook, calculated or personal one. id is its saved check key;
// personal tasks have no body.
export interface Step {
  id: string;
  title: string;
  body?: string;
}

// The factory a step's "Open factory" button opens (taskLink).
export interface StepLink {
  calc: boolean;
  id: string;
  name: string;
}

// A step's icon (taskIcon): an item's bundled icon, or a TASK_GLYPHS category glyph.
export type StepIconData = { item: string; kind?: undefined } | { kind: string; item?: undefined };

// A step as the checklist draws it (ui/plan/Checklist.vue): the step with its tick, icon,
// "Open factory" link, and while it is being edited the edit form's choices. The storage
// page's fixed checklists (ui/storage/StorageChecklist.vue) have no personal tasks or edits.
export interface PlanStepView extends Step {
  done: boolean;
  icon: StepIconData;
  link: StepLink | null;
  custom?: boolean;
  form?: ReturnType<typeof taskLinkChoices> | null;
}

// A step in "Removed steps in this phase".
export interface RemovedStepView {
  id: string;
  title: string;
  icon: StepIconData;
}

// The profile's step edits with every part defaulted, so callers can read them freely.
// order is per phase; titles, bodies and links are keyed by step id.
export function taskEditsState(): TaskEdits {
  const e: Partial<TaskEdits> = state?.taskEdits || {};
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
function applyTaskEdits(base: Step[]): Step[] {
  const e = taskEditsState(),
    removed = new Set(e.removed);
  const visible = base
    .filter(t => !removed.has(t.id))
    .map(t => ({ ...t, title: e.titles[t.id] || t.title, body: e.bodies[t.id] || t.body }));
  const ord = e.order[phase()];
  if (!ord?.length) return visible;
  const pos = new Map(ord.map((id, i) => [id, i]));
  return [
    ...visible.filter(t => pos.has(t.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!),
    ...visible.filter(t => !pos.has(t.id)),
  ];
}

// The current phase's steps before edits: calculated steps or handbook steps, plus the
// user's personal (custom-...) tasks for this phase.
export function basePlanTasks(): Step[] {
  return calculated
    ? [...calcTasks(), ...state.customTasks.filter(t => t.phase === phase())]
    : tasks();
}

// The steps as the user sees them in the build plan (edits applied, no search filter).
export function planTasks(): Step[] {
  return applyTaskEdits(basePlanTasks());
}

// A calculated production step (calc-<phase>-<rowId>) links to its own factory row.
// Returns that row id, or '' for any other step.
export const autoTaskLink = (id: string) => id.match(/^calc-(?:[1-5]|post)-(.+)$/)?.[1] || '';

// The factory a step links to, as { calc, id, name } for its "Open factory" button
// (calc: a calculated row, opened by data-calc-factory, otherwise a handbook factory,
// opened by data-factory), or null when the step has no link or the linked factory is not
// part of the current phase.
export function taskLink(t: Step): StepLink | null {
  const linked = taskEditsState().links[t.id] || autoTaskLink(t.id);
  if (!linked) return null;
  if (calculated) {
    const row = (calcStage()?.rows || []).find(r => r.id === linked);
    return row ? { calc: true, id: row.id, name: row.name } : null;
  }
  const f = plan.factories.find(x => x.id === linked && x.stages[stage()]);
  return f ? { calc: false, id: f.id, name: f.name } : null;
}

// What a step's edit form offers: the factories of this phase as [id, name], and the one
// the step links to now (its saved link, or the automatic one).
export function taskLinkChoices(t: Step): {
  options: [id: string, name: string][];
  current: string;
} {
  return {
    options: calculated
      ? (calcStage()?.rows || []).map((r): [string, string] => [r.id, r.name])
      : plan.factories.filter(f => f.stages[stage()]).map((f): [string, string] => [f.id, f.name]),
    current: taskEditsState().links[t.id] || autoTaskLink(t.id),
  };
}

// A step's icon says what kind of work it is at a glance: a linked or calculated
// production line shows the part it makes, every other step a category glyph.
export const TASK_GLYPHS: Record<string, string> = {
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
const TASK_ID_KINDS: [RegExp, string][] = [
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
const TASK_TEXT_KINDS: [RegExp, string][] = [
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
export function taskKind(t: Step): string {
  const id = t.id || '';
  if (id.startsWith('unlock-')) return /^mam:/i.test(t.title || '') ? 'research' : 'milestone';
  for (const [re, kind] of TASK_ID_KINDS) if (re.test(id)) return kind;
  const text = (id + ' ' + (t.title || '')).toLowerCase();
  for (const [re, kind] of TASK_TEXT_KINDS) if (re.test(text)) return kind;
  return 'production';
}

// The part a step makes, taken from its linked factory: calculated production
// steps link themselves, a handbook or personal step uses the chosen link.
function taskIconItem(t: Step): string {
  const linked = taskEditsState().links[t.id] || autoTaskLink(t.id);
  if (!linked) return '';
  if (calculated) {
    const row = (calcStage()?.rows || []).find(r => r.id === linked);
    return (row && Object.keys(row.outputs || {})[0]) || '';
  }
  const f = plan.factories.find(x => x.id === linked && x.stages[stage()]);
  return f ? f.name : '';
}

// A step's icon: { item } for the made item's bundled icon, otherwise { kind } for its
// TASK_GLYPHS category glyph (ui/plan/StepIcon.vue draws it).
export function taskIcon(t: Step): StepIconData {
  const item = taskIconItem(t);
  return item ? { item } : { kind: taskKind(t) };
}

// Applies the "Hide completed" toggle and the step search to a list of steps.
export function filteredPlanTasks(ts: Step[]): Step[] {
  const q = query.trim().toLowerCase();
  return ts.filter(
    t =>
      (!hideDone || !checked(t.id)) &&
      (!q || (t.title + ' ' + (t.body || '')).toLowerCase().includes(q)),
  );
}

// Handbook steps for the current phase from plan.json, plus personal tasks.
function tasks(): Step[] {
  return [...(plan.phases[phase()] ?? []), ...state.customTasks.filter(t => t.phase === phase())];
}
