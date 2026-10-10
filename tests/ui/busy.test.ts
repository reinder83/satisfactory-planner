// A control busy with its save keeps focus (#299, public/app/busy.ts): Edge and Chrome move focus
// to <body> the moment a focused control becomes disabled, so a busy control is aria-disabled
// instead, and a second press while it is busy sends nothing. A control that stays disabled
// because of what it did, or whose page goes (Round up production, Recalculate in place with
// transport fuel: #300; to the new page’s heading, #304), sends focus on. happy-dom keeps focus on a disabled control, so the observer below
// does what the browsers do. Writes are held until release(), as on a slow connection.
// The focused element is compared by what identifies it, never two elements with assert.equal
// (#287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  setFactoryEditing,
  setFloor,
  setLayoutEditing,
  setQuery,
  state,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  catalog,
  generated,
  go,
  migratedRow,
  open,
  openMigrated,
  page,
} from './setup.ts';
import type { StorageEdits, UpdateOp } from '../../public/types/index.ts';

// Focus leaves a control that becomes disabled, as in Edge and Chrome. happy-dom's blur() does
// nothing on a disabled element, so focus goes to a stand-in that then leaves the page, which
// puts focus on <body>.
let blurDisabled: MutationObserver | null = null;
function browserFocus() {
  blurDisabled?.disconnect();
  blurDisabled = new MutationObserver(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.matches(':disabled')) return;
    const away = document.createElement('button');
    document.body.append(away);
    away.focus();
    away.remove();
  });
  blurDisabled.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
}

