// The /api/update operations: mutate, one handler per update type, and the stale-write check
// (checkBase) both editions run before it. Re-exported by ../state.ts.
import type {
  CustomTask,
  FactoryGroups,
  GroupAssignment,
  LinkTransport,
  Phase,
  ProgressState,
  SavedState,
  StorageEdits,
  TaskEdits,
  UpdateOp,
} from '../types/index.ts';
import {
  MINES_PLACE,
  type Raw,
  addedFloorId,
  addedSlot,
  bayId,
  bayOfSlot,
  baysOn,
  builtinFloors,
  fail,
  floorId,
  groupId,
  handbookBay,
  handbookFloor,
  isPhase,
  knownFloor,
  label,
  linkKey,
  linkTransport,
  plain,
  safeKey,
  slotAddr,
  sourcePlace,
  validateEdits,
  validateGroups,
  validateState,
  validateTaskEdits,
} from './validate.ts';
import { ITEM_NAMES } from './items.ts';

// Operations that send a whole value the tab worked out from the state it last showed: a
// phase's full step order, a floor's bay order (#191), a container move with the items the
// tab showed at both addresses (#208), a note's whole text, a step's title/body/link. Applied
// on top of a newer state (another tab or device wrote in between), they would silently undo
// that write, so both editions refuse them unless the tab saw the current revision (#165).
// Small operations (a tick, a count, one assignment) merge safely and are never refused.
const baseSensitive = ['taskOrder', 'note', 'taskEdit', 'storageBayOrder', 'storageSlotMove'];
export const staleWrite =
  'This profile was changed in another tab or on another device, so your last change was not ' +
  'saved. The page now shows the latest version; text you typed is kept, and saving it again ' +
  'replaces the other version.';
// A note write that names the saved text it was typed over (`base`, #1052) is refused when the
// note now says something else, so neither person's text replaces the other's without a choice:
// the notes box then shows both versions and asks which to keep (ui/note-draft.ts).
export const noteConflict =
  'This note was changed in another tab or on another device, so your text was not saved. ' +
  'Both versions are shown under the note: choose which to keep.';
// Whitespace alone is no note: a blank note is saved by deleting it (setRecord below).
const noteText = (text: unknown) => (typeof text === 'string' && text.trim() ? text : '');
// `base` is the X-Planner-Revision header: the revision the tab's state had when it sent
// the write. Without the header (an older page, a script) nothing is compared. A note write
// with its own `base` text (#1052) is compared by that text instead, whatever the header says:
// only that note's change can be undone by it, and a tick saved meanwhile elsewhere cannot.
export function checkBase(current: SavedState, update: unknown, base: string | null | undefined) {
  if (plain(update) && update.type === 'note' && typeof update.base === 'string') {
    const key = update.key;
    const saved =
      typeof key === 'string' && Object.hasOwn(current.notes ?? {}, key) ? current.notes[key] : '';
    if (noteText(saved) !== noteText(update.base))
      throw Object.assign(Error(noteConflict), { status: 409 });
    return;
  }
  if (base === null || base === undefined || base === '') return;
  const type = (update as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !baseSensitive.includes(type)) return;
  const seen = Number(base);
  if (!Number.isSafeInteger(seen)) return;
  if (seen !== (current.revision ?? 0)) throw Object.assign(Error(staleWrite), { status: 409 });
}

