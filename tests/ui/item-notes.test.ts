// BAK-3 (#1355): notes live on the build plan too. The plan shows the phase on screen's note (the
// same `phase-<phase>` record the Notes page has), a step has a note of its own (`step-<step id>`)
// and a factory has one on its build order page (`group-<factory id>`). They are ordinary notes
// records, so no state version changed: each is saved with the same `note` update, the Notes page
// lists the ones that exist, and one whose step or factory is gone stays listed.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { flowRoute, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { validateState } from '../../public/state.ts';
import { $, $$, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const plan = generated();
const groups = defaultFactoryGroups(plan);

let sent: UpdateOp[] = [];
async function show(view: string, notes: Record<string, string> = {}) {
  open({ calculated: structuredClone(plan), phase: '3', notes, state: { factoryGroups: groups } });
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  go(view as never);
  render();
  await settle();
}
const type = (box: HTMLTextAreaElement, value: string) => {
  box.value = value;
  box.dispatchEvent(new Event('input'));
};
const open1 = async (fold: Element) => {
  fold.querySelector<HTMLButtonElement>('[data-item-note-toggle]')!.click();
  await settle();
};

beforeEach(() => {
  page();
  setQuery('');
});

test('BAK-3: the build plan shows the phase note, empty until opened, open when it has text', async () => {
  await show('plan');
  const fold = $('#main [data-note-for="phase-3"]')!;
  assert.match(
    fold.querySelector('[data-item-note-toggle]')!.textContent!,
    /Add a note for Phase 3/,
  );
  assert.equal($('[data-save-note="phase-3"]'), null, 'no box is made until the fold is opened');
  await open1(fold);
  const box = $<HTMLTextAreaElement>('[data-save-note="phase-3"]')!;
  assert.equal(box.getAttribute('aria-label'), 'Phase 3 notes');
  type(box, 'Train to the coal field');
  box.dispatchEvent(new Event('blur'));
  await settle();
  assert.deepEqual(
    sent.map(({ type, ...rest }) => ({ type, ...rest })),
    [{ type: 'note', key: 'phase-3', value: 'Train to the coal field', base: '' }],
  );
  // The Notes page shows the same text for the phase.
  await show('notes', { 'phase-3': 'Train to the coal field' });
  assert.equal(
    $<HTMLTextAreaElement>('[data-save-note="phase-3"]')!.value,
    'Train to the coal field',
  );
  // With a note the plan opens the fold and shows it.
  await show('plan', { 'phase-3': 'Train to the coal field' });
  const filled = $<HTMLElement>('#main [data-note-for="phase-3"]')!;
  assert.equal(
    filled.querySelector('[data-item-note-toggle]')!.getAttribute('aria-expanded'),
    'true',
    'a note shows open',
  );
  assert.match(filled.querySelector('[data-item-note-toggle]')!.textContent!, /^\s*Phase 3 note/);
  assert.equal(
    $<HTMLTextAreaElement>('[data-save-note="phase-3"]')!.value,
    'Train to the coal field',
  );
  assert.equal($('[data-phase-notes-link]')!.getAttribute('href'), '#notes', 'the link stays');
});

test('BAK-3: a step has a note of its own, saved under step-<id>, shown with its first line', async () => {
  await show('plan');
  const step = $<HTMLElement>('#main [data-task]')!;
  const id = step.dataset.task!;
  // The step's own summary is still the only one in it (the page's tests and styles address it).
  assert.equal(step.querySelectorAll('summary').length, 1);
  const toggle = step.querySelector<HTMLButtonElement>('[data-item-note-toggle]')!;
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'item-note-step-' + id);
  const fold = step.querySelector<HTMLDetailsElement>('[data-item-note]')!;
  assert.equal(fold.dataset.noteFor, 'step-' + id);
  assert.match(fold.querySelector('[data-item-note-toggle]')!.textContent!, /Add a note/);
  await open1(fold);
  const box = step.querySelector<HTMLTextAreaElement>('[data-save-note]')!;
  assert.equal(box.dataset.saveNote, 'step-' + id);
  assert.match(box.getAttribute('aria-label')!, /^Note: /);
  type(box, 'Use the west belt\nsecond line');
  box.dispatchEvent(new Event('blur'));
  await settle();
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { key: string }).key, 'step-' + id);
  assert.equal((sent[0] as { value: string }).value, 'Use the west belt\nsecond line');
  // With a saved note the fold says "Note" and, while shut, the first line.
  await show('plan', { ['step-' + id]: 'Use the west belt\nsecond line' });
  const saved = $<HTMLElement>(`#main [data-task="${id}"] [data-item-note]`)!;
  assert.match(saved.querySelector('[data-item-note-toggle]')!.textContent!, /^\s*Note/);
  assert.equal(
    (saved.querySelector('[data-save-note]') as HTMLTextAreaElement).value,
    'Use the west belt\nsecond line',
  );
  // Every other step still has none: a note belongs to its step.
  assert.equal($$('#main [data-item-note]').filter(el => el.querySelector('textarea')).length, 1);
});

