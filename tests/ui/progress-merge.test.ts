// Co-op progress on the Backup page (#1160, ui/backup/ProgressMerge.vue): "Export ticks" downloads
// the open profile's ticked step ids, and "Merge progress from file…" previews what a friend's file
// would tick, per phase, with what is ticked already and the ids this plan does not list, and
// ticks only after Merge, through the usual `checks` update. Cancel, a wrong file and a file with
// nothing new change nothing.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { generatedStepIds } from '../../public/app/opening-phase.ts';
import { TICKS_FORMAT } from '../../public/app/progress-merge.ts';
import { mergedProgress, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  evil,
  generated,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

let phaseOne: string[];
beforeEach(async () => {
  page();
  open({ calculated: generated(), phase: '1' });
  phaseOne = generatedStepIds('1');
  go('backup');
  render();
  await nextTick();
});

const ticksFile = (ticks: string[]) => ({
  format: TICKS_FORMAT,
  version: 1,
  exportedAt: '2026-10-14T12:00:00.000Z',
  saveName: evil,
  profileName: 'Anna',
  ticks,
});
// Chooses `contents` as the file of "Merge progress from file…".
function choose(contents: string, name = 'anna.json') {
  const input = $<HTMLInputElement>('#merge-progress')!;
  Object.defineProperty(input, 'files', {
    value: [new File([contents], name)],
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const toastText = () => $('#toast')!.textContent || '';
const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');

test('the Backup page offers Export ticks and Merge progress from file', () => {
  const panel = $('[data-coop-progress]')!;
  assert.match(panel.textContent!, /Co-op progress/);
  assert.equal($('[data-export-ticks]')!.textContent!.trim(), 'Export ticks');
  assert.equal($('[data-merge-progress]')!.textContent!.trim(), 'Merge progress from file…');
  noMarkup();
});

test('Export ticks downloads only the ticked step ids, with the save and profile name', async () => {
  state.checks = { [phaseOne[0]!]: true, [phaseOne[1]!]: false, 'slot-A01-built': true };
  let saved: Blob | undefined;
  URL.createObjectURL = (blob: Blob | MediaSource) => ((saved = blob as Blob), 'blob:x');
  URL.revokeObjectURL = () => {};
  $('[data-export-ticks]')!.click();
  await vi.waitFor(() => assert.ok(saved));
  const file = JSON.parse(await saved!.text());
  assert.equal(file.format, 'satisfactory-planner-ticks');
  assert.equal(file.version, 1);
  assert.equal(file.saveName, evil);
  assert.equal(file.profileName, evil);
  assert.deepEqual(file.ticks, [phaseOne[0], 'slot-A01-built'].sort());
  assert.equal(toastText(), 'Ticks exported: 2 ticked steps.');
});

test('the preview counts per phase, names what is ticked and skipped, and Merge ticks only the new steps', async () => {
  state.checks = { [phaseOne[0]!]: true };
  const calls = stubFetch<UpdateOp>({ '/api/update': (body: UpdateOp) => applyUpdate(body) });
  const seen: {
    preview?: { body: string; list: string[]; note: string; folded: string; ok: string };
  } = {};
  answerConfirms(() => {
    const dialog = $('#confirm')!;
    seen.preview = {
      body: dialog.querySelector('#confirm-body')!.textContent!,
      list: [...dialog.querySelectorAll('[data-confirm-list] li')].map(li => li.textContent!),
      note: dialog.querySelector('[data-confirm-note]')!.textContent!,
      folded: dialog.querySelector('[data-confirm-folded]')!.textContent!,
      ok: dialog.querySelector('[data-confirm-ok]')!.textContent!.trim(),
    };
    noMarkup();
    return true;
  });
  choose(
    JSON.stringify(ticksFile([phaseOne[0]!, phaseOne[1]!, phaseOne[2]!, 'calc-9-gone', evil])),
  );
  await vi.waitFor(() => assert.match(toastText(), /^Merged/));
  const shown = seen.preview;
  assert.ok(shown, 'the preview was shown');
  assert.match(shown.body, /^“anna\.json” is a ticks export of .* \/ Anna, exported /);
  assert.match(shown.body, /Merging ticks 2 steps here that are not ticked yet\./);
  assert.deepEqual(shown.list, ['Phase 1: 2 steps']);
  assert.equal(shown.note, 'Already ticked here: 1 step.');
  assert.match(shown.folded, /Skipped: 2 steps not in this plan/);
  assert.match(shown.folded, /calc-9-gone/);
  assert.ok(shown.folded.includes(evil), 'a hostile id is listed as text');
  assert.equal(shown.ok, 'Merge 2 ticks');
  assert.deepEqual(
    calls.map(([path, body]) => [path, body]),
    // A file without records of who ticked sends none, and never this device's (#1206).
    [
      [
        '/api/update',
        { type: 'checks', keys: [phaseOne[1], phaseOne[2]], value: true, tickedBy: {} },
      ],
    ],
  );
  assert.equal(state.checks[phaseOne[0]!], true);
  assert.equal(state.checks[phaseOne[1]!], true);
  assert.equal(state.checks['calc-9-gone'], undefined, 'a skipped id is not stored');
  assert.equal(toastText(), 'Merged 2 ticks from “anna.json”. Nothing was unticked.');
  assert.equal(mergedProgress?.count, 2);
  // ADA says it too, among the page's remarks.
  const remarks = Array.from({ length: 30 }, (_, i) => {
    setAdaIndex(i);
    return adaCurrent()?.text || '';
  });
  assert.ok(
    remarks.some(text => text.startsWith('Your merge ticked 2 steps from “anna.json”.')),
    'ADA names the merge',
  );
});

test('Cancel in the preview changes nothing', async () => {
  const calls = stubFetch({ '/api/update': (body: UpdateOp) => applyUpdate(body) });
  const asked = answerConfirms(false);
  choose(JSON.stringify(ticksFile([phaseOne[0]!])));
  await vi.waitFor(() => assert.equal(asked.length, 1));
  await new Promise(resolve => setTimeout(resolve));
  assert.deepEqual(calls, []);
  assert.deepEqual(state.checks, {});
});

test('a file that is not a progress export, or no JSON at all, says so and changes nothing', async () => {
  const calls = stubFetch({});
  const asked = answerConfirms(true);
  for (const contents of ['', 'not json', JSON.stringify({ hello: 'world' })]) {
    $('#toast')!.textContent = '';
    choose(contents);
    await vi.waitFor(() => assert.match(toastText(), /not a progress export/));
  }
  assert.deepEqual(asked, [], 'no preview');
  assert.deepEqual(calls, []);
  assert.deepEqual(state.checks, {});
});

test('a file with no ticks, or nothing new, says so without a preview', async () => {
  const calls = stubFetch({});
  const asked = answerConfirms(true);
  choose(JSON.stringify(ticksFile([])));
  await vi.waitFor(() =>
    assert.equal(toastText(), 'This file has no ticked steps, so there is nothing to merge.'),
  );
  state.checks = { [phaseOne[0]!]: true };
  choose(JSON.stringify(ticksFile([phaseOne[0]!])));
  await vi.waitFor(() =>
    assert.equal(toastText(), 'Nothing new to merge: 1 step it ticks is ticked here already.'),
  );
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

test('the ADA line about a merge goes with the page', async () => {
  stubFetch({ '/api/update': (body: UpdateOp) => applyUpdate(body) });
  answerConfirms(true);
  choose(JSON.stringify(ticksFile([phaseOne[0]!])));
  await vi.waitFor(() => assert.ok(mergedProgress));
  go('plan');
  render();
  await nextTick();
  assert.equal(mergedProgress, null);
  assert.equal($$('[data-coop-progress]').length, 0);
});
