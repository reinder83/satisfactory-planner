// The records the move from the original plan could not place (#499, part 4e of #395): on a
// profile carrying handbookOrigin.unmapped, the Notes page lists each tick, note and group
// assignment as text (ui/notes/UnplacedRecords.vue), escaped, and changes nothing that is saved.
// Without such records there is no panel.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, evil, go, open, page } from './setup.ts';
import type { HandbookOrigin } from '../../public/types/index.ts';

const script = '<script>alert("tick")</script>';
const origin = (): HandbookOrigin => ({
  version: '2026-09-13',
  unmapped: {
    checks: { 'factory-4-plastic': true, 'factory-4-rubber': false, [script]: true },
    notes: { 'factory-plastic': evil + '\nsecond line', 'factory-gone': script },
    assignments: {
      rubber: [
        { group: 'fg-oilcampus', rate: 30 },
        { group: 'fg-removed', rate: null },
      ],
    },
  },
});
const openMigrated = (handbookOrigin?: HandbookOrigin) => {
  open({
    calculated: true,
    state: {
      version: 12,
      factoryGroups: { groups: [{ id: 'fg-oilcampus', name: evil }], assignments: {} },
      ...(handbookOrigin && { handbookOrigin }),
    },
  });
  go('notes');
  render();
};
const texts = (selector: string) => $$(selector).map(el => el.textContent!.replace(/\s+/g, ' '));

beforeEach(() => {
  page();
});

test('the Notes page lists every record the migration could not place, as text', () => {
  const saved = origin();
  openMigrated(structuredClone(saved));
  const panel = $('#main [data-unplaced]')!;
  assert.ok(panel, 'the panel is drawn');
  assert.equal(document.querySelector('x-evil'), null, 'no saved text becomes markup');
  assert.equal(panel.querySelector('script'), null, 'no script element either');
  assert.equal(panel.getAttribute('aria-labelledby'), 'unplaced-title');
  assert.equal($('#unplaced-title')!.textContent, 'From the original plan');
  assert.doesNotMatch(panel.textContent!, /handbook/i, 'no "handbook" label (decision 8)');
  // It comes after the phase notes, the last thing on the page.
  assert.equal($('#main')!.lastElementChild, panel);
  // Every tick, under its saved key, with whether it was ticked.
  assert.deepEqual(
    $$('[data-unplaced-check]').map(li => li.dataset.unplacedCheck),
    Object.keys(saved.unmapped.checks),
  );
  assert.deepEqual(
    texts('[data-unplaced-check]').map(t => t.trim()),
    ['plastic, Phase 4 · Ticked', 'rubber, Phase 4 · Not ticked', script + ' · Ticked'],
  );
  // Every note, its text exactly as saved.
  assert.deepEqual(
    $$('[data-unplaced-note]').map(li => li.dataset.unplacedNote),
    ['factory-plastic', 'factory-gone'],
  );
  assert.deepEqual(
    $$('[data-unplaced-note] .unplaced-note').map(el => el.textContent),
    [evil + '\nsecond line', script],
  );
  assert.equal($('[data-unplaced-note="factory-plastic"] .unplaced-what')!.textContent, 'plastic');
  // Every group assignment, by group name (a group removed since keeps its id).
  assert.deepEqual(
    texts('[data-unplaced-assignment]').map(t => t.trim()),
    [`rubber · ${evil} · 30/min, fg-removed`],
  );
  // Showing them changes nothing that is saved.
  assert.deepEqual(state.handbookOrigin, saved);
  // It has no controls of its own: nothing to Tab to, nothing to change.
  assert.equal(panel.querySelectorAll('button, input, textarea, select, a, [tabindex]').length, 0);
});

test('a section with only some kinds of records lists only those', () => {
  openMigrated({
    version: '2026-09-13',
    unmapped: { checks: { 'moved-calc-5-plastic': true }, notes: {}, assignments: {} },
  });
  assert.deepEqual(
    $$('[data-unplaced] h3').map(h => h.textContent),
    ['Ticks'],
  );
  assert.match(
    $('[data-unplaced-check="moved-calc-5-plastic"]')!.textContent!,
    /plastic, Phase 5 \(this line already had its own tick\)/,
  );
});

test('without unplaced records there is no panel', () => {
  for (const handbookOrigin of [
    undefined,
    { version: '2026-09-13', unmapped: { checks: {}, notes: {}, assignments: {} } },
  ]) {
    openMigrated(handbookOrigin);
    assert.ok($('#main h1'), 'the Notes page is drawn');
    assert.equal($('#main [data-unplaced]'), null);
    assert.equal($('#unplaced-title'), null);
  }
  // The handbook profile has no such records either.
  open();
  go('notes');
  render();
  assert.equal($('#main [data-unplaced]'), null);
});

test('ADA points at the list on the plan and the Notes page', () => {
  adaClearFault();
  for (const [view, withRecords] of [
    ['plan', true],
    ['notes', true],
    ['notes', false],
  ] as const) {
    openMigrated(withRecords ? origin() : undefined);
    go(view);
    render();
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      setAdaIndex(i);
      const line = adaCurrent();
      if (line) seen.push(line.text);
    }
    const said = seen.find(text => /from the original plan/.test(text));
    if (withRecords) assert.match(said!, /^6 records from the original plan/);
    else assert.equal(said, undefined);
  }
});
