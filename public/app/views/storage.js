// Storage room view (#storage): floors, bays, container slots and the workshop. One page
// serves both profile kinds: the original handbook shows its printed room, a calculated
// profile shows the same addresses with only the items it selected for storage.
// Container addresses (`A01`, `S09`, …) are saved progress keys and must never move.
import { bayCapacity, bayOfSlot, slotPosition } from '../../state.js';
import { dialog } from '../factory-detail.js';
import { esc, num, slug } from '../format.js';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  doneAttr,
  floor,
  layoutEditing,
  plan,
  query,
  setActiveDetail,
  setFloor,
  state,
} from '../session.js';
import { header } from '../shell.js';
import { taskHtml } from '../tasks.js';

// Items kept at a zero rate hold their container and address without reserving
// production, so they belong on the storage map rather than in a rate list.
// inputText: escaped "Item 12/min · Item 3/min" text for the non-zero entries of an
// item → rate map. Used across the factory, resource and detail views.
export function inputText(inputs) {
  return Object.entries(inputs)
    .filter(([, q]) => q)
    .map(([n, q]) => esc(n) + ' ' + num(q) + '/min')
    .join(' · ');
}

// The profile's storage layout edits with defaults filled in: added floors and bays,
// renamed floors and bays, `slots` (address → item name filled in by the user) and
// `clearedSlots` (handbook addresses the user emptied, kept as reserved positions).
function storageEdits() {
  const e = state?.storageEdits || {};
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
function storageFloors() {
  const e = storageEdits();
  return [
    ...[
      ['ground', 'Ground floor'],
      ['upper', 'Upper floor'],
      ['workshop', 'Workshop'],
    ].map(([id, label]) => ({ id, label: e.floorNames[id] || label, builtin: true })),
    ...e.floors.map(f => ({ id: f.id, label: e.floorNames[f.id] || f.label, builtin: false })),
  ];
}

// The id for a bay the user adds (#add-bay in events/views.js): the first unused letter,
// starting after the handbook's A–R (W is tried last), then two-letter ids. null when
// every id is taken. The id becomes part of each container address, so it never changes.
export function nextBayLetter() {
  const used = new Set([...plan.storage.map(b => b.id), ...storageEdits().bays.map(b => b.id)]);
  for (const l of 'STUVXYZABCDEFGHIJKLMNOPQRW') if (!used.has(l)) return l;
  for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(a + b)) return a + b;
  return null;
}