test('BAK-3: a factory has a note on its build order page, under group-<id>', async () => {
  const id = groups.groups[0]!.id;
  location.hash = '#' + flowRoute(id);
  await show(viewOf(location.hash.slice(1)));
  const fold = $<HTMLElement>('#main [data-note-for="group-' + id + '"]')!;
  assert.match(
    fold.querySelector('[data-item-note-toggle]')!.textContent!,
    /Add a note for this factory/,
  );
  await open1(fold);
  const box = $<HTMLTextAreaElement>(`[data-save-note="group-${id}"]`)!;
  type(box, 'Rebuild after the update');
  box.dispatchEvent(new Event('blur'));
  await settle();
  assert.equal((sent[0] as { key: string }).key, 'group-' + id);
  assert.equal((sent[0] as { value: string }).value, 'Rebuild after the update');
  await show(viewOf(location.hash.slice(1)), { ['group-' + id]: 'Rebuild after the update' });
  assert.match($('#main [data-note-for]')!.textContent!, /Factory note/);
});

test('BAK-3: the Notes page lists step and factory notes, one whose target is gone included', async () => {
  const group = groups.groups[0]!;
  await show('plan');
  const id = $<HTMLElement>('#main [data-task]')!.dataset.task!;
  await show('notes', {
    ['step-' + id]: 'A step note',
    ['group-' + group.id]: 'A factory note',
    'step-gone-for-good': 'Left behind',
    'group-fg-removed': 'Of a removed factory',
  });
  const listed = $$('[data-item-notes] details').map(el => el.dataset.itemNoteFor);
  assert.deepEqual(
    listed.sort(),
    ['group-fg-removed', 'group-' + group.id, 'step-' + id, 'step-gone-for-good'].sort(),
  );
  const text = (key: string) => $(`[data-item-notes] [data-item-note-for="${key}"]`)!.textContent!;
  assert.match(text('group-' + group.id), new RegExp(group.name));
  assert.match(text('step-gone-for-good'), /A step no longer in this plan/);
  assert.match(text('group-fg-removed'), /A factory no longer in this profile/);
  assert.equal(
    $<HTMLTextAreaElement>('[data-item-notes] [data-save-note="step-gone-for-good"]')!.value,
    'Left behind',
    'its text can still be read and cleared',
  );
  // Without any, the section is not there.
  await show('plan');
  await show('notes', { global: 'x', 'phase-3': 'y' });
  assert.equal($('[data-item-notes]'), null);
});

test('BAK-3: these notes need no state version: the validator keeps them as any other note', () => {
  const notes = { 'step-calc-3-abc': 'one', 'group-fg-iron01': 'two', 'phase-3': 'three' };
  // The state's version follows its content (validate.ts): notes are in version 1, so a record
  // with these keys is still one that every earlier release reads.
  const base = {
    version: 1,
    settings: { phase: '3' },
    checks: {},
    deliveries: {},
    customTasks: [],
  };
  const kept = validateState({ ...base, notes } as never);
  assert.deepEqual(kept.notes, notes);
  assert.equal(kept.version, 1, 'the version is not raised');
  // They are held to the notes' own limit.
  assert.throws(() => validateState({ ...base, notes: { 'step-x': 'y'.repeat(6001) } } as never));
});