// Applies one /api/update operation (update.type below) to a state and returns the validated
// result. It changes state in place first: the server passes the profile inside its draft copy
// of the workspace and browser-api.ts passes a structuredClone, so a throw from the final
// validateState discards the change. Values such as a check's boolean or a delivery count
// are only type-checked there, not here.
//
// The operation arrives as the request body, so it is checked as unknown data here, whatever
// its declared type (UpdateOp, for callers). Values only validateState checks are written as
// they came (the casts below), and a malformed one fails there. state may be a stored state of
// any version: each section is normalised before it is edited.
export function mutate(state: SavedState, update: UpdateOp): ProgressState {
  const input: unknown = update;
  if (!plain(input)) fail('Invalid update.');
  // A type that is not a string is refused here, before any lookup.
  if (typeof input.type !== 'string') fail('Unknown update.');
  stateEditFor(input.type)(state, input);
  return validateState(state);
}
// One update applied to state (see mutate).
type StateEdit = (state: SavedState, update: Raw) => void;
// The edit for update `type`: a progress record's own (recordEdits), else the one of its family,
// which looks up its own table: mutateTasks, mutateGroups or mutateLayout.
function stateEditFor(type: string): StateEdit {
  // Own keys only: 'toString' and the other Object.prototype keys are unknown updates.
  if (Object.hasOwn(recordEdits, type)) return recordEdits[type]!;
  if (type.startsWith('task')) return mutateTasks;
  if (type.startsWith('factory')) return mutateGroups;
  if (type.startsWith('storage')) return mutateLayout;
  fail('Unknown update.');
}
// check, note and delivery: one record under its address. A blank note is deleted.
function setRecord(state: SavedState, update: Raw) {
  if (!safeKey(update.key)) fail('Invalid record address.');
  const type = update.type as 'check' | 'note' | 'delivery';
  const kind = ({ check: 'checks', note: 'notes', delivery: 'deliveries' } as const)[type];
  if (type === 'note' && typeof update.value === 'string' && !update.value.trim())
    delete state.notes[update.key];
  else (state[kind] as Raw)[update.key] = update.value;
}
// Ticks or clears many checklist keys at once.
function setChecks(state: SavedState, update: Raw) {
  if (
    !Array.isArray(update.keys) ||
    !update.keys.length ||
    update.keys.length > 1000 ||
    update.keys.some((key: unknown) => !safeKey(key)) ||
    typeof update.value !== 'boolean'
  )
    fail('Invalid checklist update.');
  for (const key of update.keys as string[]) state.checks[key] = update.value;
}
function setPhase(state: SavedState, update: Raw) {
  state.settings.phase = update.value as Phase;
}
function addTask(state: SavedState, update: Raw) {
  state.customTasks.push({ id: update.id, title: update.title, phase: update.phase } as CustomTask);
}
// Deleting a personal task also removes its tick and any step edits naming it. The id is not
// checked: an unknown one matches nothing.
function removeTask(state: SavedState, update: Raw) {
  const id = update.id as string;
  state.customTasks = state.customTasks.filter(task => task.id !== id);
  delete state.checks[id];
  const edits = (state.taskEdits = validateTaskEdits(state.taskEdits));
  delete edits.titles[id];
  delete edits.bodies[id];
  delete edits.links[id];
  edits.removed = edits.removed.filter(stepId => stepId !== id);
  for (const phase of Object.keys(edits.order) as Phase[])
    edits.order[phase] = edits.order[phase]!.filter(stepId => stepId !== id);
}
const recordEdits: Record<string, StateEdit> = {
  check: setRecord,
  note: setRecord,
  delivery: setRecord,
  checks: setChecks,
  phase: setPhase,
  addTask,
  removeTask,
};

// One build-plan step edit, applied to the normalised step edits (see mutateTasks).
type TaskEdit = (edits: TaskEdits, update: Raw) => void;

// Title, body and link of a step; an empty value restores the original.
function editTask(edits: TaskEdits, update: Raw) {
  if (!safeKey(update.id)) fail('Invalid step.');
  const id = update.id;
  const texts: ['titles' | 'bodies', unknown, number][] = [
    ['titles', update.title, 240],
    ['bodies', update.body, 6000],
  ];
  for (const [kind, value, max] of texts) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > max) fail('Invalid step text.');
    if (value.trim()) edits[kind][id] = value.trim();
    else delete edits[kind][id];
  }
  if (update.link === undefined) return;
  if (update.link === '' || update.link === null) delete edits.links[id];
  else {
    if (!safeKey(update.link)) fail('Invalid linked production line.');
    edits.links[id] = update.link;
  }
}
// Hides a step; its tick is kept.
function removeTaskStep(edits: TaskEdits, update: Raw) {
  if (!safeKey(update.id)) fail('Invalid step.');
  const id = update.id;
  if (!edits.removed.includes(id)) edits.removed.push(id);
}
function restoreTaskStep(edits: TaskEdits, update: Raw) {
  if (!safeKey(update.id)) fail('Invalid step.');
  edits.removed = edits.removed.filter(stepId => stepId !== update.id);
}
// The order of one phase's steps, sent whole; an empty list restores the original order.
function orderTasks(edits: TaskEdits, update: Raw) {
  if (
    !isPhase(update.phase) ||
    !Array.isArray(update.ids) ||
    update.ids.length > 600 ||
    update.ids.some((key: unknown) => !safeKey(key)) ||
    new Set(update.ids).size !== update.ids.length
  )
    fail('Invalid step order.');
  if (update.ids.length) edits.order[update.phase] = [...update.ids];
  else delete edits.order[update.phase];
}
const taskEdits: Record<string, TaskEdit> = {
  taskEdit: editTask,
  taskRemove: removeTaskStep,
  taskRestore: restoreTaskStep,
  taskOrder: orderTasks,
};
// Build-plan step edits, one function per update type above.
function mutateTasks(state: SavedState, update: Raw) {
  const edits = (state.taskEdits = validateTaskEdits(state.taskEdits));
  // mutate only sends types starting with 'task', which no Object.prototype key does.
  const edit = taskEdits[update.type as string];
  if (!edit) fail('Unknown update.');
  edit(edits, update);
}

