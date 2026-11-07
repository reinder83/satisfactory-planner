// The built-machines counter (#1300) on a production line's card, in its dialog and in its
// build-plan step: − and + step the count, a typed number is clamped to 0 to the line's machines,
// the full count ticks the line Running in the same write, an untick keeps the count, the controls
// are named for the line and stay focusable at either end, and the factory's heading counts its
// machines built. Phase 4 of the default plan builds 5 Refineries for Residual Fuel.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { recalculatedText } from '../../public/app/recalculate.ts';
import { state, type View } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, applyUpdate, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type { CurrentCalculatedPlan, ProgressState, UpdateOp } from '../../public/types/index.ts';

let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generated()));
const ROW = 'Recipe_ResidualFuel_C';
const KEY = 'calc-4-' + ROW;
const GROUPS: Partial<ProgressState> = {
  version: 3,
  factoryGroups: {
    groups: [{ id: 'fg-oilfield', name: evil }],
    assignments: { [ROW]: [{ group: 'fg-oilfield', rate: null }] },
  },
};

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const card = () => $(`[data-check="${KEY}"]`)!.closest<HTMLElement>('.factory-card')!;
const counterIn = (root: ParentNode) => root.querySelector<HTMLElement>('[data-built-counter]')!;
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};

async function show(progress: Partial<ProgressState>, route: View = 'factories') {
  open({ calculated: plan(), phase: '4', state: progress });
  go(route);
  render();
  await nextTick();
}

const sent = (calls: ReturnType<typeof stubFetch<UpdateOp>>) =>
  calls
    .filter(([path]) => path === '/api/update')
    .map(([, body]) => {
      const { ticked, ...rest } = body as UpdateOp & { ticked?: unknown };
      return rest;
    });

beforeEach(() => page());

test('the card counts the machines built: named controls, + and −, partly built', async () => {
  await show({});
  const counter = counterIn(card());
  assert.equal(counter.getAttribute('role'), 'group');
  assert.equal(counter.getAttribute('aria-label'), 'Built machines: Residual Fuel');
  const input = counter.querySelector<HTMLInputElement>('[data-built-input]')!;
  assert.equal(input.value, '0');
  assert.equal(input.getAttribute('aria-label'), 'Machines built: Residual Fuel');
  assert.equal(text($('#' + input.getAttribute('aria-describedby'))), '/ of 5');
  assert.equal(input.min, '0');
  assert.equal(input.max, '5');
  const [minus, plus] = [...counter.querySelectorAll<HTMLButtonElement>('[data-built-step]')];
  assert.equal(minus!.getAttribute('aria-label'), 'One fewer built: Residual Fuel');
  assert.equal(plus!.getAttribute('aria-label'), 'One more built: Residual Fuel');
  // At 0 the − has nothing to do, but stays focusable (aria-disabled, never disabled).
  assert.equal(minus!.getAttribute('aria-disabled'), 'true');
  assert.equal(minus!.disabled, false);
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  minus!.click();
  await settle();
  assert.deepEqual(sent(calls), [], 'nothing below 0');
  plus!.click();
  plus!.click();
  await settle();
  assert.deepEqual(sent(calls), [
    { type: 'builtCount', key: KEY, value: 1 },
    { type: 'builtCount', key: KEY, value: 2 },
  ]);
  assert.deepEqual(state.builtMachines, { [KEY]: 2 });
  assert.equal(counterIn(card()).querySelector<HTMLInputElement>('input')!.value, '2');
  assert.equal(
    card().querySelector('[data-running-status]')!.getAttribute('data-running-status'),
    'partly',
  );
  assert.equal(text(card().querySelector('[data-grown]')), '2 of 5 machines built: add 3');
  assert.equal(card().querySelector<HTMLInputElement>('input[data-check]')!.checked, false);
  counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="-1"]')!.click();
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 1 });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.match(text($('#announce')), /^1 of 5 Refineries built\.$/);
});

