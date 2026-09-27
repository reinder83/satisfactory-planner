// The storage room's data (#storage, ui/pages/StoragePage.vue): floors, bays and container
// positions after the profile's layout edits, and each container's four saved checks. One
// room serves both profile kinds: the original handbook shows its printed room, a calculated
// profile shows the same addresses with only the items it selected for storage.
// Container addresses (`A01`, `S09`, …) are saved progress keys and must never move.
import { bayOfSlot, slotPosition } from '../../state.ts';
import { num } from '../format.ts';
import { calculated, checked, currentProfile, plan, state } from '../session.ts';
import { showDetail } from '../ui/detail.ts';
import type { ItemRates, StorageEdits, UpdateOp } from '../../types/index.ts';

// A container position: its address and the item it holds, or null when reserved (empty).
export interface StoragePosition {
  id: string;
  name: string | null;
}

// A bay after the profile's layout edits; custom marks one the user added.
export interface StorageBayView {
  id: string;
  name: string;
  floor: string;
  custom?: boolean;
  items: StoragePosition[];
}

// A floor tab; built-in floors can be renamed but never removed.
export interface StorageFloor {
  id: string;
  label: string;
  builtin: boolean;
}

// Items kept at a zero rate hold their container and address without reserving
// production, so they belong on the storage map rather than in a rate list.
// inputText: plain "Item 12/min · Item 3/min" text for the non-zero entries of an
// item → rate map. Used across the factory, resource and detail views.
export function inputText(inputs: ItemRates): string {
  return Object.entries(inputs)
    .filter(([, q]) => q)
    .map(([n, q]) => n + ' ' + num(q) + '/min')
    .join(' · ');
}

// The profile's storage layout edits with defaults filled in: added floors and bays,
// renamed floors and bays, `slots` (address → item name filled in by the user) and
// `clearedSlots` (handbook addresses the user emptied, kept as reserved positions) and
// `hiddenBays` (handbook bays taken out of the room, their records kept) and `bayFloors`
// (handbook bays moved to another floor, #190) and `bayOrder` (the bays' order per floor, #191).
function storageEdits(): StorageEdits {
  const e: Partial<StorageEdits> = state?.storageEdits || {};
  return {
    floors: e.floors || [],
    floorNames: e.floorNames || {},
    bays: e.bays || [],
    bayNames: e.bayNames || {},
    slots: e.slots || {},
    clearedSlots: e.clearedSlots || [],
    hiddenBays: e.hiddenBays || [],
    hiddenFloors: e.hiddenFloors || [],
    ...(e.bayFloors ? { bayFloors: e.bayFloors } : {}),
    ...(e.bayOrder ? { bayOrder: e.bayOrder } : {}),
  };
}

// The floor tabs: the three built-in floors (renameable, never removable; hidden ones left out,
// #168) followed by floors the user added. A hidden built-in floor that still has a bay showing
// keeps its tab, so no bay is ever out of reach (the layout editor only hides empty floors).
const BUILTIN_FLOORS: [id: string, label: string][] = [
  ['ground', 'Ground floor'],
  ['upper', 'Upper floor'],
  ['workshop', 'Workshop'],
];
export function storageFloors(): StorageFloor[] {
  const e = storageEdits(),
    hidden = hiddenFloorIds();
  return [
    ...BUILTIN_FLOORS.filter(([id]) => !hidden.has(id)).map(([id, label]) => ({
      id,
      label: e.floorNames[id] || label,
      builtin: true,
    })),
    ...e.floors.map(f => ({ id: f.id, label: e.floorNames[f.id] || f.label, builtin: false })),
  ];
}

// Built-in floors hidden from the tabs: those listed in hiddenFloors with no bay showing.
function hiddenFloorIds(): Set<string> {
  const listed = storageEdits().hiddenFloors;
  if (!listed.length) return new Set();
  const used = new Set(storageBays().map(b => b.floor));
  return new Set(listed.filter(id => !used.has(id)));
}
// The hidden built-in floors, for the storage page's Hidden panel.
export function hiddenStorageFloors(): { id: string; label: string }[] {
  const e = storageEdits(),
    hidden = hiddenFloorIds();
  return BUILTIN_FLOORS.filter(([id]) => hidden.has(id)).map(([id, label]) => ({
    id,
    label: e.floorNames[id] || label,
  }));
}

// The order of the bays `ids` on `floor` (#191), given in their default (address) order, or null
// when the floor has no order of its own. Bays in the saved order take its sequence; a bay
// missing from it (added or moved here since) keeps its default place, and letters no longer on
// the floor are skipped.
export function floorOrder(floor: string, ids: string[]): string[] | null {
  const listed = storageEdits().bayOrder?.[floor];
  if (!listed) return null;
  const here = new Set(ids),
    order = listed.filter(id => here.has(id)),
    ordered = new Set(order);
  let next = 0;
  return ids.map(id => (ordered.has(id) ? order[next++]! : id));
}

