// The build plan's step cards (#1339): the next open step is the primary card, with Mark done and
// a "Then: <next step>" preview (BP-6); Today's session is a button beside Edit steps, and Copy note
// says "Copied" for about 2 seconds (BP-11); a production line's step text has the production-line
// dialog's structure, with every fact the prose had, and "Tap the resource nodes" folds its long
// table behind "Show all N resources" (BP-5).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { HOLD_MS, LEAVE_MS, setHoldDelay } from '../../public/app/ui/plan/tick-hold.ts';
import {
  $,
  $$,
  applyUpdate,
  generated,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';

const within = (selector: string, root: Element) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];
const plain = (words: string) => words.replace(/\s+/g, ' ').trim();
const text = (element: Element | null | undefined) => plain(element?.textContent ?? '');

async function flush() {
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();
  }
}

let made: ReturnType<typeof generated> | undefined;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  setHoldDelay(HOLD_MS, LEAVE_MS);
  page();
  open({ calculated: structuredClone((made ??= generated())), phase: '3' });
  go('plan');
  render();
  await nextTick();
});
afterEach(() => vi.useRealTimers());

const openIds = () => $$('#main [data-open-steps] > .task [data-check]').map(e => e.dataset.check!);
const titleOf = (id: string) => planTasks().find(step => step.id === id)!.title;

test('the next step is the primary card, with a Then preview of the step after it', () => {
  const [first, second] = openIds();
  const cards = $$('#main [data-open-steps] > .task');
  assert.ok(cards[0]!.classList.contains('lead'), 'the first open step leads');
  assert.equal(text(cards[0]!.querySelector('.step-no')), 'Next step');
  assert.equal(text(cards[0]!.querySelector('[data-step-then]')), 'Then: ' + titleOf(second!));
  assert.equal(cards[0]!.querySelector<HTMLElement>('[data-check]')!.dataset.check, first);
  // The other steps are compact rows: folded, with no Mark done and no preview.
  for (const card of cards.slice(1)) {
    assert.equal(card.classList.contains('lead'), false);
    assert.equal(card.querySelector('[data-step-then]'), null);
    assert.equal(card.querySelector('[data-mark-done]'), null);
    assert.equal(card.querySelector('details')!.open, false);
  }
});

test('Mark done on the next step ticks it like its checkbox does, with Undo', async () => {
  const [first, second, third] = openIds();
  stubFetch({ '/api/update': applyUpdate });
  $<HTMLButtonElement>('#main [data-open-steps] [data-mark-done]')!.click();
  await flush();
  assert.equal(state.checks[first!], true);
  assert.match($('#toast')!.textContent!, new RegExp(`^${titleOf(first!)} done, `));
  const undo = $<HTMLButtonElement>('#toast [data-toast-action]')!;
  assert.equal(undo.textContent, 'Undo last tick');
  // The step leaves, the next one leads and previews the one after it.
  await vi.advanceTimersByTimeAsync(HOLD_MS + LEAVE_MS);
  await flush();
  assert.equal(openIds()[0], second);
  assert.equal(
    text($('#main [data-open-steps] .lead [data-step-then]')),
    'Then: ' + titleOf(third!),
  );
  undo.click();
  await flush();
  assert.equal(state.checks[first!], false, 'Undo unticks it');
  assert.equal(openIds()[0], first);
});

test("Today's session is a button beside Edit steps, and Copy note says Copied for about 2 seconds", async () => {
  const link = $<HTMLAnchorElement>('[data-session-link]')!;
  assert.equal(link.getAttribute('href'), '#session');
  assert.ok(link.classList.contains('btn'), 'a button, not a small link');
  assert.equal(text(link), "Today's session");
  assert.equal(
    link.parentElement,
    $('[data-toggle-plan-edit]')!.parentElement,
    'beside Edit steps',
  );
  assert.equal($('[data-session-link-row]'), null, 'no link row of its own');

  go('session');
  render();
  await nextTick();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => undefined },
  });
  const copied = $('[data-session-copied]')!;
  assert.equal(copied.getAttribute('aria-live'), 'polite');
  assert.equal(text(copied), '');
  $('[data-session-copy]')!.click();
  await flush();
  assert.equal(text(copied), 'Copied');
  await vi.advanceTimersByTimeAsync(1900);
  assert.equal(text(copied), 'Copied', 'still shown at 1.9 s');
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(text(copied), '');
});