test('a typed number is clamped to the line, and the full count ticks it Running', async () => {
  await show({});
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const type = async (value: string) => {
    const input = counterIn(card()).querySelector<HTMLInputElement>('[data-built-input]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await settle();
  };
  await type('3');
  assert.deepEqual(state.builtMachines, { [KEY]: 3 });
  await type('abc');
  assert.deepEqual(state.builtMachines, { [KEY]: 3 }, 'not a number: nothing saved');
  assert.equal(counterIn(card()).querySelector<HTMLInputElement>('input')!.value, '3');
  await type('-4');
  assert.equal(state.builtMachines, undefined, 'clamped to 0, which forgets the count');
  await type('99');
  assert.deepEqual(sent(calls).at(-1), { type: 'builtCount', key: KEY, value: 5, running: true });
  assert.equal(state.checks[KEY], true, 'the full count ticks the line');
  assert.ok(state.tickedBy?.[KEY]?.at, 'with who ticked it and when');
  assert.deepEqual(state.builtMachines, { [KEY]: 5 });
  assert.equal(card().querySelector<HTMLInputElement>('input[data-check]')!.checked, true);
  const plus = counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="1"]')!;
  assert.equal(plus.getAttribute('aria-disabled'), 'true');
  assert.equal(plus.disabled, false);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.match(text($('#announce')), /^5 of 5 Refineries built: Residual Fuel marked running\.$/);
});

test('unticking Running keeps the count, and counting a ticked line down unticks it', async () => {
  await show({ version: 19, checks: { [KEY]: true }, builtMachines: { [KEY]: 3 } });
  const input = () => counterIn(card()).querySelector<HTMLInputElement>('[data-built-input]')!;
  assert.equal(input().value, '5', 'ticked: all its machines stand');
  stubFetch({ '/api/update': applyUpdate });
  card().querySelector<HTMLInputElement>('input[data-check]')!.click();
  await settle();
  assert.equal(state.checks[KEY], false);
  assert.deepEqual(state.builtMachines, { [KEY]: 3 }, 'the count stays');
  assert.equal(input().value, '3');
  // Ticked again, then − : unticked at 4.
  card().querySelector<HTMLInputElement>('input[data-check]')!.click();
  await settle();
  assert.equal(input().value, '5');
  counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="-1"]')!.click();
  await settle();
  assert.equal(state.checks[KEY], false);
  assert.deepEqual(state.builtMachines, { [KEY]: 4 });
  assert.equal(input().value, '4');
});

test('focus stays on + when the full count ticks the line', async () => {
  await show({ version: 19, builtMachines: { [KEY]: 4 } });
  stubFetch({ '/api/update': applyUpdate });
  const plus = counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="1"]')!;
  plus.focus();
  plus.click();
  await settle();
  assert.equal(state.checks[KEY], true);
  const now = counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="1"]')!;
  assert.equal(document.activeElement, now);
  assert.equal(now.getAttribute('aria-disabled'), 'true');
});

test("the factory's heading counts the machines built in the phase", async () => {
  await show({ ...GROUPS, version: 19, builtMachines: { [KEY]: 2 } });
  assert.equal(text($('[data-group-built]')), '2 / 5 machines built');
  assert.equal($$('x-evil').length, 0);
  stubFetch({ '/api/update': applyUpdate });
  counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="1"]')!.click();
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 3 });
  assert.equal(text($('[data-group-built]')), '3 / 5 machines built');
});

test("the line's dialog has the same counter", async () => {
  await show({ version: 19, builtMachines: { [KEY]: 2 } });
  openCalculatedFactory(ROW);
  await nextTick();
  const counter = counterIn($('#detail')!);
  assert.equal(counter.querySelector<HTMLInputElement>('input')!.value, '2');
  stubFetch({ '/api/update': applyUpdate });
  counter.querySelector<HTMLButtonElement>('[data-built-step="1"]')!.click();
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 3 });
  assert.equal(counterIn($('#detail')!).querySelector<HTMLInputElement>('input')!.value, '3');
});

