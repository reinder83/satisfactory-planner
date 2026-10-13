// Glossary terms on the pages (#1076, ui/Term.vue and ui/TermText.vue): a term opens its
// definition and where to get it on hover, keyboard focus and a tap, Escape closes it without
// moving focus, the tooltip is in the page only while open (so the text reads, searches and
// copies as before), and the build plan, the guided start and the Resources page mark each term
// once, where it first appears.
import assert from 'node:assert/strict';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import Term from '../../public/app/ui/Term.vue';
import TermText from '../../public/app/ui/TermText.vue';
import { glossary } from '../../public/preferences.ts';
import { $, $$, generated, generatedWith, go, open, page } from './setup.ts';

beforeEach(() => page());

const pointer = (type: string, pointerType = 'mouse') =>
  new PointerEvent(type, { bubbles: type === 'pointerdown', pointerType });

function term(key = 'mam', text = 'MAM') {
  const host = document.createElement('p');
  document.body.append(host);
  const wrapper = mount(Term, { props: { term: key, text }, attachTo: host });
  const button = wrapper.find('button').element as HTMLButtonElement;
  const tip = () => wrapper.element.querySelector?.('[role="tooltip"]') as HTMLElement | null;
  return { wrapper, button, tip, root: wrapper.element as HTMLElement };
}

test('hover opens the definition with where to get it, and leaving closes it', async () => {
  const { button, tip, root } = term();
  assert.equal(tip(), null, 'closed, and not in the page');
  assert.equal(button.textContent, 'MAM', 'the word as written');
  root.dispatchEvent(pointer('pointerenter'));
  await nextTick();
  assert.ok(tip());
  assert.match(tip()!.textContent!, /Molecular Analysis Machine/);
  assert.match(tip()!.textContent!, /Where to get it: Build it after the Tier 1 milestone/);
  assert.equal(button.getAttribute('aria-describedby'), tip()!.id, 'the button is described by it');
  root.dispatchEvent(pointer('pointerleave'));
  await nextTick();
  assert.equal(tip(), null);
  // A touch's pointerenter does not open it: the tap's click does.
  root.dispatchEvent(pointer('pointerenter', 'touch'));
  await nextTick();
  assert.equal(tip(), null);
});

test('keyboard focus opens it, Escape closes it and keeps focus, Enter (a click) toggles it', async () => {
  const { button, tip } = term('sink', 'AWESOME Sink');
  assert.equal(button.type, 'button', 'a real button, so Tab and Enter reach it');
  button.focus();
  await nextTick();
  assert.match(tip()!.textContent!, /Resource Sink Bonus Program/);
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  assert.equal(tip(), null);
  assert.equal(document.activeElement, button, 'focus stays on the term');
  button.click();
  await nextTick();
  assert.ok(tip(), 'Enter or Space clicks the button and opens it');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click();
  await nextTick();
  assert.equal(tip(), null, 'and again closes it');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.focus();
  await nextTick();
  button.blur();
  await nextTick();
  assert.equal(tip(), null, 'leaving it closes it');
});

test('a tap opens it, the next tap closes it, and a tap elsewhere closes it', async () => {
  const { button, tip } = term('underclock', 'underclocked');
  // A tap: pointerdown, the focus that comes with it, then the click.
  button.dispatchEvent(pointer('pointerdown', 'touch'));
  button.focus();
  button.click();
  await nextTick();
  assert.match(tip()!.textContent!, /lowering its clock speed/);
  button.dispatchEvent(pointer('pointerdown', 'touch'));
  button.click();
  await nextTick();
  assert.equal(tip(), null);
  button.dispatchEvent(pointer('pointerdown', 'touch'));
  button.click();
  await nextTick();
  assert.ok(tip());
  document.body.dispatchEvent(pointer('pointerdown', 'touch'));
  await nextTick();
  button.blur();
  await nextTick();
  assert.equal(tip(), null);
});

test('a marked text reads exactly as the plain text', () => {
  const text = 'Research Power Shards in the MAM, then the MAM again and overclock.';
  const host = document.createElement('p');
  document.body.append(host);
  mount(TermText, { props: { text }, attachTo: host });
  assert.equal(host.textContent, text);
  assert.deepEqual(
    [...host.querySelectorAll('[data-term]')].map(b => b.getAttribute('data-term')),
    ['shards', 'mam', 'overclock'],
    'the first occurrence of each term',
  );
});

test('the build plan marks each term once, in the steps on screen, and keeps the step text', () => {
  open({ calculated: generated(), phase: '1' });
  go('plan');
  render();
  const terms = $$('#main .checklist [data-term]').map(b => b.getAttribute('data-term'));
  assert.ok(terms.length, 'some step text has a glossary term');
  assert.equal(new Set(terms).size, terms.length, 'each term once');
  for (const key of terms) assert.ok(glossary[key!], key!);
  // The marked text is the step's own, character for character: its saved body, or the lines
  // around its table.
  for (const button of $$('#main .checklist [data-term]')) {
    const step = planTasks().find(
      task => task.id === button.closest('details')!.getAttribute('data-task'),
    )!;
    const shown = button.closest('p')!.textContent!.trim();
    assert.ok(
      [step.body, step.table?.intro, step.table?.after].includes(shown),
      `${step.id}: ${shown}`,
    );
  }
});

test('the Resources page explains the AWESOME Sink under storage', () => {
  open({
    calculated: generatedWith({
      storageFromSurplus: true,
      storage: 'construction',
      wholeMachines: true,
    }),
    phase: '3',
  });
  go('resources');
  render();
  const sink = $('#main [data-rate-list="storage"] [data-term="sink"]');
  assert.ok(sink, 'the storage note marks the AWESOME Sink');
  assert.match(
    sink!.closest('p')!.textContent!.replace(/\s+/g, ' '),
    /overflows to the AWESOME Sink\./,
  );
});