// The id for a bay the user adds (#add-bay, ui/storage/LayoutEditor.vue): the first unused letter,
// starting after the handbook's A–R (W is tried last), then two-letter ids. null when
// every id is taken. The id becomes part of each container address, so it never changes.
export function nextBayLetter(): string | null {
  const used = new Set([...plan.storage.map(b => b.id), ...storageEdits().bays.map(b => b.id)]);
  for (const l of 'STUVXYZABCDEFGHIJKLMNOPQRW') if (!used.has(l)) return l;
  for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(a + b)) return a + b;
  return null;
}

// Every bay with its positions as { id: address, name: item or null }, after applying the
// profile's layout edits. A null name is a reserved (empty) position. Used by the storage
// page and its container dialog, the plan's storage tile and ADA.
export function storageBays(): StorageBayView[] {
  const hidden = new Set(storageEdits().hiddenBays);
  return allStorageBays().filter(b => b.custom || !hidden.has(b.id));
}

// Handbook bays the user hid (#166), with the items the plan would still keep in them: those
// have no container while the bay is hidden. Hidden bays are left out of storageBays(), and so
// out of the storage page's grid and counts, the plan's storage tile and ADA.
export function hiddenStorageBays(): {
  id: string;
  name: string;
  items: string[];
  // An added bay has taken the letter (#167), so the bay cannot be restored until it goes.
  taken: boolean;
  floor: string;
  moved: boolean;
}[] {
  const e = storageEdits(),
    hidden = new Set(e.hiddenBays);
  // A hidden letter an added bay has taken (#167) shares its addresses with that bay, so its
  // planned items are read from the plan alone, not from the added bay's containers.
  const taken = new Set(e.bays.map(b => b.id).filter(id => hidden.has(id)));
  return allStorageBays(taken)
    .filter(b => !b.custom && hidden.has(b.id))
    .map(b => ({
      id: b.id,
      name: b.name,
      items: b.items.filter(x => x.name).map(x => x.name!),
      taken: taken.has(b.id),
      // Where it sits, and whether it was moved there (#190): a hidden bay moved onto a floor
      // still keeps that floor from being hidden or removed (#216).
      floor: b.floor,
      moved: !!e.bayFloors?.[b.id],
    }));
}

// Whether position `x` answers the storage search `q`: a container whose address or item
// contains it, ignoring case. The page narrows each floor's bays with it, a bay marks its
// matching positions (.slot.match) and storageMatches() lists them on every floor.
export function slotMatches(x: StoragePosition, q: string): boolean {
  return !!(q && x.name && (x.id + ' ' + x.name).toLowerCase().includes(q.toLowerCase()));
}

// A container found by the storage search, with the floor it is on (#240).
export interface StorageMatch {
  id: string;
  name: string;
  floor: string;
  floorLabel: string;
}

// The containers answering `q` on every floor, in floor-tab order and then by address (#240).
// Only positions the room shows: bays in storageBays(), on a floor with a tab. A hidden bay's
// containers are not in the room (the page lists its items as unplaced), and a hidden floor has
// no bay showing, so a result never leads to something the page does not draw.
export function storageMatches(q: string): StorageMatch[] {
  if (!q) return [];
  const floors = storageFloors(),
    at = (id: string) => floors.findIndex(f => f.id === id);
  return storageBays()
    .filter(b => at(b.floor) >= 0)
    .flatMap(b =>
      b.items
        .filter(x => slotMatches(x, q))
        .map(x => ({
          id: x.id,
          // slotMatches() only accepts a named position.
          name: x.name!,
          floor: b.floor,
          floorLabel: floors[at(b.floor)]!.label,
        })),
    )
    .sort((a, b) => at(a.floor) - at(b.floor) || a.id.localeCompare(b.id));
}

