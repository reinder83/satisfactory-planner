// Build-plan checklist steps: per-profile edits, links and icons, read by the build plan's
// components (ui/plan/). The storage page's fixed checklists use the same step component and
// icons (ui/storage/StorageChecklist.vue).
// A step's id is its checklist key in state.checks; edits (rename, reorder, remove,
// link) are stored separately in state.taskEdits keyed by that id, so they never
// change the id or lose its checkmark.
import { placeName } from './group-links.ts';
import { homeGroup, LINK_DUST, rowPlaces } from './group-order.ts';
import { calcStage, calculated, checked, hideDone, phase, query, state } from './session.ts';
import { buildRowName, calcTasks, orderedPhaseSteps, rowIcon } from './views/calculated.ts';
import { factoryGroupsState } from './views/factories.ts';
import type { CalcRow, Phase, TaskEdits } from '../types/index.ts';

// A build-plan step: a calculated (or plan guide's) one or a personal one. id is its saved check key;
// personal tasks have no body.
export interface Step {
  id: string;
  title: string;
  body?: string;
}

// The production line a step links to (taskLink): its "Production line ↗" button opens the
// line's dialog, and "Open factory: <name> →" goes to `factory`'s flow page (#1047).
export interface StepLink {
  id: string;
  name: string;
  factory: StepFactory | null;
}

// The factory (a factory group) a step's production line is built with: its home group
// (homeGroup in group-order.ts), the rule the build plan places the step by, so the link goes to
// the factory whose build order lists the line. `others` names the other places the line is
// split over (other factories, and Ungrouped for a part no factory takes); empty when it is whole.
export interface StepFactory {
  id: string;
  name: string;
  others: string[];
}

// A step's icon (taskIcon): an item's bundled icon, or a TASK_GLYPHS category glyph.
export type StepIconData = { item: string; kind?: undefined } | { kind: string; item?: undefined };

// A step as the checklist draws it (ui/plan/Checklist.vue): the step with its tick, icon,
// production-line and factory links, and while it is being edited the edit form's choices. The storage
// page's fixed checklists (ui/storage/StorageChecklist.vue) have no personal tasks or edits.
export interface PlanStepView extends Step {
  done: boolean;
  icon: StepIconData;
  link: StepLink | null;
  custom?: boolean;
  form?: ReturnType<typeof taskLinkChoices> | null;
}

// A step in "Removed steps in this phase". `shared` says which other phases list the same
// step, so removing and restoring it applies there too (shared-steps.ts, #744).
export interface RemovedStepView {
  id: string;
  title: string;
  icon: StepIconData;
  shared?: string;
}

// The profile's step edits with every part defaulted, so callers can read them freely.
// order is per phase; titles, bodies and links are keyed by step id.
export function taskEditsState(): TaskEdits {
  const edits: Partial<TaskEdits> = state?.taskEdits || {};
  return {
    order: edits.order || {},
    removed: edits.removed || [],
    titles: edits.titles || {},
    bodies: edits.bodies || {},
    links: edits.links || {},
  };
}

// A step with the user's edited title and body in place of the generated ones, where edited.
function withEditedWording(t: Step, edits: TaskEdits): Step {
  return { ...t, title: edits.titles[t.id] || t.title, body: edits.bodies[t.id] || t.body };
}

// Applies the user's edits to phase `shownPhase`'s generated steps and personal tasks: drops
// removed ones, swaps in edited wording and sorts by the saved order for that phase
// (inEditedOrder).
function applyTaskEdits(generated: Step[], personal: Step[], shownPhase: Phase): Step[] {
  const edits = taskEditsState();
  return inEditedOrder(generated, personal, shownPhase, t => t.id).map(t =>
    withEditedWording(t, edits),
  );
}

// Phase `shownPhase`'s generated steps and personal tasks (steps, or only their ids: `idOf`
// reads a step's id) less the removed ones, sorted by the saved order for that phase, with the
// steps missing from it put in where withNewSteps places them. The one place the build plan's
// step order is worked out: planTasks() lists the steps, planTaskIds() only their ids (#768).
function inEditedOrder<T>(
  generated: readonly T[],
  personal: readonly T[],
  shownPhase: Phase,
  idOf: (step: T) => string,
): T[] {
  const edits = taskEditsState(),
    removed = new Set(edits.removed);
  const visible = [...generated, ...personal].filter(t => !removed.has(idOf(t)));
  const savedOrder = edits.order[shownPhase];
  if (!savedOrder?.length) return visible;
  const merged = withNewSteps(savedOrder, generated.map(idOf), personal.map(idOf));
  const position = new Map(merged.map((id, i): [string, number] => [id, i]));
  // withNewSteps lists every generated step and personal task, so each one has a place.
  return visible.sort((a, b) => position.get(idOf(a))! - position.get(idOf(b))!);
}