// One factory group edit, applied to the normalised groups (see mutateGroups).
type GroupEdit = (factory: FactoryGroups, update: Raw) => void;

function addGroup(factory: FactoryGroups, update: Raw) {
  if (
    !groupId(update.id) ||
    factory.groups.some(group => group.id === update.id) ||
    !label(update.name)
  )
    fail('Invalid factory.');
  if (factory.groups.length >= 60) fail('You can keep up to 60 factories.');
  factory.groups.push({ id: update.id, name: update.name.trim() });
}
function renameGroup(factory: FactoryGroups, update: Raw) {
  if (!factory.groups.some(group => group.id === update.id)) fail('Unknown factory.');
  if (!label(update.name)) fail('Invalid factory name.');
  // The check above found it.
  factory.groups.find(group => group.id === update.id)!.name = update.name.trim();
}
// Removing a group also drops it from every row's assignment list.
function removeGroup(factory: FactoryGroups, update: Raw) {
  if (!factory.groups.some(group => group.id === update.id)) fail('Unknown factory.');
  factory.groups = factory.groups.filter(group => group.id !== update.id);
  for (const [rowKey, list] of Object.entries(factory.assignments)) {
    const kept = list.filter(member => member.group !== update.id);
    if (kept.length) factory.assignments[rowKey] = kept;
    else delete factory.assignments[rowKey];
  }
  // Its links go too; they joined a place that no longer exists.
  for (const link of Object.keys(factory.links || {}))
    if (link.split(':').includes(update.id as string)) delete factory.links![link];
  if (factory.links && !Object.keys(factory.links).length) delete factory.links;
  // So do the items it made on site (#874).
  if (factory.local) {
    delete factory.local[update.id as string];
    if (!Object.keys(factory.local).length) delete factory.local;
  }
}
// The first choice for one item of a mines link saved before #231 splits that link: the other
// items on it (`siblings`, the sources the page shows going the same way) keep the old choice as
// their own, and the old entry goes, so nothing chosen is lost.
function splitLegacyMinesLink(links: Record<string, LinkTransport>, update: Raw) {
  const legacy = MINES_PLACE + ':' + update.to;
  if (!sourcePlace(update.from) || !links[legacy]) return;
  const siblings = update.siblings ?? [];
  if (!Array.isArray(siblings) || siblings.length > 200 || !siblings.every(sourcePlace))
    fail('Invalid link between factories.');
  for (const sibling of siblings as string[])
    if (sibling !== update.from) links[sibling + ':' + update.to] ??= links[legacy]!;
  delete links[legacy];
}
// The transport on the link from one place to another; belts, the default, are not stored.
function setLinkTransport(factory: FactoryGroups, update: Raw) {
  if (!linkKey(update.from, update.to, new Set(factory.groups.map(group => group.id))))
    fail('Unknown link between factories.');
  const key = update.from + ':' + update.to;
  const links = { ...factory.links };
  splitLegacyMinesLink(links, update);
  if (update.mode === 'belt') delete links[key];
  else
    links[key] = linkTransport({
      mode: update.mode,
      roundTripMin: update.roundTripMin,
      ...(update.fuel === undefined ? {} : { fuel: update.fuel }),
    });
  if (Object.keys(links).length > 500) fail('You can set up to 500 links between factories.');
  if (Object.keys(links).length) factory.links = links;
  else delete factory.links;
}
// The groups a row's machines work in, each with an optional production rate.
function assignGroups(factory: FactoryGroups, update: Raw) {
  if (!safeKey(update.key) || !Array.isArray(update.groups) || update.groups.length > 12)
    fail('Invalid factory assignment.');
  const known = new Set(factory.groups.map(group => group.id)),
    used = new Set<string>();
  const list = update.groups.map((member: unknown): GroupAssignment => {
    if (!plain(member) || !known.has(member.group as string) || used.has(member.group as string))
      fail('Invalid factory assignment.');
    // known holds only group ids, so the check above leaves a string.
    const group = member.group as string;
    used.add(group);
    const rate = member.rate ?? null;
    if (
      rate !== null &&
      (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 10000000)
    )
      fail('Enter a production rate above 0.');
    return { group, rate };
  });
  if (list.length) factory.assignments[update.key] = list;
  else delete factory.assignments[update.key];
}
// The items one group makes on site (#877, factoryGroups.local), sent whole: the Factories page's
// "Made on site" picker saves its list when the user presses Save. An empty list drops the
// group's entry, and the field goes when no group has one, so the state keeps its old shape and
// version. Which items are worth offering is the page's business (onSiteOffers in
// app/on-site.ts); here an item only has to be a known one, as validateGroups checks it. The plan
// is not touched: it changes only in a recalculation the user starts.
function setLocalItems(factory: FactoryGroups, update: Raw) {
  if (!factory.groups.some(group => group.id === update.id)) fail('Unknown factory.');
  const items: unknown = update.items;
  if (
    !Array.isArray(items) ||
    items.length > ITEM_NAMES.length ||
    items.some(item => typeof item !== 'string' || !ITEM_NAMES.includes(item)) ||
    new Set(items).size !== items.length
  )
    fail('Invalid items made on site.');
  const local = { ...factory.local };
  // The check above leaves only item names.
  if (items.length) local[update.id as string] = [...(items as string[])].sort();
  else delete local[update.id as string];
  if (Object.keys(local).length) factory.local = local;
  else delete factory.local;
}
const groupEdits: Record<string, GroupEdit> = {
  factoryGroupAdd: addGroup,
  factoryGroupRename: renameGroup,
  factoryGroupRemove: removeGroup,
  factoryLinkTransport: setLinkTransport,
  factoryAssign: assignGroups,
  factoryLocal: setLocalItems,
};
// Factory group edits, one function per update type above.
function mutateGroups(state: SavedState, update: Raw) {
  const factory = (state.factoryGroups = validateGroups(state.factoryGroups));
  // mutate only sends types starting with 'factory', which no Object.prototype key does.
  const edit = groupEdits[update.type as string];
  if (!edit) fail('Unknown update.');
  edit(factory, update);
}
// Deletes everything recorded for bay `id`'s addresses: its name, container names and cleared
// positions, and its 'slot-<address>' notes and 'slot-<address>-<step>' checks.
function clearBayRecords(state: SavedState, layout: StorageEdits, id: string) {
  delete layout.bayNames[id];
  // A handbook bay's move goes too, so a bay taking its letter starts on its own floor.
  if (layout.bayFloors?.[id]) {
    const { [id]: _gone, ...rest } = layout.bayFloors;
    if (Object.keys(rest).length) layout.bayFloors = rest;
    else delete layout.bayFloors;
  }
  // And its place in a floor's order (#191).
  dropFromOrder(layout, id);
  for (const address of Object.keys(layout.slots))
    if (slotAddr(address) && bayOfSlot(address) === id) delete layout.slots[address];
  layout.clearedSlots = layout.clearedSlots.filter(address => bayOfSlot(address) !== id);
  for (const records of [state.checks, state.notes] as Record<string, unknown>[])
    for (const key of Object.keys(records || {})) {
      const address = /^slot-([A-Z]{1,2}[0-9]{2})(?:-|$)/.exec(key)?.[1];
      if (address && bayOfSlot(address) === id) delete records[key];
    }
}
// The floor bay `id` stands on: an added bay's own (also under a hidden handbook letter, #167),
// else a handbook bay's move (#190) or its handbook floor. null for a letter that is neither.
function bayFloor(layout: StorageEdits, id: string): string | null {
  const added = layout.bays.find(bay => bay.id === id);
  if (added) return added.floor;
  return handbookBay(id) ? (layout.bayFloors?.[id] ?? handbookFloor(id)) : null;
}
// Takes bay `id` out of every floor's order (#191): it moved or went, so a letter reused later
// starts at its default place.
function dropFromOrder(layout: StorageEdits, id: string) {
  if (!layout.bayOrder) return;
  const order: Record<string, string[]> = {};
  for (const [floor, list] of Object.entries(layout.bayOrder)) {
    const kept = list.filter(letter => letter !== id);
    if (kept.length) order[floor] = kept;
  }
  if (Object.keys(order).length) layout.bayOrder = order;
  else delete layout.bayOrder;
}
// Sets layout.bayOrder to `order`, or drops the field when no floor has an order left.
function setBayOrder(layout: StorageEdits, order: Record<string, string[]>) {
  if (Object.keys(order).length) layout.bayOrder = order;
  else delete layout.bayOrder;
}
// Empties container position `address` the way storageSlotClear does: an added position
// disappears with its container; a handbook one stays as a reserved address so its printed label
// keeps meaning something.
function emptySlot(layout: StorageEdits, address: string) {
  delete layout.slots[address];
  if (!addedSlot(address) && !layout.clearedSlots.includes(address))
    layout.clearedSlots.push(address);
}
// Puts the container `name` at position `address`, which is then no longer a cleared one.
function fillSlot(layout: StorageEdits, address: string, name: string) {
  layout.slots[address] = name.trim();
  layout.clearedSlots = layout.clearedSlots.filter(cleared => cleared !== address);
}
// One storage layout edit, applied to state and its normalised layout (see mutateLayout).
type LayoutEdit = (state: SavedState, layout: StorageEdits, update: Raw) => void;

