// The Notes page (public/app/ui/pages/NotesPage.vue, #243): the save-wide note and one box per
// phase, mounted through render() the way the app mounts them, in happy-dom. The notes keys are
// saved progress and must stay `global` and `phase-<phase>`.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { acceptRoute } from '../../public/app/api.ts';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { invalidate } from '../../public/app/ui/bridge.ts';
import { answerConfirms, $, $$, evil, go, open, openMigrated, page, stubFetch } from './setup.ts';

const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// The phase panels in page order: [phase, open].
const panels = () =>
  $$<HTMLDetailsElement>('#main [data-phase-notes]').map(d => [d.dataset.phaseNotes, d.open]);

beforeEach(() => {
  page();
  open();
  answerConfirms(true);
  go('notes');
});

for (const calculated of [undefined, true] as const)
  test(`the notes page shows every note under its own key (${calculated ? 'calculated' : 'migrated'})`, () => {
    const notes = {
      global: evil + '\n  second line',
      'phase-3': 'Iron at the lake',
      'phase-5': evil,
    };
    open({ calculated, notes });
    render();
    noMarkup();
    assert.equal($('#main h1')!.textContent, 'Notes');
    assert.equal($$('#main h1').length, 1);
    // The save-wide note comes first, exactly as saved.
    const boxes = $$<HTMLTextAreaElement>('#main textarea');
    assert.equal(boxes[0]!.id, 'global-note');
    assert.equal(boxes[0]!.dataset.saveNote, 'global', 'the notes key is on the box');
    assert.equal(boxes[0]!.value, notes.global, 'the note keeps its line break and indent');
    assert.equal($('#global-note-status')!.getAttribute('aria-live'), 'polite');
    // Then the working phase, open, and the profile's other phases, folded: a calculated
    // profile's milestone-only phases before its start phase too (#759).
    assert.deepEqual(panels(), [
      ['3', true],
      ...((calculated
        ? [
            ['1', false],
            ['2', false],
          ]
        : []) as [string, boolean][]),
      ['4', false],
      ['5', false],
      ['post', false],
    ]);
    for (const [phase] of panels()) {
      const box = $<HTMLTextAreaElement>(`#phase-note-${phase}`)!;
      assert.equal(box.dataset.saveNote, 'phase-' + phase);
      assert.equal(box.getAttribute('aria-describedby'), `phase-note-${phase}-status`);
      assert.equal(box.value, notes[('phase-' + phase) as keyof typeof notes] ?? '');
    }
    assert.match($('[data-phase-notes="3"] summary')!.textContent, /Phase 3\s+· Working on/);
    assert.match($('[data-phase-notes="5"] summary')!.textContent, /Phase 5\s+· Has notes/);
    assert.match($('[data-phase-notes="4"] summary')!.textContent, /Phase 4\s+· Empty/);
    assert.equal($$('#main .note-save button').length, 0, 'no "Save notes" button');
    // Showing the notes changes nothing that is saved.
    assert.deepEqual({ ...state.notes }, notes);
  });

test('the working phase comes first, and a phase before the start shows only with a note', () => {
  open({ phase: '5', notes: { 'phase-1': 'Carried over from Phase 1' } });
  render();
  assert.deepEqual(panels(), [
    ['5', true],
    ['1', false],
    ['3', false],
    ['4', false],
    ['post', false],
  ]);
  assert.match($('[data-phase-notes="1"] summary')!.textContent, /Before this profile/);
  assert.equal($<HTMLTextAreaElement>('#phase-note-1')!.value, 'Carried over from Phase 1');
  assert.equal($('[data-phase-notes="2"]'), null, 'an earlier phase without a note is left out');
});

test('each phase box saves under its own key', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  render();
  for (const [selector, value] of [
    ['#global-note', 'Seed 4242'],
    ['#phase-note-3', 'Coal first'],
    ['#phase-note-post', 'Sink the rest'],
  ] as const) {
    const box = $<HTMLTextAreaElement>(selector)!;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new Event('blur'));
    await settle();
  }
  assert.deepEqual(
    calls.map(([, body]) => body),
    [
      { type: 'note', key: 'global', value: 'Seed 4242' },
      { type: 'note', key: 'phase-3', value: 'Coal first' },
      { type: 'note', key: 'phase-post', value: 'Sink the rest' },
    ],
  );
});