// A phase's saved step order with the phase's steps that are missing from it put in (new in a
// later release, moved in from another phase, or added since; #779). A generated step goes
// straight after the nearest generated step before it that the saved order lists, so it keeps
// its place beside its generated neighbours, and several in a row keep their generated order.
// When none before it is listed, it goes just before the first generated step the saved order
// lists (personal tasks the user put above that stay on top), or after the saved order when it
// lists none. A personal task goes last, where it was added. Ids in the saved order that the
// phase no longer has stay listed (the build plan skips them), and removed steps are placed
// like the others, so they have a place for when they are restored.
export function withNewSteps(
  saved: readonly string[],
  generated: readonly string[],
  personal: readonly string[],
): string[] {
  const listed = new Set(saved),
    after = new Map<string, string[]>();
  let anchor = '';
  for (const id of generated) {
    if (listed.has(id)) anchor = id;
    else after.set(anchor, [...(after.get(anchor) || []), id]);
  }
  // The steps no listed generated step precedes go before the first one the saved order lists.
  const ofPlan = new Set(generated),
    first = saved.findIndex(id => ofPlan.has(id)),
    leading = after.get('') || [];
  const merged = saved.flatMap(id => [id, ...(after.get(id) || [])]);
  merged.splice(first < 0 ? merged.length : merged.indexOf(saved[first]!), 0, ...leading);
  return [...merged, ...personal.filter(id => !listed.has(id))];
}

// Every step id this phase's saved order should keep, in order: the saved order with the
// phase's other steps put in where withNewSteps places them, so the steps on screen are in the
// order the build plan shows them (including steps removed or not in the plan right now). A
// reorder rearranges only the steps on screen within their own slots of this list, so a
// removed step keeps its place for when it is restored.
// A saved order holds at most 600 ids (taskOrder in state.ts), so past that the places of
// steps not in this phase's plan any more are dropped, earliest first; steps in the plan,
// removed ones included, always keep theirs.
export function taskOrderSlots(): string[] {
  const generated = generatedTaskIds(),
    personal = personalTasks().map(t => t.id);
  const inPlan = new Set([...generated, ...personal]);
  const slots = withNewSteps(taskEditsState().order[phase()] || [], generated, personal);
  let excess = slots.length - 600;
  return excess > 0 ? slots.filter(id => inPlan.has(id) || excess-- <= 0) : slots;
}

// The generated steps of phase `shownPhase` (the current phase unless given), before edits:
// the calculated profile's (calcTasks, its guide's on a profile migrated from the handbook),
// or none while no calculated profile is open.
export function generatedTasks(shownPhase: Phase = phase()): Step[] {
  return calculated ? calcTasks(shownPhase) : [];
}

// The ids of generatedTasks(shownPhase), in the same order, without describing the steps: they
// come straight from orderedPhaseSteps (views/calculated.ts), which calcTasks describes, so no
// production row's step text is written only to be dropped (#768).
export function generatedTaskIds(shownPhase: Phase = phase()): string[] {
  return calculated ? orderedPhaseSteps(shownPhase).map(step => step.id) : [];
}

// Phase `shownPhase`'s steps before edits (the current phase unless given): its generated steps,
// plus the user's personal (custom-...) tasks for that phase.
export function basePlanTasks(shownPhase: Phase = phase()): Step[] {
  return [...generatedTasks(shownPhase), ...personalTasks(shownPhase)];
}

// The user's personal (custom-...) tasks for phase `shownPhase`, in the order they were added.
function personalTasks(shownPhase: Phase = phase()): Step[] {
  return state.customTasks.filter(t => t.phase === shownPhase);
}

// The steps of phase `shownPhase` (the current phase unless given) as the user sees them in the
// build plan: edits applied, no search filter. Another phase's steps are worked out the same way
// without opening it (phaseStepIds in opening-phase.ts).
export function planTasks(shownPhase: Phase = phase()): Step[] {
  return applyTaskEdits(generatedTasks(shownPhase), personalTasks(shownPhase), shownPhase);
}

