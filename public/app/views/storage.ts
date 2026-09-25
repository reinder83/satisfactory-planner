// The storage room's data (#storage, ui/pages/StoragePage.vue): floors, bays and container
// positions after the profile's layout edits, and each container's four saved checks. One
// room serves both profile kinds: the original handbook shows its printed room, a calculated
// profile shows the same addresses with only the items it selected for storage.
// Container addresses (`A01`, `S09`, …) are saved progress keys and must never move.
import { bayOfSlot, slotPosition } from '../../state.js';
import { num } from '../format.ts';
import { calculated, checked, plan, setActiveDetail, state } from '../session.ts';
import { showDetail } from '../ui/detail.ts';
import type { ItemRates, StorageEdits } from '../../types/index.ts';

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
// `clearedSlots` (handbook addresses the user emptied, kept as reserved positions).
function storageEdits(): StorageEdits {
  const e: Partial<StorageEdits> = state?.storageEdits || {};
  return {
    floors: e.floors || [],
    floorNames: e.floorNames || {},
    bays: e.bays || [],
    bayNames: e.bayNames || {},
    slots: e.slots || {},
    clearedSlots: e.clearedSlots || [],
  };
}

// The floor tabs: the three built-in floors (renameable, never removable) followed by
// floors the user added.
const BUILTIN_FLOORS: [id: string, label: string][] = [
  ['ground', 'Ground floor'],
  ['upper', 'Upper floor'],
  ['workshop', 'Workshop'],
];
export function storageFloors(): StorageFloor[] {
  const e = storageEdits();
  return [
    ...BUILTIN_FLOORS.map(([id, label]) => ({
      id,
      label: e.floorNames[id] || label,
      builtin: true,
    })),
    ...e.floors.map(f => ({ id: f.id, label: e.floorNames[f.id] || f.label, builtin: false })),
  ];
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
    name: e.bayNames[b.id] || b.name,
    items: [
      ...b.items.map(x => {
        const planned = selected
          ? x.name && (selected.has(x.name) || (['Q', 'R'].includes(b.id) && keepCollectables))
            ? x.name
            : null
          : x.name;
        return { ...x, name: merge(planned, x.id) };
      }),
      ...positions(b.id, b.items.length),
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
  setActiveDetail({ type: 'slot', id });
  showDetail({ kind: 'slot', id });
}