test("the line's build-plan step has the counter, and its full count ticks the step", async () => {
  await show({ version: 19, builtMachines: { [KEY]: 4 } }, 'plan');
  const task = () => $(`.task [data-check="${KEY}"]`)!.closest<HTMLElement>('.task')!;
  const counter = counterIn(task());
  assert.equal(counter.querySelector<HTMLInputElement>('input')!.value, '4');
  assert.equal(text(task().querySelector('[data-step-built]')), '4 of 5 built');
  stubFetch({ '/api/update': applyUpdate });
  counter.querySelector<HTMLButtonElement>('[data-built-step="1"]')!.click();
  await settle();
  assert.equal(state.checks[KEY], true);
  assert.equal(task().querySelector<HTMLInputElement>('input[data-check]')!.checked, true);
});

test('the phase checklist bar fills a partly built line by its share', async () => {
  await show({ version: 19, builtMachines: { [KEY]: 2 } }, 'plan');
  const bar = $('.plan-progress [role="progressbar"]')!;
  assert.match(bar.getAttribute('aria-valuetext')!, /, 1 partly built$/);
  const done = Number(text($('[data-plan-progress]')).split(' ')[0]);
  assert.equal(Number(bar.getAttribute('aria-valuenow')), done + 0.4);
});

test('the recalculation toast says what a counted line has and needs now', () => {
  assert.equal(
    recalculatedText(0, 'Kept', 0, 0, [{ name: 'Rubber', built: 41, needed: 58 }]),
    'Recalculated in place. Rubber keeps its count: 41 built, 58 needed. The previous version is kept as “Kept” under Profiles.',
  );
});

test("the step's full count sends focus to the next step's checkbox, not its folded counter", async () => {
  await show({ version: 19, builtMachines: { [KEY]: 4 } }, 'plan');
  const task = () => $(`.task [data-check="${KEY}"]`)?.closest<HTMLElement>('.task');
  const input = task()!.querySelector<HTMLInputElement>('[data-built-input]')!;
  input.focus();
  stubFetch({ '/api/update': applyUpdate });
  task()!.querySelector<HTMLButtonElement>('[data-built-step="1"]')!.click();
  await settle();
  assert.equal(state.checks[KEY], true);
  const now = document.activeElement as HTMLElement;
  assert.notEqual(now, document.body);
  assert.ok(now.matches('input[data-check]'), 'a step checkbox has focus');
  assert.notEqual(now.dataset.check, KEY);
  const folded = now.closest('details');
  assert.ok(!folded || now.closest('summary'), 'the target is in a summary, not a closed details');
});

test('Escape in the typed number puts the shown count back and saves nothing', async () => {
  await show({ version: 19, builtMachines: { [KEY]: 2 } });
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const input = counterIn(card()).querySelector<HTMLInputElement>('[data-built-input]')!;
  input.focus();
  input.value = '4';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(input.value, '2');
  input.blur();
  await settle();
  assert.equal(input.value, '2');
  assert.deepEqual(sent(calls), []);
});

// #1306: the name's hit area covers the card, so a click on the counter must not reach it. A hit
// test is not possible in happy-dom (the stylesheet test in tests/factory-card-hit-area.test.ts
// holds the CSS that lifts the counter, and browser-check.ts clicks it with a real mouse); this
// checks that counting from the card never opens the line's dialog.
test('counting from the card changes the count and opens no dialog (#1306)', async () => {
  await show({});
  const dialog = $<HTMLDialogElement>('#detail')!;
  assert.equal(dialog.open, false);
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="1"]')!.click();
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 1 });
  const input = counterIn(card()).querySelector<HTMLInputElement>('[data-built-input]')!;
  input.click();
  input.focus();
  input.value = '3';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 3 });
  counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="-1"]')!.click();
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 2 });
  assert.equal(dialog.open, false, 'no dialog opened');
  // The name still opens it.
  card().querySelector<HTMLButtonElement>('.name')!.click();
  assert.equal(dialog.open, true);
});