// The ids of planTasks(shownPhase), in the same order: the same edits applied to the step ids
// alone (generatedTaskIds), for callers that read only the ids (phaseStepIds in
// opening-phase.ts, #768).
export function planTaskIds(shownPhase: Phase = phase()): string[] {
  const personal = personalTasks(shownPhase).map(t => t.id);
  return inEditedOrder(generatedTaskIds(shownPhase), personal, shownPhase, id => id);
}

// The current phase's removed steps, in their generated order and with the user's edited
// wording, so "Removed steps in this phase" names each step as the checklist did (#639).
export function removedPlanTasks(): Step[] {
  const edits = taskEditsState(),
    removed = new Set(edits.removed);
  return basePlanTasks()
    .filter(t => removed.has(t.id))
    .map(t => withEditedWording(t, edits));
}

// A calculated production step (calc-<phase>-<rowId>) links to its own production line (row).
// Returns that row id, or '' for any other step.
export const autoTaskLink = (id: string) => id.match(/^calc-(?:[1-5]|post)-(.+)$/)?.[1] || '';

// The production line (row) a step links to: its saved link, or else the automatic one. A saved
// link of '-' (StepEditForm.vue's "No linked production line" on an automatically linked step)
// means none. No factory or row has that id, so releases before it also show no link.
export const stepLink = (id: string) => {
  const saved = taskEditsState().links[id];
  return saved === '-' ? '' : saved || autoTaskLink(id);
};

// The calculated row a step links to, as { id, name, factory } for its "Production line ↗"
// button (opened by data-calc-factory) and its "Open factory: <name> →" link, or null when the
// step has no link or the linked row is not part of the current phase. It names the row as the
// dialog it opens is headed (buildRowName), so a group's own line made on site is "Wire for
// Alpha" on both (#946).
export function taskLink(step: Step): StepLink | null {
  const linked = stepLink(step.id);
  if (!linked) return null;
  const row = (calcStage()?.rows || []).find(r => r.id === linked);
  return row ? { id: row.id, name: buildRowName(row.id), factory: rowFactory(row) } : null;
}

// The factory `row` is built with (StepFactory), or null for a row in no factory (Ungrouped).
export function rowFactory(row: CalcRow): StepFactory | null {
  const groups = factoryGroupsState();
  const home = homeGroup(row, groups);
  const factory = groups.groups.find(group => group.id === home);
  if (!factory) return null;
  const others = [...rowPlaces(row, groups)]
    .filter(([place, share]) => place !== home && share > LINK_DUST)
    .map(([place]) => placeName(place, groups.groups, undefined));
  return { id: factory.id, name: factory.name, others };
}

// What a step's edit form offers: the production lines of this phase as [row id, name], and
// the one the step links to now (its saved link, or the automatic one).
export function taskLinkChoices(step: Step): {
  options: [id: string, name: string][];
  current: string;
} {
  return {
    options: (calcStage()?.rows || []).map((r): [string, string] => [r.id, r.name]),
    current: stepLink(step.id),
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
// wording of a plan guide's step or a personal one.
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
export function taskKind(step: Step): string {
  const id = step.id || '';
  if (id.startsWith('unlock-')) return /^mam:/i.test(step.title || '') ? 'research' : 'milestone';
  for (const [pattern, kind] of TASK_ID_KINDS) if (pattern.test(id)) return kind;
  const text = (id + ' ' + (step.title || '')).toLowerCase();
  for (const [pattern, kind] of TASK_TEXT_KINDS) if (pattern.test(text)) return kind;
  return 'production';
}

// The part a step makes, taken from its linked production line: calculated production
// steps link themselves (a generator shows its building, rowIcon), a guide's or a personal
// step uses the chosen link.
function taskIconItem(step: Step): string {
  const linked = stepLink(step.id);
  if (!linked) return '';
  const row = (calcStage()?.rows || []).find(r => r.id === linked);
  return row ? rowIcon(row) : '';
}

// A step's icon: { item } for the made item's bundled icon, otherwise { kind } for its
// TASK_GLYPHS category glyph (ui/plan/StepIcon.vue draws it).
export function taskIcon(step: Step): StepIconData {
  const item = taskIconItem(step);
  return item ? { item } : { kind: taskKind(step) };
}

// Applies the "Hide completed" toggle and the step search to a list of steps.
export function filteredPlanTasks(steps: Step[]): Step[] {
  const search = query.trim().toLowerCase();
  return steps.filter(
    step =>
      (!hideDone || !checked(step.id)) &&
      (!search || (step.title + ' ' + (step.body || '')).toLowerCase().includes(search)),
  );
}
