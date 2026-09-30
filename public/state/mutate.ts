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
// `base` is the X-Planner-Revision header: the revision the tab's state had when it sent
// the write. Without the header (an older page, a script) nothing is compared.
export function checkBase(current: SavedState, update: unknown, base: string | null | undefined) {
  if (base === null || base === undefined || base === '') return;
  const type = (update as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !baseSensitive.includes(type)) return;
  const seen = Number(base);
  if (!Number.isSafeInteger(seen)) return;
  if (seen !== (current.revision ?? 0)) throw Object.assign(Error(staleWrite), { status: 409 });
}

// Applies one /api/update operation (op.type below) to a state and returns the validated
// result. It changes s in place first: the server passes the profile inside its draft copy
// of the workspace and browser-api.ts passes a structuredClone, so a throw from the final
// validateState discards the change. Values such as a check's boolean or a delivery count
// are only type-checked there, not here.
//
// The operation arrives as the request body, so it is checked as unknown data here, whatever
// its declared type (UpdateOp, for callers). Values only validateState checks are written as
// they came (the casts below), and a malformed one fails there. s may be a stored state of
// any version: each section is normalised before it is edited.
export function mutate(s: SavedState, update: UpdateOp): ProgressState {
  const op: unknown = update;
  if (!plain(op)) fail('Invalid update.');
  // A type that is not a string is refused here, before any lookup.
  if (typeof op.type !== 'string') fail('Unknown update.');
  stateEditFor(op.type)(s, op);
  return validateState(s);
}
// One update applied to s (see mutate).
type StateEdit = (s: SavedState, op: Raw) => void;
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
function setRecord(s: SavedState, op: Raw) {
  if (!safeKey(op.key)) fail('Invalid record address.');
  const type = op.type as 'check' | 'note' | 'delivery';
  const kind = ({ check: 'checks', note: 'notes', delivery: 'deliveries' } as const)[type];
  if (type === 'note' && typeof op.value === 'string' && !op.value.trim()) delete s.notes[op.key];
  else (s[kind] as Raw)[op.key] = op.value;
}
// Ticks or clears many checklist keys at once.
function setChecks(s: SavedState, op: Raw) {
  if (
    !Array.isArray(op.keys) ||
    !op.keys.length ||
    op.keys.length > 1000 ||
    op.keys.some((key: unknown) => !safeKey(key)) ||
    typeof op.value !== 'boolean'
  )
    fail('Invalid checklist update.');
  for (const key of op.keys as string[]) s.checks[key] = op.value;
}
function setPhase(s: SavedState, op: Raw) {
  s.settings.phase = op.value as Phase;
}
function addTask(s: SavedState, op: Raw) {
  s.customTasks.push({ id: op.id, title: op.title, phase: op.phase } as CustomTask);
}
// Deleting a personal task also removes its tick and any step edits naming it. The id is not
// checked: an unknown one matches nothing.
function removeTask(s: SavedState, op: Raw) {
  const id = op.id as string;
  s.customTasks = s.customTasks.filter(t => t.id !== id);
  delete s.checks[id];
  const edits = (s.taskEdits = validateTaskEdits(s.taskEdits));
  delete edits.titles[id];
  delete edits.bodies[id];
  delete edits.links[id];
  edits.removed = edits.removed.filter(k => k !== id);
  for (const phase of Object.keys(edits.order) as Phase[])
    edits.order[phase] = edits.order[phase]!.filter(k => k !== id);
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
type TaskEdit = (edits: TaskEdits, op: Raw) => void;

// Title, body and link of a step; an empty value restores the original.
function editTask(edits: TaskEdits, op: Raw) {
  if (!safeKey(op.id)) fail('Invalid step.');
  const id = op.id;
  const texts: ['titles' | 'bodies', unknown, number][] = [
    ['titles', op.title, 240],
    ['bodies', op.body, 6000],
  ];
  for (const [kind, value, max] of texts) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > max) fail('Invalid step text.');
    if (value.trim()) edits[kind][id] = value.trim();
    else delete edits[kind][id];
  }
  if (op.link === undefined) return;
  if (op.link === '' || op.link === null) delete edits.links[id];
  else {
    if (!safeKey(op.link)) fail('Invalid linked factory.');
    edits.links[id] = op.link;
  }
}
// Hides a step; its tick is kept.
function removeTaskStep(edits: TaskEdits, op: Raw) {
  if (!safeKey(op.id)) fail('Invalid step.');
  const id = op.id;
  if (!edits.removed.includes(id)) edits.removed.push(id);
}
function restoreTaskStep(edits: TaskEdits, op: Raw) {
  if (!safeKey(op.id)) fail('Invalid step.');
  edits.removed = edits.removed.filter(k => k !== op.id);
}
// The order of one phase's steps, sent whole; an empty list restores the original order.
function orderTasks(edits: TaskEdits, op: Raw) {
  if (
    !isPhase(op.phase) ||
    !Array.isArray(op.ids) ||
    op.ids.length > 600 ||
    op.ids.some((key: unknown) => !safeKey(key)) ||
    new Set(op.ids).size !== op.ids.length
  )
    fail('Invalid step order.');
  if (op.ids.length) edits.order[op.phase] = [...op.ids];
  else delete edits.order[op.phase];
}
const taskEdits: Record<string, TaskEdit> = {
  taskEdit: editTask,
  taskRemove: removeTaskStep,
  taskRestore: restoreTaskStep,
  taskOrder: orderTasks,
};
// Build-plan step edits, one function per update type above.
function mutateTasks(s: SavedState, op: Raw) {
  const edits = (s.taskEdits = validateTaskEdits(s.taskEdits));
  // mutate only sends types starting with 'task', which no Object.prototype key does.
  const edit = taskEdits[op.type as string];
  if (!edit) fail('Unknown update.');
  edit(edits, op);
}