test('a redraw keeps unsaved notes, and another working phase opens its own box first', async () => {
  stubFetch({ '/api/update': () => state });
  open({ notes: { 'phase-4': 'Phase 4 plans' } });
  render();
  const note = $<HTMLTextAreaElement>('#phase-note-3')!;
  note.value = 'Unsaved thought';
  note.dispatchEvent(new Event('input'));
  // What the save indicator does while another write is in flight.
  invalidate();
  await nextTick();
  assert.equal($<HTMLTextAreaElement>('#phase-note-3')!.value, 'Unsaved thought');
  // Another working phase: its box moves to the top and opens; the others keep their text.
  state.settings.phase = '4';
  render();
  await nextTick();
  assert.deepEqual(panels().slice(0, 2), [
    ['4', true],
    ['3', false],
  ]);
  assert.equal($<HTMLTextAreaElement>('#phase-note-4')!.value, 'Phase 4 plans');
  assert.equal($<HTMLTextAreaElement>('#phase-note-3')!.value, 'Unsaved thought');
});

test('leaving the page or changing phase asks before dropping an unsaved note', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  render();
  // The page on screen is #notes (the hashchange listener in listeners.ts calls acceptRoute).
  history.replaceState(null, '', '#notes');
  assert.equal(acceptRoute(), true, 'nothing to ask without an edit');
  const asked = answerConfirms(false);
  // A folded phase's box counts too: every box stays mounted.
  const note = $<HTMLTextAreaElement>('#phase-note-5')!;
  note.value = 'Unsaved thought';
  // A sidebar link, a typed address or Back: the address goes back while it asks, and stays
  // back when the notes are kept.
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), false);
  assert.equal(location.hash, '#notes');
  await settle();
  assert.equal(location.hash, '#notes');
  assert.equal(asked.length, 1);
  // The working-phase select: kept notes leave the phase as it was, unsaved.
  const picker = $<HTMLSelectElement>('#phase-picker')!;
  picker.value = '4';
  picker.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(picker.value, '3');
  assert.equal(note.value, 'Unsaved thought');
  assert.equal(asked.length, 2);
  // Agreeing to drop them goes to the address asked for, without asking again when its
  // hashchange arrives (acceptRoute, as the listener calls it).
  const agreed = answerConfirms(true);
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), false);
  await settle();
  assert.equal(location.hash, '#storage');
  assert.equal(acceptRoute(), true);
  assert.equal(agreed.length, 1);
  note.value = '';
  history.replaceState(null, '', '#notes');
  acceptRoute();
});

test('another tab’s saved note never replaces an unsaved draft, but fills an untouched box', async () => {
  // Every save reply carries a phase note another tab saved meanwhile.
  const reply = () => ({ ...state, notes: { ...state.notes, 'phase-3': 'From the other tab' } });
  stubFetch({ '/api/update': reply });
  // Some other write, whose reply brings the other tab's note.
  const otherWrite = async (text: string) => {
    const box = $<HTMLTextAreaElement>('#global-note')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new Event('blur'));
    await settle();
  };
  const note = () => $<HTMLTextAreaElement>('#phase-note-3')!;
  render();
  await nextTick();
  note().value = 'My draft';
  note().dispatchEvent(new Event('input'));
  await otherWrite('Seed');
  assert.equal(note().value, 'My draft', 'the draft is kept');
  assert.match($('#toast')!.textContent!, /saved note changed while you were editing/);
  // An untouched box simply shows the newer saved note.
  page();
  open();
  stubFetch({ '/api/update': reply });
  render();
  await nextTick();
  await otherWrite('Seed');
  assert.equal(note().value, 'From the other tab');
});

test('the phase panels open and fold from the keyboard, by their summary', () => {
  render();
  const summaries = $$('#main [data-phase-notes] summary');
  assert.equal(summaries.length, 4);
  // A native summary: in the tab order and toggled by Enter or Space in a browser, with no
  // tabindex or role of its own (browser-check.ts presses it for real).
  for (const summary of summaries) {
    assert.equal(summary.parentElement!.firstElementChild, summary, 'the summary leads its panel');
    assert.equal(summary.getAttribute('tabindex'), null);
    assert.equal(summary.getAttribute('role'), null);
  }
});

// ADA's remark about a phase without notes (rule `notes` in public/ada.ts) still comes up now
// that the phase notes live on their own page, on the plan and on the Notes page. On a profile
// migrated from the handbook (#387), whose guide keeps the handbook's step ids.
for (const view of ['plan', 'notes'] as const)
  test(`ADA still remarks on a phase without notes on the ${view} page`, () => {
    setAdaIndex(0);
    adaClearFault();
    const remarks = (notes: Record<string, string>) => {
      openMigrated({ notes, state: { checks: { 'phase-3-iron': true } } });
      go(view);
      render();
      const seen: string[] = [];
      for (let i = 0; i < 60; i++) {
        setAdaIndex(i);
        const line = adaCurrent();
        if (line) seen.push(line.id);
      }
      return seen;
    };
    assert.ok(remarks({}).includes('notes'), 'no Phase 3 note: ADA says so');
    assert.ok(!remarks({ 'phase-3': 'Written' }).includes('notes'), 'a saved note quiets her');
    assert.ok(
      remarks({ 'phase-4': 'Another phase' }).includes('notes'),
      'only the working phase counts',
    );
  });