test("a production line's step has the dialog's structure and keeps every fact of its text", () => {
  const lines = planTasks().filter(step => step.facts);
  assert.ok(lines.length >= 5, 'the phase has production lines');
  for (const step of lines) {
    const facts = step.facts!;
    const body = step.body!;
    const card = $(`[data-task="${step.id}"]`)!;
    const drawn = text(card);
    const pieces = [
      ...facts.notes,
      facts.machines,
      facts.perMachine.text,
      ...(facts.perMachine.hint ? [facts.perMachine.hint] : []),
      ...facts.extras,
    ];
    for (const piece of pieces) {
      assert.ok(body.includes(piece), `${step.id}: the body says "${piece}"`);
      assert.ok(drawn.includes(plain(piece)), `${step.id}: it draws "${piece}"`);
    }
    assert.ok(body.includes(facts.perMachine.label + ': '), step.id);
    // Every input and output, with its rate, is in the body's lists and in its own row.
    assert.deepEqual(
      within('[data-step-inputs] li', card).map(text),
      facts.inputs.map(rate => plain(rate.name + ' ' + rate.rate)),
    );
    assert.deepEqual(
      within('[data-step-outputs] li', card).map(text),
      facts.outputs.map(rate => plain(rate.name + ' ' + rate.rate)),
    );
    // A generator's power has no item name in the body's list: "Outputs: 150 MW".
    for (const rate of [...facts.inputs, ...facts.outputs])
      assert.ok(
        body.includes(rate.name === 'Power' ? rate.rate : rate.name + ' ' + rate.rate),
        `${step.id}: ${rate.name}`,
      );
  }
});

test("a line's machine count reads as a labelled row", () => {
  const step = planTasks().find(s => s.facts)!;
  const card = $(`[data-task="${step.id}"]`)!;
  assert.equal(text(card.querySelector('[data-step-machines]')), step.facts!.machines);
  assert.match(text(card.querySelector('[data-step-machines]')), /^\d+ .+ total: /);
  assert.deepEqual(within('.step-facts-grid dt', card).map(text), [
    'Machines',
    step.facts!.perMachine.label,
    'Inputs',
    'Outputs',
  ]);
});

test('an edited line step shows the edited words, not the structure', () => {
  const step = planTasks().find(s => s.facts)!;
  page();
  open({
    calculated: structuredClone(made!),
    phase: '3',
    state: {
      taskEdits: {
        order: {},
        removed: [],
        titles: {},
        bodies: { [step.id]: 'My own words.' },
        links: {},
      },
    },
  });
  go('plan');
  render();
  const card = $(`[data-task="${step.id}"]`)!;
  assert.equal(card.querySelector('[data-step-facts]'), null);
  assert.match(text(card), /My own words\./);
});

test('"Tap the resource nodes" folds its long table behind "Show all N resources"', async () => {
  open({
    calculated: structuredClone(
      generatedWith({ phase: '3', wholeMachines: true, phaseMining: true }),
    ),
    phase: '3',
  });
  go('plan');
  render();
  await nextTick();
  const table = $('[data-task="mining-3"] [data-step-table]')!;
  const rows = within('[data-step-table-row]', table);
  assert.ok(rows.length > 4, 'the phase has more resources than the fold');
  assert.equal(rows.filter(row => !row.hidden).length, 4, 'the first four show');
  assert.ok(table.querySelector('[data-step-table-total]'), 'the total row always shows');
  const more = table.querySelector<HTMLButtonElement>('[data-step-table-more]')!;
  assert.equal(text(more), `Show all ${rows.length} resources`);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  more.click();
  await nextTick();
  assert.equal(rows.filter(row => row.hidden).length, 0);
  assert.equal(text(more), 'Show fewer');
  assert.equal(more.getAttribute('aria-expanded'), 'true');
});