// Every request waits until release(); `reply` answers it by path, a throw answers 500.
function heldFetch(reply: (path: string, body: never) => unknown) {
  const calls: [path: string, body: unknown][] = [];
  let waiting: (() => void)[] = [];
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push([String(path), body]);
    await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return new Response(JSON.stringify(reply(String(path), body as never)), { status: 200 });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
    }
  };
  return {
    calls,
    release: async () => {
      for (let i = 0; i < 5 && !waiting.length; i++) await settle();
      const now = waiting;
      waiting = [];
      now.forEach(resolve => resolve());
      await settle();
    },
  };
}
const updates = (path: string, update: UpdateOp) => {
  if (path !== '/api/update') throw Error('unexpected ' + path);
  return applyUpdate(update);
};
const failing = () => {
  throw Error('Simulated failure');
};

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// Focus a control, then press it, as the keyboard does (Enter on a button, Space on a box).
const press = (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector);
  el.focus();
  el.click();
};
// A select or field changed with the keyboard: it keeps focus and fires change.
const change = (selector: string, value: string) => {
  const el = $<HTMLInputElement | HTMLSelectElement>(selector);
  assert.ok(el, selector);
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const focused = () => document.activeElement as HTMLElement | null;
// Whether focus is on the element `selector` finds (a boolean, so a failure prints both).
const focusedOn = (selector: string) => {
  const want = $(selector);
  assert.ok(want, 'expected ' + selector + ' on the page');
  return focused() === want;
};
const describeFocus = () => focused()?.outerHTML.slice(0, 120) ?? 'null';
// Busy: announced and drawn as unavailable, but not disabled, so it keeps focus.
const busy = (selector: string) => {
  const el = $<HTMLButtonElement | HTMLInputElement>(selector)!;
  return el.getAttribute('aria-disabled') === 'true' && !el.disabled;
};
const ready = (selector: string) => {
  const el = $<HTMLButtonElement | HTMLInputElement>(selector)!;
  return !el.hasAttribute('aria-disabled') && !el.disabled;
};

beforeEach(() => {
  page();
  openMigrated();
  setQuery('');
  setFloor('ground');
  setLayoutEditing(false);
  setFactoryEditing(false);
  answerConfirms(true);
  browserFocus();
});

test('the browser stand-in takes focus off a control that becomes disabled', async () => {
  go('storage');
  render();
  await nextTick();
  const button = $<HTMLButtonElement>('[data-complete-bay="A"]')!;
  button.focus();
  button.disabled = true;
  await nextTick();
  assert.equal(focused(), document.body, describeFocus());
});

test('Complete room keeps focus while it saves, then goes on to the next room (#299)', async () => {
  const net = heldFetch(updates);
  go('storage');
  render();
  await nextTick();
  press('[data-complete-bay="A"]');
  await settle();
  assert.ok(busy('[data-complete-bay="A"]'), 'busy while it saves');
  assert.ok(focusedOn('[data-complete-bay="A"]'), describeFocus());
  // A second press while it saves sends nothing.
  press('[data-complete-bay="A"]');
  await settle();
  assert.equal(net.calls.length, 1);
  await net.release();
  await settle();
  assert.equal($<HTMLButtonElement>('[data-complete-bay="A"]')!.disabled, true, 'room A is done');
  assert.match($('[data-complete-bay="A"]')!.textContent!, /Room A completed/);
  assert.ok(focusedOn('[data-complete-bay="B"]'), describeFocus());
  assert.equal(net.calls.length, 1);
});

test('Complete room of the last open room goes to its first container', async () => {
  const net = heldFetch(updates);
  go('storage');
  render();
  await nextTick();
  const others = $$('[data-complete-bay]')
    .map(b => b.dataset.completeBay!)
    .filter(id => id !== 'A');
  // Every other room is complete already.
  for (const id of others) {
    press(`[data-complete-bay="${id}"]`);
    await net.release();
  }
  press('[data-complete-bay="A"]');
  await net.release();
  await settle();
  assert.ok(focusedOn('[data-slot="A01"]'), describeFocus());
});

test('a container’s Done box keeps focus, and a second press while it saves does nothing', async () => {
  const net = heldFetch(updates);
  go('storage');
  render();
  await nextTick();
  press('[data-complete-slot="A01"]');
  await settle();
  const box = () => $<HTMLInputElement>('[data-complete-slot="A01"]')!;
  assert.ok(busy('[data-complete-slot="A01"]'));
  assert.ok(focusedOn('[data-complete-slot="A01"]'), describeFocus());
  press('[data-complete-slot="A01"]');
  await settle();
  assert.equal(box().checked, true, 'the second press does not untick it');
  assert.equal(net.calls.length, 1);
  await net.release();
  assert.ok(ready('[data-complete-slot="A01"]'));
  assert.equal(box().checked, true);
  assert.equal(state.checks['slot-A01-built'], true);
  assert.ok(focusedOn('[data-complete-slot="A01"]'), describeFocus());
});

test('a progress checkbox on the build plan keeps focus while it saves', async () => {
  const net = heldFetch(updates);
  go('plan');
  render();
  await nextTick();
  const key = $('#main [data-check]')!.dataset.check!;
  const sel = `#main [data-check="${key}"]`;
  press(sel);
  await settle();
  assert.ok(busy(sel));
  assert.ok(focusedOn(sel), describeFocus());
  press(sel);
  await settle();
  assert.equal($<HTMLInputElement>(sel)!.checked, true, 'the second press does not untick it');
  assert.equal(net.calls.length, 1);
  await net.release();
  assert.equal(state.checks[key], true);
  assert.ok(ready(sel));
  // Once saved, the ticked step folds into "Done (n)" (SP-42), and focus goes on to the step
  // that now leads the list.
  assert.ok($(`#main .done-group [data-check="${key}"]`));
  assert.ok(focusedOn('#main [data-open-steps] > .task.lead input[data-check]'), describeFocus());
});

test('a factory dialog’s Running box in the header keeps focus while it saves (#239)', async () => {
  const net = heldFetch(updates);
  go('factories');
  render();
  await nextTick();
  openMigrated();
  go('factories');
  render();
  await nextTick();
  const key = 'calc-3-' + migratedRow('wire');
  openCalculatedFactory(migratedRow('wire'));
  await nextTick();
  const sel = `#detail .dialog-head [data-check="${key}"]`;
  press(sel);
  await settle();
  assert.ok(busy(sel));
  assert.ok(focusedOn(sel), describeFocus());
  press(sel);
  await settle();
  assert.equal($<HTMLInputElement>(sel)!.checked, true, 'the second press does not untick it');
  assert.equal(net.calls.length, 1);
  await net.release();
  assert.equal(state.checks[key], true);
  assert.ok(ready(sel));
  assert.ok(focusedOn(sel), describeFocus());
});

test('Move right / Move left keep focus, and go to the other arrow at the end of the row', async () => {
  const net = heldFetch(updates);
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  press('[data-bay-right="A"]');
  await settle();
  assert.ok(busy('[data-bay-right="A"]'));
  assert.ok(busy('[data-bay-left="A"]'), 'both arrows wait');
  assert.ok(focusedOn('[data-bay-right="A"]'), describeFocus());
  press('[data-bay-right="A"]');
  await settle();
  assert.equal(net.calls.length, 1, 'a second press while it saves sends nothing');
  await net.release();
  assert.deepEqual(state.storageEdits?.bayOrder?.ground?.slice(0, 2), ['B', 'A']);
  assert.ok(focusedOn('[data-bay-right="A"]'), describeFocus());
  // Back to the first place: Move left is disabled there, so focus goes to Move right.
  press('[data-bay-left="A"]');
  await net.release();
  assert.equal($<HTMLButtonElement>('[data-bay-left="A"]')!.disabled, true);
  assert.ok(focusedOn('[data-bay-right="A"]'), describeFocus());
});

test('a failed Move keeps the bay, the floor picked and focus on Move (#854)', async () => {
  const net = heldFetch(failing);
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  change('[data-move-bay="D"]', 'upper');
  await settle();
  press('[data-move-bay-go="D"]');
  await net.release();
  assert.ok($('[data-slot="D01"]'), 'bay D is still there');
  assert.equal($<HTMLSelectElement>('[data-move-bay="D"]')!.value, 'upper');
  assert.ok(ready('[data-move-bay-go="D"]'));
  assert.ok(focusedOn('[data-move-bay-go="D"]'), describeFocus());
  assert.equal(net.calls.length, 1);
});

test('Move keeps focus while it saves, then goes to the next bay’s menu', async () => {
  const net = heldFetch(updates);
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  // The menu only picks the floor; Move moves the bay (#854).
  change('[data-move-bay="D"]', 'upper');
  await settle();
  assert.equal(net.calls.length, 0, 'picking a floor saves nothing');
  press('[data-move-bay-go="D"]');
  await settle();
  assert.ok(busy('[data-move-bay-go="D"]'));
  assert.ok(focusedOn('[data-move-bay-go="D"]'), describeFocus());
  // Pressed again meanwhile, it sends nothing.
  press('[data-move-bay-go="D"]');
  await settle();
  assert.equal(net.calls.length, 1);
  await net.release();
  assert.equal($('[data-slot="D01"]'), null, 'bay D left the ground floor');
  assert.ok(focusedOn('[data-move-bay="E"]'), describeFocus());
});

test('a bay’s name field is read-only while it saves and keeps focus', async () => {
  const net = heldFetch(updates);
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  change('[data-bay-rename="C"]', 'Renamed');
  await settle();
  assert.ok(busy('[data-bay-rename="C"]'));
  assert.equal($<HTMLInputElement>('[data-bay-rename="C"]')!.readOnly, true);
  assert.ok(focusedOn('[data-bay-rename="C"]'), describeFocus());
  await net.release();
  assert.ok(ready('[data-bay-rename="C"]'));
  assert.equal($<HTMLInputElement>('[data-bay-rename="C"]')!.readOnly, false);
  assert.ok(focusedOn('[data-bay-rename="C"]'), describeFocus());
});

test('a failed Hide bay leaves focus on it, and it asks only once while it saves', async () => {
  const net = heldFetch(failing);
  const asked = answerConfirms(true);
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  press('[data-hide-bay="E"]');
  await settle();
  assert.ok(busy('[data-hide-bay="E"]'));
  assert.ok(focusedOn('[data-hide-bay="E"]'), describeFocus());
  press('[data-hide-bay="E"]');
  await settle();
  assert.equal(asked.length, 1, 'no second question');
  await net.release();
  assert.ok($('[data-slot="E01"]'), 'bay E is still there');
  assert.ok(ready('[data-hide-bay="E"]'));
  assert.ok(focusedOn('[data-hide-bay="E"]'), describeFocus());
  assert.equal(net.calls.length, 1);
});

test('a failed Restore leaves focus on it (#299)', async () => {
  const net = heldFetch(failing);
  openMigrated({ state: { storageEdits: { hiddenBays: ['C'] } as StorageEdits } });
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  press('[data-restore-bay="C"]');
  await settle();
  assert.ok(busy('[data-restore-bay="C"]'));
  assert.ok(focusedOn('[data-restore-bay="C"]'), describeFocus());
  press('[data-restore-bay="C"]');
  await settle();
  assert.equal(net.calls.length, 1, 'a second press while it saves sends nothing');
  await net.release();
  assert.ok(ready('[data-restore-bay="C"]'));
  assert.ok(focusedOn('[data-restore-bay="C"]'), describeFocus());
});

test('a factory’s rate field and Add select keep focus while they save', async () => {
  const net = heldFetch(updates);
  const wire = migratedRow('wire');
  openMigrated({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cables' },
          { id: 'fg-plates1', name: 'Plates' },
          { id: 'fg-remote1', name: 'Remote' },
        ],
        assignments: { [wire]: [{ group: 'fg-cable01', rate: 300 }] },
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  const rate = `[data-assign-rate="${wire}"][data-group="fg-cable01"]`;
  change(rate, '120');
  await settle();
  assert.ok(busy(rate));
  assert.equal($<HTMLInputElement>(rate)!.readOnly, true);
  assert.ok(focusedOn(rate), describeFocus());
  await net.release();
  assert.equal(state.factoryGroups?.assignments[wire]?.[0]?.rate, 120);
  assert.ok(ready(rate));
  assert.ok(focusedOn(rate), describeFocus());
  // The menu only picks the group; Add joins it (#856).
  const add = `[data-assign-add="${wire}"]`,
    join = `[data-assign-go="${wire}"]`;
  change(add, 'fg-plates1');
  await settle();
  assert.equal(net.calls.length, 1, 'picking a group saves nothing');
  press(join);
  await settle();
  assert.ok(busy(join));
  assert.ok(focusedOn(join), describeFocus());
  // Pressed again meanwhile, it sends nothing.
  press(join);
  await settle();
  assert.equal(net.calls.length, 2);
  await net.release();
  assert.deepEqual(
    state.factoryGroups?.assignments[wire]?.map(m => m.group),
    ['fg-cable01', 'fg-plates1'],
  );
  assert.ok(focusedOn(add), describeFocus());
  // A factory joining its first group moves to that group's section: focus goes with it.
  const card = (el: Element | null) => el?.closest('.user-group, .cards');
  const computer = `[data-assign-add="${migratedRow('computer')}"]`;
  const before = card($(computer));
  change(computer, 'fg-remote1');
  await settle();
  press(`[data-assign-go="${migratedRow('computer')}"]`);
  await net.release();
  assert.ok(card($(computer)) !== before, 'the card moved');
  assert.ok(focusedOn(computer), describeFocus());
});

// Before #1053 the phase select saved the phase picked and was the busy control; now it only
// shows a phase, and "Work on Phase N" saves it.
test('"Work on Phase N" keeps focus while it saves, then focus goes to the phase picker', async () => {
  const net = heldFetch(updates);
  go('plan');
  render();
  await nextTick();
  assert.notEqual(state.settings.phase, '5');
  change('#phase-picker', '5');
  await settle();
  assert.equal(net.calls.length, 0, 'showing a phase saves nothing');
  press('[data-work-on-phase]');
  await settle();
  assert.ok(busy('[data-work-on-phase]'));
  assert.ok(focusedOn('[data-work-on-phase]'), describeFocus());
  press('[data-work-on-phase]');
  await settle();
  assert.equal(net.calls.length, 1, 'a second press meanwhile saves nothing');
  await net.release();
  assert.equal(state.settings.phase, '5');
  assert.equal($('[data-work-on-phase]'), null, 'the button goes with the phase it offered');
  assert.ok(focusedOn('[data-phase-seg="5"]'), describeFocus());
});

test('Round up production keeps focus while it calculates, then focus goes to the new page’s heading (#300, #304)', async () => {
  const plan = generated();
  open({ calculated: plan });
  go('factories');
  render();
  await nextTick();
  const net = heldFetch(path => {
    if (path === '/api/round-up') return { saveId: 's', profileId: 'p', reviewCount: 0, workspace };
    if (path.startsWith('/api/context'))
      return {
        save: { id: 's', name: 'World' },
        profile: { id: 'p', kind: 'calculated', name: 'Rounded' },
        state,
        plan: { ...plan, settings: { ...plan.settings, wholeMachines: true } },
      };
    throw Error('unexpected ' + path);
  });
  // It asks first (SP-18); confirmed, focus is back on the button while it calculates.
  const asked = answerConfirms(true);
  press('[data-round-up]');
  await settle();
  assert.equal(asked.length, 1);
  assert.ok(busy('[data-round-up]'));
  assert.ok(focusedOn('[data-round-up]'), describeFocus());
  press('[data-round-up]');
  await settle();
  assert.equal(net.calls.length, 1, 'a second press while it calculates sends nothing');
  await net.release();
  await net.release();
  await settle();
  assert.equal($('[data-round-up]'), null, 'the rounded profile needs no rounding');
  assert.match($('#toast')!.textContent!, /Created rounded profile/);
  assert.ok(focusedOn('#main h1'), describeFocus());
  assert.deepEqual(
    net.calls.map(c => c[0].split('?')[0]),
    ['/api/round-up', '/api/context'],
  );
});

test('Recalculate in place with transport fuel keeps focus while it calculates, then focus goes to the redrawn page’s heading (#300, #304, #1071)', async () => {
  const plan = generated();
  const factoryGroups = {
    groups: [
      { id: 'fg-smelt1', name: 'Smelting' },
      { id: 'fg-parts1', name: 'Parts' },
    ],
    assignments: Object.fromEntries(
      plan.stages['3'].rows!.map((row, i) => [
        row.id,
        [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }],
      ]),
    ),
    links: {
      'fg-smelt1:fg-parts1': { mode: 'truck' as const, roundTripMin: 6, fuel: 'Packaged Fuel' },
    },
  };
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: { version: 7, factoryGroups },
  });
  go('logistics');
  render();
  await nextTick();
  let fuel: object | undefined;
  const net = heldFetch((path, body: { settings: { transportFuel: object } }) => {
    if (path === '/api/recalculate') {
      fuel = body.settings.transportFuel;
      return {
        saveId: 's',
        profileId: 'p',
        backupId: 'b',
        reviewCount: 0,
        carriedChecks: 0,
        workspace,
      };
    }
    if (path.startsWith('/api/context'))
      return {
        save: { id: 's', name: 'World' },
        profile: { id: 'p', kind: 'calculated', name: 'Fuelled' },
        state: { ...state, factoryGroups },
        plan: { ...plan, settings: { ...plan.settings, transportFuel: fuel } },
      };
    throw Error('unexpected ' + path);
  });
  const asked = answerConfirms(true);
  press('[data-recalc-transport]');
  await settle();
  assert.equal(asked.length, 1, 'it asks first');
  assert.ok(busy('[data-recalc-transport]'));
  assert.ok(focusedOn('[data-recalc-transport]'), describeFocus());
  press('[data-recalc-transport]');
  await settle();
  assert.equal(net.calls.length, 1, 'a second press while it calculates sends nothing');
  await net.release();
  await net.release();
  await settle();
  assert.equal($('[data-recalc-transport]'), null, 'the recalculated plan plans the fuel');
  assert.ok(focusedOn('#main h1'), describeFocus());
});

test('Add task keeps focus while it saves, and Enter meanwhile adds nothing more', async () => {
  const net = heldFetch(updates);
  go('plan');
  render();
  await nextTick();
  const form = $<HTMLFormElement>('#add-task')!;
  form.querySelector('input')!.value = 'Build a train station';
  press('#add-task button');
  await settle();
  assert.ok(busy('#add-task button'));
  assert.ok(focusedOn('#add-task button'), describeFocus());
  // Enter in the field submits the form again.
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(net.calls.length, 1);
  await net.release();
  assert.equal(state.customTasks.length, 1);
  assert.ok(ready('#add-task button'));
  assert.ok(focusedOn('#add-task button'), describeFocus());
});