// Every bay with its positions as { id: address, name: item or null }, after applying the
// profile's layout edits. A null name is a reserved (empty) position. Used by this page,
// the plan's storage tile, ADA, and the room/container handlers in events/views.js.
export function storageBays() {
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
  const merge = (baseName, id) => (cleared.has(id) ? null : (e.slots[id] ?? baseName));
  // Eight printed positions per bay, and as many more as the highest address
  // anyone has filled there: a bay that runs out grows instead of turning items
  // away, and the printed addresses keep their place at the front.
  const bayLength = id =>
    Object.keys(e.slots).reduce(
      (n, k) => (bayOfSlot(k) === id ? Math.max(n, slotPosition(k)) : n),
      8,
    );
  const positions = (id, from) =>
    Array.from({ length: Math.max(0, bayLength(id) - from) }, (_, i) => {
      const at = id + String(from + i + 1).padStart(2, '0');
      return { id: at, name: merge(null, at) };
    });
  // Handbook bays. A calculated profile keeps only its selected items, plus the
  // collectables bays Q and R when its settings keep collectables.
  const base = plan.storage.map(b => ({
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
  const custom = e.bays.map(b => ({
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
// both write these same four keys (events/views.js), as does the slot dialog one by one.
const slotChecks = ['built', 'labelled', 'connected', 'verified'];
export const slotKeys = id => slotChecks.map(k => 'slot-' + id + '-' + k);
const slotDone = id => slotKeys(id).every(checked);

// HTML for the #storage page: floor tabs and search, the layout editor, the workshop (on
// its floor), the bay grid and the storage build checklist. Side effect: when the remembered
// floor no longer exists (a removed floor), it switches to the first one.
export function renderStorage() {
  const floors = storageFloors();
  if (!floors.some(f => f.id === floor)) setFloor(floors[0].id);
  const current = floors.find(f => f.id === floor);
  // Bays on this floor; the search (#storage-search) narrows them to bays with a match.
  const bays = storageBays();
  const floorBays = bays.filter(b => b.floor === floor),
    display = floorBays.filter(
      b =>
        !query ||
        b.items.some(
          x => x.name && (x.id + ' ' + x.name).toLowerCase().includes(query.toLowerCase()),
        ),
    );
  // The wide grid reads like the hall itself: the rear row at the top, two bays
  // to a row with the aisle between them. A narrow screen gets a single column,
  // where that arrangement reads as a jumble, so the document keeps the bays in
  // address order and their hall positions are grid placement only. Keyboard
  // focus then follows the stacked order too.
  const placed = [...display]
    .sort(
      (a, b) =>
        Math.floor((b.id.charCodeAt(0) - 65) / 2) - Math.floor((a.id.charCodeAt(0) - 65) / 2) ||
        a.id.localeCompare(b.id),
    )
    .map(b => b.id);
  const ordered = [...display].sort((a, b) => a.id.localeCompare(b.id));
  const aisles = Array.from(
    { length: Math.floor(placed.length / 2) },
    (_, r) => `<div class="aisle" style="--aisle-row:${r + 1}">MAIN AISLE</div>`,
  ).join('');
  // Floor tabs (`data-floor`) and, while editing the layout, the add/rename forms
  // (#add-bay, #add-floor, #rename-floor) and `data-remove-floor`, all in events/views.js.
  const floorTabs = `<div class="tabs">${floors.map(f => `<button class="tab ${floor === f.id ? 'active' : ''}" data-floor="${f.id}">${esc(f.label)}</button>`).join('')}</div>`;
  const editPanel = layoutEditing
    ? `<section class="panel edit-panel"><h2>Storage layout</h2><div class="edit-grid">
  <form id="add-bay" class="inline-form"><input id="new-bay-name" name="name" maxlength="80" required placeholder="New bay on this floor…" aria-label="New bay name"><button class="btn primary" type="submit">+ Add bay</button></form>
  <form id="add-floor" class="inline-form"><input id="new-floor-name" name="name" maxlength="80" required placeholder="New floor (e.g. Basement overflow)" aria-label="New floor name"><button class="btn" type="submit">Add floor</button></form>
  <form id="rename-floor" class="inline-form"><input id="floor-rename-input" name="name" maxlength="80" required placeholder="Rename this floor…" aria-label="Rename this floor"><button class="btn" type="submit">Rename floor</button></form>
  ${current.builtin ? '' : `<button class="btn danger" data-remove-floor="${current.id}" ${floorBays.length ? 'disabled' : ''}>${floorBays.length ? 'Remove its bays first' : 'Remove this floor'}</button>`}
 </div><p class="small muted">Handbook bays and their addresses stay put: rename them or fill reserved positions. Added bays get the next free letter so container addresses and progress stay stable. A bay with no free position takes extra containers at 09 and upwards. Removing a container keeps its saved checkmarks.</p></section>`
    : '';
  // Floor notes. The ground-floor instructions describe the owner's built room, so only
  // the original profile gets them.
  const notice =
    floor === 'ground'
      ? currentProfile.id !== 'original'
        ? '<div class="notice blue">Optional storage template. Each position has its own checklist; nothing is assumed built.</div>'
        : '<div class="notice blue"><b>Ground floor is built.</b> The shell is marked complete. Move Gas Filters G08 → H02 and Nobelisks H02 → H08; assign Medicinal Inhalers to G08. H01 stays Iodine-Infused Filter.</div>'
      : floor === 'upper'
        ? '<div class="notice blue">Q sits behind O; R sits behind P. Packaged fluids only. Nuclear items and unpackaged fluids stay outside this room.</div>'
        : '';
  // The bay grid itself, with its rear/entrance markers.
  const bayArea = `${notice}
 ${query ? '<p class="small muted">Filtered view: showing matching bays only. Clear search to see the full floor arrangement.</p>' : ''}${ordered.length ? '<p class="eyebrow floor-marker">REAR OF HALL ↑</p>' : ''}<div class="floor-grid">${aisles + ordered.map(b => bayHtml(b, placed.indexOf(b.id))).join('') || (floor === 'workshop' ? '' : `<div class="empty-state">${floorBays.length ? 'No matching item on this floor. Try another floor.' : 'No bays on this floor yet. Use Edit layout to add one.'}</div>`)}</div>${ordered.length ? '<div class="entry floor-marker">↓ ENTRANCE / STAIRS</div><div class="small muted">Within each bay, 01–04 are the rear bank; 05–08 are the front bank. Read left to right on both banks. Grey positions remain unassigned. Positions from 09 are containers added beyond the printed bay.</div>' : ''}`;
  // The build checklist is the handbook's storageTasks, or for a calculated profile one
  // step with the saved key `calc-storage-layout`.
  return (
    header(
      'ONE ITEM · ONE ADDRESS',
      'Storage room',
      calculated
        ? 'Showing your selected storage supply across all phases. Unselected positions are reserved; addresses stay stable.'
        : 'Mark containers Done here, or complete a room after placing, labelling, connecting and checking its containers. Click an item for details. Positions match your printed storage plan.',
    ) +
    `<div class="toolbar">${floorTabs}<input id="storage-search" class="search" aria-label="Find storage on this floor" placeholder="Find an item or address on this floor…" value="${esc(query)}"><button class="btn ${layoutEditing ? 'primary' : ''}" data-toggle-layout>${layoutEditing ? 'Done editing' : 'Edit layout'}</button></div>` +
    editPanel +
    (floor === 'workshop' ? renderWorkshop() : '') +
    bayArea +
    `<section style="margin-top:28px"><h2>Storage build checklist</h2><div class="checklist">${(calculated ? [{ id: 'calc-storage-layout', title: 'Build and label the selected storage positions', body: 'Use one container per selected item. Reserve its refill supply and route sinkable overflow to the AWESOME Sink; gathered items need manual replenishment.' }] : plan.storageTasks).map(taskHtml).join('')}</div></section>`
  );
}

// HTML for one bay. `position` is its index in hall order and sets the CSS grid row and
// column (two bays per row, aisle between). Hooks for events/views.js: `data-slot` opens a
// container, `data-complete-slot` is its Done box, `data-complete-bay` completes the room,
// and in layout editing `data-bay-rename`, `data-remove-bay` (added bays only),
// `data-clear-slot` and the .add-container form (`data-bay`). Item names are user text: esc().
function bayHtml(b, position = 0) {
  const items = b.items.filter(x => x.name),
    done = items.filter(x => slotDone(x.id)).length;
  const title = layoutEditing
    ? `<input id="bay-name-${b.id}" class="bay-rename" data-bay-rename="${b.id}" value="${esc(b.name)}" maxlength="80" aria-label="Rename bay ${b.id}">`
    : `<h3>${esc(b.name)}</h3>`;
  const removeBay =
    layoutEditing && b.custom
      ? `<button class="btn danger" data-remove-bay="${b.id}">Remove bay</button>`
      : '';
  // A full bay still takes another container: it gets the next address instead of
  // the form disappearing, up to the addressable limit.
  const addContainer =
    layoutEditing && b.items.length < bayCapacity
      ? `<form class="inline-form add-container" data-bay="${b.id}"><input id="bay-draft-${b.id}" name="name" maxlength="120" required placeholder="${items.length < b.items.length ? 'Add container: item name…' : 'Add a position beyond ' + b.items.at(-1).id + '…'}" aria-label="Add container to bay ${b.id}"><button class="btn" type="submit">+ Add</button></form>`
      : '';
  return `<section class="bay" style="--bay-row:${Math.floor(position / 2) + 1};--bay-col:${position % 2 ? 3 : 1}"><header class="bay-head"><span class="bay-letter">${b.id}</span>${title}</header><div class="bay-actions"><span class="small muted">${done}/${items.length} containers done</span><span>${removeBay} <button class="btn quiet" data-complete-bay="${b.id}" ${!items.length || done === items.length ? 'disabled' : ''}>Complete room ${b.id}</button></span></div><div class="bay-items">${b.items.map((x, i) => `${i === 4 ? '<div class="walkway">BAY WALKWAY</div>' : ''}${i === 8 ? '<div class="walkway added">ADDED POSITIONS</div>' : ''}${x.name ? `<div class="slot ${slotDone(x.id) ? 'done' : ''} ${query && (x.id + ' ' + x.name).toLowerCase().includes(query.toLowerCase()) ? 'match' : ''}">${layoutEditing ? `<button class="slot-remove" data-clear-slot="${x.id}" aria-label="Clear container ${x.id}: ${esc(x.name)}">✕</button>` : ''}<button class="slot-details" data-slot="${x.id}" aria-label="${x.id}: ${esc(x.name)}"><strong>${x.id}</strong><img class="item-icon" src="./icons/${slug(x.name)}.png" width="48" height="48" loading="lazy" alt=""><span>${esc(x.name)}</span></button><label class="slot-complete"><input type="checkbox" data-complete-slot="${x.id}" aria-label="Complete ${x.id}: ${esc(x.name)}" ${slotDone(x.id) ? 'checked' : ''}>Done</label></div>` : `<div class="slot empty"><strong>${x.id}</strong><span>Reserved</span></div>`}`).join('')}</div>${addContainer}</section>`;
}

// HTML for the workshop floor's panel: a fixed checklist with saved keys `workshop-<id>`.
function renderWorkshop() {
  const items = [
    ['bench', 'Craft Bench and Equipment Workshop', 'Side by side near the entrance.'],
    ['tools', 'Tools and mobility equipment', 'Personal boxes on the left wall.'],
    [
      'weapons',
      'Weapons and spare wearables',
      'Personal boxes on the right wall. Ammo and filters stay in G/H.',
    ],
    [
      'mam',
      'MAM and inventory drop',
      'Rear wall, with collected items routed to Q/R. Finish the sorter at a recovery chest.',
    ],
  ];
  return `<div class="panel"><span class="eyebrow">GROUND-FLOOR REAR EXTENSION</span><h2 style="margin-top:10px">Workshop beneath Q/R</h2><p>The upper floor gets the new storage bays; the space underneath becomes your crafting area. No existing production-container addresses change.</p><div class="checklist">${items.map(([id, title, body]) => taskHtml({ id: 'workshop-' + id, title, body })).join('')}</div></div>`;
}

// Opens the detail dialog for container `id` (from a `data-slot` click in
// events/views.js); does nothing for a reserved position. Shows the four
// `slot-<id>-<step>` checks, a link to the factory that makes the item (`data-calc-factory`
// on a calculated profile, `data-factory` on the original), and the `slot-<id>` note.
// setActiveDetail records which dialog is open (currently nothing reads it back).
export function openSlot(id) {
  const b = storageBays().find(b => b.items.some(x => x.id === id));
  const x = b?.items.find(x => x.id === id);
  if (!x?.name) return;
  setActiveDetail({ type: 'slot', id });
  const factory = calculated
    ? calcStage().rows?.find(r => r.outputs[x.name])
    : plan.factories.find(f => f.name === x.name);
  const index = Number(id.slice(b.id.length));
  dialog(
    x.name,
    `${id} · ${esc(storageFloors().find(f => f.id === b.floor)?.label || b.floor)} · Bay ${b.id}`,
    `<p><b>${esc(b.name)}</b><br>${index <= 4 ? 'Rear' : 'Front'} bank, position ${((index - 1) % 4) + 1} from the left on the floor plan.</p><div class="check-columns">${[
      ['built', 'Container placed'],
      ['labelled', 'Sign and address labelled'],
      ['connected', 'Correct supply connected'],
      ['verified', 'Flow and overflow verified'],
    ]
      .map(
        ([k, l]) =>
          `<label class="check-row"><input type="checkbox" data-check="slot-${id}-${k}" ${doneAttr('slot-' + id + '-' + k)}>${l}</label>`,
      )
      .join(
        '',
      )}</div>${factory ? `<div class="detail-actions"><button class="btn" ${calculated ? 'data-calc-factory' : 'data-factory'}="${factory.id}">Open production target →</button></div>` : '<p class="small muted">Collected or completion item. Reserve its own supply; this storage position does not add production capacity.</p>'}<h3>Container notes</h3><textarea id="detail-note" class="notes" maxlength="6000" aria-label="Container notes">${esc(state.notes['slot-' + id] || '')}</textarea><div class="note-save"><span class="small muted">Belt source, splitter setting or remaining work.</span><button class="btn" data-save-note="slot-${id}" data-input="detail-note">Save notes</button></div>`,
    x.name,
  );
}