// Every bay, hidden handbook bays included; storageBays() and hiddenStorageBays() split it.
// Handbook bays in `planOnly` show just the plan's items, without the user's container edits.
function allStorageBays(planOnly: Set<string> = new Set()): StorageBayView[] {
  // `selected` is null for the original handbook; for a calculated profile it is every
  // item any phase stores, so unselected handbook positions show as reserved.
  const e = storageEdits(),
    cleared = new Set(e.clearedSlots);
  const selected = calculated
    ? new Set(Object.values(calculated.stages).flatMap(p => Object.keys(p.storage || {})))
    : null;
  const keepCollectables = calculated
    ? (calculated.settings.collectables ?? calculated.settings.storage === 'all')
    : true;
  // A user's cleared address wins, then a name they filled in, then the planned item.
  const merge = (baseName: string | null, id: string) =>
    cleared.has(id) ? null : (e.slots[id] ?? baseName);
  // Eight printed positions per bay, and as many more as the highest address
  // anyone has filled there: a bay that runs out grows instead of turning items
  // away, and the printed addresses keep their place at the front.
  const bayLength = (id: string): number =>
    Object.keys(e.slots).reduce(
      (n: number, k) => (bayOfSlot(k) === id ? Math.max(n, slotPosition(k)) : n),
      8,
    );
  const positions = (id: string, from: number): StoragePosition[] =>
    Array.from({ length: Math.max(0, bayLength(id) - from) }, (_, i) => {
      const at = id + String(from + i + 1).padStart(2, '0');
      return { id: at, name: merge(null, at) };
    });
  // Handbook bays. A calculated profile keeps only its selected items, plus the
  // collectables bays Q and R when its settings keep collectables.
  const base: StorageBayView[] = plan.storage.map(b => ({
    ...b,
    // A handbook bay moved to another floor (#190) keeps everything else.
    floor: e.bayFloors?.[b.id] ?? b.floor,
    name: e.bayNames[b.id] || b.name,
    items: [
      ...b.items.map(x => {
        const planned = selected
          ? x.name && (selected.has(x.name) || (['Q', 'R'].includes(b.id) && keepCollectables))
            ? x.name
            : null
          : x.name;
        return { ...x, name: planOnly.has(b.id) ? planned : merge(planned, x.id) };
      }),
      ...(planOnly.has(b.id) ? [] : positions(b.id, b.items.length)),
    ],
  }));
  // Bays the user added: at least eight positions, all filled from `slots`. They always
  // show, while a handbook bay with nothing selected is hidden from a calculated profile.
  const custom: StorageBayView[] = e.bays.map(b => ({
    id: b.id,
    name: e.bayNames[b.id] || b.name,
    floor: b.floor,
    custom: true,
    items: positions(b.id, 0),
  }));
  return [...base, ...custom].filter(b => b.custom || !selected || b.items.some(x => x.name));
}

// A container is Done when all four of its saved checks are set: the keys are
// `slot-<address>-built/-labelled/-connected/-verified`. The Done box and "Complete room"
// both write these same four keys (ui/storage/StorageBay.vue), as does the container dialog
// one by one (SLOT_STEPS).
const slotChecks = ['built', 'labelled', 'connected', 'verified'];
export const slotKeys = (id: string) => slotChecks.map(k => 'slot-' + id + '-' + k);
export const slotDone = (id: string) => slotKeys(id).every(checked);

// How far a bay is (SP-23, #258): its named containers, and how many of those are Done. A
// reserved position has nothing to build, so it does not count. The bay's "3/8 containers done",
// its progress bar and its floor tab's total all read this, so they always agree.
export interface StorageProgress {
  done: number;
  named: number;
}
export function bayProgress(b: StorageBayView): StorageProgress {
  const named = b.items.filter(x => x.name);
  return { done: named.filter(x => slotDone(x.id)).length, named: named.length };
}

// The same per floor, over the bays the room shows (storageBays(): hidden bays are left out),
// keyed by floor id. A floor with no bay is absent.
export function floorProgress(): Map<string, StorageProgress> {
  const totals = new Map<string, StorageProgress>();
  for (const b of storageBays()) {
    const p = bayProgress(b),
      t = totals.get(b.floor) ?? { done: 0, named: 0 };
    totals.set(b.floor, { done: t.done + p.done, named: t.named + p.named });
  }
  return totals;
}

// The handbook's ground-floor moves (SP-25, #260): the owner's built room still has Gas Filters,
// Nobelisks and Medicinal Inhalers to move, which the ground floor's notice asks for until its
// Done is pressed. Done ticks the key of the handbook's own storage step for the same moves ("Put
// the filters together"), so no new record is saved and unticking that step shows the notice
// again. Only the original handbook profile has the built room; a calculated profile never does.
export const GROUND_MOVES = 'storage-filter-moves';
export const groundMovesPending = () =>
  !calculated && currentProfile?.kind === 'original' && !checked(GROUND_MOVES);

// The four steps of a container, as saved check keys `slot-<address>-<step>` and labels.
export const SLOT_STEPS: [step: string, label: string][] = [
  ['built', 'Container placed'],
  ['labelled', 'Sign and address labelled'],
  ['connected', 'Correct supply connected'],
  ['verified', 'Flow and overflow verified'],
];

// Opens the container dialog for address `id` (ui/detail/SlotDialog.vue); nothing for a
// reserved position.
export function openSlot(id: string) {
  if (!storageBays().some(b => b.items.some(x => x.id === id && x.name))) return;
  showDetail({ kind: 'slot', id });
}

// The update for dropping the container at `from` on position `to` (#208), with the items the page
// shows at both, or null when there is nothing to move: no container at `from`, the same place,
// or an address past the end of its bay other than the next one there.
export function containerMove(from: string, to: string): UpdateOp | null {
  if (from === to) return null;
  const all = storageBays().flatMap(b => b.items);
  const fromName = all.find(x => x.id === from)?.name;
  if (!fromName) return null;
  const target = all.find(x => x.id === to);
  if (!target) {
    const bay = storageBays().find(b => b.id === bayOfSlot(to));
    if (!bay || slotPosition(to) !== bay.items.length + 1) return null;
  }
  return { type: 'storageSlotMove', from, to, fromName, toName: target?.name ?? null };
}