// A line with machines to spare (#1305): 7 standing for the 5 the plan needs reads "7 / 5", not
// "5 / 5", and − goes to 6 and keeps the spare advice, instead of storing 4 and dropping it.
test('a spare line counts all the machines that stand: 7 / 5, − steps to 6', async () => {
  await show({ version: 19, builtMachines: { [KEY]: 7 } });
  const counter = () => counterIn(card());
  const input = () => counter().querySelector<HTMLInputElement>('[data-built-input]')!;
  const step = (delta: number) =>
    counter().querySelector<HTMLButtonElement>(`[data-built-step="${delta}"]`)!;
  assert.equal(input().value, '7');
  assert.equal(input().max, '7');
  assert.equal(text($('#' + input().getAttribute('aria-describedby'))), '/ of 5');
  assert.equal(text(card().querySelector('[data-grown]')), '7 machines built, 5 needed: 2 spare');
  // Nothing above what stands.
  assert.equal(step(1).getAttribute('aria-disabled'), 'true');
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  step(-1).click();
  await settle();
  assert.deepEqual(sent(calls), [{ type: 'builtCount', key: KEY, value: 6 }]);
  assert.deepEqual(state.builtMachines, { [KEY]: 6 });
  assert.equal(input().value, '6');
  assert.equal(text(card().querySelector('[data-grown]')), '6 machines built, 5 needed: 1 spare');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.match(text($('#announce')), /^6 Refineries built, 5 needed: 1 spare\.$/);
  // A typed number above what stands is kept to it.
  input().value = '99';
  input().dispatchEvent(new Event('input'));
  input().dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(state.builtMachines, { [KEY]: 7 }, 'no more than stood (#1310)');
  step(-1).click();
  await settle();
  // Down to the plan's machines: the line is all built and the spare advice goes.
  step(-1).click();
  await settle();
  assert.equal(input().value, '5');
  assert.equal(
    card().querySelector('[data-grown]')?.textContent?.includes('spare') ?? false,
    false,
  );
});

test('a ticked spare line shows its spare machines too, and counting it down below the plan unticks it', async () => {
  await show({ version: 19, checks: { [KEY]: true }, builtMachines: { [KEY]: 6 } });
  const input = () => counterIn(card()).querySelector<HTMLInputElement>('[data-built-input]')!;
  assert.equal(input().value, '6');
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const minus = () => counterIn(card()).querySelector<HTMLButtonElement>('[data-built-step="-1"]')!;
  minus().click();
  await settle();
  assert.deepEqual(sent(calls), [{ type: 'builtCount', key: KEY, value: 5 }]);
  assert.equal(state.checks[KEY], true, 'still ticked at the plan’s machines');
  minus().click();
  await settle();
  assert.deepEqual(sent(calls).at(-1), { type: 'builtCount', key: KEY, value: 4, running: false });
  assert.equal(state.checks[KEY], false);
});

// #1310: - from a spare count stores the lower count, so + goes back up to the count that stood
// (60 standing for 58 planned: - to 59, + to 60), never above it.
test('a spare line can be counted back up after the minus: plus restores what stood', async () => {
  await show({ version: 19, builtMachines: { [KEY]: 7 } });
  const counter = () => counterIn(card());
  const input = () => counter().querySelector<HTMLInputElement>('[data-built-input]')!;
  const step = (delta: number) =>
    counter().querySelector<HTMLButtonElement>(`[data-built-step="${delta}"]`)!;
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  step(-1).click();
  await settle();
  assert.equal(input().value, '6');
  assert.equal(step(1).getAttribute('aria-disabled'), null, '+ has something to do');
  assert.equal(input().max, '7');
  step(1).click();
  await settle();
  assert.deepEqual(sent(calls), [
    { type: 'builtCount', key: KEY, value: 6 },
    { type: 'builtCount', key: KEY, value: 7 },
  ]);
  assert.deepEqual(state.builtMachines, { [KEY]: 7 });
  assert.equal(step(1).getAttribute('aria-disabled'), 'true', 'not above what stood');
  // Down below the plan, then back up through the spare to 7 and no further.
  for (let i = 0; i < 4; i++) {
    step(-1).click();
    await settle();
  }
  assert.equal(input().value, '3');
  for (let i = 0; i < 6; i++) {
    step(1).click();
    await settle();
  }
  assert.equal(input().value, '7');
  assert.equal(step(1).getAttribute('aria-disabled'), 'true');
});