function addFloor(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (
    !addedFloorId(update.id) ||
    layout.floors.some(floor => floor.id === update.id) ||
    !label(update.label)
  )
    fail('Invalid floor.');
  layout.floors.push({ id: update.id as string, label: update.label.trim() });
}
function renameFloor(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!floorId(update.id) || !knownFloor(layout, update.id)) fail('Unknown floor.');
  if (typeof update.label === 'string' && !update.label.trim()) delete layout.floorNames[update.id];
  else {
    if (!label(update.label)) fail('Invalid floor name.');
    layout.floorNames[update.id] = update.label.trim();
  }
}
// storageFloorHide and storageFloorRestore. Built-in floors are hidden, never removed (#168);
// an added floor is removed instead.
function hideOrRestoreFloor(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!builtinFloors.some(([id]) => id === update.id))
    fail('Only built-in floors can be hidden. Remove an added floor instead.');
  const id = update.id as string;
  if (update.type === 'storageFloorRestore')
    layout.hiddenFloors = layout.hiddenFloors.filter(hiddenId => hiddenId !== id);
  else {
    if (baysOn(layout, id)) fail('Remove or move the bays on this floor first.');
    const hidden = new Set([...layout.hiddenFloors, id]);
    if (hidden.size === builtinFloors.length && !layout.floors.length)
      fail('Keep at least one floor in the storage room.');
    layout.hiddenFloors = builtinFloors
      .map(([floorId]) => floorId)
      .filter(floorId => hidden.has(floorId));
  }
}
function removeFloor(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!layout.floors.some(floor => floor.id === update.id))
    fail('Only added floors can be removed.');
  // The check above matched an added floor, so the id is a string.
  const id = update.id as string;
  if (baysOn(layout, id)) fail('Remove or move the bays on this floor first.');
  if (layout.hiddenFloors.length === builtinFloors.length && layout.floors.length === 1)
    fail('Keep at least one floor in the storage room.');
  layout.floors = layout.floors.filter(floor => floor.id !== id);
  delete layout.floorNames[id];
  if (layout.bayOrder?.[id]) {
    const { [id]: _gone, ...rest } = layout.bayOrder;
    setBayOrder(layout, rest);
  }
}
function addBay(state: SavedState, layout: StorageEdits, update: Raw) {
  if (!bayId(update.id) || !label(update.name) || !floorId(update.floor)) fail('Invalid bay.');
  if (layout.bays.some(bay => bay.id === update.id))
    fail(`Bay ${update.id} already exists. Choose another letter.`);
  // Any free letter, the owner's choice on #167. A handbook letter is free only while that
  // bay is hidden, and taking it needs `replace`: the hidden bay's kept records are cleared
  // first (as removing an added bay does, #51), so the new bay starts clean.
  if (handbookBay(update.id)) {
    if (!layout.hiddenBays.includes(update.id))
      fail(
        `Bay ${update.id} is in the room. Hide that built-in bay first, or choose another letter.`,
      );
    if (update.replace !== true)
      fail(
        `Bay ${update.id} still has saved progress from the built-in bay. Confirm to replace it.`,
      );
  }
  if (!knownFloor(layout, update.floor)) fail('Unknown floor.');
  if (handbookBay(update.id)) clearBayRecords(state, layout, update.id);
  layout.bays.push({ id: update.id, name: update.name.trim(), floor: update.floor });
}
function renameBay(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!bayId(update.id)) fail('Invalid bay.');
  if (typeof update.name === 'string' && !update.name.trim()) delete layout.bayNames[update.id];
  else {
    if (!label(update.name)) fail('Invalid bay name.');
    layout.bayNames[update.id] = update.name.trim();
  }
}
// Any bay can move to another floor (#190), keeping its letter and so every address, check,
// note and name. An added bay (also one holding a hidden handbook letter, #167) changes its own
// floor; a handbook bay is recorded in bayFloors. Only to a floor in the tabs: a hidden
// built-in floor is restored first.
function moveBay(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!bayId(update.id)) fail('Invalid bay.');
  if (!knownFloor(layout, update.floor)) fail('Unknown floor.');
  if (layout.hiddenFloors.includes(update.floor))
    fail('Restore that floor before moving a bay onto it.');
  const added = layout.bays.find(bay => bay.id === update.id);
  if (added) added.floor = update.floor;
  else if (handbookBay(update.id)) {
    const { [update.id]: _old, ...moved } = layout.bayFloors || {};
    if (update.floor !== handbookFloor(update.id)) moved[update.id] = update.floor;
    if (Object.keys(moved).length) layout.bayFloors = moved;
    else delete layout.bayFloors;
  } else fail('Unknown bay.');
  // It joins the new floor at its default place and leaves the old floor's order.
  dropFromOrder(layout, update.id);
}
// The order of the bays on one floor (#191), sent whole by Move left / Move right. Only bays on
// that floor; one left out keeps its default place (floorOrder in app/views/storage.ts).
function orderBays(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!knownFloor(layout, update.floor)) fail('Unknown floor.');
  const list = update.order;
  if (
    !Array.isArray(list) ||
    list.length > 60 ||
    list.some((id: unknown) => !bayId(id)) ||
    new Set(list).size !== list.length
  )
    fail('Invalid bay order.');
  if (list.some((id: string) => bayFloor(layout, id) !== update.floor))
    fail('Only bays on this floor can be put in order.');
  const { [update.floor]: _old, ...rest } = layout.bayOrder || {};
  if (list.length) rest[update.floor] = [...list];
  setBayOrder(layout, rest);
}
// storageBayHide and storageBayRestore, for handbook bays only.
function hideOrRestoreBay(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (typeof update.id !== 'string' || !handbookBay(update.id))
    fail('Only built-in bays can be hidden. Remove an added bay instead.');
  const hidden = new Set(layout.hiddenBays);
  // An added bay under a handbook letter still in the room predates #91 and shares that bay's
  // addresses and records. Hiding the handbook bay would make removing the added one clear
  // them (storageBayRemove treats a hidden letter's records as the added bay's own), so the
  // added bay has to go first. A letter an added bay took with `replace` is already hidden.
  if (
    update.type === 'storageBayHide' &&
    !hidden.has(update.id) &&
    layout.bays.some(bay => bay.id === update.id)
  )
    fail(`An added bay uses the letter ${update.id}. Remove it before hiding the built-in bay.`);
  if (update.type === 'storageBayHide') hidden.add(update.id);
  else if (layout.bays.some(bay => bay.id === update.id))
    fail(`An added bay uses the letter ${update.id}. Remove it before restoring the built-in bay.`);
  else hidden.delete(update.id);
  layout.hiddenBays = [...hidden].sort();
}
function removeBay(state: SavedState, layout: StorageEdits, update: Raw) {
  if (!layout.bays.some(bay => bay.id === update.id))
    fail('Only added bays can be removed. Hide a built-in bay instead; its progress is kept.');
  layout.bays = layout.bays.filter(bay => bay.id !== update.id);
  // The check above matched an added bay, so the id is a string.
  const id = update.id as string;
  // An added bay under the letter of a handbook bay that is still in the room predates
  // storageBayAdd refusing one (only a direct request or an edited import could make it). Its
  // addresses, name, checks and notes are the handbook bay's too, so removing it removes the
  // entry and nothing else. Under a hidden handbook letter (#167) the records are its own.
  if (handbookBay(id) && !layout.hiddenBays.includes(id)) return;
  clearBayRecords(state, layout, id);
}
function assignSlot(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!slotAddr(update.key) || !label(update.name, 120)) fail('Invalid container.');
  fillSlot(layout, update.key, update.name);
}
function clearSlot(_state: SavedState, layout: StorageEdits, update: Raw) {
  if (!slotAddr(update.key)) fail('Invalid container address.');
  emptySlot(layout, update.key);
}
// A container dragged to another position (#208), in its bay or another. The page sends the
// items it shows at both addresses (the server does not know the handbook's), `toName` null for
// an empty position: a move, else a swap. The owner's choice on #208: progress moves with the
// container, so the two addresses' 'slot-' checks and notes always trade places; an empty
// position's leftover records go to the address left behind, never deleted.
function moveSlot(state: SavedState, layout: StorageEdits, update: Raw) {
  const { from, to } = update;
  if (!slotAddr(from) || !slotAddr(to) || from === to) fail('Invalid container move.');
  for (const address of [from, to])
    if (!handbookBay(bayOfSlot(address)) && !layout.bays.some(bay => bay.id === bayOfSlot(address)))
      fail('Unknown bay.');
  if (!label(update.fromName, 120) || (update.toName !== null && !label(update.toName, 120)))
    fail('Invalid container.');
  const put = (address: string, name: string | null) =>
    name === null ? emptySlot(layout, address) : fillSlot(layout, address, name);
  put(to, update.fromName);
  put(from, update.toName as string | null);
  swapSlotRecords(state, from, to);
}
const layoutEdits: Record<string, LayoutEdit> = {
  storageFloorAdd: addFloor,
  storageFloorRename: renameFloor,
  storageFloorHide: hideOrRestoreFloor,
  storageFloorRestore: hideOrRestoreFloor,
  storageFloorRemove: removeFloor,
  storageBayAdd: addBay,
  storageBayRename: renameBay,
  storageBayMove: moveBay,
  storageBayOrder: orderBays,
  storageBayHide: hideOrRestoreBay,
  storageBayRestore: hideOrRestoreBay,
  storageBayRemove: removeBay,
  storageSlotAssign: assignSlot,
  storageSlotClear: clearSlot,
  storageSlotMove: moveSlot,
};
// Storage layout edits, one function per update type above. Only added floors and bays can be
// removed; built-in floors can only be renamed, and handbook bays hidden and restored
// (storageBayHide/Restore, #166), which keeps every record of theirs. These edits change names
// and addresses only, with one exception: removing an added bay also deletes the 'slot-' checks
// and notes of its addresses (the owner's decision in #51), so a bay that later reuses the
// letter starts clean. A removed floor has no records of its own.
function mutateLayout(state: SavedState, update: Raw) {
  const layout = (state.storageEdits = validateEdits(
    state.storageEdits === undefined ? undefined : state.storageEdits,
  ));
  // mutate only sends types starting with 'storage', which no Object.prototype key does.
  const edit = layoutEdits[update.type as string];
  if (!edit) fail('Unknown update.');
  edit(state, layout, update);
}
// Trades every 'slot-<first>' note and 'slot-<first>-<step>' check with those of address
// `second`.
function swapSlotRecords(state: SavedState, first: string, second: string) {
  for (const records of [state.checks, state.notes] as Record<string, unknown>[]) {
    if (!records) continue;
    const moved: [string, unknown][] = [];
    for (const key of Object.keys(records)) {
      const match = /^slot-([A-Z]{1,2}[0-9]{2})(-.*)?$/.exec(key);
      if (!match || (match[1] !== first && match[1] !== second)) continue;
      moved.push([
        'slot-' + (match[1] === first ? second : first) + (match[2] ?? ''),
        records[key],
      ]);
      delete records[key];
    }
    for (const [key, value] of moved) records[key] = value;
  }
}