// One factory group edit, applied to the normalised groups (see mutateGroups).
type GroupEdit = (factory: FactoryGroups, op: Raw) => void;

function addGroup(factory: FactoryGroups, op: Raw) {
  if (!groupId(op.id) || factory.groups.some(group => group.id === op.id) || !label(op.name))
    fail('Invalid factory group.');
  if (factory.groups.length >= 60) fail('You can keep up to 60 factory groups.');
  factory.groups.push({ id: op.id, name: op.name.trim() });
}
function renameGroup(factory: FactoryGroups, op: Raw) {
  if (!factory.groups.some(group => group.id === op.id)) fail('Unknown factory group.');
  if (!label(op.name)) fail('Invalid group name.');
  // The check above found it.
  factory.groups.find(group => group.id === op.id)!.name = op.name.trim();
}
// Removing a group also drops it from every row's assignment list.
function removeGroup(factory: FactoryGroups, op: Raw) {
  if (!factory.groups.some(group => group.id === op.id)) fail('Unknown factory group.');
  factory.groups = factory.groups.filter(group => group.id !== op.id);
  for (const [rowKey, list] of Object.entries(factory.assignments)) {
    const kept = list.filter(member => member.group !== op.id);
    if (kept.length) factory.assignments[rowKey] = kept;
    else delete factory.assignments[rowKey];
  }
  // Its links go too; they joined a place that no longer exists.
  for (const link of Object.keys(factory.links || {}))
    if (link.split(':').includes(op.id as string)) delete factory.links![link];
  if (factory.links && !Object.keys(factory.links).length) delete factory.links;
}
// The first choice for one item of a mines link saved before #231 splits that link: the other
// items on it (`siblings`, the sources the page shows going the same way) keep the old choice as
// their own, and the old entry goes, so nothing chosen is lost.
function splitLegacyMinesLink(links: Record<string, LinkTransport>, op: Raw) {
  const legacy = MINES_PLACE + ':' + op.to;
  if (!sourcePlace(op.from) || !links[legacy]) return;
  const siblings = op.siblings ?? [];
  if (!Array.isArray(siblings) || siblings.length > 200 || !siblings.every(sourcePlace))
    fail('Invalid factory group link.');
  for (const sibling of siblings as string[])
    if (sibling !== op.from) links[sibling + ':' + op.to] ??= links[legacy]!;
  delete links[legacy];
}
// The transport on the link from one place to another; belts, the default, are not stored.
function setLinkTransport(factory: FactoryGroups, op: Raw) {
  if (!linkKey(op.from, op.to, new Set(factory.groups.map(group => group.id))))
    fail('Unknown factory group link.');
  const key = op.from + ':' + op.to;
  const links = { ...factory.links };
  splitLegacyMinesLink(links, op);
  if (op.mode === 'belt') delete links[key];
  else
    links[key] = linkTransport({
      mode: op.mode,
      roundTripMin: op.roundTripMin,
      ...(op.fuel === undefined ? {} : { fuel: op.fuel }),
    });
  if (Object.keys(links).length > 500) fail('You can set up to 500 group links.');
  if (Object.keys(links).length) factory.links = links;
  else delete factory.links;
}
// The groups a row's machines work in, each with an optional production rate.
function assignGroups(factory: FactoryGroups, op: Raw) {
  if (!safeKey(op.key) || !Array.isArray(op.groups) || op.groups.length > 12)
    fail('Invalid factory group assignment.');
  const known = new Set(factory.groups.map(group => group.id)),
    used = new Set<string>();
  const list = op.groups.map((member: unknown): GroupAssignment => {
    if (!plain(member) || !known.has(member.group as string) || used.has(member.group as string))
      fail('Invalid factory group assignment.');
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
  if (list.length) factory.assignments[op.key] = list;
  else delete factory.assignments[op.key];
}
const groupEdits: Record<string, GroupEdit> = {
  factoryGroupAdd: addGroup,
  factoryGroupRename: renameGroup,
  factoryGroupRemove: removeGroup,
  factoryLinkTransport: setLinkTransport,
  factoryAssign: assignGroups,
};
// Factory group edits, one function per update type above.
function mutateGroups(s: SavedState, op: Raw) {
  const factory = (s.factoryGroups = validateGroups(s.factoryGroups));
  // mutate only sends types starting with 'factory', which no Object.prototype key does.
  const edit = groupEdits[op.type as string];
  if (!edit) fail('Unknown update.');
  edit(factory, op);
}
// Deletes everything recorded for bay `id`'s addresses: its name, container names and cleared
// positions, and its 'slot-<address>' notes and 'slot-<address>-<step>' checks.
function clearBayRecords(s: SavedState, e: StorageEdits, id: string) {
  delete e.bayNames[id];
  // A handbook bay's move goes too, so a bay taking its letter starts on its own floor.
  if (e.bayFloors?.[id]) {
    const { [id]: _gone, ...rest } = e.bayFloors;
    if (Object.keys(rest).length) e.bayFloors = rest;
    else delete e.bayFloors;
  }
  // And its place in a floor's order (#191).
  dropFromOrder(e, id);
  for (const k of Object.keys(e.slots)) if (slotAddr(k) && bayOfSlot(k) === id) delete e.slots[k];
  e.clearedSlots = e.clearedSlots.filter(k => bayOfSlot(k) !== id);
  for (const records of [s.checks, s.notes] as Record<string, unknown>[])
    for (const k of Object.keys(records || {})) {
      const address = /^slot-([A-Z]{1,2}[0-9]{2})(?:-|$)/.exec(k)?.[1];
      if (address && bayOfSlot(address) === id) delete records[k];
    }
}
// The floor bay `id` stands on: an added bay's own (also under a hidden handbook letter, #167),
// else a handbook bay's move (#190) or its handbook floor. null for a letter that is neither.
function bayFloor(e: StorageEdits, id: string): string | null {
  const added = e.bays.find(b => b.id === id);
  if (added) return added.floor;
  return handbookBay(id) ? (e.bayFloors?.[id] ?? handbookFloor(id)) : null;
}
// Takes bay `id` out of every floor's order (#191): it moved or went, so a letter reused later
// starts at its default place.
function dropFromOrder(e: StorageEdits, id: string) {
  if (!e.bayOrder) return;
  const order: Record<string, string[]> = {};
  for (const [f, list] of Object.entries(e.bayOrder)) {
    const kept = list.filter(x => x !== id);
    if (kept.length) order[f] = kept;
  }
  if (Object.keys(order).length) e.bayOrder = order;
  else delete e.bayOrder;
}
// Sets e.bayOrder to `order`, or drops the field when no floor has an order left.
function setBayOrder(e: StorageEdits, order: Record<string, string[]>) {
  if (Object.keys(order).length) e.bayOrder = order;
  else delete e.bayOrder;
}
// Empties container position k the way storageSlotClear does: an added position disappears
// with its container; a handbook one stays as a reserved address so its printed label keeps
// meaning something.
function emptySlot(e: StorageEdits, k: string) {
  delete e.slots[k];
  if (!addedSlot(k) && !e.clearedSlots.includes(k)) e.clearedSlots.push(k);
}
// Puts the container `name` at position k, which is then no longer a cleared one.
function fillSlot(e: StorageEdits, k: string, name: string) {
  e.slots[k] = name.trim();
  e.clearedSlots = e.clearedSlots.filter(x => x !== k);
}
// One storage layout edit, applied to s and its normalised layout e (see mutateLayout).
type LayoutEdit = (s: SavedState, e: StorageEdits, op: Raw) => void;

function addFloor(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!addedFloorId(op.id) || e.floors.some(f => f.id === op.id) || !label(op.label))
    fail('Invalid floor.');
  e.floors.push({ id: op.id as string, label: op.label.trim() });
}
function renameFloor(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!floorId(op.id) || !knownFloor(e, op.id)) fail('Unknown floor.');
  if (typeof op.label === 'string' && !op.label.trim()) delete e.floorNames[op.id];
  else {
    if (!label(op.label)) fail('Invalid floor name.');
    e.floorNames[op.id] = op.label.trim();
  }
}
// storageFloorHide and storageFloorRestore. Built-in floors are hidden, never removed (#168);
// an added floor is removed instead.
function hideOrRestoreFloor(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!builtinFloors.some(([id]) => id === op.id))
    fail('Only built-in floors can be hidden. Remove an added floor instead.');
  const id = op.id as string;
  if (op.type === 'storageFloorRestore') e.hiddenFloors = e.hiddenFloors.filter(f => f !== id);
  else {
    if (baysOn(e, id)) fail('Remove or move the bays on this floor first.');
    const hidden = new Set([...e.hiddenFloors, id]);
    if (hidden.size === builtinFloors.length && !e.floors.length)
      fail('Keep at least one floor in the storage room.');
    e.hiddenFloors = builtinFloors.map(([f]) => f).filter(f => hidden.has(f));
  }
}
function removeFloor(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!e.floors.some(f => f.id === op.id)) fail('Only added floors can be removed.');
  // The check above matched an added floor, so the id is a string.
  const id = op.id as string;
  if (baysOn(e, id)) fail('Remove or move the bays on this floor first.');
  if (e.hiddenFloors.length === builtinFloors.length && e.floors.length === 1)
    fail('Keep at least one floor in the storage room.');
  e.floors = e.floors.filter(f => f.id !== id);
  delete e.floorNames[id];
  if (e.bayOrder?.[id]) {
    const { [id]: _gone, ...rest } = e.bayOrder;
    setBayOrder(e, rest);
  }
}
function addBay(s: SavedState, e: StorageEdits, op: Raw) {
  if (!bayId(op.id) || !label(op.name) || !floorId(op.floor)) fail('Invalid bay.');
  if (e.bays.some(b => b.id === op.id)) fail(`Bay ${op.id} already exists. Choose another letter.`);
  // Any free letter, the owner's choice on #167. A handbook letter is free only while that
  // bay is hidden, and taking it needs `replace`: the hidden bay's kept records are cleared
  // first (as removing an added bay does, #51), so the new bay starts clean.
  if (handbookBay(op.id)) {
    if (!e.hiddenBays.includes(op.id))
      fail(`Bay ${op.id} is in the room. Hide that handbook bay first, or choose another letter.`);
    if (op.replace !== true)
      fail(`Bay ${op.id} still has saved progress from the handbook bay. Confirm to replace it.`);
  }
  if (!knownFloor(e, op.floor)) fail('Unknown floor.');
  if (handbookBay(op.id)) clearBayRecords(s, e, op.id);
  e.bays.push({ id: op.id, name: op.name.trim(), floor: op.floor });
}
function renameBay(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!bayId(op.id)) fail('Invalid bay.');
  if (typeof op.name === 'string' && !op.name.trim()) delete e.bayNames[op.id];
  else {
    if (!label(op.name)) fail('Invalid bay name.');
    e.bayNames[op.id] = op.name.trim();
  }
}
// Any bay can move to another floor (#190), keeping its letter and so every address, check,
// note and name. An added bay (also one holding a hidden handbook letter, #167) changes its own
// floor; a handbook bay is recorded in bayFloors. Only to a floor in the tabs: a hidden
// built-in floor is restored first.
function moveBay(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!bayId(op.id)) fail('Invalid bay.');
  if (!knownFloor(e, op.floor)) fail('Unknown floor.');
  if (e.hiddenFloors.includes(op.floor)) fail('Restore that floor before moving a bay onto it.');
  const added = e.bays.find(b => b.id === op.id);
  if (added) added.floor = op.floor;
  else if (handbookBay(op.id)) {
    const { [op.id]: _old, ...moved } = e.bayFloors || {};
    if (op.floor !== handbookFloor(op.id)) moved[op.id] = op.floor;
    if (Object.keys(moved).length) e.bayFloors = moved;
    else delete e.bayFloors;
  } else fail('Unknown bay.');
  // It joins the new floor at its default place and leaves the old floor's order.
  dropFromOrder(e, op.id);
}
// The order of the bays on one floor (#191), sent whole by Move left / Move right. Only bays on
// that floor; one left out keeps its default place (views/storage.ts orderBays).
function orderBays(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!knownFloor(e, op.floor)) fail('Unknown floor.');
  const list = op.order;
  if (
    !Array.isArray(list) ||
    list.length > 60 ||
    list.some((id: unknown) => !bayId(id)) ||
    new Set(list).size !== list.length
  )
    fail('Invalid bay order.');
  if (list.some((id: string) => bayFloor(e, id) !== op.floor))
    fail('Only bays on this floor can be put in order.');
  const { [op.floor]: _old, ...rest } = e.bayOrder || {};
  if (list.length) rest[op.floor] = [...list];
  setBayOrder(e, rest);
}
// storageBayHide and storageBayRestore, for handbook bays only.
function hideOrRestoreBay(_s: SavedState, e: StorageEdits, op: Raw) {
  if (typeof op.id !== 'string' || !handbookBay(op.id))
    fail('Only handbook bays can be hidden. Remove an added bay instead.');
  const hidden = new Set(e.hiddenBays);
  // An added bay under a handbook letter still in the room predates #91 and shares that bay's
  // addresses and records. Hiding the handbook bay would make removing the added one clear
  // them (storageBayRemove treats a hidden letter's records as the added bay's own), so the
  // added bay has to go first. A letter an added bay took with `replace` is already hidden.
  if (op.type === 'storageBayHide' && !hidden.has(op.id) && e.bays.some(b => b.id === op.id))
    fail(`An added bay uses the letter ${op.id}. Remove it before hiding the handbook bay.`);
  if (op.type === 'storageBayHide') hidden.add(op.id);
  else if (e.bays.some(b => b.id === op.id))
    fail(`An added bay uses the letter ${op.id}. Remove it before restoring the handbook bay.`);
  else hidden.delete(op.id);
  e.hiddenBays = [...hidden].sort();
}
function removeBay(s: SavedState, e: StorageEdits, op: Raw) {
  if (!e.bays.some(b => b.id === op.id))
    fail('Only added bays can be removed. Hide a handbook bay instead; its progress is kept.');
  e.bays = e.bays.filter(b => b.id !== op.id);
  // The check above matched an added bay, so the id is a string.
  const id = op.id as string;
  // An added bay under the letter of a handbook bay that is still in the room predates
  // storageBayAdd refusing one (only a direct request or an edited import could make it). Its
  // addresses, name, checks and notes are the handbook bay's too, so removing it removes the
  // entry and nothing else. Under a hidden handbook letter (#167) the records are its own.
  if (handbookBay(id) && !e.hiddenBays.includes(id)) return;
  clearBayRecords(s, e, id);
}
function assignSlot(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!slotAddr(op.key) || !label(op.name, 120)) fail('Invalid container.');
  fillSlot(e, op.key, op.name);
}
function clearSlot(_s: SavedState, e: StorageEdits, op: Raw) {
  if (!slotAddr(op.key)) fail('Invalid container address.');
  emptySlot(e, op.key);
}
// A container dragged to another position (#208), in its bay or another. The page sends the
// items it shows at both addresses (the server does not know the handbook's), `toName` null for
// an empty position: a move, else a swap. The owner's choice on #208: progress moves with the
// container, so the two addresses' 'slot-' checks and notes always trade places; an empty
// position's leftover records go to the address left behind, never deleted.
function moveSlot(s: SavedState, e: StorageEdits, op: Raw) {
  const { from, to } = op;
  if (!slotAddr(from) || !slotAddr(to) || from === to) fail('Invalid container move.');
  for (const k of [from, to])
    if (!handbookBay(bayOfSlot(k)) && !e.bays.some(b => b.id === bayOfSlot(k)))
      fail('Unknown bay.');
  if (!label(op.fromName, 120) || (op.toName !== null && !label(op.toName, 120)))
    fail('Invalid container.');
  const put = (k: string, name: string | null) =>
    name === null ? emptySlot(e, k) : fillSlot(e, k, name);
  put(to, op.fromName);
  put(from, op.toName as string | null);
  swapSlotRecords(s, from, to);
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
function mutateLayout(s: SavedState, op: Raw) {
  const e = (s.storageEdits = validateEdits(
    s.storageEdits === undefined ? undefined : s.storageEdits,
  ));
  // mutate only sends types starting with 'storage', which no Object.prototype key does.
  const edit = layoutEdits[op.type as string];
  if (!edit) fail('Unknown update.');
  edit(s, e, op);
}
// Trades every 'slot-<a>' note and 'slot-<a>-<step>' check with those of address b.
function swapSlotRecords(s: SavedState, a: string, b: string) {
  for (const records of [s.checks, s.notes] as Record<string, unknown>[]) {
    if (!records) continue;
    const moved: [string, unknown][] = [];
    for (const k of Object.keys(records)) {
      const m = /^slot-([A-Z]{1,2}[0-9]{2})(-.*)?$/.exec(k);
      if (!m || (m[1] !== a && m[1] !== b)) continue;
      moved.push(['slot-' + (m[1] === a ? b : a) + (m[2] ?? ''), records[k]]);
      delete records[k];
    }
    for (const [k, v] of moved) records[k] = v;
  }
}
